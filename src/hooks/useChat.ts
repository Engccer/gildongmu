"use client";

/**
 * 채팅 메시지 상태와 전송 로직을 관리하는 훅.
 *
 * - useGeolocation()으로 현재 위치를 읽기만 한다 (요청/권한 처리는 PlaceSearch 담당).
 * - in-flight ref로 중복 전송을 막는다.
 * - 에러는 "chat_failed" 코드로 설정하고, dismissError()로 초기화한다.
 * - NDJSON 스트림을 라인 단위로 읽어 status/done/error 이벤트를 처리한다.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useManualLocation } from "@/hooks/useManualLocation";
import type { ChatMessage, ChatStreamEvent } from "@/lib/chat/types";

let counter = 0;
const nextId = () => `m${++counter}`;

export interface PlaceContext {
  name: string;
  lat: number;
  lng: number;
  category?: string;
  isStation?: boolean;
}

export function useChat(opts?: { placeContext?: PlaceContext }) {
  const placeContext = opts?.placeContext;
  const locale = useLocale();
  const geo = useGeolocation();
  const manual = useManualLocation();
  // 채팅 앵커 우선순위: 장소 앵커 > 수동 위치 > GPS.
  //
  // 첫 단계는 서버가 이미 보장한다(`anchorOf = placeAnchor ?? userLocation`).
  // 나머지 두 단계가 이 자리다 — 화면 첫 줄의 위치 표시줄이 "지정한 위치, X"라고
  // 알리는데 답이 GPS 좌표로 오면, 그 표시줄은 시각장애 사용자에게 조회 기준을
  // 알리는 신호이므로 신호 자체가 거짓이 된다.
  //
  // ⚠ 길찾기 도구(자동차·대중교통 출발지)도 이 필드를 쓰며 그것이 맞다 —
  // 브리핑은 수동 위치를 쓰고, 실좌표를 요구하는 것은 실시간 안내뿐이다
  // (안내 시작 도구가 채팅에 생기면 그때 `RealFix`와 분리한다, spec §4.4).
  //
  // 스토어의 동기 읽기다(판정은 트리거 3종이 이미 돌린다). `useCallback` deps에
  // 실리므로 참조 안정성이 필요해 두 스토어 객체에서만 새로 만든다.
  const geoCoords = geo.status === "ready" ? geo.coords : undefined;
  const userLocation = useMemo(
    () => (manual ? { lat: manual.lat, lng: manual.lng } : geoCoords),
    [manual, geoCoords],
  );

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // 렌더용 messages의 미러 — 히스토리 구성(전송 payload)의 단일 출처로 쓴다.
  // 이렇게 하면 sendMessage가 messages를 deps로 잡지 않아(신원 안정화 → onSend churn
  // 제거), 비동기 중 stale 클로저로 직전 응답이 히스토리에서 누락되는 경쟁 창도 닫힌다.
  const messagesRef = useRef<ChatMessage[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressCategories, setProgressCategories] = useState<string[]>([]);
  const inFlight = useRef(false);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || inFlight.current) return;

      inFlight.current = true;
      setError(null);

      const userMsg: ChatMessage = { id: nextId(), role: "user", text: trimmed };
      const history = [...messagesRef.current, userMsg];
      messagesRef.current = history;
      setMessages(history);
      setLoading(true);

      // 타임아웃은 fetch 헤더 수신뿐 아니라 스트림 본문 소비(read 루프)까지 전체에
      // 적용한다 — controller/timeoutId를 read 루프 바깥 상위 스코프에 두고, 외곽
      // finally에서 한 번만 clearTimeout 한다. (헤더만 받고 본문이 stall하면 abort)
      const controller = new AbortController();
      // 서버 maxDuration(120s)보다 약간 길게 — 동률이면 서버 컷오프와 클라 abort가
      // 같은 시점에 걸려 결과가 timeout/chat_failed로 비결정적이 된다. 클라가 더
      // 길면 "서버가 끝까지 시도 → 그 결과/에러 수신"이 결정적이 된다.
      const timeoutId = setTimeout(() => controller.abort(), 130_000);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map((m) => ({ role: m.role, text: m.text })),
            userLocation,
            locale,
            placeContext,
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          // 라우트가 내는 코드(rate_limited·chat_unavailable)를 읽어 분기 — 전부
          // chat_failed로 뭉개면 레이트리밋과 키 미설정이 일반 실패로 오낭독된다.
          let code = "chat_failed";
          try {
            const body = (await res.json()) as { error?: string };
            if (body.error === "rate_limited" || body.error === "chat_unavailable") {
              code = body.error;
            }
          } catch {
            // 본문 없음/비JSON — 일반 실패 유지
          }
          setError(code);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done: { text: string; renders?: unknown[]; sources?: unknown[] } | null = null;
        let streamError: string | null = null;

        while (true) {
          const { done: streamDone, value } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let evt: ChatStreamEvent;
            try { evt = JSON.parse(line); } catch { continue; }
            if (evt.type === "status") setProgressCategories(evt.categories);
            else if (evt.type === "done") done = evt;
            else if (evt.type === "error") streamError = evt.code;
          }
        }

        if (streamError) { setError(streamError); return; }
        // done 이벤트 없이 스트림이 끝나면 빈 버블 삽입을 막고 에러 처리(I-2 정신).
        if (!done) { setError("chat_failed"); return; }
        const assistantMsg: ChatMessage = {
          id: nextId(), role: "assistant",
          text: done.text ?? "",
          renders: (done.renders as ChatMessage["renders"]) ?? undefined,
          sources: (done.sources as ChatMessage["sources"]) ?? undefined,
        };
        const next = [...messagesRef.current, assistantMsg];
        messagesRef.current = next;
        setMessages(next);
      } catch (e) {
        setError(e instanceof DOMException && e.name === "AbortError" ? "timeout" : "chat_failed");
      } finally {
        clearTimeout(timeoutId);
        setProgressCategories([]);
        setLoading(false);
        inFlight.current = false;
      }
    },
    [userLocation, locale, placeContext],
  );

  const dismissError = useCallback(() => setError(null), []);

  return { messages, isLoading, error, progressCategories, sendMessage, dismissError };
}

"use client";

/**
 * 채팅 메시지 상태와 전송 로직을 관리하는 훅.
 *
 * - useGeolocation()으로 현재 위치를 읽기만 한다 (요청/권한 처리는 PlaceSearch 담당).
 * - in-flight ref로 중복 전송을 막는다.
 * - 에러는 "chat_failed" 코드로 설정하고, dismissError()로 초기화한다.
 * - NDJSON 스트림을 라인 단위로 읽어 status/done/error 이벤트를 처리한다.
 */
import { useCallback, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { useGeolocation } from "@/hooks/useGeolocation";
import type { ChatMessage, ChatStreamEvent } from "@/lib/chat/types";

let counter = 0;
const nextId = () => `m${++counter}`;

export function useChat() {
  const locale = useLocale();
  const geo = useGeolocation();
  // status === "ready"일 때만 coords를 꺼낸다 (GeoState union 안전 접근)
  const userLocation = geo.status === "ready" ? geo.coords : undefined;

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

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120_000);
        let res: Response;
        try {
          res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: history.map((m) => ({ role: m.role, text: m.text })),
              userLocation,
              locale,
            }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }
        if (!res.ok || !res.body) { setError("chat_failed"); return; }

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
        const assistantMsg: ChatMessage = {
          id: nextId(), role: "assistant",
          text: done?.text ?? "",
          renders: (done?.renders as ChatMessage["renders"]) ?? undefined,
          sources: (done?.sources as ChatMessage["sources"]) ?? undefined,
        };
        const next = [...messagesRef.current, assistantMsg];
        messagesRef.current = next;
        setMessages(next);
      } catch (e) {
        setError(e instanceof DOMException && e.name === "AbortError" ? "timeout" : "chat_failed");
      } finally {
        setProgressCategories([]);
        setLoading(false);
        inFlight.current = false;
      }
    },
    [userLocation, locale],
  );

  const dismissError = useCallback(() => setError(null), []);

  return { messages, isLoading, error, progressCategories, sendMessage, dismissError };
}

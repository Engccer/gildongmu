import { useState, useRef, useCallback, useEffect } from "react";

const TIMEOUT_MS = 6000;
const MAX_CHIPS = 3;

/**
 * 답변이 끝난 뒤 `/api/chat/suggestions`로 follow-up 질문 칩을 가져온다(dodo 이식).
 *
 * - 새 fetch는 이전 fetch를 abort하고, 6초 타임아웃을 둔다. 언마운트 시에도 abort.
 * - 실패·abort·비정상 응답은 전부 빈 배열로 조용히 생략한다 — 칩은 부재가 정상 상태라
 *   오류도 통지도 아니다.
 * - 늦게 도착한 옛 응답이 새 칩을 덮지 않도록, 완료 시점에 자기 controller가 아직
 *   최신인지 확인한 뒤에만 상태를 쓴다.
 */
export function useFollowUpSuggestions(locale: string) {
  const [chips, setChips] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setChips([]);
  }, []);

  const fetchSuggestions = useCallback(
    async (lastUserMessage: string, lastAssistantMessage: string, placeName?: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let next: string[] = [];
      try {
        const res = await fetch("/api/chat/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lastUserMessage, lastAssistantMessage, locale, placeName }),
          signal: controller.signal,
        });
        if (res.ok) {
          const data: unknown = await res.json();
          const raw = (data as { suggestions?: unknown })?.suggestions;
          next = Array.isArray(raw)
            ? raw.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, MAX_CHIPS)
            : [];
        }
      } catch {
        next = []; // abort·네트워크 오류 모두 조용한 생략
      } finally {
        clearTimeout(timer);
      }
      // 이미 abort됐거나(새 전송·clear) 더 새 fetch가 시작됐으면 상태를 건드리지 않는다.
      if (controller.signal.aborted || abortRef.current !== controller) return;
      setChips(next);
    },
    [locale],
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  return { chips, fetch: fetchSuggestions, clear };
}

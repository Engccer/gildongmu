"use client";

/**
 * 채팅 메시지 상태와 전송 로직을 관리하는 훅.
 *
 * - useGeolocation()으로 현재 위치를 읽기만 한다 (요청/권한 처리는 PlaceSearch 담당).
 * - in-flight ref로 중복 전송을 막는다.
 * - 에러는 "chat_failed" 코드로 설정하고, dismissError()로 초기화한다.
 */
import { useCallback, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { useGeolocation } from "@/hooks/useGeolocation";
import type { ChatMessage } from "@/lib/chat/types";

let counter = 0;
const nextId = () => `m${++counter}`;

export function useChat() {
  const locale = useLocale();
  const geo = useGeolocation();
  // status === "ready"일 때만 coords를 꺼낸다 (GeoState union 안전 접근)
  const userLocation = geo.status === "ready" ? geo.coords : undefined;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || inFlight.current) return;

      inFlight.current = true;
      setError(null);

      const userMsg: ChatMessage = { id: nextId(), role: "user", text: trimmed };
      const history = [...messages, userMsg];
      setMessages(history);
      setLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map((m) => ({ role: m.role, text: m.text })),
            userLocation,
            locale,
          }),
        });

        if (!res.ok) {
          setError("chat_failed");
          return;
        }

        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            text: data.text ?? "",
            render: data.render,
          },
        ]);
      } catch {
        setError("chat_failed");
      } finally {
        setLoading(false);
        inFlight.current = false;
      }
    },
    [messages, userLocation, locale],
  );

  const dismissError = useCallback(() => setError(null), []);

  return { messages, isLoading, error, sendMessage, dismissError };
}

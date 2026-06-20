"use client";
import { useEffect, useRef, type Ref } from "react";
import { useTranslations } from "next-intl";
import { useChat } from "@/hooks/useChat";
import { MessageBubble } from "./MessageBubble";
import { ChatInput } from "./ChatInput";

/**
 * 채팅 컨테이너 — useChat + MessageBubble + ChatInput을 결합.
 *
 * 접근성:
 * - 새 assistant 산문만 단일 polite live region으로 통지(lastAssistant?.id deps).
 *   카드 내용은 카드 시맨틱이 담당하므로 중복 낭독 없음.
 * - error는 role="alert"(assertive 없이 네이티브 role 사용).
 * - inputRef: 부모(Task 14 PlaceSearch)가 전달해 Shift+Esc 포커스를 채팅 입력창에 건다.
 */
export function ChatInterface({ inputRef }: { inputRef?: Ref<HTMLInputElement> }) {
  const t = useTranslations("chat");
  const { messages, isLoading, error, sendMessage } = useChat();
  const liveRef = useRef<HTMLDivElement>(null);

  // 새 assistant 산문만 polite 통지 — id가 바뀔 때만 갱신
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  useEffect(() => {
    if (liveRef.current && lastAssistant) liveRef.current.textContent = lastAssistant.text;
  }, [lastAssistant?.id]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-4">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>
      {/* 단일 polite live region — 과잉 ARIA 금지 원칙에 따라 이 하나만 */}
      <div ref={liveRef} aria-live="polite" className="sr-only" />
      {error && <p role="alert">{t(`error.${error}`)}</p>}
      <ChatInput onSend={sendMessage} disabled={isLoading} inputRef={inputRef} />
    </div>
  );
}

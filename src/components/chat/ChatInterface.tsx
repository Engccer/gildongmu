"use client";
import { useCallback, useEffect, useRef, type Ref } from "react";
import { useTranslations } from "next-intl";
import { useChat } from "@/hooks/useChat";
import { useChatSound } from "@/hooks/useChatSound";
import { MessageBubble } from "./MessageBubble";
import { ChatInput } from "./ChatInput";

/**
 * 채팅 컨테이너 — useChat + MessageBubble + ChatInput을 결합.
 *
 * 접근성:
 * - 새 assistant 산문만 단일 polite live region으로 통지(lastAssistant?.id deps).
 *   카드 내용은 카드 시맨틱이 담당하므로 중복 낭독 없음.
 * - 진행 통지(progressCategories)는 별도 polite live region — 완료 통지와 채널 분리.
 *   (도구 호출 진행 중임을 사용자에게 알리는 용도, assertive 미사용)
 * - error는 role="alert"(assertive 없이 네이티브 role 사용).
 * - inputRef: 부모(PlaceSearch)가 전달해 Shift+Esc 포커스를 채팅 입력창에 건다.
 */
export function ChatInterface({ inputRef }: { inputRef?: Ref<HTMLInputElement> }) {
  const t = useTranslations("chat");
  const { messages, isLoading, error, progressCategories, sendMessage } = useChat();
  const { playSend, playReceive } = useChatSound();
  const liveRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  // 최신 사용자 질문 heading 참조 — 응답 완료 후 포커스 이동 앵커.
  const lastQueryRef = useRef<HTMLHeadingElement>(null);
  // 직전 isLoading 값 — true→false 전환으로 "방금 응답 완료"를 감지한다.
  const wasLoadingRef = useRef(false);

  // 제출 효과음은 사용자 제스처 콜스택에서 울려 AudioContext를 unlock하고,
  // 이후 응답 완료음(비제스처)도 재생 가능하게 한다.
  const handleSend = useCallback(
    (text: string) => {
      playSend();
      void sendMessage(text);
    },
    [playSend, sendMessage],
  );

  // 응답 완료(isLoading true→false + 마지막이 assistant) 감지:
  // (1) 완료 효과음, (2) 최신 질문 heading으로 포커스 이동 — 스크린 리더가 새 답변의
  // 맥락(질문)에서 시작해 아래로 답변·카드를 읽어 내려가게 한다.
  useEffect(() => {
    const justFinished = wasLoadingRef.current && !isLoading;
    wasLoadingRef.current = isLoading;
    if (!justFinished) return;
    if (messages[messages.length - 1]?.role !== "assistant") return;
    playReceive();
    // 새 서브트리가 레이아웃된 뒤 포커스 이동(앱 표준 rAF 패턴, PlaceSearch와 동형).
    const raf = requestAnimationFrame(() => lastQueryRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [isLoading, messages, playReceive]);

  // 가장 최근 사용자 질문 id — MessageBubble에 isLastQuery를 부여하는 기준.
  const lastUserId = [...messages].reverse().find((m) => m.role === "user")?.id;

  // 새 assistant 산문만 polite 통지 — id가 바뀔 때만 갱신.
  // 매 렌더마다 reverse().find()가 새 객체를 만들므로, effect는 객체가 아니라
  // 추출한 원시값(id·text)에 의존한다(exhaustive-deps 정합 + 동일 의미 보존).
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const lastAssistantId = lastAssistant?.id;
  const lastAssistantText = lastAssistant?.text ?? "";
  useEffect(() => {
    if (liveRef.current && lastAssistantId) liveRef.current.textContent = lastAssistantText;
  }, [lastAssistantId, lastAssistantText]);

  // 진행 상태 통지 — progressCategories 변화 시 별도 polite 채널에 갱신.
  // t("progress.tool.<name>")가 없으면 next-intl이 키를 그대로 노출(허용, Task 6에서 채움).
  useEffect(() => {
    if (progressRef.current) {
      progressRef.current.textContent = progressCategories.length
        ? t("progress.searching", { tools: progressCategories.map((c) => t(`progress.tool.${c}`)).join(", ") })
        : "";
    }
  }, [progressCategories, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-4">
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            isLastQuery={m.role === "user" && m.id === lastUserId}
            lastQueryRef={lastQueryRef}
          />
        ))}
      </div>
      {/* 최종 답변 polite live region */}
      <div ref={liveRef} aria-live="polite" className="sr-only" />
      {/* 진행 통지 polite live region — 완료 채널과 의도적 분리 */}
      <div ref={progressRef} aria-live="polite" className="sr-only" />
      {error && <p role="alert">{t(`error.${error}`)}</p>}
      <ChatInput onSend={handleSend} disabled={isLoading} inputRef={inputRef} />
    </div>
  );
}

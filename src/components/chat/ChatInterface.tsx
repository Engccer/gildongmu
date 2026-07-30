"use client";
import { useCallback, useEffect, useRef, type Ref } from "react";
import { useTranslations } from "next-intl";
import { useChat, type PlaceContext } from "@/hooks/useChat";
import { useChatSound } from "@/hooks/useChatSound";
import { MessageBubble } from "./MessageBubble";
import { ChatInput } from "./ChatInput";

/**
 * 채팅 컨테이너 — useChat + MessageBubble + ChatInput을 결합.
 *
 * 접근성:
 * - 응답 완료 통지는 효과음(playReceive) + 포커스 이동(최신 질문 heading)이 담당한다.
 *   답변 산문은 보이는 MessageBubble에만 존재하며 별도 sr-only live region에 복제하지
 *   않는다 — 복제하면 스크린 리더가 보이는 답변과 sr-only 답변을 중복 낭독한다(과거 결함).
 *   포커스가 질문 heading으로 가면 사용자가 답변·카드·출처를 한 번씩 읽어 내려간다.
 * - 진행 통지(progressCategories)는 polite live region — 도구 호출 진행을 알리는 용도
 *   (assertive 미사용).
 * - error는 role="alert"(assertive 없이 네이티브 role 사용).
 * - inputRef: 부모(PlaceSearch)가 전달해 Shift+Esc 포커스를 채팅 입력창에 건다.
 */
export function ChatInterface({
  inputRef,
  placeContext,
  examplePrompts,
}: {
  inputRef?: Ref<HTMLInputElement>;
  placeContext?: PlaceContext;
  examplePrompts?: string[];
}) {
  const t = useTranslations("chat");
  // placeChat 스코프 번역기 — 빈 상태 안내 문구(placeChat.empty)는 chat 스코프 밖이다.
  const tp = useTranslations("placeChat");
  const { messages, isLoading, error, progressCategories, sendMessage } = useChat({ placeContext });
  const { playSend, playReceive } = useChatSound();
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

  // 진행 상태 통지 — progressCategories 변화 시 별도 polite 채널에 갱신.
  // 18개 도구 전 라벨 보유 — 새 도구 추가 시 `chat.progress.tool.<name>` 6로케일 동반 추가.
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
      {/* 빈 상태 — 메시지가 없고 예시 프롬프트가 있으면 안내 문구 + 예시 버튼 3개를
          노출한다. 버튼 클릭은 기존 handleSend(playSend + sendMessage)를 재사용해
          그 문구를 첫 메시지로 전송한다. */}
      {messages.length === 0 && examplePrompts && examplePrompts.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{tp("empty")}</p>
          {examplePrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => handleSend(prompt)}
              className="min-h-11 rounded-md border border-border bg-background px-4 py-2 text-left text-sm hover:bg-accent/10"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}
      {/* 진행 통지 polite live region — 답변 산문은 MessageBubble에만(중복 낭독 방지) */}
      <div ref={progressRef} aria-live="polite" className="sr-only" />
      {error && <p role="alert">{t(`error.${error}`)}</p>}
      <ChatInput onSend={handleSend} disabled={isLoading} inputRef={inputRef} />
    </div>
  );
}

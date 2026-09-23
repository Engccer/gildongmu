"use client";

import { useState, type Ref } from "react";
import { useTranslations } from "next-intl";
import { VoiceRecordButton } from "@/components/VoiceRecordButton";

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /** 제출 버튼 참조 — 부모가 칩·예시 버튼 전송 직전 포커스를 여기로 선점한다(헌장 §6). */
  sendButtonRef?: Ref<HTMLButtonElement>;
  /** 받아쓰기 버튼을 누르는 순간(시작·정지 모두) — 부모가 답변 듣기를 멈춘다(마이크에 낭독이 섞이지 않게). */
  onDictationPress?: () => void;
}

/**
 * 채팅 입력창 — 텍스트 입력 + 전송 버튼 + VoiceRecordButton 재사용.
 * - aria-disabled: 비활성 버튼도 포커스 유지(스크린 리더 맥락 보존)
 * - 받아쓰기 전사 결과는 즉시 전송(위원장 선호)
 */
export function ChatInput({ onSend, disabled, inputRef, sendButtonRef, onDictationPress }: Props) {
  const t = useTranslations("chat");
  const [value, setValue] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 p-2">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={t("inputLabel")}
        className="flex-1 min-h-11 rounded border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      {/* contents: 레이아웃·접근성 트리에 흔적 없는 래퍼. 캡처 단계라 녹음 시작(getUserMedia)보다 먼저 멈춘다. */}
      <span className="contents" onClickCapture={onDictationPress}>
        <VoiceRecordButton onTranscribed={(text: string) => onSend(text)} />
      </span>
      <button
        ref={sendButtonRef}
        type="submit"
        aria-disabled={disabled || !value.trim()}
        className="min-h-11 min-w-11 rounded border border-border px-3 text-sm text-accent aria-disabled:opacity-50"
      >
        {t("send")}
      </button>
    </form>
  );
}

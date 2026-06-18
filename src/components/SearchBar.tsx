"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { VoiceRecordButton } from "./VoiceRecordButton";
import type { VoiceRecorderErrorCode } from "@/hooks/useVoiceRecorder";

export function SearchBar({
  query,
  onQueryChange,
  onSubmit,
  busy,
  onTranscribed,
  onVoiceError,
  label,
  placeholder,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  onTranscribed: (text: string) => void;
  onVoiceError?: (code: VoiceRecorderErrorCode) => void;
  /** sr-only 라벨 오버라이드 (없으면 search.label) */
  label?: string;
  /** placeholder 오버라이드 (없으면 search.placeholder) */
  placeholder?: string;
}) {
  const t = useTranslations("search");
  const inputRef = useRef<HTMLInputElement>(null);

  function clearQuery() {
    onQueryChange("");
    // 지운 뒤 포커스를 입력창으로 돌려준다 — 버튼이 사라지면서 포커스가
    // document.body로 유실되는 것을 막는다(키보드·스크린 리더 사용자 맥락 보존).
    inputRef.current?.focus();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex gap-2"
      role="search"
    >
      <label htmlFor="place-query" className="sr-only">
        {label ?? t("label")}
      </label>
      {/* 입력창 + 우측 지우기 버튼을 한 묶음으로(relative) — 버튼은 입력창 안에
          겹쳐 띄우고, 입력 텍스트가 가려지지 않도록 오른쪽 패딩을 둔다. */}
      <div className="relative flex-1">
        <input
          ref={inputRef}
          id="place-query"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder ?? t("placeholder")}
          autoComplete="off"
          className="min-h-12 w-full rounded-md border border-border bg-background pl-4 pr-12 text-lg [&::-webkit-search-cancel-button]:appearance-none"
        />
        {query && (
          <button
            type="button"
            onClick={clearQuery}
            aria-label={t("clear")}
            className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center text-muted"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        )}
      </div>
      {/* 음성은 1급 시민 — 탭 순서 [검색어][음성][검색]. type="button"이라 폼 미제출. */}
      <VoiceRecordButton onTranscribed={onTranscribed} onError={onVoiceError} />
      <button
        type="submit"
        aria-disabled={busy}
        aria-busy={busy}
        className="inline-flex min-h-12 items-center gap-2 rounded-md bg-accent px-5 text-lg font-semibold text-accent-foreground aria-disabled:opacity-50"
      >
        <Search aria-hidden="true" className="h-5 w-5" />
        {t("button")}
      </button>
    </form>
  );
}

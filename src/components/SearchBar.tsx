"use client";

import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { VoiceRecordButton } from "./VoiceRecordButton";
import type { VoiceRecorderErrorCode } from "@/hooks/useVoiceRecorder";

export function SearchBar({
  query,
  onQueryChange,
  onSubmit,
  busy,
  onTranscribed,
  onVoiceError,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  onTranscribed: (text: string) => void;
  onVoiceError?: (code: VoiceRecorderErrorCode) => void;
}) {
  const t = useTranslations("search");
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
        {t("label")}
      </label>
      <input
        id="place-query"
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={t("placeholder")}
        autoComplete="off"
        className="min-h-12 flex-1 rounded-md border border-border bg-background px-4 text-lg"
      />
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

"use client";

import { useRef, type Ref } from "react";
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
  inputRef: externalInputRef,
  onAsk,
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
  /**
   * 외부에서 입력창 포커스를 제어할 때 전달하는 ref.
   * 없으면 내부 ref를 사용해 기존 동작(지우기 버튼 클릭 후 포커스 복귀)을 유지한다.
   */
  inputRef?: Ref<HTMLInputElement>;
  /**
   * 옴니박스 듀얼 액션(스펙 §1) — 있으면 검색 버튼 뒤에 [AI에게 질문] 버튼을
   * 렌더한다(Gemini 키 게이트는 호출부 책임). Enter는 여전히 폼 제출=검색.
   */
  onAsk?: () => void;
}) {
  const t = useTranslations("search");
  // 외부 ref가 없을 때 사용하는 내부 ref — clearQuery의 포커스 복귀에 쓴다.
  const internalRef = useRef<HTMLInputElement>(null);
  // 실제 input에 연결할 ref: 외부 ref가 주어지면 두 ref를 모두 연결(mergedRef), 없으면
  // 내부 ref만 사용. clearQuery는 항상 internalRef로 포커스하므로 외부 ref가 있어도
  // internalRef를 함께 채워야 한다.
  const inputRef = externalInputRef
    ? (el: HTMLInputElement | null) => {
        // internalRef는 clearQuery 전용 (useRef 반환이라 변경 허용)
        internalRef.current = el;
        // 부모(PlaceSearch)의 RefObject/콜백을 함께 충족 — Shift+Esc 포커스 제어용.
        // RefObject.current 쓰기는 ref 충족의 정상 패턴이나 React Compiler의
        // immutability 규칙이 prop 변경으로 오인하므로 이 한 줄만 예외 처리한다.
        if (typeof externalInputRef === "function") externalInputRef(el);
        // eslint-disable-next-line react-hooks/immutability
        else externalInputRef.current = el;
      }
    : internalRef;

  function clearQuery() {
    onQueryChange("");
    // 지운 뒤 검색 입력창으로 포커스를 되돌린다 — VoiceOver 포커스도 함께 따라와
    // 빈 검색창에 안착하므로, 더블탭 한 번으로 바로 다시 입력할 수 있다.
    //
    // ⚠ iOS VoiceOver에서는 '지운 직후 온스크린 키보드 자동 등장'이 플랫폼상 불가능하다.
    // Apple 문서상 편집 모드(=키보드) 진입은 오직 사용자가 텍스트 필드를 직접 더블탭할
    // 때만 일어나고, 필드 밖 버튼에서 focus()로는 못 띄운다. 또 VoiceOver 더블탭은
    // pointerdown/mousedown/touchstart 시퀀스를 발생시키지 않으므로 그 이벤트에 건
    // preventDefault(blur 차단)도 무효다. 따라서 '포커스 안착'까지가 최선이며 —
    // 여기에 키보드를 강제하려는 pointer 트릭을 다시 추가하지 말 것(실측으로 무효 확인).
    internalRef.current?.focus();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex gap-2"
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
          onKeyDown={(e) => {
            // 듀얼 액션 키보드 계약(위원장 지정 2026-07-30): Enter=검색(폼 제출),
            // Ctrl+Enter(맥 Cmd+Enter)=AI 질문. preventDefault로 암묵 폼 제출을
            // 막아 질문이 검색으로 새지 않게 한다. onAsk 없으면(키 게이트) 기본 검색.
            if (onAsk && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onAsk();
            }
          }}
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
      {onAsk && (
        <button
          type="button"
          onClick={onAsk}
          className="inline-flex min-h-12 items-center rounded-md border border-accent px-4 text-lg font-semibold text-accent"
        >
          {t("askAi")}
        </button>
      )}
    </form>
  );
}

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
    // 키보드로 버튼을 활성화(Enter)한 경우엔 pointerdown이 없어 preventDefault가
    // 걸리지 않으므로, 버튼이 사라질 때 포커스가 document.body로 유실되는 것을
    // 막으려 입력창으로 되돌린다. 포인터 탭 경로에서는 아래 onPointerDown이 이미
    // 입력창 포커스를 유지하므로 이 focus()는 무해한 no-op이다.
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
          placeholder={placeholder ?? t("placeholder")}
          autoComplete="off"
          className="min-h-12 w-full rounded-md border border-border bg-background pl-4 pr-12 text-lg [&::-webkit-search-cancel-button]:appearance-none"
        />
        {query && (
          <button
            type="button"
            // 지우기 버튼이 포커스를 가져가면 입력창이 blur돼 모바일 가상 키보드가
            // 내려가고, iOS는 이후 프로그래밍 방식 focus()로 키보드를 다시 못 띄운다.
            // → blur를 아예 막는다. iOS는 blur를 touchend에서 처리하고 mousedown은
            // 그 뒤에 합성돼 이미 늦으므로, 터치보다 먼저 발생하는 pointerdown에서
            // 기본동작(포커스 이동/blur)을 막아 입력창 포커스·키보드를 유지한다.
            // preventDefault가 iOS에서 click을 억제할 수 있어 지우기 동작도 여기서
            // 함께 수행한다(clearQuery는 멱등 — onClick과 중복 호출돼도 무해).
            onPointerDown={(e) => {
              e.preventDefault();
              clearQuery();
            }}
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

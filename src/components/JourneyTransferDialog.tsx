"use client";

import { useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";
import type { JourneyStationPick } from "@/lib/journey/journey-lines";
import { displayStationName } from "@/lib/journey/display";
import type { JourneyTransferMode, JourneyTransferSide } from "@/lib/journey/transfer-guess";

/** 질문의 답: 갈아탈 곳의 한쪽(승차 쪽·하차 쪽) 또는 경유만. */
export type JourneyTransferAnswer = JourneyTransferSide | "via";

/** 입구 검색에서 고른 역·정류장과 그 짐작(E77 판정 3·4). */
export interface JourneyTransferQuestion {
  pick: JourneyStationPick;
  mode: JourneyTransferMode;
  guess: JourneyTransferSide;
  /** 장소 줄이면 그 라틴 표기(경유만 답했을 때 경유지 끝점에 싣는다, A53). 정류장은 null. */
  roman: string | null;
}

/**
 * 질문 문장과 버튼 셋(E77 spec §2.3) — 짐작이 언제나 첫 버튼. 키는 리터럴로 쓴다(수단 낱말마다 조사가 달라 문장 하나 = 키 하나).
 * 순수 조립이라 테스트가 직접 부른다.
 */
export function journeyTransferPrompt(
  q: JourneyTransferQuestion,
  t: (key: string, args?: Record<string, string>) => string,
): { question: string; options: { answer: JourneyTransferAnswer; label: string }[] } {
  const place =
    q.pick.kind === "stop"
      ? t("stopPlace", { stop: q.pick.label })
      : t("stationPlace", { station: displayStationName(q.pick.label) });
  const a = { place };
  const byMode = <T,>(subway: T, rail: T, bus: T) => (q.mode === "subway" ? subway : q.mode === "rail" ? rail : bus);
  const yesAlight = { answer: "alight" as const, label: t("answerYesAlight", a) };
  const viaOnly = { answer: "via" as const, label: t("answerViaOnly", a) };
  if (q.guess === "alight") {
    return {
      question: byMode(t("askAlightSubway", a), t("askAlightRail", a), t("askAlightBus", a)),
      options: [
        yesAlight,
        {
          answer: "board",
          label: byMode(t("answerNoBoardSubway", a), t("answerNoBoardRail", a), t("answerNoBoardBus", a)),
        },
        viaOnly,
      ],
    };
  }
  return {
    question: byMode(t("askBoardSubway", a), t("askBoardRail", a), t("askBoardBus", a)),
    options: [
      {
        answer: "board",
        label: byMode(t("answerYesBoardSubway", a), t("answerYesBoardRail", a), t("answerYesBoardBus", a)),
      },
      {
        answer: "alight",
        label: byMode(t("answerNoAlightSubway", a), t("answerNoAlightRail", a), t("answerNoAlightBus", a)),
      },
      viaOnly,
    ],
  };
}

/**
 * 갈아탈 곳 확인 질문(E77 spec §3.2). 네이티브 모달 `<dialog>` 하나 — 이름은 질문 문장(`aria-labelledby`), 그 밖 ARIA 없음
 * (`role`·`aria-modal`은 네이티브가 준다). 열리면 버튼 1(짐작)로 포커스를 준다: 스크린 리더는 대화상자 이름(질문)을 먼저 말하고
 * 버튼 1에 착지한다.
 *
 * 닫기(「닫기」·Esc)와 답 모두 `close()`를 먼저 부른 뒤 부모에게 알린다 — 모달이 열린 동안 바깥 요소는 inert라 부모의 포커스
 * 이동(입구 버튼·새 줄)이 먹히지 않는다.
 */
export function JourneyTransferDialog({
  question,
  onAnswer,
  onDismiss,
}: {
  question: JourneyTransferQuestion;
  onAnswer: (answer: JourneyTransferAnswer) => void;
  onDismiss: () => void;
}) {
  const tJourney = useTranslations("journey");
  const tActions = useTranslations("actions");
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const { question: text, options } = journeyTransferPrompt(question, tJourney);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    // jsdom 등 `showModal` 없는 환경은 열림 속성만(포커스 이동은 같다).
    if (typeof el.showModal === "function") {
      if (!el.open) el.showModal();
    } else {
      el.setAttribute("open", "");
    }
    firstRef.current?.focus();
  }, []);

  function close() {
    const el = dialogRef.current;
    if (!el) return;
    if (typeof el.close === "function") el.close();
    else el.removeAttribute("open");
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Esc: 브라우저 기본 닫기 대신 같은 닫기 경로로(포커스를 입구 버튼으로 돌린다).
        e.preventDefault();
        close();
        onDismiss();
      }}
      className="max-w-md rounded-lg border border-border bg-background p-4 text-foreground backdrop:bg-black/40"
    >
      <p id={titleId} className="text-base font-medium">
        {text}
      </p>
      <div className="mt-3 flex flex-col items-stretch gap-2">
        {options.map((o, i) => (
          <button
            key={o.answer}
            type="button"
            ref={i === 0 ? firstRef : undefined}
            onClick={() => {
              close();
              onAnswer(o.answer);
            }}
            className="min-h-11 rounded-md border border-blue-700 px-3 py-2 text-left text-sm text-blue-700 dark:text-blue-300"
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            close();
            onDismiss();
          }}
          className="min-h-11 rounded-md border border-border px-3 py-2 text-sm"
        >
          {tActions("close")}
        </button>
      </div>
    </dialog>
  );
}

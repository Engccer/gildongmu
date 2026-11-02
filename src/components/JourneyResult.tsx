"use client";

import { useRef, useState, type Ref } from "react";
import { useTranslations } from "next-intl";
import type { Coord, JourneyResult } from "@/lib/types";
import {
  journeyEgressLine,
  journeyEgressOption,
  journeyLineQualifiers,
  journeyMissingLines,
  journeyTaxiInLine,
  journeyTotalsLine,
  journeyVariantHeading,
  type JourneyStationPick,
} from "@/lib/journey/journey-lines";
import { TransitRouteResult } from "./TransitRouteBriefing";
import { JourneyGuide, type JourneyGuidePlan } from "./JourneyGuide";

/**
 * 여정 조회 결과(E70-f spec §5). 읽기 순서: 고른 변형 제목 heading(포커스 착지점) → 못 찾음 줄 → (변형 둘이면) 선택 버튼 둘 →
 * 합계 → 택시 앞 → 대중교통 구간 → 출구 → [안내 시작]. 줄마다 한 접근성 객체(쉼표 결합)다.
 *
 * 웹은 변형이 하나여도 heading을 둔다 — 수단 섹션마다 h3이 있는 결과 구조에서 여정만 heading이 없으면 heading 점프로 닿지
 * 못하고, 조회 완료 착지점도 없다(iOS는 조회 버튼에 머무는 화면 규칙이라 다르다).
 *
 * [안내 시작]을 누르면 같은 자리에서 이어 안내(`JourneyGuide`)가 돈다. 안내 중엔 변형·출구 바꾸기를 숨긴다(판정 25 — 바꾸면
 * 계획과 갈라진다). 선택 상태는 `aria-pressed`, 시각 체크 표식은 낭독에서 숨긴다(색·trait만으로 전하지 않는다, WCAG 1.4.1).
 */
export function JourneyResultView({
  result,
  board,
  alight,
  dest,
  destLabel,
  destRoman,
  locale,
  headingRef,
  announce,
}: {
  result: JourneyResult;
  board: JourneyStationPick | null;
  alight: JourneyStationPick | null;
  dest: Coord;
  destLabel: string;
  destRoman: string | null;
  locale: string;
  headingRef: Ref<HTMLHeadingElement>;
  announce: (text: string, lang?: "ko") => void;
}) {
  const t = useTranslations("journey");
  const tBeacon = useTranslations("beacon");
  const tTransit = useTranslations("route.transit");
  const [variantIndex, setVariantIndex] = useState(0);
  const [egressIndex, setEgressIndex] = useState(0);
  /**
   * 이어 안내. `finished`면 여정은 끝났지만 대중교통 단계에서 끝나 그 패널(말미 도보 인계)이 남아 있다 — 그동안 [안내 시작]도
   * 다시 선다(누르면 새 여정이 그 패널을 갈아 끼운다).
   */
  const [guide, setGuide] = useState<{ id: number; plan: JourneyGuidePlan; finished: boolean } | null>(null);
  const startRef = useRef<HTMLButtonElement>(null);

  const variant = result.variants[Math.min(variantIndex, result.variants.length - 1)];
  const lines = journeyLineQualifiers(result, board, alight);
  const heading = (v: typeof variant) => journeyVariantHeading(v, board, alight, lines, t);
  const options = variant.egress?.options ?? [];
  const egress = journeyEgressOption(variant, egressIndex);
  const taxiIn = journeyTaxiInLine(variant, t);
  const guiding = guide !== null && !guide.finished;

  function start() {
    // 누른 버튼이 사라진다 — 단계 패널이 자기 트리거로 착지한다(focusTriggerOnMount).
    setGuide((prev) => ({
      id: (prev?.id ?? 0) + 1,
      plan: { variant, egress, alightDesignated: alight !== null, dest, destLabel },
      finished: false,
    }));
  }

  return (
    <>
      <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold">
        {heading(variant)}
      </h3>
      {journeyMissingLines(result, board, alight, t).map((line) => (
        <p key={line} className="mt-1 text-sm">
          {line}
        </p>
      ))}
      {result.variants.length > 1 && !guiding && (
        <div className="mt-1 flex flex-col">
          {result.variants.map((v, i) => (
            <button
              key={v.kind}
              type="button"
              aria-pressed={i === variantIndex}
              onClick={() => {
                setVariantIndex(i);
                setEgressIndex(0);
              }}
              className="min-h-11 text-left text-sm text-blue-700 underline dark:text-blue-300"
            >
              {heading(v)}
              {i === variantIndex && <span aria-hidden="true"> ✓</span>}
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 text-sm">{journeyTotalsLine(variant, egressIndex, t)}</p>
      {taxiIn && <p className="mt-1 text-sm">{taxiIn}</p>}
      <TransitRouteResult
        route={variant.transit}
        t={tTransit}
        locale={locale}
        dest={destLabel}
        destRoman={destRoman}
        includeSummary={false}
      />
      {options.length > 1 && !guiding ? (
        <div className="mt-1 flex flex-col">
          {options.map((o, i) => (
            <button
              key={`${o.kind}-${o.label}-${i}`}
              type="button"
              aria-pressed={i === egressIndex}
              onClick={() => setEgressIndex(i)}
              className="min-h-11 text-left text-sm text-blue-700 underline dark:text-blue-300"
            >
              {journeyEgressLine(variant, o, t)}
              {i === egressIndex && <span aria-hidden="true"> ✓</span>}
            </button>
          ))}
        </div>
      ) : (
        egress && <p className="mt-1 text-sm">{journeyEgressLine(variant, egress, t)}</p>
      )}
      {guide && (
        <JourneyGuide
          key={guide.id}
          plan={guide.plan}
          announce={announce}
          onFinished={(keepTransit) => {
            setGuide((prev) => (prev && keepTransit ? { ...prev, finished: true } : null));
            // 안내 컨트롤이 사라지는 전이 — 커서가 body로 떨어졌으면 다시 시작할 수 있는 버튼으로(헌장 §5).
            requestAnimationFrame(() => {
              if (document.activeElement === document.body || document.activeElement === null) {
                startRef.current?.focus();
              }
            });
          }}
        />
      )}
      {!guiding && (
        <button
          ref={startRef}
          type="button"
          onClick={start}
          className="mt-2 min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300"
        >
          {tBeacon("guideStartTransitAlt", { name: heading(variant) })}
        </button>
      )}
    </>
  );
}

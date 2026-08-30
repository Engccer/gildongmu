"use client";

import { useTranslations } from "next-intl";
import { formatDistance } from "@/lib/format";
import type { WalkRouteBriefing as Briefing } from "@/lib/types";
import { walkStepItems } from "@/lib/route-step-items";

/**
 * 도보 경로 결과 렌더 전용(폼·fetch 없음), CarRouteResult/TransitRouteResult와
 * 동형. 조회 오케스트레이션은 소비 뷰(길찾기 뷰, Task W5)가 소유하며 heading도
 * 그쪽이 렌더한다(여기선 요약문+step 리스트만).
 *
 * 번역 네임스페이스는 route.walk가 아니라 route.pedestrian이다: route.walk는
 * 이미 모드 라벨 리프 문자열("도보")로 점유되어 있어(RouteLinks.tsx의
 * t(`route.${mode}`)) 객체로 덮으면 그 라벨이 깨진다. car(route.briefing)·
 * public(route.transit)도 동일 충돌을 모드명과 다른 이름으로 피한 기존 관례를
 * 따랐다(provider 파일명 tmap-pedestrian.ts와도 일치).
 */
export function WalkRouteResult({
  briefing,
  t,
  waypointLabel,
  includeSummary = true,
  omitNoticeStep = false,
}: {
  briefing: Briefing;
  t: ReturnType<typeof useTranslations<"route.pedestrian">>;
  /** 경유지 라벨(N4). `briefing.waypoint`와 함께 있을 때만 구획 문장을 그린다. */
  waypointLabel?: string | null;
  /** disclosure 펼침 본문처럼 라벨이 이미 요약이면 false(인접 중복 금지). iOS `WalkRouteRows` 미러. */
  includeSummary?: boolean;
  /**
   * 서버 `withStepFree`가 스텝 0으로 삽입한 `stepFreeNotice` 문장을 뗀다(라벨에 병기된
   * 경우). 경유지 인덱스는 서버가 한 칸 민 것의 역연산으로 되돌린다 — 안 되돌리면
   * "경유지 도착" 구획이 한 스텝 뒤에 붙는다.
   */
  omitNoticeStep?: boolean;
}) {
  const tDir = useTranslations("directions");
  // 거리 표기는 `formatDistance` 정본에 맡긴다. 종전엔 여기서 소수 km를 직접
  // 조립해 같은 화면의 자동차 브리핑("3km 600m")과 표기가 갈렸다.
  const distance = formatDistance(briefing.distanceMeters);
  const minutes = Math.round(briefing.durationSeconds / 60);
  const { items, waypointIndex } = walkStepItems(briefing, omitNoticeStep);

  return (
    <>
      {includeSummary && (
        <p className="mt-1 text-sm">{t("summary", { distance, minutes })}</p>
      )}
      <StepList
        items={items}
        waypointIndex={waypointIndex}
        waypointText={waypointLabel ? tDir("viaArrived", { label: waypointLabel }) : null}
      />
    </>
  );
}

/**
 * 번호 목록을 경유지 자리에서 둘로 가른다(N4). 한 `<ol>` 안에 번호 없는 항목을 끼우면
 * 카운터가 그 항목도 세어 번호가 건너뛴다 — `start`로 이어 붙인 두 목록 사이에 평문
 * 한 줄이 정본이다(스텝 문장은 서버 원문 그대로, 구획만 소비자가 그린다).
 */
export function StepList({
  items,
  waypointIndex,
  waypointText,
  lang,
}: {
  items: string[];
  waypointIndex?: number;
  waypointText: string | null;
  /**
   * 스텝 문장의 언어가 페이지와 다를 때(자동차 ko 폴백, `guidanceLang`) 각 `<li>`에 단다 —
   * 스텝은 이미 별도 줄이라 분절이 생기지 않는다(접근성 헌장 "한 줄 = 한 객체").
   */
  lang?: "ko";
}) {
  const cls = "mt-2 list-decimal pl-6 text-sm leading-relaxed";
  // 0도 유효하다: "첫 스텝 앞에서 경유지 도착". `omitNoticeStep`이 서버 +1을 되돌리면
  // 0이 나올 수 있고, 그때 >0 가드로 떨구면 경유지 문장이 오류 없이 사라진다(리뷰 검출).
  // 앞 목록이 비면 빈 <ol>을 그리지 않고 문장부터 낸다.
  const split =
    waypointText !== null && waypointIndex !== undefined && waypointIndex >= 0 && waypointIndex < items.length
      ? waypointIndex
      : null;
  if (split === null) {
    return (
      <ol className={cls}>
        {items.map((text, i) => (
          <li key={`${i}-${text}`} lang={lang}>
            {text}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <>
      {split > 0 && (
        <ol className={cls}>
          {items.slice(0, split).map((text, i) => (
            <li key={`${i}-${text}`} lang={lang}>
              {text}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-sm font-medium">{waypointText}</p>
      <ol className={cls} start={split + 1}>
        {items.slice(split).map((text, i) => (
          <li key={`${split + i}-${text}`} lang={lang}>
            {text}
          </li>
        ))}
      </ol>
    </>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { formatDistance } from "@/lib/format";
import type { WalkRouteBriefing as Briefing } from "@/lib/types";

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
}: {
  briefing: Briefing;
  t: ReturnType<typeof useTranslations<"route.pedestrian">>;
}) {
  // 거리 표기는 `formatDistance` 정본에 맡긴다. 종전엔 여기서 소수 km를 직접
  // 조립해 같은 화면의 자동차 브리핑("3km 600m")과 표기가 갈렸다.
  const distance = formatDistance(briefing.distanceMeters);
  const minutes = Math.round(briefing.durationSeconds / 60);

  return (
    <>
      <p className="mt-1 text-sm">{t("summary", { distance, minutes })}</p>
      <ol className="mt-2 list-decimal pl-6 text-sm leading-relaxed">
        {briefing.steps.map((step, i) => (
          <li key={i}>{step.description}</li>
        ))}
      </ol>
    </>
  );
}

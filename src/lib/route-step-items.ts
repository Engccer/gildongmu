/**
 * 화면 `StepList`가 그리는 스텝 항목의 정본 계산(React 비의존).
 *
 * 길찾기 뷰의 도보·자동차 목록과 WebMCP `get_route_steps`·`{mode}:step:{n}` 착지가 **같은
 * 배열**을 읽는다(spec 2026-08-27 §4.3 "문장의 정본") — 두 곳이 각자 계산하면 도구가 돌려준
 * n번 문장과 커서가 착지한 n번 항목이 다른 문장이 될 수 있고, SR 사용자에겐 그 어긋남을
 * 확인할 채널이 없다.
 */
import { formatDistance, joinText } from "./format";
import type { CarRouteBriefing, WalkRouteBriefing } from "./types";

/**
 * 도보 스텝 항목. `omitNoticeStep`이면 서버 `withStepFree`가 스텝 0으로 삽입한
 * `stepFreeNotice` 문장을 떼고, 경유지 인덱스는 서버가 한 칸 민 것의 역연산으로 되돌린다
 * (안 되돌리면 "경유지 도착" 구획이 한 스텝 뒤에 붙는다).
 */
export function walkStepItems(
  briefing: WalkRouteBriefing,
  omitNoticeStep: boolean,
): { items: string[]; waypointIndex: number | undefined } {
  const dropNotice =
    omitNoticeStep &&
    briefing.stepFreeNotice !== undefined &&
    briefing.steps[0]?.description === briefing.stepFreeNotice;
  const steps = dropNotice ? briefing.steps.slice(1) : briefing.steps;
  return {
    items: steps.map((s) => s.description),
    waypointIndex:
      briefing.waypoint === undefined
        ? undefined
        : briefing.waypoint.stepIndex - (dropNotice ? 1 : 0),
  };
}

/**
 * 자동차 스텝 항목 — 한 줄 = 한 객체: 지점명·안내·거리를 joinText로 단일 텍스트에 합친다
 * (과거 em dash·괄호 분절을 제거 — 쉼표 구분이 SR 낭독 정본). 거리 0은 미제공 의미론이라
 * >0일 때만 병기한다.
 */
export function carStepItems(briefing: CarRouteBriefing): string[] {
  return briefing.guides.map((guide) =>
    joinText(
      guide.name,
      guide.guidance,
      guide.distanceMeters > 0 && formatDistance(guide.distanceMeters),
    ),
  );
}

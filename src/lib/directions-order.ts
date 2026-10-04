import { shouldCollapseWalk } from "./walk-collapse";

export type DirectionsModeKey = "transit" | "walk" | "car";

/**
 * 길찾기 결과 섹션 표시 순서(E11 spec 2026-08-12 §2 + E64, Kit Directions.swift·:kit Directions.kt 미러 —
 * 공유 fixture directions-order-scenarios.json이 동조 강제).
 *
 * 1. 성공 수단 앞, 비성공(경로 없음·조회 실패·미지원) 뒤 — 각 군 안은 입력 순서 유지.
 * 2. 도보와 대중교통이 둘 다 성공이면 시간을 비교해 빠른 쪽만 성공군 맨 앞(E64). 같으면 도보.
 *    자동차는 비교에 넣지 않는다.
 * 3. 대중교통 성공이 없으면 도보 성공이고 30분 이하(도보 상세 접기와 같은 경계)일 때 도보가 성공군 맨 앞.
 *
 * 비교는 화면에 표시되는 분 값으로 한다: 도보는 초를 반올림한 분(`WalkRouteBriefing`의 표시와 같다),
 * 대중교통은 섹션 첫 줄(대표 경로)의 `totalMinutes`. 초로 가르면 "약 25분"끼리 순서가 갈려 설명할 수 없다.
 *
 * ⚠ `transitMinutes`는 기본값 없는 인자다 — 생략이 통과하면 호출부 누락이 조용히 종전 규칙으로 돌아간다.
 * ⚠ 호출은 조회 settled 시점 1회뿐이다. 부분 재조회(계단 회피 토글·대중교통 수단 재조회)에서
 *   다시 부르면 사용자가 조작 중인 섹션이 발밑에서 이동한다(spec §2 규칙 3).
 */
export function orderDirectionsModes(
  modes: DirectionsModeKey[],
  isSuccess: Partial<Record<DirectionsModeKey, boolean>>,
  walkDurationSeconds: number | null,
  transitMinutes: number | null,
): DirectionsModeKey[] {
  const successes = modes.filter((m) => isSuccess[m] === true);
  const failures = modes.filter((m) => isSuccess[m] !== true);
  // 판정은 성공군 소속으로 본다(Kit 미러의 successes.contains(.walk)와 동일 판정 공간 —
  // isSuccess.walk만 보면 modes에 없는 도보를 승격하는 drift가 생긴다).
  const walk = successes.includes("walk") ? walkDurationSeconds : null;
  const transit = successes.includes("transit") ? transitMinutes : null;
  let lead: DirectionsModeKey | null = null;
  if (walk !== null && transit !== null) {
    lead = Math.round(walk / 60) <= transit ? "walk" : "transit";
  } else if (walk !== null && !shouldCollapseWalk(walk)) {
    lead = "walk";
  }
  const orderedSuccesses = lead
    ? [lead, ...successes.filter((m) => m !== lead)]
    : successes;
  return [...orderedSuccesses, ...failures];
}

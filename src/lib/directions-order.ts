import { shouldCollapseWalk } from "./walk-collapse";

export type DirectionsModeKey = "transit" | "walk" | "car";

/**
 * 길찾기 결과 섹션 표시 순서(spec 2026-08-12 §2, Kit Directions.swift 미러 —
 * 공유 fixture directions-order-scenarios.json이 동조 강제).
 *
 * 1. 성공 수단 앞, 비성공(경로 없음·조회 실패) 뒤 — 각 군 안은 입력 순서 유지.
 * 2. 도보 성공이고 30분 이하(도보 상세 접기와 같은 경계)면 성공군 맨 앞.
 *
 * ⚠ 호출은 조회 settled 시점 1회뿐이다. 부분 재조회(계단 회피 토글)에서
 *   다시 부르면 사용자가 조작 중인 섹션이 발밑에서 이동한다(spec §2 규칙 3).
 */
export function orderDirectionsModes(
  modes: DirectionsModeKey[],
  isSuccess: Partial<Record<DirectionsModeKey, boolean>>,
  walkDurationSeconds: number | null,
): DirectionsModeKey[] {
  const successes = modes.filter((m) => isSuccess[m] === true);
  const failures = modes.filter((m) => isSuccess[m] !== true);
  // 승격 판정은 성공군 소속으로 본다(Kit 미러의 successes.contains(.walk)와 동일
  // 판정 공간 — isSuccess.walk만 보면 modes에 없는 도보를 승격하는 drift가 생긴다).
  const promoteWalk =
    successes.includes("walk") &&
    walkDurationSeconds !== null &&
    !shouldCollapseWalk(walkDurationSeconds);
  const orderedSuccesses = promoteWalk
    ? ["walk" as const, ...successes.filter((m) => m !== "walk")]
    : successes;
  return [...orderedSuccesses, ...failures];
}

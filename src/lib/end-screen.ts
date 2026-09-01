/**
 * 안내 종료 화면(도착·중지 요약)의 수명 판정 — spec 2026-09-02 §3(A31 축 ②).
 *
 * 백그라운드에서 끝난 세션의 종료 화면은 정지 톤도 음성도 없이(설계대로) 화면 하나만 남고, 그 화면엔
 * 수명도 시각 표기도 없어 8시간 전 종료가 "방금 종료"로 읽혔다. 종료 뒤 이만큼 지나 **백그라운드를
 * 거쳐** 전경으로 돌아오면 화면과 미뤄진 종료 통지를 함께 버린다. 전경 체류 중엔 판정하지 않는다.
 *
 * Kit `EndScreen.swift` 미러, 공유 fixture `end-screen-stale-cases.json`. 웹은 종료 화면이 없어 소비자가
 * 없다(브라우저 탭은 백그라운드에서 멈춘다) — 판정 계층 동조 규칙 때문에 둔다.
 */

/** 종료 뒤 이만큼(초) 지났으면 소거. 앱 유휴 리셋(10분)보다 넉넉해 "잠깐 다른 앱" 사용을 자르지 않는다. */
export const END_SCREEN_STALE_S = 1800;

/**
 * 경과는 잠자기 중에도 전진하는 단조 시계로 잰다(iOS `ContinuousClock`) — systemUptime은 잠자기 동안
 * 멈춰 "주머니에 8시간"이 0분이 되고, 벽시계는 앞으로 교정되면 1분 된 새 화면을 30분 지난 것으로 읽는다.
 * 음수·NaN·무한은 소거하지 않는다(근거 없는 소거 금지).
 */
export function isEndScreenStale(secondsSinceEnd: number): boolean {
  return Number.isFinite(secondsSinceEnd) && secondsSinceEnd >= END_SCREEN_STALE_S;
}

/**
 * 시계 방향 체계(E62·E63 공유 경계 인터페이스, spec `2026-10-03-crosswalk-guidance-design.md` §2).
 * 순수 함수 — React·플랫폼 비의존. Kit `ClockDirection.swift` ↔ 안드로이드 `:kit` `ClockDirection.kt`
 * 미러이고 공유 fixture `clock-direction-cases.json`이 세 벌의 동조를 잠근다.
 *
 * 기준 방향은 호출자가 정한다: E62 횡단은 경로 좌표의 직전 진행 방향(서버), E63 이탈은 사용자의
 * 실제 진행 방위(클라이언트). 이 모듈은 각과 시만 다루고 낱말(진행 방향 그대로·뒤로)은 문장 계층 몫이다.
 */

/** 기준 방향에서 대상 방향까지 시계 방향으로 잰 각(0° 이상 360° 미만). 입력은 북 기준 방위(°). */
export function relativeBearing(referenceDeg: number, targetDeg: number): number {
  const r = (((targetDeg - referenceDeg) % 360) + 360) % 360;
  // 부동소수 나머지가 360을 돌려주는 경계(예: -1e-14 + 360)는 0으로 접는다.
  return r >= 360 ? 0 : r;
}

/**
 * 상대 방위를 30°로 반올림한 시(1~12, 0°는 12시). 반올림은 **0.5 올림**(`floor(x + 0.5)`)으로
 * 세 플랫폼을 맞춘다 — Kotlin `round`는 짝수 반올림이라 15°가 12시로 갈린다.
 */
export function clockHour(relativeDeg: number): number {
  const h = Math.floor(relativeDeg / 30 + 0.5) % 12;
  return h === 0 ? 12 : h;
}

/**
 * 거리·시간 표시 포맷 (deterministic 유틸 — React/Next 비의존).
 * 단위 기호(m, km)는 국제 공통이라 로케일 분기 없이 쓴다.
 */

/** 미터 → "850m" 또는 "3.6km" */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

/** 초 → 올림한 분 (최소 1분) — "약 N분" 문구의 N */
export function durationToMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

/**
 * 한 항목의 여러 정보 조각을 단일 문자열로 합친다 — 스크린 리더 "한 줄 = 한
 * 접근성 객체" 정본. 시각 목적 인라인 <span>(거리·부가정보·배지)으로 줄을
 * 쪼개면 VoiceOver가 조각마다 멈춰(가운뎃점까지 별도 객체) 한 항목 읽는 데
 * 여러 번 스와이프가 필요하다 — 그 분절을 코드에서 구조적으로 막는다.
 *
 * - falsy 조각(빈 문자열·null·undefined·false)은 버린다 — 선택 항목(급행·환승·
 *   현재위치)을 `cond && text`로 그대로 넘길 수 있다.
 * - 구분자는 쉼표+공백: 확실한 휴지를 주고 어떤 SR 발성 설정에서도 단어로
 *   낭독되지 않는다. 가운뎃점(·)은 일부 SR이 단어로 읽으므로 합친 텍스트에 쓰지 않는다.
 */
export function joinText(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter((p): p is string => Boolean(p)).join(", ");
}

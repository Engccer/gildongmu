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

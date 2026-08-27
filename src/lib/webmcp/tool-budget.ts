/**
 * 쿨다운·세션 예산(spec §5.5).
 *
 * 버킷은 upstream 키 단위다. `checkBudget`은 확인만 하고 소비하지 않으므로
 * (재직렬화·캐시 히트는 무과금), 실제 fetch를 일으키는 자리에서만 `consumeBudget`을 부른다.
 * 모듈 싱글턴이라 한 페이지 세션 안에서 도구 인스턴스가 여럿이어도 예산은 한 벌이다.
 */
export type BudgetBucket =
  | "search"
  | "plan"
  | "stationArrivals"
  | "stationTimetable"
  | "stationFacilities"
  | "barrierFree";

/** 마지막 소비 뒤 다음 소비까지 기다려야 하는 시간. */
const COOLDOWN_MS: Record<BudgetBucket, number> = {
  search: 3_000,
  plan: 3_000,
  stationArrivals: 10_000,
  stationTimetable: 60_000,
  stationFacilities: 60_000,
  barrierFree: 60_000,
};
const HOUR_MS = 3_600_000;
/** 버킷당 이동 창 1시간 안의 소비 상한. */
const PER_HOUR = 30;

/** 버킷별 소비 시각(오름차순). 창 밖으로 나간 항목은 check 시점에 정리한다. */
const stamps = new Map<BudgetBucket, number[]>();

export function checkBudget(
  bucket: BudgetBucket,
  now = Date.now(),
): { ok: true } | { ok: false; retryAfterMs: number } {
  const list = (stamps.get(bucket) ?? []).filter((t) => now - t < HOUR_MS);
  stamps.set(bucket, list);
  const last = list[list.length - 1];
  if (last !== undefined && now - last < COOLDOWN_MS[bucket]) {
    return { ok: false, retryAfterMs: COOLDOWN_MS[bucket] - (now - last) };
  }
  // 창이 찼으면 가장 오래된 소비가 창 밖으로 나가는 순간까지 기다린다.
  if (list.length >= PER_HOUR) return { ok: false, retryAfterMs: list[0] + HOUR_MS - now };
  return { ok: true };
}

export function consumeBudget(bucket: BudgetBucket, now = Date.now()): void {
  const list = stamps.get(bucket) ?? [];
  list.push(now);
  stamps.set(bucket, list);
}

export function __resetToolBudgetForTest(): void {
  stamps.clear();
}

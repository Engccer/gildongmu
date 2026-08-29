/**
 * 쿨다운·세션 예산(spec §5.5).
 *
 * 버킷은 upstream 키 단위다. `checkBudget`은 확인만 하고 소비하지 않으므로
 * (재직렬화·캐시 히트는 무과금), 실제 fetch를 일으키는 자리에서만 `consumeBudget`을 부른다.
 * 모듈 싱글턴이라 한 페이지 세션 안에서 도구 인스턴스가 여럿이어도 예산은 한 벌이다.
 *
 * ⚠ 버킷은 "도구 입력의 축"이 아니라 **실제 upstream** 단위다. 시설 축 하나가 코레일 시설과
 * 서울 도시철도 시설 두 upstream을 부르므로 버킷도 둘(`stationFacilities`·`stationFacilitiesMetro`)이다.
 * 둘을 한 버킷에 두면 첫 호출이 코레일을 소비한 직후 도시철도가 60초 쿨다운에 걸려 항상 `partial`이
 * 됐다(배포본 실측 2026-08-29, W2-B1). 대안이던 "축 단위 1회 소비"는 30회 상한 아래 실호출이 60회가
 * 되어 예산이 거짓이 되므로 기각했다.
 */
export type BudgetBucket =
  | "search"
  | "plan"
  | "stationArrivals"
  | "stationTimetable"
  | "stationFacilities"
  | "stationFacilitiesMetro"
  | "barrierFree";

/** 마지막 소비 뒤 다음 소비까지 기다려야 하는 시간. */
const COOLDOWN_MS: Record<BudgetBucket, number> = {
  search: 3_000,
  plan: 3_000,
  stationArrivals: 10_000,
  stationTimetable: 60_000,
  stationFacilities: 60_000,
  stationFacilitiesMetro: 60_000,
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
  const cooldownWait =
    last !== undefined && now - last < COOLDOWN_MS[bucket] ? COOLDOWN_MS[bucket] - (now - last) : 0;
  // 창이 찼으면 가장 오래된 소비가 창 밖으로 나가는 순간까지 기다린다. 쿨다운과 동시에 걸리면
  // 큰 쪽이 정직한 값이다(작은 쪽을 주면 에이전트가 2초 뒤 또 cooldown을 받는 왕복이 생긴다).
  const windowWait = list.length >= PER_HOUR ? list[0] + HOUR_MS - now : 0;
  const wait = Math.max(cooldownWait, windowWait);
  if (wait > 0) return { ok: false, retryAfterMs: wait };
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

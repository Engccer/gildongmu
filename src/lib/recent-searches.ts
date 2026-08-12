/**
 * 최근 검색 기록 저장(스펙 docs/superpowers/specs/2026-07-26-recent-searches-design.md,
 * 고정은 2026-08-12-recent-pinning-design.md).
 * 검색어(검색 탭)·장소(길찾기 endpoint)·경로(출발·도착 쌍) 기록, 기기 로컬(localStorage) 전용.
 * React/Next 비의존(dodo 이식성). 파싱 실패·storage 접근 불가는 빈 목록으로 조용히
 * 복구한다(기록은 부가 기능 — 본 기능을 막지 않는다).
 *
 * 고정(pin) 불변식: 저장 배열 = [고정 블록(고정 시점 순)] + [비고정 최신순, cap 20].
 * dedupe 판정은 pinned를 보지 않는다(같은 항목의 고정본·비고정본 공존 금지).
 * 반환·저장 항목의 pinned는 항상 명시적 boolean으로 정규화된다.
 */

export type RecentQuery = { text: string; pinned: boolean };
export type RecentEndpoint = { label: string; lat: number; lng: number; pinned?: boolean };

/** 길찾기 필드 스코프 — 출발지·도착지 기록은 분리 저장한다(위원장 지시 2026-07-26). */
export type RecentEndpointField = "from" | "to";

export const RECENT_CAP = 20;
const QUERIES_KEY_V1 = "gildongmu:recent-queries:v1";
const QUERIES_KEY_V2 = "gildongmu:recent-queries:v2";
const endpointsKey = (field: RecentEndpointField) =>
  `gildongmu:recent-endpoints-${field}:v1`;

/** SSR·프라이버시 모드(접근 throw) 가드. 실패는 null → 모든 연산이 빈 목록/no-op. */
function defaultStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function load<T>(
  storage: Storage | null,
  key: string,
  isValid: (v: unknown) => v is T,
): T[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValid) : [];
  } catch {
    return [];
  }
}

function save<T>(storage: Storage | null, key: string, items: T[]): T[] {
  if (!storage) return [];
  try {
    storage.setItem(key, JSON.stringify(items));
  } catch {
    // quota 초과 등 — 기록 실패는 무시(메모리 상 목록은 반환돼 UI는 일관)
  }
  return items;
}

// ── 고정 공용 코어(세 목록 공유) ────────────────────────────────────

const isPinnedFlag = (v: unknown): boolean => v === undefined || typeof v === "boolean";

const asPinned = (x: { pinned?: boolean }) => x.pinned === true;

/** 불변식 정규화: [고정(저장 순서 유지)] + [비고정(저장 순서 유지)] + 명시적 boolean.
 *  쓰기가 불변식을 유지하므로 레거시·수기 데이터 방어용이다. */
function partitionPinned<T extends { pinned?: boolean }>(items: T[]): T[] {
  const norm = items.map((x) => ({ ...x, pinned: asPinned(x) }));
  return [...norm.filter(asPinned), ...norm.filter((x) => !asPinned(x))];
}

/** 재기록: 같은 고정 항목이 있으면 자리 유지(최신본으로 교체 — 장소 라벨 갱신),
 *  아니면 비고정 dup 제거 후 고정 블록 바로 뒤 삽입, 비고정만 cap. */
function appendKeepingPins<T extends { pinned?: boolean }>(
  items: T[],
  item: T,
  isSame: (a: T, b: T) => boolean,
): T[] {
  const pinnedIdx = items.findIndex((x) => asPinned(x) && isSame(x, item));
  if (pinnedIdx >= 0) {
    const next = [...items];
    next[pinnedIdx] = { ...item, pinned: true };
    return next;
  }
  const pins = items.filter(asPinned);
  const rest = items.filter((x) => !asPinned(x) && !isSame(x, item));
  return [...pins, ...[{ ...item, pinned: false }, ...rest].slice(0, RECENT_CAP)];
}

/** 고정 토글: 어느 방향이든 물리 위치는 두 블록의 경계(고정 = 고정 블록 맨 뒤,
 *  해제 = 비고정 블록 맨 앞 — 같은 자리다). 없는 항목은 no-op. */
function setPinnedIn<T extends { pinned?: boolean }>(
  items: T[],
  item: T,
  pinned: boolean,
  isSame: (a: T, b: T) => boolean,
): T[] {
  const idx = items.findIndex((x) => isSame(x, item));
  if (idx < 0) return items;
  const rest = items.filter((_, i) => i !== idx);
  return [
    ...rest.filter(asPinned),
    { ...items[idx], pinned },
    ...rest.filter((x) => !asPinned(x)),
  ];
}

/** 모두 지우기: 고정만 보존한다(고정의 존재 이유 — 위원장 확정 2026-08-12). */
const keepPins = <T extends { pinned?: boolean }>(items: T[]) => items.filter(asPinned);

// ── 검색어 ──────────────────────────────────────────────────────────

const isQueryItem = (v: unknown): v is RecentQuery =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as RecentQuery).text === "string" &&
  isPinnedFlag((v as RecentQuery).pinned);

const sameQuery = (a: RecentQuery, b: RecentQuery) => a.text === b.text;

export function loadRecentQueries(
  storage: Storage | null = defaultStorage(),
): RecentQuery[] {
  // ⚠ "빈 v2"와 "v2 부재"를 구분한다 — 길이로 가르면 모두 지운 직후 v1이 부활한다.
  if (hasKey(storage, QUERIES_KEY_V2)) {
    return partitionPinned(load(storage, QUERIES_KEY_V2, isQueryItem));
  }
  // v1(문자열 배열) 승계 — v1은 지우지 않는다(롤백 안전, 부가 기능이라 이중 보관 무해).
  const v1 = load(storage, QUERIES_KEY_V1, (v): v is string => typeof v === "string");
  return v1.map((text) => ({ text, pinned: false }));
}

function hasKey(storage: Storage | null, key: string): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export function recordRecentQuery(
  raw: string,
  storage: Storage | null = defaultStorage(),
): RecentQuery[] {
  const text = raw.trim();
  const items = loadRecentQueries(storage);
  if (!text) return items;
  return save(
    storage,
    QUERIES_KEY_V2,
    appendKeepingPins(items, { text, pinned: false }, sameQuery),
  );
}

export function removeRecentQuery(
  text: string,
  storage: Storage | null = defaultStorage(),
): RecentQuery[] {
  return save(
    storage,
    QUERIES_KEY_V2,
    loadRecentQueries(storage).filter((x) => x.text !== text),
  );
}

export function clearRecentQueries(
  storage: Storage | null = defaultStorage(),
): RecentQuery[] {
  return save(storage, QUERIES_KEY_V2, keepPins(loadRecentQueries(storage)));
}

export function setRecentQueryPinned(
  text: string,
  pinned: boolean,
  storage: Storage | null = defaultStorage(),
): RecentQuery[] {
  return save(
    storage,
    QUERIES_KEY_V2,
    setPinnedIn(loadRecentQueries(storage), { text, pinned }, pinned, sameQuery),
  );
}

// ── 장소 (길찾기 endpoint) ──────────────────────────────────────────

const isEndpoint = (v: unknown): v is RecentEndpoint =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as RecentEndpoint).label === "string" &&
  typeof (v as RecentEndpoint).lat === "number" &&
  typeof (v as RecentEndpoint).lng === "number" &&
  Number.isFinite((v as RecentEndpoint).lat) &&
  Number.isFinite((v as RecentEndpoint).lng) &&
  isPinnedFlag((v as RecentEndpoint).pinned);

/** 좌표 소수 4자리(≈11m) 일치 = 같은 장소. 라벨 변형은 최신 라벨로 교체된다. */
function sameEndpoint(a: RecentEndpoint, b: RecentEndpoint): boolean {
  return a.lat.toFixed(4) === b.lat.toFixed(4) && a.lng.toFixed(4) === b.lng.toFixed(4);
}

export function loadRecentEndpoints(
  field: RecentEndpointField,
  storage: Storage | null = defaultStorage(),
): RecentEndpoint[] {
  return partitionPinned(load(storage, endpointsKey(field), isEndpoint));
}

export function recordRecentEndpoint(
  field: RecentEndpointField,
  e: RecentEndpoint,
  storage: Storage | null = defaultStorage(),
): RecentEndpoint[] {
  return save(
    storage,
    endpointsKey(field),
    appendKeepingPins(loadRecentEndpoints(field, storage), e, sameEndpoint),
  );
}

export function removeRecentEndpoint(
  field: RecentEndpointField,
  e: RecentEndpoint,
  storage: Storage | null = defaultStorage(),
): RecentEndpoint[] {
  return save(
    storage,
    endpointsKey(field),
    loadRecentEndpoints(field, storage).filter((x) => !sameEndpoint(x, e)),
  );
}

export function clearRecentEndpoints(
  field: RecentEndpointField,
  storage: Storage | null = defaultStorage(),
): RecentEndpoint[] {
  return save(storage, endpointsKey(field), keepPins(loadRecentEndpoints(field, storage)));
}

export function setRecentEndpointPinned(
  field: RecentEndpointField,
  e: RecentEndpoint,
  pinned: boolean,
  storage: Storage | null = defaultStorage(),
): RecentEndpoint[] {
  return save(
    storage,
    endpointsKey(field),
    setPinnedIn(loadRecentEndpoints(field, storage), e, pinned, sameEndpoint),
  );
}

// ── 경로 (길찾기 출발·도착 쌍, 스펙 2026-08-10) ──────────────────────

/** null = "현재 위치"(활성화 시점에 재측위 — 좌표를 굳히지 않는다).
 *  side의 pinned는 무의미하다 — 경로의 고정은 경로 자체의 pinned(스펙 2026-08-12 §2). */
export type RecentRoute = {
  from: RecentEndpoint | null;
  to: RecentEndpoint | null;
  pinned?: boolean;
};

const ROUTES_KEY = "gildongmu:recent-routes:v1";

const isRouteSide = (v: unknown): v is RecentEndpoint | null => v === null || isEndpoint(v);

const isRoute = (v: unknown): v is RecentRoute =>
  typeof v === "object" && v !== null &&
  isRouteSide((v as RecentRoute).from) && isRouteSide((v as RecentRoute).to) &&
  isPinnedFlag((v as RecentRoute).pinned);

function sameSide(a: RecentEndpoint | null, b: RecentEndpoint | null): boolean {
  if (a === null || b === null) return a === b;
  return sameEndpoint(a, b);
}

/** 쌍 단위 동일 판정: from 동일 ∧ to 동일(현재 위치끼리도 동일). pinned 무관. */
function sameRoute(a: RecentRoute, b: RecentRoute): boolean {
  return sameSide(a.from, b.from) && sameSide(a.to, b.to);
}

export function loadRecentRoutes(storage: Storage | null = defaultStorage()): RecentRoute[] {
  return partitionPinned(load(storage, ROUTES_KEY, isRoute));
}

export function recordRecentRoute(
  route: RecentRoute,
  storage: Storage | null = defaultStorage(),
): RecentRoute[] {
  // 양측 현재 위치는 자기 자리→자기 자리라 재조회 의미가 없다(스펙 §1.1).
  if (!route.from && !route.to) return loadRecentRoutes(storage);
  return save(
    storage,
    ROUTES_KEY,
    appendKeepingPins(loadRecentRoutes(storage), route, sameRoute),
  );
}

export function removeRecentRoute(
  route: RecentRoute,
  storage: Storage | null = defaultStorage(),
): RecentRoute[] {
  return save(storage, ROUTES_KEY, loadRecentRoutes(storage).filter((x) => !sameRoute(x, route)));
}

export function clearRecentRoutes(storage: Storage | null = defaultStorage()): RecentRoute[] {
  return save(storage, ROUTES_KEY, keepPins(loadRecentRoutes(storage)));
}

export function setRecentRoutePinned(
  route: RecentRoute,
  pinned: boolean,
  storage: Storage | null = defaultStorage(),
): RecentRoute[] {
  return save(storage, ROUTES_KEY, setPinnedIn(loadRecentRoutes(storage), route, pinned, sameRoute));
}

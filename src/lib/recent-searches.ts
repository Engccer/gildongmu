/**
 * 최근 검색 기록 저장(스펙 docs/superpowers/specs/2026-07-26-recent-searches-design.md).
 * 검색어(검색 탭)·장소(길찾기 endpoint) 이원 기록, 기기 로컬(localStorage) 전용.
 * React/Next 비의존(dodo 이식성). 파싱 실패·storage 접근 불가는 빈 목록으로 조용히
 * 복구한다(기록은 부가 기능 — 본 기능을 막지 않는다).
 */

export type RecentEndpoint = { label: string; lat: number; lng: number };

/** 길찾기 필드 스코프 — 출발지·도착지 기록은 분리 저장한다(위원장 지시 2026-07-26). */
export type RecentEndpointField = "from" | "to";

export const RECENT_CAP = 20;
const QUERIES_KEY = "gildongmu:recent-queries:v1";
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

/** 순수 코어: 중복 제거 후 맨 앞 삽입, cap 절단(iOS RecentSearchStore.append 미러). */
function appendRecent<T>(items: T[], item: T, isSame: (a: T, b: T) => boolean): T[] {
  return [item, ...items.filter((x) => !isSame(x, item))].slice(0, RECENT_CAP);
}

// ── 검색어 ──────────────────────────────────────────────────────────

const isQuery = (v: unknown): v is string => typeof v === "string";

export function loadRecentQueries(storage: Storage | null = defaultStorage()): string[] {
  return load(storage, QUERIES_KEY, isQuery);
}

export function recordRecentQuery(
  raw: string,
  storage: Storage | null = defaultStorage(),
): string[] {
  const q = raw.trim();
  const items = loadRecentQueries(storage);
  if (!q) return items;
  return save(storage, QUERIES_KEY, appendRecent(items, q, (a, b) => a === b));
}

export function removeRecentQuery(
  q: string,
  storage: Storage | null = defaultStorage(),
): string[] {
  return save(
    storage,
    QUERIES_KEY,
    loadRecentQueries(storage).filter((x) => x !== q),
  );
}

export function clearRecentQueries(
  storage: Storage | null = defaultStorage(),
): string[] {
  return save(storage, QUERIES_KEY, []);
}

// ── 장소 (길찾기 endpoint) ──────────────────────────────────────────

const isEndpoint = (v: unknown): v is RecentEndpoint =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as RecentEndpoint).label === "string" &&
  typeof (v as RecentEndpoint).lat === "number" &&
  typeof (v as RecentEndpoint).lng === "number" &&
  Number.isFinite((v as RecentEndpoint).lat) &&
  Number.isFinite((v as RecentEndpoint).lng);

/** 좌표 소수 4자리(≈11m) 일치 = 같은 장소. 라벨 변형은 최신 라벨로 교체된다. */
function sameEndpoint(a: RecentEndpoint, b: RecentEndpoint): boolean {
  return a.lat.toFixed(4) === b.lat.toFixed(4) && a.lng.toFixed(4) === b.lng.toFixed(4);
}

export function loadRecentEndpoints(
  field: RecentEndpointField,
  storage: Storage | null = defaultStorage(),
): RecentEndpoint[] {
  return load(storage, endpointsKey(field), isEndpoint);
}

export function recordRecentEndpoint(
  field: RecentEndpointField,
  e: RecentEndpoint,
  storage: Storage | null = defaultStorage(),
): RecentEndpoint[] {
  return save(
    storage,
    endpointsKey(field),
    appendRecent(loadRecentEndpoints(field, storage), e, sameEndpoint),
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
  return save(storage, endpointsKey(field), []);
}

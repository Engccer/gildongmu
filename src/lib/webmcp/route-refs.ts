/**
 * `routeKey ↔ routeRef` 표(W2 spec 2026-08-29 §4). `ref`는 `routeKey`가 아니라 **그 계획 안
 * 경로의 0-based 순번을 base36으로 적은 내부 토큰**이다 — 도구 출력에 외부 문자열(경로 키·
 * 장소명)을 그대로 싣지 않는다. 한 계획(`planId`)의 경로 목록 순서(추천 → 대안)로 만들며
 * 같은 계획 안에서만 유효하다 — 재조회 뒤에는 새 표다.
 */

export type ModeKey = "transit" | "walk" | "car";

export interface RouteRefTable {
  refOf: (routeKey: string) => string | null;
  keyOf: (routeRef: string) => string | null;
  size: number;
}

export function buildRouteRefTable(routeKeys: readonly string[]): RouteRefTable {
  const refByKey = new Map<string, string>();
  const keyByRef = new Map<string, string>();
  routeKeys.forEach((key, index) => {
    const ref = index.toString(36);
    refByKey.set(key, ref);
    keyByRef.set(ref, key);
  });
  return {
    refOf: (key) => refByKey.get(key) ?? null,
    keyOf: (ref) => keyByRef.get(ref) ?? null,
    size: routeKeys.length,
  };
}

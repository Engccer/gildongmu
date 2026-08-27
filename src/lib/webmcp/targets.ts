/**
 * 착지 대상 ID 체계(spec §3.3) — `focus_item`이 커서를 옮길 자리의 이름.
 *
 * 안정 ID다(DOM 인덱스가 아니다). 두 범위:
 * - 뷰 범위: `field:from` · `field:to` · `field:via` · `control:submit` · `guidance:panel`
 * - 계획 범위(`planId` 필수): `mode:{transit|walk|car}` · `transit:route:{ref}` ·
 *   `transit:leg:{ref}:{n}` · `walk:step:{n}` · `car:step:{n}` (n은 화면 번호, 1-based)
 *
 * `ref`는 `routeKey`가 아니라 **그 계획 안 경로의 0-based 순번을 base36으로 적은 내부
 * 토큰**이다. DOM 속성·CSS 선택자에 외부 문자열(경로 키·장소명)을 넣지 않는다(spec 리뷰 #22).
 */

/** 착지 요소에 붙는 속성. 값은 `TARGET_ID_RE`만 허용한다. */
export const FOCUS_TARGET_ATTR = "data-focus-target";
/** 안내 시작 트리거 버튼에 붙는 속성(`start_guidance`가 화면 버튼 핸들러를 부르는 길). */
export const GUIDE_TRIGGER_ATTR = "data-guide-trigger";

export const TARGET_ID_RE = /^[a-z0-9:._-]+$/;

export type ModeKey = "transit" | "walk" | "car";

export type ParsedTarget =
  | { scope: "view"; kind: "field"; field: "from" | "to" | "via" }
  | { scope: "view"; kind: "control"; control: "submit" }
  | { scope: "view"; kind: "guidance" }
  | { scope: "plan"; kind: "mode"; mode: ModeKey }
  | { scope: "plan"; kind: "transitRoute"; routeRef: string }
  | { scope: "plan"; kind: "transitLeg"; routeRef: string; n: number }
  | { scope: "plan"; kind: "step"; mode: "walk" | "car"; n: number };

export function isValidTargetId(id: string): boolean {
  return TARGET_ID_RE.test(id);
}

export function parseTargetId(id: string): ParsedTarget | null {
  if (!isValidTargetId(id)) return null;
  const parts = id.split(":");
  if (parts[0] === "field" && parts.length === 2) {
    if (parts[1] === "from" || parts[1] === "to" || parts[1] === "via") {
      return { scope: "view", kind: "field", field: parts[1] };
    }
    return null;
  }
  if (id === "control:submit") return { scope: "view", kind: "control", control: "submit" };
  if (id === "guidance:panel") return { scope: "view", kind: "guidance" };
  if (parts[0] === "mode" && parts.length === 2) {
    if (parts[1] === "transit" || parts[1] === "walk" || parts[1] === "car") {
      return { scope: "plan", kind: "mode", mode: parts[1] };
    }
    return null;
  }
  if (parts[0] === "transit" && parts[1] === "route" && parts.length === 3 && parts[2]) {
    return { scope: "plan", kind: "transitRoute", routeRef: parts[2] };
  }
  if (parts[0] === "transit" && parts[1] === "leg" && parts.length === 4 && parts[2]) {
    const n = Number(parts[3]);
    if (!Number.isInteger(n) || n < 1) return null;
    return { scope: "plan", kind: "transitLeg", routeRef: parts[2], n };
  }
  if ((parts[0] === "walk" || parts[0] === "car") && parts[1] === "step" && parts.length === 3) {
    const n = Number(parts[2]);
    if (!Number.isInteger(n) || n < 1) return null;
    return { scope: "plan", kind: "step", mode: parts[0], n };
  }
  return null;
}

export const targetId = {
  field: (field: "from" | "to" | "via") => `field:${field}`,
  submit: () => "control:submit",
  guidancePanel: () => "guidance:panel",
  mode: (mode: ModeKey) => `mode:${mode}`,
  transitRoute: (routeRef: string) => `transit:route:${routeRef}`,
  transitLeg: (routeRef: string, n: number) => `transit:leg:${routeRef}:${n}`,
  step: (mode: "walk" | "car", n: number) => `${mode}:step:${n}`,
};

/** 계획 범위 대상인가(`planId`가 필요한가). */
export function isPlanScoped(parsed: ParsedTarget): boolean {
  return parsed.scope === "plan";
}

/**
 * `routeKey ↔ routeRef` 표(spec §3.3). 한 계획(`planId`)의 경로 목록 순서(추천 → 대안)로
 * 만든다. 같은 계획 안에서만 유효하다 — 재조회 뒤에는 새 표다.
 */
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

/** 착지 요소 선택자. 값은 허용 문자만 통과하므로 escape는 방어적 이중 안전망이다. */
export function focusTargetSelector(id: string): string | null {
  if (!isValidTargetId(id)) return null;
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(id)
      : id.replace(/[^a-z0-9_-]/g, (c) => `\\${c}`);
  return `[${FOCUS_TARGET_ATTR}="${escaped}"]`;
}

export function guideTriggerSelector(value: string): string | null {
  if (!isValidTargetId(value)) return null;
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(value)
      : value.replace(/[^a-z0-9_-]/g, (c) => `\\${c}`);
  return `[${GUIDE_TRIGGER_ATTR}="${escaped}"]`;
}

import type { WalkLineKind } from "./types";

/**
 * 도보 줄 종류(E42)의 클라이언트 투영 — 이름 키·안내 시작 버튼 키·안내 요청 축.
 * 판정(어느 줄이 어느 종류인가)은 서버 `getWalkRouteLines`가 한다. 여기는 투영만 한다.
 *
 * 모르는 종류(서버가 새 값을 더했을 때)는 null — 이름을 지어 붙이지 않고 그 줄을 뺀다.
 */
const NAME_KEY = {
  shortest: "walkShortest",
  accessible: "walkAccessible",
  broad: "walkBroad",
  recommended: "walkRecommended",
} as const satisfies Record<WalkLineKind, string>;

const START_KEY = {
  shortest: "guideStartWalkShortest",
  accessible: "guideStartWalkAccessible",
  broad: "guideStartWalkBroad",
  recommended: "guideStartWalkRecommended",
} as const satisfies Record<WalkLineKind, string>;

function isKnown(kind: string): kind is WalkLineKind {
  return Object.hasOwn(NAME_KEY, kind);
}

/** `directions` 네임스페이스의 줄 이름 키. */
export function walkLineNameKey(kind: string): (typeof NAME_KEY)[WalkLineKind] | null {
  return isKnown(kind) ? NAME_KEY[kind] : null;
}

/** `beacon` 네임스페이스의 안내 시작 버튼 키("○○ 경로로 안내 시작"). */
export function walkLineStartKey(kind: string): (typeof START_KEY)[WalkLineKind] | null {
  return isKnown(kind) ? START_KEY[kind] : null;
}

/**
 * 줄의 안내 요청 축: 최단 → `variant=shortest`, 계단 회피 → `accessible=true`, 큰길·추천 → 둘 다
 * 꺼짐(기본 파이프라인 — ko 카카오 `BROAD_FIRST`, en Tmap 추천).
 */
export function walkLineAxis(kind: WalkLineKind): {
  accessible: boolean;
  variant: "shortest" | null;
} {
  return {
    accessible: kind === "accessible",
    variant: kind === "shortest" ? "shortest" : null,
  };
}

import { joinText } from "./format";
import type { TransitRoute } from "./types";

/**
 * 대안 경로의 표시 이름 조각(spec `2026-09-24-transit-alternatives-reasoned-design.md` §4.1).
 * 서버가 준 축(`highlight`)을 문구 키로 옮기기만 한다. 판정은 전부 서버가 끝냈다.
 *
 * 조합마다 키를 만들지 않고 **축 하나에 조각 하나**를 조립 순서로 내고, 표시 계층이 쉼표(`joinText`)로
 * 잇는다 — 한 줄 = 한 접근성 객체, 가운뎃점·사유 문장 금지. `fastest`+`fewestTransfers`만 기존 조합
 * 키 하나로 쓴다(기존 문구 보존). 아는 축이 없으면 옛 앱과 같은 번호 이름(`displayIndex`).
 *
 * ⚠ 대안 disclosure는 길찾기 뷰(DirectionsView)와 채팅 카드(TransitRouteBriefing) 두 곳에 있다. 이 함수를
 *   공유하지 않으면 두 화면의 이름이 갈린다. Kit `TransitAlternativeName.swift`·`:kit`
 *   `TransitAlternativeName.kt`가 공유 fixture `transit-alternative-name-cases.json`으로 같은 표를 잠근다.
 */
const AXIS_KEYS = [
  ["fastest", "alternativeFastest"],
  ["fewestTransfers", "alternativeFewestTransfers"],
  ["leastWalk", "alternativeLeastWalk"],
  ["busOnly", "alternativeBusOnly"],
  ["subwayOnly", "alternativeSubwayOnly"],
] as const;

export function alternativeNameParts(
  route: Pick<TransitRoute, "highlight" | "displayIndex">,
): Array<{ key: string; values: Record<string, string | number> }> {
  const axes = new Set<string>(route.highlight ?? []);
  let keys: string[] = AXIS_KEYS.filter(([axis]) => axes.has(axis)).map(([, key]) => key);
  if (axes.has("fastest") && axes.has("fewestTransfers")) {
    keys = ["alternativeFastestFewestTransfers", ...keys.filter((k) => k !== "alternativeFastest" && k !== "alternativeFewestTransfers")];
  }
  if (keys.length === 0) return [{ key: "alternativeHeading", values: { index: route.displayIndex ?? 1 } }];
  return keys.map((key) => ({ key, values: {} }));
}

/** 조각을 번역해 쉼표로 이은 이름 한 줄(`t`는 `route.transit` 네임스페이스 번역기). */
export function alternativeName(
  route: Pick<TransitRoute, "highlight" | "displayIndex">,
  t: (key: string, values: Record<string, string | number>) => string,
): string {
  return joinText(...alternativeNameParts(route).map((p) => t(p.key, p.values)));
}

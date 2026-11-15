/**
 * 한 답의 `route-start` 렌더를 도착지별로 묶는다(E83 spec `2026-11-14-e83-chat-route-start-design.md` R1·§6) — React 비의존 순수 함수.
 * iOS Kit의 묶기 함수와 같은 규칙이다:
 * - 도착지 좌표(lat·lng)가 **정확히 같은** 렌더가 한 묶음이다(같은 답 안의 도구들은 같은 장소 검색 첫 결과를 쓴다).
 * - 묶음 순서는 그 도착지가 처음 나온 순서, 같은 수단이 둘이면 첫 것만 쓴다.
 * - 도착지 이름·로마자는 묶음의 첫 렌더 것이다.
 * - [길찾기에서 열기]가 싣는 경유지는 버튼 순서(도보, 자동차)로 처음 만나는 `via`다.
 */
import type { RenderPayload, RouteStartRenderPayload } from "./types";

export interface RouteStartGroup {
  dest: { lat: number; lng: number };
  destLabel: string;
  destRoman: string | null;
  walk: RouteStartRenderPayload | null;
  car: RouteStartRenderPayload | null;
  transit: RouteStartRenderPayload | null;
  /** 이 묶음의 첫 렌더가 답의 렌더 목록에서 차지한 자리 — 카드를 그 자리에 그린다. */
  firstIndex: number;
}

export function groupRouteStartRenders(renders: readonly RenderPayload[]): RouteStartGroup[] {
  const groups: RouteStartGroup[] = [];
  renders.forEach((render, index) => {
    if (render.type !== "route-start") return;
    let group = groups.find((g) => g.dest.lat === render.dest.lat && g.dest.lng === render.dest.lng);
    if (!group) {
      group = {
        dest: render.dest,
        destLabel: render.destLabel,
        destRoman: render.destRoman,
        walk: null,
        car: null,
        transit: null,
        firstIndex: index,
      };
      groups.push(group);
    }
    if (group[render.mode] === null) group[render.mode] = render;
  });
  return groups;
}

/** [길찾기에서 열기]가 실어 넘기는 경유지 — 도보, 자동차 순으로 처음 만나는 것(대중교통은 경유지가 없다). */
export function routeStartOpenVia(group: RouteStartGroup): RouteStartRenderPayload["via"] {
  return group.walk?.via ?? group.car?.via ?? null;
}

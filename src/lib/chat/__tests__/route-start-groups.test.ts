// E83 R1·§6 — 한 답의 `route-start` 렌더를 도착지별로 묶는 규칙(iOS Kit과 같은 규칙).
import { describe, expect, it } from "vitest";
import type { RenderPayload, RouteStartMode, RouteStartRenderPayload } from "../types";
import { groupRouteStartRenders, routeStartOpenVia } from "../route-start-groups";
import { carGuideStartable, transitGuideStartable } from "@/lib/guide-startable";
import type { TransitRoute } from "@/lib/types";

const GANGNAM = { lat: 37.4979, lng: 127.0276 };
const SEOUL_STATION = { lat: 37.5547, lng: 126.9707 };

function start(mode: RouteStartMode, over: Partial<RouteStartRenderPayload> = {}): RouteStartRenderPayload {
  return {
    type: "route-start",
    mode,
    dest: GANGNAM,
    destLabel: "강남역",
    destRoman: null,
    via: null,
    accessible: false,
    carProvider: mode === "car" ? "tmap" : null,
    transit: null,
    ...over,
  };
}

describe("groupRouteStartRenders", () => {
  it("route-start가 없으면 빈 목록이다", () => {
    const renders: RenderPayload[] = [{ type: "air-quality", lat: 1, lng: 2 } as RenderPayload];
    expect(groupRouteStartRenders(renders)).toEqual([]);
    expect(groupRouteStartRenders([])).toEqual([]);
  });

  it("같은 도착지의 세 수단은 한 묶음이고, 묶음의 자리는 첫 렌더의 자리다", () => {
    const other = { type: "air-quality", lat: 1, lng: 2 } as RenderPayload;
    const walk = start("walk");
    const car = start("car");
    const transit = start("transit");
    const groups = groupRouteStartRenders([other, transit, walk, car]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ dest: GANGNAM, destLabel: "강남역", destRoman: null, firstIndex: 1 });
    expect(groups[0].walk).toBe(walk);
    expect(groups[0].car).toBe(car);
    expect(groups[0].transit).toBe(transit);
  });

  it("도착지가 다르면 다른 묶음이고, 순서는 처음 나온 순서다", () => {
    const groups = groupRouteStartRenders([
      start("walk", { dest: SEOUL_STATION, destLabel: "서울역" }),
      start("walk"),
      start("car", { dest: SEOUL_STATION, destLabel: "서울역" }),
    ]);
    expect(groups.map((g) => [g.destLabel, g.firstIndex])).toEqual([
      ["서울역", 0],
      ["강남역", 1],
    ]);
    expect(groups[0].car).not.toBeNull();
    expect(groups[1].car).toBeNull();
  });

  it("좌표가 정확히 같아야 한 묶음이다(가까운 좌표는 다른 도착지다)", () => {
    const near = { lat: GANGNAM.lat + 0.00001, lng: GANGNAM.lng };
    expect(groupRouteStartRenders([start("walk"), start("car", { dest: near })])).toHaveLength(2);
  });

  it("같은 수단이 둘이면 첫 것만 쓰고, 이름·로마자는 묶음의 첫 렌더 것이다", () => {
    const first = start("walk", { destLabel: "강남역", destRoman: "Gangnam Station" });
    const second = start("walk", { destLabel: "강남", accessible: true });
    const [group] = groupRouteStartRenders([first, second]);
    expect(group.walk).toBe(first);
    expect(group.destLabel).toBe("강남역");
    expect(group.destRoman).toBe("Gangnam Station");
  });
});

describe("routeStartOpenVia — [길찾기에서 열기]가 싣는 경유지", () => {
  const viaA = { lat: 37.51, lng: 127.0, label: "편의점" };
  const viaB = { lat: 37.52, lng: 127.01, label: "주유소" };

  it("도보, 자동차 순으로 처음 만나는 경유지다", () => {
    const [both] = groupRouteStartRenders([start("car", { via: viaB }), start("walk", { via: viaA })]);
    expect(routeStartOpenVia(both)).toEqual(viaA);
    const [carOnly] = groupRouteStartRenders([start("walk"), start("car", { via: viaB })]);
    expect(routeStartOpenVia(carOnly)).toEqual(viaB);
  });

  it("경유지가 없으면 null이다", () => {
    const [group] = groupRouteStartRenders([start("walk"), start("transit")]);
    expect(routeStartOpenVia(group)).toBeNull();
  });
});

describe("guide-startable — 길찾기 화면과 카드가 나눠 쓰는 시작 판정", () => {
  it("자동차는 Tmap ∧ 한국어 데이터 ∧ 경유지 없음일 때만 시작할 수 있다", () => {
    expect(carGuideStartable({ provider: "tmap", english: false, hasVia: false })).toBe(true);
    expect(carGuideStartable({ provider: "kakao", english: false, hasVia: false })).toBe(false);
    expect(carGuideStartable({ provider: null, english: false, hasVia: false })).toBe(false);
    expect(carGuideStartable({ provider: undefined, english: false, hasVia: false })).toBe(false);
    expect(carGuideStartable({ provider: "tmap", english: true, hasVia: false })).toBe(false);
    expect(carGuideStartable({ provider: "tmap", english: false, hasVia: true })).toBe(false);
  });

  it("대중교통은 탑승 구간이 있는 경로만 시작할 수 있다", () => {
    const ride = { routeKey: "r0", legs: [{ mode: "subway", minutes: 10, lineName: "2호선", fromName: "시청", toName: "강남" }] };
    const walkOnly = { routeKey: "r1", legs: [{ mode: "walk", minutes: 10 }] };
    expect(transitGuideStartable(ride as unknown as TransitRoute)).toBe(true);
    expect(transitGuideStartable(walkOnly as unknown as TransitRoute)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { mergeBusStops } from "../bus";
import type { BusStop } from "../types";

function stop(p: Partial<BusStop>): BusStop {
  return {
    nodeId: "n",
    cityCode: "c",
    name: "정류소",
    lat: 37.5,
    lng: 127.1,
    distanceMeters: 0,
    arrivalStatus: "ok",
    arrivals: [],
    source: "tago",
    ...p,
  };
}

describe("mergeBusStops", () => {
  it("좌표 4자리 중복은 거리 가까운 쪽만 남긴다", () => {
    const a = stop({ source: "tago", lat: 37.5385, lng: 127.1378, distanceMeters: 120 });
    const b = stop({ source: "seoul", lat: 37.53851, lng: 127.13782, distanceMeters: 40 });
    const merged = mergeBusStops([a], [b]);
    expect(merged.length).toBe(1);
    expect(merged[0].source).toBe("seoul"); // 더 가까운 쪽
  });
  it("서로 다른 좌표는 모두 남기고 거리순 정렬·상위 5 cap", () => {
    const tago = [stop({ source: "tago", lat: 37.5, lng: 127.1, distanceMeters: 300 })];
    const seoul = Array.from({ length: 6 }, (_, i) =>
      stop({ source: "seoul", lat: 37.6 + i * 0.001, lng: 127.2, distanceMeters: 100 + i }),
    );
    const merged = mergeBusStops(tago, seoul);
    expect(merged.length).toBe(5); // 상위 5 cap
    expect(merged[0].distanceMeters).toBe(100); // 거리순
  });
});

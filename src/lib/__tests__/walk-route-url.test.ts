import { describe, expect, it } from "vitest";
import { walkRouteUrl } from "../walk-route-url";

const ORIGIN = { lat: 37.5, lng: 127.1 };
const DEST = { lat: 37.6, lng: 127.2 };

describe("walkRouteUrl", () => {
  it("lang=ko는 파라미터를 붙이지 않고 en만 붙인다(기존 캐시 키 유지)", () => {
    expect(
      walkRouteUrl({ origin: ORIGIN, dest: DEST, accessible: false, includeGeometry: false, via: null, lang: "en", variant: null }),
    ).toContain("&lang=en");
    expect(
      walkRouteUrl({ origin: ORIGIN, dest: DEST, accessible: false, includeGeometry: false, via: null, lang: "ko", variant: null }),
    ).not.toContain("lang=");
  });

  it("기본: 좌표만 붙인다(옵트인 파라미터 부재 = 기존 캐시 경로 유지)", () => {
    expect(
      walkRouteUrl({ origin: ORIGIN, dest: DEST, accessible: false, includeGeometry: false, via: null, lang: "ko", variant: null }),
    ).toBe("/api/route/walk?origin=37.5,127.1&dest=37.6,127.2");
  });

  it("계단 회피만", () => {
    expect(
      walkRouteUrl({ origin: ORIGIN, dest: DEST, accessible: true, includeGeometry: false, via: null, lang: "ko", variant: null }),
    ).toBe("/api/route/walk?origin=37.5,127.1&dest=37.6,127.2&accessible=true");
  });

  it("기하만", () => {
    expect(
      walkRouteUrl({ origin: ORIGIN, dest: DEST, accessible: false, includeGeometry: true, via: null, lang: "ko", variant: null }),
    ).toBe("/api/route/walk?origin=37.5,127.1&dest=37.6,127.2&includeGeometry=1");
  });

  it("둘 다 — A4 수정 이전에는 존재하지 않던 조합이다", () => {
    expect(
      walkRouteUrl({ origin: ORIGIN, dest: DEST, accessible: true, includeGeometry: true, via: null, lang: "ko", variant: null }),
    ).toBe("/api/route/walk?origin=37.5,127.1&dest=37.6,127.2&accessible=true&includeGeometry=1");
  });

  it("경유지(N4): via는 '&via=lat,lng', null이면 부재(현행 URL 불변)", () => {
    expect(
      walkRouteUrl({ origin: ORIGIN, dest: DEST, accessible: false, includeGeometry: false, via: { lat: 37.55, lng: 127.15 }, lang: "ko", variant: null }),
    ).toBe("/api/route/walk?origin=37.5,127.1&dest=37.6,127.2&via=37.55,127.15");
    expect(
      walkRouteUrl({ origin: ORIGIN, dest: DEST, accessible: true, includeGeometry: true, via: null, lang: "ko", variant: null }),
    ).toBe("/api/route/walk?origin=37.5,127.1&dest=37.6,127.2&accessible=true&includeGeometry=1");
  });

  it("최단 줄의 안내(E42): variant=shortest를 기하 뒤에 붙인다", () => {
    expect(
      walkRouteUrl({ origin: ORIGIN, dest: DEST, accessible: false, includeGeometry: true, via: null, lang: "ko", variant: "shortest" }),
    ).toBe("/api/route/walk?origin=37.5,127.1&dest=37.6,127.2&includeGeometry=1&variant=shortest");
  });
});

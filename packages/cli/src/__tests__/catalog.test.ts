import { describe, it, expect } from "vitest";
import { ENDPOINT_CATALOG } from "../lib/endpoint-catalog-shared.js";

describe("endpoint catalog", () => {
  it("이름 중복 없음", () => {
    const names = ENDPOINT_CATALOG.map(e => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
  it("locationParam 항목은 lat/lng 필수 파라미터를 가진다", () => {
    for (const e of ENDPOINT_CATALOG.filter(e => e.locationParam)) {
      expect(e.params.filter(p => (p.key === "lat" || p.key === "lng") && p.required)).toHaveLength(2);
    }
  });
  it("mcp 제외는 web-search뿐(챗은 카탈로그 밖)", () => {
    expect(ENDPOINT_CATALOG.filter(e => !e.mcp).map(e => e.name)).toEqual(["web-search"]);
  });
  it("route-car만 envelope 빈 문자열(래퍼 없는 응답)", () => {
    expect(ENDPOINT_CATALOG.filter(e => e.envelope === "").map(e => e.name)).toEqual(["route-car"]);
  });
});

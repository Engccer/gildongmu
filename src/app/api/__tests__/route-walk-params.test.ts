import { describe, expect, it } from "vitest";
import { parseWalkQuery } from "../route/walk/route-schema";

const base = {
  origin: "37.5,127.1",
  dest: "37.51,127.11",
  accessible: null,
  includeGeometry: null,
  variant: null,
  alternatives: null,
  via: null,
};

describe("walk 파라미터 조합표 (M3 spec §3.1)", () => {
  it("기본(옵트인 전무)은 허용", () => {
    const r = parseWalkQuery(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.variant).toBeUndefined();
      expect(r.data.alternatives).toBe(false);
    }
  });

  it("variant+alternatives 동시 지정은 거부", () => {
    expect(parseWalkQuery({ ...base, variant: "shortest", alternatives: "1" }).ok).toBe(false);
  });

  it("alternatives+includeGeometry는 거부", () => {
    expect(parseWalkQuery({ ...base, alternatives: "1", includeGeometry: "1" }).ok).toBe(false);
  });

  it("variant=shortest+includeGeometry=1 허용", () => {
    expect(parseWalkQuery({ ...base, variant: "shortest", includeGeometry: "1" }).ok).toBe(true);
  });

  it("variant=shortest+accessible=true 허용", () => {
    const r = parseWalkQuery({ ...base, variant: "shortest", accessible: "true" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.accessible).toBe(true);
  });

  it("variant 오값은 거부", () => {
    expect(parseWalkQuery({ ...base, variant: "fastest" }).ok).toBe(false);
  });

  it("alternatives 오값은 거부(정확히 '1'만 — 조용한 무시 금지)", () => {
    expect(parseWalkQuery({ ...base, alternatives: "true" }).ok).toBe(false);
  });

  it("alternatives=1 단독 허용", () => {
    const r = parseWalkQuery({ ...base, alternatives: "1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.alternatives).toBe(true);
  });

  it("alternatives=1+accessible=true 허용(両경로 계단 회피 축 전달)", () => {
    expect(parseWalkQuery({ ...base, alternatives: "1", accessible: "true" }).ok).toBe(true);
  });

  it("좌표 오형식은 거부(기존 계약 유지)", () => {
    expect(parseWalkQuery({ ...base, origin: "" }).ok).toBe(false);
  });

  describe("via 경유지(N4 spec §2.1)", () => {
    it("누락이면 undefined(옵트인 키 부재)", () => {
      const r = parseWalkQuery(base);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.via).toBeUndefined();
    });

    it("'위도,경도'를 좌표로 파싱한다", () => {
      const r = parseWalkQuery({ ...base, via: "37.5353,127.1323" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.via).toEqual({ lat: 37.5353, lng: 127.1323 });
    });

    it("형식 오류는 거부(조용한 무시 금지 — 경유 안 한 경로를 경유한 경로로 낭독하게 된다)", () => {
      expect(parseWalkQuery({ ...base, via: "강동역" }).ok).toBe(false);
      expect(parseWalkQuery({ ...base, via: "" }).ok).toBe(false);
    });

    it("variant·alternatives·accessible과 직교한다", () => {
      expect(parseWalkQuery({ ...base, via: "37.5,127.1", variant: "shortest" }).ok).toBe(true);
      expect(parseWalkQuery({ ...base, via: "37.5,127.1", alternatives: "1" }).ok).toBe(true);
      expect(parseWalkQuery({ ...base, via: "37.5,127.1", accessible: "true" }).ok).toBe(true);
    });
  });
});

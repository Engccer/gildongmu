import { describe, expect, it } from "vitest";
import { parseWalkQuery } from "../route/walk/route-schema";

const base = {
  origin: "37.5,127.1",
  dest: "37.51,127.11",
  accessible: null,
  includeGeometry: null,
  variant: null,
  alternatives: null,
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
});

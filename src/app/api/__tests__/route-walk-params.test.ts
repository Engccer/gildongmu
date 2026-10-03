import { describe, expect, it } from "vitest";
import { parseWalkQuery } from "../route/walk/route-schema";

const base = {
  origin: "37.5,127.1",
  dest: "37.51,127.11",
  accessible: null,
  includeGeometry: null,
  variant: null,
  alternatives: null,
  lines: null,
  via: null,
  lang: null,
  wording: null,
  crossingRoad: null,
};

describe("walk 파라미터 조합표 (M3 spec §3.1)", () => {
  describe("lang (E16 축3)", () => {
    it("누락이면 ko(기존 소비자 동작 불변)", () => {
      const r = parseWalkQuery(base);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.lang).toBe("ko");
    });

    it("ko·en만 받는다", () => {
      for (const lang of ["ko", "en"]) {
        const r = parseWalkQuery({ ...base, lang });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.data.lang).toBe(lang);
      }
    });

    it("알 수 없는 값은 400 — 조용히 ko로 강등하지 않는다", () => {
      expect(parseWalkQuery({ ...base, lang: "ja" }).ok).toBe(false);
      expect(parseWalkQuery({ ...base, lang: "EN" }).ok).toBe(false);
    });
  });

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

  describe("lines (E42·E52 판본)", () => {
    it("정확히 1·2만 받고 판본 번호로 바꾼다(1 = 최대 두 줄, 2 = 최대 세 줄), 누락은 옵트인 없음", () => {
      const one = parseWalkQuery({ ...base, lines: "1" });
      const two = parseWalkQuery({ ...base, lines: "2" });
      expect(one.ok && one.data.lines).toBe(1);
      expect(two.ok && two.data.lines).toBe(2);
      const none = parseWalkQuery(base);
      expect(none.ok && none.data.lines).toBeUndefined();
      for (const v of ["true", "3", "0", "2.0"]) expect(parseWalkQuery({ ...base, lines: v }).ok).toBe(false);
    });

    it("판본 2도 단독 옵트인 — accessible=true와 조합하면 400", () => {
      expect(parseWalkQuery({ ...base, lines: "2", accessible: "true" }).ok).toBe(false);
      expect(parseWalkQuery({ ...base, lines: "2", variant: "shortest" }).ok).toBe(false);
    });

    it("단독 옵트인 — variant·alternatives·includeGeometry·accessible=true와 조합하면 400", () => {
      expect(parseWalkQuery({ ...base, lines: "1", variant: "shortest" }).ok).toBe(false);
      expect(parseWalkQuery({ ...base, lines: "1", alternatives: "1" }).ok).toBe(false);
      expect(parseWalkQuery({ ...base, lines: "1", includeGeometry: "1" }).ok).toBe(false);
      expect(parseWalkQuery({ ...base, lines: "1", accessible: "true" }).ok).toBe(false);
    });

    it("via·lang·accessible=false와는 조합된다", () => {
      expect(parseWalkQuery({ ...base, lines: "1", via: "37.505,127.105", lang: "en" }).ok).toBe(true);
      expect(parseWalkQuery({ ...base, lines: "1", accessible: "false" }).ok).toBe(true);
    });
  });

  describe("wording·crossingRoad(E62 판본 2)", () => {
    it("누락은 판본 1, 정확히 \"2\"만 판본 2 — 그 밖은 400", () => {
      const none = parseWalkQuery(base);
      expect(none.ok && none.data.wording).toBe(1);
      const v2 = parseWalkQuery({ ...base, wording: "2" });
      expect(v2.ok && v2.data.wording).toBe(2);
      expect(parseWalkQuery({ ...base, wording: "1" }).ok).toBe(false);
      expect(parseWalkQuery({ ...base, wording: "3" }).ok).toBe(false);
    });

    it("crossingRoad는 판본 2에서만 — 판본 1에 붙이면 조용히 무시하지 않고 400", () => {
      const ok = parseWalkQuery({ ...base, wording: "2", crossingRoad: "1", includeGeometry: "1" });
      expect(ok.ok && ok.data.crossingRoad).toBe(true);
      expect(parseWalkQuery({ ...base, crossingRoad: "1" }).ok).toBe(false);
      expect(parseWalkQuery({ ...base, wording: "2", crossingRoad: "true" }).ok).toBe(false);
    });

    it("옛 조회 화면용 alternatives는 판본 2와 조합하지 않는다(400), 줄 목록·기하 조회와는 조합된다", () => {
      expect(parseWalkQuery({ ...base, wording: "2", alternatives: "1" }).ok).toBe(false);
      expect(parseWalkQuery({ ...base, wording: "2", lines: "2" }).ok).toBe(true);
      expect(parseWalkQuery({ ...base, wording: "2", includeGeometry: "1", variant: "shortest" }).ok).toBe(true);
    });
  });
});

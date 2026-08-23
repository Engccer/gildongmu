import { describe, expect, it } from "vitest";
import {
  composeOverview as composeOverviewRaw,
  overviewNearestCap,
  OVERVIEW_RADIUS_M,
  type OverviewInput,
} from "../nearby-overview";

// M4 "한눈에 보기" 집계의 3-state 계약(spec 2026-08-22-nearby-tab-restructure §3.1·§6).
// 조각별 독립: rejected → failed, 빈 배열 → none, null(키 없음) → 불릿 부재.

const ORIGIN = { lat: 37.5385, lng: 127.143 };
const ok = <T>(value: T): PromiseSettledResult<T> => ({ status: "fulfilled", value });
const fail = <T>(): PromiseSettledResult<T> => ({ status: "rejected", reason: new Error("upstream") });

function place(name: string, dLat: number, dLng: number, distanceMeters: number) {
  return { name, lat: ORIGIN.lat + dLat, lng: ORIGIN.lng + dLng, distanceMeters };
}

/** 기존 단언은 overview 모양만 본다 — 투영은 아래 전용 describe. */
const composeOverview = (input: OverviewInput) => composeOverviewRaw(input).overview;

function base(overrides: Partial<OverviewInput> = {}): OverviewInput {
  return {
    ...ORIGIN,
    address: null,
    region: null,
    station: null,
    bus: null,
    busUncovered: false,
    food: null,
    cafe: null,
    kids: null,
    events: null,
    barrierFree: null,
    ...overrides,
  };
}

describe("composeOverview — 불릿별 3-state", () => {
  it("키 없는 조각(null)은 불릿 자체가 없고 순서는 고정이다", () => {
    const o = composeOverview(base({ cafe: ok({ places: [], capped: false }), barrierFree: ok([]) }));
    expect(o.radiusMeters).toBe(OVERVIEW_RADIUS_M);
    expect(o.bullets.map((b) => b.kind)).toEqual(["transit", "cafe", "barrierFree"]);
    const all = composeOverview(
      base({
        food: ok({ places: [], capped: false }),
        cafe: ok({ places: [], capped: false }),
        kids: ok([]),
        events: ok({ events: [], total: 0 }),
        barrierFree: ok([]),
      }),
    );
    expect(all.bullets.map((b) => b.kind)).toEqual([
      "transit",
      "food",
      "cafe",
      "kids",
      "events",
      "barrierFree",
    ]);
  });

  it("rejected는 failed이지 none이 아니다", () => {
    const o = composeOverview(base({ kids: fail() }));
    const kids = o.bullets.find((b) => b.kind === "kids");
    expect(kids?.state).toBe("failed");
  });

  it("빈 배열은 none", () => {
    const o = composeOverview(base({ kids: ok([]) }));
    expect(o.bullets.find((b) => b.kind === "kids")?.state).toBe("none");
  });

  it("ok: count·countCapped·nearest(거리순, 계단식 캡, 8방위)", () => {
    const thirty = Array.from({ length: 30 }, (_, i) =>
      place(`p${i}`, i === 0 ? 0.0005 : -0.001, 0, 500 - i),
    );
    const o = composeOverview(
      base({
        // 상류 캡(15)에 닿은 종은 확정 수가 아니라 "이상"(fetchCategory).
        food: ok({ places: thirty.slice(0, 18), capped: true }),
        cafe: ok({ places: thirty.slice(0, 3), capped: false }),
        kids: ok([place("k", 0.0005, 0, 50), ...thirty.slice(1, 3)]),
      }),
    );
    const food = o.bullets.find((b) => b.kind === "food");
    expect(food).toMatchObject({ state: "ok", count: 18, countCapped: true });
    if (food?.state !== "ok" || food.kind === "transit") throw new Error("type");
    // 18곳 → 캡 4
    expect(food.nearest).toHaveLength(overviewNearestCap(18));
    expect(food.nearest.map((n) => n.name)).toEqual(["p17", "p16", "p15", "p14"]);
    expect(food.nearest[0].bearing).toBe("s");
    expect(o.bullets.find((b) => b.kind === "cafe")).toMatchObject({
      state: "ok",
      count: 3,
      countCapped: false,
    });
    const kids = o.bullets.find((b) => b.kind === "kids");
    expect(kids).toMatchObject({ state: "ok", count: 3, countCapped: false });
    if (kids?.state !== "ok" || kids.kind === "transit") throw new Error("type");
    expect(kids.nearest[0].bearing).toBe("n");
  });

  it("events: 서울 밖은 unavailable(seoulOnly), 안이면 total", () => {
    const out = composeOverview(base({ events: "unavailable" }));
    expect(out.bullets.find((b) => b.kind === "events")).toEqual({
      kind: "events",
      state: "unavailable",
      reason: "seoulOnly",
    });
    const ev = place("행사", 0.001, 0, 120);
    const inside = composeOverview(base({ events: ok({ events: [ev], total: 7 }) }));
    expect(inside.bullets.find((b) => b.kind === "events")).toMatchObject({
      state: "ok",
      count: 7,
      countCapped: false,
    });
  });

  it("transit: 역 seed + 버스 4-state", () => {
    const station = {
      name: "길동",
      lineName: "5호선",
      lat: ORIGIN.lat + 0.002,
      lng: ORIGIN.lng + 0.002,
      distanceMeters: 262,
    };
    const stop = { ...place("길동사거리", 0, 0.001, 80) };
    const both = composeOverview(base({ station, bus: ok([stop]) }));
    expect(both.bullets[0]).toMatchObject({
      kind: "transit",
      state: "ok",
      station: { name: "길동", line: "5호선", bearing: "ne", distanceMeters: 262 },
      busStops: { state: "ok", count: 1, nearest: [{ name: "길동사거리", bearing: "e" }] },
    });
    expect(composeOverview(base({ bus: ok([]), busUncovered: true })).bullets[0]).toMatchObject({
      station: null,
      busStops: { state: "uncovered" },
    });
    expect(composeOverview(base({ bus: ok([]) })).bullets[0]).toMatchObject({
      busStops: { state: "none" },
    });
    expect(composeOverview(base({ bus: fail() })).bullets[0]).toMatchObject({
      busStops: { state: "failed" },
    });
    expect(composeOverview(base()).bullets[0]).toMatchObject({ busStops: null });
  });

  it("place: 행정동 + 도로명(시·구 접두 중복 제거), 둘 다 없으면 null", () => {
    const o = composeOverview(
      base({
        region: "서울특별시 강동구 길동",
        address: { road: "서울특별시 강동구 천중로44길 74", jibun: null },
      }),
    );
    expect(o.place).toBe("서울특별시 강동구 길동, 천중로44길 74");
    expect(composeOverview(base()).place).toBeNull();
  });
});

describe("overviewNearestCap — 개수에 비례하는 명명 수(spec 2026-08-24 §2.1)", () => {
  it("1~4곳 2, 5~9곳 3, 10곳 이상 4", () => {
    expect([1, 2, 4, 5, 9, 10, 45].map(overviewNearestCap)).toEqual([2, 2, 2, 3, 3, 4, 4]);
  });
  it("3곳이면 2곳만 부른다(종전 고정 2와 같다)", () => {
    const o = composeOverview(base({ cafe: ok({ places: [place("a", 0, 0, 1), place("b", 0, 0, 2), place("c", 0, 0, 3)], capped: false }) }));
    const cafe = o.bullets.find((b) => b.kind === "cafe");
    if (cafe?.state !== "ok" || cafe.kind === "transit") throw new Error("type");
    expect(cafe.nearest.map((n) => n.name)).toEqual(["a", "b"]);
  });
  it("행사는 total이 캡의 근거다(받은 배열 길이가 아니라)", () => {
    const evs = Array.from({ length: 6 }, (_, i) => place(`e${i}`, 0, 0, i));
    const o = composeOverview(base({ events: ok({ events: evs, total: 12 }) }));
    const ev = o.bullets.find((b) => b.kind === "events");
    if (ev?.state !== "ok" || ev.kind === "transit") throw new Error("type");
    expect(ev.nearest).toHaveLength(4);
  });
});

describe("composeOverview — 장소 투영(places)", () => {
  const P = (id: string, name: string, d: number) => ({
    ...place(name, 0, 0, d),
    projected: { id, name, category: "c", address: "", roadAddress: "", lat: ORIGIN.lat, lng: ORIGIN.lng },
  });
  it("불릿 순서 → 거리순, 캡 안 항목만, 투영 없는 조각(행사)은 제외", () => {
    const { places } = composeOverviewRaw(
      base({
        cafe: ok({ places: [P("c2", "카페2", 20), P("c1", "카페1", 10), P("c3", "카페3", 30)], capped: false }),
        food: ok({ places: [P("f1", "식당1", 5)], capped: false }),
        events: ok({ events: [place("행사", 0, 0, 1)], total: 1 }),
      }),
    );
    expect(places.map((p) => p.id)).toEqual(["f1", "c1", "c2"]);
  });
  it("식당·카페 교집합은 id로 dedupe(첫 등장 유지)", () => {
    const { places } = composeOverviewRaw(
      base({
        food: ok({ places: [P("x", "겸업", 5)], capped: false }),
        cafe: ok({ places: [P("x", "겸업", 5), P("c", "카페", 9)], capped: false }),
      }),
    );
    expect(places.map((p) => p.id)).toEqual(["x", "c"]);
  });
  it("투영이 하나도 없으면 빈 배열", () => {
    expect(composeOverviewRaw(base()).places).toEqual([]);
  });
});

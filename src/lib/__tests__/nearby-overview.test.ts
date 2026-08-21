import { describe, expect, it } from "vitest";
import {
  composeOverview,
  OVERVIEW_NEAREST_CAP,
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

function base(overrides: Partial<OverviewInput> = {}): OverviewInput {
  return {
    ...ORIGIN,
    address: null,
    region: null,
    station: null,
    bus: null,
    busUncovered: false,
    food: null,
    kids: null,
    events: null,
    barrierFree: null,
    ...overrides,
  };
}

describe("composeOverview — 불릿별 3-state", () => {
  it("키 없는 조각(null)은 불릿 자체가 없고 순서는 고정이다", () => {
    const o = composeOverview(base({ food: ok({ places: [], capped: false }), barrierFree: ok([]) }));
    expect(o.radiusMeters).toBe(OVERVIEW_RADIUS_M);
    expect(o.bullets.map((b) => b.kind)).toEqual(["transit", "food", "barrierFree"]);
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

  it("ok: count·countCapped·nearest(거리순 상위 2, 8방위)", () => {
    const thirty = Array.from({ length: 30 }, (_, i) =>
      place(`p${i}`, i === 0 ? 0.0005 : -0.001, 0, 500 - i),
    );
    const o = composeOverview(
      base({
        // 한 종만 캡(15)에 걸려 합계가 18이어도 capped — 판정은 종별 raw 건수(fetchFoodAndCafes).
        food: ok({ places: thirty.slice(0, 18), capped: true }),
        kids: ok([place("k", 0.0005, 0, 50), ...thirty.slice(1, 3)]),
      }),
    );
    const food = o.bullets.find((b) => b.kind === "food");
    expect(food).toMatchObject({ state: "ok", count: 18, countCapped: true });
    if (food?.state !== "ok" || food.kind === "transit") throw new Error("type");
    expect(food.nearest).toHaveLength(OVERVIEW_NEAREST_CAP);
    expect(food.nearest.map((n) => n.name)).toEqual(["p17", "p16"]);
    expect(food.nearest[0].bearing).toBe("s");
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

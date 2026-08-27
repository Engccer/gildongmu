import { describe, expect, it } from "vitest";
import { assertNoCoordinates, capOutput, finish, measure, OUTPUT_LIMIT, serialize, withFailure } from "../output";
import { failure } from "../types";
import { SHAPE as PLAN_SHAPE, summarizePlan } from "../tools/plan-directions";
import { SHAPE as DETAIL_SHAPE } from "../tools/get-transit-route-detail";
import { SHAPE as STEPS_SHAPE } from "../tools/get-route-steps";
import { SHAPE as VIEW_SHAPE } from "../tools/read-current-view";
import { buildRouteRefTable } from "../route-refs";
import type { ToolPlan } from "../tools/context";

/**
 * 프로덕션 실측(2026-08-27) `/api/route/transit` 3,706자를 본뜬 fixture — 추천 1 + 대안 4,
 * 정거장 목록·좌표까지 실은 원본 모양. 도구 요약은 이것을 항목 단위로만 줄여야 한다.
 */
function transitFixture(): Record<string, unknown> {
  const stops = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      name: `정거장${i + 1}`,
      stationId: String(1000 + i),
      lat: 37.5 + i * 0.001,
      lng: 127.0 + i * 0.001,
    }));
  const route = (i: number) => ({
    routeKey: `r${i}`,
    summary: { totalMinutes: 40 + i, fare: 1500 + i * 100, transfers: i % 3, walkMinutes: 10 + i },
    legs: [
      { mode: "walk", toName: "강동역", distanceMeters: 320, minutes: 5 },
      { mode: "subway", lineName: "수도권 5호선", fromName: "강동역", toName: "광화문역", stationCount: 12, minutes: 25, stops: stops(13) },
      { mode: "walk", distanceMeters: 210, minutes: 4 },
    ],
    highlight: i === 1 ? ["fastest"] : undefined,
    displayIndex: i >= 2 ? i - 1 : undefined,
  });
  return { result: { recommended: route(0), alternatives: [route(1), route(2), route(3), route(4)] } };
}

function planFromFixture(): ToolPlan {
  const fx = transitFixture().result as { recommended: { routeKey: string }; alternatives: Array<{ routeKey: string }> };
  const keys = [fx.recommended.routeKey, ...fx.alternatives.map((a) => a.routeKey)];
  const routeRefs = buildRouteRefTable(keys);
  const legLines = [
    "강동역까지 걸어서 이동, 5분, 320m",
    "강동역에서 수도권 5호선 승차, 12 정거장",
    "목적지까지 걸어서 이동, 4분, 210m",
  ];
  const routes = keys.map((routeKey, i) => ({
    routeKey,
    routeRef: routeRefs.refOf(routeKey) ?? "0",
    name: i === 0 ? "추천 경로" : `대안 ${i}`,
    oneLine: `${i === 0 ? "추천 경로" : `대안 ${i}`}, 총 ${40 + i}분, ${1500 + i * 100}원, 환승 ${i % 3}회, 도보 ${10 + i}분 포함`,
    highlight: i === 1 ? ["fastest"] : undefined,
    startable: true,
    summary: { totalMinutes: 40 + i, transfers: i % 3, fare: 1500 + i * 100, walkMinutes: 10 + i },
    legLines,
    legs: legLines.map((line, n) => ({ n: n + 1, mode: "walk" as const, toName: line })),
  }));
  return {
    planId: "p3",
    destination: "광화문",
    resolved: { from: "현재 위치", to: "광화문", via: null, avoidStairs: false },
    routeRefs,
    transit: { outcome: "done", routes },
    walk: { outcome: "done", summary: "약 2.1km, 31분", distanceMeters: 2100, durationSeconds: 1860, steps: ["a", "b", "c"], startable: true },
    car: { outcome: "done", summary: "약 3km, 12분", distanceMeters: 3000, durationSeconds: 720, steps: ["x", "y"], startable: false },
    modes: ["transit", "walk", "car"],
  };
}

const COORD_RE = /\d{2,3}\.\d{4,}/;

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

describe("serialize — allowlist", () => {
  it("표에 없는 키·좌표는 이름과 무관하게 나가지 않는다", () => {
    const out = serialize(
      { ok: true, name: "x", lat: 37.5, lng: 127.0, coord: { lat: 1, lng: 2 }, nested: { keep: 1, geometry: [[1, 2]] } },
      { ok: true, name: true, nested: { keep: true } },
    ) as Record<string, unknown>;
    expect(out).toEqual({ ok: true, name: "x", nested: { keep: 1 } });
  });
  it("원시값 자리에 객체가 오면 버린다(좌표 객체가 primitive 표를 통과하지 못한다)", () => {
    expect(serialize({ a: { lat: 1 } }, { a: true })).toEqual({});
  });
  it("배열은 항목 모양으로 걸러 이어붙인다", () => {
    expect(serialize({ items: [{ id: "a", lat: 1 }, { id: "b" }] }, { items: [{ id: true }] })).toEqual({
      items: [{ id: "a" }, { id: "b" }],
    });
  });
});

describe("capOutput — 항목 단위 상한(문자열 무손상)", () => {
  it("3,706자급 원본은 표만으로 이미 상한 안에 들어온다(요약 도구가 정거장 목록을 싣지 않는다)", () => {
    const raw = transitFixture();
    expect(measure(raw)).toBeGreaterThan(3500);
    const plan = planFromFixture();
    const text = finish(summarizePlan(plan), PLAN_SHAPE, {
      arrays: [
        { path: "transit.alternatives", mode: "count" },
        { path: "transit.recommended.legLines", mode: "count" },
      ],
    });
    expect(text.length).toBeLessThanOrEqual(OUTPUT_LIMIT);
    const out = JSON.parse(text);
    expect(out.transit.alternatives).toHaveLength(4);
    expect(out.truncated).toBeUndefined();
    expect(collectStrings(out).some((s) => COORD_RE.test(s))).toBe(false);
  });

  it("넘치면 계획 순서대로 배열 끝에서 통째로 빼고 truncated·카운트를 싣는다 — 문자열은 원본과 동일", () => {
    const plan = planFromFixture();
    // 대안을 20개로 불려 상한을 넘긴다.
    const alts = Array.from({ length: 20 }, (_, i) => ({
      routeKey: `alt${i}`,
      oneLine: `대안 ${i}, 총 ${50 + i}분, ${1600 + i * 50}원, 환승 1회, 도보 12분 포함 — 긴 라벨 문장으로 상한을 넘기기 위한 채움`,
      highlight: i % 2 ? ["fewestTransfers"] : undefined,
    }));
    const summary = summarizePlan(plan) as Record<string, unknown>;
    (summary.transit as Record<string, unknown>).alternatives = alts;
    const serialized = serialize(summary, PLAN_SHAPE) as Record<string, unknown>;
    const before = JSON.parse(JSON.stringify(serialized));
    const capped = capOutput(serialized, {
      arrays: [
        { path: "transit.alternatives", mode: "count" },
        { path: "transit.recommended.legLines", mode: "count" },
      ],
    }) as Record<string, unknown>;
    expect(capped.ok).toBe(true);
    expect(measure(capped)).toBeLessThanOrEqual(OUTPUT_LIMIT);
    expect(capped.truncated).toBe(true);
    // alternatives가 줄었다(legLines는 손대지 않았다).
    const transit = capped.transit as Record<string, unknown>;
    const remaining = transit.alternatives as unknown[];
    expect(remaining.length).toBeLessThan(20);
    expect(transit.alternativesReturnedCount).toBe(remaining.length);
    expect(transit.alternativesTotalCount).toBe(20);
    expect((transit.recommended as { legLines: string[] }).legLines).toHaveLength(3);
    // 남은 항목은 원본의 접두가 아니라 **동일**하다.
    const beforeAlts = (before.transit as { alternatives: unknown[] }).alternatives;
    remaining.forEach((item, i) => expect(item).toEqual(beforeAlts[i]));
    const beforeStrings = new Set(collectStrings(before));
    collectStrings(capped).forEach((s) => {
      if (["true", "false"].includes(s)) return;
      // 카운트 필드는 숫자라 문자열 집합에 없다 — 문자열은 전부 원본에 있던 것이어야 한다.
      expect(beforeStrings.has(s)).toBe(true);
    });
  });

  it("페이지형은 nextOffset을 당긴다", () => {
    const steps = Array.from({ length: 20 }, (_, i) => ({
      n: i + 1,
      text: `${i + 1}번째 안내 문장입니다. 도로명을 따라 이동한 뒤 횡단보도를 건너세요, 3차로, 도로 폭 12m`,
    }));
    const out = capOutput(
      serialize({ ok: true, planId: "p1", mode: "walk", outcome: "done", total: 40, offset: 10, returnedCount: 20, nextOffset: 30, steps }, STEPS_SHAPE) as Record<string, unknown>,
      { arrays: [{ path: "steps", mode: "page" }] },
    ) as Record<string, unknown>;
    expect(out.truncated).toBe(true);
    const kept = (out.steps as unknown[]).length;
    expect(kept).toBeLessThan(20);
    expect(out.returnedCount).toBe(kept);
    expect(out.nextOffset).toBe(10 + kept);
    expect(measure(out)).toBeLessThanOrEqual(OUTPUT_LIMIT);
  });

  it("배열을 다 비워도 넘기면 itemTooLarge 실패다(문자열을 자르지 않는다)", () => {
    const huge = "가".repeat(2000);
    const out = capOutput({ ok: true, label: huge, items: ["x"] }, { arrays: [{ path: "items", mode: "count" }] }) as Record<string, unknown>;
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("unsupported");
    expect(out.detail).toBe("itemTooLarge");
  });
});

describe("길찾기 도구 4개의 출력 표", () => {
  const shapes = { PLAN_SHAPE, DETAIL_SHAPE, STEPS_SHAPE, VIEW_SHAPE };
  const COORD_KEYS = /^(lat|lng|latitude|longitude|coord|coords|geometry|pathCoords|x|y|mapx|mapy)$/i;
  function keysOf(shape: unknown, out: string[] = []): string[] {
    if (Array.isArray(shape)) return keysOf(shape[0], out);
    if (shape && typeof shape === "object") {
      for (const [k, v] of Object.entries(shape)) {
        out.push(k);
        keysOf(v, out);
      }
    }
    return out;
  }
  it("좌표성 키가 어느 표에도 없다(spec §4.5)", () => {
    for (const [name, shape] of Object.entries(shapes)) {
      const bad = keysOf(shape).filter((k) => COORD_KEYS.test(k));
      expect(bad, name).toEqual([]);
    }
  });
  it("실패 표의 공통 키를 전부 포함한다", () => {
    const failureKeys = Object.keys(withFailure({}));
    for (const [name, shape] of Object.entries(shapes)) {
      for (const k of failureKeys) expect(Object.keys(shape), `${name}.${k}`).toContain(k);
    }
  });
});

describe("W2 사유 코드·좌표 스캔", () => {
  it("새 사유 6종의 플래그", () => {
    expect(failure("staleResult")).toMatchObject({ retryable: true, userActionRequired: false });
    expect(failure("notConfigured")).toMatchObject({ retryable: false, userActionRequired: false });
    expect(failure("notApplicable")).toMatchObject({ retryable: false, userActionRequired: false });
    expect(failure("viewChanging")).toMatchObject({ retryable: true, userActionRequired: false });
    expect(failure("geocodeFailed")).toMatchObject({ retryable: true, userActionRequired: false });
    expect(failure("modalOpen")).toMatchObject({ retryable: false, userActionRequired: true });
  });
  it("직렬화 결과에서 좌표 쿼리 이름·십진 좌표쌍·숫자 2원소 배열을 잡는다", () => {
    expect(assertNoCoordinates('{"url":"https://a.b/p?lat=37.5"}')).not.toBeNull();
    expect(assertNoCoordinates('{"line":"37.5231,127.1234"}')).not.toBeNull();
    expect(assertNoCoordinates('{"p":[37.5231,127.1234]}')).not.toBeNull();
    expect(assertNoCoordinates('{"url":"https://a.b/place/37.52,127.12"}')).not.toBeNull();
    expect(assertNoCoordinates('{"pos":{"lat":37.5,"lng":127.1}}')).toBe("coordinate key");
    expect(assertNoCoordinates('{"line":"5호선 상행 첫차 05:30, 막차 00:12","n":[1,2]}')).toBeNull();
  });
});

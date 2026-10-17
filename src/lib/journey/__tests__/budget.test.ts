import { describe, expect, it } from "vitest";
import type { Coord } from "../../types";
import { JOURNEY_CALL_CAP, planTaxiCalls } from "../budget";

const to: Coord = { lat: 37.5714, lng: 126.9765 };
const key = (c: Coord) => `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`;

// 하차역 근처 좌표를 번호로 만든다(번호가 클수록 목적지에서 멀다).
function exit(label: string, i: number, lineName?: string) {
  return {
    label,
    placeName: `가상역 ${label}번출구`,
    coord: { lat: 37.5714 - 0.001 * (i + 1), lng: 126.9765 },
    ...(lineName ? { lineName } : {}),
  };
}
const exits = (n: number, lineName?: string, offset = 0) =>
  Array.from({ length: n }, (_, i) => exit(String(i + 1), i + offset, lineName));
const stand = { label: "가상역택시승강장", placeName: "가상역택시승강장", coord: { lat: 37.5, lng: 126.9 } };
const fallback: Coord = { lat: 37.55, lng: 126.95 };
const dest = (n: number): Coord => ({ lat: 37.55 + n * 0.01, lng: 126.95 });

describe("planTaxiCalls", () => {
  it("상수는 8", () => {
    expect(JOURNEY_CALL_CAP).toBe(8);
  });

  it("택시 앞 목적지는 좌표 4자리 키로 중복을 제거한다", () => {
    const r = planTaxiCalls({
      taxiInDests: [dest(0), { lat: dest(0).lat + 0.00001, lng: dest(0).lng }, dest(1)],
      groups: [],
      to,
    });
    expect(r.taxiIn).toHaveLength(2);
    expect(r.cost).toBe(2);
  });

  it("같은 역·다른 노선 두 그룹(각 출구 7·승강장 1, 승강장 좌표 같음): 비용 ≤ 8, 그룹 출구가 섞이지 않고 승강장은 1회만 센다", () => {
    const g0 = { exits: exits(7, "2호선"), stand, fallbackStop: null };
    const g1 = { exits: exits(7, "신분당선", 20), stand, fallbackStop: null };
    const r = planTaxiCalls({ taxiInDests: [dest(0), dest(1)], groups: [g0, g1], to });
    // 남은 칸 = 8 − 택시 앞 2 − 승강장(유일 좌표 1) = 5 → 그룹 0 ceil(5/2)=3, 그룹 1 floor=2
    expect(r.groups[0].starts.filter((s) => s.kind === "exit")).toHaveLength(3);
    expect(r.groups[1].starts.filter((s) => s.kind === "exit")).toHaveLength(2);
    expect(r.cost).toBeLessThanOrEqual(JOURNEY_CALL_CAP);
    expect(r.cost).toBe(2 + 1 + 5);
    // 섞이지 않음
    expect(r.groups[0].starts.filter((s) => s.kind === "exit").every((s) => s.lineName === "2호선")).toBe(true);
    expect(r.groups[1].starts.filter((s) => s.kind === "exit").every((s) => s.lineName === "신분당선")).toBe(true);
    // 승강장은 각 그룹의 마지막 후보
    expect(r.groups[0].starts.at(-1)?.kind).toBe("stand");
    expect(r.groups[1].starts.at(-1)?.kind).toBe("stand");
    // 승강장 좌표는 전체 비용에서 한 번
    const standCoords = r.groups.flatMap((g) => g.starts.filter((s) => s.kind === "stand")).map((s) => key(s.coord));
    expect(new Set(standCoords).size).toBe(1);
  });

  it("그룹의 출구는 목적지에서 가까운 순으로 예선된다", () => {
    const g0 = { exits: [...exits(7, "2호선")].reverse(), stand: null, fallbackStop: null };
    const r = planTaxiCalls({ taxiInDests: [], groups: [g0], to });
    // 예산에 여유(남은 8, 그룹 하나)라 그룹당 상한 5개
    const labels = r.groups[0].starts.map((s) => s.label);
    expect(labels).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("예산 안이면 줄이지 않는다(출구 3 + 승강장 1 + 택시 앞 1)", () => {
    const r = planTaxiCalls({
      taxiInDests: [dest(0)],
      groups: [{ exits: exits(3), stand, fallbackStop: null }],
      to,
    });
    expect(r.groups[0].starts).toHaveLength(4);
    expect(r.cost).toBe(5);
  });

  it("출구 0건이고 승강장도 없는 그룹은 하차 정류 좌표 하나(kind none)", () => {
    const r = planTaxiCalls({
      taxiInDests: [dest(0)],
      groups: [{ exits: [], stand: null, fallbackStop: fallback }],
      to,
    });
    expect(r.groups[0].starts).toEqual([{ kind: "none", label: "", placeName: "", coord: fallback }]);
    expect(r.cost).toBe(2);
  });

  it("카카오 실패 그룹(출구·승강장 없음)의 fallback이 칸을 먼저 차지하고, 몫은 그룹 수로 나눈다(쓰이지 않은 몫은 넘기지 않는다)", () => {
    const ok = { exits: exits(7, "2호선"), stand, fallbackStop: null };
    const failed = { exits: [], stand: null, fallbackStop: fallback };
    const r = planTaxiCalls({ taxiInDests: [dest(0), dest(1)], groups: [ok, failed], to });
    // 고정 칸 = 승강장 1 + fallback 1 → 남은 칸 = 8 − 2 − 2 = 4 → 그룹 0 ceil(4/2)=2 (출구 2 + 승강장)
    expect(r.groups[0].starts.map((s) => s.kind)).toEqual(["exit", "exit", "stand"]);
    expect(r.groups[1].starts.map((s) => s.kind)).toEqual(["none"]);
    expect(r.cost).toBe(2 + 2 + 2);
    expect(r.cost).toBeLessThanOrEqual(JOURNEY_CALL_CAP);
  });

  it("예선 상한 5개 + 고정 칸이 상한 안이면 5개를 다 쓴다", () => {
    const ok = { exits: exits(7, "2호선"), stand: null, fallbackStop: null };
    const failed = { exits: [], stand: null, fallbackStop: fallback };
    const r = planTaxiCalls({ taxiInDests: [dest(0), dest(1)], groups: [ok, failed], to });
    expect(r.groups[0].starts).toHaveLength(5);
    expect(r.cost).toBe(2 + 5 + 1);
  });

  it("승강장만 있고 출구가 없으면 승강장 하나(fallback은 쓰지 않는다)", () => {
    const r = planTaxiCalls({
      taxiInDests: [],
      groups: [{ exits: [], stand, fallbackStop: fallback }],
      to,
    });
    expect(r.groups[0].starts.map((s) => s.kind)).toEqual(["stand"]);
    expect(r.cost).toBe(1);
  });

  it("남은 칸이 음수가 되는 병적 입력은 0으로 자른다(출구 0개, 정직한 비용을 돌려준다)", () => {
    const groups = [{ exits: exits(5), stand, fallbackStop: fallback }];
    const r = planTaxiCalls({
      taxiInDests: Array.from({ length: 8 }, (_, i) => dest(i)),
      groups,
      to,
    });
    expect(r.groups[0].starts.filter((s) => s.kind === "exit")).toHaveLength(0);
    // 8(택시 앞) + 승강장 1 — 상한을 넘은 비용을 숨기지 않고 보고한다(호출부가 예약 거절)
    expect(r.cost).toBe(9);
  });

  it("출구만 줄고 택시 앞·승강장·fallback은 줄지 않는다", () => {
    const g = (o: number) => ({ exits: exits(o, "2호선"), stand: null, fallbackStop: null });
    const small = planTaxiCalls({ taxiInDests: [dest(0), dest(1)], groups: [g(2), g(2)], to });
    const g1 = { exits: exits(9, "신분당선", 20), stand: null, fallbackStop: null };
    const big = planTaxiCalls({ taxiInDests: [dest(0), dest(1)], groups: [g(9), g1], to });
    expect(small.taxiIn).toHaveLength(2);
    expect(big.taxiIn).toHaveLength(2);
    expect(big.cost).toBe(2 + 6);
  });

  it("그룹이 없으면 택시 앞 비용만", () => {
    const r = planTaxiCalls({ taxiInDests: [dest(0)], groups: [], to });
    expect(r.groups).toEqual([]);
    expect(r.cost).toBe(1);
  });

  it("출구 좌표가 서로 같은 후보(다른 그룹)는 비용에서 한 번만 센다", () => {
    const shared = exits(2);
    const r = planTaxiCalls({
      taxiInDests: [],
      groups: [
        { exits: shared, stand: null, fallbackStop: null },
        { exits: shared, stand: null, fallbackStop: null },
      ],
      to,
    });
    expect(r.cost).toBe(2);
  });
});

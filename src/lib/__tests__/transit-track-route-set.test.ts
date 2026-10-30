import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../providers/seoul-bus", async (orig) => {
  const actual = await orig<typeof import("../providers/seoul-bus")>();
  return { ...actual, fetchSeoulWaitSlots: vi.fn() };
});

import { fetchSeoulWaitSlots } from "../providers/seoul-bus";
import { sortByRemaining, trackSeoulWait } from "../transit-track";

/** 노선 집합 대기 폴(E76, spec `2026-10-31-e76-bus-lane-set-design.md` §3). */
afterEach(() => vi.clearAllMocks());

const slot = (routeId: string, vehicleId: string, message: string, remainingStops: number | null) => ({
  routeId,
  vehicleId,
  message,
  remainingStops,
  lowFloor: false,
});

describe("trackSeoulWait — 노선 집합", () => {
  it("집합 폴은 항목마다 route를 싣고 잔여순으로 정렬한다(모르는 잔여는 뒤, 같으면 응답 순서)", async () => {
    vi.mocked(fetchSeoulWaitSlots).mockResolvedValue({
      slots: [
        slot("100100185", "a", "13분후[2번째 전]", 2),
        slot("100100447", "b", "출발대기", null),
        slot("123000011", "c", "3분후[1번째 전]", 1),
        slot("100100185", "d", "20분후[5번째 전]", 5),
        slot("117000002", "e", "곧 도착", 0),
      ],
      rawCount: 13,
    });
    const r = await trackSeoulWait({
      arsId: "02001",
      routeIds: ["100100185", "100100447", "123000011", "117000002"],
      lang: "ko",
    });
    if (r.status !== "ok") throw new Error("ok 기대");
    expect(r.items.map((i) => [i.vehicleId, i.route])).toEqual([
      ["e", "117000002"],
      ["c", "123000011"],
      ["a", "100100185"],
      ["d", "100100185"],
      ["b", "100100447"],
    ]);
    expect(r.rawCount).toBe(13);
    // provider에는 집합으로 넘긴다
    expect(vi.mocked(fetchSeoulWaitSlots).mock.calls[0][1]).toEqual(
      new Set(["100100185", "100100447", "123000011", "117000002"]),
    );
  });

  it("단일 노선 폴은 route를 싣지 않고 순서를 바꾸지 않는다(기존 앱 응답 byte-호환)", async () => {
    vi.mocked(fetchSeoulWaitSlots).mockResolvedValue({
      slots: [slot("A", "1", "13분후[5번째 전]", 5), slot("A", "2", "3분후[1번째 전]", 1)],
      rawCount: 2,
    });
    const r = await trackSeoulWait({ arsId: "1", routeId: "A", lang: "ko" });
    if (r.status !== "ok") throw new Error("ok 기대");
    expect(r.items.map((i) => i.vehicleId)).toEqual(["1", "2"]);
    expect(r.items.every((i) => !("route" in i))).toBe(true);
  });

  it("집합의 노선이 하나도 안 오면 필터 전멸(empty + rawCount)", async () => {
    vi.mocked(fetchSeoulWaitSlots).mockResolvedValue({ slots: [], rawCount: 9 });
    expect(await trackSeoulWait({ arsId: "1", routeIds: ["A", "B"], lang: "ko" })).toEqual({
      status: "empty",
      rawCount: 9,
    });
  });
});

describe("sortByRemaining", () => {
  it("안정 정렬", () => {
    const rows = [
      { id: 1, remainingStops: 2 },
      { id: 2, remainingStops: null },
      { id: 3, remainingStops: 2 },
      { id: 4, remainingStops: 0 },
    ];
    expect(sortByRemaining(rows).map((r) => r.id)).toEqual([4, 1, 3, 2]);
  });
});

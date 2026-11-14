// E88 묶음 ⓒ — 입구 기준 왼쪽·오른쪽·맞은편(`get_entrance_sides`). spec `2026-11-14-e88-chat-tool-gaps-design.md` ⓒ.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecutionContext } from "../types";
import type { Scene, SceneItem } from "@/lib/surroundings-scene";

vi.mock("@/lib/providers/places", () => ({ searchPlaces: vi.fn() }));
vi.mock("@/lib/surroundings-scene", () => ({ assembleScene: vi.fn() }));

import { executeFunction } from "../router";
import { entranceSidesData, SIDE_ITEMS_CAP } from "../entrance-sides";
import { searchPlaces } from "@/lib/providers/places";
import { assembleScene } from "@/lib/surroundings-scene";

const mockSearch = vi.mocked(searchPlaces);
const mockScene = vi.mocked(assembleScene);

const GILDONG = { lat: 37.5378, lng: 127.1417 };
const LOTTE = { lat: 37.5384, lng: 127.1237, name: "현대백화점 천호점", roadAddress: "서울 강동구 천호대로 1005" };
const FUKUOKA = { lat: 33.5902, lng: 130.4017, name: "후쿠오카" };
const ctx: ExecutionContext = { locale: "ko", dataLocale: "ko", userLocation: GILDONG };
const anchorCtx: ExecutionContext = { ...ctx, placeAnchor: { lat: 37.5, lng: 127.1, name: "길동 보룡약국" } };

const item = (name: string, distanceMeters: number, road: string | null = null): SceneItem => ({
  name,
  distanceMeters,
  road,
  category: "편의점",
  id: `id-${name}`,
  lat: 37.5,
  lng: 127.1,
  categoryRaw: "가정,생활 > 편의점",
  roadAddress: "서울 강동구 천호대로 1001",
  phone: "02-000-0000",
  link: "https://place.map.kakao.com/1",
});

const ENTRANCE: Scene = {
  place: "천호동, 서울 강동구 천호대로 1005",
  frame: "entrance",
  total: 3,
  groups: [
    { bucket: "left", items: [item("GS25 천호점", 20)] },
    { bucket: "across", items: [item("천호역 5번 출구", 40), item("스타벅스", 60, "올림픽로")] },
  ],
};
const COMPASS: Scene = { place: "천호동", frame: "compass", total: 2, groups: [{ bucket: "n", items: [item("가", 10), item("나", 20)] }] };

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockImplementation(async ({ query }) => ({
    places: query === "현대백화점 천호점" ? [LOTTE] : query === "후쿠오카" ? [FUKUOKA] : [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
  mockScene.mockReset();
  mockScene.mockResolvedValue(ENTRANCE);
});

describe("entranceSidesData", () => {
  it("축이 서면 입구 기준 묶음을 싣고 좌표·전화번호·링크·id는 싣지 않는다", () => {
    const d = entranceSidesData(ENTRANCE, "현대백화점 천호점", ["현대백화점 천호점"]);
    expect(d).toMatchObject({ searchedPlace: "현대백화점 천호점", address: ENTRANCE.place, frame: "entrance", total: 3 });
    expect(String(d.basis)).toContain("입구를 마주 보고");
    expect(d.sides).toEqual([
      { side: "왼쪽", count: 1, places: [{ name: "GS25 천호점", category: "편의점", distanceMeters: 20 }] },
      {
        side: "맞은편",
        count: 2,
        places: [
          { name: "천호역 5번 출구", category: "편의점", distanceMeters: 40 },
          { name: "스타벅스", category: "편의점", distanceMeters: 60, road: "올림픽로" },
        ],
      },
    ]);
    const json = JSON.stringify(d);
    for (const leaked of ["lat", "lng", "phone", "link", "\"id\"", "categoryRaw", "roadAddress"]) expect(json).not.toContain(leaked);
  });

  it("묶음마다 가까운 순 여덟 곳까지 싣고 전체 수는 count로 준다", () => {
    const many = Array.from({ length: 11 }, (_, i) => item(`가게${i}`, i * 5));
    const d = entranceSidesData({ ...ENTRANCE, total: 11, groups: [{ bucket: "right", items: many }] }, "x", ["x"]);
    const sides = d.sides as { count: number; places: unknown[] }[];
    expect(SIDE_ITEMS_CAP).toBe(8);
    expect(sides[0].count).toBe(11);
    expect(sides[0].places).toHaveLength(8);
  });

  it("축이 안 서면 좌우 묶음 없이 sidesUnavailable과 안내만 준다(방위 묶음도 싣지 않는다)", () => {
    const d = entranceSidesData(COMPASS, "x", ["x"]);
    expect(d).toEqual({
      searchedPlace: "x",
      address: "천호동",
      frame: "compass",
      sidesUnavailable: true,
      total: 2,
      notice: expect.stringContaining("왼쪽·오른쪽을 말할 수 없습니다"),
    });
  });

  it("그 장소 자신은 뺀다 — 묶음 수·전체 수도 뺀 뒤의 수이고, 자신만 있으면 0건이다", () => {
    const scene: Scene = {
      place: null,
      frame: "entrance",
      total: 3,
      groups: [
        { bucket: "right", items: [item("경복궁", 0), item("국립고궁박물관", 90)] },
        { bucket: "beyond", items: [item("경복궁(광화문)", 120)] },
      ],
    };
    const d = entranceSidesData(scene, "경복궁 (서울 종로구 사직로 161)", ["경복궁", "경복궁"]);
    expect(d.total).toBe(1);
    expect(d.sides).toEqual([{ side: "오른쪽", count: 1, places: [{ name: "국립고궁박물관", category: "편의점", distanceMeters: 90 }] }]);
    const onlySelf: Scene = { place: null, frame: "compass", total: 1, groups: [{ bucket: "n", items: [item("경복궁", 0)] }] };
    expect(entranceSidesData(onlySelf, "경복궁", ["경복궁"])).toMatchObject({ total: 0 });
  });

  it("0건은 total:0과 안내다(축 여부와 무관)", () => {
    expect(entranceSidesData({ place: null, frame: "entrance", total: 0, groups: [] }, "x", ["x"])).toEqual({
      searchedPlace: "x",
      total: 0,
      notice: "150m 안에 등록된 가게나 시설이 없습니다.",
    });
  });
});

describe("get_entrance_sides (채팅 도구)", () => {
  it("이름을 장소 검색 첫 결과로 풀어 그 좌표로 조립하고 고른 장소를 싣는다", async () => {
    const r = await executeFunction("get_entrance_sides", { place: "현대백화점 천호점" }, ctx);
    expect(mockScene).toHaveBeenCalledWith(LOTTE.lat, LOTTE.lng);
    expect(r.data.searchedPlace).toBe("현대백화점 천호점 (서울 강동구 천호대로 1005)");
    expect(r.render).toBeUndefined();
    expect(r.source).toEqual([{ label: "source.kakao" }]);
  });

  it("이름이 없으면 현재 위치로 조립하지 않는다(필수 인자)", async () => {
    for (const args of [{}, { place: "  " }, { place: 3 }]) {
      const r = await executeFunction("get_entrance_sides", args, ctx);
      expect(String(r.data.error)).toContain("장소 이름");
    }
    expect(mockScene).not.toHaveBeenCalled();
  });

  it("장소 채팅: 앵커 이름이면 앵커 좌표를 쓰고 다시 검색하지 않는다", async () => {
    const r = await executeFunction("get_entrance_sides", { place: "길동 보룡약국 " }, anchorCtx);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockScene).toHaveBeenCalledWith(37.5, 127.1);
    expect(r.data.searchedPlace).toBe("길동 보룡약국");
  });

  it("장소 채팅: 다른 이름이면 그 이름을 검색한다", async () => {
    await executeFunction("get_entrance_sides", { place: "현대백화점 천호점" }, anchorCtx);
    expect(mockScene).toHaveBeenCalledWith(LOTTE.lat, LOTTE.lng);
  });

  it("못 풀면 placeNotFound이고 현재 위치로 대신하지 않는다", async () => {
    const r = await executeFunction("get_entrance_sides", { place: "없는곳" }, ctx);
    expect(r.data).toEqual({ error: "'없는곳' 위치를 찾지 못했습니다." });
    expect(mockScene).not.toHaveBeenCalled();
  });

  it("한국 밖이면 커버리지 안내만 돌려준다", async () => {
    const r = await executeFunction("get_entrance_sides", { place: "후쿠오카" }, ctx);
    expect(r.data.outOfCoverage).toBe(true);
    expect(mockScene).not.toHaveBeenCalled();
  });

  it("조립 실패는 던진다(0건·축 없음과 다른 상태)", async () => {
    mockScene.mockRejectedValue(new Error("kakao 500"));
    await expect(executeFunction("get_entrance_sides", { place: "현대백화점 천호점" }, ctx)).rejects.toThrow("kakao 500");
  });
});

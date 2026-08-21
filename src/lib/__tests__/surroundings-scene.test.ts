import { beforeEach, describe, expect, it, vi } from "vitest";

const coordToAddress = vi.fn();
const coordToRegion = vi.fn();
const coordToRegionNames = vi.fn();
const findSurroundingsNear = vi.fn();
const resolveRoadAxis = vi.fn();

vi.mock("../providers/kakao-address", () => ({
  coordToAddress: (...a: unknown[]) => coordToAddress(...a),
  coordToRegion: (...a: unknown[]) => coordToRegion(...a),
  coordToRegionNames: (...a: unknown[]) => coordToRegionNames(...a),
}));
vi.mock("../providers/surroundings", () => ({
  findSurroundingsNear: (...a: unknown[]) => findSurroundingsNear(...a),
  ALL_CATEGORY_GROUPS: ["SC4"],
}));
vi.mock("../road-axis-service", () => ({
  resolveRoadAxis: (...a: unknown[]) => resolveRoadAxis(...a),
}));

const { assembleScene } = await import("../surroundings-scene");

const mPerDegLng = 111_320 * Math.cos((37.5415 * Math.PI) / 180);
const east = (m: number) => 127.1495 + m / mPerDegLng;

beforeEach(() => {
  coordToAddress.mockReset();
  coordToRegion.mockReset();
  findSurroundingsNear.mockReset();
  resolveRoadAxis.mockReset();
  coordToAddress.mockResolvedValue({
    roadAddress: "서울특별시 강동구 명일로24길 25",
    jibunAddress: undefined,
    display: "서울특별시 강동구 명일로24길 25",
  });
  coordToRegion.mockResolvedValue("서울특별시 강동구 길동");
  coordToRegionNames.mockReset();
  coordToRegionNames.mockResolvedValue({ province: "서울특별시", city: "강동구" });
  resolveRoadAxis.mockResolvedValue({
    ux: 1,
    uy: 0,
    metersPerNumber: 8,
    sampleCount: 5,
  });
  findSurroundingsNear.mockResolvedValue([
    {
      id: "kakao-1",
      name: "서울신명초등학교",
      lat: 37.5415,
      lng: east(75),
      distanceMeters: 75,
      category: "school",
      categoryRaw: "교육,학문 > 학교 > 초등학교",
      phone: "02-000-0000",
      link: "https://place.map.kakao.com/1",
      roadAddress: "서울특별시 강동구 명일로24길 33",
    },
    {
      name: "봉래면옥",
      lat: 37.5415,
      lng: east(-62),
      distanceMeters: 62,
      category: "restaurant",
      roadAddress: "서울 강동구 명일로 200-16",
    },
  ]);
});

describe("assembleScene", () => {
  it("축이 서면 입구 기준 좌우로 묶는다", async () => {
    const scene = await assembleScene(37.5415, 127.1495);
    expect(scene.frame).toBe("entrance");
    const right = scene.groups.find((g) => g.bucket === "right");
    expect(right?.items[0]?.name).toBe("서울신명초등학교");
    const left = scene.groups.find((g) => g.bucket === "left");
    expect(left?.items[0]?.name).toBe("봉래면옥");
  });

  it("목적지와 다른 도로면 길 이름을 단서로 남긴다", async () => {
    const scene = await assembleScene(37.5415, 127.1495);
    const left = scene.groups.find((g) => g.bucket === "left");
    expect(left?.items[0]?.road).toBe("명일로");
  });

  it("같은 도로면 길 이름을 붙이지 않는다 — 잉여다", async () => {
    const scene = await assembleScene(37.5415, 127.1495);
    const right = scene.groups.find((g) => g.bucket === "right");
    expect(right?.items[0]?.road).toBeNull();
  });

  it("축을 못 세우면 절대 방위로 물러난다 — 침묵하지 않는다", async () => {
    resolveRoadAxis.mockResolvedValue(null);
    const scene = await assembleScene(37.5415, 127.1495);
    expect(scene.frame).toBe("compass");
    expect(scene.groups.flatMap((g) => g.items)).toHaveLength(2);
  });

  it("juso 키워드는 시도·시군구 조각으로 조립한다 — 표시 문자열 분할 금지", async () => {
    await assembleScene(37.5415, 127.1495);
    expect(resolveRoadAxis).toHaveBeenCalledWith("서울특별시 강동구", "명일로24길", {
      lat: 37.5415,
      lng: 127.1495,
    });
  });

  it("도로명주소를 못 얻어도 방위로 물러난다", async () => {
    coordToAddress.mockResolvedValue({
      roadAddress: undefined,
      jibunAddress: "서울 강동구 길동 477",
      display: "서울 강동구 길동 477",
    });
    const scene = await assembleScene(37.5415, 127.1495);
    expect(scene.frame).toBe("compass");
    expect(resolveRoadAxis).not.toHaveBeenCalled();
  });

  it("후보가 0건이면 빈 묶음이 아니라 total 0을 준다", async () => {
    findSurroundingsNear.mockResolvedValue([]);
    const scene = await assembleScene(37.5415, 127.1495);
    expect(scene.total).toBe(0);
    expect(scene.groups).toHaveLength(0);
  });

  it("같은 도로 홀짝 반대 본번은 맞은편 묶음", async () => {
    findSurroundingsNear.mockResolvedValue([
      {
        name: "계명치과",
        lat: 37.5418,
        lng: 127.1495,
        distanceMeters: 33,
        category: "hospital",
        roadAddress: "서울특별시 강동구 명일로24길 26",
      },
    ]);
    const scene = await assembleScene(37.5415, 127.1495);
    const across = scene.groups.find((g) => g.bucket === "across");
    expect(across?.items[0]?.name).toBe("계명치과");
  });

  it("항목은 장소 상세 진입 재료(id·좌표·카테고리 원문·주소·전화·링크)를 싣는다 — M4 판정 ⑤", async () => {
    const scene = await assembleScene(37.5415, 127.1495);
    const item = scene.groups.flatMap((g) => g.items).find((i) => i.name === "서울신명초등학교");
    expect(item).toMatchObject({
      id: "kakao-1",
      lat: 37.5415,
      lng: east(75),
      categoryRaw: "교육,학문 > 학교 > 초등학교",
      roadAddress: "서울특별시 강동구 명일로24길 33",
      phone: "02-000-0000",
      link: "https://place.map.kakao.com/1",
      // 기존 필드 불변(웹 SurroundingsScene.tsx 소비)
      distanceMeters: 75,
      road: null, // 앵커와 같은 도로라 잉여(기존 규칙 불변)
      category: "school",
    });
    // 없는 값은 지어내지 않는다 — 봉래면옥은 id·전화가 없다.
    const other = scene.groups.flatMap((g) => g.items).find((i) => i.name === "봉래면옥");
    expect(other?.phone).toBeUndefined();
  });
});

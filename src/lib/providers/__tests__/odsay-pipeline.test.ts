import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
vi.mock("../bus-service-hours", () => ({
  fetchServiceHoursMap: vi.fn(async () => new Map()),
}));
vi.mock("../subway-service-hours", () => ({
  fetchSubwayServiceHoursMap: vi.fn(async () => new Map()),
  subwayHoursKey: (r: { stationName: string; lineName: string; wayCode: number }) =>
    `${r.stationName}|${r.lineName}|${r.wayCode}`,
}));

import { getTransitRoute } from "../odsay";

/** ⚠ 화살표 한 줄로 쓰면 mock 자체가 반환되어 teardown으로 등록된다(중괄호 필수) */
beforeEach(() => {
  fetchMock.mockReset();
});

function busPath(minutes: number, boards: number) {
  const subPath: unknown[] = [{ trafficType: 3, distance: 100, sectionTime: 2 }];
  for (let i = 0; i < boards; i++) {
    subPath.push({
      trafficType: 2,
      distance: 1000,
      sectionTime: minutes,
      stationCount: 5,
      startName: `승차${i}`,
      endName: `하차${i}`,
      lane: [{ busNo: `${100 + i}`, busLocalBlID: `B${i}`, busCityCode: 1000 }],
    });
    if (i < boards - 1) subPath.push({ trafficType: 3, distance: 50, sectionTime: 1 });
  }
  subPath.push({ trafficType: 3, distance: 200, sectionTime: 3 });
  return { pathType: 2, info: { totalTime: minutes, payment: 1500 }, subPath };
}

function respond(paths: unknown[]) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ result: { path: paths } }),
  });
}

const COORDS = { origin: { lat: 37.5, lng: 127.1 }, dest: { lat: 37.55, lng: 126.97 } };

describe("getTransitRoute 파이프라인", () => {
  it("5개까지만 돌려주고 후보 총수를 보존한다", async () => {
    respond(Array.from({ length: 9 }, (_, i) => busPath(20 + i, 1)));
    const result = (await getTransitRoute(COORDS))!;
    expect(1 + result.alternatives.length).toBe(5);
    expect(result.totalCandidates).toBe(9);
  });

  it("무환승 경로가 뒤에 있어도 대안에 오른다", async () => {
    const paths = [
      busPath(20, 2),
      busPath(22, 2),
      busPath(23, 2),
      busPath(24, 2),
      busPath(25, 2),
      busPath(26, 2),
      busPath(40, 1), // 무환승, 7번째
    ];
    respond(paths);
    const result = (await getTransitRoute(COORDS))!;
    const labeled = result.alternatives.find((r) => r.highlight?.includes("fewestTransfers"));
    expect(labeled?.summary.transfers).toBe(0);
  });

  it("도보 구간의 행선지와 거리가 최종 응답까지 살아 있다", async () => {
    respond([busPath(20, 1)]);
    const result = (await getTransitRoute(COORDS))!;
    const [firstWalk, , lastWalk] = result.recommended.legs;
    expect(firstWalk).toMatchObject({ mode: "walk", distanceMeters: 100, toName: "승차0" });
    expect(lastWalk).toMatchObject({ mode: "walk", distanceMeters: 200 });
    expect(lastWalk.toName).toBeUndefined();
  });

  it("스키마 위반은 throw (0건으로 뭉개지 않는다)", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(getTransitRoute(COORDS)).rejects.toThrow(/스키마/);
  });

  it("경로 없음은 null", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ error: { code: "-98", msg: "x" } }),
    });
    expect(await getTransitRoute(COORDS)).toBeNull();
  });

  it("배열 봉투 인증 실패는 throw (경로 없음으로 오분류하지 않는다)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ error: [{ code: "500", message: "[ApiKeyAuthFailed]" }] }),
    });
    await expect(getTransitRoute(COORDS)).rejects.toThrow(/ODsay/);
  });
});

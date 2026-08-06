import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

/**
 * 테스트가 채우는 운행시간 표. 비어 있으면 전 구간 unknown이라 강등 정렬이
 * no-op이 된다. ⚠ 그 상태로만 검증하면 "라벨을 강등 앞에서 붙인다"는 변이가
 * 통과한다(순서가 안 바뀌니 결과가 같다). 순서를 실제로 뒤집는 케이스가 있어야
 * 파이프라인 순서 계약이 검증된다.
 */
const busHours = new Map<string, { firstMinutes: number; lastMinutes: number }>();
vi.mock("../bus-service-hours", () => ({
  fetchServiceHoursMap: vi.fn(async () => busHours),
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
  busHours.clear();
});

function busPath(minutes: number, boards: number, routeId?: string) {
  const subPath: unknown[] = [{ trafficType: 3, distance: 100, sectionTime: 2 }];
  for (let i = 0; i < boards; i++) {
    subPath.push({
      trafficType: 2,
      distance: 1000,
      sectionTime: minutes,
      stationCount: 5,
      startName: `승차${i}`,
      endName: `하차${i}`,
      lane: [
        { busNo: `${100 + i}`, busLocalBlID: routeId ?? `B${i}`, busCityCode: 1000 },
      ],
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

  it("강등이 1순위를 바꾸면 축은 새 1순위 기준으로 계산된다", async () => {
    // 이 케이스가 파이프라인 **순서** 계약의 정본이다. 시간표가 비어 전 구간이
    // unknown이면 강등 정렬이 no-op이라, 라벨을 강등 앞에서 붙여도 결과가 같아
    // 순서 위반이 통과한다. 여기서는 강등이 실제로 1순위를 뒤집는다.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-08-06T16:00:00Z")); // 01:00 KST
      busHours.set("DAY", { firstMinutes: 240, lastMinutes: 1350 }); // 04:00~22:30 → outside
      busHours.set("NIGHT", { firstMinutes: 1390, lastMinutes: 230 }); // 23:10~03:50 → running
      respond([
        busPath(40, 2, "DAY"), // ODsay 추천 1순위지만 운행 종료
        busPath(60, 1, "NIGHT"), // 느리고 무환승이며 운행 중
      ]);

      const result = (await getTransitRoute(COORDS))!;

      // 강등이 운행 중 경로를 1순위로 올렸다(이 단언이 깨지면 아래가 무의미하다)
      expect(result.recommended.routeKey).toBe("p1");
      // ⚠ 1순위는 축 라벨을 갖지 않는다. 라벨을 강등 앞에서 붙이면 p1이 옛 1순위
      //   기준으로 "환승이 가장 적은 경로" 라벨을 받은 채 승격돼 이 단언이 깨진다.
      expect(result.recommended.highlight).toBeUndefined();
      // 강등된 옛 1순위는 운행 밖이라 축 후보에서 빠지고 번호만 받는다
      expect(result.alternatives[0].routeKey).toBe("p0");
      expect(result.alternatives[0].highlight).toBeUndefined();
      expect(result.alternatives[0].displayIndex).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("배열 봉투 인증 실패는 throw (경로 없음으로 오분류하지 않는다)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ error: [{ code: "500", message: "[ApiKeyAuthFailed]" }] }),
    });
    await expect(getTransitRoute(COORDS)).rejects.toThrow(/ODsay/);
  });
});

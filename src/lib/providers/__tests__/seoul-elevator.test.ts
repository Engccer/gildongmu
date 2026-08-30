import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../env", () => ({
  env: { SEOUL_OPEN_DATA_KEY: "test-key" },
}));

import {
  parseElevatorRows,
  composeElevatorItems,
  fetchSeoulElevators,
} from "../seoul-elevator";

const raw = {
  tbTraficElvtr: {
    list_total_count: 2,
    RESULT: { CODE: "INFO-000" },
    row: [
      { NODE_WKT: "POINT(127.1329072 37.5359120)", SBWY_STN_NM: "강동", EMD_NM: "성내동" },
      { NODE_WKT: "POINT(127.1317901 37.5362824)", SBWY_STN_NM: "강동", EMD_NM: "성내동" },
      { NODE_WKT: "bogus", SBWY_STN_NM: "파싱불가" },
    ],
  },
};

describe("parseElevatorRows", () => {
  it("WKT(lng lat)를 파싱하고 비정상 행을 버린다", () => {
    const rows = parseElevatorRows(raw);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ stationKey: "강동", lat: 37.535912, lng: 127.1329072, dong: "성내동" });
  });
});

describe("composeElevatorItems — 방위·거리 ko 합성", () => {
  const seedRows = [
    { name: "강동", nameEn: "Gangdong", lineName: "5호선", operator: "서울교통공사", lat: 37.5354, lng: 127.1323, isTransfer: false },
  ];
  it("최근접 seed 좌표 기준 방위·거리 텍스트를 만든다", () => {
    const items = composeElevatorItems(parseElevatorRows(raw), seedRows);
    expect(items).toHaveLength(2);
    expect(items[0].name).toMatch(/^역 중심 기준 (북|북동|동|남동|남|남서|서|북서)쪽 약 \d+m, 성내동$/);
    // 구조화 조각(A26): 비-ko 클라이언트가 자기 언어로 조립하는 원재료. 문자열 name은 불변(CLI/MCP).
    expect(items[0].parts).toEqual({
      compass: expect.stringMatching(/^(n|ne|e|se|s|sw|w|nw)$/),
      meters: expect.any(Number),
      dong: "성내동",
    });
    expect(items[0].name).toBe(`역 중심 기준 ${{ n: "북", ne: "북동", e: "동", se: "남동", s: "남", sw: "남서", w: "서", nw: "북서" }[items[0].parts!.compass!]}쪽 약 ${items[0].parts!.meters}m, 성내동`);
  });
  it("1km 이상은 formatDistance 표기(약 1.2km) — 클라이언트 조립(parts)과 문장이 갈리지 않는다", () => {
    const far = [{ stationKey: "강동", lat: 37.5354 + 0.011, lng: 127.1323, dong: "" }];
    const items = composeElevatorItems(far, seedRows);
    expect(items[0].parts!.meters).toBeGreaterThanOrEqual(1000);
    expect(items[0].name).toMatch(/^역 중심 기준 북쪽 약 \d+(\.\d+)?km$/);
  });
  it("seed 좌표가 없으면 빈 배열(방위 없는 나열은 무가치)", () => {
    expect(composeElevatorItems(parseElevatorRows(raw), [])).toEqual([]);
  });
});

/**
 * 따릉이·문화행사·혼잡도와 **같은 키·같은 호스트**를 쓰는 네 번째 소비자다.
 * 키가 죽으면 넷이 동시에 HTTP 200 + XML을 받으므로 진단 문구도 같아야 한다
 * (이 provider는 호출부가 `Promise.allSettled`로 감싸 실패를 강등하기 때문에
 * 메시지가 유일한 단서다).
 */
describe("fetchSeoulElevators — HTTP 계층", () => {
  afterEach(() => vi.restoreAllMocks());

  it("무효 키의 HTTP 200 + XML 본문 → 인증키를 지목하고 throw", async () => {
    const xml =
      "<RESULT><CODE>INFO-100</CODE><MESSAGE><![CDATA[인증키가 유효하지 않습니다.]]></MESSAGE></RESULT>";
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(xml, { status: 200 }),
    );
    await expect(fetchSeoulElevators()).rejects.toThrow(/INFO-100.*인증키/);
  });

  it("HTTP 실패는 상태코드를 남기고 throw", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("nope", { status: 503 }),
    );
    await expect(fetchSeoulElevators()).rejects.toThrow(/503/);
  });
});

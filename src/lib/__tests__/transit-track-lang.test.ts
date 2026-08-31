import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../providers/seoul-bus", async (orig) => {
  const actual = await orig<typeof import("../providers/seoul-bus")>();
  return { ...actual, fetchSeoulWaitSlots: vi.fn(), fetchSeoulRideSlots: vi.fn(), fetchSeoulRouteStops: vi.fn() };
});
vi.mock("../providers/tago-bus", () => ({ fetchTagoArrivals: vi.fn(), fetchTagoStopsNear: vi.fn() }));
vi.mock("../providers/seoul-subway-arrival", async (orig) => {
  const actual = await orig<typeof import("../providers/seoul-subway-arrival")>();
  return { ...actual, fetchSubwayArrivals: vi.fn() };
});

import { fetchSeoulWaitSlots } from "../providers/seoul-bus";
import { fetchTagoArrivals } from "../providers/tago-bus";
import { fetchSubwayArrivals } from "../providers/seoul-subway-arrival";
import { trackSeoulWait, trackSubway, trackTago } from "../transit-track";
import type { TrackItem } from "../transit-guide";

afterEach(() => vi.clearAllMocks());

function keysOf(item: TrackItem): string[] {
  return Object.keys(item).sort();
}

const SUBWAY_ARRIVAL = {
  line: "5호선",
  direction: "상행",
  trainLineNm: "방화행 - 광화문방면",
  destination: "방화",
  message: "3분 후 (군자)",
  currentLocation: "군자",
  arrivalCode: "99",
  express: false,
  trainNo: "5001",
  receivedAt: null,
  secondsUntilArrival: 180,
};

describe("실시간 추적 영문 조각 (E27 잔여 ①, spec 2026-09-01 §3.2)", () => {
  it("lang 부재(ko)면 항목 키 집합이 종전과 정확히 같다 — 최대 회귀 방어선", async () => {
    vi.mocked(fetchSeoulWaitSlots).mockResolvedValue({
      slots: [{ vehicleId: "1", message: "6분47초후[4번째 전]", remainingStops: 4, lowFloor: true }],
      rawCount: 1,
    });
    const ko = await trackSeoulWait({ arsId: "1", routeId: "2", lang: "ko" });
    expect(ko.status).toBe("ok");
    if (ko.status !== "ok") return;
    expect(keysOf(ko.items[0])).toEqual([
      "arrivalCode", "destinationName", "direction", "express", "message", "remainingStops", "vehicleId",
    ]);
  });

  it("서울버스 en: messageEn만 붙고 방향·종착역 자리는 만들지 않는다(구조적 부재)", async () => {
    vi.mocked(fetchSeoulWaitSlots).mockResolvedValue({
      slots: [{ vehicleId: "1", message: "6분47초후[4번째 전]", remainingStops: 4, lowFloor: true }],
      rawCount: 1,
    });
    const en = await trackSeoulWait({ arsId: "1", routeId: "2", lang: "en" });
    if (en.status !== "ok") throw new Error("ok 기대");
    expect(en.items[0].messageEn).toBe("In 6 min 47 sec");
    expect(en.items[0]).not.toHaveProperty("directionEn");
    expect(en.items[0]).not.toHaveProperty("destinationNameEn");
    // 한국어 필드는 en 응답에서도 한국어다(원칙 1) — 조인 경로가 이 값으로 돈다.
    expect(en.items[0].message).toBe("6분47초후[4번째 전]");
  });

  it("TAGO en: messageEn이 빈 문자열로 실린다 — 부재가 아니라 자리 표시", async () => {
    vi.mocked(fetchTagoArrivals).mockResolvedValue([
      { routeNo: "3", prevStationCount: 2 } as never,
    ]);
    const en = await trackTago({ cityCode: "25", nodeId: "N", routeNo: "3", lang: "en" });
    if (en.status !== "ok") throw new Error("ok 기대");
    expect(en.items[0]).toHaveProperty("messageEn");
    expect(en.items[0].messageEn).toBe("");
    const ko = await trackTago({ cityCode: "25", nodeId: "N", routeNo: "3", lang: "ko" });
    if (ko.status !== "ok") throw new Error("ok 기대");
    expect(ko.items[0]).not.toHaveProperty("messageEn");
  });

  it("지하철 en: 네 조각이 붙고 한국어 필드는 그대로", async () => {
    vi.mocked(fetchSubwayArrivals).mockResolvedValue({
      stationName: "천호",
      arrivals: [SUBWAY_ARRIVAL as never],
    });
    const en = await trackSubway({ station: "천호", lineName: "수도권 5호선", lang: "en" });
    if (en.status !== "ok") throw new Error("ok 기대");
    const item = en.items[0];
    expect(item.messageEn).toBe("In 3 min");
    expect(item.directionEn).toBe("Up");
    expect(item.destinationNameEn).toBe("Banghwa");
    expect(item.currentLocationEn).toBe("Gunja (Neungdong)"); // seed 영문 원문 그대로
    expect(item.message).toBe("3분 후 (군자)");
    expect(item.direction).toBe("상행");
    expect(item.destinationName).toBe("방화");
    expect(item.currentLocation).toBe("군자");
  });

  it("지하철 ko: 영문 조각이 하나도 없다", async () => {
    vi.mocked(fetchSubwayArrivals).mockResolvedValue({
      stationName: "천호",
      arrivals: [SUBWAY_ARRIVAL as never],
    });
    const ko = await trackSubway({ station: "천호", lineName: "수도권 5호선", lang: "ko" });
    if (ko.status !== "ok") throw new Error("ok 기대");
    expect(keysOf(ko.items[0]).filter((k) => k.endsWith("En"))).toEqual([]);
  });

  it("행렬 밖 도착 문장은 messageEn 부재 — 다른 조각은 살아남는다(필드 독립)", async () => {
    vi.mocked(fetchSubwayArrivals).mockResolvedValue({
      stationName: "천호",
      arrivals: [{ ...SUBWAY_ARRIVAL, message: "알 수 없는 문장", currentLocation: "군자" } as never],
    });
    const en = await trackSubway({ station: "천호", lineName: "수도권 5호선", lang: "en" });
    if (en.status !== "ok") throw new Error("ok 기대");
    expect(en.items[0]).not.toHaveProperty("messageEn");
    expect(en.items[0].directionEn).toBe("Up");
    expect(en.items[0].currentLocationEn).toBe("Gunja (Neungdong)");
  });
});

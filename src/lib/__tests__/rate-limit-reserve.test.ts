import { describe, it, expect } from "vitest";
import {
  reserveCalls,
  createJourneyTmapBudget,
  JOURNEY_TMAP_IP_LIMIT,
  JOURNEY_TMAP_DAILY_CAP,
  type RateLimitEntry,
} from "../rate-limit";

const WINDOW = 60_000;

describe("reserveCalls — 호출 수 단위 예약(E70 spec §4.5-3)", () => {
  it("한도 안의 비용은 한 번에 예약한다", () => {
    const store = new Map<string, RateLimitEntry>();
    expect(reserveCalls(store, "ip", 0, 8, 16, WINDOW)).toBe(true);
    expect(reserveCalls(store, "ip", 1, 8, 16, WINDOW)).toBe(true);
    expect(store.get("ip")?.count).toBe(16);
  });

  it("모자라면 거절하고 아무것도 쓰지 않는다", () => {
    const store = new Map<string, RateLimitEntry>();
    reserveCalls(store, "ip", 0, 10, 16, WINDOW);
    expect(reserveCalls(store, "ip", 1, 7, 16, WINDOW)).toBe(false);
    expect(store.get("ip")?.count).toBe(10);
    // 남은 칸(6) 안의 비용은 여전히 받는다.
    expect(reserveCalls(store, "ip", 2, 6, 16, WINDOW)).toBe(true);
  });

  it("창이 지나면 새 창을 연다", () => {
    const store = new Map<string, RateLimitEntry>();
    reserveCalls(store, "ip", 0, 16, 16, WINDOW);
    expect(reserveCalls(store, "ip", WINDOW, 8, 16, WINDOW)).toBe(true);
    expect(store.get("ip")).toEqual({ count: 8, windowStart: WINDOW });
  });

  it("처음 보는 키라도 한도를 넘는 비용은 거절하고 쓰지 않는다", () => {
    const store = new Map<string, RateLimitEntry>();
    expect(reserveCalls(store, "ip", 0, 17, 16, WINDOW)).toBe(false);
    expect(store.has("ip")).toBe(false);
  });
});

describe("여정 Tmap 예산 — IP 버킷 + 인스턴스 일 상한(spec §4.5-3·4)", () => {
  it("IP 버킷은 60초 16회다", () => {
    const budget = createJourneyTmapBudget();
    expect(JOURNEY_TMAP_IP_LIMIT).toBe(16);
    expect(budget.reserve("a", 0, 8)).toBe("ok");
    expect(budget.reserve("a", 1, 8)).toBe("ok");
    expect(budget.reserve("a", 2, 1)).toBe("rateLimited");
    // 다른 IP는 따로 센다.
    expect(budget.reserve("b", 3, 8)).toBe("ok");
  });

  it("일 상한 200에 닿으면 budgetExhausted이고 IP 버킷에는 쓰지 않는다", () => {
    const budget = createJourneyTmapBudget();
    expect(JOURNEY_TMAP_DAILY_CAP).toBe(200);
    // 서로 다른 IP 25곳 × 8 = 200.
    for (let i = 0; i < 25; i++) expect(budget.reserve(`ip${i}`, i, 8)).toBe("ok");
    expect(budget.reserve("fresh", 100, 1)).toBe("budgetExhausted");
    expect(budget.exhausted(100)).toBe(true);
    // 거절된 IP는 버킷이 비어 있어 일 상한이 풀리면 바로 16회를 쓴다.
    expect(budget.ipCount("fresh", 100)).toBe(0);
  });

  it("버킷이 찬 IP는 ipCount가 한도와 같다(라우트 선판정 근거)", () => {
    const budget = createJourneyTmapBudget();
    budget.reserve("a", 0, 16);
    expect(budget.ipCount("a", 1)).toBe(JOURNEY_TMAP_IP_LIMIT);
    expect(budget.ipCount("a", WINDOW)).toBe(0);
  });

  it("IP 버킷 거절은 일 카운터를 올리지 않는다", () => {
    const budget = createJourneyTmapBudget();
    budget.reserve("a", 0, 16);
    expect(budget.reserve("a", 1, 1)).toBe("rateLimited");
    expect(budget.dailyCount(1)).toBe(16);
  });

  it("KST 자정(UTC 15:00)에 일 카운터가 새로 시작한다", () => {
    const budget = createJourneyTmapBudget();
    const beforeMidnightKst = Date.UTC(2026, 9, 17, 14, 59, 0);
    const afterMidnightKst = Date.UTC(2026, 9, 17, 15, 0, 0);
    for (let i = 0; i < 25; i++) budget.reserve(`ip${i}`, beforeMidnightKst, 8);
    expect(budget.reserve("x", beforeMidnightKst, 1)).toBe("budgetExhausted");
    expect(budget.reserve("x", afterMidnightKst, 1)).toBe("ok");
    expect(budget.dailyCount(afterMidnightKst)).toBe(1);
  });
});

import { describe, it, expect } from "vitest";
import { evaluateRateLimit, type RateLimitEntry } from "../rate-limit";

/**
 * 순수 코어 evaluateRateLimit 테스트 — store·now 주입으로 결정적.
 * 고정 윈도우 카운터(IP당 windowMs 동안 limit회 허용).
 */
describe("evaluateRateLimit", () => {
  const LIMIT = 3;
  const WINDOW = 60_000;

  it("첫 요청은 허용하고 잔여를 limit-1로 센다", () => {
    const store = new Map<string, RateLimitEntry>();
    const r = evaluateRateLimit(store, "1.1.1.1", 1000, LIMIT, WINDOW);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it("윈도우 안에서 limit까지는 허용한다", () => {
    const store = new Map<string, RateLimitEntry>();
    evaluateRateLimit(store, "ip", 0, LIMIT, WINDOW); // 1
    evaluateRateLimit(store, "ip", 100, LIMIT, WINDOW); // 2
    const third = evaluateRateLimit(store, "ip", 200, LIMIT, WINDOW); // 3
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it("윈도우 안에서 limit 초과는 차단한다", () => {
    const store = new Map<string, RateLimitEntry>();
    for (let i = 0; i < LIMIT; i++) evaluateRateLimit(store, "ip", i, LIMIT, WINDOW);
    const over = evaluateRateLimit(store, "ip", LIMIT, LIMIT, WINDOW);
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it("윈도우 경과 후에는 카운터가 리셋된다", () => {
    const store = new Map<string, RateLimitEntry>();
    for (let i = 0; i < LIMIT; i++) evaluateRateLimit(store, "ip", i, LIMIT, WINDOW);
    expect(evaluateRateLimit(store, "ip", LIMIT, LIMIT, WINDOW).allowed).toBe(false);
    // 윈도우(60s)가 지나면 새 윈도우로 다시 허용
    const afterWindow = evaluateRateLimit(store, "ip", WINDOW + 1, LIMIT, WINDOW);
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.remaining).toBe(2);
  });

  it("서로 다른 키는 독립적으로 카운트한다", () => {
    const store = new Map<string, RateLimitEntry>();
    for (let i = 0; i < LIMIT; i++) evaluateRateLimit(store, "a", i, LIMIT, WINDOW);
    // a는 소진됐지만 b는 영향 없음
    expect(evaluateRateLimit(store, "a", LIMIT, LIMIT, WINDOW).allowed).toBe(false);
    expect(evaluateRateLimit(store, "b", LIMIT, LIMIT, WINDOW).allowed).toBe(true);
  });
});

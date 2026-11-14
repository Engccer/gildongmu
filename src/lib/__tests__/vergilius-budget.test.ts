import { describe, expect, it } from "vitest";
import { createVergiliusBudget, VERGILIUS_DAILY_CAP, VERGILIUS_IP_LIMIT } from "../rate-limit";

// 2026-11-14 00:00 KST(= 11-13 15:00 UTC)
const DAY_START = Date.UTC(2026, 10, 13, 15, 0, 0);

describe("베르길리우스 질문 예산(E82 spec §4)", () => {
  it("IP당 60초 10회: 11번째는 거절하고 창이 지나면 다시 받는다", () => {
    const budget = createVergiliusBudget();
    expect(VERGILIUS_IP_LIMIT).toBe(10);
    for (let i = 0; i < 10; i++) expect(budget.chargeIp("1.1.1.1", DAY_START + i)).toBe(true);
    expect(budget.chargeIp("1.1.1.1", DAY_START + 20)).toBe(false);
    expect(budget.chargeIp("2.2.2.2", DAY_START + 20)).toBe(true);
    expect(budget.chargeIp("1.1.1.1", DAY_START + 60_000)).toBe(true);
  });

  it("인스턴스 하루 300회: 301번째는 거절하고 IP와 무관하다", () => {
    const budget = createVergiliusBudget();
    expect(VERGILIUS_DAILY_CAP).toBe(300);
    for (let i = 0; i < 300; i++) expect(budget.reserveDaily(DAY_START + i * 1000)).toBe(true);
    expect(budget.reserveDaily(DAY_START + 400_000)).toBe(false);
    expect(budget.dailyCount(DAY_START + 400_000)).toBe(300);
  });

  it("하루는 KST 자정에 넘어간다", () => {
    const budget = createVergiliusBudget();
    const lastMinute = DAY_START + 86_400_000 - 60_000;
    for (let i = 0; i < 300; i++) budget.reserveDaily(lastMinute);
    expect(budget.reserveDaily(lastMinute)).toBe(false);
    expect(budget.reserveDaily(DAY_START + 86_400_000)).toBe(true);
    expect(budget.dailyCount(DAY_START + 86_400_000)).toBe(1);
  });

  it("IP 칸은 하루 상한을 올리지 않는다(검증에서 떨어진 요청은 하루 칸을 쓰지 않는다)", () => {
    const budget = createVergiliusBudget();
    for (let i = 0; i < 5; i++) budget.chargeIp("1.1.1.1", DAY_START);
    expect(budget.dailyCount(DAY_START)).toBe(0);
  });
});

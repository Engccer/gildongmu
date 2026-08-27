import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureDirections, ensureHome, ensurePlace, withOp } from "../ensure-view";
import { __resetToolLockForTest, acquireOp, runningToolName, type Op } from "../../tool-lock";
import { __resetViewRegistryForTest, currentView, publishView, setNavigator, type Navigator } from "../../view-registry";
import type { Place } from "@/lib/types";

const place: Place = { id: "p1", name: "강남역", category: "c", address: "a", roadAddress: "r", lat: 37.49, lng: 127.02 };
const nav = (over: Partial<Navigator> = {}): Navigator => ({
  toHome: async () => {},
  toDirections: () => {},
  toPlace: () => {},
  isModalOpen: () => false,
  ...over,
});
const op = () => acquireOp("t", undefined) as Op;
afterEach(() => {
  __resetViewRegistryForTest();
  __resetToolLockForTest();
});

describe("withOp", () => {
  it("잠금을 잡고 본문 뒤 finally로 푼다, 잠겨 있으면 onBusy(실행 중 이름)", async () => {
    const r = await withOp("a", undefined, async (o) => {
      expect(runningToolName()).toBe("a");
      expect(await withOp("b", undefined, async () => "no", (running) => `busy:${running}`)).toBe("busy:a");
      return o.name;
    }, () => "busy");
    expect(r).toBe("a");
    expect(runningToolName()).toBeNull();
    await expect(withOp("c", undefined, async () => { throw new Error("x"); }, () => "busy")).rejects.toThrow("x");
    expect(runningToolName()).toBeNull();
  });
});

describe("ensureHome", () => {
  it("이미 홈이면 이동 없이 홈 브릿지, 다른 뷰면 toHome 뒤 홈 브릿지", async () => {
    const home = { tag: "home" };
    publishView("home", home);
    const toHome = vi.fn(async () => {});
    setNavigator(nav({ toHome }));
    expect(await ensureHome(op())).toBe(home);
    expect(toHome).not.toHaveBeenCalled();
    const dir = { tag: "dir" };
    publishView("directions", dir);
    toHome.mockImplementation(async () => {
      // 언와인드가 길찾기 게시를 걷어 낸다.
      const { withdrawView } = await import("../../view-registry");
      withdrawView("directions", dir);
    });
    expect(await ensureHome(op())).toBe(home);
    expect(toHome).toHaveBeenCalledTimes(1);
    expect(currentView()).toBe("home");
  });
  it("모달이 열려 있으면 modalOpen, toHome이 viewChanging을 던지면 그 사유", async () => {
    publishView("home", { tag: "home" });
    publishView("directions", { tag: "dir" });
    setNavigator(nav({ isModalOpen: () => true }));
    expect(await ensureHome(op())).toMatchObject({ ok: false, reason: "modalOpen" });
    __resetToolLockForTest();
    setNavigator(nav({ toHome: async () => { throw new Error("viewChanging"); } }));
    expect(await ensureHome(op())).toMatchObject({ ok: false, reason: "viewChanging", retryable: true });
    expect(currentView()).toBe("directions");
  });
});

describe("ensurePlace / ensureDirections", () => {
  it("같은 placeId 게시면 이동 없음, 다른 장소면 toPlace 뒤 그 id 게시를 기다린다(다른 id는 불일치)", async () => {
    const a = { placeId: "p0" };
    publishView("place", a, "p0");
    const toPlace = vi.fn((p: Place) => {
      setTimeout(() => publishView("place", { placeId: "wrong" }, "wrong"), 5);
      setTimeout(() => publishView("place", { placeId: p.id }, p.id), 10);
    });
    setNavigator(nav({ toPlace }));
    const r = await ensurePlace(place, op());
    expect(r).toEqual({ placeId: "p1" });
    expect(toPlace).toHaveBeenCalledTimes(1);
    __resetToolLockForTest();
    expect(await ensurePlace(place, op())).toEqual({ placeId: "p1" });
    expect(toPlace).toHaveBeenCalledTimes(1);
  });
  it("길찾기: 이동 시작 이후 게시만 일치, 상한 초과는 viewChanging", async () => {
    publishView("home", { tag: "home" });
    const toDirections = vi.fn(() => {
      setTimeout(() => publishView("directions", { tag: "d1" }), 5);
    });
    setNavigator(nav({ toDirections }));
    expect(await ensureDirections(op())).toEqual({ tag: "d1" });
    __resetViewRegistryForTest();
    __resetToolLockForTest();
    publishView("home", { tag: "home" });
    setNavigator(nav({ toDirections: () => {} }));
    vi.useFakeTimers();
    const p = ensureDirections(op());
    await vi.advanceTimersByTimeAsync(2_001);
    expect(await p).toMatchObject({ ok: false, reason: "viewChanging" });
    vi.useRealTimers();
  });
});

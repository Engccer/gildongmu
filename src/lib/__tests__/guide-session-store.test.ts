import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetGuideSessionStoreForTest,
  claimGuideSession,
  clearRetainedGuideSnapshot,
  hasActiveGuideSession,
  publishGuideSnapshot,
  readGuideSnapshot,
  releaseGuideSession,
  stopActiveGuideSession,
} from "../guide-session-store";

beforeEach(() => __resetGuideSessionStoreForTest());

describe("guide-session-store — 스냅샷 슬롯(WebMCP spec §5.2)", () => {
  it("claim은 starting부터 점유하고 sessionId를 올린다", () => {
    const stop = vi.fn();
    claimGuideSession(stop);
    expect(readGuideSnapshot()).toEqual({ status: "starting", sessionId: 1 });
    expect(hasActiveGuideSession()).toBe(true);
    const stop2 = vi.fn();
    claimGuideSession(stop2);
    expect(stop).toHaveBeenCalledTimes(1); // 다른 소유자는 먼저 중지된다(기존 계약)
    expect(readGuideSnapshot().sessionId).toBe(2);
  });

  it("소유자만 게시할 수 있다 — 비소유 인스턴스의 idle 게시가 활성 값을 덮지 않는다", () => {
    const owner = vi.fn();
    const other = vi.fn();
    claimGuideSession(owner);
    publishGuideSnapshot(owner, { status: "tracking", mode: "walk", now: "100m 직진" });
    publishGuideSnapshot(other, { status: "idle" });
    expect(readGuideSnapshot()).toMatchObject({ status: "tracking", mode: "walk", now: "100m 직진", sessionId: 1 });
  });

  it("release는 유지 표식이 없으면 idle로, 있으면(done·failed) 남긴다", () => {
    const owner = vi.fn();
    claimGuideSession(owner);
    publishGuideSnapshot(owner, { status: "tracking", mode: "walk" });
    releaseGuideSession(owner);
    expect(readGuideSnapshot()).toEqual({ status: "idle" });

    claimGuideSession(owner);
    publishGuideSnapshot(owner, { status: "done", mode: "walk", now: "도착했습니다" }, { retain: true });
    releaseGuideSession(owner);
    expect(hasActiveGuideSession()).toBe(false);
    expect(readGuideSnapshot()).toMatchObject({ status: "done", now: "도착했습니다" });
    // 화면이 지우는 시점에만 사라진다.
    clearRetainedGuideSnapshot();
    expect(readGuideSnapshot()).toEqual({ status: "idle" });
  });

  it("남긴 done은 다음 claim이 지운다", () => {
    const a = vi.fn();
    claimGuideSession(a);
    publishGuideSnapshot(a, { status: "done" }, { retain: true });
    releaseGuideSession(a);
    const b = vi.fn();
    claimGuideSession(b);
    expect(readGuideSnapshot()).toEqual({ status: "starting", sessionId: 2 });
  });

  it("stopActiveGuideSession은 starting 중이어도 소유자의 stop을 부르고 스냅샷을 비운다", () => {
    const owner = vi.fn();
    claimGuideSession(owner);
    expect(readGuideSnapshot().status).toBe("starting");
    expect(stopActiveGuideSession()).toBe(true);
    expect(owner).toHaveBeenCalledTimes(1);
    expect(readGuideSnapshot()).toEqual({ status: "idle" });
    expect(stopActiveGuideSession()).toBe(false);
  });

  it("clearRetainedGuideSnapshot은 활성 세션을 건드리지 않는다", () => {
    const owner = vi.fn();
    claimGuideSession(owner);
    publishGuideSnapshot(owner, { status: "tracking" });
    clearRetainedGuideSnapshot();
    expect(readGuideSnapshot().status).toBe("tracking");
  });

  it("늦은 release가 새 소유자를 지우지 않는다", () => {
    const a = vi.fn();
    const b = vi.fn();
    claimGuideSession(a);
    claimGuideSession(b);
    publishGuideSnapshot(b, { status: "tracking", mode: "transit" });
    releaseGuideSession(a);
    expect(readGuideSnapshot().status).toBe("tracking");
    expect(hasActiveGuideSession()).toBe(true);
  });
});

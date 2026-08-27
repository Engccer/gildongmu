import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetGuideSessionStoreForTest,
  claimGuideSession,
  hasActiveGuideSession,
  releaseGuideSession,
  stopActiveGuideSession,
} from "../guide-session-store";

beforeEach(() => __resetGuideSessionStoreForTest());

describe("guide-session-store — 세션 단일성(B1 §3.3)", () => {
  it("claim은 점유하고, 다른 소유자의 claim은 앞 세션을 먼저 중지시킨다", () => {
    const stop = vi.fn();
    claimGuideSession(stop);
    expect(hasActiveGuideSession()).toBe(true);
    const stop2 = vi.fn();
    claimGuideSession(stop2);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(hasActiveGuideSession()).toBe(true);
  });

  it("release는 자기 소유일 때만 비운다", () => {
    const owner = vi.fn();
    claimGuideSession(owner);
    releaseGuideSession(owner);
    expect(hasActiveGuideSession()).toBe(false);
  });

  it("stopActiveGuideSession은 소유자의 stop을 부르고 비운다", () => {
    const owner = vi.fn();
    claimGuideSession(owner);
    expect(stopActiveGuideSession()).toBe(true);
    expect(owner).toHaveBeenCalledTimes(1);
    expect(hasActiveGuideSession()).toBe(false);
    expect(stopActiveGuideSession()).toBe(false);
  });

  it("늦은 release가 새 소유자를 지우지 않는다", () => {
    const a = vi.fn();
    const b = vi.fn();
    claimGuideSession(a);
    claimGuideSession(b);
    releaseGuideSession(a);
    expect(hasActiveGuideSession()).toBe(true);
  });
});

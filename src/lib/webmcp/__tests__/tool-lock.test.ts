import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OP_TIMEOUT_MS,
  __resetToolLockForTest,
  acquireOp,
  releaseOp,
  runningToolName,
} from "../tool-lock";

type LiveOp = Exclude<ReturnType<typeof acquireOp>, { busy: string }>;

afterEach(() => {
  __resetToolLockForTest();
  vi.useRealTimers();
});

describe("tool-lock(spec §3.0)", () => {
  it("둘째 호출은 busy{running}이고 release 뒤 다시 잡힌다", () => {
    const a = acquireOp("search_places", undefined);
    expect("busy" in a).toBe(false);
    expect(acquireOp("get_place_info", undefined)).toEqual({ busy: "search_places" });
    expect(runningToolName()).toBe("search_places");
    releaseOp(a as LiveOp);
    expect(runningToolName()).toBeNull();
    expect("busy" in acquireOp("get_place_info", undefined)).toBe(false);
  });

  it("전체 상한이 지나면 op.signal이 끊기고 isLive()가 false다", () => {
    vi.useFakeTimers();
    const op = acquireOp("x", undefined) as LiveOp;
    vi.advanceTimersByTime(OP_TIMEOUT_MS + 1);
    expect(op.signal.aborted).toBe(true);
    expect(op.isLive()).toBe(false);
    expect(runningToolName()).toBeNull();
  });

  it("호스트 signal abort가 op에 전파되고 잠금이 풀린다", () => {
    const host = new AbortController();
    const op = acquireOp("x", host.signal) as LiveOp;
    host.abort();
    expect(op.signal.aborted).toBe(true);
    expect(runningToolName()).toBeNull();
  });

  it("release된 옛 op는 isLive() false — 늦은 완료 무시의 근거", () => {
    const op = acquireOp("x", undefined) as LiveOp;
    releaseOp(op);
    expect(op.isLive()).toBe(false);
  });
});

describe("tool-lock 끊긴 호스트 signal(리뷰 반영)", () => {
  it("이미 abort된 hostSignal로는 잠금을 잡지 않고 끊긴 op를 돌려준다", () => {
    const host = new AbortController();
    host.abort();
    const op = acquireOp("x", host.signal);
    expect("busy" in op).toBe(false);
    expect((op as Op).isLive()).toBe(false);
    expect(runningToolName()).toBeNull();
    expect("busy" in acquireOp("y", undefined)).toBe(false);
  });
});

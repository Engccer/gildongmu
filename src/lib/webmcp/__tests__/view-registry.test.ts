import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetToolLockForTest, acquireOp, releaseOp, type Op } from "../tool-lock";
import {
  __resetViewRegistryForTest,
  bridgeOf,
  currentSeq,
  currentView,
  markChanging,
  publishView,
  waitForView,
  withdrawView,
} from "../view-registry";

const op = () => acquireOp("t", undefined) as Op;
afterEach(() => {
  __resetViewRegistryForTest();
  __resetToolLockForTest();
  vi.useRealTimers();
});

describe("view-registry(spec §5.2)", () => {
  it("게시·철회·정체성 가드: 옛 브릿지의 withdraw는 새 게시를 지우지 않는다", () => {
    const a = { tag: "A" };
    const b = { tag: "B" };
    publishView("place", a, "p1");
    publishView("place", b, "p2");
    withdrawView("place", a);
    expect(bridgeOf("place")?.identity).toBe("p2");
    expect(currentView()).toBe("place");
  });

  it("waitForView는 뷰 이름만으로 일치하지 않는다 — placeId·publishedAfter", async () => {
    publishView("place", { tag: "A" }, "p1");
    const seqBefore = currentSeq();
    const o = op();
    const p = waitForView<{ tag: string }>("place", { placeId: "p2" }, o, 50);
    publishView("place", { tag: "B" }, "p2");
    await expect(p).resolves.toEqual({ tag: "B" });
    const q = waitForView("directions", { publishedAfter: seqBefore }, o, 50);
    publishView("directions", { tag: "D" });
    await expect(q).resolves.toEqual({ tag: "D" });
    // 순번 축: 이미 게시된 브릿지는 publishedAfter 뒤가 아니면 일치가 아니다 — 재게시만 푼다.
    let settled = false;
    const r = waitForView<{ tag: string }>("directions", { publishedAfter: currentSeq() }, o, 50).then(
      (v) => { settled = true; return v; },
    );
    await new Promise((res) => setTimeout(res, 5));
    expect(settled).toBe(false);
    publishView("directions", { tag: "D2" });
    await expect(r).resolves.toEqual({ tag: "D2" });
  });

  it("이미 일치 게시면 즉시, 상한 초과는 viewChanging", async () => {
    publishView("directions", { tag: "D" });
    const o1 = op();
    await expect(waitForView("directions", { publishedAfter: 0 }, o1, 10)).resolves.toEqual({ tag: "D" });
    // 단일 실행 잠금이라 다음 op를 잡으려면 앞 op를 먼저 놓아야 한다.
    releaseOp(o1);
    __resetViewRegistryForTest();
    await expect(waitForView("place", { placeId: "x" }, op(), 10)).rejects.toThrow("viewChanging");
  });

  it("이미 끊긴 op의 waitForView는 즉시 aborted다(리뷰 반영)", async () => {
    const host = new AbortController();
    const o = acquireOp("t", host.signal) as Op;
    host.abort();
    await expect(waitForView("place", { placeId: "x" }, o, 500)).rejects.toThrow("aborted");
  });

  it("markChanging 중엔 currentView가 changing이다", () => {
    publishView("home", { tag: "H" });
    const o = op();
    markChanging(o);
    expect(currentView()).toBe("changing");
    markChanging(null);
    expect(currentView()).toBe("home");
  });
});

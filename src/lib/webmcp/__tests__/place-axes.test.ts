import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetToolLockForTest, acquireOp, releaseOp, type Op } from "../tool-lock";
import { createAxisRegistry } from "../place-axes";
import type { AxisSnapshot, AxisSource } from "../tools/context";

/** 커밋 지연을 흉내 내는 가짜 소스: `load`는 pending 세대를 예약만 하고 `commit()`이 반영한다. */
function fakeSource(initial: AxisSnapshot = { status: "idle", gen: 0 }) {
  let snap = initial;
  let pendingGen: number | null = null;
  const load = vi.fn((force: boolean) => {
    pendingGen = snap.gen + 1;
    void force;
  });
  const source: AxisSource = { read: () => snap, load };
  return {
    source,
    load,
    /** React 커밋 흉내 — 예약된 세대를 loading으로 반영 */
    commitLoading() {
      if (pendingGen === null) throw new Error("no pending load");
      snap = { status: "loading", gen: pendingGen, data: snap.data };
      pendingGen = null;
    },
    commit(next: Partial<AxisSnapshot>) {
      snap = { ...snap, ...next };
    },
  };
}

const op = () => acquireOp("t", undefined) as Op;
afterEach(__resetToolLockForTest);

describe("place-axes(spec §5.4)", () => {
  it("present:false는 absentOutcome, settleWithoutSource는 소스 없이 정착", async () => {
    const r = createAxisRegistry();
    const a = r.makeEntry("arrivals", { present: false, kind: "trigger", absentOutcome: "notConfigured" });
    const o = op();
    expect(await a.ensureLoaded(o)).toEqual({ kind: "notConfigured" });
    expect(a.read()).toEqual({ status: "notConfigured", gen: 0 });
    const b = r.makeEntry("basic", {
      present: true,
      kind: "mount",
      absentOutcome: "notApplicable",
      settleWithoutSource: { status: "notApplicable", gen: 0 },
    });
    expect(await b.ensureLoaded(o)).toEqual({ kind: "settled", snapshot: { status: "notApplicable", gen: 0 } });
  });

  it("attach 전 호출은 attach를 기다리고, idle이면 tool 소스로 load한 뒤 커밋 뒤 정착한다", async () => {
    const r = createAxisRegistry();
    const e = r.makeEntry("facilities", { present: true, kind: "trigger", absentOutcome: "notApplicable" });
    const o = op();
    const p = e.ensureLoaded(o);
    const f = fakeSource();
    r.registrar.attach("facilities", f.source);
    await Promise.resolve();
    expect(f.load).toHaveBeenCalledWith(false, "tool");
    // 커밋 전(gen 0, idle) — 아직 대기
    r.notifyCommit();
    f.commitLoading();
    r.notifyCommit();
    f.commit({ status: "done", data: { lines: ["a"] } });
    r.notifyCommit();
    expect(await p).toEqual({ kind: "settled", snapshot: { status: "done", gen: 1, data: { lines: ["a"] } } });
  });

  it("이미 done이면 load 없이 즉시 settled, refresh는 load(true)로 직전 데이터를 들고 기다린다", async () => {
    const r = createAxisRegistry();
    const f = fakeSource({ status: "done", gen: 3, data: { lines: ["old"] } });
    r.registrar.attach("timetable", f.source);
    const e = r.makeEntry("timetable", { present: true, kind: "mount", absentOutcome: "notApplicable" });
    const o = op();
    expect(await e.ensureLoaded(o)).toMatchObject({ kind: "settled", snapshot: { gen: 3 } });
    expect(f.load).not.toHaveBeenCalled();
    const p = e.refresh(o);
    expect(f.load).toHaveBeenCalledWith(true, "tool");
    f.commitLoading();
    r.notifyCommit();
    f.commit({ status: "done", refreshError: true });
    r.notifyCommit();
    expect(await p).toEqual({ kind: "settled", snapshot: { status: "done", gen: 4, data: { lines: ["old"] }, refreshError: true } });
  });

  it("대기 중 사용자가 같은 축을 다시 건드리면(세대 초과) superseded", async () => {
    const r = createAxisRegistry();
    const f = fakeSource();
    r.registrar.attach("arrivals", f.source);
    const e = r.makeEntry("arrivals", { present: true, kind: "trigger", absentOutcome: "notApplicable" });
    const p = e.ensureLoaded(op());
    f.commitLoading();
    r.notifyCommit();
    f.commit({ status: "idle", gen: 2 }); // 사용자 닫기 = gen 증가
    r.notifyCommit();
    expect(await p).toEqual({ kind: "superseded" });
  });

  it("진행 중(loading)이면 load를 다시 부르지 않고 그 세대를 기다린다", async () => {
    const r = createAxisRegistry();
    const f = fakeSource({ status: "loading", gen: 5 });
    r.registrar.attach("facilitiesMetro", f.source);
    const e = r.makeEntry("facilitiesMetro", { present: true, kind: "trigger", absentOutcome: "notApplicable" });
    const p = e.refresh(op());
    expect(f.load).not.toHaveBeenCalled();
    f.commit({ status: "empty" });
    r.notifyCommit();
    expect(await p).toMatchObject({ kind: "settled", snapshot: { status: "empty", gen: 5 } });
  });

  it("teardown은 attach 대기자·정착 대기자 전부를 aborted로, op 해제도 aborted", async () => {
    const r = createAxisRegistry();
    const e = r.makeEntry("barrierFree", { present: true, kind: "mount", absentOutcome: "notConfigured" });
    const o1 = op();
    const waitingAttach = e.ensureLoaded(o1);
    r.teardown();
    expect(await waitingAttach).toEqual({ kind: "aborted" });

    const r2 = createAxisRegistry();
    const f = fakeSource();
    r2.registrar.attach("barrierFree", f.source);
    const e2 = r2.makeEntry("barrierFree", { present: true, kind: "mount", absentOutcome: "notConfigured" });
    releaseOp(o1);
    const o2 = op();
    const p = e2.ensureLoaded(o2);
    f.commitLoading();
    r2.notifyCommit();
    releaseOp(o2);
    r2.notifyCommit();
    expect(await p).toEqual({ kind: "aborted" });
  });

  it("arm은 teardown을 되돌린다(StrictMode 이중 effect)", async () => {
    const r = createAxisRegistry();
    r.teardown();
    r.arm();
    const f = fakeSource({ status: "done", gen: 1 });
    r.registrar.attach("basic", f.source);
    const e = r.makeEntry("basic", { present: true, kind: "mount", absentOutcome: "notApplicable" });
    expect(await e.ensureLoaded(op())).toMatchObject({ kind: "settled" });
  });

  it("detach는 같은 소스일 때만 지운다(리마운트 옛 cleanup 가드)", () => {
    const r = createAxisRegistry();
    const a = fakeSource(), b = fakeSource({ status: "done", gen: 1 });
    const detachA = r.registrar.attach("basic", a.source);
    r.registrar.attach("basic", b.source);
    detachA();
    const e = r.makeEntry("basic", { present: true, kind: "mount", absentOutcome: "notApplicable" });
    expect(e.read()).toMatchObject({ status: "done", gen: 1 });
  });
});

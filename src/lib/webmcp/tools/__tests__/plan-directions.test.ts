import { afterEach, describe, expect, it, vi } from "vitest";
import { planDirectionsTool } from "../plan-directions";
import { __resetViewRegistryForTest, publishView, setNavigator } from "../../view-registry";
import { __resetToolLockForTest } from "../../tool-lock";
import { __resetToolBudgetForTest } from "../../tool-budget";
import { __setNonceForTest, encodeRef } from "../../place-refs";
import type { DirectionsBridge, HomeBridge, PlanRequest, ToolPlan } from "../context";
import type { JusoAddress, Place } from "@/lib/types";

const station: Place = { id: "s1", name: "강동역", category: "지하철역", address: "a", roadAddress: "r", lat: 37.53, lng: 127.12 };
const juso: JusoAddress = { roadAddr: "서울 강동구 성내로 12", roadAddrPart1: "서울 강동구 성내로 12", jibunAddr: "", engAddr: "", zipNo: "", bdNm: "" };
const home = (): HomeBridge => ({
  read: () => ({ query: "강동역", sort: "accuracy", attempt: 1, branches: null, counts: { places: 1, addresses: 1, web: 0 }, chatOpen: false, webResults: [] }),
  runSearch: async () => ({ kind: "busy" }),
  snapshotFor: () => ({ attempt: 1, query: "강동역", sort: "accuracy", places: [station], addresses: [juso] }),
  openAddress: async () => ({ ok: true }),
});
const plan = (): ToolPlan => ({
  planId: "P1", destination: "강동역", resolved: { from: "현재 위치", to: "강동역", via: null, avoidStairs: false },
  routeRefs: { refOf: () => null, keyOf: () => null, size: 0 }, transit: null, car: null, modes: ["walk"],
  walk: { outcome: "done", steps: ["직진"], startable: true },
});
function directions(runQuery: DirectionsBridge["runQuery"]): DirectionsBridge {
  return { read: () => ({ fields: { from: "", to: "", via: null, avoidStairs: false }, phase: "settled", plan: plan(), lang: "ko" }), runQuery };
}
afterEach(() => {
  __resetViewRegistryForTest();
  __resetToolLockForTest();
  __resetToolBudgetForTest();
  vi.unstubAllGlobals();
});
const call = async (input: Record<string, unknown>) => JSON.parse(await planDirectionsTool().execute(input));

describe("plan_directions W2(spec §3.4)", () => {
  it("toRef는 좌표 endpoint로 runQuery에 실리고 텍스트 해석(fetch)을 하지 않는다; 출력에 view", async () => {
    __setNonceForTest("n");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    publishView("home", home());
    const runQuery = vi.fn<DirectionsBridge["runQuery"]>(async () => ({ kind: "settled", planId: "P1" }));
    publishView("directions", directions(runQuery));
    setNavigator({ toHome: async () => {}, toDirections: () => {}, toPlace: () => {}, isModalOpen: () => false });
    const out = await call({ toRef: encodeRef(1, "p", 0) });
    expect(out).toMatchObject({ ok: true, view: "directions", planId: "P1" });
    expect(fetchSpy).not.toHaveBeenCalled();
    const req: PlanRequest = runQuery.mock.calls[0][0];
    expect(req.to).toEqual({ kind: "place", label: "강동역", coord: { lat: 37.53, lng: 127.12 } });
    expect(req.from).toEqual({ kind: "current" });
  });
  it("to와 toRef 둘 다면 unsupported toAndToRef, 둘 다 없으면 toNotFound, 옛 ref는 staleResult", async () => {
    __setNonceForTest("n");
    publishView("home", home());
    publishView("directions", directions(async () => ({ kind: "settled", planId: "P1" })));
    setNavigator({ toHome: async () => {}, toDirections: () => {}, toPlace: () => {}, isModalOpen: () => false });
    expect(await call({ to: "x", toRef: "y" })).toMatchObject({ ok: false, reason: "unsupported", detail: "toAndToRef" });
    __resetToolLockForTest();
    expect(await call({})).toMatchObject({ ok: false, reason: "toNotFound" });
    __resetToolLockForTest();
    expect(await call({ toRef: encodeRef(0, "p", 0) })).toMatchObject({ ok: false, reason: "staleResult", recovery: "search_places" });
  });
  it("길찾기 뷰가 아니면 toDirections 뒤 publishedAfter 일치 게시를 기다린다; 모달이면 modalOpen", async () => {
    __setNonceForTest("n");
    publishView("home", home());
    const runQuery = vi.fn<DirectionsBridge["runQuery"]>(async () => ({ kind: "settled", planId: "P1" }));
    const toDirections = vi.fn(() => setTimeout(() => publishView("directions", directions(runQuery)), 5));
    setNavigator({ toHome: async () => {}, toDirections, toPlace: () => {}, isModalOpen: () => false });
    expect(await call({ toRef: encodeRef(1, "p", 0) })).toMatchObject({ ok: true, view: "directions" });
    expect(toDirections).toHaveBeenCalledTimes(1);
    __resetToolLockForTest();
    __resetToolBudgetForTest();
    __resetViewRegistryForTest();
    publishView("home", home());
    setNavigator({ toHome: async () => {}, toDirections: () => {}, toPlace: () => {}, isModalOpen: () => true });
    expect(await call({ toRef: encodeRef(1, "p", 0) })).toMatchObject({ ok: false, reason: "modalOpen" });
  });
  it("주소 ref는 지오코딩으로 endpoint, 실패는 geocodeFailed", async () => {
    __setNonceForTest("n");
    publishView("home", home());
    const runQuery = vi.fn<DirectionsBridge["runQuery"]>(async () => ({ kind: "settled", planId: "P1" }));
    publishView("directions", directions(runQuery));
    setNavigator({ toHome: async () => {}, toDirections: () => {}, toPlace: () => {}, isModalOpen: () => false });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ matches: [{ lat: 37.5, lng: 127.1 }] }) })));
    expect(await call({ toRef: encodeRef(1, "a", 0) })).toMatchObject({ ok: true });
    expect(runQuery.mock.calls[0][0].to).toEqual({ kind: "place", label: "서울 강동구 성내로 12", coord: { lat: 37.5, lng: 127.1 } });
    __resetToolLockForTest();
    __resetToolBudgetForTest();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await call({ toRef: encodeRef(1, "a", 0) })).toMatchObject({ ok: false, reason: "geocodeFailed", retryable: true });
  });
  it("sessionActive는 화면이 낸 그대로(세션을 끊지 않는다), 잠금 중엔 busy{running}", async () => {
    __setNonceForTest("n");
    publishView("home", home());
    publishView("directions", directions(async () => ({ kind: "sessionActive" })));
    setNavigator({ toHome: async () => {}, toDirections: () => {}, toPlace: () => {}, isModalOpen: () => false });
    expect(await call({ toRef: encodeRef(1, "p", 0) })).toMatchObject({ ok: false, reason: "sessionActive", userActionRequired: true });
    __resetToolLockForTest();
    __resetToolBudgetForTest();
    let release!: () => void;
    publishView("directions", directions(() => new Promise((r) => (release = () => r({ kind: "settled", planId: "P1" })))));
    const first = call({ toRef: encodeRef(1, "p", 0) });
    await Promise.resolve();
    expect(await call({ toRef: encodeRef(1, "p", 0) })).toMatchObject({ ok: false, reason: "busy", running: "plan_directions" });
    release();
    expect((await first).ok).toBe(true);
  });
});

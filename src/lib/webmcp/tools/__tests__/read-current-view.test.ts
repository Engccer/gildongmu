import { afterEach, describe, expect, it } from "vitest";
import { readCurrentViewTool } from "../read-current-view";
import { __resetViewRegistryForTest, markChanging, markNearby, publishView } from "../../view-registry";
import { __resetToolLockForTest, acquireOp, type Op } from "../../tool-lock";
import type { HomeBridge } from "../context";

afterEach(() => {
  __resetViewRegistryForTest();
  __resetToolLockForTest();
});
const home = (q = "강남"): HomeBridge => ({
  read: () => ({ query: q, sort: "accuracy", attempt: q ? 1 : null, branches: q ? { places: "done", addresses: "empty", web: "skipped" } : null, counts: { places: q ? 3 : 0, addresses: 0, web: 0 }, chatOpen: false, webResults: [] }),
  runSearch: async () => ({ kind: "busy" }),
  snapshotFor: () => null,
  openAddress: async () => ({ ok: true }),
});
const call = async () => JSON.parse(await readCurrentViewTool().execute({}));

describe("read_current_view(spec §3.6)", () => {
  it("홈: query·sort·searchRef·branches·counts·chatOpen", async () => {
    publishView("home", home());
    expect(await call()).toMatchObject({ ok: true, view: "home", query: "강남", searchRef: "1", branches: { places: "done" }, counts: { places: 3 }, chatOpen: false });
  });
  it("도구 이동 중이면 viewChanging + toolRunning, 화면 데이터 없음", async () => {
    publishView("home", home(""));
    const op = acquireOp("get_place_info", undefined) as Op;
    markChanging(op);
    const out = await call();
    expect(out).toMatchObject({ ok: false, reason: "viewChanging", toolRunning: "get_place_info", retryable: true });
    expect(out.query).toBeUndefined();
  });
  it("허브는 view nearby와 note, 상세는 name·isStation·axes status, 길찾기는 guidanceActive", async () => {
    publishView("home", home());
    markNearby(true);
    expect(await call()).toMatchObject({ ok: true, view: "nearby", note: "no tools on this screen" });
    markNearby(false);
    const entry = (present: boolean, status: string) => ({ axis: "x", present, kind: "mount", read: () => ({ status, gen: 0 }), ensureLoaded: async () => ({ kind: "aborted" }), refresh: async () => ({ kind: "aborted" }) });
    publishView("place", {
      placeId: "p",
      read: () => ({ name: "강동역", category: "c", isStation: true, addressLines: {}, chatOpen: true }),
      axes: { basic: entry(true, "done"), timetable: entry(true, "loading"), facilities: entry(true, "idle"), facilitiesMetro: entry(true, "idle"), arrivals: entry(false, "idle"), barrierFree: entry(true, "empty") },
    }, "p");
    const place = await call();
    expect(place).toMatchObject({ view: "place", name: "강동역", isStation: true, chatOpen: true });
    expect(place.axes).toContainEqual({ axis: "arrivals", status: "notConfigured" });
    expect(place.axes).toContainEqual({ axis: "timetable", status: "loading" });
    publishView("directions", { read: () => ({ fields: { from: "a", to: "b", via: null, avoidStairs: false }, phase: "idle", plan: null, lang: "ko" }), runQuery: async () => ({ kind: "busy" }) });
    expect(await call()).toMatchObject({ view: "directions", phase: "idle", plan: null, guidanceActive: false });
  });
});

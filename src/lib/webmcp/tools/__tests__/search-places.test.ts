import { afterEach, describe, expect, it, vi } from "vitest";
import { searchPlacesTool } from "../search-places";
import { __resetViewRegistryForTest, publishView, setNavigator } from "../../view-registry";
import { __resetToolLockForTest } from "../../tool-lock";
import { __resetToolBudgetForTest } from "../../tool-budget";
import { __setNonceForTest } from "../../place-refs";
import { assertNoCoordinates } from "../../output";
import type { HomeBridge } from "../context";

afterEach(() => {
  __resetViewRegistryForTest();
  __resetToolLockForTest();
  __resetToolBudgetForTest();
});
const nav = (modal = false) =>
  setNavigator({ toHome: async () => {}, toDirections: () => {}, toPlace: () => {}, isModalOpen: () => modal });
function home(overrides: Partial<HomeBridge> = {}, web: Array<{ title: string; url: string; snippet: string }> = []): HomeBridge {
  const snap = {
    attempt: 1,
    query: "강남역",
    sort: "accuracy" as const,
    places: [{ id: "p1", name: "강남역", category: "지하철역", address: "a", roadAddress: "r", lat: 37.49, lng: 127.02, phone: "02-1", distanceMeters: 1200 }],
    addresses: [{ roadAddr: "서울 강동구 성내로 12", roadAddrPart1: "서울 강동구 성내로 12", jibunAddr: "성내동 540", engAddr: "12 Seongnae-ro", zipNo: "05397", bdNm: "" }],
  };
  return {
    read: () => ({ query: "강남역", sort: "accuracy", attempt: 1, branches: { places: "done", addresses: "done", web: "skipped" }, counts: { places: 1, addresses: 1, web: web.length }, chatOpen: false, webResults: web }),
    runSearch: async () => ({ kind: "settled", attempt: 1, branches: { places: "done", addresses: "done", web: "skipped" } }),
    snapshotFor: () => snap,
    openAddress: async () => ({ ok: true }),
    ...overrides,
  };
}

describe("search_places(spec §3.2)", () => {
  it("홈에서 검색 → places·addresses에 ref, isStation·거리 표기, 좌표 없음", async () => {
    __setNonceForTest("n");
    publishView("home", home());
    nav();
    const raw = await searchPlacesTool().execute({ query: "강남역" });
    const out = JSON.parse(raw);
    expect(out).toMatchObject({
      ok: true,
      view: "home",
      query: "강남역",
      places: [{ ref: "n.1.p.0", name: "강남역", isStation: true, phone: "02-1", distance: "1.2km" }],
      addresses: [{ ref: "n.1.a.0", road: "서울 강동구 성내로 12", zip: "05397", english: "12 Seongnae-ro" }],
    });
    expect(assertNoCoordinates(raw)).toBeNull();
    expect(raw).not.toMatch(/lat|lng/);
  });
  it("모달이 열려 있으면 modalOpen(이동 없음), 홈이면 모달과 무관하게 검색한다", async () => {
    publishView("home", home());
    publishView("directions", { tag: "d" });
    nav(true);
    expect(JSON.parse(await searchPlacesTool().execute({ query: "x" }))).toMatchObject({ ok: false, reason: "modalOpen", userActionRequired: true });
  });
  it("빈 질의는 unsupported emptyQuery, 연속 호출은 cooldown, 잠금 중엔 busy", async () => {
    publishView("home", home());
    nav();
    expect(JSON.parse(await searchPlacesTool().execute({ query: "  " }))).toMatchObject({ ok: false, reason: "unsupported", detail: "emptyQuery" });
    expect(JSON.parse(await searchPlacesTool().execute({ query: "a" })).ok).toBe(true);
    expect(JSON.parse(await searchPlacesTool().execute({ query: "a" }))).toMatchObject({ ok: false, reason: "cooldown", retryable: true });
    let release!: () => void;
    const slow = home({ runSearch: () => new Promise((r) => (release = () => r({ kind: "settled", attempt: 1, branches: { places: "done", addresses: "done", web: "skipped" } }))) });
    __resetToolBudgetForTest();
    __resetViewRegistryForTest();
    publishView("home", slow);
    nav();
    const first = searchPlacesTool().execute({ query: "b" });
    expect(JSON.parse(await searchPlacesTool().execute({ query: "c" }))).toMatchObject({ ok: false, reason: "busy", running: "search_places" });
    release();
    expect(JSON.parse(await first).ok).toBe(true);
  });
  it("web url은 origin+path, 좌표쌍 path면 url 생략; 장소·주소 둘 다 error면 searchFailed", async () => {
    publishView("home", home({}, [
      { title: "a", url: "https://a.b/x?lat=1&lng=2", snippet: "s" },
      { title: "b", url: "https://a.b/place/37.52,127.12", snippet: "s" },
    ]));
    nav();
    const out = JSON.parse(await searchPlacesTool().execute({ query: "q" }));
    expect(out.web).toEqual([{ title: "a", url: "https://a.b/x", snippet: "s" }, { title: "b", snippet: "s" }]);
    __resetToolBudgetForTest();
    __resetViewRegistryForTest();
    publishView("home", home({ runSearch: async () => ({ kind: "settled", attempt: 1, branches: { places: "error", addresses: "error", web: "skipped" } }) }));
    nav();
    expect(JSON.parse(await searchPlacesTool().execute({ query: "q" }))).toMatchObject({ ok: false, reason: "searchFailed" });
  });
  it("superseded·aborted는 그대로 사유로", async () => {
    publishView("home", home({ runSearch: async () => ({ kind: "superseded" }) }));
    nav();
    expect(JSON.parse(await searchPlacesTool().execute({ query: "q" }))).toMatchObject({ ok: false, reason: "superseded" });
  });
});

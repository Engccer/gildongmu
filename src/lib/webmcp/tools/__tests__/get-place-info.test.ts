import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlaceInfoTool } from "../get-place-info";
import { __resetViewRegistryForTest, publishView, setNavigator } from "../../view-registry";
import { __resetToolLockForTest } from "../../tool-lock";
import { __resetToolBudgetForTest, checkBudget } from "../../tool-budget";
import { __setNonceForTest, encodeRef } from "../../place-refs";
import { assertNoCoordinates } from "../../output";
import type { AxisEntry, AxisKey, AxisOutcome, AxisSnapshot, HomeBridge, PlaceBridge } from "../context";
import type { JusoAddress, Place } from "@/lib/types";

const station: Place = { id: "s1", name: "강동역", category: "교통,수송 > 지하철,전철", address: "a", roadAddress: "r", lat: 37.53, lng: 127.12, phone: "02-9" };
const cafe: Place = { id: "c1", name: "카페", category: "카페", address: "a", roadAddress: "r", lat: 37.5, lng: 127.0 };
const juso: JusoAddress = { roadAddr: "서울 강동구 성내로 12", roadAddrPart1: "서울 강동구 성내로 12", jibunAddr: "성내동 540", engAddr: "12 Seongnae-ro", zipNo: "05397", bdNm: "" };

function home(): HomeBridge {
  const snap = { attempt: 2, query: "강동역", sort: "accuracy" as const, places: [station, cafe], addresses: [juso] };
  return {
    read: () => ({ query: "강동역", sort: "accuracy", attempt: 2, branches: { places: "done", addresses: "done", web: "skipped" }, counts: { places: 2, addresses: 1, web: 0 }, chatOpen: false, webResults: [] }),
    runSearch: async () => ({ kind: "busy" }),
    snapshotFor: (a) => (a === 2 ? snap : null),
    openAddress: vi.fn(async () => ({ ok: true as const })),
  };
}
type EntrySpec = { present?: boolean; snapshot?: AxisSnapshot; absent?: "notConfigured" | "notApplicable"; refreshSnapshot?: AxisSnapshot };
function entry(axis: AxisKey, spec: EntrySpec): AxisEntry {
  const present = spec.present ?? true;
  const snap = spec.snapshot ?? { status: "idle", gen: 0 };
  const settled = (s: AxisSnapshot) => ({ kind: "settled" as const, snapshot: s });
  return {
    axis,
    present,
    kind: "trigger",
    read: () => snap,
    ensureLoaded: vi.fn(async () => (present ? settled({ ...snap, status: snap.status === "idle" ? "done" : snap.status }) : { kind: spec.absent ?? "notConfigured" })),
    refresh: vi.fn(async () => (present ? settled(spec.refreshSnapshot ?? snap) : { kind: spec.absent ?? "notConfigured" })),
  };
}
function placeBridge(place: Place, axes: Partial<Record<AxisKey, EntrySpec>>): PlaceBridge {
  const isStation = place === station;
  const all: AxisKey[] = ["basic", "timetable", "facilities", "facilitiesMetro", "arrivals", "barrierFree"];
  return {
    placeId: place.id,
    read: () => ({ name: place.name, category: place.category, isStation, addressLines: { road: place.roadAddress, jibun: place.address }, phone: place.phone, chatOpen: false }),
    axes: Object.fromEntries(all.map((k) => [k, entry(k, axes[k] ?? { present: isStation || k === "basic" || k === "barrierFree", absent: isStation ? "notConfigured" : "notApplicable" })])) as Record<AxisKey, AxisEntry>,
  };
}
const nav = (toPlace = vi.fn()) => {
  setNavigator({ toHome: async () => {}, toDirections: () => {}, toPlace, isModalOpen: () => false });
  return toPlace;
};
afterEach(() => {
  __resetViewRegistryForTest();
  __resetToolLockForTest();
  __resetToolBudgetForTest();
});
const call = async (input: Record<string, unknown>) => JSON.parse(await getPlaceInfoTool().execute(input));

describe("get_place_info(spec §3.3)", () => {
  it("장소 ref → toPlace → 축 전부, 비역은 basic·barrierFree만(역 축 키 없음), 좌표 없음", async () => {
    __setNonceForTest("n");
    publishView("home", home());
    const bridge = placeBridge(cafe, {
      basic: { snapshot: { status: "notApplicable", gen: 0 } },
      barrierFree: { snapshot: { status: "done", gen: 1, data: { match: { kind: "matched", facilityCount: 1 }, facilities: [{ label: "주차", value: "있음" }], source: "출처" } } },
    });
    const toPlace = nav(vi.fn(() => publishView("place", bridge, cafe.id)));
    const raw = await getPlaceInfoTool().execute({ ref: encodeRef(2, "p", 1) });
    const out = JSON.parse(raw);
    expect(toPlace).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({
      ok: true, view: "place", name: "카페", isStation: false,
      basic: { status: "done", address: { road: "r", jibun: "a" } },
      barrierFree: { status: "done", match: { kind: "matched", facilityCount: 1 }, facilities: [{ label: "주차", value: "있음" }], source: "출처" },
      axesRequested: ["basic", "barrierFree"],
    });
    expect(out.basic.stationMeta).toBeUndefined();
    expect(out.timetable).toBeUndefined();
    expect(out.arrivals).toBeUndefined();
    expect(assertNoCoordinates(raw)).toBeNull();
  });

  it("역: facilities는 korail+metro 두 소스, 하나만 done이면 partial; 미요청 축 키 생략; notConfigured는 status", async () => {
    __setNonceForTest("n");
    publishView("home", home());
    const bridge = placeBridge(station, {
      facilities: { snapshot: { status: "done", gen: 1, data: { lines: ["a: yes"] } } },
      facilitiesMetro: { snapshot: { status: "empty", gen: 1 } },
      arrivals: { present: false, absent: "notConfigured" },
    });
    publishView("place", bridge, station.id);
    const toPlace = nav();
    const out = await call({ ref: encodeRef(2, "p", 0), axes: ["facilities", "arrivals"] });
    expect(toPlace).not.toHaveBeenCalled(); // 같은 placeId 게시면 이동 없음
    expect(out).toMatchObject({
      facilities: { status: "partial", korail: { status: "done", lines: ["a: yes"] }, metro: { status: "empty" } },
      arrivals: { status: "notConfigured" },
      axesRequested: ["facilities", "arrivals"],
    });
    expect(out.basic).toBeUndefined();
    expect(out.timetable).toBeUndefined();
  });

  it("staleResult에 recovery·query, 순번 밖은 notFound", async () => {
    __setNonceForTest("n");
    publishView("home", home());
    nav();
    expect(await call({ ref: encodeRef(1, "p", 0) })).toMatchObject({ ok: false, reason: "staleResult", recovery: "search_places", query: "강동역" });
    expect(await call({ ref: encodeRef(2, "p", 9) })).toMatchObject({ ok: false, reason: "notFound" });
  });

  it("단일 축 + offset 페이징으로 전량 회수, 재직렬화는 예산 미소비", async () => {
    __setNonceForTest("n");
    publishView("home", home());
    const items = Array.from({ length: 60 }, (_, i) => ({ line: `2호선 외선 ${i}`, direction: "외선", message: `${i}분 후 도착 예정입니다 (${i}번째 전역)`, state: { kind: "ok" as const } }));
    const bridge = placeBridge(station, { arrivals: { snapshot: { status: "done", gen: 3, data: { items } } } });
    publishView("place", bridge, station.id);
    nav();
    const seen: string[] = [];
    let offset: number | undefined = 0;
    let rounds = 0;
    while (offset !== undefined && rounds < 20) {
      const out = await call({ ref: encodeRef(2, "p", 0), axes: ["arrivals"], offset });
      __resetToolLockForTest();
      expect(out.ok).toBe(true);
      seen.push(...out.arrivals.items.map((i: { line: string }) => i.line));
      offset = out.nextOffset;
      rounds++;
    }
    expect(seen).toEqual(items.map((i) => i.line));
    expect(rounds).toBeGreaterThan(1);
    // done 축의 재직렬화·페이징은 fetch가 아니라 예산을 쓰지 않는다.
    expect(checkBudget("stationArrivals")).toEqual({ ok: true });
    expect(bridge.axes.arrivals.refresh).not.toHaveBeenCalled();
  });

  it("refresh는 refresh(op)를 부르고 refreshError를 싣는다; idle 첫 로드·refresh만 예산 소비, 쿨다운 안이면 cooldown", async () => {
    __setNonceForTest("n");
    publishView("home", home());
    const bridge = placeBridge(station, {
      arrivals: { snapshot: { status: "done", gen: 1, data: { items: [] } }, refreshSnapshot: { status: "done", gen: 2, data: { items: [] }, refreshError: true } },
    });
    publishView("place", bridge, station.id);
    nav();
    const out = await call({ ref: encodeRef(2, "p", 0), axes: ["arrivals"], refresh: true });
    expect(bridge.axes.arrivals.refresh).toHaveBeenCalledTimes(1);
    expect(out.arrivals).toMatchObject({ status: "done", refreshError: true });
    __resetToolLockForTest();
    const again = await call({ ref: encodeRef(2, "p", 0), axes: ["arrivals"], refresh: true });
    expect(again.arrivals).toMatchObject({ status: "cooldown" });
    expect(again.arrivals.retryAfterMs).toBeGreaterThan(0);
    expect(bridge.axes.arrivals.refresh).toHaveBeenCalledTimes(1);
  });

  it("axes 여럿 + offset → unsupported offsetNeedsSingleAxis; 잘못된 axes → unsupported", async () => {
    publishView("home", home());
    nav();
    expect(await call({ ref: "x", axes: ["basic", "arrivals"], offset: 5 })).toMatchObject({ ok: false, reason: "unsupported", detail: "offsetNeedsSingleAxis" });
    expect(await call({ ref: "x", axes: ["nope"] })).toMatchObject({ ok: false, reason: "unsupported", detail: "axes" });
  });

  it("주소 ref는 openAddress 뒤 이동 시작 이후 게시된 상세에 결박, 좌표 실패는 geocodeFailed", async () => {
    __setNonceForTest("n");
    const h = home();
    const opened = placeBridge(cafe, { basic: { snapshot: { status: "notApplicable", gen: 0 } } });
    (h.openAddress as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      setTimeout(() => publishView("place", opened, "addr-1"), 5);
      return { ok: true };
    });
    publishView("home", h);
    nav();
    const out = await call({ ref: encodeRef(2, "a", 0), axes: ["basic"] });
    expect(out).toMatchObject({ ok: true, name: "카페", ref: "n.2.a.0" });
    __resetToolLockForTest();
    (h.openAddress as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ ok: false, reason: "geocodeFailed" }));
    expect(await call({ ref: encodeRef(2, "a", 0) })).toMatchObject({ ok: false, reason: "geocodeFailed", retryable: true });
  });

  it("축 하나가 aborted면 호출 전체가 aborted", async () => {
    __setNonceForTest("n");
    publishView("home", home());
    const bridge = placeBridge(station, {});
    bridge.axes.timetable.ensureLoaded = vi.fn(async (): Promise<AxisOutcome> => ({ kind: "aborted" }));
    publishView("place", bridge, station.id);
    nav();
    expect(await call({ ref: encodeRef(2, "p", 0), axes: ["timetable"] })).toMatchObject({ ok: false, reason: "aborted" });
  });
});

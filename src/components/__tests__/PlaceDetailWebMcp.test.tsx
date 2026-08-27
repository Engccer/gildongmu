// @vitest-environment jsdom
/**
 * `PlaceDetail` × `PlaceBridge`(spec 2026-08-29 §5.4). 역 섹션은 실제 컴포넌트를 쓰고 fetch만
 * deferred Promise로 막아 attach 대기·세대 결박·착지 억제·언마운트 abort를 결정론적으로 재현한다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlaceDetail } from "../PlaceDetail";
import { __resetViewRegistryForTest, bridgeOf } from "@/lib/webmcp/view-registry";
import { __resetToolLockForTest, acquireOp, releaseOp, type Op } from "@/lib/webmcp/tool-lock";
import type { PlaceBridge } from "@/lib/webmcp/tools/context";
import type { Place } from "@/lib/types";

vi.mock("next-intl", () => {
  // 네임스페이스를 키에 붙여 어느 섹션 문장인지 구분한다(place-lines 테스트와 같은 관례).
  const make = (ns?: string) => {
    const t = (k: string) => (ns ? `${ns}.${k}` : k);
    Object.assign(t, { rich: t, markup: t, raw: t, has: () => true });
    return t;
  };
  return { useTranslations: (ns?: string) => make(ns), useLocale: () => "ko" };
});
vi.mock("../RouteLinks", () => ({ RouteLinks: () => null }));
vi.mock("../chat/ChatOverlay", () => ({ ChatOverlay: () => null }));

const station: Place = {
  id: "s1",
  name: "강남역",
  category: "교통,수송 > 지하철,전철 > 수도권2호선",
  address: "a",
  roadAddress: "r",
  lat: 37.49,
  lng: 127.02,
};
const cafe: Place = { id: "c1", name: "카페", category: "음식점 > 카페", address: "a", roadAddress: "r", lat: 37.5, lng: 127.0 };

type Res = { ok: boolean; json: () => Promise<unknown> };
function deferred() {
  let resolve!: (v: Res) => void;
  const promise = new Promise<Res>((r) => (resolve = r));
  return { promise, resolve };
}
const okJson = (body: unknown): Res => ({ ok: true, json: async () => body });
const EMPTY = okJson({ meta: null, timetable: null, detail: null, facilities: null, arrivals: null });

/** 경로별로 deferred를 꽂는다. 없는 경로는 즉시 빈 응답. */
function stubFetch(routes: Record<string, Promise<Res>> = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      calls.push(input);
      const hit = Object.entries(routes).find(([k]) => input.includes(k));
      return hit ? hit[1] : Promise.resolve(EMPTY);
    }),
  );
  return calls;
}

function renderDetail(place: Place, opts: { canShowSubway?: boolean; canShowBarrierFree?: boolean } = {}) {
  return render(
    <PlaceDetail
      place={place}
      onBack={() => {}}
      canShowBus={false}
      canShowBike={false}
      canShowAir={false}
      canShowSubway={opts.canShowSubway ?? false}
      canShowBarrierFree={opts.canShowBarrierFree ?? false}
    />,
  );
}
const facilitiesBody = {
  facilities: { stationName: "강남", accessibleToilet: true, accessibleSlope: true, wheelchairLifts: 1, elevators: 2 },
};

let ops: Op[] = [];
const op = () => {
  const o = acquireOp("t", undefined) as Op;
  ops.push(o);
  return o;
};
afterEach(() => {
  cleanup();
  __resetViewRegistryForTest();
  __resetToolLockForTest();
  ops = [];
  vi.unstubAllGlobals();
});

describe("PlaceDetail × PlaceBridge(spec §5.4)", () => {
  it("마운트에 placeId 정체성으로 게시하고 present는 props에서 온다", async () => {
    stubFetch();
    renderDetail(station, { canShowSubway: false, canShowBarrierFree: true });
    const b = bridgeOf<PlaceBridge>("place");
    expect(b?.identity).toBe("s1");
    expect(b?.bridge.read()).toMatchObject({ name: "강남역", isStation: true, chatOpen: false });
    expect(b?.bridge.axes.arrivals.present).toBe(false);
    expect(b?.bridge.axes.barrierFree.present).toBe(true);
    expect(await b!.bridge.axes.arrivals.ensureLoaded(op())).toEqual({ kind: "notConfigured" });
  });

  it("비역: 역 축은 notApplicable, basic은 소스 없이 정착, barrierFree는 empty(unmatched)로 정착", async () => {
    stubFetch();
    renderDetail(cafe, { canShowBarrierFree: true });
    const axes = bridgeOf<PlaceBridge>("place")!.bridge.axes;
    const o = op();
    expect(await axes.timetable.ensureLoaded(o)).toEqual({ kind: "notApplicable" });
    expect(await axes.arrivals.ensureLoaded(o)).toEqual({ kind: "notApplicable" });
    expect(await axes.basic.ensureLoaded(o)).toEqual({ kind: "settled", snapshot: { status: "notApplicable", gen: 0 } });
    const bf = await axes.barrierFree.ensureLoaded(o);
    expect(bf).toMatchObject({ kind: "settled", snapshot: { status: "empty", data: { match: { kind: "unmatched" } } } });
  });

  it("트리거 축 ensureLoaded는 tool 소스로 로드하고 헤딩 착지 없이 정착한다(사용자 클릭은 착지)", async () => {
    const d = deferred();
    stubFetch({ "/api/station/facilities": d.promise });
    renderDetail(station);
    const entry = bridgeOf<PlaceBridge>("place")!.bridge.axes.facilities;
    expect(entry.read().status).toBe("idle");
    const p = entry.ensureLoaded(op());
    await act(async () => d.resolve(okJson(facilitiesBody)));
    const r = await p;
    expect(r).toMatchObject({
      kind: "settled",
      snapshot: { status: "done", data: { lines: ["station.accessibleToilet: station.yes", "station.accessibleSlope: station.yes", "station.wheelchairLifts: 1", "station.elevators: 2"] } },
    });
    await new Promise((res) => requestAnimationFrame(() => res(null)));
    // 착지는 상세 진입의 h2 하나뿐 — 시설 헤딩(h3)으로 옮기지 않았다.
    expect(document.activeElement?.tagName).toBe("H2");
    // 같은 데이터가 화면에도 그려졌다(문장 정본 공유).
    expect(screen.getByText("station.elevators: 2")).toBeTruthy();
    // 사용자가 닫고 다시 누르면 헤딩에 착지한다.
    fireEvent.click(screen.getByRole("button", { name: "actions.close" }));
    const d2 = deferred();
    stubFetch({ "/api/station/facilities": d2.promise });
    fireEvent.click(screen.getByRole("button", { name: "station.button" }));
    await act(async () => d2.resolve(okJson(facilitiesBody)));
    await waitFor(() => expect(document.activeElement?.tagName).toBe("H3"));
  });

  it("refresh 실패는 직전 데이터 + refreshError, 사용자 닫기는 세대를 올려 idle로 되돌린다", async () => {
    const d = deferred();
    stubFetch({ "/api/station/facilities": d.promise });
    renderDetail(station);
    const axes = bridgeOf<PlaceBridge>("place")!.bridge.axes;
    fireEvent.click(screen.getByRole("button", { name: "station.button" }));
    await act(async () => d.resolve(okJson(facilitiesBody)));
    await screen.findByRole("button", { name: "actions.close" });
    const genDone = axes.facilities.read().gen;
    const d2 = deferred();
    stubFetch({ "/api/station/facilities": d2.promise });
    const o = op();
    const p = axes.facilities.refresh(o);
    await act(async () => d2.resolve({ ok: false, json: async () => ({}) }));
    expect(await p).toMatchObject({
      kind: "settled",
      snapshot: { status: "done", gen: genDone + 1, refreshError: true, data: { lines: ["station.accessibleToilet: station.yes", "station.accessibleSlope: station.yes", "station.wheelchairLifts: 1", "station.elevators: 2"] } },
    });
    fireEvent.click(screen.getByRole("button", { name: "actions.close" }));
    expect(axes.facilities.read()).toMatchObject({ status: "idle", gen: genDone + 2 });
  });

  it("마운트 축(timetable)은 attach·자동 fetch 정착을 기다리고, refresh 실패는 직전 데이터 + refreshError", async () => {
    const d = deferred();
    stubFetch({ "/api/station/timetable": d.promise });
    renderDetail(station);
    const axes = bridgeOf<PlaceBridge>("place")!.bridge.axes;
    const o = op();
    const p = axes.timetable.ensureLoaded(o);
    const tt = {
      stationName: "강남",
      dailyType: "weekday",
      lines: [{ lineName: "2호선", coverage: "ok", directions: [{ direction: "up", first: { time: "05:30" }, last: { time: "00:10" } }] }],
    };
    await act(async () => d.resolve(okJson({ timetable: tt })));
    expect(await p).toMatchObject({ kind: "settled", snapshot: { status: "done", data: { basis: "timetable.dailyType.weekday", lines: [{ line: "2호선", coverage: "ok", first: "05:30" }] } } });
    const d2 = deferred();
    stubFetch({ "/api/station/timetable": d2.promise });
    const p2 = axes.timetable.refresh(o);
    await act(async () => d2.resolve({ ok: false, json: async () => ({}) }));
    expect(await p2).toMatchObject({ kind: "settled", snapshot: { status: "done", refreshError: true, data: { lines: [{ line: "2호선" }] } } });
  });

  it("언마운트는 대기자를 aborted로 끝낸다", async () => {
    const d = deferred();
    stubFetch({ "/api/station/facilities": d.promise });
    const view = renderDetail(station);
    const entry = bridgeOf<PlaceBridge>("place")!.bridge.axes.facilities;
    const p = entry.ensureLoaded(op());
    view.unmount();
    expect(await p).toEqual({ kind: "aborted" });
    expect(bridgeOf("place")).toBeNull();
  });
});

// @vitest-environment jsdom
/**
 * 채팅 경로 안내 시작 카드에서 길찾기 화면으로 넘어온 진입(E83 spec `2026-11-14-e83-chat-route-start-design.md` §6).
 * - [길찾기에서 열기]: 도착지·경유지를 채우고 평소 조회(전 수단, 유효 위치). 저절로 시작하는 안내가 없다.
 * - 도보·자동차 [안내 시작]: 그 수단만, 기기 위치를 새로 받아 조회하고 그 수단의 시작 버튼이 안내를 바로 시작한다.
 * - 대중교통 [안내 시작](신선): 조회 없이 카드의 결과가 서고 추천 첫 경로의 안내가 바로 시작된다.
 * - 대중교통(낡음): 기기 위치에서 평소 조회를 돌리고 사유를 화면 단일 창구로 말한다. 안내는 저절로 시작하지 않는다.
 * 안내 패널은 목이다 — 여기서 보는 것은 "어느 자리의 시작 버튼이 마운트 시점에 autoStart를 받았는가"다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { placeEndpoint } from "@/lib/directions-state";
import { clearRecentRoutes, loadRecentRoutes } from "@/lib/recent-searches";
import { __resetManualLocationForTest, setManualLocation } from "@/lib/manual-location-store";
import type { TransitRouteResult } from "@/lib/types";

const intl = vi.hoisted(() => ({ locale: "ko" }));
vi.mock("next-intl", async () => {
  const m = await import("./stable-intl-mock");
  return m.stableIntlMock(() => intl.locale, m.keyOnly);
});
// 스냅샷은 고정 참조여야 한다(`useSyncExternalStore` — 새 객체를 주면 무한 렌더).
const geo = vi.hoisted(() => ({
  READY: { status: "ready" as const, coords: { lat: 37.5663, lng: 126.9779 } },
  calls: [] as unknown[],
}));
vi.mock("@/lib/geolocation", () => ({
  subscribeGeolocation: () => () => {},
  getGeolocationServerSnapshot: () => geo.READY,
  awaitGeolocation: vi.fn(async (opts?: unknown) => {
    geo.calls.push(opts);
    return geo.READY;
  }),
  getGeolocationSnapshot: () => geo.READY,
  DIRECTIONS_ORIGIN_MAX_AGE_SECONDS: 180,
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
vi.mock("../WalkRouteBriefing", () => ({ WalkRouteResult: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteResult: () => null }));

type BeaconMount = { kind: string; accessible: boolean; autoStart: boolean; focusTriggerOnMount: boolean; via: unknown };
const panels = vi.hoisted(() => ({
  beacons: [] as BeaconMount[],
  transit: [] as Array<{ routeKey: string; autoStart: boolean }>,
}));
vi.mock("../DistanceBeacon", () => ({
  DistanceBeacon: (p: {
    kind: string;
    accessible: boolean;
    autoStart?: boolean;
    focusTriggerOnMount?: boolean;
    via?: unknown;
    triggerLabel?: string;
  }) => {
    // 실제 패널과 같이 마운트 시점의 값만 읽는다(마운트 1회 계약).
    useEffect(() => {
      panels.beacons.push({
        kind: p.kind,
        accessible: p.accessible,
        autoStart: p.autoStart === true,
        focusTriggerOnMount: p.focusTriggerOnMount === true,
        via: p.via ?? null,
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <button type="button">{p.triggerLabel}</button>;
  },
}));
vi.mock("../TransitGuidePanel", () => ({
  TransitGuidePanel: (p: { route: { routeKey: string }; autoStart?: boolean }) => {
    useEffect(() => {
      panels.transit.push({ routeKey: p.route.routeKey, autoStart: p.autoStart === true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <p>transit-panel</p>;
  },
}));

import { DirectionsView, type DirectionsGuideEntry } from "../DirectionsView";

const DEST = { lat: 37.4979, lng: 127.0276 };
const VIA = { lat: 37.51, lng: 127.0, label: "편의점" };
const CAR = {
  distanceMeters: 12000,
  durationSeconds: 1400,
  taxiFare: 14000,
  tollFare: 0,
  guides: [{ name: "", guidance: "직진", distanceMeters: 0, durationSeconds: 0 }],
};
const walkLine = (kind: string) => ({
  kind,
  route: { distanceMeters: 2000, durationSeconds: 1700, steps: [{ description: "직진 2km 이동" }] },
});
const rideRoute = (routeKey: string) => ({
  routeKey,
  summary: { totalMinutes: 30, fare: 1550, transfers: 0, walkMinutes: 6 },
  legs: [
    { mode: "walk", minutes: 3 },
    {
      mode: "subway",
      lineName: "수도권 2호선",
      fromName: "시청",
      toName: "강남",
      stationCount: 8,
      minutes: 24,
      serviceWayCode: 2,
      stops: [
        { name: "시청", stationId: "201", lat: 37.5657, lng: 126.9769 },
        { name: "강남", stationId: "222", lat: 37.4979, lng: 127.0276 },
      ],
    },
  ],
});
const TRANSIT = { recommended: rideRoute("p0"), alternatives: [rideRoute("p1")] } as unknown as TransitRouteResult;

let fetchMock: ReturnType<typeof vi.fn>;
let server: { carProvider: string; walkLines: string[] };
/** 경로 조회 응답을 붙잡아 두는 문(조회 도중의 화면을 보는 케이스용). 기본은 열려 있다. */
let routeGate: Promise<void> = Promise.resolve();
beforeEach(() => {
  routeGate = Promise.resolve();
  intl.locale = "ko";
  geo.calls = [];
  panels.beacons = [];
  panels.transit = [];
  server = { carProvider: "tmap", walkLines: ["shortest", "accessible"] };
  clearRecentRoutes();
  window.history.replaceState(null, "", "/");
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/route/")) await routeGate;
    if (url.startsWith("/api/route/car")) {
      return { ok: true, json: async () => ({ ...CAR, provider: server.carProvider }) } as Response;
    }
    if (url.startsWith("/api/route/walk")) {
      return { ok: true, json: async () => ({ lines: server.walkLines.map(walkLine) }) } as Response;
    }
    if (url.startsWith("/api/route/transit")) {
      return { ok: true, json: async () => ({ result: TRANSIT }) } as Response;
    }
    // 현재 위치 칸의 주소 병기·출입구 승격 등 부수 조회는 빈 응답으로 둔다(여기서 세는 것은 경로 조회뿐이다).
    return { ok: false, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  __resetManualLocationForTest();
  vi.unstubAllGlobals();
});

const routeCalls = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/route/"));
const modesCalled = () =>
  routeCalls()
    .map((u) => u.slice("/api/route/".length).split("?")[0])
    .sort();
const param = (url: string, key: string) => new URLSearchParams(url.split("?")[1]).get(key);
const DEVICE = "37.5663,126.9779";
const MANUAL = "37.55,126.95";
const useManual = () => setManualLocation({ lat: 37.55, lng: 126.95, label: "수동 지정", origin: null, setAt: Date.now() });

function entry(over: Partial<DirectionsGuideEntry> & Pick<DirectionsGuideEntry, "action">): DirectionsGuideEntry {
  return { mode: null, via: null, accessible: false, transit: null, ...over };
}
function renderEntry(guide: DirectionsGuideEntry) {
  return render(
    <DirectionsView
      canShowWalk
      canShowTransit
      canBriefCarRoute
      canPlanJourney={false}
      canSearchJourneyStops={false}
      initialTo={placeEndpoint("강남역", DEST, null)}
      initialGuide={guide}
      onBack={() => {}}
    />,
  );
}
const autoStarted = () => [
  ...panels.beacons.filter((b) => b.autoStart).map((b) => `${b.kind}:${b.accessible ? "accessible" : "plain"}`),
  ...panels.transit.filter((t) => t.autoStart).map((t) => `transit:${t.routeKey}`),
];

describe("채팅 경로 안내 시작 카드 → 길찾기 화면(E83)", () => {
  it("[길찾기에서 열기]: 도착지·경유지를 채우고 전 수단을 유효 위치에서 조회한다. 저절로 시작하는 안내가 없다", async () => {
    useManual();
    renderEntry(entry({ action: "open", via: VIA }));
    expect((screen.getByLabelText("to") as HTMLInputElement).value).toBe("강남역");
    expect((screen.getByLabelText("via") as HTMLInputElement).value).toBe("편의점");
    // 대중교통은 경유지가 있으면 호출하지 않는다(ODsay에 경유지 없음) — 도보·자동차가 경유지를 싣고 간다.
    await waitFor(() => expect(modesCalled()).toEqual(["car", "walk"]));
    for (const url of routeCalls()) {
      expect(param(url, "via")).toBe("37.51,127");
      // 수동 지정 위치가 켜져 있으면 그 위치에서 출발한다(기기 위치로 새지 않는다).
      expect(param(url, "origin")).toBe(MANUAL);
    }
    expect(geo.calls.some((o) => (o as { force?: boolean } | undefined)?.force === true)).toBe(false);
    await waitFor(() => expect(panels.beacons.length).toBeGreaterThan(0));
    expect(autoStarted()).toEqual([]);
    expect(panels.beacons.every((b) => !b.focusTriggerOnMount)).toBe(true);
  });

  it("[길찾기에서 열기]: 경유지가 없으면 세 수단을 다 조회한다", async () => {
    renderEntry(entry({ action: "open" }));
    await waitFor(() => expect(modesCalled()).toEqual(["car", "transit", "walk"]));
    await waitFor(() => expect(panels.transit.length).toBeGreaterThan(0));
    expect(autoStarted()).toEqual([]);
  });

  it("도보 [안내 시작]: 도보만, 위치를 새로 받아 기기 위치에서 조회하고 첫 줄의 안내를 바로 시작한다", async () => {
    useManual();
    renderEntry(entry({ action: "start", mode: "walk" }));
    // 조회가 도는 동안 커서는 화면 제목에 있다(채팅이 닫히며 누른 버튼이 사라졌다).
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2 }));
    await waitFor(() => expect(autoStarted()).toEqual(["walk:plain"]));
    expect(modesCalled()).toEqual(["walk"]);
    // 수동 지정 위치를 건너뛰고, 스토어의 옛 좌표가 아니라 새로 받은 위치다(`force`).
    expect(param(routeCalls()[0], "origin")).toBe(DEVICE);
    expect(geo.calls).toContainEqual({ force: true, maxAgeSeconds: 180 });
    // 그 버튼이 착지를 가져간다(수단 제목 착지는 하지 않는다) — 다른 줄은 저절로 시작하지 않는다.
    expect(panels.beacons.filter((b) => b.focusTriggerOnMount)).toHaveLength(1);
    expect(panels.beacons.find((b) => b.focusTriggerOnMount)?.autoStart).toBe(true);
  });

  it("도보 [안내 시작]: 경유지를 싣고 조회하고, 안내도 그 경유지로 시작한다(R9)", async () => {
    renderEntry(entry({ action: "start", mode: "walk", via: VIA }));
    await waitFor(() => expect(autoStarted()).toEqual(["walk:plain"]));
    expect(param(routeCalls()[0], "via")).toBe("37.51,127");
    expect(panels.beacons.find((b) => b.autoStart)?.via).toMatchObject({ lat: VIA.lat, lng: VIA.lng });
  });

  it("도보 [안내 시작](계단 회피): 계단 회피 줄을 펼쳐 그 줄의 안내를 시작한다", async () => {
    renderEntry(entry({ action: "start", mode: "walk", accessible: true }));
    await waitFor(() => expect(autoStarted()).toEqual(["walk:accessible"]));
  });

  it("도보 [안내 시작](계단 회피): 계단 회피 줄이 없으면 다른 줄로 바꿔 시작하지 않고 평소대로 착지한다", async () => {
    server.walkLines = ["shortest"];
    renderEntry(entry({ action: "start", mode: "walk", accessible: true }));
    await waitFor(() => expect(panels.beacons.length).toBe(1));
    expect(autoStarted()).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 3, name: "heading" })));
  });

  it("자동차 [안내 시작]: 자동차만 기기 위치에서 조회하고 그 안내를 바로 시작한다", async () => {
    useManual();
    renderEntry(entry({ action: "start", mode: "car" }));
    await waitFor(() => expect(autoStarted()).toEqual(["car:plain"]));
    expect(modesCalled()).toEqual(["car"]);
    expect(param(routeCalls()[0], "origin")).toBe(DEVICE);
    expect(panels.beacons).toHaveLength(1);
    expect(panels.beacons[0].focusTriggerOnMount).toBe(true);
  });

  it("자동차 [안내 시작]: 다시 조회한 경로가 Tmap이 아니면 시작 버튼이 없어 저절로 시작하지 않는다", async () => {
    server.carProvider = "kakao";
    renderEntry(entry({ action: "start", mode: "car" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 3, name: "car" })));
    expect(panels.beacons).toEqual([]);
  });

  it("수단 제한은 첫 조회에만 걸린다: [경로 조회]를 누르면 전 수단을 조회하고 저절로 시작하지 않는다", async () => {
    renderEntry(entry({ action: "start", mode: "walk" }));
    await waitFor(() => expect(autoStarted()).toEqual(["walk:plain"]));
    panels.beacons = [];
    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => expect(modesCalled()).toEqual(["car", "transit", "walk"]));
    await waitFor(() => expect(panels.beacons.length).toBeGreaterThan(0));
    expect(autoStarted()).toEqual([]);
  });

  it("자동 시작은 한 번이다: 줄을 접었다 펴도 다시 시작하지 않는다", async () => {
    renderEntry(entry({ action: "start", mode: "walk" }));
    await waitFor(() => expect(autoStarted()).toEqual(["walk:plain"]));
    panels.beacons = [];
    const toggle = screen.getAllByRole("button", { expanded: true })[0];
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    await waitFor(() => expect(panels.beacons.length).toBe(1));
    expect(autoStarted()).toEqual([]);
  });

  it("대중교통 [안내 시작](신선): 조회 없이 카드의 결과가 서고 추천 첫 경로의 안내만 바로 시작한다", async () => {
    renderEntry(
      entry({ action: "start", mode: "transit", transit: { result: TRANSIT, origin: { lat: 37.5663, lng: 126.9779 } } }),
    );
    // 첫 렌더에 결과가 서 있다 — 대중교통 섹션 하나뿐이다.
    expect(screen.getByRole("heading", { level: 3, name: "public" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 3, name: "heading" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 3, name: "car" })).toBeNull();
    expect(autoStarted()).toEqual(["transit:p0"]);
    // 화면 제목이 착지를 빼앗지 않는다(착지는 안내 패널 몫 — 여기선 목).
    expect(document.activeElement).toBe(document.body);
    // 조회가 성공했을 때와 같이 최근 경로에 남는다.
    await waitFor(() => expect(loadRecentRoutes()[0]?.to?.label).toBe("강남역"));
    expect(routeCalls()).toEqual([]);
  });

  it("대중교통 [안내 시작](신선): 추천 경로에 탑승 구간이 없으면 결과만 서고 저절로 시작하지 않는다", async () => {
    const walkOnly = {
      recommended: { routeKey: "p0", summary: { totalMinutes: 10, fare: 0, transfers: 0, walkMinutes: 10 }, legs: [{ mode: "walk", minutes: 10 }] },
      alternatives: [rideRoute("p1")],
    } as unknown as TransitRouteResult;
    renderEntry(entry({ action: "start", mode: "transit", transit: { result: walkOnly, origin: DEST } }));
    expect(screen.getByRole("heading", { level: 3, name: "public" })).toBeTruthy();
    expect(autoStarted()).toEqual([]);
    expect(routeCalls()).toEqual([]);
  });

  it("대중교통(낡음): 기기 위치에서 전 수단을 다시 조회하고 사유를 단일 창구로 말한다. 안내는 저절로 시작하지 않는다", async () => {
    useManual();
    let openGate: () => void = () => {};
    routeGate = new Promise<void>((resolve) => (openGate = resolve));
    const { container } = renderEntry(entry({ action: "requery", mode: "transit" }));
    expect(screen.queryByRole("heading", { level: 3, name: "public" })).toBeNull();
    // 사유 통지는 조회가 도는 동안 이 화면의 창구 하나에 실린다(진행 문구에 덮이지 않는다).
    const region = container.querySelector("[aria-live='polite']")!;
    await waitFor(() => expect(region.textContent).toBe("cardStaleRequery"));
    expect(container.querySelectorAll("[aria-live]").length).toBe(1);
    await waitFor(() => expect(modesCalled()).toEqual(["car", "transit", "walk"]));
    for (const url of routeCalls()) expect(param(url, "origin")).toBe(DEVICE);
    expect(region.textContent).toBe("cardStaleRequery");
    openGate();
    await waitFor(() => expect(panels.transit.length).toBeGreaterThan(0));
    expect(autoStarted()).toEqual([]);
  });

  it("영어 데이터 로케일의 도보 [안내 시작]도 같은 길이다(R10 — 도보는 전 로케일)", async () => {
    intl.locale = "en";
    renderEntry(entry({ action: "start", mode: "walk" }));
    await waitFor(() => expect(autoStarted()).toEqual(["walk:plain"]));
    expect(modesCalled()).toEqual(["walk"]);
  });
});

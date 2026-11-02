// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JourneyResult, Place } from "@/lib/types";
import { placeEndpoint } from "@/lib/directions-state";
import { clearRecentRoutes, recordRecentRoute } from "@/lib/recent-searches";
import { bridgeOf } from "@/lib/webmcp/view-registry";
import type { DirectionsBridge } from "@/lib/webmcp/tools/context";

vi.mock("next-intl", async () => {
  const m = await import("./stable-intl-mock");
  return m.stableIntlMock("ko", m.keyOnly);
});
// 스냅샷은 고정 참조여야 한다(`useSyncExternalStore` — 새 객체를 주면 무한 렌더).
const IDLE = vi.hoisted(() => ({ status: "idle" as const }));
vi.mock("@/lib/geolocation", () => ({
  subscribeGeolocation: () => () => {},
  getGeolocationServerSnapshot: () => IDLE,
  awaitGeolocation: vi.fn(async () => ({ status: "error" as const })),
  getGeolocationSnapshot: () => IDLE,
  DIRECTIONS_ORIGIN_MAX_AGE_SECONDS: 180,
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
vi.mock("../WalkRouteBriefing", () => ({ WalkRouteResult: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteResult: () => null }));
vi.mock("../DistanceBeacon", () => ({ DistanceBeacon: () => null }));

import { DirectionsView } from "../DirectionsView";

const ahyeonStation: Place = {
  id: "p-ahyeon",
  name: "아현역 2호선",
  category: "교통,수송 > 지하철,전철 > 수도권2호선",
  address: "서울 마포구 아현동",
  roadAddress: "서울 마포구 신촌로 지하270",
  lat: 37.5577,
  lng: 126.9562,
};
const cafe: Place = {
  id: "p-cafe",
  name: "아현 카페",
  category: "음식점 > 카페",
  address: "서울 마포구 아현동 1",
  roadAddress: "",
  lat: 37.556,
  lng: 126.955,
};

const journey: JourneyResult = {
  variants: [
    {
      kind: "designated",
      boardStation: { name: "아현", coord: { lat: 37.5577, lng: 126.9562 } },
      taxiIn: { durationSeconds: 480, taxiFare: 7800 } as JourneyResult["variants"][number]["taxiIn"],
      transit: {
        routeKey: "r0",
        legs: [{ mode: "subway", fromName: "아현", toName: "광화문", lineName: "수도권 2호선" }],
        summary: { totalMinutes: 20, fare: 1550, transfers: 0, walkMinutes: 0 },
      } as unknown as JourneyResult["variants"][number]["transit"],
      totals: { minutes: 30, taxiFare: 7800, transitFare: 1550 },
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;
/** 여정 조회 응답(케이스가 바꿔 끼운다): 기본은 찾음. */
let journeyResponse: () => Response = () => ({ ok: true, json: async () => journey }) as Response;
beforeEach(() => {
  journeyResponse = () => ({ ok: true, json: async () => journey }) as Response;
  clearRecentRoutes();
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/places")) {
      return { ok: true, json: async () => ({ places: [cafe, ahyeonStation], provider: "kakao-local", query: "q" }) } as Response;
    }
    if (url.startsWith("/api/route/journey?")) return journeyResponse();
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const from = placeEndpoint("집", { lat: 37.55, lng: 126.95 }, null);
const to = placeEndpoint("광화문", { lat: 37.571, lng: 126.976 }, null);

function renderView(canPlanJourney: boolean) {
  return render(
    <DirectionsView
      canShowWalk
      canShowTransit
      canBriefCarRoute
      canPlanJourney={canPlanJourney}
      initialFrom={from}
      initialTo={to}
      onBack={() => {}}
    />,
  );
}

/** 승차 쪽 역 칸을 열어 아현역을 확정한다. */
async function pickBoardStation() {
  fireEvent.click(screen.getByRole("button", { name: "addMenu" }));
  fireEvent.click(screen.getByRole("button", { name: "addBoardStation" }));
  fireEvent.change(screen.getByLabelText("boardField"), { target: { value: "아현" } });
  fireEvent.click(screen.getByRole("button", { name: "searchField" }));
  fireEvent.click(await screen.findByRole("button", { name: /아현역 2호선/ }));
}

describe("여정 웹 입구(E70-f)", () => {
  it("게이트가 거짓이면 종전 「경유지 추가」 버튼만 있다", () => {
    renderView(false);
    expect(screen.getByRole("button", { name: "addVia" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "addMenu" })).toBeNull();
  });

  it("메뉴는 disclosure이고 항목 셋(경유지·내리는 역·탈 역) 순서다", () => {
    renderView(true);
    const menu = screen.getByRole("button", { name: "addMenu" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    const items = ["addVia", "addBoardStation", "addAlightStation"].map((name) => screen.getByRole("button", { name }));
    expect(items[0].compareDocumentPosition(items[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(items[1].compareDocumentPosition(items[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("역 칸을 열면 입력으로 착지하고, 경유지 버튼·메뉴가 사라지며 남은 쪽 추가 버튼과 지우기가 선다(D14)", async () => {
    renderView(true);
    fireEvent.click(screen.getByRole("button", { name: "addMenu" }));
    fireEvent.click(screen.getByRole("button", { name: "addBoardStation" }));
    const input = screen.getByLabelText("boardField");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(screen.queryByRole("button", { name: "addMenu" })).toBeNull();
    expect(screen.queryByRole("button", { name: "addVia" })).toBeNull();
    expect(screen.getByRole("button", { name: "addAlightStation" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "clearStations" }));
    expect(screen.queryByLabelText("boardField")).toBeNull();
    // 지우기 버튼도 사라지므로 조회 버튼으로 먼저 옮긴다(판정 21).
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "submit" }));
    expect(screen.getByRole("button", { name: "addMenu" })).toBeTruthy();
  });

  it("후보는 역만, 고르면 여정만 조회한다(D12 — 수단별 조회 0회)", async () => {
    renderView(true);
    fireEvent.click(screen.getByRole("button", { name: "addMenu" }));
    fireEvent.click(screen.getByRole("button", { name: "addBoardStation" }));
    fireEvent.change(screen.getByLabelText("boardField"), { target: { value: "아현" } });
    fireEvent.click(screen.getByRole("button", { name: "searchField" }));
    const pick = await screen.findByRole("button", { name: /아현역 2호선/ });
    expect(screen.queryByRole("button", { name: /아현 카페/ })).toBeNull();
    fireEvent.click(pick);
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    const heading = await screen.findByRole("heading", { name: "designatedHeading" });
    expect(heading.tagName).toBe("H3");
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    const journeyUrl = urls.find((u) => u.startsWith("/api/route/journey?"));
    expect(journeyUrl).toBeTruthy();
    const q = new URL(journeyUrl!, "http://x").searchParams;
    expect(q.get("board")).toBe("37.5577,126.9562");
    expect(q.get("boardName")).toBe("아현역 2호선");
    expect(q.get("boardLine")).toBe("수도권2호선");
    expect(q.get("stops")).toBe("1");
    expect(q.get("alight")).toBeNull();
    expect(urls.some((u) => u.startsWith("/api/route/transit") || u.startsWith("/api/route/car") || u.startsWith("/api/route/walk"))).toBe(false);
    // 출입구 승격(A11)도 부르지 않는다.
    expect(urls.some((u) => u.startsWith("/api/places/entrance"))).toBe(false);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("readySummary"));
    expect(screen.getByRole("button", { name: "guideStartTransitAlt" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(heading));
    // 도구 스냅샷은 여정 결과에 null을 낸다(spec §4 — 도구 계약에 여정이 없다. 수단 전부 null인 plan은 "경로 없음"으로 읽힌다).
    const snapshot = bridgeOf<DirectionsBridge>("directions")!.bridge.read();
    expect(snapshot.phase).toBe("settled");
    expect(snapshot.plan).toBeNull();
  });

  it("열린 역 칸이 비어 있으면 조회하지 않고 needEndpoints", async () => {
    renderView(true);
    fireEvent.click(screen.getByRole("button", { name: "addMenu" }));
    fireEvent.click(screen.getByRole("button", { name: "addAlightStation" }));
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("needEndpoints"));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/api/route"))).toBe(false);
  });

  it("경로 없음과 조회 실패는 다른 통지다(3-state, iOS와 같은 키)", async () => {
    journeyResponse = () => ({ ok: true, json: async () => ({ variants: [] }) }) as Response;
    renderView(true);
    await pickBoardStation();
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("noRoute"));
    expect(screen.queryByRole("heading", { name: "designatedHeading" })).toBeNull();

    journeyResponse = () => ({ ok: false, status: 502, json: async () => ({}) }) as Response;
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("error"));
    expect(screen.getByRole("status").textContent).not.toContain("noRoute");
  });

  it("출발·도착 교체는 갈아탈 곳도 자리를 바꾼다(승차 쪽 → 하차 쪽)", async () => {
    renderView(true);
    await pickBoardStation();
    expect((screen.getByLabelText("boardField") as HTMLInputElement).value).toBe("아현역 2호선");
    fireEvent.click(screen.getByRole("button", { name: "swap" }));
    expect(screen.queryByLabelText("boardField")).toBeNull();
    expect((screen.getByLabelText("alightField") as HTMLInputElement).value).toBe("아현역 2호선");
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await screen.findByRole("heading", { name: "designatedHeadingAlight" });
    const journeyUrl = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith("/api/route/journey?"));
    const q = new URL(journeyUrl!, "http://x").searchParams;
    expect(q.get("alight")).toBe("37.5577,126.9562");
    expect(q.get("board")).toBeNull();
  });

  it("게이트가 거짓이면 최근 경로 목록에서 여정 항목을 숨긴다(같은 끝점 보통 경로와 문장이 같다)", async () => {
    const side = (label: string, lat: number, lng: number) => ({ label, lat, lng });
    recordRecentRoute({ from: side("집", 37.55, 126.95), to: side("광화문", 37.571, 126.976) });
    recordRecentRoute({
      from: side("집", 37.55, 126.95),
      to: side("광화문", 37.571, 126.976),
      board: { label: "아현역 2호선", lat: 37.5577, lng: 126.9562, line: "수도권2호선" },
    });
    const view = render(<DirectionsView canShowWalk canShowTransit canBriefCarRoute canPlanJourney={false} onBack={() => {}} />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^item/ })).toHaveLength(1));
    view.unmount();
    render(<DirectionsView canShowWalk canShowTransit canBriefCarRoute canPlanJourney onBack={() => {}} />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^item|^recentRoute/ })).toHaveLength(2));
  });
});

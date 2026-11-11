// @vitest-environment jsdom
/**
 * 채팅 여정 카드에서 길찾기 화면으로 넘어온 진입(E70-b spec D12·D14·D16·D17).
 * - [길찾기에서 열기]: 조회 없이 카드의 결과가 서고 여정 제목에 착지한다(화면 제목 착지를 건너뛴다).
 * - [안내 시작](신선): 조회 없이 이어 안내가 바로 선다.
 * - [안내 시작](낡음): 카드의 결과를 쓰지 않고 같은 도착지·갈아탈 곳으로 다시 조회하고, 사유를 화면 단일 창구로 말한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JourneyResult } from "@/lib/types";
import type { JourneyRenderPayload } from "@/lib/chat/types";
import { placeEndpoint } from "@/lib/directions-state";
import { clearRecentRoutes, loadRecentRoutes } from "@/lib/recent-searches";
import { __resetManualLocationForTest, setManualLocation } from "@/lib/manual-location-store";

vi.mock("next-intl", async () => {
  const m = await import("./stable-intl-mock");
  return m.stableIntlMock("ko", m.keyOnly);
});
// 스냅샷은 고정 참조여야 한다(`useSyncExternalStore` — 새 객체를 주면 무한 렌더).
const READY = vi.hoisted(() => ({ status: "ready" as const, coords: { lat: 37.5501, lng: 126.9501 } }));
vi.mock("@/lib/geolocation", () => ({
  subscribeGeolocation: () => () => {},
  getGeolocationServerSnapshot: () => READY,
  awaitGeolocation: vi.fn(async () => READY),
  getGeolocationSnapshot: () => READY,
  DIRECTIONS_ORIGIN_MAX_AGE_SECONDS: 180,
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
vi.mock("../WalkRouteBriefing", () => ({ WalkRouteResult: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteResult: () => null }));
const guide = vi.hoisted(() => ({ plans: [] as Array<{ variantKind: string; destLabel: string; alightDesignated: boolean }> }));
vi.mock("../JourneyGuide", () => ({
  JourneyGuide: ({ plan }: { plan: { variant: { kind: string }; destLabel: string; alightDesignated: boolean } }) => {
    guide.plans.push({ variantKind: plan.variant.kind, destLabel: plan.destLabel, alightDesignated: plan.alightDesignated });
    return <p>journey-guide</p>;
  },
}));

import { DirectionsView, type DirectionsJourneyEntry } from "../DirectionsView";

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
const board = { label: "아현역 2호선", lat: 37.5577, lng: 126.9562, line: "수도권2호선" };
const payload: JourneyRenderPayload = {
  type: "journey",
  result: journey,
  origin: { lat: 37.55, lng: 126.95 },
  queriedAt: 1_800_000_000_000,
  manualOrigin: false,
  board,
  alight: null,
  dest: { lat: 37.571, lng: 126.976 },
  destLabel: "광화문",
  destRoman: null,
};

let fetchMock: ReturnType<typeof vi.fn>;
/** 여정 조회 응답을 붙잡아 두는 문(다시 조회하는 케이스가 조회 도중의 화면을 본다). 기본은 열려 있다. */
let journeyGate: Promise<void> = Promise.resolve();
beforeEach(() => {
  journeyGate = Promise.resolve();
  guide.plans = [];
  clearRecentRoutes();
  window.history.replaceState(null, "", "/");
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/route/journey?")) {
      await journeyGate;
      return { ok: true, json: async () => journey } as Response;
    }
    // 현재 위치 칸의 주소 병기 등 부수 조회는 빈 응답으로 둔다(여기서 세는 것은 여정 조회뿐이다).
    return { ok: false, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const journeyCalls = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/route/journey?"));

function renderEntry(mode: DirectionsJourneyEntry["mode"], canPlanJourney = true) {
  return render(
    <DirectionsView
      canShowWalk
      canShowTransit
      canBriefCarRoute
      canPlanJourney={canPlanJourney}
      canSearchJourneyStops
      initialTo={placeEndpoint(payload.destLabel, payload.dest, payload.destRoman)}
      initialJourney={{ payload, mode }}
      onBack={() => {}}
    />,
  );
}

describe("채팅 여정 카드 → 길찾기 화면(E70-b)", () => {
  it("[길찾기에서 열기]: 조회 없이 결과가 서고, 착지는 여정 제목 하나다", async () => {
    renderEntry("open");
    const heading = screen.getByRole("heading", { level: 3, name: "designatedHeading" });
    // 화면 제목이 아니라 여정 제목에 착지한다(D17).
    expect(document.activeElement).toBe(heading);
    // 도착지·갈아탈 곳 칸이 카드의 값으로 채워진다.
    expect((screen.getByLabelText("to") as HTMLInputElement).value).toBe("광화문");
    expect((screen.getByLabelText("boardFieldStation") as HTMLInputElement).value).toBe("아현역 2호선");
    // 이어 안내는 시작하지 않는다 — [안내 시작]이 그대로 있다.
    expect(guide.plans).toEqual([]);
    expect(screen.getByRole("button", { name: "guideStartTransitAlt" })).toBeTruthy();
    // 조회가 성공했을 때와 같이 최근 경로에 갈아탈 곳이 함께 남는다.
    await waitFor(() => expect(loadRecentRoutes()[0]?.board?.label).toBe("아현역 2호선"));
    expect(journeyCalls()).toEqual([]);
    expect(document.activeElement).toBe(heading);
  });

  it("[안내 시작](신선): 조회 없이 첫 변형으로 이어 안내가 바로 서고, 화면 제목이 착지를 빼앗지 않는다", async () => {
    renderEntry("start");
    expect(screen.getByText("journey-guide")).toBeTruthy();
    expect(guide.plans[0]).toEqual({ variantKind: "designated", destLabel: "광화문", alightDesignated: false });
    // 안내 중엔 결과의 [안내 시작]이 없다.
    expect(screen.queryByRole("button", { name: "guideStartTransitAlt" })).toBeNull();
    // 착지는 이어 안내의 단계 패널 몫이다(여기선 목) — 화면 제목·여정 제목 어느 쪽도 포커스를 가져가지 않는다.
    await waitFor(() => expect(loadRecentRoutes().length).toBe(1));
    expect(document.activeElement).toBe(document.body);
    expect(journeyCalls()).toEqual([]);
  });

  it("[안내 시작](낡음): 카드의 결과를 쓰지 않고 지금 위치에서 같은 여정을 다시 조회하고, 사유를 단일 창구로 말한다", async () => {
    let openGate: () => void = () => {};
    journeyGate = new Promise<void>((resolve) => (openGate = resolve));
    const { container } = renderEntry("requery");
    // 첫 화면에 카드의 결과가 서지 않는다.
    expect(guide.plans).toEqual([]);
    expect(screen.queryByRole("heading", { level: 3, name: "designatedHeading" })).toBeNull();
    // 사유 통지는 이 화면의 창구 하나에 실린다(조회가 도는 동안).
    const region = container.querySelector("[aria-live='polite']")!;
    await waitFor(() => expect(region.textContent).toBe("cardStaleRequery"));
    expect(container.querySelectorAll("[aria-live]").length).toBe(1);
    // 조회는 새로 받은 현재 위치·같은 도착지·같은 갈아탈 곳으로 간다.
    await waitFor(() => expect(journeyCalls().length).toBe(1));
    const q = new URLSearchParams(journeyCalls()[0].split("?")[1]);
    expect(q.get("origin")).toBe("37.5501,126.9501");
    expect(q.get("dest")).toBe("37.571,126.976");
    expect(q.get("board")).toBe("37.5577,126.9562");
    expect(q.get("boardName")).toBe("아현역 2호선");
    // 조회가 도는 동안에도 사유 통지가 창구에 남아 있다(진행 문구에 덮이지 않는다).
    expect(region.textContent).toBe("cardStaleRequery");
    openGate();
    // 결과가 오면 여정 제목에 착지하고, 안내는 저절로 시작하지 않는다.
    const heading = await screen.findByRole("heading", { level: 3, name: "designatedHeading" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(guide.plans).toEqual([]);
    expect(screen.getByRole("button", { name: "guideStartTransitAlt" })).toBeTruthy();
    // 사유 통지는 결과 요약에 자리를 내준다.
    expect(region.textContent).not.toBe("cardStaleRequery");
  });

  it("[안내 시작] 재조회는 수동 지정 위치가 켜져 있어도 실제 위치에서 출발한다(E70-b2 ③)", async () => {
    setManualLocation({ lat: 37.4979, lng: 127.0276, label: "강남역", origin: null, setAt: Date.now() });
    try {
      renderEntry("requery");
      await waitFor(() => expect(journeyCalls().length).toBe(1));
      const q = new URLSearchParams(journeyCalls()[0].split("?")[1]);
      // 수동 위치(강남역)가 아니라 기기 위치다.
      expect(q.get("origin")).toBe("37.5501,126.9501");
    } finally {
      __resetManualLocationForTest();
    }
  });

  it("카드 진입이 아닌 조회(조회 버튼)는 수동 지정 위치에서 출발한다(기기 위치로 새지 않는다)", async () => {
    setManualLocation({ lat: 37.4979, lng: 127.0276, label: "강남역", origin: null, setAt: Date.now() });
    try {
      renderEntry("open");
      fireEvent.click(screen.getByRole("button", { name: "submit" }));
      await waitFor(() => expect(journeyCalls().length).toBe(1));
      expect(new URLSearchParams(journeyCalls()[0].split("?")[1]).get("origin")).toBe("37.4979,127.0276");
    } finally {
      __resetManualLocationForTest();
    }
  });

  it("여정 게이트가 거짓이면 카드 진입을 버린다(결과·갈아탈 곳 칸 없음, 조회 없음)", () => {
    renderEntry("start", false);
    expect(screen.queryByText("journey-guide")).toBeNull();
    expect(screen.queryByRole("heading", { level: 3, name: "designatedHeading" })).toBeNull();
    expect(screen.queryByLabelText("boardFieldStation")).toBeNull();
    expect(journeyCalls()).toEqual([]);
  });
});

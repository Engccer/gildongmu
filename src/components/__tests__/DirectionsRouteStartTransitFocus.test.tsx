// @vitest-environment jsdom
/**
 * 채팅 카드의 「대중교통 안내 시작」(신선, E83 §6) 뒤 포커스 — **실제 `TransitGuidePanel`**로 잠근다.
 * 이 진입은 화면 제목 착지를 건너뛰므로(착지는 안내 패널 몫), 패널이 착지를 가져가지 않으면 커서가 body에 남는다.
 * `DirectionsRouteStartEntry.test.tsx`는 패널을 목으로 두어 이 축을 보지 못한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { placeEndpoint } from "@/lib/directions-state";
import type { TransitRouteResult } from "@/lib/types";

vi.mock("next-intl", async () => {
  const m = await import("./stable-intl-mock");
  return m.stableIntlMock("ko", m.keyOnly);
});
const READY = vi.hoisted(() => ({ status: "ready" as const, coords: { lat: 37.5663, lng: 126.9779 } }));
vi.mock("@/lib/geolocation", () => ({
  subscribeGeolocation: () => () => {},
  getGeolocationServerSnapshot: () => READY,
  awaitGeolocation: vi.fn(async () => READY),
  getGeolocationSnapshot: () => READY,
  DIRECTIONS_ORIGIN_MAX_AGE_SECONDS: 180,
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));

import { DirectionsView } from "../DirectionsView";

const DEST = { lat: 37.4979, lng: 127.0276 };
const TRANSIT = {
  recommended: {
    routeKey: "p0",
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
      { mode: "walk", minutes: 3 },
    ],
  },
  alternatives: [],
} as unknown as TransitRouteResult;

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  // 안내 패널은 geolocation 미지원 환경에서 렌더 자체를 접는다 — jsdom엔 없으므로 지원 상태를 만든다.
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
  });
  // 세션 폴링·부수 조회는 관심사가 아니다 — 실패 응답이면 훅이 정직 강등하고 세션은 유지된다.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("채팅 카드의 대중교통 안내 시작 뒤 포커스(E83, 실제 안내 패널)", () => {
  it("자동 시작 뒤 포커스는 body가 아니라 대중교통 섹션 안(안내 패널의 트리거나 상태 문장)에 선다", async () => {
    render(
      <DirectionsView
        canShowWalk
        canShowTransit
        canBriefCarRoute
        canPlanJourney={false}
        canSearchJourneyStops={false}
        initialTo={placeEndpoint("강남역", DEST, null)}
        initialGuide={{
          action: "start",
          mode: "transit",
          via: null,
          accessible: false,
          transit: { result: TRANSIT, origin: { lat: 37.5663, lng: 126.9779 } },
        }}
        onBack={() => {}}
      />,
    );
    const section = screen.getByRole("heading", { level: 3, name: "public" }).parentElement!;
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    const focused = document.activeElement as HTMLElement;
    expect(section.contains(focused)).toBe(true);
    // 화면 제목·수단 제목이 아니다 — 안내 패널이 가져간 착지다.
    expect(focused.tagName).not.toMatch(/^H[1-6]$/);
    // 안내가 시작됐다: 추천 경로의 시작 버튼이 더는 "시작" 라벨로 남아 있지 않다.
    expect(screen.queryByRole("button", { name: "guideStartTransitAlt" })).toBeNull();
  });
});

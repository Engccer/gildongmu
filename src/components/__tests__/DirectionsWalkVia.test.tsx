// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DirEndpoint } from "@/lib/directions-state";
import type { Place } from "@/lib/types";
import { __resetManualLocationForTest } from "@/lib/manual-location-store";

/**
 * 웹 길찾기 화면의 경유지 도보 안내(N4 판정 ③) — 화면·패널·훅을 **실물로 이어** 본다. 층마다의 계약은
 * 각자 잠겨 있다(뷰가 넘기는 값: `DirectionsView.test` 경유지 절, 패널→훅: `DistanceBeacon-via.test`,
 * 훅의 경유지 조회·포기: `useRouteGuide.via.test`). 여기서는 그 셋이 한 화면에서 성립하는지만:
 * 안내 조회가 경유지를 싣고, 경유지 경로가 없으면 포기 문장이 **화면의 단일 창구**로 나간다.
 */
vi.mock("next-intl", async () => (await import("./stable-intl-mock")).stableIntlMock("ko"));
vi.mock("@/lib/geolocation", () => ({
  subscribeGeolocation: () => () => {},
  getGeolocationServerSnapshot: () => ({ status: "idle" as const }),
  // 뷰의 출발지 측위와 훅의 실좌표 측위가 같은 함수를 지난다.
  awaitGeolocation: vi.fn(async () => ({
    status: "ready" as const,
    coords: { lat: 37.5352, lng: 127.1441, accuracy: 10, at: Date.now() },
  })),
  // `useSyncExternalStore` 스냅샷은 고정 참조여야 한다(매번 새 객체면 무한 재렌더).
  getGeolocationSnapshot: ((snapshot) => () => snapshot)({ status: "idle" as const }),
  DIRECTIONS_ORIGIN_MAX_AGE_SECONDS: 180,
}));
vi.mock("@/hooks/useBeaconSound", () => ({
  useBeaconSound: () => ({ play: vi.fn(() => 0), preload: vi.fn() }),
}));
vi.mock("../SurroundingsScene", () => ({ SurroundingsScene: () => null }));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
vi.mock("../WalkRouteBriefing", () => ({ WalkRouteResult: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteResult: () => null }));

import { DirectionsView } from "../DirectionsView";

const gangnam: Place = {
  id: "p-gangnam",
  name: "강남역",
  category: "지하철역",
  address: "서울 강남구 역삼동 858",
  roadAddress: "서울 강남구 강남대로 396",
  lat: 37.497,
  lng: 127.027,
};
const to: DirEndpoint = { kind: "place", label: "길동", coord: { lat: 37.5272, lng: 127.1268 } };

let calledUrls: string[] = [];
/** 안내 훅의 조회 응답이 경유지 위치를 아는가(false = 경유지 경로 없음과 같은 갈래). */
let guideHasWaypoint = false;

beforeEach(() => {
  calledUrls = [];
  guideHasWaypoint = false;
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.startsWith("/api/places/entrance")) {
        return { ok: true, json: async () => ({ entrance: null }) } as Response;
      }
      if (url.startsWith("/api/places")) {
        return { ok: true, json: async () => ({ places: [gangnam], provider: "kakao-local", query: "q" }) } as Response;
      }
      if (url.startsWith("/api/address/search")) {
        return { ok: true, json: async () => ({ addresses: [] }) } as Response;
      }
      if (url.startsWith("/api/route/car")) {
        return { ok: true, json: async () => ({ provider: "tmap", durationSeconds: 600, guides: [] }) } as Response;
      }
      if (url.startsWith("/api/route/walk") && url.includes("includeGeometry=1")) {
        // 안내 훅의 조회. 경유지(37.497,127.027)가 스텝 1의 시작이다.
        const origin = { lat: 37.5352, lng: 127.1441 };
        const via = { lat: 37.497, lng: 127.027 };
        const dest = { lat: 37.5272, lng: 127.1268 };
        return {
          ok: true,
          json: async () => ({
            result: {
              distanceMeters: 9000,
              durationSeconds: 7000,
              steps: [
                { description: "직진 5km 이동", pathCoords: [origin, via] },
                { description: "직진 4km 이동", pathCoords: [via, dest] },
              ],
              ...(guideHasWaypoint ? { waypoint: { stepIndex: 1, coord: via } } : {}),
            },
          }),
        } as Response;
      }
      if (url.startsWith("/api/route/walk")) {
        return {
          ok: true,
          json: async () => ({
            lines: [
              {
                kind: "shortest",
                route: {
                  distanceMeters: 900,
                  durationSeconds: 800,
                  steps: [{ description: "a" }],
                  waypoint: { stepIndex: 1, coord: { lat: 37.497, lng: 127.027 } },
                },
              },
            ],
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  __resetManualLocationForTest();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

/** 경유지 강남역으로 조회하고 도보 안내를 시작한다. */
async function startWalkGuideWithVia() {
  render(<DirectionsView canShowWalk canShowTransit canBriefCarRoute onBack={() => {}} initialTo={to} />);
  fireEvent.click(screen.getByRole("button", { name: "directions.addVia" }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("directions.via")));
  fireEvent.change(screen.getByLabelText("directions.via"), { target: { value: "강남" } });
  fireEvent.click(screen.getByRole("button", { name: "directions.searchVia" }));
  await waitFor(() => expect(document.activeElement?.textContent).toContain("강남역,"));
  fireEvent.click(document.activeElement as HTMLElement);
  fireEvent.click(screen.getByRole("button", { name: "directions.submit" }));
  const start = await screen.findByRole("button", { name: /^beacon\.guideStartWalkShortest/ });
  await act(async () => {
    fireEvent.click(start);
  });
}

describe("경유지 조회의 도보 안내(화면 통합)", () => {
  it("안내 조회가 경유지를 싣고, 경유지 경로가 없으면 빼고 안내한다고 화면 창구로 말한다", async () => {
    await startWalkGuideWithVia();

    await waitFor(() => {
      const guideCalls = calledUrls.filter((u) => u.includes("includeGeometry=1"));
      expect(guideCalls).toHaveLength(1);
      expect(new URLSearchParams(guideCalls[0].split("?")[1]).get("via")).toBe("37.497,127.027");
    });
    // ko 목적격 조사는 호출부(훅)가 받침으로 붙인다("강남역을").
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("directions.viaDropped:강남역을");
    });
  });

  it("안내 중에 경유지를 지우면 세션을 멈추고 그 사실을 말한다 — 지운 경유지로 계속 안내하지 않는다", async () => {
    guideHasWaypoint = true;
    await startWalkGuideWithVia();
    await waitFor(() => expect(calledUrls.filter((u) => u.includes("includeGeometry=1"))).toHaveLength(1));
    const guideCalls = () => calledUrls.filter((u) => u.includes("includeGeometry=1")).length;

    fireEvent.click(screen.getByRole("button", { name: "directions.removeVia" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("beacon.stopped"));
    expect(screen.queryByRole("button", { name: /^beacon\.guideStartWalkShortest/ })).toBeNull();
    expect(guideCalls()).toBe(1);
  });
});

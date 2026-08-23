// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Place } from "@/lib/types";
import messages from "../../../messages/ko.json";

/**
 * E11 섹션 동적 순서 계약(spec 2026-08-12 §2·§3.2):
 * 성공 앞·비성공 뒤, 도보 30분 이하 최상단, settled 후 순서 불변.
 */

vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({ status: "error" as const })),
  getGeolocationSnapshot: () => ({ status: "idle" as const }),
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../WalkRouteBriefing", () => ({
  WalkRouteResult: () => <p>도보 구간 상세</p>,
}));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
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

const WALK_SHORT = {
  result: { distanceMeters: 900, durationSeconds: 20 * 60, steps: [{ description: "직진 900m 이동" }] },
};
const WALK_LONG = {
  result: { distanceMeters: 2500, durationSeconds: 35 * 60, steps: [{ description: "직진 2.5km 이동" }] },
};
const TRANSIT_OK = {
  result: {
    recommended: {
      summary: { totalMinutes: 30, fare: 1550, transfers: 0, walkMinutes: 6 },
      legs: [{ mode: "walk", minutes: 6 }],
      routeKey: "p0",
    },
    alternatives: [],
    totalCandidates: 1,
  },
};

/** walk는 호출 차수별 응답 배열(계단 회피 재조회의 응답 전환용) */
function stubFetch(opts: { walks: Array<object | "error">; transit: object | "error" }) {
  let walkCall = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/places")) {
        return {
          ok: true,
          json: async () => ({ places: [gangnam], provider: "kakao-local", query: "q" }),
        } as Response;
      }
      if (url.startsWith("/api/address/search")) {
        return { ok: true, json: async () => ({ addresses: [] }) } as Response;
      }
      if (url.startsWith("/api/route/walk")) {
        const body = opts.walks[Math.min(walkCall++, opts.walks.length - 1)];
        if (body === "error") return { ok: false, json: async () => ({}) } as Response;
        return { ok: true, json: async () => body } as Response;
      }
      if (url.startsWith("/api/transit/track")) {
        return { ok: false, json: async () => ({}) } as Response;
      }
      if (url.startsWith("/api/route/transit")) {
        if (opts.transit === "error") return { ok: false, json: async () => ({}) } as Response;
        return { ok: true, json: async () => opts.transit } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

/** DistanceBeacon·TransitGuidePanel은 측위 미지원 환경에서 렌더를 접는다 */
function stubGeolocationApi() {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
  });
}

async function queryRoutes() {
  stubGeolocationApi();
  render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <DirectionsView canShowWalk canShowTransit canBriefCarRoute={false} onBack={() => {}} />
    </NextIntlClientProvider>,
  );
  // 후보 확정 흐름은 기존 스위트 관례(포커스 전진 → activeElement 클릭).
  fireEvent.change(screen.getByLabelText("출발지"), { target: { value: "강남" } });
  fireEvent.click(screen.getByRole("button", { name: "출발지 검색" }));
  await waitFor(() => {
    expect(document.activeElement?.textContent).toContain("강남역,");
  });
  fireEvent.click(document.activeElement as HTMLElement);

  fireEvent.change(screen.getByLabelText("도착지"), { target: { value: "강남" } });
  fireEvent.click(screen.getByRole("button", { name: "도착지 검색" }));
  await waitFor(() => {
    expect(document.activeElement?.textContent).toContain("강남역,");
  });
  fireEvent.click(document.activeElement as HTMLElement);

  fireEvent.click(screen.getByRole("button", { name: "경로 조회" }));
  await waitFor(() => {
    expect(
      screen.queryByText(/경로 안내가 준비되었습니다/) ??
        screen.queryByText("경로를 찾지 못했습니다."),
    ).not.toBeNull();
  });
}

/** 수단 heading(h3) 텍스트를 문서 순서로 수집 */
function modeHeadings(): string[] {
  return screen
    .getAllByRole("heading", { level: 3 })
    .map((h) => h.textContent ?? "")
    .filter((tx) => ["대중교통", "자동차", "도보"].includes(tx));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("길찾기 섹션 동적 순서(E11 spec §2)", () => {
  it("도보 30분 이하 성공이면 도보가 최상단이고 포커스도 도보 heading이다", async () => {
    stubFetch({ walks: [WALK_SHORT], transit: TRANSIT_OK });
    await queryRoutes();
    expect(modeHeadings()).toEqual(["도보", "대중교통"]);
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("도보");
    });
  });

  it("장거리 도보는 제자리, 실패한 대중교통은 최하단(첫 성공 포커스는 도보)", async () => {
    stubFetch({ walks: [WALK_LONG], transit: "error" });
    await queryRoutes();
    expect(modeHeadings()).toEqual(["도보", "대중교통"]);
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("도보");
    });
  });

  it("전 수단 성공에 도보 장거리면 현행 순서 유지", async () => {
    stubFetch({ walks: [WALK_LONG], transit: TRANSIT_OK });
    await queryRoutes();
    expect(modeHeadings()).toEqual(["대중교통", "도보"]);
  });

  it("계단 회피 재조회는 도보가 empty→성공으로 바뀌어도 순서를 재계산하지 않는다", async () => {
    stubFetch({ walks: [{ result: null }, WALK_SHORT], transit: TRANSIT_OK });
    await queryRoutes();
    expect(modeHeadings()).toEqual(["대중교통", "도보"]);

    fireEvent.click(screen.getByRole("button", { name: "계단 회피 경로" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "계단 회피 경로" }).getAttribute("aria-busy"),
      ).toBe("false");
    });
    // 도보가 성공(20분)이 됐지만 순서는 settled 스냅샷 그대로다(spec §2 규칙 3).
    expect(screen.getByText("도보 구간 상세")).toBeTruthy();
    expect(modeHeadings()).toEqual(["대중교통", "도보"]);
  });
});

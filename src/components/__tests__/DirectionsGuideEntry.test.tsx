// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Place } from "@/lib/types";

/**
 * 수단별 안내 진입점 게이트 상태 행렬(B1 스펙 §3.1·§8.4):
 * {도보 성공/실패} × {자동차 tmap/kakao/실패} × {로케일 ko/en} 대표 조합에서
 * 시작 버튼·간략 폴백 노출을 단언한다. 세션 동작은 useRouteGuide.car.test가,
 * 판정은 리듀서 fixture가 잠그므로 여기서는 노출 게이트만 본다.
 */
let mockLocale = "ko";
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => mockLocale,
}));
vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({ status: "error" as const })),
  getGeolocationSnapshot: () => ({ status: "idle" as const }),
}));
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

const CAR_OK = {
  distanceMeters: 12000,
  durationSeconds: 1400,
  taxiFare: 14000,
  tollFare: 0,
  guides: [{ name: "", guidance: "직진", distanceMeters: 0, durationSeconds: 0 }],
};
const WALK_OK = {
  result: {
    distanceMeters: 2000,
    durationSeconds: 1700,
    steps: [{ description: "직진 2km 이동" }],
  },
};

function stubFetch(opts: {
  walk: "ok" | "fail";
  car: "tmap" | "kakao" | "fail";
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/places")) {
        return {
          ok: true,
          json: async () => ({
            places: [gangnam],
            provider: "kakao-local",
            query: "q",
          }),
        } as Response;
      }
      if (url.startsWith("/api/address/search")) {
        return { ok: true, json: async () => ({ addresses: [] }) } as Response;
      }
      if (url.startsWith("/api/route/car")) {
        if (opts.car === "fail") return { ok: false, json: async () => ({}) } as Response;
        return {
          ok: true,
          json: async () => ({ ...CAR_OK, provider: opts.car }),
        } as Response;
      }
      if (url.startsWith("/api/route/walk")) {
        if (opts.walk === "fail") return { ok: false, json: async () => ({}) } as Response;
        return { ok: true, json: async () => WALK_OK } as Response;
      }
      if (url.startsWith("/api/route/transit")) {
        return { ok: true, json: async () => ({ result: null }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

async function queryRoutes() {
  // 안내 패널은 geolocation 미지원 환경에서 렌더 자체를 접는다(graceful) —
  // jsdom엔 없으므로 스텁으로 지원 상태를 만든다.
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
  });
  render(
    <DirectionsView canShowWalk canShowTransit canBriefCarRoute onBack={() => {}} />,
  );
  // 후보 확정 흐름은 기존 DirectionsView.test 관례(포커스 전진 → activeElement 클릭).
  fireEvent.change(screen.getByLabelText("from"), { target: { value: "강남" } });
  fireEvent.click(screen.getByRole("button", { name: "searchFrom" }));
  await waitFor(() => {
    expect(document.activeElement?.textContent).toContain("강남역,");
  });
  fireEvent.click(document.activeElement as HTMLElement);

  fireEvent.change(screen.getByLabelText("to"), { target: { value: "강남" } });
  fireEvent.click(screen.getByRole("button", { name: "searchTo" }));
  await waitFor(() => {
    expect(document.activeElement?.textContent).toContain("강남역,");
  });
  fireEvent.click(document.activeElement as HTMLElement);

  fireEvent.click(screen.getByRole("button", { name: "submit" }));
  await waitFor(() => {
    // settled(성공 유무 무관)까지 대기 — 폴백 게이트도 settled 이후에만 계산된다.
    expect(
      screen.queryByText("readySummary") ?? screen.queryByText("allFailed"),
    ).not.toBeNull();
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mockLocale = "ko";
});

describe("수단별 안내 진입점 게이트(§3.1)", () => {
  it("ko + 도보·자동차(tmap) 성공: 두 시작 버튼 노출, 간략 폴백 없음", async () => {
    stubFetch({ walk: "ok", car: "tmap" });
    await queryRoutes();
    expect(screen.getByRole("button", { name: "walkGuideStart" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "carGuideStart" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "briefGuideStart" })).toBeNull();
  });

  it("ko + 자동차 kakao 폴백(도보 실패): 자동차 버튼 없음 + 간략 폴백 노출", async () => {
    stubFetch({ walk: "fail", car: "kakao" });
    await queryRoutes();
    expect(screen.queryByRole("button", { name: "carGuideStart" })).toBeNull();
    expect(screen.queryByRole("button", { name: "walkGuideStart" })).toBeNull();
    expect(screen.getByRole("button", { name: "briefGuideStart" })).toBeTruthy();
  });

  it("ko + 전 수단 실패: 목적지 확정이면 간략 폴백만 노출", async () => {
    stubFetch({ walk: "fail", car: "fail" });
    await queryRoutes();
    expect(screen.queryByRole("button", { name: "walkGuideStart" })).toBeNull();
    expect(screen.queryByRole("button", { name: "carGuideStart" })).toBeNull();
    expect(screen.getByRole("button", { name: "briefGuideStart" })).toBeTruthy();
  });

  it("en + 자동차(tmap) 성공: 수단 안내는 ko 전용이라 간략 폴백으로 흐른다", async () => {
    mockLocale = "en";
    stubFetch({ walk: "ok", car: "tmap" });
    await queryRoutes();
    expect(screen.queryByRole("button", { name: "carGuideStart" })).toBeNull();
    expect(screen.queryByRole("button", { name: "walkGuideStart" })).toBeNull();
    expect(screen.getByRole("button", { name: "briefGuideStart" })).toBeTruthy();
  });
});

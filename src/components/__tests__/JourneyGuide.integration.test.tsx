// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ko from "../../../messages/ko.json";
import type { EgressOption, JourneyVariant } from "@/lib/types";
import { __resetGuideSessionStoreForTest, claimGuideSession, hasActiveGuideSession } from "@/lib/guide-session-store";

/**
 * 실물 `DistanceBeacon`(+`useRouteGuide`)과 엮은 여정 통합 테스트(E70-f 리뷰 B1·M2·M3). 목 패널 스위트는 단계 세션의 저장소
 * claim·`onSessionEnd` 순서를 재현하지 못해 무한 재귀를 놓쳤다 — 여기서는 실물 세션이 도는 채로 버튼·외부 시작·권한 거부를 넣는다.
 */
vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({ status: "ready" as const, coords: { lat: 37.55, lng: 126.95 } })),
  getGeolocationSnapshot: () => ({ status: "idle" as const }),
}));
vi.mock("../TransitGuidePanel", () => ({
  TransitGuidePanel: () => <div data-testid="transit" />,
}));
vi.mock("../SurroundingsScene", () => ({ SurroundingsScene: () => null }));
vi.mock("@/lib/transit-guide", () => ({ buildTransitGuideRoute: () => ({ legs: [] }) }));

import { JourneyGuide } from "../JourneyGuide";

const exit: EgressOption = {
  kind: "exit",
  label: "3",
  placeName: "역곡역 3번출구",
  coord: { lat: 37.4851, lng: 126.8115 },
  taxiOut: { durationSeconds: 600, taxiFare: 6000 } as EgressOption["taxiOut"],
};
const variant = {
  kind: "designated",
  boardStation: { name: "아현", coord: { lat: 37.5577, lng: 126.9562 } },
  alightStation: { name: "역곡", coord: { lat: 37.485, lng: 126.811 } },
  taxiIn: { durationSeconds: 480, taxiFare: 7800 },
  transit: { routeKey: "r", legs: [{ mode: "subway", fromName: "아현", toName: "역곡", lineName: "수도권 1호선" }] },
  totals: { minutes: 50, taxiFare: 13800, transitFare: 1550 },
} as unknown as JourneyVariant;

const plan = { variant, egress: exit, alightDesignated: true, dest: { lat: 37.5, lng: 126.78 }, destLabel: "부천시청" };
let watchError: ((e: unknown) => void) | null = null;
const onFinished = vi.fn();

function renderGuide() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <JourneyGuide plan={plan} announce={() => {}} onFinished={onFinished} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  __resetGuideSessionStoreForTest();
  onFinished.mockReset();
  watchError = null;
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: vi.fn((_ok: unknown, err: (e: unknown) => void) => {
        watchError = err;
        return 1;
      }),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
  });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ result: null }) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 택시 단계 세션이 실제로 추적 중이 될 때까지. */
async function taxiTracking() {
  // 사이 상태 시트에도 「안내 종료」가 있어 버튼 이름으로는 가를 수 없다 — 실제 위치 구독이 섰는지로 본다.
  await waitFor(() => expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1), { timeout: 3000 });
  expect(screen.getByRole("button", { name: ko.journey.taxiDropped })).toBeTruthy();
}

describe("JourneyGuide × 실물 DistanceBeacon", () => {
  it("택시 추적 중 [자동차에서 내렸어요]는 재귀 없이 준비 중으로 넘어가고 다음 단계가 선다(리뷰 B1)", async () => {
    renderGuide();
    await taxiTracking();
    fireEvent.click(screen.getByRole("button", { name: ko.journey.taxiDropped }));
    expect(screen.getByText(ko.directions.loading)).toBeTruthy();
    expect(onFinished).not.toHaveBeenCalled();
    // 측위 스냅숏이 없으면 접근 도보를 시작한다 — 실물 도보 패널이 두 번째 위치 구독을 연다.
    await waitFor(() => expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(screen.getByRole("button", { name: ko.transitGuide.prewalkArrivedButton.replace("{station}", "아현") })).toBeTruthy();
  });

  it("단계 세션이 도는 중 다른 안내가 시작되면 여정이 끝난다(리뷰 M3)", async () => {
    renderGuide();
    await taxiTracking();
    act(() => claimGuideSession(() => {}));
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith(false));
    expect(hasActiveGuideSession()).toBe(true); // 그 다른 세션이 주인이다
  });

  it("첫 fix 전 권한 거부는 시작 실패 → 실패 시트(리뷰 M2)", async () => {
    renderGuide();
    await taxiTracking();
    act(() => watchError?.({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }));
    await waitFor(() => expect(screen.getByText(ko.journey.taxiOutFailed)).toBeTruthy());
    expect(screen.getByRole("button", { name: ko.guide.rerouteButton })).toBeTruthy();
  });
});

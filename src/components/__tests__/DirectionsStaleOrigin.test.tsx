// @vitest-environment jsdom
/**
 * 옛 위치(위원장 판정 2026-09-23, spec 2026-09-23-stale-origin-disclosure-design.md §4.1):
 * 재측위가 취득 실패로 끝났고 직전 좌표가 있으면 길찾기는 그 옛 위치로 계속하고, 출발지 칸과
 * 완료 통지가 옛 위치임을 밝히며, 안내 시작 순간에는 실좌표에서 시작함을 말한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ko from "../../../messages/ko.json";
import type { GeoState } from "@/lib/geolocation";
import { __resetCurrentAddressForTest } from "@/lib/current-address-store";

const geo = vi.hoisted(() => ({ snapshot: { status: "idle" } as GeoState }));

vi.mock("@/lib/geolocation", () => ({
  // DirectionsView가 `useGeolocation`으로 스토어를 구독한다(stale-origin) — 구독 두 함수도 함께 준다.
  subscribeGeolocation: () => () => {},
  getGeolocationServerSnapshot: () => ({ status: "idle" as const }),
  awaitGeolocation: vi.fn(async () => geo.snapshot),
  getGeolocationSnapshot: () => geo.snapshot,
  DIRECTIONS_ORIGIN_MAX_AGE_SECONDS: 180,
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
vi.mock("../WalkRouteBriefing", () => ({ WalkRouteResult: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteResult: () => null }));
vi.mock("../DistanceBeacon", () => ({
  DistanceBeacon: ({
    triggerLabel,
    announce,
    onStart,
  }: {
    triggerLabel?: string;
    announce: (text: string) => void;
    onStart?: () => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        onStart?.();
        announce("beaconStarted");
      }}
    >
      {triggerLabel}
    </button>
  ),
}));

import { DirectionsView } from "../DirectionsView";

const FIX_SEC = Date.now() / 1000 - 5 * 60 - 10;

function stubRoutes(calledUrls: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.startsWith("/api/geocode/reverse")) {
        return { ok: true, json: async () => ({ address: "성내로 12" }) } as Response;
      }
      if (url.startsWith("/api/route/car")) {
        return { ok: true, json: async () => ({ provider: "tmap", durationSeconds: 600 }) } as Response;
      }
      if (url.startsWith("/api/route/transit")) {
        return { ok: true, json: async () => ({ result: null }) } as Response;
      }
      if (url.startsWith("/api/route/walk")) {
        return { ok: true, json: async () => ({ lines: [] }) } as Response;
      }
      if (url.startsWith("/api/places/entrance")) {
        return { ok: true, json: async () => ({ entrance: null }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

// 실제 ko 카탈로그로 렌더한다 — 키만 돌려주는 번역 목은 네임스페이스·인자 오배선을 못 잡는다(구현 리뷰 L-7).
function renderView() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <DirectionsView
        canShowWalk
        canShowTransit
        canBriefCarRoute
        onBack={() => {}}
        initialTo={{ kind: "place", label: "잠실역", coord: { lat: 37.5, lng: 127.1 } }}
      />
    </NextIntlClientProvider>,
  );
}
const fromValue = () => (screen.getByLabelText("출발지") as HTMLInputElement).value;
const submit = () => fireEvent.click(screen.getByRole("button", { name: "경로 조회" }));

beforeEach(() => {
  localStorage.clear();
  __resetCurrentAddressForTest();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  geo.snapshot = { status: "idle" };
});

describe("DirectionsView 옛 위치", () => {
  const stale: GeoState = {
    status: "denied",
    reason: "timeout",
    last: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: FIX_SEC },
  };

  it("재측위가 취득 실패면 옛 좌표로 조회하고, 칸·완료 통지가 옛 위치를 밝히며, 안내 시작은 현재 위치에서 시작함을 말한다", async () => {
    geo.snapshot = stale;
    const calledUrls: string[] = [];
    stubRoutes(calledUrls);
    renderView();
    submit();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(
        /준비되었습니다\. 현재 위치를 확인하지 못해 5분 전에 확인한 위치로 찾았습니다\.$/,
      );
    });
    expect(calledUrls.some((u) => u.startsWith("/api/route/car?origin=37.5384,127.1432"))).toBe(true);
    await waitFor(() => expect(fromValue()).toBe("마지막으로 확인한 위치, 성내로 12, 5분 전"));

    fireEvent.click(screen.getByRole("button", { name: "자동차 안내 시작" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("beaconStarted 현재 위치에서 안내를 시작합니다");
    });
  });

  it("진입만으로 칸이 스토어의 옛 위치를 따른다(측위·조회 없이)", async () => {
    geo.snapshot = stale;
    stubRoutes([]);
    renderView();
    await waitFor(() => expect(fromValue()).toBe("마지막으로 확인한 위치, 성내로 12, 5분 전"));
  });

  it("권한 거부는 옛 좌표로 계속하지 않고(geoError) 칸도 옛 위치를 말하지 않는다", async () => {
    geo.snapshot = { status: "denied", reason: "denied" };
    const calledUrls: string[] = [];
    stubRoutes(calledUrls);
    renderView();
    expect(fromValue()).toBe("현재 위치");
    submit();
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(ko.directions.geoError);
    });
    expect(calledUrls.some((u) => u.startsWith("/api/route/"))).toBe(false);
  });

  it("신선한 좌표로 조회하면 완료 통지에 뒷문장이 없고 칸은 현재 위치다", async () => {
    geo.snapshot = {
      status: "ready",
      coords: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
    };
    stubRoutes([]);
    renderView();
    submit();
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/준비되었습니다\.$/);
    });
    await waitFor(() => expect(fromValue()).toBe("현재 위치(성내로 12 부근)"));
  });
});

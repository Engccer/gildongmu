// @vitest-environment jsdom
/**
 * 옛 위치(위원장 판정 2026-09-23, spec 2026-09-23-stale-origin-disclosure-design.md §4.1):
 * 재측위가 취득 실패로 끝났고 직전 좌표가 있으면 길찾기는 그 옛 위치로 계속하고, 출발지 칸과
 * 완료 통지가 옛 위치임을 밝히며, 안내 시작 순간에는 실좌표에서 시작함을 말한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GeoState } from "@/lib/geolocation";

const geo = vi.hoisted(() => ({ snapshot: { status: "idle" } as GeoState }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values && "age" in values ? `${key}[${String(values.age)}]` : key,
  useLocale: () => "ko",
}));
vi.mock("@/lib/geolocation", () => ({
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

function renderView() {
  return render(
    <DirectionsView
      canShowWalk
      canShowTransit
      canBriefCarRoute
      onBack={() => {}}
      initialTo={{ kind: "place", label: "잠실역", coord: { lat: 37.5, lng: 127.1 } }}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  geo.snapshot = { status: "idle" };
});

describe("DirectionsView 옛 위치", () => {
  it("재측위가 취득 실패면 옛 좌표로 조회하고, 칸·완료 통지가 옛 위치를 밝히며, 안내 시작은 현재 위치에서 시작함을 말한다", async () => {
    geo.snapshot = {
      status: "denied",
      reason: "timeout",
      last: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: FIX_SEC },
    };
    const calledUrls: string[] = [];
    stubRoutes(calledUrls);
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "readySummary staleOriginNotice[staleAgeMinutes]",
      );
    });
    expect(calledUrls.some((u) => u.startsWith("/api/route/car?origin=37.5384,127.1432"))).toBe(true);
    await waitFor(() => {
      expect((screen.getByLabelText("from") as HTMLInputElement).value).toBe(
        "gpsStale[staleAgeMinutes]",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "guideStartCar" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("beaconStarted guideStartsFromCurrent");
    });
  });

  it("권한 거부는 옛 좌표로 계속하지 않는다(geoError)", async () => {
    geo.snapshot = { status: "denied", reason: "denied" };
    const calledUrls: string[] = [];
    stubRoutes(calledUrls);
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("geoError");
    });
    expect(calledUrls.some((u) => u.startsWith("/api/route/"))).toBe(false);
  });

  it("신선한 좌표로 조회하면 완료 통지에 뒷문장이 없다", async () => {
    geo.snapshot = {
      status: "ready",
      coords: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
    };
    stubRoutes([]);
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("readySummary");
    });
    expect((screen.getByLabelText("from") as HTMLInputElement).value).toBe("currentLocationNear");
  });
});

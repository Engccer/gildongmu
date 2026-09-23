// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TransitRoute } from "@/lib/types";
import { __resetGeolocationForTest, awaitGeolocation, getGeolocationSnapshot } from "@/lib/geolocation";

/**
 * 버스 승차 중 현재 정류장(E48 spec 2026-09-23 bus-current-stop §5)의 **웹 배선** — 세션 전용 위치 스트림이
 * 경유 정류장 목록에 "현재 위치"를 세우는가, 공유 스토어를 덮지 않는가, 권한 전엔 열지 않는가.
 * 판정은 공유 fixture(`transit-bus-stop-cases.json`)가 잠근다.
 */
vi.mock("next-intl", async () => (await import("./stable-intl-mock")).stableIntlMock("ko"));

import { TransitGuidePanelHost } from "./live-region-host";

const STOPS = [
  { name: "길동사거리", lat: 37.5, lng: 127.1, cityCode: "1000", arsId: "24101", localId: "123000017" },
  { name: "강동역", lat: 37.51, lng: 127.11, cityCode: "1000", arsId: "24150", localId: "123000030" },
  { name: "천호역", lat: 37.53, lng: 127.12, cityCode: "1000", arsId: "24102", localId: "123000043" },
];

const BUS_ROUTE: TransitRoute = {
  summary: { totalMinutes: 20, fare: 1500, transfers: 0, walkMinutes: 2 },
  routeKey: "b0",
  legs: [
    {
      mode: "bus",
      lineName: "3318",
      fromName: "길동사거리",
      toName: "천호역",
      stationCount: 2,
      minutes: 12,
      serviceRouteId: "227000006",
      stops: STOPS,
    },
  ],
};

/** 승차 정류소엔 후보 1건, 하차 정류소엔 0건 — riding notYetVisible에 머문다. */
function stubTrack() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return {
        ok: true,
        json: async () =>
          url.includes("phase=wait")
            ? {
                mode: "seoulBus",
                status: "ok",
                rawCount: 1,
                items: [{ vehicleId: "111033479", direction: "", message: "3분후[2번째 전 정류소]",
                  remainingStops: 2, destinationName: "천호역", express: false }],
              }
            : { mode: "seoulBus", status: "empty", rawCount: 0 },
      } as Response;
    }),
  );
}

/** `TransitGuidePanel.test.tsx`의 같은 이름 헬퍼(A41 — 곧 도착 뒤 소실 2폴로 riding). */
async function boardBusByDeparture() {
  const inner = globalThis.fetch;
  let waitPolls = 0;
  vi.stubGlobal("fetch", (async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0]);
    if (!url.includes("phase=wait")) return inner(...args);
    waitPolls += 1;
    if (waitPolls === 1) {
      const res = await inner(...args);
      const body = await res.json();
      const items = (body.items ?? []).map((it: Record<string, unknown>) => ({
        ...it,
        message: "곧 도착",
        remainingStops: 0,
      }));
      return { ok: true, json: async () => ({ ...body, items }) } as Response;
    }
    return { ok: true, json: async () => ({ mode: "seoulBus", status: "empty", rawCount: 0 }) } as Response;
  }) as unknown as typeof fetch);
  fireEvent.click(await screen.findByRole("button", { name: /selectBus/ }));
  await waitFor(() => expect(waitPolls).toBe(1));
  for (const n of [2, 3]) {
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(waitPolls).toBe(n));
  }
  await waitFor(() => expect(screen.queryByRole("button", { name: /selectBus/ })).toBeNull());
  vi.stubGlobal("fetch", inner);
}

/**
 * geolocation 스텁 — 단발 측위(`getCurrentPosition`)는 길찾기 화면이 받아 둔 공유 스토어 좌표용, 안내 스트림
 * (`watchPosition`)은 콜백을 잡아 테스트가 fix를 직접 흘린다.
 */
function stubGeolocation() {
  const getCurrentPosition = vi.fn((ok: PositionCallback) =>
    ok({ coords: { latitude: 37.5, longitude: 127.1, accuracy: 15 }, timestamp: Date.now() } as unknown as GeolocationPosition),
  );
  const watchers: PositionCallback[] = [];
  const watchPosition = vi.fn((ok: PositionCallback, _err?: PositionErrorCallback | null, _opts?: PositionOptions) => {
    watchers.push(ok);
    return watchers.length;
  });
  const clearWatch = vi.fn();
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition, watchPosition, clearWatch },
    configurable: true,
  });
  /** 강동역 앞(정확도 15m, 지금 측정) fix 한 건을 살아 있는 스트림에 흘린다. */
  const emit = () =>
    act(() => {
      watchers.at(-1)?.({
        coords: { latitude: 37.5101, longitude: 127.11, accuracy: 15 },
        timestamp: Date.now(),
      } as unknown as GeolocationPosition);
    });
  return { getCurrentPosition, watchPosition, clearWatch, emit };
}

beforeEach(() => __resetGeolocationForTest());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetGeolocationForTest();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

async function startBusRiding() {
  stubTrack();
  render(<TransitGuidePanelHost route={BUS_ROUTE} triggerLabel="시작" walkAccessible={false} />);
  fireEvent.click(screen.getByRole("button", { name: "시작" }));
  await boardBusByDeparture();
  fireEvent.click(await screen.findByRole("button", { name: "transitGuide.viaStopsBus:3" }));
}

describe("버스 승차 중 현재 정류장 — 웹 배선(E48)", () => {
  it("세션 전용 스트림의 fix가 두 번 이어지면 경유 정류장 목록에 현재 위치가 서고, 공유 스토어는 건드리지 않는다", async () => {
    const geo = stubGeolocation();
    await awaitGeolocation(); // 길찾기 화면이 이미 위치를 받아 둔 상태
    await startBusRiding();
    await waitFor(() => expect(geo.watchPosition).toHaveBeenCalled());
    expect(geo.watchPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });

    // 한 건은 후보일 뿐이다(튄 fix 방어 — 설계 리뷰 M1).
    geo.emit();
    expect(screen.queryByText(/transitGuide\.viaCurrent/)).toBeNull();
    geo.emit();
    await waitFor(() => expect(screen.getByText("강동역, transitGuide.viaCurrent")).toBeTruthy());
    // 공유 스토어는 다시 재지 않았다 — 현재 위치 주소·표시줄이 흔들리지 않는다(설계 리뷰 M3).
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getGeolocationSnapshot()).toMatchObject({ status: "ready", coords: { lat: 37.5, lng: 127.1 } });
    // 상태 문장은 그대로다(E35 판정 1을 버스로 넓히지 않았다 — spec §6).
    expect(screen.getByText(/transitGuide\.stateRidingNotYetVisibleBus/)).toBeTruthy();
  });

  it("표식은 마지막 관측 + 90초에 거둔다 — 폴 시계를 기다리지 않는다(fix가 끊긴 터널)", async () => {
    const geo = stubGeolocation();
    await awaitGeolocation();
    await startBusRiding();
    await waitFor(() => expect(geo.watchPosition).toHaveBeenCalled());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      geo.emit();
      geo.emit();
      expect(screen.getByText("강동역, transitGuide.viaCurrent")).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(89_000);
      });
      expect(screen.getByText("강동역, transitGuide.viaCurrent")).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_100);
      });
      expect(screen.queryByText(/transitGuide\.viaCurrent/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("riding 뒤에 공유 스토어가 ready가 되어도 스트림이 열린다(스토어 구독)", async () => {
    const geo = stubGeolocation();
    await startBusRiding();
    await new Promise((r) => setTimeout(r, 50));
    expect(geo.watchPosition).not.toHaveBeenCalled();
    await act(async () => {
      await awaitGeolocation(); // 다른 화면(길찾기 등)이 위치를 받는다
    });
    await waitFor(() => expect(geo.watchPosition).toHaveBeenCalled());
  });

  it("다른 화면의 재측위가 시간 초과로 끝나도 스트림은 열려 있다(권한은 그대로다)", async () => {
    const geo = stubGeolocation();
    await awaitGeolocation();
    await startBusRiding();
    await waitFor(() => expect(geo.watchPosition).toHaveBeenCalledTimes(1));
    geo.getCurrentPosition.mockImplementation(((_ok: PositionCallback, err?: PositionErrorCallback | null) =>
      err?.({ code: 3, message: "timeout" } as GeolocationPositionError)) as never);
    await act(async () => {
      await awaitGeolocation({ force: true }); // 길찾기 "현재 위치" 다시 고르기 등
    });
    expect(getGeolocationSnapshot()).toMatchObject({ status: "denied", reason: "timeout" });
    // locating 동안 한 번 닫혔다 다시 열린다 — 마지막 스트림이 살아 있어야 한다.
    await waitFor(() => expect(geo.watchPosition.mock.calls.length).toBe(geo.clearWatch.mock.calls.length + 1));
    geo.emit();
    geo.emit();
    await waitFor(() => expect(screen.getByText("강동역, transitGuide.viaCurrent")).toBeTruthy());
  });

  it("권한이 거부된 스토어면 스트림을 열지 않는다(시간 초과·위치 불가와 다르다)", async () => {
    const geo = stubGeolocation();
    geo.getCurrentPosition.mockImplementation(((_ok: PositionCallback, err?: PositionErrorCallback | null) =>
      err?.({ code: 1, message: "denied" } as GeolocationPositionError)) as never);
    await awaitGeolocation();
    expect(getGeolocationSnapshot()).toMatchObject({ status: "denied", reason: "denied" });
    await startBusRiding();
    await new Promise((r) => setTimeout(r, 50));
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });

  it("탭을 숨기면 스트림을 닫는다", async () => {
    const geo = stubGeolocation();
    await awaitGeolocation();
    await startBusRiding();
    await waitFor(() => expect(geo.watchPosition).toHaveBeenCalled());
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(geo.clearWatch).toHaveBeenCalled());
  });

  it("공유 위치 스토어가 ready가 아니면 스트림을 열지 않는다 — 권한 팝업 없음, 표식 없음", async () => {
    const geo = stubGeolocation();
    await startBusRiding();
    await new Promise((r) => setTimeout(r, 50));
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.queryByText(/transitGuide\.viaCurrent/)).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ko from "../../../messages/ko.json";

// play는 재생 길이(초)를 반환하는 계약 — 이 스위트는 톤 선택만 보므로 0(즉시)로 고정.
const { playSpy } = vi.hoisted(() => ({ playSpy: vi.fn(() => 0) }));

vi.mock("../useBeaconSound", () => ({
  useBeaconSound: () => ({ play: playSpy, preload: vi.fn() }),
}));
vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({
    status: "ready" as const,
    coords: { lat: 37.5, lng: 127.1 },
  })),
}));

import { useRouteGuide } from "../useRouteGuide";

/**
 * 톤 배선 계약(훅 계층). 계층 판정 자체는 `guide-tone-layer.test.ts`가 잠그므로
 * 여기서는 **훅만 소유한 축**을 본다: fix 부재 워치독(타이머 구동)과 세션 경계 톤.
 *
 * ⚠ 워치독이 **타이머 구동**이라야 하는 이유가 이 테스트의 존재 이유다. fix 구동이면
 * 권한 철회·서비스 중단에서 콜백 자체가 오지 않아 마지막 정상 톤 이후 영구 침묵이
 * 되고, 백그라운드에서는 톤이 유일한 채널이라 그 침묵이 곧 무고장 판정이 된다.
 */
const M = 1 / 111320;
const DEST = { lat: 37.5 + 500 * M, lng: 127.1, name: "목적지" };

let watchCb: ((pos: GeolocationPosition) => void) | null = null;

function emitFix(meters: number, opts: { speed?: number | null; accuracy?: number } = {}) {
  watchCb?.({
    coords: {
      latitude: 37.5 + meters * M,
      longitude: 127.1,
      accuracy: opts.accuracy ?? 10,
      speed: opts.speed ?? null,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
    },
    timestamp: Date.now(),
  } as GeolocationPosition);
}

function Harness() {
  const g = useRouteGuide(DEST, "walk", false);
  return (
    <div>
      <button onClick={g.start}>start</button>
      <button onClick={g.stop}>stop</button>
      <p data-testid="status">{g.status}</p>
    </div>
  );
}

beforeEach(() => {
  // performance를 함께 가짜로 만들어야 한다 — 훅의 시각축이 performance.now()라
  // 타이머만 진행시키면 경과가 0으로 남아 워치독 조건이 성립하지 않는다.
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"],
  });
  playSpy.mockClear();
  watchCb = null;
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: vi.fn((ok: (pos: GeolocationPosition) => void) => {
        watchCb = ok;
        return 1;
      }),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
  });
  // 상세 경로 조회는 이 스위트의 대상이 아니다(간략 유지).
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderHarness() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <Harness />
    </NextIntlClientProvider>,
  );
}

describe("fix 부재 워치독", () => {
  it("fix가 오지 않으면 임계(8초) 경과 후 신뢰 불가 톤이 난다", async () => {
    renderHarness();
    await act(async () => {
      fireEvent.click(screen.getByText("start"));
    });
    expect(screen.getByTestId("status").textContent).toBe("tracking");
    expect(playSpy).toHaveBeenCalledWith("start");
    playSpy.mockClear();

    // 임계 전에는 침묵한다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(playSpy).not.toHaveBeenCalledWith("unreliable");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(playSpy).toHaveBeenCalledWith("unreliable");
  });

  it("fix가 도착하면 워치독 기준이 갱신되어 다시 울리지 않는다", async () => {
    renderHarness();
    await act(async () => {
      fireEvent.click(screen.getByText("start"));
    });
    expect(screen.getByTestId("status").textContent).toBe("tracking");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
      emitFix(500);
      await vi.advanceTimersByTimeAsync(6000);
    });
    // 세션 시작 후 10초가 지났지만 마지막 fix로부터는 6초뿐이다.
    expect(playSpy).not.toHaveBeenCalledWith("unreliable");
  });

  it("세션을 중지하면 워치독도 멎는다(좀비 톤 금지)", async () => {
    renderHarness();
    await act(async () => {
      fireEvent.click(screen.getByText("start"));
    });
    expect(screen.getByTestId("status").textContent).toBe("tracking");
    fireEvent.click(screen.getByText("stop"));
    playSpy.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(playSpy).not.toHaveBeenCalledWith("unreliable");
  });
});

describe("간략 모드 톤 배선", () => {
  it("정확도가 무효한 fix는 앵커를 잡지 않고 신뢰 불가 톤을 낸다", async () => {
    renderHarness();
    await act(async () => {
      fireEvent.click(screen.getByText("start"));
    });
    expect(screen.getByTestId("status").textContent).toBe("tracking");
    playSpy.mockClear();

    await act(async () => {
      // 100m를 넘는 정확도는 리듀서가 weak으로 판정한다.
      emitFix(500, { accuracy: 400 });
    });
    expect(playSpy).toHaveBeenCalledWith("unreliable");
  });

  it("데드밴드를 넘어 가까워지면 closer 톤이 난다", async () => {
    renderHarness();
    await act(async () => {
      fireEvent.click(screen.getByText("start"));
    });
    expect(screen.getByTestId("status").textContent).toBe("tracking");
    playSpy.mockClear();

    await act(async () => {
      emitFix(0); // 목적지에서 500m — 첫 fix가 앵커를 잡는다
      await vi.advanceTimersByTimeAsync(3000);
      emitFix(100); // 목적지까지 400m
    });
    expect(playSpy).toHaveBeenCalledWith("closer");
  });
});

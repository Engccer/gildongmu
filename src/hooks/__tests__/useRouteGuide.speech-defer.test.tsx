// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ko from "../../../messages/ko.json";
import { SPEECH_DEFER_GAP_S } from "@/lib/guide-speech-gate";

/**
 * 발화 지연 게이트 훅 배선(spec 2026-08-14 §6·§8). 판정 자체는
 * `guide-speech-gate.test.ts`가 잠그므로 여기서는 훅만 소유한 축을 본다:
 * 톤 종료 시각 기록 → live region 지연 반영, 단일 슬롯 latest-wins,
 * 짧은 톤 즉시, 낡은 예약 폐기(백그라운드 탭 throttling).
 */
const TONE_LENGTHS: Record<string, number> = {
  closer: 0.235,
  farther: 0.235,
  nearby: 2.246,
  tick: 0.522,
  start: 1.332,
  stop: 1.332,
  ahead: 0.731,
  warning: 0.836,
  unreliable: 0.47,
};

const { playSpy, preloadSpy } = vi.hoisted(() => ({
  playSpy: vi.fn(),
  preloadSpy: vi.fn(),
}));

vi.mock("../useBeaconSound", () => ({
  useBeaconSound: () => ({ play: playSpy, preload: preloadSpy }),
}));
vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({
    status: "ready" as const,
    coords: { lat: 37.5, lng: 127.1 },
  })),
}));

import { useRouteGuide } from "../useRouteGuide";

const M = 1 / 111320;
const DEST = { lat: 37.5 + 500 * M, lng: 127.1, name: "목적지" };

let watchCb: ((pos: GeolocationPosition) => void) | null = null;

function emitFix(meters: number, opts: { accuracy?: number } = {}) {
  watchCb?.({
    coords: {
      latitude: 37.5 + meters * M,
      longitude: 127.1,
      accuracy: opts.accuracy ?? 10,
      speed: null,
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
      <p data-testid="live">{g.liveText}</p>
    </div>
  );
}

function renderHarness() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <Harness />
    </NextIntlClientProvider>,
  );
}

const live = () => screen.getByTestId("live").textContent;

/** 시작 조회 실패(fetch가 빈 JSON) → detailUnavailable 통지가 start 톤에 걸린다. */
async function startSession() {
  await act(async () => {
    fireEvent.click(screen.getByText("start"));
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"],
  });
  playSpy.mockReset();
  playSpy.mockImplementation((sound: string) => TONE_LENGTHS[sound] ?? 0);
  preloadSpy.mockClear();
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
  // 상세 경로 조회는 실패 경로로 태운다(간략 폴백 → detailUnavailable 통지).
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const DETAIL_UNAVAILABLE = ko.guide.detailUnavailable;
const START_DEFER_MS = (1.332 + SPEECH_DEFER_GAP_S) * 1000; // start 톤 뒤 발화 지연

describe("발화 지연 게이트 훅 배선", () => {
  it("긴 톤(start) 재생 직후의 통지는 톤이 끝난 뒤에만 live region에 들어간다", async () => {
    renderHarness();
    await startSession();
    expect(playSpy).toHaveBeenCalledWith("start");
    // 조회 실패 통지는 즉시가 아니라 예약 상태다.
    expect(live()).toBe("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(START_DEFER_MS - 100);
    });
    expect(live()).toBe("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(live()).toBe(DETAIL_UNAVAILABLE);
  });

  it("세션 시작 시 긴 톤 3종을 프리로드한다(BLOCKER 4)", async () => {
    renderHarness();
    await startSession();
    expect(preloadSpy).toHaveBeenCalledWith(["ahead", "warning", "nearby"]);
  });

  it("지연 중 새 통지가 오면 옛 문장은 끝내 게시되지 않는다(latest-wins)", async () => {
    renderHarness();
    await startSession();
    expect(live()).toBe("");
    // 지연 창 안에서 첫 fix 통지가 도착 — 옛 detailUnavailable 예약을 대체한다.
    await act(async () => {
      emitFix(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(START_DEFER_MS + 500);
    });
    expect(live()).not.toBe(DETAIL_UNAVAILABLE);
    expect(live()).toContain("목적지까지");
  });

  it("짧은 톤(closer 0.235)과 겹치는 통지는 즉시 나간다", async () => {
    renderHarness();
    await startSession();
    // start 톤·지연 창을 전부 지나 보낸다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      emitFix(0); // 앵커
      await vi.advanceTimersByTimeAsync(3000);
    });
    playSpy.mockClear();
    await act(async () => {
      emitFix(300); // 데드밴드·마일스톤 초과 접근 → closer 톤 + 거리 통지 (같은 fix)
    });
    expect(playSpy).toHaveBeenCalledWith("closer");
    // 타이머를 전혀 진행하지 않았는데도 이미 게시됐다(0.235 < 0.6 임계).
    expect(live()).toContain("200m");
  });

  it("타이머가 예정보다 1초 이상 늦게 깨면 낡은 예약을 폐기한다(MAJOR 6)", async () => {
    renderHarness();
    await startSession();
    expect(live()).toBe("");
    // 백그라운드 탭 throttling 흉내: 발화 시점의 시계만 예정+2초로 보이게 만든다.
    const base = performance.now.bind(performance);
    vi.spyOn(performance, "now").mockImplementation(() => base() + 2000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(START_DEFER_MS + 100);
    });
    expect(live()).toBe("");
  });
});

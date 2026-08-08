// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ko from "../../../messages/ko.json";

vi.mock("../useBeaconSound", () => ({ useBeaconSound: () => ({ play: vi.fn() }) }));
vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({
    status: "ready" as const,
    coords: { lat: 37.5, lng: 127.1 },
  })),
}));

import { useRouteGuide } from "../useRouteGuide";

/**
 * 최종 접근 배선(spec 2026-08-08 §3.3·§3.4). 기하 계산과 진입 조건은 각각
 * `final-approach.test.ts`·`route-guide.test.ts`가 잠그므로 여기서는 **훅만 소유한
 * 축**을 본다: 진입 서술이 나가는가, 주기 거리가 무엇을 기준으로 하는가, 도착이
 * 세션을 끝내는가.
 *
 * ⚠ **진입 서술의 방향은 웹에서도 나온다.** 웹이 말하지 못하는 것은 fix의 `course`에서
 * 오는 *실시간* 방향이고(§3.5 — `GeolocationCoordinates`에 정확도 필드가 없다),
 * 진입 서술의 방향은 서버가 폴리라인에서 계산해 보낸 정적 값이라 플랫폼과 무관하다.
 */
const M = 1 / 111320;
const LNG_M = 1 / (111320 * Math.cos((37.5 * Math.PI) / 180));
const along = (m: number) => 37.5 + m * M;
const lateral = (m: number) => 127.1 + m * LNG_M;

/** 남→북 200m 직선. 종점은 (200, 0)이고 목적지는 그 동쪽 30m다(오프셋 30m). */
const WALK_STEPS = [
  {
    description: "성내로를 따라 200m 이동",
    pathCoords: [
      { lat: along(0), lng: lateral(0) },
      { lat: along(200), lng: lateral(0) },
    ],
  },
];
const DEST = { lat: along(200), lng: lateral(30), name: "강동구청" };

/** 서버가 실어 주는 종점 오프셋 기하. 오른쪽 30m, 기준 도로명 있음. */
const FINAL_APPROACH = { offsetMeters: 30, relativeBearing: 90, roadName: "성내로" };

let watchCb: ((pos: GeolocationPosition) => void) | null = null;

function emitFix(a: number, l: number, accuracy = 10) {
  act(() => {
    watchCb?.({
      coords: {
        latitude: along(a),
        longitude: lateral(l),
        accuracy,
        speed: 1.5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
      },
      timestamp: Date.now(),
    } as GeolocationPosition);
  });
}

/** fix 사이를 9초 진행시킨다 — 재획득 공백(10초)보다 짧고 속도 가드(3m/s)보다 느리게. */
function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function Harness() {
  const g = useRouteGuide(DEST, "walk", false);
  return (
    <div>
      <button onClick={g.start}>start</button>
      <p data-testid="status">{g.status}</p>
      <p data-testid="live">{g.liveText}</p>
    </div>
  );
}

const live = () => screen.getByTestId("live").textContent ?? "";
const status = () => screen.getByTestId("status").textContent ?? "";

/** 경로 종점 직전까지 걸어간다(진입선 max(10, accuracy) = 10 바로 밖에서 멈춘다). */
async function walkToEndpoint() {
  fireEvent.click(screen.getByText("start"));
  // ⚠ `waitFor`는 가짜 타이머와 서로를 막는다(대기 자체가 타이머 구동이다).
  //   경로 조회는 프로미스 사슬이므로 타이머를 비동기로 0만큼 진행시켜 플러시한다.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(live()).not.toBe("");
  for (const d of [0, 22, 44, 66, 88, 110, 132, 154, 176]) {
    emitFix(d, 0);
    tick(9000);
  }
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"],
  });
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          distanceMeters: 200,
          durationSeconds: 160,
          steps: WALK_STEPS,
          finalApproach: FINAL_APPROACH,
        },
      }),
    })),
  );
  render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <Harness />
    </NextIntlClientProvider>,
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("최종 접근 배선", () => {
  it("종점 도달 시 배치 서술을 낸다 — 도로명·목적지·방향·거리", async () => {
    await walkToEndpoint();
    emitFix(198, 0);

    expect(live()).toContain("성내로");
    expect(live()).toContain("강동구청");
    expect(live()).toContain("오른쪽");
    expect(live()).toContain("30");
  });

  it("주기 통지 거리는 오프셋이 아니라 현재 위치 기준이다", async () => {
    await walkToEndpoint();
    emitFix(198, 0); // 진입 서술
    tick(16000);
    emitFix(200, 10); // 목적지까지 20m — 오프셋 30m와 다른 값이어야 한다

    expect(live()).toContain("20");
    expect(live()).not.toContain("30");
    // 실시간 방향은 웹에서 나오지 않는다(courseAccuracy 부재 — 플랫폼 사실).
    expect(live()).not.toContain("오른쪽");
  });

  it("도착 반경 안에 들어오면 1회 통지하고 세션이 끝난다", async () => {
    await walkToEndpoint();
    emitFix(198, 0);
    tick(16000);
    emitFix(200, 20); // 목적지까지 10m

    expect(live()).toBe(ko.guide.arrived);
    expect(status()).not.toBe("tracking");
  });

  it("진입 서술은 1회뿐이다 — 다음 주기는 짧은 통지로 바뀐다", async () => {
    await walkToEndpoint();
    emitFix(198, 0);
    const intro = live();
    tick(16000);
    emitFix(199, 0);

    expect(live()).not.toBe(intro);
    expect(live()).not.toContain("성내로");
  });
});

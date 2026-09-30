// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { NextIntlClientProvider } from "next-intl";
import ko from "../../../messages/ko.json";

vi.mock("../useBeaconSound", () => ({
  useBeaconSound: () => ({ play: vi.fn(() => 0), preload: vi.fn() }),
}));
vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({
    status: "ready" as const,
    coords: { lat: 37.5, lng: 127.1 },
  })),
}));

import { useRouteGuide, type GuideKind } from "../useRouteGuide";

/**
 * car "현재 도로, {이름}" 행 배선(E56 spec 2026-09-30 §3·§4). 스팬 조립·`roadNameAt`의 값은
 * `car-route-guide.test.ts`가 잠그므로 여기서는 **훅만 소유한 축**을 본다: 행의 원천이 현재
 * 진행거리이고(스텝이 아니다), 이름을 모르면 행이 없고, 같은 이름이면 행이 불변이고, car에서도
 * 하단 2행이 돈다(K2 §7이 의도하고 E56이 배선).
 */
const M = 1 / 111320;
const along = (m: number) => ({ lat: 37.5 + m * M, lng: 127.1 });

/**
 * 남→북 1000m, 스텝 둘. 스텝 0 안에서 도로가 바뀐다(올림픽로 300m → 무명 50m → 천호대로 150m) —
 * 실측(spec §2.2 "통일로 338m → 퇴계로 931m")의 모양이다. 스텝 1은 우회전 뒤 천호대로.
 */
const CAR_BODY = {
  distanceMeters: 1000,
  durationSeconds: 120,
  taxiFare: 5000,
  tollFare: 0,
  provider: "tmap",
  guides: [
    {
      name: "",
      guidance: "올림픽로를 따라 300m 이동",
      distanceMeters: 0,
      durationSeconds: 0,
      pathCoords: [along(0), along(500)],
      roadLinks: [
        { name: "올림픽로", distanceMeters: 300 },
        { name: null, distanceMeters: 50 },
        { name: "천호대로", distanceMeters: 150 },
      ],
    },
    {
      name: "",
      guidance: "교차로에서 우회전 후 천호대로를 따라 500m 이동",
      distanceMeters: 0,
      durationSeconds: 0,
      action: "right",
      pathCoords: [along(500), along(1000)],
      roadLinks: [{ name: "천호대로", distanceMeters: 500 }],
    },
  ],
  terminalCoord: along(1000),
};

const DEST = { ...along(1000), name: "목적지" };

let watchCb: ((pos: GeolocationPosition) => void) | null = null;

const LNG_M = 1 / (111320 * Math.cos((37.5 * Math.PI) / 180));

function emitFix(m: number, eastM = 0) {
  act(() => {
    watchCb?.({
      coords: {
        latitude: along(m).lat,
        longitude: along(m).lng + eastM * LNG_M,
        accuracy: 10,
        speed: 11,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
      },
      timestamp: Date.now(),
    } as GeolocationPosition);
  });
}

function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** 커밋된 `currentText` 값의 이력 — 값이 바뀔 때만 쌓인다. */
let history: (string | null)[] = [];

function Harness({ kind }: { kind: GuideKind }) {
  const g = useRouteGuide(DEST, kind, { accessible: false, variant: null });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    history.push(g.currentText);
  }, [g.currentText]);
  return (
    <div>
      <button onClick={g.start}>start</button>
      <p data-testid="road">{g.currentText ?? "(없음)"}</p>
      <p data-testid="top">{g.liveRows.top ?? "(없음)"}</p>
      <p data-testid="next">{g.liveRows.next ?? "(없음)"}</p>
    </div>
  );
}

const road = () => screen.getByTestId("road").textContent;
const top = () => screen.getByTestId("top").textContent ?? "";

async function start(kind: GuideKind) {
  render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <Harness kind={kind} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByText("start"));
  // ⚠ `waitFor`는 가짜 타이머와 서로를 막는다 — 조회 프로미스 사슬은 타이머 비동기 진행으로 플러시한다.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
}

/** 스팬 [0,300) 올림픽로 · [300,350) 무명 · [350,1000) 천호대로를 100m 안팎 간격으로 지나간다. */
async function driveTo(targets: number[]) {
  for (const m of targets) {
    tick(9000);
    emitFix(m);
  }
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"],
  });
  watchCb = null;
  history = [];
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
    vi.fn(async () => ({ ok: true, json: async () => CAR_BODY })),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("car 현재 도로 행 (E56)", () => {
  it("커밋 직후 현재 위치의 도로 이름을 라벨 틀로 싣는다 — 구간 전문이 아니다", async () => {
    await start("car");
    expect(road()).toBe("현재 도로, 올림픽로");
    expect(road()).not.toContain("이동");
    // 커밋 지점에서 하단 2행도 곧바로 계산된다(fix 없이) — 커밋은 상태 재구성 지점이다.
    expect(top()).toMatch(/^\d+m 직진하세요$/);
  });

  it("이탈했다 뒤쪽으로 돌아오면 윗줄이 늘어난 거리를 말한다", async () => {
    await start("car");
    await driveTo([100, 200, 300]);
    const beforeOff = Number(top().match(/^(\d+)m/)?.[1]);
    // 경로 동쪽 200m로 벗어나 이탈 확정(유예 20초)까지 머문다.
    for (let i = 0; i < 4; i++) {
      tick(9000);
      emitFix(300, 200);
    }
    expect(top()).toBe(ko.guide.offRoute);
    // 이탈 전보다 **뒤**(150m)로 돌아온다 — 남은 거리가 늘었다. 감소만 허용하는 클램프는 이탈 국면이
    // 하단 2행 상태를 비워 풀린다(guideLiveRows offRoute → state null). 그래서 이 단언은 복귀 리셋
    // (backOnRoute 시 baseline·state 리셋)의 유무와 무관하게 성립한다 — 리셋 자체는 walk와 공유 코드다.
    tick(9000);
    emitFix(150);
    tick(9000);
    emitFix(160);
    const back = Number(top().match(/^(\d+)m/)?.[1]);
    expect(back).toBeGreaterThan(beforeOff);
  });

  it("무명 링크에서는 행이 없고, 한 안내 구간 안에서 도로가 바뀌면 따라 바뀐다", async () => {
    await start("car");
    await driveTo([100, 200, 310]);
    expect(road()).toBe("(없음)");
    await driveTo([400]);
    // 여전히 스텝 0(0~500m) 안이다 — 스텝 단위였다면 "올림픽로"로 남았을 자리.
    expect(road()).toBe("현재 도로, 천호대로");
  });

  it("같은 이름이 이어지면 스텝 경계를 넘어도 행이 불변이다(재낭독 없음)", async () => {
    await start("car");
    await driveTo([100, 200, 310, 400, 480, 580, 680]);
    expect(road()).toBe("현재 도로, 천호대로");
    expect(history).toEqual(["현재 도로, 올림픽로", null, "현재 도로, 천호대로"]);
  });

  it("car에서도 하단 2행이 돈다 — 윗줄은 현재 행동, 아랫줄은 다음 안내", async () => {
    await start("car");
    await driveTo([100]);
    // 멀리서는 윗줄이 직진 카운트다운이고 회전은 아랫줄 예고다(iOS 동형 — "1200m 직진하세요").
    expect(top()).toMatch(/^\d+m 직진하세요$/);
    const before = Number(top().match(/^(\d+)m/)?.[1]);
    await driveTo([200, 300]);
    // 매 fix 갱신이다 — 커밋 때 한 번 계산하고 멈추면 거리가 줄지 않는다.
    const after = Number(top().match(/^(\d+)m/)?.[1]);
    expect(after).toBeLessThan(before);
    expect(screen.getByTestId("next").textContent).toBe("다음 안내, 우회전하세요");
  });

  it("walk에는 현재 도로 행이 없다(스팬이 비어 있고, 커밋 지점 car 가드가 한 번 더 막는다)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          result: {
            distanceMeters: 1000,
            durationSeconds: 800,
            steps: CAR_BODY.guides.map((g) => ({ description: g.guidance, pathCoords: g.pathCoords })),
          },
        }),
      })),
    );
    await start("walk");
    await driveTo([20]);
    expect(road()).toBe("(없음)");
  });
});

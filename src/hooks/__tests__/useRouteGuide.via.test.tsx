// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import { useRouteGuide, type RouteGuideVia } from "../useRouteGuide";

/**
 * 웹 안내 훅의 경유지 수용(N4 spec 2026-09-24 §5.1). 판정(접근 예고·도착 래치·다음 목표)은
 * `route-guide.test.ts`의 공유 fixture가 잠그므로 여기서는 **훅만 소유한 축**을 본다: 경유지가
 * 조회에 실리는가, 도착 뒤 재조회에서 빠지는가, 응답이 경유지를 모르면 상세를 세우지 않는가,
 * 통지 문장과 남은 거리 행의 목표가 바뀌는가.
 */
const M = 1 / 111320;
const along = (m: number) => ({ lat: 37.5 + m * M, lng: 127.1 });

/** 남→북 200m 직선, 경유지 C는 100m 지점(스텝 1의 시작). */
const WALK_STEPS = [
  { description: "직진A 100m 이동", pathCoords: [along(0), along(100)] },
  { description: "직진B 100m 이동", pathCoords: [along(100), along(200)] },
];
const DEST = { ...along(200), name: "강동구청" };
const VIA: RouteGuideVia = { ...along(100), label: "길동시장" };

let withWaypoint = true;
/** 도보 조회를 붙잡아 두는 관문(재조회 왕복 창 모사). null이면 즉시 응답. */
let fetchGate: Promise<void> | null = null;
let fetchStatus = 200;
let fetchMock: ReturnType<typeof vi.fn>;
let watchCb: ((pos: GeolocationPosition) => void) | null = null;

function emitFix(a: number) {
  act(() => {
    watchCb?.({
      coords: {
        latitude: along(a).lat,
        longitude: along(a).lng,
        accuracy: 10,
        speed: 1.3,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
      },
      timestamp: Date.now(),
    } as GeolocationPosition);
  });
}

/** fix 사이 9초 — 재획득 공백(10초)보다 짧고 투영 점프 상한보다 느리게. */
function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function Harness({ via }: { via?: RouteGuideVia | null }) {
  const g = useRouteGuide(DEST, "walk", { accessible: false, variant: null }, { via });
  return (
    <div>
      <button onClick={g.start}>start</button>
      <button onClick={g.requestReroute}>reroute</button>
      <button onClick={g.announceProgress}>progress</button>
      <p data-testid="mode">{g.mode}</p>
      <p data-testid="live">{g.liveText}</p>
      <p data-testid="target">{g.progress ? JSON.stringify(g.progress.target) : ""}</p>
    </div>
  );
}

const live = () => screen.getByTestId("live").textContent ?? "";
const mode = () => screen.getByTestId("mode").textContent ?? "";
const target = () => screen.getByTestId("target").textContent ?? "";

/** 도보 조회 URL의 via 파라미터(없으면 null)를 순서대로. */
function walkVias(): (string | null)[] {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.startsWith("/api/route/walk"))
    .map((u) => new URLSearchParams(u.split("?")[1]).get("via"));
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
}

async function startGuide(via: RouteGuideVia | null | undefined) {
  render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <Harness via={via} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByText("start"));
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"],
  });
  withWaypoint = true;
  fetchGate = null;
  fetchStatus = 200;
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
  fetchMock = vi.fn(async (url: string) => {
    const hasVia = new URLSearchParams(String(url).split("?")[1]).get("via") !== null;
    if (fetchGate) await fetchGate;
    return {
      ok: fetchStatus === 200,
      status: fetchStatus,
      json: async () => ({
        result: {
          distanceMeters: 200,
          durationSeconds: 160,
          steps: WALK_STEPS,
          ...(hasVia && withWaypoint ? { waypoint: { stepIndex: 1, coord: along(100) } } : {}),
        },
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("웹 안내 훅의 경유지(N4 2026-09-24)", () => {
  it("경유지를 지정하지 않으면 조회에 via가 없고 남은 거리 행은 종전 목표다", async () => {
    await startGuide(undefined);
    expect(walkVias()).toEqual([null]);
    expect(mode()).toBe("detail");
    expect(target()).toBe(JSON.stringify({ kind: "route" }));
  });

  it("경유지가 조회에 실리고, 행은 경유지 → 목적지로 바뀌며, 예고·도착 문장이 나간다", async () => {
    await startGuide(VIA);
    expect(walkVias()).toEqual([`${VIA.lat},${VIA.lng}`]);
    expect(mode()).toBe("detail");
    expect(target()).toBe(JSON.stringify({ kind: "waypoint", label: "길동시장" }));

    for (const d of [0, 12, 24, 36, 48]) {
      emitFix(d);
      tick(9000);
    }
    expect(live()).not.toContain("길동시장까지");
    emitFix(56);
    expect(live()).toBe("경유지 길동시장까지 44m");
    // 진행 상황 조망은 총 잔여(144m)와 그 시간이다 — 행의 경유지 목표 시간(1분)이 섞이지 않는다.
    fireEvent.click(screen.getByText("progress"));
    expect(live()).toContain("남은 거리 144m, 약 2분");

    for (const d of [64, 76, 88]) {
      tick(9000);
      emitFix(d);
    }
    tick(9000);
    emitFix(104);
    // ko 목적지에 방향 조사가 붙는다("강동구청" 받침 ㅇ → 으로).
    expect(live()).toBe("경유지 길동시장 도착. 이제 목적지 강동구청으로 안내합니다");
    expect(target()).toBe(JSON.stringify({ kind: "destination", label: "강동구청" }));

    // 도착 뒤 재조회는 출발→도착이다(경유지를 다시 지나가게 하지 않는다). 행은 여전히 목적지 목표다
    // — 같은 행이 이유 없이 "남은 거리"로 되돌아가지 않는다(설계 리뷰 #7).
    fireEvent.click(screen.getByText("reroute"));
    await flush();
    expect(walkVias()).toEqual([`${VIA.lat},${VIA.lng}`, null]);
    expect(target()).toBe(JSON.stringify({ kind: "destination", label: "강동구청" }));
  });

  it("재조회 왕복 중 경유지를 지나면 착지한 응답(지난 경유지 포함)을 폐기한다(설계 리뷰 #2)", async () => {
    await startGuide(VIA);
    for (const d of [0, 12, 24, 36, 48, 56, 64, 76, 88]) {
      emitFix(d);
      tick(9000);
    }
    let open!: () => void;
    fetchGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    fireEvent.click(screen.getByText("reroute"));
    await flush();
    emitFix(104);
    expect(live()).toBe("경유지 길동시장 도착. 이제 목적지 강동구청으로 안내합니다");
    open();
    await flush();
    // 요청은 경유지를 실었지만(도착 전에 떠났다) 그 응답은 커밋되지 않는다.
    expect(walkVias()).toEqual([`${VIA.lat},${VIA.lng}`, `${VIA.lat},${VIA.lng}`]);
    expect(target()).toBe(JSON.stringify({ kind: "destination", label: "강동구청" }));
    // 폐기하지 않으면 새 세대가 경유지를 되살려 행이 "경유지 … 까지"로 돌아가고 도착이 두 번 난다.
    tick(9000);
    emitFix(116);
    expect(target()).toBe(JSON.stringify({ kind: "destination", label: "강동구청" }));
  });

  it("경유지 경로를 못 받아 간략 안내로 내려가면 경유지를 빼고 안내한다고 말한다(설계 리뷰 #6)", async () => {
    fetchStatus = 502;
    await startGuide(VIA);
    expect(mode()).toBe("brief");
    expect(live()).toContain("경유지 길동시장를 포함한 경로를 찾지 못해 경유지 없이 안내합니다");
  });

  it("경유지를 보냈는데 응답이 경유지 위치를 모르면 상세를 세우지 않는다", async () => {
    withWaypoint = false;
    await startGuide(VIA);
    expect(walkVias()).toEqual([`${VIA.lat},${VIA.lng}`]);
    expect(mode()).toBe("brief");
    expect(target()).toBe("");
  });
});

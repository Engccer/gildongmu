// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ko from "../../../messages/ko.json";

vi.mock("../useBeaconSound", () => ({
  useBeaconSound: () => ({ play: vi.fn(() => 0), preload: vi.fn() }),
}));
vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({ status: "ready" as const, coords: { lat: 37.5, lng: 127.1 } })),
}));

import { useRouteGuide } from "../useRouteGuide";

/**
 * A70(spec 2026-10-19 §2·§4)의 웹 오케스트레이터 배선. 판정은 리듀서·게이트 판정표가 잠그므로 훅이 소유한 축만 본다:
 * 자동 재조회의 첫 점 거부, 사용자가 연 조회의 출발점 고지, 이탈 중 도착 창(`nearDestination`) 소비. 좌표는 합성.
 */
const M = 1 / 111320;
const LNG_M = 1 / (111320 * Math.cos((37.5 * Math.PI) / 180));
const at = (a: number, l: number) => ({ lat: 37.5 + a * M, lng: 127.1 + l * LNG_M });

/** 시작 경로 첫 점 [along, lateral]. 기본은 시작 fix(0, 0) 자리. */
let startAt: [number, number] = [0, 0];
/** 자동 재조회 응답 첫 점의 사용자 기준 동쪽 오프셋(m). */
let rerouteStartEast = 0;
let rerouteFails = false;
let dest = { ...at(600, 0), name: "목적지" };
let watchCb: ((pos: GeolocationPosition) => void) | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
let pos = { a: 40, l: 0 };

const walkCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/route/walk")).length;

function fixAt(a: number, l: number, speed = 1.2) {
  pos = { a, l };
  act(() => {
    const c = at(a, l);
    watchCb?.({
      coords: { latitude: c.lat, longitude: c.lng, accuracy: 8, speed, altitude: null, altitudeAccuracy: null, heading: null },
      timestamp: Date.now(),
    } as GeolocationPosition);
  });
  act(() => {
    vi.advanceTimersByTime(1000);
  });
}
function walk(bearing: number, n: number) {
  const r = (bearing * Math.PI) / 180;
  for (let i = 0; i < n; i++) fixAt(pos.a + Math.cos(r) * 1.2, pos.l + Math.sin(r) * 1.2);
}

function Harness() {
  const g = useRouteGuide(dest, "walk", { accessible: false, variant: null });
  return (
    <div>
      <button onClick={g.start}>start</button>
      <button onClick={g.requestReroute}>reroute</button>
      <p data-testid="live">{g.liveText}</p>
      <p data-testid="off">{String(g.offRoute)}</p>
      <p data-testid="btn">{String(g.showReroute)}</p>
    </div>
  );
}
const live = () => screen.getByTestId("live").textContent ?? "";
const btn = () => screen.getByTestId("btn").textContent;
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });

async function start() {
  render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <Harness />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByText("start"));
  await flush();
}
async function startOnRoute() {
  await start();
  pos = { a: 40, l: 0 };
  fixAt(40, 0);
  walk(0, 20);
}
/** 30° 비스듬히 오른쪽으로 나가 수직 35m에서 북쪽으로 나란히 — 거리 축 확정까지. */
function strayRightAndConfirm() {
  walk(30, 58);
  walk(0, 26);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"] });
  watchCb = null;
  startAt = [0, 0];
  rerouteStartEast = 0;
  rerouteFails = false;
  dest = { ...at(600, 0), name: "목적지" };
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: vi.fn((ok: (p: GeolocationPosition) => void) => {
        watchCb = ok;
        return 1;
      }),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
  });
  fetchMock = vi.fn(async () => {
    const first = walkCalls() <= 1;
    if (!first && rerouteFails) return { ok: false, status: 502, json: async () => ({}) };
    const steps = first
      ? [{ description: "천호대로를 따라 600m 이동", pathCoords: [at(...startAt), at(startAt[0] + 600, startAt[1])] }]
      : [
          {
            description: "김종하 정신과의원까지 35m 이동",
            pathCoords: [at(pos.a, pos.l + rerouteStartEast), at(pos.a + 35, pos.l + rerouteStartEast)],
          },
        ];
    return { ok: true, json: async () => ({ result: { distanceMeters: 600, durationSeconds: 400, steps } }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("A70 ② 새 경로 첫 점 검사", () => {
  it("자동 재조회의 새 경로가 현재 위치에서 30m 넘게 떨어진 곳에서 시작하면 채택하지 않고 버튼 + 한 번 통지(none과 같은 결말)", async () => {
    await startOnRoute();
    strayRightAndConfirm();
    rerouteStartEast = 80;
    const before = walkCalls();
    walk(0, 50);
    await flush();
    expect(walkCalls()).toBe(before + 1);
    expect(live()).toBe("새 경로를 자동으로 찾지 못했습니다.");
    expect(btn()).toBe("true");
    expect(screen.getByTestId("off").textContent).toBe("true");
  });

  it("30m 안에서 시작하면 종전대로 채택한다(대조)", async () => {
    await startOnRoute();
    strayRightAndConfirm();
    rerouteStartEast = 20;
    walk(0, 50);
    await flush();
    expect(live()).toContain("새 경로로 다시 안내합니다");
  });

  it("시작 경로가 240m 북동쪽에서 시작하면 첫 문장이 그 거리와 방향을 말한다", async () => {
    startAt = [170, 170];
    await start();
    expect(live()).toMatch(/^경로 시작점이 북동쪽으로 240m 떨어져 있습니다\. 목적지까지 도보 안내 시작\. /);
  });

  it("시작 경로가 30m 안에서 시작하면 고지가 없다(종전 문장 그대로)", async () => {
    startAt = [0, 25];
    await start();
    expect(live()).toMatch(/^목적지까지 도보 안내 시작\. /);
  });

  it("버튼으로 연 재조회는 첫 점이 멀어도 받고, 그 거리와 방향을 먼저 말한다", async () => {
    await startOnRoute();
    rerouteFails = true;
    strayRightAndConfirm();
    walk(0, 50);
    await flush();
    expect(btn()).toBe("true");
    rerouteFails = false;
    rerouteStartEast = 60;
    fireEvent.click(screen.getByText("reroute"));
    await flush();
    expect(live()).toMatch(/^경로 시작점이 동쪽으로 60m 떨어져 있습니다\. 현재 위치에서 경로를 다시 찾았습니다\. /);
    expect(screen.getByTestId("off").textContent).toBe("false");
  });
});

describe("A70 ③ 이탈 중 도착 창(nearDestination)", () => {
  it("벗어난 채 목적지 곁 20m 안에 5초 머물면 「목적지 근처입니다.」, 이어서 15m 안이면 도착한다", async () => {
    // 목적지는 경로(경도선) 동쪽 40m — 경로 종점과 무관한 자리.
    dest = { ...at(400, 40), name: "목적지" };
    await startOnRoute();
    rerouteFails = true; // 걷는 동안의 자동 재조회는 실패로 둔다(경로가 바뀌지 않게)
    strayRightAndConfirm();
    expect(screen.getByTestId("off").textContent).toBe("true");
    while (pos.a < 384) walk(0, 1);
    await flush();
    // 목적지 직선 약 16m에서 선다(정지 fix 6개 = 6초 > 5초).
    const said: string[] = [];
    for (let i = 0; i < 6; i++) {
      fixAt(pos.a, pos.l, 0);
      said.push(live());
    }
    expect(said).toContain("목적지 근처입니다.");
    expect(said.some((x) => x.includes("벗어났습니다"))).toBe(false);
    expect(screen.getByTestId("off").textContent).toBe("false");
    expect(btn()).toBe("false");
    fixAt(pos.a + 8, pos.l + 3);
    expect(live()).toBe("목적지에 도착했습니다");
  });
});

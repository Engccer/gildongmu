// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ko from "../../../messages/ko.json";
import scenarios from "../../lib/__tests__/fixtures/route-guide-scenarios.json";

vi.mock("../useBeaconSound", () => ({
  useBeaconSound: () => ({ play: vi.fn(() => 0), preload: vi.fn() }),
}));
vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({ status: "ready" as const, coords: { lat: 37.5, lng: 127.1 } })),
}));

import { useRouteGuide } from "../useRouteGuide";

/**
 * 웹 오케스트레이터의 돌아가기 국면 배선(E63 spec §3.4·§3.5·§3.7). 판정은 리듀서 fixture가 잠그므로 여기서는 훅만 소유한 축을
 * 본다: 이탈 문장 조립, 자동 조회 트리거가 확정이 아니라 `rerouteNeeded`인가, 채택 문장의 방향 머리말, 진행 중 조회의 중복 요청.
 */
const M = 1 / 111320;
const LNG_M = 1 / (111320 * Math.cos((37.5 * Math.PI) / 180));
const at = (a: number, l: number) => ({ lat: 37.5 + a * M, lng: 127.1 + l * LNG_M });

/** 남→북 600m 직선. */
const START_STEPS = [{ description: "천호대로를 따라 600m 이동", pathCoords: [at(0, 0), at(600, 0)] }];
/** 자동 재조회 응답: 지금 자리(수직 35m)에서 서쪽으로 35m 간 뒤 북쪽 — 북행 중이면 9시 방향. */
const REROUTE_STEPS = (a: number) => [
  { description: "김종하 정신과의원까지 35m 이동", pathCoords: [at(a, 35), at(a, 0)] },
  { description: "천호대로를 따라 300m 이동", pathCoords: [at(a, 0), at(a + 300, 0)] },
];

const DEST = { ...at(600, 0), name: "목적지" };
let watchCb: ((pos: GeolocationPosition) => void) | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
let pos = { a: 40, l: 0 };
/** 자동 재조회 응답을 붙잡는 관문. null이면 즉시. */
let rerouteGate: Promise<void> | null = null;
/** 참이면 재조회 응답이 502(E69 ⓐ). */
let rerouteFails = false;

function walkCalls(): number {
  return fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/route/walk")).length;
}

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

/** 방위 bearing(북 0·동 90)으로 1.2m/s, n초. */
function walk(bearing: number, n: number) {
  const r = (bearing * Math.PI) / 180;
  for (let i = 0; i < n; i++) fixAt(pos.a + Math.cos(r) * 1.2, pos.l + Math.sin(r) * 1.2);
}

function Harness() {
  const g = useRouteGuide(DEST, "walk", { accessible: false, variant: null });
  return (
    <div>
      <button onClick={g.start}>start</button>
      <p data-testid="live">{g.liveText}</p>
      <p data-testid="off">{String(g.offRoute)}</p>
      <p data-testid="btn">{String(g.showReroute)}</p>
    </div>
  );
}
const live = () => screen.getByTestId("live").textContent ?? "";
const btn = () => screen.getByTestId("btn").textContent;

async function startOnRoute() {
  render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <Harness />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByText("start"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
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
  rerouteGate = null;
  rerouteFails = false;
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
  fetchMock = vi.fn(async (url: string) => {
    const first = walkCalls() <= 1;
    if (!first && rerouteGate) await rerouteGate;
    void url;
    if (!first && rerouteFails) return { ok: false, status: 502, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({
        result: {
          distanceMeters: first ? 600 : 335,
          durationSeconds: 400,
          steps: first ? START_STEPS : REROUTE_STEPS(pos.a),
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

describe("돌아가기 국면(E63)", () => {
  it("이탈을 확정하면 벗어난 쪽과 돌아갈 시계 방향을 말하고, 그 자리에서 재조회하지 않는다", async () => {
    await startOnRoute();
    const before = walkCalls();
    strayRightAndConfirm();
    expect(live()).toBe("경로에서 오른쪽으로 벗어났습니다. 10시 방향으로 돌아가세요");
    expect(walkCalls()).toBe(before);
  });

  it("나란히 계속 걸으면 자동으로 새 경로를 받고, 첫 문장에 걷던 방향 기준 머리말을 단다", async () => {
    await startOnRoute();
    strayRightAndConfirm();
    const before = walkCalls();
    walk(0, 50);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(walkCalls()).toBe(before + 1);
    expect(live()).toBe(
      "새 경로로 다시 안내합니다. 9시 방향으로 도세요. 그 후 김종하 정신과의원까지 35m 이동. 안내 2개, 총 335m.",
    );
  });

  it("이탈 문장을 들은 회차는 경로로 돌아와 서면 \"경로로 복귀했습니다\"를 말한다", async () => {
    await startOnRoute();
    strayRightAndConfirm();
    walk(270, 30);
    for (let i = 0; i < 12; i++) fixAt(pos.a, 0);
    expect(live()).toBe("경로로 복귀했습니다");
  });

  it("보류(이미 경로 쪽으로 걷는 중) 회차는 벗어났다는 말도, 돌아온 뒤 복귀 문장도 없다", async () => {
    await startOnRoute();
    // 공유 fixture ⑪-가의 궤적(시작 21 fix는 startOnRoute와 같다): 옆으로 튄 뒤 경로 쪽으로 걸어 돌아와 선다.
    const hold = (scenarios as { scenarios: { name: string; fixes: { along: number; lateral: number }[] }[] }).scenarios.find(
      (x) => x.name.startsWith("E63 ⑪-가"),
    )!;
    const said: string[] = [];
    const off: string[] = [];
    for (const f of hold.fixes.slice(21)) {
      fixAt(f.along, f.lateral);
      said.push(live());
      off.push(screen.getByTestId("off").textContent ?? "");
    }
    // 확정과 복귀가 실제로 일어났다(궤적이 fixture와 어긋나 아무 일도 없어 통과하는 공허 통과를 막는다).
    expect(off).toContain("true");
    expect(off.at(-1)).toBe("false");
    expect(said.some((x) => x.includes("벗어났습니다"))).toBe(false);
    expect(said.some((x) => x.includes("복귀했습니다"))).toBe(false);
  });

  it("자동 조회가 진행 중이면 리듀서가 또 요청해도 조회를 더 열지 않는다", async () => {
    await startOnRoute();
    strayRightAndConfirm();
    let open!: () => void;
    rerouteGate = new Promise<void>((r) => {
      open = r;
    });
    const before = walkCalls();
    // 첫 요청(50m) 뒤 재무장한 리듀서가 50m를 더 가 다시 요청한다.
    walk(0, 50);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(walkCalls()).toBe(before + 1);
    walk(0, 60);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(walkCalls()).toBe(before + 1);
    open();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
  });
});

describe("경로 다시 조회 버튼은 자동 판정이 손을 든 자리에서만(E69)", () => {
  it("벗어나 돌아가는 동안·자동 채택으로 끝나면 버튼이 한 번도 없다", async () => {
    await startOnRoute();
    const seen: string[] = [];
    walk(30, 58);
    for (let i = 0; i < 26; i++) {
      walk(0, 1);
      seen.push(btn() ?? "");
    }
    expect(screen.getByTestId("off").textContent).toBe("true");
    walk(0, 50);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    seen.push(btn() ?? "");
    expect(live()).toContain("새 경로로 다시 안내합니다");
    expect(seen.every((x) => x === "false")).toBe(true);
  });

  it("자동 조회가 실패하면 버튼이 서고 한 번 말한다 — 재무장 뒤 또 실패해도 버튼은 그대로다", async () => {
    await startOnRoute();
    rerouteFails = true;
    strayRightAndConfirm();
    expect(btn()).toBe("false");
    walk(0, 50);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(btn()).toBe("true");
    expect(live()).toBe("새 경로를 자동으로 찾지 못했습니다.");
    // 재무장한 리듀서가 다시 요청해 또 실패한다.
    const calls = walkCalls();
    walk(0, 55);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(walkCalls()).toBeGreaterThan(calls);
    expect(btn()).toBe("true");
  });

  it("벗어난 채 30초 서 있으면 버튼이 조용히 서고, 다시 걸어도 그 회차엔 남는다", async () => {
    await startOnRoute();
    strayRightAndConfirm();
    const before = live();
    // 정지 판정(도플러 0이 몇 초 이어져야 `stopped`)이 선 뒤부터 30초를 센다.
    for (let i = 0; i < 25; i++) fixAt(pos.a, pos.l, 0);
    expect(btn()).toBe("false");
    for (let i = 0; i < 15; i++) fixAt(pos.a, pos.l, 0);
    expect(btn()).toBe("true");
    expect(live()).toBe(before);
    walk(0, 3);
    expect(btn()).toBe("true");
  });

  it("복귀하면 버튼이 사라지고, 다음 이탈 회차는 다시 버튼 없이 시작한다", async () => {
    await startOnRoute();
    strayRightAndConfirm();
    for (let i = 0; i < 40; i++) fixAt(pos.a, pos.l, 0);
    expect(btn()).toBe("true");
    walk(270, 30);
    for (let i = 0; i < 12; i++) fixAt(pos.a, 0);
    expect(screen.getByTestId("off").textContent).toBe("false");
    expect(btn()).toBe("false");
    walk(0, 10);
    strayRightAndConfirm();
    expect(screen.getByTestId("off").textContent).toBe("true");
    expect(btn()).toBe("false");
  });
});

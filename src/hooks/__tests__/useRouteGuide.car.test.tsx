// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useEffect } from "react";
import ko from "../../../messages/ko.json";

vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({
    status: "ready" as const,
    coords: { lat: 37.5, lng: 127.1 },
  })),
}));

import { useRouteGuide, type GuideKind } from "../useRouteGuide";

/**
 * car kind 오케스트레이션 계약(B1 §4.1·§4.6·§3.3): 봉인 구성의 fetch 선택,
 * provider 게이트, 세션 단일성. 리듀서 판정은 route-guide.test.ts가,
 * 조립은 car-route-guide.test.ts가 잠그므로 여기서는 배선만 본다.
 */
const M = 1 / 111320;
const pt = (m: number) => ({ lat: 37.5 + m * M, lng: 127.1 });

const CAR_BODY = {
  distanceMeters: 500,
  durationSeconds: 300,
  taxiFare: 5000,
  tollFare: 0,
  provider: "tmap",
  guides: [
    {
      name: "",
      guidance: "직진 500m 이동",
      distanceMeters: 0,
      durationSeconds: 0,
      pathCoords: [pt(0), pt(500)],
      roadLinks: [{ name: "올림픽로", distanceMeters: 500 }],
    },
  ],
};

const DEST = { lat: 37.5 + 500 * M, lng: 127.1, name: "목적지" };

let fetchMock: ReturnType<typeof vi.fn>;
/** live region에 실제로 쓰인 문장 기록(같은 문장 재게시도 한 줄씩 — 통지 횟수를 센다). */
let liveLog: string[] = [];

function Harness({ kind, tag }: { kind: GuideKind; tag: string }) {
  const g = useRouteGuide(DEST, kind, { accessible: false, variant: null });
  useEffect(() => {
    if (g.liveText) liveLog.push(g.liveText);
  }, [g.liveText]);
  return (
    <div>
      <button onClick={g.start}>start-{tag}</button>
      <p data-testid={`status-${tag}`}>{g.status}</p>
      <p data-testid={`live-${tag}`}>{g.liveText}</p>
    </div>
  );
}

function renderHarness(children: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      {children}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  liveLog = [];
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
  });
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => CAR_BODY }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useRouteGuide car kind", () => {
  it("car 시작은 자동차 라우트를 기하 옵트인으로 조회하고 carStart로 통지한다", async () => {
    renderHarness(<Harness kind="car" tag="a" />);
    fireEvent.click(screen.getByText("start-a"));

    await waitFor(() =>
      expect(screen.getByTestId("live-a").textContent).toContain("자동차 안내 시작"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/route/car?"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("includeGeometry=1"),
    );
  });

  it("provider가 tmap이 아니면 상세 불가 — 간략 폴백을 정직 통지한다(§4.5)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ...CAR_BODY, provider: "kakao" }),
    });
    renderHarness(<Harness kind="car" tag="a" />);
    fireEvent.click(screen.getByText("start-a"));

    await waitFor(() =>
      expect(screen.getByTestId("live-a").textContent).toBe(
        ko.guide.degradedUnavailable,
      ),
    );
  });

  it("세션 단일성(§3.3): 두 번째 세션 시작이 첫 세션을 중지시킨다", async () => {
    renderHarness(
      <>
        <Harness kind="car" tag="a" />
        <Harness kind="walk" tag="b" />
      </>,
    );
    fireEvent.click(screen.getByText("start-a"));
    await waitFor(() =>
      expect(screen.getByTestId("status-a").textContent).toBe("tracking"),
    );

    await act(async () => {
      fireEvent.click(screen.getByText("start-b"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("status-b").textContent).toBe("tracking"),
    );
    expect(screen.getByTestId("status-a").textContent).toBe("idle");
  });
});

describe("E80 재조회 6분 · 새 정체 한 문장(§5)", () => {
  const JAM = { road: "올림픽로", startMeters: 200, lengthMeters: 200, start: pt(200), end: pt(400) };
  function bodies(startJams: unknown[], refreshJams: unknown[]) {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("includeGeometry=1")
          ? { ...CAR_BODY, congestion: { jams: startJams } }
          : { ...CAR_BODY, durationSeconds: 280, congestion: { jams: refreshJams } },
    }));
  }
  async function startAndTick() {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    renderHarness(<Harness kind="car" tag="a" />);
    fireEvent.click(screen.getByText("start-a"));
    await waitFor(() => expect(screen.getByTestId("live-a").textContent).toContain("자동차 안내 시작"));
    // 5분 59초엔 재조회가 없다 — 주기는 6분이다.
    await act(async () => vi.advanceTimersByTime(359_000));
    expect(fetchMock.mock.calls.filter(([u]) => !String(u).includes("includeGeometry=1"))).toHaveLength(0);
    await act(async () => vi.advanceTimersByTime(1_000));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([u]) => !String(u).includes("includeGeometry=1"))).toHaveLength(1),
    );
  }
  afterEach(() => vi.useRealTimers());

  it("시작 조회·재조회 둘 다 traffic=1, 앞쪽 새 정체는 한 문장으로 알린다", async () => {
    bodies([], [JAM]);
    await startAndTick();
    expect(fetchMock.mock.calls.every(([u]) => String(u).includes("traffic=1"))).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("live-a").textContent).toBe("200m 앞 올림픽로에 200m 정체가 새로 생겼습니다."),
    );
  });

  it("시작 조회 때 이미 있던 정체는 재조회에 다시 와도 말하지 않는다", async () => {
    bodies([JAM], [JAM]);
    await startAndTick();
    // ETA 커밋까지 기다린 뒤에도 통지가 시작 문장 그대로다.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId("live-a").textContent).not.toContain("정체");
  });

  const refreshes = () => fetchMock.mock.calls.filter(([u]) => !String(u).includes("includeGeometry=1")).length;
  const jamLines = () => liveLog.filter((x) => x.includes("정체가 새로 생겼습니다"));
  async function tick(n: number) {
    const before = refreshes();
    await act(async () => vi.advanceTimersByTime(360_000));
    await waitFor(() => expect(refreshes()).toBe(before + n));
    // 같은 문장 재게시는 빈 값을 거쳐 REANNOUNCE_DELAY_MS(120ms) 뒤에 쓰인다 — 그보다 넉넉히 기다려야 반복을 센다.
    await new Promise((r) => setTimeout(r, 300));
  }

  it("같은 새 정체가 재조회마다 와도 한 번만 말한다(알린 정체는 아는 정체가 된다)", async () => {
    bodies([], [JAM]);
    await startAndTick();
    await waitFor(() => expect(jamLines()).toHaveLength(1));
    await tick(1);
    await tick(1);
    expect(jamLines()).toHaveLength(1);
  });

  it("재조회는 시작 조회를 포함해 여정 10회가 상한이다", async () => {
    bodies([], []);
    await startAndTick();
    for (let i = 0; i < 8; i++) await tick(1);
    expect(refreshes()).toBe(9);
    await act(async () => vi.advanceTimersByTime(360_000 * 3));
    await new Promise((r) => setTimeout(r, 30));
    expect(refreshes()).toBe(9);
  });

  it("카카오(폴백) 재조회의 정체는 말하지 않는다 — 코드표·경로가 달라 오보가 된다", async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("includeGeometry=1")
          ? { ...CAR_BODY, congestion: { jams: [] } }
          : { ...CAR_BODY, provider: "kakao", durationSeconds: 280, congestion: { jams: [JAM] } },
    }));
    await startAndTick();
    await new Promise((r) => setTimeout(r, 50));
    expect(jamLines()).toHaveLength(0);
  });

  it("시작 조회에 교통 정보가 없으면 정보가 처음 온 재조회는 기준선이 되고, 그 뒤 새로 생긴 것만 말한다", async () => {
    const LATER = { road: "올림픽로", startMeters: 420, lengthMeters: 60, start: pt(420), end: pt(480) };
    let n = 0;
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => {
        if (url.includes("includeGeometry=1")) return { ...CAR_BODY };
        n += 1;
        return { ...CAR_BODY, durationSeconds: 280, congestion: { jams: n === 1 ? [JAM] : [JAM, LATER] } };
      },
    }));
    await startAndTick();
    await new Promise((r) => setTimeout(r, 50));
    expect(jamLines()).toHaveLength(0);
    await tick(1);
    await waitFor(() => expect(jamLines()).toEqual(["420m 앞 올림픽로에 60m 정체가 새로 생겼습니다."]));
  });
});

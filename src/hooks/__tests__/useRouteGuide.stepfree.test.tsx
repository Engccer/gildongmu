// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ko from "../../../messages/ko.json";

vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({
    status: "ready" as const,
    coords: { lat: 37.5, lng: 127.1 },
  })),
}));

import { useRouteGuide } from "../useRouteGuide";

/**
 * 계단 회피가 안내 경로 조회에 실리는가(백로그 A4). 봉인이 아니라 **조회 시점
 * 판독**이라는 계약을 함께 못 박는다 — 웹 useState 초기값은 컴포넌트 마운트
 * 수명이지 세션 수명이 아니다(spec 2026-08-08 §2.2).
 */
const M = 1 / 111320;
const pt = (m: number) => ({ lat: 37.5 + m * M, lng: 127.1 });

const WALK_STEPS = [
  { description: "직진 200m 이동", pathCoords: [pt(0), pt(200)] },
  { description: "우회전 후 300m 이동", pathCoords: [pt(200), pt(500)] },
];

const DEST = { lat: 37.5 + 500 * M, lng: 127.1, name: "목적지" };

let fetchMock: ReturnType<typeof vi.fn>;

/** `/api/route/walk` 응답 봉투. extra로 stepFree·stepFreeNotice를 얹는다. */
function walkBody(extra: Record<string, unknown> = {}) {
  return {
    result: {
      distanceMeters: 500,
      durationSeconds: 400,
      steps: WALK_STEPS,
      ...extra,
    },
  };
}

function setWalkResponse(extra: Record<string, unknown> = {}) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => walkBody(extra) });
}

/** fetch 호출 중 도보 라우트 URL만. */
function walkUrls(): string[] {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.startsWith("/api/route/walk"));
}

function Harness({ accessible }: { accessible: boolean }) {
  const g = useRouteGuide(DEST, "walk", accessible);
  return (
    <div>
      <button onClick={g.start}>start</button>
      <button onClick={g.stop}>stop</button>
      <button onClick={g.requestReroute}>reroute</button>
      <p data-testid="status">{g.status}</p>
      <p data-testid="live">{g.liveText}</p>
    </div>
  );
}

function renderGuide(accessible: boolean) {
  const ui = (a: boolean) => (
    <NextIntlClientProvider locale="ko" messages={ko}>
      <Harness accessible={a} />
    </NextIntlClientProvider>
  );
  const r = render(ui(accessible));
  return { setAccessible: (a: boolean) => r.rerender(ui(a)) };
}

const click = (label: string) => fireEvent.click(screen.getByText(label));
const live = () => screen.getByTestId("live").textContent ?? "";

/** 시작 조회가 끝나 상세 통지가 나올 때까지. */
async function settleStart() {
  await waitFor(() => expect(live()).not.toBe(""));
}

beforeEach(() => {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
  });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  setWalkResponse();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("계단 회피가 안내 조회에 실린다", () => {
  it("세션 시작 요청에 accessible=true가 붙는다", async () => {
    renderGuide(true);
    click("start");
    await settleStart();

    expect(walkUrls()).toContainEqual(expect.stringContaining("accessible=true"));
  });

  it("꺼져 있으면 파라미터를 붙이지 않는다(기존 캐시 경로 유지)", async () => {
    renderGuide(false);
    click("start");
    await settleStart();

    expect(walkUrls()).toHaveLength(1);
    expect(walkUrls()[0]).not.toContain("accessible");
  });

  it("이탈 재조회도 그 시점 값을 읽는다", async () => {
    renderGuide(true);
    click("start");
    await settleStart();
    fetchMock.mockClear();

    click("reroute");
    await waitFor(() => expect(walkUrls()).toHaveLength(1));

    expect(walkUrls()[0]).toContain("accessible=true");
  });

  // ⚠ 같은 마운트에서 값이 바뀌는 시나리오여야 한다. prop을 처음부터 true로 두면
  //   초기값 고정과 조회 시점 판독이 같은 값을 내 변이가 관측 불가가 된다.
  it("세션 종료 후 값이 바뀌면 다음 세션이 새 값을 쓴다", async () => {
    const { setAccessible } = renderGuide(false);
    click("start");
    await settleStart();
    click("stop");

    setAccessible(true);
    fetchMock.mockClear();
    click("start");
    await waitFor(() => expect(walkUrls()).toHaveLength(1));

    expect(walkUrls()[0]).toContain("accessible=true");
  });
});

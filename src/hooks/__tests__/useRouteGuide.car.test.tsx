// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
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

function Harness({ kind, tag }: { kind: GuideKind; tag: string }) {
  const g = useRouteGuide(DEST, kind, false);
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
        ko.guide.detailUnavailable,
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

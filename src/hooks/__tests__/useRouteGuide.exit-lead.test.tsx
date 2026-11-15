// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ko from "../../../messages/ko.json";

const awaitGeolocation = vi.hoisted(() => vi.fn());
vi.mock("@/lib/geolocation", () => ({ awaitGeolocation }));

import { useRouteGuide } from "../useRouteGuide";

/**
 * 출구 인계(E84, spec `2026-11-14-transit-exit-carryover-design.md`): 지하철 말미 도보 인계가 출구 번호를 실어 오면
 * 첫 시작류 통지가 「N번 출구로 나가세요.」부터 말한다. 출구가 없으면 문장은 종전과 바이트 동일하다.
 */
const M = 1 / 111320;
const pt = (m: number) => ({ lat: 37.5 + m * M, lng: 127.1 });
const DEST = { lat: 37.5 + 500 * M, lng: 127.1, name: "목적지" };
const ROUTE_OK = {
  ok: true,
  status: 200,
  json: async () => ({
    result: {
      distanceMeters: 500,
      durationSeconds: 400,
      steps: [{ description: "직진 500m 이동", pathCoords: [pt(0), pt(500)] }],
    },
  }),
};

let fetchMock: ReturnType<typeof vi.fn>;

function Harness({ exitLead }: { exitLead?: string | null }) {
  const g = useRouteGuide(DEST, "walk", { accessible: false, variant: null }, { exitLead });
  return (
    <div>
      <button onClick={g.start}>start</button>
      <button onClick={g.stop}>stop</button>
      <p data-testid="live">{g.liveText}</p>
    </div>
  );
}

function renderGuide(exitLead?: string | null) {
  render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <Harness exitLead={exitLead} />
    </NextIntlClientProvider>,
  );
}

const live = () => screen.getByTestId("live").textContent ?? "";

async function start() {
  fireEvent.click(screen.getByText("start"));
  await waitFor(() => expect(live()).not.toBe(""));
}

beforeEach(() => {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
  });
  awaitGeolocation.mockResolvedValue({ status: "ready", coords: { lat: 37.5, lng: 127.1 } });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("출구 인계(E84) 시작 통지", () => {
  it("출구가 있으면 시작 요약이 출구 문장부터 말하고, 나머지는 출구 없는 문장과 같다", async () => {
    fetchMock.mockResolvedValue(ROUTE_OK);
    renderGuide(null);
    await start();
    const plain = live();
    expect(plain).not.toContain("출구");
    cleanup();

    renderGuide("5");
    await start();
    expect(live()).toBe(`5번 출구로 나가세요. ${plain}`);
  });

  it("출구를 주지 않은 호출도 문장이 같다(미지정 = null)", async () => {
    fetchMock.mockResolvedValue(ROUTE_OK);
    renderGuide(null);
    await start();
    const plain = live();
    cleanup();
    renderGuide(undefined);
    await start();
    expect(live()).toBe(plain);
  });

  it("경로 조회가 실패해도 출구 문장은 강등 문장 앞에 실린다", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    renderGuide("5");
    await start();
    expect(live()).toBe(`5번 출구로 나가세요. ${ko.guide.degradedRetryable}`);
  });

  it("같은 마운트의 재시작은 출구 문장을 다시 싣지 않는다", async () => {
    fetchMock.mockResolvedValue(ROUTE_OK);
    renderGuide("5");
    await start();
    expect(live()).toContain("5번 출구로 나가세요.");
    fireEvent.click(screen.getByText("stop"));
    fireEvent.click(screen.getByText("start"));
    await waitFor(() => expect(live()).toContain("도보 안내 시작"));
    expect(live()).not.toContain("출구");
  });
});

// @vitest-environment jsdom
import { vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => {
    const f = (key: string, params?: Record<string, unknown>) =>
      params ? `${ns}.${key}${JSON.stringify(params)}` : `${ns}.${key}`;
    return Object.assign(f, { rich: (key: string) => `${ns}.${key}` });
  },
  useLocale: () => "ko",
}));
vi.mock("@/lib/geolocation", () => ({ awaitGeolocation: vi.fn() }));

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { awaitGeolocation } from "@/lib/geolocation";
import { WalkInfraNearby } from "../WalkInfraNearby";
import { describeNearbyContract, KOREA_COORDS } from "./nearby-contract";

/**
 * 음향신호기는 성공(2기), OSM은 실패 — 두 소스가 서로 독립적으로 강등된다는
 * 계약(spec §2-F)을 한 fixture로 태운다.
 */
const walk = {
  audioSignals: {
    status: "ok",
    data: {
      deviceCount: 2,
      baseDate: "20260101",
      sites: [{ bearing: "n", distanceMeters: 40, deviceCount: 2 }],
    },
  },
  osm: { status: "error" },
};

describeNearbyContract({
  name: "WalkInfraNearby",
  ns: "walkInfra",
  renderComponent: () => <WalkInfraNearby />,
  triggerName: "walkInfra.button",
  expectedUrl: (lat, lng) => `/api/walk/nearby?lat=${lat}&lng=${lng}`,
  successBody: { walk },
  successProbe: "walkInfra.audioSite",
  // 결과 0건이라는 상태가 없다 — 소스별 상태(ok/unsupported/error)가 정본.
  hasCoverage: false,
  // done live는 두 소스의 합성 문자열 — 아래 고유 it이 전문을 못 박는다.
  liveReadyOnDone: false,
});

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const geoMock = vi.mocked(awaitGeolocation);

/** 컴포넌트가 읽는 표면(`ok`·`json()`)만 갖춘 최소 Response. */
function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

describe("WalkInfraNearby 도메인 계약", () => {
  let fetchMock: ReturnType<typeof vi.fn<FetchFn>>;

  beforeEach(() => {
    geoMock.mockReset();
    fetchMock = vi.fn<FetchFn>();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("done 통지는 성공 소스의 수치와 실패 소스의 실패 문구를 함께 낸다", async () => {
    geoMock.mockResolvedValue({ status: "ready", coords: KOREA_COORDS });
    fetchMock.mockResolvedValue(jsonResponse({ walk }));
    render(<WalkInfraNearby />);

    fireEvent.click(screen.getByRole("button", { name: "walkInfra.button" }));

    await screen.findByRole("heading", { level: 3 });
    // 한 소스의 실패가 다른 소스를 오염시키지 않는다 — "0기" 합성 금지.
    expect(screen.getByRole("status").textContent).toBe(
      'walkInfra.audioSummary{"count":2}, walkInfra.osmError',
    );
  });
});

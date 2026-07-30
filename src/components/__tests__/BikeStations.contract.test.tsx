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
import { BikeStations } from "../BikeStations";
import { describeNearbyContract } from "./nearby-contract";

/** 따릉이 대여소 1곳 — 대여소명은 번호 접두 포함 원문 그대로. */
const station = {
  stationId: "ST-2749",
  name: "3681. 길동 마루빌딩",
  lat: 37.5385,
  lng: 127.1424,
  distanceMeters: 180,
  racksTotal: 10,
  bikesAvailable: 4,
};

describeNearbyContract({
  name: "BikeStations",
  ns: "bike",
  renderComponent: () => <BikeStations mode="current" />,
  triggerName: "bike.currentButton",
  expectedUrl: (lat, lng) => `/api/bike/nearby?lat=${lat}&lng=${lng}`,
  successBody: { stations: [station] },
  successProbe: "3681. 길동 마루빌딩",
  emptyBody: { stations: [] },
  hasCoverage: true,
  liveReadyOnDone: true,
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

describe("BikeStations 도메인 계약", () => {
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

  it("장소 모드는 위치 권한 없이 props 좌표로 조회한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ stations: [station] }));
    render(<BikeStations mode="place" lat={37.5385} lng={127.1424} />);

    fireEvent.click(screen.getByRole("button", { name: "bike.placeButton" }));

    await screen.findByRole("heading", { level: 3 });
    expect(geoMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/bike/nearby?lat=37.5385&lng=127.1424",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });
});

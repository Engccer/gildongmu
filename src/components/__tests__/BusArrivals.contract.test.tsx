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

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { awaitGeolocation } from "@/lib/geolocation";
import { BusArrivals } from "../BusArrivals";
import { describeNearbyContract, KOREA_COORDS } from "./nearby-contract";

/** 서울 TOPIS 정류소 1곳 + 도착 1건(arrmsg1 완성 문장이 낭독 정본). */
const stop = {
  nodeId: "121000012",
  cityCode: "",
  name: "길동사거리",
  lat: 37.5385,
  lng: 127.1424,
  distanceMeters: 120,
  source: "seoul",
  arrivalStatus: "ok",
  arrivals: [
    {
      routeId: "100100118",
      routeNo: "340",
      routeType: "간선버스",
      arrivalSeconds: 234,
      prevStationCount: 2,
      lowFloor: true,
      arrivalMessage: "3분54초후[2번째 전]",
      source: "seoul",
    },
  ],
};

describeNearbyContract({
  name: "BusArrivals",
  ns: "bus",
  renderComponent: () => <BusArrivals mode="current" />,
  triggerName: "bus.currentButton",
  expectedUrl: (lat, lng) => `/api/bus/nearby?lat=${lat}&lng=${lng}`,
  successBody: { stops: [stop] },
  successProbe: "길동사거리",
  emptyBody: { stops: [] },
  hasCoverage: true,
  // done 통지는 헤딩 포커스가 담당하고 live는 비운다 — 아래 고유 it이 못 박는다.
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

describe("BusArrivals 도메인 계약", () => {
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

  it("done 통지는 헤딩 포커스가 맡고 live는 빈 문자열로 비운다", async () => {
    geoMock.mockResolvedValue({ status: "ready", coords: KOREA_COORDS });
    fetchMock.mockResolvedValue(jsonResponse({ stops: [stop] }));
    render(<BusArrivals mode="current" />);

    fireEvent.click(screen.getByRole("button", { name: "bus.currentButton" }));

    const heading = await screen.findByRole("heading", { level: 3 });
    expect(heading.textContent).toContain("bus.ready");
    await waitFor(() => expect(document.activeElement).toBe(heading));
    // 정확히 빈 문자열이어야 자식(BusRouteStops) 통지가 이 단일 채널을 쓸 수 있다.
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("장소 모드는 위치 권한 없이 props 좌표로 조회한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ stops: [stop] }));
    render(<BusArrivals mode="place" lat={37.5385} lng={127.1424} />);

    fireEvent.click(screen.getByRole("button", { name: "bus.placeButton" }));

    await screen.findByRole("heading", { level: 3 });
    expect(geoMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/bus/nearby?lat=37.5385&lng=127.1424",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("도착조회 실패 정류소는 '버스 없음'과 다른 문구로 낭독한다", async () => {
    geoMock.mockResolvedValue({ status: "ready", coords: KOREA_COORDS });
    fetchMock.mockResolvedValue(
      jsonResponse({
        stops: [{ ...stop, arrivalStatus: "unavailable", arrivals: [] }],
      }),
    );
    const { container } = render(<BusArrivals mode="current" />);

    fireEvent.click(screen.getByRole("button", { name: "bus.currentButton" }));

    await screen.findByRole("heading", { level: 3 });
    expect(container.textContent).toContain("bus.arrivalUnavailable");
    expect(container.textContent).not.toContain("bus.noArrivals");
  });
});

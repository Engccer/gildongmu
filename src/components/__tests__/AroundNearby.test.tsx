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

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { awaitGeolocation } from "@/lib/geolocation";
import { __resetManualLocationForTest, setManualLocation } from "@/lib/manual-location-store";
import { __resetOpenPlaceForTest, subscribeOpenPlace } from "@/lib/place-open-request";
import type { Place } from "@/lib/types";
import { AroundNearby } from "../AroundNearby";
import { KOREA_COORDS } from "./nearby-contract";

/**
 * 둘러보기 고유 계약 — 공유 스위트(`nearby-contract.tsx`)는 "fetch 1회 = URL 1개, 헤딩 =
 * `ready asOf`"를 전제하는데 이 패널은 세 요청을 한 커밋으로 묶고 헤딩이 위치 문장이라
 * 그 전제 밖이다. 공유 스위트가 못 박는 축(latest-wins·아코디언·geoerror·커버리지)은
 * `useNearbyFetch`가 소유하므로 여기선 이 컴포넌트가 더한 것만 판정한다.
 */

const geoMock = vi.mocked(awaitGeolocation);

const overviewBody = {
  data: {
    place: "서울특별시 강동구 길동, 천중로44길 74",
    radiusMeters: 1000,
    bullets: [
      { kind: "transit", state: "ok", station: null, busStops: null },
      { kind: "kids", state: "none" },
    ],
  },
};
const sceneItem = {
  name: "봉래면옥",
  id: "kakao-scene-1",
  lat: 37.54,
  lng: 127.15,
  categoryRaw: "음식점 > 한식",
  roadAddress: "서울 강동구 명일로 1",
  distanceMeters: 62,
  road: "명일로",
  category: "restaurant",
};
const sceneBody = {
  data: { place: null, frame: "entrance", groups: [{ bucket: "left", items: [sceneItem] }], total: 1 },
};
const placesBody = {
  places: [
    {
      id: "kakao-1",
      name: "길동편의점",
      category: "convenience",
      categoryRaw: "가정,생활 > 편의점",
      roadAddress: null,
      distanceMeters: 40,
      bearing: "n",
      lat: 37.5386,
      lng: 127.1425,
    },
  ],
};

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 502, json: async () => body } as unknown as Response;
}

type Route = "overview" | "scene" | "around";
function routeOf(url: string): Route {
  if (url.includes("/api/nearby/overview")) return "overview";
  if (url.includes("/api/surroundings/scene")) return "scene";
  if (url.includes("/api/places/around")) return "around";
  throw new Error(`unexpected url ${url}`);
}

function stubFetch(responses: Partial<Record<Route, Response>>) {
  const fetchMock = vi.fn(async (url: string) => {
    const res = responses[routeOf(url)];
    if (!res) throw new Error("network");
    return res;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const heading = () => screen.queryByRole("heading", { level: 3 });
const live = () => screen.getByRole("status").textContent;

async function openPanel() {
  render(<AroundNearby />);
  fireEvent.click(screen.getByRole("button", { name: "around.button" }));
  await act(async () => {
    await Promise.resolve();
  });
}

describe("AroundNearby", () => {
  beforeEach(() => {
    geoMock.mockReset();
    geoMock.mockResolvedValue({ status: "ready", coords: KOREA_COORDS });
    __resetManualLocationForTest();
    __resetOpenPlaceForTest();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    __resetManualLocationForTest();
  });

  it("세 요청을 한 번에 보내고 한 커밋으로 렌더한다 — 헤딩은 위치 문장, 통지는 ready", async () => {
    const fetchMock = stubFetch({
      overview: jsonResponse(overviewBody),
      scene: jsonResponse(sceneBody),
      around: jsonResponse(placesBody),
    });
    await openPanel();

    await waitFor(() => expect(heading()).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Set(fetchMock.mock.calls.map((c) => routeOf(c[0] as string)))).toEqual(
      new Set(["overview", "scene", "around"]),
    );
    expect(heading()!.textContent).toBe(
      `around.here${JSON.stringify({ place: overviewBody.data.place })}`,
    );
    expect(live()).toBe("around.ready");
    // 한눈에 보기: 불릿당 항목 하나(두 불릿 → 두 줄), 반경 부제는 헤딩 한 곳에만.
    const overviewHeading = screen.getByRole("heading", { level: 4, name: /overview\.heading/ });
    expect(overviewHeading.textContent).toContain("overview.radius");
    expect(screen.getAllByText(/overview\.(transitLead|none)/)).toHaveLength(2);
    // 주변 상황 자동 펼침 + 주변 가게 목록 — 버튼 없이 같은 커밋에 있다.
    expect(screen.getByRole("heading", { level: 4, name: "around.sceneHeading" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "around.placesHeading" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "surroundings.button" })).toBeNull();
  });

  it("조각 하나가 실패해도 패널은 열리고 그 자리에 실패 문장이 남는다(침묵 금지)", async () => {
    stubFetch({
      overview: jsonResponse({}, false),
      scene: jsonResponse(sceneBody),
      around: undefined,
    });
    await openPanel();

    await waitFor(() => expect(heading()).not.toBeNull());
    expect(screen.getByText("whereAmI.overview.failed")).toBeTruthy();
    expect(screen.getByText("around.placesFailed")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "around.sceneHeading" })).toBeTruthy();
    // 조망이 없으면 위치 문장은 장소 없는 형태.
    expect(heading()!.textContent).toBe("around.hereNoPlace");
  });

  it("셋 다 실패하면 error로 통지하고 패널을 열지 않는다", async () => {
    stubFetch({});
    await openPanel();

    await waitFor(() => expect(live()).toBe("around.error"));
    expect(heading()).toBeNull();
  });

  it("수동 위치로 조회하면 헤딩·통지가 지정한 위치를 말한다(GPS 문구 금지)", async () => {
    setManualLocation({
      label: "길동 카페", lat: KOREA_COORDS.lat, lng: KOREA_COORDS.lng,
      origin: { lat: KOREA_COORDS.lat, lng: KOREA_COORDS.lng, accuracy: 10, at: 1 },
      setAt: 1,
    });
    stubFetch({
      overview: jsonResponse(overviewBody),
      scene: jsonResponse(sceneBody),
      around: jsonResponse(placesBody),
    });
    await openPanel();

    await waitFor(() => expect(heading()).not.toBeNull());
    expect(heading()!.textContent).toContain("around.hereManual");
    expect(live()).toBe("around.readyManual");
    expect(geoMock).not.toHaveBeenCalled();
  });

  it("주변 상황·주변 가게의 장소 행은 상세 진입 요청을 낸다", async () => {
    stubFetch({
      overview: jsonResponse(overviewBody),
      scene: jsonResponse(sceneBody),
      around: jsonResponse(placesBody),
    });
    const opened: Place[] = [];
    subscribeOpenPlace((p) => opened.push(p));
    await openPanel();
    await waitFor(() => expect(heading()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /봉래면옥/ }));
    fireEvent.click(screen.getByRole("button", { name: /길동편의점/ }));

    expect(opened.map((p) => [p.id, p.name, p.lat, p.lng])).toEqual([
      ["kakao-scene-1", "봉래면옥", 37.54, 127.15],
      ["kakao-1", "길동편의점", 37.5386, 127.1425],
    ]);
  });
});

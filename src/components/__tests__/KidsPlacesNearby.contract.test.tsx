// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => {
    const f = (key: string, params?: Record<string, unknown>) =>
      params ? `${ns}.${key}${JSON.stringify(params)}` : `${ns}.${key}`;
    return Object.assign(f, { rich: (key: string) => `${ns}.${key}` });
  },
  useLocale: () => "ko",
}));
vi.mock("@/lib/geolocation", () => ({ awaitGeolocation: vi.fn() }));

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { awaitGeolocation } from "@/lib/geolocation";
import { NEARBY_INITIAL_VISIBLE, NEARBY_REVEAL_STEP } from "@/hooks/useRevealMore";
import { KidsPlacesNearby } from "../KidsPlacesNearby";
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";
import { describeNearbyContract, KOREA_COORDS } from "./nearby-contract";

const kidsPlace = {
  id: "kakao-1",
  name: "길동키즈카페",
  category: "가정,생활 > 유아용품 > 키즈카페",
  kind: "kidscafe",
  indoorOutdoor: "indoor",
  distanceMeters: 120,
  address: "서울 강동구 길동 1",
  roadAddress: "서울 강동구 양재대로 1",
  lat: 37.5385,
  lng: 127.1424,
  phone: "02-111-2222",
  link: "https://place.map.kakao.com/1",
};

describeNearbyContract({
  name: "KidsPlacesNearby",
  ns: "kidsNearby",
  renderComponent: () => <KidsPlacesNearby />,
  triggerName: "kidsNearby.button",
  expectedUrl: (lat, lng) =>
    `/api/places/kids?lat=${lat}&lng=${lng}&limit=${NEARBY_LIMIT_MAX}`,
  successBody: { kids: [kidsPlace] },
  successProbe: "길동키즈카페",
  emptyBody: { kids: [] },
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

function manyKidsPlaces(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    ...kidsPlace,
    id: `kakao-${i}`,
    name: `키즈장소${i}`,
  }));
}

describe("KidsPlacesNearby 더 보기", () => {
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

  it("더 보기: 10개씩 단계 공개, 마지막 배치에서 버튼 소멸, 새로고침으로 리셋", async () => {
    geoMock.mockResolvedValue({ status: "ready", coords: KOREA_COORDS });
    fetchMock.mockResolvedValue(jsonResponse({ kids: manyKidsPlaces(25) }));
    render(<KidsPlacesNearby />);
    fireEvent.click(screen.getByRole("button", { name: "kidsNearby.button" }));

    const itemHeadings = () => screen.getAllByRole("heading", { level: 4 });
    const showMore = () => screen.getByRole("button", { name: "actions.showMore" });
    await waitFor(() => expect(itemHeadings()).toHaveLength(NEARBY_INITIAL_VISIBLE));
    expect(showMore()).toBeTruthy();

    fireEvent.click(showMore());
    await waitFor(() =>
      expect(itemHeadings()).toHaveLength(NEARBY_INITIAL_VISIBLE + NEARBY_REVEAL_STEP),
    );
    expect(document.activeElement).toBe(itemHeadings()[NEARBY_INITIAL_VISIBLE]);
    expect(showMore()).toBeTruthy();

    fireEvent.click(showMore());
    await waitFor(() => expect(itemHeadings()).toHaveLength(25));
    expect(document.activeElement).toBe(
      itemHeadings()[NEARBY_INITIAL_VISIBLE + NEARBY_REVEAL_STEP],
    );
    expect(screen.queryByRole("button", { name: "actions.showMore" })).toBeNull();

    // 새로고침(재조회 성공) — 공개 수 10개로 리셋.
    fireEvent.click(screen.getByRole("button", { name: "kidsNearby.refresh" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(itemHeadings()).toHaveLength(NEARBY_INITIAL_VISIBLE));
  });
});

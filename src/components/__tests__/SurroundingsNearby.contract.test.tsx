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
import { SurroundingsNearby } from "../SurroundingsNearby";
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";
import { describeNearbyContract, KOREA_COORDS } from "./nearby-contract";

const surrounding = {
  id: "kakao-2",
  name: "길동편의점",
  category: "convenience",
  categoryRaw: "가정,생활 > 편의점",
  roadAddress: null,
  distanceMeters: 40,
  bearing: "se",
  lat: 37.5386,
  lng: 127.1425,
  phone: "02-333-4444",
  link: "https://place.map.kakao.com/2",
};

describeNearbyContract({
  name: "SurroundingsNearby",
  ns: "surroundingsNearby",
  renderComponent: () => <SurroundingsNearby />,
  triggerName: "surroundingsNearby.button",
  expectedUrl: (lat, lng) =>
    `/api/places/around?lat=${lat}&lng=${lng}&limit=${NEARBY_LIMIT_MAX}`,
  successBody: { places: [surrounding] },
  successProbe: "길동편의점",
  emptyBody: { places: [] },
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

function manySurroundings(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    ...surrounding,
    id: `kakao-${i}`,
    name: `주변장소${i}`,
  }));
}

describe("SurroundingsNearby 더 보기", () => {
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
    fetchMock.mockResolvedValue(jsonResponse({ places: manySurroundings(25) }));
    render(<SurroundingsNearby />);
    fireEvent.click(screen.getByRole("button", { name: "surroundingsNearby.button" }));

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
    fireEvent.click(screen.getByRole("button", { name: "surroundingsNearby.refresh" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(itemHeadings()).toHaveLength(NEARBY_INITIAL_VISIBLE));
  });
});

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
import { NightClinicsNearby } from "../NightClinicsNearby";
import { describeNearbyContract, KOREA_COORDS } from "./nearby-contract";

/** NightClinic + 라우트가 덧붙이는 openStatus(진료 3-state). */
const clinic = {
  id: "clinic-1",
  name: "서울아이병원",
  address: "서울 강동구 천호대로 1000",
  phone: "02-1234-5678",
  kind: "달빛어린이병원",
  emergencyClass: "응급의료기관 이외",
  directions: "",
  lat: 37.5385,
  lng: 127.1234,
  distanceMeters: 350,
  hours: [],
  openStatus: { state: "open", start: 1800, end: 2400 },
  designated: true,
};

describeNearbyContract({
  name: "NightClinicsNearby",
  ns: "clinicNearby",
  renderComponent: () => <NightClinicsNearby />,
  triggerName: "clinicNearby.button",
  expectedUrl: (lat, lng) => `/api/clinic/nearby?lat=${lat}&lng=${lng}`,
  successBody: { clinics: [clinic], basis: "weekday", supplementFailed: false },
  successProbe: "서울아이병원",
  emptyBody: { clinics: [], basis: "weekday", supplementFailed: false },
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

function manyClinics(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    ...clinic,
    id: `clinic-${i}`,
    name: `클리닉${i}`,
  }));
}

describe("NightClinicsNearby 더 보기", () => {
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
    fetchMock.mockResolvedValue(
      jsonResponse({ clinics: manyClinics(25), basis: "weekday", supplementFailed: false }),
    );
    render(<NightClinicsNearby />);
    fireEvent.click(screen.getByRole("button", { name: "clinicNearby.button" }));

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
    fireEvent.click(screen.getByRole("button", { name: "clinicNearby.refresh" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(itemHeadings()).toHaveLength(NEARBY_INITIAL_VISIBLE));
  });
});

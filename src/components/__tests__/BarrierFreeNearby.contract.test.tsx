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
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";
import { BarrierFreeNearby } from "../BarrierFreeNearby";
import { describeNearbyContract, KOREA_COORDS } from "./nearby-contract";

/** KorWithService2 locationBasedList2 정규화 결과 1건. */
const place = {
  contentId: "126508",
  name: "서울숲",
  category: "관광지",
  address: "서울특별시 성동구 뚝섬로 273",
  lat: 37.5445,
  lng: 127.0374,
  distanceMeters: 820,
};

/** detailWithTour2 정규화 — 값 있는 화이트리스트 항목만. */
const detail = {
  contentId: "126508",
  name: "서울숲",
  facilities: [
    { key: "wheelchair", label: "휠체어 대여", value: "안내소에서 대여 가능" },
  ],
};

const LIST_URL = (lat: number, lng: number) =>
  `/api/places/barrier-free?lat=${lat}&lng=${lng}&limit=${NEARBY_LIMIT_MAX}`;

describeNearbyContract({
  name: "BarrierFreeNearby",
  ns: "barrierFreeNearby",
  renderComponent: () => <BarrierFreeNearby />,
  triggerName: "barrierFreeNearby.button",
  expectedUrl: LIST_URL,
  successBody: { places: [place] },
  successProbe: "서울숲",
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

describe("BarrierFreeNearby 도메인 계약", () => {
  let fetchMock: ReturnType<typeof vi.fn<FetchFn>>;

  /** 목록·상세 두 엔드포인트를 URL로 분기(상세는 lazy 호출 수를 세야 한다). */
  function routeFetch() {
    fetchMock.mockImplementation(async (url) =>
      url.startsWith("/api/places/barrier-free/detail")
        ? jsonResponse({ detail })
        : jsonResponse({ places: [place] }),
    );
  }

  const detailCalls = () =>
    fetchMock.mock.calls.filter(([url]) =>
      url.startsWith("/api/places/barrier-free/detail"),
    ).length;

  beforeEach(() => {
    geoMock.mockReset();
    fetchMock = vi.fn<FetchFn>();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("autoLoad는 트리거·닫기 없이 마운트 즉시 조회한다", async () => {
    geoMock.mockResolvedValue({ status: "ready", coords: KOREA_COORDS });
    routeFetch();
    render(<BarrierFreeNearby autoLoad />);

    const heading = await screen.findByRole("heading", { level: 3 });
    expect(heading.textContent).toContain("barrierFreeNearby.ready");
    expect(screen.getByRole("status").textContent).toBe(
      "barrierFreeNearby.ready",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      LIST_URL(KOREA_COORDS.lat, KOREA_COORDS.lng),
    );
    // 채팅 카드는 오버레이가 소유하므로 자체 트리거·닫기를 두지 않는다.
    expect(
      screen.queryByRole("button", { name: "barrierFreeNearby.button" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "actions.close" })).toBeNull();
  });

  it("편의시설 펼침은 aria-expanded로 알리고 상세를 한 번만 가져온다", async () => {
    geoMock.mockResolvedValue({ status: "ready", coords: KOREA_COORDS });
    routeFetch();
    render(<BarrierFreeNearby />);

    fireEvent.click(
      screen.getByRole("button", { name: "barrierFreeNearby.button" }),
    );
    await screen.findByRole("heading", { level: 3 });

    const toggle = screen.getByRole("button", {
      name: "barrierFreeNearby.showFacilities",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(detailCalls()).toBe(0);

    fireEvent.click(toggle);

    expect(await screen.findByText("휠체어 대여 안내소에서 대여 가능")).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(detailCalls()).toBe(1);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("휠체어 대여 안내소에서 대여 가능")).toBeNull();

    // 재펼침은 캐시 — 같은 항목을 다시 요청하지 않는다.
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("휠체어 대여 안내소에서 대여 가능")).toBeTruthy();
    expect(detailCalls()).toBe(1);
  });
});

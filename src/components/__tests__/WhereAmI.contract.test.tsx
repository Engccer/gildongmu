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
import { WhereAmI } from "../WhereAmI";
import { describeNearbyContract, KOREA_COORDS } from "./nearby-contract";

/** 네 조각(주소·행정동·근접역·기준점)이 모두 채워진 정위 결과. */
const data = {
  address: {
    road: "서울특별시 강동구 천중로44길 74",
    jibun: "서울특별시 강동구 길동 385-1",
  },
  region: "서울특별시 강동구 길동",
  nearestStation: {
    name: "굽은다리",
    line: "5호선",
    bearing: "se",
    distanceMeters: 240,
  },
  landmarks: [
    {
      id: "kakao-1",
      name: "길동편의점",
      category: "convenience",
      categoryRaw: "가정,생활 > 편의점",
      distanceMeters: 40,
      bearing: "n",
      lat: 37.5386,
      lng: 127.1425,
    },
  ],
};

describeNearbyContract({
  name: "WhereAmI",
  ns: "whereAmI",
  renderComponent: () => <WhereAmI />,
  triggerName: "whereAmI.button",
  expectedUrl: (lat, lng) => `/api/where-am-i?lat=${lat}&lng=${lng}`,
  successBody: { data },
  successProbe: "whereAmI.narrative.here",
  // 조각이 하나도 안 잡히면 라우트가 data:null로 200을 준다(오류 아님).
  emptyBody: { data: null },
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

describe("WhereAmI 도메인 계약", () => {
  let fetchMock: ReturnType<typeof vi.fn<FetchFn>>;

  async function openToDone() {
    geoMock.mockResolvedValue({ status: "ready", coords: KOREA_COORDS });
    fetchMock.mockResolvedValue(jsonResponse({ data }));
    const view = render(<WhereAmI />);
    fireEvent.click(screen.getByRole("button", { name: "whereAmI.button" }));
    await screen.findByRole("heading", { level: 3 });
    return view;
  }

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
    await openToDone();

    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading.textContent).toContain("whereAmI.ready");
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("done 패널은 위치·근접역·기준점 산문을 모두 렌더한다", async () => {
    const { container } = await openToDone();

    expect(container.textContent).toContain("whereAmI.narrative.here");
    expect(container.textContent).toContain("whereAmI.narrative.station");
    expect(container.textContent).toContain("whereAmI.narrative.landmarksLead");
    expect(container.textContent).toContain("whereAmI.narrative.landmarkItem");
    expect(container.textContent).toContain("whereAmI.narrative.landmarksTail");
  });
});

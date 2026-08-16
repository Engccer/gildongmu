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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { awaitGeolocation } from "@/lib/geolocation";
import {
  __resetManualLocationForTest,
  clearManualLocation,
  setManualLocation,
} from "@/lib/manual-location-store";
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
      roadAddress: null,
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

  it("정위 결과 아래에 '주변 확인' 진입점이 있다 — 앵커는 정위에 쓴 좌표", async () => {
    await openToDone();
    expect(
      screen.getByRole("button", { name: "surroundings.button" }),
    ).toBeTruthy();
  });

  it("done 패널은 위치·근접역·기준점 산문을 모두 렌더한다", async () => {
    const { container } = await openToDone();

    expect(container.textContent).toContain("whereAmI.narrative.here");
    expect(container.textContent).toContain("whereAmI.narrative.station");
    expect(container.textContent).toContain("whereAmI.narrative.landmarksLead");
    expect(container.textContent).toContain("whereAmI.narrative.landmarkItem");
    expect(container.textContent).toContain("whereAmI.narrative.landmarksTail");
  });

  // I2: 자기가 지금 어디 있나를 묻는 **전용** 화면이라, 지정한 좌표를 GPS 판정처럼
  // 낭독하면 사용자는 GPS가 고쳐졌다고 믿는다. 좌표는 이미 수동인데 문구만 GPS였다.
  describe("수동 위치일 때", () => {
    afterEach(() => {
      localStorage.clear();
      __resetManualLocationForTest();
    });

    function setManual() {
      setManualLocation({
        label: "길동 카페", lat: KOREA_COORDS.lat, lng: KOREA_COORDS.lng,
        origin: { lat: KOREA_COORDS.lat, lng: KOREA_COORDS.lng, accuracy: 10, at: 1 },
        setAt: 1,
      });
    }

    it("트리거 이름이 '현재 위치 확인'이 아니라 수동 전용 문구다", () => {
      setManual();
      render(<WhereAmI />);
      expect(screen.getByRole("button", { name: "whereAmI.manualButton" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "whereAmI.button" })).toBeNull();
    });

    it("결과 헤딩이 지정한 위치 라벨을 말한다", async () => {
      setManual();
      fetchMock.mockResolvedValue(jsonResponse({ data }));
      render(<WhereAmI />);
      fireEvent.click(screen.getByRole("button", { name: "whereAmI.manualButton" }));

      const heading = await screen.findByRole("heading", { level: 3 });
      expect(heading.textContent).toContain("manualLocation.manual");
      expect(heading.textContent).not.toContain("whereAmI.ready");
      // as-of 시각은 그대로 병기한다(신선도 표기는 출처와 다른 축).
      expect(heading.textContent).toContain("whereAmI.asOf");
    });

    // D21(2026-08-16): 헤딩은 **이 산문이 무엇을 기준으로 만들어졌나**를 말한다.
    // GPS로 조회해 둔 결과가 떠 있는 채로 위치를 지정하면 종전엔 그 GPS 산문에
    // "지정한 위치" 딱지가 붙었다 — 산문은 그대로인데 출처만 바뀌어 낭독된다.
    // 시각장애 사용자에겐 이 문구가 유일한 정보원이라 반증할 수단이 없다.
    // ⚠ 부정 단언은 **아무 일도 안 일어나면 저절로 참**이 된다(첫 판이 그랬다 —
    // 변이 주입에서 옛 코드가 그대로 통과했다). 그래서 "수동 지정이 이 컴포넌트에
    // 실제로 반영됐다"는 증거(트리거 이름 전환)를 같은 테스트 안에 함께 세운다.
    it("GPS로 조회한 뒤 위치를 지정해도 그 결과 헤딩은 지정 라벨로 바뀌지 않는다", async () => {
      await openToDone();
      const heading = screen.getByRole("heading", { level: 3 });
      expect(heading.textContent).toContain("whereAmI.ready");

      act(() => setManual());

      // 헤딩은 그대로다 — 이 산문이 GPS로 만들어졌기 때문이다.
      expect(heading.textContent).toContain("whereAmI.ready");
      expect(heading.textContent).not.toContain("manualLocation.manual");

      // 증거: 수동 지정이 이 컴포넌트에 실제로 도달했다. 도달하지 않았다면 위 두 단언은
      // "아무 일도 안 일어나서" 통과한 것이라 무의미하다(done 상태의 트리거는 항상
      // '새로고침'이라 증거가 못 된다 — 닫아서 유휴 상태의 트리거 이름으로 확인한다).
      fireEvent.click(screen.getByRole("button", { name: "actions.close" }));
      expect(
        await screen.findByRole("button", { name: "whereAmI.manualButton" }),
      ).toBeTruthy();
    });

    // 위 계약의 **대칭형**(독립 리뷰 검출 2026-08-16): 지정한 위치로 조회한 뒤 그 지정이
    // 풀리면(이동 판정 drop·직접 해제) 헤딩이 "현재 위치"로 떨어져, 수동 좌표로 만든
    // 산문이 GPS로 낭독된다. 라벨을 지금 상태에서 만들면 반드시 생기는 구멍이라
    // `done`에 그때 라벨을 함께 싣는다.
    it("지정한 위치로 조회한 뒤 지정이 풀려도 그 결과 헤딩은 지정 라벨을 유지한다", async () => {
      setManual();
      fetchMock.mockResolvedValue(jsonResponse({ data }));
      render(<WhereAmI />);
      fireEvent.click(screen.getByRole("button", { name: "whereAmI.manualButton" }));
      const heading = await screen.findByRole("heading", { level: 3 });
      expect(heading.textContent).toContain("길동 카페");

      expect(heading.textContent).toContain("manualLocation.manual");

      act(() => clearManualLocation());

      // 라벨은 그대로다 — 이 산문을 만든 좌표는 그 지정에서 왔기 때문이다.
      expect(heading.textContent).toContain("길동 카페");
      // 증거이자 계약: 해제가 도달했고(검증 가능형 → 불가형 전환), 두 축의 시제가
      // 다르다는 것이 여기서 함께 확인된다. 확인할 대상이 없어졌으니 "검증 가능"이라
      // 말할 근거도 사라진다.
      expect(heading.textContent).toContain("manualLocation.manualUnverifiable");
    });
  });
});

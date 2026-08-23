// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Place } from "@/lib/types";
import { shouldCollapseWalk } from "@/lib/walk-collapse";
import messages from "../../../messages/ko.json";

/**
 * 길찾기 뷰 재편 계약(spec §4.4·§4.1·§5): 장거리 도보 상세 접힘과 대안 축 이름,
 * routeKey 기반 세션 추적.
 *
 * 문구는 실제 ko 메시지로 렌더한다(TransitRouteBriefing.test 관례). 키 이름
 * 단언은 인자가 어긋난 문구를 통과시킨다. `guideStartTransitAlt`가 번호에서
 * 이름으로 바뀐 자리가 정확히 그 함정이다.
 */

vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({ status: "error" as const })),
  getGeolocationSnapshot: () => ({ status: "idle" as const }),
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../WalkRouteBriefing", () => ({
  WalkRouteResult: () => <p>도보 구간 상세</p>,
}));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteResult: () => null }));

import { DirectionsView } from "../DirectionsView";

const gangnam: Place = {
  id: "p-gangnam",
  name: "강남역",
  category: "지하철역",
  address: "서울 강남구 역삼동 858",
  roadAddress: "서울 강남구 강남대로 396",
  lat: 37.497,
  lng: 127.027,
};

/** 35분(반올림) 도보: 문턱 초과라 접힌 상태로 시작한다 */
const WALK_LONG = {
  result: {
    distanceMeters: 2000,
    durationSeconds: 35 * 60,
    steps: [{ description: "직진 2km 이동" }],
  },
};
const WALK_LONG_LABEL = "총 2km, 약 35분";

/** 20분 도보: 문턱 이하라 disclosure 없이 바로 펼쳐진다 */
const WALK_SHORT = {
  result: {
    distanceMeters: 900,
    durationSeconds: 20 * 60,
    steps: [{ description: "직진 900m 이동" }],
  },
};

/** 탑승 leg 1개(경유 정류장 포함): 대안 안내 시작 게이트가 성립하는 최소 골격 */
function boardableLegs() {
  return [
    { mode: "walk", minutes: 3 },
    {
      mode: "subway",
      lineName: "수도권 5호선",
      fromName: "천호",
      toName: "여의도",
      stationCount: 8,
      minutes: 24,
      serviceWayCode: 2,
      stops: [
        { name: "천호", stationId: "547", lat: 37.5385, lng: 127.1235 },
        { name: "여의도", stationId: "526", lat: 37.5216, lng: 126.924 },
      ],
    },
    { mode: "walk", minutes: 3 },
  ];
}

function transitRoute(
  routeKey: string,
  extra: Record<string, unknown> = {},
  totalMinutes = 30,
) {
  return {
    summary: { totalMinutes, fare: 1550, transfers: 0, walkMinutes: 6 },
    legs: boardableLegs(),
    routeKey,
    ...extra,
  };
}

/**
 * 대안 3개: 축 라벨 경로(표시 번호 없음)가 배열 앞이고 번호 대안이 뒤다.
 * 표시 번호와 배열 인덱스가 다른 좌표계임을 fixture 자체가 드러낸다.
 */
const TRANSIT_WITH_ALTS = {
  result: {
    recommended: transitRoute("p0", {}, 45),
    alternatives: [
      transitRoute("p7", { highlight: ["fewestTransfers"] }, 71),
      transitRoute("p1", { displayIndex: 1 }, 52),
      transitRoute("p2", { displayIndex: 2 }, 53),
    ],
    totalCandidates: 9,
  },
};

type WalkKind = "long" | "short" | "empty" | "error";

function stubFetch(opts: { walk?: WalkKind; transit?: boolean } = {}) {
  const walkBodies = { long: WALK_LONG, short: WALK_SHORT, empty: { result: null } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/places")) {
        return {
          ok: true,
          json: async () => ({ places: [gangnam], provider: "kakao-local", query: "q" }),
        } as Response;
      }
      if (url.startsWith("/api/address/search")) {
        return { ok: true, json: async () => ({ addresses: [] }) } as Response;
      }
      if (url.startsWith("/api/route/walk")) {
        const kind = opts.walk ?? "long";
        if (kind === "error") return { ok: false, json: async () => ({}) } as Response;
        return { ok: true, json: async () => walkBodies[kind] } as Response;
      }
      if (url.startsWith("/api/transit/track")) {
        // 폴링 실패는 훅이 upstreamFailed로 정직 강등하고 세션은 유지한다.
        return { ok: false, json: async () => ({}) } as Response;
      }
      if (url.startsWith("/api/route/transit")) {
        return { ok: true, json: async () => TRANSIT_WITH_ALTS } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

/** DistanceBeacon·TransitGuidePanel은 측위 미지원 환경에서 렌더를 접는다 */
function stubGeolocationApi() {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
  });
}

async function queryRoutes(mode: "walk" | "transit") {
  stubGeolocationApi();
  render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <DirectionsView
        canShowWalk={mode === "walk"}
        canShowTransit={mode === "transit"}
        canBriefCarRoute={false}
        onBack={() => {}}
      />
    </NextIntlClientProvider>,
  );
  // 후보 확정 흐름은 기존 스위트 관례(포커스 전진 → activeElement 클릭).
  fireEvent.change(screen.getByLabelText("출발지"), { target: { value: "강남" } });
  fireEvent.click(screen.getByRole("button", { name: "출발지 검색" }));
  await waitFor(() => {
    expect(document.activeElement?.textContent).toContain("강남역,");
  });
  fireEvent.click(document.activeElement as HTMLElement);

  fireEvent.change(screen.getByLabelText("도착지"), { target: { value: "강남" } });
  fireEvent.click(screen.getByRole("button", { name: "도착지 검색" }));
  await waitFor(() => {
    expect(document.activeElement?.textContent).toContain("강남역,");
  });
  fireEvent.click(document.activeElement as HTMLElement);

  await submit();
}

async function submit() {
  fireEvent.click(screen.getByRole("button", { name: "경로 조회" }));
  await waitFor(() => {
    expect(
      screen.queryByText(/경로 안내가 준비되었습니다/) ??
        screen.queryByText("경로를 찾지 못했습니다."),
    ).not.toBeNull();
  });
}

const walkDisclosure = () => screen.queryByRole("button", { name: WALK_LONG_LABEL });
const walkDetail = () => screen.queryByText("도보 구간 상세");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("shouldCollapseWalk", () => {
  it("표시 분 값이 30을 넘으면 접는다", () => {
    expect(shouldCollapseWalk(31 * 60)).toBe(true);
  });
  it("정확히 30분이면 펼친다", () => {
    expect(shouldCollapseWalk(30 * 60)).toBe(false);
  });
  it("판정은 표시와 같은 분 값을 쓴다(초 단위로 가르지 않는다)", () => {
    // 30분 1초는 반올림하면 30분이라 라벨이 "약 30분"이다. 접으면 모순이다.
    expect(shouldCollapseWalk(30 * 60 + 1)).toBe(false);
    expect(shouldCollapseWalk(30 * 60 + 31)).toBe(true); // 반올림하면 31분
  });
});

describe("도보 섹션 조건부 접힘(spec §4.4)", () => {
  it("문턱을 넘는 도보는 접힌 상태로 시작한다", async () => {
    stubFetch({ walk: "long" });
    await queryRoutes("walk");
    const disc = walkDisclosure();
    expect(disc?.getAttribute("aria-expanded")).toBe("false");
    expect(walkDetail()).toBeNull();
  });

  it("disclosure를 누르면 상세가 펼쳐진다", async () => {
    stubFetch({ walk: "long" });
    await queryRoutes("walk");
    fireEvent.click(walkDisclosure()!);
    expect(walkDisclosure()?.getAttribute("aria-expanded")).toBe("true");
    expect(walkDetail()).not.toBeNull();
  });

  it("문턱 이하 도보는 disclosure 없이 바로 펼쳐진다", async () => {
    stubFetch({ walk: "short" });
    await queryRoutes("walk");
    expect(screen.queryByRole("button", { name: /^총 900m/ })).toBeNull();
    expect(walkDetail()).not.toBeNull();
  });

  it("경로 없음·조회 실패에는 접을 상세가 없다", async () => {
    stubFetch({ walk: "empty" });
    await queryRoutes("walk");
    expect(screen.getByText("도보 경로를 찾지 못했습니다.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^총 / })).toBeNull();
    cleanup();

    stubFetch({ walk: "error" });
    await queryRoutes("walk");
    expect(screen.getByText("도보 경로를 불러오지 못했습니다.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^총 / })).toBeNull();
  });

  it("계단 회피 토글과 안내 시작 버튼은 접힘 밖에 남는다", async () => {
    stubFetch({ walk: "long" });
    await queryRoutes("walk");
    // 접힌 상태에서도 둘 다 도달 가능해야 한다(접힘 안에 넣으면 영영 못 누른다).
    expect(walkDetail()).toBeNull();
    expect(screen.getByRole("button", { name: "계단 회피 경로" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "도보 안내 시작" })).toBeTruthy();
  });

  it("계단 회피 재조회는 사용자가 펼친 상태를 보존한다", async () => {
    stubFetch({ walk: "long" });
    await queryRoutes("walk");
    fireEvent.click(walkDisclosure()!);
    expect(walkDetail()).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "계단 회피 경로" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "계단 회피 경로" }).getAttribute("aria-busy"),
      ).toBe("false");
    });
    // 사용자 조작이 자동 판정을 이긴다. 재조회로 닫히면 조작이 배신당한다.
    expect(walkDisclosure()?.getAttribute("aria-expanded")).toBe("true");
    expect(walkDetail()).not.toBeNull();
  });

  it("새 조회는 자동 판정으로 복귀한다", async () => {
    stubFetch({ walk: "long" });
    await queryRoutes("walk");
    fireEvent.click(walkDisclosure()!);
    expect(walkDetail()).not.toBeNull();

    await submit();
    expect(walkDisclosure()?.getAttribute("aria-expanded")).toBe("false");
    expect(walkDetail()).toBeNull();
  });
});

describe("대안 축 이름과 routeKey 세션 추적(spec §4.1·§4.2·§5)", () => {
  it("축이 있는 대안은 축 이름, 없는 대안은 표시 번호로 부른다", async () => {
    stubFetch({ transit: true });
    await queryRoutes("transit");
    // 한 줄 = 한 접근성 객체: 이름·요약·도보 요약이 쉼표로 이어진 단일 접근명.
    expect(
      screen.getByRole("button", {
        name: "환승이 가장 적은 경로, 총 71분, 1,550원, 환승 0회, 도보 6분 포함",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /^대안 경로 1, / })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^대안 경로 2, / })).toBeTruthy();
  });

  it("안내 시작 버튼 라벨은 축 이름을 담는다", async () => {
    stubFetch({ transit: true });
    await queryRoutes("transit");
    fireEvent.click(screen.getByRole("button", { name: /^환승이 가장 적은 경로, / }));
    expect(
      screen.getByRole("button", { name: "환승이 가장 적은 경로 안내 시작" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^대안 경로 1, / }));
    expect(screen.getByRole("button", { name: "대안 경로 1 안내 시작" })).toBeTruthy();
  });

  it("세션이 살아 있는 대안의 접힘만 무시되고 다른 대안은 정상 토글된다", async () => {
    stubFetch({ transit: true });
    await queryRoutes("transit");
    const axis = screen.getByRole("button", { name: /^환승이 가장 적은 경로, / });
    const numbered = screen.getByRole("button", { name: /^대안 경로 1, / });

    fireEvent.click(axis);
    fireEvent.click(
      screen.getByRole("button", { name: "환승이 가장 적은 경로 안내 시작" }),
    );
    // 세션 대안의 접힘 클릭은 기록조차 되지 않는다(패널 unmount = 세션 소멸).
    fireEvent.click(axis);
    expect(axis.getAttribute("aria-expanded")).toBe("true");
    // 표시 번호(없음/1/2)와 배열 인덱스(0/1/2)가 어긋나 있어도 다른 대안은 정상 토글.
    fireEvent.click(numbered);
    expect(numbered.getAttribute("aria-expanded")).toBe("true");
    expect(axis.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(numbered);
    expect(numbered.getAttribute("aria-expanded")).toBe("false");
    expect(axis.getAttribute("aria-expanded")).toBe("true");
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Place } from "@/lib/types";

/**
 * 수단별 안내 진입점 게이트 상태 행렬(B1 스펙 §3.1·§8.4):
 * {도보 성공/실패} × {자동차 tmap/kakao/실패} × {로케일 ko/en} 대표 조합에서
 * 시작 버튼·간략 폴백 노출을 단언한다. 세션 동작은 useRouteGuide.car.test가,
 * 판정은 리듀서 fixture가 잠그므로 여기서는 노출 게이트만 본다.
 */
let mockLocale = "ko";
vi.mock("next-intl", () => ({
  // `name` 인자를 이름에 반영한다 — 대중교통 시작 버튼은 추천·대안이 **같은 키**를
  // 쓰고 경로 이름만 다르므로(2026-08-07 컨트롤 통일), 키만 반환하면 둘을 구분할 수
  // 없어 "추천 버튼이 대안으로 세어지는" 변이를 통과시킨다.
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values && "name" in values ? `${key}:${String(values.name)}` : key,
  useLocale: () => mockLocale,
}));
vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({ status: "error" as const })),
  getGeolocationSnapshot: () => ({ status: "idle" as const }),
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
vi.mock("../WalkRouteBriefing", () => ({ WalkRouteResult: () => null }));
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

const CAR_OK = {
  distanceMeters: 12000,
  durationSeconds: 1400,
  taxiFare: 14000,
  tollFare: 0,
  guides: [{ name: "", guidance: "직진", distanceMeters: 0, durationSeconds: 0 }],
};
const WALK_OK = {
  result: {
    distanceMeters: 2000,
    durationSeconds: 1700,
    steps: [{ description: "직진 2km 이동" }],
  },
};

// 탑승 leg 1개(수도권 지하철, stops 포함) — transit 시작 게이트의 성립 조합.
const TRANSIT_OK = {
  result: {
    recommended: {
      routeKey: "p0",
      summary: { totalMinutes: 30, fare: 1550, transfers: 0, walkMinutes: 6 },
      legs: [
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
      ],
    },
    alternatives: [],
  },
};
// 도보 전용 경로 — 탑승 leg 0개라 시작 불가(§3.1).
const TRANSIT_WALK_ONLY = {
  result: {
    recommended: {
      routeKey: "p0",
      summary: { totalMinutes: 10, fare: 0, transfers: 0, walkMinutes: 10 },
      legs: [{ mode: "walk", minutes: 10 }],
    },
    alternatives: [],
  },
};

// 대안 2개: 탑승 leg 있는 대안(시작 가능) + 도보 전용 대안(시작 불가) —
// 대안별 게이트가 경로 단위로 갈리는지 본다(M5 선행분).
// routeKey는 응답 안에서 유일해야 한다(펼침·세션 추적 키). 같은 키를 나눠 쓰면
// 한 대안을 접었을 때 다른 대안이 함께 접힌다.
const TRANSIT_WITH_ALTS = {
  result: {
    recommended: TRANSIT_OK.result.recommended,
    alternatives: [
      { ...TRANSIT_OK.result.recommended, routeKey: "p1" },
      { ...TRANSIT_WALK_ONLY.result.recommended, routeKey: "p2" },
    ],
  },
};

function stubFetch(opts: {
  walk: "ok" | "fail";
  car: "tmap" | "kakao" | "fail";
  transit?: "ok" | "walkOnly" | "withAlts" | "none";
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/places")) {
        return {
          ok: true,
          json: async () => ({
            places: [gangnam],
            provider: "kakao-local",
            query: "q",
          }),
        } as Response;
      }
      if (url.startsWith("/api/address/search")) {
        return { ok: true, json: async () => ({ addresses: [] }) } as Response;
      }
      if (url.startsWith("/api/route/car")) {
        if (opts.car === "fail") return { ok: false, json: async () => ({}) } as Response;
        return {
          ok: true,
          json: async () => ({ ...CAR_OK, provider: opts.car }),
        } as Response;
      }
      if (url.startsWith("/api/route/walk")) {
        if (opts.walk === "fail") return { ok: false, json: async () => ({}) } as Response;
        return { ok: true, json: async () => WALK_OK } as Response;
      }
      if (url.startsWith("/api/transit/track")) {
        // 세션 폴링은 이 스위트의 관심사가 아니다 — 실패 응답이면 훅이
        // upstreamFailed로 정직 강등하고 세션은 유지된다(강제 펼침 테스트용).
        return { ok: false, json: async () => ({}) } as Response;
      }
      if (url.startsWith("/api/route/transit")) {
        // 길찾기 뷰 조회는 항상 경유 정류장 옵트인이어야 한다(B2 §2 경로 동일성).
        expect(url).toContain("includeStops=1");
        const body =
          opts.transit === "ok"
            ? TRANSIT_OK
            : opts.transit === "walkOnly"
              ? TRANSIT_WALK_ONLY
              : opts.transit === "withAlts"
                ? TRANSIT_WITH_ALTS
                : { result: null };
        return { ok: true, json: async () => body } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

async function queryRoutes() {
  // 안내 패널은 geolocation 미지원 환경에서 렌더 자체를 접는다(graceful) —
  // jsdom엔 없으므로 스텁으로 지원 상태를 만든다.
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
  });
  render(
    <DirectionsView canShowWalk canShowTransit canBriefCarRoute onBack={() => {}} />,
  );
  // 후보 확정 흐름은 기존 DirectionsView.test 관례(포커스 전진 → activeElement 클릭).
  fireEvent.change(screen.getByLabelText("from"), { target: { value: "강남" } });
  fireEvent.click(screen.getByRole("button", { name: "searchFrom" }));
  await waitFor(() => {
    expect(document.activeElement?.textContent).toContain("강남역,");
  });
  fireEvent.click(document.activeElement as HTMLElement);

  fireEvent.change(screen.getByLabelText("to"), { target: { value: "강남" } });
  fireEvent.click(screen.getByRole("button", { name: "searchTo" }));
  await waitFor(() => {
    expect(document.activeElement?.textContent).toContain("강남역,");
  });
  fireEvent.click(document.activeElement as HTMLElement);

  fireEvent.click(screen.getByRole("button", { name: "submit" }));
  await waitFor(() => {
    // settled(성공 유무 무관)까지 대기 — 폴백 게이트도 settled 이후에만 계산된다.
    expect(
      screen.queryByText("readySummary") ?? screen.queryByText("allFailed"),
    ).not.toBeNull();
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mockLocale = "ko";
});

// 라벨은 수단별 짧은 형(위원장 판정 2026-08-06, 공통 라벨 번복) — 세 키를 한 번에 조회.
// ⚠ 대중교통만 형태가 다르다: 경로가 복수라 버튼이 경로 disclosure 안으로 들어갔고
//   라벨이 경로 이름을 담는다. "수단 1개당 진입점 1개"에 해당하는 것은 추천 경로 버튼이다.
const GUIDE_START_NAME = /^guideStart(Walk|Car|TransitAlt:recommended)$/;
const guideStartButtons = () =>
  screen.queryAllByRole("button", { name: GUIDE_START_NAME });

describe("수단별 안내 진입점 게이트(§3.1)", () => {
  it("ko + 도보·자동차(tmap) 성공: 수단별 시작 버튼 노출, 간략 폴백 없음", async () => {
    stubFetch({ walk: "ok", car: "tmap" });
    await queryRoutes();
    expect(screen.getByRole("button", { name: "guideStartWalk" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "guideStartCar" })).toBeTruthy();
    expect(guideStartButtons()).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "briefGuideStart" })).toBeNull();
  });

  it("ko + 자동차 kakao 폴백(도보 실패): 자동차 버튼 없음 + 간략 폴백 노출", async () => {
    stubFetch({ walk: "fail", car: "kakao" });
    await queryRoutes();
    expect(guideStartButtons()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "briefGuideStart" })).toBeTruthy();
  });

  it("ko + 전 수단 실패: 목적지 확정이면 간략 폴백만 노출", async () => {
    stubFetch({ walk: "fail", car: "fail" });
    await queryRoutes();
    expect(guideStartButtons()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "briefGuideStart" })).toBeTruthy();
  });

  it("en + 자동차(tmap) 성공: 수단 안내는 ko 전용이라 간략 폴백으로 흐른다", async () => {
    mockLocale = "en";
    stubFetch({ walk: "ok", car: "tmap" });
    await queryRoutes();
    expect(guideStartButtons()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "briefGuideStart" })).toBeTruthy();
  });

  // B2 §3.1: 대중교통 게이트 = 경로 성공 ∧ ko ∧ 탑승 leg ≥ 1
  it("ko + 대중교통만 성공(탑승 leg 有): 시작 버튼 1개, 간략 폴백 없음", async () => {
    stubFetch({ walk: "fail", car: "fail", transit: "ok" });
    await queryRoutes();
    expect(screen.getByRole("button", { name: "guideStartTransitAlt:recommended" })).toBeTruthy();
    expect(guideStartButtons()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "briefGuideStart" })).toBeNull();
  });

  it("ko + 3수단 전부 시작 가능: 수단별 라벨 버튼 3개", async () => {
    stubFetch({ walk: "ok", car: "tmap", transit: "ok" });
    await queryRoutes();
    expect(guideStartButtons()).toHaveLength(3);
  });

  it("도보 전용 대중교통 경로는 시작 불가(탑승 leg 0) — 간략 폴백으로", async () => {
    stubFetch({ walk: "fail", car: "fail", transit: "walkOnly" });
    await queryRoutes();
    expect(guideStartButtons()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "briefGuideStart" })).toBeTruthy();
  });

  it("en + 대중교통 성공: ko 전용이라 버튼 없음", async () => {
    mockLocale = "en";
    stubFetch({ walk: "fail", car: "fail", transit: "ok" });
    await queryRoutes();
    expect(guideStartButtons()).toHaveLength(0);
  });

  it("대안 펼침 시 탑승 leg 있는 대안만 안내 시작 버튼(M5 선행분)", async () => {
    stubFetch({ walk: "fail", car: "fail", transit: "withAlts" });
    await queryRoutes();
    // 접힌 상태: 대안 시작 버튼 없음(추천 버튼만).
    expect(
      screen.queryAllByRole("button", { name: "guideStartTransitAlt:alternativeHeading" }),
    ).toHaveLength(0);
    const discs = screen.getAllByRole("button", { name: /alternativeHeading/ });
    expect(discs).toHaveLength(2);
    fireEvent.click(discs[0]); // 탑승 leg 있는 대안 → 버튼 노출
    expect(
      screen.getAllByRole("button", { name: "guideStartTransitAlt:alternativeHeading" }),
    ).toHaveLength(1);
    fireEvent.click(discs[1]); // 도보 전용 대안 → 게이트가 경로 단위로 차단
    expect(
      screen.getAllByRole("button", { name: "guideStartTransitAlt:alternativeHeading" }),
    ).toHaveLength(1);
  });

  it("세션 활성 중 대안 접힘 클릭은 무시되고, 중지 후에도 펼침·트리거가 산다", async () => {
    stubFetch({ walk: "fail", car: "fail", transit: "withAlts" });
    await queryRoutes();
    const discs = screen.getAllByRole("button", { name: /alternativeHeading/ });
    fireEvent.click(discs[0]);
    fireEvent.click(screen.getByRole("button", { name: "guideStartTransitAlt:alternativeHeading" }));
    // 세션 중 접힘 클릭은 기록조차 안 된다(감사 HIGH): 기록하면 중지 순간
    // 뒤늦게 접히며 중지 통지 live region과 복귀 포커스가 동반 소멸한다.
    fireEvent.click(discs[0]);
    expect(discs[0].getAttribute("aria-expanded")).toBe("true");
    const stopBtn = await screen.findByRole("button", { name: "stop" });
    fireEvent.click(stopBtn);
    // 중지 후에도 펼침 유지 — 트리거(시작 버튼)가 되살아나 포커스 복귀처가 있다.
    expect(discs[0].getAttribute("aria-expanded")).toBe("true");
    expect(
      await screen.findByRole("button", { name: "guideStartTransitAlt:alternativeHeading" }),
    ).toBeTruthy();
    // 세션이 끝난 뒤의 접기는 정상 반영된다.
    fireEvent.click(discs[0]);
    await waitFor(() => {
      expect(discs[0].getAttribute("aria-expanded")).toBe("false");
    });
  });

  it("en + 대안 펼침: 대안 시작 버튼도 ko 전용", async () => {
    mockLocale = "en";
    stubFetch({ walk: "fail", car: "fail", transit: "withAlts" });
    await queryRoutes();
    const discs = screen.getAllByRole("button", { name: /alternativeHeading/ });
    fireEvent.click(discs[0]);
    expect(
      screen.queryAllByRole("button", { name: "guideStartTransitAlt:alternativeHeading" }),
    ).toHaveLength(0);
  });
});

/**
 * 경로 목록 컨트롤 통일(위원장 요청 2026-08-07). 추천만 라벨 없이 통째로 펼쳐져
 * 있어 같은 지위의 경로들이 서로 다른 컨트롤로 보였다. 지금은 disclosure를 쌓은
 * accordion이고 **초기 펼침 상태만** 다르다.
 */
describe("대중교통 경로 목록 컨트롤", () => {
  it("추천도 대안과 같은 disclosure이고 초기 펼침만 다르다", async () => {
    stubFetch({ walk: "fail", car: "fail", transit: "withAlts" });
    await queryRoutes();
    // 추천에 라벨이 붙었고(종전엔 이름 자체가 없었다) 펼친 채로 시작한다.
    const rec = screen.getByRole("button", { name: /^recommended/ });
    expect(rec.getAttribute("aria-expanded")).toBe("true");
    // 대안은 같은 컨트롤이되 접힌 채로 시작한다.
    for (const alt of screen.getAllByRole("button", { name: /^alternativeHeading/ })) {
      expect(alt.getAttribute("aria-expanded")).toBe("false");
    }
  });

  it("추천도 접힌다 — 다른 것은 초기 상태뿐이고 동작은 대안과 같다", async () => {
    stubFetch({ walk: "fail", car: "fail", transit: "ok" });
    await queryRoutes();
    const rec = screen.getByRole("button", { name: /^recommended/ });
    // 안내 시작 버튼이 그 경로 disclosure 안에 있다 — 접으면 함께 감춰진다.
    expect(guideStartButtons()).toHaveLength(1);
    fireEvent.click(rec);
    expect(rec.getAttribute("aria-expanded")).toBe("false");
    expect(guideStartButtons()).toHaveLength(0);
  });
});

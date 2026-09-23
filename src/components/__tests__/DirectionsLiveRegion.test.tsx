// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Place } from "@/lib/types";

/**
 * A40 — 길찾기 뷰의 polite live region은 **하나뿐이다**.
 *
 * 종전엔 `DirectionsView`가 하나, 그 안의 `TransitGuidePanel`이 경로마다 하나,
 * `DistanceBeacon`이 수단마다 하나를 따로 들고 있었다. 채널이 여럿이면 한쪽은 폴
 * 타이머가, 다른 쪽은 사용자 조작이 돌리므로 겹치는 순간 발화가 경합하거나 한쪽이
 * 삼켜진다(헌장 §1 "단일 polite live region"). 이 스위트는 그 계약을 **개수**로
 * 잠그고, 재발화 여부는 문자열이 아니라 **DOM 변경 횟수**로 판정한다(같은 문장을
 * 다시 대입하면 DOM이 안 바뀌어 침묵하므로, 문자열 비교로는 침묵을 통과시킨다).
 *
 * 세션 동작·문구는 각 컴포넌트 스위트가 본다 — 여기는 채널 개수와 경유만 본다.
 */
vi.mock("next-intl", async () => {
  const m = await import("./stable-intl-mock");
  return m.stableIntlMock("ko", m.keyWithName);
});
vi.mock("@/lib/geolocation", () => ({
  // DirectionsView가 `useGeolocation`으로 스토어를 구독한다(stale-origin) — 구독 두 함수도 함께 준다.
  subscribeGeolocation: () => () => {},
  getGeolocationServerSnapshot: () => ({ status: "idle" as const }),
  awaitGeolocation: vi.fn(async () => ({ status: "error" as const })),
  getGeolocationSnapshot: ((snapshot) => () => snapshot)({ status: "idle" as const }),
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
vi.mock("../WalkRouteBriefing", () => ({ WalkRouteResult: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteResult: () => null }));
// 부근 재구성은 자기 fetch를 갖고 있어 이 스위트의 관심사 밖이다(비콘을 펼칠 때 딸려 온다).
vi.mock("../SurroundingsScene", () => ({ SurroundingsScene: () => null }));

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
  provider: "tmap",
  distanceMeters: 12000,
  durationSeconds: 1400,
  taxiFare: 14000,
  tollFare: 0,
  guides: [{ name: "", guidance: "직진", distanceMeters: 0, durationSeconds: 0 }],
};
const WALK_OK = {
  lines: [
    {
      kind: "shortest",
      route: { distanceMeters: 2000, durationSeconds: 1700, steps: [{ description: "직진 2km 이동" }] },
    },
  ],
};
const TRANSIT_RECOMMENDED = {
  routeKey: "p0",
  summary: { totalMinutes: 30, fare: 1550, transfers: 0, walkMinutes: 6 },
  legs: [
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
  ],
};
// 대안까지 펼치면 패널이 둘 마운트된다 — 종전 설계에서 region이 경로 수만큼 늘던 축.
const TRANSIT_WITH_ALTS = {
  result: {
    recommended: TRANSIT_RECOMMENDED,
    alternatives: [{ ...TRANSIT_RECOMMENDED, routeKey: "p1" }],
  },
};

function stubFetch() {
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
      if (url.startsWith("/api/route/car")) {
        return { ok: true, json: async () => CAR_OK } as Response;
      }
      if (url.startsWith("/api/route/walk")) {
        return { ok: true, json: async () => WALK_OK } as Response;
      }
      // 폴은 이 스위트의 관심사가 아니다 — 실패면 훅이 정직 강등하고 세션은 유지된다.
      if (url.startsWith("/api/transit/track")) {
        return { ok: false, json: async () => ({}) } as Response;
      }
      if (url.startsWith("/api/route/transit")) {
        return { ok: true, json: async () => TRANSIT_WITH_ALTS } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

function renderView() {
  // 안내 패널은 geolocation 미지원 환경에서 렌더 자체를 접는다(graceful).
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
  });
  return render(
    <DirectionsView canShowWalk canShowTransit canBriefCarRoute onBack={() => {}} />,
  );
}

async function resolveEndpoint(label: "from" | "to") {
  fireEvent.change(screen.getByLabelText(label), { target: { value: "강남" } });
  fireEvent.click(
    screen.getByRole("button", { name: label === "from" ? "searchFrom" : "searchTo" }),
  );
  await waitFor(() => {
    expect(document.activeElement?.textContent).toContain("강남역,");
  });
  fireEvent.click(document.activeElement as HTMLElement);
}

async function queryRoutes() {
  await resolveEndpoint("from");
  await resolveEndpoint("to");
  fireEvent.click(screen.getByRole("button", { name: "submit" }));
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toBe("readySummary");
  });
}

const liveRegions = (container: HTMLElement) =>
  container.querySelectorAll('[aria-live], [role="status"], [role="alert"]');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("A40 — 길찾기 뷰의 단일 polite 창구", () => {
  it("세 수단 결과 + 대안 패널까지 펼쳐도 live region은 하나다", async () => {
    stubFetch();
    const { container } = renderView();
    await queryRoutes();

    // 도보·자동차 비콘 트리거와 대중교통 추천 패널이 모두 마운트된 상태.
    expect(screen.getByRole("button", { name: "guideStartWalkShortest" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "guideStartCar" })).toBeTruthy();
    // 대안 disclosure를 펼쳐 패널을 하나 더 마운트한다(경로 수만큼 늘던 축).
    fireEvent.click(screen.getByRole("button", { name: /transitRouteLabel|alternative|p1/ }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /^guideStartTransitAlt/ }).length,
      ).toBeGreaterThanOrEqual(1),
    );

    expect(liveRegions(container)).toHaveLength(1);
  });

  it("안내 세션을 시작해도 채널은 그대로 하나이고, 세션 문장이 그 창구로 나온다", async () => {
    stubFetch();
    const { container } = renderView();
    await queryRoutes();

    fireEvent.click(screen.getAllByRole("button", { name: /^guideStartTransitAlt/ })[0]);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("startedAt");
    });
    expect(liveRegions(container)).toHaveLength(1);
  });

  it("세션이 도는 동안의 사용자 조작 응답도 같은 창구를 지난다 — 두 번째 채널이 생기지 않는다", async () => {
    stubFetch();
    const { container } = renderView();
    await queryRoutes();
    fireEvent.click(screen.getAllByRole("button", { name: /^guideStartTransitAlt/ })[0]);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("startedAt");
    });

    // 세션을 끊지 않는 사용자 조작(후보 검색) — 폴 타이머와 겹칠 수 있는 자리다.
    fireEvent.click(screen.getByRole("button", { name: "searchFrom" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("candidateCount");
    });
    expect(liveRegions(container)).toHaveLength(1);
  });

  it("세션 없는 패널이 새로 마운트돼도 창구에 떠 있는 문장을 지우지 않는다", async () => {
    // ⚠ 창구가 공유라 **빈 값을 게시하면 남의 문장이 지워진다**. 경로 대안마다 패널이
    // 하나씩 마운트되고 그중 세션을 쥔 것은 하나뿐이므로, 나머지의 빈 `liveMessage`가
    // 그대로 올라가면 안내 문장이 통째로 사라진다(훅의 `"" → 같은 문장` 되돌림도 같은
    // 경로다). 게시자가 빈 값을 걸러야 성립하는 계약이라 변이 주입으로 확인한 축이다.
    stubFetch();
    renderView();
    await queryRoutes();
    fireEvent.click(screen.getAllByRole("button", { name: /^guideStartTransitAlt/ })[0]);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("startedAt");
    });

    // 대안 disclosure를 펼쳐 세션 없는 패널을 하나 더 마운트한다.
    fireEvent.click(screen.getByRole("button", { name: /transitRouteLabel|alternative|p1/ }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /^guideStartTransitAlt/ }).length,
      ).toBeGreaterThanOrEqual(1),
    );
    expect(screen.getByRole("status").textContent).toContain("startedAt");
  });

  it("같은 문장을 다시 게시해도 재발화된다 — 판정은 문자열이 아니라 DOM 변경 횟수", async () => {
    stubFetch();
    renderView();
    await resolveEndpoint("from");

    const region = screen.getByRole("status");
    let mutations = 0;
    const observer = new MutationObserver((records) => {
      mutations += records.length;
    });
    observer.observe(region, { childList: true, characterData: true, subtree: true });
    try {
      // 같은 질의를 두 번 검색하면 통지 문자열이 **완전히 같다**(candidateCount).
      // 문자열만 보면 두 번째가 침묵해도 통과하므로 노드 변경으로 센다.
      fireEvent.click(screen.getByRole("button", { name: "searchFrom" }));
      await waitFor(() => expect(mutations).toBeGreaterThan(0));
      const afterFirst = mutations;
      fireEvent.click(screen.getByRole("button", { name: "searchFrom" }));
      await waitFor(() => expect(mutations).toBeGreaterThan(afterFirst));
      expect(region.textContent).toBe("candidateCount");
    } finally {
      observer.disconnect();
    }
  });
});

describe("A40 — 안내 컴포넌트는 자기 live region을 두지 않는다", () => {
  it("길찾기 뷰의 창구를 지우면 화면에 남는 live region이 0이다", async () => {
    // 회귀 가드: 패널·비콘이 자기 region을 되살리면 이 수가 0이 아니게 된다.
    stubFetch();
    const { container } = renderView();
    await queryRoutes();
    fireEvent.click(screen.getAllByRole("button", { name: /^guideStartTransitAlt/ })[0]);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("startedAt");
    });
    screen.getByRole("status").remove();
    expect(liveRegions(container)).toHaveLength(0);
  });
});

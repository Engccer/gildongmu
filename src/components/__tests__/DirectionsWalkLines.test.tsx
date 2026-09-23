// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Place } from "@/lib/types";
import messages from "../../../messages/ko.json";

/**
 * 웹 길찾기 도보 줄 목록(E42, spec 2026-09-23-walk-two-lines-kakao-design.md §3). 줄 이름·버튼
 * 문구는 위원장 TextEdit 확정 렌더 그대로다 — 이 스위트가 그 문장을 잠근다.
 */

vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({ status: "error" as const })),
  getGeolocationSnapshot: () => ({ status: "idle" as const }),
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../WalkRouteBriefing", () => ({
  // 본문에 어느 경로인지·요약 포함 여부가 드러나게 모킹한다.
  WalkRouteResult: (p: { briefing: { distanceMeters: number }; includeSummary?: boolean }) => (
    <p>{`상세 ${p.briefing.distanceMeters} summary=${String(p.includeSummary ?? true)}`}</p>
  ),
}));
// 안내 패널은 요청 축(props)만 본다 — 누르면 세션 활성으로 전이한 것처럼 부모에 알린다.
vi.mock("../DistanceBeacon", () => ({
  DistanceBeacon: (p: {
    triggerLabel?: string;
    accessible: boolean;
    variant: "shortest" | null;
    onActiveChange?: (active: boolean) => void;
  }) => (
    <button
      type="button"
      data-axis={`accessible=${String(p.accessible)} variant=${String(p.variant)}`}
      onClick={() => p.onActiveChange?.(true)}
    >
      {p.triggerLabel}
    </button>
  ),
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

function route(distanceMeters: number, minutes: number) {
  return {
    distanceMeters,
    durationSeconds: minutes * 60,
    steps: [{ description: `직진 ${distanceMeters}m` }],
  };
}
const line = (kind: string, distanceMeters: number, minutes: number) => ({
  kind,
  route: route(distanceMeters, minutes),
});

function stubFetch(body: unknown) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
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
        return { ok: true, json: async () => body } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  return calls;
}

function stubGeolocationApi() {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
  });
}

async function queryWalk() {
  stubGeolocationApi();
  render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <DirectionsView canShowWalk canShowTransit={false} canBriefCarRoute={false} onBack={() => {}} />
    </NextIntlClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("출발지"), { target: { value: "강남" } });
  fireEvent.click(screen.getByRole("button", { name: "출발지 검색" }));
  await waitFor(() => expect(document.activeElement?.textContent).toContain("강남역,"));
  fireEvent.click(document.activeElement as HTMLElement);
  fireEvent.change(screen.getByLabelText("도착지"), { target: { value: "강남" } });
  fireEvent.click(screen.getByRole("button", { name: "도착지 검색" }));
  await waitFor(() => expect(document.activeElement?.textContent).toContain("강남역,"));
  fireEvent.click(document.activeElement as HTMLElement);
  await submit();
}

async function submit() {
  fireEvent.click(screen.getByRole("button", { name: "경로 조회" }));
  await waitFor(() => {
    expect(
      screen.queryAllByText(/경로 안내가 준비되었습니다|경로를 찾지 못했습니다/).length,
    ).toBeGreaterThan(0);
  });
}

const TWO_LINES = { lines: [line("shortest", 850, 12), line("accessible", 880, 13)] };
const shortestRow = () => screen.getByRole("button", { name: "최단 경로, 총 850m, 약 12분" });
const secondRow = () => screen.getByRole("button", { name: "계단 회피 경로, 총 880m, 약 13분" });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("도보 줄 요청(E42)", () => {
  it("조회는 lines=1 단독 옵트인이다(계단 회피·경로 축·기하·옛 alternatives 없음)", async () => {
    const calls = stubFetch(TWO_LINES);
    await queryWalk();
    const url = calls.find((u) => u.startsWith("/api/route/walk"))!;
    expect(url).toContain("&lines=1");
    for (const p of ["alternatives", "includeGeometry", "accessible", "variant"]) {
      expect(url).not.toContain(p);
    }
  });
});

describe("도보 줄 목록(E42 — 위원장 확정 렌더)", () => {
  it("최단이 위(펼침), 계단 회피가 아래(접힘)", async () => {
    stubFetch(TWO_LINES);
    await queryWalk();
    expect(shortestRow().getAttribute("aria-expanded")).toBe("true");
    expect(secondRow().getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("상세 850 summary=false")).toBeTruthy();
    expect(screen.queryByText(/상세 880/)).toBeNull();
  });

  it("계단 회피 경로가 없으면 '큰길 경로' — 사유 문장을 붙이지 않는다", async () => {
    stubFetch({ lines: [line("shortest", 850, 12), line("broad", 880, 13)] });
    await queryWalk();
    // 이름 그대로가 줄 전체다(위원장이 사유 문장을 지웠다 — 복원 금지).
    expect(screen.getByRole("button", { name: "큰길 경로, 총 880m, 약 13분" })).toBeTruthy();
  });

  it("안내 시작 버튼은 줄 안에 있고 라벨이 그 줄을 이름한다(B9 ②)", async () => {
    stubFetch(TWO_LINES);
    await queryWalk();
    const shortestStart = screen.getByRole("button", { name: "최단 경로로 안내 시작" });
    expect(shortestStart.getAttribute("data-axis")).toBe("accessible=false variant=shortest");
    // 접힌 줄의 버튼은 없다 — 펼치면 나타나고 그 줄의 요청 축을 쓴다.
    expect(screen.queryByRole("button", { name: "계단 회피 경로로 안내 시작" })).toBeNull();
    fireEvent.click(secondRow());
    expect(
      screen.getByRole("button", { name: "계단 회피 경로로 안내 시작" }).getAttribute("data-axis"),
    ).toBe("accessible=true variant=null");
  });

  it("큰길 줄의 안내는 기본 파이프라인(계단 회피·최단 축 없음)", async () => {
    stubFetch({ lines: [line("shortest", 850, 12), line("broad", 880, 13)] });
    await queryWalk();
    fireEvent.click(screen.getByRole("button", { name: "큰길 경로, 총 880m, 약 13분" }));
    expect(
      screen.getByRole("button", { name: "큰길 경로로 안내 시작" }).getAttribute("data-axis"),
    ).toBe("accessible=false variant=null");
  });

  it("섹션 상단의 계단 회피 토글과 '도보 안내 시작'은 없다", async () => {
    stubFetch(TWO_LINES);
    await queryWalk();
    expect(screen.queryByRole("button", { name: "계단 회피 경로" })).toBeNull();
    expect(screen.queryByRole("button", { name: "도보 안내 시작" })).toBeNull();
  });

  it("세션이 살아 있는 줄은 접히지 않는다(접힘 unmount가 세션을 죽인다)", async () => {
    stubFetch(TWO_LINES);
    await queryWalk();
    fireEvent.click(screen.getByRole("button", { name: "최단 경로로 안내 시작" }));
    fireEvent.click(shortestRow());
    expect(shortestRow().getAttribute("aria-expanded")).toBe("true");
  });

  it("장거리 첫 줄은 문턱 판정대로 접혀서 시작한다", async () => {
    stubFetch({ lines: [line("shortest", 3000, 40), line("accessible", 3100, 42)] });
    await queryWalk();
    expect(
      screen.getByRole("button", { name: "최단 경로, 총 3km, 약 40분" }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByText(/상세 /)).toBeNull();
  });

  it("줄이 하나여도 같은 모양(이름이 성질을 말한다)", async () => {
    stubFetch({ lines: [line("shortest", 850, 12)] });
    await queryWalk();
    expect(shortestRow().getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("button", { name: /^계단 회피 경로, / })).toBeNull();
  });

  it("모르는 종류의 줄은 이름을 지어 붙이지 않고 뺀다, 줄이 없으면 경로 없음", async () => {
    stubFetch({ lines: [line("scenic", 900, 13), line("shortest", 850, 12)] });
    await queryWalk();
    expect(screen.getAllByRole("button", { name: /총 \d+m/ })).toHaveLength(1);
    cleanup();
    stubFetch({ lines: [] });
    await queryWalk();
    expect(screen.getByText(messages.route.pedestrian.noRoute)).toBeTruthy();
  });

  it("새 조회는 둘째 줄 펼침을 리셋한다(스냅샷 교체)", async () => {
    stubFetch(TWO_LINES);
    await queryWalk();
    fireEvent.click(secondRow());
    expect(secondRow().getAttribute("aria-expanded")).toBe("true");
    await submit();
    expect(secondRow().getAttribute("aria-expanded")).toBe("false");
  });
});

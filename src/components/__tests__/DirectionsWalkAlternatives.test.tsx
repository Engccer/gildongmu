// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Place } from "@/lib/types";
import messages from "../../../messages/ko.json";

/**
 * 웹 길찾기 도보 대안 2행 disclosure(B9 ①, spec 2026-08-23-web-walk-alternatives-disclosure-design.md §4).
 * `shortest` 없는 응답의 현행 동작은 DirectionsWalkCollapse 스위트가 지킨다 — 여기는
 * `alternatives=1` 요청과 `shortest`가 있을 때의 2행만 본다.
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

const NOTICE = "최단 경로에는 계단 회피가 적용되지 않습니다. 계단이 포함될 수 있습니다.";

function walk(distanceMeters: number, minutes: number, notice?: string) {
  return {
    distanceMeters,
    durationSeconds: minutes * 60,
    steps: [...(notice ? [{ description: notice }] : []), { description: `직진 ${distanceMeters}m` }],
    ...(notice ? { stepFree: "unavailable", stepFreeNotice: notice } : {}),
  };
}

type Body = { result: unknown; shortest?: unknown };

function stubFetch(body: Body) {
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
    expect(screen.queryByText(/경로 안내가 준비되었습니다/)).not.toBeNull();
  });
}

const recommended = () => screen.queryByRole("button", { name: /^추천 경로, / });
const shortest = () => screen.queryByRole("button", { name: /^최단 경로, / });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("도보 대안 요청(spec §1)", () => {
  it("도보 조회는 alternatives=1을 붙이고 기하는 요청하지 않는다", async () => {
    const calls = stubFetch({ result: walk(900, 12) });
    await queryWalk();
    const url = calls.find((u) => u.startsWith("/api/route/walk"))!;
    expect(url).toContain("alternatives=1");
    expect(url).not.toContain("includeGeometry");
  });
});

describe("도보 대안 2행 disclosure(spec §2)", () => {
  it("shortest가 있으면 추천·최단 2행이고 최단은 접혀서 시작한다", async () => {
    stubFetch({ result: walk(880, 13), shortest: walk(715, 11) });
    await queryWalk();
    const rec = screen.getByRole("button", { name: "추천 경로, 총 880m, 약 13분" });
    const sho = screen.getByRole("button", { name: "최단 경로, 총 715m, 약 11분" });
    // 13분은 문턱 이하라 추천은 펼침, 최단은 기본 접힘.
    expect(rec.getAttribute("aria-expanded")).toBe("true");
    expect(sho.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("상세 880 summary=false")).toBeTruthy();
    expect(screen.queryByText(/상세 715/)).toBeNull();
  });

  it("장거리 추천은 문턱 판정대로 접혀서 시작한다", async () => {
    stubFetch({ result: walk(3000, 40), shortest: walk(2500, 35) });
    await queryWalk();
    expect(recommended()?.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/상세 /)).toBeNull();
  });

  it("최단 행을 누르면 최단 경로의 본문이 펼쳐진다", async () => {
    stubFetch({ result: walk(880, 13), shortest: walk(715, 11) });
    await queryWalk();
    fireEvent.click(shortest()!);
    expect(shortest()?.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("상세 715 summary=false")).toBeTruthy();
  });

  it("shortest가 null이거나 없으면 최단 행을 그리지 않고 단일 경로 화면이다", async () => {
    stubFetch({ result: walk(900, 12), shortest: null });
    await queryWalk();
    expect(shortest()).toBeNull();
    expect(recommended()).toBeNull(); // 대안이 없으면 "추천" 라벨도 없다(현행 평문).
    expect(screen.getByText("상세 900 summary=true")).toBeTruthy();
    cleanup();

    stubFetch({ result: walk(900, 12) });
    await queryWalk();
    expect(shortest()).toBeNull();
    expect(recommended()).toBeNull();
  });

  it("stepFreeNotice는 両행 라벨에 쉼표로 병기된다", async () => {
    stubFetch({ result: walk(880, 13, "계단 없는 경로를 찾지 못해 일반 경로로 안내합니다."), shortest: walk(715, 11, NOTICE) });
    await queryWalk();
    expect(
      screen.getByRole("button", {
        name: "추천 경로, 총 880m, 약 13분, 계단 없는 경로를 찾지 못해 일반 경로로 안내합니다.",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: `최단 경로, 총 715m, 약 11분, ${NOTICE}` })).toBeTruthy();
  });

  it("단일 경로 장거리 disclosure 라벨에도 stepFreeNotice가 병기된다", async () => {
    stubFetch({ result: walk(3000, 40, "계단 없는 경로를 찾지 못해 일반 경로로 안내합니다.") });
    await queryWalk();
    expect(
      screen.getByRole("button", {
        name: "총 3km, 약 40분, 계단 없는 경로를 찾지 못해 일반 경로로 안내합니다.",
      }),
    ).toBeTruthy();
  });

  it("새 조회는 최단 행 펼침을 리셋한다(스냅샷 교체)", async () => {
    stubFetch({ result: walk(880, 13), shortest: walk(715, 11) });
    await queryWalk();
    fireEvent.click(shortest()!);
    expect(shortest()?.getAttribute("aria-expanded")).toBe("true");
    await submit();
    expect(shortest()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("계단 회피 토글·안내 시작 버튼은 2행 밖 섹션 상단에 남는다", async () => {
    stubFetch({ result: walk(3000, 40), shortest: walk(2500, 35) });
    await queryWalk();
    expect(screen.getByRole("button", { name: "계단 회피 경로" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "도보 안내 시작" })).toBeTruthy();
  });
});

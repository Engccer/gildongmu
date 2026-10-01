// @vitest-environment jsdom
/**
 * A53 — en 세션에서 WebMCP 계획 투영(`plan_directions`의 `legLines`)이 화면 브리핑과 같은 문장을 내는가.
 * 실제 en 문구 카탈로그로 렌더해 도구 출력과 화면 줄을 나란히 대조한다(①끝점 라틴 표기 운반, ③탑승 줄 영문).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import type { Place, TransitRouteResult } from "@/lib/types";
import { __resetGuideSessionStoreForTest } from "@/lib/guide-session-store";
import type { WebMcpTool } from "@/lib/webmcp/types";
import { __resetViewRegistryForTest, bridgeOf } from "@/lib/webmcp/view-registry";
import { __resetToolBudgetForTest } from "@/lib/webmcp/tool-budget";
import { buildAppTools } from "@/lib/webmcp/tools";
import { __resetToolLockForTest } from "@/lib/webmcp/tool-lock";

vi.mock("@/lib/geolocation", () => ({
  subscribeGeolocation: () => () => {},
  getGeolocationServerSnapshot: () => ({ status: "idle" as const }),
  awaitGeolocation: vi.fn(async () => ({ status: "ready" as const, coords: { lat: 37.53, lng: 127.12, at: Date.now() / 1000 } })),
  getGeolocationSnapshot: ((snapshot) => () => snapshot)({ status: "ready" as const, coords: { lat: 37.53, lng: 127.12 } }),
  DIRECTIONS_ORIGIN_MAX_AGE_SECONDS: 180,
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../DistanceBeacon", () => ({ DistanceBeacon: () => null }));
vi.mock("../TransitGuidePanel", () => ({ TransitGuidePanel: () => null }));

import { DirectionsView } from "../DirectionsView";

const tower: Place = {
  id: "p63",
  name: "63빌딩",
  nameRoman: "63bilding",
  category: "랜드마크",
  address: "서울 영등포구 여의도동 60",
  roadAddress: "서울 영등포구 63로 50",
  lat: 37.5198,
  lng: 126.9403,
};

/** `englishNames` = 서버가 영문 조각을 다 실었는가(영어 줄) — 아니면 이름이 한국어인 줄이다. */
let englishNames = true;
function transitFixture(): TransitRouteResult {
  const english = {
    routeKey: "r0",
    summary: { totalMinutes: 40, fare: 1500, transfers: 0, walkMinutes: 7 },
    legs: [
      { mode: "walk", toName: "강동", toNameEn: "Gangdong", distanceMeters: 300, minutes: 4 },
      {
        mode: "subway",
        lineName: "수도권 5호선",
        lineNameEn: "Line 5",
        fromName: "강동",
        fromNameEn: "Gangdong",
        toName: "여의도",
        toNameEn: "Yeouido",
        stationCount: 12,
        minutes: 25,
      },
      { mode: "walk", distanceMeters: 200, minutes: 3 },
    ],
  };
  const korean = {
    routeKey: "r1",
    summary: { totalMinutes: 45, fare: 1500, transfers: 0, walkMinutes: 7 },
    legs: [
      { mode: "walk", toName: "강동", distanceMeters: 300, minutes: 4 },
      { mode: "subway", lineName: "수도권 5호선", fromName: "강동", toName: "여의도", stationCount: 12, minutes: 25 },
      { mode: "walk", distanceMeters: 200, minutes: 3 },
    ],
  };
  return {
    recommended: englishNames ? english : korean,
    alternatives: [],
    totalCandidates: 1,
  } as unknown as TransitRouteResult;
}

const json = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body }) as Response;

beforeEach(() => {
  __resetGuideSessionStoreForTest();
  __resetViewRegistryForTest();
  __resetToolLockForTest();
  __resetToolBudgetForTest();
  englishNames = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/places/entrance")) return json({ entrance: null });
      if (url.startsWith("/api/places")) return json({ places: [tower], provider: "kakao-local", query: "q" });
      if (url.startsWith("/api/address/search")) return json({ addresses: [] });
      if (url.startsWith("/api/route/transit")) return json({ result: transitFixture() });
      if (url.startsWith("/api/geocode/reverse")) return json({});
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  Object.defineProperty(document, "modelContext", { configurable: true, value: { registerTool: vi.fn(async () => {}) } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "modelContext");
});

async function planLines(): Promise<{ tool: string[]; screen: string[] }> {
  const view = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DirectionsView canShowWalk={false} canShowTransit canBriefCarRoute={false} onBack={() => {}} />
    </NextIntlClientProvider>,
  );
  await waitFor(() => expect(bridgeOf("directions")).not.toBeNull());
  const tool = buildAppTools({ hasWalk: false, hasTransit: true, hasCar: false, canShowSubway: true, canShowBarrierFree: true }).find(
    (t: WebMcpTool) => t.name === "plan_directions",
  )!;
  const out = JSON.parse(await tool.execute({ to: "63빌딩" }, {})) as {
    ok: boolean;
    transit: { recommended: { legLines: string[] } };
  };
  expect(out.ok).toBe(true);
  // 같은 조회의 화면 브리핑(추천은 펼친 채 시작). 하차 줄(<p>)·시각 전용 괄호 병기는 도구 줄에 없어 뺀다.
  const screen = [...view.container.querySelectorAll("ol")[0].querySelectorAll(":scope > li")].map((li) =>
    [...li.childNodes]
      .filter((n) => !(n instanceof HTMLElement && (n.tagName === "P" || n.getAttribute("aria-hidden") === "true")))
      .map((n) => n.textContent)
      .join(""),
  );
  return { tool: out.transit.recommended.legLines, screen };
}

describe("plan_directions — en 계획 투영(A53)", () => {
  it("영문이 다 있으면 탑승 줄은 화면처럼 영문이고, 마지막 도보는 끝점 라틴 표기를 싣는다(③·①)", async () => {
    const { tool, screen } = await planLines();
    expect(tool).toEqual([
      "Walk 4 min to Gangdong, 300m",
      "Board Line 5 at Gangdong, 12 stops",
      "Walk 3 min to 63bilding, 200m",
    ]);
    expect(screen).toEqual(tool);
  });

  it("영문이 없으면 도보·탑승 줄 모두 이름이 한국어이고(문장 틀은 영어, 앱과 같은 문장) 화면과 같다", async () => {
    englishNames = false;
    const { tool, screen } = await planLines();
    expect(tool).toEqual([
      "Walk 4 min to 강동, 300m",
      "Board 수도권 5호선 at 강동, 12 stops",
      "Walk 3 min to 63bilding, 200m",
    ]);
    expect(screen).toEqual(tool);
  });
});

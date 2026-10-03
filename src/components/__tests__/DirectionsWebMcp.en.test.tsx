// @vitest-environment jsdom
/**
 * A53 — en 세션에서 WebMCP 계획 투영(`plan_directions`의 `legLines`)이 화면 브리핑과 같은 문장을 내는가.
 * 실제 en 문구 카탈로그로 렌더해 도구 출력과 화면 줄을 나란히 대조한다(①끝점 라틴 표기 운반, ③탑승 줄 영문).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import type { JusoAddress, Place, TransitRouteResult } from "@/lib/types";
import { __resetGuideSessionStoreForTest } from "@/lib/guide-session-store";
import { parseDir } from "@/lib/directions-state";
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

const juso: JusoAddress = {
  roadAddr: "서울특별시 강동구 성내로 12 (성내동)",
  roadAddrPart1: "서울특별시 강동구 성내로 12",
  jibunAddr: "서울특별시 강동구 성내동 540",
  engAddr: "12 Seongnae-ro, Gangdong-gu, Seoul",
  zipNo: "05397",
  bdNm: "",
};
/** 후보 검색 응답(테스트마다 바꾼다). */
let places: Place[] = [tower];
let addresses: JusoAddress[] = [];

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
  places = [tower];
  addresses = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/places/entrance")) return json({ entrance: null });
      if (url.startsWith("/api/places")) return json({ places, provider: "kakao-local", query: "q" });
      if (url.startsWith("/api/address/search")) return json({ addresses });
      if (url.startsWith("/api/geocode?")) return json({ matches: [{ lat: 37.53, lng: 127.13 }] });
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
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  Reflect.deleteProperty(document, "modelContext");
});

async function planLines(to = "63빌딩"): Promise<{ tool: string[]; screen: string[]; resolvedTo: string }> {
  const view = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DirectionsView canShowWalk={false} canShowTransit canBriefCarRoute={false} onBack={() => {}} />
    </NextIntlClientProvider>,
  );
  await waitFor(() => expect(bridgeOf("directions")).not.toBeNull());
  const tool = buildAppTools({ hasWalk: false, hasTransit: true, hasCar: false, canShowSubway: true, canShowBarrierFree: true }).find(
    (t: WebMcpTool) => t.name === "plan_directions",
  )!;
  const out = JSON.parse(await tool.execute({ to }, {})) as {
    ok: boolean;
    transit: { recommended: { legLines: string[] } };
    resolved: { to: string };
  };
  expect(out.ok).toBe(true);
  // 같은 조회의 화면 브리핑(추천은 펼친 채 시작). 하차 줄(<p>)·시각 전용 괄호 병기는 도구 줄에 없어 뺀다.
  const screen = [...view.container.querySelectorAll("ol")[0].querySelectorAll(":scope > li")].map((li) =>
    [...li.childNodes]
      .filter((n) => !(n instanceof HTMLElement && (n.tagName === "P" || n.getAttribute("aria-hidden") === "true")))
      .map((n) => n.textContent)
      .join(""),
  );
  return { tool: out.transit.recommended.legLines, screen, resolvedTo: out.resolved.to };
}

describe("plan_directions — en 계획 투영(A53)", () => {
  it("영문이 다 있으면 탑승 줄은 화면처럼 영문이고, 마지막 도보는 끝점 라틴 표기를 싣는다(③·①)", async () => {
    const { tool, screen, resolvedTo } = await planLines();
    expect(tool).toEqual([
      "Walk 4 min to Gangdong, 300m",
      "Board Line 5 at Gangdong, 12 stops",
      "Walk 3 min to 63bilding, 200m",
    ]);
    expect(screen).toEqual(tool);
    // 같은 출력 안에서 끝점과 마지막 도보 줄이 같은 장소를 같은 이름으로 부른다(A53 후속 ⓑ).
    expect(resolvedTo).toBe("63bilding");
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

  it("주소 후보로 고른 목적지는 juso 영문 주소를 싣는다", async () => {
    places = [];
    addresses = [juso];
    const { tool, screen } = await planLines("성내로 12");
    expect(tool.at(-1)).toBe("Walk 3 min to 12 Seongnae-ro, Gangdong-gu, Seoul, 200m");
    expect(screen).toEqual(tool);
  });
});

/** 화면 경로(도구 없이): 끝점을 만드는 자리마다 라틴 표기가 끝까지 운반되는가(A53 ①). */
describe("화면 끝점의 라틴 표기 운반(A53 ①)", () => {
  function renderView() {
    return render(
      <NextIntlClientProvider locale="en" messages={en}>
        <DirectionsView canShowWalk={false} canShowTransit canBriefCarRoute={false} onBack={() => {}} />
      </NextIntlClientProvider>,
    );
  }
  /** 화면이 쓴 `?dir=`을 같은 파서로 되읽은 도착지 라틴 표기. */
  const urlToRoman = () => {
    const to = parseDir(new URLSearchParams(window.location.search).get("dir"))?.to;
    return to?.kind === "place" ? to.labelRoman : undefined;
  };
  const lastLine = (c: HTMLElement) => [...c.querySelectorAll("ol")[0].querySelectorAll(":scope > li")].at(-1)?.textContent;

  it("장소 후보 확정 → 최근 기록·?dir=·브리핑 마지막 도보 줄", async () => {
    const view = renderView();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "63빌딩" } });
    fireEvent.click(screen.getByRole("button", { name: "Search destination" }));
    fireEvent.click(await screen.findByRole("button", { name: /^63bilding/ }));
    await waitFor(() => expect(urlToRoman()).toBe("63bilding"));
    expect(JSON.parse(window.localStorage.getItem("gildongmu:recent-endpoints-to:v1") ?? "[]")[0]).toMatchObject({
      label: "63빌딩",
      labelRoman: "63bilding",
    });
    fireEvent.click(screen.getByRole("button", { name: "Get routes" }));
    await waitFor(() => expect(lastLine(view.container)).toBe("Walk 3 min to 63bilding, 200m"));
    // 조회가 기록한 최근 경로에도 실린다.
    expect(JSON.parse(window.localStorage.getItem("gildongmu:recent-routes:v1") ?? "[]")[0].to).toMatchObject({
      labelRoman: "63bilding",
    });
  });

  it("주소 후보 확정 → juso 영문 주소가 끝점 라틴 표기로", async () => {
    places = [];
    addresses = [juso];
    const view = renderView();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "성내로 12" } });
    fireEvent.click(screen.getByRole("button", { name: "Search destination" }));
    fireEvent.click(await screen.findByRole("button", { name: /^12 Seongnae-ro/ }));
    await waitFor(() => expect(urlToRoman()).toBe("12 Seongnae-ro, Gangdong-gu, Seoul"));
    fireEvent.click(screen.getByRole("button", { name: "Get routes" }));
    await waitFor(() => expect(lastLine(view.container)).toBe("Walk 3 min to 12 Seongnae-ro, Gangdong-gu, Seoul, 200m"));
  });

  it("최근 장소 버튼 → 저장된 라틴 표기를 끝점에 싣는다", async () => {
    window.localStorage.setItem(
      "gildongmu:recent-endpoints-to:v1",
      JSON.stringify([{ label: "63빌딩", lat: 37.5198, lng: 126.9403, pinned: false, labelRoman: "63bilding" }]),
    );
    renderView();
    // 버튼 이름은 저장된 라틴 표기(원명은 시각 괄호 — 접근 가능한 이름에서 빠진다, A53 후속 ⓑ).
    const button = await screen.findByRole("button", { name: "63bilding" });
    expect(button.textContent).toBe("63bilding (63빌딩)");
    fireEvent.click(button);
    await waitFor(() => expect(urlToRoman()).toBe("63bilding"));
  });

  it("최근 경로 활성화 → 저장된 라틴 표기로 조회한다", async () => {
    window.localStorage.setItem(
      "gildongmu:recent-routes:v1",
      JSON.stringify([{ from: null, to: { label: "63빌딩", lat: 37.5198, lng: 126.9403, labelRoman: "63bilding" } }]),
    );
    const view = renderView();
    fireEvent.click(await screen.findByRole("button", { name: /^Route from .* to 63bilding$/ }));
    await waitFor(() => expect(lastLine(view.container)).toBe("Walk 3 min to 63bilding, 200m"));
  });
});

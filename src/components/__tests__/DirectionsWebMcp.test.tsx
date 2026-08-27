// @vitest-environment jsdom
/**
 * WebMCP 도구층 × 길찾기 뷰 계약(W2 spec 2026-08-29 §3.4·§3.5·§5.2). 결정론적 deferred Promise로
 * 경합을 재현한다. 안내 진입점은 트리거 버튼 + 세션 점유만 흉내 낸다(jsdom에 geolocation 없음).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import type { CarRouteBriefing, JusoAddress, Place, TransitRouteResult, WalkRouteBriefing } from "@/lib/types";
import {
  __resetGuideSessionStoreForTest,
  claimGuideSession,
  hasActiveGuideSession,
  releaseGuideSession,
} from "@/lib/guide-session-store";
import type { WebMcpTool } from "@/lib/webmcp/types";
import { __resetViewRegistryForTest, bridgeOf } from "@/lib/webmcp/view-registry";
import { __resetToolBudgetForTest } from "@/lib/webmcp/tool-budget";
import { buildAppTools } from "@/lib/webmcp/tools";
import { __resetToolLockForTest } from "@/lib/webmcp/tool-lock";

vi.mock("next-intl", () => {
  const t = (key: string) => key;
  Object.assign(t, { markup: (key: string) => key, rich: (key: string) => key, raw: (key: string) => key, has: () => true });
  return { useTranslations: () => t, useLocale: () => "ko" };
});
vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({ status: "ready" as const, coords: { lat: 37.53, lng: 127.12, at: Date.now() / 1000 } })),
  getGeolocationSnapshot: () => ({ status: "ready" as const, coords: { lat: 37.53, lng: 127.12 } }),
  DIRECTIONS_ORIGIN_MAX_AGE_SECONDS: 180,
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
// 사용자 시작·중지 버튼: 세션 점유만 흉내 낸다(실제 컴포넌트의 claim/release 자리와 같다).
vi.mock("../DistanceBeacon", () => ({
  DistanceBeacon: ({ triggerLabel }: { triggerLabel?: string }) => {
    const [open, setOpen] = useState(false);
    // claim/release는 정체성 비교라 stop 함수는 마운트 동안 하나여야 한다(실제 훅의 `sessionStopRef` 동형).
    const stopRef = useRef(() => setOpen(false));
    const stop = stopRef.current;
    return (
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            releaseGuideSession(stop);
            stop();
            return;
          }
          claimGuideSession(stop);
          setOpen(true);
        }}
      >
        {open ? "stop" : triggerLabel}
      </button>
    );
  },
}));
vi.mock("../TransitGuidePanel", () => ({
  TransitGuidePanel: ({ triggerLabel }: { triggerLabel: string }) => <button type="button">{triggerLabel}</button>,
}));

import { DirectionsView } from "../DirectionsView";

const gangnam: Place = {
  id: "p1",
  name: "강남역",
  category: "지하철역",
  address: "서울 강남구 역삼동 858",
  roadAddress: "서울 강남구 강남대로 396",
  lat: 37.497,
  lng: 127.027,
};
const gangnam2: Place = { ...gangnam, id: "p2", name: "강남역 2호선", lat: 37.4971, lng: 127.0271 };
const juso: JusoAddress = {
  roadAddr: "서울특별시 강동구 성내로 12 (성내동)",
  roadAddrPart1: "서울특별시 강동구 성내로 12",
  jibunAddr: "서울특별시 강동구 성내동 540",
  engAddr: "12 Seongnae-ro, Gangdong-gu, Seoul",
  zipNo: "05397",
  bdNm: "",
};

function transitFixture(): TransitRouteResult {
  const route = (i: number) =>
    ({
      routeKey: `r${i}`,
      summary: { totalMinutes: 40 + i, fare: 1500, transfers: 1, walkMinutes: 8 },
      legs: [
        { mode: "walk", toName: "강동역", distanceMeters: 300, minutes: 4 },
        { mode: "subway", lineName: "수도권 5호선", fromName: "강동역", toName: "광화문역", stationCount: 12, minutes: 25 },
        { mode: "walk", distanceMeters: 200, minutes: 3 },
      ],
      highlight: i === 1 ? ["fastest"] : undefined,
      displayIndex: i === 2 ? 1 : undefined,
    }) as unknown as TransitRouteResult["recommended"];
  return { recommended: route(0), alternatives: [route(1), route(2)], totalCandidates: 3 };
}
function walkFixture(durationSeconds = 1200): WalkRouteBriefing {
  return {
    distanceMeters: 1500,
    durationSeconds,
    steps: [{ description: "첫째 안내" }, { description: "둘째 안내" }, { description: "셋째 안내" }],
  } as unknown as WalkRouteBriefing;
}
function carFixture(): CarRouteBriefing {
  return {
    distanceMeters: 5000,
    durationSeconds: 900,
    taxiFare: 8000,
    tollFare: 0,
    provider: "tmap",
    guides: [
      { name: "출발지", guidance: "출발", distanceMeters: 0 },
      { name: "강남대로", guidance: "우회전", distanceMeters: 300 },
    ],
  } as unknown as CarRouteBriefing;
}

type Deferred = { promise: Promise<Response>; resolve: (r: Response) => void };
function deferred(): Deferred {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}
const json = (body: unknown, ok = true): Response => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response;

function stubFetch(opts: {
  places?: Place[];
  addresses?: JusoAddress[];
  walk?: WalkRouteBriefing | null;
  deferTransit?: Deferred;
} = {}) {
  const places = opts.places ?? [gangnam];
  const addresses = opts.addresses ?? [];
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("/api/places/entrance")) return json({ entrance: null });
      if (url.startsWith("/api/places")) return json({ places, provider: "kakao-local", query: "q" });
      if (url.startsWith("/api/address/search")) return json({ addresses });
      if (url.startsWith("/api/route/transit")) {
        if (opts.deferTransit) return opts.deferTransit.promise;
        return json({ result: transitFixture() });
      }
      if (url.startsWith("/api/route/walk")) return json({ result: opts.walk === undefined ? walkFixture() : opts.walk, shortest: null });
      if (url.startsWith("/api/route/car")) return json(carFixture());
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  return calls;
}

/**
 * W2: 길찾기 뷰는 도구를 등록하지 않고 브릿지를 게시한다. 이 스위트는 게시된 브릿지로 W1 승계
 * 도구를 조립해 같은 계약(조회·세대·페이지)을 검증한다. `registerTool` 목은 "등록 0"을 단언하는 데만 쓴다.
 */
function installModelContext() {
  const tools = new Map<string, WebMcpTool>();
  const registerTool = vi.fn(async () => {});
  Object.defineProperty(document, "modelContext", { configurable: true, value: { registerTool } });
  const call = async (name: string, input: Record<string, unknown> = {}, signal?: AbortSignal) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`tool not built: ${name}`);
    return JSON.parse(await tool.execute(input, { signal })) as Record<string, unknown> & { ok: boolean };
  };
  return { registerTool, tools, call };
}

function renderView() {
  return render(<DirectionsView canShowWalk canShowTransit canBriefCarRoute onBack={() => {}} />);
}

async function ready(ctx: ReturnType<typeof installModelContext>) {
  await waitFor(() => expect(bridgeOf("directions")).not.toBeNull());
  // 길찾기 뷰가 이미 게시돼 있으므로 도구는 이동 없이 그 브릿지를 읽는다.
  for (const tool of buildAppTools({ hasWalk: true, hasTransit: true, hasCar: true, canShowSubway: true, canShowBarrierFree: true })) ctx.tools.set(tool.name, tool);
}

/** 쿨다운(3초)을 지나기 위해 시계만 앞당긴다(타이머는 실시간 — waitFor·MutationObserver 유지). */
function advanceClock(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

beforeEach(() => {
  __resetGuideSessionStoreForTest();
  __resetViewRegistryForTest();
  __resetToolLockForTest();
  __resetToolBudgetForTest();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "modelContext");
});

describe("게시 수명(W2 spec §5.2)", () => {
  it("마운트에 브릿지를 게시하고 도구는 등록하지 않으며, 언마운트에 철회한다", async () => {
    stubFetch();
    const ctx = installModelContext();
    const view = renderView();
    await ready(ctx);
    expect(bridgeOf("directions")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("to"), { target: { value: "강남" } });
    await new Promise((r) => setTimeout(r, 10));
    expect(ctx.registerTool).toHaveBeenCalledTimes(0);
    view.unmount();
    expect(bridgeOf("directions")).toBeNull();
  });
});

describe("read_current_view", () => {
  it("결과 전: phase idle·plan null·필드", async () => {
    stubFetch();
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    const out = await ctx.call("read_current_view");
    expect(out).toEqual({
      ok: true,
      view: "directions",
      phase: "idle",
      plan: null,
      fields: { from: "currentLocation", to: "", via: null, avoidStairs: false },
      guidanceActive: false,
    });
  });
});

describe("plan_directions", () => {
  it("후보가 여럿이고 정확 일치가 없으면 조회 없이 needsDisambiguation, candidateId로 재호출하면 settled + planId + 3수단 요약", async () => {
    const calls = stubFetch({ places: [gangnam, gangnam2], addresses: [juso] });
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    const first = await ctx.call("plan_directions", { to: "강남" });
    expect(first).toMatchObject({ ok: false, reason: "needsDisambiguation", field: "to" });
    const candidates = first.candidates as Array<{ candidateId: string; label: string; address: string }>;
    expect(candidates.map((c) => c.label)).toEqual(["강남역", "강남역 2호선", juso.roadAddr]);
    expect(calls.some((u) => u.startsWith("/api/route/"))).toBe(false);
    advanceClock(4_000);
    const out = await ctx.call("plan_directions", { to: "강남", toCandidateId: candidates[0].candidateId });
    expect(out.ok).toBe(true);
    expect(out.planId).toBe("p1");
    expect(out.resolved).toEqual({ from: "currentLocation", to: "강남역", via: null, avoidStairs: false });
    expect(out.transit).toMatchObject({ outcome: "done", totalCandidates: 3 });
    const transit = out.transit as { recommended: { routeKey: string; legLines: string[] }; alternatives: Array<{ routeKey: string; highlight?: string[] }> };
    expect(transit.recommended.routeKey).toBe("r0");
    expect(transit.recommended.legLines).toHaveLength(3);
    expect(transit.alternatives.map((a) => a.routeKey)).toEqual(["r1", "r2"]);
    expect(transit.alternatives[0].highlight).toEqual(["fastest"]);
    expect(out.walk).toMatchObject({ outcome: "done", stepCount: 3, distanceMeters: 1500 });
    expect(out.car).toMatchObject({ outcome: "done", guideCount: 2 });
    // 완전 교체: 화면 필드가 도구 요청으로 바뀌었다.
    expect((screen.getByLabelText("to") as HTMLInputElement).value).toBe("강남역");
    // 좌표는 출력 어디에도 없다.
    expect(JSON.stringify(out)).not.toMatch(/\d{2,3}\.\d{4,}/);
  });

  it("후보가 하나면 자동 채택하고, 쿨다운 안 재호출은 cooldown이다", async () => {
    stubFetch({ places: [gangnam] });
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    const out = await ctx.call("plan_directions", { to: "강남역" });
    expect(out.ok).toBe(true);
    const again = await ctx.call("plan_directions", { to: "강남역" });
    expect(again).toMatchObject({ ok: false, reason: "cooldown", retryable: true });
    expect(typeof again.retryAfterMs).toBe("number");
  });

  it("조회 진행 중 두 번째 호출은 busy(reject-while-busy), 첫 호출은 그대로 완료된다", async () => {
    const defer = deferred();
    stubFetch({ deferTransit: defer });
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    const firstPromise = ctx.call("plan_directions", { to: "강남역" });
    await waitFor(() => expect(screen.getByRole("button", { name: "submit" }).getAttribute("aria-busy")).toBe("true"));
    advanceClock(4_000);
    const second = await ctx.call("plan_directions", { to: "강남역" });
    expect(second).toMatchObject({ ok: false, reason: "busy", retryable: true });
    defer.resolve(json({ result: transitFixture() }));
    const first = await firstPromise;
    expect(first.ok).toBe(true);
    expect(first.planId).toBe("p1");
  });

  it("언마운트는 대기 중 호출을 aborted로 끝낸다", async () => {
    const defer = deferred();
    stubFetch({ deferTransit: defer });
    const ctx = installModelContext();
    const view = renderView();
    await ready(ctx);
    const pending = ctx.call("plan_directions", { to: "강남역" });
    await waitFor(() => expect(screen.getByRole("button", { name: "submit" }).getAttribute("aria-busy")).toBe("true"));
    view.unmount();
    const out = await pending;
    expect(out).toMatchObject({ ok: false, reason: "aborted" });
  });

  it("도착지 후보가 없으면 toNotFound, 조회는 실행하지 않는다", async () => {
    const calls = stubFetch({ places: [], addresses: [] });
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    const out = await ctx.call("plan_directions", { to: "없는곳" });
    expect(out).toMatchObject({ ok: false, reason: "toNotFound", retryable: false });
    expect(calls.some((u) => u.startsWith("/api/route/"))).toBe(false);
  });

  it("사용자가 시작한 안내가 살아 있으면 세션을 끊지 않고 sessionActive, 사용자가 중지한 뒤에는 조회된다", async () => {
    stubFetch();
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    expect((await ctx.call("plan_directions", { to: "강남역" })).ok).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "guideStartWalk" }));
    expect(hasActiveGuideSession()).toBe(true);
    advanceClock(4_000);
    expect(await ctx.call("plan_directions", { to: "강남역" })).toMatchObject({ ok: false, reason: "sessionActive", userActionRequired: true });
    expect(hasActiveGuideSession()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "stop" }));
    expect(hasActiveGuideSession()).toBe(false);
    advanceClock(4_000);
    expect((await ctx.call("plan_directions", { to: "강남역" })).ok).toBe(true);
  });

  it("도구 조회는 결과 안에 있던 커서를 조회 버튼으로 먼저 옮긴다", async () => {
    stubFetch();
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    expect((await ctx.call("plan_directions", { to: "강남역" })).ok).toBe(true);
    // 조회 완료 착지(첫 성공 수단 heading, rAF)가 끝나 커서가 결과 영역 안에 있는 상태.
    const heading = document.querySelector<HTMLElement>("h3[tabindex='-1']")!;
    await waitFor(() => expect(document.activeElement).toBe(heading));
    // 둘째 조회는 대중교통 응답을 붙들어 in-flight로 둔다 — 정착 착지가 선점을 덮기 전에 관측한다.
    const defer = deferred();
    stubFetch({ deferTransit: defer });
    advanceClock(4_000);
    const pending = ctx.call("plan_directions", { to: "강남역" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "submit" })));
    defer.resolve(json({ result: transitFixture() }));
    const out = await pending;
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true });
  });
});

describe("planId 세대·페이지 도구", () => {
  async function planned(ctx: ReturnType<typeof installModelContext>) {
    const out = await ctx.call("plan_directions", { to: "강남역" });
    expect(out.ok).toBe(true);
    return out.planId as string;
  }

  it("재조회 뒤 옛 planId는 stalePlan, 새 planId는 통과한다", async () => {
    stubFetch();
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    const p1 = await planned(ctx);
    advanceClock(4_000);
    const p2 = await planned(ctx);
    expect(p2).not.toBe(p1);
    expect(await ctx.call("get_route_steps", { planId: p1, mode: "walk" })).toMatchObject({ ok: false, reason: "stalePlan", retryable: true });
    const steps = await ctx.call("get_route_steps", { planId: p2, mode: "walk", limit: 2 });
    expect(steps).toMatchObject({ ok: true, outcome: "done", total: 3, offset: 0, returnedCount: 2, nextOffset: 2 });
    expect(steps.steps).toEqual([
      { n: 1, text: "첫째 안내" },
      { n: 2, text: "둘째 안내" },
    ]);
    const rest = await ctx.call("get_route_steps", { planId: p2, mode: "walk", offset: 2 });
    expect(rest).toMatchObject({ returnedCount: 1, nextOffset: null });
    const car = await ctx.call("get_route_steps", { planId: p2, mode: "car" });
    expect((car.steps as Array<{ text: string }>).map((s) => s.text)).toEqual(["출발지, 출발", "강남대로, 우회전, 300m"]);
  });

  it("수단 결과 3-state가 최상위 outcome으로 보존된다(도보 경로 없음 → empty, steps 없음)", async () => {
    stubFetch({ walk: null });
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    const planId = await planned(ctx);
    const steps = await ctx.call("get_route_steps", { planId, mode: "walk" });
    expect(steps).toEqual({ ok: true, planId, mode: "walk", outcome: "empty", variant: "recommended" });
    expect((await ctx.call("plan_directions", { to: "x" })).reason).toBe("cooldown");
  });

  it("get_transit_route_detail은 leg 전부를 주고, 모르는 routeKey는 unknownRouteKey", async () => {
    stubFetch();
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    const planId = await planned(ctx);
    const detail = await ctx.call("get_transit_route_detail", { planId, routeKey: "r1" });
    expect(detail).toMatchObject({ ok: true, planId, routeKey: "r1" });
    const legs = detail.legs as Array<Record<string, unknown>>;
    expect(legs).toHaveLength(3);
    expect(legs[1]).toEqual({ n: 2, mode: "subway", lineName: "수도권 5호선", fromName: "강동역", toName: "광화문역", stationCount: 12 });
    expect(await ctx.call("get_transit_route_detail", { planId, routeKey: "nope" })).toMatchObject({ ok: false, reason: "unknownRouteKey" });
    expect(await ctx.call("get_transit_route_detail", { planId: "p0", routeKey: "r1" })).toMatchObject({ ok: false, reason: "stalePlan" });
  });

  it("결과가 없으면 noResult", async () => {
    stubFetch();
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    expect(await ctx.call("get_route_steps", { planId: "p1", mode: "walk" })).toMatchObject({ ok: false, reason: "noResult" });
    expect(await ctx.call("get_transit_route_detail", { planId: "p1", routeKey: "r0" })).toMatchObject({ ok: false, reason: "noResult" });
  });
});

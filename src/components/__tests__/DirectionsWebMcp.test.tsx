// @vitest-environment jsdom
/**
 * WebMCP 도구층 × 길찾기 뷰 계약(spec 2026-08-27 §8.4). 결정론적 deferred Promise로 경합을
 * 재현한다. 안내 진입점은 트리거 버튼 + 세션 스토어 게시만 흉내 낸다(jsdom에 geolocation 없음).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { CarRouteBriefing, JusoAddress, Place, TransitRouteResult, WalkRouteBriefing } from "@/lib/types";
import {
  __resetGuideSessionStoreForTest,
  claimGuideSession,
  publishGuideSnapshot,
  readGuideSnapshot,
} from "@/lib/guide-session-store";
import type { WebMcpTool } from "@/lib/webmcp/types";
import { __resetViewRegistryForTest, bridgeOf } from "@/lib/webmcp/view-registry";
import { buildDirectionsTools } from "@/lib/webmcp/tools";
import type { DirectionsBridge } from "@/lib/webmcp/tools/context";

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
vi.mock("../DistanceBeacon", () => ({
  DistanceBeacon: ({ triggerLabel, kind, triggerTarget }: { triggerLabel?: string; kind: "walk" | "car"; triggerTarget?: string }) => {
    const [open, setOpen] = useState(false);
    const stop = () => setOpen(false);
    return (
      <div>
        <button
          type="button"
          data-guide-trigger={triggerTarget}
          aria-expanded={open}
          onClick={() => {
            if (open) {
              stop();
              return;
            }
            claimGuideSession(stop);
            if (kind === "car") {
              // 시작 실패 경로(권한 거부)를 흉내 낸다 — 패널은 열린 채 남는다(실제 컴포넌트와 같다).
              publishGuideSnapshot(stop, { status: "failed", failure: "geoDenied", mode: kind }, { retain: true });
            } else {
              publishGuideSnapshot(stop, { status: "tracking", mode: kind, now: "100m 직진" });
            }
            setOpen(true);
          }}
        >
          {open ? "stop" : triggerLabel}
        </button>
        {open && (
          <p tabIndex={-1} data-focus-target="guidance:panel">
            안내 중
          </p>
        )}
      </div>
    );
  },
}));
vi.mock("../TransitGuidePanel", () => ({
  TransitGuidePanel: ({ triggerLabel, triggerTarget }: { triggerLabel: string; triggerTarget?: string }) => (
    <button type="button" data-guide-trigger={triggerTarget}>
      {triggerLabel}
    </button>
  ),
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
 * W2: 길찾기 뷰는 도구를 등록하지 않고 브릿지를 게시한다. 이 스위트는 게시된 브릿지로 W1 도구를
 * 조립해 같은 계약(조회·세대·페이지)을 검증한다. `registerTool` 목은 "등록 0"을 단언하는 데만 쓴다.
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
  const bridge = bridgeOf<DirectionsBridge>("directions")!.bridge;
  for (const tool of buildDirectionsTools(bridge)) ctx.tools.set(tool.name, tool);
}

/** 쿨다운(3초)을 지나기 위해 시계만 앞당긴다(타이머는 실시간 — waitFor·MutationObserver 유지). */
function advanceClock(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

beforeEach(() => {
  __resetGuideSessionStoreForTest();
  __resetViewRegistryForTest();
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
  it("결과 전: phase idle·plan null·필드·고수준 targets·키보드 포커스", async () => {
    stubFetch();
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    screen.getByLabelText("to").focus();
    const out = await ctx.call("read_current_view");
    expect(out.ok).toBe(true);
    expect(out.phase).toBe("idle");
    expect(out.plan).toBeNull();
    expect(out.fields).toEqual({ from: "currentLocation", to: "", via: null, avoidStairs: false });
    expect(out.guidance).toEqual({ status: "idle" });
    const ids = (out.targets as Array<{ id: string; label: string }>).map((t) => t.id);
    expect(ids).toEqual(["field:from", "field:to", "control:submit"]);
    expect(out.keyboardFocus).toEqual({ label: "to", targetId: "field:to" });
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
    const ids = (out.targets as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain("mode:transit");
    expect(ids).toContain("transit:route:0");
    expect(ids).toContain("transit:route:2");
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
      { n: 1, text: "첫째 안내", targetId: "walk:step:1" },
      { n: 2, text: "둘째 안내", targetId: "walk:step:2" },
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

  it("get_transit_route_detail은 leg 전부와 착지 ID를 주고, 모르는 routeKey는 unknownRouteKey", async () => {
    stubFetch();
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    const planId = await planned(ctx);
    const detail = await ctx.call("get_transit_route_detail", { planId, routeKey: "r1" });
    expect(detail).toMatchObject({ ok: true, planId, routeKey: "r1" });
    const legs = detail.legs as Array<Record<string, unknown>>;
    expect(legs).toHaveLength(3);
    expect(legs[1]).toMatchObject({ n: 2, mode: "subway", lineName: "수도권 5호선", fromName: "강동역", toName: "광화문역", stationCount: 12, targetId: "transit:leg:1:2" });
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

describe("focus_item(축 A)", () => {
  it("스텝 착지·라벨 반환, 계획 범위인데 planId가 없으면 stalePlan, 필드 편집 중이면 editingInProgress", async () => {
    stubFetch();
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    const planId = (await ctx.call("plan_directions", { to: "강남역" })).planId as string;
    expect(await ctx.call("focus_item", { targetId: "walk:step:2" })).toMatchObject({ ok: false, reason: "stalePlan" });
    const landed = await ctx.call("focus_item", { targetId: "walk:step:2", planId });
    expect(landed).toEqual({ ok: true, label: "둘째 안내" });
    await waitFor(() => expect(document.activeElement?.textContent).toBe("둘째 안내"));
    screen.getByLabelText("to").focus();
    expect(await ctx.call("focus_item", { targetId: "mode:walk", planId })).toMatchObject({ ok: false, reason: "editingInProgress", userActionRequired: true });
    // 그 필드 자신이 대상이면 거절하지 않는다.
    expect(await ctx.call("focus_item", { targetId: "field:to" })).toEqual({ ok: true, label: "to" });
    (document.activeElement as HTMLElement).blur();
    expect(await ctx.call("focus_item", { targetId: "walk:step:99", planId })).toMatchObject({ ok: false, reason: "notFound" });
  });

  it("접힌 대안 경로 안 leg는 화면 핸들러로 펼친 뒤 착지한다", async () => {
    stubFetch();
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    const planId = (await ctx.call("plan_directions", { to: "강남역" })).planId as string;
    expect(document.querySelector('[data-focus-target="transit:leg:1:2"]')).toBeNull();
    const landed = await ctx.call("focus_item", { targetId: "transit:leg:1:2", planId });
    expect(landed.ok).toBe(true);
    await waitFor(() => {
      const el = document.querySelector('[data-focus-target="transit:leg:1:2"]');
      expect(el).not.toBeNull();
      expect(document.activeElement).toBe(el);
    });
    expect(screen.getAllByRole("button", { name: /alternativeFastest/ })[0].getAttribute("aria-expanded")).toBe("true");
  });

  it("접힌 장거리 도보 상세도 펼친 뒤 착지한다", async () => {
    stubFetch({ walk: walkFixture(60 * 60) });
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    const planId = (await ctx.call("plan_directions", { to: "강남역" })).planId as string;
    expect(document.querySelector('[data-focus-target="walk:step:1"]')).toBeNull();
    const landed = await ctx.call("focus_item", { targetId: "walk:step:3", planId });
    expect(landed).toEqual({ ok: true, label: "셋째 안내" });
  });
});

describe("안내 도구(축 B)", () => {
  it("start_guidance: transit은 routeKey 필수, walk 시작 → tracking + guidance:panel, 활성 중 재호출 sessionActive, stop → previousStatus, 이후 noSession", async () => {
    stubFetch();
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    expect(await ctx.call("start_guidance", { planId: "p1", mode: "walk" })).toMatchObject({ ok: false, reason: "noResult" });
    const planId = (await ctx.call("plan_directions", { to: "강남역" })).planId as string;
    expect(await ctx.call("start_guidance", { planId, mode: "transit" })).toMatchObject({ ok: false, reason: "notStartable", detail: "routeKeyRequired" });
    expect(await ctx.call("start_guidance", { planId, mode: "transit", routeKey: "zzz" })).toMatchObject({ ok: false, reason: "unknownRouteKey" });
    expect(await ctx.call("guidance_status")).toEqual({ ok: true, status: "idle" });
    const started = await ctx.call("start_guidance", { planId, mode: "walk" });
    expect(started).toMatchObject({ ok: true, status: "tracking", mode: "walk" });
    expect(started.targets).toEqual([{ id: "guidance:panel", label: "안내 중" }]);
    expect(readGuideSnapshot()).toMatchObject({ status: "tracking", mode: "walk" });
    expect(await ctx.call("guidance_status")).toMatchObject({ ok: true, status: "tracking", now: "100m 직진", sessionId: 1 });
    expect(await ctx.call("start_guidance", { planId, mode: "walk" })).toMatchObject({ ok: false, reason: "sessionActive", userActionRequired: true });
    // 안내 중에도 focus_item은 거절하지 않는다(축 A 핵심 시나리오).
    expect(await ctx.call("focus_item", { targetId: "guidance:panel" })).toEqual({ ok: true, label: "안내 중" });
    expect(await ctx.call("stop_guidance")).toEqual({ ok: true, previousStatus: "tracking" });
    expect(await ctx.call("guidance_status")).toEqual({ ok: true, status: "idle" });
    expect(await ctx.call("stop_guidance")).toMatchObject({ ok: false, reason: "noSession" });
    // 세션 종료 뒤 같은 계획으로 다시 시작할 수 있다(토글 트리거가 닫힘 상태로 돌아왔다).
    await waitFor(() => expect(screen.getByRole("button", { name: "guideStartWalk" })).toBeTruthy());
    const restarted = await ctx.call("start_guidance", { planId, mode: "walk" });
    expect(restarted).toMatchObject({ ok: true, status: "tracking" });
  });

  it("안내 중 plan_directions는 세션을 끊지 않고 sessionActive, 중지 뒤 새 조회는 남은 스냅샷도 지운다", async () => {
    stubFetch();
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    const planId = (await ctx.call("plan_directions", { to: "강남역" })).planId as string;
    await ctx.call("start_guidance", { planId, mode: "walk" });
    expect(readGuideSnapshot().status).toBe("tracking");
    advanceClock(4_000);
    expect(await ctx.call("plan_directions", { to: "강남역" })).toMatchObject({ ok: false, reason: "sessionActive", userActionRequired: true });
    expect(readGuideSnapshot().status).toBe("tracking");
    await ctx.call("stop_guidance");
    advanceClock(4_000);
    expect((await ctx.call("plan_directions", { to: "강남역" })).ok).toBe(true);
    expect(readGuideSnapshot()).toEqual({ status: "idle" });
  });

  it("시작이 권한 거부로 실패하면 열린 패널을 닫고 시작 버튼에 포커스를 둔 채 confirmationRequired", async () => {
    stubFetch();
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    const planId = (await ctx.call("plan_directions", { to: "강남역" })).planId as string;
    const out = await ctx.call("start_guidance", { planId, mode: "car" });
    expect(out).toMatchObject({ ok: false, reason: "confirmationRequired", detail: "geoDenied", userActionRequired: true });
    const trigger = document.querySelector<HTMLElement>('[data-guide-trigger="car"]');
    expect(document.activeElement).toBe(trigger);
    await waitFor(() => expect(trigger?.getAttribute("aria-expanded")).toBe("false"));
  });

  it("도구 조회는 결과 안에 있던 커서를 조회 버튼으로 먼저 옮긴다", async () => {
    stubFetch();
    const ctx = installModelContext();
    renderView();
    await ready(ctx);
    const planId = (await ctx.call("plan_directions", { to: "강남역" })).planId as string;
    await ctx.call("focus_item", { targetId: "walk:step:1", planId });
    await waitFor(() => expect(document.activeElement?.textContent).toBe("첫째 안내"));
    advanceClock(4_000);
    const pending = ctx.call("plan_directions", { to: "강남역" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "submit" })));
    const out = await pending;
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true });
  });
});

// @vitest-environment jsdom
/**
 * 채팅 경로 안내 시작 카드 → PlaceSearch 배선(E83 spec §6·R2·R6·R8). 자식 뷰는 목킹한다 — 여기서 보는 것은 통로와 갈래다.
 * - 통로(= 능력 신고의 스위치)는 범용 채팅에 늘 준다(여정 키 게이트·로케일과 무관).
 * - [길찾기에서 열기]·도보·자동차 [안내 시작]은 측위 없이 길찾기 화면을 연다(위치는 그 화면이 조회하며 받는다).
 * - 대중교통 [안내 시작]만 위치를 새로 받아 신선도로 가른다(여정 카드와 같은 10분·100m, 수동 위치 카드는 늘 다시 조회).
 * - 카드 버튼으로 닫힌 채팅은 대화를 남긴다(E70-b2 ①).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { __resetViewRegistryForTest } from "@/lib/webmcp/view-registry";
import { __resetToolLockForTest } from "@/lib/webmcp/tool-lock";
import { __resetOpenPlaceForTest } from "@/lib/place-open-request";
import type { DirEndpoint } from "@/lib/directions-state";
import type { RouteStartMode, RouteStartRenderPayload } from "@/lib/chat/types";
import type { TransitRouteResult } from "@/lib/types";
import { groupRouteStartRenders, type RouteStartGroup } from "@/lib/chat/route-start-groups";
import { JOURNEY_CARD_MAX_AGE_MS } from "../chat/journey-card-freshness";

const intl = vi.hoisted(() => ({ locale: "ko" }));
vi.mock("next-intl", async () => {
  const m = await import("./stable-intl-mock");
  return m.stableIntlMock(() => intl.locale, m.keyOnly);
});
const geo = vi.hoisted(() => ({
  next: { status: "ready", coords: { lat: 37.5663, lng: 126.9779 } } as unknown,
  calls: [] as unknown[],
  release: null as null | (() => void),
  hold: false,
}));
vi.mock("@/lib/geolocation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/geolocation")>()),
  awaitGeolocation: vi.fn((opts?: unknown) => {
    geo.calls.push(opts);
    if (!geo.hold) return Promise.resolve(geo.next);
    return new Promise((resolve) => {
      geo.release = () => resolve(geo.next);
    });
  }),
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../NearbyHub", () => ({ NearbyHub: () => null }));
vi.mock("../PlaceDetail", () => ({ PlaceDetail: () => null }));

type Action = { kind: "start"; mode: RouteStartMode } | { kind: "open" };
const card = vi.hoisted(() => ({ group: null as unknown }));
vi.mock("../chat/ChatOverlay", () => ({
  ChatOverlay: ({
    onClose,
    onRouteStartAction,
    initialMessages,
    onMessages,
  }: {
    onClose: () => void;
    onRouteStartAction?: (group: unknown, action: Action) => void | Promise<void>;
    initialMessages?: { id: string }[];
    onMessages?: (messages: { id: string; role?: string; text?: string }[]) => void;
  }) => (
    <div role="dialog">
      <p data-testid="route-start-channel">{onRouteStartAction ? "on" : "off"}</p>
      <p data-testid="chat-restored">{(initialMessages ?? []).map((m) => m.id).join(",")}</p>
      <button type="button" onClick={() => onMessages?.([{ id: "t1", role: "user", text: "강남역 가는 길" }])}>
        chat-talk
      </button>
      {(["walk", "car", "transit"] as const).map((mode) => (
        <button key={mode} type="button" onClick={() => void onRouteStartAction?.(card.group, { kind: "start", mode })}>
          {`card-start-${mode}`}
        </button>
      ))}
      <button type="button" onClick={() => void onRouteStartAction?.(card.group, { kind: "open" })}>
        card-open
      </button>
      <button type="button" onClick={onClose}>
        chat-close
      </button>
    </div>
  ),
}));
type GuideProp = {
  action: string;
  mode: string | null;
  via: { label: string } | null;
  accessible: boolean;
  transit: { result: unknown; origin: unknown } | null;
};
const seen = vi.hoisted(() => ({ guide: null as unknown }));
vi.mock("../DirectionsView", () => ({
  DirectionsView: ({
    initialTo,
    prefill,
    initialGuide,
    initialJourney,
  }: {
    initialTo?: DirEndpoint | null;
    prefill?: boolean;
    initialGuide?: GuideProp;
    initialJourney?: unknown;
  }) => {
    seen.guide = initialGuide ?? null;
    return (
      <div>
        <p data-testid="directions-to">{initialTo?.kind === "place" ? `${initialTo.label}|${initialTo.labelRoman ?? ""}` : "none"}</p>
        <p data-testid="directions-guide">
          {initialGuide
            ? [
                initialGuide.action,
                initialGuide.mode ?? "-",
                initialGuide.via?.label ?? "-",
                initialGuide.accessible ? "accessible" : "plain",
                initialGuide.transit ? "card" : "-",
              ].join(":")
            : "none"}
        </p>
        <p data-testid="directions-other">{`${String(prefill)}|${initialJourney ? "journey" : "none"}`}</p>
      </div>
    );
  },
}));

import { PlaceSearch } from "../PlaceSearch";

const DEST = { lat: 37.4979, lng: 127.0276 };
const ORIGIN = { lat: 37.5663, lng: 126.9779 };
const RESULT = { recommended: { routeKey: "p0", legs: [] }, alternatives: [] } as unknown as TransitRouteResult;
const VIA_WALK = { lat: 37.51, lng: 127.0, label: "편의점" };
const VIA_CAR = { lat: 37.52, lng: 127.01, label: "주유소" };

function start(mode: RouteStartMode, over: Partial<RouteStartRenderPayload> = {}): RouteStartRenderPayload {
  return {
    type: "route-start",
    mode,
    dest: DEST,
    destLabel: "강남역",
    destRoman: "Gangnam Station",
    via: null,
    accessible: false,
    carProvider: mode === "car" ? "tmap" : null,
    transit: mode === "transit" ? { result: RESULT, origin: ORIGIN, queriedAt: Date.now(), manualOrigin: false } : null,
    ...over,
  };
}
const groupOf = (...renders: RouteStartRenderPayload[]): RouteStartGroup => groupRouteStartRenders(renders)[0];
const transitCard = (over: Partial<NonNullable<RouteStartRenderPayload["transit"]>>) =>
  groupOf(start("transit", { transit: { result: RESULT, origin: ORIGIN, queriedAt: Date.now(), manualOrigin: false, ...over } }));

beforeEach(() => {
  intl.locale = "ko";
  geo.next = { status: "ready", coords: { lat: 37.5663, lng: 126.9779 } };
  geo.calls = [];
  geo.release = null;
  geo.hold = false;
  seen.guide = null;
  card.group = groupOf(start("walk"), start("car"), start("transit"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ places: [], addresses: [], web: [] }) })),
  );
});
afterEach(() => {
  cleanup();
  __resetViewRegistryForTest();
  __resetToolLockForTest();
  __resetOpenPlaceForTest();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function openChat(canPlanJourney = false) {
  render(<PlaceSearch isMockMode={false} canShowChat canShowTransit canPlanJourney={canPlanJourney} />);
  fireEvent.click(screen.getByRole("button", { name: "askAi" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
}
async function press(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}
const guideOf = () => screen.queryByTestId("directions-guide")?.textContent ?? null;

describe("채팅 경로 안내 시작 카드 → PlaceSearch(E83)", () => {
  it.each(["ko", "en", "ja"])("%s: 범용 채팅에는 여정 키 게이트와 무관하게 통로를 준다(능력 신고)", (locale) => {
    intl.locale = locale;
    openChat(false);
    expect(screen.getByTestId("route-start-channel").textContent).toBe("on");
  });

  it("[길찾기에서 열기]: 측위 없이 채팅을 닫고 도착지만 채운 길찾기 화면을 연다", async () => {
    openChat();
    await press("card-open");
    expect(geo.calls).toEqual([]);
    expect(guideOf()).toBe("open:-:-:plain:-");
    expect(screen.getByTestId("directions-to").textContent).toBe("강남역|Gangnam Station");
    // 프리필·여정 진입과 섞이지 않는다.
    expect(screen.getByTestId("directions-other").textContent).toBe("false|none");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.history.state?.directions).toBe(true);
  });

  it("[길찾기에서 열기]: 경유지는 도보, 자동차 순으로 처음 만나는 것을 싣는다", async () => {
    card.group = groupOf(start("car", { via: VIA_CAR }), start("walk", { via: VIA_WALK }));
    openChat();
    await press("card-open");
    expect(guideOf()).toBe("open:-:편의점:plain:-");
  });

  it("[길찾기에서 열기]: 자동차에만 경유지가 있으면 그 경유지를 싣는다(R9 — 웹은 자동차 경유지 안내를 길찾기 화면으로 넘긴다)", async () => {
    card.group = groupOf(start("walk"), start("car", { via: VIA_CAR }));
    openChat();
    await press("card-open");
    expect(guideOf()).toBe("open:-:주유소:plain:-");
  });

  it("도보 [안내 시작]: 측위 없이 그 수단의 경유지·계단 회피를 실어 넘긴다", async () => {
    card.group = groupOf(start("walk", { via: VIA_WALK, accessible: true }), start("car", { via: VIA_CAR }));
    openChat();
    await press("card-start-walk");
    expect(geo.calls).toEqual([]);
    expect(guideOf()).toBe("start:walk:편의점:accessible:-");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("자동차 [안내 시작]: 측위 없이 자동차 시작으로 넘긴다", async () => {
    openChat();
    await press("card-start-car");
    expect(geo.calls).toEqual([]);
    expect(guideOf()).toBe("start:car:-:plain:-");
  });

  it("묶음에 없는 수단의 버튼은 아무것도 열지 않는다", async () => {
    card.group = groupOf(start("walk"));
    openChat();
    await press("card-start-car");
    await press("card-start-transit");
    expect(guideOf()).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(geo.calls).toEqual([]);
  });

  describe("대중교통 [안내 시작]의 신선도 갈래(R6)", () => {
    it("위치를 강제로 새로 받고, 신선하면 카드의 결과와 그 조회의 출발 좌표를 넘긴다", async () => {
      openChat();
      await press("card-start-transit");
      expect(geo.calls).toEqual([{ force: true }]);
      expect(guideOf()).toBe("start:transit:-:plain:card");
      const guide = seen.guide as GuideProp;
      expect(guide.transit?.result).toBe(RESULT);
      expect(guide.transit?.origin).toEqual(ORIGIN);
    });

    it("출발 좌표에서 100m 넘게 벗어났으면 다시 조회한다(카드의 결과를 넘기지 않는다)", async () => {
      geo.next = { status: "ready", coords: { lat: 37.5683, lng: 126.9779 } };
      openChat();
      await press("card-start-transit");
      expect(guideOf()).toBe("requery:transit:-:plain:-");
    });

    it("조회한 지 10분이 넘었으면 다시 조회한다", async () => {
      card.group = transitCard({ queriedAt: Date.now() - JOURNEY_CARD_MAX_AGE_MS - 60_000 });
      openChat();
      await press("card-start-transit");
      expect(guideOf()).toBe("requery:transit:-:plain:-");
    });

    it("수동 지정 위치에서 조회한 카드는 신선해도 다시 조회한다", async () => {
      card.group = transitCard({ manualOrigin: true });
      openChat();
      await press("card-start-transit");
      expect(geo.calls).toEqual([{ force: true }]);
      expect(guideOf()).toBe("requery:transit:-:plain:-");
    });

    it("측위에 실패했으면 다시 조회한다(직전 좌표가 있어도 신선으로 보지 않는다)", async () => {
      geo.next = { status: "denied", reason: "timeout", last: ORIGIN };
      openChat();
      await press("card-start-transit");
      expect(guideOf()).toBe("requery:transit:-:plain:-");
    });

    it("측위를 기다리는 동안 채팅은 열려 있고, 그 사이 사용자가 채팅을 닫으면 길찾기를 열지 않는다", async () => {
      geo.hold = true;
      openChat();
      await press("card-start-transit");
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(guideOf()).toBeNull();
      await press("chat-close");
      await act(async () => {
        geo.release?.();
      });
      expect(guideOf()).toBeNull();
      expect(window.history.state?.directions).toBeUndefined();
    });

    it("측위를 기다리는 동안 다른 버튼을 눌러도 한 번만 재고, 먼저 누른 버튼대로 연다", async () => {
      geo.hold = true;
      openChat();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "card-start-transit" }));
        fireEvent.click(screen.getByRole("button", { name: "card-start-transit" }));
        fireEvent.click(screen.getByRole("button", { name: "card-open" }));
        fireEvent.click(screen.getByRole("button", { name: "card-start-walk" }));
      });
      expect(geo.calls.length).toBe(1);
      expect(guideOf()).toBeNull();
      await act(async () => {
        geo.release?.();
      });
      expect(guideOf()).toBe("start:transit:-:plain:card");
    });
  });

  it("카드 버튼으로 닫힐 때는 검색창으로 포커스를 돌리지 않는다(착지는 길찾기 화면 몫)", async () => {
    openChat();
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    await press("card-start-walk");
    expect(focusSpy).not.toHaveBeenCalled();
    focusSpy.mockRestore();
  });

  it.each(["card-open", "card-start-walk", "card-start-transit"])("%s로 닫힌 뒤 다시 열면 그 대화를 이어 보여 준다", async (name) => {
    openChat();
    fireEvent.click(screen.getByRole("button", { name: "chat-talk" }));
    await press(name);
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      window.history.back();
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    fireEvent.click(await screen.findByRole("button", { name: "askAi" }));
    expect(screen.getByTestId("chat-restored").textContent).toBe("t1");
  });
});

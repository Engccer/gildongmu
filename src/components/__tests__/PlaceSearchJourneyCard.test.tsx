// @vitest-environment jsdom
/**
 * 채팅 여정 카드 → PlaceSearch 배선(E70-b spec D7·D12·D14·D16·D17). 자식 뷰는 목킹한다 — 여기서 보는 것은 통로와 신선도 갈래다.
 * - 통로(= 능력 신고의 스위치)는 여정 키 게이트가 참일 때만 범용 채팅에 준다.
 * - [길찾기에서 열기]는 측위 없이, [안내 시작]은 위치를 새로 받아 신선도로 갈라 길찾기 화면을 연다.
 * - 채팅을 닫을 때의 검색창 복귀는 이 경로에서 하지 않는다(착지는 길찾기 화면이 하나로 정한다).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { __resetViewRegistryForTest } from "@/lib/webmcp/view-registry";
import { __resetToolLockForTest } from "@/lib/webmcp/tool-lock";
import { __resetOpenPlaceForTest } from "@/lib/place-open-request";
import type { DirEndpoint } from "@/lib/directions-state";
import type { JourneyRenderPayload } from "@/lib/chat/types";
import type { JourneyResult } from "@/lib/types";
import { JOURNEY_CARD_MAX_AGE_MS } from "../chat/journey-card-freshness";

vi.mock("next-intl", async () => {
  const m = await import("./stable-intl-mock");
  return m.stableIntlMock("ko", m.keyOnly);
});
const geo = vi.hoisted(() => ({
  next: { status: "ready", coords: { lat: 37.55, lng: 126.95 } } as unknown,
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
const card = vi.hoisted(() => ({ payload: null as unknown }));
vi.mock("../chat/ChatOverlay", () => ({
  ChatOverlay: ({
    onClose,
    onJourneyAction,
  }: {
    onClose: () => void;
    onJourneyAction?: (payload: unknown, opts: { start: boolean }) => void | Promise<void>;
  }) => (
    <div role="dialog">
      <p data-testid="journey-channel">{onJourneyAction ? "on" : "off"}</p>
      <button type="button" onClick={() => void onJourneyAction?.(card.payload, { start: true })}>
        card-start
      </button>
      <button type="button" onClick={() => void onJourneyAction?.(card.payload, { start: false })}>
        card-open
      </button>
      <button type="button" onClick={onClose}>
        chat-close
      </button>
    </div>
  ),
}));
vi.mock("../DirectionsView", () => ({
  DirectionsView: ({
    initialTo,
    prefill,
    initialJourney,
  }: {
    initialTo?: DirEndpoint | null;
    prefill?: boolean;
    initialJourney?: { payload: unknown; mode: string };
  }) => (
    <div>
      <p data-testid="directions-to">{initialTo?.kind === "place" ? `${initialTo.label}|${initialTo.labelRoman ?? ""}` : "none"}</p>
      <p data-testid="directions-journey">
        {initialJourney ? `${initialJourney.mode}:${initialJourney.payload === card.payload ? "same" : "other"}` : "none"}
      </p>
      <p data-testid="directions-prefill">{String(prefill)}</p>
    </div>
  ),
}));

import { PlaceSearch } from "../PlaceSearch";

function makePayload(over: Partial<JourneyRenderPayload> = {}): JourneyRenderPayload {
  return {
    type: "journey",
    result: { variants: [] } as unknown as JourneyResult,
    origin: { lat: 37.55, lng: 126.95 },
    queriedAt: Date.now(),
    manualOrigin: false,
    board: { label: "신도림역", lat: 37.5088, lng: 126.8912 },
    alight: null,
    dest: { lat: 37.4979, lng: 127.0276 },
    destLabel: "강남역",
    destRoman: "Gangnam Station",
    ...over,
  };
}

beforeEach(() => {
  geo.next = { status: "ready", coords: { lat: 37.55, lng: 126.95 } };
  geo.calls = [];
  geo.release = null;
  geo.hold = false;
  card.payload = makePayload();
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

function openChat(canPlanJourney = true) {
  render(<PlaceSearch isMockMode={false} canShowChat canShowTransit canPlanJourney={canPlanJourney} />);
  fireEvent.click(screen.getByRole("button", { name: "askAi" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
}
const journeyOf = () => screen.queryByTestId("directions-journey")?.textContent ?? null;

describe("채팅 여정 카드 → PlaceSearch(E70-b)", () => {
  it("여정 키 게이트가 거짓이면 범용 채팅에 통로를 주지 않는다(능력 미신고)", () => {
    openChat(false);
    expect(screen.getByTestId("journey-channel").textContent).toBe("off");
  });

  it("[길찾기에서 열기]: 측위 없이 채팅을 닫고 길찾기 화면을 카드의 결과로 연다", async () => {
    openChat();
    expect(screen.getByTestId("journey-channel").textContent).toBe("on");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "card-open" }));
    });
    expect(geo.calls).toEqual([]);
    expect(journeyOf()).toBe("open:same");
    // 도착지는 카드의 장소(라틴 표기 포함), 자동 조회 표식(prefill)은 없다 — 다시 조회하지 않는다.
    expect(screen.getByTestId("directions-to").textContent).toBe("강남역|Gangnam Station");
    expect(screen.getByTestId("directions-prefill").textContent).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();
    // 뒤로가기가 홈으로 돌아오게 길찾기 엔트리를 쌓는다.
    expect(window.history.state?.directions).toBe(true);
  });

  it("[안내 시작]: 위치를 강제로 새로 받고, 신선하면 카드의 결과로 시작한다", async () => {
    openChat();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "card-start" }));
    });
    expect(geo.calls).toEqual([{ force: true }]);
    expect(journeyOf()).toBe("start:same");
  });

  it("[안내 시작]: 출발 좌표에서 멀리 벗어났으면 다시 조회한다", async () => {
    geo.next = { status: "ready", coords: { lat: 37.56, lng: 126.95 } };
    openChat();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "card-start" }));
    });
    expect(journeyOf()).toBe("requery:same");
  });

  it("[안내 시작]: 조회한 지 오래됐으면 다시 조회한다", async () => {
    card.payload = makePayload({ queriedAt: Date.now() - JOURNEY_CARD_MAX_AGE_MS - 60_000 });
    openChat();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "card-start" }));
    });
    expect(journeyOf()).toBe("requery:same");
  });

  it("[안내 시작]: 측위에 실패했으면 다시 조회한다(직전 좌표가 있어도 신선으로 보지 않는다)", async () => {
    geo.next = { status: "denied", reason: "timeout", last: { lat: 37.55, lng: 126.95 } };
    openChat();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "card-start" }));
    });
    expect(journeyOf()).toBe("requery:same");
  });

  it("측위를 기다리는 동안 채팅은 열려 있고, 그 사이 사용자가 채팅을 닫으면 길찾기를 열지 않는다", async () => {
    geo.hold = true;
    openChat();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "card-start" }));
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(journeyOf()).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "chat-close" }));
    });
    await act(async () => {
      geo.release?.();
    });
    expect(journeyOf()).toBeNull();
    expect(window.history.state?.directions).toBeUndefined();
  });

  it("측위를 기다리는 동안 다시 눌러도 한 번만 잰다", async () => {
    geo.hold = true;
    openChat();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "card-start" }));
      fireEvent.click(screen.getByRole("button", { name: "card-start" }));
      fireEvent.click(screen.getByRole("button", { name: "card-open" }));
    });
    expect(geo.calls.length).toBe(1);
    expect(journeyOf()).toBeNull();
    await act(async () => {
      geo.release?.();
    });
    expect(journeyOf()).toBe("start:same");
  });

  it("카드 버튼으로 닫힐 때는 검색창으로 포커스를 돌리지 않는다(착지는 길찾기 화면 몫)", async () => {
    openChat();
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "card-open" }));
    });
    expect(focusSpy).not.toHaveBeenCalled();
    focusSpy.mockRestore();
  });
});

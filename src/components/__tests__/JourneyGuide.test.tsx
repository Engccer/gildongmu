// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EgressOption, JourneyVariant } from "@/lib/types";
import { __resetGuideSessionStoreForTest, claimGuideSession, hasActiveGuideSession } from "@/lib/guide-session-store";

vi.mock("next-intl", async () => {
  const m = await import("./stable-intl-mock");
  return m.stableIntlMock("ko");
});
const geo = vi.hoisted(() => ({ value: { status: "idle" } as { status: string; coords?: { lat: number; lng: number } } }));
vi.mock("@/lib/geolocation", () => ({ getGeolocationSnapshot: () => geo.value }));

// 단계 패널은 콜백만 흉내 낸다 — 이 스위트는 여정의 전이·배선을 보지 세션 자체를 보지 않는다.
vi.mock("../DistanceBeacon", () => ({
  DistanceBeacon: (p: {
    kind: string;
    dest: { name: string };
    arrivalText?: string;
    onSessionEnd?: (r: "arrived" | "ended") => void;
    onUserStop?: () => void;
    onFailure?: (w: "start" | "running") => void;
  }) => (
    <div data-testid={`beacon-${p.kind}`} data-dest={p.dest.name} data-arrival={p.arrivalText ?? ""}>
      <button type="button" onClick={() => p.onSessionEnd?.("arrived")}>
        beacon-arrive
      </button>
      <button
        type="button"
        onClick={() => {
          p.onUserStop?.();
          p.onSessionEnd?.("ended");
        }}
      >
        beacon-user-stop
      </button>
      <button type="button" onClick={() => p.onSessionEnd?.("ended")}>
        beacon-ended
      </button>
      <button type="button" onClick={() => p.onFailure?.("start")}>
        beacon-start-failed
      </button>
    </div>
  ),
}));
vi.mock("../TransitGuidePanel", () => ({
  TransitGuidePanel: (p: { autoStart?: boolean; dest?: unknown; onRideCompleted?: () => void; onStopped?: () => void }) => (
    <div data-testid="transit" data-auto={String(p.autoStart)} data-dest={p.dest ? "yes" : "no"}>
      {p.onRideCompleted && (
        <button type="button" onClick={p.onRideCompleted}>
          transit-ride
        </button>
      )}
      <button type="button" onClick={() => p.onStopped?.()}>
        transit-stopped
      </button>
    </div>
  ),
}));
vi.mock("@/lib/transit-guide", () => ({ buildTransitGuideRoute: () => ({ legs: [] }) }));

import { JourneyGuide, type JourneyGuidePlan } from "../JourneyGuide";

const board = { name: "아현", coord: { lat: 37.5577, lng: 126.9562 } };
const exit: EgressOption = {
  kind: "exit",
  label: "3",
  lineName: "1호선",
  placeName: "역곡역 1호선 3번출구",
  coord: { lat: 37.4851, lng: 126.8115 },
  taxiOut: { durationSeconds: 600, taxiFare: 6000 } as EgressOption["taxiOut"],
};
const variant = {
  kind: "designated",
  boardStation: board,
  alightStation: { name: "역곡", coord: { lat: 37.485, lng: 126.811 } },
  taxiIn: { durationSeconds: 480, taxiFare: 7800 },
  transit: { routeKey: "r", legs: [{ mode: "subway", fromName: "아현", toName: "역곡", lineName: "수도권 1호선" }] },
  totals: { minutes: 50, taxiFare: 13800, transitFare: 1550 },
} as unknown as JourneyVariant;

function plan(overrides: Partial<JourneyGuidePlan> = {}): JourneyGuidePlan {
  return { variant, egress: exit, alightDesignated: true, dest: { lat: 37.5, lng: 126.78 }, destLabel: "부천시청", ...overrides };
}

const announce = vi.fn();
const onFinished = vi.fn();
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  vi.useFakeTimers();
  __resetGuideSessionStoreForTest();
  announce.mockReset();
  onFinished.mockReset();
  geo.value = { status: "idle" };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("JourneyGuide 이어 안내(E70-f §7)", () => {
  it("택시 → (역 앞이라 접근 도보 생략) → 대중교통 → 출구 도보 → 택시 → 끝", () => {
    render(<JourneyGuide plan={plan()} announce={announce} onFinished={onFinished} />);
    // 시작은 준비 중(사이 상태) — 상태 문장 + 이 여정이 세션 저장소를 점유한다.
    expect(screen.getByText("directions.loading")).toBeTruthy();
    expect(hasActiveGuideSession()).toBe(true);
    tick(0);
    const taxi = screen.getByTestId("beacon-car");
    expect(taxi.dataset.dest).toBe("아현역");
    expect(taxi.dataset.arrival).toBe("journey.arrivedStation:아현");
    // 택시가 역 앞에 섰다(위치 스토어 좌표가 승차 지점 30m 안) → 접근 도보 없이 대중교통.
    geo.value = { status: "ready", coords: { lat: 37.5578, lng: 126.9562 } };
    click("beacon-arrive");
    expect(screen.getByText("directions.loading")).toBeTruthy();
    tick(600);
    const transit = screen.getByTestId("transit");
    expect(transit.dataset.auto).toBe("true");
    // 하차 쪽을 지정했으면 말미 도보 인계를 하지 않는다(목적지를 넘기지 않는다).
    expect(transit.dataset.dest).toBe("no");
    click("transit-ride");
    tick(600);
    const walk = screen.getByTestId("beacon-walk");
    expect(walk.dataset.dest).toBe("역곡역 1호선 3번출구");
    expect(walk.dataset.arrival).toBe("journey.arrivedExit:3");
    click("journey.taxiBoarded");
    tick(600);
    expect(screen.getByTestId("beacon-car").dataset.dest).toBe("부천시청");
    click("beacon-arrive");
    expect(onFinished).toHaveBeenCalledWith(false);
    expect(hasActiveGuideSession()).toBe(false);
  });

  it("택시에서 내린 곳이 멀면 접근 도보, 도착 선언 버튼 → 대중교통", () => {
    render(<JourneyGuide plan={plan()} announce={announce} onFinished={onFinished} />);
    tick(0);
    geo.value = { status: "ready", coords: { lat: 37.56, lng: 126.96 } };
    click("journey.taxiDropped");
    tick(600);
    expect(screen.getByTestId("beacon-walk").dataset.arrival).toBe("transitGuide.prewalkArrived:아현");
    click("transitGuide.prewalkArrivedButton:아현");
    tick(600);
    expect(screen.getByTestId("transit")).toBeTruthy();
  });

  it("접근 도보를 시작하지 못하면 다리 문장을 내고 2.5초 뒤 대중교통(판정 27)", () => {
    render(<JourneyGuide plan={plan()} announce={announce} onFinished={onFinished} />);
    tick(0);
    click("journey.taxiDropped");
    tick(600); // 측위 없음 → 접근 도보를 시작한다
    click("beacon-start-failed");
    expect(announce).toHaveBeenLastCalledWith("transitGuide.prewalkUnavailable");
    tick(600);
    expect(screen.queryByTestId("transit")).toBeNull();
    tick(1900);
    expect(screen.getByTestId("transit")).toBeTruthy();
  });

  it("택시 세션이 끊기면 실패 시트: 상태 문장 착지 + [경로 다시 조회] + [자동차에서 내렸어요]", () => {
    render(<JourneyGuide plan={plan()} announce={announce} onFinished={onFinished} />);
    tick(0);
    click("beacon-ended");
    const status = screen.getByText("journey.taxiOutFailed");
    expect(document.activeElement).toBe(status);
    expect(screen.getByRole("button", { name: "journey.taxiDropped" })).toBeTruthy();
    click("guide.rerouteButton");
    tick(0);
    expect(screen.getByTestId("beacon-car")).toBeTruthy();
  });

  it("단계 패널의 [안내 중지]는 여정 전체 종료(D11)", () => {
    render(<JourneyGuide plan={plan()} announce={announce} onFinished={onFinished} />);
    tick(0);
    click("beacon-user-stop");
    expect(onFinished).toHaveBeenCalledWith(false);
    expect(screen.queryByTestId("beacon-car")).toBeNull();
  });

  it("사이 상태의 다른 안내 시작은 여정을 끝낸다(점유 claim)", () => {
    render(<JourneyGuide plan={plan()} announce={announce} onFinished={onFinished} />);
    act(() => claimGuideSession(() => {}));
    expect(onFinished).toHaveBeenCalledWith(false);
  });

  it("하차 쪽 미지정: 대중교통부터, 끝나도 그 패널이 남는다(말미 도보 인계)", () => {
    const v = { ...variant, taxiIn: undefined, boardStation: undefined } as JourneyVariant;
    render(<JourneyGuide plan={plan({ variant: v, egress: null, alightDesignated: false })} announce={announce} onFinished={onFinished} />);
    tick(0);
    const transit = screen.getByTestId("transit");
    expect(transit.dataset.dest).toBe("yes");
    expect(screen.queryByRole("button", { name: "transit-ride" })).toBeNull();
    click("transit-stopped");
    expect(onFinished).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("transit")).toBe(transit); // 같은 인스턴스가 남는다(인계 상태 유지)
  });

  it("출구 도보를 시작하지 못하면 재시도 없이 [자동차에 탔어요]가 다음 단계다(원 spec §6.4)", () => {
    render(<JourneyGuide plan={plan()} announce={announce} onFinished={onFinished} />);
    tick(0);
    geo.value = { status: "ready", coords: { lat: 37.5578, lng: 126.9562 } };
    click("beacon-arrive");
    tick(600);
    click("transit-ride");
    tick(600);
    click("beacon-start-failed");
    expect(screen.getByText("journey.egressStartFailed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "guide.rerouteButton" })).toBeNull();
    click("journey.taxiBoarded");
    tick(600);
    expect(screen.getByTestId("beacon-car").dataset.dest).toBe("부천시청");
  });
});

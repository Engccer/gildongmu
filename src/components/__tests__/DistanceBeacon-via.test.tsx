// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GuideProgress, RouteGuideApi } from "@/hooks/useRouteGuide";

vi.mock("next-intl", async () => (await import("./stable-intl-mock")).stableIntlMock("ko"));
vi.mock("../SurroundingsScene", () => ({ SurroundingsScene: () => null }));

const guideApi: RouteGuideApi = {
  status: "tracking",
  supported: true,
  mode: "detail",
  liveText: "",
  offRoute: false,
  progress: null,
  currentText: null,
  liveRows: { top: null, next: null },
  degradeText: null,
  rerouting: false,
  start: () => {},
  stop: () => {},
  announceProgress: () => {},
  requestReroute: () => {},
};
const hookArgs: unknown[][] = [];
vi.mock("@/hooks/useRouteGuide", () => ({
  useRouteGuide: (...args: unknown[]) => {
    hookArgs.push(args);
    return guideApi;
  },
}));

import { DistanceBeaconHost } from "./live-region-host";

/**
 * 남은 거리 행의 "다음 목표"(N4 spec 2026-09-24 §5.2) — 라벨이 값과 함께 바뀌고, 한 줄은 한 텍스트다.
 * 목표 판정은 공유 fixture(`route-guide.test.ts` `nextTarget`)와 훅 테스트가 잠그므로 여기서는 배선만 본다.
 */
describe("DistanceBeacon 남은 거리 행의 다음 목표", () => {
  afterEach(() => {
    cleanup();
    guideApi.progress = null;
    hookArgs.length = 0;
  });

  const dest = { lat: 37.538, lng: 127.143, name: "강동구청" };
  const via = { lat: 37.537, lng: 127.142, label: "길동시장" };

  function open(progress: GuideProgress, withVia = true) {
    guideApi.progress = progress;
    render(
      <DistanceBeaconHost
        dest={dest}
        accessible={false}
        variant={null}
        {...(withVia ? { via } : {})}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "beacon.walkHeading" }));
  }

  it("경유지를 훅에 넘긴다(미지정이면 undefined — 종전 동작)", () => {
    open({ remainingMeters: 44, etaSeconds: null, target: { kind: "route" } });
    expect((hookArgs.at(-1)![3] as { via?: unknown }).via).toEqual(via);
    cleanup();
    open({ remainingMeters: 44, etaSeconds: null, target: { kind: "route" } }, false);
    expect((hookArgs.at(-1)![3] as { via?: unknown }).via).toBeUndefined();
  });

  it("도착 전은 경유지까지, 한 줄 한 텍스트", () => {
    open({ remainingMeters: 44, etaSeconds: 60, target: { kind: "waypoint", label: "길동시장" } });
    const row = screen.getByText("directions.viaRemaining:길동시장,44m, guide.remainingTime:1");
    expect(row.tagName).toBe("P");
    expect(row.children.length).toBe(0);
  });

  it("도착 뒤는 목적지까지", () => {
    open({ remainingMeters: 96, etaSeconds: null, target: { kind: "destination", label: "강동구청" } });
    expect(screen.getByText("directions.viaDestRemaining:강동구청,96m")).toBeTruthy();
  });

  it("경유지 없는 세션은 종전 문구", () => {
    open({ remainingMeters: 1200, etaSeconds: null, target: { kind: "route" } }, false);
    expect(screen.getByText("guide.remainingDistance:1.2km")).toBeTruthy();
  });
});

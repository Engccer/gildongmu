// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, string>) => (v?.label ? `${key}:${v.label}` : key),
}));

import { StepList, WalkRouteResult } from "../WalkRouteBriefing";

afterEach(cleanup);

describe("StepList 경유지 구획(N4)", () => {
  it("경유지 자리에서 목록을 둘로 가르고 번호는 이어진다", () => {
    render(<StepList items={["a", "b", "c"]} waypointIndex={1} waypointText="경유지 X 도착" />);
    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(2);
    expect(lists[1].getAttribute("start")).toBe("2");
    expect(screen.getByText("경유지 X 도착")).toBeTruthy();
  });
  it("경유지 문장이 없거나 인덱스가 경계 밖이면 목록 하나(현행)", () => {
    render(<StepList items={["a", "b"]} waypointIndex={1} waypointText={null} />);
    expect(screen.getAllByRole("list")).toHaveLength(1);
    cleanup();
    render(<StepList items={["a", "b"]} waypointIndex={0} waypointText="x" />);
    expect(screen.getAllByRole("list")).toHaveLength(1);
  });
  it("WalkRouteResult는 waypointLabel과 briefing.waypoint가 함께 있을 때만 구획을 그린다", () => {
    const t = ((k: string) => k) as never;
    render(
      <WalkRouteResult
        briefing={{ distanceMeters: 1, durationSeconds: 60, steps: [{ description: "a" }, { description: "b" }], waypoint: { stepIndex: 1, coord: { lat: 0, lng: 0 } } }}
        t={t}
        waypointLabel="강동역"
      />,
    );
    expect(screen.getByText("viaArrived:강동역")).toBeTruthy();
  });
});

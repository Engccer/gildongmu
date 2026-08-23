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

describe("WalkRouteResult 펼침 본문 중복 제거(B9 ①)", () => {
  const t = ((k: string) => k) as never;
  const NOTICE = "계단 없는 경로를 찾지 못해 일반 경로로 안내합니다.";
  const briefing = {
    distanceMeters: 500,
    durationSeconds: 300,
    steps: [{ description: NOTICE }, { description: "a" }, { description: "b" }],
    stepFree: "unavailable" as const,
    stepFreeNotice: NOTICE,
    waypoint: { stepIndex: 2, coord: { lat: 0, lng: 0 } },
  };
  it("includeSummary=false면 요약 문단을 내지 않는다", () => {
    render(<WalkRouteResult briefing={briefing} t={t} includeSummary={false} />);
    expect(screen.queryByText("summary")).toBeNull();
  });
  it("omitNoticeStep은 notice 스텝 0을 떼고 경유지 인덱스를 한 칸 되돌린다", () => {
    render(<WalkRouteResult briefing={briefing} t={t} omitNoticeStep waypointLabel="X" />);
    expect(screen.queryByText(NOTICE)).toBeNull();
    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(2);
    expect(lists[0].textContent).toBe("a"); // 구획이 a 뒤, b 앞 — 서버가 민 인덱스의 역연산
    expect(lists[1].textContent).toBe("b");
  });
  it("경유지가 첫 실스텝 앞이면(역보정 0) 문장을 삼키지 않고 목록 앞에 낸다", () => {
    render(
      <WalkRouteResult
        briefing={{ ...briefing, waypoint: { stepIndex: 1, coord: { lat: 0, lng: 0 } } }}
        t={t}
        omitNoticeStep
        waypointLabel="X"
      />,
    );
    expect(screen.getByText("viaArrived:X")).toBeTruthy();
    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(1); // 빈 앞 목록을 그리지 않는다
    expect(lists[0].getAttribute("start")).toBe("1");
  });
  it("스텝 0이 notice가 아니면 떼지 않는다", () => {
    render(
      <WalkRouteResult
        briefing={{ ...briefing, steps: [{ description: "a" }, { description: "b" }], stepFreeNotice: NOTICE }}
        t={t}
        omitNoticeStep
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

// @vitest-environment jsdom
/**
 * 여정 조회 결과 화면(E70-f spec §5·§10): 읽기 순서, 변형·출구 선택(`aria-pressed`), 변형을 바꾸면 출구는 기본으로,
 * 안내 중엔 선택 버튼이 숨고 끝나면 [안내 시작]이 돌아온다. 이어 안내 자체는 `JourneyGuide` 스위트가 맡는다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import type { EgressOption, JourneyResult } from "@/lib/types";

vi.mock("next-intl", async () => {
  const m = await import("./stable-intl-mock");
  return m.stableIntlMock("ko", m.keyOnly);
});
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => <p>transit-route</p> }));
const guideProps = vi.hoisted(() => ({ last: null as null | { onFinished: (keep: boolean) => void; variantKind: string; egressLabel: string | null } }));
vi.mock("../JourneyGuide", () => ({
  JourneyGuide: ({ plan, onFinished }: { plan: { variant: { kind: string }; egress: { label: string } | null }; onFinished: (keep: boolean) => void }) => {
    guideProps.last = { onFinished, variantKind: plan.variant.kind, egressLabel: plan.egress?.label ?? null };
    return <p>journey-guide</p>;
  },
}));

import { JourneyResultView } from "../JourneyResult";

const taxi = { durationSeconds: 300, distanceMeters: 2000, taxiFare: 5000 } as unknown as EgressOption["taxiOut"];
const exit = (label: string): EgressOption => ({ kind: "exit", label, placeName: `광화문역 ${label}번출구`, coord: { lat: 37.57, lng: 126.97 }, taxiOut: taxi });
const transit = {
  routeKey: "r0",
  legs: [{ mode: "subway", fromName: "아현", toName: "광화문", lineName: "수도권 2호선" }],
  summary: { totalMinutes: 20, fare: 1550, transfers: 0, walkMinutes: 0 },
} as unknown as JourneyResult["variants"][number]["transit"];
const result: JourneyResult = {
  variants: [
    {
      kind: "designated",
      boardStation: { name: "아현", coord: { lat: 37.5577, lng: 126.9562 } },
      taxiIn: { durationSeconds: 480, taxiFare: 7800 } as JourneyResult["variants"][number]["taxiIn"],
      transit,
      egress: { options: [exit("1"), exit("3")] },
      totals: { minutes: 30, taxiFare: 7800, transitFare: 1550 },
    },
    {
      kind: "recommended",
      boardStation: { name: "충정로", coord: { lat: 37.56, lng: 126.96 } },
      taxiIn: { durationSeconds: 300, taxiFare: 6000 } as JourneyResult["variants"][number]["taxiIn"],
      transit,
      egress: { options: [exit("5"), exit("7")] },
      totals: { minutes: 28, taxiFare: 6000, transitFare: 1550 },
    },
  ],
};
const board = { label: "아현역 2호선", lat: 37.5577, lng: 126.9562, line: "수도권2호선" };

function renderView() {
  const headingRef = createRef<HTMLHeadingElement>();
  const announce = vi.fn();
  render(
    <JourneyResultView
      result={result}
      board={board}
      alight={null}
      dest={{ lat: 37.571, lng: 126.976 }}
      destLabel="광화문"
      destRoman={null}
      locale="ko"
      headingRef={headingRef}
      announce={announce}
    />,
  );
  return { headingRef, announce };
}
const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const pressed = (name: RegExp | string) => screen.getAllByRole("button", { name }).map((b) => b.getAttribute("aria-pressed"));

afterEach(() => {
  cleanup();
  guideProps.last = null;
});

describe("여정 결과 화면(E70-f §5)", () => {
  it("읽기 순서: 변형 제목 h3 → 변형 선택 → 합계 → 택시 앞 → 대중교통 → 출구 선택 → [안내 시작]", () => {
    const { headingRef } = renderView();
    const heading = screen.getByRole("heading", { level: 3 });
    expect(headingRef.current).toBe(heading);
    expect(heading.textContent).toBe("designatedHeading");
    const variants = screen.getAllByRole("button", { name: /Heading$/ });
    expect(variants.map((b) => b.textContent?.trim())).toEqual(["designatedHeading ✓", "recommendedHeading"]);
    const totals = screen.getByText("totals");
    const taxiIn = screen.getByText("taxiIn");
    const transitRoute = screen.getByText("transit-route");
    const egresses = screen.getAllByRole("button", { name: /^egressExit/ });
    const start = screen.getByRole("button", { name: "guideStartTransitAlt" });
    const order = [heading, variants[0], variants[1], totals, taxiIn, transitRoute, egresses[0], egresses[1], start];
    for (let i = 0; i < order.length - 1; i += 1) expect(follows(order[i], order[i + 1])).toBe(true);
    // 선택 상태는 aria-pressed, 체크 표식은 낭독에서 숨긴다.
    expect(pressed(/Heading$/)).toEqual(["true", "false"]);
    expect(variants[0].querySelector("[aria-hidden='true']")?.textContent?.trim()).toBe("✓");
  });

  it("변형을 바꾸면 제목이 따라가고 출구 선택은 기본(첫 출구)으로 돌아간다", () => {
    renderView();
    fireEvent.click(screen.getAllByRole("button", { name: /^egressExit/ })[1]);
    expect(pressed(/^egressExit/)).toEqual(["false", "true"]);
    fireEvent.click(screen.getByRole("button", { name: "recommendedHeading" }));
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("recommendedHeading");
    expect(pressed(/Heading$/)).toEqual(["false", "true"]);
    expect(pressed(/^egressExit/)).toEqual(["true", "false"]);
  });

  it("[안내 시작]은 고른 변형·출구로 안내를 띄우고 선택 버튼을 숨기며, 끝나면 버튼이 돌아온다", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "recommendedHeading" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^egressExit/ })[1]);
    fireEvent.click(screen.getByRole("button", { name: "guideStartTransitAlt" }));
    expect(screen.getByText("journey-guide")).toBeTruthy();
    expect(guideProps.last).toMatchObject({ variantKind: "recommended", egressLabel: "7" });
    expect(screen.queryByRole("button", { name: /Heading$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^egressExit/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "guideStartTransitAlt" })).toBeNull();
    // 안내 중에도 고른 출구 줄은 평문으로 남는다(한 줄 = 한 객체).
    expect(screen.getByText("egressExit")).toBeTruthy();
    act(() => guideProps.last!.onFinished(false));
    expect(screen.queryByText("journey-guide")).toBeNull();
    expect(screen.getByRole("button", { name: "guideStartTransitAlt" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Heading$/ })).toHaveLength(2);
  });

  it("대중교통 단계에서 끝나면(keepTransit) 패널은 남고 [안내 시작]만 돌아온다", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "guideStartTransitAlt" }));
    act(() => guideProps.last!.onFinished(true));
    expect(screen.getByText("journey-guide")).toBeTruthy();
    expect(screen.getByRole("button", { name: "guideStartTransitAlt" })).toBeTruthy();
  });
});

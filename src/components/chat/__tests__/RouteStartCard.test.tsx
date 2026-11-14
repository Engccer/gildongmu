// @vitest-environment jsdom
/**
 * 채팅 경로 안내 시작 카드(E83 spec 판정 3·R9·R10·R12): 버튼만 있는 카드, 버튼 순서, 시작할 수 없는 수단의 버튼 부재,
 * 도착지 이름 줄의 조건, 통로가 없을 때 미렌더, 기다리는 동안의 잠금. 문안은 키로 참조한다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RouteStartMode, RouteStartRenderPayload } from "@/lib/chat/types";
import type { TransitRouteResult } from "@/lib/types";

const intl = vi.hoisted(() => ({ locale: "ko" }));
vi.mock("next-intl", async () => {
  const m = await import("../../__tests__/stable-intl-mock");
  return m.stableIntlMock(() => intl.locale, m.keyOnly);
});

import { RouteStartCard, type RouteStartAction } from "../RouteStartCard";
import { MessageBubble } from "../MessageBubble";
import { groupRouteStartRenders, type RouteStartGroup } from "@/lib/chat/route-start-groups";

afterEach(() => {
  cleanup();
  intl.locale = "ko";
});

const GANGNAM = { lat: 37.4979, lng: 127.0276 };
const SEOUL_STATION = { lat: 37.5547, lng: 126.9707 };
const rideRoute = { routeKey: "r0", legs: [{ mode: "subway", minutes: 10, lineName: "2호선", fromName: "시청", toName: "강남" }] };
const walkOnlyRoute = { routeKey: "r1", legs: [{ mode: "walk", minutes: 10 }] };
const transitOf = (recommended: unknown): RouteStartRenderPayload["transit"] => ({
  result: { recommended, alternatives: [] } as unknown as TransitRouteResult,
  origin: { lat: 37.5663, lng: 126.9779 },
  queriedAt: 1_800_000_000_000,
  manualOrigin: false,
});

function start(mode: RouteStartMode, over: Partial<RouteStartRenderPayload> = {}): RouteStartRenderPayload {
  return {
    type: "route-start",
    mode,
    dest: GANGNAM,
    destLabel: "강남역",
    destRoman: null,
    via: null,
    accessible: false,
    carProvider: mode === "car" ? "tmap" : null,
    transit: mode === "transit" ? transitOf(rideRoute) : null,
    ...over,
  };
}
const groupOf = (...renders: RouteStartRenderPayload[]): RouteStartGroup => groupRouteStartRenders(renders)[0];
const labels = () => screen.getAllByRole("button").map((b) => b.textContent);

describe("RouteStartCard", () => {
  it("세 수단이 다 있으면 버튼은 도보, 자동차, 대중교통, 길찾기에서 열기 순이다(렌더가 온 순서와 무관)", () => {
    render(<RouteStartCard group={groupOf(start("transit"), start("car"), start("walk"))} showDestLine={false} onAction={() => {}} />);
    expect(labels()).toEqual(["guideStartWalk", "guideStartCar", "guideStartTransit", "openInDirections"]);
  });

  it("버튼만 있는 카드다: heading도 live region도 없고, 도착지가 하나면 이름 줄도 없다", () => {
    const { container } = render(<RouteStartCard group={groupOf(start("walk"))} showDestLine={false} onAction={() => {}} />);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelector("[aria-live], [role=status], [role=alert]")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
    expect(screen.queryByText("강남역")).toBeNull();
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toContain("min-h-11");
      expect(button.hasAttribute("disabled")).toBe(false);
      expect(button.hasAttribute("aria-label")).toBe(false);
    }
  });

  it("도착지가 둘 이상인 답이면 첫 줄에 도착지 이름을 평문 한 줄로 둔다(버튼보다 앞)", () => {
    const { container } = render(<RouteStartCard group={groupOf(start("walk"))} showDestLine onAction={() => {}} />);
    const line = container.querySelector("p");
    expect(line?.textContent).toBe("강남역");
    expect(line?.children).toHaveLength(0);
    const first = screen.getAllByRole("button")[0];
    expect(line!.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("통로가 없으면 아무것도 그리지 않는다", () => {
    const { container } = render(<RouteStartCard group={groupOf(start("walk"), start("car"))} showDestLine onAction={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("자동차: 경유지가 있으면 「자동차 안내 시작」을 내지 않는다(R9)", () => {
    const via = { lat: 37.51, lng: 127.0, label: "편의점" };
    render(<RouteStartCard group={groupOf(start("car", { via }))} showDestLine={false} onAction={() => {}} />);
    expect(labels()).toEqual(["openInDirections"]);
  });

  it("자동차: Tmap 경로가 아니면 버튼이 없다(R10)", () => {
    render(<RouteStartCard group={groupOf(start("car", { carProvider: "kakao" }))} showDestLine={false} onAction={() => {}} />);
    expect(labels()).toEqual(["openInDirections"]);
  });

  it("영어 데이터 로케일: 자동차 버튼은 없고 도보·대중교통은 있다(R10)", () => {
    intl.locale = "en";
    render(<RouteStartCard group={groupOf(start("walk"), start("car"), start("transit"))} showDestLine={false} onAction={() => {}} />);
    expect(labels()).toEqual(["guideStartWalk", "guideStartTransit", "openInDirections"]);
  });

  it("대중교통: 추천 첫 경로에 탑승 구간이 없으면 버튼이 없다(R10)", () => {
    render(
      <RouteStartCard
        group={groupOf(start("transit", { transit: transitOf(walkOnlyRoute) }))}
        showDestLine={false}
        onAction={() => {}}
      />,
    );
    expect(labels()).toEqual(["openInDirections"]);
  });

  it("버튼은 묶음과 그 버튼의 뜻을 통로로 넘긴다", async () => {
    const calls: RouteStartAction[] = [];
    const group = groupOf(start("walk"), start("car"), start("transit"));
    render(<RouteStartCard group={group} showDestLine={false} onAction={(g, action) => void (g === group && calls.push(action))} />);
    for (const name of ["guideStartWalk", "guideStartCar", "guideStartTransit", "openInDirections"]) {
      // 한 누름이 끝난 뒤(통로의 Promise가 풀린 뒤) 다음 버튼을 누른다 — 도는 동안의 누름은 가드가 버린다.
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name }));
      });
    }
    expect(calls).toEqual([
      { kind: "start", mode: "walk" },
      { kind: "start", mode: "car" },
      { kind: "start", mode: "transit" },
      { kind: "open" },
    ]);
  });

  it("통로가 기다리는 동안 버튼은 aria-disabled로 잠기고 포커스를 지키며, 그 사이 누름은 무시된다", async () => {
    let release: () => void = () => {};
    const onAction = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    render(<RouteStartCard group={groupOf(start("walk"), start("transit"))} showDestLine={false} onAction={onAction} />);
    const transit = screen.getByRole("button", { name: "guideStartTransit" });
    transit.focus();
    await act(async () => {
      fireEvent.click(transit);
    });
    expect(transit.getAttribute("aria-disabled")).toBe("true");
    expect(transit.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(transit);
    fireEvent.click(screen.getByRole("button", { name: "guideStartWalk" }));
    fireEvent.click(transit);
    expect(onAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
    });
    expect(transit.getAttribute("aria-disabled")).toBe("false");
  });
});

describe("MessageBubble — route-start 렌더의 묶음 카드", () => {
  const bubble = (renders: RouteStartRenderPayload[], onRouteStartAction: (() => void) | undefined) =>
    render(<MessageBubble message={{ id: "m1", role: "assistant", text: "", renders }} onRouteStartAction={onRouteStartAction} />);

  it("같은 도착지의 세 렌더는 카드 하나다(버튼 넷, 이름 줄 없음)", () => {
    bubble([start("walk"), start("car"), start("transit")], () => {});
    expect(labels()).toEqual(["guideStartWalk", "guideStartCar", "guideStartTransit", "openInDirections"]);
    expect(screen.queryByText("강남역")).toBeNull();
  });

  it("도착지가 둘이면 카드도 둘이고, 카드마다 첫 줄에 도착지 이름이 선다", () => {
    bubble([start("walk"), start("walk", { dest: SEOUL_STATION, destLabel: "서울역" }), start("car")], () => {});
    expect(labels()).toEqual([
      "guideStartWalk",
      "guideStartCar",
      "openInDirections",
      "guideStartWalk",
      "openInDirections",
    ]);
    const gangnam = screen.getByText("강남역");
    const seoul = screen.getByText("서울역");
    expect(gangnam.compareDocumentPosition(seoul) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("통로가 없으면(장소 채팅) 카드를 그리지 않는다", () => {
    const { container } = bubble([start("walk"), start("car")], undefined);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.textContent).toBe("");
  });
});

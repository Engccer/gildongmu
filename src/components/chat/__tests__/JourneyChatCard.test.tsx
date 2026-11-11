// @vitest-environment jsdom
/**
 * 채팅 여정 카드(E70-b spec P1·D2·D10·D11·D15): 읽기 순서, 한 줄 한 객체, heading 없음, 수동 위치일 때 [안내 시작] 부재,
 * 통로가 없을 때 버튼 부재. 문안은 키로 참조한다(위원장 확정 전).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EgressOption, JourneyResult } from "@/lib/types";
import type { JourneyRenderPayload } from "@/lib/chat/types";

vi.mock("next-intl", async () => {
  const m = await import("../../__tests__/stable-intl-mock");
  return m.stableIntlMock("ko");
});

import { JourneyChatCard } from "../JourneyChatCard";

afterEach(cleanup);

const taxi = { durationSeconds: 300, distanceMeters: 2000, taxiFare: 5000 } as unknown as EgressOption["taxiOut"];
const exit = (label: string, fare: number): EgressOption => ({
  kind: "exit",
  label,
  placeName: `광화문역 ${label}번출구`,
  coord: { lat: 37.57, lng: 126.97 },
  taxiOut: { ...taxi, taxiFare: fare } as EgressOption["taxiOut"],
});
const transit = {
  routeKey: "r0",
  legs: [{ mode: "subway", fromName: "충정로", toName: "광화문", lineName: "수도권 5호선" }],
  summary: { totalMinutes: 20, fare: 1550, transfers: 0, walkMinutes: 0 },
} as unknown as JourneyResult["variants"][number]["transit"];
/** 지정한 역(아현)으로 못 찾아 추천(충정로)이 첫 변형으로 온 결과 — 못 찾음 줄이 선다. */
const result: JourneyResult = {
  designatedMissing: { side: "board" },
  variants: [
    {
      kind: "recommended",
      boardStation: { name: "충정로", coord: { lat: 37.56, lng: 126.96 } },
      taxiIn: { durationSeconds: 300, taxiFare: 6000 } as JourneyResult["variants"][number]["taxiIn"],
      transit,
      egress: { options: [exit("5", 5000), exit("7", 9000)] },
      totals: { minutes: 28, taxiFare: 11000, transitFare: 1550 },
    },
    {
      kind: "designated",
      boardStation: { name: "아현", coord: { lat: 37.5577, lng: 126.9562 } },
      taxiIn: { durationSeconds: 480, taxiFare: 7800 } as JourneyResult["variants"][number]["taxiIn"],
      transit,
      totals: { minutes: 99, taxiFare: 7800, transitFare: 1550 },
    },
  ],
} as JourneyResult;

function payload(over: Partial<JourneyRenderPayload> = {}): JourneyRenderPayload {
  return {
    type: "journey",
    result,
    origin: { lat: 37.55, lng: 126.95 },
    queriedAt: 1_800_000_000_000,
    manualOrigin: false,
    board: { label: "아현역 2호선", lat: 37.5577, lng: 126.9562, line: "수도권2호선" },
    alight: null,
    dest: { lat: 37.571, lng: 126.976 },
    destLabel: "광화문",
    destRoman: null,
    ...over,
  };
}

/** 카드 안 접근성 객체(문단·버튼)를 문서 순서대로. */
function objects(container: HTMLElement) {
  return Array.from(container.querySelectorAll("p, button")).map((el) => ({
    tag: el.tagName.toLowerCase(),
    text: el.textContent ?? "",
  }));
}

describe("JourneyChatCard", () => {
  it("읽기 순서는 제목 → 못 찾음 줄 → 합계 → [안내 시작] → [길찾기에서 열기]이고 첫 변형·첫 출구를 싣는다", () => {
    const { container } = render(<JourneyChatCard payload={payload()} onAction={() => {}} />);
    const seen = objects(container);
    expect(seen.map((o) => o.tag)).toEqual(["p", "p", "p", "button", "button"]);
    // 제목은 첫 변형(추천, 충정로)이다 — 둘째 변형(지정, 아현)이 아니다.
    expect(seen[0].text).toBe("journey.recommendedHeading:충정로");
    expect(seen[1].text).toBe("journey.designatedMissing:아현");
    // 합계는 첫 변형의 서버 합계 그대로(출구 인덱스 0 — 다른 출구의 택시 요금으로 바뀌지 않는다).
    expect(seen[2].text).toBe("journey.totals:28,11,000,1,550");
    expect(seen[3].text).toBe("beacon.start");
    expect(seen[4].text).toBe("journey.openInDirections");
  });

  it("줄마다 한 접근성 객체다(문단·버튼 안에 자식 요소가 없다) — heading도 없다", () => {
    const { container } = render(<JourneyChatCard payload={payload()} onAction={() => {}} />);
    for (const el of Array.from(container.querySelectorAll("p, button"))) {
      expect(el.children.length).toBe(0);
    }
    expect(container.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']")).toBeNull();
    expect(container.querySelector("[aria-live], [role='status'], [role='alert']")).toBeNull();
  });

  it("못 찾음 사실이 없으면 그 줄이 없다", () => {
    const { container } = render(
      <JourneyChatCard payload={payload({ result: { variants: result.variants } as JourneyResult })} onAction={() => {}} />,
    );
    expect(objects(container).map((o) => o.tag)).toEqual(["p", "p", "button", "button"]);
  });

  it("수동 지정 위치에서 조회한 여정은 [안내 시작]을 내지 않는다([길찾기에서 열기]만)", () => {
    render(<JourneyChatCard payload={payload({ manualOrigin: true })} onAction={() => {}} />);
    expect(screen.queryByRole("button", { name: "beacon.start" })).toBeNull();
    expect(screen.getByRole("button", { name: "journey.openInDirections" })).toBeTruthy();
  });

  it("통로가 없으면(장소 상세 채팅 등) 버튼 없이 제목·합계만 그린다", () => {
    const { container } = render(<JourneyChatCard payload={payload()} />);
    expect(container.querySelectorAll("button").length).toBe(0);
    expect(container.querySelectorAll("p").length).toBe(3);
  });

  it("변형이 없는 결과는 그리지 않는다", () => {
    const { container } = render(
      <JourneyChatCard payload={payload({ result: { variants: [] } as JourneyResult })} onAction={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("버튼은 payload와 시작 여부를 통로로 넘긴다", async () => {
    const onAction = vi.fn();
    const p = payload();
    render(<JourneyChatCard payload={p} onAction={onAction} />);
    // 앞 누름의 잠금(in-flight)이 풀린 뒤 다음을 누른다 — 통로가 동기로 끝나도 잠금은 한 틱 뒤에 풀린다.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "journey.openInDirections" }));
    });
    expect(onAction).toHaveBeenLastCalledWith(p, { start: false });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "beacon.start" }));
    });
    expect(onAction).toHaveBeenLastCalledWith(p, { start: true });
  });

  it("측위를 기다리는 동안 버튼은 disabled가 아니라 aria-disabled이고(포커스 유지) 다시 눌러도 한 번만 넘긴다", async () => {
    let finish: () => void = () => {};
    const onAction = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<JourneyChatCard payload={payload()} onAction={onAction} />);
    const start = screen.getByRole("button", { name: "beacon.start" });
    start.focus();
    fireEvent.click(start);
    fireEvent.click(start);
    fireEvent.click(screen.getByRole("button", { name: "journey.openInDirections" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(start.getAttribute("aria-disabled")).toBe("true");
    expect((start as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(start);
    await act(async () => {
      finish();
    });
    expect(start.getAttribute("aria-disabled")).toBe("false");
  });

  it("버튼은 터치 타깃 44px(min-h-11)과 포커스 표시를 갖는다", () => {
    render(<JourneyChatCard payload={payload()} onAction={() => {}} />);
    for (const b of screen.getAllByRole("button")) {
      expect(b.className).toContain("min-h-11");
      expect(b.className).toContain("focus-visible:");
    }
  });
});

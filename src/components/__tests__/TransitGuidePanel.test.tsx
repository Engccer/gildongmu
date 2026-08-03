// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TransitRoute } from "@/lib/types";

/**
 * 대중교통 안내 패널·훅 통합(B2 §5): 시작 → 대기 목록(선택 가능·종착 차단) →
 * 탑승 선언 → 하차 추적 → 도착 → 다음 구간의 사용자 여정을 track API 목으로
 * 검증한다. 판정 자체는 상태 머신 fixture가 잠그므로 여기서는 배선(폴 대상 전환·
 * 목록 렌더·컨트롤 노출)만 본다.
 */
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, args?: Record<string, unknown>) =>
    args ? `${ns}.${key}:${Object.values(args).join(",")}` : `${ns}.${key}`,
}));

import { TransitGuidePanel } from "../TransitGuidePanel";

const ROUTE: TransitRoute = {
  summary: { totalMinutes: 30, fare: 1550, transfers: 0, walkMinutes: 6 },
  legs: [
    { mode: "walk", minutes: 3 },
    {
      mode: "subway",
      lineName: "수도권 5호선",
      fromName: "천호",
      toName: "여의도",
      stationCount: 8,
      minutes: 24,
      serviceWayCode: 2,
      stops: [
        { name: "천호", stationId: "547", lat: 37.5385, lng: 127.1235 },
        { name: "왕십리(성동구청)", stationId: "540", lat: 37.5613, lng: 127.0374 },
        { name: "여의도", stationId: "526", lat: 37.5216, lng: 126.924 },
      ],
    },
  ],
};

function trackItem(overrides: Record<string, unknown>) {
  return {
    vehicleId: "5696",
    direction: "하행",
    message: "[3]번째 전역 (길동)",
    remainingStops: 3,
    destinationName: "하남검단산",
    express: false,
    arrivalCode: "99",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TransitGuidePanel — 승차 대기·탑승·도착 여정", () => {
  it("시작 → 열차 목록(종착 차단 항목은 비버튼) → 탑승 → 하차 추적 → 도착 → 다음 구간 → 완료", async () => {
    const calls: string[] = [];
    let ridePollCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("phase=track") && url.includes("station=" + encodeURIComponent("천호"))) {
          // 승차역 대기 목록: 정상 후보 1 + 조기 종착 1
          return {
            ok: true,
            json: async () => ({
              mode: "subway",
              status: "ok",
              items: [
                trackItem({}),
                trackItem({ vehicleId: "5800", destinationName: "왕십리", message: "곧 도착" }),
              ],
            }),
          } as Response;
        }
        if (url.includes("station=" + encodeURIComponent("여의도"))) {
          // 하차역 추적: 1폴째 임박, 2폴째 도착
          ridePollCount += 1;
          return {
            ok: true,
            json: async () => ({
              mode: "subway",
              status: "ok",
              items: [
                ridePollCount === 1
                  ? trackItem({ message: "전역 출발", remainingStops: 1 })
                  : trackItem({ message: "여의도 도착", remainingStops: 0, arrivalCode: "1" }),
              ],
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));

    // 대기 목록: 정상 후보는 탑승 행위구 버튼, 조기 종착은 비활성 텍스트(§5.1)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /boardTrain/ })).toBeTruthy();
    });
    expect(screen.getByText(/terminatesEarly/)).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /boardTrain/ })).toHaveLength(1);

    // 탑승 선언 → 하차역 폴 전환 + 탑승 통지
    fireEvent.click(screen.getByRole("button", { name: /boardTrain/ }));
    await waitFor(() => {
      expect(calls.some((u) => u.includes(encodeURIComponent("여의도")))).toBe(true);
    });
    // 첫 하차 폴(잔여 1) → 추적 시작. 탑승 변경 컨트롤 노출.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "transitGuide.changeBoarding" })).toBeTruthy();
    });

    // 도착 폴은 타이머 뒤라 탑승 변경 → 재탑승으로 즉폴을 한 번 더 유도해 검증
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.changeBoarding" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /boardTrain/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /boardTrain/ }));

    // 2번째 하차 폴(arvlCd 1) → arrived → "다음 구간" 노출 + 포커스 선점(헌장 §5)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "transitGuide.advance" })).toBeTruthy();
    });
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("transitGuide.advance");
    });

    // 다음 구간(마지막 leg) → 세션 종료·트리거 복귀, 완료 통지는 live region에
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.advance" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "시작" })).toBeTruthy();
    });
    expect(screen.getByRole("status").textContent).toContain("transitGuide.done");
  });

  it("탑승 leg가 없으면(도보 전용) 렌더하지 않는다", () => {
    const walkOnly: TransitRoute = {
      summary: { totalMinutes: 10, fare: 0, transfers: 0, walkMinutes: 10 },
      legs: [{ mode: "walk", minutes: 10 }],
    };
    const { container } = render(<TransitGuidePanel route={walkOnly} triggerLabel="시작" />);
    expect(container.innerHTML).toBe("");
  });
});

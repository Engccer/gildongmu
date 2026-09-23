// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TransitRoute } from "@/lib/types";

/**
 * 승차 중 현재역(E35)의 **시간 축 배선** — 폴 여러 번에 걸친 `neverSeen` 경고 보류·처분을 가짜 시계로 밟는다.
 * 순수 판정은 공유 fixture(`transit-riding-position-cases.json`)가, 한 폴 안의 배선은 `TransitGuidePanel.test.tsx`
 * E35 두 건이 본다.
 */
vi.mock("next-intl", async () => (await import("./stable-intl-mock")).stableIntlMock("ko"));

import { TransitGuidePanelHost } from "./live-region-host";

const ROUTE: TransitRoute = {
  summary: { totalMinutes: 30, fare: 1550, transfers: 0, walkMinutes: 6 },
  routeKey: "p0",
  legs: [
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

/** [이미 탔어요] 식별 잠금으로 riding에 들어가 하차역 첫 폴까지(`TransitGuidePanel.test.tsx` 같은 이름 헬퍼와 같은 경로). */
async function boardTrainAndTrack(station = "천호") {
  const inner = globalThis.fetch;
  fireEvent.click(await screen.findByRole("button", { name: "transitGuide.boardAlready" }));
  let used = false;
  vi.stubGlobal("fetch", (async (...args: Parameters<typeof fetch>) => {
    const res = await inner(...args);
    if (used) return res;
    used = true;
    const body = await res.json();
    const items = (body.items ?? []).map((it: Record<string, unknown>) => ({ ...it, arrivalCode: "0" }));
    return { ok: true, json: async () => ({ ...body, items }) } as Response;
  }) as unknown as typeof fetch);
  fireEvent.click(await screen.findByRole("button", { name: station }));
  fireEvent.click((await screen.findAllByRole("button", { name: /selectTrain/ }))[0]);
  await waitFor(() => expect(screen.queryByRole("button", { name: /selectTrain/ })).toBeNull());
  vi.stubGlobal("fetch", inner);
}

const statusLine = () => {
  const el = document.querySelector<HTMLParagraphElement>(".rounded-md.border > p");
  expect(el, "상태 문장 행이 없다").toBeTruthy();
  return el as HTMLParagraphElement;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("승차 중 현재역 — 시간 축 배선(E35)", () => {
  it("승차 중 현재역(E35 §6 판정 2): 현재역이 보이는 동안 neverSeen 경고는 보류되고, 현재역을 잃으면 정확히 한 번 나온다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let positionFound = true;
      let alightPolls = 0;
      let positionPolls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.startsWith("/api/transit/position")) {
            positionPolls += 1;
            return {
              ok: true,
              json: async () =>
                positionFound
                  ? { status: "found", station: "왕십리(성동구청)", trainStatus: "3", dataAgeSeconds: 30 }
                  : { status: "notFound", total: 33 },
            } as Response;
          }
          if (url.includes("station=" + encodeURIComponent("천호"))) {
            return {
              ok: true,
              json: async () => ({ mode: "subway", status: "ok", rawCount: 1, items: [trackItem({})] }),
            } as Response;
          }
          alightPolls += 1;
          return { ok: true, json: async () => ({ mode: "subway", status: "empty", rawCount: 0 }) } as Response;
        }),
      );
      render(<TransitGuidePanelHost route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
      fireEvent.click(screen.getByRole("button", { name: "시작" }));
      await boardTrainAndTrack();
      await waitFor(() => expect(statusLine().textContent).toContain("transitGuide.currentStation"));

      // 폴 예약은 커밋 뒤에야 다음 타이머를 건다 — 시계를 한꺼번에 넘기면 한 번만 풀리므로 한 폴씩 넘긴다.
      const nextPoll = async () => {
        const before = positionPolls;
        const alightBefore = alightPolls;
        await vi.advanceTimersByTimeAsync(60_000);
        await waitFor(() => expect(alightPolls).toBeGreaterThan(alightBefore));
        // 위치 조회가 나가는 폴이면 그 응답의 반영까지 기다린다(보류 처분은 그 끝에서 돈다).
        await waitFor(() => expect(positionPolls).toBeGreaterThanOrEqual(before));
        await vi.advanceTimersByTimeAsync(50);
      };

      // 경고 문장이 live region에 새로 쓰인 횟수를 센다.
      const region = screen.getAllByRole("status")[0];
      let warnings = 0;
      const observer = new MutationObserver(() => {
        if (region.textContent?.includes("transitGuide.neverSeen")) warnings += 1;
      });
      observer.observe(region, { childList: true, characterData: true, subtree: true });

      // riding 미관측 10폴 → 리듀서가 neverSeen을 낸다. 현재역이 보여 경고는 보류된다.
      for (let i = 0; i < 11; i++) await nextPoll();
      expect(statusLine().textContent).toContain("transitGuide.currentStation");
      expect(warnings).toBe(0);

      // 현재역을 잃는다 — 보존 창(180초)이 지나면 그때 한 번.
      positionFound = false;
      for (let i = 0; i < 4; i++) await nextPoll();
      await waitFor(() => expect(warnings).toBe(1));
      expect(statusLine().textContent).not.toContain("transitGuide.currentStation");

      // 처분은 한 번으로 끝난다(보류 소거) — 다음 폴들이 다시 내지 않는다.
      for (let i = 0; i < 3; i++) await nextPoll();
      expect(warnings).toBe(1);
      observer.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });
});

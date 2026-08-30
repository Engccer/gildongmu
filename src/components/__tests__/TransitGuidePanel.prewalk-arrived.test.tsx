// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TransitRoute } from "@/lib/types";

/**
 * A25 승차 전 도보 — GPS 확정 도착 경로. DistanceBeacon을 "도착" 버튼 하나로 목킹해
 * `onSessionEnd("arrived")`가 패널의 arrived 분기(세션 시작 + 도착 문장 prefix + 도보 문맥
 * 제거)를 지나는지 본다. 선언 버튼 경로와 달리 `declaredRef` 없이 콜백만으로 이어져야 한다.
 */
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, args?: Record<string, unknown>) =>
    args ? `${ns}.${key}:${Object.values(args).join(",")}` : `${ns}.${key}`,
  useLocale: () => "ko",
}));
vi.mock("../DistanceBeacon", () => ({
  DistanceBeacon: ({ onSessionEnd }: { onSessionEnd?: (r: "arrived" | "ended") => void }) => (
    <div>
      <button type="button" onClick={() => onSessionEnd?.("arrived")}>
        fake-arrive
      </button>
      <button type="button" onClick={() => onSessionEnd?.("ended")}>
        fake-end
      </button>
    </div>
  ),
}));

import { TransitGuidePanel } from "../TransitGuidePanel";

const ROUTE: TransitRoute = {
  summary: { totalMinutes: 30, fare: 1550, transfers: 0, walkMinutes: 6 },
  routeKey: "p0",
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
        { name: "여의도", stationId: "526", lat: 37.5216, lng: 126.924 },
      ],
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubTrack() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        mode: "subway",
        status: "ok",
        rawCount: 1,
        items: [
          {
            vehicleId: "5696",
            direction: "하행",
            message: "[3]번째 전역 (길동)",
            remainingStops: 3,
            destinationName: "하남검단산",
            express: false,
            arrivalCode: "99",
          },
        ],
      }),
    }) as unknown as Response),
  );
}

describe("승차 전 도보 — GPS 도착 콜백(A25 §6)", () => {
  it("onSessionEnd('arrived') → 도착 문장 + 세션 시작, 대기 문맥에 도보 없음", async () => {
    stubTrack();
    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    fireEvent.click(screen.getByRole("button", { name: "fake-arrive" }));
    await screen.findByRole("button", { name: /selectTrain/ });
    const status = screen.getByRole("status").textContent ?? "";
    expect(status.startsWith("transitGuide.prewalkArrived:천호")).toBe(true);
    expect(status).toContain("transitGuide.started:1");
    expect(status).not.toContain("waitContextWalk");
    expect(screen.queryByRole("button", { name: "fake-arrive" })).toBeNull();
  });

  it("onSessionEnd('ended') → 세션 미시작 + 취소 문장 + 트리거 복귀", () => {
    stubTrack();
    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    fireEvent.click(screen.getByRole("button", { name: "fake-end" }));
    expect(screen.getByRole("status").textContent).toBe("transitGuide.prewalkCancelled");
    expect(screen.queryByRole("button", { name: /selectTrain/ })).toBeNull();
    expect(screen.getByRole("button", { name: "시작" })).toBeTruthy();
  });
});

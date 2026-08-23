// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
    params ? `${ns}.${key}${JSON.stringify(params)}` : `${ns}.${key}`,
  useLocale: () => "ko",
}));

import { StationTimetable } from "../StationTimetable";
import type { StationTimetable as Timetable } from "@/lib/types";

const UP = { direction: "up" as const, first: { time: "05:31", terminus: "방화" }, last: { time: "00:31", nextDay: true as const, terminus: "마천" } };

function stubTimetable(timetable: Timetable | null) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ timetable }) })));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StationTimetable — 노선 coverage 낭독(A19)", () => {
  it("ok 노선은 방향 행, unknown 노선은 '확인 불가' 한 줄 — 노선을 빼지 않는다", async () => {
    stubTimetable({
      stationName: "홍대입구",
      dailyType: "weekday",
      lines: [
        { lineName: "공항철도", coverage: "ok", directions: [UP] },
        { lineName: "2호선", coverage: "unknown", directions: [] },
      ],
    });
    render(<StationTimetable stationName="홍대입구" />);
    expect(await screen.findByText(/공항철도 timetable.direction.up/)).toBeTruthy();
    expect(screen.getByText('timetable.coverage.unknown{"line":"2호선"}')).toBeTruthy();
  });

  it("unavailable·noTrains도 각자 문구로 갈린다(운행 종료·0건과 다른 문장)", async () => {
    stubTimetable({
      stationName: "x",
      dailyType: "weekday",
      partial: true,
      lines: [
        { lineName: "A", coverage: "unavailable", directions: [] },
        { lineName: "B", coverage: "noTrains", directions: [] },
      ],
    });
    render(<StationTimetable stationName="x" />);
    expect(await screen.findByText('timetable.coverage.unavailable{"line":"A"}')).toBeTruthy();
    expect(screen.getByText('timetable.coverage.noTrains{"line":"B"}')).toBeTruthy();
    expect(screen.getByText(/timetable.partial/)).toBeTruthy();
  });

  it("미커버(null)는 섹션 미노출", async () => {
    stubTimetable(null);
    const { container } = render(<StationTimetable stationName="없는역" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("section")).toBeNull();
  });
});

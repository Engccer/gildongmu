// @vitest-environment jsdom
import { vi } from "vitest";

/** 로케일은 케이스마다 바꾼다(혼잡도 문장은 한국어 로케일 전용). */
const intl = vi.hoisted(() => ({ locale: "ko" }));

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => {
    const f = (key: string, params?: Record<string, unknown>) =>
      params ? `${ns}.${key}${JSON.stringify(params)}` : `${ns}.${key}`;
    return Object.assign(f, { rich: (key: string) => `${ns}.${key}` });
  },
  useLocale: () => intl.locale,
}));

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AirQuality as Air, Weather } from "@/lib/types";
import { LocalConditions } from "../LocalConditions";

const LAT = 37.4979;
const LNG = 127.0276;

const weather: Weather = {
  sky: { code: 1, label: "clear" },
  precipitation: { code: 0, label: "none" },
  tempC: 29,
  tempMax: 31,
  tempMin: 24,
  humidity: 60,
  precipProbability: 10,
  baseTime: "13:00",
  grid: { nx: 61, ny: 126 },
};

const air: Air = {
  stationName: "강남대로",
  distanceKm: 0.8,
  addr: "서울 강남구",
  dataTime: "2026-08-01 13:00",
  khai: { value: 55, grade: "moderate" },
  pm10: { value: 30, grade: "good" },
  pm25: { value: 12, grade: "good" },
};

const area = {
  code: "POI014",
  name: "강남역",
  level: "붐빔",
  message: "사람들이 몰려있을 가능성이 큽니다. 인구밀도가 높은 곳은 피하세요.",
  asOf: "2026-08-01 13:40",
};

/** 컴포넌트가 읽는 표면(`ok`·`json()`)만 갖춘 최소 Response. */
function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 502): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

type Replies = {
  weather?: Response;
  air?: Response;
  congestion?: Response;
};

let fetchMock: ReturnType<typeof vi.fn>;

function mockRoutes(replies: Replies) {
  fetchMock.mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.startsWith("/api/weather/")) {
      return replies.weather ?? jsonResponse({}, false);
    }
    if (url.startsWith("/api/air-quality/")) {
      return replies.air ?? jsonResponse({}, false);
    }
    if (url.startsWith("/api/congestion/")) {
      return replies.congestion ?? jsonResponse({}, false);
    }
    throw new Error(`예상 못한 요청: ${url}`);
  });
}

function renderConditions() {
  return render(<LocalConditions lat={LAT} lng={LNG} />);
}

/** 혼잡도 요약 `<p>`를 감싸는 블록(요약·문장·기준시각·출처를 담는 div). */
function congestionBlock(): HTMLElement {
  const summary = screen.getByText(/^congestion\.summary/);
  return summary.parentElement as HTMLElement;
}

beforeEach(() => {
  intl.locale = "ko";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LocalConditions 혼잡도", () => {
  it("등급어·문장·기준시각·출처를 낸다", async () => {
    mockRoutes({
      weather: jsonResponse({ weather }),
      air: jsonResponse({ air }),
      congestion: jsonResponse({ area }),
    });
    renderConditions();

    await waitFor(() => {
      expect(
        screen.getByText(
          `congestion.summary${JSON.stringify({ area: "강남역", level: "congestion.levels.busy" })}`,
        ),
      ).toBeTruthy();
    });
    expect(screen.getByText(area.message)).toBeTruthy();
    expect(
      screen.getByText(`congestion.asOf${JSON.stringify({ time: area.asOf })}`),
    ).toBeTruthy();
    expect(screen.getByText("congestion.source")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/congestion/nearby?lat=${LAT}&lng=${LNG}`,
      expect.anything(),
    );
  });

  it("영역 밖(area: null)이면 혼잡도 줄 자체가 없다", async () => {
    mockRoutes({
      weather: jsonResponse({ weather }),
      air: jsonResponse({ air }),
      congestion: jsonResponse({ area: null }),
    });
    renderConditions();

    // 날씨가 뜬 뒤에도 혼잡도 줄은 끝까지 없다(부재를 설명하지 않는다).
    await screen.findByText("weather.sky.clear, 29°C");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.queryByText(/^congestion\./)).toBeNull();
  });

  it("비한국어 로케일은 등급어만 내고 한국어 문장은 감춘다", async () => {
    intl.locale = "en";
    mockRoutes({
      weather: jsonResponse({ weather }),
      air: jsonResponse({ air }),
      congestion: jsonResponse({ area }),
    });
    renderConditions();

    await screen.findByText(/^congestion\.summary/);
    expect(screen.queryByText(area.message)).toBeNull();
    expect(screen.getByText("congestion.source")).toBeTruthy();
  });

  it("매핑에 없는 등급어는 원문을 그대로 낸다(정보 소실 금지)", async () => {
    mockRoutes({
      weather: jsonResponse({ weather }),
      air: jsonResponse({ air }),
      congestion: jsonResponse({ area: { ...area, level: "매우 붐빔" } }),
    });
    renderConditions();

    await screen.findByText(
      `congestion.summary${JSON.stringify({ area: "강남역", level: "매우 붐빔" })}`,
    );
  });

  it("인구수는 표시하지 않는다", async () => {
    mockRoutes({
      weather: jsonResponse({ weather }),
      air: jsonResponse({ air }),
      congestion: jsonResponse({
        // 라우트가 이미 제거하는 필드지만, 흘러들어와도 화면에 나오면 안 된다.
        area: { ...area, populationMin: 68000, populationMax: 76000 },
      }),
    });
    renderConditions();

    await screen.findByText(/^congestion\.summary/);
    const block = congestionBlock();
    expect(block.textContent).not.toContain("68000");
    expect(block.textContent).not.toContain("76000");
    // 줄 목록을 통째로 고정한다 — 인구수든 무엇이든 줄이 늘면 여기서 깨진다.
    expect(Array.from(block.querySelectorAll("p"), (p) => p.textContent)).toEqual([
      `congestion.summary${JSON.stringify({ area: "강남역", level: "congestion.levels.busy" })}`,
      area.message,
      `congestion.asOf${JSON.stringify({ time: area.asOf })}`,
      "congestion.source",
    ]);
  });

  it("혼잡도 502여도 날씨·공기질은 살아남는다(독립 fetch)", async () => {
    mockRoutes({
      weather: jsonResponse({ weather }),
      air: jsonResponse({ air }),
      congestion: jsonResponse({ error: "혼잡도 조회 실패" }, false),
    });
    renderConditions();

    await screen.findByText("weather.sky.clear, 29°C");
    expect(
      screen.getByText(
        `airQuality.station${JSON.stringify({ name: "강남대로", distance: 0.8 })}`,
      ),
    ).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.queryByText(/^congestion\./)).toBeNull();
  });

  it("날씨·공기질이 죽어도 혼잡도만으로 카드를 낸다", async () => {
    mockRoutes({
      weather: jsonResponse({ error: "실패" }, false),
      air: jsonResponse({ error: "실패" }, false),
      congestion: jsonResponse({ area }),
    });
    renderConditions();

    await screen.findByText(/^congestion\.summary/);
    expect(screen.getByRole("heading", { level: 3 })).toBeTruthy();
  });

  it("혼잡도 줄 안에 인라인 span이 없다(한 줄 = 한 접근성 객체)", async () => {
    mockRoutes({
      weather: jsonResponse({ weather }),
      air: jsonResponse({ air }),
      congestion: jsonResponse({ area }),
    });
    renderConditions();

    await screen.findByText(/^congestion\.summary/);
    const block = congestionBlock();
    expect(block.querySelectorAll("span").length).toBe(0);
    expect(block.querySelectorAll("p").length).toBe(4);
  });
});

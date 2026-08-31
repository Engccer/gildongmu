// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TransitRoute } from "@/lib/types";

/**
 * en 로케일 패널 배선(E27 잔여 ①, spec 2026-09-01 §5.3 행동 축).
 *
 * 여기서 보는 것은 판정이 아니라 **배선**이다 — 판정은 descriptor fixture가 잠근다.
 * ① 안내가 en에서 시작 가능한가 ② 영문 조각이 실제로 화면에 나오는가
 * ③ 폴링 URL에 `lang=en`이 실리는가 ④ 한국어 폴백 줄에 `lang="ko"`가 붙는가.
 */
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, args?: Record<string, unknown>) =>
    args ? `${ns}.${key}:${Object.values(args).join(",")}` : `${ns}.${key}`,
  useLocale: () => "en",
}));

import { TransitGuidePanel } from "../TransitGuidePanel";

const ROUTE: TransitRoute = {
  summary: { totalMinutes: 30, fare: 1550, transfers: 0, walkMinutes: 6 },
  routeKey: "p0",
  legs: [
    {
      mode: "subway",
      lineName: "수도권 5호선",
      lineNameEn: "Line 5",
      fromName: "천호",
      fromNameEn: "Cheonho",
      toName: "여의도",
      toNameEn: "Yeouido",
      minutes: 24,
      stationCount: 8,
      serviceWayCode: 2,
      stops: [
        { name: "천호", nameEn: "Cheonho", lat: 37.538, lng: 127.123 },
        { name: "왕십리", nameEn: "Wangsimni", lat: 37.561, lng: 127.037 },
        { name: "여의도", nameEn: "Yeouido", lat: 37.521, lng: 126.924 },
      ],
    },
  ],
} as unknown as TransitRoute;

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

function mockPoll(items: unknown[]) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ mode: "subway", status: items.length ? "ok" : "empty", items, rawCount: items.length }),
  });
}

async function startSession() {
  render(<TransitGuidePanel route={ROUTE} triggerLabel="start" walkAccessible={false} />);
  fireEvent.click(screen.getByRole("button", { name: "start" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
}

describe("en 로케일 대중교통 안내 배선", () => {
  it("en에서 안내를 시작할 수 있고 폴링 URL에 lang=en이 실린다", async () => {
    mockPoll([]);
    await startSession();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("lang=en");
    // ⚠ 조인 값은 en 세션에서도 한국어 원문이다 — 이 값으로 실시간 매핑이 돈다.
    expect(decodeURIComponent(url)).toContain("station=천호");
    expect(decodeURIComponent(url)).toContain("line=수도권 5호선");
  });

  it("상시 표시가 영문 조각으로 조립되고 ko 태그가 붙지 않는다", async () => {
    mockPoll([]);
    await startSession();
    // 상시 표시 줄(신호 상태를 함께 담는 쪽)만 고른다 — live region도 같은 문맥 문장을 담는다.
    const status = await screen.findByText(
      /transitGuide\.waitContext:Cheonho,Line 5 transitGuide\.stateNotYetVisible/,
    );
    expect(status.getAttribute("lang")).toBeNull();
  });

  it("영문 조각이 없으면 그 줄은 한국어 값 + lang=ko", async () => {
    const koRoute = {
      ...ROUTE,
      legs: [{ ...ROUTE.legs[0], lineNameEn: undefined }],
    } as unknown as TransitRoute;
    mockPoll([]);
    render(<TransitGuidePanel route={koRoute} triggerLabel="start" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    const el = await screen.findByText(
      /transitGuide\.waitContext:천호,수도권 5호선 transitGuide\.stateNotYetVisible/,
    );
    // 노선명 영문이 없으므로 줄 전체가 ko — 영어 엔진이 한글을 만나면 침묵하기 때문이다.
    expect(el.getAttribute("lang")).toBe("ko");
  });

  it("대기 후보 목록이 영문 도착 문장을 쓴다", async () => {
    mockPoll([
      {
        vehicleId: "5696",
        direction: "하행",
        directionEn: "Down",
        message: "[3]번째 전역",
        messageEn: "3 stations away",
        remainingStops: 3,
        destinationName: "마천",
        destinationNameEn: "Macheon",
        express: false,
        arrivalCode: "99",
      },
    ]);
    await startSession();
    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: /transitGuide\.bound:Macheon, Down, 3 stations away/,
        }),
      ).toBeTruthy();
    });
  });
});

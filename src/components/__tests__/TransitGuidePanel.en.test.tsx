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

// 패널·비콘은 자기 live region을 두지 않는다(A40) — 창구 숙주로 감싸 렌더한다.
import { TransitGuidePanelHost } from "./live-region-host";
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
  render(<TransitGuidePanelHost route={ROUTE} triggerLabel="start" walkAccessible={false} />);
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
    // 상시 표시 줄(갱신 시각을 함께 담는 쪽)만 고른다 — live region도 같은 문맥 문장을 담는다.
    // ⚠ E39로 대기 국면의 `stateNotYetVisible`은 사라졌다(그 국면 내내 고정이라 정보가 0).
    const status = await screen.findByText(
      /transitGuide\.waitContext:Cheonho,Line 5 transitGuide\.lastUpdated/,
    );
    expect(status.getAttribute("lang")).toBeNull();
  });

  it("영문 조각이 없으면 그 줄은 한국어 값 + lang=ko", async () => {
    const koRoute = {
      ...ROUTE,
      legs: [{ ...ROUTE.legs[0], lineNameEn: undefined }],
    } as unknown as TransitRoute;
    mockPoll([]);
    render(<TransitGuidePanelHost route={koRoute} triggerLabel="start" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    const el = await screen.findByText(
      /transitGuide\.waitContext:천호,수도권 5호선 transitGuide\.lastUpdated/,
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

describe("live region 단일성 (헌장: 통지 객체는 플랫폼당 하나)", () => {
  it("패널은 자기 live region을 0개 낸다 — 통지는 화면의 창구로 나간다", async () => {
    mockPoll([]);
    // ⚠ 숙주 없이 패널만 렌더한다(A40). 종전엔 이 패널이 자기 region을 들고 있었고,
    // 길찾기 뷰의 창구와 겹쳐 발화가 경합했다. 이제 통지는 `announce`로만 나가므로
    // 패널이 문서에 남기는 live 객체는 0이어야 한다.
    const seen: string[] = [];
    const { container } = render(
      <TransitGuidePanel
        route={ROUTE}
        triggerLabel="start"
        walkAccessible={false}
        announce={(text) => seen.push(text)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // `lang`을 붙인 표시 행들이 live로 승격되지 않았는지도 함께 본다 — 승격되면 같은
    // 상태가 두 번 낭독된다(헌장 §5 "이미 보이는 콘텐츠를 live region에 복제하지 말 것").
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(0);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
    // 그렇다고 침묵이면 안 된다 — 세션 시작 문장은 창구로 나가야 한다.
    await waitFor(() =>
      expect(seen.some((t) => t.startsWith("transitGuide.started"))).toBe(true),
    );
  });
});

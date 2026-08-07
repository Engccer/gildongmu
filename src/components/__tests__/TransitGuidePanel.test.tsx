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
  // 핸드오프가 마운트하는 DistanceBeacon(useRouteGuide)의 로케일 의존.
  useLocale: () => "ko",
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
  vi.restoreAllMocks();
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

    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
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

  it("0건 사유 3-state와 새로고침 직접 응답 통지(§13.2·§13.3)", async () => {
    let waitMode: "none" | "filtered" | "fail" | "ok" = "none";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (waitMode === "fail") return { ok: false } as Response;
        if (waitMode === "ok") {
          return {
            ok: true,
            json: async () => ({ mode: "subway", status: "ok", rawCount: 2, items: [trackItem({})] }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({
            mode: "subway",
            status: "empty",
            rawCount: waitMode === "filtered" ? 3 : 0,
          }),
        } as Response;
      }),
    );

    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));

    // 진짜 0건(rawCount 0) — 현행 문구
    await waitFor(() => {
      expect(screen.getByText("transitGuide.noCandidates")).toBeTruthy();
    });

    // 필터 전멸(rawCount>0): 목록 자리는 사유, 새로고침 응답은 후보 수(§13.2 ① —
    // 사유 문장을 통지·화면 두 곳에 복제하지 않는다, 감사 M4)
    waitMode = "filtered";
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.refresh" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("transitGuide.waitingCount:0");
    });
    expect(screen.getAllByText("transitGuide.noCandidatesFiltered")).toHaveLength(1);

    // 조회 실패 — 실패는 "0개"가 아니라 사유 문장으로(3-state), 침묵하지 않는다
    waitMode = "fail";
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.refresh" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("transitGuide.noCandidatesUnavailable");
    });

    // 후보 있음 — 후보 수 통지
    waitMode = "ok";
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.refresh" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("transitGuide.waitingCount:1");
    });
  });

  it("탑승 변경 취소(§13.1): 직전 잠금으로 재탑승, 목록 포커스 소실은 라벨 복귀(§13.4)", async () => {
    let waitItems: Record<string, unknown>[] = [trackItem({})];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("station=" + encodeURIComponent("천호"))) {
          return {
            ok: true,
            json: async () =>
              waitItems.length > 0
                ? { mode: "subway", status: "ok", rawCount: waitItems.length, items: waitItems }
                : { mode: "subway", status: "empty", rawCount: 0 },
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({
            mode: "subway",
            status: "ok",
            rawCount: 1,
            items: [trackItem({ message: "전역 출발", remainingStops: 1 })],
          }),
        } as Response;
      }),
    );

    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /boardTrain/ })).toBeTruthy();
    });

    // 탑승 → 탑승 변경 → 취소 버튼 노출 → 취소 = 직전 잠금 재탑승(riding 복귀)
    fireEvent.click(screen.getByRole("button", { name: /boardTrain/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "transitGuide.changeBoarding" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.changeBoarding" }));
    const cancel = await screen.findByRole("button", { name: "transitGuide.cancelChangeBoarding" });
    fireEvent.click(cancel);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "transitGuide.changeBoarding" })).toBeTruthy();
    });
    // 탑승 계열 전이는 대기 컨트롤을 제거한다 — riding 컨트롤 선점(§13.4, 감사 M2).
    // useLayoutEffect 포커스라 동기 단언 가능(jsdom flake 메모).
    expect(document.activeElement?.textContent).toBe("transitGuide.changeBoarding");

    // 다시 대기로 돌아가 목록 항목에 포커스를 얹고, 폴 갱신으로 항목이 사라지면
    // 라벨로 선점 복귀한다(§13.4 — 제거된 요소는 blur 없이 body로 이탈한다).
    // 소실 항목은 3분 유지 버퍼가 붙잡으므로(§5.1) 시계를 그 너머로 전진시킨다.
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.changeBoarding" }));
    const boardButton = await screen.findByRole("button", { name: /boardTrain/ });
    boardButton.focus();
    waitItems = [];
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => realNow + 200_000);
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.refresh" }));
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("transitGuide.waitingLabel");
    });
  });

  it("이미 탑승했습니다(§13.2): 근사 잠금 — advance 상시·근사 주석·arrived 미전이", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("station=" + encodeURIComponent("천호"))) {
          return {
            ok: true,
            json: async () => ({ mode: "subway", status: "empty", rawCount: 0 }),
          } as Response;
        }
        // 하차역: 반대 방향 임박 + 같은 방향 원거리 — 방향 필터로 하행만 매칭돼야 한다
        return {
          ok: true,
          json: async () => ({
            mode: "subway",
            status: "ok",
            rawCount: 2,
            items: [
              trackItem({ vehicleId: "9001", direction: "상행", message: "여의도 도착", remainingStops: 0, arrivalCode: "1" }),
              trackItem({ message: "[4]번째 전역 (영등포시장)", remainingStops: 4 }),
            ],
          }),
        } as Response;
      }),
    );

    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    const already = await screen.findByRole("button", { name: "transitGuide.boardAlready" });
    fireEvent.click(already);

    // 근사 잠금: advance 상시 노출 + 근사 주석. 반대 방향 arvlCd "1"은 무시(방향
    // 필터)라 arrived로 넘어가지 않고 riding에 머문다(탑승 변경도 유지).
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "transitGuide.advance" })).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "transitGuide.changeBoarding" })).toBeTruthy();
    expect(screen.getByText(/approxNote/)).toBeTruthy();
    expect(screen.getByText(/remainingCount:4/)).toBeTruthy();
  });

  it("경유역 목록(§14.1): disclosure 정적 표시 + 승차·하차 라벨 + 현재 위치 병치", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("station=" + encodeURIComponent("천호"))) {
          return {
            ok: true,
            json: async () => ({ mode: "subway", status: "ok", rawCount: 1, items: [trackItem({})] }),
          } as Response;
        }
        // 하차 추적: 현재 위치(arvlMsg3) 왕십리 — 경유 목록의 탑승 위치 축(§12.2 결합)
        return {
          ok: true,
          json: async () => ({
            mode: "subway",
            status: "ok",
            rawCount: 1,
            items: [
              trackItem({
                message: "[2]번째 전역 (한양대)",
                remainingStops: 2,
                currentLocation: "왕십리",
              }),
            ],
          }),
        } as Response;
      }),
    );

    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));

    // 대기 국면에도 disclosure는 보이고(정적 목록), 펼치면 승차·하차 라벨이 붙는다.
    const via = await screen.findByRole("button", { name: "transitGuide.viaStopsTrain:3" });
    expect(via.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(via);
    expect(via.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("천호, transitGuide.viaBoard")).toBeTruthy();
    expect(screen.getByText("여의도, transitGuide.viaAlight")).toBeTruthy();
    expect(screen.getByText("왕십리(성동구청)")).toBeTruthy();

    // 탑승 → 하차 폴의 currentLocation이 경유 목록에 현재 위치로 병치된다.
    fireEvent.click(screen.getByRole("button", { name: /boardTrain/ }));
    await waitFor(() => {
      expect(screen.getByText("왕십리(성동구청), transitGuide.viaCurrent")).toBeTruthy();
    });
  });

  it("도보 핸드오프(§14.2): 완료 시 '남은 도보 안내 시작' 노출 + 포커스 선점", async () => {
    // DistanceBeacon은 geolocation 미지원이면 렌더하지 않으므로 스텁이 전제다.
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(), clearWatch: vi.fn() },
      configurable: true,
    });
    const routeWithTailWalk: TransitRoute = {
      ...ROUTE,
      legs: [...ROUTE.legs, { mode: "walk", minutes: 5 }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("station=" + encodeURIComponent("천호"))) {
          return {
            ok: true,
            json: async () => ({ mode: "subway", status: "ok", rawCount: 1, items: [trackItem({})] }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({
            mode: "subway",
            status: "ok",
            rawCount: 1,
            items: [trackItem({ message: "여의도 도착", remainingStops: 0, arrivalCode: "1" })],
          }),
        } as Response;
      }),
    );

    render(
      <TransitGuidePanel
        route={routeWithTailWalk}
        triggerLabel="시작"
        dest={{ lat: 37.5216, lng: 126.924, name: "여의도" }}
        walkAccessible={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    const board = await screen.findByRole("button", { name: /boardTrain/ });
    fireEvent.click(board);

    // 도착 관측 → 다음 구간 → done: 세션은 접히고 핸드오프 트리거가 포커스를 받는다.
    const advance = await screen.findByRole("button", { name: "transitGuide.advance" });
    fireEvent.click(advance);
    const handoff = await screen.findByRole("button", { name: "transitGuide.walkHandoffStart" });
    expect(document.activeElement).toBe(handoff);
    // 완료 통지는 기존 계약 그대로(말미 도보 병기).
    expect(screen.getByRole("status").textContent).toContain("transitGuide.doneWalk:5");
    // 트리거도 함께 복귀해 재시작 경로가 남는다.
    expect(screen.getByRole("button", { name: "시작" })).toBeTruthy();
  });

  it("탑승 leg가 없으면(도보 전용) 렌더하지 않는다", () => {
    const walkOnly: TransitRoute = {
      summary: { totalMinutes: 10, fare: 0, transfers: 0, walkMinutes: 10 },
      routeKey: "p0",
      legs: [{ mode: "walk", minutes: 10 }],
    };
    const { container } = render(
      <TransitGuidePanel route={walkOnly} triggerLabel="시작" walkAccessible={false} />,
    );
    expect(container.innerHTML).toBe("");
  });
});

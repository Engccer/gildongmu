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

/** 승차 전 도보 없는 경로 — 종전 여정 테스트의 기본(A25 이후 선행 도보는 도보 안내를 먼저 돈다). */
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

const SUBWAY_LEG = ROUTE.legs[0];

/**
 * 종전 "탑승" 한 번 = 지금의 "선택 → 탑승했습니다" 두 번(N3: 탑승은 차량 선택이고
 * riding 승격은 승차 정류소 도착 관측 또는 선언). 종전 riding 궤적을 보존하는 헬퍼.
 */
async function boardTrain() {
  fireEvent.click(await screen.findByRole("button", { name: /selectTrain/ }));
  fireEvent.click(await screen.findByRole("button", { name: "transitGuide.confirmBoarded" }));
}

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
  it("시작하면 사라진 트리거 대신 상태 텍스트에 커서가 착지한다(B4)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ mode: "subway", status: "ok", items: [trackItem({})] }),
      })) as unknown as typeof fetch,
    );
    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    const trigger = screen.getByRole("button", { name: "시작" });
    trigger.focus();
    fireEvent.click(trigger);
    // 트리거는 unmount됐고 커서는 body가 아니라 세션 상태 텍스트에 있다.
    expect(screen.queryByRole("button", { name: "시작" })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.tagName).toBe("P");
    await screen.findByRole("button", { name: /selectTrain/ });
  });

  it("탑승 변경은 지금 있는 역을 묻고, 고른 역이 조회 기준이 된다(A16 L3)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        return {
          ok: true,
          json: async () => ({ mode: "subway", status: "ok", items: [trackItem({})] }),
        } as Response;
      }),
    );

    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await boardTrain();
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.changeBoarding" }));

    // 역 선택 단계: 경유역 전체가 후보이고 프롬프트가 착지점이다(버튼이 사라지는 전이).
    expect(screen.getByRole("heading", { name: "transitGuide.reboardStationPrompt" })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("transitGuide.reboardStationPrompt");
    const candidate = screen.getByRole("button", { name: "왕십리(성동구청)" });
    // 역명은 한국어 원문 — en 페이지에서도 한국어 엔진으로 읽히게 lang="ko"(A26).
    expect(candidate.getAttribute("lang")).toBe("ko");

    // 중간역을 고르면 그 역이 조회 기준이 된다 — 종전에는 원래 승차역(천호)만 봤다.
    calls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "왕십리(성동구청)" }));
    await waitFor(() => {
      expect(
        calls.some((u) => u.includes("station=" + encodeURIComponent("왕십리(성동구청)"))),
      ).toBe(true);
    });
    expect(calls.some((u) => u.includes("station=" + encodeURIComponent("천호")))).toBe(false);
  });

  it("환승하면 고른 기준 역이 다음 구간으로 따라오지 않는다(A16 L3)", async () => {
    // leg1에 중간역을 두어 승차역과 다른 역을 고를 수 있게 한다 — 같은 역을 고르면
    // 소거 여부와 무관하게 같은 URL이 나와 검증이 무력해진다(변이 주입으로 확인).
    const transferRoute: TransitRoute = {
      ...ROUTE,
      legs: [
        {
          ...SUBWAY_LEG,
          toName: "왕십리(성동구청)",
          stops: [
            { name: "천호", stationId: "547", lat: 37.5385, lng: 127.1235 },
            { name: "군자", stationId: "544", lat: 37.5573, lng: 127.0794 },
            { name: "왕십리(성동구청)", stationId: "540", lat: 37.5613, lng: 127.0374 },
          ],
        },
        {
          ...SUBWAY_LEG,
          lineName: "수도권 2호선",
          fromName: "왕십리(성동구청)",
          toName: "강남",
          stops: [
            { name: "왕십리(성동구청)", stationId: "540", lat: 37.5613, lng: 127.0374 },
            { name: "강남", stationId: "222", lat: 37.4979, lng: 127.0276 },
          ],
        },
      ],
    };

    const calls: string[] = [];
    // leg1 하차역 추적은 첫 폴을 임박으로 둔다 — 곧바로 도착시키면 국면이 arrived로
    // 넘어가 재선택 UI가 렌더되지 않는다(riding 전용 컨트롤).
    let ridePolls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        const onLeg1Alight =
          url.includes("station=" + encodeURIComponent("왕십리(성동구청)")) &&
          url.includes("line=" + encodeURIComponent("수도권 5호선"));
        if (onLeg1Alight) ridePolls += 1;
        const arrived = onLeg1Alight && ridePolls > 1;
        return {
          ok: true,
          json: async () => ({
            mode: "subway",
            status: "ok",
            items: [
              arrived
                ? trackItem({ message: "왕십리 도착", remainingStops: 0, arrivalCode: "1" })
                : onLeg1Alight
                  ? trackItem({ message: "전역 출발", remainingStops: 1 })
                  : trackItem({}),
            ],
          }),
        } as Response;
      }),
    );

    render(<TransitGuidePanel route={transferRoute} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await boardTrain();

    // 중간역(군자)을 기준으로 재선택한 뒤 다시 탑승한다.
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.changeBoarding" }));
    fireEvent.click(await screen.findByRole("button", { name: "군자" }));
    await boardTrain();

    // 도착 → 다음 구간으로 전진하면 leg2의 대기 조회는 leg2 승차역을 봐야 한다.
    // ⚠ 비우는 시점은 클릭 **전**이다 — advance는 즉폴이라 클릭 직후 비우면 그 조회가
    // 지워진다(이 테스트를 처음 쓸 때 실제로 그렇게 놓쳤다).
    calls.length = 0;
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.advance" }));
    await waitFor(() => {
      expect(calls.some((u) => u.includes("line=" + encodeURIComponent("수도권 2호선")))).toBe(true);
    });
    const leg2Calls = calls.filter((u) => u.includes("line=" + encodeURIComponent("수도권 2호선")));
    expect(leg2Calls.some((u) => u.includes("station=" + encodeURIComponent("군자")))).toBe(false);
    expect(
      leg2Calls.some((u) => u.includes("station=" + encodeURIComponent("왕십리(성동구청)"))),
    ).toBe(true);
  });

  it("재선택 뒤 상시 표시 문맥이 조회 대상 역과 같은 역을 말한다(A16 L3, 리뷰 MAJOR)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({ mode: "subway", status: "ok", items: [trackItem({})] }),
          }) as Response,
      ),
    );

    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await boardTrain();
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.changeBoarding" }));
    fireEvent.click(await screen.findByRole("button", { name: "왕십리(성동구청)" }));

    // 목록 항목엔 역명이 없으므로(전 목록이 한 역 기준) 이 문장이 SR 사용자에게
    // 그 화면의 유일한 역 정보원이다 — 조회 대상과 어긋나면 되돌릴 수단이 없다.
    await waitFor(() => {
      expect(screen.getByText(/waitContext:왕십리\(성동구청\)/)).toBeTruthy();
    });
    expect(screen.queryByText(/waitContext.*천호/)).toBeNull();
    // 선행 도보는 원래 승차역까지의 구간이라 재선택 뒤에는 이미 지난 일이다.
    expect(screen.queryByText(/waitContextWalk/)).toBeNull();
  });

  it("픽커를 연 채 국면이 바뀌면 다음 구간에서 되살아나지 않는다(A16 L3, 리뷰 MAJOR)", async () => {
    // 리뷰가 준 재현 경로: 픽커를 연 채 riding을 벗어나면 화면에서는 사라지지만
    // 플래그가 남아, 다음 riding 진입에서 묻지도 않은 역 선택 화면이 되살아난다.
    // 국면 왕복은 근사 잠금("이미 탑승했습니다")으로 만든다 — 그 잠금은 riding에서
    // advance를 상시 노출하므로 폴 주기(15초)를 기다리지 않고 전이시킬 수 있다.
    const twoLegs: TransitRoute = {
      ...ROUTE,
      legs: [
        { ...SUBWAY_LEG, toName: "왕십리(성동구청)" },
        { ...SUBWAY_LEG, lineName: "수도권 2호선", fromName: "왕십리(성동구청)", toName: "강남" },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({ mode: "subway", status: "ok", items: [trackItem({})] }),
          }) as Response,
      ),
    );

    render(<TransitGuidePanel route={twoLegs} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.boardAlready" }));

    // riding 국면에서 픽커를 연다(근사 잠금이라 advance도 함께 떠 있다).
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.changeBoarding" }));
    expect(screen.getByRole("heading", { name: "transitGuide.reboardStationPrompt" })).toBeTruthy();

    // 픽커를 연 채 다음 구간으로 — 국면이 바뀌며 플래그도 함께 내려가야 한다.
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.advance" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "transitGuide.boardAlready" })).toBeTruthy();
    });

    // 다시 탑승해도 되살아나지 않고, 그 자리엔 탑승 변경 버튼이 있다.
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.boardAlready" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "transitGuide.changeBoarding" })).toBeTruthy();
    });
    expect(screen.queryByRole("heading", { name: "transitGuide.reboardStationPrompt" })).toBeNull();
  });

  it("역 선택 취소는 아무것도 바꾸지 않고 눌렀던 자리로 돌려보낸다(A16 L3)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({ mode: "subway", status: "ok", items: [trackItem({})] }),
          }) as Response,
      ),
    );

    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await boardTrain();
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.changeBoarding" }));
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.reboardCancel" }));

    // 국면은 riding 그대로(열차 목록으로 떨어지지 않는다).
    expect(screen.queryByRole("button", { name: /selectTrain/ })).toBeNull();
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("transitGuide.changeBoarding");
    });
  });

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
      expect(screen.getByRole("button", { name: /selectTrain/ })).toBeTruthy();
    });
    expect(screen.getByText(/terminatesEarly/)).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /selectTrain/ })).toHaveLength(1);

    // 탑승 선언 → 하차역 폴 전환 + 탑승 통지
    await boardTrain();
    await waitFor(() => {
      expect(calls.some((u) => u.includes(encodeURIComponent("여의도")))).toBe(true);
    });
    // 첫 하차 폴(잔여 1) → 추적 시작. 탑승 변경 컨트롤 노출.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "transitGuide.changeBoarding" })).toBeTruthy();
    });

    // 도착 폴은 타이머 뒤라 탑승 변경 → 재탑승으로 즉폴을 한 번 더 유도해 검증.
    // 탑승 변경은 이제 "지금 어느 역인가"를 먼저 묻는다(A16 L3) — 원래 승차역을 고른다.
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.changeBoarding" }));
    fireEvent.click(await screen.findByRole("button", { name: "천호" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /selectTrain/ })).toBeTruthy();
    });
    await boardTrain();

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
      expect(screen.getByRole("button", { name: /selectTrain/ })).toBeTruthy();
    });

    // 탑승 → 탑승 변경 → 취소 버튼 노출 → 취소 = 직전 잠금 재탑승(riding 복귀)
    await boardTrain();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "transitGuide.changeBoarding" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.changeBoarding" }));
    fireEvent.click(await screen.findByRole("button", { name: "천호" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "천호" }));
    const boardButton = await screen.findByRole("button", { name: /selectTrain/ });
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
    // A27: 지하철 99(운행중)는 "까지 {원문}" 프레임을 내지 않고 잔여 수 문장으로 떨어진다 — 통지·상태줄 둘 다.
    expect(screen.getAllByText(/remainingCount:4/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/messageFrame/)).toBeNull();
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
    await boardTrain();
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
    await boardTrain();

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

describe("빠른하차 — 대기 국면 발견 경로", () => {
  function stubWaiting() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ mode: "subway", status: "ok", items: [trackItem({})] }),
      })) as unknown as typeof fetch,
    );
  }

  const withQuickExit: TransitRoute = {
    ...ROUTE,
    legs: [
      {
        ...SUBWAY_LEG,
        quickExit: {
          elevator: { kind: "door", doors: ["6-4"] },
          stairs: { kind: "door", doors: ["5-4"] },
        },
      },
    ],
  };

  it("열차 목록 앞에 나온다(포커스 착지점 다음 자리)", async () => {
    stubWaiting();
    const { container } = render(
      <TransitGuidePanel route={withQuickExit} triggerLabel="시작" walkAccessible={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /selectTrain/ })).toBeTruthy();
    });
    const line = screen.getByText(/quickExitBoth/);
    const list = container.querySelector("ul")!;
    // compareDocumentPosition: 문장이 목록보다 앞이면 FOLLOWING 비트가 선다.
    expect(line.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 착지점(waitingLabel)보다는 뒤여야 앞으로 스와이프해서 만난다.
    const label = screen.getByText("transitGuide.waitingLabel");
    expect(label.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("통지를 만들지 않는다(정적 정보라 상태 변화가 없다)", async () => {
    stubWaiting();
    render(<TransitGuidePanel route={withQuickExit} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /selectTrain/ })).toBeTruthy();
    });
    expect(screen.getByText(/quickExitBoth/).closest("[aria-live]")).toBeNull();
    expect(screen.getByRole("status").textContent).not.toContain("quickExit");
  });

  it("값이 없으면 자리 자체가 없다", async () => {
    stubWaiting();
    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /selectTrain/ })).toBeTruthy();
    });
    expect(screen.queryByText(/quickExit/)).toBeNull();
  });
});

describe("승차 전 도보 핸드오프(A25, spec 2026-08-30 §6)", () => {
  const ROUTE_WALK: TransitRoute = { ...ROUTE, legs: [{ mode: "walk", minutes: 3 }, ...ROUTE.legs] };
  function stubGeo() {
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
      configurable: true,
    });
  }
  function stubTrack() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ mode: "subway", status: "ok", rawCount: 1, items: [trackItem({})] }),
      }) as unknown as Response),
    );
  }

  it("선행 도보가 있으면 시작은 세션이 아니라 승차역 도보 안내를 연다", async () => {
    stubGeo();
    stubTrack();
    render(<TransitGuidePanel route={ROUTE_WALK} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    // 도보 안내 트리거(DistanceBeacon)와 선언 버튼이 뜨고, 열차 목록은 없다.
    expect(screen.getByRole("button", { name: "transitGuide.prewalkArrivedButton:천호" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /selectTrain/ })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("transitGuide.prewalkStart:천호,3");
    expect(screen.queryByRole("button", { name: "시작" })).toBeNull();
  });

  it("승차역 도착 선언 → 세션 시작, 대기 문맥에 도보가 없다", async () => {
    stubGeo();
    stubTrack();
    render(<TransitGuidePanel route={ROUTE_WALK} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.prewalkArrivedButton:천호" }));
    await screen.findByRole("button", { name: /selectTrain/ });
    const status = screen.getByRole("status").textContent ?? "";
    expect(status).toContain("transitGuide.prewalkArrived:천호");
    expect(status).toContain("transitGuide.started:1");
    expect(status).not.toContain("waitContextWalk");
    expect(screen.queryByRole("button", { name: /prewalkArrivedButton/ })).toBeNull();
  });

  it("도보 안내를 사용자가 중지하면 전체 종료 — 세션은 시작되지 않고 취소 문장", async () => {
    stubGeo();
    stubTrack();
    render(<TransitGuidePanel route={ROUTE_WALK} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    // DistanceBeacon 트리거(startOnOpen)로 도보 세션 시작 → 같은 버튼이 중지로 바뀐다.
    fireEvent.click(screen.getByRole("button", { name: "beacon.walkHeading" }));
    fireEvent.click(await screen.findByRole("button", { name: "beacon.stop" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("transitGuide.prewalkCancelled"),
    );
    expect(screen.queryByRole("button", { name: /selectTrain/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /prewalkArrivedButton/ })).toBeNull();
    expect(screen.getByRole("button", { name: "시작" })).toBeTruthy();
  });

  it("선행 도보가 없으면 종전대로 곧바로 세션이 시작된다", async () => {
    stubTrack();
    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await screen.findByRole("button", { name: /selectTrain/ });
    expect(screen.queryByRole("button", { name: /prewalkArrivedButton/ })).toBeNull();
  });
});

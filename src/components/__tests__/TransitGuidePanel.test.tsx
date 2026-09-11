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
 * 종전 "탑승" 한 번 = 지금의 "선택 → 승차역 도착 관측"(N3 ① 2026-09-11: 선언 버튼이 사라져 riding
 * 승격은 관측뿐이다). 선택 직후 나가는 첫 boarding 폴의 응답만 **도착 레코드**로 바꿔 종전 riding
 * 궤적을 보존한다 — 호출부의 fetch 목은 그대로 지나간다(URL 수집·분기 보존).
 *
 * ⚠ 이 헬퍼는 **riding 진입까지**다. riding 첫 폴은 주기 뒤(미등장 60초)라 실제 시계 테스트에서
 * 기다릴 수 없다 — 하차역 조회가 필요한 테스트는 `boardTrainAndTrack`을 쓴다.
 */
async function boardTrain(select: RegExp = /selectTrain/) {
  const inner = globalThis.fetch;
  let used = false;
  vi.stubGlobal("fetch", (async (...args: Parameters<typeof fetch>) => {
    const res = await inner(...args);
    if (used) return res;
    used = true;
    const body = await res.json();
    const items = (body.items ?? []).map((it: Record<string, unknown>) => ({
      ...it,
      arrivalCode: "0",
      remainingStops: 0,
    }));
    return { ok: true, json: async () => ({ ...body, items }) } as Response;
  }) as unknown as typeof fetch);
  clickFocused(await screen.findByRole("button", { name: select }));
  // 승격은 그 폴의 결과라 목록이 사라지는 것으로 확인한다(riding 컨트롤은 잠금 종류에 따라 다르다).
  await waitFor(() => expect(screen.queryByRole("button", { name: select })).toBeNull());
  vi.stubGlobal("fetch", inner);
}

/**
 * 서울버스판 `boardTrain`(A41 2026-09-12): 서울버스 잔여 0("곧 도착")은 승격이 아니라 임박이고, 승격은
 * **그 뒤 소실 2폴**(`boarded(departed)`)이다. 선택 직후 첫 승차 정류소 폴만 잔여 0으로 바꾸고, 그 뒤
 * 승차 정류소 폴 두 번을 빈 결과로 돌려 riding에 넣는다. boarding 폴 주기(20초)는 실제 시계로 기다릴
 * 수 없어 복귀 즉폴(`visibilitychange`)로 그 두 폴을 당긴다 — 리듀서 계약은 공유 fixture ⓐ가 잠그고,
 * 여기서는 진입 경로만 재현한다.
 */
async function boardBusByDeparture(select: RegExp = /selectBus/) {
  const inner = globalThis.fetch;
  let waitPolls = 0;
  vi.stubGlobal("fetch", (async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0]);
    if (!url.includes("phase=wait")) return inner(...args);
    waitPolls += 1;
    if (waitPolls === 1) {
      const res = await inner(...args);
      const body = await res.json();
      const items = (body.items ?? []).map((it: Record<string, unknown>) => ({
        ...it,
        message: "곧 도착",
        remainingStops: 0,
      }));
      return { ok: true, json: async () => ({ ...body, items }) } as Response;
    }
    return { ok: true, json: async () => ({ mode: "seoulBus", status: "empty", rawCount: 0 }) } as Response;
  }) as unknown as typeof fetch);
  fireEvent.click(await screen.findByRole("button", { name: select }));
  await waitFor(() => expect(waitPolls).toBe(1));
  for (const n of [2, 3]) {
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(waitPolls).toBe(n));
  }
  await waitFor(() => expect(screen.queryByRole("button", { name: select })).toBeNull());
  vi.stubGlobal("fetch", inner);
}

/**
 * riding에 들어가고 **하차역 첫 폴까지** 나가게 하는 헬퍼 — [이미 탔습니다] 식별 잠금 경로(A34).
 * 사용자 조작이라 즉폴이 보장되므로, 하차 추적·도착을 보는 테스트가 주기를 기다리지 않는다.
 * (관측 승격 경로로는 그 첫 폴이 최대 60초 뒤이고, 그 창을 즉폴로 메우는 안은 `boarded` 통지를
 * 지연 슬롯에서 버리는 것이 확인돼 채택하지 않았다 — N3 ① 구현 리뷰 H1.)
 * boarding 국면 자체의 계약은 "boarding 수동 진행" 스위트가 본다.
 */
async function boardTrainAndTrack(station = "천호") {
  const inner = globalThis.fetch;
  clickFocused(await screen.findByRole("button", { name: "transitGuide.boardAlready" }));
  // 역 목록 조회의 응답 **한 번만** 손댄다: 그 역에 있는 열차만 후보이므로(`aboardCandidates`:
  // arvlCd 0~5) 목의 99를 0으로 바꿔 세운다. 그 뒤 하차역 폴은 호출부 목 그대로여야 한다.
  let used = false;
  vi.stubGlobal("fetch", (async (...args: Parameters<typeof fetch>) => {
    const res = await inner(...args);
    if (used) return res;
    used = true;
    const body = await res.json();
    const items = (body.items ?? []).map((it: Record<string, unknown>) => ({
      ...it,
      arrivalCode: "0",
    }));
    return { ok: true, json: async () => ({ ...body, items }) } as Response;
  }) as unknown as typeof fetch);
  fireEvent.click(await screen.findByRole("button", { name: station }));
  fireEvent.click((await screen.findAllByRole("button", { name: /selectTrain/ }))[0]);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /selectTrain/ })).toBeNull(),
  );
  vi.stubGlobal("fetch", inner);
}

/**
 * "이미 탔습니다"의 근사(비관측) 잠금 경로(A34 ②+①, 2026-09-11): 역을 먼저 묻고, 그 역에 있는
 * 열차가 0건일 때만 [열차 정보 없이 계속]이 선다. 호출부의 fetch 목이 그 역에 "99"(두 정거장 밖)만
 * 주거나 비어 있어야 한다.
 */
async function boardApproxViaAboard(station = "천호") {
  fireEvent.click(await screen.findByRole("button", { name: "transitGuide.boardAlready" }));
  fireEvent.click(await screen.findByRole("button", { name: station }));
  fireEvent.click(await screen.findByRole("button", { name: "transitGuide.continueWithoutTrain" }));
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

/**
 * 착지 대상 = 상태 문장 행(E38 위원장 판정 2026-09-12: "시트에서 무엇을 누르든 커서는 상태 문장 행에
 * 앉는다. 예외 없음"). 내용이 폴마다 바뀌므로 텍스트가 아니라 **자리**로 잡는다 — 시트 컨테이너의 첫 문단.
 */
const statusLine = () => {
  const el = document.querySelector<HTMLParagraphElement>(".rounded-md.border > p");
  expect(el, "상태 문장 행이 없다").toBeTruthy();
  return el as HTMLParagraphElement;
};
/** 착지가 상태 문장 행에 있는가(useLayoutEffect·rAF 어느 쪽이든 잡히게 waitFor). */
const expectLandedOnStatus = async () => {
  await waitFor(() => expect(document.activeElement).toBe(statusLine()));
};
/**
 * 차량 선택 목록으로 가는 전이의 착지 자리(E38 예외, 위원장 판정 2026-09-12) — 그 화면의 질문 라벨.
 * "이미 탑승" 흐름의 pickVehicle 진입과 **같은 자리**여야 한다(같은 목록에 두 문으로 들어간다).
 */
const expectLandedOnWaitingLabel = async () => {
  // ⚠ 요소로 비교한다 — `activeElement?.textContent` 정규식은 착지가 통째로 사라져 커서가 `body`에
  // 남았을 때도 통과한다(body의 textContent가 문서 전량이다, 변이 주입 실측).
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByText(/transitGuide\.waitingLabel/)),
  );
};
/**
 * 커서를 그 컨트롤에 얹고 누른다 — **착지 단언의 검출력은 여기서 나온다**. E38로 대상이 상태 문장
 * 하나가 되면서 "착지했다"와 "애초에 거기 있었다"가 구별되지 않게 됐다(변이 주입 실측: 전이 착지를
 * 통째로 지워도 단언이 통과했다). 실기기 경로 그대로 — 커서는 누르는 행 위에 있고 그 행이 사라진다.
 */
const clickFocused = (el: HTMLElement) => {
  el.focus();
  expect(document.activeElement).toBe(el);
  fireEvent.click(el);
};

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
    await expectLandedOnStatus();
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
    // ⚠ ko 로케일에서는 `lang` 속성이 없다(E27 잔여 ① 2026-09-01) — `<html lang="ko">`와
    // 중복이라 노이즈다. 태그는 **en 세션에서 한국어로 폴백한 줄**에만 붙는다(a11y 감사 판정).
    expect(candidate.getAttribute("lang")).toBeNull();

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
    await boardTrainAndTrack();

    // 중간역(군자)을 기준으로 재선택한 뒤 다시 탑승한다.
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.changeBoarding" }));
    fireEvent.click(await screen.findByRole("button", { name: "군자" }));
    await boardTrainAndTrack();

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
    // 국면 왕복은 근사 잠금("이미 탔습니다")으로 만든다 — 그 잠금은 riding에서
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
    // 2026-09-11 A34: "이미 탑승"은 역을 먼저 묻는다 — 목 항목이 "99"라 필터에 걸려 0건 → 비관측 근사 잠금.
    await boardApproxViaAboard();

    // riding 국면에서 픽커를 연다(근사 잠금이라 advance도 함께 떠 있다).
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.changeBoarding" }));
    expect(screen.getByRole("heading", { name: "transitGuide.reboardStationPrompt" })).toBeTruthy();

    // 픽커를 연 채 다음 구간으로 — 국면이 바뀌며 플래그도 함께 내려가야 한다.
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.advance" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "transitGuide.boardAlready" })).toBeTruthy();
    });

    // 다시 탑승해도 되살아나지 않고, 그 자리엔 탑승 변경 버튼이 있다.
    await boardApproxViaAboard();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "transitGuide.changeBoarding" })).toBeTruthy();
    });
    expect(screen.queryByRole("heading", { name: "transitGuide.reboardStationPrompt" })).toBeNull();
  });

  it("역 선택 취소는 아무것도 바꾸지 않고 상태 문장으로 돌려보낸다(A16 L3·E38)", async () => {
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
    await expectLandedOnStatus();
  });

  it("급행 통과 후보는 버튼 없이 사유 줄만(unreachable 단일 술어, A16 L1)", async () => {
    // 9호선 완행 leg + 급행 정차역 집합(하차역 제외) — ID 판정으로 skips.
    const expressRoute: TransitRoute = {
      ...ROUTE,
      legs: [{
        ...ROUTE.legs[0],
        lineName: "수도권 9호선",
        fromName: "김포공항",
        toName: "노들",
        stops: [
          { name: "김포공항", stationId: "901", lat: 37.56, lng: 126.8 },
          { name: "당산", stationId: "902", lat: 37.53, lng: 126.9 },
          { name: "노들", stationId: "904", lat: 37.51, lng: 126.95 },
        ],
        expressStops: ["김포공항", "당산", "동작"],
        expressStopIds: ["901", "902", "905"],
      }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("phase=track")) {
          return {
            ok: true,
            json: async () => ({
              mode: "subway",
              status: "ok",
              items: [
                trackItem({ vehicleId: "9001", express: false }),
                trackItem({ vehicleId: "9669", express: true, message: "곧 도착" }),
              ],
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    render(<TransitGuidePanel route={expressRoute} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await waitFor(() => {
      expect(screen.getByText(/expressSkipsAlight/)).toBeTruthy();
    });
    // 통과 급행은 버튼이 아니고, 차단 행엔 급행 조각(expressCheck·expressStopsAt)이 붙지 않는다.
    expect(screen.queryAllByRole("button", { name: /selectTrain/ })).toHaveLength(1);
    expect(screen.queryByText(/expressCheck|expressStopsAt/)).toBeNull();
  });

  it("이미 탔습니다 → 급행 확인 프롬프트(헤딩 착지) → 급행이 하차역을 지나면 거절 문장, 일반 열차면 잠금", async () => {
    const expressRoute: TransitRoute = {
      ...ROUTE,
      legs: [{
        ...ROUTE.legs[0],
        lineName: "수도권 9호선",
        fromName: "김포공항",
        toName: "노들",
        stops: [
          { name: "김포공항", stationId: "901", lat: 37.56, lng: 126.8 },
          { name: "당산", stationId: "902", lat: 37.53, lng: 126.9 },
          { name: "노들", stationId: "904", lat: 37.51, lng: 126.95 },
        ],
        expressStops: ["김포공항", "당산", "동작"],
        expressStopIds: ["901", "902", "905"],
      }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("phase=track")) {
          return { ok: true, json: async () => ({ mode: "subway", status: "ok", items: [] }) } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    render(<TransitGuidePanel route={expressRoute} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    // 2026-09-11 A34: 급행 확인은 [열차 정보 없이 계속](역 선택 뒤 0건 폴백) 앞에 선다 — 목록 경로는 후보 행의
    // unreachable 판정이 대신한다.
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.boardAlready" }));
    fireEvent.click(await screen.findByRole("button", { name: "김포공항" }));
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.continueWithoutTrain" }));
    // 프롬프트 헤딩에 착지, 국면은 아직 waiting.
    const heading = await screen.findByRole("heading", { name: "transitGuide.expressPrompt" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.expressYes" }));
    // 통과 급행 → 잠그지 않고 거절 문장 행에 착지(착지 낭독이 답 — 별도 live region 없음), 프롬프트는 닫힌다.
    const note = await screen.findByText(/expressSkipsAlight/);
    await waitFor(() => expect(document.activeElement).toBe(note));
    expect(screen.getAllByText(/expressSkipsAlight/)).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "transitGuide.expressPrompt" })).toBeNull();
    expect(screen.getByRole("button", { name: "transitGuide.continueWithoutTrain" })).toBeTruthy();
    // 다시 묻고 "일반 열차" → 근사(비관측) 잠금(riding, 다음 구간 상시).
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.continueWithoutTrain" }));
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.expressNo" }));
    expect(await screen.findByRole("button", { name: "transitGuide.advance" })).toBeTruthy();
    expect(screen.queryByText(/expressSkipsAlight/)).toBeNull();
    // 급행 선언 잠금이 아니라(일반 열차) 상시 표시에 급행 판정 문장이 없다.
    expect(screen.queryByText(/expressCheck|expressStopsAt/)).toBeNull();
    // 프롬프트를 연 채 역을 바꾸면(다른 역 선택 → 단계 변화) 누르지 않은 프롬프트는 되살아나지 않는다(리뷰 m3).
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.changeBoarding" }));
    fireEvent.click(await screen.findByRole("button", { name: "김포공항" }));
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.boardAlready" }));
    fireEvent.click(await screen.findByRole("button", { name: "당산" }));
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.continueWithoutTrain" }));
    await screen.findByRole("heading", { name: "transitGuide.expressPrompt" });
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.pickAnotherStation" }));
    await screen.findByRole("heading", { name: "transitGuide.aboardStationPrompt" });
    expect(screen.queryByRole("heading", { name: "transitGuide.expressPrompt" })).toBeNull();
    // 역 선택 취소도 착지는 상태 문장이다(E38) — [이미 탔습니다]는 거기서 한 번 스와이프 아래.
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.reboardCancel" }));
    await expectLandedOnStatus();
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
    await boardTrainAndTrack();
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
    await boardTrainAndTrack();

    // 2번째 하차 폴(arvlCd 1) → arrived → "다음 구간" 노출. 착지는 그 버튼이 아니라 도착을 말하는
    // 상태 문장이고(E38), 버튼은 거기서 한 번 스와이프 아래다.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "transitGuide.advance" })).toBeTruthy();
    });
    await expectLandedOnStatus();

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
    clickFocused(await screen.findByRole("button", { name: "천호" }));
    // →waiting 전이(누른 역 행이 사라진다): 도착하는 화면이 차량 선택 목록이라 그 질문 라벨에 앉는다
    // (E38 예외 — "이미 탑승" 흐름의 pickVehicle 진입과 같은 자리).
    await expectLandedOnWaitingLabel();
    const cancel = await screen.findByRole("button", { name: "transitGuide.cancelChangeBoarding" });
    clickFocused(cancel);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "transitGuide.changeBoarding" })).toBeTruthy();
    });
    // 탑승 계열 전이는 대기 컨트롤을 제거한다 — 착지는 상태 문장(E38).
    await expectLandedOnStatus();

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

  it("열차 정보 없이 계속(A34 ① 2026-09-11): 비관측 잠금 — advance 상시, 열차 위치·잔여·근사 주석·신선도 없음, 하차역 폴 없음", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("station=" + encodeURIComponent("천호"))) {
          return {
            ok: true,
            json: async () => ({ mode: "subway", status: "empty", rawCount: 0 }),
          } as Response;
        }
        // 하차역: 종전 근사 분기라면 잔여 최소(4)를 잡아 "남은 정거장 4개"를 냈을 목록.
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
    await boardApproxViaAboard();

    // 비관측 riding: advance 상시 + 탑승 변경 유지. 상태줄은 "어느 열차인지 모른다"만 말하고 어림값이 없다.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "transitGuide.advance" })).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "transitGuide.changeBoarding" })).toBeTruthy();
    expect(screen.getByText(/transitGuide\.stateRidingUnobserved/)).toBeTruthy();
    expect(screen.queryByText(/approxNote/)).toBeNull();
    expect(screen.queryByText(/remainingCount|stationCountAbout|messageFrame|lastUpdated|dataAge/)).toBeNull();
    // 하차역 목록은 읽지 않는다(폴 주기 0 + 즉폴 게이트 — 리뷰 B1).
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.some((u) => u.includes(encodeURIComponent("여의도")))).toBe(false);
    // 백그라운드 복귀 통지도 같은 문장(리뷰 M1 — 호출 지점 셋이 같은 선택기).
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("transitGuide.stateRidingUnobserved");
    });
  });

  it("승차 뒤 미관측 상태 문장은 수단별이다 — 지하철은 열차, 서울버스는 버스(A33)", async () => {
    // 하차역 목록이 비어 있으면 riding은 notYetVisible에 머문다. 이 문장이 GPS를 암시하지
    // 않도록 주어가 열차/버스여야 하고, 버스 승차에 "열차" 키가 붙으면 회귀다.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const mode = url.includes("mode=seoulBus") ? "seoulBus" : "subway";
        // 승차 정류소(대기)엔 식별자 있는 후보 1건, 하차 정류소(승차 중)엔 0건 → riding notYetVisible.
        const atBoardStop = url.includes("phase=wait") || url.includes("station=" + encodeURIComponent("천호"));
        return {
          ok: true,
          json: async () =>
            atBoardStop
              ? { mode, status: "ok", rawCount: 1, items: [trackItem({ vehicleId: "111033479", direction: "" })] }
              : { mode, status: "empty", rawCount: 0 },
        } as Response;
      }),
    );

    const { unmount } = render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await boardTrain();
    await waitFor(() => {
      expect(screen.getByText(/transitGuide\.stateRidingNotYetVisible /)).toBeTruthy();
    });
    expect(screen.queryByText(/stateRidingNotYetVisibleBus/)).toBeNull();
    unmount();

    const BUS_ROUTE: TransitRoute = {
      summary: { totalMinutes: 20, fare: 1500, transfers: 0, walkMinutes: 2 },
      routeKey: "b0",
      legs: [
        {
          mode: "bus",
          lineName: "3318",
          fromName: "길동사거리",
          toName: "천호역",
          stationCount: 5,
          minutes: 12,
          serviceRouteId: "227000006",
          stops: [
            { name: "길동사거리", lat: 37.5, lng: 127.1, cityCode: "1000", arsId: "24101", localId: "123000017" },
            { name: "천호역", lat: 37.53, lng: 127.12, cityCode: "1000", arsId: "24102", localId: "123000043" },
          ],
        },
      ],
    };
    render(<TransitGuidePanel route={BUS_ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await boardBusByDeparture(/selectBus/);
    await waitFor(() => {
      expect(screen.getByText(/transitGuide\.stateRidingNotYetVisibleBus/)).toBeTruthy();
    });
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
    await boardTrainAndTrack();
    await waitFor(() => {
      expect(screen.getByText("왕십리(성동구청), transitGuide.viaCurrent")).toBeTruthy();
    });
  });

  it("도보 인계 단일 버튼(E34, 2026-09-11): 마지막 leg 도착 뒤 버튼은 '남은 도보 안내 시작' 하나, 한 번 누르면 도보 세션이 시작된다", async () => {
    // DistanceBeacon은 geolocation 미지원이면 렌더하지 않으므로 스텁이 전제다(watchPosition이 id를 돌려주면 추적 상태).
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
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
    await boardTrainAndTrack();

    // 도착 관측: 그 자리 버튼이 [다음 구간]이 아니라 [남은 도보 안내 시작]이고 착지가 거기다. 도착 통지는 그
    // 버튼 이름과 도보 분을 담는다(종전 "다음: 대중교통 구간이 끝났습니다…" 조각 없음).
    const handoff = await screen.findByRole("button", { name: "transitGuide.walkHandoffStart" });
    expect(screen.queryByRole("button", { name: "transitGuide.advance" })).toBeNull();
    await expectLandedOnStatus();
    const status = screen.getAllByRole("status")[0];
    expect(status.textContent).toContain("transitGuide.arrivedWalkNext:5");
    expect(status.textContent).not.toContain("doneWalk");
    expect(screen.getByText(/transitGuide\.stateArrived/)).toBeTruthy();
    // 한 번 누르면 세션 종료 + 도보 세션 자동 시작(트리거가 "중지"로) — 완료 문장은 내지 않는다(리뷰 M3).
    fireEvent.click(handoff);
    const stopButton = await screen.findByRole("button", { name: "beacon.stop" });
    expect(document.activeElement).toBe(stopButton);
    expect(screen.queryByRole("button", { name: "transitGuide.walkHandoffStart" })).toBeNull();
    expect(status.textContent).not.toContain("doneWalk");
    // 트리거도 함께 복귀해 재시작 경로가 남는다.
    expect(screen.getByRole("button", { name: "시작" })).toBeTruthy();
  });

  it("중간 leg의 도착은 여전히 [다음 구간]이고, 역 선택에서 하차역을 고르면 도착 선언이다(A37 ②·E34 (d))", async () => {
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
      configurable: true,
    });
    const twoLegsWalk: TransitRoute = {
      ...ROUTE,
      legs: [
        { ...SUBWAY_LEG, toName: "왕십리(성동구청)" },
        { ...SUBWAY_LEG, lineName: "수도권 2호선", fromName: "왕십리(성동구청)", toName: "강남" },
        { mode: "walk", minutes: 7 },
      ],
    };
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return {
          ok: true,
          json: async () => ({ mode: "subway", status: "ok", rawCount: 1, items: [trackItem({})] }),
        } as Response;
      }),
    );
    render(
      <TransitGuidePanel
        route={twoLegsWalk}
        triggerLabel="시작"
        dest={{ lat: 37.49, lng: 127.02, name: "강남" }}
        walkAccessible={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await boardTrain();
    // 승차 중 탑승 변경 → 역 선택 → 마지막 행(하차역) = 도착 선언 → 중간 leg라 [다음 구간].
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.changeBoarding" }));
    const before = calls.length;
    fireEvent.click(await screen.findByRole("button", { name: "여의도" }));
    const advance = await screen.findByRole("button", { name: "transitGuide.advance" });
    expect(screen.queryByRole("button", { name: "transitGuide.walkHandoffStart" })).toBeNull();
    await expectLandedOnStatus();
    expect(screen.getAllByRole("status")[0].textContent).toContain("transitGuide.arrived ");
    expect(screen.getByText(/transitGuide\.stateArrived/)).toBeTruthy();
    // 선언 뒤 폴은 나가지 않는다(즉폴 게이트).
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.length).toBe(before);
    // 다음 구간(마지막 leg) → 대기 → "이미 탑승" 흐름에서 하차역을 고르면 그 자리 버튼은 인계 하나다.
    fireEvent.click(advance);
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.boardAlready" }));
    fireEvent.click(await screen.findByRole("button", { name: "여의도" }));
    const handoff = await screen.findByRole("button", { name: "transitGuide.walkHandoffStart" });
    expect(screen.queryByRole("button", { name: "transitGuide.advance" })).toBeNull();
    expect(screen.getAllByRole("status")[0].textContent).toContain("transitGuide.arrivedWalkNext:7");
    // 위원장 증상의 원래 흐름(A37 ② + E34): 선언 도착에서 그 버튼을 한 번 누르면 도보가 자동 시작된다.
    fireEvent.click(handoff);
    const stop = await screen.findByRole("button", { name: "beacon.stop" });
    await waitFor(() => expect(document.activeElement).toBe(stop));
    expect(screen.queryByRole("button", { name: "transitGuide.walkHandoffStart" })).toBeNull();
  });

  it("역 선택 직후 앞 역의 늦은 응답은 새 역 목록으로 커밋되지 않고, 새 역 조회가 바로 나간다(A34, 코드 리뷰 M1)", async () => {
    // 승차역(천호) 폴을 붙들어 두고, 그 사이 역을 고른다 — 늦게 풀린 옛 응답은 버려져야 한다.
    let releaseOld: (() => void) | null = null;
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("station=" + encodeURIComponent("천호"))) {
          await new Promise<void>((r) => {
            releaseOld = r;
          });
          return {
            ok: true,
            json: async () => ({
              mode: "subway",
              status: "ok",
              rawCount: 1,
              items: [trackItem({ vehicleId: "OLD", message: "천호 도착", remainingStops: 0, arrivalCode: "1" })],
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({
            mode: "subway",
            status: "ok",
            rawCount: 1,
            items: [trackItem({ vehicleId: "NEW", message: "전역 출발", remainingStops: 1, arrivalCode: "3" })],
          }),
        } as Response;
      }),
    );
    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    await waitFor(() => expect(releaseOld).not.toBeNull());
    // 옛 폴이 in-flight인 채 이미 탑승 → 왕십리 선택.
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.boardAlready" }));
    fireEvent.click(await screen.findByRole("button", { name: "왕십리(성동구청)" }));
    await screen.findByText("transitGuide.waitingLabelAboard");
    // 옛 응답을 이제 풀어 준다 — 새 역 목록에 OLD가 들어오면 안 되고, 새 역 폴이 곧바로 나가야 한다.
    releaseOld!();
    await waitFor(() => {
      expect(calls.some((u) => u.includes("station=" + encodeURIComponent("왕십리(성동구청)")))).toBe(true);
    });
    const rows = await screen.findAllByRole("button", { name: /selectTrain/ });
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).not.toContain("천호 도착");
  });

  it("pickVehicle에서 그 역에 있는 열차가 없으면 사유가 '진짜 0건'과 다르다(코드 리뷰 M3)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({ mode: "subway", status: "ok", rawCount: 1, items: [trackItem({})] }),
          }) as Response,
      ),
    );
    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.boardAlready" }));
    fireEvent.click(await screen.findByRole("button", { name: "왕십리(성동구청)" }));
    // 목 항목은 99(두 정거장 밖)뿐 — 원 목록엔 후보가 있으나 필터 뒤 0건.
    expect(await screen.findByText("transitGuide.noCandidatesAboard")).toBeTruthy();
    expect(screen.queryByText("transitGuide.noCandidates")).toBeNull();
    expect(screen.getByRole("button", { name: "transitGuide.continueWithoutTrain" })).toBeTruthy();
    // 새로고침 응답 수도 필터를 지난다(리뷰 M2) — 0개.
    fireEvent.click(screen.getByRole("button", { name: "transitGuide.refresh" }));
    await waitFor(() => {
      expect(screen.getAllByRole("status")[0].textContent).toContain("transitGuide.waitingCount:0");
    });
  });

  it("이미 탔습니다(A34 ② 2026-09-11): 역을 묻고 → 그 역에 있는 열차만 목록 → 고르면 boarding 없이 riding(식별 잠금)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("station=" + encodeURIComponent("왕십리(성동구청)"))) {
          // 그 역에 있는 열차(전역 출발 3) + 두 정거장 밖(99) — 후자는 타고 있을 수 없어 목록에서 빠진다.
          return {
            ok: true,
            json: async () => ({
              mode: "subway",
              status: "ok",
              rawCount: 2,
              items: [
                trackItem({ vehicleId: "5701", message: "전역 출발", remainingStops: 1, arrivalCode: "3" }),
                trackItem({ vehicleId: "5702", message: "[3]번째 전역", remainingStops: 3, arrivalCode: "99" }),
              ],
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ mode: "subway", status: "ok", rawCount: 1, items: [trackItem({})] }),
        } as Response;
      }),
    );
    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    fireEvent.click(await screen.findByRole("button", { name: "transitGuide.boardAlready" }));
    // 1단: 전용 질문 헤딩에 착지.
    const prompt = await screen.findByRole("heading", { name: "transitGuide.aboardStationPrompt" });
    await waitFor(() => expect(document.activeElement).toBe(prompt));
    expect(screen.queryByRole("heading", { name: "transitGuide.reboardStationPrompt" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "왕십리(성동구청)" }));
    // 2단: 라벨이 곧 질문이고 착지점. 목록은 그 역 기준이며 99 항목은 없다. 폴백 버튼은 목록이 있으면 없다.
    const label = await screen.findByText("transitGuide.waitingLabelAboard");
    await waitFor(() => expect(document.activeElement).toBe(label));
    const rows = await screen.findAllByRole("button", { name: /selectTrain/ });
    expect(rows).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "transitGuide.continueWithoutTrain" })).toBeNull();
    expect(screen.getByRole("button", { name: "transitGuide.pickAnotherStation" })).toBeTruthy();
    // 고르면 boarding(탑승했습니다)을 지나지 않고 riding — 탑승 변경 착지, 통지에 선택 차량, 하차역 폴 시작.
    fireEvent.click(rows[0]);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "transitGuide.changeBoarding" })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "transitGuide.boardWithoutArrival" })).toBeNull();
    expect(screen.getAllByRole("status")[0].textContent).toContain("transitGuide.boarded");
    expect(screen.getAllByRole("status")[0].textContent).toContain("selectedVehicle");
    await waitFor(() => {
      expect(calls.some((u) => u.includes("station=" + encodeURIComponent("여의도")))).toBe(true);
    });
    // 상태줄에도 선택 차량(어느 열차인가는 정보다) — live region 통지와 상시 표시 둘.
    expect(screen.getAllByText(/transitGuide\.selectedVehicle/).length).toBe(2);
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

/**
 * N3 ①(위원장 판정 2026-09-10, spec `docs/superpowers/specs/2026-09-11-boarding-manual-advance-design.md`):
 * 차량을 고른 직후 [탑승했습니다]가 서던 것을 없앴다. riding 승격은 승차 정류소 도착 관측이 하고,
 * 관측이 끝난 뒤(`signalLost`·`upstreamFailed`)에만 다른 문구의 수동 진행 수단이 선다.
 */
describe("TransitGuidePanel — boarding 수동 진행 (N3 ①)", () => {
  it("차량을 고른 직후엔 수동 진행 수단이 없고 커서는 상태 문장에 앉는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ mode: "subway", status: "ok", rawCount: 1, items: [trackItem({})] }),
      })) as unknown as typeof fetch,
    );
    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    clickFocused(await screen.findByRole("button", { name: /selectTrain/ }));

    // boarding 국면: 탈출은 [다른 차량 선택]뿐이고 선언 버튼은 없다.
    const reselect = await screen.findByRole("button", { name: "transitGuide.reselectVehicle" });
    expect(reselect).toBeTruthy();
    expect(screen.queryByRole("button", { name: "transitGuide.boardWithoutArrival" })).toBeNull();
    // 누른 후보 행이 사라지는 전이 — 상태 문장으로 선점(§4.3·E38).
    await expectLandedOnStatus();
    expect(statusLine().textContent).toContain("transitGuide.boardingContext");
  });

  it("승차 정류소 도착이 관측되면 버튼 없이 riding으로 넘어간다", async () => {
    let arrived = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          mode: "subway",
          status: "ok",
          rawCount: 1,
          items: [
            trackItem(arrived ? { message: "천호 도착", remainingStops: 0, arrivalCode: "0" } : {}),
          ],
        }),
      })) as unknown as typeof fetch,
    );
    render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    arrived = true;
    fireEvent.click(await screen.findByRole("button", { name: /selectTrain/ }));
    // 사용자가 아무것도 누르지 않았는데 riding 컨트롤이 선다(관측 승격).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "transitGuide.changeBoarding" })).toBeTruthy(),
    );
    // 승격 통지는 "탑승"이고 하차역 추적으로 넘어가지 않는다 — riding 첫 폴은 주기 뒤다
    // (구현 리뷰 H1: 즉폴을 넣으면 그 응답의 `trackingStarted`가 지연 슬롯의 이 문장을
    // latest-wins로 버려, 이 흐름에서 가장 중요한 한 문장이 웜/콜드에 따라 사라진다).
    expect(screen.getAllByRole("status")[0].textContent).toContain("transitGuide.boarded");
    expect(screen.getAllByRole("status")[0].textContent).not.toContain("trackingStarted");
  });

  it("새 차량을 고르면 래치가 지워진다 — 관측이 끝나지 않은 국면에 버튼이 서 있지 않다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let failing = false;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (failing) throw new Error("upstream down");
          return {
            ok: true,
            json: async () => ({ mode: "subway", status: "ok", rawCount: 1, items: [trackItem({})] }),
          } as Response;
        }) as unknown as typeof fetch,
      );
      render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
      fireEvent.click(screen.getByRole("button", { name: "시작" }));
      fireEvent.click(await screen.findByRole("button", { name: /selectTrain/ }));
      failing = true;
      await vi.advanceTimersByTimeAsync(20_000 * 3 + 500);
      await screen.findByRole("button", { name: "transitGuide.boardWithoutArrival" });

      // [다른 차량 선택] → 대기 국면 → 새 차량 선택 = 새 boarding. 아직 아무 관측도 끝나지 않았다.
      failing = false;
      fireEvent.click(screen.getByRole("button", { name: "transitGuide.reselectVehicle" }));
      fireEvent.click(await screen.findByRole("button", { name: /selectTrain/ }));
      await screen.findByRole("button", { name: "transitGuide.reselectVehicle" });
      expect(
        screen.queryByRole("button", { name: "transitGuide.boardWithoutArrival" }),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("관측이 끝나면 그때 수동 진행 수단이 서고, 관측이 돌아와도 사라지지 않는다(래치)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let failing = false;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (failing) throw new Error("upstream down");
          return {
            ok: true,
            json: async () => ({ mode: "subway", status: "ok", rawCount: 1, items: [trackItem({})] }),
          } as Response;
        }) as unknown as typeof fetch,
      );
      render(<TransitGuidePanel route={ROUTE} triggerLabel="시작" walkAccessible={false} />);
      fireEvent.click(screen.getByRole("button", { name: "시작" }));
      fireEvent.click(await screen.findByRole("button", { name: /selectTrain/ }));
      await screen.findByRole("button", { name: "transitGuide.reselectVehicle" });

      // 조회 실패 3회(FAIL_NOTIFY_COUNT)면 upstreamFailed — 그 순간 버튼이 조용히 서므로
      // 통지가 그 이름을 부른다(헌장 §3 발견 경로).
      failing = true;
      await vi.advanceTimersByTimeAsync(20_000 * 3 + 500);
      const manual = await screen.findByRole("button", {
        name: "transitGuide.boardWithoutArrival",
      });
      expect(screen.getAllByRole("status")[0].textContent).toContain(
        "transitGuide.boardingUpstreamFailed",
      );

      // 회복하면 신호는 tracking으로 돌아가지만 버튼은 남는다 — 사라지면 포커스를 쥔
      // 컨트롤이 폴 한 번에 제거된다(헌장 §5).
      failing = false;
      await vi.advanceTimersByTimeAsync(20_000 * 2 + 500);
      expect(screen.getByRole("button", { name: "transitGuide.boardWithoutArrival" })).toBe(manual);

      // 누르면 종전 선언과 같은 전이(riding).
      fireEvent.click(manual);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "transitGuide.changeBoarding" })).toBeTruthy(),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

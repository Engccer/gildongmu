// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ko from "../../../messages/ko.json";

vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({
    status: "ready" as const,
    coords: { lat: 37.5, lng: 127.1 },
  })),
}));

import { useRouteGuide } from "../useRouteGuide";

/**
 * 계단 회피가 안내 경로 조회에 실리는가(백로그 A4). 봉인이 아니라 **조회 시점
 * 판독**이라는 계약을 함께 못 박는다 — 웹 useState 초기값은 컴포넌트 마운트
 * 수명이지 세션 수명이 아니다(spec 2026-08-08 §2.2).
 */
const M = 1 / 111320;
const pt = (m: number) => ({ lat: 37.5 + m * M, lng: 127.1 });

const WALK_STEPS = [
  { description: "직진 200m 이동", pathCoords: [pt(0), pt(200)] },
  { description: "우회전 후 300m 이동", pathCoords: [pt(200), pt(500)] },
];

const DEST = { lat: 37.5 + 500 * M, lng: 127.1, name: "목적지" };

let fetchMock: ReturnType<typeof vi.fn>;

/** `/api/route/walk` 응답 봉투. extra로 stepFree·stepFreeNotice를 얹는다. */
function walkBody(extra: Record<string, unknown> = {}) {
  return {
    result: {
      distanceMeters: 500,
      durationSeconds: 400,
      steps: WALK_STEPS,
      ...extra,
    },
  };
}

function setWalkResponse(extra: Record<string, unknown> = {}) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => walkBody(extra) });
}

/** fetch 호출 중 도보 라우트 URL만. */
function walkUrls(): string[] {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.startsWith("/api/route/walk"));
}

function Harness({ accessible }: { accessible: boolean }) {
  const g = useRouteGuide(DEST, "walk", accessible);
  return (
    <div>
      <button onClick={g.start}>start</button>
      <button onClick={g.stop}>stop</button>
      <button onClick={g.requestReroute}>reroute</button>
      <p data-testid="status">{g.status}</p>
      <p data-testid="live">{g.liveText}</p>
    </div>
  );
}

function renderGuide(accessible: boolean) {
  const ui = (a: boolean) => (
    <NextIntlClientProvider locale="ko" messages={ko}>
      <Harness accessible={a} />
    </NextIntlClientProvider>
  );
  const r = render(ui(accessible));
  return { setAccessible: (a: boolean) => r.rerender(ui(a)) };
}

const click = (label: string) => fireEvent.click(screen.getByText(label));
const live = () => screen.getByTestId("live").textContent ?? "";

/** 시작 조회가 끝나 상세 통지가 나올 때까지. */
async function settleStart() {
  await waitFor(() => expect(live()).not.toBe(""));
}

beforeEach(() => {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
  });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  setWalkResponse();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("계단 회피가 안내 조회에 실린다", () => {
  it("세션 시작 요청에 accessible=true가 붙는다", async () => {
    renderGuide(true);
    click("start");
    await settleStart();

    expect(walkUrls()).toContainEqual(expect.stringContaining("accessible=true"));
  });

  it("꺼져 있으면 파라미터를 붙이지 않는다(기존 캐시 경로 유지)", async () => {
    renderGuide(false);
    click("start");
    await settleStart();

    expect(walkUrls()).toHaveLength(1);
    expect(walkUrls()[0]).not.toContain("accessible");
  });

  it("이탈 재조회도 그 시점 값을 읽는다", async () => {
    renderGuide(true);
    click("start");
    await settleStart();
    fetchMock.mockClear();

    click("reroute");
    await waitFor(() => expect(walkUrls()).toHaveLength(1));

    expect(walkUrls()[0]).toContain("accessible=true");
  });

  // ⚠ 같은 마운트에서 값이 바뀌는 시나리오여야 한다. prop을 처음부터 true로 두면
  //   초기값 고정과 조회 시점 판독이 같은 값을 내 변이가 관측 불가가 된다.
  it("세션 종료 후 값이 바뀌면 다음 세션이 새 값을 쓴다", async () => {
    const { setAccessible } = renderGuide(false);
    click("start");
    await settleStart();
    click("stop");

    setAccessible(true);
    fetchMock.mockClear();
    click("start");
    await waitFor(() => expect(walkUrls()).toHaveLength(1));

    expect(walkUrls()[0]).toContain("accessible=true");
  });
});

const NOTICE = "계단 없는 경로를 확정하지 못했습니다. 안내 경로에 계단이 포함될 수 있습니다.";

describe("계단 회피 열화 통지", () => {
  it("시작 조회가 열화면 시작 발화와 한 문자열로 결합해 통지한다", async () => {
    setWalkResponse({ stepFree: "no_stepfree_route", stepFreeNotice: NOTICE });
    renderGuide(true);
    click("start");
    await waitFor(() => expect(live()).toContain(NOTICE));

    // ⚠ 두 번 set 하지 않는다 — React 배칭이 첫 발화를 삼키거나 두 번째가 첫
    //   낭독을 끊는다. 요약도 같은 문자열에 있어야 한다.
    expect(live()).toContain("도보 안내 시작");
    // 안내 문장이 앞이다 — 세션 전체에 걸린 조건이라 걷기 전에 들어야 한다.
    expect(live().indexOf(NOTICE)).toBeLessThan(live().indexOf("도보 안내 시작"));
  });

  it("applied면 통지하지 않는다", async () => {
    setWalkResponse({ stepFree: "applied" });
    renderGuide(true);
    click("start");
    await settleStart();

    expect(live()).not.toContain("계단");
  });

  it("계단 회피 미요청(필드 부재)이면 통지하지 않는다", async () => {
    renderGuide(false);
    click("start");
    await settleStart();

    expect(live()).not.toContain("계단");
  });

  // 시작은 정상인데 재조회에서 열화로 바뀌는 경로 — 출발지가 달라지면 판정도 달라진다.
  it("시작 applied → 재조회 열화 전이에서 통지한다", async () => {
    setWalkResponse({ stepFree: "applied" });
    renderGuide(true);
    click("start");
    await settleStart();
    expect(live()).not.toContain(NOTICE);

    setWalkResponse({ stepFree: "no_stepfree_route", stepFreeNotice: NOTICE });
    click("reroute");
    await waitFor(() => expect(live()).toContain(NOTICE));
    // 재조회도 안내 문장이 앞이다. 시작 경로만 순서를 단언하면 재조회 분기만
    // 뒤집히는 변이가 전량 green으로 통과한다(독립 리뷰 RC).
    expect(live().indexOf(NOTICE)).toBe(0);
  });

  // 신호는 상태 분류가 아니라 문장의 존재다. 서버가 넷째 상태를 추가해도 문장이
  // 실려 오면 말해야 한다 — 모르는 상태일수록 보수적으로.
  it("알려지지 않은 stepFree 값이어도 문장이 오면 통지한다", async () => {
    setWalkResponse({ stepFree: "partially_applied", stepFreeNotice: NOTICE });
    renderGuide(true);
    click("start");
    await waitFor(() => expect(live()).toContain(NOTICE));
  });

  // 서버 계약 위반(열화인데 문장 없음)에서 기준을 태우면, 문장이 정상화된 뒤에도
  // 전이가 사라져 영영 침묵한다.
  it("열화인데 문장이 비어 오면 침묵하되 기준을 태우지 않는다", async () => {
    setWalkResponse({ stepFree: "no_stepfree_route" });
    renderGuide(true);
    click("start");
    await settleStart();
    expect(live()).not.toContain(NOTICE);

    setWalkResponse({ stepFree: "no_stepfree_route", stepFreeNotice: NOTICE });
    click("reroute");
    await waitFor(() => expect(live()).toContain(NOTICE));
  });

  it("같은 열화 상태가 이어지면 재통지하지 않는다", async () => {
    setWalkResponse({ stepFree: "no_stepfree_route", stepFreeNotice: NOTICE });
    renderGuide(true);
    click("start");
    await waitFor(() => expect(live()).toContain(NOTICE));

    click("reroute");
    await waitFor(() => expect(live()).not.toContain("도보 안내 시작"));
    expect(live()).not.toContain(NOTICE);
  });

  it("기하 빌드 실패로 간략 폴백되면 통지하지 않고 상태가 초기화된다", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: null }) });
    renderGuide(true);
    click("start");
    await waitFor(() => expect(live()).toBe(ko.guide.detailUnavailable));
    expect(live()).not.toContain(NOTICE);

    // 복구된 상세 경로가 열화면 다시 통지된다(새 경로에 대한 새 판정).
    setWalkResponse({ stepFree: "no_stepfree_route", stepFreeNotice: NOTICE });
    click("reroute");
    await waitFor(() => expect(live()).toContain(NOTICE));
  });

  // 재조회 실패 분기의 기준 초기화는 이 시나리오에서만 관측된다 — 지워도 나머지
  // 스위트가 전량 green이라 회귀가 조용히 통과했다(독립 리뷰 RE).
  it("재조회 실패 후 같은 열화 상태로 복구되면 다시 통지한다", async () => {
    setWalkResponse({ stepFree: "no_stepfree_route", stepFreeNotice: NOTICE });
    renderGuide(true);
    click("start");
    await waitFor(() => expect(live()).toContain(NOTICE));

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: null }) });
    click("reroute");
    await waitFor(() => expect(live()).toBe(ko.guide.rerouteFailed));

    setWalkResponse({ stepFree: "no_stepfree_route", stepFreeNotice: NOTICE });
    click("reroute");
    await waitFor(() => expect(live()).toContain(NOTICE));
  });
});

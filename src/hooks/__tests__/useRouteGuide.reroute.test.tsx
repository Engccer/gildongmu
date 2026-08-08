// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ko from "../../../messages/ko.json";

/**
 * 이탈 후 "경로 다시 조회"의 계약(위원장 실기기 실사용 발견 2026-08-08).
 *
 * 재조회의 존재 이유는 **지금 서 있는 자리에서** 경로를 다시 받는 것이다. 공유 위치
 * 스토어는 TTL이 없어 한 번 `ready`가 되면 `force` 없이는 영영 갱신되지 않으므로,
 * 인자 하나가 빠지면 이탈해서 누른 재조회가 출발점에서 **같은 경로를 다시** 받아 온다.
 * 아무 오류도 나지 않고 낭독도 그럴듯해서, 사용자에게는 "버튼이 동작하지 않는다"로만
 * 보인다. 아래 모의 스토어가 그 동작(캐시 좌표 vs 갱신 좌표)을 축소 재현한다.
 */
const M = 1 / 111320;
const pt = (m: number) => ({ lat: 37.5 + m * M, lng: 127.1 });

/** 세션 최초에 잡힌 좌표(스토어가 영구 캐시하는 값). */
const CACHED = pt(0);
/** 이탈해 걸어간 뒤의 실제 위치. */
const MOVED = pt(300);

/** 지금 정밀 재취득하면 나올 좌표. 테스트가 "걸어간" 것을 이 값으로 표현한다. */
let precise = CACHED;
/** 좌표 취득을 붙잡아 두는 관문(GPS 락 대기 창 모사). null이면 즉시 응답. */
let geoGate: Promise<void> | null = null;

vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async (opts?: { force?: boolean }) => {
    if (geoGate) await geoGate;
    return {
      status: "ready" as const,
      // force가 없으면 캐시가 그대로 나온다 — 실제 스토어의 동작이다.
      coords: opts?.force ? precise : CACHED,
    };
  }),
}));

import { useRouteGuide } from "../useRouteGuide";

const WALK_STEPS = [
  { description: "직진 200m 이동", pathCoords: [pt(0), pt(200)] },
  { description: "우회전 후 300m 이동", pathCoords: [pt(200), pt(500)] },
];

const DEST = { lat: 37.5 + 500 * M, lng: 127.1, name: "목적지" };

let fetchMock: ReturnType<typeof vi.fn>;

function setWalkResponse() {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      result: { distanceMeters: 500, durationSeconds: 400, steps: WALK_STEPS },
    }),
  });
}

/** 도보 라우트 요청의 origin 파라미터만 순서대로. */
function walkOrigins(): string[] {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.startsWith("/api/route/walk"))
    .map((u) => new URLSearchParams(u.split("?")[1]).get("origin") ?? "");
}

function Harness() {
  const g = useRouteGuide(DEST, "walk", false);
  return (
    <div>
      <button onClick={g.start}>start</button>
      <button onClick={g.requestReroute}>reroute</button>
      <p data-testid="live">{g.liveText}</p>
    </div>
  );
}

function renderGuide() {
  render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <Harness />
    </NextIntlClientProvider>,
  );
}

const click = (label: string) => fireEvent.click(screen.getByText(label));
const live = () => screen.getByTestId("live").textContent ?? "";

/** watchPosition에 등록된 fix 콜백(테스트가 fix를 직접 주입한다). */
let fixCb: ((p: GeolocationPosition) => void) | null = null;

/** 걷는 중 들어온 fix 하나. */
function sendFix(coord: { lat: number; lng: number }) {
  fixCb?.({
    coords: {
      latitude: coord.lat,
      longitude: coord.lng,
      accuracy: 10,
      speed: null,
      heading: null,
      altitude: null,
      altitudeAccuracy: null,
    },
    timestamp: Date.now(),
  } as GeolocationPosition);
}

beforeEach(() => {
  precise = CACHED;
  geoGate = null;
  fixCb = null;
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: vi.fn((ok: (p: GeolocationPosition) => void) => {
        fixCb = ok;
        return 1;
      }),
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

/** 시작 조회가 끝나 첫 통지가 나올 때까지. */
async function settleStart() {
  await waitFor(() => expect(live()).not.toBe(""));
}

describe("재조회는 지금 서 있는 자리에서 다시 받는다", () => {
  it("이탈해 이동한 뒤의 좌표가 새 경로의 출발지가 된다", async () => {
    renderGuide();
    click("start");
    await settleStart();
    const afterStart = walkOrigins().length;

    // 여기서부터 300m를 걸어 경로를 벗어났다.
    precise = MOVED;
    click("reroute");
    await waitFor(() => expect(walkOrigins().length).toBe(afterStart + 1));

    const origin = walkOrigins()[afterStart];
    expect(origin).toBe(`${MOVED.lat},${MOVED.lng}`);
    // 캐시 좌표로 조회하면 출발점에서 같은 경로가 다시 온다 — 그것이 이 가드가 막는 것.
    expect(origin).not.toBe(`${CACHED.lat},${CACHED.lng}`);
  });

  it("세션 시작도 정밀 재취득이다(길찾기 조회 이후 이동분 반영)", async () => {
    // 길찾기 화면에서 조회만 해 두고 걸어간 뒤 안내를 시작한 경우.
    precise = MOVED;
    renderGuide();
    click("start");
    await settleStart();

    expect(walkOrigins()[0]).toBe(`${MOVED.lat},${MOVED.lng}`);
  });

  it("성공 통지가 새 경로임을 말한다", async () => {
    renderGuide();
    click("start");
    await settleStart();

    precise = MOVED;
    click("reroute");
    // 첫 안내 문장만 내보내면 그것이 새 경로인지 원래 경로의 다음 스텝인지
    // 낭독으로 구분되지 않는다(화면 출발지 필드는 갱신되지 않는다).
    await waitFor(() => expect(live()).toContain("현재 위치에서 경로를 다시 찾았습니다"));
    expect(live()).toContain("직진 200m 이동");
  });
});

/**
 * 시작 조회를 정밀 재취득으로 바꾸면 GPS 락을 기다리는 창이 생긴다. 그 창 동안
 * 들어오는 fix를 간략 리듀서에 태우면 "목적지까지 …" 뒤에 곧바로 상세 시작 요약이
 * 붙어 이중 발화가 된다 — iOS는 `awaitingRoute`로 이미 막고 있었고 웹에는 없었다
 * (독립 리뷰 검출).
 */
describe("시작 조회를 기다리는 동안 간략 안내가 끼어들지 않는다", () => {
  it("대기 중 fix는 발화를 만들지 않고, 첫 발화는 상세 시작 요약이다", async () => {
    let openGate!: () => void;
    geoGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    renderGuide();
    click("start");
    // 걷는 중이라 fix는 계속 들어온다. ⚠ `act`로 감싸야 상태 갱신이 반영된다 —
    // 감싸지 않으면 억제가 없어도 검사 시점에 아직 빈 문자열이라 가드가 무력해진다
    // (변이 주입으로 확인).
    await waitFor(() => expect(fixCb).not.toBeNull());
    // ⚠ fix는 **하나만** 보낸다. 둘을 연달아 보내면 같은 문장이 만들어져 `announce`의
    // 재통지 경로(빈 값을 한 번 거쳤다가 120ms 뒤 복원)를 타므로, 검사 시점의 빈
    // 문자열이 "억제됐다"인지 "재통지 대기 중"인지 구분되지 않는다(변이로 확인).
    act(() => {
      sendFix(pt(10));
    });
    expect(live()).toBe("");

    openGate();
    // 창이 닫히면 첫 발화는 상세 시작 요약이다(간략 문장이 앞서지 않는다).
    await waitFor(() => expect(live()).toContain("상세 안내 시작"));
  });

  it("조회가 실패하면 보류가 풀려 간략 안내가 되살아난다", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });

    renderGuide();
    click("start");
    await waitFor(() => expect(live()).toContain("간략 안내로 시작합니다"));
    const fallbackText = live();

    // 폴백 이후의 fix는 정상적으로 간략 발화를 만든다(무한 억제 차단).
    await waitFor(() => expect(fixCb).not.toBeNull());
    sendFix(pt(10));
    await waitFor(() => expect(live()).not.toBe(fallbackText));
  });
});

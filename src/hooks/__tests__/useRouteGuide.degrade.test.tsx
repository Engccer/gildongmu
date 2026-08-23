// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ko from "../../../messages/ko.json";

const awaitGeolocation = vi.hoisted(() => vi.fn());
vi.mock("@/lib/geolocation", () => ({ awaitGeolocation }));

import { useRouteGuide } from "../useRouteGuide";

/**
 * 강등 사유 3-state(E16 축2, spec `2026-08-23-non-ko-walk-guidance-design.md` 부록 §A2).
 *
 * 종전에는 모든 실패가 `null` 하나로 접혀 소비자가 두 문장만 냈고, 그 "그 외"에 **재시도로
 * 풀리는 것과 아닌 것이 섞여** 있었다. 모드 이름을 지운 대가로 이 사유 문장이 유일한 단서가
 * 됐으므로, 각 원인이 실제로 제 문장을 내는지 못 박는다 — 이 스위트가 없으면 원인 하나를
 * 잘못 접어도 화면은 멀쩡하고 낭독만 틀린다.
 */
const M = 1 / 111320;
const pt = (m: number) => ({ lat: 37.5 + m * M, lng: 127.1 });
const DEST = { lat: 37.5 + 500 * M, lng: 127.1, name: "목적지" };

let fetchMock: ReturnType<typeof vi.fn>;

function Harness() {
  const g = useRouteGuide(DEST, "walk", false);
  return (
    <div>
      <button onClick={g.start}>start</button>
      <button onClick={g.requestReroute}>reroute</button>
      <p data-testid="live">{g.liveText}</p>
      <p data-testid="note">{g.degradeText ?? ""}</p>
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

const live = () => screen.getByTestId("live").textContent ?? "";
const note = () => screen.getByTestId("note").textContent ?? "";

async function start() {
  fireEvent.click(screen.getByText("start"));
  await waitFor(() => expect(live()).not.toBe(""));
}

beforeEach(() => {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
  });
  awaitGeolocation.mockResolvedValue({ status: "ready", coords: { lat: 37.5, lng: 127.1 } });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("강등 사유 3-state", () => {
  it("위치를 얻지 못하면 사유가 곧 상시 표시다(직선거리조차 불가한 유일한 상태)", async () => {
    awaitGeolocation.mockResolvedValue({ status: "error" });
    renderGuide();
    await start();
    expect(live()).toBe(ko.guide.degradedNoLocation);
    // ⚠ 이 상태만 "방향과 거리로 안내 중"이 거짓이라 사유가 곧 표시다.
    expect(note()).toBe(ko.guide.degradedNoLocation);
  });

  it("상류 5xx는 재시도 가능으로 가른다", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    renderGuide();
    await start();
    expect(live()).toBe(ko.guide.degradedRetryable);
  });

  it("429도 재시도 가능이다(레이트리밋은 기다리면 풀린다)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    renderGuide();
    await start();
    expect(live()).toBe(ko.guide.degradedRetryable);
  });

  it("400·404는 재시도로 풀리지 않는다 — 재시도 가능으로 위장하지 않는다", async () => {
    // ⚠ 모든 비-200을 retryable로 접으면 사용자가 효과 없는 재시작을 반복하고
    // 배포 결함(400)·키 부재(404)가 강등 뒤에 숨는다(설계 리뷰 #3).
    for (const status of [400, 404]) {
      fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({}) });
      renderGuide();
      await start();
      expect(live()).toBe(ko.guide.degradedUnavailable);
      cleanup();
    }
  });

  it("경로 없음(서버 result null)은 재시도로 풀리지 않는다", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ result: null }) });
    renderGuide();
    await start();
    expect(live()).toBe(ko.guide.degradedUnavailable);
  });

  it("커버리지 밖은 repo 전역 계층의 문구를 그대로 쓴다(사유를 새로 쓰지 않는다)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ outOfCoverage: true }),
    });
    renderGuide();
    await start();
    expect(live()).toBe(ko.common.outOfCoverage);
  });

  it("네트워크 예외는 재시도 가능이다", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    renderGuide();
    await start();
    expect(live()).toBe(ko.guide.degradedRetryable);
  });

  it("상시 표시도 사유별로 갈린다 — 세션 도중 들어온 사용자에게 그 줄이 유일한 신호다", async () => {
    // 한 문장으로 뭉개면 3-state를 만든 유일한 수혜자에게 "재시도로 풀리는가"가 도달하지 않는다.
    const cases: Array<[unknown, string]> = [
      [{ ok: false, status: 502, json: async () => ({}) }, ko.guide.degradedNoteRetryable],
      [{ ok: true, status: 200, json: async () => ({ result: null }) }, ko.guide.degradedNoteUnavailable],
      [{ ok: true, status: 200, json: async () => ({ outOfCoverage: true }) }, ko.guide.degradedNoteCoverage],
    ];
    for (const [res, expected] of cases) {
      fetchMock.mockResolvedValue(res);
      renderGuide();
      await start();
      expect(note()).toBe(expected);
      cleanup();
    }
  });

  it("상시 표시는 사유 통지와 다른 문자열이다 — 같은 문장을 live region과 DOM에 함께 두지 않는다", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    renderGuide();
    await start();
    expect(note()).toBe(ko.guide.degradedNoteRetryable);
    expect(note()).not.toBe(live());
  });

  it("상세가 서면 강등 표시가 사라진다(복구 전이)", async () => {
    // ⚠ **먼저 강등을 거쳐야 하는 테스트다.** 처음부터 성공하면 표시가 애초에 비어 있어
    // `clearDegrade`를 무력화해도 통과한다(변이 주입으로 실측한 구멍 — 2026-08-23).
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    renderGuide();
    await start();
    expect(note()).toBe(ko.guide.degradedNoteRetryable);

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          distanceMeters: 500,
          durationSeconds: 400,
          steps: [{ description: "직진 500m 이동", pathCoords: [pt(0), pt(500)] }],
        },
      }),
    });
    fireEvent.click(screen.getByText("reroute"));
    await waitFor(() => expect(note()).toBe(""));
  });

  it("위치를 되찾으면 noLocation 표시가 내려간다 — 거리를 안내하면서 위치를 모른다고 하지 않는다", async () => {
    awaitGeolocation.mockResolvedValue({ status: "error" });
    let watchCb: ((p: GeolocationPosition) => void) | undefined;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition: vi.fn((cb: (p: GeolocationPosition) => void) => {
          watchCb = cb;
          return 1;
        }),
        clearWatch: vi.fn(),
        getCurrentPosition: vi.fn(),
      },
    });
    renderGuide();
    await start();
    expect(note()).toBe(ko.guide.degradedNoLocation);

    await act(async () => {
      watchCb?.({
        coords: { latitude: 37.5, longitude: 127.1, accuracy: 10 },
        timestamp: Date.now(),
      } as GeolocationPosition);
    });
    await waitFor(() => expect(note()).toBe(ko.guide.degradedNoteRetryable));
  });

  it("재조회 실패는 자기 문장을 내고 사유 표시만 갱신한다", async () => {
    // ⚠ 재조회 실패는 **사용자 활성화의 직접 응답**이라 그 버튼이 무엇을 못 했는지가 답이다
    // (사유 문구가 아니라 rerouteFailed). 다만 세션은 계속 그 상태에 있으므로 표시는 갱신한다.
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ result: null }) });
    renderGuide();
    await start();
    expect(note()).toBe(ko.guide.degradedNoteUnavailable);

    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    fireEvent.click(screen.getByText("reroute"));
    await waitFor(() => expect(live()).toBe(ko.guide.rerouteFailed));
    expect(note()).toBe(ko.guide.degradedNoteRetryable);
  });

  it("강등 문구에 모드 이름을 쓰지 않는다", async () => {
    // 이름을 주면 고를 수 있는 모드로 읽힌다([[degraded-guidance-gets-no-mode-name]]).
    // 축 1이 "간략"을 지웠고 축 2가 그 짝 낱말("직선거리 안내")까지 지운다.
    for (const text of [
      ko.guide.degradedNoLocation,
      ko.guide.degradedRetryable,
      ko.guide.degradedUnavailable,
      ko.guide.degradedNoteRetryable,
      ko.guide.degradedNoteUnavailable,
      ko.guide.degradedNoteCoverage,
      ko.guide.degradedNoteHandoff,
    ]) {
      expect(text).not.toContain("간략");
      expect(text).not.toContain("직선거리 안내");
      expect(text).not.toContain("경로 안내로");
    }
  });
});

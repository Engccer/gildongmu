// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ko from "../../../messages/ko.json";
import en from "../../../messages/en.json";

vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({
    status: "ready" as const,
    coords: { lat: 37.5, lng: 127.1 },
  })),
}));

import { DistanceBeacon } from "../DistanceBeacon";

/**
 * 실시간 길 안내 패널의 렌더 계약(스펙 §4.2·§9). 판정 로직은 순수 리듀서
 * (`route-guide.test.ts`)가 이미 못 박으므로 여기서는 **컨트롤 노출 조건**만 본다:
 * 죽은 컨트롤이 없을 것(전환은 상세 경로 보유 시만·재조회는 이탈 시만), 통지 채널이
 * 하나뿐일 것.
 *
 * 좌표계는 리듀서 테스트와 같은 규약 — 위도 1도 ≈ 111,320m 남북 직선.
 */
const M = 1 / 111320;
const pt = (m: number) => ({ lat: 37.5 + m * M, lng: 127.1 });
/** lateral은 동쪽 오프셋(m) — 경도는 위도 보정을 거친다. */
const fixAt = (along: number, lateral: number, accuracy = 10) => ({
  coords: {
    latitude: 37.5 + along * M,
    longitude: 127.1 + (lateral * M) / Math.cos((37.5 * Math.PI) / 180),
    accuracy,
  },
});

const WALK_BODY = {
  result: {
    distanceMeters: 500,
    durationSeconds: 400,
    steps: [{ description: "직진 500m 이동", pathCoords: [pt(0), pt(500)] }],
  },
};

const DEST = { lat: 37.5 + 500 * M, lng: 127.1, name: "목적지" };

let watchCb: ((pos: unknown) => void) | null = null;
let nowMs = 0;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  watchCb = null;
  nowMs = 0;
  vi.spyOn(performance, "now").mockImplementation(() => nowMs);
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: vi.fn((success: (pos: unknown) => void) => {
        watchCb = success;
        return 1;
      }),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
  });
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => WALK_BODY }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPanel(locale: "ko" | "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "ko" ? ko : en}>
      <DistanceBeacon dest={DEST} />
    </NextIntlClientProvider>,
  );
}

/** 패널을 펼치고 추적을 시작한다. 라벨은 로케일 메시지 정본에서 읽는다. */
function openAndStart(locale: "ko" | "en") {
  const messages = locale === "ko" ? ko : en;
  fireEvent.click(screen.getByRole("button", { name: messages.beacon.heading }));
  fireEvent.click(screen.getByRole("button", { name: messages.beacon.start }));
}

/** watchPosition 콜백에 fix 하나를 주입한다(단조 시각도 함께 전진). */
function pushFix(atSeconds: number, along: number, lateral: number) {
  nowMs = atSeconds * 1000;
  act(() => {
    watchCb?.(fixAt(along, lateral));
  });
}

describe("DistanceBeacon 컨트롤 노출", () => {
  it("ko에서 상세 경로를 확보하면 전환 버튼이 나온다", async () => {
    renderPanel("ko");
    openAndStart("ko");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: ko.guide.toBriefButton }),
      ).toBeTruthy(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("includeGeometry=1"),
    );
  });

  it("상세 경로가 없으면 전환 버튼을 내지 않는다", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: null }) });
    renderPanel("ko");
    openAndStart("ko");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(ko.guide.detailUnavailable)).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: ko.guide.toBriefButton })).toBeNull();
    expect(screen.queryByRole("button", { name: ko.guide.toDetailButton })).toBeNull();
  });

  it("en에서는 전환 버튼도 경로 조회도 없다(상세는 ko 전용)", async () => {
    renderPanel("en");
    openAndStart("en");

    await waitFor(() => expect(screen.getByText(en.guide.briefStarted)).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: en.guide.toBriefButton })).toBeNull();
    expect(screen.queryByRole("button", { name: en.guide.toDetailButton })).toBeNull();
  });

  it("재조회 버튼은 이탈 상태에서만 나온다", async () => {
    renderPanel("ko");
    openAndStart("ko");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: ko.guide.toBriefButton })).toBeTruthy(),
    );

    expect(screen.queryByRole("button", { name: ko.guide.rerouteButton })).toBeNull();

    // 경로에서 80m 벗어난 채 20초 지속 → 이탈 확정(fix 간격은 재획득선 10초 이하).
    pushFix(0, 100, 80);
    pushFix(8, 100, 80);
    pushFix(16, 100, 80);
    pushFix(22, 100, 80);

    expect(screen.getByRole("button", { name: ko.guide.rerouteButton })).toBeTruthy();
    expect(screen.getByText(ko.guide.offRoute)).toBeTruthy();
  });

  it("추적 중에는 반복·진행 상황 버튼이 있다", async () => {
    renderPanel("ko");
    openAndStart("ko");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: ko.guide.repeatButton })).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: ko.guide.progressButton })).toBeTruthy();
  });

  it("도착 인계되면 간략으로 넘어간다(전환 버튼 라벨이 상태 신호)", async () => {
    // 100m 단일 구간 — 잔여 50m 이하가 되면 인계 조건(전 스텝 낭독 완료)이 성립한다.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          distanceMeters: 100,
          durationSeconds: 80,
          steps: [{ description: "직진 100m 이동", pathCoords: [pt(0), pt(100)] }],
        },
      }),
    });
    renderPanel("ko");
    openAndStart("ko");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: ko.guide.toBriefButton })).toBeTruthy(),
    );

    pushFix(0, 45, 0);
    pushFix(5, 90, 0);

    expect(screen.getByText(ko.guide.handoff)).toBeTruthy();
    expect(screen.getByRole("button", { name: ko.guide.toDetailButton })).toBeTruthy();
  });

  it("반복 버튼은 마지막 실행 안내를 다시 통지한다", async () => {
    renderPanel("ko");
    openAndStart("ko");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: ko.guide.repeatButton })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: ko.guide.repeatButton }));

    // 시작 발화는 요약을 포함하지만 반복 대상은 첫 안내 문장뿐이다(스펙 §5.3).
    expect(screen.getByText("직진 500m 이동")).toBeTruthy();
  });

  it("통지 채널은 단일 live region 하나뿐이다", async () => {
    const { container } = renderPanel("ko");
    openAndStart("ko");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: ko.guide.toBriefButton })).toBeTruthy(),
    );
    pushFix(0, 100, 0);

    expect(
      container.querySelectorAll('[aria-live], [role="status"], [role="alert"]'),
    ).toHaveLength(1);
  });
});

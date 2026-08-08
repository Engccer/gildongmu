// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ko.json";
import { __resetGeolocationForTest } from "@/lib/geolocation";
import {
  __resetManualLocationForTest,
  getManualLocation,
  setManualLocation,
} from "@/lib/manual-location-store";
import { runManualLocationJudgment, setManualJudgmentAnnouncer } from "@/lib/effective-location";
import { useManualLocationNotice } from "../useManualLocationNotice";

/**
 * `useManualLocationNotice`의 배선 계약 — Task 10 추가 요구사항(웹에 자동 해제
 * 통지를 걸지 않으면 해제가 무통지가 된다)을 검증한다. `effective-location.test.ts`가
 * "판정이 announcer를 정확히 1회 부른다"를 이미 잠갔으므로, 여기서는 그 콜백이
 * **이 훅을 통해 실제 DOM의 단일 polite live region에 도달하는지**만 본다.
 *
 * Harness는 `PlaceSearch`가 하는 일(훅 값을 live region에 렌더)만 재현한다 —
 * PlaceSearch 전체를 마운트하지 않고도 배선을 증명한다.
 */
function Harness() {
  const [notice, resetNotice] = useManualLocationNotice();
  return (
    <div>
      <p aria-live="polite" role="status">
        {notice}
      </p>
      <button type="button" onClick={resetNotice}>
        reset
      </button>
    </div>
  );
}

function renderHarness() {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <Harness />
    </NextIntlClientProvider>,
  );
}

/** getCurrentPosition을 좌표·정확도로 고정한다(effective-location.test.ts 동형). */
function stubGeolocation(coords: { lat: number; lng: number; accuracy: number }) {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (ok: PositionCallback) => {
        ok({
          coords: {
            latitude: coords.lat, longitude: coords.lng, accuracy: coords.accuracy,
            altitude: null, altitudeAccuracy: null, heading: null, speed: null,
          },
          timestamp: Date.now(),
        } as GeolocationPosition);
      },
    },
  });
}

function setMovedManualLocation() {
  setManualLocation({
    label: "길동 카페", lat: 37.5384, lng: 127.1432,
    origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
    setAt: 1,
  });
  stubGeolocation({ lat: 37.6384, lng: 127.1432, accuracy: 10 }); // 약 11km — drop 확정
}

describe("useManualLocationNotice", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetGeolocationForTest();
    __resetManualLocationForTest();
    setManualJudgmentAnnouncer(null);
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("등록 직후엔 통지가 비어 있다", () => {
    renderHarness();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("자동 해제 판정이 나면 단일 live region에 문구가 나타난다", async () => {
    renderHarness();
    setMovedManualLocation();
    await act(async () => {
      await runManualLocationJudgment();
    });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "이동이 감지되어 지정한 위치를 해제했습니다",
      );
    });
    // 판정 자체도 실제로 해제됐는지(통지가 유령이 아님을 함께 확인).
    expect(getManualLocation()).toBeNull();
  });

  it("resetNotice를 부르면 통지가 비워진다(새 검색이 우선하도록)", async () => {
    renderHarness();
    setMovedManualLocation();
    await act(async () => {
      await runManualLocationJudgment();
    });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).not.toBe("");
    });
    await act(async () => {
      screen.getByRole("button", { name: "reset" }).click();
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("언마운트하면 채널을 비워, 이후 재등록(다른 화면)이 정상 동작한다", async () => {
    const { unmount } = renderHarness();
    unmount();
    // 언마운트된 인스턴스가 채널을 쥔 채 남아있다면 재등록이 막히거나 유령
    // 콜백이 죽은 컴포넌트의 setState를 시도한다 — 새 Harness가 정상적으로
    // 통지를 받는다면 cleanup이 채널을 올바르게 비웠다는 뜻이다.
    renderHarness();
    setMovedManualLocation();
    await act(async () => {
      await runManualLocationJudgment();
    });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "이동이 감지되어 지정한 위치를 해제했습니다",
      );
    });
  });
});

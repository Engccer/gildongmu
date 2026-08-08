// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ko.json";
import { __resetGeolocationForTest } from "@/lib/geolocation";
import {
  __resetManualLocationForTest,
  setManualLocation,
} from "@/lib/manual-location-store";
import { PlaceSearch } from "../PlaceSearch";

// 이 프로젝트는 vitest globals를 켜지 않아(vitest.config.ts) RTL 자동 정리가
// 없다 — PlaceDetail.test.tsx와 동형으로 각 테스트 후 명시 cleanup.
afterEach(cleanup);

/**
 * fix 라운드 1: NearbyHub에서 고친 것과 같은 클래스의 결함(모달과 밑 화면 live
 * region 경합)이 홈에도 있다 — 여기서 최소 하나만 검증한다("현재 위치 지정"
 * 모달이 열려 있는 동안 홈 자신의 live region이 새 문자열을 받지 않아야 한다).
 * PlaceSearch는 원래 컴포넌트 테스트 하네스가 없던 화면이라(Task 9 보고서
 * 참조) 이 스위트는 그 mechanism 하나만 최소 범위로 고정한다.
 */
function renderHome() {
  render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <PlaceSearch isMockMode={false} />
    </NextIntlClientProvider>,
  );
}

describe("PlaceSearch — 현재 위치 지정 모달과 홈 live region 경합 방지", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetGeolocationForTest();
    __resetManualLocationForTest();
    // PlaceSearch는 마운트 시 requestLocation()을 스스로 부른다(홈 전용 effect
    // — NearbyHub는 안 부른다) — 좌표를 즉시 확정해 LocationBar가 "현재 위치"로
    // 안정적으로 렌더되게 한다(안 하면 jsdom 기본 navigator엔 geolocation이
    // 없어 "위치를 확인할 수 없습니다"로 떨어져 버튼을 못 찾는다).
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) => {
          ok({
            coords: {
              latitude: 37.5, longitude: 127.1, accuracy: 10,
              altitude: null, altitudeAccuracy: null, heading: null, speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("모달이 열리면 홈의 live region은 비워진다(경합 방지)", async () => {
    // liveMessage가 실제로 비어있지 않은 상태를 먼저 만든다 — 그래야 "모달이
    // 열리면 비워진다"는 단언에 검출력이 생긴다(가드를 지워도 애초에 빈
    // 문자열이면 이 단언은 항상 통과해 결함을 못 잡는다). 이 화면의 마운트
    // 트리거(useManualLocationJudgment)가 실제로 자동 해제 판정을 돌려
    // manualNotice를 채우는 경로를 그대로 태운다(합성 텍스트 주입 아님) —
    // beforeEach의 geolocation 스텁(37.5,127.1)이 아래 origin(37.5384,127.1432,
    // 약 5.7km 차)보다 훨씬 멀어 판정이 "이동"으로 확정된다.
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    renderHome();
    // 모달이 열리기 전엔 홈의 단일 live region이 유일한 status — 참조를 먼저 잡는다.
    const region = screen.getByRole("status");
    await waitFor(() => {
      expect(region.textContent).toBe("이동이 감지되어 지정한 위치를 해제했습니다");
    });

    fireEvent.click(screen.getByRole("button", { name: /현재 위치/ }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(region.textContent).toBe("");
  });

  it("모달을 Esc로 닫으면 홈 화면은 그대로 남는다(내비 칩이 사라지지 않음)", () => {
    renderHome();
    fireEvent.click(screen.getByRole("button", { name: /현재 위치/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    // 홈 고유 요소(내 주변 진입 칩)가 여전히 있으면 화면이 안 튕겨나간 것.
    expect(screen.getByRole("button", { name: "내 주변" })).toBeTruthy();
  });
});

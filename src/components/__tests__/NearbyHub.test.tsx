// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ko.json";
import { __resetGeolocationForTest } from "@/lib/geolocation";
import { __resetManualLocationForTest } from "@/lib/manual-location-store";
import { __resetNearbyPanelStore } from "@/lib/nearby-panel-store";
import { NearbyHub } from "../NearbyHub";

// 이 프로젝트는 vitest globals를 켜지 않아(vitest.config.ts) RTL 자동 정리가
// 없다 — PlaceDetail.test.tsx와 동형으로 각 테스트 후 명시 cleanup.
afterEach(cleanup);

/**
 * fix 라운드 1 회귀 테스트: NearbyHub 안에서 "현재 위치 지정" 모달을 여는 시나리오.
 *
 * Critical: NearbyHub의 기존 Esc 리스너(`activePanel`만 검사)와 ManualLocationPicker의
 * 자체 Esc 리스너가 같은 window에 등록되면서 경합했다 — 모달을 닫으려던 Esc가
 * 허브까지 함께 닫아 홈으로 튕겨나갔다(NearbyHub가 먼저 마운트돼 먼저 등록되므로
 * onBack이 먼저 실행). 고친 지점은 NearbyHub의 리스너 활성 조건에
 * `manualPickerOpen`을 추가한 것 — 모달이 열려 있으면 허브 Esc 자체를 비활성화한다.
 *
 * Important: 모달이 화면을 점유하는 동안엔 그 밑 화면(NearbyHub)의 live region이
 * **갱신을 멈춰야** 두 채널이 동시에 발화하지 않는다. ⚠ 비우는 것은 답이 아니다 —
 * `X → "" → X`가 닫는 순간 두 번째 발화를 만든다(최종 리뷰 I4).
 */
function renderHub(locationNotice = "") {
  const onBack = vi.fn();
  const tree = (notice: string) => (
    <NextIntlClientProvider locale="ko" messages={messages}>
      <NearbyHub
        canShowWhereAmI={false}
        canShowSubway={false}
        canShowBus={false}
        canShowBike={false}
        canShowClinic={false}
        canShowBarrierFree={false}
        canShowKids={false}
        canShowEvents={false}
        canShowSurroundings={false}
        canShowAir={false}
        locationNotice={notice}
        onBack={onBack}
      />
    </NextIntlClientProvider>
  );
  const { rerender } = render(tree(locationNotice));
  return { onBack, setNotice: (notice: string) => rerender(tree(notice)) };
}

function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: /현재 위치|지정한 위치/ }));
}

describe("NearbyHub — 현재 위치 지정 모달 경합", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetGeolocationForTest();
    __resetManualLocationForTest();
    __resetNearbyPanelStore();
  });

  it("모달이 열린 상태에서 Esc를 누르면 모달만 닫히고 허브는 그대로다", () => {
    const { onBack } = renderHub();
    openPicker();
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    // 모달은 닫히고, 허브의 onBack(=홈으로 튕겨나가는 경로)은 불리지 않는다.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("모달이 닫혀 있을 때 Esc는 여전히 허브를 닫는다(기존 계약 보존)", () => {
    const { onBack } = renderHub();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("모달을 열고 닫는 동안 허브 live region 텍스트가 한 번도 바뀌지 않는다", async () => {
    const notice = "이동이 감지되어 지정한 위치를 해제했습니다";
    renderHub(notice);
    const region = screen.getByText(notice);

    // 문자 데이터 변경을 세면 "재발화"를 직접 관측할 수 있다 — aria-live는 내용
    // 변경에 반응하므로 변경 0회가 곧 발화 0회다.
    const changes: string[] = [];
    const observer = new MutationObserver(() => changes.push(region.textContent ?? ""));
    observer.observe(region, { childList: true, characterData: true, subtree: true });

    openPicker();
    expect(region.textContent).toBe(notice);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(region.textContent).toBe(notice);

    await new Promise((resolve) => setTimeout(resolve, 0));
    observer.disconnect();
    expect(changes).toEqual([]);
  });

  it("닫은 뒤에는 다시 갱신된다(영구 동결이 아니다)", () => {
    const notice = "이동이 감지되어 지정한 위치를 해제했습니다";
    const { setNotice } = renderHub(notice);
    const region = screen.getByText(notice);

    openPicker();
    // 붙든 사이에 바뀐 값은 아직 보이지 않는다(모달이 자기 채널을 쓰는 중).
    setNotice("새 통지");
    expect(region.textContent).toBe(notice);

    fireEvent.keyDown(window, { key: "Escape" });

    // 놓아 준 시점에 한 번 발화한다.
    expect(region.textContent).toBe("새 통지");
  });
});

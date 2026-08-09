// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ko.json";
import {
  __resetManualLocationForTest,
  getManualLocation,
  setManualLocation,
} from "@/lib/manual-location-store";
import { ManualLocationPicker } from "../ManualLocationPicker";

// 이 프로젝트는 vitest globals를 켜지 않아(vitest.config.ts) RTL 자동 정리가
// 없다 — PlaceDetail.test.tsx와 동형으로 각 테스트 후 명시 cleanup.
afterEach(cleanup);

function renderPicker(onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <ManualLocationPicker onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return onClose;
}

describe("ManualLocationPicker", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetManualLocationForTest();
  });

  /**
   * fix 라운드 1 Important 2: 모달 제목이 앱 기본 검색(`search.label`, "장소
   * 검색")과 문자 그대로 같으면 결과를 고르는 행동이 검색인지 위치 지정인지
   * 헤딩만으론 구분할 수 없었다. 전용 키 `manualLocation.pickTitle`로 갈랐다.
   */
  it("제목이 앱 기본 검색과 다른 '위치 지정하기' 전용 문구다", () => {
    renderPicker();
    expect(screen.getByRole("heading", { name: "위치 지정하기" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "장소 검색" })).toBeNull();
  });

  /**
   * ⚠ **이 테스트가 지키는 것은 "버튼이 있다"가 아니라 "사용자가 갇히지 않는다"다.**
   * 표시줄의 형제 해제 버튼이 2026-08-09에 제거되면서 이것이 수동 위치를 되돌리는
   * 유일한 경로가 됐다 — 깨지면 사용자는 지정한 위치에서 나올 방법이 없다.
   */
  it("'현재 위치로 되돌리기'가 수동 위치를 해제하고 화면을 닫는다", async () => {
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: 1 }, setAt: 1,
    });
    const onClose = renderPicker();
    await userEvent.click(
      screen.getByRole("button", { name: "현재 위치로 되돌리기" }),
    );
    expect(getManualLocation()).toBeNull();
    // 닫기까지가 한 동작이다 — 해제만 하고 화면에 남으면 무엇이 바뀌었는지 알리는
    // 신호(복귀 포커스가 받는 표시줄 버튼 라벨)에 닿지 못한다.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 수동 위치가 없을 때도 노출한다: "현재 위치를 그대로 쓴다"는 확정 선택이고,
  // 조건을 두면 유일한 해제 경로에 조건이 하나 더 붙는다(iOS 동형 — 그쪽도
  // `.manualLocation` 타깃에서 무조건 노출한다).
  it("수동 위치가 없어도 되돌리기 버튼은 노출된다", () => {
    renderPicker();
    expect(
      screen.getByRole("button", { name: "현재 위치로 되돌리기" }),
    ).toBeTruthy();
  });
});

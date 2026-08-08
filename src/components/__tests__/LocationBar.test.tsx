// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ko.json";
import { __resetGeolocationForTest } from "@/lib/geolocation";
import { __resetManualLocationForTest, getManualLocation, setManualLocation } from "@/lib/manual-location-store";
import { LocationBar } from "../LocationBar";

// 이 프로젝트는 vitest globals를 켜지 않아(vitest.config.ts) RTL 자동 정리가
// 없다 — PlaceDetail.test.tsx와 동형으로 각 테스트 후 명시 cleanup.
afterEach(cleanup);

function renderBar(onPick = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <LocationBar onPick={onPick} />
    </NextIntlClientProvider>,
  );
}

describe("LocationBar", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetGeolocationForTest();
    __resetManualLocationForTest();
  });

  it("수동 위치가 없으면 지정 버튼만 있다", () => {
    renderBar();
    expect(screen.getByRole("button", { name: /현재 위치/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "지정 해제" })).toBeNull();
  });

  it("수동 위치가 있으면 '지정한 위치'로 읽히고 해제 버튼이 형제로 생긴다", () => {
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: 1 }, setAt: 1,
    });
    renderBar();
    const pick = screen.getByRole("button", { name: "지정한 위치, 길동 카페" });
    const clear = screen.getByRole("button", { name: "지정 해제" });
    // 중첩 인터랙티브 금지 — 두 버튼은 형제여야 한다.
    expect(pick.contains(clear)).toBe(false);
    expect(clear.contains(pick)).toBe(false);
  });

  it("origin이 없으면 확인 불가를 병기한다", () => {
    setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1 });
    renderBar();
    expect(screen.getByRole("button", { name: "지정한 위치, 길동 카페(위치 확인 불가)" })).toBeTruthy();
  });

  it("해제하면 포커스가 지정 버튼으로 이동한다", async () => {
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: 1 }, setAt: 1,
    });
    renderBar();
    await userEvent.click(screen.getByRole("button", { name: "지정 해제" }));
    expect(getManualLocation()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /현재 위치/ }));
  });

  it("지정 버튼을 누르면 onPick이 불린다", async () => {
    const onPick = vi.fn();
    renderBar(onPick);
    await userEvent.click(screen.getByRole("button", { name: /현재 위치/ }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ko.json";
import { __resetGeolocationForTest } from "@/lib/geolocation";
import {
  __resetManualLocationForTest,
  getManualLocation,
  setManualLocation,
  setManualVerdict,
} from "@/lib/manual-location-store";
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
    const pick = screen.getByRole("button", { name: "지정한 위치, 길동 카페, 위치 지정하기" });
    const clear = screen.getByRole("button", { name: "지정 해제" });
    // 중첩 인터랙티브 금지 — 두 버튼은 형제여야 한다.
    expect(pick.contains(clear)).toBe(false);
    expect(clear.contains(pick)).toBe(false);
  });

  it("origin이 없으면 확인 불가를 병기한다", () => {
    setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1 });
    renderBar();
    expect(
      screen.getByRole("button", { name: "지정한 위치, 길동 카페(위치 확인 불가), 위치 지정하기" }),
    ).toBeTruthy();
  });

  // I1: origin이 있어도 **지금** 판정이 불가능하면(권한 철회·실내 측위 실패) 검증
  // 가능형 라벨을 내면 안 된다. 그러면 애초에 검증 불가인 origin 없음 쪽이 더 정직한
  // 라벨을 받는 역전이 된다(spec §4.5).
  it("마지막 판정이 undecidable이면 origin이 있어도 확인 불가로 낭독된다", () => {
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: 1 }, setAt: 1,
    });
    setManualVerdict("undecidable");
    renderBar();
    expect(
      screen.getByRole("button", { name: "지정한 위치, 길동 카페(위치 확인 불가), 위치 지정하기" }),
    ).toBeTruthy();
  });

  it("판정이 keep으로 돌아오면 검증 가능형으로 되돌아온다", () => {
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: 1 }, setAt: 1,
    });
    setManualVerdict("undecidable");
    setManualVerdict("keep");
    renderBar();
    expect(screen.getByRole("button", { name: "지정한 위치, 길동 카페, 위치 지정하기" })).toBeTruthy();
  });

  it("재지정하면 옛 판정을 물려받지 않는다", () => {
    setManualLocation({
      label: "옛 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: 1 }, setAt: 1,
    });
    setManualVerdict("undecidable");
    setManualLocation({
      label: "새 카페", lat: 37.54, lng: 127.15,
      origin: { lat: 37.54, lng: 127.15, accuracy: 10, at: 2 }, setAt: 2,
    });
    renderBar();
    expect(screen.getByRole("button", { name: "지정한 위치, 새 카페, 위치 지정하기" })).toBeTruthy();
  });

  // I3: 상태만 이름으로 쓰면 "현재 위치, 버튼"으로 읽혀 누르면 무엇이 되는지 단서가
  // 0이다. 형제 버튼("지정 해제")이 동작으로 이름이 붙어 명명이 비대칭이기도 했다.
  it("주 버튼 이름은 상태와 동작을 함께 말한다", () => {
    renderBar();
    const pick = screen.getByRole("button", { name: "현재 위치 확인 중, 위치 지정하기" });
    // 한 줄 = 한 접근성 객체 — 시각 텍스트를 덮는 aria-label 없이 보이는 텍스트 자체.
    expect(pick.getAttribute("aria-label")).toBeNull();
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

// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ko.json";
import enMessages from "../../../messages/en.json";
import { __resetGeolocationForTest, requestLocation } from "@/lib/geolocation";
import {
  __resetCurrentAddressForTest,
  ensureCurrentAddress,
} from "@/lib/current-address-store";
import {
  __resetManualLocationForTest,
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

function renderBarEn(onPick = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
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

  // 위원장 실사용 판정 2026-08-09: 표시줄은 **버튼 하나**다. GPS가 기본값이라
  // 수동 지정은 의도적으로 고른 상태이고, 되돌리기는 지정 화면 안에 이미 있어
  // 첫 화면에 상시 노출할 빈도가 아니다. 해제 경로 생존은 ManualLocationPicker
  // 계약 테스트가 못 박는다(그 하나가 유일한 경로가 됐다).
  it("표시줄은 상태와 무관하게 버튼 하나다", () => {
    renderBar();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    cleanup();
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: 1 }, setAt: 1,
    });
    renderBar();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe("지정한 위치, 길동 카페, 위치 지정하기");
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

  it("지정 버튼을 누르면 onPick이 불린다", async () => {
    const onPick = vi.fn();
    renderBar(onPick);
    await userEvent.click(screen.getByRole("button", { name: /현재 위치/ }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});

/**
 * GPS 상태의 실주소 병기(위원장 실사용 판정 2026-08-09).
 *
 * 이 기능의 존재 이유는 "GPS가 틀렸을 때 스스로 고치는 것"인데, 표시줄이 "현재
 * 위치"라고만 말하면 시각장애 사용자는 GPS가 틀렸다는 사실 자체를 알 수 없다 —
 * 고칠 마음이 생길 근거가 화면에 없다.
 */
describe("LocationBar — GPS 주소 병기", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetGeolocationForTest();
    __resetManualLocationForTest();
    __resetCurrentAddressForTest();
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({
            coords: {
              latitude: 37.5384, longitude: 127.1432, accuracy: 10,
              altitude: null, altitudeAccuracy: null, heading: null, speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition),
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubReverse(address: string | null) {
    const spy = vi.fn(async () => ({ ok: true, json: async () => ({ address }) }));
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("주소를 얻으면 '현재 위치(주소 부근)'로 읽힌다", async () => {
    stubReverse("성내로 12");
    requestLocation();
    renderBar();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "현재 위치(성내로 12 부근), 위치 지정하기" }),
      ).toBeTruthy(),
    );
  });

  // 3-state 정직성: 모르면 거짓을 말하지 않고 기존 라벨로 남는다.
  it("주소를 못 얻으면 '현재 위치'로 폴백한다", async () => {
    stubReverse(null);
    requestLocation();
    renderBar();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "현재 위치, 위치 지정하기" }),
      ).toBeTruthy(),
    );
  });

  // 수동 상태 라벨은 이미 지정한 이름을 말한다 — 주소는 잉여이고, 표시되지 않을
  // 라벨을 위해 실좌표를 역지오코딩하는 것은 낭비다.
  it("수동 위치가 켜져 있으면 역지오코딩하지 않는다", async () => {
    const spy = stubReverse("성내로 12");
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: 1 }, setAt: 1,
    });
    requestLocation();
    renderBar();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "지정한 위치, 길동 카페, 위치 지정하기" }),
      ).toBeTruthy(),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  // 표시줄은 세 화면(채팅·검색·"내 주변") 첫 줄에 있다. 각자 조회하면 3배가 된다.
  it("표시줄이 여럿이어도 역지오코딩은 한 번이다", async () => {
    const spy = stubReverse("성내로 12");
    requestLocation();
    render(
      <NextIntlClientProvider locale="ko" messages={messages}>
        <LocationBar onPick={vi.fn()} />
        <LocationBar onPick={vi.fn()} />
        <LocationBar onPick={vi.fn()} />
      </NextIntlClientProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "현재 위치(성내로 12 부근), 위치 지정하기" }),
      ).toHaveLength(3),
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠ 스토어는 좌표 하나의 주소만 들고, 표시줄은 **자기 좌표가 안 바뀌어도** 그
   * 스토어 갱신에 재렌더된다(구독자니까). 다른 소비자가 다른 좌표를 조회해 스토어를
   * 채우면, 표시줄은 자기 자리(X)에 앉은 채 남의 자리(Z) 주소를 낭독하게 된다 —
   * 화면으로 반증할 수 없는 거짓 위치 주장이다. 훅의 키 대조가 그것을 막는다.
   *
   * 스토어의 "좌표 바뀌면 옛 주소 버리기"로는 못 막는다: 그건 **버리는** 쪽이고
   * 여기서 새로 들어오는 값은 **남의 좌표의 확정 주소**다.
   */
  it("다른 좌표의 주소가 스토어에 들어와도 자기 좌표의 라벨을 오염시키지 않는다", async () => {
    stubReverse("성내로 12");
    requestLocation();
    renderBar();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "현재 위치(성내로 12 부근), 위치 지정하기" }),
      ).toBeTruthy(),
    );

    // 다른 화면이 다른 좌표를 조회해 스토어를 덮는다(표시줄의 좌표는 그대로).
    stubReverse("천호대로 1000");
    await act(async () => {
      ensureCurrentAddress({ lat: 37.6, lng: 127.2 }, "ko");
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "현재 위치, 위치 지정하기" }),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByRole("button", { name: /천호대로 1000/ }),
    ).toBeNull();
  });

  // E27 잔여(2026-09-01): 비-ko 표시줄이 "Set location, 강동구청"으로 남던 자리.
  // 지정 시점에 이미 손에 있던 라틴 표기(`labelRoman`)를 1순위로 읽고 한글은 괄호로 민다.
  it("en: 수동 라벨은 라틴 표기가 낭독되고 한글은 시각 전용 괄호다", () => {
    setManualLocation({
      label: "강동구청", labelRoman: "Gangdong-gu Office",
      lat: 37.5301, lng: 127.1238,
      origin: { lat: 37.5301, lng: 127.1238, accuracy: 10, at: 1 }, setAt: 1,
    });
    const { container } = renderBarEn();
    const button = screen.getByRole("button", {
      name: "Set location, Gangdong-gu Office, Set your location",
    });
    expect(button.textContent).toBe(
      "Set location, Gangdong-gu Office (강동구청), Set your location",
    );
    // 괄호는 `aria-hidden` + `lang="ko"` 한 노드뿐 — 접근 이름에는 한글이 없다.
    const spans = container.querySelectorAll("span");
    expect(spans).toHaveLength(1);
    expect(spans[0].getAttribute("aria-hidden")).toBe("true");
    expect(spans[0].getAttribute("lang")).toBe("ko");
    expect(button.getAttribute("aria-label")).toBeNull();
  });

  it("en: 라틴 표기가 없으면 병기하지 않는다(옛 저장값·로마자 불가)", () => {
    setManualLocation({
      label: "강동구청", lat: 37.5301, lng: 127.1238,
      origin: { lat: 37.5301, lng: 127.1238, accuracy: 10, at: 1 }, setAt: 1,
    });
    const { container } = renderBarEn();
    expect(
      screen.getByRole("button", { name: "Set location, 강동구청, Set your location" }),
    ).toBeTruthy();
    expect(container.querySelectorAll("span")).toHaveLength(0);
  });

  it("ko는 labelRoman이 있어도 병기하지 않는다(byte-identical)", () => {
    setManualLocation({
      label: "강동구청", labelRoman: "Gangdong-gu Office",
      lat: 37.5301, lng: 127.1238,
      origin: { lat: 37.5301, lng: 127.1238, accuracy: 10, at: 1 }, setAt: 1,
    });
    const { container } = renderBar();
    expect(screen.getByRole("button").textContent).toBe(
      "지정한 위치, 강동구청, 위치 지정하기",
    );
    expect(container.querySelectorAll("span")).toHaveLength(0);
  });

  // 한 줄 = 한 접근성 객체 — 병기가 길어져도 시각 텍스트를 덮는 aria-label을
  // 쓰거나 인라인 span으로 쪼개지 않는다.
  it("병기된 이름도 단일 텍스트다", async () => {
    stubReverse("성내로 12");
    requestLocation();
    renderBar();
    await waitFor(() => {
      const pick = screen.getByRole("button", {
        name: "현재 위치(성내로 12 부근), 위치 지정하기",
      });
      expect(pick.getAttribute("aria-label")).toBeNull();
      expect(pick.querySelector("span")).toBeNull();
    });
  });
});

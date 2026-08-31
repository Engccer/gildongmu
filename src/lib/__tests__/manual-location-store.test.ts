// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetManualLocationForTest,
  clearManualLocation,
  getManualLocation,
  setManualLocation,
  subscribeManualLocation,
} from "../manual-location-store";

const STORAGE_KEY = "gildongmu:manual-location";

describe("manual-location-store", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetManualLocationForTest();
  });

  it("지정하면 읽히고 localStorage에 남는다", () => {
    setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1000 });
    expect(getManualLocation()?.label).toBe("길동 카페");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).label).toBe("길동 카페");
  });

  it("labelRoman은 저장·복원을 왕복하고, 없으면 없는 채로 남는다(E28 병기)", () => {
    setManualLocation({
      label: "강동구청", labelRoman: "Gangdong-gu Office",
      lat: 37.5301, lng: 127.1238, origin: null, setAt: 1000,
    });
    expect(getManualLocation()?.labelRoman).toBe("Gangdong-gu Office");
    // 저장소를 거쳐 복원해도 같다(zod 스키마가 필드를 떨구지 않는다).
    __resetManualLocationForTest();
    expect(getManualLocation()?.labelRoman).toBe("Gangdong-gu Office");

    setManualLocation({ label: "길동 카페", lat: 37.5, lng: 127.1, origin: null, setAt: 2000 });
    expect(getManualLocation()?.labelRoman).toBeUndefined();
  });

  it("revision이 지정마다 증가한다 (CAS 토큰)", () => {
    setManualLocation({ label: "A", lat: 37.5, lng: 127.1, origin: null, setAt: 1 });
    const first = getManualLocation()!.revision;
    setManualLocation({ label: "B", lat: 37.6, lng: 127.2, origin: null, setAt: 2 });
    expect(getManualLocation()!.revision).toBeGreaterThan(first);
  });

  it("해제하면 null이 되고 저장도 지워진다", () => {
    setManualLocation({ label: "A", lat: 37.5, lng: 127.1, origin: null, setAt: 1 });
    clearManualLocation();
    expect(getManualLocation()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("구독자에게 변경을 통지한다", () => {
    const listener = vi.fn();
    const unsub = subscribeManualLocation(listener);
    setManualLocation({ label: "A", lat: 37.5, lng: 127.1, origin: null, setAt: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    clearManualLocation();
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
    setManualLocation({ label: "B", lat: 37.6, lng: 127.2, origin: null, setAt: 2 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("손상된 저장값을 복원하지 않고 폐기한다", () => {
    localStorage.setItem(STORAGE_KEY, '{"label":"","lat":"x"}');
    __resetManualLocationForTest();
    expect(getManualLocation()).toBeNull();
  });

  it("JSON이 아닌 저장값도 폐기한다", () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    __resetManualLocationForTest();
    expect(getManualLocation()).toBeNull();
  });

  it("다른 탭의 storage 이벤트를 반영한다", () => {
    const listener = vi.fn();
    subscribeManualLocation(listener);
    const next = {
      revision: 9, label: "다른 탭", lat: 37.5, lng: 127.1, origin: null, setAt: 5,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: JSON.stringify(next) }));
    expect(getManualLocation()?.label).toBe("다른 탭");
    expect(listener).toHaveBeenCalled();
  });
});

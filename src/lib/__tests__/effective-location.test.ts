// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetGeolocationForTest } from "../geolocation";
import {
  __resetManualLocationForTest,
  getManualLocation,
  getManualVerdict,
  setManualLocation,
} from "../manual-location-store";
import {
  awaitEffectiveLocation,
  awaitRealFix,
  runManualLocationJudgment,
  setManualJudgmentAnnouncer,
} from "../effective-location";

/** getCurrentPosition을 좌표·정확도로 고정한다. */
function stubGeolocation(coords: { lat: number; lng: number; accuracy: number } | null) {
  const impl = (ok: PositionCallback, fail?: PositionErrorCallback) => {
    if (!coords) {
      fail?.({ code: 2, message: "unavailable" } as GeolocationPositionError);
      return;
    }
    ok({
      coords: {
        latitude: coords.lat, longitude: coords.lng, accuracy: coords.accuracy,
        altitude: null, altitudeAccuracy: null, heading: null, speed: null,
      },
      timestamp: Date.now(),
    } as GeolocationPosition);
  };
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: impl } });
}

describe("effective-location", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetGeolocationForTest();
    __resetManualLocationForTest();
    setManualJudgmentAnnouncer(null);
    vi.unstubAllGlobals();
  });

  it("수동 위치가 없으면 GPS 좌표를 source:'gps'로 준다", async () => {
    stubGeolocation({ lat: 37.5, lng: 127.1, accuracy: 10 });
    const eff = await awaitEffectiveLocation({ force: false });
    expect(eff).toEqual({ lat: 37.5, lng: 127.1, source: "gps" });
  });

  it("수동 위치가 있으면 force:false는 측위 없이 수동 좌표를 준다", async () => {
    const spy = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: spy } });
    setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1 });
    const eff = await awaitEffectiveLocation({ force: false });
    expect(eff).toEqual({ lat: 37.5384, lng: 127.1432, source: "manual" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("force:true는 수동 위치가 있어도 판정을 동반한다 — 멀리 이동했으면 GPS로 복귀", async () => {
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    stubGeolocation({ lat: 37.6384, lng: 127.1432, accuracy: 10 }); // 약 11km
    const eff = await awaitEffectiveLocation({ force: true });
    expect(eff?.source).toBe("gps");
    expect(getManualLocation()).toBeNull();
  });

  it("force:true라도 같은 자리면 수동 위치를 유지한다", async () => {
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    stubGeolocation({ lat: 37.5384, lng: 127.1432, accuracy: 10 });
    const eff = await awaitEffectiveLocation({ force: true });
    expect(eff?.source).toBe("manual");
    expect(getManualLocation()).not.toBeNull();
  });

  it("origin이 없으면 아무리 멀리 있어도 해제하지 않는다 (undecidable)", async () => {
    setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1 });
    stubGeolocation({ lat: 35.1796, lng: 129.0756, accuracy: 10 }); // 부산
    await awaitEffectiveLocation({ force: true });
    expect(getManualLocation()).not.toBeNull();
  });

  it("측위 실패면 수동 위치를 유지한다 (증거 부재)", async () => {
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    stubGeolocation(null);
    await runManualLocationJudgment();
    expect(getManualLocation()).not.toBeNull();
  });

  it("자동 해제는 통지를 정확히 1회 낸다", async () => {
    const announce = vi.fn();
    setManualJudgmentAnnouncer(announce);
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    stubGeolocation({ lat: 37.6384, lng: 127.1432, accuracy: 10 });
    await runManualLocationJudgment();
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("유지·판정불가는 통지하지 않는다", async () => {
    const announce = vi.fn();
    setManualJudgmentAnnouncer(announce);
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    stubGeolocation({ lat: 37.5384, lng: 127.1432, accuracy: 10 });
    await runManualLocationJudgment();
    expect(announce).not.toHaveBeenCalled();
  });

  it("판정 왕복 중 재지정되면 늦게 온 drop을 폐기한다 (CAS)", async () => {
    setManualLocation({
      label: "A", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    let release: (() => void) | null = null;
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) => {
          release = () =>
            ok({
              coords: {
                latitude: 37.6384, longitude: 127.1432, accuracy: 10,
                altitude: null, altitudeAccuracy: null, heading: null, speed: null,
              },
              timestamp: Date.now(),
            } as GeolocationPosition);
        },
      },
    });
    const pending = runManualLocationJudgment();
    setManualLocation({ label: "B", lat: 37.6, lng: 127.2, origin: null, setAt: 2 });
    release!();
    await pending;
    expect(getManualLocation()?.label).toBe("B");
  });

  // I1: 판정 결과를 버리면 라벨이 origin 유무만 보게 되어, **지금** 판정 불가한
  // 상태가 검증 가능형으로 낭독된다(spec §4.5). 세 갈래 모두 기록해야 한다.
  describe("판정 결과 기록", () => {
    const nearFix = { lat: 37.5384, lng: 127.1432, accuracy: 10, at: 0 };
    function setNearby() {
      setManualLocation({
        label: "길동 카페", lat: 37.5384, lng: 127.1432,
        origin: { ...nearFix, at: Date.now() / 1000 }, setAt: 1,
      });
    }

    it("측위 실패는 undecidable로 기록된다", async () => {
      setNearby();
      stubGeolocation(null);
      await runManualLocationJudgment();
      expect(getManualVerdict()).toBe("undecidable");
      // 유지가 계약이다(증거 부재는 해제 사유가 아니다).
      expect(getManualLocation()?.label).toBe("길동 카페");
    });

    it("정확도가 자격 상한을 넘는 fix도 undecidable이다", async () => {
      setNearby();
      stubGeolocation({ lat: 37.5384, lng: 127.1432, accuracy: 500 });
      await runManualLocationJudgment();
      expect(getManualVerdict()).toBe("undecidable");
    });

    it("같은 자리면 keep으로 기록된다", async () => {
      setNearby();
      stubGeolocation({ lat: 37.5384, lng: 127.1432, accuracy: 10 });
      await runManualLocationJudgment();
      expect(getManualVerdict()).toBe("keep");
    });

    it("origin이 없으면 측위 없이 undecidable로 기록된다", async () => {
      const spy = vi.fn();
      vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: spy } });
      setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1 });
      await runManualLocationJudgment();
      expect(getManualVerdict()).toBe("undecidable");
      expect(spy).not.toHaveBeenCalled();
    });

    it("판정 왕복 중 재지정되면 옛 판정을 새 위치에 기록하지 않는다", async () => {
      setNearby();
      let release: (() => void) | undefined;
      vi.stubGlobal("navigator", {
        geolocation: {
          getCurrentPosition: (ok: PositionCallback) => {
            release = () =>
              ok({
                coords: {
                  latitude: 37.5384, longitude: 127.1432, accuracy: 10,
                  altitude: null, altitudeAccuracy: null, heading: null, speed: null,
                },
                timestamp: Date.now(),
              } as GeolocationPosition);
          },
        },
      });
      const pending = runManualLocationJudgment();
      setManualLocation({ label: "B", lat: 37.6, lng: 127.2, origin: null, setAt: 2 });
      release!();
      await pending;
      expect(getManualVerdict()).toBeNull();
    });
  });

  it("awaitRealFix는 수동 위치를 무시하고 실좌표만 준다", async () => {
    setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1 });
    stubGeolocation({ lat: 37.9, lng: 127.9, accuracy: 10 });
    const real = await awaitRealFix({ force: true });
    expect(real).toEqual(
      expect.objectContaining({ lat: 37.9, lng: 127.9, accuracy: 10, __source: "real" }),
    );
  });
});

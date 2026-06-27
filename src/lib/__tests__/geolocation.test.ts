import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  awaitGeolocation,
  requestLocation,
  __resetGeolocationForTest,
} from "../geolocation";

type SuccessCb = (pos: { coords: { latitude: number; longitude: number } }) => void;
type ErrorCb = (err: { code: number }) => void;

function stubGeo(impl: (ok: SuccessCb, err: ErrorCb, opts?: PositionOptions) => void) {
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: impl } });
}

beforeEach(() => {
  __resetGeolocationForTest();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("geolocation 공유 스토어", () => {
  it("성공 시 ready 좌표를 캐시하고, 재요청해도 getCurrentPosition을 다시 부르지 않는다", async () => {
    const getPos = vi.fn((ok: SuccessCb) =>
      ok({ coords: { latitude: 37.5, longitude: 127.1 } }),
    );
    stubGeo(getPos);

    const g1 = await awaitGeolocation();
    expect(g1).toEqual({ status: "ready", coords: { lat: 37.5, lng: 127.1 } });

    // 캐시 재사용 — 팝업(getCurrentPosition) 재호출 없음.
    const g2 = await awaitGeolocation();
    expect(g2).toEqual(g1);
    requestLocation(); // 이미 ready → no-op
    expect(getPos).toHaveBeenCalledTimes(1);
  });

  it("동시 호출이어도 inflight 가드로 getCurrentPosition은 한 번만 실행된다", async () => {
    let success: SuccessCb | undefined;
    const getPos = vi.fn((ok: SuccessCb) => {
      success = ok;
    });
    stubGeo(getPos);

    const p1 = awaitGeolocation();
    const p2 = awaitGeolocation();
    expect(getPos).toHaveBeenCalledTimes(1);

    success!({ coords: { latitude: 1, longitude: 2 } });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ status: "ready", coords: { lat: 1, lng: 2 } });
    expect(r2).toEqual(r1);
  });

  it("권한 거부·위치불가는 denied로 정착한다", async () => {
    stubGeo((_ok, err) => err({ code: 1 }));
    expect(await awaitGeolocation()).toEqual({ status: "denied" });
  });

  it("geolocation 미지원이면 unsupported", async () => {
    vi.stubGlobal("navigator", {});
    expect(await awaitGeolocation()).toEqual({ status: "unsupported" });
  });

  it("force:true면 이미 ready여도 getCurrentPosition을 다시 호출해 좌표를 갱신한다", async () => {
    let lat = 37.5;
    const getPos = vi.fn((ok: SuccessCb) =>
      ok({ coords: { latitude: lat, longitude: 127.1 } }),
    );
    stubGeo(getPos);

    const g1 = await awaitGeolocation();
    expect(g1).toEqual({ status: "ready", coords: { lat: 37.5, lng: 127.1 } });

    lat = 35.2; // 사용자가 이동 — 새로고침으로 새 좌표를 받아야 한다.
    const g2 = await awaitGeolocation({ force: true });
    expect(getPos).toHaveBeenCalledTimes(2);
    expect(g2).toEqual({ status: "ready", coords: { lat: 35.2, lng: 127.1 } });
  });

  it("force:true는 정확도 우선 옵션(highAccuracy·maximumAge:0)으로 호출한다", async () => {
    const getPos = vi.fn((ok: SuccessCb) =>
      ok({ coords: { latitude: 1, longitude: 2 } }),
    );
    stubGeo(getPos);

    await awaitGeolocation({ force: true });
    const opts = getPos.mock.calls[0][2] as PositionOptions;
    expect(opts.enableHighAccuracy).toBe(true);
    expect(opts.maximumAge).toBe(0);
  });

  it("기본 호출은 빠른 옵션(저정밀·짧은 maximumAge)으로 호출한다", async () => {
    const getPos = vi.fn((ok: SuccessCb) =>
      ok({ coords: { latitude: 1, longitude: 2 } }),
    );
    stubGeo(getPos);

    await awaitGeolocation();
    const opts = getPos.mock.calls[0][2] as PositionOptions;
    expect(opts.enableHighAccuracy).toBe(false);
    expect(opts.maximumAge).toBeGreaterThan(0);
    // 5분(기존 stale 위험)보다 짧아야 한다.
    expect(opts.maximumAge).toBeLessThan(300_000);
  });

  it("force 동시 호출도 inflight 가드로 getCurrentPosition은 한 번만 실행된다", async () => {
    const getPos = vi.fn((ok: SuccessCb) =>
      ok({ coords: { latitude: 1, longitude: 2 } }),
    );
    stubGeo(getPos);
    await awaitGeolocation(); // ready

    let success: SuccessCb | undefined;
    stubGeo((ok) => {
      success = ok;
    });
    const p1 = awaitGeolocation({ force: true });
    const p2 = awaitGeolocation({ force: true });
    success!({ coords: { latitude: 9, longitude: 9 } });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ status: "ready", coords: { lat: 9, lng: 9 } });
    expect(r2).toEqual(r1);
  });
});

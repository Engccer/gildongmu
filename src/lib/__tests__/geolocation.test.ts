import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  awaitGeolocation,
  requestLocation,
  __resetGeolocationForTest,
} from "../geolocation";

type SuccessCb = (pos: { coords: { latitude: number; longitude: number } }) => void;
type ErrorCb = (err: { code: number }) => void;

function stubGeo(impl: (ok: SuccessCb, err: ErrorCb) => void) {
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
});

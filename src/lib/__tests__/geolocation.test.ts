import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  awaitGeolocation,
  requestLocation,
  DIRECTIONS_ORIGIN_MAX_AGE_SECONDS,
  __resetGeolocationForTest,
} from "../geolocation";

type SuccessCb = (pos: {
  coords: { latitude: number; longitude: number };
  timestamp?: number;
}) => void;
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
    expect(g1).toMatchObject({ status: "ready", coords: { lat: 37.5, lng: 127.1 } });

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
    expect(r1).toMatchObject({ status: "ready", coords: { lat: 1, lng: 2 } });
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
    expect(g1).toMatchObject({ status: "ready", coords: { lat: 37.5, lng: 127.1 } });

    lat = 35.2; // 사용자가 이동 — 새로고침으로 새 좌표를 받아야 한다.
    const g2 = await awaitGeolocation({ force: true });
    expect(getPos).toHaveBeenCalledTimes(2);
    expect(g2).toMatchObject({ status: "ready", coords: { lat: 35.2, lng: 127.1 } });
  });

  it("force:true는 정확도 우선 옵션(highAccuracy·maximumAge:0)으로 호출한다", async () => {
    const getPos = vi.fn((ok: SuccessCb, _err?: ErrorCb, _opts?: PositionOptions) =>
      ok({ coords: { latitude: 1, longitude: 2 } }),
    );
    stubGeo(getPos);

    await awaitGeolocation({ force: true });
    const opts = getPos.mock.calls[0][2]!;
    expect(opts.enableHighAccuracy).toBe(true);
    expect(opts.maximumAge).toBe(0);
  });

  it("기본 호출은 빠른 옵션(저정밀·짧은 maximumAge)으로 호출한다", async () => {
    const getPos = vi.fn((ok: SuccessCb, _err?: ErrorCb, _opts?: PositionOptions) =>
      ok({ coords: { latitude: 1, longitude: 2 } }),
    );
    stubGeo(getPos);

    await awaitGeolocation();
    const opts = getPos.mock.calls[0][2]!;
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
    expect(r1).toMatchObject({ status: "ready", coords: { lat: 9, lng: 9 } });
    expect(r2).toEqual(r1);
  });
});

/**
 * A7 — 이 스토어에는 TTL이 없어서 한 번 `ready`가 되면 세션 내내 같은 좌표가 나온다.
 * 길찾기 출발지처럼 "지금 어디 있는가"가 답의 일부인 조회는 그 사이 이동을 조용히
 * 놓친다(오류도 빈 결과도 아니라 그럴듯한 경로가 온다).
 */
describe("나이 기준 재취득 (maxAgeSeconds)", () => {
  /** 지정한 fix 시각으로 성공 응답을 준다. */
  function stubAt(timestamp: number, lat = 37.5, lng = 127.1) {
    const getPos = vi.fn((ok: SuccessCb, _err?: ErrorCb, _opts?: PositionOptions) =>
      ok({ coords: { latitude: lat, longitude: lng }, timestamp }),
    );
    stubGeo(getPos);
    return getPos;
  }

  it("fix 취득 시각(수신 시각이 아니라)을 초 단위로 좌표에 싣는다", async () => {
    const measured = Date.now() - 30_000; // OS 캐시 fix — 30초 전에 측정됐다
    stubAt(measured);
    const g = await awaitGeolocation();
    expect(g).toMatchObject({ status: "ready", coords: { at: measured / 1000 } });
  });

  it("상한 이내 캐시는 재측위 없이 그대로 쓴다", async () => {
    const getPos = stubAt(Date.now() - 60_000); // 1분 전 fix
    await awaitGeolocation();

    const g = await awaitGeolocation({ maxAgeSeconds: DIRECTIONS_ORIGIN_MAX_AGE_SECONDS });
    expect(getPos).toHaveBeenCalledTimes(1);
    expect(g).toMatchObject({ status: "ready", coords: { lat: 37.5 } });
  });

  it("상한을 넘긴 캐시는 다시 재고 새 좌표를 준다", async () => {
    stubAt(Date.now() - 10 * 60_000, 37.5); // 10분 전 fix
    await awaitGeolocation();

    const refetch = stubAt(Date.now(), 35.2); // 사용자가 이동한 뒤
    const g = await awaitGeolocation({ maxAgeSeconds: DIRECTIONS_ORIGIN_MAX_AGE_SECONDS });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(g).toMatchObject({ status: "ready", coords: { lat: 35.2 } });
  });

  it("나이 초과 재취득은 정밀 옵션으로 간다(이동 뒤의 저정밀 fix는 출발지로 나쁘다)", async () => {
    stubAt(Date.now() - 10 * 60_000);
    await awaitGeolocation();

    const refetch = stubAt(Date.now());
    await awaitGeolocation({ maxAgeSeconds: DIRECTIONS_ORIGIN_MAX_AGE_SECONDS });
    const opts = refetch.mock.calls[0][2]!;
    expect(opts.enableHighAccuracy).toBe(true);
    expect(opts.maximumAge).toBe(0);
  });

  it("믿을 수 없는 timestamp(상대 시각·시계 점프)는 수신 시각으로 떨어진다", async () => {
    // 그 좌표를 영구히 낡은 것으로 만들어 매 조회마다 다시 재는 쪽이 더 나쁜 실패다.
    stubAt(12_345); // epoch 밀리초가 아닌 값
    const g = await awaitGeolocation();
    const at = (g as { coords: { at: number } }).coords.at;
    expect(Math.abs(at - Date.now() / 1000)).toBeLessThan(5);
  });

  it("maxAgeSeconds를 주지 않는 소비자의 동작은 그대로다(캐시 무조건 재사용)", async () => {
    const getPos = stubAt(Date.now() - 60 * 60_000); // 1시간 전 fix
    await awaitGeolocation();
    await awaitGeolocation();
    requestLocation();
    expect(getPos).toHaveBeenCalledTimes(1);
  });
});

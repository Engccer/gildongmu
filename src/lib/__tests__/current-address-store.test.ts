import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetCurrentAddressForTest,
  coordAddressKey,
  ensureCurrentAddress,
  getCurrentAddressSnapshot,
  subscribeCurrentAddress,
} from "@/lib/current-address-store";

/** 다음 마이크로태스크까지 흘려 fetch then 체인을 정착시킨다. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function stubFetch(impl: (url: string) => unknown) {
  const spy = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => impl(url),
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("current-address-store", () => {
  beforeEach(() => {
    __resetCurrentAddressForTest();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("좌표를 확정 주소로 채운다", async () => {
    stubFetch(() => ({ address: "성내로 12" }));
    ensureCurrentAddress({ lat: 37.5384, lng: 127.1432 }, "ko");
    await settle();
    expect(getCurrentAddressSnapshot()).toEqual({
      key: coordAddressKey({ lat: 37.5384, lng: 127.1432 }),
      lang: "ko",
      value: { address: "성내로 12", english: null },
    });
  });

  it("en 요청은 lang을 실어 보내고 공식 영문(addressEn) 또는 로마자(addressRoman)를 english로 든다", async () => {
    const spy = stubFetch(() => ({ address: "성내로 12", addressEn: "12 Seongnae-ro" }));
    ensureCurrentAddress({ lat: 37.5384, lng: 127.1432 }, "en");
    await settle();
    expect(String(spy.mock.calls[0][0])).toContain("lang=en");
    expect(getCurrentAddressSnapshot()).toEqual({
      key: coordAddressKey({ lat: 37.5384, lng: 127.1432 }),
      lang: "en",
      value: { address: "성내로 12", english: "12 Seongnae-ro" },
    });
    // 같은 좌표라도 언어가 바뀌면 다시 받는다(영문 병기는 en 응답에만 실린다).
    stubFetch(() => ({ address: "성내로 12" }));
    ensureCurrentAddress({ lat: 37.5384, lng: 127.1432 }, "ko");
    await settle();
    expect(getCurrentAddressSnapshot()).toEqual({
      key: coordAddressKey({ lat: 37.5384, lng: 127.1432 }),
      lang: "ko",
      value: { address: "성내로 12", english: null },
    });
  });

  // 세 화면(채팅·검색·"내 주변")의 표시줄이 동시에 불러도 역지오코딩은 한 번이다.
  it("같은 좌표를 여러 번 불러도 왕복은 한 번이다", async () => {
    const spy = stubFetch(() => ({ address: "성내로 12" }));
    ensureCurrentAddress({ lat: 37.5384, lng: 127.1432 }, "ko");
    ensureCurrentAddress({ lat: 37.5384, lng: 127.1432 }, "ko");
    await settle();
    ensureCurrentAddress({ lat: 37.5384, lng: 127.1432 }, "ko");
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // 4자리(±5.5m)는 GPS 오차보다 작다 — 같은 자리의 미세 흔들림은 재조회가 아니다.
  it("반올림이 같은 좌표는 재조회하지 않는다", async () => {
    const spy = stubFetch(() => ({ address: "성내로 12" }));
    ensureCurrentAddress({ lat: 37.53841, lng: 127.14321 }, "ko");
    await settle();
    ensureCurrentAddress({ lat: 37.53842, lng: 127.14322 }, "ko");
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // 재시도하지 않는 것이 계약이다 — 실패는 "주소 없음"으로 확정된다(라벨은 "현재
  // 위치"로 남는다). 재시도 루프는 라벨을 뒤늦게 바꿔 VoiceOver 재낭독만 만든다.
  it("실패는 주소 없음으로 확정되고 재시도하지 않는다", async () => {
    const spy = vi.fn(async () => {
      throw new Error("network");
    });
    vi.stubGlobal("fetch", spy);
    ensureCurrentAddress({ lat: 37.5384, lng: 127.1432 }, "ko");
    await settle();
    expect(getCurrentAddressSnapshot()).toEqual({
      key: coordAddressKey({ lat: 37.5384, lng: 127.1432 }),
      lang: "ko",
      value: null,
    });
    ensureCurrentAddress({ lat: 37.5384, lng: 127.1432 }, "ko");
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // 새 좌표에 옛 주소를 붙여 두면 화면으로 반증할 수 없는 거짓 위치 주장이 된다.
  it("좌표가 바뀌면 새 주소가 오기 전에 옛 주소를 버린다", async () => {
    let answer = "성내로 12";
    stubFetch(() => ({ address: answer }));
    ensureCurrentAddress({ lat: 37.5384, lng: 127.1432 }, "ko");
    await settle();
    answer = "천호대로 1000";
    ensureCurrentAddress({ lat: 37.6, lng: 127.2 }, "ko");
    // 왕복이 끝나기 전 스냅샷 — 옛 주소가 남아 있으면 안 된다.
    expect(getCurrentAddressSnapshot()).toBeNull();
    await settle();
    expect(getCurrentAddressSnapshot()?.value?.address).toBe("천호대로 1000");
  });

  // latest-wins: 늦게 도착한 옛 좌표의 응답이 새 좌표의 주소를 덮지 않는다.
  it("앞지른 새 좌표가 있으면 늦은 응답을 폐기한다", async () => {
    const resolvers: Array<() => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: () =>
          new Promise((resolve) =>
            resolvers.push(() => resolve({ address: url.includes("37.6") ? "새 주소" : "옛 주소" })),
          ),
      })),
    );
    ensureCurrentAddress({ lat: 37.5384, lng: 127.1432 }, "ko");
    await settle();
    ensureCurrentAddress({ lat: 37.6, lng: 127.2 }, "ko");
    await settle();
    // 새 좌표 응답 먼저, 옛 좌표 응답 나중에 도착.
    resolvers[1]?.();
    await settle();
    resolvers[0]?.();
    await settle();
    expect(getCurrentAddressSnapshot()?.value?.address).toBe("새 주소");
  });

  it("구독자는 주소 확정 시 통지받는다", async () => {
    stubFetch(() => ({ address: "성내로 12" }));
    const listener = vi.fn();
    subscribeCurrentAddress(listener);
    ensureCurrentAddress({ lat: 37.5384, lng: 127.1432 }, "ko");
    await settle();
    expect(listener).toHaveBeenCalled();
  });
});

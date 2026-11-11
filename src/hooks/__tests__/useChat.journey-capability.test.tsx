// @vitest-environment jsdom
/**
 * 채팅 요청의 여정 능력 신고(E70-b spec D7·D2): 신고하지 않으면 요청 본문이 종전과 글자 그대로 같고, 신고하면
 * `capabilities`·`userLocationManual` 두 필드만 더해진다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

vi.mock("next-intl", () => ({ useLocale: () => "ko" }));
const stores = vi.hoisted(() => ({
  geo: { status: "ready", coords: { lat: 37.55, lng: 126.95 } } as unknown,
  manual: null as null | { lat: number; lng: number; label: string },
}));
vi.mock("@/hooks/useGeolocation", () => ({ useGeolocation: () => stores.geo }));
vi.mock("@/hooks/useManualLocation", () => ({ useManualLocation: () => stores.manual }));

import { useChat, type PlaceContext } from "../useChat";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  stores.manual = null;
  // 본문 없는 응답 — 훅은 실패로 접고 끝난다(여기서 보는 것은 보낸 본문뿐이다).
  fetchMock = vi.fn(async () => ({ ok: false, body: null, json: async () => ({}) }) as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function sentBody(opts?: Parameters<typeof useChat>[0]): Promise<string> {
  const { result } = renderHook(() => useChat(opts));
  await act(async () => {
    await result.current.sendMessage("자동차로 신도림역까지 가서 지하철로 강남 가는 길");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return (fetchMock.mock.calls[0][1] as RequestInit).body as string;
}

const text = "자동차로 신도림역까지 가서 지하철로 강남 가는 길";
/** 능력 신고가 생기기 전의 요청 본문(키 순서까지) — 이 모양이 바뀌면 옛 서버·캐시와의 동일성이 깨진다. */
const legacyBody = (userLocation: unknown, placeContext?: PlaceContext) =>
  JSON.stringify({ messages: [{ role: "user", text }], userLocation, locale: "ko", placeContext });

describe("useChat 여정 능력 신고", () => {
  it("옵션이 없으면 요청 본문이 종전과 같다", async () => {
    expect(await sentBody()).toBe(legacyBody({ lat: 37.55, lng: 126.95 }));
  });

  it("journeyCapable이 거짓이면 요청 본문이 종전과 같다", async () => {
    expect(await sentBody({ journeyCapable: false })).toBe(legacyBody({ lat: 37.55, lng: 126.95 }));
  });

  it("장소 앵커 채팅(신고 없음)은 수동 위치가 있어도 두 필드를 싣지 않는다", async () => {
    stores.manual = { lat: 37.5, lng: 127.0, label: "강남역" };
    const place: PlaceContext = { name: "광화문", lat: 37.571, lng: 126.976 };
    const body = await sentBody({ placeContext: place });
    expect(body).toBe(legacyBody({ lat: 37.5, lng: 127.0 }, place));
    expect(body).not.toContain("capabilities");
    expect(body).not.toContain("userLocationManual");
  });

  it("신고하면 capabilities와 userLocationManual(GPS면 false)만 더해진다", async () => {
    const body = JSON.parse(await sentBody({ journeyCapable: true }));
    expect(body.capabilities).toEqual(["journey"]);
    expect(body.userLocationManual).toBe(false);
    delete body.capabilities;
    delete body.userLocationManual;
    expect(JSON.stringify(body)).toBe(legacyBody({ lat: 37.55, lng: 126.95 }));
  });

  it("신고하고 채팅 위치가 수동 지정이면 userLocationManual이 true이고 userLocation은 그 수동 좌표다", async () => {
    stores.manual = { lat: 37.5, lng: 127.0, label: "강남역" };
    const body = JSON.parse(await sentBody({ journeyCapable: true }));
    expect(body.userLocationManual).toBe(true);
    expect(body.userLocation).toEqual({ lat: 37.5, lng: 127.0 });
  });
});

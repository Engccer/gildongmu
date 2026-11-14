// @vitest-environment jsdom
/**
 * 채팅 요청의 경로 안내 시작 카드 능력 신고(E83 spec R2): 신고하지 않으면 요청 본문이 종전과 글자 그대로 같고, 신고하면
 * `capabilities`·`userLocationManual` 두 필드만 더해진다. 여정 신고와 서로 독립이다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

vi.mock("next-intl", () => ({ useLocale: () => "ko" }));
const stores = vi.hoisted(() => ({
  geo: { status: "ready", coords: { lat: 37.5663, lng: 126.9779 } } as unknown,
  manual: null as null | { lat: number; lng: number; label: string },
}));
vi.mock("@/hooks/useGeolocation", () => ({ useGeolocation: () => stores.geo }));
vi.mock("@/hooks/useManualLocation", () => ({ useManualLocation: () => stores.manual }));

import { useChat } from "../useChat";

const text = "강남역까지 걸어가는 길 알려줘";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  stores.manual = null;
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
    await result.current.sendMessage(text);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return (fetchMock.mock.calls[0][1] as RequestInit).body as string;
}

/** 능력 신고가 생기기 전의 요청 본문(키 순서까지). */
const legacyBody = (userLocation: unknown) =>
  JSON.stringify({ messages: [{ role: "user", text }], userLocation, locale: "ko", placeContext: undefined });
const SEOUL_CITY_HALL = { lat: 37.5663, lng: 126.9779 };

describe("useChat 경로 안내 시작 카드 능력 신고", () => {
  it("routeStartCapable이 거짓이면 요청 본문이 종전과 같다", async () => {
    expect(await sentBody({ routeStartCapable: false })).toBe(legacyBody(SEOUL_CITY_HALL));
  });

  it("신고하면 capabilities와 userLocationManual만 더해진다", async () => {
    const raw = await sentBody({ routeStartCapable: true });
    const body = JSON.parse(raw);
    expect(body.capabilities).toEqual(["route-start"]);
    expect(body.userLocationManual).toBe(false);
    delete body.capabilities;
    delete body.userLocationManual;
    expect(JSON.stringify(body)).toBe(legacyBody(SEOUL_CITY_HALL));
  });

  it("여정과 함께 신고하면 두 능력이 여정, 경로 안내 시작 순으로 실린다", async () => {
    const body = JSON.parse(await sentBody({ journeyCapable: true, routeStartCapable: true }));
    expect(body.capabilities).toEqual(["journey", "route-start"]);
  });

  it("여정만 신고한 요청은 종전 그대로 journey 하나다", async () => {
    const body = JSON.parse(await sentBody({ journeyCapable: true }));
    expect(body.capabilities).toEqual(["journey"]);
  });

  it("채팅 위치가 수동 지정이면 userLocationManual이 true다(서버가 카드에 manualOrigin을 싣는 근거)", async () => {
    stores.manual = { lat: 37.5, lng: 127.0, label: "강남역" };
    const body = JSON.parse(await sentBody({ routeStartCapable: true }));
    expect(body.userLocationManual).toBe(true);
    expect(body.userLocation).toEqual({ lat: 37.5, lng: 127.0 });
  });
});

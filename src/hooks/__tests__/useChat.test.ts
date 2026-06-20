// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// useGeolocation을 vi.fn()으로 설정해 테스트별로 반환값을 바꿀 수 있게 한다.
const mockUseGeolocation = vi.fn(() => ({ status: "idle" as const }));
vi.mock("next-intl", () => ({ useLocale: () => "ko" }));
vi.mock("@/hooks/useGeolocation", () => ({
  useGeolocation: () => mockUseGeolocation(),
}));

import { useChat } from "../useChat";

beforeEach(() => {
  vi.clearAllMocks();
  // 기본: idle 상태 (userLocation = undefined)
  mockUseGeolocation.mockReturnValue({ status: "idle" });
  global.fetch = vi.fn(async () =>
    new Response(
      JSON.stringify({ text: "길동 카페를 찾았어요.", render: { type: "places", places: [] } }),
      { status: 200 },
    ),
  ) as unknown as typeof fetch;
});

describe("useChat", () => {
  it("sendMessage가 user+assistant 메시지를 추가", async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("길동 카페");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages[0]).toMatchObject({ role: "user", text: "길동 카페" });
    expect(result.current.messages[1]).toMatchObject({
      role: "assistant",
      text: "길동 카페를 찾았어요.",
    });
    expect(result.current.messages[1].render).toEqual({ type: "places", places: [] });
  });

  it("502면 error 설정", async () => {
    global.fetch = vi.fn(async () => new Response("{}", { status: 502 })) as unknown as typeof fetch;
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("x");
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it("빈 문자열은 전송하지 않음", async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("   ");
    });
    expect(result.current.messages).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("dismissError가 error를 초기화", async () => {
    global.fetch = vi.fn(async () => new Response("{}", { status: 502 })) as unknown as typeof fetch;
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("x");
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    act(() => {
      result.current.dismissError();
    });
    expect(result.current.error).toBeNull();
  });

  it("위치 ready 상태면 coords를 body에 포함", async () => {
    // ready 상태로 모킹 재정의 (GeoState union — as unknown as any로 타입 캐스팅)
    mockUseGeolocation.mockReturnValue({
      status: "ready",
      coords: { lat: 37.5, lng: 127.1 },
    } as unknown as ReturnType<typeof mockUseGeolocation>);

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("테스트");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.userLocation).toEqual({ lat: 37.5, lng: 127.1 });
  });
});

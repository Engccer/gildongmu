// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// useGeolocation을 vi.fn()으로 설정해 테스트별로 반환값을 바꿀 수 있게 한다.
const mockUseGeolocation = vi.fn(() => ({ status: "idle" as const }));
vi.mock("next-intl", () => ({ useLocale: () => "ko" }));
vi.mock("@/hooks/useGeolocation", () => ({
  useGeolocation: () => mockUseGeolocation(),
}));

import { __resetManualLocationForTest, setManualLocation } from "@/lib/manual-location-store";
import { useChat } from "../useChat";

/** NDJSON 스트림 응답을 만드는 헬퍼. */
function makeNdjsonResponse(lines: object[], status = 200): Response {
  const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  return new Response(body, { status });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  __resetManualLocationForTest();
  // 기본: idle 상태 (userLocation = undefined)
  mockUseGeolocation.mockReturnValue({ status: "idle" });
  // 기본: done 이벤트만 있는 NDJSON 스트림 응답
  global.fetch = vi.fn(async () =>
    makeNdjsonResponse([
      { type: "done", text: "길동 카페를 찾았어요.", renders: [{ type: "places", places: [] }], sources: [] },
    ]),
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
    expect(result.current.messages[1].renders).toEqual([{ type: "places", places: [] }]);
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

  it("수동 위치가 GPS를 이긴다 — 채팅 앵커는 유효 위치다", async () => {
    // 채팅 화면 첫 줄의 위치 표시줄이 "지정한 위치, X"라고 알리는데 답이 GPS
    // 좌표로 오면 그 신호가 거짓이 된다(시각장애 사용자는 화면으로 반증 불가).
    mockUseGeolocation.mockReturnValue({
      status: "ready",
      coords: { lat: 37.5, lng: 127.1 },
    } as unknown as ReturnType<typeof mockUseGeolocation>);
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: 1 }, setAt: 1,
    });

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("근처 약국");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.userLocation).toEqual({ lat: 37.5384, lng: 127.1432 });
  });

  it("수동 위치는 GPS가 없어도 앵커가 된다", async () => {
    // 이 기능의 존재 이유가 "GPS가 안 잡히거나 틀렸을 때 스스로 고치는 것"이라
    // GPS 부재가 곧 앵커 부재여서는 안 된다.
    mockUseGeolocation.mockReturnValue({ status: "denied" } as unknown as ReturnType<typeof mockUseGeolocation>);
    setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1 });

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("근처 약국");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.userLocation).toEqual({ lat: 37.5384, lng: 127.1432 });
  });

  it("수동 위치가 없으면 GPS 좌표 그대로 — 기존 동작 불변", async () => {
    mockUseGeolocation.mockReturnValue({
      status: "ready",
      coords: { lat: 37.5, lng: 127.1 },
    } as unknown as ReturnType<typeof mockUseGeolocation>);

    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("근처 약국");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.userLocation).toEqual({ lat: 37.5, lng: 127.1 });
  });

  it("status 이벤트가 progressCategories를 설정", async () => {
    global.fetch = vi.fn(async () =>
      makeNdjsonResponse([
        { type: "status", categories: ["get_air_quality"] },
        { type: "done", text: "공기질 정보입니다.", renders: [], sources: [] },
      ]),
    ) as unknown as typeof fetch;
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("공기질");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    // 완료 후 progressCategories는 빈 배열로 초기화됨
    expect(result.current.progressCategories).toEqual([]);
  });

  it("done 이벤트 없이 스트림이 끝나면 빈 버블 대신 error 설정", async () => {
    // status만 있고 done이 없는 스트림 — 빈 어시스턴트 메시지가 삽입되면 안 됨.
    global.fetch = vi.fn(async () =>
      makeNdjsonResponse([{ type: "status", categories: ["search_places"] }]),
    ) as unknown as typeof fetch;
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.sendMessage("테스트");
    });
    await waitFor(() => expect(result.current.error).toBe("chat_failed"));
    // user 메시지 1건만 — 빈 assistant 버블은 삽입되지 않음
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ role: "user" });
  });
});

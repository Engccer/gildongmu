// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFollowUpSuggestions } from "@/hooks/useFollowUpSuggestions";

afterEach(() => vi.unstubAllGlobals());

describe("useFollowUpSuggestions", () => {
  it("정상 응답은 3개로 절단해 chips에 담고 요청 본문에 locale·placeName을 싣는다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: ["q1", "q2", "q3", "q4"] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useFollowUpSuggestions("en"));
    await act(async () => {
      await result.current.fetch("u", "a", "강동역");
    });
    expect(result.current.chips).toEqual(["q1", "q2", "q3"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat/suggestions");
    expect(JSON.parse(init.body)).toEqual({
      lastUserMessage: "u",
      lastAssistantMessage: "a",
      locale: "en",
      placeName: "강동역",
    });
  });

  it("네트워크 실패·비정상 응답은 빈 배열로 조용히 생략한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const { result } = renderHook(() => useFollowUpSuggestions("ko"));
    await act(async () => {
      await result.current.fetch("u", "a");
    });
    expect(result.current.chips).toEqual([]);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    await act(async () => {
      await result.current.fetch("u", "a");
    });
    expect(result.current.chips).toEqual([]);
  });

  it("새 fetch는 이전 요청을 abort하고, abort된 응답은 상태를 건드리지 않는다", async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return new Promise((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        if (signals.length === 2) resolve({ ok: true, json: async () => ({ suggestions: ["new"] }) });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useFollowUpSuggestions("ko"));
    let first: Promise<void>;
    act(() => {
      first = result.current.fetch("u1", "a1");
    });
    await act(async () => {
      await result.current.fetch("u2", "a2");
      await first!;
    });
    expect(signals[0].aborted).toBe(true);
    expect(result.current.chips).toEqual(["new"]);
  });

  it("늦게 도착한 옛 응답은 새 칩을 덮지 않는다(가드 변이 검출)", async () => {
    // fetch mock은 abort를 무시한다(실제 fetch도 abort 뒤 네트워크가 아니라 reject로 끝나지만,
    // 여기선 "옛 응답이 새 응답 *뒤에* 도착"하는 순서를 강제하려고 resolve 핸들을 잡아 둔다).
    const resolvers: ((v: unknown) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise((resolve) => resolvers.push(resolve))));
    const { result } = renderHook(() => useFollowUpSuggestions("ko"));
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.fetch("u1", "a1");
      second = result.current.fetch("u2", "a2");
    });
    await act(async () => {
      resolvers[1]({ ok: true, json: async () => ({ suggestions: ["new"] }) });
      await second;
    });
    expect(result.current.chips).toEqual(["new"]);
    await act(async () => {
      resolvers[0]({ ok: true, json: async () => ({ suggestions: ["old"] }) });
      await first;
    });
    expect(result.current.chips).toEqual(["new"]);
    // clear() 뒤 늦게 도착한 응답도 빈 상태를 되살리지 않는다.
    let third!: Promise<void>;
    act(() => {
      third = result.current.fetch("u3", "a3");
    });
    act(() => result.current.clear());
    await act(async () => {
      resolvers[2]({ ok: true, json: async () => ({ suggestions: ["late"] }) });
      await third;
    });
    expect(result.current.chips).toEqual([]);
  });

  it("clear()는 진행 중 요청을 abort하고 칩을 비운다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ suggestions: ["q"] }) }));
    const { result } = renderHook(() => useFollowUpSuggestions("ko"));
    await act(async () => {
      await result.current.fetch("u", "a");
    });
    expect(result.current.chips).toEqual(["q"]);
    act(() => result.current.clear());
    expect(result.current.chips).toEqual([]);
  });

  it("언마운트 시 진행 중 요청을 abort한다", () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_u: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise(() => {});
      }),
    );
    const { result, unmount } = renderHook(() => useFollowUpSuggestions("ko"));
    act(() => {
      void result.current.fetch("u", "a");
    });
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});

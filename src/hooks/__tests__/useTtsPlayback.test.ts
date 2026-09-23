// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { useTtsPlayback, pickVoice, VOICES_WAIT_MS, SPEECH_WATCHDOG_MS } from "../useTtsPlayback";

// 브라우저 합성·서버 합성 둘 다 스텁 — /api/tts는 Google Cloud TTS 과금 경로라 실호출하지 않는다.

type Voice = Pick<SpeechSynthesisVoice, "lang" | "localService" | "name">;

class FakeUtterance {
  text: string;
  voice: Voice | null = null;
  lang = "";
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function stubSynth(initialVoices: Voice[]) {
  let voices = initialVoices;
  const listeners = new Set<() => void>();
  const spoken: FakeUtterance[] = [];
  // 발화 중 상태 — speak로 켜지고 cancel·onend 재현에서 끈다(감시가 읽는다).
  const synth = {
    speaking: false,
    pending: false,
    getVoices: () => voices,
    speak: vi.fn((u: FakeUtterance) => {
      spoken.push(u);
      synth.speaking = true;
    }),
    cancel: vi.fn(() => {
      synth.speaking = false;
    }),
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  return {
    synth,
    spoken,
    loadVoices(next: Voice[]) {
      voices = next;
      listeners.forEach((fn) => fn());
    },
  };
}

function stubServer(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  const audios: {
    src: string;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }[] = [];
  vi.stubGlobal(
    "Audio",
    class {
      src: string;
      onended: (() => void) | null = null;
      play = vi.fn(async () => {});
      pause = vi.fn();
      constructor(src: string) {
        this.src = src;
        audios.push(this);
      }
    },
  );
  URL.createObjectURL = vi.fn(() => "blob:tts");
  URL.revokeObjectURL = vi.fn();
  return { fetchMock, audios };
}

const KO_LOCAL: Voice = { lang: "ko-KR", localService: true, name: "Yuna" };
const KO_REMOTE: Voice = { lang: "ko_KR", localService: false, name: "Google 한국어" };
const EN: Voice = { lang: "en-US", localService: true, name: "Samantha" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // jsdom window에 남은 스텁 제거(unstubAllGlobals는 stubGlobal로 만든 것만 되돌린다)
  delete (window as { speechSynthesis?: unknown }).speechSynthesis;
});

describe("pickVoice", () => {
  it("로케일 언어 보이스 중 기기 내장을 우선한다(밑줄 표기도 언어로 읽는다)", () => {
    expect(pickVoice([EN, KO_REMOTE, KO_LOCAL] as SpeechSynthesisVoice[], "ko")?.name).toBe("Yuna");
    expect(pickVoice([EN, KO_REMOTE] as SpeechSynthesisVoice[], "ko")?.name).toBe("Google 한국어");
    expect(pickVoice([EN] as SpeechSynthesisVoice[], "ko")).toBeNull();
  });
});

describe("useTtsPlayback", () => {
  it("로케일 보이스가 있으면 브라우저 합성으로 읽고 서버는 부르지 않는다", () => {
    const { synth, spoken } = stubSynth([EN, KO_LOCAL]);
    const { fetchMock } = stubServer(new Response(null, { status: 502 }));
    const { result } = renderHook(() => useTtsPlayback("ko", vi.fn()));
    act(() => result.current.toggle("m1", "안녕하세요"));
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(spoken[0].voice?.name).toBe("Yuna");
    expect(spoken[0].text).toBe("안녕하세요");
    expect(result.current.playingId).toBe("m1");
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => spoken[0].onend?.());
    expect(result.current.playingId).toBeNull();
  });

  it("같은 메시지를 다시 누르면 정지, 다른 메시지는 교체 — 끊긴 발화의 늦은 콜백은 무시", () => {
    const { synth, spoken } = stubSynth([KO_LOCAL]);
    const onFailed = vi.fn();
    const { result } = renderHook(() => useTtsPlayback("ko", onFailed));
    act(() => result.current.toggle("m1", "하나"));
    act(() => result.current.toggle("m2", "둘"));
    expect(result.current.playingId).toBe("m2");
    // 교체로 끊긴 m1의 onerror(interrupted)·onend가 m2 상태를 지우지 못한다
    act(() => spoken[0].onerror?.({ error: "interrupted" }));
    act(() => spoken[0].onend?.());
    expect(result.current.playingId).toBe("m2");
    act(() => result.current.toggle("m2", "둘"));
    expect(result.current.playingId).toBeNull();
    expect(synth.speak).toHaveBeenCalledTimes(2);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("보이스가 늦게 로드되면 voiceschanged를 기다렸다가 읽는다", () => {
    const { synth, loadVoices } = stubSynth([]);
    const { fetchMock } = stubServer(new Response(null, { status: 502 }));
    const { result } = renderHook(() => useTtsPlayback("ko", vi.fn()));
    act(() => result.current.toggle("m1", "안녕"));
    expect(synth.speak).not.toHaveBeenCalled();
    expect(result.current.playingId).toBe("m1");
    act(() => loadVoices([KO_LOCAL]));
    return waitFor(() => {
      expect(synth.speak).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("보이스가 끝내 오지 않으면 대기 상한 뒤 서버로 넘어간다", async () => {
    vi.useFakeTimers();
    stubSynth([]);
    const { fetchMock } = stubServer(new Response(new Blob(["mp3"]), { status: 200 }));
    const { result } = renderHook(() => useTtsPlayback("ko", vi.fn()));
    act(() => result.current.toggle("m1", "안녕"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VOICES_WAIT_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("로케일 보이스가 없으면 /api/tts로 합성해 재생하고 끝나면 상태를 비운다", async () => {
    stubSynth([EN]);
    const { fetchMock, audios } = stubServer(new Response(new Blob(["mp3"]), { status: 200 }));
    const { result } = renderHook(() => useTtsPlayback("ko", vi.fn()));
    act(() => result.current.toggle("m1", "안녕"));
    await waitFor(() => expect(audios).toHaveLength(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tts");
    expect(JSON.parse(init.body as string)).toEqual({ text: "안녕", locale: "ko" });
    expect(audios[0].play).toHaveBeenCalled();
    expect(result.current.playingId).toBe("m1");
    act(() => audios[0].onended?.());
    expect(result.current.playingId).toBeNull();
  });

  it("서버 폴백이 502면 침묵하지 않고 onFailed를 한 번 부른다", async () => {
    stubSynth([EN]);
    stubServer(Response.json({ fallback: true, reason: "tts_failed" }, { status: 502 }));
    const onFailed = vi.fn();
    const { result } = renderHook(() => useTtsPlayback("ko", onFailed));
    act(() => result.current.toggle("m1", "안녕"));
    await waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));
    expect(result.current.playingId).toBeNull();
  });

  it("합성 API가 없는 브라우저는 곧장 서버로 간다", async () => {
    const { fetchMock } = stubServer(new Response(new Blob(["mp3"]), { status: 200 }));
    const { result } = renderHook(() => useTtsPlayback("ko", vi.fn()));
    act(() => result.current.toggle("m1", "안녕"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("서버 응답을 기다리는 사이 정지하면 늦은 응답은 재생하지도 실패를 알리지도 않는다", async () => {
    stubSynth([EN]);
    let resolve!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (resolve = r))));
    const onFailed = vi.fn();
    const { result } = renderHook(() => useTtsPlayback("ko", onFailed));
    act(() => result.current.toggle("m1", "안녕"));
    act(() => result.current.stop());
    await act(async () => resolve(new Response(null, { status: 502 })));
    expect(onFailed).not.toHaveBeenCalled();
    expect(result.current.playingId).toBeNull();
  });

  it("정지 뒤 늦게 도착한 200 응답은 재생하지 않는다(끈 답변이 다시 들리지 않게)", async () => {
    stubSynth([EN]);
    let resolve!: (r: Response) => void;
    const { audios } = stubServer(new Response(null));
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (resolve = r))));
    const { result } = renderHook(() => useTtsPlayback("ko", vi.fn()));
    act(() => result.current.toggle("m1", "안녕"));
    act(() => result.current.stop());
    await act(async () => resolve(new Response(new Blob(["mp3"]), { status: 200 })));
    expect(audios).toHaveLength(0);
    expect(result.current.playingId).toBeNull();
  });

  it("합성 오류(중단이 아닌 것)는 실패로 통지한다", () => {
    const { spoken } = stubSynth([KO_LOCAL]);
    const onFailed = vi.fn();
    const { result } = renderHook(() => useTtsPlayback("ko", onFailed));
    act(() => result.current.toggle("m1", "안녕"));
    act(() => spoken[0].onerror?.({ error: "synthesis-failed" }));
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(result.current.playingId).toBeNull();
  });

  it("onend 없이 합성이 멎으면 감시가 라벨을 되돌린다(재생 중지에 갇히지 않게)", () => {
    vi.useFakeTimers();
    const { synth } = stubSynth([KO_LOCAL]);
    const onFailed = vi.fn();
    const { result } = renderHook(() => useTtsPlayback("ko", onFailed));
    act(() => result.current.toggle("m1", "긴 답변"));
    act(() => vi.advanceTimersByTime(SPEECH_WATCHDOG_MS));
    expect(result.current.playingId).toBe("m1");
    synth.speaking = false;
    act(() => vi.advanceTimersByTime(SPEECH_WATCHDOG_MS));
    expect(result.current.playingId).toBeNull();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("재생 중이 아니면 cancel()을 부르지 않는다(첫 재생 직전 cancel이 speak를 삼키는 Chrome 함정)", () => {
    const { synth } = stubSynth([KO_LOCAL]);
    const { result } = renderHook(() => useTtsPlayback("ko", vi.fn()));
    act(() => result.current.toggle("m1", "안녕"));
    expect(synth.cancel).not.toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it("서버 음성 재생 중 언마운트하면 멈추고 blob URL을 해제한다", async () => {
    stubSynth([EN]);
    const { audios } = stubServer(new Response(new Blob(["mp3"]), { status: 200 }));
    const { result, unmount } = renderHook(() => useTtsPlayback("ko", vi.fn()));
    act(() => result.current.toggle("m1", "안녕"));
    await waitFor(() => expect(audios).toHaveLength(1));
    unmount();
    expect(audios[0].pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:tts");
  });

  it("언마운트(화면 이탈) 시 합성을 멈춘다", () => {
    const { synth } = stubSynth([KO_LOCAL]);
    const { result, unmount } = renderHook(() => useTtsPlayback("ko", vi.fn()));
    act(() => result.current.toggle("m1", "안녕"));
    synth.cancel.mockClear();
    unmount();
    expect(synth.cancel).toHaveBeenCalled();
  });
});

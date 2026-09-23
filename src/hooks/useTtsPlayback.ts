"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 채팅 답변 [듣기] 재생 — 브라우저 내장 음성 합성(`speechSynthesis`)이 정본이고,
 * 서버 합성 `/api/tts`는 그 브라우저에 현재 로케일 보이스가 없을 때만 부른다
 * (iOS `TtsPlayer` 주종 동형, 비용 0 우선. dodo-planet 훅은 서버 우선이라 순서를 뒤집었다).
 *
 * - 동시 재생 1개: 한 화면이 인스턴스 하나를 소유하고, 같은 id 재호출은 정지 토글,
 *   다른 id는 교체다. `speechSynthesis`는 전역이라 `cancel()`이 곧 앱 전체 정지다
 *   (웹에서 이 합성을 쓰는 곳은 채팅뿐이다).
 * - 늦은 콜백은 세대(`generationRef`)로 거른다 — 정지·교체 뒤 도착한 `onend`·fetch 결과가
 *   새 재생의 버튼 라벨을 되돌리지 못하게.
 * - 서버까지 실패하면(502 `fallback` 포함) `onFailed`로 알린다 — 조용히 버튼만 돌아오면
 *   스크린 리더 사용자는 "눌렸는가"를 구분할 수 없다.
 * - 언마운트 시 정지(화면 이탈). 받아쓰기 시작 시 정지는 호출부가 `stop`을 부른다.
 */

/** 합성이 `onend` 없이 멎었는지 보는 간격(Chrome 원격 보이스의 긴 발화 절단·발화 객체 GC). */
export const SPEECH_WATCHDOG_MS = 1000;

/** `getVoices()`가 빈 배열이면 `voiceschanged`를 이만큼 기다린다(Chrome은 비동기 로드). */
export const VOICES_WAIT_MS = 1500;

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

function waitForVoices(s: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const now = s.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      s.removeEventListener("voiceschanged", done);
      resolve(s.getVoices());
    };
    const timer = setTimeout(done, VOICES_WAIT_MS);
    s.addEventListener("voiceschanged", done);
  }).catch(() => [] as SpeechSynthesisVoice[]);
}

/** 로케일 언어의 보이스 — 기기 내장(`localService`)을 우선한다(원격 보이스는 긴 발화가 끊긴다). */
export function pickVoice(voices: SpeechSynthesisVoice[], locale: string): SpeechSynthesisVoice | null {
  const matches = voices.filter((v) => v.lang.toLowerCase().replace("_", "-").split("-")[0] === locale);
  return matches.find((v) => v.localService) ?? matches[0] ?? null;
}

export function useTtsPlayback(locale: string, onFailed: () => void) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playingIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 발화 객체를 붙잡아 둔다 — 클로저에만 있으면 Chrome이 GC해 onend가 오지 않는다.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onFailedRef = useRef(onFailed);
  useEffect(() => {
    onFailedRef.current = onFailed;
  }, [onFailed]);

  const setPlaying = useCallback((id: string | null) => {
    playingIdRef.current = id;
    setPlayingId(id);
  }, []);

  const clearSpeech = useCallback(() => {
    if (watchdogRef.current) clearInterval(watchdogRef.current);
    watchdogRef.current = null;
    utteranceRef.current = null;
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    clearSpeech();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      URL.revokeObjectURL(audio.src);
      audioRef.current = null;
    }
    // 재생 중일 때만 — 일부 Chrome은 cancel() 직후 같은 틱의 speak()를 조용히 버린다.
    const s = synth();
    if (s && (s.speaking || s.pending)) s.cancel();
    setPlaying(null);
  }, [clearSpeech, setPlaying]);

  const finish = useCallback(
    (generation: number, failed: boolean) => {
      if (generation !== generationRef.current) return;
      clearSpeech();
      setPlaying(null);
      if (failed) onFailedRef.current();
    },
    [clearSpeech, setPlaying],
  );

  const speak = useCallback(
    (s: SpeechSynthesis, voice: SpeechSynthesisVoice, text: string, generation: number) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.onend = () => finish(generation, false);
      // 정지·교체의 cancel()도 onerror(interrupted·canceled)로 오지만 세대가 이미 바뀌어 걸러진다.
      utterance.onerror = (e) => finish(generation, e.error !== "interrupted" && e.error !== "canceled");
      utteranceRef.current = utterance;
      s.speak(utterance);
      // onend가 끝내 오지 않아도 "재생 중지"에 갇히지 않게 — 합성이 멎었으면 끝난 것으로 본다.
      watchdogRef.current = setInterval(() => {
        if (!s.speaking && !s.pending) finish(generation, false);
      }, SPEECH_WATCHDOG_MS);
    },
    [finish],
  );

  const playServer = useCallback(
    async (text: string, generation: number) => {
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, locale }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (generation !== generationRef.current) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        const release = (failed: boolean) => {
          URL.revokeObjectURL(url);
          finish(generation, failed);
        };
        audio.onended = () => release(false);
        await audio.play().catch(() => release(true));
      } catch {
        finish(generation, true);
      }
    },
    [finish, locale],
  );

  /** 같은 id면 정지, 아니면 기존 재생을 끊고 이 텍스트를 읽는다. */
  const toggle = useCallback(
    (id: string, text: string) => {
      if (playingIdRef.current === id) {
        stop();
        return;
      }
      stop();
      const generation = generationRef.current;
      setPlaying(id);
      const s = synth();
      const decide = (voices: SpeechSynthesisVoice[]) => {
        if (generation !== generationRef.current) return;
        const voice = s && pickVoice(voices, locale);
        if (s && voice) speak(s, voice, text, generation);
        else void playServer(text, generation);
      };
      // 보이스가 이미 있으면 클릭 콜스택 안에서 바로 speak(일부 브라우저가 제스처 밖 발화를 막는다).
      const ready = s?.getVoices() ?? [];
      if (!s || ready.length > 0) decide(ready);
      else void waitForVoices(s).then(decide);
    },
    [locale, playServer, setPlaying, speak, stop],
  );

  useEffect(() => stop, [stop]);

  return { playingId, toggle, stop };
}

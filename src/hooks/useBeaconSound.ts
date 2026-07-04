"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  CLOSER_TONES,
  FARTHER_TONES,
  NEARBY_TONES,
  TICK_TONES,
} from "@/lib/beacon-tones";
import { START_TONES, STOP_TONES } from "@/lib/recording-tones";
import type { Tone } from "@/lib/tones";

/**
 * 거리 비콘 톤 재생(Web Audio 합성). useTonePlayer와 같은 lazy AudioContext·
 * graceful no-op 패턴이지만, tick을 낮은 gain(peakGain)으로 재생하려고 자체
 * ctxRef를 유지한다(useTonePlayer는 고정 gain이라 공유하지 않음).
 */
export function useBeaconSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, []);

  const getCtx = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    if (ctxRef.current?.state === "closed") return null;
    if (!ctxRef.current) {
      // iOS는 하드웨어 무음 스위치가 켜지면 Web Audio를 침묵시킨다(HTML5 <audio>와
      // 비대칭). iOS 17+ 공식 API로 오디오 세션을 'playback'으로 선언하면 무음
      // 스위치에도 비콘 톤이 울린다(조사 2026-07-04). 미지원 브라우저는 graceful.
      try {
        const nav = navigator as unknown as {
          audioSession?: { type?: string };
        };
        if (nav.audioSession && "type" in nav.audioSession) {
          nav.audioSession.type = "playback";
        }
      } catch {
        // 미지원·정책 차단 — 무시(톤은 무음 스위치 해제 시 정상).
      }
      try {
        ctxRef.current = new AC();
      } catch {
        return null;
      }
    }
    return ctxRef.current;
  }, []);

  const playTones = useCallback(
    (tones: Tone[], peakGain = 0.15) => {
      const ctx = getCtx();
      if (!ctx) return;
      if (ctx.state === "suspended") void ctx.resume();
      try {
        const now = ctx.currentTime;
        for (const tone of tones) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = tone.freq;
          const t0 = now + tone.start;
          const t1 = t0 + tone.dur;
          gain.gain.setValueAtTime(0, t0);
          gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.012);
          gain.gain.linearRampToValueAtTime(0, t1);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t0);
          osc.stop(t1 + 0.02);
        }
      } catch {
        // InvalidStateError 등 — graceful no-op.
      }
    },
    [getCtx],
  );

  return {
    playCloser: useCallback(() => playTones(CLOSER_TONES), [playTones]),
    playFarther: useCallback(() => playTones(FARTHER_TONES), [playTones]),
    playNearby: useCallback(() => playTones(NEARBY_TONES), [playTones]),
    playTick: useCallback(() => playTones(TICK_TONES, 0.06), [playTones]),
    playStart: useCallback(() => playTones(START_TONES), [playTones]),
    playStop: useCallback(() => playTones(STOP_TONES), [playTones]),
  };
}

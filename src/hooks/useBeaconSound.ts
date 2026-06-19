"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  CLOSER_TONES,
  FARTHER_TONES,
  NEARBY_TONES,
  TICK_TONES,
} from "@/lib/beacon-tones";
import { START_TONES, STOP_TONES, type Tone } from "@/lib/recording-tones";

/**
 * 거리 비콘 톤 재생(Web Audio 합성). useRecordingSound와 동일한 lazy AudioContext·
 * graceful no-op 패턴. tick은 보조 하트비트라 낮은 gain으로 재생한다.
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

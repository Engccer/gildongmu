"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  START_TONES,
  STOP_TONES,
  CANCEL_TONES,
  type Tone,
} from "@/lib/recording-tones";

/**
 * 음성 받아쓰기 시작/정지/취소를 알리는 비언어 효과음(Web Audio 합성).
 * dodo-planet의 useSound(파일 기반) 패턴을 수입하되, mp3 의존 없이 OscillatorNode로
 * 합성해 번들을 늘리지 않고 음높이 방향(상승=시작·하강=정지)을 정밀 제어한다.
 *
 * AudioContext는 lazy 생성(첫 재생 = 사용자 제스처 이후)이라 autoplay 정책에
 * 걸리지 않는다. 미지원 브라우저·음소거는 조용히 no-op(효과음은 보조 신호이며,
 * 버튼의 aria-label/aria-busy 상태 변화가 스크린 리더용 1차 신호를 보강한다).
 */
export function useRecordingSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  // 언마운트 시 오디오 컨텍스트 정리(리소스 누수 방지).
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
    // close()는 비동기라 언마운트 cleanup 직후 closed 상태의 ctx가 잠깐 남을 수
    // 있다 — 재사용하면 createOscillator가 InvalidStateError를 던지므로 null 반환
    // (효과음은 보조 신호라 graceful no-op).
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
    (tones: Tone[]) => {
      const ctx = getCtx();
      if (!ctx) return;
      // 사용자 제스처 직후라도 suspended일 수 있어 resume(브라우저 차이).
      if (ctx.state === "suspended") void ctx.resume();
      // close()가 비동기로 진행되는 찰나에 노드 생성이 InvalidStateError를 던질 수
      // 있다(빠른 unmount/remount 타이밍) — 효과음은 보조 신호라 조용히 무시.
      try {
        const now = ctx.currentTime;
        for (const tone of tones) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = tone.freq;
          const t0 = now + tone.start;
          const t1 = t0 + tone.dur;
          // 짧은 attack/release로 클릭(팝) 노이즈를 줄인다.
          gain.gain.setValueAtTime(0, t0);
          gain.gain.linearRampToValueAtTime(0.15, t0 + 0.012);
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

  const playStart = useCallback(() => playTones(START_TONES), [playTones]);
  const playStop = useCallback(() => playTones(STOP_TONES), [playTones]);
  const playCancel = useCallback(() => playTones(CANCEL_TONES), [playTones]);

  return { playStart, playStop, playCancel };
}

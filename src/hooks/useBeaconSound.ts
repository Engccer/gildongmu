"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * 실시간 길 안내 효과음 재생(파일 기반, 2026-08-03 위원장 선정 교체).
 *
 * 8종 전부 `public/sounds/guide/*.mp3` 파일이 정본이고 iOS 리소스와 바이트 동일하다
 * (`sounds-drift.test.ts`가 강제). 종전의 Web Audio 합성은 폐기 — 위원장 청취 선정에서
 * closer·farther는 기존 합성 음가를 그대로 파일로 렌더해 유지했고, 나머지 6종은
 * ElevenLabs 생성본으로 교체됐다.
 *
 * 재생은 fetch+decodeAudioData 버퍼 캐시 → BufferSource(레이턴시 최소). <audio>가
 * 아니라 Web Audio를 유지하는 이유: iOS 17+ `navigator.audioSession.type="playback"`
 * 선언으로 무음 스위치에도 톤이 울리는 기존 계약을 지키기 위해서다(조사 2026-07-04).
 *
 * 게인 위계는 종전 합성 시절의 상대 크기를 보존한다(파일은 풀스케일 인코딩):
 * 추세음은 낮게(보행 내내 반복), tick은 더 낮게(하트비트), 이벤트음은 원음.
 * 값은 실보행 튜닝 대상.
 *
 * 햅틱(위원장 제안 2026-08-03): 크리티컬 신호(이탈 경고·도착·멀어짐)는 진동 병행.
 * iOS Safari는 Vibration API 미지원이라 웹에서는 지원 브라우저(Android)에서만 동작
 * 하는 가드형이다 — 실질 채널은 iOS 앱의 UIKit 햅틱.
 */

type GuideSound =
  | "closer"
  | "farther"
  | "nearby"
  | "tick"
  | "start"
  | "stop"
  | "ahead"
  | "warning";

const GAIN: Record<GuideSound, number> = {
  closer: 0.35,
  farther: 0.35,
  nearby: 1,
  tick: 0.3,
  start: 0.8,
  stop: 0.8,
  ahead: 0.8,
  warning: 1,
};

/** 진동 패턴(ms). 크리티컬 3종만 — 나머지는 소리로 충분(과잉 진동은 피로). */
const VIBRATE: Partial<Record<GuideSound, number[]>> = {
  farther: [100],
  nearby: [80, 60, 80, 60, 80],
  warning: [150, 80, 150],
};

function vibrate(sound: GuideSound) {
  const pattern = VIBRATE[sound];
  if (!pattern) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // 미지원·정책 차단 — 무시.
  }
}

export function useBeaconSound() {
  const ctxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef(new Map<GuideSound, AudioBuffer>());
  const loadingRef = useRef(new Set<GuideSound>());

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

  const play = useCallback(
    (sound: GuideSound) => {
      vibrate(sound);
      const ctx = getCtx();
      if (!ctx) return;
      if (ctx.state === "suspended") void ctx.resume();
      const cached = buffersRef.current.get(sound);
      if (cached) {
        try {
          const src = ctx.createBufferSource();
          const gain = ctx.createGain();
          gain.gain.value = GAIN[sound];
          src.buffer = cached;
          src.connect(gain).connect(ctx.destination);
          src.start();
        } catch {
          // InvalidStateError 등 — graceful no-op.
        }
        return;
      }
      // 첫 재생은 로드로 대체(다음부터 즉시). 동시 중복 fetch는 가드.
      if (loadingRef.current.has(sound)) return;
      loadingRef.current.add(sound);
      void fetch(`/sounds/guide/${sound}.mp3`)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(res.status)))
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => {
          buffersRef.current.set(sound, buffer);
          try {
            const src = ctx.createBufferSource();
            const gain = ctx.createGain();
            gain.gain.value = GAIN[sound];
            src.buffer = buffer;
            src.connect(gain).connect(ctx.destination);
            src.start();
          } catch {
            // graceful no-op
          }
        })
        .catch(() => {
          // 로드 실패 — 다음 재생 시도에서 재시도할 수 있게 가드만 해제.
        })
        .finally(() => loadingRef.current.delete(sound));
    },
    [getCtx],
  );

  return {
    playCloser: useCallback(() => play("closer"), [play]),
    playFarther: useCallback(() => play("farther"), [play]),
    playNearby: useCallback(() => play("nearby"), [play]),
    playTick: useCallback(() => play("tick"), [play]),
    playStart: useCallback(() => play("start"), [play]),
    playStop: useCallback(() => play("stop"), [play]),
    playAhead: useCallback(() => play("ahead"), [play]),
    playWarning: useCallback(() => play("warning"), [play]),
  };
}

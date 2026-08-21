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
  | "crosswalk"
  | "left"
  | "right"
  | "back"
  | "warning"
  | "unreliable";

/**
 * 왼쪽·오른쪽 톤의 구분 방식 — 실기기 선택 대기 중인 두 후보(spec
 * `2026-08-22-walk-tone-taxonomy-design.md` §3, iOS `LeftRightToneScheme` 미러).
 * `pan`은 좌·우 채널 하드 패닝(스피커에서 무력), `pitch`는 낮은/높은 모티프(모노).
 * 웹은 전환 UI 없이 iOS 기본값과 같은 값을 쓴다. 판정 뒤 패자 파일과 이 분기를 지운다.
 */
const LEFT_RIGHT_SCHEME: "pan" | "pitch" = "pitch";

/** 재생 파일명(`/sounds/guide/<이름>.mp3`). 톤과 파일이 다른 것은 left·right뿐이다. */
type GuideSoundFile =
  | Exclude<GuideSound, "left" | "right">
  | "left-pan"
  | "right-pan"
  | "left-pitch"
  | "right-pitch";

function fileOf(sound: GuideSound): GuideSoundFile {
  if (sound === "left") return LEFT_RIGHT_SCHEME === "pan" ? "left-pan" : "left-pitch";
  if (sound === "right") return LEFT_RIGHT_SCHEME === "pan" ? "right-pan" : "right-pitch";
  return sound;
}

/**
 * ⚠ `unreliable`은 `tick`(0.3)보다 높다. 신뢰 불가는 상태 경고라 배경 미디어 위에서
 * 묻히면 안 된다(iOS `BeaconTonePlayer.gains`와 동조 — 값 변경 시 양쪽 함께).
 */
const GAIN: Record<GuideSound, number> = {
  closer: 0.35,
  farther: 0.35,
  nearby: 1,
  tick: 0.3,
  start: 0.8,
  stop: 0.8,
  ahead: 0.8,
  // 결정 지점 행동 톤 4종 — ahead 동급(같은 자리의 소리).
  crosswalk: 0.8,
  left: 0.8,
  right: 0.8,
  back: 0.8,
  warning: 1,
  unreliable: 0.45,
};

/**
 * 진동 패턴(ms) — **각 사운드의 실측 파형에 동기**(위원장 판정 2026-08-03. iOS
 * CoreHaptics 패턴이 정본이고 여기는 on/off 근사). 타이밍은 mp3 온셋 분석값이다.
 * 소리 파일 교체 시 재분석해 갱신할 것. 크리티컬 3종+세션 경계만 — 나머지는 과잉 진동.
 */
const VIBRATE: Partial<Record<GuideSound, number[]>> = {
  // 하강 2음(0·80ms)에 맞춘 두 탭.
  farther: [40, 40, 50],
  // 마지막 바퀴 종 타격(0·290·440·590·840·1100ms)에 1:1 펄스.
  nearby: [50, 240, 50, 100, 50, 100, 50, 200, 50, 210, 50],
  // 음향신호기식 비프 4연음 ×2 — 생성 상수(비프 60·간격 60·묶음 간격 250ms) 1:1.
  crosswalk: [60, 60, 60, 60, 60, 60, 60, 250, 60, 60, 60, 60, 60, 60, 60],
  // 상승 2음 모티프(0·220ms) — 두 탭.
  left: [40, 180, 60],
  right: [40, 180, 60],
  // 하강 글라이드 2회(400ms + 100ms 간격).
  back: [400, 100, 400],
  // 단일 저음 burst 후 감쇠(실측 0.35초).
  warning: [220],
  // 1.3초 스웰(어택 0.455·릴리스 0.585)을 펄스 폭으로 근사.
  start: [40, 90, 70, 70, 110, 50, 330, 50, 110, 70, 70, 90, 40],
  stop: [40, 90, 70, 70, 110, 50, 330, 50, 110, 70, 70, 90, 40],
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
  const buffersRef = useRef(new Map<GuideSoundFile, AudioBuffer>());
  const loadingRef = useRef(new Set<GuideSoundFile>());

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

  /** fetch → decode → 버퍼 캐시 저장. 실패는 null(가드만 해제해 다음 시도에서 재시도). */
  const loadBuffer = useCallback(
    (ctx: AudioContext, file: GuideSoundFile): Promise<AudioBuffer | null> =>
      fetch(`/sounds/guide/${file}.mp3`)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(res.status)))
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => {
          buffersRef.current.set(file, buffer);
          return buffer;
        })
        .catch(() => null),
    [],
  );

  /** 버퍼 재생 시작. 반환 = 실제로 시작했는가(InvalidStateError 등은 false). */
  const startBuffer = useCallback(
    (ctx: AudioContext, sound: GuideSound, buffer: AudioBuffer): boolean => {
      try {
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();
        gain.gain.value = GAIN[sound];
        src.buffer = buffer;
        src.connect(gain).connect(ctx.destination);
        src.start();
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  /**
   * 재생. 반환은 **재생 길이(초)** — 발화 지연 판정(`speechDeferStep`)의 입력이다
   * (spec 2026-08-14 §6). 버퍼가 없어 즉시 재생하지 못하면 0(cold 경로는 로드 후
   * 늦게 재생되지만 길이를 동기로 알 수 없다 — 세션 시작의 `preload`가 이 창을 줄인다).
   */
  const play = useCallback(
    (sound: GuideSound): number => {
      vibrate(sound);
      const ctx = getCtx();
      if (!ctx) return 0;
      if (ctx.state === "suspended") void ctx.resume();
      const file = fileOf(sound);
      const cached = buffersRef.current.get(file);
      if (cached) return startBuffer(ctx, sound, cached) ? cached.duration : 0;
      // 첫 재생은 로드로 대체(다음부터 즉시). 동시 중복 fetch는 가드.
      if (loadingRef.current.has(file)) return 0;
      loadingRef.current.add(file);
      void loadBuffer(ctx, file)
        .then((buffer) => {
          if (buffer) startBuffer(ctx, sound, buffer);
        })
        .finally(() => loadingRef.current.delete(file));
      return 0;
    },
    [getCtx, loadBuffer, startBuffer],
  );

  /**
   * 긴 톤 사전 디코드(spec 2026-08-14 §6, 리뷰 BLOCKER 4). 웹은 첫 재생이 fetch →
   * decodeAudioData 왕복이라 길이를 모르고, 그 상태로 두면 각 톤의 첫 발생에서
   * 음성이 먼저 나가고 톤이 뒤늦게 문장 중간을 덮는다 — 세션 시작에서 미리 디코드해
   * iOS의 로컬 파일 프리로드와 같은 성질을 만든다. 재생은 하지 않는다.
   */
  const preload = useCallback(
    (sounds: GuideSound[]) => {
      const ctx = getCtx();
      if (!ctx) return;
      for (const sound of sounds) {
        const file = fileOf(sound);
        if (buffersRef.current.has(file) || loadingRef.current.has(file)) continue;
        loadingRef.current.add(file);
        void loadBuffer(ctx, file).finally(() => loadingRef.current.delete(file));
      }
    },
    [getCtx, loadBuffer],
  );

  // 톤 선택은 `toneLayerStep`(순수 함수)이 하고 여기는 재생만 한다 — 톤별 래퍼를
  // 두면 계층이 낸 이름을 다시 함수로 사상해야 해서 매핑 표가 하나 더 생긴다.
  return { play, preload };
}

export type { GuideSound };


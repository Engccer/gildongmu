/**
 * 거리 비콘 효과음의 톤 시퀀스(순수 데이터, Web Audio 비의존).
 *
 * 음높이 방향으로 추세를 즉시 구분: 가까워짐=상승, 멀어짐=하강, 도착=밝은 더블,
 * tick=낮은 단음("추적 중" 하트비트). recording-tones.ts와 동일한 Tone 형식.
 */
import type { Tone } from "./recording-tones";

export const CLOSER_TONES: Tone[] = [
  { freq: 660, start: 0, dur: 0.07 },
  { freq: 990, start: 0.08, dur: 0.09 },
];

export const FARTHER_TONES: Tone[] = [
  { freq: 990, start: 0, dur: 0.07 },
  { freq: 660, start: 0.08, dur: 0.09 },
];

export const NEARBY_TONES: Tone[] = [
  { freq: 880, start: 0, dur: 0.08 },
  { freq: 1320, start: 0.1, dur: 0.14 },
];

export const TICK_TONES: Tone[] = [{ freq: 330, start: 0, dur: 0.05 }];

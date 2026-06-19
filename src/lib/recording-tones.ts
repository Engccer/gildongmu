/**
 * 음성 받아쓰기 효과음의 톤 시퀀스(순수 데이터, Web Audio 비의존).
 *
 * 시각장애인 사용자가 "시작/끝"을 음높이 방향만으로 즉시 구분하도록 설계한다 —
 * 시작은 올라가는 멜로디(낮은음→높은음), 정지는 내려가는 멜로디(높은음→낮은음),
 * 취소는 낮은 단음. 장황한 음성 안내를 대체하는 빠른 비언어 신호다.
 */
export interface Tone {
  /** 주파수(Hz) */
  freq: number;
  /** 시퀀스 시작 기준 오프셋(초) */
  start: number;
  /** 지속(초) */
  dur: number;
}

export const START_TONES: Tone[] = [
  { freq: 660, start: 0, dur: 0.08 },
  { freq: 990, start: 0.1, dur: 0.12 },
];

export const STOP_TONES: Tone[] = [
  { freq: 990, start: 0, dur: 0.08 },
  { freq: 660, start: 0.1, dur: 0.12 },
];

export const CANCEL_TONES: Tone[] = [{ freq: 440, start: 0, dur: 0.16 }];

/**
 * 채팅 효과음의 톤 시퀀스(순수 데이터, Web Audio 비의존).
 *
 * 시각장애인 사용자에게 대화 턴의 경계를 비언어 신호로 알린다 —
 * 제출(SEND)은 짧은 단음("톡")으로 "보냄"을, 응답 완료(RECEIVE)는 밝은 2음
 * 상승("딩-동")으로 "답변 도착"을 알린다. 녹음 효과음(상승/하강 멜로디)과는
 * 음정·길이로 구분되어 같은 화면에서 혼동되지 않는다.
 */
import type { Tone } from "./tones";

/** 제출: 가벼운 단음 — 빈번한 동작이라 짧게. */
export const SEND_TONES: Tone[] = [{ freq: 740, start: 0, dur: 0.06 }];

/** 응답 완료: 밝은 2음 상승 — 완료·긍정 신호. */
export const RECEIVE_TONES: Tone[] = [
  { freq: 784, start: 0, dur: 0.08 },
  { freq: 1047, start: 0.09, dur: 0.14 },
];

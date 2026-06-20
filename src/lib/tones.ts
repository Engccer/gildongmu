/**
 * Web Audio 효과음의 단위 톤(순수 데이터, React/Web Audio 비의존).
 *
 * 녹음(recording-tones)·채팅(chat-tones) 등 여러 도메인이 공유하는 입력 계약.
 * useTonePlayer가 이 시퀀스를 OscillatorNode로 합성한다.
 */
export interface Tone {
  /** 주파수(Hz) */
  freq: number;
  /** 시퀀스 시작 기준 오프셋(초) */
  start: number;
  /** 지속(초) */
  dur: number;
}

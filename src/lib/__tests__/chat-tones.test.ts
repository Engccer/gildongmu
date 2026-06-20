import { describe, it, expect } from "vitest";
import { SEND_TONES, RECEIVE_TONES } from "../chat-tones";

/**
 * 채팅 턴 경계 효과음의 invariant를 고정한다 — 제출과 응답 완료가 음색·길이로
 * 구분되지 않으면 시각장애인 사용자가 대화 상태를 오인하므로 회귀를 막는다.
 */
describe("chat tones", () => {
  it("제출음은 짧은 단음(빈번한 동작이라 가볍게)", () => {
    expect(SEND_TONES).toHaveLength(1);
  });
  it("응답 완료음은 올라가는 2음(완료·긍정 신호)", () => {
    expect(RECEIVE_TONES.length).toBeGreaterThanOrEqual(2);
    expect(RECEIVE_TONES[1].freq).toBeGreaterThan(RECEIVE_TONES[0].freq);
  });
  it("완료음의 두 번째 음은 첫 음이 끝난 뒤 시작(겹침 없음)", () => {
    const first = RECEIVE_TONES[0];
    expect(RECEIVE_TONES[1].start).toBeGreaterThanOrEqual(first.start + first.dur);
  });
  it("모든 톤은 양수 주파수·지속시간", () => {
    for (const tone of [...SEND_TONES, ...RECEIVE_TONES]) {
      expect(tone.freq).toBeGreaterThan(0);
      expect(tone.dur).toBeGreaterThan(0);
      expect(tone.start).toBeGreaterThanOrEqual(0);
    }
  });
});

import { describe, it, expect } from "vitest";
import { START_TONES, STOP_TONES, CANCEL_TONES } from "../recording-tones";

/**
 * 시작/끝을 음높이 방향으로 구분한다는 invariant를 고정한다 — 시작과 정지 톤이
 * 뒤바뀌면 시각장애인 사용자가 받아쓰기 상태를 오인하므로 회귀를 막는다.
 */
describe("recording tones", () => {
  it("시작음은 올라가는 멜로디(낮은음→높은음)", () => {
    expect(START_TONES.length).toBeGreaterThanOrEqual(2);
    expect(START_TONES[1].freq).toBeGreaterThan(START_TONES[0].freq);
  });
  it("정지음은 내려가는 멜로디(높은음→낮은음)", () => {
    expect(STOP_TONES.length).toBeGreaterThanOrEqual(2);
    expect(STOP_TONES[1].freq).toBeLessThan(STOP_TONES[0].freq);
  });
  it("취소음은 단음", () => {
    expect(CANCEL_TONES).toHaveLength(1);
  });
  it("모든 톤은 양수 주파수·지속시간", () => {
    for (const tone of [...START_TONES, ...STOP_TONES, ...CANCEL_TONES]) {
      expect(tone.freq).toBeGreaterThan(0);
      expect(tone.dur).toBeGreaterThan(0);
      expect(tone.start).toBeGreaterThanOrEqual(0);
    }
  });
});

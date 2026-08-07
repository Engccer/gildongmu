import { describe, expect, it } from "vitest";
import {
  INITIAL_MOTION_STATE,
  MAX_WALK_SPEED_MPS,
  motionStep,
  type MotionJudgeState,
  type MotionSample,
} from "../guide-motion";

/**
 * Kit `GuideMotionTests`와 **같은 케이스**를 돈다(상수·경계·전이 동조 강제).
 * 웹 고유 케이스는 맨 아래 — `GeolocationCoordinates.speed`가 무효일 때 `null`이라
 * 0으로 암묵 변환되면 거짓 정지 tick이 난다.
 */
const sample = (at: number, lat = 37.5, lng = 127.0, accuracy = 10): MotionSample => ({
  lat,
  lng,
  accuracy,
  at,
});

describe("도플러 신뢰 조건", () => {
  it("도플러 속도가 신뢰 조건을 만족하면 그 값을 쓴다", () => {
    const { motion } = motionStep(
      INITIAL_MOTION_STATE, sample(0), 1.5, 0.5, MAX_WALK_SPEED_MPS,
    );
    expect(motion).toBe("moving");
  });

  it("speedAccuracy가 상한을 넘으면 그 speed는 근거가 못 된다", () => {
    // speed 0.2는 정지처럼 보이지만 정확도가 나쁘면 판정 근거가 아니다.
    const { motion } = motionStep(
      INITIAL_MOTION_STATE, sample(0), 0.2, 5, MAX_WALK_SPEED_MPS,
    );
    expect(motion).toBe("speedUnknown");
  });

  it("음수 speed는 무효 신호다", () => {
    const { motion } = motionStep(
      INITIAL_MOTION_STATE, sample(0), -1, 0.5, MAX_WALK_SPEED_MPS,
    );
    expect(motion).toBe("speedUnknown");
  });
});

describe("히스테리시스", () => {
  it("정지 진입은 유지 시간을 채워야 성립한다", () => {
    let state: MotionJudgeState = INITIAL_MOTION_STATE;
    let out = motionStep(state, sample(0), 0.1, 0.3, MAX_WALK_SPEED_MPS);
    state = out.state;
    expect(out.motion).toBe("moving"); // 아직 2초를 못 채웠다

    out = motionStep(state, sample(1.5), 0.1, 0.3, MAX_WALK_SPEED_MPS);
    state = out.state;
    expect(out.motion).toBe("moving");

    out = motionStep(state, sample(2.1), 0.1, 0.3, MAX_WALK_SPEED_MPS);
    expect(out.motion).toBe("stopped");
  });

  it("이탈은 즉시다(비대칭이 의도)", () => {
    let state: MotionJudgeState = INITIAL_MOTION_STATE;
    for (const t of [0, 2.5]) {
      state = motionStep(state, sample(t), 0.1, 0.3, MAX_WALK_SPEED_MPS).state;
    }
    const { motion } = motionStep(state, sample(3), 0.7, 0.3, MAX_WALK_SPEED_MPS);
    expect(motion).toBe("moving");
  });

  it("히스테리시스 구간(0.4~0.6)에서는 정지를 유지한다", () => {
    let state: MotionJudgeState = INITIAL_MOTION_STATE;
    for (const t of [0, 2.5]) {
      state = motionStep(state, sample(t), 0.1, 0.3, MAX_WALK_SPEED_MPS).state;
    }
    const { motion } = motionStep(state, sample(3), 0.5, 0.3, MAX_WALK_SPEED_MPS);
    expect(motion).toBe("stopped");
  });

  it("느린 보행(0.7m/s)은 정지가 아니다", () => {
    let state: MotionJudgeState = INITIAL_MOTION_STATE;
    for (const t of [0, 1, 2, 3, 4]) {
      const out = motionStep(state, sample(t), 0.7, 0.3, MAX_WALK_SPEED_MPS);
      state = out.state;
      expect(out.motion).toBe("moving");
    }
  });
});

describe("거리 미분 폴백", () => {
  it("도플러가 없으면 거리 미분 폴백을 쓴다", () => {
    const state = motionStep(
      INITIAL_MOTION_STATE, sample(0, 37.5), null, null, MAX_WALK_SPEED_MPS,
    ).state;
    // 약 22m를 2초 = 11m/s → 물리 상한(8) 초과라 폐기.
    expect(
      motionStep(state, sample(2, 37.5002), null, null, MAX_WALK_SPEED_MPS).motion,
    ).toBe("speedUnknown");
    // 약 2.2m를 2초 = 1.1m/s → 유효.
    expect(
      motionStep(state, sample(2, 37.50002), null, null, MAX_WALK_SPEED_MPS).motion,
    ).toBe("moving");
  });

  it("폴백은 간격이 너무 짧거나 길면 쓰지 않는다", () => {
    const state = motionStep(
      INITIAL_MOTION_STATE, sample(0), null, null, MAX_WALK_SPEED_MPS,
    ).state;
    // 0.5초: GPS 지터가 속도로 증폭된다.
    expect(
      motionStep(state, sample(0.5, 37.50002), null, null, MAX_WALK_SPEED_MPS).motion,
    ).toBe("speedUnknown");
    // 7초: 실제 이동이 평균화되어 정지로 보인다.
    expect(
      motionStep(state, sample(7, 37.50002), null, null, MAX_WALK_SPEED_MPS).motion,
    ).toBe("speedUnknown");
  });

  it("폴백은 두 fix 정확도가 20m를 넘으면 쓰지 않는다", () => {
    const state = motionStep(
      INITIAL_MOTION_STATE, sample(0, 37.5, 127, 35), null, null, MAX_WALK_SPEED_MPS,
    ).state;
    expect(
      motionStep(state, sample(2, 37.50002, 127, 10), null, null, MAX_WALK_SPEED_MPS).motion,
    ).toBe("speedUnknown");
  });

  it("폴백으로도 정지를 판정할 수 있다", () => {
    let state: MotionJudgeState = INITIAL_MOTION_STATE;
    // 제자리(좌표 불변)로 1초 간격 fix 4개.
    for (const t of [0, 1, 2, 3]) {
      state = motionStep(state, sample(t), null, null, MAX_WALK_SPEED_MPS).state;
    }
    expect(motionStep(state, sample(4), null, null, MAX_WALK_SPEED_MPS).motion).toBe(
      "stopped",
    );
  });

  it("속도를 모르면 정지 계측이 초기화된다", () => {
    let state: MotionJudgeState = INITIAL_MOTION_STATE;
    state = motionStep(state, sample(0), 0.1, 0.3, MAX_WALK_SPEED_MPS).state;
    // 모르는 구간을 정지로 셈하면 그 사이 이동이 정지로 굳는다.
    state = motionStep(state, sample(0.5), null, null, MAX_WALK_SPEED_MPS).state;
    expect(motionStep(state, sample(2.5), 0.1, 0.3, MAX_WALK_SPEED_MPS).motion).toBe(
      "moving",
    );
  });
});

describe("웹 고유 계약", () => {
  it("speed가 null이면 speedUnknown이다(0으로 암묵 변환 금지)", () => {
    const { motion } = motionStep(
      INITIAL_MOTION_STATE, sample(0), null, null, MAX_WALK_SPEED_MPS,
    );
    expect(motion).toBe("speedUnknown");
  });

  it("speedAccuracy 필드 부재는 도플러를 버릴 근거가 아니다", () => {
    // 웹 GeolocationCoordinates에는 speedAccuracy가 아예 없다. 그것을 "정확도 나쁨"으로
    // 뭉개면 웹에서 도플러가 절대 성립하지 않아 tick(정지)이 죽은 소리가 된다.
    const { motion } = motionStep(
      INITIAL_MOTION_STATE, sample(0), 1.5, undefined, MAX_WALK_SPEED_MPS,
    );
    expect(motion).toBe("moving");
  });

  it("speedAccuracy가 없어도 느린 speed는 정지로 간다", () => {
    let state: MotionJudgeState = INITIAL_MOTION_STATE;
    for (const t of [0, 1]) {
      state = motionStep(state, sample(t), 0.1, undefined, MAX_WALK_SPEED_MPS).state;
    }
    expect(motionStep(state, sample(2.5), 0.1, undefined, MAX_WALK_SPEED_MPS).motion).toBe(
      "stopped",
    );
  });

  it("값이 있는데 무효이거나 상한 초과면 도플러를 버린다", () => {
    expect(
      motionStep(INITIAL_MOTION_STATE, sample(0), 0.2, 5, MAX_WALK_SPEED_MPS).motion,
    ).toBe("speedUnknown");
    expect(
      motionStep(INITIAL_MOTION_STATE, sample(0), 0.2, null, MAX_WALK_SPEED_MPS).motion,
    ).toBe("speedUnknown");
  });

  it("폴백에 못 쓸 정확도의 fix는 기준 표본을 덮지 않는다", () => {
    let state: MotionJudgeState = INITIAL_MOTION_STATE;
    state = motionStep(state, sample(0), null, null, MAX_WALK_SPEED_MPS).state;
    state = motionStep(state, sample(1, 37.5, 127, 35), null, null, MAX_WALK_SPEED_MPS).state;
    expect(
      motionStep(state, sample(2, 37.50002), null, null, MAX_WALK_SPEED_MPS).motion,
    ).toBe("moving");
  });

  it("speed가 null인 연속 fix는 폴백으로만 판정한다", () => {
    let state: MotionJudgeState = INITIAL_MOTION_STATE;
    state = motionStep(state, sample(0, 37.5), null, undefined, MAX_WALK_SPEED_MPS).state;
    // 약 2.2m를 2초 = 1.1m/s.
    const out = motionStep(state, sample(2, 37.50002), null, undefined, MAX_WALK_SPEED_MPS);
    expect(out.motion).toBe("moving");
  });
});

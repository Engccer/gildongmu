/**
 * 이동·정지 판정(순수 함수). Kit `GuideMotion.swift` 미러 — 상수·경계·상태 전이가
 * 동일해야 한다(`guide-motion.test.ts`가 같은 케이스로 강제).
 *
 * **왜 3-state인가**: "속도를 모름"은 "정지"도 "이동"도 아니다. 이진화하면 GPS가
 * 속도를 못 줄 때 거짓 정지 tick이 나고, 시각장애 사용자는 화면으로 반증할 수 없다.
 *
 * **왜 도플러 속도인가**: 직선거리 미분은 "목적지 접근 속도"이지 "이동 속도"가
 * 아니라서, 목적지를 옆으로 지나쳐 걸으면 거의 안 변한다. 도플러는 경로와 목적지
 * 양쪽에 독립이라 간략·상세 두 모드에 같은 판정을 쓸 수 있는 유일한 축이다.
 *
 * ⚠ **웹의 속도 표현이 iOS와 다르다.** `GeolocationCoordinates.speed`는 무효일 때
 * `null`이고 음수 sentinel이 아니며, `speedAccuracy`에 해당하는 필드가 아예 없다.
 * `speed < 0` 분기를 그대로 옮기면 `null`이 암묵 변환으로 0이 되어 **거짓 정지 tick**이
 * 난다. `null`·비유한값·필드 누락을 전부 `speedUnknown`으로 보내고 결과 상태(3-state)만
 * iOS와 동조시킨다. speedAccuracy가 없으므로 웹은 폴백 경로 비중이 iOS보다 크다.
 */
import { haversineMeters } from "./geo";

export type MotionState = "stopped" | "moving" | "speedUnknown";

export interface MotionSample {
  lat: number;
  lng: number;
  /** 수평 정확도(m). 음수·0은 무효. */
  accuracy: number;
  /** 단조 시각(초). */
  at: number;
}

export interface MotionJudgeState {
  isStopped: boolean;
  /** 정지 임계 미만이 시작된 시각. null이면 계측 중이 아니다. */
  belowSince: number | null;
  lastSample: MotionSample | null;
}

export const INITIAL_MOTION_STATE: MotionJudgeState = {
  isStopped: false,
  belowSince: null,
  lastSample: null,
};

/**
 * 정지 진입선(m/s). 위원장 판정(2026-08-08): 기준은 **비장애 보행 속도의 90%**다.
 * 평상 1.3 × 0.9 = 1.17m/s, 느린 구간은 그 60%인 0.7m/s이고 이 값은 그 57%다.
 * ⚠ 초판의 0.5m/s와 근거("보행 최저 0.8~1.0m/s")는 철회됐다 — 비장애 평균을 최저값으로
 * 옮긴 것이라 흰지팡이 탐색 보행을 정지로 오판했을 값이다. 재계산 금지.
 */
export const STOP_ENTER_MPS = 0.4;
/** 정지 이탈선(m/s). 진입보다 높다 — 정지 오판은 계속 들리는 거짓 tick을 만들고
 *  이동 오판은 한 번의 침묵으로 끝난다(비대칭이 의도). */
export const STOP_EXIT_MPS = 0.6;
export const STOP_ENTER_HOLD_S = 2.0;
/** speedAccuracy 신뢰 상한(m/s). ⚠ 음수 여부만으로 신뢰도를 판정하지 않는다. */
export const SPEED_ACCURACY_CEILING_MPS = 1.0;
/** 폴백 최소 간격(초). 더 짧으면 GPS 지터가 속도로 증폭된다. */
export const FALLBACK_MIN_INTERVAL_S = 1.0;
/** 폴백 최대 간격(초). 더 길면 실제 이동이 평균화되어 정지로 보인다. */
export const FALLBACK_MAX_INTERVAL_S = 5.0;
export const FALLBACK_MAX_ACCURACY_M = 20;
/** 물리 상한(m/s) — 이를 넘는 산출 속도는 이동이 아니라 GPS 점프다. */
export const MAX_WALK_SPEED_MPS = 8;
export const MAX_CAR_SPEED_MPS = 60;

/** 채택할 속도(m/s). 도플러 우선, 조건 불충족 시 거리 미분 폴백, 둘 다 불가면 null. */
function resolveSpeed(
  state: MotionJudgeState,
  sample: MotionSample,
  speed: number | null | undefined,
  speedAccuracy: number | null | undefined,
  maxSpeedMps: number,
): number | null {
  if (
    typeof speed === "number" &&
    Number.isFinite(speed) &&
    speed >= 0 &&
    typeof speedAccuracy === "number" &&
    Number.isFinite(speedAccuracy) &&
    speedAccuracy >= 0 &&
    speedAccuracy <= SPEED_ACCURACY_CEILING_MPS
  ) {
    return speed;
  }
  const prev = state.lastSample;
  if (!prev) return null;
  const dt = sample.at - prev.at;
  if (dt < FALLBACK_MIN_INTERVAL_S || dt > FALLBACK_MAX_INTERVAL_S) return null;
  if (!(prev.accuracy > 0) || prev.accuracy > FALLBACK_MAX_ACCURACY_M) return null;
  if (!(sample.accuracy > 0) || sample.accuracy > FALLBACK_MAX_ACCURACY_M) return null;
  const meters = haversineMeters(prev.lat, prev.lng, sample.lat, sample.lng);
  if (!Number.isFinite(meters)) return null;
  const v = meters / dt;
  return v <= maxSpeedMps ? v : null;
}

export function motionStep(
  state: MotionJudgeState,
  sample: MotionSample,
  speed: number | null | undefined,
  speedAccuracy: number | null | undefined,
  maxSpeedMps: number,
): { state: MotionJudgeState; motion: MotionState } {
  const velocity = resolveSpeed(state, sample, speed, speedAccuracy, maxSpeedMps);
  const next: MotionJudgeState = { ...state, lastSample: sample };

  if (velocity === null) {
    // 모르는 구간을 정지로 셈하면 그 사이 이동이 정지로 굳는다.
    next.belowSince = null;
    return { state: next, motion: "speedUnknown" };
  }
  if (state.isStopped) {
    if (velocity > STOP_EXIT_MPS) {
      next.isStopped = false;
      next.belowSince = null;
      return { state: next, motion: "moving" };
    }
    return { state: next, motion: "stopped" };
  }
  if (velocity >= STOP_ENTER_MPS) {
    next.belowSince = null;
    return { state: next, motion: "moving" };
  }
  const since = state.belowSince ?? sample.at;
  next.belowSince = since;
  if (sample.at - since >= STOP_ENTER_HOLD_S) {
    next.isStopped = true;
    return { state: next, motion: "stopped" };
  }
  return { state: next, motion: "moving" };
}

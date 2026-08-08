/**
 * 이탈 판정 방위 축(spec 2026-08-09). 웹 ↔ Kit `GuideCourseAxis.swift` 미러.
 *
 * 수직거리 축이 못 보는 이탈(자기근접으로 수직거리가 무너지는 갈림, 역주행)을
 * 진행 방위로 잡는다. 두 축은 독립 병렬이고 확정은 OR, 복귀는 활성 축 전체 해제다.
 *
 * ⚠ **`courseAccuracy`는 통과권이 아니라 불확실성이다.** 기존 `courseStep`의 45°
 * 게이트는 *4분할 방향 어절을 생략할지* 정하는 기준이지 *이탈을 증명하는* 기준이
 * 아니다. 각도차 50°에 불확실성 40°면 실제 차이는 10°일 수 있고, 그런 표를 모으면
 * 확신이 아니라 같은 오차의 반복 집계가 된다.
 *
 * 상수의 근거는 `__tests__/a6-probe.test.ts`가 실경로 5개를 재생해 잰다(잠정 모델
 * 기준. 실기기 로그가 정본이 되면 §7 3단계에서 다시 잰다). 가혹 조건(기기가 자기
 * 오차를 절반으로 축소 보고: 실제 30°+15°, 보고 20°) 헛경고 기준:
 * 판정 가능 비율 게이트 없음 56% → 있음·임계 45° 23% → 있음·임계 60° 4.0%.
 * 대가는 검출 속도다(지속 편향 조건 이탈 255건 중앙: 현행 54초, 임계 45° 27초,
 * 임계 60° 46초). **거짓 이탈 경고가 지연보다 해롭다고 보고 보수적 값에서 출발한다.**
 */
import type { CourseState } from "./guide-course";
import { tangentAt, type Polyline } from "./route-geometry";

/** ⚠ 잠정값(spec §6·§7) — 실기기 로그로 확정한다. */
export const COURSE_AXIS_THRESHOLD_DEG = 60;
/** ⚠ 잠정값(spec §6·§7). */
export const COURSE_AXIS_WINDOW_S = 20;
/** ⚠ 잠정값(spec §6·§7). 확정 임계. */
export const COURSE_AXIS_CONFIRM_RATIO = 0.7;
/** ⚠ 잠정값(spec §6·§7). 해제 임계. 확정과 다른 값이라야 경계 진동이 없다. */
export const COURSE_AXIS_CLEAR_RATIO = 0.3;
/** ⚠ 잠정값(spec §6·§7). 판정 가능한 표가 덮어야 할 최소 시간(초). */
export const COURSE_AXIS_MIN_SPAN_S = 16;
/** ⚠ 잠정값(spec §6·§7). 판정 가능한 표의 최소 개수. */
export const COURSE_AXIS_MIN_VOTES = 8;
/**
 * ⚠ 잠정값(spec §6·§7). 창의 표 중 **판정 가능해야 하는 비율**.
 *
 * ⚠ **개수 하한만으로는 부족하다.** 창의 대부분이 `unknown`이어도 남은 소수가 전부
 * `mismatch`면 비율 판정이 통과해, 얇은 근거 위에서 이탈을 확신하게 된다(경로 재생
 * 실측: 이 게이트가 없으면 가혹 조건 헛경고 56%). 그리고 이것을 **개수**로 표현하면
 * cadence에 묶인다 — 10Hz는 무조건 통과하고 0.5Hz는 영영 미달이라 같은 상황을 두
 * 기기가 다르게 판정한다. 비율이라야 두 요구가 함께 성립한다.
 *
 * ⚠ **이 게이트는 확정과 해제에 대칭 적용되는데, 근거는 확정 쪽에서만 쟀다**(리뷰 I3).
 * 해제를 확정만큼 어렵게 만들면 *거짓 이탈 상태가 더 오래 유지된다* — 임계 60을 고른
 * 근거("거짓 이탈 경고가 지연보다 해롭다")와 같은 해악을 늘리는 방향이다. 지금 값을
 * 가르지 않는 이유는 대칭을 깨는 근거도 없기 때문이다(값을 늘리는 것은 `unknown`을
 * 해제로 접는 것과 다르지만, 어느 쪽이 옳은지는 실측이 답할 문제다).
 * **구조적 해제 지연은 `route-guide.test.ts`의 "복귀 지연" 테스트가 상한으로 잠근다**
 * — 이 상수를 만지면 그 수치가 함께 움직이는 것이 보인다. 실보행 관측 항목에도
 * 복귀 지연을 넣는다(spec §7 3단계).
 */
export const COURSE_AXIS_MIN_DECISIVE_RATIO = 0.8;
/** ⚠ 잠정값(spec §6·§7). 위원장 판정으로 앞뒤 10m. */
export const COURSE_AXIS_BACK_M = 10;
/** ⚠ 잠정값(spec §6·§7). */
export const COURSE_AXIS_AHEAD_M = 10;
/** ⚠ 잠정값(spec §6·§7). 접선 반폭. */
export const COURSE_AXIS_TANGENT_HALF_M = 15;
/** ⚠ 잠정값(spec §6·§7). 이 이상 부정확한 fix는 투영점이 틀려 접선 비교가 무의미하다. */
export const COURSE_AXIS_MAX_ACCURACY_M = 12;
/** ⚠ 잠정값(spec §6·§7). 대조 접선 표본 간격(m) — 검출 입도라 다른 상수와 같은 부류다. */
const SAMPLE_STEP_M = 5;

/**
 * 기기 방위 관측. `state`는 기존 `courseStep` 결과이고 `accuracyDeg`는 그 원본
 * 불확실성이다.
 *
 * ⚠ **둘을 함께 넘긴다.** `state`만 넘기면 불확실성이 사라져 이 축이 다시
 * 통과권 방식으로 되돌아간다.
 */
export interface CourseObservation {
  state: CourseState;
  accuracyDeg: number;
}

/** 방위를 제공하지 않는 플랫폼(웹)이 넘기는 값. 축이 통째로 꺼진다. */
export const INACTIVE_COURSE: CourseObservation = {
  state: { kind: "unknown" },
  accuracyDeg: 0,
};

export type CourseVote = "mismatch" | "match" | "unknown";

export interface CourseVoteSample {
  at: number;
  vote: CourseVote;
}

export type CourseAxisVerdict = "off" | "on" | "unknown";

const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * 한 fix의 표결.
 *
 * ⚠ **"경로의 어느 부분과도 나란하지 않은가"를 묻는다.** 단일 지점 접선과 비교하면
 * 모퉁이를 도는 동안 헛경고가 쏟아진다 — 사람은 2~3초에 급히 꺾는데 접선은 15m
 * 폭으로 완만하기 때문이다. 도는 중에도 꺾기 전이나 꺾은 뒤 방향과는 나란하다.
 */
export function courseVote(
  obs: CourseObservation,
  poly: Polyline,
  d: number,
  fixAccuracy: number,
): CourseVote {
  if (obs.state.kind !== "valid") return "unknown";
  const course = obs.state.course;
  if (!Number.isFinite(course) || course < 0 || course >= 360) return "unknown";
  if (!Number.isFinite(obs.accuracyDeg) || obs.accuracyDeg < 0) return "unknown";
  if (!(fixAccuracy > 0) || fixAccuracy > COURSE_AXIS_MAX_ACCURACY_M) return "unknown";

  let best: number | null = null;
  for (
    let offset = -COURSE_AXIS_BACK_M;
    offset <= COURSE_AXIS_AHEAD_M;
    offset += SAMPLE_STEP_M
  ) {
    const t = tangentAt(poly, d + offset, COURSE_AXIS_TANGENT_HALF_M);
    if (t === null) continue;
    const diff = angDiff(course, t);
    if (best === null || diff < best) best = diff;
  }
  // 유효 접선이 하나도 없으면 판정하지 않는다(0도로 접지 않는다).
  if (best === null) return "unknown";

  if (best - obs.accuracyDeg > COURSE_AXIS_THRESHOLD_DEG) return "mismatch";
  if (best + obs.accuracyDeg < COURSE_AXIS_THRESHOLD_DEG) return "match";
  return "unknown";
}

/**
 * 표를 창에 기록한다.
 *
 * ⚠ **같은 시각의 중복 fix는 하나로 합친다.** 안 그러면 배치 도착한 fix 묶음이
 * 2초 움직임으로 20초 창의 다수를 장악한다.
 */
export function recordVote(
  samples: readonly CourseVoteSample[],
  at: number,
  vote: CourseVote,
): CourseVoteSample[] {
  const kept = samples.filter((s) => s.at > at - COURSE_AXIS_WINDOW_S && s.at !== at);
  return [...kept, { at, vote }];
}

/**
 * 창의 판정. `off`=이탈, `on`=경로 방향 정합, `unknown`=판정 불가.
 *
 * ⚠ **`unknown`은 `on`이 아니다.** 판정 근거가 없는데 정합으로 접으면, 실제 방향을
 * 전혀 모르는 상태에서 "돌아왔습니다"를 발화하게 된다(3-state 불변식).
 */
export function courseAxisVerdict(samples: readonly CourseVoteSample[]): CourseAxisVerdict {
  const decisive = samples.filter((s) => s.vote !== "unknown");
  if (decisive.length < COURSE_AXIS_MIN_VOTES) return "unknown";
  if (decisive.length / samples.length < COURSE_AXIS_MIN_DECISIVE_RATIO) return "unknown";
  const span = Math.max(...decisive.map((s) => s.at)) - Math.min(...decisive.map((s) => s.at));
  if (span < COURSE_AXIS_MIN_SPAN_S) return "unknown";
  const ratio = decisive.filter((s) => s.vote === "mismatch").length / decisive.length;
  if (ratio >= COURSE_AXIS_CONFIRM_RATIO) return "off";
  if (ratio <= COURSE_AXIS_CLEAR_RATIO) return "on";
  return "unknown";
}

/**
 * 이탈 판정 방위 축(spec 2026-08-09). 웹 ↔ Kit `GuideCourseAxis.swift` 미러.
 *
 * 수직거리 축이 못 보는 이탈(자기근접으로 수직거리가 무너지는 갈림, 역주행)을
 * 진행 방위로 잡는다. 두 축은 독립 병렬이고 확정은 OR, 복귀는 활성 축 전체 해제다.
 *
 * ⚠ **불확실성은 통과권이 아니라 오차범위다.** 각도차 50°에 불확실성 40°면 실제
 * 차이는 10°일 수 있고, 그런 표를 모으면 확신이 아니라 같은 오차의 반복 집계가 된다.
 * 관측은 기기 course가 아니라 위치 이력 유도(`course-derivation.ts`)에서 오고,
 * 불확실성은 사슬 자기일관성 U다(재설계 2026-08-10, spec §2.0·§2.10).
 *
 * 상수의 근거는 실사용 로그(spec §3.0, `docs/superpowers/specs/logs/`)와 리플레이
 * 게이트 `course-derivation-replay.test.ts`다(합성 재생 하네스 `a6-probe.test.ts`는
 * 보조. 확정은 §7 3단계 검증 보행).
 */
import type { DerivedCourse } from "./course-derivation";
import { tangentAt, type Polyline } from "./route-geometry";

/**
 * ⚠ 잠정값(spec §6·§7) — 검증 보행으로 확정한다. 60은 기기 course의 두꺼운 꼬리
 * (p90 51°)에 맞춘 값이었고 유도 방위(p90 30.8°)에서는 45°가 오표 0.4% 그대로
 * 45° 갈림까지 검출한다(spec §3.0.5).
 */
export const COURSE_AXIS_THRESHOLD_DEG = 45;
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
/** ⚠ 잠정값(spec §6·§7). 대조 접선 표본 간격(m) — 검출 입도라 다른 상수와 같은 부류다. */
const SAMPLE_STEP_M = 5;

// 보고 acc 게이트(COURSE_AXIS_MAX_ACCURACY_M)는 폐기했다(spec §2.10): 보고 acc는
// 실사용 로그에서 14.2m 동결(249/281)이라 판정 근거로 무의미 — 품질 증거는 사슬 U가
// 담는다. 기기 관측 전제의 CourseObservation·INACTIVE_COURSE도 함께 소멸했다
// (유도는 lat/lng/t만 필요해 웹에서도 축이 켜진다 — spec §4).

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
  obs: DerivedCourse | null,
  poly: Polyline,
  d: number,
): CourseVote {
  if (obs === null) return "unknown";
  const course = obs.bearing;
  // 유도기 계산값이라 범위가 보장되지만 방어로 유지한다(비용 0).
  if (!Number.isFinite(course) || course < 0 || course >= 360) return "unknown";
  if (!Number.isFinite(obs.uncertaintyDeg) || obs.uncertaintyDeg < 0) return "unknown";

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

  if (best - obs.uncertaintyDeg > COURSE_AXIS_THRESHOLD_DEG) return "mismatch";
  if (best + obs.uncertaintyDeg < COURSE_AXIS_THRESHOLD_DEG) return "match";
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

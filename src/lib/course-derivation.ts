/**
 * 방위 축 관측 유도기(spec §2.0, 재설계 2026-08-10). 웹 ↔ Kit `CourseDerivation.swift` 미러.
 *
 * 기기 course는 GPS 도플러 기반이라 보행 속도에서 방위를 제공하지 않는다(실사용 로그:
 * courseAcc 중위 83°, 축 통과 0/281 — spec §3.0.1). 유도 방위는 fix 이력의 chord라
 * 조건이 속도가 아니라 누적 변위다. 위치 오차는 절대값(보고 acc 14.2m)이 아니라 상관이
 * 문제였고, 인접 fix 상대 잡음은 중위 0.42m라 변위에서 공통 성분이 소거된다(§3.0.2).
 *
 * ⚠ 사슬 U가 기기 courseAccuracy의 대체물이자 회전 보호다: 모퉁이에서 사슬이 굽어
 * U가 커지고 표가 자동으로 unknown이 된다. 잡음도 같은 경로로 스스로 unknown이 된다.
 *
 * ⚠ 전진 게이트가 없으면 정지 중 같은 chord가 반복 관측된다 — §2.1이 금지한
 * "같은 오차의 반복 집계"가 정지 상태에서 재발한다.
 */
import { haversineMeters } from "./geo";
import { bearingDegrees } from "./geo/bearing";

/** ⚠ 잠정값(spec §6·§7). 기저선 — 실사용 로그 스윕에서 10m 최적(§3.0.3). */
export const DERIVE_BASELINE_M = 10;
/** ⚠ 잠정값(spec §6·§7). 기저선 fix의 최대 나이. */
export const DERIVE_MAX_AGE_S = 30;
/** ⚠ 잠정값(spec §6·§7). 사슬 U 하한 — 완전 직선 사슬도 이만큼은 불확실하다. */
export const DERIVE_U_FLOOR_DEG = 8;
/** ⚠ 잠정값(spec §6·§7). 사슬 편차 여유 — 편차 0이어도 U에 반영되는 잡음 마진. */
export const DERIVE_SLACK_M = 1.5;
/** ⚠ 잠정값(spec §6·§7). 전진 게이트 — 이만큼 전진해야 새 표를 낸다. */
export const DERIVE_ADVANCE_M = 2;

export interface DerivedCourse {
  /** [0,360) 진행 방위. */
  bearing: number;
  /** 사슬 자기일관성 불확실성(도). */
  uncertaintyDeg: number;
}

export interface DerivationFix {
  lat: number;
  lng: number;
  at: number;
}

export interface CourseDerivationState {
  fixes: readonly DerivationFix[];
  /** 마지막으로 표를 방출한 위치(전진 게이트 기준점). */
  lastEmit: { lat: number; lng: number } | null;
}

export const INITIAL_DERIVATION_STATE: CourseDerivationState = {
  fixes: [],
  lastEmit: null,
};

/**
 * fix 하나를 버퍼에 반영하고, 가능하면 유도 관측을 낸다.
 *
 * 버퍼는 age 상한으로 자체 소멸하므로 경로 교체와 무관하다(궤적은 경로의 함수가
 * 아니다 — spec §2.9). 새 세션은 `INITIAL_DERIVATION_STATE`에서 시작한다.
 */
export function deriveCourse(
  state: CourseDerivationState,
  fix: { lat: number; lng: number },
  at: number,
): { state: CourseDerivationState; obs: DerivedCourse | null } {
  // 같은 timestamp는 교체, age 상한 밖은 절단(배치 도착·중복 fix 방어).
  const kept = state.fixes.filter((f) => f.at !== at && f.at > at - DERIVE_MAX_AGE_S);
  const fixes = [...kept, { lat: fix.lat, lng: fix.lng, at }];
  const next: CourseDerivationState = { fixes, lastEmit: state.lastEmit };

  // 기저선: chord 거리 ≥ B인 가장 가까운(최근) 과거 fix.
  let baseIdx = -1;
  for (let i = fixes.length - 2; i >= 0; i--) {
    if (haversineMeters(fixes[i].lat, fixes[i].lng, fix.lat, fix.lng) >= DERIVE_BASELINE_M) {
      baseIdx = i;
      break;
    }
  }
  if (baseIdx < 0) return { state: next, obs: null };

  // 전진 게이트(spec §2.0 규칙 4).
  if (
    next.lastEmit !== null &&
    haversineMeters(next.lastEmit.lat, next.lastEmit.lng, fix.lat, fix.lng) < DERIVE_ADVANCE_M
  ) {
    return { state: next, obs: null };
  }

  const base = fixes[baseIdx];
  const chord = haversineMeters(base.lat, base.lng, fix.lat, fix.lng);
  const bearing = bearingDegrees(base.lat, base.lng, fix.lat, fix.lng);

  // 사슬 자기일관성: 중간 fix들의 chord 수직 편차 최대(spec §2.0 규칙 3).
  let maxDev = 0;
  for (let i = baseIdx + 1; i < fixes.length - 1; i++) {
    const d = haversineMeters(base.lat, base.lng, fixes[i].lat, fixes[i].lng);
    if (d === 0) continue;
    const b = bearingDegrees(base.lat, base.lng, fixes[i].lat, fixes[i].lng);
    const dev = Math.abs(d * Math.sin(((b - bearing) * Math.PI) / 180));
    if (dev > maxDev) maxDev = dev;
  }
  const uncertaintyDeg = Math.max(
    DERIVE_U_FLOOR_DEG,
    (Math.atan((maxDev + DERIVE_SLACK_M) / chord) * 180) / Math.PI,
  );

  return {
    state: { fixes, lastEmit: { lat: fix.lat, lng: fix.lng } },
    obs: { bearing, uncertaintyDeg },
  };
}

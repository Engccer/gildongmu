/**
 * 경로 종점 → 목적지 오프셋 기하(spec 2026-08-08 §3.1). **정적 계산이라 GPS와 무관하다.**
 *
 * 이 값이 필요한 이유: 도보 경로는 목적지 좌표가 아니라 가장 가까운 보행로 지점에서
 * 끝난다(실측 16~89m). 그 구간이 곧 "마지막 몇 미터"이고, 거리·방향을 경로 수신
 * 시점에 확정할 수 있어 나침반·course 없이도 정직하게 말할 수 있다.
 *
 * Kit 미러는 `FinalApproach.swift`이고 공유 fixture `final-approach-scenarios.json`이
 * 동조를 강제한다.
 */
import type { Coord } from "./types";
import type { GuideRoute } from "./route-geometry";
import { haversineMeters } from "./geo";
import { bearingDegrees } from "./geo/bearing";

/** 이 미만이면 방향을 주장하지 않는다 — roundCoord(…,4) ±5.5m에서 방위가 뒤집힌다. */
export const OFFSET_MIN_M = 10;
/** 종점 진행 방위를 평균할 역방향 창(m). 마지막 세그먼트 단독은 실측에서 판정이 뒤집혔다. */
export const BEARING_WINDOW_M = 15;
/**
 * 도착 확정 반경(m). Soundscape `enterImmediateVicinityDistance`와 같은 값.
 *
 * **수치 없이 "목적지 근처"라고만 말하는 반경이기도 하다**(spec §3.6 사다리) — 두 이름을
 * 두지 않는 이유는 spec이 둘을 같은 15m로 정했고 이름이 갈리면 드리프트가 생기기 때문이다.
 *
 * ⚠ Soundscape의 이탈 히스테리시스(30m)는 **일부러 쓰지 않는다.** 목적지를 지나친
 * 사용자에게 안내가 사라지는 것이 초판 결함이었고, 도착이 세션을 끝내므로 되돌아오는
 * 전이 자체가 없어 히스테리시스가 할 일이 없다(상수를 두면 죽은 코드다).
 * ⚠ 실보행 판정 전까지 동결(spec §6-3).
 */
export const ARRIVE_M = 15;
/** 최종 접근 주기 통지 간격(초). Sendero "Getting Warmer" 실사양. 동결(spec §6-2). */
export const FINAL_INTERVAL_S = 15;

export interface FinalApproachGeometry {
  /** 경로 종점 → 목적지 직선거리(m), 반올림 전 원값. */
  offsetMeters: number;
  /** 종점 진행 방위 대비 목적지 상대각(-180~180, +우 -좌). */
  relativeBearing?: number;
  /** relativeBearing 부재 사유 — "모름"과 "실패"를 소비자가 가른다. */
  bearingUnavailable?: "tooClose" | "degenerateGeometry";
}

/**
 * 4분할 경계 소유권. **부등호까지 계약이다** — 웹과 Swift가 각각 `>`와 `>=`를
 * 고르면 경계 좌표에서 서로 다른 방향을 말한다.
 */
export function relativeDirection(
  theta: number,
): "ahead" | "left" | "right" | "behind" {
  const a = Math.abs(theta);
  if (a <= 45) return "ahead";
  if (a <= 135) return theta > 0 ? "right" : "left";
  return "behind";
}

/**
 * ⚠ **기준 도로명(`roadName`)은 두지 않는다**(2026-08-09 폐기). 종점 도로명을 말해도
 * 사용자의 다음 행동이 바뀌지 않고, 스펙 자신의 §2.6(가까울수록 발화를 줄인다)과
 * §2.5(랜드마크는 검증 가능해야 한다)에 어긋난다 — 종점에 선 시각장애 보행자가
 * 거기가 천호대로임을 확인할 수단이 없다. 게다가 실호출에서 "천호대로가 끝납니다"가
 * 거짓이었다(끝나는 것은 경로이지 도로가 아니다). 되살리려면 백로그 폐기 사유부터 볼 것.
 */
export function computeFinalApproach(
  route: GuideRoute,
  dest: Coord,
): FinalApproachGeometry | null {
  const { points, cum } = route.polyline;
  if (points.length < 2) return null;
  const end = points[points.length - 1];
  const offsetMeters = haversineMeters(end.lat, end.lng, dest.lat, dest.lng);
  if (!Number.isFinite(offsetMeters)) return null;

  const base: FinalApproachGeometry = { offsetMeters };
  if (offsetMeters < OFFSET_MIN_M) {
    return { ...base, bearingUnavailable: "tooClose" };
  }

  // 종점에서 역방향 BEARING_WINDOW_M 창의 길이 가중 단위벡터 합.
  //
  // ⚠ 각도를 산술 평균하지 않는다 — +179°와 -179°의 평균은 0°가 되어 뒤쪽이
  //   정면으로 뒤집힌다.
  // ⚠ 창에 걸치는 세그먼트는 **겹치는 길이만** 가중치로 쓴다(통째로 넣지 않는다).
  //   통째로 넣으면 "100m 직진 후 모퉁이를 돌아 10m" 경로에서 100m가 가중치를
  //   지배해 방위가 직진 방향으로 남고, 이미 목적지를 향해 선 사용자에게
  //   "오른쪽"을 말한다. 마지막 모퉁이야말로 이 기능이 존재하는 이유다.
  const total = cum[cum.length - 1];
  const from = Math.max(0, total - BEARING_WINDOW_M);
  let sx = 0;
  let sy = 0;
  for (let i = points.length - 1; i > 0; i--) {
    const d0 = cum[i - 1];
    const d1 = cum[i];
    if (d1 <= from) break; // 창보다 앞선 세그먼트 — 누적이라 더 볼 것이 없다
    const weight = d1 - Math.max(d0, from);
    if (weight <= 0) continue;
    const theta =
      (bearingDegrees(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng) *
        Math.PI) /
      180;
    sx += weight * Math.cos(theta);
    sy += weight * Math.sin(theta);
  }
  if (Math.hypot(sx, sy) < 1e-9) {
    return { ...base, bearingUnavailable: "degenerateGeometry" };
  }
  const heading = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  const toDest = bearingDegrees(end.lat, end.lng, dest.lat, dest.lng);
  const relativeBearing = ((toDest - heading + 540) % 360) - 180;
  return { ...base, relativeBearing };
}

// ── 도착 추정(잊힌 세션 정리, spec 2026-08-13) ──────────────────────────────
// Kit 미러는 `FinalApproach.swift`, 공유 fixture `presumed-arrival-scenarios.json`.

/** 진행 관측 앵커 이탈 하한(m). 직전 fix 비교 금지 — 저속 연속 보행이 제자리로 오판된다. */
export const PROGRESS_EPSILON_M = 10;

/**
 * 도착 추정 임계 프로파일(수단별, spec 2026-08-31 §3). 값은 전부 잠정 — 실보행·실주행 재판정.
 * `presumedArrivalStep`의 필수 인자라 호출자가 어느 수단인지를 생략할 수 없다.
 */
export interface PresumedArrivalThresholds {
  /** usable fix 두절이 이만큼 지속되면 실내(지하) 진입으로 간주. */
  readonly noFixSeconds: number;
  /** usable fix는 오는데 무진행이 이만큼 지속되면 고정 좌표로 간주. */
  readonly stationarySeconds: number;
  /** 마지막 확인 거리 캡(m). 이 밖은 이탈이지 도착이 아니다. */
  readonly maxDistanceMeters: number;
}

/** 도보: 건물 진입 뒤 wifi 측위가 드문드문 이어지는 180초, 오프셋 실측 상한 89m + GPS 여유 150m. */
export const PRESUMED_ARRIVAL_WALK: PresumedArrivalThresholds = {
  noFixSeconds: 180,
  stationarySeconds: 300,
  maxDistanceMeters: 150,
};
/**
 * 자동차: 지하 주차장 진입은 fix가 끊기는 순간 운전이 끝나므로 두절 120초(08-22 짧은 공백
 * 46~96초가 하한 근거). 무이동 300초는 관측 최장 신호 대기 73초의 4배 — 40m 안 정차는 확정
 * 도착이 먼저 잡으므로 이 축의 몫은 40~150m뿐. 도보와 같은 값도 별 프로파일에 둔다(도보
 * 재판정이 자동차를 끌고 가면 안 된다).
 */
export const PRESUMED_ARRIVAL_CAR: PresumedArrivalThresholds = {
  noFixSeconds: 120,
  stationarySeconds: 300,
  maxDistanceMeters: 150,
};

export type PresumedArrivalReason = "noFix" | "stationary";

export interface PresumedArrivalInput {
  inFinalApproach: boolean;
  /** 기준: max(최종 접근 진입, 마지막 usable fix) — 진입 전 노화가 새면 즉시 발동한다. */
  secondsSinceUsableFix: number;
  /** 기준: max(최종 접근 진입, 마지막 진행 관측). */
  secondsSinceProgress: number;
  /** 마지막 usable fix 기준 목적지 직선거리. null = 미확인(발동 불가). */
  lastKnownDistanceToDestMeters: number | null;
}

const finiteNonNegative = (x: number) => Number.isFinite(x) && x >= 0;

/**
 * 도착 추정 판정. 판정 순서(국면 → 거리 캡 → noFix → stationary)까지 계약이다 —
 * 국면 게이트가 경로 중간 자동 종료 금지의 1선 방어다(spec §3).
 */
export function presumedArrivalStep(
  input: PresumedArrivalInput,
  thresholds: PresumedArrivalThresholds,
): PresumedArrivalReason | null {
  if (!input.inFinalApproach) return null;
  if (
    !finiteNonNegative(input.secondsSinceUsableFix) ||
    !finiteNonNegative(input.secondsSinceProgress)
  ) {
    return null;
  }
  const dist = input.lastKnownDistanceToDestMeters;
  if (dist === null || !finiteNonNegative(dist) || dist > thresholds.maxDistanceMeters) {
    return null;
  }
  if (input.secondsSinceUsableFix >= thresholds.noFixSeconds) return "noFix";
  if (input.secondsSinceProgress >= thresholds.stationarySeconds) return "stationary";
  return null;
}

/**
 * 진행 관측 앵커 전진. **직전 fix가 아니라 앵커 기준 누적 변위**다 — 직전 비교는
 * 1m/s 연속 보행(fix 간 1m)을 5분 300m 걷고도 제자리로 오판한다(설계 리뷰 C2).
 */
export function advanceProgressAnchor(
  anchor: Coord | null,
  fix: Coord,
  epsilonMeters: number = PROGRESS_EPSILON_M,
): { anchor: Coord; progressed: boolean } {
  if (!anchor) return { anchor: fix, progressed: false };
  if (haversineMeters(anchor.lat, anchor.lng, fix.lat, fix.lng) >= epsilonMeters) {
    return { anchor: fix, progressed: true };
  }
  return { anchor, progressed: false };
}

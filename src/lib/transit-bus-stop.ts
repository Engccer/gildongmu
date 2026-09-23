/**
 * 버스 승차 중 현재 정류장 — 기기 위치(fix)의 **표시 전용** 순수 계층(E48, spec
 * `2026-09-23-bus-current-stop-design.md` §2). Kit 미러: `TransitBusStop.swift` — 공유 fixture
 * (`transit-bus-stop-cases.json`)가 동조를 강제한다.
 *
 * ⚠ 이 상태는 승차 상태 머신(`transit-guide.ts` 리듀서) **밖**에 있다. 리듀서는 이 모듈을 모르고
 * (소스 가드 `transit-bus-stop-guard.test.ts`), 도착·승격·하차·neverSeen 판정은 도착 API가 한다
 * (판정서 2026-08-23 §3). 기기 위치는 경유 정류장 목록·조망의 "현재 위치" 표식만 채운다.
 *
 * E35 열차 위치(`transit-riding-position.ts`)와 합치지 않는다 — 결박(열차번호 유무)·출처(서버 응답 vs
 * 기기 fix)·빈도(분 vs 초)·뒤 재시작 규칙이 다르다. 합류는 표식 index의 큰 값 하나다.
 *
 * 불변식: 표식은 "있다"만 주장한다. 부정확·오래된·노선 밖·모호 fix는 모두 표식 부재로 나간다.
 */
import { haversineMeters } from "./geo";
import type { TransitGuideLeg, TransitGuideState } from "./transit-guide";
import type { TransitOverview } from "./transit-progress-overview";
import { viaStopHereIndex, type TransitRidingPosition } from "./transit-riding-position";

/** fix 정확도 상한(m) — iOS 공유 스토어 저장 상한(`LocationFixPolicy.storeCeiling`)과 같다. ⚠ 잠정값(실승차 판정). */
export const BUS_STOP_MAX_ACCURACY_M = 100;
/** fix 나이 상한(초) — 캐시 fix를 거른다. ⚠ 잠정값. */
export const BUS_STOP_FIX_MAX_AGE_SECONDS = 10;
/** 최근접 정류장까지의 거리 상한(m) — 넘으면 노선 밖이라 관측이 아니다. ⚠ 잠정값. */
export const BUS_STOP_NEAR_RADIUS_M = 300;
/** 비인접 정류장이 최근접보다 이만큼 안쪽이면 노선이 접힌 곳이라 모호하다. ⚠ 잠정값. */
export const BUS_STOP_AMBIGUITY_MARGIN_M = 50;
/**
 * 하차 정류장은 이만큼 가까워야 관측으로 친다(m). "하차, 현재 위치"는 "지금 내려라"로 들린다 — 직전 정류장에 문이
 * 열린 채 서 있는 동안 한쪽으로 치우친 fix 두 건이 중간 지점을 넘겨 그 줄을 먼저 세우지 않게(접근성 감사 MINOR-2).
 * ⚠ 잠정값.
 */
export const BUS_STOP_ALIGHT_RADIUS_M = 50;
/**
 * 마지막 관측 뒤 표식을 유지하는 창(ms). 만료는 폴 시계가 아니라 **이 시각에 맞춘 한 번짜리 타이머**가 판정한다
 * (설계 리뷰 M2 — 폴에 기대면 실효 창이 창+폴 주기로 늘어난다). ⚠ 잠정값.
 */
export const BUS_STOP_HOLD_MS = 90_000;
/** 래치보다 뒤 정류장 관측이 이만큼 이어지면 그 정류장에서 다시 시작한다(ms). ⚠ 잠정값. */
export const BUS_STOP_BEHIND_RESTART_MS = 60_000;

/** fix 한 건. `ageSeconds`는 호출자가 **측정 시각**으로 잰다(수신 시각이 아니다). */
export interface TransitDeviceFix {
  lat: number;
  lng: number;
  /** 수평 정확도(m). 0 이하·비유한은 판정 불가. */
  accuracy: number;
  ageSeconds: number;
}

export interface TransitBusStopTracker {
  legIndex: number;
  phaseGen: number;
  /** 단조 래치 — 버스는 뒤로 가지 않는다. 관측 전·보존 창 만료 뒤는 null. */
  stopIndex: number | null;
  /** 마지막으로 래치를 확인·전진시킨 관측 시각(ms). */
  lastObservedAt: number | null;
  /**
   * 래치보다 앞(또는 래치 없음)으로 한 번 관측된 정류장 — 같은 정류장이 한 번 더 이어서 관측돼야 래치가
   * 옮겨 간다(설계 리뷰 M1: 튄 fix 한 건이 아직 오지 않은 정류장을 "현재 위치"로 만들지 않게).
   */
  pendingIndex: number | null;
  /** 뒤 정류장 관측이 시작된 시각(ms) — 같거나 앞 관측이 오면 끊긴다. */
  behindSince: number | null;
}

/**
 * 뷰가 읽는 표식 — 시각이 빠진 (결박, 정류장)이다. fix마다 바뀌는 `lastObservedAt`을 뷰에 노출하면 관측이
 * 이어지는 동안 목록이 초마다 다시 그려진다(설계 리뷰 m3). 이 값이 바뀔 때만 화면 상태에 쓴다.
 */
export interface TransitBusStopMark {
  legIndex: number;
  phaseGen: number;
  stopIndex: number;
}

export type TransitBusStopVerdict =
  | "notApplicable"
  | "inaccurate"
  | "stale"
  | "offRoute"
  | "ambiguous"
  | "approachingAlight"
  | "pending"
  | "observed"
  | "behind"
  | "restarted";

export interface TransitBusStopStepResult {
  tracker: TransitBusStopTracker | null;
  verdict: TransitBusStopVerdict;
  /** 이 fix의 최근접 정류장(원본 index) — 거리를 재기 전에 걸러졌으면 null. 계측 전용(구현 리뷰 m3). */
  nearestIndex: number | null;
}

type BusStopState = Pick<TransitGuideState, "legIndex" | "phase" | "phaseGen">;

/** 적용 조건(spec §2 ①) — 잠금 종류·신호는 보지 않는다(기기 위치는 도착 피드와 독립이다). */
export function busStopApplies(state: BusStopState, leg: TransitGuideLeg): boolean {
  return state.phase === "riding" && leg.mode === "bus" && leg.viaStops.length > 0;
}

function isBound(
  bound: { legIndex: number; phaseGen: number } | null,
  state: BusStopState,
): boolean {
  return bound != null && bound.legIndex === state.legIndex && bound.phaseGen === state.phaseGen;
}

/** 쓸 수 있는 정류장 좌표 — 비유한·(0,0)은 후보에서 뺀다(설계 리뷰 m5, `transitPrewalkTarget`과 같은 방어). */
function usableStop(s: { lat: number; lng: number }): boolean {
  return Number.isFinite(s.lat) && Number.isFinite(s.lng) && !(s.lat === 0 && s.lng === 0);
}

/**
 * fix 한 건을 반영한다(spec §2 ③). 기기 위치는 언제 도착하든 "지금 이 사람의 위치"라 요청 결박을
 * 따지지 않고 **현재 상태**의 결박에 넣는다(E35의 늦은 응답 폐기와 다른 점).
 */
export function busStopStep(
  prev: TransitBusStopTracker | null,
  state: BusStopState,
  leg: TransitGuideLeg,
  fix: TransitDeviceFix,
  now: number,
): TransitBusStopStepResult {
  if (!busStopApplies(state, leg)) return { tracker: null, verdict: "notApplicable", nearestIndex: null };
  let next: TransitBusStopTracker =
    prev && isBound(prev, state)
      ? { ...prev }
      : {
          legIndex: state.legIndex,
          phaseGen: state.phaseGen,
          stopIndex: null,
          lastObservedAt: null,
          pendingIndex: null,
          behindSince: null,
        };
  // 보존 창이 지난 래치는 버린다(E35 설계 리뷰 M2와 같은 이유) — 표시되지 않는 래치가 뒤의 진짜 관측을 막지 않게.
  if (next.lastObservedAt != null && now - next.lastObservedAt > BUS_STOP_HOLD_MS) {
    next = { ...next, stopIndex: null, lastObservedAt: null, pendingIndex: null, behindSince: null };
  }
  if (!(fix.accuracy > 0) || !Number.isFinite(fix.accuracy) || fix.accuracy > BUS_STOP_MAX_ACCURACY_M) {
    return { tracker: next, verdict: "inaccurate", nearestIndex: null };
  }
  if (!(Math.abs(fix.ageSeconds) <= BUS_STOP_FIX_MAX_AGE_SECONDS)) {
    return { tracker: next, verdict: "stale", nearestIndex: null };
  }

  // 원본 index를 유지한 채 쓸 수 있는 정류장만 겨룬다.
  const distances = leg.viaStops.map((s) =>
    usableStop(s) ? haversineMeters(fix.lat, fix.lng, s.lat, s.lng) : Number.POSITIVE_INFINITY,
  );
  let nearest = 0;
  for (let i = 1; i < distances.length; i++) if (distances[i] < distances[nearest]) nearest = i;
  const result = (tracker: TransitBusStopTracker, verdict: TransitBusStopVerdict): TransitBusStopStepResult => ({
    tracker,
    verdict,
    nearestIndex: nearest,
  });
  if (!(distances[nearest] <= BUS_STOP_NEAR_RADIUS_M)) return result(next, "offRoute");
  // 노선이 접힌 곳(회차·U턴·순환 — 길 건너 정류장)은 어느 쪽인지 가를 수 없다. 인접 정류장끼리는 경합이 아니다.
  const folded = distances.some(
    (d, j) => Math.abs(j - nearest) >= 2 && d <= distances[nearest] + BUS_STOP_AMBIGUITY_MARGIN_M,
  );
  if (folded) return result(next, "ambiguous");
  if (nearest === distances.length - 1 && distances[nearest] > BUS_STOP_ALIGHT_RADIUS_M) {
    return result(next, "approachingAlight");
  }

  if (next.stopIndex === nearest) {
    return result({ ...next, lastObservedAt: now, pendingIndex: null, behindSince: null }, "observed");
  }
  if (next.stopIndex == null || nearest > next.stopIndex) {
    // 앞으로는 같은 정류장이 두 번 이어서 관측돼야 옮긴다(설계 리뷰 M1). 뒤 관측의 연속은 끊긴다.
    if (next.pendingIndex === nearest) {
      return result({ ...next, stopIndex: nearest, lastObservedAt: now, pendingIndex: null, behindSince: null }, "observed");
    }
    return result({ ...next, pendingIndex: nearest, behindSince: null }, "pending");
  }
  // 뒤 정류장 — 60초 동안 이어질 때만 다시 시작한다(첫 래치가 틀렸던 경우의 복구). 중간 지점의 흔들림은
  // 사이에 끼는 같거나 앞 관측이 끊는다. 뒤 관측은 래치를 확인하지 않으므로 `lastObservedAt`을 두고 간다
  // — 그래서 래치 나이가 30초를 넘은 뒤 시작한 뒤 관측은 60초 전에 보존 창 만료가 먼저 래치를 버린다.
  const since = next.behindSince ?? now;
  if (now - since >= BUS_STOP_BEHIND_RESTART_MS) {
    return result({ ...next, stopIndex: nearest, lastObservedAt: now, pendingIndex: null, behindSince: null }, "restarted");
  }
  return result({ ...next, pendingIndex: null, behindSince: since }, "behind");
}

/** 표식 — 적용 조건·결박·보존 창 안일 때만. `now`가 관측보다 이르면(음수 경과) 보인다. */
export function busStopMarkOf(
  state: BusStopState,
  leg: TransitGuideLeg,
  tracker: TransitBusStopTracker | null,
  now: number,
): TransitBusStopMark | null {
  if (!busStopApplies(state, leg) || !tracker || !isBound(tracker, state)) return null;
  if (tracker.stopIndex == null || tracker.lastObservedAt == null) return null;
  if (now - tracker.lastObservedAt > BUS_STOP_HOLD_MS) return null;
  return { legIndex: tracker.legIndex, phaseGen: tracker.phaseGen, stopIndex: tracker.stopIndex };
}

/** 표식이 지금 상태에서 유효한 index — 국면·구간·결박이 바뀌었으면 옛 표식은 null. */
function markIndex(state: BusStopState, leg: TransitGuideLeg, mark: TransitBusStopMark | null): number | null {
  if (!mark || !busStopApplies(state, leg) || !isBound(mark, state)) return null;
  return mark.stopIndex < leg.viaStops.length ? mark.stopIndex : null;
}

/**
 * 경유 목록 표식의 세 번째 출처(spec §2 ⑤) — E35 `viaStopHereIndex`(도착 `arvlMsg3`·열차 위치)와 버스
 * 표식 중 큰 값. 한 leg에서 두 출처가 겨루지 않지만(버스 ↔ 지하철) 그 사실을 가정하지 않는다.
 */
export function viaStopHereIndexWithBusStop(
  state: Parameters<typeof viaStopHereIndex>[0],
  leg: TransitGuideLeg,
  position: TransitRidingPosition | null,
  mark: TransitBusStopMark | null,
  now: number,
): number | null {
  const train = viaStopHereIndex(state, leg, position, now);
  const bus = markIndex(state, leg, mark);
  if (train == null) return bus;
  if (bus == null) return train;
  return Math.max(train, bus);
}

/**
 * 조망 후처리(spec §2 ⑥) — 버스 leg에서 `here`가 해당 없음일 때만 표식으로 바꾼다(추적 불가 지하철 leg도
 * 같은 `bus` 사유를 받으므로 leg 종류를 함께 본다 — 설계 리뷰 n1). silence 행·`reboardOffered`는 불변.
 * E35 후처리 뒤에 얹는다(서로 다른 leg 종류에서만 일한다).
 */
export function overviewApplyingBusStop(
  overview: TransitOverview,
  state: BusStopState,
  leg: TransitGuideLeg,
  mark: TransitBusStopMark | null,
): TransitOverview {
  if (overview.here.kind !== "notApplicable" || overview.here.reason !== "bus") return overview;
  const shown = markIndex(state, leg, mark);
  if (shown == null) return overview;
  return {
    ...overview,
    here: { kind: "station", stopIndex: shown },
    rows: overview.rows.map((row) => (row.kind === "stop" ? { ...row, here: row.stopIndex === shown } : row)),
  };
}

/** 두 표식이 같은가 — 뷰 상태를 바뀔 때만 쓰는 비교(웹 `setState`·iOS 관측 속성). */
export function sameBusStopMark(a: TransitBusStopMark | null, b: TransitBusStopMark | null): boolean {
  if (a == null || b == null) return a === b;
  return a.legIndex === b.legIndex && a.phaseGen === b.phaseGen && a.stopIndex === b.stopIndex;
}

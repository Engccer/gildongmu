/**
 * 승차 중 현재역 — 실시간 열차 위치의 **표시 전용** 순수 계층(E35, spec
 * `2026-09-23-riding-current-station-design.md` §4). Kit 미러: `TransitRidingPosition.swift` —
 * 공유 fixture(`transit-riding-position-cases.json`)가 동조를 강제한다.
 *
 * ⚠ 이 상태는 승차 상태 머신(`transit-guide.ts` 리듀서) **밖**에 있다. 리듀서는 이 모듈을 모르고
 * (소스 가드 `transit-riding-position-guard.test.ts`), 도착·승격·하차·neverSeen 판정은 도착 API가 한다
 * (판정서 2026-08-23 §3 — 위치를 판정에 접붙인 설계는 BLOCKER 11건으로 기각됐다). 위치는 화면·문장의
 * "현재 위치"만 채운다.
 *
 * 불변식: 표식은 "있다"만 주장한다. 없는 표식은 "모른다"다 — 조인 실패·결측·조회 실패·동결 모두
 * 표식 부재로 나가고(새 문구 없음), 사유는 계측 로그가 가른다.
 */
import {
  isApproxTransitLock,
  viaStopCurrentIndex,
  type TransitGuideLeg,
  type TransitGuideState,
} from "./transit-guide";
import { uniqueViaStopIndex, type TransitOverview, type TransitOverviewHere } from "./transit-progress-overview";

/** 결박 하나(riding 진입 × 열차)당 위치 조회 하한 상한 — 60초 주기로 30분. ⚠ 잠정값(실승차 판정). */
export const POSITION_LOOKUP_CAP_MIN = 30;
/** 마지막 관측 뒤 표식을 유지하는 창 — riding 미관측 주기 60초 × 3. ⚠ 잠정값. */
export const POSITION_HOLD_MS = 180_000;
/** 레코드 나이 상한(초) — 넘으면 동결 레코드라 관측으로 치지 않는다. ⚠ 잠정값. */
export const POSITION_MAX_AGE_SECONDS = 300;
/** 래치보다 뒤 역이 이만큼 연속으로 오면 그 역에서 다시 시작한다 — 튄 값 하나가 구간을 잠그지 않게. */
export const POSITION_BEHIND_RESTART = 2;
/** 노선 목록이 0행(INFO-200 — 운행 밖·미제공)으로 이만큼 연속이면 이 결박에선 그만 묻는다. */
export const POSITION_EMPTY_LINE_STOP = 3;

/** `/api/transit/position` 결과의 소비 형태. 429·5xx·네트워크 오류는 `failed`, 그 밖의 4xx는 `unsupported`. */
export type TransitPositionOutcome =
  | { kind: "found"; station: string; dataAgeSeconds: number | null }
  /** `lineEmpty`: 노선 목록 자체가 0행(INFO-200). 목록은 있는데 그 열차만 없으면 false. */
  | { kind: "notFound"; lineEmpty: boolean }
  | { kind: "unsupported" }
  | { kind: "failed" };

/** 결박 — 이 riding 진입(`phaseGen`)·이 구간·이 열차의 관측만 유효하다. 요청 시점에 떠서 응답과 함께 넘긴다. */
export interface TransitPositionBinding {
  legIndex: number;
  phaseGen: number;
  vehicleId: string;
}

export interface TransitRidingPosition extends TransitPositionBinding {
  /** 단조 래치 — 열차는 뒤로 가지 않는다. 관측 전·보존 창 만료 뒤는 null. */
  stopIndex: number | null;
  /** 마지막으로 래치를 확인·전진시킨 관측 시각(ms). */
  lastFoundAt: number | null;
  /** 결과를 받은 조회 수(실패는 세지 않는다 — 리듀서 `ridingPolls`와 같은 규칙). */
  lookups: number;
  /** 래치보다 뒤 역 관측의 연속 횟수. */
  behind: number;
  /** 노선 0행의 연속 횟수. */
  emptyLine: number;
  /** 이 결박에선 다시 묻지 않는다(미지원·노선 0행 연속). */
  stopped: boolean;
}

type PositionState = Pick<TransitGuideState, "legIndex" | "phase" | "phaseGen" | "signal" | "lock" | "currentLocation">;

/** 식별 잠금의 열차번호 — 근사·비관측 잠금(열차번호 없음)은 null. */
function lockedTrain(state: PositionState): string | null {
  const lock = state.lock;
  if (!lock || lock.mode !== "subway" || isApproxTransitLock(lock)) return null;
  return lock.vehicleId;
}

/** 지금 상태의 결박 — 식별 잠금이 없으면 null(위치 상태가 서지 않는다). */
export function positionBindingOf(state: PositionState): TransitPositionBinding | null {
  const vehicleId = lockedTrain(state);
  return vehicleId == null ? null : { legIndex: state.legIndex, phaseGen: state.phaseGen, vehicleId };
}

function sameBinding(a: TransitPositionBinding | null, b: TransitPositionBinding | null): boolean {
  return a != null && b != null && a.legIndex === b.legIndex && a.phaseGen === b.phaseGen && a.vehicleId === b.vehicleId;
}

/** 도착 피드가 아직 열차를 못 본 riding 신호 — 위치가 새 정보를 주는 유일한 구간(spec §5 ①). */
function isPreTracking(state: PositionState): boolean {
  return state.phase === "riding" && (state.signal === "notYetVisible" || state.signal === "neverSeen");
}

/** 결박당 조회 상한 — 구간 소요에 비례한다(긴 구간에서 도착 피드가 잡히기 전에 끊기지 않게, E36 유휴 상한과 같은 모양). */
export function positionLookupCap(leg: TransitGuideLeg): number {
  return Math.max(POSITION_LOOKUP_CAP_MIN, 2 * Math.max(0, leg.minutes ?? 0));
}

/** 켜는 조건(spec §5 ①). 폴 한 번에 최대 1회, 도착 조회·dispatch **뒤** 상태로 판정한다. */
export function positionLookupDue(
  state: PositionState,
  leg: TransitGuideLeg,
  position: TransitRidingPosition | null,
): boolean {
  if (!isPreTracking(state) || leg.trackMode !== "subway") return false;
  const binding = positionBindingOf(state);
  if (binding == null) return false;
  if (!position || !sameBinding(position, binding)) return true;
  return !position.stopped && position.lookups < positionLookupCap(leg);
}

/**
 * 조회 결과 한 건을 반영한다. `requested`는 **요청 시점**의 결박 — 지금 결박과 다르면 늦은 응답이라
 * 버린다(설계 리뷰 M1: 탑승 변경 뒤 옛 열차의 응답이 새 결박에 "새로 시작"으로 흡수되던 경로).
 */
export function ridingPositionStep(
  prev: TransitRidingPosition | null,
  state: PositionState,
  leg: TransitGuideLeg,
  requested: TransitPositionBinding,
  outcome: TransitPositionOutcome,
  now: number,
): TransitRidingPosition | null {
  const binding = positionBindingOf(state);
  if (binding == null) return null;
  if (!sameBinding(requested, binding)) return prev;
  let next: TransitRidingPosition =
    prev && sameBinding(prev, binding)
      ? { ...prev }
      : { ...binding, stopIndex: null, lastFoundAt: null, lookups: 0, behind: 0, emptyLine: 0, stopped: false };
  // 보존 창이 지난 래치는 버린다(설계 리뷰 M2) — 표시되지 않는 래치가 뒤의 진짜 관측을 막지 않게.
  if (next.lastFoundAt != null && now - next.lastFoundAt > POSITION_HOLD_MS) {
    next = { ...next, stopIndex: null, lastFoundAt: null, behind: 0 };
  }
  switch (outcome.kind) {
    case "failed":
      return next;
    case "unsupported":
      return { ...next, lookups: next.lookups + 1, stopped: true };
    case "notFound": {
      const emptyLine = outcome.lineEmpty ? next.emptyLine + 1 : 0;
      return { ...next, lookups: next.lookups + 1, emptyLine, stopped: emptyLine >= POSITION_EMPTY_LINE_STOP };
    }
    case "found": {
      next = { ...next, lookups: next.lookups + 1, emptyLine: 0 };
      const age = outcome.dataAgeSeconds;
      if (age == null || age > POSITION_MAX_AGE_SECONDS) return next;
      const index = uniqueViaStopIndex(leg, outcome.station);
      if (index == null) return next;
      if (next.stopIndex != null && index < next.stopIndex) {
        const behind = next.behind + 1;
        if (behind < POSITION_BEHIND_RESTART) return { ...next, behind };
      }
      return { ...next, stopIndex: index, lastFoundAt: now, behind: 0 };
    }
  }
}

/** 표식을 낼 수 있는 위치 index — 결박·riding·보존 창 안일 때만. */
export function positionShownIndex(
  state: PositionState,
  position: TransitRidingPosition | null,
  now: number,
): number | null {
  if (state.phase !== "riding" || !position || !sameBinding(position, positionBindingOf(state))) return null;
  if (position.stopIndex == null || position.lastFoundAt == null) return null;
  return now - position.lastFoundAt <= POSITION_HOLD_MS ? position.stopIndex : null;
}

/**
 * 도착 유래 index와 겨룰 위치 항. 보존 창 안이면 그 값. **인계 뒤**(도착 피드 추적 중)에는 도착 쪽이
 * 래치를 따라잡을 때까지 창과 무관하게 래치를 둔다(설계 리뷰 m1 — 조회가 꺼진 뒤 창이 지나면 표식이
 * 한 칸 뒤로 튀던 경로). 따라잡으면 큰 값이 도착 쪽이라 이 항은 자연히 빠진다.
 */
function positionTerm(
  state: PositionState,
  position: TransitRidingPosition | null,
  now: number,
  arrival: number | null,
): number | null {
  const shown = positionShownIndex(state, position, now);
  if (shown != null) return shown;
  if (
    arrival != null &&
    state.phase === "riding" &&
    state.signal === "tracking" &&
    position &&
    sameBinding(position, positionBindingOf(state)) &&
    position.stopIndex != null &&
    arrival < position.stopIndex
  ) {
    return position.stopIndex;
  }
  return null;
}

/**
 * 경유역 목록 표식 — 도착 유래(`arvlMsg3`, 현행)와 위치 유래 중 **큰 값**. 인계 순간 도착 쪽이
 * 한 역 뒤일 수 있어(위치 피드가 전역 출발에서 먼저 바뀐다) 작은 값을 고르면 표식이 뒤로 튄다.
 */
export function viaStopHereIndex(
  state: PositionState,
  leg: TransitGuideLeg,
  position: TransitRidingPosition | null,
  now: number,
): number | null {
  const arrival = viaStopCurrentIndex(leg, state.currentLocation);
  const located = positionTerm(state, position, now, arrival);
  if (arrival == null) return located;
  if (located == null) return arrival;
  return Math.max(arrival, located);
}

/**
 * 상태 문장이 신호 문장 대신 "현재 위치 {역}."을 말할 index(spec §6 판정 1). 도착 피드 미관측
 * 신호에서만 — 추적 중은 도착 조각이 이미 말하고, 소실·실패는 그 신호 문장이 정본이다.
 */
export function positionStatusIndex(
  state: PositionState,
  position: TransitRidingPosition | null,
  now: number,
): number | null {
  if (!isPreTracking(state)) return null;
  return positionShownIndex(state, position, now);
}

/**
 * 조망 후처리(spec §4 ⑥) — `transitProgressOverview`와 그 fixture는 그대로 두고 결과에 얹는다.
 * silence 행·`reboardOffered`는 불변(탈출구를 지우지 않는다).
 */
export function overviewApplyingPosition(
  overview: TransitOverview,
  state: PositionState,
  position: TransitRidingPosition | null,
  now: number,
): TransitOverview {
  let here: TransitOverviewHere = overview.here;
  if (here.kind === "station") {
    const located = positionTerm(state, position, now, here.stopIndex);
    if (located != null && located > here.stopIndex) here = { kind: "station", stopIndex: located };
  } else if (here.kind === "unknown" && here.reason === "noObservation") {
    const located = positionStatusIndex(state, position, now);
    if (located != null) here = { kind: "station", stopIndex: located };
  }
  if (here === overview.here) return overview;
  const hereIndex = here.kind === "station" ? here.stopIndex : -1;
  return {
    ...overview,
    here,
    rows: overview.rows.map((row) =>
      row.kind === "stop" ? { ...row, here: row.stopIndex === hereIndex } : row,
    ),
  };
}

/**
 * `neverSeen` 1회성 경고의 보류(spec §6 판정 2). 리듀서는 그 이벤트를 한 번만 낸다 — 그 순간 현재역이
 * 잡혀 있으면 오케스트레이터가 경고를 내지 않고 결박째 보류한다.
 */
export function neverSeenWarningDeferred(
  state: PositionState,
  position: TransitRidingPosition | null,
  now: number,
): TransitPositionBinding | null {
  if (state.signal !== "neverSeen" || positionStatusIndex(state, position, now) == null) return null;
  return positionBindingOf(state);
}

/**
 * 보류한 경고의 처분 — 폴마다 본다. 결박이 바뀌었거나(탑승 변경·다음 구간·선언 도착·새 riding 진입)
 * 신호가 `neverSeen`이 아니게 됐으면(추적 시작·소실·실패) **버린다**. 현재역이 사라졌으면(보존 창
 * 경과·조회 상한) 그때 **낸다**. 그 밖은 계속 보류.
 */
export function neverSeenPendingStep(
  pending: TransitPositionBinding,
  state: PositionState,
  position: TransitRidingPosition | null,
  now: number,
): "fire" | "keep" | "drop" {
  if (state.phase !== "riding" || state.signal !== "neverSeen") return "drop";
  if (!sameBinding(pending, positionBindingOf(state))) return "drop";
  return positionStatusIndex(state, position, now) == null ? "fire" : "keep";
}

/**
 * `/api/transit/position` 200 응답 → 소비 형태(Kit `TransitPositionService.outcome(from:)` 미러).
 * 알 수 없는 status·역명 없는 found는 판정 불가라 `failed`(표식을 만들지 않는다).
 */
export function positionOutcomeFromBody(body: unknown): TransitPositionOutcome {
  const b = (body ?? {}) as { status?: unknown; station?: unknown; dataAgeSeconds?: unknown; total?: unknown };
  switch (b.status) {
    case "found":
      return typeof b.station === "string" && b.station
        ? {
            kind: "found",
            station: b.station,
            dataAgeSeconds: typeof b.dataAgeSeconds === "number" ? b.dataAgeSeconds : null,
          }
        : { kind: "failed" };
    case "notFound":
      return { kind: "notFound", lineEmpty: b.total === 0 };
    case "unsupported":
      return { kind: "unsupported" };
    default:
      return { kind: "failed" };
  }
}

/**
 * 200이 아닌 응답의 분류(설계 리뷰 m4). 429·5xx는 일시적이라 `failed`(다음 폴에 다시 묻는다), 그 밖의
 * 4xx는 요청 자체가 이 결박에서 통하지 않는다는 뜻이라 `unsupported`(다시 물어도 같은 답이다 — 형식
 * 밖 열차번호가 30번 400을 받던 경로).
 */
export function positionOutcomeFromHttpStatus(status: number): TransitPositionOutcome {
  return status === 429 || status >= 500 || status < 400 ? { kind: "failed" } : { kind: "unsupported" };
}

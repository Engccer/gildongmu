/**
 * 대중교통 "진행 상황 조망" 순수 계층(E15-1, spec 2026-08-23 §3) — I/O 비의존.
 * Kit 미러: TransitProgressOverview.swift — 공유 fixture(transit-progress-overview-
 * scenarios.json)가 디스크립터 JSON 수준에서 동조를 강제한다. 문자열은 만들지
 * 않는다(i18n 렌더는 iOS 어댑터·향후 웹 패널의 몫).
 *
 * 불변식(설계 리뷰 2026-08-23): "지금 여기"는 **신선한 추적 관측**에서만 나온다 —
 * signal == tracking · 지하철 · 정규화 역명 유일 매칭. 소실·실패 중에 남아 있는
 * `currentLocation`은 마지막 관측값이라 표식하지 않는다(한 화면이 "위치를 모른다"와
 * "현재 위치는 X"를 동시에 주장하지 않게). 없는 표식은 거짓이 아니지만 있는 표식은
 * 거짓일 수 있다.
 */
import {
  normalizeStopName,
  type TransitGuideLeg,
  type TransitGuideRoute,
  type TransitGuideState,
  type TransitSignal,
} from "./transit-guide";

export type OverviewSilenceSignal = "neverSeen" | "notYetVisible" | "signalLost" | "upstreamFailed";

export type TransitOverviewHere =
  | { kind: "station"; stopIndex: number }
  | { kind: "notApplicable"; reason: "phase" | "bus" }
  | {
      kind: "unknown";
      reason: "noObservation" | "signalLost" | "upstreamFailed" | "ambiguous" | "arrivedUncertain";
    };

export type TransitOverviewRow =
  | { kind: "walk"; minutes: number }
  | {
      kind: "leg";
      legIndex: number;
      mode: "bus" | "subway";
      lineName: string;
      boardName: string;
      alightName: string;
      status: "done" | "current" | "upcoming";
      stationCount: number | null;
    }
  | { kind: "stop"; stopIndex: number; name: string; role: "board" | "via" | "alight"; here: boolean }
  /** 현재 구간 정차역 정보 없음 — 탑승 leg에 정차역 0개는 없으므로 빈 배열은 언제나 정보 없음. */
  | { kind: "stopsUnavailable" }
  | { kind: "silence"; signal: OverviewSilenceSignal };

export interface TransitOverview {
  legOrdinal: { n: number; count: number };
  rows: TransitOverviewRow[];
  here: TransitOverviewHere;
  /** 침묵 탈출구(탑승 변경) 행 — riding ∧ 비-tagoBus ∧ 침묵 신호(시트 술어 + 침묵). */
  reboardOffered: boolean;
  alternativesOffered: boolean;
}

/** silence 행·탈출구가 공유하는 신호 집합 — 둘이 같은 집합이라 탈출구는 언제나 silence 바로 뒤다. */
export const OVERVIEW_SILENCE_SIGNALS: readonly TransitSignal[] = [
  "notYetVisible",
  "neverSeen",
  "signalLost",
  "upstreamFailed",
];

/** 정규화 역명 매칭이 정확히 1건일 때만 인덱스 — 동명 정차(순환·반복)는 모호(null). */
export function uniqueViaStopIndex(leg: TransitGuideLeg, currentLocation: string | null): number | null {
  if (!currentLocation) return null;
  const target = normalizeStopName(currentLocation);
  if (!target) return null;
  const matches: number[] = [];
  leg.viaStops.forEach((s, i) => {
    if (normalizeStopName(s.name) === target) matches.push(i);
  });
  return matches.length === 1 ? matches[0] : null;
}

type HereInput = Pick<TransitGuideState, "phase" | "signal" | "currentLocation" | "arrivedCertain">;

export function transitOverviewHere(state: HereInput, leg: TransitGuideLeg): TransitOverviewHere {
  const { phase, signal } = state;
  if (phase === "waiting" || phase === "boarding" || phase === "done") {
    return { kind: "notApplicable", reason: "phase" };
  }
  if (phase === "arrived") {
    return state.arrivedCertain
      ? { kind: "notApplicable", reason: "phase" }
      : { kind: "unknown", reason: "arrivedUncertain" };
  }
  // riding
  if (leg.trackMode !== "subway") return { kind: "notApplicable", reason: "bus" };
  if (signal === "signalLost") return { kind: "unknown", reason: "signalLost" };
  if (signal === "upstreamFailed") return { kind: "unknown", reason: "upstreamFailed" };
  if (signal !== "tracking") return { kind: "unknown", reason: "noObservation" };
  const idx = uniqueViaStopIndex(leg, state.currentLocation);
  if (idx === null) {
    // 관측은 있는데 매칭이 0건(노선 밖 표기)이거나 2건 이상(동명)이다.
    const anyMatch = state.currentLocation
      ? leg.viaStops.some(
          (s) => normalizeStopName(s.name) === normalizeStopName(state.currentLocation ?? ""),
        )
      : false;
    return { kind: "unknown", reason: anyMatch ? "ambiguous" : "noObservation" };
  }
  return { kind: "station", stopIndex: idx };
}

function silenceSignal(state: HereInput): OverviewSilenceSignal | null {
  if (state.phase !== "riding") return null;
  return OVERVIEW_SILENCE_SIGNALS.includes(state.signal) ? (state.signal as OverviewSilenceSignal) : null;
}

type OverviewInput = Pick<
  TransitGuideState,
  "legIndex" | "phase" | "signal" | "currentLocation" | "arrivedCertain"
>;

export function transitProgressOverview(state: OverviewInput, route: TransitGuideRoute): TransitOverview {
  const count = route.legs.length;
  const current = Math.min(state.legIndex, Math.max(count - 1, 0));
  const leg = route.legs[current];
  const here = leg ? transitOverviewHere(state, leg) : { kind: "notApplicable" as const, reason: "phase" as const };
  const silence = silenceSignal(state);
  const rows: TransitOverviewRow[] = [];
  route.legs.forEach((l, i) => {
    if (l.walkBeforeMinutes !== null && l.walkBeforeMinutes > 0) {
      rows.push({ kind: "walk", minutes: l.walkBeforeMinutes });
    }
    const status: "done" | "current" | "upcoming" =
      state.phase === "done" || i < current ? "done" : i === current ? "current" : "upcoming";
    rows.push({
      kind: "leg",
      legIndex: i,
      mode: l.mode,
      lineName: l.lineName,
      boardName: l.boardName,
      alightName: l.alightName,
      status,
      stationCount: l.stationCount,
    });
    if (status !== "current") return;
    if (silence) rows.push({ kind: "silence", signal: silence });
    if (l.viaStops.length === 0) {
      rows.push({ kind: "stopsUnavailable" });
      return;
    }
    l.viaStops.forEach((s, si) => {
      rows.push({
        kind: "stop",
        stopIndex: si,
        name: s.name,
        role: si === 0 ? "board" : si === l.viaStops.length - 1 ? "alight" : "via",
        here: here.kind === "station" && here.stopIndex === si,
      });
    });
  });
  if (route.walkAfterMinutes !== null && route.walkAfterMinutes > 0) {
    rows.push({ kind: "walk", minutes: route.walkAfterMinutes });
  }
  const reboardOffered =
    state.phase === "riding" && leg?.trackMode !== "tagoBus" && leg?.trackMode !== null && silence !== null;
  return {
    legOrdinal: { n: current + 1, count },
    rows,
    here,
    reboardOffered,
    alternativesOffered: state.phase !== "done",
  };
}

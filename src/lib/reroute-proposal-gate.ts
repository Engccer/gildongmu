/**
 * 자동 재조회의 순수 판정(채택 시점 신선도·세션당 조회 상한). Kit `RerouteProposalGate.swift` ↔ `:kit`
 * `RerouteProposalGate.kt` 미러(E63 spec §3.9 — 웹도 `rerouteNeeded`에서 자동 조회·채택한다).
 *
 * 걷는 중 낡은 출발점의 경로를 채택하면 도로 중앙 안내가 되므로 `isFresh`는 채택 시점 1회 안전망이다. 이동 상한은
 * 수단별 데이터(`GuideTuning.rerouteMaxDriftM` — 도보 30m·자동차 150m)라 인자로 받는다.
 */
import { haversineMeters } from "./geo";
import { bearingDegrees, bearingToCompass8, type CompassDirection } from "./geo/bearing";

/** 신선도 시간 한계(초, 잠정 — 실보행 판정 대상). */
export const REROUTE_PROPOSAL_MAX_AGE_S = 120;
/** 세션당 자동 조회 상한(잠정). 실패가 이어진 한 회차가 다 쓰면 뒤 회차는 새 경로가 필요한 순간(`rerouteNeeded`) 버튼이 선다(E69 ⓑ). */
export const REROUTE_MAX_FETCHES_PER_SESSION = 5;

export interface RerouteProposal {
  originLat: number;
  originLng: number;
  /** 취득 시각(단조 초). */
  acquiredAt: number;
}

/** 취득 위치에서 `maxDriftMeters` 초과 이동 또는 120초 경과면 낡았다. */
export function isRerouteProposalFresh(
  proposal: RerouteProposal,
  now: number,
  current: { lat: number; lng: number },
  maxDriftMeters: number,
): boolean {
  if (now - proposal.acquiredAt > REROUTE_PROPOSAL_MAX_AGE_S) return false;
  return haversineMeters(proposal.originLat, proposal.originLng, current.lat, current.lng) <= maxDriftMeters;
}

/** 세션당 자동 조회 허용 여부. */
export function mayFetchReroute(sessionFetchCount: number): boolean {
  return sessionFetchCount < REROUTE_MAX_FETCHES_PER_SESSION;
}

/**
 * E69 ⓒ: 벗어난 채 이만큼 서 있으면 "경로 다시 조회" 버튼이 선다(초, 착수 기본값 — 실보행 판정 대상,
 * spec `2026-10-17-reroute-button-visibility-design.md` §1.2).
 */
export const REROUTE_BUTTON_STILL_S = 30;

/**
 * E69 ⓒ의 정지 연속 갱신. 새 정지 판정을 만들지 않고 `GuideFix.stopped`만 본다(E55 — `speedUnknown`은 정지가 아니라
 * 연속을 끊는다). `since`는 연속 시작 시각(없으면 null), `reached`는 이 fix에서 문턱에 닿았는가.
 */
export function rerouteStillStep(
  since: number | null,
  stopped: boolean,
  now: number,
): { since: number | null; reached: boolean } {
  if (!stopped) return { since: null, reached: false };
  const start = since ?? now;
  return { since: start, reached: now - start >= REROUTE_BUTTON_STILL_S };
}

// ── 새 경로 첫 점 검사(A70 spec 2026-10-19 §2) ─────────────────────────────────
// 신선도(`isRerouteProposalFresh`)는 **요청 지점 ↔ 현재 위치**만 본다. provider가 출발점을 멀리 붙이면(실보행 237m) 신선한
// 요청이 먼 경로를 낳는다 — 그 축은 **경로 첫 점 ↔ 현재 위치**다. 문턱은 같은 수단별 데이터 `rerouteMaxDriftM`.
// 공유 판정표 `route-start-gap-cases.json`(Kit·`:kit` 미러가 함께 읽는다).

type RouteStart = { polyline: { points: readonly { lat: number; lng: number }[] } };

/** 경로 첫 점까지의 직선거리(m). */
export function routeStartGapMeters(route: RouteStart, current: { lat: number; lng: number }): number {
  const p = route.polyline.points[0];
  return haversineMeters(current.lat, current.lng, p.lat, p.lng);
}

/** 자동 재조회 채택 자격: 첫 점이 `maxDriftMeters` 안인가. 밖이면 채택하지 않고 `none`과 같은 결말(E69 ⓐ). */
export function routeStartsNearby(
  route: RouteStart,
  current: { lat: number; lng: number },
  maxDriftMeters: number,
): boolean {
  return routeStartGapMeters(route, current) <= maxDriftMeters;
}

/**
 * 현재 위치에서 첫 점의 북 기준 8방위 — 사용자가 연 조회(시작·버튼 재조회·줄 전환)의 고지 문장(`guide.routeStartsAway`).
 * 진행 방위 기준 시계가 아닌 이유: 시작 순간엔 대개 관측이 없고, 상태 행에 남는 문장은 절대 방향이어야 나중에도 참이다(A57).
 */
export function routeStartCompass(route: RouteStart, from: { lat: number; lng: number }): CompassDirection {
  const p = route.polyline.points[0];
  return bearingToCompass8(bearingDegrees(from.lat, from.lng, p.lat, p.lng));
}

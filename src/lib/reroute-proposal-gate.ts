/**
 * 자동 재조회의 순수 판정(채택 시점 신선도·세션당 조회 상한). Kit `RerouteProposalGate.swift` ↔ `:kit`
 * `RerouteProposalGate.kt` 미러(E63 spec §3.9 — 웹도 `rerouteNeeded`에서 자동 조회·채택한다).
 *
 * 걷는 중 낡은 출발점의 경로를 채택하면 도로 중앙 안내가 되므로 `isFresh`는 채택 시점 1회 안전망이다. 이동 상한은
 * 수단별 데이터(`GuideTuning.rerouteMaxDriftM` — 도보 30m·자동차 150m)라 인자로 받는다.
 */
import { haversineMeters } from "./geo";

/** 신선도 시간 한계(초, 잠정 — 실보행 판정 대상). */
export const REROUTE_PROPOSAL_MAX_AGE_S = 120;
/** 세션당 자동 조회 상한(잠정). 실패가 이어진 한 회차가 다 쓰면 뒤 회차는 버튼만 갖는다. */
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

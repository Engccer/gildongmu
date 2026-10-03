import { describe, expect, it } from "vitest";
import {
  isRerouteProposalFresh,
  mayFetchReroute,
  REROUTE_MAX_FETCHES_PER_SESSION,
  REROUTE_PROPOSAL_MAX_AGE_S,
} from "../reroute-proposal-gate";
import { CAR_TUNING, WALK_TUNING } from "../route-guide";

// Kit RerouteProposalGateTests 미러(E63 — 이동 상한은 수단별 튜닝).
const origin = { originLat: 37.5, originLng: 127.1, acquiredAt: 100 };
const north = (m: number) => ({ lat: 37.5 + m / 111320, lng: 127.1 });

describe("reroute-proposal-gate", () => {
  it("도보는 30m, 자동차는 150m까지 신선하다", () => {
    expect(WALK_TUNING.rerouteMaxDriftM).toBe(30);
    expect(CAR_TUNING.rerouteMaxDriftM).toBe(150);
    expect(isRerouteProposalFresh(origin, 101, north(29), WALK_TUNING.rerouteMaxDriftM)).toBe(true);
    expect(isRerouteProposalFresh(origin, 101, north(31), WALK_TUNING.rerouteMaxDriftM)).toBe(false);
    expect(isRerouteProposalFresh(origin, 101, north(140), CAR_TUNING.rerouteMaxDriftM)).toBe(true);
    expect(isRerouteProposalFresh(origin, 101, north(160), CAR_TUNING.rerouteMaxDriftM)).toBe(false);
  });

  it("120초를 넘기면 제자리여도 낡았다", () => {
    expect(isRerouteProposalFresh(origin, 100 + REROUTE_PROPOSAL_MAX_AGE_S, north(0), 30)).toBe(true);
    expect(isRerouteProposalFresh(origin, 100 + REROUTE_PROPOSAL_MAX_AGE_S + 1, north(0), 30)).toBe(false);
  });

  it("세션당 5회", () => {
    expect(mayFetchReroute(REROUTE_MAX_FETCHES_PER_SESSION - 1)).toBe(true);
    expect(mayFetchReroute(REROUTE_MAX_FETCHES_PER_SESSION)).toBe(false);
  });
});

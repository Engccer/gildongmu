/**
 * E70 여정(택시 → 대중교통 → 택시) 전이 표 — Kit `journeyStep`(ios/GildongmuKit/Sources/GildongmuKit/Journey.swift)의 1:1 미러.
 * 웹 입구(E70-f, spec `2026-11-02-e70-web-journey-design.md` §7.2)가 쓴다. 공유 fixture
 * `src/lib/__tests__/fixtures/journey-step-cases.json`을 웹 vitest와 Kit `JourneyStepSharedTests`가 함께 읽는다.
 *
 * 순수 함수다(React·시계·측위 없음). 사건은 자기가 관측한 token(`journeyId`·`seq`)을 들고 오고, 지금 상태와 다르면 무시한다 —
 * 자동 도착 판정과 버튼이 같은 상태를 보고 둘 다 오면 첫 사건만 전이한다. `next`는 언제나 seq + 1.
 */

export type JourneyStage = "taxiIn" | "access" | "transit" | "egress" | "taxiOut";

export type JourneyPhase =
  /** 그 단계의 세션이 도는 중. */
  | { kind: "running"; stage: JourneyStage }
  /** 다음 세션을 준비하는 중(인계 지연·접근 도보 판정). */
  | { kind: "transitioning"; stage: JourneyStage }
  /** 그 단계를 시작하지 못했거나 중간에 끊긴 채 사용자의 결정을 기다리는 중. */
  | { kind: "failed"; stage: JourneyStage };

export interface JourneyShape {
  /** 승차 쪽을 지정해 택시 앞 구간이 있다(없으면 대중교통부터). */
  startsWithTaxi: boolean;
  /** 하차 쪽을 지정했다(아니면 대중교통 끝이 여정의 끝). */
  alightDesignated: boolean;
  /** 하차 뒤 출구·승강장까지 걷는 구간이 있다(후보 `none`이면 곧장 택시). */
  hasEgressWalk: boolean;
}

export interface JourneyToken {
  journeyId: string;
  seq: number;
}

export interface JourneyState {
  journeyId: string;
  shape: JourneyShape;
  phase: JourneyPhase;
  /** 전이마다 1씩 오른다. 시작 상태는 1. */
  seq: number;
}

/** 단계 세션이 끝난 사유 — 웹 신호의 매핑은 spec §7.3. */
export type JourneyStageEnd = "arrived" | "userStopped" | "startFailed" | "ended";

export type JourneyEvent =
  | { kind: "stageEnded"; reason: JourneyStageEnd }
  /** 「자동차에서 내렸어요」 */
  | { kind: "taxiDropped" }
  /** 「자동차에 탔어요」 */
  | { kind: "taxiBoarded" }
  /** 대중교통 마지막 탈것을 내렸다(말미 도보 유무와 무관). */
  | { kind: "rideCompleted" }
  /** 대중교통 세션이 완주 말고 끝났다. */
  | { kind: "transitStopped" }
  | { kind: "prepared"; stage: JourneyStage }
  | { kind: "prepFailed" }
  | { kind: "retry" }
  | { kind: "userEnded" }
  /** `transitioning`이 `JOURNEY_STALE_TRANSITION_MS`를 넘겼다. */
  | { kind: "staleTimeout" };

export type JourneyStepResult = { kind: "ignore" } | { kind: "next"; state: JourneyState } | { kind: "end" };

/** 접근 도보는 인계 시점 위치에서 승차 지점까지 직선이 이 값 이상일 때만(Kit `JourneyTuning.accessWalkMinMeters`). */
export const JOURNEY_ACCESS_WALK_MIN_M = 30;
/** 단계 사이 인계 지연(ms, Kit `handoffDelayMs`). */
export const JOURNEY_HANDOFF_DELAY_MS = 600;
/**
 * 접근 도보 시작 실패 뒤 다리 문장을 게시하고 대중교통을 시작하기까지의 여유(ms) — 웹 전용(spec §7.4).
 * iOS는 통지 끝을 기다리지만 웹 live region은 낭독 끝을 알 수 없다.
 */
export const JOURNEY_BRIDGE_DELAY_MS = 2500;
/** 사이 상태 상한(ms, Kit `staleTransitionSeconds` 30초). */
export const JOURNEY_STALE_TRANSITION_MS = 30_000;

export function journeyStart(journeyId: string, shape: JourneyShape): JourneyState {
  return {
    journeyId,
    shape,
    phase: { kind: "transitioning", stage: shape.startsWithTaxi ? "taxiIn" : "transit" },
    seq: 1,
  };
}

export function journeyToken(state: JourneyState): JourneyToken {
  return { journeyId: state.journeyId, seq: state.seq };
}

export function journeyStep(state: JourneyState, event: JourneyEvent, token: JourneyToken): JourneyStepResult {
  if (token.journeyId !== state.journeyId || token.seq !== state.seq) return { kind: "ignore" };
  if (event.kind === "userEnded") return { kind: "end" };

  const go = (phase: JourneyPhase): JourneyStepResult => ({
    kind: "next",
    state: { journeyId: state.journeyId, shape: state.shape, phase, seq: state.seq + 1 },
  });
  const transitioning = (stage: JourneyStage) => go({ kind: "transitioning", stage });
  const failed = (stage: JourneyStage) => go({ kind: "failed", stage });
  const ended = (reason: JourneyStageEnd) => event.kind === "stageEnded" && event.reason === reason;

  const { phase } = state;
  if (phase.kind === "running") {
    switch (phase.stage) {
      case "taxiIn":
        if (ended("arrived") || event.kind === "taxiDropped") return transitioning("access");
        if (ended("startFailed") || ended("ended")) return failed("taxiIn");
        if (ended("userStopped")) return { kind: "end" };
        return { kind: "ignore" };
      case "access":
        // 접근 도보는 도착·시작 실패·끊김 모두 대중교통으로 이어진다(역 근처라 대중교통 세션이 이어받는다).
        if (ended("arrived") || ended("startFailed") || ended("ended")) return transitioning("transit");
        if (ended("userStopped")) return { kind: "end" };
        return { kind: "ignore" };
      case "transit":
        if (event.kind === "rideCompleted") {
          if (!state.shape.alightDesignated) return { kind: "end" };
          return transitioning(state.shape.hasEgressWalk ? "egress" : "taxiOut");
        }
        if (event.kind === "transitStopped") return { kind: "end" };
        if (ended("startFailed")) return failed("transit");
        return { kind: "ignore" };
      case "egress":
        if (ended("arrived") || event.kind === "taxiBoarded") return transitioning("taxiOut");
        if (ended("startFailed") || ended("ended")) return failed("egress");
        if (ended("userStopped")) return { kind: "end" };
        return { kind: "ignore" };
      case "taxiOut":
        if (ended("startFailed")) return failed("taxiOut");
        if (event.kind === "stageEnded") return { kind: "end" };
        return { kind: "ignore" };
    }
  }

  if (phase.kind === "transitioning") {
    if (event.kind === "prepared") {
      if (event.stage === phase.stage) return go({ kind: "running", stage: phase.stage });
      // 30m 미만 접근 도보 생략
      if (phase.stage === "access" && event.stage === "transit") return go({ kind: "running", stage: "transit" });
      return { kind: "ignore" };
    }
    if (event.kind === "prepFailed" || event.kind === "staleTimeout") {
      // access 시작 실패는 막힌 화면이 아니라 대중교통 세션을 바로 시작한다.
      return phase.stage === "access" ? transitioning("transit") : failed(phase.stage);
    }
    return { kind: "ignore" };
  }

  // failed
  if (event.kind === "retry") return transitioning(phase.stage);
  if (phase.stage === "taxiIn" && event.kind === "taxiDropped") return transitioning("access");
  if (phase.stage === "egress" && event.kind === "taxiBoarded") return transitioning("taxiOut");
  return { kind: "ignore" };
}

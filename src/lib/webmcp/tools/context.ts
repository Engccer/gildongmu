/**
 * 도구 조립에 화면이 넘겨주는 계약(spec §8.3 "감싸지 않는다 — 부른다").
 *
 * 도구는 화면의 상태 **스냅샷**과 **핸들러**만 받는다. 새 fetch 경로를 만들지 않고,
 * 화면이 그리는 `results`와 도구가 돌려주는 결과는 같은 객체에서 나온다. 사람 문장
 * (스텝·대안 라벨·leg 한 줄)은 화면이 같은 `t`로 조립해 스냅샷에 실어 준다(§4.3).
 */
import type { DirEndpoint } from "@/lib/directions-state";
import type { ModeKey, ParsedTarget, RouteRefTable } from "../targets";

export type PhaseKind =
  | "idle"
  | "needEndpoints"
  | "locating"
  | "loading"
  | "geoError"
  | "outOfCoverage"
  | "settled";

/** 수단 하나의 조회 결과 3-state(화면 `ModeOutcome.kind` 그대로 — 뭉개지 않는다). */
export type ModeOutcomeKind = "done" | "empty" | "error" | "unsupportedWaypoint";

export interface PlanTransitLeg {
  /** 화면 번호(1-based). */
  n: number;
  mode: "walk" | "bus" | "subway";
  lineName?: string;
  fromName?: string;
  toName?: string;
  stationCount?: number;
  distanceMeters?: number;
  /** 빠른하차 문장(화면과 같은 `quickExitText`). 없으면 필드 부재. */
  quickExit?: string;
  targetId: string;
}

export interface PlanTransitRoute {
  routeKey: string;
  routeRef: string;
  /** disclosure 라벨의 이름 부분("추천 경로"·"가장 빠른 경로"…). */
  name: string;
  /** disclosure 라벨 전문(이름 + 요약) — 화면과 같은 문장. */
  oneLine: string;
  highlight?: string[];
  startable: boolean;
  summary: { totalMinutes: number; transfers: number; fare: number; walkMinutes: number };
  /** leg 한 줄 요약(화면 leg 문장과 같은 i18n 키, 태그는 평문). */
  legLines: string[];
  legs: PlanTransitLeg[];
}

export interface ToolPlan {
  planId: string;
  destination: string;
  resolved: { from: string; to: string; via: string | null; avoidStairs: boolean };
  routeRefs: RouteRefTable;
  /** 수단이 게이트를 통과하지 않았으면 null(출력에서 키 부재 = 제공하지 않는 수단). */
  transit: { outcome: ModeOutcomeKind; routes: PlanTransitRoute[] } | null;
  walk: {
    outcome: ModeOutcomeKind;
    /** 화면 요약문(`route.pedestrian.summary`). done일 때만. */
    summary?: string;
    distanceMeters?: number;
    durationSeconds?: number;
    stepFree?: string;
    stepFreeNotice?: string;
    /** 화면 `StepList` 항목과 같은 배열(번호 = 인덱스 + 1). */
    steps: string[];
    startable: boolean;
  } | null;
  car: {
    outcome: ModeOutcomeKind;
    /** 화면 요약문(`route.briefing.summary`). done일 때만. */
    summary?: string;
    distanceMeters?: number;
    durationSeconds?: number;
    steps: string[];
    startable: boolean;
  } | null;
  /** 화면 표시 순서의 수단(heading이 있는 것). */
  modes: ModeKey[];
}

export interface DirectionsSnapshot {
  fields: { from: string; to: string; via: string | null; avoidStairs: boolean };
  phase: PhaseKind;
  plan: ToolPlan | null;
  /** 후보 검색 언어(`dataLocale`). */
  lang: "ko" | "en";
}

export interface PlanRequest {
  from: DirEndpoint;
  to: DirEndpoint;
  via: DirEndpoint | null;
  avoidStairs: boolean;
}

export type QueryOutcome =
  | { kind: "settled"; planId: string }
  | { kind: "busy" }
  /** 안내 세션이 살아 있다 — 새 조회는 그 세션을 끊으므로 도구 경로에서는 거절한다. */
  | { kind: "sessionActive" }
  | { kind: "superseded" }
  | { kind: "aborted" }
  | { kind: "geoError"; reason: "denied" | "unavailable" | "timeout" }
  | { kind: "outOfCoverage" }
  | { kind: "needEndpoints" };

export interface DirectionsBridge {
  read: () => DirectionsSnapshot;
  /** 화면 정본 조회를 완전한 요청 스냅샷으로 실행하고 세대 결박 대기자로 완료를 기다린다. */
  runQuery: (request: PlanRequest, signal: AbortSignal) => Promise<QueryOutcome>;
  /**
   * 착지 대상이 접힌 disclosure 안이면 화면 핸들러로 펼친다(대상이 DOM에 나타나는 것은
   * 호출자가 기다린다). 펼칠 것이 없으면 아무것도 하지 않는다.
   */
  ensureVisible: (target: ParsedTarget) => void;
  /** 대중교통 경로 disclosure를 펼친다(`start_guidance` 전용 — 트리거가 펼침 안에 있다). */
  expandRoute: (routeRef: string) => void;
}

export interface HomeBridge {
  isDirectionsOpen: () => boolean;
  /** `to`는 필드 텍스트로만 채운다 — 해석·조회는 `plan_directions`의 몫. */
  openDirections: (toText: string | null) => void;
}

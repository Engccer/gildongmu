/**
 * 도구 조립에 화면이 넘겨주는 계약(spec §8.3 "감싸지 않는다 — 부른다").
 *
 * 도구는 화면의 상태 **스냅샷**과 **핸들러**만 받는다. 새 fetch 경로를 만들지 않고,
 * 화면이 그리는 `results`와 도구가 돌려주는 결과는 같은 객체에서 나온다. 사람 문장
 * (스텝·대안 라벨·leg 한 줄)은 화면이 같은 `t`로 조립해 스냅샷에 실어 준다(§4.3).
 */
import type { DirEndpoint } from "@/lib/directions-state";
import type { ArrivalItem } from "@/lib/place-lines/station-arrivals";
import type { MetroGroupItem } from "@/lib/place-lines/station-metro";
import type { TimetableLineItem } from "@/lib/place-lines/station-timetable";
import type { JusoAddress } from "@/lib/types";
import type { SearchSnapshot } from "../place-refs";
import type { ModeKey, RouteRefTable } from "../route-refs";
import type { Op } from "../tool-lock";

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
    /** 최단 대안(B9 ①, W1-R #1) — 화면의 "가장 짧은 경로" 행과 같은 배열. 없으면 필드 부재. */
    shortest?: { distanceMeters: number; durationSeconds: number; steps: string[] };
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
}

/* ───────────── 홈(검색) 브릿지(W2 spec §3.2·§5.2) ───────────── */

export interface SearchRequest {
  query: string;
  sort: "accuracy" | "review";
}
/** 세 분기(장소·주소·웹) 각각의 상태. `skipped`는 게이트·폴백 조건 미충족으로 발사하지 않은 것. */
export type BranchState = "pending" | "done" | "empty" | "error" | "skipped";
export interface HomeBranches {
  places: BranchState;
  addresses: BranchState;
  web: BranchState;
}
export type SearchOutcome =
  | { kind: "settled"; attempt: number; branches: HomeBranches }
  | { kind: "busy" }
  | { kind: "superseded" }
  | { kind: "aborted" };

export interface HomeBridge {
  read(): {
    /** 마지막으로 제출한 검색어(`staleResult` 복구용). */
    query: string;
    sort: "accuracy" | "review";
    attempt: number | null;
    branches: HomeBranches | null;
    counts: { places: number; addresses: number; web: number };
    chatOpen: boolean;
    webResults: Array<{ title: string; url: string; snippet: string }>;
  };
  /** 화면 정본 검색을 원자 호출로 실행하고 세 분기 정착을 기다린다(정착 시 스냅샷 동결). */
  runSearch(request: SearchRequest, op: Op): Promise<SearchOutcome>;
  /** 정착 시 동결한 결과 스냅샷 — `ref` 해석 표. 모르는 세대는 null. */
  snapshotFor(attempt: number): SearchSnapshot | null;
  /** 주소 카드 탭과 같은 경로(`/api/geocode` → Place 합성 → 상세). */
  openAddress(
    address: JusoAddress,
    op: Op,
  ): Promise<{ ok: true } | { ok: false; reason: "geocodeFailed" | "aborted" | "busy" }>;
}

/* ───────────── 장소 상세 브릿지(W2 spec §5.4) ───────────── */

/**
 * `get_place_info`의 축. `facilities`는 출처가 둘(코레일·서울)이라 소스 키가 둘이고 도구가
 * 하나의 축으로 합친다(`facilitiesMetro`는 도구 입력의 축 이름이 아니다).
 */
export type AxisKey = "basic" | "timetable" | "facilities" | "facilitiesMetro" | "arrivals" | "barrierFree";

export type AxisStatus =
  | "idle"
  | "loading"
  | "done"
  | "empty"
  | "unknown"
  | "error"
  | "notConfigured"
  | "notApplicable"
  | "partial";

/** 축별 `data` — 화면이 place-lines로 조립한 줄(도구는 i18n을 모른다). */
export interface StationMetaAxisData { lines: string[] }
export interface TimetableAxisData { basis: string; lines: TimetableLineItem[] }
export interface KorailFacilitiesAxisData { lines: string[] }
export interface MetroFacilitiesAxisData { groups: MetroGroupItem[]; supplementFailed?: boolean }
export interface ArrivalsAxisData { items: ArrivalItem[] }
export interface BarrierFreeAxisData {
  match: { kind: "matched"; facilityCount: number } | { kind: "unmatched" };
  facilities: Array<{ label: string; value: string }>;
  /** 출처 라벨(URL이 아니다 — spec §7). */
  source: string;
}
export type AxisData =
  | StationMetaAxisData
  | TimetableAxisData
  | KorailFacilitiesAxisData
  | MetroFacilitiesAxisData
  | ArrivalsAxisData
  | BarrierFreeAxisData;

export interface AxisSnapshot {
  status: AxisStatus;
  /** 요청 세대 — load마다 증가. 도구 대기자는 명령 시점 세대에 결박된다. */
  gen: number;
  data?: AxisData;
  /** `refresh` 실패 — `data`는 직전 성공분이다. */
  refreshError?: true;
}

/** 역 섹션 컴포넌트가 `useAxisBridge`로 채워 넣는 상태 소스 + 화면 핸들러. */
export interface AxisSource {
  read(): AxisSnapshot;
  /** 화면 버튼과 같은 핸들러. `source:"tool"`은 헤딩 착지만 건너뛴다(spec §6). */
  load(force: boolean, source: "user" | "tool"): void;
}

export type AxisOutcome =
  | { kind: "settled"; snapshot: AxisSnapshot }
  | { kind: "superseded" }
  | { kind: "aborted" }
  | { kind: "notConfigured" }
  | { kind: "notApplicable" };

/** `PlaceDetail`이 만드는 축 엔트리 — `present`는 부모 props에서 게시 시점에 확정된다. */
export interface AxisEntry {
  axis: AxisKey;
  present: boolean;
  kind: "mount" | "trigger";
  read(): AxisSnapshot;
  ensureLoaded(op: Op): Promise<AxisOutcome>;
  refresh(op: Op): Promise<AxisOutcome>;
}

export interface PlaceBridge {
  placeId: string;
  read(): {
    name: string;
    category: string;
    isStation: boolean;
    addressLines: { english?: string; road?: string; jibun?: string };
    phone?: string;
    chatOpen: boolean;
  };
  axes: Record<AxisKey, AxisEntry>;
}

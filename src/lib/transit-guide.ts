import type { QuickExit, TransitLeg, TransitLegStop, TransitRoute } from "./types";

/**
 * 대중교통 실시간 길 안내 상태 머신 (B2 스펙 §4.2) — 순수, React/Next 비의존.
 *
 * 입력은 GPS fix가 아니라 **폴링 응답·사용자 액션·시각**이다(도보·자동차의
 * route-guide 리듀서와 별개 — GuideKind 봉인 구성을 확장하지 않는다). 판정은
 * 전부 여기서 하고, 오케스트레이터(웹 useTransitGuide·iOS TransitGuideModel)는
 * 폴링 I/O·통지 게시만 한다. Kit `TransitGuide.swift`가 1:1 미러이며 공유
 * fixture(`transit-guide-scenarios.json`)가 동조를 강제한다.
 *
 * 핵심 계약:
 * - leg 전환은 사용자 확인(advance)이다. riding→arrived는 차량 신호 관측이고,
 *   arrived→다음 leg는 사용자 행위다(차량 도착 ≠ 사용자 하차, §1·§4.2).
 * - 신호 상태는 배타 enum — 데이터 없음(notYetVisible)과 조회 실패
 *   (upstreamFailed)를 절대 뭉개지 않는다(3-state 불변식의 세분).
 * - 잠금·매칭은 복합 키(§4.2), 식별자 원문 문자열 무변형.
 * - 폴링 응답은 phaseGen·seq 일치 시에만 커밋(늦은 응답 폐기 — 단일 비행의
 *   이중 방어).
 * - 낭독 문구 조립은 플랫폼 몫(웹 i18n·iOS GuideText) — 머신은 구조화 이벤트만
 *   낸다(E4 리듀서 관례). 완성 문장(message)은 서버가 준 대로 실어 나른다 — 여기서
 *   다시 파싱하지 않는다(서울버스 승차 국면은 서버가 이미 다듬었다,
 *   `transit-track.ts`의 `rewriteBusArrivalMessage`).
 */

export type TransitTrackMode = "seoulBus" | "tagoBus" | "subway";
/**
 * boarding(2026-08-22 N3): 차량을 골랐고 그 차량의 **승차 정류소 도착**을 기다린다.
 * 폴링 대상은 waiting과 같다(승차 정류소). riding 승격은 도착 관측 또는 사용자
 * 선언(confirmBoarded·restoreBoarding) 두 길뿐 — 미등장을 탑승으로 추론하지 않는다.
 */
export type TransitPhase = "waiting" | "boarding" | "riding" | "arrived" | "done";
export type TransitSignal =
  | "tracking"
  | "notYetVisible"
  /** 잠금 이후 한 번도 관측되지 않은 채 상한 경과(A16 L2) — signalLost와 원인이 다르다. */
  | "neverSeen"
  | "signalLost"
  | "upstreamFailed"
  | "untrackable";

/** 잠금·매칭 복합 키(§4.2). vehicleId "" = 근사 잠금(차량 식별자 부재, §13.2). */
export interface TransitLock {
  mode: TransitTrackMode;
  routeId: string;
  direction: string;
  vehicleId: string;
}

/**
 * 근사 잠금 판별(§13.2): tagoBus(식별자 자체가 없다)와 "이미 탑승했습니다"
 * (seoulBus·subway에서 식별자 없이 선언)가 같은 소비 한계를 상속한다 —
 * arrived 전이 금지·advance 상시·기준 차량 교체 통지·근사 주석.
 */
export function isApproxTransitLock(lock: TransitLock): boolean {
  return lock.vehicleId === "";
}

/** 안내 대상으로 조립된 탑승 leg(§4.1). 도보 leg는 대기 문맥으로 흡수된다. */
export interface TransitGuideLeg {
  mode: "bus" | "subway";
  lineName: string;
  /** null = 추적 불가(비수도권 지하철·정보 결손) — 수동 전진만 가능. */
  trackMode: TransitTrackMode | null;
  boardName: string;
  alightName: string;
  boardStop: TransitLegStop | null;
  alightStop: TransitLegStop | null;
  /** 경유 전체(양 끝 포함, includeStops 미보유 시 []) — 종착 검사(§5.1) 축. */
  viaStops: TransitLegStop[];
  stationCount: number | null;
  /** 서울버스 TOPIS 노선 ID(leg.serviceRouteId). */
  routeId: string | null;
  /** 지하철 방향(ODsay wayCode 1=상행·2=하행). */
  wayCode: number | null;
  /** 이 leg 앞의 도보 시간(분) — 대기 문맥("도보 N분 이동 후 …"). */
  walkBeforeMinutes: number | null;
  /** 하차역 빠른하차 문 위치(E5). 판정 불가·미커버는 undefined. */
  quickExit?: QuickExit;
}

export interface TransitGuideRoute {
  legs: TransitGuideLeg[];
  /** 마지막 하차 뒤 목적지까지 도보(분) — 완료 문구 분기(§4.1). */
  walkAfterMinutes: number | null;
}

/**
 * 폴링 항목(라우트 판별 union의 클라 투영, §7). message는 완성 문장이되 **upstream
 * 원문이라고 가정하지 말 것** — 서울버스 승차 국면은 서버가 잔여 꼬리를 떼고 어미를
 * 다듬어 내려보낸다. 이 안에서 브래킷 패턴을 다시 파싱하면 조용히 어긋난다.
 */
export interface TrackItem {
  vehicleId: string | null;
  direction: string;
  message: string;
  /** 잔여 정거장 수(§6.2 추출 — 서버 계산). 추출 실패는 null(사다리만 비활성). */
  remainingStops: number | null;
  destinationName: string | null;
  express: boolean;
  arrivalCode: string | null;
  /** 현재 위치 역명(지하철 arvlMsg3, §12.2) — 미제공 수단은 null. */
  currentLocation?: string | null;
  /** 데이터 수신 시각 원문(recptnDt, §12.1 스냅숏 정체성) — 미제공은 null. */
  dataStamp?: string | null;
  /** 데이터 나이(초, 서버 계산·클램프). null = 미제공 또는 동결 판정 불가(§12.1 ⓑ). */
  dataAgeSeconds?: number | null;
}

export type TrackPoll =
  | { kind: "ok"; items: TrackItem[] }
  | { kind: "empty" }
  | { kind: "unsupported" }
  | { kind: "failed" };

/** 대기 목록 0건 사유(§13.3): 진짜 0건 / 필터 전멸(rawCount>0) / 조회 실패·미지원. */
export type WaitingEmptyReason = "none" | "filtered" | "unavailable";

/** 대기 폴 결과 → 0건 사유 판정(§13.3). rawCount는 노선 필터 전 원시 건수. */
export function waitingEmptyReason(
  poll: TrackPoll,
  rawCount: number | null,
): WaitingEmptyReason | null {
  if (poll.kind === "ok" && poll.items.length > 0) return null;
  if (poll.kind === "empty" || poll.kind === "ok") {
    return (rawCount ?? 0) > 0 ? "filtered" : "none";
  }
  return "unavailable";
}

export type TransitInput =
  | { kind: "poll"; seq: number; phaseGen: number; poll: TrackPoll }
  | { kind: "board"; lock: TransitLock }
  /** boarding → riding 사용자 선언("탑승했습니다"). */
  | { kind: "confirmBoarded" }
  /** "탑승 변경 취소" — previousLock으로 previousPhase 복귀(종전 board(previousLock) 폐기). */
  | { kind: "restoreBoarding" }
  | { kind: "changeBoarding" }
  | { kind: "advance" };

/** riding 진입 경위 — observed=승차 정류소 도착 관측, declared=사용자 선언·근사 잠금. */
export type TransitBoardedCause = "observed" | "declared";

/**
 * 구조화 안내 이벤트 — 한 입력당 최대 1개(§4.2 원자 전이). 문구는 플랫폼이
 * 조립하되 완성 문장(message)은 원문 병치(문법 결합 금지, §6.1).
 */
export type TransitGuideEvent =
  | { kind: "boarded"; legIndex: number; cause: TransitBoardedCause }
  /** 차량 선택(boarding 진입) — 활성화 응답은 소비자가 .high로 낭독. */
  | { kind: "vehicleSelected"; legIndex: number }
  /** boarding: 선택 차량의 승차 정류소 접근(첫 관측 + 사다리 3·2·1). */
  | { kind: "approaching"; remaining: number | null; message: string }
  /** boarding: 잔여 ≤1에서 소실 — 지나갔을 수 있다. 국면 유지, 사용자 선택 요청. */
  | { kind: "vehiclePassed" }
  | { kind: "trackingStarted"; message: string; remaining: number | null }
  | { kind: "countdown"; remaining: number; message: string; currentLocation: string | null }
  | { kind: "messageChanged"; message: string }
  | { kind: "arrived"; certain: boolean }
  | { kind: "backOnTrack"; message: string }
  | { kind: "approxVehicleChanged"; message: string }
  | { kind: "signalLost" }
  | { kind: "neverSeen" }
  | { kind: "upstreamFailed" }
  | { kind: "signalRecovered" }
  | { kind: "legAdvanced"; legIndex: number; final: boolean }
  | { kind: "boardingReset" }
  | { kind: "capSlowed" };

export interface TransitStepResult {
  state: TransitGuideState;
  event: TransitGuideEvent | null;
}

export interface TransitGuideState {
  legIndex: number;
  phase: TransitPhase;
  /** phase 전이마다 증가 — 늦은 폴링 응답의 커밋 차단 축(§4.2). */
  phaseGen: number;
  /** 마지막으로 커밋한 폴링 seq(단조). */
  lastSeq: number;
  signal: TransitSignal;
  lock: TransitLock | null;
  /** 탑승 변경으로 해제한 직전 잠금(§13.1) — "탑승 변경 취소"의 복귀 대상. */
  previousLock: TransitLock | null;
  /** previousLock이 해제되기 전의 국면(boarding·riding) — restoreBoarding의 복귀 목적지. */
  previousPhase: TransitPhase | null;
  remaining: number | null;
  lastMessage: string | null;
  lastUpdatedAt: number | null;
  /** 잠금 항목의 현재 위치 역명(arvlMsg3, §12.2) — countdown 병치·M3 탑승 위치 축. */
  currentLocation: string | null;
  /** 잠금 항목의 recptnDt 원문(§12.1 스냅숏 정체성 — 동일 스냅숏 무정보 폴 판정). */
  dataStamp: string | null;
  /** 데이터 나이(초, 서버 계산). null = 미제공·동결 판정 불가(§12.1) — 표기 생략. */
  dataAgeSeconds: number | null;
  /** arrived 국면의 확정(도착 관측)/추정(소실) 구분 — 문구 3-state(§4.2). */
  arrivedCertain: boolean;
  /** 사다리 래치: 마지막 발화 잔여값(이보다 작아질 때만 재발화, 증가에 비가역). */
  ladderAnnounced: number | null;
  trackingAnnounced: boolean;
  /**
   * riding 진입 시각(ms). 한 번도 관측되지 않은 채 NEVER_SEEN_MS를 넘기면 neverSeen.
   * ⚠ null이면 판정하지 않는다 — "시각 불명"을 "방금 탔다"로도 "오래됐다"로도 읽지 않는다.
   */
  ridingSince: number | null;
  /** 잠금 차량 연속 미등장 폴 수(소실·도착 추정 판정). */
  missCount: number;
  failCount: number;
  failSince: number | null;
  pollCount: number;
  capAnnounced: boolean;
}

// === 상수 (§4.2·§7) ===

/** 사다리 임계(잔여 정거장) — 이하 도달 시 낭독, 초과 감소는 표시만(§6.1). */
export const LADDER_MAX = 3;
/** 조회 실패 통지: 연속 N회 또는 첫 실패 후 N초 중 먼저(§4.2). */
export const FAIL_NOTIFY_COUNT = 3;
export const FAIL_NOTIFY_MS = 90_000;
/** 소실 판정: 관측되다 연속 N폴 미등장(§4.2). */
export const MISS_LOST_COUNT = 3;
/** 도착 추정: 직전 잔여 ≤1 ∧ 연속 N폴 미등장(§4.2). */
export const MISS_ARRIVE_COUNT = 2;
/**
 * 첫 관측 전 미등장 상한(A16 L2). 관측된 뒤의 소실은 MISS_LOST_COUNT가 맡고,
 * 이 축은 "한 번도 못 본" 상태 전용이라 두 축이 같은 결함을 잡지 않는다.
 *
 * ⚠ 폴 횟수가 아니라 시간인 이유: 화면 잠금 중 폴 타이머가 멎으면 횟수 기반은
 * 화면을 끌수록 시한이 늦게 온다(실측 35분에 11폴, 주기 60초면 35폴이어야 한다).
 * ⚠ 10분은 잠정값 — 실승차 판정 대상(BACKLOG A16).
 */
export const NEVER_SEEN_MS = 600_000;
/** 세션 폴링 캡 — 도달 시 주기 강등 + 1회 통지(조용한 사망 금지, §7). */
export const SESSION_POLL_CAP = 240;
/**
 * boarding 도착 관측의 신선도 상한(초) — 서버 STALE_FROZEN_SECONDS와 같은 값. 종착
 * 코드(1·2)가 동결된 레코드는 선택 직후 폴에 "새 도착"으로 둔갑한다(설계 리뷰 C3).
 */
export const BOARD_STOP_FRESH_SECONDS = 120;

/** 폴링 주기(§7 적응형, M1 개정). 0 = 폴링 없음(done·untrackable). */
export function pollIntervalMs(state: TransitGuideState): number {
  if (state.phase === "done" || state.signal === "untrackable") return 0;
  if (state.capAnnounced) return 60_000;
  // boarding은 waiting과 같은 엔드포인트(승차 정류소)라 같은 주기.
  if (state.phase === "waiting" || state.phase === "boarding") return 20_000;
  // riding·arrived(재관측 감시): 미등장 60s / 추적 중 15s(§12 — 원거리 30s 폐지:
  // upstream이 이미 15~25초 낡아 폴 간격이 체감 지연의 가산 항이었다).
  return state.trackingAnnounced ? 15_000 : 60_000;
}

/** 이벤트 → 통지 채널·톤 매핑(§6.1). 웹·iOS 공용 의미론(발화 채널은 플랫폼 재량). */
export function eventProfile(event: TransitGuideEvent): {
  interrupt: boolean;
  tone: "start" | "ladder" | "imminent" | "arrive" | "weak" | null;
} {
  switch (event.kind) {
    case "countdown":
      return event.remaining <= 1
        ? { interrupt: true, tone: "imminent" }
        : { interrupt: false, tone: "ladder" };
    case "approaching":
      // 내 정류소에 거의 왔다 — 지금 움직여야 하는 신호(riding 사다리와 같은 축).
      return event.remaining != null && event.remaining <= 1
        ? { interrupt: true, tone: "imminent" }
        : { interrupt: false, tone: "ladder" };
    case "arrived":
      return { interrupt: true, tone: "arrive" };
    case "boarded":
      // 도착 관측은 "지금 타라"라 interrupting, 선언은 사용자 행동의 응답이라 기본.
      return { interrupt: event.cause === "observed", tone: "start" };
    case "legAdvanced":
      return { interrupt: false, tone: "start" };
    case "vehiclePassed":
      return { interrupt: false, tone: "weak" };
    case "trackingStarted":
      return { interrupt: false, tone: "ladder" };
    case "signalLost":
    case "neverSeen":
    case "upstreamFailed":
      return { interrupt: false, tone: "weak" };
    default:
      return { interrupt: false, tone: null };
  }
}

// === 노선 매핑표 (§5.1) — ODsay 지하철 lane.name ↔ 서울 실시간 subwayId ===

/**
 * ODsay는 "수도권 5호선"·"수도권 수인.분당선"처럼 접두·구분자가 붙는다.
 * 실시간 API 커버 노선(seoul-subway-arrival SUBWAY_LINES)과의 명시 대응표.
 * 키는 구분자·공백 제거 + "수도권" 접두 제거의 정규화 코어.
 */
const ODSAY_SUBWAY_LINES: Record<string, string> = {
  "1호선": "1001",
  "2호선": "1002",
  "3호선": "1003",
  "4호선": "1004",
  "5호선": "1005",
  "6호선": "1006",
  "7호선": "1007",
  "8호선": "1008",
  "9호선": "1009",
  "GTX-A": "1032",
  중앙선: "1061",
  경의중앙선: "1063",
  공항철도: "1065",
  경춘선: "1067",
  수인분당선: "1075",
  신분당선: "1077",
  경강선: "1081",
  우이신설선: "1092",
  서해선: "1093",
  신림선: "1094",
};

function subwayLineCore(name: string): string {
  return name
    .replace(/^수도권\s*/, "")
    .replace(/[.·\s]/g, "")
    .trim();
}

/** ODsay 지하철 노선명 → 서울 실시간 subwayId(미수록 = 실시간 미커버 = null). */
export function subwayIdForOdsayLine(lineName: string): string | null {
  return ODSAY_SUBWAY_LINES[subwayLineCore(lineName)] ?? null;
}

// === 경로 조립 (§4.1) ===

/** 탑승 leg의 추적 수단 분류(§5.1 매핑표·§5.2 판별자). */
export function classifyTrackMode(
  leg: TransitLeg,
  boardStop: TransitLegStop | null,
  alightStop: TransitLegStop | null,
): TransitTrackMode | null {
  if (leg.mode === "subway") {
    return subwayIdForOdsayLine(leg.lineName ?? "") ? "subway" : null;
  }
  // 서울버스(TOPIS): 양 끝 정류소가 서울(stationCityCode 1000) ∧ arsID·stId ∧
  // TOPIS 노선 ID 보유. arsID·localStationID는 지방 BIS도 채우므로 단독 판별 금지.
  const topis =
    leg.serviceRouteId != null &&
    boardStop?.cityCode === "1000" &&
    alightStop?.cityCode === "1000" &&
    !!boardStop.arsId &&
    !!boardStop.localId &&
    !!alightStop.localId;
  if (topis) return "seoulBus";
  // 지방버스 근사: 하차 정류소 좌표(TAGO 최근접 해석)와 노선 번호만 있으면 성립.
  if (alightStop && leg.lineName) return "tagoBus";
  return null;
}

/**
 * TransitRoute(+stops) → 안내 경로. 탑승 leg가 없으면 null(시작 게이트 축).
 * 도보 leg는 다음 탑승 leg의 walkBeforeMinutes로, 말미 도보는 walkAfterMinutes로.
 */
export function buildTransitGuideRoute(route: TransitRoute): TransitGuideRoute | null {
  const legs: TransitGuideLeg[] = [];
  let pendingWalk: number | null = null;
  for (const leg of route.legs) {
    if (leg.mode === "walk") {
      pendingWalk = (pendingWalk ?? 0) + leg.minutes;
      continue;
    }
    const stops = leg.stops ?? [];
    const boardStop = stops.length > 0 ? stops[0] : null;
    const alightStop = stops.length > 1 ? stops[stops.length - 1] : null;
    legs.push({
      mode: leg.mode,
      lineName: leg.lineName ?? "",
      trackMode: classifyTrackMode(leg, boardStop, alightStop),
      boardName: leg.fromName ?? boardStop?.name ?? "",
      alightName: leg.toName ?? alightStop?.name ?? "",
      boardStop,
      alightStop,
      viaStops: stops,
      stationCount: leg.stationCount ?? null,
      routeId: leg.serviceRouteId ?? null,
      wayCode: leg.serviceWayCode ?? null,
      walkBeforeMinutes: pendingWalk,
      ...(leg.quickExit ? { quickExit: leg.quickExit } : {}),
    });
    pendingWalk = null;
  }
  if (legs.length === 0) return null;
  return { legs, walkAfterMinutes: pendingWalk };
}

// === 열차 선택 목록 필터 (§5.1) — 순수 판정, UI가 소비 ===

export interface BoardingCandidate {
  item: TrackItem;
  /** 종착이 하차역 이전 — 결정적 미도달이라 활성화 차단(§5.1). */
  terminatesEarly: boolean;
  /** 급행 — 하차역 정차 여부 확인 라벨 병기(차단 금지). */
  express: boolean;
  /** 방향 판정 성공 여부 — 전체 0건이면 목록 앞에 "방면 확인" 안내(§5.1). */
  directionMatched: boolean;
}

/**
 * 2호선 계열 방향 표기. 내선·외선은 2호선 본선 순환과 두 지선(성수·신정)만 쓰고,
 * **그 계열의 종착 필드는 잔여 경로 판정에 쓸 수 없다**(실호출 2026-08-16).
 *
 * - 본선: 13개 역 52표본이 전부 `"성수"`인 **상수**라, 경유 목록에서 성수가
 *   하차역보다 앞선 구간이 통째로 오차단됐다. 닫힌 고리엔 종착 검사가 기대는
 *   전제("경유 순서 = 잔여 경로")가 없다 — 진행 방향 어느 역이든 앞에 있다.
 * - 지선: 종착이 `"성수지선"`·`"신도림지선"`(역명이 아님) 또는 `"신설동"`·`"까치산"`
 *   (그 지선의 종점)이라 어느 쪽도 하차역보다 앞설 수 없다. 지선은 선형이지만
 *   검사가 잡아낼 조기 종착이 애초에 존재하지 않아 제외해도 잃는 보호가 없다.
 */
function isLine2Direction(updnLine: string): boolean {
  return updnLine === "내선" || updnLine === "외선";
}

/**
 * wayCode(1 상행·2 하행) ↔ updnLine 원문 대응. **실호출로 확정한 표기만 판정**하고
 * 나머지는 유보한다(오필터가 과노출보다 나쁘다).
 *
 * 순환선 대응(내선=2·외선=1)은 2026-08-16 실호출로 확정했다: 순환선 반대편 4개 역
 * (을지로입구·강남·신도림·홍대입구)에서 뽑은 ODsay leg 8건이 방향별로 갈렸고,
 * 13개 역 도착 표본 52건의 직전 역(`currentLocation`)이 같은 순환 순서를 어긋남
 * 없이 따랐다.
 */
function directionMatchesWayCode(updnLine: string, wayCode: number | null): boolean | null {
  if (wayCode == null) return null;
  switch (updnLine) {
    case "상행":
    case "외선":
      return wayCode === 1;
    case "하행":
    case "내선":
      return wayCode === 2;
    default:
      return null;
  }
}

/**
 * 승차 목록 후보 판정(§5.1): 방향은 보조(전멸 시 전체 유지 — 오필터로 숨기는
 * 것이 과노출보다 나쁘다), 종착 검사만 결정적 차단.
 *
 * `directionUncertain`은 **"방향 축이 있는데 매칭이 전멸했다"**로 좁힌다(A17,
 * 2026-08-17). 후보 전원의 `direction`이 비어 있으면 그 수단(버스 — upstream이
 * 방향 필드를 주지 않는다)에는 방향 축 자체가 없는 것이라 uncertain이 아니다.
 * 종전엔 빈 문자열이 매칭 실패로 분류돼 **모든 버스 세션**에 "방면을 확인해
 * 주세요"가 붙었는데, 버스 목록엔 방면 정보가 실려 있지 않아 확인할 대상 없는
 * 지시문이었다(마을버스 강동01 실승차 계측, 대기 12폴 전부 uncertain).
 */
export function classifyBoardingCandidates(
  items: TrackItem[],
  leg: TransitGuideLeg,
): { candidates: BoardingCandidate[]; directionUncertain: boolean } {
  const decorated = items.map((item): BoardingCandidate => {
    const dir = directionMatchesWayCode(item.direction, leg.wayCode);
    return {
      item,
      // 2호선 계열은 종착 검사에서 제외한다 — 그 종착 필드가 판정 근거가
      // 아니라 오차단원이기 때문이다(isLine2Direction 주석에 표본).
      terminatesEarly: isLine2Direction(item.direction)
        ? false
        : terminatesBeforeAlight(item.destinationName, leg),
      express: item.express,
      directionMatched: dir === true,
    };
  });
  const anyMatched = decorated.some((c) => c.directionMatched);
  const hasDirectionAxis = decorated.some((c) => c.item.direction !== "");
  const candidates = anyMatched ? decorated.filter((c) => c.directionMatched) : decorated;
  return { candidates, directionUncertain: hasDirectionAxis && !anyMatched };
}

/** 역명 표기 차이 흡수(부역명 괄호·"역" 접미) — 종착 검사·현재 위치 매칭 공용. */
export function normalizeStopName(s: string): string {
  return s.replace(/\s*\([^)]*\)/g, "").replace(/역$/, "").trim();
}

/**
 * 종착역이 경유 목록에서 하차역보다 앞이면 그 열차는 하차역에 가지 않는다(§5.1).
 * 결정적 판정이므로 활성화 차단 근거. 목록에 없는 종착(노선 밖·표기 상이)은
 * 판정 불가라 차단하지 않는다(오차단이 과노출보다 나쁘다).
 */
export function terminatesBeforeAlight(
  destinationName: string | null,
  leg: TransitGuideLeg,
): boolean {
  if (!destinationName || leg.viaStops.length === 0) return false;
  const dest = normalizeStopName(destinationName);
  const destIdx = leg.viaStops.findIndex((s) => normalizeStopName(s.name) === dest);
  const alightIdx = leg.viaStops.findIndex(
    (s) => normalizeStopName(s.name) === normalizeStopName(leg.alightName),
  );
  if (destIdx < 0 || alightIdx < 0) return false;
  return destIdx < alightIdx;
}

/**
 * 경유 목록에서 현재 위치 역명(arvlMsg3, §12.2)의 인덱스(§14.1 경유역 탑승 위치).
 * 지하철 잠금 추적에서만 값이 오고, 미매칭(노선 밖 표기·버스)은 무표기가 정답이라
 * null. 표기 차이는 종착 검사와 같은 정규화로 흡수한다.
 */
export function viaStopCurrentIndex(
  leg: TransitGuideLeg,
  currentLocation: string | null,
): number | null {
  if (!currentLocation) return null;
  const target = normalizeStopName(currentLocation);
  if (!target) return null;
  const idx = leg.viaStops.findIndex((s) => normalizeStopName(s.name) === target);
  return idx >= 0 ? idx : null;
}

// === 상태 머신 ===

/** 세션 시작 상태 — legIndex 0의 waiting. 시작 통지는 오케스트레이터 몫. */
export function initTransitGuide(route: TransitGuideRoute, _now: number): TransitGuideState {
  return {
    legIndex: 0,
    phase: "waiting",
    phaseGen: 0,
    lastSeq: 0,
    signal: route.legs[0]?.trackMode ? "notYetVisible" : "untrackable",
    lock: null,
    previousLock: null,
    previousPhase: null,
    remaining: null,
    lastMessage: null,
    lastUpdatedAt: null,
    currentLocation: null,
    dataStamp: null,
    dataAgeSeconds: null,
    arrivedCertain: false,
    ladderAnnounced: null,
    trackingAnnounced: false,
    ridingSince: null,
    missCount: 0,
    failCount: 0,
    failSince: null,
    pollCount: 0,
    capAnnounced: false,
  };
}

/** 복합 키 매칭(§4.2): 식별자 원문 동일 ∧ 방향(양측 보유 시) 동일. */
export function lockMatches(item: TrackItem, lock: TransitLock): boolean {
  if (!item.vehicleId || item.vehicleId !== lock.vehicleId) return false;
  if (item.direction && lock.direction && item.direction !== lock.direction) return false;
  return true;
}

export function transitGuideStep(
  state: TransitGuideState,
  input: TransitInput,
  route: TransitGuideRoute,
  now: number,
): TransitStepResult {
  switch (input.kind) {
    case "board":
      return handleBoard(state, input.lock, now);
    case "confirmBoarded":
      return handleConfirmBoarded(state, now);
    case "restoreBoarding":
      return handleRestoreBoarding(state, now);
    case "changeBoarding":
      return handleChangeBoarding(state);
    case "advance":
      return handleAdvance(state, route);
    case "poll":
      return handlePoll(state, input, route, now);
  }
}

/**
 * 잠금 추적 필드 초기화(국면 진입 공용). failCount/failSince도 함께 비운다 — 폴링
 * 대상이 바뀌는 전이(boarding→riding)에서 이전 대상의 실패 이력을 이월하면 새 대상
 * 첫 실패가 곧장 upstreamFailed가 된다(설계 리뷰 M6).
 */
function resetLockTracking(state: TransitGuideState): TransitGuideState {
  return {
    ...state,
    remaining: null,
    lastMessage: null,
    lastUpdatedAt: null,
    currentLocation: null,
    dataStamp: null,
    dataAgeSeconds: null,
    arrivedCertain: false,
    ladderAnnounced: null,
    trackingAnnounced: false,
    missCount: 0,
    failCount: 0,
    failSince: null,
  };
}

/** riding 진입 — ridingSince(미관측 상한 기준점, A16 L2)를 새로 찍는다. */
function enterRiding(
  state: TransitGuideState,
  lock: TransitLock,
  cause: TransitBoardedCause,
  now: number,
): TransitStepResult {
  return {
    state: {
      ...resetLockTracking(state),
      phase: "riding",
      phaseGen: state.phaseGen + 1,
      signal: "notYetVisible",
      lock,
      previousLock: null,
      previousPhase: null,
      ridingSince: now,
    },
    event: { kind: "boarded", legIndex: state.legIndex, cause },
  };
}

/** boarding 진입 — 승차 정류소 폴링은 계속되므로 ridingSince는 없다. */
function enterBoarding(state: TransitGuideState, lock: TransitLock): TransitStepResult {
  return {
    state: {
      ...resetLockTracking(state),
      phase: "boarding",
      phaseGen: state.phaseGen + 1,
      signal: "notYetVisible",
      lock,
      previousLock: null,
      previousPhase: null,
      ridingSince: null,
    },
    event: { kind: "vehicleSelected", legIndex: state.legIndex },
  };
}

/**
 * "탑승" = 차량 선택(N3). 근사 잠금(tagoBus·"이미 탑승했습니다")만 종전대로 riding —
 * 식별자가 없어 고를 차량도, 기다릴 도착도 없다.
 */
function handleBoard(
  state: TransitGuideState,
  lock: TransitLock,
  now: number,
): TransitStepResult {
  if (state.phase !== "waiting" || state.signal === "untrackable") {
    return { state, event: null };
  }
  return isApproxTransitLock(lock) ? enterRiding(state, lock, "declared", now) : enterBoarding(state, lock);
}

function handleConfirmBoarded(state: TransitGuideState, now: number): TransitStepResult {
  if (state.phase !== "boarding" || state.lock == null) return { state, event: null };
  return enterRiding(state, state.lock, "declared", now);
}

/** 탑승 변경 취소 — 해제 전 국면으로 복귀(boarding이면 다시 승차 정류소 대기). */
function handleRestoreBoarding(state: TransitGuideState, now: number): TransitStepResult {
  if (state.phase !== "waiting" || state.previousLock == null) return { state, event: null };
  const lock = state.previousLock;
  if (state.previousPhase === "boarding") return enterBoarding(state, lock);
  return enterRiding(state, lock, "declared", now);
}

function handleChangeBoarding(state: TransitGuideState): TransitStepResult {
  if (state.phase !== "boarding" && state.phase !== "riding" && state.phase !== "arrived") {
    return { state, event: null };
  }
  return {
    state: {
      ...state,
      phase: "waiting",
      phaseGen: state.phaseGen + 1,
      lock: null,
      // 직전 잠금·국면 보존(§13.1) — "탑승 변경 취소"(restoreBoarding)의 복귀 대상.
      previousLock: state.lock,
      previousPhase: state.phase === "boarding" ? "boarding" : "riding",
      remaining: null,
      lastMessage: null,
      currentLocation: null,
      dataStamp: null,
      dataAgeSeconds: null,
      arrivedCertain: false,
      ladderAnnounced: null,
      trackingAnnounced: false,
      // 대기 국면엔 기준점이 없다 — 다음 board가 새로 찍는다.
      ridingSince: null,
      missCount: 0,
    },
    event: { kind: "boardingReset" },
  };
}

/** advance가 유효한 국면(§4.2): arrived 확인 / 추적 불가 수동 전진 / 근사 잠금 상시(§13.2). */
function canAdvance(state: TransitGuideState, _route: TransitGuideRoute): boolean {
  if (state.phase === "arrived") return true;
  if (state.signal === "untrackable") return true;
  return state.phase === "riding" && state.lock != null && isApproxTransitLock(state.lock);
}

/**
 * 다음 구간 전환 — 사용자 확인(§4.2 원자 전이). done까지 한 스텝.
 * 유효 국면 밖(waiting 미탑승·잠금형 riding)의 advance는 no-op — UI 버튼 노출
 * 조건에만 의존하면 웹·iOS가 같은 가드를 따로 재구현해 드리프트한다(독립 리뷰).
 */
function handleAdvance(state: TransitGuideState, route: TransitGuideRoute): TransitStepResult {
  if (state.phase === "done" || !canAdvance(state, route)) return { state, event: null };
  const nextIndex = state.legIndex + 1;
  const final = nextIndex >= route.legs.length;
  const nextLeg = final ? null : route.legs[nextIndex];
  return {
    state: {
      ...state,
      legIndex: final ? state.legIndex : nextIndex,
      phase: final ? "done" : "waiting",
      phaseGen: state.phaseGen + 1,
      signal: final ? state.signal : nextLeg?.trackMode ? "notYetVisible" : "untrackable",
      lock: null,
      previousLock: null,
      previousPhase: null,
      remaining: null,
      lastMessage: null,
      lastUpdatedAt: null,
      currentLocation: null,
      dataStamp: null,
      dataAgeSeconds: null,
      arrivedCertain: false,
      ladderAnnounced: null,
      trackingAnnounced: false,
      ridingSince: null,
      missCount: 0,
      failCount: 0,
      failSince: null,
    },
    event: { kind: "legAdvanced", legIndex: final ? state.legIndex : nextIndex, final },
  };
}

function handlePoll(
  state: TransitGuideState,
  input: { seq: number; phaseGen: number; poll: TrackPoll },
  route: TransitGuideRoute,
  now: number,
): TransitStepResult {
  // 세대·순번 불일치 — 늦은 응답 폐기(§4.2). 단일 비행의 이중 방어라 조용히 무시.
  if (input.phaseGen !== state.phaseGen || input.seq <= state.lastSeq) {
    return { state, event: null };
  }
  if (state.phase === "done" || state.signal === "untrackable") {
    return { state, event: null };
  }

  const next: TransitGuideState = { ...state, lastSeq: input.seq, pollCount: state.pollCount + 1 };
  let event: TransitGuideEvent | null = null;

  // 폴링 캡(§7): 도달 시 주기 강등을 1회 알린다(조용한 사망 금지).
  if (!next.capAnnounced && next.pollCount >= SESSION_POLL_CAP) {
    next.capAnnounced = true;
    event = { kind: "capSlowed" };
  }

  const poll = input.poll;
  if (poll.kind === "failed" || poll.kind === "unsupported") {
    // unsupported가 세션 중간에 오는 것은 구성 불일치 — 실패와 동일한 정직 강등.
    next.failCount += 1;
    next.failSince = next.failSince ?? now;
    const notify =
      next.signal !== "upstreamFailed" &&
      (next.failCount >= FAIL_NOTIFY_COUNT || now - next.failSince >= FAIL_NOTIFY_MS);
    if (notify) {
      next.signal = "upstreamFailed";
      return { state: next, event: { kind: "upstreamFailed" } };
    }
    return { state: next, event };
  }

  // ok·empty — 실패 카운터 리셋 + 회복 통지(있다면 이번 스텝의 이벤트로 우선).
  const recovered = next.signal === "upstreamFailed";
  next.failCount = 0;
  next.failSince = null;
  if (recovered) {
    next.signal = state.trackingAnnounced ? "signalLost" : "notYetVisible";
    event = { kind: "signalRecovered" };
  }

  if (state.phase === "waiting") {
    // 대기 목록은 오케스트레이터가 직접 소비(§4.2) — 머신은 갱신 시각만 기록.
    next.lastUpdatedAt = now;
    return { state: next, event };
  }

  const items = poll.kind === "ok" ? poll.items : [];
  const lock = state.lock;
  const matched = lock ? findLockedItem(items, lock) : null;

  if (state.phase === "boarding") {
    return matched
      ? commitBoardingMatched(next, matched, event, now)
      : boardingUnmatched(next, event, now);
  }

  if (matched) {
    return commitMatched(next, matched, event, now);
  }

  // 미등장 — 잠금 차량이 목록에 없다(멀거나·지나갔거나·오선택).
  if (!next.trackingAnnounced) {
    // 아직 한 번도 관측 전: 정상 미등장(도착 API는 근접 차량만 담는다, §5.2).
    // ⚠ neverSeen을 이 목록에서 빼면 매 폴마다 notYetVisible로 되돌아가 아래
    // 1회성 가드가 무력화된다(반복 발화). 확정된 신호는 여기서 덮지 않는다.
    if (
      next.signal !== "upstreamFailed" &&
      next.signal !== "signalLost" &&
      next.signal !== "neverSeen"
    ) {
      next.signal = "notYetVisible";
    }
    next.lastUpdatedAt = now;
    // 그러나 그 상태를 빠져나오는 문이 있어야 한다(A16 L2). 종전에는 여기서
    // 바로 반환해 missCount가 오르지 않았고, 그래서 signalLost 임계에 도달할
    // 산술적 경로가 없어 침묵이 무한했다(실측 35분).
    //
    // 판정하지 않는 경우 셋:
    //  - recovered: 방금 조회가 살아난 폴이다. 최소 한 번은 실제로 보고 나서
    //    말한다(그리고 signalRecovered 이벤트를 덮지 않는다 — 입력당 1이벤트).
    //  - signal !== notYetVisible: 원인이 다른 신호(upstreamFailed·signalLost)와
    //    이미 확정된 자기 자신을 배제한다(1회성).
    //  - ridingSince == null: 기준 시각 불명이면 판정 자격이 없다.
    //
    // ⚠ 변이 주입 실측(2026-08-16)으로 각 조건의 검증 수단이 갈렸다:
    // recovered·확정 신호 보존은 fixture가, ridingSince는 **타입 검사**가 잡는다
    // (제거하면 TS18047). 반면 phase === "riding"은 어느 게이트도 잡지 못한다 —
    // 위 waiting 조기 반환 때문에 현재 도달 불가한 방어다. 지우지 않는 이유는
    // 이 축의 불변식("riding 전용")을 다른 블록의 조기 반환에 의존하지 않고
    // 여기서 자립적으로 표현하기 위해서이고, 검증된 가드가 아니라는 사실을
    // 여기 적어 두어 다음 사람이 오해하지 않게 한다.
    if (
      !recovered &&
      next.signal === "notYetVisible" &&
      next.phase === "riding" &&
      next.ridingSince != null &&
      now - next.ridingSince >= NEVER_SEEN_MS
    ) {
      next.signal = "neverSeen";
      return { state: next, event: { kind: "neverSeen" } };
    }
    return { state: next, event };
  }
  next.missCount += 1;
  next.lastUpdatedAt = now;
  // 도착 추정(§4.2): 직전 잔여 ≤1에서 소실 — 확정과 문구 구분, 가역(재관측 복귀).
  // 근사 잠금은 제외(§13.2 소비 한계 — 식별자가 없어 "소실"이 하차 신호가 아니다).
  if (
    state.phase === "riding" &&
    state.remaining != null &&
    state.remaining <= 1 &&
    next.missCount >= MISS_ARRIVE_COUNT &&
    lock != null &&
    !isApproxTransitLock(lock)
  ) {
    next.phase = "arrived";
    next.phaseGen = state.phaseGen; // poll 커밋 축은 유지(재관측 감시 계속)
    next.arrivedCertain = false;
    return { state: next, event: { kind: "arrived", certain: false } };
  }
  if (next.missCount >= MISS_LOST_COUNT && next.signal !== "signalLost") {
    next.signal = "signalLost";
    return { state: next, event: { kind: "signalLost" } };
  }
  return { state: next, event };
}

/**
 * boarding 매칭(승차 정류소 기준 도착 정보, N3 spec §3.3). riding의 commitMatched와
 * 달리 ①동일 스냅숏도 missCount를 올리고(동결 레코드가 국면을 영구 고착시키는 것을
 * 막는다 — 이 국면엔 neverSeen 시간축이 없다) ②도착 관측이 riding 승격이다.
 */
function commitBoardingMatched(
  base: TransitGuideState,
  item: TrackItem,
  carriedEvent: TransitGuideEvent | null,
  now: number,
): TransitStepResult {
  const stamp = item.dataStamp ?? null;
  if (stamp != null && stamp === base.dataStamp && item.message === base.lastMessage) {
    return {
      state: {
        ...base,
        missCount: base.missCount + 1,
        lastUpdatedAt: now,
        dataAgeSeconds: item.dataAgeSeconds ?? null,
      },
      event: carriedEvent,
    };
  }
  const prevRemaining = base.remaining;
  const wasTracking = base.trackingAnnounced;
  const next: TransitGuideState = {
    ...base,
    signal: "tracking",
    missCount: 0,
    remaining: item.remainingStops,
    lastMessage: item.message,
    lastUpdatedAt: now,
    currentLocation: item.currentLocation ?? null,
    dataStamp: stamp,
    dataAgeSeconds: stamp != null && stamp === base.dataStamp ? null : (item.dataAgeSeconds ?? null),
    trackingAnnounced: true,
  };

  // 도착 관측 = riding 승격. 서울버스 잔여 0("곧 도착"·구조 필드) / 지하철 진입 0·도착 1.
  // 출발 2는 제외 — 이미 떠난 열차에 "탑승하세요"를 말하지 않는다. 동결 레코드
  // (나이 > BOARD_STOP_FRESH_SECONDS)는 도착으로 보지 않는다(설계 리뷰 C3·M1).
  const fresh = item.dataAgeSeconds == null || item.dataAgeSeconds <= BOARD_STOP_FRESH_SECONDS;
  const arrivedAtBoardStop =
    base.lock?.mode === "subway"
      ? item.arrivalCode === "0" || item.arrivalCode === "1"
      : base.lock?.mode === "seoulBus"
        ? item.remainingStops === 0
        : false;
  if (base.lock != null && fresh && arrivedAtBoardStop) {
    return enterRiding(next, base.lock, "observed", now);
  }

  // 첫 관측 — signalLost 뒤의 재발견도 이 문장이 이긴다(문장 자체가 "찾았다", 리뷰 M4).
  if (!wasTracking) {
    next.ladderAnnounced = item.remainingStops;
    return {
      state: next,
      event: { kind: "approaching", remaining: item.remainingStops, message: item.message },
    };
  }
  const remaining = item.remainingStops;
  if (remaining == null) {
    if (item.message !== base.lastMessage && base.lastMessage !== null) {
      return { state: next, event: { kind: "messageChanged", message: item.message } };
    }
    return { state: next, event: carriedEvent };
  }
  const latch = next.ladderAnnounced;
  if (
    remaining <= LADDER_MAX &&
    remaining >= 0 &&
    (latch == null || remaining < latch) &&
    prevRemaining != null &&
    remaining < prevRemaining
  ) {
    next.ladderAnnounced = remaining;
    return { state: next, event: { kind: "approaching", remaining, message: item.message } };
  }
  if (base.signal === "signalLost" && carriedEvent === null) {
    return { state: next, event: { kind: "signalRecovered" } };
  }
  return { state: next, event: carriedEvent };
}

/**
 * boarding 미등장 — 선택 시점에 목록에 있던 차량이라 첫 관측 전에도 센다. 잔여 ≤1에서
 * 사라지면 "지나갔을 수 있다"(vehiclePassed)이지 탑승이 아니다(설계 리뷰 C2). 어느
 * 쪽이든 signalLost 상태로 떨어져 1회만 말하고, 탈출은 사용자 선택(탑승했습니다 /
 * 다른 차량 선택)이다.
 */
function boardingUnmatched(
  base: TransitGuideState,
  carriedEvent: TransitGuideEvent | null,
  now: number,
): TransitStepResult {
  const next: TransitGuideState = { ...base, missCount: base.missCount + 1, lastUpdatedAt: now };
  if (next.signal === "signalLost") return { state: next, event: carriedEvent };
  if (base.remaining != null && base.remaining <= 1 && next.missCount >= MISS_ARRIVE_COUNT) {
    next.signal = "signalLost";
    return { state: next, event: { kind: "vehiclePassed" } };
  }
  if (next.missCount >= MISS_LOST_COUNT) {
    next.signal = "signalLost";
    return { state: next, event: { kind: "signalLost" } };
  }
  return { state: next, event: carriedEvent };
}

function findLockedItem(items: TrackItem[], lock: TransitLock): TrackItem | null {
  if (isApproxTransitLock(lock)) {
    // 근사(§5.2·§13.2): 방향 일치(양측 보유 시) 항목 중 최근접 접근 차량(잔여 최소).
    // tagoBus는 방향이 ""라 무필터 — 기존 행동 불변.
    const pool = items.filter(
      (it) => !lock.direction || !it.direction || it.direction === lock.direction,
    );
    let best: TrackItem | null = null;
    for (const it of pool) {
      if (it.remainingStops == null) continue;
      if (best == null || it.remainingStops < (best.remainingStops ?? Infinity)) best = it;
    }
    return best ?? (pool.length > 0 ? pool[0] : null);
  }
  return items.find((it) => lockMatches(it, lock)) ?? null;
}

function commitMatched(
  base: TransitGuideState,
  item: TrackItem,
  carriedEvent: TransitGuideEvent | null,
  now: number,
): TransitStepResult {
  const prevRemaining = base.remaining;
  const wasTracking = base.trackingAnnounced;

  // 동일 스냅숏 무정보 폴(§12.1): 잠금 항목의 recptnDt와 완성 문장이 직전 커밋과
  // 같으면 새 정보가 없다 — phase·signal 불변, 이벤트 없음(동결 레코드 재등장이
  // backOnTrack·재발화로 이어지는 경로 차단). ⚠ 문장 동일 조건 필수: 신분당선은
  // stamp 동결 + 문장 정상 갱신이라 stamp만으로 억제하면 사다리가 죽는다(실측).
  const stamp = item.dataStamp ?? null;
  if (stamp != null && stamp === base.dataStamp && item.message === base.lastMessage) {
    // 무정보여도 매칭은 매칭이다 — 연속 미등장 카운터(missCount)는 끊는다.
    // 안 끊으면 미등장↔동결재등장 반복(분기역 근접)에서 "N연속" 계약(§4.2)보다
    // 빨리 signalLost·도착 추정이 오발화된다(독립 리뷰 MAJOR).
    return {
      state: { ...base, missCount: 0, lastUpdatedAt: now, dataAgeSeconds: item.dataAgeSeconds ?? null },
      event: carriedEvent,
    };
  }

  const next: TransitGuideState = {
    ...base,
    signal: "tracking",
    missCount: 0,
    remaining: item.remainingStops,
    lastMessage: item.message,
    lastUpdatedAt: now,
    currentLocation: item.currentLocation ?? null,
    dataStamp: stamp,
    // stamp 동결 감지(신분당선형): 같은 stamp인데 문장이 갱신됐다면 recptnDt가
    // 고장난 것 — 그 나이는 거짓 정밀이라 null(§12.1, 접근성 감사 반영).
    dataAgeSeconds: stamp != null && stamp === base.dataStamp ? null : (item.dataAgeSeconds ?? null),
    trackingAnnounced: true,
  };

  // 도착 추정 상태에서 재관측 — riding 복귀(추정은 가역, §4.2).
  if (base.phase === "arrived" && !base.arrivedCertain) {
    next.phase = "riding";
    return { state: next, event: { kind: "backOnTrack", message: item.message } };
  }
  if (base.phase !== "riding") {
    return { state: next, event: carriedEvent };
  }

  // 도착 관측(§4.2): 지하철 arvlCd "1"(도착) / 서울버스 잔여 0(하차 구간 진입).
  // ⚠ "곧 도착" 문장은 임박이지 확정이 아니다. 근사 잠금은 arrived 전이 없음
  // (§5.2·§13.2 — 식별자가 없어 그 도착이 내 차량이라는 확정이 불가능하다).
  const approx = base.lock != null && isApproxTransitLock(base.lock);
  const arrivedObserved =
    !approx &&
    (base.lock?.mode === "subway"
      ? item.arrivalCode === "1"
      : base.lock?.mode === "seoulBus"
        ? item.remainingStops === 0
        : false);
  if (arrivedObserved) {
    next.phase = "arrived";
    next.arrivedCertain = true;
    return { state: next, event: { kind: "arrived", certain: true } };
  }

  // 등장 1회 통지(§6.1) — 사다리 래치를 현재 잔여로 함께 세워 같은 값 중복 발화 차단.
  if (!wasTracking) {
    next.ladderAnnounced = item.remainingStops;
    return {
      state: next,
      event: { kind: "trackingStarted", message: item.message, remaining: item.remainingStops },
    };
  }

  const remaining = item.remainingStops;
  if (remaining == null) {
    // 잔여 추출 실패(§6.2) — 사다리만 비활성, 완성 문장 변화 통지로 폴백.
    if (item.message !== base.lastMessage && base.lastMessage !== null) {
      return { state: next, event: { kind: "messageChanged", message: item.message } };
    }
    return { state: next, event: carriedEvent };
  }

  // 근사 기준 차량 교체(§5.2·§13.2): 잔여 역행 관측 — 조용한 기준 교체 금지.
  if (approx && prevRemaining != null && remaining > prevRemaining) {
    next.ladderAnnounced = null; // 새 차량 기준으로 사다리 재무장
    return { state: next, event: { kind: "approxVehicleChanged", message: item.message } };
  }

  // 사다리(§6.1): {3,2,1} 도달, 임계 건너뜀은 현재 값 하나만, 증가에 래치 비가역.
  const latch = next.ladderAnnounced;
  if (
    remaining <= LADDER_MAX &&
    remaining >= 0 &&
    (latch == null || remaining < latch) &&
    prevRemaining != null &&
    remaining < prevRemaining
  ) {
    next.ladderAnnounced = remaining;
    return {
      state: next,
      event: {
        kind: "countdown",
        remaining,
        message: item.message,
        currentLocation: item.currentLocation ?? null,
      },
    };
  }
  // 소실 후 재관측 회복(§4.2 신호 상태 변화 1회) — 상위 이벤트가 없을 때만
  // (카운트다운·도착이 나가면 그 자체가 회복 신호라 중복 통지 금지).
  if (base.signal === "signalLost" && carriedEvent === null) {
    return { state: next, event: { kind: "signalRecovered" } };
  }
  return { state: next, event: carriedEvent };
}

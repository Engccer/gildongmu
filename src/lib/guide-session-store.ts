/**
 * 실시간 길 안내 세션 단일성 스토어(B1 스펙 §3.3) — 모듈 싱글턴.
 *
 * 안내 패널이 두 곳(장소 상세·길찾기 뷰)에 마운트될 수 있게 되면서, 세션 소유를
 * 컴포넌트 밖으로 올린다. 플랫폼당 안내 세션은 동시에 최대 1개다 — watch·Wake
 * Lock·통지 채널이 2벌 돌면 통지가 겹치고 위치 구독이 이중 과금된다.
 * 새 시작은 기존 세션을 명시 종료한 뒤에만 진행한다(geolocation 스토어 관례 동형).
 *
 * WebMCP 도구층(spec 2026-08-27 §5.2)이 여기에 **상태 스냅샷 슬롯**을 더했다: 자식 훅
 * (`useRouteGuide`·`useTransitGuide`)이 세션 소유자로서 게시하고, `guidance_status`가
 * 읽는다. 도구는 자식 훅을 직접 만지지 않는다 — iOS `GuideSession.shared`와 같은 자리.
 */
type StopFn = () => void;

export type GuideSnapshotStatus = "idle" | "starting" | "tracking" | "done" | "failed";

/**
 * 안내 세션 상태 스냅샷(spec §3.8 필드). 도보·자동차는 화면이 이미 내는 문자열
 * (`liveRows`·`progress`·`degradeText`)이고 대중교통은 상태줄·신호·잔여 정거장이다.
 * 리듀서 내부(`GuideState.phase`·`stepIndex`)는 싣지 않는다 — 화면이 말하지 않는
 * 것을 도구가 말하면 낭독과 어긋난다.
 */
export interface GuideSnapshot {
  status: GuideSnapshotStatus;
  /** claim마다 증가. `stop_guidance`의 `previousStatus`와 같은 스냅샷에서 나온다. */
  sessionId?: number;
  mode?: "walk" | "car" | "transit";
  routeKey?: string;
  now?: string;
  next?: string;
  remainingMeters?: number;
  etaSeconds?: number;
  remainingStops?: number;
  offRoute?: boolean;
  signal?: string;
  degraded?: string;
  lastMessage?: string;
  dataAgeSeconds?: number;
}

const IDLE_SNAPSHOT: GuideSnapshot = { status: "idle" };

let currentStop: StopFn | null = null;
let sessionSeq = 0;
let currentSessionId: number | null = null;
let snapshot: GuideSnapshot = IDLE_SNAPSHOT;
/** `done`·`failed`는 소유자가 떠난 뒤에도 남긴다(spec 리뷰 #8 — 자동 종료 직후 상태 읽기). */
let retained = false;

/** 세션 시작 직전 호출 — 다른 소유자가 있으면 그 세션을 먼저 중지시킨다. */
export function claimGuideSession(stop: StopFn): void {
  if (currentStop !== null && currentStop !== stop) currentStop();
  currentStop = stop;
  // `starting`부터 점유한다(spec §5.2). 자식이 `tracking`을 게시하기 전까지 이 값이 답이다.
  sessionSeq += 1;
  currentSessionId = sessionSeq;
  retained = false;
  snapshot = { status: "starting", sessionId: currentSessionId };
}

/** 세션 종료 시 호출 — 자기 소유일 때만 비운다(늦은 release가 새 소유자를 지우지 않게). */
export function releaseGuideSession(stop: StopFn): void {
  if (currentStop !== stop) return;
  currentStop = null;
  if (!retained) snapshot = IDLE_SNAPSHOT;
}

/**
 * 활성 안내 세션 존재 여부 — 유휴 복귀 리셋(IdleReset)의 예외 판정용(iOS
 * GuideSessionCoordinator.isActive 미러). 안내 중 복귀는 "유휴"가 아니다.
 */
export function hasActiveGuideSession(): boolean {
  return currentStop !== null;
}

/**
 * 활성 세션이 있으면 명시 중지하고 true. 패널을 **언마운트시키는** 상태 전이(목적지
 * 편집·스왑·재조회) 직전에 호출한다 — 언마운트 정리는 통지·정지 톤 없이 자원만
 * 회수하므로, 여기서 stop()을 태워야 정지 톤이 나가고 호출자가 뷰 채널로 중지를
 * 통지할 수 있다(a11y 감사 HIGH: 안내가 살아 있다고 믿으며 걷는 상태 차단).
 */
export function stopActiveGuideSession(): boolean {
  const stop = currentStop;
  if (stop === null) return false;
  currentStop = null;
  retained = false;
  snapshot = IDLE_SNAPSHOT;
  stop();
  return true;
}

/**
 * 스냅샷 게시. **소유자만** 통과한다 — 같은 훅이 여러 인스턴스(수단별 `DistanceBeacon`)로
 * 마운트돼 있어 비소유 인스턴스의 `idle` 게시가 활성 세션 값을 덮는 것을 막는다.
 * `retain`은 `done`·`failed`처럼 세션이 끝난 뒤에도 화면에 남는 상태에 쓴다 — 그 뒤의
 * release가 스냅샷을 지우지 않는다(새 claim·`clearRetainedGuideSnapshot`이 지운다).
 */
export function publishGuideSnapshot(
  stop: StopFn,
  next: Omit<GuideSnapshot, "sessionId">,
  opts?: { retain?: boolean },
): void {
  if (currentStop !== stop) return;
  snapshot = { ...next, sessionId: currentSessionId ?? undefined };
  retained = opts?.retain ?? false;
}

export function readGuideSnapshot(): GuideSnapshot {
  return snapshot;
}

/**
 * 남겨 둔 `done`·`failed`를 지운다 — 화면이 그 상태를 지우는 시점(새 조회·닫기·언마운트)에
 * 호출한다. 활성 세션이 있으면 아무것도 하지 않는다(그 세션의 스냅샷은 소유자 몫).
 */
export function clearRetainedGuideSnapshot(): void {
  if (currentStop !== null) return;
  retained = false;
  snapshot = IDLE_SNAPSHOT;
}

/** 테스트 전용 — 모듈 상태 초기화. */
export function __resetGuideSessionStoreForTest(): void {
  currentStop = null;
  sessionSeq = 0;
  currentSessionId = null;
  snapshot = IDLE_SNAPSHOT;
  retained = false;
}

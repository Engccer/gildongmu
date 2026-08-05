/**
 * 실시간 길 안내 세션 단일성 스토어(B1 스펙 §3.3) — 모듈 싱글턴.
 *
 * 안내 패널이 두 곳(장소 상세·길찾기 뷰)에 마운트될 수 있게 되면서, 세션 소유를
 * 컴포넌트 밖으로 올린다. 플랫폼당 안내 세션은 동시에 최대 1개다 — watch·Wake
 * Lock·통지 채널이 2벌 돌면 통지가 겹치고 위치 구독이 이중 과금된다.
 * 새 시작은 기존 세션을 명시 종료한 뒤에만 진행한다(geolocation 스토어 관례 동형).
 */
type StopFn = () => void;

let currentStop: StopFn | null = null;

/** 세션 시작 직전 호출 — 다른 소유자가 있으면 그 세션을 먼저 중지시킨다. */
export function claimGuideSession(stop: StopFn): void {
  if (currentStop !== null && currentStop !== stop) currentStop();
  currentStop = stop;
}

/** 세션 종료 시 호출 — 자기 소유일 때만 비운다(늦은 release가 새 소유자를 지우지 않게). */
export function releaseGuideSession(stop: StopFn): void {
  if (currentStop === stop) currentStop = null;
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
  stop();
  return true;
}

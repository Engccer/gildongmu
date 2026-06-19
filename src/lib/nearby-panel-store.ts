/**
 * 홈 "내 주변 둘러보기" 패널의 아코디언 단일 출처 (React/Next 비의존 — 이식성).
 *
 * 왜 공유 스토어인가:
 * 6종 nearby 컴포넌트(지하철·버스·따릉이·소아진료·아이놀곳·둘러보기)는 각자 독립
 * status를 갖는다. 한 번에 하나만 펼치려면(다른 버튼을 누르면 펼쳐둔 것이 자동으로
 * 닫히게) "지금 어느 패널이 화면을 점유 중인지"의 단일 출처가 필요하다. 컴포넌트가
 * 펼침을 시작할 때 claim, 닫힐 때 release하고, 모든 컴포넌트가 활성 id를 구독해
 * 자신이 활성이 아니게 되면 스스로 닫는다.
 *
 * geolocation.ts와 동일한 모듈 싱글턴 + useSyncExternalStore 패턴(서버 스냅샷 stable
 * null → hydration 안전).
 */

let activeId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** 이 패널이 화면 점유를 가져간다 — 기존 활성 패널은 구독을 통해 스스로 닫힌다. */
export function claimNearbyPanel(id: string): void {
  if (activeId === id) return;
  activeId = id;
  emit();
}

/** 이 패널이 점유를 내려놓는다. 자신이 활성일 때만 — 이미 다른 패널이 점유를
 * 가져갔다면 그 점유를 빼앗지 않는다(닫히는 패널의 뒤늦은 release 방지). */
export function releaseNearbyPanel(id: string): void {
  if (activeId !== id) return;
  activeId = null;
  emit();
}

export function subscribeNearbyPanel(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getActiveNearbyPanel(): string | null {
  return activeId;
}

export function getServerActiveNearbyPanel(): null {
  return null;
}

/** 테스트 전용 — 모듈 상태 초기화. */
export function __resetNearbyPanelStore(): void {
  activeId = null;
  listeners.clear();
}

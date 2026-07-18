/**
 * 유휴 복귀 초기화 판정 — React/Next 비의존 순수 로직.
 *
 * 앱을 10분 이상 사용하지 않다가 다시 활성화되면 초기 화면(쿼리 없는 로케일 홈)으로
 * 복귀한다. 리셋 방식은 하드 리로드(location.replace) — 흩어진 상태(검색·상세
 * History 스택·근처 패널·채팅 오버레이)를 구조적으로 전부 초기화한다.
 * 스펙: docs/superpowers/specs/2026-07-18-idle-reset-title-refresh-design.md
 */

export const IDLE_RESET_MS = 10 * 60 * 1000;

export const LAST_ACTIVE_STORAGE_KEY = "gildongmu:last-active";

/**
 * 저장된 마지막 사용 시각으로 리셋 여부를 판정한다.
 * - 기록 없음(첫 방문·공유 링크 진입) → 리셋 안 함(?q= 공유 기능 보존).
 * - 숫자가 아니거나 미래 시각(시계 역행·손상) → 리셋 안 함(편의 기능이라 보수적으로).
 */
export function shouldIdleReset(stored: string | null, now: number): boolean {
  if (stored === null || stored.trim() === "") return false;
  const ts = Number(stored);
  if (!Number.isFinite(ts)) return false;
  const elapsed = now - ts;
  return elapsed > IDLE_RESET_MS;
}

/**
 * 첫 마운트 리셋 판정 — "PWA 콜드 재시작이 마지막 URL(?q=)을 복원"한 경로만 잡는다.
 * standalone(홈 화면 설치형)이 아니면 리셋하지 않는다: 일반 브라우저 탭 진입은
 * 재방문자가 오랜만에 공유 링크를 연 경우일 수 있고(stale 타임스탬프가 남아
 * 콜드 재시작과 구분 불가), OS의 URL 복원은 standalone에서만 일어난다.
 */
export function shouldResetOnMount(
  stored: string | null,
  now: number,
  search: string,
  isStandalone: boolean,
): boolean {
  return (
    isStandalone &&
    shouldIdleReset(stored, now) &&
    new URLSearchParams(search).has("q")
  );
}

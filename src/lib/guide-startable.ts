/**
 * 수단별 「안내 시작」 버튼을 낼 수 있는가(B1 §3.1) — 길찾기 화면과 채팅 안내 시작 카드(E83 R10)가 **같은 함수**로 가른다.
 * 조건을 두 자리에 적으면 한쪽만 고쳐져 「눌러도 시작되지 않는 버튼」이 생긴다. React 비의존.
 *
 * 인자에는 기본값을 두지 않는다 — 빠뜨린 조건이 조용히 「시작 가능」이 되지 않게.
 */
import { buildTransitGuideRoute } from "@/lib/transit-guide";
import type { TransitRoute } from "@/lib/types";

/**
 * 자동차: Tmap 경로 ∧ 한국어 데이터 ∧ 경유지 없음.
 * - 카카오 폴백은 기하 미지원이라 누르자마자 강등되는 죽은 버튼이다(provider 판별자가 사전 차단).
 * - 웹 자동차 안내 훅은 경유지를 싣지 않아, 경유지 조회에서 시작하면 경유지가 조용히 빠진 경로를 안내하게 된다(N4·E83 R9).
 *
 * @param provider 자동차 경로의 provider. 모르면 null(시작 불가).
 * @param english 영어 데이터 로케일인가(`prefersEnglish(locale)`).
 */
export function carGuideStartable(opts: { provider: string | null | undefined; english: boolean; hasVia: boolean }): boolean {
  return opts.provider === "tmap" && !opts.english && !opts.hasVia;
}

/** 대중교통: 탑승 구간이 하나라도 있는 경로(도보 전용 경로 제외 — 추적 불가 leg는 세션 안의 정직 상태다). */
export function transitGuideStartable(route: TransitRoute): boolean {
  return buildTransitGuideRoute(route) !== null;
}

/**
 * 채팅 여정 카드의 신선도 판정(E70-b spec `2026-11-12-e70b-chat-journey-design.md` D16) — React 비의존 순수 함수.
 *
 * 카드는 대화에 남아 몇 시간 뒤 다른 곳에서도 눌리고, 위치 스토어에는 TTL이 없다. [안내 시작]은 위치를 새로 받아 이 판정을
 * 지나며, 신선하지 않으면 카드의 결과로 시작하지 않고 같은 여정을 지금 위치로 다시 조회한다.
 *
 * 두 수치는 잠정값이다(spec D16) — 바꿀 자리는 여기 하나다.
 */
import { haversineMeters } from "@/lib/geo";

/** 조회한 지 이보다 오래된 카드는 다시 조회한다. */
export const JOURNEY_CARD_MAX_AGE_MS = 10 * 60 * 1000;
/** 카드의 출발 좌표에서 이보다 멀리 벗어났으면 다시 조회한다. */
export const JOURNEY_CARD_MAX_DRIFT_M = 100;

/** `fresh`만 카드의 결과로 안내를 시작한다. 나머지 셋은 다시 조회하는 사유다(행동은 같고 테스트·로그가 가른다). */
export type JourneyCardFreshness = "fresh" | "expired" | "moved" | "noFix";

/**
 * @param card 카드가 든 조회 시각(epoch ms)과 출발 좌표.
 * @param fix 방금 새로 받은 위치. 측위에 실패했으면 null — 어디 있는지 모르는 채로 카드의 경로를 믿지 않는다.
 * @param now 지금(epoch ms) — 기본값을 두지 않는다(생략이 조용히 "늘 신선"이 되지 않게).
 */
export function journeyCardFreshness(
  card: { origin: { lat: number; lng: number }; queriedAt: number },
  fix: { lat: number; lng: number } | null,
  now: number,
): JourneyCardFreshness {
  if (!fix) return "noFix";
  // 시각이 숫자가 아니면(깨진 payload) 낡은 것으로 본다 — NaN 비교는 늘 거짓이라 그대로 두면 신선으로 샌다.
  if (!Number.isFinite(card.queriedAt) || now - card.queriedAt > JOURNEY_CARD_MAX_AGE_MS) return "expired";
  const drift = haversineMeters(card.origin.lat, card.origin.lng, fix.lat, fix.lng);
  if (!Number.isFinite(drift) || drift > JOURNEY_CARD_MAX_DRIFT_M) return "moved";
  return "fresh";
}

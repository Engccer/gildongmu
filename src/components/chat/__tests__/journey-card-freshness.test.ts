/**
 * 채팅 여정 카드 신선도 판정(E70-b spec D16): 10분·100m·측위 실패 중 하나라도 걸리면 카드의 결과로 안내를 시작하지 않는다.
 * 수치는 상수로 참조한다(잠정값이라 바뀔 수 있다).
 */
import { describe, expect, it } from "vitest";
import {
  JOURNEY_CARD_MAX_AGE_MS,
  JOURNEY_CARD_MAX_DRIFT_M,
  journeyCardFreshness,
} from "../journey-card-freshness";

const origin = { lat: 37.55, lng: 126.95 };
const queriedAt = 1_800_000_000_000;
const card = { origin, queriedAt };
/** 북쪽으로 m미터 옮긴 좌표(위도 1도 ≈ 111,195m). */
const north = (m: number) => ({ lat: origin.lat + m / 111_195, lng: origin.lng });

describe("journeyCardFreshness", () => {
  it("방금 조회했고 같은 자리면 신선하다", () => {
    expect(journeyCardFreshness(card, origin, queriedAt + 1000)).toBe("fresh");
  });

  it("나이 상한은 포함 경계다: 꼭 상한이면 신선, 1ms 넘으면 낡았다", () => {
    expect(journeyCardFreshness(card, origin, queriedAt + JOURNEY_CARD_MAX_AGE_MS)).toBe("fresh");
    expect(journeyCardFreshness(card, origin, queriedAt + JOURNEY_CARD_MAX_AGE_MS + 1)).toBe("expired");
  });

  it("거리 상한 안쪽은 신선, 넘으면 이동으로 본다", () => {
    expect(journeyCardFreshness(card, north(JOURNEY_CARD_MAX_DRIFT_M - 5), queriedAt)).toBe("fresh");
    expect(journeyCardFreshness(card, north(JOURNEY_CARD_MAX_DRIFT_M + 5), queriedAt)).toBe("moved");
  });

  it("측위에 실패했으면(좌표 없음) 방금 조회한 카드여도 신선하지 않다", () => {
    expect(journeyCardFreshness(card, null, queriedAt)).toBe("noFix");
  });

  it("조회 시각이 깨졌으면 신선으로 새지 않는다", () => {
    expect(journeyCardFreshness({ origin, queriedAt: Number.NaN }, origin, queriedAt)).toBe("expired");
  });

  it("좌표가 깨졌으면 신선으로 새지 않는다", () => {
    expect(journeyCardFreshness(card, { lat: Number.NaN, lng: origin.lng }, queriedAt)).toBe("moved");
  });
});

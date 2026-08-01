import { findCongestionArea } from "./congestion-area";
import { loadCongestion, type CongestionReading } from "./providers/seoul-congestion";

/**
 * 실시간 인구 혼잡도 진입점 — 라우트·채팅 공용.
 *
 * 좌표 → 영역 판정(순수) → 그 영역의 실시간 등급(네트워크) 순서다.
 * **영역 밖이면 upstream을 부르지 않는다** — 서울의 91%가 영역 밖이라
 * 부르면 쿼터만 태우고 답은 어차피 없다.
 */

export interface CongestionAreaReading extends CongestionReading {
  /** 서울시 영역 코드(`POI014`). */
  code: string;
  /** 영역 이름(`강남역`). 사용자에게 "어디의 혼잡도인지" 알리는 정본. */
  name: string;
}

export interface CongestionResult {
  /**
   * null은 **오류가 아니다**: "여기는 서울시가 혼잡도를 재는 121곳이 아니다".
   * 조회 실패는 throw로 올라간다(3-state).
   */
  area: CongestionAreaReading | null;
}

export async function findCongestionNear(
  lat: number,
  lng: number,
): Promise<CongestionResult> {
  const area = findCongestionArea(lat, lng);
  if (!area) return { area: null };

  const reading = await loadCongestion(area.code);
  if (!reading) return { area: null };

  return { area: { ...reading, code: area.code, name: area.name } };
}

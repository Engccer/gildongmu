import type { Coord, Place, WhereAmI } from "./types";

/**
 * 현재 위치(WhereAmI) → 채팅 앵커용 Place 합성(nearby-place.ts 패턴 동형).
 *
 * category를 빈 문자열로 둬 ChatOverlay의 isStation(place)가 false가 되게 한다
 * (현재 위치를 역으로 오분류해 역 프롬프트를 주는 것 방지). name은 placeContext의
 * 좌표 앵커 식별 문자열 — 행정동 > 도로명 > "현재 위치" 순 폴백.
 * 순수 함수 — React/Next 비의존.
 */
export function whereAmIToPlace(data: WhereAmI, coord: Coord): Place {
  const name = data.region || data.address?.road || data.address?.jibun || "현재 위치";
  return {
    id: `where-am-i-${coord.lat.toFixed(5)}-${coord.lng.toFixed(5)}`,
    name,
    category: "",
    address: data.address?.jibun ?? "",
    roadAddress: data.address?.road ?? "",
    lat: coord.lat,
    lng: coord.lng,
  };
}

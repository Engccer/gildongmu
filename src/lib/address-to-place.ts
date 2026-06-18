import type { JusoAddress, Place } from "./types";

/**
 * juso 주소 항목 + 좌표 → Place 합성.
 *
 * 좌표는 카카오 지오코딩(/api/geocode)이 채운다 — juso는 공식 주소/영문/우편번호,
 * 카카오는 좌표 정본으로 역할을 분리한다(juso 좌표 API 별도 승인 불요).
 *
 * englishAddress는 en 로케일에서만 채운다 — PlaceCard/PlaceDetail이
 * englishAddress가 있으면 우선 표시하므로, ko UI에 영문 주소가 새지 않게 한다
 * (기존 enrich 동작과 동일하게 영문은 en 전용).
 */
export function jusoAddressToPlace(
  addr: JusoAddress,
  coord: { lat: number; lng: number },
  locale: "ko" | "en",
): Place {
  const road = addr.roadAddrPart1 || addr.roadAddr;
  return {
    id: `juso-${addr.roadAddr}`,
    name: addr.bdNm || road,
    category: "",
    address: addr.jibunAddr,
    roadAddress: road,
    englishAddress: locale === "en" && addr.engAddr ? addr.engAddr : undefined,
    lat: coord.lat,
    lng: coord.lng,
  };
}

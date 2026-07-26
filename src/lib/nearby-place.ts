import type { KidsPlace, NightClinic, Place, SurroundingPlace } from "./types";

/**
 * 근처 찾기 결과 항목(아이 놀 곳·둘러보기·소아진료) → Place 합성.
 *
 * 각 nearby 결과는 자체 타입이라 장소별 채팅(ChatOverlay)에 넘기려면 공통 Place로
 * 정규화해야 한다. category는 **가장 풍부한 분류 문자열**을 쓴다 — ChatOverlay가
 * isStation(place)로 역 여부를 판정하고 프롬프트 버킷을 고르기 때문(둘러보기에서
 * 나온 지하철 입구는 categoryRaw에 "지하철"이 있어 자동으로 역 프롬프트를 받는다).
 * 없는 필드(roadAddress·address)는 빈 문자열, 없는 전화/링크는 undefined로 둔다.
 *
 * 순수 함수 — React/Next 비의존(dodo-planet 이식 정합).
 */

export function kidsPlaceToPlace(k: KidsPlace): Place {
  return {
    id: k.id,
    name: k.name,
    category: k.category,
    address: k.address,
    roadAddress: k.roadAddress ?? "",
    lat: k.lat,
    lng: k.lng,
    phone: k.phone,
    link: k.link,
    distanceMeters: k.distanceMeters,
  };
}

export function surroundingPlaceToPlace(p: SurroundingPlace): Place {
  return {
    id: p.id,
    // categoryRaw = 카카오 category_name 전체 계층 — isStation 판정에 필요(지하철 등).
    category: p.categoryRaw,
    name: p.name,
    address: "",
    roadAddress: "",
    lat: p.lat,
    lng: p.lng,
    phone: p.phone,
    link: p.link,
    distanceMeters: p.distanceMeters,
  };
}

export function nightClinicToPlace(c: NightClinic): Place {
  return {
    id: c.id,
    name: c.name,
    // 종별(의원/병원) — 역 키워드가 없어 일반 프롬프트 버킷으로 떨어진다.
    category: c.kind,
    // ⚠ NMC dutyAddr은 **도로명 주소**다(명부 153건 전수 확인, 2026-07-26).
    // 지번 슬롯에 넣으면 라벨을 붙이는 소비처(장소 상세의 "지번 주소 …")가
    // 도로명을 지번이라 낭독한다. 채팅은 필드명을 안 붙여 드러나지 않았을 뿐이다.
    // 지번은 소스에 없으므로 비운다(없는 값을 지어내지 않는다).
    address: "",
    roadAddress: c.address,
    lat: c.lat,
    lng: c.lng,
    phone: c.phone || undefined,
    distanceMeters: c.distanceMeters,
  };
}

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
    address: c.address,
    roadAddress: "",
    lat: c.lat,
    lng: c.lng,
    phone: c.phone || undefined,
    distanceMeters: c.distanceMeters,
  };
}

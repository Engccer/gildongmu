/**
 * "내 주변" 도메인 항목(소아 진료·아이 놀 곳·둘러보기·무장애 관광지) → 공통 `Place` 투영.
 *
 * iOS Kit `PlaceProjection.swift`의 정본(웹). 채팅 라우터가 nearby류 렌더에 `places`로
 * 실어 보내, 카드가 없던 iOS 답변에서도 산문 장소 언급 → 상세 진입의 근거가 되게 한다
 * (BACKLOG B9). 규칙은 Swift와 동일해야 한다:
 * - category는 가장 풍부한 분류 문자열(채팅 프롬프트 `isStation` 판정용).
 * - 도로명만 있는 소스(NMC dutyAddr·TourAPI addr1)는 `roadAddress`에, 지번은 비운다
 *   (없는 값을 지어내지 않는다 — 지번 슬롯에 넣으면 상세 화면이 "지번 주소"라 낭독).
 * - 의도된 비대칭 하나: 둘러보기 `roadAddress`는 여기서 실값을 싣는다(웹 모델에 있다).
 *   Kit `SurroundingPlace`에는 그 필드가 없어 Swift 투영은 빈 문자열이다 — 필드를 더할
 *   때 그쪽도 맞춘다.
 */
import type {
  BarrierFreePlace,
  KidsPlace,
  NightClinic,
  Place,
  SurroundingPlace,
} from "@/lib/types";
import type { SceneItem } from "@/lib/surroundings-scene";

export function nightClinicToPlace(c: NightClinic): Place {
  return {
    id: c.id,
    name: c.name,
    nameRoman: c.nameRoman,
    category: c.kind,
    address: "",
    roadAddress: c.address,
    lat: c.lat,
    lng: c.lng,
    phone: c.phone || undefined,
    distanceMeters: c.distanceMeters,
  };
}

export function kidsPlaceToPlace(k: KidsPlace): Place {
  return {
    id: k.id,
    name: k.name,
    nameRoman: k.nameRoman,
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
    name: p.name,
    nameRoman: p.nameRoman,
    category: p.categoryRaw,
    address: "",
    roadAddress: p.roadAddress ?? "",
    lat: p.lat,
    lng: p.lng,
    phone: p.phone,
    link: p.link,
    distanceMeters: p.distanceMeters,
  };
}

/** 주변 상황 장면 항목 → `Place`(Kit `sceneItemToPlace` 동형, `surroundingPlaceToPlace`와 같은 규칙). */
export function sceneItemToPlace(it: SceneItem): Place {
  return {
    id: it.id,
    name: it.name,
    nameRoman: it.nameRoman,
    category: it.categoryRaw,
    address: "",
    roadAddress: it.roadAddress ?? "",
    lat: it.lat,
    lng: it.lng,
    phone: it.phone,
    link: it.link,
    distanceMeters: it.distanceMeters,
  };
}

export function barrierFreePlaceToPlace(b: BarrierFreePlace): Place {
  return {
    id: b.contentId,
    name: b.name,
    nameRoman: b.nameRoman,
    category: b.category,
    address: "",
    roadAddress: b.address,
    lat: b.lat,
    lng: b.lng,
    distanceMeters: b.distanceMeters,
  };
}

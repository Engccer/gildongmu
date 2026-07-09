import Foundation

// 내 주변 항목(소아진료·아이 놀 곳·둘러보기)·현재 위치 정위 → Place 합성.
// 웹 `src/lib/nearby-place.ts`·`src/lib/where-am-i-place.ts` 미러(계약 정본은 웹).
//
// 각 nearby 결과는 자체 모델이라 장소별 채팅(ChatView)에 넘기려면 공통 Place로
// 정규화해야 한다. category는 **가장 풍부한 분류 문자열**을 쓴다 — 채팅 프롬프트가
// isStation(place)로 역 여부를 판정해 버킷을 고르기 때문(둘러보기에서 나온 지하철
// 입구는 categoryRaw에 "지하철"이 있어 자동으로 역 프롬프트를 받는다).
// whereAmIToPlace만 category를 빈 문자열로 고정 — 현재 위치를 역으로 오분류해
// 역 프롬프트를 주는 것을 막기 위함.
//
// 순수 함수 — SwiftUI 비의존(App 계층 어디서든 호출 가능).

public func nightClinicToPlace(_ c: NightClinic) -> Place {
    Place(
        id: c.id,
        name: c.name,
        // 종별(의원/병원) — 역 키워드가 없어 일반 프롬프트 버킷으로 떨어진다.
        category: c.kind,
        address: c.address,
        roadAddress: "",
        englishAddress: nil,
        lat: c.lat,
        lng: c.lng,
        phone: c.phone.isEmpty ? nil : c.phone,
        link: nil,
        distanceMeters: Double(c.distanceMeters))
}

public func kidsPlaceToPlace(_ k: KidsPlace) -> Place {
    Place(
        id: k.id,
        name: k.name,
        category: k.category,
        address: k.address,
        roadAddress: k.roadAddress ?? "",
        englishAddress: nil,
        lat: k.lat,
        lng: k.lng,
        phone: k.phone,
        link: k.link,
        distanceMeters: Double(k.distanceMeters))
}

public func surroundingPlaceToPlace(_ p: SurroundingPlace) -> Place {
    Place(
        id: p.id,
        name: p.name,
        // categoryRaw = 카카오 category_name 전체 계층 — isStation 판정에 필요(지하철 등).
        category: p.categoryRaw,
        address: "",
        roadAddress: "",
        englishAddress: nil,
        lat: p.lat,
        lng: p.lng,
        phone: p.phone,
        link: p.link,
        distanceMeters: Double(p.distanceMeters))
}

/// name은 좌표 앵커 식별 문자열 — 행정동 > 도로명 > 지번 > "현재 위치" 순 폴백
/// (빈 문자열도 없는 값으로 취급, 웹 `||` 폴백 동형).
public func whereAmIToPlace(_ data: WhereAmIData, lat: Double, lng: Double) -> Place {
    let name = firstNonEmpty(data.region, data.address?.road, data.address?.jibun) ?? "현재 위치"
    return Place(
        id: "where-am-i-\(String(format: "%.5f", lat))-\(String(format: "%.5f", lng))",
        name: name,
        category: "",
        address: data.address?.jibun ?? "",
        roadAddress: data.address?.road ?? "",
        englishAddress: nil,
        lat: lat,
        lng: lng,
        phone: nil,
        link: nil,
        distanceMeters: nil)
}

private func firstNonEmpty(_ values: String?...) -> String? {
    for value in values {
        if let value, !value.isEmpty { return value }
    }
    return nil
}

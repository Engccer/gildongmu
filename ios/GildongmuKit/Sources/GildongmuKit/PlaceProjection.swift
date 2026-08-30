import Foundation

// 내 주변 항목(소아진료·아이 놀 곳·둘러보기·무장애 관광지)·현재 위치 정위 → Place 합성.
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
        nameRoman: c.nameRoman,
        // 종별(의원/병원) — 역 키워드가 없어 일반 프롬프트 버킷으로 떨어진다.
        category: c.kind,
        // ⚠ NMC dutyAddr은 **도로명 주소**다(명부 153건 전수 확인, 2026-07-26).
        // 지번 슬롯에 넣으면 라벨을 붙이는 소비처(PlaceDetailView의 "지번 주소 …")가
        // 도로명을 지번이라 낭독한다. 채팅은 필드명을 안 붙여 드러나지 않았을 뿐이다.
        // 지번은 소스에 없으므로 비운다(없는 값을 지어내지 않는다).
        address: "",
        roadAddress: c.address,
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
        nameRoman: k.nameRoman,
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
        nameRoman: p.nameRoman,
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

/// 부근 상황(scene) 항목 → Place(M4 판정 ⑤). surroundingPlaceToPlace 동형 — 역 판별에 categoryRaw.
public func sceneItemToPlace(_ item: SurroundingsSceneItem) -> Place {
    Place(
        id: item.id,
        name: item.name,
        nameRoman: item.nameRoman,
        category: item.categoryRaw,
        address: "",
        roadAddress: item.roadAddress ?? "",
        englishAddress: nil,
        lat: item.lat,
        lng: item.lng,
        phone: item.phone,
        link: item.link,
        distanceMeters: Double(item.distanceMeters))
}

public func barrierFreePlaceToPlace(_ b: BarrierFreePlace) -> Place {
    Place(
        id: b.contentId,
        name: b.name,
        nameRoman: b.nameRoman,
        // contenttypeid 라벨(빈 문자열 허용) — 역 키워드가 없어 일반 프롬프트 버킷.
        category: b.category,
        // ⚠ TourAPI addr1은 도로명 주소다(fixture 실측 "서울특별시 중구 세종대로 110 (태평로1가)").
        // 지번은 소스에 없으므로 비운다(없는 값을 지어내지 않는다).
        address: "",
        roadAddress: b.address,
        englishAddress: nil,
        lat: b.lat,
        lng: b.lng,
        phone: nil,
        link: nil,
        distanceMeters: Double(b.distanceMeters))
}

/// 둘러보기(M4) "이 위치에 관해 물어보기" 앵커 — whereAmIToPlace 동형(좌표 앵커, 빈 category).
/// name은 위치 문장 재료(행정동 + 도로명), 없으면 "현재 위치" 폴백.
public func overviewAnchorPlace(_ overview: NearbyOverview, lat: Double, lng: Double, lang: String) -> Place {
    Place(
        id: "where-am-i-\(String(format: "%.5f", lat))-\(String(format: "%.5f", lng))",
        name: firstNonEmpty(overview.place) ?? kitLocalized("whereAmI.ready", lang: lang),
        nameRoman: firstNonEmpty(overview.place) == nil ? nil : overview.placeRoman,
        category: "",
        address: "",
        roadAddress: "",
        englishAddress: nil,
        lat: lat,
        lng: lng,
        phone: nil,
        link: nil,
        distanceMeters: nil)
}

/// name은 좌표 앵커 식별 문자열 — 행정동 > 도로명 > 지번 > "현재 위치" 순 폴백
/// (빈 문자열도 없는 값으로 취급, 웹 `||` 폴백 동형). lang은 폴백 라벨 언어.
public func whereAmIToPlace(_ data: WhereAmIData, lat: Double, lng: Double, lang: String) -> Place {
    let name = firstNonEmpty(data.region, data.address?.road, data.address?.jibun)
        ?? kitLocalized("whereAmI.ready", lang: lang)
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

/// 문화행사 → Place. name은 **행사명**이다(사용자가 목록에서 고른 것이 행사이므로
/// 상세 제목도 행사여야 한다). 좌표는 개최 장소라 길찾기가 그대로 성립한다.
/// ⚠ 주소 슬롯은 비운다 — 행사 데이터엔 주소가 없고 `place`는 "강동아트센터 아트랑
/// 1층~3층" 같은 시설 설명이라, 넣으면 소비처가 그것을 도로명 주소로 낭독한다
/// (nightClinicToPlace 주석과 같은 함정, 방향만 반대). 장소 설명은 도메인 섹션이 밝힌다.
public func cultureEventToPlace(_ e: CultureEvent) -> Place {
    Place(
        id: e.id,
        name: e.title,
        nameRoman: e.titleRoman,
        category: e.category,
        address: "",
        roadAddress: "",
        englishAddress: nil,
        lat: e.lat,
        lng: e.lng,
        phone: nil,
        link: e.link,
        distanceMeters: Double(e.distanceMeters))
}

/// 안내 목적지(이름+좌표뿐) → 최소 Place(스펙 2026-08-12 §2 — 안내 시트 "장소 상세
/// 보기"). 주소·카테고리 빈 값이어도 상세의 주변 섹션(지하철·버스·공기질)은 좌표만으로
/// 성립한다. category는 빈 문자열 고정 — 목적지 라벨만으로는 역 여부를 판정할 근거가
/// 없다(whereAmIToPlace와 같은 오분류 방지).
public func guideDestinationPlace(dest: BeaconDest, label: String) -> Place {
    Place(
        id: "guide-dest:\(dest.lat),\(dest.lng)",
        name: label,
        category: "",
        address: "",
        roadAddress: "",
        englishAddress: nil,
        lat: dest.lat,
        lng: dest.lng,
        phone: nil,
        link: nil,
        distanceMeters: nil)
}

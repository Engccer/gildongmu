import Foundation

// 검색 결과의 카테고리 버킷·지역 축 필터 + 거리 정렬. 웹 `src/lib/category.ts`·
// `src/lib/region.ts`·`src/lib/geo.ts` 미러(계약 정본은 웹). 순수 함수만(뷰·서비스
// 비의존). 두 축(버킷·지역)은 앱 계층에서 AND로 결합한다(filterPlaces(bucket:)
// 결과에 filterPlaces(region:)을 다시 적용).

/// 버킷 표시·매칭 순서. 검색 의도(관광·명소)를 위에, 부수 정보(교통)를 아래에.
private let bucketOrder = ["attraction", "food", "shopping", "lodging", "transport", "other"]

/// 버킷별 키워드 정규식. 위에서부터 검사해 첫 매칭 버킷을 반환하므로 순서는
/// bucketOrder와 같다(관광이 교통보다 우선). 한글(카카오)·영문(TourAPI) 키워드를
/// 한 패턴에 담는다.
private let bucketPatterns: [(String, String)] = [
    ("attraction", "관광|명소|문화|유적|고궁|궁궐|사찰|박물|미술|공원|축제|공연|행사|레포츠|Attraction|Cultural|Festival|Leisure|Tour"),
    ("food", "음식|맛집|카페|제과|베이커리|Restaurant|Cafe|Food"),
    ("shopping", "쇼핑|마트|백화점|시장|면세|아울렛|편의점|Shopping|Market"),
    ("lodging", "숙박|호텔|모텔|펜션|게스트|리조트|Accommodation|Hotel|Lodging"),
    ("transport", "교통|지하철|전철|철도|기차|버스|주차|공항|터미널|Transport|Station|Parking|Airport"),
]

/// 카테고리 문자열을 공통 버킷 키로 매핑. 미매칭은 "other".
private func categoryOf(_ category: String) -> String {
    for (bucket, pattern) in bucketPatterns {
        if category.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil {
            return bucket
        }
    }
    return "other"
}

/// 결과 안에 실제로 존재하는 버킷만 정해진 순서로 반환(칩 표시용).
public func bucketsPresent(_ places: [Place]) -> [String] {
    let present = Set(places.map { categoryOf($0.category) })
    return bucketOrder.filter { present.contains($0) }
}

/// 선택 버킷으로 필터. nil이면 전체 반환(입력 순서 보존).
public func filterPlaces(_ places: [Place], bucket: String?) -> [Place] {
    guard let bucket else { return places }
    return places.filter { categoryOf($0.category) == bucket }
}

/// 장소들을 버킷별로 묶는다. bucketOrder를 따르고, 빈 버킷은 생략하며, 같은 버킷
/// 안에서는 입력 순서를 보존한다.
public func groupPlacesByBucket(_ places: [Place]) -> [(bucket: String, places: [Place])] {
    var grouped: [String: [Place]] = [:]
    for place in places {
        grouped[categoryOf(place.category), default: []].append(place)
    }
    return bucketOrder.compactMap { bucket in
        guard let group = grouped[bucket] else { return nil }
        return (bucket: bucket, places: group)
    }
}

/// 카탈로그 `category.*` 조회(웹 미러). 미지정 키는 키 그대로 반환.
/// 키를 리터럴 switch로 두는 이유: 동적 조립 금지(린터 계약) + 허용 키 집합의 코드 명시.
public func bucketLabel(_ key: String, lang: String) -> String {
    switch key {
    case "attraction": return kitLocalized("category.attraction", lang: lang)
    case "food": return kitLocalized("category.food", lang: lang)
    case "shopping": return kitLocalized("category.shopping", lang: lang)
    case "lodging": return kitLocalized("category.lodging", lang: lang)
    case "transport": return kitLocalized("category.transport", lang: lang)
    case "other": return kitLocalized("category.other", lang: lang)
    default: return key
    }
}

/// 표시·정렬 순서 — 행정 표준 시·도 순(서울→…→제주).
private let regionOrder = [
    "seoul", "busan", "daegu", "incheon", "gwangju", "daejeon", "ulsan", "sejong",
    "gyeonggi", "gangwon", "chungbuk", "chungnam", "jeonbuk", "jeonnam", "gyeongbuk",
    "gyeongnam", "jeju",
]

/// 주소 첫 토큰의 모든 표기 변형을 키로. 약칭(카카오 address_name)과 풀네임
/// (특별·광역시/도, 특별자치도)을 모두 둔다.
private let regionAliases: [String: String] = [
    "서울": "seoul", "서울특별시": "seoul",
    "부산": "busan", "부산광역시": "busan",
    "대구": "daegu", "대구광역시": "daegu",
    "인천": "incheon", "인천광역시": "incheon",
    "광주": "gwangju", "광주광역시": "gwangju",
    "대전": "daejeon", "대전광역시": "daejeon",
    "울산": "ulsan", "울산광역시": "ulsan",
    "세종": "sejong", "세종시": "sejong", "세종특별자치시": "sejong",
    "경기": "gyeonggi", "경기도": "gyeonggi",
    "강원": "gangwon", "강원도": "gangwon", "강원특별자치도": "gangwon",
    "충북": "chungbuk", "충청북도": "chungbuk",
    "충남": "chungnam", "충청남도": "chungnam",
    "전북": "jeonbuk", "전라북도": "jeonbuk", "전북특별자치도": "jeonbuk",
    "전남": "jeonnam", "전라남도": "jeonnam",
    "경북": "gyeongbuk", "경상북도": "gyeongbuk",
    "경남": "gyeongnam", "경상남도": "gyeongnam",
    "제주": "jeju", "제주도": "jeju", "제주특별자치도": "jeju",
]

/// 장소의 시·도 키. 지번 주소(address) 우선, 비면 도로명(roadAddress)으로 폴백.
/// 첫 토큰이 알려진 시·도가 아니면 nil(부분 문자열 매칭은 "경기 광주시"를 광주광역시로
/// 오인하므로 첫 토큰 정확 매칭만 쓴다).
private func regionOf(_ place: Place) -> String? {
    let source = place.address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? place.roadAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        : place.address.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let firstToken = source.split(whereSeparator: { $0.isWhitespace }).first else { return nil }
    return regionAliases[String(firstToken)]
}

/// 결과에 실제 존재하는 시·도만 정해진 순서로(중복 제거, 미매칭 제외).
public func regionsPresent(_ places: [Place]) -> [String] {
    let present = Set(places.compactMap { regionOf($0) })
    return regionOrder.filter { present.contains($0) }
}

/// 선택 시·도로 필터. nil이면 전체(입력 순서 보존).
public func filterPlaces(_ places: [Place], region: String?) -> [Place] {
    guard let region else { return places }
    return places.filter { regionOf($0) == region }
}

/// 카탈로그 `region.*` 조회(웹 미러). 미지정 키는 키 그대로 반환.
public func regionLabel(_ key: String, lang: String) -> String {
    switch key {
    case "seoul": return kitLocalized("region.seoul", lang: lang)
    case "busan": return kitLocalized("region.busan", lang: lang)
    case "daegu": return kitLocalized("region.daegu", lang: lang)
    case "incheon": return kitLocalized("region.incheon", lang: lang)
    case "gwangju": return kitLocalized("region.gwangju", lang: lang)
    case "daejeon": return kitLocalized("region.daejeon", lang: lang)
    case "ulsan": return kitLocalized("region.ulsan", lang: lang)
    case "sejong": return kitLocalized("region.sejong", lang: lang)
    case "gyeonggi": return kitLocalized("region.gyeonggi", lang: lang)
    case "gangwon": return kitLocalized("region.gangwon", lang: lang)
    case "chungbuk": return kitLocalized("region.chungbuk", lang: lang)
    case "chungnam": return kitLocalized("region.chungnam", lang: lang)
    case "jeonbuk": return kitLocalized("region.jeonbuk", lang: lang)
    case "jeonnam": return kitLocalized("region.jeonnam", lang: lang)
    case "gyeongbuk": return kitLocalized("region.gyeongbuk", lang: lang)
    case "gyeongnam": return kitLocalized("region.gyeongnam", lang: lang)
    case "jeju": return kitLocalized("region.jeju", lang: lang)
    default: return key
    }
}

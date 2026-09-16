package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.Place

// 검색 결과의 카테고리 버킷·지역 축 필터. 웹 `src/lib/category.ts`·`src/lib/region.ts` ↔ Kit
// `SearchFilters.swift` 미러(계약 정본은 웹). 순수 함수만. 두 축(버킷·지역)은 앱 계층에서
// AND로 결합한다(filterPlacesByBucket 결과에 filterPlacesByRegion을 다시 적용).
//
// 이름 변경: Swift는 `filterPlaces(_:bucket:)`·`filterPlaces(_:region:)`가 인자 라벨로 갈리지만
// Kotlin은 같은 시그니처라 웹 이름 `filterPlacesByBucket`·`filterPlacesByRegion`을 쓴다.

/** 칩 표시·매칭 순서. 정렬은 정확도가 전담하고 버킷은 필터 축일 뿐이다. */
private val bucketOrder = listOf("attraction", "public", "food", "shopping", "lodging", "transport", "other")

/**
 * 버킷별 키워드 정규식. 위에서부터 검사해 첫 매칭 버킷을 반환하므로 순서는 bucketOrder와 같다.
 * 부분 문자열 오탐 이력(수정 시 반드시 실측 카테고리로 검증): '문화'→사진관, '미술'→가죽공예 공방, '카페'→키즈카페.
 * ⚠ 문자 클래스 안에 `[`가 없어 웹·Swift·Java 정규식이 같은 뜻이다(있으면 반드시 `\[`).
 */
private val bucketPatterns: List<Pair<String, Regex>> = listOf(
    "attraction" to "관광|명소|문화시설|유적|고궁|궁궐|사찰|박물|미술관|공원|축제|공연|행사|레포츠|Attraction|Cultural|Festival|Leisure|Tour",
    "public" to "교육|학교|유치원|어린이집|공공|관공서|주민센터|도서관|우체국|복지|School|University|Library|Government|Public",
    "food" to "음식|맛집|(?<!키즈)카페|제과|베이커리|Restaurant|Cafe|Food",
    "shopping" to "쇼핑|마트|백화점|시장|면세|아울렛|편의점|Shopping|Market",
    "lodging" to "숙박|호텔|모텔|펜션|게스트|리조트|Accommodation|Hotel|Lodging",
    "transport" to "교통|지하철|전철|철도|기차|버스|주차|공항|터미널|Transport|Station|Parking|Airport",
).map { (bucket, pattern) -> bucket to Regex(pattern, RegexOption.IGNORE_CASE) }

/** 카테고리 문자열을 공통 버킷 키로 매핑. 미매칭은 "other". internal: PlaceChatPrompts도 재사용. */
internal fun categoryOf(category: String): String =
    bucketPatterns.firstOrNull { (_, re) -> re.containsMatchIn(category) }?.first ?: "other"

/** 결과 안에 실제로 존재하는 버킷만 정해진 순서로 반환(칩 표시용). */
fun bucketsPresent(places: List<Place>): List<String> {
    val present = places.map { categoryOf(it.category) }.toSet()
    return bucketOrder.filter { it in present }
}

/** 선택 버킷으로 필터. null이면 전체 반환(입력 순서 보존). */
fun filterPlacesByBucket(places: List<Place>, bucket: String?): List<Place> {
    if (bucket == null) return places
    return places.filter { categoryOf(it.category) == bucket }
}

/** 카탈로그 `category.*` 조회(웹 미러). 미지정 키는 키 그대로. 키를 리터럴 when으로 두는 이유: 동적 조립 금지(린터 계약). */
fun bucketLabel(key: String, lang: String): String = when (key) {
    "attraction" -> kitLocalized("category.attraction", lang)
    "public" -> kitLocalized("category.public", lang)
    "food" -> kitLocalized("category.food", lang)
    "shopping" -> kitLocalized("category.shopping", lang)
    "lodging" -> kitLocalized("category.lodging", lang)
    "transport" -> kitLocalized("category.transport", lang)
    "other" -> kitLocalized("category.other", lang)
    else -> key
}

/** 표시·정렬 순서 — 행정 표준 시·도 순(서울→…→제주). */
private val regionOrder = listOf(
    "seoul", "busan", "daegu", "incheon", "gwangju", "daejeon", "ulsan", "sejong",
    "gyeonggi", "gangwon", "chungbuk", "chungnam", "jeonbuk", "jeonnam", "gyeongbuk",
    "gyeongnam", "jeju",
)

/** 주소 첫 토큰의 모든 표기 변형을 키로. 약칭(카카오 address_name)과 풀네임을 모두 둔다. */
private val regionAliases: Map<String, String> = mapOf(
    "서울" to "seoul", "서울특별시" to "seoul",
    "부산" to "busan", "부산광역시" to "busan",
    "대구" to "daegu", "대구광역시" to "daegu",
    "인천" to "incheon", "인천광역시" to "incheon",
    "광주" to "gwangju", "광주광역시" to "gwangju",
    "대전" to "daejeon", "대전광역시" to "daejeon",
    "울산" to "ulsan", "울산광역시" to "ulsan",
    "세종" to "sejong", "세종시" to "sejong", "세종특별자치시" to "sejong",
    "경기" to "gyeonggi", "경기도" to "gyeonggi",
    "강원" to "gangwon", "강원도" to "gangwon", "강원특별자치도" to "gangwon",
    "충북" to "chungbuk", "충청북도" to "chungbuk",
    "충남" to "chungnam", "충청남도" to "chungnam",
    "전북" to "jeonbuk", "전라북도" to "jeonbuk", "전북특별자치도" to "jeonbuk",
    "전남" to "jeonnam", "전라남도" to "jeonnam",
    "경북" to "gyeongbuk", "경상북도" to "gyeongbuk",
    "경남" to "gyeongnam", "경상남도" to "gyeongnam",
    "제주" to "jeju", "제주도" to "jeju", "제주특별자치도" to "jeju",
)

/**
 * 장소의 시·도 키. 지번 주소(address) 우선, 비면 도로명(roadAddress)으로 폴백. 첫 토큰이 알려진
 * 시·도가 아니면 null(부분 문자열 매칭은 "경기 광주시"를 광주광역시로 오인하므로 첫 토큰 정확 매칭만).
 */
private fun regionOf(place: Place): String? {
    val source = place.address.trim().ifEmpty { place.roadAddress.trim() }
    val firstToken = source.split(Regex("\\s+")).firstOrNull { it.isNotEmpty() } ?: return null
    return regionAliases[firstToken]
}

/** 결과에 실제 존재하는 시·도만 정해진 순서로(중복 제거, 미매칭 제외). */
fun regionsPresent(places: List<Place>): List<String> {
    val present = places.mapNotNull { regionOf(it) }.toSet()
    return regionOrder.filter { it in present }
}

/** 선택 시·도로 필터. null이면 전체(입력 순서 보존). */
fun filterPlacesByRegion(places: List<Place>, region: String?): List<Place> {
    if (region == null) return places
    return places.filter { regionOf(it) == region }
}

/** 카탈로그 `region.*` 조회(웹 미러). 미지정 키는 키 그대로 반환. */
fun regionLabel(key: String, lang: String): String = when (key) {
    "seoul" -> kitLocalized("region.seoul", lang)
    "busan" -> kitLocalized("region.busan", lang)
    "daegu" -> kitLocalized("region.daegu", lang)
    "incheon" -> kitLocalized("region.incheon", lang)
    "gwangju" -> kitLocalized("region.gwangju", lang)
    "daejeon" -> kitLocalized("region.daejeon", lang)
    "ulsan" -> kitLocalized("region.ulsan", lang)
    "sejong" -> kitLocalized("region.sejong", lang)
    "gyeonggi" -> kitLocalized("region.gyeonggi", lang)
    "gangwon" -> kitLocalized("region.gangwon", lang)
    "chungbuk" -> kitLocalized("region.chungbuk", lang)
    "chungnam" -> kitLocalized("region.chungnam", lang)
    "jeonbuk" -> kitLocalized("region.jeonbuk", lang)
    "jeonnam" -> kitLocalized("region.jeonnam", lang)
    "gyeongbuk" -> kitLocalized("region.gyeongbuk", lang)
    "gyeongnam" -> kitLocalized("region.gyeongnam", lang)
    "jeju" -> kitLocalized("region.jeju", lang)
    else -> key
}

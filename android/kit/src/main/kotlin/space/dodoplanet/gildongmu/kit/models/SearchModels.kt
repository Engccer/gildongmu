package space.dodoplanet.gildongmu.kit.models

import kotlinx.serialization.Serializable

/** 장소 하나. 웹 `src/lib/types.ts` Place ↔ Kit `SearchModels.swift` 미러(계약 정본은 웹). */
@Serializable
data class Place(
    val id: String,
    val name: String,
    /** 이름 로마자(서버 `romanize.ts`, E28). 한글 이름에만 실린다 — 비-ko는 `bilingualName`으로 병기. */
    val nameRoman: String? = null,
    val category: String,
    /**
     * 분류 경로의 영문(서버 `kakao-category.ts`, A28). 세그먼트 전부 등재일 때만 실린다 — 비-ko 표시는
     * `pickCategory`가 부재를 원문으로 폴백. 판정(`isStation`·칩 버킷)은 `category`만.
     */
    val categoryEn: String? = null,
    val address: String,
    val roadAddress: String,
    val englishAddress: String? = null,
    val lat: Double,
    val lng: Double,
    val phone: String? = null,
    val link: String? = null,
    val distanceMeters: Double? = null,
)

/** 장소 검색 정렬 축(웹 `PlaceSort` 미러). review = 네이버 리뷰 개수순 단독. */
@Serializable
enum class PlaceSort { accuracy, review }

/** 장소 검색 응답 envelope(`/api/places`). provider는 신규 provider 추가에 깨지지 않도록 String. */
@Serializable
data class PlaceSearchResult(val places: List<Place>, val provider: String, val query: String)

/** 행안부 도로명주소(juso) 정규화 결과. 웹 JusoAddress 미러. */
@Serializable
data class JusoAddress(
    val roadAddr: String,
    val roadAddrPart1: String,
    val jibunAddr: String,
    val engAddr: String,
    val zipNo: String,
    val bdNm: String,
)

@Serializable
data class AddressSearchResponse(val addresses: List<JusoAddress>, val query: String)

/** Perplexity 웹 검색 결과. 웹 WebSearchResult 미러. */
@Serializable
data class WebSearchResult(val title: String, val url: String, val snippet: String, val date: String? = null)

@Serializable
data class WebSearchResponse(val web: List<WebSearchResult>)

/** 주소 지오코딩 결과 하나. 웹 AddressMatch 미러(도로명/지번은 존재하는 것만 채워진다). */
@Serializable
data class AddressMatch(
    val addressName: String,
    val roadAddress: String? = null,
    val jibunAddress: String? = null,
    val postalCode: String? = null,
    val lat: Double,
    val lng: Double,
)

/** `/api/geocode` 응답 envelope. */
@Serializable
data class GeocodeResponse(val matches: List<AddressMatch>, val query: String)

/** `/api/geocode/reverse` 응답 envelope. address는 매칭 없으면 null(3-state: 정보 없음 — 조회 실패는 HTTP 오류로 throw). */
@Serializable
data class ReverseGeocodeResponse(
    val address: String? = null,
    /** `lang=en` 요청에서만: juso 공식 영문 주소. 없으면 `addressRoman`(규칙 로마자)이 폴백이다(E28). */
    val addressEn: String? = null,
    val addressRoman: String? = null,
) {
    /** 비-ko 1순위 표시 후보(공식 영문 → 로마자). ko 요청은 null. */
    val english: String? get() = addressEn ?: addressRoman
}

/** 라우트 오류 응답 `{ "error": "..." }`. */
@Serializable
data class APIErrorBody(val error: String)

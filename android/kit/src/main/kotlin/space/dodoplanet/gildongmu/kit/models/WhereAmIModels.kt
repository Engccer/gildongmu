package space.dodoplanet.gildongmu.kit.models

import kotlinx.serialization.Serializable

// "현재 위치 정위"(where-am-i) 계약 모델 — 웹 WhereAmI ↔ Kit `WhereAmIModels.swift` 미러.
// GET /api/where-am-i envelope: 키 없음→{data:null}, 네 조각 전부 비면 502(throw), 그 외 200+data.

/** 주소 한 조각. road/jibun 둘 다 없으면 상위 address 자체가 null(라우트 계약). */
@Serializable
data class WhereAmIAddress(val road: String? = null, val jibun: String? = null)

/** 가장 가까운 도시철도역(1km 내). bearing은 8방위 소문자. */
@Serializable
data class WhereAmIStation(val name: String, val line: String? = null, val bearing: String, val distanceMeters: Int)

/** "현재 위치 정위" 조립 결과 — 주소·행정동·근접역·주변 기준점 네 조각. */
@Serializable
data class WhereAmIData(
    val address: WhereAmIAddress? = null,
    val region: String? = null,
    val nearestStation: WhereAmIStation? = null,
    /** 주변 기준점(거리순). 라우트가 자르지 않는다. */
    val landmarks: List<SurroundingPlace>,
)

@Serializable
data class WhereAmIResponse(val data: WhereAmIData? = null)

package space.dodoplanet.gildongmu.kit.models

import kotlinx.serialization.Serializable

// 무장애 여행 정보 도메인 모델 — 웹 `src/lib/types.ts` BarrierFreePlace·BarrierFreeDetail ↔ Kit
// `BarrierFreeModels.swift` 미러(계약 정본은 웹 + Kit Fixtures/barrier-free-*.json).

/** 무장애 여행 관광지 하나 — 좌표기반 검색 결과 + 계산 거리. */
@Serializable
data class BarrierFreePlace(
    val contentId: String,
    val name: String,
    /** 이름 로마자(E28) */
    val nameRoman: String? = null,
    /** contenttypeid 라벨(빈 문자열 허용) */
    val category: String,
    val address: String,
    val lat: Double,
    val lng: Double,
    /** 출발 좌표로부터 Haversine 거리(m, 반올림) */
    val distanceMeters: Int,
) {
    val id: String get() = contentId
}

/** 무장애 편의시설 항목 하나 — 값이 비어있지 않은 것만 포함된다(3-state 중 "값 있음"만). */
@Serializable
data class BarrierFreeFacility(val key: String, val label: String, val value: String)

/** 무장애 여행 편의시설 상세. facilities는 값이 있는 화이트리스트 항목만 담는다(빈 배열 가능). */
@Serializable
data class BarrierFreeDetail(
    val contentId: String,
    val name: String,
    val nameRoman: String? = null,
    val facilities: List<BarrierFreeFacility>,
)

/** `/api/places/barrier-free` 응답 envelope. */
@Serializable
data class BarrierFreeNearbyResponse(val places: List<BarrierFreePlace>)

/** `/api/places/barrier-free/detail`·`/match` 공용 응답 envelope. 실패·미커버를 `{"detail":null}`로 표현한다(throw 아님). */
@Serializable
data class BarrierFreeDetailResponse(val detail: BarrierFreeDetail? = null)

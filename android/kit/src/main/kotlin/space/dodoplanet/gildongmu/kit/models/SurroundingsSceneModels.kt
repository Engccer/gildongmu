package space.dodoplanet.gildongmu.kit.models

import kotlinx.serialization.Serializable

// 도착지 부근 상황 재구성 — 서버 `/api/surroundings/scene` 응답 1:1 미러(Kit
// `SurroundingsSceneModels.swift`). 좌우·맞은편 계산은 전부 서버에 있고 앱은 소비만 한다.

/** 장소 한 줄 재료. 한 줄 조립(거리+이름+길 단서)은 화면이 i18n 템플릿으로 한다. */
@Serializable
data class SurroundingsSceneItem(
    val name: String,
    /** 이름 로마자(E28) */
    val nameRoman: String? = null,
    val distanceMeters: Int,
    /** 앵커와 다른 도로일 때만 서버가 채운다(같은 도로면 잉여라 null). */
    val road: String? = null,
    /** `road`의 로마자 — 비-ko 장면 문장이 도로명 자리에 쓴다. */
    val roadRoman: String? = null,
    val category: String,
    // 장소 상세 진입 재료 — `sceneItemToPlace`(PlaceProjection, CORE)가 `Place`로 투영한다.
    val id: String,
    val lat: Double,
    val lng: Double,
    /** 카카오 category_name 전체 계층(상세의 역 판별에 필요). */
    val categoryRaw: String,
    /** `categoryRaw`의 영문 경로(A28, 전부 등재일 때만) */
    val categoryEn: String? = null,
    val roadAddress: String? = null,
    val phone: String? = null,
    val link: String? = null,
)

/** 묶음 하나. bucket은 frame에 따라 left|right|across|beyond 또는 8방위. 신규 값 추가에 깨지지 않도록 String. */
@Serializable
data class SurroundingsSceneGroup(val bucket: String, val items: List<SurroundingsSceneItem>)

@Serializable
data class SurroundingsScene(
    /** 위치 확인 문장 재료(행정동 + 도로명주소). 못 얻으면 null. */
    val place: String? = null,
    /** `place`의 로마자(E28). */
    val placeRoman: String? = null,
    /** "entrance" = 입구 기준 좌우, "compass" = 절대 방위 폴백(3-state). */
    val frame: String,
    val groups: List<SurroundingsSceneGroup>,
    val total: Int,
)

@Serializable
data class SurroundingsSceneResponse(
    /** null = 서버 키 미보유(게이트). 소비자가 구성 결함으로 다룬다(빈 결과로 위장 금지). */
    val data: SurroundingsScene? = null,
)

package space.dodoplanet.gildongmu.place

import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.KitJson
import space.dodoplanet.gildongmu.kit.models.CultureEvent
import space.dodoplanet.gildongmu.kit.models.NightClinic
import space.dodoplanet.gildongmu.kit.models.Place

/** 장소 상세 최상단 도메인 섹션 재료(iOS `domainSection` — 그 화면에 온 이유라 서열 1위). 라우트 JSON이라 재생성 뒤에도 남는다(spec 판정 26). */
@Serializable
sealed class PlaceDomain {
    @Serializable data class Clinic(val clinic: NightClinic) : PlaceDomain()
    @Serializable data class Event(val event: CultureEvent) : PlaceDomain()
}

/**
 * 장소 상세 라우트(자기 패키지 소유). 장소는 ID 재조회가 없으므로(카카오 단건 조회 없음, 웹·iOS 계약) **`Place` 전체를 JSON**으로
 * 싣는다 — 프로세스 재생성 뒤에도 백스택이 복원된다(spec §10-7). 도메인 섹션 재료도 같은 이유로 JSON 인자.
 */
@Serializable
data class PlaceDetailRoute(val placeJson: String, val domainJson: String? = null) {
    val place: Place get() = KitJson.decodeFromString(Place.serializer(), placeJson)
    val domain: PlaceDomain? get() = domainJson?.let { KitJson.decodeFromString(PlaceDomain.serializer(), it) }

    companion object {
        fun of(place: Place, domain: PlaceDomain? = null) = PlaceDetailRoute(
            KitJson.encodeToString(Place.serializer(), place),
            domain?.let { KitJson.encodeToString(PlaceDomain.serializer(), it) },
        )
    }
}

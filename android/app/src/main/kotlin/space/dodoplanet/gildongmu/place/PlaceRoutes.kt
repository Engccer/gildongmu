package space.dodoplanet.gildongmu.place

import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.KitJson
import space.dodoplanet.gildongmu.kit.models.Place

/**
 * 장소 상세 라우트(자기 패키지 소유). 장소는 ID 재조회가 없으므로(카카오 단건 조회 없음, 웹·iOS 계약) **`Place` 전체를 JSON**으로
 * 싣는다 — 프로세스 재생성 뒤에도 백스택이 복원된다(spec §10-7).
 */
@Serializable
data class PlaceDetailRoute(val placeJson: String) {
    val place: Place get() = KitJson.decodeFromString(Place.serializer(), placeJson)

    companion object {
        fun of(place: Place) = PlaceDetailRoute(KitJson.encodeToString(Place.serializer(), place))
    }
}

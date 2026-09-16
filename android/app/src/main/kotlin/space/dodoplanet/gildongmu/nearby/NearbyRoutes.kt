package space.dodoplanet.gildongmu.nearby

import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.KitJson
import space.dodoplanet.gildongmu.kit.NearbyCoord

/** 내 주변 화면 종류 — 허브 순서 = iOS `NearbyHubView`(around·subway·bus·bike·clinic·barrierFree·kids·events·walkInfra·conditions). */
@Serializable
enum class NearbyKind { around, subway, bus, bike, clinic, barrierFree, kids, events, walkInfra, conditions }

/**
 * 장소 앵커 — 좌표와 그 좌표의 이름을 함께 옮긴다(장소 상세 "이 장소 주변"). 이름이 딸려 오는 이유: 앵커 화면의 문구는 전부
 * "주변 …"인데 기준점이 현재 위치가 아니라는 사실이 화면 어디에도 없으면 "주변에 없습니다"를 자기 주변으로 읽는다 — 제목에 병기.
 */
@Serializable
data class PlaceAnchor(val lat: Double, val lng: Double, val name: String, val nameRoman: String? = null) {
    val coord: NearbyCoord get() = NearbyCoord(lat, lng)
}

/** 스택 라우트(자기 패키지 소유, README §1). 앵커는 JSON 인자 — 프로세스 재생성 뒤에도 백스택이 복원된다. */
@Serializable
data class NearbyKindRoute(val kind: NearbyKind, val anchorJson: String? = null) {
    val anchor: PlaceAnchor? get() = anchorJson?.let { KitJson.decodeFromString(PlaceAnchor.serializer(), it) }

    companion object {
        fun of(kind: NearbyKind, anchor: PlaceAnchor?) =
            NearbyKindRoute(kind, anchor?.let { KitJson.encodeToString(PlaceAnchor.serializer(), it) })
    }
}

@Serializable
data class BusRouteStopsRoute(val source: String, val cityCode: String?, val routeId: String, val routeNo: String)

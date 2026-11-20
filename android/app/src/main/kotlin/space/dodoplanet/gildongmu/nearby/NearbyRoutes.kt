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

/**
 * 스택 라우트(자기 패키지 소유, README §1). 앵커는 JSON 인자 — 프로세스 재생성 뒤에도 백스택이 복원된다.
 * `directionsEntryAllowed`(iOS 같은 이름, E65): 줄 동작의 「여기까지 길찾기」와 이 화면에서 연 상세의 길찾기 진입을 낼 수 있는가. 길찾기 진입을
 * 숨긴 상세(경유역·안내 시트 목적지)의 「이 장소 주변」은 거짓을 넘긴다 — 프리필이 그 화면을 파괴하기 때문이다(E45 spec §7). 기본값이 없다(안전 인자).
 */
@Serializable
data class NearbyKindRoute(val kind: NearbyKind, val anchorJson: String?, val directionsEntryAllowed: Boolean) {
    val anchor: PlaceAnchor? get() = anchorJson?.let { KitJson.decodeFromString(PlaceAnchor.serializer(), it) }

    companion object {
        fun of(kind: NearbyKind, anchor: PlaceAnchor?, directionsEntryAllowed: Boolean) =
            NearbyKindRoute(kind, anchor?.let { KitJson.encodeToString(PlaceAnchor.serializer(), it) }, directionsEntryAllowed)
    }
}

@Serializable
data class BusRouteStopsRoute(val source: String, val cityCode: String?, val routeId: String, val routeNo: String)

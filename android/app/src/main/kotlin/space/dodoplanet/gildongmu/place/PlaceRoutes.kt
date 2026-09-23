package space.dodoplanet.gildongmu.place

import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.KitJson
import space.dodoplanet.gildongmu.kit.models.CultureEvent
import space.dodoplanet.gildongmu.kit.models.NightClinic
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.transitStopPlace

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
data class PlaceDetailRoute(
    val placeJson: String,
    val domainJson: String? = null,
    /** 채팅에서 연 상세는 "물어보기"를 숨긴다(iOS `showsChatEntry: false`, 순환 방지 — M6 spec §7). */
    val showsChatEntry: Boolean = true,
    /** 경유역 전화번호 조회의 노선 힌트(E44 spec §5.2, iOS `stationLineHint`) — [ofTransitStop]만 싣는다. 그 밖의 상세는 null(자기 `phone`이 전부다). */
    val stationLineHint: String? = null,
    /**
     * "여기까지/여기부터 길찾기"를 보이는가. 경유역 상세([ofTransitStop])는 숨긴다(E45 spec §7, iOS `showsDirectionsEntry: false`) — 길찾기 탭
     * 스택 위에서 열린 상세가 길찾기 탭을 다시 열면 방금 본 조회 결과를 프리필 재조회로 덮는다.
     */
    val showsDirectionsEntry: Boolean = true,
) {
    val place: Place get() = KitJson.decodeFromString(Place.serializer(), placeJson)
    val domain: PlaceDomain? get() = domainJson?.let { KitJson.decodeFromString(PlaceDomain.serializer(), it) }

    companion object {
        fun of(place: Place, domain: PlaceDomain? = null, showsChatEntry: Boolean = true) = PlaceDetailRoute(
            KitJson.encodeToString(Place.serializer(), place),
            domain?.let { KitJson.encodeToString(PlaceDomain.serializer(), it) },
            showsChatEntry,
        )

        /**
         * 경유역 상세(대중교통 투영 `transitStopPlace`). 노선 힌트는 **기본값 없는 필수 인자**다 — 빠뜨리면 컴파일은 통과하고 경유역
         * 전화 줄만 조용히 사라진다. `lineName`은 그 역이 속한 leg의 `lineName`(ODsay 표기)을 누르는 순간 확정해 넘긴다(spec §5.2, 리뷰 M4). null은 leg에 노선명이 없다는 뜻이고 그때는 조회하지 않는다(iOS nil 동형).
         */
        fun ofTransitStop(stop: TransitLegStop, lineName: String?) = PlaceDetailRoute(
            KitJson.encodeToString(Place.serializer(), transitStopPlace(stop)),
            stationLineHint = lineName,
            showsDirectionsEntry = false,
        )
    }
}

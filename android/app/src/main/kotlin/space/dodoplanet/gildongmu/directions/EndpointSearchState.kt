package space.dodoplanet.gildongmu.directions

import androidx.compose.foundation.text.input.TextFieldState
import space.dodoplanet.gildongmu.a11y.Notice
import space.dodoplanet.gildongmu.kit.RecentEndpoint
import space.dodoplanet.gildongmu.kit.RecentEndpointScope
import space.dodoplanet.gildongmu.kit.models.JourneyStopHit
import space.dodoplanet.gildongmu.kit.stationLayoutKind
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.Place

/**
 * 끝점 검색 타깃(iOS `DirectionsFieldTarget` 동형): 길찾기 필드 셋 + 현재 위치 수동 지정(spec §13-3) + 여정 입구·역 칸 셋(B26 단계 5).
 * `manualLocation`은 전용 최근 스코프가 없다 — 도착지 목록을 재사용한다(자주 가는 곳이 지금 서 있는 곳의 후보이기도 하다).
 * `transfer`(입구 검색, 「경유지/자동차 환승 추가」)는 경유지 목록을 쓰고, 역 칸(`boardStation`·`alightStation`)은 최근 목록을 보이지 않는다.
 * ⚠ 새 타깃을 이분 삼항(`from ? A : B`)에 흡수시키지 말 것 — exhaustive `when`.
 */
enum class DirectionsFieldTarget {
    from, to, via, manualLocation, transfer, boardStation, alightStation;

    val recentScope: RecentEndpointScope
        get() = when (this) {
            from -> RecentEndpointScope.from
            to -> RecentEndpointScope.to
            via, transfer -> RecentEndpointScope.via
            manualLocation -> RecentEndpointScope.to
            boardStation, alightStation -> RecentEndpointScope.to // 역 칸은 최근 목록을 보이지 않는다(`isStationTarget`)
        }

    /** 역 칸(E70) — 최근 끝점·주소 후보를 보이지 않는다(분류가 없어 역인지 알 수 없다). */
    val isStationTarget: Boolean get() = this == boardStation || this == alightStation
}

/** 역 칸의 정류장 줄(E70-e) — 거리는 근접 블렌딩과 같은 기준점에서 잰 m(기준점이 없으면 null). */
data class StopRow(val hit: JourneyStopHit, val distance: Int?) {
    val id: String get() = "${hit.name}|${hit.lat}|${hit.lng}"
}

/**
 * 끝점 검색 상태(iOS `EndpointSearchModel` 미러, spec §3-2·§4). 폼을 통째로 교체하는 모달이라 `DirectionsViewModel`이
 * `StateFlow<EndpointSearchState?>`로 든다(null = 폼). 검색어는 `TextFieldState`(IME 조합 경합 회피, M1 판정).
 * `hasSearched`는 tri-state — "검색 전"(최근 섹션 노출)과 "검색함(진행·0건·실패 불문)"을 가른다.
 */
data class EndpointSearchState(
    val target: DirectionsFieldTarget,
    val queryState: TextFieldState = TextFieldState(),
    val places: List<Place> = emptyList(),
    val addresses: List<JusoAddress> = emptyList(),
    val hasSearched: Boolean = false,
    val isSearching: Boolean = false,
    /** 후보 도착 세대 — 화면이 첫 후보 착지 시점을 아는 신호. */
    val candidateRevision: Int = 0,
    val recentEndpoints: List<RecentEndpoint> = emptyList(),
    val notice: Notice = Notice(0, ""),
    /** 지금 탄 열차 역 검색(E71) 모드 — 출발지 시트가 그 자리에서 바뀐다. 최근·주소·현재 위치·정류장 없이 지하철역만 받는다. */
    val aboardMode: Boolean = false,
    /** 「지하철역 검색」 행을 낼 수 있는가 — 출발지 칸이고 여정 입력이 설 때(데이터 로케일 ko)만 참이다(iOS `onSelectAboardStation != nil`). */
    val aboardOffered: Boolean = false,
    /** 정류장 줄(역 칸·입구 검색). 거리순 5건. */
    val stops: List<StopRow> = emptyList(),
    /** 정류장 검색만 실패 — 정류장 자리에 한 줄(장소 줄·받은 정류장 줄은 그대로). */
    val stopsFailed: Boolean = false,
    /** 일부만 받았다 — 정류장 줄 뒤에 할 일을 말하는 한 줄. */
    val stopsTruncated: Boolean = false,
    /** 대상 지역을 못 정했다 — 장소·정류장이 둘 다 0건일 때만 「정류소 정보가 제공되지 않습니다」를 더한다. */
    val showsNoBusData: Boolean = false,
    /** 역 칸·입구 검색에서 장소 검색이 실패했는데 다른 후보(정류장·주소)가 있다 — 역 장소 줄이 없는 이유가 "역 없음"이 아니라 "조회 실패"임을 알린다. */
    val showsPlacesFailure: Boolean = false,
) {
    /** 지하철역·기차역만 고를 수 있는 검색인가(역 칸 + 지금 탄 열차) — 장소 줄이 「고를 수 있는 것」과 「기타 장소」로 갈린다. */
    val stationsOnlyMode: Boolean get() = target.isStationTarget || aboardMode

    /** 역 장소 줄(서버 순서 그대로) — 역 칸이 아니면 장소 전부가 앞쪽이다. */
    val selectablePlaces: List<Place> get() = if (stationsOnlyMode) places.filter { stationLayoutKind(it) != null } else places

    /** 고를 수 없는 장소(「기타 장소」) — 누르면 시트에 남고 통지만 한다(역 칸은 「역이나 정류장을」, 지금 탄 열차는 「지하철역을」). */
    val otherPlaces: List<Place> get() = if (stationsOnlyMode) places.filter { stationLayoutKind(it) == null } else emptyList()

    /** 입구 검색·역 칸이 정류장 줄을 찾는가(지금 탄 열차는 찾지 않는다). */
    val searchesStops: Boolean get() = !aboardMode && (target.isStationTarget || target == DirectionsFieldTarget.transfer)
}

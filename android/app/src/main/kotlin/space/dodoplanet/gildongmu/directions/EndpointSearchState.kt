package space.dodoplanet.gildongmu.directions

import androidx.compose.foundation.text.input.TextFieldState
import space.dodoplanet.gildongmu.a11y.Notice
import space.dodoplanet.gildongmu.kit.RecentEndpoint
import space.dodoplanet.gildongmu.kit.RecentEndpointScope
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.Place

/** 길찾기 필드 식별(iOS `DirectionsFieldTarget` — 수동 위치 지정은 범위 밖이라 셋). */
enum class DirectionsFieldTarget {
    from, to, via;

    val recentScope: RecentEndpointScope
        get() = when (this) {
            from -> RecentEndpointScope.from
            to -> RecentEndpointScope.to
            via -> RecentEndpointScope.via
        }
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
)

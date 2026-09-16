package space.dodoplanet.gildongmu.directions

import androidx.compose.foundation.text.input.TextFieldState
import space.dodoplanet.gildongmu.a11y.Notice
import space.dodoplanet.gildongmu.kit.RecentEndpoint
import space.dodoplanet.gildongmu.kit.RecentEndpointScope
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.Place

/**
 * 끝점 검색 타깃(iOS `DirectionsFieldTarget` 동형): 길찾기 필드 셋 + 현재 위치 수동 지정(spec §13-3). `manualLocation`은 전용 최근 스코프가 없다 —
 * 도착지 목록을 재사용한다(자주 가는 곳이 지금 서 있는 곳의 후보이기도 하다). ⚠ 새 타깃을 이분 삼항(`from ? A : B`)에 흡수시키지 말 것 — exhaustive `when`.
 */
enum class DirectionsFieldTarget {
    from, to, via, manualLocation;

    val recentScope: RecentEndpointScope
        get() = when (this) {
            from -> RecentEndpointScope.from
            to -> RecentEndpointScope.to
            via -> RecentEndpointScope.via
            manualLocation -> RecentEndpointScope.to
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

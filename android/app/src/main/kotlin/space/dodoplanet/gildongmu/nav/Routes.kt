package space.dodoplanet.gildongmu.nav

import kotlinx.serialization.Serializable

/**
 * 최상위 목적지 = 탭 4개(형식 안전 라우트). 화면 스택(장소 상세·내 주변 화면 등)은 각 화면 패키지가 자기 라우트를
 * 이 파일 **밖**(자기 패키지)에 두고 `AppRoot`의 `NavHost`에 한 줄로 등록한다(패키지 소유권 규약, README §1).
 */
@Serializable data object SearchRoute
@Serializable data object DirectionsRoute
@Serializable data object NearbyRoute
@Serializable data object ChatRoute

fun AppTab.route(): Any = when (this) {
    AppTab.search -> SearchRoute
    AppTab.directions -> DirectionsRoute
    AppTab.nearby -> NearbyRoute
    AppTab.chat -> ChatRoute
}

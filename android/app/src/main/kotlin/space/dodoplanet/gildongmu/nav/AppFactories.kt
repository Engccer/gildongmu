package space.dodoplanet.gildongmu.nav

import androidx.lifecycle.ViewModelProvider
import space.dodoplanet.gildongmu.nearby.BusRouteStopsRoute
import space.dodoplanet.gildongmu.nearby.NearbyKind
import space.dodoplanet.gildongmu.nearby.PlaceAnchor
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.location.CurrentAddressStore

/**
 * 화면별 ViewModel 팩토리 묶음(`MainActivity`가 앱 컨텍스트로 조립, Activity 캡처 없음). 라우트 인자에 따라 팩토리가
 * 달라지는 화면은 함수로 받는다. 스택 화면은 각자 자기 패키지의 팩토리 함수를 여기 등록한다.
 */
class AppFactories(
    val search: ViewModelProvider.Factory,
    val nearby: (NearbyKind, PlaceAnchor?) -> ViewModelProvider.Factory,
    val busRouteStops: (BusRouteStopsRoute) -> ViewModelProvider.Factory,
    val place: (Place) -> ViewModelProvider.Factory,
    /** "정확한 위치 허용" — 시스템 다이얼로그 뒤 정밀 권한이면 true. */
    val requestPreciseLocation: suspend () -> Boolean,
    /** 기기 위치 서비스 켜짐 여부(렌더 시 판정, spec §3-5). */
    val isLocationEnabled: () -> Boolean,
    /** 허브 첫 행 표시줄의 주소 스토어(앱 싱글턴, spec §12-4). */
    val currentAddress: CurrentAddressStore,
)

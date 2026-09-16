package space.dodoplanet.gildongmu.directions

import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.location.LocationPermission
import space.dodoplanet.gildongmu.location.LocationStore
import space.dodoplanet.gildongmu.location.PermissionGate

/**
 * 길찾기가 위치 계층에서 쓰는 세 함수(spec §6). 프로덕션은 M2 `LocationStore`·`PermissionGate`로의 **통과 호출**이고,
 * 인터페이스가 남는 이유는 JVM 테스트의 페이크 자리 하나다(`LocationStore`를 `LocationSource`·`PermissionGate`
 * 페이크로 조립하는 것보다 세 함수 페이크가 짧다).
 */
interface EndpointLocator {
    /** 조회 시점 측위(권한 다이얼로그 허용). 실패는 `LocationException(kind ∈ Denied·ReducedAccuracy·Unavailable)`. 취소는 그대로. */
    suspend fun currentCoordinate(force: Boolean): NearbyCoord

    /** 라벨 병기·후보 정렬용 soft 좌표 — 권한 없으면 팝업 없이 null, 실패는 스토어 폴백(없으면 null). */
    suspend fun coordinateForRanking(): NearbyCoord?

    /** "정확한 위치 허용" — 권한 재요청 뒤 FINE이면 true(M2 §4 `allowPrecise` 절차). */
    suspend fun requestPreciseLocation(): Boolean
}

class LocationStoreLocator(private val store: LocationStore, private val permissions: PermissionGate) : EndpointLocator {
    override suspend fun currentCoordinate(force: Boolean): NearbyCoord = store.currentCoordinate(force = force)
    override suspend fun coordinateForRanking(): NearbyCoord? = store.gpsCoordinateForRanking()
    override suspend fun requestPreciseLocation(): Boolean = permissions.request() == LocationPermission.Fine
}

fun directionsLocator(): EndpointLocator = LocationStoreLocator(AppConfig.locationStore, AppConfig.permissionGate)

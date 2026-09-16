package space.dodoplanet.gildongmu.location

import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.NearbyCoordinateSource
import space.dodoplanet.gildongmu.kit.NearbyLocationError

/**
 * 조회용 유효 좌표 — **앱 층의 좌표 진입점은 이것뿐**(spec 판정 38; iOS `ManualLocationJudge.effectiveCoordinate` + `LocationService`의 수동 우선,
 * 웹 `effective-location.ts` 미러). 우선순위 장소 앵커(`NearbyCoordinateSource.Fixed`, 여기 오지 않는다) > 수동 위치 > GPS.
 * 소비자: 내 주변(허브 진입 화면) · 검색 거리 가중 · 길찾기 출발지·끝점 후보 근접 가중 · 채팅 앵커(M6). 표시줄 주소 조회(`coordinateForDisplay`)와
 * 실시간 안내는 실좌표라 여기를 지나지 않는다. `LocationStore`를 직접 잡는 화면이 없도록 소스 가드가 잠근다.
 */
class EffectiveLocation(
    private val location: LocationStore,
    private val manual: ManualLocationStore,
    private val judge: ManualLocationJudge,
) {
    /** `force`는 "지금 어디 있는가"를 다시 묻는 행동이라 수동 위치라도 판정을 동반한다 — 없으면 앱을 켠 채 걸어가는 동안 복귀 트리거가 영영 안 온다. */
    suspend fun coordinate(force: Boolean): NearbyCoord {
        manual.awaitHydrated()
        if (force) judge.run(force = true)
        manual.current.value?.let { return NearbyCoord(it.lat, it.lng) }
        return location.currentCoordinate(force)
    }

    /** 순위 가중·주소 병기용 soft 좌표 — 수동이면 그 좌표(**측위 없음**), 아니면 GPS soft 게이트(팝업 없음, 스토어 폴백). */
    suspend fun coordinateForRanking(): NearbyCoord? {
        manual.awaitHydrated()
        manual.current.value?.let { return NearbyCoord(it.lat, it.lng) }
        return location.gpsCoordinateForRanking()
    }

    /**
     * 채팅 전송 직전 prime(iOS `currentCoordinate(timeout: softTimeout)` 자리, M6 spec §4-1): 수동이면 **측위 0**(판정 35 — 수동 상태의 GPS 측위는
     * 판정뿐), 아니면 soft 상한 GPS(첫 사용이면 권한 다이얼로그 — spec §4의 세 자리 중 하나). 실패는 호출자가 삼킨다(위치는 필수가 아니다).
     */
    suspend fun prime(timeoutMs: Long) {
        manual.awaitHydrated()
        if (manual.current.value != null) return
        location.currentCoordinate(timeoutMs = timeoutMs)
    }

    /** 동기 마지막 좌표(iOS `lastCoordinate` 자리 — 채팅 요청 본문): 수동 > GPS 저장 좌표. suspend 경로(`prime`) **뒤에** 읽는 소비자용(hydration 불변식). */
    fun last(): NearbyCoord? = manual.current.value?.let { NearbyCoord(it.lat, it.lng) } ?: location.stored?.let { NearbyCoord(it.lat, it.lng) }

    /** :kit 코어 어댑터. 취소는 그대로 통과(`LocationException`만 번역), 어댑터 자신의 타임아웃은 `Unavailable`. */
    fun nearbyCoordinateSource(): NearbyCoordinateSource = NearbyCoordinateSource.Current { force ->
        try {
            coordinate(force)
        } catch (e: LocationException) {
            throw when (e.kind) {
                LocationException.Kind.Denied -> NearbyLocationError.Denied
                LocationException.Kind.ReducedAccuracy -> NearbyLocationError.ReducedAccuracy
                LocationException.Kind.Unavailable -> NearbyLocationError.Unavailable
            }
        }
    }
}

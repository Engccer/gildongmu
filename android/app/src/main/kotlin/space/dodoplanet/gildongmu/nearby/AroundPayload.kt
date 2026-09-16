package space.dodoplanet.gildongmu.nearby

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.models.NearbyOverview
import space.dodoplanet.gildongmu.kit.NearbyService
import space.dodoplanet.gildongmu.kit.models.SurroundingPlace

/**
 * 둘러보기 한 커밋 payload(iOS `AroundPayload` — M2는 조망·목록 두 조각, "주변 상황" 조각은 M2b가 여기에 더한다). 두 조각을 한
 * fetch로 받아 한 번에 커밋한다(코어 계약: 첫 착지 1회·통지 1회·latest-wins). 조각별 실패는 payload에 남겨 그 자리에 실패 문장으로.
 */
data class AroundPayload(
    /** 조회 좌표 — 지금은 소비처가 없고 M6 "이 위치에 관해 물어보기"(`overviewAnchorPlace`)가 쓴다(iOS 동형). */
    val lat: Double,
    val lng: Double,
    /** null = data null(전 키 부재) 또는 실패(`overviewFailed`로 가른다). */
    val overview: NearbyOverview?,
    val overviewFailed: Boolean,
    /** null = 조회 실패. 0건은 빈 리스트. */
    val places: List<SurroundingPlace>?,
    val placesFailed: Boolean,
) {
    /** 두 조각 다 비었고 실패도 아닌 상태(전 키 부재) — 빈 문구 판정. 실패는 조각 자리의 문장이 말한다. */
    val isAllAbsent: Boolean get() = overview == null && !overviewFailed && !placesFailed && places.isNullOrEmpty()
}

/** allSettled 한 조각(서버 `Promise.allSettled` 동형). 취소는 삼키지 않는다(README §3 — `runCatching` 금지). */
suspend fun <T> settled(block: suspend () -> T): Result<T> = try {
    Result.success(block())
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    Result.failure(e)
}

/** 둘러보기 fetch. 둘 다 실패해야 throw(코어 `FailedServer`); 하나라도 성공이면 loaded. */
suspend fun fetchAround(service: NearbyService, coord: NearbyCoord): AroundPayload = coroutineScope {
    val overview = async { settled { service.nearbyOverview(coord.lat, coord.lng) } }
    val places = async { settled { service.surroundings(coord.lat, coord.lng) } }
    val o = overview.await()
    val p = places.await()
    if (o.isFailure && p.isFailure) throw o.exceptionOrNull()!!
    AroundPayload(
        lat = coord.lat, lng = coord.lng,
        overview = o.getOrNull(), overviewFailed = o.isFailure,
        places = p.getOrNull(), placesFailed = p.isFailure,
    )
}

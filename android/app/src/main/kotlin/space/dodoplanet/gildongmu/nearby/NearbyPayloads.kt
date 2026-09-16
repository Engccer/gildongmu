package space.dodoplanet.gildongmu.nearby

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import space.dodoplanet.gildongmu.kit.APIError
import space.dodoplanet.gildongmu.kit.ConditionsService
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.net.settled
import space.dodoplanet.gildongmu.kit.WalkInfraService
import space.dodoplanet.gildongmu.kit.models.AirQuality
import space.dodoplanet.gildongmu.kit.models.Congestion
import space.dodoplanet.gildongmu.kit.models.NightClinic
import space.dodoplanet.gildongmu.kit.models.Weather
import space.dodoplanet.gildongmu.kit.models.WalkInfrastructure

// M2b kind들의 한 커밋 payload(spec §12-1).

/** 소아 진료(iOS `ClinicPayload`) — 화면이 밝히는 메타 두 값만(공휴일 기준·보완 실패). */
data class ClinicPayload(val clinics: List<NightClinic>, val basis: String, val supplementFailed: Boolean)

/** 보행 인프라(iOS `WalkInfraPayload`) — `asOf`는 커밋 시각의 앱 언어 short time(헤딩이자 착지 지점). */
data class WalkInfraPayload(val walk: WalkInfrastructure, val asOf: String)

suspend fun fetchWalkInfra(service: WalkInfraService, coord: NearbyCoord, now: () -> String): WalkInfraPayload =
    WalkInfraPayload(service.nearby(coord.lat, coord.lng), now())

/**
 * 날씨·공기질·혼잡도 한 커밋 payload(iOS `ConditionsPayload`). weather·air의 null = 조회 실패 또는 부재(둘 다 "가져오지 못했습니다"),
 * `fresh*`는 이번 호출의 성공 여부(통지 판정 전용). congestion의 null은 성격이 다르다: 부재가 정상이라 아무것도 그리지 않는다.
 */
data class ConditionsPayload(
    val weather: Weather?,
    val air: AirQuality?,
    val congestion: Congestion?,
    val freshWeather: Boolean,
    val freshAir: Boolean,
)

private fun <T> Result<T>.isOutOfCoverage() = exceptionOrNull() is APIError.OutOfCoverage

/**
 * iOS `ConditionsModel.fetch` 이식: 조각별 독립(`settled` — 취소는 통과), 서버 커버리지 마커 이중 방어(한쪽이라도 감지하면 부분 데이터를
 * 버리고 화면 전체를 전환), 재조회 실패 조각은 직전 값 유지(재조회이지 데이터 포기 아님), **혼잡도만 성공한 null을 덮어쓴다**(이동 뒤
 * 새로고침에서 옛 영역이 남아 다른 동네 혼잡도를 이 자리 정보로 낭독하지 않게 — 성공 null은 "핫스팟 밖"이라는 답이다).
 */
suspend fun fetchConditions(service: ConditionsService, coord: NearbyCoord, previous: ConditionsPayload?): ConditionsPayload = coroutineScope {
    val w = async { settled { service.weather(coord.lat, coord.lng) } }
    val a = async { settled { service.air(coord.lat, coord.lng) } }
    val c = async { settled { service.congestion(coord.lat, coord.lng) } }
    val wr = w.await(); val ar = a.await(); val cr = c.await()
    if (wr.isOutOfCoverage() || ar.isOutOfCoverage() || cr.isOutOfCoverage()) throw APIError.OutOfCoverage
    val weather = wr.getOrNull()
    val air = ar.getOrNull()
    ConditionsPayload(
        weather = weather ?: previous?.weather,
        air = air ?: previous?.air,
        congestion = if (cr.isSuccess) cr.getOrNull() else previous?.congestion,
        freshWeather = weather != null,
        freshAir = air != null,
    )
}

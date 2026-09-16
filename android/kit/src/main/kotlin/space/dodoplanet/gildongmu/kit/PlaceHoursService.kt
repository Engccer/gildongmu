package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable

/**
 * 장소 상세 영업시간 한 줄(E24) — 서버 `/api/places/hours` 응답(웹 `PlaceHoursToday` ↔ Kit `PlaceHoursService.swift` 미러).
 * `ranges`가 비고 `allDay`도 거짓이면 **오늘 휴무**(시간표에 다른 요일은 있다).
 */
@Serializable
data class PlaceHoursToday(val ranges: List<Range>, val allDay: Boolean) {
    @Serializable
    data class Range(val open: String, val close: String, val closesNextDay: Boolean)
}

@Serializable
internal data class PlaceHoursResponse(val hours: PlaceHoursToday? = null)

/**
 * 요청 상한(밀리초, Swift `requestTimeout` 4초). 캐시 금지(약관)라 상세 열람마다 실호출이 끼므로 상한 없이는
 * upstream이 느릴 때 이 줄 하나가 화면을 세운다 — 웹 `AbortSignal.timeout(3000)`과 짝(양 플랫폼 동일 상한).
 */
private const val requestTimeoutMs = 4_000L

/**
 * 비-throw 매칭 보조(무장애 `match` 동형): 네트워크·디코딩·`{"hours":null}`·429 전부 null로 수렴해 호출부가 줄을
 * 만들지 않는다. ⚠ 이 출력은 스크린 리더만 읽는다 — TTS 안내·채팅으로 흘려보내지 말 것(Google 약관
 * §3.2.3(a)(iv), 웹 `place-hours-tts-drift.test.ts`).
 */
class PlaceHoursService(val client: APIClient) {
    suspend fun today(lat: Double, lng: Double, name: String, roadAddress: String): PlaceHoursToday? {
        val query = coordQuery(lat, lng).toMutableList()
        query.add("name" to name)
        if (roadAddress.isNotEmpty()) query.add("roadAddress" to roadAddress)
        return optional { client.get<PlaceHoursResponse>("/api/places/hours", query, timeoutMs = requestTimeoutMs) }?.hours
    }
}

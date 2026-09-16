package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable

/**
 * `/api/transit/track` 판별 union 응답(B2 §7). status: "ok" | "empty" | "unsupported". Kit `TransitTrackService.swift` 미러.
 * upstream 오류는 502 → `APIClient`가 던진다(클라는 failed로 소비).
 */
@Serializable
data class TransitTrackEnvelope(
    val mode: String,
    val status: String,
    val items: List<TransitTrackItem>? = null,
    /** 노선·경로 필터 전 원시 건수(§13.3, additive) — empty ∧ rawCount>0 = 필터 전멸. */
    val rawCount: Int? = null,
    val stop: TransitTrackResolvedStop? = null,
)

/** 지방버스 하차 정류소 해석 결과(mode=tagoBus&phase=resolve). */
@Serializable
data class TransitTrackResolvedStop(val nodeId: String, val cityCode: String, val name: String)

/**
 * 대중교통 추적 폴링 서비스 — 봉투 해석 없이 그대로 디코딩한다(서버가 판별 union으로 provider 차이를 이미 흡수했다, §7).
 * 폴링 판정·상태는 TransitGuide 상태 머신 몫. 전송은 `HttpTransport`(:app 구현)이 맡는다(D5 경계).
 */
class TransitTrackService(private val client: APIClient) {
    private suspend fun get(query: List<QueryItem>): TransitTrackEnvelope =
        client.get("/api/transit/track", query, TransitTrackEnvelope.serializer())

    /**
     * ⚠ `lang`은 **기본값 없는 필수 인자**다(E27 잔여 ①, spec 2026-09-01 §3.3) — 생략이 컴파일을 통과하면 실시간 줄만
     * 조용히 한국어로 떨어지고 서버는 400도 내지 않는다(부재 = ko가 정상 계약).
     */
    suspend fun seoulWait(arsId: String, routeId: String, lang: String): TransitTrackEnvelope = get(
        listOf("mode" to "seoulBus", "phase" to "wait", "arsId" to arsId, "routeId" to routeId, "lang" to lang),
    )

    suspend fun seoulRide(routeId: String, boardId: String, alightId: String, lang: String): TransitTrackEnvelope = get(
        listOf(
            "mode" to "seoulBus", "phase" to "ride", "routeId" to routeId,
            "boardId" to boardId, "alightId" to alightId, "lang" to lang,
        ),
    )

    /**
     * ⚠ `lang` 없음 — 응답의 `stop.name`을 소비자가 표시하지 않고(nodeId·cityCode만 쓴다) TAGO 정류소명에는 영문 원천도
     * 없다. 표시가 생기면 그때 `lang`을 더한다.
     */
    suspend fun resolveTagoStop(lat: Double, lng: Double): TransitTrackEnvelope = get(
        listOf("mode" to "tagoBus", "phase" to "resolve") + coordQuery(lat, lng),
    )

    suspend fun tagoTrack(cityCode: String, nodeId: String, routeNo: String, lang: String): TransitTrackEnvelope = get(
        listOf(
            "mode" to "tagoBus", "phase" to "track", "cityCode" to cityCode,
            "nodeId" to nodeId, "routeNo" to routeNo, "lang" to lang,
        ),
    )

    suspend fun subwayTrack(station: String, line: String, lang: String): TransitTrackEnvelope = get(
        listOf("mode" to "subway", "phase" to "track", "station" to station, "line" to line, "lang" to lang),
    )

    companion object {
        /** 응답 → 상태 머신 입력. failed 변환은 호출자(catch) 몫. */
        fun poll(envelope: TransitTrackEnvelope): TransitTrackPoll = when (envelope.status) {
            "ok" -> TransitTrackPoll.Ok(envelope.items ?: emptyList())
            "empty" -> TransitTrackPoll.Empty
            else -> TransitTrackPoll.Unsupported
        }
    }
}

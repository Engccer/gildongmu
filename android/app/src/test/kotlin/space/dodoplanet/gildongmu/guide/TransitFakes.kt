package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import space.dodoplanet.gildongmu.directions.CatalogStrings
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.GuideSessionCoordinator
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.HttpTransport
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.RouteService
import space.dodoplanet.gildongmu.kit.TransitPositionService
import space.dodoplanet.gildongmu.kit.TransitTrackService
import kotlinx.serialization.json.Json
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteEnvelope
import space.dodoplanet.gildongmu.kit.models.TransitRouteResult
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.models.TransitRouteSummary

/** 대중교통 모델 하네스 — `Fakes.kt`의 포트 페이크를 그대로 쓴다. 시간원은 가상 스케줄러 하나(단조 초 = 벽시계 ms/1000). */
class TransitGuideHarness(
    private val dispatcher: TestDispatcher,
    /** 추적 응답 큐: 호출마다 하나씩 꺼내 쓰고 비면 `empty`. 값은 (본문, 지연 ms). */
    val trackReplies: ArrayDeque<Pair<String, Long>> = ArrayDeque(),
) {
    val catalog = CatalogStrings("ko")
    val controller = FakeController()
    val perms = FakePermissions()
    val tones = FakeTones()
    val speaker = FakeSpeaker()
    val haptics = FakeHaptics()
    val env = FakeEnv()
    val coordinator = GuideSessionCoordinator()
    val store = InMemoryKeyValueStore()
    /** 도보 모델의 「시작 대기」(`GuideSession.isActive`의 한 갈래) 흉내. */
    var walkStarting = false
    /** 위치 포트(3-2): 호출마다 `force` 값을 기록한다. `coordinateFails`가 켜져 있으면 예외로 끝난다(iOS `LocationService.currentCoordinate`의 throw). */
    val coordinateCalls = mutableListOf<Boolean>()
    var coordinateFails = false
    var coordinate = NearbyCoord(37.5400, 127.1200)
    /** 시트 최소화 여부 포트(3-2, iOS `GuideSession.isMinimized`). */
    var minimized = false
    /** 켜면 다음 추적 호출이 HTTP 실패로 끝난다(`TransitTrackPoll.Failed`). */
    var failNextTrack = false
    val seenUrls = mutableListOf<String>()
    /** 경로 조각별 응답 큐(3-1): url이 조각을 담으면 추적 큐 대신 여기서 꺼낸다. 큐가 비면 `pathDefaults`(없으면 추적 큐). 값은 (HTTP 상태, 본문, 지연 ms). */
    class PathReply(val status: Int, val body: String, val delayMs: Long = 0)
    val pathReplies = mutableMapOf<String, ArrayDeque<PathReply>>()
    private val pathDefaults = mapOf(
        // 승차 중 현재역 조회(`/api/transit/position`)는 추적 큐를 먹지 않는다 — 기본은 「그 열차는 없다」.
        "/api/transit/position" to PathReply(200, """{"status":"notFound","total":3}"""),
    )
    fun queuePath(fragment: String, reply: PathReply) { pathReplies.getOrPut(fragment) { ArrayDeque() }.addLast(reply) }
    private fun nextPathReply(url: String): PathReply? {
        for ((fragment, queue) in pathReplies) if (url.contains(fragment)) queue.removeFirstOrNull()?.let { return it }
        return pathDefaults.entries.firstOrNull { url.contains(it.key) }?.value
    }
    val job = SupervisorJob()
    private val client = APIClient("https://example.test", object : HttpTransport {
        override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
            seenUrls += url
            nextPathReply(url)?.let { r ->
                if (r.delayMs > 0) withContext(NonCancellable) { delay(r.delayMs) }
                return HttpResponse(r.status, r.body)
            }
            if (failNextTrack) { failNextTrack = false; return HttpResponse(500, "") }
            val (body, delayMs) = trackReplies.removeFirstOrNull() ?: (EMPTY_TRACK to 0L)
            if (delayMs > 0) withContext(NonCancellable) { delay(delayMs) }
            return HttpResponse(200, body)
        }
    })
    /** 단조 초이자 벽시계(ms/1000) — 가상 시간이 곧 시계다. */
    val now: () -> Double = { 1000.0 + dispatcher.scheduler.currentTime / 1000.0 }
    val model = TransitGuideModel(
        routes = RouteService(client),
        track = TransitTrackService(client),
        position = TransitPositionService(client),
        strings = catalog,
        dataLocale = { DataLocale.ko },
        controller = controller,
        permissions = perms,
        tones = tones.also { it.clock = now },
        speaker = speaker,
        haptics = haptics,
        env = env,
        coordinator = coordinator,
        isSessionActive = { coordinator.isActive || walkStarting },
        currentCoordinate = { force ->
            coordinateCalls += force
            if (coordinateFails) error("no fix")
            coordinate
        },
        isMinimized = { minimized },
        store = store,
        scope = CoroutineScope(job + dispatcher),
        clock = now,
        wallClockMs = { now() * 1000.0 },
        io = dispatcher,
    )
    val dest = BeaconDest(37.5265, 126.9246)

    /** 경로 조회(`/api/route/transit`) 응답을 큐에 넣는다 — null 결과는 「경로 없음」, `status`가 500이면 조회 실패(3-state). */
    fun queueRoute(result: TransitRoute?, status: Int = 200, delayMs: Long = 0, alternatives: List<TransitRoute> = emptyList()) {
        val body = Json.encodeToString(
            TransitRouteEnvelope.serializer(),
            TransitRouteEnvelope(result?.let { TransitRouteResult(recommended = it, alternatives = alternatives, totalCandidates = 1 + alternatives.size) }),
        )
        queuePath("/api/route/transit", PathReply(status, body, delayMs))
    }
    val routeCalls: List<String> get() = seenUrls.filter { it.contains("/api/route/transit") }
    fun close() { job.cancel() }

    fun subwayRoute(): TransitRoute = TransitRoute(
        summary = TransitRouteSummary(totalMinutes = 30, fare = 1500, transfers = 0, walkMinutes = 8, departName = "천호", arriveName = "여의도"),
        legs = listOf(
            TransitRouteLeg(mode = "walk", minutes = 3),
            TransitRouteLeg(mode = "subway", lineName = "수도권 5호선", fromName = "천호", toName = "여의도", stationCount = 8, minutes = 20, serviceWayCode = 2),
            TransitRouteLeg(mode = "walk", minutes = 5),
        ),
        routeKey = "p0",
    )

    /** 추적 불가 구간(지하철도 서울버스도 아닌 수단) — 폴 주기가 0이다. */
    fun untrackableRoute(): TransitRoute = TransitRoute(
        summary = TransitRouteSummary(totalMinutes = 30, fare = 1500, transfers = 0, walkMinutes = 0, departName = "가", arriveName = "나"),
        legs = listOf(TransitRouteLeg(mode = "bus", lineName = "마을", fromName = "가", toName = "나", stationCount = 5, minutes = 20)),
        routeKey = "p1",
    )

    companion object {
        const val EMPTY_TRACK = """{"mode":"subway","status":"empty","rawCount":0}"""
        fun okTrack(vehicleId: String, destinationName: String = "방화") =
            """{"mode":"subway","status":"ok","rawCount":1,"items":[{"vehicleId":"$vehicleId","direction":"하행","message":"전역 출발","remainingStops":null,"destinationName":"$destinationName","express":false,"arrivalCode":"2"}]}"""
    }
}

fun transitTest(dispatcher: TestDispatcher, body: suspend TestScope.(TransitGuideHarness) -> Unit) = runTest(dispatcher) {
    val h = TransitGuideHarness(dispatcher)
    try { body(h) } finally { h.close() }
}

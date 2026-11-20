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
import space.dodoplanet.gildongmu.kit.RouteService
import space.dodoplanet.gildongmu.kit.TransitPositionService
import space.dodoplanet.gildongmu.kit.TransitTrackService
import space.dodoplanet.gildongmu.kit.models.TransitRoute
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
    val seenUrls = mutableListOf<String>()
    val job = SupervisorJob()
    private val client = APIClient("https://example.test", object : HttpTransport {
        override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
            seenUrls += url
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
        store = store,
        scope = CoroutineScope(job + dispatcher),
        clock = now,
        wallClockMs = { now() * 1000.0 },
        io = dispatcher,
    )
    val dest = BeaconDest(37.5265, 126.9246)
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
        fun okTrack(vehicleId: String) =
            """{"mode":"subway","status":"ok","rawCount":1,"items":[{"vehicleId":"$vehicleId","direction":"하행","message":"전역 출발","remainingStops":null,"destinationName":"방화","express":false,"arrivalCode":"2"}]}"""
    }
}

fun transitTest(dispatcher: TestDispatcher, body: suspend TestScope.(TransitGuideHarness) -> Unit) = runTest(dispatcher) {
    val h = TransitGuideHarness(dispatcher)
    try { body(h) } finally { h.close() }
}

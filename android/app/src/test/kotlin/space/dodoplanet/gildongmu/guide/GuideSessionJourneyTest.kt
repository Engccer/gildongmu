package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.BeaconTone
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.JourneyEvent
import space.dodoplanet.gildongmu.kit.JourneyPhase
import space.dodoplanet.gildongmu.kit.JourneyStage
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.RoutePoint
import space.dodoplanet.gildongmu.kit.models.CarRouteBriefing
import space.dodoplanet.gildongmu.kit.models.EgressKind
import space.dodoplanet.gildongmu.kit.models.EgressOption
import space.dodoplanet.gildongmu.kit.models.JourneyEgress
import space.dodoplanet.gildongmu.kit.models.JourneyStationRef
import space.dodoplanet.gildongmu.kit.models.JourneyTotals
import space.dodoplanet.gildongmu.kit.models.JourneyVariant
import space.dodoplanet.gildongmu.kit.models.JourneyVariantKind
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.models.TransitRouteSummary
import space.dodoplanet.gildongmu.location.LocationPermission
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 도보 워치독이 무한 루프라 `advanceUntilIdle`은 끝나지 않는다 — 현재 시각의 태스크만 소진한다. */
@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.settle() { runCurrent(); advanceTimeBy(1); runCurrent() }

/** 가상 시간을 `ms`만큼 밀고 그 시각의 태스크를 소진한다. */
@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.after(ms: Long) { advanceTimeBy(ms); runCurrent() }

// ── 가상 지명·둥근 좌표 — 모든 단계의 목적지는 같은 점(북 315m)이다. 단계 사이의 거리는 `here`(캐시 위치)로만 가른다 ──

private val DEST_POINT = north(315.0).let { RoutePoint(it.lat, lng0) }
private val DEST = BeaconDest(DEST_POINT.lat, DEST_POINT.lng)

private fun p(r: RoutePoint) = "{\"lat\":${r.lat},\"lng\":${r.lng}}"

/** 북진 `length`m 자동차 경로(도로 하나) — `WalkGuideJourneyChainTest`의 축약판. */
private fun carRouteJson(length: Double): String {
    val end = north(length)
    return "{\"distanceMeters\":${length.toInt()},\"durationSeconds\":120,\"taxiFare\":0,\"tollFare\":0,\"guides\":[" +
        "{\"name\":\"가상사거리\",\"guidance\":\"가상대로를 따라 ${length.toInt()}m 이동\",\"distanceMeters\":${length.toInt()},\"durationSeconds\":120," +
        "\"pathCoords\":[${p(RoutePoint(north(0.0).lat, lng0))},${p(RoutePoint(end.lat, lng0))}],\"roadLinks\":[{\"name\":\"가상대로\",\"distanceMeters\":${length.toInt()}}]}" +
        "],\"provider\":\"tmap\",\"terminalCoord\":${p(RoutePoint(end.lat, lng0))}}"
}

private val WALK_ROUTE_JSON = walkBriefingJson(
    steps = listOf(TestStep("가상대로를 따라 300m 이동", listOf(north(0.0), north(300.0)), target = "가상역")),
    distanceMeters = 300,
    finalApproach = "{\"offsetMeters\":20,\"relativeBearing\":0,\"bearingUnavailable\":null}",
)

private fun respond(url: String) = HttpResponse(200, if (url.contains("/api/route/car")) carRouteJson(315.0) else WALK_ROUTE_JSON)

private fun stops(vararg names: String) = names.mapIndexed { i, n -> TransitLegStop(name = n, lat = 37.5 + i * 0.01, lng = 127.0 + i * 0.01) }

/** 탑승 구간 하나(지하철, 경유역 있음). 앞·뒤 도보는 선택 — 여정 변형의 경로는 원래 앞뒤 도보를 자른 것이다. */
private fun transitRoute(leadingWalk: Boolean = false, trailingWalk: Boolean = false): TransitRoute {
    val ride = TransitRouteLeg(
        mode = "subway", lineName = "수도권 5호선", fromName = "가상출발", toName = "가상도착", stationCount = 3, minutes = 15, serviceWayCode = 2,
        stops = stops("가상출발", "가상중간1", "가상중간2", "가상도착"),
    )
    return TransitRoute(
        summary = TransitRouteSummary(totalMinutes = 25, fare = 1500, transfers = 0, walkMinutes = 0, departName = "가상출발", arriveName = "가상도착"),
        legs = (if (leadingWalk) listOf(TransitRouteLeg(mode = "walk", minutes = 3)) else emptyList()) + ride +
            (if (trailingWalk) listOf(TransitRouteLeg(mode = "walk", minutes = 5)) else emptyList()),
        routeKey = "j0",
    )
}

private fun taxi() = CarRouteBriefing(distanceMeters = 315, durationSeconds = 120, taxiFare = 0, tollFare = 0, guides = emptyList())

private fun station(name: String) = JourneyStationRef(name, DEST_POINT)

private fun egressOption(kind: EgressKind) = EgressOption(
    kind = kind, label = if (kind == EgressKind.exit) "3" else "", placeName = if (kind == EgressKind.exit) "가상도착역 3번출구" else "",
    lineName = null, coord = DEST_POINT, taxiOut = taxi(),
)

/**
 * 여정 계획. `taxiIn`이 역 A 지정, `egress`가 역 B 지정(null이면 미지정)과 출구 종류다.
 */
private fun plan(
    taxiIn: Boolean,
    egress: EgressKind?,
    transit: TransitRoute = transitRoute(),
    aboard: TransitAboardStart? = null,
): JourneyPlan {
    val option = egress?.let { egressOption(it) }
    val variant = JourneyVariant(
        kind = JourneyVariantKind.recommended,
        boardStation = if (taxiIn) station("가상출발역") else null,
        alightStation = if (egress != null) station("가상도착역") else null,
        taxiIn = if (taxiIn) taxi() else null,
        transit = transit,
        egress = option?.let { JourneyEgress(options = listOf(it), lookupFailed = null) },
        totals = JourneyTotals(minutes = 30, taxiFare = 0, transitFare = 1500),
    )
    return JourneyPlan(variant = variant, egress = option, destLabel = "가상목적지", dest = DEST, aboard = aboard)
}

private fun trackBoth() =
    """{"mode":"subway","status":"ok","rawCount":2,"items":[""" +
        """{"vehicleId":"vDown","direction":"하행","message":"전역 출발","remainingStops":null,"destinationName":"방화","express":false,"arrivalCode":"2"},""" +
        """{"vehicleId":"vUp","direction":"상행","message":"전역 출발","remainingStops":null,"destinationName":"하남검단산","express":false,"arrivalCode":"2"}]}"""

/** 서비스 손잡이 페이크(`GuideServiceRelay`의 주입 함수) — 다음 메인 턴(`post`)은 큐에 쌓아 테스트가 돌린다. */
private class RelayRig {
    val launches = mutableListOf<Int>()
    val rebinds = mutableListOf<Int>()
    var shutdowns = 0
    var live = false
    private val queue = ArrayDeque<() -> Unit>()
    val relay = GuideServiceRelay(
        launch = { generation -> launches += generation; live = true; null },
        onStartFailed = { generation, error -> GuideSession.serviceStartFailed(generation, error) },
        shutdown = { shutdowns++; live = false },
        rebind = { generation -> rebinds += generation; live },
        serviceLive = { live },
        post = { queue.addLast(it) },
    )
    val controller: FakeController = RelayController(relay)

    /** 쌓인 "다음 메인 턴" 작업을 순서대로 돌린다. */
    fun runPosts() { while (queue.isNotEmpty()) queue.removeFirst()() }
}

/** 두 모델이 한 손잡이를 쓴다 — 앱 조립(`AndroidGuideController`)과 같은 모양. */
private class RelayController(private val relay: GuideServiceRelay) : FakeController() {
    override fun nextGeneration(): Int = relay.nextGeneration()
    override fun start(generation: Int) { relay.start(generation) }
    override fun stop(generation: Int) { relay.stop(generation) }
}

private class J(val w: GuideTestHarness, val t: TransitGuideHarness, val rig: RelayRig?) {
    /** 여정의 단조 시계(ms) — `attachForTest(clockMs)`. */
    var nowMs = 1_000L
    /** 접근 도보 판정의 캐시 위치. 기본은 목적지 315m 남쪽(30m 밖). */
    var here = NearbyCoord(north(0.0).lat, lng0)
    var coordinateCalls = 0

    val phase: JourneyPhase? get() = GuideSession.journeyUi.value?.phase
}

/**
 * 여정(B26) 세션 조율(M5 §7-3·§7-4·§7-7): `GuideSession`이 두 모델의 단계 세션을 `journeyStep` 전이표대로 잇고, 단계 경계에서 서비스를 넘긴다.
 * 앱 조립(`attach`)과 같은 모양으로 두 모델이 한 벌의 포트를 공유하고 시간은 가상 시간이다.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GuideSessionJourneyTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private fun joint(relay: Boolean = false, body: suspend TestScope.(J) -> Unit) = runTest(dispatcher) {
        val rig = if (relay) RelayRig() else null
        val w = GuideTestHarness(dispatcher, walkResponder = ::respond, controllerOverride = rig?.controller)
        val t = TransitGuideHarness(dispatcher, shared = w)
        val j = J(w, t, rig)
        w.controller.route = GuideSession::serviceStartFailed
        GuideSession.attachForTest(
            w.model, w.coordinator, t.model, w.speaker, relay = rig?.relay, clockMs = { j.nowMs },
            coordinate = { j.coordinateCalls++; j.here },
        )
        try { body(j) } finally {
            w.close()
            t.close()
            GuideSession.attachForTest(w.model, w.coordinator)  // 다음 테스트가 남은 여정·대중교통 모델을 보지 않게
        }
    }

    // ── 단계 세션을 끝내는 손 ──

    /** 도보 세션의 첫 fix부터 15m씩 걸어 목적지(북 315m) 안에서 도착한다(`WalkGuideJourneyChainTest.walkToArrival`의 시작 뒤 부분). */
    private fun TestScope.walkToArrival(w: GuideTestHarness) {
        w.model.handleFix(w.fix(0.0, accuracy = 8.0)); settle()
        for (i in 1..20) {
            w.clock.now += 10.0
            w.model.handleFix(w.fix(i * 15.0, accuracy = 8.0)); advanceTimeBy(10_000); runCurrent()
        }
        w.clock.now += 5.0
        w.model.handleFix(w.fix(308.0, accuracy = 8.0)); runCurrent()
        advanceTimeBy(1); runCurrent()
    }

    private fun GuideTestHarness.carFix(meters: Double, speed: Double = 8.0) =
        north(meters).let { GuideFixPayload(it.lat, it.lng, 5.0, speed, 0.5, -1.0, -1.0, (clock.now * 1000).toLong()) }

    /** 자동차 세션의 첫 fix부터 달려 목적지 부근에서 멈춘다(정차가 도착이다, `CarGuideModelTest` 도착 사례). */
    private fun TestScope.carToArrival(w: GuideTestHarness, done: () -> Boolean = { false }) {
        w.model.handleFix(w.carFix(0.0)); settle()
        var d = 8.0
        while (d <= 280.0) {
            w.clock.now += 8.0
            w.model.handleFix(w.carFix(d, speed = 3.0))
            advanceTimeBy(8_000); runCurrent()
            d += 24.0
        }
        repeat(6) {
            w.clock.now += 2.0
            w.model.handleFix(w.carFix(300.0, speed = 0.0)); runCurrent()
            if (done()) return  // 도착 직후 — 인계 지연이 흐르기 전에 돌려준다
            advanceTimeBy(2_000); runCurrent()
        }
    }

    /** 대중교통 세션을 마지막 탈것까지 타고 내린다(`boardAlready` → `advance`). */
    private fun TestScope.rideToEnd(t: TransitGuideHarness) {
        t.model.boardAlready(express = null)
        t.model.advance()
        settle()
    }

    private fun TestScope.assertPhase(j: J, expected: JourneyPhase?, message: String = "") =
        assertEquals(expected, j.phase, message)

    // ── 사례 1: 전이 전수 ──

    @Test fun `전이 전수 — 택시, 접근 도보, 대중교통, 출구 도보, 택시, 끝(단계마다 선 세션과 600ms 지연)`() = joint { j ->
        val w = j.w
        val t = j.t
        GuideSession.startJourney(plan(taxiIn = true, egress = EgressKind.exit))
        settle()
        // 첫 단계는 준비 없이 곧장 선다(여정 시트가 한 턴 끼지 않게).
        assertPhase(j, JourneyPhase.Running(JourneyStage.taxiIn))
        assertEquals(GuideSessionKind.car, w.model.ui.value.sessionKind)
        assertTrue(w.model.isTracking)
        assertFalse(t.model.isTracking)

        // 「자동차에서 내렸어요」 → 접근 도보(600ms 지연 뒤)
        GuideSession.journeyAction(JourneyEvent.TaxiDropped)
        settle()
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.access))
        assertFalse(w.model.isTracking, "버튼 사건은 아직 도는 택시 세션을 멈춘다")
        after(580)
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.access), "600ms 전에는 서지 않는다")
        assertFalse(w.model.isTracking)
        after(30)
        assertPhase(j, JourneyPhase.Running(JourneyStage.access))
        assertTrue(w.model.isTracking)
        assertEquals(GuideSessionKind.walk, w.model.ui.value.sessionKind)
        assertNotNull(w.model.ui.value.prewalkTarget, "접근 도보는 승차 전 도보와 같은 표식·선언 버튼을 쓴다")

        // 도착 → 대중교통
        w.model.declarePrewalkArrival()
        settle()
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.transit))
        assertFalse(w.model.isTracking)
        assertFalse(t.model.isTracking)
        after(580)
        assertFalse(t.model.isTracking, "600ms 전에는 서지 않는다")
        after(30)
        assertPhase(j, JourneyPhase.Running(JourneyStage.transit))
        assertTrue(t.model.isTracking)
        assertFalse(w.model.isTracking)

        // 역 B 지정 하차 완료 → 출구 도보
        rideToEnd(t)
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.egress))
        assertFalse(t.model.isTracking)
        after(580)
        assertFalse(w.model.isTracking, "600ms 전에는 서지 않는다")
        after(30)
        assertPhase(j, JourneyPhase.Running(JourneyStage.egress))
        assertTrue(w.model.isTracking)
        assertEquals(GuideSessionKind.walk, w.model.ui.value.sessionKind)
        assertNull(w.model.ui.value.prewalkTarget, "출구 도보는 승차 전 도보가 아니다")

        // 도착 → 택시(taxiOut)
        walkToArrival(w)
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.taxiOut))
        assertFalse(w.model.isTracking)
        after(580)
        assertFalse(w.model.isTracking, "600ms 전에는 서지 않는다")
        after(30)
        assertPhase(j, JourneyPhase.Running(JourneyStage.taxiOut))
        assertTrue(w.model.isTracking)
        assertEquals(GuideSessionKind.car, w.model.ui.value.sessionKind)

        // 택시 도착 = 여정 끝
        carToArrival(w)
        assertNull(GuideSession.journeyUi.value, "마지막 단계의 도착이 여정을 끝낸다")
        assertFalse(w.model.isTracking)
        assertFalse(GuideSession.isOccupied)
    }

    // ── 사례 2: 접근 도보 생략 ──

    @Test fun `인계 시점 위치가 승차 지점 30m 안이면 접근 도보를 건너뛰고 대중교통으로 간다`() = joint { j ->
        j.here = NearbyCoord(north(305.0).lat, lng0)  // 승차 지점(북 315m)에서 약 10m
        GuideSession.startJourney(plan(taxiIn = true, egress = EgressKind.exit))
        settle()
        GuideSession.journeyAction(JourneyEvent.TaxiDropped)
        settle()
        after(610)
        assertEquals(1, j.coordinateCalls, "인계 시점에 캐시 위치를 한 번 본다")
        assertPhase(j, JourneyPhase.Running(JourneyStage.transit))
        assertTrue(j.t.model.isTracking)
        assertFalse(j.w.model.isTracking, "접근 도보 세션은 서지 않았다")
        assertEquals(1, j.w.controller.starts, "서비스 시작은 택시 한 번뿐이다")
    }

    @Test fun `대조 — 30m 밖이면 접근 도보가 선다`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = true, egress = EgressKind.exit))
        settle()
        GuideSession.journeyAction(JourneyEvent.TaxiDropped)
        settle()
        after(610)
        assertPhase(j, JourneyPhase.Running(JourneyStage.access))
        assertTrue(j.w.model.isTracking)
    }

    // ── 사례 3: 역 B 미지정 · 출구 none ──

    @Test fun `역 B 미지정 — 대중교통 끝(말미 도보 인계)에서 여정이 끝난다`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = false, egress = null, transit = transitRoute(trailingWalk = true)))
        settle()
        assertPhase(j, JourneyPhase.Running(JourneyStage.transit))
        assertTrue(j.t.model.isTracking)
        rideToEnd(j.t)
        assertNull(GuideSession.journeyUi.value)
        assertFalse(j.t.model.isTracking)
        assertNotNull(j.t.model.ui.value.pendingWalkHandoff, "말미 도보 인계 제안은 종전대로 남는다")
        after(1_000)
        assertFalse(j.w.model.isTracking, "여정이 다음 단계를 시작하지 않는다")
        assertFalse(GuideSession.isOccupied)
    }

    @Test fun `출구 none — 대중교통 뒤 출구 도보 없이 곧장 택시, 택시 도착이 끝이다`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = false, egress = EgressKind.none))
        settle()
        assertPhase(j, JourneyPhase.Running(JourneyStage.transit))
        rideToEnd(j.t)
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.taxiOut))
        after(610)
        assertPhase(j, JourneyPhase.Running(JourneyStage.taxiOut))
        assertEquals(GuideSessionKind.car, j.w.model.ui.value.sessionKind)
        carToArrival(j.w)
        assertNull(GuideSession.journeyUi.value)
    }

    // ── 사례 4: 버튼 사건과 자동 도착 경쟁 ──

    @Test fun `택시 확정 도착이 먼저 오면 늦은 자동차에서 내렸어요는 효과가 없다`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = true, egress = EgressKind.exit))
        settle()
        carToArrival(j.w) { j.phase != JourneyPhase.Running(JourneyStage.taxiIn) }
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.access))
        GuideSession.journeyAction(JourneyEvent.TaxiDropped)
        settle()
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.access), "늦은 버튼은 두 번째 전이를 만들지 않는다")
        after(610)
        assertPhase(j, JourneyPhase.Running(JourneyStage.access))
        assertEquals(2, j.w.controller.starts, "택시 한 번 + 접근 도보 한 번뿐이다")
        assertEquals(1, j.coordinateCalls, "인계 준비도 한 번뿐이다")
    }

    @Test fun `버튼이 먼저면 같은 택시 세션의 늦은 도착 콜백은 token 불일치로 버려진다`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = true, egress = EgressKind.exit))
        settle()
        val lateArrival = assertNotNull(j.w.model.onSessionEnd, "택시 단계 종료 훅")
        GuideSession.journeyAction(JourneyEvent.TaxiDropped)
        settle()
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.access))
        lateArrival(BeaconEndReason.arrived)
        settle()
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.access), "늦은 도착은 효과가 없다")
        after(610)
        assertPhase(j, JourneyPhase.Running(JourneyStage.access))
        assertEquals(2, j.w.controller.starts)
        assertEquals(1, j.coordinateCalls)
    }

    // ── 사례 5: 낡은 token 콜백 ──

    @Test fun `앞 단계의 늦은 종료 콜백은 다음 단계 시작 뒤에 와도 무시된다`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = true, egress = EgressKind.exit))
        settle()
        GuideSession.journeyAction(JourneyEvent.TaxiDropped)
        settle()
        after(610)
        val accessEnd = assertNotNull(j.w.model.onSessionEnd, "접근 도보 종료 훅")
        j.w.model.declarePrewalkArrival()
        settle()
        after(610)
        assertPhase(j, JourneyPhase.Running(JourneyStage.transit))
        // 앞 단계(접근 도보)의 늦은 콜백 — 도착이든 사용자 중지든 낡은 token이다.
        val rideCompleted = assertNotNull(j.t.model.onJourneyRideCompleted)
        val transitStopped = assertNotNull(j.t.model.onJourneyStopped)
        accessEnd(BeaconEndReason.arrived)
        accessEnd(BeaconEndReason.userStopped)
        settle()
        assertPhase(j, JourneyPhase.Running(JourneyStage.transit))
        assertTrue(j.t.model.isTracking)
        // 대중교통 단계의 훅도 다음 단계가 선 뒤엔 낡은 token이다.
        rideToEnd(j.t)
        after(610)
        assertPhase(j, JourneyPhase.Running(JourneyStage.egress))
        rideCompleted()
        transitStopped()
        settle()
        assertPhase(j, JourneyPhase.Running(JourneyStage.egress), "낡은 token의 대중교통 훅은 출구 도보를 건드리지 않는다")
        assertTrue(j.w.model.isTracking)
    }

    // ── 사례 6: 동기 거부(점유) → 시작 실패 ──

    @Test fun `단계 시작이 점유에 막히면 시작 실패로 Failed가 되고 실패 원인은 비어 있다`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = false, egress = EgressKind.exit))
        settle()
        rideToEnd(j.t)
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.egress))
        // 인계 지연 창에서 남이 코디네이터를 점유한다 — 출구 도보의 점유 단계가 거부된다.
        val token = assertNotNull(j.w.coordinator.claim(stop = {}), "대중교통 세션이 끝나 점유가 비었다")
        after(610)
        settle()
        assertPhase(j, JourneyPhase.Failed(JourneyStage.egress))
        assertNull(GuideSession.journeyUi.value?.failure, "시작을 지나지 않은 거부는 지난 세션의 원인을 싣지 않는다")
        assertNull(j.w.model.lastFailure)
        assertFalse(j.w.model.isTracking)
        assertFalse(j.w.model.ui.value.starting)
        assertEquals(j.w.catalog.get("android.journey.egressStartFailed"), journeyStatusText(GuideSession.journeyUi.value, j.w.catalog))
        j.w.coordinator.release(token)
    }

    // ── 사례 7: 접근 도보 시작 실패 → 통지가 끝난 뒤 대중교통 ──

    @Test fun `접근 도보 시작 실패는 도보 모델 통지가 끝날 때까지 기다린 뒤 대중교통을 시작한다`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = true, egress = EgressKind.exit))
        settle()
        j.w.perms.location = LocationPermission.None
        j.w.perms.requestResult = LocationPermission.None
        GuideSession.journeyAction(JourneyEvent.TaxiDropped)
        settle()
        j.w.speaker.isSpeaking = true  // 도보 모델의 원인·다리 통지가 아직 낭독 중
        after(610)
        val reason = j.w.catalog.get("beacon.denied")
        assertTrue(
            j.w.speaker.spoken.contains(j.w.catalog.get("android.journey.accessFailedWith", reason) to true),
            "원인 뒤에 다리 문장을 붙인 한 통지: ${j.w.speaker.texts}",
        )
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.transit))
        after(2_000)
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.transit), "낭독이 끝날 때까지 기다린다")
        assertFalse(j.t.model.isTracking)
        j.w.speaker.isSpeaking = false
        after(150)
        assertPhase(j, JourneyPhase.Running(JourneyStage.transit))
        assertTrue(j.t.model.isTracking)
    }

    // ── 사례 8: 실패 시트 재시도 ──

    @Test fun `Failed에서 경로 다시 조회는 지연 없이 같은 단계를 다시 시작한다`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = false, egress = EgressKind.exit))
        settle()
        rideToEnd(j.t)
        val token = assertNotNull(j.w.coordinator.claim(stop = {}))
        after(610)
        settle()
        assertPhase(j, JourneyPhase.Failed(JourneyStage.egress))
        j.w.coordinator.release(token)
        val before = testScheduler.currentTime
        GuideSession.journeyAction(JourneyEvent.Retry)
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.egress))
        settle()
        assertPhase(j, JourneyPhase.Running(JourneyStage.egress), "재시도는 인계 지연 600ms를 기다리지 않는다")
        assertTrue(testScheduler.currentTime - before < 100, "가상 시간이 거의 흐르지 않았다")
        assertTrue(j.w.model.isTracking)
    }

    // ── 사례 9: 30초 복귀 실패 ──

    @Test fun `사이 상태가 30초를 넘겨 전경으로 돌아오면 Failed와 상태 문장 한 번(high)`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = false, egress = EgressKind.none))
        settle()
        rideToEnd(j.t)
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.taxiOut))
        val text = j.w.catalog.get("android.journey.taxiOutFailed")
        // 정확히 30초는 아직 넘지 않았다.
        j.nowMs += 30_000
        GuideSession.setForeground(false)
        GuideSession.setForeground(true)
        settle()
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.taxiOut), "상한은 30초 초과부터다")
        j.nowMs += 1
        GuideSession.setForeground(false)
        GuideSession.setForeground(true)
        settle()
        assertPhase(j, JourneyPhase.Failed(JourneyStage.taxiOut))
        assertEquals(text, journeyStatusText(GuideSession.journeyUi.value, j.w.catalog))
        assertEquals(1, j.w.speaker.spoken.count { it == text to true }, j.w.speaker.spoken.toString())
        after(2_000)
        assertPhase(j, JourneyPhase.Failed(JourneyStage.taxiOut), "준비 작업이 취소돼 다음 단계가 서지 않는다")
        assertFalse(j.w.model.isTracking)
    }

    // ── 사례 10: 여정 중 외부 시작 거부 ──

    private fun TestScope.assertExternalStartsRefused(j: J, phase: JourneyPhase) {
        val refused = j.w.catalog.get("guide.alreadyActive") to true
        val actions = listOf<Pair<String, () -> Unit>>(
            "startWalk" to { GuideSession.startWalk(j.w.request) },
            "startCar" to { GuideSession.startCar(CarStartRequest(dest = DEST, label = "가상", waypoint = null)) },
            "startTransit" to { GuideSession.startTransit(TransitStartRequest(transitRoute(), "가상", DEST, accessible = false)) },
            "restartBeacon" to { GuideSession.restartBeacon() },
        )
        for ((name, act) in actions) {
            j.w.speaker.spoken.clear()
            act()
            settle()
            assertEquals(listOf(refused), j.w.speaker.spoken, "$name 은 이미 안내 중 통지 한 번뿐")
            assertPhase(j, phase, name)
        }
    }

    @Test fun `여정 중 외부 시작은 이미 안내 중 통지 뒤 무시된다(단계 세션이 돌 때와 단계 사이 모두)`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = false, egress = EgressKind.exit))
        settle()
        assertPhase(j, JourneyPhase.Running(JourneyStage.transit))
        assertExternalStartsRefused(j, JourneyPhase.Running(JourneyStage.transit))
        assertTrue(j.t.model.isTracking)
        assertFalse(j.w.model.isTracking)
        // 단계 사이(Transitioning) — 세션이 하나도 돌지 않아도 거부한다.
        rideToEnd(j.t)
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.egress))
        assertFalse(GuideSession.isActive)
        assertTrue(GuideSession.isOccupied)
        assertExternalStartsRefused(j, JourneyPhase.Transitioning(JourneyStage.egress))
        assertFalse(j.w.model.isTracking)
        assertFalse(j.t.model.isTracking)
        after(610)
        assertPhase(j, JourneyPhase.Running(JourneyStage.egress), "거부가 여정의 다음 단계를 방해하지 않는다")
    }

    // ── 사례 11: 사용자 종료 ──

    @Test fun `안내 종료는 도는 도보 세션을 정지음과 함께 멈추고 여정을 끝낸다`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = true, egress = EgressKind.exit))
        settle()
        GuideSession.journeyAction(JourneyEvent.TaxiDropped)
        settle()
        after(610)
        assertPhase(j, JourneyPhase.Running(JourneyStage.access))
        GuideSession.journeyAction(JourneyEvent.UserEnded)
        settle()
        assertNull(GuideSession.journeyUi.value)
        assertFalse(j.w.model.isTracking)
        assertTrue(j.w.tones.played.contains(BeaconTone.stop), "정지음: ${j.w.tones.played}")
        assertFalse(GuideSession.isOccupied)
        after(2_000)
        assertFalse(j.w.model.isTracking, "다음 단계가 서지 않는다")
        assertFalse(j.t.model.isTracking)
    }

    @Test fun `안내 종료는 도는 대중교통 세션도 정지음과 함께 멈춘다`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = false, egress = EgressKind.exit))
        settle()
        j.t.model.boardAlready(express = null)
        settle()
        assertTrue(j.t.model.isTracking)
        GuideSession.journeyAction(JourneyEvent.UserEnded)
        settle()
        assertNull(GuideSession.journeyUi.value)
        assertFalse(j.t.model.isTracking)
        assertTrue(j.w.tones.played.contains(BeaconTone.stop), "정지음: ${j.w.tones.played}")
        assertFalse(GuideSession.isOccupied)
    }

    @Test fun `단계 사이에 안내 종료를 눌러도 준비 작업이 취소돼 다음 세션이 서지 않는다`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = false, egress = EgressKind.exit))
        settle()
        rideToEnd(j.t)
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.egress))
        GuideSession.journeyAction(JourneyEvent.UserEnded)
        settle()
        assertNull(GuideSession.journeyUi.value)
        after(2_000)
        assertFalse(j.w.model.isTracking)
        assertFalse(GuideSession.isOccupied)
    }

    // ── 사례 12: 승차 전 도보 교차 ──

    @Test fun `역 A 미지정 첫 단계가 승차 전 도보일 때 사용자 정지는 여정을 끝낸다`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = false, egress = null, transit = transitRoute(leadingWalk = true)))
        settle()
        assertPhase(j, JourneyPhase.Running(JourneyStage.transit))
        assertTrue(j.w.model.isTracking, "승차 전 도보가 먼저 선다")
        assertNotNull(j.w.model.ui.value.prewalkTarget)
        assertFalse(j.t.model.isTracking)
        j.w.model.stopByUser()
        settle()
        assertNull(GuideSession.journeyUi.value, "대중교통이 시작되지 않으므로 여정도 끝난다")
        assertFalse(j.t.model.isTracking)
        assertFalse(GuideSession.isOccupied)
    }

    @Test fun `승차 전 도보 도착은 대중교통을 시작하고 여정은 대중교통 단계에 남는다`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = false, egress = null, transit = transitRoute(leadingWalk = true)))
        settle()
        assertTrue(j.w.model.isTracking)
        j.w.model.declarePrewalkArrival()
        settle()
        after(610)
        assertTrue(j.t.model.isTracking)
        assertPhase(j, JourneyPhase.Running(JourneyStage.transit))
        assertFalse(j.w.model.isTracking)
    }

    @Test fun `여정 안 승차 전 도보는 재시작 대상이 아니다 — 여정이 끝난 뒤 restartBeacon은 걷기만 다시 시작한다`() = joint { j ->
        GuideSession.startJourney(plan(taxiIn = false, egress = null, transit = transitRoute(leadingWalk = true)))
        settle()
        j.w.model.stopByUser()
        settle()
        assertNull(GuideSession.journeyUi.value)
        GuideSession.restartBeacon()
        settle()
        assertTrue(j.w.model.isTracking, "걷기는 다시 시작된다")
        assertNull(j.w.model.ui.value.prewalkTarget, "승차 전 도보 연결을 다시 걸지 않는다")
        assertNull(j.w.model.onSessionEnd)
        j.w.model.stopByUser()
        settle()
        after(2_000)
        assertFalse(j.t.model.isTracking, "걷기가 끝나도 대중교통이 이어서 서지 않는다")
    }

    // ── 사례 13: aboard 시작 ──

    @Test fun `aboard 시작은 승차 전 도보 없이 열차 고르기 국면으로 서고 방향을 잠근다`() = joint { j ->
        j.t.trackReplies += trackBoth() to 0L
        GuideSession.startJourney(
            plan(taxiIn = false, egress = null, transit = transitRoute(leadingWalk = true), aboard = TransitAboardStart("하행")),
        )
        settle()
        assertPhase(j, JourneyPhase.Running(JourneyStage.transit))
        assertFalse(j.w.model.isTracking, "이미 탔으니 걷지 않는다")
        assertNull(j.w.model.ui.value.prewalkTarget)
        assertTrue(j.t.model.isTracking)
        assertEquals(TransitAboardStep.pickVehicle, j.t.model.ui.value.aboardStep)
        assertEquals("하행", j.t.model.ui.value.aboardDirection)
    }

    // ── 사례 14: 서비스 넘김 ──

    @Test fun `서비스 넘김 — 단계 경계에서 내리지도 다시 시작하지도 않고 재결속만 보유자 다음 모델 순으로, 종료 때 한 번 내린다`() = joint(relay = true) { j ->
        val rig = assertNotNull(j.rig)
        GuideSession.startJourney(plan(taxiIn = true, egress = EgressKind.exit))
        settle()
        rig.runPosts()
        assertEquals(listOf(1), rig.launches)
        assertEquals(0, rig.shutdowns)

        // 택시 → 접근 도보 경계: 보유자가 새 세대(2)로 서비스를 이어받는다.
        GuideSession.journeyAction(JourneyEvent.TaxiDropped)
        settle()
        rig.runPosts()
        assertEquals(0, rig.shutdowns, "경계에서 서비스를 내리지 않는다")
        assertEquals(listOf(1), rig.launches, "경계에서 서비스를 다시 시작하지 않는다")
        assertEquals(listOf(2), rig.rebinds, "재결속은 보유자 세대")
        assertNotNull(GuideSession.serviceOwner(), "도보 세션이 없어도 보유자가 소유자다")
        assertNull(j.w.model.serviceGeneration)
        // 앞 세대(1)의 늦은 알림 종료는 버린다.
        GuideSession.serviceStopFromNotification(1)
        assertNotNull(GuideSession.journeyUi.value, "앞 세대의 알림 종료가 여정을 끝내지 않는다")

        after(610)
        rig.runPosts()
        assertPhase(j, JourneyPhase.Running(JourneyStage.access))
        assertEquals(listOf(1), rig.launches, "다음 모델 시작도 서비스를 다시 시작하지 않는다")
        assertEquals(listOf(2, 3), rig.rebinds, "그 다음 재결속은 다음 모델 세대")
        assertEquals(3, j.w.model.serviceGeneration)
        assertEquals(0, rig.shutdowns)
        // 넘김 뒤 앞 단계 세대(1·2)의 늦은 이벤트는 새 소유자(도보)에게 닿지 않는다.
        GuideSession.serviceStopFromNotification(1)
        GuideSession.serviceStopFromNotification(2)
        assertTrue(j.w.model.isTracking, "앞 세대의 알림 종료가 도보 세션을 끝내지 않는다")
        GuideSession.serviceFix(2, j.w.fix(0.0))
        assertTrue(j.w.transport.seenUrls.none { it.contains("/api/route/walk") }, "앞 세대의 fix가 도보 모델에 들어가 경로를 조회하지 않았다")

        // 접근 도보 → 대중교통 경계도 같다.
        j.w.model.declarePrewalkArrival()
        settle()
        rig.runPosts()
        assertEquals(0, rig.shutdowns)
        assertEquals(listOf(1), rig.launches)
        assertEquals(listOf(2, 3, 4), rig.rebinds)
        after(610)
        rig.runPosts()
        assertPhase(j, JourneyPhase.Running(JourneyStage.transit))
        assertEquals(listOf(1), rig.launches)
        assertEquals(0, rig.shutdowns)

        // 여정 종료 — 보유자만 쥐고 있으므로 서비스를 내린다.
        GuideSession.journeyAction(JourneyEvent.UserEnded)
        settle()
        rig.runPosts()
        assertNull(GuideSession.journeyUi.value)
        assertEquals(1, rig.shutdowns, "여정 종료 때 정확히 한 번 내린다")
        assertEquals(listOf(1), rig.launches)
        assertNull(rig.relay.current)
    }

    @Test fun `보유자가 소유자일 때 보유자 세대의 알림 종료는 여정 종료다`() = joint(relay = true) { j ->
        val rig = assertNotNull(j.rig)
        GuideSession.startJourney(plan(taxiIn = true, egress = EgressKind.exit))
        settle()
        GuideSession.journeyAction(JourneyEvent.TaxiDropped)
        settle()
        rig.runPosts()
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.access))
        val holderGeneration = assertNotNull(rig.relay.current)
        GuideSession.serviceStopFromNotification(holderGeneration)
        settle()
        assertNull(GuideSession.journeyUi.value)
        assertEquals(1, rig.shutdowns)
        after(2_000)
        assertFalse(j.w.model.isTracking, "여정이 끝났으니 다음 단계가 서지 않는다")
    }

    @Test fun `실패 국면을 커밋할 때 보유자만 서비스를 쥐고 있으면 내리고, 재시도의 새 시작은 다시 올린다`() = joint(relay = true) { j ->
        val rig = assertNotNull(j.rig)
        j.t.trackReplies += TransitGuideHarness.okTrack("v1") to 0L
        GuideSession.startJourney(plan(taxiIn = false, egress = EgressKind.none))
        settle()
        // 대중교통이 승차하면 keep-alive 서비스를 켠다.
        j.t.model.board(j.t.model.ui.value.waitingLive.single(), null)
        settle()
        rig.runPosts()
        assertEquals(listOf(1), rig.launches)
        j.t.model.confirmBoarded()
        settle()
        j.t.model.declareArrived()  // 하차역 선언: 추적 승차의 마지막 구간을 확정 도착으로 끝낸다
        settle()
        j.t.model.advance()
        settle()
        rig.runPosts()
        assertPhase(j, JourneyPhase.Transitioning(JourneyStage.taxiOut), "transit=${j.t.model.ui.value.state} tracking=${j.t.model.isTracking}")
        assertEquals(0, rig.shutdowns, "단계 경계에서는 보유자가 이어받는다")
        j.nowMs += 31_000
        GuideSession.setForeground(false)
        GuideSession.setForeground(true)
        settle()
        rig.runPosts()
        assertPhase(j, JourneyPhase.Failed(JourneyStage.taxiOut))
        assertEquals(1, rig.shutdowns, "실패 국면은 서비스를 들지 않는다")
        assertNull(rig.relay.current)
        // 재시도: 서비스는 내려가 있으므로 새로 시작한다(재결속이 아니라 launch).
        GuideSession.journeyAction(JourneyEvent.Retry)
        settle()
        rig.runPosts()
        assertPhase(j, JourneyPhase.Running(JourneyStage.taxiOut))
        assertEquals(2, rig.launches.size, "내려간 서비스는 새로 시작한다: ${rig.launches}")
        assertTrue(j.w.model.isTracking)
    }

    @Test fun `잊힌 여정 — 대중교통 대기가 유휴 정지에 들면 보유자가 쥔 서비스를 내린다(리뷰 지적 2)`() = joint(relay = true) { j ->
        val rig = assertNotNull(j.rig)
        GuideSession.startJourney(plan(taxiIn = true, egress = EgressKind.exit))
        settle()
        GuideSession.journeyAction(JourneyEvent.TaxiDropped)
        settle()
        rig.runPosts()
        after(610)
        j.w.model.declarePrewalkArrival()
        settle()
        rig.runPosts()
        after(610)
        rig.runPosts()
        assertPhase(j, JourneyPhase.Running(JourneyStage.transit))
        assertEquals(0, rig.shutdowns)
        assertNotNull(rig.relay.current, "대기 중에는 보유자가 서비스를 든다")
        after(90 * 60_000L)
        rig.runPosts()
        assertTrue(j.t.model.ui.value.idlePaused)
        assertEquals(1, rig.shutdowns, "유휴 정지 뒤에는 wake lock·위치 구독을 쥐지 않는다")
        assertNull(rig.relay.current)
        assertNotNull(GuideSession.journeyUi.value, "여정과 세션은 남는다(재개는 사용자 조작)")
    }

    // ── 사례 15: 여정이 없을 때 기존 동작 불변 ──

    @Test fun `여정이 없을 때 isOccupied는 isActive와 같다, 여정 중 단계 사이에만 갈린다`() = joint { j ->
        assertFalse(GuideSession.isActive)
        assertEquals(GuideSession.isActive, GuideSession.isOccupied)
        GuideSession.startWalk(j.w.request)
        settle()
        assertTrue(GuideSession.isActive)
        assertEquals(GuideSession.isActive, GuideSession.isOccupied)
        j.w.model.stopByUser()
        settle()
        assertEquals(GuideSession.isActive, GuideSession.isOccupied)
        assertFalse(GuideSession.isOccupied)
        // 대조: 여정이 끝난 뒤에도 다시 같아진다.
        GuideSession.startJourney(plan(taxiIn = false, egress = EgressKind.exit))
        settle()
        rideToEnd(j.t)
        assertFalse(GuideSession.isActive)
        assertTrue(GuideSession.isOccupied, "단계 사이는 세션이 없어도 점유다")
        GuideSession.journeyAction(JourneyEvent.UserEnded)
        settle()
        assertEquals(GuideSession.isActive, GuideSession.isOccupied)
        assertFalse(GuideSession.isOccupied)
    }
}

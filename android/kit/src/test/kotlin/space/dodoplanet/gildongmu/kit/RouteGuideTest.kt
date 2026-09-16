package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * 경로 추종 리듀서 — Kit `RouteGuideTests` 미러(+ FOUNDATION 유예분 `WalkActionTests`의 imminentTone 표).
 * 웹 정본과 같은 공유 fixture(`route-guide-scenarios.json`·`course-axis-scenarios.json`의 `reducer`)를 읽는다.
 * Swift 스위트의 `TangentAtTests`·`waypointIndexOutOfRangeRejectsRoute`는 FOUNDATION `RouteGeometryTest`가 이미 든다.
 */
class RouteGuideTest {
    private val meterLat = 1.0 / 111_320
    private val lat0 = 37.5
    private val lng0 = 127.1

    @Serializable
    private data class ScenarioFile(val scenarios: List<Scenario>) {
        @Serializable
        data class Scenario(
            val name: String,
            val tuning: String? = null,
            /** 종점 오프셋 기하를 아는 세션인가(미지정=모름 → 옛 50m 인계). */
            val geometry: Boolean? = null,
            /** 경유지 스텝 index(N4). 미지정=경유지 없음. */
            val waypointStepIndex: Int? = null,
            val steps: List<Step>,
            val fixes: List<Fix>,
            val expect: List<Expectation>,
        )

        @Serializable
        data class Step(val len: Double, val desc: String, val action: String? = null)

        @Serializable
        data class Fix(val t: Double, val along: Double, val lateral: Double, val acc: Double)

        @Serializable
        data class Expectation(
            val afterFix: Int? = null,
            val afterFixAny: List<Int>? = null,
            val event: String? = null,
            val eventNot: String? = null,
            val eventNull: Boolean? = null,
            val eventOneOf: List<String>? = null,
            val indices: List<Int>? = null,
            val tone: String? = null,
            /** 톤이 **없어야** 하는 지점. 40m 전문에서 `ahead` 톤이 임박 큐로 옮겨 간 계약이 이 축으로만 잠긴다. */
            val toneNull: Boolean? = null,
            /** 임박 단계 index(0=20m, 1=15m, 2=10m). */
            val stage: Int? = null,
        )
    }

    private data class Seg(val len: Double, val desc: String, val action: String? = null)

    private fun routeFrom(steps: List<Seg>, waypointStepIndex: Int? = null): GuideRoute {
        var acc = 0.0
        val inputs = steps.map { s ->
            val g = GuideStepGeometry(
                s.desc,
                listOf(RoutePoint(lat0 + acc * meterLat, lng0), RoutePoint(lat0 + (acc + s.len) * meterLat, lng0)),
                s.action?.let { WalkAction.fromRawValue(it) ?: fail("미지 action $it") },
            )
            acc += s.len
            g
        }
        return checkNotNull(buildGuideRoute(inputs, waypointStepIndex))
    }

    private fun fixCoord(along: Double, lateral: Double, acc: Double) =
        GuideFix(lat0 + along * meterLat, lng0 + (lateral * meterLat) / cos(lat0 * PI / 180), acc)

    /** 이벤트 종류를 fixture 문자열로 환원(웹 event.kind 대응). */
    private fun kindName(event: GuideEvent?): String? = when (event) {
        is GuideEvent.AnnounceSteps -> "announceSteps"
        is GuideEvent.Imminent -> "imminent"
        is GuideEvent.FarNotice -> "farNotice"
        is GuideEvent.Periodic -> "periodic"
        is GuideEvent.BundleReread -> "bundleReread"
        GuideEvent.WaypointReached -> "waypointReached"
        GuideEvent.FinalApproachEnter -> "finalApproachEnter"
        GuideEvent.OffRoute -> "offRoute"
        GuideEvent.BackOnRoute -> "backOnRoute"
        GuideEvent.UncertainEnter -> "uncertainEnter"
        GuideEvent.UncertainExit -> "uncertainExit"
        GuideEvent.Reacquiring -> "reacquiring"
        GuideEvent.Reacquired -> "reacquired"
        GuideEvent.SpeedSuggest -> "speedSuggest"
        null -> null
    }

    private fun indicesOf(event: GuideEvent?): List<Int>? = when (event) {
        is GuideEvent.AnnounceSteps -> event.indices
        is GuideEvent.Imminent -> event.indices
        is GuideEvent.FarNotice -> event.indices
        is GuideEvent.BundleReread -> event.indices
        else -> null
    }

    @Test fun `공유 시나리오 표`() {
        val scenarios = Fixtures.sharedJson("route-guide-scenarios.json", ScenarioFile.serializer()).scenarios
        assertTrue(scenarios.size >= 40) // 공회전 방지
        for (sc in scenarios) {
            val route = routeFrom(sc.steps.map { Seg(it.len, it.desc, it.action) }, sc.waypointStepIndex)
            val tuning = when (sc.tuning) {
                null -> GuideTuning.walk
                "car" -> GuideTuning.car
                "carDriver" -> GuideTuning.carDriver
                else -> fail("${sc.name}: 미지 tuning ${sc.tuning}")
            }
            var state = initialGuideState(route, 0.0, hasFinalApproachGeometry = sc.geometry == true).state
            val results = sc.fixes.map { f ->
                val out = guideStep(state, fixCoord(f.along, f.lateral, f.acc), route, f.t, tuning)
                state = out.state
                out
            }
            for (ex in sc.expect) {
                val idxs = ex.afterFix?.let { listOf(it) } ?: ex.afterFixAny ?: emptyList()
                val rs = idxs.map { results[it] }
                ex.event?.let { e -> assertTrue(rs.any { kindName(it.event) == e }, "${sc.name}: event $e") }
                ex.eventNot?.let { n -> for (r in rs) assertNotEquals(n, kindName(r.event), "${sc.name}: eventNot $n") }
                if (ex.eventNull == true) for (r in rs) assertNull(r.event, "${sc.name}: eventNull")
                ex.eventOneOf?.let { oneOf -> assertTrue(rs.any { kindName(it.event) in oneOf }, "${sc.name}: eventOneOf $oneOf") }
                ex.indices?.let { want -> assertEquals(want, rs.firstNotNullOfOrNull { indicesOf(it.event) }, "${sc.name}: indices $want") }
                ex.tone?.let { t -> assertTrue(rs.any { it.tone?.rawValue == t }, "${sc.name}: tone $t") }
                ex.stage?.let { st -> assertTrue(rs.any { (it.event as? GuideEvent.Imminent)?.stage == st }, "${sc.name}: stage $st") }
                if (ex.toneNull == true) for (r in rs) assertNull(r.tone, "${sc.name}: toneNull")
            }
        }
    }

    /**
     * 속도 가드 표본 소멸 시 해제(정확도 배제의 2차 회귀 차단). 가드 활성 후 21~50m 정확도 지속으로 시간창이 마르면
     * 가드를 해제해야 한다 — 미해제면 이탈 재통지가 무기한 억제된다(독립 리뷰 MAJOR).
     */
    @Test fun `속도 가드는 표본이 마르면 풀린다`() {
        val route = routeFrom(listOf(Seg(2000.0, "직진")))
        var state = initialGuideState(route, 0.0).state
        var lastEvent: GuideEvent? = null
        for ((t, along) in listOf(0.0 to 0.0, 5.0 to 40.0, 10.0 to 90.0)) {
            val out = guideStep(state, fixCoord(along, 0.0, 10.0), route, t, GuideTuning.walk)
            state = out.state
            lastEvent = out.event
        }
        assertEquals("speedSuggest", kindName(lastEvent))
        assertTrue(state.speedGuardActive)
        for (t in listOf(15.0, 20.0)) {
            state = guideStep(state, fixCoord(90.0, 0.0, 30.0), route, t, GuideTuning.walk).state
            assertTrue(state.speedGuardActive) // 잔여 표본이 남은 동안은 동결 유지
        }
        state = guideStep(state, fixCoord(90.0, 0.0, 30.0), route, 25.0, GuideTuning.walk).state
        assertTrue(state.speedSamples.isEmpty())
        assertFalse(state.speedGuardActive)
    }

    private fun eastOffset(meters: Double) = meters * meterLat / cos(lat0 * PI / 180)

    /** 북 `north` → 동 `east` → 남 `north` U자 경로. */
    private fun uRoute(north: Double, east: Double): GuideRoute {
        val e = eastOffset(east)
        return checkNotNull(
            buildGuideRoute(
                listOf(
                    GuideStepGeometry("북", listOf(RoutePoint(lat0, lng0), RoutePoint(lat0 + north * meterLat, lng0))),
                    GuideStepGeometry("동", listOf(RoutePoint(lat0 + north * meterLat, lng0), RoutePoint(lat0 + north * meterLat, lng0 + e))),
                    GuideStepGeometry("남", listOf(RoutePoint(lat0 + north * meterLat, lng0 + e), RoutePoint(lat0, lng0 + e))),
                ),
            ),
        )
    }

    @Test fun `초기 투영 모호성 계약`() {
        // U자 왕복(평행 20m 간격)은 ambiguous — 임의 확정 금지(스펙 §6).
        assertEquals(GuideEntryProjection.Ambiguous, entryProjection(uRoute(300.0, 20.0), fixCoord(150.0, 10.0, 10.0)))
        val single = checkNotNull(
            buildGuideRoute(listOf(GuideStepGeometry("직진", listOf(RoutePoint(lat0, lng0), RoutePoint(lat0 + 300 * meterLat, lng0))))),
        )
        val ok = entryProjection(single, fixCoord(150.0, 5.0, 10.0))
        if (ok !is GuideEntryProjection.Ok) fail("단일 후보는 Ok여야 한다: $ok")
        assertTrue(abs(ok.d - 150) < 1)
        assertEquals(GuideEntryProjection.None, entryProjection(single, fixCoord(150.0, 200.0, 10.0)))
    }

    private fun enterReacquiring(route: GuideRoute, dPrev: Double): GuideState {
        val state = guideStateAt(route, dPrev, 0.0).copy(lastFixAt = 0.0)
        val out = guideStep(state, fixCoord(dPrev, 0.0, 10.0), route, 11.0, GuideTuning.car)
        assertEquals(GuideEvent.Reacquiring, out.event)
        return out.state
    }

    @Test fun `차량 재획득 타이브레이크 — 전방 창 단일 후보를 채택한다`() {
        val route = uRoute(300.0, 40.0)
        val st = enterReacquiring(route, dPrev = 100.0) // v=0 → 창 [100, 200]
        val out = guideStep(st, fixCoord(150.0, 10.0, 10.0), route, 12.0, GuideTuning.car)
        // 후보: 북 d≈150(창 안) vs 남 d≈490(창 밖) → 단일 채택
        assertEquals(GuideEvent.Reacquired, out.event)
        assertTrue(abs(out.state.d - 150) < 1)
    }

    @Test fun `차량 재획득 타이브레이크 — 창 안 0개면 거부`() {
        val route = uRoute(300.0, 40.0)
        val out = guideStep(enterReacquiring(route, 100.0), fixCoord(250.0, 20.0, 10.0), route, 12.0, GuideTuning.car)
        // 북 d≈250·남 d≈390 — 둘 다 창 [100,200] 밖 → 거부 유지
        assertNull(out.event)
        assertEquals(GuidePhase.reacquiring, out.state.phase)
    }

    @Test fun `차량 재획득 타이브레이크 — 창 안 복수면 거부`() {
        val route = uRoute(300.0, 40.0)
        val st = enterReacquiring(route, 100.0).copy(reacquireV = 20.0) // 창 상한 100 + 20×12×1.5 + 100 = 560
        val out = guideStep(st, fixCoord(250.0, 20.0, 10.0), route, 12.0, GuideTuning.car)
        // 북 d≈250·남 d≈390 둘 다 창 안 → 복수 거부(평행도로 이탈 은폐 차단)
        assertNull(out.event)
        assertEquals(GuidePhase.reacquiring, out.state.phase)
    }

    @Test fun `차량 재획득 타이브레이크 — 속도 계수 1점5를 잠근다`() {
        // 북 900 → 동 40 → 남 900. prevD=100·v=20·elapsed 12초: 창 상한이 1.5×면 560, 1.0×이면 440 — d≈500 후보는 1.5×에서만 창 안.
        val route = uRoute(900.0, 40.0)
        val entered = enterReacquiring(route, 100.0).copy(reacquireV = 20.0)
        val out = guideStep(entered, fixCoord(500.0, 10.0, 10.0), route, 12.0, GuideTuning.car)
        assertEquals(GuideEvent.Reacquired, out.event)
        assertTrue(abs(out.state.d - 500) < 5)
    }

    @Test fun `차량 재획득 타이브레이크 — 버퍼 100을 잠근다`() {
        val route = uRoute(300.0, 40.0)
        // d≈180은 버퍼 100일 때만 창 안(50이면 상한 150 밖).
        val out = guideStep(enterReacquiring(route, 100.0), fixCoord(180.0, 10.0, 10.0), route, 12.0, GuideTuning.car)
        assertEquals(GuideEvent.Reacquired, out.event)
        assertTrue(abs(out.state.d - 180) < 5)
    }

    @Test fun `차량 이탈 재통지는 180초 간격이고 무톤이다`() {
        val route = routeFrom(listOf(Seg(600.0, "직진")))
        var state = guideStateAt(route, 0.0, 0.0).copy(lastFixAt = 0.0)
        var confirm: GuideOutput? = null
        for ((t, along) in listOf(5.0 to 40.0, 10.0 to 80.0, 15.0 to 120.0)) {
            confirm = guideStep(state, fixCoord(along, 60.0, 10.0), route, t, GuideTuning.car)
            state = confirm.state
        }
        assertEquals(GuideEvent.OffRoute, confirm?.event)
        assertEquals(GuideTone.warning, confirm?.tone) // 첫 확정은 항상 경고 톤

        var renotifyAt: Double? = null
        var renotifyTone: GuideTone? = GuideTone.warning
        var t = 24.0
        while (t <= 210) {
            val out = guideStep(state, fixCoord(200.0, 60.0, 10.0), route, t, GuideTuning.car)
            state = out.state
            if (out.event == GuideEvent.OffRoute) {
                renotifyAt = t
                renotifyTone = out.tone
                break
            }
            t += 9
        }
        assertNotNull(renotifyAt)
        assertTrue(renotifyAt >= 195) // 확정 15 + 180
        assertNull(renotifyTone) // 재통지는 무톤(§4.3)
    }

    @Test fun `유닛 계약`() {
        val route = routeFrom(listOf(Seg(100.0, "a"), Seg(20.0, "b"), Seg(30.0, "c"), Seg(100.0, "d")))
        assertEquals(listOf(0), unitAt(route, 0))
        assertEquals(listOf(1, 2), unitAt(route, 1))
        assertEquals(listOf(1, 2), unitAt(route, 2))
        assertEquals(listOf(3), unitAt(route, 3))
        val bundleFirst = routeFrom(listOf(Seg(20.0, "횡단보도"), Seg(16.0, "이동"), Seg(100.0, "직진")))
        assertEquals(listOf(0, 1), initialGuideState(bundleFirst, 0.0).firstIndices)
    }

    // ── 최종 접근 진입 조건(spec 2026-08-08 §3.2·§4): fixture 스키마로 표현할 수 없는 전이를 고정한다 ──

    private fun straight100() = routeFrom(listOf(Seg(100.0, "직진 100m 이동")))

    /** 종점 근처·전 스텝 낭독 완료·기하 있음인 상태. */
    private fun atEnd(route: GuideRoute, d: Double = 96.0) =
        guideStateAt(route, d, 0.0, hasFinalApproachGeometry = true).copy(announcedUpTo = route.steps.size - 1)

    @Test fun `낭독이 남아 있으면 종점에 닿아도 진입하지 않는다`() {
        val route = routeFrom(listOf(Seg(60.0, "직진A"), Seg(60.0, "우회전B")))
        val state = atEnd(route, 112.0).copy(announcedUpTo = 0)
        val out = guideStep(state, fixCoord(115.0, 0.0, 8.0), route, 10.0, GuideTuning.walk)
        assertNotEquals(GuideEvent.FinalApproachEnter, out.event)
        assertNotEquals(GuidePhase.finalApproach, out.state.phase)
    }

    @Test fun `이탈 중이면 진입하지 않는다 — 이탈 판정이 먼저 반환한다`() {
        val route = straight100()
        val out = guideStep(atEnd(route).copy(phase = GuidePhase.offRoute), fixCoord(97.0, 60.0, 8.0), route, 10.0, GuideTuning.walk)
        assertEquals(GuidePhase.offRoute, out.state.phase)
    }

    @Test fun `재무장 전이면 진입하지 않는다`() {
        val route = straight100()
        val out = guideStep(atEnd(route).copy(autoHandoffArmed = false), fixCoord(97.0, 0.0, 8.0), route, 10.0, GuideTuning.walk)
        assertNotEquals(GuideEvent.FinalApproachEnter, out.event)
    }

    /** ⚠ 가드는 uncertain 게이트보다 **앞**에 있어야 한다. 뒤에 두면 래치가 조용히 풀린다. */
    @Test fun `진입 후에는 정확도가 무효여도 uncertain으로 가지 않는다`() {
        val route = straight100()
        val entered = guideStep(atEnd(route), fixCoord(97.0, 0.0, 8.0), route, 10.0, GuideTuning.walk)
        assertEquals(GuideEvent.FinalApproachEnter, entered.event)
        assertEquals(GuidePhase.finalApproach, entered.state.phase)
        val bad = guideStep(entered.state, fixCoord(97.0, 0.0, 200.0), route, 20.0, GuideTuning.walk)
        assertEquals(GuidePhase.finalApproach, bad.state.phase)
        assertNull(bad.event)
        assertEquals(20.0, bad.state.lastFixAt)
    }

    @Test fun `재획득으로 상태를 다시 만들어도 기하 보유가 승계된다`() {
        val route = routeFrom(listOf(Seg(400.0, "직진")))
        val start = guideStateAt(route, 0.0, 0.0, hasFinalApproachGeometry = true).copy(phase = GuidePhase.reacquiring, lastFixAt = 0.0)
        val state = guideStep(start, fixCoord(200.0, 0.0, 10.0), route, 10.0, GuideTuning.walk).state
        assertNotEquals(GuidePhase.reacquiring, state.phase)
        assertTrue(state.hasFinalApproachGeometry)
    }

    @Test fun `진입선 — 기하를 모르면 옛 50m, 알면 정확도와 하한 중 큰 값`() {
        val route = straight100()
        val legacy = guideStateAt(route, 0.0, 0.0).copy(hasFinalApproachGeometry = false)
        assertEquals(handoffDistMeters, finalApproachEntryMeters(legacy, 5.0, GuideTuning.walk))
        val known = guideStateAt(route, 0.0, 0.0, hasFinalApproachGeometry = true)
        assertEquals(10.0, finalApproachEntryMeters(known, 5.0, GuideTuning.walk))
        assertEquals(30.0, finalApproachEntryMeters(known, 30.0, GuideTuning.walk))
    }

    // ── 방위 축 리듀서 통합(웹 route-guide.test.ts "방위 축 통합"·"리듀서 trace" 미러) ──

    /** 남→북 직선 400m. 접선은 어디서나 0도. */
    private val axisRoute = checkNotNull(
        buildGuideRoute(listOf(GuideStepGeometry("북진", listOf(RoutePoint(lat0, lng0), RoutePoint(lat0 + 400 * meterLat, lng0))))),
    )

    /** bearingDeg 방향 1.2m/s·1Hz 보행 fix(관측은 리듀서 내부 유도기가 만든다). onEvent가 참이면 멈춘다. */
    private fun walk(
        start: GuideState,
        fromAlong: Double,
        bearingDeg: Double,
        seconds: Int,
        startAt: Double,
        tuning: GuideTuning = GuideTuning.walk,
        lateral: Double = 0.0,
        onEvent: (GuideEvent, Double) -> Boolean = { _, _ -> false },
    ): GuideState {
        var state = start
        val rad = bearingDeg * PI / 180
        for (i in 0..seconds) {
            val along = fromAlong + cos(rad) * i * 1.2
            val lat = lateral + sin(rad) * i * 1.2
            val out = guideStep(state, fixCoord(along, lat, 8.0), axisRoute, startAt + i, tuning)
            state = out.state
            val e = out.event
            if (e != null && onEvent(e, startAt + i)) return state
        }
        return state
    }

    private data class Confirmed(val state: GuideState, val confirmedAt: Double, val alongNow: Double)

    /** 경로 위 역주행(남행)으로 방위 축을 확정시킨 상태. 확정 이벤트가 나온 fix에서 멈춰 반환한다. */
    private fun confirmedByReversal(): Confirmed? {
        var state = walk(initialGuideState(axisRoute, 0.0).state, 60.0, 0.0, 33, 0.0)
        var hit: Pair<Double, Double>? = null
        state = walk(state, 100.0, 180.0, 55, 34.0) { e, t ->
            if (e == GuideEvent.OffRoute) {
                hit = t to 100 - (t - 34) * 1.2
                true
            } else {
                false
            }
        }
        val (t, along) = hit ?: return null
        return Confirmed(state, t, along)
    }

    @Test fun `경로 위 역주행은 방위 축이 확정한다 — 수직거리 축이 못 보는 이탈`() {
        val r = confirmedByReversal() ?: fail("역주행 55초 안에 방위 축이 확정해야 한다")
        assertEquals(GuidePhase.offRoute, r.state.phase)
        assertTrue(r.state.offRouteAxes.course)
        // 수직거리는 내내 임계 안이므로 거리 축은 잠기지 않았다.
        assertFalse(r.state.offRouteAxes.distance)
    }

    @Test fun `멈춰 서면 관측이 말라 복귀를 선언하지 않는다 — unknown은 정합이 아니다`() {
        val r = confirmedByReversal() ?: fail("확정 실패")
        var state = r.state
        for (i in 1..40) {
            val out = guideStep(state, fixCoord(r.alongNow, 0.0, 8.0), axisRoute, r.confirmedAt + i, GuideTuning.walk)
            state = out.state
            assertNotEquals(GuideEvent.BackOnRoute, out.event)
        }
        assertEquals(GuidePhase.offRoute, state.phase)
        assertTrue(state.offRouteAxes.course)
    }

    @Test fun `방위 축으로 확정한 이탈은 경로 방향으로 걸어야 복귀한다`() {
        val r = confirmedByReversal() ?: fail("확정 실패")
        var recovered = false
        val state = walk(r.state, r.alongNow, 0.0, 60, r.confirmedAt + 1) { e, _ ->
            if (e == GuideEvent.BackOnRoute) recovered = true
            recovered
        }
        assertTrue(recovered)
        assertNotEquals(GuidePhase.offRoute, state.phase)
        assertEquals(OffRouteAxes(), state.offRouteAxes)
    }

    @Test fun `차량 프로파일에서는 축이 통째로 꺼진다 — 보행으로만 측정된 상수다`() {
        fun run(tuning: GuideTuning): GuideState {
            val s = walk(initialGuideState(axisRoute, 0.0).state, 60.0, 0.0, 33, 0.0, tuning)
            return walk(s, 100.0, 180.0, 40, 34.0, tuning)
        }
        val walkState = run(GuideTuning.walk)
        val carState = run(GuideTuning.car)
        assertTrue(walkState.offRouteAxes.course)
        assertFalse(carState.offRouteAxes.course)
        assertNotEquals(GuidePhase.offRoute, carState.phase)
        // 게이트는 관측을 중화하므로 표 자체가 창에 쌓이지 않는다(spec §2.10 — 표 없음).
        assertTrue(carState.courseVotes.isEmpty())
    }

    @Test fun `국면 전이는 표결 창을 비우고 유도기 버퍼는 남긴다`() {
        val primed = walk(initialGuideState(axisRoute, 0.0).state, 60.0, 0.0, 20, 0.0)
        assertTrue(primed.courseVotes.isNotEmpty())
        assertTrue(primed.courseDerivation.fixes.isNotEmpty())

        // uncertain 진입(정확도 악화)
        val toUncertain = guideStep(primed, fixCoord(85.0, 0.0, 80.0), axisRoute, 21.0, GuideTuning.walk).state
        assertEquals(GuidePhase.uncertain, toUncertain.phase)
        assertTrue(toUncertain.courseVotes.isEmpty())
        assertTrue(toUncertain.courseDerivation.fixes.isNotEmpty())

        // reacquiring 진입(fix 공백 11초)
        val toReacquiring = guideStep(primed, fixCoord(85.0, 0.0, 8.0), axisRoute, 32.0, GuideTuning.walk).state
        assertEquals(GuidePhase.reacquiring, toReacquiring.phase)
        assertTrue(toReacquiring.courseVotes.isEmpty())
        assertTrue(toReacquiring.courseDerivation.fixes.isNotEmpty())
    }

    @Test fun `상태 재구성은 표결 창을 비우고 유도기 버퍼는 승계 인자로만 잇는다`() {
        val primed = walk(initialGuideState(axisRoute, 0.0).state, 60.0, 0.0, 20, 0.0)
        assertTrue(primed.courseDerivation.fixes.isNotEmpty())
        // 새 세션(인자 생략)은 창·버퍼 전부 초기화.
        val fresh = guideStateAt(axisRoute, 0.0, 100.0)
        assertTrue(fresh.courseVotes.isEmpty())
        assertTrue(fresh.courseDerivation.fixes.isEmpty())
        // 같은 세션의 재구성(재조회·모드 전환)은 버퍼를 넘겨 잇는다 — 창은 여전히 비운다.
        val carried = guideStateAt(axisRoute, 0.0, 100.0, courseDerivation = primed.courseDerivation)
        assertTrue(carried.courseVotes.isEmpty())
        assertEquals(primed.courseDerivation, carried.courseDerivation)
        assertEquals(primed.courseDerivation, initialGuideState(axisRoute, 100.0, courseDerivation = primed.courseDerivation).state.courseDerivation)
    }

    @Test fun `방위 축 확정이 최종 접근 진입보다 앞이다 — 같은 fix에서는 이탈이 이긴다`() {
        // 유도 관측으로는 "종점 접근 중 + 방위 어긋남"을 한 궤적으로 만들 수 없어(관측이 곧 이동이다) 창을 직접 구성한다:
        // mismatch 다수 창 + 종점 잔여 ≤ 진입선(순서 불변식 — 변이 안전망).
        val mismatchWindow = (0 until 9).map { CourseVoteSample(it * 2.0, CourseVote.mismatch) }
        val nearEnd = guideStateAt(axisRoute, 392.0, 0.0, hasFinalApproachGeometry = true)
            .copy(announcedUpTo = axisRoute.steps.size - 1, courseVotes = mismatchWindow)
        // 관측 없는 fix(버퍼 비어 있음) — 창은 이미 확정 다수이고 잔여 7m ≤ 진입선 10m.
        val out = guideStep(nearEnd, fixCoord(393.0, 0.0, 8.0), axisRoute, 18.0, GuideTuning.walk)
        assertEquals(GuideEvent.OffRoute, out.event)
        assertEquals(GuidePhase.offRoute, out.state.phase)
        assertTrue(out.state.offRouteAxes.course)

        // 대조: 창이 비어 있으면 같은 fix가 최종 접근에 진입한다(순서 외 조건 동일).
        val enter = guideStep(nearEnd.copy(courseVotes = emptyList()), fixCoord(393.0, 0.0, 8.0), axisRoute, 18.0, GuideTuning.walk)
        assertEquals(GuideEvent.FinalApproachEnter, enter.event)
    }

    @Test fun `uncertain을 경유해도 축 latch가 보존된다`() {
        val r = confirmedByReversal() ?: fail("확정 실패")
        var state = r.state
        for (i in 1..5) {
            state = guideStep(state, fixCoord(r.alongNow, 0.0, 80.0), axisRoute, r.confirmedAt + i, GuideTuning.walk).state
        }
        assertEquals(GuidePhase.uncertain, state.phase)
        assertEquals(GuidePhase.offRoute, state.resumePhase)
        assertTrue(state.offRouteAxes.course)
    }

    // ── 리듀서 trace 공유 fixture(`course-axis-scenarios.json`의 reducer) ──

    @Serializable
    private data class CourseAxisFile(val reducer: List<ReducerCase>) {
        @Serializable
        data class ReducerCase(
            val name: String,
            val steps: List<ReducerStep>,
            val fixes: List<ReducerFix>,
            val expectPhaseAtEnd: String,
            val expectAxes: ExpectAxes,
        )

        @Serializable
        data class ReducerStep(val len: Double, val desc: String)

        @Serializable
        data class ReducerFix(val t: Double, val along: Double, val lateral: Double, val acc: Double)

        @Serializable
        data class ExpectAxes(val distance: Boolean, val course: Boolean)
    }

    /** fixture는 경계만 적는다 — 보간 규칙은 파일의 `reducerComment`가 정본이다. */
    private fun interpolate(fixes: List<CourseAxisFile.ReducerFix>): List<CourseAxisFile.ReducerFix> {
        val out = mutableListOf(fixes[0])
        for (i in 1 until fixes.size) {
            val a = fixes[i - 1]
            val b = fixes[i]
            var t = a.t + 1
            while (t <= b.t) {
                val r = (t - a.t) / (b.t - a.t)
                out.add(CourseAxisFile.ReducerFix(t, a.along + r * (b.along - a.along), a.lateral + r * (b.lateral - a.lateral), b.acc))
                t += 1
            }
        }
        return out
    }

    @Test fun `방위 축 리듀서 trace — 웹과 같은 국면·축 latch로 끝난다`() {
        val cases = Fixtures.sharedJson("course-axis-scenarios.json", CourseAxisFile.serializer()).reducer
        // ⚠ 공회전 방지: 키 이름이 바뀌거나 배열이 비면 for 루프가 0회 돌고 조용히 통과한다.
        assertTrue(cases.size >= 2)
        for (sc in cases) {
            val route = routeFrom(sc.steps.map { Seg(it.len, it.desc) })
            var state = initialGuideState(route, 0.0).state
            // ⚠ fix에 방위 필드가 없는 것 자체가 계약이다 — 관측은 리듀서 내부 유도기가 궤적에서 만든다.
            for (f in interpolate(sc.fixes)) {
                state = guideStep(state, fixCoord(f.along, f.lateral, f.acc), route, f.t, GuideTuning.walk).state
            }
            assertEquals(sc.expectPhaseAtEnd, state.phase.rawValue, "${sc.name}: phase")
            assertEquals(OffRouteAxes(sc.expectAxes.distance, sc.expectAxes.course), state.offRouteAxes, "${sc.name}: axes")
        }
    }

    // ── 표시 좌표계·튜닝 ──

    @Test fun `표시 좌표계`() {
        assertEquals(10.0, projectionLagMeters)
        assertEquals(20.0, imminentAheadMeters) // 10 + lag 유도식(lag 하향은 실보행 재판정 2026-08-12)
        assertEquals(listOf(15.0, 10.0), imminentRepeatMeters) // 5m·0m 단계 + lag(위원장 피드백 2026-08-26)
        // 조합 불변식: 단계는 강한 내림차순, 마지막은 lag 이상.
        for (t in listOf(GuideTuning.walk, GuideTuning.car, GuideTuning.carDriver)) {
            val stages = listOf(t.imminentAheadM ?: 0.0) + t.imminentRepeatM
            for ((a, b) in stages.zipWithNext()) assertTrue(a > b)
            t.imminentRepeatM.lastOrNull()?.let { assertTrue(it >= projectionLagMeters) }
            if (t.imminentAheadM == null) assertTrue(t.imminentRepeatM.isEmpty())
        }
        assertEquals(0.0, displayEffectiveD(0.0, 0.0))
        assertEquals(10.0, displayEffectiveD(5.0, 0.0)) // 램프인: lag 5
        assertEquals(30.0, displayEffectiveD(20.0, 0.0)) // lag 10 포화
        assertEquals(70.0, displayEffectiveD(60.0, 50.0)) // 재조회 기준점 50 이후 10 → lag 10(포화점)
        assertEquals(40.0, displayEffectiveD(40.0, 50.0)) // 기준점 이전(방어)
    }

    @Test fun `세션 종료 튜닝 — 도착 추정 프로파일·기하 없는 진입·안전망 무이동 축`() {
        assertEquals(PresumedArrivalThresholds.walk, GuideTuning.walk.presumedArrival)
        assertEquals(PresumedArrivalThresholds.car, GuideTuning.car.presumedArrival)
        assertEquals(PresumedArrivalThresholds.car, GuideTuning.carDriver.presumedArrival)
        assertFalse(GuideTuning.walk.entersFinalApproachWithoutGeometry)
        assertTrue(GuideTuning.car.entersFinalApproachWithoutGeometry)
        assertTrue(GuideTuning.carDriver.entersFinalApproachWithoutGeometry)
        assertTrue(GuideTuning.walk.sessionIdleStationaryAxis)
        assertFalse(GuideTuning.car.sessionIdleStationaryAxis)
        assertFalse(GuideTuning.carDriver.sessionIdleStationaryAxis)
    }

    /** 재획득·복귀 재구성(`restateAt`)은 도착 래치를 승계한다 — 지우면 같은 경유지를 다시 알린다. */
    @Test fun `재구성은 경유지 래치를 승계한다`() {
        val route = routeFrom(listOf(Seg(100.0, "A"), Seg(100.0, "B")), waypointStepIndex = 1)
        val prev = initialGuideState(route, 0.0).state.copy(waypointReached = true, waypointPending = true)
        val re = restateAt(route, 150.0, 10.0, prev)
        assertTrue(re.waypointReached && re.waypointPending)
    }

    // ── 행동 → 소리 표(N2·K2, Kit `WalkActionTests` — FOUNDATION 유예분) ──

    @Test fun `행동별 임박 큐 소리`() {
        assertEquals(GuideTone.crosswalk, imminentTone(WalkAction.crosswalk))
        assertEquals(GuideTone.left, imminentTone(WalkAction.left))
        assertEquals(GuideTone.right, imminentTone(WalkAction.right))
        assertEquals(GuideTone.back, imminentTone(WalkAction.back))
        // 지하보도는 "그 외" — 횡단보도 비프는 음향신호기의 인용이라 붙이면 거짓 인용이 된다.
        assertEquals(GuideTone.ahead, imminentTone(WalkAction.underpass))
    }

    /** 갈래 선택은 회전과 같은 소리(K2 §3.1). */
    @Test fun `갈래 선택은 회전과 같은 소리`() {
        assertEquals(GuideTone.left, imminentTone(WalkAction.keepLeft))
        assertEquals(GuideTone.right, imminentTone(WalkAction.keepRight))
    }
}

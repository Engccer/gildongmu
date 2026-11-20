package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** 출구 대기(E84) 판정 — 공유 fixture `exit-hold-cases.json`을 읽는다. Kit `ExitHoldTests` 미러. */
class ExitHoldTest {
    @Serializable
    private data class FixtureFile(
        val constants: Constants,
        val steps: List<Step>,
        val recentBest: List<Recent>,
        val prefix: List<Prefix>,
        val storableRun: List<StorableRun>,
        val idleScenarios: List<IdleScenario>,
    ) {
        @Serializable
        data class Constants(
            val exitHoldMaxSeconds: Double,
            val exitHoldRecentWindowSeconds: Double,
            val exitHoldStationMaxMeters: Double,
            val exitLeadRepeatWindowSeconds: Double,
            val exitHoldObservationGapSeconds: Double,
        )

        @Serializable
        data class Fix(val lat: Double, val lng: Double, val accuracy: Double, val ageSeconds: Double) {
            val value: RouteOriginFix get() = RouteOriginFix(lat, lng, accuracy, ageSeconds)
        }

        @Serializable
        data class Sample(val fix: Fix, val at: Double) {
            val value: ExitHoldSample get() = ExitHoldSample(fix.value, at)
        }

        @Serializable
        data class Step(
            val name: String,
            val elapsed: Double,
            val fix: Fix,
            val isFirstStorable: Boolean,
            val stationDistance: Double? = null,
            val recent: List<Sample>,
            val storableSince: Double? = null,
            val now: Double,
            val expect: Expect,
        ) {
            @Serializable
            data class Expect(val kind: String, val reason: String? = null, val accuracy: Double? = null, val ageSeconds: Double? = null)
        }

        @Serializable
        data class Recent(val name: String, val samples: List<Sample>, val now: Double, val expect: Expect? = null) {
            @Serializable
            data class Expect(val accuracy: Double, val ageSeconds: Double)
        }

        @Serializable
        data class Prefix(
            val name: String,
            val hasExit: Boolean,
            val dropped: Boolean,
            val secondsSincePosted: Double? = null,
            val expect: Boolean,
        )

        @Serializable
        data class StorableRun(
            val name: String,
            val previousStart: Double? = null,
            val previousSampleAt: Double? = null,
            val now: Double,
            val expect: Double,
        )

        @Serializable
        data class IdleScenario(val name: String, val hold: Boolean, val events: List<Event>) {
            @Serializable
            data class Event(val t: Double, val kind: String, val moved: Double? = null, val expect: String? = null)
        }
    }

    private val fixture by lazy { Fixtures.sharedJson("exit-hold-cases.json", FixtureFile.serializer()) }

    @Test fun `상수는 fixture와 같다`() {
        val c = fixture.constants
        assertEquals(c.exitHoldMaxSeconds, exitHoldMaxSeconds)
        assertEquals(c.exitHoldRecentWindowSeconds, exitHoldRecentWindowSeconds)
        assertEquals(c.exitHoldStationMaxMeters, exitHoldStationMaxMeters)
        assertEquals(c.exitLeadRepeatWindowSeconds, exitLeadRepeatWindowSeconds)
        assertEquals(c.exitHoldObservationGapSeconds, exitHoldObservationGapSeconds)
    }

    @Test fun `fix 한 건 판정 fixture`() {
        val steps = fixture.steps
        assertTrue(steps.size >= 14)
        for (s in steps) {
            val got = exitHoldStep(
                elapsed = s.elapsed, fix = s.fix.value, isFirstStorable = s.isFirstStorable,
                stationDistance = s.stationDistance, recent = s.recent.map { it.value }, storableSince = s.storableSince,
                now = s.now,
            )
            when {
                s.expect.kind == "wait" && got == ExitHoldDecision.Wait -> Unit
                s.expect.kind == "abandon" && got == ExitHoldDecision.Abandon -> Unit
                s.expect.kind == "fetch" && got is ExitHoldDecision.Fetch -> {
                    assertEquals(s.expect.reason, got.reason.rawValue, s.name)
                    assertEquals(s.expect.accuracy, got.fix.accuracy, s.name)
                    assertEquals(s.expect.ageSeconds, got.fix.ageSeconds, s.name)
                }
                else -> fail("${s.name}: expected ${s.expect.kind}, got $got")
            }
        }
    }

    @Test fun `최근 창 최선값 fixture`() {
        assertTrue(fixture.recentBest.isNotEmpty())
        for (r in fixture.recentBest) {
            val got = exitHoldRecentBest(samples = r.samples.map { it.value }, now = r.now)
            assertEquals(r.expect?.accuracy, got?.accuracy, r.name)
            assertEquals(r.expect?.ageSeconds, got?.ageSeconds, r.name)
        }
    }

    @Test fun `출구 문장 접두 fixture - 출구 없음은 언제나 거짓`() {
        assertTrue(fixture.prefix.isNotEmpty())
        for (p in fixture.prefix) {
            assertEquals(p.expect, exitLeadPrefixNeeded(hasExit = p.hasExit, dropped = p.dropped, secondsSincePosted = p.secondsSincePosted), p.name)
        }
    }

    @Test fun `보관 가능 fix 연속 구간 fixture`() {
        assertTrue(fixture.storableRun.isNotEmpty())
        for (r in fixture.storableRun) {
            assertEquals(r.expect, exitHoldStorableRunStart(previousStart = r.previousStart, previousSampleAt = r.previousSampleAt, now = r.now), r.name)
        }
    }

    /** 순서 있는 시나리오 — 모델 배선(fix마다 하한 갱신 → 틱마다 판정)을 그대로 따른다. */
    @Test fun `창과 안전망 시나리오 fixture - 출구 없는 세션은 종전과 같다`() {
        val scenarios = fixture.idleScenarios
        assertTrue(scenarios.size >= 15)
        for (scenario in scenarios) {
            var lastFixAt: Double? = null
            var lastProgressAt: Double? = null
            var floors = ExitHoldIdleFloors()
            var holdActive = scenario.hold
            var hasAnchor = false
            for (event in scenario.events) {
                when (event.kind) {
                    "fix" -> {
                        val moved = event.moved ?: 0.0
                        if (holdActive) {
                            floors = exitHoldIdleFloorsAfterFix(
                                floors, now = event.t, previousFixAt = lastFixAt, startedAt = 0.0,
                                distanceFromAnchor = if (hasAnchor) moved else null,
                            ).floors
                        }
                        lastFixAt = event.t
                        if (hasAnchor && moved >= sessionProgressEpsilonMeters) lastProgressAt = event.t
                        hasAnchor = true
                    }
                    "close" -> {
                        holdActive = false
                        floors = exitHoldIdleFloorsAfterClose(now = event.t)
                    }
                    "tick" -> {
                        val got = exitHoldAwareSessionIdleStep(
                            now = event.t, startedAt = 0.0, lastFixAt = lastFixAt, lastProgressAt = lastProgressAt,
                            floors = floors, holdActive = holdActive, tuning = GuideTuning.walk, presumedArrivalCanFire = false,
                        )
                        assertEquals(event.expect, got?.rawValue, "${scenario.name} t=${event.t}")
                        if (!scenario.hold) {
                            val legacy = sessionIdleStep(
                                secondsSinceUsableFix = event.t - maxOf(0.0, lastFixAt ?: 0.0),
                                secondsSinceProgress = sessionIdleStationaryElapsed(
                                    secondsSinceProgress = event.t - maxOf(0.0, lastProgressAt ?: 0.0), presumedArrivalCanFire = false,
                                ),
                                noFixSeconds = GuideTuning.walk.sessionIdleNoFixSeconds,
                            )
                            assertEquals(legacy, got, "${scenario.name} t=${event.t} legacy")
                        }
                    }
                    else -> fail("${scenario.name}: unknown event ${event.kind}")
                }
            }
        }
    }

    @Test fun `자동차 조율값은 창이 없어도 무이동 축이 없다`() {
        assertNull(
            exitHoldAwareSessionIdleStep(
                now = 800.0, startedAt = 0.0, lastFixAt = 799.0, lastProgressAt = null, floors = ExitHoldIdleFloors(),
                holdActive = false, tuning = GuideTuning.car, presumedArrivalCanFire = false,
            ),
        )
    }

    @Test fun `조율값 - 출구 대기 창의 두절 임계는 900초`() {
        assertEquals(900.0, GuideTuning.walk.sessionIdleNoFixExitHoldSeconds)
        assertEquals(900.0, GuideTuning.car.sessionIdleNoFixExitHoldSeconds)
    }
}

package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 배타적 톤 계층 — Kit `GuideToneLayerTests` 미러. 공유 fixture(`tone-layer-scenarios.json`)로 **같은 입력 열이 같은
 * 톤 열을 내는지** 강제하고, 계층 배타성·빈도·정숙·회복·도착·최대 침묵·감쇠 계약을 단위로 잠근다.
 */
class GuideToneLayerTest {
    @Serializable
    private data class ToneScenarioFile(val scenarios: List<Scenario>) {
        @Serializable
        data class Scenario(val name: String, val initial: Initial, val steps: List<Step>)

        @Serializable
        data class Initial(val anchorDistance: Double, val trend: String)

        @Serializable
        data class TrendJson(val distance: Double, val deadBand: Double, val motion: String, val closerIntervalSeconds: Double)

        @Serializable
        data class Step(
            val now: Double,
            val unreliable: Boolean? = null,
            val priorityTone: String? = null,
            val eventOwned: Boolean? = null,
            val trend: TrendJson? = null,
            val arrived: Boolean? = null,
            val rebaseTrend: Boolean? = null,
            val expect: String? = null,
        )
    }

    private fun beaconTrend(raw: String) = when (raw) {
        "closer" -> BeaconTrend.closer
        "farther" -> BeaconTrend.farther
        else -> BeaconTrend.none
    }

    private fun motionState(raw: String) = when (raw) {
        "stopped" -> MotionState.stopped
        "speedUnknown" -> MotionState.speedUnknown
        else -> MotionState.moving
    }

    @Test fun `웹 정본 시나리오와 톤 열이 일치한다`() {
        val scenarios = Fixtures.sharedJson("tone-layer-scenarios.json", ToneScenarioFile.serializer()).scenarios
        assertTrue(scenarios.isNotEmpty())
        for (scenario in scenarios) {
            var state = ToneLayerState.initial.copy(
                anchorDistance = scenario.initial.anchorDistance,
                trend = beaconTrend(scenario.initial.trend),
            )
            for ((index, step) in scenario.steps.withIndex()) {
                val input = ToneLayerInput(
                    unreliable = step.unreliable ?: false,
                    priorityTone = step.priorityTone?.let(BeaconTone::fromRawValue),
                    eventOwned = step.eventOwned ?: false,
                    trend = step.trend?.let {
                        TrendInput(distance = it.distance, deadBand = it.deadBand, motion = motionState(it.motion), closerIntervalSeconds = it.closerIntervalSeconds)
                    },
                    arrived = step.arrived ?: false,
                    rebaseTrend = step.rebaseTrend ?: false,
                )
                val out = toneLayerStep(state, input, step.now)
                state = out.state
                assertEquals(step.expect, out.tone?.rawValue, "${scenario.name} step $index (now=${step.now})")
            }
        }
    }

    private fun trend(
        distance: Double,
        motion: MotionState = MotionState.moving,
        deadBand: Double = 15.0,
        closer: Double = ToneLayerConstants.walkCloserIntervalSeconds,
    ) = TrendInput(distance = distance, deadBand = deadBand, motion = motion, closerIntervalSeconds = closer)

    /** 실제 코드에서는 앵커가 처음 설정되는 fix가 `anchorSetAt`을 잡는다. */
    private fun anchored(distance: Double, trend: BeaconTrend = BeaconTrend.none) =
        ToneLayerState.initial.copy(anchorDistance = distance, trend = trend, anchorSetAt = 0.0)

    /** 목적지와 평행하게 걷는 상황 — 이동 중인데 거리가 거의 안 변한다. */
    private fun flat(distance: Double) = TrendInput(
        distance = distance, deadBand = 15.0, deadBandFloor = 5.0, motion = MotionState.moving,
        closerIntervalSeconds = ToneLayerConstants.walkCloserIntervalSeconds,
    )

    // ── 계층 배타성 — 상위와 추세가 **동시에 참인** fixture로만 관측 가능하다 ──

    @Test fun `1단계 unreliable이 이긴다 — 추세가 동시에 참이어도 앵커가 갱신되지 않는다`() {
        val (next, tone) = toneLayerStep(anchored(100.0, BeaconTrend.closer), ToneLayerInput(unreliable = true, trend = trend(50.0)), 10.0)
        assertEquals(BeaconTone.unreliable, tone)
        assertEquals(100.0, next.anchorDistance) // trendStep 미호출
        assertEquals(BeaconTrend.closer, next.trend)
        assertNull(next.lastTrendToneAt)
    }

    @Test fun `2단계 우선 톤이 있으면 추세 판정을 하지 않는다`() {
        val (next, tone) = toneLayerStep(anchored(100.0), ToneLayerInput(priorityTone = BeaconTone.ahead, trend = trend(50.0)), 10.0)
        assertEquals(BeaconTone.ahead, tone)
        assertEquals(100.0, next.anchorDistance)
        assertNull(next.lastTrendToneAt)
    }

    /**
     * ⚠ **이 순서가 `ahead`·`warning`의 존재 조건이다.** 리듀서는 우선 톤을 항상 이벤트와 **함께** 내므로 두 값을
     * 서로 다른 스텝에 나눠 두면 3단계를 2단계 앞으로 옮기는 변이가 전량 초록을 통과한다.
     */
    @Test fun `이벤트를 동반해도 우선 톤이 이긴다`() {
        for (tone in listOf(BeaconTone.ahead, BeaconTone.warning)) {
            val out = toneLayerStep(anchored(100.0), ToneLayerInput(priorityTone = tone, eventOwned = true, trend = trend(50.0)), 10.0)
            assertEquals(tone, out.tone)
        }
    }

    @Test fun `3단계 이벤트가 톤 자리를 소유하면 침묵하고 앵커도 불변이다`() {
        val (next, tone) = toneLayerStep(anchored(100.0), ToneLayerInput(eventOwned = true, trend = trend(50.0)), 10.0)
        assertNull(tone)
        assertEquals(100.0, next.anchorDistance)
    }

    @Test fun `4단계 상위가 전부 비면 추세 톤이 난다`() {
        val (next, tone) = toneLayerStep(anchored(100.0), ToneLayerInput(trend = trend(80.0)), 10.0)
        assertEquals(BeaconTone.closer, tone)
        assertEquals(80.0, next.anchorDistance)
    }

    // ── 추세 축 내부 ──

    @Test fun `정지가 확정되면 데드밴드와 무관하게 tick이다`() {
        assertEquals(BeaconTone.tick, toneLayerStep(anchored(100.0), ToneLayerInput(trend = trend(99.0, MotionState.stopped)), 10.0).tone)
    }

    @Test fun `속도를 모르면 tick을 내지 않는다`() {
        assertNull(toneLayerStep(anchored(100.0), ToneLayerInput(trend = trend(99.0, MotionState.speedUnknown)), 10.0).tone)
    }

    @Test fun `speedUnknown이어도 데드밴드를 넘으면 추세 톤은 난다`() {
        assertEquals(BeaconTone.closer, toneLayerStep(anchored(100.0), ToneLayerInput(trend = trend(80.0, MotionState.speedUnknown)), 10.0).tone)
    }

    @Test fun `tick은 자기 간격을 지킨다`() {
        val input = ToneLayerInput(trend = trend(99.0, MotionState.stopped))
        var out = toneLayerStep(anchored(100.0), input, 10.0)
        assertEquals(BeaconTone.tick, out.tone)
        out = toneLayerStep(out.state, input, 12.0)
        assertNull(out.tone)
        assertEquals(BeaconTone.tick, toneLayerStep(out.state, input, 13.5).tone)
    }

    // ── 빈도 — 수단별 비대칭 ──

    @Test fun `closer 간격은 수단별이다 — 차량 10초 창에서는 억제된다`() {
        val car = ToneLayerConstants.carCloserIntervalSeconds
        var out = toneLayerStep(anchored(1000.0), ToneLayerInput(trend = trend(900.0, closer = car)), 10.0)
        assertEquals(BeaconTone.closer, out.tone)
        out = toneLayerStep(out.state, ToneLayerInput(trend = trend(800.0, closer = car)), 14.0)
        assertNull(out.tone) // 4초 뒤 — 10초 창 안
        assertEquals(BeaconTone.closer, toneLayerStep(out.state, ToneLayerInput(trend = trend(700.0, closer = car)), 21.0).tone)
    }

    @Test fun `farther는 수단을 가리지 않는다 — 경고 축`() {
        val car = ToneLayerConstants.carCloserIntervalSeconds
        val out = toneLayerStep(anchored(1000.0), ToneLayerInput(trend = trend(1100.0, closer = car)), 10.0)
        assertEquals(BeaconTone.farther, out.tone)
        assertEquals(BeaconTone.farther, toneLayerStep(out.state, ToneLayerInput(trend = trend(1200.0, closer = car)), 12.5).tone)
    }

    // ── 정숙 구간 ──

    @Test fun `행동 안내 후 3초는 추세 톤을 억제하고 그 사이 앵커도 불변이다`() {
        var out = toneLayerStep(anchored(100.0), ToneLayerInput(priorityTone = BeaconTone.ahead), 10.0)
        out = toneLayerStep(out.state, ToneLayerInput(trend = trend(80.0)), 11.0)
        assertNull(out.tone)
        assertEquals(100.0, out.state.anchorDistance) // 억제 중에도 trendStep 미호출
        assertEquals(BeaconTone.closer, toneLayerStep(out.state, ToneLayerInput(trend = trend(80.0)), 13.5).tone)
    }

    // ── 신뢰 불가 진입·지속·회복 ──

    @Test fun `진입은 즉시 1회, 지속은 간격 반복`() {
        val input = ToneLayerInput(unreliable = true)
        var out = toneLayerStep(ToneLayerState.initial, input, 0.0)
        assertEquals(BeaconTone.unreliable, out.tone)
        out = toneLayerStep(out.state, input, 5.0)
        assertNull(out.tone)
        assertEquals(BeaconTone.unreliable, toneLayerStep(out.state, input, 10.1).tone)
    }

    /** ⚠ 첫 진입만으로는 "즉시 1회" 계약이 관측되지 않는다 — 회복 후 재진입이 간격 판정과 둘을 가른다. */
    @Test fun `회복 후 재진입도 즉시 1회다 — 간격 창 안이어도`() {
        var state = toneLayerStep(anchored(500.0, BeaconTrend.closer), ToneLayerInput(unreliable = true), 0.0).state
        state = toneLayerStep(state, ToneLayerInput(trend = trend(120.0)), 3.0).state
        assertEquals(BeaconTone.unreliable, toneLayerStep(state, ToneLayerInput(unreliable = true), 5.0).tone)
    }

    @Test fun `회복은 앵커 재기준화 후 현재 상태 톤 1회`() {
        val state = toneLayerStep(anchored(500.0, BeaconTrend.closer), ToneLayerInput(unreliable = true), 0.0).state
        val (next, tone) = toneLayerStep(state, ToneLayerInput(trend = trend(120.0)), 3.0)
        assertEquals(BeaconTone.closer, tone) // 데드밴드 미달이어도 즉시 1회
        assertEquals(120.0, next.anchorDistance) // 재기준화
        assertFalse(next.needsRebase)
    }

    @Test fun `회복 fix에서 상위 톤이 나도 재기준화 기회를 잃지 않는다`() {
        var state = toneLayerStep(anchored(500.0, BeaconTrend.closer), ToneLayerInput(unreliable = true), 0.0).state
        // 복귀하는 fix에서 이탈 경고가 났다 — 그 fix는 추세 축에 닿지 못한다.
        state = toneLayerStep(state, ToneLayerInput(priorityTone = BeaconTone.warning), 3.0).state
        assertTrue(state.needsRebase)
        // 정숙 구간이 끝난 다음 추세 fix가 재기준화를 소비한다.
        val (next, tone) = toneLayerStep(state, ToneLayerInput(trend = trend(120.0)), 7.0)
        assertEquals(120.0, next.anchorDistance)
        assertEquals(BeaconTone.closer, tone)
    }

    @Test fun `호출부가 요청한 축 전환도 재기준화한다`() {
        val (next, tone) = toneLayerStep(anchored(500.0, BeaconTrend.closer), ToneLayerInput(trend = trend(120.0), rebaseTrend = true), 10.0)
        assertEquals(120.0, next.anchorDistance)
        assertEquals(BeaconTone.closer, tone)
    }

    @Test fun `추세가 none인 상태에서 회복하면 앵커만 잡고 침묵한다`() {
        val state = toneLayerStep(ToneLayerState.initial, ToneLayerInput(unreliable = true), 0.0).state
        val (next, tone) = toneLayerStep(state, ToneLayerInput(trend = trend(120.0)), 3.0)
        assertNull(tone)
        assertEquals(120.0, next.anchorDistance)
    }

    @Test fun `정지 중 회복이면 tick으로 알린다`() {
        val state = toneLayerStep(anchored(500.0, BeaconTrend.closer), ToneLayerInput(unreliable = true), 0.0).state
        assertEquals(BeaconTone.tick, toneLayerStep(state, ToneLayerInput(trend = trend(120.0, MotionState.stopped)), 3.0).tone)
    }

    // ── 도착 종단 ──

    @Test fun `도착 후에는 tick·추세·unreliable을 전부 억제한다`() {
        val state = anchored(30.0)
        assertNull(toneLayerStep(state, ToneLayerInput(trend = trend(25.0, MotionState.stopped), arrived = true), 10.0).tone)
        assertNull(toneLayerStep(state, ToneLayerInput(unreliable = true, arrived = true), 10.0).tone)
    }

    @Test fun `도착 후에도 이탈 경고는 난다`() {
        assertEquals(BeaconTone.warning, toneLayerStep(ToneLayerState.initial, ToneLayerInput(priorityTone = BeaconTone.warning, arrived = true), 10.0).tone)
    }

    // ── 최대 침묵 계약 ──

    @Test fun `계약값은 데드밴드 ÷ 느린 구간 속도의 반올림이다`() {
        assertTrue(abs(ToneLayerConstants.maxNormalSilenceSeconds - 15.0 / 0.7) < 0.5)
    }

    private fun maxGapWalking(stepMeters: Double, seconds: Int): Pair<Double, Double> {
        var state = anchored(300.0)
        var lastToneAt = 0.0
        var maxGap = 0.0
        var distance = 300.0
        for (i in 1..seconds) {
            val now = i.toDouble()
            distance -= stepMeters
            val out = toneLayerStep(state, ToneLayerInput(trend = trend(distance)), now)
            state = out.state
            if (out.tone != null) {
                maxGap = maxOf(maxGap, now - lastToneAt)
                lastToneAt = now
            }
        }
        return maxGap to lastToneAt
    }

    @Test fun `느린 보행에서 침묵은 데드밴드 통과 시간을 넘지 않는다`() {
        // 0.7m/s(느린 구간)로 1초마다 fix. 15m 데드밴드 통과에 약 21.4초 + fix 주기 양자화.
        val (maxGap, lastToneAt) = maxGapWalking(0.7, 90)
        assertTrue(maxGap <= 15.0 / 0.7 + 1.0)
        assertTrue(lastToneAt > 0) // 침묵만 하다 끝나지 않았다
    }

    @Test fun `평상 보행에서는 계약값 안에 들어온다`() {
        assertTrue(maxGapWalking(1.17, 60).first <= ToneLayerConstants.maxNormalSilenceSeconds)
    }

    // ── 데드밴드 시간 감쇠(평평한 거리 축) ──

    @Test fun `계약값 21초 안에서는 데드밴드가 원값 그대로다`() {
        assertEquals(15.0, decayedDeadBand(15.0, 5.0, 0.0))
        assertEquals(15.0, decayedDeadBand(15.0, 5.0, 21.0))
    }

    @Test fun `유예 이후 선형으로 하한까지 줄어든다`() {
        assertTrue(abs(decayedDeadBand(15.0, 5.0, 31.5) - 10) < 0.001)
        assertEquals(5.0, decayedDeadBand(15.0, 5.0, 42.0))
        assertEquals(5.0, decayedDeadBand(15.0, 5.0, 120.0))
    }

    @Test fun `하한이 원값 이상이면 감쇠가 없다`() {
        assertEquals(15.0, decayedDeadBand(15.0, 15.0, 100.0))
    }

    /** ⚠ 접근성 감사 H1의 재현이다. 감쇠가 없으면 톤이 영영 나지 않는다. */
    @Test fun `거리가 8m만 변하는 평행 이동에서도 결국 톤이 난다`() {
        var state = anchored(300.0)
        var firstToneAt: Double? = null
        for (i in 1..90) {
            val now = i.toDouble()
            val out = toneLayerStep(state, ToneLayerInput(trend = flat(300 - now * 0.09)), now)
            state = out.state
            if (out.tone != null && firstToneAt == null) firstToneAt = now
        }
        val first = assertNotNull(firstToneAt)
        // 계약값 안에서는 울리지 않는다(현행 동작 보존).
        assertTrue(first > ToneLayerConstants.maxNormalSilenceSeconds)
    }

    @Test fun `정상 접근에서는 감쇠가 발동하지 않는다`() {
        var state = anchored(300.0)
        var firstToneAt: Double? = null
        for (i in 1..40) {
            val now = i.toDouble()
            val out = toneLayerStep(state, ToneLayerInput(trend = flat(300 - now * 1.17)), now)
            state = out.state
            if (out.tone != null && firstToneAt == null) firstToneAt = now
        }
        // 평상 보행이면 13초 안에 첫 톤 — 유예(21초)에 닿기 전이다.
        assertTrue((firstToneAt ?: Double.POSITIVE_INFINITY) <= ToneLayerConstants.maxNormalSilenceSeconds)
    }

    @Test fun `톤이 나면 감쇠 기준이 리셋된다`() {
        var state = anchored(300.0)
        state = toneLayerStep(state, ToneLayerInput(trend = flat(280.0)), 1.0).state
        assertEquals(1.0, state.anchorSetAt)
        assertNull(toneLayerStep(state, ToneLayerInput(trend = flat(272.0)), 30.0).tone)
    }
}

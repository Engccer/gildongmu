package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * 대중교통 승차 추세 톤 — Kit `TransitGuideToneTests` 미러. 공유 fixture(`transit-guide-tone-scenarios.json`)로 리듀서
 * (`transitGuideStep`)와 층(`transitToneStep`)을 **이어서** 돌린다(층 단독 fixture는 phaseGen 리셋·신호 전이·도착 억제를
 * 지나지 않는다). routes·locks는 `transit-guide-scenarios.json`을 참조한다.
 */
class TransitGuideToneTest {
    @Serializable
    private data class BaseFixture(val routes: Map<String, TransitGuideRoute>, val locks: Map<String, TransitLock>)

    @Serializable
    private data class ToneFixture(val scenarios: List<Scenario>) {
        @Serializable
        data class Scenario(val name: String, val route: String, val steps: List<Step>)

        /** `expect`는 "명시 null"(무음·앵커 없음·이벤트 없음)과 "미지정"을 갈라야 해서 JSON 객체 그대로 받는다. */
        @Serializable
        data class Step(val at: Double, val input: Input, val expect: JsonObject)

        @Serializable
        data class Input(val kind: String, val lock: String? = null, val seq: Int? = null, val phaseGen: Int? = null, val poll: Poll? = null)

        @Serializable
        data class Poll(val kind: String, val items: List<TransitTrackItem>? = null)
    }

    private fun toInput(raw: ToneFixture.Input, locks: Map<String, TransitLock>): TransitGuideInput {
        fun lock() = locks[raw.lock ?: fail("lock 없음")] ?: fail("lock 미정의 ${raw.lock}")
        return when (raw.kind) {
            "board" -> TransitGuideInput.Board(lock())
            "boardAboard" -> TransitGuideInput.BoardAboard(lock())
            "declareArrived" -> TransitGuideInput.DeclareArrived
            "confirmBoarded" -> TransitGuideInput.ConfirmBoarded
            "restoreBoarding" -> TransitGuideInput.RestoreBoarding
            "changeBoarding" -> TransitGuideInput.ChangeBoarding
            "advance" -> TransitGuideInput.Advance
            "poll" -> {
                val p = raw.poll ?: fail("poll 없음")
                TransitGuideInput.Poll(
                    raw.seq ?: fail("seq 없음"),
                    raw.phaseGen ?: fail("phaseGen 없음"),
                    when (p.kind) {
                        "ok" -> TransitTrackPoll.Ok(p.items ?: emptyList())
                        "empty" -> TransitTrackPoll.Empty
                        "unsupported" -> TransitTrackPoll.Unsupported
                        "failed" -> TransitTrackPoll.Failed
                        else -> fail("미지 poll ${p.kind}")
                    },
                )
            }
            else -> fail("미지 입력 ${raw.kind}")
        }
    }

    /** 이벤트 종류를 fixture 문자열로(첫 글자 소문자 — sealed 케이스 이름이 Swift 케이스 이름의 PascalCase다). */
    private fun eventKind(e: TransitGuideEvent?): String? = e?.let { it::class.simpleName?.replaceFirstChar(Char::lowercaseChar) }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

    @Test fun `공유 fixture 시나리오`() {
        val base = Fixtures.sharedJson("transit-guide-scenarios.json", BaseFixture.serializer())
        val tone = Fixtures.sharedJson("transit-guide-tone-scenarios.json", ToneFixture.serializer())
        assertTrue(tone.scenarios.isNotEmpty())
        for (scenario in tone.scenarios) {
            val route = base.routes[scenario.route] ?: fail("route 없음: ${scenario.route}")
            var state = initTransitGuide(route, 0.0)
            var toneState = TransitToneState.initial
            for ((i, step) in scenario.steps.withIndex()) {
                val ctx = "${scenario.name} step $i"
                val before = state
                val result = transitGuideStep(before, toInput(step.input, base.locks), route, step.at)
                state = result.state
                val out = transitToneStep(toneState, before, result.state, result.event, step.at / 1000)
                toneState = out.state
                val ex = step.expect
                if ("tone" in ex) assertEquals(ex.str("tone"), out.tone?.rawValue, ctx)
                if ("anchor" in ex) assertEquals(ex.int("anchor"), toneState.anchorRemaining, ctx)
                if ("event" in ex) assertEquals(ex.str("event"), eventKind(result.event), "$ctx event")
                ex.str("phase")?.let { assertEquals(it, result.state.phase.rawValue, ctx) }
                ex.str("signal")?.let { assertEquals(it, result.state.signal.rawValue, ctx) }
            }
        }
    }

    @Test fun `확정 도착은 층을 얼린다`() {
        val s = TransitToneState(anchorRemaining = 3, wasUnreliable = true, lastUnreliableAt = 0.0)
        val out = transitToneLayerStep(s, TransitToneInput(unreliable = true, eventOwned = false, remaining = 0, arrivedCertain = true), 500.0)
        assertNull(out.tone)
        assertEquals(s, out.state)
    }

    @Test fun `이벤트 소유가 신뢰 불가를 이기고 타이머를 되돌린다`() {
        val s = TransitToneState(anchorRemaining = 5, wasUnreliable = true, lastUnreliableAt = 0.0)
        val out = transitToneLayerStep(s, TransitToneInput(unreliable = true, eventOwned = true, remaining = null, arrivedCertain = false), 300.0)
        assertNull(out.tone)
        assertEquals(300.0, out.state.lastUnreliableAt)
        val quiet = TransitToneInput(unreliable = true, eventOwned = false, remaining = null, arrivedCertain = false)
        assertNull(transitToneLayerStep(out.state, quiet, 300 + transitUnreliableIntervalSeconds - 1).tone)
        assertEquals(BeaconTone.unreliable, transitToneLayerStep(out.state, quiet, 300 + transitUnreliableIntervalSeconds).tone)
    }
}

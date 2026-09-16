package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * 하단 2행 파생 계층 공유 시나리오 러너(spec 2026-08-11 §8-1) — Kit `GuideLiveRowsTests` 미러.
 *
 * 웹 정본과 같은 공유 fixture(`guide-live-rows-scenarios.json`)와 `messages/ko.json`을 읽어, 디스크립터를 ko 템플릿으로
 * 렌더한 **최종 문자열**을 대조한다 — 키 존재·인자 어순 드리프트까지 잠근다. 렌더 규칙은 웹 guide-live-rows.test.ts와 동일해야 한다.
 */
class GuideLiveRowsTest {
    @Serializable
    private data class LiveScenarioFile(val scenarios: List<Scenario>) {
        @Serializable
        data class Scenario(
            val name: String,
            /** 수단(문구 키 선택). 미지정 walk. */
            val kind: String? = null,
            /** 회전 접근 전환 잔여(m). 미지정 walkTurnApproachMeters. */
            val turnApproachM: Double? = null,
            val steps: List<Step>,
            val baselineD: Double,
            val inputs: List<Input>,
            val expect: List<Expectation>,
        )

        @Serializable
        data class Step(
            val len: Double,
            val desc: String,
            val target: String? = null,
            val anchor: String? = null,
            val action: String? = null,
            val crossing: Boolean? = null,
        )

        @Serializable
        data class Input(val d: Double, val phase: String, val reset: Boolean? = null, val baselineD: Double? = null)

        @Serializable
        data class Expectation(val afterInput: Int, val top: String, val next: String)
    }

    /** ko.json에서 러너가 쓰는 키만 디코딩한다(전체 스키마 종속 금지 — `KitJson`이 모르는 키를 무시한다). */
    @Serializable
    private data class KoMessages(val guide: Guide) {
        @Serializable
        data class Guide(
            val offRoute: String,
            val uncertain: String,
            val reacquiring: String,
            val imminent: Map<String, String>,
            val carImminent: Map<String, String>,
            val carLiveAction: Map<String, String>,
            val liveStraight: String,
            val liveStraightNoName: String,
            val liveTurnIn: String,
            val liveAction: Map<String, String>,
            val nextAction: String,
            val nextStraight: String,
            val nextStraightNoName: String,
            val progressNext: String,
        )
    }

    private fun fmt(template: String, args: Map<String, String>): String =
        args.entries.fold(template) { out, (key, value) -> out.replace("{$key}", value) }

    private fun phaseFrom(raw: String) = GuidePhase.entries.firstOrNull { it.name == raw } ?: fail("unknown phase $raw")

    /** 행동 구는 수단별이다(K2 §4) — 디스크립터는 같고 렌더 키만 갈린다. */
    private fun renderTop(top: LiveTopRow?, g: KoMessages.Guide, car: Boolean): String {
        val phrases = if (car) g.carLiveAction else g.liveAction
        val imminents = if (car) g.carImminent else g.imminent
        return when (top) {
            null -> ""
            LiveTopRow.OffRoute -> g.offRoute
            LiveTopRow.Uncertain -> g.uncertain
            LiveTopRow.Reacquiring -> g.reacquiring
            is LiveTopRow.Crossing -> top.text
            is LiveTopRow.TurnSoon -> imminents[top.action.rawValue] ?: ""
            is LiveTopRow.TurnIn -> fmt(g.liveTurnIn, mapOf("n" to top.meters.toString(), "action" to (phrases[top.action.rawValue] ?: "")))
            is LiveTopRow.Straight -> top.target?.let { fmt(g.liveStraight, mapOf("target" to it, "n" to top.meters.toString())) }
                ?: fmt(g.liveStraightNoName, mapOf("n" to top.meters.toString()))
        }
    }

    private fun renderNext(next: LiveNextRow?, g: KoMessages.Guide, car: Boolean): String {
        val phrases = if (car) g.carLiveAction else g.liveAction
        val step = when (next) {
            null -> return ""
            is LiveNextRow.Action -> {
                val phrase = phrases[next.action.rawValue] ?: ""
                next.anchor?.let { fmt(g.nextAction, mapOf("anchor" to it, "action" to phrase)) } ?: phrase
            }
            is LiveNextRow.Straight -> next.target?.let { fmt(g.nextStraight, mapOf("target" to it, "n" to next.meters.toString())) }
                ?: fmt(g.nextStraightNoName, mapOf("n" to next.meters.toString()))
            is LiveNextRow.Crossing -> phrases[next.action.rawValue] ?: ""
            is LiveNextRow.Turn -> phrases[next.action.rawValue] ?: ""
        }
        return fmt(g.progressNext, mapOf("step" to step))
    }

    @Test fun `공유 시나리오 표`() {
        val file = Fixtures.sharedJson("guide-live-rows-scenarios.json", LiveScenarioFile.serializer())
        val ko = KitJson.decodeFromString(KoMessages.serializer(), Fixtures.repoRoot.resolve("messages/ko.json").readText())
        assertTrue(file.scenarios.isNotEmpty())
        for (sc in file.scenarios) {
            var acc = 0.0
            val steps = sc.steps.map { s ->
                val input = LiveStepInput(
                    description = s.desc, startD = acc, endD = acc + s.len, target = s.target, anchor = s.anchor,
                    action = s.action?.let { WalkAction.fromRawValue(it) ?: fail("미지 action $it") },
                    crossing = s.crossing ?: false,
                )
                acc += s.len
                input
            }
            val car = sc.kind == "car"
            val units = buildDisplayUnits(steps)
            var state: LiveRowsState? = null
            var baselineD = sc.baselineD
            val results = sc.inputs.map { input ->
                if (input.reset == true) {
                    state = null
                    input.baselineD?.let { baselineD = it }
                }
                val out = guideLiveRows(state, units, input.d, baselineD, phaseFrom(input.phase), sc.turnApproachM ?: walkTurnApproachMeters)
                state = out.state
                renderTop(out.top, ko.guide, car) to renderNext(out.next, ko.guide, car)
            }
            for (ex in sc.expect) {
                assertEquals(ex.top, results[ex.afterInput].first, "${sc.name} #${ex.afterInput} top")
                assertEquals(ex.next, results[ex.afterInput].second, "${sc.name} #${ex.afterInput} next")
            }
        }
    }

    // ── 횡단 유닛 판정(언어 무관) — 서버 플래그로(A26), ko "건너" 부분 문자열에 의존하지 않는다 ──

    @Test fun `행동이 crosswalk·underpass이고 서버가 crossing을 표시했을 때만 참`() {
        assertTrue(isCrossingStep(WalkAction.crosswalk, crossing = true))
        assertTrue(isCrossingStep(WalkAction.underpass, crossing = true))
        assertFalse(isCrossingStep(WalkAction.left, crossing = true))
        assertFalse(isCrossingStep(WalkAction.crosswalk, crossing = false))
        assertFalse(isCrossingStep(null, crossing = true))
    }

    @Test fun `en 문장도 플래그만 있으면 횡단 유닛이 된다`() {
        val steps = listOf(
            LiveStepInput("Walk 50m", 0.0, 50.0),
            LiveStepInput("Cross the crosswalk, then walk 30m", 50.0, 80.0, action = WalkAction.crosswalk, crossing = true),
            LiveStepInput("Turn left, then walk 40m", 80.0, 120.0, action = WalkAction.left),
        )
        val units = buildDisplayUnits(steps)
        assertEquals(listOf(false, true, false), units.map { it.crossing })
        assertEquals("Cross the crosswalk, then walk 30m", units[1].crossingText)
        assertEquals(WalkAction.crosswalk, units[0].endAction)
    }

    @Test fun `플래그 없는 crosswalk 행동은 횡단 유닛이 아니다`() {
        val steps = listOf(LiveStepInput("천호역 횡단보도까지 100m 이동", 0.0, 100.0, action = WalkAction.crosswalk))
        assertFalse(buildDisplayUnits(steps)[0].crossing)
    }

    @Test fun `liveStepsFrom은 응답 스텝의 crossing을 표시 입력으로 옮긴다`() {
        val route = checkNotNull(
            buildGuideRoute(
                listOf(
                    GuideStepGeometry("a", listOf(RoutePoint(37.5, 127.1), RoutePoint(37.5001, 127.1))),
                    GuideStepGeometry("b", listOf(RoutePoint(37.5001, 127.1), RoutePoint(37.5002, 127.1)), WalkAction.crosswalk),
                ),
            ),
        )
        val out = liveStepsFrom(route, listOf(LiveStepFields(null, null, false), LiveStepFields(null, null, true)))
        assertFalse(out[0].crossing)
        assertTrue(out[1].crossing)
        assertEquals(WalkAction.crosswalk, out[1].action)
    }
}

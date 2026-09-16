package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.fail

/** 안내 문장 descriptor 공유 fixture(E27 잔여 ①) — Kit `TransitGuideTextTests`·웹 `transit-guide-text.test.ts`와 같은 파일. */
class TransitGuideTextTest {
    @Serializable
    private data class TextFixture(val cases: List<Case>) {
        @Serializable
        data class Case(
            val name: String,
            val fn: String,
            val isEn: Boolean,
            val expect: TransitTextLine,
            val leg: TransitDisplayLeg? = null,
            val item: TransitDisplayItem? = null,
            val message: TransitLabel? = null,
            val arrivalCode: String? = null,
            val desc: TransitLabel? = null,
            val location: TransitLabel? = null,
            val station: TransitLabel? = null,
            val stop: TransitLabel? = null,
            val role: String? = null,
            val here: Boolean? = null,
            val isCurrentLeg: Boolean? = null,
            val express: String? = null,
            val exit: String? = null,
            val sentence: Boolean? = null,
            val departedMinutes: Int? = null,
            val minutes: Int? = null,
            val n: Int? = null,
            val line: TransitLabel? = null,
            val board: TransitLabel? = null,
            val alight: TransitLabel? = null,
            val remaining: Int? = null,
            val phase: String? = null,
        )
    }

    private val fixture by lazy { Fixtures.sharedJson("transit-guide-text-cases.json", TextFixture.serializer()) }

    private fun <T> need(value: T?, what: String, c: TextFixture.Case): T = value ?: fail("${c.name}: $what 없음")

    private fun expressOf(c: TextFixture.Case): TransitExpressVerdict? =
        c.express?.let { raw -> TransitExpressVerdict.entries.firstOrNull { it.name == raw } ?: fail("${c.name}: 미지 express $raw") }

    private fun run(c: TextFixture.Case): TransitTextLine {
        val e = c.isEn
        return when (c.fn) {
            "waitContext" -> transitWaitContextLine(e, need(c.leg, "leg", c), need(c.isCurrentLeg, "isCurrentLeg", c))
            "boardingContext" -> transitBoardingContextLine(e, need(c.leg, "leg", c))
            "context" -> transitContextLine(e, need(c.leg, "leg", c))
            "approachFrame" -> transitApproachFrameLine(e, need(c.leg, "leg", c), need(c.message, "message", c))
            "arrivalStatus" -> transitArrivalStatusLine(
                e, need(c.leg, "leg", c), c.message, c.arrivalCode, c.remaining,
                TransitStatusPhase.fromRawValue(need(c.phase, "phase", c)) ?: fail("${c.name}: 미지 phase ${c.phase}"),
            )
            "vehicleSelected" -> transitVehicleSelectedLine(e, need(c.leg, "leg", c), c.desc)
            "selectedVehicle" -> transitSelectedVehicleLine(e, need(c.desc, "desc", c))
            "vehiclePassed" -> transitVehiclePassedLine(e, need(c.leg, "leg", c))
            "arrivedAtBoardStop" -> transitArrivedAtBoardStopLine(e, need(c.leg, "leg", c))
            "arrivingAtBoardStop" -> transitArrivingAtBoardStopLine(e, need(c.leg, "leg", c))
            "boarded" -> transitBoardedLine(e)
            "boardedAlight" -> transitBoardedAlightLine(e, need(c.leg, "leg", c))
            "currentStation" -> transitCurrentStationLine(e, need(c.location, "location", c))
            "candidateDesc" -> transitCandidateDescLine(e, need(c.leg, "leg", c), need(c.item, "item", c), expressOf(c), c.departedMinutes)
            "vehicleDesc" -> transitVehicleDescLine(e, need(c.item, "item", c))
            "terminatesEarly" -> transitTerminatesEarlyLine(e, need(c.leg, "leg", c), need(c.item, "item", c))
            "expressSkipsAlight" -> transitExpressSkipsAlightLine(e, need(c.leg, "leg", c))
            "expressStatus" -> transitExpressStatusLine(e, need(c.leg, "leg", c), expressOf(c))
            "exitBound" -> transitExitBoundLine(e, need(c.exit, "exit", c), c.sentence ?: false)
            "viaStop" -> transitViaStopLine(e, need(c.stop, "stop", c), need(c.role, "role", c), need(c.here, "here", c), c.exit)
            "overviewLeg" -> transitOverviewLegLine(e, need(c.n, "n", c), need(c.line, "line", c), need(c.board, "board", c), need(c.alight, "alight", c))
            "prewalkStart" -> transitPrewalkStartLine(e, need(c.station, "station", c), need(c.minutes, "minutes", c))
            "prewalkArrived" -> transitPrewalkArrivedLine(e, need(c.station, "station", c))
            "prewalkArrivedButton" -> transitPrewalkArrivedButtonLine(e, need(c.station, "station", c))
            "openStation" -> transitOpenStationLine(e, need(c.station, "station", c))
            else -> fail("미지 fn: ${c.fn}")
        }
    }

    @Test fun `공유 fixture 동조`() {
        // ⚠ 케이스 0건이면 아래 루프가 공허하게 통과한다(경로 오타가 "합격"으로 위장) — 수를 먼저 본다.
        assertTrue(fixture.cases.size > 20)
        for (c in fixture.cases) assertEquals(c.expect, run(c), c.name)
    }

    /** 발화 sentinel 불변식(E27 spec §3.7) — en 케이스의 어떤 조각에도 조인 토큰이 나오면 안 된다. */
    @Test fun `en 줄은 조인 sentinel을 흘리지 않는다`() {
        val enCases = fixture.cases.filter { it.isEn && it.expect.lang == "en" }
        assertTrue(enCases.size > 10)
        for (c in enCases) {
            for (part in run(c).parts) {
                val text = (part.text ?: "") + (part.args ?: emptyList()).joinToString(" ")
                assertFalse(text.contains("ᛥ"), c.name)
            }
        }
    }
}

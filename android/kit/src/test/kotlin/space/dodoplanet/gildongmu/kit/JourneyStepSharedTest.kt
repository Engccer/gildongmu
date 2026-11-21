package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import space.dodoplanet.gildongmu.kit.models.*
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * E70 여정 전이 표 공유 fixture(웹 `src/lib/journey/journey-step.ts` 미러, E70-f spec 2026-11-02 §7.2). Kit `JourneyStepSharedTests` 미러.
 * 웹 vitest `journey-step.test.ts`와 같은 파일을 읽는다 — 표가 갈리면 같은 여정이 iOS·안드로이드와 웹에서 다른 단계로 간다.
 */
class JourneyStepSharedTest {
    @Serializable
    private data class StepFile(val starts: List<Start>, val cases: List<Case>) {
        @Serializable
        data class Shape(val startsWithTaxi: Boolean, val alightDesignated: Boolean, val hasEgressWalk: Boolean) {
            val kit: JourneyShape get() = JourneyShape(startsWithTaxi, alightDesignated, hasEgressWalk)
        }

        @Serializable
        data class Phase(val kind: String, val stage: String)

        @Serializable
        data class Event(val kind: String, val reason: String? = null, val stage: String? = null)

        @Serializable
        data class Start(val shape: Shape, val expect: Phase)

        /** `expect`는 "ignore"·"end" 문자열 또는 다음 phase 객체. */
        @Serializable
        data class Case(val shape: Shape, val phase: Phase, val event: Event, val expect: JsonElement)
    }

    private fun stage(s: String): JourneyStage = JourneyStage.fromRawValue(s) ?: fail("모르는 단계 $s")

    private fun phase(p: StepFile.Phase): JourneyPhase = when (p.kind) {
        "running" -> JourneyPhase.Running(stage(p.stage))
        "transitioning" -> JourneyPhase.Transitioning(stage(p.stage))
        else -> JourneyPhase.Failed(stage(p.stage))
    }

    private fun event(e: StepFile.Event): JourneyEvent = when (e.kind) {
        "stageEnded" -> when (e.reason) {
            "arrived" -> JourneyEvent.StageEnded(JourneyStageEnd.arrived)
            "userStopped" -> JourneyEvent.StageEnded(JourneyStageEnd.userStopped)
            "startFailed" -> JourneyEvent.StageEnded(JourneyStageEnd.startFailed)
            else -> JourneyEvent.StageEnded(JourneyStageEnd.ended)
        }
        "taxiDropped" -> JourneyEvent.TaxiDropped
        "taxiBoarded" -> JourneyEvent.TaxiBoarded
        "rideCompleted" -> JourneyEvent.RideCompleted
        "transitStopped" -> JourneyEvent.TransitStopped
        "prepared" -> JourneyEvent.Prepared(stage(e.stage ?: ""))
        "prepFailed" -> JourneyEvent.PrepFailed
        "retry" -> JourneyEvent.Retry
        "userEnded" -> JourneyEvent.UserEnded
        else -> JourneyEvent.StaleTimeout
    }

    private val file by lazy { Fixtures.sharedJson("journey-step-cases.json", StepFile.serializer()) }

    private fun phaseOf(el: JsonElement): StepFile.Phase = KitJson.decodeFromJsonElement(StepFile.Phase.serializer(), el)

    @Test fun journeyStepSharedStarts() {
        for (s in file.starts) {
            assertEquals(phase(s.expect), JourneyState.start(UUID.randomUUID(), s.shape.kit).phase)
        }
    }

    @Test fun journeyStepSharedTable() {
        assertTrue(file.cases.size > 250)
        val id = UUID.randomUUID()
        for (c in file.cases) {
            val state = JourneyState(id, c.shape.kit, phase(c.phase), seq = 3)
            val result = journeyStep(state, event(c.event), JourneyToken(id, 3))
            val note = "${c.phase.kind}.${c.phase.stage} + ${c.event.kind}${c.event.reason?.let { "($it)" } ?: ""}${c.event.stage?.let { "($it)" } ?: ""}"
            val expect = c.expect
            val word = (expect as? JsonPrimitive)?.takeIf { it.isString }?.content
            when {
                word == "ignore" -> assertEquals(JourneyStepResult.Ignore, result, note)
                word == "end" -> assertEquals(JourneyStepResult.End, result, note)
                word == null && result is JourneyStepResult.Next -> {
                    assertEquals(phase(phaseOf(expect)), result.state.phase, note)
                    assertEquals(4, result.state.seq, note)
                }
                else -> fail(note)
            }
        }
    }
}

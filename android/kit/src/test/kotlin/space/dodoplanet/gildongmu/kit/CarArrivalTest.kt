package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** 자동차 도착 판정 공유 표 — Kit `CarArrivalTests` 미러 + FOUNDATION 유예 테스트 하나. */
class CarArrivalTest {
    @Serializable
    private data class CaseFile(val cases: List<Case>) {
        @Serializable
        data class Case(val distance: Double, val accuracy: Double, val motion: String, val expect: Boolean, val note: String)
    }

    /** 미지 문자열은 기본값으로 접지 않고 실패한다 — fixture 개명·오타가 조용히 통과하면 드리프트 가드가 아니다. */
    private fun motionFrom(s: String) = MotionState.entries.firstOrNull { it.name == s } ?: fail("미지 motion $s")

    @Test fun `공유 표 동조`() {
        val cases = Fixtures.sharedJson("car-arrival-cases.json", CaseFile.serializer()).cases
        assertTrue(cases.size >= 6)
        for (c in cases) assertEquals(c.expect, carArrivalStep(c.distance, c.accuracy, motionFrom(c.motion)), c.note)
    }

    /** Kit `FinalApproachTests.briefArrivalWindowAccuracyCeilingMatchesCar`(FOUNDATION 유예분). */
    @Test fun `간략 창 정확도 상한은 자동차 도착 정확도 상한과 같은 값이다`() {
        assertEquals(briefArrivalWindowMaxAccuracyMeters, carArrivalMaxAccuracyMeters)
    }
}

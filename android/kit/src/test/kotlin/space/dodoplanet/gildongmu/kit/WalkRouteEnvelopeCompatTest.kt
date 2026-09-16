package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.StepFreeStatus
import space.dodoplanet.gildongmu.kit.models.WalkRouteEnvelope
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** `shortest` additive 필드의 하위 호환 계약 — 응답 6종이 같은 envelope 타입으로 전부 디코딩된다. */
class WalkRouteEnvelopeCompatTest {
    private fun decode(json: String) = KitJson.decodeFromString(WalkRouteEnvelope.serializer(), json)

    @Test fun `기본 응답 shortest 부재`() {
        val e = decode("""{"result":{"distanceMeters":880,"durationSeconds":780,"steps":[{"description":"직진"}]}}""")
        assertNotNull(e.result); assertNull(e.shortest)
    }

    @Test fun `shortest 객체`() {
        val e = decode("""{"result":{"distanceMeters":880,"durationSeconds":780,"steps":[{"description":"직진"}]},"shortest":{"distanceMeters":715,"durationSeconds":660,"steps":[{"description":"직진"}]}}""")
        assertEquals(880, e.result?.distanceMeters); assertEquals(715, e.shortest?.distanceMeters)
    }

    @Test fun `shortest null은 부재와 동일하게 null`() {
        val e = decode("""{"result":{"distanceMeters":880,"durationSeconds":780,"steps":[{"description":"직진"}]},"shortest":null}""")
        assertNotNull(e.result); assertNull(e.shortest)
    }

    @Test fun `result null 경로없음`() {
        val e = decode("""{"result":null}""")
        assertNull(e.result); assertNull(e.shortest)
    }

    @Test fun `미지 필드 무시`() {
        assertNotNull(decode("""{"result":{"distanceMeters":880,"durationSeconds":780,"steps":[{"description":"직진"}]},"unknownFutureField":1}""").result)
    }

    @Test fun `stepFreeNotice 최단 전용 문장`() {
        val e = decode("""{"result":{"distanceMeters":715,"durationSeconds":660,"steps":[{"description":"직진"}],"stepFree":"unavailable","stepFreeNotice":"최단 경로에는 계단 회피가 적용되지 않습니다. 계단이 포함될 수 있습니다."}}""")
        assertEquals(StepFreeStatus.unavailable, e.result?.stepFreeStatus)
        assertTrue(e.result?.stepFreeNotice?.contains("최단") == true)
    }
}

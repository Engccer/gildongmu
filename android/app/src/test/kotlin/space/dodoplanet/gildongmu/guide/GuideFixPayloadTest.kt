package space.dodoplanet.gildongmu.guide

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** spec §4-2 — 없는 축은 null(속도)·-1(정확도·방위)이고 0.0으로 접지 않는다(:kit `motionStep`·`courseStep` 계약). */
class GuideFixPayloadTest {
    @Test fun `없는 축은 null 또는 -1로 넘긴다`() {
        val p = guideFixPayload(
            37.5, 127.1,
            hasAccuracy = false, accuracy = 0f, hasSpeed = false, speed = 0f, hasSpeedAccuracy = false, speedAccuracy = 0f,
            hasBearing = false, bearing = 0f, hasBearingAccuracy = false, bearingAccuracy = 0f, elapsedRealtimeNanos = 5_000_000_000L,
        )
        assertEquals(-1.0, p.accuracy)
        assertNull(p.speed)
        assertNull(p.speedAccuracy)
        assertEquals(-1.0, p.course)
        assertEquals(-1.0, p.courseAccuracy)
        assertEquals(5_000L, p.elapsedRealtimeMs)
    }

    @Test fun `있는 축은 값 그대로`() {
        val p = guideFixPayload(37.5, 127.1, true, 12f, true, 1.3f, true, 0.4f, true, 90f, true, 20f, 1_500_000L)
        assertEquals(12.0, p.accuracy)
        assertEquals(1.3, p.speed!!, 1e-6)
        assertEquals(0.4, p.speedAccuracy!!, 1e-6)
        assertEquals(90.0, p.course)
        assertEquals(20.0, p.courseAccuracy)
        assertEquals(1L, p.elapsedRealtimeMs) // 정수 나눗셈(AndroidLocationSource와 같은 표기)
    }
}

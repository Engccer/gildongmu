package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals

/** 듣기 속도 설정 정규화 — Kit `ListenSpeedTests`의 normalizeSpeed 절 미러(speechRate 절은 iOS rate 축이라 미이식). */
class ListenSpeedTest {
    @Test fun `허용값은 그대로 통과`() {
        assertEquals(1.0, ListenSpeed.normalizeSpeed(1.0))
        assertEquals(1.5, ListenSpeed.normalizeSpeed(1.5))
        assertEquals(2.0, ListenSpeed.normalizeSpeed(2.0))
    }

    @Test fun `미설정과 이상값은 1로 정규화`() {
        for (v in listOf(null, 0.0, 3.0, 1.25, -1.0)) assertEquals(1.0, ListenSpeed.normalizeSpeed(v), "$v")
    }
}

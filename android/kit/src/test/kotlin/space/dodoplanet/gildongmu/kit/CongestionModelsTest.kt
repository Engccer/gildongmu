package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.CongestionLevelKey
import space.dodoplanet.gildongmu.kit.models.CongestionNearbyResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 실시간 인구 혼잡도 계약 테스트. Kit Fixtures/congestion-nearby.json은 실호출 캡처(강남역). */
class CongestionModelsTest {
    @Test fun congestionNearbyFixtureDecodes() {
        val area = assertNotNull(Fixtures.kitJson("congestion-nearby.json", CongestionNearbyResponse.serializer()).area)
        assertEquals("POI014", area.code)
        assertEquals("강남역", area.name)
        assertEquals(CongestionLevelKey.busy, CongestionLevelKey.fromLevelText(area.level))
        assertTrue(area.message.isNotEmpty())
        assertEquals("2026-08-01 14:00", area.asOf)
    }

    /** 서울 핫스팟 밖은 오류가 아니라 정상 응답의 null이다(3-state 붕괴 금지). */
    @Test fun congestionAreaNullDecodesToNull() {
        assertNull(KitJson.decodeFromString(CongestionNearbyResponse.serializer(), """{"area":null}""").area)
    }

    @Test fun congestionLevelKeyMapsFourGrades() {
        assertEquals(CongestionLevelKey.relaxed, CongestionLevelKey.fromLevelText("여유"))
        assertEquals(CongestionLevelKey.normal, CongestionLevelKey.fromLevelText("보통"))
        assertEquals(CongestionLevelKey.slightlyBusy, CongestionLevelKey.fromLevelText("약간 붐빔"))
        assertEquals(CongestionLevelKey.busy, CongestionLevelKey.fromLevelText("붐빔"))
        assertEquals(CongestionLevelKey.busy, CongestionLevelKey.fromLevelText(" 붐빔 "))
    }

    @Test fun congestionLevelKeyIsNullForUnknownGrade() {
        assertNull(CongestionLevelKey.fromLevelText("매우 붐빔"))
        assertNull(CongestionLevelKey.fromLevelText(""))
    }
}

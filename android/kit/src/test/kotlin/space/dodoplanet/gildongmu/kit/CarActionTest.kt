package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.models.CarRouteGuide
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 웹 `car-action.test.ts`·Kit `CarActionTests`와 같은 공유 fixture(`car-action-cases.json`) — 코드 표 드리프트 가드. */
class CarActionTest {
    @Serializable
    private data class CaseFile(val cases: List<Case>) {
        @Serializable
        data class Case(val turnType: Int, val action: String? = null)
    }

    @Test fun carActionSharedTable() {
        val cases = Fixtures.sharedJson("car-action-cases.json", CaseFile.serializer()).cases
        assertTrue(cases.size >= 40)
        for (c in cases) assertEquals(c.action, carActionFromTurnType(c.turnType)?.rawValue, "turnType ${c.turnType}")
    }

    /** 서버 응답의 미지 `action` 값은 디코딩 실패가 아니라 null이다(구버전 앱이 상세 전체를 잃지 않게). */
    @Test fun unknownActionDecodesToNull() {
        val json = """{"name":"","guidance":"교차로에서 우회전 후 100m 이동","distanceMeters":0,"durationSeconds":0,"action":"hyperspace"}"""
        assertNull(KitJson.decodeFromString(CarRouteGuide.serializer(), json).action)
        val known = """{"name":"","guidance":"x","distanceMeters":0,"durationSeconds":0,"action":"keepRight"}"""
        assertEquals(CarAction.keepRight, KitJson.decodeFromString(CarRouteGuide.serializer(), known).action)
    }

    @Test fun guideActionMapsOneToOne() {
        assertEquals(WalkAction.keepLeft, CarAction.keepLeft.guideAction)
        assertEquals(WalkAction.back, CarAction.back.guideAction)
    }
}

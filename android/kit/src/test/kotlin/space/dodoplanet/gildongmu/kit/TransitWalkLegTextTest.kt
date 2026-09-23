package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * 도보 구간 문구 키·인자 순서(D8, Kit `TransitWalkLegTextTests` 미러). 잠그는 것은 "어떤 조합이 어떤 키가
 * 되고 인자가 어느 순서로 가는가"뿐 — 문구 자체는 앱 카탈로그가 정본이다.
 */
class TransitWalkLegTextTest {
    @Test fun both() {
        val r = TransitWalkLegText.resolve(name = "천호역", distance = "350m", minutes = 5)
        assertEquals("route.transit.legWalkTo", r.key)
        assertEquals(listOf("천호역", "5", "350m"), r.args)
    }

    @Test fun nameOnly() {
        val r = TransitWalkLegText.resolve(name = "천호역", distance = null, minutes = 5)
        assertEquals("route.transit.legWalkToNoDistance", r.key)
        assertEquals(listOf("천호역", "5"), r.args)
    }

    @Test fun distanceOnly() {
        val r = TransitWalkLegText.resolve(name = null, distance = "1.2km", minutes = 15)
        assertEquals("route.transit.legWalkToDest", r.key)
        assertEquals(listOf("15", "1.2km"), r.args)
    }

    @Test fun neither() {
        val r = TransitWalkLegText.resolve(name = null, distance = null, minutes = 3)
        assertEquals("route.transit.legWalkToDestNoDistance", r.key)
        assertEquals(listOf("3"), r.args)
    }

    @Test fun emptyNameIsNil() {
        assertEquals("route.transit.legWalkToDestNoDistance", TransitWalkLegText.resolve(name = "", distance = null, minutes = 3).key)
    }

    // 승차 출구(E25) — 다음 구간의 승차 출구를 이 줄이 싣는다

    @Test fun nameExitDistance() {
        val r = TransitWalkLegText.resolve(name = "개화", distance = "131m", minutes = 2, boardExit = "1")
        assertEquals("route.transit.legWalkToExit", r.key)
        assertEquals(listOf("개화", "1", "2", "131m"), r.args)
    }

    @Test fun nameExitNoDistance() {
        val r = TransitWalkLegText.resolve(name = "개화", distance = null, minutes = 2, boardExit = "1")
        assertEquals("route.transit.legWalkToExitNoDistance", r.key)
        assertEquals(listOf("개화", "1", "2"), r.args)
    }

    /** 이름이 없으면 출구가 있어도 목적지 문구다(붙일 자리가 없다). */
    @Test fun exitWithoutNameFallsBack() {
        val r = TransitWalkLegText.resolve(name = null, distance = "131m", minutes = 2, boardExit = "1")
        assertEquals("route.transit.legWalkToDest", r.key)
        assertEquals(listOf("2", "131m"), r.args)
    }

    @Test fun noExitKeepsLegacyKeys() {
        assertEquals("route.transit.legWalkTo", TransitWalkLegText.resolve(name = "개화", distance = "131m", minutes = 2, boardExit = null).key)
        assertEquals("route.transit.legWalkTo", TransitWalkLegText.resolve(name = "개화", distance = "131m", minutes = 2, boardExit = "").key)
    }

    // 빈 이름은 정보 부재(iOS 2026-09-19) — 행선지 없는 문구로 떨어지고, 정상 이름은 공백까지 원문을 보존한다.
    @Test fun blankNameIsAbsent() {
        for (name in listOf(" ", "\t\n\r", "\u00A0\u200B\u3000")) {
            val noDistance = TransitWalkLegText.resolve(name = name, distance = null, minutes = 3, boardExit = "1")
            assertEquals("route.transit.legWalkToDestNoDistance", noDistance.key)
            assertEquals(listOf("3"), noDistance.args)
            val withDistance = TransitWalkLegText.resolve(name = name, distance = "131m", minutes = 2, boardExit = "1")
            assertEquals("route.transit.legWalkToDest", withDistance.key)
            assertEquals(listOf("2", "131m"), withDistance.args)
        }
    }

    @Test fun normalNameIsPreserved() {
        val name = "  천호(풍납토성) 역  "
        assertEquals(listOf(name, "3"), TransitWalkLegText.resolve(name = name, distance = null, minutes = 3).args)
    }
}

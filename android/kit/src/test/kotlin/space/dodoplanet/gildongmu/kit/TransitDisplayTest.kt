package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals

/** `TransitDisplay.pickLine` 원자성 — Kit `RouteModelsTests.transitDisplayPickLineIsAtomic`(foundation.json 유예분) 미러. */
class TransitDisplayTest {
    private val join: (List<String>) -> String = { it.joinToString(", ") }

    @Test fun transitDisplayPickLineIsAtomic() {
        assertEquals("Gangnam, Line 2", TransitDisplay.pickLine(isEn = true, ko = "강남, 2호선", enParts = listOf("Gangnam", "Line 2"), build = join))
        assertEquals("강남, 2호선", TransitDisplay.pickLine(isEn = true, ko = "강남, 2호선", enParts = listOf("Gangnam", null), build = join))
        assertEquals("강남, 2호선", TransitDisplay.pickLine(isEn = false, ko = "강남, 2호선", enParts = listOf("Gangnam", "Line 2"), build = join))
    }

    /** 빈 문자열은 부재가 아니라 자리 표시다(Kit 관례: null=결측·""=자리 표시). */
    @Test fun emptyStringIsPlaceholderNotAbsence() {
        assertEquals("Gangnam, ", TransitDisplay.pickLine(isEn = true, ko = "강남", enParts = listOf("Gangnam", ""), build = join))
    }
}

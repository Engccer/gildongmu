package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * 대안 경로 표시 이름 키 매핑(spec §4.1, 웹 `transit-alternative-name.ts` ↔ Kit `TransitAlternativeNameTests` 미러).
 * 판정은 전부 서버가 끝냈고 이 계층은 축·표시 번호를 키로 옮기기만 한다.
 */
class TransitAlternativeNameTest {
    @Test fun bothAxes() {
        assertEquals("route.transit.alternativeFastestFewestTransfers", TransitAlternativeName.key(listOf("fewestTransfers", "fastest"), null).key)
    }

    @Test fun axisOrderIndependent() {
        assertEquals("route.transit.alternativeFastestFewestTransfers", TransitAlternativeName.key(listOf("fastest", "fewestTransfers"), null).key)
    }

    @Test fun fewest() {
        assertEquals("route.transit.alternativeFewestTransfers", TransitAlternativeName.key(listOf("fewestTransfers"), null).key)
    }

    @Test fun fastest() {
        assertEquals("route.transit.alternativeFastest", TransitAlternativeName.key(listOf("fastest"), null).key)
    }

    @Test fun axisHasNoIndex() {
        assertNull(TransitAlternativeName.key(listOf("fastest"), 3).index)
    }

    @Test fun numbered() {
        val r = TransitAlternativeName.key(null, 2)
        assertEquals("route.transit.alternativeHeading", r.key)
        assertEquals(2, r.index)
    }

    @Test fun emptyHighlight() {
        assertEquals("route.transit.alternativeHeading", TransitAlternativeName.key(emptyList(), 1).key)
    }

    /** 서버가 축도 번호도 안 준 응답(계약 위반)에서도 번호 없는 문구가 낭독되지 않도록 1로 떨어진다. */
    @Test fun missingIndexFallsBackToOne() {
        assertEquals(1, TransitAlternativeName.key(null, null).index)
    }

    /** 서버가 축을 늘려도 구버전 앱이 그 값을 이름으로 쓰지 않고 번호로 떨어진다. */
    @Test fun unknownAxisIgnored() {
        val r = TransitAlternativeName.key(listOf("leastWalk"), 2)
        assertEquals("route.transit.alternativeHeading", r.key)
        assertEquals(2, r.index)
    }
}

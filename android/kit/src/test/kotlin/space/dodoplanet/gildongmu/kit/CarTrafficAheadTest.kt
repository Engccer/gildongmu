package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.models.CarJam
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 웹 `car-traffic-ahead.test.ts`·Kit `CarTrafficAheadTests`와 같은 공유 fixture(`car-jams-ahead-cases.json`)로 같은 판정표를 단언한다(E80 §5). */
class CarTrafficAheadTest {
    @Serializable private data class Poly(val points: List<RoutePoint>, val cum: List<Double>)
    @Serializable private data class Expect(val nearest: Int? = null, val aheadMeters: Int? = null, val knownCount: Int)
    @Serializable private data class Case(val name: String, val d: Double, val known: List<KnownCarJam>, val fresh: List<CarJam>, val expect: Expect)
    @Serializable private data class Fixture(val polyline: Poly, val totalMeters: Double, val cases: List<Case>)

    private val f = Fixtures.sharedJson("car-jams-ahead-cases.json", Fixture.serializer())
    private val poly = GuidePolyline(f.polyline.points, f.polyline.cum)

    @Test fun `새 정체 판정 공유 fixture 동조`() {
        assertTrue(f.cases.isNotEmpty())
        for (c in f.cases) {
            val out = newCarJamsAhead(poly, f.totalMeters, c.d, c.known, c.fresh)
            val i = c.expect.nearest
            if (i != null) {
                assertEquals(c.fresh[i], out.nearest?.jam, c.name)
                assertEquals(c.expect.aheadMeters, out.nearest?.aheadMeters, c.name)
            } else {
                assertNull(out.nearest, c.name)
            }
            assertEquals(c.expect.knownCount, out.known.size, c.name)
        }
    }

    @Test fun `같은 응답을 두 번 받으면 두 번째는 알리지 않는다`() {
        val fresh = f.cases[0].fresh
        val first = newCarJamsAhead(poly, f.totalMeters, 500.0, emptyList(), fresh)
        val second = newCarJamsAhead(poly, f.totalMeters, 900.0, first.known, fresh)
        assertNotNull(first.nearest)
        assertNull(second.nearest)
    }
}

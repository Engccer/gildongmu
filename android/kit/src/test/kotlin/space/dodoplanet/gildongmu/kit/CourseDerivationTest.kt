package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 유도기 산술 동조: 웹 정본과 같은 공유 fixture(`course-axis-scenarios.json`)의 `derivation` 배열을 재생해 마지막으로
 * 방출된 관측을 같은 허용오차로 단언한다 — Kit `CourseDerivationTests` 미러.
 */
class CourseDerivationTest {
    @Serializable
    private data class Scenarios(val derivation: List<Case>) {
        @Serializable
        data class Case(val name: String, val fixes: List<Fix>, val expect: Expect? = null)

        @Serializable
        data class Fix(val lat: Double, val lng: Double, val at: Double)

        @Serializable
        data class Expect(val bearingMin: Double, val bearingMax: Double, val uMin: Double, val uMax: Double)
    }

    @Test fun `공유 fixture derivation — 웹과 같은 관측`() {
        val cases = Fixtures.sharedJson("course-axis-scenarios.json", Scenarios.serializer()).derivation
        // ⚠ 공회전 방지: 배열이 비면 루프가 0회 돌고 조용히 통과한다.
        assertTrue(cases.size >= 3)
        for (c in cases) {
            var state = initialDerivationState
            var last: DerivedCourse? = null
            for (f in c.fixes) {
                val r = deriveCourse(state, f.lat, f.lng, f.at)
                state = r.state
                if (r.obs != null) last = r.obs
            }
            val expect = c.expect
            if (expect == null) {
                assertNull(last, "${c.name}: 관측이 없어야 한다")
                continue
            }
            val got = assertNotNull(last, "${c.name}: 관측이 있어야 한다")
            val norm = (got.bearing + 540) % 360 - 180
            assertTrue(norm >= expect.bearingMin && norm <= expect.bearingMax, "${c.name}: bearing $norm")
            assertTrue(got.uncertaintyDeg >= expect.uMin && got.uncertaintyDeg <= expect.uMax, "${c.name}: U ${got.uncertaintyDeg}")
        }
    }

    // 이하 3건은 웹 course-derivation.test.ts 단위 케이스의 미러(fixture 밖 계약).
    private val mLat = 1.0 / 111_320.0
    private val baseLat = 37.5365
    private val baseLng = 127.1469

    private fun northFix(n: Double) = Pair(baseLat + n * mLat, baseLng)

    @Test fun `전진 게이트 — 직전 방출 지점에서 2m 미만이면 표를 내지 않는다`() {
        var state = initialDerivationState
        val results = mutableListOf<DerivedCourse?>()
        for (i in 0..12) {
            val (lat, lng) = northFix(i.toDouble())
            val r = deriveCourse(state, lat, lng, i.toDouble())
            state = r.state
            results.add(r.obs)
        }
        for ((n, at) in listOf(12.5 to 13.0, 14.5 to 14.0)) {
            val (lat, lng) = northFix(n)
            val r = deriveCourse(state, lat, lng, at)
            state = r.state
            results.add(r.obs)
        }
        assertNotNull(results[11]) // 첫 방출(chord ≈ 11m ≥ 기저선)
        assertNull(results[12]) // 1m 전진 — 게이트
        assertNull(results[13]) // 1.5m 전진 — 게이트
        assertNotNull(results[14]) // 3.5m 전진 — 통과
    }

    @Test fun `기저선이 age 상한을 넘으면 관측·버퍼가 함께 사라진다`() {
        var state = initialDerivationState
        for (i in 0..12) {
            val (lat, lng) = northFix(i.toDouble())
            state = deriveCourse(state, lat, lng, i.toDouble()).state
        }
        val (lat, lng) = northFix(12.0)
        val r = deriveCourse(state, lat, lng, 50.0) // 38초 정지
        assertNull(r.obs)
        assertEquals(1, r.state.fixes.size)
    }

    @Test fun `같은 timestamp 중복 fix는 교체한다`() {
        var state = initialDerivationState
        for ((n, at) in listOf(0.0 to 0.0, 1.0 to 1.0, 1.2 to 1.0)) {
            val (lat, lng) = northFix(n)
            state = deriveCourse(state, lat, lng, at).state
        }
        assertEquals(2, state.fixes.size)
    }
}

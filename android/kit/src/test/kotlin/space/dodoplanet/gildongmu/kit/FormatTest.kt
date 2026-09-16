package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * 거리 표기 계약. 표는 웹 `src/lib/__tests__/format.test.ts`의 `DISTANCE_CASES`·Kit `FormatTests`의
 * `distanceCases`와 **같아야 하고**, 웹 드리프트 가드(`android-kit-drift.test.ts`)가 이 파일을 읽어 대조한다.
 * ⚠ 아래 `distanceCases` 리터럴의 모양(`(입력 to "기대")`)을 바꾸면 그 가드가 표를 못 찾는다.
 */
private val distanceCases: List<Pair<Int, String>> = listOf(
    120 to "120m",
    999 to "999m",
    1000 to "1km",
    1049 to "1.049km",
    1050 to "1.05km",
    1187 to "1.187km",
    1999 to "1.999km",
    3640 to "3.64km",
    89700 to "89.7km",
    123456 to "123.456km",
)

class FormatDistanceTest {
    @Test
    fun `공유 표와 같다`() {
        for ((meters, expected) in distanceCases) assertEquals(expected, formatDistance(meters), "${meters}m")
    }

    @Test
    fun `후행 0을 남기지 않는다`() {
        assertEquals("1km", formatDistance(1000))
        assertEquals("2km", formatDistance(2000))
        assertEquals("1.1km", formatDistance(1100))
        assertEquals("10.6km", formatDistance(10600))
    }
}

class SpokenDistanceUnitsTest {
    private fun spoken(s: String) = spokenDistanceUnits(s, "미터")

    @Test
    fun `m만 풀고 km는 그대로`() {
        assertEquals("300 미터", spoken("300m"))
        assertEquals("10.6km", spoken("10.6km"))
        assertEquals("6.285km", spoken("6.285km"))
    }

    @Test
    fun `formatDistance 전 출력 모양에서 미터 약어가 남지 않는다`() {
        val re = Regex("""\dm(?![A-Za-z])""")
        for ((input, expected) in distanceCases) {
            val s = spoken(formatDistance(input))
            assertNull(re.find(s), "m 잔존: $expected → $s")
        }
    }

    @Test
    fun `오차 반경 표기도 함께 풀린다`() {
        assertEquals("목적지 근처 (약 ±30 미터)", spoken("목적지 근처 (약 ±30m)"))
    }

    @Test
    fun `일반 단어는 건드리지 않는다`() {
        assertEquals("횡단보도 이용", spoken("횡단보도 이용"))
        assertEquals("천호대로를 따라 이동", spoken("천호대로를 따라 이동"))
        assertEquals("markets", spoken("markets"))
        assertEquals("10kmh", spoken("10kmh"))
    }

    @Test
    fun `서버 완성 문장 속 거리도 풀린다`() {
        assertEquals("교차로에서 우회전 후 명일로를 따라 244 미터 이동", spoken("교차로에서 우회전 후 명일로를 따라 244m 이동"))
    }

    @Test
    fun `CJK 직결 꼴이 핵심 케이스다`() {
        assertEquals("약 35 미터입니다.", spoken("약 35m입니다."))
        assertEquals("약 5 미터에 있습니다", spoken("약 5m에 있습니다"))
        assertEquals("半径300 미터以内", spoken("半径300m以内"))
    }
}

package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * 방위 축 — 웹 정본과 같은 공유 fixture(`course-axis-scenarios.json`)의 `votes`·`verdicts`를 읽어 같은 경계표를
 * 단언한다(Kit `GuideCourseAxisTests` 미러). `reducer` 층은 리듀서와 함께 `RouteGuideTest`가 본다.
 */
class GuideCourseAxisTest {
    @Serializable
    private data class Scenarios(val votes: List<VoteCase>, val verdicts: List<VerdictCase>) {
        @Serializable
        data class VoteCase(val name: String, val bearing: Double? = null, val uncertainty: Double, val d: Double, val expect: String)

        /** fixture의 `["mismatch", 0]`은 문자열·숫자가 섞인 배열이라 원소를 JSON 그대로 받는다. */
        @Serializable
        data class VerdictCase(val name: String, val votes: List<JsonArray>, val expect: String)
    }

    /** 남 → 북 직선 200m (접선은 어디서나 0도). */
    private val straight = checkNotNull(
        buildGuideRoute(
            listOf(GuideStepGeometry("북진", listOf(RoutePoint(37.5, 127.1), RoutePoint(37.5 + 200 / 111_320.0, 127.1)))),
        ),
    )

    private fun scenarios() = Fixtures.sharedJson("course-axis-scenarios.json", Scenarios.serializer())

    @Test fun `공유 fixture 표결 — 웹과 같은 판정`() {
        val votes = scenarios().votes
        // ⚠ 공회전 방지: 키 이름이 바뀌거나 배열이 비면 루프가 0회 돌고 조용히 통과한다.
        assertTrue(votes.size >= 7)
        for (c in votes) {
            val obs = c.bearing?.let { DerivedCourse(it, c.uncertainty) }
            assertEquals(c.expect, courseVote(obs, straight.polyline, c.d).rawValue, c.name)
        }
    }

    @Test fun `공유 fixture 판정 — 웹과 같은 verdict`() {
        val verdicts = scenarios().verdicts
        assertTrue(verdicts.size >= 11)
        for (c in verdicts) {
            val samples = c.votes.map { pair ->
                // ⚠ 어긋난 쌍을 건너뛰지 않는다 — 건너뛰면 fixture가 망가져도 남은 케이스로 통과한다.
                val text = (pair.getOrNull(0) as? JsonPrimitive)?.takeIf { it.isString }?.content
                val at = (pair.getOrNull(1) as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
                val vote = text?.let(CourseVote::fromRawValue)
                if (vote == null || at == null) fail("${c.name}: fixture 표 형식이 어긋남 $pair")
                CourseVoteSample(at, vote)
            }
            assertEquals(c.expect, courseAxisVerdict(samples).rawValue, c.name)
        }
    }

    @Test fun `관측 없음은 unknown이다`() {
        assertEquals(CourseVote.unknown, courseVote(null, straight.polyline, 100.0))
    }
}

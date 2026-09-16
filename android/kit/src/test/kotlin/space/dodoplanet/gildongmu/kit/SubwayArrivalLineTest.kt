package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 지하철 도착 한 줄 — Kit `SubwayArrivalLineTests` 미러. 웹과 같은 공유 fixture 두 벌(A32 꼬리·E37 문장)을 소비한다. */
class SubwayArrivalLineTest {
    // A32 도착 한 줄의 현재역 꼬리 — `subway-arrival-tail-cases.json`

    @Serializable
    private data class TailFile(val cases: List<TailCase>) {
        @Serializable data class TailCase(val name: String, val message: String? = null, val currentLocation: String? = null, val expect: Boolean)
    }

    @Test fun currentLocationTailMatchesSharedFixture() {
        val cases = Fixtures.sharedJson("subway-arrival-tail-cases.json", TailFile.serializer()).cases
        assertTrue(cases.size >= 20)
        for (c in cases) {
            assertEquals(c.expect, subwayShowsCurrentLocationTail(c.message, c.currentLocation), "${c.name}: ${c.message} / ${c.currentLocation}")
        }
    }

    /** 실패 방향이 현행(붙이는 쪽)인지 — 미지 문법이 들어와도 정보가 사라지지 않는다. */
    @Test fun unknownGrammarKeepsTail() {
        assertTrue(subwayShowsCurrentLocationTail("우리가 모르는 새 문장", "강일"))
    }

    /** 문장이 현재역을 담으면 꼬리는 빠진다 — 같은 역이 한 접근성 객체에서 두 번 낭독되던 자리. */
    @Test fun containedStationDropsTail() {
        assertFalse(subwayShowsCurrentLocationTail("6분 후 (강일)", "강일"))
    }

    // E37 완성 문장 → 우리 문장 — `subway-arrival-prose-cases.json`

    @Serializable
    private data class ProseFile(val cases: List<ProseCase>) {
        @Serializable
        data class ProseCase(
            val name: String,
            val message: String? = null,
            val currentLocation: String? = null,
            val expect: ExpectedPlan? = null,
            val keys: ExpectedKeys? = null,
        )

        @Serializable
        data class ExpectedPlan(
            val kind: String,
            val verb: String? = null,
            val station: String? = null,
            val count: Int? = null,
            val minutes: Int? = null,
            val seconds: Int? = null,
            val stops: Int? = null,
            val nowAt: String? = null,
        )

        @Serializable
        data class ExpectedKeys(val joined: List<String>, val tail: String? = null)
    }

    private fun expected(e: ProseFile.ExpectedPlan): SubwayArrivalPlan? = when (e.kind) {
        "stationEvent" -> {
            val v = e.verb?.let(SubwayArrivalVerb::fromRawValue)
            if (v != null && e.station != null) SubwayArrivalPlan.StationEvent(v, e.station) else null
        }
        "prevStationEvent" -> {
            val v = e.verb?.let(SubwayArrivalVerb::fromRawValue)
            if (v != null && e.station != null) SubwayArrivalPlan.PrevStationEvent(v, e.station) else null
        }
        "departedStopsBack" -> e.count?.let { SubwayArrivalPlan.DepartedStopsBack(it) }
        "stopsAway" -> if (e.count != null && e.station != null) SubwayArrivalPlan.StopsAway(e.count, e.station) else null
        "eta" -> SubwayArrivalPlan.Eta(e.minutes, e.seconds, e.stops, e.nowAt)
        else -> null
    }

    @Test fun arrivalProseMatchesSharedFixture() {
        val cases = Fixtures.sharedJson("subway-arrival-prose-cases.json", ProseFile.serializer()).cases
        assertTrue(cases.size >= 40)
        for (c in cases) {
            val got = subwayArrivalProse(c.message, c.currentLocation)
            val want = c.expect?.let(::expected)
            // fixture 행의 모양이 어긋나면 `expected`가 null을 돌려주고 그 행이 조용히 "원문 경로여야 한다"는 판정으로
            // 바뀐다 — 작성 실수가 초록으로 흡수되지 않게 해독 자체를 단언한다.
            assertTrue(c.expect == null || want != null, "${c.name}: fixture expect 해독 실패")
            assertEquals(want, got, c.name)
            // 키 선택도 웹과 한 표다 — 같은 계획에서 서로 다른 문장을 고르면 플랫폼이 갈린다.
            val keys = c.keys
            if (got == null || keys == null) {
                assertTrue(keys == null || got != null, "${c.name}: 원문 경로인데 keys가 있다")
                continue
            }
            val segs = subwayArrivalProseSegments(got, subwayArrivalPlanStation(got))
            assertEquals(keys.joined, segs.joined.map { it.key }, "${c.name}: joined 키")
            assertEquals(keys.tail, segs.tail?.key, "${c.name}: tail 키")
        }
    }

    /** 위치를 신뢰할 수 없는 두 문법은 역명을 어디에도 싣지 않는다 — 실으면 없는 곳을 현재 위치로 낭독한다. */
    @Test fun untrustedLocationGrammarsCarryNoStation() {
        for ((message, location) in listOf("강일 전역출발" to "강일", "전전역 출발" to "미사")) {
            val plan = assertNotNull(subwayArrivalProse(message, location), message)
            assertNull(subwayArrivalPlanStation(plan), message)
            val segs = subwayArrivalProseSegments(plan, null)
            assertTrue(segs.joined.all { location !in it.args }, message)
            assertNull(segs.tail, message)
        }
    }

    /** `{무엇} 도착` 모양은 역명이 아닌 말도 통과시킨다 — 현재역 값과 같을 때만 당역 문법으로 읽는다. */
    @Test fun stationEventNeedsMatchingCurrentLocation() {
        assertNull(subwayArrivalProse("곧 도착", null))
        assertNull(subwayArrivalProse("곧 도착", "강일"))
        assertNotNull(subwayArrivalProse("서울 도착", "서울"))
    }

    /** 공백은 유니코드 뜻(웹 JS·Swift와 같다) — NBSP가 섞인 시간 문장도 인식한다. 숫자는 ASCII만(웹과 같다). */
    @Test fun unicodeWhitespaceButAsciiDigits() {
        assertEquals(SubwayArrivalPlan.Eta(3, null, null, "강일"), subwayArrivalProse("3분\u00A0후", "강일"))
        assertNull(subwayArrivalProse("３분 후", "강일"))
    }

    /**
     * 정규식 미러 함정의 직접 가드: 대괄호 형태 시간 문장이 인식돼야 한다(문자 클래스의 `[`를 이스케이프하지 않으면
     * Java는 패턴 전체를 다르게 읽어 시간형이 전량 원문 경로로 떨어진다). Kit 테스트 없음 — README §3 함정 보강.
     */
    @Test fun bracketEtaIsRecognized() {
        assertEquals(SubwayArrivalPlan.Eta(3, 48, 3, "천호"), subwayArrivalProse("3분48초후[3번째 전]", "천호"))
        assertEquals(SubwayArrivalPlan.Eta(4, null, null, "삼각지"), subwayArrivalProse("4분 후 (삼각지)", "삼각지"))
    }
}

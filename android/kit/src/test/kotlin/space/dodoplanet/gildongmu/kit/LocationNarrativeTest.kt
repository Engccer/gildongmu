package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.NearbyOverview
import space.dodoplanet.gildongmu.kit.models.NearbyOverviewResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * M4 "한눈에 보기" 결정론 문장 조립 계약 — Kit `NearbyOverviewTests.overview*`(foundation.json 유예분) 미러
 * (spec 2026-08-22-nearby-tab-restructure §3.1·§4·§6). 상태별 문장이 전부 달라야 한다(3-state 불변식:
 * 0건 ≠ 정보 없음 ≠ 실패, 키 없음은 불릿 부재). 디코딩 자체는 FOUNDATION `NearbyOverviewTest`가 덮는다.
 */
class LocationNarrativeTest {
    private val fixture = """
{"data":{"place":"서울특별시 강동구 길동, 천중로44길 74","radiusMeters":1000,"bullets":[
 {"kind":"transit","state":"ok","station":{"name":"길동","line":"5호선","bearing":"ne","distanceMeters":262},
  "busStops":{"state":"ok","count":5,"nearest":[{"name":"길동사거리","distanceMeters":80,"bearing":"e"},{"name":"길동역","distanceMeters":120,"bearing":"n"}]}},
 {"kind":"food","state":"ok","count":15,"countCapped":true,"nearest":[{"name":"봉래면옥","distanceMeters":40,"bearing":"s"},{"name":"김밥천국","distanceMeters":60,"bearing":"e"}]},
 {"kind":"cafe","state":"ok","count":3,"countCapped":false,"nearest":[{"name":"스타벅스","distanceMeters":90,"bearing":"w"},{"name":"카페 1971","distanceMeters":200,"bearing":"n"}]},
 {"kind":"kids","state":"none"},
 {"kind":"events","state":"unavailable","reason":"seoulOnly"},
 {"kind":"barrierFree","state":"failed"}
]}}"""

    private fun decode(json: String): NearbyOverview =
        assertNotNull(KitJson.decodeFromString(NearbyOverviewResponse.serializer(), json).data)

    @Test fun overviewLinesKoAreOnePerBulletAndDistinctPerState() {
        val lines = buildOverviewLines(decode(fixture), "ko").map { it.text }
        // 문장형 + 받침에 따른 조사(이/가·은/는)는 코드가 고른다. 거리·방위가 이름 앞이다.
        assertEquals(
            listOf(
                "가장 가까운 지하철역은 북동쪽 262m 지점에 있는 5호선 길동입니다. 버스 정류소가 5곳 있습니다. 가장 가까운 곳은 동쪽 80m 지점에 있는 길동사거리이고, 북쪽 120m 지점에 길동역이 있습니다.",
                "식당이 15곳 이상 있습니다. 가장 가까운 곳은 남쪽 40m 지점에 있는 봉래면옥이고, 동쪽 60m 지점에 김밥천국이 있습니다.",
                "카페가 3곳 있습니다. 가장 가까운 곳은 서쪽 90m 지점에 있는 스타벅스이고, 북쪽 200m 지점에 카페 1971 있습니다.",
                "아이 놀 곳은 1km 안에 없습니다.",
                "문화 행사는 서울에서만 안내합니다.",
                "무장애 관광지 정보를 가져오지 못했습니다.",
            ),
            lines,
        )
    }

    @Test fun overviewTransitVariantsKo() {
        fun line(bullets: String) = buildOverviewLines(decode("""{"data":{"place":null,"radiusMeters":1000,"bullets":[$bullets]}}"""), "ko")[0].text
        assertEquals("1km 안에 지하철역이 없습니다. 버스 정류소가 없습니다.", line("""{"kind":"transit","state":"ok","station":null,"busStops":{"state":"none"}}"""))
        assertEquals("1km 안에 지하철역이 없습니다. 버스 정류소 정보는 이 지역에서 제공되지 않습니다.", line("""{"kind":"transit","state":"ok","station":null,"busStops":{"state":"uncovered"}}"""))
        assertEquals(
            "가장 가까운 지하철역은 서쪽 910m 지점에 있는 용문입니다. 버스 정류소 정보를 가져오지 못했습니다.",
            line("""{"kind":"transit","state":"ok","station":{"name":"용문","line":null,"bearing":"w","distanceMeters":910},"busStops":{"state":"failed"}}"""),
        )
        assertEquals("1km 안에 지하철역이 없습니다.", line("""{"kind":"transit","state":"ok","station":null,"busStops":null}"""))
        // 버스 조각 자체가 없으면(키 없음) 역 문장만.
        assertEquals(
            "가장 가까운 지하철역은 서쪽 910m 지점에 있는 용문입니다.",
            line("""{"kind":"transit","state":"ok","station":{"name":"용문","line":null,"bearing":"w","distanceMeters":910},"busStops":null}"""),
        )
    }

    @Test fun overviewLinesEnUseLocaleOrder() {
        val lines = buildOverviewLines(decode(fixture), "en").map { it.text }
        assertEquals("Restaurants: 15 or more. The nearest are 봉래면옥, 40m to the south, 김밥천국, 60m to the east.", lines[1])
        assertEquals("Cafes: 3. The nearest are 스타벅스, 90m to the west, 카페 1971, 200m to the north.", lines[2])
        assertEquals("Places for kids: none within 1km.", lines[3])
        // 조사는 ko에서만 붙는다.
        assertTrue(lines[0].startsWith("Transit: The nearest subway station is 길동 (5호선), 262m to the northeast."), lines[0])
    }

    /** 한 곳뿐이면 나열이 없어 조사 자리도 없다(nearestOne). 조사 판정 불가 축은 위 fixture의 "카페 1971"이 덮는다. */
    @Test fun overviewNearestUsesSingularSentenceForOnePlace() {
        val json = """{"data":{"place":null,"radiusMeters":1000,"bullets":[{"kind":"cafe","state":"ok","count":1,"countCapped":false,"nearest":[{"name":"GS25","distanceMeters":40,"bearing":"s"}]}]}}"""
        assertEquals(listOf("카페가 1곳 있습니다. 가장 가까운 곳은 남쪽 40m 지점에 있는 GS25입니다."), buildOverviewLines(decode(json), "ko").map { it.text })
    }

    /** 비-ko: 역은 seed 영문(nameEn) 우선, 장소는 nameRoman, 한글 없는 이름(GS25)은 병기하지 않는다(E28). */
    @Test fun overviewLinesEnUseRomanAndCollectKoreanSecondary() {
        val json = """{"data":{"place":null,"radiusMeters":1000,"bullets":[
          {"kind":"transit","state":"ok","station":{"name":"길동역","nameEn":"Gil-dong","line":"5호선","bearing":"n","distanceMeters":200},"busStops":null},
          {"kind":"kids","state":"ok","count":2,"countCapped":false,"nearest":[
            {"name":"길동어린이공원","nameRoman":"Gildongeorinigongwon","distanceMeters":300,"bearing":"w"},
            {"name":"GS25","nameRoman":"GS25","distanceMeters":400,"bearing":"e"}]}]}}"""
        val lines = buildOverviewLines(decode(json), "en")
        assertTrue(lines[0].text.contains("Gil-dong"))
        assertFalse(lines[0].text.contains("길동역"))
        assertEquals("길동역", lines[0].secondary)
        assertTrue(lines[1].text.contains("Gildongeorinigongwon, 300m to the west"))
        assertEquals("길동어린이공원", lines[1].secondary)
        assertTrue(lines[1].display.endsWith(" (길동어린이공원)"))
    }

    /** 방위 단어: 8방위는 카탈로그(ko "북동" — "쪽"은 문장 틀이 붙인다), 미지 키는 원문(웹 폴백 동형). */
    @Test fun directionWordFallsBackToRaw() {
        assertEquals("북동", directionWord("ne", "ko"))
        assertEquals("up", directionWord("up", "ko"))
    }
}

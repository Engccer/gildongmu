package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.QuickExit
import space.dodoplanet.gildongmu.kit.models.QuickExitDoor
import space.dodoplanet.gildongmu.kit.models.TransitLegExit
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 경로 브리핑의 출구 번호 줄(E25) — 웹 `transit-exit-lines.test.ts`·Kit `TransitExitLinesTests`와 같은 케이스.
 * 갈리면 같은 경로가 웹과 앱에서 다른 줄을 낸다.
 */
class TransitExitLinesTest {
    /** 앱 카탈로그의 `transitGuide.exitBound`를 대신하는 테스트용 조립기(ko 문구와 같은 모양). */
    private val exitBound: (String) -> String = { "${it}번 출구 방면" }

    private fun walk() = TransitRouteLeg(mode = "walk", toName = "개화", minutes = 2, distanceMeters = 131)

    private fun subway(board: String? = null, alight: String? = null) = TransitRouteLeg(
        mode = "subway", lineName = "수도권 9호선", fromName = "개화", toName = "중앙보훈병원",
        stationCount = 15, minutes = 30,
        exit = if (board == null && alight == null) null else TransitLegExit(board = board, alight = alight),
    )

    private fun bus() = TransitRouteLeg(mode = "bus", lineName = "370", fromName = "정류소", toName = "환승정류소", stationCount = 5, minutes = 10)

    // 하차 줄

    @Test fun `빠른하차와 출구가 함께 있으면 문 먼저 출구가 끝에`() {
        val quick = QuickExit(transfer = QuickExitDoor(kind = "door", doors = listOf("6-3")))
        assertEquals("노량진 하차, 빠른 환승 6-3 문, 7번 출구 방면", alightLineText(quick, "노량진", "7", "ko", exitBound))
    }

    @Test fun `빠른하차가 없으면 하차역과 출구만으로 줄이 선다`() {
        assertEquals("중앙보훈병원 하차, 1번 출구 방면", alightLineText(null, "중앙보훈병원", "1", "ko", exitBound))
    }

    @Test fun `출구가 없으면 종전 빠른하차 문장 그대로`() {
        val quick = QuickExit(elevator = QuickExitDoor(kind = "door", doors = listOf("6-4")))
        assertEquals("여의도 하차, 엘리베이터 6-4 문", alightLineText(quick, "여의도", null, "ko", exitBound))
    }

    @Test fun `둘 다 없으면 줄을 만들지 않는다`() {
        assertNull(alightLineText(null, "여의도", null, "ko", exitBound))
    }

    @Test fun `형식에 맞지 않는 출구는 부재로 본다`() {
        assertNull(alightLineText(null, "여의도", "null", "ko", exitBound))
        assertNull(alightLineText(null, "여의도", "1 2", "ko", exitBound))
        assertNull(alightLineText(null, "여의도", "", "ko", exitBound))
        assertEquals("여의도 하차, 3-1번 출구 방면", alightLineText(null, "여의도", "3-1", "ko", exitBound))
    }

    @Test fun `역 이름이 없으면 줄을 만들지 않는다`() {
        assertNull(alightLineText(null, "", "1", "ko", exitBound))
    }

    @Test fun `en도 같은 분기를 탄다`() {
        val quick = QuickExit(transfer = QuickExitDoor(kind = "door", doors = listOf("6-3")))
        assertEquals(
            "Get off at Noryangjin, quick transfer at door 6-3, Toward Exit 7",
            alightLineText(quick, "Noryangjin", "7", "en") { "Toward Exit $it" },
        )
    }

    // 승차 출구가 실리는 줄

    @Test fun `도보 다음이 탑승이면 그 도보 줄이 싣는다`() {
        val legs = listOf(walk(), subway(board = "1"))
        assertEquals("1", boardExitAfterWalk(legs, 0))
        assertNull(boardExitOnBoardLine(legs, 1))
    }

    @Test fun `앞에 도보가 없으면 탑승 줄이 싣는다`() {
        assertEquals("5", boardExitOnBoardLine(listOf(bus(), subway(board = "5")), 1))
        assertEquals("2", boardExitOnBoardLine(listOf(subway(board = "2")), 0))
    }

    @Test fun `실을 것이 없으면 둘 다 nil`() {
        assertNull(boardExitAfterWalk(listOf(walk(), walk()), 0))
        assertNull(boardExitAfterWalk(listOf(walk()), 0))
        assertNull(boardExitAfterWalk(listOf(walk(), subway(alight = "1")), 0))
        assertNull(boardExitOnBoardLine(listOf(walk(), subway(board = "1")), 0))
        assertNull(boardExitAfterWalk(listOf(walk(), subway(board = " ")), 0))
        assertNull(boardExitOnBoardLine(listOf(bus(), subway(board = "null")), 1))
    }

    @Test fun `불변식 한 탑승 구간의 승차 출구는 한 줄에만 실린다`() {
        val routes = listOf(
            listOf(walk(), subway(board = "1"), walk()),
            listOf(bus(), subway(board = "5"), walk()),
            listOf(subway(board = "2"), walk(), bus()),
            listOf(walk(), subway(board = "1"), subway(alight = "3"), walk()),
            listOf(walk(), bus(), walk(), subway(board = "4"), walk()),
        )
        for (legs in routes) {
            legs.forEachIndexed { i, leg ->
                if (leg.mode == "walk") return@forEachIndexed
                val onWalk = if (i > 0 && legs[i - 1].mode == "walk") boardExitAfterWalk(legs, i - 1) else null
                val onBoard = boardExitOnBoardLine(legs, i)
                assertTrue(listOfNotNull(onWalk, onBoard).size <= 1)
                // 서버가 실은 값은 반드시 어느 한 줄에 도달한다(조용한 누락 금지).
                assertEquals(leg.exit?.board, onWalk ?: onBoard)
            }
        }
    }

    // 줄 단위 영어 자격 (하차 줄 역명이 구간 줄과 같은 술어를 본다)

    private fun subwayEn(lineEn: String? = "Line 9", fromEn: String? = "Gaehwa", toEn: String? = "VHS Medical Center") = TransitRouteLeg(
        mode = "subway", lineName = "수도권 9호선", fromName = "개화", toName = "중앙보훈병원", stationCount = 15, minutes = 30,
        lineNameEn = lineEn, fromNameEn = fromEn, toNameEn = toEn,
    )

    @Test fun `ko 세션은 영문이 다 있어도 한국어`() {
        assertFalse(transitLegUsesEnglish(subwayEn(), DataLocale.ko))
        assertEquals("중앙보훈병원", transitAlightStationName(subwayEn(), DataLocale.ko))
    }

    @Test fun `en 세션은 노선 승차 하차 영문이 다 있을 때만 영어`() {
        assertTrue(transitLegUsesEnglish(subwayEn(), DataLocale.en))
        assertEquals("VHS Medical Center", transitAlightStationName(subwayEn(), DataLocale.en))
        // 하나라도 없으면 줄 전체가 한국어 — 하차 역명만 영문으로 바꾸지 않는다(구간 줄과 어긋난다).
        assertFalse(transitLegUsesEnglish(subwayEn(lineEn = null), DataLocale.en))
        assertEquals("중앙보훈병원", transitAlightStationName(subwayEn(lineEn = null), DataLocale.en))
        assertFalse(transitLegUsesEnglish(subwayEn(fromEn = null), DataLocale.en))
        assertFalse(transitLegUsesEnglish(subwayEn(toEn = null), DataLocale.en))
        assertEquals("중앙보훈병원", transitAlightStationName(subwayEn(toEn = null), DataLocale.en))
    }

    @Test fun `도보 구간은 행선지 영문만 본다`() {
        val named = TransitRouteLeg(mode = "walk", toName = "개화", minutes = 2, toNameEn = "Gaehwa")
        assertTrue(transitLegUsesEnglish(named, DataLocale.en))
        assertFalse(transitLegUsesEnglish(walk(), DataLocale.en))
        // 마지막 도보(행선지 없음)는 영문 조각이 필요 없다.
        val last = TransitRouteLeg(mode = "walk", minutes = 2)
        assertTrue(transitLegUsesEnglish(last, DataLocale.en))
        assertEquals("", transitAlightStationName(last, DataLocale.en))
    }
}

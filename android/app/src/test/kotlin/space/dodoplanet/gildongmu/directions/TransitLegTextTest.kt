package space.dodoplanet.gildongmu.directions

import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.kitLocalized
import space.dodoplanet.gildongmu.kit.models.QuickExit
import space.dodoplanet.gildongmu.kit.models.QuickExitDoor
import space.dodoplanet.gildongmu.kit.models.TransitLegExit
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteEnvelope
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.models.TransitRouteSummary
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** spec §3-4-a·b — iOS `RouteBriefing.swift` 문장과 같은 값. 문장은 실제 카탈로그(`CatalogStrings`). */
class TransitLegTextTest {
    private val ko = CatalogStrings("ko")
    private val fixture = Fixtures.kitJson("route-transit.json", TransitRouteEnvelope.serializer()).result!!.recommended

    private fun walk(toName: String? = null, toNameEn: String? = null, minutes: Int = 4, distance: Int? = 178) =
        TransitRouteLeg(mode = "walk", toName = toName, toNameEn = toNameEn, distanceMeters = distance, minutes = minutes)
    private fun subway(
        line: String = "수도권 2호선", lineEn: String? = null, from: String = "잠실", fromEn: String? = null, to: String = "강남", toEn: String? = null,
        stations: Int = 6, minutes: Int = 11, exit: TransitLegExit? = null, quickExit: QuickExit? = null,
    ) = TransitRouteLeg(
        mode = "subway", lineName = line, lineNameEn = lineEn, fromName = from, fromNameEn = fromEn, toName = to, toNameEn = toEn,
        stationCount = stations, minutes = minutes, exit = exit, quickExit = quickExit,
    )

    private fun lines(legs: List<TransitRouteLeg>, dest: String? = null, lang: String = "ko", data: DataLocale = DataLocale.ko, s: Strings = ko) =
        legs.indices.map { transitLegLine(legs, it, dest, lang, data, s) }

    @Test fun `fixture 추천 경로 5구간 ko 문장`() {
        val got = lines(fixture.legs).map { it.spoken }
        assertEquals(
            listOf(
                "길동까지 도보 4분, 178m",
                "수도권 5호선, 길동에서 승차, 천호에서 하차, 2 정거장, 4분 소요",
                "수도권 8호선, 천호에서 승차, 잠실에서 하차, 3 정거장, 6분 소요",
                "수도권 2호선, 잠실에서 승차, 강남에서 하차, 6 정거장, 11분 소요",
                "목적지까지 도보 1분, 72m",
            ),
            got,
        )
        lines(fixture.legs).forEach { assertEquals(it.visual, it.spoken) } // ko는 시각·낭독 같다
    }

    @Test fun `마지막 도보는 목적지 이름을 알면 그것을 쓰고 빈 toName도 폴백한다`() {
        assertEquals("강남역까지 도보 1분, 72m", lines(fixture.legs, dest = "강남역").last().spoken)
        val legs = listOf(subway(), walk(toName = "", minutes = 1, distance = 72))
        assertEquals("강남역까지 도보 1분, 72m", lines(legs, dest = "강남역").last().spoken)
        assertEquals("목적지까지 도보 1분", lines(listOf(subway(), walk(minutes = 1, distance = null))).last().spoken)
    }

    @Test fun `공백뿐인 이름은 정보 부재다 - 승하차 조각·노선·목적지 폴백에 쓰지 않는다(iOS 2026-09-19)`() {
        val blankFrom = lines(listOf(subway(from = " \t", to = "강남"))).single().spoken
        assertEquals("수도권 2호선, 강남에서 하차, 6 정거장, 11분 소요", blankFrom)
        val blankLine = transitLegText(
            TransitRouteLeg(mode = "bus", lineName = " ", fromName = "정류소", toName = "환승정류소", stationCount = 5, minutes = 10),
            null, LegNames.Korean, null, "ko", ko,
        )
        assertFalse(blankLine.contains("번 버스"), blankLine)
        assertEquals("목적지까지 도보 1분, 72m", lines(listOf(subway(), walk(toName = "\n", minutes = 1, distance = 72)), dest = "  ").last().spoken)
        // 정상 이름은 원문 그대로(공백·부역명 보존 — 정규화는 조인의 몫).
        assertEquals("천호(풍납토성)까지 도보 3분, 178m", lines(listOf(walk(toName = "천호(풍납토성)", minutes = 3), subway())).first().spoken)
    }

    @Test fun `승차 출구는 도보 줄이 있으면 도보 줄이, 없으면 탑승 줄 끝이 싣는다 - 배타`() {
        val withWalk = listOf(walk(toName = "길동"), subway(exit = TransitLegExit(board = "3")))
        val l1 = lines(withWalk).map { it.spoken }
        assertEquals("길동 3번 출구까지 도보 4분, 178m", l1[0])
        assertFalse(l1[1].contains("출구"))
        val direct = listOf(subway(exit = TransitLegExit(board = "3")), walk(minutes = 1, distance = 72))
        assertEquals("수도권 2호선, 잠실에서 승차, 강남에서 하차, 6 정거장, 11분 소요, 3번 출구로 진입", lines(direct).map { it.spoken }[0])
    }

    @Test fun `하차 줄 4조합 - 빠른하차·하차 출구·둘 다·둘 다 없음`() {
        val qe = QuickExit(elevator = QuickExitDoor("single", listOf("3-2")))
        assertEquals("강남 하차, 엘리베이터 3-2 문", alightLine(subway(quickExit = qe), "ko", DataLocale.ko, ko))
        assertEquals("강남 하차, 5번 출구 방면", alightLine(subway(exit = TransitLegExit(alight = "5")), "ko", DataLocale.ko, ko))
        assertEquals("강남 하차, 엘리베이터 3-2 문, 5번 출구 방면", alightLine(subway(quickExit = qe, exit = TransitLegExit(alight = "5")), "ko", DataLocale.ko, ko))
        assertNull(alightLine(subway(), "ko", DataLocale.ko, ko))
        assertNull(alightLine(subway(exit = TransitLegExit(alight = "abc")), "ko", DataLocale.ko, ko)) // 형식 게이트
    }

    @Test fun `en 자격이 있으면 역명만 병기하고 노선은 영문 그대로, 하차 줄은 앱 언어(ja)`() {
        val ja = CatalogStrings("ja")
        val leg = subway(lineEn = "Seoul Metro Line 2", fromEn = "Jamsil", toEn = "Gangnam", exit = TransitLegExit(alight = "5"))
        val line = transitLegLine(listOf(leg), 0, null, "ja", DataLocale.en, ja)
        assertTrue(line.visual.startsWith("Seoul Metro Line 2, "), line.visual)
        assertFalse(line.visual.contains("(수도권"), line.visual) // 노선은 병기하지 않는다
        assertTrue(line.visual.contains("Jamsil (잠실)") && line.visual.contains("Gangnam (강남)"), line.visual)
        assertTrue(line.spoken.contains("Jamsil") && !line.spoken.contains("(잠실)"), line.spoken)
        val alight = alightLine(leg, "ja", DataLocale.en, ja)
        assertEquals(kitLocalized("route.transit.alightAt", "ja", "Gangnam") + ", " + ja.get("transitGuide.exitBound", "5"), alight)
    }

    @Test fun `영문 조각 하나가 없으면 그 구간 줄 전체가 한국어`() {
        val leg = subway(lineEn = "Seoul Metro Line 2", fromEn = "Jamsil", toEn = null)
        val line = transitLegLine(listOf(leg), 0, null, "en", DataLocale.en, CatalogStrings("en"))
        assertEquals(line.visual, line.spoken)
        assertTrue(line.visual.startsWith("수도권 2호선"), line.visual)
        assertEquals("강남", transitAlightStationNameOf(leg))
    }

    private fun transitAlightStationNameOf(leg: TransitRouteLeg) = space.dodoplanet.gildongmu.kit.transitAlightStationName(leg, DataLocale.en)

    @Test fun `버스 노선은 번 버스, 공백뿐인 노선은 없음`() {
        val bus = TransitRouteLeg(mode = "bus", lineName = "370", fromName = "길동", toName = "천호", stationCount = 3, minutes = 7)
        assertEquals("370번 버스, 길동에서 승차, 천호에서 하차, 3 정거장, 7분 소요", lines(listOf(bus))[0].spoken)
        val blank = bus.copy(lineName = " ")
        assertEquals("길동에서 승차, 천호에서 하차, 3 정거장, 7분 소요", lines(listOf(blank))[0].spoken)
    }

    @Test fun `운행 밖 경고는 같은 줄 끝에 붙는다`() {
        val bus = TransitRouteLeg(mode = "bus", lineName = "370", fromName = "길동", toName = "천호", minutes = 7, serviceStatus = "outside", firstServiceTime = "04:30", lastServiceTime = "23:10")
        assertEquals("370번 버스, 길동에서 승차, 천호에서 하차, 7분 소요, 첫차 04:30, 막차 23:10, 지금은 운행하지 않습니다", lines(listOf(bus))[0].spoken)
    }

    @Test fun `대안 이름 4갈래`() {
        fun route(h: List<String>?, idx: Int?) = TransitRoute(TransitRouteSummary(1, 0, 0, 0), emptyList(), "k", h, idx)
        assertEquals("가장 빠르고 환승도 가장 적은 경로", transitAlternativeName(route(listOf("fastest", "fewestTransfers"), null), ko))
        assertEquals("환승이 가장 적은 경로", transitAlternativeName(route(listOf("fewestTransfers"), null), ko))
        assertEquals("가장 빠른 경로", transitAlternativeName(route(listOf("fastest"), null), ko))
        assertEquals("대안 경로 2", transitAlternativeName(route(null, 2), ko))
        assertEquals("대안 경로 1", transitAlternativeName(route(listOf("unknownAxis"), null), ko))
    }
}

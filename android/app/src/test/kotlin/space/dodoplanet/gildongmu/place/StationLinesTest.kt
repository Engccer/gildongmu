package space.dodoplanet.gildongmu.place

import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.StationService
import space.dodoplanet.gildongmu.kit.models.SeoulMetroFacility
import space.dodoplanet.gildongmu.kit.models.SeoulMetroFacilityParts
import space.dodoplanet.gildongmu.kit.models.StationMeta
import space.dodoplanet.gildongmu.kit.models.TimetableDirection
import space.dodoplanet.gildongmu.kit.models.TimetableLine
import space.dodoplanet.gildongmu.kit.models.TimetableTrain
import space.dodoplanet.gildongmu.kit.pathOf
import space.dodoplanet.gildongmu.kit.stubbedClient
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** spec §12-3 — 역 자동 섹션 문장(iOS `StationSections.swift` 이식)과 5조각 로드의 3-state(판정 27). */
class StationLinesTest {
    private val suffixed = { core: String -> "${core}호선" }

    @Test fun `매핑표 미지 값 — kind·dailyType·direction·compass·operating은 null(원문·서버 문장·조각 생략)`() {
        assertNull(metroKindResId("teleporter")); assertEquals(R.string.subway_kind_elevator, metroKindResId("elevator"))
        assertNull(dailyTypeResId("holiday")); assertEquals(R.string.timetable_dailyType_sunday, dailyTypeResId("sunday"))
        assertNull(directionResId("loop")); assertEquals(R.string.timetable_direction_up, directionResId("up"))
        assertNull(compassResId("nne")); assertEquals(R.string.subway_direction_nw, compassResId("nw"))
        assertNull(operatingResId("unknown")); assertNull(operatingResId(null)); assertEquals(R.string.android_station_operatingStopped, operatingResId("stopped"))
    }

    @Test fun `시설 수 3-state`() {
        val f = { l: String, c: Int? -> countText(l, c, { "$it 정보 없음" }, { "$it 없음" }) { l2, n -> "$l2 ${n}대" } }
        assertEquals("엘리베이터 정보 없음", f("엘리베이터", null)); assertEquals("엘리베이터 없음", f("엘리베이터", 0)); assertEquals("엘리베이터 3대", f("엘리베이터", 3))
    }

    @Test fun `coverage — ok는 null, 부재+방향 0은 unknown(m1), 부재+방향 있음은 ok, 미지 값은 unknown`() {
        val d = TimetableDirection("up", TimetableTrain("05:30", terminus = "왕십리"), TimetableTrain("23:50", terminus = "왕십리"))
        val cov = { line: TimetableLine -> coverageText(line, { it.lineName }, { "$it 편성 없음" }, { "$it 미제공" }) { "$it 확인 불가" } }
        assertNull(cov(TimetableLine("2호선", "ok", listOf(d))))
        assertEquals("2호선 확인 불가", cov(TimetableLine("2호선", null, emptyList())))
        assertNull(cov(TimetableLine("2호선", null, listOf(d))))
        assertEquals("2호선 편성 없음", cov(TimetableLine("2호선", "noTrains", emptyList())))
        assertEquals("2호선 미제공", cov(TimetableLine("2호선", "unavailable", emptyList())))
        assertEquals("2호선 확인 불가", cov(TimetableLine("2호선", "weird", emptyList())))
    }

    @Test fun `노선명 — 방향 행은 lineCore 접미(A26), coverage 줄은 en 우선`() {
        val line = TimetableLine("수도권 2", null, emptyList(), lineCore = "2", lineNameEn = "Line 2")
        assertEquals("2호선", lineKoName(line, suffixed))
        assertEquals("Line 2", lineDisplayName(line, true, suffixed))
        assertEquals("2호선", lineDisplayName(line, false, suffixed))
        assertEquals("수도권 2", lineKoName(line.copy(lineCore = null), suffixed))
    }

    @Test fun `첫차 문장 — 익일 접두·종착 없음·en 종착 폴백·en 자격은 종착이 비면 영문 불필요(N4)`() {
        assertEquals("익일 00:42 왕십리행", trainText(TimetableTrain("00:42", nextDay = true, terminus = "왕십리"), false, "익일") { "${it}행" })
        assertEquals("05:30", trainText(TimetableTrain("05:30", terminus = ""), true, "next") { "to $it" })
        assertEquals("05:30 to Wangsimni", trainText(TimetableTrain("05:30", terminus = "왕십리", terminusEn = "Wangsimni"), true, "next") { "to $it" })
        assertEquals("05:30 to 왕십리", trainText(TimetableTrain("05:30", terminus = "왕십리"), true, "next") { "to $it" }) // 영문 없으면 원문
        val line = TimetableLine("2", null, emptyList(), lineNameEn = "Line 2")
        val ready = TimetableDirection("up", TimetableTrain("05:30", terminus = "", ), TimetableTrain("23:50", terminus = "왕십리", terminusEn = "Wangsimni"))
        assertEquals("Line 2", timetableLineEnName(line, ready, isEn = true))
        assertNull(timetableLineEnName(line, ready, isEn = false))
        assertNull(timetableLineEnName(line, TimetableDirection("up", TimetableTrain("05:30", terminus = "왕십리"), ready.last), isEn = true))
        assertNull(timetableLineEnName(line.copy(lineNameEn = null), ready, isEn = true))
    }

    @Test fun `시설 이름 — parts compass+meters 우선, 미지 방위는 서버 문장, location+lineEn 차선, 없으면 name`() {
        val name = { f: SeoulMetroFacility -> facilityName(f, { if (it == "n") "북" else null }, { d, dist -> "$d $dist 지점" }) { "${it}호선" } }
        val parts = SeoulMetroFacilityParts(compass = "n", meters = 120, dong = "천호동")
        assertEquals("북 120m 지점, 천호동", name(SeoulMetroFacility("서버문장", parts = parts)))
        assertEquals("서버문장", name(SeoulMetroFacility("서버문장", parts = parts.copy(compass = "zz"))))
        assertEquals("1번 출구, Line 5", name(SeoulMetroFacility("서버문장", parts = SeoulMetroFacilityParts(location = "1번 출구", line = "5", lineEn = "Line 5"))))
        assertEquals("1번 출구, 5호선", name(SeoulMetroFacility("서버문장", parts = SeoulMetroFacilityParts(location = "1번 출구", line = "5"))))
        assertEquals("서버문장", name(SeoulMetroFacility("서버문장")))
        assertEquals("남녀 공용, 휠체어 접근 가능", facilityDetail(SeoulMetroFacility("x", detail = "d", parts = SeoulMetroFacilityParts(restroomType = "남녀 공용", wheelchairAccessible = true)), "휠체어 접근 가능"))
        assertEquals("d", facilityDetail(SeoulMetroFacility("x", detail = "d", parts = SeoulMetroFacilityParts(location = "l")), "휠체어 접근 가능"))
    }

    @Test fun `역 메타 한 줄 — ko는 접미·영문·노선·환승·운영기관, en은 병기(낭독은 영문만)`() {
        val meta = StationMeta(name = "강남", nameEn = "Gangnam", lines = listOf("2호선", "신분당선"), linesEn = listOf("Line 2", "Shinbundang"), isTransfer = true, operatorName = "서울교통공사")
        val ko = stationMetaLine(meta, "ko", isEn = false, nameSuffixed = { "${it}역" }, transfer = "환승역")
        assertEquals("강남역, Gangnam, 2호선, 신분당선, 환승역, 서울교통공사", ko.visual); assertEquals(ko.visual, ko.spoken)
        val en = stationMetaLine(meta, "en", isEn = true, nameSuffixed = { "${it}역" }, transfer = "Transfer")
        assertEquals("Gangnam (강남), Line 2, Shinbundang, Transfer, 서울교통공사", en.visual)
        assertEquals("Gangnam, Line 2, Shinbundang, Transfer, 서울교통공사", en.spoken)
        val noEn = stationMetaLine(meta.copy(linesEn = null), "en", isEn = true, nameSuffixed = { "${it}역" }, transfer = "Transfer")
        assertEquals("Gangnam, 2호선, 신분당선, Transfer, 서울교통공사", noEn.spoken) // 노선 영문이 없으면 그 조각은 한국어(줄 단위 원자성)
    }

    @Test fun `5조각 로드 — 시간표만 실패를 Error로, null은 Hidden, 나머지 실패는 null(판정 27)`() = runTest {
        val s = StationService(stubbedClient { url -> when (pathOf(url)) {
            "/api/station/meta" -> HttpResponse(200, Fixtures.kit("station-meta.json"))
            "/api/station/timetable" -> HttpResponse(500, "")
            else -> HttpResponse(500, "")
        } })
        val r = loadStationSections(s, "강남", "ko")
        assertNotNull(r.meta); assertNull(r.arrivals); assertNull(r.korail); assertNull(r.metro); assertEquals(TimetableState.Error, r.timetable)
        val hidden = loadStationSections(StationService(stubbedClient { HttpResponse(200, """{"timetable":null,"meta":null,"facilities":null,"arrivals":null}""") }), "강남", "ko")
        assertEquals(TimetableState.Hidden, hidden.timetable); assertNull(hidden.meta)
        val done = loadStationSections(StationService(stubbedClient { url -> if (pathOf(url) == "/api/station/timetable") HttpResponse(200, Fixtures.kit("station-timetable.json")) else HttpResponse(500, "") }), "강남", "ko")
        assertIs<TimetableState.Done>(done.timetable)
    }
}

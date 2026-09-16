package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.AirNearbyResponse
import space.dodoplanet.gildongmu.kit.models.AirPollutant
import space.dodoplanet.gildongmu.kit.models.SeoulMetroFacilitiesResponse
import space.dodoplanet.gildongmu.kit.models.StationArrivalResponse
import space.dodoplanet.gildongmu.kit.models.StationFacilitiesResponse
import space.dodoplanet.gildongmu.kit.models.StationMetaResponse
import space.dodoplanet.gildongmu.kit.models.StationTimetableResponse
import space.dodoplanet.gildongmu.kit.models.WeatherNearbyResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 역·환경 계약 테스트(Kit `StationModelsTests` 미러). `isStation` 판정은 `StationMatchTest`. */
class StationModelsTest {
    @Test fun stationMetaFixtureDecodes() {
        val meta = assertNotNull(Fixtures.kitJson("station-meta.json", StationMetaResponse.serializer()).meta)
        assertEquals("강동", meta.name); assertEquals("Gangdong", meta.nameEn)
        assertEquals(listOf("5호선"), meta.lines); assertEquals(false, meta.isTransfer)
        assertEquals("서울교통공사", meta.operatorName); assertEquals("江東", meta.nameHanja)
    }

    @Test fun stationFacilitiesFixtureDecodes() {
        val f = assertNotNull(Fixtures.kitJson("station-facilities.json", StationFacilitiesResponse.serializer()).facilities)
        assertEquals("서울", f.stationName); assertEquals(true, f.accessibleToilet)
        assertEquals(1, f.wheelchairLifts); assertEquals(18, f.elevators); assertEquals(true, f.accessibleSlope)
    }

    @Test fun stationMetroFacilitiesFixtureDecodes() {
        val f = assertNotNull(Fixtures.kitJson("station-metro-facilities.json", SeoulMetroFacilitiesResponse.serializer()).facilities)
        assertEquals("강동", f.stationName); assertEquals("5호선", f.line)
        assertTrue(f.groups.isNotEmpty()); assertTrue(f.groups.all { it.facilities.isNotEmpty() })
        val statuses = f.groups.flatMap { it.facilities }.mapNotNull { it.operatingStatus }
        assertTrue(statuses.toSet().all { it in setOf("normal", "stopped") }); assertTrue("stopped" in statuses)
        assertTrue(f.groups.flatMap { it.facilities }.any { it.location == null })
        assertNull(f.supplementFailed)
    }

    @Test fun stationMetroFacilitiesSupplementFailedDecodes() {
        val f = assertNotNull(KitJson.decodeFromString(SeoulMetroFacilitiesResponse.serializer(), """{"facilities":{"stationName":"봉은사","line":null,"groups":[],"supplementFailed":true}}""").facilities)
        assertTrue(f.groups.isEmpty()); assertEquals(true, f.supplementFailed)
    }

    @Test fun stationTimetableFixtureDecodes() {
        val tt = assertNotNull(Fixtures.kitJson("station-timetable.json", StationTimetableResponse.serializer()).timetable)
        assertEquals("강동역 5호선", tt.stationName); assertEquals("weekday", tt.dailyType); assertNull(tt.partial)
        assertEquals(1, tt.lines.size)
        val line = tt.lines[0]
        assertEquals("5호선", line.lineName); assertEquals(2, line.directions.size)
        val up = assertNotNull(line.directions.firstOrNull { it.direction == "up" })
        assertNull(up.first.nextDay); assertEquals("05:32", up.first.time); assertEquals("방화", up.first.terminus); assertEquals("Banghwa", up.first.terminusEn)
        assertEquals(true, up.last.nextDay); assertEquals("00:42", up.last.time); assertEquals("Wangsimni", up.last.terminusEn)
    }

    @Test fun stationTimetablePartialAndMissingTerminusEnDecode() {
        val json = """{"timetable":{"stationName":"동두천역","dailyType":"weekday","partial":true,"lines":[{"lineName":"1호선","directions":[{"direction":"up","first":{"time":"05:10","terminus":"동두천"},"last":{"time":"23:40","terminus":"동두천"}}]}]}}"""
        val tt = assertNotNull(KitJson.decodeFromString(StationTimetableResponse.serializer(), json).timetable)
        assertEquals(true, tt.partial)
        val train = tt.lines[0].directions[0].first
        assertNull(train.terminusEn); assertNull(train.nextDay)
    }

    @Test fun stationTimetableLineCoverageDecodesOptionally() {
        val json = """{"timetable":{"stationName":"홍대입구","dailyType":"weekday","lines":[{"lineName":"2호선","coverage":"unknown","directions":[]},{"lineName":"공항철도","directions":[{"direction":"up","first":{"time":"05:10","terminus":"인천공항2터미널"},"last":{"time":"23:40","terminus":"인천공항2터미널"}}]}]}}"""
        val tt = assertNotNull(KitJson.decodeFromString(StationTimetableResponse.serializer(), json).timetable)
        assertEquals("unknown", tt.lines[0].coverage); assertTrue(tt.lines[0].directions.isEmpty())
        assertNull(tt.lines[1].coverage); assertEquals(1, tt.lines[1].directions.size)
    }

    @Test fun stationTimetableEmptyLinesAndNullEnvelopeDecode() {
        assertEquals(true, KitJson.decodeFromString(StationTimetableResponse.serializer(), """{"timetable":{"stationName":"x","dailyType":"sunday","lines":[]}}""").timetable?.lines?.isEmpty())
        assertNull(KitJson.decodeFromString(StationTimetableResponse.serializer(), """{"timetable":null}""").timetable)
    }

    @Test fun stationArrivalFixtureDecodes() {
        val arrivals = assertNotNull(Fixtures.kitJson("station-arrival.json", StationArrivalResponse.serializer()).arrivals)
        assertEquals("강동", arrivals.stationName)
        assertTrue(arrivals.arrivals.isNotEmpty()); assertTrue(arrivals.arrivals.all { it.message.isNotEmpty() })
    }

    @Test fun airNearbyFixtureDecodes() {
        val air = assertNotNull(Fixtures.kitJson("air-nearby.json", AirNearbyResponse.serializer()).air)
        assertEquals("천호대로", air.stationName); assertEquals(0.3, air.distanceKm)
        assertTrue(air.dataTime.isNotEmpty()); assertEquals(59.0, air.khai.value)
    }

    @Test fun weatherNearbyFixtureDecodes() {
        val w = assertNotNull(Fixtures.kitJson("weather-nearby.json", WeatherNearbyResponse.serializer()).weather)
        assertEquals("cloudy", w.sky.label); assertEquals("rain", w.precipitation.label)
        assertEquals(24.2, w.tempC); assertEquals("07:00", w.baseTime); assertEquals(63, w.grid.nx)
    }

    @Test fun airGradeWordsAreCanonicalAndValueNullable() {
        val air = assertNotNull(Fixtures.kitJson("air-nearby.json", AirNearbyResponse.serializer()).air)
        val valid = setOf("good", "moderate", "bad", "veryBad", "unknown")
        assertTrue(air.khai.grade in valid && air.pm10.grade in valid && air.pm25.grade in valid)
        val broken = KitJson.decodeFromString(AirPollutant.serializer(), """{"value":null,"grade":"unknown"}""")
        assertNull(broken.value); assertEquals("unknown", broken.grade)
    }

    @Test fun weatherPartialNullsDecode() {
        val w = assertNotNull(Fixtures.kitJson("weather-nearby.json", WeatherNearbyResponse.serializer()).weather)
        assertNull(w.tempMin); assertEquals(31.0, w.tempMax)
        val degraded = KitJson.decodeFromString(WeatherNearbyResponse.serializer(), """{"weather":{"sky":{"code":null,"label":"unknown"},"precipitation":{"code":0,"label":"none"},"tempC":null,"tempMax":null,"tempMin":null,"humidity":null,"precipProbability":null,"baseTime":"07:00","grid":{"nx":63,"ny":126}}}""")
        assertNull(degraded.weather?.sky?.code); assertNull(degraded.weather?.tempC)
    }

    @Test fun stationEnvelopesDecodeNullBodies() {
        assertNull(KitJson.decodeFromString(StationMetaResponse.serializer(), """{"meta":null}""").meta)
        assertNull(KitJson.decodeFromString(StationFacilitiesResponse.serializer(), """{"facilities":null}""").facilities)
        assertNull(KitJson.decodeFromString(SeoulMetroFacilitiesResponse.serializer(), """{"facilities":null}""").facilities)
        assertNull(KitJson.decodeFromString(StationArrivalResponse.serializer(), """{"arrivals":null}""").arrivals)
    }

    @Test fun stationMetroFacilityPartsDecodeOptionally() {
        val json = """{"facilities":{"stationName":"강동","groups":[
          {"kind":"elevatorLocation","facilities":[{"name":"역 중심 기준 북동쪽 약 120m, 성내동","parts":{"compass":"ne","meters":120,"dong":"성내동"}}]},
          {"kind":"voiceGuide","facilities":[{"name":"3번 출구 5호선","parts":{"location":"3번 출구","line":"5","lineEn":"Line 5"}},{"name":"6번 출구 99호선","parts":{"location":"6번 출구","line":"99"}},{"name":"4번 출구"}]},
          {"kind":"restroom","facilities":[{"name":"장애인화장실","detail":"남녀구분 · 휠체어 접근 가능","parts":{"restroomType":"남녀구분","wheelchairAccessible":true}}]}]}}"""
        val f = assertNotNull(KitJson.decodeFromString(SeoulMetroFacilitiesResponse.serializer(), json).facilities)
        assertEquals("ne", f.groups[0].facilities[0].parts?.compass); assertEquals(120, f.groups[0].facilities[0].parts?.meters); assertEquals("성내동", f.groups[0].facilities[0].parts?.dong)
        assertEquals("5", f.groups[1].facilities[0].parts?.line); assertEquals("Line 5", f.groups[1].facilities[0].parts?.lineEn)
        assertEquals("99", f.groups[1].facilities[1].parts?.line); assertNull(f.groups[1].facilities[1].parts?.lineEn)
        assertNull(f.groups[1].facilities[2].parts)
        assertEquals(true, f.groups[2].facilities[0].parts?.wheelchairAccessible); assertEquals("남녀구분", f.groups[2].facilities[0].parts?.restroomType)
    }

    @Test fun stationTimetableLineCoreDecodesOptionally() {
        val json = """{"timetable":{"stationName":"왕십리","dailyType":"weekday","lines":[{"lineName":"수인분당선","lineCore":"수인분당","coverage":"unknown","directions":[]},{"lineName":"2호선","coverage":"unknown","directions":[]}]}}"""
        val tt = assertNotNull(KitJson.decodeFromString(StationTimetableResponse.serializer(), json).timetable)
        assertEquals("수인분당", tt.lines[0].lineCore); assertNull(tt.lines[1].lineCore)
    }

    @Test fun stationMetaLinesEnDecodesOptionally() {
        val meta = assertNotNull(KitJson.decodeFromString(StationMetaResponse.serializer(), """{"meta":{"name":"강남","nameEn":"Gangnam","lines":["2호선","신분당선"],"linesEn":["Line 2","Shinbundang Line"],"isTransfer":true,"operator":"서울교통공사"}}""").meta)
        assertEquals(listOf("Line 2", "Shinbundang Line"), meta.linesEn)
        val ko = assertNotNull(KitJson.decodeFromString(StationMetaResponse.serializer(), """{"meta":{"name":"강남","nameEn":"Gangnam","lines":["2호선"],"isTransfer":false,"operator":"서울교통공사"}}""").meta)
        assertNull(ko.linesEn)
    }

    @Test fun stationTimetableLineNameEnDecodesOptionally() {
        val json = """{"timetable":{"stationName":"서울숲","dailyType":"weekday","lines":[{"lineName":"수인분당선","lineCore":"수인분당","lineNameEn":"Suin-Bundang Line","coverage":"unknown","directions":[]},{"lineName":"화성선","coverage":"unknown","directions":[]}]}}"""
        val tt = assertNotNull(KitJson.decodeFromString(StationTimetableResponse.serializer(), json).timetable)
        assertEquals("Suin-Bundang Line", tt.lines[0].lineNameEn); assertNull(tt.lines[1].lineNameEn)
    }

    @Test fun stationArrivalEnFieldsDecodeOptionally() {
        val json = """{"arrivals":{"stationName":"강남","arrivals":[
          {"line":"2호선","lineEn":"Line 2","direction":"외선","directionEn":"Outer Circle","trainLineNm":"성수행 - 역삼방면","trainLineNmEn":"To Seongsu via Yeoksam","destination":"성수","message":"강남 도착","messageEn":"Arrived at Gangnam","currentLocation":"강남","currentLocationEn":"Gangnam","arrivalSeconds":0,"express":false},
          {"line":"2호선","direction":"외선","trainLineNm":"성수행 - 역삼방면","destination":"성수","message":"7분 후","arrivalSeconds":420,"express":false}]}}"""
        val a = assertNotNull(KitJson.decodeFromString(StationArrivalResponse.serializer(), json).arrivals)
        assertEquals("Arrived at Gangnam", a.arrivals[0].messageEn); assertEquals("Line 2", a.arrivals[0].lineEn)
        assertEquals("Outer Circle", a.arrivals[0].directionEn); assertEquals("To Seongsu via Yeoksam", a.arrivals[0].trainLineNmEn)
        assertEquals("Gangnam", a.arrivals[0].currentLocationEn); assertEquals("강남 도착", a.arrivals[0].message)
        assertNull(a.arrivals[1].messageEn)
    }
}

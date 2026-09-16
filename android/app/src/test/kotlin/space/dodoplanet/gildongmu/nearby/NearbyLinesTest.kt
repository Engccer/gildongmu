package space.dodoplanet.gildongmu.nearby

import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import space.dodoplanet.gildongmu.kit.models.BikeStation
import space.dodoplanet.gildongmu.kit.models.BusArrival
import space.dodoplanet.gildongmu.kit.models.BusStop
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.KitJson
import space.dodoplanet.gildongmu.kit.models.SubwayArrival
import space.dodoplanet.gildongmu.kit.SubwayArrivalSegment
import space.dodoplanet.gildongmu.kit.models.SurroundingPlace
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class NearbyLinesTest {
    private val segmentText: (SubwayArrivalSegment) -> String = { "${it.key}(${it.args.joinToString("|")})" }

    @Test fun `역 헤딩은 역명·노선이 둘 다 영문일 때만 영어`() {
        assertEquals(LineText("강남, 2호선", "강남, 2호선"), subwayStationLine(false, "ko", "강남", "Gangnam", listOf("2호선"), listOf("Line 2")))
        assertEquals(LineText("Gangnam (강남), Line 2", "Gangnam, Line 2"), subwayStationLine(true, "en", "강남", "Gangnam", listOf("2호선"), listOf("Line 2")))
        assertEquals(LineText("강남, 2호선", "강남, 2호선"), subwayStationLine(true, "en", "강남", "Gangnam", listOf("2호선"), null)) // 노선 영문 결측 → 둘 다 ko
    }

    @Test fun `도착 문장 조각 키 13개가 전부 리소스에 매핑된다(공유 fixture 전수)`() {
        val cases = KitJson.parseToJsonElement(Fixtures.shared("subway-arrival-prose-cases.json")).jsonObject["cases"]!!.jsonArray
        val keys = LinkedHashSet<String>()
        for (c in cases) {
            val k = c.jsonObject["keys"]?.jsonObject ?: continue
            k["joined"]?.jsonArray?.forEach { keys += it.jsonPrimitive.content }
            k["tail"]?.let { if (it.toString() != "null") keys += it.jsonPrimitive.content }
        }
        assertEquals(13, keys.size, keys.toString())
        for (key in keys) assertNotNull(subwayArrivalSegmentResId(key), "미매핑 키 $key")
        assertNull(subwayArrivalSegmentResId("future"))
    }

    @Test fun `도착 한 줄 — 문장형은 우리 문장, 못 알아본 문장은 원문 + 현재역 꼬리`() {
        val prose = SubwayArrival(line = "5호선", direction = "상행", trainLineNm = "방화행 - 강동방면", destination = "방화", message = "길동 도착", currentLocation = "길동", arrivalSeconds = 60, express = false)
        assertEquals("5호선, 방화행 - 강동방면, arrived(길동)", subwayArrivalLine(prose, false, segmentText, "급행") { "현재 $it" })
        val raw = SubwayArrival(line = "5호선", direction = "상행", trainLineNm = "방화행", destination = "방화", message = "알 수 없는 문장", currentLocation = "고덕", arrivalSeconds = 0, express = true)
        assertEquals("5호선, 급행, 방화행, 알 수 없는 문장, 현재 고덕", subwayArrivalLine(raw, false, segmentText, "급행") { "현재 $it" })
        // en: 편성 조각 영문이 하나라도 없으면 줄 전체 ko — 그것도 문장형이 아니라 **원문 경로**(iOS 동형: 문장 틀은 앱 언어 하나뿐이라
        // "이 줄만 한국어 문장"을 만들 수단이 없다)
        assertEquals("5호선, 방화행 - 강동방면, 길동 도착", subwayArrivalLine(prose.copy(lineEn = "Line 5"), true, segmentText, "express") { "now at $it" })
        val en = prose.copy(lineEn = "Line 5", directionEn = "Up", trainLineNmEn = "to Banghwa", currentLocationEn = "Gildong")
        assertEquals("Line 5 Up, to Banghwa, arrived(Gildong)", subwayArrivalLine(en, true, segmentText, "express") { "now at $it" })
    }

    @Test fun `버스 도착 줄은 완성 문장이 있으면 그대로, 없으면 슬롯 조합`() {
        val seoul = BusArrival(routeId = "1", routeNo = "130", routeType = "간선버스", arrivalSeconds = 0, prevStationCount = 0, lowFloor = true, arrivalMessage = "4분후[1번째 전]", source = "seoul")
        assertEquals("130번, 간선버스, 저상, 4분후[1번째 전]", busArrivalLine(seoul, { "${it}번" }, "저상", { "${it}정류장 전" }, { "약 ${it}분 후" }))
        val tago = seoul.copy(arrivalMessage = null, prevStationCount = 3, arrivalSeconds = 200, lowFloor = false)
        assertEquals("130번, 간선버스, 3정류장 전, 약 3분 후", busArrivalLine(tago, { "${it}번" }, "저상", { "${it}정류장 전" }, { "약 ${it}분 후" }))
        assertEquals("130번, 간선버스, 0정류장 전, 약 1분 후", busArrivalLine(tago.copy(prevStationCount = 0, arrivalSeconds = 10), { "${it}번" }, "저상", { "${it}정류장 전" }, { "약 ${it}분 후" }))
    }

    @Test fun `정류소 헤딩·대여소 줄은 비-ko에서 시각 병기, 낭독은 로마자만`() {
        val stop = BusStop(nodeId = "1", cityCode = "seoul", name = "강동역", nameRoman = "Gangdong Station", stopNo = "25224", lat = 0.0, lng = 0.0, distanceMeters = 155, source = "seoul", arrivalStatus = "ok", arrivals = emptyList())
        assertEquals(LineText("강동역, 25224, 155m", "강동역, 25224, 155m"), busStopHeading(stop, "ko"))
        assertEquals(LineText("Gangdong Station (강동역), 25224, 155m", "Gangdong Station, 25224, 155m"), busStopHeading(stop, "en"))
        val bike = BikeStation(stationId = "ST-1", name = "길동 마루빌딩", nameRoman = "Gildong Marubuilding", lat = 0.0, lng = 0.0, distanceMeters = 293, racksTotal = 10, bikesAvailable = 3)
        assertEquals("Gildong Marubuilding, 293m, 대여 가능 3대, 거치대 10대", bikeLine(bike, "en", { "대여 가능 ${it}대" }, { "거치대 ${it}대" }).spoken)
    }

    @Test fun `방위·제목·둘러보기 보조 줄`() {
        assertEquals("북동쪽", bearingLabel("ne", { mapOf("ne" to "북동")[it] }, { "${it}쪽" }))
        assertNull(bearingLabel("up", { "x" }, { "${it}쪽" }))
        assertEquals("지하철 도착", nearbyTitle("지하철 도착", null, "ko"))
        assertEquals("Subway arrivals, Gangnam Station", nearbyTitle("Subway arrivals", PlaceAnchor(0.0, 0.0, "강남역", "Gangnam Station"), "en"))
        val place = SurroundingPlace(id = "kakao-1", name = "CU 강동풍차점", category = "convenience", categoryRaw = "가정,생활 > 편의점 > CU", distanceMeters = 10, bearing = "ne", lat = 0.0, lng = 0.0)
        assertEquals("CU, 북동쪽, 약 10m", aroundSecondary(place, "ko", { mapOf("ne" to "북동")[it] }, { "${it}쪽" }, { "약 $it" }))
    }
}

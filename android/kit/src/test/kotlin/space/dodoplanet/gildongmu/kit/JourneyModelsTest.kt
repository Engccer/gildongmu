package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.builtins.ListSerializer
import space.dodoplanet.gildongmu.kit.models.*
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * E70 여정 응답(spec §4.7) 디코딩·조회 쿼리·최근 경로 역 필드 계약. Kit `JourneyModelsTests` 미러. `journey-result.json`은 손으로 쓴 §4.7 모양
 * (아현 → 광화문, 공공 역 좌표)이고 `journey-live-both.json`은 실호출 캡처다. Swift의 `StubNetworkTests` 확장 케이스는 같은 파일에 둔다.
 */
class JourneyModelsTest {
    private fun decodeResult(json: String): JourneyResult = KitJson.decodeFromString(JourneyResult.serializer(), json)

    private fun service(handler: (String) -> HttpResponse): Pair<RouteService, StubTransport> {
        val transport = StubTransport(handler)
        return RouteService(APIClient("https://example.test", transport)) to transport
    }

    /**
     * 실호출 응답 그대로(2026-10-17 `/api/route/journey` 둘 다 지정 — 홍대입구 2호선 승차 → 잠실 2호선 하차, 공공 지점)를
     * 디코딩한다. 손 fixture만으로는 서버가 필드를 바꿔도 잡지 못한다(최종 교차 검토 MINOR-7).
     */
    @Test fun liveResponseDecodes() {
        val result = decodeResult(Fixtures.kit("journey-live-both.json"))
        val variant = result.variants.first()
        assertEquals(JourneyVariantKind.designated, variant.kind)
        assertEquals("홍대입구", variant.boardStation?.name)
        assertEquals("잠실", variant.alightStation?.name)
        assertEquals("tmap", variant.taxiIn?.provider)
        assertEquals(listOf("subway"), variant.transit.legs.map { it.mode })
        val option = variant.egress!!.options.first()
        assertEquals(EgressKind.exit, option.kind)
        assertTrue(option.placeName.startsWith("잠실역"))
        assertEquals(variant.transit.summary.fare, variant.totals.transitFare)
    }

    @Test fun fixtureDecodes() {
        val result = decodeResult(Fixtures.kit("journey-result.json"))
        assertNull(result.designatedMissing)
        assertEquals(2, result.variants.size)

        val designated = result.variants[0]
        assertEquals(JourneyVariantKind.designated, designated.kind)
        assertEquals(JourneyStationRef(name = "아현", coord = RoutePoint(lat = 37.5573, lng = 126.956)), designated.boardStation)
        assertEquals("광화문", designated.alightStation?.name)
        assertEquals(7800, designated.taxiIn?.taxiFare)
        assertEquals(480, designated.taxiIn?.durationSeconds)
        assertEquals("p0", designated.transit.routeKey)
        assertEquals("아현", designated.transit.legs.first().stops?.first()?.name)
        assertEquals(JourneyTotals(minutes = 31, taxiFare = 15600, transitFare = 1550), designated.totals)
        assertNull(designated.egress?.lookupFailed)
        val options = designated.egress!!.options
        assertEquals(listOf(EgressKind.exit, EgressKind.stand), options.map { it.kind })
        assertEquals("1", options[0].label)
        assertEquals("광화문역 5호선 1번출구", options[0].placeName)
        assertEquals("5호선", options[0].lineName)
        assertEquals(7800, options[0].taxiOut.taxiFare)
        assertNull(options[1].lineName)

        // 추천 변형: 택시 앞 구간·하차 지정 역·출구가 없다
        val recommended = result.variants[1]
        assertEquals(JourneyVariantKind.recommended, recommended.kind)
        assertEquals("애오개", recommended.boardStation?.name)
        assertNull(recommended.taxiIn)
        assertNull(recommended.alightStation)
        assertNull(recommended.egress)
        assertEquals(0, recommended.totals.taxiFare)
    }

    @Test fun designatedMissingAndEmptyVariantsDecode() {
        val missing = decodeResult("""{"variants":[],"designatedMissing":{"side":"alight"}}""")
        assertTrue(missing.variants.isEmpty())
        assertEquals(JourneyDesignatedMissing(side = JourneyMissingSide.alight, oppositeDirection = null), missing.designatedMissing)
        for ((raw, side) in listOf("board" to JourneyMissingSide.board, "both" to JourneyMissingSide.both)) {
            val r = decodeResult("""{"variants":[],"designatedMissing":{"side":"$raw"}}""")
            assertEquals(side, r.designatedMissing?.side)
        }
    }

    @Test fun egressNoneAndLookupFailedDecode() {
        // 3-state: 출구 후보 없음(kind none, 이름 빈 문자열)과 조회 실패(lookupFailed)는 서로 다른 신호다.
        val json = """
        {"variants":[{"kind":"designated",
          "transit":{"summary":{"totalMinutes":10,"fare":1550,"transfers":0,"walkMinutes":0,
                                "departName":"아현","arriveName":"광화문"},"legs":[],"routeKey":"p0"},
          "egress":{"options":[{"kind":"none","label":"","placeName":"",
            "coord":{"lat":37.5714,"lng":126.9767},
            "taxiOut":{"distanceMeters":3400,"durationSeconds":780,"taxiFare":7800,"tollFare":0,"guides":[]}}],
            "lookupFailed":true},
          "totals":{"minutes":23,"taxiFare":7800,"transitFare":1550}}]}
        """
        val egress = decodeResult(json).variants.first().egress!!
        assertEquals(true, egress.lookupFailed)
        assertEquals(EgressKind.none, egress.options.first().kind)
        assertEquals("", egress.options.first().placeName)
        assertNull(egress.options.first().lineName)
    }

    @Test fun unknownVariantKindFailsDecoding() {
        // 서버가 모르는 갈래를 보내면 조용히 다른 갈래로 읽지 않는다
        assertFailsWith<Exception> {
            decodeResult("""{"variants":[{"kind":"fastest","transit":{"summary":{"totalMinutes":1,"fare":0,"transfers":0,"walkMinutes":0},"legs":[],"routeKey":"p"},"totals":{"minutes":1,"taxiFare":0,"transitFare":0}}]}""")
        }
    }

    // MARK: 조회 쿼리 (Swift `StubNetworkTests` 확장)

    @Test fun journeyDecodesResultAndSendsAllStationQueries() = runTest {
        val (svc, t) = service { HttpResponse(200, Fixtures.kit("journey-result.json")) }
        val response = svc.journey(
            originLat = 37.55, originLng = 126.95, destLat = 37.58, destLng = 126.98,
            board = JourneyStationQuery(name = "아현", lat = 37.5573, lng = 126.956, line = "2호선", kind = null, aboardDirection = null),
            alight = JourneyStationQuery(name = "광화문", lat = 37.5714, lng = 126.9767, line = null, kind = null, aboardDirection = null),
        )
        val result = (response as? JourneyResponse.Result)?.result ?: fail("result가 아니다: $response")
        assertEquals(2, result.variants.size)
        assertEquals("/api/route/journey", pathOf(t.seenUrls.last()))
        val q = t.lastQuery()
        fun value(name: String) = q.firstOrNull { it.first == name }?.second
        assertEquals("37.55,126.95", value("origin"))
        assertEquals("37.58,126.98", value("dest"))
        assertEquals("37.5573,126.956", value("board"))
        assertEquals("아현", value("boardName"))
        assertEquals("2호선", value("boardLine"))
        assertEquals("37.5714,126.9767", value("alight"))
        assertEquals("광화문", value("alightName"))
        // 노선 힌트가 없는 쪽은 파라미터를 보내지 않는다(빈 문자열도 아님)
        assertFalse(q.hasName("alightLine"))
        // ko 전용 — lang을 보내지 않는다
        assertFalse(q.hasName("lang"))
        // 정류장 옵트인은 늘 싣고, 역 지정에는 Kind를 싣지 않는다
        assertEquals("1", value("stops"))
        assertFalse(q.hasName("boardKind") || q.hasName("alightKind"))
    }

    @Test fun journeySendsAboardKindAndDirection() = runTest {
        val (svc, t) = service { HttpResponse(200, """{"variants":[]}""") }
        svc.journey(
            originLat = 37.55, originLng = 126.95, destLat = 37.58, destLng = 126.98,
            board = JourneyStationQuery(name = "서울역", lat = 37.5547, lng = 126.9707, line = "1호선", kind = null, aboardDirection = "상행"),
            alight = JourneyStationQuery(name = "광화문", lat = 37.5714, lng = 126.9767, line = null, kind = null, aboardDirection = "하행"),
        )
        val q = t.lastQuery()
        assertTrue(q.has("boardKind", "aboard"))
        assertTrue(q.has("boardDir", "상행"))
        assertTrue(q.has("boardLine", "1호선"))
        assertTrue(q.has("stops", "1"))
        // aboard는 하차 쪽에 오지 않는다 — 넘겨도 무시
        assertFalse(q.hasName("alightKind") || q.hasName("alightDir"))
    }

    @Test fun journeyAboardIsIgnoredForBusStopSide() = runTest {
        val (svc, t) = service { HttpResponse(200, """{"variants":[]}""") }
        svc.journey(
            originLat = 37.55, originLng = 126.95, destLat = 37.58, destLng = 126.98,
            board = JourneyStationQuery(name = "강남역", lat = 37.4979, lng = 127.0276, line = null, kind = JourneyStationKind.busStop, aboardDirection = "상행"),
            alight = null,
        )
        assertTrue(t.lastQuery().has("boardKind", "stop"))
        assertFalse(t.lastQuery().hasName("boardDir"))
    }

    @Test fun journeyAboardWithoutLineOmitsBoardLine() = runTest {
        val (svc, t) = service { HttpResponse(200, """{"variants":[]}""") }
        svc.journey(
            originLat = 37.55, originLng = 126.95, destLat = 37.58, destLng = 126.98,
            board = JourneyStationQuery(name = "서울역", lat = 37.5547, lng = 126.9707, line = null, kind = null, aboardDirection = "상행"),
            alight = null,
        )
        assertFalse(t.lastQuery().hasName("boardLine"))
    }

    @Test fun oppositeDirectionDecodesOptionally() {
        val r = decodeResult("""{"variants":[],"designatedMissing":{"side":"board","oppositeDirection":true}}""")
        assertEquals(true, r.designatedMissing?.oppositeDirection)
        val none = decodeResult("""{"variants":[],"designatedMissing":{"side":"board"}}""")
        assertNull(none.designatedMissing?.oppositeDirection)
    }

    @Test fun journeySendsKindForBusStopSides() = runTest {
        val (svc, t) = service { HttpResponse(200, """{"variants":[]}""") }
        svc.journey(
            originLat = 37.55, originLng = 126.95, destLat = 37.58, destLng = 126.98,
            board = JourneyStationQuery(name = "강남역", lat = 37.4979, lng = 127.0276, line = "5호선", kind = JourneyStationKind.busStop, aboardDirection = null),
            alight = JourneyStationQuery(name = "광화문", lat = 37.5714, lng = 126.9767, line = null, kind = null, aboardDirection = null),
        )
        val q = t.lastQuery()
        assertTrue(q.has("stops", "1"))
        assertTrue(q.has("boardKind", "stop"))
        assertFalse(q.hasName("boardLine"))
        assertFalse(q.hasName("alightKind"))
    }

    @Test fun journeyStopsSendsQueryAndDecodesThreeStates() = runTest {
        var body = """{"stops":[{"name":"강남역.삼성전자","lat":37.4979,"lng":127.0276,"stopNo":"25-001","source":"seoul"},{"name":"강남역","lat":37.5,"lng":127.1,"source":"tago"}],"failed":true,"truncated":true}"""
        val (svc, t) = service { HttpResponse(200, body) }
        val res = svc.journeyStops(query = "강남역", origin = RoutePoint(37.55, 126.95), dest = null)
        assertEquals("/api/route/journey/stops", pathOf(t.seenUrls.last()))
        val q = t.lastQuery()
        assertTrue(q.has("q", "강남역"))
        assertTrue(q.has("origin", "37.55,126.95"))
        assertFalse(q.hasName("dest"))
        assertEquals(2, res.stops.size)
        assertTrue(res.stops[0].stopNo == "25-001" && res.stops[0].source == JourneyStopHit.Source.seoul)
        assertTrue(res.stops[1].stopNo == null && res.stops[1].source == JourneyStopHit.Source.tago)
        assertTrue(res.failed && res.truncated && !res.unsearched)

        body = """{"stops":[]}"""
        val empty = svc.journeyStops(query = "없는곳", origin = null, dest = RoutePoint(37.58, 126.98))
        assertTrue(empty.stops.isEmpty() && !empty.failed && !empty.unsearched && !empty.truncated)

        body = """{"stops":[],"unsearched":true}"""
        val unsearched = svc.journeyStops(query = "강남", origin = RoutePoint(37.55, 126.95), dest = null)
        assertTrue(unsearched.unsearched && unsearched.stops.isEmpty())

        body = """{"outOfCoverage":true}"""
        assertFailsWith<APIError.OutOfCoverage> { svc.journeyStops(query = "후쿠오카", origin = RoutePoint(33.5, 130.4), dest = null) }
    }

    @Test fun journeyOmitsUndesignatedSide() = runTest {
        val (svc, t) = service { HttpResponse(200, """{"variants":[]}""") }
        val response = svc.journey(
            originLat = 37.55, originLng = 126.95, destLat = 37.58, destLng = 126.98,
            board = null,
            alight = JourneyStationQuery(name = "광화문", lat = 37.5714, lng = 126.9767, line = "5호선", kind = null, aboardDirection = null),
        )
        val result = (response as? JourneyResponse.Result)?.result ?: fail("result가 아니다")
        assertTrue(result.variants.isEmpty())
        assertEquals(setOf("origin", "dest", "stops", "alight", "alightName", "alightLine"), t.lastQuery().map { it.first }.toSet())
    }

    @Test fun journeyOutOfCoverageMarkerDecodesToOutOfCoverage() = runTest {
        val (svc, _) = service { HttpResponse(200, """{"outOfCoverage":true}""") }
        val response = svc.journey(originLat = 35.1, originLng = 129.0, destLat = 33.5, destLng = 126.5, board = null, alight = null)
        assertEquals(JourneyResponse.OutOfCoverage, response)
    }

    @Test fun journeyServerErrorStillThrows() = runTest {
        val (svc, _) = service { HttpResponse(502, """{"error":"upstream"}""") }
        assertFailsWith<APIError> {
            svc.journey(originLat = 37.55, originLng = 126.95, destLat = 37.58, destLng = 126.98, board = null, alight = null)
        }
    }
}

// MARK: - 최근 경로의 역 필드

class RecentRouteStationTest {
    private val home = RecentEndpoint(label = "출발지", lat = 37.5, lng = 127.0)
    private val dest = RecentEndpoint(label = "도착지", lat = 37.6, lng = 127.1)
    private val ahyeon = RecentStation(label = "아현", lat = 37.5573, lng = 126.956, line = "2호선", kind = null)
    private val gwanghwamun = RecentStation(label = "광화문", lat = 37.5714, lng = 126.9767, line = null, kind = null)

    private fun route(board: RecentStation?, alight: RecentStation?, pinned: Boolean = false) =
        RecentRoute(from = home, to = dest, via = null, pinned = pinned, boardStation = board, alightStation = alight)

    @Test fun legacyJSONDecodesWithNilStations() {
        val json = """[{"from":{"label":"출발지","lat":37.5,"lng":127.0},"to":{"label":"도착지","lat":37.6,"lng":127.1},"pinned":true}]"""
        val routes = KitJson.decodeFromString(ListSerializer(RecentRoute.serializer()), json)
        assertEquals(1, routes.size)
        assertNull(routes[0].boardStation)
        assertNull(routes[0].alightStation)
        assertTrue(routes[0].pinned)
        assertNull(routes[0].via)
    }

    @Test fun stationsRoundTripThroughStore() {
        val store = RecentSearchStore(InMemoryKeyValueStore())
        store.recordRoute(route(ahyeon, gwanghwamun))
        val saved = store.routes()
        assertEquals(1, saved.size)
        assertEquals(ahyeon, saved[0].boardStation)
        assertEquals(gwanghwamun, saved[0].alightStation)
        assertEquals("2호선", saved[0].boardStation?.line)
        assertNull(saved[0].alightStation?.line)
    }

    @Test fun idAndSameRouteSeparateRoutesByStations() {
        val plain = route(null, null)
        val withBoard = route(ahyeon, null)
        val withBoth = route(ahyeon, gwanghwamun)
        assertNotEquals(plain.id, withBoard.id)
        assertNotEquals(withBoard.id, withBoth.id)
        assertTrue(RecentSearchStore.sameRoute(plain, plain))
        assertFalse(RecentSearchStore.sameRoute(plain, withBoard))
        assertFalse(RecentSearchStore.sameRoute(withBoard, withBoth))

        val store = RecentSearchStore(InMemoryKeyValueStore())
        store.recordRoute(plain)
        store.recordRoute(withBoard)
        store.recordRoute(withBoth)
        assertEquals(3, store.routes().size)
        // 같은 쌍을 다시 기록하면 끌어올릴 뿐 늘지 않는다
        store.recordRoute(withBoard)
        assertEquals(3, store.routes().size)
        assertEquals(ahyeon, store.routes().first().boardStation)
    }

    @Test fun stationKeyUsesFourDecimalCoordinates() {
        // 좌표 4자리 일치 = 같은 역(라벨·노선 힌트는 정체성이 아니다)
        val a = route(RecentStation(label = "아현", lat = 37.55731, lng = 126.95601, line = "2호선", kind = null), null)
        val b = route(RecentStation(label = "아현역", lat = 37.55732, lng = 126.95602, line = null, kind = null), null)
        val c = route(RecentStation(label = "아현", lat = 37.5580, lng = 126.956, line = "2호선", kind = null), null)
        assertEquals(a.id, b.id)
        assertTrue(RecentSearchStore.sameRoute(a, b))
        assertNotEquals(a.id, c.id)
    }

    @Test fun pinningAndReorderKeepStations() {
        val store = RecentSearchStore(InMemoryKeyValueStore())
        val r = route(ahyeon, gwanghwamun)
        store.recordRoute(r)
        val pinned = store.setRoutePinned(r, pinned = true)
        assertEquals(true, pinned.first().pinned)
        assertEquals(ahyeon, pinned.first().boardStation)
        assertEquals(gwanghwamun, pinned.first().alightStation)
        // 고정본이 있는 상태에서 같은 쌍을 다시 기록해도 역이 유지된다
        val again = store.recordRoute(r)
        assertEquals(true, again.first().pinned)
        assertEquals(ahyeon, again.first().boardStation)
    }
}

class RecentStationKindTest {
    private val home = RecentEndpoint(label = "출발지", lat = 37.5, lng = 127.0)
    private val dest = RecentEndpoint(label = "도착지", lat = 37.6, lng = 127.1)

    @Test fun legacyStationJSONDecodesWithNilKind() {
        val json = """{"label":"아현","lat":37.5573,"lng":126.956,"line":"2호선"}"""
        val station = KitJson.decodeFromString(RecentStation.serializer(), json)
        assertNull(station.kind)
    }

    @Test fun unknownKindDecodesToNilWithoutLosingList() {
        val json = """[{"label":"x","lat":37.5,"lng":127.0,"kind":"station"},{"label":"y","lat":37.6,"lng":127.1,"kind":"stop"}]"""
        val list = KitJson.decodeFromString(ListSerializer(RecentStation.serializer()), json)
        assertEquals(listOf<JourneyStationKind?>(null, JourneyStationKind.busStop), list.map { it.kind })
    }

    @Test fun busStopKindRoundTripsAndIsPartOfIdentity() {
        val stop = RecentStation(label = "강남역", lat = 37.4979, lng = 127.0276, line = null, kind = JourneyStationKind.busStop)
        val text = KitJson.encodeToString(RecentStation.serializer(), stop)
        assertTrue(text.contains(""""kind":"stop""""))
        assertEquals(stop, KitJson.decodeFromString(RecentStation.serializer(), text))
        val station = RecentStation(label = "강남역", lat = 37.4979, lng = 127.0276, line = null, kind = null)
        assertNotEquals(stop.id, station.id)
        val a = RecentRoute(from = home, to = dest, boardStation = stop, alightStation = null)
        val b = RecentRoute(from = home, to = dest, boardStation = station, alightStation = null)
        assertNotEquals(a.id, b.id)
        assertFalse(RecentSearchStore.sameRoute(a, b))
    }
}

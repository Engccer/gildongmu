package space.dodoplanet.gildongmu.directions

import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.lifecycle.SavedStateHandle
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.a11y.HapticKind
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.HttpTransport
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.JourneyStationKind
import space.dodoplanet.gildongmu.kit.JourneyTransferMode
import space.dodoplanet.gildongmu.kit.JourneyTransferSide
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.PlacePhoneBook
import space.dodoplanet.gildongmu.kit.RecentEndpoint
import space.dodoplanet.gildongmu.kit.RecentEndpointScope
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.RecentStation
import space.dodoplanet.gildongmu.kit.RouteService
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.StationService
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.pathOf
import space.dodoplanet.gildongmu.kit.queryOf
import space.dodoplanet.gildongmu.location.StaleFix
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** B26 단계 5 묶음 A: 검색 대상 셋·정류장 줄·지금 탄 열차 검색·확인 질문 상태를 JVM 페이크 레인에서 잠근다(iOS `EndpointSearchModel`·`DirectionsTabView` 질문 몫). */
@OptIn(ExperimentalCoroutinesApi::class)
class JourneyEndpointSearchTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private val ko = CatalogStrings("ko")
    private val seoul = NearbyCoord(37.5385, 127.1355)
    private val gangnam = DirectionsEndpoint.Place("강남역", 37.4979, 127.0276)

    // ── 중립 장소 fixture(카카오 분류 모양) ──────────────────────────────────────
    private fun placeJson(id: String, name: String, category: String, lat: Double, lng: Double, phone: String? = null) =
        """{"id":"$id","name":"$name","category":"$category","address":"서울","roadAddress":"","lat":$lat,"lng":$lng${if (phone != null) ",\"phone\":\"$phone\"" else ""}}"""

    private val subwayJson = placeJson("s1", "가나역 2호선", "교통,수송 > 지하철,전철 > 수도권2호선", 37.5573, 126.956)
    private val railJson = placeJson("r1", "다라역", "교통,수송 > 기차역", 37.5714, 126.9767)
    private val cafeJson = placeJson("c1", "마바 카페", "음식점 > 카페", 37.55, 126.99, phone = "02-1234-5678")
    private fun places(vararg items: String) = """{"places":[${items.joinToString(",")}],"provider":"kakao-local","query":"q"}"""
    private val oneAddr = """{"addresses":[{"roadAddr":"서울 강동구 천호대로 1","roadAddrPart1":"서울 강동구 천호대로 1","jibunAddr":"길동 1","engAddr":"1 Cheonho-daero","zipNo":"05300","bdNm":""}],"query":"q"}"""
    private val noAddr = """{"addresses":[],"query":"q"}"""
    private fun stops(vararg items: String, extra: String = "") = """{"stops":[${items.joinToString(",")}]$extra}"""
    private fun stopJson(name: String, lat: Double, lng: Double) = """{"name":"$name","lat":$lat,"lng":$lng,"stopNo":"1","source":"seoul"}"""
    private val far = stopJson("먼정류", 37.57, 126.97)
    private val near = stopJson("가까운", 37.539, 127.136)

    private class Net(val handler: (String) -> HttpResponse) : HttpTransport {
        val seen = ArrayList<String>()
        override suspend fun get(url: String, timeoutMs: Long?): HttpResponse { seen += url; return handler(pathOf(url)) }
        fun count(path: String) = seen.count { pathOf(it) == path }
        fun query(path: String) = seen.last { pathOf(it) == path }.let(::queryOf).split('&').filter { it.isNotEmpty() }.associate { it.substringBefore('=') to it.substringAfter('=', "") }
    }

    private class Fakes(
        var placesBody: String = "", var stopsReply: HttpResponse = HttpResponse(200, """{"stops":[]}"""), var addrBody: String = """{"addresses":[],"query":"q"}""",
        var placesStatus: Int = 200,
    )

    private fun net(f: Fakes) = Net { path ->
        when (path) {
            "/api/places" -> HttpResponse(f.placesStatus, f.placesBody)
            "/api/address/search" -> HttpResponse(200, f.addrBody)
            "/api/route/journey/stops" -> f.stopsReply
            else -> HttpResponse(404, "")
        }
    }

    private class Env(val vm: DirectionsViewModel, val net: Net, val store: RecentSearchStore, val phoneBook: PlacePhoneBook)

    private fun env(
        f: Fakes, lang: String = "ko", ranking: NearbyCoord? = null, stored: NearbyCoord? = null,
        store: RecentSearchStore = RecentSearchStore(InMemoryKeyValueStore()),
    ): Env {
        val n = net(f)
        val client = APIClient("https://example.test", n)
        val locator = object : EndpointLocator {
            override suspend fun currentCoordinate(force: Boolean): NearbyCoord = seoul
            override suspend fun coordinateForRanking(): NearbyCoord? = ranking
            override suspend fun coordinateForDisplay(): NearbyCoord? = null
            override fun staleFix(): StaleFix? = null
            override fun storedCoordinate(): NearbyCoord? = stored
            override suspend fun requestPreciseLocation() = false
        }
        val phoneBook = PlacePhoneBook(InMemoryKeyValueStore())
        val vm = DirectionsViewModel(
            RouteService(client), SearchService(client), StationService(client), store, locator, { lang }, ko, SavedStateHandle(), phoneBook,
            prefill = MutableStateFlow(null), takePrefill = { false }, io = dispatcher,
            guideFormPending = MutableStateFlow(null), takeGuideDestination = { null }, takeGuideWaypoint = { null },
        )
        return Env(vm, n, store, phoneBook)
    }

    private fun idle() = dispatcher.scheduler.advanceUntilIdle()

    private fun Env.search(target: DirectionsFieldTarget, query: String) {
        vm.openPicker(target); idle()
        vm.picker.state.value!!.queryState.setTextAndPlaceCursorAtEnd(query)
        vm.submitCandidates(); idle()
    }

    // ── journeyLineHint ──────────────────────────────────────────────────────

    private fun place(name: String, category: String) = Place(id = "x", name = name, category = category, address = "", roadAddress = "", lat = 0.0, lng = 0.0)

    @Test fun `노선 힌트는 분류 끝 조각 또는 이름 꼬리이고 모르면 null`() {
        assertEquals("수도권2호선", journeyLineHint(place("가나역", "교통,수송 > 지하철,전철 > 수도권2호선")))
        assertEquals("2호선", journeyLineHint(place("아현역 2호선", "교통,수송 > 지하철,전철")), "분류 끝이 지하철,전철이면 이름 꼬리")
        assertNull(journeyLineHint(place("강동역", "교통,수송 > 지하철,전철")))
        assertNull(journeyLineHint(place("서울역", "교통,수송 > 기차역")))
        assertEquals("경부선", journeyLineHint(place("서울역", "교통,수송 > 기차역 > 경부선")))
        assertEquals("GTX-A", journeyLineHint(place("수서역 GTX-A", "교통,수송 > 기차역")))
        assertEquals("경의중앙철도", journeyLineHint(place("가나역", "교통,수송 > 지하철,전철 > 경의중앙철도")))
        assertNull(journeyLineHint(place("가나역", "")), "분류가 비어도 죽지 않는다")
        assertNull(journeyLineHint(place("2호선", "")), "이름 첫 토큰은 꼬리가 아니다")
        assertEquals("2호선", journeyLineHint(place("가나역  2호선", "")), "연속 공백은 빈 조각을 버린다")
    }

    // ── 질문 문장·버튼 ────────────────────────────────────────────────────────

    private val ga = RecentStation("가나역", 37.5573, 126.956, "2호선", null)
    private val stop = RecentStation("마바", 37.55, 126.99, null, JourneyStationKind.busStop)

    @Test fun `질문 문장 여섯 갈래 — 짐작 쪽 x 수단, 정류장은 정류장 낱말, 역은 역 이름`() {
        fun q(station: RecentStation, mode: JourneyTransferMode, guess: JourneyTransferSide) = transferQuestionText(PendingTransfer(station, mode, guess), ko)
        assertEquals("지하철을 이용하다가 가나역에서 내려 자동차로 환승하실 예정인가요?", q(ga, JourneyTransferMode.subway, JourneyTransferSide.alight))
        assertEquals("기차를 이용하다가 가나역에서 내려 자동차로 환승하실 예정인가요?", q(ga, JourneyTransferMode.rail, JourneyTransferSide.alight))
        assertEquals("버스를 이용하다가 마바 정류장에서 내려 자동차로 환승하실 예정인가요?", q(stop, JourneyTransferMode.bus, JourneyTransferSide.alight))
        assertEquals("자동차로 이동하다가 가나역에서 지하철로 환승하실 예정인가요?", q(ga, JourneyTransferMode.subway, JourneyTransferSide.board))
        assertEquals("자동차로 이동하다가 가나역에서 기차로 환승하실 예정인가요?", q(ga, JourneyTransferMode.rail, JourneyTransferSide.board))
        assertEquals("자동차로 이동하다가 마바 정류장에서 버스로 환승하실 예정인가요?", q(stop, JourneyTransferMode.bus, JourneyTransferSide.board))
    }

    @Test fun `버튼 순서 — 짐작이 첫 버튼, 반대편, 경유만, 닫기`() {
        val alight = transferChoices(PendingTransfer(ga, JourneyTransferMode.subway, JourneyTransferSide.alight), ko)
        assertEquals(
            listOf(
                TransferChoice("네, 가나역에서 자동차로 환승합니다", board = false, cancel = false),
                TransferChoice("아니요, 자동차로 이동하다가 가나역에서 지하철로 환승합니다", board = true, cancel = false),
                TransferChoice("아니요, 환승하지 않고 경유만 합니다", board = null, cancel = false),
                TransferChoice("닫기", board = null, cancel = true),
            ),
            alight,
        )
        val board = transferChoices(PendingTransfer(stop, JourneyTransferMode.bus, JourneyTransferSide.board), ko)
        assertEquals(
            listOf(
                TransferChoice("네, 마바 정류장에서 버스로 환승합니다", board = true, cancel = false),
                TransferChoice("아니요, 버스를 이용하다가 마바 정류장에서 내려 자동차로 환승합니다", board = false, cancel = false),
                TransferChoice("아니요, 환승하지 않고 경유만 합니다", board = null, cancel = false),
                TransferChoice("닫기", board = null, cancel = true),
            ),
            board,
        )
        val rail = transferChoices(PendingTransfer(ga, JourneyTransferMode.rail, JourneyTransferSide.board), ko)
        assertEquals("네, 가나역에서 기차로 환승합니다", rail[0].label)
        assertEquals("아니요, 기차를 이용하다가 가나역에서 내려 자동차로 환승합니다", rail[1].label)
    }

    // ── 역 칸 ─────────────────────────────────────────────────────────────────

    @Test fun `역 칸 후보는 고를 수 있는 역 먼저, 기타 장소는 아래, 주소는 비우고 최근 목록을 싣지 않는다`() = runTest(dispatcher) {
        val store = RecentSearchStore(InMemoryKeyValueStore())
        store.recordEndpoint(RecentEndpoint("집", 37.5, 127.1), RecentEndpointScope.to)
        val f = Fakes(placesBody = places(cafeJson, subwayJson, railJson), addrBody = oneAddr, stopsReply = HttpResponse(200, stops(far, near)))
        val e = env(f, ranking = seoul, store = store)
        e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
        e.search(DirectionsFieldTarget.boardStation, "가나")
        val s = e.vm.picker.state.value!!
        assertTrue(s.recentEndpoints.isEmpty(), "역 칸은 최근 목록을 싣지 않는다")
        assertEquals(listOf("s1", "r1"), s.selectablePlaces.map { it.id }, "카카오 순서 그대로")
        assertEquals(listOf("c1"), s.otherPlaces.map { it.id })
        assertTrue(s.addresses.isEmpty(), "주소 후보는 담지 않는다")
        assertEquals(listOf("가까운", "먼정류"), s.stops.map { it.hit.name }, "거리순")
        assertTrue(s.stops[0].distance!! < s.stops[1].distance!!)
        assertEquals("검색 결과 5건을 찾았습니다.", s.notice.text, "건수는 보이는 줄 전부(장소 3 + 정류장 2)")
        assertEquals(HapticKind.success, s.notice.haptic)
        assertEquals("가까운, 정류장, ${space.dodoplanet.gildongmu.kit.formatDistance(s.stops[0].distance!!)}", stopRowText(s.stops[0], ko))
    }

    @Test fun `기준 좌표가 없으면 서버 순서 그대로이고 정류장 줄에 거리가 없다`() = runTest(dispatcher) {
        val e = env(Fakes(placesBody = places(subwayJson), stopsReply = HttpResponse(200, stops(far, near))), ranking = null)
        e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
        e.search(DirectionsFieldTarget.alightStation, "가나")
        val s = e.vm.picker.state.value!!
        assertEquals(listOf("먼정류", "가까운"), s.stops.map { it.hit.name })
        assertEquals("먼정류, 정류장", stopRowText(s.stops[0], ko))
    }

    @Test fun `역이 아닌 장소를 누르면 시트에 남고 역이나 정류장을 골라 달라는 통지와 진동만 낸다`() = runTest(dispatcher) {
        val e = env(Fakes(placesBody = places(cafeJson, subwayJson)))
        e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
        e.search(DirectionsFieldTarget.boardStation, "가나")
        val seq = e.vm.picker.state.value!!.notice.seq
        e.vm.selectPlace(e.vm.picker.state.value!!.otherPlaces.single())
        val s = e.vm.picker.state.value
        assertNotNull(s, "시트에 남는다")
        assertEquals("역이나 정류장을 골라 주세요.", s.notice.text)
        assertEquals(HapticKind.attention, s.notice.haptic)
        assertTrue(s.notice.seq > seq)
        assertNull(e.vm.state.value.boardStation)
    }

    @Test fun `역 장소를 누르면 노선 힌트를 실어 칸을 정하고 닫히며 그 칸으로 착지한다`() = runTest(dispatcher) {
        val e = env(Fakes(placesBody = places(subwayJson)))
        e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
        e.search(DirectionsFieldTarget.boardStation, "가나")
        e.vm.selectPlace(e.vm.picker.state.value!!.selectablePlaces.single())
        assertNull(e.vm.picker.state.value, "닫힌다")
        assertEquals(RecentStation("가나역 2호선", 37.5573, 126.956, "수도권2호선", null), e.vm.state.value.boardStation)
        assertEquals(LandingTarget.Field(DirectionsFieldTarget.boardStation), e.vm.state.value.landing?.target)
    }

    @Test fun `하차 쪽 칸의 정류장 줄은 kind busStop 노선 없음으로 칸을 정한다`() = runTest(dispatcher) {
        val e = env(Fakes(placesBody = places(), stopsReply = HttpResponse(200, stops(near))))
        e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
        e.search(DirectionsFieldTarget.alightStation, "가까")
        e.vm.selectStop(e.vm.picker.state.value!!.stops.single())
        assertNull(e.vm.picker.state.value)
        assertEquals(RecentStation("가까운", 37.539, 127.136, null, JourneyStationKind.busStop), e.vm.state.value.alightStation)
        assertEquals(LandingTarget.Field(DirectionsFieldTarget.alightStation), e.vm.state.value.landing?.target)
    }

    // ── 정류장 검색 조건 ──────────────────────────────────────────────────────

    @Test fun `정류장 검색은 2~30자이고 기준 좌표가 하나 이상일 때만 돈다`() = runTest(dispatcher) {
        val f = Fakes(placesBody = places(subwayJson), stopsReply = HttpResponse(200, stops(near)))
        // 도착 좌표만 아는 경우.
        val e = env(f)
        e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
        e.search(DirectionsFieldTarget.boardStation, "가")
        assertEquals(0, e.net.count("/api/route/journey/stops"), "한 글자는 부르지 않는다")
        assertTrue(e.vm.picker.state.value!!.stops.isEmpty())
        e.search(DirectionsFieldTarget.boardStation, "가".repeat(31))
        assertEquals(0, e.net.count("/api/route/journey/stops"), "31자는 부르지 않는다")
        e.search(DirectionsFieldTarget.boardStation, "가나")
        assertEquals(1, e.net.count("/api/route/journey/stops"))
        val q = e.net.query("/api/route/journey/stops")
        assertTrue("dest" in q && "origin" !in q, "출발이 현재 위치이고 위치를 모르면 도착만 싣는다: $q")
        e.search(DirectionsFieldTarget.boardStation, "가".repeat(30))
        assertEquals(2, e.net.count("/api/route/journey/stops"), "30자는 부른다")

        // 출발(현재 위치, 위치 모름)·도착 둘 다 모르면 부르지 않는다.
        val none = env(f)
        none.search(DirectionsFieldTarget.boardStation, "가나")
        assertEquals(0, none.net.count("/api/route/journey/stops"))
        // 현재 위치 출발은 위치 스토어의 마지막 좌표를 근거로 쓴다.
        val stored = env(f, stored = seoul)
        stored.search(DirectionsFieldTarget.boardStation, "가나")
        assertEquals(1, stored.net.count("/api/route/journey/stops"))
        assertTrue("origin" in stored.net.query("/api/route/journey/stops"))
    }

    @Test fun `정류장 검색의 3-state — 서비스 지역 밖은 조용히 비고, 던지면 실패 한 줄, 일부 실패와 미유도는 각자 말한다`() = runTest(dispatcher) {
        fun run(f: Fakes): EndpointSearchState {
            val e = env(f)
            e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
            e.search(DirectionsFieldTarget.boardStation, "가나")
            return e.vm.picker.state.value!!
        }
        // 서비스 지역 밖: 실패가 아니다.
        run(Fakes(placesBody = places(subwayJson), stopsReply = HttpResponse(200, """{"outOfCoverage":true}"""))).let {
            assertTrue(it.stops.isEmpty()); assertFalse(it.stopsFailed); assertEquals("검색 결과 1건을 찾았습니다.", it.notice.text)
        }
        // 던짐(500): 실패 한 줄 + 건수 뒤 문장 + 주의 진동.
        run(Fakes(placesBody = places(subwayJson), stopsReply = HttpResponse(500, ""))).let {
            assertTrue(it.stopsFailed)
            assertEquals("검색 결과 1건을 찾았습니다. 정류장을 불러오지 못했습니다.", it.notice.text)
            assertEquals(HapticKind.attention, it.notice.haptic)
        }
        // 서버가 일부 실패를 알림: 받은 줄은 그대로, 실패 줄이 선다.
        run(Fakes(placesBody = places(), stopsReply = HttpResponse(200, stops(near, extra = ""","failed":true""")))).let {
            assertEquals(1, it.stops.size); assertTrue(it.stopsFailed)
        }
        // 일부만 받음.
        run(Fakes(placesBody = places(), stopsReply = HttpResponse(200, stops(near, extra = ""","truncated":true""")))).let {
            assertTrue(it.stopsTruncated); assertFalse(it.stopsFailed)
        }
        // 대상 지역을 못 정함: 장소·정류장이 둘 다 0건일 때만 정류소 정보 없음 문장이 선다. 0건 문장은 그대로 있다.
        run(Fakes(placesBody = places(), stopsReply = HttpResponse(200, """{"stops":[],"unsearched":true}"""))).let {
            assertTrue(it.showsNoBusData)
            assertEquals("검색 결과가 없습니다. 이 지역은 정류소 정보가 제공되지 않습니다", it.notice.text)
        }
        run(Fakes(placesBody = places(subwayJson), stopsReply = HttpResponse(200, """{"stops":[],"unsearched":true}"""))).let {
            assertFalse(it.showsNoBusData, "장소가 있으면 말하지 않는다")
        }
        // 장소 검색이 실패했는데 정류장이 있다: 역 줄이 없는 이유를 밝힌다(조회 실패 ≠ 역 없음).
        run(Fakes(placesBody = "", placesStatus = 500, stopsReply = HttpResponse(200, stops(near)))).let {
            assertTrue(it.showsPlacesFailure)
            assertEquals("검색 결과 1건을 찾았습니다. 검색에 실패했습니다.", it.notice.text)
        }
        // 장소 실패 + 정류장 0건: 실패 문장 하나(0건으로 뭉개지 않는다).
        run(Fakes(placesBody = "", placesStatus = 500)).let {
            assertFalse(it.showsPlacesFailure)
            assertEquals("검색에 실패했습니다.", it.notice.text)
            assertEquals(HapticKind.failure, it.notice.haptic)
        }
    }

    // ── 입구 검색(transfer) ───────────────────────────────────────────────────

    @Test fun `입구 검색은 경유지 최근 목록과 주소 후보와 정류장 줄을 모두 낸다`() = runTest(dispatcher) {
        val store = RecentSearchStore(InMemoryKeyValueStore())
        store.recordEndpoint(RecentEndpoint("경유 단골", 37.5, 127.1), RecentEndpointScope.via)
        store.recordEndpoint(RecentEndpoint("도착 단골", 37.5, 127.1), RecentEndpointScope.to)
        val e = env(Fakes(placesBody = places(cafeJson, subwayJson), addrBody = oneAddr, stopsReply = HttpResponse(200, stops(near))), store = store)
        e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
        e.vm.openPicker(DirectionsFieldTarget.transfer); idle()
        assertEquals(listOf("경유 단골"), e.vm.picker.state.value!!.recentEndpoints.map { it.label })
        e.vm.picker.state.value!!.queryState.setTextAndPlaceCursorAtEnd("가나")
        e.vm.submitCandidates(); idle()
        val s = e.vm.picker.state.value!!
        assertEquals(listOf("c1", "s1"), s.selectablePlaces.map { it.id }, "입구 검색은 장소를 거르지 않는다")
        assertTrue(s.otherPlaces.isEmpty())
        assertEquals(1, s.addresses.size)
        assertEquals(1, s.stops.size)
        assertEquals("검색 결과 4건을 찾았습니다.", s.notice.text)
    }

    @Test fun `입구 검색의 역 장소는 확정하지 않고 질문 대기에 담는다 — 수단 낱말과 짐작을 정해 둔다`() = runTest(dispatcher) {
        val e = env(Fakes(placesBody = places(subwayJson, railJson)))
        // 출발은 현재 위치(위치 모름) → 짐작은 board.
        e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
        e.search(DirectionsFieldTarget.transfer, "가나")
        e.vm.selectPlace(e.vm.picker.state.value!!.places.first { it.id == "s1" })
        assertNull(e.vm.picker.state.value, "시트는 닫힌다")
        val ask = e.vm.state.value.pendingTransfer
        assertEquals(PendingTransfer(RecentStation("가나역 2호선", 37.5573, 126.956, "수도권2호선", null), JourneyTransferMode.subway, JourneyTransferSide.board), ask)
        assertNull(e.vm.state.value.via, "확정하지 않는다")
        assertNull(e.vm.state.value.boardStation)
        assertEquals("자동차로 이동하다가 가나역에서 지하철로 환승하실 예정인가요?", e.vm.transferQuestionText())

        // 기차역은 rail, 도착지에 더 가깝고 출발을 알면 alight.
        val e2 = env(Fakes(placesBody = places(railJson)))
        e2.vm.setEndpoint(DirectionsEndpoint.Place("먼 출발", 35.0, 127.0), DirectionsFieldTarget.from)
        e2.vm.setEndpoint(DirectionsEndpoint.Place("가까운 도착", 37.58, 126.98), DirectionsFieldTarget.to)
        e2.search(DirectionsFieldTarget.transfer, "다라")
        e2.vm.selectPlace(e2.vm.picker.state.value!!.places.single())
        assertEquals(JourneyTransferMode.rail, e2.vm.state.value.pendingTransfer!!.mode)
        assertEquals(JourneyTransferSide.alight, e2.vm.state.value.pendingTransfer!!.guess)
        assertEquals("기차를 이용하다가 다라역에서 내려 자동차로 환승하실 예정인가요?", e2.vm.transferQuestionText())
    }

    @Test fun `입구 검색의 역이 아닌 장소는 종전 경유지 확정이고 전화번호를 적는다`() = runTest(dispatcher) {
        val e = env(Fakes(placesBody = places(cafeJson)))
        e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
        e.search(DirectionsFieldTarget.transfer, "마바")
        e.vm.selectPlace(e.vm.picker.state.value!!.places.single())
        assertNull(e.vm.picker.state.value)
        assertNull(e.vm.state.value.pendingTransfer)
        assertEquals(DirectionsEndpoint.Place("마바 카페", 37.55, 126.99, null), e.vm.state.value.via)
        assertEquals("02-1234-5678", e.phoneBook.phone("마바 카페", 37.55, 126.99))
        // 착지는 종전 경유지 확정과 같은 조회 버튼이다(iOS `applyResolvedFocus` — 도착지·경유지를 고르면 조회 버튼으로).
        assertEquals(LandingTarget.Submit, e.vm.state.value.landing?.target)
    }

    @Test fun `입구 검색의 정류장 줄은 bus 질문 대상이다`() = runTest(dispatcher) {
        val e = env(Fakes(placesBody = places(), stopsReply = HttpResponse(200, stops(stopJson("마바", 37.55, 126.99)))))
        e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
        e.search(DirectionsFieldTarget.transfer, "마바")
        e.vm.selectStop(e.vm.picker.state.value!!.stops.single())
        val ask = e.vm.state.value.pendingTransfer!!
        assertEquals(JourneyTransferMode.bus, ask.mode)
        assertEquals(RecentStation("마바", 37.55, 126.99, null, JourneyStationKind.busStop), ask.station)
        assertEquals("자동차로 이동하다가 마바 정류장에서 버스로 환승하실 예정인가요?", e.vm.transferQuestionText())
    }

    // ── 답·취소 ───────────────────────────────────────────────────────────────

    /** 질문 대기까지 가는 가장 짧은 길 — 시트에서 입구 검색의 역을 고르는 것과 같은 훅(`onSelectTransfer`)을 부른다. */
    private fun Env.ask(mode: JourneyTransferMode = JourneyTransferMode.subway) = vm.picker.journey!!.invoke().onSelectTransfer(ga, mode)

    @Test fun `답 네 갈래 — 승차 쪽 칸·하차 쪽 칸·경유만, 대기를 비우고 착지를 낸다`() = runTest(dispatcher) {
        // 승차 쪽(board=true).
        env(Fakes()).let { e ->
            e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
            e.ask()
            assertEquals(LandingTarget.Field(DirectionsFieldTarget.boardStation), e.vm.answerTransfer(true))
            assertEquals(ga, e.vm.state.value.boardStation); assertNull(e.vm.state.value.alightStation); assertNull(e.vm.state.value.pendingTransfer)
            assertEquals(LandingTarget.Field(DirectionsFieldTarget.boardStation), e.vm.state.value.landing?.target)
            assertNull(e.vm.answerTransfer(true), "대기가 비었으면 무동작(멱등)")
        }
        // 하차 쪽(board=false).
        env(Fakes()).let { e ->
            e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
            e.ask()
            assertEquals(LandingTarget.Field(DirectionsFieldTarget.alightStation), e.vm.answerTransfer(false))
            assertEquals(ga, e.vm.state.value.alightStation); assertNull(e.vm.state.value.boardStation)
        }
        // 경유만(null): 경유지로 두고 역 칸은 건드리지 않는다.
        env(Fakes()).let { e ->
            e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
            e.ask()
            assertEquals(LandingTarget.Field(DirectionsFieldTarget.via), e.vm.answerTransfer(null))
            assertEquals(DirectionsEndpoint.Place("가나역", 37.5573, 126.956, null), e.vm.state.value.via)
            assertNull(e.vm.state.value.boardStation); assertNull(e.vm.state.value.alightStation); assertNull(e.vm.state.value.pendingTransfer)
        }
    }

    @Test fun `취소는 아무것도 바꾸지 않고 대기만 비우며 입구 버튼으로 착지한다 — 두 번째는 무동작`() = runTest(dispatcher) {
        val e = env(Fakes())
        e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
        val before = e.vm.state.value
        e.ask()
        e.vm.cancelTransfer()
        val after = e.vm.state.value
        assertNull(after.pendingTransfer)
        assertEquals(before.from, after.from); assertEquals(before.to, after.to); assertNull(after.via)
        assertNull(after.boardStation); assertNull(after.alightStation); assertNull(after.aboardOrigin)
        assertEquals(LandingTarget.Field(DirectionsFieldTarget.via), after.landing?.target)
        val seq = after.landing!!.seq
        e.vm.cancelTransfer()
        assertEquals(seq, e.vm.state.value.landing!!.seq, "멱등")
    }

    @Test fun `다른 칸의 시트를 열면 답 없는 질문은 버려진다`() = runTest(dispatcher) {
        val e = env(Fakes())
        e.ask()
        assertNotNull(e.vm.state.value.pendingTransfer)
        e.vm.openPicker(DirectionsFieldTarget.to); idle()
        assertNull(e.vm.state.value.pendingTransfer)
        assertEquals("", e.vm.transferQuestionText())
        assertTrue(e.vm.transferQuestionButtons().isEmpty())
    }

    // ── 지금 탄 열차 검색 ─────────────────────────────────────────────────────

    @Test fun `지금 탄 열차 행은 출발지 칸에서 데이터 로케일이 ko일 때만 선다`() = runTest(dispatcher) {
        val ko = env(Fakes())
        ko.vm.openPicker(DirectionsFieldTarget.from); idle()
        assertTrue(ko.vm.picker.state.value!!.aboardOffered)
        ko.vm.closePicker()
        ko.vm.openPicker(DirectionsFieldTarget.to); idle()
        assertFalse(ko.vm.picker.state.value!!.aboardOffered, "도착지에는 없다")

        val en = env(Fakes(), lang = "en")
        en.vm.openPicker(DirectionsFieldTarget.from); idle()
        assertFalse(en.vm.picker.state.value!!.aboardOffered, "ko 밖은 행이 없다")
        en.vm.startAboardSearch()
        assertFalse(en.vm.picker.state.value!!.aboardMode, "행이 없으면 모드로 못 들어간다")
    }

    @Test fun `지금 탄 열차 검색 — 후보·최근·주소·정류장을 비우고 지하철역만 받는다`() = runTest(dispatcher) {
        val store = RecentSearchStore(InMemoryKeyValueStore())
        store.recordEndpoint(RecentEndpoint("집", 37.5, 127.1), RecentEndpointScope.from)
        val e = env(Fakes(placesBody = places(subwayJson, railJson, cafeJson), addrBody = oneAddr, stopsReply = HttpResponse(200, stops(near))), store = store)
        e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
        e.search(DirectionsFieldTarget.from, "가나")
        assertEquals(1, e.vm.picker.state.value!!.addresses.size, "일반 출발지 검색에는 주소가 있다")
        e.vm.startAboardSearch()
        val s0 = e.vm.picker.state.value!!
        assertTrue(s0.aboardMode)
        assertTrue(s0.places.isEmpty() && s0.addresses.isEmpty() && s0.stops.isEmpty())
        assertFalse(s0.hasSearched)
        assertEquals("", s0.queryState.text.toString(), "입력을 비운다")
        assertFalse(s0.searchesStops)

        s0.queryState.setTextAndPlaceCursorAtEnd("가나")
        e.vm.submitCandidates(); idle()
        assertEquals(0, e.net.count("/api/route/journey/stops"), "정류장 검색을 하지 않는다")
        val s = e.vm.picker.state.value!!
        assertTrue(s.addresses.isEmpty())
        assertEquals(listOf("s1", "r1"), s.selectablePlaces.map { it.id })
        assertEquals(listOf("c1"), s.otherPlaces.map { it.id })
        e.vm.selectCurrent()
        assertNotNull(e.vm.picker.state.value, "지금 탄 열차 검색에서는 현재 위치 사용이 동작하지 않는다")
        assertEquals(DirectionsEndpoint.Current, e.vm.state.value.from)
    }

    @Test fun `지하철이 아니면 시트에 남고 지하철역을 골라 달라는 통지, 지하철이면 출발이 그 역이 되고 방면 단계 착지`() = runTest(dispatcher) {
        val e = env(Fakes(placesBody = places(subwayJson, railJson, cafeJson)))
        e.vm.setEndpoint(gangnam, DirectionsFieldTarget.to)
        e.vm.openPicker(DirectionsFieldTarget.from); idle()
        e.vm.startAboardSearch()
        e.vm.picker.state.value!!.queryState.setTextAndPlaceCursorAtEnd("가나")
        e.vm.submitCandidates(); idle()
        // 기차역·그 밖 장소 모두 거절.
        for (id in listOf("r1", "c1")) {
            e.vm.selectPlace(e.vm.picker.state.value!!.places.first { it.id == id })
            val s = e.vm.picker.state.value
            assertNotNull(s, "$id: 시트에 남는다")
            assertEquals("지하철역을 골라 주세요.", s.notice.text)
            assertEquals(HapticKind.attention, s.notice.haptic)
            assertNull(e.vm.state.value.aboardOrigin)
        }
        e.vm.selectPlace(e.vm.picker.state.value!!.places.first { it.id == "s1" })
        assertNull(e.vm.picker.state.value, "닫힌다")
        idle()
        val aboard = e.vm.state.value.aboardOrigin
        assertEquals(RecentStation("가나역 2호선", 37.5573, 126.956, "수도권2호선", null), aboard?.station)
        assertEquals(LandingTarget.AboardStep, e.vm.state.value.landing?.target)
        assertEquals(DirectionsEndpoint.Place("가나역 2호선", 37.5573, 126.956, null), e.vm.state.value.from)
    }

    @Test fun `ko 밖에서는 지금 탄 열차 콜백이 없어 aboard 확정이 일어나지 않는다`() = runTest(dispatcher) {
        val e = env(Fakes(), lang = "en")
        assertNull(e.vm.picker.journey!!.invoke().onSelectAboardStation)
        assertNotNull(env(Fakes()).vm.picker.journey!!.invoke().onSelectAboardStation)
    }
}

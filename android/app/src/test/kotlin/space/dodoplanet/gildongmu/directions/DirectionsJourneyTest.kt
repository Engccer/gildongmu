package space.dodoplanet.gildongmu.directions

import androidx.lifecycle.SavedStateHandle
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.a11y.HapticKind
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.HttpTransport
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.JourneyAboardDirection
import space.dodoplanet.gildongmu.kit.JourneyStationKind
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.PlacePhoneBook
import space.dodoplanet.gildongmu.kit.RecentEndpoint
import space.dodoplanet.gildongmu.kit.RecentRoute
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.RecentStation
import space.dodoplanet.gildongmu.kit.RouteService
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.StationService
import space.dodoplanet.gildongmu.kit.pathOf
import space.dodoplanet.gildongmu.kit.queryOf
import space.dodoplanet.gildongmu.location.LocationException
import space.dodoplanet.gildongmu.location.StaleFix
import java.net.URLDecoder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** B26 단계 4: 길찾기 여정 모델(iOS `DirectionsModel` 여정 몫)을 JVM에서 잠근다. 전송은 스텁, 문장은 실제 카탈로그. */
@OptIn(ExperimentalCoroutinesApi::class)
class DirectionsJourneyTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private val ko = CatalogStrings("ko")
    private val seoul = NearbyCoord(37.5385, 127.1355)
    private val gangnam = DirectionsEndpoint.Place("강남역", 37.4979, 127.0276)
    private val cheonho = DirectionsEndpoint.Place("천호역", 37.5386, 127.1237)

    // 중립 값(가나역·다라역·마바 정류장).
    private val ga = RecentStation("가나역", 37.5573, 126.956, "2호선", null)
    private val da = RecentStation("다라역", 37.5714, 126.9767, null, null)
    private val stop = RecentStation("마바 정류장", 37.55, 126.99, null, JourneyStationKind.busStop)
    private val gangdong = RecentStation("강동역", 37.5359, 127.1324, "5호선", null)
    private val gangdongNoHint = RecentStation("강동역", 37.5359, 127.1324, null, null)

    private val transitBody = Fixtures.kit("route-transit.json")
    private val walkRoute = Fixtures.kit("route-walk.json").substringAfter("\"result\":").trimEnd().removeSuffix("}")
    private val walkBody = """{"lines":[{"kind":"shortest","route":$walkRoute}]}"""
    private val carBody = Fixtures.kit("route-car.json")
    private val journeyFound = Fixtures.kit("journey-result.json")
    private val journeyEmpty = """{"variants":[]}"""
    private val journeyOpposite = """{"variants":[],"designatedMissing":{"side":"board","oppositeDirection":true}}"""
    private val outOfCoverage = """{"outOfCoverage":true}"""
    private val gangdongArrivals = Fixtures.kit("station-arrival.json")

    private fun arrival(line: String?, direction: String, nm: String, dest: String) =
        """{${if (line != null) "\"line\":\"$line\"," else ""}"direction":"$direction","trainLineNm":"$nm","destination":"$dest","message":"곧 도착","arrivalSeconds":60,"express":false}"""

    private fun arrivals(vararg items: String) = """{"arrivals":{"stationName":"가나","arrivals":[${items.joinToString(",")}]}}"""

    private class Net(val handler: suspend (String, String) -> HttpResponse) : HttpTransport {
        val seen = ArrayList<String>()
        override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
            seen += url
            return handler(pathOf(url), url)
        }
        fun count(path: String) = seen.count { pathOf(it) == path }
        fun last(path: String) = seen.last { pathOf(it) == path }
        fun params(path: String): Map<String, String> =
            queryOf(last(path)).split('&').filter { it.isNotEmpty() }.associate {
                it.substringBefore('=') to URLDecoder.decode(it.substringAfter('=', ""), "UTF-8")
            }
    }

    private var journeyReply: suspend (String) -> HttpResponse = { HttpResponse(200, journeyFound) }
    private var arrivalsReply: suspend (String) -> HttpResponse = { HttpResponse(200, gangdongArrivals) }

    private fun net() = Net { path, url ->
        when (path) {
            "/api/route/journey" -> journeyReply(url)
            "/api/station/subway-arrival" -> arrivalsReply(url)
            "/api/route/transit" -> HttpResponse(200, transitBody)
            "/api/route/walk" -> HttpResponse(200, walkBody)
            "/api/route/car" -> HttpResponse(200, carBody)
            else -> HttpResponse(404, "")
        }
    }

    private fun vm(
        net: Net,
        store: RecentSearchStore = RecentSearchStore(InMemoryKeyValueStore()),
        lang: String = "ko",
        stale: StaleFix? = null,
        failLocation: Boolean = false,
    ): DirectionsViewModel {
        val client = APIClient("https://example.test", net)
        val locator = object : EndpointLocator {
            override suspend fun currentCoordinate(force: Boolean): NearbyCoord {
                if (failLocation) throw LocationException(LocationException.Kind.Unavailable)
                return seoul
            }
            override suspend fun coordinateForRanking(): NearbyCoord? = null
            override suspend fun coordinateForDisplay(): NearbyCoord? = null
            override fun staleFix(): StaleFix? = stale
            override fun storedCoordinate(): NearbyCoord? = null
            override suspend fun requestPreciseLocation() = false
        }
        return DirectionsViewModel(
            RouteService(client), SearchService(client), StationService(client), store, locator, { lang }, ko, SavedStateHandle(),
            PlacePhoneBook(InMemoryKeyValueStore()),
            prefill = MutableStateFlow(null), takePrefill = { false }, io = dispatcher,
            guideFormPending = MutableStateFlow(null),
            takeGuideDestination = { null }, takeGuideWaypoint = { null },
        )
    }

    private fun run(m: DirectionsViewModel) {
        m.runQuery()
        dispatcher.scheduler.advanceUntilIdle()
    }

    // ── 배타 규칙 ────────────────────────────────────────────────────────────

    @Test fun `역 칸을 세우면 경유지를 비운다`() = runTest(dispatcher) {
        val m = vm(net())
        m.setVia(cheonho)
        m.setJourneyStation(ga, board = true)
        m.setJourneyStation(da, board = false)
        val s = m.state.value
        assertNull(s.via)
        assertEquals(ga, s.boardStation)
        assertEquals(da, s.alightStation)
        assertTrue(s.hasJourneyStations)
    }

    @Test fun `경유지를 세우면 두 역 칸과 지금 탄 열차를 비운다`() = runTest(dispatcher) {
        val m = vm(net())
        m.setJourneyStation(ga, true)
        m.setJourneyStation(da, false)
        m.setVia(cheonho)
        assertNull(m.state.value.boardStation)
        assertNull(m.state.value.alightStation)
        assertEquals(cheonho, m.state.value.via)
        m.startAboard(gangdong)
        dispatcher.scheduler.advanceUntilIdle()
        m.setVia(cheonho)
        assertNull(m.state.value.aboardOrigin)
        assertEquals(AboardDirectionsState.Idle, m.state.value.aboardDirectionsState)
        assertEquals(DirectionsEndpoint.Current, m.state.value.from, "지금 탄 열차를 풀면 출발지는 현재 위치로 돌아간다")
    }

    @Test fun `승차 쪽 역 칸은 지금 탄 열차를 푼다 - 하차 쪽은 그대로`() = runTest(dispatcher) {
        val m = vm(net())
        m.startAboard(gangdong)
        dispatcher.scheduler.advanceUntilIdle()
        m.setJourneyStation(da, board = false)
        assertNotNull(m.state.value.aboardOrigin, "역 B(하차 쪽)는 지금 탄 열차와 함께 쓴다")
        m.setJourneyStation(ga, board = true)
        assertNull(m.state.value.aboardOrigin)
        assertEquals(ga, m.state.value.boardStation)
        assertEquals(da, m.state.value.alightStation)
    }

    @Test fun `지금 탄 열차는 경유지와 역 A를 비우고 역 B는 둔다`() = runTest(dispatcher) {
        val m = vm(net())
        m.setJourneyStation(ga, true)
        m.setJourneyStation(da, false)
        m.startAboard(gangdong)
        val s = m.state.value
        assertNull(s.via)
        assertNull(s.boardStation)
        assertEquals(da, s.alightStation)
        assertEquals("강동역", (s.from as DirectionsEndpoint.Place).label)
        assertEquals(AboardOrigin(gangdong, "5호선", null), s.aboardOrigin)
    }

    @Test fun `출발지 끝점을 고르면 지금 탄 열차를 푼다 - 도착지는 건드리지 않는다`() = runTest(dispatcher) {
        val m = vm(net())
        m.startAboard(gangdong)
        dispatcher.scheduler.advanceUntilIdle()
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        assertNotNull(m.state.value.aboardOrigin)
        m.setEndpoint(cheonho, DirectionsFieldTarget.from)
        assertNull(m.state.value.aboardOrigin)
        assertEquals(cheonho, m.state.value.from)
    }

    @Test fun `swap은 역 칸도 맞바꾼다 - 지금 탄 열차면 아무것도 안 한다`() = runTest(dispatcher) {
        val m = vm(net())
        m.setEndpoint(cheonho, DirectionsFieldTarget.from)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.setJourneyStation(ga, true)
        m.setJourneyStation(da, false)
        m.swap()
        val s = m.state.value
        assertEquals(gangnam, s.from)
        assertEquals(cheonho, s.to)
        assertEquals(da, s.boardStation)
        assertEquals(ga, s.alightStation)

        val a = vm(net())
        a.setEndpoint(gangnam, DirectionsFieldTarget.to)
        a.startAboard(gangdong)
        dispatcher.scheduler.advanceUntilIdle()
        val before = a.state.value
        a.swap()
        assertEquals(before, a.state.value)
    }

    @Test fun `setJourneyStations는 두 칸을 함께 정하고 없는 쪽은 비운다 - clear 둘`() = runTest(dispatcher) {
        val m = vm(net())
        m.setVia(cheonho)
        m.setJourneyStations(ga, null)
        assertNull(m.state.value.via)
        assertEquals(ga, m.state.value.boardStation)
        m.setJourneyStations(null, da)
        assertNull(m.state.value.boardStation)
        assertEquals(da, m.state.value.alightStation)
        m.setJourneyStations(ga, da)
        m.clearJourneyStation(board = true)
        assertNull(m.state.value.boardStation)
        assertEquals(da, m.state.value.alightStation)
        m.clearJourneyStations()
        assertFalse(m.state.value.hasJourneyStations)
    }

    @Test fun `필드가 바뀌면 여정 결과를 폐기한다`() = runTest(dispatcher) {
        val m = vm(net())
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.setJourneyStation(ga, true)
        run(m)
        assertTrue(m.state.value.journeyFound)
        m.clearJourneyStation(board = true)
        assertNull(m.state.value.journeyOutcome)
    }

    // ── 게이트 ───────────────────────────────────────────────────────────────

    @Test fun `ko 밖에서는 역 칸이 있어도 여정 조회가 가지 않고 세 수단으로 간다`() = runTest(dispatcher) {
        val n = net()
        val m = vm(n, lang = "en")
        assertFalse(m.journeyInputEnabled)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.setJourneyStation(ga, true)
        run(m)
        assertEquals(0, n.count("/api/route/journey"))
        assertEquals(1, n.count("/api/route/transit"))
        assertNull(m.state.value.journeyOutcome)
    }

    @Test fun `ko 밖에서 지금 탄 열차는 조회하지 않고 최근 경로에도 남기지 않는다`() = runTest(dispatcher) {
        val n = net()
        val store = RecentSearchStore(InMemoryKeyValueStore())
        val m = vm(n, store = store, lang = "en")
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.startAboard(gangdong)
        dispatcher.scheduler.advanceUntilIdle()
        m.chooseAboardDirection((m.state.value.aboardDirectionsState as AboardDirectionsState.Loaded).directions.first())
        run(m)
        assertEquals(0, n.count("/api/route/journey"))
        assertEquals(0, n.count("/api/route/transit"))
        assertEquals(DirectionsPhase.Idle, m.state.value.phase)
        assertEquals(emptyList(), store.routes())
    }

    @Test fun `로케일이 ko 밖으로 바뀌면 지금 탄 열차를 푼다`() = runTest(dispatcher) {
        val m = vm(net())
        m.startAboard(gangdong)
        dispatcher.scheduler.advanceUntilIdle()
        m.onJourneyInputEnabledChanged(true)
        assertNotNull(m.state.value.aboardOrigin)
        m.onJourneyInputEnabledChanged(false)
        assertNull(m.state.value.aboardOrigin)
        assertEquals(DirectionsEndpoint.Current, m.state.value.from)
    }

    // ── performJourney ───────────────────────────────────────────────────────

    @Test fun `찾음 - 합산 문장·진동·기록·세대 - 착지 요청은 없다`() = runTest(dispatcher) {
        val n = net()
        val store = RecentSearchStore(InMemoryKeyValueStore())
        val m = vm(n, store = store)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.setJourneyStation(ga, true)
        m.setJourneyStation(stop, false)
        m.runQuery()
        assertEquals(DirectionsPhase.Locating, m.state.value.phase)
        dispatcher.scheduler.advanceUntilIdle()
        val s = m.state.value
        assertIs<JourneyQueryOutcome.Found>(s.journeyOutcome)
        assertEquals(DirectionsPhase.Settled(1), s.phase)
        assertEquals("1개 수단의 경로 안내가 준비되었습니다.", s.notice.text)
        assertEquals(HapticKind.success, s.notice.haptic)
        assertEquals(1, s.resultsRevision)
        assertEquals(0, s.journeyVariantIndex)
        assertNull(s.results, "여정은 세 수단 결과를 만들지 않는다")
        assertNull(s.landing, "조회 완료에 착지 요청을 새로 만들지 않는다")
        assertEquals(0, n.count("/api/route/transit"))
        val saved = store.routes().single()
        assertEquals(ga, saved.boardStation)
        assertEquals(stop, saved.alightStation)
        assertNull(saved.from)
        assertEquals("강남역", saved.to?.label)
        assertEquals(saved, s.recentRoutes.single())
    }

    @Test fun `조회 인자 - 역은 라벨·노선·좌표 정류장은 kind`() = runTest(dispatcher) {
        val n = net()
        val m = vm(n)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.setJourneyStation(ga, true)
        m.setJourneyStation(stop, false)
        run(m)
        val q = n.params("/api/route/journey")
        assertEquals("가나역", q["boardName"])
        assertEquals("2호선", q["boardLine"])
        assertNull(q["boardKind"])
        assertEquals("마바 정류장", q["alightName"])
        assertEquals("stop", q["alightKind"])
        assertNull(q["alightLine"])
        assertEquals("1", q["stops"])
        assertTrue(q.containsKey("origin") && q.containsKey("dest"))
    }

    @Test fun `경로 없음과 조회 실패는 결과를 만들지 않고 상태 줄이 말한다`() = runTest(dispatcher) {
        val n = net()
        val store = RecentSearchStore(InMemoryKeyValueStore())
        val m = vm(n, store = store)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.setJourneyStation(ga, true)
        journeyReply = { HttpResponse(200, journeyEmpty) }
        run(m)
        var s = m.state.value
        assertEquals(JourneyQueryOutcome.NoRoute, s.journeyOutcome)
        assertEquals(DirectionsPhase.Settled(0), s.phase)
        assertEquals("대중교통 경로를 찾지 못했습니다.", s.notice.text)
        assertEquals(HapticKind.failure, s.notice.haptic)
        assertNull(s.results)

        journeyReply = { HttpResponse(500, "") }
        run(m)
        s = m.state.value
        assertEquals(JourneyQueryOutcome.Failed, s.journeyOutcome)
        assertEquals("경로를 불러오지 못했습니다.", s.notice.text)
        assertEquals(2, s.resultsRevision)
        assertEquals(emptyList(), store.routes(), "찾지 못한 조회는 최근 경로에 남기지 않는다")
    }

    @Test fun `서비스 지역 밖 응답은 기존 대중교통 조회와 같은 갈래다`() = runTest(dispatcher) {
        val m = vm(net())
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.setJourneyStation(ga, true)
        journeyReply = { HttpResponse(200, outOfCoverage) }
        run(m)
        val s = m.state.value
        assertEquals(DirectionsPhase.OutOfCoverage, s.phase)
        assertNull(s.journeyOutcome)
        assertEquals(ko.get("android.common.outOfCoverage"), s.notice.text)
    }

    @Test fun `재조회 시작이 이전 여정 결과를 비운다`() = runTest(dispatcher) {
        val m = vm(net())
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.setJourneyStation(ga, true)
        run(m)
        assertTrue(m.state.value.journeyFound)
        journeyReply = { delay(5_000); HttpResponse(200, journeyFound) }
        m.runQuery()
        dispatcher.scheduler.runCurrent()
        assertNull(m.state.value.journeyOutcome)
        dispatcher.scheduler.advanceUntilIdle()
        assertTrue(m.state.value.journeyFound)
    }

    @Test fun `옛 위치로 찾으면 합산 문장 뒤에 옛 위치 문장이 붙는다`() = runTest(dispatcher) {
        val m = vm(net(), stale = StaleFix(37.5, 127.0, 1_000.0), failLocation = true)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.setJourneyStation(ga, true)
        run(m)
        val s = m.state.value
        assertTrue(s.journeyFound)
        assertTrue(s.notice.text.startsWith("1개 수단의 경로 안내가 준비되었습니다. "), s.notice.text)
        assertTrue(s.resultsOriginNeedsStartNotice)
    }

    @Test fun `변형 고르기 - 범위 밖은 무시하고 출구 선택은 처음으로`() = runTest(dispatcher) {
        val m = vm(net())
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.setJourneyStation(ga, true)
        run(m)
        val count = (m.state.value.journeyOutcome as JourneyQueryOutcome.Found).result.variants.size
        m.selectJourneyEgress(1)
        assertEquals(1, m.state.value.journeyEgressIndex)
        m.selectJourneyVariant(count)
        assertEquals(1, m.state.value.journeyEgressIndex, "범위 밖 변형은 무시한다")
        m.selectJourneyVariant(0)
        assertEquals(0, m.state.value.journeyEgressIndex)
    }

    // ── 지금 탄 열차: 조회 ────────────────────────────────────────────────────

    private fun loadedDirections(m: DirectionsViewModel) = (m.state.value.aboardDirectionsState as AboardDirectionsState.Loaded).directions

    @Test fun `방면 조회 - 노선 힌트가 있으면 그 노선의 방면 묶음`() = runTest(dispatcher) {
        val n = net()
        val m = vm(n)
        m.startAboard(gangdong)
        assertEquals(AboardDirectionsState.Loading, m.state.value.aboardDirectionsState)
        assertEquals("열차 정보를 불러오는 중입니다.", m.aboardStepText())
        dispatcher.scheduler.advanceUntilIdle()
        val directions = loadedDirections(m)
        assertEquals(listOf("상행", "하행"), directions.map { it.direction })
        assertEquals(listOf("천호(풍납토성)방면", "길동방면"), directions.map { it.name })
        assertEquals("어느 방면 열차인가요?", m.aboardStepText())
        assertEquals("강동", n.params("/api/station/subway-arrival")["station"], "도착 조회는 역 표시 이름으로 한다")
        assertTrue(m.aboardNeedsDirection)
    }

    @Test fun `방면 조회 - 노선 힌트가 없고 노선이 하나면 그 노선으로 확정`() = runTest(dispatcher) {
        val m = vm(net())
        m.startAboard(gangdongNoHint)
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals("5호선", m.state.value.aboardOrigin?.line)
        assertEquals(2, loadedDirections(m).size)
    }

    @Test fun `방면 조회 - 노선이 둘이면 질문하고 고르면 방면 묶음`() = runTest(dispatcher) {
        arrivalsReply = {
            HttpResponse(
                200,
                arrivals(
                    arrival("1호선", "상행", "가행 - 나방면", "가"),
                    arrival("2호선", "내선", "다행 - 라방면", "다"),
                ),
            )
        }
        val m = vm(net())
        m.startAboard(gangdongNoHint)
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(AboardDirectionsState.Lines(listOf("1호선", "2호선")), m.state.value.aboardDirectionsState)
        assertNull(m.state.value.aboardOrigin?.line)
        assertEquals("어느 노선인가요?", m.aboardStepText())
        m.chooseAboardLine("2호선")
        assertEquals("2호선", m.state.value.aboardOrigin?.line)
        assertEquals(listOf("라방면"), loadedDirections(m).map { it.name })
        m.chooseAboardLine("1호선") // 이미 방면 단계 - 무시
        assertEquals("2호선", m.state.value.aboardOrigin?.line)
    }

    @Test fun `방면 조회 - 노선이 0개면 오는 열차 없음이고 다시 조회할 수 있다`() = runTest(dispatcher) {
        val n = net()
        arrivalsReply = { HttpResponse(200, arrivals()) }
        val m = vm(n)
        m.startAboard(gangdongNoHint)
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(AboardDirectionsState.Loaded(emptyList()), m.state.value.aboardDirectionsState)
        assertEquals("지금 이 역에 오는 열차가 조회되지 않습니다.", m.aboardStepText())
        arrivalsReply = { HttpResponse(200, gangdongArrivals) }
        m.retryAboardDirections()
        assertEquals(AboardDirectionsState.Loading, m.state.value.aboardDirectionsState)
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(2, loadedDirections(m).size)
        assertEquals(2, n.count("/api/station/subway-arrival"))
    }

    @Test fun `방면 조회 - 응답 null은 미제공이고 실패와 다르다 - 다시 조회 없음`() = runTest(dispatcher) {
        val n = net()
        arrivalsReply = { HttpResponse(200, """{"arrivals":null}""") }
        val m = vm(n)
        m.startAboard(gangdong)
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(AboardDirectionsState.Unavailable, m.state.value.aboardDirectionsState)
        assertEquals("이 역은 실시간 열차 정보가 없어 지금 탄 열차에서 출발할 수 없습니다.", m.aboardStepText())
        m.retryAboardDirections()
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(1, n.count("/api/station/subway-arrival"))
    }

    @Test fun `방면 조회 - 예외는 실패이고 새로고침이 다시 조회한다`() = runTest(dispatcher) {
        val n = net()
        arrivalsReply = { HttpResponse(500, "") }
        val m = vm(n)
        m.startAboard(gangdong)
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(AboardDirectionsState.Failed, m.state.value.aboardDirectionsState)
        assertEquals("열차 정보를 불러오지 못했습니다.", m.aboardStepText())
        arrivalsReply = { HttpResponse(200, gangdongArrivals) }
        m.retryAboardDirections()
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(2, loadedDirections(m).size)
    }

    @Test fun `방면 조회 - 15초 상한을 넘기면 실패`() = runTest(dispatcher) {
        arrivalsReply = { delay(20_000); HttpResponse(200, gangdongArrivals) }
        val m = vm(net())
        m.startAboard(gangdong)
        dispatcher.scheduler.advanceTimeBy(14_000)
        dispatcher.scheduler.runCurrent()
        assertEquals(AboardDirectionsState.Loading, m.state.value.aboardDirectionsState)
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(AboardDirectionsState.Failed, m.state.value.aboardDirectionsState)
    }

    @Test fun `방면 조회 - 새 지정이나 해제 뒤에 도착한 늦은 응답은 버린다`() = runTest(dispatcher) {
        arrivalsReply = { url ->
            if (url.contains("%EA%B0%95%EB%8F%99")) { delay(10_000); HttpResponse(200, gangdongArrivals) }
            else HttpResponse(200, arrivals(arrival("9호선", "상행", "가행 - 나방면", "가")))
        }
        val m = vm(net())
        m.startAboard(gangdong) // 강동: 늦게 온다
        dispatcher.scheduler.runCurrent()
        m.startAboard(RecentStation("다라역", 37.5, 127.0, null, null)) // 다라: 곧 온다
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals("9호선", m.state.value.aboardOrigin?.line)
        assertEquals(listOf("나방면"), loadedDirections(m).map { it.name })

        val n2 = vm(net())
        arrivalsReply = { delay(10_000); HttpResponse(200, gangdongArrivals) }
        n2.startAboard(gangdong)
        dispatcher.scheduler.runCurrent()
        n2.clearAboard()
        dispatcher.scheduler.advanceUntilIdle()
        assertNull(n2.state.value.aboardOrigin)
        assertEquals(AboardDirectionsState.Idle, n2.state.value.aboardDirectionsState)
    }

    @Test fun `방면 고르기 - 목록에 없는 방면은 무시하고 고르면 방면이 선다`() = runTest(dispatcher) {
        val m = vm(net())
        m.startAboard(gangdong)
        dispatcher.scheduler.advanceUntilIdle()
        m.chooseAboardDirection(JourneyAboardDirection("내선", "없는방면", emptyList()))
        assertTrue(m.aboardNeedsDirection)
        val pick = loadedDirections(m)[1]
        m.chooseAboardDirection(pick)
        assertEquals(pick, m.state.value.aboardOrigin?.direction)
        assertFalse(m.aboardNeedsDirection)
    }

    @Test fun `방면 전에는 조회하지 않는다 - 이어 하기는 이미 불러온 단계를 건드리지 않는다`() = runTest(dispatcher) {
        val n = net()
        val m = vm(n)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.startAboard(gangdong)
        dispatcher.scheduler.advanceUntilIdle()
        val phase = m.state.value.phase
        m.runQuery()
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(0, n.count("/api/route/journey"))
        assertEquals(phase, m.state.value.phase)
        m.resumeAboardDirections()
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(1, n.count("/api/station/subway-arrival"))
    }

    @Test fun `지금 탄 열차 조회 - 방향·노선·표시 이름을 싣고 최근 경로에는 남기지 않는다`() = runTest(dispatcher) {
        val n = net()
        val store = RecentSearchStore(InMemoryKeyValueStore())
        val m = vm(n, store = store)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.startAboard(gangdong)
        dispatcher.scheduler.advanceUntilIdle()
        m.chooseAboardDirection(loadedDirections(m).first { it.direction == "하행" })
        run(m)
        val q = n.params("/api/route/journey")
        assertEquals("강동", q["boardName"])
        assertEquals("5호선", q["boardLine"])
        assertEquals("aboard", q["boardKind"])
        assertEquals("하행", q["boardDir"])
        assertTrue(m.state.value.journeyFound)
        assertEquals(emptyList(), store.routes())
        assertEquals(emptyList(), m.state.value.recentRoutes)
        assertNotNull(m.state.value.aboardOrigin, "결과 뒤에도 지금 탄 열차는 서 있다")
    }

    @Test fun `지금 탄 열차의 경로 없음 - 반대 방향 갈래와 일반 갈래`() = runTest(dispatcher) {
        val m = vm(net())
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.startAboard(gangdong)
        dispatcher.scheduler.advanceUntilIdle()
        m.chooseAboardDirection(loadedDirections(m).first())
        journeyReply = { HttpResponse(200, journeyOpposite) }
        run(m)
        assertEquals(JourneyQueryOutcome.AboardNoRoute(true), m.state.value.journeyOutcome)
        assertEquals(true, m.state.value.journeyAboardNoRoute)
        assertEquals("지금 탄 열차는 목적지 반대 방향으로 갑니다.", m.state.value.notice.text)
        journeyReply = { HttpResponse(200, journeyEmpty) }
        run(m)
        assertEquals(JourneyQueryOutcome.AboardNoRoute(false), m.state.value.journeyOutcome)
        assertEquals("지금 탄 열차로 가는 경로를 찾지 못했습니다.", m.state.value.notice.text)
    }

    // ── 문장 ─────────────────────────────────────────────────────────────────

    @Test fun `역 칸 줄 - 칸 이름은 종류별`() = runTest(dispatcher) {
        val m = vm(net())
        m.setJourneyStation(ga, true)
        m.setJourneyStation(stop, false)
        assertEquals("자동차에서 내리는 역, 가나역", m.stationFieldText(board = true))
        assertEquals("자동차를 탈 정류장, 마바 정류장", m.stationFieldText(board = false))
        m.setJourneyStation(stop, true)
        m.setJourneyStation(da, false)
        assertEquals("자동차에서 내리는 정류장, 마바 정류장", m.stationFieldText(board = true))
        assertEquals("자동차를 탈 역, 다라역", m.stationFieldText(board = false))
    }

    @Test fun `출발지 칸 문장 - 지금 탄 열차는 역 이름과 방면 이름`() = runTest(dispatcher) {
        val m = vm(net())
        m.startAboard(gangdong)
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals("출발지, 지금 탄 열차, 강동역", m.fieldText(DirectionsFieldTarget.from, accessible = true, lang = "ko"))
        m.chooseAboardDirection(loadedDirections(m).first())
        assertEquals("출발지, 지금 탄 열차, 강동역, 천호(풍납토성)방면", m.fieldText(DirectionsFieldTarget.from, accessible = true, lang = "ko"))
    }

    @Test fun `방면 버튼 문장 - 종착이 없으면 방면 이름만`() = runTest(dispatcher) {
        val m = vm(net())
        assertEquals("길동방면", m.aboardDirectionRowText(JourneyAboardDirection("하행", "길동방면", emptyList())))
        assertEquals("길동방면, 마천행, 하남검단산행", m.aboardDirectionRowText(JourneyAboardDirection("하행", "길동방면", listOf("마천", "하남검단산"))))
    }

    @Test fun `단계 줄 문장 여섯 갈래`() {
        assertNull(aboardStepText(AboardDirectionsState.Idle, ko))
        assertEquals("열차 정보를 불러오는 중입니다.", aboardStepText(AboardDirectionsState.Loading, ko))
        assertEquals("어느 노선인가요?", aboardStepText(AboardDirectionsState.Lines(listOf("1호선", "2호선")), ko))
        assertEquals("지금 이 역에 오는 열차가 조회되지 않습니다.", aboardStepText(AboardDirectionsState.Loaded(emptyList()), ko))
        assertEquals("어느 방면 열차인가요?", aboardStepText(AboardDirectionsState.Loaded(listOf(JourneyAboardDirection("상행", "가방면", emptyList()))), ko))
        assertEquals("이 역은 실시간 열차 정보가 없어 지금 탄 열차에서 출발할 수 없습니다.", aboardStepText(AboardDirectionsState.Unavailable, ko))
        assertEquals("열차 정보를 불러오지 못했습니다.", aboardStepText(AboardDirectionsState.Failed, ko))
    }

    private fun route(board: RecentStation?, alight: RecentStation?) = RecentRoute(
        RecentEndpoint("출발", 37.5, 127.0), RecentEndpoint("도착", 37.6, 127.1), via = null, boardStation = board, alightStation = alight,
    )

    @Test fun `최근 경로 줄 - ko와 역이 있을 때만 여정 문장`() {
        assertEquals("출발에서 도착까지, 가나역에서 갈아타기", recentJourneyLabel(route(ga, null), "출발", "도착", true, ko))
        assertEquals("출발에서 도착까지, 다라역에서 갈아타기", recentJourneyLabel(route(null, da), "출발", "도착", true, ko))
        assertEquals("출발에서 도착까지, 가나역과 다라역에서 갈아타기", recentJourneyLabel(route(ga, da), "출발", "도착", true, ko))
        assertEquals("출발에서 도착까지, 마바 정류장에서 갈아타기", recentJourneyLabel(route(null, stop), "출발", "도착", true, ko))
        assertEquals("출발에서 도착까지, 가나역, 마바 정류장에서 갈아타기", recentJourneyLabel(route(ga, stop), "출발", "도착", true, ko))
        assertNull(recentJourneyLabel(route(null, null), "출발", "도착", true, ko))
        assertNull(recentJourneyLabel(route(ga, da), "출발", "도착", false, ko))
    }

    @Test fun `기존 최근 경로 줄에 여정 문장이 이어진다 - ko 밖은 보통 문장`() = runTest(dispatcher) {
        val withStations = route(ga, da)
        assertEquals("출발에서 도착까지, 가나역과 다라역에서 갈아타기", vm(net()).recentRouteLabel(withStations, "ko"))
        assertEquals(ko.get("recentRoutes.item", "출발", "도착"), vm(net(), lang = "en").recentRouteLabel(withStations, "en"))
        assertEquals(ko.get("recentRoutes.item", "출발", "도착"), vm(net()).recentRouteLabel(route(null, null), "ko"))
    }

    // ── 최근 경로 복원·고정 ───────────────────────────────────────────────────

    @Test fun `최근 경로 복원 - 역이 있으면 칸을 채워 여정으로 조회`() = runTest(dispatcher) {
        val n = net()
        val store = RecentSearchStore(InMemoryKeyValueStore())
        store.recordRoute(route(ga, da))
        val m = vm(n, store = store)
        dispatcher.scheduler.advanceUntilIdle()
        m.setVia(cheonho)
        m.activateRecentRoute(m.state.value.recentRoutes.single())
        dispatcher.scheduler.advanceUntilIdle()
        val s = m.state.value
        assertEquals(ga, s.boardStation)
        assertEquals(da, s.alightStation)
        assertNull(s.via)
        assertEquals(1, n.count("/api/route/journey"))
        assertTrue(s.journeyFound)
    }

    @Test fun `최근 경로 복원 - 역이 없으면 남은 칸을 비우고 보통 조회`() = runTest(dispatcher) {
        val n = net()
        val store = RecentSearchStore(InMemoryKeyValueStore())
        store.recordRoute(route(null, null))
        val m = vm(n, store = store)
        dispatcher.scheduler.advanceUntilIdle()
        m.setJourneyStation(ga, true)
        m.activateRecentRoute(m.state.value.recentRoutes.single())
        dispatcher.scheduler.advanceUntilIdle()
        assertFalse(m.state.value.hasJourneyStations)
        assertEquals(0, n.count("/api/route/journey"))
        assertEquals(1, n.count("/api/route/transit"))
    }

    @Test fun `최근 경로 복원 - ko 밖이면 역을 쓰지 않는다`() = runTest(dispatcher) {
        val n = net()
        val store = RecentSearchStore(InMemoryKeyValueStore())
        store.recordRoute(route(ga, da))
        val m = vm(n, store = store, lang = "en")
        dispatcher.scheduler.advanceUntilIdle()
        m.activateRecentRoute(m.state.value.recentRoutes.single())
        dispatcher.scheduler.advanceUntilIdle()
        assertFalse(m.state.value.hasJourneyStations)
        assertEquals(0, n.count("/api/route/journey"))
    }

    @Test fun `고정 토글이 역 필드를 보존한다 - 화면 목록도 저장소도`() = runTest(dispatcher) {
        val store = RecentSearchStore(InMemoryKeyValueStore())
        store.recordRoute(route(ga, stop))
        val m = vm(net(), store = store)
        dispatcher.scheduler.advanceUntilIdle()
        m.togglePinRecentRoute(m.state.value.recentRoutes.single())
        val shown = m.state.value.recentRoutes.single()
        assertTrue(shown.pinned)
        assertEquals(ga, shown.boardStation)
        assertEquals(stop, shown.alightStation)
        val saved = store.routes().single()
        assertTrue(saved.pinned)
        assertEquals(ga, saved.boardStation)
        assertEquals(stop, saved.alightStation)
    }

    @Test fun `옛 저장분 JSON(역 필드 없음)이 읽히고 여정 문장은 나오지 않는다`() = runTest(dispatcher) {
        val kv = InMemoryKeyValueStore()
        kv.putString("recentRoutes.v1", """[{"from":{"label":"출발","lat":37.5,"lng":127.0},"to":{"label":"도착","lat":37.6,"lng":127.1}}]""")
        val m = vm(net(), store = RecentSearchStore(kv))
        dispatcher.scheduler.advanceUntilIdle()
        val legacy = m.state.value.recentRoutes.single()
        assertNull(legacy.boardStation)
        assertNull(legacy.alightStation)
        assertEquals(ko.get("recentRoutes.item", "출발", "도착"), m.recentRouteLabel(legacy, "ko"))
    }

    // ── 문자열 표 ────────────────────────────────────────────────────────────

    @Test fun `여정 문장 키는 전부 매핑 표에 있고 카탈로그에서 풀린다`() {
        val keys = mapOf(
            "boardFieldStation" to 0, "boardFieldStop" to 0, "alightFieldStation" to 0, "alightFieldStop" to 0,
            "aboardField" to 1, "aboardFieldDirection" to 2, "aboardLinePrompt" to 0, "aboardDirectionPrompt" to 0,
            "aboardDirectionRow" to 2, "aboardTerminal" to 1, "aboardDirectionsLoading" to 0, "aboardDirectionsEmpty" to 0,
            "aboardDirectionsUnavailable" to 0, "aboardDirectionsFailed" to 0, "aboardMissing" to 0, "aboardOpposite" to 0,
            "stationPlace" to 1, "recentRoute" to 3, "recentRouteBoth" to 4, "recentRouteStop" to 3, "recentRouteBothPlaces" to 4,
        )
        assertEquals(21, keys.size)
        for ((k, argc) in keys) {
            val key = "android.journey.$k"
            assertNotNull(stringId(key), "매핑 없는 키는 실행 중 앱을 죽인다: $key")
            assertTrue(ko.get(key, *Array(argc) { "x" }).isNotEmpty())
        }
    }
}

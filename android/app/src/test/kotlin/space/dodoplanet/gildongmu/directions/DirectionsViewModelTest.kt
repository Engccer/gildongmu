package space.dodoplanet.gildongmu.directions

import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.lifecycle.SavedStateHandle
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.location.StaleFix
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import space.dodoplanet.gildongmu.kit.ManualFix
import space.dodoplanet.gildongmu.kit.ManualLocation
import space.dodoplanet.gildongmu.kit.ManualVerdict
import space.dodoplanet.gildongmu.kit.DirectionsMode
import space.dodoplanet.gildongmu.kit.DirectionsModeOutcome
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.HttpTransport
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.RecentEndpoint
import space.dodoplanet.gildongmu.kit.RecentEndpointScope
import space.dodoplanet.gildongmu.kit.RecentRoute
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.RouteService
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.models.JusoAddress
import space.dodoplanet.gildongmu.kit.models.TransitModeAxis
import space.dodoplanet.gildongmu.kit.models.WalkLineKind
import space.dodoplanet.gildongmu.a11y.HapticKind
import space.dodoplanet.gildongmu.kit.pathOf
import space.dodoplanet.gildongmu.kit.queryOf
import space.dodoplanet.gildongmu.location.LocationException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/** iOS `DirectionsModel` 계약을 JVM에서 잠근다(spec §4·§9). 전송은 스텁, 위치는 페이크, 문장은 실제 카탈로그. */
@OptIn(ExperimentalCoroutinesApi::class)
class DirectionsViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private val ko = CatalogStrings("ko")
    private val transitBody = Fixtures.kit("route-transit.json")
    /** Kit 옛 봉투 fixture의 경로(fixture 디렉터리는 읽기 전용) — E42 줄 목록 봉투는 이것을 줄마다 싣는다. */
    private val walkRoute = Fixtures.kit("route-walk.json").substringAfter("\"result\":").trimEnd().removeSuffix("}")
    private fun linesBody(vararg kinds: String) = """{"lines":[""" + kinds.joinToString(",") { """{"kind":"$it","route":$walkRoute}""" } + "]}"
    private val walkBody = linesBody("shortest")
    private val carBody = Fixtures.kit("route-car.json")
    private val walkNoRoute = """{"lines":[]}"""
    private val walkTwoLines = linesBody("shortest", "accessible")
    private val placesK1 = """{"places":[{"id":"k1","name":"강동역","category":"교통,수송 > 지하철","address":"서울 강동구","roadAddress":"서울 강동구 천호대로","lat":37.5,"lng":127.1,"nameRoman":"Gangdong Station"}],"provider":"kakao-local","query":"강동"}"""
    private val sixPlaces = """{"places":[""" + (1..6).joinToString(",") { """{"id":"p$it","name":"장소$it","category":"c","address":"a","roadAddress":"r","lat":37.5,"lng":127.1}""" } + """],"provider":"kakao-local","query":"q"}"""
    private val emptyPlaces = """{"places":[],"provider":"none","query":"q"}"""
    private val sixAddresses = """{"addresses":[""" + (1..6).joinToString(",") { """{"roadAddr":"서울 강동구 천호대로 $it","roadAddrPart1":"서울 강동구 천호대로 $it","jibunAddr":"길동 $it","engAddr":"$it Cheonho-daero","zipNo":"05300","bdNm":""}""" } + """],"query":"q"}"""
    private val emptyAddr = """{"addresses":[],"query":"q"}"""
    private val oneAddr = """{"addresses":[{"roadAddr":"서울 강동구 천호대로 1","roadAddrPart1":"서울 강동구 천호대로 1","jibunAddr":"길동 1","engAddr":"1 Cheonho-daero, Gangdong-gu, Seoul","zipNo":"05300","bdNm":""}],"query":"q"}"""
    private val gangnam = DirectionsEndpoint.Place("강남역", 37.4979, 127.0276)
    private val seoul = NearbyCoord(37.5385, 127.1355)
    private val fukuoka = NearbyCoord(33.5902, 130.4017)

    private class FakeLocator(
        var current: () -> NearbyCoord,
        var ranking: NearbyCoord? = null,
        var precise: Boolean = false,
        var display: NearbyCoord? = null,
        var stale: StaleFix? = null,
        var stored: NearbyCoord? = null,
    ) : EndpointLocator {
        val forces = ArrayList<Boolean>()
        var preciseCalls = 0
        override suspend fun currentCoordinate(force: Boolean): NearbyCoord { forces += force; return current() }
        override suspend fun coordinateForRanking(): NearbyCoord? = ranking
        override suspend fun coordinateForDisplay(): NearbyCoord? = display
        override fun staleFix(): StaleFix? = stale
        var storedCalls = 0
        override fun storedCoordinate(): NearbyCoord? { storedCalls++; return stored }
        override suspend fun requestPreciseLocation(): Boolean { preciseCalls++; return precise }
    }

    /** 경로별 응답 + 본 URL 기록. `delays`에 있는 경로는 그만큼 기다린다(가상 시계). */
    private class Routes(
        val transit: String? = null, val walk: String? = null, val car: String? = null,
        val entrance: String = "{}", val places: String = "", val addresses: String = "", val geocode: String = "", val reverse: String = "",
        val delays: Map<String, Long> = emptyMap(),
        val walkStatus: Int = 200,
        /** 수단 재조회(E50) 응답 — `pathType` 값별. 부재면 본 조회 응답을 쓴다. `requeryDelay`는 재조회에만 거는 가상 지연. */
        val requery: Map<String, HttpResponse> = emptyMap(),
        val requeryDelay: Long = 0,
    ) : HttpTransport {
        val seen = ArrayList<String>()
        override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
            seen += url
            val path = pathOf(url)
            delays[path]?.let { delay(it) }
            param(url, "pathType")?.let { pathType ->
                if (requeryDelay > 0) delay(requeryDelay)
                requery[pathType]?.let { return it }
            }
            val body = when (path) {
                "/api/route/transit" -> transit
                "/api/route/walk" -> walk
                "/api/route/car" -> car
                "/api/places/entrance" -> entrance
                "/api/places" -> places
                "/api/address/search" -> addresses
                "/api/geocode" -> geocode
                "/api/geocode/reverse" -> reverse
                else -> null
            } ?: return HttpResponse(404, "")
            return HttpResponse(if (path == "/api/route/walk") walkStatus else 200, body)
        }
        fun paths() = seen.map(::pathOf)
        fun param(url: String, name: String): String? = queryOf(url).split('&').firstOrNull { it.startsWith("$name=") }?.substringAfter('=')
        fun query(path: String) = seen.first { pathOf(it) == path }.let(::queryOf)
    }

    private fun allOk(delays: Map<String, Long> = emptyMap()) = Routes(transit = transitBody, walk = walkBody, car = carBody, delays = delays)

    private fun vm(
        routes: Routes,
        locator: FakeLocator = FakeLocator({ seoul }),
        store: RecentSearchStore = RecentSearchStore(InMemoryKeyValueStore()),
        lang: String = "ko",
        saved: SavedStateHandle = SavedStateHandle(),
        prefill: MutableStateFlow<DirectionsPrefill?> = MutableStateFlow(null),
        timeout: Long = 15_000,
        manual: () -> ManualLocation? = { null },
        guideDest: MutableStateFlow<DirectionsEndpoint.Place?> = MutableStateFlow(null),
        guideVia: MutableStateFlow<DirectionsEndpoint.Place?> = MutableStateFlow(null),
    ): DirectionsViewModel {
        val client = APIClient("https://example.test", routes)
        return DirectionsViewModel(
            RouteService(client), SearchService(client), store, locator, { lang }, ko, saved,
            prefill = prefill, takePrefill = { prefill.compareAndSet(it, null) }, io = dispatcher, queryTimeoutMs = timeout, manual = manual,
            // 앱 싱글턴(`GuideFormSync`)을 쓰지 않는다 — 테스트끼리 게시가 새지 않게.
            guideFormPending = kotlinx.coroutines.flow.merge(guideDest, guideVia),
            takeGuideDestination = { guideDest.value.also { guideDest.value = null } },
            takeGuideWaypoint = { guideVia.value.also { guideVia.value = null } },
        )
    }

    // ── 안내 주도 폼 동기화(M4b §3, iOS `consumeGuideFormSync`) ──

    private val cheonho = DirectionsEndpoint.Place("천호역", 37.5386, 127.1237)

    @Test fun `안내 목적지 변경 — 출발지는 현재 위치·도착지 교체·최근 기록·무통지 조회`() = runTest(dispatcher) {
        val r = allOk()
        val store = RecentSearchStore(InMemoryKeyValueStore())
        val guideDest = MutableStateFlow<DirectionsEndpoint.Place?>(null)
        val m = vm(r, store = store, guideDest = guideDest)
        m.setEndpoint(DirectionsEndpoint.Place("길동역", 37.5378, 127.1400), DirectionsFieldTarget.from)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        dispatcher.scheduler.advanceUntilIdle()
        val noticeSeq = m.state.value.notice.seq
        guideDest.value = cheonho
        dispatcher.scheduler.advanceUntilIdle()
        val s = m.state.value
        assertEquals(DirectionsEndpoint.Current, s.from, "안내 세션의 출발점 = 현재 위치")
        assertEquals(cheonho, s.to)
        assertNull(guideDest.value, "읽고 비운다")
        assertEquals(DirectionsPhase.Settled(3), s.phase, "무통지 조회도 결과는 커밋한다")
        assertTrue(r.paths().contains("/api/route/walk"))
        // 필드 변경의 결과 폐기가 통지를 빈 문장으로 비운 뒤로 조회 국면·완료 문장은 올리지 않는다.
        assertEquals("", s.notice.text)
        assertTrue(s.notice.seq <= noticeSeq + 2, "필드 확정 두 번의 비움 외에 통지 세대가 오르지 않는다: ${s.notice.seq - noticeSeq}")
        assertEquals("천호역", store.endpoints(RecentEndpointScope.to).first().label)
    }

    @Test fun `같은 목적지는 아무것도 하지 않는다`() = runTest(dispatcher) {
        val r = allOk()
        val guideDest = MutableStateFlow<DirectionsEndpoint.Place?>(null)
        val m = vm(r, guideDest = guideDest)
        m.setEndpoint(cheonho, DirectionsFieldTarget.to)
        dispatcher.scheduler.advanceUntilIdle()
        guideDest.value = cheonho
        dispatcher.scheduler.advanceUntilIdle()
        assertTrue(r.paths().none { it.startsWith("/api/route") })
        assertEquals(DirectionsPhase.Idle, m.state.value.phase)
    }

    @Test fun `안내 경유지 변경 — 폼 경유지 교체와 via 조회`() = runTest(dispatcher) {
        val r = allOk()
        val guideVia = MutableStateFlow<DirectionsEndpoint.Place?>(null)
        val m = vm(r, guideVia = guideVia)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        dispatcher.scheduler.advanceUntilIdle()
        guideVia.value = cheonho
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(cheonho, m.state.value.via)
        assertNotNull(r.param(r.seen.last { pathOf(it) == "/api/route/walk" }, "via"))
    }

    @Test fun `수동 조회는 통지를 되살린다 — 무통지 표식은 조회마다 다시 정한다`() = runTest(dispatcher) {
        val r = allOk()
        val guideDest = MutableStateFlow<DirectionsEndpoint.Place?>(null)
        val m = vm(r, guideDest = guideDest)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        guideDest.value = cheonho
        dispatcher.scheduler.advanceUntilIdle()
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals("3개 수단의 경로 안내가 준비되었습니다.", m.state.value.notice.text)
    }

    @Test fun `끝점이 비면 조회 없이 NeedEndpoints 통지`() = runTest(dispatcher) {
        val r = allOk()
        val m = vm(r)
        m.runQuery()
        assertEquals(DirectionsPhase.NeedEndpoints, m.state.value.phase)
        assertEquals("출발지와 도착지를 먼저 선택해 주세요.", m.state.value.notice.text)
        dispatcher.scheduler.advanceUntilIdle()
        assertTrue(r.paths().none { it.startsWith("/api/route") })
    }

    @Test fun `3수단 성공 - 순서·통지·최근 경로 기록·세대`() = runTest(dispatcher) {
        val r = allOk()
        val store = RecentSearchStore(InMemoryKeyValueStore())
        val loc = FakeLocator({ seoul })
        val m = vm(r, loc, store = store)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery()
        assertEquals(DirectionsPhase.Locating, m.state.value.phase)
        dispatcher.scheduler.advanceUntilIdle()
        val s = m.state.value
        assertEquals(DirectionsPhase.Settled(3), s.phase)
        assertEquals("3개 수단의 경로 안내가 준비되었습니다.", s.notice.text)
        assertEquals(1, s.resultsRevision)
        // 도보 30분(1806초)은 접히지 않는 경계 안쪽이라 성공군 맨 앞으로 승격된다(:kit DirectionsOrder).
        assertEquals(listOf(DirectionsMode.walk, DirectionsMode.transit, DirectionsMode.car), s.results!!.displayedModes)
        assertEquals(listOf(WalkLineKind.shortest), s.walkLines.map { it.lineKind })
        assertEquals(1, store.routes().size)
        assertNull(store.routes()[0].from) // 현재 위치는 null 투영
        assertEquals("강남역", store.routes()[0].to?.label)
        assertEquals(listOf(false), loc.forces)
        assertTrue(r.query("/api/route/transit").contains("includeStops=1"))
        assertFalse(r.query("/api/route/walk").contains("accessible"))
        assertTrue(r.query("/api/route/walk").contains("lines=2"))
        assertEquals("강남역", store.endpoints(RecentEndpointScope.to).single().label)
        assertNull(s.landing) // 조회 완료에 착지 없음
    }

    @Test fun `transit 응답에 result가 없으면 경로 없음이고 성공 수는 2`() = runTest(dispatcher) {
        val m = vm(Routes(transit = "{}", walk = walkBody, car = carBody))
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        val s = m.state.value
        assertEquals(DirectionsModeOutcome.Empty, s.results!!.outcomes[DirectionsMode.transit])
        assertEquals(DirectionsPhase.Settled(2), s.phase)
        assertEquals("2개 수단의 경로 안내가 준비되었습니다.", s.notice.text)
    }

    @Test fun `수단별 15초 초과는 그 수단만 실패`() = runTest(dispatcher) {
        val m = vm(allOk(delays = mapOf("/api/route/transit" to 20_000L)))
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        val s = m.state.value
        assertEquals(DirectionsModeOutcome.Error, s.results!!.outcomes[DirectionsMode.transit])
        assertIs<DirectionsModeOutcome.Walk>(s.results!!.outcomes[DirectionsMode.walk])
        assertIs<DirectionsModeOutcome.Car>(s.results!!.outcomes[DirectionsMode.car])
        assertEquals(DirectionsPhase.Settled(2), s.phase)
    }

    @Test fun `도보 경로 없음은 Empty이고 실패가 아니다`() = runTest(dispatcher) {
        val m = vm(Routes(transit = transitBody, walk = walkNoRoute, car = carBody))
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(DirectionsModeOutcome.Empty, m.state.value.results!!.outcomes[DirectionsMode.walk])
        assertTrue(m.state.value.walkLines.isEmpty())
    }

    @Test fun `도보 조회 실패(첫 줄 502)는 Error이고 줄 목록은 비며 다른 수단은 정상이다`() = runTest(dispatcher) {
        val m = vm(Routes(transit = transitBody, walk = """{"error":"upstream"}""", car = carBody, walkStatus = 502))
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        val s = m.state.value
        assertEquals(DirectionsModeOutcome.Error, s.results!!.outcomes[DirectionsMode.walk])
        assertTrue(s.walkLines.isEmpty())
        assertIs<DirectionsModeOutcome.Transit>(s.results!!.outcomes[DirectionsMode.transit])
        assertIs<DirectionsModeOutcome.Car>(s.results!!.outcomes[DirectionsMode.car])
    }

    @Test fun `측위 실패 3종은 3 phase 3 문장`() = runTest(dispatcher) {
        for ((kind, phase, text) in listOf(
            Triple(LocationException.Kind.Denied, DirectionsPhase.GeoDenied, "설정에서 길동무의 위치 접근을 허용해 주세요"),
            Triple(LocationException.Kind.ReducedAccuracy, DirectionsPhase.GeoReduced, "대략적인 위치만 허용되어 있습니다. 정확한 위치를 허용해 주세요"),
            Triple(LocationException.Kind.Unavailable, DirectionsPhase.GeoError, "현재 위치를 확인할 수 없습니다. 출발지를 검색해 지정해 주세요."),
        )) {
            val r = allOk()
            val m = vm(r, FakeLocator({ throw LocationException(kind) }))
            m.setEndpoint(gangnam, DirectionsFieldTarget.to)
            m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
            assertEquals(phase, m.state.value.phase)
            assertEquals(text, m.state.value.notice.text)
            assertTrue(r.paths().none { it.startsWith("/api/route") })
        }
    }

    @Test fun `옛 위치 — 취득 실패면 옛 좌표로 조회하고 칸·완료 통지가 옛 위치를 밝힌다`() = runTest(dispatcher) {
        val r = Routes(transit = transitBody, walk = walkBody, car = carBody, reverse = """{"address":"서울 강동구 길동"}""")
        val fixedAt = System.currentTimeMillis() / 1000.0 - 5 * 60 - 10
        val m = vm(r, FakeLocator({ throw LocationException(LocationException.Kind.Unavailable) }, stale = StaleFix(37.53, 127.14, fixedAt)))
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertTrue(m.state.value.phase is DirectionsPhase.Settled)
        assertTrue(m.state.value.notice.text.endsWith(" 현재 위치를 확인하지 못해 5분 전에 확인한 위치로 찾았습니다."), m.state.value.notice.text)
        assertTrue(r.seen.any { it.contains("/api/route/") && it.contains("37.53") })
        assertEquals("출발지, 마지막으로 확인한 위치, 서울 강동구 길동, 5분 전", m.fieldText(DirectionsFieldTarget.from, accessible = true, lang = "ko"))
    }

    @Test fun `옛 위치 전이 — 다른 화면의 실패·성공을 칸이 측위 없이 따라간다(M-2)`() = runTest(dispatcher) {
        val reverse = """{"address":"서울 강동구 길동"}"""
        val flow = MutableStateFlow<StaleFix?>(null)
        val loc = FakeLocator({ seoul }, display = seoul)
        val client = APIClient("https://example.test", Routes(reverse = reverse))
        val m = DirectionsViewModel(
            RouteService(client), SearchService(client), RecentSearchStore(InMemoryKeyValueStore()), loc, { "ko" }, ko, SavedStateHandle(),
            prefill = MutableStateFlow(null), takePrefill = { false }, io = dispatcher, staleChanges = flow,
        )
        m.loadCurrentAddressIfAuthorized(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals("출발지, 현재 위치(서울 강동구 길동 부근)", m.fieldText(DirectionsFieldTarget.from, accessible = true, lang = "ko"))
        val stale = StaleFix(37.5385, 127.1355, System.currentTimeMillis() / 1000.0 - 5 * 60 - 10)
        loc.stale = stale; flow.value = stale; dispatcher.scheduler.advanceUntilIdle()
        assertEquals("출발지, 마지막으로 확인한 위치, 서울 강동구 길동, 5분 전", m.fieldText(DirectionsFieldTarget.from, accessible = true, lang = "ko"))
        assertEquals(listOf<Boolean>(), loc.forces) // 측위 없음
        loc.display = null // 풀림 뒤 표시용 측위를 부르면 주소가 안 붙는다 — 보관 좌표로만 받아야 한다(재리뷰 N-2)
        loc.stored = NearbyCoord(37.54, 127.14)
        loc.stale = null; flow.value = null; dispatcher.scheduler.advanceUntilIdle()
        assertEquals(1, loc.storedCalls)
        assertEquals("출발지, 현재 위치(서울 강동구 길동 부근)", m.fieldText(DirectionsFieldTarget.from, accessible = true, lang = "ko"))
    }

    @Test fun `권한을 거두면 칸은 옛 위치를 말하지 않는다(L-4)`() = runTest(dispatcher) {
        val r = Routes(transit = transitBody, walk = walkBody, car = carBody, reverse = """{"address":"서울 강동구 길동"}""")
        val loc = FakeLocator({ throw LocationException(LocationException.Kind.Unavailable) }, stale = StaleFix(37.53, 127.14, 1.0))
        val m = vm(r, loc)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        loc.stale = null // 권한 회수 — 스토어의 옛 위치가 사라진다(흐름은 내보내지 않는다)
        assertEquals("출발지, 현재 위치", m.fieldText(DirectionsFieldTarget.from, accessible = true, lang = "ko")) // 옛 주소를 현재로 말하지 않는다(N-1)
    }

    @Test fun `옛 위치로 찾았는데 경로가 0건이면 뒷문장을 붙이지 않는다(위원장 판정)`() = runTest(dispatcher) {
        val r = Routes(reverse = """{"address":"서울 강동구 길동"}""")
        val m = vm(r, FakeLocator({ throw LocationException(LocationException.Kind.Unavailable) }, stale = StaleFix(37.53, 127.14, 1.0)))
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals("경로를 찾지 못했습니다.", m.state.value.notice.text)
    }

    @Test fun `옛 위치가 있어도 권한 축 실패는 옛 위치로 계속하지 않는다`() = runTest(dispatcher) {
        val r = allOk()
        val m = vm(r, FakeLocator({ throw LocationException(LocationException.Kind.Denied) }, stale = StaleFix(37.53, 127.14, 1.0)))
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(DirectionsPhase.GeoDenied, m.state.value.phase)
        assertTrue(r.paths().none { it.startsWith("/api/route") })
    }

    @Test fun `재선택이 취득 실패면 옛 위치로, 옛 좌표도 없으면 주소를 비운다`() = runTest(dispatcher) {
        val reverse = """{"address":"서울 강동구 길동"}"""
        val loc = FakeLocator({ seoul }, display = seoul)
        val m = vm(Routes(reverse = reverse), loc)
        m.loadCurrentAddressIfAuthorized(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals("출발지, 현재 위치(서울 강동구 길동 부근)", m.fieldText(DirectionsFieldTarget.from, accessible = true, lang = "ko"))
        loc.current = { throw LocationException(LocationException.Kind.Unavailable) }
        loc.stale = StaleFix(37.5385, 127.1355, System.currentTimeMillis() / 1000.0 - 30)
        m.refreshCurrentLocation(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals("출발지, 마지막으로 확인한 위치, 서울 강동구 길동, 방금 전", m.fieldText(DirectionsFieldTarget.from, accessible = true, lang = "ko"))
        loc.stale = null
        loc.current = { throw LocationException(LocationException.Kind.Denied) }
        m.refreshCurrentLocation(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals("출발지, 현재 위치", m.fieldText(DirectionsFieldTarget.from, accessible = true, lang = "ko"))
    }

    @Test fun `정확한 위치 허용 - 참이면 재조회, 거짓이면 통지만`() = runTest(dispatcher) {
        val loc = FakeLocator({ throw LocationException(LocationException.Kind.ReducedAccuracy) })
        val r = allOk()
        val m = vm(r, loc)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        m.requestPreciseLocation(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(1, loc.preciseCalls)
        assertEquals(DirectionsPhase.GeoReduced, m.state.value.phase)
        assertEquals(1, loc.forces.size) // 재조회 없음
        loc.precise = true; loc.current = { seoul }
        m.requestPreciseLocation(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(DirectionsPhase.Settled(3), m.state.value.phase)
    }

    @Test fun `현재 위치가 한국 밖이면 커버리지 안내이고 upstream 호출 0`() = runTest(dispatcher) {
        val r = allOk()
        val m = vm(r, FakeLocator({ fukuoka }))
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(DirectionsPhase.OutOfCoverage, m.state.value.phase)
        assertTrue(r.paths().none { it.startsWith("/api/route") || it == "/api/places/entrance" })
        assertNull(m.state.value.results)
    }

    @Test fun `서버 마커는 화면 전체를 전환한다`() = runTest(dispatcher) {
        val m = vm(Routes(transit = transitBody, walk = """{"outOfCoverage":true}""", car = carBody))
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(DirectionsPhase.OutOfCoverage, m.state.value.phase)
        assertNull(m.state.value.results)
    }

    @Test fun `경유지 - 대중교통 미호출·미지원 상태, 도보·자동차 via 파라미터`() = runTest(dispatcher) {
        val r = allOk()
        val m = vm(r)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.setVia(DirectionsEndpoint.Place("천호역", 37.5385, 127.1237))
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        val s = m.state.value
        assertEquals(DirectionsModeOutcome.UnsupportedWaypoint, s.results!!.outcomes[DirectionsMode.transit])
        assertFalse(r.paths().contains("/api/route/transit"))
        assertTrue(r.query("/api/route/walk").contains("via=37.5385%2C127.1237") || r.query("/api/route/walk").contains("via=37.5385,127.1237"))
        assertTrue(r.query("/api/route/car").contains("via="))
        assertEquals(DirectionsPhase.Settled(2), s.phase)
        assertEquals("천호역", s.recentRoutes[0].via?.label)
    }

    @Test fun `경유지가 한국 밖이면 커버리지 안내`() = runTest(dispatcher) {
        val r = allOk()
        val m = vm(r)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.setVia(DirectionsEndpoint.Place("후쿠오카", fukuoka.lat, fukuoka.lng))
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(DirectionsPhase.OutOfCoverage, m.state.value.phase)
        assertTrue(r.paths().none { it.startsWith("/api/route") })
    }

    @Test fun `도보 줄 목록 - lines=2 단독 조회, 줄은 같은 응답에서 결과와 함께 커밋되고 첫 줄이 도보 결과다`() = runTest(dispatcher) {
        val r = Routes(transit = transitBody, walk = walkTwoLines, car = carBody)
        val m = vm(r)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        val s = m.state.value
        assertEquals(listOf(WalkLineKind.shortest, WalkLineKind.accessible), s.walkLines.map { it.lineKind })
        assertEquals(s.walkLines.first().route, assertIs<DirectionsModeOutcome.Walk>(s.results!!.outcomes[DirectionsMode.walk]).briefing)
        val q = r.query("/api/route/walk")
        for (name in listOf("accessible", "variant", "alternatives", "includeGeometry")) assertFalse(q.contains("$name="), q)
        // 필드 변경은 줄 목록까지 비운다(다른 조회 세대의 줄을 남기지 않는다).
        m.setEndpoint(DirectionsEndpoint.Place("천호역", 37.5385, 127.1237), DirectionsFieldTarget.to)
        assertTrue(m.state.value.walkLines.isEmpty())
    }

    @Test fun `조회가 실패해 빠진 줄(E52 판정 (나))은 줄과 같은 응답에서 커밋되고 필드 변경에 비워진다`() = runTest(dispatcher) {
        val body = linesBody("shortest").dropLast(1) + ""","failedLines":["broad","accessible"]}"""
        val r = Routes(transit = transitBody, walk = body, car = carBody)
        val m = vm(r)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(listOf("broad", "accessible"), m.state.value.walkLinesFailed)
        m.setEndpoint(DirectionsEndpoint.Place("천호역", 37.5385, 127.1237), DirectionsFieldTarget.to)
        assertTrue(m.state.value.walkLinesFailed.isEmpty())
    }

    @Test fun `필드 변경은 진행 조회를 취소하고 늦은 응답은 상태를 쓰지 않는다`() = runTest(dispatcher) {
        val r = allOk(delays = mapOf("/api/route/walk" to 1_000L))
        val m = vm(r)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery()
        dispatcher.scheduler.runCurrent()
        assertEquals(DirectionsPhase.Loading, m.state.value.phase)
        m.swap()
        assertEquals(DirectionsPhase.Idle, m.state.value.phase)
        dispatcher.scheduler.advanceUntilIdle()
        assertNull(m.state.value.results)
        assertEquals(DirectionsPhase.Idle, m.state.value.phase)
        assertEquals(gangnam, m.state.value.from); assertEquals(DirectionsEndpoint.Current, m.state.value.to)
        // 취소된 조회가 가드를 남기지 않는다 — 새 조회가 돈다.
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(DirectionsPhase.Settled(3), m.state.value.phase)
    }

    @Test fun `출입구 승격 - 세 수단 dest가 승격 좌표, 실패·부재는 원좌표, en은 미호출`() = runTest(dispatcher) {
        val promotedBody = """{"entrance":{"name":"강남역 2번 출구","lat":37.4990,"lng":127.0280,"meters":120}}"""
        val r = Routes(transit = transitBody, walk = walkBody, car = carBody, entrance = promotedBody)
        val m = vm(r)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(PromotedDestination("강남역 2번 출구", 37.4990, 127.0280), m.state.value.promotedDestination)
        assertEquals("강남역 2번 출구", m.destinationName)
        for (p in listOf("/api/route/transit", "/api/route/walk", "/api/route/car")) assertTrue(r.query(p).contains("dest=37.499%2C127.028") || r.query(p).contains("dest=37.499,127.028"), r.query(p))
        val r2 = allOk()
        val m2 = vm(r2)
        m2.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m2.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertNull(m2.state.value.promotedDestination)
        assertEquals("강남역", m2.destinationName)
        assertTrue(r2.query("/api/route/walk").contains("dest=37.4979"))
        val r3 = allOk()
        val m3 = vm(r3, lang = "en")
        m3.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m3.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertFalse(r3.paths().contains("/api/places/entrance"))
        assertTrue(r3.query("/api/route/walk").contains("lang=en"))
    }

    @Test fun `프리필 to는 자동 조회 1회·기록, from은 조회 없이 도착지 착지, 살아 있는 채 값이 오면 즉시 소비`() = runTest(dispatcher) {
        val store = RecentSearchStore(InMemoryKeyValueStore())
        val flow = MutableStateFlow<DirectionsPrefill?>(DirectionsPrefill(DirectionsPrefillRole.to, "강남역", 37.4979, 127.0276, "Gangnam Station"))
        val r = allOk()
        val m = vm(r, store = store, prefill = flow)
        dispatcher.scheduler.advanceUntilIdle()
        assertNull(flow.value)
        assertEquals(DirectionsEndpoint.Place("강남역", 37.4979, 127.0276, "Gangnam Station"), m.state.value.to)
        assertEquals(DirectionsPhase.Settled(3), m.state.value.phase)
        assertEquals(1, r.paths().count { it == "/api/route/walk" })
        assertEquals("강남역", store.endpoints(RecentEndpointScope.to).single().label)
        // 살아 있는 채로 다른 프리필이 오면 즉시 소비되고 이전 결과는 폐기된다.
        flow.value = DirectionsPrefill(DirectionsPrefillRole.from, "천호역", 37.5385, 127.1237)
        dispatcher.scheduler.advanceUntilIdle()
        assertNull(flow.value)
        assertEquals(DirectionsEndpoint.Place("천호역", 37.5385, 127.1237), m.state.value.from)
        assertNull(m.state.value.to)
        assertNull(m.state.value.results)
        assertEquals(LandingTarget.Field(DirectionsFieldTarget.to), m.state.value.landing?.target)
        assertEquals(1, r.paths().count { it == "/api/route/walk" }) // 조회 없음
        assertEquals("천호역", store.endpoints(RecentEndpointScope.from).single().label)
    }

    @Test fun `최근 경로 - 활성화는 필드 확정 + 조회, 삭제 착지는 다음·이전·소멸`() = runTest(dispatcher) {
        val store = RecentSearchStore(InMemoryKeyValueStore())
        val a = RecentRoute(null, RecentEndpoint("A", 37.5, 127.0))
        val b = RecentRoute(null, RecentEndpoint("B", 37.6, 127.1))
        val c = RecentRoute(RecentEndpoint("C1", 37.7, 127.2), RecentEndpoint("C2", 37.8, 127.3), RecentEndpoint("천호역", 37.9, 127.4))
        store.recordRoute(a); store.recordRoute(b); store.recordRoute(c)
        val r = allOk()
        val m = vm(r, store = store)
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(3, m.state.value.recentRoutes.size)
        assertEquals("C1부터 C2까지 천호역을 경유하는 경로 조회", m.recentRouteLabel(c, "ko"))
        assertEquals("현재 위치부터 A까지 경로 조회", m.recentRouteLabel(a, "ko"))
        m.activateRecentRoute(c); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(DirectionsEndpoint.Place("C1", 37.7, 127.2), m.state.value.from)
        assertEquals("천호역", m.state.value.via?.label)
        assertFalse(r.paths().contains("/api/route/transit")) // 경유지라 미호출
        assertEquals(DirectionsPhase.Settled(2), m.state.value.phase)
        // 삭제 착지(목록 최신순: c, b, a)
        val list = m.state.value.recentRoutes
        assertEquals(list[1].id, m.removeRecentRoute(list[0]))
        assertEquals("삭제했습니다", m.state.value.notice.text)
        val remaining = m.state.value.recentRoutes
        assertEquals(remaining[0].id, m.removeRecentRoute(remaining[1])) // 마지막 삭제 → 이전
        assertNull(m.removeRecentRoute(m.state.value.recentRoutes[0]))
        assertEquals(LandingTarget.Submit, m.state.value.landing?.target)
    }

    @Test fun `끝점 검색 - 장소·주소 각 5건 절단·3-state 통지·현재 위치 확정은 from에서만·닫힘이 검색을 취소한다`() = runTest(dispatcher) {
        val r = Routes(places = sixPlaces, addresses = sixAddresses)
        val m = vm(r)
        m.openPicker(DirectionsFieldTarget.to)
        val p = m.endpointSearch.value!!
        p.queryState.setTextAndPlaceCursorAtEnd("장소")
        m.submitCandidates()
        assertTrue(m.endpointSearch.value!!.isSearching && m.endpointSearch.value!!.hasSearched)
        dispatcher.scheduler.advanceUntilIdle()
        val s = m.endpointSearch.value!!
        assertEquals(5, s.places.size); assertEquals(5, s.addresses.size); assertEquals(1, s.candidateRevision)
        assertEquals("후보 10건을 찾았습니다.", s.notice.text)
        // 도착지 피커에서 "현재 위치"는 확정되지 않는다(화면도 버튼을 내지 않는다 — 이중 방어)
        m.selectCurrent()
        assertNotNull(m.endpointSearch.value); assertNull(m.state.value.to)
        assertFalse(r.query("/api/places").contains("lat=")) // ranking 좌표 없음 → 미전송
        // 0건과 실패는 다른 문장
        val m2 = vm(Routes(places = emptyPlaces, addresses = emptyAddr))
        m2.openPicker(DirectionsFieldTarget.to); m2.endpointSearch.value!!.queryState.setTextAndPlaceCursorAtEnd("x"); m2.submitCandidates(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals("후보를 찾지 못했습니다.", m2.endpointSearch.value!!.notice.text)
        val m3 = vm(Routes())
        m3.openPicker(DirectionsFieldTarget.to); m3.endpointSearch.value!!.queryState.setTextAndPlaceCursorAtEnd("x"); m3.submitCandidates(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals("후보 검색에 실패했습니다.", m3.endpointSearch.value!!.notice.text)
        // 닫힘은 검색을 취소하고 열었던 필드로 착지
        val r4 = Routes(places = placesK1, addresses = emptyAddr, delays = mapOf("/api/places" to 1_000L))
        val m4 = vm(r4)
        m4.openPicker(DirectionsFieldTarget.from); m4.endpointSearch.value!!.queryState.setTextAndPlaceCursorAtEnd("강동"); m4.submitCandidates()
        dispatcher.scheduler.runCurrent()
        m4.closePicker()
        dispatcher.scheduler.advanceUntilIdle()
        assertNull(m4.endpointSearch.value)
        assertEquals(LandingTarget.Field(DirectionsFieldTarget.from), m4.state.value.landing?.target)
        assertEquals(DirectionsEndpoint.Current, m4.state.value.from)
    }

    @Test fun `장소 후보 선택은 확정 + 착지, 주소 후보는 지오코딩 성공 시에만`() = runTest(dispatcher) {
        val geocode = """{"matches":[{"addressName":"서울 강동구 천호대로 1","lat":37.55,"lng":127.15}],"query":"q"}"""
        val r = Routes(places = placesK1, addresses = oneAddr, geocode = geocode)
        val m = vm(r)
        m.openPicker(DirectionsFieldTarget.from); m.endpointSearch.value!!.queryState.setTextAndPlaceCursorAtEnd("강동"); m.submitCandidates(); dispatcher.scheduler.advanceUntilIdle()
        val place = m.endpointSearch.value!!.places.single()
        m.selectPlace(place)
        assertNull(m.endpointSearch.value)
        assertEquals(DirectionsEndpoint.Place("강동역", 37.5, 127.1, "Gangdong Station"), m.state.value.from)
        assertEquals(LandingTarget.Field(DirectionsFieldTarget.to), m.state.value.landing?.target)
        // 주소 → 지오코딩 → engAddr 로마자
        m.openPicker(DirectionsFieldTarget.to); m.endpointSearch.value!!.queryState.setTextAndPlaceCursorAtEnd("천호"); m.submitCandidates(); dispatcher.scheduler.advanceUntilIdle()
        m.selectAddress(m.endpointSearch.value!!.addresses.single()); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(DirectionsEndpoint.Place("서울 강동구 천호대로 1", 37.55, 127.15, "1 Cheonho-daero, Gangdong-gu, Seoul"), m.state.value.to)
        assertEquals(LandingTarget.Submit, m.state.value.landing?.target)
        // 지오코딩 실패는 coordError + 화면 유지
        val m2 = vm(Routes(places = emptyPlaces, addresses = oneAddr, geocode = """{"matches":[],"query":"q"}"""))
        m2.openPicker(DirectionsFieldTarget.to); m2.endpointSearch.value!!.queryState.setTextAndPlaceCursorAtEnd("천호"); m2.submitCandidates(); dispatcher.scheduler.advanceUntilIdle()
        m2.selectAddress(m2.endpointSearch.value!!.addresses.single()); dispatcher.scheduler.advanceUntilIdle()
        assertNotNull(m2.endpointSearch.value)
        assertEquals("선택한 주소의 좌표를 확인하지 못했습니다.", m2.endpointSearch.value!!.notice.text)
        assertNull(m2.state.value.to)
    }

    @Test fun `지오코딩 왕복 중 닫으면 필드가 바뀌지 않는다`() = runTest(dispatcher) {
        val geocode = """{"matches":[{"addressName":"x","lat":37.55,"lng":127.15}],"query":"q"}"""
        val r = Routes(places = emptyPlaces, addresses = oneAddr, geocode = geocode, delays = mapOf("/api/geocode" to 1_000L))
        val m = vm(r)
        m.openPicker(DirectionsFieldTarget.to); m.endpointSearch.value!!.queryState.setTextAndPlaceCursorAtEnd("천호"); m.submitCandidates(); dispatcher.scheduler.advanceUntilIdle()
        m.selectAddress(m.endpointSearch.value!!.addresses.single())
        dispatcher.scheduler.runCurrent()
        m.closePicker()
        dispatcher.scheduler.advanceUntilIdle()
        assertNull(m.state.value.to)
        assertNull(m.endpointSearch.value)
    }

    @Test fun `현재 위치 사용은 from에서 강제 재측위 + 주소 병기`() = runTest(dispatcher) {
        val loc = FakeLocator({ seoul })
        val reverse = """{"address":"서울 강동구 길동","addressEn":"Gil-dong, Gangdong-gu"}"""
        val m = vm(Routes(reverse = reverse), loc)
        m.openPicker(DirectionsFieldTarget.from)
        m.selectCurrent()
        assertTrue(m.state.value.isRefreshingCurrent)
        assertEquals("출발지, 현재 위치 다시 확인 중", m.fieldText(DirectionsFieldTarget.from, accessible = true, lang = "ko"))
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(listOf(true), loc.forces)
        assertEquals("출발지, 현재 위치(서울 강동구 길동 부근)", m.fieldText(DirectionsFieldTarget.from, accessible = true, lang = "ko"))
        assertEquals("도착지 검색", m.fieldText(DirectionsFieldTarget.to, accessible = true, lang = "ko"))
        assertEquals(LandingTarget.Field(DirectionsFieldTarget.to), m.state.value.landing?.target)
    }

    @Test fun `주소 병기는 허가된 세션에서만 조용히`() = runTest(dispatcher) {
        val reverse = """{"address":"서울 강동구 길동"}"""
        val m = vm(Routes(reverse = reverse), FakeLocator({ seoul }, display = null))
        m.loadCurrentAddressIfAuthorized(); dispatcher.scheduler.advanceUntilIdle()
        assertNull(m.state.value.currentAddress)
        val m2 = vm(Routes(reverse = reverse), FakeLocator({ seoul }, display = seoul))
        m2.loadCurrentAddressIfAuthorized(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals("서울 강동구 길동", m2.state.value.currentAddress)
    }

    @Test fun `필드는 SavedStateHandle에 JSON으로 남고 복원된다`() = runTest(dispatcher) {
        val saved = SavedStateHandle()
        val m = vm(allOk(), saved = saved)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.setVia(DirectionsEndpoint.Place("천호역", 37.5385, 127.1237))
        m.swap()
        val restored = vm(allOk(), saved = saved)
        assertEquals(gangnam, restored.state.value.from)
        assertEquals(DirectionsEndpoint.Current, restored.state.value.to)
        assertEquals("천호역", restored.state.value.via?.label)
        assertNull(restored.state.value.results)
    }

    @Test fun `지오코딩 연타는 한 번만 왕복한다 - in-flight 가드`() = runTest(dispatcher) {
        val geocode = """{"matches":[{"addressName":"x","lat":37.55,"lng":127.15}],"query":"q"}"""
        val r = Routes(places = emptyPlaces, addresses = oneAddr, geocode = geocode, delays = mapOf("/api/geocode" to 1_000L))
        val m = vm(r)
        m.openPicker(DirectionsFieldTarget.to); m.endpointSearch.value!!.queryState.setTextAndPlaceCursorAtEnd("천호"); m.submitCandidates(); dispatcher.scheduler.advanceUntilIdle()
        val address = m.endpointSearch.value!!.addresses.single()
        m.selectAddress(address); dispatcher.scheduler.runCurrent()
        m.selectAddress(address); dispatcher.scheduler.runCurrent()
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(1, r.paths().count { it == "/api/geocode" })
        assertEquals("서울 강동구 천호대로 1", (m.state.value.to as DirectionsEndpoint.Place).label)
    }

    @Test fun `취소된 조회의 finally가 새 조회의 가드를 풀지 않는다`() = runTest(dispatcher) {
        val r = allOk(delays = mapOf("/api/route/walk" to 1_000L))
        val m = vm(r)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.runCurrent()
        m.swap() // 취소 — 옛 finally는 아직 돌지 않았다(다음 디스패치에 돈다)
        m.runQuery() // 새 조회 시작(가드 다시 잠김)
        dispatcher.scheduler.runCurrent() // 여기서 옛 finally가 돈다 — 가드가 없으면 새 조회의 잠금을 푼다
        m.runQuery() // 새 조회가 아직 도는 중 — 가드가 살아 있으면 무시된다
        dispatcher.scheduler.advanceUntilIdle()
        // 첫 조회(취소, car는 이미 호출됨) + 새 조회 = 2. 가드가 풀렸다면 겹친 세 번째 조회가 끼어 3이 된다.
        assertEquals(2, r.paths().count { it == "/api/route/car" })
        assertEquals(DirectionsPhase.Settled(3), m.state.value.phase)
    }

    @Test fun `정확한 위치 허용이 거부되면 설정 열기 폴백 상태가 서고 새 조회에 리셋된다`() = runTest(dispatcher) {
        val loc = FakeLocator({ throw LocationException(LocationException.Kind.ReducedAccuracy) })
        val m = vm(allOk(), loc)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertFalse(m.state.value.preciseRetryFailed)
        m.requestPreciseLocation()
        assertTrue(m.state.value.isRequestingPrecise)
        m.requestPreciseLocation() // 연타 무시
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(1, loc.preciseCalls)
        assertTrue(m.state.value.preciseRetryFailed); assertFalse(m.state.value.isRequestingPrecise)
        m.runQuery(); dispatcher.scheduler.runCurrent()
        assertFalse(m.state.value.preciseRetryFailed)
    }

    @Test fun `최근 경로 모두 지우기 - 고정이 남으면 무이동, 비면 조회 버튼 착지`() = runTest(dispatcher) {
        val store = RecentSearchStore(InMemoryKeyValueStore())
        val a = RecentRoute(null, RecentEndpoint("A", 37.5, 127.0))
        val b = RecentRoute(null, RecentEndpoint("B", 37.6, 127.1))
        store.recordRoute(a); store.recordRoute(b)
        val m = vm(allOk(), store = store)
        dispatcher.scheduler.advanceUntilIdle()
        m.togglePinRecentRoute(m.state.value.recentRoutes.first { it.to?.label == "A" })
        assertTrue(m.state.value.recentRoutes.first { it.to?.label == "A" }.pinned)
        assertEquals(2, m.state.value.recentRoutes.size) // 자리 유지
        val landingBefore = m.state.value.landing
        m.clearRecentRoutes()
        assertEquals(listOf("A"), m.state.value.recentRoutes.map { it.to?.label })
        assertEquals("고정 항목을 제외하고 모두 지웠습니다", m.state.value.notice.text)
        assertEquals(landingBefore, m.state.value.landing) // 포커스 무이동
        m.togglePinRecentRoute(m.state.value.recentRoutes.single())
        m.clearRecentRoutes()
        assertTrue(m.state.value.recentRoutes.isEmpty())
        assertEquals("최근 경로를 모두 지웠습니다", m.state.value.notice.text)
        assertEquals(LandingTarget.Submit, m.state.value.landing?.target)
    }

    @Test fun `최근 장소 - 삭제 착지 다음·이전·소멸, 고정 자리 유지, 모두 지우기 고정 보존`() = runTest(dispatcher) {
        val store = RecentSearchStore(InMemoryKeyValueStore())
        for (i in 1..3) store.recordEndpoint(RecentEndpoint("P$i", 37.0 + i, 127.0), RecentEndpointScope.to)
        val m = vm(Routes(), store = store)
        m.openPicker(DirectionsFieldTarget.to); dispatcher.scheduler.advanceUntilIdle()
        val list = m.endpointSearch.value!!.recentEndpoints
        assertEquals(listOf("P3", "P2", "P1"), list.map { it.label })
        assertEquals(list[1].id, m.removeRecentEndpoint(list[0])) // 첫 삭제 → 다음
        assertEquals("삭제했습니다", m.endpointSearch.value!!.notice.text)
        val rest = m.endpointSearch.value!!.recentEndpoints
        assertEquals(rest[0].id, m.removeRecentEndpoint(rest[1])) // 마지막 삭제 → 이전
        // 고정: 화면 자리 유지(저장소는 고정 블록을 앞으로 옮기지만 정렬은 다음 로드부터)
        val p2 = m.endpointSearch.value!!.recentEndpoints.single()
        assertEquals("P2", p2.label)
        m.togglePinRecentEndpoint(p2)
        assertTrue(m.endpointSearch.value!!.recentEndpoints.single().pinned)
        store.recordEndpoint(RecentEndpoint("P9", 37.9, 127.0), RecentEndpointScope.to)
        m.openPicker(DirectionsFieldTarget.to); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(listOf("P2", "P9"), m.endpointSearch.value!!.recentEndpoints.map { it.label }) // 고정 블록 앞
        m.clearRecentEndpoints()
        assertEquals(listOf("P2"), m.endpointSearch.value!!.recentEndpoints.map { it.label })
        assertEquals("고정 항목을 제외하고 모두 지웠습니다", m.endpointSearch.value!!.notice.text)
        assertNull(m.removeRecentEndpoint(m.endpointSearch.value!!.recentEndpoints.single())) // 소멸 → null(화면이 검색 버튼으로)
        // 최근 장소 행 활성화 = 즉시 확정
        m.openPicker(DirectionsFieldTarget.from); dispatcher.scheduler.advanceUntilIdle()
        m.selectRecentEndpoint(RecentEndpoint("Q", 37.1, 127.1))
        assertEquals(DirectionsEndpoint.Place("Q", 37.1, 127.1), m.state.value.from)
    }

    @Test fun `주소 병기는 늦은 옛 응답이 새 응답을 덮지 않는다`() = runTest(dispatcher) {
        val slow = object : HttpTransport {
            var calls = 0
            override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
                calls++
                val n = calls
                delay(if (n == 1) 2_000 else 100) // 첫 요청이 더 느리다
                return HttpResponse(200, """{"address":"주소$n"}""")
            }
        }
        val client = APIClient("https://example.test", slow)
        val loc = FakeLocator({ seoul }, display = seoul)
        val m = DirectionsViewModel(RouteService(client), SearchService(client), RecentSearchStore(InMemoryKeyValueStore()), loc, { "ko" }, ko, SavedStateHandle(), prefill = MutableStateFlow(null), takePrefill = { false }, io = dispatcher)
        m.loadCurrentAddressIfAuthorized(); dispatcher.scheduler.runCurrent()
        m.openPicker(DirectionsFieldTarget.from); m.selectCurrent(); dispatcher.scheduler.runCurrent()
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals("주소2", m.state.value.currentAddress)
    }

    @Test fun `출발지 현재 위치 필드는 수동 위치가 있으면 표시줄과 같은 문장(검증 가능형·불가형·병기)`() = runTest(dispatcher) {
        val client = APIClient("https://example.test", allOk())
        var manual: ManualLocation? = ManualLocation(1, "길동역", "Gildong Station", 37.5, 127.1, ManualFix(37.5, 127.1, 20.0, 1.0), 1.0)
        var verdict: ManualVerdict? = null
        val m = DirectionsViewModel(RouteService(client), SearchService(client), RecentSearchStore(InMemoryKeyValueStore()), FakeLocator({ seoul }), { "ko" }, ko, SavedStateHandle(), prefill = MutableStateFlow(null), takePrefill = { false }, io = dispatcher, manual = { manual }, verdict = { verdict })
        m.openPicker(DirectionsFieldTarget.from); m.selectCurrent(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals("출발지, 지정한 위치, 길동역", m.fieldText(DirectionsFieldTarget.from, accessible = true, lang = "ko"))
        verdict = ManualVerdict.undecidable
        assertEquals("출발지, 지정한 위치, 길동역(위치 확인 불가)", m.fieldText(DirectionsFieldTarget.from, accessible = false, lang = "ko"))
        verdict = ManualVerdict.keep
        assertEquals("출발지, 지정한 위치, Gildong Station (길동역)", m.fieldText(DirectionsFieldTarget.from, accessible = false, lang = "en"))
        assertEquals("출발지, 지정한 위치, Gildong Station", m.fieldText(DirectionsFieldTarget.from, accessible = true, lang = "en"))
        manual = null // 해제되면 현행 GPS 갈래
        assertEquals("출발지, 현재 위치", m.fieldText(DirectionsFieldTarget.from, accessible = true, lang = "ko"))
    }

    // ── E50 수단 재조회 ──────────────────────────────────────────────────────

    private val transitWithAxes = transitBody.replace("\"totalCandidates\":", "\"requeryAxes\":[\"busOnly\",\"subwayOnly\",\"scenic\"],\"totalCandidates\":")
    private val busOnlyFound = HttpResponse(200, """{"result":{"recommended":{"summary":{"totalMinutes":71,"fare":1500,"transfers":0,"walkMinutes":18},"legs":[],"routeKey":"b0"},"alternatives":[],"totalCandidates":1}}""")
    private val noneBody = HttpResponse(200, """{"result":null}""")

    private fun requeryRoutes(bus: HttpResponse = busOnlyFound, subway: HttpResponse = noneBody, delay: Long = 0) =
        Routes(transit = transitWithAxes, walk = walkBody, car = carBody, requery = mapOf("2" to bus, "1" to subway), requeryDelay = delay)

    private fun settledVm(r: Routes, lang: String = "ko", locator: FakeLocator = FakeLocator({ seoul })): DirectionsViewModel {
        val m = vm(r, locator = locator, lang = lang)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        return m
    }

    @Test fun `재조회 찾음 - 조회 시점 좌표로 pathType을 싣고 요청 축 이름으로 목록 끝에 붙고 그 행으로 착지`() = runTest(dispatcher) {
        val r = requeryRoutes()
        val m = settledVm(r)
        val transit = assertIs<DirectionsModeOutcome.Transit>(m.state.value.results!!.outcomes[DirectionsMode.transit])
        assertEquals(listOf(TransitModeAxis.busOnly, TransitModeAxis.subwayOnly), transit.result.knownRequeryAxes)
        val before = m.state.value.landing?.seq ?: 0
        m.requery(TransitModeAxis.busOnly)
        assertEquals(TransitRequeryState.Loading, m.state.value.transitRequery[TransitModeAxis.busOnly])
        dispatcher.scheduler.advanceUntilIdle()
        val url = r.seen.last { pathOf(it) == "/api/route/transit" }
        assertEquals("2", r.param(url, "pathType"))
        assertEquals("1", r.param(url, "includeStops"))
        assertEquals(r.param(r.seen.first { pathOf(it) == "/api/route/transit" }, "origin"), r.param(url, "origin")) // 같은 출발지
        val found = assertIs<TransitRequeryState.Found>(m.state.value.transitRequery[TransitModeAxis.busOnly]).route
        assertEquals(listOf("busOnly"), found.highlight)
        assertNull(found.displayIndex)
        assertEquals(listOf(found), m.state.value.requeriedRoutes)
        assertEquals(LandingTarget.RequeriedRoute("b0"), m.state.value.landing?.target)
        assertTrue(m.state.value.landing!!.seq > before)
        assertEquals(ko.get("route.transit.alternativeBusOnly"), transitAlternativeName(found, ko)) // 이름 = 요청 축
    }

    /** E64: 대중교통이 도보보다 빠르면 맨 위, 순서는 조회 완료 때 1회뿐이라 수단 재조회가 섹션을 옮기지 않는다. */
    @Test fun `대중교통이 빠르면 맨 위이고 재조회 뒤에도 순서가 그대로다`() = runTest(dispatcher) {
        // 대표 경로 34분 → 10분(도보는 1806초 = 표시 30분).
        val fastTransit = transitWithAxes.replaceFirst("\"totalMinutes\":34", "\"totalMinutes\":10")
        assertTrue(fastTransit != transitWithAxes)
        val m = settledVm(Routes(transit = fastTransit, walk = walkBody, car = carBody, requery = mapOf("2" to busOnlyFound, "1" to noneBody)))
        val order = listOf(DirectionsMode.transit, DirectionsMode.car, DirectionsMode.walk)
        assertEquals(order, m.state.value.results!!.displayedModes)
        val results = m.state.value.results
        m.requery(TransitModeAxis.busOnly); dispatcher.scheduler.advanceUntilIdle()
        assertIs<TransitRequeryState.Found>(m.state.value.transitRequery[TransitModeAxis.busOnly])
        assertSame(results, m.state.value.results)
        assertEquals(order, m.state.value.results!!.displayedModes)
    }

    @Test fun `재조회 없음 - 문장으로 착지하고 통지 없음`() = runTest(dispatcher) {
        val m = settledVm(requeryRoutes())
        val notice = m.state.value.notice
        m.requery(TransitModeAxis.subwayOnly); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(TransitRequeryState.NotFound, m.state.value.transitRequery[TransitModeAxis.subwayOnly])
        assertEquals(LandingTarget.RequeryNone(TransitModeAxis.subwayOnly), m.state.value.landing?.target)
        assertEquals(notice, m.state.value.notice)
        assertEquals(emptyList(), m.state.value.requeriedRoutes)
    }

    @Test fun `재조회 실패 - 버튼 유지, 착지 없음, 실패 통지와 실패 진동`() = runTest(dispatcher) {
        val m = settledVm(requeryRoutes(bus = HttpResponse(502, "{}")))
        val landing = m.state.value.landing
        m.requery(TransitModeAxis.busOnly); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(TransitRequeryState.Failed, m.state.value.transitRequery[TransitModeAxis.busOnly])
        assertEquals(landing, m.state.value.landing)
        assertEquals(ko.get("route.transit.requeryBusOnlyFailed"), m.state.value.notice.text)
        assertEquals(HapticKind.failure, m.state.value.notice.haptic)
        // 재시도가 된다(실패 뒤 버튼이 남는다).
        m.requery(TransitModeAxis.busOnly)
        assertEquals(TransitRequeryState.Loading, m.state.value.transitRequery[TransitModeAxis.busOnly])
    }

    @Test fun `재조회 15초 초과는 실패`() = runTest(dispatcher) {
        val m = settledVm(requeryRoutes(delay = 20_000))
        m.requery(TransitModeAxis.busOnly); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(TransitRequeryState.Failed, m.state.value.transitRequery[TransitModeAxis.busOnly])
    }

    @Test fun `조회 중 재탭은 무시한다`() = runTest(dispatcher) {
        val r = requeryRoutes(delay = 1_000)
        val m = settledVm(r)
        m.requery(TransitModeAxis.busOnly); m.requery(TransitModeAxis.busOnly)
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(1, r.seen.count { r.param(it, "pathType") != null })
    }

    @Test fun `새 조회·필드 변경은 진행 중 재조회를 버리고 상태를 비운다`() = runTest(dispatcher) {
        val m = settledVm(requeryRoutes(delay = 1_000))
        m.requery(TransitModeAxis.busOnly)
        m.setEndpoint(DirectionsEndpoint.Place("역삼역", 37.5006, 127.0364), DirectionsFieldTarget.to)
        val landing = m.state.value.landing
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(emptyMap(), m.state.value.transitRequery)
        assertEquals(landing, m.state.value.landing)
        // 결과가 없으니(폐기) 재조회도 부르지 않는다.
        m.requery(TransitModeAxis.busOnly)
        assertEquals(emptyMap(), m.state.value.transitRequery)
    }

    @Test fun `같은 끝점 재조회 버튼 - 진행 중 수단 재조회는 버려지고 새 목록에 붙지 않는다`() = runTest(dispatcher) {
        val m = settledVm(requeryRoutes(delay = 1_000))
        m.requery(TransitModeAxis.busOnly)
        val landing = m.state.value.landing
        m.runQuery() // 조회 버튼을 다시 누른다(필드 변경 없음 — performQuery 경로)
        dispatcher.scheduler.advanceUntilIdle()
        assertNotNull(m.state.value.results)
        assertEquals(emptyMap(), m.state.value.transitRequery)
        assertEquals(emptyList(), m.state.value.requeriedRoutes)
        assertEquals(landing, m.state.value.landing)
    }

    @Test fun `재조회는 다시 측위하지 않고 조회 시점 출발 좌표를 쓴다`() = runTest(dispatcher) {
        var here = seoul
        val locator = FakeLocator({ here })
        val r = requeryRoutes()
        val m = settledVm(r, locator = locator)
        val calls = locator.forces.size
        here = NearbyCoord(37.4, 127.2) // 조회 뒤 사용자가 움직였다
        m.requery(TransitModeAxis.busOnly); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(calls, locator.forces.size)
        assertEquals(r.param(r.seen.first { pathOf(it) == "/api/route/transit" }, "origin"), r.param(r.seen.last { pathOf(it) == "/api/route/transit" }, "origin"))
    }

    @Test fun `화면 이탈은 조회 중 축을 버튼으로 되돌리고 끝난 축은 남긴다`() = runTest(dispatcher) {
        val m = settledVm(requeryRoutes(delay = 1_000))
        m.requery(TransitModeAxis.subwayOnly); dispatcher.scheduler.advanceUntilIdle()
        m.requery(TransitModeAxis.busOnly)
        val landing = m.state.value.landing
        m.onScreenExit()
        dispatcher.scheduler.advanceUntilIdle()
        assertNull(m.state.value.transitRequery[TransitModeAxis.busOnly])
        assertEquals(TransitRequeryState.NotFound, m.state.value.transitRequery[TransitModeAxis.subwayOnly])
        assertEquals(landing, m.state.value.landing) // 늦은 결과가 착지하지 않는다
    }

    @Test fun `재조회는 조회 시점 데이터 언어로 부른다`() = runTest(dispatcher) {
        var lang = "en"
        val r = requeryRoutes()
        val client = APIClient("https://example.test", r)
        val m = DirectionsViewModel(RouteService(client), SearchService(client), RecentSearchStore(InMemoryKeyValueStore()), FakeLocator({ seoul }), { lang }, ko, SavedStateHandle(), prefill = MutableStateFlow(null), takePrefill = { false }, io = dispatcher)
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        lang = "ko"
        m.requery(TransitModeAxis.busOnly); dispatcher.scheduler.advanceUntilIdle()
        assertEquals("en", r.param(r.seen.last { pathOf(it) == "/api/route/transit" }, "lang"))
    }

    // ── 안내 시작 고지(stale-origin §4.4) ────────────────────────────────────

    private val manualAt = ManualLocation(1, "길동역", "Gildong Station", 37.5385, 127.1355, ManualFix(37.5385, 127.1355, 20.0, 1.0), 1.0)

    @Test fun `수동 위치 출발로 조회한 결과에서 시작하면 한 번 고지하고 세션이 살아 있으면 말하지 않는다`() = runTest(dispatcher) {
        var manual: ManualLocation? = manualAt
        val m = vm(allOk(), manual = { manual })
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertTrue(m.state.value.resultsOriginNeedsStartNotice)
        manual = null // 조회 뒤 수동 위치를 꺼도 화면의 경로는 그 좌표에서 계산된 것이다
        val seq = m.state.value.notice.seq
        m.announceGuideStartIfManualOrigin(sessionActive = true)
        assertEquals(seq, m.state.value.notice.seq)
        m.announceGuideStartIfManualOrigin(sessionActive = false)
        assertEquals(ko.get("manualLocation.guideStartsFromCurrent"), m.state.value.notice.text)
        assertNull(m.state.value.notice.haptic)
    }

    @Test fun `옛 위치 출발도 고지 대상이고 GPS 출발·도착만 현재 위치는 아니다`() = runTest(dispatcher) {
        val stale = vm(allOk(), FakeLocator({ throw LocationException(LocationException.Kind.Unavailable) }, stale = StaleFix(37.53, 127.14, 1.0)))
        stale.setEndpoint(gangnam, DirectionsFieldTarget.to)
        stale.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertTrue(stale.state.value.resultsOriginNeedsStartNotice)

        val gps = vm(allOk())
        gps.setEndpoint(gangnam, DirectionsFieldTarget.to)
        gps.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertFalse(gps.state.value.resultsOriginNeedsStartNotice)
        val seq = gps.state.value.notice.seq
        gps.announceGuideStartIfManualOrigin(sessionActive = false)
        assertEquals(seq, gps.state.value.notice.seq)

        val toCurrent = vm(allOk(), manual = { manualAt })
        toCurrent.setEndpoint(gangnam, DirectionsFieldTarget.from)
        toCurrent.setEndpoint(DirectionsEndpoint.Current, DirectionsFieldTarget.to)
        toCurrent.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertFalse(toCurrent.state.value.resultsOriginNeedsStartNotice)
    }

    @Test fun `고지 표식은 결과 폐기와 함께 내려간다`() = runTest(dispatcher) {
        val m = vm(allOk(), manual = { manualAt })
        m.setEndpoint(gangnam, DirectionsFieldTarget.to)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        assertTrue(m.state.value.resultsOriginNeedsStartNotice)
        m.swap()
        assertFalse(m.state.value.resultsOriginNeedsStartNotice)
        assertNull(m.state.value.results)
    }

    // ── RecentEndpoint.labelRoman 왕복 ──────────────────────────────────────

    @Test fun `로마자 표기는 최근 장소·최근 경로·경로 복원을 왕복한다`() = runTest(dispatcher) {
        val store = RecentSearchStore(InMemoryKeyValueStore())
        val m = vm(allOk(), store = store)
        val place = DirectionsEndpoint.Place("강남역", 37.4979, 127.0276, "Gangnam Station")
        m.setEndpoint(place, DirectionsFieldTarget.to)
        assertEquals("Gangnam Station", store.endpoints(RecentEndpointScope.to).first().labelRoman)
        m.runQuery(); dispatcher.scheduler.advanceUntilIdle()
        val route = store.routes().first()
        assertEquals("Gangnam Station", route.to?.labelRoman)
        m.setEndpoint(DirectionsEndpoint.Current, DirectionsFieldTarget.to)
        m.activateRecentRoute(route)
        assertEquals(place, m.state.value.to)
    }
}

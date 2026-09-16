package space.dodoplanet.gildongmu.nearby

import androidx.lifecycle.SavedStateHandle
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.NearbyCoordinateSource
import space.dodoplanet.gildongmu.kit.NearbyCoverage
import space.dodoplanet.gildongmu.kit.NearbyLoadPhase
import space.dodoplanet.gildongmu.kit.NearbyLocationError
import space.dodoplanet.gildongmu.kit.NearbyService
import space.dodoplanet.gildongmu.kit.models.SubwayNearbyResult
import space.dodoplanet.gildongmu.kit.pathOf
import space.dodoplanet.gildongmu.kit.stubbedClient
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** spec §3-5·§5 — 코어는 :kit 실물, 전송은 스텁 + Kit 실캡처 fixture, 좌표는 고정 앵커(측위 없음). */
@OptIn(ExperimentalCoroutinesApi::class)
class NearbyScreenViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private val gildong = NearbyCoordinateSource.Fixed(NearbyCoord(37.538, 127.137))
    private val subwayBody = Fixtures.kit("subway-nearby.json")
    private val emptySubway = """{"stations":[],"nearest":{"stationName":"천호","lines":["5호선","8호선"],"distanceMeters":1800}}"""

    private class Calls { var count = 0 }

    private fun subwayVm(responses: MutableList<HttpResponse>, calls: Calls = Calls(), coordinate: NearbyCoordinateSource = gildong): NearbyScreenViewModel<SubwayNearbyResult> {
        val service = NearbyService(stubbedClient { url ->
            calls.count++
            if (pathOf(url) == "/api/station/subway-arrival/nearby") responses.removeFirst() else HttpResponse(404, "")
        })
        return NearbyScreenViewModel(NearbyKinds.subway(service, testNearbyStrings()), coordinate, testNearbyStrings(), SavedStateHandle())
    }

    @Test fun `재조회 fetch는 직전 payload를 previous로 받는다(spec 판정 25)`() = runTest(dispatcher) {
        val seen = mutableListOf<List<String>?>()
        val spec = NearbyKindSpec<List<String>>(
            coverage = NearbyCoverage.korea,
            fetch = { _, previous -> seen += previous; listOf("a") },
            isEmpty = { it.isEmpty() }, firstKey = { it.firstOrNull() }, loadedNotice = { "n" }, emptyCopy = { "e" },
        )
        val vm = NearbyScreenViewModel(spec, gildong, testNearbyStrings(), SavedStateHandle())
        vm.load(); dispatcher.scheduler.advanceUntilIdle()
        vm.load(force = true); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(listOf(null, listOf("a")), seen)
    }

    @Test fun `묶음별 더 보기 — 공개 수 투영·첫 새 항목 착지·커밋마다 리셋(spec 판정 31)`() = runTest(dispatcher) {
        val vm = subwayVm(mutableListOf(HttpResponse(200, subwayBody), HttpResponse(200, subwayBody)))
        vm.load(); dispatcher.scheduler.advanceUntilIdle()
        val rev = (vm.landing.value as Landing.Key).rev
        vm.revealMoreInGroup("left", totalCount = 25) { i -> "scene-item-left-$i" }
        assertEquals(20, vm.groupWindows.value["left"]); assertEquals(Landing.Key("scene-item-left-10", rev + 1), vm.landing.value)
        vm.revealMoreInGroup("left", 25) { i -> "scene-item-left-$i" }
        assertEquals(25, vm.groupWindows.value["left"])
        vm.revealMoreInGroup("left", 25) { i -> "scene-item-left-$i" } // 더 없음 — 착지 발급 없음
        assertEquals(rev + 2, (vm.landing.value as Landing.Key).rev)
        assertNull(vm.groupWindows.value["right"]) // 없는 묶음은 initialVisible
        vm.load(force = true); dispatcher.scheduler.advanceUntilIdle()
        assertTrue(vm.groupWindows.value.isEmpty()) // willCommit 리셋
    }

    @Test fun `첫 로드는 Loaded·건수 통지·첫 역 착지`() = runTest(dispatcher) {
        val vm = subwayVm(mutableListOf(HttpResponse(200, subwayBody)))
        vm.load(); dispatcher.scheduler.advanceUntilIdle()
        val loaded = assertIs<NearbyLoadPhase.Loaded<SubwayNearbyResult>>(vm.phase.value)
        assertTrue(loaded.payload.stations.isNotEmpty())
        assertEquals("주변 역 ${loaded.payload.stations.size}곳", vm.notice.value.text); assertEquals(space.dodoplanet.gildongmu.a11y.HapticKind.success, vm.notice.value.haptic)
        assertEquals(Landing.Key("station-${loaded.payload.stations.first().stationName}", 1), vm.landing.value)
    }

    @Test fun `새로고침은 통지만 다시 내고 착지는 발급하지 않는다`() = runTest(dispatcher) {
        val vm = subwayVm(mutableListOf(HttpResponse(200, subwayBody), HttpResponse(200, subwayBody)))
        vm.load(); dispatcher.scheduler.advanceUntilIdle()
        val seq1 = vm.notice.value.seq
        vm.load(force = true); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(seq1 + 1, vm.notice.value.seq)
        assertEquals(1, (vm.landing.value as Landing.Key).rev)
    }

    @Test fun `0건은 Loaded이고 빈 문구 통지, 이어 N건이 오면 그때 착지 1회`() = runTest(dispatcher) {
        val vm = subwayVm(mutableListOf(HttpResponse(200, emptySubway), HttpResponse(200, subwayBody)))
        vm.load(); dispatcher.scheduler.advanceUntilIdle()
        val empty = assertIs<NearbyLoadPhase.Loaded<SubwayNearbyResult>>(vm.phase.value)
        assertTrue(vm.isEmpty(empty.payload))
        assertEquals("주변에 지하철역이 없습니다. 가장 가까운 역은 천호, 5호선, 8호선, 1.8km 거리입니다", vm.notice.value.text); assertEquals(space.dodoplanet.gildongmu.a11y.HapticKind.attention, vm.notice.value.haptic)
        assertEquals(Landing.None, vm.landing.value)
        vm.load(force = true); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(1, (vm.landing.value as Landing.Key).rev)
    }

    @Test fun `Loaded 뒤 서버 실패는 목록을 유지하고 새로고침 실패 통지`() = runTest(dispatcher) {
        val vm = subwayVm(mutableListOf(HttpResponse(200, subwayBody), HttpResponse(502, "")))
        vm.load(); dispatcher.scheduler.advanceUntilIdle()
        vm.load(force = true); dispatcher.scheduler.advanceUntilIdle()
        assertIs<NearbyLoadPhase.Loaded<SubwayNearbyResult>>(vm.phase.value)
        assertEquals("새로고침 실패, 유지", vm.notice.value.text); assertEquals(space.dodoplanet.gildongmu.a11y.HapticKind.failure, vm.notice.value.haptic)
    }

    @Test fun `첫 로드 서버 실패는 FailedServer, 통지 없음`() = runTest(dispatcher) {
        val vm = subwayVm(mutableListOf(HttpResponse(502, "")))
        vm.load(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(NearbyLoadPhase.FailedServer, vm.phase.value)
        assertEquals("", vm.notice.value.text)
    }

    @Test fun `한국 밖 앵커는 서버를 부르지 않고 OutOfCoverage`() = runTest(dispatcher) {
        val calls = Calls()
        val vm = subwayVm(mutableListOf(HttpResponse(200, subwayBody)), calls, NearbyCoordinateSource.Fixed(NearbyCoord(35.68, 139.69)))
        vm.load(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(NearbyLoadPhase.OutOfCoverage, vm.phase.value)
        assertEquals(0, calls.count)
    }

    @Test fun `더 보기는 공개 수를 늘리고 첫 새 항목에 착지한다`() = runTest(dispatcher) {
        val vm = subwayVm(mutableListOf(HttpResponse(200, subwayBody)))
        vm.load(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(10, vm.visibleCount.value)
        vm.revealMore(25) { i -> "place-$i" }
        assertEquals(20, vm.visibleCount.value)
        assertEquals(Landing.Key("place-10", 2), vm.landing.value)
        vm.revealMore(25) { i -> "place-$i" }
        assertEquals(25, vm.visibleCount.value)
        vm.revealMore(25) { i -> "place-$i" } // 더 없음 — 변화 없음
        assertEquals(Landing.Key("place-20", 3), vm.landing.value)
    }

    @Test fun `pop 복귀 키는 한 번만 소비된다`() = runTest(dispatcher) {
        val vm = subwayVm(mutableListOf())
        assertNull(vm.returnFocus.take())
        vm.returnFocus.remember("stop-1")
        assertEquals("stop-1", vm.returnFocus.take())
        assertNull(vm.returnFocus.take())
    }

    @Test fun `0건 본문은 통지와 같은 문장(최근접 역 포함)이고 통지는 단위를 풀어쓴다`() = runTest(dispatcher) {
        val vm = subwayVm(mutableListOf(HttpResponse(200, emptySubway)))
        vm.load(); dispatcher.scheduler.advanceUntilIdle()
        val p = (vm.phase.value as NearbyLoadPhase.Loaded<SubwayNearbyResult>).payload
        assertEquals("주변에 지하철역이 없습니다. 가장 가까운 역은 천호, 5호선, 8호선, 1.8km 거리입니다", vm.emptyCopy(p))
        // 통지 경로는 spokenDistanceUnits를 지난다(1.8km는 km라 그대로; m이면 "미터")
        val vm2 = subwayVm(mutableListOf(HttpResponse(200, emptySubway.replace("1800", "800"))))
        vm2.load(); dispatcher.scheduler.advanceUntilIdle()
        assertTrue(vm2.notice.value.text.endsWith("800m 거리입니다"), vm2.notice.value.text) // 시각은 원문
        assertTrue(vm2.notice.value.spoken!!.endsWith("800 미터 거리입니다"), vm2.notice.value.spoken!!) // 낭독형
    }

    @Test fun `재조회 중에도 isLoading이 참이고 끝나면 거짓(phase는 Loaded 유지)`() = runTest(dispatcher) {
        val vm = subwayVm(mutableListOf(HttpResponse(200, subwayBody), HttpResponse(200, subwayBody)))
        vm.load(); dispatcher.scheduler.advanceUntilIdle()
        assertFalse(vm.isLoading.value)
        vm.load(force = true)
        assertTrue(vm.isLoading.value) // launch 직후 동기로 켜진다
        assertIs<NearbyLoadPhase.Loaded<SubwayNearbyResult>>(vm.phase.value)
        dispatcher.scheduler.advanceUntilIdle()
        assertFalse(vm.isLoading.value)
    }

    @Test fun `loadOnEnter는 첫 진입에서만 조회한다(회전 재진입 무시)`() = runTest(dispatcher) {
        val calls = Calls()
        val vm = subwayVm(mutableListOf(HttpResponse(200, subwayBody), HttpResponse(200, subwayBody)), calls)
        vm.loadOnEnter(); dispatcher.scheduler.advanceUntilIdle()
        vm.loadOnEnter(); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(1, calls.count)
    }

    @Test fun `전락 통지 3종 — 권한 회수·정밀도 상실·권역 밖`() = runTest(dispatcher) {
        var coord: NearbyCoord = NearbyCoord(37.538, 127.137)
        var fail: NearbyLocationError? = null
        val source = NearbyCoordinateSource.Current { _ -> fail?.let { throw it } ?: coord }
        val vm = subwayVm(mutableListOf(HttpResponse(200, subwayBody), HttpResponse(200, subwayBody), HttpResponse(200, subwayBody)), coordinate = source)
        vm.load(); dispatcher.scheduler.advanceUntilIdle()
        fail = NearbyLocationError.Denied; vm.load(force = true); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(NearbyLoadPhase.Denied, vm.phase.value); assertEquals("권한 꺼짐", vm.notice.value.text)

        val vm2 = subwayVm(mutableListOf(HttpResponse(200, subwayBody)), coordinate = NearbyCoordinateSource.Current { _ -> fail?.let { throw it } ?: coord })
        fail = null; vm2.load(); dispatcher.scheduler.advanceUntilIdle()
        fail = NearbyLocationError.ReducedAccuracy; vm2.load(force = true); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(NearbyLoadPhase.ReducedAccuracy, vm2.phase.value); assertEquals("정확한 위치 꺼짐", vm2.notice.value.text)

        val vm3 = subwayVm(mutableListOf(HttpResponse(200, subwayBody)), coordinate = NearbyCoordinateSource.Current { _ -> coord })
        vm3.load(); dispatcher.scheduler.advanceUntilIdle()
        coord = NearbyCoord(35.68, 139.69); vm3.load(force = true); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(NearbyLoadPhase.OutOfCoverage, vm3.phase.value); assertEquals("대한민국 안에서 제공", vm3.notice.value.text)
    }

    @Test fun `bus·bike·경유 정류소 조립기 — 첫 로드 착지 키와 건수 통지`() = runTest(dispatcher) {
        val service = NearbyService(stubbedClient { url ->
            when (pathOf(url)) {
                "/api/bus/nearby" -> HttpResponse(200, Fixtures.kit("bus-nearby.json"))
                "/api/bike/nearby" -> HttpResponse(200, Fixtures.kit("bike-nearby.json"))
                "/api/bus/route" -> HttpResponse(200, Fixtures.kit("bus-route-stops.json"))
                else -> HttpResponse(404, "")
            }
        })
        val s = testNearbyStrings()
        val bus = NearbyScreenViewModel(NearbyKinds.bus(service, s), gildong, s, SavedStateHandle())
        bus.load(); dispatcher.scheduler.advanceUntilIdle()
        val stops = (bus.phase.value as NearbyLoadPhase.Loaded).payload
        assertFalse(bus.isEmpty(stops)); assertEquals("주변 정류소 ${stops.size}곳", bus.notice.value.text)
        assertEquals(Landing.Key("stop-${stops.first().nodeId}", 1), bus.landing.value)

        val bike = NearbyScreenViewModel(NearbyKinds.bike(service, s), gildong, s, SavedStateHandle())
        bike.load(); dispatcher.scheduler.advanceUntilIdle()
        val stations = (bike.phase.value as NearbyLoadPhase.Loaded).payload
        assertEquals("주변 대여소 ${stations.size}곳", bike.notice.value.text)
        assertEquals(Landing.Key("bike-${stations.first().stationId}", 1), bike.landing.value)

        val route = NearbyScreenViewModel(NearbyKinds.busRouteStops(service, s, "seoul", null, "100100018"), NearbyCoordinateSource.None, s, SavedStateHandle())
        route.load(); dispatcher.scheduler.advanceUntilIdle()
        val routeStops = (route.phase.value as NearbyLoadPhase.Loaded).payload
        assertTrue(routeStops.isNotEmpty()); assertEquals("경유 정류소 ${routeStops.size}곳", route.notice.value.text)
        assertEquals(Landing.None, route.landing.value) // 착지 없음(iOS 동형)
    }
}

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
import space.dodoplanet.gildongmu.kit.NearbyLoadPhase
import space.dodoplanet.gildongmu.kit.NearbyService
import space.dodoplanet.gildongmu.kit.models.SubwayNearbyResult
import space.dodoplanet.gildongmu.kit.pathOf
import space.dodoplanet.gildongmu.kit.stubbedClient
import kotlin.test.Test
import kotlin.test.assertEquals
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

    @Test fun `첫 로드는 Loaded·건수 통지·첫 역 착지`() = runTest(dispatcher) {
        val vm = subwayVm(mutableListOf(HttpResponse(200, subwayBody)))
        vm.load(); dispatcher.scheduler.advanceUntilIdle()
        val loaded = assertIs<NearbyLoadPhase.Loaded<SubwayNearbyResult>>(vm.phase.value)
        assertTrue(loaded.payload.stations.isNotEmpty())
        assertEquals("주변 역 ${loaded.payload.stations.size}곳", vm.notice.value.text)
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
        assertEquals("주변에 지하철역이 없습니다. 가장 가까운 역은 천호, 5호선, 8호선, 1.8km 거리입니다", vm.notice.value.text)
        assertEquals(Landing.None, vm.landing.value)
        vm.load(force = true); dispatcher.scheduler.advanceUntilIdle()
        assertEquals(1, (vm.landing.value as Landing.Key).rev)
    }

    @Test fun `Loaded 뒤 서버 실패는 목록을 유지하고 새로고침 실패 통지`() = runTest(dispatcher) {
        val vm = subwayVm(mutableListOf(HttpResponse(200, subwayBody), HttpResponse(502, "")))
        vm.load(); dispatcher.scheduler.advanceUntilIdle()
        vm.load(force = true); dispatcher.scheduler.advanceUntilIdle()
        assertIs<NearbyLoadPhase.Loaded<SubwayNearbyResult>>(vm.phase.value)
        assertEquals("새로고침 실패, 유지", vm.notice.value.text)
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
        assertNull(vm.takeReturnFocus())
        vm.rememberReturnFocus("stop-1")
        assertEquals("stop-1", vm.takeReturnFocus())
        assertNull(vm.takeReturnFocus())
    }
}

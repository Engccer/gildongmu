package space.dodoplanet.gildongmu.place

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.HttpTransport
import space.dodoplanet.gildongmu.kit.StationPhoneResult
import space.dodoplanet.gildongmu.kit.StationPhoneService
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 경유역 전화번호 저장소(iOS `StationPhoneStore` 미러, E44 spec §5.6) — 가상 시간으로 수명 규칙을 잠근다: 5분 신선·재조회, 6분 축출,
 * 실패는 도장 없음·낡은 값을 덮지 않음, 진행 중 공유, 소비자 취소와 무관한 기록.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StationPhoneStoreTest {
    private val stationBody = """{"places":[{"id":"kakao-1","name":"천호역 5호선","category":"교통,수송 > 지하철,전철 > 수도권5호선","address":"","roadAddress":"","lat":37.5387,"lng":127.1234,"phone":"02-6311-5471"}],"provider":"kakao","query":"천호역"}"""

    /** 응답을 차례로 바꿀 수 있고 1초 걸리는 전송(가상 시간). */
    private class ScriptedTransport(var respond: () -> HttpResponse) : HttpTransport {
        var calls = 0
        override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
            calls++
            delay(1_000)
            return respond()
        }
    }

    private fun TestScope.store(t: ScriptedTransport) =
        StationPhoneStore(StationPhoneService(APIClient("https://example.test", t)), backgroundScope) { testScheduler.currentTime / 1_000.0 }

    private val ok = { HttpResponse(200, stationBody) }
    private val down = { HttpResponse(502, "") }
    private val line = "수도권 5호선"

    private fun StationPhoneStore.shown() = result("천호", 37.5387, 127.1234, line)

    @Test fun `신선한 동안은 네트워크 없이 돌아오고 5분이 지나면 다시 조회한다`() = runTest {
        val t = ScriptedTransport(ok)
        val s = store(t)
        assertNull(s.shown())
        assertEquals(StationPhoneResult.Direct("02-6311-5471"), s.resolve("천호", 37.5387, 127.1234, line))
        assertEquals(StationPhoneResult.Direct("02-6311-5471"), s.shown())
        advanceTimeBy(200_000)
        s.resolve("천호", 37.5387, 127.1234, line)
        assertEquals(1, t.calls)
        advanceTimeBy(100_000) // 기록 뒤 301초
        s.resolve("천호", 37.5387, 127.1234, line)
        assertEquals(2, t.calls)
    }

    @Test fun `같은 키 진행 중 조회는 공유한다`() = runTest {
        val t = ScriptedTransport(ok)
        val s = store(t)
        val a = async { s.resolve("천호", 37.5387, 127.1234, line) }
        val b = async { s.resolve("천호역", 37.5387, 127.1234, "5호선") } // 같은 키(이름 정규화·노선 정체성)
        assertEquals(a.await(), b.await())
        assertEquals(1, t.calls)
    }

    @Test fun `소비자가 사라져도 공유 조회는 끝까지 돌고 기록된다`() = runTest {
        val t = ScriptedTransport(ok)
        val s = store(t)
        val consumer = launch { s.resolve("천호", 37.5387, 127.1234, line) }
        runCurrent()
        consumer.cancel()
        advanceTimeBy(2_000)
        assertEquals(StationPhoneResult.Direct("02-6311-5471"), s.shown())
    }

    @Test fun `첫 조회 실패는 실패 줄이고 도장이 없어 다음 조회가 재시도한다`() = runTest {
        val t = ScriptedTransport(down)
        val s = store(t)
        assertEquals(StationPhoneResult.Failed, s.resolve("천호", 37.5387, 127.1234, line))
        assertEquals(StationPhoneResult.Failed, s.shown())
        t.respond = ok
        s.resolve("천호", 37.5387, 127.1234, line)
        assertEquals(2, t.calls)
        assertEquals(StationPhoneResult.Direct("02-6311-5471"), s.shown())
    }

    @Test fun `낡은 번호 위의 갱신 실패는 번호를 덮지 않고, 보관 한도에서 곧바로 실패로 바뀐다`() = runTest {
        val t = ScriptedTransport(ok)
        val s = store(t)
        s.resolve("천호", 37.5387, 127.1234, line) // 기록 t=1s
        advanceTimeBy(301_000)
        t.respond = down
        assertEquals(StationPhoneResult.Failed, s.resolve("천호", 37.5387, 127.1234, line))
        assertEquals(StationPhoneResult.Direct("02-6311-5471"), s.shown()) // 번호 유지(줄 종류 불변)
        advanceTimeBy(60_000) // 기록 뒤 360초 넘김
        runCurrent()
        assertEquals(StationPhoneResult.Failed, s.shown()) // 빈 줄을 거치지 않고 실패 줄로 한 번
    }

    @Test fun `아무도 갱신하지 않은 값은 6분 뒤 모름으로 지운다`() = runTest {
        val s = store(ScriptedTransport(ok))
        s.resolve("천호", 37.5387, 127.1234, line)
        advanceTimeBy(359_000)
        assertEquals(StationPhoneResult.Direct("02-6311-5471"), s.shown())
        advanceTimeBy(2_000)
        runCurrent()
        assertNull(s.shown())
    }

    @Test fun `화면에 떠 있으면 30초 재확인이 축출 전에 갱신해 줄이 사라지지 않는다`() = runTest {
        val t = ScriptedTransport(ok)
        val s = store(t)
        val keeper = launch { s.keepFresh("천호", 37.5387, 127.1234, line) }
        repeat(30) {
            advanceTimeBy(30_000)
            assertEquals(StationPhoneResult.Direct("02-6311-5471"), s.shown())
        }
        keeper.cancel()
        assertTrue(t.calls in 3..4, "15분 동안 5분마다 한 번 — 30초마다 부르지만 신선하면 네트워크 0 (calls=${t.calls})")
    }

    @Test fun `노선 표가 모르는 노선은 조회하지 않고 없음이다`() = runTest {
        val t = ScriptedTransport(ok)
        val s = store(t)
        assertEquals(StationPhoneResult.Unavailable, s.resolve("천호", 37.5387, 127.1234, "화성 트램"))
        assertEquals(StationPhoneResult.Unavailable, s.result("천호", 37.5387, 127.1234, "화성 트램"))
        assertEquals(0, t.calls)
    }

    @Test fun `펼침 일괄 조회는 받은 역 전부를 조회한다`() = runTest {
        val t = ScriptedTransport(ok)
        val s = store(t)
        s.prefetch(listOf(TransitLegStop(name = "천호", lat = 37.5387, lng = 127.1234), TransitLegStop(name = "강동", lat = 37.5358, lng = 127.1323)), line)
        advanceTimeBy(2_000)
        assertEquals(2, t.calls)
        assertEquals(StationPhoneResult.Direct("02-6311-5471"), s.shown())
        assertEquals(StationPhoneResult.Unavailable, s.result("강동", 37.5358, 127.1323, line)) // 강동 POI가 응답에 없다
    }
}

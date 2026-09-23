package space.dodoplanet.gildongmu.place

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.HapticKind
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.HttpTransport
import space.dodoplanet.gildongmu.kit.StationPhoneResult
import space.dodoplanet.gildongmu.kit.StationPhoneService
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * 역 전화 액션의 단일 창구(E45 spec §5.1, iOS `callStationPhone` 미러) — 번호 있음 무통지·다이얼 실패는 실패 창구·없음·모름(조회 킥오프)·실패.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StationPhoneCallTest {
    private val body = """{"places":[{"id":"kakao-1","name":"천호역 5호선","category":"교통,수송 > 지하철,전철 > 수도권5호선","address":"","roadAddress":"","lat":37.5387,"lng":127.1234,"phone":"02-6311-5471"}],"provider":"kakao","query":"천호역"}"""
    private val stop = TransitLegStop(name = "천호", lat = 37.5387, lng = 127.1234)
    private val line = "수도권 5호선"

    private class CountingTransport(val respond: () -> HttpResponse) : HttpTransport {
        var calls = 0
        override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
            calls++
            delay(1_000)
            return respond()
        }
    }

    private fun TestScope.store(t: HttpTransport) =
        StationPhoneStore(StationPhoneService(APIClient("https://example.test", t)), backgroundScope) { testScheduler.currentTime / 1_000.0 }

    @Test fun `번호가 있으면 다이얼러를 열고 통지하지 않는다`() = runTest {
        val s = store(CountingTransport { HttpResponse(200, body) })
        s.resolve(stop.name, stop.lat, stop.lng, line)
        val dialed = mutableListOf<String>()
        assertNull(callStationPhone(s, stop, line) { dialed += it; true })
        assertEquals(listOf("02-6311-5471"), dialed)
    }

    @Test fun `번호가 있어도 열지 못하면 조회 실패와 같은 통지다`() = runTest {
        val s = store(CountingTransport { HttpResponse(200, body) })
        s.resolve(stop.name, stop.lat, stop.lng, line)
        assertEquals(StationPhoneNotice(R.string.android_station_phoneError, HapticKind.failure), callStationPhone(s, stop, line) { false })
    }

    @Test fun `모름이면 조회를 킥오프한 뒤 찾고 있다고 말한다`() = runTest {
        val t = CountingTransport { HttpResponse(200, body) }
        val s = store(t)
        assertEquals(StationPhoneNotice(R.string.android_station_phonePending, HapticKind.attention), callStationPhone(s, stop, line) { error("번호 없음") })
        advanceTimeBy(5_000); runCurrent() // 축출 예약(6분)까지 돌리지 않는다
        // 문장이 사후적으로 참이 된다 — 누른 뒤 번호가 들어온다.
        assertEquals(1, t.calls)
        assertEquals(StationPhoneResult.Direct("02-6311-5471"), s.result(stop.name, stop.lat, stop.lng, line))
    }

    @Test fun `노선 표가 모르면 없다고 말하고 조회하지 않는다`() = runTest {
        val t = CountingTransport { HttpResponse(200, body) }
        val s = store(t)
        assertEquals(StationPhoneNotice(R.string.android_station_phoneMissing, HapticKind.attention), callStationPhone(s, stop, "") { error("번호 없음") })
        advanceTimeBy(5_000); runCurrent()
        assertEquals(0, t.calls)
    }

    @Test fun `조회 실패면 실패로 말한다`() = runTest {
        val s = store(CountingTransport { HttpResponse(502, "") })
        s.resolve(stop.name, stop.lat, stop.lng, line)
        assertEquals(StationPhoneNotice(R.string.android_station_phoneError, HapticKind.failure), callStationPhone(s, stop, line) { error("번호 없음") })
    }

    @Test fun `모든 판정 결과가 리소스로 옮겨진다`() {
        // :kit이 키를 늘렸는데 앱 갈래가 빠지면 디버그 빌드에서 check가 던진다 — 전 상태를 한 번씩 지나 잠근다.
        assertNull(stationPhoneNotice(StationPhoneResult.Direct("1")))
        assertNull(stationPhoneNotice(StationPhoneResult.Representative("1")))
        assertEquals(R.string.android_station_phoneMissing, stationPhoneNotice(StationPhoneResult.Unavailable)?.text)
        assertEquals(R.string.android_station_phoneError, stationPhoneNotice(StationPhoneResult.Failed)?.text)
        assertEquals(R.string.android_station_phonePending, stationPhoneNotice(null)?.text)
    }
}

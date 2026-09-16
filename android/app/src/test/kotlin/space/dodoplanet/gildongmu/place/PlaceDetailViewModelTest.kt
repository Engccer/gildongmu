package space.dodoplanet.gildongmu.place

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.PlaceHoursService
import space.dodoplanet.gildongmu.kit.PlaceHoursToday
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.stubbedClient
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

@OptIn(ExperimentalCoroutinesApi::class)
class PlaceDetailViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private val strings = PlaceStrings(
        copied = { "주소 복사됨" }, noAppToOpen = { "열 수 있는 앱이 없습니다" },
        hoursLine = { "오늘 영업시간 $it (Google Maps)" }, allDay = { "24시간" }, closed = { "오늘 휴무 (Google Maps)" }, nextDay = { "다음 날 $it" },
    )
    private val place = Place(id = "kakao-7", name = "카페", category = "카페", address = "서울", roadAddress = "서울 강동구 천호대로 1", lat = 37.5, lng = 127.1)
    private fun vm(body: HttpResponse) = PlaceDetailViewModel(place, PlaceHoursService(stubbedClient { body }), strings)

    @Test fun `영업시간 200이면 한 줄, 그 밖(429·404·hours null)은 줄 없음·통지 없음`() = runTest(dispatcher) {
        val ok = vm(HttpResponse(200, """{"hours":{"ranges":[{"open":"09:00","close":"18:00","closesNextDay":false}],"allDay":false}}"""))
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals("오늘 영업시간 09:00~18:00 (Google Maps)", ok.hoursLine.value)
        for (r in listOf(HttpResponse(429, ""), HttpResponse(404, ""), HttpResponse(200, """{"hours":null}"""))) {
            val v = vm(r); dispatcher.scheduler.advanceUntilIdle()
            assertNull(v.hoursLine.value); assertEquals("", v.notice.value.text)
        }
    }

    @Test fun `hoursLineText — 24시간·휴무·다음 날 마감`() {
        assertEquals("오늘 영업시간 24시간 (Google Maps)", hoursLineText(PlaceHoursToday(emptyList(), allDay = true), strings))
        assertEquals("오늘 휴무 (Google Maps)", hoursLineText(PlaceHoursToday(emptyList(), allDay = false), strings))
        val late = PlaceHoursToday(listOf(PlaceHoursToday.Range("11:00", "14:00", false), PlaceHoursToday.Range("18:00", "02:00", true)), allDay = false)
        assertEquals("오늘 영업시간 11:00~14:00, 18:00~다음 날 02:00 (Google Maps)", hoursLineText(late, strings))
    }

    @Test fun `복사·열기 실패 통지는 seq를 올린다, 카카오 id`() = runTest(dispatcher) {
        val v = vm(HttpResponse(404, ""))
        v.onCopied(); assertEquals("주소 복사됨", v.notice.value.text); val s1 = v.notice.value.seq
        v.onCopied(); assertEquals(s1 + 1, v.notice.value.seq)
        v.onOpenFailed(); assertEquals("열 수 있는 앱이 없습니다", v.notice.value.text)
        assertEquals("7", v.kakaoPlaceId)
    }
}

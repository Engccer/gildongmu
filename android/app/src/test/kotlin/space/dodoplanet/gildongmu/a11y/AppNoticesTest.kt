package space.dodoplanet.gildongmu.a11y

import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertSame

/** spec §13-5·판정 33 — 앱 통지 큐(덮이지 않음·발화 시점 소비)와 병합 순수 함수(한 문장·새 seq). */
class AppNoticesTest {
    @BeforeTest fun reset() = AppNotices.reset()
    @AfterTest fun clear() = AppNotices.reset()

    @Test fun `mergeNotices — 앱 통지가 없으면 화면 통지 그대로`() {
        val screen = Notice(3, "주변 역 3곳", "주변 역 3곳")
        assertSame(screen, mergeNotices(screen, null, 99))
    }

    @Test fun `mergeNotices — 앱 통지가 앞에 붙은 한 문장, 새 seq, 낭독형은 같은 순서`() {
        val merged = mergeNotices(Notice(3, "주변 역 3곳, 약 120m", "주변 역 3곳, 약 120 미터"), Notice(1, "이동이 감지되어 지정한 위치를 해제했습니다"), 7)
        assertEquals(7, merged.seq)
        assertEquals("이동이 감지되어 지정한 위치를 해제했습니다, 주변 역 3곳, 약 120m", merged.text)
        assertEquals("이동이 감지되어 지정한 위치를 해제했습니다, 주변 역 3곳, 약 120 미터", merged.spoken)
        val same = mergeNotices(Notice(3, "주변 역 3곳"), Notice(1, "해제"), 8)
        assertNull(same.spoken) // 낭독형이 시각과 같으면 덮지 않는다
        val onlyApp = mergeNotices(Notice(0, ""), Notice(1, "해제"), 9)
        assertEquals("해제", onlyApp.text)
    }

    @Test fun `post는 덮지 않고 큐에 넣고, consume은 그 seq일 때만 다음으로 넘긴다`() {
        AppNotices.post("첫째"); AppNotices.post("둘째")
        val first = AppNotices.pending.value!!
        assertEquals("첫째", first.text)
        AppNotices.consume(first.seq + 100) // 다른 seq — 무시
        assertEquals("첫째", AppNotices.pending.value!!.text)
        AppNotices.consume(first.seq)
        assertEquals("둘째", AppNotices.pending.value!!.text)
        AppNotices.consume(AppNotices.pending.value!!.seq)
        assertNull(AppNotices.pending.value)
    }
}

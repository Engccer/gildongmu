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
        // 진동은 앱 통지의 종류가 이기고, null이면 화면 것(spec §14-3)
        assertEquals(HapticKind.attention, mergeNotices(Notice(3, "주변 역 3곳", haptic = HapticKind.success), Notice(1, "해제", haptic = HapticKind.attention), 10).haptic)
        assertEquals(HapticKind.success, mergeNotices(Notice(3, "주변 역 3곳", haptic = HapticKind.success), Notice(1, "해제"), 11).haptic)
        AppNotices.post("언어를 바꿨습니다", haptic = HapticKind.success); assertEquals(HapticKind.success, AppNotices.pending.value!!.haptic)
    }

    @Test fun `post는 덮지 않고 큐에 넣고, claim은 한 소유자만, consume은 집은 seq일 때만 다음으로 넘긴다`() {
        AppNotices.post("첫째"); AppNotices.post("둘째")
        val first = AppNotices.pending.value!!
        assertEquals("첫째", first.text)
        assertNull(AppNotices.claim(first.seq + 100)) // 다른 seq — 못 집는다
        assertEquals(first, AppNotices.claim(first.seq)); assertNull(AppNotices.pending.value) // 집으면 pending이 빈다(다른 StatusLine이 못 본다)
        assertNull(AppNotices.claim(first.seq)) // 이미 집혔다
        AppNotices.consume(first.seq + 100) // 집지 않은 seq — 무시
        assertNull(AppNotices.pending.value)
        AppNotices.consume(first.seq) // 발화 성공 → 큐 머리 승격
        assertEquals("둘째", AppNotices.pending.value!!.text)
        val second = AppNotices.claim(AppNotices.pending.value!!.seq)!!; AppNotices.consume(second.seq)
        assertNull(AppNotices.pending.value)
    }

    @Test fun `restore — 발화 전에 떠난 통지는 pending으로 돌아오고, 그 사이 앉은 통지보다 먼저 낭독된다`() {
        AppNotices.post("첫째")
        val first = AppNotices.claim(AppNotices.pending.value!!.seq)!!
        AppNotices.post("둘째") // claim 중 도착 — 빈 pending에 앉는다
        assertEquals("둘째", AppNotices.pending.value!!.text)
        AppNotices.restore(first.seq)
        assertEquals("첫째", AppNotices.pending.value!!.text)
        AppNotices.restore(first.seq) // 이중 restore 무시
        val again = AppNotices.claim(AppNotices.pending.value!!.seq)!!; assertEquals("첫째", again.text); AppNotices.consume(again.seq)
        assertEquals("둘째", AppNotices.pending.value!!.text)
    }
}

package space.dodoplanet.gildongmu.nav

import kotlin.test.Test
import kotlin.test.assertEquals

/** iOS `AppTab.order`·`initial` 미러 — 정식판은 채팅이 첫 탭이자 기본 탭, 실험판은 검색부터. */
class AppTabTest {
    @Test fun `정식판 순서는 채팅-검색-길찾기-내 주변이고 기본 탭은 채팅`() {
        assertEquals(listOf(AppTab.chat, AppTab.search, AppTab.directions, AppTab.nearby), AppTab.order(experimental = false))
        assertEquals(AppTab.chat, AppTab.initial(experimental = false))
    }

    @Test fun `실험판 순서는 검색-길찾기-내 주변-채팅이고 기본 탭은 검색`() {
        assertEquals(listOf(AppTab.search, AppTab.directions, AppTab.nearby, AppTab.chat), AppTab.order(experimental = true))
        assertEquals(AppTab.search, AppTab.initial(experimental = true))
    }

    @Test fun `rawValue는 이름 그대로(안정 식별자)`() {
        assertEquals(listOf("chat", "search", "directions", "nearby"), AppTab.entries.map { it.rawValue })
    }
}

package space.dodoplanet.gildongmu.directions

import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.guide.ui.WalkGuideNotice
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 도보 안내 1회성 공지(iOS `WalkGuideNotice`): 키 이름이 iOS와 같고, 저장은 확인 버튼만 한다(닫기는 다음 진입에 다시 뜬다). */
class WalkGuideNoticeTest {
    @Test fun `확인 전에는 미확인이고 확인하면 iOS와 같은 키에 저장된다`() = runTest {
        val kv = InMemoryKeyValueStore()
        val notice = WalkGuideNotice(kv, UnconfinedTestDispatcher(testScheduler))
        assertFalse(notice.isConfirmed())
        notice.confirm()
        assertTrue(notice.isConfirmed())
        assertEquals("true", kv.getString("walkGuideNoticeV1"))
    }

    @Test fun `닫기는 저장하지 않는다 - 확인 버튼만 confirm을 부른다`() {
        val screen = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu/directions/DirectionsScreen.kt").readText()
        val dismiss = Regex("""onDismiss = \{([^}]*)\}""").find(screen)?.groupValues?.get(1)
        assertTrue(dismiss != null && "noticeOpen = false" in dismiss, "공지 시트 닫기 배선")
        assertFalse("confirm" in dismiss, "닫기가 저장하면 읽지 않고 닫은 사용자에게 다시 뜨지 않는다")
        assertEquals(1, Regex("""notice\.confirm\(\)""").findAll(screen).count())
    }
}

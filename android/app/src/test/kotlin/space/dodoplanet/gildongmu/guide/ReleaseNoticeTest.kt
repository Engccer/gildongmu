package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.guide.ui.ReleaseNotice
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 2.0 공지(iOS `ReleaseNotice`): 키 이름이 iOS와 같고, 앱을 열 때 뜨며, 저장은 확인 버튼만 한다(닫기는 다음 실행에 다시 뜬다). */
class ReleaseNoticeTest {
    private val pkg = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu")

    @Test fun `확인 전에는 미확인이고 확인하면 iOS와 같은 키에 저장된다`() = runTest {
        val kv = InMemoryKeyValueStore()
        val notice = ReleaseNotice(kv, UnconfinedTestDispatcher(testScheduler))
        assertFalse(notice.isConfirmed())
        notice.confirm()
        assertTrue(notice.isConfirmed())
        assertEquals("true", kv.getString("releaseNoticeV2"))
    }

    @Test fun `닫기는 저장하지 않는다 - 확인 버튼만 confirm을 부른다`() {
        val root = pkg.resolve("nav/AppRoot.kt").readText()
        val dismiss = Regex("""onDismiss = \{([^}]*)\}""").find(root.substringAfter("ReleaseNoticeSheet("))?.groupValues?.get(1)
        assertTrue(dismiss != null && "releaseNoticeOpen = false" in dismiss, "공지 시트 닫기 배선")
        assertFalse("confirm" in dismiss, "닫기가 저장하면 읽지 않고 닫은 사용자에게 다시 뜨지 않는다")
        assertEquals(1, Regex("""releaseNotice\.confirm\(\)""").findAll(root).count())
    }

    @Test fun `새 소식 창은 바깥 탭 닫기를 꺼 머티리얼 「시트 닫기」가 들리지 않는다`() {
        val sheet = pkg.resolve("guide/ui/ReleaseNoticeSheet.kt").readText()
        assertTrue(sheet.contains("properties = ModalBottomSheetProperties(shouldDismissOnClickOutside = false)"))
    }

    @Test fun `옛 도보 공지는 길찾기 화면에 남지 않는다`() {
        val screen = pkg.resolve("directions/DirectionsScreen.kt").readText()
        assertFalse("WalkGuideNotice" in screen)
        assertFalse("walkNotice" in screen)
        assertFalse(pkg.resolve("guide/ui/WalkGuideNoticeSheet.kt").exists())
    }

    @Test fun `행 순서가 iOS와 같다`() {
        val sheet = pkg.resolve("guide/ui/ReleaseNoticeSheet.kt").readText()
        val order = Regex("""R\.string\.android_releaseNotice_(\w+)""").findAll(sheet).map { it.groupValues[1] }.toList()
        assertEquals(listOf("title", "intro", "head1", "body1", "body2", "body3", "body4", "head2", "body5", "body6", "confirm"), order)
    }
}

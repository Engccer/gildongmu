package space.dodoplanet.gildongmu.nav

import org.w3c.dom.Element
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.IdleReset
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 앱 세션(바로가기 진입 B22 ④ · 유휴 리셋 B27 ② · 탭 새로고침 B27 ①)의 순수 판정. iOS `GildongmuApp`·`LaunchActionStore` 계약. */
class AppSessionTest {
    @BeforeTest fun reset() = AppSession.resetForTest()
    @AfterTest fun clean() = AppSession.resetForTest()

    @Test fun `바로가기 액션은 1칸 보류되고 꺼내면 비며 음성 검색만 마이크 신호를 세운다`() {
        AppSession.offer("android.intent.action.MAIN")
        assertNull(AppSession.pending.value) // 일반 실행은 액션이 아니다
        AppSession.offer(AppSession.ACTION_VOICE_SEARCH)
        assertEquals(LaunchAction.voiceSearch, AppSession.take())
        assertNull(AppSession.take()) // 멱등 — 재구성 때 다시 돌아도 리셋은 한 번
        assertTrue(AppSession.voiceStartRequested.value)
        AppSession.offer(AppSession.ACTION_NEARBY)
        assertEquals(LaunchAction.nearby, AppSession.take())
        assertFalse(AppSession.voiceStartRequested.value) // 직전 음성 검색의 잔존 신호는 지운다(유령 마이크 차단)
    }

    @Test fun `유휴 리셋은 10분 초과 복귀에서만, 실시간 안내 중이면 하지 않는다`() {
        assertFalse(AppSession.onForeground(1_000.0, guideActive = false)) // 백그라운드 기록 없음
        AppSession.onBackground(0.0)
        assertFalse(AppSession.onForeground(IdleReset.interval, guideActive = false)) // 경계는 제외
        AppSession.onBackground(0.0)
        assertTrue(AppSession.onForeground(IdleReset.interval + 1, guideActive = false))
        assertTrue(AppSession.takeReset())
        assertFalse(AppSession.takeReset()) // 1회 소비 — 액티비티 재생성이 옛 요청을 다시 실행하지 않는다
        AppSession.onBackground(0.0)
        assertFalse(AppSession.onForeground(IdleReset.interval + 1, guideActive = true)) // 안내 중 복귀는 유휴가 아니다
        assertFalse(AppSession.onForeground(IdleReset.interval * 3, guideActive = false)) // 복귀가 기록을 지웠다
        assertFalse(AppSession.resetPending.value)
    }

    @Test fun `바로가기 진입은 같은 전경 전환의 유휴 판정을 무효화한다`() {
        AppSession.onBackground(0.0)
        AppSession.offer(AppSession.ACTION_NEARBY)
        assertFalse(AppSession.onForeground(IdleReset.interval * 2, guideActive = false))
    }

    @Test fun `새로고침은 1회 소비되고 새 탭 루트의 착지 신호를 한 번 남긴다`() {
        assertFalse(AppSession.takeRefresh())
        assertFalse(AppSession.takeRefreshLanding())
        AppSession.refreshCurrentTab()
        assertFalse(AppSession.resetPending.value) // 새로고침은 현재 탭만 — 전체 리셋과 다른 신호
        assertTrue(AppSession.takeRefresh())
        assertFalse(AppSession.takeRefresh())
        assertTrue(AppSession.takeRefreshLanding())
        assertFalse(AppSession.takeRefreshLanding())
    }

    /** 정식·실험 바로가기 XML: 액션은 `AppSession` 상수와 같고, 패키지는 각 구성의 applicationId다(실험판 `.dev`). */
    @Test fun `바로가기 XML 두 벌은 패키지만 다르고 액션이 AppSession과 같다`() {
        val res = Fixtures.repoRoot.resolve("android/app/src")
        for ((set, pkg) in listOf("main" to "space.dodoplanet.gildongmu", "experimental" to "space.dodoplanet.gildongmu.dev")) {
            val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(res.resolve("$set/res/xml/shortcuts.xml"))
            val intents = doc.getElementsByTagName("intent")
            val actions = (0 until intents.length).map { intents.item(it) as Element }.map { e ->
                assertEquals(pkg, e.getAttributeNS(ANDROID, "targetPackage"), set)
                assertEquals("space.dodoplanet.gildongmu.MainActivity", e.getAttributeNS(ANDROID, "targetClass"), set)
                e.getAttributeNS(ANDROID, "action")
            }
            assertEquals(listOf(AppSession.ACTION_VOICE_SEARCH, AppSession.ACTION_NEARBY), actions, set)
        }
        assertTrue(res.resolve("main/AndroidManifest.xml").readText().contains("android:resource=\"@xml/shortcuts\""))
    }

    private companion object {
        const val ANDROID = "http://schemas.android.com/apk/res/android"
    }
}

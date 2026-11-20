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
        AppSession.offer("android.intent.action.MAIN", owner)
        assertNull(AppSession.pending.value) // 일반 실행은 액션이 아니다
        AppSession.offer(AppSession.ACTION_VOICE_SEARCH, owner)
        assertEquals(LaunchAction.voiceSearch, AppSession.take(owner))
        assertNull(AppSession.take(owner)) // 멱등 — 재구성 때 다시 돌아도 리셋은 한 번
        assertTrue(AppSession.voiceStartRequested.value)
        AppSession.offer(AppSession.ACTION_NEARBY, owner)
        assertEquals(LaunchAction.nearby, AppSession.take(owner))
        assertFalse(AppSession.voiceStartRequested.value) // 직전 음성 검색의 잔존 신호는 지운다(유령 마이크 차단)
    }

    @Test fun `액션은 받은 액티비티만 꺼낸다 — 지워지는 옛 화면이 먼저 가져가지 않는다`() {
        val old = Any()
        AppSession.offer(AppSession.ACTION_VOICE_SEARCH, owner)
        assertNull(AppSession.take(old))
        assertFalse(AppSession.voiceStartRequested.value)
        assertEquals(LaunchAction.voiceSearch, AppSession.take(owner))
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

    @Test fun `프로세스 종료 뒤 복원한 백그라운드 시각으로도 유휴 리셋한다, 살아 있는 기록은 덮지 않는다`() {
        AppSession.restoreBackgroundedAt(0.0)
        assertTrue(AppSession.onForeground(IdleReset.interval + 1, guideActive = false))
        AppSession.onBackground(100.0)
        AppSession.restoreBackgroundedAt(0.0) // 같은 프로세스의 재생성 — 메모리 기록이 정본
        assertFalse(AppSession.onForeground(100.0 + IdleReset.interval, guideActive = false))
        AppSession.restoreBackgroundedAt(null)
        assertNull(AppSession.backgroundedAt)
    }

    @Test fun `바로가기 진입은 같은 전경 전환의 유휴 판정을 무효화한다`() {
        AppSession.onBackground(0.0)
        AppSession.offer(AppSession.ACTION_NEARBY, owner)
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

    /**
     * 정식·실험 바로가기 XML: 액션은 `AppSession` 상수와 같고, 패키지는 각 구성의 applicationId다(실험판 `.dev`).
     * 「음성 검색」은 받아쓰기 게이트의 정책선(API 33, `isDictationAvailable`)을 넘는 기기의 `xml-v33`에만 있다(재리뷰 지적 4).
     */
    @Test fun `바로가기 XML 두 벌은 패키지만 다르고 액션이 AppSession과 같다`() {
        val res = Fixtures.repoRoot.resolve("android/app/src")
        for ((set, pkg) in listOf("main" to "space.dodoplanet.gildongmu", "experimental" to "space.dodoplanet.gildongmu.dev")) {
            for ((dir, expected) in listOf(
                "xml" to listOf(AppSession.ACTION_NEARBY),
                "xml-v33" to listOf(AppSession.ACTION_VOICE_SEARCH, AppSession.ACTION_NEARBY),
            )) {
                val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(res.resolve("$set/res/$dir/shortcuts.xml"))
                val intents = doc.getElementsByTagName("intent")
                val actions = (0 until intents.length).map { intents.item(it) as Element }.map { e ->
                    assertEquals(pkg, e.getAttributeNS(ANDROID, "targetPackage"), "$set/$dir")
                    assertEquals("space.dodoplanet.gildongmu.MainActivity", e.getAttributeNS(ANDROID, "targetClass"), "$set/$dir")
                    e.getAttributeNS(ANDROID, "action")
                }
                assertEquals(expected, actions, "$set/$dir")
            }
        }
        assertFalse(space.dodoplanet.gildongmu.speech.isDictationAvailable(32) { true }) // v33 선이 게이트의 정책선과 같다
        assertTrue(space.dodoplanet.gildongmu.speech.isDictationAvailable(33) { true })
        assertTrue(res.resolve("main/AndroidManifest.xml").readText().contains("android:resource=\"@xml/shortcuts\""))
    }

    /** 바로가기·안내 알림이 태스크의 기준 인텐트를 바꾼 뒤 런처 아이콘으로 돌아올 때 화면이 겹쳐 쌓이지 않는다(재리뷰 지적 1, 한소네 재현). */
    @Test fun `MainActivity는 singleTop이다`() {
        val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder()
            .parse(Fixtures.repoRoot.resolve("android/app/src/main/AndroidManifest.xml"))
        val activities = doc.getElementsByTagName("activity")
        val main = (0 until activities.length).map { activities.item(it) as Element }.single { it.getAttributeNS(ANDROID, "name") == ".MainActivity" }
        assertEquals("singleTop", main.getAttributeNS(ANDROID, "launchMode"))
    }

    private val owner = Any()

    private companion object {
        const val ANDROID = "http://schemas.android.com/apk/res/android"
    }
}

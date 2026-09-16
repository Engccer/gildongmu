package space.dodoplanet.gildongmu.nearby

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.stubbedClient
import space.dodoplanet.gildongmu.location.CurrentAddressStore
import space.dodoplanet.gildongmu.location.LocationPermission
import space.dodoplanet.gildongmu.location.LocationSource
import space.dodoplanet.gildongmu.location.LocationStore
import space.dodoplanet.gildongmu.location.ManualLocationStore
import space.dodoplanet.gildongmu.location.PermissionGate
import space.dodoplanet.gildongmu.location.RawFix
import space.dodoplanet.gildongmu.location.LocationSource.Companion.FUSED

/** 실기기 검사 레인(spec §12-5·§13-6): 허브 10행 + 첫 행 표시줄 버튼(꼬리 "위치 지정하기") — 권한 없음은 실패가 아니라 "위치 권한이 필요합니다"(판정 29), 수동이면 수동 문장, 네트워크 0. */
@RunWith(AndroidJUnit4::class)
class NearbyHubA11yTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private object NoSource : LocationSource {
        override fun isLocationEnabled() = true
        override fun hasProvider(name: String) = false
        override fun subscribe(provider: String, onFix: (RawFix) -> Unit): AutoCloseable = AutoCloseable { }
        override fun elapsedRealtimeMs() = 0L
    }
    private object NoneGate : PermissionGate {
        override fun current() = LocationPermission.None
        override suspend fun request() = LocationPermission.None
    }

    /** 구독 즉시 정확한 fix 하나를 주는 소스 — 표시용 좌표가 잡혀 역지오코딩(네트워크 스텁)이 호출된다. */
    private object FixSource : LocationSource {
        override fun isLocationEnabled() = true
        override fun hasProvider(name: String) = name == FUSED
        override fun subscribe(provider: String, onFix: (RawFix) -> Unit): AutoCloseable { onFix(RawFix(37.5, 127.1, 5.0, elapsedRealtimeMs())); return AutoCloseable { } }
        override fun elapsedRealtimeMs() = android.os.SystemClock.elapsedRealtime()
    }
    private object FineGate : PermissionGate {
        override fun current() = LocationPermission.Fine
        override suspend fun request() = LocationPermission.Fine
    }

    private var calls = 0
    private val store get() = CurrentAddressStore(LocationStore(NoSource, NoneGate), SearchService(stubbedClient { calls++; HttpResponse(500, "") }))

    @Test
    fun locationBarReadsPermissionNeededWhenNone() {
        val manual = ManualLocationStore(InMemoryKeyValueStore()).also { it.hydrate() }
        var picks = 0
        rule.setContent { MaterialTheme { NearbyHubScreen(onOpen = {}, onPick = { picks++ }, takeReturnFocus = { null }, currentAddress = store, manualLocation = manual) } }
        rule.enableAccessibilityChecks()
        rule.waitForIdle()
        val bar = rule.onNodeWithTag("location-bar")
        bar.assertHasClickAction()
        bar.assertTextContains("위치 권한", substring = true)
        bar.assertTextContains("위치 지정하기", substring = true)
        rule.onNodeWithTag(hubKey(NearbyKind.conditions)).assertTextContains("날씨", substring = true)
        assertEquals("권한 없음은 네트워크를 부르지 않는다", 0, calls)
        bar.performClick()
        assertEquals("표시줄 활성화 = 위치 지정 화면", 1, picks)
        rule.onRoot().tryPerformAccessibilityChecks()
    }

    @Test
    fun locationBarReadsManualLocationAndSkipsAddressLookup() {
        val manual = ManualLocationStore(InMemoryKeyValueStore()).also { it.hydrate(); it.set("길동역", null, 37.5, 127.1, null) }
        rule.setContent { MaterialTheme { NearbyHubScreen(onOpen = {}, onPick = {}, takeReturnFocus = { null }, currentAddress = store, manualLocation = manual) } }
        rule.waitForIdle()
        rule.onNodeWithTag("location-bar").assertTextContains("지정한 위치, 길동역(위치 확인 불가), 위치 지정하기")
        assertEquals("수동 위치면 주소 조회가 없다", 0, calls)
    }

    @Test
    fun addressLookupRunsAgainWhenManualLocationIsCleared() {
        val manual = ManualLocationStore(InMemoryKeyValueStore()).also { it.hydrate(); it.set("길동역", null, 37.5, 127.1, null) }
        val fineStore = CurrentAddressStore(LocationStore(FixSource, FineGate), SearchService(stubbedClient { calls++; HttpResponse(500, "") }))
        rule.setContent { MaterialTheme { NearbyHubScreen(onOpen = {}, onPick = {}, takeReturnFocus = { null }, currentAddress = fineStore, manualLocation = manual) } }
        rule.waitForIdle()
        assertEquals("수동 위치가 있는 동안은 조회 0(권한 Fine·fix 있어도)", 0, calls)
        rule.runOnUiThread { manual.clear() } // 자동 해제 전이(iOS `.task(id:)` 동형)
        rule.waitUntil(5_000) { calls == 1 }
        rule.onNodeWithTag("location-bar").assertTextContains("현재 위치", substring = true)
    }
}

package space.dodoplanet.gildongmu.nearby

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.stubbedClient
import space.dodoplanet.gildongmu.location.CurrentAddressStore
import space.dodoplanet.gildongmu.location.LocationPermission
import space.dodoplanet.gildongmu.location.LocationSource
import space.dodoplanet.gildongmu.location.LocationStore
import space.dodoplanet.gildongmu.location.PermissionGate
import space.dodoplanet.gildongmu.location.RawFix

/** 실기기 검사 레인(spec §12-5): 허브 10행 + 첫 행 표시줄 — 권한 없음은 실패가 아니라 "위치 권한이 필요합니다"(판정 29), 네트워크 0. */
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

    @Test
    fun locationBarReadsPermissionNeededWhenNone() {
        var calls = 0
        val store = CurrentAddressStore(LocationStore(NoSource, NoneGate), SearchService(stubbedClient { calls++; HttpResponse(500, "") }))
        rule.setContent { MaterialTheme { NearbyHubScreen(onOpen = {}, takeReturnFocus = { null }, currentAddress = store) } }
        rule.enableAccessibilityChecks()
        rule.waitForIdle()
        rule.onNodeWithTag("location-bar").assertTextContains("위치 권한", substring = true)
        rule.onNodeWithTag(hubKey(NearbyKind.conditions)).assertTextContains("날씨", substring = true)
        assert(calls == 0) { "권한 없음은 네트워크를 부르지 않는다" }
        rule.onRoot().tryPerformAccessibilityChecks()
    }
}

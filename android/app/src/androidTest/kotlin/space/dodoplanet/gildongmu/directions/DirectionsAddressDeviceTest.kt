package space.dodoplanet.gildongmu.directions

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertContentDescriptionContains
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.lifecycle.SavedStateHandle
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import space.dodoplanet.gildongmu.kit.*
import space.dodoplanet.gildongmu.location.StaleFix
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/** 실제 Android Main 코루틴과 Compose 필드에 지연 응답을 흘린다. GPS·서버는 호출하지 않는다. */
@RunWith(AndroidJUnit4::class)
class DirectionsAddressDeviceTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    private val coord = NearbyCoord(37.5385, 127.1355)

    private class Gate<T> {
        val pending = ArrayDeque<Continuation<T>>()
        suspend fun await(): T = suspendCoroutine { pending.addLast(it) }
        fun finish(value: T) = pending.removeFirst().resume(value)
    }

    private inner class Harness {
        var language = "en"
        val locations = Gate<NearbyCoord>()
        val replies = Gate<HttpResponse>()
        val client = APIClient("https://example.test", object : HttpTransport {
            override suspend fun get(url: String, timeoutMs: Long?) = replies.await()
        })
        val vm = DirectionsViewModel(
            RouteService(client), SearchService(client), RecentSearchStore(InMemoryKeyValueStore()),
            object : EndpointLocator {
                override suspend fun currentCoordinate(force: Boolean) = locations.await()
                override suspend fun coordinateForRanking(): NearbyCoord? = null
                override suspend fun coordinateForDisplay(): NearbyCoord? = null
                override fun staleFix(): StaleFix? = null
                override suspend fun requestPreciseLocation() = false
            }, { language }, resourceStrings(rule.activity.resources), SavedStateHandle(),
            prefill = MutableStateFlow(null), io = kotlinx.coroutines.Dispatchers.Main.immediate,
        )
        fun show() = rule.setContent { MaterialTheme { DirectionsScreen(vm) } }
        fun reply(original: String, english: String) =
            replies.finish(HttpResponse(200, """{"address":"$original","addressEn":"$english"}"""))
    }

    @Test fun cancelledLocationCannotOverwriteNewRefreshOrEndItsLoading() {
        val h = rule.runOnIdle { Harness() }
        h.show()
        rule.runOnIdle { h.vm.refreshCurrentLocation() }
        rule.waitUntil(5_000) { h.locations.pending.size == 1 }
        rule.runOnIdle {
            h.vm.setEndpoint(DirectionsEndpoint.Place("역", 37.4979, 127.0276), DirectionsFieldTarget.to)
            h.vm.refreshCurrentLocation()
        }
        rule.waitUntil(5_000) { h.locations.pending.size == 2 }
        rule.runOnIdle { h.locations.finish(coord) }
        rule.runOnIdle {
            assertTrue(h.vm.state.value.isRefreshingCurrent)
            assertTrue(h.replies.pending.isEmpty())
            h.locations.finish(coord)
        }
        rule.waitUntil(5_000) { h.replies.pending.size == 1 }
        rule.runOnIdle { h.reply("새 주소", "New address") }
        rule.waitUntil(5_000) { !h.vm.state.value.isRefreshingCurrent }
        rule.runOnIdle {
            assertEquals("새 주소", h.vm.state.value.currentAddress)
            assertEquals("New address", h.vm.state.value.currentAddressEnglish)
        }
        rule.onNodeWithTag("field-from").assertContentDescriptionContains("새 주소", substring = true)
    }

    @Test fun lateAddressAfterLanguageChangeCannotCommitAndRefreshCanRetry() {
        val h = rule.runOnIdle { Harness() }
        h.show()
        rule.runOnIdle { h.vm.refreshCurrentLocation() }
        rule.waitUntil(5_000) { h.locations.pending.size == 1 }
        rule.runOnIdle { h.locations.finish(coord) }
        rule.waitUntil(5_000) { h.replies.pending.size == 1 }
        rule.runOnIdle {
            h.language = "ko"
            h.reply("옛 주소", "Old address")
        }
        rule.waitUntil(5_000) { !h.vm.state.value.isRefreshingCurrent }
        rule.runOnIdle {
            assertNull(h.vm.state.value.currentAddress)
            assertNull(h.vm.state.value.currentAddressEnglish)
            h.vm.refreshCurrentLocation()
        }
        rule.waitUntil(5_000) { h.locations.pending.size == 1 }
        rule.runOnIdle { h.locations.finish(coord) }
        rule.waitUntil(5_000) { h.replies.pending.size == 1 }
        rule.runOnIdle { h.reply("한국어 주소", "Korean address") }
        rule.waitUntil(5_000) { !h.vm.state.value.isRefreshingCurrent }
        rule.onNodeWithTag("field-from").assertContentDescriptionContains("한국어 주소", substring = true)
    }
}

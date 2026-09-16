package space.dodoplanet.gildongmu

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.kit.NearbyService
import space.dodoplanet.gildongmu.location.LocationPermission
import space.dodoplanet.gildongmu.nav.AppFactories
import space.dodoplanet.gildongmu.nav.AppRoot
import space.dodoplanet.gildongmu.nearby.busRouteStopsFactory
import space.dodoplanet.gildongmu.nearby.nearbyFactory
import space.dodoplanet.gildongmu.nearby.nearbyStrings
import space.dodoplanet.gildongmu.search.SearchStrings
import space.dodoplanet.gildongmu.search.SearchViewModel
import space.dodoplanet.gildongmu.storage.SharedPreferencesStore

/** 단일 액티비티. 화면 골격(탭·스택)은 `nav/AppRoot`. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 위치 권한 손 둘(spec §4): 대기 슬롯은 AppConfig.permissionGate(앱 싱글턴)가 쥔다. 등록은 STARTED 전(onCreate).
        val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            AppConfig.permissionGate.deliver()
        }
        AppConfig.permissionGate.attach { permissions -> permissionLauncher.launch(permissions) }
        // ⚠ Activity를 캡처하지 않는다 — ViewModel은 구성 변경을 넘어 살아 첫 Activity를 붙들면 누수다.
        // 앱 컨텍스트의 리소스도 앱별 언어 변경을 따라간다.
        val app: Context = applicationContext
        val factory = viewModelFactory {
            initializer {
                SearchViewModel(
                    service = SearchService(AppConfig.apiClient),
                    store = RecentSearchStore(SharedPreferencesStore(app)),
                    dataLocale = { AppLocale.dataLocale(app.resources) },
                    strings = searchStrings(app),
                    savedState = createSavedStateHandle(),
                )
            }
        }
        val nearbyService = NearbyService(AppConfig.apiClient)
        val nearby = nearbyStrings(app)
        val factories = AppFactories(
            search = factory,
            nearby = { kind, anchor -> nearbyFactory(kind, anchor, nearbyService, nearby) { AppConfig.locationStore.nearbyCoordinateSource() } },
            busRouteStops = { route -> busRouteStopsFactory(route, nearbyService, nearby) },
            requestPreciseLocation = { AppConfig.permissionGate.request() == LocationPermission.Fine },
            isLocationEnabled = { AppConfig.locationStore.isLocationEnabled() },
        )
        setContent {
            MaterialTheme {
                AppRoot(factories)
            }
        }
    }

    override fun onDestroy() {
        AppConfig.permissionGate.detach()
        super.onDestroy()
    }
}

/** ViewModel 통지 문장(리소스는 화면 몫, spec §4). 호출 시점에 읽는다 — 앱별 언어 변경을 따라간다. */
fun searchStrings(context: Context): SearchStrings = SearchStrings(
    searchingFor = { appLocalized(context.resources, R.string.search_searchingFor, it) },
    failed = { context.getString(R.string.android_search_announceFailed) },
    empty = { context.getString(R.string.android_search_announceEmpty) },
    count = { appLocalized(context.resources, R.string.android_search_announceCount, it) },
    deleted = { context.getString(R.string.recent_deleted) },
    cleared = { context.getString(R.string.recent_cleared) },
    clearedExceptPinned = { context.getString(R.string.recent_clearedExceptPinned) },
)

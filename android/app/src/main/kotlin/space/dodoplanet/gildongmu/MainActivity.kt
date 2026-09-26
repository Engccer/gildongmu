package space.dodoplanet.gildongmu

import android.content.Context
import android.content.res.Resources
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import android.view.WindowInsetsController
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import space.dodoplanet.gildongmu.settings.resolveDarkTheme
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.SearchService
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.BarrierFreeService
import space.dodoplanet.gildongmu.kit.ConditionsService
import space.dodoplanet.gildongmu.kit.NearbyService
import space.dodoplanet.gildongmu.kit.StationService
import space.dodoplanet.gildongmu.kit.WalkInfraService
import space.dodoplanet.gildongmu.nearby.NearbyServices
import space.dodoplanet.gildongmu.location.LocationPermission
import space.dodoplanet.gildongmu.nav.AppFactories
import space.dodoplanet.gildongmu.nav.AppRoot
import space.dodoplanet.gildongmu.nearby.busRouteStopsFactory
import space.dodoplanet.gildongmu.nearby.nearbyFactory
import space.dodoplanet.gildongmu.nearby.nearbyStrings
import space.dodoplanet.gildongmu.kit.PlaceHoursService
import space.dodoplanet.gildongmu.place.placeDetailFactory
import space.dodoplanet.gildongmu.place.placeStrings
import space.dodoplanet.gildongmu.search.SearchStrings
import space.dodoplanet.gildongmu.search.SearchViewModel
import space.dodoplanet.gildongmu.storage.SharedPreferencesStore

/** 단일 액티비티. 화면 골격(탭·스택)은 `nav/AppRoot`. */
class MainActivity : ComponentActivity() {
    /** 앱 언어 오버라이드(spec §14-2): 설정 첫 읽기는 여기서 동기로(첫 프레임이 옳은 언어여야 한다 — 파일 단위 로드 1회 수용). */
    override fun attachBaseContext(base: Context) {
        AppConfig.settings.load()
        super.attachBaseContext(AppConfig.localized(base))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 위치 권한 손 둘(spec §4): 대기 슬롯은 AppConfig.permissionGate(앱 싱글턴)가 쥔다. 등록은 STARTED 전(onCreate).
        val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            AppConfig.permissionGate.deliver()
        }
        AppConfig.permissionGate.attach { permissions -> permissionLauncher.launch(permissions) }
        // 수동 위치 이동 판정 트리거 ①②(spec §13-2·판정 34): 앱 시작 겸 전경 복귀 = ON_START(단일 액티비티). 재생성 과발화는 판정의 30초 디바운스가 막는다.
        lifecycle.addObserver(LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) lifecycleScope.launch { AppConfig.manualLocationJudge.run() }
        })
        // ⚠ Activity를 캡처하지 않는다 — ViewModel은 구성 변경을 넘어 살아 첫 Activity를 붙들면 누수다.
        // 문자열·언어는 **호출 시점**에 `AppConfig.localizedApp()`에서 읽는다(spec §14-2 — 앱 컨텍스트의 `Resources`를 캡처하면 언어 변경 뒤 옛 언어로 굳는다).
        val res: () -> Resources = { AppConfig.localizedApp().resources }
        val recents = RecentSearchStore(SharedPreferencesStore(this))
        val factory = viewModelFactory {
            initializer {
                SearchViewModel(
                    service = SearchService(AppConfig.apiClient),
                    store = recents,
                    dataLocale = { AppLocale.dataLocale(res()) },
                    strings = searchStrings(res),
                    savedState = createSavedStateHandle(),
                    coordinate = { AppConfig.effectiveLocation.coordinateForRanking() },
                )
            }
        }
        val nearbyService = NearbyService(AppConfig.apiClient)
        val services = NearbyServices(nearbyService, BarrierFreeService(AppConfig.apiClient), WalkInfraService(AppConfig.apiClient), ConditionsService(AppConfig.apiClient)) {
            DateFormat.getTimeInstance(DateFormat.SHORT, Locale.forLanguageTag(AppLocale.current(res()))).format(Date())
        }
        val nearby = nearbyStrings(res)
        val factories = AppFactories(
            search = factory,
            nearby = { kind, anchor -> nearbyFactory(kind, anchor, services, nearby, current = { AppConfig.effectiveLocation.nearbyCoordinateSource() }, manual = { AppConfig.manualLocationStore.current.value }) },
            busRouteStops = { route -> busRouteStopsFactory(route, nearbyService, nearby) },
            place = { place -> placeDetailFactory(place, PlaceHoursService(AppConfig.apiClient), placeStrings(res), StationService(AppConfig.apiClient), services.barrierFree) { AppLocale.dataLocale(res()) } },
            requestPreciseLocation = { AppConfig.permissionGate.request() == LocationPermission.Fine },
            isLocationEnabled = { AppConfig.locationStore.isLocationEnabled() },
            currentAddress = AppConfig.currentAddressStore,
            manualLocation = AppConfig.manualLocationStore,
        )
        setContent {
            // 테마(iOS `preferredColorScheme`): 설정 값이 바뀌면 재생성 없이 즉시 반영. 시스템 막대 아이콘도 앱 테마를 따른다(창 테마는 DayNight라
            // 앱을 시스템과 다르게 두면 투명 막대 위 아이콘이 배경과 같은 색이 된다).
            val theme by AppConfig.settings.themePreference.collectAsState()
            val dark = resolveDarkTheme(theme, isSystemInDarkTheme())
            SideEffect {
                val light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                window.insetsController?.setSystemBarsAppearance(if (dark) 0 else light, light)
            }
            MaterialTheme(colorScheme = if (dark) darkColorScheme() else lightColorScheme()) {
                AppRoot(factories)
            }
        }
    }

    override fun onDestroy() {
        AppConfig.permissionGate.detach()
        super.onDestroy()
    }
}

/** ViewModel 통지 문장(리소스는 화면 몫, spec §4). 호출 시점에 `res()`를 읽는다(spec §14-2). */
fun searchStrings(res: () -> Resources): SearchStrings = SearchStrings(
    searchingFor = { appLocalized(res(), R.string.search_searchingFor, it) },
    failed = { res().getString(R.string.android_search_announceFailed) },
    empty = { res().getString(R.string.android_search_announceEmpty) },
    count = { appLocalized(res(), R.string.android_search_announceCount, it) },
    deleted = { res().getString(R.string.recent_deleted) },
    cleared = { res().getString(R.string.recent_cleared) },
    clearedExceptPinned = { res().getString(R.string.recent_clearedExceptPinned) },
)

package space.dodoplanet.gildongmu

import android.content.Context
import android.content.Intent
import android.content.res.Resources
import android.os.Bundle
import android.os.SystemClock
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
import space.dodoplanet.gildongmu.nav.AppSession
import space.dodoplanet.gildongmu.guide.GuideSession
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
        // 앱 바로가기(B22 ④): 정적 바로가기는 새 태스크로 이 액티비티를 다시 만든다. 구성 변경 재생성은 같은 인텐트를 다시 들고 오므로 첫 생성만 받는다.
        if (savedInstanceState == null) AppSession.offer(intent?.action, this)
        else AppSession.restoreBackgroundedAt(savedInstanceState.getDouble(BACKGROUNDED_AT_KEY, Double.NaN).takeIf { !it.isNaN() })
        // 위치 권한 손 둘(spec §4): 대기 슬롯은 AppConfig.permissionGate(앱 싱글턴)가 쥔다. 등록은 STARTED 전(onCreate).
        val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            AppConfig.permissionGate.deliver()
        }
        AppConfig.permissionGate.attach(this) { permissions -> permissionLauncher.launch(permissions) }
        // 수동 위치 이동 판정 트리거 ①②(spec §13-2·판정 34): 앱 시작 겸 전경 복귀 = ON_START(단일 액티비티). 재생성 과발화는 판정의 30초 디바운스가 막는다.
        lifecycle.addObserver(LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) lifecycleScope.launch { AppConfig.manualLocationJudge.run() }
        })
        // 유휴 리셋(B27 ②, iOS scenePhase 갈래): 10분 넘게 백그라운드였다 돌아오면 모든 탭을 초기 상태로 — 실시간 안내 중이면 하지 않는다.
        // 시계는 잠자기를 포함하는 단조 시계(`elapsedRealtime`)다 — 벽시계는 사용자가 시각을 바꾸면 뛴다.
        lifecycle.addObserver(LifecycleEventObserver { _, event ->
            val now = SystemClock.elapsedRealtime() / 1000.0
            when (event) {
                Lifecycle.Event.ON_STOP -> if (!isChangingConfigurations) AppSession.onBackground(now)
                Lifecycle.Event.ON_START -> AppSession.onForeground(now, guideActive = GuideSession.isActive)
                else -> Unit
            }
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

    /** API 28+에서 `onStop` 뒤에 불린다 — 그때 적힌 백그라운드 시각을 프로세스 종료 너머로 넘긴다(유휴 리셋, B27 ②). */
    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        AppSession.backgroundedAt?.let { outState.putDouble(BACKGROUNDED_AT_KEY, it) }
    }

    /** singleTop(매니페스트)이라 런처 아이콘·안내 알림 복귀가 여기로 온다(액션 없음 → `offer`가 무시). 바로가기는 CLEAR_TASK라 새 액티비티의 `onCreate`로 간다. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        AppSession.offer(intent.action, this)
    }

    override fun onDestroy() {
        AppConfig.permissionGate.detach(this)
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
    moved = { appLocalized(res(), R.string.android_reorder_moved, it) },
)

private const val BACKGROUNDED_AT_KEY = "gildongmu.backgroundedAt"

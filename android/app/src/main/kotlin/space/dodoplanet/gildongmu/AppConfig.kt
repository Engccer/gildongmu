package space.dodoplanet.gildongmu

import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import android.util.Log
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.location.CurrentAddressStore
import space.dodoplanet.gildongmu.location.AndroidLocationSource
import space.dodoplanet.gildongmu.location.AndroidPermissionGate
import space.dodoplanet.gildongmu.location.LocationStore
import space.dodoplanet.gildongmu.a11y.AppNotices
import space.dodoplanet.gildongmu.location.EffectiveLocation
import space.dodoplanet.gildongmu.location.ManualLocationJudge
import space.dodoplanet.gildongmu.location.ManualLocationStore
import space.dodoplanet.gildongmu.storage.SharedPreferencesStore
import space.dodoplanet.gildongmu.net.HttpUrlConnectionTransport
import space.dodoplanet.gildongmu.settings.SettingsStore
import space.dodoplanet.gildongmu.settings.localeOverride

/**
 * 앱 전역 설정(iOS `AppConfig` 미러). 실험 기능은 플래그 값을 손으로 고치는 것이 아니라
 * 빌드 구성(`experimental`)으로 가른다. 검증되면 참조 자체를 지운다(항상 참 상수를 남기지 않는다).
 */
object AppConfig {
    val experimentalGuidanceEnabled: Boolean = BuildConfig.EXPERIMENTAL

    /** 탭 바 순서(iOS `experimentalTabOrderEnabled` 미러, K1 ① 위원장 판정 2026-08-23 실험판 판정 대기). */
    val experimentalTabOrderEnabled: Boolean = BuildConfig.EXPERIMENTAL

    /** 설정 화면의 결과 진동 행(실험판, spec §14-3) — 졸업 때 지울 자리 하나. */
    val resultHapticsSettingEnabled: Boolean = BuildConfig.EXPERIMENTAL

    /** 서버 base URL(대외 정본 도메인). 서버 계약 변경 0 — 기존 라우트만 부른다. */
    const val API_BASE_URL = "https://gildongmu.dodoplanet.space"

    /** nmap 딥링크 필수 appname(웹 NEXT_PUBLIC_APP_IDENTIFIER·iOS와 동일값). */
    const val APP_IDENTIFIER = "space.dodoplanet.gildongmu"

    /** :kit 판정 계층 + :app 전송 구현의 결합점. 화면들이 공유한다. */
    val apiClient: APIClient by lazy { APIClient(API_BASE_URL, HttpUrlConnectionTransport()) }

    private lateinit var app: Context

    /** `GildongmuApplication.onCreate`가 1회 부른다. */
    fun attach(context: Context) {
        app = context.applicationContext
    }

    /** 권한 대기 슬롯 소유자(spec §4). `MainActivity`가 손 둘을 등록·해제한다. */
    val permissionGate: AndroidPermissionGate by lazy { AndroidPermissionGate(app) }

    /** 현재 위치 공유 스토어 — 화면마다 `LocationManager`를 만들지 않는다. */
    val locationStore: LocationStore by lazy { LocationStore(AndroidLocationSource(app), permissionGate, log = { Log.i("Location", it) }) }

    /** 현재 위치 주소 캐시(표시줄, spec §12-4) — 좌표당 1회 역지오코딩. */
    val currentAddressStore: CurrentAddressStore by lazy { CurrentAddressStore(locationStore, SearchService(apiClient)) }

    /** 앱 수명 코루틴 스코프(hydration 등 프로세스 수명 작업). */
    val appScope: CoroutineScope by lazy { CoroutineScope(SupervisorJob() + Dispatchers.Default) }

    /** 수동 위치 런타임 정본(spec §13-1) — `GildongmuApplication`이 IO에서 `hydrate()`를 띄운다. */
    val manualLocationStore: ManualLocationStore by lazy { ManualLocationStore(SharedPreferencesStore(app)) }

    /** 이동 판정(트리거: `MainActivity` ON_START·force 조회). 자동 해제 통지는 앱 통지 큐로. */
    val manualLocationJudge: ManualLocationJudge by lazy {
        ManualLocationJudge(manualLocationStore, locationStore, now = { System.currentTimeMillis() / 1000.0 }, notify = { AppNotices.post(it) }, autoClearedText = { localizedApp().getString(R.string.manualLocation_autoCleared) })
    }

    /** 앱 층의 좌표 진입점(판정 38) — 화면·ViewModel은 `locationStore`를 직접 잡지 않는다(소스 가드). */
    val effectiveLocation: EffectiveLocation by lazy { EffectiveLocation(locationStore, manualLocationStore, manualLocationJudge) }

    /** 설정 값의 단일 소유자(spec §14-1). 첫 읽기는 `MainActivity.attachBaseContext`(동기, 언어가 첫 프레임에 필요). */
    val settings: SettingsStore by lazy { SettingsStore(SharedPreferencesStore(app)) }

    /**
     * 로케일 오버라이드 컨텍스트(spec §14-2 판정 39): 저장값이 없으면 `base` 그대로, 있으면 그 로케일의 구성 사본으로
     * `createConfigurationContext`. **이 호출은 이 파일 한 곳**(소스 가드). `MainActivity.attachBaseContext`가 감싼다.
     */
    fun localized(base: Context): Context {
        val code = localeOverride(settings.language.value) ?: return base
        val config = Configuration(base.resources.configuration).apply { setLocales(LocaleList(Locale.forLanguageTag(code))) }
        return base.createConfigurationContext(config)
    }

    @Volatile private var localizedAppCache: Context? = null

    /**
     * ViewModel 문장·`dataLocale`·시각 포맷의 리소스 — **호출 시점**에 읽는다(캡처 금지: ViewModel은 재생성을 넘어 살고
     * `createConfigurationContext`의 오버라이드는 제자리 갱신되지 않는다). 언어 저장이 무효화한다. 로케일 밖 구성 축(글꼴 크기·야간 모드)은
     * 생성 시점 스냅샷이라 **문자열·시각 포맷만** 읽을 것.
     */
    fun localizedApp(): Context = localizedAppCache ?: localized(app).also { localizedAppCache = it }

    fun invalidateLocalizedApp() { localizedAppCache = null }
}

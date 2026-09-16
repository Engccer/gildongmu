package space.dodoplanet.gildongmu

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.location.CurrentAddressStore
import space.dodoplanet.gildongmu.location.AndroidLocationSource
import space.dodoplanet.gildongmu.location.AndroidPermissionGate
import space.dodoplanet.gildongmu.location.LocationStore
import space.dodoplanet.gildongmu.location.ManualLocationStore
import space.dodoplanet.gildongmu.storage.SharedPreferencesStore
import space.dodoplanet.gildongmu.net.HttpUrlConnectionTransport

/**
 * 앱 전역 설정(iOS `AppConfig` 미러). 실험 기능은 플래그 값을 손으로 고치는 것이 아니라
 * 빌드 구성(`experimental`)으로 가른다. 검증되면 참조 자체를 지운다(항상 참 상수를 남기지 않는다).
 */
object AppConfig {
    val experimentalGuidanceEnabled: Boolean = BuildConfig.EXPERIMENTAL

    /** 탭 바 순서(iOS `experimentalTabOrderEnabled` 미러, K1 ① 위원장 판정 2026-08-23 실험판 판정 대기). */
    val experimentalTabOrderEnabled: Boolean = BuildConfig.EXPERIMENTAL

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
}

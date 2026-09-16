package space.dodoplanet.gildongmu.guide

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.GuideSessionCoordinator
import space.dodoplanet.gildongmu.kit.RouteService
import space.dodoplanet.gildongmu.storage.SharedPreferencesStore
import java.util.Collections
import java.util.IdentityHashMap

/**
 * 안내 세션 앱 수명 싱글턴(iOS `GuideSession.shared` 미러, spec §3-1). 세션은 화면이 아니라 앱이 소유한다 — 시트를 내리는
 * 제스처는 최소화이고 소거는 "닫기"뿐(N1). 서비스·스트림·알림은 `walk`를 매 호출 시점에 조회하고 인스턴스를 붙들지 않는다.
 *
 * `attach`는 멱등이고 게이트가 없다(리뷰 N3-1) — 실험 게이트는 자원을 만드는 자리(`startWalk` ①·`GuideBottomBar`)가 든다.
 * 소스 가드가 `startWalk(` 호출부를 `WalkGuideStartButton.kt` 한 곳으로 잠근다.
 */
object GuideSession {
    var coordinator = GuideSessionCoordinator()
        private set
    lateinit var walk: WalkGuideModel
        private set

    /** 시트가 내려가 띠바가 세션을 대표한다. */
    var isMinimized by mutableStateOf(false)

    /** 띠바 복귀 시트의 첫 착지 = 접기 버튼(1회 소비). */
    var returnedFromBand by mutableStateOf(false)

    /** 전경 복귀(백그라운드 경유) 띠바 착지 트리거 — 증가할 때마다 띠바가 1회 착지한다. */
    var bandLandingSeq by mutableIntStateOf(0)
        private set

    /** 실험 게이트(정식 빌드는 `startWalk`가 아무것도 하지 않는다). 테스트가 바꿔 끼운다. */
    var experimentalEnabled: () -> Boolean = { AppConfig.experimentalGuidanceEnabled }

    /** `attach`가 지나갔는가 — 서비스 콜백이 `walk`를 만지기 전에 본다. */
    val isAttached: Boolean get() = ::walk.isInitialized

    val isActive: Boolean get() = coordinator.isActive || (::walk.isInitialized && walk.ui.value.starting)
    val hasScreen: Boolean get() = ::walk.isInitialized && walk.ui.value.hasScreen

    /** 세션 환경(전경 판정 입력·화면 상태). `permissions`는 `GuideBottomBar`가 런처를 붙인다(Task 5). */
    lateinit var permissions: GuidePermissionsImpl
        private set
    private var environment: AndroidGuideEnvironment? = null
    private var foreground = false

    /** 1회 조립(멱등). Activity 재생성마다 다시 불리므로 첫 줄이 가드다. */
    fun attach(app: Context) {
        if (::walk.isInitialized) return
        val context = app.applicationContext
        val env = AndroidGuideEnvironment(context).also { it.foreground = foreground }
        environment = env
        permissions = GuidePermissionsImpl(context)
        walk = WalkGuideModel(
            routes = RouteService(AppConfig.apiClient),
            strings = guideStrings(context.resources),
            dataLocale = { DataLocale.fromRawValue(AppLocale.dataLocale(context.resources)) ?: DataLocale.ko },
            controller = AndroidGuideController(context),
            permissions = permissions,
            tones = NoopTones,
            speaker = NoopSpeaker,
            haptics = NoopHaptics,
            steps = AndroidStepCounter(context, Handler(Looper.getMainLooper())),
            env = env,
            coordinator = coordinator,
            store = SharedPreferencesStore(context),
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Main),
            clock = { SystemClock.elapsedRealtime() / 1000.0 },
        )
    }

    /** 유일한 시작 진입점. ① 실험 게이트 ② 거부 통지 ③ 프리로드 ④ 요청. */
    fun startWalk(request: WalkStartRequest) {
        if (!experimentalEnabled()) return
        if (isActive) {
            walk.announceNow(walk.strings.get("guide.alreadyActive"), highPriority = true, bypassSuppression = true)
            return
        }
        walk.tones.preload()
        walk.speaker.prepare()
        walk.requestStart(request)
    }

    // ── 억제 소유자 집합(§5-5) — 동일성(iOS ObjectIdentifier), equals 기반 HashSet 금지 ──
    private val suppressionOwners: MutableSet<Any> = Collections.newSetFromMap(IdentityHashMap())
    private var suppressionPrior: Boolean? = null

    fun setOutputSuppressed(active: Boolean, owner: Any) {
        if (active) {
            val wasEmpty = suppressionOwners.isEmpty()
            suppressionOwners += owner
            if (!wasEmpty) return
            suppressionPrior = walk.outputSuppressed
            walk.outputSuppressed = true
        } else {
            suppressionOwners -= owner
            if (suppressionOwners.isNotEmpty()) return
            val prior = suppressionPrior ?: return
            suppressionPrior = null
            walk.outputSuppressed = prior && walk.outputSuppressed
        }
    }

    /** `GuideBottomBar`의 수명 관찰자가 ON_START/ON_STOP을 넘긴다. */
    fun setForeground(foreground: Boolean) {
        if (!::walk.isInitialized) return
        val wasBackground = !this.foreground
        this.foreground = foreground
        environment?.foreground = foreground
        walk.setForeground(foreground)
        if (foreground && wasBackground && walk.ui.value.hasScreen && isMinimized) bandLandingSeq += 1
    }

    /** 테스트 전용 — 페이크 포트로 조립한다(`attach`와 같은 멱등 규칙은 없다: 테스트가 매번 새로 끼운다). */
    internal fun attachForTest(model: WalkGuideModel, coordinator: GuideSessionCoordinator) {
        walk = model
        this.coordinator = coordinator
        suppressionOwners.clear()
        suppressionPrior = null
    }
}

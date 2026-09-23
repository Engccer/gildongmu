package space.dodoplanet.gildongmu.guide

import android.content.Context
import android.content.res.Resources
import android.media.AudioManager
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
import space.dodoplanet.gildongmu.audio.AndroidAudioFocusPort
import space.dodoplanet.gildongmu.audio.AndroidSoundPort
import space.dodoplanet.gildongmu.audio.AndroidTtsPort
import space.dodoplanet.gildongmu.audio.AndroidVibrator
import space.dodoplanet.gildongmu.audio.AndroidVolumePort
import space.dodoplanet.gildongmu.audio.GuideAudioFocus
import space.dodoplanet.gildongmu.audio.GuideTonePlayer
import space.dodoplanet.gildongmu.audio.ResultHaptic
import space.dodoplanet.gildongmu.audio.TtsGuideSpeaker
import space.dodoplanet.gildongmu.audio.handlerPostDelayed
import space.dodoplanet.gildongmu.audio.toneAudioAttributes
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
 * `attach`는 멱등이다(리뷰 N3-1). 도보 안내는 정식 기능이라 빌드 구성 게이트가 없다(E43 우선순위 4, iOS 2026-08-15 졸업 동형).
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
        val main = Handler(Looper.getMainLooper())
        val clock = { SystemClock.elapsedRealtime() / 1000.0 }
        val store = SharedPreferencesStore(context)
        val audioManager = context.getSystemService(AudioManager::class.java)
        // 포커스 하나·재생기 하나(§5-2 #16 — M5도 이것을 공유한다).
        val focus = GuideAudioFocus(AndroidAudioFocusPort(audioManager, toneAudioAttributes), handlerPostDelayed(main))
        val vibrator = AndroidVibrator(context)
        // 문장·언어는 호출 시점에 앱 언어 리소스에서(M2 spec §14-2 — 앱 수명 싱글턴이 `Resources`를 캡처하면 언어 변경 뒤 옛 언어로 굳는다).
        val res: () -> Resources = { AppConfig.localizedApp().resources }
        walk = WalkGuideModel(
            routes = RouteService(AppConfig.apiClient),
            strings = guideStrings(res),
            dataLocale = { DataLocale.fromRawValue(AppLocale.dataLocale(res())) ?: DataLocale.ko },
            controller = AndroidGuideController(context),
            permissions = permissions,
            tones = GuideTonePlayer(AndroidSoundPort(context), focus, vibrator, AndroidVolumePort(audioManager), store, clock),
            speaker = TtsGuideSpeaker(AndroidTtsPort(context), focus, store, { AppLocale.current(res()) }, onPendingDropped = { walk.onSpeechDropped() }),
            haptics = ResultHaptic(vibrator, store), // 결과 진동도 설정 스위치 뒤(iOS 동형)
            steps = AndroidStepCounter(context, main),
            env = env,
            coordinator = coordinator,
            store = store,
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Main),
            clock = clock,
        )
    }

    /** 유일한 시작 진입점. ① 거부 통지 ② 프리로드 ③ 요청. */
    fun startWalk(request: WalkStartRequest) {
        if (!isAttached) return
        if (isActive) {
            walk.announceNow(walk.strings.get("guide.alreadyActive"), highPriority = true, bypassSuppression = true)
            return
        }
        walk.clearFailure()          // 새 시작이 직전 실패 행을 지운다(§7-1)
        returnedFromBand = false
        isMinimized = false
        walk.tones.preload()
        walk.speaker.prepare()
        walk.requestStart(request)
    }

    // ── 억제 소유자 집합(§5-5) — 동일성(iOS ObjectIdentifier), equals 기반 HashSet 금지 ──
    private val suppressionOwners: MutableSet<Any> = Collections.newSetFromMap(IdentityHashMap())
    private var suppressionPrior: Boolean? = null

    fun setOutputSuppressed(active: Boolean, owner: Any) {
        if (!::walk.isInitialized) return  // attach(첫 `GuideBottomBar` 컴포지션) 전 — lateinit 예외 차단
        if (active) {
            val wasEmpty = suppressionOwners.isEmpty()
            suppressionOwners += owner
            if (wasEmpty) suppressionPrior = walk.outputSuppressed
            // 세션 경계가 억제를 풀었어도(§5-5) 소유자가 남아 있는 한 새 소유자·재요청은 억제를 다시 세운다(리뷰 MAJOR).
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

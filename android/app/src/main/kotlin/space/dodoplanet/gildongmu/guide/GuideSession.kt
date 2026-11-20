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
import space.dodoplanet.gildongmu.nearby.SceneLookup
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.GuideSessionCoordinator
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.NearbyService
import space.dodoplanet.gildongmu.kit.RouteService
import space.dodoplanet.gildongmu.kit.TransitPositionService
import space.dodoplanet.gildongmu.kit.TransitTrackService
import space.dodoplanet.gildongmu.storage.SharedPreferencesStore
import java.util.Collections
import java.util.IdentityHashMap

/** 띄울 안내 시트(M5 §6-7, iOS `GuideSession.screen` 동형) — 도보·자동차 `GuideSheet` 또는 대중교통 시트. 한 호스트가 고른다. */
enum class GuideScreenKind { beacon, transit }

/**
 * 안내 세션 앱 수명 싱글턴(iOS `GuideSession.shared` 미러, spec §3-1). 세션은 화면이 아니라 앱이 소유한다 — 시트를 내리는
 * 제스처는 최소화이고 소거는 "닫기"뿐(N1). 서비스·스트림·알림은 `walk`를 매 호출 시점에 조회하고 인스턴스를 붙들지 않는다.
 *
 * `attach`는 멱등이다(리뷰 N3-1). 도보 안내는 정식 기능이라 빌드 구성 게이트가 없다(E43 우선순위 4, iOS 2026-08-15 졸업 동형).
 * 공개 시작 함수는 수단마다 하나다(`startWalk`·`startCar`, M5 spec §2-2). 소스 가드가 호출부를 잠근다: `startWalk(`은
 * `WalkGuideStartButton.kt`와 이 파일의 자동차 도착 뒤 인계, `startCar(`는 `CarGuideStartButton.kt`.
 *
 * 모델은 둘이다(M5 §6): 도보·자동차 `walk`와 대중교통 `transit`. 둘은 포커스·톤 재생기·TTS·진동·전경 서비스 컨트롤러 한 벌을 공유하고(§6-5), 서비스의
 * 다섯 경로는 `serviceOwner()` 한 지점이 세대를 대조해 고른 소유자에게 간다(§6-4). 둘이 동시에 추적하는 순간은 코디네이터 점유가 막는다.
 */
object GuideSession {
    var coordinator = GuideSessionCoordinator()
        private set
    lateinit var walk: WalkGuideModel
        private set
    /** 대중교통 모델(M5 §6). `attach`가 도보와 함께 조립한다 — 테스트가 갈아 끼우거나 비울 수 있게 `lateinit`이 아니라 칸이다. */
    private var transitModel: TransitGuideModel? = null
    val transit: TransitGuideModel get() = checkNotNull(transitModel) { "GuideSession.attach 전" }
    private val hasTransit: Boolean get() = transitModel != null

    /** 시트가 내려가 띠바가 세션을 대표한다. */
    var isMinimized by mutableStateOf(false)

    /**
     * 다음 띠바 등장의 착지를 1회 건너뛴다 — 종료 화면 [체중 입력하기](E31)가 시트를 접고 설정을 push하는 경로에서, 띠바 착지(400ms 뒤)가
     * 설정 화면 착지를 가로채지 않게(a11y 감사 M1). 띠바 효과가 소비한다.
     */
    var suppressNextBandLanding = false

    /** 설정에서 돌아왔을 때 종료 화면이 남아 있으면 시트를 다시 연다 — 종료 화면이 요약을 다시 계산하고 착지한다(iOS 설정 시트 onDismiss 동형). */
    fun reopenAfterWeightSettings() {
        if (::walk.isInitialized && walk.ui.value.arrivalDest != null) isMinimized = false
    }

    /**
     * 장소 상세(M4b 중첩)에서 돌아와 시트가 다시 열릴 때의 착지 1회(제목 `GUIDE_TITLE_RETURN` 또는 주변 확인 행 키). 시트는 최소화로 컴포지션을
     * 떠났다가 돌아오므로 진입 효과가 이 값을 소비한다(없으면 종전 진입 착지).
     */
    var pendingSheetReturn: String? = null

    /** 중첩 화면(장소 상세)이 스택에서 빠졌다 — 안내 화면이 남아 있으면 시트를 다시 연다. 없으면(그 사이 종료·소거) 착지 표식도 버린다. */
    fun reopenAfterNestedScreen() {
        if (hasScreen) { isMinimized = false; return }
        // 그 사이 세션이 끝났다(알림 "안내 종료"·안전망) — 재개하지 않는 갈래도 두 표식을 지운다. 남기면 다음 세션의 첫 띠바 착지가 건너뛰어지고
        // 시트 첫 진입이 없는 행 키를 찾는다.
        pendingSheetReturn = null
        suppressNextBandLanding = false
    }

    /**
     * 주변 확인 상태(M4b) — 화면 자리(`SceneSlot`) × 앵커(목적지) 단위로 세션이 든다. 시트 컴포지션은 최소화·장소 상세 왕복에 사라지지만 펼친 목록과
     * 착지 자리는 남아야 한다(iOS는 중첩 시트라 시트가 산다). 추적 중 시트와 종료 화면은 자리가 달라 종료 화면은 백지로 시작한다(iOS `arrivalSection`의
     * 새 섹션 동형). 앵커가 바뀌면 새로 만들고, 새 세션 시작이 버린다. 조회는 세션 스코프라 시트를 접어도 끝까지 가고, 그 사이 도착한 결과는 착지 없이
     * 펼쳐진 채 기다린다(`SceneLookup.attached`).
     */
    enum class SceneSlot { tracking, end }
    private val sceneLookups = mutableMapOf<SceneSlot, SceneLookup>()

    fun sceneLookup(slot: SceneSlot, anchor: BeaconDest): SceneLookup {
        val coord = NearbyCoord(anchor.lat, anchor.lng)
        sceneLookups[slot]?.takeIf { it.anchor == coord }?.let { return it }
        return SceneLookup(coord, uiScope, NearbyService(AppConfig.apiClient)).also { sceneLookups[slot] = it }
    }

    private val uiScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    /** 전경 복귀(백그라운드 경유) 띠바 착지 트리거 — 증가할 때마다 띠바가 1회 착지한다. */
    var bandLandingSeq by mutableIntStateOf(0)
        private set

    /**
     * 전경 복귀(백그라운드 경유) 시트 착지 트리거(E57 §3.2) — 시트가 펼쳐진 채 돌아왔을 때 **모델이 복귀 처리(상환 발화)를 마친 뒤** 1 증가한다. 시트가 배경에서
     * 이월한 첫 정보 행 착지를 이 신호에서 다시 요청한다(그 발화가 끝난 뒤 앉는다).
     */
    var sheetReturnSeq by mutableIntStateOf(0)
        private set

    /** `attach`가 지나갔는가 — 서비스 콜백이 `walk`를 만지기 전에 본다. */
    val isAttached: Boolean get() = ::walk.isInitialized

    val isActive: Boolean get() = coordinator.isActive || (::walk.isInitialized && walk.ui.value.starting)

    /**
     * 띄울 시트(M5 §6-7, iOS `screen` 동형): 도보 모델에 화면이 있으면 `beacon`(인계 600ms 창에서 도보가 이긴다), 아니면 대중교통이 추적 중이거나 하차 인계
     * 신호가 남아 있으면 `transit`. 띠바·`hasScreen`·`reopenAfterNestedScreen`이 이 값을 본다.
     */
    val screen: GuideScreenKind?
        get() = when {
            ::walk.isInitialized && walk.ui.value.hasScreen -> GuideScreenKind.beacon
            hasTransit && transit.ui.value.let { it.isTracking || it.pendingWalkHandoff != null } -> GuideScreenKind.transit
            else -> null
        }
    val hasScreen: Boolean get() = screen != null

    // ── 전경 서비스 소유자(M5 §6-4) ──

    /**
     * 서비스가 말을 거는 세션 — 도보 모델이 시작 중이거나 추적 중이면 도보, 아니면 대중교통이 추적 중이면 대중교통, 아니면 null(서비스는 스스로 내린다).
     * 매 콜백 시점에 조회하고 인스턴스를 붙들지 않는다.
     */
    fun serviceOwner(): GuideServiceOwner? = when {
        !::walk.isInitialized -> null
        walk.ui.value.starting || walk.isTracking -> walk
        hasTransit && transit.isTracking -> transit
        else -> null
    }

    /** 세대가 지금 소유자의 것일 때만 그 소유자 — 아니면 로그 한 줄로 버린다(인계 직후 앞 세션의 늦은 이벤트가 새 세션을 끝내지 않게). */
    private fun ownerFor(generation: Int, event: String): GuideServiceOwner? {
        val owner = serviceOwner()
        if (owner == null || owner.serviceGeneration != generation) {
            GuideDiag.log("service $event dropped gen=$generation owner=${owner?.serviceGeneration}")
            return null
        }
        return owner
    }

    fun serviceFix(generation: Int, fix: GuideFixPayload) { ownerFor(generation, "fix")?.handleServiceFix(fix) }
    fun serviceProviderDisabled(generation: Int) { ownerFor(generation, "providerDisabled")?.handleProviderDisabled() }
    fun serviceStopFromNotification(generation: Int) { ownerFor(generation, "notificationStop")?.stopFromNotification() }
    fun serviceStartFailed(generation: Int, error: Throwable) { ownerFor(generation, "startFailed")?.onServiceStartFailed(generation, error) }

    /** 세션 환경(전경 판정 입력·화면 상태). `permissions`는 `GuideBottomBar`가 런처를 붙인다(Task 5). */
    lateinit var permissions: GuidePermissionsImpl
        private set
    private var environment: AndroidGuideEnvironment? = null
    /** 앱 Activity가 STARTED인가(관찰 가능 — 안내 시트 착지가 배경 전환을 본다). */
    var inForeground by mutableStateOf(false)
        private set

    /** 1회 조립(멱등). Activity 재생성마다 다시 불리므로 첫 줄이 가드다. */
    fun attach(app: Context) {
        if (::walk.isInitialized) return
        val context = app.applicationContext
        val env = AndroidGuideEnvironment().also { it.foreground = inForeground }
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
        val strings = guideStrings(res)
        val dataLocale = { DataLocale.fromRawValue(AppLocale.dataLocale(res())) ?: DataLocale.ko }
        // 두 모델이 공유하는 한 벌(M5 §6-5): 컨트롤러(세대 발급) · 톤 재생기 · TTS · 진동.
        val controller = AndroidGuideController(context, onStartFailed = ::serviceStartFailed)
        val tones = GuideTonePlayer(AndroidSoundPort(context), focus, vibrator, AndroidVolumePort(audioManager), store, clock)
        // 보류 문장 버림은 토큰을 싣고 두 모델에 간다 — 그 토큰을 게시한 모델만 상환 표식을 세운다(§6-5).
        val speaker = TtsGuideSpeaker(AndroidTtsPort(context), focus, store, { AppLocale.current(res()) }, onPendingDropped = ::speechDropped)
        val haptics = ResultHaptic(vibrator, store) // 결과 진동도 설정 스위치 뒤(iOS 동형)
        val routes = RouteService(AppConfig.apiClient)
        walk = WalkGuideModel(
            routes = routes,
            strings = strings,
            dataLocale = dataLocale,
            controller = controller,
            permissions = permissions,
            tones = tones,
            speaker = speaker,
            haptics = haptics,
            steps = AndroidStepCounter(context, main),
            env = env,
            coordinator = coordinator,
            store = store,
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Main),
            clock = clock,
        )
        transitModel = TransitGuideModel(
            routes = routes,
            track = TransitTrackService(AppConfig.apiClient),
            position = TransitPositionService(AppConfig.apiClient),
            strings = strings,
            dataLocale = dataLocale,
            controller = controller,
            permissions = permissions,
            tones = tones,
            speaker = speaker,
            haptics = haptics,
            env = env,
            coordinator = coordinator,
            isSessionActive = { isActive },
            // 실시간 안내는 실좌표다(수동 위치를 지나지 않는다 — `EffectiveLocation` 머리 주석, iOS `LocationService.currentCoordinate(force:)`).
            currentCoordinate = { force -> AppConfig.locationStore.currentCoordinate(force = force) },
            isMinimized = { isMinimized },
            store = store,
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Main),
            clock = clock,
            wallClockMs = { System.currentTimeMillis().toDouble() },
            io = Dispatchers.IO,
        )
        routeSpeechInterruptions(speaker)
    }

    /** TTS 보류 문장 버림(초기화 실패·언어 미지원)을 두 모델에 넘긴다 — 그 토큰을 게시한 모델만 상환 표식을 세운다(M5 §6-5). */
    fun speechDropped(token: Int) {
        walk.onSpeechDropped(token)
        if (hasTransit) transit.onSpeechDropped(token)
    }

    /** TTS 끊김 콜백 한 칸을 두 모델에 함께 넘긴다 — 각 모델의 대기 칸이 자기 토큰만 반응한다(M5 §6-5, iOS 관찰자 목록 동형). */
    private fun routeSpeechInterruptions(speaker: GuideSpeaker) {
        speaker.onInterrupted = { token, reason ->
            walk.speechInterrupted(token, reason)
            if (hasTransit) transit.speechInterrupted(token, reason)
        }
    }

    /** 도보 안내 시작 진입점. ① 거부 통지 ② 프리로드 ③ 요청. */
    fun startWalk(request: WalkStartRequest) {
        if (!isAttached || refuseIfActive()) return
        beginBeacon(request)
    }

    /** 자동차 안내 시작 진입점(M5) — 도보와 같은 거부 판정·같은 본문. 길찾기 자동차 결과의 「자동차 안내 시작」만 부른다. */
    fun startCar(request: CarStartRequest) {
        if (!isAttached || refuseIfActive()) return
        beginBeacon(request)
    }

    /**
     * 자동차 도착 뒤 도보 인계(K2 §6.4, iOS `acceptCarWalkHandoff`): 종료 화면 소거 → 같은 목적지로 도보 시작(경유지·계단 회피·줄 없음).
     * 같은 모델이라 대중교통 인계의 600ms 지연이 없다. 자동차 세션은 이미 끝났으므로 공개 `startWalk`의 거부 판정을 그대로 지난다.
     */
    fun acceptCarWalkHandoff() {
        if (!isAttached) return
        val request = walk.takeCarWalkHandoff() ?: return
        startWalk(request)
    }

    /** 공개 시작 함수가 공유하는 거부 판정(iOS `refuseIfActive`) — 다른 안내가 돌면 알리고 true. 대중교통 세션도 이 판정을 지난다(§3). */
    private fun refuseIfActive(): Boolean {
        if (!isActive) return false
        walk.announceNow(walk.strings.get("guide.alreadyActive"), highPriority = true, bypassSuppression = true)
        return true
    }

    /** 거부 판정 없는 시작 본문(iOS `beginBeacon`) — 공개 함수가 판정 뒤 부른다. 대중교통 세션의 내부 인계도 이 자리를 쓴다(§3). */
    private fun beginBeacon(request: BeaconStartRequest) {
        walk.clearFailure()          // 새 시작이 직전 실패 행을 지운다(§7-1)
        pendingSheetReturn = null
        suppressNextBandLanding = false
        sceneLookups.clear()         // 지난 세션의 주변 확인 결과가 같은 목적지의 새 세션으로 새지 않게
        isMinimized = false
        walk.tones.preload()
        walk.speaker.prepare()
        walk.requestStart(request)
    }

    // ── 억제 소유자 집합(§5-5) — 동일성(iOS ObjectIdentifier), equals 기반 HashSet 금지. 두 모델에 함께 걸고 이전 값은 모델마다 든다(M5 §6-5) ──
    private val suppressionOwners: MutableSet<Any> = Collections.newSetFromMap(IdentityHashMap())
    private var suppressionPrior: Boolean? = null
    private var transitSuppressionPrior: Boolean? = null

    fun setOutputSuppressed(active: Boolean, owner: Any) {
        if (!::walk.isInitialized) return  // attach(첫 `GuideBottomBar` 컴포지션) 전 — lateinit 예외 차단
        if (active) {
            val wasEmpty = suppressionOwners.isEmpty()
            suppressionOwners += owner
            if (wasEmpty) {
                suppressionPrior = walk.outputSuppressed
                transitSuppressionPrior = if (hasTransit) transit.outputSuppressed else null
            }
            // 세션 경계가 억제를 풀었어도(§5-5) 소유자가 남아 있는 한 새 소유자·재요청은 억제를 다시 세운다(리뷰 MAJOR).
            walk.outputSuppressed = true
            if (hasTransit) transit.outputSuppressed = true
        } else {
            suppressionOwners -= owner
            if (suppressionOwners.isNotEmpty()) return
            val prior = suppressionPrior ?: return
            suppressionPrior = null
            walk.outputSuppressed = prior && walk.outputSuppressed
            val transitPrior = transitSuppressionPrior
            transitSuppressionPrior = null
            // 해제는 이전 값 ∧ 현재 값(guidance 규칙) — 대중교통의 해제가 억제 중 버린 마지막 문장을 한 번 다시 낸다(setter).
            if (hasTransit && transitPrior != null) transit.outputSuppressed = transitPrior && transit.outputSuppressed
        }
    }

    /** `GuideBottomBar`의 수명 관찰자가 ON_START/ON_STOP을 넘긴다. */
    fun setForeground(foreground: Boolean) {
        if (!::walk.isInitialized) return
        val wasBackground = !inForeground
        inForeground = foreground
        environment?.foreground = foreground
        walk.setForeground(foreground)
        if (hasTransit) transit.setForeground(foreground)
        if (foreground && wasBackground && hasScreen) {
            if (isMinimized) bandLandingSeq += 1 else sheetReturnSeq += 1
        }
    }

    /** 테스트 전용 — 페이크 포트로 조립한다(`attach`와 같은 멱등 규칙은 없다: 테스트가 매번 새로 끼운다). */
    internal fun attachForTest(model: WalkGuideModel, coordinator: GuideSessionCoordinator, transit: TransitGuideModel? = null, speaker: GuideSpeaker? = null) {
        walk = model
        transitModel = transit
        this.coordinator = coordinator
        suppressionOwners.clear()
        suppressionPrior = null
        transitSuppressionPrior = null
        speaker?.let { routeSpeechInterruptions(it) }
    }
}

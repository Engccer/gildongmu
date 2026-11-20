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
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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
import space.dodoplanet.gildongmu.kit.GuideSpeechClass
import space.dodoplanet.gildongmu.kit.TransitGuideRoute
import space.dodoplanet.gildongmu.kit.TransitLabel
import space.dodoplanet.gildongmu.kit.TransitTrackService
import space.dodoplanet.gildongmu.kit.buildTransitGuideRoute
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.transitPrewalkLabel
import space.dodoplanet.gildongmu.kit.transitPrewalkStartLine
import space.dodoplanet.gildongmu.kit.transitPrewalkTarget
import space.dodoplanet.gildongmu.kit.transitValidExitNo
import space.dodoplanet.gildongmu.storage.SharedPreferencesStore
import java.util.Collections
import java.util.IdentityHashMap

/** 띄울 안내 시트(M5 §6-7, iOS `GuideSession.screen` 동형) — 도보·자동차 `GuideSheet` 또는 대중교통 시트. 한 호스트가 고른다. */
enum class GuideScreenKind { beacon, transit }

/**
 * 띄울 시트를 고르는 규칙(iOS `screen` 동형) — 세션 [GuideSession.screen]과 시트 호스트 `GuideBottomBar`(두 모델의 `ui`를 수집해 Compose가 관찰한다)가 이 한
 * 함수를 읽는다. 도보 모델에 화면이 있으면 `beacon`(인계 600ms 창에서 도보가 이긴다), 아니면 대중교통이 추적 중이거나 하차 인계 신호가 남아 있으면 `transit`.
 */
fun guideScreenKind(walk: WalkGuideUiState?, transit: TransitGuideUiState?): GuideScreenKind? = when {
    walk?.hasScreen == true -> GuideScreenKind.beacon
    transit != null && (transit.isTracking || transit.pendingWalkHandoff != null) -> GuideScreenKind.transit
    else -> null
}

/**
 * 대중교통 안내 시작 요청(M5 §6-6, iOS `startTransit(route:destinationLabel:destinationRoman:dest:accessible:)`의 인자 한 벌). 기본값 없음. 라틴 표기
 * (`destinationRoman`)는 §2-2처럼 세 요청에 함께 더할 때까지 없다.
 */
data class TransitStartRequest(val route: TransitRoute, val destinationLabel: String, val dest: BeaconDest, val accessible: Boolean)

/**
 * 안내 세션 앱 수명 싱글턴(iOS `GuideSession.shared` 미러, spec §3-1). 세션은 화면이 아니라 앱이 소유한다 — 시트를 내리는
 * 제스처는 최소화이고 소거는 "닫기"뿐(N1). 서비스·스트림·알림은 `walk`를 매 호출 시점에 조회하고 인스턴스를 붙들지 않는다.
 *
 * `attach`는 멱등이다(리뷰 N3-1). 도보 안내는 정식 기능이라 빌드 구성 게이트가 없다(E43 우선순위 4, iOS 2026-08-15 졸업 동형).
 * 공개 시작 함수는 수단마다 하나다(`startWalk`·`startCar`·`startTransit`, M5 spec §2-2·§6-6). 소스 가드가 호출부를 잠근다: `startWalk(`은
 * `WalkGuideStartButton.kt`와 이 파일의 자동차 도착 뒤 인계·하차 인계, `startCar(`는 `CarGuideStartButton.kt`, `startTransit(`은 아직 0(진입점 단계).
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
        get() = guideScreenKind(if (::walk.isInitialized) walk.ui.value else null, transitModel?.ui?.value)
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
        wireTransitHooks(transit)
        routeSpeechInterruptions(speaker)
    }

    /** 대중교통 모델이 세션 소유자에게 넘기는 두 신호(iOS는 `GuideSession.shared`를 직접 부른다) — 비어 있으면 환승 도보·A68 거두기가 조용히 빠진다. */
    private fun wireTransitHooks(model: TransitGuideModel) {
        model.onTransferWalk = ::transitTransferWalk
        model.onPassedPrewalk = ::transitPassedPrewalk
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

    /**
     * 거부 판정 없는 시작 본문(iOS `beginBeacon`) — 공개 함수가 판정 뒤 부른다. 대중교통 세션의 내부 인계(승차 전 도보·환승 도보)도 이 자리를 쓴다(§3).
     * ⚠ 연결이 스스로 연 도보 시작(`launchingPrewalk`)은 연결을 지우지 않는다(설계 리뷰 반영) — 지우면 방금 세운 컨텍스트가 사라져 `endPrewalk(id)`가
     * 도착을 버리고 역에서 안내가 끊긴다.
     */
    private fun beginBeacon(request: BeaconStartRequest) {
        if (!launchingPrewalk) {
            retirePrewalkRestart()   // 도보의 직전 시작 인자가 이제 승차 전 도보가 아니다(A68)
            cancelPrewalk()
        }
        if (hasTransit) transit.clearWalkHandoff()
        walk.clearFailure()          // 새 시작이 직전 실패 행을 지운다(§7-1)
        pendingSheetReturn = null
        suppressNextBandLanding = false
        sceneLookups.clear()         // 지난 세션의 주변 확인 결과가 같은 목적지의 새 세션으로 새지 않게
        isMinimized = false
        walk.tones.preload()
        walk.speaker.prepare()
        walk.requestStart(request)
    }

    // ── 대중교통 시작과 도보 인계(M5 §6-6, iOS `GuideSession` 대중교통 절단면) ──

    /**
     * 승차 전 도보 연결 컨텍스트(A25 spec 2026-08-30 §4.4, iOS `PrewalkContext`). 도보 세션이 끝나면 같은 시작 요청으로 대중교통 세션을 잇는다. `id`가 이전
     * 세션의 늦은 콜백을 걸러 낸다. 환승 도보(E73)도 같은 연결이다 — `startLeg`가 걸어서 닿을 승차 구간(승차 전 도보 0)이고 경로는 처음 경로 전체다.
     */
    private data class PrewalkContext(
        val id: Int,
        val guideRoute: TransitGuideRoute,
        val startLeg: Int,
        val destinationLabel: String,
        val dest: BeaconDest,
        val accessible: Boolean,
        /** 승차역 표시 라벨(ko·en 쌍)과 도보 분 — 도보 세션 표식·시작 문장이 읽는다(재시작이 같은 문장을 다시 낸다, A68). */
        val station: TransitLabel,
        val minutes: Int,
        /**
         * 대중교통 세션이 이미 돌던 연장인가(환승 도보 E73·잘못 내림 복구 E78) — 정지 꼬리, 위치 상실 뒤 그 구간 대기로의 재개(`endPrewalk`), 시작 문장
         * 우선순위를 가른다. E78은 새 경로 0번 구간부터라 구간 번호로는 가를 수 없다 — 입구가 밝힌다(A25 첫 도보만 false).
         */
        val isTransfer: Boolean,
        /** 시작 문장 앞 한 문장(E78 「경로를 바꿨습니다.」). 재시작(A68)은 다시 말하지 않는다. */
        val lead: String?,
    ) {
        /** 같은 연결의 새 세대(A68 재시작) — 옛 도보 세션의 늦은 콜백이 새 연결을 소비하지 않게 `id`만 바꾼다. */
        fun renewed(): PrewalkContext = copy(id = nextPrewalkId(), lead = null)
    }

    private var prewalkIdSeq = 0
    private fun nextPrewalkId(): Int = ++prewalkIdSeq
    private var prewalk: PrewalkContext? = null
    /**
     * 도보의 직전 시작이 승차 전 도보였으면 그 연결 컨텍스트(A68). 길찾기 [정확한 위치 허용]의 재시작(`restartBeacon`)이 이 연결을 다시 걸고 모델이 든 시작
     * 인자로 걷기를 다시 시작해 승차 전 도보 → 대중교통으로 잇는다. `prewalk`와 달리 도보 세션이 끝나도 남는다(쓰이는 때가 실패 뒤다). 세우는 자리는
     * `launchPrewalk` 하나, 거두는 자리는 `retirePrewalkRestart` 하나다 — 그 실패 줄과 함께 거둔다.
     */
    private var prewalkRestart: PrewalkContext? = null
    /** 600ms 대기 작업 한 칸(iOS `prewalkTask`) — 외부 시작 진입이 `cancelPrewalk()`로 함께 취소한다. */
    private var prewalkJob: Job? = null
    /** `launchPrewalk`가 도보 시작을 부르는 동안 true — 그 호출의 취소 게이트(`beginBeacon`)가 자기 컨텍스트를 지우지 않게(iOS 동형). */
    private var launchingPrewalk = false
    /** 하차 인계의 600ms 대기(iOS `walkHandoffTask`) — `prewalkJob`과 따로다(외부 시작의 `cancelPrewalk()`가 수락한 인계를 죽이지 않게). */
    private var walkHandoffJob: Job? = null

    /**
     * 시작 실패·환승 도보 위치 상실 뒤 대중교통 시작이 도보 모델의 통지(원인 + 다리 문장)를 기다리는 상한(ms). 두 문장이 4~6초라 여유를 둔다(iOS
     * `walkSpeechWaitLimitMs`). iOS는 VoiceOver가 켜졌을 때만 기다리지만 안드로이드는 안내 문장이 늘 TTS라 늘 기다린다(M5 §6-6).
     */
    private const val WALK_SPEECH_WAIT_LIMIT_MS = 8_000L
    private const val WALK_SPEECH_POLL_MS = 100L
    /** 같은 계층 두 시트의 단일 표시(앞 시트가 내려간 뒤 뒤 시트가 뜬다) — 하차 인계·승차 전 도보 도착·환승 도보가 같은 값(iOS 600ms). */
    private const val HANDOFF_GAP_MS = 600L

    /** 대중교통 안내 시작 진입점(M5 §6-6). ① 거부 통지 ② 본문. 진입점(길찾기 대중교통 줄의 시작 버튼)은 다음 단계가 단다. */
    fun startTransit(request: TransitStartRequest) {
        if (!isAttached || !hasTransit || refuseIfActive()) return
        beginTransit(request)
    }

    /** 거부 판정 없는 대중교통 시작 본문(iOS `beginTransit`, `beginBeacon` 동형). 승차 전 도보(A25)도 여기서 갈린다. */
    private fun beginTransit(request: TransitStartRequest) {
        cancelPrewalk()
        retirePrewalkRestart()  // 새 대중교통 시작 — 승차 전 도보가 있으면 아래 `launchPrewalk`가 새 연결을 세운다
        walk.clearArrival()
        // 시트 표시 초기화와 톤 프리로드(`beginBeacon`과 같은 몫) — 승차 전 도보 없이 곧장 서는 대중교통도 접힌 띠바로 서지 않고, 공유 재생기의 톤이 실린다.
        pendingSheetReturn = null
        suppressNextBandLanding = false
        sceneLookups.clear()
        isMinimized = false
        walk.tones.preload()
        // 승차 전 도보(A25): 첫 탑승 구간 앞 도보가 있으면 도보 실시간 안내를 먼저 돌리고, 도착하면 같은 요청으로 대중교통 세션을 잇는다. 판정은 Kit
        // 순수 함수 — null이면 종전 경로.
        val guideRoute = buildTransitGuideRoute(request.route)
        val target = guideRoute?.let { transitPrewalkTarget(it) }
        if (guideRoute == null || target == null) {
            transit.start(request.route, request.destinationLabel, request.dest, request.accessible)
            return
        }
        // 표시 라벨은 ko·en 쌍(E27 잔여 ①). 도보 세션의 목적지 라벨도 통지와 같은 언어의 같은 이름이다 — 한 세션 안에서 같은 역이 두 이름으로 불리면
        // 「목적지가 바뀌었나」를 의심하게 된다(iOS a11y 감사).
        val stationLabel = transitPrewalkLabel(target)
        val walkLabel = if (transit.transitGuideIsEn) stationLabel.en ?: stationLabel.ko else stationLabel.ko
        val context = PrewalkContext(
            id = nextPrewalkId(), guideRoute = guideRoute, startLeg = 0, destinationLabel = request.destinationLabel, dest = request.dest,
            accessible = request.accessible, station = stationLabel, minutes = target.minutes, isTransfer = false, lead = null,
        )
        launchPrewalk(context) {
            // 승차역까지의 도보에 경유지·출구 인계는 없다.
            beginBeacon(
                WalkStartRequest(
                    dest = BeaconDest(target.lat, target.lng), label = walkLabel, accessible = request.accessible, variant = null, line = null,
                    alternate = null, waypoint = null, exitLead = null,
                ),
            )
        }
    }

    /**
     * 환승 도보(E73 spec D1·D4, iOS `transitTransferWalk`) — 대중교통 모델의 「다음 구간」이 걷기 안내 대상 도보 앞 구간으로 넘어갈 때(`completeOrAdvance`), 잘못
     * 내림 복구가 고른 새 경로의 첫 승차 지점이 걸어가야 하는 곳일 때(`commitRecovery`, 0번 구간·`lead`) 모델 훅이 부른다. 대중교통 세션을 정지음 없이 끝내고(여정
     * 훅 보존) 600ms 뒤 승차 전 도보와 같은 연결로 다음 승차 지점까지 걷는다.
     */
    fun transitTransferWalk(handoff: TransitTransferWalkHandoff) {
        transit.stopForTransferWalk()
        val stationLabel = transitPrewalkLabel(handoff.target)
        val walkLabel = if (transit.transitGuideIsEn) stationLabel.en ?: stationLabel.ko else stationLabel.ko
        val context = PrewalkContext(
            id = nextPrewalkId(), guideRoute = handoff.route, startLeg = handoff.legIndex, destinationLabel = handoff.destinationLabel,
            dest = handoff.dest, accessible = handoff.accessible, station = stationLabel, minutes = handoff.target.minutes, isTransfer = true,
            lead = handoff.lead,
        )
        val walkDest = BeaconDest(handoff.target.lat, handoff.target.lng)
        GuideDiag.log("transferWalk leg=${handoff.legIndex} minutes=${handoff.target.minutes} recovery=${if (handoff.lead != null) 1 else 0}")
        // 600ms: 대중교통 시트가 내려간 뒤 도보 시트가 뜬다. 대기는 `prewalkJob` 한 칸이라 그 사이 다른 시작의 `cancelPrewalk()`가 함께 취소한다.
        prewalkJob?.cancel()
        prewalkJob = uiScope.launch {
            delay(HANDOFF_GAP_MS)
            // 모든 시작이 `cancelPrewalk()`를 지나지는 않는다(연결 없는 `restartBeacon`은 모델 재시작으로 곧장 간다) — 그 사이 다른 안내가 섰으면 그 세션에
            // 환승 표식·종료 훅을 걸지 않고 인계를 버린다(iOS 설계 리뷰 high, spec D4).
            if (GuideSession.isActive) {
                GuideDiag.log("transferWalk abandoned reason=occupied")
                return@launch
            }
            launchPrewalk(context) {
                // 환승역까지의 도보에 경유지·출구 인계는 없다.
                beginBeacon(
                    WalkStartRequest(
                        dest = walkDest, label = walkLabel, accessible = handoff.accessible, variant = null, line = null, alternate = null,
                        waypoint = null, exitLead = null,
                    ),
                )
            }
        }
    }

    /**
     * 승차 전 도보 연결을 걸고 도보 세션을 시작한다(iOS `launchPrewalk`) — 대중교통 시작·환승 도보·정밀 위치 재시작(`restartBeacon`, A68)이 같은 표식·같은
     * 종료 훅·같은 시작 문장을 쓴다. `startWalk`는 도보 세션 시작 하나다(새 요청, 또는 모델이 든 인자의 재시작).
     */
    private fun launchPrewalk(context: PrewalkContext, startWalk: () -> Unit) {
        prewalk = context
        prewalkRestart = context  // 여정 안의 승차 전 도보는 재시작 대상이 아니다(iOS `journey == nil ? context : nil` — 여정은 `and-journey`가 더한다)
        walk.markPrewalk(context.station, transfer = context.isTransfer)
        walk.onSessionEnd = { reason -> endPrewalk(context.id, reason) }
        // 환승 도보는 대중교통 시트가 막 내려가 커서가 밑 화면으로 옮겨 간 자리라 `highPriority`(통지 우선순위 판별선). A25 첫 도보는 앞 시트가 없다.
        // E78 복구는 「경로를 바꿨습니다.」를 앞에 붙인 한 문장 묶음이다 — 두 번 게시하면 latest-wins 창구에서 앞 문장이 진다.
        val startLine = transit.renderer.render(
            transitPrewalkStartLine(isEn = transit.transitGuideIsEn, station = context.station, minutes = context.minutes),
        )
        transit.announceExternal(context.lead?.let { "$it $startLine" } ?: startLine, highPriority = context.isTransfer, speechClass = GuideSpeechClass.actionable)
        launchingPrewalk = true
        try {
            startWalk()
        } finally {
            launchingPrewalk = false
        }
        // 동기 거부(요청 창구의 재진입 가드)면 시작 잡이 없어 실패 콜백도 없다 — 여기서 잇는다.
        if (!walk.ui.value.starting && !walk.isTracking) endPrewalk(context.id, BeaconEndReason.startFailed)
    }

    /** 승차 전 도보 세션의 종료 → 대중교통 연결(iOS `endPrewalk`, spec §4.4). 다른 도보 세션·낡은 콜백은 id로 무시. */
    private fun endPrewalk(id: Int, reason: BeaconEndReason) {
        val context = prewalk ?: return
        if (context.id != id) return
        prewalk = null
        walk.onSessionEnd = null
        when (reason) {
            BeaconEndReason.arrived -> {
                prewalkJob?.cancel()
                prewalkJob = uiScope.launch {
                    delay(HANDOFF_GAP_MS)
                    isMinimized = false  // 승차 전 도보 화면이 사라진 틈(iOS 호스트가 `hasScreen` 소실에 최소화를 푼다) — 대중교통 시트를 펼친 채 세운다
                    transit.startAfterPrewalk(
                        guideRoute = context.guideRoute, startLeg = context.startLeg, destinationLabel = context.destinationLabel, dest = context.dest,
                        accessible = context.accessible, prewalkCompleted = true,
                    )
                }
            }
            BeaconEndReason.startFailed -> {
                // 도보 안내가 불가해도 대중교통 안내는 가능하다 — 도보 문맥은 유지(아직 걷지 않았다). 다리 문장은 도보 모델이 원인 문장 뒤에 붙여 한 통지로
                // 냈다(A67, `WalkGuideModel.fail`) — 대중교통 창구로 따로 내면 같은 턴에 게시돼 원인 문장을 끊는다.
                walk.clearPrewalk()  // 동기 거부 분기는 시작 잡을 지나지 않아 표식이 남는다
                resumeTransitAfterWalkSpeech(context, prewalkCompleted = false, sheetGapMs = 0, logLabel = "startFailSpeechWait")
            }
            BeaconEndReason.locationLost -> if (context.isTransfer) {
                // 환승 도보 중 위치 상실(위원장 판정 2026-10-19): 걷기만 끝내고 그 구간 승차 대기로. 재진입은 도착과 같은 `prewalkCompleted = true`다(이미 걷던
                // 중이라 「도보 N분 이동 후」를 다시 말하면 지난 일을 미래형으로 말한다). 사유와 다리 문장은 도보 모델이 한 통지로 냈다(`stopAndFail`).
                GuideDiag.log("transferWalk locationLost resume leg=${context.startLeg}")
                resumeTransitAfterWalkSpeech(context, prewalkCompleted = true, sheetGapMs = HANDOFF_GAP_MS, logLabel = "locationLostSpeechWait")
            }
            // 문장을 내지 않는다 — 「대중교통 안내는 시작하지 않았다」는 도보 모델이 정지·실패 사유 뒤에 붙여 한 통지로 냈다(`stopByUser`·`stopAndFail`).
            BeaconEndReason.userStopped, BeaconEndReason.ended -> Unit
        }
    }

    /**
     * 도보 모델이 낸 원인·다리 통지가 끝난 뒤 같은 경로로 그 구간의 대중교통 안내를 연다(iOS `resumeTransitAfterWalkSpeech`). 대중교통 시작 통지가 그 두 문장을
     * 끊지 않게 도보 모델의 발화 끝(`announcementsSettled`)을 100ms마다 본다(상한 8초). `sheetGapMs`는 걷던 시트가 있었을 때 내려갈 틈이다.
     */
    private fun resumeTransitAfterWalkSpeech(context: PrewalkContext, prewalkCompleted: Boolean, sheetGapMs: Long, logLabel: String) {
        prewalkJob?.cancel()
        prewalkJob = uiScope.launch {
            if (sheetGapMs > 0) delay(sheetGapMs)
            var waited = 0L
            while (!walk.announcementsSettled() && waited < WALK_SPEECH_WAIT_LIMIT_MS) {
                delay(WALK_SPEECH_POLL_MS)
                waited += WALK_SPEECH_POLL_MS
            }
            GuideDiag.log("prewalk $logLabel ms=$waited")
            isMinimized = false  // 위 도착 갈래와 같은 이유
            transit.startAfterPrewalk(
                guideRoute = context.guideRoute, startLeg = context.startLeg, destinationLabel = context.destinationLabel, dest = context.dest,
                accessible = context.accessible, prewalkCompleted = prewalkCompleted,
            )
        }
    }

    /**
     * 승차 전 도보 재시작 컨텍스트와 그 실패 줄을 함께 거둔다(A68 판정 2, iOS `retirePrewalkRestart`). 그 실패를 만든 승차 전 도보와 무관한 안내가 시작될 때와
     * 대중교통 안내가 그 계획을 지나갔을 때(`transitPassedPrewalk`) 부른다. 컨텍스트가 없으면 실패 줄은 승차 전 도보의 것이 아니라 건드리지 않는다.
     */
    private fun retirePrewalkRestart() {
        if (prewalkRestart == null) return
        prewalkRestart = null
        walk.clearFailure()
    }

    /** 대중교통 안내가 승차 전 도보의 계획을 지나갔다(A68 판정 2) — 탔다 또는 경로·목적지를 바꿨다. 대중교통 모델 훅(`onPassedPrewalk`)이 부른다. */
    fun transitPassedPrewalk() {
        retirePrewalkRestart()
    }

    /** 낡은 연결 폐기(iOS `cancelPrewalk`) — 모든 외부 시작 진입에서. 추적 중인 도보 세션은 건드리지 않는다. */
    private fun cancelPrewalk() {
        prewalk = null
        prewalkJob?.cancel()
        prewalkJob = null
        walk.clearPrewalk()
    }

    /**
     * 길찾기 [정확한 위치 허용] 뒤 재시작(A13·A68, iOS `restartBeacon`) — 그 버튼이 부르는 유일한 경로. 대중교통이 진행 중이면 거부한다(「이미 안내 중」). 걷기는
     * 언제나 모델이 든 시작 인자 한 벌로 다시 시작한다(인자를 다시 조립하지 않는다, A13). 도보의 직전 시작이 승차 전 도보였으면 그 앞에 연결(표식·종료 훅·시작
     * 문장)을 다시 걸어, 도착하면 대중교통으로 잇는다.
     */
    fun restartBeacon() {
        if (!isAttached || refuseIfActive()) return
        if (hasTransit) transit.clearWalkHandoff()
        val context = prewalkRestart
        if (context == null) {
            walk.restart()
            return
        }
        // 시작 실패 뒤 대중교통 시작이 통지 끝을 기다리는 창(A67)이면 그 대기를 취소한다 — 걷기가 다시 시작되므로 대중교통은 도착(또는 다시 실패)한 뒤에 선다.
        cancelPrewalk()
        launchPrewalk(context.renewed()) { walk.restart() }
    }

    /**
     * 대중교통 완료 뒤 도보 인계 수락(E34·E84, iOS `acceptWalkHandoff`) — 마지막 구간 시트의 「남은 도보 안내 시작」이 `transit.advanceIntoWalkHandoff()`가 참일 때
     * 부른다. 한 전이: 출구를 **인계 값에서** 읽고(`stop()`·`clearWalkHandoff()`가 지우기 전) → 대중교통 종료(이미 끝났으면 no-op) → 제안 소거 → 600ms 뒤 공개
     * `startWalk`(대중교통이 이미 끝나 거부 판정을 그대로 지난다). 잘못 내림 복구의 「걸어가기」처럼 인계 값 없이 들어오면 출구가 실리지 않는다(iOS 동형).
     */
    fun acceptWalkHandoff() {
        if (!isAttached || !hasTransit) return
        val state = transit.ui.value
        val dest = state.dest ?: return
        val label = state.destinationLabel
        val accessible = state.accessible
        val exitLead = state.pendingWalkHandoff?.let { handoff ->
            transitValidExitNo(handoff.exitAlight)?.let { ExitLead(exit = it, stationLat = handoff.alightLat, stationLng = handoff.alightLng) }
        }
        transit.stop(playStopTone = false)
        transit.clearWalkHandoff()
        walkHandoffJob?.cancel()
        walkHandoffJob = uiScope.launch {
            delay(HANDOFF_GAP_MS)
            // 대중교통 세션엔 경유지가 없다(ODsay 미지원).
            startWalk(
                WalkStartRequest(
                    dest = dest, label = label, accessible = accessible, variant = null, line = null, alternate = null, waypoint = null,
                    exitLead = exitLead,
                ),
            )
        }
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
        transit?.let { wireTransitHooks(it) }
        prewalk = null
        prewalkRestart = null
        prewalkJob?.cancel(); prewalkJob = null
        walkHandoffJob?.cancel(); walkHandoffJob = null
        launchingPrewalk = false
        this.coordinator = coordinator
        suppressionOwners.clear()
        suppressionPrior = null
        transitSuppressionPrior = null
        speaker?.let { routeSpeechInterruptions(it) }
    }
}

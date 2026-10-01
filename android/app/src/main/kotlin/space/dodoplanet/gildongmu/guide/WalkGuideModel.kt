package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.directions.walkLineNameKey
import space.dodoplanet.gildongmu.kit.AnnounceKind
import space.dodoplanet.gildongmu.kit.BeaconConstants
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.BeaconFix
import space.dodoplanet.gildongmu.kit.BeaconGateState
import space.dodoplanet.gildongmu.kit.BeaconNotice
import space.dodoplanet.gildongmu.kit.BeaconState
import space.dodoplanet.gildongmu.kit.BeaconTone
import space.dodoplanet.gildongmu.kit.BearingUnavailable
import space.dodoplanet.gildongmu.kit.CourseDerivationState
import space.dodoplanet.gildongmu.kit.CourseState
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.DeferredAnnouncer
import space.dodoplanet.gildongmu.kit.DisplayUnit
import space.dodoplanet.gildongmu.kit.GuideEvent
import space.dodoplanet.gildongmu.kit.GuideFix
import space.dodoplanet.gildongmu.kit.GuideNextTargetKind
import space.dodoplanet.gildongmu.kit.GuidePhase
import space.dodoplanet.gildongmu.kit.GuideRoute
import space.dodoplanet.gildongmu.kit.GuideSessionCoordinator
import space.dodoplanet.gildongmu.kit.GuideState
import space.dodoplanet.gildongmu.kit.GuideStepGeometry
import space.dodoplanet.gildongmu.kit.GuideTuning
import space.dodoplanet.gildongmu.kit.KeyValueStore
import space.dodoplanet.gildongmu.kit.KoreanParticle
import space.dodoplanet.gildongmu.kit.LiveRowsState
import space.dodoplanet.gildongmu.kit.LiveStepFields
import space.dodoplanet.gildongmu.kit.LiveStepInput
import space.dodoplanet.gildongmu.kit.MotionConstants
import space.dodoplanet.gildongmu.kit.MotionJudgeState
import space.dodoplanet.gildongmu.kit.MotionSample
import space.dodoplanet.gildongmu.kit.MotionState
import space.dodoplanet.gildongmu.kit.RelativeDirection
import space.dodoplanet.gildongmu.kit.RerouteProposal
import space.dodoplanet.gildongmu.kit.RerouteProposalGate
import space.dodoplanet.gildongmu.kit.RouteOriginDecision
import space.dodoplanet.gildongmu.kit.RouteOriginFix
import space.dodoplanet.gildongmu.kit.RoutePoint
import space.dodoplanet.gildongmu.kit.RouteService
import space.dodoplanet.gildongmu.kit.models.StepFreeStatus
import space.dodoplanet.gildongmu.kit.ToneLayerConstants
import space.dodoplanet.gildongmu.kit.ToneLayerInput
import space.dodoplanet.gildongmu.kit.ToneLayerState
import space.dodoplanet.gildongmu.kit.TrendInput
import space.dodoplanet.gildongmu.kit.WalkHealth
import space.dodoplanet.gildongmu.kit.WalkHealthSummary
import space.dodoplanet.gildongmu.kit.WalkRouteVariant
import space.dodoplanet.gildongmu.kit.advanceProgressAnchor
import space.dodoplanet.gildongmu.kit.beaconGateStep
import space.dodoplanet.gildongmu.kit.beaconStep
import space.dodoplanet.gildongmu.kit.bearingDegrees
import space.dodoplanet.gildongmu.kit.briefArrivalWindowStep
import space.dodoplanet.gildongmu.kit.buildDisplayUnits
import space.dodoplanet.gildongmu.kit.buildGuideRoute
import space.dodoplanet.gildongmu.kit.courseAxisVerdict
import space.dodoplanet.gildongmu.kit.courseStep
import space.dodoplanet.gildongmu.kit.finalApproachArriveMeters
import space.dodoplanet.gildongmu.kit.finalApproachIntervalSeconds
import space.dodoplanet.gildongmu.kit.formatDistance
import space.dodoplanet.gildongmu.kit.guideLiveRows
import space.dodoplanet.gildongmu.kit.guideNextTarget
import space.dodoplanet.gildongmu.kit.guideStep
import space.dodoplanet.gildongmu.kit.haversineMeters
import space.dodoplanet.gildongmu.kit.initialDerivationState
import space.dodoplanet.gildongmu.kit.initialGuideState
import space.dodoplanet.gildongmu.kit.isEndScreenStale
import space.dodoplanet.gildongmu.kit.isUsableFix
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.liveStepsFrom
import space.dodoplanet.gildongmu.kit.models.FinalApproachPayload
import space.dodoplanet.gildongmu.kit.models.WalkLineKind
import space.dodoplanet.gildongmu.kit.motionStep
import space.dodoplanet.gildongmu.kit.presumedArrivalStep
import space.dodoplanet.gildongmu.kit.rebaseBeaconState
import space.dodoplanet.gildongmu.kit.relativeDirection
import space.dodoplanet.gildongmu.kit.routeOriginStep
import space.dodoplanet.gildongmu.kit.sessionIdleStationaryElapsed
import space.dodoplanet.gildongmu.kit.sessionIdleStep
import space.dodoplanet.gildongmu.kit.sessionProgressEpsilonMeters
import space.dodoplanet.gildongmu.kit.spokenDistanceUnits
import space.dodoplanet.gildongmu.kit.toneLayerStep
import space.dodoplanet.gildongmu.kit.walkTurnApproachMeters
import space.dodoplanet.gildongmu.location.LocationPermission
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * 도보 실시간 안내 오케스트레이터(iOS `BeaconModel`의 walk 갈래 미러, spec 2026-09-16-android-m4 §3·§6). 판정은 전부
 * `:kit` 순수 함수이고 여기는 **입력 조립·순서·수명**만 든다. 플랫폼은 포트(`GuidePorts.kt`)로만 본다.
 *
 * ⚠ 동기화가 없다 — 메인 스레드에서만 부른다(`scope`도 메인, `DeferredAnnouncer` 계약). 시계는 `clock`(elapsedRealtime 초)
 * 하나다(§6-3) — 화면이 꺼져도 fix가 계속 오므로 흐르는 것이 옳고, 타이머 축의 절전 정지는 서비스 wake lock이 막는다.
 */
class WalkGuideModel(
    private val routes: RouteService,
    internal val strings: Strings,
    private val dataLocale: () -> DataLocale,
    private val controller: GuideForegroundController,
    private val permissions: GuidePermissions,
    internal val tones: GuideTones,
    internal val speaker: GuideSpeaker,
    private val haptics: GuideHaptics,
    private val steps: StepCounter,
    private val env: GuideEnvironment,
    private val coordinator: GuideSessionCoordinator,
    private val store: KeyValueStore,
    private val scope: CoroutineScope,
    private val clock: () -> Double,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    private val text = GuideText(strings)
    private val tuning = GuideTuning.walk

    private val _ui = MutableStateFlow(WalkGuideUiState())
    val ui: StateFlow<WalkGuideUiState> = _ui.asStateFlow()
    private inline fun mutate(f: WalkGuideUiState.() -> WalkGuideUiState) = _ui.update { it.f() }

    // ── 화면 상태(모두 `ui`로 유도 — 동반 변경에 기대지 않는다) ──
    private var status: GuideStatus
        get() = _ui.value.status
        set(v) = mutate { copy(status = v) }
    private var starting: Boolean
        get() = _ui.value.starting
        set(v) = mutate { copy(starting = v) }
    private var destinationLabel: String
        get() = _ui.value.destinationLabel
        set(v) = mutate { copy(destinationLabel = v) }
    private var statusText: String
        get() = _ui.value.statusText
        set(v) = mutate { copy(statusText = v, statusIsNextPreview = false) }
    private var mode: GuideMode
        get() = _ui.value.mode
        set(v) = mutate { copy(mode = v) }
    private var offRoute: Boolean
        get() = _ui.value.offRoute
        set(v) = mutate { copy(offRoute = v) }
    private var offRouteEndedByReroute: Boolean
        get() = _ui.value.offRouteEndedByReroute
        set(v) = mutate { copy(offRouteEndedByReroute = v) }
    private var isRerouting: Boolean
        get() = _ui.value.isRerouting
        set(v) = mutate { copy(isRerouting = v) }
    private var remainingText: String?
        get() = _ui.value.remainingText
        set(v) = mutate { copy(remainingText = v) }
    private var liveTopText: String?
        get() = _ui.value.liveTopText
        set(v) { if (_ui.value.liveTopText != v) mutate { copy(liveTopText = v) } }
    private var liveNextText: String?
        get() = _ui.value.liveNextText
        set(v) { if (_ui.value.liveNextText != v) mutate { copy(liveNextText = v) } }
    private var soundDegraded: Boolean
        get() = _ui.value.soundDegraded
        set(v) { if (_ui.value.soundDegraded != v) mutate { copy(soundDegraded = v) } }
    private var bandDistanceMeters: Int?
        get() = _ui.value.bandDistanceMeters
        set(v) = mutate { copy(bandDistanceMeters = v) }
    private var arrivalDest: BeaconDest?
        get() = _ui.value.arrivalDest
        set(v) = mutate { copy(arrivalDest = v) }
    private var failResolution: FailResolution
        get() = _ui.value.failResolution
        set(v) = mutate { copy(failResolution = v) }

    val isTracking: Boolean get() = status == GuideStatus.tracking

    /** androidTest 전용 — 시트·띠바를 특정 상태로 띄운다(세션은 시작하지 않는다). 프로덕션 호출 0(소스 가드). */
    @androidx.annotation.VisibleForTesting
    fun debugSetUi(state: WalkGuideUiState) { _ui.value = state }

    /**
     * 출력 억제(받아쓰기·채팅 TTS 점유, §5-5). setter가 톤 재생기에 전파하고, 해제 시 보류된 실행 안내 최신 1개를 복구 발화한다.
     * 소유자 집합은 `GuideSession`이 든다 — 여기는 값 하나.
     */
    var outputSuppressed: Boolean = false
        set(value) {
            val was = field
            field = value
            tones.isSuppressed = value
            if (was && !value) {
                val recovery = pendingRecovery ?: return
                pendingRecovery = null
                announce(recovery)
            }
        }

    // ── 세션 인자 ──
    private var lastStartRequest: WalkStartRequest? = null
    private var dest: BeaconDest? = null
        set(v) { field = v; if (_ui.value.dest != v) mutate { copy(dest = v) } }
    private var accessible = false
    private var sessionVariant: WalkRouteVariant? = null
    /**
     * 이 세션의 줄 종류와 조회 화면의 다른 줄(E42, M4b — iOS `sessionLine`·`alternateLine`). 시작 값으로 정하고 **전환 커밋(`commitLineSwitch`)
     * 에서만** 요청 축(`accessible`·`sessionVariant`)과 함께 바뀐다. `alternateLine`이 null이면 대안 프리뷰 진입점이 없다.
     */
    private var sessionLine: WalkLineKind? = null
    private var alternateLine: WalkLineKind? = null
    private var waypoint: GuideWaypoint? = null
        set(v) { field = v; if (_ui.value.waypointLabel != v?.label) mutate { copy(waypointLabel = v?.label) } }
    private var routeWaypointLabel: String? = null
    /**
     * 이 세션이 경유지를 지났는가(N4 spec 2026-09-24 §4.1, iOS 동형). 지난 뒤 재조회 경로(경유지 없음)에서도 남은 거리 행을
     * "목적지 {dest}까지"로 둔다 — 같은 행이 이유 없이 "남은 거리"로 되돌아가지 않게. 시작·중지에서 false, 경유지 도착에서 true.
     */
    private var waypointPassedInSession = false
    private var sessionToken: Int? = null
    private var startJob: Job? = null
    private var startGeneration = 0

    // ── 리듀서 상태(전부 :kit) ──
    private var beaconState = BeaconState.initial
    private var gateState = BeaconGateState.initial
    private var toneState = ToneLayerState.initial
    private var motionState = MotionJudgeState.initial
    private var guideRoute: GuideRoute? = null
    private var guideRouteDurationSeconds: Int? = null
    private var guideState: GuideState? = null
    private var displayUnits: List<DisplayUnit> = emptyList()
    private var liveSteps: List<LiveStepInput> = emptyList()
    private var liveRowsState: LiveRowsState? = null
    private var liveBaselineD = 0.0

    // ── 시계·fix 축 ──
    private var lastFixAt: Double? = null
    private var startedAt: Double? = null
    private var lastStaleNoticeAt: Double? = null
    private var lastFixCoord: RoutePoint? = null
    private var lastFixCoordAt: Double? = null
    private var watchdogJob: Job? = null

    // ── 경로 조회·재조회 ──
    /** 경로 조회를 기다리는 중 — 안내 시트의 첫 정보 행 착지가 이것이 내려갈 때까지 기다린다(E57 spec §3.3, 화면 상태로 연다). */
    private var awaitingRoute: Boolean
        get() = _ui.value.awaitingRoute
        set(v) = mutate { copy(awaitingRoute = v) }
    private var routeFetchToken = 0
    private var routeFetchJob: Job? = null
    private var fixWaitJob: Job? = null
    private var routeOriginBest: RouteOriginFix? = null
    private var routeOriginBestAt: Double? = null
    private var rerouteToken = 0
    private var rerouteInFlight = false
    private var proposalToken = 0
    private var proposalFetchCount = 0
    private var lastStepFree: String? = null
    /** 경로 재획득(목적지·경유지 변경)이 승계하는 방위 유도기 버퍼 — 위치 종속이라 버리지 않는다. 다음 `fetchGuideRoute` 성공이 1회 소비(iOS 동형). */
    private var carriedCourseDerivation: CourseDerivationState? = null
    private var isSwitchingVariant: Boolean
        get() = _ui.value.isSwitchingVariant
        set(v) { if (_ui.value.isSwitchingVariant != v) mutate { copy(isSwitchingVariant = v) } }

    // ── 대안 프리뷰(M4b, iOS spec 2026-08-14 §3) — 자동 재조회와 같은 latest-wins 토큰 ──
    private var altPreviewState: AltPreviewState = AltPreviewState.Idle
        set(v) {
            field = v
            val ready = v as? AltPreviewState.Ready
            mutate { copy(altPreviewOpen = v != AltPreviewState.Idle, altPreviewReady = ready != null, altPreviewSteps = ready?.fetched?.route?.steps?.map { it.description }) }
        }
    private var altPreviewToken = 0

    // ── 발화 장부 ──
    private var lastGuidance: String? = null
    private var pendingRecovery: String? = null
    private var missedAnnouncement = false
    private var pendingStepFreeNotice: String? = null
    private var pendingFinalApproachIntro: String? = null
    private var pendingFocusDenied = false
    private var wasBackgrounded = false

    // ── 최종 접근·도착 창 ──
    private var inFinalApproach = false
    private var finalApproachGeometry: FinalApproachPayload? = null
    private var finalApproachIntroSpoken = false
    private var lastFinalTickAt: Double? = null
    private var briefWindowActive = false
    private var arrivalWindowEnteredAt: Double? = null
    private var progressAnchor: RoutePoint? = null
    private var lastProgressAt: Double? = null
    private var lastUsableDistanceToDest: Double? = null
    private val inArrivalWindow: Boolean get() = inFinalApproach || briefWindowActive

    // ── 잊힌 세션 안전망 ──
    private var sessionProgressAnchor: RoutePoint? = null
    private var sessionLastProgressAt: Double? = null

    // ── 종료 화면·출력 래치 ──
    private var endedAt: Double? = null
    private var silencedNoticed = false
    private var focusDeniedNoticed = false
    private var mediaVolumeNoticed = false
    private var ttsUnavailableNoticed = false

    private val deferredAnnouncer = DeferredAnnouncer(
        scope = scope, clock = clock, toneEndsAt = { tones.toneEndsAt }, post = ::post,
    )

    // ─────────────────────────── 시작 (§3-2) ───────────────────────────

    /** 유일한 시작 요청 창구(`GuideSession.startWalk`가 부른다). `starting` 재진입 가드. */
    fun requestStart(request: WalkStartRequest) {
        if (starting || isTracking) return   // 추적 중 재요청이 살아 있는 세션의 인자(경유지·계단 회피)를 갈아엎지 않게
        starting = true
        lastStartRequest = request
        mutate { copy(lastStartLine = request.line) }
        accessible = request.accessible
        sessionVariant = request.variant
        sessionLine = request.line
        alternateLine = request.alternate
        waypoint = request.waypoint
        routeWaypointLabel = null
        waypointPassedInSession = false
        lastStepFree = null
        pendingStepFreeNotice = null
        startGeneration += 1
        val generation = startGeneration
        startJob = scope.launch {
            try {
                start(request.dest, request.label)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                // 포트(권한 손·서비스 시작)의 동기 throw가 스코프 밖으로 새면 프로세스가 죽고 토큰·starting이 세션 없이 남는다(리뷰 MAJOR).
                GuideDiag.log("start failed ${e::class.simpleName}: ${e.message}")
                stop()
                fail(GuideStatus.unavailable, "android.guide.serviceStartFailed")
            } finally {
                if (startGeneration == generation) starting = false
            }
        }
    }

    /** 같은 세션을 다시 시작한다(정밀 위치 허용 후 복구 경로). 저장된 인자가 없으면 아무것도 하지 않는다(A13). */
    fun restart() {
        if (isTracking) return
        val request = lastStartRequest ?: return
        requestStart(request)
    }

    private suspend fun start(dest: BeaconDest, label: String) {
        if (isTracking) return
        // 권한 게이트(§3-2 ②) — 위치 서비스 → 권한 → 정밀 순.
        if (!permissions.isLocationEnabled()) { fail(GuideStatus.unavailable, "beacon.weak"); return }
        var permission = permissions.currentLocation()
        if (permission == LocationPermission.None) permission = permissions.requestLocation()
        when (permission) {
            LocationPermission.None -> { fail(GuideStatus.denied, "beacon.denied", FailResolution.settings); return }
            LocationPermission.Coarse -> { fail(GuideStatus.unavailable, "beacon.reduced", FailResolution.precise); return }
            LocationPermission.Fine -> Unit
        }
        // ③ 알림·걸음 권한 — 거부는 차단이 아니다.
        permissions.requestNotifications()
        val stepsGranted = permissions.requestActivityRecognition()
        // ④ 세션 단일성 — 권한 대기 중 뒤집힌 경합의 최종 게이트. 토큰은 stop()이 반납한다.
        val token = coordinator.claim { stop() }
        if (token == null) {
            announceNow(strings.get("guide.alreadyActive"), highPriority = true, bypassSuppression = true)
            return
        }
        sessionToken = token
        // ⑤ 상태 초기화(iOS `start` 대입 목록 그대로).
        deferredAnnouncer.advanceGeneration()
        this.dest = dest
        clearArrival()   // 종료 화면과 그 화면에 결박된 권유 표식을 함께 지운다(E31 — 표식이 다음 종료 화면으로 새지 않게)
        bandDistanceMeters = null
        shownWaypointMeters = null
        outputSuppressed = false
        destinationLabel = label
        beaconState = BeaconState.initial
        gateState = BeaconGateState.initial
        toneState = ToneLayerState.initial
        motionState = MotionJudgeState.initial
        lastFixAt = null
        lastStaleNoticeAt = null
        lastFixCoord = null
        lastFixCoordAt = null
        startedAt = clock()
        sessionProgressAnchor = null
        sessionLastProgressAt = null
        resetFinalApproach(null)
        status = GuideStatus.tracking
        statusText = ""
        failResolution = FailResolution.none
        silencedNoticed = false
        // ⑥ 걸음 센서(허가 시). 기준값은 첫 이벤트, 거리는 항상 null(보폭 환산은 :kit).
        if (stepsGranted) steps.start()
        // ⑦
        GuideDiag.log("session kind=walk")
        // ⑧ 전경 서비스 — 시작 실패는 서비스 안에서 잡혀 `onServiceStartFailed`로 돌아온다(§4-1).
        controller.start()
        if (!isTracking) return  // 서비스 시작 실패 콜백이 동기로 왔으면(테스트·즉시 실패) 이미 접혔다
        // ⑨ 오디오 — 승격은 첫 톤보다 먼저.
        tones.beginSession()
        playTone(BeaconTone.start)   // 미디어 볼륨 0 판정은 playTone 안에서 1회
        // ⑩ 워치독·경로 조회 대기.
        startWatchdog()
        awaitingRoute = true
        routeFetchToken += 1
        startFixWaitWatch(routeFetchToken)
        // ⑪ TTS 초기화(보류 1문장은 재생기 몫). 이미 불가로 판정된 엔진이면 시트 행·진동을 지금 낸다(첫 게시를 기다리지 않는다).
        speaker.prepare()
        syncTtsUnavailable()
    }

    /**
     * 전경 서비스가 `startForeground` 실패를 되부른다(§4-1). 세션이 시작되지 않은 것으로 접는다 — 위치 문제와 문장을 가른다(3-state).
     * `stop()`을 지나지 않으므로 토큰·상태를 여기서 직접 되돌린다.
     */
    fun onServiceStartFailed(error: Throwable) {
        GuideDiag.log("serviceStartFailed ${error::class.simpleName}: ${error.message}")
        val wasTracking = isTracking
        stop(playStopTone = false)
        if (!wasTracking) return
        fail(GuideStatus.unavailable, "android.guide.serviceStartFailed")
    }

    /** 시작 실패 한 판정(§7-6 표): 문장 + `failure` 진동 — 문장이 TalkBack 라벨 낭독이나 타 앱 전경에 삼켜져도 진동은 즉시 신호다. */
    private fun fail(status: GuideStatus, key: String, resolution: FailResolution = FailResolution.none) {
        this.status = status
        failResolution = resolution
        statusText = strings.get(key)
        pendingFailLanding = true
        mutate { copy(failSeq = failSeq + 1) }
        resultHaptic(ResultHapticKind.failure)
        announce(statusText)
    }

    private var pendingFailLanding = false

    /** 시작 실패 행의 착지 1회 소비(전이에만 착지 — 탭 복귀 재컴포지션은 착지하지 않는다). */
    fun takeFailLanding(): Boolean {
        val take = pendingFailLanding
        pendingFailLanding = false
        return take
    }

    // ─────────────────────────── 종료 (§3-3) ───────────────────────────

    /** 중지. 순서가 계약이다(spec §3-3 ①~⑫). 종료 화면(`arrivalDest`)은 건드리지 않는다 — 소거는 `clearArrival()`뿐. */
    fun stop(playStopTone: Boolean = false) {
        pendingStepFreeNotice = null                              // ①
        deferredAnnouncer.advanceGeneration()                     // ②
        resetFinalApproach(null)                                  // ③
        sessionToken?.let { coordinator.release(it) }             // ④
        sessionToken = null
        startJob?.cancel(); startJob = null; starting = false     // ⑤
        watchdogJob?.cancel(); watchdogJob = null                 // ⑥
        controller.stop()                                         // ⑦ 서비스·스트림·wake lock
        steps.stop()                                              // ⑧ 값은 남긴다
        if (playStopTone && status == GuideStatus.tracking) playTone(BeaconTone.stop)  // ⑩
        tones.endSession()                                        // ⑪ 정지 톤 뒤
        // ⑫
        if (status == GuideStatus.tracking) status = GuideStatus.idle
        statusText = ""
        failResolution = FailResolution.none
        soundDegraded = false
        mediaVolumeNoticed = false
        mutate { copy(isSilenced = false, focusDenied = false, ttsUnavailable = false) }
        pendingFocusDenied = false
        focusDeniedNoticed = false
        ttsUnavailableNoticed = false
        pendingRecovery = null          // 억제 해제(아래)가 끝난 경로의 명령을 되살리지 않게 먼저 비운다
        outputSuppressed = false
        beaconState = BeaconState.initial
        gateState = BeaconGateState.initial
        toneState = ToneLayerState.initial
        motionState = MotionJudgeState.initial
        dest = null
        routeFetchJob?.cancel(); routeFetchJob = null
        fixWaitJob?.cancel(); fixWaitJob = null
        routeOriginBest = null
        routeOriginBestAt = null
        awaitingRoute = false
        mode = GuideMode.brief
        guideRoute = null
        guideRouteDurationSeconds = null
        guideState = null
        lastGuidance = null
        remainingText = null
        bandDistanceMeters = null
        shownWaypointMeters = null
        clearLiveRows()
        displayUnits = emptyList()
        liveSteps = emptyList()
        liveBaselineD = 0.0
        offRoute = false
        lastFixCoord = null
        lastFixCoordAt = null
        isRerouting = false
        rerouteInFlight = false
        waypoint = null
        routeWaypointLabel = null
        waypointPassedInSession = false
        isSwitchingVariant = false
        carriedCourseDerivation = null
        rerouteToken += 1
        routeFetchToken += 1
        clearProposal()
        resetAlternativePreview()
        proposalFetchCount = 0
        offRouteEndedByReroute = false
        syncOverview()
    }

    /** 사용자 중지(시트·알림 "안내 종료"). 정지 톤 + 의미 있는 보행이면 `.stopped` 종료 화면(동기 판정). */
    fun stopByUser() {
        val text = strings.get("android.beacon.stopped")
        if (stopLeavingSummary(playStopTone = true, text = text)) announce(text, highPriority = true)
    }

    /**
     * 도착이 아닌 종료. `stop()` 뒤 라이브 걸음 누적이 `WalkHealth.isMeaningfulWalk`면 종료 화면을 남긴다(**동기 판정** —
     * 요약이 없는 종료는 화면이 스치지 않는다). 반환 = 종료 화면을 남겼는가.
     */
    private fun stopLeavingSummary(playStopTone: Boolean, text: String): Boolean {
        val dest = this.dest
        val wasWalkSession = isTracking
        val sample = steps.liveSample
        stop(playStopTone)
        if (!wasWalkSession || dest == null || sample == null) return false
        if (!WalkHealth.isMeaningfulWalk(sample.steps, sample.distanceMeters)) return false
        presentEndScreen(dest, SessionEndKind.stopped, text, sample)
        return true
    }

    private fun presentEndScreen(dest: BeaconDest, kind: SessionEndKind, text: String, sample: StepSample?) {
        endedAt = clock()
        arrivalHealthSample = sample?.takeIf { WalkHealth.isMeaningfulWalk(it.steps, it.distanceMeters) }
        val health = arrivalHealthSample?.let { WalkHealth.summary(it.steps, it.distanceMeters, storedWeight()) }
        mutate { copy(arrivalDest = dest, endKind = kind, endText = text, arrivalHealth = health, weightPromptShown = showsWeightPrompt(health)) }
    }

    private fun storedWeight(): Double? = WalkHealth.normalizedWeight(store.getString(WalkHealth.weightStorageKey)?.toDoubleOrNull())

    /** 종료 화면 걸음 요약의 원표본 — 설정에서 체중을 바꾸고 돌아오면 이것으로 다시 계산한다(iOS `arrivalHealthSample`). */
    private var arrivalHealthSample: StepSample? = null

    // ── 체중 입력 권유(E31, spec 2026-09-11) — 카운터·응답 표식은 영속(키는 iOS와 같은 이름) ──
    private var weightPromptDismissals: Int
        get() = store.getString(WalkHealth.weightPromptDismissalsKey)?.toIntOrNull() ?: 0
        set(v) = store.putString(WalkHealth.weightPromptDismissalsKey, v.toString())

    /**
     * 권유가 뜬 화면에서 [체중 입력하기]를 눌렀는가. ⚠ 화면 상태가 아니라 영속이어야 한다 — 시트를 최소화하면 종료 화면
     * 컴포지션이 사라져 `remember`가 초기값으로 돌아가고, 설정에 다녀온 뒤 [닫기]가 무시로 계상된다(iOS 리뷰 검출, spec §4).
     */
    private var weightPromptEngaged: Boolean
        get() = store.getString(WalkHealth.weightPromptEngagedKey) == "true"
        set(v) = store.putString(WalkHealth.weightPromptEngagedKey, v.toString())

    /** 렌더와 [닫기]가 같은 값(`ui.weightPromptShown`)을 읽도록 건강 요약을 바꾸는 자리마다 이 술어로 투영한다. */
    private fun showsWeightPrompt(health: WalkHealthSummary?): Boolean =
        health != null && WalkHealth.shouldShowWeightPrompt(health.usedDefaultWeight, weightPromptDismissals)

    /** 설정에서 돌아온 뒤 저장 체중으로 요약을 다시 계산한다(iOS `recomputeArrivalHealth`). 입력했으면 권유가 저절로 사라진다. */
    fun recomputeArrivalHealth() {
        val sample = arrivalHealthSample ?: return
        val health = WalkHealth.summary(sample.steps, sample.distanceMeters, storedWeight())
        mutate { copy(arrivalHealth = health, weightPromptShown = showsWeightPrompt(health)) }
    }

    /** [체중 입력하기] — 응답 표식을 세운다(뒤이은 [닫기]는 무시가 아니다). 설정 이동은 화면 몫. */
    fun engageWeightPrompt() {
        if (!_ui.value.weightPromptShown) return
        weightPromptEngaged = true
        pendingWeightSettingsReturn = true
    }

    /** 설정에 다녀온 뒤 종료 화면 재진입 1회 소비 — 화면이 요약을 다시 계산하고 착지를 고른다(시트는 그 사이 파괴된다). */
    private var pendingWeightSettingsReturn = false

    fun takeWeightSettingsReturn(): Boolean {
        val take = pendingWeightSettingsReturn
        pendingWeightSettingsReturn = false
        return take
    }

    /**
     * 종료 화면 [닫기] — 권유가 떠 있던 화면을 아무 행동 없이 닫은 것만 무시로 센다(카운터 갱신의 유일한 호출 자리). 표식은 여기서
     * 소비한다. ⚠ 순서가 load-bearing이다: `clearArrival()`이 먼저 돌면 `weightPromptShown`이 false로 떨어져 카운터가 영영 오르지
     * 않는다(소스 가드 `GuideSourceGuardTest`).
     */
    fun closeEndScreen() {
        weightPromptDismissals = WalkHealth.nextWeightPromptDismissals(weightPromptDismissals, _ui.value.weightPromptShown, weightPromptEngaged)
        weightPromptEngaged = false
        clearArrival()
    }

    /**
     * 종료 화면 소거 — "닫기"(`closeEndScreen`)·30분 만료·새 세션 시작이 부른다. 무시 횟수는 세지 않는다(닫기만 센다). 권유 표식 둘은 그
     * 화면에 결박된 값이라 여기서 함께 지운다 — 만료·새 세션으로 사라진 화면의 응답이 다음 종료 화면의 [닫기]를 면제하지 않게. 최소화는
     * 이 함수를 지나지 않으므로 설정 왕복 중에는 살아 있다(spec §4).
     */
    fun clearArrival() {
        arrivalHealthSample = null
        pendingWeightSettingsReturn = false
        weightPromptEngaged = false
        mutate { copy(arrivalDest = null, endKind = SessionEndKind.arrived, endText = "", arrivalHealth = null, weightPromptShown = false, liveTopText = null) }
        if (!status.isFailure) statusText = ""   // 종료 문장이 상환 꼬리로 맥락 밖에서 되읽히지 않게(iOS 동형)
        endedAt = null
    }

    /** 시작 실패 행 소거(해결 버튼 뒤·다른 시작 앞). */
    fun clearFailure() {
        if (!status.isFailure) return
        status = GuideStatus.idle
        statusText = ""
        failResolution = FailResolution.none
    }

    /** 위치 제공자 꺼짐(스트림 콜백, §3-3) — 세션을 끝내고 실패 상태를 남긴다. */
    fun handleProviderDisabled() {
        if (!isTracking) return
        GuideDiag.log("providerDisabled")
        stopLeavingSummary(playStopTone = false, text = strings.get("beacon.weak"))
        fail(GuideStatus.unavailable, "beacon.weak")
    }

    // ─────────────────────────── 전경 복귀 (§5-3) ───────────────────────────

    /** `GuideBottomBar`의 수명 관찰자가 ON_START/ON_STOP을 넘긴다. 상환 블록은 `isTracking` 판정보다 앞이다. */
    fun setForeground(foreground: Boolean) {
        if (!foreground) { wasBackgrounded = true; return }
        val returnedFromBackground = wasBackgrounded
        wasBackgrounded = false
        if (returnedFromBackground && !isTracking && arrivalDest != null) {
            val since = endedAt?.let { clock() - it }
            if (since != null && isEndScreenStale(since)) {
                GuideDiag.log("endScreenExpired age=${since.toInt()}")
                pendingFinalApproachIntro = null
                pendingStepFreeNotice = null
                clearArrival()
            }
        }
        if (missedAnnouncement || pendingStepFreeNotice != null || pendingFinalApproachIntro != null) {
            missedAnnouncement = false
            val intro = pendingFinalApproachIntro
            // 상태 행이 비어 있으면(실행 안내 직후 — 역할 분리로 statusText에 실행 안내가 남지 않는다) 마지막 안내가 곧 현재 상태다(iOS 동형).
            val current = statusText.ifEmpty { lastGuidance.orEmpty() }
            val tail = if (current.isEmpty() || current == intro) null else current
            val owed = listOfNotNull(pendingStepFreeNotice, intro, tail).joinToString(" ")
            if (owed.isNotEmpty()) {
                val notice = pendingStepFreeNotice
                pendingStepFreeNotice = null
                pendingFinalApproachIntro = null
                announce(owed) {
                    pendingStepFreeNotice = notice
                    pendingFinalApproachIntro = intro
                }
            }
        }
    }

    // ─────────────────────────── 경로 조회 (§6-2) ───────────────────────────

    /** 상세 조회 시간 초과 — 호출부 셋(시작·재조회·자동 재조회)은 예외를 이미 실패로 접고, 프리뷰는 `Failed`로 간다. */
    private class DetailFetchTimeout : Exception("detail fetch timeout")

    private class DetailFetchResult(
        val route: GuideRoute,
        val durationSeconds: Int?,
        val stepFreeRaw: String?,
        val stepFree: StepFreeStatus?,
        val stepFreeNotice: String?,
        val finalApproach: FinalApproachPayload?,
        val liveSteps: List<LiveStepInput>,
        /** 받은 경로의 줄 종류(응답 `kind`) — 전환 문장·프리뷰 헤더가 요청이 아니라 받은 성질로 부른다(E42 설계 리뷰 MAJOR 1). */
        val lineKind: WalkLineKind?,
    )

    /** 수용 fix가 15초 안에 오지 않으면 최선 fix로 조회하고, 그것도 없으면 간략 폴백(`guide.detailNoLocation`). */
    private fun startFixWaitWatch(token: Int) {
        fixWaitJob?.cancel()
        routeOriginBest = null
        routeOriginBestAt = null
        fixWaitJob = scope.launch {
            delay((noFixTimeoutSeconds * 1000).toLong())
            if (token != routeFetchToken || !isTracking || !awaitingRoute || routeFetchJob != null) return@launch
            val best = routeOriginBest
            val dest = dest
            if (best != null && dest != null) {
                val aged = routeOriginBestAt?.let { best.copy(ageSeconds = best.ageSeconds + (clock() - it)) } ?: best
                startRouteFetch(aged, "best", dest, token)
                return@launch
            }
            GuideDiag.log("routeOrigin reason=none")
            awaitingRoute = false
            fallbackToBrief("guide.detailNoLocation")
            lastStaleNoticeAt = clock()
        }
    }

    private fun startRouteFetch(origin: RouteOriginFix, reason: String, dest: BeaconDest, token: Int) {
        GuideDiag.log { "routeOrigin lat=${"%.6f".format(origin.lat)} lng=${"%.6f".format(origin.lng)} acc=${"%.1f".format(origin.accuracy)} age=${"%.1f".format(origin.ageSeconds)} reason=$reason" }
        routeOriginBest = null
        routeOriginBestAt = null
        routeFetchJob = scope.launch { fetchGuideRoute(RoutePoint(origin.lat, origin.lng), dest, token) }
    }

    /**
     * `RouteService.walk(includeGeometry)` → `buildGuideRoute`. null = 상세 부적격(간략 폴백). ⚠ `GuideStepGeometry.action`을
     * 빠뜨리면 walk 프로파일에서 임박 큐가 전면 침묵한다(E16 축3). 경유지를 보냈는데 응답에 표지가 없으면 null.
     */
    private suspend fun fetchDetailData(origin: RoutePoint, dest: BeaconDest, variant: WalkRouteVariant?, accessible: Boolean, waypoint: GuideWaypoint?): DetailFetchResult? {
        val via = waypoint?.let { RoutePoint(it.dest.lat, it.dest.lng) }
        // ⚠ 블록 값을 상자에 담는다 — 그대로 두면 서버의 정상 "경로 없음"(null)이 만료 null과 같은 값이 된다. 시간 초과는 경로 없음이 아니라 조회 실패다
        // (3-state — 프리뷰가 "대안 없음"으로 읽지 않게, 길찾기 VM `timed` 동형).
        val briefing = (
            withTimeoutOrNull(queryTimeoutMs) {
                withContext(io) {
                    Result.success(routes.walk(origin.lat, origin.lng, dest.lat, dest.lng, accessible = accessible, lang = dataLocale(), includeGeometry = true, variant = variant, via = via))
                }
            } ?: throw DetailFetchTimeout()
        ).getOrThrow() ?: return null
        if (via != null && briefing.waypoint == null) return null
        val route = buildGuideRoute(
            briefing.steps.map { GuideStepGeometry(it.description, it.pathCoords, it.action) },
            briefing.waypoint?.stepIndex,
        ) ?: return null
        return DetailFetchResult(
            route, briefing.durationSeconds, briefing.stepFree, briefing.stepFreeStatus, briefing.stepFreeNotice, briefing.finalApproach,
            liveStepsFrom(route, briefing.steps.map { LiveStepFields(it.live?.target, it.live?.anchor, it.crossing ?: false) }),
            briefing.lineKind,
        )
    }

    /** 열화 전이 판정 — 신호는 "서버가 문장을 실었는가"다. 직전 상태 갱신의 부작용이 있어 기하 빌드 성공 뒤 정확히 1회. */
    private fun consumeStepFreeNotice(raw: String?, status: StepFreeStatus?, notice: String?): String? {
        val prev = lastStepFree
        val benign = raw == null || status == StepFreeStatus.applied
        if (benign || notice != null) lastStepFree = raw
        if (benign || notice == null || raw == prev) return null
        return notice
    }

    private suspend fun fetchGuideRoute(origin: RoutePoint, dest: BeaconDest, token: Int) {
        val waypointAtFetch = waypoint
        try {
            val fetched = runCatching { fetchDetailData(origin, dest, sessionVariant, accessible, waypointAtFetch) }
            if (token != routeFetchToken || !isTracking || this.dest != dest || this.waypoint != waypointAtFetch) return
            val result = fetched.getOrElse { fallbackToBrief(); return }
            if (result == null) { fallbackToBrief(); return }
            guideRoute = result.route
            routeWaypointLabel = waypointAtFetch?.label
            guideRouteDurationSeconds = result.durationSeconds
            resetFinalApproach(result.finalApproach)
            val initial = initialGuideState(
                result.route, clock(), hasFinalApproachGeometry = result.finalApproach != null,
                courseDerivation = carriedCourseDerivation ?: initialDerivationState,
            )
            carriedCourseDerivation = null
            guideState = initial.state
            mode = GuideMode.detail
            offRoute = false
            updateRemaining(result.route, initial.state)
            displayUnits = buildDisplayUnits(result.liveSteps)
            liveSteps = result.liveSteps
            resetLiveRowsBaseline(initial.state)
            syncOverview()
            val summary = text.start(result.route, initial.firstIndices, destinationLabel)
            val notice = consumeStepFreeNotice(result.stepFreeRaw, result.stepFree, result.stepFreeNotice)
            val spoken = if (notice != null) "$notice $summary" else summary
            lastGuidance = text.unit(result.route, initial.firstIndices)
            statusText = spoken
            announce(spoken, highPriority = true) { if (notice != null) pendingStepFreeNotice = notice }
        } finally {
            if (token == routeFetchToken) { awaitingRoute = false; routeFetchJob = null }
        }
    }

    /**
     * 상세 불가 시 간략 폴백 — 조용한 강등 금지, 문구는 원인별로 가른다. 경유지가 있으면 사실을 말하고 비운다.
     * N4(iOS `BeaconModel.fallbackToBrief` 동형): 경로 실패는 강등 문장을 경유지 문장으로 **대체**하고, 위치 실패는
     * 원인 없는 문장(`waypointSkipped`)을 덧붙인다(원인절을 붙이면 거짓 원인).
     */
    private fun fallbackToBrief(key: String = "guide.detailUnavailable") {
        resetArrivalWindow()
        carriedCourseDerivation = null   // 소비되지 못한 유도기 버퍼가 다음 재조회로 옛 위치 이력을 옮기지 않게
        mode = GuideMode.brief
        remainingText = null
        clearLiveRows()
        lastStepFree = null
        pendingStepFreeNotice = null
        var spoken = if (key == "guide.detailUnavailable") strings.get(key, destinationLabel) else strings.get(key)
        var droppedWaypoint = false
        waypoint?.let { dropped ->
            waypoint = null
            routeWaypointLabel = null
            syncStartRequestWithSession()
            droppedWaypoint = true
            spoken = if (key == "guide.detailUnavailable") strings.get("android.guide.waypointDropped", dropped.label, destinationLabel)
            else spoken + " " + strings.get("android.guide.waypointSkipped", dropped.label)
        }
        syncOverview()
        statusText = spoken
        announce(spoken, highPriority = droppedWaypoint)
    }

    private fun syncStartRequestWithSession() {
        val request = lastStartRequest ?: return
        val dest = dest ?: return
        // 요청 축·줄 종류도 세션 현재값 — 수동 전환(E42)이 넷을 함께 바꾸므로 시작 시점 값은 낡는다(iOS 동형, A13).
        lastStartRequest = request.copy(
            dest = dest, label = destinationLabel, accessible = accessible, variant = sessionVariant,
            line = sessionLine, alternate = alternateLine, waypoint = waypoint,
        )
    }

    /**
     * 남은 거리 행 — 경유지가 있는 세션은 **다음 목표** 기준 한 줄(N4 spec 2026-09-24 §4.1, iOS `updateRemaining` 동형): 도착 전
     * 경유지, 도착 뒤(또는 이 세션이 경유지를 지났으면) 목적지. 띠바는 총 잔여를 유지한다. 라벨은 경로에 결박된
     * `routeWaypointLabel`이고, 없으면 종전 행으로 물러난다.
     */
    private fun updateRemaining(route: GuideRoute, state: GuideState) {
        val remainingMeters = max(0.0, route.totalMeters - state.d).roundToInt()
        updateBandDistance(remainingMeters)
        // 행의 목적지 잔여는 띠바와 같은 10m 갱신 값이다(E57 spec §3.6): 시트가 열리면 커서가 이 행에 앉는데, 1km 미만은 미터 원값이라
        // 매 fix 문자열이 바뀌어 커서 위에서 다시 읽힌다(띠바와 같은 기제). 같은 문장이면 상태가 바뀌지 않는다(StateFlow 동일 값).
        val shownMeters = bandDistanceMeters ?: remainingMeters
        val target = guideNextTarget(route, state)
        val viaLabel = routeWaypointLabel
        val distancePart: String
        val minutes: Int?
        if (target.kind == GuideNextTargetKind.waypoint && viaLabel != null) {
            // 경유지 거리는 띠바 값과 다른 양이라 같은 규칙(10m 이상 변했을 때만)을 따로 적용한다.
            val meters = max(0, target.meters.roundToInt())
            if (shownWaypointMeters?.let { abs(it - meters) >= 10 } != false) shownWaypointMeters = meters
            distancePart = strings.get("directions.viaRemaining", viaLabel, formatDistance(shownWaypointMeters ?: meters))
            minutes = etaMinutes(route, target.meters)
        } else if ((target.kind == GuideNextTargetKind.destination && viaLabel != null) || waypointPassedInSession) {
            shownWaypointMeters = null
            distancePart = strings.get("directions.viaDestRemaining", destinationLabel, formatDistance(shownMeters))
            minutes = etaMinutesNow(route, state)
        } else {
            shownWaypointMeters = null
            distancePart = strings.get("guide.remainingDistance", formatDistance(shownMeters))
            minutes = etaMinutesNow(route, state)
        }
        val timePart = minutes?.let { strings.get("guide.remainingTime", it.toString()) }
        remainingText = joinText(distancePart, timePart)
    }

    /** 남은 거리 행의 경유지 거리(10m 이상 변했을 때만 갱신, E57 §3.6). */
    private var shownWaypointMeters: Int? = null

    /** 띠바 거리 양자화(10m). 같은 구간이면 라벨을 건드리지 않는다. */
    private fun updateBandDistance(meters: Int) {
        val clamped = max(0, meters)
        val current = bandDistanceMeters
        if (current != null && abs(current - clamped) < 10) return
        bandDistanceMeters = clamped
    }

    /** 총 잔여까지의 시간(분) — 상시 표시와 진행 상황 조망이 같은 산식을 쓴다(사본 금지). */
    private fun etaMinutesNow(route: GuideRoute, state: GuideState): Int? =
        etaMinutes(route, max(0.0, route.totalMeters - state.d))

    /**
     * 목표 잔여(m)까지의 시간(분) — 총 소요의 잔여 비례(iOS `etaMinutes`의 walk 갈래). 근거 없으면 null(3-state). 목표를 이미 밟은
     * 값(1m 미만)에 "약 1분"을 붙이지 않는다(N4 설계 리뷰 #11).
     */
    private fun etaMinutes(route: GuideRoute, remainingMeters: Double): Int? {
        if (remainingMeters < 1) return null
        val dur = guideRouteDurationSeconds ?: return null
        if (dur <= 0 || route.totalMeters <= 0) return null
        return max(1, (dur.toDouble() * remainingMeters / route.totalMeters / 60).roundToInt())
    }

    /**
     * ko 도착 문장의 목적지 + 방향 조사("서울역으로"·"학교로"). 받침을 모르는 이름(영문·숫자 끝)은 `로` — 조사를 빼면 문장이
     * 깨진다(N4 spec 2026-09-24 §3, 폴백은 추측·실보행 판정 ④). 비-ko는 원문.
     */
    private fun destinationWithDirectionParticle(label: String): String {
        if (dataLocale() != DataLocale.ko) return label
        return label + (KoreanParticle.directionMarker(label) ?: "로")
    }

    // ─────────────────────────── 하단 2행·조망 ───────────────────────────

    private fun refreshLiveRows(state: GuideState) {
        val out = guideLiveRows(liveRowsState, displayUnits, state.d, liveBaselineD, state.phase, walkTurnApproachMeters)
        liveRowsState = out.state
        liveTopText = out.top?.let(text::liveTop)
        liveNextText = out.next?.let(text::liveNext)
    }

    private fun resetLiveRowsBaseline(state: GuideState) {
        liveBaselineD = state.d
        liveRowsState = null
        refreshLiveRows(state)
    }

    private fun clearLiveRows() {
        liveTopText = null
        liveNextText = null
        liveRowsState = null
    }

    /** 조망 파생값(iOS computed 3종)을 `ui`로 투영한다 — 경로·상태·모드가 바뀌는 지점마다. */
    private fun syncOverview() {
        val route = guideRoute
        val state = guideState
        val detail = mode == GuideMode.detail && route != null
        val descriptions = if (detail) route!!.steps.map { it.description } else null
        val waypointRow = if (detail) route!!.waypointStepIndex?.let { idx -> routeWaypointLabel?.let { idx to strings.get("directions.viaArrived", it) } } else null
        val current = if (detail && state != null && (state.phase == GuidePhase.following || state.phase == GuidePhase.bundle)) state.stepIndex else null
        // 최종 접근 중엔 대안 보기가 없다 — 채택이 막혀(방어 2선) 누를 수 없는 전환 버튼이 선다(죽은 버튼 금지).
        val altAvailable = mode == GuideMode.detail && alternateLine != null && !inFinalApproach
        mutate { copy(routeStepDescriptions = descriptions, routeWaypointRow = waypointRow, currentStepIndex = current, alternativePreviewAvailable = altAvailable) }
    }

    // ─────────────────────────── 톤·모션 배선 ───────────────────────────

    private fun judgeMotion(fix: GuideFixPayload, ageSeconds: Double, now: Double): MotionState {
        if (abs(ageSeconds) > BeaconConstants.freshnessWindow) return MotionState.speedUnknown
        val out = motionStep(motionState, MotionSample(fix.lat, fix.lng, fix.accuracy, now), fix.speed, fix.speedAccuracy, MotionConstants.maxWalkSpeedMps)
        motionState = out.state
        return out.motion
    }

    private val arrivedNow: Boolean get() = mode == GuideMode.brief && beaconState.nearby

    private fun routeTone(input: ToneLayerInput, now: Double) {
        val out = toneLayerStep(toneState, input, now)
        toneState = out.state
        out.tone?.let(::playTone)
    }

    // ─────────────────────────── fix 처리 (§6-1) ───────────────────────────

    fun handleFix(fix: GuideFixPayload) {
        if (!isTracking) return
        val dest = dest ?: return
        val now = clock()
        val age = now - fix.elapsedRealtimeMs / 1000.0
        val motion = judgeMotion(fix, age, now)

        if (awaitingRoute) {
            lastFixAt = now
            noteSessionProgress(fix.lat, fix.lng, now)
            if (routeFetchJob == null) {
                val candidate = RouteOriginFix(fix.lat, fix.lng, fix.accuracy, age)
                when (val decision = routeOriginStep(routeOriginBest, candidate)) {
                    is RouteOriginDecision.Fetch -> {
                        fixWaitJob?.cancel(); fixWaitJob = null
                        startRouteFetch(decision.fix, "accepted", dest, routeFetchToken)
                    }
                    is RouteOriginDecision.Wait -> {
                        if (decision.best != routeOriginBest) routeOriginBestAt = now
                        routeOriginBest = decision.best
                        GuideDiag.log { "routeOriginWait acc=${"%.1f".format(fix.accuracy)} age=${"%.1f".format(age)} best=${decision.best?.let { "%.1f".format(it.accuracy) } ?: "-"}" }
                    }
                }
            }
            return
        }
        if (inFinalApproach) { handleFinalApproach(fix, motion, age, now); return }
        val route = guideRoute
        if (mode == GuideMode.detail && route != null) { handleDetail(fix, route, motion, age, now); return }

        // ── 간략 ──
        val usable = isUsableFix(fix.accuracy, age)
        GuideDiag.log {
            "brief t=${"%.1f".format(now)} lat=${"%.6f".format(fix.lat)} lng=${"%.6f".format(fix.lng)} acc=${"%.1f".format(fix.accuracy)} motion=$motion age=${"%.1f".format(age)} usable=$usable dist=${"%.1f".format(haversineMeters(fix.lat, fix.lng, dest.lat, dest.lng))} nearby=${beaconState.nearby}"
        }
        if (!usable) { routeTone(ToneLayerInput(unreliable = true, arrived = arrivedNow), now); return }
        lastFixAt = now
        lastStaleNoticeAt = null
        lastFixCoord = RoutePoint(fix.lat, fix.lng)
        lastFixCoordAt = now
        noteSessionProgress(fix.lat, fix.lng, now)
        updateBandDistance(haversineMeters(fix.lat, fix.lng, dest.lat, dest.lng).roundToInt())

        val stepped = beaconStep(beaconState, BeaconFix(fix.lat, fix.lng, fix.accuracy), dest)
        beaconState = stepped.state
        val window = briefArrivalWindowStep(briefWindowActive, stepped.state.nearby, fix.accuracy)
        val straightDistance = stepped.announce.distance
        if (window.entered) {
            resetArrivalWindow()
            arrivalWindowEnteredAt = now
            lastUsableDistanceToDest = straightDistance
            GuideDiag.log { "arrivalWindowEnter mode=brief dist=${"%.1f".format(straightDistance)} acc=${"%.1f".format(fix.accuracy)}" }
        } else if (window.exited) {
            GuideDiag.log { "arrivalWindowExit reason=${if (stepped.state.nearby) "accuracy" else "released"}" }
            resetArrivalWindow()
        }
        briefWindowActive = window.active
        if (window.active) {
            lastUsableDistanceToDest = straightDistance
            val anchorStep = advanceProgressAnchor(progressAnchor, RoutePoint(fix.lat, fix.lng))
            progressAnchor = anchorStep.anchor
            if (anchorStep.progressed) lastProgressAt = now
        }
        val gated = beaconGateStep(gateState, stepped.announce)
        gateState = gated.state
        val weak = stepped.announce.kind == AnnounceKind.weak
        routeTone(
            ToneLayerInput(
                unreliable = weak,
                priorityTone = if (gated.nearbyTone) BeaconTone.nearby else null,
                trend = if (weak) null else TrendInput(
                    distance = stepped.announce.distance,
                    deadBand = max(BeaconConstants.baseDeadBand, fix.accuracy),
                    deadBandFloor = fix.accuracy,
                    motion = motion,
                    closerIntervalSeconds = ToneLayerConstants.walkCloserIntervalSeconds,
                ),
                arrived = beaconState.nearby,
            ),
            now,
        )
        gated.notice?.let { notice ->
            val spoken = noticeText(notice)
            statusText = spoken
            if (notice !is BeaconNotice.Weak) lastGuidance = spoken
            announce(spoken)
        }
        maybePresumeArrival(now)
    }

    private fun noticeText(notice: BeaconNotice): String = when (notice) {
        is BeaconNotice.First -> strings.get("beacon.first", formatDistance(notice.meters))
        is BeaconNotice.Closer -> strings.get("beacon.closer", formatDistance(notice.meters))
        is BeaconNotice.Farther -> strings.get("beacon.farther", formatDistance(notice.meters))
        is BeaconNotice.Nearby -> strings.get("beacon.nearby", notice.accuracyMeters.toString())
        BeaconNotice.Weak -> strings.get("beacon.weak")
    }

    private fun handleDetail(fix: GuideFixPayload, route: GuideRoute, motion: MotionState, age: Double, now: Double) {
        val state = guideState ?: return
        if (!(fix.accuracy > 0 && age <= 10)) { routeTone(ToneLayerInput(unreliable = true), now); return }
        lastFixAt = now
        lastStaleNoticeAt = null
        lastFixCoord = RoutePoint(fix.lat, fix.lng)
        lastFixCoordAt = now
        noteSessionProgress(fix.lat, fix.lng, now)

        val out = guideStep(state, GuideFix(fix.lat, fix.lng, fix.accuracy), route, now, tuning)
        guideState = out.state
        when (out.event) {
            GuideEvent.BackOnRoute, GuideEvent.Reacquired -> { liveBaselineD = out.state.d; liveRowsState = null }
            else -> Unit
        }
        refreshLiveRows(out.state)
        syncOverview()
        GuideDiag.log {
            val votes = out.state.courseVotes
            "fix t=${"%.1f".format(now)} lat=${"%.6f".format(fix.lat)} lng=${"%.6f".format(fix.lng)} acc=${"%.1f".format(fix.accuracy)} " +
                "course=${"%.1f".format(fix.course)} courseAcc=${"%.1f".format(fix.courseAccuracy)} speed=${fix.speed?.let { "%.2f".format(it) } ?: "-"} speedAcc=${fix.speedAccuracy?.let { "%.2f".format(it) } ?: "-"} " +
                "motion=$motion age=${"%.1f".format(age)} phase=${out.state.phase} d=${"%.1f".format(out.state.d)} event=${out.event ?: "-"} " +
                "perp=${out.perpMeters?.let { "%.1f".format(it) } ?: "-"} edgeHits=${out.state.windowEdgeHits} " +
                "derived=${out.derivedCourse?.let { "%.1f±%.1f".format(it.bearing, it.uncertaintyDeg) } ?: "-"} vote=${out.courseVote?.rawValue ?: "-"} " +
                "axes=d:${out.state.offRouteAxes.distance}/c:${out.state.offRouteAxes.course} " +
                "votes=m:${votes.count { it.vote.rawValue == "mismatch" }}/k:${votes.count { it.vote.rawValue == "match" }}/u:${votes.count { it.vote.rawValue == "unknown" }} " +
                "verdict=${courseAxisVerdict(votes).rawValue}"
        }
        val remaining = max(0.0, route.totalMeters - out.state.d)
        val jumped = out.projectionJumped == true
        if (out.event == GuideEvent.FinalApproachEnter) {
            beginFinalApproach()
            if (inFinalApproach) handleFinalApproach(fix, motion, age, now)
            return
        }
        updateRemaining(route, out.state)
        val phase = out.state.phase
        val trendable = (phase == GuidePhase.following || phase == GuidePhase.bundle) && !jumped
        routeTone(
            ToneLayerInput(
                unreliable = phase == GuidePhase.uncertain || phase == GuidePhase.reacquiring,
                priorityTone = out.tone?.let(BeaconTone::fromGuide),
                eventOwned = out.event != null,
                trend = if (trendable) TrendInput(
                    distance = remaining, deadBand = detailDeadBand, deadBandFloor = detailDeadBandFloor,
                    motion = motion, closerIntervalSeconds = ToneLayerConstants.walkCloserIntervalSeconds,
                ) else null,
            ),
            now,
        )
        val event = out.event
        if (event == null) { syncStatusTextWithPhase(out.state.phase); return }
        consume(event, route)
    }

    /** 이벤트 없이 국면만 바뀐 fix의 상태 텍스트를 되돌린다(재획득 문구일 때뿐, 통지 없음). */
    private fun syncStatusTextWithPhase(phase: GuidePhase) {
        if (phase != GuidePhase.offRoute || statusText != strings.get("guide.reacquiring")) return
        statusText = strings.get("guide.offRoute")
    }

    private fun consume(event: GuideEvent, route: GuideRoute) {
        when (event) {
            is GuideEvent.AnnounceSteps -> announceUnit(route, event.indices)
            is GuideEvent.BundleReread -> announceUnit(route, event.indices)
            is GuideEvent.Imminent -> {
                if (event.stage > 0) return
                val spoken = text.imminentText(event.action)
                statusText = spoken
                if (!outputSuppressed) announce(spoken)
            }
            is GuideEvent.FarNotice -> Unit // walk 프로파일은 내지 않는다(farNoticeM = null)
            is GuideEvent.Periodic -> {
                val spoken = text.periodicWalk(route, event.stepIndex, event.remainingMeters, event.accuracy, destinationLabel, liveSteps.getOrNull(event.stepIndex)?.target)
                lastGuidance = spoken
                mutate { copy(statusText = spoken, statusIsNextPreview = true) }
                announce(spoken)
            }
            GuideEvent.WaypointReached -> {
                val reached = waypoint ?: return
                waypoint = null
                waypointPassedInSession = true
                syncStartRequestWithSession()
                clearProposal()
                resetAlternativePreview()   // 프리뷰는 경유지를 담은 경로 기준이었다(iOS 동형)
                abandonReroute()
                playTone(BeaconTone.nearby)
                // 도착 문장은 다음 목표(목적지)까지 말한다(N4 spec §3). 지나간 사실이라 억제 해제 뒤에 갚아도 참이다.
                val spoken = strings.get("directions.viaArrivedContinue", reached.label, destinationWithDirectionParticle(destinationLabel))
                statusText = spoken
                if (outputSuppressed) pendingRecovery = spoken else announce(spoken)
            }
            is GuideEvent.WaypointApproaching -> {
                // 경유지 접근 예고(N4 spec §4.1): 1회, 톤 없음. 실행 안내가 아니라 `lastGuidance`는 덮지 않고, `statusText`에도
                // 두지 않는다(남은 거리 행이 같은 정보를 실시간으로 보이고, 전경 복귀 상환이 낡은 거리를 읽게 된다). 억제 중이면
                // 보관하지 않는다 — 거리 문장은 시간이 지나면 거짓(주기 통지와 같은 취급).
                val label = routeWaypointLabel ?: return
                if (!outputSuppressed) announce(strings.get("directions.viaRemaining", label, formatDistance(event.remainingMeters)))
            }
            GuideEvent.FinalApproachEnter -> Unit // fix를 쥔 handleDetail이 가른다
            GuideEvent.OffRoute -> {
                val isEpisodeStart = !offRoute
                offRoute = true
                val spoken = strings.get("guide.offRoute")
                statusText = spoken
                announce(spoken)
                if (isEpisodeStart) maybeFetchProposal()
            }
            GuideEvent.BackOnRoute -> {
                offRouteEndedByReroute = false
                offRoute = false
                clearProposal()
                val spoken = strings.get("guide.backOnRoute")
                statusText = spoken
                resultHaptic(ResultHapticKind.success)
                announce(spoken)
            }
            GuideEvent.UncertainEnter -> { statusText = strings.get("guide.uncertain"); announce(statusText) }
            GuideEvent.UncertainExit, GuideEvent.Reacquired -> { statusText = strings.get("guide.uncertainRecovered"); announce(statusText) }
            GuideEvent.Reacquiring -> { statusText = strings.get("guide.reacquiring"); announce(statusText) }
            GuideEvent.SpeedSuggest -> Unit
        }
    }

    /** 실행 안내 — 상태 행은 비운다(직전 예고를 남기면 이미 돈 회전을 남은 것처럼 읽는다). 억제 중이면 최신 1개 보관. */
    private fun announceUnit(route: GuideRoute, indices: List<Int>) {
        val spoken = text.unit(route, indices)
        lastGuidance = spoken
        statusText = ""
        if (outputSuppressed) pendingRecovery = spoken else announce(spoken)
    }

    // ─────────────────────────── 최종 접근·도착 ───────────────────────────

    private fun resetArrivalWindow() {
        briefWindowActive = false
        arrivalWindowEnteredAt = null
        progressAnchor = null
        lastProgressAt = null
        lastUsableDistanceToDest = null
    }

    private fun resetFinalApproach(geometry: FinalApproachPayload?) {
        inFinalApproach = false
        finalApproachGeometry = geometry
        finalApproachIntroSpoken = false
        pendingFinalApproachIntro = null
        lastFinalTickAt = null
        resetArrivalWindow()
    }

    /** 진입 처리 — 플래그와 거리 축만 바꾸고 **말하지 않는다**. 첫 발화는 같은 fix의 `handleFinalApproach`. */
    private fun beginFinalApproach() {
        clearProposal()
        resetAlternativePreview()   // 문 앞에서 다른 줄로 전환하면 최종 접근이 풀린다(iOS 동형)
        abandonReroute()            // 이미 떠난 전환(낡음 폴백)·재조회가 진입 뒤 커밋되면 같은 이유로 최종 접근이 풀린다
        remainingText = null
        clearLiveRows()
        rebaseForAxisChange()
        val usable = finalApproachGeometry?.takeIf { it.unavailableReason != BearingUnavailable.tooClose }
        if (usable == null) {
            GuideDiag.log("briefHandoff reason=${if (finalApproachGeometry == null) "noGeometry" else "tooClose"}")
            resetArrivalWindow()
            mode = GuideMode.brief
            syncOverview()
            val spoken = strings.get("guide.handoff")
            statusText = spoken
            announce(spoken)
            return
        }
        finalApproachGeometry = usable
        inFinalApproach = true
        finalApproachIntroSpoken = false
        lastFinalTickAt = null
        resetArrivalWindow()
        arrivalWindowEnteredAt = clock()
        val c = lastFixCoord
        val d = dest
        if (c != null && d != null) lastUsableDistanceToDest = haversineMeters(c.lat, c.lng, d.lat, d.lng)
        syncOverview()
        GuideDiag.log { "finalEnter offset=${"%.1f".format(usable.offsetMeters)}" }
    }

    private fun handleFinalApproach(fix: GuideFixPayload, motion: MotionState, age: Double, now: Double) {
        val dest = dest ?: return
        if (!isUsableFix(fix.accuracy, age)) { routeTone(ToneLayerInput(unreliable = true), now); return }
        lastFixAt = now
        lastStaleNoticeAt = null
        lastFixCoord = RoutePoint(fix.lat, fix.lng)
        lastFixCoordAt = now
        noteSessionProgress(fix.lat, fix.lng, now)
        val distance = haversineMeters(fix.lat, fix.lng, dest.lat, dest.lng)
        lastUsableDistanceToDest = distance
        updateBandDistance(distance.roundToInt())
        val anchorStep = advanceProgressAnchor(progressAnchor, RoutePoint(fix.lat, fix.lng))
        progressAnchor = anchorStep.anchor
        if (anchorStep.progressed) lastProgressAt = now
        val arrived = distance <= finalApproachArriveMeters
        GuideDiag.log { "final t=${"%.1f".format(now)} dist=${"%.1f".format(distance)} acc=${"%.1f".format(fix.accuracy)} arrived=$arrived introSpoken=$finalApproachIntroSpoken" }
        routeTone(
            ToneLayerInput(
                trend = TrendInput(
                    distance = distance, deadBand = max(BeaconConstants.baseDeadBand, fix.accuracy), deadBandFloor = fix.accuracy,
                    motion = motion, closerIntervalSeconds = ToneLayerConstants.walkCloserIntervalSeconds,
                ),
                arrived = arrived,
            ),
            now,
        )
        // 진입 배치 서술이 도착보다 앞이다(리뷰 N2-1).
        val geometry = finalApproachGeometry
        if (!finalApproachIntroSpoken && geometry != null) {
            finalApproachIntroSpoken = true
            lastFinalTickAt = now
            val spoken = text.finalApproachEnter(destinationLabel, geometry, fix.accuracy)
            statusText = spoken
            lastGuidance = spoken
            liveTopText = spoken
            resultHaptic(ResultHapticKind.attention)
            announce(spoken) { pendingFinalApproachIntro = spoken }
            return
        }
        if (arrived) {
            val spoken = strings.get("guide.arrived")
            val sample = steps.liveSample
            playTone(BeaconTone.nearby)
            stop()
            presentEndScreen(dest, SessionEndKind.arrived, spoken, sample)
            statusText = spoken
            lastGuidance = spoken
            liveTopText = spoken
            announce(spoken, highPriority = true)
            return
        }
        if (maybePresumeArrival(now)) return
        val last = lastFinalTickAt
        if (last != null && now - last < finalApproachIntervalSeconds) return
        lastFinalTickAt = now
        val spoken = text.finalApproachTick(distance, liveDirection(fix, dest, motion, age), fix.accuracy)
        statusText = spoken
        lastGuidance = spoken
        liveTopText = spoken
        announce(spoken)
    }

    /** 실시간 상대 방향. 게이트를 통과하지 못하면 null — 소비자는 방향 어절을 통째로 뺀다. `speed` null은 -1.0(Unknown). */
    private fun liveDirection(fix: GuideFixPayload, dest: BeaconDest, motion: MotionState, age: Double): RelativeDirection? {
        val course = courseStep(fix.course, fix.courseAccuracy, fix.speed ?: -1.0, motion, age) as? CourseState.Valid ?: return null
        val toDest = bearingDegrees(fix.lat, fix.lng, dest.lat, dest.lng)
        val relative = (toDest - course.course + 540).mod(360.0) - 180
        return relativeDirection(relative)
    }

    private fun noteSessionProgress(lat: Double, lng: Double, now: Double) {
        val step = advanceProgressAnchor(sessionProgressAnchor, RoutePoint(lat, lng), sessionProgressEpsilonMeters)
        sessionProgressAnchor = step.anchor
        if (step.progressed) sessionLastProgressAt = now
    }

    /** 국면 무관 안전망(A23). 워치독이 유일한 도달 경로. true = 끝냈다. */
    private fun maybeEndIdleSession(now: Double): Boolean {
        if (!isTracking) return false
        val startedAt = startedAt ?: return false
        val fixRef = max(startedAt, lastFixAt ?: startedAt)
        val progressRef = max(startedAt, sessionLastProgressAt ?: startedAt)
        // 무이동 축은 도착 추정이 발동할 수 있는 동안(도착 창 ∧ 마지막 확인 거리 ≤ 거리 캡) 늦게 켠다(`sessionIdleStationaryElapsed`,
        // 나들이 spec §9, iOS 동형) — 그대로면 추정 도착을 선점하고, 끄면 실내 지터가 10m 앵커를 밀어 두 판정 모두 영영 안 끝난다.
        // 두절 축은 그대로.
        val presumedArrivalCanFire = inArrivalWindow &&
            (tuning.presumedArrival?.let { (lastUsableDistanceToDest ?: Double.POSITIVE_INFINITY) <= it.maxDistanceMeters } ?: false)
        val stationary = if (tuning.sessionIdleStationaryAxis) sessionIdleStationaryElapsed(now - progressRef, presumedArrivalCanFire) else null
        val reason = sessionIdleStep(now - fixRef, stationary) ?: return false
        GuideDiag.log("sessionIdleEnd reason=${reason.rawValue}")
        val spoken = strings.get("guide.endedIdle")
        stopLeavingSummary(playStopTone = env.isForeground(), text = spoken)
        statusText = spoken
        lastGuidance = spoken
        liveTopText = spoken
        announce(spoken, highPriority = true)
        return true
    }

    /** 도착 추정(A31) — 국면 게이트는 도착 창. 종은 전경에서만. true = 끝냈다. */
    private fun maybePresumeArrival(now: Double): Boolean {
        if (!isTracking || !inArrivalWindow) return false
        val thresholds = tuning.presumedArrival ?: return false
        val dest = dest ?: return false
        val enteredAt = arrivalWindowEnteredAt ?: return false
        val fixRef = max(enteredAt, lastFixAt ?: enteredAt)
        val progressRef = max(enteredAt, lastProgressAt ?: enteredAt)
        val reason = presumedArrivalStep(true, now - fixRef, now - progressRef, lastUsableDistanceToDest, thresholds) ?: return false
        GuideDiag.log { "presumedArrival reason=${reason.rawValue} dist=${lastUsableDistanceToDest?.let { "%.1f".format(it) } ?: "-"} window=${if (inFinalApproach) "final" else "brief"}" }
        val spoken = strings.get("guide.arrivedPresumed")
        val sample = steps.liveSample
        if (env.isForeground()) playTone(BeaconTone.nearby)
        stop()
        presentEndScreen(dest, SessionEndKind.presumed, spoken, sample)
        statusText = spoken
        lastGuidance = spoken
        liveTopText = spoken
        announce(spoken, highPriority = true)
        return true
    }

    /** 거리 축 전환(경로 잔여 ⇄ 직선거리)의 재기준화 — 앵커·마지막 발화 거리를 새 축 현재값으로. */
    private fun rebaseForAxisChange() {
        beaconState = rebaseBeaconState(beaconState, freshStraightLineMeters())
        gateState = BeaconGateState.initial
        toneState = toneState.copy(needsRebase = true)
    }

    private fun freshStraightLineMeters(): Double? {
        val c = lastFixCoord ?: return null
        val at = lastFixCoordAt ?: return null
        val d = dest ?: return null
        if (clock() - at > freshFixSeconds) return null
        return haversineMeters(c.lat, c.lng, d.lat, d.lng)
    }

    // ─────────────────────────── 시트 컨트롤 ───────────────────────────

    fun progressText(): String {
        val route = guideRoute
        val state = guideState
        if (mode == GuideMode.detail && route != null && state != null) {
            val straight = if (state.phase == GuidePhase.offRoute || state.phase == GuidePhase.finalApproach) freshStraightLineMeters() else null
            return text.progress(route, state, destinationLabel, lastGuidance, straight, etaMinutesNow(route, state))
        }
        freshStraightLineMeters()?.let { return strings.get("beacon.first", formatDistance(it.roundToInt())) }
        return lastGuidance ?: strings.get("guide.noGuidanceYet")
    }

    /** 간략 세션의 진행 상황 발화(시트 버튼 응답 — 상세는 조망 페이지가 대신한다). 비-SR 사용자에게도 보이게 상태 행에 둔다. */
    fun announceProgress() {
        val spoken = progressText()
        statusText = spoken
        announce(spoken, highPriority = true)
    }

    /** 이탈 중 수동 재조회 — 자동 재조회가 채택하지 못했을 때의 예비 출구. 진행 중 자동 조회는 폐기(토큰 증가). */
    fun requestReroute() {
        if (!isTracking || mode != GuideMode.detail || !offRoute || rerouteInFlight) return
        clearProposal()
        rerouteInFlight = true
        isRerouting = true
        rerouteToken += 1
        val token = rerouteToken
        scope.launch { performReroute(token) }
    }

    /** 재조회 origin = 모델 최신 수용 fix(15초 이내, §6-2). 없으면 재조회 실패 문장. */
    private fun rerouteOrigin(): RoutePoint? {
        val c = lastFixCoord ?: return null
        val at = lastFixCoordAt ?: return null
        return if (clock() - at <= freshFixSeconds) c else null
    }

    /**
     * 재조회(`switchTo == null` — 세션 축 유지) 또는 수동 전환(`switchTo` — 다른 줄, M4b). 전환은 fetch 성공 커밋 전까지 세션 축을 건드리지 않는다
     * (실패하면 기존 경로·기존 축 유지 — 라벨·다음 전환 방향이 실제 경로와 어긋나지 않게, iOS `performReroute(intent:)` 동형).
     */
    private suspend fun performReroute(token: Int, switchTo: WalkLineKind? = null) {
        try {
            val dest = dest ?: return
            val origin = rerouteOrigin()
            if (origin == null) { rerouteFailed(); return }
            val waypointAtFetch = waypoint
            val fetched = runCatching {
                fetchDetailData(origin, dest, switchTo?.variant ?: sessionVariant, switchTo?.isAccessible ?: accessible, waypointAtFetch)
            }
            if (token != rerouteToken || !isTracking || mode != GuideMode.detail || this.dest != dest || this.waypoint != waypointAtFetch) return
            val result = fetched.getOrNull()
            if (result == null) { rerouteFailed(); return }
            // 전환 커밋: 경로 교체와 같은 원자 블록에서만 세션 축·줄 종류가 바뀐다.
            if (switchTo != null) commitLineSwitch(switchTo)
            val firstIndices = commitReroutedRoute(result)
            val notice = consumeStepFreeNotice(result.stepFreeRaw, result.stepFree, result.stepFreeNotice)
            val summary = if (switchTo != null) text.variantSwitch(result.route, firstIndices, result.lineKind ?: switchTo) else text.reroute(result.route, firstIndices)
            val spoken = if (notice != null) "$notice $summary" else summary
            statusText = spoken
            resultHaptic(ResultHapticKind.success)
            announce(spoken, highPriority = true) { if (notice != null) pendingStepFreeNotice = notice }
            if (switchTo != null) mutate { copy(variantAdoptedSeq = variantAdoptedSeq + 1) }
        } finally {
            if (token == rerouteToken) { rerouteInFlight = false; isRerouting = false; isSwitchingVariant = false }
        }
    }

    private fun rerouteFailed() {
        lastStepFree = null
        statusText = strings.get("guide.rerouteFailed")
        resultHaptic(ResultHapticKind.failure)
        announce(statusText, highPriority = true)
    }

    /** 재조회·자동 채택 공통의 성공 커밋 — 경로·기준선·이탈 표결·finalApproach·표시 유닛을 한 지점에서 원자 교체. */
    private fun commitReroutedRoute(fetched: DetailFetchResult): List<Int> {
        clearProposal()
        resetAlternativePreview()   // 경로 교체는 프리뷰 비교 기준(잔여·대안)도 무효화한다(iOS spec 2026-08-14 §3)
        guideRoute = fetched.route
        routeWaypointLabel = if (fetched.route.waypointStepIndex == null) null else waypoint?.label
        guideRouteDurationSeconds = fetched.durationSeconds
        resetFinalApproach(fetched.finalApproach)
        val initial = initialGuideState(
            fetched.route, clock(), hasFinalApproachGeometry = fetched.finalApproach != null,
            courseDerivation = guideState?.courseDerivation ?: initialDerivationState,
        )
        guideState = initial.state
        offRouteEndedByReroute = true
        offRoute = false
        updateRemaining(fetched.route, initial.state)
        displayUnits = buildDisplayUnits(fetched.liveSteps)
        liveSteps = fetched.liveSteps
        resetLiveRowsBaseline(initial.state)
        syncOverview()
        lastGuidance = text.unit(fetched.route, initial.firstIndices)
        return initial.firstIndices
    }

    /** 이탈 확정 회차의 자동 조회 트리거(E10ⓑ) — 상세 ∧ 최종 접근 전 ∧ 세션 상한 미달. */
    private fun maybeFetchProposal() {
        if (!isTracking || mode != GuideMode.detail || inFinalApproach || rerouteInFlight) return
        if (!RerouteProposalGate.mayFetch(proposalFetchCount)) return
        proposalToken += 1
        proposalFetchCount += 1
        val token = proposalToken
        scope.launch { fetchProposal(token) }
    }

    private suspend fun fetchProposal(token: Int) {
        val dest = dest ?: return
        val origin = rerouteOrigin() ?: return
        val acquiredAt = clock()
        if (token != proposalToken || !offRoute || !isTracking || mode != GuideMode.detail || this.dest != dest) return
        val waypointAtFetch = waypoint
        val result = runCatching { fetchDetailData(origin, dest, sessionVariant, accessible, waypointAtFetch) }.getOrNull() ?: return
        if (token != proposalToken || !offRoute || !isTracking || mode != GuideMode.detail || rerouteInFlight || this.dest != dest || this.waypoint != waypointAtFetch) return
        val proposal = RerouteProposal(originLat = origin.lat, originLng = origin.lng, acquiredAt = acquiredAt)
        val c = lastFixCoord ?: return
        val at = lastFixCoordAt ?: return
        if (clock() - at > freshFixSeconds) return
        if (!RerouteProposalGate.isFresh(proposal, clock(), c.lat, c.lng)) return
        val firstIndices = commitReroutedRoute(result)
        val notice = consumeStepFreeNotice(result.stepFreeRaw, result.stepFree, result.stepFreeNotice)
        val summary = text.autoReroute(result.route, firstIndices)
        val spoken = if (notice != null) "$notice $summary" else summary
        statusText = spoken
        resultHaptic(ResultHapticKind.success)
        announce(spoken, highPriority = true) { if (notice != null) pendingStepFreeNotice = notice }
    }

    private fun clearProposal() { proposalToken += 1 }

    // ─────────────────────────── 안내 중 변경(M4b, spec 2026-09-27) ───────────────────────────

    /**
     * 경로 재획득(iOS `reacquireRoute`, `stop()`의 부분집합) — 세션(서비스·톤·스트림·워치독·토큰)은 유지하고 경로·목적지 종속 상태만 내려놓는다.
     * 호출부가 이어서 `awaitingRoute = true` + `startFixWaitWatch`로 시작과 같은 기계를 태운다(다음 수용 fix가 `fetchGuideRoute` — 조회 왕복 동안
     * 옛 경로의 회전·도착 신호가 나갈 창이 구조적으로 없다). 승계: 도플러(`motionState`)·유도기 버퍼·자동 조회 회차(세션당).
     */
    private fun reacquireRoute() {
        // 톤 뒤로 미뤄진 옛 경로 문장의 복원 콜백(계단 경고 장부)이 새 목적지 세션에 되살아나지 않게 — 복원이 먼저 일어나고 아래 소거가 이긴다.
        deferredAnnouncer.invalidatePending()
        routeFetchJob?.cancel(); routeFetchJob = null
        fixWaitJob?.cancel(); fixWaitJob = null
        routeOriginBest = null; routeOriginBestAt = null   // 옛 목적지의 최선값이 새 origin으로 새지 않게
        abandonReroute()
        routeFetchToken += 1
        offRoute = false
        clearProposal()
        resetAlternativePreview()
        guideState?.courseDerivation?.let { carriedCourseDerivation = it }   // 진입마다 덮어쓴다. 재획득 대기 중 다시 바꾸면 guideState가 null — 앞선 버퍼 유지
        guideRoute = null
        guideRouteDurationSeconds = null
        guideState = null
        routeWaypointLabel = null
        lastGuidance = null
        remainingText = null
        bandDistanceMeters = null
        shownWaypointMeters = null
        clearLiveRows()
        displayUnits = emptyList()
        liveSteps = emptyList()
        liveBaselineD = 0.0
        pendingRecovery = null
        pendingStepFreeNotice = null
        lastStepFree = null
        resetFinalApproach(null)
        mode = GuideMode.brief
        statusText = ""
        beaconState = BeaconState.initial     // 목적지 종속 추세(간략 접근·톤 계층) — 도플러는 위치 종속이라 승계
        gateState = BeaconGateState.initial
        toneState = ToneLayerState.initial
        syncOverview()
    }

    /** 경유지 추가·변경 진입점 노출(iOS `waypointAvailable`) — 추적 중 ∧ ko(상세 조회 경유지는 ko 기능으로 출하됐다). 삭제·변경은 경유지가 있을 때만(화면 몫). */
    fun waypointAvailable(): Boolean = isTracking && dataLocale() == DataLocale.ko

    /**
     * 진행 중 재조회·전환을 버린다(토큰 증가 + 표식 해제 한 자리). ⚠ 토큰이 바뀌면 옛 조회의 `finally`는 표식을 풀지 않는다(토큰 일치 때만) — 여기서 함께
     * 풀지 않으면 그 세션은 끝까지 재조회·자동 재조회·채택이 막힌다(리뷰 MAJOR). 경로 재획득·경유지 도착·최종 접근 진입이 부른다.
     */
    private fun abandonReroute() {
        rerouteToken += 1
        rerouteInFlight = false
        isRerouting = false
        isSwitchingVariant = false
    }

    /** 재획득 뒤 경로 대기 — 시작과 같은 기계(§2.2). */
    private fun awaitNewRoute() {
        awaitingRoute = true
        startFixWaitWatch(routeFetchToken)
    }

    /**
     * 목적지 전환(iOS `changeDestination`, spec 2026-08-12 §3.1). false = 세션이 이미 죽어 선택을 폐기(호출부는 폼도 건드리지 않는다). 같은 좌표면
     * 라벨만 갱신하고 확인 통지(재조회 없음). 통지는 활성화의 직접 응답이라 즉시·high·억제 우회.
     */
    fun changeDestination(dest: BeaconDest, label: String): Boolean {
        if (!isTracking) return false
        if (this.dest == dest) {
            destinationLabel = label
            syncStartRequestWithSession()
            announceNow(strings.get("android.guide.destChanged", label), highPriority = true, bypassSuppression = true)
            return true
        }
        this.dest = dest
        destinationLabel = label
        waypointPassedInSession = false   // 새 목적지는 새 여정 — 지난 경유지의 "목적지 {dest}까지" 행 유지를 잇지 않는다(n4 인계 1)
        syncStartRequestWithSession()
        reacquireRoute()
        announceNow(strings.get("android.guide.destChanged", label) + " " + strings.get("android.guide.destChangedFetching"), highPriority = true, bypassSuppression = true)
        awaitNewRoute()
        return true
    }

    /** 경유지 추가·변경(iOS `setWaypoint`, N4 §4.2). 같은 좌표 재선택은 라벨만 + "그대로"(일어나지 않는 재조회를 예고하지 않는다). */
    fun setWaypoint(dest: BeaconDest, label: String): Boolean {
        if (!isTracking) return false
        val next = GuideWaypoint(dest, label)
        if (waypoint?.dest == dest) {
            waypoint = next
            syncStartRequestWithSession()
            announceNow(strings.get("android.guide.waypointKept", label), highPriority = true, bypassSuppression = true)
            return true
        }
        waypoint = next
        syncStartRequestWithSession()
        reacquireRoute()
        announceNow(strings.get("android.guide.waypointSet", label), highPriority = true, bypassSuppression = true)
        awaitNewRoute()
        return true
    }

    /** 경유지 삭제(iOS `removeWaypoint`, K2 §6.5) — 경유지만 비우고 출발→도착으로 다시 조회. 폼의 경유지는 사용자 질의라 건드리지 않는다. */
    fun removeWaypoint(): Boolean {
        if (!isTracking) return false
        val removed = waypoint ?: return false
        waypoint = null
        syncStartRequestWithSession()
        reacquireRoute()
        announceNow(strings.get("android.guide.waypointRemoved", removed.label), highPriority = true, bypassSuppression = true)
        awaitNewRoute()
        return true
    }

    /** 전환 커밋(E42): 요청 축과 두 줄 종류를 한 원자 블록에서 맞바꾼다 — 헤더 라벨·프리뷰·채택·폴백이 같은 판정을 공유한다(iOS 동형). */
    private fun commitLineSwitch(target: WalkLineKind) {
        sessionVariant = target.variant
        accessible = target.isAccessible
        alternateLine = sessionLine
        sessionLine = target
        syncStartRequestWithSession()   // 전환 뒤 복구 재시작은 전환된 줄로(A13)
    }

    /**
     * 수동 전환 — 현위치 기준으로 다른 줄 재조회(iOS `requestVariantSwitch`). 안드로이드엔 버튼이 없다(iOS도 상시 전환 버튼 폐기) — 프리뷰 채택의 낡음
     * 폴백 전용이다. 진행 중 자동 조회는 폐기한다(두 커밋이 잇달아 나가지 않게). busy 신호는 `isSwitchingVariant`(재조회 버튼과 분리).
     */
    private fun requestVariantSwitch() {
        if (!isTracking || mode != GuideMode.detail || rerouteInFlight) return
        val target = alternateLine ?: return
        clearProposal()
        rerouteInFlight = true
        isSwitchingVariant = true
        rerouteToken += 1
        val token = rerouteToken
        scope.launch { performReroute(token, switchTo = target) }
    }

    /** 대안 프리뷰 열림 — 최신 세션 fix 기준으로 다른 줄을 조회한다(출발 전 받아 둔 대안은 출발점이 낡았다). */
    fun openAlternativePreview() {
        if (!_ui.value.alternativePreviewAvailable || !isTracking) return
        val target = alternateLine ?: return
        val dest = dest ?: return
        altPreviewToken += 1
        val token = altPreviewToken
        altPreviewState = AltPreviewState.Fetching
        scope.launch { fetchAlternativePreview(token, dest, target) }
    }

    /** 프리뷰 닫힘 — 진행 중 조회의 도착 응답을 폐기한다(latest-wins). */
    fun closeAlternativePreview() = resetAlternativePreview()

    private fun resetAlternativePreview() {
        altPreviewToken += 1
        if (altPreviewState != AltPreviewState.Idle) altPreviewState = AltPreviewState.Idle
    }

    /**
     * origin은 모델 최신 수용 fix(15초 이내) — iOS는 새로 재지만 안드로이드 모델은 스트림 fix만 보고 재조회도 같은 origin을 쓴다(spec §2.4). 신선도
     * 기준값(`acquiredAt`)은 좌표와 한 쌍(fetch 완료 시각을 쓰면 왕복만큼 신선하게 오판된다).
     */
    private suspend fun fetchAlternativePreview(token: Int, dest: BeaconDest, target: WalkLineKind) {
        val origin = rerouteOrigin()
        val acquiredAt = lastFixCoordAt ?: clock()
        if (origin == null) { failAlternativePreview(token); return }
        val waypointAtFetch = waypoint
        val fetched = try {
            fetchDetailData(origin, dest, target.variant, target.isAccessible, waypointAtFetch)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            failAlternativePreview(token); return
        }
        if (token != altPreviewToken || !isTracking || mode != GuideMode.detail || this.dest != dest || this.waypoint != waypointAtFetch) return
        if (fetched == null) {
            altPreviewState = AltPreviewState.NoRoute
            announce(strings.get("android.guide.altPreviewNone"))
            return
        }
        altPreviewState = AltPreviewState.Ready(RerouteProposal(originLat = origin.lat, originLng = origin.lng, acquiredAt = acquiredAt), fetched)
        // 완료 신호 polite 1회 — 헤더는 조용히 갱신되므로 이 통지가 없으면 결과 도착을 알 길이 없다.
        announce(altPreviewHeaderText())
    }

    private fun failAlternativePreview(token: Int) {
        if (token != altPreviewToken) return
        altPreviewState = AltPreviewState.Failed
        announce(strings.get("android.guide.altPreviewFailed"))
    }

    /**
     * 프리뷰 헤더 문장(iOS `alternativePreviewHeaderText`). 준비 = 줄 이름·총거리, 소요, 지금 경로 잔여(이탈 중엔 거짓이라 생략), 서버가 줄 이름을
     * 주지 못한 응답이면 계단 경고 문장(착지 첫 문장에 경고가 없으면 계단 사실이 단계 원문을 훑어야만 드러난다).
     */
    fun altPreviewHeaderText(): String = when (val st = altPreviewState) {
        AltPreviewState.Idle, AltPreviewState.Fetching -> strings.get("android.guide.altPreviewLoading")
        AltPreviewState.NoRoute -> strings.get("android.guide.altPreviewNone")
        AltPreviewState.Failed -> strings.get("android.guide.altPreviewFailed")
        is AltPreviewState.Ready -> {
            val fetched = st.fetched
            val name = (fetched.lineKind ?: alternateLine)?.let { strings.get(walkLineNameKey(it)) } ?: ""
            val summary = strings.get("android.guide.altPreviewSummary", name, formatDistance(fetched.route.totalMeters.roundToInt()))
            val time = fetched.durationSeconds?.takeIf { it > 0 }?.let { strings.get("android.guide.altPreviewTime", max(1, it / 60).toString()) }
            val route = guideRoute
            val state = guideState
            val remaining = if (!offRoute && route != null && state != null) strings.get("android.guide.altPreviewRemaining", formatDistance(max(0.0, route.totalMeters - state.d).roundToInt())) else null
            val notice = if (fetched.lineKind == null) fetched.stepFreeNotice else null
            joinText(summary, time, remaining, notice)
        }
    }

    /**
     * 프리뷰 채택(iOS `adoptAlternativePreview`, spec 2026-08-14 §4): 신선하면 본 경로를 즉시 채택("본 것 = 안내받는 것"), 낡았으면 같은 줄로 현위치
     * 재조회에 폴백(프리뷰는 열린 채 — 실패 시 사용자가 상태를 본다). 성공은 `variantAdoptedSeq`가 알린다.
     */
    fun adoptAlternativePreview() {
        val ready = altPreviewState as? AltPreviewState.Ready ?: return
        if (rerouteInFlight || !isTracking || inFinalApproach) return   // 방어 2선 — 리셋 누락이 재발해도 도착 직전 전환은 막는다
        val target = alternateLine ?: return
        val c = lastFixCoord
        val at = lastFixCoordAt
        if (c != null && at != null && clock() - at <= freshFixSeconds && RerouteProposalGate.isFresh(ready.proposal, clock(), c.lat, c.lng)) {
            commitLineSwitch(target)
            val firstIndices = commitReroutedRoute(ready.fetched)
            val notice = consumeStepFreeNotice(ready.fetched.stepFreeRaw, ready.fetched.stepFree, ready.fetched.stepFreeNotice)
            val summary = text.variantSwitch(ready.fetched.route, firstIndices, ready.fetched.lineKind ?: target)
            val spoken = if (notice != null) "$notice $summary" else summary
            statusText = spoken
            resultHaptic(ResultHapticKind.success)   // 폴백(재조회) 경로의 성공과 같은 신호 — 같은 사건을 두 경로가 다르게 알리지 않는다
            announce(spoken, highPriority = true) { if (notice != null) pendingStepFreeNotice = notice }
            mutate { copy(variantAdoptedSeq = variantAdoptedSeq + 1) }
            return
        }
        requestVariantSwitch()
    }

    /** 대안 프리뷰 상태(iOS `AlternativePreviewState`) — "대안 없음"(`NoRoute`)과 "조회 실패"(`Failed`)를 가른다(3-state). */
    private sealed class AltPreviewState {
        data object Idle : AltPreviewState()
        data object Fetching : AltPreviewState()
        class Ready(val proposal: RerouteProposal, val fetched: DetailFetchResult) : AltPreviewState()
        data object NoRoute : AltPreviewState()
        data object Failed : AltPreviewState()
    }

    // ─────────────────────────── 워치독 ───────────────────────────

    private fun startWatchdog() {
        watchdogJob?.cancel()
        watchdogJob = scope.launch {
            while (isActive) {
                delay(watchdogIntervalMs)
                if (!isTracking) continue
                tickWatchdog()
            }
        }
    }

    /** 타이머 구동이지 fix 구동이 아니다 — fix가 안 와도 돈다는 것이 요점(권한 철회·제공자 정지의 영구 침묵 차단). */
    private fun tickWatchdog() {
        val now = clock()
        val reference = lastFixAt ?: startedAt ?: now
        GuideDiag.log { "watchdog dt=${"%.1f".format(now - reference)}" }
        if (now - reference >= noFixToneSeconds) routeTone(ToneLayerInput(unreliable = true, arrived = arrivedNow), now)
        if (maybePresumeArrival(now)) return
        if (maybeEndIdleSession(now)) return
        noticeStaleIfNeeded()
    }

    private fun noticeStaleIfNeeded() {
        if (awaitingRoute) return
        val now = clock()
        val reference = lastFixAt ?: startedAt ?: now
        if (now - reference < noFixTimeoutSeconds) return
        lastStaleNoticeAt?.let { if (now - it < staleRenotifySeconds) return }
        lastStaleNoticeAt = now
        statusText = strings.get("beacon.weak")
        announce(statusText)
    }

    // ─────────────────────────── 출력 (§5) ───────────────────────────

    /** 결과 진동 창구 — 억제 중이면 진동도 내지 않는다("문장이 나가는 조건 = 진동이 나가는 조건"). */
    private fun resultHaptic(kind: ResultHapticKind) {
        if (outputSuppressed) return
        haptics.result(kind)
    }

    private fun playTone(tone: BeaconTone) {
        if (outputSuppressed) return
        tones.play(tone)
        checkMediaVolume()
        // 무음 진입 1회(iOS 동형) + 포커스 거절 지속(안드로이드 축, §5-1).
        val silenced = tones.isSilenced
        mutate { copy(isSilenced = silenced) }
        if (silenced) {
            // 무음 진입 **1회** 래치(진동·문장 둘 다) — 문자열 비교로 가르면 거리 통지가 상태 행을 덮을 때마다 재발화한다.
            if (!silencedNoticed) {
                silencedNoticed = true
                resultHaptic(ResultHapticKind.failure)
                val spoken = strings.get("android.beacon.soundUnavailable")
                statusText = spoken
                announce(spoken)
            }
        } else {
            silencedNoticed = false
        }
        val denied = tones.focusDenied
        mutate { copy(focusDenied = denied) }
        if (denied && !focusDeniedNoticed) {
            focusDeniedNoticed = true
            pendingFocusDenied = true
            resultHaptic(ResultHapticKind.failure)
        } else if (!denied) {
            focusDeniedNoticed = false
        }
    }

    /** 미디어 볼륨 0 판정(세션 시작·매 재생) — 상시 행 + 문장 1회. */
    private fun checkMediaVolume() {
        val zero = isTracking && tones.isMediaVolumeZero
        soundDegraded = zero
        if (zero && !mediaVolumeNoticed) {
            mediaVolumeNoticed = true
            resultHaptic(ResultHapticKind.attention)
            announce(strings.get("android.guide.mediaVolumeZero"))
        } else if (!zero) {
            mediaVolumeNoticed = false
        }
    }

    private fun announce(message: String, highPriority: Boolean = false, onDropped: (() -> Unit)? = null) =
        deferredAnnouncer.announce(message, highPriority, onDropped)

    /** 사용자 활성화의 직접 응답 전용 즉시 창구. */
    fun announceNow(message: String, highPriority: Boolean = false, bypassSuppression: Boolean = false) =
        deferredAnnouncer.announceNow(message, highPriority, bypassSuppression)

    /**
     * 안내가 낸 문장이 모두 끝났는가(E57 spec §3.3) — 톤 뒤로 미룬 문장이 없고 안내 TTS가 말하고 있지 않다. 안내 시트의 첫 정보 행 착지가 이것을
     * 기다린다(착지 낭독이 시작 요약·복귀 상환과 겹치지 않게). 안드로이드는 안내 문장이 TTS 한 채널이라 끝을 발화 완료 콜백으로 직접 안다 — iOS의 게시
     * 장부(`GuideAnnouncementLedger`)가 필요 없다. 앱의 다른 통지(탭 상태 줄)는 세지 않는다.
     */
    fun announcementsSettled(): Boolean = !deferredAnnouncer.hasPending && !speaker.isSpeaking

    private fun isSpeechAllowed(): Boolean = env.isForeground() || !env.isInteractive()

    /** 실제 게시 — 억제 가드 → 음성 게이트 → `missedAnnouncement` → 게시. 발화 포트 호출은 이 모델에서 여기 한 곳(소스 가드 ④). */
    private fun post(message: String, highPriority: Boolean, bypassSuppression: Boolean): Boolean {
        if (!bypassSuppression && outputSuppressed) return false
        if (!isSpeechAllowed()) { missedAnnouncement = true; return false }
        var spoken = spokenDistanceUnits(message, strings.get("android.unit.spokenMeters"))
        val owesFocusDenied = pendingFocusDenied && !tones.focusDenied
        if (owesFocusDenied) {
            pendingFocusDenied = false
            spoken = strings.get("android.guide.focusDenied") + " " + spoken
        }
        val ok = speaker.speak(spoken, highPriority)
        syncTtsUnavailable()
        if (!ok) {
            // 장부 복원 — "지우고, 못 내면 되돌린다"(다른 장부와 같은 계약).
            if (owesFocusDenied) pendingFocusDenied = true
            missedAnnouncement = true
            return false
        }
        return true
    }

    /** TTS 초기화 전에 보류된 문장이 초기화 실패·언어 미지원으로 버려졌다 — 전경 복귀 상환이 현재 상태를 다시 낸다. */
    fun onSpeechDropped() { missedAnnouncement = true; syncTtsUnavailable() }

    private fun syncTtsUnavailable() {
        val unavailable = speaker.isUnavailable
        if (_ui.value.ttsUnavailable != unavailable) mutate { copy(ttsUnavailable = unavailable) }
        if (unavailable && !ttsUnavailableNoticed) { ttsUnavailableNoticed = true; resultHaptic(ResultHapticKind.failure) }
        if (!unavailable) ttsUnavailableNoticed = false
    }

    private companion object {
        /** 상세 모드 추세 축 데드밴드(m) — 지터 방어가 아니라 빈도 노브(위원장 실보행 판정 6m). */
        const val detailDeadBand = 6.0
        const val detailDeadBandFloor = 5.0
        const val noFixToneSeconds = 8.0
        const val noFixTimeoutSeconds = 15.0
        const val staleRenotifySeconds = 30.0
        const val watchdogIntervalMs = 2_000L
        /** 재조회 origin·직선거리 단정의 fix 신선도 상한(웹 PROGRESS_FIX_MAX_AGE_S 미러). */
        const val freshFixSeconds = 15.0
        const val queryTimeoutMs = 15_000L
    }
}

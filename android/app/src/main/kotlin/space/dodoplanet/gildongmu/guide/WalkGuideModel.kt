package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
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
import space.dodoplanet.gildongmu.kit.BackgroundSpeech
import space.dodoplanet.gildongmu.kit.DeferredAnnouncer
import space.dodoplanet.gildongmu.kit.DeviceSpeechDrop
import space.dodoplanet.gildongmu.kit.DeviceSpeechHandover
import space.dodoplanet.gildongmu.kit.DeviceSpeechQueue
import space.dodoplanet.gildongmu.kit.GuideSpeechChannel
import space.dodoplanet.gildongmu.kit.GuideSpeechClass
import space.dodoplanet.gildongmu.kit.beaconNoticeSpeechClass
import space.dodoplanet.gildongmu.kit.guideEventSpeechClass
import space.dodoplanet.gildongmu.kit.OffRouteNotice
import space.dodoplanet.gildongmu.kit.guideSpeechChannel
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
import space.dodoplanet.gildongmu.kit.LiveTopRow
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
import space.dodoplanet.gildongmu.kit.clockHour
import space.dodoplanet.gildongmu.kit.courseAxisVerdict
import space.dodoplanet.gildongmu.kit.courseStep
import space.dodoplanet.gildongmu.kit.walkFinalApproachArrived
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
import space.dodoplanet.gildongmu.kit.projectionLagMeters
import space.dodoplanet.gildongmu.kit.rebaseBeaconState
import space.dodoplanet.gildongmu.kit.relativeDirection
import space.dodoplanet.gildongmu.kit.rerouteHeadClock
import space.dodoplanet.gildongmu.kit.routeOriginStep
import space.dodoplanet.gildongmu.kit.ExitHoldDecision
import space.dodoplanet.gildongmu.kit.ExitHoldIdleFloors
import space.dodoplanet.gildongmu.kit.ExitHoldSample
import space.dodoplanet.gildongmu.kit.TransitLabel
import space.dodoplanet.gildongmu.kit.exitHoldAwareSessionIdleStep
import space.dodoplanet.gildongmu.kit.exitHoldIdleFloorsAfterClose
import space.dodoplanet.gildongmu.kit.exitHoldIdleFloorsAfterFix
import space.dodoplanet.gildongmu.kit.exitHoldRecentWindowSeconds
import space.dodoplanet.gildongmu.kit.exitHoldStep
import space.dodoplanet.gildongmu.kit.exitHoldStorable
import space.dodoplanet.gildongmu.kit.exitHoldStorableRunStart
import space.dodoplanet.gildongmu.kit.exitLeadPrefixNeeded
import space.dodoplanet.gildongmu.kit.transitPrewalkArrivedLine
import space.dodoplanet.gildongmu.kit.sessionProgressEpsilonMeters
import space.dodoplanet.gildongmu.kit.spokenDistanceUnits
import space.dodoplanet.gildongmu.kit.spokenRemainingMeters
import space.dodoplanet.gildongmu.kit.toneLayerStep
import space.dodoplanet.gildongmu.kit.walkTurnApproachMeters
import space.dodoplanet.gildongmu.kit.CarRoadSpan
import space.dodoplanet.gildongmu.kit.KnownCarJam
import space.dodoplanet.gildongmu.kit.newCarJamsAhead
import space.dodoplanet.gildongmu.kit.models.CarJam
import space.dodoplanet.gildongmu.kit.models.CarRouteBriefing
import space.dodoplanet.gildongmu.kit.LocationFixPolicy
import space.dodoplanet.gildongmu.kit.buildCarGuide
import space.dodoplanet.gildongmu.kit.canReuseCachedFix
import space.dodoplanet.gildongmu.kit.carArrivalStep
import space.dodoplanet.gildongmu.kit.roadNameAt
import space.dodoplanet.gildongmu.kit.turnApproachMeters
import space.dodoplanet.gildongmu.kit.unitAt
import space.dodoplanet.gildongmu.location.LocationPermission
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * 도보·자동차 실시간 안내 오케스트레이터(iOS `BeaconModel` 미러 — 도보 spec 2026-09-16-android-m4 §3·§6, 자동차 M5 spec
 * 2026-11-20 §2-1·§4). 자동차는 같은 모델의 `sessionKind = car` 세션이다: 임계는 `GuideTuning` 데이터, 문장·조회 대상이 갈리는 행동은
 * iOS `sessionKind == .car` 분기를 같은 자리·같은 조건으로 옮긴다. 이름은 병렬 rebase 충돌을 피하려고 그대로 둔다. 판정은 전부
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
) : GuideServiceOwner {
    private val text = GuideText(strings)
    /** 수단에서 유도한다(iOS `tuning` getter). 운전자 프로파일(`carDriver`)은 실험판 전용이라 두지 않는다(듣는 사람은 동승자 고정). */
    private val tuning: GuideTuning get() = if (sessionKind == GuideSessionKind.car) GuideTuning.car else GuideTuning.walk

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
    /** E69 래치 — 회차 시작(확정)과 세션 정리에서만 내린다(회차 안에서 버튼이 사라지면 그 버튼에 커서를 둔 사람이 맥락을 잃는다, 헌장 §5). */
    private var rerouteGaveUp: Boolean
        get() = _ui.value.rerouteGaveUp
        set(v) = mutate { copy(rerouteGaveUp = v) }
    /** E69 ⓒ: 벗어난 채 정지 연속 시작 시각(`RerouteProposalGate.stillStep`). */
    private var offRouteStillSince: Double? = null
    /** E69: 이 회차에 실패 문장을 게시해 아직 버려지지 않았다 — 버려지면 다음 ⓐⓑ에서 다시 말한다(1회성 통지는 전달된 시점에 래치, iOS 동형). */
    private var rerouteGaveUpSpoken = false
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
    /** 지금 세션의 수단 — `start`가 점유 뒤 정하고 `stop`이 walk로 되돌린다(종료 뒤 수단은 `arrivalSessionKind`가 든다, iOS 동형). */
    private var sessionKind: GuideSessionKind
        get() = _ui.value.sessionKind
        set(v) { if (_ui.value.sessionKind != v) mutate { copy(sessionKind = v) } }
    /** 자동차 "현재 도로" 행(E56). 같은 값이면 대입하지 않는다 — 커서 위에서 다시 읽히지 않게. */
    private var currentRoadText: String?
        get() = _ui.value.currentRoadText
        set(v) { if (_ui.value.currentRoadText != v) mutate { copy(currentRoadText = v) } }

    val isTracking: Boolean get() = status == GuideStatus.tracking

    // ── 전경 서비스 소유자(M5 §6-4) — 서비스는 매 콜백 시점에 `GuideSession.serviceOwner()`로 이 모델을 고른다 ──

    /** 도보·자동차는 늘 1초·고정밀 스트림이다(서비스가 이 모델을 소유자로 고를 때만 읽는다). */
    override val locationProfile: StateFlow<GuideLocationProfile?> = MutableStateFlow(GuideLocationProfile.beacon)

    /** 지금 쥔 서비스 요청의 세대 — 시작 ⑧에서 받고 `stop()` ⑦에서 놓는다. */
    override var serviceGeneration: Int? = null
        private set

    /** 알림 (제목, 본문) — 추적 중일 때만 낸다(매 fix 갱신 금지는 서비스의 `distinctUntilChanged`). */
    override fun notificationText(strings: Strings): Pair<String, String>? =
        if (!isTracking) null else ui.value.let { notificationTitleText(it, strings) to notificationBodyText(it, strings) }

    override val notificationChanges: Flow<*> get() = ui

    override fun handleServiceFix(fix: GuideFixPayload) = handleFix(fix)

    override fun stopFromNotification() = stopByUser()

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
                // 복구 시점에 실위치가 그 유닛 첫 스텝에 이미 들어섰으면 방향 구절을 뗀 문장으로(E62 — 이미 돈 회전을 다시 지시하지
                // 않는다, iOS 동형). 판정은 리듀서와 같은 실위치(원시 d + lag).
                val entered = pendingRecoveryEntered?.let { alt ->
                    val gs = guideState
                    if (gs != null && gs.d + projectionLagMeters >= alt.startD) alt.text else null
                }
                pendingRecoveryEntered = null
                announce(entered ?: recovery, speechClass = GuideSpeechClass.actionable)   // 보관 대상(예고·경유지 도착)은 전부 행동 문장
                // 자동차: 갚은 실행 안내도 발화다 — 리듀서의 정숙 시간(경유지 접근 예고)이 다음 fix에 이 문장을 끊지 않게 직전 발화 시각으로
                // 적는다(iOS 동형, 전경 복귀 상환도 같다). 도보는 주기 시각 불변이라 적지 않는다.
                if (sessionKind == GuideSessionKind.car) noteRepaidAnnouncement()
            }
        }

    // ── 세션 인자 ──
    private var lastStartRequest: BeaconStartRequest? = null

    // ── 승차 전 도보(prewalk, A25 spec 2026-08-30 §4.2 — iOS `BeaconModel` 같은 절) ──
    /**
     * 승차역 라벨(ko·en 쌍, iOS `prewalkTarget`). null이 아니면 이 도보 세션은 대중교통 안내의 승차 전 구간이다: 종료 화면을 남기지 않고(승차역은 여정의 끝이
     * 아니다), 시트가 「승차역 도착」 선언 자리를 가지며, 잊힌 세션 안전망이 돌지 않는다(지하 진입 = fix 두절이 곧 그 선언이 필요한 순간). `stop()`이 비운다.
     * ⚠ 종료 화면 분기는 `stop()` **뒤**에 도는데 `stop()`이 이 값을 지우므로, 확정·추정·`stopLeavingSummary` 세 경로는 `stop()` 앞에서 지역 변수로 캡처한다.
     */
    private var prewalkTarget: TransitLabel?
        get() = _ui.value.prewalkTarget
        set(v) = mutate { copy(prewalkTarget = v) }
    /** 승차 전 도보 표식이 환승 도보(E73)인가 — 정지 꼬리가 「대중교통 안내도 종료했습니다」, 위치 상실 꼬리가 「도보 안내를 멈추고 승차 대기로 넘어갑니다」다. */
    private var prewalkIsTransfer = false
    /** 승차 전 도보 정지 꼬리(A54·E73). 판정은 표식에서 — 종료 분기는 `stop()` 앞에서 캡처한다. */
    private val prewalkStopTail: PrewalkStopTail?
        get() {
            if (prewalkTarget == null) return null
            return if (prewalkIsTransfer) PrewalkStopTail.transitAlsoEnded else PrewalkStopTail.transitNotStarted
        }
    /** 종료 화면 없이 끝나는 세션인가 — 승차 전 도보(iOS는 여정 단계도, 여정은 `and-journey`가 더한다). */
    private val endsWithoutScreen: Boolean get() = prewalkTarget != null
    /**
     * 세션 종료 1회 콜백(iOS `onSessionEnd`). 발화점은 둘뿐 — `stop()` 정리 완료 뒤 다음 메인 턴, 그리고 `requestStart`의 시작 잡 말미(시작되지 않아
     * `stop()`이 돌지 않는 경로: `startFailed`). 경로마다 부르지 않는다 — 종료 경로가 여럿이라 하나를 빠뜨리면 연결이 조용히 끊긴다.
     */
    var onSessionEnd: ((BeaconEndReason) -> Unit)? = null
    /** `stop()`이 소비할 사유. `stop()` 직전에 대입하고 `stop()`·`requestStart`가 `ended`로 되돌린다. */
    private var pendingEndReason = BeaconEndReason.ended
    private val transitText = TransitGuideTextRenderer(strings) { transitGuideIsEn(dataLocale()) }

    // ── 출구 대기(E84 — iOS `BeaconModel` 같은 절) ──
    /** 열린 출구 대기 창. 값이 있는 동안 시작 경로 조회는 Kit `exitHoldStep`만 지난다(시계 없음). */
    private class ExitHoldState(val lead: ExitLead, val openedAt: Double)
    private var exitHold: ExitHoldState? = null
        set(v) { field = v; if (_ui.value.exitHoldExit != v?.lead?.exit) mutate { copy(exitHoldExit = v?.lead?.exit) } }
    /** 창 안에서 받은 보관 가능 fix(최근 창만 남긴다)와 첫 보관 가능 fix를 봤는지. */
    private var exitHoldSamples: List<ExitHoldSample> = emptyList()
    private var exitHoldSawStorable = false
    /** 보관 가능 fix 연속 구간의 시작·마지막 표본 시각(상한 판정 재료, Kit `exitHoldStorableRunStart`). */
    private var exitHoldStorableSince: Double? = null
    private var exitHoldLastStorableAt: Double? = null
    /** 잊힌 세션 안전망 시계의 하한(Kit `ExitHoldIdleFloors`). 관측 공백 뒤 첫 fix와 창이 닫히는 순간이 세운다. 출구 인계가 없는 세션은 끝까지 비어 있다. */
    private var exitHoldIdleFloors = ExitHoldIdleFloors()
    /** 단독 출구 통지의 게시 기록. 첫 시작류 통지(시작 요약·간략 강등)가 소비해 접두 여부를 정한다(Kit `exitLeadPrefixNeeded`). */
    private class ExitLeadNotice(val text: String, val postedAt: Double) { var dropped = false }
    private var exitLeadNotice: ExitLeadNotice? = null
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

    // ── 자동차 세션(M5 spec §4) ──
    /** 현재 경로의 도로명 스팬(E56). 자동차 경로만 채운다. */
    private var roadSpans: List<CarRoadSpan> = emptyList()
    /** 이미 아는 정체(E80 §5) — 좌표로 들고 판정 때마다 지금 경로에 다시 투영한다. null = 기준선 없음(다음 정보를 말없이 기준선으로). */
    private var knownCarJams: List<KnownCarJam>? = null
    /** 재조회 ETA(초)와 받은 시각(clock). 경유지 목표에는 쓰지 않는다(날조 금지). */
    private var etaSeconds: Double? = null
    private var etaUpdatedAt: Double? = null
    /** 세션 누적 자동차 조회 횟수(시작 조회 포함, 상한 `carEtaCallCap`). */
    private var etaCallCount = 0
    private var etaJob: Job? = null
    /** 마지막 상세 fix의 정확도·측정 시각(elapsedRealtime 초) — ETA 재조회 원점의 재사용 게이트(iOS `currentCoordinate` 추적 중 갈래). */
    private var lastFixAccuracy: Double? = null
    private var lastFixMeasuredAt: Double? = null
    private var sessionToken: Int? = null
    private var startJob: Job? = null
    private var startGeneration = 0

    // ── 리듀서 상태(전부 :kit) ──
    private var beaconState = BeaconState.initial
    private var gateState = BeaconGateState.initial
    private var toneState = ToneLayerState.initial
    private var motionState = MotionJudgeState.initial
    /**
     * 세션이 쥐는 경로. 경로가 바뀌면 옛 경로 기준의 횡단 남은 거리 행·"들어선 뒤" 복구 문장·지난 임박 상태 문장을 버린다(E62, iOS
     * `guideRoute didSet` 동형) — 커밋 자리는 남은 거리 행을 하단 2행 재설정보다 먼저 갱신해, 비우지 않으면 새 경로 첫 fix 동안
     * 옛 "횡단보도 끝까지"가 남는다.
     */
    private var guideRoute: GuideRoute? = null
        set(v) {
            field = v
            liveCrossingText = null
            pendingRecovery = null
            pendingRecoveryEntered = null
            imminentStatus = null
        }
    /** 횡단 중 남은 거리 행 문장(E62 판정 4 — "횡단보도 끝까지 약 30m", 말 없이 화면에만). null이면 남은 거리 행은 종전 문장. */
    private var liveCrossingText: String? = null
    /** 상태 행에 올린 임박 문장과 그 대상 스텝(E62 a11y M1). 그 스텝에 들어서면 상태 행에서 지운다. */
    private var imminentStatus: Pair<Int, String>? = null
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
    /**
     * 진행 중인 자동 조회의 토큰 — 그 조회가 아직 유효하면(`== proposalToken`) `RerouteNeeded`를 무시한다(리듀서는 이미 재무장했다. 새 요청이
     * 토큰을 올려 진행 중 조회를 버리면 느린 망에서 채택 없이 예산만 쓴다, E63 spec §3.5). 폐기로 토큰이 올라가면 옛 조회가 다음 회차를 막지 않는다.
     */
    private var proposalInFlightToken: Int? = null
    /**
     * 이 이탈 회차에 게시해 아직 버려지지 않은 이탈 문장들(E63 §3.4). 비었으면 복귀 때 "경로로 복귀했습니다"를 말하지 않는다. ⚠ 단일 Boolean이
     * 아니라 게시 번호 집합이다 — 들은 확정 문장 뒤 백그라운드 재통지가 버려져도 들은 문장의 기록이 지워지지 않는다(iOS 동형).
     */
    private val offRouteNoticeLive = mutableSetOf<Int>()
    private var offRouteNoticeSeq = 0
    private val offRouteNoticePosted: Boolean get() = offRouteNoticeLive.isNotEmpty()
    /** 돌아가기 국면의 상태 행 문장: 벗어난 쪽만(위원장 판정 2026-10-04 — 시계 방향은 그 순간에만 참이라 음성으로만). */
    private var offRouteLine: String? = null
    /** 이 이탈 회차의 자동 재조회 요청 수와 확정 시각·좌표(진단 로그 `rerouteTrigger`, E63 spec §6). */
    private var rerouteTriggerCount = 0
    private var offRouteConfirmedAt: Double? = null
    private var offRouteConfirmCoord: RoutePoint? = null
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
    /** 자동 재조회 채택 때 상태 행에 둔 문장과 그 순간 말한 문장의 짝(A57, iOS `rerouteStatusVoice`). 화면 복귀 상환의 중복 비교에 쓴다. */
    private var rerouteStatusVoice: Pair<String, String>? = null
    /** 마지막 실행 안내 원문. 바꾸면 "들어선 뒤" 대체 문장(`lastGuidanceEntered`)은 버린다 — 둘은 같은 안내의 두 모양이다. */
    private var lastGuidance: String? = null
        set(v) { field = v; lastGuidanceEntered = null }
    /** 마지막 실행 안내가 유닛 전문일 때 그 첫 스텝 시작과 회전 문장을 뗀 문장(E62). `currentGuidance`가 들어섰으면 이것을 쓴다. */
    private var lastGuidanceEntered: RecoveryEntered? = null
    private var pendingRecovery: String? = null
    /** 억제 복구 대상이 유닛 전문일 때, 그 유닛 첫 스텝 시작과 "들어선 뒤" 문장(E62). 복구 시점에 들어섰으면 이것을 읽는다. */
    private var pendingRecoveryEntered: RecoveryEntered? = null
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

    /**
     * 기기 음성 대기 칸(E53 spec §4.2, :kit `DeviceSpeechQueue`) — 백그라운드(잠금·다른 앱)의 행동 문장만 지난다. 말하는 중인 안내가 있으면 끊지 않고 한
     * 칸에 기다리고(`.high`·임박 명령만 선점), 꺼내는 순간 채널을 다시 고른다. 전경 문장은 종전대로 칸 밖의 직접 발화다(`QUEUE_FLUSH` — 새 문장이 말하는
     * 중인 안내를 끊는다). 안드로이드 매핑:
     * - 술어의 `voiceOver` 채널 = 전경 직접 발화(안내 문장 채널이 TTS 하나라 접근성 통지가 없다). 그 채널은 늘 들린다 — 그래서 `voiceOverRunning`은
     *   참이고, 전경 복귀 인계(`handOver`)가 iOS처럼 말하던 이 칸의 문장을 끊고 칸의 문장과 함께 넘겨 상환과 한 문장으로 낸다(새 전경 문장 뒤에 옛
     *   백그라운드 문장이 이어 나오는 순서 역전도 막는다).
     * - 채팅 듣기는 기다리지 않는다: 대기는 안내 TTS만 보고(`speaker.isSpeaking`), 채팅 재생기는 안내가 오디오 포커스를 잡는 순간 스스로 멈춘다(CAN_DUCK 손실).
     * - TalkBack 발화는 앱이 관찰할 수 없다 — 다른 앱 TalkBack 낭독과의 겹침은 실기기 판정 행.
     */
    private val deviceSpeech = DeviceSpeechQueue(
        scope = scope,
        clock = clock,
        isSpeaking = { speaker.isSpeaking },
        isSpeakingToken = { speaker.isSpeakingToken(it) },
        voiceOverRunning = { true },
        isSuppressed = { outputSuppressed },
        toneEndsAt = { tones.toneEndsAt },
        route = ::speechChannel,
        speak = { speakTracked(it, highPriority = false) },
        stopSpeaking = { speaker.stop() },
        postVoiceOver = { text, high -> speakTracked(text, high) != null },
        // 단독 조립(테스트)의 기본 배선. 앱 조립은 `GuideSession.attach`가 이 칸을 두 모델 팬아웃으로 덮는다(M5 §6-5 — 칸이 자기 토큰만 가린다).
    ).also { queue -> speaker.onInterrupted = { token, reason -> queue.speechInterrupted(token, reason) } }

    /** 이 모델이 마지막으로 게시한 발화 토큰 — 보류 문장 버림(`onSpeechDropped`)이 이 모델의 것인지 가른다(M5 §6-5). */
    private var lastSpeechToken: Int? = null

    private fun speakTracked(text: String, highPriority: Boolean): Int? =
        speaker.speak(text, highPriority)?.also { lastSpeechToken = it }

    /** TTS 끊김 통지를 자기 칸으로(`GuideSession`이 두 모델에 함께 넘긴다 — 칸이 자기 토큰만 반응한다). */
    fun speechInterrupted(token: Int, reason: DeviceSpeechDrop) {
        deviceSpeech.speechInterrupted(token, reason)
    }

    // ─────────────────────────── 시작 (§3-2) ───────────────────────────

    /** 유일한 시작 요청 창구(`GuideSession.beginBeacon`이 부른다). `starting` 재진입 가드. 수단은 요청 타입이 든다(M5 §2-2). */
    fun requestStart(request: BeaconStartRequest) {
        if (starting || isTracking) return   // 추적 중 재요청이 살아 있는 세션의 인자(경유지·계단 회피)를 갈아엎지 않게
        starting = true
        lastStartRequest = request
        val walk = request as? WalkStartRequest
        mutate { copy(lastStartLine = walk?.line, lastStartKind = request.kind) }
        // 자동차는 도보 축(계단 회피·줄·대안)이 없다(iOS `carRequest` — accessible false, variant·line·alternate nil).
        accessible = walk?.accessible ?: false
        sessionVariant = walk?.variant
        sessionLine = walk?.line
        alternateLine = walk?.alternate
        waypoint = request.waypoint
        routeWaypointLabel = null
        waypointPassedInSession = false
        lastStepFree = null
        pendingStepFreeNotice = null
        pendingEndReason = BeaconEndReason.ended
        startGeneration += 1
        val generation = startGeneration
        startJob = scope.launch {
            try {
                start(request.dest, request.label, request.kind, (request as? WalkStartRequest)?.exitLead)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                // 포트(권한 손·서비스 시작)의 동기 throw가 스코프 밖으로 새면 프로세스가 죽고 토큰·starting이 세션 없이 남는다(리뷰 MAJOR).
                GuideDiag.log("start failed ${e::class.simpleName}: ${e.message}")
                // 이 도보 세션은 시작되지 못했다 — 승차 전 도보면 연결이 대중교통 대기로 잇는다(`onSessionEnd`, iOS 시작 실패 판정과 같은 사유).
                pendingEndReason = BeaconEndReason.startFailed
                val bridge = prewalkTarget != null  // `stop()`이 표식을 지우기 전에 — 연결이 곧 대중교통 대기로 잇는다(A67 다리 문장)
                stop()
                fail(GuideStatus.unavailable, "android.guide.serviceStartFailed", prewalkBridgeAfterStop = bridge)
            } finally {
                if (startGeneration == generation) {
                    starting = false
                    // 시작 실패 한 판정(권한 거부·정밀 위치·위치 서비스 꺼짐·점유 거부 전부, iOS `begin` 말미): 세션이 시작되지 않았으면 `stop()`이 돌지
                    // 않으므로 여기서 콜백을 소비한다.
                    if (!isTracking) onSessionEnd?.let { cb ->
                        onSessionEnd = null
                        prewalkTarget = null
                        prewalkIsTransfer = false
                        cb(BeaconEndReason.startFailed)
                    }
                }
            }
        }
    }

    /**
     * 같은 세션을 다시 시작한다(정밀 위치 허용 후 복구 경로). 저장된 인자가 없으면 아무것도 하지 않는다(A13). 호출자는 `GuideSession.restartBeacon` 하나다 —
     * 승차 전 도보의 재시작은 이 인자만으로는 대중교통 연결을 재현하지 못해 그쪽이 연결(표식·종료 훅)을 먼저 다시 건다(A68).
     */
    fun restart() {
        if (isTracking) return
        val request = lastStartRequest ?: return
        requestStart(request)
    }

    private suspend fun start(dest: BeaconDest, label: String, kind: GuideSessionKind, exitLead: ExitLead?) {
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
        // 걸음은 도보만 센다 — 자동차엔 만보계·걸음 요약이 없다(iOS `sessionStart = kind == .walk ? … : nil`).
        val stepsGranted = kind == GuideSessionKind.walk && permissions.requestActivityRecognition()
        // ④ 세션 단일성 — 권한 대기 중 뒤집힌 경합의 최종 게이트. 토큰은 stop()이 반납한다.
        val token = coordinator.claim { stop() }
        if (token == null) {
            announceNow(strings.get("guide.alreadyActive"), highPriority = true, bypassSuppression = true)
            return
        }
        sessionToken = token
        // 수단은 점유 **뒤**에 바꾼다 — 거부된 시작이 살아 있는 세션의 임계(`tuning`)를 바꾸지 않게.
        sessionKind = kind
        // ⑤ 상태 초기화(iOS `start` 대입 목록 그대로).
        deferredAnnouncer.advanceGeneration()
        deviceSpeech.reset()
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
        exitHoldIdleFloors = ExitHoldIdleFloors()
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
        GuideDiag.log(if (kind == GuideSessionKind.car) "session kind=car listener=passenger" else "session kind=walk")
        // ⑧ 전경 서비스 — 시작 실패는 서비스 안에서 잡혀 `onServiceStartFailed`로 돌아온다(§4-1).
        val generation = controller.nextGeneration()
        serviceGeneration = generation
        controller.start(generation)
        if (!isTracking) return  // 서비스 시작 실패 콜백이 동기로 왔으면(백그라운드 시작 거부·테스트) 이미 접혔다
        // ⑨ 오디오 — 승격은 첫 톤보다 먼저.
        tones.beginSession()
        playTone(BeaconTone.start)   // 미디어 볼륨 0 판정은 playTone 안에서 1회
        // 출구 인계(E84)면 시작 직후 출구 문장을 단독으로 말한다(iOS 동형). 버려지면(억제·백그라운드) 첫 시작류 통지가 접두로 다시 싣는다(`withExitLead`).
        val exitSentence = if (kind == GuideSessionKind.walk) exitLead?.let { strings.get("guide.exitLeadStart", it.exit) } else null
        exitLeadNotice = exitSentence?.let { ExitLeadNotice(it, clock()) }
        if (exitSentence != null) announce(exitSentence, speechClass = GuideSpeechClass.actionable, onDropped = { exitLeadNotice?.dropped = true })
        // ⑩ 워치독·경로 조회 대기.
        startWatchdog()
        awaitingRoute = true
        routeFetchToken += 1
        if (kind == GuideSessionKind.walk && exitLead != null) {
            // 출구 대기(E84): 종전 15초 시계를 걸지 않는다. 창은 fix 증거(`exitHoldStep`)와 사용자 선언(`declareExitedStation`)이 닫고, fix가 아예 없으면
            // 잊힌 세션 안전망이 끝낸다.
            openExitHold(exitLead)
        } else {
            startFixWaitWatch(routeFetchToken)
        }
        // ⑪ TTS 초기화(보류 1문장은 재생기 몫). 이미 불가로 판정된 엔진이면 시트 행·진동을 지금 낸다(첫 게시를 기다리지 않는다).
        speaker.prepare()
        syncTtsUnavailable()
    }

    /**
     * 전경 서비스가 `startForeground` 실패를 되부른다(§4-1). 세션이 시작되지 않은 것으로 접는다 — 위치 문제와 문장을 가른다(3-state).
     * `stop()`을 지나지 않으므로 토큰·상태를 여기서 직접 되돌린다.
     */
    override fun onServiceStartFailed(generation: Int, error: Throwable) {
        if (generation != serviceGeneration) {
            // 앞 세션(또는 인계 전 대중교통)의 늦은 실패 — 지금 세션을 접지 않는다(M5 §6-4).
            GuideDiag.log("serviceStartFailed stale gen=$generation current=$serviceGeneration")
            return
        }
        GuideDiag.log("serviceStartFailed ${error::class.simpleName}: ${error.message}")
        val wasTracking = isTracking
        // 도보 안내가 서지 못했다 — 승차 전 도보면 연결이 대중교통 대기로 잇는다(시작 실패와 같은 사유).
        pendingEndReason = BeaconEndReason.startFailed
        val bridge = prewalkTarget != null  // `stop()`이 표식을 지우기 전에(위 시작 잡 실패와 같은 이유)
        stop(playStopTone = false)
        if (!wasTracking) return
        fail(GuideStatus.unavailable, "android.guide.serviceStartFailed", prewalkBridgeAfterStop = bridge)
    }

    /**
     * 시작 실패 한 판정(§7-6 표): 문장 + `failure` 진동 — 문장이 TalkBack 라벨 낭독이나 타 앱 전경에 삼켜져도 진동은 즉시 신호다.
     *
     * 승차 전 도보면 사유 뒤에 대중교통 꼬리를 **두 문장**으로 잇는다(`prewalkTail`, A54 — iOS `fail(with:…prewalkTail:)`). 승차 전 도보의 **시작** 실패
     * (`starting` 중)는 통지에만 다리 문장(「도보 안내를 시작할 수 없어 승차 대기로 바로 넘어갑니다」)을 붙인다(A67) — 곧 대중교통 안내가 서고 그 시트로 커서가
     * 옮겨 가므로 `highPriority`. 상태 줄은 원인만(대중교통이 끝난 뒤엔 「바로 넘어갑니다」가 거짓 진행형이 된다).
     */
    private fun fail(
        status: GuideStatus, key: String, resolution: FailResolution = FailResolution.none, prewalkTail: PrewalkStopTail? = null,
        highPriority: Boolean = false,
        /** `stop()`을 먼저 지난 시작 실패(안드로이드 고유 — 서비스 시작 실패·포트 동기 예외)가 승차 전 도보였는가. `stop()`이 `starting`·표식을 지워 아래 판정이 못 본다. */
        prewalkBridgeAfterStop: Boolean = false,
    ) {
        this.status = status
        failResolution = resolution
        statusText = prewalkTail?.let { prewalkStopText(it, strings.get(key)) } ?: strings.get(key)
        pendingFailLanding = true
        mutate { copy(failSeq = failSeq + 1) }
        resultHaptic(ResultHapticKind.failure)
        val prewalkBridge = (starting && prewalkTarget != null) || prewalkBridgeAfterStop
        announce(
            if (prewalkBridge) strings.get("android.beacon.prewalkUnavailableWith", strings.get(key)) else statusText,
            highPriority = highPriority || prewalkBridge, speechClass = GuideSpeechClass.actionable,
        )
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
        deviceSpeech.reset()
        resetFinalApproach(null)                                  // ③
        sessionToken?.let { coordinator.release(it) }             // ④
        sessionToken = null
        startJob?.cancel(); startJob = null; starting = false     // ⑤
        watchdogJob?.cancel(); watchdogJob = null                 // ⑥
        serviceGeneration?.let { controller.stop(it) }            // ⑦ 서비스·스트림·wake lock(자기 세대만)
        serviceGeneration = null
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
        rerouteGaveUp = false
        rerouteGaveUpSpoken = false
        offRouteStillSince = null
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
        proposalInFlightToken = null
        offRouteNoticeLive.clear()
        offRouteLine = null
        rerouteTriggerCount = 0
        offRouteConfirmedAt = null
        offRouteConfirmCoord = null
        offRouteEndedByReroute = false
        etaJob?.cancel(); etaJob = null
        etaSeconds = null
        etaUpdatedAt = null
        etaCallCount = 0
        roadSpans = emptyList()
        knownCarJams = null
        currentRoadText = null
        lastFixAccuracy = null
        lastFixMeasuredAt = null
        // 수단은 도보로 되돌린다 — 종료 화면의 수단은 `stop()` **앞**에서 캡처한 `arrivalSessionKind`가 든다(iOS 설계 리뷰 B10).
        sessionKind = GuideSessionKind.walk
        syncOverview()
        exitHold = null
        resetExitHoldSamples()
        exitHoldIdleFloors = ExitHoldIdleFloors()
        exitLeadNotice = null
        prewalkTarget = null
        prewalkIsTransfer = false
        // 종료 콜백은 정리가 **끝난 뒤** 다음 턴에 — 이 stop()을 부른 자리가 뒤에 내는 종료 문장(도착·유휴·권한)이 연결 문장보다 먼저 나가고, 정리 도중
        // 다른 모델 시작이 재진입하지 않는다(iOS `Task { @MainActor in cb(reason) }`, spec 2026-08-30 §4.2).
        val reason = pendingEndReason
        pendingEndReason = BeaconEndReason.ended
        onSessionEnd?.let { cb ->
            onSessionEnd = null
            scope.launch { cb(reason) }
        }
    }

    /** 사용자 중지(시트·알림 "안내 종료"). 정지 톤 + 의미 있는 보행이면 `.stopped` 종료 화면(동기 판정). */
    fun stopByUser() {
        val text = strings.get("android.beacon.stopped")
        val prewalkTail = prewalkStopTail  // stop() 앞 캡처(A25 §4.2)
        pendingEndReason = BeaconEndReason.userStopped
        if (stopLeavingSummary(playStopTone = true, text = text)) {
            announce(text, highPriority = true, speechClass = GuideSpeechClass.actionable)
        } else if (prewalkTail != null) {
            // 승차 전 도보는 종료 화면이 없다 — 정지 사유 뒤에 대중교통 꼬리를 마침표 두 문장으로(A54, 권한 상실 `stopAndFail`과 같은 문장 틀). 이 모델의
            // 창구라 정지음 뒤에 나간다. `.high`: 시트가 닫혀 커서가 아래 화면으로 옮겨 간다(착지 라벨로 대체될 수 없다). 환승 도보(E73)면 「대중교통 안내도
            // 종료했습니다」다(이미 돌던 안내).
            announce(prewalkStopText(prewalkTail, strings.get("android.beacon.stoppedJoin")), highPriority = true, speechClass = GuideSpeechClass.actionable)
        }
    }

    /**
     * 도착이 아닌 종료. `stop()` 뒤 라이브 걸음 누적이 `WalkHealth.isMeaningfulWalk`면 종료 화면을 남긴다(**동기 판정** —
     * 요약이 없는 종료는 화면이 스치지 않는다). 반환 = 종료 화면을 남겼는가.
     */
    private fun stopLeavingSummary(playStopTone: Boolean, text: String): Boolean {
        val dest = this.dest
        val wasWalkSession = isTracking
        val endedKind = sessionKind
        // 자동차는 걸음을 세지 않아 요약이 없다 — 앞 도보 세션의 남은 값을 읽지 않는다(걸음 센서는 값을 남긴다).
        val sample = if (endedKind == GuideSessionKind.walk) steps.liveSample else null
        val noScreen = endsWithoutScreen  // stop() 앞 캡처(A25 §4.2) — 승차 전 도보는 종료 화면 없음
        stop(playStopTone)
        if (noScreen || !wasWalkSession || dest == null || sample == null) return false
        if (!WalkHealth.isMeaningfulWalk(sample.steps, sample.distanceMeters)) return false
        presentEndScreen(dest, SessionEndKind.stopped, text, sample, endedKind)
        return true
    }

    private fun presentEndScreen(dest: BeaconDest, kind: SessionEndKind, text: String, sample: StepSample?, sessionKind: GuideSessionKind) {
        endedAt = clock()
        arrivalHealthSample = sample?.takeIf { WalkHealth.isMeaningfulWalk(it.steps, it.distanceMeters) }
        val health = arrivalHealthSample?.let { WalkHealth.summary(it.steps, it.distanceMeters, storedWeight()) }
        mutate {
            copy(
                arrivalDest = dest, endKind = kind, endText = text, arrivalHealth = health, weightPromptShown = showsWeightPrompt(health),
                arrivalSessionKind = sessionKind,
            )
        }
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
        mutate { copy(arrivalDest = null, endKind = SessionEndKind.arrived, endText = "", arrivalHealth = null, weightPromptShown = false, liveTopText = null, arrivalSessionKind = null) }
        if (!status.isFailure) statusText = ""   // 종료 문장이 상환 꼬리로 맥락 밖에서 되읽히지 않게(iOS 동형)
        endedAt = null
    }

    /**
     * 자동차 도착 뒤 도보 인계 요청(K2 §6.4, iOS `acceptCarWalkHandoff`의 앞 절반): 자동차 종료 화면이면 그 화면을 지우고 같은 목적지 도보
     * 요청을 돌려준다(경유지·계단 회피·줄 없음). 자동차 종료 화면이 아니면 null.
     */
    fun takeCarWalkHandoff(): WalkStartRequest? {
        val dest = arrivalDest ?: return null
        if (_ui.value.arrivalSessionKind != GuideSessionKind.car) return null
        val label = destinationLabel
        clearArrival()
        return WalkStartRequest(dest, label, accessible = false, variant = null, line = null, alternate = null, waypoint = null, exitLead = null)
    }

    /** 시작 실패 행 소거(해결 버튼 뒤·다른 시작 앞·승차 전 도보 재시작 줄 거두기 `GuideSession.retirePrewalkRestart`). */
    fun clearFailure() {
        if (!status.isFailure) return
        status = GuideStatus.idle
        statusText = ""
        failResolution = FailResolution.none
    }

    /**
     * 승차 전 도보 세션으로 표식(A25, iOS `markPrewalk`). `requestStart` **앞**에 건다 — 시작 잡의 실패 판정이 이 값을 함께 지운다.
     * ⚠ `transfer`는 기본값 없음 — 환승 도보(E73)가 빠뜨리면 정지 꼬리가 이미 돌던 대중교통을 「시작하지 않았다」고 말한다.
     */
    fun markPrewalk(target: TransitLabel, transfer: Boolean) {
        prewalkTarget = target
        prewalkIsTransfer = transfer
    }

    /** 사유 뒤에 대중교통 꼬리를 잇는 두 문장(A54 문장 틀, iOS `prewalkStopText`). */
    private fun prewalkStopText(tail: PrewalkStopTail, reason: String): String = when (tail) {
        PrewalkStopTail.transitNotStarted -> strings.get("android.beacon.prewalkCancelledWith", reason)
        PrewalkStopTail.transitAlsoEnded -> strings.get("android.beacon.transferWalkCancelledWith", reason)
        PrewalkStopTail.transitResumes -> strings.get("android.beacon.transferWalkLostWith", reason)
    }

    /** 승차 전 도보 해제(연결 취소·다른 세션 시작, iOS `clearPrewalk`). 추적 중이면 세션은 그대로 두고 표식만 뗀다. */
    fun clearPrewalk() {
        prewalkTarget = null
        prewalkIsTransfer = false
        onSessionEnd = null
    }

    /**
     * 「승차역 도착」 선언(A25 §4.3, iOS `declarePrewalkArrival`) — 도착 판정이 닿지 않는 경우(입구가 멀어 지하로 먼저 진입)의 사용자 행위. 확정 도착과 같은
     * 모양: 종·`arrived` 사유·stop()·도착 문장(.high, 직접 응답).
     */
    fun declarePrewalkArrival() {
        if (!isTracking) return
        val station = prewalkTarget ?: return
        val spoken = transitText.render(transitPrewalkArrivedLine(isEn = transitGuideIsEn(dataLocale()), station = station))
        playTone(BeaconTone.nearby)
        pendingEndReason = BeaconEndReason.arrived
        stop()
        statusText = spoken
        lastGuidance = spoken
        liveTopText = spoken
        announce(spoken, highPriority = true, speechClass = GuideSpeechClass.actionable)
    }

    /** 위치 제공자 꺼짐(스트림 콜백, §3-3) — 세션을 끝내고 실패 상태를 남긴다. */
    override fun handleProviderDisabled() {
        if (!isTracking) return
        GuideDiag.log("providerDisabled")
        stopAndFail(GuideStatus.unavailable, "beacon.weak")
    }

    /**
     * 세션 중 위치 상실 종료(iOS `stopAndFail`) — 종료 화면(요약)을 남기고 실패 상태·통지를 낸다. 승차 전 도보면 대중교통 꼬리를 **같은 통지**에 두 문장으로
     * 붙인다(A54). 환승 도보(E73)는 걷기만 끝내고 그 구간 승차 대기로 넘어간다(위원장 판정 2026-10-19) — 꼬리가 「도보 안내를 멈추고 승차 대기로
     * 넘어갑니다」이고 재개는 사유 `locationLost`를 받은 `GuideSession.endPrewalk`가 한다. 종료 화면이 남지 않으면 시트가 닫혀 커서가 아래 화면으로
     * 옮겨 가므로 사유는 `highPriority`다.
     */
    private fun stopAndFail(status: GuideStatus, key: String, resolution: FailResolution = FailResolution.none) {
        val prewalkTail = prewalkStopTail.let { if (it == PrewalkStopTail.transitAlsoEnded) PrewalkStopTail.transitResumes else it }  // stop() 앞 캡처
        pendingEndReason = BeaconEndReason.locationLost
        val leftEndScreen = stopLeavingSummary(playStopTone = false, text = strings.get(key))
        fail(status, key, resolution, prewalkTail = prewalkTail, highPriority = !leftEndScreen)
    }

    // ─────────────────────────── 전경 복귀 (§5-3) ───────────────────────────

    /** `GuideBottomBar`의 수명 관찰자가 ON_START/ON_STOP을 넘긴다. 상환 블록은 `isTracking` 판정보다 앞이다. */
    fun setForeground(foreground: Boolean) {
        if (!foreground) { wasBackgrounded = true; return }
        val returnedFromBackground = wasBackgrounded
        wasBackgrounded = false
        // 복귀 인계(E53 §4.2 ⑥): 백그라운드에서 말하던 이 칸의 문장·칸에 기다리던 문장을 받아 아래 상환과 **한 문장**으로 낸다(두 문장을 잇달아
        // 내면 뒤의 것이 앞의 것을 끊는다). 백그라운드를 거치지 않은 복귀엔 넘길 것이 없다.
        val handed = if (returnedFromBackground) deviceSpeech.handOver() else DeviceSpeechHandover.empty
        if (returnedFromBackground && !isTracking && arrivalDest != null) {
            val since = endedAt?.let { clock() - it }
            if (since != null && isEndScreenStale(since)) {
                GuideDiag.log("endScreenExpired age=${since.toInt()}")
                pendingFinalApproachIntro = null
                pendingStepFreeNotice = null
                clearArrival()
            }
        }
        val repaying = missedAnnouncement || pendingStepFreeNotice != null || pendingFinalApproachIntro != null
        if (repaying || !handed.isEmpty) {
            missedAnnouncement = false
            val intro = pendingFinalApproachIntro
            // 상태 행이 비어 있으면(실행 안내 직후 — 역할 분리로 statusText에 실행 안내가 남지 않는다) 마지막 안내가 곧 현재 상태다(안드로이드
            // 고유 대체 — iOS 도보엔 없다). 이미 그 스텝에 들어섰으면 회전 문장을 뗀 문장으로(E62 — 화면을 켜며 지난 회전을 다시 지시하지 않는다).
            // 자동차는 하단 2행 윗줄, 없으면 현재 도로 행이다(iOS `liveTopText ?? currentRoadText`).
            val current = statusText.ifEmpty {
                if (sessionKind == GuideSessionKind.car) (liveTopText ?: currentRoadText).orEmpty() else currentGuidance().orEmpty()
            }
            // 현재 상태 꼬리는 버린 문장이 있을 때만(인계만 있으면 마지막 상태는 인계 문장이다), 인계와 같은 문장이면 뺀다(낭독 정정 뒤끼리 비교).
            // 상태 행이 채택 문장이면 인계된 음성 쪽(머리말 있음)과도 비교한다(A57 — 두 모양이 연달아 들리지 않게).
            val spokenMeters = strings.get("android.unit.spokenMeters")
            val currentVoice = rerouteStatusVoice?.takeIf { it.first == current }?.second
            val tail = if (!repaying || current.isEmpty() || current == intro || spokenDistanceUnits(current, spokenMeters) in handed.texts ||
                (currentVoice != null && spokenDistanceUnits(currentVoice, spokenMeters) in handed.texts)
            ) null else current
            // 순서: 인계(끊긴 옛 발화 → 칸의 새 문장) → 세션 경고 → 진입 서술 → 현재 상태.
            val owed = (handed.texts + listOfNotNull(pendingStepFreeNotice, intro, tail)).joinToString(" ")
            if (owed.isNotEmpty()) {
                val notice = pendingStepFreeNotice
                pendingStepFreeNotice = null
                pendingFinalApproachIntro = null
                // 먼저 지우고, 내지 못하면(억제 잔류 등) 되돌린다 — 인계받은 문장도(인계는 전달로 쳐서 칸이 장부를 풀었다, 횡단 리뷰 F6).
                announce(owed, highPriority = true, speechClass = GuideSpeechClass.actionable) {
                    pendingStepFreeNotice = notice
                    pendingFinalApproachIntro = intro
                    handed.undelivered()
                }
                if (sessionKind == GuideSessionKind.car) noteRepaidAnnouncement()
            }
        }
    }

    // ─────────────────────────── 경로 조회 (§6-2) ───────────────────────────

    /** 억제 복구 대체 문장(E62): 그 유닛 첫 스텝 시작 진행거리와 들어선 뒤 읽을 문장. */
    private class RecoveryEntered(val startD: Double, val text: String)

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
        /** 자동차 도로명 스팬(E56). 도보는 빈 목록. */
        val roadSpans: List<CarRoadSpan>,
        /** 자동차 조회가 본 정체(E80 §5 기준선). null = 정보 없음(도보·정체 정보 결손). */
        val jams: List<CarJam>?,
    )

    // ─────────────────────────── 출구 대기(E84, iOS `BeaconModel` 같은 절) ───────────────────────────

    private fun openExitHold(lead: ExitLead) {
        fixWaitJob?.cancel(); fixWaitJob = null
        routeOriginBest = null
        routeOriginBestAt = null
        resetExitHoldSamples()
        exitHoldIdleFloors = ExitHoldIdleFloors()
        exitHold = ExitHoldState(lead, clock())
        GuideDiag.log("exitHold start exit=${lead.exit} station=${if (lead.stationLat != null && lead.stationLng != null) 1 else 0}")
    }

    private fun resetExitHoldSamples() {
        exitHoldSamples = emptyList()
        exitHoldSawStorable = false
        exitHoldStorableSince = null
        exitHoldLastStorableAt = null
    }

    /**
     * 창을 닫는 한 자리. `keepLead` = 뒤따르는 시작류 통지가 출구 문장을 접두로 실을 수 있는가(fix로 풀린 경우만). 저장된 시작 요청에서도 출구를 내린다 —
     * 한 번 풀린 세션의 재시작이 출구 대기를 다시 열지 않게.
     */
    private fun closeExitHold(reason: String, keepLead: Boolean, accuracy: Double? = null) {
        val hold = exitHold ?: return
        GuideDiag.log { "exitHoldRelease reason=$reason elapsed=${fmt("%.0f", clock() - hold.openedAt)} acc=${accuracy?.let { fmt("%.1f", it) } ?: "-"}" }
        exitHold = null
        resetExitHoldSamples()
        // 안전망 시계는 창이 닫힌 지금부터 새로 흐른다: 창 안에서 흐른 두절·무이동 시간이 닫힌 직후의 종료 사유가 되지 않게.
        exitHoldIdleFloors = exitHoldIdleFloorsAfterClose(now = clock())
        if (!keepLead) exitLeadNotice = null
        syncStartRequestWithSession()
    }

    /** 창 안 fix 한 건. true = 여기서 처리가 끝났다(대기·조회 착수), false = 창을 버렸으니 종전 판정으로 이어 간다. */
    private fun handleExitHoldFix(candidate: RouteOriginFix, raw: GuideFixPayload, hold: ExitHoldState, dest: BeaconDest, now: Double): Boolean {
        val storable = exitHoldStorable(candidate)
        val first = storable && !exitHoldSawStorable
        if (storable) {
            exitHoldSawStorable = true
            exitHoldStorableSince = exitHoldStorableRunStart(previousStart = exitHoldStorableSince, previousSampleAt = exitHoldLastStorableAt, now = now)
            exitHoldLastStorableAt = now
            exitHoldSamples = (exitHoldSamples + ExitHoldSample(candidate, now)).filter { now - it.at <= exitHoldRecentWindowSeconds }
        }
        val stationLat = hold.lead.stationLat
        val stationLng = hold.lead.stationLng
        val stationDistance = if (stationLat != null && stationLng != null) haversineMeters(candidate.lat, candidate.lng, stationLat, stationLng) else null
        val elapsed = now - hold.openedAt
        // 창 안 fix마다 한 줄(좌표 없음): 지하 fix의 정확도·속도 분포와 풀린 시각이 잠정 상수의 판정 재료다.
        GuideDiag.log {
            "routeOriginWait acc=${fmt("%.1f", candidate.accuracy)} age=${fmt("%.1f", candidate.ageSeconds)} speed=${raw.speed?.let { fmt("%.1f", it) } ?: "-"} " +
                "speedAcc=${raw.speedAccuracy?.let { fmt("%.1f", it) } ?: "-"} holdT=${fmt("%.0f", elapsed)} station=${stationDistance?.let { fmt("%.0f", it) } ?: "-"}"
        }
        return when (
            val decision = exitHoldStep(
                elapsed = elapsed, fix = candidate, isFirstStorable = first, stationDistance = stationDistance,
                recent = exitHoldSamples, storableSince = if (storable) exitHoldStorableSince else null, now = now,
            )
        ) {
            ExitHoldDecision.Wait -> true
            is ExitHoldDecision.Fetch -> {
                closeExitHold(reason = decision.reason.rawValue, keepLead = true, accuracy = decision.fix.accuracy)
                startRouteFetch(decision.fix, "exitHold-${decision.reason.rawValue}", dest, routeFetchToken)
                true
            }
            ExitHoldDecision.Abandon -> {
                // 하차역 근처가 아니다(다른 역에서 내렸다): 출구 문장·줄을 거두고 종전 시작 대기로 간다.
                closeExitHold(reason = "otherStation", keepLead = false, accuracy = candidate.accuracy)
                startFixWaitWatch(routeFetchToken)
                false
            }
        }
    }

    /**
     * 「출구로 나왔어요」(E84, iOS `declareExitedStation`): 사용자가 창을 닫는다. 종전 시작 대기(수용 fix 즉시, 15초 안 최선값, 없으면 `guide.detailNoLocation`
     * 강등)를 지금부터 새로 건다 — 창 안에서 모은 역 안 좌표는 쓰지 않는다.
     */
    fun declareExitedStation() {
        if (!isTracking || !awaitingRoute || exitHold == null || routeFetchJob != null) return
        closeExitHold(reason = "declared", keepLead = false)
        startFixWaitWatch(routeFetchToken)
        // 버튼이 사라지며 커서가 옮겨 간다: 활성화 응답은 착지 라벨로 대체될 수 없다.
        announceNow(strings.get("android.guide.destChangedFetching"), highPriority = true, bypassSuppression = true)
    }

    /** 첫 시작류 통지 앞에 출구 문장을 다시 실을지 정하고 기록을 소비한다. 출구 인계가 없으면 문장을 그대로 돌려준다. */
    private fun withExitLead(text: String): String {
        val notice = exitLeadNotice ?: return text
        exitLeadNotice = null
        if (!exitLeadPrefixNeeded(hasExit = true, dropped = notice.dropped, secondsSincePosted = clock() - notice.postedAt)) return text
        return "${notice.text} $text"
    }

    /** 수용 fix가 15초 안에 오지 않으면 최선 fix로 조회하고, 그것도 없으면 간략 폴백(`guide.detailNoLocation`). */
    private fun startFixWaitWatch(token: Int) {
        // 종전 대기 시계를 건다 = 출구 대기가 아니다(E84): 목적지 전환·경유지·재획득이 이 한 자리로 창을 닫는다.
        closeExitHold(reason = "superseded", keepLead = false)
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
        GuideDiag.log { "routeOrigin lat=${fmt("%.6f", origin.lat)} lng=${fmt("%.6f", origin.lng)} acc=${fmt("%.1f", origin.accuracy)} age=${fmt("%.1f", origin.ageSeconds)} reason=$reason" }
        routeOriginBest = null
        routeOriginBestAt = null
        routeFetchJob = scope.launch { fetchGuideRoute(RoutePoint(origin.lat, origin.lng), dest, token) }
    }

    /**
     * `RouteService.walk(includeGeometry)` → `buildGuideRoute`. null = 상세 부적격(간략 폴백). ⚠ `GuideStepGeometry.action`을
     * 빠뜨리면 walk 프로파일에서 임박 큐가 전면 침묵한다(E16 축3). 경유지를 보냈는데 응답에 표지가 없으면 null.
     */
    private suspend fun fetchDetailData(origin: RoutePoint, dest: BeaconDest, variant: WalkRouteVariant?, accessible: Boolean, waypoint: GuideWaypoint?): DetailFetchResult? {
        if (sessionKind == GuideSessionKind.car) return fetchCarDetailData(origin, dest, waypoint)
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
            briefing.steps.map { GuideStepGeometry(it.description, it.pathCoords, it.action, crossing = it.crossing == true) },
            briefing.waypoint?.stepIndex,
            // 목적지는 이탈 중 도착 창 입구(A70 §4)가 직선거리를 잰다 — 소스 가드 `a70-destination-wiring.test.ts`.
            destination = RoutePoint(dest.lat, dest.lng),
        ) ?: return null
        return DetailFetchResult(
            route, briefing.durationSeconds, briefing.stepFree, briefing.stepFreeStatus, briefing.stepFreeNotice, briefing.finalApproach,
            liveStepsFrom(route, briefing.steps.map { LiveStepFields(it.live?.target, it.live?.anchor, it.crossing ?: false, body = it.parts?.body, crossingClock = it.crossingClock) }),
            briefing.lineKind,
            roadSpans = emptyList(), jams = null,
        )
    }

    /**
     * 자동차 상세 조회(iOS `fetchDetailData`의 car 갈래, M5 §4-2): Tmap 기하 + 도로명 스팬. null = 상세 부적격(간략 강등) — 경유지를
     * 보냈는데 표지가 없다 / 카카오 폴백(기하 미지원) / `buildCarGuide` 실패(기하 결손·종점 불일치). 걸음 축(계단 회피·최종 접근 기하·
     * 라이브 조각)은 없다. 시간 초과는 경로 없음이 아니라 조회 실패다(도보와 같은 3-state).
     */
    private suspend fun fetchCarDetailData(origin: RoutePoint, dest: BeaconDest, waypoint: GuideWaypoint?): DetailFetchResult? {
        val via = waypoint?.let { RoutePoint(it.dest.lat, it.dest.lng) }
        val briefing = withTimeoutOrNull(queryTimeoutMs) {
            withContext(io) {
                // 정체(E80 §5): 시작·재경로 조회가 본 정체가 아는 정체의 기준선이다.
                routes.car(origin.lat, origin.lng, dest.lat, dest.lng, lang = dataLocale().rawValue, includeGeometry = true, via = via, traffic = true)
            }
        } ?: throw DetailFetchTimeout()
        if (via != null && briefing.waypoint == null) return null
        if (briefing.provider != "tmap") return null
        val guide = buildCarGuide(briefing) ?: return null
        return DetailFetchResult(
            guide.route, briefing.durationSeconds, stepFreeRaw = null, stepFree = null, stepFreeNotice = null, finalApproach = null,
            liveStepsFrom(guide.route, emptyList()), lineKind = null, roadSpans = guide.roadSpans, jams = briefing.congestion?.jams,
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

    /**
     * 사용자가 연 조회(시작·버튼 재조회·줄 전환·프리뷰 채택)의 출발점 고지(A70 spec §2.3): 새 경로 첫 점이 `rerouteMaxDriftM` 밖이면 앞에 붙일
     * 문장, 아니면 null. 사용자가 누른 조회는 첫 점이 멀어도 거부하지 않고 알린다(거부하면 버튼이 막다른 길이 된다). 계측은 거리만 남긴다.
     */
    private fun routeStartAwayNotice(route: GuideRoute, from: RoutePoint): String? {
        val away = text.routeStartsAway(route, from.lat, from.lng, tuning.rerouteMaxDriftM)
        GuideDiag.log {
            "routeStartGap gap=${fmt("%.0f", RerouteProposalGate.routeStartGapMeters(route, from.lat, from.lng))} notice=${if (away != null) 1 else 0}"
        }
        return away
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
            roadSpans = result.roadSpans
            knownCarJams = result.jams?.map { KnownCarJam(it.start, it.end) }
            resetFinalApproach(result.finalApproach)
            val initial = initialGuideState(
                result.route, clock(), hasFinalApproachGeometry = result.finalApproach != null,
                courseDerivation = carriedCourseDerivation ?: initialDerivationState,
            )
            carriedCourseDerivation = null
            guideState = initial.state
            mode = GuideMode.detail
            offRoute = false
            if (sessionKind == GuideSessionKind.car) {
                // 시작 조회가 ETA 1회차다(§4-5) — 남은 시간 행이 이 값을 깎아 쓰므로 `updateRemaining`보다 먼저.
                etaCallCount = 1
                result.durationSeconds?.takeIf { it > 0 }?.let { etaSeconds = it.toDouble(); etaUpdatedAt = clock() }
                startEtaTimer()
            }
            updateRemaining(result.route, initial.state)
            displayUnits = buildDisplayUnits(result.liveSteps)
            liveSteps = result.liveSteps
            resetLiveRowsBaseline(initial.state)
            if (sessionKind == GuideSessionKind.car) refreshCurrentRoad(initial.state) else currentRoadText = null
            syncOverview()
            val summary = if (sessionKind == GuideSessionKind.car) text.carStart(result.route, initial.firstIndices, destinationLabel)
            else text.start(result.route, initial.firstIndices, destinationLabel)
            val notice = consumeStepFreeNotice(result.stepFreeRaw, result.stepFree, result.stepFreeNotice)
            // 출발점 고지(A70 §2.3)가 맨 앞 — 첫 문장이 "경로가 여기서 시작하지 않는다"를 말한다. 계단 회피 문장은 그다음이다.
            val away = routeStartAwayNotice(result.route, origin)
            val spoken = listOfNotNull(away, notice, summary).joinToString(" ")
            lastGuidance = text.unit(result.route, initial.firstIndices)
            statusText = spoken
            // 출구 인계(E84): 단독 출구 통지가 버려졌거나 방금 나갔으면(이 `.high` 통지가 끊는다) 앞에 다시 싣는다.
            announce(withExitLead(spoken), highPriority = true, speechClass = GuideSpeechClass.actionable) { if (notice != null) pendingStepFreeNotice = notice }
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
        currentRoadText = null      // 간략엔 링크가 없다(iOS 동형)
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
        announce(withExitLead(spoken), highPriority = droppedWaypoint, speechClass = GuideSpeechClass.actionable)   // 안내 방식이 바뀐 사실
    }

    private fun syncStartRequestWithSession() {
        val request = lastStartRequest ?: return
        val dest = dest ?: return
        // 요청 축·줄 종류도 세션 현재값 — 수동 전환(E42)이 넷을 함께 바꾸므로 시작 시점 값은 낡는다(iOS 동형, A13).
        lastStartRequest = when (request) {
            is WalkStartRequest -> request.copy(
                dest = dest, label = destinationLabel, accessible = accessible, variant = sessionVariant,
                line = sessionLine, alternate = alternateLine, waypoint = waypoint, exitLead = exitHold?.lead,
            )
            is CarStartRequest -> request.copy(dest = dest, label = destinationLabel, waypoint = waypoint)
        }
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
            minutes = etaMinutes(route, target.meters, toWaypoint = true)
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
        // 횡단 중엔 남은 거리 행이 횡단보도 끝까지의 거리다(E62 판정 4). 10m 단위라 행 문자열도 그때만 바뀐다.
        remainingText = liveCrossingText ?: joinText(distancePart, timePart)
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
        etaMinutes(route, max(0.0, route.totalMeters - state.d), toWaypoint = false)

    /**
     * 목표 잔여(m)까지의 시간(분) — 총 소요의 잔여 비례(iOS `etaMinutes`의 walk 갈래). 근거 없으면 null(3-state). 목표를 이미 밟은
     * 값(1m 미만)에 "약 1분"을 붙이지 않는다(N4 설계 리뷰 #11).
     */
    private fun etaMinutes(route: GuideRoute, remainingMeters: Double, toWaypoint: Boolean): Int? {
        if (remainingMeters < 1) return null
        if (sessionKind == GuideSessionKind.car) {
            // 자동차는 재조회 ETA 카운트다운이다(iOS 동형). 그 ETA는 목적지까지라 경유지 목표에는 없다(N4 §4.1 — 날조 금지).
            if (toWaypoint) return null
            val eta = etaSeconds ?: return null
            val at = etaUpdatedAt ?: return null
            return max(1, (max(0.0, eta - (clock() - at)) / 60).roundToInt())
        }
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
        val kind = sessionKind
        // 자동차는 임박 임계(속도 함수)와 같은 시점에 "잠시 후"로 넘어간다(K2 §4, iOS `turnApproachMeters`). 도보는 상수 그대로.
        val turnApproach = if (kind == GuideSessionKind.car) turnApproachMeters(state.speedSamples, tuning) else walkTurnApproachMeters
        val out = guideLiveRows(liveRowsState, displayUnits, state.d, liveBaselineD, state.phase, turnApproach)
        liveRowsState = out.state
        // 돌아가기 국면의 윗줄은 벗어난 쪽(E63, 상태 행과 같은 문장) — 없으면 종전 문장.
        liveTopText = out.top?.let { if (it == LiveTopRow.OffRoute) offRouteLine ?: text.liveTop(it, kind) else text.liveTop(it, kind) }
        liveNextText = out.next?.let { text.liveNext(it, kind) }
        // 횡단 중 남은 거리 행(E62 판정 4) — `updateRemaining`이 남은 거리 행에 쓴다(같은 fix에서 뒤에 불린다).
        liveCrossingText = out.crossingRemaining?.let(text::crossingRemaining)
    }

    private fun resetLiveRowsBaseline(state: GuideState) {
        liveBaselineD = state.d
        liveRowsState = null
        refreshLiveRows(state)
    }

    private fun clearLiveRows() {
        liveTopText = null
        liveNextText = null
        liveCrossingText = null
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
        val out = motionStep(motionState, MotionSample(fix.lat, fix.lng, fix.accuracy, now), fix.speed, fix.speedAccuracy, maxSpeedMps)
        motionState = out.state
        return out.motion
    }

    /** 수단별 물리 상한(정지 판정 폴백의 산출 속도 가드, iOS `maxSpeedMps`). */
    private val maxSpeedMps: Double
        get() = if (sessionKind == GuideSessionKind.car) MotionConstants.maxCarSpeedMps else MotionConstants.maxWalkSpeedMps

    /** 수단별 closer 최소 간격 — 차량은 데드밴드를 매 fix 넘어 2초 창에 매번 걸린다(iOS `closerIntervalSeconds`). */
    private val closerIntervalSeconds: Double
        get() = if (sessionKind == GuideSessionKind.car) ToneLayerConstants.carCloserIntervalSeconds else ToneLayerConstants.walkCloserIntervalSeconds

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
            // 출구 대기(E84): 관측 공백 뒤 앵커에서 벗어난 fix(세션 첫 fix 포함)는 무이동 시계와 진행 앵커를 다시 세운다(직전 fix 시각을 덮기 전에 본다).
            // 같은 자리 fix로는 세우지 않는다(Kit 주석).
            val holdStartedAt = startedAt
            if (exitHold != null && holdStartedAt != null) {
                val step = exitHoldIdleFloorsAfterFix(
                    exitHoldIdleFloors, now = now, previousFixAt = lastFixAt, startedAt = holdStartedAt,
                    distanceFromAnchor = sessionProgressAnchor?.let { haversineMeters(it.lat, it.lng, fix.lat, fix.lng) },
                )
                exitHoldIdleFloors = step.floors
                if (step.resumed) sessionProgressAnchor = RoutePoint(fix.lat, fix.lng)
            }
            lastFixAt = now
            noteSessionProgress(fix.lat, fix.lng, now)
            if (routeFetchJob == null) {
                val candidate = RouteOriginFix(fix.lat, fix.lng, fix.accuracy, age)
                // 출구 대기(E84) 창이면 그 판정이 먼저다. 창을 버린 fix만 아래 종전 판정으로 이어 간다.
                val hold = exitHold
                if (hold != null && handleExitHoldFix(candidate, fix, hold, dest, now)) return
                when (val decision = routeOriginStep(routeOriginBest, candidate)) {
                    is RouteOriginDecision.Fetch -> {
                        fixWaitJob?.cancel(); fixWaitJob = null
                        startRouteFetch(decision.fix, "accepted", dest, routeFetchToken)
                    }
                    is RouteOriginDecision.Wait -> {
                        if (decision.best != routeOriginBest) routeOriginBestAt = now
                        routeOriginBest = decision.best
                        GuideDiag.log { "routeOriginWait acc=${fmt("%.1f", fix.accuracy)} age=${fmt("%.1f", age)} best=${decision.best?.let { fmt("%.1f", it.accuracy) } ?: "-"}" }
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
            "brief t=${fmt("%.1f", now)} lat=${fmt("%.6f", fix.lat)} lng=${fmt("%.6f", fix.lng)} acc=${fmt("%.1f", fix.accuracy)} motion=$motion age=${fmt("%.1f", age)} usable=$usable dist=${fmt("%.1f", haversineMeters(fix.lat, fix.lng, dest.lat, dest.lng))} nearby=${beaconState.nearby}"
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
            GuideDiag.log { "arrivalWindowEnter mode=brief dist=${fmt("%.1f", straightDistance)} acc=${fmt("%.1f", fix.accuracy)}" }
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
                    closerIntervalSeconds = closerIntervalSeconds,
                ),
                arrived = beaconState.nearby,
            ),
            now,
        )
        gated.notice?.let { notice ->
            val spoken = noticeText(notice)
            statusText = spoken
            if (notice !is BeaconNotice.Weak) lastGuidance = spoken
            announce(spoken, speechClass = beaconNoticeSpeechClass(notice))
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
        lastFixAccuracy = fix.accuracy
        lastFixMeasuredAt = fix.elapsedRealtimeMs / 1000.0
        noteSessionProgress(fix.lat, fix.lng, now)

        // 멈추면 침묵(E62 판정 3) — `speedUnknown`은 정지가 아니다(E55 3-state).
        val out = guideStep(state, GuideFix(fix.lat, fix.lng, fix.accuracy, stopped = motion == MotionState.stopped), route, now, tuning)
        guideState = out.state
        // 돌아가기 국면의 상태 행 문장(E63) — 아래 하단 2행 갱신보다 먼저(같은 fix의 윗줄이 이 문장이어야 한다). 벗어난 쪽만(위원장 판정
        // 2026-10-04): 시계 방향은 몸을 돌리면 곧 거짓이 되는데 이 행은 시트 착지·전경 복귀 상환이 나중에 다시 읽는다.
        (out.event as? GuideEvent.OffRoute)?.let { offRouteLine = text.offRouteSide(it.side) }
        // 지난 임박 문장은 상태 행에 남기지 않는다(전경 복귀 상환이 지난 회전을 다시 읽는다, E62 a11y M1).
        imminentStatus?.let { (target, pendingText) ->
            if (out.state.stepIndex >= target) {
                if (statusText == pendingText) statusText = ""
                imminentStatus = null
            }
        }
        when (out.event) {
            is GuideEvent.BackOnRoute, GuideEvent.Reacquired -> { liveBaselineD = out.state.d; liveRowsState = null }
            else -> Unit
        }
        refreshLiveRows(out.state)
        // 자동차 "현재 도로" 행(E56) — 진행거리를 믿을 수 있는 국면에서만 옮긴다(iOS 동형).
        if (sessionKind == GuideSessionKind.car && (out.state.phase == GuidePhase.following || out.state.phase == GuidePhase.bundle)) {
            refreshCurrentRoad(out.state)
        }
        syncOverview()
        GuideDiag.log {
            val votes = out.state.courseVotes
            "fix t=${fmt("%.1f", now)} lat=${fmt("%.6f", fix.lat)} lng=${fmt("%.6f", fix.lng)} acc=${fmt("%.1f", fix.accuracy)} " +
                "course=${fmt("%.1f", fix.course)} courseAcc=${fmt("%.1f", fix.courseAccuracy)} speed=${fix.speed?.let { fmt("%.2f", it) } ?: "-"} speedAcc=${fix.speedAccuracy?.let { fmt("%.2f", it) } ?: "-"} " +
                "motion=$motion age=${fmt("%.1f", age)} phase=${out.state.phase} d=${fmt("%.1f", out.state.d)} event=${out.event ?: "-"} " +
                "perp=${out.perpMeters?.let { fmt("%.1f", it) } ?: "-"} edgeHits=${out.state.windowEdgeHits} " +
                "derived=${out.derivedCourse?.let { fmt("%.1f±%.1f", it.bearing, it.uncertaintyDeg) } ?: "-"} vote=${out.courseVote?.rawValue ?: "-"} " +
                "axes=d:${out.state.offRouteAxes.distance}/c:${out.state.offRouteAxes.course} " +
                "votes=m:${votes.count { it.vote.rawValue == "mismatch" }}/k:${votes.count { it.vote.rawValue == "match" }}/u:${votes.count { it.vote.rawValue == "unknown" }} " +
                "verdict=${courseAxisVerdict(votes).rawValue} " +
                // 돌아가기 국면 계측(E63 spec §6): 부호 있는 수직(오른쪽 +), 돌아가기 상태(최솟값/연속 수/복귀 후보 초/기준점 m), 접근 표 제외.
                "sperp=${out.signedPerpMeters?.let { fmt("%.1f", it) } ?: "-"} " +
                "ret=${if (out.state.phase == GuidePhase.offRoute) returnDiag(out.state, fix.lat, fix.lng, now) else "-"}" +
                (if (out.approachExcluded == true) " appr=1" else "")
        }
        val remaining = max(0.0, route.totalMeters - out.state.d)
        val jumped = out.projectionJumped == true
        if (out.event == GuideEvent.FinalApproachEnter) {
            beginFinalApproach(FinalApproachEntry.routeEnd, fix)
            if (inFinalApproach) handleFinalApproach(fix, motion, age, now)
            return
        }
        // 이탈 중 도착 창 — 두 번째 입구(A70 spec §4.2). 진입 fix에서 `handleFinalApproach`를 돌리지 않는다: 단발 fix 하나로 도착을 선언하지
        // 않고 「목적지 근처입니다」 한 번만 말한다(설계 리뷰 high ②). 도착은 다음 fix부터 종전 최종 접근 그대로다.
        if (out.event == GuideEvent.NearDestination) {
            beginFinalApproach(FinalApproachEntry.offRoute, fix)
            announceNearDestination()
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
                    motion = motion, closerIntervalSeconds = closerIntervalSeconds,
                ) else null,
            ),
            now,
        )
        val event = out.event
        if (event == null) syncStatusTextWithPhase(out.state.phase)
        else consume(event, route, prev = state, signedPerp = out.signedPerpMeters, now = now)
        // E69 ⓒ: 이벤트 소비 뒤(확정 fix의 회차 래치 초기화가 먼저).
        stepRerouteStill(out.state.phase, motion == MotionState.stopped, now)
    }

    /**
     * E69 ⓒ: 벗어난 채 `GuideFix.stopped`가 30초 이어지면 버튼 래치를 조용히 세운다(새 정지 판정 금지 — 같은 술어, iOS 동형). 리듀서 국면이
     * 돌아가기인 fix만 센다 — uncertain·reacquiring(정확도 악화·공백) fix에서 연속을 비워 끊긴 시간이 정지로 산입되지 않게(E63 spec §3.9).
     */
    private fun stepRerouteStill(phase: GuidePhase, stopped: Boolean, now: Double) {
        if (!offRoute || phase != GuidePhase.offRoute) { offRouteStillSince = null; return }
        val still = RerouteProposalGate.stillStep(offRouteStillSince, stopped, now)
        offRouteStillSince = still.since
        if (still.reached) raiseRerouteButton("still", speak = false)
    }

    /**
     * E69: 자동 판정이 손을 든 순간 버튼 래치를 세운다. 조회 실패·예산(ⓐⓑ)은 한 문장, 정지(ⓒ)는 침묵. 문장은 회차에 한 번이고(재무장으로
     * 실패가 되풀이돼도), 버려졌으면 다음 ⓐⓑ에서 다시 말한다. 포커스는 옮기지 않고 상태 행도 그대로다(윗줄은 리듀서가 소유하는 이탈 문장). iOS 동형.
     */
    private fun raiseRerouteButton(cause: String, speak: Boolean) {
        if (!rerouteGaveUp) {
            rerouteGaveUp = true
            GuideDiag.log("rerouteButton cause=$cause")
        }
        if (!speak || rerouteGaveUpSpoken) return
        rerouteGaveUpSpoken = true
        announce(strings.get("guide.rerouteAutoGaveUp"), speechClass = GuideSpeechClass.actionable) { rerouteGaveUpSpoken = false }
    }

    /** 이벤트 없이 국면만 바뀐 fix의 상태 텍스트를 되돌린다(재획득 문구일 때뿐, 통지 없음). */
    private fun syncStatusTextWithPhase(phase: GuidePhase) {
        if (phase != GuidePhase.offRoute || statusText != strings.get("guide.reacquiring")) return
        statusText = offRouteLine ?: strings.get("guide.offRoute")
    }

    /** `prev`·`signedPerp`·`now`는 이탈 계측 로그(E63 spec §6) 재료다 — 판정에 쓰지 않는다. */
    private fun consume(event: GuideEvent, route: GuideRoute, prev: GuideState, signedPerp: Double?, now: Double) {
        // 분류(E53 spec §3.2)는 Kit이 정본 — 이탈은 회차 첫 발화(`firstSpoken`)만 행동 문장(재통지는 주기).
        val cls = guideEventSpeechClass(event)
        when (event) {
            is GuideEvent.AnnounceSteps -> {
                // 결정 지점까지의 실위치 거리를 앞에 단다(위원장 판정 2026-10-03 — 직진 주기 통지 다음에 "…에서 돌아"가
                // 거리 없이 나오면 안내가 튄다, iOS 동형). 재통독은 거리 없이 원문만.
                val state = guideState
                val first = event.indices.firstOrNull()?.let { route.steps.getOrNull(it) }
                val unit = text.unit(route, event.indices)
                // 늦은 전문(E62 R4·R5 — 실위치가 이미 첫 스텝에 들어섰다)엔 머리말이 없다(램프인 구간 누출 차단).
                // 머리말은 도보만 — 자동차는 유닛 문장 원문이다(iOS `sessionKind == .walk` 조건).
                val spoken = if (!event.late && state != null && first != null && sessionKind == GuideSessionKind.walk) {
                    text.announceAhead(route, event.indices, spokenRemainingMeters(first.startD - state.d, state.d, liveBaselineD))
                } else unit
                // 억제 복구 시점에 이미 들어섰으면 회전 문장을 뗀 문장으로 갚는다(E62).
                val entered = first?.let { RecoveryEntered(it.startD, text.rereadUnit(route, event.indices, liveSteps)) }
                announceUnitText(unit, spoken, cls, entered)
            }
            // 되읽기는 구간 안에서 다시 읽는 자리다 — 들어선 첫 스텝의 회전 문장을 뗀다(E62 문안 확정본).
            is GuideEvent.BundleReread -> text.rereadUnit(route, event.indices, liveSteps).let { announceUnitText(it, it, cls, entered = null) }
            is GuideEvent.Imminent -> {
                if (event.stage > 0) return
                // 횡단 임박은 건너는 방향을 싣는다(E62 — 서버 `crossingClock`, 없으면 종전 문장).
                val clock = event.indices.firstOrNull()?.let { liveSteps.getOrNull(it)?.crossingClock }
                // 자동차 동승자는 그 결정 지점 스텝의 지점·방면을 싣는다(K2 §6.3·E61, iOS 동형).
                val spoken = if (sessionKind == GuideSessionKind.car) {
                    text.carImminentText(event.action, event.indices.firstOrNull()?.let { route.steps.getOrNull(it)?.carLandmark }, dataLocale() == DataLocale.en)
                } else text.imminentText(event.action, clock)
                statusText = spoken
                // 이 문장은 그 지점 앞에서만 참이다 — 그 스텝에 들어서면 상태 행에서 지운다(`handleDetail`, E62 a11y M1).
                imminentStatus = event.indices.firstOrNull()?.let { it to spoken }
                if (!outputSuppressed) announce(spoken, speechClass = cls)
            }
            is GuideEvent.FarNotice -> {
                // 원거리 예고(자동차만 — walk 프로파일은 farNoticeM = null). 크로싱 시점 실측 잔여를 낭독하고, 실행 안내와 같은 취급(억제
                // 복구 대상, iOS 동형).
                val spoken = text.farNotice(route, event.indices, event.remainingMeters)
                lastGuidance = spoken
                statusText = spoken
                if (outputSuppressed) { pendingRecovery = spoken; pendingRecoveryEntered = null } else announce(spoken, speechClass = cls)
            }
            is GuideEvent.Periodic -> {
                // 낭독 숫자는 실위치 잔여다(위원장 판정 2026-10-03 — 하단 2행과 같은 기준, iOS 동형).
                // 자동차는 리듀서 잔여 그대로 단문(K2 §6.3 — "{거리} 직진하다가 [지점에서 ]우회전").
                val spoken = if (sessionKind == GuideSessionKind.car) {
                    text.periodicCar(route, event.stepIndex, event.remainingMeters, event.accuracy, destinationLabel, dataLocale() == DataLocale.en)
                } else {
                    val meters = guideState?.let {
                        max(0, spokenRemainingMeters(event.remainingMeters.toDouble(), it.d, liveBaselineD).roundToInt())
                    } ?: event.remainingMeters
                    text.periodicWalk(route, event.stepIndex, meters, event.accuracy, destinationLabel, liveSteps.getOrNull(event.stepIndex)?.target)
                }
                lastGuidance = spoken
                mutate { copy(statusText = spoken, statusIsNextPreview = true) }
                announce(spoken, speechClass = cls)
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
                if (outputSuppressed) { pendingRecovery = spoken; pendingRecoveryEntered = null } else announce(spoken, speechClass = cls)
            }
            is GuideEvent.WaypointApproaching -> {
                // 경유지 접근 예고(N4 spec §4.1): 1회, 톤 없음. 실행 안내가 아니라 `lastGuidance`는 덮지 않고, `statusText`에도
                // 두지 않는다(남은 거리 행이 같은 정보를 실시간으로 보이고, 전경 복귀 상환이 낡은 거리를 읽게 된다). 억제 중이면
                // 보관하지 않는다 — 거리 문장은 시간이 지나면 거짓(주기 통지와 같은 취급).
                val label = routeWaypointLabel ?: return
                if (!outputSuppressed) announce(strings.get("directions.viaRemaining", label, formatDistance(event.remainingMeters)), speechClass = cls)
            }
            GuideEvent.FinalApproachEnter -> Unit // fix를 쥔 handleDetail이 가른다
            GuideEvent.NearDestination -> Unit // 위와 같다 — 이탈 중 입구(A70 §4.2)도 handleDetail이 소비하고 반환한다
            is GuideEvent.OffRoute -> {
                // 확정(`confirm`)은 돌아가기 국면의 시작이다 — 재조회가 아니다(E63). 재조회는 리듀서 `RerouteNeeded`가 연다(iOS walk 갈래 동형).
                // 표시 상태의 회차 시작은 `notice == confirm`, 문장 분류의 "처음 말함"은 `firstSpoken`(§4.1).
                if (event.notice == OffRouteNotice.confirm) {
                    offRouteNoticeLive.clear()
                    rerouteTriggerCount = 0
                    offRouteConfirmedAt = now
                    offRouteConfirmCoord = lastFixCoord
                    // 새 회차는 버튼 없이 시작한다 — 앱이 돌아가게 할지 새 길을 찾을지 판정하는 중이다(E69).
                    rerouteGaveUp = false
                    rerouteGaveUpSpoken = false
                    offRouteStillSince = null
                }
                offRoute = true
                val spoken = text.offRoute(event.guidance, event.side, event.returnRelDeg, sessionKind)
                // 보류는 말하지 않는다 — 상태 행은 `handleDetail`이 먼저 정한 문장(벗어난 쪽만).
                statusText = offRouteLine.orEmpty()
                logOffRouteNotice(event, signedPerp?.let(::abs), spoken = spoken != null)
                if (spoken != null) postOffRouteNotice(spoken, cls)
            }
            is GuideEvent.BackOnRoute -> {
                offRouteEndedByReroute = false
                offRoute = false
                offRouteLine = null
                clearProposal()
                // 리듀서가 이 회차에 이탈 문장을 냈고 ∧ 실제로 게시했을 때만 말한다(E63 §3.4). 아니면 이벤트만 — 상태 행은 현행 안내.
                val say = event.spoken && offRouteNoticePosted
                offRouteNoticeLive.clear()
                GuideDiag.log {
                    "backOnRoute via=${prev.offRouteReason?.rawValue ?: "-"} perp=${signedPerp?.let { fmt("%.1f", it) } ?: "-"} " +
                        "hold=${prev.returnCandidateSince?.let { fmt("%.1f", now - it) } ?: "-"} spoken=${if (say) 1 else 0}"
                }
                if (!say) { statusText = currentGuidance().orEmpty(); return }
                val spoken = strings.get("guide.backOnRoute")
                statusText = spoken
                resultHaptic(ResultHapticKind.success)
                // high: iOS `.high`(복귀가 "경로 다시 조회" 버튼을 지워 커서가 움직인다)와 같은 판별선. 안드로이드 전경 발화는 늘 말하는 중인
                // 문장을 끊어 차이가 없고, 실효는 백그라운드 대기 칸에서 앞 문장을 선점하는 것이다(README §3 안내 음성 채널).
                announce(spoken, highPriority = true, speechClass = cls)
            }
            is GuideEvent.RerouteNeeded -> {
                // 돌아가기 국면에서 계속 멀어지거나 나란히 계속 걸었다(E63 §3.5·판정 J4) — 자동 조회·채택.
                rerouteTriggerCount += 1
                val ignored = maybeFetchProposal("auto")
                // 예산 소진으로 요청을 무시하는 순간이 "판정했는데 실행할 수 없다"는 자리다(E69 ⓑ).
                if (ignored == "budget") raiseRerouteButton("budget", speak = true)
                GuideDiag.log {
                    val here = lastFixCoord
                    val moved = offRouteConfirmCoord?.let { a -> here?.let { fmt("%.0f", haversineMeters(a.lat, a.lng, it.lat, it.lng)) } } ?: "-"
                    val anchor = prev.offRouteAnchor?.let { a -> here?.let { fmt("%.0f", haversineMeters(a.lat, a.lng, it.lat, it.lng)) } } ?: "-"
                    // 리듀서는 요청 fix에서 최솟값을 그 fix 값으로 다시 놓는다 — `min`은 직전 최솟값, `perp`는 이 fix 값.
                    "rerouteTrigger reason=${event.reason.rawValue} n=$rerouteTriggerCount min=${prev.offRouteMinPerp?.let { fmt("%.1f", it) } ?: "-"} " +
                        "perp=${signedPerp?.let { fmt("%.1f", abs(it)) } ?: "-"} sinceConfirm=${offRouteConfirmedAt?.let { fmt("%.0f", now - it) } ?: "-"} " +
                        "moved=$moved anchor=$anchor ignored=${ignored ?: "-"}"
                }
            }
            GuideEvent.UncertainEnter -> { statusText = strings.get("guide.uncertain"); announce(statusText, speechClass = cls) }
            GuideEvent.UncertainExit, GuideEvent.Reacquired -> {
                statusText = strings.get("guide.uncertainRecovered")
                // 자동차는 **재획득** 뒤 지금 유닛 전문을 함께 읽는다 — 전역 재투영 뒤라 다음 경계까지 침묵하지 않게(K2 §3.4). 복귀(uncertainExit)엔
                // 붙이지 않는다(복귀 fix는 d를 갱신하지 않아 stepIndex가 공백 전 스텝이다, iOS spec 리뷰 B2).
                val gs = guideState
                if (event == GuideEvent.Reacquired && sessionKind == GuideSessionKind.car && gs != null) {
                    announce("$statusText ${text.unit(route, unitAt(route, gs.stepIndex))}", speechClass = GuideSpeechClass.actionable)
                } else {
                    announce(statusText, speechClass = cls)
                }
            }
            GuideEvent.Reacquiring -> { statusText = strings.get("guide.reacquiring"); announce(statusText, speechClass = cls) }
            GuideEvent.SpeedSuggest -> Unit
        }
    }

    /**
     * 실행 안내 — 상태 행은 비운다(직전 예고를 남기면 이미 돈 회전을 남은 것처럼 읽는다). 억제 중이면 최신 1개 보관.
     * `unit`은 되읽기용 원문(`lastGuidance`·억제 복구), `spoken`은 지금 말하는 문장이다. 거리 머리말(`announceAhead`)은
     * 그 순간에만 참이라 되읽기에 싣지 않는다 — 복귀·신호 불량 뒤에 "약 20m 앞"을 갚으면 지난 거리를 말한다. `entered`는 복구 시점에
     * 이미 그 유닛에 들어섰을 때 대신 읽을 문장(E62, 전문만 — 되읽기는 이미 들어선 문장이라 null).
     */
    private fun announceUnitText(unit: String, spoken: String, speechClass: GuideSpeechClass, entered: RecoveryEntered?) {
        lastGuidance = unit
        lastGuidanceEntered = entered
        statusText = ""
        if (outputSuppressed) { pendingRecovery = unit; pendingRecoveryEntered = entered } else announce(spoken, speechClass = speechClass)
    }

    /** 진단 로그 수치 — 기기 로케일과 무관하게 점 소수(fr·es·it 쉼표 소수면 iOS 로그와 대조가 어긋난다). */
    private fun fmt(pattern: String, vararg args: Any?): String = String.format(Locale.ROOT, pattern, *args)

    /** 지금 상태로 다시 읽을 마지막 안내 — 실위치(원시 d + lag)가 그 유닛 첫 스텝에 들어섰으면 회전 문장을 뗀 문장(억제 복구와 같은 판정). */
    private fun currentGuidance(): String? {
        val entered = lastGuidanceEntered
        val gs = guideState
        return if (entered != null && gs != null && gs.d + projectionLagMeters >= entered.startD) entered.text else lastGuidance
    }

    /** 이탈 문장 게시(E63 §3.4): 게시 번호를 살아 있는 집합에 넣고, 버려지면 그 번호만 뺀다(회차가 바뀌었으면 집합이 이미 비었다). */
    private fun postOffRouteNotice(message: String, speechClass: GuideSpeechClass) {
        offRouteNoticeSeq += 1
        val id = offRouteNoticeSeq
        offRouteNoticeLive += id
        announce(message, speechClass = speechClass) { offRouteNoticeLive -= id }
    }

    /** 이탈 통지 계측 한 줄(E63 spec §6). `spoken`은 말할 문장을 냈는가(보류 구분 — 게시 실패는 `bgSpeech` 줄). */
    private fun logOffRouteNotice(event: GuideEvent.OffRoute, perp: Double?, spoken: Boolean) = GuideDiag.log {
        val heading = guideState?.lastHeading
        "offRouteNotice notice=${event.notice.rawValue} first=${if (event.firstSpoken) 1 else 0} reason=${event.reason.rawValue} " +
            "guidance=${event.guidance.rawValue} side=${event.side?.rawValue ?: "-"} rel=${event.returnRelDeg?.let { fmt("%.0f", it) } ?: "-"} " +
            "clock=${event.returnRelDeg?.let { clockHour(it).toString() } ?: "-"} " +
            "heading=${heading?.let { fmt("%.0f±%.0f", it.bearing, it.uncertaintyDeg) } ?: "-"} headAge=${heading?.let { fmt("%.1f", clock() - it.at) } ?: "-"} " +
            "perp=${perp?.let { fmt("%.1f", it) } ?: "-"} d=${guideState?.offRouteConfirmD?.let { fmt("%.1f", it) } ?: "-"} spoken=${if (spoken) 1 else 0}"
    }

    /** `ret=` 열(E63 spec §6): 최솟값/자격 fix 연속 수/복귀 후보 유지 초/나란히 걷기 기준점까지 직선 m(0이면 그 fix에서 다시 놓였다). */
    private fun returnDiag(st: GuideState, lat: Double, lng: Double, now: Double): String {
        val minPerp = st.offRouteMinPerp?.let { fmt("%.1f", it) } ?: "-"
        val hold = st.returnCandidateSince?.let { fmt("%.0f", now - it) } ?: "-"
        val anchor = st.offRouteAnchor?.let { fmt("%.0f", haversineMeters(it.lat, it.lng, lat, lng)) } ?: "-"
        return "$minPerp/${st.offRouteAwayRun?.count ?: 0}/$hold/$anchor"
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

    /** 최종 접근 입구 — 경로 종점 도달(첫 번째)과 이탈 중 목적지 직선거리 창(A70 §4, 두 번째). */
    private enum class FinalApproachEntry { routeEnd, offRoute }

    /**
     * 진입 처리 — 플래그와 거리 축만 바꾸고 **말하지 않는다**. `routeEnd`의 첫 발화는 같은 fix의 `handleFinalApproach`, `offRoute`는
     * [announceNearDestination]. `offRoute`는 셋이 다르다: 종점 기하 서술은 이탈 중엔 거짓이라 "냈음"으로 두고, 기하가 없어도 간략 인계로
     * 빠지지 않으며(이미 목적지 30m 안), 돌아가기 국면의 흔적(이탈 플래그·상태 행·재조회 버튼 회차 래치)을 지운다.
     */
    private fun beginFinalApproach(entry: FinalApproachEntry, fix: GuideFixPayload) {
        clearProposal()
        resetAlternativePreview()   // 문 앞에서 다른 줄로 전환하면 최종 접근이 풀린다(iOS 동형)
        abandonReroute()            // 이미 떠난 전환(낡음 폴백)·재조회가 진입 뒤 커밋되면 같은 이유로 최종 접근이 풀린다
        remainingText = null
        currentRoadText = null      // 스텝은 전부 소화됐다 — 남은 것은 직선 안내뿐(iOS 동형)
        etaJob?.cancel(); etaJob = null
        clearLiveRows()
        rebaseForAxisChange()
        if (entry == FinalApproachEntry.offRoute) {
            // `BackOnRoute` 소비와 같은 정리 + 재조회 버튼 회차 래치. 진행 중 자동 조회는 위 `clearProposal`이 세대를 올려 채택을 막는다.
            offRouteEndedByReroute = false
            offRoute = false
            offRouteLine = null
            offRouteNoticeLive.clear()
            offRouteStillSince = null
            rerouteGaveUp = false
            rerouteGaveUpSpoken = false
            inFinalApproach = true
            finalApproachIntroSpoken = true   // 종점 기하 서술은 이탈 중엔 거짓이다 — 래치를 "냈음"으로 두어 끝까지 내지 않는다
            pendingFinalApproachIntro = null
            val now = clock()
            lastFinalTickAt = now
            resetArrivalWindow()
            arrivalWindowEnteredAt = now
            val c = lastFixCoord
            val d = dest
            if (c != null && d != null) lastUsableDistanceToDest = haversineMeters(c.lat, c.lng, d.lat, d.lng)
            syncOverview()
            GuideDiag.log {
                "finalEnter entry=offRoute dist=${lastUsableDistanceToDest?.let { fmt("%.1f", it) } ?: "-"} acc=${fmt("%.1f", fix.accuracy)}"
            }
            return
        }
        val usable = finalApproachGeometry?.takeIf { it.unavailableReason != BearingUnavailable.tooClose }
        // 자동차는 기하 없이도 국면에 들어간다(`entersFinalApproachWithoutGeometry`, iOS spec 2026-08-31 §2) — 아니면 `carArrivalStep`에
        // 영영 닿지 않는다(K2-a 실사고). 진입 서술은 기하가 있어야 성립하므로 `handleFinalApproach`가 null 기하에서 스스로 건너뛴다.
        if (usable == null && !tuning.entersFinalApproachWithoutGeometry) {
            GuideDiag.log("briefHandoff reason=${if (finalApproachGeometry == null) "noGeometry" else "tooClose"}")
            resetArrivalWindow()
            mode = GuideMode.brief
            syncOverview()
            val spoken = strings.get("guide.handoff")
            statusText = spoken
            announce(spoken, speechClass = GuideSpeechClass.actionable)
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
        GuideDiag.log { "finalEnter offset=${usable?.let { fmt("%.1f", it.offsetMeters) } ?: "-"}" }
    }

    /** 이탈 중 입구의 유일한 발화(A70 §4.2) — 기하 서술도 도착도 아니다. 억제로 못 낸 문장은 진입 서술과 같은 상환 칸으로 갚는다. */
    private fun announceNearDestination() {
        val spoken = strings.get("guide.finalApproachNear")
        statusText = spoken
        lastGuidance = spoken
        liveTopText = spoken
        resultHaptic(ResultHapticKind.attention)
        // high: 이 진입이 "경로 다시 조회" 버튼을 지운다 — `BackOnRoute`와 같은 판별선(iOS `.high` 동형, 구현 리뷰 M1).
        announce(spoken, highPriority = true, speechClass = GuideSpeechClass.actionable) { pendingFinalApproachIntro = spoken }
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
        // 자동차는 "부근 정차"가 도착이다(K2 §6.4 — 40m·정지·정확도 ≤ 30, 15m 무조건 분기 없음).
        val arrived = if (sessionKind == GuideSessionKind.car) carArrivalStep(distance, fix.accuracy, motion)
        else walkFinalApproachArrived(distance, fix.accuracy) // 정확도 상한 50m(A70 안전 검토 M1)
        GuideDiag.log { "final t=${fmt("%.1f", now)} dist=${fmt("%.1f", distance)} acc=${fmt("%.1f", fix.accuracy)} arrived=$arrived introSpoken=$finalApproachIntroSpoken" }
        routeTone(
            ToneLayerInput(
                trend = TrendInput(
                    distance = distance, deadBand = max(BeaconConstants.baseDeadBand, fix.accuracy), deadBandFloor = fix.accuracy,
                    motion = motion, closerIntervalSeconds = closerIntervalSeconds,
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
            announce(spoken, speechClass = GuideSpeechClass.actionable) { pendingFinalApproachIntro = spoken }
            return
        }
        if (arrived) {
            // prewalk(승차 전 도보)는 stop() 앞에서 캡처 — stop()이 지운다(A25 §4.2).
            val prewalk = prewalkTarget
            val spoken = prewalk?.let { transitText.render(transitPrewalkArrivedLine(isEn = transitGuideIsEn(dataLocale()), station = it)) }
                ?: strings.get("guide.arrived")
            // 수단은 stop() **앞**에서 캡처한다 — stop()이 수단을 도보로 되돌린다(iOS 설계 리뷰 B10). 자동차는 걸음 요약이 없다.
            val endedKind = sessionKind
            val sample = if (endedKind == GuideSessionKind.walk) steps.liveSample else null
            playTone(BeaconTone.nearby)
            pendingEndReason = BeaconEndReason.arrived
            stop()
            // prewalk는 종료 화면을 남기지 않는다 — 승차역은 여정의 끝이 아니고, 남기면 `screen`의 도보 우선순위가 대중교통 시트를 영구 은폐한다.
            if (prewalk == null) presentEndScreen(dest, SessionEndKind.arrived, spoken, sample, endedKind)
            statusText = spoken
            lastGuidance = spoken
            liveTopText = spoken
            announce(spoken, highPriority = true, speechClass = GuideSpeechClass.actionable)
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
        announce(spoken, speechClass = GuideSpeechClass.deferrable)
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
        // 승차 전 도보(prewalk)는 제외 — fix 두절 5분은 대개 지하 역사 진입이고, 그때 끝내면 바로 그 경우를 위한 「승차역 도착」 선언까지 사라진다(A25 spec §2).
        if (!isTracking || endsWithoutScreen) return false
        val startedAt = startedAt ?: return false
        // 무이동 축은 도착 추정이 발동할 수 있는 동안(도착 창 ∧ 마지막 확인 거리 ≤ 거리 캡) 늦게 켠다(`sessionIdleStationaryElapsed`,
        // 나들이 spec §9, iOS 동형) — 그대로면 추정 도착을 선점하고, 끄면 실내 지터가 10m 앵커를 밀어 두 판정 모두 영영 안 끝난다.
        // 두절 축은 그대로.
        val presumedArrivalCanFire = inArrivalWindow &&
            (tuning.presumedArrival?.let { (lastUsableDistanceToDest ?: Double.POSITIVE_INFINITY) <= it.maxDistanceMeters } ?: false)
        // 판정은 Kit 한 자리(`exitHoldAwareSessionIdleStep`): 두절 임계는 수단별 데이터이고, 출구 대기(E84) 창과 그 하한이 없으면 종전 식(무이동 유예
        // → `sessionIdleStep`)과 값이 같다. 창 동안은 두절 임계가 길고 관측이 끊긴 동안 무이동을 세지 않으며, 창이 닫히면 두 시계가 그 시각부터 새로 흐른다.
        val reason = exitHoldAwareSessionIdleStep(
            now = now, startedAt = startedAt, lastFixAt = lastFixAt, lastProgressAt = sessionLastProgressAt,
            floors = exitHoldIdleFloors, holdActive = exitHold != null, tuning = tuning, presumedArrivalCanFire = presumedArrivalCanFire,
        ) ?: return false
        GuideDiag.log("sessionIdleEnd reason=${reason.rawValue}")
        val spoken = strings.get("guide.endedIdle")
        stopLeavingSummary(playStopTone = env.isForeground(), text = spoken)
        statusText = spoken
        lastGuidance = spoken
        liveTopText = spoken
        announce(spoken, highPriority = true, speechClass = GuideSpeechClass.deferrable)   // 안전망 종료는 백그라운드에서 말하지 않는다(E53 코디네이터 판정 — 복귀 상환이 갚는다)
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
        GuideDiag.log { "presumedArrival reason=${reason.rawValue} dist=${lastUsableDistanceToDest?.let { fmt("%.1f", it) } ?: "-"} window=${if (inFinalApproach) "final" else "brief"}" }
        val prewalk = prewalkTarget  // stop() 앞 캡처(A25 §4.2)
        val spoken = prewalk?.let { transitText.render(transitPrewalkArrivedLine(isEn = transitGuideIsEn(dataLocale()), station = it)) }
            ?: strings.get("guide.arrivedPresumed")
        val endedKind = sessionKind
        val sample = if (endedKind == GuideSessionKind.walk) steps.liveSample else null
        if (env.isForeground()) playTone(BeaconTone.nearby)
        pendingEndReason = BeaconEndReason.arrived
        stop()
        if (prewalk == null) presentEndScreen(dest, SessionEndKind.presumed, spoken, sample, endedKind)
        statusText = spoken
        lastGuidance = spoken
        liveTopText = spoken
        // 사후 정리(도착 3~5분 뒤)라 미룸. 단 승차 전 도보의 승차역 도착은 이어질 안내의 시작이라 행동 문장이다(spec §3.2 — prewalk 도착 행).
        announce(spoken, highPriority = true, speechClass = if (prewalk == null) GuideSpeechClass.deferrable else GuideSpeechClass.actionable)
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

    // ─────────────────────────── 자동차 (M5 spec §4) ───────────────────────────

    /**
     * "현재 도로" 행(E56) — 현재 진행거리가 속한 링크에서 직접 유도한다(스텝 문장을 읽지 않는다, 한 안내 구간 안에서 도로가 바뀌는 스텝이
     * 있다). 진행 상황의 "{도로} 주행 중"과 같은 함수라 두 곳이 어긋나지 않는다. 이름을 모르면 null(줄 없음).
     */
    private fun refreshCurrentRoad(state: GuideState) {
        currentRoadText = roadNameAt(roadSpans, state.d)?.let { strings.get("guide.currentRoad", it) }
    }

    /** 갚은 발화(억제 복구·전경 복귀 상환)도 리듀서의 직전 발화로 적는다 — 정숙 시간(경유지 접근 예고)이 그 문장을 끊지 않게(자동차만). */
    private fun noteRepaidAnnouncement() {
        guideState = guideState?.copy(lastAnnouncedAt = clock())
    }

    /** 자동차 ETA 주기 재조회 타이머(6분, E80 §4.6). 상한 소진·간략 전환·최종 접근이면 그 회차가 아무것도 하지 않는다. */
    private fun startEtaTimer() {
        etaJob?.cancel()
        etaJob = scope.launch {
            while (true) {
                delay(carEtaIntervalSeconds * 1000)
                refreshCarEta()
            }
        }
    }

    /**
     * 6분 재조회 한 회차(iOS `refreshCarEta`). 이탈 중엔 동결한다(낡은 경로 기준 ETA는 거짓). 횟수는 조회 전에 센다(원점을 못 얻은 회차도 한
     * 회, iOS 동형). 원점은 세션의 마지막 상세 fix이고 iOS `currentCoordinate()` 추적 중 재사용 게이트와 같은 술어(정확도 ≤ 30m·측정 뒤
     * 60초 이내)를 지나야 한다 — 못 지나면 조용히 직전 값 유지(낡음 판정은 `etaUpdatedAt`이 맡는다). 응답은 세대 토큰이 같을 때만 커밋한다.
     */
    private suspend fun refreshCarEta() {
        if (sessionKind != GuideSessionKind.car || !isTracking || mode != GuideMode.detail) return
        if (etaCallCount >= carEtaCallCap) return
        if (guideState?.phase == GuidePhase.offRoute) return
        val dest = dest ?: return
        etaCallCount += 1
        val token = routeFetchToken
        val origin = lastFixCoord
        val measuredAt = lastFixMeasuredAt
        if (origin == null || !canReuseCachedFix(lastFixAccuracy, measuredAt?.let { clock() - it }, LocationFixPolicy.freshTTL)) {
            GuideDiag.log("carEta origin=stale")
            return
        }
        val via = waypoint?.let { RoutePoint(it.dest.lat, it.dest.lng) }
        val briefing = runCatching {
            withTimeoutOrNull(queryTimeoutMs) {
                withContext(io) { routes.car(origin.lat, origin.lng, dest.lat, dest.lng, lang = dataLocale().rawValue, via = via, traffic = true) }
            }
        }.getOrNull() ?: return
        // 세대 일치 커밋 — 중지·재조회·목적지 변경 뒤 도착한 응답은 버린다.
        if (token != routeFetchToken || !isTracking || mode != GuideMode.detail || this.dest != dest || briefing.durationSeconds <= 0) return
        etaSeconds = briefing.durationSeconds.toDouble()
        etaUpdatedAt = clock()
        val route = guideRoute ?: return
        val state = guideState ?: return
        updateRemaining(route, state)
        announceNewCarJam(route, state, briefing)
    }

    /**
     * 새 정체 한 문장(E80 spec §5, iOS `announceNewCarJam`): 지금 경로 위·앞쪽이고 아는 정체와 겹치지 않는 것 중 가장 가까운 하나만. 순서가
     * 계약이다 — ① 정보는 Tmap만 센다(카카오 폴백은 코드표·경로가 달라 오보) ② 응답을 기다리는 사이 이탈했으면 아무것도 바꾸지 않는다
     * ③ 기준선이 없으면 이번 정보를 말없이 기준선으로 ④ 보류 중인 통지가 있거나 안내 음성이 말하는 중이면 건너뛴다(아는 정체에 넣지 않아
     * 다음 재조회가 다시 판정 — 회전 명령을 6분 재조회 문장이 자르면 안 된다). 버려지면 알린 하나를 되돌린다.
     */
    private fun announceNewCarJam(route: GuideRoute, state: GuideState, briefing: CarRouteBriefing) {
        if (briefing.provider != "tmap") return
        val fresh = briefing.congestion?.jams ?: return
        if (state.phase == GuidePhase.offRoute) return
        val known = knownCarJams
        if (known == null) {
            knownCarJams = fresh.map { KnownCarJam(it.start, it.end) }
            GuideDiag.log("carJams baseline=${fresh.size}")
            return
        }
        val out = newCarJamsAhead(route.polyline, route.totalMeters, state.d, known, fresh)
        val busy = !announcementsSettled()
        GuideDiag.log("carJams fresh=${fresh.size} new=${if (out.nearest == null) 0 else 1} busy=$busy")
        val nearest = out.nearest ?: return
        if (busy) return
        val added = out.known.lastOrNull() ?: return
        knownCarJams = out.known
        GuideDiag.log("carNewJam ahead=${nearest.aheadMeters} len=${nearest.jam.lengthMeters}")
        announce(text.carNewJam(nearest.jam, nearest.aheadMeters, dataLocale() == DataLocale.en), speechClass = GuideSpeechClass.actionable, onDropped = {
            val list = knownCarJams ?: return@announce
            val i = list.lastIndexOf(added)
            if (i >= 0) knownCarJams = list.toMutableList().also { it.removeAt(i) }
        })
    }

    // ─────────────────────────── 시트 컨트롤 ───────────────────────────

    fun progressText(): String {
        val route = guideRoute
        val state = guideState
        if (mode == GuideMode.detail && route != null && state != null) {
            val straight = if (state.phase == GuidePhase.offRoute || state.phase == GuidePhase.finalApproach) freshStraightLineMeters() else null
            val base = text.progress(
                route, state, destinationLabel, lastGuidance, straight, etaMinutesNow(route, state), liveSteps.getOrNull(state.stepIndex)?.body,
                walk = sessionKind == GuideSessionKind.walk,
            )
            if (sessionKind != GuideSessionKind.car || !(state.phase == GuidePhase.following || state.phase == GuidePhase.bundle)) return base
            // 자동차(§4-7): 현재 링크 도로명 + 진행 + ETA 낡음 병기(3-state — 낡은 값을 지금 값처럼 말하지 않는다).
            val etaAge = etaUpdatedAt?.let { clock() - it }
            return joinText(
                roadNameAt(roadSpans, state.d)?.let { strings.get("guide.carRoadNow", it) },
                base,
                etaAge?.takeIf { it > carEtaStaleSeconds }?.let { strings.get("guide.etaStale", (it / 60).roundToInt().toString()) },
            )
        }
        freshStraightLineMeters()?.let { return strings.get("beacon.first", formatDistance(it.roundToInt())) }
        return lastGuidance ?: strings.get("guide.noGuidanceYet")
    }

    /** 간략 세션의 진행 상황 발화(시트 버튼 응답 — 상세는 조망 페이지가 대신한다). 비-SR 사용자에게도 보이게 상태 행에 둔다. */
    fun announceProgress() {
        val spoken = progressText()
        statusText = spoken
        announce(spoken, highPriority = true, speechClass = GuideSpeechClass.actionable)
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
            if (result == null) {
                if (switchTo == null) GuideDiag.log("rerouteAdopt source=button result=${if (fetched.isFailure) "failed" else "none"} headClock=-")
                rerouteFailed()
                return
            }
            // 전환 커밋: 경로 교체와 같은 원자 블록에서만 세션 축·줄 종류가 바뀐다.
            if (switchTo != null) commitLineSwitch(switchTo)
            val firstIndices = commitReroutedRoute(result)
            if (switchTo == null) GuideDiag.log("rerouteAdopt source=button result=adopted headClock=-")
            val notice = consumeStepFreeNotice(result.stepFreeRaw, result.stepFree, result.stepFreeNotice)
            val summary = if (switchTo != null) text.variantSwitch(result.route, firstIndices, result.lineKind ?: switchTo) else text.reroute(result.route, firstIndices)
            // 사용자가 누른 조회는 첫 점이 멀어도 거부하지 않고 알린다(A70 §2.3) — 측정 기준은 마지막 fix, 없으면 조회 출발점.
            val away = routeStartAwayNotice(result.route, lastFixCoord ?: origin)
            val spoken = listOfNotNull(away, notice, summary).joinToString(" ")
            statusText = spoken
            resultHaptic(ResultHapticKind.success)
            announce(spoken, highPriority = true, speechClass = GuideSpeechClass.actionable) { if (notice != null) pendingStepFreeNotice = notice }
            if (switchTo != null) mutate { copy(variantAdoptedSeq = variantAdoptedSeq + 1) }
        } finally {
            if (token == rerouteToken) { rerouteInFlight = false; isRerouting = false; isSwitchingVariant = false }
        }
    }

    private fun rerouteFailed() {
        lastStepFree = null
        statusText = strings.get("guide.rerouteFailed")
        resultHaptic(ResultHapticKind.failure)
        announce(statusText, highPriority = true, speechClass = GuideSpeechClass.actionable)
    }

    /** 재조회·자동 채택 공통의 성공 커밋 — 경로·기준선·이탈 표결·finalApproach·표시 유닛을 한 지점에서 원자 교체. */
    private fun commitReroutedRoute(fetched: DetailFetchResult): List<Int> {
        clearProposal()
        resetAlternativePreview()   // 경로 교체는 프리뷰 비교 기준(잔여·대안)도 무효화한다(iOS spec 2026-08-14 §3)
        guideRoute = fetched.route
        routeWaypointLabel = if (fetched.route.waypointStepIndex == null) null else waypoint?.label
        guideRouteDurationSeconds = fetched.durationSeconds
        roadSpans = fetched.roadSpans
        // 새 경로가 본 정체도 아는 정체다(E80 §5) — 재경로 문장이 이미 나간 자리라 따로 말하지 않는다.
        fetched.jams?.let { jams -> knownCarJams = knownCarJams.orEmpty() + jams.map { KnownCarJam(it.start, it.end) } }
        if (sessionKind == GuideSessionKind.car) {
            // 재조회도 ETA 캡에 든다(iOS §4.6) + 새 경로 기준 원자 교체.
            etaCallCount = minOf(carEtaCallCap, etaCallCount + 1)
            fetched.durationSeconds?.takeIf { it > 0 }?.let { etaSeconds = it.toDouble(); etaUpdatedAt = clock() }
        }
        resetFinalApproach(fetched.finalApproach)
        val initial = initialGuideState(
            fetched.route, clock(), hasFinalApproachGeometry = fetched.finalApproach != null,
            courseDerivation = guideState?.courseDerivation ?: initialDerivationState,
            // 진행 방위 관측도 궤적의 사실이다 — 새 경로의 돌아가기·재통지 판정이 냉시동하지 않게(E63 spec §4.2).
            lastHeading = guideState?.lastHeading,
        )
        guideState = initial.state
        offRouteEndedByReroute = true
        offRoute = false
        offRouteLine = null
        updateRemaining(fetched.route, initial.state)
        displayUnits = buildDisplayUnits(fetched.liveSteps)
        liveSteps = fetched.liveSteps
        resetLiveRowsBaseline(initial.state)
        if (sessionKind == GuideSessionKind.car) refreshCurrentRoad(initial.state)
        syncOverview()
        lastGuidance = text.unit(fetched.route, initial.firstIndices)
        return initial.firstIndices
    }

    /**
     * 자동 조회 트리거(E63): 리듀서 `RerouteNeeded` 소비 지점(이탈 확정은 조회가 아니다). 활성 조건: 상세 ∧ 최종 접근 전 ∧ 진행 중 자동·수동
     * 조회 없음 ∧ 세션 상한 미달. 반환 = 무시한 사유(로그), null이면 조회를 열었다(iOS `maybeFetchProposal(source:)` 동형).
     */
    private fun maybeFetchProposal(source: String): String? {
        if (!isTracking || mode != GuideMode.detail || inFinalApproach || rerouteInFlight) return "state"
        if (proposalInFlightToken == proposalToken) return "inflight"
        if (!RerouteProposalGate.mayFetch(proposalFetchCount)) return "budget"
        proposalToken += 1
        proposalFetchCount += 1
        val token = proposalToken
        proposalInFlightToken = token
        scope.launch {
            try { fetchProposal(token, source) } finally { if (proposalInFlightToken == token) proposalInFlightToken = null }
        }
        return null
    }

    private suspend fun fetchProposal(token: Int, source: String) {
        val dest = dest ?: return
        val origin = rerouteOrigin() ?: run {
            // 출발점(15초 안의 fix)이 없으면 조회하지 않는다 — 트리거 줄 뒤에 채택 줄이 비지 않게 남긴다(iOS `result=failed` 동형).
            GuideDiag.log("rerouteAdopt source=$source result=failed headClock=-")
            if (token == proposalToken && offRoute && isTracking && mode == GuideMode.detail) raiseRerouteButton("failed", speak = true)
            return
        }
        val acquiredAt = clock()
        if (token != proposalToken || !offRoute || !isTracking || mode != GuideMode.detail || this.dest != dest) return
        val waypointAtFetch = waypoint
        val fetched = runCatching { fetchDetailData(origin, dest, sessionVariant, accessible, waypointAtFetch) }
        if (token != proposalToken || !offRoute || !isTracking || mode != GuideMode.detail || rerouteInFlight || this.dest != dest || this.waypoint != waypointAtFetch) return
        // 조회 실패·경로 없음은 돌아가기 국면을 잇는다 — 리듀서가 문턱을 다시 채우면 또 요청한다(E63 §3.5 재무장, 세션 예산 5회가 상한).
        // 버튼은 이 순간 선다(E69 ⓐ).
        val result = fetched.getOrNull()
        if (result == null) {
            val cause = if (fetched.isFailure) "failed" else "none"
            GuideDiag.log("rerouteAdopt source=$source result=$cause headClock=-")
            raiseRerouteButton(cause, speak = true)
            return
        }
        val proposal = RerouteProposal(originLat = origin.lat, originLng = origin.lng, acquiredAt = acquiredAt)
        val c = lastFixCoord
        val at = lastFixCoordAt
        if (c == null || at == null || clock() - at > freshFixSeconds || !RerouteProposalGate.isFresh(proposal, clock(), c.lat, c.lng, tuning.rerouteMaxDriftM)) {
            GuideDiag.log("rerouteAdopt source=$source result=stale headClock=-")
            raiseRerouteButton("stale", speak = true)
            return
        }
        // 새 경로 첫 점이 현재 위치에서 멀면 채택하지 않는다(A70 §2.2 — 요청이 신선해도 provider가 출발점을 멀리 붙인다).
        // `stale`과 같은 결말이다(E69 ⓐ): 버튼 + 한 번 통지, 돌아가기 국면은 잇는다.
        if (!RerouteProposalGate.routeStartsNearby(result.route, c.lat, c.lng, tuning.rerouteMaxDriftM)) {
            GuideDiag.log { "rerouteAdopt source=$source result=farStart gap=${fmt("%.0f", RerouteProposalGate.routeStartGapMeters(result.route, c.lat, c.lng))} headClock=-" }
            raiseRerouteButton("farStart", speak = true)
            return
        }
        // 새 경로 첫 문장의 방향 머리말(E63 §3.7): 교체 **전** 세션의 진행 방위 기준 새 경로 첫 15m의 시.
        // 도보만 — 자동차의 진행 방위로 도는 방향을 말하지 않는다(iOS `sessionKind == .walk` 조건).
        val headClock = if (sessionKind == GuideSessionKind.walk) guideState?.let { rerouteHeadClock(it, result.route, clock(), tuning) } else null
        GuideDiag.log("rerouteAdopt source=$source result=adopted headClock=${headClock ?: "-"}")
        val firstIndices = commitReroutedRoute(result)
        val notice = consumeStepFreeNotice(result.stepFreeRaw, result.stepFree, result.stepFreeNotice)
        val lines = text.autoReroute(result.route, firstIndices, liveSteps, headClock)
        val spoken = if (notice != null) "$notice ${lines.spoken}" else lines.spoken
        // 상태 행은 머리말을 뺀 문장(A57) — 음성만 그 순간의 방향을 말한다.
        statusText = if (notice != null) "$notice ${lines.statusLine}" else lines.statusLine
        rerouteStatusVoice = statusText to spoken
        resultHaptic(ResultHapticKind.success)
        announce(spoken, highPriority = true, speechClass = GuideSpeechClass.actionable) { if (notice != null) pendingStepFreeNotice = notice }
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
        // 자동차 경로 종속 상태(iOS `reacquireRoute` 동형) — 옛 목적지의 도로·정체·ETA가 새 목적지로 새지 않게.
        currentRoadText = null
        roadSpans = emptyList()
        knownCarJams = null
        etaJob?.cancel(); etaJob = null
        etaSeconds = null; etaUpdatedAt = null; etaCallCount = 0
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
            announce(strings.get("android.guide.altPreviewNone"), speechClass = GuideSpeechClass.actionable)
            return
        }
        altPreviewState = AltPreviewState.Ready(RerouteProposal(originLat = origin.lat, originLng = origin.lng, acquiredAt = acquiredAt), fetched)
        // 완료 신호 polite 1회 — 헤더는 조용히 갱신되므로 이 통지가 없으면 결과 도착을 알 길이 없다.
        announce(altPreviewHeaderText(), speechClass = GuideSpeechClass.actionable)
    }

    private fun failAlternativePreview(token: Int) {
        if (token != altPreviewToken) return
        altPreviewState = AltPreviewState.Failed
        announce(strings.get("android.guide.altPreviewFailed"), speechClass = GuideSpeechClass.actionable)
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
        if (c != null && at != null && clock() - at <= freshFixSeconds && RerouteProposalGate.isFresh(ready.proposal, clock(), c.lat, c.lng, tuning.rerouteMaxDriftM)) {
            commitLineSwitch(target)
            val firstIndices = commitReroutedRoute(ready.fetched)
            val notice = consumeStepFreeNotice(ready.fetched.stepFreeRaw, ready.fetched.stepFree, ready.fetched.stepFreeNotice)
            val summary = text.variantSwitch(ready.fetched.route, firstIndices, ready.fetched.lineKind ?: target)
            val away = routeStartAwayNotice(ready.fetched.route, c)
            val spoken = listOfNotNull(away, notice, summary).joinToString(" ")
            statusText = spoken
            resultHaptic(ResultHapticKind.success)   // 폴백(재조회) 경로의 성공과 같은 신호 — 같은 사건을 두 경로가 다르게 알리지 않는다
            announce(spoken, highPriority = true, speechClass = GuideSpeechClass.actionable) { if (notice != null) pendingStepFreeNotice = notice }
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
        GuideDiag.log { "watchdog dt=${fmt("%.1f", now - reference)}" }
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
        announce(statusText, speechClass = GuideSpeechClass.deferrable)
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
                announce(spoken, speechClass = GuideSpeechClass.actionable)   // 1회성 경고
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
            // 1회성 경고 — 상태 행에 실어(소리 무음 경고와 같은 꼴) 볼륨 0인 백그라운드에서 버려져도 전경 복귀 상환이 갚는다. 래치는 되돌리지 않는다
            // (되돌리면 버려질 때마다 다음 톤에서 진동이 되풀이된다).
            val spoken = strings.get("android.guide.mediaVolumeZero")
            statusText = spoken
            announce(spoken, speechClass = GuideSpeechClass.actionable)
        } else if (!zero) {
            mediaVolumeNoticed = false
        }
    }

    /** 자동 통지 창구. `speechClass`(E53 spec §3.2)는 기본값이 없다 — 새 통지 경로가 분류를 빠뜨리면 컴파일이 멈춘다. */
    private fun announce(message: String, highPriority: Boolean = false, speechClass: GuideSpeechClass, onDropped: (() -> Unit)? = null) =
        deferredAnnouncer.announce(message, highPriority, speechClass, onDropped)

    /** 사용자 활성화의 직접 응답 전용 즉시 창구. */
    fun announceNow(message: String, highPriority: Boolean = false, bypassSuppression: Boolean = false) =
        deferredAnnouncer.announceNow(message, highPriority, bypassSuppression)

    /**
     * 안내가 낸 문장이 모두 끝났는가(E57 spec §3.3) — 톤 뒤로 미룬 문장이 없고 안내 TTS가 말하고 있지 않다. 안내 시트의 첫 정보 행 착지가 이것을
     * 기다린다(착지 낭독이 시작 요약·복귀 상환과 겹치지 않게). 안드로이드는 안내 문장이 TTS 한 채널이라 끝을 발화 완료 콜백으로 직접 안다 — iOS의 게시
     * 장부(`GuideAnnouncementLedger`)가 필요 없다. 앱의 다른 통지(탭 상태 줄)는 세지 않는다.
     */
    fun announcementsSettled(): Boolean = !deferredAnnouncer.hasPending && !deviceSpeech.hasPending && !speaker.isSpeaking

    /**
     * 채널 선택(E53 spec §2, 판정은 :kit `guideSpeechChannel`) — 게시 시점 상태로. 안드로이드 매핑: `voiceOver` = 전경 직접 발화(안내 문장 채널은 TTS
     * 하나라 접근성 통지가 없다 — 그래서 `voiceOverRunning`·`foregroundDeviceSpeech`가 거짓이면 전경은 늘 이 갈래), `device` = 백그라운드(잠금·다른 앱)
     * 행동 문장, `drop` = 백그라운드의 주기·상태 문장과 토글 끔(효과음만). 가청은 미디어 볼륨 0이 아닌가(M4의 `isBackgroundAudible` 대체 축).
     */
    private fun speechChannel(speechClass: GuideSpeechClass): GuideSpeechChannel = guideSpeechChannel(
        foreground = env.isForeground(),
        voiceOverRunning = false,
        speechClass = speechClass,
        backgroundSpeechEnabled = BackgroundSpeech.isEnabled(store.getString(BackgroundSpeech.storageKey)?.toBooleanStrictOrNull()),
        backgroundAudible = !tones.isMediaVolumeZero,
        foregroundDeviceSpeech = false,
    )

    /**
     * 실제 게시 — 억제 가드 → 채널 선택 → 발화. 발화 포트 호출은 여기(전경 직접 발화)와 대기 칸 배선 둘뿐이다(소스 가드 ④). 백그라운드에서 버리는
     * 문장은 **발화만** 막는다(`statusText`·`lastGuidance`는 호출부가 이미 갱신 — 복귀 시 화면이 최신이다). 대기 칸이 나중에 문장을 버리면 장부를
     * 되살린다(교체 `superseded`는 상환 표식을 세우지 않는다 — 마지막 상태는 더 새 문장이 전했다).
     */
    private fun post(message: String, highPriority: Boolean, bypassSuppression: Boolean, speechClass: GuideSpeechClass, onLateDrop: (() -> Unit)?): Boolean {
        if (!bypassSuppression && outputSuppressed) return false
        val channel = speechChannel(speechClass)
        if (!env.isForeground()) GuideDiag.log { "bgSpeech channel=${channel.rawValue} class=${speechClass.rawValue} text=$message" }
        if (channel == GuideSpeechChannel.drop) { missedAnnouncement = true; return false }
        var spoken = spokenDistanceUnits(message, strings.get("android.unit.spokenMeters"))
        val owesFocusDenied = pendingFocusDenied && !tones.focusDenied
        if (owesFocusDenied) {
            pendingFocusDenied = false
            spoken = strings.get("android.guide.focusDenied") + " " + spoken
        }
        if (channel == GuideSpeechChannel.voiceOver) {
            val ok = speakTracked(spoken, highPriority) != null
            syncTtsUnavailable()
            if (!ok) {
                // 장부 복원 — "지우고, 못 내면 되돌린다"(다른 장부와 같은 계약).
                if (owesFocusDenied) pendingFocusDenied = true
                missedAnnouncement = true
            }
            return ok
        }
        // 들은 문장을 복귀 때 또 말하지 않는다(E53 §4.3) — 백그라운드에서 말했으면 마지막 상태를 들었다.
        missedAnnouncement = false
        deviceSpeech.submit(spoken, highPriority, protected = false, bypassSuppression = bypassSuppression, speechClass = speechClass) { reason ->
            if (owesFocusDenied) pendingFocusDenied = true
            if (reason == DeviceSpeechDrop.undelivered) missedAnnouncement = true
            syncTtsUnavailable()
            onLateDrop?.invoke()
        }
        syncTtsUnavailable()
        return true
    }

    /** TTS 초기화 전에 보류된 문장이 초기화 실패·언어 미지원으로 버려졌다 — 전경 복귀 상환이 현재 상태를 다시 낸다. */
    fun onSpeechDropped(token: Int) {
        // 다른 모델이 게시한 보류 문장(예: 승차 전 도보 시작 문장은 대중교통이 낸다)의 버림은 이 모델의 상환이 아니다(M5 §6-5).
        if (token != lastSpeechToken) return
        missedAnnouncement = true
        syncTtsUnavailable()
    }

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
        /** 자동차 ETA 재조회 주기·세션 상한(시작 조회 포함)·낡음 판정(iOS `carEta*`, E80 §4.6). */
        const val carEtaIntervalSeconds = 360L
        const val carEtaCallCap = 10
        const val carEtaStaleSeconds = 420.0
    }
}

/**
 * 도보 세션이 끝난 사유(iOS `BeaconModel.EndReason`) — `onSessionEnd`로 `GuideSession`에 전달된다. `locationLost`는 걷던 중 위치 상실(`stopAndFail`) — 환승
 * 도보(E73)는 이 사유에서만 대중교통으로 돌아간다(위원장 판정 2026-10-19). `ended`(그 밖의 정지)와 갈라 두어야 종료 경로가 늘어도 다른 정지가 재개로 새지 않는다.
 */
enum class BeaconEndReason { arrived, startFailed, userStopped, locationLost, ended }

/** 승차 전 도보 정지 꼬리(A54·E73, iOS `PrewalkStopTail`). `transitResumes`는 환승 도보의 위치 상실 꼬리다 — `stopAndFail`만 고른다. */
enum class PrewalkStopTail { transitNotStarted, transitAlsoEnded, transitResumes }

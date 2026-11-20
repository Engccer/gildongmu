package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.kit.BackgroundSpeech
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.BeaconTone
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.DeferredAnnouncer
import space.dodoplanet.gildongmu.kit.DeviceSpeechDrop
import space.dodoplanet.gildongmu.kit.DeviceSpeechQueue
import space.dodoplanet.gildongmu.kit.GuideSessionCoordinator
import space.dodoplanet.gildongmu.kit.GuideSpeechChannel
import space.dodoplanet.gildongmu.kit.GuideSpeechClass
import space.dodoplanet.gildongmu.kit.KeyValueStore
import space.dodoplanet.gildongmu.kit.RouteService
import space.dodoplanet.gildongmu.kit.TransitBackgroundToneSource
import space.dodoplanet.gildongmu.kit.TransitBoardedCause
import space.dodoplanet.gildongmu.kit.TransitDisplayLeg
import space.dodoplanet.gildongmu.kit.TransitGuideEvent
import space.dodoplanet.gildongmu.kit.TransitGuideInput
import space.dodoplanet.gildongmu.kit.TransitGuideLeg
import space.dodoplanet.gildongmu.kit.TransitGuideRoute
import space.dodoplanet.gildongmu.kit.TransitGuideState
import space.dodoplanet.gildongmu.kit.TransitGuideTone
import space.dodoplanet.gildongmu.kit.TransitLock
import space.dodoplanet.gildongmu.kit.TransitExpressVerdict
import space.dodoplanet.gildongmu.kit.transitUnreachableReason
import space.dodoplanet.gildongmu.kit.transitLaneForItem
import space.dodoplanet.gildongmu.kit.transitLegWithLane
import space.dodoplanet.gildongmu.kit.transitReboardStopPickable
import space.dodoplanet.gildongmu.kit.transitTransferWalkTarget
import space.dodoplanet.gildongmu.kit.transitTransferWalkMeters
import space.dodoplanet.gildongmu.kit.transitExpressSkipsAlightLine
import space.dodoplanet.gildongmu.kit.subwayIdForOdsayLine
import space.dodoplanet.gildongmu.kit.TransitOverview
import space.dodoplanet.gildongmu.kit.TransitPhase
import space.dodoplanet.gildongmu.kit.TransitPositionService
import space.dodoplanet.gildongmu.kit.TransitPrewalkTarget
import space.dodoplanet.gildongmu.kit.TransitSignal
import space.dodoplanet.gildongmu.kit.TransitStatusPhase
import space.dodoplanet.gildongmu.kit.TransitToneState
import space.dodoplanet.gildongmu.kit.TransitTrackItem
import space.dodoplanet.gildongmu.kit.TransitTrackMode
import space.dodoplanet.gildongmu.kit.TransitTrackPoll
import space.dodoplanet.gildongmu.kit.TransitTrackResolvedStop
import space.dodoplanet.gildongmu.kit.TransitTrackService
import space.dodoplanet.gildongmu.kit.TransitWaitingEmptyReason
import space.dodoplanet.gildongmu.kit.TransitWalkLegText
import space.dodoplanet.gildongmu.kit.buildTransitGuideRoute
import space.dodoplanet.gildongmu.kit.classifyTransitBoardingCandidates
import space.dodoplanet.gildongmu.kit.guideSpeechChannel
import space.dodoplanet.gildongmu.kit.initTransitGuide
import space.dodoplanet.gildongmu.kit.isApproxTransitLock
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.spokenDistanceUnits
import space.dodoplanet.gildongmu.kit.transitAboardCandidates
import space.dodoplanet.gildongmu.kit.transitAlightStopReachedLine
import space.dodoplanet.gildongmu.kit.transitArrivalStatusLine
import space.dodoplanet.gildongmu.kit.transitArrivedAtBoardStopLine
import space.dodoplanet.gildongmu.kit.transitArrivingAtAlightStopLine
import space.dodoplanet.gildongmu.kit.transitArrivingAtBoardStopLine
import space.dodoplanet.gildongmu.kit.transitBoardConfirmLapsedLine
import space.dodoplanet.gildongmu.kit.transitBoardConfirmNeededLine
import space.dodoplanet.gildongmu.kit.transitBoardablePool
import space.dodoplanet.gildongmu.kit.transitBoardedAlightLine
import space.dodoplanet.gildongmu.kit.transitBoardedLine
import space.dodoplanet.gildongmu.kit.transitBoardingContextLine
import space.dodoplanet.gildongmu.kit.transitBoardingDeclareOffered
import space.dodoplanet.gildongmu.kit.transitContextLine
import space.dodoplanet.gildongmu.kit.transitCurrentStationLine
import space.dodoplanet.gildongmu.kit.transitDeclaredExpressVerdict
import space.dodoplanet.gildongmu.kit.transitDisplayLeg
import space.dodoplanet.gildongmu.kit.transitEventProfile
import space.dodoplanet.gildongmu.kit.transitEventSpeechClass
import space.dodoplanet.gildongmu.kit.transitExitBoundLine
import space.dodoplanet.gildongmu.kit.transitExpressStatusLine
import space.dodoplanet.gildongmu.kit.transitFindLockedItem
import space.dodoplanet.gildongmu.kit.transitGuideStep
import space.dodoplanet.gildongmu.kit.transitIdlePollLimitMs
import space.dodoplanet.gildongmu.kit.transitLocationLabel
import space.dodoplanet.gildongmu.kit.transitLockIsUnobserved
import space.dodoplanet.gildongmu.kit.transitMessageLabel
import space.dodoplanet.gildongmu.kit.transitPollIntervalMs
import space.dodoplanet.gildongmu.kit.transitProgressOverview
import space.dodoplanet.gildongmu.kit.transitRideLineUnconfirmed
import space.dodoplanet.gildongmu.kit.transitSelectedVehicleLine
import space.dodoplanet.gildongmu.kit.transitToneAllowedInBackground
import space.dodoplanet.gildongmu.kit.transitToneStep
import space.dodoplanet.gildongmu.kit.transitVehiclePassedLine
import space.dodoplanet.gildongmu.kit.transitVehicleSelectedLine
import space.dodoplanet.gildongmu.kit.transitWaitContextLine
import space.dodoplanet.gildongmu.kit.transitWaitingEmptyReason
import space.dodoplanet.gildongmu.kit.withoutWalkBefore
import space.dodoplanet.gildongmu.kit.TransitLabel
import space.dodoplanet.gildongmu.location.LocationPermission
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * 완료 후 도보 핸드오프 신호(A안, §14.2 — 피드백 #6). done의 `stop()`이 세션 상태를 소거하므로 이 값으로 인계 제안이 살아남는다.
 * 한 턴 수명 — 같은 턴에 `GuideSession.acceptWalkHandoff()`가 소비한다(M5 §6-2).
 */
data class TransitWalkHandoff(
    val destinationLabel: String,
    val walkMinutes: Int,
    /** 마지막 구간의 하차 출구 번호(E84). 없으면 null. ⚠ 기본값 없음: 이 값은 정상 완료(`completeOrAdvance`)만 세운다. */
    val exitAlight: String?,
    /** 그 하차역 좌표(E84 다른 역 판정). 좌표가 없으면 null. */
    val alightLat: Double?,
    val alightLng: Double?,
)

/**
 * 환승 도보 인계(E73 spec D3·D4) — 「다음 구간」이 걷기 안내 대상 도보 앞 구간으로 넘어갈 때 대중교통 모델이 세션 소유자에게 넘기는 한 벌.
 * 경로는 처음 경로 전체이고 `legIndex`는 걸어서 닿을 승차 구간이다. (iOS의 `destinationRoman`은 §2-2처럼 없다.)
 */
data class TransitTransferWalkHandoff(
    val route: TransitGuideRoute,
    val legIndex: Int,
    val target: TransitPrewalkTarget,
    val destinationLabel: String,
    val dest: BeaconDest,
    val accessible: Boolean,
    /** 도보 시작 문장 앞에 붙일 한 문장(E78 잘못 내림 복구의 「경로를 바꿨습니다.」). 환승 도보(E73)는 null. */
    val lead: String?,
)

/**
 * 대중교통 실시간 안내 오케스트레이터(iOS `TransitGuideModel` 1:1 미러 — B2 §4·§7, M5 spec 2026-11-20 §6). **판정은 전부 `:kit`이 하고 여기는
 * 배선만 한다**: 상태 머신은 `transitGuideStep`, 폴 대상·주기·잠금·사다리 전부 Kit, 이 클래스는 폴링 I/O·통지 게시·수명만 담당한다. 파일을 기능별로
 * 쪼개지 않는다 — iOS와 줄 단위로 대조하는 것이 이식의 유일한 검증 수단이다(`WalkGuideModel.kt`와 같은 판단).
 *
 * - **단일 비행**: 코루틴 하나가 폴 → 커밋 → delay(적응 주기)를 반복한다. 국면 전이(탑승·전환)는 루프를 재시작해 즉폴한다.
 * - 통지: 잔여 1·도착만 `highPriority`(§6.1 예외 둘 — 놓친 하차의 회수 비용이 커서). 게시 전 코얼레싱은 최신 이벤트가 이전 문자열을 대체하는 구조.
 * - 백그라운드에서도 폴한다(E36). 하는 일은 복귀 낭독과 복귀 즉폴이다.
 * - 세션 단일성: `GuideSessionCoordinator`(도보·자동차와 상호 배제).
 *
 * 단계 2-1(수명·폴·유휴·통지)까지 옮겼다. 단계 3 몫(승차 중 현재역 E35·버스 정류장 E48·재기준 E76·잘못 내림 복구 E78·목적지 전환·다른 경로)은
 * `// 단계 3: <iOS 함수 이름>` 표식으로 자리만 남겼고(grep으로 전수 회수), 서비스·세션 배선은 `// 단계 4:` 표식이다. 사용자 동작(2-2)은 이 파일 「사용자 액션」 절이다.
 *
 * ⚠ 동기화가 없다 — 메인 스레드에서만 부른다(`scope`도 메인, `DeferredAnnouncer` 계약). 시계는 둘이다: `clock`(단조 초 — 유휴·`DeferredAnnouncer`·계측)과
 * `wallClockMs`(벽시계 epoch ms — 서버 도착 시각·떠난 열차 보존 180초, iOS `nowMs()`·`Date()` 자리).
 */
class TransitGuideModel(
    private val routes: RouteService,
    private val track: TransitTrackService,
    private val position: TransitPositionService,
    internal val strings: Strings,
    private val dataLocale: () -> DataLocale,
    private val controller: GuideForegroundController,
    private val permissions: GuidePermissions,
    internal val tones: GuideTones,
    internal val speaker: GuideSpeaker,
    private val haptics: GuideHaptics,
    private val env: GuideEnvironment,
    private val coordinator: GuideSessionCoordinator,
    private val store: KeyValueStore,
    private val scope: CoroutineScope,
    private val clock: () -> Double,
    private val wallClockMs: () -> Double,
    private val io: CoroutineDispatcher,
) {
    private val _ui = MutableStateFlow(TransitGuideUiState())
    val ui: StateFlow<TransitGuideUiState> = _ui.asStateFlow()
    private inline fun mutate(f: TransitGuideUiState.() -> TransitGuideUiState) = _ui.update { it.f() }

    /** 데이터 언어 축 — 비-ko 로케일은 전부 영문 데이터를 공유한다(iOS `transitGuideIsEn`). */
    private val transitGuideIsEn: Boolean get() = transitGuideIsEn(dataLocale())
    private val renderer = TransitGuideTextRenderer(strings) { transitGuideIsEn }

    // ── 화면 상태(모두 `ui`로 유도 — 동반 변경에 기대지 않는다) ──
    private var state: TransitGuideState?
        get() = _ui.value.state
        set(v) = mutate { copy(state = v) }
    private var userTransitionSeq: Int
        get() = _ui.value.userTransitionSeq
        set(v) = mutate { copy(userTransitionSeq = v) }
    private var route: TransitGuideRoute?
        get() = _ui.value.route
        set(v) = mutate { copy(route = v) }
    private var destinationLabel: String
        get() = _ui.value.destinationLabel
        set(v) = mutate { copy(destinationLabel = v) }
    private var dest: BeaconDest?
        get() = _ui.value.dest
        set(v) = mutate { copy(dest = v) }
    private var accessible: Boolean
        get() = _ui.value.accessible
        set(v) = mutate { copy(accessible = v) }
    private var waitingLive: List<TransitTrackItem>
        get() = _ui.value.waitingLive
        set(v) = mutate { copy(waitingLive = v) }
    private var waitingDeparted: List<TransitDepartedItem>
        get() = _ui.value.waitingDeparted
        set(v) = mutate { copy(waitingDeparted = v) }
    private var waitingReason: TransitWaitingEmptyReason?
        get() = _ui.value.waitingReason
        set(v) = mutate { copy(waitingReason = v) }
    private var pendingWalkHandoff: TransitWalkHandoff?
        get() = _ui.value.pendingWalkHandoff
        set(v) = mutate { copy(pendingWalkHandoff = v) }
    private var idlePaused: Boolean
        get() = _ui.value.idlePaused
        set(v) = mutate { copy(idlePaused = v) }
    private var selectedDescription: TransitLabel?
        get() = _ui.value.selectedDescription
        set(v) = mutate { copy(selectedDescription = v) }
    private var boardingManualAvailable: Boolean
        get() = _ui.value.boardingManualAvailable
        set(v) = mutate { copy(boardingManualAvailable = v) }
    private var boardOverrideIndex: Int?
        get() = _ui.value.boardOverrideIndex
        set(v) = mutate { copy(boardOverrideIndex = v) }
    private var reboardPickerActive: Boolean
        get() = _ui.value.reboardPickerActive
        set(v) = mutate { copy(reboardPickerActive = v) }
    private var aboardStep: TransitAboardStep?
        get() = _ui.value.aboardStep
        set(v) = mutate { copy(aboardStep = v) }
    private var expressBlockedNote: String?
        get() = _ui.value.expressBlockedNote
        set(v) = mutate { copy(expressBlockedNote = v) }

    // ── 여정 훅(E70 §6.3) — 필드만 두고 여정 세션(`and-journey`)이 배선한다 ──
    /** 여정 마지막 leg 완료 콜백 — 역 B를 지정한 여정의 대중교통 단계에만 걸린다. 걸려 있으면 `.done` 갈래가 이것을 **정확히 한 번** 부르고 `pendingWalkHandoff`를 세우지 않는다. */
    var onJourneyRideCompleted: (() -> Unit)? = null
    /** 여정의 대중교통 단계가 `.done` 갈래가 아닌 경로로 끝났을 때(시트 「안내 종료」·그 밖의 `stop()`) 한 번 — 여정 전체 종료(D11). */
    var onJourneyStopped: (() -> Unit)? = null
    /** 여정이면 마지막 leg 버튼의 다음 단계가 걷기인가. null = 여정 아님. */
    var journeyNextIsWalk: Boolean? = null

    // 단계 6: GuideSession.transitPassedPrewalk — 「탔다」(A68)를 세션 소유자에게 알리는 훅. GuideSession 배선(도보 인계 단계)이 건다.
    var onPassedPrewalk: (() -> Unit)? = null
    /**
     * 환승 도보 인계 훅(E73 spec D3, iOS `GuideSession.transitTransferWalk` 자리) — 단계 6이 배선한다. ⚠ iOS와 다르게, 훅이 없으면 인계하지 않고 종전 전진을
     * 그대로 커밋한다(훅 없는 모델이 「다음 구간」을 삼켜 안내가 멈추지 않게).
     */
    var onTransferWalk: ((TransitTransferWalkHandoff) -> Unit)? = null

    // ── keep-alive 판정 값(서비스는 단계 4) ──
    private val _keepAliveWanted = MutableStateFlow<GuideLocationProfile?>(null)
    /** 대중교통 keep-alive 위치 스트림을 원하는가와 그 프로파일(null = 필요 없다). 판정만 하고 서비스를 켜고 끄는 것은 단계 4다. */
    val keepAliveWanted: StateFlow<GuideLocationProfile?> = _keepAliveWanted.asStateFlow()

    /**
     * 조망 디스크립터(Kit 순수 계층) — 세션이 없으면 null.
     * 단계 3: overview 후처리(`transitOverviewApplyingPosition`·`transitOverviewApplyingBusStop` — ridingPosition·busStopMark)가 이 값 위에 얹힌다.
     */
    val overview: TransitOverview?
        get() {
            val s = state ?: return null
            val r = route ?: return null
            return transitProgressOverview(s, r)
        }

    // 단계 3: positionStatusText
    // 단계 3: viaStopHereIndex

    val isTracking: Boolean get() = state != null
    val currentLeg: TransitGuideLeg?
        get() {
            val s = state ?: return null
            val r = route ?: return null
            return r.legs.getOrNull(s.legIndex)
        }

    /** 추세 톤 계층 상태(E15 ②). 판정은 Kit `transitToneStep`, 여기는 재생만. */
    private var toneState = TransitToneState.initial

    /**
     * 발화 지연 슬롯(spec 2026-08-14, `WalkGuideModel` 동형): 안내 효과음이 재생 중이면 그 잔여만큼 통지를 미룬다. 수명 계약(latest-wins·세대·재평가)은
     * Kit 타입이 소유하고 여기는 톤 잔여·실제 게시를 주입만 한다.
     */
    private val deferredAnnouncer = DeferredAnnouncer(
        scope = scope, clock = clock, toneEndsAt = { tones.toneEndsAt }, post = ::post,
    )

    /**
     * 기기 음성 대기 한 칸(E53 spec §4.2) — 모델마다 자기 칸을 만든다(iOS 동형, M5 §6-5). 백그라운드 ∧ 토글 켬의 행동 문장만 여기로 온다. 도보 모델과 같은 안드로이드
     * 매핑이다(`voiceOver` 채널 = 전경 직접 발화라 늘 들린다). ⚠ `speaker.onInterrupted`에 대입하지 않는다 — 그 칸은 도보 모델이 쥐고 있어 덮으면 도보가
     * 망가진다. 끊김 통지는 `speechInterrupted(token, reason)`가 자기 칸으로 넘긴다(토큰 라우팅은 단계 4).
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
        speak = { speaker.speak(it, highPriority = false) },
        stopSpeaking = { speaker.stop() },
        postVoiceOver = { text, high -> speaker.speak(text, high) != null },
    )

    /** 직전 폴 시작의 단조 시각(초) — `pollStart sinceLast=` 계측(A16 미확정 ②). */
    private var lastPollStartAt: Double? = null
    /** 이 폴을 예약한 주기(ms). 즉폴은 null — 로그에 `planned=-`. */
    private var plannedIntervalMs: Int? = null
    private var sessionToken: Int? = null
    private var pollJob: Job? = null
    private var seq = 0

    private class Retained(val item: TransitTrackItem, val lastSeenAtMs: Double)
    private val retained = LinkedHashMap<String, Retained>()

    // 단계 3: reanchor — 서울버스 정류장 재기준(E76 후속 ⓔ)의 되돌림 원본과 세대
    // ⚠ 키는 (legIndex, 대상 정류소) 복합 — legIndex만 쓰면 waiting에서 해석한 승차 정류소가 riding 캐시로 적중해 하차 카운트다운이 승차 정류소 도착을
    // 읽는다(독립 리뷰 BLOCKER).
    private val tagoResolved = HashMap<String, TransitTrackResolvedStop>()
    private val tagoUnsupported = HashSet<String>()
    /** 백그라운드를 거쳤는가 — 복귀 낭독 분기. ⚠ 종전 `pausedInBackground`(백그라운드 = 폴 정지)는 E36(2026-09-11)으로 폐지 — 폴은 국면·주기·유휴만 본다. */
    private var wasBackgrounded = false
    /** 백그라운드에서 게시하지 못한 통지가 있었는가. 복귀 시 **현재 상태 하나만** 낭독한다(spec 2026-09-11 §4.2.4). */
    private var missedAnnouncement = false
    /** 백그라운드를 거쳤는가(기기 음성 복귀 인계용). `wasBackgrounded`와 달리 추적 여부와 무관하게 선다 — 세션이 백그라운드에서 끝나도 말하는 중인 완료 문장을 넘겨야 한다. */
    private var speechBackgrounded = false
    /** 유휴 재개 복귀에서 재개 문장 앞에 실을 인계 문장(`setForeground` → `resumeIfIdle` 한 턴 수명). */
    private var resumePrefix: List<String> = emptyList()
    /** 마지막 사용자 조작의 단조 시각(초) — 유휴 폴 정지 축(spec §4.2.6). 세션 시작·모든 사용자 입력·전경 복귀가 갱신. */
    private var lastUserActionAt: Double = 0.0
    private var keepAliveDeniedLogged = false
    /** 승격 실패("소리가 나지 않는다") 문장 세션당 1회 latch — 판정은 매 톤(M7), 문장은 한 번. */
    private var soundDegradedAnnounced = false
    /** 소리 불가 진동의 세션당 1회 래치(문장 래치와 분리, `start`에서 리셋). */
    private var soundDegradedHapticFired = false
    /** 다음 대기 폴 결과를 직접 응답으로 통지(새로고침, §13.2) — 폴 1회 소비. */
    private var refreshAnnounce = false
    // 단계 3: destChangeToken · altRoutesToken — 목적지 전환·다른 경로 조회의 latest-wins 토큰
    private var aboardDirection: String?
        get() = _ui.value.aboardDirection
        set(v) = mutate { copy(aboardDirection = v) }
    private var aboardStartLandingPending: Boolean
        get() = _ui.value.aboardStartLandingPending
        set(v) = mutate { copy(aboardStartLandingPending = v) }
    /** 이 dispatch의 입력이 `boardAboard`였다 — `boarded(declared)` 통지에 선택 차량 조각을 붙일지의 판별(`firstObservationInStep` 동형). */
    private var aboardBoardInStep = false
    /** 이 세션이 시작한 구간(E73) — 승차 전 도보·처음 시작은 0, 환승 도보 뒤 재개는 그 구간. 「탔다」(A68)는 이 구간을 넘었을 때다. */
    private var sessionStartLeg = 0
    private var firstObservationInStep = false

    private class DroppedText(val text: String, val speechClass: GuideSpeechClass)
    /** 억제 중 `post`가 버린 마지막 자동 문장(latest-wins) — 해제 시 1회 복구. stop()이 지운다. 분류를 함께 둔다(E53 — 복구가 그 문장의 백그라운드 채널을 바꾸지 않게). */
    private var droppedWhileSuppressed: DroppedText? = null

    /**
     * 검색 시트·채팅 TTS가 열린 동안 통지·톤 억제(스펙 §5.4, 받아쓰기 전사 오염 방지). stop()이 무조건 해제한다(잔류 억제로 다음 세션 무음 방지).
     * 소유자 집합은 `GuideSession`이 든다 — 여기는 값 하나.
     */
    var outputSuppressed: Boolean = false
        set(value) {
            field = value
            tones.isSuppressed = value
            // 억제 해제(a11y 감사 W2, 2026-09-02): 억제 중 게시하지 못한 **마지막** 자동 문장을 되살린다. 도착·neverSeen처럼 세션에 1회뿐인 문장은 다음 폴이
            // 대신 말해 주지 않고, 그 문장만이 행동("탑승 변경을 눌러 주세요")을 담는다(memory once-only-warning-delivery-contract).
            val dropped = droppedWhileSuppressed
            if (!value && dropped != null) {
                droppedWhileSuppressed = null
                announce(dropped.text, speechClass = dropped.speechClass)
            }
        }

    // 단계 3: routeService — 목적지 전환·다른 경로·잘못 내림 복구 재조회(생성자 `routes`)

    // MARK: - 세션 수명

    /**
     * 시작. 거부 판정(N1 §2.4)이 route 변환보다 먼저다(설계 리뷰 m2 — 변환 실패가 먼저 조용히 반환하면 요구된 거부 통지조차 없다). `aboard`(E71 지금 탄
     * 열차)는 여정 세션(`and-journey`)이 인자를 더한다(M5 §6-2). `destinationRoman`은 §2-2처럼 세 요청에 함께 더할 때까지 없다(데이터 로케일 ko 전제).
     */
    fun start(route: TransitRoute, destinationLabel: String, dest: BeaconDest, accessible: Boolean) {
        val token = claimSession()
        if (token == null) {
            // 거부는 버튼 활성화의 직접 응답이라 받아쓰기 억제를 우회한다(도보 `requestStart` 동형 — 코드 리뷰 m1).
            announceNow(strings.get("guide.alreadyActive"), highPriority = true, bypassSuppression = true)
            return
        }
        val guideRoute = buildTransitGuideRoute(route)
        if (guideRoute == null) {
            coordinator.release(token)
            return
        }
        beginSession(guideRoute = guideRoute, startLeg = 0, token = token, destinationLabel = destinationLabel, dest = dest, accessible = accessible)
    }

    /**
     * 승차 전 도보(A25 spec 2026-08-30 §4.1)·환승 도보(E73) 뒤의 시작 — `start`와 같은 게이트, 같은 세션 초기화. `startLeg`는 걸어서 닿은 승차 지점의
     * 구간이다. 경로는 언제나 처음 경로 전체다. `prewalkCompleted`가 true면 그 구간의 도보 문맥을 지운 경로로 시작한다(걸어서 도착한 뒤 "도보 5분 이동 후"를
     * 다시 말하면 지난 일을 미래형으로 말하는 거짓). 시작 실패로 넘어온 경우는 false — 사용자는 아직 걷지 않았다. ⚠ 기본값 없음(안전 인자).
     */
    fun startAfterPrewalk(
        guideRoute: TransitGuideRoute, startLeg: Int, destinationLabel: String, dest: BeaconDest, accessible: Boolean, prewalkCompleted: Boolean,
    ) {
        val token = claimSession()
        if (token == null) {
            announceNow(strings.get("guide.alreadyActive"), highPriority = true, bypassSuppression = true)
            return
        }
        if (startLeg !in guideRoute.legs.indices) {
            GuideDiag.log { "transit startAfterPrewalk rejected startLeg=$startLeg legs=${guideRoute.legs.size}" }
            coordinator.release(token)
            return
        }
        beginSession(
            guideRoute = if (prewalkCompleted) withoutWalkBefore(guideRoute, startLeg) else guideRoute,
            startLeg = startLeg, token = token, destinationLabel = destinationLabel, dest = dest, accessible = accessible,
        )
    }

    /** 점유 게이트(iOS `guard !GuideSession.shared.isActive, let token = coordinator.claim`) — 다른 세션이 쥐고 있으면 null. */
    private fun claimSession(): Int? =
        if (coordinator.isActive) null else coordinator.claim(stop = { stop(playStopTone = false) })

    /**
     * 게이트를 지난 뒤의 세션 초기화 공통부(`start`·`startAfterPrewalk`). `startLeg`가 0이 아니면 환승 도보 뒤의 재개다(E73) — 상태는 그 구간의 대기 국면,
     * 시작 통지는 그 구간의 대기 문맥만.
     */
    private fun beginSession(
        guideRoute: TransitGuideRoute, startLeg: Int, token: Int, destinationLabel: String, dest: BeaconDest, accessible: Boolean,
    ) {
        sessionToken = token
        // 단계 3: routeGen
        seq = 0
        retained.clear()
        // 단계 3: reanchor
        tagoResolved.clear()
        tagoUnsupported.clear()
        // 다음 세션의 phaseGen도 0에서 시작한다 — 옛 위치 결박이 같은 세대·열차로 되살아나지 않게.
        // 단계 3: ridingPosition
        // 단계 3: clearBusStop
        // 단계 3: busAlightNotice
        // 단계 3: neverSeenPending
        toneState = TransitToneState.initial
        lastPollStartAt = null
        plannedIntervalMs = null
        deferredAnnouncer.advanceGeneration()
        deviceSpeech.reset()  // 기기 음성 대기 칸도 같은 경계(E53 §4.2 ⑤)
        wasBackgrounded = false
        missedAnnouncement = false
        soundDegradedAnnounced = false
        soundDegradedHapticFired = false
        keepAliveDeniedLogged = false
        lastUserActionAt = clock()
        sessionStartLeg = startLeg
        val initial = initTransitGuide(route = guideRoute, startingAt = startLeg, now = nowMs())
        // E71 R8(지금 탄 열차에서 시작)은 여정 세션이 더한다 — 여기선 종전 대기 시작뿐이다.
        aboardDirection = null
        aboardStartLandingPending = false
        mutate {
            copy(
                pendingWalkHandoff = null,
                route = guideRoute,
                destinationLabel = destinationLabel,
                dest = dest,
                accessible = accessible,
                state = initial,
                idlePaused = false,
                waitingLive = emptyList(),
                waitingDeparted = emptyList(),
                waitingReason = null,
                aboardStep = null,
                boardOverrideIndex = null,
            )
        }
        val first = guideRoute.legs[initial.legIndex]
        // 오디오 승격은 **첫 톤보다 먼저**(`WalkGuideModel` 동형, E36 §4.2.1). 안드로이드는 포커스·재생기를 `tones.beginSession`이 든다.
        tones.beginSession()
        playTone(BeaconTone.start, allowedInBackground = false)
        // E40: 시작 통지가 목적지를 말한다 — 시트 진입 착지는 상태 문장이라(E38) 목적지를 만날 채널이 없다. 환승 도보 뒤 재개(E73 spec D5)는 이미 돌던
        // 안내라 「안내를 시작합니다. 탑승 구간 N개.」를 다시 말하지 않는다 — 걷기 전 `legAdvanced`가 냈을 대기 문맥(도보를 뺀 것)만 낸다.
        val parts = mutableListOf<String>()
        if (startLeg > 0) {
            parts += waitContextText(first, isCurrentLeg = true)
        } else {
            parts += spokenDestinationName?.let { strings.get("transitGuide.startedAt", it, guideRoute.legs.size) }
                ?: strings.get("transitGuide.started", guideRoute.legs.size)
            parts += waitContextText(first, isCurrentLeg = true)
        }
        if (first.trackMode == null) parts += strings.get("transitGuide.untrackable")
        announce(parts.joinToString(" "), speechClass = GuideSpeechClass.actionable)
        restartPollLoop(immediate = true)
    }

    /**
     * 통지(시작·목적지 변경)에 실을 목적지 이름(A53 iOS 잔여). 조망 도보 줄과 **같은 판정**이다 — 데이터 언어가 en이면 라틴 표기만, 없으면 null(이름 없는
     * 문구로 떨어진다). 한글 라벨이 영어 문장에 섞이지 않게(E27 한 줄 한 언어). 라틴 표기(`destinationRoman`)는 아직 없어 null을 넘긴다.
     */
    private val spokenDestinationName: String?
        get() = TransitWalkLegText.destinationName(label = destinationLabel, roman = null, english = transitGuideIsEn)

    /** ⚠ `playStopTone`은 기본값 없음 — 호출부가 정지음을 낼지 밝힌다. */
    fun stop(playStopTone: Boolean) {
        sessionToken?.let {
            sessionToken = null
            coordinator.release(it)
        }
        pollJob?.cancel()
        pollJob = null
        // 세션 경계 — 보류 문장을 버린다(끝난 세션의 문장이 다음 세션 안에서 나오지 않게). 기기 음성 대기 칸도(E53 §4.2 ⑤).
        deferredAnnouncer.advanceGeneration()
        deviceSpeech.reset()
        toneState = TransitToneState.initial
        lastPollStartAt = null
        plannedIntervalMs = null
        if (playStopTone && state != null) playTone(BeaconTone.stop, allowedInBackground = false)
        // 원복은 정지 톤 **뒤에**(재생 잔여만큼 미뤄진다 — `tones.endSession` 소관).
        tones.endSession()
        if (_keepAliveWanted.value != null) {
            _keepAliveWanted.value = null
            // 단계 4: controller — keep-alive 서비스를 끈다
            GuideDiag.log { "transit keepAlive stop reason=sessionEnd" }
        }
        // 단계 3: ridingPosition · clearBusStop · busAlightNotice · neverSeenPending · reanchor
        retained.clear()
        tagoResolved.clear()
        tagoUnsupported.clear()
        wasBackgrounded = false
        missedAnnouncement = false
        refreshAnnounce = false
        droppedWhileSuppressed = null
        aboardDirection = null
        aboardStartLandingPending = false
        mutate {
            copy(
                state = null,
                route = null,
                waitingLive = emptyList(),
                waitingDeparted = emptyList(),
                waitingReason = null,
                idlePaused = false,
                pendingWalkHandoff = null,
                expressBlockedNote = null,
                boardOverrideIndex = null,
                aboardStep = null,
                boardingManualAvailable = false,
                selectedDescription = null,
                reboardPickerActive = false,
            )
        }
        // 단계 3: destChangeToken · pendingDestChange · altRoutesToken · pendingAltRoutes · invalidateRecovery
        outputSuppressed = false
        onJourneyRideCompleted = null
        journeyNextIsWalk = null
        onJourneyStopped?.let {
            onJourneyStopped = null
            it()
        }
    }

    /**
     * 환승 도보로 넘기며 세션을 끝낸다(E73 spec D4) — 정지음 없음(곧 도보 시작음이 난다). 여정 훅 셋은 보존한다: `stop()`은 그것을 지우고 `onJourneyStopped`를
     * 부르므로 그대로 부르면 여정이 끝난다. 걸어서 닿으면 같은 모델이 그 구간부터 다시 시작하며(`startAfterPrewalk`) 훅이 그 세션에 그대로 걸려 있다.
     */
    fun stopForTransferWalk() {
        val stopped = onJourneyStopped
        val rideCompleted = onJourneyRideCompleted
        val nextIsWalk = journeyNextIsWalk
        onJourneyStopped = null
        stop(playStopTone = false)
        onJourneyStopped = stopped
        onJourneyRideCompleted = rideCompleted
        journeyNextIsWalk = nextIsWalk
    }

    /** 핸드오프 제안 소거(§14.2) — 시트 닫기·수락 시 호출(세션은 이미 종료 상태). */
    fun clearWalkHandoff() {
        pendingWalkHandoff = null
    }

    fun teardown() {
        stop(playStopTone = false)
        // iOS `tones.shutdown()` — 안드로이드 재생기는 세션이 공유하는 하나라 모델이 닫지 않는다(M4 §5-2 #16).
    }

    /**
     * E36(2026-09-11): 백그라운드에서도 폴은 계속된다(정지 축은 국면·주기·유휴뿐). 여기서 하는 일은 복귀 낭독과 복귀 즉폴이다. ⚠ 복귀 즉폴은 예산 항목이
     * 아니라 **3-state 정직성의 방어선** — 프로세스가 재워진 동안 끊긴 요청은 `Failed`로 도착하는데, 즉폴이 옛 작업을 취소하고 `pollOnce`의 취소 가드가 그
     * 결과를 버린다(설계 리뷰 O2). iOS `handleScenePhaseChange` — 안드로이드는 전경/백그라운드 둘뿐이다(`inactive` 없음).
     */
    fun setForeground(foreground: Boolean) {
        // 복귀 인계(E53 §4.2 ⑥, 설계 리뷰 m4)는 **추적 가드 앞**이다 — 세션이 백그라운드에서 끝났어도(완료 문장이 기기 음성으로 말하는 중) 그 문장을 앞으로
        // 넘긴다. 받은 문장은 아래 복귀 낭독과 **한 통지**(`highPriority`)로 합친다(구현 리뷰 M-2·M-3). 합칠 자리를 지나지 않는 경로(비추적·유휴 재개·전경 전이
        // 없음)는 함수 끝에서 따로 낸다(`finally`). 유휴 재개 복귀는 재개 문장 앞에 싣는다(`resumePrefix` — 유휴 정지 직전 폴의 문장이 아직 말하는 중일 수
        // 있다, 검증 리뷰 N4).
        var handed: List<String> = emptyList()
        if (!foreground) {
            speechBackgrounded = true
        } else if (speechBackgrounded) {
            speechBackgrounded = false
            // 합본이 억제로 버려져도 되돌리지 않는다(`.texts`만) — 억제 버림은 `droppedWhileSuppressed`가 해제 때 합본째 다시 내므로 장부까지 되살리면 두 번
            // 말한다(E53 spec §4.2 ⑧, 횡단 리뷰 F6 기각).
            handed = deviceSpeech.handOver().texts
        }
        try {
            if (!isTracking) return
            // 계측(A16 미확정 ②): 백그라운드 구간의 폴 지속은 `pollStart sinceLast`가 증거다.
            GuideDiag.log { "transit scene foreground=$foreground tracking=$isTracking idle=$idlePaused" }
            if (!foreground) {
                wasBackgrounded = true
                return
            }
            if (!wasBackgrounded) return
            wasBackgrounded = false
            val resumedFromIdle = idlePaused
            if (resumedFromIdle) {
                resumePrefix = handed
                handed = emptyList()
            }
            // 화면을 켠 것은 조작이다 — 유휴 정지 중이었으면 여기서 "안내를 재개합니다. {상태}"와 즉폴.
            touchUserAction()
            resumePrefix = emptyList()
            if (!resumedFromIdle) {
                // 복귀 낭독은 백그라운드에서 버린 통지가 있을 때만, 현재 상태 하나(누적 재생 금지). 인계 문장(옛 → 새) 뒤에 현재 상태(버린 통지가 있을 때만,
                // 인계와 같은 문장이면 뺀다)를 한 통지로.
                val status = if (missedAnnouncement) returnStatusText() else ""
                // 인계 문장은 낭독 정정(`spokenUnits`)을 지난 뒤라 같은 층끼리 비교한다(검증 리뷰 N2).
                val owed = handed + (if (status.isEmpty() || handed.contains(spokenUnits(status))) emptyList() else listOf(status))
                handed = emptyList()
                if (owed.isNotEmpty()) {
                    // 화면 변화 없는 통지라 `highPriority`(CLAUDE.md 통지 우선순위 판별선 — 착지 라벨로 대체될 수 없다).
                    announce(owed.joinToString(" "), highPriority = true, speechClass = GuideSpeechClass.actionable)
                }
                restartPollLoop(immediate = true)
            }
            missedAnnouncement = false
            // 단계 4: controller — 원함(keepAliveWanted)을 다시 판정해 서비스를 켠다(잠금 중 추정 도착 → 재관측 복귀 뒤 시작 거부 재시도)
        } finally {
            if (handed.isNotEmpty()) announce(handed.joinToString(" "), highPriority = true, speechClass = GuideSpeechClass.actionable)
        }
    }

    /**
     * 복귀 낭독 문장: 신호가 `neverSeen`(식별 잠금)이면 탈출구를 담은 1회성 행동 문장, 그 밖은 상태 문장. 상태 문장 `stateNeverSeen`("열차 위치를 끝내 확인하지
     * 못했습니다.")에는 "탑승 변경을 눌러 주세요"가 없다 — 억제 해제 복구(`droppedWhileSuppressed`)와 같은 근거(memory once-only-warning-delivery-contract).
     */
    private fun returnStatusText(): String {
        // 단계 3: recoveryStatusText — 잘못 내림 복구 중엔 복구 상태만(E78 §8-5)
        val s = state ?: return ""
        val leg = currentLeg ?: return ""
        // 단계 3: positionStatusText — 현재역이 잡혀 있으면 그것이 상태다(E35 §6)
        val unobserved = s.lock?.let(::transitLockIsUnobserved) ?: false
        if (s.signal == TransitSignal.neverSeen && !unobserved) return strings.get("transitGuide.neverSeen")
        return signalStatusText(s.signal, phase = s.phase, isTrain = leg.mode == "subway", unobserved = unobserved)
    }

    // MARK: - 유휴 폴 정지·keep-alive (E36 spec 2026-09-11 §4.2.3·§4.2.6)

    /**
     * 게시 시점 조회(캐시 플래그 금지 — `WalkGuideModel` 동형): 전환을 한 번 놓쳐도 전경 발화가 영구 소실되지 않는다. 시트의 착지 헬퍼도 본다(A35 L4) —
     * 백그라운드엔 접근성 커서가 없어 착지 시도가 무의미하고 판정 로그를 오염시킨다.
     */
    val isForeground: Boolean get() = env.isForeground()

    /**
     * 사용자 조작 표식 — 모든 사용자 입력(`dispatch` 비폴 입력·새로고침·역 선택·조망·목적지/경로 변경)과 전경 복귀가 부른다. 유휴 정지 중이었으면 재개한다.
     * 시트가 직접 부르는 자리는 역 상세 열기(E33) 하나 — 착지 재시도(A35)는 조작이 아니라 부르지 않는다.
     */
    fun touchUserAction() {
        noteUserAction()
        resumeIfIdle()
    }

    private fun noteUserAction() {
        lastUserActionAt = clock()
    }

    /**
     * 유휴 정지 중이었으면 재개. 재개 문장은 **즉시 창구·`highPriority`** — 사용자 조작의 직접 응답이고 화면 변화 없이 "폴이 멈춰 있었다"를 전하는 유일한
     * 증거다(지연 창구에 두면 바로 뒤 `announceNow`(새로고침·조망)가 선점해 버린다 — 코드 리뷰 C5).
     */
    private fun resumeIfIdle() {
        if (!idlePaused) return
        idlePaused = false
        GuideDiag.log { "transit idleResume" }
        // "안내를 재개합니다."는 폴이 실제로 멈췄던 이 자리에서만 참이다(백그라운드 복귀에서는 뗐다). 복귀 인계 문장(옛 것)이 있으면 앞에 싣는다 — 재개 문장과
        // 한 통지(검증 리뷰 N4). 복귀 밖의 재개엔 비어 있다.
        val parts = resumePrefix.toMutableList()
        parts += strings.get("transitGuide.resumed")
        resumePrefix = emptyList()
        val status = returnStatusText()
        if (status.isNotEmpty()) parts += status
        announceNow(parts.joinToString(" "), highPriority = true)
        updateKeepAlive()
        restartPollLoop(immediate = true)
    }

    /**
     * 폴 루프가 다음 폴 직전에 부른다. 마지막 조작 이후 한계(`transitIdlePollLimitMs`: max(30분, 2×구간 소요))를 넘겼으면 폴·keep-alive를 멈춘다(세션 유지).
     * 잊힌 세션이 밤새 공유 쿼터를 태우고 위치 스트림을 켜 두는 것을 막는다 — 종전엔 `pausedInBackground`가 우연히 막고 있었다(설계 리뷰 B3).
     */
    private fun enterIdleIfDue(): Boolean {
        val now = clock()
        val limitSeconds = transitIdlePollLimitMs(currentLeg?.minutes) / 1000
        val sinceAction = now - lastUserActionAt
        if (sinceAction < limitSeconds) return false
        idlePaused = true
        // 폴·keep-alive가 멈추면 fix도 만료 판정도 오지 않는다 — 표식을 남기면 재개 전까지 옛 정류장을 무기한 말한다(설계 리뷰 M4).
        // 단계 3: clearBusStop
        // 승차 중 현재역(E35)도 같다(E48 잔여 ⑥) — 보존 창을 재는 폴 시계도 멈춘다.
        // 단계 3: transitRidingPositionOnIdlePause
        GuideDiag.log { "transit idlePause sinceAction=${sinceAction.toInt()}s limit=${limitSeconds.toInt()}s" }
        // 정지 톤(도보 유휴 종료 동형). 전경에서만: 잠근 채 잊은 휴대전화가 한참 뒤 울리면 당황스럽다.
        playTone(BeaconTone.stop, allowedInBackground = false)
        // 정지 사실은 화면이 바뀌지 않아 통지가 유일한 증거다(→ `highPriority`). 재개 문장(`resumeIfIdle`)과 달리 **자동 통지 창구**로 보낸다 — 사용자
        // 활성화의 응답이 아니라 타이머 판정이라 톤이 울리는 중이면 그 뒤에 말해야 한다. 재개 방법을 덧붙이지 않는다(위원장 판정 2026-09-11 — BACKLOG E36).
        // 분류는 미룸(E53 spec §3.3 — 잊힌 세션 안전망이라 백그라운드에서 말하지 않는다).
        announce(strings.get("transitGuide.idlePaused"), highPriority = true, speechClass = GuideSpeechClass.deferrable)
        GuideDiag.log { "transit idlePaused announced fg=$isForeground" }
        updateKeepAlive()
        return true
    }

    /**
     * (boarding ∨ riding) ∧ 폴 주기 > 0 ∧ 유휴 아님이면 keep-alive 스트림을 원하고, 아니면 끈다. 권한이 **이미 있을 때만** 원한다 — 요청하지 않고, 없으면 로그 한
     * 줄(세션당 1회) — 권한 팝업을 새로 띄우지 않는다. boarding을 넣은 것은 A46(위원장 판정 2026-09-23): 고른 차량을 기다리다 화면을 끄면 앱이 잠들어 도착 관측
     * (`boarded(observed)`)을 놓쳤다. 안드로이드는 판정만 `keepAliveWanted`로 내보내고 서비스를 켜고 끄는 것은 단계 4다(원함과 가동 분리, M5 §6-4).
     */
    private fun updateKeepAlive() {
        val s = state
        val wants = s != null && (s.phase == TransitPhase.boarding || s.phase == TransitPhase.riding) && !idlePaused && transitPollIntervalMs(s) > 0
        if (wants) {
            // 버스 승차 중이면 정류장을 가를 수 있는 정밀도로 올린다(E48 §4.2) — 그 밖(지하철·boarding)은 저정밀 그대로. 국면 전이·구간 전진·유휴 정지가 모두 이
            // 함수를 지나므로 매번 반영한다. ⚠ 버스 승차의 정상 흐름은 boarding에서 이미 켜진 keep-alive를 riding에서 올리는 이 분기다(A46).
            // 단계 3: transitBusStopApplies — 버스 승차 중이면 keepAliveBus
            val busRiding = false
            val profile = if (busRiding) GuideLocationProfile.keepAliveBus else GuideLocationProfile.keepAlive
            val current = _keepAliveWanted.value
            if (current != null) {
                if (current != profile) {
                    _keepAliveWanted.value = profile
                    GuideDiag.log { "transit keepAlive profile=${if (busRiding) "bus" else "default"}" }
                }
                return
            }
            if (permissions.currentLocation() != LocationPermission.None) {
                _keepAliveWanted.value = profile
                // 단계 4: controller — 서비스를 켠다(실패는 세션을 끝내지 않고 로그 한 줄, 전경 폴은 돈다)
                // 단계 3: ingestKeepAliveFix — keepAliveFixSink 연결(버스 정류장 E48)
                GuideDiag.log { "transit keepAlive start profile=${if (busRiding) "bus" else "default"}" }
            } else if (!keepAliveDeniedLogged) {
                keepAliveDeniedLogged = true
                GuideDiag.log { "transit keepAlive denied" }
            }
        } else if (_keepAliveWanted.value != null) {
            _keepAliveWanted.value = null
            // 단계 4: controller — 서비스를 끈다
            GuideDiag.log { "transit keepAlive stop reason=${if (idlePaused) "idle" else "phase"}" }
        }
    }

    // 단계 3: refreshBusStopMark
    // 단계 3: clearBusStop
    // 단계 3: ingestKeepAliveFix
    // 단계 3: announceAlightReached

    // MARK: - 사용자 액션

    /** 현재 구간을 바꿔 끼운다(서울버스 노선 선택). */
    private fun replaceCurrentLeg(leg: TransitGuideLeg) {
        val r = route ?: return
        val s = state ?: return
        if (s.legIndex !in r.legs.indices) return
        val legs = r.legs.toMutableList()
        legs[s.legIndex] = leg
        route = TransitGuideRoute(legs = legs, walkAfterMinutes = r.walkAfterMinutes)
    }

    /**
     * "탑승" = 차량 선택(N3). 식별자 잠금은 boarding으로 들어가 승차 정류소 도착을 기다린다 — riding 승격은 상태 머신이 관측으로 한다. `description`은 선택 차량의
     * 안정 설명(행선·방향 — 폴마다 바뀌는 완성 문장은 제외)으로 상시 표시·통지에 쓴다. dispatch **전에** 동기로 보관해 vehicleSelected 통지가 빈 설명을 읽지 않는다.
     */
    fun board(item: TransitTrackItem, description: TransitLabel?) {
        val s = state ?: return
        if (s.phase != TransitPhase.waiting || s.signal == TransitSignal.untrackable) return
        var leg = currentLeg ?: return
        val trackMode = leg.trackMode ?: return
        // 선택 진입점의 차단 재판정(A16 L1, 설계 리뷰 2차 #3): 시트 버튼 유무에만 기대면 다른 호출 경로가 결정적 미도달 열차를 잠근다. 같은 술어로 여기서도 거른다.
        if (transitUnreachableReason(item, leg) != null) {
            GuideDiag.log { "transit board rejected unreachable vehicle=${item.vehicleId ?: "-"}" }
            return
        }
        // 지방버스 집합의 키는 노선 번호라 `routeId`로 쓸 수 없다 — 노선 교체는 서울버스만(E76 후속 ⓓ).
        if (trackMode == TransitTrackMode.seoulBus) {
            val lane = transitLaneForItem(leg, item)
            if (lane != null) {
                leg = transitLegWithLane(leg, lane)
                replaceCurrentLeg(leg)
            }
        }
        val lock = TransitLock(
            mode = trackMode,
            routeId = leg.routeId ?: subwayIdForOdsayLine(leg.lineName) ?: "",
            direction = item.direction,
            vehicleId = item.vehicleId ?: "",
        )
        selectedDescription = description
        logVehiclePick(kind = "board", chosen = item, leg = leg)
        dispatch(TransitGuideInput.Board(lock))
        restartPollLoop(immediate = true)
    }

    /**
     * 차량을 고르는 순간의 계측(A74, 실험판) — 그때 화면에 있던 후보 전부와 고른 항목을 한 줄씩. 사후에 "고른 열차가 이미 떠난 열차였는가"를 가르는 유일한 증거다.
     * 좌표·개인 정보는 싣지 않는다(열차 번호·문장·나이·판정만).
     */
    private fun logVehiclePick(kind: String, chosen: TransitTrackItem, leg: TransitGuideLeg) {
        GuideDiag.log {
            fun row(item: TransitTrackItem): String =
                "train=${item.vehicleId ?: "-"} code=${item.arrivalCode ?: "-"} msg=${item.message}" +
                    " age=${item.dataAgeSeconds ?: "-"}" +
                    " departedLikely=${item.departedLikely ?: "-"}" +
                    " platformAge=${item.platformAgeSeconds ?: "-"}"
            val shown = classifyTransitBoardingCandidates(waitingCandidatesPool(), leg).candidates
            // 대기 목록에서 빠진(떠난 것으로 판정된) 열차도 함께 남긴다 — 걸러낸 판정이 맞았는지 사후에 가른다.
            val hidden = (waitingLive + waitingDeparted.map { it.item }).filter { it.departedLikely == true }
            "vehiclePick kind=$kind chosen[${row(chosen)}] shown=${shown.size} hidden=${hidden.size}" +
                shown.withIndex().joinToString("") { "\n  shown[${it.index}] ${row(it.value.item)}" } +
                hidden.withIndex().joinToString("") { "\n  hidden[${it.index}] ${row(it.value)}" }
        }
    }

    /**
     * "선택한 열차에 탔어요"(boarding → riding 사용자 선언). 종전 [탑승했습니다]와 같은 입력이고 **언제 낼 수 있는가**만 좁혔다(N3 ①).
     */
    fun confirmBoarded() {
        if (state?.phase != TransitPhase.boarding) return
        dispatch(TransitGuideInput.ConfirmBoarded)
        restartPollLoop(immediate = true)
    }

    fun boardApprox() {
        val leg = currentLeg ?: return
        if (leg.trackMode != TransitTrackMode.tagoBus) return
        dispatch(TransitGuideInput.Board(TransitLock(mode = TransitTrackMode.tagoBus, routeId = leg.lineName, direction = "", vehicleId = "")))
        restartPollLoop(immediate = true)
    }

    fun advance() {
        completeOrAdvance(announceDone = true)
    }

    /**
     * 마지막 leg의 단일 버튼 "남은 도보 안내 시작"(E34, spec 2026-09-11 §4.3): `advance`와 같은 전이이되 완료 문장 `doneWalk`를 내지 않는다 — 그 문장은 어차피
     * `acceptWalkHandoff`의 `stop()`이 지연 슬롯째 취소하고(설계 리뷰 M3), 도착 통지(`arrivedWalkNext`)가 이미 도보 분을 말했다. 반환 = 말미 도보 인계가 남았는가
     * (false면 시트가 인계를 부르지 않는다 — 전이 실패 시 세션을 끊지 않는 가드).
     */
    fun advanceIntoWalkHandoff(): Boolean {
        completeOrAdvance(announceDone = false)
        val pending = pendingWalkHandoff != null
        GuideDiag.log { "transit walkHandoffNow pending=$pending" }
        return pending
    }

    /** 마지막 leg인가(E70 여정 버튼 조건 — 잘린 경로는 말미 도보 분이 없다). */
    val isOnFinalLeg: Boolean
        get() {
            val s = state ?: return false
            val r = route ?: return false
            return s.legIndex == r.legs.size - 1
        }

    /** 마지막 leg면 목적지까지의 말미 도보 분(E34 버튼 조건), 아니면 null. */
    val finalLegWalkMinutes: Int?
        get() {
            val s = state ?: return null
            val r = route ?: return null
            return if (s.legIndex == r.legs.size - 1) r.walkAfterMinutes else null
        }

    /** 탑승 변경의 조회 쿼리용 한국어 원문(조인 축) — 인덱스가 가리키는 정류소 이름. */
    val boardOverrideName: String?
        get() {
            val i = boardOverrideIndex ?: return null
            val leg = currentLeg ?: return null
            return leg.viaStops.getOrNull(i)?.name
        }

    private fun completeOrAdvance(announceDone: Boolean) {
        // 환승 도보(E73 spec D3): 리듀서를 순수하게 미리 돌려 다음 구간으로 넘어가는지 보고, 그 구간 앞 도보가 걷기 안내 대상이면 전진을 커밋하지 않고 세션 소유자에게
        // 넘긴다. `legAdvanced` 통지(「도보 N분 이동 후 …」)는 즉시 창구라 뒤의 세대 증가로 취소되지 않는다 — 걷기 안내가 붙는 이 경우엔 내면 안 되는 문장이다.
        val s = state
        val r = route
        val d = dest
        val handoffHook = onTransferWalk
        if (s != null && r != null && d != null && handoffHook != null) {
            val event = transitGuideStep(state = s, input = TransitGuideInput.Advance, route = r, now = nowMs()).event
            if (event is TransitGuideEvent.LegAdvanced && !event.final) {
                val nextIndex = event.legIndex
                val target = transitTransferWalkTarget(r, nextIndex)
                // 실승차 판정 재료(spec §5-3): 걷기가 있는 전진은 대상 여부와 무관하게 직선 거리를 남긴다(`-` = 좌표 결손).
                val minutes = r.legs[nextIndex].walkBeforeMinutes
                if (minutes != null && minutes >= 1) {
                    val meters = transitTransferWalkMeters(r, nextIndex)?.let { fmt1(it) } ?: "-"
                    GuideDiag.log { "transit transferWalk leg=$nextIndex minutes=$minutes meters=$meters target=${if (target == null) 0 else 1}" }
                }
                if (target != null) {
                    // 다음 구간으로 넘어간다 = 탔다(A68) — 전진을 커밋하지 않으니 `dispatch`의 전이 대신 여기서 알린다(구현·안전 리뷰 L1).
                    onPassedPrewalk?.invoke()
                    handoffHook(
                        TransitTransferWalkHandoff(
                            route = r, legIndex = nextIndex, target = target, destinationLabel = destinationLabel,
                            dest = d, accessible = accessible, lead = null,
                        ),
                    )
                    return
                }
            }
        }
        dispatch(TransitGuideInput.Advance)
        if (state?.phase == TransitPhase.done) {
            // 여정(E70 §6.3): 말미 도보와 무관하게 다음 단계로. 완료 문장은 다음 세션의 시작 통지가 대신한다(뻔한 꼬리 금지).
            val rideCompleted = onJourneyRideCompleted
            if (rideCompleted != null) {
                onJourneyRideCompleted = null
                onJourneyStopped = null
                stop(playStopTone = false)
                rideCompleted()
                return
            }
            // 완료 통지는 legAdvanced 이벤트가 이미 냈다 — 자원만 회수한다. 말미 도보가 있으면 핸드오프 제안(§14.2)을 stop() **뒤에** 남긴다(stop()이
            // pendingWalkHandoff까지 null로 지우는 단일 소거 경로라 순서 필수). ⚠ E34부터 이 값은 인계 화면의 근거가 아니라 **한 턴 수명 신호**다 — 같은 턴에
            // `GuideSession.acceptWalkHandoff`가 소비한다. 출구·하차역 좌표(E84)는 `stop()`이 경로를 지우기 전에 마지막 구간에서 읽는다.
            val finalLeg = route?.legs?.lastOrNull()
            val handoff = route?.walkAfterMinutes?.let {
                TransitWalkHandoff(
                    destinationLabel = destinationLabel, walkMinutes = it,
                    exitAlight = finalLeg?.exitAlight,
                    alightLat = finalLeg?.alightStop?.lat, alightLng = finalLeg?.alightStop?.lng,
                )
            }
            // 완료 문장은 stop() **뒤에** 낸다(BeaconModel 도착 문장 선례): `handle(event)`가 start 톤 뒤로 미룬 문장은 stop()의 세대 증가가 취소하므로, 그 자리는
            // 발화하지 않고 여기서 stop()이 지우는 route를 지역 변수로 캡처해 새 세대에 게시한다.
            val doneText = finalLegText()
            stop(playStopTone = false)
            pendingWalkHandoff = handoff
            if (announceDone) announce(doneText, speechClass = GuideSpeechClass.actionable)
        } else {
            waitingLive = emptyList()
            waitingDeparted = emptyList()
            waitingReason = null
            retained.clear()
            restartPollLoop(immediate = true)
        }
    }

    /**
     * "탑승 변경" 진입. 지하철은 지금 있는 역을, 서울버스는 지금 있는 정류장을(E76 후속 ⓔ) 먼저 묻고, 그 밖은 종전대로 곧장 재선택으로 간다. 판정은
     * `transitReboardStopPickable`. ⚠ 지하철은 조회 파라미터가 역 *이름*이라 표시 인덱스(`boardOverrideIndex`)를 덧씌우고, 서울버스는 정류소 ID를 쓰므로 leg
     * 자체를 바꾼다(`changeBoarding(stopIndex)`, 단계 3).
     */
    fun beginReboard() {
        // 단계 3: invalidateRecovery — 복구 중이었으면 폴을 즉시 다시 돌린다(`if (invalidateRecovery()) restartPollLoop(immediate = true)`)
        touchUserAction()
        // 단계 3: reanchor — 승차 중의 새 [탑승 변경]은 새 원본을 잡는다(`if (state.phase != .waiting) reanchor = nil`)
        val leg = currentLeg
        if (leg == null || !transitReboardStopPickable(leg)) {
            changeBoarding()
            return
        }
        reboardPickerActive = true
    }

    fun cancelReboard() {
        reboardPickerActive = false
    }

    /**
     * 하차역 선언(A37 ②, spec 2026-09-11 §4.1): 역 선택(승차 중 탑승 변경·"이미 탑승" 흐름 둘 다)에서 하차역을 고르면 그 leg를 확정 도착으로 끝낸다 — 대기 국면으로
     * 되돌리지 않는다. 통지는 관측 도착과 같은 지연 창구(`.arrived` 이벤트, 도착 종 뒤 발화). 폴 주기 0(리듀서) + 즉폴 게이트로 폴이 나가지 않는다.
     */
    fun declareArrived() {
        val s = state ?: return
        if (s.phase != TransitPhase.waiting && s.phase != TransitPhase.riding) return
        GuideDiag.log { "transit declareArrived from=${s.phase.rawValue} leg=${s.legIndex}" }
        aboardDirection = null
        aboardStartLandingPending = false
        dispatch(TransitGuideInput.DeclareArrived)
        waitingLive = emptyList()
        waitingDeparted = emptyList()
        waitingReason = null
        restartPollLoop(immediate = false)
    }

    // MARK: - "이미 탔어요" 흐름 (A34 ②+①, spec 2026-09-11 §4.2)

    /**
     * E71 R9: 시트 첫 착지가 질문 라벨(`.waitingLabel`)이어야 하는 일회성 표식을 읽고 false로 돌린다. 띠바 복귀·일반 A34 둘째 단계의 시트 재열림은 E38 판정대로
     * 상태 문장이다(`aboardStep`을 보면 그 둘도 질문 라벨로 간다).
     */
    fun consumeAboardStartLanding(): Boolean {
        val pending = aboardStartLandingPending
        aboardStartLandingPending = false
        return pending
    }

    /**
     * [이미 탔어요] — 지하철이면 역부터 묻는다. 그 밖(서울버스)은 종전대로 곧장 근사(비관측) 잠금(서울버스는 정류소 ID 조회라 역 이름 질문이 성립하지 않는다 —
     * [탑승 변경]의 정류장 질문과 다른 흐름이다).
     */
    fun beginAboard() {
        touchUserAction()
        if (state?.phase != TransitPhase.waiting) return
        val leg = currentLeg ?: return
        if (leg.trackMode != TransitTrackMode.subway || leg.viaStops.isEmpty()) {
            boardAlready(express = null)
            return
        }
        aboardStep = TransitAboardStep.pickStation
        GuideDiag.log { "transit aboard step=pickStation" }
    }

    fun cancelAboard() {
        aboardStep = null
        GuideDiag.log { "transit aboard step=cancel" }
    }

    /**
     * 역 선택(pickStation) 응답. 하차역이면 도착 선언(§4.1), 그 밖은 그 역 기준 목록으로(스냅숏·3분 버퍼 소거 — 승차역 목록이 다른 역 목록에 섞이지 않게, 리뷰 m1).
     */
    fun pickAboardStation(stopIndex: Int) {
        touchUserAction()
        val leg = currentLeg ?: return
        if (aboardStep != TransitAboardStep.pickStation) return
        if (stopIndex == leg.viaStops.size - 1) {
            aboardStep = null
            declareArrived()
            return
        }
        boardOverrideIndex = stopIndex
        aboardStep = TransitAboardStep.pickVehicle
        waitingLive = emptyList()
        waitingDeparted = emptyList()
        waitingReason = null
        retained.clear()
        GuideDiag.log { "transit aboard step=pickVehicle station=$stopIndex" }
        restartPollLoop(immediate = true)
    }

    fun pickAnotherAboardStation() {
        if (aboardStep != TransitAboardStep.pickVehicle) return
        aboardStep = TransitAboardStep.pickStation
        GuideDiag.log { "transit aboard step=pickStation again" }
    }

    /** pickVehicle 목록에서 고른 열차로 riding 직행(식별 잠금, 선언). boarding을 지나지 않는다 — 이미 탔다. 차단 재판정은 `board()`와 같은 술어. */
    fun boardAboard(item: TransitTrackItem, description: TransitLabel?) {
        if (aboardStep != TransitAboardStep.pickVehicle) return
        val leg = currentLeg ?: return
        val trackMode = leg.trackMode ?: return
        // E71 R14: 시작 때 고른 방향과 다른 열차로는 식별 잠금을 세우지 않는다(조회와 시작 사이에 열차가 바뀌어도).
        val locked = aboardDirection
        if (locked != null && item.direction != locked) {
            GuideDiag.log { "transit boardAboard rejected direction vehicle=${item.vehicleId ?: "-"} locked=$locked" }
            return
        }
        if (transitUnreachableReason(item, leg) != null) {
            GuideDiag.log { "transit boardAboard rejected unreachable vehicle=${item.vehicleId ?: "-"}" }
            return
        }
        val lock = TransitLock(
            mode = trackMode,
            routeId = leg.routeId ?: subwayIdForOdsayLine(leg.lineName) ?: "",
            direction = item.direction,
            vehicleId = item.vehicleId ?: "",
        )
        selectedDescription = description
        GuideDiag.log { "transit boardAboard vehicle=${item.vehicleId ?: "-"}" }
        logVehiclePick(kind = "boardAboard", chosen = item, leg = leg)
        aboardBoardInStep = true
        dispatch(TransitGuideInput.BoardAboard(lock))
        aboardBoardInStep = false
        restartPollLoop(immediate = true)
    }

    /**
     * 사용자가 고른 현재 역으로 재선택한다(A16 L3). 인자는 **세션 경로 `viaStops`의 인덱스**다 — 이름을 받는 판을 남기면 그것이 다시 동명 역 모호 경로가 된다(spec §3.6).
     */
    fun changeBoarding(stopIndex: Int) {
        val leg = currentLeg
        if (state != null && leg != null && leg.trackMode == TransitTrackMode.seoulBus) {
            reboardPickerActive = false
            // 단계 3: reseatSeoulBus — 고른 정류장 기준 leg로 바꾸고 다시 기다린다(E76 후속 ⓔ). 그 전까지는 원래 승차 정류장 기준 대기로 돌아간다(iOS가 첫 정류장에서 하는 것과 같다).
            changeBoarding()
            return
        }
        boardOverrideIndex = stopIndex
        reboardPickerActive = false
        changeBoarding()
    }

    // 단계 3: fetchReanchorLanes

    fun changeBoarding() {
        dispatch(TransitGuideInput.ChangeBoarding)
        // §13.1: 소실 항목 3분 버퍼(retained)는 비우지 않는다 — 잘못 잠근 채 이동한 뒤 돌아온 목록에서 원래 열차가 사라지던 경로. 스냅숏만 비우고 즉폴이 재구성.
        waitingLive = emptyList()
        waitingDeparted = emptyList()
        waitingReason = null
        restartPollLoop(immediate = true)
    }

    /**
     * 탑승 변경 취소(§13.1) — 직전 잠금·국면으로 복귀(머신이 previousLock·previousPhase 소유). ⚠ `Board(previousLock)`으로 돌리면 식별자 잠금은 boarding으로
     * 가서 이미 탄 사용자가 승차 정류소 폴링으로 되돌아간다(설계 리뷰 M5) — 전용 입력이 정본.
     */
    fun cancelChangeBoarding() {
        val s = state ?: return
        if (s.phase != TransitPhase.waiting) return
        val previous = s.previousLock ?: return
        // 단계 3: reanchor — 정류장 재기준(E76 후속 ⓔ)을 취소하면 [탑승 변경] 직전 leg(원래 정류장·집합)로 되돌린다(`reanchor = nil` 포함)
        val leg = currentLeg
        if (previous.mode == TransitTrackMode.seoulBus && leg != null) {
            val lane = leg.lanes?.firstOrNull { it.key == previous.routeId }
            if (lane != null) replaceCurrentLeg(transitLegWithLane(leg, lane))
        }
        dispatch(TransitGuideInput.RestoreBoarding)
        restartPollLoop(immediate = true)
    }

    /**
     * "이미 탔어요"(§13.2) — 식별자 없는 근사 잠금(tagoBus 계약 동형).
     *
     * `express`는 급행 확인 프롬프트(spec 2026-09-02 §6, 위원장 판정 — 급행 집합이 있는 노선에서만 시트가 묻는다)의 답. true면 하차역 정차를 판정해 통과 급행이면
     * 잠그지 않고 차단 문장(결정적 문장 재사용)을 남기고, 정차하면 급행 선언 잠금. 프롬프트가 없는 노선은 null로 종전 그대로. ⚠ 기본값 없음 — 호출부가 밝힌다.
     */
    fun boardAlready(express: Boolean?) {
        val leg = currentLeg ?: return
        val trackMode = leg.trackMode ?: return
        if (trackMode == TransitTrackMode.tagoBus) return
        if (express == true && transitDeclaredExpressVerdict(leg) == TransitExpressVerdict.skips) {
            val note = renderer.render(transitExpressSkipsAlightLine(isEn = transitGuideIsEn, leg = displayLeg(leg, useOverride = false)))
            expressBlockedNote = note
            GuideDiag.log { "transit boardAlready rejected express skips alight" }
            // 통지는 시트의 착지가 대신한다(문장 행 착지 = 답). 착지 실패 폴백만 `announceLandingFallback`(전 대상 공용, A35).
            return
        }
        expressBlockedNote = null
        val direction = when (leg.wayCode) { 1 -> "상행"; 2 -> "하행"; else -> "" }
        dispatch(
            TransitGuideInput.Board(
                TransitLock(
                    mode = trackMode,
                    routeId = leg.routeId ?: subwayIdForOdsayLine(leg.lineName) ?: "",
                    direction = direction,
                    vehicleId = "",
                    express = if (express == true) true else null,
                ),
            ),
        )
        restartPollLoop(immediate = true)
    }

    /**
     * 착지 실패 폴백(A35 spec §4.1): 시트가 대상에 커서를 앉히지 못했을 때 **그 자리에서 낭독됐을 라벨**을 즉시 `.high`로 통지한다(헌장 §5 — 착지 못 하면 통지가 유일한
     * 증거). 착지가 성공하면 부르지 않는다(같은 문장 이중 낭독 금지). 빈 문장은 내지 않는다.
     */
    fun announceLandingFallback(text: String) {
        if (text.isEmpty()) return
        announceNow(text, highPriority = true)
    }

    /** 새로고침(§13.2) — 즉폴 + 결과를 직접 응답으로 통지(자동 폴 무낭독의 예외). */
    fun refreshWaiting() {
        if (state?.phase != TransitPhase.waiting) return
        touchUserAction()
        refreshAnnounce = true
        restartPollLoop(immediate = true)
    }


    /**
     * 대기 목록의 입력 풀(시트·새로고침 응답 공용). "이미 탑승" pickVehicle 단계는 그 역에 있는 열차만(`transitAboardCandidates`, A34 ② 후보 필터) — 두
     * 소비자가 다른 풀을 보면 "탑승 후보 N개"가 화면과 어긋난다.
     */
    fun waitingCandidatesPool(): List<TransitTrackItem> {
        val all = waitingLive + waitingDeparted.map { it.item }
        // 대기 목록은 조회 역을 이미 떠난 열차를 뺀다(A74) — [이미 탔어요]의 열차 고르기는 빼지 않는다(그 열차에 타고 있는 사람의 길).
        if (aboardStep != TransitAboardStep.pickVehicle) return transitBoardablePool(all)
        val candidates = transitAboardCandidates(all)
        // E71 R14: 지금 탄 열차에서 시작한 세션은 고른 방향만(반대 방향을 되살리지 않는다). Kit에 `journeyAboardTrainItems`가 없어 같은 한 줄 필터를 둔다
        // (여정 이식 때 Kit 함수로 바꾼다).
        val direction = aboardDirection
        return if (direction != null) candidates.filter { it.direction == direction } else candidates
    }

    /** 0건 사유 문구(§13.3 3-state) — 목록 자리(시트)·새로고침 응답 공용. */
    fun reasonText(reason: TransitWaitingEmptyReason): String = when (reason) {
        TransitWaitingEmptyReason.none -> strings.get("transitGuide.noCandidates")
        TransitWaitingEmptyReason.filtered -> strings.get("transitGuide.noCandidatesFiltered")
        TransitWaitingEmptyReason.unavailable -> strings.get("transitGuide.noCandidatesUnavailable")
    }

    /**
     * 진행 상황(공개 동작 — iOS 줄 1815). 사용자 조작이라 `touchUserAction`을 지나고, 상태 문장 한 통지를 **즉시 창구**로 낸다.
     */
    fun announceProgress() {
        touchUserAction()
        val s = state ?: return
        val leg = currentLeg ?: return
        // 단계 3: positionClock — 렌더 밖의 판정이라 위치 보존 창은 **지금** 시각으로(E35 구현 리뷰 m1)
        announceNow(statusLineText(s, leg, now = nowMs(), speaksLocated = true), highPriority = true)
    }

    /**
     * 상시 표시·진행 상황 공용 조립기(§12.3) — 완성 문장 파트를 공백으로 연결하는 단일 헬퍼. 종전엔 시트가 쉼표 조립(joinText)을 따로 해 "기준., " 이중 구두점과
     * stationCountAbout·lastUpdated 누락 드리프트가 났었다(피드백 #9). `now`(ms)는 위치 보존 창(E35)을 판정할 시각이다 — 화면은 `positionClock`, 통지는 지금(기본값
     * 없음: 생략이 컴파일을 통과하면 한쪽이 조용히 다른 시계를 쓴다). `speaksLocated`: 현재역 문장을 이 줄에 싣는가(E35) — 조망 머리 문장만 false다. 현재역은
     * 단계 3이라 두 인자는 아직 쓰이지 않는다(시그니처는 iOS 그대로 둔다).
     */
    @Suppress("UNUSED_PARAMETER")
    fun statusLineText(state: TransitGuideState, leg: TransitGuideLeg, now: Double, speaksLocated: Boolean): String {
        val boarding = state.phase == TransitPhase.boarding
        val riding = state.phase == TransitPhase.riding
        val arrived = state.phase == TransitPhase.arrived
        // 비관측 잠금(A34 ①): 어느 열차인지 모르는 상태라 잔여·도착 문장·신선도를 내지 않는다.
        val unobserved = state.lock?.let(::transitLockIsUnobserved) ?: false
        // 도착 조각을 낼 수 있는 국면 — 도착 뒤의 접근 정보는 낡은 값이라 `arrived`는 제외한다(E39).
        val live = (boarding || riding) && !unobserved
        val parts = mutableListOf<String>()
        parts += when (state.phase) {
            TransitPhase.waiting -> waitContextText(leg, isCurrentLeg = true)
            TransitPhase.boarding -> boardingContextText(leg)
            else -> contextText(leg, lock = state.lock)
        }
        // 잔여 + 도착 서술을 한 줄 두 조각으로(E39) — 렌더가 쉼표로 이어 한 문장이 된다.
        val message: TransitLabel? = if (live) state.lastMessage?.takeIf { it.isNotEmpty() }?.let { transitMessageLabel(it, state.lastMessageEn) } else null
        val arrival = if (live) {
            renderer.render(
                transitArrivalStatusLine(
                    isEn = transitGuideIsEn,
                    leg = displayLeg(leg, useOverride = boarding),
                    message = message, arrivalCode = state.lastArrivalCode,
                    remaining = state.remaining, phase = if (boarding) TransitStatusPhase.boarding else TransitStatusPhase.riding,
                ),
            )
        } else {
            ""
        }
        // 신호 문구(E39 위원장 판정): 대기 국면의 `notYetVisible`은 그 국면 내내 고정이라 정보가 0이고(목록 자리가 0건 사유를 3-state로 말한다), 추적 중은 도착
        // 조각이 그 사실을 이미 말한다. 추적 중인데 도착 조각이 비면 그것이 정보다 — "차량이 없다"가 아니라 "언제 오는지 못 받았다"(3-state의 unknown).
        // ⚠ `noArrivalInfo`는 **관측된 도달 사례가 없는 방어선**이다 — 실제 도달 여부는 실승차가 답한다(BACKLOG §2 E39 행 ④).
        // 단계 3: positionStatusText — 승차 중 현재역(E35 §6 판정 1)이 신호 문장 자리를 차지한다
        if (state.phase == TransitPhase.waiting && state.signal == TransitSignal.notYetVisible) {
            // 없음
        } else if (state.signal == TransitSignal.tracking && live) {
            if (arrival.isEmpty()) parts += strings.get("transitGuide.noArrivalInfo")
        } else {
            parts += signalStatusText(state.signal, phase = state.phase, isTrain = leg.mode == "subway", unobserved = unobserved)
        }
        // 선택 차량 조각: boarding 종전대로 + riding(A34 ② — 목록에서 고른 열차를 확인하는 자리, 리뷰 m5).
        val desc = selectedDescription
        if ((boarding || riding) && desc != null) {
            parts += renderer.render(transitSelectedVehicleLine(isEn = transitGuideIsEn, desc = desc))
        }
        if (arrival.isNotEmpty()) parts += arrival
        // 잔여를 못 받은 승차 중의 어림 정거장 수 — 도착 조각과 겹치지 않는 별도 문장이다.
        val count = leg.stationCount
        if (riding && !unobserved && state.remaining == null && count != null) {
            parts += strings.get("transitGuide.stationCountAbout", count)
        }
        // 근사 주석(`approxNote`)은 지방버스만(대기 중에도 근사 예고). 지하철·서울버스 근사는 2026-09-11부터 비관측이라 접근 차량 기준이 아니다 — 국면을 보지 않는
        // 잠금 술어로 갈라 선언 도착 뒤에도 상속되지 않게(리뷰 m2). 집합이 있으면(E76 후속 ⓓ) 탄 노선을 모르므로 `approxNoteLanes`(추천 노선 기준임을 말한다).
        if (leg.trackMode == TransitTrackMode.tagoBus) {
            parts += strings.get(if ((leg.lanes?.size ?: 0) >= 2) "transitGuide.approxNoteLanes" else "transitGuide.approxNote")
        }
        // 급행 선언 잠금(§6)은 판정을 상시 표시에 남긴다 — 답한 직후의 침묵이 "확인됨"으로 읽히지 않게.
        if (state.lock?.express == true) {
            parts += renderer.render(
                transitExpressStatusLine(
                    isEn = transitGuideIsEn, leg = displayLeg(leg, useOverride = false), verdict = transitDeclaredExpressVerdict(leg),
                ),
            )
        }
        // 신선도 문장은 정확히 1개(§12.3, 감사 H2·M1): 추적 중이면 데이터 나이, 그 외엔 마지막 폴 시각만 — 낡은 나이를 신선한 값처럼 이월하지 않는다. 비관측
        // 잠금은 폴이 없어 신선도가 정보가 아니다(동결 시각은 "앱이 멈췄다"로 읽힌다, 리뷰 m4). 도착 국면도 같다 — 내린 뒤의 갱신 시각은 행동을 바꾸지 않는다(E39).
        val age = state.dataAgeSeconds
        val updatedAt = state.lastUpdatedAt
        if (unobserved || arrived) {
            // 없음
        } else if (state.signal == TransitSignal.tracking && age != null) {
            parts += strings.get("transitGuide.dataAge", age)
        } else if (updatedAt != null) {
            parts += strings.get("transitGuide.lastUpdated", timeText(updatedAt))
        }
        return parts.filter { it.isNotEmpty() }.joinToString(" ")
    }

    private fun timeText(epochMs: Double): String {
        // 고정 포맷은 로케일 고정이 규칙 — 기기 12시간제 설정에 흔들리지 않게.
        return SimpleDateFormat("HH:mm", Locale.US).format(Date(epochMs.toLong()))
    }

    // MARK: - 폴링 루프

    private fun restartPollLoop(immediate: Boolean) {
        pollJob?.cancel()
        val s = state ?: return
        // 단계 3: pendingRecovery — 잘못 내림 복구 중엔 예약하지 않는다(E78 §5-1, 즉폴 포함)
        // 유휴 정지 중엔 예약하지 않는다 — 어떤 조작·전경 복귀(`touchUserAction`)가 풀며 다시 부른다.
        if (idlePaused) return
        val interval = transitPollIntervalMs(s)
        // 주기 0 = 폴 없음이고 **즉폴도 예외가 아니다**(A37 ② 설계 리뷰 B1 — 종전엔 `!immediate`에만 걸려 선언 도착·백그라운드 복귀의 즉폴이 새 세대로 나가
        // remaining·lastMessage를 되살렸다).
        if (interval <= 0) return
        // 계측: 이 폴을 예약한 주기(즉폴은 null → `planned=-`).
        plannedIntervalMs = if (immediate) null else interval
        pollJob = scope.launch {
            if (!immediate) delay(interval.toLong())
            while (isActive) {
                // 잊힌 세션 안전망(spec §4.2.6): 다음 폴 직전에 유휴를 판정한다.
                if (enterIdleIfDue()) return@launch
                pollOnce()
                if (!isActive) return@launch
                // 단계 3: refreshPosition — 승차 중 현재역(E35)은 도착 폴의 계측(`pollEnd elapsed`) **밖**에서 조회한다
                val current = state
                if (!isActive || current == null) return@launch
                val next = transitPollIntervalMs(current)
                if (next <= 0) return@launch
                plannedIntervalMs = next
                delay(next.toLong())
            }
        }
    }

    private suspend fun pollOnce() {
        val s = state ?: return
        val leg = currentLeg ?: return
        if (s.phase == TransitPhase.done || s.signal == TransitSignal.untrackable) return
        val phaseGen = s.phaseGen
        seq += 1
        val mySeq = seq
        // 계측(A16 미확정 ②, spec 2026-09-02 §3): 시작·종료 1쌍/폴. 종료는 `finally`라 조기 반환·취소 어느 경로든 정확히 한 번 남는다(설계 리뷰 2차 #6). 시각은 단조.
        val startedAt = clock()
        val previousStart = lastPollStartAt
        val planned = plannedIntervalMs
        lastPollStartAt = startedAt
        GuideDiag.log {
            val sinceLast = previousStart?.let { fmt1(startedAt - it) } ?: "-"
            // 정수 초(ms 주기는 1000 배수), 즉폴은 "-".
            val plannedText = planned?.let { "${it / 1000}s" } ?: "-"
            "transit pollStart seq=$mySeq phase=${s.phase.rawValue} sinceLast=${sinceLast}s planned=$plannedText"
        }
        var endStatus = "cancelled"
        try {
            val (poll, rawCount) = fetchPoll(leg, s.phase)
            endStatus = pollStatusText(poll)
            if (!currentCoroutineContext().isActive) {
                endStatus = "cancelled"
                return
            }
            // 잠금 국면 계측(A16 미확정 ①): boarding·riding·arrived 응답을 dispatch 전에 남긴다.
            if (s.phase != TransitPhase.waiting) {
                logRidingPoll(mySeq, poll, rawCount, s)
            }
            // 대기 목록 스냅숏(§5.1) — 소실 유지·경과 계산은 폴 시점에.
            var refreshResponse: String? = null
            val after = state
            if (after?.phase == TransitPhase.waiting && after.phaseGen == phaseGen) {
                updateWaitingSnapshot(poll, rawCount)
                logWaitingPoll(mySeq, poll, rawCount, leg)
                // 새로고침 직접 응답(§13.2): 자동 폴 무낭독 규칙의 대상이 아니다 — 사용자 요청의 응답이라 후보 수(0 포함)로 답한다. 조회 실패·미지원만 사유 문장
                // (실패를 "0개"로 말하지 않는다 — 3-state). 0건의 왜는 목록 자리 지속 문장이 담당한다(통지·화면 중복 금지, 감사 M4).
                if (refreshAnnounce && leg.trackMode != TransitTrackMode.tagoBus) {
                    refreshAnnounce = false
                    val candidates = classifyTransitBoardingCandidates(waitingCandidatesPool(), leg).candidates
                    refreshResponse = if (waitingReason == TransitWaitingEmptyReason.unavailable) {
                        reasonText(TransitWaitingEmptyReason.unavailable)
                    } else {
                        strings.get("transitGuide.waitingCount", candidates.size)
                    }
                    // A74 계측: 새로고침 응답으로 낭독한 대기 목록 문장(떠난 열차를 뺀 풀의 후보 수).
                    GuideDiag.log {
                        "transit refreshResponse text=${refreshResponse ?: "-"} candidates=${candidates.size} pool=${waitingLive.size + waitingDeparted.size}"
                    }
                }
            }
            refreshAnnounce = false
            dispatch(TransitGuideInput.Poll(seq = mySeq, phaseGen = phaseGen, poll = poll))
            // 응답은 dispatch 뒤에 `highPriority`로 게시한다 — 같은 폴의 신호 이벤트 통지가 먼저 나가고 높은 우선순위가 큐를 끊어 응답이 최종 승자가 된다(감사 M1: 역순이면
            // 동어반복 두 문장이 연달아 나가거나 응답이 잠식된다). 사용자 활성화(새로고침)의 직접 응답이라 즉시 창구(보류 슬롯 무효화 — 이벤트 문장이 뒤늦게 발화하는 역전 차단).
            refreshResponse?.let { announceNow(it, highPriority = true) }
        } finally {
            val elapsed = clock() - startedAt
            GuideDiag.log { "transit pollEnd seq=$mySeq status=$endStatus elapsed=${fmt2(elapsed)}s" }
        }
    }

    // 단계 3: refreshPosition

    private fun pollStatusText(poll: TransitTrackPoll): String = when (poll) {
        is TransitTrackPoll.Ok -> "ok(${poll.items.size})"
        TransitTrackPoll.Empty -> "empty"
        TransitTrackPoll.Unsupported -> "unsupported"
        TransitTrackPoll.Failed -> "failed"
    }

    /**
     * 잠금 국면 계측(A16 미확정 ①, spec 2026-09-02 §3) — 폴이 `Empty`였는지, 항목은 있는데 잠금 열차가 없었는지(L1 기제), 매칭됐는데 잔여 추출이 실패했는지를
     * 가른다. 매칭은 리듀서와 **같은 순수 함수·같은 입력**(dispatch 전 `state.lock`)이라 결과가 같다(리뷰 #7).
     */
    private fun logRidingPoll(seq: Int, poll: TransitTrackPoll, rawCount: Int?, state: TransitGuideState) {
        GuideDiag.log {
            val items = (poll as? TransitTrackPoll.Ok)?.items ?: emptyList()
            val matched = state.lock?.let { transitFindLockedItem(items, it) }
            val m = matched?.let { item ->
                var text = "yes remaining=${item.remainingStops ?: "-"}"
                text += " code=${item.arrivalCode ?: "-"} loc=${item.currentLocation ?: "-"}"
                text += " age=${item.dataAgeSeconds ?: "-"} stamp=${item.dataStamp ?: "-"}"
                // A74 계측: 서버의 떠남 판정과 승강장 나이(boarding 폴에서 판정 근거를 가른다).
                text += " departedLikely=${item.departedLikely ?: "-"}"
                text += " platformAge=${item.platformAgeSeconds ?: "-"}"
                text
            } ?: "no"
            "transit ridePoll seq=$seq phase=${state.phase.rawValue} status=${pollStatusText(poll)}" +
                " raw=${rawCount ?: "-"} matched=$m signal=${state.signal.rawValue}"
        }
    }

    private suspend fun fetchPoll(leg: TransitGuideLeg, phase: TransitPhase): Pair<TransitTrackPoll, Int?> {
        try {
            val lang = dataLocale().rawValue
            when (leg.trackMode) {
                TransitTrackMode.seoulBus -> {
                    if (phase == TransitPhase.waiting || phase == TransitPhase.boarding) {
                        val arsId = leg.boardStop?.arsId
                        val routeId = leg.routeId
                        if (arsId == null || routeId == null) return TransitTrackPoll.Unsupported to null
                        val env = withContext(io) {
                            track.seoulWait(
                                arsId = arsId, routeId = routeId,
                                routeIds = if (phase == TransitPhase.waiting) leg.lanes?.map { it.key } else null,
                                lang = lang,
                            )
                        }
                        return TransitTrackService.poll(env) to env.rawCount
                    }
                    val boardId = leg.boardStop?.localId
                    val alightId = leg.alightStop?.localId
                    val routeId = leg.routeId
                    if (boardId == null || alightId == null || routeId == null) return TransitTrackPoll.Unsupported to null
                    val env = withContext(io) { track.seoulRide(routeId = routeId, boardId = boardId, alightId = alightId, lang = lang) }
                    return TransitTrackService.poll(env) to env.rawCount
                }
                TransitTrackMode.tagoBus -> {
                    val resolved = resolveTagoIfNeeded(leg, phase)
                    if (resolved == null) {
                        val current = state ?: return TransitTrackPoll.Failed to null
                        val unsupported = tagoUnsupported.contains(tagoCacheKey(current.legIndex, phase))
                        return (if (unsupported) TransitTrackPoll.Unsupported else TransitTrackPoll.Failed) to null
                    }
                    val env = withContext(io) {
                        track.tagoTrack(
                            cityCode = resolved.cityCode, nodeId = resolved.nodeId, routeNo = leg.lineName,
                            // 대기 국면만 노선 집합(E76 후속 ⓓ). 승차 중은 추천 노선 하나다 — 집합 최솟값은 폴마다 다른 노선 버스로 튀어 리듀서가 그것을
                            // 카운트다운·임박으로 읽는다(설계 리뷰 H3).
                            routeNos = if (phase == TransitPhase.waiting && (leg.lanes?.size ?: 0) >= 2) leg.lanes?.map { it.key } else null,
                            lang = lang,
                        )
                    }
                    return TransitTrackService.poll(env) to env.rawCount
                }
                TransitTrackMode.subway -> {
                    // waiting 국면의 기준 역은 사용자가 고른 현재 역이 이긴다(A16 L3). riding(alightName)은 건드리지 않는다 — 그쪽은 L1 영역이다.
                    val station = if (phase == TransitPhase.waiting || phase == TransitPhase.boarding) boardOverrideName ?: leg.boardName else leg.alightName
                    if (station.isEmpty()) return TransitTrackPoll.Unsupported to null
                    val env = withContext(io) {
                        track.subwayTrack(
                            station = station, line = leg.lineName, lang = lang,
                            // A74: 승차역 폴(대기·승차 국면)만 떠난 열차 판정을 옵트인한다. 하차역 폴은 붙이지 않는다.
                            departCheck = phase == TransitPhase.waiting || phase == TransitPhase.boarding,
                        )
                    }
                    return TransitTrackService.poll(env) to env.rawCount
                }
                null -> return TransitTrackPoll.Unsupported to null
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return TransitTrackPoll.Failed to null
        }
    }

    /**
     * 대기 국면 계측(§13.5) — 폴마다 status·원시 건수·필터 단계별 잔존·비활성 사유를 남겨 #4 원인 6후보를 다음 실승차 로그로 가른다.
     */
    private fun logWaitingPoll(seq: Int, poll: TransitTrackPoll, rawCount: Int?, leg: TransitGuideLeg) {
        GuideDiag.log {
            val status = pollStatusText(poll)
            val classified = classifyTransitBoardingCandidates(waitingLive + waitingDeparted.map { it.item }, leg)
            val vehIdless = classified.candidates.count { it.item.vehicleId.isNullOrEmpty() }
            val terminates = classified.candidates.count { it.unreachable != null }
            "transit waitPoll seq=$seq status=$status raw=${rawCount ?: "-"}" +
                " live=${waitingLive.size} departed=${waitingDeparted.size}" +
                " candidates=${classified.candidates.size} vehIdless=$vehIdless" +
                " unreachable=$terminates" +
                " directionUncertain=${classified.directionUncertain}" +
                " reason=${waitingReason?.rawValue ?: "-"}"
        }
    }

    /** 지방버스 정류소 해석(세션·leg당 1회, §5.2). 모호·부재는 unsupported 캐시. */
    private fun tagoCacheKey(legIndex: Int, phase: TransitPhase): String =
        "$legIndex:${if (phase == TransitPhase.waiting || phase == TransitPhase.boarding) "board" else "alight"}"

    private suspend fun resolveTagoIfNeeded(leg: TransitGuideLeg, phase: TransitPhase): TransitTrackResolvedStop? {
        val legIndex = state?.legIndex ?: return null
        val key = tagoCacheKey(legIndex, phase)
        if (tagoUnsupported.contains(key)) return null
        tagoResolved[key]?.let { return it }
        val target = (if (phase == TransitPhase.waiting || phase == TransitPhase.boarding) leg.boardStop else leg.alightStop) ?: return null
        return try {
            val envelope = withContext(io) { track.resolveTagoStop(lat = target.lat, lng = target.lng) }
            val stop = envelope.stop
            if (envelope.status == "ok" && stop != null) {
                tagoResolved[key] = stop
                stop
            } else {
                tagoUnsupported.add(key)
                null
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null // 일시 실패 — 캐시하지 않고 다음 폴에서 재시도
        }
    }

    private fun updateWaitingSnapshot(poll: TransitTrackPoll, rawCount: Int?) {
        waitingReason = transitWaitingEmptyReason(poll, rawCount)
        val items = (poll as? TransitTrackPoll.Ok)?.items ?: emptyList()
        val now = wallClockMs()
        for (item in items) {
            val vid = item.vehicleId
            if (!vid.isNullOrEmpty()) retained[vid] = Retained(item, now)
        }
        retained.entries.removeAll { now - it.value.lastSeenAtMs > retainSeconds * 1000 }
        val liveKeys = items.mapNotNull { it.vehicleId }.toSet()
        waitingLive = items
        waitingDeparted = retained.mapNotNull { (key, value) ->
            if (key in liveKeys) null
            else TransitDepartedItem(value.item, max(1, ((now - value.lastSeenAtMs) / 60_000.0).roundToInt()))
        }
    }

    // MARK: - 상태 머신 배선·통지

    private fun dispatch(input: TransitGuideInput) {
        val state = state ?: return
        val route = route ?: return
        // 폴을 제외한 모든 입력은 사용자 조작이다(유휴 정지 축). 표식은 여기, 유휴 재개(주기 산정·재개 문장)는 **상태 대입 뒤**(코드 리뷰 C4 — 입력 전 상태로 주기를
        // 재지 않게).
        val userAction = input !is TransitGuideInput.Poll
        if (userAction) noteUserAction()
        // 단계 3: invalidateRecovery — 사용자 조작(다음 구간·탑승 변경·차량 선택·이미 탔어요·하차 선언)이 복구를 이긴다(§8-3). 폴 재개는 상태 대입 뒤(코드 리뷰 NIT-1)
        val result = transitGuideStep(state = state, input = input, route = route, now = nowMs())
        // A47: 사용자 입력이 국면을 바꿨다(누른 버튼이 사라진다) — 시트가 이 순번의 변화로 착지를 가른다. 국면 쌍으로 추정하면 boarding→riding 선언과 관측
        // 승격이 같은 쌍이라 한쪽을 반드시 틀린다.
        if (userAction && (result.state.phase != state.phase || result.state.phaseGen != state.phaseGen)) {
            userTransitionSeq += 1
        }
        this.state = result.state
        if (userAction) resumeIfIdle()
        // 단계 3: recoveryOutcome · recoveryRetryOrigin — 자동 전이가 지나간 결과 행은 낡았다(spec 리뷰 NIT-3)
        updateKeepAlive()
        if (result.event is TransitGuideEvent.NeverSeen) {
            // A36 ① 판정 재료(spec §4.6·§7): 상한에 닿은 조회 수와 그 시점 잔여(대본 §5-3이 이 문자열을 읽는다).
            GuideDiag.log { "transit neverSeen polls=${result.state.ridingPolls} remaining=${result.state.remaining ?: "-"}" }
        }
        // 추세 톤 계층(E15 ②, spec 2026-09-02 §2.5): `state`(대입 전 캡처 = before)와 `result.state`(after)를 넘긴다 — 입력 조립·phaseGen 리셋은 Kit 순수
        // 함수 몫이다(설계 리뷰 #2). 이벤트가 있는 스텝은 층이 null을 내므로 한 dispatch에 `tones.play`는 최대 1회다.
        val toned = transitToneStep(state = toneState, before = state, after = result.state, event = result.event, now = clock())
        toneState = toned.state
        // 사용자가 고른 기준 역(A16 L3)의 수명은 딱 한 번의 재선택이다. 재잠금·전진 뒤에도 남으면 다음 대기 국면이 엉뚱한 역을 조회한다. ⚠ 소거를 호출부마다
        // 흩뿌리지 않는 이유가 그것이다 — board 디스패치만 네 곳이라 하나만 빠져도 조용히 틀린다.
        // N3: boarding이 재선택 역을 계속 조회해야 하므로 `.board`가 아니라 **riding 진입**(선언·관측 어느 길이든)에서 지운다. 국면 기반이라 폴이 일으키는 승격도 잡는다.
        val enteredRiding = result.state.phase == TransitPhase.riding && state.phase != TransitPhase.riding
        if (input is TransitGuideInput.Advance) {
            boardOverrideIndex = null
            selectedDescription = null
            aboardDirection = null
            aboardStartLandingPending = false
        }
        if (enteredRiding) boardOverrideIndex = null
        // 탔다(A68 판정 2): riding에 들어섰거나 riding을 거치지 않고 그 뒤로 갔다(대기에서 하차역 선언 → arrived, 추적 불가 [다음 구간] → 다음 leg·done). 국면과 leg
        // 순번만 본다. 승차 전 도보가 남긴 길찾기 탭의 실패 줄과 재시작 버튼은 이제 지나온 승차역을 가리킨다. 다음 leg는 이 세션이 시작한 구간 기준이다 — 환승 도보 뒤
        // 재개 세션(E73 spec D8)은 시작부터 legIndex > 0이다.
        fun boarded(s: TransitGuideState): Boolean =
            s.phase == TransitPhase.riding || s.phase == TransitPhase.arrived || s.phase == TransitPhase.done || s.legIndex > sessionStartLeg
        if (boarded(result.state) && !boarded(state)) onPassedPrewalk?.invoke()
        // "이미 탑승" 흐름은 대기 국면 전용 UI — 국면이 바뀌면 소거(`reboardPickerActive`와 같은 국면 기반 규칙).
        if (result.state.phase != TransitPhase.waiting) {
            aboardStep = null
            aboardDirection = null
            aboardStartLandingPending = false
        }
        // boarding 수동 진행 수단의 래치(N3 ①): 국면에 **들어올 때** 지우고(재진입 = 새 차량 대기), 그 국면 안에서 관측이 끝나면 세운다. 국면 밖에선 언제나 false.
        if (result.state.phase != TransitPhase.boarding || state.phase != TransitPhase.boarding) {
            boardingManualAvailable = false
        }
        // A74: 관측이 끝났을 때뿐 아니라 고른 열차가 이미 승강장에 있어 확인을 기다릴 때·떠난 것을 본 잠금일 때도 선다.
        if (result.state.phase == TransitPhase.boarding && transitBoardingDeclareOffered(result.state)) {
            boardingManualAvailable = true
        }
        // 급행 거절 문장은 그 대기 국면에 묶인다 — 국면 세대가 바뀌면 낡았다.
        if (result.state.phaseGen != state.phaseGen) expressBlockedNote = null
        // 픽커는 riding 국면 전용 UI다. 국면이 바뀌면 화면에서는 사라지지만 플래그가 남아, 다음 riding 진입에서 **묻지도 않은 역 선택 화면이 되살아나고** 포커스를
        // 강탈한다(독립 리뷰 MAJOR: 픽커를 연 채 폴이 도착 추정으로 전이 → advance → 다음 leg 탑승). ⚠ 국면 기반인 이유: `.board`/`.advance`만 열거하면 폴이 일으키는
        // arrived 전이를 놓친다. `boardOverrideIndex`는 waiting에서 쓰이므로 같은 축으로 묶을 수 없고, 그래서 둘의 소거 조건이 다르다.
        if (result.state.phase != TransitPhase.riding) reboardPickerActive = false
        // 단계 3: reanchor — 정류장 재기준 원본(E76 후속 ⓔ)의 수명은 그 대기 국면 하나다
        // 계측(§13.5): 국면·신호 전이와 이벤트만 기록(무이벤트 폴 소음 제외).
        if (result.event != null || result.state.phase != state.phase || result.state.signal != state.signal) {
            GuideDiag.log {
                "transit step phase=${state.phase.rawValue}→${result.state.phase.rawValue}" +
                    " signal=${state.signal.rawValue}→${result.state.signal.rawValue}" +
                    " event=${result.event?.toString() ?: "-"}"
            }
        }
        // approaching 첫 관측 판별(직전 상태의 trackingAnnounced) — 이벤트는 첫 관측과 사다리를 구분하지 않으므로 문구 조립이 전이 전 상태를 본다.
        firstObservationInStep = !state.trackingAnnounced && result.state.trackingAnnounced
        val event = result.event
        if (event != null) {
            // 단계 3: busAlightNotice — A69 역순 방지(기기 위치가 이 구간의 하차 정류장 도착을 이미 관측했으면 「다음 정류장 …」을 내지 않는다)
            // 단계 3: transitNeverSeenWarningDeferred — 승차 중 현재역(E35 §6 판정 2): `neverSeen` 순간 현재역이 잡혀 있으면 경고를 결박째 보류한다
            handle(event)
        }
        val tone = toned.tone
        if (tone != null) {
            GuideDiag.log { "transit tone kind=${tone.rawValue} anchor=${toned.state.anchorRemaining ?: "-"}" }
            // 추세 closer·farther는 백그라운드에서도, 신호 잃음 60초 반복음은 전경만(E79 판정 ①, Kit 판정).
            playTone(tone, allowedInBackground = transitToneAllowedInBackground(TransitBackgroundToneSource.Trend(tone)))
        }
    }

    private fun handle(event: TransitGuideEvent) {
        val profile = transitEventProfile(event)
        // 백그라운드 톤 허용 집합은 Kit `transitToneAllowedInBackground` 하나가 가른다(E79 위원장 판정 2026-11-07 — 승차 중 사다리·임박·도착과 첫 관측, 경고음 제외).
        // 이 파일엔 리터럴 `true`가 없다(소스 가드 `transit-background-guards.test.ts`의 안드로이드 판은 단계 4).
        val allowedInBackground = transitToneAllowedInBackground(TransitBackgroundToneSource.Event(event))
        when (profile.tone) {
            TransitGuideTone.start -> playTone(BeaconTone.start, allowedInBackground)
            TransitGuideTone.ladder -> playTone(BeaconTone.closer, allowedInBackground)
            TransitGuideTone.imminent -> playTone(BeaconTone.ahead, allowedInBackground)
            TransitGuideTone.arrive -> playTone(BeaconTone.nearby, allowedInBackground)
            TransitGuideTone.weak -> playTone(BeaconTone.warning, allowedInBackground)
            null -> Unit
        }
        val text = announcementText(event)
        if (text.isEmpty()) return
        // 사용자 활성화의 직접 응답(탑승 선언·다음 구간 버튼)은 즉시 창구다(a11y 감사 W1): 지연 슬롯에 두면 같은 함수가 부르는 즉폴의 `trackingStarted`가
        // latest-wins로 그 문장을 버려, 웜 응답이면 탑승 문장이 사라지고 콜드면 살아남는 비결정이 된다. 도착 관측(`observed`)은 폴 유래라 지연이고,
        // ⚠ **그 전제는 "관측 승격 뒤 다음 riding 폴이 한참 뒤"라는 것이다** — 승격 직후 즉폴을 넣으면 이 문장이 그 창 안에서 버려진다(N3 ① 구현 리뷰 H1으로 즉폴 철회, spec §9).
        val declaredBoard = event is TransitGuideEvent.Boarded && event.cause == TransitBoardedCause.declared
        if (declaredBoard || event is TransitGuideEvent.LegAdvanced) {
            announceNow(text, highPriority = profile.interrupt)
        } else {
            announce(text, highPriority = profile.interrupt, speechClass = transitEventSpeechClass(event))
        }
    }

    /**
     * 톤 재생 단일 창구 — 억제 가드는 여기 한 곳(`WalkGuideModel.playTone` 동형). 종전엔 이벤트 톤이 `tones.play`를 직접 불러 검색 시트(받아쓰기 마이크)가 열린
     * 동안에도 소리가 났다(설계 리뷰 #4). 층 상태(앵커·타이머)는 억제 중에도 전진한다 — 억제는 출력 게이트이지 판정 게이트가 아니다.
     * `allowedInBackground`(기본값 없음 — 호출부가 뜻을 밝힌다): 백그라운드에서도 낼 톤인가. 층 상태는 백그라운드에서도 전진한다 — 억제와 같은 출력 게이트 원칙.
     */
    private fun playTone(tone: BeaconTone, allowedInBackground: Boolean) {
        if (outputSuppressed) return
        if (!isForeground) {
            GuideDiag.log { "transit bgTone kind=${tone.rawValue} allowed=$allowedInBackground" }
            if (!allowedInBackground) return
        }
        tones.play(tone)
        // 가청 판정은 매 톤(세션 중에도 바뀐다), 문장은 세션당 1회. 안드로이드 축은 미디어 볼륨 0(iOS `!isBackgroundAudible`의 대체, M4가 정한 대응)이다.
        // ⚠ latch는 **발화 성공**에 건다(memory once-only-warning-delivery-contract, 구현 리뷰 C1·A-1): 이 문장은 톤 직후 큐잉되어 바로 뒤 이벤트 문장에 latest-wins로
        // 선점되거나 백그라운드 게이트에 버려진다. 그때 `onDropped`가 latch를 풀어 다음 톤이 다시 시도한다 — 지연 창구의 상환 계약 그대로.
        if (isTracking && tones.isMediaVolumeZero && !soundDegradedAnnounced) {
            soundDegradedAnnounced = true
            // 진동은 세션당 1회 별도 래치(E30 확장): 문장 래치는 버려지면 풀려 재시도하지만 진동은 버려지지 않으므로 같은 래치에 묶으면 문장이 도달할 때까지 톤마다
            // 반복된다(리뷰 검출).
            if (!soundDegradedHapticFired) {
                soundDegradedHapticFired = true
                resultHaptic(ResultHapticKind.attention)
            }
            deferredAnnouncer.announce(strings.get("android.guide.mediaVolumeZero"), speechClass = GuideSpeechClass.actionable) {
                soundDegradedAnnounced = false
            }
        }
    }

    /** 결과 진동 창구 — 억제 중이면 내지 않는다("문장이 나가는 조건 = 진동이 나가는 조건"). */
    private fun resultHaptic(kind: ResultHapticKind) {
        if (outputSuppressed) return
        haptics.result(kind)
    }

    /**
     * 이벤트가 실어 온 완성 문장 → **상태 문장과 같은 도착 서술**(E39). 통지와 상시 표시가 한 조립기를 공유해야 같은 사실이 두 문장으로 갈리지 않는다(§12.3 드리프트
     * 차단). `remaining`이 null이면 잔여 조각 없이 도착 서술만 낸다.
     */
    private fun arrivalText(
        leg: TransitGuideLeg, message: String, messageEn: String?, arrivalCode: String?, remaining: Int?, phase: TransitStatusPhase,
    ): String = renderer.render(
        transitArrivalStatusLine(
            isEn = transitGuideIsEn, leg = displayLeg(leg, useOverride = phase == TransitStatusPhase.boarding),
            message = if (message.isEmpty()) null else transitMessageLabel(message, messageEn),
            arrivalCode = arrivalCode, remaining = remaining, phase = phase,
        ),
    )

    private fun announcementText(event: TransitGuideEvent): String {
        val leg = currentLeg
        val parts = mutableListOf<String>()
        when (event) {
            is TransitGuideEvent.VehicleSelected -> {
                if (leg != null) {
                    parts += renderer.render(
                        transitVehicleSelectedLine(isEn = transitGuideIsEn, leg = displayLeg(leg, useOverride = true), desc = selectedDescription),
                    )
                }
            }
            is TransitGuideEvent.Approaching -> {
                // 첫 관측만 "추적합니다"를 앞세운다(래치 null→값). 이후 사다리는 도착 서술만.
                if (firstObservationInStep) parts += strings.get("transitGuide.approachingStarted")
                if (leg != null) {
                    parts += arrivalText(leg, event.message, event.messageEn, arrivalCode = null, remaining = event.remaining, phase = TransitStatusPhase.boarding)
                }
            }
            TransitGuideEvent.VehiclePassed -> {
                if (leg != null) {
                    parts += renderer.render(transitVehiclePassedLine(isEn = transitGuideIsEn, leg = displayLeg(leg, useOverride = true)))
                }
            }
            TransitGuideEvent.BoardConfirmNeeded -> {
                if (leg != null) {
                    parts += renderer.render(transitBoardConfirmNeededLine(isEn = transitGuideIsEn, leg = displayLeg(leg, useOverride = true)))
                }
            }
            TransitGuideEvent.BoardConfirmLapsed -> {
                if (leg != null) {
                    parts += renderer.render(transitBoardConfirmLapsedLine(isEn = transitGuideIsEn, leg = displayLeg(leg, useOverride = true)))
                }
            }
            TransitGuideEvent.ArrivingAtBoardStop -> {
                // A41: "곧 도착" = 직전 정류소 출발. 승격 없이 임박만 — 탑승 문장은 소실 뒤 boarded(departed)가 낸다.
                if (leg != null) {
                    parts += renderer.render(transitArrivingAtBoardStopLine(isEn = transitGuideIsEn, leg = displayLeg(leg, useOverride = false)))
                }
            }
            TransitGuideEvent.ArrivingAtAlightStop -> {
                // A69: 「곧 도착」은 직전 정류장 정차 순간에 이미 켜진다 — "다음 정류장 {하차 정류장}"은 서 있든 떠났든 참이다. 도착 문장은 소실 뒤 arrived(certain: false)가 낸다.
                if (leg != null) {
                    parts += renderer.render(transitArrivingAtAlightStopLine(isEn = transitGuideIsEn, leg = displayLeg(leg, useOverride = false)))
                } else {
                    parts += strings.get("transitGuide.arrivingAtAlightStopUnnamed")
                }
            }
            is TransitGuideEvent.Boarded -> {
                if (leg != null) {
                    val d = displayLeg(leg, useOverride = false)
                    // E41: 정거장 수는 착지가 앉는 상태 문장이 매 폴 말하므로 뺀다. 하차역은 **자동 승격에만** 남긴다 — `boarding → riding`은 착지 대상이 아니라(N3 ①)
                    // 상태 문장이 다시 낭독되지 않아 통지가 그 순간의 유일한 채널이다(a11y 감사 2026-09-12). 관측 승격은 "도착했으니 타세요"가 그 순간의 지시라 그것을
                    // 앞세우고(departed는 차량이 이미 떠났으므로 내지 않는다, A41), departed는 탑승 사실을 말한다.
                    parts += if (event.cause == TransitBoardedCause.observed) {
                        renderer.render(transitArrivedAtBoardStopLine(isEn = transitGuideIsEn, leg = d))
                    } else {
                        renderer.render(transitBoardedLine(isEn = transitGuideIsEn))
                    }
                    if (event.cause != TransitBoardedCause.declared) {
                        parts += renderer.render(transitBoardedAlightLine(isEn = transitGuideIsEn, leg = d))
                    }
                    // "이미 탑승" 식별 잠금(A34 ②)은 vehicleSelected를 내지 않으므로 어느 열차를 잠갔는지 여기서 말한다.
                    val desc = selectedDescription
                    if (aboardBoardInStep && desc != null) {
                        parts += renderer.render(transitSelectedVehicleLine(isEn = transitGuideIsEn, desc = desc))
                    }
                }
            }
            is TransitGuideEvent.TrackingStarted -> {
                if (leg != null) parts += contextText(leg, lock = state?.lock)
                parts += strings.get("transitGuide.trackingStarted")
                if (leg != null) {
                    parts += arrivalText(leg, event.message, event.messageEn, arrivalCode = event.arrivalCode, remaining = event.remaining, phase = TransitStatusPhase.riding)
                }
            }
            is TransitGuideEvent.Countdown -> {
                // §12.3: 매 사다리마다 문맥 문장을 반복하지 않는다 — 도착 서술이 잔여와 시간을 함께 말한다. 지하철 99(운행중)는 도착 조각이 비어 잔여 수만 남는다(A27).
                if (leg != null) {
                    parts += arrivalText(leg, event.message, event.messageEn, arrivalCode = event.arrivalCode, remaining = event.remaining, phase = TransitStatusPhase.riding)
                }
                // 한 정거장 전 현재 역 병치(§12.2, 피드백 #10) — 잔여 ≥ 2 문장은 원문이 현재 역을 이미 담아 병치하지 않는다(중복 금지).
                if (event.remaining <= 1) {
                    transitLocationLabel(event.currentLocation, event.currentLocationEn)?.let { location ->
                        parts += renderer.render(transitCurrentStationLine(isEn = transitGuideIsEn, location = location))
                    }
                }
            }
            is TransitGuideEvent.MessageChanged -> {
                // 잔여는 바뀌지 않은 전이라 도착 서술만 낸다(잔여 조각 없음).
                if (leg != null) {
                    parts += arrivalText(
                        leg, event.message, event.messageEn, arrivalCode = event.arrivalCode, remaining = null,
                        phase = if (state?.phase == TransitPhase.boarding) TransitStatusPhase.boarding else TransitStatusPhase.riding,
                    )
                }
            }
            is TransitGuideEvent.Arrived -> {
                // 마지막 leg + 말미 도보(E34): 그 자리 버튼이 "남은 도보 안내 시작" 하나라 지시 문장이 그 이름을 부르고 도보 분을 담는다("다음: 대중교통 구간이
                // 끝났습니다…" 조각은 내지 않는다 — 내리기 전이다).
                val finalWalk = finalLegWalkMinutes
                if (finalWalk != null) {
                    parts += strings.get(if (event.certain) "transitGuide.arrivedWalkNext" else "transitGuide.arrivedGuessWalkNext", finalWalk)
                } else {
                    parts += strings.get(if (event.certain) "transitGuide.arrived" else "transitGuide.arrivedGuess")
                }
                // 출구 방면(E25)은 **확정** 도착에만 — 추정 도착은 전 역에서 신호를 잃은 것일 수 있어 확정형 출구 안내가 잘못 내리게 한다(설계 리뷰 #14).
                // 서버가 역 밖 하차에만 실은 값.
                val exit = if (event.certain && leg != null) displayLeg(leg, useOverride = false).exitAlight else null
                if (exit != null) {
                    parts += renderer.render(transitExitBoundLine(isEn = transitGuideIsEn, exit = exit, sentence = true))
                }
                val s = state
                val r = route
                if (s != null && r != null) {
                    val nextIndex = s.legIndex + 1
                    val walkAfter = r.walkAfterMinutes
                    if (r.legs.indices.contains(nextIndex)) {
                        parts += strings.get("transitGuide.nextLeg", waitContextText(r.legs[nextIndex], isCurrentLeg = false))
                    } else if (finalWalk == null && walkAfter != null) {
                        parts += strings.get("transitGuide.nextLeg", strings.get("transitGuide.doneWalk", walkAfter.toString()))
                    }
                }
            }
            is TransitGuideEvent.BackOnTrack -> {
                parts += strings.get("transitGuide.backOnTrack")
                if (leg != null) {
                    parts += arrivalText(leg, event.message, event.messageEn, arrivalCode = event.arrivalCode, remaining = null, phase = TransitStatusPhase.riding)
                }
            }
            is TransitGuideEvent.ApproxVehicleChanged -> parts += strings.get("transitGuide.approxVehicleChanged")
            TransitGuideEvent.SignalLost -> {
                // boarding의 소실은 "아직 안 탔는데 차량이 안 보인다"라 riding 문구와 다르다.
                parts += strings.get(if (state?.phase == TransitPhase.boarding) "transitGuide.boardingSignalLost" else "transitGuide.signalLost")
            }
            TransitGuideEvent.NeverSeen -> {
                // 기본 우선순위로 둔다(A16 §3.4): 자기 소멸 버튼이 없고 포커스 이동을 유발하지 않아 잠식 패턴에 해당하지 않는다.
                parts += strings.get("transitGuide.neverSeen")
            }
            TransitGuideEvent.UpstreamFailed -> {
                // boarding에서는 이 순간 수동 진행 수단이 조용히 선다(N3 ①) — 통지가 유일한 발견 경로라 그 버튼 이름을 부른다(헌장 §3).
                parts += strings.get(if (state?.phase == TransitPhase.boarding) "transitGuide.boardingUpstreamFailed" else "transitGuide.upstreamFailed")
            }
            TransitGuideEvent.SignalRecovered -> parts += strings.get("transitGuide.signalRecovered")
            TransitGuideEvent.CapSlowed -> parts += strings.get("transitGuide.capSlowed")
            is TransitGuideEvent.LegAdvanced -> {
                val r = route
                if (event.final) {
                    // 발화는 advance()가 stop() 뒤에 한다(B1) — 여기서 내면 세대 증가에 취소된다.
                } else if (r != null && r.legs.indices.contains(event.legIndex)) {
                    // ⚠ **다음 구간 문맥은 통지가 말한다**(E41 a11y 감사로 철회한 축소): 이 전이의 착지 대상은 상태 문장이 아니라 차량 선택 목록 라벨(E38 예외)이라,
                    // 문맥을 빼면 새 구간의 승차 정류소·노선·선행 도보가 어느 채널에도 남지 않는다.
                    val next = r.legs[event.legIndex]
                    parts += waitContextText(next, isCurrentLeg = false)
                    if (next.trackMode == null) parts += strings.get("transitGuide.untrackable")
                }
            }
            TransitGuideEvent.BoardingReset -> parts += strings.get("transitGuide.changeBoardingDone")
        }
        return parts.filter { it.isNotEmpty() }.joinToString(" ")
    }

    /** 완료 문장(마지막 구간 `advance`) — 말미 도보가 있으면 그 분을, 없으면 "도착했습니다". */
    private fun finalLegText(): String {
        route?.walkAfterMinutes?.let { return strings.get("transitGuide.doneWalk", it.toString()) }
        return strings.get("transitGuide.done")
    }

    /**
     * 노선·하차 전문 문맥(§6.1 M1 개정) — 추적 시작·진행 상황·상시 표시가 담당. `lock`은 기본값 없는 인자다(E76 후속 ⓕ): 근사 잠금 ∧ 노선 여럿이면 번호 없는 문장이라,
     * 생략이 통과하면 모르는 번호를 말한다.
     */
    fun contextText(leg: TransitGuideLeg, lock: TransitLock?): String = renderer.render(
        transitContextLine(
            isEn = transitGuideIsEn, leg = displayLeg(leg, useOverride = false), lineUnconfirmed = transitRideLineUnconfirmed(leg, lock),
        ),
    )

    /** leg → 표시 투영(E27 잔여 ①, spec §3.5). 조인 필드가 타입에 없어 이 아래에서는 노선명·역명을 조회 쿼리로 쓸 수 없다(1선은 구조). */
    fun displayLeg(leg: TransitGuideLeg, useOverride: Boolean): TransitDisplayLeg =
        transitDisplayLeg(leg, boardOverrideIndex = if (useOverride) boardOverrideIndex else null)

    /** boarding 문맥(N3) — 승차 정류소에서 선택 차량을 기다리는 중. 재선택 역이 있으면 그 역. */
    fun boardingContextText(leg: TransitGuideLeg): String =
        renderer.render(transitBoardingContextLine(isEn = transitGuideIsEn, leg = displayLeg(leg, useOverride = true)))

    /**
     * 대기 문맥(§4.1): 선행 도보 + 승차 지점 + 노선.
     *
     * ⚠ **재선택한 기준 역이 있으면 그 역이 승차 지점이다**(A16 L3, 독립 리뷰 MAJOR). 이 문장은 상시 표시이자 진행 상황 발화라, 조회 대상과 어긋나면 화면은
     * "천호역 대기"라고 말하는데 그 아래 목록은 왕십리 도착 정보인 상태가 된다. 목록 항목에 역명이 없으므로 **스크린 리더 사용자에게는 이 문장이 그 화면의 유일한
     * 역 정보원**이다.
     * `isCurrentLeg`: 이 문맥이 **지금 안내 중인 구간**을 설명하는가. ⚠ 기본값을 두지 않는 이유: 다음 구간 안내(`nextLeg`·`legAdvanced`)가 이전 구간에서 고른 역을
     * 말하면 안 되는데, 생략이 컴파일을 통과하면 그 결함이 조용히 들어온다([[no-default-for-safety-parameters]]).
     */
    fun waitContextText(leg: TransitGuideLeg, isCurrentLeg: Boolean): String = renderer.render(
        transitWaitContextLine(isEn = transitGuideIsEn, leg = displayLeg(leg, useOverride = isCurrentLeg), isCurrentLeg = isCurrentLeg),
    )

    /**
     * 신호 → 상시 표시 문구. ⚠ notYetVisible은 국면으로 갈린다 — "차량 접근 대기"는 대기 국면 어휘라 승차 중에 뜨면 "아직 못 탔다"로 뒤집혀 읽힌다(A16).
     *
     * 승차 뒤 세 문장(미관측·소실·확인 불가)은 **수단별 키**다(A33) — 대중교통 추적은 GPS를 쓰지 않으므로 문장이 "열차/버스 위치"를 주어로 말해야 "앱이 내 위치를 못
     * 잡는다"로 읽히지 않는다. 3-state: 아직 안 잡힘(정상, 하차역 부근에서 등장) / 잠시 끊김 / 끝내 확인 불가.
     * ⚠ `isTrain`에 기본값을 두지 않는다 — 생략이 컴파일을 통과하면 버스 승차에 "열차"가 조용히 붙는다. `unobserved`(비관측 잠금, A34 ①)도 같다 — 호출 지점 셋(상시
     * 표시·복귀 통지·조망 침묵 행)이 컴파일로 강제되어야 "하차역에 가까워지면 표시됩니다"가 폴을 하지 않는 상태에서 거짓으로 남지 않는다(리뷰 M1). 도착 국면은 신호와
     * 무관하게 "하차 지점 도착."(관측·선언 공통, A37 ②).
     */
    fun signalStatusText(signal: TransitSignal, phase: TransitPhase, isTrain: Boolean, unobserved: Boolean): String {
        if (unobserved && phase == TransitPhase.riding) {
            return if (isTrain) strings.get("transitGuide.stateRidingUnobserved") else strings.get("transitGuide.stateRidingUnobservedBus")
        }
        if (phase == TransitPhase.arrived) return strings.get("transitGuide.stateArrived")
        // 키는 리터럴로 쓴다 — `GuideSourceGuardTest` ⑧이 보간 키를 못 본다.
        return when (signal) {
            TransitSignal.tracking ->
                if (phase == TransitPhase.boarding) strings.get("transitGuide.stateApproaching") else strings.get("transitGuide.stateTracking")
            TransitSignal.notYetVisible -> when (phase) {
                TransitPhase.riding ->
                    if (isTrain) strings.get("transitGuide.stateRidingNotYetVisible") else strings.get("transitGuide.stateRidingNotYetVisibleBus")
                TransitPhase.boarding -> strings.get("transitGuide.stateBoardingNotYetVisible")
                else -> strings.get("transitGuide.stateNotYetVisible")
            }
            TransitSignal.neverSeen ->
                if (isTrain) strings.get("transitGuide.stateNeverSeen") else strings.get("transitGuide.stateNeverSeenBus")
            TransitSignal.signalLost ->
                if (isTrain) strings.get("transitGuide.stateSignalLost") else strings.get("transitGuide.stateSignalLostBus")
            TransitSignal.upstreamFailed -> strings.get("transitGuide.stateUpstreamFailed")
            TransitSignal.untrackable -> strings.get("transitGuide.stateUntrackable")
        }
    }

    /** 벽시계 epoch ms — 서버 도착 시각·떠난 열차 보존 판정. */
    private fun nowMs(): Double = wallClockMs()

    /**
     * 세션 밖 오케스트레이터(`GuideSession`)의 통지 창구 — 승차 전 도보 시작·취소·불가 문장(A25). 같은 억제 규칙을 지난다. 분류는 호출부가 밝힌다(E53 spec §3.3).
     * ⚠ `highPriority`는 기본값 없음 — 환승 도보 시작(E73)은 시트가 내려가 커서가 옮겨 가는 자리라 높은 우선순위다.
     */
    fun announceExternal(message: String, highPriority: Boolean, speechClass: GuideSpeechClass) {
        announce(message, highPriority = highPriority, speechClass = speechClass)
    }

    /**
     * 자동 통지 창구(spec 2026-08-14 §4-6 동형). 안내 효과음이 재생 중이면 그 소리가 끝난 뒤에 게시한다(지연·latest-wins·세대는 `DeferredAnnouncer` 소유).
     * 하차 임박·도착만 `highPriority`(§6.1). `speechClass`는 기본값 없는 필수 인자다(E53 spec §3 — 백그라운드에서 말하는가를 가른다). 이벤트는 Kit
     * `transitEventSpeechClass`가 정본이다.
     */
    private fun announce(message: String, highPriority: Boolean = false, speechClass: GuideSpeechClass, onDropped: (() -> Unit)? = null) {
        deferredAnnouncer.announce(message, highPriority, speechClass, onDropped)
    }

    /**
     * 사용자 활성화의 **직접 응답** 전용 즉시 창구(진행 상황·새로고침 응답·재조회 통지·경로 교체). 즉시성이 문장의 본질이라 톤과 겹치더라도 미루지 않고, 보류 슬롯은
     * 진입 즉시 버린다.
     */
    private fun announceNow(message: String, highPriority: Boolean = false, bypassSuppression: Boolean = false) {
        deferredAnnouncer.announceNow(message, highPriority, bypassSuppression)
    }

    /**
     * 안내가 낸 문장이 모두 끝났는가(E57 spec §3.3) — 톤 뒤로 미룬 문장이 없고 기기 음성 칸·안내 TTS가 비어 있다. 안내 시트의 첫 정보 행 착지가 이것을 기다린다.
     */
    fun announcementsSettled(): Boolean = !deferredAnnouncer.hasPending && !deviceSpeech.hasPending && !speaker.isSpeaking

    /**
     * 채널 선택(E53 spec §2, 판정은 :kit `guideSpeechChannel`) — 게시 시점 상태로. 안드로이드 매핑은 도보 모델과 같다: `voiceOver` = 전경 직접 발화, `device` =
     * 백그라운드 행동 문장, `drop` = 백그라운드의 주기·상태 문장과 토글 끔. 가청은 미디어 볼륨 0이 아닌가.
     */
    private fun speechChannel(speechClass: GuideSpeechClass): GuideSpeechChannel = guideSpeechChannel(
        foreground = env.isForeground(),
        voiceOverRunning = false,
        speechClass = speechClass,
        backgroundSpeechEnabled = BackgroundSpeech.isEnabled(store.getString(BackgroundSpeech.storageKey)?.toBooleanStrictOrNull()),
        backgroundAudible = !tones.isMediaVolumeZero,
        foregroundDeviceSpeech = false,
    )

    /** 낭독용 거리 풀어쓰기(iOS `spokenUnits`) — 음성 게시(`post`)에서만 한다. UI 상태 문자열엔 얹지 않는다. */
    private fun spokenUnits(text: String): String = spokenDistanceUnits(text, strings.get("android.unit.spokenMeters"))

    /**
     * 실제 게시. 지연은 타이밍만 바꾸고 억제 계약은 바꾸지 않는다 — 대기가 끝난 게시 시도도 같은 가드를 지난다. 반환 = 실제로 게시했는가.
     */
    private fun post(message: String, highPriority: Boolean, bypassSuppression: Boolean, speechClass: GuideSpeechClass, onLateDrop: (() -> Unit)?): Boolean {
        // 검색 시트(받아쓰기 마이크)가 열린 동안은 발화 0(스펙 §5.4) — 마지막 문장은 해제 시 복구(W2).
        if (!bypassSuppression && outputSuppressed) {
            droppedWhileSuppressed = DroppedText(message, speechClass)
            return false
        }
        // 채널 선택은 게시 시점 상태로(E53 spec §2, 판정은 Kit). 백그라운드에서 버리는 문장은 **발화만** 막는다(E36 §4.2.4 — 백그라운드 무발화는 실측이지 API 계약이
        // 아니라 명시 게이트로). 복귀 시 현재 상태 하나만 낭독한다(`missedAnnouncement`). 정식판은 토글 실효값이 거짓이라 종전 그대로다.
        val channel = speechChannel(speechClass)
        // 계측(E53 실사용 판정 — 백그라운드 문장 빈도): 전경 게시는 남기지 않고 백그라운드 판정만.
        if (!env.isForeground()) GuideDiag.log { "transit bgSpeech channel=${channel.rawValue} class=${speechClass.rawValue} text=$message" }
        return when (channel) {
            GuideSpeechChannel.voiceOver -> {
                val ok = speaker.speak(spokenUnits(message), highPriority) != null
                // 포커스를 못 잡거나 엔진이 없으면 게시하지 못한 것이다 — 복귀 상환이 갚고 호출부 `onDropped`가 latch를 푼다(도보 모델 동형).
                if (!ok) missedAnnouncement = true
                ok
            }
            GuideSpeechChannel.device -> {
                // 들은 문장을 복귀 때 또 말하지 않는다(E53 §4.3). 대기 칸이 나중에 버리면 상환 표식과 장부(latch)를 되살린다.
                missedAnnouncement = false
                deviceSpeech.submit(
                    spokenUnits(message), highPriority, protected = false, bypassSuppression = bypassSuppression, speechClass = speechClass,
                ) { reason ->
                    // 교체(더 새 문장이 이었다)는 상환 표식을 세우지 않는다 — 설계 리뷰 M1. 장부는 어느 쪽이든 되살린다.
                    if (reason == DeviceSpeechDrop.undelivered) missedAnnouncement = true
                    onLateDrop?.invoke()
                }
                true
            }
            GuideSpeechChannel.drop -> {
                missedAnnouncement = true
                false
            }
        }
    }

    /**
     * TTS 끊김 통지를 자기 칸으로 넘긴다. ⚠ `speaker.onInterrupted`에 직접 대입하지 않는다 — 그 칸은 지금 도보 모델이 쥐고 있다. 두 모델로의 토큰 라우팅은
     * 단계 4(`GuideSession`)가 한다(M5 §6-5).
     */
    fun speechInterrupted(token: Int, reason: DeviceSpeechDrop) {
        deviceSpeech.speechInterrupted(token, reason)
    }

    /** TTS 초기화 전에 보류된 문장이 초기화 실패·언어 미지원으로 버려졌다 — 전경 복귀 상환이 현재 상태를 다시 낸다(도보 모델 동형). */
    fun onSpeechDropped() {
        missedAnnouncement = true
    }

    private fun fmt1(x: Double): String = String.format(Locale.ROOT, "%.1f", x)
    private fun fmt2(x: Double): String = String.format(Locale.ROOT, "%.2f", x)

    private companion object {
        /** 대기 목록에서 사라진 열차를 남겨 두는 시간(A74, iOS `retainSeconds`). */
        const val retainSeconds = 180.0
    }
}

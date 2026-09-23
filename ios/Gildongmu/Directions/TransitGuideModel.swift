import Foundation
import GildongmuKit
import Observation
import SwiftUI

/// 완료 후 도보 핸드오프 제안(A안, §14.2 — 피드백 #6). done의 stop()이 세션 상태를
/// 소거하므로 시트가 이 값으로 살아남아 "남은 도보 안내 시작"을 제안한다.
struct TransitWalkHandoff: Equatable {
    let destinationLabel: String
    let walkMinutes: Int
}

/// 대중교통 실시간 안내 오케스트레이터(B2 §4·§7). **판정은 전부 Kit이 하고 여기는
/// 배선만 한다**(BeaconModel 관례): 상태 머신은 `transitGuideStep`, 폴 대상·주기·
/// 잠금·사다리 전부 Kit, 이 클래스는 폴링 I/O·통지 게시·수명만 담당한다.
///
/// - **단일 비행**: 한 Task 루프가 폴 → 커밋 → sleep(적응 주기)을 반복한다.
///   국면 전이(탑승·전환)는 루프를 재시작해 즉폴한다.
/// - 통지: 앱 단일 Announcement 채널. **잔여 1·도착만 .high**(§6.1 예외 둘 —
///   놓친 하차의 회수 비용이 커서 사용자 여정의 직접 응답으로 정당화. 실승차 판정
///   대상). 게시 전 코얼레싱은 최신 이벤트가 이전 문자열을 대체하는 구조로 성립.
/// - 전경 전용(§3.2): 백그라운드는 폴 정지, 복귀는 즉폴 + 재개 통지.
/// - 세션 단일성: GuideSessionCoordinator(도보·자동차와 상호 배제).
@Observable @MainActor
final class TransitGuideModel {
    private(set) var state: TransitGuideState?
    private(set) var route: TransitGuideRoute?
    private(set) var destinationLabel = ""
    /// 목적지 좌표(N1) — 세션이 탭과 분리되면서 도보 핸드오프·장소 상세가 탭 폼이
    /// 아니라 여기서 읽는다. `stop()`이 비우지 않는다(핸드오프 제안이 세션 뒤에 읽는다).
    private(set) var dest: BeaconDest?
    /// 세션 시작 시점의 계단 회피 여부 — 도보 핸드오프가 승계한다(세션 내내 유효,
    /// `BeaconModel.begin` 계약 동형). ⚠ 기본값 없음(안전 인자).
    private(set) var accessible = false
    /// 대기 목록 스냅숏(§5.1): 현재 폴 항목 + 소실 항목(3분 유지, 관측 경과 분).
    private(set) var waitingLive: [TransitTrackItem] = []
    private(set) var waitingDeparted: [(item: TransitTrackItem, minutes: Int)] = []
    /// 마지막 대기 폴의 0건 사유(§13.3) — 항목이 있으면 nil.
    private(set) var waitingReason: TransitWaitingEmptyReason?
    /// 완료 후 도보 핸드오프 제안(§14.2) — 세션 밖 수명(stop()이 소거하는 상태와
    /// 별도 보존). 시트 presentation이 isTracking ∨ 이 값으로 확장된다.
    private(set) var pendingWalkHandoff: TransitWalkHandoff?
    /// 목적지 전환 준비 상태(스펙 2026-08-12 §4). nil = 진행 중인 전환 없음.
    /// 확정 전에는 세션·폼 어느 것도 변하지 않는다(2단 확정 단위).
    struct PendingDestChange {
        let dest: BeaconDest
        let label: String
        var phase: Phase
        var fetchedAt: Date?
        enum Phase: Equatable { case loading, loaded(TransitRouteResult), empty, failed }
    }
    private(set) var pendingDestChange: PendingDestChange?

    /// 조망 "다른 경로"(E15-1 spec §5) — 목적지 전환과 **별도 슬롯**. 한 슬롯을 source
    /// 플래그로 나눠 쓰면 메뉴에서 고른 새 목적지 후보가 조망 요청에 덮이고, 한쪽의
    /// 지연된 dismiss가 다른 쪽의 새 요청을 취소한다(설계 리뷰 A3·A4). 슬롯이 다르면
    /// 둘 다 구조적으로 불가능하다.
    struct PendingAltRoutes {
        /// 출발점의 근거 — 커밋 가드가 이 값의 변화를 본다(§5.4 "시간이 아니라 근거").
        enum OriginEvidence: Equatable {
            case gps
            /// 신선한 추적 관측의 현재역(조망 here == station).
            case station(stopIndex: Int)
            /// 사용자가 "{승차역} 기준으로 조회"를 눌러 선언했다(앱이 추정하지 않는다).
            case boardStopDeclared
        }
        enum FailReason: Equatable { case noLocation, fetch }
        enum Phase: Equatable { case loading, loaded(TransitRouteResult), empty, failed(FailReason) }
        let token: Int
        /// 조회 시작 시점의 국면 세대·구간 — 커밋 시 현재와 다르면 재조회.
        let phaseGen: Int
        let legIndex: Int
        var origin: OriginEvidence?
        var phase: Phase
        var fetchedAt: Date?
    }
    private(set) var pendingAltRoutes: PendingAltRoutes?
    private var altRoutesToken = 0

    /// 조망 디스크립터(Kit 순수 계층) — 세션이 없으면 nil. 승차 중 현재역(E35)은 기존 판정 위에 **후처리**로
    /// 얹는다(`transitProgressOverview`·그 fixture·안드로이드 이식본은 그대로). 이 값을 읽는 조망·다른 경로
    /// 출발점이 같은 "현재역"을 본다. ⚠ 주변 확인 앵커는 이 값을 읽지 않는다(원시 판정 — 시트 `surroundingsSection`).
    var overview: TransitOverview? {
        guard let state, let route else { return nil }
        let base = transitOverviewApplyingPosition(
            transitProgressOverview(state: state, route: route),
            state: state, position: ridingPosition, now: positionClock)
        // 버스 승차 중 현재 정류장(E48) — 기기 위치 표식. E35 후처리와는 다른 leg 종류에서만 일한다.
        guard let leg = currentLeg else { return base }
        return transitOverviewApplyingBusStop(base, state: state, leg: leg, mark: busStopMark)
    }

    /// 승차 중 현재역(E35 spec §4) — 상태 머신 **밖**의 표시 상태. 리듀서는 이 값을 모르고 판정에 쓰지 않는다.
    private(set) var ridingPosition: TransitRidingPosition?
    /// 보존 창 판정의 "지금"(ms) — 조회 시점에 굳힌다(뷰가 렌더마다 시계를 읽지 않게, 웹 `positionClock` 동형).
    private(set) var positionClock: Double = 0
    /// 버스 승차 중 현재 정류장(E48 spec 2026-09-23 bus-current-stop §2·§4.3) — keep-alive fix로 채우는 **표시 전용**
    /// 상태(리듀서 밖). 뷰가 읽는 것은 시각이 빠진 표식이고 **바뀔 때만** 쓴다(추적 상태는 fix마다 바뀌어 관측 밖에
    /// 둔다 — 설계 리뷰 m3). 만료는 폴 시계가 아니라 마지막 관측 + 보존 창에 맞춘 타이머가 판정한다(설계 리뷰 M2).
    private(set) var busStopMark: TransitBusStopMark?
    @ObservationIgnored private var busStopTracker: TransitBusStopTracker?
    @ObservationIgnored private var busStopExpiryTask: Task<Void, Never>?
    /// 계측 `busFix` 줄의 직전 (판정, 최근접, 래치) — 바뀔 때만 쓴다(fix는 초 단위로 온다).
    @ObservationIgnored private var lastBusFixLog: (verdict: TransitBusStopVerdict, nearest: Int?, latched: Int?)?
    /// 현재역이 잡혀 있어 보류한 `neverSeen` 경고의 결박(spec §6 판정 2) — 폴마다 처분한다.
    @ObservationIgnored private var neverSeenPending: TransitPositionBinding?
    @ObservationIgnored private let positionService = TransitPositionService(
        client: APIClient(baseURL: AppConfig.apiBaseURL))

    /// 경유역 목록의 "현재 위치" index — 도착 `arvlMsg3`·실시간 열차 위치(E35)·버스 기기 위치(E48) 중 큰 값
    /// (조인은 한국어 원문).
    var viaStopHereIndex: Int? {
        guard let state, let leg = currentLeg else { return nil }
        return transitViaStopHereIndexWithBusStop(
            state: state, leg: leg, position: ridingPosition, busStop: busStopMark, now: positionClock)
    }

    /// 신호 문장 자리를 차지할 현재역 문장(E35 §6 판정 1) — 도착 피드 미관측 구간에 위치가 잡혀 있을 때만.
    /// 상시 표시·조망 silence 행·복귀 낭독이 같은 선택을 지난다. `now`는 호출자가 고른다(렌더는 조회 시계,
    /// 복귀 낭독은 지금 — 백그라운드 동안 창이 지났을 수 있다).
    func positionStatusText(state: TransitGuideState, leg: TransitGuideLeg, now: Double) -> String? {
        guard let index = transitPositionStatusIndex(state: state, position: ridingPosition, now: now)
        else { return nil }
        let stops = displayLeg(leg, useOverride: false).stops
        guard stops.indices.contains(index) else { return nil }
        return TransitGuideTextRenderer.render(transitCurrentStationLine(isEn: transitGuideIsEn, location: stops[index]))
    }

    enum AltRouteCommit { case committed, refetching, invalidCandidate, sessionEnded }

    var isTracking: Bool { state != nil }
    var currentLeg: TransitGuideLeg? {
        guard let state, let route else { return nil }
        return route.legs.indices.contains(state.legIndex) ? route.legs[state.legIndex] : nil
    }

    private let trackService = TransitTrackService(client: APIClient(baseURL: AppConfig.apiBaseURL))
    private let tones = BeaconTonePlayer(label: "transit")
    /// 추세 톤 계층 상태(E15 ②, spec 2026-09-02 §2). 판정은 Kit `transitToneStep`, 여기는 재생만.
    private var toneState = TransitToneState.initial
    /// 발화 지연 슬롯(spec 2026-08-14, BeaconModel 동형 — 2026-09-02 E15 ② 설계 리뷰 #5로 채택):
    /// 안내 효과음이 재생 중이면 그 잔여만큼 통지를 미룬다. 종전엔 톤 직후 즉시 게시라 임박
    /// 0.73초·도착 종 2.25초가 문장 앞머리를 잘라 먹었다. 수명 계약(latest-wins·세대·재평가)은
    /// Kit 타입이 소유하고 여기는 톤 잔여·실제 게시를 클로저로 주입만 한다.
    @ObservationIgnored private lazy var deferredAnnouncer = DeferredAnnouncer(
        clock: { ProcessInfo.processInfo.systemUptime },
        toneEndsAt: { [weak self] in self?.tones.toneEndsAt },
        post: { [weak self] text, high, bypass in
            self?.post(text, highPriority: high, bypassSuppression: bypass) ?? false
        }
    )
    /// 직전 폴 시작의 단조 시각(초) — `pollStart sinceLast=` 계측(A16 미확정 ②).
    private var lastPollStartAt: Double?
    /// 이 폴을 예약한 주기(ms). 즉폴은 nil — 로그에 `planned=-`.
    private var plannedIntervalMs: Int?
    private var sessionToken: Int?
    private var pollTask: Task<Void, Never>?
    private var seq = 0
    private var retained: [String: (item: TransitTrackItem, lastSeenAt: Date)] = [:]
    // ⚠ 키는 (legIndex, 대상 정류소) 복합 — legIndex만 쓰면 waiting에서 해석한
    // 승차 정류소가 riding 캐시로 적중해 하차 카운트다운이 승차 정류소 도착을
    // 읽는다(독립 리뷰 BLOCKER).
    private var tagoResolved: [String: TransitTrackResolvedStop] = [:]
    private var tagoUnsupported: Set<String> = []
    /// 백그라운드를 거쳤는가 — 복귀 낭독 분기(`BeaconModel.wasBackgrounded` 동형). `.inactive` 왕복은 세지 않는다.
    /// ⚠ 종전 `pausedInBackground`(백그라운드 = 폴 정지)는 E36(2026-09-11)으로 폐지 — 폴은 국면·주기·유휴만 본다.
    private var wasBackgrounded = false
    /// 백그라운드에서 게시하지 못한 통지가 있었는가. 복귀 시 **현재 상태 하나만** 낭독한다(spec 2026-09-11 §4.2.4).
    private var missedAnnouncement = false
    /// 마지막 사용자 조작의 단조 시각(초) — 유휴 폴 정지 축(spec §4.2.6). 세션 시작·모든 사용자 입력·전경 복귀가 갱신.
    private var lastUserActionAt: Double = 0
    /// 유휴 폴 정지 중(잊힌 세션 안전망 — 세션은 유지, 폴·keep-alive만 멈춘다). 어떤 조작·전경 복귀든 푼다.
    private(set) var idlePaused = false
    /// 대중교통 keep-alive 위치 스트림을 우리가 열어 두었는가((boarding ∨ riding) ∧ 폴 주기 > 0 ∧ 유휴 아님).
    private var keepAliveActive = false
    private var keepAliveDeniedLogged = false
    /// 승격 실패("화면이 꺼지면 소리가 나지 않는다") 문장 세션당 1회 latch — 판정은 매 톤(M7), 문장은 한 번.
    private var soundDegradedAnnounced = false
    /// 백그라운드 소리 불가 진동의 세션당 1회 래치(문장 래치와 분리, `start`에서 리셋).
    private var soundDegradedHapticFired = false
    /// 다음 대기 폴 결과를 직접 응답으로 통지(새로고침, §13.2) — 폴 1회 소비.
    private var refreshAnnounce = false
    /// 목적지 전환 조회의 latest-wins 토큰(스펙 §4.1) — 취소·재시도가 늦은 응답을 폐기.
    private var destChangeToken = 0
    /// 검색 시트가 열린 동안 통지·톤 억제(스펙 §5.4, BeaconModel 동형 — 받아쓰기
    /// 전사 오염 방지). stop()이 무조건 해제한다(잔류 억제로 다음 세션 무음 방지).
    var outputSuppressed = false {
        didSet {
            tones.isSuppressed = outputSuppressed
            // 억제 해제(a11y 감사 W2, 2026-09-02): 억제 중 게시하지 못한 **마지막** 자동 문장을 되살린다.
            // 도착·neverSeen처럼 세션에 1회뿐인 문장은 다음 폴이 대신 말해 주지 않고, 그 문장만이
            // 행동("탑승 변경을 눌러 주세요")을 담는다(memory once-only-warning-delivery-contract).
            if !outputSuppressed, let text = droppedWhileSuppressed {
                droppedWhileSuppressed = nil
                announce(text)
            }
        }
    }
    /// 억제 중 `post`가 버린 마지막 자동 문장(latest-wins) — 해제 시 1회 복구. stop()이 지운다.
    private var droppedWhileSuppressed: String?
    private let routeService = RouteService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    private static let retainSeconds: TimeInterval = 180
    /// stale 후보 문턱(스펙 §4.2, 잠정값 — 실사용 판정 대상): 조회 시점 위치의
    /// 스냅샷인 후보를 이동 후에도 확정하는 경로를 막는다.
    private static let destChangeStaleSeconds: TimeInterval = 120

    // MARK: - 세션 수명

    /// 시작. 거부 판정(N1 §2.4)이 route 변환보다 먼저다(설계 리뷰 m2 — 변환 실패가
    /// 먼저 조용히 반환하면 요구된 거부 통지조차 없다).
    func start(transitRoute: TransitRoute, destinationLabel: String, dest: BeaconDest, accessible: Bool) {
        guard !GuideSession.shared.isActive,
              let token = GuideSession.shared.coordinator.claim(stop: { [weak self] in self?.stop() })
        else {
            // 거부는 버튼 활성화의 직접 응답이라 받아쓰기 억제를 우회한다(비콘
            // `requestStart` 동형 — 코드 리뷰 m1). 창구는 GuideSession의 단일 창구.
            GuideSession.shared.beacon.announceNow(
                appLocalized("guide.alreadyActive"), highPriority: true, bypassSuppression: true)
            return
        }
        guard let guideRoute = buildTransitGuideRoute(transitRoute) else {
            GuideSession.shared.coordinator.release(token)
            return
        }
        beginSession(guideRoute: guideRoute, token: token, destinationLabel: destinationLabel,
                     dest: dest, accessible: accessible)
    }

    /// 승차 전 도보 뒤의 시작(A25 spec 2026-08-30 §4.1) — `start`와 같은 게이트, 같은 세션 초기화.
    /// `prewalkCompleted`가 true면 첫 leg의 도보 문맥을 지운 경로로 시작한다(걸어서 도착한 뒤
    /// "도보 5분 이동 후"를 다시 말하면 지난 일을 미래형으로 말하는 거짓). 시작 실패로 넘어온
    /// 경우는 false — 사용자는 아직 걷지 않았다. ⚠ 기본값 없음(안전 인자).
    func startAfterPrewalk(
        transitRoute: TransitRoute, destinationLabel: String, dest: BeaconDest,
        accessible: Bool, prewalkCompleted: Bool
    ) {
        guard !GuideSession.shared.isActive,
              let token = GuideSession.shared.coordinator.claim(stop: { [weak self] in self?.stop() })
        else {
            GuideSession.shared.beacon.announceNow(
                appLocalized("guide.alreadyActive"), highPriority: true, bypassSuppression: true)
            return
        }
        guard let built = buildTransitGuideRoute(transitRoute) else {
            GuideSession.shared.coordinator.release(token)
            return
        }
        beginSession(guideRoute: prewalkCompleted ? withoutPrewalk(built) : built, token: token,
                     destinationLabel: destinationLabel, dest: dest, accessible: accessible)
    }

    /// 게이트를 지난 뒤의 세션 초기화 공통부(`start`·`startAfterPrewalk`).
    private func beginSession(
        guideRoute: TransitGuideRoute, token: Int, destinationLabel: String,
        dest: BeaconDest, accessible: Bool
    ) {
        pendingWalkHandoff = nil
        sessionToken = token
        self.route = guideRoute
        self.destinationLabel = destinationLabel
        self.dest = dest
        self.accessible = accessible
        seq = 0
        retained = [:]
        tagoResolved = [:]
        tagoUnsupported = []
        // 다음 세션의 phaseGen도 0에서 시작한다 — 옛 위치 결박이 같은 세대·열차로 되살아나지 않게.
        ridingPosition = nil
        clearBusStop()
        neverSeenPending = nil
        toneState = .initial
        lastPollStartAt = nil
        plannedIntervalMs = nil
        deferredAnnouncer.advanceGeneration()
        wasBackgrounded = false
        missedAnnouncement = false
        idlePaused = false
        soundDegradedAnnounced = false
        soundDegradedHapticFired = false
        keepAliveDeniedLogged = false
        lastUserActionAt = ProcessInfo.processInfo.systemUptime
        state = initTransitGuide(route: guideRoute, now: nowMs())
        UIApplication.shared.isIdleTimerDisabled = true
        // 오디오 승격은 **첫 톤보다 먼저**(BeaconModel 동형, E36 §4.2.1). 종전엔 대중교통이 승격을 한 번도
        // 하지 않아 톤이 전부 `.ambient`였고 — `.ambient`는 정의상 백그라운드 무음이다.
        tones.beginSession()
        playTone(.start, allowedInBackground: false)
        let first = guideRoute.legs[0]
        // E40: 시작 통지가 목적지를 말한다 — 시트 진입 착지는 상태 문장이라(E38) 목적지를 만날 채널이 없다.
        var parts = [
            appLocalized("transitGuide.startedAt", destinationLabel, guideRoute.legs.count),
            waitContextText(first, isCurrentLeg: true),
        ]
        if first.trackMode == nil { parts.append(appLocalized("transitGuide.untrackable")) }
        announce(parts.joined(separator: " "))
        restartPollLoop(immediate: true)
    }

    func stop(playStopTone: Bool = false) {
        if let token = sessionToken {
            sessionToken = nil
            GuideSession.shared.coordinator.release(token)
        }
        pollTask?.cancel()
        pollTask = nil
        UIApplication.shared.isIdleTimerDisabled = false
        // 세션 경계 — 보류 문장을 버린다(끝난 세션의 문장이 다음 세션 안에서 나오지 않게).
        deferredAnnouncer.advanceGeneration()
        toneState = .initial
        lastPollStartAt = nil
        plannedIntervalMs = nil
        if playStopTone, state != nil { playTone(.stop, allowedInBackground: false) }
        // 원복은 정지 톤 **뒤에**(재생 잔여만큼 미뤄진다). 다른 재생기가 그 사이 세션을 시작하면
        // 원복 의무가 그쪽으로 넘어간다(`.ownershipTransferred`, 설계 리뷰 B2).
        tones.endSession()
        if keepAliveActive {
            LocationService.shared.stopKeepAliveUpdates()
            keepAliveActive = false
            transitGuideLog("keepAlive stop reason=sessionEnd")
        }
        state = nil
        route = nil
        ridingPosition = nil
        clearBusStop()
        neverSeenPending = nil
        waitingLive = []
        waitingDeparted = []
        waitingReason = nil
        retained = [:]
        tagoResolved = [:]
        tagoUnsupported = []
        wasBackgrounded = false
        missedAnnouncement = false
        idlePaused = false
        refreshAnnounce = false
        pendingWalkHandoff = nil
        droppedWhileSuppressed = nil
        expressBlockedNote = nil
        boardOverrideIndex = nil
        aboardStep = nil
        boardingManualAvailable = false
        selectedDescription = nil
        reboardPickerActive = false
        // 목적지 전환 준비·억제도 세션과 함께 소거(스펙 §5.4 — 잔류 억제 금지).
        destChangeToken += 1
        pendingDestChange = nil
        altRoutesToken += 1
        pendingAltRoutes = nil
        outputSuppressed = false
    }

    /// 핸드오프 제안 소거(§14.2) — 시트 닫기·수락 시 호출(세션은 이미 종료 상태).
    func clearWalkHandoff() {
        pendingWalkHandoff = nil
    }

    func teardown() {
        stop()
        tones.shutdown()
    }

    /// E36(2026-09-11): 백그라운드에서도 폴은 계속된다(정지 축은 국면·주기·유휴뿐). 여기서 하는 일은
    /// 복귀 낭독과 복귀 즉폴이다. ⚠ 복귀 즉폴은 예산 항목이 아니라 **3-state 정직성의 방어선** —
    /// 프로세스가 재워진 동안 끊긴 요청은 `.failed`로 도착하는데, 즉폴이 옛 태스크를 취소하고
    /// `pollOnce`의 취소 가드가 그 결과를 버린다(설계 리뷰 O2).
    func handleScenePhaseChange(to phase: ScenePhase) {
        guard isTracking else { return }
        // 계측(A16 미확정 ②): 백그라운드 구간의 폴 지속은 `pollStart sinceLast`가 증거다.
        transitGuideLog("scene phase=\(phase) tracking=\(isTracking) idle=\(idlePaused)")
        switch phase {
        case .background:
            wasBackgrounded = true
        case .inactive:
            break
        case .active:
            guard wasBackgrounded else { return }
            wasBackgrounded = false
            let resumedFromIdle = idlePaused
            // 화면을 켠 것은 조작이다 — 유휴 정지 중이었으면 여기서 "안내를 재개합니다. {상태}"와 즉폴.
            touchUserAction()
            if !resumedFromIdle {
                // 복귀 낭독은 백그라운드에서 버린 통지가 있을 때만, 현재 상태 하나(누적 재생 금지).
                if missedAnnouncement {
                    // 화면 변화 없는 통지라 `.high`(CLAUDE.md 통지 우선순위 판별선 — 착지 라벨로 대체될 수 없다).
                    let text = returnStatusText()
                    if !text.isEmpty { announce(text, highPriority: true) }
                }
                restartPollLoop(immediate: true)
            }
            missedAnnouncement = false
        @unknown default:
            break
        }
    }

    /// 복귀 낭독 문장: 신호가 `neverSeen`(식별 잠금)이면 탈출구를 담은 1회성 행동 문장, 그 밖은 상태 문장.
    /// 상태 문장 `stateNeverSeen`("열차 위치를 끝내 확인하지 못했습니다.")에는 "탑승 변경을 눌러 주세요"가
    /// 없다 — 억제 해제 복구(`droppedWhileSuppressed`)와 같은 근거(memory once-only-warning-delivery-contract).
    private func returnStatusText() -> String {
        guard let s = state, let leg = currentLeg else { return "" }
        // 현재역이 잡혀 있으면 그것이 상태다(E35 §6). 창은 **지금** 시각으로 — 백그라운드 동안 지났을 수 있다.
        if let located = positionStatusText(state: s, leg: leg, now: nowMs()) { return located }
        let unobserved = s.lock.map(transitLockIsUnobserved) ?? false
        if s.signal == .neverSeen, !unobserved { return appLocalized("transitGuide.neverSeen") }
        return signalStatusText(s.signal, phase: s.phase, isTrain: leg.mode == "subway", unobserved: unobserved)
    }

    // MARK: - 유휴 폴 정지·keep-alive (E36 spec 2026-09-11 §4.2.3·§4.2.6)

    /// 게시 시점 조회(캐시 플래그 금지 — BeaconModel 동형): `scenePhase` 전이를 한 번 놓쳐도 전경 발화가
    /// 영구 소실되지 않는다. `.inactive`(제어센터·알림 센터)는 화면을 보고 있는 중이라 전경이다.
    /// 시트의 착지 헬퍼도 본다(A35 L4) — 백그라운드엔 VO 커서가 없어 착지 시도가 무의미하고 판정 로그를 오염시킨다.
    var isForeground: Bool {
        UIApplication.shared.applicationState != .background
    }

    /// 사용자 조작 표식 — 모든 사용자 입력(`dispatch` 비폴 입력·새로고침·역 선택·조망·목적지/경로 변경)과
    /// 전경 복귀가 부른다. 유휴 정지 중이었으면 재개한다. 시트가 직접 부르는 자리는 역 상세 열기(E33)
    /// 하나 — 착지 재시도(A35)는 조작이 아니라 부르지 않는다.
    func touchUserAction() {
        noteUserAction()
        resumeIfIdle()
    }

    private func noteUserAction() {
        lastUserActionAt = ProcessInfo.processInfo.systemUptime
    }

    /// 유휴 정지 중이었으면 재개. 재개 문장은 **즉시 창구·`.high`** — 사용자 조작의 직접 응답이고 화면 변화
    /// 없이 "폴이 멈춰 있었다"를 전하는 유일한 증거다(지연 창구에 두면 바로 뒤 `announceNow`(새로고침·조망)가
    /// 선점해 버린다 — 코드 리뷰 C5).
    private func resumeIfIdle() {
        guard idlePaused else { return }
        idlePaused = false
        transitGuideLog("idleResume")
        // "안내를 재개합니다."는 폴이 실제로 멈췄던 이 자리에서만 참이다(백그라운드 복귀에서는 뗐다).
        var parts = [appLocalized("transitGuide.resumed")]
        let status = returnStatusText()
        if !status.isEmpty { parts.append(status) }
        announceNow(parts.joined(separator: " "), highPriority: true)
        updateKeepAlive()
        restartPollLoop(immediate: true)
    }

    /// 폴 루프가 다음 폴 직전에 부른다. 마지막 조작 이후 한계(`transitIdlePollLimitMs`: max(30분, 2×구간 소요))를
    /// 넘겼으면 폴·keep-alive를 멈춘다(세션 유지). 잊힌 세션이 밤새 공유 쿼터를 태우고 위치 스트림을 켜 두는
    /// 것을 막는다 — 종전엔 `pausedInBackground`가 우연히 막고 있었다(설계 리뷰 B3).
    private func enterIdleIfDue() -> Bool {
        let now = ProcessInfo.processInfo.systemUptime
        let limitSeconds = transitIdlePollLimitMs(legMinutes: currentLeg?.minutes) / 1000
        let sinceAction = now - lastUserActionAt
        guard sinceAction >= limitSeconds else { return false }
        idlePaused = true
        // 폴·keep-alive가 멈추면 fix도 만료 판정도 오지 않는다 — 표식을 남기면 재개 전까지 옛 정류장을 무기한 말한다
        // (설계 리뷰 M4). 재개 뒤 첫 fix들이 다시 세운다.
        clearBusStop()
        transitGuideLog("idlePause sinceAction=\(Int(sinceAction))s limit=\(Int(limitSeconds))s")
        // 정지 톤(도보 유휴 종료 동형 — 종전엔 문장만 있어 소리·진동 채널이 비어 있었다). 전경에서만:
        // 잠근 채 잊은 휴대전화가 한참 뒤 울리면 당황스럽다(BeaconModel 유휴 종료와 같은 판정).
        playTone(.stop, allowedInBackground: false)
        // 정지 사실은 화면이 바뀌지 않아 통지가 유일한 증거다(CLAUDE.md 통지 우선순위 → `.high`).
        // 재개 문장(`resumeIfIdle`)과 달리 **자동 통지 창구**로 보낸다 — 사용자 활성화의 응답이 아니라
        // 타이머 판정이라 톤이 울리는 중이면 그 뒤에 말해야 한다(`announceNow`는 즉시 창구 전용).
        // 재개 방법을 덧붙이지 않는다(위원장 판정 2026-09-11 — BACKLOG E36).
        // 백그라운드 정지는 `post`의 전경 게이트가 버리고, 전경 복귀가 곧 조작이라
        // `resumeIfIdle`의 재개 문장이 그 자리를 대신한다(뒤늦은 "멈추었습니다"를 남기지 않는다).
        announce(appLocalized("transitGuide.idlePaused"), highPriority: true)
        transitGuideLog("idlePaused announced fg=\(isForeground)")
        updateKeepAlive()
        return true
    }

    /// (boarding ∨ riding) ∧ 폴 주기 > 0 ∧ 유휴 아님이면 keep-alive 스트림을 켜고, 아니면 끈다. 권한이 없으면
    /// 열지 않고 로그 한 줄(세션당 1회) — 권한 팝업을 새로 띄우지 않는다. boarding을 넣은 것은 A46(위원장 판정
    /// 2026-09-23): 고른 차량을 기다리다 화면을 끄면 앱이 잠들어 도착 관측(`boarded(observed)`)을 놓쳤다.
    private func updateKeepAlive() {
        let wants: Bool = if let state, state.phase == .boarding || state.phase == .riding, !idlePaused,
            transitPollIntervalMs(state) > 0 {
            true
        } else {
            false
        }
        if wants {
            // 버스 승차 중이면 정류장을 가를 수 있는 정밀도로 올린다(E48 §4.2) — 그 밖(지하철·boarding)은 저정밀 그대로.
            // 켜는 조건은 표식의 적용 조건 그 자체다(경유 정류장이 없는 구간에 배터리를 쓰지 않게, 구현 리뷰 m4).
            // 국면 전이·구간 전진·유휴 정지가 모두 이 함수를 지나므로 매번 반영한다. ⚠ 버스 승차의 정상 흐름은
            // boarding에서 이미 켜진 keep-alive를 riding에서 올리는 이 분기다(A46) — 시작 분기만 보고 빼지 말 것.
            let busRiding: Bool = if let state, let leg = currentLeg {
                transitBusStopApplies(state: state, leg: leg)
            } else {
                false
            }
            if keepAliveActive {
                if LocationService.shared.setKeepAliveBusRiding(busRiding) {
                    transitGuideLog("keepAlive profile=\(busRiding ? "bus" : "default")")
                }
                return
            }
            if LocationService.shared.startKeepAliveUpdates() {
                keepAliveActive = true
                LocationService.shared.keepAliveFixSink = { [weak self] fix in self?.ingestKeepAliveFix(fix) }
                LocationService.shared.setKeepAliveBusRiding(busRiding)
                transitGuideLog("keepAlive start profile=\(busRiding ? "bus" : "default")")
            } else if !keepAliveDeniedLogged {
                keepAliveDeniedLogged = true
                transitGuideLog("keepAlive denied")
            }
        } else if keepAliveActive {
            LocationService.shared.stopKeepAliveUpdates()
            keepAliveActive = false
            transitGuideLog("keepAlive stop reason=\(idlePaused ? "idle" : "phase")")
        }
    }

    /// 표식을 다시 판정해 **바뀔 때만** 쓰고(@Observable은 같은 값 대입에도 뷰를 다시 그린다), 표식이 서 있으면
    /// 마지막 관측 + 보존 창에 한 번 더 판정하도록 타이머를 건다 — fix가 끊긴 터널에서도 창이 정확히 닫힌다.
    private func refreshBusStopMark(now: Double) {
        let mark: TransitBusStopMark? = if let state, let leg = currentLeg {
            transitBusStopMark(state: state, leg: leg, tracker: busStopTracker, now: now)
        } else {
            nil
        }
        if mark != busStopMark { busStopMark = mark }
        busStopExpiryTask?.cancel()
        busStopExpiryTask = nil
        guard mark != nil, let at = busStopTracker?.lastObservedAt else { return }
        let delayMs = max(0, at + transitBusStopHoldMs - now) + 1
        busStopExpiryTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(delayMs))
            guard !Task.isCancelled, let self else { return }
            self.refreshBusStopMark(now: self.nowMs())
        }
    }

    private func clearBusStop() {
        busStopTracker = nil
        busStopMark = nil
        busStopExpiryTask?.cancel()
        busStopExpiryTask = nil
        lastBusFixLog = nil
    }

    /// keep-alive fix 한 건(E48 §4.3) — 판정은 Kit, 여기는 반영·계측만.
    private func ingestKeepAliveFix(_ fix: LocationService.BeaconFixPayload) {
        guard let state, let leg = currentLeg else { return }
        let age = -fix.timestamp.timeIntervalSinceNow
        let now = nowMs()
        let result = transitBusStopStep(
            busStopTracker, state: state, leg: leg,
            fix: TransitDeviceFix(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, ageSeconds: age),
            now: now)
        busStopTracker = result.tracker
        refreshBusStopMark(now: now)
        guard result.verdict != .notApplicable else { return }
        // 계측: 판정 종류나 래치가 바뀔 때만 1줄 — 실승차 사후에 부정확·노선 밖·모호를 가르는 유일한 증거.
        let latched = result.tracker?.stopIndex
        if lastBusFixLog?.verdict != result.verdict || lastBusFixLog?.nearest != result.nearestIndex
            || lastBusFixLog?.latched != latched {
            lastBusFixLog = (result.verdict, result.nearestIndex, latched)
            transitGuideLog("busFix verdict=\(result.verdict.rawValue)"
                + " idx=\(result.nearestIndex.map(String.init) ?? "-") latched=\(latched.map(String.init) ?? "-")"
                + " acc=\(Int(fix.accuracy.rounded())) age=\(String(format: "%.1f", age))s")
        }
    }

    // MARK: - 사용자 액션

    /// "탑승" = 차량 선택(N3). 식별자 잠금은 boarding으로 들어가 승차 정류소 도착을
    /// 기다린다 — riding 승격은 상태 머신이 관측으로 한다. `description`은 선택 차량의
    /// 안정 설명(행선·방향 — 폴마다 바뀌는 완성 문장은 제외)으로 상시 표시·통지에 쓴다.
    /// dispatch **전에** 동기로 보관해 vehicleSelected 통지가 빈 설명을 읽지 않는다.
    func board(item: TransitTrackItem, description: TransitLabel?) {
        guard let leg = currentLeg, let trackMode = leg.trackMode else { return }
        // 선택 진입점의 차단 재판정(A16 L1, 설계 리뷰 2차 #3): 시트 버튼 유무에만 기대면 다른 호출
        // 경로가 결정적 미도달 열차를 잠근다. 같은 술어(`transitUnreachableReason`)로 여기서도 거른다.
        guard transitUnreachableReason(item, leg: leg) == nil else {
            transitGuideLog("board rejected unreachable vehicle=\(item.vehicleId ?? "-")")
            return
        }
        let lock = TransitLock(
            mode: trackMode,
            routeId: leg.routeId ?? subwayIdForOdsayLine(leg.lineName) ?? "",
            direction: item.direction,
            vehicleId: item.vehicleId ?? ""
        )
        selectedDescription = description
        dispatch(.board(lock))
        restartPollLoop(immediate: true)
    }

    /// 선택 차량 설명(boarding 상시 표시·통지). 탑승 변경으로 waiting에 돌아가도
    /// 남긴다 — "탑승 변경 취소"(restoreBoarding)가 같은 차량으로 복귀하기 때문이다.
    /// 소거는 새 선택·전진·세션 종료.
    /// ⚠ **문자열이 아니라 ko·en 쌍이다**(E27 잔여 ①). 선택 시점의 렌더 문자열을 얼려 두면 세션
    /// 도중 언어를 바꿨을 때 그 조각만 옛 언어로 남는다 — 값을 쌍으로 들고 렌더가 고른다.
    private(set) var selectedDescription: TransitLabel?

    /// boarding 국면에 수동 진행 수단([선택한 열차에 탔어요])을 세울 것인가(N3 ①, spec
    /// `2026-09-11-boarding-manual-advance-design.md` §4.1). 판정은 Kit 순수 술어이고 여기서
    /// **래치**한다 — 신호가 회복하면(`upstreamFailed`→`notYetVisible`, `signalLost`→`tracking`)
    /// 버튼이 사라져 포커스를 쥔 컨트롤이 폴 한 번에 제거된다(헌장 §5). 관측이 돌아와도 수동
    /// 수단이 남는 것은 해롭지 않다(실제로 탔다면 여전히 맞는 버튼이다).
    private(set) var boardingManualAvailable = false

    /// "선택한 열차에 탔어요"(boarding → riding 사용자 선언). 종전 [탑승했습니다]와 같은 입력이고
    /// **언제 낼 수 있는가**만 좁혔다(N3 ①).
    func confirmBoarded() {
        guard state?.phase == .boarding else { return }
        dispatch(.confirmBoarded)
        restartPollLoop(immediate: true)
    }

    func boardApprox() {
        guard let leg = currentLeg, leg.trackMode == .tagoBus else { return }
        dispatch(.board(TransitLock(mode: .tagoBus, routeId: leg.lineName, direction: "", vehicleId: "")))
        restartPollLoop(immediate: true)
    }

    func advance() {
        completeOrAdvance(announceDone: true)
    }

    /// 마지막 leg의 단일 버튼 "남은 도보 안내 시작"(E34, spec 2026-09-11 §4.3): `advance`와 같은 전이이되
    /// 완료 문장 `doneWalk`를 내지 않는다 — 그 문장은 어차피 `acceptWalkHandoff`의 `stop()`이 지연 슬롯째
    /// 취소하고(설계 리뷰 M3), 도착 통지(`arrivedWalkNext`)가 이미 도보 분을 말했다. 우연이 아니라 설계로
    /// 침묵시킨다. 반환 = 말미 도보 인계가 남았는가(false면 시트가 인계를 부르지 않는다 — 전이 실패 시
    /// 세션을 끊지 않는 가드).
    func advanceIntoWalkHandoff() -> Bool {
        completeOrAdvance(announceDone: false)
        let pending = pendingWalkHandoff != nil
        transitGuideLog("walkHandoffNow pending=\(pending)")
        return pending
    }

    /// 마지막 leg면 목적지까지의 말미 도보 분(E34 버튼 조건), 아니면 nil.
    var finalLegWalkMinutes: Int? {
        guard let state, let route, state.legIndex == route.legs.count - 1 else { return nil }
        return route.walkAfterMinutes
    }

    private func completeOrAdvance(announceDone: Bool) {
        dispatch(.advance)
        if state?.phase == .done {
            // 완료 통지는 legAdvanced 이벤트가 이미 냈다 — 자원만 회수한다.
            // 말미 도보가 있으면 핸드오프 제안(§14.2)을 stop() **뒤에** 남긴다
            // (stop()이 pendingWalkHandoff까지 nil로 지우는 단일 소거 경로라 순서 필수).
            // ⚠ E34(2026-09-11)부터 이 값은 인계 화면의 근거가 아니라 **한 턴 수명 신호**다 — 같은 턴에
            // `GuideSession.acceptWalkHandoff`가 소비한다(인계 제안 화면은 도달 경로가 없어 삭제됐다).
            let handoff = route?.walkAfterMinutes.map {
                TransitWalkHandoff(destinationLabel: destinationLabel, walkMinutes: $0)
            }
            // 완료 문장은 stop() **뒤에** 낸다(BeaconModel 도착 문장 선례, 코드 리뷰 B1 2026-09-02):
            // `handle(event:)`가 start 톤 뒤로 미룬 문장은 stop()의 세대 증가가 취소하므로, 그 자리는
            // 발화하지 않고 여기서 stop()이 지우는 route를 지역 변수로 캡처해 새 세대에 게시한다.
            let doneText = finalLegText()
            stop()
            pendingWalkHandoff = handoff
            if announceDone { announce(doneText) }
        } else {
            waitingLive = []
            waitingDeparted = []
            waitingReason = nil
            retained = [:]
            restartPollLoop(immediate: true)
        }
    }

    /// 탑승 변경의 조회 기준 역(A16 L3). nil이면 leg 원래 승차역.
    ///
    /// ⚠ 이 상태가 Kit이 아니라 앱에 사는 이유: 상태 머신은 **어느 역을 조회할지
    /// 모른다**(폴 결과만 받는다). 조회 대상은 `fetchPoll`이 정하므로 L3는 공유
    /// 계약도 fixture도 건드리지 않는다.
    /// ⚠ **이름이 아니라 인덱스다**(E27 잔여 ①, spec §3.6). 이름으로 들면 표시 영문을
    /// `viaStops`에서 역조회해야 하는데, 정규화 후 동명 역이 둘이면 첫 일치를 골라 다른 역의
    /// 영문명이 오류 없이 표시된다. 인덱스는 그 모호함이 구조적으로 없다.
    private(set) var boardOverrideIndex: Int?
    /// 조회 쿼리용 한국어 원문(조인 축) — 인덱스가 가리키는 정류소 이름.
    var boardOverrideName: String? {
        guard let i = boardOverrideIndex, let leg = currentLeg,
              leg.viaStops.indices.contains(i) else { return nil }
        return leg.viaStops[i].name
    }
    /// 역 선택 단계 표시 여부(지하철 전용 — 아래 beginReboard 주석).
    private(set) var reboardPickerActive = false

    /// "탑승 변경" 진입. 지하철은 지금 있는 역을 먼저 묻고, 그 외 수단은 종전대로
    /// 곧장 재선택으로 간다.
    ///
    /// ⚠ 지하철 전용인 근거 둘: ①조회 파라미터가 수단마다 다르다(지하철만 역
    /// *이름*으로 조회하고 서울버스는 정류소 ID를 쓴다) ②문제의 성격이 다르다 —
    /// 지하철은 같은 노선에서 급행↔완행을 갈아타지만 버스는 갈아타면 다른 leg다.
    func beginReboard() {
        touchUserAction()
        guard let leg = currentLeg, leg.trackMode == .subway, !leg.viaStops.isEmpty else {
            changeBoarding()
            return
        }
        reboardPickerActive = true
    }

    func cancelReboard() {
        reboardPickerActive = false
    }

    /// 하차역 선언(A37 ②, spec 2026-09-11 §4.1): 역 선택(승차 중 탑승 변경·"이미 탑승" 흐름 둘 다)에서
    /// 하차역을 고르면 그 leg를 확정 도착으로 끝낸다 — 대기 국면으로 되돌리지 않는다. 통지는 관측 도착과
    /// 같은 지연 창구(`.arrived` 이벤트, 도착 종 뒤 발화). 폴 주기 0(리듀서) + 즉폴 게이트로 폴이 나가지 않는다.
    func declareArrived() {
        guard let state, state.phase == .waiting || state.phase == .riding else { return }
        transitGuideLog("declareArrived from=\(state.phase.rawValue) leg=\(state.legIndex)")
        dispatch(.declareArrived)
        waitingLive = []
        waitingDeparted = []
        waitingReason = nil
        restartPollLoop(immediate: false)
    }

    // MARK: - "이미 탔어요" 흐름 (A34 ②+①, spec 2026-09-11 §4.2)

    /// 대기 국면의 두 단계: 지나는 역 묻기 → 그 역에 있는 열차 고르기. 국면이 waiting을 벗어나면 소거(`dispatch`).
    enum AboardStep: Equatable { case pickStation, pickVehicle }
    private(set) var aboardStep: AboardStep?
    /// 이 dispatch의 입력이 `boardAboard`였다 — `boarded(declared)` 통지에 선택 차량 조각을 붙일지의 판별
    /// (`firstObservationInStep` 동형. `confirmBoarded`의 declared는 `vehicleSelected`가 이미 말했다).
    private var aboardBoardInStep = false

    /// [이미 탔어요] — 지하철이면 역부터 묻는다. 그 밖(서울버스)은 종전대로 곧장 근사(비관측) 잠금
    /// (역 이름 조회가 성립하지 않는다 — `beginReboard`가 지하철 전용인 근거와 같다).
    func beginAboard() {
        touchUserAction()
        guard state?.phase == .waiting, let leg = currentLeg else { return }
        guard leg.trackMode == .subway, !leg.viaStops.isEmpty else {
            boardAlready()
            return
        }
        aboardStep = .pickStation
        transitGuideLog("aboard step=pickStation")
    }

    func cancelAboard() {
        aboardStep = nil
        transitGuideLog("aboard step=cancel")
    }

    /// 역 선택(pickStation) 응답. 하차역이면 도착 선언(§4.1), 그 밖은 그 역 기준 목록으로(스냅숏·3분 버퍼 소거 —
    /// 승차역 목록이 다른 역 목록에 섞이지 않게, 리뷰 m1).
    func pickAboardStation(at stopIndex: Int) {
        touchUserAction()
        guard aboardStep == .pickStation, let leg = currentLeg else { return }
        if stopIndex == leg.viaStops.count - 1 {
            aboardStep = nil
            declareArrived()
            return
        }
        boardOverrideIndex = stopIndex
        aboardStep = .pickVehicle
        waitingLive = []
        waitingDeparted = []
        waitingReason = nil
        retained = [:]
        transitGuideLog("aboard step=pickVehicle station=\(stopIndex)")
        restartPollLoop(immediate: true)
    }

    func pickAnotherAboardStation() {
        guard aboardStep == .pickVehicle else { return }
        aboardStep = .pickStation
        transitGuideLog("aboard step=pickStation again")
    }

    /// pickVehicle 목록에서 고른 열차로 riding 직행(식별 잠금, 선언). boarding을 지나지 않는다 — 이미 탔다.
    /// 차단 재판정은 `board()`와 같은 술어.
    func boardAboard(item: TransitTrackItem, description: TransitLabel?) {
        guard aboardStep == .pickVehicle, let leg = currentLeg, let trackMode = leg.trackMode else { return }
        guard transitUnreachableReason(item, leg: leg) == nil else {
            transitGuideLog("boardAboard rejected unreachable vehicle=\(item.vehicleId ?? "-")")
            return
        }
        let lock = TransitLock(
            mode: trackMode,
            routeId: leg.routeId ?? subwayIdForOdsayLine(leg.lineName) ?? "",
            direction: item.direction,
            vehicleId: item.vehicleId ?? ""
        )
        selectedDescription = description
        transitGuideLog("boardAboard vehicle=\(item.vehicleId ?? "-")")
        aboardBoardInStep = true
        dispatch(.boardAboard(lock))
        aboardBoardInStep = false
        restartPollLoop(immediate: true)
    }

    /// 사용자가 고른 현재 역으로 재선택한다(A16 L3). 인자는 **세션 경로 `viaStops`의 인덱스**다 —
    /// 이름을 받는 판을 남기면 그것이 다시 동명 역 모호 경로가 된다(spec §3.6).
    func changeBoarding(at stopIndex: Int) {
        boardOverrideIndex = stopIndex
        reboardPickerActive = false
        changeBoarding()
    }

    func changeBoarding() {
        dispatch(.changeBoarding)
        // §13.1: 소실 항목 3분 버퍼(retained)는 비우지 않는다 — 잘못 잠근 채 이동한
        // 뒤 돌아온 목록에서 원래 열차가 사라지던 경로. 스냅숏만 비우고 즉폴이 재구성.
        waitingLive = []
        waitingDeparted = []
        waitingReason = nil
        restartPollLoop(immediate: true)
    }

    /// 탑승 변경 취소(§13.1) — 직전 잠금·국면으로 복귀(머신이 previousLock·previousPhase
    /// 소유). ⚠ `board(previousLock)`으로 돌리면 식별자 잠금은 boarding으로 가서 이미
    /// 탄 사용자가 승차 정류소 폴링으로 되돌아간다(설계 리뷰 M5) — 전용 입력이 정본.
    func cancelChangeBoarding() {
        guard state?.previousLock != nil else { return }
        dispatch(.restoreBoarding)
        restartPollLoop(immediate: true)
    }

    /// "이미 탔어요"(§13.2) — 식별자 없는 근사 잠금(tagoBus 계약 동형).
    ///
    /// `express`는 급행 확인 프롬프트(spec 2026-09-02 §6, 위원장 판정 — 급행 집합이 있는 노선에서만 시트가
    /// 묻는다)의 답. true면 하차역 정차를 판정해 통과 급행이면 잠그지 않고 차단 문장(결정적 문장 재사용)을
    /// 남기고, 정차하면 급행 선언 잠금(상시 문장 근거 — 하차역 목록의 급행 우선 매칭은 2026-09-11 비관측 잠금으로
    /// 은퇴). 프롬프트가 없는 노선은 nil로 종전 그대로.
    func boardAlready(express: Bool? = nil) {
        guard let leg = currentLeg, let trackMode = leg.trackMode, trackMode != .tagoBus else {
            return
        }
        if express == true, transitDeclaredExpressVerdict(leg: leg) == .skips {
            let note = TransitGuideTextRenderer.render(
                transitExpressSkipsAlightLine(isEn: transitGuideIsEn, leg: displayLeg(leg, useOverride: false)))
            expressBlockedNote = note
            transitGuideLog("boardAlready rejected express skips alight")
            // 통지는 시트의 착지가 대신한다(문장 행 착지 = 답). 착지 실패 폴백만 `announceLandingFallback`(전 대상 공용, A35).
            return
        }
        expressBlockedNote = nil
        let direction = leg.wayCode == 1 ? "상행" : leg.wayCode == 2 ? "하행" : ""
        dispatch(.board(TransitLock(
            mode: trackMode,
            routeId: leg.routeId ?? subwayIdForOdsayLine(leg.lineName) ?? "",
            direction: direction,
            vehicleId: "",
            express: express == true ? true : nil
        )))
        restartPollLoop(immediate: true)
    }

    /// 급행 확인에서 잠금을 거절한 뒤 남는 상시 문장("이 급행은 {하차역}에 서지 않습니다", §6).
    /// 국면 전이(잠금·전진·탑승 변경)·경로 교체·세션 종료가 지운다.
    private(set) var expressBlockedNote: String?

    /// 거절 문장 행 착지가 실패했을 때만(List 컬링) 부르는 폴백 — 활성화 응답이 침묵으로 끝나지 않게 `.high`.
    /// 착지가 성공하면 착지 낭독이 답이라 부르지 않는다(같은 문장 이중 낭독 금지, a11y 감사 2026-09-02).
    /// 착지 실패 폴백(A35 spec §4.1): 시트가 대상에 커서를 앉히지 못했을 때 **그 자리에서 낭독됐을 라벨**을
    /// 즉시 `.high`로 통지한다(헌장 §5 — 착지 못 하면 통지가 유일한 증거). 종전 `announceExpressBlockedFallback`
    /// (급행 거절 문장 한 곳)을 전 대상으로 일반화한 창구. 빈 문장은 내지 않는다.
    func announceLandingFallback(_ text: String) {
        guard !text.isEmpty else { return }
        announceNow(text, highPriority: true)
    }

    /// 새로고침(§13.2) — 즉폴 + 결과를 직접 응답으로 통지(자동 폴 무낭독의 예외).
    func refreshWaiting() {
        guard state?.phase == .waiting else { return }
        touchUserAction()
        refreshAnnounce = true
        restartPollLoop(immediate: true)
    }

    // MARK: - 목적지 전환(스펙 2026-08-12 §4)

    /// 1단(목적지 선택): 아직 아무것도 확정하지 않는다 — 사이드 채널로 현재 위치 →
    /// 새 목적지 대중교통 경로를 조회해 후보 목록만 준비한다(폼·세션 불변).
    func prepareDestinationChange(dest: BeaconDest, label: String) {
        guard isTracking else { return }
        destChangeToken += 1
        let token = destChangeToken
        pendingDestChange = PendingDestChange(dest: dest, label: label, phase: .loading, fetchedAt: nil)
        Task { await fetchDestChangeCandidates(token: token) }
    }

    private func fetchDestChangeCandidates(token: Int) async {
        guard let pending = pendingDestChange else { return }
        do {
            let origin = try await LocationService.shared.currentCoordinate()
            guard token == destChangeToken, isTracking else { return }
            let result = try await fetchTransitCandidates(origin: origin, dest: pending.dest)
            guard token == destChangeToken, isTracking else { return }
            if let result {
                pendingDestChange?.phase = .loaded(result)
                pendingDestChange?.fetchedAt = Date()
            } else {
                pendingDestChange?.phase = .empty  // 3-state: 경로 없음 ≠ 조회 실패
            }
        } catch {
            guard token == destChangeToken, isTracking else { return }
            pendingDestChange?.phase = .failed
        }
    }

    /// 후보 조회 공용(목적지 전환·조망 대안). includeStops: 안내용 승차·하차 정류소
    /// 데이터원(§4.1 — 브리핑 조회 동형).
    private func fetchTransitCandidates(
        origin: (lat: Double, lng: Double), dest: BeaconDest
    ) async throws -> TransitRouteResult? {
        try await routeService.transit(
            originLat: origin.lat, originLng: origin.lng,
            destLat: dest.lat, destLng: dest.lng,
            includeStops: true, lang: AppLanguage.dataLocale)
    }

    // MARK: 조망 "다른 경로" (E15-1 spec §5)

    /// 조망에서 "다른 경로 보기"(또는 실패 행의 "{승차역} 기준으로 조회"). 반환 토큰은
    /// 호출부(하위 시트)가 취소·커밋에 되돌려준다 — 자기 요청만 건드리게.
    @discardableResult
    func prepareAltRoutes(declaredBoardStop: Bool) -> Int? {
        guard let state, isTracking else { return nil }
        altRoutesToken += 1
        let token = altRoutesToken
        pendingAltRoutes = PendingAltRoutes(
            token: token, phaseGen: state.phaseGen, legIndex: state.legIndex,
            origin: nil, phase: .loading, fetchedAt: nil)
        Task { await fetchAltRoutes(token: token, declaredBoardStop: declaredBoardStop) }
        return token
    }

    /// 출발점 정책(§5.3): GPS → 신선한 추적 관측의 현재역 좌표 → 실패(.noLocation).
    /// 승차역은 앱이 추정하지 않고 사용자 선언(`declaredBoardStop`)일 때만 쓴다 —
    /// 승차 전은 도보 중일 수 있어 "지금 여기"를 찍지 않는 §3 규칙 3의 조회판.
    private func resolveAltOrigin(declaredBoardStop: Bool) async -> (origin: (lat: Double, lng: Double), evidence: PendingAltRoutes.OriginEvidence)? {
        guard let leg = currentLeg else { return nil }
        if declaredBoardStop, let stop = leg.boardStop,
           let phase = state?.phase, phase == .waiting || phase == .boarding {
            return ((stop.lat, stop.lng), .boardStopDeclared)
        }
        if let fix = try? await LocationService.shared.currentCoordinate() {
            return ((fix.lat, fix.lng), .gps)
        }
        if let here = overview?.here, case let .station(idx) = here, leg.viaStops.indices.contains(idx) {
            let stop = leg.viaStops[idx]
            return ((stop.lat, stop.lng), .station(stopIndex: idx))
        }
        return nil
    }

    private func fetchAltRoutes(token: Int, declaredBoardStop: Bool) async {
        guard let dest else {
            // 세션 불변식(비옵셔널 시작 인자)이라 도달하지 않지만, 조용한 loading 방치 금지.
            if token == altRoutesToken { pendingAltRoutes?.phase = .failed(.fetch) }
            return
        }
        guard let resolved = await resolveAltOrigin(declaredBoardStop: declaredBoardStop) else {
            guard token == altRoutesToken, isTracking else { return }
            pendingAltRoutes?.phase = .failed(.noLocation)
            ResultHaptic.fire(.failure)
            return
        }
        guard token == altRoutesToken, isTracking else { return }
        pendingAltRoutes?.origin = resolved.evidence
        do {
            let result = try await fetchTransitCandidates(origin: resolved.origin, dest: dest)
            guard token == altRoutesToken, isTracking else { return }
            // 결과 진동(E30 확장): 시트가 착지로만 알리는 전이라 진동이 결과 종류를 먼저 말한다.
            if let result {
                pendingAltRoutes?.phase = .loaded(result)
                pendingAltRoutes?.fetchedAt = Date()
                ResultHaptic.fire(.success)
            } else {
                pendingAltRoutes?.phase = .empty
                ResultHaptic.fire(.attention)
            }
        } catch {
            guard token == altRoutesToken, isTracking else { return }
            pendingAltRoutes?.phase = .failed(.fetch)
            ResultHaptic.fire(.failure)
        }
    }

    /// 캡처한 토큰이 현재 슬롯과 같을 때만 폐기 — 지연된 dismiss가 새 요청을 지우지 않게.
    func cancelAltRoutes(token: Int) {
        guard pendingAltRoutes?.token == token else { return }
        altRoutesToken += 1
        pendingAltRoutes = nil
    }

    /// 전환(§5.4). 주 가드는 **근거 변화**(국면 세대·구간·앵커역), 시간(120초)은 보조.
    /// 둘 중 하나라도 걸리면 같은 근거 정책으로 재조회(`.refetching`).
    func commitAltRoute(_ route: TransitRoute, token: Int) -> AltRouteCommit {
        guard isTracking, let state else { return .sessionEnded }
        guard let pending = pendingAltRoutes, pending.token == token,
              case .loaded = pending.phase else { return .sessionEnded }
        let hereNow: Int? = if let here = overview?.here, case let .station(idx) = here { idx } else { nil }
        let evidenceChanged: Bool = switch pending.origin {
        case .station(let idx): hereNow != idx
        case .gps, .boardStopDeclared, nil: false
        }
        let stale = pending.fetchedAt.map { Date().timeIntervalSince($0) > Self.destChangeStaleSeconds } ?? true
        if pending.phaseGen != state.phaseGen || pending.legIndex != state.legIndex || evidenceChanged || stale {
            let declared = pending.origin == .boardStopDeclared
            // 재조회 사유는 이 통지가 유일한 전달 경로(활성화한 버튼이 사라진다, 헌장 §6).
            // 사유가 넷(근거 변화·국면·구간·시간)이라 "위치가 바뀌어"가 거짓일 수 있다 — 중립 문구(감사 M1).
            announceNow(appLocalized("ios.transitGuide.altRefetching"), highPriority: true)
            altRoutesToken += 1
            let next = altRoutesToken
            pendingAltRoutes = PendingAltRoutes(
                token: next, phaseGen: state.phaseGen, legIndex: state.legIndex,
                origin: nil, phase: .loading, fetchedAt: nil)
            Task { await fetchAltRoutes(token: next, declaredBoardStop: declared) }
            return .refetching
        }
        guard let dest else { return .sessionEnded }
        guard changeRoute(transitRoute: route, destinationLabel: destinationLabel, dest: dest,
                          announcement: .routeSwitched) else { return .invalidCandidate }
        altRoutesToken += 1
        pendingAltRoutes = nil
        return .committed
    }

    /// 2단(후보 선택) = 확정(§4.1·§4.3). false = 확정 불발(세션 사망·stale 재조회) —
    /// 호출부는 폼 동기화를 하지 않는다.
    func commitDestinationChange(_ route: TransitRoute) -> Bool {
        guard isTracking, let pending = pendingDestChange,
              case .loaded = pending.phase else { return false }
        // stale 후보 가드(§4.2): 조회 후 문턱 경과면 그 후보로 확정하지 않고 재조회 —
        // 이동 중 지나친 정류장을 첫 승차 지점으로 확정하는 경로 차단.
        if let fetchedAt = pending.fetchedAt,
           Date().timeIntervalSince(fetchedAt) > Self.destChangeStaleSeconds {
            destChangeToken += 1
            let token = destChangeToken
            pendingDestChange?.phase = .loading
            pendingDestChange?.fetchedAt = nil
            // .high(리뷰 MINOR): 활성화한 후보 버튼이 사라지고 로딩 행 착지 낭독이
            // 뒤따른다 — 재조회 사유는 이 통지가 유일한 전달 경로다(헌장 §6).
            announceNow(appLocalized("ios.transitGuide.destChangeRefetched"), highPriority: true)
            Task { await fetchDestChangeCandidates(token: token) }
            return false
        }
        guard changeRoute(transitRoute: route, destinationLabel: pending.label, dest: pending.dest,
                          announcement: .destinationChanged) else { return false }
        pendingDestChange = nil
        return true
    }

    /// 취소 = 전체 무효(§4.1): 세션·폼·최근 목록 모두 옛 목적지 그대로.
    func cancelDestinationChange() {
        destChangeToken += 1
        pendingDestChange = nil
    }

    /// 세션 연속 경로 교체(§4.3). pollTask 취소가 곧 세대 경계다 — 루프의
    /// `Task.isCancelled`·`self.state` 재조회 가드가 옛 응답 커밋을 이미 막는다
    /// (별도 세대 카운터 불요, 스펙 "최소 보강"). `state`는 이 동기 함수 안에서만
    /// 갈아끼워 nil을 스치지 않는다(시트 presentation이 `state != nil`에 묶여 있다).
    /// 전환 통지의 종류 — 커밋 검증을 통과한 시점에 값으로 넘긴다(전역 pending을
    /// 되읽지 않는다, 설계 리뷰 A7).
    enum RouteChangeAnnouncement { case destinationChanged, routeSwitched }

    private func changeRoute(
        transitRoute: TransitRoute, destinationLabel: String, dest: BeaconDest,
        announcement: RouteChangeAnnouncement
    ) -> Bool {
        guard let guideRoute = buildTransitGuideRoute(transitRoute) else { return false }
        touchUserAction()  // 목적지 변경·경로 교체는 사용자 조작(유휴 정지 축 — 없으면 유휴 뒤 이 경로가 폴을 못 되살린다)
        pollTask?.cancel()
        pollTask = nil
        pendingWalkHandoff = nil  // 옛 목적지의 핸드오프 제안 무효
        aboardStep = nil  // 새 경로의 대기 국면은 처음부터
        boardingManualAvailable = false
        // 같은 목적지의 경로 전환이면 메뉴 쪽 목적지 후보는 낡았다(출발점이 바뀌었다).
        destChangeToken += 1
        pendingDestChange = nil
        self.route = guideRoute
        self.destinationLabel = destinationLabel
        self.dest = dest
        seq = 0
        retained = [:]
        tagoResolved = [:]
        tagoUnsupported = []
        waitingLive = []
        waitingDeparted = []
        waitingReason = nil
        refreshAnnounce = false
        expressBlockedNote = nil  // 옛 경로의 하차역 이름이 든 문장(코드 리뷰 #4)
        ridingPosition = nil  // 새 경로는 phaseGen 0부터 — 옛 결박이 되살아나지 않게(E35)
        clearBusStop()  // 같은 이유(E48)
        neverSeenPending = nil
        toneState = .initial
        lastPollStartAt = nil
        plannedIntervalMs = nil
        deferredAnnouncer.advanceGeneration()
        state = initTransitGuide(route: guideRoute, now: nowMs())
        let first = guideRoute.legs[0]
        // 목적지가 같은 경로 전환에 "목적지가 바뀌었다"를 말하면 거짓이다 — 종류별 첫 문장.
        let lead = switch announcement {
        case .destinationChanged: appLocalized("ios.guide.destChanged", destinationLabel)
        case .routeSwitched: appLocalized("ios.transitGuide.routeSwitched")
        }
        var parts = [
            lead,
            appLocalized("transitGuide.started", guideRoute.legs.count),
            waitContextText(first, isCurrentLeg: true),
        ]
        if first.trackMode == nil { parts.append(appLocalized("transitGuide.untrackable")) }
        // 활성화 응답(후보 버튼이 사라지는 전이) — .high(헌장 §6).
        announceNow(parts.joined(separator: " "), highPriority: true)
        restartPollLoop(immediate: true)
        return true
    }

    /// 진행 상황 버튼(§6.1) — 임의 시점 조회. 버튼 활성화의 직접 응답이라 .high.
    /// 상시 표시와 같은 조립기를 공유한다(§12.3 드리프트 차단).
    func announceProgress() {
        touchUserAction()
        guard let state, let leg = currentLeg else { return }
        // 렌더 밖의 판정이라 위치 보존 창은 **지금** 시각으로(E35 구현 리뷰 m1, 웹 동형). 화면 시계도 같은 틱에
        // 앞당겨 화면 줄이 이 답과 어긋나지 않게 한다(검증 리뷰 n4).
        positionClock = nowMs()
        announceNow(statusLineText(state: state, leg: leg, now: nowMs(), speaksLocated: true), highPriority: true)
    }

    /// 상시 표시·진행 상황 공용 조립기(§12.3) — 완성 문장 파트를 공백으로 연결하는
    /// 단일 헬퍼. 종전엔 시트가 쉼표 조립(joinText)을 따로 해 "기준., " 이중
    /// 구두점과 stationCountAbout·lastUpdated 누락 드리프트가 났었다(피드백 #9).
    /// `now`(ms)는 위치 보존 창을 판정할 시각이다 — 화면은 `positionClock`, 통지는 지금(기본값 없음: 생략이
    /// 컴파일을 통과하면 한쪽이 조용히 다른 시계를 쓴다). `speaksLocated`: 현재역 문장을 이 줄에 싣는가 —
    /// 조망 머리 문장만 false다(위원장 판정 2026-09-23: 조망은 안내 행·정차역 행 두 곳이 현재역을 말한다).
    /// false여도 그 자리에 신호 문장을 되살리지 않는다(아래 두 줄과 모순된다).
    func statusLineText(state: TransitGuideState, leg: TransitGuideLeg, now: Double, speaksLocated: Bool) -> String {
        let boarding = state.phase == .boarding
        let riding = state.phase == .riding
        let arrived = state.phase == .arrived
        // 비관측 잠금(A34 ①): 어느 열차인지 모르는 상태라 잔여·도착 문장·신선도를 내지 않는다.
        let unobserved = state.lock.map(transitLockIsUnobserved) ?? false
        // 도착 조각을 낼 수 있는 국면 — 도착 뒤의 접근 정보는 낡은 값이라 `arrived`는 제외한다(E39).
        let live = (boarding || riding) && !unobserved
        var parts: [String] = switch state.phase {
        case .waiting: [waitContextText(leg, isCurrentLeg: true)]
        case .boarding: [boardingContextText(leg)]
        default: [contextText(leg)]
        }
        // 잔여 + 도착 서술을 한 줄 두 조각으로(E39) — 렌더가 쉼표로 이어 한 문장이 된다.
        let message = live ? state.lastMessage.flatMap { m -> TransitLabel? in
            m.isEmpty ? nil : transitMessageLabel(m, state.lastMessageEn)
        } : nil
        let arrival = live
            ? TransitGuideTextRenderer.render(transitArrivalStatusLine(
                isEn: transitGuideIsEn,
                leg: displayLeg(leg, useOverride: boarding),
                message: message, arrivalCode: state.lastArrivalCode,
                remaining: state.remaining, phase: boarding ? .boarding : .riding))
            : ""
        // 신호 문구(E39 위원장 판정): 대기 국면의 `notYetVisible`은 그 국면 내내 고정이라 정보가
        // 0이고(목록 자리가 0건 사유를 3-state로 말한다), 추적 중은 도착 조각이 그 사실을 이미
        // 말한다. 추적 중인데 도착 조각이 비면 그것이 정보다 — "차량이 없다"가 아니라 "언제
        // 오는지 못 받았다"(3-state의 unknown).
        // ⚠ `noArrivalInfo`는 **관측된 도달 사례가 없는 방어선**이다(웹 미러 주석 참조) — 실제
        // 도달 여부는 실승차가 답한다(BACKLOG §2 E39 행 ④).
        if let located = positionStatusText(state: state, leg: leg, now: now) {
            // 승차 중 현재역(E35 §6 판정 1): 도착 피드 미관측 구간에 위치가 잡혀 있으면 신호 문장("하차역에
            // 가까워지면 열차 위치가 표시됩니다." 등) 자리를 현재역 문장이 차지한다 — 그대로 두면 경유역 목록의
            // "현재 위치"와 모순된다.
            if speaksLocated { parts.append(located) }
        } else if state.phase == .waiting, state.signal == .notYetVisible {
            // 없음
        } else if state.signal == .tracking, live {
            if arrival.isEmpty { parts.append(appLocalized("transitGuide.noArrivalInfo")) }
        } else {
            parts.append(signalStatusText(
                state.signal, phase: state.phase, isTrain: leg.mode == "subway", unobserved: unobserved))
        }
        // 선택 차량 조각: boarding 종전대로 + riding(A34 ② — 목록에서 고른 열차를 확인하는 자리, 리뷰 m5).
        if boarding || riding, let desc = selectedDescription {
            parts.append(TransitGuideTextRenderer.render(
                transitSelectedVehicleLine(isEn: transitGuideIsEn, desc: desc)))
        }
        if !arrival.isEmpty { parts.append(arrival) }
        // 잔여를 못 받은 승차 중의 어림 정거장 수 — 도착 조각과 겹치지 않는 별도 문장이다.
        if riding, !unobserved, state.remaining == nil, let count = leg.stationCount {
            parts.append(appLocalized("transitGuide.stationCountAbout", count))
        }
        // 근사 주석("같은 노선의 접근 차량 기준")은 지방버스만(대기 중에도 근사 예고). 지하철·서울버스 근사는
        // 2026-09-11부터 비관측이라 접근 차량 기준이 아니다 — 국면을 보지 않는 잠금 술어로 갈라 선언 도착
        // 뒤에도 상속되지 않게(리뷰 m2).
        if leg.trackMode == .tagoBus {
            parts.append(appLocalized("transitGuide.approxNote"))
        }
        // 급행 선언 잠금(§6)은 판정을 상시 표시에 남긴다 — 답한 직후의 침묵이 "확인됨"으로 읽히지 않게.
        if state.lock?.express == true {
            parts.append(TransitGuideTextRenderer.render(transitExpressStatusLine(
                isEn: transitGuideIsEn, leg: displayLeg(leg, useOverride: false),
                verdict: transitDeclaredExpressVerdict(leg: leg))))
        }
        // 신선도 문장은 정확히 1개(§12.3, 감사 H2·M1): 추적 중이면 데이터 나이,
        // 그 외엔 마지막 폴 시각만 — 낡은 나이를 신선한 값처럼 이월하지 않는다.
        // 비관측 잠금은 폴이 없어 신선도가 정보가 아니다(동결 시각은 "앱이 멈췄다"로 읽힌다, 리뷰 m4).
        // 도착 국면도 같다 — 내린 뒤의 갱신 시각은 행동을 바꾸지 않는다(E39).
        if unobserved || arrived {
            // 없음
        } else if state.signal == .tracking, let age = state.dataAgeSeconds {
            parts.append(appLocalized("transitGuide.dataAge", age))
        } else if let updatedAt = state.lastUpdatedAt {
            parts.append(appLocalized("transitGuide.lastUpdated", Self.timeText(updatedAt)))
        }
        return parts.filter { !$0.isEmpty }.joined(separator: " ")
    }

    private static func timeText(_ epochMs: Double) -> String {
        let formatter = DateFormatter()
        // 고정 포맷은 로케일 고정이 규칙(QA1480) — 기기 12시간제 설정에 흔들리지 않게.
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: Date(timeIntervalSince1970: epochMs / 1000))
    }

    // MARK: - 폴링 루프

    private func restartPollLoop(immediate: Bool) {
        pollTask?.cancel()
        guard let state else { return }
        // 유휴 정지 중엔 예약하지 않는다 — 어떤 조작·전경 복귀(`touchUserAction`)가 풀며 다시 부른다.
        if idlePaused { return }
        let interval = transitPollIntervalMs(state)
        // 주기 0 = 폴 없음이고 **즉폴도 예외가 아니다**(A37 ② 설계 리뷰 B1 — 종전엔 `!immediate`에만 걸려
        // 선언 도착·백그라운드 복귀의 즉폴이 새 세대로 나가 remaining·lastMessage를 되살렸다).
        if interval <= 0 { return }
        // 계측: 이 폴을 예약한 주기(즉폴은 nil → `planned=-`).
        plannedIntervalMs = immediate ? nil : interval
        pollTask = Task { [weak self] in
            if !immediate {
                try? await Task.sleep(for: .milliseconds(interval))
            }
            while !Task.isCancelled {
                guard let self else { return }
                // 잊힌 세션 안전망(spec §4.2.6): 다음 폴 직전에 유휴를 판정한다.
                if self.enterIdleIfDue() { return }
                await self.pollOnce()
                guard !Task.isCancelled else { return }
                // 승차 중 현재역(E35): 도착 폴의 계측(`pollEnd elapsed`) **밖**에서 — 위치 조회 시간이 도착 지연으로
                // 섞이지 않게(구현 리뷰 m4). dispatch 뒤 상태로 켜는 조건을 판정한다.
                await self.refreshPosition(seq: self.seq)
                guard let s = self.state, !Task.isCancelled else { return }
                let next = transitPollIntervalMs(s)
                if next <= 0 { return }
                self.plannedIntervalMs = next
                try? await Task.sleep(for: .milliseconds(next))
            }
        }
    }

    private func pollOnce() async {
        guard let state, let leg = currentLeg else { return }
        guard state.phase != .done, state.signal != .untrackable else { return }
        let phaseGen = state.phaseGen
        seq += 1
        let mySeq = seq
        // 계측(A16 미확정 ②, spec 2026-09-02 §3): 시작·종료 1쌍/폴. 종료는 `defer`라 조기 반환·취소
        // 어느 경로든 정확히 한 번 남는다(설계 리뷰 2차 #6). 시각은 단조(systemUptime).
        let startedAt = ProcessInfo.processInfo.systemUptime
        let previousStart = lastPollStartAt
        let planned = plannedIntervalMs
        lastPollStartAt = startedAt
        transitGuideLog({
            let sinceLast = previousStart.map { String(format: "%.1f", startedAt - $0) } ?? "-"
            // 정수 초(ms 주기는 1000 배수), 즉폴은 "-".
            let plannedText = planned.map { "\($0 / 1000)s" } ?? "-"
            return "pollStart seq=\(mySeq) phase=\(state.phase.rawValue) sinceLast=\(sinceLast)s planned=\(plannedText)"
        }())
        var endStatus = "cancelled"
        defer {
            let elapsed = ProcessInfo.processInfo.systemUptime - startedAt
            transitGuideLog("pollEnd seq=\(mySeq) status=\(endStatus) elapsed=\(String(format: "%.2f", elapsed))s")
        }
        let (poll, rawCount) = await fetchPoll(leg: leg, phase: state.phase)
        endStatus = Self.pollStatusText(poll)
        guard !Task.isCancelled else { endStatus = "cancelled"; return }
        // 잠금 국면 계측(A16 미확정 ①): boarding·riding·arrived 응답을 dispatch 전에 남긴다.
        if state.phase != .waiting {
            logRidingPoll(seq: mySeq, poll: poll, rawCount: rawCount, state: state)
        }
        // 대기 목록 스냅숏(§5.1) — 소실 유지·경과 계산은 폴 시점에.
        var refreshResponse: String?
        if self.state?.phase == .waiting, self.state?.phaseGen == phaseGen {
            updateWaitingSnapshot(poll: poll, rawCount: rawCount)
            logWaitingPoll(seq: mySeq, poll: poll, rawCount: rawCount, leg: leg)
            // 새로고침 직접 응답(§13.2): 자동 폴 무낭독 규칙의 대상이 아니다 —
            // 사용자 요청의 응답이라 후보 수(0 포함)로 답한다. 조회 실패·미지원만
            // 사유 문장(실패를 "0개"로 말하지 않는다 — 3-state). 0건의 왜는 목록
            // 자리 지속 문장이 담당한다(통지·화면 중복 금지, 감사 M4).
            if refreshAnnounce, leg.trackMode != .tagoBus {
                refreshAnnounce = false
                let candidates = classifyTransitBoardingCandidates(
                    waitingCandidatesPool(), leg: leg
                ).candidates
                refreshResponse = waitingReason == .unavailable
                    ? reasonText(.unavailable)
                    : appLocalized("transitGuide.waitingCount", candidates.count)
            }
        }
        refreshAnnounce = false
        dispatch(.poll(seq: mySeq, phaseGen: phaseGen, poll: poll))
        // 응답은 dispatch 뒤에 .high로 게시한다 — 같은 폴의 신호 이벤트 통지가
        // 먼저 나가고 .high가 큐를 끊어 응답이 최종 승자가 된다(감사 M1: 역순이면
        // 동어반복 두 문장이 연달아 나가거나 응답이 잠식된다). 사용자 활성화(새로고침)의
        // 직접 응답이라 즉시 창구(보류 슬롯 무효화 — 이벤트 문장이 뒤늦게 발화하는 역전 차단).
        if let refreshResponse { announceNow(refreshResponse, highPriority: true) }
    }

    /// 승차 중 현재역 조회(E35 spec §5) — 도착 폴 한 번에 최대 1회, **dispatch 뒤** 상태로 켜는 조건을
    /// 판정한다(그 폴로 추적이 시작됐으면 묻지 않는다). 별도 타이머가 없어 폴 주기·백그라운드 폴·유휴
    /// 정지·즉폴 금지를 그대로 상속한다. 위치 실패는 도착 폴을 흔들지 않는다(throw 없음).
    /// 계측 `posPoll`은 3-state(found·notFound·failed)와 조인 결과를 가른다 — 실승차 사후 판정의 유일한 증거.
    private func refreshPosition(seq: Int) async {
        guard let state, let leg = currentLeg else { return }
        if let requested = transitPositionBinding(of: state),
           transitPositionLookupDue(state: state, leg: leg, position: ridingPosition) {
            let startedAt = ProcessInfo.processInfo.systemUptime
            let outcome: TransitPositionOutcome
            do {
                outcome = TransitPositionService.outcome(
                    from: try await positionService.lookup(line: leg.lineName, train: requested.vehicleId))
            } catch {
                outcome = TransitPositionService.outcome(from: error)
            }
            guard !Task.isCancelled, let stateNow = self.state, let legNow = currentLeg else { return }
            let at = nowMs()
            let elapsed = ProcessInfo.processInfo.systemUptime - startedAt
            // 늦은 응답(조회 중 탑승 변경·다음 구간)은 순수 계층이 요청 결박으로 버린다(설계 리뷰 M1).
            ridingPosition = transitRidingPositionStep(
                ridingPosition, state: stateNow, leg: legNow, requested: requested, outcome: outcome, now: at)
            transitGuideLog({
                let kind: String = switch outcome {
                case let .found(station, age): "found station=\(station) age=\(age.map(String.init) ?? "-")"
                case let .notFound(lineEmpty): "notFound lineEmpty=\(lineEmpty)"
                case .unsupported: "unsupported"
                case .failed: "failed"
                }
                let latched = ridingPosition?.stopIndex.map(String.init) ?? "-"
                let shown = transitPositionShownIndex(state: stateNow, position: ridingPosition, now: at)
                    .map(String.init) ?? "-"
                return "posPoll seq=\(seq) train=\(requested.vehicleId) \(kind) latched=\(latched) shown=\(shown)"
                    + " lookups=\(ridingPosition?.lookups ?? 0) signal=\(stateNow.signal.rawValue)"
                    + " elapsed=\(String(format: "%.2f", elapsed))s"
            }())
        }
        positionClock = nowMs()
        // 보류한 경고의 처분 — 조회하지 않은 폴(상한·추적 시작)에서도 본다.
        if let pending = neverSeenPending, let current = self.state {
            let verdict = transitNeverSeenPendingStep(
                pending, state: current, position: ridingPosition, now: positionClock)
            if verdict != .keep {
                neverSeenPending = nil
                transitGuideLog("neverSeen pending=\(verdict.rawValue)")
            }
            if verdict == .fire { handle(event: .neverSeen) }
        }
    }

    private static func pollStatusText(_ poll: TransitTrackPoll) -> String {
        switch poll {
        case let .ok(items): "ok(\(items.count))"
        case .empty: "empty"
        case .unsupported: "unsupported"
        case .failed: "failed"
        }
    }

    /// 잠금 국면 계측(A16 미확정 ①, spec 2026-09-02 §3) — 폴이 `empty`였는지, 항목은 있는데 잠금
    /// 열차가 없었는지(L1 기제), 매칭됐는데 잔여 추출이 실패했는지를 가른다. 매칭은 리듀서와
    /// **같은 순수 함수·같은 입력**(dispatch 전 `state.lock`)이라 결과가 같다(리뷰 #7).
    private func logRidingPoll(
        seq: Int, poll: TransitTrackPoll, rawCount: Int?, state: TransitGuideState
    ) {
        transitGuideLog({
            let items: [TransitTrackItem] = if case let .ok(list) = poll { list } else { [] }
            let matched = state.lock.flatMap { transitFindLockedItem(items, lock: $0) }
            let m = matched.map { item in
                "yes remaining=\(item.remainingStops.map(String.init) ?? "-")"
                    + " code=\(item.arrivalCode ?? "-") loc=\(item.currentLocation ?? "-")"
                    + " age=\(item.dataAgeSeconds.map(String.init) ?? "-") stamp=\(item.dataStamp ?? "-")"
            } ?? "no"
            return "ridePoll seq=\(seq) phase=\(state.phase.rawValue) status=\(Self.pollStatusText(poll))"
                + " raw=\(rawCount.map(String.init) ?? "-") matched=\(m) signal=\(state.signal.rawValue)"
        }())
    }

    private func fetchPoll(
        leg: TransitGuideLeg, phase: TransitPhase
    ) async -> (poll: TransitTrackPoll, rawCount: Int?) {
        do {
            switch leg.trackMode {
            case .seoulBus:
                if phase == .waiting || phase == .boarding {
                    guard let arsId = leg.boardStop?.arsId, let routeId = leg.routeId else {
                        return (.unsupported, nil)
                    }
                    let env = try await trackService.seoulWait(
                        arsId: arsId, routeId: routeId, lang: AppLanguage.dataLocale)
                    return (TransitTrackService.poll(from: env), env.rawCount)
                }
                guard let boardId = leg.boardStop?.localId,
                      let alightId = leg.alightStop?.localId,
                      let routeId = leg.routeId
                else { return (.unsupported, nil) }
                let env = try await trackService.seoulRide(
                    routeId: routeId, boardId: boardId, alightId: alightId,
                    lang: AppLanguage.dataLocale)
                return (TransitTrackService.poll(from: env), env.rawCount)
            case .tagoBus:
                guard let resolved = await resolveTagoIfNeeded(leg: leg, phase: phase) else {
                    guard let state else { return (.failed, nil) }
                    let unsupported = tagoUnsupported.contains(
                        tagoCacheKey(state.legIndex, phase: phase))
                    return (unsupported ? .unsupported : .failed, nil)
                }
                let env = try await trackService.tagoTrack(
                    cityCode: resolved.cityCode, nodeId: resolved.nodeId, routeNo: leg.lineName,
                    lang: AppLanguage.dataLocale)
                return (TransitTrackService.poll(from: env), env.rawCount)
            case .subway:
                // waiting 국면의 기준 역은 사용자가 고른 현재 역이 이긴다(A16 L3).
                // riding(alightName)은 건드리지 않는다 — 그쪽은 L1 영역이다.
                let station = (phase == .waiting || phase == .boarding)
                    ? (boardOverrideName ?? leg.boardName)
                    : leg.alightName
                guard !station.isEmpty else { return (.unsupported, nil) }
                let env = try await trackService.subwayTrack(
                    station: station, line: leg.lineName, lang: AppLanguage.dataLocale)
                return (TransitTrackService.poll(from: env), env.rawCount)
            case nil:
                return (.unsupported, nil)
            }
        } catch {
            return (.failed, nil)
        }
    }

    /// 대기 목록의 입력 풀(시트·새로고침 응답 공용). "이미 탑승" pickVehicle 단계는 그 역에 있는 열차만
    /// (`transitAboardCandidates`, A34 ② 후보 필터) — 두 소비자가 다른 풀을 보면 "탑승 후보 N개"가 화면과 어긋난다.
    func waitingCandidatesPool() -> [TransitTrackItem] {
        let all = waitingLive + waitingDeparted.map(\.item)
        return aboardStep == .pickVehicle ? transitAboardCandidates(all) : all
    }

    /// 0건 사유 문구(§13.3 3-state) — 목록 자리(시트)·새로고침 응답 공용.
    func reasonText(_ reason: TransitWaitingEmptyReason) -> String {
        switch reason {
        case .none: appLocalized("transitGuide.noCandidates")
        case .filtered: appLocalized("transitGuide.noCandidatesFiltered")
        case .unavailable: appLocalized("transitGuide.noCandidatesUnavailable")
        }
    }

    /// 대기 국면 계측(§13.5) — 실험판 전용, 폴마다 status·원시 건수·필터 단계별
    /// 잔존·비활성 사유를 남겨 #4 원인 6후보를 다음 실승차 로그로 가른다.
    private func logWaitingPoll(
        seq: Int, poll: TransitTrackPoll, rawCount: Int?, leg: TransitGuideLeg
    ) {
        transitGuideLog({
            let status = switch poll {
            case let .ok(items): "ok(\(items.count))"
            case .empty: "empty"
            case .unsupported: "unsupported"
            case .failed: "failed"
            }
            let classified = classifyTransitBoardingCandidates(
                waitingLive + waitingDeparted.map(\.item), leg: leg)
            let vehIdless = classified.candidates
                .count(where: { $0.item.vehicleId?.isEmpty != false })
            let terminates = classified.candidates.count(where: { $0.unreachable != nil })
            return "waitPoll seq=\(seq) status=\(status) raw=\(rawCount.map(String.init) ?? "-")"
                + " live=\(waitingLive.count) departed=\(waitingDeparted.count)"
                + " candidates=\(classified.candidates.count) vehIdless=\(vehIdless)"
                + " unreachable=\(terminates)"
                + " directionUncertain=\(classified.directionUncertain)"
                + " reason=\(waitingReason?.rawValue ?? "-")"
        }())
    }

    /// 지방버스 정류소 해석(세션·leg당 1회, §5.2). 모호·부재는 unsupported 캐시.
    private func tagoCacheKey(_ legIndex: Int, phase: TransitPhase) -> String {
        "\(legIndex):\(phase == .waiting || phase == .boarding ? "board" : "alight")"
    }

    private func resolveTagoIfNeeded(
        leg: TransitGuideLeg, phase: TransitPhase
    ) async -> TransitTrackResolvedStop? {
        guard let legIndex = state?.legIndex else { return nil }
        let key = tagoCacheKey(legIndex, phase: phase)
        if tagoUnsupported.contains(key) { return nil }
        if let cached = tagoResolved[key] { return cached }
        let target = (phase == .waiting || phase == .boarding) ? leg.boardStop : leg.alightStop
        guard let target else { return nil }
        do {
            let envelope = try await trackService.resolveTagoStop(lat: target.lat, lng: target.lng)
            if envelope.status == "ok", let stop = envelope.stop {
                tagoResolved[key] = stop
                return stop
            }
            tagoUnsupported.insert(key)
            return nil
        } catch {
            return nil // 일시 실패 — 캐시하지 않고 다음 폴에서 재시도
        }
    }

    private func updateWaitingSnapshot(poll: TransitTrackPoll, rawCount: Int?) {
        waitingReason = transitWaitingEmptyReason(poll: poll, rawCount: rawCount)
        let items: [TransitTrackItem] = if case let .ok(list) = poll { list } else { [] }
        let now = Date()
        for item in items {
            if let vid = item.vehicleId, !vid.isEmpty { retained[vid] = (item, now) }
        }
        retained = retained.filter { now.timeIntervalSince($0.value.lastSeenAt) <= Self.retainSeconds }
        let liveKeys = Set(items.compactMap(\.vehicleId))
        waitingLive = items
        waitingDeparted = retained.compactMap { key, value in
            guard !liveKeys.contains(key) else { return nil }
            let minutes = max(1, Int((now.timeIntervalSince(value.lastSeenAt) / 60).rounded()))
            return (value.item, minutes)
        }
    }

    // MARK: - 상태 머신 배선·통지

    private func dispatch(_ input: TransitGuideInput) {
        guard let state, let route else { return }
        // 폴을 제외한 모든 입력은 사용자 조작이다(유휴 정지 축). 표식은 여기, 유휴 재개(주기 산정·재개 문장)는
        // **상태 대입 뒤**(코드 리뷰 C4 — 입력 전 상태로 주기를 재지 않게).
        let userAction: Bool = if case .poll = input { false } else { true }
        if userAction { noteUserAction() }
        let result = transitGuideStep(state: state, input: input, route: route, now: nowMs())
        self.state = result.state
        if userAction { resumeIfIdle() }
        updateKeepAlive()
        if case .neverSeen = result.event {
            // A36 ① 판정 재료(spec §4.6·§7): 상한에 닿은 조회 수와 그 시점 잔여(대본 §5-3이 이 문자열을 읽는다).
            transitGuideLog("neverSeen polls=\(result.state.ridingPolls) remaining=\(result.state.remaining.map(String.init) ?? "-")")
        }
        // 추세 톤 계층(E15 ②, spec 2026-09-02 §2.5): `state`(대입 전 캡처 = before)와 `result.state`
        // (after)를 넘긴다 — 입력 조립·phaseGen 리셋은 Kit 순수 함수 몫이다(설계 리뷰 #2).
        // 이벤트가 있는 스텝은 층이 nil을 내므로 한 dispatch에 `tones.play`는 최대 1회다.
        let toned = transitToneStep(
            state: toneState, before: state, after: result.state, event: result.event,
            now: ProcessInfo.processInfo.systemUptime)
        toneState = toned.state
        // 사용자가 고른 기준 역(A16 L3)의 수명은 딱 한 번의 재선택이다. 재잠금·전진
        // 뒤에도 남으면 다음 대기 국면이 엉뚱한 역을 조회한다. ⚠ 소거를 호출부마다
        // 흩뿌리지 않는 이유가 그것이다 — board 디스패치만 네 곳이라 하나만 빠져도
        // 조용히 틀린다.
        // N3: boarding이 재선택 역을 계속 조회해야 하므로 `.board`가 아니라 **riding
        // 진입**(선언·관측 어느 길이든)에서 지운다. 국면 기반이라 폴이 일으키는 승격도 잡는다.
        let enteredRiding = result.state.phase == .riding && state.phase != .riding
        switch input {
        case .advance: boardOverrideIndex = nil; selectedDescription = nil
        case .board, .boardAboard, .confirmBoarded, .restoreBoarding, .changeBoarding, .declareArrived, .poll: break
        }
        if enteredRiding { boardOverrideIndex = nil }
        // "이미 탑승" 흐름은 대기 국면 전용 UI — 국면이 바뀌면 소거(`reboardPickerActive`와 같은 국면 기반 규칙).
        if result.state.phase != .waiting { aboardStep = nil }
        // boarding 수동 진행 수단의 래치(N3 ①): 국면에 **들어올 때** 지우고(재진입 = 새 차량 대기),
        // 그 국면 안에서 관측이 끝나면 세운다. 국면 밖에선 언제나 false.
        if result.state.phase != .boarding || state.phase != .boarding {
            boardingManualAvailable = false
        }
        if result.state.phase == .boarding, transitBoardingObservationLost(result.state.signal) {
            boardingManualAvailable = true
        }
        // 급행 거절 문장은 그 대기 국면에 묶인다 — 국면 세대가 바뀌면 낡았다.
        if result.state.phaseGen != state.phaseGen { expressBlockedNote = nil }
        // 픽커는 riding 국면 전용 UI다. 국면이 바뀌면 화면에서는 사라지지만 플래그가
        // 남아, 다음 riding 진입에서 **묻지도 않은 역 선택 화면이 되살아나고** 포커스를
        // 강탈한다(독립 리뷰 MAJOR: 픽커를 연 채 폴이 도착 추정으로 전이 → advance →
        // 다음 leg 탑승). ⚠ 국면 기반인 이유: `.board`/`.advance`만 열거하면 폴이
        // 일으키는 arrived 전이를 놓친다. `boardOverrideIndex`는 waiting에서 쓰이므로
        // 같은 축으로 묶을 수 없고, 그래서 둘의 소거 조건이 다르다.
        if result.state.phase != .riding { reboardPickerActive = false }
        // 계측(§13.5): 국면·신호 전이와 이벤트만 기록(무이벤트 폴 소음 제외).
        if result.event != nil || result.state.phase != state.phase
            || result.state.signal != state.signal {
            transitGuideLog(
                "step phase=\(state.phase.rawValue)→\(result.state.phase.rawValue)"
                    + " signal=\(state.signal.rawValue)→\(result.state.signal.rawValue)"
                    + " event=\(result.event.map { String(describing: $0) } ?? "-")")
        }
        // approaching 첫 관측 판별(직전 상태의 trackingAnnounced) — 이벤트는 첫 관측과
        // 사다리를 구분하지 않으므로 문구 조립이 전이 전 상태를 본다.
        firstObservationInStep = !state.trackingAnnounced && result.state.trackingAnnounced
        if let event = result.event {
            // 승차 중 현재역(E35 §6 판정 2): `neverSeen` 순간 현재역이 잡혀 있으면 "찾지 못하고 있다"는 전제가
            // 거짓이라 경고(문장·약한 톤)를 결박째 보류한다. 처분(발화·폐기)은 폴마다 `refreshPosition` 끝에서.
            if case .neverSeen = event,
               let deferred = transitNeverSeenWarningDeferred(
                   state: result.state, position: ridingPosition, now: nowMs()) {
                neverSeenPending = deferred
                transitGuideLog("neverSeen deferred reason=positionShown")
            } else {
                handle(event: event)
            }
        }
        if let tone = toned.tone {
            transitGuideLog("tone kind=\(tone.rawValue) anchor=\(toned.state.anchorRemaining.map(String.init) ?? "-")")
            playTone(tone, allowedInBackground: false)
        }
    }

    private var firstObservationInStep = false

    private func handle(event: TransitGuideEvent) {
        let profile = transitEventProfile(event)
        // 백그라운드 톤 허용 집합은 **첫 관측 하나**(E36 위원장 판정 — 사다리·도착·추세는 별건). 아래가
        // 이 파일에서 허용 인자를 참으로 대입하는 유일한 자리이고 소스 가드(`transit-background-guards.test.ts`)가 센다.
        let allowedInBackground: Bool
        if case .trackingStarted = event { allowedInBackground = true } else { allowedInBackground = false }
        switch profile.tone {
        case .start: playTone(.start, allowedInBackground: allowedInBackground)
        case .ladder: playTone(.closer, allowedInBackground: allowedInBackground)
        case .imminent: playTone(.ahead, allowedInBackground: allowedInBackground)
        case .arrive: playTone(.nearby, allowedInBackground: allowedInBackground)
        case .weak: playTone(.warning, allowedInBackground: allowedInBackground)
        case nil: break
        }
        let text = announcementText(for: event)
        guard !text.isEmpty else { return }
        // 사용자 활성화의 직접 응답(탑승 선언·다음 구간 버튼)은 즉시 창구다(a11y 감사 W1): 지연 슬롯에
        // 두면 같은 함수가 부르는 즉폴의 `trackingStarted`가 latest-wins로 그 문장을 버려, 웜 응답이면
        // 탑승 문장이 사라지고 콜드면 살아남는 비결정이 된다. 도착 관측(`observed`)은 폴 유래라 지연이고,
        // ⚠ **그 전제는 "관측 승격 뒤 다음 riding 폴이 한참 뒤"라는 것이다** — 승격 직후 즉폴을 넣으면
        // 이 문장이 그 창 안에서 버려진다(N3 ① 구현 리뷰 H1으로 즉폴 철회, spec §9).
        switch event {
        case .boarded(legIndex: _, cause: .declared), .legAdvanced:
            announceNow(text, highPriority: profile.interrupt)
        default:
            announce(text, highPriority: profile.interrupt)
        }
    }

    /// 톤 재생 단일 창구 — 억제 가드는 여기 한 곳(BeaconModel.playTone 동형). 종전엔 이벤트 톤이
    /// `tones.play`를 직접 불러 검색 시트(받아쓰기 마이크)가 열린 동안에도 소리가 났다(설계 리뷰 #4).
    /// 층 상태(앵커·타이머)는 억제 중에도 전진한다 — 억제는 출력 게이트이지 판정 게이트가 아니다.
    /// `allowedInBackground`(기본값 없음 — 호출부가 뜻을 밝힌다): 백그라운드에서도 낼 톤인가. 층 상태(앵커·
    /// 타이머)는 백그라운드에서도 전진한다 — 억제와 같은 출력 게이트 원칙.
    private func playTone(_ tone: BeaconTone, allowedInBackground: Bool) {
        guard !outputSuppressed else { return }
        if !isForeground {
            transitGuideLog("bgTone kind=\(tone.rawValue) allowed=\(allowedInBackground)")
            guard allowedInBackground else { return }
        }
        tones.play(tone)
        // 가청 판정은 매 톤(세션 중에도 바뀐다 — 인터럽션·route·억제 해제·소유권 이전), 문장은 세션당 1회.
        // 승격 실패는 전경에서 보이지 않으므로(`.ambient`로도 들린다) 잠그기 전에 한 번은 말해야 한다.
        // ⚠ latch는 **발화 성공**에 건다(memory once-only-warning-delivery-contract, 구현 리뷰 C1·A-1): 이 문장은
        // 톤 직후 큐잉되어 바로 뒤 이벤트 문장에 latest-wins로 선점되거나 백그라운드 게이트에 버려진다.
        // 그때 `onDropped`가 latch를 풀어 다음 톤이 다시 시도한다 — 지연 창구의 상환 계약 그대로.
        if isTracking, !tones.isBackgroundAudible, !soundDegradedAnnounced {
            soundDegradedAnnounced = true
            // 진동은 세션당 1회 별도 래치(E30 확장): 문장 래치는 버려지면 풀려 재시도하지만 진동은
            // 버려지지 않으므로 같은 래치에 묶으면 문장이 도달할 때까지 톤마다 반복된다(리뷰 검출).
            if !soundDegradedHapticFired {
                soundDegradedHapticFired = true
                ResultHaptic.fire(.attention)
            }
            deferredAnnouncer.announce(appLocalized("ios.beacon.soundBackgroundUnavailable")) { [weak self] in
                self?.soundDegradedAnnounced = false
            }
        }
    }

    /// 이벤트가 실어 온 완성 문장 → **상태 문장과 같은 도착 서술**(E39). 통지와 상시 표시가 한
    /// 조립기를 공유해야 같은 사실이 두 문장으로 갈리지 않는다(§12.3 드리프트 차단).
    /// `remaining`이 nil이면 잔여 조각 없이 도착 서술만 낸다.
    private func arrivalText(
        _ leg: TransitGuideLeg, message: String, messageEn: String?, arrivalCode: String?,
        remaining: Int?, phase: TransitStatusPhase
    ) -> String {
        TransitGuideTextRenderer.render(transitArrivalStatusLine(
            isEn: transitGuideIsEn, leg: displayLeg(leg, useOverride: phase == .boarding),
            message: message.isEmpty ? nil : transitMessageLabel(message, messageEn),
            arrivalCode: arrivalCode, remaining: remaining, phase: phase))
    }

    private func announcementText(for event: TransitGuideEvent) -> String {
        let leg = currentLeg
        var parts: [String] = []
        switch event {
        case let .vehicleSelected:
            if let leg {
                parts.append(TransitGuideTextRenderer.render(transitVehicleSelectedLine(
                    isEn: transitGuideIsEn, leg: displayLeg(leg, useOverride: true),
                    desc: selectedDescription)))
            }
        case let .approaching(remaining, message, messageEn):
            // 첫 관측만 "추적합니다"를 앞세운다(래치 nil→값). 이후 사다리는 도착 서술만.
            if firstObservationInStep { parts.append(appLocalized("transitGuide.approachingStarted")) }
            if let leg {
                parts.append(arrivalText(
                    leg, message: message, messageEn: messageEn, arrivalCode: nil,
                    remaining: remaining, phase: .boarding))
            }
        case .vehiclePassed:
            if let leg {
                parts.append(TransitGuideTextRenderer.render(transitVehiclePassedLine(
                    isEn: transitGuideIsEn, leg: displayLeg(leg, useOverride: true))))
            }
        case .arrivingAtBoardStop:
            // A41: "곧 도착" = 직전 정류소 출발. 승격 없이 임박만 — 탑승 문장은 소실 뒤 boarded(departed)가 낸다.
            if let leg {
                parts.append(TransitGuideTextRenderer.render(transitArrivingAtBoardStopLine(
                    isEn: transitGuideIsEn, leg: displayLeg(leg, useOverride: false))))
            }
        case .arrivingAtAlightStop:
            // 차내 "이번 정류장" 방송과 같은 시점. 도착 문장은 소실 뒤 arrived(certain: false)가 낸다.
            parts.append(appLocalized("transitGuide.arrivingAtAlightStop"))
        case let .boarded(_, cause):
            if let leg {
                let d = displayLeg(leg, useOverride: false)
                // E41: 정거장 수는 착지가 앉는 상태 문장이 매 폴 말하므로 뺀다. 하차역은 **자동
                // 승격에만** 남긴다 — `boarding → riding`은 착지 대상이 아니라(N3 ①) 상태 문장이
                // 다시 낭독되지 않아 통지가 그 순간의 유일한 채널이다(a11y 감사 2026-09-12).
                // 관측 승격은 "도착했으니 타세요"가 그 순간의 지시라 그것을 앞세우고(departed는
                // 차량이 이미 떠났으므로 내지 않는다, A41), departed는 탑승 사실을 말한다.
                if cause == .observed {
                    parts.append(TransitGuideTextRenderer.render(
                        transitArrivedAtBoardStopLine(isEn: transitGuideIsEn, leg: d)))
                } else {
                    parts.append(TransitGuideTextRenderer.render(
                        transitBoardedLine(isEn: transitGuideIsEn)))
                }
                if cause != .declared {
                    parts.append(TransitGuideTextRenderer.render(
                        transitBoardedAlightLine(isEn: transitGuideIsEn, leg: d)))
                }
                // "이미 탑승" 식별 잠금(A34 ②)은 vehicleSelected를 내지 않으므로 어느 열차를 잠갔는지 여기서 말한다.
                if aboardBoardInStep, let desc = selectedDescription {
                    parts.append(TransitGuideTextRenderer.render(
                        transitSelectedVehicleLine(isEn: transitGuideIsEn, desc: desc)))
                }
            }
        case let .trackingStarted(message, messageEn, remaining, arrivalCode):
            if let leg { parts.append(contextText(leg)) }
            parts.append(appLocalized("transitGuide.trackingStarted"))
            if let leg {
                parts.append(arrivalText(
                    leg, message: message, messageEn: messageEn, arrivalCode: arrivalCode,
                    remaining: remaining, phase: .riding))
            }
        case let .countdown(remaining, message, messageEn, currentLocation, currentLocationEn, arrivalCode):
            // §12.3: 매 사다리마다 문맥 문장을 반복하지 않는다 — 도착 서술이 잔여와 시간을 함께 말한다.
            // 지하철 99(운행중)는 도착 조각이 비어 잔여 수만 남는다(A27).
            if let leg {
                parts.append(arrivalText(
                    leg, message: message, messageEn: messageEn, arrivalCode: arrivalCode,
                    remaining: remaining, phase: .riding))
            }
            // 한 정거장 전 현재 역 병치(§12.2, 피드백 #10) — 잔여 ≥ 2 문장은 원문이
            // 현재 역을 이미 담아 병치하지 않는다(중복 금지).
            if remaining <= 1,
               let location = transitLocationLabel(currentLocation, currentLocationEn) {
                parts.append(TransitGuideTextRenderer.render(
                    transitCurrentStationLine(isEn: transitGuideIsEn, location: location)))
            }
        case let .messageChanged(message, messageEn, arrivalCode):
            // 잔여는 바뀌지 않은 전이라 도착 서술만 낸다(잔여 조각 없음).
            if let leg {
                parts.append(arrivalText(
                    leg, message: message, messageEn: messageEn, arrivalCode: arrivalCode,
                    remaining: nil, phase: state?.phase == .boarding ? .boarding : .riding))
            }
        case let .arrived(certain):
            // 마지막 leg + 말미 도보(E34): 그 자리 버튼이 "남은 도보 안내 시작" 하나라 지시 문장이 그 이름을
            // 부르고 도보 분을 담는다("다음: 대중교통 구간이 끝났습니다…" 조각은 내지 않는다 — 내리기 전이다).
            if let walk = finalLegWalkMinutes {
                parts.append(appLocalized(
                    certain ? "transitGuide.arrivedWalkNext" : "transitGuide.arrivedGuessWalkNext", walk))
            } else {
                parts.append(appLocalized(certain ? "transitGuide.arrived" : "transitGuide.arrivedGuess"))
            }
            // 출구 방면(E25)은 **확정** 도착에만 — 추정 도착은 전 역에서 신호를 잃은 것일 수 있어
            // 확정형 출구 안내가 잘못 내리게 한다(설계 리뷰 #14). 서버가 역 밖 하차에만 실은 값.
            if certain, let leg, let exit = displayLeg(leg, useOverride: false).exitAlight {
                parts.append(TransitGuideTextRenderer.render(
                    transitExitBoundLine(isEn: transitGuideIsEn, exit: exit, sentence: true)))
            }
            if let state, let route {
                let nextIndex = state.legIndex + 1
                if route.legs.indices.contains(nextIndex) {
                    parts.append(appLocalized(
                        "transitGuide.nextLeg",
                        waitContextText(route.legs[nextIndex], isCurrentLeg: false)))
                } else if finalLegWalkMinutes == nil, let walk = route.walkAfterMinutes {
                    parts.append(appLocalized(
                        "transitGuide.nextLeg", appLocalized("transitGuide.doneWalk", String(walk))))
                }
            }
        case let .backOnTrack(message, messageEn, arrivalCode):
            parts.append(appLocalized("transitGuide.backOnTrack"))
            if let leg {
                parts.append(arrivalText(
                    leg, message: message, messageEn: messageEn, arrivalCode: arrivalCode,
                    remaining: nil, phase: .riding))
            }
        case .approxVehicleChanged:
            parts.append(appLocalized("transitGuide.approxVehicleChanged"))
        case .signalLost:
            // boarding의 소실은 "아직 안 탔는데 차량이 안 보인다"라 riding 문구와 다르다.
            parts.append(appLocalized(
                state?.phase == .boarding ? "transitGuide.boardingSignalLost" : "transitGuide.signalLost"))
        case .neverSeen:
            // 기본 우선순위로 둔다(A16 §3.4): 자기 소멸 버튼이 없고 포커스 이동을
            // 유발하지 않아 잠식 패턴에 해당하지 않는다.
            parts.append(appLocalized("transitGuide.neverSeen"))
        case .upstreamFailed:
            // boarding에서는 이 순간 수동 진행 수단이 조용히 선다(N3 ①) — 통지가 유일한
            // 발견 경로라 그 버튼 이름을 부른다(헌장 §3).
            parts.append(appLocalized(
                state?.phase == .boarding
                    ? "transitGuide.boardingUpstreamFailed" : "transitGuide.upstreamFailed"))
        case .signalRecovered:
            parts.append(appLocalized("transitGuide.signalRecovered"))
        case .capSlowed:
            parts.append(appLocalized("transitGuide.capSlowed"))
        case let .legAdvanced(legIndex, final):
            if final {
                // 발화는 advance()가 stop() 뒤에 한다(B1) — 여기서 내면 세대 증가에 취소된다.
                break
            } else if let route, route.legs.indices.contains(legIndex) {
                // ⚠ **다음 구간 문맥은 통지가 말한다**(E41 a11y 감사로 철회한 축소): 이 전이의 착지
                // 대상은 상태 문장이 아니라 차량 선택 목록 라벨(E38 예외)이라, 문맥을 빼면 새 구간의
                // 승차 정류소·노선·선행 도보가 어느 채널에도 남지 않는다.
                let next = route.legs[legIndex]
                parts.append(waitContextText(next, isCurrentLeg: false))
                if next.trackMode == nil { parts.append(appLocalized("transitGuide.untrackable")) }
            }
        case .boardingReset:
            parts.append(appLocalized("transitGuide.changeBoardingDone"))
        }
        return parts.filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// 완료 문장(마지막 구간 `advance`) — 말미 도보가 있으면 그 분을, 없으면 "도착했습니다".
    private func finalLegText() -> String {
        if let walk = route?.walkAfterMinutes {
            return appLocalized("transitGuide.doneWalk", String(walk))
        }
        return appLocalized("transitGuide.done")
    }

    /// 노선·하차 전문 문맥(§6.1 M1 개정) — 추적 시작·진행 상황·상시 표시가 담당.
    func contextText(_ leg: TransitGuideLeg) -> String {
        TransitGuideTextRenderer.render(
            transitContextLine(isEn: transitGuideIsEn, leg: displayLeg(leg, useOverride: false)))
    }

    /// leg → 표시 투영(E27 잔여 ①, spec §3.5). 조인 필드가 타입에 없어 이 아래에서는
    /// 노선명·역명을 조회 쿼리로 쓸 수 없다(1선은 구조).
    func displayLeg(_ leg: TransitGuideLeg, useOverride: Bool) -> TransitDisplayLeg {
        transitDisplayLeg(leg, boardOverrideIndex: useOverride ? boardOverrideIndex : nil)
    }

    /// boarding 문맥(N3) — 승차 정류소에서 선택 차량을 기다리는 중. 재선택 역이 있으면 그 역.
    func boardingContextText(_ leg: TransitGuideLeg) -> String {
        TransitGuideTextRenderer.render(
            transitBoardingContextLine(isEn: transitGuideIsEn, leg: displayLeg(leg, useOverride: true)))
    }

    /// 대기 문맥(§4.1): 선행 도보 + 승차 지점 + 노선.
    ///
    /// ⚠ **재선택한 기준 역이 있으면 그 역이 승차 지점이다**(A16 L3, 독립 리뷰 MAJOR).
    /// 이 문장은 상시 표시이자 진행 상황 발화라, 조회 대상과 어긋나면 화면은 "천호역
    /// 대기"라고 말하는데 그 아래 목록은 왕십리 도착 정보인 상태가 된다. 목록 항목에
    /// 역명이 없으므로(전 목록이 한 역 기준이라는 전제) **SR 사용자에게는 이 문장이
    /// 그 화면의 유일한 역 정보원**이다.
    /// - Parameter isCurrentLeg: 이 문맥이 **지금 안내 중인 구간**을 설명하는가.
    ///   ⚠ 기본값을 두지 않는 이유: 다음 구간 안내(`nextLeg`·`legAdvanced`)가 이전
    ///   구간에서 고른 역을 말하면 안 되는데, 생략이 컴파일을 통과하면 그 결함이
    ///   조용히 들어온다([[no-default-for-safety-parameters]]).
    func waitContextText(_ leg: TransitGuideLeg, isCurrentLeg: Bool) -> String {
        TransitGuideTextRenderer.render(
            transitWaitContextLine(
                isEn: transitGuideIsEn, leg: displayLeg(leg, useOverride: isCurrentLeg),
                isCurrentLeg: isCurrentLeg))
    }

    /// 신호 → 상시 표시 문구. ⚠ notYetVisible은 국면으로 갈린다 — "차량 접근 대기"는
    /// 대기 국면 어휘라 승차 중에 뜨면 "아직 못 탔다"로 뒤집혀 읽힌다(A16).
    ///
    /// 승차 뒤 세 문장(미관측·소실·확인 불가)은 **수단별 키**다(A33, 웹 `signalText` 미러) — 대중교통
    /// 추적은 GPS를 쓰지 않으므로 문장이 "열차/버스 위치"를 주어로 말해야 "앱이 내 위치를 못 잡는다"로
    /// 읽히지 않는다. 3-state: 아직 안 잡힘(정상, 하차역 부근에서 등장) / 잠시 끊김 / 끝내 확인 불가.
    /// ⚠ `isTrain`에 기본값을 두지 않는다 — 생략이 컴파일을 통과하면 버스 승차에 "열차"가 조용히 붙는다.
    /// `unobserved`(비관측 잠금, A34 ①)도 같다 — 호출 지점 셋(상시 표시·복귀 통지·조망 침묵 행)이 컴파일로
    /// 강제되어야 "하차역에 가까워지면 표시됩니다"가 폴을 하지 않는 상태에서 거짓으로 남지 않는다(리뷰 M1).
    /// 도착 국면은 신호와 무관하게 "하차 지점 도착."(관측·선언 공통, A37 ②).
    func signalStatusText(
        _ signal: TransitSignal, phase: TransitPhase, isTrain: Bool, unobserved: Bool
    ) -> String {
        if unobserved, phase == .riding {
            return isTrain
                ? appLocalized("transitGuide.stateRidingUnobserved")
                : appLocalized("transitGuide.stateRidingUnobservedBus")
        }
        if phase == .arrived { return appLocalized("transitGuide.stateArrived") }
        // 키는 리터럴로 쓴다 — 카탈로그 키 린터(`check-xcstrings-keys.mjs`)가 보간 키를 못 본다.
        return switch signal {
        case .tracking:
            phase == .boarding
                ? appLocalized("transitGuide.stateApproaching")
                : appLocalized("transitGuide.stateTracking")
        case .notYetVisible:
            switch phase {
            case .riding:
                isTrain
                    ? appLocalized("transitGuide.stateRidingNotYetVisible")
                    : appLocalized("transitGuide.stateRidingNotYetVisibleBus")
            case .boarding: appLocalized("transitGuide.stateBoardingNotYetVisible")
            default: appLocalized("transitGuide.stateNotYetVisible")
            }
        case .neverSeen:
            isTrain
                ? appLocalized("transitGuide.stateNeverSeen")
                : appLocalized("transitGuide.stateNeverSeenBus")
        case .signalLost:
            isTrain
                ? appLocalized("transitGuide.stateSignalLost")
                : appLocalized("transitGuide.stateSignalLostBus")
        case .upstreamFailed: appLocalized("transitGuide.stateUpstreamFailed")
        case .untrackable: appLocalized("transitGuide.stateUntrackable")
        }
    }

    private func nowMs() -> Double {
        Date().timeIntervalSince1970 * 1000
    }

    /// 세션 밖 오케스트레이터(`GuideSession`)의 통지 창구 — 승차 전 도보 시작·취소·불가 문장(A25).
    /// 같은 억제 규칙을 지난다.
    func announceExternal(_ message: String) {
        announce(message)
    }

    /// 자동 통지 창구(spec 2026-08-14 §4-6 동형). 안내 효과음이 재생 중이면 그 소리가 끝난 뒤에
    /// 게시한다(지연·latest-wins·세대는 `DeferredAnnouncer` 소유). 하차 임박·도착만 .high(§6.1).
    private func announce(_ message: String, highPriority: Bool = false) {
        deferredAnnouncer.announce(message, highPriority: highPriority)
    }

    /// 사용자 활성화의 **직접 응답** 전용 즉시 창구(진행 상황·새로고침 응답·재조회 통지·경로 교체).
    /// 즉시성이 문장의 본질이라 톤과 겹치더라도 미루지 않고, 보류 슬롯은 진입 즉시 버린다.
    private func announceNow(_ message: String, highPriority: Bool = false) {
        deferredAnnouncer.announceNow(message, highPriority: highPriority)
    }

    /// 실제 게시. 지연은 타이밍만 바꾸고 억제 계약은 바꾸지 않는다 — 대기가 끝난 게시 시도도
    /// 같은 가드를 지난다. 반환 = 실제로 게시했는가.
    @discardableResult
    private func post(_ message: String, highPriority: Bool, bypassSuppression: Bool) -> Bool {
        // 검색 시트(받아쓰기 마이크)가 열린 동안은 발화 0(스펙 §5.4) — 마지막 문장은 해제 시 복구(W2).
        guard bypassSuppression || !outputSuppressed else {
            droppedWhileSuppressed = message
            return false
        }
        // 백그라운드에서는 **발화만** 막는다(E36 §4.2.4, BeaconModel 동형 — 백그라운드 무발화는 실측이지
        // API 계약이 아니라 명시 게이트로). 복귀 시 현재 상태 하나만 낭독한다(`missedAnnouncement`).
        guard isForeground else {
            missedAnnouncement = true
            return false
        }
        var attributed = AttributedString(spokenUnits(message))
        if highPriority { attributed.accessibilitySpeechAnnouncementPriority = .high }
        AccessibilityNotification.Announcement(attributed).post()
        return true
    }
}

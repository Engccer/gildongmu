import CoreLocation
import CoreMotion
import GildongmuKit
import SwiftUI
import UIKit

/// 나들이 — 도착지 없는 도보 안내의 세션 모델(E51, spec `2026-09-26-outing-mode-design.md`).
///
/// 도보 안내(`BeaconModel`)와 **다른 모델**이다: 그쪽은 `StartRequest.dest`가 필수이고 fix 처리·종료 화면·
/// 띠바 문구가 목적지에 결박돼 있어, 늘리면 목적지 가드를 하나씩 풀어야 한다(spec §4). 부품(위치 스트림·
/// 만보계·톤 재생기·기기 음성·둘러보기·역지오코딩)은 재사용하고, **판정은 전부 Kit 순수 함수**다
/// (`OutingProjection`·`OutingPassBy`·`OutingRequery`·`OutingOrigin`·`OutingDistanceTone`·`OutingLandmark`).
/// 이 파일은 I/O와 상태 보관만 한다.
///
/// 세션 수명: 시작은 `GuideSession.startOuting` 한 곳, 단일 세션 잠금은 `GuideSessionCoordinator.claim`
/// 공유, 귀환은 `GuideSession.acceptOutingReturn`이 도보 안내로 인계한다(A25 동형).
///
/// ⚠ **백그라운드 음성은 명시 예외다**(spec §7.3): 도보 안내는 백그라운드에서 소리만 내지만 나들이는
/// 지나침이 한 번뿐이고 주변을 듣는 것이 목적이라 문장을 기기 음성으로 낸다. 전경 ∧ VoiceOver면
/// VoiceOver 창구로 — 두 목소리가 겹치지 않게 채널은 게시 시점에 하나만 고른다(`post`).
@Observable @MainActor
final class OutingModel {
    enum Status: Equatable { case idle, tracking }

    /// 종료 화면(spec §8.3). 세션이 끝나도 걸음 요약과 귀환 버튼을 남긴다. 소거는 "닫기"(`clearEnd`)·
    /// 새 세션·귀환 인계·백그라운드 뒤 30분 만료뿐.
    struct EndScreen: Equatable {
        let reason: String
        let health: WalkHealthSummary?
        /// 귀환 목표(출발점이 확정됐을 때만).
        let origin: ReturnTarget?
    }

    struct ReturnTarget: Equatable {
        let lat: Double
        let lng: Double
        let label: String
    }

    private(set) var status: Status = .idle
    /// 시작 재진입·권한 대기 창. `GuideSession.isActive`가 함께 본다(그 창에서 다른 시작이 통과하지 않게).
    private(set) var starting = false
    var isTracking: Bool { status == .tracking }
    private(set) var endScreen: EndScreen?
    /// 받아쓰기·검색 시트가 켜는 출력 억제(톤·문장). 세션 경계에서 해제한다.
    var outputSuppressed = false {
        didSet { tones.isSuppressed = outputSuppressed }
    }

    // MARK: 출발점

    private(set) var origin: RouteOriginFix?
    /// 출발점 역지오코딩 라벨. nil이면 "출발점"으로 부른다(조회 중·실패 공통 — 귀환은 좌표로 동작한다).
    private(set) var originLabel: String?
    /// 출발점 라벨 조회가 끝났는가(성공·실패). 끝나기 전엔 상태 행이 "출발점 잡는 중"을 유지한다 — 확정 순간과
    /// 라벨 도착 순간에 착지 행이 두 번 바뀌지 않게(접근성 감사 m4). 귀환 버튼은 좌표만 있으면 되므로 `origin`을 본다.
    private(set) var originLabelDone = false
    private var originBest: RouteOriginFix?
    private var originBestAt: Double?

    // MARK: 걸음

    /// 만보계 누적 거리(m). nil = 아직 값이 없다(권한 거부·미지원이면 계속 nil).
    private(set) var walkedMeters: Double?
    private(set) var pedometerUnavailable = false
    private var liveHealthSample: (steps: Int, distance: Double?)?
    private let pedometer: PedometerQuerying

    // MARK: 방위·주변

    private var derivation = initialDerivationState
    private var headingState = OutingHeadingState()
    private var motionState = MotionJudgeState.initial
    private(set) var heading: OutingHeading = .none
    /// 둘러보기 장소(id 키, 재조회를 넘어 누적 — 조망·지나침 판정이 목록 교체로 관계를 잃지 않게).
    private(set) var places: [String: SurroundingPlace] = [:]
    /// 마지막 fix에서의 진행축 관계(장소 id 키). 지나침 판정의 `previous`이자 조망의 원천.
    private(set) var relations: [String: OutingRelation] = [:]
    private var spokenPlaces: Set<String> = []
    private var crosswalks: [String: OutingCrosswalk] = [:]
    private var audioSignals: [RoutePoint] = []
    private var spokenCrosswalks: Set<String> = []
    private(set) var surroundingsStatus: OutingSurroundingsStatus = .loading
    private var surroundingsFailures = 0
    private var lastQuery: RoutePoint?
    /// 직전 조회가 실패한 시각 — 제자리에서도 재시도한다(`outingRequeryStep`).
    private var lastQueryFailedAt: Double?
    private var queryTask: Task<Void, Never>?
    /// 조망 스냅샷(연 순간 + 그때 건 재조회가 반영된 첫 fix). 조망이 fix마다 다시 계산되면 커서 아래 항목이
    /// 구획 사이를 옮겨 다닌다(접근성 감사 M4) — "지금 둘러보기"라 열린 동안 몇 초의 낡음은 손실이 아니다.
    private(set) var overviewRelations: [String: OutingRelation] = [:]
    private(set) var overviewHeadingValid = false
    /// 조망을 연 뒤 첫 조회 커밋에서 스냅샷을 다시 찍는다 — 조회가 진행 중이거나 출발점 확정 전에 연 조망이 빈 스냅샷을
    /// 든 채 "없음"을 말하지 않게(구현 검증 N1). 조망이 따로 거는 재조회든 진행 중이던 조회든 같은 표식이다.
    private var overviewAwaitingCommit = false
    private var road = OutingRoadState()
    /// 방향 행의 앞쪽 이정표 문구 — 방위가 valid인 마지막 fix에서 정한다(정지 중에도 "…, 마지막 진행 방향"과 함께 남는다).
    private(set) var aheadText: String?
    private(set) var lastFix: (lat: Double, lng: Double, accuracy: Double)?
    /// 잠금·백그라운드에서 소리가 날 수 없는 상태(오디오 세션 승격 실패·지연). 나들이는 화면이 꺼진 뒤 기기 음성으로
    /// 주변을 말하는 것이 핵심이라 도보 안내와 같은 문장으로 알리고 시트에 행으로 남긴다(spec §13).
    private(set) var soundDegraded = false
    private var silencedNoticed = false
    /// 시작 문장이 나갔는가 — 그 뒤의 무음 전이(인터럽션·route 변경 뒤 재승격 실패)는 따로 알린다.
    private var startAnnounced = false
    /// 안전 문장(시작·횡단보도)이 나간 뒤 이 시각까지는 주변 문장을 미룬다 — 두 대기 칸(톤 뒤 지연·기기 음성)이
    /// 모두 새 문장이 옛 문장을 버리는 방식이라, 같은 fix의 지나침이 횡단보도 예고를 지울 수 있다(spec 준수 리뷰 M-2).
    private var protectedUntil: Double = 0
    private var deferredLow: String?
    /// 마지막 안전 문장 — 기기 음성 대기 칸이 유효 시간에서 제외한다(버려지면 안 되는 문장).
    private var protectedText: String?

    // MARK: 세션 기계

    private var sessionToken: Int?
    private var startTask: Task<Void, Never>?
    private var watchdog: Task<Void, Never>?
    private var startedAt: Double?
    private var lastFixAt: Double?
    private var lastStaleNoticeAt: Double?
    private var sessionProgressAnchor: RoutePoint?
    private var sessionLastProgressAt: Double?
    private var toneState = ToneLayerState.initial
    private var lastBeepMeters: Double = 0
    private var wasBackgrounded = false
    private var endedAt: ContinuousClock.Instant?
    private var uptimeNow: Double { ProcessInfo.processInfo.systemUptime }
    private var isForeground: Bool { UIApplication.shared.applicationState != .background }

    private let tones = BeaconTonePlayer(label: "outing")
    /// 톤 뒤 발화 지연(spec 2026-08-14 `speechDeferStep`) — 두 채널 공통의 앞단.
    @ObservationIgnored private lazy var announcer = DeferredAnnouncer(
        clock: { ProcessInfo.processInfo.systemUptime },
        toneEndsAt: { [weak self] in self?.tones.toneEndsAt },
        post: { [weak self] text, high, bypass, speechClass, onLateDrop in
            self?.post(
                text, highPriority: high, bypassSuppression: bypass, speechClass: speechClass,
                onLateDrop: onLateDrop) ?? false
        }
    )
    /// 기기 음성 대기 한 칸(spec §7.3 — 선점하지 않는다, 유효 6초, 꺼낼 때 채널 재선택). E53(2026-09-30)부터 세 안내
    /// 모델이 같은 Kit 타입(`DeviceSpeechQueue`)을 쓴다. 나들이만 전경 ∧ VoiceOver 꺼짐에서도 기기 음성이다.
    @ObservationIgnored private lazy var deviceSpeech = GuideSpeechOutput.makeDeviceQueue(
        foregroundDeviceSpeech: true,
        isSuppressed: { [weak self] in self?.outputSuppressed ?? true },
        toneEndsAt: { [weak self] in self?.tones.toneEndsAt },
        backgroundAudible: { [weak self] in self?.tones.isBackgroundAudible ?? false }
    )
    /// 전하지 못한 종료 사유 문장(E53 spec §3.4, 설계 리뷰 M6) — 백그라운드에서 버려진(안전망 종료는 미룸 문장, 토글 끔이면
    /// 전부) 종료 문장을 복귀 때 한 번 갚는다. 종료 화면이 없는 종료(출발점 미확정 ∧ 의미 없는 걸음)도 갚아야 해서 화면이
    /// 아니라 이 장부에 건다. 30분이 지나면(`isEndScreenStale`) 갚지 않는다 — 맥락 밖 낭독. 새 세션 시작이 지운다.
    private var owedEndReason: (text: String, at: ContinuousClock.Instant)?
    /// 보호 창(초) — 시작·횡단보도 문장 뒤 주변 문장을 미루는 길이.
    private let protectSeconds = 3.0

    /// 무-fix 톤 임계·약신호 통지·재통지(초) — 도보 안내 `BeaconModel`과 같은 값.
    private let noFixSeconds = 8.0
    private let noFixTimeout = 15.0
    private let staleRenotifyInterval = 30.0

    private let nearby = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
    private let walkInfra = WalkInfraService(client: APIClient(baseURL: AppConfig.apiBaseURL))
    private let search = SearchService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    init(pedometer: PedometerQuerying = PedometerService()) {
        self.pedometer = pedometer
    }

    /// 낭독 단계(설정은 시트의 `@AppStorage`, 매 판정 시 읽는다).
    private var narration: OutingNarration {
        OutingNarration(rawValue: UserDefaults.standard.string(forKey: OutingNarration.storageKey) ?? "")
            ?? .default
    }

    /// 귀환 목표 — 세션 중이면 확정된 출발점, 종료 화면이면 그 화면의 것.
    var returnTarget: ReturnTarget? {
        if isTracking, let origin { return ReturnTarget(lat: origin.lat, lng: origin.lng, label: originDisplayName) }
        return endScreen?.origin
    }

    var originDisplayName: String { originLabel ?? appLocalized("ios.outing.originFallback") }

    // MARK: - 시작

    /// `GuideSession.startOuting`만 부른다(거부 게이트는 그쪽).
    func requestStart() {
        guard !starting, !isTracking else { return }
        starting = true
        startTask = Task { [weak self] in
            await self?.start()
            self?.starting = false
        }
    }

    private func start() async {
        // 권한·정밀 위치 검사는 claim **앞**(도보 안내 순서, spec §5.1). 실패 문장은 도보 안내와 같다(§12).
        guard LocationService.shared.isLocationServiceEnabled else { return refuse("beacon.weak") }
        switch LocationService.shared.authorizationSnapshot {
        case .denied, .restricted: return refuse("beacon.denied")
        case .notDetermined:
            await LocationService.shared.primeAuthorization()
            guard !Task.isCancelled else { return }
            switch LocationService.shared.authorizationSnapshot {
            case .authorizedWhenInUse, .authorizedAlways: break
            default: return refuse("beacon.denied")
            }
        default: break
        }
        guard LocationService.shared.accuracySnapshot != .reducedAccuracy else { return refuse("beacon.reduced") }
        guard !Task.isCancelled else { return }
        guard let token = GuideSession.shared.coordinator.claim(stop: { [weak self] in self?.stop() }) else {
            return refuse("guide.alreadyActive")
        }
        sessionToken = token
        announcer.advanceGeneration()
        deviceSpeech.reset()
        owedEndReason = nil
        resetSessionState()
        clearEnd()
        startedAt = uptimeNow
        status = .tracking
        outputSuppressed = false
        UIApplication.shared.isIdleTimerDisabled = true
        guideDiagLog("outingStart")

        let sessionStart = Date()
        pedometer.requestAuthorizationIfNeeded()
        pedometerUnavailable = !CMPedometer.isStepCountingAvailable()
            || [.denied, .restricted].contains(CMPedometer.authorizationStatus())
        pedometer.startLiveUpdates(from: sessionStart) { [weak self] steps, distance in
            guard let self, self.isTracking else { return }
            self.handlePedometer(steps: steps, distance: distance)
        }

        tones.beginSession()
        playTone(.start)  // 가청 판정(`soundDegraded`)도 여기서 처음 선다 — 통지는 아래 시작 문장이 함께 낸다
        LocationService.shared.startBeaconUpdates(
            onFix: { [weak self] fix in self?.handle(fix: fix) },
            onError: { [weak self] code in self?.handle(locationError: code) },
            onAuthChange: { [weak self] status in self?.handle(authorization: status) },
            onAccuracyChange: { [weak self] accuracy in self?.handle(accuracy: accuracy) }
        )
        startWatchdog()
        // 전경 VoiceOver에선 시트 제목과 상태 행 착지가 시작을 알린다 — 통지는 착지와 경합만 한다(접근성 감사 m2).
        // VoiceOver가 꺼졌거나 백그라운드에서 시작한 경우에만 기기 음성으로 말한다. 잠금 무음 경고는 시작 문장과 **한
        // 문장**으로 낸다 — 따로 내면 지연 슬롯의 최신 우선 규칙에 경고가 지워진다(구현 검증 N3).
        let warning = soundDegraded ? appLocalized("ios.beacon.soundBackgroundUnavailable") : nil
        if soundDegraded { ResultHaptic.fire(.attention) }
        if !(isForeground && UIAccessibility.isVoiceOverRunning) {
            sayProtected([appLocalized("ios.outing.started"), warning].compactMap { $0 }.joined(separator: ". "))
        } else if let warning {
            sayProtected(warning)
        }
        startAnnounced = true
    }

    /// 시작 거절 — 버튼 활성화의 직접 응답이라 `.high`(헌장 §5).
    private func refuse(_ key: String) {
        announcer.announceNow(appLocalized(key), highPriority: true, bypassSuppression: true)
    }

    private func resetSessionState() {
        origin = nil
        originLabel = nil
        originLabelDone = false
        originBest = nil
        originBestAt = nil
        walkedMeters = nil
        pedometerUnavailable = false
        liveHealthSample = nil
        derivation = initialDerivationState
        headingState = OutingHeadingState()
        motionState = .initial
        heading = .none
        places = [:]
        relations = [:]
        spokenPlaces = []
        crosswalks = [:]
        audioSignals = []
        spokenCrosswalks = []
        surroundingsStatus = .loading
        surroundingsFailures = 0
        lastQuery = nil
        lastQueryFailedAt = nil
        queryTask?.cancel()
        queryTask = nil
        overviewRelations = [:]
        overviewHeadingValid = false
        overviewAwaitingCommit = false
        road = OutingRoadState()
        aheadText = nil
        lastFix = nil
        lastFixAt = nil
        lastStaleNoticeAt = nil
        sessionProgressAnchor = nil
        sessionLastProgressAt = nil
        toneState = .initial
        lastBeepMeters = 0
        soundDegraded = false
        silencedNoticed = false
        startAnnounced = false
        protectedUntil = 0
        deferredLow = nil
        deviceSpeech.reset()
    }

    // MARK: - 종료

    /// 세션 정리(세 종료 경로 공통). 종료 화면은 호출부가 정한다. `holdSeconds`는 이어질 종료 문장이 말하기 시작할 때까지
    /// 오디오 원복을 붙드는 다리다 — 그 뒤는 `endSession`의 발화 대기가 문장이 끝날 때까지 잇는다(E53 §7).
    func stop(playStopTone: Bool = false, holdSeconds: Double = 0) {
        // 보류 문장 폐기 — 종료 뒤에 끝난 세션의 지나침이 나오지 않게(도보 `stop()` 동형). 종료 문장은 이 호출 **뒤에**
        // 새로 예약되므로 소실되지 않는다(호출 순서가 계약).
        announcer.advanceGeneration()
        deviceSpeech.reset()
        deferredLow = nil
        // 멱등: 이미 끝난 세션(종료 화면 → 귀환)에서 다시 불려도 오디오·위치를 두 번 원복하지 않는다 — 두 번째
        // `endSession(0)`이 첫 번째가 미룬 원복보다 먼저 떨어져 종료 문장을 자른다(구현 리뷰 m3).
        let wasActive = isTracking || starting || sessionToken != nil
        if let token = sessionToken {
            sessionToken = nil
            GuideSession.shared.coordinator.release(token)
        }
        startTask?.cancel()
        startTask = nil
        starting = false
        watchdog?.cancel()
        watchdog = nil
        queryTask?.cancel()
        queryTask = nil
        guard wasActive else { return }
        LocationService.shared.stopBeaconUpdates()
        pedometer.stopLiveUpdates()
        UIApplication.shared.isIdleTimerDisabled = false
        if playStopTone, isTracking { playTone(.stop) }
        tones.endSession(
            holdSeconds: holdSeconds,
            speechBusy: { [weak self] in GuideSpeechOutput.speechBusy(self?.deviceSpeech) })
        status = .idle
        outputSuppressed = false
    }

    /// 사용자 종료("나들이 종료" 버튼). 종료 화면을 남기고 사유를 알린다(포커스를 쥔 버튼이 사라지는 전이라 `.high`).
    func stopByUser() {
        guideDiagLog("outingEnd reason=user")
        let text = appLocalized("ios.outing.endedByUser")
        endLeavingScreen(reason: text, playStopTone: true)
        say(text, highPriority: true, speechClass: .actionable)
    }

    /// 안전망 종료(두절·무이동 5분). 정지 톤은 화면이 꺼져 있어도 낸다(E53 위원장 판정 — 도보와 다르다, 아래 본문).
    private func endIdle(reason: SessionIdleReason) {
        guideDiagLog("outingEnd reason=\(reason.rawValue)")
        let text = appLocalized("guide.endedIdle")
        // 나들이만 예외(E53 위원장 판정 2026-09-30): 화면이 꺼져 있어도 종료음을 내고, 백그라운드 음성 안내가 켜져 있으면
        // 문장도 기기 음성으로 말한다(행동 문장). 나들이는 잠근 채 비프를 듣고 걷는 모드라 조용히 끝나면 비프가 끊긴 이유를
        // 모른다. 도보·자동차·대중교통의 안전망 종료는 백그라운드에서 무음 그대로다. 문장을 전하지 못하면(토글 끔) 복귀 때
        // 한 번 갚는다(`sayEnd` 장부 — 전한 문장은 되풀이하지 않는다).
        endLeavingScreen(reason: text, playStopTone: true)
        sayEnd(text, speechClass: .actionable)
    }

    /// 종료 화면을 남기는 종료. 걸음 요약과 귀환 버튼 중 하나라도 있으면 화면이 성립한다(spec §8.3).
    private func endLeavingScreen(reason: String, playStopTone: Bool) {
        let target = returnTarget
        let sample = liveHealthSample
        // 종료 문장이 기기 음성으로 나가면(백그라운드·VoiceOver 꺼짐) 원복이 그 문장을 자르지 않게 다리를 두고, 문장이 끝날
        // 때까지는 `endSession`의 발화 대기가 잇는다(E53 §7 — 글자 수 어림은 앞 문장이 길면 모자랐다).
        stop(playStopTone: playStopTone, holdSeconds: deviceSpeechEndBridgeSeconds)
        let health = sample.flatMap { s -> WalkHealthSummary? in
            guard WalkHealth.isMeaningfulWalk(steps: s.steps, distanceMeters: s.distance) else { return nil }
            return WalkHealth.summary(steps: s.steps, distanceMeters: s.distance, weightKg: Self.storedWeight())
        }
        guard health != nil || target != nil else { return }
        endScreen = EndScreen(reason: reason, health: health, origin: target)
        endedAt = .now
    }

    /// 귀환 인계 직전(`GuideSession.acceptOutingReturn`): 종료 화면을 치운다(귀환은 종료 화면에서만 시작하므로 `stop()`은 방어용, spec §5.3).
    func endForReturn() {
        if isTracking { guideDiagLog("outingEnd reason=return") }
        stop()
        clearEnd()
    }

    /// 종료 화면 소거 — 닫기·새 세션·귀환 인계·30분 만료가 전부 여기를 지난다.
    func clearEnd() {
        // 체중 권유 응답 표식은 그 화면의 것이다 — 닫기 밖의 소거(만료·인계·새 세션)에서 다음 화면으로 새지 않게(E31).
        // 도보 종료 화면과 같은 키라, 나들이 종료 화면이 있을 때만 지운다(코디네이터가 도보·대중교통 시작마다 부른다).
        if endScreen != nil { UserDefaults.standard.set(false, forKey: WalkHealth.weightPromptEngagedKey) }
        endScreen = nil
        endedAt = nil
    }

    /// 체중을 입력하고 돌아왔을 때 같은 표본으로 요약을 다시 계산한다(도보 종료 화면 동형).
    func recomputeHealth() {
        guard let screen = endScreen, let s = liveHealthSample,
              WalkHealth.isMeaningfulWalk(steps: s.steps, distanceMeters: s.distance) else { return }
        endScreen = EndScreen(
            reason: screen.reason,
            health: WalkHealth.summary(steps: s.steps, distanceMeters: s.distance, weightKg: Self.storedWeight()),
            origin: screen.origin)
    }

    private static func storedWeight() -> Double? {
        WalkHealth.normalizedWeight(UserDefaults.standard.object(forKey: WalkHealth.weightStorageKey) as? Double)
    }

    // MARK: - 앱 생명주기

    func handleScenePhaseChange(to phase: ScenePhase) {
        switch phase {
        case .background:
            wasBackgrounded = true
            if isTracking { UIApplication.shared.isIdleTimerDisabled = false }
        case .active:
            let returned = wasBackgrounded
            wasBackgrounded = false
            if isTracking { UIApplication.shared.isIdleTimerDisabled = true }
            // 오래된 종료 화면은 백그라운드를 거친 복귀에서만 버린다(도보 A31 축 ② 동형).
            if returned, !isTracking, endScreen != nil, let endedAt {
                let age = endedAt.duration(to: .now)
                let seconds = Double(age.components.seconds) + Double(age.components.attoseconds) / 1e18
                if isEndScreenStale(secondsSinceEnd: seconds) { clearEnd() }
            }
            // 복귀(E53 spec §3.4·§4.2 ⑥): 채널이 VoiceOver로 바뀐 기기 음성(인계)과 전하지 못한 종료 사유(장부 `owedEndReason`,
            // 종료 화면 유무와 무관 — 설계 리뷰 M6)를 **한 통지**로 낸다(두 통지를 잇달아 내면 뒤의 것이 앞의 것을 자른다).
            // 30분 넘은 종료 사유는 갚지 않는다(맥락 밖 낭독). 추적 중 복귀엔 장부가 없다 — 지나침·횡단보도는 자리에 묶인
            // 문장이라 나중에 말하면 거짓이다. 화면 변화 없는 통지라 `.high`.
            if returned {
                var owed = deviceSpeech.handOver()
                if let end = owedEndReason {
                    owedEndReason = nil
                    let age = end.at.duration(to: .now)
                    let seconds = Double(age.components.seconds) + Double(age.components.attoseconds) / 1e18
                    if !isTracking, !isEndScreenStale(secondsSinceEnd: seconds), !owed.contains(end.text) {
                        owed.append(end.text)
                    }
                }
                if !owed.isEmpty { say(owed.joined(separator: " "), highPriority: true, speechClass: .actionable) }
            }
        default:
            break
        }
    }

    // MARK: - 만보계

    private func handlePedometer(steps: Int, distance: Double?) {
        liveHealthSample = (steps, distance)
        // 걸음은 오는데 거리가 없으면(거리 미지원·보정 전) "0m"가 아니라 "정보 없음"이다(3-state).
        guard let distance else {
            if walkedMeters == nil { pedometerUnavailable = true }
            return
        }
        pedometerUnavailable = false
        let previous = walkedMeters ?? 0
        walkedMeters = distance
        // 10m 경계를 넘으면 **한 번만**(spec §6.5 — 한 콜백에 20m가 와도 연타하지 않는다).
        if outingDistanceToneStep(previousMeters: max(previous, lastBeepMeters), currentMeters: distance) > 0 {
            lastBeepMeters = distance
            playTone(.tick)
        }
    }

    /// 만보계 가용성 재판정 — 시작 시점엔 권한이 미확정일 수 있고 팝업에서 거부하면 갱신이 영영 오지 않는다(리뷰 M3·M5).
    private func refreshPedometerAvailability() {
        guard walkedMeters == nil else { return }
        let unavailable = !CMPedometer.isStepCountingAvailable() || !CMPedometer.isDistanceAvailable()
            || [.denied, .restricted].contains(CMPedometer.authorizationStatus())
        if unavailable { pedometerUnavailable = true }
    }

    // MARK: - fix 처리

    private func handle(fix: LocationService.BeaconFixPayload) {
        guard isTracking else { return }
        let now = uptimeNow
        let age = Date().timeIntervalSince(fix.timestamp)
        let motion: MotionState
        if abs(age) <= BeaconConstants.freshnessWindow {
            let out = motionStep(
                state: motionState,
                sample: MotionSample(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, at: now),
                speed: fix.speed, speedAccuracy: fix.speedAccuracy,
                maxSpeedMps: MotionConstants.maxWalkSpeedMps)
            motionState = out.state
            motion = out.motion
        } else {
            motion = .speedUnknown
        }
        guard isUsableFix(accuracy: fix.accuracy, ageSeconds: age) else {
            routeUnreliableTone(now: now)
            return
        }
        lastFixAt = now
        lastStaleNoticeAt = nil
        lastFix = (fix.lat, fix.lng, fix.accuracy)
        // 신뢰 회복을 톤 계층에 알린다 — 안 알리면 `wasUnreliable`이 래치돼 다음 두절의 "진입 즉시 1회"가 사라진다.
        toneState = toneLayerStep(state: toneState, input: ToneLayerInput(), now: now).state
        let anchorStep = advanceProgressAnchor(
            anchor: sessionProgressAnchor, fix: RoutePoint(lat: fix.lat, lng: fix.lng),
            epsilonMeters: sessionProgressEpsilonMeters)
        sessionProgressAnchor = anchorStep.anchor
        if anchorStep.progressed { sessionLastProgressAt = now }

        if origin == nil {
            decideOrigin(fix: RouteOriginFix(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, ageSeconds: age), now: now)
        }

        let derived = deriveCourse(derivation, lat: fix.lat, lng: fix.lng, at: now)
        derivation = derived.state
        if let obs = derived.obs { headingState = outingHeadingRecord(headingState, course: obs, at: now) }
        heading = outingHeading(headingState, motion: motion, now: now)
        guideDiagLog(
            "outingFix t=\(String(format: "%.1f", now)) lat=\(String(format: "%.6f", fix.lat)) "
                + "lng=\(String(format: "%.6f", fix.lng)) acc=\(String(format: "%.1f", fix.accuracy)) "
                + "motion=\(motion) heading=\(headingLog)")

        // 첫 조회는 출발점 확정 fix에서(spec §6.2 — 세션 첫 fix는 가장 나쁜 fix다).
        let here = RoutePoint(lat: fix.lat, lng: fix.lng)
        if origin != nil, queryTask == nil,
           outingRequeryStep(lastQuery: lastQuery, fix: here, lastFailureAt: lastQueryFailedAt, now: now) {
            requery(at: here, reason: lastQuery == nil ? "origin" : (lastQueryFailedAt != nil ? "retry" : "distance"))
        }
        evaluate(fix: fix)
    }

    private var headingLog: String {
        switch heading {
        case .none: "none"
        case .stale(let b): "stale(\(Int(b)))"
        case .valid(let b, let u): "valid(\(Int(b)),U=\(Int(u)))"
        }
    }

    private func decideOrigin(fix: RouteOriginFix?, now: Double) {
        guard let startedAt else { return }
        // 보관한 최선값은 받은 순간의 나이를 들고 있다 — 판정에는 지난 시간만큼 늙힌 사본을 넘기고 보관은 원본으로
        // 둔다(늙힌 값을 저장하면 다음 틱에 또 더해져 복리로 불어난다, 구현 리뷰 m1. 도보 routeOriginBestAt 동형).
        var aged = originBest
        if var b = aged, let at = originBestAt { b.ageSeconds += now - at; aged = b }
        if fix == nil, aged == nil { return }
        let window = now - startedAt < outingOriginWindowSeconds ? "in" : "after"
        switch outingOriginStep(best: aged, fix: fix, elapsedSeconds: now - startedAt) {
        case .confirm(let chosen):
            confirmOrigin(chosen, window: fix == nil ? "end" : window)
        case .wait(let next):
            guard next != aged else { return }  // 보관 후보 불변
            originBest = next
            originBestAt = now
        }
    }

    private func confirmOrigin(_ fix: RouteOriginFix, window: String) {
        origin = fix
        originBest = nil
        originBestAt = nil
        guideDiagLog("outingOrigin acc=\(String(format: "%.1f", fix.accuracy)) window=\(window)")
        // 첫 조회는 확정 좌표에서(spec §6.2) — 창 끝 타이머로 확정됐을 때 다음 fix의 좌표로 나가지 않게.
        if queryTask == nil, lastQuery == nil { requery(at: RoutePoint(lat: fix.lat, lng: fix.lng), reason: "origin") }
        let lang = AppLanguage.dataLocale
        Task { [weak self, search] in
            let resolved = try? await search.reverseGeocode(lat: fix.lat, lng: fix.lng, lang: lang)
            guard let self, self.isTracking, self.origin == fix else { return }
            let label = lang == "ko" ? resolved?.address : (resolved?.english ?? resolved?.address)
            self.originLabel = label
            self.originLabelDone = true
            self.sayLow(self.statusLine)
        }
    }

    // MARK: - 주변 조회

    private func requery(at point: RoutePoint, reason: String) {
        lastQuery = point
        let lang = AppLanguage.dataLocale
        queryTask = Task { [weak self, nearby, walkInfra, search] in
            async let aroundResult: Result<[SurroundingPlace], Error> = {
                do { return .success(try await nearby.surroundings(lat: point.lat, lng: point.lng)) }
                catch { return .failure(error) }
            }()
            async let walkResult = try? await walkInfra.nearbyWithCoordinates(lat: point.lat, lng: point.lng)
            async let addressResult = try? await search.reverseGeocode(lat: point.lat, lng: point.lng, lang: lang)
            let (around, walk, address) = await (aroundResult, walkResult, addressResult)
            guard let self, !Task.isCancelled, self.isTracking else { return }
            self.queryTask = nil
            self.commit(around: around, walk: walk, address: address, lang: lang, reason: reason)
        }
    }

    private func commit(
        around: Result<[SurroundingPlace], Error>, walk: WalkInfrastructure?,
        address: ReverseGeocodeResponse?, lang: String, reason: String
    ) {
        let outcome: OutingQueryOutcome
        switch around {
        case .success(let list):
            for p in list { places[p.id] = p }
            outcome = .success
        case .failure(let error):
            if case APIError.outOfCoverage = error { outcome = .outOfCoverage } else { outcome = .failure }
        }
        let next = outingSurroundingsStep(status: surroundingsStatus, failures: surroundingsFailures, result: outcome)
        surroundingsStatus = next.status
        surroundingsFailures = next.failures
        lastQueryFailedAt = outcome == .failure ? uptimeNow : nil
        if overviewAwaitingCommit {
            overviewAwaitingCommit = false
            snapshotOverview(projectingFrom: lastFix)
        }
        if case .ok(let osm) = walk?.osm {
            for f in osm.features where f.crossing {
                if let lat = f.lat, let lng = f.lng { crosswalks[f.osmId] = OutingCrosswalk(id: f.osmId, lat: lat, lng: lng) }
            }
        }
        if case .ok(let signals) = walk?.audioSignals {
            let points = signals.sites.compactMap { s in s.lat.flatMap { lat in s.lng.map { RoutePoint(lat: lat, lng: $0) } } }
            for p in points where !audioSignals.contains(p) { audioSignals.append(p) }
        }
        let observed = (lang == "ko" ? address?.address : (address?.english ?? address?.address))
            .flatMap(outingRoadName(fromAddress:))
        let roadStep = outingRoadNameStep(road, observed: observed)
        road = roadStep.state
        guideDiagLog(
            "roadName value=\(observed ?? "-") confirmed=\(road.confirmed ?? "-") pending=\(road.pending ?? "-")")
        guideDiagLog(
            "requery reason=\(reason) n=\(places.count) fail=\(surroundingsFailures) "
                + "crosswalks=\(crosswalks.count) road=\(road.confirmed ?? "-")")
        if let name = roadStep.announce, narration.speaks(.landmark) {
            sayLow(appLocalized("ios.outing.roadEntered", name))
        }
    }

    // MARK: - 판정 → 낭독

    private func evaluate(fix: LocationService.BeaconFixPayload) {
        var next: [String: OutingRelation] = [:]
        for (id, p) in places {
            next[id] = outingProject(
                fixLat: fix.lat, fixLng: fix.lng, accuracy: fix.accuracy,
                heading: heading, placeLat: p.lat, placeLng: p.lng)
        }
        let level = narration
        let now = uptimeNow
        // 한 fix에 한 문장, 횡단보도 예고가 먼저다 — 안전 정보(spec §6.3). 예고가 나간 fix와 그 뒤 보호 창 동안은
        // 지나침을 판정하지 않고 관계도 갱신하지 않는다: 옛 관계를 들고 있어야 다음 판정 fix에서 "앞 → 옆" 전이를
        // 잃지 않는다(보호 창이 끝나면 그 전이를 말한다).
        var crosswalkSpoken = false
        if level.speaks(.landmark) {
            let pairs = crosswalks.values.map { c in
                (crosswalk: c, relation: outingProject(
                    fixLat: fix.lat, fixLng: fix.lng, accuracy: fix.accuracy,
                    heading: heading, placeLat: c.lat, placeLng: c.lng))
            }
            if let notice = outingCrosswalkNoticeStep(crosswalks: pairs, audioSignals: audioSignals, spoken: spokenCrosswalks) {
                spokenCrosswalks.insert(notice.id)
                guideDiagLog("crosswalk id=\(notice.id) audio=\(notice.hasAudioSignal)")
                sayProtected(appLocalized(notice.hasAudioSignal ? "ios.outing.crosswalkAheadAudio" : "ios.outing.crosswalkAhead"))
                crosswalkSpoken = true
            }
        }
        if crosswalkSpoken || now < protectedUntil {
            if case .valid = heading { aheadText = aheadLandmarkText(next) }
            return
        }
        if level != .off {
            let candidates = next.compactMap { id, cur -> OutingPassByCandidate? in
                guard let p = places[id], level.speaks(outingLandmarkTier(category: p.category)) else { return nil }
                return OutingPassByCandidate(id: id, previous: relations[id], current: cur)
            }
            let result = outingPassByStep(candidates: candidates, spoken: spokenPlaces)
            spokenPlaces.formUnion(result.silenced)
            if let id = result.spoken, let p = places[id], let rel = next[id] {
                spokenPlaces.insert(id)
                guideDiagLog(
                    "passBy id=\(id) tier=\(outingLandmarkTier(category: p.category).rawValue) "
                        + "s=\(Int(rel.s)) t=\(Int(rel.t)) side=\(rel.side.rawValue) d=\(Int(rel.d))")
                sayLow(Self.passByLine(name: displayName(p), side: rel.side))
            }
        }
        relations = next
        if case .valid = heading { aheadText = aheadLandmarkText(next) }
    }

    /// 방향 행 앞 절반의 이정표 — 앞 구획의 가장 가까운 landmark(10m 양자화).
    private func aheadLandmarkText(_ rels: [String: OutingRelation]) -> String {
        let nearest = rels
            .filter { id, r in r.zone == .ahead && places[id].map { outingLandmarkTier(category: $0.category) == .landmark } == true }
            .min { $0.value.d < $1.value.d }
        guard let nearest, let p = places[nearest.key] else { return appLocalized("ios.outing.aheadNone") }
        return appLocalized(
            "ios.outing.aheadLandmark", displayName(p), formatDistance(outingQuantizedMeters(nearest.value.d)))
    }

    func displayName(_ p: SurroundingPlace) -> String {
        bilingual(p.name, roman: p.nameRoman).primary
    }

    // MARK: 좌우 문구 — 좌우는 `OutingSide`에서만 나온다(spec §14 소스 가드)

    static func passByLine(name: String, side: OutingSide) -> String {
        switch side {
        case .left: appLocalized("ios.outing.passLeft", name)
        case .right: appLocalized("ios.outing.passRight", name)
        case .unknown: appLocalized("ios.outing.passSide", name)
        }
    }

    static func overviewItemLine(name: String, side: OutingSide, meters: Int) -> String {
        let distance = formatDistance(meters)
        switch side {
        case .left: return joinText(name, appLocalized("ios.outing.itemLeft", distance))
        case .right: return joinText(name, appLocalized("ios.outing.itemRight", distance))
        case .unknown: return joinText(name, distance)
        }
    }

    // MARK: - 화면용 문장

    /// 상태 행(착지 대상, 이벤트로만 바뀐다 — spec §8.1).
    var statusLine: String {
        guard origin != nil, originLabelDone else { return appLocalized("ios.outing.originPending") }
        // 라벨이 없으면(조회 중·실패) 대체 라벨을 틀에 넣지 않는다 — "출발점 출발점"이 된다.
        guard let originLabel else { return appLocalized("ios.outing.originSet") }
        return appLocalized("ios.outing.originLabel", originLabel)
    }

    var walkedLine: String {
        guard let walkedMeters else {
            return pedometerUnavailable
                ? appLocalized("ios.outing.walkedUnavailable")
                : appLocalized("ios.outing.walked", formatDistance(0))
        }
        return appLocalized("ios.outing.walked", formatDistance(outingDisplayMeters(walkedMeters)))
    }

    /// 진행 방위 문구(방향 행 뒤 절반·조망 머리글).
    var headingLine: String {
        switch heading {
        case .none: appLocalized("ios.outing.headingUnknown")
        case .valid(let b, _): appLocalized("ios.outing.moving", compassWord(b))
        case .stale(let b): appLocalized("ios.outing.lastHeading", compassWord(b))
        }
    }

    /// 방향 행 한 줄. 방위를 한 번도 못 얻었으면 "이동 방향 확인 중" 한 줄(spec §8.1).
    var directionLine: String {
        if case .none = heading { return headingLine }
        switch surroundingsStatus {
        case .loading: return joinText(appLocalized("ios.outing.surroundingsLoading"), headingLine)
        case .failed: return joinText(appLocalized("ios.outing.surroundingsFailed"), headingLine)
        case .outOfCoverage: return joinText(appLocalized("ios.outing.outOfCoverage"), headingLine)
        case .ready:
            // 방위가 한 번도 valid가 아니었으면 앞을 판정한 적이 없다 — "이정표 없음"으로 단정하지 않는다(리뷰 m6).
            guard let aheadText else { return headingLine }
            return joinText(aheadText, headingLine)
        }
    }

    /// 띠바 요약(걸은 거리 1m 단위, E54 — 비프만 10m).
    var bandLine: String {
        if !isTracking { return appLocalized("ios.outing.ended") }
        guard let walkedMeters else { return appLocalized("ios.outing.heading") }
        return appLocalized("ios.outing.band", formatDistance(outingDisplayMeters(walkedMeters)))
    }

    private func compassWord(_ bearing: Double) -> String {
        switch Int(((bearing.truncatingRemainder(dividingBy: 360) + 360 + 22.5) / 45).rounded(.down)) % 8 {
        case 0: appLocalized("ios.outing.dir.n")
        case 1: appLocalized("ios.outing.dir.ne")
        case 2: appLocalized("ios.outing.dir.e")
        case 3: appLocalized("ios.outing.dir.se")
        case 4: appLocalized("ios.outing.dir.s")
        case 5: appLocalized("ios.outing.dir.sw")
        case 6: appLocalized("ios.outing.dir.w")
        default: appLocalized("ios.outing.dir.nw")
        }
    }

    // MARK: - 조망

    /// 조망 열기 — 현재 위치로 1회 재조회(사용자 요청이라 비용 정당, spec §8.2).
    func refreshForOverview() {
        snapshotOverview(projectingFrom: lastFix)
        guard isTracking else { return }
        overviewAwaitingCommit = true
        guard origin != nil, queryTask == nil, let fix = lastFix else { return }
        requery(at: RoutePoint(lat: fix.lat, lng: fix.lng), reason: "overview")
    }

    /// 조망 스냅샷 — 마지막 fix에서 받아 둔 장소 전부를 투영한다(지나침 판정의 `relations`는 건드리지 않는다).
    private func snapshotOverview(projectingFrom fix: (lat: Double, lng: Double, accuracy: Double)?) {
        if case .valid = heading { overviewHeadingValid = true } else { overviewHeadingValid = false }
        guard let fix else { overviewRelations = relations; return }
        var snapshot: [String: OutingRelation] = [:]
        for (id, p) in places {
            snapshot[id] = outingProject(
                fixLat: fix.lat, fixLng: fix.lng, accuracy: fix.accuracy,
                heading: heading, placeLat: p.lat, placeLng: p.lng)
        }
        overviewRelations = snapshot
    }

    func place(id: String) -> SurroundingPlace? { places[id] }

    // MARK: - 무-fix 감시·안전망

    private func startWatchdog() {
        watchdog?.cancel()
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                guard let self else { return }
                guard self.isTracking else { continue }
                self.tickWatchdog()
            }
        }
    }

    private func tickWatchdog() {
        let now = uptimeNow
        guard let startedAt else { return }
        let fixRef = max(startedAt, lastFixAt ?? startedAt)
        if now - fixRef >= noFixSeconds { routeUnreliableTone(now: now) }
        if origin == nil { decideOrigin(fix: nil, now: now) }
        refreshPedometerAvailability()
        if now >= protectedUntil, let low = deferredLow {
            deferredLow = nil
            say(low, speechClass: .actionable)
        }
        // 국면 무관 안전망(spec §5.3·§9). 나들이엔 도착 창이 없으므로 두 축 모두 산다.
        let progressRef = max(startedAt, sessionLastProgressAt ?? startedAt)
        if let reason = sessionIdleStep(secondsSinceUsableFix: now - fixRef, secondsSinceProgress: now - progressRef) {
            endIdle(reason: reason)
            return
        }
        // 약신호 통지(도보 안내 동형) — 상태 통지는 전경 VoiceOver 창구로만(spec §13). 기기 음성으로 30초마다
        // "신호 약함"을 말하지 않는다.
        if now - fixRef >= noFixTimeout, isForeground, UIAccessibility.isVoiceOverRunning {
            if let last = lastStaleNoticeAt, now - last < staleRenotifyInterval { return }
            lastStaleNoticeAt = now
            announcer.announce(appLocalized("beacon.weak"), speechClass: .deferrable)
        }
    }

    private func routeUnreliableTone(now: Double) {
        let out = toneLayerStep(state: toneState, input: ToneLayerInput(unreliable: true), now: now)
        toneState = out.state
        if let tone = out.tone { playTone(tone) }
    }

    // MARK: - 권한·오류

    private func handle(locationError code: CLError.Code) {
        guard code == .denied else { return }
        endOnFailure("beacon.denied")
    }

    private func handle(authorization status: CLAuthorizationStatus) {
        switch status {
        case .denied, .restricted: endOnFailure("beacon.denied")
        default: break
        }
    }

    private func handle(accuracy: CLAccuracyAuthorization) {
        if accuracy == .reducedAccuracy { endOnFailure("beacon.reduced") }
    }

    private func endOnFailure(_ key: String) {
        guard isTracking else { return }
        let text = appLocalized(key)
        endLeavingScreen(reason: text, playStopTone: false)
        sayEnd(text, speechClass: .actionable)
    }

    // MARK: - 출력

    private func playTone(_ tone: BeaconTone) {
        guard !outputSuppressed else { return }
        tones.play(tone)
        // 가청 상태는 세션 중에도 바뀐다 — 톤마다 다시 판정한다(도보 `playTone` 동형, 구현 검증 N4). 시작 뒤의
        // "들림 → 안 들림" 전이만 알린다(시작 때는 시작 문장이 함께 말한다).
        let degraded = isTracking && !tones.isBackgroundAudible
        if degraded != soundDegraded {
            soundDegraded = degraded
            if degraded, startAnnounced {
                ResultHaptic.fire(.attention)
                say(appLocalized("ios.beacon.soundBackgroundUnavailable"), speechClass: .actionable)
            }
        }
        // 재생 수단이 죽었으면 침묵의 원인을 알린다(도보 안내와 같은 문장·같은 진입 1회 진동).
        if tones.isSilenced {
            guard !silencedNoticed else { return }
            silencedNoticed = true
            ResultHaptic.fire(.failure)
            say(appLocalized("ios.beacon.soundUnavailable"), speechClass: .actionable)
        } else {
            silencedNoticed = false
        }
    }

    /// 문장 창구 — 톤 뒤 지연(`DeferredAnnouncer`)을 지나 `post`에서 채널이 갈린다. `speechClass`는 기본값 없는 필수
    /// 인자다(E53 spec §3.4 — 나들이의 주변 문장은 본 기능이라 행동 문장, 안전망 종료만 미룸).
    private func say(
        _ text: String, highPriority: Bool = false, speechClass: GuideSpeechClass,
        onDropped: (() -> Void)? = nil
    ) {
        announcer.announce(text, highPriority: highPriority, speechClass: speechClass, onDropped: onDropped)
    }

    /// 종료 문장 — 전하지 못하면(백그라운드 버림·대기 칸에서 사라짐) 장부에 남겨 복귀 때 갚는다(설계 리뷰 M6).
    private func sayEnd(_ text: String, speechClass: GuideSpeechClass) {
        say(text, highPriority: true, speechClass: speechClass) { [weak self] in
            self?.owedEndReason = (text, .now)
        }
    }

    /// 안전 문장(시작·횡단보도) — 나간 뒤 보호 창 동안 주변 문장을 미룬다.
    private func sayProtected(_ text: String) {
        protectedUntil = uptimeNow + protectSeconds
        protectedText = text
        say(text, speechClass: .actionable)
    }

    /// 주변 문장(지나침·도로명·출발점) — 보호 창 안이면 한 칸에 미뤄 두고(최신이 이긴다) 워치독 틱이 낸다.
    private func sayLow(_ text: String) {
        guard uptimeNow >= protectedUntil else {
            deferredLow = text
            return
        }
        deferredLow = nil  // 미뤄 둔 옛 문장보다 지금 문장이 이긴다 — 다음 틱에 옛 문장이 뒤늦게 나오지 않게(구현 검증 N8)
        say(text, speechClass: .actionable)
    }

    /// 실제 게시. 채널은 게시 시점에 하나만(spec §7.3, E53 spec §2): 전경 ∧ VoiceOver면 VoiceOver 통지, 전경 ∧
    /// VoiceOver 꺼짐은 기기 음성, 백그라운드는 토글 켬 ∧ 행동 문장이면 기기 음성이고 그 밖은 버린다(판정 ② — 끄면
    /// 화면이 꺼진 동안은 효과음만).
    @discardableResult
    private func post(
        _ message: String, highPriority: Bool, bypassSuppression: Bool,
        speechClass: GuideSpeechClass, onLateDrop: (() -> Void)?
    ) -> Bool {
        guard bypassSuppression || !outputSuppressed else { return false }
        let channel = GuideSpeechOutput.channel(
            speechClass, foregroundDeviceSpeech: true, backgroundAudible: tones.isBackgroundAudible)
        // `channel=`의 값은 종전 로그와 같은 소문자(voiceover·device) + E53의 drop. `fg=`·`class=`는 E53 판독용 —
        // 종전 로그는 기기 음성이 잠금 때문인지 VoiceOver가 꺼져서인지 가르지 못했다(로그 색인 09-30 행).
        guideDiagLog(
            "outingSpeak channel=\(channel == .voiceOver ? "voiceover" : channel.rawValue) "
                + "fg=\(GuideSpeechOutput.isForeground ? 1 : 0) class=\(speechClass.rawValue) text=\(message)")
        switch channel {
        case .voiceOver:
            GuideSpeechOutput.postVoiceOver(spokenUnits(message), highPriority: highPriority)
            return true
        case .device:
            // 보호 문장(시작·횡단보도)은 유효 시간으로 버리지 않고 주변 문장에 밀리지 않는다(구현 검증 N6·보호 창).
            // 종료·거절(.high)은 대기하지 않고 선점한다(설계 리뷰 M2).
            deviceSpeech.submit(
                spokenUnits(message), highPriority: highPriority, protected: message == protectedText,
                bypassSuppression: bypassSuppression, speechClass: speechClass,
                onDropped: { _ in onLateDrop?() })
            return true
        case .drop:
            return false
        }
    }
}

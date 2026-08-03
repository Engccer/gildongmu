import Foundation
import GildongmuKit
import Observation
import SwiftUI

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
    /// 대기 목록 스냅숏(§5.1): 현재 폴 항목 + 소실 항목(3분 유지, 관측 경과 분).
    private(set) var waitingLive: [TransitTrackItem] = []
    private(set) var waitingDeparted: [(item: TransitTrackItem, minutes: Int)] = []

    var isTracking: Bool { state != nil }
    var currentLeg: TransitGuideLeg? {
        guard let state, let route else { return nil }
        return route.legs.indices.contains(state.legIndex) ? route.legs[state.legIndex] : nil
    }

    private let trackService = TransitTrackService(client: APIClient(baseURL: AppConfig.apiBaseURL))
    private let tones = BeaconTonePlayer()
    private var sessionToken: Int?
    private var pollTask: Task<Void, Never>?
    private var seq = 0
    private var retained: [String: (item: TransitTrackItem, lastSeenAt: Date)] = [:]
    private var tagoResolved: [Int: TransitTrackResolvedStop] = [:]
    private var tagoUnsupported: Set<Int> = []
    /// 백그라운드 일시정지 표식 — 복귀 통지 분기(§3.2).
    private var pausedInBackground = false

    private static let retainSeconds: TimeInterval = 180

    // MARK: - 세션 수명

    func start(transitRoute: TransitRoute, destinationLabel: String) {
        guard let guideRoute = buildTransitGuideRoute(transitRoute) else { return }
        sessionToken = GuideSessionCoordinator.shared.claim { [weak self] in self?.stop() }
        self.route = guideRoute
        self.destinationLabel = destinationLabel
        seq = 0
        retained = [:]
        tagoResolved = [:]
        tagoUnsupported = []
        state = initTransitGuide(route: guideRoute, now: nowMs())
        UIApplication.shared.isIdleTimerDisabled = true
        tones.play(.start)
        let first = guideRoute.legs[0]
        var parts = [
            appLocalized("transitGuide.started", String(guideRoute.legs.count)),
            waitContextText(first),
        ]
        if first.trackMode == nil { parts.append(appLocalized("transitGuide.untrackable")) }
        announce(parts.joined(separator: " "))
        restartPollLoop(immediate: true)
    }

    func stop(playStopTone: Bool = false) {
        if let token = sessionToken {
            sessionToken = nil
            GuideSessionCoordinator.shared.release(token)
        }
        pollTask?.cancel()
        pollTask = nil
        UIApplication.shared.isIdleTimerDisabled = false
        if playStopTone, state != nil { tones.play(.stop) }
        state = nil
        route = nil
        waitingLive = []
        waitingDeparted = []
        retained = [:]
        tagoResolved = [:]
        tagoUnsupported = []
        pausedInBackground = false
    }

    /// 목적지 변경으로 세션 채널이 무의미해지는 전이(§3.3 — 명시 중지 + 통지).
    func stopBecauseDestinationChanged() {
        guard isTracking else { return }
        stop()
        announce(appLocalized("ios.beacon.stopped"))
    }

    func teardown() {
        stop()
        tones.shutdown()
    }

    func handleScenePhaseChange(to phase: ScenePhase) {
        guard isTracking else { return }
        switch phase {
        case .background, .inactive:
            // 전경 전용(§3.2): 폴만 정지, 세션은 유지. 들리지 않는 채널에 통지를 쌓지 않는다.
            pollTask?.cancel()
            pollTask = nil
            pausedInBackground = true
        case .active:
            guard pausedInBackground else { return }
            pausedInBackground = false
            announce(appLocalized("transitGuide.signalRecovered"))
            restartPollLoop(immediate: true)
        @unknown default:
            break
        }
    }

    // MARK: - 사용자 액션

    func board(item: TransitTrackItem) {
        guard let leg = currentLeg, let trackMode = leg.trackMode else { return }
        let lock = TransitLock(
            mode: trackMode,
            routeId: leg.routeId ?? subwayIdForOdsayLine(leg.lineName) ?? "",
            direction: item.direction,
            vehicleId: item.vehicleId ?? ""
        )
        dispatch(.board(lock))
        restartPollLoop(immediate: true)
    }

    func boardApprox() {
        guard let leg = currentLeg, leg.trackMode == .tagoBus else { return }
        dispatch(.board(TransitLock(mode: .tagoBus, routeId: leg.lineName, direction: "", vehicleId: "")))
        restartPollLoop(immediate: true)
    }

    func advance() {
        dispatch(.advance)
        if state?.phase == .done {
            // 완료 통지는 legAdvanced 이벤트가 이미 냈다 — 자원만 회수(시트 닫힘).
            stop()
        } else {
            waitingLive = []
            waitingDeparted = []
            retained = [:]
            restartPollLoop(immediate: true)
        }
    }

    func changeBoarding() {
        dispatch(.changeBoarding)
        waitingLive = []
        waitingDeparted = []
        retained = [:]
        restartPollLoop(immediate: true)
    }

    /// 진행 상황 버튼(§6.1) — 임의 시점 조회. 버튼 활성화의 직접 응답이라 .high.
    func announceProgress() {
        guard let state, let leg = currentLeg else { return }
        var parts = [contextText(leg)]
        parts.append(signalStatusText(state.signal))
        if let remaining = state.remaining {
            parts.append(appLocalized("transitGuide.remainingCount", String(remaining)))
        } else if let count = leg.stationCount, state.phase == .riding {
            parts.append(appLocalized("transitGuide.stationCountAbout", String(count)))
        }
        if let message = state.lastMessage, !message.isEmpty { parts.append(message) }
        if leg.trackMode == .tagoBus { parts.append(appLocalized("transitGuide.approxNote")) }
        announce(parts.joined(separator: " "), highPriority: true)
    }

    // MARK: - 폴링 루프

    private func restartPollLoop(immediate: Bool) {
        pollTask?.cancel()
        guard let state else { return }
        let interval = transitPollIntervalMs(state)
        if !immediate, interval <= 0 { return }
        pollTask = Task { [weak self] in
            if !immediate {
                try? await Task.sleep(for: .milliseconds(interval))
            }
            while !Task.isCancelled {
                guard let self else { return }
                await self.pollOnce()
                guard let s = self.state, !Task.isCancelled else { return }
                let next = transitPollIntervalMs(s)
                if next <= 0 { return }
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
        let poll = await fetchPoll(leg: leg, phase: state.phase)
        guard !Task.isCancelled else { return }
        // 대기 목록 스냅숏(§5.1) — 소실 유지·경과 계산은 폴 시점에.
        if self.state?.phase == .waiting, self.state?.phaseGen == phaseGen {
            updateWaitingSnapshot(poll: poll)
        }
        dispatch(.poll(seq: mySeq, phaseGen: phaseGen, poll: poll))
    }

    private func fetchPoll(leg: TransitGuideLeg, phase: TransitPhase) async -> TransitTrackPoll {
        do {
            switch leg.trackMode {
            case .seoulBus:
                if phase == .waiting {
                    guard let arsId = leg.boardStop?.arsId, let routeId = leg.routeId else {
                        return .unsupported
                    }
                    return TransitTrackService.poll(
                        from: try await trackService.seoulWait(arsId: arsId, routeId: routeId))
                }
                guard let boardId = leg.boardStop?.localId,
                      let alightId = leg.alightStop?.localId,
                      let routeId = leg.routeId
                else { return .unsupported }
                return TransitTrackService.poll(
                    from: try await trackService.seoulRide(
                        routeId: routeId, boardId: boardId, alightId: alightId))
            case .tagoBus:
                guard let resolved = await resolveTagoIfNeeded(leg: leg, phase: phase) else {
                    guard let state else { return .failed }
                    return tagoUnsupported.contains(state.legIndex) ? .unsupported : .failed
                }
                return TransitTrackService.poll(
                    from: try await trackService.tagoTrack(
                        cityCode: resolved.cityCode, nodeId: resolved.nodeId, routeNo: leg.lineName))
            case .subway:
                let station = phase == .waiting ? leg.boardName : leg.alightName
                guard !station.isEmpty else { return .unsupported }
                return TransitTrackService.poll(
                    from: try await trackService.subwayTrack(station: station, line: leg.lineName))
            case nil:
                return .unsupported
            }
        } catch {
            return .failed
        }
    }

    /// 지방버스 정류소 해석(세션·leg당 1회, §5.2). 모호·부재는 unsupported 캐시.
    private func resolveTagoIfNeeded(
        leg: TransitGuideLeg, phase: TransitPhase
    ) async -> TransitTrackResolvedStop? {
        guard let legIndex = state?.legIndex else { return nil }
        if tagoUnsupported.contains(legIndex) { return nil }
        if let cached = tagoResolved[legIndex] { return cached }
        let target = phase == .waiting ? leg.boardStop : leg.alightStop
        guard let target else { return nil }
        do {
            let envelope = try await trackService.resolveTagoStop(lat: target.lat, lng: target.lng)
            if envelope.status == "ok", let stop = envelope.stop {
                tagoResolved[legIndex] = stop
                return stop
            }
            tagoUnsupported.insert(legIndex)
            return nil
        } catch {
            return nil // 일시 실패 — 캐시하지 않고 다음 폴에서 재시도
        }
    }

    private func updateWaitingSnapshot(poll: TransitTrackPoll) {
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
        let result = transitGuideStep(state: state, input: input, route: route, now: nowMs())
        self.state = result.state
        if let event = result.event { handle(event: event) }
    }

    private func handle(event: TransitGuideEvent) {
        let profile = transitEventProfile(event)
        switch profile.tone {
        case .start: tones.play(.start)
        case .ladder: tones.play(.closer)
        case .imminent: tones.play(.ahead)
        case .arrive: tones.play(.nearby)
        case .weak: tones.play(.warning)
        case nil: break
        }
        let text = announcementText(for: event)
        if !text.isEmpty { announce(text, highPriority: profile.interrupt) }
    }

    private func announcementText(for event: TransitGuideEvent) -> String {
        let leg = currentLeg
        var parts: [String] = []
        switch event {
        case .boarded:
            if let leg {
                if let count = leg.stationCount {
                    parts.append(appLocalized(
                        "transitGuide.boardedCount", leg.lineName, leg.alightName, String(count)))
                } else {
                    parts.append(appLocalized("transitGuide.boarded", leg.lineName, leg.alightName))
                }
            }
        case let .trackingStarted(message, remaining):
            if let leg { parts.append(contextText(leg)) }
            parts.append(appLocalized("transitGuide.trackingStarted"))
            if !message.isEmpty {
                parts.append(message)
            } else if let remaining {
                parts.append(appLocalized("transitGuide.remainingCount", String(remaining)))
            }
        case let .countdown(remaining, message):
            if let leg { parts.append(contextText(leg)) }
            parts.append(
                message.isEmpty
                    ? appLocalized("transitGuide.remainingCount", String(remaining)) : message)
        case let .messageChanged(message):
            if let leg { parts.append(contextText(leg)) }
            parts.append(message)
        case let .arrived(certain):
            parts.append(appLocalized(certain ? "transitGuide.arrived" : "transitGuide.arrivedGuess"))
            if let state, let route {
                let nextIndex = state.legIndex + 1
                if route.legs.indices.contains(nextIndex) {
                    parts.append(appLocalized(
                        "transitGuide.nextLeg", waitContextText(route.legs[nextIndex])))
                } else if let walk = route.walkAfterMinutes {
                    parts.append(appLocalized(
                        "transitGuide.nextLeg", appLocalized("transitGuide.doneWalk", String(walk))))
                }
            }
        case let .backOnTrack(message):
            parts.append(appLocalized("transitGuide.backOnTrack"))
            if !message.isEmpty { parts.append(message) }
        case .approxVehicleChanged:
            parts.append(appLocalized("transitGuide.approxVehicleChanged"))
        case .signalLost:
            parts.append(appLocalized("transitGuide.signalLost"))
        case .upstreamFailed:
            parts.append(appLocalized("transitGuide.upstreamFailed"))
        case .signalRecovered:
            parts.append(appLocalized("transitGuide.signalRecovered"))
        case .capSlowed:
            parts.append(appLocalized("transitGuide.capSlowed"))
        case let .legAdvanced(legIndex, final):
            if final {
                if let walk = route?.walkAfterMinutes {
                    parts.append(appLocalized("transitGuide.doneWalk", String(walk)))
                } else {
                    parts.append(appLocalized("transitGuide.done"))
                }
            } else if let route, route.legs.indices.contains(legIndex) {
                let next = route.legs[legIndex]
                parts.append(waitContextText(next))
                if next.trackMode == nil { parts.append(appLocalized("transitGuide.untrackable")) }
            }
        case .boardingReset:
            parts.append(appLocalized("transitGuide.changeBoardingDone"))
        }
        return parts.joined(separator: " ")
    }

    /// 사다리·문장 통지의 고정 문맥(§6.1 독립 문장 병치 — 문법 결합 금지).
    func contextText(_ leg: TransitGuideLeg) -> String {
        appLocalized("transitGuide.context", leg.lineName, leg.alightName)
    }

    /// 대기 문맥(§4.1): 선행 도보 + 승차 지점 + 노선.
    func waitContextText(_ leg: TransitGuideLeg) -> String {
        if let walk = leg.walkBeforeMinutes, walk > 0 {
            return appLocalized("transitGuide.waitContextWalk", String(walk), leg.boardName, leg.lineName)
        }
        return appLocalized("transitGuide.waitContext", leg.boardName, leg.lineName)
    }

    func signalStatusText(_ signal: TransitSignal) -> String {
        switch signal {
        case .tracking: appLocalized("transitGuide.stateTracking")
        case .notYetVisible: appLocalized("transitGuide.stateNotYetVisible")
        case .signalLost: appLocalized("transitGuide.stateSignalLost")
        case .upstreamFailed: appLocalized("transitGuide.stateUpstreamFailed")
        case .untrackable: appLocalized("transitGuide.stateUntrackable")
        }
    }

    private func nowMs() -> Double {
        Date().timeIntervalSince1970 * 1000
    }

    /// 통지 단일 경로. 하차 임박·도착·직접 응답만 .high(§6.1 — 헌장 §5 계열).
    private func announce(_ message: String, highPriority: Bool = false) {
        var attributed = AttributedString(spokenUnits(message))
        if highPriority { attributed.accessibilitySpeechAnnouncementPriority = .high }
        AccessibilityNotification.Announcement(attributed).post()
    }
}

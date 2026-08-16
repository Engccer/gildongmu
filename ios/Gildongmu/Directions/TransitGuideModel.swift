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
    // ⚠ 키는 (legIndex, 대상 정류소) 복합 — legIndex만 쓰면 waiting에서 해석한
    // 승차 정류소가 riding 캐시로 적중해 하차 카운트다운이 승차 정류소 도착을
    // 읽는다(독립 리뷰 BLOCKER).
    private var tagoResolved: [String: TransitTrackResolvedStop] = [:]
    private var tagoUnsupported: Set<String> = []
    /// 백그라운드 일시정지 표식 — 복귀 통지 분기(§3.2).
    private var pausedInBackground = false
    /// 다음 대기 폴 결과를 직접 응답으로 통지(새로고침, §13.2) — 폴 1회 소비.
    private var refreshAnnounce = false
    /// 목적지 전환 조회의 latest-wins 토큰(스펙 §4.1) — 취소·재시도가 늦은 응답을 폐기.
    private var destChangeToken = 0
    /// 검색 시트가 열린 동안 통지·톤 억제(스펙 §5.4, BeaconModel 동형 — 받아쓰기
    /// 전사 오염 방지). stop()이 무조건 해제한다(잔류 억제로 다음 세션 무음 방지).
    var outputSuppressed = false {
        didSet { tones.isSuppressed = outputSuppressed }
    }
    private let routeService = RouteService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    private static let retainSeconds: TimeInterval = 180
    /// stale 후보 문턱(스펙 §4.2, 잠정값 — 실사용 판정 대상): 조회 시점 위치의
    /// 스냅샷인 후보를 이동 후에도 확정하는 경로를 막는다.
    private static let destChangeStaleSeconds: TimeInterval = 120

    // MARK: - 세션 수명

    func start(transitRoute: TransitRoute, destinationLabel: String) {
        guard let guideRoute = buildTransitGuideRoute(transitRoute) else { return }
        pendingWalkHandoff = nil
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
        waitingReason = nil
        retained = [:]
        tagoResolved = [:]
        tagoUnsupported = []
        pausedInBackground = false
        refreshAnnounce = false
        pendingWalkHandoff = nil
        // 목적지 전환 준비·억제도 세션과 함께 소거(스펙 §5.4 — 잔류 억제 금지).
        destChangeToken += 1
        pendingDestChange = nil
        outputSuppressed = false
    }

    /// 핸드오프 제안 소거(§14.2) — 시트 닫기·수락 시 호출(세션은 이미 종료 상태).
    func clearWalkHandoff() {
        pendingWalkHandoff = nil
    }

    /// 목적지 변경으로 세션 채널이 무의미해지는 전이(§3.3 — 명시 중지 + 통지).
    func stopBecauseDestinationChanged() {
        pendingWalkHandoff = nil // 옛 목적지의 핸드오프 제안도 함께 무효(무통지 소거)
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
            // 재개 통지는 확인되지 않은 "회복" 주장이 아니라 실제 상태를 말한다
            // (§3.2 "안내 재개. {현재 상태}" — 3-state 정직, 독립 리뷰 MAJOR).
            var parts = [appLocalized("transitGuide.resumed")]
            if let s = state { parts.append(signalStatusText(s.signal, phase: s.phase)) }
            announce(parts.joined(separator: " "))
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
            // 완료 통지는 legAdvanced 이벤트가 이미 냈다 — 자원만 회수한다.
            // 말미 도보가 있으면 핸드오프 제안(§14.2)을 stop() **뒤에** 남긴다
            // (stop()이 pendingWalkHandoff까지 nil로 지우는 단일 소거 경로라 순서 필수).
            let handoff = route?.walkAfterMinutes.map {
                TransitWalkHandoff(destinationLabel: destinationLabel, walkMinutes: $0)
            }
            stop()
            pendingWalkHandoff = handoff
        } else {
            waitingLive = []
            waitingDeparted = []
            waitingReason = nil
            retained = [:]
            restartPollLoop(immediate: true)
        }
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

    /// 탑승 변경 취소(§13.1) — 직전 잠금으로 재탑승(머신이 previousLock을 소유).
    func cancelChangeBoarding() {
        guard let lock = state?.previousLock else { return }
        dispatch(.board(lock))
        restartPollLoop(immediate: true)
    }

    /// "이미 탑승했습니다"(§13.2) — 식별자 없는 근사 잠금(tagoBus 계약 동형).
    func boardAlready() {
        guard let leg = currentLeg, let trackMode = leg.trackMode, trackMode != .tagoBus else {
            return
        }
        let direction = leg.wayCode == 1 ? "상행" : leg.wayCode == 2 ? "하행" : ""
        dispatch(.board(TransitLock(
            mode: trackMode,
            routeId: leg.routeId ?? subwayIdForOdsayLine(leg.lineName) ?? "",
            direction: direction,
            vehicleId: ""
        )))
        restartPollLoop(immediate: true)
    }

    /// 새로고침(§13.2) — 즉폴 + 결과를 직접 응답으로 통지(자동 폴 무낭독의 예외).
    func refreshWaiting() {
        guard state?.phase == .waiting else { return }
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
            // includeStops: 안내용 승차·하차 정류소 데이터원(§4.1 — 브리핑 조회 동형).
            let result = try await routeService.transit(
                originLat: origin.lat, originLng: origin.lng,
                destLat: pending.dest.lat, destLng: pending.dest.lng,
                includeStops: true)
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
            announce(appLocalized("ios.transitGuide.destChangeRefetched"), highPriority: true)
            Task { await fetchDestChangeCandidates(token: token) }
            return false
        }
        guard changeRoute(transitRoute: route, destinationLabel: pending.label) else { return false }
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
    private func changeRoute(transitRoute: TransitRoute, destinationLabel: String) -> Bool {
        guard let guideRoute = buildTransitGuideRoute(transitRoute) else { return false }
        pollTask?.cancel()
        pollTask = nil
        pendingWalkHandoff = nil  // 옛 목적지의 핸드오프 제안 무효
        self.route = guideRoute
        self.destinationLabel = destinationLabel
        seq = 0
        retained = [:]
        tagoResolved = [:]
        tagoUnsupported = []
        waitingLive = []
        waitingDeparted = []
        waitingReason = nil
        refreshAnnounce = false
        state = initTransitGuide(route: guideRoute, now: nowMs())
        let first = guideRoute.legs[0]
        var parts = [
            appLocalized("ios.guide.destChanged", destinationLabel),
            appLocalized("transitGuide.started", String(guideRoute.legs.count)),
            waitContextText(first),
        ]
        if first.trackMode == nil { parts.append(appLocalized("transitGuide.untrackable")) }
        // 활성화 응답(후보 버튼이 사라지는 전이) — .high(헌장 §6).
        announce(parts.joined(separator: " "), highPriority: true)
        restartPollLoop(immediate: true)
        return true
    }

    /// 진행 상황 버튼(§6.1) — 임의 시점 조회. 버튼 활성화의 직접 응답이라 .high.
    /// 상시 표시와 같은 조립기를 공유한다(§12.3 드리프트 차단).
    func announceProgress() {
        guard let state, let leg = currentLeg else { return }
        announce(statusLineText(state: state, leg: leg), highPriority: true)
    }

    /// 상시 표시·진행 상황 공용 조립기(§12.3) — 완성 문장 파트를 공백으로 연결하는
    /// 단일 헬퍼. 종전엔 시트가 쉼표 조립(joinText)을 따로 해 "기준., " 이중
    /// 구두점과 stationCountAbout·lastUpdated 누락 드리프트가 났었다(피드백 #9).
    func statusLineText(state: TransitGuideState, leg: TransitGuideLeg) -> String {
        var parts = [
            state.phase == .waiting ? waitContextText(leg) : contextText(leg),
            signalStatusText(state.signal, phase: state.phase),
        ]
        if let remaining = state.remaining {
            parts.append(appLocalized("transitGuide.remainingCount", String(remaining)))
        } else if let count = leg.stationCount, state.phase == .riding {
            parts.append(appLocalized("transitGuide.stationCountAbout", String(count)))
        }
        if let message = state.lastMessage, !message.isEmpty {
            parts.append(frameText(leg, message))
        }
        // 근사 주석의 판별자는 leg 유형이 아니라 잠금의 근사 여부(§13.2 — tagoBus는
        // 대기 중에도 근사 예고로 유지).
        if leg.trackMode == .tagoBus || (state.lock.map(isApproxTransitLock) ?? false) {
            parts.append(appLocalized("transitGuide.approxNote"))
        }
        // 신선도 문장은 정확히 1개(§12.3, 감사 H2·M1): 추적 중이면 데이터 나이,
        // 그 외엔 마지막 폴 시각만 — 낡은 나이를 신선한 값처럼 이월하지 않는다.
        if state.signal == .tracking, let age = state.dataAgeSeconds {
            parts.append(appLocalized("transitGuide.dataAge", String(age)))
        } else if let updatedAt = state.lastUpdatedAt {
            parts.append(appLocalized("transitGuide.lastUpdated", Self.timeText(updatedAt)))
        }
        return parts.joined(separator: " ")
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
        let (poll, rawCount) = await fetchPoll(leg: leg, phase: state.phase)
        guard !Task.isCancelled else { return }
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
                    waitingLive + waitingDeparted.map(\.item), leg: leg
                ).candidates
                refreshResponse = waitingReason == .unavailable
                    ? reasonText(.unavailable)
                    : appLocalized("transitGuide.waitingCount", String(candidates.count))
            }
        }
        refreshAnnounce = false
        dispatch(.poll(seq: mySeq, phaseGen: phaseGen, poll: poll))
        // 응답은 dispatch 뒤에 .high로 게시한다 — 같은 폴의 신호 이벤트 통지가
        // 먼저 나가고 .high가 큐를 끊어 응답이 최종 승자가 된다(감사 M1: 역순이면
        // 동어반복 두 문장이 연달아 나가거나 응답이 잠식된다).
        if let refreshResponse { announce(refreshResponse, highPriority: true) }
    }

    private func fetchPoll(
        leg: TransitGuideLeg, phase: TransitPhase
    ) async -> (poll: TransitTrackPoll, rawCount: Int?) {
        do {
            switch leg.trackMode {
            case .seoulBus:
                if phase == .waiting {
                    guard let arsId = leg.boardStop?.arsId, let routeId = leg.routeId else {
                        return (.unsupported, nil)
                    }
                    let env = try await trackService.seoulWait(arsId: arsId, routeId: routeId)
                    return (TransitTrackService.poll(from: env), env.rawCount)
                }
                guard let boardId = leg.boardStop?.localId,
                      let alightId = leg.alightStop?.localId,
                      let routeId = leg.routeId
                else { return (.unsupported, nil) }
                let env = try await trackService.seoulRide(
                    routeId: routeId, boardId: boardId, alightId: alightId)
                return (TransitTrackService.poll(from: env), env.rawCount)
            case .tagoBus:
                guard let resolved = await resolveTagoIfNeeded(leg: leg, phase: phase) else {
                    guard let state else { return (.failed, nil) }
                    let unsupported = tagoUnsupported.contains(
                        tagoCacheKey(state.legIndex, phase: phase))
                    return (unsupported ? .unsupported : .failed, nil)
                }
                let env = try await trackService.tagoTrack(
                    cityCode: resolved.cityCode, nodeId: resolved.nodeId, routeNo: leg.lineName)
                return (TransitTrackService.poll(from: env), env.rawCount)
            case .subway:
                let station = phase == .waiting ? leg.boardName : leg.alightName
                guard !station.isEmpty else { return (.unsupported, nil) }
                let env = try await trackService.subwayTrack(station: station, line: leg.lineName)
                return (TransitTrackService.poll(from: env), env.rawCount)
            case nil:
                return (.unsupported, nil)
            }
        } catch {
            return (.failed, nil)
        }
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
            let terminates = classified.candidates.count(where: \.terminatesEarly)
            return "waitPoll seq=\(seq) status=\(status) raw=\(rawCount.map(String.init) ?? "-")"
                + " live=\(waitingLive.count) departed=\(waitingDeparted.count)"
                + " candidates=\(classified.candidates.count) vehIdless=\(vehIdless)"
                + " terminates=\(terminates)"
                + " directionUncertain=\(classified.directionUncertain)"
                + " reason=\(waitingReason?.rawValue ?? "-")"
        }())
    }

    /// 지방버스 정류소 해석(세션·leg당 1회, §5.2). 모호·부재는 unsupported 캐시.
    private func tagoCacheKey(_ legIndex: Int, phase: TransitPhase) -> String {
        "\(legIndex):\(phase == .waiting ? "board" : "alight")"
    }

    private func resolveTagoIfNeeded(
        leg: TransitGuideLeg, phase: TransitPhase
    ) async -> TransitTrackResolvedStop? {
        guard let legIndex = state?.legIndex else { return nil }
        let key = tagoCacheKey(legIndex, phase: phase)
        if tagoUnsupported.contains(key) { return nil }
        if let cached = tagoResolved[key] { return cached }
        let target = phase == .waiting ? leg.boardStop : leg.alightStop
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
        let result = transitGuideStep(state: state, input: input, route: route, now: nowMs())
        self.state = result.state
        // 계측(§13.5): 국면·신호 전이와 이벤트만 기록(무이벤트 폴 소음 제외).
        if result.event != nil || result.state.phase != state.phase
            || result.state.signal != state.signal {
            transitGuideLog(
                "step phase=\(state.phase.rawValue)→\(result.state.phase.rawValue)"
                    + " signal=\(state.signal.rawValue)→\(result.state.signal.rawValue)"
                    + " event=\(result.event.map { String(describing: $0) } ?? "-")")
        }
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
                parts.append(leg.map { frameText($0, message) } ?? message)
            } else if let remaining {
                parts.append(appLocalized("transitGuide.remainingCount", String(remaining)))
            }
        case let .countdown(remaining, message, currentLocation):
            // §12.3: 매 사다리마다 문맥 문장을 반복하지 않는다 — 프레임이 하차역을 밝힌다.
            if !message.isEmpty {
                parts.append(leg.map { frameText($0, message) } ?? message)
            } else {
                parts.append(appLocalized("transitGuide.remainingCount", String(remaining)))
            }
            // 한 정거장 전 현재 역 병치(§12.2, 피드백 #10) — 잔여 ≥ 2 문장은 원문이
            // 현재 역을 이미 담아 병치하지 않는다(중복 금지).
            if remaining <= 1, let currentLocation, !currentLocation.isEmpty {
                parts.append(appLocalized("transitGuide.currentStation", currentLocation))
            }
        case let .messageChanged(message):
            parts.append(leg.map { frameText($0, message) } ?? message)
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
            if !message.isEmpty { parts.append(leg.map { frameText($0, message) } ?? message) }
        case .approxVehicleChanged:
            parts.append(appLocalized("transitGuide.approxVehicleChanged"))
        case .signalLost:
            parts.append(appLocalized("transitGuide.signalLost"))
        case .neverSeen:
            // 기본 우선순위로 둔다(A16 §3.4): 자기 소멸 버튼이 없고 포커스 이동을
            // 유발하지 않아 잠식 패턴에 해당하지 않는다.
            parts.append(appLocalized("transitGuide.neverSeen"))
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

    /// 노선·하차 전문 문맥(§6.1 M1 개정) — 추적 시작·진행 상황·상시 표시가 담당.
    func contextText(_ leg: TransitGuideLeg) -> String {
        appLocalized("transitGuide.context", leg.lineName, leg.alightName)
    }

    /// upstream 완성 문장의 라벨 프레임(§12.3) — 원문 무변형, 하차역 라벨 전치.
    func frameText(_ leg: TransitGuideLeg, _ message: String) -> String {
        appLocalized("transitGuide.messageFrame", leg.alightName, message)
    }

    /// 대기 문맥(§4.1): 선행 도보 + 승차 지점 + 노선.
    func waitContextText(_ leg: TransitGuideLeg) -> String {
        if let walk = leg.walkBeforeMinutes, walk > 0 {
            return appLocalized("transitGuide.waitContextWalk", String(walk), leg.boardName, leg.lineName)
        }
        return appLocalized("transitGuide.waitContext", leg.boardName, leg.lineName)
    }

    /// 신호 → 상시 표시 문구. ⚠ notYetVisible은 국면으로 갈린다 — "차량 접근 대기"는
    /// 대기 국면 어휘라 승차 중에 뜨면 "아직 못 탔다"로 뒤집혀 읽힌다(A16).
    func signalStatusText(_ signal: TransitSignal, phase: TransitPhase) -> String {
        switch signal {
        case .tracking: appLocalized("transitGuide.stateTracking")
        case .notYetVisible:
            phase == .riding
                ? appLocalized("transitGuide.stateRidingNotYetVisible")
                : appLocalized("transitGuide.stateNotYetVisible")
        case .neverSeen: appLocalized("transitGuide.stateNeverSeen")
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
        // 검색 시트(받아쓰기 마이크)가 열린 동안은 발화 0(스펙 §5.4).
        guard !outputSuppressed else { return }
        var attributed = AttributedString(spokenUnits(message))
        if highPriority { attributed.accessibilitySpeechAnnouncementPriority = .high }
        AccessibilityNotification.Announcement(attributed).post()
    }
}

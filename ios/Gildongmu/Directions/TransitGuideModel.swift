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

    /// 조망 디스크립터(Kit 순수 계층) — 세션이 없으면 nil.
    var overview: TransitOverview? {
        guard let state, let route else { return nil }
        return transitProgressOverview(state: state, route: route)
    }

    enum AltRouteCommit { case committed, refetching, invalidCandidate, sessionEnded }

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
        state = initTransitGuide(route: guideRoute, now: nowMs())
        UIApplication.shared.isIdleTimerDisabled = true
        tones.play(.start)
        let first = guideRoute.legs[0]
        var parts = [
            appLocalized("transitGuide.started", guideRoute.legs.count),
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
        boardOverrideIndex = nil
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

    /// "탑승" = 차량 선택(N3). 식별자 잠금은 boarding으로 들어가 승차 정류소 도착을
    /// 기다린다 — riding 승격은 상태 머신이 관측으로 한다. `description`은 선택 차량의
    /// 안정 설명(행선·방향 — 폴마다 바뀌는 완성 문장은 제외)으로 상시 표시·통지에 쓴다.
    /// dispatch **전에** 동기로 보관해 vehicleSelected 통지가 빈 설명을 읽지 않는다.
    func board(item: TransitTrackItem, description: TransitLabel?) {
        guard let leg = currentLeg, let trackMode = leg.trackMode else { return }
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

    /// "탑승했습니다"(boarding → riding 사용자 선언).
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
        guard let leg = currentLeg, leg.trackMode == .subway, !leg.viaStops.isEmpty else {
            changeBoarding()
            return
        }
        reboardPickerActive = true
    }

    func cancelReboard() {
        reboardPickerActive = false
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
            return
        }
        guard token == altRoutesToken, isTracking else { return }
        pendingAltRoutes?.origin = resolved.evidence
        do {
            let result = try await fetchTransitCandidates(origin: resolved.origin, dest: dest)
            guard token == altRoutesToken, isTracking else { return }
            if let result {
                pendingAltRoutes?.phase = .loaded(result)
                pendingAltRoutes?.fetchedAt = Date()
            } else {
                pendingAltRoutes?.phase = .empty
            }
        } catch {
            guard token == altRoutesToken, isTracking else { return }
            pendingAltRoutes?.phase = .failed(.fetch)
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
            announce(appLocalized("ios.transitGuide.altRefetching"), highPriority: true)
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
            announce(appLocalized("ios.transitGuide.destChangeRefetched"), highPriority: true)
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
        pollTask?.cancel()
        pollTask = nil
        pendingWalkHandoff = nil  // 옛 목적지의 핸드오프 제안 무효
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
        var parts: [String] = switch state.phase {
        case .waiting: [waitContextText(leg, isCurrentLeg: true)]
        case .boarding: [
            boardingContextText(leg),
            selectedDescription.map {
                TransitGuideTextRenderer.render(
                    transitSelectedVehicleLine(isEn: transitGuideIsEn, desc: $0))
            } ?? "",
        ].filter { !$0.isEmpty }
        default: [contextText(leg)]
        }
        parts.append(signalStatusText(state.signal, phase: state.phase))
        if state.phase == .boarding {
            // 승차 정류소 기준 정보라 "하차역까지 남은 정거장"을 말하면 거짓이 된다 —
            // 원문 프레임만(잔여 수는 원문 꼬리가 담는다).
            if let message = state.lastMessage, !message.isEmpty {
                parts.append(approachFrameText(leg, transitMessageLabel(message, state.lastMessageEn)))
            }
        } else {
            if let remaining = state.remaining {
                parts.append(appLocalized("transitGuide.remainingCount", remaining))
            } else if let count = leg.stationCount, state.phase == .riding {
                parts.append(appLocalized("transitGuide.stationCountAbout", count))
            }
            if let message = state.lastMessage, !message.isEmpty,
               let framed = frameText(
                   leg, transitMessageLabel(message, state.lastMessageEn),
                   arrivalCode: state.lastArrivalCode) {
                parts.append(framed)
            }
        }
        // 근사 주석의 판별자는 leg 유형이 아니라 잠금의 근사 여부(§13.2 — tagoBus는
        // 대기 중에도 근사 예고로 유지).
        if leg.trackMode == .tagoBus || (state.lock.map(isApproxTransitLock) ?? false) {
            parts.append(appLocalized("transitGuide.approxNote"))
        }
        // 신선도 문장은 정확히 1개(§12.3, 감사 H2·M1): 추적 중이면 데이터 나이,
        // 그 외엔 마지막 폴 시각만 — 낡은 나이를 신선한 값처럼 이월하지 않는다.
        if state.signal == .tracking, let age = state.dataAgeSeconds {
            parts.append(appLocalized("transitGuide.dataAge", age))
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
                    : appLocalized("transitGuide.waitingCount", candidates.count)
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
        let result = transitGuideStep(state: state, input: input, route: route, now: nowMs())
        self.state = result.state
        // 사용자가 고른 기준 역(A16 L3)의 수명은 딱 한 번의 재선택이다. 재잠금·전진
        // 뒤에도 남으면 다음 대기 국면이 엉뚱한 역을 조회한다. ⚠ 소거를 호출부마다
        // 흩뿌리지 않는 이유가 그것이다 — board 디스패치만 네 곳이라 하나만 빠져도
        // 조용히 틀린다.
        // N3: boarding이 재선택 역을 계속 조회해야 하므로 `.board`가 아니라 **riding
        // 진입**(선언·관측 어느 길이든)에서 지운다. 국면 기반이라 폴이 일으키는 승격도 잡는다.
        let enteredRiding = result.state.phase == .riding && state.phase != .riding
        switch input {
        case .advance: boardOverrideIndex = nil; selectedDescription = nil
        case .board, .confirmBoarded, .restoreBoarding, .changeBoarding, .poll: break
        }
        if enteredRiding { boardOverrideIndex = nil }
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
        if let event = result.event { handle(event: event) }
    }

    private var firstObservationInStep = false

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
        case let .vehicleSelected:
            if let leg {
                parts.append(TransitGuideTextRenderer.render(transitVehicleSelectedLine(
                    isEn: transitGuideIsEn, leg: displayLeg(leg, useOverride: true),
                    desc: selectedDescription)))
            }
        case let .approaching(_, message, messageEn):
            // 첫 관측만 "추적합니다"를 앞세운다(래치 nil→값). 이후 사다리는 프레임만.
            if firstObservationInStep { parts.append(appLocalized("transitGuide.approachingStarted")) }
            if !message.isEmpty, let leg {
                parts.append(approachFrameText(leg, transitMessageLabel(message, messageEn)))
            }
        case .vehiclePassed:
            if let leg {
                parts.append(TransitGuideTextRenderer.render(transitVehiclePassedLine(
                    isEn: transitGuideIsEn, leg: displayLeg(leg, useOverride: true))))
            }
        case let .boarded(_, cause):
            if let leg {
                let d = displayLeg(leg, useOverride: false)
                if cause == .observed {
                    parts.append(TransitGuideTextRenderer.render(
                        transitArrivedAtBoardStopLine(isEn: transitGuideIsEn, leg: d)))
                }
                parts.append(TransitGuideTextRenderer.render(
                    transitBoardedLine(isEn: transitGuideIsEn, leg: d)))
            }
        case let .trackingStarted(message, messageEn, remaining, arrivalCode):
            if let leg { parts.append(contextText(leg)) }
            parts.append(appLocalized("transitGuide.trackingStarted"))
            let label = transitMessageLabel(message, messageEn)
            let framed = message.isEmpty ? nil : (leg.map { frameText($0, label, arrivalCode: arrivalCode) } ?? message)
            if let framed {
                parts.append(framed)
            } else if let remaining {
                parts.append(appLocalized("transitGuide.remainingCount", remaining))
            }
        case let .countdown(remaining, message, messageEn, currentLocation, currentLocationEn, arrivalCode):
            // §12.3: 매 사다리마다 문맥 문장을 반복하지 않는다 — 프레임이 하차역을 밝힌다.
            // 지하철 99(운행중)는 프레임이 비어 잔여 수 문장으로 떨어진다(A27).
            let label = transitMessageLabel(message, messageEn)
            let framed = message.isEmpty ? nil : (leg.map { frameText($0, label, arrivalCode: arrivalCode) } ?? message)
            parts.append(framed ?? appLocalized("transitGuide.remainingCount", remaining))
            // 한 정거장 전 현재 역 병치(§12.2, 피드백 #10) — 잔여 ≥ 2 문장은 원문이
            // 현재 역을 이미 담아 병치하지 않는다(중복 금지).
            if remaining <= 1,
               let location = transitLocationLabel(currentLocation, currentLocationEn) {
                parts.append(TransitGuideTextRenderer.render(
                    transitCurrentStationLine(isEn: transitGuideIsEn, location: location)))
            }
        case let .messageChanged(message, messageEn, arrivalCode):
            let label = transitMessageLabel(message, messageEn)
            let framed: String? = leg.map {
                state?.phase == .boarding
                    ? approachFrameText($0, label)
                    : frameText($0, label, arrivalCode: arrivalCode)
            } ?? message
            if let framed { parts.append(framed) }
        case let .arrived(certain):
            parts.append(appLocalized(certain ? "transitGuide.arrived" : "transitGuide.arrivedGuess"))
            if let state, let route {
                let nextIndex = state.legIndex + 1
                if route.legs.indices.contains(nextIndex) {
                    parts.append(appLocalized(
                        "transitGuide.nextLeg",
                        waitContextText(route.legs[nextIndex], isCurrentLeg: false)))
                } else if let walk = route.walkAfterMinutes {
                    parts.append(appLocalized(
                        "transitGuide.nextLeg", appLocalized("transitGuide.doneWalk", String(walk))))
                }
            }
        case let .backOnTrack(message, messageEn, arrivalCode):
            parts.append(appLocalized("transitGuide.backOnTrack"))
            let backLabel = transitMessageLabel(message, messageEn)
            if !message.isEmpty,
               let framed = leg.map({ frameText($0, backLabel, arrivalCode: arrivalCode) }) ?? message {
                parts.append(framed)
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
                parts.append(waitContextText(next, isCurrentLeg: false))
                if next.trackMode == nil { parts.append(appLocalized("transitGuide.untrackable")) }
            }
        case .boardingReset:
            parts.append(appLocalized("transitGuide.changeBoardingDone"))
        }
        return parts.joined(separator: " ")
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

    /// 승차 국면 상태 문장(§12.3). 버스는 upstream 완성 문장의 라벨 프레임("{stop}까지 {message}", 원문 무변형).
    /// 지하철은 `arvlMsg2`가 조회역(=하차역) 기준 열차 위치 서술이라 그 틀에 넣으면 뜻이 뒤집힌다
    /// ("충정로까지 전역 도착", A27 실승차 피드백) — `subwayRidingMessage`(코드 → 탑승자 시점 문장)로 고르고,
    /// 99(운행중)는 nil(잔여 수가 말한다), 미지 코드는 원문을 틀 없이 그대로. 웹 `frameText` 미러.
    func frameText(_ leg: TransitGuideLeg, _ message: TransitLabel, arrivalCode: String?) -> String? {
        let line = transitFrameLine(
            isEn: transitGuideIsEn, leg: displayLeg(leg, useOverride: false),
            message: message, arrivalCode: arrivalCode)
        guard !line.parts.isEmpty else { return nil }
        return TransitGuideTextRenderer.render(line)
    }

    /// boarding 문맥(N3) — 승차 정류소에서 선택 차량을 기다리는 중. 재선택 역이 있으면 그 역.
    func boardingContextText(_ leg: TransitGuideLeg) -> String {
        TransitGuideTextRenderer.render(
            transitBoardingContextLine(isEn: transitGuideIsEn, leg: displayLeg(leg, useOverride: true)))
    }

    /// boarding 완성 문장 프레임 — 승차 정류소 라벨 전치("{stop}에 {message}").
    func approachFrameText(_ leg: TransitGuideLeg, _ message: TransitLabel) -> String {
        TransitGuideTextRenderer.render(
            transitApproachFrameLine(
                isEn: transitGuideIsEn, leg: displayLeg(leg, useOverride: true), message: message))
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
    func signalStatusText(_ signal: TransitSignal, phase: TransitPhase) -> String {
        switch signal {
        case .tracking:
            phase == .boarding
                ? appLocalized("transitGuide.stateApproaching")
                : appLocalized("transitGuide.stateTracking")
        case .notYetVisible:
            switch phase {
            case .riding: appLocalized("transitGuide.stateRidingNotYetVisible")
            case .boarding: appLocalized("transitGuide.stateBoardingNotYetVisible")
            default: appLocalized("transitGuide.stateNotYetVisible")
            }
        case .neverSeen: appLocalized("transitGuide.stateNeverSeen")
        case .signalLost: appLocalized("transitGuide.stateSignalLost")
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

    /// 통지 단일 경로. 하차 임박·도착·직접 응답만 .high(§6.1 — 헌장 §5 계열).
    private func announce(_ message: String, highPriority: Bool = false) {
        // 검색 시트(받아쓰기 마이크)가 열린 동안은 발화 0(스펙 §5.4).
        guard !outputSuppressed else { return }
        var attributed = AttributedString(spokenUnits(message))
        if highPriority { attributed.accessibilitySpeechAnnouncementPriority = .high }
        AccessibilityNotification.Announcement(attributed).post()
    }
}

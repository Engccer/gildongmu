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
    private var queryTask: Task<Void, Never>?
    private var road = OutingRoadState()
    /// 방향 행의 앞쪽 이정표 문구 — 방위가 valid인 마지막 fix에서 정한다(정지 중에도 "…, 마지막 진행 방향"과 함께 남는다).
    private(set) var aheadText: String?
    private(set) var lastFix: (lat: Double, lng: Double, accuracy: Double)?

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
        post: { [weak self] text, high, bypass in
            self?.post(text, highPriority: high, bypassSuppression: bypass) ?? false
        }
    )
    /// 기기 음성 대기 한 칸(spec §7.3 — 선점하지 않는다). 말하는 중 새 문장이 오면 옛 대기 문장을 버리고 이것을 둔다.
    private var speechPending: String?
    private var speechDrain: Task<Void, Never>?

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
        resetSessionState()
        endScreen = nil
        endedAt = nil
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
        playTone(.start)
        LocationService.shared.startBeaconUpdates(
            onFix: { [weak self] fix in self?.handle(fix: fix) },
            onError: { [weak self] code in self?.handle(locationError: code) },
            onAuthChange: { [weak self] status in self?.handle(authorization: status) },
            onAccuracyChange: { [weak self] accuracy in self?.handle(accuracy: accuracy) }
        )
        startWatchdog()
        say(appLocalized("ios.outing.start"), highPriority: true)
    }

    /// 시작 거절 — 버튼 활성화의 직접 응답이라 `.high`(헌장 §5).
    private func refuse(_ key: String) {
        announcer.announceNow(appLocalized(key), highPriority: true, bypassSuppression: true)
    }

    private func resetSessionState() {
        origin = nil
        originLabel = nil
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
        queryTask?.cancel()
        queryTask = nil
        road = OutingRoadState()
        aheadText = nil
        lastFix = nil
        lastFixAt = nil
        lastStaleNoticeAt = nil
        sessionProgressAnchor = nil
        sessionLastProgressAt = nil
        toneState = .initial
        lastBeepMeters = 0
        speechPending = nil
        speechDrain?.cancel()
        speechDrain = nil
    }

    // MARK: - 종료

    /// 세션 정리(세 종료 경로 공통). 종료 화면은 호출부가 정한다. `holdSeconds`는 이어질 기기 음성 길이만큼
    /// 오디오 원복을 미루는 여유다(운전자 채널 선례 — 원복이 문장을 자른다).
    func stop(playStopTone: Bool = false, holdSeconds: Double = 0) {
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
        LocationService.shared.stopBeaconUpdates()
        pedometer.stopLiveUpdates()
        UIApplication.shared.isIdleTimerDisabled = false
        if playStopTone, isTracking { playTone(.stop) }
        tones.endSession(holdSeconds: holdSeconds)
        status = .idle
        outputSuppressed = false
    }

    /// 사용자 종료("나들이 종료" 버튼). 종료 화면을 남기고 사유를 알린다(포커스를 쥔 버튼이 사라지는 전이라 `.high`).
    func stopByUser() {
        let text = appLocalized("ios.outing.endedByUser")
        endLeavingScreen(reason: text, playStopTone: true)
        say(text, highPriority: true)
    }

    /// 안전망 종료(두절·무이동 5분). 정지 톤은 전경에서만(잠근 채 잊은 휴대전화가 한참 뒤 울리지 않게, 도보 동형).
    private func endIdle(reason: SessionIdleReason) {
        guideDiagLog("outingEnd reason=\(reason.rawValue)")
        let text = appLocalized("guide.endedIdle")
        endLeavingScreen(reason: text, playStopTone: isForeground)
        say(text, highPriority: true)
    }

    /// 종료 화면을 남기는 종료. 걸음 요약과 귀환 버튼 중 하나라도 있으면 화면이 성립한다(spec §8.3).
    private func endLeavingScreen(reason: String, playStopTone: Bool) {
        let target = returnTarget
        let sample = liveHealthSample
        stop(playStopTone: playStopTone, holdSeconds: 3)
        let health = sample.flatMap { s -> WalkHealthSummary? in
            guard WalkHealth.isMeaningfulWalk(steps: s.steps, distanceMeters: s.distance) else { return nil }
            return WalkHealth.summary(steps: s.steps, distanceMeters: s.distance, weightKg: Self.storedWeight())
        }
        guard health != nil || target != nil else { return }
        endScreen = EndScreen(reason: reason, health: health, origin: target)
        endedAt = .now
    }

    /// 귀환 인계 직전(`GuideSession.acceptOutingReturn`): 세션·종료 화면을 함께 치운다(종료 화면 없음, spec §5.3).
    func endForReturn() {
        stop()
        clearEnd()
    }

    /// 종료 화면 닫기 — 유일한 소거 경로.
    func clearEnd() {
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

    /// 인계 고지(§13 VoiceOver 통지 네 곳 중 하나).
    func announceReturn() {
        say(appLocalized("ios.outing.returning"), highPriority: true)
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
        default:
            break
        }
    }

    // MARK: - 만보계

    private func handlePedometer(steps: Int, distance: Double?) {
        liveHealthSample = (steps, distance)
        guard let distance else { return }
        pedometerUnavailable = false
        let previous = walkedMeters ?? 0
        walkedMeters = distance
        // 10m 경계를 넘으면 **한 번만**(spec §6.5 — 한 콜백에 20m가 와도 연타하지 않는다).
        if outingDistanceToneStep(previousMeters: max(previous, lastBeepMeters), currentMeters: distance) > 0 {
            lastBeepMeters = distance
            playTone(.stroll)
        }
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
        if origin != nil, queryTask == nil, outingRequeryStep(lastQuery: lastQuery, fix: here) {
            requery(at: here, reason: lastQuery == nil ? "origin" : "distance")
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
        // 보관한 최선값은 받은 순간의 나이를 들고 있다 — 지난 시간만큼 늙혀 판정한다(도보 routeOriginBestAt 동형).
        var best = originBest
        if var b = best, let at = originBestAt { b.ageSeconds += now - at; best = b }
        if fix == nil, best == nil { return }
        switch outingOriginStep(best: best, fix: fix, elapsedSeconds: now - startedAt) {
        case .confirm(let chosen):
            confirmOrigin(chosen)
        case .wait(let next):
            if next != best { originBestAt = now }
            originBest = next
        }
    }

    private func confirmOrigin(_ fix: RouteOriginFix) {
        origin = fix
        originBest = nil
        originBestAt = nil
        guideDiagLog("outingOrigin acc=\(String(format: "%.1f", fix.accuracy))")
        let lang = AppLanguage.dataLocale
        Task { [weak self, search] in
            let resolved = try? await search.reverseGeocode(lat: fix.lat, lng: fix.lng, lang: lang)
            guard let self, self.isTracking, self.origin == fix else { return }
            let label = lang == "ko" ? resolved?.address : (resolved?.english ?? resolved?.address)
            self.originLabel = label
            self.say(self.statusLine)
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
            "requery reason=\(reason) n=\(places.count) fail=\(surroundingsFailures) "
                + "crosswalks=\(crosswalks.count) road=\(road.confirmed ?? "-")")
        if let name = roadStep.announce, narration.speaks(.landmark) {
            say(appLocalized("ios.outing.roadEntered", name))
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
        // 횡단보도 예고가 지나침보다 앞이다 — 안전 정보(spec §6.3). 둘 다 나오면 기기 음성 대기 칸이 순서를 지킨다.
        if level.speaks(.landmark) {
            let pairs = crosswalks.values.map { c in
                (crosswalk: c, relation: outingProject(
                    fixLat: fix.lat, fixLng: fix.lng, accuracy: fix.accuracy,
                    heading: heading, placeLat: c.lat, placeLng: c.lng))
            }
            if let notice = outingCrosswalkNoticeStep(crosswalks: pairs, audioSignals: audioSignals, spoken: spokenCrosswalks) {
                spokenCrosswalks.insert(notice.id)
                guideDiagLog("crosswalk id=\(notice.id) audio=\(notice.hasAudioSignal)")
                say(appLocalized(notice.hasAudioSignal ? "ios.outing.crosswalkAheadAudio" : "ios.outing.crosswalkAhead"))
            }
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
                say(Self.passByLine(name: displayName(p), side: rel.side))
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
        guard origin != nil else { return appLocalized("ios.outing.originPending") }
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
        return appLocalized("ios.outing.walked", formatDistance(outingQuantizedMeters(walkedMeters)))
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
        let front: String = switch surroundingsStatus {
        case .loading: appLocalized("ios.outing.surroundingsLoading")
        case .failed: appLocalized("ios.outing.surroundingsFailed")
        case .outOfCoverage: appLocalized("ios.outing.outOfCoverage")
        case .ready: aheadText ?? appLocalized("ios.outing.aheadNone")
        }
        return joinText(front, headingLine)
    }

    /// 띠바 요약(10m 양자화).
    var bandLine: String {
        if !isTracking { return appLocalized("ios.outing.stop") }
        guard let walkedMeters else { return appLocalized("ios.outing.heading") }
        return appLocalized("ios.outing.band", formatDistance(outingQuantizedMeters(walkedMeters)))
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
        guard isTracking, origin != nil, queryTask == nil, let fix = lastFix else { return }
        requery(at: RoutePoint(lat: fix.lat, lng: fix.lng), reason: "overview")
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
        // 국면 무관 안전망(spec §5.3·§9). 나들이엔 도착 창이 없으므로 두 축 모두 산다.
        let progressRef = max(startedAt, sessionLastProgressAt ?? startedAt)
        if let reason = sessionIdleStep(secondsSinceUsableFix: now - fixRef, secondsSinceProgress: now - progressRef) {
            endIdle(reason: reason)
            return
        }
        // 약신호 통지(도보 안내 동형, 전경 VoiceOver 창구만).
        if now - fixRef >= noFixTimeout, isForeground {
            if let last = lastStaleNoticeAt, now - last < staleRenotifyInterval { return }
            lastStaleNoticeAt = now
            announcer.announce(appLocalized("beacon.weak"))
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
        say(text, highPriority: true)
    }

    // MARK: - 출력

    private func playTone(_ tone: BeaconTone) {
        guard !outputSuppressed else { return }
        tones.play(tone)
    }

    /// 문장 창구 — 톤 뒤 지연(`DeferredAnnouncer`)을 지나 `post`에서 채널이 갈린다.
    private func say(_ text: String, highPriority: Bool = false) {
        announcer.announce(text, highPriority: highPriority)
    }

    /// 실제 게시. 전경 ∧ VoiceOver면 VoiceOver 통지, 그 밖(백그라운드·VoiceOver 꺼짐)은 기기 음성(spec §7.3).
    @discardableResult
    private func post(_ message: String, highPriority: Bool, bypassSuppression: Bool) -> Bool {
        guard bypassSuppression || !outputSuppressed else { return false }
        let channel = isForeground && UIAccessibility.isVoiceOverRunning ? "voiceover" : "device"
        guideDiagLog("outingSpeak channel=\(channel) text=\(message)")
        if channel == "voiceover" {
            var attributed = AttributedString(spokenUnits(message))
            if highPriority { attributed.accessibilitySpeechAnnouncementPriority = .high }
            AccessibilityNotification.Announcement(attributed).post()
        } else {
            speakDevice(spokenUnits(message))
        }
        return true
    }

    /// 기기 음성 — 말하는 중이면 대기 한 칸(선점 금지, spec §7.3).
    private func speakDevice(_ text: String) {
        guard TtsPlayer.shared.isSpeaking else {
            TtsPlayer.shared.speakGuidance(text)
            return
        }
        speechPending = text
        guard speechDrain == nil else { return }
        speechDrain = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(300))
                guard let self else { return }
                if TtsPlayer.shared.isSpeaking { continue }
                if let next = self.speechPending {
                    self.speechPending = nil
                    TtsPlayer.shared.speakGuidance(next)
                }
                self.speechDrain = nil
                return
            }
        }
    }
}

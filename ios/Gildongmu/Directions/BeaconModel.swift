import CoreLocation
import Foundation
import GildongmuKit
import Observation
import SwiftUI

/// 거리 추적 오케스트레이터. **판정은 전부 Kit이 하고 여기는 배선만 한다.**
///
/// 이 계층에 로직을 두면 검증이 불가능하다(앱 타깃 테스트 번들이 없다). 그래서
/// 리듀서는 `beaconStep`, 톤·통지 판정은 `beaconGateStep`, fix 수용 판정은
/// `isUsableFix`가 맡고, 이 클래스는 권한·타임아웃·I/O만 담당한다.
///
/// 전경 전용 계약: 화면을 켜 두고(`isIdleTimerDisabled`) 앱이 앞에 있는 동안만
/// 추적한다. 백그라운드 위치는 도입하지 않는다(위원장 결정, spec §8.1).
@Observable @MainActor
final class BeaconModel {
    enum Status: Equatable {
        case idle
        case tracking
        /// 권한 거부·제한.
        case denied
        /// 위치 서비스 꺼짐·취득 실패. `denied`와 문구가 달라야 한다. 사용자가 취할
        /// 행동이 다르다(설정에서 권한 허용 vs 하늘이 트인 곳으로 이동).
        case unavailable
    }

    /// 안내 방식 = 거리의 기준(스펙 §3). 간략=직선(비콘, 전 수단), 상세=경로(도보·ko 전용).
    enum GuideMode: Equatable { case brief, detail }

    private(set) var status: Status = .idle
    /// 추적 중인 목적지 이름. 추적 화면이 이 값을 읽는다.
    ///
    /// 뷰가 파생하지 않고 모델이 드는 이유는 경합이다. 뷰의 `trackedDestination`은
    /// 도착지가 "현재 위치"로 바뀌는 순간 nil이 되는데, 같은 변화가 추적도 멈춘다.
    /// 두 반응이 같은 프레임에 걸리면 시트가 닫히기 직전 **내용 없는 화면**이 한 프레임
    /// 스친다(스크린 리더에겐 빈 화면이 스쳐 지나가는 것이라 시각보다 혼란이 크다).
    /// 시작 시점의 이름을 모델이 붙들면 그 질문 자체가 없어진다.
    ///
    /// ⚠ `stop()`에서 비우지 않는다. 시트 dismiss 애니메이션 동안 내용부가 다시
    /// 평가되므로, 비우면 같은 빈 화면이 닫히는 길에 재현된다. 추적 중이 아닐 때 이
    /// 값을 읽는 곳은 없다.
    private(set) var destinationLabel = ""
    /// 화면에 보이는 상태 1줄. 웹에는 눈에 보이는 live region이 있는데 그게 없으면
    /// VoiceOver를 끈 사람에게 아무 변화도 안 보인다(2.1(a) 반려 전력과 동형).
    private(set) var statusText = ""
    /// 현재 실패의 해결 수단. 뷰가 이 값으로 해결 버튼을 고른다.
    /// ⚠ 권한 거부(설정 열기)와 정밀 위치 꺼짐(그 자리 시스템 팝업)은 버튼이
    /// **다르다**. openSettingsURLString이 여는 화면에는 정확한 위치 토글이 없다
    /// (위원장 실기기 확인 2026-08-02). 위치 서비스 전역 꺼짐·취득 실패는 앱 설정
    /// 화면에서 해결되지 않으므로 none.
    enum FailResolution { case none, settings, precise }
    private(set) var failResolution: FailResolution = .none

    /// 검색 시트가 떠 있는 동안 **톤과 통지를 모두** 죽인다. 시트에 받아쓰기가 있고,
    /// 헌장 §6의 홀드 계약 불변식은 "녹음 중 SR 발화 0"이다. polite 통지는 VoiceOver가
    /// 실제로 말하는 음성이라 톤보다 전사 오염 위험이 오히려 크다(스피커→마이크 경로는
    /// 이 저장소에서 세 번 실측됐다). 추적과 상태 텍스트는 유지한다.
    var outputSuppressed = false {
        // 톤 재생기에도 전파한다. 재생 경로만 막으면 인터럽션·구성변경 옵서버가
        // 여전히 세션 카테고리를 되돌려 받아쓰기 세션을 깬다(리뷰 I-8).
        didSet {
            tones.isSuppressed = outputSuppressed
            // 억제 해제 복구(스펙 §4.3): 받아쓰기 몇 초 사이 소비된 실행 안내(횡단보도·
            // 회전)를 최신 1개만 되살린다. 밀린 것 전부 재생은 금지(최신 우선).
            if !outputSuppressed, let pending = pendingRecovery {
                pendingRecovery = nil
                announce(pending)
            }
        }
    }

    // MARK: - 실시간 길 안내(상세 모드) 상태

    private(set) var mode: GuideMode = .brief
    /// 상세⇄간략 전환 버튼 노출 조건. 경로는 ko 데이터 로케일에서만 조회되므로
    /// (스펙 §4.1 ko 전용) 이 값이 곧 로케일 게이트를 겸한다.
    var canOfferDetail: Bool { guideRoute != nil }
    /// 이탈 상태 — 시트가 "경로 다시 조회" 버튼 노출에 쓴다.
    private(set) var offRoute = false
    /// 반복 버튼 대상: 마지막 실행 안내(상세=스텝·묶음, 간략=거리 통지). 상태·오류
    /// 통지는 대상이 아니다(스펙 §4.2 리뷰 #23).
    private(set) var lastGuidance: String?

    /// 세션이 쥐는 경로. 메모리에만 두고 세션 종료와 함께 폐기한다(스펙 §7.3 약관 경계).
    private var guideRoute: GuideRoute?
    private var guideState: GuideState?
    /// 시작 직후 경로 조회 중 — 이 동안 비콘 발화를 보류해 "간략 첫 거리 → 곧바로
    /// 상세 시작" 이중 발화를 막는다.
    private var awaitingRoute = false
    private var routeFetchTask: Task<Void, Never>?
    /// 억제 중 소비된 실행 안내의 최신 1개(해제 시 복구 발화).
    private var pendingRecovery: String?
    /// 간략→상세 전환 모호 해소 대기 시작 시각(스펙 §6). nil이면 대기 없음.
    private var resolvePendingSince: Double?
    /// 재조회 latest-wins 세대 토큰 + in-flight 가드(repo 관례).
    private var rerouteToken = 0
    private var rerouteInFlight = false

    private let routeService = RouteService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    private var uptimeNow: Double { ProcessInfo.processInfo.systemUptime }

    private var beaconState = BeaconState.initial
    private var gateState = BeaconGateState.initial
    private var dest: BeaconDest?
    private let tones = BeaconTonePlayer()
    private var startTask: Task<Void, Never>?
    private var watchdog: Task<Void, Never>?
    private var lastFixAt: Double?
    private var startedAt: Double?
    private var lastStaleNoticeAt: Double?
    /// 시작 재진입 가드. 클로저 가드만으론 await를 넘는 더블탭을 못 막는다(repo 관례).
    private var starting = false
    /// 백그라운드 복귀 리셋 직후의 첫 안내를 삼킨다. 앵커를 버리면 다음 fix가 first-fix
    /// 경로를 타서 절대거리가 재발화되는데, 사용자가 유발한 사건이 아니다.
    private var suppressNextNotice = false
    /// `.background`를 실제로 거쳤는가. `.inactive`(제어센터·알림센터 같은 짧은
    /// 인터럽션)만으로 앵커를 버리면 추세가 계속 초기화된다(`GildongmuApp`의
    /// `backgroundedAt` 패턴과 같은 판정).
    private var wasBackgrounded = false

    private let noFixTimeout = 15.0
    private let staleRenotifyInterval = 30.0

    var isTracking: Bool { status == .tracking }

    // MARK: - 시작·중지

    func toggle(dest: BeaconDest, label: String) {
        if isTracking {
            stop(playStopTone: true)
        } else {
            guard !starting else { return }
            starting = true
            startTask = Task { [weak self] in
                await self?.start(dest: dest, label: label)
                self?.starting = false
            }
        }
    }

    private func start(dest: BeaconDest, label: String) async {
        guard !isTracking else { return }

        // 권한 게이트는 `authorizationSnapshot`을 직접 본다. `currentCoordinate()`는
        // 캐시 우선이라 권한을 보지 않고 반환하는 경로가 있고, 그러면 권한 회수 후에도
        // "성공"해서 시작 톤만 나고 fix는 영영 오지 않는다(무한 침묵).
        guard LocationService.shared.isLocationServiceEnabled else {
            fail(with: .unavailable, key: "beacon.weak")
            return
        }
        switch LocationService.shared.authorizationSnapshot {
        case .denied, .restricted:
            fail(with: .denied, key: "beacon.denied", resolution: .settings)
            return
        case .notDetermined:
            // 팝업 자체가 신호다. 허용 여부는 아래에서 다시 확인한다.
            await LocationService.shared.primeAuthorization()
            guard !Task.isCancelled else { return }
            switch LocationService.shared.authorizationSnapshot {
            case .authorizedWhenInUse, .authorizedAlways: break
            default:
                fail(with: .denied, key: "beacon.denied", resolution: .settings)
                return
            }
        default:
            break
        }

        // 정밀 위치가 꺼져 있으면 좌표가 1~20km 오차라 "가까워지는 중/멀어지는 중"이
        // 전부 잡음이 된다. 데드밴드(max(15, accuracy))도 그 규모에서는 의미를 잃는다.
        // 걸으면서 소리만 듣는 기능이라 틀린 안내가 화면으로 반증되지도 않는다.
        guard LocationService.shared.accuracySnapshot != .reducedAccuracy else {
            fail(with: .unavailable, key: "beacon.reduced", resolution: .precise)
            return
        }

        // await를 넘어온 뒤 화면을 떠났을 수 있다. 여기서 안 막으면 다른 탭에서 톤이
        // 계속 나는 좀비 추적이 되고, 그 화면의 onDisappear는 이미 지나갔다.
        guard !Task.isCancelled else { return }

        self.dest = dest
        destinationLabel = label
        beaconState = .initial
        gateState = .initial
        lastFixAt = nil
        lastStaleNoticeAt = nil
        suppressNextNotice = false
        startedAt = ProcessInfo.processInfo.systemUptime
        status = .tracking
        statusText = ""
        failResolution = .none
        UIApplication.shared.isIdleTimerDisabled = true
        playTone(.start)

        LocationService.shared.startBeaconUpdates(
            onFix: { [weak self] fix in self?.handle(fix: fix) },
            onError: { [weak self] code in self?.handle(locationError: code) },
            onAuthChange: { [weak self] status in self?.handle(authorization: status) },
            onAccuracyChange: { [weak self] accuracy in self?.handle(accuracy: accuracy) }
        )
        startWatchdog()

        // 상세 적격 시도(스펙 §4.1): ko 데이터 로케일에서만 경로를 조회한다(도보 API
        // V1 ko 전용). 조회 중엔 비콘 발화를 보류하고, 실패는 간략으로 정직 폴백.
        if AppLanguage.dataLocale == "ko" {
            awaitingRoute = true
            routeFetchTask = Task { [weak self] in
                await self?.fetchGuideRoute(dest: dest)
            }
        }
    }

    /// 시작 시 상세 경로 조회. 성공하면 상세 모드 + 원자 시작 발화, 실패는 간략 폴백.
    /// "이 세션에서 현재 목적지에 대해 조회"가 곧 상세 적격 조건이다(스펙 §4.1).
    private func fetchGuideRoute(dest: BeaconDest) async {
        defer { awaitingRoute = false }
        do {
            let origin = try await LocationService.shared.currentCoordinate()
            guard !Task.isCancelled, isTracking, self.dest == dest else { return }
            let briefing = try await routeService.walk(
                originLat: origin.lat, originLng: origin.lng,
                destLat: dest.lat, destLng: dest.lng,
                includeGeometry: true
            )
            guard !Task.isCancelled, isTracking, self.dest == dest else { return }
            guard let briefing,
                  let route = buildGuideRoute(briefing.steps.map {
                      GuideStepGeometry(description: $0.description, pathCoords: $0.pathCoords)
                  })
            else {
                fallbackToBrief()
                return
            }
            guideRoute = route
            let initial = initialGuideState(route: route, now: uptimeNow)
            guideState = initial.state
            mode = .detail
            offRoute = false
            // 시작 요약 + 첫 안내를 한 문장으로(원자 발화 — 두 통지의 경합 제거).
            let text = GuideText.start(route: route, firstIndices: initial.firstIndices)
            lastGuidance = GuideText.unit(route: route, indices: initial.firstIndices)
            statusText = text
            announce(text)
        } catch {
            guard !Task.isCancelled, isTracking else { return }
            fallbackToBrief()
        }
    }

    /// 상세 불가 시 간략 폴백(조용한 강등 금지 — 통지가 모드를 말한다, 스펙 §4.1).
    private func fallbackToBrief() {
        mode = .brief
        let text = appLocalized("guide.detailUnavailable")
        statusText = text
        announce(text)
    }

    private func fail(with status: Status, key: String, resolution: FailResolution = .none) {
        self.status = status
        failResolution = resolution
        statusText = appLocalized(key)
        announce(statusText)
    }

    /// 중지. 어느 경로로 불려도 idle timer가 반드시 풀리도록 먼저 해제한다
    /// (전역 가변 상태라 누수되면 화면이 영영 안 꺼진다).
    ///
    /// ⚠ 톤 엔진은 여기서 정리하지 않는다. 정지 톤을 예약한 직후 엔진을 멈추면
    /// 하강 3음이 한 프레임도 나지 않는다. 정리는 `teardown()` 몫이다.
    func stop(playStopTone: Bool = false) {
        startTask?.cancel()
        startTask = nil
        starting = false
        UIApplication.shared.isIdleTimerDisabled = false
        watchdog?.cancel()
        watchdog = nil
        LocationService.shared.stopBeaconUpdates()
        if playStopTone && status == .tracking { playTone(.stop) }
        if status == .tracking { status = .idle }
        statusText = ""
        failResolution = .none
        beaconState = .initial
        gateState = .initial
        dest = nil
        // 세션 종료 = 경로 폐기(스펙 §7.3 약관 경계: 메모리 한정·세션 간 재사용 금지).
        routeFetchTask?.cancel()
        routeFetchTask = nil
        awaitingRoute = false
        mode = .brief
        guideRoute = nil
        guideState = nil
        lastGuidance = nil
        offRoute = false
        pendingRecovery = nil
        resolvePendingSince = nil
        rerouteToken += 1  // in-flight 재조회 응답 폐기(latest-wins)
    }

    /// 화면 이탈 정리. 중지에 더해 오디오 자원까지 반납한다.
    func teardown() {
        stop()
        tones.shutdown()
    }

    /// 목적지가 바뀌면 옛 목적지를 추적하는 창이 생기므로 즉시 멈춘다.
    /// 사용자가 비콘 컨트롤을 조작한 게 아니라 라벨 변화만으로는 신호가 안 되어 통지한다.
    func stopBecauseDestinationChanged() {
        guard isTracking else { return }
        stop()
        announce(appLocalized("ios.beacon.stopped"))
    }

    // MARK: - 앱 생명주기 (전경 전용 계약)

    func handleScenePhaseChange(to phase: ScenePhase) {
        switch phase {
        case .background:
            wasBackgrounded = true
            UIApplication.shared.isIdleTimerDisabled = false
        case .active:
            guard isTracking else { return }
            UIApplication.shared.isIdleTimerDisabled = true
            // `.background`를 거친 복귀에서만 앵커를 버린다. 제어센터를 잠깐 여는
            // `.inactive` 왕복까지 리셋하면 추세가 계속 초기화되고 절대거리가 재발화된다.
            guard wasBackgrounded else { return }
            wasBackgrounded = false
            beaconState = .initial
            gateState = .initial
            lastFixAt = nil
            startedAt = ProcessInfo.processInfo.systemUptime
            suppressNextNotice = true
        default:
            break
        }
    }

    // MARK: - fix 처리

    private func handle(fix: LocationService.BeaconFixPayload) {
        guard isTracking, let dest else { return }

        // 경로 조회 중엔 발화를 보류한다(간략 첫 거리 → 곧바로 상세 시작의 이중 발화
        // 차단). fix는 오고 있으므로 워치독 기준만 갱신.
        if awaitingRoute {
            lastFixAt = uptimeNow
            return
        }
        if mode == .detail, let route = guideRoute {
            handleDetail(fix: fix, route: route)
            return
        }
        // 간략 경로 위에서의 상세 전환 모호 해소 시도(스펙 §6). 성공하면 이번 fix 소비.
        if resolveDetailIfPending(fix: fix) { return }

        // 캐시 위치와 무효 좌표를 앵커에서 배제한다(판정은 Kit 순수 함수).
        let age = Date().timeIntervalSince(fix.timestamp)
        guard isUsableFix(accuracy: fix.accuracy, ageSeconds: age) else { return }

        let now = ProcessInfo.processInfo.systemUptime
        lastFixAt = now
        lastStaleNoticeAt = nil

        let stepped = beaconStep(
            state: beaconState,
            fix: BeaconFix(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy),
            dest: dest
        )
        beaconState = stepped.state

        let gated = beaconGateStep(state: gateState, announce: stepped.announce, now: now)
        gateState = gated.state

        if let tone = gated.tone { playTone(tone) }
        if let notice = gated.notice {
            let text = self.text(for: notice)
            statusText = text
            // 반복 버튼 대상은 거리 통지만(weak는 상태라 제외, 스펙 §4.2).
            if case .weak = notice {} else { lastGuidance = text }
            if suppressNextNotice {
                suppressNextNotice = false  // 복귀 직후 1회만 삼킨다
            } else {
                announce(text)
            }
        }
    }

    // MARK: - 상세 모드 fix 처리·이벤트 배선 (판정은 전부 Kit guideStep)

    private func handleDetail(fix: LocationService.BeaconFixPayload, route: GuideRoute) {
        guard let state = guideState else { return }
        // 캐시 fix만 거른다. 정확도 악화(50m 초과)는 버리지 않고 리듀서에 넘긴다 —
        // uncertain 전이(진입·회복 1회 통지)가 그 정보의 소비자다(스펙 §5.0).
        let age = Date().timeIntervalSince(fix.timestamp)
        guard fix.accuracy > 0, age <= 10 else { return }

        let now = uptimeNow
        lastFixAt = now
        lastStaleNoticeAt = nil

        let out = guideStep(
            state: state,
            fix: GuideFix(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy),
            route: route,
            now: now
        )
        guideState = out.state
        // 전용음(예고·경고)은 사운드 태스크에서 교체 — 그때까지 기존 톤을 임시 배정.
        if let tone = out.tone { playTone(tone == .ahead ? .nearby : .farther) }
        guard let event = out.event else { return }
        consume(event: event, route: route)
    }

    private func consume(event: GuideEvent, route: GuideRoute) {
        switch event {
        case let .announceSteps(indices), let .bundleReread(indices):
            let text = GuideText.unit(route: route, indices: indices)
            lastGuidance = text
            statusText = text
            // 실행 안내는 억제 중이면 최신 1개를 보관해 해제 시 복구한다(스펙 §4.3).
            if outputSuppressed { pendingRecovery = text } else { announce(text) }
        case let .periodic(stepIndex, remainingMeters, accuracy):
            let text = GuideText.periodic(
                route: route, stepIndex: stepIndex, remainingMeters: remainingMeters,
                accuracy: accuracy, destinationLabel: destinationLabel
            )
            lastGuidance = text
            statusText = text
            announce(text)
        case .handoff:
            // 간략(비콘) 인계 — 검증된 리듀서를 그대로 쓴다. 자동 인계는 래치이며
            // 수동 상세 복귀는 전환 버튼으로(재무장은 리듀서 상태가 소유).
            mode = .brief
            beaconState = .initial
            gateState = .initial
            let text = appLocalized("guide.handoff")
            statusText = text
            announce(text)
        case .offRoute:
            offRoute = true
            let text = appLocalized("guide.offRoute")
            statusText = text
            announce(text)
        case .backOnRoute:
            offRoute = false
            let text = appLocalized("guide.backOnRoute")
            statusText = text
            announce(text)
        case .uncertainEnter:
            statusText = appLocalized("guide.uncertain")
            announce(statusText)
        case .uncertainExit, .reacquired:
            statusText = appLocalized("guide.uncertainRecovered")
            announce(statusText)
        case .reacquiring:
            statusText = appLocalized("guide.reacquiring")
            announce(statusText)
        case .speedSuggest:
            // 자동 전환은 하지 않는다(스펙 §2 모드 결정 원칙) — 해법은 시트 전환 버튼.
            announce(appLocalized("guide.speedSuggest"))
        }
    }

    /// 간략→상세 전환의 모호 해소(스펙 §6): 후속 fix들로 전역 후보가 하나로 좁혀지면
    /// 전환을 완료한다. 반환 true면 이번 fix를 전환 처리로 소비했다는 뜻.
    private func resolveDetailIfPending(fix: LocationService.BeaconFixPayload) -> Bool {
        guard let since = resolvePendingSince, let route = guideRoute else { return false }
        guard fix.accuracy > 0 else { return false }
        let now = uptimeNow
        let gfix = GuideFix(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy)
        if case let .ok(d) = entryProjection(route: route, fix: gfix) {
            resolvePendingSince = nil
            // 수동 복귀는 자동 인계 재무장 전(armed=false)으로 시작한다(전환 루프 차단).
            guideState = guideStateAt(route: route, d: d, now: now, autoHandoffArmed: false)
            mode = .detail
            offRoute = false
            let text = appLocalized("guide.toDetailDone")
            statusText = text
            announce(text)
            return true
        }
        if now - since > resolveTimeoutSeconds {
            resolvePendingSince = nil
            let text = appLocalized("guide.resolveFailed")
            statusText = text
            announce(text)
        }
        return false
    }

    // MARK: - 시트 컨트롤 (반복·진행 상황·전환·재조회)

    func repeatLastGuidance() {
        announce(lastGuidance ?? appLocalized("guide.noGuidanceYet"))
    }

    func announceProgress() {
        if mode == .detail, let route = guideRoute, let state = guideState {
            announce(GuideText.progress(
                route: route, state: state,
                destinationLabel: destinationLabel, lastGuidance: lastGuidance
            ))
        } else {
            // 간략: 마지막 거리 통지가 곧 진행 상황이다(별도 수치 재조합 금지).
            announce(lastGuidance ?? appLocalized("guide.noGuidanceYet"))
        }
    }

    /// 상세⇄간략 전환(추적 유지, 스펙 §6). 경로 미보유 세션에선 UI가 버튼을 숨긴다.
    func toggleMode() {
        guard isTracking, guideRoute != nil else { return }
        if mode == .detail {
            mode = .brief
            beaconState = .initial  // first-fix 경로: 절대거리 1회 발화 후 추세
            gateState = .initial
            resolvePendingSince = nil
            let text = appLocalized("guide.toBriefDone")
            statusText = text
            announce(text)
        } else {
            resolvePendingSince = uptimeNow
            let text = appLocalized("guide.resolvePending")
            statusText = text
            announce(text)
        }
    }

    /// 이탈 시 사용자 확인 후에만 재조회(자동 재조회 금지, 스펙 §5.6).
    func requestReroute() {
        guard isTracking, mode == .detail, offRoute, !rerouteInFlight else { return }
        rerouteInFlight = true
        rerouteToken += 1
        let token = rerouteToken
        Task { [weak self] in
            await self?.performReroute(token: token)
        }
    }

    private func performReroute(token: Int) async {
        defer { rerouteInFlight = false }
        guard let dest else { return }
        do {
            let origin = try await LocationService.shared.currentCoordinate()
            guard token == rerouteToken, isTracking, mode == .detail, self.dest == dest else { return }
            let briefing = try await routeService.walk(
                originLat: origin.lat, originLng: origin.lng,
                destLat: dest.lat, destLng: dest.lng,
                includeGeometry: true
            )
            // latest-wins: 왕복 중 중지·전환·목적지 변경이면 도착 응답 폐기(이탈 게이트 동형).
            guard token == rerouteToken, isTracking, mode == .detail, self.dest == dest else { return }
            guard let briefing,
                  let route = buildGuideRoute(briefing.steps.map {
                      GuideStepGeometry(description: $0.description, pathCoords: $0.pathCoords)
                  })
            else {
                announce(appLocalized("guide.rerouteFailed"))
                return
            }
            // 재조회 출발지가 현재 위치이므로 새 경로의 d=0이 곧 현 위치다(전역 재투영 불요).
            guideRoute = route
            let initial = initialGuideState(route: route, now: uptimeNow)
            guideState = initial.state
            offRoute = false
            let text = GuideText.unit(route: route, indices: initial.firstIndices)
            lastGuidance = text
            statusText = text
            announce(text)
        } catch {
            guard token == rerouteToken, isTracking else { return }
            announce(appLocalized("guide.rerouteFailed"))
        }
    }

    /// 오류 코드를 뭉개면 "위치 서비스 꺼짐"과 "일시적 취득 실패"가 한 문구가 된다.
    private func handle(locationError code: CLError.Code) {
        guard isTracking else { return }
        switch code {
        case .denied:
            stop()
            fail(with: .unavailable, key: "beacon.weak")
        case .locationUnknown:
            // Apple이 무시를 권하는 일시 오류. 진짜 끊김은 워치독이 잡는다.
            break
        default:
            noticeStaleIfNeeded(force: true)
        }
    }

    private func handle(authorization status: CLAuthorizationStatus) {
        guard isTracking else { return }
        switch status {
        case .denied, .restricted:
            stop()
            fail(with: .denied, key: "beacon.denied", resolution: .settings)
        default:
            break
        }
    }

    /// 세션 중 "정확한 위치"가 꺼지면 즉시 멈춘다.
    ///
    /// 시작 게이트만으로는 부족하다: 걷는 도중 설정에서 꺼도 추적이 계속되고,
    /// 1~20km 오차 좌표로 "가까워지는 중"을 소리로 안내하게 된다. 사용자가 비콘
    /// 컨트롤을 조작한 게 아니므로 라벨 변화가 신호가 되지 못해 통지가 필요하다.
    private func handle(accuracy: CLAccuracyAuthorization) {
        guard isTracking, accuracy == .reducedAccuracy else { return }
        stop()
        fail(with: .unavailable, key: "beacon.reduced", resolution: .precise)
    }

    // MARK: - 무-fix 감시

    /// `startUpdatingLocation()`에는 타임아웃 개념이 없다. 감시가 없으면 "추적 중인데
    /// 안 움직이는 것"과 "죽은 것"이 구분되지 않는다(시각장애 사용자에겐 치명적).
    private func startWatchdog() {
        watchdog?.cancel()
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                // self가 사라졌으면 루프도 끝내야 한다(무한 웨이크업 방지).
                guard let self else { return }
                guard self.isTracking else { continue }
                self.noticeStaleIfNeeded(force: false)
            }
        }
    }

    private func noticeStaleIfNeeded(force: Bool) {
        let now = ProcessInfo.processInfo.systemUptime
        let reference = lastFixAt ?? startedAt ?? now
        guard force || now - reference >= noFixTimeout else { return }
        if let last = lastStaleNoticeAt, now - last < staleRenotifyInterval { return }
        lastStaleNoticeAt = now
        statusText = appLocalized("beacon.weak")
        announce(statusText)
    }

    // MARK: - 출력

    private func playTone(_ tone: BeaconTone) {
        guard !outputSuppressed else { return }
        tones.play(tone)
        // 톤이 죽으면 hold·tick엔 통지가 없어 사용자가 침묵의 원인을 모른다.
        // GPS 약신호와 **다른 문구**여야 한다. 취해야 할 행동이 다르다.
        if tones.isSilenced {
            let text = appLocalized("ios.beacon.soundUnavailable")
            guard statusText != text else { return }
            statusText = text
            announce(text)
        }
    }

    /// ⚠ 거리 3종은 `formatDistance`(Kit 정본)를 태우고 `nearby`만 원시 미터를 쓴다.
    /// nearby의 값은 거리가 아니라 **오차 반경**이라(문구가 "약 ±N m") 거리 포맷에
    /// 태우면 다음 사람이 두 축을 같은 것으로 읽는다. `maxUsableAccuracy`가 100이라
    /// 결과 문자열은 어차피 같다.
    private func text(for notice: BeaconNotice) -> String {
        switch notice {
        case .first(let meters): appLocalized("beacon.first", formatDistance(meters))
        case .closer(let meters): appLocalized("beacon.closer", formatDistance(meters))
        case .farther(let meters): appLocalized("beacon.farther", formatDistance(meters))
        case .nearby(let accuracyMeters): appLocalized("beacon.nearby", String(accuracyMeters))
        case .weak: appLocalized("beacon.weak")
        }
    }

    private func announce(_ message: String) {
        guard !outputSuppressed else { return }
        AccessibilityNotification.Announcement(spokenUnits(message)).post()
    }
}

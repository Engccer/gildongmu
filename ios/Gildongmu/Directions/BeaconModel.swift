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
/// 백그라운드 계약(spec §12.2, 2026-08-06 — 종전 §8.1 전경 전용을 위원장 결정으로
/// 번복): `UIBackgroundModes: location`이 선언된 빌드(Experimental)는 세션 중
/// 백그라운드에서도 위치 스트림이 계속 흘러 추적이 산다. 미선언 빌드는 종전대로
/// 전경 전용이며, 그 분기는 `LocationService.backgroundLocationDeclared`가 가른다.
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

    /// 안내 방식 = 거리의 기준(스펙 §3). 간략=직선(비콘, 전 수단), 상세=경로 추종.
    enum GuideMode: Equatable { case brief, detail }

    /// 안내 수단(B1 §4.1 봉인 구성 키): 리듀서 튜닝·경로 소스·낭독 문구를 원자
    /// 결정한다. 세션 시작 시 고정되고 중도 변경은 없다(재시작뿐).
    enum GuideSessionKind: Equatable { case walk, car }

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
    private(set) var sessionKind: GuideSessionKind = .walk
    private var tuning: GuideTuning { sessionKind == .car ? .car : .walk }
    /// 상세⇄간략 전환 버튼 노출 조건 — **도보 전용**(B1 §3.3, car의 brief 복귀는
    /// 세션 재시작뿐). 경로는 ko 데이터 로케일에서만 조회되므로 로케일 게이트 겸용.
    var canOfferDetail: Bool { sessionKind == .walk && guideRoute != nil }
    /// 이탈 상태 — 시트가 "경로 다시 조회" 버튼 노출에 쓴다.
    private(set) var offRoute = false
    /// 마지막 실행 안내(상세=스텝·묶음, 간략=거리 통지). 진행 상황 버튼의 uncertain
    /// 분기가 소비한다. 상태·오류 통지는 대상이 아니다(스펙 §4.2 리뷰 #23).
    private(set) var lastGuidance: String?
    /// 경로 기준 잔여 거리·예상 시간 상시 표시 1줄(상세 모드 전용, 웹 progress 미러 —
    /// 위원장 실측 판정 2026-08-03 묶음 A). 통지 채널에 태우지 않는다(매 fix 갱신).
    private(set) var remainingText: String?

    /// 세션이 쥐는 경로. 메모리에만 두고 세션 종료와 함께 폐기한다(스펙 §7.3 약관 경계).
    private var guideRoute: GuideRoute?
    /// 상세 경로의 총 소요시간(초, provider 원값) — walk 잔여 시간 비례 추정의 분모.
    private var guideRouteDurationSeconds: Int?
    /// car 도로명 스팬(§4.7 — 현재 진행거리가 속한 링크만 답한다).
    private var roadSpans: [CarRoadSpan] = []
    /// car ETA(§4.6): 현 위치→목적지 재조회 totalTime + 갱신 시각(단조 초).
    private var etaSeconds: Double?
    private var etaUpdatedAt: Double?
    /// ETA 호출 캡(시작 조회·주기·수동 재조회 전부 포함, §4.6).
    private var etaCallCount = 0
    private var etaTask: Task<Void, Never>?
    private var guideState: GuideState?
    /// 시작 직후 경로 조회 대기·진행 중 — 이 동안 비콘 발화를 보류해 "간략 첫 거리 →
    /// 곧바로 상세 시작" 이중 발화를 막는다. 조회 자체는 첫 수용 fix가 트리거한다
    /// (피드백 라운드1 8번): start() 직후 `currentCoordinate()`는 첫 fix 전이라 캐시
    /// 게이트에서 즉시 실패해 첫 세션의 상세 안내가 구조적으로 죽었다.
    private var awaitingRoute = false
    private var routeFetchTask: Task<Void, Never>?
    /// 첫 수용 fix 대기 상한 감시. 초과 시 상세를 포기하고 간략으로 정직 폴백
    /// (위치 대기 문구 — 경로 실패와 원인이 다르므로 문구를 가른다).
    private var fixWaitTask: Task<Void, Never>?
    /// 억제 중 소비된 실행 안내의 최신 1개(해제 시 복구 발화).
    private var pendingRecovery: String?
    /// 간략→상세 전환 모호 해소 대기 시작 시각(스펙 §6). nil이면 대기 없음.
    private var resolvePendingSince: Double?
    /// 재조회 latest-wins 세대 토큰 + in-flight 가드(repo 관례).
    private var rerouteToken = 0
    private var rerouteInFlight = false
    /// 시작 경로 조회의 세대 토큰. defer가 stale task에서 새 세션의 awaitingRoute를
    /// 조기 해제하는 레이스 차단(독립 리뷰 MEDIUM — 빠른 목적지 변경 시).
    private var routeFetchToken = 0
    /// 마지막 수용 fix 좌표·시각(진행 상황 버튼의 직선거리·신선도 게이트용, 양 모드 기록).
    private var lastFixCoord: (lat: Double, lng: Double)?
    private var lastFixCoordAt: Double?
    /// 재조회 진행 중 — 시트가 버튼 라벨 교체(rerouteBusy)에 쓴다(라벨이 곧 상태 신호).
    private(set) var isRerouting = false
    /// 상세 투영 점프 가드의 기준(직전 잔여 거리·시각). 상세 모드의 오차 원인은 GPS
    /// 정확도가 아니라 **경로 투영의 안정성**이라 별도 축이 필요하다.
    private var lastRemaining: Double?
    private var lastRemainingAt: Double?

    private let routeService = RouteService(client: APIClient(baseURL: AppConfig.apiBaseURL))
    /// 세션 단일성 토큰(B2 §3.2 — GuideSessionCoordinator claim/release 검증 키).
    private var sessionToken: Int?

    private var uptimeNow: Double { ProcessInfo.processInfo.systemUptime }

    private var beaconState = BeaconState.initial
    private var gateState = BeaconGateState.initial
    /// 톤 계층 상태(간략·상세 공용 — 모드 차이는 입력 조립에만 있다).
    private var toneState = ToneLayerState.initial
    /// 정지 판정 상태(도플러 3-state).
    private var motionState = MotionJudgeState.initial
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

    /// 앱이 전경 활성 상태인가. **음성 통지 게이트**(spec §3.1) — 백그라운드에서
    /// 톤은 남기고 발화만 막는다(주기적 음성은 다른 앱 사용을 침해한다).
    ///
    /// ⚠ **플랫폼 동작에 기대지 않고 명시적으로 막는다.** 백그라운드에서
    /// announcement가 발화되지 않는 것은 실측으로 확인했으나 한 차례 실측은 API
    /// 계약이 아니다. OS 버전·VoiceOver 상태에 따라 무시·지연 전달·복귀 후 뒤늦은
    /// 발화가 가능하다. `.inactive`는 사용자가 화면을 보고 있는 중이라 허용한다.
    private var isForeground = true
    /// 백그라운드에서 억제된 발화가 있었는가. 복귀 시 **현재 상태 하나만** 낭독한다 —
    /// 누적 재생은 낡은 정보를 순서대로 읽어 혼란만 준다(spec §6.5).
    private var missedAnnouncement = false

    private let noFixTimeout = 15.0
    private let staleRenotifyInterval = 30.0
    /// fix 부재를 **톤**으로 알리기 시작하는 경과(초). 음성 임계(15초)보다 짧다 —
    /// 톤은 발화를 가로막지 않아 더 자주 울려도 침해가 적고, 백그라운드에서는 이것이
    /// 유일한 채널이다. fix 신선도 창(5초)보다 크게 잡아 정상 지터를 걸러낸다.
    /// 초기값이며 실사용 판정 대상이다.
    private let noFixSeconds = 8.0

    var isTracking: Bool { status == .tracking }

    // MARK: - 시작·중지

    func toggle(dest: BeaconDest, label: String, kind: GuideSessionKind = .walk) {
        if isTracking {
            stop(playStopTone: true)
        } else {
            guard !starting else { return }
            starting = true
            startTask = Task { [weak self] in
                await self?.start(dest: dest, label: label, kind: kind)
                self?.starting = false
            }
        }
    }

    private func start(dest: BeaconDest, label: String, kind: GuideSessionKind = .walk) async {
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

        // 세션 단일성(B2 §3.2): 다른 안내(대중교통 포함)가 돌고 있으면 먼저 멈춘다.
        sessionToken = GuideSessionCoordinator.shared.claim { [weak self] in
            self?.stop()
        }

        self.dest = dest
        destinationLabel = label
        sessionKind = kind
        beaconState = .initial
        gateState = .initial
        toneState = .initial
        motionState = .initial
        lastRemaining = nil
        lastRemainingAt = nil
        lastFixAt = nil
        lastStaleNoticeAt = nil
        suppressNextNotice = false
        startedAt = ProcessInfo.processInfo.systemUptime
        status = .tracking
        statusText = ""
        failResolution = .none
        UIApplication.shared.isIdleTimerDisabled = true
        // 오디오 승격은 **첫 톤보다 먼저**. 승격 실패는 전경에서 보이지 않으므로
        // (`.ambient`로도 start 톤이 난다) 시작 시점에 알려야 잠그기 전에 안다.
        tones.beginSession()
        playTone(.start)
        if tones.isDegraded {
            let text = appLocalized("ios.beacon.soundBackgroundUnavailable")
            statusText = text
            announce(text)
        }

        LocationService.shared.startBeaconUpdates(
            onFix: { [weak self] fix in self?.handle(fix: fix) },
            onError: { [weak self] code in self?.handle(locationError: code) },
            onAuthChange: { [weak self] status in self?.handle(authorization: status) },
            onAccuracyChange: { [weak self] accuracy in self?.handle(accuracy: accuracy) }
        )
        startWatchdog()

        // 상세 적격 시도(스펙 §4.1): ko 데이터 로케일에서만 경로를 조회한다(도보 API
        // V1 ko 전용). 조회 트리거는 첫 수용 fix(handle(fix:))다 — 여기서 바로 띄우면
        // origin 취득이 첫 fix 전이라 항상 실패해 간략 폴백이 고정된다(8번).
        // 대기·조회 중엔 비콘 발화를 보류하고, 실패는 간략으로 정직 폴백.
        if AppLanguage.dataLocale == "ko" {
            awaitingRoute = true
            routeFetchToken += 1
            startFixWaitWatch(token: routeFetchToken)
        }
    }

    /// 첫 수용 fix가 상한(noFixTimeout) 내에 오지 않으면 상세를 포기하고 간략 폴백.
    /// 없으면 awaitingRoute가 발화를 무한 보류해 세션이 침묵에 갇힌다.
    private func startFixWaitWatch(token: Int) {
        fixWaitTask?.cancel()
        fixWaitTask = Task { [weak self, timeout = noFixTimeout] in
            try? await Task.sleep(for: .seconds(timeout))
            guard let self, !Task.isCancelled else { return }
            guard token == self.routeFetchToken, self.isTracking,
                  self.awaitingRoute, self.routeFetchTask == nil else { return }
            self.awaitingRoute = false
            self.fallbackToBrief(key: "guide.detailNoLocation")
            // 위치 부재는 이 문구가 이미 말했다 — 워치독 약신호 통지가 같은 시점에
            // 겹치지 않게 재통지 창(30초)을 소비한다.
            self.lastStaleNoticeAt = self.uptimeNow
        }
    }

    /// 수단별 상세 경로 데이터(§4.1 봉인 구성의 경로 소스 축). nil = 상세 부적격
    /// (car는 provider 비-tmap·기하 검증 실패 포함 — §5 fail-closed).
    private func fetchDetailData(
        origin: (lat: Double, lng: Double), dest: BeaconDest
    ) async throws -> (route: GuideRoute, spans: [CarRoadSpan], durationSeconds: Int?)? {
        if sessionKind == .car {
            let briefing = try await routeService.car(
                originLat: origin.lat, originLng: origin.lng,
                destLat: dest.lat, destLng: dest.lng,
                includeGeometry: true
            )
            guard briefing.provider == "tmap", let car = buildCarGuide(briefing: briefing) else {
                return nil
            }
            return (car.route, car.roadSpans, briefing.durationSeconds)
        }
        let briefing = try await routeService.walk(
            originLat: origin.lat, originLng: origin.lng,
            destLat: dest.lat, destLng: dest.lng,
            includeGeometry: true
        )
        guard let briefing,
              let route = buildGuideRoute(briefing.steps.map {
                  GuideStepGeometry(description: $0.description, pathCoords: $0.pathCoords)
              })
        else { return nil }
        return (route, [], briefing.durationSeconds)
    }

    /// 상세 경로 조회 — 첫 수용 fix가 트리거하고 그 좌표가 origin이다(8번: 위치
    /// 재조회 의존 제거). 성공하면 상세 모드 + 원자 시작 발화, 실패는 간략 폴백.
    /// "이 세션에서 현재 목적지에 대해 조회"가 곧 상세 적격 조건이다(스펙 §4.1).
    private func fetchGuideRoute(
        origin: (lat: Double, lng: Double), dest: BeaconDest, token: Int
    ) async {
        // defer는 다른 가드를 거치지 않으므로 세대 토큰으로 자기 세션에만 작용시킨다.
        // 없으면 stale task의 defer가 새 세션의 awaitingRoute를 조기 해제해 이중 발화
        // 방지(§4.1)가 깨진다(독립 리뷰 MEDIUM).
        defer { if token == routeFetchToken { awaitingRoute = false } }
        do {
            let fetched = try await fetchDetailData(origin: origin, dest: dest)
            guard !Task.isCancelled, isTracking, self.dest == dest else { return }
            guard let fetched else {
                fallbackToBrief()
                return
            }
            guideRoute = fetched.route
            guideRouteDurationSeconds = fetched.durationSeconds
            roadSpans = fetched.spans
            if sessionKind == .car {
                // 시작 조회가 ETA 1회차(§4.6 캡 포함), 주기 타이머 가동.
                etaCallCount = 1
                if let dur = fetched.durationSeconds, dur > 0 {
                    etaSeconds = Double(dur)
                    etaUpdatedAt = uptimeNow
                } else {
                    etaSeconds = nil
                    etaUpdatedAt = nil
                }
                startEtaTimer()
            }
            let initial = initialGuideState(route: fetched.route, now: uptimeNow)
            guideState = initial.state
            mode = .detail
            offRoute = false
            updateRemaining(route: fetched.route, state: initial.state)
            // 시작 요약 + 첫 안내를 한 문장으로(원자 발화 — 두 통지의 경합 제거).
            let text = sessionKind == .car
                ? GuideText.carStart(route: fetched.route, firstIndices: initial.firstIndices)
                : GuideText.start(route: fetched.route, firstIndices: initial.firstIndices)
            lastGuidance = GuideText.unit(route: fetched.route, indices: initial.firstIndices)
            statusText = text
            announce(text)
        } catch {
            guard !Task.isCancelled, isTracking else { return }
            fallbackToBrief()
        }
    }

    /// car ETA 주기 갱신 타이머(§4.6 — 10분). 캡 소진·간략 전환 시 자연 무동작.
    private func startEtaTimer() {
        etaTask?.cancel()
        etaTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(600))
                guard let self else { return }
                guard !Task.isCancelled else { return }
                await self.refreshCarEta()
            }
        }
    }

    private func refreshCarEta() async {
        guard sessionKind == .car, isTracking, mode == .detail else { return }
        guard etaCallCount < 6 else { return }
        // 이탈 중 동결(§4.4): 낡은 경로 기준 ETA 갱신은 거짓이라 건너뛴다.
        guard guideState?.phase != .offRoute else { return }
        guard let dest else { return }
        etaCallCount += 1
        let token = routeFetchToken
        do {
            let origin = try await LocationService.shared.currentCoordinate()
            let briefing = try await routeService.car(
                originLat: origin.lat, originLng: origin.lng,
                destLat: dest.lat, destLng: dest.lng
            )
            // 세대 일치 커밋(§4.6) — 중지·재조회·목적지 변경 후 도착 응답 폐기.
            guard token == routeFetchToken, isTracking, mode == .detail, self.dest == dest,
                  briefing.durationSeconds > 0
            else { return }
            etaSeconds = Double(briefing.durationSeconds)
            etaUpdatedAt = uptimeNow
            if let route = guideRoute, let state = guideState {
                updateRemaining(route: route, state: state)
            }
        } catch {
            // 조용히 직전 값 유지 — stale 판정은 etaUpdatedAt이 담당(§4.6 3-state).
        }
    }

    /// 상세 불가 시 간략 폴백(조용한 강등 금지 — 통지가 모드를 말한다, 스펙 §4.1).
    /// 문구는 원인별로 가른다(8번): 경로 실패(기본)와 위치 대기 실패는 사용자가 취할
    /// 행동이 다르다(잠시 후 전환 재시도 vs 하늘 트인 곳으로 이동).
    private func fallbackToBrief(key: String = "guide.detailUnavailable") {
        mode = .brief
        remainingText = nil
        let text = appLocalized(key)
        statusText = text
        announce(text)
    }

    /// 경로 기준 잔여 거리·예상 시간 갱신(웹 `progressOf` 미러). walk는 provider
    /// 총 소요시간의 잔여 비례 축소, car는 재조회 ETA의 경과 차감 카운트다운(§4.6 —
    /// 비례 축소는 정체 국소성에 취약해 폐기). 근거 없으면 시간 생략(날조 금지).
    private func updateRemaining(route: GuideRoute, state: GuideState) {
        let remaining = max(0, route.totalMeters - state.d)
        let distancePart = appLocalized(
            "guide.remainingDistance", formatDistance(Int(remaining.rounded()))
        )
        var timePart: String?
        if sessionKind == .car {
            if let eta = etaSeconds, let at = etaUpdatedAt {
                let left = max(0, eta - (uptimeNow - at))
                let minutes = max(1, Int((left / 60).rounded()))
                timePart = appLocalized("guide.remainingTime", String(minutes))
            }
        } else if let dur = guideRouteDurationSeconds, dur > 0, route.totalMeters > 0 {
            let minutes = max(1, Int((Double(dur) * remaining / route.totalMeters / 60).rounded()))
            timePart = appLocalized("guide.remainingTime", String(minutes))
        }
        remainingText = joinText(distancePart, timePart)
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
        if let token = sessionToken {
            sessionToken = nil
            GuideSessionCoordinator.shared.release(token)
        }
        startTask?.cancel()
        startTask = nil
        starting = false
        UIApplication.shared.isIdleTimerDisabled = false
        watchdog?.cancel()
        watchdog = nil
        LocationService.shared.stopBeaconUpdates()
        if playStopTone && status == .tracking { playTone(.stop) }
        // 원복은 정지 톤 **뒤에**. 먼저 원복하면 그 톤이 `.ambient`로 나가 잠금
        // 상태에서 들리지 않는다(세션 종료를 소리로 확인할 수 없게 된다).
        tones.endSession()
        if status == .tracking { status = .idle }
        statusText = ""
        failResolution = .none
        beaconState = .initial
        gateState = .initial
        toneState = .initial
        motionState = .initial
        dest = nil
        // 세션 종료 = 경로 폐기(스펙 §7.3 약관 경계: 메모리 한정·세션 간 재사용 금지).
        routeFetchTask?.cancel()
        routeFetchTask = nil
        fixWaitTask?.cancel()
        fixWaitTask = nil
        awaitingRoute = false
        mode = .brief
        sessionKind = .walk
        guideRoute = nil
        guideRouteDurationSeconds = nil
        guideState = nil
        lastGuidance = nil
        remainingText = nil
        offRoute = false
        roadSpans = []
        etaSeconds = nil
        etaUpdatedAt = nil
        etaCallCount = 0
        etaTask?.cancel()
        etaTask = nil
        pendingRecovery = nil
        resolvePendingSince = nil
        lastFixCoord = nil
        lastFixCoordAt = nil
        lastRemaining = nil
        lastRemainingAt = nil
        isRerouting = false
        rerouteToken += 1  // in-flight 재조회 응답 폐기(latest-wins)
        routeFetchToken += 1  // stale 경로 조회 defer 무효화
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

    // MARK: - 앱 생명주기

    func handleScenePhaseChange(to phase: ScenePhase) {
        switch phase {
        case .background:
            isForeground = false
            wasBackgrounded = true
            UIApplication.shared.isIdleTimerDisabled = false
        case .inactive:
            // 제어센터·알림 센터·전화 수신 화면. 사용자가 화면을 보고 있는 중이라
            // 발화를 막지 않는다(백그라운드와 다른 축이다).
            isForeground = true
        case .active:
            isForeground = true
            guard isTracking else { return }
            UIApplication.shared.isIdleTimerDisabled = true
            // 억제된 동안 상태가 여러 번 바뀌었을 수 있다 — 누적 재생 대신 현재
            // 상태 하나를 낭독한다(spec §6.5 재동기화).
            if missedAnnouncement {
                missedAnnouncement = false
                if !statusText.isEmpty { announce(statusText) }
            }
            // `.background`를 거친 복귀에서만 앵커를 버린다. 제어센터를 잠깐 여는
            // `.inactive` 왕복까지 리셋하면 추세가 계속 초기화되고 절대거리가 재발화된다.
            guard wasBackgrounded else { return }
            wasBackgrounded = false
            // 백그라운드 위치가 선언된 빌드는 공백이 없다 — 스트림이 계속 흘러 상태가
            // 이미 최신이므로, 리셋하면 사용자가 화면을 확인하는 순간 누적 추세
            // (가까워지는 중/멀어지는 중)를 오히려 버린다(독립 리뷰 MAJOR). 이 리셋은
            // "백그라운드 동안 fix가 안 온다"는 전경 전용 전제의 산물이라 미선언
            // 빌드에만 남긴다. 선언 빌드의 fix 공백은 워치독 약신호 채널이 잡는다.
            guard !LocationService.backgroundLocationDeclared else { return }
            beaconState = .initial
            gateState = .initial
            lastFixAt = nil
            startedAt = ProcessInfo.processInfo.systemUptime
            suppressNextNotice = true
        default:
            break
        }
    }

    // MARK: - 톤 계층 배선 (판정은 전부 Kit — 여기는 입력 조립뿐)

    /// 수단별 물리 상한(정지 판정 폴백의 산출 속도 가드 + 투영 점프 가드).
    private var maxSpeedMps: Double {
        sessionKind == .car ? MotionConstants.maxCarSpeedMps : MotionConstants.maxWalkSpeedMps
    }

    /// 수단별 closer 최소 간격. 차량은 데드밴드를 매 fix 넘어 2초 창에 매번 걸린다
    /// (30분 주행에 약 900회).
    private var closerIntervalSeconds: Double {
        sessionKind == .car
            ? ToneLayerConstants.carCloserIntervalSeconds
            : ToneLayerConstants.walkCloserIntervalSeconds
    }

    /// 이 fix의 이동 상태(양 모드 공용). **모든 fix에서 호출한다** — 거리 미분 폴백이
    /// 직전 표본을 쓰므로 건너뛰면 폴백 기준이 낡는다.
    private func judgeMotion(fix: LocationService.BeaconFixPayload, now: Double) -> MotionState {
        let out = motionStep(
            state: motionState,
            sample: MotionSample(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, at: now),
            speed: fix.speed,
            speedAccuracy: fix.speedAccuracy,
            maxSpeedMps: maxSpeedMps
        )
        motionState = out.state
        return out.motion
    }

    /// 톤 계층 통과 + 재생. 계층 순서·간격·재기준화는 Kit이 소유한다.
    private func routeTone(_ input: ToneLayerInput, now: Double) {
        let out = toneLayerStep(state: toneState, input: input, now: now)
        toneState = out.state
        if let tone = out.tone { playTone(tone) }
    }

    /// 직전 fix 대비 잔여 거리 변화가 물리적으로 불가능하면 그 fix의 추세 판정을 버린다.
    ///
    /// **상세 모드의 오차 원인은 GPS 정확도가 아니라 경로 투영의 안정성이다**:
    /// accuracy 5m라도 평행 도로로 투영이 점프하면 잔여 거리가 100m 튀고, accuracy
    /// 40m라도 투영이 안정적이면 잔여 거리는 매끄럽다. 그래서 데드밴드를 정확도로
    /// 스케일하지 않고(간략과 다른 점) 점프한 fix를 통째로 버린다.
    private func projectionJumped(remaining: Double, now: Double) -> Bool {
        defer {
            lastRemaining = remaining
            lastRemainingAt = now
        }
        guard let prev = lastRemaining, let at = lastRemainingAt else { return false }
        let dt = now - at
        guard dt > 0 else { return true }
        // 여유 계수 1.5 — 속도 상한 자체가 보수적이라 이중으로 좁히지 않는다.
        return abs(remaining - prev) > maxSpeedMps * dt * 1.5
    }

    // MARK: - fix 처리

    private func handle(fix: LocationService.BeaconFixPayload) {
        guard isTracking, let dest else { return }
        let now = uptimeNow
        // 모든 fix에서 갱신한다(폴백이 직전 표본을 쓴다).
        let motion = judgeMotion(fix: fix, now: now)

        // 경로 조회 대기·진행 중엔 발화를 보류한다(간략 첫 거리 → 곧바로 상세 시작의
        // 이중 발화 차단). 첫 수용 fix가 조회 트리거이자 origin이다(8번).
        if awaitingRoute {
            lastFixAt = now
            let age = Date().timeIntervalSince(fix.timestamp)
            if routeFetchTask == nil, isUsableFix(accuracy: fix.accuracy, ageSeconds: age) {
                fixWaitTask?.cancel()
                fixWaitTask = nil
                let token = routeFetchToken
                let origin = (lat: fix.lat, lng: fix.lng)
                routeFetchTask = Task { [weak self] in
                    await self?.fetchGuideRoute(origin: origin, dest: dest, token: token)
                }
            }
            return
        }
        if mode == .detail, let route = guideRoute {
            handleDetail(fix: fix, route: route, motion: motion, now: now)
            return
        }
        // 간략 경로 위에서의 상세 전환 모호 해소 시도(스펙 §6). 성공하면 이번 fix 소비.
        if resolveDetailIfPending(fix: fix) { return }

        // 캐시 위치와 무효 좌표는 앵커에서 배제한다(판정은 Kit 순수 함수). ⚠ 종전에는
        // 여기서 조용히 버렸는데, 그 침묵도 커버리지 대상이다 — 워치독(8초)이 잡기
        // 전까지의 공백을 신뢰 불가 톤이 메운다.
        let age = Date().timeIntervalSince(fix.timestamp)
        guard isUsableFix(accuracy: fix.accuracy, ageSeconds: age) else {
            routeTone(
                ToneLayerInput(unreliable: true, arrived: beaconState.nearby), now: now
            )
            return
        }

        lastFixAt = now
        lastStaleNoticeAt = nil
        lastFixCoord = (fix.lat, fix.lng)
        lastFixCoordAt = now

        let stepped = beaconStep(
            state: beaconState,
            fix: BeaconFix(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy),
            dest: dest
        )
        beaconState = stepped.state

        let gated = beaconGateStep(state: gateState, announce: stepped.announce)
        gateState = gated.state

        // 톤 계층 입력 조립(간략 3단계: 신뢰 불가 → 도착 → 추세).
        let weak = stepped.announce.kind == .weak
        routeTone(
            ToneLayerInput(
                unreliable: weak,
                priorityTone: gated.nearbyTone ? .nearby : nil,
                trend: weak
                    ? nil
                    : TrendInput(
                        distance: stepped.announce.distance,
                        deadBand: max(BeaconConstants.baseDeadBand, fix.accuracy),
                        motion: motion,
                        closerIntervalSeconds: closerIntervalSeconds
                    ),
                arrived: beaconState.nearby
            ),
            now: now
        )
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

    private func handleDetail(
        fix: LocationService.BeaconFixPayload, route: GuideRoute, motion: MotionState, now: Double
    ) {
        guard let state = guideState else { return }
        // 캐시 fix만 거른다. 정확도 악화(50m 초과)는 버리지 않고 리듀서에 넘긴다 —
        // uncertain 전이(진입·회복 1회 통지)가 그 정보의 소비자다(스펙 §5.0).
        let age = Date().timeIntervalSince(fix.timestamp)
        guard fix.accuracy > 0, age <= 10 else {
            // stale fix 폐기는 `lastFixAt`을 갱신하지 않으므로 워치독도 잡지만,
            // 발동(8초)까지의 공백을 여기서 메운다.
            routeTone(ToneLayerInput(unreliable: true), now: now)
            return
        }

        lastFixAt = now
        lastStaleNoticeAt = nil
        lastFixCoord = (fix.lat, fix.lng)
        lastFixCoordAt = now

        let out = guideStep(
            state: state,
            fix: GuideFix(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy),
            route: route,
            now: now,
            tuning: tuning
        )
        guideState = out.state
        updateRemaining(route: route, state: out.state)

        // 톤 계층 입력 조립(상세 4단계). ⚠ 종전의 "무이벤트 fix마다 3초 tick 하트비트"는
        // 폐기됐다 — 같은 소리가 간략에서는 정체를 뜻해 한 소리에 두 뜻이 있었다.
        // 그 자리를 추세 축이 대신하므로 별도 중재가 필요 없다.
        let phase = out.state.phase
        let remaining = max(0, route.totalMeters - out.state.d)
        let jumped = projectionJumped(remaining: remaining, now: now)
        // 추세 축은 정상 추종에서만 유효하다. 이탈 중 잔여 거리는 낡은 투영이라
        // 추세로 읽으면 거짓이고, 투영이 튄 fix도 버린다.
        let trendable = (phase == .following || phase == .bundle) && !jumped
        routeTone(
            ToneLayerInput(
                unreliable: phase == .uncertain || phase == .reacquiring,
                priorityTone: out.tone.map { $0 == .ahead ? .ahead : .warning },
                eventOwned: out.event != nil,
                trend: trendable
                    ? TrendInput(
                        distance: remaining,
                        deadBand: BeaconConstants.baseDeadBand,
                        motion: motion,
                        closerIntervalSeconds: closerIntervalSeconds
                    )
                    : nil
            ),
            now: now
        )
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
        case let .farNotice(indices, remainingMeters):
            // 원거리 예고(B1 §4.7) — 크로싱 시점 실측 잔여를 낭독(상수 금지, 리뷰 반영).
            // 실행 안내와 같은 취급(억제 복구 대상).
            let text = GuideText.farNotice(
                route: route, indices: indices, remainingMeters: remainingMeters
            )
            lastGuidance = text
            statusText = text
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
            remainingText = nil
            etaTask?.cancel() // 간략 전환 후 ETA 재조회 무의미(자원 위생 — 리뷰 반영)
            etaTask = nil
            rebaseForAxisChange()
            let text = appLocalized("guide.handoff")
            statusText = text
            announce(text)
        case .offRoute:
            offRoute = true
            // 차량 이탈 문구는 상태 전문(B1 §4.3 — 첫 통지를 놓쳐도 반복만으로 완결).
            let text = appLocalized(
                sessionKind == .car ? "guide.carOffRoute" : "guide.offRoute"
            )
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
            statusText = appLocalized("guide.speedSuggest")
            announce(statusText)
        }
    }

    /// 거리 축이 바뀔 때(상세 경로 거리 ⇄ 간략 직선거리)의 재기준화.
    ///
    /// 값이 **불연속으로** 줄어든다(경로 500m가 직선 120m가 되는 식). 추세 방향만
    /// 승계하고 `anchorDistance`와 `lastSpokenDistance`를 **둘 다** 새 축의 현재값으로
    /// 재설정한다. ⚠ `lastSpokenDistance`를 옛 축 값으로 두면 차이 380m가 즉시
    /// 마일스톤을 넘겨 **전환 직후 거짓 closer 음성**이 나가고, 반대 방향 전환에서는
    /// 필요한 음성이 장기 억제된다.
    ///
    /// 새 축의 현재값을 모르면(낡은 fix) nil로 두는 것이 정직한 폴백이다 — 다음 fix가
    /// first 경로를 타서 절대거리를 1회 발화하고 다시 추세를 잡는다.
    private func rebaseForAxisChange() {
        beaconState = rebaseBeaconState(beaconState, distance: freshStraightLineMeters())
        gateState = .initial
        // 톤 축도 같은 규칙 — 다음 추세 fix가 재기준화 후 현재 상태를 1회 알린다.
        toneState.needsRebase = true
        lastRemaining = nil
        lastRemainingAt = nil
    }

    /// 간략→상세 전환의 모호 해소(스펙 §6): 후속 fix들로 전역 후보가 하나로 좁혀지면
    /// 전환을 완료한다. 반환 true면 이번 fix를 전환 처리로 소비했다는 뜻.
    private func resolveDetailIfPending(fix: LocationService.BeaconFixPayload) -> Bool {
        guard let since = resolvePendingSince, let route = guideRoute else { return false }
        guard fix.accuracy > 0 else { return false }
        let now = uptimeNow
        let gfix = GuideFix(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy)
        if case let .ok(d) = entryProjection(route: route, fix: gfix, tuning: tuning) {
            resolvePendingSince = nil
            // 수동 복귀는 자동 인계 재무장 전(armed=false)으로 시작한다(전환 루프 차단).
            let state = guideStateAt(route: route, d: d, now: now, autoHandoffArmed: false)
            guideState = state
            mode = .detail
            offRoute = false
            // 직선거리 → 경로 거리로 축이 바뀐다(handoff의 반대 방향, 같은 규칙).
            toneState.needsRebase = true
            lastRemaining = nil
            lastRemainingAt = nil
            updateRemaining(route: route, state: state)
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

    /// 낡은 fix로는 직선거리를 단정하지 않는다(3-state — 웹 PROGRESS_FIX_MAX_AGE_S 미러).
    private func freshStraightLineMeters() -> Double? {
        guard let c = lastFixCoord, let at = lastFixCoordAt, let dest,
              uptimeNow - at <= 15
        else { return nil }
        return haversineMeters(lat1: c.lat, lng1: c.lng, lat2: dest.lat, lng2: dest.lng)
    }

    func announceProgress() {
        let text: String
        if mode == .detail, let route = guideRoute, let state = guideState {
            // 이탈 상태의 직선거리(스펙 §4.2): 마지막 fix→목적지. 경로 잔여는 이탈 중 거짓.
            let straight = state.phase == .offRoute ? freshStraightLineMeters() : nil
            let base = GuideText.progress(
                route: route, state: state,
                destinationLabel: destinationLabel, lastGuidance: lastGuidance,
                straightLineMeters: straight
            )
            if sessionKind == .car, state.phase == .following || state.phase == .bundle {
                // car(§4.7): 현재 링크 도로명 + 진행 + ETA 오래됨 병기(3-state).
                let road = roadNameAt(spans: roadSpans, d: state.d)
                let etaAge = etaUpdatedAt.map { uptimeNow - $0 }
                text = joinText(
                    road.map { appLocalized("guide.carRoadNow", $0) },
                    base,
                    (etaAge ?? 0) > 660
                        ? appLocalized("guide.etaStale", String(Int(((etaAge ?? 0) / 60).rounded())))
                        : nil
                )
            } else {
                text = base
            }
        } else if let straight = freshStraightLineMeters() {
            // 간략: 목적지 직선거리 하나(웹과 동일 문구 — 반복 버튼과 역할이 갈라진다).
            text = appLocalized("beacon.first", formatDistance(Int(straight.rounded())))
        } else {
            text = lastGuidance ?? appLocalized("guide.noGuidanceYet")
        }
        statusText = text  // 비-VO 사용자에게도 보여야 한다(2.1(a) 계약)
        announce(text, highPriority: true)
    }

    /// 상세⇄간략 전환(추적 유지, 스펙 §6). **도보 전용**(B1 §3.3) — 경로 미보유
    /// 세션과 car 세션에선 UI가 버튼을 숨기고 여기서도 이중 방어한다.
    func toggleMode() {
        guard sessionKind == .walk, isTracking, guideRoute != nil else { return }
        if mode == .detail {
            mode = .brief
            remainingText = nil
            rebaseForAxisChange()  // 경로 거리 → 직선거리(handoff와 같은 규칙)
            resolvePendingSince = nil
            let text = appLocalized("guide.toBriefDone")
            statusText = text
            announce(text, highPriority: true)
        } else {
            resolvePendingSince = uptimeNow
            let text = appLocalized("guide.resolvePending")
            statusText = text
            announce(text, highPriority: true)
        }
    }

    /// 이탈 시 사용자 확인 후에만 재조회(자동 재조회 금지, 스펙 §5.6).
    func requestReroute() {
        guard isTracking, mode == .detail, offRoute, !rerouteInFlight else { return }
        rerouteInFlight = true
        isRerouting = true
        rerouteToken += 1
        let token = rerouteToken
        Task { [weak self] in
            await self?.performReroute(token: token)
        }
    }

    private func performReroute(token: Int) async {
        defer {
            rerouteInFlight = false
            isRerouting = false
        }
        guard let dest else { return }
        do {
            let origin = try await LocationService.shared.currentCoordinate()
            guard token == rerouteToken, isTracking, mode == .detail, self.dest == dest else { return }
            let fetched = try await fetchDetailData(origin: origin, dest: dest)
            // latest-wins: 왕복 중 중지·전환·목적지 변경이면 도착 응답 폐기(이탈 게이트 동형).
            guard token == rerouteToken, isTracking, mode == .detail, self.dest == dest else { return }
            guard let fetched else {
                statusText = appLocalized("guide.rerouteFailed")
                announce(statusText, highPriority: true)
                return
            }
            // 재조회 출발지가 현재 위치이므로 새 경로의 d=0이 곧 현 위치다(전역 재투영 불요).
            guideRoute = fetched.route
            guideRouteDurationSeconds = fetched.durationSeconds
            roadSpans = fetched.spans
            if sessionKind == .car {
                // 수동 재조회도 ETA 캡에 포함(§4.6) + 새 경로 기준 원자 교체.
                etaCallCount = min(6, etaCallCount + 1)
                if let dur = fetched.durationSeconds, dur > 0 {
                    etaSeconds = Double(dur)
                    etaUpdatedAt = uptimeNow
                }
            }
            let initial = initialGuideState(route: fetched.route, now: uptimeNow)
            guideState = initial.state
            offRoute = false
            updateRemaining(route: fetched.route, state: initial.state)
            let text = GuideText.unit(route: fetched.route, indices: initial.firstIndices)
            lastGuidance = text
            statusText = text
            announce(text)
        } catch {
            guard token == rerouteToken, isTracking else { return }
            statusText = appLocalized("guide.rerouteFailed")
            announce(statusText, highPriority: true)
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
                // 주기는 톤 임계(8초)에 맞춰 좁혔다 — 5초 주기면 최대 5초 늦게 울린다.
                try? await Task.sleep(for: .seconds(2))
                // self가 사라졌으면 루프도 끝내야 한다(무한 웨이크업 방지).
                guard let self else { return }
                guard self.isTracking else { continue }
                self.tickWatchdog()
            }
        }
    }

    /// **타이머 구동**이지 fix 구동이 아니다. fix가 안 와도 돈다는 것이 요점이다 —
    /// 권한 철회·위치 서비스 중단·Core Location 정지면 `weak`·`uncertain` 판정 경로
    /// 자체가 실행되지 않아, 톤을 fix 처리에만 걸면 **마지막 정상 톤 이후 영구 침묵**이
    /// 된다. 백그라운드에서는 톤이 유일한 채널이라 이 침묵이 곧 무고장 판정이 된다.
    private func tickWatchdog() {
        let now = uptimeNow
        // 세션 시작 후 첫 fix 대기도 같은 타이머가 덮는다(기준을 시작 시각으로).
        let reference = lastFixAt ?? startedAt ?? now
        if now - reference >= noFixSeconds {
            routeTone(ToneLayerInput(unreliable: true), now: now)
        }
        // 음성 통지는 별도 축이다(15초 임계·30초 재통지·원인 구분). 톤은 추가 채널이지
        // 대체가 아니다.
        noticeStaleIfNeeded(force: false)
    }

    private func noticeStaleIfNeeded(force: Bool) {
        // 첫 fix 대기 창에선 fixWaitTask가 단일 권위 신호다(8번): 같은 15초에 워치독
        // "신호 약함"과 "위치 미확인 폴백"이 연달아 발화하는 이중 통지를 막는다.
        guard !awaitingRoute else { return }
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

    /// 통지 단일 경로(spokenUnits 경유). 버튼 활성화의 **직접 응답**만 `.high`로 —
    /// 기본 우선순위 통지는 VO 활성화 처리에 잠식되어 무발화될 수 있다(헌장 §5,
    /// HoldDictationButton 선례). 자동 통지는 기본 유지(비요청 interrupt 금지).
    private func announce(_ message: String, highPriority: Bool = false) {
        guard !outputSuppressed else { return }
        // 백그라운드에서는 **발화만** 막는다. `statusText`·`lastGuidance`는 호출부가
        // 이미 갱신했으므로 복귀 시 화면이 최신이다(상태 갱신과 발화의 분리).
        guard isForeground else {
            missedAnnouncement = true
            return
        }
        var attributed = AttributedString(spokenUnits(message))
        if highPriority { attributed.accessibilitySpeechAnnouncementPriority = .high }
        AccessibilityNotification.Announcement(attributed).post()
    }
}

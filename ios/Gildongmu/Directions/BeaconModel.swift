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
    /// 잠금·백그라운드에서 소리가 나지 않는 상태. 세션 내내 참일 수 있는 지속 상태라
    /// `statusText`(단일 슬롯, 곧 다음 안내가 덮는다)와 별도 행으로 낸다 — 음성 1회는
    /// 놓치면 끝이고, 비-VO 사용자에게는 이것이 잠금 후 무음의 유일한 단서다.
    ///
    /// ⚠ 판정 축이 "승격에 실패했는가"가 아니라 **"지금 들리는가"**다: 억제 중 시작해
    /// 승격이 미뤄진 세션은 실패한 적이 없어도 `.ambient`로 돌고 있다(접근성 감사 M3).
    private(set) var soundDegraded = false
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

    /// 앱이 전경인가. **음성 통지 게이트**(spec §3.1) — 백그라운드에서 톤은 남기고
    /// 발화만 막는다(주기적 음성은 다른 앱 사용을 침해한다).
    ///
    /// ⚠ **플랫폼 동작에 기대지 않고 명시적으로 막는다.** 백그라운드에서
    /// announcement가 발화되지 않는 것은 실측으로 확인했으나 한 차례 실측은 API
    /// 계약이 아니다. OS 버전·VoiceOver 상태에 따라 무시·지연 전달·복귀 후 뒤늦은
    /// 발화가 가능하다.
    ///
    /// ⚠ **캐시 플래그가 아니라 게시 시점 조회다**(접근성 감사 2026-08-08). 이 게이트는
    /// 이제 모든 발화를 좌우하므로, `scenePhase` 전이를 한 번 놓치면 전경에서도 음성이
    /// 영구 소실된다(톤은 계속 나서 고장으로도 안 읽힌다). 실제 상태를 읽으면 그 고착이
    /// 구조적으로 불가능해진다. `.inactive`(제어센터·알림 센터)는 사용자가 화면을 보고
    /// 있는 중이라 허용한다.
    private var isForeground: Bool {
        UIApplication.shared.applicationState != .background
    }
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

    /// 이 세션의 계단 회피(도보 전용). `toggle`이 시작 시점 값을 받아 보관한다.
    private var accessible = false
    /// 직전 계단 회피 판정(열화 전이 통지 기준 — spec 2026-08-08 §2.3).
    /// 원시 문자열이다: 알려진 셋 밖의 값도 중복 통지를 막는 식별자로 쓴다.
    private var lastStepFree: String?
    /// 발화되지 못한 계단 회피 경고(백그라운드 게이트에 걸린 것).
    /// ⚠ 진행 안내와 달리 **세션에 1회뿐인 안전 경고**라 다음 fix가 대신 말해 주지
    /// 않는다. `missedAnnouncement` 복귀 재생은 그 시점의 `statusText` 하나만 읽는데
    /// 그 사이 도착한 fix가 그것을 실행 안내로 덮어써, 경고가 통째로 사라진다
    /// (a11y 리뷰 H1). 전달될 때까지 여기 남겨 두고 전경 복귀 때 갚는다.
    private var pendingStepFreeNotice: String?

    // MARK: - 최종 접근 (spec 2026-08-08 §3.0·§3.4)

    /// 최종 접근 활성 여부. **이 동안 거리·방향·도착 발화의 소유자는 이 층 하나뿐이다**
    /// — 경로 리듀서는 진입 즉시 판정을 멈추고(Kit 0a 가드), 비콘 리듀서는 아예 돌리지
    /// 않는다. "근처"와 "18미터"가 같은 fix에서 연달아 나가는 경로를 구조적으로 없앤다.
    private(set) var inFinalApproach = false
    /// 세션이 쥔 종점 오프셋 기하. 재조회 시 통째로 교체한다(새 경로는 새 종점이다).
    private var finalApproachGeometry: FinalApproachPayload?
    /// 진입 배치 서술을 냈는가. 1회뿐이라 주기 통지와 별도로 센다.
    private var finalApproachIntroSpoken = false
    /// 발화되지 못한 진입 배치 서술(백그라운드 게이트에 걸린 것).
    /// ⚠ 1회뿐인 발화라 다음 주기가 대신 말해 주지 않는다(`pendingStepFreeNotice` 선례).
    private var pendingFinalApproachIntro: String?
    /// 마지막 주기 통지 시각(단조). 신뢰 불가 fix에서는 갱신하지 않고 정지·유지한다.
    private var lastFinalTickAt: Double?

    var isTracking: Bool { status == .tracking }

    // MARK: - 시작·중지

    /// ⚠ `accessible`에 **기본값을 두지 않는다** — 백로그 A4는 생략 가능한 안전
    /// 인자가 만든 결함이었다(spec 2026-08-08 §2.5). 계단 회피 개념이 없는 수단은
    /// 호출부가 `false`를 적고, 그 사실이 코드에 드러나는 것이 이 required의 목적이다.
    func toggle(
        dest: BeaconDest, label: String, kind: GuideSessionKind = .walk, accessible: Bool
    ) {
        if isTracking {
            stop(playStopTone: true)
        } else {
            guard !starting else { return }
            starting = true
            // 세션 시작 시점 값이 세션 내내 유효하다 — 추적 중에는 시트가 화면을
            // 덮어 토글에 물리적으로 도달할 수 없다(spec §2.2).
            self.accessible = accessible
            lastStepFree = nil
            pendingStepFreeNotice = nil
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
        if soundDegraded {
            // 음성으로 1회 알리고, 지속 상태는 `soundDegraded` 행이 계속 든다.
            announce(appLocalized("ios.beacon.soundBackgroundUnavailable"))
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
    ) async throws -> (
        route: GuideRoute, spans: [CarRoadSpan], durationSeconds: Int?,
        stepFreeRaw: String?, stepFree: StepFreeStatus?, stepFreeNotice: String?,
        finalApproach: FinalApproachPayload?
    )? {
        if sessionKind == .car {
            let briefing = try await routeService.car(
                originLat: origin.lat, originLng: origin.lng,
                destLat: dest.lat, destLng: dest.lng,
                includeGeometry: true
            )
            guard briefing.provider == "tmap", let car = buildCarGuide(briefing: briefing) else {
                return nil
            }
            // 자동차에는 계단 회피 개념이 없다 — 타입이 그 사실을 말한다.
            // 자동차에는 최종 접근 개념이 없다(딥링크 위임이 정본) — 타입이 그 사실을 말한다.
            return (car.route, car.roadSpans, briefing.durationSeconds, nil, nil, nil, nil)
        }
        let briefing = try await routeService.walk(
            originLat: origin.lat, originLng: origin.lng,
            destLat: dest.lat, destLng: dest.lng,
            accessible: accessible,
            includeGeometry: true
        )
        guard let briefing,
              let route = buildGuideRoute(briefing.steps.map {
                  GuideStepGeometry(description: $0.description, pathCoords: $0.pathCoords)
              })
        else { return nil }
        return (
            route, [], briefing.durationSeconds,
            briefing.stepFree, briefing.stepFreeStatus, briefing.stepFreeNotice,
            briefing.finalApproach
        )
    }

    /// 열화 전이 판정(spec 2026-08-08 §2.3, 웹 `consumeStepFreeNotice` 미러). 상태가
    /// 열화이고 직전과 다를 때만 문장을 돌려준다. 직전 상태를 갱신하는 부작용이
    /// 있으므로 기하 빌드까지 성공한 뒤 정확히 1회 부른다.
    ///
    /// ⚠ **신호는 상태 분류가 아니라 "서버가 문장을 실었는가"다**(a11y 리뷰 H2).
    /// 서버는 열화일 때만 문장을 채우므로 문장의 존재 자체가 경고를 뜻한다. 알려진
    /// 상태 셋으로 분류되는지로 가르면 서버가 넷째 상태를 추가하는 순간 문장이 와
    /// 있는데도 침묵하는데, 같은 응답에 웹은 낭독한다 — 모르는 상태일수록 보수적으로
    /// 말해야 한다. 중복 판정은 원시 문자열로 막는다.
    private func consumeStepFreeNotice(
        _ raw: String?, _ status: StepFreeStatus?, _ notice: String?
    ) -> String? {
        let prev = lastStepFree
        // 정상(applied)·미요청은 침묵하되 기준은 갱신한다 — 이후 열화가 오면 전이다.
        let benign = raw == nil || status == .applied
        // ⚠ 열화인데 문장이 비어 오면(서버 계약 위반) 기준을 갱신하지 않는다.
        //    갱신하면 문장이 정상화된 뒤에도 전이가 사라져 영영 침묵한다(리뷰 L5).
        if benign || notice != nil { lastStepFree = raw }
        guard !benign, let notice, raw != prev else { return nil }
        return notice
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
            resetFinalApproach(geometry: fetched.finalApproach)
            let initial = initialGuideState(
                route: fetched.route, now: uptimeNow,
                hasFinalApproachGeometry: fetched.finalApproach != nil
            )
            guideState = initial.state
            mode = .detail
            offRoute = false
            updateRemaining(route: fetched.route, state: initial.state)
            // 시작 요약 + 첫 안내를 한 문장으로(원자 발화 — 두 통지의 경합 제거).
            let summary = sessionKind == .car
                ? GuideText.carStart(route: fetched.route, firstIndices: initial.firstIndices)
                : GuideText.start(route: fetched.route, firstIndices: initial.firstIndices)
            // 계단 회피 열화 문장이 있으면 그 앞에 붙인다 — 세션 전체에 걸린 조건이라
            // 걷기 전에 들어야 한다(spec §2.3). 별도 통지로 내보내면 경합한다.
            let notice = consumeStepFreeNotice(
                fetched.stepFreeRaw, fetched.stepFree, fetched.stepFreeNotice
            )
            let text = notice.map { "\($0) \(summary)" } ?? summary
            lastGuidance = GuideText.unit(route: fetched.route, indices: initial.firstIndices)
            statusText = text
            // 발화가 버려졌으면(백그라운드·억제) 경고만 따로 남긴다 — 진행 안내와 달리
            // 다음 fix가 대신 말해 주지 않는다(리뷰 H1).
            if !announce(text), let notice { pendingStepFreeNotice = notice }
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
        // 경로가 없으면 경로 기반 계단 판정도 없다(3-state). 복구된 상세가 열화면
        // 새 판정으로 다시 통지된다 — 반복이 아니다. 갚지 못한 경고도 대상이
        // 사라졌으므로 버린다(간략 폴백엔 따라갈 경로 자체가 없다).
        lastStepFree = nil
        pendingStepFreeNotice = nil
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
        // 갚지 못한 계단 경고는 세션과 함께 버린다. 전경 복귀 재생이 추적 가드보다
        // 앞이라(아래 `handleScenePhaseChange`) 남겨 두면 끝난 경로의 경고가 뒤늦게
        // 발화된다.
        pendingStepFreeNotice = nil
        resetFinalApproach(geometry: nil)
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
        soundDegraded = false
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
            wasBackgrounded = true
            UIApplication.shared.isIdleTimerDisabled = false
        case .active:
            // ⚠ **추적 가드보다 앞이다.** 백그라운드에서 세션이 *끝나는* 경로들이 있고
            // (권한 철회·목적지 변경·다른 세션의 claim) 그때 status가 내려가므로,
            // 가드 뒤에 두면 종료 통지가 통째로 유실된다. 같은 순간 정지 톤도 없어
            // (stop 기본값이 playStopTone: false) "조용히 죽은 것"과 "정상인데 데드밴드를
            // 못 넘은 것"이 구분되지 않는다. 종료 통지는 추적 중이 아닐 때야말로 필요하다.
            if missedAnnouncement || pendingStepFreeNotice != nil
                || pendingFinalApproachIntro != nil {
                missedAnnouncement = false
                // 두 문장을 연속으로 내보내지 않는다 — 경합하면 앞의 것이 잘린다.
                // 경고가 앞이다(세션 전체에 걸린 조건).
                // ⚠ 진입 배치 서술은 `statusText`와 같은 문장일 수 있다(억제 직후 복귀).
                //   중복 낭독을 막으려고 statusText 쪽을 떨어뜨린다.
                let intro = pendingFinalApproachIntro
                let tail = statusText.isEmpty || statusText == intro ? nil : statusText
                let owed = [pendingStepFreeNotice, intro, tail]
                    .compactMap { $0 }.joined(separator: " ")
                if !owed.isEmpty, announce(owed) {
                    pendingStepFreeNotice = nil
                    pendingFinalApproachIntro = nil
                }
            }
            guard isTracking else { return }
            UIApplication.shared.isIdleTimerDisabled = true
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

    /// 상세 모드 데드밴드 감쇠의 하한(m). 경로 투영은 정확도와 무관하게 몇 미터씩
    /// 흔들리므로, 이보다 작은 잔여 거리 변화는 이동이 아니라 투영 지터로 본다.
    private static let detailDeadBandFloor = 5.0

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

    /// 이 fix의 이동 상태(양 모드 공용).
    ///
    /// ⚠ **신선하지 않은 fix는 판정에 넣지 않는다**(코드 리뷰 2026-08-08). 캐시 좌표가
    /// 현재 위치 근처면(마지막 알려진 위치라 흔하다) 산출 속도가 0에 가까워 **걷는 중에
    /// 거짓 정지**가 난다. 표본 시각이 측정 시각이 아니라 수신 시각이라 dt도 실제 간격이
    /// 아니어서 폴백 상·하한이 제 역할을 못 한다. 낡은 표본은 기준으로도 두지 않는다.
    private func judgeMotion(
        fix: LocationService.BeaconFixPayload, ageSeconds: Double, now: Double
    ) -> MotionState {
        guard abs(ageSeconds) <= BeaconConstants.freshnessWindow else { return .speedUnknown }
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

    /// 지금 도착 상태인가. 간략은 리듀서의 존 래치가 정본이고, 상세는 `arrived`
    /// 이벤트가 세션을 끝내는 축이라 여기서 주장하지 않는다(스펙 §4.3 도착 판정 분리).
    private var arrivedNow: Bool { mode == .brief && beaconState.nearby }

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
        let age = Date().timeIntervalSince(fix.timestamp)
        let motion = judgeMotion(fix: fix, ageSeconds: age, now: now)

        // 경로 조회 대기·진행 중엔 발화를 보류한다(간략 첫 거리 → 곧바로 상세 시작의
        // 이중 발화 차단). 첫 수용 fix가 조회 트리거이자 origin이다(8번).
        if awaitingRoute {
            lastFixAt = now
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
        // 최종 접근은 모드보다 앞이다 — 이 국면의 발화 소유자는 이 층 하나뿐이라
        // 경로 리듀서도 비콘 리듀서도 이 fix를 보지 않는다(§3.0 소유권 계약).
        if inFinalApproach {
            handleFinalApproach(fix: fix, motion: motion, age: age, now: now)
            return
        }
        if mode == .detail, let route = guideRoute {
            handleDetail(fix: fix, route: route, motion: motion, age: age, now: now)
            return
        }
        // 간략 경로 위에서의 상세 전환 모호 해소 시도(스펙 §6). 성공하면 이번 fix 소비.
        if resolveDetailIfPending(fix: fix) { return }

        // 캐시 위치와 무효 좌표는 앵커에서 배제한다(판정은 Kit 순수 함수). ⚠ 종전에는
        // 여기서 조용히 버렸는데, 그 침묵도 커버리지 대상이다 — 워치독(8초)이 잡기
        // 전까지의 공백을 신뢰 불가 톤이 메운다.
        guard isUsableFix(accuracy: fix.accuracy, ageSeconds: age) else {
            routeTone(
                ToneLayerInput(unreliable: true, arrived: arrivedNow), now: now
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
                        // 감쇠 하한은 그 fix의 정확도다 — 정확도보다 작은 변화는
                        // 아무리 오래 기다려도 추세가 아니라 지터다.
                        deadBandFloor: fix.accuracy,
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
        fix: LocationService.BeaconFixPayload, route: GuideRoute, motion: MotionState,
        age: Double, now: Double
    ) {
        guard let state = guideState else { return }
        // 캐시 fix만 거른다. 정확도 악화(50m 초과)는 버리지 않고 리듀서에 넘긴다 —
        // uncertain 전이(진입·회복 1회 통지)가 그 정보의 소비자다(스펙 §5.0).
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

        // 방위 관측은 넘기지 않는다 — 리듀서 내부 유도기가 fix 이력에서 직접 만든다
        // (spec §2.9 재설계. 기기 course는 보행 속도에서 방위를 제공하지 않는다 —
        // 실사용 로그 courseAcc 중위 83°, §3.0.1).
        let out = guideStep(
            state: state,
            fix: GuideFix(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy),
            route: route,
            now: now,
            tuning: tuning
        )
        guideState = out.state

        let voteCounts = out.state.courseVotes.reduce(into: (mismatch: 0, match: 0, unknown: 0)) {
            switch $1.vote {
            case .mismatch: $0.mismatch += 1
            case .match: $0.match += 1
            case .unknown: $0.unknown += 1
            }
        }
        guideDiagLog(
            "fix t=\(String(format: "%.1f", now)) "
                + "lat=\(String(format: "%.6f", fix.lat)) lng=\(String(format: "%.6f", fix.lng)) "
                + "acc=\(String(format: "%.1f", fix.accuracy)) "
                + "course=\(String(format: "%.1f", fix.course)) "
                + "courseAcc=\(String(format: "%.1f", fix.courseAccuracy)) "
                + "speed=\(String(format: "%.2f", fix.speed)) "
                + "speedAcc=\(String(format: "%.2f", fix.speedAccuracy)) "
                + "motion=\(motion) age=\(String(format: "%.1f", age)) "
                + "phase=\(out.state.phase) d=\(String(format: "%.1f", out.state.d)) "
                + "event=\(out.event.map { "\($0)" } ?? "-")"
                // ⚠ 판정 결과를 남기는 것이 이 로그의 핵심이다. 실보행에서 "왜 안
                // 잡혔나"·"왜 헛경고가 났나"를 위 원시값과 함께 되짚어야 파라미터를
                // 정할 수 있다(spec §7 3단계). 기기 course·courseAcc 원시 필드는 위에
                // 그대로 남긴다 — 유도 방위와 기기 방위를 같은 로그에서 대조하는 것이
                // 다음 검증 보행의 분석 축이다.
                + " derived=\(out.derivedCourse.map { String(format: "%.1f±%.1f", $0.bearing, $0.uncertaintyDeg) } ?? "-")"
                + " perp=\(out.perpMeters.map { String(format: "%.1f", $0) } ?? "-")"
                + " vote=\(out.courseVote?.rawValue ?? "-")"
                + " axes=d:\(out.state.offRouteAxes.distance)/c:\(out.state.offRouteAxes.course)"
                // ⚠ 표 개수만으로는 "표가 없어서 unknown"과 "회색지대라서 unknown"이
                // 구분되지 않는다. 창의 분포를 그대로 남긴다 — 이 구분이 §6 상수를
                // 정하는 핵심 질문이다.
                + " votes=m:\(voteCounts.mismatch)/k:\(voteCounts.match)/u:\(voteCounts.unknown)"
                + " verdict=\(courseAxisVerdict(out.state.courseVotes).rawValue)"
        )

        // 최종 접근 진입은 **톤 조립 앞에서** 갈라진다. 이 fix의 소유권이 통째로
        // 넘어가므로 상세 톤 입력을 조립하면 안 된다 — `routeTone`은 톤 상태를 전진시켜서
        // 한 fix에 두 번 부르면 전이가 두 번 일어난다.
        //
        // ⚠ 인계 전제(E4 spec §8.2): 국면·정확도 가드는 리듀서가 이미 보장하지만
        // **투영 점프는 보지 않는다**. 튄 잔여 거리로 진입을 확정하면 실제 경로가 남았는데
        // 결정 지점 안내가 사라진다. 이 fix만 버리면 되고, 조건이 참이면 다음 fix에서
        // 다시 온다. ⚠ `projectionJumped`는 호출 자체가 기준값을 갱신하므로 한 fix에
        // 한 번만 부른다.
        let remaining = max(0, route.totalMeters - out.state.d)
        let jumped = projectionJumped(remaining: remaining, now: now)
        if case .finalApproachEnter = out.event {
            guard !jumped else { return }
            beginFinalApproach()
            // 진입이 소유권을 넘겼으면 **같은 fix로** 첫 발화를 낸다. 다음 fix를
            // 기다리면 종점에 선 채 수 초 침묵하고, 그 침묵이 이번에 고치려는 증상이다.
            if inFinalApproach {
                handleFinalApproach(fix: fix, motion: motion, age: age, now: now)
            }
            return
        }
        updateRemaining(route: route, state: out.state)

        // 톤 계층 입력 조립(상세 4단계). ⚠ 종전의 "무이벤트 fix마다 3초 tick 하트비트"는
        // 폐기됐다 — 같은 소리가 간략에서는 정체를 뜻해 한 소리에 두 뜻이 있었다.
        // 그 자리를 추세 축이 대신하므로 별도 중재가 필요 없다.
        let phase = out.state.phase
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
                        // 상세는 정확도 축이 아니라 투영 안정성 축이라 고정 하한을 쓴다.
                        deadBandFloor: Self.detailDeadBandFloor,
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

    // MARK: - 최종 접근 (spec 2026-08-08 §3.3·§3.4·§4)

    /// 세션의 최종 접근 상태를 새 경로 기준으로 되돌린다(시작·재조회 공용).
    private func resetFinalApproach(geometry: FinalApproachPayload?) {
        inFinalApproach = false
        finalApproachGeometry = geometry
        finalApproachIntroSpoken = false
        pendingFinalApproachIntro = nil
        lastFinalTickAt = nil
    }

    /// 진입 처리 — 플래그와 거리 축만 바꾸고 **말하지 않는다.** 첫 발화는
    /// `handleFinalApproach`가 같은 fix로 내며, 그래야 "도착이 진입 서술을 이긴다"가
    /// 한 곳에서 성립한다(두 군데서 말하면 목적지 코앞에서 배치 서술과 도착 통지가 겹친다).
    private func beginFinalApproach() {
        remainingText = nil  // 경로 잔여는 이 국면에서 의미가 없다(이미 종점을 지났다)
        etaTask?.cancel()
        etaTask = nil
        rebaseForAxisChange()  // 경로 거리 → 직선거리(축 전환, handoff와 같은 규칙)
        // ⚠ 오프셋이 하한 미만이면(`tooClose`) 종점 도달이 곧 목적지 도착이라 최종
        //   접근을 건너뛴다(§3.2). 말할 배치가 없는데 진입 서술을 내면 "약 8미터"
        //   다음에 곧바로 도착이 붙어 잉여다.
        guard let geometry = finalApproachGeometry,
              geometry.unavailableReason != .tooClose
        else {
            // 기하가 없으면(구버전 응답) 말할 배치 정보가 없다. 종전 인계 그대로
            // 간략(비콘)으로 넘겨 거리 추적만 남긴다 — 침묵보다 낫다.
            mode = .brief
            let text = appLocalized("guide.handoff")
            statusText = text
            announce(text)
            return
        }
        inFinalApproach = true
        finalApproachIntroSpoken = false
        lastFinalTickAt = nil
        guideDiagLog("finalEnter offset=\(String(format: "%.1f", geometry.offsetMeters))")
    }

    /// 최종 접근 fix 처리(§3.4). **거리는 항상 현재 fix → 목적지 직선거리**다 —
    /// 진입 서술의 `offsetMeters`는 그 문장에서만 쓰고 이후 재사용하지 않는다.
    ///
    /// ⚠ **시간 상한을 두지 않는다.** 초판의 2분 상한은 오프셋 89m·저속 보행에서 정작
    /// 마지막 15m 직전에 루프를 껐다. 종료 조건은 거리(도착)와 사용자의 중지뿐이다.
    ///
    /// ⚠ 비콘 리듀서를 돌리지 않는다. 그 리듀서가 만드는 것은 발화와 `nearby` 플래그인데
    /// 여기서는 발화 소유권이 이 층에 있고 도착 판정도 이 층이 직접 한다 — 결과를 버릴
    /// 리듀서를 돌리는 것은 지연만 늘린다. 추세 톤은 같은 직선거리로 직접 조립한다.
    private func handleFinalApproach(
        fix: LocationService.BeaconFixPayload, motion: MotionState, age: Double, now: Double
    ) {
        guard let dest else { return }
        // 신뢰 불가 fix에서는 거리·방향을 말하지 않는다(unreliable 최우선 불변식 유지).
        // 주기 시각도 갱신하지 않는다 — 정지·유지이지 리셋이 아니다(§4).
        guard isUsableFix(accuracy: fix.accuracy, ageSeconds: age) else {
            routeTone(ToneLayerInput(unreliable: true), now: now)
            return
        }
        lastFixAt = now
        lastStaleNoticeAt = nil
        lastFixCoord = (fix.lat, fix.lng)
        lastFixCoordAt = now

        let distance = haversineMeters(
            lat1: fix.lat, lng1: fix.lng, lat2: dest.lat, lng2: dest.lng
        )
        let arrived = distance <= finalApproachArriveMeters
        // 도착 종·진동이 안 난다는 실사용 보고(2026-08-09)의 판정 근거. 원인 후보가
        // 둘인데(도착 판정 자체가 안 옴 vs 판정은 왔는데 소리가 잘림) 증상이 같아
        // 로그 없이는 갈리지 않는다 — 이 줄이 그 갈림을 남긴다.
        guideDiagLog(
            "final t=\(String(format: "%.1f", now)) "
                + "dist=\(String(format: "%.1f", distance)) "
                + "acc=\(String(format: "%.1f", fix.accuracy)) "
                + "arrived=\(arrived) introSpoken=\(finalApproachIntroSpoken)"
        )
        routeTone(
            ToneLayerInput(
                trend: TrendInput(
                    distance: distance,
                    deadBand: max(BeaconConstants.baseDeadBand, fix.accuracy),
                    // 감쇠 하한은 그 fix의 정확도다 — 정확도보다 작은 변화는 지터다.
                    deadBandFloor: fix.accuracy,
                    motion: motion,
                    closerIntervalSeconds: closerIntervalSeconds
                ),
                arrived: arrived
            ),
            now: now
        )

        // ⚠ **진입 배치 서술이 도착보다 앞이다.** 뒤에 두면 오프셋 10~15m 구간에서
        //   진입 fix가 이미 도착 반경 안이라 배치 서술이 한 번도 나가지 않은 채 세션이
        //   끝난다 — 방향을 못 들은 채 "도착했습니다"만 듣는 것이 이번 작업이 고치려던
        //   증상 그 자체다(독립 리뷰 검출). 도착은 다음 fix가 낸다.
        //   1회뿐인 발화라 억제되면 보관했다가 전경 복귀 때 갚는다(§4).
        if !finalApproachIntroSpoken, let geometry = finalApproachGeometry {
            finalApproachIntroSpoken = true
            lastFinalTickAt = now
            let text = GuideText.finalApproachEnter(
                destination: destinationLabel, geometry: geometry, accuracy: fix.accuracy
            )
            statusText = text
            lastGuidance = text
            if !announce(text) { pendingFinalApproachIntro = text }
            return
        }

        if arrived {
            let text = appLocalized("guide.arrived")
            playTone(.nearby)
            stop()  // ⚠ dest·statusText를 지우므로 문장은 위에서 미리 만든다
            statusText = text
            lastGuidance = text
            announce(text, highPriority: true)
            return
        }

        guard let last = lastFinalTickAt, now - last >= finalApproachIntervalSeconds else {
            if lastFinalTickAt == nil { lastFinalTickAt = now }
            return
        }
        lastFinalTickAt = now
        let text = GuideText.finalApproachTick(
            distance: distance,
            direction: liveDirection(fix: fix, dest: dest, motion: motion, age: age),
            accuracy: fix.accuracy
        )
        statusText = text
        lastGuidance = text
        announce(text)
    }

    /// 실시간 상대 방향. 게이트를 통과하지 못하면 nil이고, 소비자는 방향 어절을
    /// 통째로 뺀다 — "모름"과 "실패"는 사용자 출력에서 같다(§3.5).
    ///
    /// ⚠ **어절이 아니라 열거형을 돌려준다.** 소비자마다 필요한 어휘가 맨몸("왼쪽")과
    /// 이동형("왼쪽으로")으로 갈리므로 어절 선택은 소비자가 진다.
    private func liveDirection(
        fix: LocationService.BeaconFixPayload, dest: BeaconDest,
        motion: MotionState, age: Double
    ) -> RelativeDirection? {
        guard case let .valid(course) = courseStep(
            course: fix.course, courseAccuracy: fix.courseAccuracy,
            speed: fix.speed, motion: motion, ageSeconds: age
        ) else { return nil }
        let toDest = bearingDegrees(
            fromLat: fix.lat, fromLng: fix.lng, toLat: dest.lat, toLng: dest.lng
        )
        let relative = (toDest - course + 540).truncatingRemainder(dividingBy: 360) - 180
        return relativeDirection(relative)
    }

    private func consume(event: GuideEvent, route: GuideRoute) {
        switch event {
        case let .announceSteps(indices), let .bundleReread(indices):
            let text = GuideText.unit(route: route, indices: indices)
            lastGuidance = text
            statusText = text
            // 실행 안내는 억제 중이면 최신 1개를 보관해 해제 시 복구한다(스펙 §4.3).
            if outputSuppressed { pendingRecovery = text } else { announce(text) }
        case let .imminent(_, action):
            // 10m 임박 큐: 전문이 아니라 짧은 명령형이다. 전문은 40m에서 이미 나갔고,
            // 여기서 다시 읽으면 8초 안에 두 문장이 겹쳐 정작 행동 시점을 놓친다.
            //
            // ⚠ `lastGuidance`를 덮지 않는다. 이 값은 신호 불량 구간에서 "마지막으로
            //   들은 안내"로 되읽히는데, 그 자리에 "잠시 후 왼쪽으로 도세요"가 남으면
            //   무엇을 향한 회전이었는지가 사라진다.
            //
            // ⚠ 억제 중이어도 보관(`pendingRecovery`)하지 않는다. 이 문장은 그 10m
            //   구간에서만 참이라 나중에 갚으면 이미 지난 모퉁이를 돌라고 말한다.
            let text = appLocalized("guide.imminent.\(action.rawValue)")
            statusText = text
            if !outputSuppressed { announce(text) }
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
        case .finalApproachEnter:
            // 여기서는 처리하지 않는다. 진입은 **fix를 쥔 `handleDetail`이** 톤 조립 앞에서
            // 가른다 — 소유권 전환과 같은 fix의 첫 발화가 한 묶음이어야 하고, 이 함수는
            // fix를 받지 않아 그 발화를 낼 수 없다. 반쪽 처리를 여기 두면 진입 직후
            // 침묵(정확히 이번에 고치려는 증상)이 되므로 비워 둔다.
            break
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
            // 최종 접근도 해제한다 — 경로 스텝 안내 중간에 "오른쪽 약 20미터"가
            // 끼어드는 것을 막는다(§4 "수동 brief → detail").
            inFinalApproach = false
            finalApproachIntroSpoken = false
            pendingFinalApproachIntro = nil
            lastFinalTickAt = nil
            let state = guideStateAt(
                route: route, d: d, now: now, autoHandoffArmed: false,
                hasFinalApproachGeometry: finalApproachGeometry != nil,
                // 같은 세션의 모드 전환 — 유도기 버퍼를 잇는다(spec §2.9).
                courseDerivation: guideState?.courseDerivation ?? initialDerivationState
            )
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
            // 직선거리가 정본인 두 국면(스펙 §4.2 + 2026-08-08 §3.4): 이탈 중 경로 잔여는
            // 낡은 투영이라 거짓이고, 최종 접근에서는 이미 종점을 지나 잔여가 0에 붙는다.
            let straight = state.phase == .offRoute || state.phase == .finalApproach
                ? freshStraightLineMeters() : nil
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
            // 사용자가 직선 안내를 명시 선택했다 — 최종 접근이 쥔 발화 소유권을 놓고
            // 비콘에 넘긴다(§4 "수동 detail → brief"). 기하는 세션 것이라 유지한다.
            inFinalApproach = false
            finalApproachIntroSpoken = false
            pendingFinalApproachIntro = nil
            lastFinalTickAt = nil
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
                // 경로가 없으면 경로 기반 계단 판정도 없다(3-state) — 폴백과 동형.
                lastStepFree = nil
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
            // 새 경로는 새 종점·새 오프셋이다 — 진입 래치·주기 타이머·진입 서술 래치를
            // 전부 초기화한다(spec §4 "사용자 재조회 성공").
            resetFinalApproach(geometry: fetched.finalApproach)
            // 재조회는 같은 세션의 새 경로다 — 유도기 버퍼를 잇는다(spec §2.9. 비우면
            // 갈림 직후 재조회에서 축이 ~10m 냉시동돼 "이탈 → 재조회 → 다시 잘못된
            // 길" 시나리오에서 이 축의 이점이 사라진다).
            let initial = initialGuideState(
                route: fetched.route, now: uptimeNow,
                hasFinalApproachGeometry: fetched.finalApproach != nil,
                courseDerivation: guideState?.courseDerivation ?? initialDerivationState
            )
            guideState = initial.state
            offRoute = false
            updateRemaining(route: fetched.route, state: initial.state)
            let first = GuideText.unit(route: fetched.route, indices: initial.firstIndices)
            lastGuidance = first
            // 재조회는 출발지가 달라 계단 회피 판정이 바뀔 수 있다 — 열화로 전이하면
            // 그 조회의 발화에 결합해 1회 통지한다(spec §2.3).
            let notice = consumeStepFreeNotice(
                fetched.stepFreeRaw, fetched.stepFree, fetched.stepFreeNotice
            )
            let summary = GuideText.reroute(route: fetched.route, firstIndices: initial.firstIndices)
            let text = notice.map { "\($0) \(summary)" } ?? summary
            statusText = text
            // ⚠ **`.high`가 아니면 이 발화는 도달하지 않는다.** 성공하면 위 `offRoute = false`가
            // 재조회 버튼을 없애고, 시트가 커서를 중지 버튼으로 되돌리며 그 라벨을 낭독한다 —
            // 기본 우선순위 통지는 그 VO 활성화 처리에 잠식된다(헌장 §6 실기기 확정).
            // 바로 아래 실패 경로만 `.high`였던 비대칭이 실사용 무발화의 원인이었다.
            if !announce(text, highPriority: true), let notice { pendingStepFreeNotice = notice }
        } catch {
            guard token == rerouteToken, isTracking else { return }
            lastStepFree = nil
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
            // 도착 종단은 여기서도 지킨다(스펙 §5.5). 목적지에서 건물로 들어가 GPS가
            // 끊기면 사용자가 직접 멈추기 전까지 "신뢰할 수 없음"이 무한 반복된다.
            routeTone(ToneLayerInput(unreliable: true, arrived: arrivedNow), now: now)
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
        // 가청 상태는 세션 중에도 바뀐다(route 변경·인터럽션 복구가 재조정을 거치고,
        // 억제 해제가 미뤄진 승격을 성사시킨다).
        let degraded = isTracking && !tones.isBackgroundAudible
        if soundDegraded != degraded { soundDegraded = degraded }
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
    /// 반환값은 **실제로 게시했는가**다. 세션에 1회뿐인 통지(계단 회피 경고)는
    /// 버려지면 다음 fix가 대신 말해 주지 않으므로 호출부가 갚을 수 있어야 한다.
    @discardableResult
    private func announce(_ message: String, highPriority: Bool = false) -> Bool {
        guard !outputSuppressed else { return false }
        // 백그라운드에서는 **발화만** 막는다. `statusText`·`lastGuidance`는 호출부가
        // 이미 갱신했으므로 복귀 시 화면이 최신이다(상태 갱신과 발화의 분리).
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

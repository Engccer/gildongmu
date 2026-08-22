import SwiftUI
import GildongmuKit

/// 안내 화면 종류 — 루트 `.sheet(item:)`의 item. 두 시트를 독립 Bool로 경쟁시키지
/// 않는다(설계 리뷰 M2: 한 갱신에서 한 시트가 내려가며 다른 시트가 올라오면
/// presentation이 무시될 수 있다).
enum GuideScreenKind: String, Identifiable {
    case beacon, transit
    var id: String { rawValue }
}

/// 실시간 안내 세션의 앱 수준 소유자(N1, spec `2026-08-22-guide-session-minimize-design.md`).
///
/// `BeaconModel`·`TransitGuideModel`이 길찾기 탭 `@State`에 살던 시절엔 탭 전환이
/// 곧 세션 종료였고 시트 닫힘이 곧 중지였다. 이제 모델은 앱 수명이고, 시트·띠바의
/// 표시 상태(`isMinimized`)는 여기 산다 — **모델은 최소화를 모른다**.
///
/// 시작 요청은 전부 `startBeacon`·`startTransit`을 지난다(설계 리뷰 C1·C2): 거부
/// 게이트 한 곳 + 다른 모델의 잔여 화면(도착·중지 종료 화면, 핸드오프 제안) 소거.
@Observable @MainActor
final class GuideSession {
    static let shared = GuideSession()

    let coordinator = GuideSessionCoordinator()
    let beacon = BeaconModel()
    let transit = TransitGuideModel()

    /// 시트가 내려가 있고 띠바가 세션을 대표하는 상태. `hasScreen`이 false로 떨어질 때
    /// `GildongmuApp`이 명시적으로 되돌린다(설계 리뷰 M1).
    var isMinimized = false
    /// 띠바로 돌아온 시트가 첫 착지를 최소화 버튼에 두게 하는 1회 플래그. 같은 종류의
    /// 시트만 소비한다(설계 리뷰 m1).
    var returnedFromBand: GuideScreenKind?
    /// 경유지 지원 조건(N4): 비콘(도보·자동차) 세션 추적 중 ∧ ko 데이터 로케일(상세 경로
    /// 조회 자체가 ko 전용이라 그 밖에선 경유지가 의미 없다). 대중교통 세션은 제외(ODsay
    /// 미지원). 장소 상세 버튼과 안내 시트 버튼이 같은 게이트를 본다.
    var waypointAvailable: Bool { beacon.isTracking && AppLanguage.dataLocale == "ko" }

    private var walkHandoffTask: Task<Void, Never>?

    private init() {}

    /// 세션 활성 = 코디네이터 점유 ∨ 비콘 시작 대기(권한 팝업 등, 설계 리뷰 M5).
    var isActive: Bool { coordinator.isActive || beacon.starting }

    /// 안내 화면이 존재해야 하는가 — 추적 중이거나 세션 뒤에 남은 화면이 있을 때.
    var hasScreen: Bool { screen != nil }

    /// 어느 화면인가. 둘 다면 비콘(핸드오프 600ms 창에서 비콘이 이긴다).
    var screen: GuideScreenKind? {
        if beacon.isTracking || beacon.arrivalDest != nil { return .beacon }
        if transit.isTracking || transit.pendingWalkHandoff != nil { return .transit }
        return nil
    }

    var presentedScreen: GuideScreenKind? { isMinimized ? nil : screen }

    // MARK: - 시작 진입점

    func startBeacon(_ request: BeaconModel.StartRequest) {
        guard !refuseIfActive() else { return }
        transit.clearWalkHandoff()
        beacon.requestStart(request)
    }

    func startTransit(route: TransitRoute, destinationLabel: String, dest: BeaconDest, accessible: Bool) {
        guard !refuseIfActive() else { return }
        beacon.clearArrival()
        transit.start(transitRoute: route, destinationLabel: destinationLabel, dest: dest, accessible: accessible)
    }

    /// 거부 통지는 모델의 창구를 쓴다(지연 슬롯·억제 규칙을 지나야 한다).
    private func refuseIfActive() -> Bool {
        guard isActive else { return false }
        beacon.announceNow(appLocalized("guide.alreadyActive"), highPriority: true, bypassSuppression: true)
        return true
    }

    /// 대중교통 완료 뒤 도보 핸드오프 수락(§14.2) — 한 전이(설계 리뷰 C5·C6):
    /// transit 종료(release 포함, 이미 끝났으면 no-op) → 제안 소거 → 600ms 뒤 비콘 시작.
    /// Task는 세션이 소유한다(탭 `onDisappear`가 취소하던 종전 구조는 탭을 떠나면
    /// 수락한 핸드오프를 죽였다).
    func acceptWalkHandoff() {
        guard let dest = transit.dest else { return }
        let label = transit.destinationLabel
        let accessible = transit.accessible
        transit.stop()
        transit.clearWalkHandoff()
        walkHandoffTask?.cancel()
        walkHandoffTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let self else { return }
            self.startBeacon(BeaconModel.StartRequest(
                dest: dest, label: label, kind: .walk, accessible: accessible,
                variant: nil, shortestAvailable: false,
                waypoint: nil))  // 대중교통 세션엔 경유지가 없다(ODsay 미지원)
        }
    }

    /// 자동차 도착 뒤 도보 인계(K2 §6.4) — 같은 모델이라 대중교통 인계의 600ms 지연이 없다:
    /// 종료 화면 소거 → 같은 목적지로 도보 시작(경유지 없음, 계단 회피 없음).
    func acceptCarWalkHandoff() {
        guard let dest = beacon.arrivalDest else { return }
        let label = beacon.destinationLabel
        beacon.clearArrival()
        self.startBeacon(BeaconModel.StartRequest(
            dest: dest, label: label, kind: .walk, accessible: false,
            variant: nil, shortestAvailable: false, waypoint: nil))
    }

    func handleScenePhaseChange(to phase: ScenePhase) {
        beacon.handleScenePhaseChange(to: phase)
        transit.handleScenePhaseChange(to: phase)
    }

    // MARK: - 받아쓰기 중 출력 억제 (K1 ④, N1 후속)

    /// 받아쓰기 시작 직전 두 모델의 억제 값. nil이면 받아쓰기가 억제를 쥐고 있지 않다.
    private var dictationPrior: (beacon: Bool, transit: Bool)?
    /// 억제를 쥔 받아쓰기 소유자들. `SpeechService`는 화면마다 인스턴스가 따로라(검색·도착지
    /// 검색·채팅) 두 세션이 겹칠 수 있다 — 마지막 소유자가 떠날 때만 푼다(리뷰 2026-08-23).
    private var dictationOwners = Set<ObjectIdentifier>()

    /// 받아쓰기(`SpeechService`)가 도는 동안 두 모델의 톤·통지를 억제한다 — 헌장 §6
    /// "녹음 중 SR 발화 0"은 검색·채팅 탭에서도 성립해야 하는데, 종전엔 길찾기 탭의
    /// 검색 시트만 억제를 걸어 다른 탭 마이크엔 안내 통지가 전사에 섞였다.
    ///
    /// 억제 플래그는 시트(목적지 검색 등)도 쓰는 **공유 Bool**이라 끝날 때 무조건 false로
    /// 되돌리면 열린 시트의 억제를 깨고, 무조건 이전 값으로 되돌리면 그 사이 닫힌 시트의
    /// 해제를 되살린다(영구 억제 = 안내 침묵). 그래서 종료는 `이전 값 ∧ 현재 값`이다:
    /// 받아쓰기 중 누군가 false로 내렸으면 false, 시작 전부터 true였고 아직 true면 유지.
    func setDictationActive(_ active: Bool, owner: ObjectIdentifier) {
        if active {
            let wasEmpty = dictationOwners.isEmpty
            dictationOwners.insert(owner)
            guard wasEmpty else { return }
            dictationPrior = (beacon.outputSuppressed, transit.outputSuppressed)
            beacon.outputSuppressed = true
            transit.outputSuppressed = true
        } else {
            dictationOwners.remove(owner)
            guard dictationOwners.isEmpty, let prior = dictationPrior else { return }
            dictationPrior = nil
            beacon.outputSuppressed = prior.beacon && beacon.outputSuppressed
            transit.outputSuppressed = prior.transit && transit.outputSuppressed
        }
    }
}

/// 안내 주도 목적지 변경을 길찾기 탭 폼에 동기화하는 채널(N1). 시트가 루트에 살아
/// 탭을 모르므로 스토어를 거친다(`DirectionsPrefillStore` 동형). `take()`가 읽고
/// 비우는 한 연산이라 탭 재생성의 옛 task가 새 값을 지우지 않는다(설계 리뷰 M12).
@Observable @MainActor
final class GuideFormSyncStore {
    static let shared = GuideFormSyncStore()
    private(set) var pending: DirectionsEndpoint?
    /// 안내 주도 경유지 추가·변경(N4) — 도착지 채널과 분리(둘이 한 값이면 "도착지 없이
    /// 경유지만 바뀜"을 표현할 수 없다). 경유지 **도착**은 폼에 보내지 않는다(폼은 사용자
    /// 질의이지 세션 상태가 아니다, spec §4.3).
    private(set) var pendingWaypoint: DirectionsEndpoint?
    private init() {}

    func post(_ endpoint: DirectionsEndpoint) { pending = endpoint }

    func take() -> DirectionsEndpoint? {
        defer { pending = nil }
        return pending
    }

    func postWaypoint(_ endpoint: DirectionsEndpoint) { pendingWaypoint = endpoint }

    func takeWaypoint() -> DirectionsEndpoint? {
        defer { pendingWaypoint = nil }
        return pendingWaypoint
    }
}

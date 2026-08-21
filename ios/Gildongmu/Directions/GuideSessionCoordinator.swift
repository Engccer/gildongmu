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
    /// 장소 상세 "여기를 경유지로 추가" 노출 조건. N4-iOS가 비콘 세션의 경유지 지원으로
    /// 바꾼다 — 그때까지 버튼은 자리·라벨만 있고 보이지 않는다.
    var waypointAvailable: Bool { false }

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

    func handleScenePhaseChange(to phase: ScenePhase) {
        beacon.handleScenePhaseChange(to: phase)
        transit.handleScenePhaseChange(to: phase)
    }
}

/// 안내 주도 목적지 변경을 길찾기 탭 폼에 동기화하는 채널(N1). 시트가 루트에 살아
/// 탭을 모르므로 스토어를 거친다(`DirectionsPrefillStore` 동형). `take()`가 읽고
/// 비우는 한 연산이라 탭 재생성의 옛 task가 새 값을 지우지 않는다(설계 리뷰 M12).
@Observable @MainActor
final class GuideFormSyncStore {
    static let shared = GuideFormSyncStore()
    private(set) var pending: DirectionsEndpoint?
    private init() {}

    func post(_ endpoint: DirectionsEndpoint) { pending = endpoint }

    func take() -> DirectionsEndpoint? {
        defer { pending = nil }
        return pending
    }
}

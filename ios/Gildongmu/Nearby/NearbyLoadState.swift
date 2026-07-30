import Foundation
import Accessibility
import GildongmuKit

// 내 주변 도메인 공통 부속. 상태 타입 자체는 GildongmuKit의 NearbyLoadPhase/NearbyLoadEvent가
// 정본(전 화면 이관 완료)이며, 이 파일은 그 위에 얹는 좌표 어댑터·이벤트→VO 통지 매퍼·문구 조립만 둔다.

/// nil·빈 문자열 조각을 제거하고 ", "로 결합(웹 `joinText` 미러).
/// 한 줄 = 한 접근성 객체: 시각 목적 인라인 분절 대신 단일 텍스트로 합친다.
/// 구분자는 쉼표(가운뎃점은 일부 스크린 리더가 단어로 낭독해 금지).
func joinText(_ parts: String?...) -> String {
    parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
}

/// 새로고침 실패 통지: 직전 성공 데이터 유지와 짝(데이터 포기 아님을 함께 알린다).
@MainActor
func announceRefreshFailed() {
    AccessibilityNotification.Announcement(appLocalized("ios.nearby.refreshFailed")).post()
}

/// 권한 취소 전락 통지: loaded 중 새로고침에서 위치 권한 거부를 만나면 목록이
/// denied 화면으로 통째로 바뀐다 — 무신호 화면 전환(SR 맥락 상실) 방지.
@MainActor
func announcePermissionLost() {
    AccessibilityNotification.Announcement(appLocalized("ios.nearby.refreshDenied")).post()
}

/// 서비스 지역 밖 전락 통지(웹 tCommon("outOfCoverage") 미러): loaded 중 새로고침에서
/// 커버리지 밖 좌표를 만나면 목록이 통째로 사라진다 — announcePermissionLost 동형.
/// 오류가 아니라 안내이므로 같은 문구를 그대로 쓴다.
@MainActor
func announceOutOfCoverage() {
    AccessibilityNotification.Announcement(appLocalized("ios.common.outOfCoverage")).post()
}

/// NearbyLoadCore 좌표 소스 어댑터. currentCoordinate는 typed throws(LocationError)라
/// 취소가 오류로 나올 수 없고(커밋 게이트가 방어 정본), denied/unavailable만 번역한다.
extension LocationService {
    static func nearbyCoordinateSource() -> NearbyCoordinateSource {
        .current { force in
            do {
                return try await LocationService.shared.currentCoordinate(force: force)
            } catch {
                // catch 변수는 any Error로 추론되므로 캐스팅해 판별한다. denied만 번역하고
                // 나머지는 전부 unavailable — 위치 오류가 코어 default 분기로 새어
                // 서버 실패 카피로 낭독되는 일이 없도록 total하게 닫는다.
                if let locationError = error as? LocationService.LocationError,
                   case .denied = locationError {
                    throw NearbyLocationError.denied
                }
                throw NearbyLocationError.unavailable
            }
        }
    }
}

/// 완료 통지 문구 조립부(문자열 불변). 0건도 문장으로.
@MainActor
func nearbyLoadedMessage(count: Int, unit: String) -> String {
    count == 0
        ? appLocalized("ios.nearby.announceEmpty")
        : appLocalized("ios.nearby.announceCount", unit, String(count))
}

/// 이벤트→VO 발화 매퍼 1벌(스펙 §4): 전락 통지 3종은 기존 announce* 그대로,
/// loaded 문구만 도메인 클로저. emptyResult는 WhereAmI만 문구를 준다.
@MainActor
func nearbyAnnouncer<Payload: Sendable>(
    loaded: @escaping @MainActor (Payload) -> String,
    emptyResult: @autoclosure @escaping () -> String? = nil
) -> @MainActor (NearbyLoadEvent<Payload>) -> Void {
    { event in
        switch event {
        case .loaded(let payload):
            AccessibilityNotification.Announcement(loaded(payload)).post()
        case .emptyResult:
            if let message = emptyResult() {
                AccessibilityNotification.Announcement(message).post()
            }
        case .refreshFailed: announceRefreshFailed()
        case .permissionLost: announcePermissionLost()
        case .wentOutOfCoverage: announceOutOfCoverage()
        }
    }
}

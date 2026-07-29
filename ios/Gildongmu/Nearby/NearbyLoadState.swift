import Foundation
import Accessibility

/// 내 주변 도메인 화면 공통 상태: 3-state 불변식(권한 거부/조회 실패/0건)의 타입 표현.
/// 각 화면 파일 안에 재정의하지 말고 이 공용 enum을 쓴다(M2 plan Task A).
enum NearbyLoadState<Item> {
    case idle, loading
    case loaded([Item])      // 빈 배열 = 정상적 0건
    case denied              // 위치 권한 거부
    case failed              // 조회 실패
    case outOfCoverage       // 서비스 지역 밖 — 실패 아님, spec 2026-07-29
}

/// nil·빈 문자열 조각을 제거하고 ", "로 결합(웹 `joinText` 미러).
/// 한 줄 = 한 접근성 객체: 시각 목적 인라인 분절 대신 단일 텍스트로 합친다.
/// 구분자는 쉼표(가운뎃점은 일부 스크린 리더가 단어로 낭독해 금지).
func joinText(_ parts: String?...) -> String {
    parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
}

/// 로드 완료 단일 통지 채널(웹 combinedLiveMessage의 iOS 문법). 0건도 문장으로 통지.
@MainActor
func announceLoaded(count: Int, unit: String) {
    let message = count == 0
        ? appLocalized("ios.nearby.announceEmpty")
        : appLocalized("ios.nearby.announceCount", unit, String(count))
    AccessibilityNotification.Announcement(message).post()
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

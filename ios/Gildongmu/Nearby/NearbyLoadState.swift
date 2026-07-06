import Foundation
import Accessibility

/// 내 주변 도메인 화면 공통 상태 — 3-state 불변식(권한 거부/조회 실패/0건)의 타입 표현.
/// 각 화면 파일 안에 재정의하지 말고 이 공용 enum을 쓴다(M2 plan Task A).
enum NearbyLoadState<Item> {
    case idle, loading
    case loaded([Item])      // 빈 배열 = 정상적 0건
    case denied              // 위치 권한 거부
    case failed              // 조회 실패
}

/// nil·빈 문자열 조각을 제거하고 ", "로 결합(웹 `joinText` 미러).
/// 한 줄 = 한 접근성 객체 — 시각 목적 인라인 분절 대신 단일 텍스트로 합친다.
/// 구분자는 쉼표(가운뎃점은 일부 스크린 리더가 단어로 낭독해 금지).
func joinText(_ parts: String?...) -> String {
    parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
}

/// 로드 완료 단일 통지 채널(웹 combinedLiveMessage의 iOS 문법). 0건도 문장으로 통지.
@MainActor
func announceLoaded(count: Int, unit: String) {
    let message = count == 0 ? "주변 결과가 없습니다" : "주변 \(unit) \(count)개"
    AccessibilityNotification.Announcement(message).post()
}

/// 새로고침 실패 통지 — 직전 성공 데이터 유지와 짝(데이터 포기 아님을 함께 알린다).
@MainActor
func announceRefreshFailed() {
    AccessibilityNotification.Announcement("새로고침에 실패했습니다. 기존 정보를 유지합니다").post()
}

import Foundation

/// AI 채팅 데이터 전송 동의(App Review 5.1.2(i), 스펙 §1). 기본 false.
/// 미결정/거부를 구분하지 않는다 — 어느 쪽이든 동의 화면을 보여주므로 동작이 같다.
/// View는 @AppStorage(AIChatConsent.key)로, 모델 가드는 granted로 같은 키를 읽는다.
enum AIChatConsent {
    static let key = "aiChatConsent"
    static var granted: Bool { UserDefaults.standard.bool(forKey: key) }
}

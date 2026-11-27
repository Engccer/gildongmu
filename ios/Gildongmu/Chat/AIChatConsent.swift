import Foundation

/// AI 채팅 데이터 전송 동의(App Review 5.1.2(i), 스펙 §1). 기본 false.
/// 미결정/거부를 구분하지 않는다 — 어느 쪽이든 동의 화면을 보여주므로 동작이 같다.
/// View는 @AppStorage(AIChatConsent.key)로, 모델 가드는 granted로 같은 키를 읽는다.
/// 키의 판 번호가 동의 문구의 판이다. 3.0에서 기본 수신처가 Google에서 OpenAI로 바뀌어 새 키로 한 번 다시 묻는다
/// (E92 A7, 위원장 확정 2026-11-27). 옛 키 `aiChatConsent`의 값은 읽지 않는다. 수신처가 다시 바뀌면 다음 판 키로 낸다.
enum AIChatConsent {
    static let key = "aiChatConsentV2"
    static var granted: Bool { UserDefaults.standard.bool(forKey: key) }
}

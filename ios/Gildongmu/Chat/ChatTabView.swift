import SwiftUI

/// 채팅 탭: 일반 채팅(placeContext 없음, 웹 byte-identical 계약).
/// 대화 모델은 App 소유(GildongmuApp) — 탭 전환에는 살아남고 세션 리셋 시
/// App이 스트림을 요청째 취소하며 새 대화로 교체한다(spec §1, idle-reset 불변식).
struct ChatTabView: View {
    let model: ChatModel

    @AppStorage(AIChatConsent.key) private var consentGranted = false
    /// 동의 직후 전환에서만 입력 필드 선점 포커스(재실행 시 기존 낭독 흐름 유지).
    @State private var justGranted = false

    /// 빈 화면 추천 질문(서버 호출 없음): 탭이 무엇을 할 수 있는지 알리는 발견 경로.
    /// 채팅 도구가 실제 답할 수 있는 질문만(둘러보기·지하철·공기질·아이 놀 곳).
    /// ⚠ `static let` 금지 — 저장 프로퍼티는 최초 1회만 초기화돼 그때의 언어로
    /// 굳는다(언어 전환 시 추천 질문만 옛 언어로 남는 회귀). 매번 조회하는 computed로.
    private var suggestions: [String] {
        [
            appLocalized("ios.chat.suggestion1"),
            appLocalized("ios.chat.suggestion2"),
            appLocalized("ios.chat.suggestion3"),
            appLocalized("ios.chat.suggestion4"),
        ]
    }

    var body: some View {
        NavigationStack {
            Group {
                if consentGranted {
                    ChatConversationView(model: model, focusDraftOnAppear: $justGranted) {
                        suggestionList
                    }
                } else {
                    ChatConsentView {
                        justGranted = true
                        consentGranted = true
                    }
                }
            }
            .navigationTitle(appLocalized("ios.tab.chat"))
            .navigationBarTitleDisplayMode(.inline)
            .gildongmuTitleMenu()
        }
    }

    private var suggestionList: some View {
        SuggestionButtonList(suggestions: suggestions) { model.send($0) }
    }
}

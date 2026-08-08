import SwiftUI
import GildongmuKit

/// 장소 채팅 sheet. 진입은 장소 상세 버튼(웹 ChatOverlay의 iOS 문법).
/// 표시마다 새 ChatView = 장소마다 새 대화(웹 계약). 대화 UI는 ChatConversationView 공용.
struct ChatView: View {
    @State private var model: ChatModel
    @Environment(\.dismiss) private var dismiss

    @AppStorage(AIChatConsent.key) private var consentGranted = false
    /// 동의 직후 전환에서만 입력 필드 선점 포커스(재실행 시 기존 낭독 흐름 유지).
    @State private var justGranted = false

    init(place: Place) {
        _model = State(initialValue: ChatModel(place: place))
    }

    /// 빈 화면 추천 질문(웹 placeChatPrompts 미러): 장소 성격(역/음식/일반)에 맞는
    /// 예시 3개. 언어 전환 대응을 위해 computed(ChatTabView 관례 — static 굳힘 금지).
    private var suggestions: [String] {
        guard let place = model.place else { return [] }
        return placeChatPromptKeys(place).map { appLocalized($0) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if consentGranted {
                    // 장소 앵커 불변식과 충돌해 표시줄을 끈다(ChatConversationView 주석 참고) —
                    // 이 화면은 placeContext로 장소 좌표를 앵커 삼는데, 표시줄이 있으면
                    // 사용자가 지정한 위치가 그 답에 반영된다고 오해한다.
                    ChatConversationView(model: model, cancelsOnDisappear: true,
                                         showsLocationBar: false,
                                         focusDraftOnAppear: $justGranted) {
                        SuggestionButtonList(suggestions: suggestions) { model.send($0) }
                    }
                } else {
                    ChatConsentView {
                        justGranted = true
                        consentGranted = true
                    }
                }
            }
            .navigationTitle(model.place?.name ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(appLocalized("actions.close")) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
    }
}

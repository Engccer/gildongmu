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

    var body: some View {
        NavigationStack {
            Group {
                if consentGranted {
                    ChatConversationView(model: model, cancelsOnDisappear: true,
                                         focusDraftOnAppear: $justGranted) { EmptyView() }
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

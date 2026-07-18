import SwiftUI
import GildongmuKit

/// 장소 채팅 sheet. 진입은 장소 상세 버튼(웹 ChatOverlay의 iOS 문법).
/// 표시마다 새 ChatView = 장소마다 새 대화(웹 계약). 대화 UI는 ChatConversationView 공용.
struct ChatView: View {
    @State private var model: ChatModel
    @Environment(\.dismiss) private var dismiss

    init(place: Place) {
        _model = State(initialValue: ChatModel(place: place))
    }

    var body: some View {
        NavigationStack {
            ChatConversationView(model: model, cancelsOnDisappear: true) { EmptyView() }
                .navigationTitle(model.place?.name ?? "")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("닫기") { dismiss() }
                    }
                }
        }
        .presentationDetents([.large])
    }
}

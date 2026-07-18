import SwiftUI

/// 채팅 탭: 일반 채팅(placeContext 없음, 웹 byte-identical 계약).
/// 대화는 세션 한정 — @State 모델이 탭 전환에는 살아남고 sessionEpoch 리셋 시 증발한다(spec §1).
struct ChatTabView: View {
    @State private var model = ChatModel()

    /// 빈 화면 추천 질문(정적, 서버 호출 없음): 탭이 무엇을 할 수 있는지 알리는 발견 경로.
    /// 채팅 도구가 실제 답할 수 있는 질문만(둘러보기·지하철·공기질·아이 놀 곳).
    private static let suggestions = [
        "주변에 뭐가 있는지 둘러줘",
        "가까운 지하철역 도착 정보 알려줘",
        "지금 미세먼지 어때?",
        "근처에 아이랑 갈 만한 곳 있어?",
    ]

    var body: some View {
        NavigationStack {
            ChatConversationView(model: model) {
                suggestionList
            }
            .navigationTitle("채팅")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    /// 각 버튼은 독립 접근성 객체(정상). 탭하면 그 문장을 즉시 전송, 첫 전송 후 리스트 소멸.
    private var suggestionList: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Self.suggestions, id: \.self) { suggestion in
                Button(suggestion) { model.send(suggestion) }
                    .buttonStyle(.bordered)
                    .frame(minHeight: 44)
            }
        }
    }
}

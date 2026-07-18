import SwiftUI

/// 채팅 탭: 일반 채팅(placeContext 없음, 웹 byte-identical 계약).
/// 대화 모델은 App 소유(GildongmuApp) — 탭 전환에는 살아남고 세션 리셋 시
/// App이 스트림을 요청째 취소하며 새 대화로 교체한다(spec §1, idle-reset 불변식).
struct ChatTabView: View {
    let model: ChatModel

    /// 빈 화면 추천 질문(정적, 서버 호출 없음): 탭이 무엇을 할 수 있는지 알리는 발견 경로.
    /// 채팅 도구가 실제 답할 수 있는 질문만(둘러보기·지하철·공기질·아이 놀 곳).
    private static let suggestions = [
        "주변에 뭐가 있는지 둘러봐 줘",
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
                // 44pt frame은 label 안쪽 — 버튼 바깥 frame은 히트 영역을 안 넓힌다
                Button {
                    model.send(suggestion)
                } label: {
                    Text(suggestion)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
            }
        }
    }
}

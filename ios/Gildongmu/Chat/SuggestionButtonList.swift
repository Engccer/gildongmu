import SwiftUI

/// 채팅 빈 상태 추천 질문 버튼 목록 — ChatTabView·ChatView 공용.
/// 각 버튼은 독립 접근성 객체(정상). 44pt frame은 label 안쪽(버튼 바깥 frame은
/// 히트 영역을 안 넓힌다). 탭=즉시 전송, 첫 전송 후 리스트 소멸.
struct SuggestionButtonList: View {
    let suggestions: [String]
    let onTap: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(suggestions, id: \.self) { suggestion in
                Button {
                    onTap(suggestion)
                } label: {
                    Text(suggestion)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
            }
        }
    }
}

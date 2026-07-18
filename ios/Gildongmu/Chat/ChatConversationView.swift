import SwiftUI
import GildongmuKit

/// 공용 대화 뷰: 메시지 리스트 + 진행 표시 + 입력바(텍스트·마이크·보내기) + 음성 알럿.
/// 소비자 2곳 — 장소 채팅 sheet(ChatView)·채팅 탭(ChatTabView). 말풍선·입력바 수정은 여기 한 곳.
struct ChatConversationView<EmptyContent: View>: View {
    let model: ChatModel
    /// true면 뷰가 사라질 때 스트림을 폐기한다(sheet 전용). 탭에서는 false —
    /// 탭 전환은 대화 중단이 아니다(스트림은 계속 돌고 답변이 쌓인다). 탭의 세션 리셋
    /// 시 스트림 폐기는 App의 resetChatModel()이 담당. 마이크는 여기서 항상 폐기.
    let cancelsOnDisappear: Bool
    /// 메시지 0개일 때 리스트 위치에 표시(채팅 탭 추천 질문). sheet는 EmptyView.
    private let emptyContent: () -> EmptyContent

    @State private var draft = ""
    @State private var speech = SpeechService()
    /// 완료 시 새 답변 말풍선으로 VoiceOver 포커스 이동(웹 완료 포커스 이동 미러)
    @AccessibilityFocusState private var focusedMessageID: UUID?

    init(
        model: ChatModel,
        cancelsOnDisappear: Bool = false,
        @ViewBuilder emptyContent: @escaping () -> EmptyContent
    ) {
        self.model = model
        self.cancelsOnDisappear = cancelsOnDisappear
        self.emptyContent = emptyContent
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if model.messages.isEmpty {
                            emptyContent()
                        }
                        ForEach(model.messages) { message in
                            MessageBubbleView(message: message, focusedMessageID: $focusedMessageID)
                                .id(message.id)
                        }
                        if let progress = model.progress {
                            // 진행 상태는 여기 한 곳(통지는 모델의 Announcement가 담당)
                            HStack(spacing: 8) {
                                ProgressView()
                                Text(progress)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                    .padding()
                }
                .onChange(of: model.answerRevision) {
                    guard let last = model.messages.last else { return }
                    proxy.scrollTo(last.id, anchor: .bottom)
                    focusedMessageID = last.id
                }
            }
            Divider()
            inputBar
        }
        .onDisappear {
            // 마이크는 항상 폐기(화면을 떠난 뒤 유령 청취 방지 — 탭 전환 포함)
            Task { await speech.cancel() }
            guard cancelsOnDisappear else { return }
            model.cancel()
        }
        .alert(speechAlertMessage ?? "", isPresented: speechAlertBinding) {
            Button("확인") {}
        }
    }

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField("메시지 입력", text: $draft)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.send)
                .onSubmit(sendDraft)
            // 라벨 변화("음성 입력"↔"입력 중지")가 상태 신호(disabled 금지, 접근성 헌장)
            Button(action: toggleMic) {
                Label(
                    speech.isListening ? "입력 중지" : "음성 입력",
                    systemImage: speech.isListening ? "mic.fill" : "mic"
                )
                .labelStyle(.iconOnly)
            }
            .frame(minWidth: 44, minHeight: 44)
            // 전송 중 비활성은 disabled 대신 핸들러 가드(포커스 이탈 방지, 접근성 헌장)
            Button("보내기", action: sendDraft)
                .buttonStyle(.borderedProminent)
                .frame(minWidth: 44, minHeight: 44)
        }
        .padding()
    }

    private func sendDraft() {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !model.isStreaming else { return }
        draft = ""
        model.send(trimmed)
    }

    /// 음성 입력 토글: 최종 텍스트를 입력 필드에 넣기만(자동 전송 안 함, 질문은 검토 후 전송).
    private func toggleMic() {
        Task {
            if speech.isListening {
                if let text = await speech.stop() {
                    draft = text
                }
            } else {
                await speech.start()
            }
        }
    }

    /// denied·failed 안내(SearchView 동형). 확인 시 idle 복귀.
    private var speechAlertMessage: String? {
        switch speech.phase {
        case .denied: "설정에서 마이크 접근을 허용해 주세요"
        case .failed: "음성 인식을 시작하지 못했습니다. 다시 시도해 주세요"
        default: nil
        }
    }

    private var speechAlertBinding: Binding<Bool> {
        Binding(
            get: { speechAlertMessage != nil },
            set: { if !$0 { speech.reset() } }
        )
    }
}

/// 말풍선 하나: 산문 + 렌더 카드(V1 3종) + 출처 행들.
/// 산문은 한 접근성 객체, 인터랙티브 요소(PlaceRow 액션·출처 Link)는 별도 객체 유지.
private struct MessageBubbleView: View {
    let message: ChatMessage
    @AccessibilityFocusState.Binding var focusedMessageID: UUID?

    var body: some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 8) {
            bubbleText
                .padding(12)
                .background(
                    message.role == .user
                        ? Color.accentColor.opacity(0.15)
                        : Color(.secondarySystemBackground)
                )
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .accessibilityElement(children: .combine)
                .accessibilityFocused($focusedMessageID, equals: message.id)

            ForEach(Array(message.renders.enumerated()), id: \.offset) { _, render in
                renderView(render)
            }

            ForEach(message.sources, id: \.self) { source in
                sourceRow(source)
            }
        }
        .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
    }

    /// 어시스턴트 산문은 마크다운 시도(인라인 강조), 파싱 실패·사용자 발화는 평문.
    private var bubbleText: Text {
        if message.role == .assistant,
           let attributed = try? AttributedString(
               markdown: message.text,
               options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
           ) {
            return Text(attributed)
        }
        return Text(message.text)
    }

    /// V1 렌더 정책: props-driven 3종만, .unsupported는 미표시(산문이 정본).
    @ViewBuilder
    private func renderView(_ render: ChatRenderPayload) -> some View {
        switch render {
        case .places(let places):
            ForEach(places) { place in
                PlaceRow(place: place)
                    .padding(.vertical, 4)
            }
        case .addresses(let addresses):
            ForEach(addresses, id: \.roadAddr) { address in
                // 한 줄=한 객체: 도로명+우편번호 단일 텍스트(SearchView 주소 행 동형)
                Text("\(address.roadAddr), \(address.zipNo)")
            }
        case .webResults(let results):
            ForEach(results, id: \.url) { result in
                webResultRow(result)
            }
        case .unsupported:
            EmptyView()
        }
    }

    /// 웹 결과 행: 무효 URL은 텍스트로 강등(SearchView webRow 동형).
    @ViewBuilder
    private func webResultRow(_ result: WebSearchResult) -> some View {
        if let url = URL(string: result.url) {
            Link(destination: url) { webResultContent(result) }
        } else {
            webResultContent(result)
        }
    }

    private func webResultContent(_ result: WebSearchResult) -> some View {
        VStack(alignment: .leading) {
            Text(result.title)
            Text(result.snippet)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    /// 출처 행: url 있으면 Link, 없으면 Text. "출처" 헤더 없음(계획서, 과잉 제거).
    /// label은 V1 ko에선 서버가 주는 값 그대로(M8 i18n에서 정리).
    @ViewBuilder
    private func sourceRow(_ source: ChatSource) -> some View {
        if let urlString = source.url, let url = URL(string: urlString) {
            Link(source.label, destination: url)
                .font(.footnote)
        } else {
            Text(source.label)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

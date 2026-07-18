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
    /// 마이크 토글 Task in-flight 가드(더블탭 경합 차단)
    @State private var micTaskInFlight = false
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
            // 라벨 변화("음성 입력"↔"입력 중지")가 상태 신호(disabled 금지, 접근성 헌장).
            // 44pt frame은 label 안쪽 + contentShape — 버튼 바깥 frame은 히트 영역을 안 넓힌다.
            Button(action: toggleMic) {
                Label(
                    speech.isListening ? "입력 중지" : "음성 입력",
                    systemImage: speech.isListening ? "mic.fill" : "mic"
                )
                .labelStyle(.iconOnly)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
            }
            // 전송 중 비활성은 disabled 대신 핸들러 가드(포커스 이탈 방지, 접근성 헌장).
            // 라벨 변화("보내기"→"전송 중")가 스트리밍 중 무시 상태의 시각·낭독 신호.
            Button(action: sendDraft) {
                Text(model.isStreaming ? "전송 중" : "보내기")
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
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
    /// in-flight 가드: 더블탭이 두 Task를 띄워 start/stop이 인터리브되는 경합 차단(접근성 헌장).
    private func toggleMic() {
        guard !micTaskInFlight else { return }
        micTaskInFlight = true
        Task {
            defer { micTaskInFlight = false }
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
            bubbleContent
                .padding(12)
                .background(
                    message.role == .user
                        ? Color.accentColor.opacity(0.15)
                        : Color(.secondarySystemBackground)
                )
                .clipShape(RoundedRectangle(cornerRadius: 12))

            ForEach(Array(message.renders.enumerated()), id: \.offset) { _, render in
                renderView(render)
            }

            ForEach(message.sources, id: \.self) { source in
                sourceRow(source)
            }
        }
        .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
    }

    /// 어시스턴트 산문은 블록(헤딩·리스트 항목·단락)마다 별도 Text = 별도 접근성 객체.
    /// 통짜 단일 Text는 VoiceOver에 객체 하나로 노출돼 구조 탐색이 불가능하다
    /// (위원장 실기기 실측 2026-07-18, 웹 react-markdown 블록 노드의 iOS 문법).
    /// 헤딩 블록은 .isHeader trait으로 로터 헤딩 탐색 지원. 답변 도착 포커스는 첫 블록에.
    /// 사용자 발화는 원문 그대로 단일 평문 Text(마크다운 해석·재구성 금지).
    @ViewBuilder
    private var bubbleContent: some View {
        if message.role == .assistant {
            let blocks = parseChatMarkdownBlocks(message.text)
            if blocks.isEmpty {
                Text(message.text)
                    .accessibilityFocused($focusedMessageID, equals: message.id)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(blocks.indices, id: \.self) { index in
                        if index == 0 {
                            blockView(blocks[index])
                                .accessibilityFocused($focusedMessageID, equals: message.id)
                        } else {
                            blockView(blocks[index])
                        }
                    }
                }
            }
        } else {
            Text(message.text)
                .accessibilityFocused($focusedMessageID, equals: message.id)
        }
    }

    @ViewBuilder
    private func blockView(_ block: ChatMarkdownBlock) -> some View {
        switch block {
        case .heading(let text):
            inlineText(text)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
        case .listItem(let text):
            inlineText(text)
        case .paragraph(let text):
            inlineText(text)
        }
    }

    /// 블록 내부 인라인 강조(**) 해석. 파싱 실패는 평문 강등.
    private func inlineText(_ string: String) -> Text {
        if let attributed = try? AttributedString(
            markdown: string,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return Text(attributed)
        }
        return Text(string)
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

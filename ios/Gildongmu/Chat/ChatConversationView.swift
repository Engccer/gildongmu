import SwiftUI
import UIKit
import Accessibility
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
    /// 완료 시 마지막 질문 헤딩으로 VoiceOver 포커스 이동(헌장 §6 포커스 계약)
    @AccessibilityFocusState private var focusedMessageID: UUID?
    /// 포커스 계약(헌장 §6, 위원장 실기기 판정 2026-07-19 dodo R184 역이식): 전송 시
    /// 항상 존재하는 보내기 버튼으로 이동해 생성 내내 머물고(포커스를 쥔 추천 질문
    /// 버튼이 전송으로 제거되며 VO가 최상단 리셋되는 이탈 차단), 완료 시에만 마지막
    /// 질문 헤딩으로 이동한다. 구계약(전송 즉시 질문 헤딩 선점)은 폐기 — 완료 재확정이
    /// 같은 값 재대입 no-op이 되어 생성 중 콘텐츠 삽입에 뺏긴 포커스가 복귀하지 못했다.
    @AccessibilityFocusState private var isSendFocused: Bool
    /// 진행 중인 완료 포커스 시퀀스(400ms 가시화 대기 + 600ms 실패 감지 + 재시도).
    /// 새 답변 도착·뷰 이탈 시 취소해 옛 질문으로의 지연 대입 잔류를 막는다.
    @State private var completionFocusTask: Task<Void, Never>?

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
                // 전송 시: 질문을 화면에 보이게 스크롤하고, VO 포커스는 항상 존재하는
                // 보내기 버튼으로 선점 이동(유지, 헌장 §6). 포커스를 쥔 요소(추천 질문
                // 버튼 등)가 전송으로 사라지면 VO가 최상단으로 리셋되는 이탈을 차단한다.
                // 타이핑 전송은 이미 보내기 버튼 근처라 사실상 무이동.
                .onChange(of: model.questionRevision) {
                    if let lastUser = model.messages.last(where: { $0.role == .user }) {
                        proxy.scrollTo(lastUser.id, anchor: .bottom)
                    }
                    isSendFocused = true
                }
                // 완료 시에만 질문 헤딩으로 이동(헌장 §6): 질문에 앉으면 다음 스와이프가
                // 자연스럽게 답변 첫 블록으로 이어진다. VO 실행 중엔 하단(답변) 스크롤
                // 대신 질문 상단 스크롤로 목적지를 단일화한다 — ScrollView는 화면 밖
                // 요소를 AX 트리에서 컬링해 포커스 대입이 조용히 실패하므로(dodo R184
                // 실기기 로그 확정) "스크롤 가시화 → 400ms 후 포커스" 2단계가 필수다.
                // VO 미실행 시엔 기존 시각 동작(답변 하단 스크롤) 유지.
                // 새 답변 도착 시 이전 완료 시퀀스를 취소하고, 대기 중 새 질문이 전송되면
                // (isStreaming) 지연 대입을 중단한다 — 이미 보내기 버튼으로 옮겨간 포커스를
                // 옛 질문으로 되돌리는 경합 차단(리뷰 검출). ⚠ .task(id:) 대체 금지 —
                // 탭 복귀 재-appear마다 마지막 revision으로 재실행돼 포커스를 끌어간다.
                .onChange(of: model.answerRevision) {
                    completionFocusTask?.cancel()
                    completionFocusTask = Task { @MainActor in
                        await runCompletionFocusSequence(proxy)
                    }
                }
            }
            Divider()
            inputBar
        }
        .onAppear {
            #if DEBUG
            installChatFocusObserverOnce()
            #endif
        }
        .onDisappear {
            // 마이크는 항상 폐기(화면을 떠난 뒤 유령 청취 방지 — 탭 전환 포함)
            Task { await speech.cancel() }
            // 완료 포커스 시퀀스도 폐기(화면을 떠난 뷰의 지연 포커스 대입 방지)
            completionFocusTask?.cancel()
            completionFocusTask = nil
            guard cancelsOnDisappear else { return }
            model.cancel()
        }
        .alert(speechAlertMessage ?? "", isPresented: speechAlertBinding) {
            Button(String(localized: "ios.common.ok")) {}
        }
    }

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField(String(localized: "chat.inputLabel"), text: $draft)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.send)
                .onSubmit(sendDraft)
            // 라벨 변화("받아쓰기 시작"↔"받아쓰기 중지")가 상태 신호(disabled 금지, 접근성 헌장).
            // "음성 입력"은 금지 — 받아쓴 질문에 "음성"이 들어가면 SR 낭독에서 내용과
            // 컨트롤 라벨이 구분 안 됨(위원장 실기기 실측 2026-07-18, SearchView 동일 적용).
            // 44pt frame은 label 안쪽 + contentShape — 버튼 바깥 frame은 히트 영역을 안 넓힌다.
            Button(action: toggleMic) {
                Label(
                    speech.isListening ? String(localized: "voice.stop") : String(localized: "ios.voice.start"),
                    systemImage: speech.isListening ? "mic.fill" : "mic"
                )
                .labelStyle(.iconOnly)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
            }
            // 전송 중 비활성은 disabled 대신 핸들러 가드(포커스 이탈 방지, 접근성 헌장).
            // 라벨 변화("보내기"→"전송 중")가 스트리밍 중 무시 상태의 시각·낭독 신호.
            // 전송 시 VO 포커스가 여기로 선점 이동해 생성 내내 머문다(헌장 §6).
            Button(action: sendDraft) {
                Text(model.isStreaming ? String(localized: "ios.chat.sending") : String(localized: "chat.send"))
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityFocused($isSendFocused)
        }
        .padding()
    }

    /// 완료 포커스 시퀀스(헌장 §6, dodo R184 이식): VO 실행 중이면 질문 상단 스크롤로
    /// 가시화 → 400ms 후 포커스 대입 → 600ms 후 바인딩 nil 리셋(AX 컬링 실패 신호)
    /// 감지 시 재스크롤+1회 재시도. 각 체크포인트에서 취소·새 질문 전송(isStreaming)을
    /// 확인해 stale 대입을 중단한다. VO 미실행 시엔 답변 하단 스크롤만(기존 시각 동작).
    private func runCompletionFocusSequence(_ proxy: ScrollViewProxy) async {
        guard let last = model.messages.last else { return }
        #if DEBUG
        chatFocusLog("completion: voRunning=\(UIAccessibility.isVoiceOverRunning) sendFocused=\(isSendFocused)")
        #endif
        guard UIAccessibility.isVoiceOverRunning,
              let lastUser = model.messages.last(where: { $0.role == .user }) else {
            proxy.scrollTo(last.id, anchor: .bottom)
            return
        }
        proxy.scrollTo(lastUser.id, anchor: .top)
        try? await Task.sleep(for: .milliseconds(400))
        guard !Task.isCancelled, !model.isStreaming else { return }
        // 보내기 버튼의 포커스 상태를 먼저 해제(이중 점유 충돌 후보 제거)
        isSendFocused = false
        focusedMessageID = lastUser.id
        #if DEBUG
        chatFocusLog("assigned question focus id=\(lastUser.id)")
        #endif
        try? await Task.sleep(for: .milliseconds(600))
        guard !Task.isCancelled, !model.isStreaming else { return }
        // 대입 실패의 진짜 신호는 바인딩 nil 리셋(대상이 AX 트리에 없으면 SwiftUI가
        // 되돌린다, dodo R184 실기기 로그 확정). 재스크롤 후 1회 재시도.
        if focusedMessageID != lastUser.id {
            #if DEBUG
            chatFocusLog("retry: rescroll + reassign (focusedMessageID=\(focusedMessageID?.uuidString ?? "nil"))")
            #endif
            proxy.scrollTo(lastUser.id, anchor: .top)
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled, !model.isStreaming else { return }
            isSendFocused = false
            focusedMessageID = lastUser.id
        }
    }

    private func sendDraft() {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !model.isStreaming else { return }
        draft = ""
        model.send(trimmed)
    }

    /// 음성 입력 토글: 최종 텍스트를 입력 필드에 넣기만(자동 전송 안 함, 질문은 검토 후 전송).
    /// in-flight 가드: 더블탭이 두 Task를 띄워 start/stop이 인터리브되는 경합 차단(접근성 헌장).
    /// 전사 성공은 침묵 금지(헌장 §6 받아쓰기 완료, dodo R184 후속 실기기 합격 이식):
    /// 포커스를 보내기 버튼으로 이동(자동 전송이 없는 설계라 다음 행동이 곧 전송) →
    /// 받아쓴 결과 원문을 polite 통지(포커스 발화 뒤 결과 낭독 순서). ⚠ SpeechService엔
    /// 자동 정지 경로가 없어(정지는 이 토글 유일) 반환값 소비로 전사 유실이 없다 —
    /// dodo의 콜백 단일 채널 전환(60초 캡 유실 실버그)은 여기선 비해당.
    private func toggleMic() {
        guard !micTaskInFlight else { return }
        micTaskInFlight = true
        Task {
            defer { micTaskInFlight = false }
            if speech.isListening {
                if let text = await speech.stop() {
                    // 직전 답변의 지연 완료 시퀀스가 대기 중이면 폐기 — isStreaming 가드는
                    // "새 질문 전송"만 걸러서, 전송 전인 받아쓰기 초안 채움 시점엔 통과해
                    // 방금 잡은 보내기 버튼 포커스를 옛 질문 헤딩으로 되돌린다(리뷰 검출).
                    completionFocusTask?.cancel()
                    completionFocusTask = nil
                    draft = text
                    isSendFocused = true
                    AccessibilityNotification.Announcement(text).post()
                }
            } else {
                await speech.start()
            }
        }
    }

    /// denied·failed 안내(SearchView 동형). 확인 시 idle 복귀.
    private var speechAlertMessage: String? {
        switch speech.phase {
        case .denied: String(localized: "ios.voice.denied")
        case .failed: String(localized: "ios.voice.failed")
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
    /// 헤딩 블록은 .isHeader trait으로 로터 헤딩 탐색 지원. 완료 포커스는 질문 헤딩이
    /// 받으므로 답변 블록엔 포커스 바인딩이 없다.
    /// 사용자 발화는 원문 그대로 단일 평문 Text(마크다운 해석·재구성 금지).
    @ViewBuilder
    private var bubbleContent: some View {
        if message.role == .assistant {
            let blocks = parseChatMarkdownBlocks(message.text)
            if blocks.isEmpty {
                Text(message.text)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(blocks.indices, id: \.self) { index in
                        blockView(blocks[index])
                    }
                }
            }
        } else {
            // 질문은 헤딩(trait만, 시각 불변): 긴 대화에서 로터 헤딩 탐색으로
            // 턴(질문) 단위 점프가 되는 유일한 경로(위원장 실기기 실측 2026-07-18)
            Text(message.text)
                .accessibilityAddTraits(.isHeader)
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

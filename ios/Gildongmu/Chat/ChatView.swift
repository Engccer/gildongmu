import SwiftUI
import UIKit
import Observation
import Accessibility
import GildongmuKit

/// 채팅 메시지 하나(앱 로컬). 웹 ChatMessage 미러.
struct ChatMessage: Identifiable {
    enum Role { case user, assistant }
    let id = UUID()
    let role: Role
    let text: String
    var renders: [ChatRenderPayload] = []
    var sources: [ChatSource] = []
}

/// 장소 채팅 상태. 장소마다 새 대화(sheet 표시마다 새 인스턴스, 웹 계약).
/// 스트림 소비는 단일 Task로 관리하고 sheet dismiss 시 취소한다(SearchModel 패턴).
@Observable @MainActor
final class ChatModel {
    let place: Place
    private(set) var messages: [ChatMessage] = []
    /// 진행 통지 문장(status 이벤트). 스트리밍 중에만 존재.
    private(set) var progress: String?
    private(set) var isStreaming = false
    /// 답변 도착 세대. 뷰가 새 답변으로 포커스를 옮기는 신호.
    private(set) var answerRevision = 0
    private var streamTask: Task<Void, Never>?

    private let service = ChatService()

    init(place: Place) {
        self.place = place
    }

    /// 전송. in-flight 가드(스트리밍 중 재진입 차단)는 호출부 가드와 이중.
    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isStreaming else { return }

        messages.append(ChatMessage(role: .user, text: trimmed))
        isStreaming = true
        let body = requestBody()

        streamTask = Task {
            var done: (text: String, renders: [ChatRenderPayload], sources: [ChatSource])?
            var errored = false
            do {
                for try await event in service.stream(body, baseURL: AppConfig.apiBaseURL) {
                    switch event {
                    case .status(let categories):
                        announceProgress(categories)
                    case .done(let text, let renders, let sources):
                        done = (text, renders, sources)
                    case .error:
                        errored = true
                    case .unknown:
                        break // 전방 호환: 미지 이벤트는 무시
                    }
                }
            } catch {
                errored = true
            }
            guard !Task.isCancelled else { return }

            progress = nil
            isStreaming = false
            if let done, !errored {
                // 빈 done.text는 오류가 아니라 폴백 문장(웹 1회 폴백 미러)
                let answer = done.text.isEmpty ? "답변을 준비하지 못했습니다" : done.text
                appendAssistant(ChatMessage(role: .assistant, text: answer, renders: done.renders, sources: done.sources), success: true)
            } else {
                appendAssistant(ChatMessage(role: .assistant, text: "답변을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요."), success: false)
            }
        }
    }

    /// sheet dismiss 시 진행 중 스트림 폐기.
    func cancel() {
        streamTask?.cancel()
        streamTask = nil
        progress = nil
        isStreaming = false
    }

    /// 답변(성공·실패 공통)을 붙이고 완료 신호: 햅틱 + 포커스 이동 세대 증가.
    /// 답변 산문은 말풍선 한 곳에만. 별도 낭독 통지 없음(포커스 이동이 곧 통지).
    private func appendAssistant(_ message: ChatMessage, success: Bool) {
        messages.append(message)
        answerRevision += 1
        UINotificationFeedbackGenerator().notificationOccurred(success ? .success : .error)
    }

    /// status 이벤트당 1회 진행 통지(웹 polite live region의 iOS 문법).
    private func announceProgress(_ categories: [String]) {
        let labels = categories.map(toolLabel).joined(separator: ", ")
        let message = labels.isEmpty ? "정보 확인 중" : "\(labels) 조회 중"
        progress = message
        AccessibilityNotification.Announcement(message).post()
    }

    /// 대화 전체 히스토리 + 장소 앵커(웹 불변식: 주변 기준은 장소, 길찾기 출발지는 실위치).
    /// userLocation은 요청하지 않고 직전 성공 좌표만 재사용(채팅 진입은 위치 요청 트리거가 아님).
    private func requestBody() -> ChatRequestBody {
        ChatRequestBody(
            messages: messages.map { .init(role: $0.role == .user ? "user" : "assistant", text: $0.text) },
            userLocation: LocationService.shared.lastCoordinate.map { .init(lat: $0.lat, lng: $0.lng) },
            locale: "ko",
            placeContext: .init(
                name: place.name,
                lat: place.lat,
                lng: place.lng,
                category: place.category.isEmpty ? nil : place.category,
                isStation: isStation(place)
            )
        )
    }

    /// 도구 카테고리 한국어 라벨(웹 messages/ko.json chat.progress.tool 미러). 미지 키는 원문 유지.
    private func toolLabel(_ category: String) -> String {
        switch category {
        case "search_places": "장소"
        case "search_address": "주소"
        case "get_subway_arrivals": "지하철 도착"
        case "get_night_clinics": "야간 진료"
        case "get_kids_places": "아이 놀 곳"
        case "get_surroundings": "주변"
        case "get_bus_arrivals": "버스 도착"
        case "get_bike_stations": "따릉이"
        case "get_air_quality": "공기질"
        case "get_station_meta": "역 정보"
        case "get_station_facilities": "역 편의시설"
        case "get_car_route": "자동차 경로"
        case "get_transit_route": "대중교통 경로"
        case "search_web": "웹 검색"
        default: category
        }
    }
}

/// 장소 채팅 sheet. 진입은 장소 상세 버튼(웹 ChatOverlay의 iOS 문법).
struct ChatView: View {
    @State private var model: ChatModel
    @State private var draft = ""
    @State private var speech = SpeechService()
    /// 완료 시 새 답변 말풍선으로 VoiceOver 포커스 이동(웹 완료 포커스 이동 미러)
    @AccessibilityFocusState private var focusedMessageID: UUID?
    @Environment(\.dismiss) private var dismiss

    init(place: Place) {
        _model = State(initialValue: ChatModel(place: place))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
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
            .navigationTitle(model.place.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("닫기") { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .onDisappear {
            model.cancel()
            // 진행 중 음성 인식도 폐기(시트 닫힘 후 마이크 잔존 방지)
            Task { await speech.cancel() }
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
            // 라벨 변화("음성 입력"↔"입력 마침")가 상태 신호(disabled 금지, 접근성 헌장)
            Button(action: toggleMic) {
                Label(
                    speech.isListening ? "입력 마침" : "음성 입력",
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

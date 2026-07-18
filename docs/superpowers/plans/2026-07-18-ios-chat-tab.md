# iOS 채팅 탭 (일반 채팅) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** gildongmu iOS 앱 첫 번째 탭으로 일반 채팅(placeContext 없음)을 추가한다. 기존 장소 채팅(sheet) 자산을 일반화해 재사용한다.

**Architecture:** 기존 `ChatView.swift`의 모델·대화 UI를 `ChatModel.swift`·`ChatConversationView.swift`로 분리 추출하고, sheet(장소 앵커)과 신규 `ChatTabView`(일반 채팅)가 공유한다. 서버·웹 변경 0 (웹 계약 "placeContext 없으면 byte-identical" 재사용).

**Tech Stack:** SwiftUI(iOS 26), Swift 6, GildongmuKit(SPM), Swift Testing(`swift test`), xcodebuild.

**Spec:** `docs/superpowers/specs/2026-07-18-ios-chat-tab-design.md`

## Global Constraints

- 접근성 헌장 준수: `disabled` 금지(핸들러 가드+in-flight 가드), 터치 타깃 ≥44pt(`minHeight: 44`), 한 줄=한 접근성 객체, 산문은 말풍선 한 곳에만, UI 라벨 이모지 금지.
- 위치 권한은 "앱 시작 즉시 금지, 기능 최초 사용 시점": 일반 채팅은 **전송 직전** 1회 시도, 탭 진입만으로 요청 금지. 장소 채팅(sheet)은 기존 계약(직전 좌표 재사용만) 불변.
- 세션 리셋(`sessionEpoch`) 시 대화 증발(별도 저장소 금지), 리셋 복귀 탭은 채팅.
- 단축어 라우팅 불변: `voiceSearch`→검색 탭(+마이크 플래그), `nearby`→내 주변 탭.
- 커밋: `git add <의도 파일>` 후 같은 명령에서 `git commit -- <의도 경로들>` (`git add -A` 금지). 커밋 이메일 `engccer@gmail.com`, 메시지 한국어.
- Xcode 프로젝트는 FileSystemSynchronizedRootGroup — `ios/Gildongmu/` 아래 신규 .swift 파일은 자동 포함(pbxproj 수정 불필요).
- 코드 주석은 주변 코드 관용구(기존 파일의 대시 사용 포함)를 따른다.

**공통 명령** (모든 태스크에서 동일):

```bash
# Kit 단위 테스트
cd /Users/hunyongkim/Mac-Projects/gildongmu/ios/GildongmuKit && swift test
# 앱 빌드 검증
cd /Users/hunyongkim/Mac-Projects/gildongmu/ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS Simulator' build
```

---

### Task 1: placeContext 생략 인코딩 보호 테스트 (GildongmuKit)

`ChatRequestBody.placeContext`는 이미 옵셔널이다. `nil`일 때 JSON에서 **키 자체가 생략**되는지(합성 Encodable의 `encodeIfPresent`)를 보호 테스트로 박는다. 서버 zod 계약상 `null`이 아니라 **부재**여야 일반 채팅으로 동작하기 때문이다.

**Files:**
- Modify: `ios/GildongmuKit/Tests/GildongmuKitTests/ChatModelsTests.swift` (파일 끝에 테스트 추가)

**Interfaces:**
- Consumes: `ChatRequestBody` (`ios/GildongmuKit/Sources/GildongmuKit/Models/ChatModels.swift:79`)
- Produces: 없음 (보호 테스트)

- [ ] **Step 1: 테스트 추가** — `ChatModelsTests.swift` 끝에:

```swift
@Test func requestBodyOmitsNilPlaceContextAndLocation() throws {
    // 일반 채팅(채팅 탭) 계약: placeContext·userLocation이 nil이면 JSON 키 자체가 생략돼야
    // 한다(null 전송 금지 — 서버는 키 부재를 일반 채팅으로 해석한다).
    let body = ChatRequestBody(
        messages: [.init(role: "user", text: "안녕")],
        userLocation: nil,
        locale: "ko",
        placeContext: nil
    )
    let json = String(decoding: try JSONEncoder().encode(body), as: UTF8.self)
    #expect(!json.contains("placeContext"))
    #expect(!json.contains("userLocation"))
    #expect(json.contains(#""locale":"ko""#))
}
```

- [ ] **Step 2: 테스트 실행**

Run: `cd /Users/hunyongkim/Mac-Projects/gildongmu/ios/GildongmuKit && swift test --filter requestBodyOmitsNilPlaceContextAndLocation`
Expected: PASS (기존 동작의 보호 테스트 — 실패하면 합성 인코딩 가정이 틀린 것이므로 STOP하고 보고)

- [ ] **Step 3: 커밋**

```bash
cd /Users/hunyongkim/Mac-Projects/gildongmu && git add ios/GildongmuKit/Tests/GildongmuKitTests/ChatModelsTests.swift && git commit -m "test(ios): placeContext nil 시 JSON 키 생략 보호 테스트" -- ios/GildongmuKit/Tests/GildongmuKitTests/ChatModelsTests.swift
```

---

### Task 2: ChatModel 분리·일반화 (place 옵션 + 일반 채팅 위치 취득)

`ChatView.swift`의 `ChatMessage`·`ChatModel`을 새 파일 `ChatModel.swift`로 이동하면서 `place`를 옵셔널로 바꾸고, 일반 채팅(place == nil)일 때만 전송 직전 위치를 1회 시도한다.

**Files:**
- Create: `ios/Gildongmu/Chat/ChatModel.swift`
- Modify: `ios/Gildongmu/Chat/ChatView.swift` (모델·메시지 타입 정의 삭제 — view만 남김, 이 태스크에서는 `init(place:)`가 넘기는 타입만 그대로 컴파일되면 됨)

**Interfaces:**
- Consumes: `ChatService`, `ChatRequestBody`, `Place`, `LocationService.shared.currentCoordinate(force:)`, `LocationService.shared.lastCoordinate`, `isStation(_:)`
- Produces: `ChatModel(place: Place? = nil)`, `ChatMessage`(변경 없음), `model.place: Place?` — Task 3·4가 사용

- [ ] **Step 1: `ios/Gildongmu/Chat/ChatModel.swift` 생성** — `ChatView.swift`에서 `ChatMessage`·`ChatModel`을 그대로 옮기되 아래 세 곳만 다르다(① `place` 타입·init ② `send()`의 위치 취득 ③ `requestBody()`의 placeContext):

```swift
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

/// 채팅 상태. place가 있으면 장소 앵커 채팅(sheet), nil이면 일반 채팅(채팅 탭).
/// 장소 채팅은 sheet 표시마다, 일반 채팅은 세션 리셋마다 새 대화(웹 계약·spec §1).
/// 스트림 소비는 단일 Task로 관리하고 sheet dismiss 시 취소한다(SearchModel 패턴).
@Observable @MainActor
final class ChatModel {
    let place: Place?
    private(set) var messages: [ChatMessage] = []
    /// 진행 통지 문장(status 이벤트). 스트리밍 중에만 존재.
    private(set) var progress: String?
    private(set) var isStreaming = false
    /// 답변 도착 세대. 뷰가 새 답변으로 포커스를 옮기는 신호.
    private(set) var answerRevision = 0
    private var streamTask: Task<Void, Never>?

    private let service = ChatService()

    init(place: Place? = nil) {
        self.place = place
    }

    /// 전송. in-flight 가드(스트리밍 중 재진입 차단)는 호출부 가드와 이중.
    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isStreaming else { return }

        messages.append(ChatMessage(role: .user, text: trimmed))
        isStreaming = true

        streamTask = Task {
            // 일반 채팅만 전송 직전 위치 1회 시도(캐시 있으면 즉시 반환, 최초만 권한 팝업).
            // 실패·거부 시 userLocation 없이 계속 — 위치는 필수가 아니다.
            // 장소 채팅은 기존 계약 유지(위치 요청 트리거 아님, 직전 좌표 재사용만).
            if place == nil {
                _ = try? await LocationService.shared.currentCoordinate()
            }
            let body = requestBody()

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
    /// 일반 채팅은 placeContext 미포함(키 생략) — 웹 "byte-identical" 계약.
    private func requestBody() -> ChatRequestBody {
        ChatRequestBody(
            messages: messages.map { .init(role: $0.role == .user ? "user" : "assistant", text: $0.text) },
            userLocation: LocationService.shared.lastCoordinate.map { .init(lat: $0.lat, lng: $0.lng) },
            locale: "ko",
            placeContext: place.map { place in
                .init(
                    name: place.name,
                    lat: place.lat,
                    lng: place.lng,
                    category: place.category.isEmpty ? nil : place.category,
                    isStation: isStation(place)
                )
            }
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
```

주의: `toolLabel` 등 나머지 본문은 기존 `ChatView.swift`의 것과 **문자 그대로 동일**해야 한다(diff는 위 ①②③ 지점만).

- [ ] **Step 2: `ChatView.swift`에서 `ChatMessage`·`ChatModel` 정의 삭제** (view 구조체들만 남김. `navigationTitle(model.place.name)`은 옵셔널 체인 필요 — `model.place?.name ?? ""`로 임시 수정, Task 3에서 sheet 래퍼로 재구성된다)

- [ ] **Step 3: 빌드 검증**

Run: `cd /Users/hunyongkim/Mac-Projects/gildongmu/ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS Simulator' build`
Expected: BUILD SUCCEEDED

- [ ] **Step 4: 커밋**

```bash
cd /Users/hunyongkim/Mac-Projects/gildongmu && git add ios/Gildongmu/Chat/ChatModel.swift ios/Gildongmu/Chat/ChatView.swift && git commit -m "refactor(ios): ChatModel 분리·place 옵션화(일반 채팅 위치 취득 분기)" -- ios/Gildongmu/Chat/ChatModel.swift ios/Gildongmu/Chat/ChatView.swift
```

---

### Task 3: ChatConversationView 추출 + ChatView sheet 래퍼 재구성

대화 UI(메시지 리스트·진행 행·말풍선·입력바·음성 알럿)를 공용 `ChatConversationView`로 추출한다. `ChatView`는 NavigationStack+닫기 툴바만 가진 sheet 래퍼로 축소된다. **기존 sheet 동작 불변이 목표.**

**Files:**
- Create: `ios/Gildongmu/Chat/ChatConversationView.swift`
- Modify: `ios/Gildongmu/Chat/ChatView.swift` (sheet 래퍼로 전면 교체)

**Interfaces:**
- Consumes: `ChatModel`, `ChatMessage` (Task 2), `SpeechService`, `PlaceRow`, `ChatRenderPayload`, `ChatSource`, `WebSearchResult`
- Produces: `ChatConversationView(model:cancelsOnDisappear:emptyContent:)` — Task 4가 사용
  - `init(model: ChatModel, cancelsOnDisappear: Bool = false, @ViewBuilder emptyContent: @escaping () -> EmptyContent)`

- [ ] **Step 1: `ios/Gildongmu/Chat/ChatConversationView.swift` 생성** — 기존 `ChatView` body 내부와 `MessageBubbleView`를 이동(내용 동일, 아래 신규 지점은 ① `emptyContent` 슬롯 ② `cancelsOnDisappear`):

```swift
import SwiftUI
import GildongmuKit

/// 공용 대화 뷰: 메시지 리스트 + 진행 표시 + 입력바(텍스트·마이크·보내기) + 음성 알럿.
/// 소비자 2곳 — 장소 채팅 sheet(ChatView)·채팅 탭(ChatTabView). 말풍선·입력바 수정은 여기 한 곳.
struct ChatConversationView<EmptyContent: View>: View {
    let model: ChatModel
    /// true면 뷰가 사라질 때 스트림·음성 인식을 폐기한다(sheet 전용).
    /// 탭에서는 false — 탭 전환은 대화 중단이 아니다(스트림은 계속 돌고 답변이 쌓인다).
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
            guard cancelsOnDisappear else { return }
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
```

이어서 같은 파일에 기존 `MessageBubbleView`를 **문자 그대로** 이동(private 유지):

```swift
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
```

- [ ] **Step 2: `ChatView.swift`를 sheet 래퍼로 전면 교체**:

```swift
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
```

- [ ] **Step 3: 빌드 검증**

Run: `cd /Users/hunyongkim/Mac-Projects/gildongmu/ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS Simulator' build`
Expected: BUILD SUCCEEDED

- [ ] **Step 4: 커밋**

```bash
cd /Users/hunyongkim/Mac-Projects/gildongmu && git add ios/Gildongmu/Chat/ChatConversationView.swift ios/Gildongmu/Chat/ChatView.swift && git commit -m "refactor(ios): 대화 UI를 ChatConversationView로 추출(sheet·탭 공용)" -- ios/Gildongmu/Chat/ChatConversationView.swift ios/Gildongmu/Chat/ChatView.swift
```

---

### Task 4: ChatTabView (빈 화면 추천 질문 포함)

**Files:**
- Create: `ios/Gildongmu/Chat/ChatTabView.swift`

**Interfaces:**
- Consumes: `ChatModel()` (Task 2), `ChatConversationView` (Task 3)
- Produces: `ChatTabView()` — Task 5가 탭에 마운트

- [ ] **Step 1: `ios/Gildongmu/Chat/ChatTabView.swift` 생성**:

```swift
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
```

- [ ] **Step 2: 빌드 검증**

Run: `cd /Users/hunyongkim/Mac-Projects/gildongmu/ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS Simulator' build`
Expected: BUILD SUCCEEDED

- [ ] **Step 3: 커밋**

```bash
cd /Users/hunyongkim/Mac-Projects/gildongmu && git add ios/Gildongmu/Chat/ChatTabView.swift && git commit -m "feat(ios): 채팅 탭 뷰(일반 채팅+추천 질문 빈 화면)" -- ios/Gildongmu/Chat/ChatTabView.swift
```

---

### Task 5: 탭 배선 (채팅을 첫 탭으로)

**Files:**
- Modify: `ios/Gildongmu/GildongmuApp.swift`

**Interfaces:**
- Consumes: `ChatTabView()` (Task 4)
- Produces: `AppTab.chat` (외부 소비자 없음)

- [ ] **Step 1: `GildongmuApp.swift` 수정** — 변경 지점 4곳:

① `AppTab`에 `.chat` 추가(doc 주석의 "첫 탭"은 이제 채팅):

```swift
/// 탭 정체성. selection이 TabView 밖(App 상태)에 살므로
/// 세션 리셋 시 `.id` 재생성만으론 첫 탭(채팅) 복귀가 안 된다 — 명시 복귀 필요.
enum AppTab {
    case chat
    case search
    case nearby
}
```

② 초기 선택 탭:

```swift
    @State private var selectedTab: AppTab = .chat
```

③ TabView 첫 탭으로 채팅 추가(검색·내 주변 뒤로 유지):

```swift
            TabView(selection: $selectedTab) {
                Tab("채팅", systemImage: "message", value: AppTab.chat) { ChatTabView() }
                Tab("검색", systemImage: "magnifyingglass", value: AppTab.search) { SearchView() }
                Tab("내 주변", systemImage: "location", value: AppTab.nearby) { NearbyHubView() }
            }
```

④ `resetSession()` 복귀 탭(주석도 갱신):

```swift
    /// 초기 화면 복귀(제목 탭·유휴 복귀 공용): 뷰 전체 재생성 + 채팅 탭 복귀.
    /// 재생성으로 채팅 대화도 증발한다(일회성 대화 계약, spec §1).
    private func resetSession() {
        sessionEpoch += 1
        selectedTab = .chat
    }
```

`consumeLaunchAction()`은 수정하지 않는다(voiceSearch→.search, nearby→.nearby 불변).

- [ ] **Step 2: 빌드 + Kit 전체 테스트**

Run: `cd /Users/hunyongkim/Mac-Projects/gildongmu/ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS Simulator' build && cd GildongmuKit && swift test`
Expected: BUILD SUCCEEDED + 전체 테스트 PASS

- [ ] **Step 3: 커밋**

```bash
cd /Users/hunyongkim/Mac-Projects/gildongmu && git add ios/Gildongmu/GildongmuApp.swift && git commit -m "feat(ios): 채팅을 첫 탭으로 — 채팅·검색·내 주변 3탭" -- ios/Gildongmu/GildongmuApp.swift
```

---

### Task 6: 실기기 배포 + 실호출 검증 + 문서·push

**Files:**
- Modify: `PROGRESS.md` (검증 로그 추가)

- [ ] **Step 1: 실기기 배포**

Run: `cd /Users/hunyongkim/Mac-Projects/gildongmu && ios/deploy-device.sh`
Expected: 설치 완료(기기 잠금 시 실행만 실패 — 스크립트 안내대로 진행)

- [ ] **Step 2: 실호출 검증(머지 게이트)** — 기기에서 확인하고 결과를 기록:
  1. 채팅 탭이 첫 탭으로 뜨고 추천 질문 4개가 보인다.
  2. 추천 질문 탭 → (최초라면) 위치 권한 팝업 → 답변 도착, 진행 통지 낭독.
  3. 일반 질문("강동역 가는 길 알려줘") 실호출 성공.
  4. 장소 sheet 채팅 회귀 없음(장소 상세 → "이 장소에 관해 물어보기").
  5. VoiceOver: 추천 질문 각각 독립 객체 → 전송 → 새 답변 말풍선으로 포커스 이동.
  (⑤는 위원장 실사용 확인이 정본 — 배포 후 확인 요청으로 마무리)

- [ ] **Step 3: PROGRESS.md에 검증 로그 추가** (기존 로그 관례에 맞춰 날짜·결과 요약 수 줄) 후 커밋·push:

```bash
cd /Users/hunyongkim/Mac-Projects/gildongmu && git add PROGRESS.md && git commit -m "docs(progress): iOS 채팅 탭 실기기 검증 로그" -- PROGRESS.md && git push
```

---

## Self-Review 결과

- 스펙 커버리지: §1→Task 5, §2→Task 3, §3→Task 2, §4→Task 4, §5→Task 2·3(기존 계약 이동), §6→Task 3·4(기존 스타일 재사용), §7→계획 전체에서 미구현(의도), §8→Task 1·5·6. 갭 없음.
- 플레이스홀더: 없음(모든 코드 스텝에 실제 코드 포함).
- 타입 일관성: `ChatModel(place: Place? = nil)`·`ChatConversationView(model:cancelsOnDisappear:emptyContent:)` 시그니처가 Task 2~5에서 동일.

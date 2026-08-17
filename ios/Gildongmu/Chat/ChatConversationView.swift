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
    /// true면 상단에 위치 표시줄을 낸다(채팅 탭 전용, 기본값). 장소 채팅 sheet(ChatView)는
    /// false — 그 화면은 `placeContext`로 장소 좌표를 앵커 삼는데, 표시줄이 있으면
    /// 사용자가 지정한 위치가 그 답에 반영된다고 오해한다(장소 앵커 불변식과 충돌,
    /// 화면을 볼 수 없는 사용자는 그 오해를 스스로 풀 수 없다). `cancelsOnDisappear`
    /// 재활용 금지 — "스트림 폐기 시점"과 "표시줄 노출"은 서로 다른 관심사라 한 플래그에
    /// 묶으면 한쪽을 바꾸려다 다른 쪽까지 움직이게 된다.
    let showsLocationBar: Bool
    /// true면 등장 시 1회 입력 필드로 VO 포커스를 선점 이동한다(동의→채팅 전환 직후 전용).
    /// Binding인 이유: 1회성 신호라 소비 즉시 호출부 상태를 false로 리셋해야 한다 —
    /// 값 타입(Bool)이었다면 호출부의 @State가 true로 영구 고정돼 탭 재방문(onAppear
    /// 재호출)마다 포커스를 반복 강탈했다(리뷰 검출).
    @Binding var focusDraftOnAppear: Bool
    /// 메시지 0개일 때 리스트 위치에 표시(채팅 탭 추천 질문). sheet는 EmptyView.
    private let emptyContent: () -> EmptyContent

    @State private var draft = ""
    @State private var speech = SpeechService()
    /// 완료 시 마지막 질문 헤딩으로 VoiceOver 포커스 이동(헌장 §6 포커스 계약)
    @AccessibilityFocusState private var focusedMessageID: UUID?
    /// 포커스 계약(헌장 §6, 위원장 실기기 판정 2026-07-19 dodo R184 역이식): 전송 시
    /// 항상 존재하는 보내기 버튼으로 이동해 생성 내내 머물고(포커스를 쥔 추천 질문
    /// 버튼이 전송으로 제거되며 VO가 최상단 리셋되는 이탈 차단), 완료 시에만 마지막
    /// 질문 헤딩으로 이동한다. 구계약(전송 즉시 질문 헤딩 선점)은 폐기 — 완료 재확정이
    /// 같은 값 재대입 no-op이 되어 생성 중 콘텐츠 삽입에 뺏긴 포커스가 복귀하지 못했다.
    @AccessibilityFocusState private var isSendFocused: Bool
    /// 지우기 버튼이 초안 소거로 자신을 제거할 때 포커스를 입력 필드로 선점 이동
    /// (포커스를 쥔 요소의 제거는 VO 최상단 이탈을 유발, 헌장 §5)
    @AccessibilityFocusState private var isDraftFocused: Bool
    /// 진행 중인 완료 포커스 시퀀스(400ms 가시화 대기 + 600ms 실패 감지 + 재시도).
    /// 새 답변 도착·뷰 이탈 시 취소해 옛 질문으로의 지연 대입 잔류를 막는다.
    @State private var completionFocusTask: Task<Void, Never>?
    /// 채팅 안 장소 상세 시트(카드 활성화·산문 블록 커스텀 액션 공용 진입). item 기반이라
    /// 다른 장소를 열면 시트 내용이 교체된다.
    @State private var detailPlace: Place?
    /// 상세 시트를 연 원점(카드 행·산문 블록)의 포커스 키. 시트가 닫히면 여기로 복원한다 —
    /// 시트 소멸은 포커스를 쥔 화면이 통째로 바뀌는 전이라 방치하면 VO가 최상단으로
    /// 이탈한다(헌장 §5). 키는 "card-<메시지>-<장소>" / "block-<메시지>-<블록>".
    @AccessibilityFocusState private var focusedOriginKey: String?
    @State private var pendingOriginKey: String?
    @State private var originFocusTask: Task<Void, Never>?

    init(
        model: ChatModel,
        cancelsOnDisappear: Bool = false,
        showsLocationBar: Bool = true,
        focusDraftOnAppear: Binding<Bool> = .constant(false),
        @ViewBuilder emptyContent: @escaping () -> EmptyContent
    ) {
        self.model = model
        self.cancelsOnDisappear = cancelsOnDisappear
        self.showsLocationBar = showsLocationBar
        self._focusDraftOnAppear = focusDraftOnAppear
        self.emptyContent = emptyContent
    }

    var body: some View {
        VStack(spacing: 0) {
            if showsLocationBar {
                LocationBarView().padding(.horizontal)
            }
            ScrollViewReader { proxy in
                ScrollView {
                    // ⚠ LazyVStack 금지(2026-07-20 실기기 cpu_resource 리포트로 확정):
                    // 대화가 몇 턴 쌓이면 lazy 레이아웃 캐시(LazySubviewPlacements)가
                    // 크기 추정 진동으로 매 UI 사이클 트랜잭션을 재발행해 메인 스레드
                    // 100% CPU 무한 루프(앱 먹통, VO 전면 무응답). 채팅 히스토리는
                    // 세션당 유한하므로 eager VStack이 정본 — 진동 기제 자체가 없고,
                    // 화면 밖 요소 AX 컬링(완료 포커스 대입 실패 원인)도 함께 해소.
                    VStack(alignment: .leading, spacing: 12) {
                        if model.messages.isEmpty {
                            emptyContent()
                        }
                        ForEach(model.messages) { message in
                            MessageBubbleView(
                                message: message,
                                focusedMessageID: $focusedMessageID,
                                focusedOriginKey: $focusedOriginKey,
                                onOpenPlace: { place, originKey in
                                    pendingOriginKey = originKey
                                    detailPlace = place
                                }
                            )
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
        // 장소 상세: 표준 시트 + 닫기 버튼(장소 채팅 시트·안내 시트 "장소 상세 보기" 동형).
        // 닫히면 연 원점(카드·블록)으로 포커스 복원 — 대입은 지연·검증·1회 재시도(정본 절차).
        .sheet(item: $detailPlace, onDismiss: restoreOriginFocus) { place in
            ChatPlaceDetailSheet(place: place)
        }
        .onAppear {
            #if DEBUG
            installChatFocusObserverOnce()
            #endif
            // 동의→채팅 전환 직후 1회: 사라진 동의 버튼에서 입력 필드로 선점 이동(헌장 §5).
            // 400ms 지연은 VO 재시도 관례(전환 렌더 안정 후 포커스).
            guard focusDraftOnAppear else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                isDraftFocused = true
                // 1회 소비 후 리셋 — 탭 재방문(onAppear 재호출)마다 포커스가
                // 반복 강탈되지 않도록 신호를 여기서 끈다.
                focusDraftOnAppear = false
            }
        }
        .onDisappear {
            // 마이크는 항상 폐기(화면을 떠난 뒤 유령 청취 방지 — 탭 전환 포함)
            Task { await speech.cancel() }
            // TTS도 항상 정지 — 화면을 떠난 대화의 유령 낭독 방지(마이크와 같은 규율)
            TtsPlayer.shared.stop()
            // 완료 포커스 시퀀스도 폐기(화면을 떠난 뷰의 지연 포커스 대입 방지)
            completionFocusTask?.cancel()
            completionFocusTask = nil
            originFocusTask?.cancel()
            originFocusTask = nil
            pendingOriginKey = nil
            guard cancelsOnDisappear else { return }
            model.cancel()
        }
        .alert(speechAlertMessage ?? "", isPresented: speechAlertBinding) {
            // 권한 거부는 설정으로만 해결된다. 안내에 그 화면을 여는 버튼을 함께
            // (위치 안내와 같은 계약, 리뷰 M-2 수용)
            if case .denied = speech.phase {
                Button(appLocalized("ios.common.openSettings")) { openAppSettings() }
            }
            Button(appLocalized("ios.common.ok")) {}
        }
    }

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField(appLocalized("chat.inputLabel"), text: $draft)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.send)
                .onSubmit(sendDraft)
                .accessibilityFocused($isDraftFocused)
            // 텍스트 지우기(검색창 시스템 clear 버튼의 채팅 판, 2026-07-20 위원장 요청).
            // 초안이 있을 때만 존재 — 지우면 자신이 사라지므로 포커스를 입력 필드로
            // 선점 이동(§5). 키보드 재진입은 VO 제약상 직접 더블탭 필요(프로그래밍 불가).
            if !draft.isEmpty {
                Button {
                    draft = ""
                    isDraftFocused = true
                } label: {
                    Label(appLocalized("ios.chat.clear"), systemImage: "xmark.circle.fill")
                        .labelStyle(.iconOnly)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
            }
            // WhatsApp식 홀드 받아쓰기(2026-07-20 탭 토글 대체): 누르는 동안 녹음,
            // 떼면 즉시 전송. 위로 밀면 잠금(일시정지) — 전사를 입력창에 확정해
            // 확인·수정 후 다시 길게 눌러 이어쓴다. 왼쪽 밀기=취소. 라벨 "받아쓰기"는
            // 행위 일반명사 충돌 회피("음성 입력" 금지 — 받아쓴 내용의 "음성"과 낭독
            // 혼동, 실측 2026-07-18).
            HoldDictationButton(
                speech: speech,
                hint: appLocalized("ios.voice.holdHintChat"),
                showsTitle: false,
                onTranscript: { text in
                    // 직전 답변의 지연 완료 시퀀스가 대기 중이면 폐기 — isStreaming 가드는
                    // "새 질문 전송"만 걸러서, 전송 전 시점엔 통과해 방금 잡은 포커스를
                    // 옛 질문 헤딩으로 되돌린다(리뷰 검출).
                    completionFocusTask?.cancel()
                    completionFocusTask = nil
                    // 초안(타이핑·잠금 확정분)과 새 전사는 병합이 정책(리뷰 검출: 무병합이면
                    // 초안이 고아로 방치): 보내는 것 = 초안 + 받아쓴 말 전부, 초안은 소거.
                    // 통지도 병합 원문 전체 — 사용자가 들은 것이 곧 전송된 것(결정론).
                    let message = mergedDraft(with: text)
                    // 전사 통지는 `.high`(D24, 2026-08-17): 바로 앞에서 포커스를 보내기
                    // 버튼으로 선점 이동하므로 VO가 그 라벨("보내기")을 낭독하고, 기본
                    // 우선순위면 이 통지가 거기에 잠식된다 — 잠식되는 것이 **사용자가
                    // 방금 말한 내용 전체**라 손실이 가장 크다. ⚠ 종전 주석의 "polite
                    // 큐라 순서 무해"가 바로 그 폐기된 전제였다(헌장 §6).
                    var spoken = AttributedString(message)
                    spoken.accessibilitySpeechAnnouncementPriority = .high
                    if DictationStyle.current == .tapToggle || model.isStreaming {
                        // 탭 토글 방식은 자동 전송 없는 클래식 계약(헌장 §6 받아쓰기 완료):
                        // 정지=초안 확정, 검토 후 전송 — 포커스를 보내기 버튼으로 이동한 뒤
                        // 받아쓴 결과 원문을 통지. 생성 중 홀드 릴리스도 같은 경로
                        // (전송 불가 시 발화 유실 금지 — 초안으로 보존).
                        draft = message
                        isSendFocused = true
                        AccessibilityNotification.Announcement(spoken).post()
                    } else {
                        // 릴리스=즉시 전송(위원장 실기기 지시 2026-07-20, WhatsApp 동형).
                        // 순서는 헌장 §6 "포커스 먼저, 통지 나중": 보내기 버튼 포커스를
                        // 동기 선점한 뒤 통지.
                        draft = ""
                        isSendFocused = true
                        AccessibilityNotification.Announcement(spoken).post()
                        model.send(message)
                    }
                },
                // 잠금(일시정지, 2026-07-20 위원장 재설계): 전사를 초안에 확정해 별도 UI
                // 없이 확인·수정·이어쓰기. 녹음이 멈춘 뒤라 통지가 발화 금지와 무충돌.
                // 통지는 "받아쓰기 잠김" + 새 세그먼트만(누적 초안 전체 재낭독은 소음 —
                // 전체 확인은 입력 필드 탐색으로). 포커스는 건드리지 않는다(손가락이
                // 아직 마이크 위, 다음 행동이 이어쓰기·수정·전송으로 갈리는 지점).
                onPause: { segment in
                    completionFocusTask?.cancel()
                    completionFocusTask = nil
                    let notice = appLocalized("ios.voice.paused")
                    if let segment {
                        draft = mergedDraft(with: segment)
                        AccessibilityNotification.Announcement("\(notice), \(segment)").post()
                    } else {
                        AccessibilityNotification.Announcement(notice).post()
                    }
                }
            )
            // 전송 중 비활성은 disabled 대신 핸들러 가드(포커스 이탈 방지, 접근성 헌장).
            // 라벨 변화("보내기"→"전송 중")가 스트리밍 중 무시 상태의 시각·낭독 신호.
            // 전송 시 VO 포커스가 여기로 선점 이동해 생성 내내 머문다(헌장 §6).
            Button(action: sendDraft) {
                Text(model.isStreaming ? appLocalized("ios.chat.sending") : appLocalized("chat.send"))
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

    /// 상세 시트가 닫힌 뒤 연 원점으로 VO 커서를 되돌린다. 시트 dismiss 애니메이션이
    /// 끝나기 전 대입은 조용히 되돌아가므로 400ms 뒤 대입, 600ms 뒤 검증·1회 재시도
    /// (`runCompletionFocusSequence` 동형). 메시지 목록은 eager VStack이라 AX 컬링은 없다.
    private func restoreOriginFocus() {
        guard let key = pendingOriginKey else { return }
        pendingOriginKey = nil
        originFocusTask?.cancel()
        originFocusTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            focusedOriginKey = key
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, focusedOriginKey != key else { return }
            focusedOriginKey = key
        }
    }

    /// 초안(타이핑·잠금 확정분)에 새 전사를 공백 한 칸으로 병합. 공백뿐인 초안은 버린다.
    private func mergedDraft(with text: String) -> String {
        let typed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return typed.isEmpty ? text : "\(typed) \(text)"
    }

    private func sendDraft() {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !model.isStreaming else { return }
        draft = ""
        model.send(trimmed)
    }

    /// denied·failed 안내(SearchView 동형, 판정 정본은 speechAlertText). 확인 시 idle 복귀.
    private var speechAlertMessage: String? { speechAlertText(speech) }

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
    /// 상세 시트 원점 복원용(카드 행·산문 블록). ChatConversationView 소유.
    @AccessibilityFocusState.Binding var focusedOriginKey: String?
    /// 장소 상세 열기(장소, 원점 포커스 키).
    let onOpenPlace: (Place, String) -> Void

    /// 이 답변의 카드 장소 — 산문 블록 커스텀 액션의 유일한 근거(장소 앵커 모드처럼
    /// 서버가 카드를 생략하면 자연히 빈 배열이라 액션도 없다).
    private var cardPlaces: [Place] {
        message.renders.flatMap { render -> [Place] in
            if case .places(let places) = render { return places }
            return []
        }
    }

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

            // 구획 헤딩(위원장 실기기 판정 2026-08-17): 산문 → 카드 → 출처 경계가 VO 선형
            // 읽기에서 들리지 않았다. 카드 묶음·출처 앞에 헤딩을 둔다 — 질문 헤딩 아래
            // 하위 구획이 되어 로터로 카드 시작점 점프도 된다. 수를 실어 몇 개를 지나갈지
            // 알린다. 있는 것만 낸다(빈 묶음에 헤딩 금지).
            ForEach(Array(message.renders.enumerated()), id: \.offset) { _, render in
                if let heading = renderHeading(render) {
                    sectionHeading(heading)
                }
                renderView(render)
            }

            if !message.sources.isEmpty {
                sectionHeading(appLocalized("ios.chat.sourcesHeading"))
            }
            ForEach(message.sources, id: \.self) { source in
                sourceRow(source)
            }

            // 응답 액션 행(dodo 이식): VO 스와이프 순서상 답변 블록·카드·출처 다음이
            // 자연스러워 맨 끝에 둔다. 완료 포커스 계약(질문 헤딩)은 건드리지 않는다.
            if message.role == .assistant {
                HStack(spacing: 8) {
                    listenButton
                    // 듣기·공유 모두 응답 원문(message.text)을 그대로 쓴다(블록 분리는
                    // 렌더 전용). 출처는 본문 밖 sources 필드라 자연히 제외된다.
                    ShareLink(item: message.text) {
                        Label(appLocalized("ios.chat.share"), systemImage: "square.and.arrow.up")
                            .labelStyle(.iconOnly)
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
    }

    /// 응답 전문 듣기 버튼. 라벨 전환(듣기 ↔ 재생 중지)만으로 상태를 전달한다
    /// (`isSelected` trait 병용 금지 — 헌장 aria-pressed 교훈의 iOS 등가). 미디어 재생
    /// 버튼이라 `.startsMediaSession` trait. 44pt frame은 label 안쪽 + contentShape —
    /// 버튼 바깥 frame은 히트 영역을 안 넓힌다(dodo 주석의 gildongmu 실측 역수입).
    private var listenButton: some View {
        let isPlaying = TtsPlayer.shared.isPlayingMessage(message.id)
        return Button {
            Task { await TtsPlayer.shared.playMessage(messageID: message.id, text: message.text) }
        } label: {
            Image(systemName: isPlaying ? "stop.circle.fill" : "speaker.wave.2.circle")
                .accessibilityHidden(true)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(appLocalized(isPlaying ? "ios.chat.listenStop" : "ios.chat.listen"))
        .accessibilityAddTraits(.startsMediaSession)
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
                        blockView(blocks[index], index: index)
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

    /// 산문 블록 하나. 블록은 언제나 **한 접근성 객체**이고, 카드 장소 언급 수에 따라
    /// 활성화 방식만 가른다(위원장 판정 2026-08-17, 실호출 표본 27블록 중 26이 1개):
    /// - 0개: 평문.
    /// - 1개(지배적): 블록 전체가 버튼 — VO는 "…, 버튼"으로 읽고 더블탭이 곧 상세, 시각
    ///   사용자는 그 줄 어디를 탭해도 열린다. 이름만 링크색으로 표시(링크 속성 없음 —
    ///   Text가 단일 객체로 남는 것이 보장된다). 로터 액션은 잉여라 붙이지 않는다.
    /// - 2개 이상(드묾): 이름마다 인라인 링크(시각 사용자의 이름별 탭) + 로터 커스텀
    ///   액션(VO). ⚠ Text 안 링크가 VO 객체를 쪼개는지는 실기기 판정 대기 — 쪼개면
    ///   `.accessibilityElement(children: .combine)`으로 묶는다(실측 전 선반영 금지).
    ///   헤딩 블록에 언급 1개인 경우 `.isHeader`가 감싼 Button으로 전파되는지도 같은 판정
    ///   항목(선례 없음, 실패해도 헤딩 로터 발견성만 잃는다).
    @ViewBuilder
    private func blockView(_ block: ChatMarkdownBlock, index: Int) -> some View {
        let mentions = chatPlaceMentions(in: block.text, places: cardPlaces)
        let originKey = "block-\(message.id.uuidString)-\(index)"
        let text = styledBlockText(block, mentions: mentions)
        switch mentions.count {
        case 0:
            text
        case 1:
            Button {
                onOpenPlace(mentions[0], originKey)
            } label: {
                text
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityFocused($focusedOriginKey, equals: originKey)
        default:
            text
                // 인라인 링크 탭(시각 사용자): 자체 스킴 URL을 가로채 상세로.
                .environment(\.openURL, OpenURLAction { url in
                    guard let place = Self.mentionedPlace(for: url, in: mentions) else { return .systemAction }
                    onOpenPlace(place, originKey)
                    return .handled
                })
                .accessibilityFocused($focusedOriginKey, equals: originKey)
                // ⚠ 선언은 역순: VoiceOver 로터가 빌더 선언의 역순으로 노출된다(PlaceRow 실측).
                // 산문 등장 순으로 들리도록 뒤집어 선언.
                .accessibilityActions {
                    ForEach(Array(mentions.reversed())) { place in
                        Button(appLocalized("ios.chat.openPlace", place.name)) {
                            onOpenPlace(place, originKey)
                        }
                    }
                }
        }
    }

    /// 인라인 강조(**) 해석 + 헤딩 스타일 + 장소명 강조. 언급 1개면 이름을 링크색으로만
    /// 물들이고, 2개 이상이면 이름마다 링크 속성(자체 스킴)을 건다. 파싱 실패는 평문 강등.
    private func styledBlockText(_ block: ChatMarkdownBlock, mentions: [Place]) -> some View {
        var attributed = (try? AttributedString(
            markdown: block.text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(block.text)
        for (index, place) in mentions.enumerated() {
            var search = attributed.startIndex
            while search < attributed.endIndex,
                  let range = attributed[search...].range(of: place.name) {
                if mentions.count == 1 {
                    attributed[range].foregroundColor = .accentColor
                } else {
                    attributed[range].link = Self.mentionURL(index: index)
                }
                search = range.upperBound
            }
        }
        var text = Text(attributed)
        if block.isHeading {
            text = text.font(.headline)
        }
        return text.accessibilityAddTraits(block.isHeading ? .isHeader : [])
    }

    /// 인라인 링크용 자체 스킴. 언급 순번만 담는다(장소 id는 URL에 안전하지 않은 문자를 가질 수 있다).
    private static func mentionURL(index: Int) -> URL {
        URL(string: "gildongmu-place-mention:///\(index)")!
    }

    private static func mentionedPlace(for url: URL, in mentions: [Place]) -> Place? {
        guard url.scheme == "gildongmu-place-mention",
              let index = Int(url.lastPathComponent),
              mentions.indices.contains(index) else { return nil }
        return mentions[index]
    }

    /// 구획 헤딩 한 줄: 시각은 작은 보조 캡션, VO는 헤딩.
    private func sectionHeading(_ title: String) -> some View {
        Text(title)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.top, 4)
            .accessibilityAddTraits(.isHeader)
    }

    /// 렌더 묶음의 헤딩 문구(수 포함). 미표시 렌더(.unsupported)·빈 묶음은 nil.
    private func renderHeading(_ render: ChatRenderPayload) -> String? {
        switch render {
        case .places(let places) where !places.isEmpty:
            return appLocalized("ios.chat.placesHeading", String(places.count))
        case .addresses(let addresses) where !addresses.isEmpty:
            return appLocalized("ios.chat.addressesHeading", String(addresses.count))
        case .webResults(let results) where !results.isEmpty:
            return appLocalized("ios.chat.webResultsHeading", String(results.count))
        default:
            return nil
        }
    }

    /// V1 렌더 정책: props-driven 3종만, .unsupported는 미표시(산문이 정본).
    @ViewBuilder
    private func renderView(_ render: ChatRenderPayload) -> some View {
        switch render {
        case .places(let places):
            // 카드 활성화 = 장소 상세(검색 탭 NavigationLink 래핑 동형 — 커스텀 액션은
            // 라벨 안 PlaceRow의 것이 그대로 로터에 오른다). 시각은 정보 행 그대로(.plain).
            ForEach(places) { place in
                let originKey = "card-\(message.id.uuidString)-\(place.id)"
                Button {
                    onOpenPlace(place, originKey)
                } label: {
                    PlaceRow(place: place)
                        .padding(.vertical, 4)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityFocused($focusedOriginKey, equals: originKey)
            }
        case .addresses(let addresses):
            ForEach(addresses, id: \.roadAddr) { address in
                // 한 줄=한 객체: 도로명+우편번호 단일 텍스트(SearchView 주소 행 동형)
                Text("\(address.roadAddr), \(address.zipNo)")
                    .addressCopyActions(address)
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

    /// 출처 행: url 있으면 Link, 없으면 Text. 묶음 앞 "출처" 헤딩은 호출부(`sectionHeading`)가 낸다.
    @ViewBuilder
    private func sourceRow(_ source: ChatSource) -> some View {
        let label = Self.sourceDisplayLabel(source.label)
        if let urlString = source.url, let url = URL(string: urlString) {
            Link(label, destination: url)
                .font(.footnote)
        } else {
            Text(label)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    /// 서버 SourceAttribution.label("source.<id>" i18n 키)을 표시 문자열로 변환 —
    /// 웹 SourceList의 `chat.<label>` 번역 계약 미러. appLocalized는 린터 계약상
    /// 리터럴 키만 허용하므로 동적 결합 대신 switch로 열거하고, 미지의 라벨은
    /// 원문을 그대로 보여 새 출처의 키 누락이 화면에서 드러나게 한다.
    static func sourceDisplayLabel(_ label: String) -> String {
        switch label {
        case "source.airkorea": return appLocalized("chat.source.airkorea")
        case "source.juso": return appLocalized("chat.source.juso")
        case "source.kakao": return appLocalized("chat.source.kakao")
        case "source.kakaomobility": return appLocalized("chat.source.kakaomobility")
        case "source.kma": return appLocalized("chat.source.kma")
        case "source.korail": return appLocalized("chat.source.korail")
        case "source.kric": return appLocalized("chat.source.kric")
        case "source.ncp": return appLocalized("chat.source.ncp")
        case "source.nmc": return appLocalized("chat.source.nmc")
        case "source.odsay": return appLocalized("chat.source.odsay")
        case "source.osm": return appLocalized("chat.source.osm")
        case "source.perplexity": return appLocalized("chat.source.perplexity")
        case "source.seoulmetro": return appLocalized("chat.source.seoulmetro")
        case "source.seoulopen": return appLocalized("chat.source.seoulopen")
        case "source.tago": return appLocalized("chat.source.tago")
        case "source.tmap": return appLocalized("chat.source.tmap")
        case "source.tourapi": return appLocalized("chat.source.tourapi")
        default: return label
        }
    }
}

/// 채팅 안 장소 상세 시트: 닫기 버튼으로 채팅으로 돌아온다(ChatView 시트 툴바 동형).
private struct ChatPlaceDetailSheet: View {
    let place: Place
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            // 채팅 안에서 연 상세라 "물어보기"는 숨긴다(채팅 위 채팅 시트 순환 방지).
            PlaceDetailView(place: place, showsChatEntry: false)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(appLocalized("actions.close")) { dismiss() }
                    }
                }
        }
    }
}

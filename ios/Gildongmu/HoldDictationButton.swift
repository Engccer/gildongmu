import SwiftUI
import UIKit
import Accessibility

/// 받아쓰기 버튼 동작 방식 영속값(접근성 헌장 §6의 두 계약 중 택1, 2026-07-27 설정화).
/// 기본은 탭 토글(위원장 결정 2026-07-29, App Store 심사 대응): 비-VoiceOver 심사자가
/// 마이크를 짧게 탭했을 때 홀드 기본값에서는 가시 반응이 없어 "음성이 안 된다"로
/// 반려됐다 — 탭 토글 기본 전환이 이 무반응을 구조적으로 제거한다. 홀드는 설정에서
/// 선택할 수 있고 그 계약은 아래 그대로 유지된다. 순서는 CaseIterable로 설정 Picker
/// 노출 순서를 겸한다(rawValue 문자열은 기존 저장값 호환을 위해 불변).
enum DictationStyle: String, CaseIterable {
    case tapToggle
    case hold

    static let key = "dictationStyle"

    /// 뷰 밖(전달 콜백 등) 판단 지점용 현재 방식. 뷰 갱신 관찰은 @AppStorage가 담당.
    static var current: DictationStyle {
        DictationStyle(rawValue: UserDefaults.standard.string(forKey: key) ?? "") ?? .tapToggle
    }

    var label: String {
        switch self {
        case .hold: appLocalized("ios.settings.dictationHold")
        case .tapToggle: appLocalized("ios.settings.dictationTap")
        }
    }
}

/// WhatsApp식 홀드 받아쓰기 버튼(2026-07-20 위원장 결정, 탭 토글 대체 후
/// 2026-07-29 기본값이 다시 탭 토글로 전환 — 위 DictationStyle 주석 참조).
/// 설정(`DictationStyle`)이 탭 토글이면 클래식 계약(73fb4e7 이전, 탭=시작·재탭=정지,
/// 라벨 전환 "받아쓰기 시작"↔"받아쓰기 중지"가 상태 신호)으로 동작한다 — 아래 홀드
/// 계약 주석은 설정에서 홀드를 선택했을 때에만 해당한다.
/// 누르고 있는 동안(홀드 성립 250ms 후) 녹음하고 손을 떼면 최종 텍스트를 onTranscript로
/// 전달한다(채팅=즉시 전송, 검색=자동 검색).
///
/// 잠금(위로 밀기, onPause 소비자=채팅 전용)은 "일시정지 + 확정"이다(2026-07-20 위원장
/// 재설계 — WhatsApp의 핸즈프리 계속 녹음이 아님): 녹음을 멈추고 그때까지의 전사를
/// onPause로 전달해 입력창에 넣는다. 사용자는 텍스트를 확인·수정한 뒤 다시 길게 눌러
/// 이어서 받아쓴다(릴리스 시 초안+새 전사 병합 전송은 소비자 몫). 녹음이 멈춘 뒤라
/// "받아쓰기 잠김" 통지가 "녹음 중 VO 발화 0" 원칙과 충돌하지 않는다 — 별도 잠금
/// UI 없이 중간 확인·수정·이어쓰기가 성립하는 근거. 왼쪽 밀기=취소(그 세션 전사만 폐기).
///
/// VoiceOver 계약(위원장 요구):
/// - 두 번 탭 뒤 유지(pass-through)가 그대로 홀드로 전달된다. 짧은 탭(더블탭 활성화)은
///   녹음 없이 사용법 안내만 polite 통지 — 유령 시작·즉시 정지 소음을 만들지 않는다.
/// - 녹음 시작 순간 interrupting 무음 통지로 진행 중 낭독(라벨·힌트)을 즉시 끊는다.
///   받아쓰기 중 VO 발화가 마이크 입력과 겹치지 않아야 한다는 것이 핵심 요구.
/// - 세션 중 접근성 라벨 불변: 포커스를 쥔 요소의 라벨 변경은 VO 재낭독을 유발하므로
///   (탭 토글 시절의 라벨 전환 신호는 폐기) 녹음 중 상태 신호는 시작·정지음과 햅틱만.
///
/// 제스처는 UIKit 인식기 계층(HoldGestureCatcher)이 정본이다. SwiftUI
/// LongPressGesture.sequenced(DragGesture) 조합은 실기기에서 두 결함이 확정됐다
/// (2026-07-20 위원장 실측): ① List(UIScrollView) 안에서 스크롤 팬에 가로채여
/// 검색 탭 홀드가 아예 성립하지 않음 ② VO pass-through에서 드래그 추적이 유실돼
/// 위로 밀기가 미동작. UIKit UILongPressGestureRecognizer는 스크롤 팬과의
/// 경합을 시스템 규칙으로 판정하고(정지 0.25s=홀드 승리, 플릭=팬 승리) began 이후
/// 이동을 .changed로 연속 전달한다 — WhatsApp류 홀드 녹음의 표준 구현 계층.
struct HoldDictationButton: View {
    let speech: SpeechService
    /// 사용법 힌트(VoiceOver) — 화면별 동작 차이를 문구로 전달
    let hint: String
    /// true면 아이콘+제목의 List 행 표시(검색), false면 아이콘만(채팅 입력바)
    let showsTitle: Bool
    /// 릴리스(확정) 전달 — 채팅=전송, 검색=자동 검색
    let onTranscript: (String) -> Void
    /// 위로 밀어 잠금(일시정지) 전달. nil이면 슬라이드 액션(잠금·취소) 전체 비활성
    /// (검색은 홀드 단일 동작). 전사 없이 잠근 경우 nil 세그먼트로 호출된다 —
    /// 상태 변화(정지) 통지는 소비자가 담당.
    let onPause: ((String?) -> Void)?

    /// 잠금·취소 판정 이동량(pt). 오발동 방지와 도달성의 절충(WhatsApp 관행 수준).
    private static let slideThreshold: CGFloat = 60

    /// 이번 홀드가 녹음을 시작했는지(릴리스·슬라이드 처리 대상인지)
    @State private var sessionActive = false
    /// start() 완료 대기 핸들(권한 다이얼로그·모델 다운로드 중 릴리스 경합 직렬화)
    @State private var startTask: Task<Void, Never>?
    /// 정지·전달 in-flight 가드(연속 조작의 이중 stop 차단, 접근성 헌장)
    @State private var finishInFlight = false
    /// 취소 in-flight 가드(finishInFlight 대칭): 취소 태스크가 옛 start()를 기다리는
    /// 동안 재홀드하면 SpeechService 재진입 가드(.requesting no-op)에 새 start()가
    /// 삼켜진 뒤 옛 cancel()이 전체를 idle로 되돌려 두 번째 발화가 무음 소실(리뷰 검출)
    @State private var cancelInFlight = false
    /// 방식 전환 즉시 반영을 위한 관찰 지점(설정 시트가 App 레벨이라 이 뷰는 살아 있다)
    @AppStorage(DictationStyle.key) private var dictationStyleRaw = DictationStyle.tapToggle.rawValue
    /// 홀드 모드 짧은 탭의 비-VoiceOver용 가시 안내(3초 표시, task로 자동 소거)
    @State private var showHoldHint = false
    @State private var hintDismissTask: Task<Void, Never>?

    private var style: DictationStyle {
        DictationStyle(rawValue: dictationStyleRaw) ?? .tapToggle
    }

    var body: some View {
        if style == .tapToggle {
            tapToggleBody
        } else {
            holdBody
        }
    }

    private var holdBody: some View {
        // 가시 안내는 overlay 이탈(음수 offset)이 아니라 정상 레이아웃 흐름에 둔다 —
        // 검색·길찾기 사용처는 List 행이라 행 경계를 벗어나는 오버레이가 잘린다(실측).
        VStack(alignment: .leading, spacing: 2) {
            micRow(title: appLocalized("ios.voice.hold"))
            if showHoldHint {
                // 비-VO 사용자용 가시 안내(VO는 handleTap의 polite 통지가 담당 —
                // 이중 낭독 금지를 위해 이 Text는 접근성에서 숨긴다)
                Text(appLocalized("ios.voice.holdHintVisible"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
        }
        .overlay {
            HoldGestureCatcher(
                onBegan: beginHold,
                onMoved: handleSlide,
                onEnded: endHold,
                onTapped: handleTap
            )
        }
        .accessibilityElement()
        .accessibilityLabel(appLocalized("ios.voice.hold"))
        .accessibilityHint(hint)
        .accessibilityAddTraits(.isButton)
        // VO 더블탭(짧은 탭) 활성화는 기본적으로 "합성 터치 → HoldGestureCatcher의
        // UITapGestureRecognizer" pass-through에 의존하는데, 이 합성 터치가 탭
        // 인식기에 도달하지 못하면(기기·OS 상태 의존, 실기기 회귀 확인) handleTap이
        // 아예 호출되지 않아 사용법 안내가 침묵한다. 명시적 accessibilityAction으로
        // VO 더블탭이 이 액션을 결정론적으로 호출하게 한다. 시각 사용자의 실제 터치
        // 경로(HoldGestureCatcher, 홀드·슬라이드 포함)는 이 액션과 무관하게 그대로
        // 동작하고, VO의 "두 번 탭 뒤 유지"(pass-through로 홀드 녹음 시작)는 별도
        // 제스처라 이 짧은 탭 액션과 충돌하지 않는다.
        .accessibilityAction { handleTap() }
        // 준비 중(모델 다운로드)은 통지로만 알린다. 라벨을 "음성 인식 준비 중"으로
        // 바꿨다가 되돌리면 그 되돌림 재낭독이 다음 렌더 패스에서 생성돼 이미 뜨거워진
        // 마이크에 실린다(인터럽트는 그 시점 큐를 비울 뿐 이후 발화를 막지 못한다 —
        // 리뷰 재판정 2026-07-29). 세션 중 라벨 불변 계약을 지키고, 통지는 마이크가
        // 뜨거워지기 전인 .preparing 진입 시점에 1회만 낸다. 비-VO 신호는 ProgressView.
        .onChange(of: speech.phase == .preparing) { _, isPreparing in
            guard isPreparing else { return }
            AccessibilityNotification.Announcement(appLocalized("ios.voice.preparing")).post()
        }
    }

    /// 클래식 탭 토글(73fb4e7 이전 계약 복원): 탭=시작, 재탭=정지·전달. 라벨 전환이
    /// 상태 신호(헌장 §6 ⓐ, disabled 금지)라 별도 힌트 불필요 — 라벨이 곧 다음 동작.
    /// 잠금·취소 슬라이드는 없다(정지가 항상 확정, 지우기는 입력 필드 지우기 버튼 몫).
    private var tapToggleBody: some View {
        Button(action: handleToggleTap) {
            micRow(title: toggleLabel)
        }
        .accessibilityLabel(toggleLabel)
    }

    /// 클래식 계약의 라벨: 청취 중이면 "받아쓰기 중지"(외부 시작 세션 포함 — 정지
    /// 수단이 이 탭이므로 라벨이 그 사실을 알린다), 아니면 "받아쓰기 시작".
    /// 모델 다운로드 대기는 둘 다 아니므로 준비 중임을 그대로 알린다.
    private var toggleLabel: String {
        if speech.phase == .preparing { return appLocalized("ios.voice.preparing") }
        return speech.isListening ? appLocalized("voice.stop") : appLocalized("ios.voice.start")
    }

    private func micRow(title: String) -> some View {
        HStack(spacing: 8) {
            // 준비 중엔 아이콘 자리에 불확정 진행 표시(비-VO 사용자의 유일한 대기 신호).
            // 접근성 이름은 상위 요소의 라벨이 담당하므로 이 뷰는 순수 시각 레이어다.
            if speech.phase == .preparing {
                ProgressView()
            } else {
                Image(systemName: speech.isListening ? "mic.fill" : "mic")
                    .foregroundStyle(speech.isListening ? Color.red : Color.accentColor)
            }
            if showsTitle {
                Text(title)
            }
        }
        .frame(minWidth: 44, minHeight: 44)
        .contentShape(Rectangle())
    }

    /// 탭 토글의 탭: 청취 중(시작 준비 대기 포함)이면 정지·전달, 유휴면 시작.
    /// 이중 정지·시작은 홀드와 같은 in-flight 가드가 차단한다.
    /// ⚠ startTask 단독으로 정지를 판정하지 말 것: 시작 실패(denied·failed) 후에도
    /// startTask가 남아, 다음 탭이 정지 no-op으로 소모된다(시뮬레이터 실측 2026-07-27).
    /// phase 동반 판정으로 실패 잔재를 시작 경로로 흘린다(재대입이 곧 정리).
    private func handleToggleTap() {
        let starting = startTask != nil && speech.isStarting
        if speech.isListening || starting {
            finishAndDeliver()
        } else if speech.isStarting {
            // 외부 시작 세션(단축어)이 준비 중(권한·모델 다운로드): start 재호출은
            // 재진입 가드 no-op일 뿐이고 정지도 아직 불가 — 무반응이 정직(홀드 판 동형)
        } else {
            guard !finishInFlight, !cancelInFlight else { return }
            // 재생 중 TTS 정지 사유는 홀드(beginHold)와 동일 — 오디오 세션 소유 경합 방지
            TtsPlayer.shared.stop()
            startTask = Task { await speech.start() }
        }
    }

    private func beginHold() {
        // 단축어 시작 세션(외부 시작)·정지·취소 정리 중엔 새 세션을 만들지 않는다
        guard !sessionActive, !speech.isListening,
              !finishInFlight, !cancelInFlight else {
            #if DEBUG
            chatFocusLog("holdmic begin REJECT session=\(sessionActive) listening=\(speech.isListening) finish=\(finishInFlight) cancel=\(cancelInFlight)")
            #endif
            return
        }
        #if DEBUG
        chatFocusLog("holdmic begin OK slideActions=\(onPause != nil)")
        #endif
        sessionActive = true
        // 실제 녹음이 시작되므로 직전 짧은 탭의 가시 안내는 더 이상 유효하지 않다
        hintDismissTask?.cancel()
        showHoldHint = false
        // 재생 중인 TTS를 먼저 정지 — 오디오 세션 소유가 겹치면(.playback↔.playAndRecord)
        // 재생이 무음화돼도 라벨이 "재생 중지"로 남는 상태 불일치가 생기고, 낭독이
        // 녹음에 섞인다(리뷰 검출). 미재생이면 no-op.
        TtsPlayer.shared.stop()
        interruptVoiceOverSpeech()
        startTask = Task { await speech.start() }
    }

    /// 홀드 성립 이후의 이동(시작점 기준 누적). 지배 축 판정으로 대각선 오발동 방지.
    private func handleSlide(_ translation: CGSize) {
        guard sessionActive, onPause != nil else {
            #if DEBUG
            chatFocusLog("holdmic slide DROP session=\(sessionActive) allow=\(onPause != nil) tr=(\(Int(translation.width)),\(Int(translation.height)))")
            #endif
            return
        }
        if translation.height <= -Self.slideThreshold,
           abs(translation.height) >= abs(translation.width) {
            pauseHold()
        } else if translation.width <= -Self.slideThreshold,
                  abs(translation.width) > abs(translation.height) {
            cancelHold()
        }
    }

    /// 위로 밀어 잠금(일시정지): 녹음을 멈추고 전사를 onPause로 확정. 세션이 여기서
    /// 끝나므로 이어지는 릴리스(endHold)는 no-op — 손가락이 아직 화면에 있어도 안전.
    private func pauseHold() {
        guard !finishInFlight else { return }
        #if DEBUG
        chatFocusLog("holdmic PAUSE (slide-up)")
        #endif
        sessionActive = false
        finishInFlight = true
        // 발화 금지 구간(정지 직전)이라 제스처 인지는 햅틱, 통지는 정지 후 소비자 몫
        UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        let task = startTask
        startTask = nil
        Task {
            defer { finishInFlight = false }
            await task?.value
            // denied·failed로 청취가 시작조차 안 된 세션: 권한 알럿이 상태의 정본 —
            // "받아쓰기 잠김" 오통지가 알럿과 동시 발화하는 3-state 뭉개기 금지(리뷰 검출)
            guard speech.isListening else { return }
            // 빈 전사여도 호출: "정지됐다"는 상태 통지는 전사 유무와 무관(3-state 정신)
            onPause?(await speech.stop())
        }
    }

    private func cancelHold() {
        sessionActive = false
        cancelInFlight = true
        let task = startTask
        startTask = nil
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
        Task {
            defer { cancelInFlight = false }
            await task?.value
            await speech.cancel()
            // 녹음이 끝난 뒤라 발화 허용: 결과가 버려졌음을 통지(웹 voice.cancelled 재사용)
            AccessibilityNotification.Announcement(appLocalized("voice.cancelled")).post()
        }
    }

    private func endHold() {
        #if DEBUG
        chatFocusLog("holdmic release session=\(sessionActive)")
        #endif
        guard sessionActive else { return }
        sessionActive = false
        finishAndDeliver()
    }

    /// 짧은 탭: 유휴면 사용법 안내(VO 더블탭 활성화의 착지점), 청취 중이면 정지·전달
    /// (단축어 "음성 검색"처럼 홀드 없이 시작된 외부 세션의 정지 경로).
    private func handleTap() {
        if speech.isListening || startTask != nil {
            guard !sessionActive else { return }
            finishAndDeliver()
        } else if speech.isStarting {
            // 외부 시작 세션(단축어)의 준비 중(권한·모델 다운로드): 세션이 시작되고
            // 있으므로 "누른 채로 말해 주세요" 안내는 오발화 — 무반응이 정직하다(감사 검출)
        } else {
            #if DEBUG
            chatFocusLog("holdmic shortTap idle → guide announce")
            #endif
            // [실험 계측] 통지는 게시되는데 VO가 발화하지 않는 실기기 회귀가
            // 로그로 확인됐다(post() 자체는 실제 발화를 보장하지 않는 별개 계층).
            // 활성화 직후 VO 자체 처리(활성화 피드백·포커스 갱신 발화)가 기본
            // 우선순위 통지를 잠식하는 패턴으로 추정 — 이 통지는 사용자 활성화에
            // 대한 직접 응답이라 고우선순위가 의미상으로도 정당하다(비요청 interrupt
            // 아님). 단일 변수 실험이라 이 통지 한 곳만 바꾼다 — 다른 통지는 그대로.
            var guide = AttributedString(appLocalized("ios.voice.holdGuide"))
            guide.accessibilitySpeechAnnouncementPriority = .high
            AccessibilityNotification.Announcement(guide).post()
            // 비-VO 심사자용: 짧은 탭에 아무 가시 반응이 없다는 App Store 반려 원인 해소
            showHoldHint = true
            hintDismissTask?.cancel()
            hintDismissTask = Task {
                try? await Task.sleep(for: .seconds(3))
                guard !Task.isCancelled else { return }
                showHoldHint = false
            }
        }
    }

    private func finishAndDeliver() {
        guard !finishInFlight else { return }
        finishInFlight = true
        let task = startTask
        startTask = nil
        Task {
            defer { finishInFlight = false }
            // 권한 다이얼로그·모델 다운로드 중 릴리스: start()가 끝나길 기다렸다 정지해
            // 허가 직후 유령 청취가 남지 않게 한다(경합 직렬화)
            await task?.value
            if let text = await speech.stop() {
                onTranscript(text)
            }
        }
    }

}

/// UIKit 홀드·탭 인식기 캐처(투명 오버레이). 파일 상단 주석의 실기기 결함 2건이
/// SwiftUI 제스처 조합을 배제한 근거다. 탭은 require(toFail: 홀드)로 종속시켜
/// "0.25s 미만 릴리스에만 탭"을 시스템이 판정한다(UITap엔 자체 시간 상한이 없어
/// 길게 눌렀다 뗀 것도 탭으로 오인식하는 함정 회피).
private struct HoldGestureCatcher: UIViewRepresentable {
    let onBegan: () -> Void
    let onMoved: (CGSize) -> Void
    let onEnded: () -> Void
    let onTapped: () -> Void

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = .clear
        // 접근성 요소는 SwiftUI 래퍼(.accessibilityElement) 하나뿐 — 캐처는 비노출
        view.isAccessibilityElement = false

        let hold = UILongPressGestureRecognizer(
            target: context.coordinator, action: #selector(Coordinator.handleHold(_:))
        )
        hold.minimumPressDuration = 0.25
        view.addGestureRecognizer(hold)

        let tap = UITapGestureRecognizer(
            target: context.coordinator, action: #selector(Coordinator.handleTap(_:))
        )
        tap.require(toFail: hold)
        view.addGestureRecognizer(tap)
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        // SwiftUI 상태 변경마다 재생성되는 클로저를 코디네이터에 최신화
        context.coordinator.parent = self
    }

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    @MainActor
    final class Coordinator: NSObject {
        var parent: HoldGestureCatcher
        /// 이동량 기준점: 뷰 로컬이 아니라 window 좌표(홀드 중 스크롤·레이아웃 변동 무관)
        private var startPoint: CGPoint = .zero

        init(parent: HoldGestureCatcher) {
            self.parent = parent
        }

        #if DEBUG
        /// .changed 계측 스로틀(직전 로그 지점에서 8pt 이상 이동 시에만 기록)
        private var lastLogged: CGPoint = .zero
        #endif

        @objc func handleHold(_ recognizer: UILongPressGestureRecognizer) {
            let point = recognizer.location(in: recognizer.view?.window)
            switch recognizer.state {
            case .began:
                startPoint = point
                #if DEBUG
                lastLogged = point
                chatFocusLog("holdmic recognizer BEGAN pt=(\(Int(point.x)),\(Int(point.y)))")
                #endif
                parent.onBegan()
            case .changed:
                #if DEBUG
                if hypot(point.x - lastLogged.x, point.y - lastLogged.y) >= 8 {
                    lastLogged = point
                    chatFocusLog("holdmic recognizer CHANGED tr=(\(Int(point.x - startPoint.x)),\(Int(point.y - startPoint.y)))")
                }
                #endif
                parent.onMoved(CGSize(
                    width: point.x - startPoint.x,
                    height: point.y - startPoint.y
                ))
            case .ended, .cancelled, .failed:
                // 시스템 취소(전화 수신·VO 개입)도 릴리스와 동일 처리 — 유령 녹음 방지
                #if DEBUG
                chatFocusLog("holdmic recognizer END state=\(recognizer.state.rawValue) tr=(\(Int(point.x - startPoint.x)),\(Int(point.y - startPoint.y)))")
                #endif
                parent.onEnded()
            default:
                break
            }
        }

        @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
            guard recognizer.state == .ended else { return }
            parent.onTapped()
        }
    }
}

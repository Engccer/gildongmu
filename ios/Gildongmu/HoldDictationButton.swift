import SwiftUI
import UIKit
import Accessibility

/// WhatsApp식 홀드 받아쓰기 버튼(2026-07-20 위원장 결정, 탭 토글 대체).
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

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: speech.isListening ? "mic.fill" : "mic")
                .foregroundStyle(speech.isListening ? Color.red : Color.accentColor)
            if showsTitle {
                Text(appLocalized("ios.voice.hold"))
            }
        }
        .frame(minWidth: 44, minHeight: 44)
        .contentShape(Rectangle())
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
        } else if speech.phase == .requesting {
            // 외부 시작 세션(단축어)의 준비 중(권한·모델 다운로드): 세션이 시작되고
            // 있으므로 "누른 채로 말해 주세요" 안내는 오발화 — 무반응이 정직하다(감사 검출)
        } else {
            AccessibilityNotification.Announcement(appLocalized("ios.voice.holdGuide")).post()
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

    /// 녹음 시작 순간 진행 중인 VO 낭독(라벨·힌트 설명)을 끊는다. 공백 1자의
    /// interrupting(.high) 통지는 아무것도 발화하지 않으면서 발화 큐만 비운다.
    private func interruptVoiceOverSpeech() {
        guard UIAccessibility.isVoiceOverRunning else { return }
        var silence = AttributedString(" ")
        silence.accessibilitySpeechAnnouncementPriority = .high
        AccessibilityNotification.Announcement(silence).post()
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

import SwiftUI
import UIKit
#if EXPERIMENTAL
import Accessibility
import AppIntents
import CallKit
import GildongmuKit
#endif

// 화면을 겨냥하지 않고 받아쓰기를 시작·끝내는 동작 둘(E82 판정 10, 실험판 전용):
// ⓐ VoiceOver 두 손가락 두 번 탭(Magic Tap) — 창·앱 객체의 `accessibilityMagicTapBlock`(`installMagicTap`)
// ⓑ 단축어 동작 `ToggleDictationIntent` — 설정 > 손쉬운 사용 > 터치 > 뒷면 탭에 연결한다.
// 둘 다 「지금 화면의 받아쓰기」를 이 등록부 한 곳에서 찾는다. 받아쓰기 버튼(`HoldDictationButton`)이 스스로 등록하므로
// 받아쓰기가 있는 화면이 늘어도 화면마다 배선할 것이 없다(호출부 한 곳 누락이 조용한 결함이 되는 길을 구조로 막는다).
// 무엇을 할지의 판정은 Kit `dictationTriggerResponse`(순수 함수)다.

extension View {
    /// 이 컨트롤을 「화면을 겨냥하지 않는 받아쓰기」의 대상으로 등록한다(E82 판정 10). `perform`은 그 컨트롤을 누른 것과 같은
    /// 길이어야 한다 — 녹음 시작 때 낭독 끊기·완료 뒤 포커스·통지 계약이 버튼으로 시작한 경우와 갈리지 않게.
    /// 정식판에서는 아무것도 하지 않는다(등록부·인텐트·Magic Tap 처리가 컴파일에서 빠진다).
    @ViewBuilder
    func dictationTriggerTarget(
        isActive: @escaping @MainActor () -> Bool,
        perform: @escaping @MainActor () -> Void
    ) -> some View {
        #if EXPERIMENTAL
        modifier(DictationTriggerTargetModifier(isActive: isActive, perform: perform))
        #else
        self
        #endif
    }
}

#if EXPERIMENTAL

/// 등록된 받아쓰기 컨트롤 하나. 뷰 상태(`@State`)가 쥐므로 그 컨트롤이 화면에서 사라지면 함께 사라지고,
/// 등록부는 약한 참조로만 든다(해제 배선이 따로 없다).
@MainActor
final class DictationTriggerHandle {
    /// 지금 사용자에게 보이는지 가르는 기준 뷰(약한 참조). `List` 행이면 행이 아니라 그 목록이다 — 마이크 행이 스크롤로
    /// 화면 밖에 나가도(검색 결과를 훑는 중) 그 화면의 받아쓰기는 그대로 살아 있어야 한다.
    weak var proxy: UIView?
    /// 화면에 나타난 차례(클수록 나중).
    var order = 0
    var isActive: @MainActor () -> Bool = { false }
    var perform: @MainActor () -> Void = {}

    var id: Int { ObjectIdentifier(self).hashValue }
}

@MainActor
final class DictationTriggerRegistry {
    static let shared = DictationTriggerRegistry()

    private struct Entry { weak var handle: DictationTriggerHandle? }
    private var entries: [Entry] = []
    private var nextOrder = 0
    /// 통화 중인지(Magic Tap의 시스템 기본 「전화 받기·끊기」를 빼앗지 않기 위해서만 읽는다).
    private lazy var callObserver = CXCallObserver()
    /// Magic Tap 블록을 건 창(약한 참조)과 앱 객체.
    private let magicTapWindows = NSHashTable<UIWindow>.weakObjects()
    private var magicTapOnApplication = false

    /// 컨트롤이 창에 붙을 때마다 부른다(탭 복귀·시트 재등장 포함) — 차례가 그때마다 맨 뒤로 간다.
    func appeared(_ handle: DictationTriggerHandle, proxy: UIView) {
        handle.proxy = proxy
        nextOrder += 1
        handle.order = nextOrder
        entries.removeAll { $0.handle == nil || $0.handle === handle }
        entries.append(Entry(handle: handle))
    }

    /// 판정하고 그대로 실행한다. 반환값은 판정(Magic Tap이 처리했는지를 시스템에 돌려주는 데 쓴다).
    @discardableResult
    func trigger(from source: DictationTriggerSource) -> DictationTriggerResponse {
        entries.removeAll { $0.handle == nil }
        let handles = entries.compactMap(\.handle)
        let candidates = handles.map { handle in
            DictationTriggerCandidate(
                id: handle.id,
                frontmost: handle.proxy.map(Self.isFrontmost) ?? false,
                active: handle.isActive(),
                order: handle.order
            )
        }
        let inCall = callObserver.calls.contains { !$0.hasEnded }
        let response = dictationTriggerResponse(source: source, inCall: inCall, candidates: candidates)
        switch response {
        case .toggle(let id):
            handles.first { $0.id == id }?.perform()
        case .announceNoTarget:
            // 사용자가 방금 한 동작에 대한 직접 응답이고 포커스가 움직이지 않는다 — 기본 우선순위는 활성화 처리·앱 전환 낭독에
            // 잠식된다(화면 규칙: 화면 변화 없는 활성화 응답은 `.high`).
            var text = AttributedString(appLocalized("ios.voice.triggerNoTarget"))
            text.accessibilitySpeechAnnouncementPriority = .high
            AccessibilityNotification.Announcement(text).post()
        case .passToSystem:
            break
        }
        return response
    }

    /// Magic Tap 처리 블록을 창과 앱 객체에 건다(iOS 17+ `accessibilityMagicTapBlock`, 멱등).
    ///
    /// Magic Tap은 VoiceOver 초점이 있는 요소에서 응답 사슬을 따라 앱 대리자까지 올라가며 처리할 곳을 찾고, 아무도 처리하지 않으면
    /// 시스템 기본 동작(음악 재생·정지, 통화 받기·끊기)을 한다(Apple 「Supporting Accessibility」). 창은 그 화면의 어느 요소에서
    /// 올라가도 지나는 자리라 초점이 어디 있든 닿는다. 앱 객체는 같은 사슬의 다음 자리라 겹쳐 건다(한쪽이 `true`를 돌리면 거기서
    /// 멈춰 두 번 돌지 않는다). 하위 클래스를 쓰지 않는 이유: SwiftUI 앱은 `NSPrincipalClass`를 무시하고 자기 `UIApplication`
    /// 하위 클래스를 쓴다(시뮬레이터 실측 2026-11-16, `SwiftUIApplication`). 받아쓰기가 없는 화면이면 `false`라 시스템 기본이 그대로다.
    ///
    /// ⚠ 이 블록의 getter를 읽지 않는다: 손쉬운 사용 런타임이 실리기 전에는 setter만 있고 getter가 없어 읽는 순간
    /// 「unrecognized selector」로 죽는다(시뮬레이터 실측 2026-11-16, `respondsToSelector:` = NO). 건 자리는 여기서 센다.
    func installMagicTap(on window: UIWindow) {
        guard !magicTapWindows.contains(window) else { return }
        magicTapWindows.add(window)
        let block: AXBoolReturnBlock = {
            MainActor.assumeIsolated { DictationTriggerRegistry.shared.trigger(from: .magicTap) != .passToSystem }
        }
        window.accessibilityMagicTapBlock = block
        if !magicTapOnApplication {
            magicTapOnApplication = true
            UIApplication.shared.accessibilityMagicTapBlock = block
        }
    }

    /// 단축어 진입. `openAppWhenRun` 인텐트는 앱을 앞으로 가져온 뒤 돈다지만, 뒤에 있던(또는 막 켜진) 앱은 아직 활성화 중이라
    /// 화면이 자리 잡을 때까지 잠깐 기다린다. 이미 앞에 있으면 기다리지 않는다.
    func triggerFromShortcut() async {
        if UIApplication.shared.applicationState != .active {
            var waited = 0
            while UIApplication.shared.applicationState != .active, waited < 20 {
                try? await Task.sleep(for: .milliseconds(100))
                waited += 1
            }
            try? await Task.sleep(for: .milliseconds(400))
        }
        trigger(from: .shortcut)
    }

    /// 그 뷰가 지금 사용자가 보는 화면에 있는가: 창에 붙어 있고(숨은 탭·밀려난 화면은 창에서 떨어진다) 가장 위에 떠 있는
    /// 시트 안이다(시트에 덮인 화면의 받아쓰기를 몰래 켜지 않는다).
    private static func isFrontmost(_ view: UIView) -> Bool {
        guard let window = view.window, !view.isHidden, var top = window.rootViewController else { return false }
        while let presented = top.presentedViewController, !presented.isBeingDismissed {
            top = presented
        }
        return view.isDescendant(of: top.view)
    }
}

private struct DictationTriggerTargetModifier: ViewModifier {
    let isActive: @MainActor () -> Bool
    let perform: @MainActor () -> Void
    @State private var handle = DictationTriggerHandle()

    func body(content: Content) -> some View {
        content.background(
            DictationTriggerAnchor(handle: handle, isActive: isActive, perform: perform)
                .accessibilityHidden(true)
        )
    }
}

/// 컨트롤 뒤에 까는 보이지 않는 UIKit 뷰. 창에 붙는 순간을 등록부에 알리고, 보이는지 가를 기준 뷰를 찾는다.
private struct DictationTriggerAnchor: UIViewRepresentable {
    let handle: DictationTriggerHandle
    let isActive: @MainActor () -> Bool
    let perform: @MainActor () -> Void

    func makeUIView(context: Context) -> DictationTriggerAnchorView {
        let view = DictationTriggerAnchorView()
        view.isUserInteractionEnabled = false
        view.isAccessibilityElement = false
        view.accessibilityElementsHidden = true
        sync(view)
        return view
    }

    func updateUIView(_ view: DictationTriggerAnchorView, context: Context) {
        // 다시 그릴 때마다 최신 클로저로 바꾼다(버튼의 상태가 바뀌면 SwiftUI가 새 값을 넘긴다).
        sync(view)
    }

    private func sync(_ view: DictationTriggerAnchorView) {
        view.handle = handle
        handle.isActive = isActive
        handle.perform = perform
    }
}

private final class DictationTriggerAnchorView: UIView {
    var handle: DictationTriggerHandle?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard let window, let handle else { return }
        DictationTriggerRegistry.shared.appeared(handle, proxy: visibilityProxy())
        DictationTriggerRegistry.shared.installMagicTap(on: window)
    }

    /// `List` 행(재사용 셀) 안이면 그 목록 스크롤 뷰, 아니면 자기 자신. 셀은 스크롤로 화면 밖에 나가면 창에서 떨어지지만
    /// 목록은 화면이 살아 있는 동안 남는다.
    private func visibilityProxy() -> UIView {
        var current = superview
        while let view = current {
            if view is UICollectionViewCell || view is UITableViewCell {
                var container = view.superview
                while let candidate = container, !(candidate is UIScrollView) {
                    container = candidate.superview
                }
                return container ?? self
            }
            current = view.superview
        }
        return self
    }
}

/// 「받아쓰기 시작」 단축어 동작. 지금 화면의 받아쓰기를 시작하고, 받아쓰는 중이면 끝낸다(버튼을 누른 것과 같다).
/// 받아쓰기가 없는 화면이면 그렇다고 한 문장으로 알린다(침묵이 실패와 구분되지 않는다).
struct ToggleDictationIntent: AppIntent {
    static let title = LocalizedStringResource("ios.shortcut.dictation.title")
    static let description = IntentDescription(LocalizedStringResource("ios.shortcut.dictation.desc"))
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        await DictationTriggerRegistry.shared.triggerFromShortcut()
        return .result()
    }
}

#endif

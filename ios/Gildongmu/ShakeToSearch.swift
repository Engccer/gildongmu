import SwiftUI
import UIKit

// 흔들면 어느 화면에서나 장소 검색 창으로(E87, 위원장 판정 2026-11-16·17, 실험판 전용).
// 흔들면 검색 탭으로 가서 장소 검색 입력 창에 키보드 초점을 둔다(키보드 초점이 VoiceOver 커서를 끈다 —
// `DirectionsEndpointSearchView.landAboardSearchField`와 같은 길). 받아쓰기는 켜지 않고 통지도 겹치지 않는다(초점이 입력 창에
// 앉는 것이 신호다). 안내 시트는 접고 안내는 뒤에서 이어진다(종료하지 않는다).
//
// 흔들기는 응답 사슬을 따른다: 첫 응답자에서 시작해 화면 → 뷰 컨트롤러 → (띄운 시트면 띄운 쪽) → 창 → 앱 순으로 올라간다
// (Apple 「Using responders and the responder chain to handle events」, `motionEnded(_:with:)` 「The default implementation of this
// method forwards the message up the responder chain」). 시트·전체 화면 덮개도 같은 창 안이라 창에서 받으면 어느 화면이든 닿는다.
// SwiftUI 앱은 창을 직접 만들지 않으므로 창 클래스의 확장으로 받는다. 받은 뒤 `super`를 불러 사슬을 그대로 잇는다.
//
// 정식판에는 아무것도 컴파일되지 않는다(`check-release-artifact.mjs`의 `EXPERIMENTAL_ONLY_SYMBOLS`가 `ShakeToSearch`를 센다).

#if EXPERIMENTAL

/// 흔들기 사건과 검색 창 초점 요청을 잇는 앱 수명 칸.
@Observable @MainActor
final class ShakeToSearch {
    static let shared = ShakeToSearch()

    /// 흔들기 횟수 — 앱 루트가 관찰해 탭·시트를 정리한다(`onDeviceShake`).
    private(set) var shakeSeq = 0
    /// 검색 창 초점 요청 세대 — 이미 떠 있는 검색 화면이 관찰한다.
    private(set) var focusRequestSeq = 0
    /// 아직 소비되지 않은 요청. 검색 탭을 한 번도 열지 않아 검색 화면이 아직 없으면 나타날 때 이것을 소비한다
    /// (`LaunchActionStore.voiceStartRequested`와 같은 이유 — 탭 콘텐츠는 처음 고를 때 만들어진다).
    private(set) var pendingFocus = false

    fileprivate func recordShake() { shakeSeq += 1 }

    func requestFocus() {
        pendingFocus = true
        focusRequestSeq += 1
    }

    /// 요청을 가져간다(한 번만 참).
    fileprivate func takeFocusRequest() -> Bool {
        guard pendingFocus else { return false }
        pendingFocus = false
        return true
    }

    /// 앱 루트가 자기 상태로 닫지 못하는 남은 덮개(다른 탭이 띄운 시트·알림)를 닫는다. 안내 시트·설정·공지는 루트가 상태로 먼저
    /// 닫으므로 그것들은 이미 닫히는 중이다(`isBeingDismissed`) — 겹쳐 닫지 않는다. 검색 필드 편집(`UISearchController`)은 화면을
    /// 덮는 덮개가 아니라 남긴다(`DictationTriggerRegistry.isFrontmost`와 같은 판별).
    static func dismissLeftoverModals() {
        Task { @MainActor in
            // 루트의 상태 변경이 닫기를 시작할 때까지 한 박자 기다린다.
            try? await Task.sleep(for: .milliseconds(100))
            for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
            where scene.activationState == .foregroundActive {
                guard let root = scene.keyWindow?.rootViewController,
                      let presented = root.presentedViewController,
                      !presented.isBeingDismissed, !(presented is UISearchController) else { continue }
                root.dismiss(animated: true)
            }
        }
    }
}

extension UIWindow {
    /// 흔들기를 앱 수명 칸에 알리고 사슬을 그대로 잇는다(`super`). 흔들기 말고는 손대지 않는다.
    override open func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        if motion == .motionShake { ShakeToSearch.shared.recordShake() }
        super.motionEnded(motion, with: event)
    }
}

extension View {
    /// 앱 루트: 흔들기를 받는다. 흔들기의 시스템 「실행 취소」 알림은 끈다 — 입력 중에 흔들면 알림이 떠 검색 창 대신 VoiceOver
    /// 커서를 가져간다(한 동작에 두 반응). `applicationSupportsShakeToEdit`는 「흔들면 실행 취소·다시 실행 버튼을 보이는가」이고
    /// 끄면 그 버튼만 보이지 않는다(Apple 문서 「Set the property to false if you don't want your app to display the Undo and Redo
    /// buttons when users shake the device」).
    func onDeviceShake(perform action: @escaping @MainActor () -> Void) -> some View {
        modifier(DeviceShakeModifier(action: action))
    }

    /// 장소 검색 화면: 요청이 오면 `prepare`(깊은 화면을 목록 루트로 되돌리기 등)를 부르고 검색 창에 키보드 초점을 둔다.
    func shakeSearchFocusTarget(
        focused: FocusState<Bool>.Binding, prepare: @escaping @MainActor () -> Void
    ) -> some View {
        modifier(ShakeSearchFocusModifier(focused: focused, prepare: prepare))
    }
}

private struct DeviceShakeModifier: ViewModifier {
    let action: @MainActor () -> Void
    private let store = ShakeToSearch.shared

    func body(content: Content) -> some View {
        content
            .onChange(of: store.shakeSeq) { _, _ in action() }
            .task { UIApplication.shared.applicationSupportsShakeToEdit = false }
    }
}

private struct ShakeSearchFocusModifier: ViewModifier {
    let focused: FocusState<Bool>.Binding
    let prepare: @MainActor () -> Void
    private let store = ShakeToSearch.shared
    @State private var landTask: Task<Void, Never>?

    func body(content: Content) -> some View {
        content
            .searchFocused(focused)
            .onChange(of: store.focusRequestSeq) { _, _ in consume() }
            .onAppear { consume() }
            .onDisappear { landTask?.cancel() }
    }

    private func consume() {
        guard store.takeFocusRequest() else { return }
        prepare()
        // 탭 전환·시트 닫힘·목록 루트 복귀가 끝난 뒤 둔다(가시화 → 지연 → 경합 해제 → 대입 → 검증 → 1회 재시도, PATTERNS
        // §iOS 목록 포커스 이동). 이미 초점이 있으면 같은 값 대입은 아무 일도 하지 않으므로 먼저 놓는다.
        landTask?.cancel()
        landTask = Task { @MainActor in
            for attempt in 0..<2 {
                try? await Task.sleep(for: .milliseconds(attempt == 0 ? 500 : 600))
                guard !Task.isCancelled else { return }
                if attempt == 1, focused.wrappedValue { return }
                focused.wrappedValue = false
                try? await Task.sleep(for: .milliseconds(100))
                guard !Task.isCancelled else { return }
                focused.wrappedValue = true
            }
        }
    }
}

#endif

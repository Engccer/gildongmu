import SwiftUI
import Accessibility
import GildongmuKit

// 순서 바꾸기 로터 액션(spec docs/superpowers/specs/2026-10-05-reorder-rotor-actions-design.md §1).
// 고정한 최근 항목(E67)과 탭 순서(E66)가 같은 조작법이라 액션·통지·포커스 유지를 여기 한 벌로 둔다.
// 할 수 있는 이동의 판정은 Kit `Reorder.availableMoves`가 정본이다.

extension View {
    /// 그 행에서 할 수 있는 이동만 로터 액션으로 단다(`moves`가 비면 없음). `swipeActions`가 아니다 —
    /// 눈으로 쓰는 사람에게 밀어서 보이는 버튼이 늘고, 끝까지 밀기가 첫 버튼을 실행한다.
    func reorderActions(_ moves: [ReorderMove], perform: @escaping (ReorderMove) -> Void) -> some View {
        // ⚠ 선언은 역순: VoiceOver 쓸기 메뉴가 빌더 선언의 역순으로 노출된다(`addressCopyActions` 동형).
        // 사용자 경험 순서는 맨 위로 → 위로 → 아래로.
        accessibilityActions {
            if moves.contains(.down) {
                Button(appLocalized("ios.reorder.down")) { perform(.down) }
            }
            if moves.contains(.up) {
                Button(appLocalized("ios.reorder.up")) { perform(.up) }
            }
            if moves.contains(.toTop) {
                Button(appLocalized("ios.reorder.toTop")) { perform(.toTop) }
            }
        }
    }
}

/// 이동 뒤 새 자리 통지(1부터). `.high`: 로터 액션 활성화 응답이고 커서가 같은 행에 남아 라벨이 다시
/// 읽히지 않으므로 이 통지가 이동의 유일한 증거다(PATTERNS "iOS 통지 우선순위의 판별선" 둘째 판별선).
func announceReorderPosition(_ position: Int) {
    var message = AttributedString(appLocalized("ios.reorder.moved", position))
    message.accessibilitySpeechAnnouncementPriority = .high
    AccessibilityNotification.Announcement(message).post()
}

/// 옮긴 행에 커서를 남긴다(spec §2.3). 이동은 행 정체성·포커스 값을 바꾸지 않아 커서가 그대로 있으면 할 일이
/// 없고, 채택한 순서에서 행이 화면 밖으로 뛰어 커서가 떨어졌을 때만 600ms 뒤 가시화 → 300ms → 대입을 1회 한다
/// (오프스크린 행 대입은 조용히 되돌아온다, 목록 포커스 정본). 무한 재대입은 커서를 붙잡아 되레 방해가 된다.
@MainActor
func keepFocusAfterMove(
    reveal: @escaping () -> Void, isLanded: @escaping () -> Bool, assign: @escaping () -> Void
) -> Task<Void, Never> {
    Task { @MainActor in
        try? await Task.sleep(for: .milliseconds(600))
        guard !Task.isCancelled, !isLanded() else { return }
        reveal()
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        assign()
    }
}

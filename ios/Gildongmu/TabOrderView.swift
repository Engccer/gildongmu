import SwiftUI
import Accessibility
import GildongmuKit

/// 설정 "탭 순서"(E66, 실험판만 — spec docs/superpowers/specs/2026-10-05-reorder-rotor-actions-design.md §3.2).
/// 한 줄 = 한 탭이고 로터 액션으로 옮긴다(고정한 최근 항목 E67과 같은 조작법). 눈으로 쓰는 사람은 길게 눌러 끌어
/// 옮긴다(편집 모드를 켜지 않는다 — 켜면 행마다 재정렬 핸들이 별도 접근성 객체로 붙는다).
///
/// 순서는 이 화면 안의 초안이고 **화면을 떠날 때와 앱이 백그라운드로 갈 때 저장**한다(바뀐 경우만 앱 루트가 탭 트리를
/// 재생성한다, `GildongmuApp.tabOrderEpoch`). 옮길 때마다 저장하면 설정 아래 탭 내용이 이동 횟수만큼 초기화된다.
/// 기본 순서와 같으면 키를 비운다(Kit `Reorder.storedValue` — 미지정이면 탭이 늘 때 새 탭이 기본 자리에 선다).
struct TabOrderView: View {
    @AppStorage(AppTab.orderKey) private var orderRaw = ""
    @Environment(\.scenePhase) private var scenePhase
    @State private var order: [AppTab]
    @AccessibilityFocusState private var focusedTab: AppTab?
    @State private var focusTask: Task<Void, Never>?

    init() {
        _order = State(initialValue: AppTab.order(stored: UserDefaults.standard.string(forKey: AppTab.orderKey) ?? ""))
    }

    var body: some View {
        ScrollViewReader { proxy in
        List {
            Section {
                // 행 정체성 = 탭 값이라 순서가 바뀌어도 행이 파괴되지 않는다(커서 유지).
                ForEach(order, id: \.self) { tab in
                    Text(tab.title)
                        .accessibilityFocused($focusedTab, equals: tab)
                        .reorderActions(Reorder.availableMoves(index: order.firstIndex(of: tab) ?? 0, count: order.count)) {
                            move(tab, $0, reveal: { proxy.scrollTo(tab) })
                        }
                }
                .onMove { source, destination in
                    order.move(fromOffsets: source, toOffset: destination)
                }
            }
            Section {
                Button(appLocalized("ios.settings.tabOrderReset")) { resetOrder() }
            }
        }
        .navigationTitle(appLocalized("ios.settings.tabOrder"))
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear {
            focusTask?.cancel()
            commit()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { commit() }
        }
        }
    }

    /// 커서는 그 줄에 남기고 새 자리를 통지한다(`SearchView.moveRecent`와 같은 계약).
    private func move(_ tab: AppTab, _ move: ReorderMove, reveal: @escaping () -> Void) {
        guard let index = order.firstIndex(of: tab) else { return }
        order = Reorder.moved(order, from: index, move)
        guard let position = order.firstIndex(of: tab) else { return }
        announceReorderPosition(position + 1)
        focusTask?.cancel()
        focusTask = keepFocusAfterMove(reveal: reveal, isLanded: { focusedTab == tab }, assign: { focusedTab = tab })
    }

    /// 커서는 버튼에 남아 목록의 변화를 듣지 못하므로 결과를 `.high`로 통지한다(화면 변화 없는 활성화 응답).
    /// 이미 기본 순서여도 같은 문장이다(결과 상태를 말한다).
    private func resetOrder() {
        // 직전 이동의 재착지가 커서를 버튼에서 탭 줄로 끌어가 이 통지를 끊지 않게 한다.
        focusTask?.cancel()
        order = AppTab.defaultOrder
        var message = AttributedString(appLocalized("ios.settings.tabOrderResetDone"))
        message.accessibilitySpeechAnnouncementPriority = .high
        AccessibilityNotification.Announcement(message).post()
    }

    private func commit() {
        let raw = Reorder.storedValue(order.map(\.rawValue), defaultOrder: AppTab.defaultOrder.map(\.rawValue))
        if raw != orderRaw { orderRaw = raw }
    }
}

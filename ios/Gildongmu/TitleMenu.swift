import SwiftUI

extension EnvironmentValues {
    /// 현재 탭만 초기 상태로 재생성하는 액션 — App이 탭별 epoch을 증가시킨다(스펙 §3).
    @Entry var refreshTab: () -> Void = {}
}

/// 세 탭 공통 principal "길동무" 메뉴: 새로고침(현재 탭만)·설정(시트).
/// Menu는 네이티브 disclosure라 VoiceOver가 "길동무, 팝업 버튼"으로 낭독한다.
/// 푸시된 상세 화면엔 표시되지 않는다(SwiftUI 화면별 toolbar 기본 동작).
private struct GildongmuTitleMenu: ViewModifier {
    @Environment(\.refreshTab) private var refreshTab
    @State private var showsSettings = false

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Menu("길동무") {
                        Button("새로고침") { refreshTab() }
                        Button("설정") { showsSettings = true }
                    }
                }
            }
            .sheet(isPresented: $showsSettings) {
                SettingsView()
            }
    }
}

extension View {
    /// NavigationStack 안 탭 루트 화면에 부착한다(navigationTitle은 뒤로 버튼 라벨용으로 유지).
    func gildongmuTitleMenu() -> some View {
        modifier(GildongmuTitleMenu())
    }
}

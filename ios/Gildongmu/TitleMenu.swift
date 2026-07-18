import SwiftUI

extension EnvironmentValues {
    /// 현재 탭만 초기 상태로 재생성하는 액션 — App이 탭별 epoch을 증가시킨다(스펙 §3).
    @Entry var refreshTab: () -> Void = {}
    /// 설정 시트를 여는 액션. 시트 표시 상태를 App이 소유하는 이유: 언어 전환은
    /// 탭 트리를 `.id`로 재생성하는데, 시트가 그 안에 있으면 설정 중에 시트가
    /// 닫혀 버린다(SR 사용자에겐 맥락 완전 상실). App 레벨은 재생성 밖이라 유지된다.
    @Entry var openSettings: () -> Void = {}
}

/// 세 탭 공통 principal "길동무" 메뉴: 새로고침(현재 탭만)·설정(시트).
/// Menu는 네이티브 disclosure라 VoiceOver가 "길동무, 팝업 버튼"으로 낭독한다.
/// 푸시된 상세 화면엔 표시되지 않는다(SwiftUI 화면별 toolbar 기본 동작).
private struct GildongmuTitleMenu: ViewModifier {
    @Environment(\.refreshTab) private var refreshTab
    @Environment(\.openSettings) private var openSettings

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Menu(appLocalized("app.title")) {
                        Button(appLocalized("ios.common.refresh")) { refreshTab() }
                        Button(appLocalized("ios.settings.title")) { openSettings() }
                    }
                }
            }
    }
}

extension View {
    /// NavigationStack 안 탭 루트 화면에 부착한다(navigationTitle은 뒤로 버튼 라벨용으로 유지).
    func gildongmuTitleMenu() -> some View {
        modifier(GildongmuTitleMenu())
    }
}

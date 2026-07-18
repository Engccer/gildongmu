import SwiftUI

/// 테마 선택 영속값. rawValue가 AppStorage("themePreference")에 저장된다.
/// 시스템=nil 반환으로 preferredColorScheme 오버라이드를 해제한다.
enum ThemePreference: String, CaseIterable {
    case system
    case light
    case dark

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    var label: String {
        switch self {
        case .system: "시스템 설정 따름"
        case .light: "라이트"
        case .dark: "다크"
        }
    }
}

/// 앱 설정 시트. 이번 라운드 내용은 테마 선택 하나(스펙 §4) — 언어 설정은
/// 후속 마일스톤(iOS 다국어)이라 자리를 미리 잡지 않는다(YAGNI).
/// 시트 등장 시 VoiceOver 포커스는 시스템이 이동시키므로 별도 처리 없음.
struct SettingsView: View {
    @AppStorage("themePreference") private var themeRaw = ThemePreference.system.rawValue
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Picker("테마", selection: $themeRaw) {
                    ForEach(ThemePreference.allCases, id: \.rawValue) { theme in
                        Text(theme.label).tag(theme.rawValue)
                    }
                }
                .pickerStyle(.inline)
            }
            .navigationTitle("설정")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("닫기") { dismiss() }
                }
            }
        }
    }
}

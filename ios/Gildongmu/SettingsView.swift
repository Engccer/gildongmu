import SwiftUI
import Accessibility

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
        case .system: String(localized: "ios.settings.themeSystem")
        case .light: String(localized: "ios.settings.themeLight")
        case .dark: String(localized: "ios.settings.themeDark")
        }
    }
}

/// 앱 설정 시트: 테마 + 언어(스펙 2026-07-19 iOS 다국어 §4).
/// 언어는 dodo 동형 AppleLanguages 오버라이드 — String(localized:)가 Bundle.main
/// 기준이라 다음 앱 실행부터 적용되며, 선택 즉시 재시작 안내를 polite 통지한다.
/// 시트 등장 시 VoiceOver 포커스는 시스템이 이동시키므로 별도 처리 없음.
struct SettingsView: View {
    /// 각 언어는 자국어 표기(고유명사라 로컬라이즈 대상 아님, 웹 nav.* 동일 어휘).
    private static let languages: [(code: String, name: String)] = [
        ("ko", "한국어"),
        ("en", "English"),
        ("es", "Español"),
        ("fr", "Français"),
        ("it", "Italiano"),
    ]

    @AppStorage("themePreference") private var themeRaw = ThemePreference.system.rawValue
    /// 현재 세션의 선택값. 오버라이드가 이미 있으면 그것이 정본(재시작 전엔
    /// Bundle 해석(AppLanguage.current)이 옛 언어라 UserDefaults를 먼저 본다).
    /// ⚠ AppleLanguages는 오버라이드가 없어도 시스템이 채워 두므로 지원 언어
    /// 필터가 필수 — 미지원 값(예: ja)을 그대로 쓰면 픽커가 무선택 상태가 된다.
    @State private var selectedLanguage =
        (UserDefaults.standard.array(forKey: "AppleLanguages")?.first as? String)
            .map { String($0.prefix(2)) }
            .flatMap { AppLanguage.supported.contains($0) ? $0 : nil } ?? AppLanguage.current
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Picker(String(localized: "ios.settings.theme"), selection: $themeRaw) {
                    ForEach(ThemePreference.allCases, id: \.rawValue) { theme in
                        Text(theme.label).tag(theme.rawValue)
                    }
                }
                .pickerStyle(.inline)

                Picker(String(localized: "ios.settings.language"), selection: $selectedLanguage) {
                    ForEach(Self.languages, id: \.code) { language in
                        Text(language.name).tag(language.code)
                    }
                }
                .pickerStyle(.inline)
                .onChange(of: selectedLanguage) { _, code in
                    UserDefaults.standard.set([code], forKey: "AppleLanguages")
                    AccessibilityNotification.Announcement(
                        String(localized: "ios.settings.languageRestartNotice")
                    ).post()
                }
            }
            .navigationTitle(String(localized: "ios.settings.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "actions.close")) { dismiss() }
                }
            }
        }
    }
}

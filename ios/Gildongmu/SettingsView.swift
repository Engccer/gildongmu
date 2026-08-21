import SwiftUI
import Accessibility
import GildongmuKit

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
        case .system: appLocalized("ios.settings.themeSystem")
        case .light: appLocalized("ios.settings.themeLight")
        case .dark: appLocalized("ios.settings.themeDark")
        }
    }
}

/// 앱 설정 시트: 테마 + 언어(스펙 2026-07-19 iOS 다국어 §4).
/// 언어는 선택 즉시 적용된다 — 모든 표시 문자열이 `appLocalized`(언어별 lproj 직접
/// 조회)를 거치고, App이 언어를 `.id`에 넣어 탭 트리를 재생성하기 때문(앱 재시작 불필요).
/// 이 시트 자체는 App 레벨에 있어 재생성 밖이라 열린 채로 새 언어로 다시 그려진다.
/// 시트 등장 시 VoiceOver 포커스는 시스템이 이동시키므로 별도 처리 없음.
struct SettingsView: View {
    /// 도착 화면 "체중 입력하기"로 열렸을 때 true — 체중 필드에 VO 커서를 착지시킨다
    /// (앞에 피커 행이 열 개쯤 있어 스와이프로 찾아가게 두면 버튼의 약속이 반쯤 거짓이다).
    /// 착지 순서는 목록 포커스 정본(가시화 → 지연 → 대입) 그대로. 일반 진입은 시스템 기본.
    var focusWeightOnAppear = false
    @AccessibilityFocusState private var weightFieldFocused: Bool
    private static let weightRowID = "weightRow"

    /// 각 언어는 자국어 표기(고유명사라 로컬라이즈 대상 아님, 웹 nav.* 동일 어휘).
    private static let languages: [(code: String, name: String)] = [
        ("ko", "한국어"),
        ("en", "English"),
        ("es", "Español"),
        ("fr", "Français"),
        ("it", "Italiano"),
        ("ja", "日本語"),
    ]

    @AppStorage("themePreference") private var themeRaw = ThemePreference.system.rawValue
    // 받아쓰기 방식(탭 토글 기본 / 홀드) — 정본 enum은 HoldDictationButton.swift
    @AppStorage(DictationStyle.key) private var dictationRaw = DictationStyle.tapToggle.rawValue
    // 채팅 응답 듣기 속도 배율. 규칙·키 정본은 Kit ListenSpeed, 소비는 TtsPlayer 재생 시점.
    @AppStorage(ListenSpeed.storageKey) private var listenSpeed = 1.0
    #if DEBUG || EXPERIMENTAL
    // 왼쪽·오른쪽 안내음 구분 방식 후보 2종(실기기 선택 대기, spec 2026-08-22 §3).
    // 판정 뒤 이 피커와 Kit `LeftRightToneScheme`을 함께 지운다.
    @AppStorage(LeftRightToneScheme.storageKey) private var leftRightToneRaw =
        LeftRightToneScheme.default.rawValue
    #endif
    /// 언어 선택 변경 시 이 뷰를 다시 그리게 하는 관찰 지점(값은 Binding에서 읽지 않는다 —
    /// 미선택 상태 ""를 픽커 태그로 쓸 수 없어 실효 언어를 주는 AppLanguage.current가 정본).
    @AppStorage(AppLanguage.selectionKey) private var languageRaw = ""
    // AI 채팅 동의 상태. 해제하면 채팅이 다시 동의 화면으로.
    @AppStorage(AIChatConsent.key) private var aiConsentGranted = false
    // 칼로리 추정용 체중(spec 2026-08-17 §5). 0 = 미입력(도착 화면이 기본 65kg으로 계산하고
    // "기준 체중"을 밝힌다). 범위 밖(20~300)은 미입력으로 되돌린다. 기기 밖으로 나가지 않는다.
    @AppStorage(WalkHealth.weightStorageKey) private var weightKg = 0.0
    @State private var weightText = ""
    @Environment(\.dismiss) private var dismiss

    /// 실효 언어를 읽고, 선택 시 영속화+통지한다. 통지는 **바뀐 언어로** 낭독된다
    /// (조회가 이미 새 언어를 가리키므로) — 전환이 됐다는 사실 자체의 신호.
    private var languageSelection: Binding<String> {
        Binding(
            get: { AppLanguage.current },
            set: { code in
                guard code != AppLanguage.current else { return }
                AppLanguage.select(code)
                AccessibilityNotification.Announcement(
                    appLocalized("ios.settings.languageApplied")
                ).post()
            }
        )
    }

    private static func formatWeight(_ w: Double) -> String {
        w == w.rounded() ? String(Int(w)) : String(w)
    }

    /// 입력 문자열 → 저장값. 유효 범위 밖·비수치는 0(미입력)으로 — 잘못된 값으로 계산하지 않는다.
    private func commitWeight() {
        let raw = Double(weightText.replacingOccurrences(of: ",", with: "."))
        weightKg = WalkHealth.normalizedWeight(raw) ?? 0
    }

    /// 배속 선택지 라벨(1배/1.5배/2배). 허용값 정본은 `ListenSpeed.allowedSpeeds`.
    private static func listenSpeedLabel(_ speed: Double) -> String {
        switch speed {
        case 1.5: appLocalized("ios.settings.listenSpeed15x")
        case 2: appLocalized("ios.settings.listenSpeed2x")
        default: appLocalized("ios.settings.listenSpeed1x")
        }
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
            List {
                Picker(appLocalized("ios.settings.theme"), selection: $themeRaw) {
                    ForEach(ThemePreference.allCases, id: \.rawValue) { theme in
                        Text(theme.label).tag(theme.rawValue)
                    }
                }
                .pickerStyle(.inline)

                // 언어만 메뉴 피커(dodo-planet 동형): 6개 언어를 인라인으로 펼치면
                // 설정 목록을 압도한다 — 라벨 행에 현재 언어를 보이고 탭하면 메뉴로 선택.
                // VoiceOver엔 "언어, 현재값" 단일 객체(한 줄=한 객체).
                Picker(appLocalized("ios.settings.language"), selection: languageSelection) {
                    ForEach(Self.languages, id: \.code) { language in
                        Text(language.name).tag(language.code)
                    }
                }
                .pickerStyle(.menu)

                Picker(appLocalized("ios.settings.dictationStyle"), selection: $dictationRaw) {
                    ForEach(DictationStyle.allCases, id: \.rawValue) { style in
                        Text(style.label).tag(style.rawValue)
                    }
                }
                .pickerStyle(.inline)

                Picker(appLocalized("ios.settings.listenSpeed"), selection: $listenSpeed) {
                    ForEach(ListenSpeed.allowedSpeeds, id: \.self) { speed in
                        Text(Self.listenSpeedLabel(speed)).tag(speed)
                    }
                }
                .pickerStyle(.inline)

                #if DEBUG || EXPERIMENTAL
                Picker(appLocalized("ios.settings.leftRightTone"), selection: $leftRightToneRaw) {
                    Text(appLocalized("ios.settings.leftRightTonePan"))
                        .tag(LeftRightToneScheme.pan.rawValue)
                    Text(appLocalized("ios.settings.leftRightTonePitch"))
                        .tag(LeftRightToneScheme.pitch.rawValue)
                }
                .pickerStyle(.inline)
                #endif

                Section {
                    TextField(appLocalized("ios.settings.weightKg"), text: $weightText)
                        .keyboardType(.decimalPad)
                        .id(Self.weightRowID)
                        .accessibilityFocused($weightFieldFocused)
                        .onAppear { weightText = weightKg > 0 ? Self.formatWeight(weightKg) : "" }
                        .onChange(of: weightText) { _, _ in commitWeight() }
                }

                Section(appLocalized("ios.settings.aiSection")) {
                    // 해제하면 채팅이 다시 동의 화면으로 — 5.1.2(i)의 동의 재검토·철회 요건.
                    Toggle(appLocalized("ios.settings.aiConsentToggle"),
                           isOn: $aiConsentGranted)
                    Link(appLocalized("ios.common.privacyPolicy"),
                         destination: AppConfig.privacyPolicyURL)
                    // AI 생성 콘텐츠 신고 경로의 최소 대응(스펙 §1).
                    Link(appLocalized("ios.settings.reportProblem"),
                         destination: URL(string: "mailto:engccer@gmail.com")!)
                }

                Section {
                    NavigationLink(appLocalized("dataSources.title")) {
                        DataSourcesView()
                    }
                    NavigationLink(appLocalized("ios.settings.releaseNotes")) {
                        ReleaseNotesView()
                    }
                }
            }
            .task {
                guard focusWeightOnAppear else { return }
                proxy.scrollTo(Self.weightRowID)
                try? await Task.sleep(for: .milliseconds(400))
                weightFieldFocused = true
                // 검증·1회 재시도(오프스크린 행 대입은 조용히 되돌아온다 — 목록 포커스 정본).
                try? await Task.sleep(for: .milliseconds(600))
                guard !weightFieldFocused else { return }
                proxy.scrollTo(Self.weightRowID)
                try? await Task.sleep(for: .milliseconds(300))
                weightFieldFocused = true
            }
            }
            .navigationTitle(appLocalized("ios.settings.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(appLocalized("actions.close")) { dismiss() }
                }
            }
        }
    }
}

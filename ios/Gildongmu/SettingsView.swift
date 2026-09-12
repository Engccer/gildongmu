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
    /// 키보드 포커스 — **편집 종료의 신호**(A39 ⓐ). `.decimalPad`엔 Return이 없어 `onSubmit`이
    /// 오지 않으므로, 이탈·화면 닫힘 두 경로가 판정 시점이다(spec §2.1).
    @FocusState private var weightFieldEditing: Bool
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
    // 자동차 안내 청취자(K2 §6.1) — 자동차 안내가 봉인 안이라 실험 구성에서만 보인다(졸업 때 #if 삭제).
    @AppStorage(CarListener.storageKey) private var carListenerRaw = CarListener.default.rawValue
    @AppStorage(LeftRightToneScheme.storageKey) private var leftRightToneRaw =
        LeftRightToneScheme.default.rawValue
    // 진행 상태 진동(E30 실험판) — 켜면 가까워짐·정지·신뢰 불가 3종에 진동을 더한다. 꺼짐 = 종전 동작.
    // 소비는 `BeaconTonePlayer.haptic(for:)`, 대상 집합은 Kit `BeaconTone.hapticIsOptIn`.
    @AppStorage(TrendHaptics.storageKey) private var trendHapticsEnabled = false
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

    /// 편집 종료 시점의 커밋(A39, spec `docs/superpowers/specs/2026-09-11-settings-weight-commit-design.md`).
    /// 종전엔 타자 한 글자마다 돌며 범위 밖을 **0으로 덮어** "저장됨"과 "무시됨"을 뭉갰다(헌장 §1).
    /// 거절은 저장하지 않고 직전 값을 유지하며, 화면 변화가 없는 동작이라 통지가 유일한 증거다(헌장 §5 — `.high`).
    /// **멱등**이다: 거절 뒤 필드가 유효 표기로 되돌아가므로 두 번째 호출은 통지 없이 저장으로 끝난다.
    private func commitWeight() {
        switch WalkHealth.weightCommit(text: weightText) {
        case let .store(weight):
            weightKg = weight
            weightText = Self.formatWeight(weight)
        case .clear:
            weightKg = 0
            weightText = ""
        case .reject:
            // 포커스는 옮기지 않는다 — 커밋을 부른 것이 사용자의 이탈 자체라 그 자리가 사용자의 의도다.
            weightText = weightKg > 0 ? Self.formatWeight(weightKg) : ""
            var message = AttributedString(weightKg > 0
                ? appLocalized("ios.settings.weightRejected",
                               Self.weightMin, Self.weightMax, Self.formatWeight(weightKg))
                : appLocalized("ios.settings.weightRejectedNone", Self.weightMin, Self.weightMax))
            message.accessibilitySpeechAnnouncementPriority = .high
            ResultHaptic.fire(.failure)
            AccessibilityNotification.Announcement(message).post()
        }
    }

    /// 허용 범위는 Kit `WalkHealth.weightRange`가 정본이다 — 문장에 숫자를 박으면 상수가 바뀔 때
    /// 문장만 낡는다. 푸터·거절 통지가 같은 값을 인자로 받는다.
    private static let weightMin = Int(WalkHealth.weightRange.lowerBound)
    private static let weightMax = Int(WalkHealth.weightRange.upperBound)

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
                Picker(appLocalized("ios.settings.carListener"), selection: $carListenerRaw) {
                    Text(appLocalized("ios.settings.carListenerPassenger"))
                        .tag(CarListener.passenger.rawValue)
                    Text(appLocalized("ios.settings.carListenerDriver"))
                        .tag(CarListener.driver.rawValue)
                }
                .pickerStyle(.inline)

                Picker(appLocalized("ios.settings.leftRightTone"), selection: $leftRightToneRaw) {
                    Text(appLocalized("ios.settings.leftRightTonePan"))
                        .tag(LeftRightToneScheme.pan.rawValue)
                    Text(appLocalized("ios.settings.leftRightTonePitch"))
                        .tag(LeftRightToneScheme.pitch.rawValue)
                }
                .pickerStyle(.inline)

                Section {
                    Toggle(appLocalized("ios.settings.trendHaptics"), isOn: $trendHapticsEnabled)
                } footer: {
                    // 무엇이 더해지는지 + 조건(화면 켜짐) — 조건은 새 정보라 남긴다(헌장: 원인·조건·한계는 유지).
                    Text(appLocalized("ios.settings.trendHapticsFooter"))
                }
                #endif

                Section {
                    TextField(appLocalized("ios.settings.weightKg"), text: $weightText)
                        .keyboardType(.decimalPad)
                        .id(Self.weightRowID)
                        .accessibilityFocused($weightFieldFocused)
                        .focused($weightFieldEditing)
                        // 타자 중간값(5 → 50 → 500)은 전부 범위 밖이라 글자마다 판정하면 정상 입력이
                        // 거절된다 — 판정은 편집이 끝날 때(A39 ⓐ).
                        .onChange(of: weightFieldEditing) { _, editing in if !editing { commitWeight() } }
                } footer: {
                    // 허용 범위 상시 + "서버에 저장되지 않아요"(E31 §5 잔여 — 권유가 사라진 뒤 이 문장이
                    // 앱 어디에도 없었다). 두 문장이지만 단일 Text = 한 접근성 객체.
                    Text(appLocalized("ios.settings.weightFooter", Self.weightMin, Self.weightMax))
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
            // ⚠ **행이 아니라 화면 수명에 건다**(a11y 감사 M2·구현 리뷰): `List`는 행을 지연 실현·해제하므로
            // 이 둘을 TextField에 달면 VoiceOver 스와이프로 목록을 훑는 것만으로 커밋이 돌아, 타자 도중
            // 거절 통지 + 필드 되돌림이 나고 이어친 글자가 엉뚱한 값에 붙는다(A39 ⓐ가 막으려던 바로 그것).
            .onAppear { weightText = weightKg > 0 ? Self.formatWeight(weightKg) : "" }
            // 스와이프·VO escape로 닫힐 때의 폴백(멱등이라 [닫기] 경로와 겹쳐도 통지는 최대 1회).
            .onDisappear { commitWeight() }
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
                    // 닫기 전에 커밋한다 — `onDisappear`에서만 하면 거절 통지가 화면 전환에 묻힌다.
                    Button(appLocalized("actions.close")) {
                        commitWeight()
                        dismiss()
                    }
                }
            }
        }
    }
}

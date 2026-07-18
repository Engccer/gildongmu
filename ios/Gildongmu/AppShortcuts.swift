import AppIntents
import Observation

/// 단축어·Siri 진입 액션 종류.
enum LaunchAction {
    case voiceSearch
    case nearby
}

/// 인텐트→앱 통신 채널. `openAppWhenRun` 인텐트의 `perform()`은 앱 프로세스
/// 안에서 실행되므로 여기 액션을 기록하면 App이 관찰해 라우팅한다.
/// sessionEpoch 리셋으로 뷰가 전부 재생성돼도 앱 수명 싱글턴이라 살아남는다.
@Observable @MainActor
final class LaunchActionStore {
    static let shared = LaunchActionStore()

    /// 보류 진입 액션 1칸. 인텐트가 기록하고 App이 소비(리셋·탭 전환)한다.
    var pending: LaunchAction?
    /// App이 voiceSearch를 소비하며 세우고, 재생성된 SearchView가 내리면서
    /// 마이크를 시작한다. pending과 분리한 이유: TabView 재생성 시 .task가
    /// 다시 돌아도 pending은 이미 비어 있어 리셋이 멱등이다(재생성 루프 차단).
    var voiceStartRequested = false
}

/// 음성 검색 진입: 앱을 열고 초기 화면으로 리셋한 뒤 즉시 마이크 시작.
struct StartVoiceSearchIntent: AppIntent {
    static let title: LocalizedStringResource = "음성 검색"
    static let description = IntentDescription("길동무를 열고 바로 음성으로 검색합니다")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        LaunchActionStore.shared.pending = .voiceSearch
        return .result()
    }
}

/// 내 주변 진입: 앱을 열고 내 주변 허브 탭으로 이동.
struct OpenNearbyIntent: AppIntent {
    static let title: LocalizedStringResource = "내 주변"
    static let description = IntentDescription("길동무 내 주변 화면을 엽니다")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        LaunchActionStore.shared.pending = .nearby
        return .result()
    }
}

/// 단축어 앱 자동 노출 + Siri 문구(앱 설치만으로 등록). 문구엔 앱 이름 토큰 필수.
struct GildongmuShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartVoiceSearchIntent(),
            phrases: [
                "\(.applicationName) 음성 검색",
                "\(.applicationName)에서 음성으로 검색",
                "\(.applicationName) 음성 입력"
            ],
            shortTitle: "음성 검색",
            systemImageName: "mic"
        )
        AppShortcut(
            intent: OpenNearbyIntent(),
            phrases: [
                "\(.applicationName) 내 주변",
                "\(.applicationName) 내 주변 열어 줘"
            ],
            shortTitle: "내 주변",
            systemImageName: "location"
        )
    }
}

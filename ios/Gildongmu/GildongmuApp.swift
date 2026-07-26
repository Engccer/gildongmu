import SwiftUI
import GildongmuKit

/// 탭 정체성. selection이 TabView 밖(App 상태)에 살므로
/// 세션 리셋 시 `.id` 재생성만으론 첫 탭(채팅) 복귀가 안 된다 — 명시 복귀 필요.
/// `String` rawValue = 안정 식별자(스펙 10-A §8). 정수 인덱스였다면 탭 삽입 시
/// 순서가 밀려 저장된 값이 다른 탭을 가리키는 마이그레이션 결함이 생기지만,
/// 이름 기반 rawValue는 케이스를 어디에 끼워 넣어도 기존 값이 계속 같은 탭을 가리킨다.
enum AppTab: String {
    case chat
    case search
    case directions
    case nearby
}

@main
struct GildongmuApp: App {
    @Environment(\.scenePhase) private var scenePhase
    /// 세션 세대. 증가하면 .id로 TabView 전체(모델 포함)가 재생성돼
    /// 초기 화면으로 복귀한다 — 유휴 복귀·단축어 진입이 공유.
    @State private var sessionEpoch = 0
    /// 탭별 새로고침 세대. 해당 탭 콘텐츠만 .id 재생성한다(전체 리셋 sessionEpoch과 별개).
    @State private var chatEpoch = 0
    @State private var searchEpoch = 0
    @State private var directionsEpoch = 0
    @State private var nearbyEpoch = 0
    @State private var backgroundedAt: Date?
    @State private var selectedTab: AppTab = .chat
    /// 채팅 탭 대화 모델은 App 소유 — 리셋 경로에서 스트림을 요청째 폐기하기 위함
    /// (idle-reset 불변식: `.id` 재생성만으론 진행 중 Task가 취소되지 않는다).
    @State private var chatModel = ChatModel()
    /// 설정 시트 표시 상태를 App이 소유한다 — 아래 `.id` 재생성(언어 전환) 밖이라
    /// 설정 중 언어를 바꿔도 시트가 닫히지 않는다(SR 맥락 유지).
    @State private var showsSettings = false
    @AppStorage("themePreference") private var themeRaw = ThemePreference.system.rawValue
    /// 언어 선택 값. 그 자체가 `.id`에 들어가 전환 즉시 탭 트리를 재생성한다.
    /// 재생성이 필요한 이유: 표시 문자열은 `appLocalized`가 매번 조회하지만
    /// SwiftUI는 UserDefaults 변경을 모르므로 스스로 다시 그리지 않는다.
    /// (탭 내용 초기화는 부작용이 아니라 의도 — 검색 결과·주변 데이터는 로케일
    /// 의존이라 새 언어로 다시 받아야 한다.)
    @AppStorage(AppLanguage.selectionKey) private var languageRaw = ""
    private let launchStore = LaunchActionStore.shared
    private let directionsPrefillStore = DirectionsPrefillStore.shared
    /// 장소 상세·검색 "길찾기" 진입이 넘긴 도착지(Task I4). directionsEpoch와 함께
    /// 갱신되어야 DirectionsTabView 재생성 시점에 반영된다. SwiftUI는 `.id` 불변이면
    /// init 인자가 바뀌어도 기존 `@State`를 그대로 유지하므로, 값만 바꾸면 무시된다.
    @State private var directionsPrefill: DirectionsEndpoint?

    var body: some Scene {
        WindowGroup {
            // 아이콘은 SFSymbol(장식) — 시스템이 탭 라벨을 낭독한다
            TabView(selection: $selectedTab) {
                Tab(appLocalized("ios.tab.chat"), systemImage: "message", value: AppTab.chat) { ChatTabView(model: chatModel).id(chatEpoch) }
                Tab(appLocalized("ios.tab.search"), systemImage: "magnifyingglass", value: AppTab.search) { SearchView().id(searchEpoch) }
                Tab(appLocalized("ios.tab.directions"), systemImage: "signpost.right.and.left", value: AppTab.directions) { DirectionsTabView(prefilledDestination: directionsPrefill).id(directionsEpoch) }
                Tab(appLocalized("ios.tab.nearby"), systemImage: "location", value: AppTab.nearby) { NearbyHubView().id(nearbyEpoch) }
            }
            .id("\(sessionEpoch)#\(languageRaw)")
            .preferredColorScheme(ThemePreference(rawValue: themeRaw)?.colorScheme)
            .environment(\.refreshTab, refreshCurrentTab)
            .environment(\.openSettings, { showsSettings = true })
            // `.id` 바깥이라 언어 전환의 트리 재생성에도 열린 채로 유지된다.
            .sheet(isPresented: $showsSettings) { SettingsView() }
            // 콜드 런치에서 인텐트 perform()이 첫 body보다 먼저 끝난 경우를 소비.
            // 이후(웜 진입)는 onChange가 받는다. pending을 즉시 비우므로
            // epoch 재생성으로 .task가 다시 돌아도 멱등.
            .task { consumeLaunchAction() }
            .onChange(of: launchStore.pending) { _, _ in consumeLaunchAction() }
            // 인앱 "길찾기" 진입(장소 상세·검색): 단축어와 달리 세션 리셋 없음(다른 탭
            // 상태 보존). 콜드 런치 레이스가 없어(버튼은 앱 실행 중에만 눌린다)
            // .task 대응짝은 불필요하다. .onChange만으로 충분하다.
            .onChange(of: directionsPrefillStore.pending) { _, newValue in consumeDirectionsPrefill(newValue) }
            .onChange(of: scenePhase) { _, phase in
                switch phase {
                case .background:
                    backgroundedAt = .now
                case .active:
                    // .inactive(전화·알림센터 등 짧은 인터럽션)는 기록하지 않아
                    // 오리셋이 없다 — .background 경유 복귀만 판정.
                    if IdleReset.shouldReset(backgroundedAt: backgroundedAt, now: .now) {
                        resetSession()
                    }
                    backgroundedAt = nil
                default:
                    break
                }
            }
        }
    }

    /// 초기 화면 복귀(유휴 복귀·단축어 공용): 뷰 전체 재생성 + 채팅 탭 복귀.
    /// directionsPrefill도 함께 비운다(Task I4). 안 비우면 지난 "길찾기" 진입의
    /// 도착지가 리셋 후에도 살아남아 다음 길찾기 탭 진입에 유령으로 재적용된다.
    private func resetSession() {
        sessionEpoch += 1
        selectedTab = .chat
        resetChatModel()
        directionsPrefill = nil
    }

    /// 현재 탭만 초기 상태로(제목 메뉴 "새로고침"): 탭 이동 없음, 해당 탭 epoch만 증가.
    /// 채팅은 진행 중 스트림을 요청째 취소하고 새 대화로 교체한다(idle-reset 불변식 공유).
    /// 다른 탭은 `.id` 재생성만으로 충분하다. 뷰가 소멸하며 그 아래 Task도 함께 취소된다
    /// (SwiftUI 자식 뷰 소멸 시 `.task`가 캔슬 신호를 받는 계약, 명시 cancel 불필요).
    private func refreshCurrentTab() {
        switch selectedTab {
        case .chat:
            chatEpoch += 1
            resetChatModel()
        case .search:
            searchEpoch += 1
        case .directions:
            directionsEpoch += 1
            // "새로고침"은 완전한 빈 상태로 돌아가는 계약이라 프리필도 함께 비운다
            // (Task I4). 안 비우면 지난 "길찾기" 도착지가 새로고침 후에도 되살아난다.
            directionsPrefill = nil
        case .nearby:
            nearbyEpoch += 1
        }
    }

    /// 채팅 대화 폐기: 진행 중 스트림을 요청째 취소하고 새 대화로 교체(일회성 대화 계약).
    /// 뷰 재생성(.id)만으론 스트림 Task가 살아남아 유령 햅틱·낭독을 주입하므로 명시 취소가 필수.
    private func resetChatModel() {
        chatModel.cancel()
        chatModel = ChatModel()
    }

    /// 단축어 진입 라우팅. 두 액션 모두 초기 화면 리셋 후 목적 탭으로
    /// (딥 내비게이션에 머물던 화면 위에 탭만 바뀌는 어정쩡함 방지).
    /// voiceSearch는 마이크 시작을 재생성된 SearchView에 플래그로 위임.
    private func consumeLaunchAction() {
        guard let action = launchStore.pending else { return }
        launchStore.pending = nil
        // 직전 voiceSearch의 잔존 플래그를 액션 무관하게 소거(유령 마이크 시작 차단)
        launchStore.voiceStartRequested = false
        // 인텐트 진입 자체가 리셋이므로 같은 포그라운드 전환의 유휴 복귀 판정을
        // 무효화 — 실행 순서와 무관하게 인텐트가 고른 탭이 최종 승자.
        backgroundedAt = nil
        sessionEpoch += 1
        resetChatModel() // 인텐트 진입도 세션 리셋 — 채팅 스트림·대화 동반 폐기
        directionsPrefill = nil // 길찾기 프리필도 동반 폐기(Task I4, 유령 재적용 차단)
        switch action {
        case .voiceSearch:
            selectedTab = .search
            launchStore.voiceStartRequested = true
        case .nearby:
            selectedTab = .nearby
        }
    }

    /// 장소 상세·검색 결과 "길찾기" 진입 소비(Task I4). 세션 리셋 없이 길찾기 탭으로만
    /// 전환한다. 사용자가 이미 채팅·검색을 쓰던 중일 수 있어 단축어 진입과 달리 그
    /// 상태를 보존해야 한다. directionsEpoch 갱신이 DirectionsTabView를 새로 만들어
    /// 이전 도착지·결과를 원자 교체한다(브리프 §4).
    /// 최근 장소 기록(스펙 2026-07-26)도 여기서 1회 수행한다 — 프리필 이벤트가
    /// 정확히 한 번 발생하는 지점이라, DirectionsModel.init(App body 재평가마다
    /// 반복 호출)에서 기록하면 삭제한 최근 장소가 다음 재평가에서 부활하는
    /// 부수효과가 있었다(2026-07-26 리뷰 발견).
    private func consumeDirectionsPrefill(_ endpoint: DirectionsEndpoint?) {
        guard let endpoint else { return }
        directionsPrefillStore.pending = nil
        directionsPrefill = endpoint
        directionsEpoch += 1
        selectedTab = .directions
        if case .place(let label, let lat, let lng) = endpoint {
            // 프리필은 도착지 필드 확정이므로 도착지 스코프에 기록(분리 저장).
            RecentSearchStore().recordEndpoint(RecentEndpoint(label: label, lat: lat, lng: lng), scope: .to)
        }
    }
}

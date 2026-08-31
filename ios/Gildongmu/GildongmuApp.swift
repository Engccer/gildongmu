import SwiftUI
import GildongmuKit

/// 탭 정체성. selection이 TabView 밖(App 상태)에 살므로
/// 세션 리셋 시 `.id` 재생성만으론 기본 탭 복귀가 안 된다 — 명시 복귀 필요.
/// 탭 바 순서·기본 탭은 `AppTab.order`·`AppTab.initial`이 정한다(실험판 검색 - 길찾기 -
/// 내 주변 - 채팅 / 정식판 채팅 - 검색 - 길찾기 - 내 주변, `experimentalTabOrderEnabled`).
/// `String` rawValue = 안정 식별자(스펙 10-A §8). 정수 인덱스였다면 탭 삽입 시
/// 순서가 밀려 저장된 값이 다른 탭을 가리키는 마이그레이션 결함이 생기지만,
/// 이름 기반 rawValue는 케이스를 어디에 끼워 넣어도 기존 값이 계속 같은 탭을 가리킨다.
enum AppTab: String {
    case chat
    case search
    case directions
    case nearby

    /// 탭 바 순서(K1 ①, 위원장 판정 2026-08-23 — 실험판 판정 대기라 플래그로 가른다).
    static var order: [AppTab] {
        AppConfig.experimentalTabOrderEnabled
            ? [.search, .directions, .nearby, .chat]
            : [.chat, .search, .directions, .nearby]
    }

    /// 기본 탭 = 탭 바 첫 탭. 세션 리셋·콜드 런치 복귀 지점.
    static var initial: AppTab { order[0] }
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
    @State private var selectedTab: AppTab = .initial
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
    /// 실시간 안내 세션(N1) — 앱 수명. 시트·띠바도 여기서 띄운다(`.id` 바깥이라
    /// 언어 전환·세션 리셋에도 유지).
    private let guideSession = GuideSession.shared
    /// 띠바 버튼 착지(최소화 직후). 시트 dismiss가 VO 커서를 최상단으로 떨어뜨리는 것이
    /// 실기기 확정이라 지연·대입·검증·1회 재시도로 이긴다.
    /// 값 = 띠바를 든 탭(항목 정체성 옵셔널 바인딩). 18~25 폴백은 탭마다 띠바가 하나씩이라
    /// `Bool`이면 여러 뷰가 같은 참을 들어 탭 전환마다 커서를 끌어간다(리뷰 2026-08-23).
    @AccessibilityFocusState private var bandFocusedTab: AppTab?
    @State private var bandFocusTask: Task<Void, Never>?

    var body: some Scene {
        WindowGroup {
            // 아이콘은 SFSymbol(장식) — 시스템이 탭 라벨을 낭독한다
            // 탭 순서 = `AppTab.order`. 18~25 폴백 띠바는 각 탭 콘텐츠에 붙는다
            // (`withGuideBand`) — TabView 자체에 `safeAreaInset`을 걸면 inset이 탭 바
            // 자리에 그려져 탭 바를 시각·VoiceOver 모두에서 덮었다(실기기 2026-08-22).
            TabView(selection: $selectedTab) {
                ForEach(AppTab.order, id: \.self) { tab in
                    switch tab {
                    case .search:
                        Tab(appLocalized("ios.tab.search"), systemImage: "magnifyingglass", value: AppTab.search) { withGuideBand(.search, SearchView().id(searchEpoch)) }
                    case .directions:
                        Tab(appLocalized("ios.tab.directions"), systemImage: "signpost.right.and.left", value: AppTab.directions) { withGuideBand(.directions, DirectionsTabView(prefilledDestination: directionsPrefill).id(directionsEpoch)) }
                    case .nearby:
                        Tab(appLocalized("ios.tab.nearby"), systemImage: "location", value: AppTab.nearby) { withGuideBand(.nearby, NearbyHubView().id(nearbyEpoch)) }
                    case .chat:
                        Tab(appLocalized("ios.tab.chat"), systemImage: "message", value: AppTab.chat) { withGuideBand(.chat, ChatTabView(model: chatModel).id(chatEpoch)) }
                    }
                }
            }
            .id("\(sessionEpoch)#\(languageRaw)")
            // 최소화된 안내의 띠바(N1 spec §2.3) — 탭 바 바로 위, 모든 탭 공통. iOS 26은
            // 탭 바 액세서리가 그 자리(콘텐츠 → 띠바 → 탭 바)를 시스템이 보장한다.
            // 접근성 객체 하나(버튼). live region이 아니다 — 안내 통지는 모델 창구가 낸다.
            .modifier(GuideBandAccessory(isShown: showsGuideBand) { guideBand(tab: selectedTab) })
            // 안내 시트(N1 §2.2). item 하나로 두 시트를 직렬화한다(설계 리뷰 M2). 내리는
            // 제스처는 전부 최소화다 — 콜백 시점의 모델 상태로 뜻을 정하지 않는다(C3·C4).
            .sheet(item: Binding(
                get: { guideSession.presentedScreen },
                set: { screen in
                    if screen == nil, guideSession.hasScreen { guideSession.isMinimized = true }
                }
            )) { screen in
                switch screen {
                case .beacon:
                    BeaconTrackingSheet(
                        model: guideSession.beacon,
                        onStop: { guideSession.beacon.stopByUser() },
                        onMinimize: { guideSession.isMinimized = true },
                        onDestinationCommitted: { GuideFormSyncStore.shared.post($0) },
                        onWaypointCommitted: { GuideFormSyncStore.shared.postWaypoint($0) },
                        onCarWalkHandoff: { guideSession.acceptCarWalkHandoff() }
                    )
                case .transit:
                    TransitTrackingSheet(
                        model: guideSession.transit,
                        onStop: { guideSession.transit.stop(playStopTone: true) },
                        onWalkHandoff: guideSession.transit.dest == nil
                            ? nil : { guideSession.acceptWalkHandoff() },
                        detailDest: guideSession.transit.dest,
                        onDestinationCommitted: { GuideFormSyncStore.shared.post($0) },
                        onMinimize: { guideSession.isMinimized = true }
                    )
                }
            }
            // 화면이 사라지면 최소화·복귀 플래그·띠바 포커스를 되돌린다(설계 리뷰 M1·M9).
            .onChange(of: guideSession.hasScreen) { _, has in
                guard !has else { return }
                guideSession.isMinimized = false
                guideSession.returnedFromBand = nil
                bandFocusTask?.cancel()
                bandFocusTask = nil
                bandFocusedTab = nil
            }
            .onChange(of: guideSession.isMinimized) { _, minimized in
                bandFocusTask?.cancel()
                // 펼치면 바인딩을 비운다 — 안 비우면 다음 최소화의 대입이 같은 값이라
                // 포커스 전이가 걸리지 않는다(리뷰 2026-08-23).
                guard minimized else { bandFocusTask = nil; bandFocusedTab = nil; return }
                let target = selectedTab
                bandFocusTask = Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(450))
                    guard !Task.isCancelled else { return }
                    bandFocusedTab = target
                    try? await Task.sleep(for: .milliseconds(600))
                    guard !Task.isCancelled, bandFocusedTab != target else { return }
                    bandFocusedTab = target
                }
            }
            .preferredColorScheme(ThemePreference(rawValue: themeRaw)?.colorScheme)
            .environment(\.refreshTab, refreshCurrentTab)
            .environment(\.openSettings, { showsSettings = true })
            // `.id` 바깥이라 언어 전환의 트리 재생성에도 열린 채로 유지된다.
            .sheet(isPresented: $showsSettings) { SettingsView() }
            // 콜드 런치에서 인텐트 perform()이 첫 body보다 먼저 끝난 경우를 소비.
            // 이후(웜 진입)는 onChange가 받는다. pending을 즉시 비우므로
            // epoch 재생성으로 .task가 다시 돌아도 멱등.
            .task {
                #if DEBUG
                // 계측을 앱 수명 1회 설치로 올린다(종전엔 채팅 진입 시에만 설치돼,
                // 검색·길찾기 탭에서 시작된 받아쓰기가 로그에서 통째로 누락됐다 —
                // 2026-08-01 무음 통지 판정이 그 사각에 막혔던 실측).
                installChatFocusObserverOnce()
                #endif
                consumeLaunchAction()
                // 수동 위치 자동 해제 통지 채널. 사용자가 요청하지 않은 상태 변경이라
                // polite로 낸다. ⚠ 이 통지가 없으면 해제가 조용한 실패가 된다 —
                // VoiceOver는 포커스 밖 텍스트 변경을 읽지 않으므로 "표시줄이 말한다"는
                // 그 줄로 돌아갈 때만 성립하고, 표시줄이 없는 화면에서 복귀하면 아예
                // 만나지 못한다.
                ManualLocationJudge.announcer = {
                    AccessibilityNotification.Announcement(
                        appLocalized("manualLocation.autoCleared")
                    ).post()
                }
                // 판정 트리거 ③(앱 시작). onChange는 *변화*에만 발화하므로 콜드 런치의
                // 첫 .active를 놓칠 수 있다 — 그 창을 이 .task가 닫는다.
                await ManualLocationJudge.run()
            }
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
                    // 실시간 안내 세션이 살아 있으면 리셋하지 않는다(피드백 라운드1
                    // 11-가): 리셋의 TabView 재생성이 진행 중인 안내를 소멸시킨다 —
                    // 안내 중 복귀는 "유휴"가 아니다. 웹 IdleReset 동일 예외.
                    if IdleReset.shouldReset(backgroundedAt: backgroundedAt, now: .now),
                       !guideSession.isActive {
                        resetSession()
                    }
                    backgroundedAt = nil
                    // 판정 트리거 ①(포그라운드 복귀). 유휴 리셋 여부와 무관하다 —
                    // 짧게 나갔다 와도 그 사이에 이동했을 수 있다.
                    Task { await ManualLocationJudge.run() }
                default:
                    break
                }
                // 세션이 탭 밖에 살므로 전경·배경 전환도 여기서 전달한다(N1).
                guideSession.handleScenePhaseChange(to: phase)
            }
        }
    }

    private var showsGuideBand: Bool { guideSession.hasScreen && guideSession.isMinimized }

    /// 띠바 본체 — 26 액세서리와 18~25 폴백이 같은 뷰를 쓴다. 착지 바인딩은 항목 정체성
    /// 옵셔널(`bandFocusedTab == tab`)이라 18~25에서 탭마다 인스턴스가 있어도 최소화 시점의
    /// 선택 탭 것만 반응한다(CLAUDE.md "Bool 바인딩을 여러 행에 붙이지 말 것"). 26 액세서리는
    /// 인스턴스 하나라 현재 선택 탭을 정체성으로 쓴다.
    @ViewBuilder private func guideBand(tab: AppTab) -> some View {
        if showsGuideBand {
            GuideBandView(session: guideSession) {
                guideSession.returnedFromBand = guideSession.screen
                guideSession.isMinimized = false
            }
            .accessibilityFocused($bandFocusedTab, equals: tab)
        }
    }

    /// 18~25 폴백: 탭 **콘텐츠**의 하단 safe area에 띠바를 얹는다. 콘텐츠 safe area는
    /// 탭 바를 제외하므로 탭 바 바로 위에 놓이고, 콘텐츠 트리 안이라 VoiceOver 순서도
    /// 콘텐츠 → 띠바 → 탭 바다. 26은 액세서리가 맡으므로 여기선 아무것도 하지 않는다.
    @ViewBuilder private func withGuideBand(_ tab: AppTab, _ content: some View) -> some View {
        if #available(iOS 26, *) {
            content
        } else {
            content.safeAreaInset(edge: .bottom) { guideBand(tab: tab) }
        }
    }

    /// 초기 화면 복귀(유휴 복귀·단축어 공용): 뷰 전체 재생성 + 기본 탭 복귀.
    /// directionsPrefill도 함께 비운다(Task I4). 안 비우면 지난 "길찾기" 진입의
    /// 도착지가 리셋 후에도 살아남아 다음 길찾기 탭 진입에 유령으로 재적용된다.
    private func resetSession() {
        sessionEpoch += 1
        selectedTab = .initial
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

/// iOS 26 탭 바 액세서리(`tabViewBottomAccessory`)로 띠바를 탭 바 바로 위에 둔다.
/// 모디파이어를 조건부로 붙였다 뗐다 하지 않는다(TabView 정체성이 바뀌어 탭 상태가
/// 소멸) — 항상 붙이고 내용을 조건으로 비운다. 26 미만은 no-op(폴백은 `withGuideBand`).
private struct GuideBandAccessory<Band: View>: ViewModifier {
    let isShown: Bool
    @ViewBuilder let band: () -> Band

    func body(content: Content) -> some View {
        if #available(iOS 26.1, *) {
            // `isEnabled`가 꺼지면 액세서리 자리 자체가 사라진다(빈 캡슐 없음).
            content.tabViewBottomAccessory(isEnabled: isShown) { band() }
        } else if #available(iOS 26, *) {
            // 26.0엔 `isEnabled` 오버로드가 없다 — 내용을 비우는 것이 최선(`band`가
            // 조건으로 비어 있다).
            content.tabViewBottomAccessory { band() }
        } else {
            content
        }
    }
}

/// 띠바(N1) — 최소화된 안내를 탭 바 위 한 줄로 대표한다. 버튼 하나 = 접근성 객체 하나.
/// 라벨 = 수단별 요약 + "안내 시트 펼치기". 거리 낭독은 `spokenDistanceUnits`(VO가 `850m`을
/// minutes로 읽는다 — 설계 리뷰 M6), 시각은 `formatDistance` 원문.
struct GuideBandView: View {
    let session: GuideSession
    let onReturn: () -> Void

    var body: some View {
        Button(action: onReturn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(summaryText)
                    .font(.subheadline)
                Text(appLocalized("guide.band.return"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal)
            .padding(.vertical, 8)
            .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
        // ⚠ `ignoresSafeAreaEdges: []` 필수. 기본값(.all)은 배경을 아래 safe area까지 늘리는데
        // 탭 콘텐츠 inset 안에서 그 아래는 **탭 바**라, 버튼의 AX 프레임이 탭 바를 덮었다
        // (AXe 실측 2026-08-23: 높이 133pt, 자동화 탭이 탭 바에 떨어짐).
        .background(.bar, ignoresSafeAreaEdges: [])
        .accessibilityLabel(joinText(spokenUnits(summaryText), appLocalized("guide.band.return")))
    }

    /// 수단별 요약(spec §2.3 표). 비콘이 우선(핸드오프 600ms 창에서 `screen`과 같은 순서).
    private var summaryText: String {
        let beacon = session.beacon
        if beacon.isTracking {
            if let meters = beacon.bandDistanceMeters {
                return appLocalized("guide.band.remaining", beacon.destinationLabel, formatDistance(meters))
            }
            return appLocalized("guide.band.starting", beacon.destinationLabel)
        }
        if beacon.arrivalDest != nil {
            return appLocalized(
                beacon.endKind == .stopped ? "guide.band.ended" : "guide.band.arrived",
                beacon.destinationLabel)
        }
        let transit = session.transit
        let leg = transit.currentLeg
        switch guideBandSummary(
            phase: transit.state?.phase, boardStop: leg?.boardName, line: leg?.lineName,
            remaining: transit.state?.remaining, hasWalkHandoff: transit.pendingWalkHandoff != nil,
            destChangeLabel: transit.pendingDestChange?.label,
            destChangeFailed: {
                switch transit.pendingDestChange?.phase {
                case .failed, .empty: true
                default: false
                }
            }()
        ) {
        case .waiting(let stop, let line):
            return appLocalized("guide.band.transitWaiting", stop, line)
        case .riding(let line, let remaining?):
            return appLocalized("guide.band.transitRiding", line, remaining)
        case .riding(let line, nil):
            return appLocalized("guide.band.transitRidingNoCount", line)
        case .arrived:
            return appLocalized("guide.band.transitArrived", transit.destinationLabel)
        case .destChangePending(let label):
            return appLocalized("guide.band.transitDestChangePending", label)
        case .destChangeFailed(let label):
            return appLocalized("guide.band.transitDestChangeFailed", label)
        case nil:
            return ""
        }
    }
}

import SwiftUI
import GildongmuKit

extension EnvironmentValues {
    /// 세션 리셋 액션 — 검색 탭 제목 버튼(웹 헤더 제목 링크 동형)이 호출한다.
    @Entry var resetSession: () -> Void = {}
}

@main
struct GildongmuApp: App {
    @Environment(\.scenePhase) private var scenePhase
    /// 세션 세대. 증가하면 .id로 TabView 전체(모델·탭 선택 포함)가 재생성돼
    /// 초기 화면으로 복귀한다 — 유휴 복귀·제목 탭이 같은 메커니즘을 공유.
    @State private var sessionEpoch = 0
    @State private var backgroundedAt: Date?

    var body: some Scene {
        WindowGroup {
            // 아이콘은 SFSymbol(장식) — 시스템이 탭 라벨을 낭독한다
            TabView {
                Tab("검색", systemImage: "magnifyingglass") { SearchView() }
                Tab("내 주변", systemImage: "location") { NearbyHubView() }
            }
            .id(sessionEpoch)
            .environment(\.resetSession, { sessionEpoch += 1 })
            .onChange(of: scenePhase) { _, phase in
                switch phase {
                case .background:
                    backgroundedAt = .now
                case .active:
                    // .inactive(전화·알림센터 등 짧은 인터럽션)는 기록하지 않아
                    // 오리셋이 없다 — .background 경유 복귀만 판정.
                    if IdleReset.shouldReset(backgroundedAt: backgroundedAt, now: .now) {
                        sessionEpoch += 1
                    }
                    backgroundedAt = nil
                default:
                    break
                }
            }
        }
    }
}

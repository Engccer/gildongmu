import SwiftUI

@main
struct GildongmuApp: App {
    var body: some Scene {
        WindowGroup {
            // 아이콘은 SFSymbol(장식) — 시스템이 탭 라벨을 낭독한다
            TabView {
                Tab("검색", systemImage: "magnifyingglass") { SearchView() }
                Tab("내 주변", systemImage: "location") { NearbyHubView() }
            }
        }
    }
}

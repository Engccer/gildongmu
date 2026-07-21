import SwiftUI

/// 길찾기 탭 스텁(Task I2), 4탭 개조 자리표시자.
/// 본체(출발/도착 필드·검색 시트·3수단 결과)는 Task I3에서 구현한다(스펙 §6).
struct DirectionsTabView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView(appLocalized("ios.directions.placeholder"), systemImage: "signpost.right.and.left")
                .navigationTitle(appLocalized("ios.tab.directions"))
                .navigationBarTitleDisplayMode(.inline)
                .gildongmuTitleMenu()
        }
    }
}

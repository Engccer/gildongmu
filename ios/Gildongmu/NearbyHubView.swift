import SwiftUI

/// 내 주변 허브: 현재 위치 정위+8개 도메인 화면 진입점.
/// 위치 요청은 여기서 하지 않는다(각 도메인 화면 진입 시, When In Use 계약).
struct NearbyHubView: View {
    var body: some View {
        NavigationStack {
            List {
                NavigationLink(String(localized: "whereAmI.button")) { WhereAmIView() }
                NavigationLink(String(localized: "ios.nearby.subway")) { SubwayNearbyView() }
                NavigationLink(String(localized: "ios.nearby.bus")) { BusNearbyView() }
                NavigationLink(String(localized: "ios.nearby.bike")) { BikeNearbyView() }
                NavigationLink(String(localized: "ios.nearby.clinic")) { ClinicNearbyView() }
                NavigationLink(String(localized: "ios.nearby.barrierFree")) { BarrierFreeNearbyView() }
                NavigationLink(String(localized: "ios.nearby.kids")) { KidsNearbyView() }
                NavigationLink(String(localized: "ios.nearby.around")) { AroundNearbyView() }
                NavigationLink(String(localized: "ios.nearby.conditions")) { ConditionsView() }
            }
            .navigationTitle(String(localized: "ios.tab.nearby"))
            .navigationBarTitleDisplayMode(.inline)
            .gildongmuTitleMenu()
        }
    }
}

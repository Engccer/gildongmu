import SwiftUI

/// 내 주변 허브: 현재 위치 정위+9개 도메인 화면 진입점.
/// 위치 요청은 여기서 하지 않는다(각 도메인 화면 진입 시, When In Use 계약).
struct NearbyHubView: View {
    var body: some View {
        NavigationStack {
            List {
                NavigationLink(appLocalized("whereAmI.button")) { WhereAmIView() }
                NavigationLink(appLocalized("ios.nearby.subway")) { SubwayNearbyView() }
                NavigationLink(appLocalized("ios.nearby.bus")) { BusNearbyView() }
                NavigationLink(appLocalized("ios.nearby.bike")) { BikeNearbyView() }
                NavigationLink(appLocalized("ios.nearby.clinic")) { ClinicNearbyView() }
                NavigationLink(appLocalized("ios.nearby.barrierFree")) { BarrierFreeNearbyView() }
                NavigationLink(appLocalized("ios.nearby.kids")) { KidsNearbyView() }
                NavigationLink(appLocalized("ios.nearby.around")) { AroundNearbyView() }
                NavigationLink(appLocalized("ios.nearby.events")) { EventsNearbyView() }
                NavigationLink(appLocalized("walkInfra.button")) { WalkInfraNearbyView() }
                NavigationLink(appLocalized("ios.nearby.conditions")) { ConditionsView() }
            }
            .navigationTitle(appLocalized("ios.tab.nearby"))
            .navigationBarTitleDisplayMode(.inline)
            .gildongmuTitleMenu()
        }
    }
}

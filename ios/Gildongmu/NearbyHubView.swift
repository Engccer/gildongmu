import SwiftUI

/// 내 주변 허브 — 6개 도메인 화면 진입점.
/// 위치 요청은 여기서 하지 않는다(각 도메인 화면 진입 시, When In Use 계약).
struct NearbyHubView: View {
    var body: some View {
        NavigationStack {
            List {
                NavigationLink("지하철 도착") { SubwayNearbyView() }
                NavigationLink("버스 도착") { BusNearbyView() }
                NavigationLink("따릉이 대여소") { BikeNearbyView() }
                NavigationLink("소아 야간진료") { ClinicNearbyView() }
                NavigationLink("아이 놀 곳") { KidsNearbyView() }
                NavigationLink("둘러보기") { AroundNearbyView() }
            }
            .navigationTitle("내 주변")
        }
    }
}

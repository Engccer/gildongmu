import SwiftUI

/// 내 주변 허브: 현재 위치 정위+9개 도메인 화면 진입점.
/// 위치 요청은 여기서 하지 않는다(각 도메인 화면 진입 시, When In Use 계약).
struct NearbyHubView: View {
    #if DEBUG || EXPERIMENTAL
    /// 음향신호기 BLE 진단 모델(spec 2026-08-17, 2026-08-20 허브 최상단 이동 — 위원장 요청:
    /// 하위 화면에 들어가지 않고 어디서든 바로 진단). 수명은 이 화면이 쥔다 — `shutdown()`은
    /// NavigationStack 수준 onDisappear에만(Section에 걸면 lazy 렌더라 스크롤로, List에 걸면
    /// 하위 화면 push로 스캔이 죽는다).
    @State private var probe = AudioSignalProbeModel()
    #endif

    var body: some View {
        NavigationStack {
            List {
                Section { LocationBarView() }
                #if DEBUG || EXPERIMENTAL
                AudioSignalProbeSection(model: probe)
                #endif
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
        // ⚠ List가 아니라 NavigationStack에 건다 — List의 onDisappear는 형제 NavigationLink로
        // 하위 화면을 push하기만 해도 발화해 진행 중 진단을 무통지로 죽인다(리뷰 검출). 스택
        // 수준은 탭 전환에서만 발화한다. 하위 화면에 들어가 있어도 진단은 이어진다.
        #if DEBUG || EXPERIMENTAL
        .onDisappear { probe.shutdown() }
        #endif
    }
}

import SwiftUI
import GildongmuKit

/// 현재 위치 표시줄. **형제 버튼 둘**이다(중첩 인터랙티브 금지).
///
/// 수동 위치가 켜져 있으면 "현재 위치"라는 표현을 쓰지 않는다.
struct LocationBarView: View {
    @State private var store = ManualLocationStore.shared
    @State private var pickerOpen = false
    @AccessibilityFocusState private var pickFocused: Bool

    var body: some View {
        HStack {
            Button(label) { pickerOpen = true }
                .frame(minHeight: 44)
                .accessibilityFocused($pickFocused)
            if store.current != nil {
                Button(appLocalized("manualLocation.clear")) {
                    store.clear()
                    // 자기를 없애는 버튼이라 포커스가 이탈한다. 계속 존재하는
                    // 지정 버튼으로 옮긴다(헌장 §5).
                    pickFocused = true
                }
                .frame(minWidth: 44, minHeight: 44)
            }
        }
        .sheet(isPresented: $pickerOpen) {
            DirectionsEndpointSearchView(target: .manualLocation) { endpoint in
                Task { await commit(endpoint) }
            }
        }
    }

    private var label: String {
        guard let m = store.current else {
            return appLocalized("manualLocation.gps")
        }
        return m.origin == nil
            ? appLocalized("manualLocation.manualUnverifiable", m.label)
            : appLocalized("manualLocation.manual", m.label)
    }

    @MainActor
    private func commit(_ endpoint: DirectionsEndpoint) async {
        switch endpoint {
        case .current:
            store.clear()   // 이 맥락에서 "현재 위치 사용"은 해제를 뜻한다
        case .place(let label, let lat, let lng):
            // origin은 지정 시점의 적격 실측 fix. 없으면 판정이 undecidable이 된다.
            let fix = try? await LocationService.shared.currentFix(force: true)
            let now = Date().timeIntervalSince1970
            let origin = fix.flatMap { isEligibleManualFix($0, now: now) ? $0 : nil }
            store.set(label: label, lat: lat, lng: lng, origin: origin)
        }
    }
}

import SwiftUI
import CoreLocation
import GildongmuKit

/// 표시용 수동 위치 라벨. 수동 위치가 없으면 `nil`이고 그때 호출부가 자기 GPS 문구를 쓴다.
///
/// **표시줄·길찾기 출발지·현위치 정위가 이 함수 하나를 쓴다.** 세 곳이 각자 분기하면
/// 검증 가능/불가 판정선이 갈라지고, 갈라진 것을 화면으로 확인할 수 없다.
/// 웹 `useManualLocationLabel()`이 같은 약속을 미러한다.
///
/// ⚠ **스토어를 인자로 받는다(기본값 없음).** 호출 뷰가 그 스토어를 붙들고 있어야
/// `current`·`verdict` 접근이 body 평가 중 관찰로 등록되어 지정·해제·판정이 라벨에
/// 즉시 반영된다. 기본값을 주면 그 의존이 호출부에서 보이지 않게 된다.
@MainActor
func manualLocationLabel(_ store: ManualLocationStore) -> String? {
    guard let m = store.current else { return nil }
    return isManualLocationVerified(m, verdict: store.verdict)
        ? appLocalized("manualLocation.manual", m.label)
        : appLocalized("manualLocation.manualUnverifiable", m.label)
}

/// 현재 위치 표시줄. **형제 버튼 둘**이다(중첩 인터랙티브 금지).
///
/// 수동 위치가 켜져 있으면 "현재 위치"라는 표현을 쓰지 않는다.
struct LocationBarView: View {
    @State private var store = ManualLocationStore.shared
    @State private var location = LocationService.shared
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

    /// 상태 + **동작**을 한 텍스트로. 상태만 이름으로 쓰면 VoiceOver가 "현재 위치,
    /// 버튼"으로 읽어 누르면 무엇이 되는지 단서가 0이다 — 이 기능의 유일한 진입점이고
    /// 형제 버튼("지정 해제")은 동작으로 이름이 붙어 한 줄 안에서 명명이 비대칭이었다.
    private var label: String {
        "\(state), \(appLocalized("manualLocation.pickTitle"))"
    }

    /// 4-state(웹 `LocationBar.tsx` 미러): 수동 / GPS 실패 / GPS 좌표 있음 / 확인 중.
    ///
    /// ⚠ 수동이 아니면 무조건 "현재 위치"라고 말하면 안 된다 — 권한이 없거나 측위가
    /// 실패해도 표시줄만 들어서는 위치가 정상인 것으로 들리고, 그 상태로 "내 주변"에
    /// 들어가야 비로소 오류를 만난다(3-state 정직성).
    ///
    /// 실패를 좌표 유무보다 먼저 본다 — 권한을 회수해도 `lastCoordinate`는 남으므로
    /// (재취득 실패 시 직전 좌표 보존이 계약이다) 좌표를 먼저 보면 회수를 못 알린다.
    /// 웹도 스토어 status가 `denied`로 덮이므로 같은 순서다.
    private var state: String {
        if let manual = manualLocationLabel(store) { return manual }
        switch location.observedAuthorization {
        case .denied, .restricted:
            return appLocalized("manualLocation.gpsFailed")
        default:
            // notDetermined(아직 안 물음)·허용인데 fix 전 둘 다 "확인 중" — 실패는
            // 확정됐을 때만 말한다(웹이 idle을 실패로 오판하지 않는 것과 같은 이유).
            return location.lastCoordinate == nil
                ? appLocalized("manualLocation.locating")
                : appLocalized("manualLocation.gps")
        }
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

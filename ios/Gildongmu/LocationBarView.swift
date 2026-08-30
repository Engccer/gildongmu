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

/// 현재 위치 표시줄. **버튼 하나**다.
///
/// 수동 위치가 켜져 있으면 "현재 위치"라는 표현을 쓰지 않는다.
///
/// ⚠ **형제 "지정 해제" 버튼을 되돌리지 말 것**(위원장 실사용 판정 2026-08-09).
/// GPS가 기본값이라 수동 지정은 의도적으로 고른 상태이고, 되돌리기는 지정 시트의
/// "현재 위치로 되돌리기"(`DirectionsEndpointSearchView`의 `.manualLocation` 분기)가
/// 담당한다 — 첫 화면에 상시 노출할 빈도가 아니다. 해제 경로가 이제 그 한 곳뿐이므로
/// 그 버튼이나 아래 `commit(.current)` 분기를 지우면 사용자가 수동 위치에 갇힌다.
struct LocationBarView: View {
    @State private var store = ManualLocationStore.shared
    @State private var location = LocationService.shared
    @State private var addressStore = CurrentAddressStore.shared
    @State private var pickerOpen = false

    var body: some View {
        Button { pickerOpen = true } label: {
            // 비-ko 주소 병기(E28): 시각 `… (한글) …`, 낭독은 영문·로마자만.
            Text(label(addressName?.display)).accessibilityLabel(Text(label(addressName?.primary)))
        }
            .frame(minHeight: 44)
            .sheet(isPresented: $pickerOpen) {
                DirectionsEndpointSearchView(target: .manualLocation) { endpoint in
                    Task { await commit(endpoint) }
                }
            }
            // 수동 위치가 켜지고 꺼질 때마다 다시 판정한다(`.task`는 등장 시 1회뿐이라
            // 해제 후 주소가 영영 안 붙는다). 조회 자체는 스토어가 좌표당 1회로 막는다.
            .task(id: store.current == nil) {
                guard store.current == nil else { return }
                await addressStore.ensureLoaded()
            }
    }

    /// 상태 + **동작**을 한 텍스트로. 상태만 이름으로 쓰면 VoiceOver가 "현재 위치,
    /// 버튼"으로 읽어 누르면 무엇이 되는지 단서가 0이다 — 이 기능의 유일한 진입점이다.
    private func label(_ address: String?) -> String {
        "\(state(address: address)), \(appLocalized("manualLocation.pickTitle"))"
    }

    /// 현재 위치 주소의 병기 이름(E28). 주소 미확보면 nil — 라벨은 "현재 위치"로 폴백한다.
    private var addressName: BilingualName? {
        addressStore.address.map { bilingual($0, en: addressStore.english, roman: nil) }
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
    private func state(address: String?) -> String {
        if let manual = manualLocationLabel(store) { return manual }
        switch location.observedAuthorization {
        case .denied, .restricted:
            return appLocalized("manualLocation.gpsFailed")
        default:
            // notDetermined(아직 안 물음)·허용인데 fix 전은 "확인 중"이다 — 실패는
            // 확정됐을 때만 말한다(웹이 idle을 실패로 오판하지 않는 것과 같은 이유).
            //
            // ⚠ 다만 **시도해서 실패한 상태는 확정된 실패다**(백로그 D22). 그것까지
            // "확인 중"으로 두면 실내 측위 실패·타임아웃 뒤 표시줄이 무기한 진행 중을
            // 말한다 — 거짓 성공이 아니라 멈춘 진행이라 화면으로 반증되지 않는다.
            // 웹은 거부·위치불가·타임아웃을 모두 `denied`로 합쳐 이 갈래가 없다.
            guard location.lastCoordinate != nil else {
                return appLocalized(location.lastFixFailed
                    ? "manualLocation.gpsFailed"
                    : "manualLocation.locating")
            }
            // GPS 상태에서만 실주소를 병기한다. 이 기능의 존재 이유가 "GPS가 틀렸을
            // 때 스스로 고치는 것"인데, 주소가 없으면 시각장애 사용자는 GPS가 틀렸다는
            // 사실 자체를 알 방법이 없다(위원장 실사용 판정 2026-08-09). 주소 미확보는
            // 기존 "현재 위치"로 폴백한다 — 모르면 거짓을 말하지 않는다.
            if let address {
                return appLocalized("manualLocation.gpsNear", address)
            }
            return appLocalized("manualLocation.gps")
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

import Foundation
import Observation
import GildongmuKit

/// 현재 위치(GPS) 좌표의 대표 주소 캐시. 웹 `src/lib/current-address-store.ts` 미러.
///
/// 왜 공유 스토어인가:
/// `LocationBarView`는 검색·"내 주변"·채팅 세 화면 첫 줄에 있다. 각 뷰가 스스로
/// 역지오코딩하면 같은 좌표를 3번 조회한다. 스토어 하나가 좌표 키 단위로 결과를
/// 들고 있으면 화면을 오가도 조회는 좌표당 1회다.
///
/// **좌표당 1회이고 재시도하지 않는다.** 실패·미매칭도 그 좌표의 확정 결과로
/// 기록해 다시 조회하지 않는다. 주소는 부가 정보이므로 모르면 라벨이 "현재 위치"로
/// 남는 것이 정답이고(3-state 정직성), 재시도 루프는 라벨을 뒤늦게 바꿔 VoiceOver
/// 재낭독만 만든다.
///
/// ⚠ **좌표가 바뀌면 옛 주소를 먼저 버린다.** 새 좌표에 옛 주소를 붙여 두면 화면으로
/// 반증할 수 없는 거짓 위치 주장이 된다(`LocationService.coordinateForDisplay`가
/// 낡은 좌표를 막는 것과 같은 판단, 축만 다르다).
@Observable @MainActor
final class CurrentAddressStore {
    static let shared = CurrentAddressStore()

    /// 마지막으로 확정된 좌표의 대표 주소. nil = 미확보(조회 전·매칭 없음·실패).
    private(set) var address: String?

    /// 주소가 확정된 좌표의 키. 조회 중복 판정에만 쓴다.
    @ObservationIgnored private var loadedKey: String?
    /// 진행 중 조회 가드. 세 화면이 동시에 나타나도 왕복은 한 번이다.
    @ObservationIgnored private var inflight = false
    @ObservationIgnored private let service = SearchService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    private init() {}

    /// 캐시 키. 4자리 약 ±5.5m — GPS 오차보다 작아 같은 자리의 재조회를 만들지
    /// 않으면서, 실제로 움직였으면 키가 갈린다(웹 `coordAddressKey` 미러).
    private static func key(lat: Double, lng: Double) -> String {
        String(format: "%.4f,%.4f", lat, lng)
    }

    /// 표시용 좌표의 주소를 확보한다.
    ///
    /// 좌표는 `coordinateForDisplay()`가 준다 — **이미 허용된 세션에서만** 값을
    /// 돌려주므로 화면 진입만으로 권한 팝업이 뜨지 않는다(`LocationService` 관례,
    /// `DirectionsModel.loadCurrentAddressIfAuthorized` 선례).
    func ensureLoaded() async {
        if inflight { return }
        inflight = true
        defer { inflight = false }
        // 미허용이면 loadedKey를 세우지 않는다 — 나중에 권한을 허용하면 그때
        // 조회된다. 이 경로는 네트워크도 팝업도 없이 즉시 nil이라 재시도가 싸다.
        guard let coord = await LocationService.shared.coordinateForDisplay() else { return }
        let key = Self.key(lat: coord.lat, lng: coord.lng)
        if key == loadedKey { return }
        // 좌표가 갈렸으면 새 주소가 오기 전에 옛 주소를 버린다.
        if loadedKey != nil { address = nil }
        let resolved = (try? await service.reverseGeocode(lat: coord.lat, lng: coord.lng)) ?? nil
        // ⚠ **취소는 "그 좌표를 확정했다"가 아니다.** 호출부 `.task(id:)`는 수동 위치가
        // 켜지는 순간 이 태스크를 취소하는데(정상 흐름이다 — 사용자가 위치를 지정했다),
        // 그때 loadedKey를 세워 두면 나중에 수동 위치를 해제해도 "이미 조회한 좌표"로
        // 판정돼 주소가 영영 안 붙는다. 확정은 결과가 실제로 도착했을 때만 한다.
        guard !Task.isCancelled else { return }
        loadedKey = key
        address = resolved
    }
}

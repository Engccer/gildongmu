import Foundation
import CoreLocation
import Observation

/// 현재 위치 공유 싱글턴 — 웹 geolocation 모듈 싱글턴(`src/lib/geolocation.ts`)의 iOS 판.
/// 각 화면은 CLLocationManager 직접 생성 금지, 반드시 이 서비스 경유(spec §3).
/// 권한 요청은 "내 주변" 기능 최초 사용 시점(앱 시작 즉시 금지, When In Use만).
@Observable @MainActor
final class LocationService: NSObject, CLLocationManagerDelegate {
    static let shared = LocationService()

    enum LocationError: Error {
        case denied       // 권한 거부/제한
        case unavailable  // 취득 실패
    }

    /// 직전 성공 좌표 — 재취득 실패 시에도 보존(새로고침=재조회이지 데이터 포기 아님)
    private(set) var lastCoordinate: (lat: Double, lng: Double)?

    private let manager = CLLocationManager()
    /// 위치 쪽과 동일하게 배열 — 최초 권한 요청 구간에 동시 호출이 겹쳐도 전부 resume(스칼라면 덮어써 영구 대기)
    private var authContinuations: [CheckedContinuation<Void, Never>] = []
    private var locationContinuations: [CheckedContinuation<(lat: Double, lng: Double), any Error>] = []

    // MARK: - 비콘 연속 모드 (거리 추적 전용)

    /// 연속 fix 페이로드. `timestamp`가 있어야 캐시 위치를 가려낼 수 있다
    /// (`startUpdatingLocation()`의 첫 콜백은 흔히 캐시라 앵커가 수백 m 어긋난다).
    struct BeaconFixPayload: Sendable {
        let lat: Double
        let lng: Double
        /// 미터. **음수는 좌표 무효 신호**이므로 소비자가 걸러야 한다.
        let accuracy: Double
        let timestamp: Date
    }

    private var beaconFixSink: ((BeaconFixPayload) -> Void)?
    private var beaconErrorSink: (() -> Void)?
    private var beaconAuthSink: ((CLAuthorizationStatus) -> Void)?

    /// 추적 중인지. one-shot 경로가 이 값을 보고 분기한다.
    private(set) var isBeaconTracking = false

    /// 연속 위치 업데이트 시작. 매니저는 이 싱글턴이 단독 소유하므로
    /// 화면이 별도 `CLLocationManager`를 만들지 않는다(spec §3.5).
    ///
    /// ⚠ 권한 요청은 호출부(`BeaconModel`)가 먼저 처리한다. 여기서는 이미 허용된
    /// 상태를 전제로 스트림만 연다.
    func startBeaconUpdates(
        onFix: @escaping (BeaconFixPayload) -> Void,
        onError: @escaping () -> Void,
        onAuthChange: @escaping (CLAuthorizationStatus) -> Void
    ) {
        beaconFixSink = onFix
        beaconErrorSink = onError
        beaconAuthSink = onAuthChange
        isBeaconTracking = true

        // 서 있는 동안 시스템이 업데이트를 자동 정지하면 tick이 사라져 "죽었나"와
        // 구분되지 않는다(기본값 true). 보행 프로파일로 고정하고 거리 필터는 끈다
        // (데드밴드가 이미 필터라 이중 필터링 금지).
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = .fitness
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        manager.startUpdatingLocation()
    }

    func stopBeaconUpdates() {
        guard isBeaconTracking else { return }
        manager.stopUpdatingLocation()
        manager.pausesLocationUpdatesAutomatically = true
        isBeaconTracking = false
        beaconFixSink = nil
        beaconErrorSink = nil
        beaconAuthSink = nil
    }

    private override init() {
        super.init()
        manager.delegate = self
    }

    /// 이미 권한이 허용된 세션에서만 좌표를 취득한다(캐시 우선, 팝업 절대 없음).
    /// 검색의 근접 블렌딩용(2026-07-21) — "권한 요청은 내 주변 최초 사용 시"
    /// 계약을 지키면서, 허용 후 세션에선 검색도 좌표를 싣게 한다. 검색이 좌표
    /// 없이 나가면 전국 정확도순이 되어 근처 지점·시설이 매몰된다(아쿠아리움
    /// 실측: 충주 1위). 미허용·거부·취득 실패는 조용히 nil(검색은 좌표 없이 진행).
    func coordinateIfAuthorized() async -> (lat: Double, lng: Double)? {
        if let cached = lastCoordinate { return cached }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            return try? await currentCoordinate()
        default:
            return nil
        }
    }

    /// 권한 요청(최초 1회 시스템 팝업) + 현재 위치 1회 취득.
    /// force=true면 캐시를 버리고 정밀 재취득(웹 awaitGeolocation({force:true}) 계약).
    /// 실패해도 lastCoordinate는 유지된다.
    func currentCoordinate(force: Bool = false) async throws(LocationError) -> (lat: Double, lng: Double) {
        // 추적 중에는 requestLocation()을 부르지 않고 최신 스트림 fix로 답한다(spec §3.5).
        // ① 아래 desiredAccuracy 재대입이 추적 정확도를 100m로 깎고 복원하지 않는다
        //    (도달 경로 실재: 길찾기 재조회, 시트의 "현재 위치" 재선택)
        // ② startUpdatingLocation 활성 중 requestLocation의 안전성이 보장되지 않는다
        //    (1회 전달 후 스스로 정지시키는 의미론이라 스트림을 죽일 수 있다)
        // 스트림 fix가 lastCoordinate를 갱신하므로 이 값은 오히려 더 신선하다.
        if isBeaconTracking, let latest = lastCoordinate { return latest }

        if !force, let cached = lastCoordinate { return cached }

        if manager.authorizationStatus == .notDetermined {
            await withCheckedContinuation { continuation in
                authContinuations.append(continuation)
                manager.requestWhenInUseAuthorization()
            }
        }
        switch manager.authorizationStatus {
        case .denied, .restricted:
            throw LocationError.denied
        default:
            break
        }

        // 새로고침은 정밀 재취득(웹 PRECISE_OPTS 계약), 최초 취득은 근거리 정확도로 충분
        manager.desiredAccuracy = force ? kCLLocationAccuracyBest : kCLLocationAccuracyHundredMeters
        do {
            let coordinate = try await withCheckedThrowingContinuation { continuation in
                locationContinuations.append(continuation)
                manager.requestLocation()
            }
            lastCoordinate = coordinate
            return coordinate
        } catch {
            throw LocationError.unavailable
        }
    }

    // MARK: - CLLocationManagerDelegate (콜백 스레드 비보장 → 원시값만 MainActor로 반입)

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            let continuations = self.authContinuations
            self.authContinuations = []
            for continuation in continuations { continuation.resume() }
            // 추적 중 권한 회수는 continuation이 비어 있어 소실된다. 별도 싱크로 알린다
            // (라벨은 "중지"인데 소리만 사라지는 무한 침묵 방지).
            if self.isBeaconTracking { self.beaconAuthSink?(status) }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let lat = location.coordinate.latitude
        let lng = location.coordinate.longitude
        let accuracy = location.horizontalAccuracy
        let timestamp = location.timestamp
        Task { @MainActor in
            // 스트림 fix도 공유 스토어를 갱신한다. 안 하면 500m 걷고 조회했을 때
            // 출발 전 캐시 좌표로 경로가 계산된다("현재 위치는 한 곳" 불변식은
            // 호출 경로만이 아니라 값의 단일성까지를 뜻한다).
            self.lastCoordinate = (lat: lat, lng: lng)
            self.resumeLocationContinuations(with: .success((lat: lat, lng: lng)))
            if self.isBeaconTracking {
                self.beaconFixSink?(
                    BeaconFixPayload(lat: lat, lng: lng, accuracy: accuracy, timestamp: timestamp)
                )
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        Task { @MainActor in
            self.resumeLocationContinuations(with: .failure(error))
            if self.isBeaconTracking { self.beaconErrorSink?() }
        }
    }

    private func resumeLocationContinuations(with result: Result<(lat: Double, lng: Double), any Error>) {
        let continuations = locationContinuations
        locationContinuations = []
        for continuation in continuations { continuation.resume(with: result) }
    }
}

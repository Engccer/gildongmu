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

    private override init() {
        super.init()
        manager.delegate = self
    }

    /// 권한 요청(최초 1회 시스템 팝업) + 현재 위치 1회 취득.
    /// force=true면 캐시를 버리고 정밀 재취득(웹 awaitGeolocation({force:true}) 계약).
    /// 실패해도 lastCoordinate는 유지된다.
    func currentCoordinate(force: Bool = false) async throws(LocationError) -> (lat: Double, lng: Double) {
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
        Task { @MainActor in
            let continuations = self.authContinuations
            self.authContinuations = []
            for continuation in continuations { continuation.resume() }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let coordinate = locations.last?.coordinate else { return }
        let lat = coordinate.latitude
        let lng = coordinate.longitude
        Task { @MainActor in
            self.resumeLocationContinuations(with: .success((lat: lat, lng: lng)))
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        Task { @MainActor in
            self.resumeLocationContinuations(with: .failure(error))
        }
    }

    private func resumeLocationContinuations(with result: Result<(lat: Double, lng: Double), any Error>) {
        let continuations = locationContinuations
        locationContinuations = []
        for continuation in continuations { continuation.resume(with: result) }
    }
}

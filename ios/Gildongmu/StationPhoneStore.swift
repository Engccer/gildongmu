import Foundation
import Observation
import GildongmuKit

/// 경유역 전화번호 조회 결과 저장소(E44 spec §5.6). 역 상세 전화 줄과 경유역 행 로터가 같은 키로 공유한다.
///
/// - 메모리만. "번호·없음"은 5분 보관(서버 `kakao-local` 캐시 300초와 같은 수명 — 몇 시간 사는 안내 세션에서
///   카카오 결과를 무기한 들고 있지 않는다), 실패는 표시용으로만 두고 신선도를 기록하지 않아 다음 조회가 재시도한다.
/// - 같은 키 진행 중 조회는 공유한다. 조회 Task는 소비자와 무관한 비구조적 Task라 소비자가 사라져도 취소되지 않는다.
/// - ⚠ `results`만 관찰 대상이다. 시트 본문은 이것을 읽지 않는다 — 경유역 행 하위 뷰와 역 상세만 읽는다(spec §6).
@Observable @MainActor
final class StationPhoneStore {
    static let shared = StationPhoneStore()

    struct Key: Hashable {
        let station: String
        let line: String
        let lat: Int
        let lng: Int
    }

    static let freshSeconds: TimeInterval = 300

    private(set) var results: [Key: StationPhoneResult] = [:]
    @ObservationIgnored private var fetchedAt: [Key: Date] = [:]
    @ObservationIgnored private var inflight: [Key: Task<StationPhoneResult, Never>] = [:]
    @ObservationIgnored private let service = StationPhoneService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    /// 노선 표가 모르는 노선이면 nil — 그 역은 조회하지 않고 "없음"이다(spec §5.4-4).
    static func key(stationName: String, lat: Double, lng: Double, lineName: String) -> Key? {
        let station = stationNameKey(stationName)
        guard !station.isEmpty, let line = subwayLineIdentity(lineName) else { return nil }
        return Key(
            station: station, line: line,
            lat: Int((lat * 10_000).rounded()), lng: Int((lng * 10_000).rounded()))
    }

    /// 표시용 현재 값. nil = 아직 모름(조회 전·조회 중·5분 경과). 실패는 다음 조회 전까지 `.failed`로 보인다.
    func result(stationName: String, lat: Double, lng: Double, lineName: String) -> StationPhoneResult? {
        guard let key = Self.key(stationName: stationName, lat: lat, lng: lng, lineName: lineName) else {
            return .unavailable
        }
        guard let value = results[key] else { return nil }
        if value == .failed { return .failed }
        guard let at = fetchedAt[key], Date().timeIntervalSince(at) < Self.freshSeconds else { return nil }
        return value
    }

    @discardableResult
    func resolve(stationName: String, lat: Double, lng: Double, lineName: String) async -> StationPhoneResult {
        guard let key = Self.key(stationName: stationName, lat: lat, lng: lng, lineName: lineName) else {
            return .unavailable
        }
        if let value = results[key], value != .failed,
           let at = fetchedAt[key], Date().timeIntervalSince(at) < Self.freshSeconds {
            return value
        }
        if let running = inflight[key] { return await running.value }
        let service = self.service
        let task = Task {
            await service.lookup(stationName: stationName, lat: lat, lng: lng, lineName: lineName)
        }
        inflight[key] = task
        let value = await task.value
        inflight[key] = nil
        results[key] = value
        fetchedAt[key] = value == .failed ? nil : Date()
        return value
    }

    /// 경유역 목록을 펼치는 순간 그 구간 역 전부를 미리 조회한다(spec §6, 리뷰 M6 — 행 실현 시 조회는 액션이 조용히 늦게 생긴다).
    func prefetch(stops: [TransitLegStop], lineName: String) {
        for stop in stops {
            Task { await resolve(stationName: stop.name, lat: stop.lat, lng: stop.lng, lineName: lineName) }
        }
    }
}

import Foundation
import Observation
import GildongmuKit

/// 경유역 전화번호 조회 결과 저장소(E44 spec §5.6). 역 상세 전화 줄과 경유역 행 로터가 같은 키로 공유한다.
///
/// - 메모리만. 표시(`result`)는 마지막으로 기록된 값을 그대로 돌려주고 신선도를 보지 않는다 — 오래된 번호는
///   갱신이 끝날 때까지 보이고, 재렌더만으로 조용히 사라지지 않는다.
/// - 신선도는 `resolve`만 본다. "번호·없음"은 5분(서버 `kakao-local` 캐시 300초와 같은 수명) 안이면 그대로 쓰고,
///   지나면 다시 조회한다. 화면에 떠 있는 소비자는 `recheckSeconds`(30초)마다 `resolve`를 다시 불러 낡은 값을 갱신한다.
/// - 기록 뒤 갱신되지 않은 값은 `evictAfterSeconds`(6분)에 지운다 — 몇 시간 사는 안내 세션에서 카카오 결과를 무기한
///   들고 있지 않는다.
/// - 실패는 표시용으로만 두고 신선도를 기록하지 않아 다음 조회가 재시도한다. 재시도가 시작되면 지난 실패를 지워
///   조회 중에 "불러오지 못했습니다"를 말하지 않는다.
/// - 같은 키 진행 중 조회는 공유한다. 조회 Task는 소비자와 무관한 비구조적 Task라 소비자가 사라져도 취소되지 않고,
///   기록도 그 Task가 한다.
/// - ⚠ `results`만 관찰 대상이다. 시트 본문은 이것을 읽지 않는다 — 경유역 행 하위 뷰와 역 상세만 읽는다(spec §6).
@Observable @MainActor
final class StationPhoneStore {
    static let shared = StationPhoneStore()
    private init() {}

    struct Key: Hashable {
        let station: String
        let line: String
        let lat: Int
        let lng: Int
    }

    /// 번호·없음의 신선 수명(서버 `kakao-local` 캐시 300초와 같다). 이보다 오래된 값은 `resolve`가 다시 조회한다.
    static let freshSeconds: TimeInterval = 300
    /// 화면에 떠 있는 소비자가 `resolve`를 다시 부르는 간격. 신선한 동안은 네트워크 없이 바로 돌아오고, 값이 낡은 뒤
    /// 이 간격 안에 갱신이 시작된다 — 소비자가 나타난 시각과 값의 도장이 어긋나도 갱신이 늦지 않게.
    static let recheckSeconds: TimeInterval = 30
    /// 갱신되지 않은 값을 메모리에서 지우기까지의 시간. 최악의 갱신은 도장 뒤 `freshSeconds + recheckSeconds`에 시작해
    /// 조회 상한(3초) 안에 기록되므로, 재확인 간격 하나를 더 두어 지우는 순간이 갱신을 앞지르지 않게 한다(전화 줄 깜빡임 방지).
    static let evictAfterSeconds: TimeInterval = freshSeconds + 2 * recheckSeconds

    private var results: [Key: StationPhoneResult] = [:]
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

    /// 표시용 마지막 값. nil = 아직 모름(조회 전·첫 조회 중·실패 뒤 재시도 중·보관 한도로 지워짐).
    /// 신선도는 보지 않는다 — 오래된 번호는 갱신이 끝날 때까지 그대로 보인다(재렌더 때 번호가 조용히 사라지지 않게).
    func result(stationName: String, lat: Double, lng: Double, lineName: String) -> StationPhoneResult? {
        guard let key = Self.key(stationName: stationName, lat: lat, lng: lng, lineName: lineName) else {
            return .unavailable
        }
        return results[key]
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
        // 재시도 중에 지난 실패를 말하지 않는다(3-state) — 실패 줄은 이번 조회도 실패할 때만 다시 선다.
        if results[key] == .failed { results[key] = nil }
        let service = self.service
        let task = Task {
            let value = await service.lookup(stationName: stationName, lat: lat, lng: lng, lineName: lineName)
            // 기록은 조회 Task가 한다 — 기다리던 소비자가 사라져도 장부가 정리된다(공유 조회는 취소하지 않는다).
            self.inflight[key] = nil
            self.record(value, for: key)
            return value
        }
        inflight[key] = task
        return await task.value
    }

    /// 결과 기록. 실패는 도장 없이 둔다(다음 resolve가 재시도). 번호·없음은 도장을 찍고, 그 도장이 그대로면 보관 한도 뒤 지운다 —
    /// 몇 시간 사는 안내 세션에서 카카오 결과를 무기한 들고 있지 않는다(spec §5.6·§7).
    private func record(_ value: StationPhoneResult, for key: Key) {
        results[key] = value
        guard value != .failed else {
            fetchedAt[key] = nil
            return
        }
        let stamp = Date()
        fetchedAt[key] = stamp
        Task {
            try? await Task.sleep(for: .seconds(Self.evictAfterSeconds))
            if self.fetchedAt[key] == stamp {
                self.results[key] = nil
                self.fetchedAt[key] = nil
            }
        }
    }

    /// 경유역 목록을 펼치는 순간 그 구간 역 전부를 미리 조회한다(spec §6, 리뷰 M6 — 행 실현 시 조회는 액션이 조용히 늦게 생긴다).
    func prefetch(stops: [TransitLegStop], lineName: String) {
        for stop in stops {
            Task { await resolve(stationName: stop.name, lat: stop.lat, lng: stop.lng, lineName: lineName) }
        }
    }
}

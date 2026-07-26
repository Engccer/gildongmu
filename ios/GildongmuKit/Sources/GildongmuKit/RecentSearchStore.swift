import Foundation

/// 최근 검색 장소 항목(길찾기 endpoint 기록). 좌표 소수 4자리(≈11m) 일치 = 같은 장소.
public struct RecentEndpoint: Codable, Equatable, Hashable, Sendable {
    public let label: String
    public let lat: Double
    public let lng: Double

    public init(label: String, lat: Double, lng: Double) {
        self.label = label
        self.lat = lat
        self.lng = lng
    }
}

/// 길찾기 필드 스코프 — 출발지·도착지 기록은 분리 저장한다(위원장 지시 2026-07-26).
public enum RecentEndpointScope: String, Sendable {
    case from, to
}

/// 최근 검색 기록 저장소(스펙 docs/superpowers/specs/2026-07-26-recent-searches-design.md).
/// 검색어(검색 탭)·장소(길찾기 출발/도착 각각) 3목록 분리 기록, 기기 로컬(UserDefaults) 전용,
/// 목록별 최대 20개 최신순. 파싱 실패는 빈 목록으로 조용히 복구한다(기록은 부가 기능 —
/// 본 기능을 막지 않는다). 웹 src/lib/recent-searches.ts 미러.
public struct RecentSearchStore {
    public static let cap = 20
    static let queriesKey = "recentQueries.v1"

    static func endpointsKey(_ scope: RecentEndpointScope) -> String {
        "recentEndpoints.\(scope.rawValue).v1"
    }

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    // MARK: 검색어

    public func queries() -> [String] {
        decode([String].self, forKey: Self.queriesKey)
    }

    /// trim 후 기록. 빈 문자열은 무시(현재 목록 반환).
    @discardableResult
    public func recordQuery(_ raw: String) -> [String] {
        let query = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return queries() }
        return save(Self.append(query, to: queries(), isSame: ==), forKey: Self.queriesKey)
    }

    @discardableResult
    public func removeQuery(_ query: String) -> [String] {
        save(queries().filter { $0 != query }, forKey: Self.queriesKey)
    }

    public func clearQueries() {
        save([String](), forKey: Self.queriesKey)
    }

    // MARK: 장소 (출발지·도착지 스코프 분리)

    public func endpoints(_ scope: RecentEndpointScope) -> [RecentEndpoint] {
        decode([RecentEndpoint].self, forKey: Self.endpointsKey(scope))
    }

    /// 좌표 4자리 dedupe — 같은 장소의 라벨 변형은 최신 라벨로 교체하며 끌어올린다.
    @discardableResult
    public func recordEndpoint(_ endpoint: RecentEndpoint, scope: RecentEndpointScope) -> [RecentEndpoint] {
        save(Self.append(endpoint, to: endpoints(scope), isSame: Self.sameCoord), forKey: Self.endpointsKey(scope))
    }

    @discardableResult
    public func removeEndpoint(_ endpoint: RecentEndpoint, scope: RecentEndpointScope) -> [RecentEndpoint] {
        save(endpoints(scope).filter { !Self.sameCoord($0, endpoint) }, forKey: Self.endpointsKey(scope))
    }

    public func clearEndpoints(_ scope: RecentEndpointScope) {
        save([RecentEndpoint](), forKey: Self.endpointsKey(scope))
    }

    // MARK: 내부

    static func sameCoord(_ a: RecentEndpoint, _ b: RecentEndpoint) -> Bool {
        String(format: "%.4f", a.lat) == String(format: "%.4f", b.lat)
            && String(format: "%.4f", a.lng) == String(format: "%.4f", b.lng)
    }

    /// 순수 코어: 중복 제거 후 맨 앞 삽입, cap 절단(웹 appendRecent 미러).
    static func append<T>(_ item: T, to items: [T], isSame: (T, T) -> Bool) -> [T] {
        Array(([item] + items.filter { !isSame($0, item) }).prefix(cap))
    }

    private func decode<T: Decodable>(_ type: [T].Type, forKey key: String) -> [T] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode(type, from: data)) ?? []
    }

    @discardableResult
    private func save<T: Encodable>(_ items: [T], forKey key: String) -> [T] {
        if let data = try? JSONEncoder().encode(items) {
            defaults.set(data, forKey: key)
        }
        return items
    }
}

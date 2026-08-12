import Foundation

/// 최근 검색어 항목(검색 탭). 스펙 2026-08-12부터 고정(pinned)을 내장하는 구조체다 —
/// v1은 순수 문자열 배열이었고 v2 키로 승계한다.
public struct RecentQuery: Codable, Equatable, Hashable, Sendable {
    public let text: String
    public let pinned: Bool

    public init(text: String, pinned: Bool = false) {
        self.text = text
        self.pinned = pinned
    }
}

/// 최근 검색 장소 항목(길찾기 endpoint 기록). 좌표 소수 4자리(≈11m) 일치 = 같은 장소.
public struct RecentEndpoint: Codable, Equatable, Hashable, Sendable {
    public let label: String
    public let lat: Double
    public let lng: Double
    /// 고정 여부(스펙 2026-08-12). ⚠ RecentRoute의 from/to에 실릴 때는 무의미하다 —
    /// 경로의 고정은 경로 자체의 pinned이고, 동일 판정(sameCoord)도 이 값을 보지 않는다.
    public let pinned: Bool

    public init(label: String, lat: Double, lng: Double, pinned: Bool = false) {
        self.label = label
        self.lat = lat
        self.lng = lng
        self.pinned = pinned
    }

    /// pinned 부재(기존 v1 데이터)는 false — 저장 키를 올리지 않는 관용 디코딩.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = try c.decode(String.self, forKey: .label)
        lat = try c.decode(Double.self, forKey: .lat)
        lng = try c.decode(Double.self, forKey: .lng)
        pinned = try c.decodeIfPresent(Bool.self, forKey: .pinned) ?? false
    }
}

/// 최근 조회 경로(출발·도착 쌍, 스펙 2026-08-10). nil = "현재 위치" —
/// 활성화 시점에 재측위하므로 좌표를 굳히지 않는다. 웹 RecentRoute 미러.
public struct RecentRoute: Codable, Equatable, Hashable, Sendable {
    public let from: RecentEndpoint?
    public let to: RecentEndpoint?
    public let pinned: Bool

    public init(from: RecentEndpoint?, to: RecentEndpoint?, pinned: Bool = false) {
        self.from = from
        self.to = to
        self.pinned = pinned
    }

    /// pinned 부재(기존 v1 데이터)는 false — 저장 키를 올리지 않는 관용 디코딩.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        from = try c.decodeIfPresent(RecentEndpoint.self, forKey: .from)
        to = try c.decodeIfPresent(RecentEndpoint.self, forKey: .to)
        pinned = try c.decodeIfPresent(Bool.self, forKey: .pinned) ?? false
    }
}

/// 길찾기 필드 스코프 — 출발지·도착지 기록은 분리 저장한다(위원장 지시 2026-07-26).
public enum RecentEndpointScope: String, Sendable {
    case from, to
}

// MARK: 목록 정체성 (a11y 감사 2026-08-12)
//
// ⚠ ForEach에 `id: \.self`를 쓰면 안 된다 — Hashable에 pinned가 포함되어 고정 토글이
// 행의 정체성을 바꾸고, SwiftUI List는 정체성 변경을 삭제+삽입으로 처리해 VO 포커스를
// 쥔 행이 파괴된다(포커스 이탈). 아래 id는 dedupe 판정(텍스트/좌표 4자리/쌍)과 같은
// 축이라 토글·라벨 갱신에도 불변이다 — 행은 제자리에서 라벨만 바뀐다.

extension RecentQuery: Identifiable {
    public var id: String { text }
}

extension RecentEndpoint: Identifiable {
    /// 좌표 4자리 키 — sameCoord와 같은 축(라벨 변형·고정 토글에 불변).
    public var id: String {
        String(format: "%.4f,%.4f", lat, lng)
    }
}

extension RecentRoute: Identifiable {
    /// 출발·도착 쌍 키 — sameRoute와 같은 축(nil = 현재 위치).
    public var id: String {
        "\(from?.id ?? "cur")>\(to?.id ?? "cur")"
    }
}

/// 최근 검색 기록 저장소(스펙 docs/superpowers/specs/2026-07-26-recent-searches-design.md,
/// 고정은 2026-08-12-recent-pinning-design.md).
/// 검색어(검색 탭)·장소(길찾기 출발/도착 각각)·경로 목록 분리 기록, 기기 로컬(UserDefaults) 전용.
/// 파싱 실패는 빈 목록으로 조용히 복구한다(기록은 부가 기능 — 본 기능을 막지 않는다).
/// 웹 src/lib/recent-searches.ts 미러.
///
/// 고정(pin) 불변식: 저장 배열 = [고정 블록(고정 시점 순)] + [비고정 최신순, cap 20].
/// dedupe 판정은 pinned를 보지 않는다(같은 항목의 고정본·비고정본 공존 금지).
public struct RecentSearchStore {
    public static let cap = 20
    static let queriesKeyV1 = "recentQueries.v1"
    static let queriesKeyV2 = "recentQueries.v2"

    static func endpointsKey(_ scope: RecentEndpointScope) -> String {
        "recentEndpoints.\(scope.rawValue).v1"
    }

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    // MARK: 검색어

    public func queries() -> [RecentQuery] {
        // ⚠ "빈 v2"와 "v2 부재"를 구분한다 — 길이로 가르면 모두 지운 직후 v1이 부활한다.
        if defaults.data(forKey: Self.queriesKeyV2) != nil {
            return Self.partitionPinned(decode([RecentQuery].self, forKey: Self.queriesKeyV2), isPinned: \.pinned)
        }
        // v1(문자열 배열) 승계 — v1은 지우지 않는다(롤백 안전, 부가 기능이라 이중 보관 무해).
        return decode([String].self, forKey: Self.queriesKeyV1).map { RecentQuery(text: $0) }
    }

    /// trim 후 기록. 빈 문자열은 무시(현재 목록 반환).
    @discardableResult
    public func recordQuery(_ raw: String) -> [RecentQuery] {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return queries() }
        return save(
            Self.appendKeepingPins(
                RecentQuery(text: text), to: queries(),
                isSame: { $0.text == $1.text }, isPinned: \.pinned,
                withPinned: { RecentQuery(text: $0.text, pinned: $1) }),
            forKey: Self.queriesKeyV2)
    }

    @discardableResult
    public func removeQuery(_ text: String) -> [RecentQuery] {
        save(queries().filter { $0.text != text }, forKey: Self.queriesKeyV2)
    }

    /// 모두 지우기 — 고정은 보존한다(고정의 존재 이유, 위원장 확정 2026-08-12).
    @discardableResult
    public func clearQueries() -> [RecentQuery] {
        save(queries().filter(\.pinned), forKey: Self.queriesKeyV2)
    }

    @discardableResult
    public func setQueryPinned(_ text: String, pinned: Bool) -> [RecentQuery] {
        save(
            Self.setPinnedIn(
                RecentQuery(text: text), in: queries(), pinned: pinned,
                isSame: { $0.text == $1.text }, isPinned: \.pinned,
                withPinned: { RecentQuery(text: $0.text, pinned: $1) }),
            forKey: Self.queriesKeyV2)
    }

    // MARK: 장소 (출발지·도착지 스코프 분리)

    public func endpoints(_ scope: RecentEndpointScope) -> [RecentEndpoint] {
        Self.partitionPinned(decode([RecentEndpoint].self, forKey: Self.endpointsKey(scope)), isPinned: \.pinned)
    }

    /// 좌표 4자리 dedupe — 같은 장소의 라벨 변형은 최신 라벨로 교체한다(고정 항목은
    /// 자리 유지, 비고정은 끌어올림).
    @discardableResult
    public func recordEndpoint(_ endpoint: RecentEndpoint, scope: RecentEndpointScope) -> [RecentEndpoint] {
        save(
            Self.appendKeepingPins(
                endpoint, to: endpoints(scope),
                isSame: Self.sameCoord, isPinned: \.pinned,
                withPinned: { RecentEndpoint(label: $0.label, lat: $0.lat, lng: $0.lng, pinned: $1) }),
            forKey: Self.endpointsKey(scope))
    }

    @discardableResult
    public func removeEndpoint(_ endpoint: RecentEndpoint, scope: RecentEndpointScope) -> [RecentEndpoint] {
        save(endpoints(scope).filter { !Self.sameCoord($0, endpoint) }, forKey: Self.endpointsKey(scope))
    }

    /// 모두 지우기 — 고정은 보존한다.
    @discardableResult
    public func clearEndpoints(_ scope: RecentEndpointScope) -> [RecentEndpoint] {
        save(endpoints(scope).filter(\.pinned), forKey: Self.endpointsKey(scope))
    }

    @discardableResult
    public func setEndpointPinned(_ endpoint: RecentEndpoint, scope: RecentEndpointScope, pinned: Bool) -> [RecentEndpoint] {
        save(
            Self.setPinnedIn(
                endpoint, in: endpoints(scope), pinned: pinned,
                isSame: Self.sameCoord, isPinned: \.pinned,
                withPinned: { RecentEndpoint(label: $0.label, lat: $0.lat, lng: $0.lng, pinned: $1) }),
            forKey: Self.endpointsKey(scope))
    }

    // MARK: 경로 (출발·도착 쌍, 스펙 2026-08-10)

    static let routesKey = "recentRoutes.v1"

    public func routes() -> [RecentRoute] {
        Self.partitionPinned(decode([RecentRoute].self, forKey: Self.routesKey), isPinned: \.pinned)
    }

    /// 쌍 단위 dedupe 끌어올림(고정 쌍은 자리 유지). 양측 nil(현재 위치→현재 위치)은
    /// 재조회 의미가 없어 무기록.
    @discardableResult
    public func recordRoute(_ route: RecentRoute) -> [RecentRoute] {
        guard route.from != nil || route.to != nil else { return routes() }
        return save(
            Self.appendKeepingPins(
                route, to: routes(),
                isSame: Self.sameRoute, isPinned: \.pinned,
                withPinned: { RecentRoute(from: $0.from, to: $0.to, pinned: $1) }),
            forKey: Self.routesKey)
    }

    @discardableResult
    public func removeRoute(_ route: RecentRoute) -> [RecentRoute] {
        save(routes().filter { !Self.sameRoute($0, route) }, forKey: Self.routesKey)
    }

    /// 모두 지우기 — 고정은 보존한다.
    @discardableResult
    public func clearRoutes() -> [RecentRoute] {
        save(routes().filter(\.pinned), forKey: Self.routesKey)
    }

    @discardableResult
    public func setRoutePinned(_ route: RecentRoute, pinned: Bool) -> [RecentRoute] {
        save(
            Self.setPinnedIn(
                route, in: routes(), pinned: pinned,
                isSame: Self.sameRoute, isPinned: \.pinned,
                withPinned: { RecentRoute(from: $0.from, to: $0.to, pinned: $1) }),
            forKey: Self.routesKey)
    }

    static func sameRoute(_ a: RecentRoute, _ b: RecentRoute) -> Bool {
        sameSide(a.from, b.from) && sameSide(a.to, b.to)
    }

    /// 한쪽 판정: 현재 위치(nil)끼리 동일, place끼리는 좌표 4자리 일치.
    static func sameSide(_ a: RecentEndpoint?, _ b: RecentEndpoint?) -> Bool {
        switch (a, b) {
        case (nil, nil): true
        case let (l?, r?): sameCoord(l, r)
        default: false
        }
    }

    // MARK: 내부 (고정 공용 코어 — 웹 recent-searches.ts 미러)

    static func sameCoord(_ a: RecentEndpoint, _ b: RecentEndpoint) -> Bool {
        String(format: "%.4f", a.lat) == String(format: "%.4f", b.lat)
            && String(format: "%.4f", a.lng) == String(format: "%.4f", b.lng)
    }

    /// 불변식 정규화: [고정(저장 순서 유지)] + [비고정(저장 순서 유지)].
    /// 쓰기가 불변식을 유지하므로 레거시·수기 데이터 방어용이다.
    static func partitionPinned<T>(_ items: [T], isPinned: (T) -> Bool) -> [T] {
        items.filter(isPinned) + items.filter { !isPinned($0) }
    }

    /// 재기록: 같은 고정 항목이 있으면 자리 유지(최신본으로 교체 — 장소 라벨 갱신),
    /// 아니면 비고정 dup 제거 후 고정 블록 바로 뒤 삽입, 비고정만 cap(웹 appendKeepingPins 미러).
    static func appendKeepingPins<T>(
        _ item: T, to items: [T],
        isSame: (T, T) -> Bool, isPinned: (T) -> Bool, withPinned: (T, Bool) -> T
    ) -> [T] {
        if let i = items.firstIndex(where: { isPinned($0) && isSame($0, item) }) {
            var out = items
            out[i] = withPinned(item, true)
            return out
        }
        let pins = items.filter(isPinned)
        let rest = items.filter { !isPinned($0) && !isSame($0, item) }
        return pins + Array(([withPinned(item, false)] + rest).prefix(cap))
    }

    /// 고정 토글: 어느 방향이든 물리 위치는 두 블록의 경계(고정 = 고정 블록 맨 뒤,
    /// 해제 = 비고정 블록 맨 앞 — 같은 자리다). 없는 항목은 no-op(웹 setPinnedIn 미러).
    static func setPinnedIn<T>(
        _ item: T, in items: [T], pinned: Bool,
        isSame: (T, T) -> Bool, isPinned: (T) -> Bool, withPinned: (T, Bool) -> T
    ) -> [T] {
        guard let idx = items.firstIndex(where: { isSame($0, item) }) else { return items }
        var rest = items
        rest.remove(at: idx)
        return rest.filter(isPinned) + [withPinned(items[idx], pinned)] + rest.filter { !isPinned($0) }
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

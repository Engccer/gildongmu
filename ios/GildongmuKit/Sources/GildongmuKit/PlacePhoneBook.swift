import Foundation

/// 목적지 전화번호부의 한 줄(E90). 열쇠는 이름 + 좌표 소수 4자리(`RecentEndpoint`의 동일 판정과 같은 축)다.
public struct PlacePhoneEntry: Codable, Equatable, Sendable {
    public let label: String
    public let lat: Double
    public let lng: Double
    public let phone: String

    public init(label: String, lat: Double, lng: Double, phone: String) {
        self.label = label
        self.lat = lat
        self.lng = lng
        self.phone = phone
    }
}

/// 안내 목적지의 전화번호부(E90 「안내 시트의 목적지에 전화 걸기」) — 기기 로컬(UserDefaults) 전용.
///
/// 안내 세션은 목적지를 이름과 좌표로만 든다. 번호는 **목적지를 고르는 자리**(장소 줄·장소 상세·길찾기 검색·채팅 카드·
/// 나들이 줄)가 그때 손에 든 값을 `note`로 적고, 안내 시트가 제목의 이름·좌표로 `phone`을 찾는다. 그래서:
/// - 목적지를 바꾸면 새 목적지의 번호가 잡히고, 제목이 승차 정류장·환승역으로 바뀐 세션(승차 전 도보)은 열쇠가 맞지 않아
///   번호가 없다. 안내 세션(`StartRequest`·두 안내 모델)에는 번호를 태우지 않는다.
/// - 저장되므로 최근 도착지에서 다시 고른 가게도 번호가 붙는다(한 번이라도 번호와 함께 고른 적이 있을 때).
///
/// nil·빈 번호는 적지 않고 지우지도 않는다 — 앱의 `Place`는 투영(안내 목적지·정류장·행사)마다 번호를 비워 두므로
/// 빈 값은 "번호가 없다"가 아니라 "이 원천은 모른다"일 수 있다. 적힌 번호는 같은 장소를 새 번호로 다시 적을 때만 바뀐다.
/// 열쇠 불일치는 nil이고 호출부는 전화 동작을 세우지 않는다(죽은 동작 금지, 다른 장소의 번호를 붙이지 않는다).
public struct PlacePhoneBook {
    public static let cap = 200
    static let storageKey = "placePhoneBook.v1"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// 그 장소의 번호를 적는다(최신이 앞, `cap` 초과분은 오래된 것부터 버린다). nil·빈 값이면 아무것도 하지 않는다.
    public func note(label: String, lat: Double, lng: Double, phone: String?) {
        save(Self.noted(entries(), label: label, lat: lat, lng: lng, phone: phone))
    }

    /// 그 이름·좌표로 적힌 번호. 없으면 nil.
    public func phone(label: String, lat: Double, lng: Double) -> String? {
        Self.phone(in: entries(), label: label, lat: lat, lng: lng)
    }

    // MARK: 순수 판정

    static func noted(
        _ entries: [PlacePhoneEntry], label: String, lat: Double, lng: Double, phone: String?
    ) -> [PlacePhoneEntry] {
        let trimmed = phone?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return entries }
        let key = Self.key(label: label, lat: lat, lng: lng)
        let rest = entries.filter { Self.key(label: $0.label, lat: $0.lat, lng: $0.lng) != key }
        return Array(([PlacePhoneEntry(label: label, lat: lat, lng: lng, phone: trimmed)] + rest).prefix(cap))
    }

    static func phone(in entries: [PlacePhoneEntry], label: String, lat: Double, lng: Double) -> String? {
        let key = Self.key(label: label, lat: lat, lng: lng)
        return entries.first { Self.key(label: $0.label, lat: $0.lat, lng: $0.lng) == key }?.phone
    }

    /// 이름 + 좌표 4자리(≈11m). 이름까지 보는 것은 같은 건물의 다른 가게 번호를 붙이지 않기 위해서다.
    static func key(label: String, lat: Double, lng: Double) -> String {
        "\(label)|" + String(format: "%.4f,%.4f", lat, lng)
    }

    private func entries() -> [PlacePhoneEntry] {
        guard let data = defaults.data(forKey: Self.storageKey) else { return [] }
        return (try? JSONDecoder().decode([PlacePhoneEntry].self, from: data)) ?? []
    }

    private func save(_ entries: [PlacePhoneEntry]) {
        if let data = try? JSONEncoder().encode(entries) {
            defaults.set(data, forKey: Self.storageKey)
        }
    }
}

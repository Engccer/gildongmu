import Foundation

/// 장소 하나. 웹 `src/lib/types.ts` Place의 미러(계약 정본은 웹).
public struct Place: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let category: String
    public let address: String
    public let roadAddress: String
    public let englishAddress: String?
    public let lat: Double
    public let lng: Double
    public let phone: String?
    public let link: String?
    public let distanceMeters: Double?
}

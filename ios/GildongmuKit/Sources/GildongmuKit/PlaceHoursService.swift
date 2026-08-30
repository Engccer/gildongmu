import Foundation

/// 장소 상세 영업시간 한 줄(E24) — 서버 `/api/places/hours` 응답(웹 `PlaceHoursToday` 미러).
/// `ranges`가 비고 `allDay`도 거짓이면 **오늘 휴무**(시간표에 다른 요일은 있다).
public struct PlaceHoursToday: Codable, Sendable, Equatable {
    public struct Range: Codable, Sendable, Equatable {
        public let open: String
        public let close: String
        public let closesNextDay: Bool
        public init(open: String, close: String, closesNextDay: Bool) {
            self.open = open; self.close = close; self.closesNextDay = closesNextDay
        }
    }
    public let ranges: [Range]
    public let allDay: Bool
    public init(ranges: [Range], allDay: Bool) { self.ranges = ranges; self.allDay = allDay }
}

private struct PlaceHoursResponse: Decodable {
    let hours: PlaceHoursToday?
}

/// 요청 상한. 캐시 금지(약관)라 상세 열람마다 실호출이 끼므로 상한 없이는 upstream이 느릴 때
/// 이 줄 하나가 화면을 세운다 — 웹 `AbortSignal.timeout(3000)`과 짝(양 플랫폼 동일 상한).
private let requestTimeout: TimeInterval = 4

/// 비-throw 매칭 보조(무장애 `match` 동형): 네트워크·디코딩·`{"hours":null}`·429 전부 nil로
/// 수렴해 호출부가 줄을 만들지 않는다. ⚠ 이 출력은 VoiceOver만 읽는다 — `TtsPlayer`·
/// `speakGuidance`·채팅으로 흘려보내지 말 것(약관 §3.2.3(a)(iv), `place-hours-tts-drift.test.ts`).
public struct PlaceHoursService: Sendable {
    let client: APIClient

    public init(client: APIClient) { self.client = client }

    public func today(lat: Double, lng: Double, name: String, roadAddress: String) async -> PlaceHoursToday? {
        var query = coordQuery(lat: lat, lng: lng) + [URLQueryItem(name: "name", value: name)]
        if !roadAddress.isEmpty { query.append(URLQueryItem(name: "roadAddress", value: roadAddress)) }
        let response: PlaceHoursResponse? = try? await client.get("/api/places/hours", query: query, timeout: requestTimeout)
        return response?.hours
    }
}

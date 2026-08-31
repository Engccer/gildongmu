import Foundation

/// `/api/transit/track` 판별 union 응답(B2 §7). status: "ok" | "empty" | "unsupported".
/// upstream 오류는 502 → APIClient가 throw(클라는 failed로 소비).
public struct TransitTrackEnvelope: Codable, Sendable {
    public let mode: String
    public let status: String
    public let items: [TransitTrackItem]?
    /// 노선·경로 필터 전 원시 건수(§13.3, additive) — empty ∧ rawCount>0 = 필터 전멸.
    public let rawCount: Int?
    public let stop: TransitTrackResolvedStop?
}

/// 지방버스 하차 정류소 해석 결과(mode=tagoBus&phase=resolve).
public struct TransitTrackResolvedStop: Codable, Sendable, Equatable {
    public let nodeId: String
    public let cityCode: String
    public let name: String
}

/// 대중교통 추적 폴링 서비스 — 봉투 해석 없이 그대로 디코딩한다(서버가 판별 union으로
/// provider 차이를 이미 흡수했다, §7). 폴링 판정·상태는 TransitGuide 상태 머신 몫.
public struct TransitTrackService: Sendable {
    let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func get(_ query: [URLQueryItem]) async throws -> TransitTrackEnvelope {
        try await client.get("/api/transit/track", query: query)
    }

    /// 응답 → 상태 머신 입력. failed 변환은 호출자(catch) 몫.
    public static func poll(from envelope: TransitTrackEnvelope) -> TransitTrackPoll {
        switch envelope.status {
        case "ok": .ok(envelope.items ?? [])
        case "empty": .empty
        default: .unsupported
        }
    }

    /// ⚠ `lang`은 **기본값 없는 필수 인자**다(E27 잔여 ①, spec 2026-09-01 §3.3) — 생략이 컴파일을
    /// 통과하면 실시간 줄만 조용히 한국어로 떨어지고 서버는 400도 내지 않는다(부재 = ko가 정상 계약).
    public func seoulWait(arsId: String, routeId: String, lang: String) async throws -> TransitTrackEnvelope {
        try await get([
            URLQueryItem(name: "mode", value: "seoulBus"),
            URLQueryItem(name: "phase", value: "wait"),
            URLQueryItem(name: "arsId", value: arsId),
            URLQueryItem(name: "routeId", value: routeId),
            URLQueryItem(name: "lang", value: lang),
        ])
    }

    public func seoulRide(
        routeId: String, boardId: String, alightId: String, lang: String
    ) async throws -> TransitTrackEnvelope {
        try await get([
            URLQueryItem(name: "mode", value: "seoulBus"),
            URLQueryItem(name: "phase", value: "ride"),
            URLQueryItem(name: "routeId", value: routeId),
            URLQueryItem(name: "boardId", value: boardId),
            URLQueryItem(name: "alightId", value: alightId),
            URLQueryItem(name: "lang", value: lang),
        ])
    }

    /// ⚠ `lang` 없음 — 응답의 `stop.name`을 소비자가 표시하지 않고(nodeId·cityCode만 쓴다)
    /// TAGO 정류소명에는 영문 원천도 없다. 표시가 생기면 그때 `lang`을 더한다.
    public func resolveTagoStop(lat: Double, lng: Double) async throws -> TransitTrackEnvelope {
        try await get([
            URLQueryItem(name: "mode", value: "tagoBus"),
            URLQueryItem(name: "phase", value: "resolve"),
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
        ])
    }

    public func tagoTrack(
        cityCode: String, nodeId: String, routeNo: String, lang: String
    ) async throws -> TransitTrackEnvelope {
        try await get([
            URLQueryItem(name: "mode", value: "tagoBus"),
            URLQueryItem(name: "phase", value: "track"),
            URLQueryItem(name: "cityCode", value: cityCode),
            URLQueryItem(name: "nodeId", value: nodeId),
            URLQueryItem(name: "routeNo", value: routeNo),
            URLQueryItem(name: "lang", value: lang),
        ])
    }

    public func subwayTrack(station: String, line: String, lang: String) async throws -> TransitTrackEnvelope {
        try await get([
            URLQueryItem(name: "mode", value: "subway"),
            URLQueryItem(name: "phase", value: "track"),
            URLQueryItem(name: "station", value: station),
            URLQueryItem(name: "line", value: line),
            URLQueryItem(name: "lang", value: lang),
        ])
    }
}

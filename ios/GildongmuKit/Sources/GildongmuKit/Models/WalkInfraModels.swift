import Foundation

// 내 주변 보행 인프라 도메인 모델: 웹 /api/walk/nearby 계약 미러
// (정본은 src/lib/walk-infra.ts, 계약 픽스처는 Fixtures/walk-nearby*.json 실호출 캡처).
// 두 소스(음향신호기 seed·OSM)는 서로 독립적으로 강등된다 — 한쪽 실패가 다른 쪽을
// 오염시키지 않고, 両소스 전멸 시에만 서버가 503(throw)을 낸다.

/// 소스별 3-state discriminated union(웹 SourceStatus 미러): ok ≠ 미제공(unsupported,
/// 음향신호기=서울 밖) ≠ 조회 실패(error). 미지의 status는 웹 소비자와 동형으로
/// error 취급(ok·unsupported 외 전부 실패 문구 분기).
public enum WalkSourceStatus<T: Decodable & Sendable>: Decodable, Sendable {
    case ok(T)
    case unsupported
    case error

    private enum CodingKeys: String, CodingKey { case status, data }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .status) {
        case "ok": self = .ok(try container.decode(T.self, forKey: .data))
        case "unsupported": self = .unsupported
        default: self = .error
        }
    }
}

/// 음향신호기 지점 하나(≈11m 격자 군집 대표점). 거리는 서버 Math.round 보장(Int 안전).
/// bearing은 8방위 소문자 키("n"…"nw") — surroundingsNearby.direction.* 라벨 키와 결합.
public struct AudioSignalSite: Decodable, Sendable, Hashable {
    public let distanceMeters: Int
    public let bearing: String
    public let deviceCount: Int
}

/// 반경 300m 음향신호기 요약. deviceCount는 sites(최대 5) 절단 전 총수(침묵 절단 금지).
public struct NearbyAudioSignals: Decodable, Sendable {
    public let deviceCount: Int
    public let sites: [AudioSignalSite]
    /// 서울시 자료 기준일(예 "2026-05-28") — 출처 인용문에 표기
    public let baseDate: String
}

/// OSM 보행 feature 하나(횡단보도 또는 비-crossing 점자블록 점).
/// crossingSignal "yes"/"no"/"unknown", hostFeature "busStop"/"subwayEntrance"(판별
/// 가능할 때만 존재) — 신규 값에 깨지지 않도록 String 유지(RouteModels mode 관례).
public struct WalkFeature: Decodable, Sendable, Hashable {
    public let osmId: String
    public let crossing: Bool
    public let crossingSignal: String
    public let tactilePaving: Bool
    public let hostFeature: String?
    public let distanceMeters: Int
    public let bearing: String
}

/// OSM 데이터 묶음. crossingTotal·tactileTotal은 cap(각 10) 전 실개수 —
/// "N곳 중 가까운 M곳" 그룹 헤더의 근거(절단 침묵 금지).
public struct OsmWalkData: Decodable, Sendable {
    public let features: [WalkFeature]
    public let totalCount: Int
    public let listedCount: Int
    public let truncated: Bool
    public let crossingTotal: Int
    public let tactileTotal: Int

    /// 횡단보도 projection(거리순 유지). 웹 WalkInfraPanel filter 미러.
    public var crossings: [WalkFeature] { features.filter { $0.crossing } }
    /// 비-crossing 점자블록 projection. 웹 미러(crossing이면서 tactile인 점은 횡단보도 쪽).
    public var tactiles: [WalkFeature] { features.filter { !$0.crossing && $0.tactilePaving } }
}

/// /api/walk/nearby 응답 본문. 両소스 전멸이면 이 응답 대신 503(throw)이다.
public struct WalkInfrastructure: Decodable, Sendable {
    public let audioSignals: WalkSourceStatus<NearbyAudioSignals>
    public let osm: WalkSourceStatus<OsmWalkData>
}

struct WalkInfraEnvelope: Decodable, Sendable {
    let walk: WalkInfrastructure
}

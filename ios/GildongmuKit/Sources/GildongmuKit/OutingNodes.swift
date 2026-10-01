import Foundation

// ── 나들이 교차로·횡단보도 원천 합성(spec 2026-09-26 §6.6, E58 ①③) ──
// 횡단보도 셋(OSM 노드·서울 도보 네트워크·카카오 탐침)과 교차점 셋(OSM 도로망·서울 도보 네트워크·탐침 꺾임 지점)을
// 좌표 근접으로 합쳐 예고 후보를 만든다. 예고 판정(`outingCrosswalkNoticeStep`·`outingJunctionNoticeStep`)은
// 원천을 모른다 — 여기서 만든 후보 목록과 좌표 유도 id만 본다.
//
// ⚠ **latch id는 좌표에서 유도한다.** 원천별 id(OSM 노드 번호)로 latch하면 같은 횡단보도를 원천 수만큼 말하고,
// 탐침 응답은 호출마다 새 객체라 재조회 뒤 latch가 풀린다. 새 점이 이미 있는 점 `outingNodeMergeMeters` 안이면
// 그 점에 흡수되고, 아니면 자기 좌표로 id를 받는다 — 같은 자리는 세션 내내 같은 id다.
//
// ⚠ 탐침 결과는 세션 메모리에만 둔다(카카오 약관). 이 파일은 저장 수단을 갖지 않는다.

/// ⚠ 잠정값(spec §10). 원천 합성의 근접 거리(m). 서로 이만큼 안의 두 횡단보도는 하나로 예고된다.
public let outingNodeMergeMeters = 15.0
/// 교차점을 합칠 때 같은 갈래로 보는 방위 차(도). seed 방위가 10도 단위라 그 세 칸.
public let outingBranchMergeDegrees = 30.0
/// ⚠ 잠정값(spec §10). 탐침 간격(m) — 마지막 탐침 시도 좌표에서 직선(위원장 판정 "100m마다 1건"). 실패도 같은 간격이다
/// (카카오는 실패 호출도 센다, 설계 리뷰 M5).
public let outingProbeDistanceMeters = 100.0
/// 연속 실패가 이만큼이면 그 세션의 탐침을 끈다(정적 원천은 그대로).
public let outingProbeFailureLimit = 3

/// 교차점 갈래의 길 종류. 문장은 골목(`alley`)과 그 밖(길) 둘로만 가른다.
public enum OutingBranchKind: String, Sendable, Equatable {
    /// 작은 차도(OSM residential·service 등, 서울망 차량 겸용 링크).
    case alley
    /// 큰길(OSM tertiary 이상).
    case road
    /// 보행로(footway·path·steps, 서울망 보행 전용 링크).
    case path
    /// 종류 모름(탐침 꺾임 지점, 미지 값).
    case unknown
}

/// 갈래 하나 — 교차점에서 그 길 쪽으로 약 25m 간 점과 길 종류.
public struct OutingBranch: Sendable, Equatable {
    public let lat: Double
    public let lng: Double
    public let kind: OutingBranchKind

    public init(lat: Double, lng: Double, kind: OutingBranchKind) {
        self.lat = lat
        self.lng = lng
        self.kind = kind
    }
}

/// 교차점 하나 — 좌표 유도 id·좌표·갈래.
public struct OutingJunction: Sendable, Equatable {
    public let id: String
    public let lat: Double
    public let lng: Double
    public let branches: [OutingBranch]

    public init(id: String, lat: Double, lng: Double, branches: [OutingBranch]) {
        self.id = id
        self.lat = lat
        self.lng = lng
        self.branches = branches
    }
}

/// 좌표 유도 id(`cw:`·`jn:` + 소수 5자리).
public func outingNodeId(_ prefix: String, lat: Double, lng: Double) -> String {
    "\(prefix):" + String(format: "%.5f,%.5f", lat, lng)
}

/// 횡단보도 점들을 기존 후보에 합친다(순서대로 — 같은 응답 안의 가까운 두 점도 하나가 된다).
public func outingMergeCrosswalks(
    _ existing: [String: OutingCrosswalk], adding points: [RoutePoint]
) -> [String: OutingCrosswalk] {
    var out = existing
    for p in points where p.lat.isFinite && p.lng.isFinite {
        let near = out.values.contains {
            haversineMeters(lat1: $0.lat, lng1: $0.lng, lat2: p.lat, lng2: p.lng) <= outingNodeMergeMeters
        }
        if near { continue }
        let id = outingNodeId("cw", lat: p.lat, lng: p.lng)
        out[id] = OutingCrosswalk(id: id, lat: p.lat, lng: p.lng)
    }
    return out
}

private func angleGap(_ a: Double, _ b: Double) -> Double {
    abs((a - b + 540).truncatingRemainder(dividingBy: 360) - 180)
}

/// 교차점들을 기존 후보에 합친다(`id`는 무시하고 다시 유도한다). 근접 교차점이 있으면 갈래만 더한다 — 이미 있는
/// 갈래와 방위가 `outingBranchMergeDegrees` 안이면 버리고, 새 갈래는 기존 교차점 좌표로 평행 이동해 붙인다(갈래의
/// 방향을 보존한다 — 판정은 교차점과 갈래 점의 차로 방향을 읽는다).
public func outingMergeJunctions(
    _ existing: [String: OutingJunction], adding incoming: [OutingJunction]
) -> [String: OutingJunction] {
    var out = existing
    for j in incoming where j.lat.isFinite && j.lng.isFinite {
        let host = out.values
            .map { ($0, haversineMeters(lat1: $0.lat, lng1: $0.lng, lat2: j.lat, lng2: j.lng)) }
            .filter { $0.1 <= outingNodeMergeMeters }
            .min { $0.1 < $1.1 }?.0
        guard let host else {
            let id = outingNodeId("jn", lat: j.lat, lng: j.lng)
            out[id] = OutingJunction(id: id, lat: j.lat, lng: j.lng, branches: j.branches)
            continue
        }
        var branches = host.branches
        for b in j.branches {
            let bearing = bearingDegrees(fromLat: j.lat, fromLng: j.lng, toLat: b.lat, toLng: b.lng)
            let dup = branches.contains {
                angleGap(bearing, bearingDegrees(fromLat: host.lat, fromLng: host.lng, toLat: $0.lat, toLng: $0.lng))
                    <= outingBranchMergeDegrees
            }
            if dup { continue }
            branches.append(OutingBranch(lat: host.lat + (b.lat - j.lat), lng: host.lng + (b.lng - j.lng), kind: b.kind))
        }
        out[host.id] = OutingJunction(id: host.id, lat: host.lat, lng: host.lng, branches: branches)
    }
    return out
}

/// 탐침 간격 판정 — 보낼 방위(아니면 nil). 마지막 시도가 없거나 그 좌표에서 직선 `outingProbeDistanceMeters` 이상이고,
/// 연속 실패가 `outingProbeFailureLimit` 미만이고, 방위가 valid일 때만(방위 없는 "앞 180m"는 정의되지 않는다).
public func outingProbeStep(lastProbe: RoutePoint?, failures: Int, at: RoutePoint, heading: OutingHeading) -> Double? {
    guard failures < outingProbeFailureLimit, case let .valid(bearing, _) = heading else { return nil }
    if let last = lastProbe,
       haversineMeters(lat1: last.lat, lng1: last.lng, lat2: at.lat, lng2: at.lng) < outingProbeDistanceMeters {
        return nil
    }
    return bearing
}

// MARK: - 서버 응답(`/api/walk/nearby?coords=1&nodes=1` · `/api/walk/probe`)

struct OutingPointDTO: Decodable, Sendable {
    let lat: Double
    let lng: Double
}

struct OutingBranchDTO: Decodable, Sendable {
    let lat: Double
    let lng: Double
    let kind: String
}

struct OutingJunctionDTO: Decodable, Sendable {
    let lat: Double
    let lng: Double
    let branches: [OutingBranchDTO]

    var junction: OutingJunction {
        OutingJunction(
            id: "", lat: lat, lng: lng,
            branches: branches.map { OutingBranch(lat: $0.lat, lng: $0.lng, kind: OutingBranchKind(rawValue: $0.kind) ?? .unknown) })
    }
}

struct OutingJunctionListDTO: Decodable, Sendable {
    let junctions: [OutingJunctionDTO]
}

struct OutingSeoulNetworkDTO: Decodable, Sendable {
    let crosswalks: [OutingPointDTO]
    let junctions: [OutingJunctionDTO]
}

/// 원천 하나의 3-state(미제공 ≠ 0건 ≠ 실패). 필드가 오지 않은 응답(옛 서버)은 실패다.
public enum OutingNodeSource<T: Sendable>: Sendable {
    case ok(T)
    case unsupported
    case error

    /// 받은 값(미제공·실패는 빈 목록 — 후보 조립은 "더할 것이 없다"만 안다. 상태 구분은 로그가 맡는다).
    public var value: T? {
        if case .ok(let v) = self { return v }
        return nil
    }

    /// 로그 표기(`ok`·`unsupported`·`error`).
    public var logLabel: String {
        switch self {
        case .ok: "ok"
        case .unsupported: "unsupported"
        case .error: "error"
        }
    }
}

/// 나들이 보행 노드 조회 결과 — 원천별 3-state를 그대로 둔다.
public struct OutingWalkNodes: Sendable {
    /// 종전 보행 인프라(OSM 횡단보도·음향신호기).
    public let infra: WalkInfrastructure
    public let osmJunctions: OutingNodeSource<[OutingJunction]>
    public let seoulCrosswalks: OutingNodeSource<[RoutePoint]>
    public let seoulJunctions: OutingNodeSource<[OutingJunction]>
}

struct OutingWalkNodesEnvelope: Decodable, Sendable {
    let walk: Body

    struct Body: Decodable, Sendable {
        let infra: WalkInfrastructure
        let osmJunctions: WalkSourceStatus<OutingJunctionListDTO>?
        let seoulNetwork: WalkSourceStatus<OutingSeoulNetworkDTO>?

        private enum CodingKeys: String, CodingKey { case osmJunctions, seoulNetwork }

        init(from decoder: Decoder) throws {
            infra = try WalkInfrastructure(from: decoder)
            let c = try decoder.container(keyedBy: CodingKeys.self)
            osmJunctions = try c.decodeIfPresent(WalkSourceStatus<OutingJunctionListDTO>.self, forKey: .osmJunctions)
            seoulNetwork = try c.decodeIfPresent(WalkSourceStatus<OutingSeoulNetworkDTO>.self, forKey: .seoulNetwork)
        }
    }
}

/// 탐침 한 번의 결과(세션 메모리에서만 쓴다).
public struct OutingProbe: Sendable, Equatable {
    public let crosswalks: [RoutePoint]
    /// 꺾는 자리 하나에 갈래 하나(꺾어 들어가는 길, 종류 모름).
    public let turns: [OutingJunction]
}

struct OutingProbeEnvelope: Decodable, Sendable {
    let probe: Body?

    struct Body: Decodable, Sendable {
        let crosswalks: [OutingPointDTO]
        let turns: [Turn]
    }

    struct Turn: Decodable, Sendable {
        let lat: Double
        let lng: Double
        let branch: OutingPointDTO
    }
}

private func map<T: Decodable & Sendable, U: Sendable>(_ s: WalkSourceStatus<T>?, _ f: (T) -> U) -> OutingNodeSource<U> {
    switch s {
    case .ok(let v): .ok(f(v))
    case .unsupported: .unsupported
    case .error, .none: .error
    }
}

extension WalkInfraService {
    /// 나들이 보행 노드(E58 ①③): 종전 좌표 옵트인(`coords=1`) + 교차점·서울망 횡단보도(`nodes=1`).
    /// ⚠ 서버 `nodes=1`이 배포된 뒤에만 두 필드가 온다(옛 서버는 무시하고 종전 응답 — 필드 부재는 실패로 읽는다).
    /// `WalkInfraService.swift`가 아니라 여기 두는 이유: 안드로이드 `:kit` 이식 완료 파일을 건드리지 않고 나들이 이식 때
    /// 함께 옮겨지게(`OutingRequery.swift`의 `outingSurroundings`와 같은 이유).
    public func outingNodes(lat: Double, lng: Double) async throws -> OutingWalkNodes {
        let envelope: OutingWalkNodesEnvelope = try await client.get(
            "/api/walk/nearby",
            query: coordQuery(lat: lat, lng: lng) + [
                URLQueryItem(name: "coords", value: "1"), URLQueryItem(name: "nodes", value: "1"),
            ])
        let body = envelope.walk
        return OutingWalkNodes(
            infra: body.infra,
            osmJunctions: map(body.osmJunctions) { $0.junctions.map(\.junction) },
            seoulCrosswalks: map(body.seoulNetwork) { $0.crosswalks.map { RoutePoint(lat: $0.lat, lng: $0.lng) } },
            seoulJunctions: map(body.seoulNetwork) { $0.junctions.map(\.junction) })
    }

    /// 카카오 도보 탐침 1건(진행 방위로 180m 앞까지). 키 없음(404)·실패는 throw, 한국 밖은 `APIError.outOfCoverage`.
    /// ⚠ 결과를 저장하지 않는다 — 호출부가 세션 메모리에서만 쓴다(카카오 약관).
    public func outingProbe(lat: Double, lng: Double, bearing: Double) async throws -> OutingProbe {
        let envelope: OutingProbeEnvelope = try await client.get(
            "/api/walk/probe",
            query: coordQuery(lat: lat, lng: lng) + [URLQueryItem(name: "bearing", value: String(format: "%.0f", bearing))])
        let body = envelope.probe
        return OutingProbe(
            crosswalks: (body?.crosswalks ?? []).map { RoutePoint(lat: $0.lat, lng: $0.lng) },
            turns: (body?.turns ?? []).map {
                OutingJunction(
                    id: "", lat: $0.lat, lng: $0.lng,
                    branches: [OutingBranch(lat: $0.branch.lat, lng: $0.branch.lng, kind: .unknown)])
            })
    }
}

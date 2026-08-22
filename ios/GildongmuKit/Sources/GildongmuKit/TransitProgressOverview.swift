import Foundation

/// 대중교통 "진행 상황 조망" 순수 계층(E15-1, spec 2026-08-23 §3) — 웹
/// `src/lib/transit-progress-overview.ts`의 1:1 미러. 공유 fixture
/// (`transit-progress-overview-scenarios.json`)가 디스크립터 JSON 동조를 강제한다.
/// 문자열은 만들지 않는다 — i18n 렌더는 앱 어댑터(`TransitOverviewAdapter`)의 몫.
///
/// 불변식(설계 리뷰 2026-08-23): "지금 여기"는 **신선한 추적 관측**에서만 나온다 —
/// signal == tracking · 지하철 · 정규화 역명 유일 매칭. 소실·실패 중에 남아 있는
/// `currentLocation`은 마지막 관측값이라 표식하지 않는다(한 화면이 "위치를 모른다"와
/// "현재 위치는 X"를 동시에 주장하지 않게). 없는 표식은 거짓이 아니지만 있는 표식은
/// 거짓일 수 있다.

public enum TransitOverviewHere: Sendable, Equatable, Codable {
    case station(stopIndex: Int)
    case notApplicable(reason: NotApplicableReason)
    case unknown(reason: UnknownReason)

    public enum NotApplicableReason: String, Sendable, Codable { case phase, bus }
    public enum UnknownReason: String, Sendable, Codable {
        case noObservation, signalLost, upstreamFailed, ambiguous, arrivedUncertain
    }

    private enum CodingKeys: String, CodingKey { case kind, stopIndex, reason }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "station": self = .station(stopIndex: try c.decode(Int.self, forKey: .stopIndex))
        case "notApplicable": self = .notApplicable(reason: try c.decode(NotApplicableReason.self, forKey: .reason))
        case "unknown": self = .unknown(reason: try c.decode(UnknownReason.self, forKey: .reason))
        case let other:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown here kind \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .station(stopIndex):
            try c.encode("station", forKey: .kind)
            try c.encode(stopIndex, forKey: .stopIndex)
        case let .notApplicable(reason):
            try c.encode("notApplicable", forKey: .kind)
            try c.encode(reason, forKey: .reason)
        case let .unknown(reason):
            try c.encode("unknown", forKey: .kind)
            try c.encode(reason, forKey: .reason)
        }
    }
}

public enum TransitOverviewSilenceSignal: String, Sendable, Codable {
    case neverSeen, notYetVisible, signalLost, upstreamFailed
}

public enum TransitOverviewLegStatus: String, Sendable, Codable { case done, current, upcoming }
public enum TransitOverviewStopRole: String, Sendable, Codable { case board, via, alight }

public enum TransitOverviewRow: Sendable, Equatable, Codable {
    case walk(minutes: Int)
    case leg(legIndex: Int, mode: String, lineName: String, boardName: String, alightName: String,
             status: TransitOverviewLegStatus, stationCount: Int?)
    case stop(stopIndex: Int, name: String, role: TransitOverviewStopRole, here: Bool)
    /// 현재 구간 정차역 정보 없음 — 탑승 leg에 정차역 0개는 없으므로 빈 배열은 언제나 정보 없음.
    case stopsUnavailable
    case silence(signal: TransitOverviewSilenceSignal)

    private enum CodingKeys: String, CodingKey {
        case kind, minutes, legIndex, mode, lineName, boardName, alightName, status, stationCount
        case stopIndex, name, role, here, signal
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "walk": self = .walk(minutes: try c.decode(Int.self, forKey: .minutes))
        case "leg":
            self = .leg(
                legIndex: try c.decode(Int.self, forKey: .legIndex),
                mode: try c.decode(String.self, forKey: .mode),
                lineName: try c.decode(String.self, forKey: .lineName),
                boardName: try c.decode(String.self, forKey: .boardName),
                alightName: try c.decode(String.self, forKey: .alightName),
                status: try c.decode(TransitOverviewLegStatus.self, forKey: .status),
                stationCount: try c.decodeIfPresent(Int.self, forKey: .stationCount))
        case "stop":
            self = .stop(
                stopIndex: try c.decode(Int.self, forKey: .stopIndex),
                name: try c.decode(String.self, forKey: .name),
                role: try c.decode(TransitOverviewStopRole.self, forKey: .role),
                here: try c.decode(Bool.self, forKey: .here))
        case "stopsUnavailable": self = .stopsUnavailable
        case "silence": self = .silence(signal: try c.decode(TransitOverviewSilenceSignal.self, forKey: .signal))
        case let other:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown row kind \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .walk(minutes):
            try c.encode("walk", forKey: .kind)
            try c.encode(minutes, forKey: .minutes)
        case let .leg(legIndex, mode, lineName, boardName, alightName, status, stationCount):
            try c.encode("leg", forKey: .kind)
            try c.encode(legIndex, forKey: .legIndex)
            try c.encode(mode, forKey: .mode)
            try c.encode(lineName, forKey: .lineName)
            try c.encode(boardName, forKey: .boardName)
            try c.encode(alightName, forKey: .alightName)
            try c.encode(status, forKey: .status)
            // 웹 JSON은 null을 명시한다 — 생략하면 fixture 대조가 키 유무로 갈린다.
            try c.encode(stationCount, forKey: .stationCount)
        case let .stop(stopIndex, name, role, here):
            try c.encode("stop", forKey: .kind)
            try c.encode(stopIndex, forKey: .stopIndex)
            try c.encode(name, forKey: .name)
            try c.encode(role, forKey: .role)
            try c.encode(here, forKey: .here)
        case .stopsUnavailable:
            try c.encode("stopsUnavailable", forKey: .kind)
        case let .silence(signal):
            try c.encode("silence", forKey: .kind)
            try c.encode(signal, forKey: .signal)
        }
    }
}

public struct TransitOverviewOrdinal: Sendable, Equatable, Codable {
    public let n: Int
    public let count: Int
    public init(n: Int, count: Int) { self.n = n; self.count = count }
}

public struct TransitOverview: Sendable, Equatable, Codable {
    public let legOrdinal: TransitOverviewOrdinal
    public let rows: [TransitOverviewRow]
    public let here: TransitOverviewHere
    /// 침묵 탈출구(탑승 변경) 행 — riding ∧ 비-tagoBus ∧ 침묵 신호(시트 술어 + 침묵).
    public let reboardOffered: Bool
    public let alternativesOffered: Bool
}

/// silence 행·탈출구가 공유하는 신호 집합 — 같은 집합이라 탈출구는 언제나 silence 바로 뒤다.
public let transitOverviewSilenceSignals: Set<TransitSignal> = [
    .notYetVisible, .neverSeen, .signalLost, .upstreamFailed,
]

/// 정규화 역명 매칭이 정확히 1건일 때만 인덱스 — 동명 정차(순환·반복)는 모호(nil).
public func uniqueViaStopIndex(leg: TransitGuideLeg, currentLocation: String?) -> Int? {
    guard let currentLocation else { return nil }
    let target = normalizeStopName(currentLocation)
    guard !target.isEmpty else { return nil }
    let matches = leg.viaStops.indices.filter { normalizeStopName(leg.viaStops[$0].name) == target }
    return matches.count == 1 ? matches[0] : nil
}

public func transitOverviewHere(state: TransitGuideState, leg: TransitGuideLeg) -> TransitOverviewHere {
    switch state.phase {
    case .waiting, .boarding, .done:
        return .notApplicable(reason: .phase)
    case .arrived:
        return state.arrivedCertain ? .notApplicable(reason: .phase) : .unknown(reason: .arrivedUncertain)
    case .riding:
        break
    }
    guard leg.trackMode == .subway else { return .notApplicable(reason: .bus) }
    switch state.signal {
    case .signalLost: return .unknown(reason: .signalLost)
    case .upstreamFailed: return .unknown(reason: .upstreamFailed)
    case .tracking: break
    default: return .unknown(reason: .noObservation)
    }
    if let idx = uniqueViaStopIndex(leg: leg, currentLocation: state.currentLocation) {
        return .station(stopIndex: idx)
    }
    // 관측은 있는데 매칭이 0건(노선 밖 표기)이거나 2건 이상(동명)이다.
    let anyMatch: Bool = {
        guard let cur = state.currentLocation else { return false }
        let target = normalizeStopName(cur)
        return leg.viaStops.contains { normalizeStopName($0.name) == target }
    }()
    return .unknown(reason: anyMatch ? .ambiguous : .noObservation)
}

private func silenceSignal(_ state: TransitGuideState) -> TransitOverviewSilenceSignal? {
    guard state.phase == .riding, transitOverviewSilenceSignals.contains(state.signal) else { return nil }
    return TransitOverviewSilenceSignal(rawValue: state.signal.rawValue)
}

public func transitProgressOverview(state: TransitGuideState, route: TransitGuideRoute) -> TransitOverview {
    let count = route.legs.count
    let current = min(state.legIndex, max(count - 1, 0))
    let leg: TransitGuideLeg? = route.legs.indices.contains(current) ? route.legs[current] : nil
    let here: TransitOverviewHere = leg.map { transitOverviewHere(state: state, leg: $0) }
        ?? .notApplicable(reason: .phase)
    let silence = silenceSignal(state)
    var rows: [TransitOverviewRow] = []
    for (i, l) in route.legs.enumerated() {
        if let walk = l.walkBeforeMinutes, walk > 0 { rows.append(.walk(minutes: walk)) }
        let status: TransitOverviewLegStatus =
            (state.phase == .done || i < current) ? .done : (i == current ? .current : .upcoming)
        rows.append(.leg(
            legIndex: i, mode: l.mode, lineName: l.lineName, boardName: l.boardName,
            alightName: l.alightName, status: status, stationCount: l.stationCount))
        guard status == .current else { continue }
        if let silence { rows.append(.silence(signal: silence)) }
        if l.viaStops.isEmpty {
            rows.append(.stopsUnavailable)
            continue
        }
        for (si, s) in l.viaStops.enumerated() {
            let role: TransitOverviewStopRole = si == 0 ? .board : (si == l.viaStops.count - 1 ? .alight : .via)
            let isHere: Bool = if case let .station(idx) = here { idx == si } else { false }
            rows.append(.stop(stopIndex: si, name: s.name, role: role, here: isHere))
        }
    }
    if let walk = route.walkAfterMinutes, walk > 0 { rows.append(.walk(minutes: walk)) }
    let reboardOffered = state.phase == .riding
        && leg?.trackMode != nil && leg?.trackMode != .tagoBus
        && silence != nil
    return TransitOverview(
        legOrdinal: TransitOverviewOrdinal(n: current + 1, count: count),
        rows: rows, here: here, reboardOffered: reboardOffered,
        alternativesOffered: state.phase != .done)
}

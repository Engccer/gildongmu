import Foundation

/// 승차 중 현재역 — 실시간 열차 위치의 **표시 전용** 순수 계층(E35, spec
/// `2026-09-23-riding-current-station-design.md` §4). 웹 `src/lib/transit-riding-position.ts`의 1:1 미러이고
/// 공유 fixture(`transit-riding-position-cases.json`)가 동조를 강제한다.
///
/// ⚠ 이 상태는 승차 상태 머신(`TransitGuide.swift` 리듀서) **밖**에 있다. 리듀서는 이 파일을 모르고
/// (소스 가드 `transit-riding-position-guard.test.ts`), 도착·승격·하차·neverSeen 판정은 도착 API가 한다
/// (판정서 2026-08-23 §3). 위치는 화면·문장의 "현재 위치"만 채운다.
///
/// 불변식: 표식은 "있다"만 주장한다. 조인 실패·결측·조회 실패·동결은 모두 표식 부재로 나가고(새 문구 없음),
/// 사유는 계측 로그가 가른다.

/// 결박 하나(riding 진입 × 열차)당 위치 조회 상한의 하한 — 60초 주기로 30분. ⚠ 잠정값(실승차 판정).
public let transitPositionLookupCapMin = 30
/// 마지막 관측 뒤 표식을 유지하는 창 — riding 미관측 주기 60초 × 3. ⚠ 잠정값.
public let transitPositionHoldMs: Double = 180_000
/// 레코드 나이 상한(초) — 넘으면 동결 레코드라 관측으로 치지 않는다. ⚠ 잠정값.
public let transitPositionMaxAgeSeconds = 300
/// 래치보다 뒤 역이 이만큼 연속으로 오면 그 역에서 다시 시작한다 — 튄 값 하나가 구간을 잠그지 않게.
public let transitPositionBehindRestart = 2
/// 노선 목록이 0행(INFO-200 — 운행 밖·미제공)으로 이만큼 연속이면 이 결박에선 그만 묻는다.
public let transitPositionEmptyLineStop = 3

/// `/api/transit/position` 결과의 소비 형태. 429·5xx·네트워크 오류는 `failed`, 그 밖의 4xx는 `unsupported`.
public enum TransitPositionOutcome: Sendable, Equatable {
    case found(station: String, dataAgeSeconds: Int?)
    /// `lineEmpty`: 노선 목록 자체가 0행(INFO-200). 목록은 있는데 그 열차만 없으면 false.
    case notFound(lineEmpty: Bool)
    case unsupported
    case failed
}

/// 결박 — 이 riding 진입(`phaseGen`)·이 구간·이 열차의 관측만 유효하다. 요청 시점에 떠서 응답과 함께 넘긴다.
public struct TransitPositionBinding: Sendable, Equatable, Codable {
    public let legIndex: Int
    public let phaseGen: Int
    public let vehicleId: String

    public init(legIndex: Int, phaseGen: Int, vehicleId: String) {
        self.legIndex = legIndex
        self.phaseGen = phaseGen
        self.vehicleId = vehicleId
    }
}

public struct TransitRidingPosition: Sendable, Equatable, Codable {
    public var legIndex: Int
    public var phaseGen: Int
    public var vehicleId: String
    /// 단조 래치 — 열차는 뒤로 가지 않는다. 관측 전·보존 창 만료 뒤는 nil.
    public var stopIndex: Int?
    /// 마지막으로 래치를 확인·전진시킨 관측 시각(ms).
    public var lastFoundAt: Double?
    /// 결과를 받은 조회 수(실패는 세지 않는다 — 리듀서 `ridingPolls`와 같은 규칙).
    public var lookups: Int
    /// 래치보다 뒤 역 관측의 연속 횟수.
    public var behind: Int
    /// 노선 0행의 연속 횟수.
    public var emptyLine: Int
    /// 이 결박에선 다시 묻지 않는다(미지원·노선 0행 연속).
    public var stopped: Bool

    public init(binding: TransitPositionBinding) {
        legIndex = binding.legIndex
        phaseGen = binding.phaseGen
        vehicleId = binding.vehicleId
        stopIndex = nil
        lastFoundAt = nil
        lookups = 0
        behind = 0
        emptyLine = 0
        stopped = false
    }

    var binding: TransitPositionBinding {
        TransitPositionBinding(legIndex: legIndex, phaseGen: phaseGen, vehicleId: vehicleId)
    }
}

/// 지금 상태의 결박 — 식별 잠금(지하철·열차번호 있음)이 없으면 nil(위치 상태가 서지 않는다).
public func transitPositionBinding(of state: TransitGuideState) -> TransitPositionBinding? {
    guard let lock = state.lock, lock.mode == .subway, !isApproxTransitLock(lock) else { return nil }
    return TransitPositionBinding(legIndex: state.legIndex, phaseGen: state.phaseGen, vehicleId: lock.vehicleId)
}

private func isBound(_ position: TransitRidingPosition?, _ state: TransitGuideState) -> Bool {
    guard let position, let binding = transitPositionBinding(of: state) else { return false }
    return position.binding == binding
}

/// 도착 피드가 아직 열차를 못 본 riding 신호 — 위치가 새 정보를 주는 유일한 구간(spec §5 ①).
private func isPreTracking(_ state: TransitGuideState) -> Bool {
    state.phase == .riding && (state.signal == .notYetVisible || state.signal == .neverSeen)
}

/// 결박당 조회 상한 — 구간 소요에 비례한다(긴 구간에서 도착 피드가 잡히기 전에 끊기지 않게, E36 유휴 상한과 같은 모양).
public func transitPositionLookupCap(leg: TransitGuideLeg) -> Int {
    max(transitPositionLookupCapMin, 2 * max(0, leg.minutes ?? 0))
}

/// 켜는 조건(spec §5 ①). 폴 한 번에 최대 1회, 도착 조회·dispatch **뒤** 상태로 판정한다.
public func transitPositionLookupDue(
    state: TransitGuideState, leg: TransitGuideLeg, position: TransitRidingPosition?
) -> Bool {
    guard isPreTracking(state), leg.trackMode == .subway, transitPositionBinding(of: state) != nil else {
        return false
    }
    guard let position, isBound(position, state) else { return true }
    return !position.stopped && position.lookups < transitPositionLookupCap(leg: leg)
}

/// 조회 결과 한 건을 반영한다. `requested`는 **요청 시점**의 결박 — 지금 결박과 다르면 늦은 응답이라
/// 버린다(설계 리뷰 M1: 탑승 변경 뒤 옛 열차의 응답이 새 결박에 "새로 시작"으로 흡수되던 경로).
public func transitRidingPositionStep(
    _ prev: TransitRidingPosition?, state: TransitGuideState, leg: TransitGuideLeg,
    requested: TransitPositionBinding, outcome: TransitPositionOutcome, now: Double
) -> TransitRidingPosition? {
    guard let binding = transitPositionBinding(of: state) else { return nil }
    guard requested == binding else { return prev }
    var next: TransitRidingPosition
    if let prev, prev.binding == binding { next = prev } else { next = TransitRidingPosition(binding: binding) }
    // 보존 창이 지난 래치는 버린다(설계 리뷰 M2) — 표시되지 않는 래치가 뒤의 진짜 관측을 막지 않게.
    if let at = next.lastFoundAt, now - at > transitPositionHoldMs {
        next.stopIndex = nil
        next.lastFoundAt = nil
        next.behind = 0
    }
    switch outcome {
    case .failed:
        return next
    case .unsupported:
        next.lookups += 1
        next.stopped = true
        return next
    case let .notFound(lineEmpty):
        next.lookups += 1
        next.emptyLine = lineEmpty ? next.emptyLine + 1 : 0
        next.stopped = next.emptyLine >= transitPositionEmptyLineStop
        return next
    case let .found(station, dataAgeSeconds):
        next.lookups += 1
        next.emptyLine = 0
        guard let age = dataAgeSeconds, age <= transitPositionMaxAgeSeconds,
              let index = uniqueViaStopIndex(leg: leg, currentLocation: station)
        else { return next }
        if let latched = next.stopIndex, index < latched {
            next.behind += 1
            if next.behind < transitPositionBehindRestart { return next }
        }
        next.stopIndex = index
        next.lastFoundAt = now
        next.behind = 0
        return next
    }
}

/// 표식을 낼 수 있는 위치 index — 결박·riding·보존 창 안일 때만.
public func transitPositionShownIndex(
    state: TransitGuideState, position: TransitRidingPosition?, now: Double
) -> Int? {
    guard state.phase == .riding, let position, isBound(position, state),
          let index = position.stopIndex, let at = position.lastFoundAt
    else { return nil }
    return now - at <= transitPositionHoldMs ? index : nil
}

/// 도착 유래 index와 겨룰 위치 항. 보존 창 안이면 그 값. **인계 뒤**(도착 피드 추적 중)에는 도착 쪽이
/// 래치를 따라잡을 때까지 창과 무관하게 래치를 둔다(설계 리뷰 m1). 따라잡으면 큰 값이 도착 쪽이다.
private func positionTerm(
    state: TransitGuideState, position: TransitRidingPosition?, now: Double, arrival: Int?
) -> Int? {
    if let shown = transitPositionShownIndex(state: state, position: position, now: now) { return shown }
    if let arrival, state.phase == .riding, state.signal == .tracking,
       let position, isBound(position, state), let latched = position.stopIndex, arrival < latched {
        return latched
    }
    return nil
}

/// 경유역 목록 표식 — 도착 유래(`arvlMsg3`, 현행)와 위치 유래 중 **큰 값**. 인계 순간 도착 쪽이
/// 한 역 뒤일 수 있어(위치 피드가 전역 출발에서 먼저 바뀐다) 작은 값을 고르면 표식이 뒤로 튄다.
public func transitViaStopHereIndex(
    state: TransitGuideState, leg: TransitGuideLeg, position: TransitRidingPosition?, now: Double
) -> Int? {
    let arrival = viaStopCurrentIndex(leg: leg, currentLocation: state.currentLocation)
    let located = positionTerm(state: state, position: position, now: now, arrival: arrival)
    switch (arrival, located) {
    case let (a?, p?): return max(a, p)
    case let (a?, nil): return a
    case let (nil, p): return p
    }
}

/// 상태 문장이 신호 문장 대신 "현재 위치 {역}."을 말할 index(spec §6 판정 1). 도착 피드 미관측
/// 신호에서만 — 추적 중은 도착 조각이 이미 말하고, 소실·실패는 그 신호 문장이 정본이다.
public func transitPositionStatusIndex(
    state: TransitGuideState, position: TransitRidingPosition?, now: Double
) -> Int? {
    guard isPreTracking(state) else { return nil }
    return transitPositionShownIndex(state: state, position: position, now: now)
}

/// 조망 후처리(spec §4 ⑥) — `transitProgressOverview`와 그 fixture는 그대로 두고 결과에 얹는다.
/// silence 행·`reboardOffered`는 불변(탈출구를 지우지 않는다).
public func transitOverviewApplyingPosition(
    _ overview: TransitOverview, state: TransitGuideState, position: TransitRidingPosition?, now: Double
) -> TransitOverview {
    var here = overview.here
    switch overview.here {
    case let .station(stopIndex):
        if let located = positionTerm(state: state, position: position, now: now, arrival: stopIndex),
           located > stopIndex {
            here = .station(stopIndex: located)
        }
    case .unknown(reason: .noObservation):
        if let located = transitPositionStatusIndex(state: state, position: position, now: now) {
            here = .station(stopIndex: located)
        }
    default:
        break
    }
    guard here != overview.here else { return overview }
    let hereIndex: Int = if case let .station(idx) = here { idx } else { -1 }
    let rows = overview.rows.map { row -> TransitOverviewRow in
        if case let .stop(stopIndex, name, role, _) = row {
            return .stop(stopIndex: stopIndex, name: name, role: role, here: stopIndex == hereIndex)
        }
        return row
    }
    return TransitOverview(
        legOrdinal: overview.legOrdinal, rows: rows, here: here,
        reboardOffered: overview.reboardOffered, alternativesOffered: overview.alternativesOffered)
}

/// `neverSeen` 1회성 경고의 보류(spec §6 판정 2). 리듀서는 그 이벤트를 한 번만 낸다 — 그 순간 현재역이
/// 잡혀 있으면 오케스트레이터가 경고를 내지 않고 결박째 보류한다.
public func transitNeverSeenWarningDeferred(
    state: TransitGuideState, position: TransitRidingPosition?, now: Double
) -> TransitPositionBinding? {
    guard state.signal == .neverSeen,
          transitPositionStatusIndex(state: state, position: position, now: now) != nil
    else { return nil }
    return transitPositionBinding(of: state)
}

public enum TransitNeverSeenPendingVerdict: String, Sendable {
    case fire, keep, drop
}

/// 보류한 경고의 처분 — 폴마다 본다. 결박이 바뀌었거나(탑승 변경·다음 구간·선언 도착·새 riding 진입)
/// 신호가 `neverSeen`이 아니게 됐으면(추적 시작·소실·실패) **버린다**. 현재역이 사라졌으면(보존 창
/// 경과·조회 상한) 그때 **낸다**. 그 밖은 계속 보류.
public func transitNeverSeenPendingStep(
    _ pending: TransitPositionBinding, state: TransitGuideState, position: TransitRidingPosition?, now: Double
) -> TransitNeverSeenPendingVerdict {
    guard state.phase == .riding, state.signal == .neverSeen,
          transitPositionBinding(of: state) == pending
    else { return .drop }
    return transitPositionStatusIndex(state: state, position: position, now: now) == nil ? .fire : .keep
}

/// "주변 확인" 앵커의 위치 반영판 — 규칙은 `transitSurroundingsAnchor`와 같고(조망 `here`가 역으로
/// 확정됐을 때만 현재역, 그 밖은 하차역) 후처리된 조망의 `here`를 받는다. 기존 함수는 안드로이드
/// 이식본과 짝이라 그대로 둔다.
public func transitSurroundingsAnchor(here: TransitOverviewHere, leg: TransitGuideLeg) -> TransitSurroundingsAnchor? {
    if case let .station(idx) = here, leg.viaStops.indices.contains(idx) {
        return .currentStation(leg.viaStops[idx])
    }
    guard let alight = leg.alightStop else { return nil }
    return .alightStop(alight)
}

// MARK: - 조회 서비스

/// `/api/transit/position` 판별 union(spec §3.2). 502는 APIClient가 throw(호출자가 `.failed`로 소비).
public struct TransitPositionEnvelope: Codable, Sendable {
    public let status: String
    public let station: String?
    public let trainStatus: String?
    public let dataStamp: String?
    public let dataAgeSeconds: Int?
    public let total: Int?
}

public struct TransitPositionService: Sendable {
    let client: APIClient

    public init(client: APIClient) { self.client = client }

    /// `line`은 leg의 ODsay 노선명(`수도권 5호선`), `train`은 잠금 열차번호(`lock.vehicleId`).
    public func lookup(line: String, train: String) async throws -> TransitPositionEnvelope {
        try await client.get("/api/transit/position", query: [
            URLQueryItem(name: "line", value: line),
            URLQueryItem(name: "train", value: train),
        ])
    }

    /// 응답 → 소비 형태. 알 수 없는 status는 판정 불가라 `failed`(표식을 만들지 않는다).
    public static func outcome(from envelope: TransitPositionEnvelope) -> TransitPositionOutcome {
        switch envelope.status {
        case "found":
            guard let station = envelope.station, !station.isEmpty else { return .failed }
            return .found(station: station, dataAgeSeconds: envelope.dataAgeSeconds)
        case "notFound": return .notFound(lineEmpty: envelope.total == 0)
        case "unsupported": return .unsupported
        default: return .failed
        }
    }

    /// 200이 아닌 응답의 분류(설계 리뷰 m4, 웹 `positionOutcomeFromHttpStatus` 미러). 429·5xx·네트워크는
    /// 일시적이라 `failed`, 그 밖의 4xx는 이 결박에서 다시 물어도 같은 답이라 `unsupported`.
    public static func outcome(from error: any Error) -> TransitPositionOutcome {
        if case let APIError.badStatus(code, _) = error, (400..<500).contains(code), code != 429 {
            return .unsupported
        }
        return .failed
    }
}

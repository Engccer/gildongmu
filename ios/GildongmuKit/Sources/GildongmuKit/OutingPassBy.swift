import Foundation

// ── 나들이 지나침 판정·도로명 변경(spec 2026-09-26 §6.3) ──
// "무엇 옆을 지나는가"를 한 번씩 말하는 판정. 지나침은 한 장소에 한 번뿐이라 틀린 발화를
// 다음 fix가 바로잡아 주지 않는다 — 그래서 판정 재료가 흔들리는 fix(방위 상실·회전·반전)는
// 판정하지 않고 관계만 갱신한다.

/// ⚠ 잠정값(spec §10). 지나침 낭독 횡거리 상한(m).
public let outingPassByLateralMeters = 40.0
/// 직전 판정 fix 대비 이만큼 넘게 방위가 바뀐 fix는 판정하지 않는다(도). 모퉁이·되돌아섬에서
/// 앞의 장소가 한꺼번에 옆·뒤로 넘어가는 거짓 지나침을 막는다.
public let outingPassByMaxTurnDegrees = 45.0

/// 지나침 후보 하나 — 장소 id와 직전·현재 관계.
public struct OutingPassByCandidate: Sendable, Equatable {
    public let id: String
    public let previous: OutingRelation?
    public let current: OutingRelation

    public init(id: String, previous: OutingRelation?, current: OutingRelation) {
        self.id = id
        self.previous = previous
        self.current = current
    }
}

public struct OutingPassByResult: Sendable, Equatable {
    /// 이 fix에서 말할 장소(가장 가까운 하나). 없으면 nil.
    public let spoken: String?
    /// 말할 자격은 있었지만 말하지 않은 장소 — `spoken` 집합에 함께 넣어 다음 fix에 다시 후보가 되지 않게 한다.
    public let silenced: [String]
}

private func turnDegrees(_ a: Double, _ b: Double) -> Double {
    abs((a - b + 540).truncatingRemainder(dividingBy: 360) - 180)
}

/// 이 fix의 지나침. 후보는 호출부가 낭독 단계(§7.2)로 이미 거른 목록이다.
public func outingPassByStep(
    candidates: [OutingPassByCandidate], spoken: Set<String>
) -> OutingPassByResult {
    let eligible = candidates.filter { c in
        guard !spoken.contains(c.id),
              let prev = c.previous,
              let prevBearing = prev.validBearing,
              let curBearing = c.current.validBearing,
              turnDegrees(prevBearing, curBearing) <= outingPassByMaxTurnDegrees
        else { return false }
        return prev.zone == .ahead && c.current.zone != .ahead
            && abs(c.current.t) <= outingPassByLateralMeters
    }
    guard let nearest = eligible.min(by: { $0.current.d < $1.current.d }) else {
        return OutingPassByResult(spoken: nil, silenced: [])
    }
    return OutingPassByResult(
        spoken: nearest.id, silenced: eligible.map(\.id).filter { $0 != nearest.id })
}

// MARK: - 도로명 변경

/// 역지오코딩 주소 문자열에서 도로명 토큰을 뽑는다. 토큰이 없으면(지번 폴백 등) nil.
/// ko는 `…대로`·`…로`·`…길` 뒤 건물번호, en은 `…-daero`·`…-ro`·`…-gil`.
public func outingRoadName(fromAddress address: String) -> String? {
    if let m = address.firstMatch(of: /([가-힣0-9]+(?:대로|로|길)) ?[0-9]/) {
        return String(m.1)
    }
    // en은 "Yangjae-daero 123-gil"처럼 번호 길이 뒤에 붙는다 — 한 토큰으로 묶어야 ko(`양재대로123길`)와 같은 도로가 된다.
    if let m = address.firstMatch(of: /([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-(?:daero|ro|gil)(?: [0-9]+(?:beon)?-gil)?)(?![A-Za-z0-9-])/.ignoresCase()) {
        return String(m.1)
    }
    return nil
}

public struct OutingRoadState: Sendable, Equatable {
    /// 확정된 현재 도로명.
    public var confirmed: String?
    /// 확정과 다른 값을 한 번 본 것(두 번째에 확정한다).
    public var pending: String?

    public init(confirmed: String? = nil, pending: String? = nil) {
        self.confirmed = confirmed
        self.pending = pending
    }
}

/// 역지오코딩 결과 하나를 반영한다. `announce`는 말할 도로명(확정이 바뀐 순간 한 번).
/// 세션 첫 확정은 말하지 않고(출발점 문장이 그 자리다), 이후 변경은 같은 값이 두 번 연속 와야
/// 확정한다(도로명·지번 사이 왕복 방지). 토큰이 없는 응답은 상태를 바꾸지 않는다.
public func outingRoadNameStep(
    _ state: OutingRoadState, observed: String?
) -> (state: OutingRoadState, announce: String?) {
    guard let observed else { return (state, nil) }
    guard let confirmed = state.confirmed else {
        return (OutingRoadState(confirmed: observed, pending: nil), nil)
    }
    if observed == confirmed { return (OutingRoadState(confirmed: confirmed, pending: nil), nil) }
    if state.pending == observed { return (OutingRoadState(confirmed: observed, pending: nil), observed) }
    return (OutingRoadState(confirmed: confirmed, pending: observed), nil)
}

// MARK: - 횡단보도 예고

/// ⚠ 잠정값(spec §10). 횡단보도 예고 종방향 거리(m) — 앞으로 이만큼 안에 들어오면 한 번 말한다.
public let outingCrosswalkNoticeMeters = 30.0
/// 예고 횡거리 상한(m). 옆 골목 횡단보도를 "앞에"로 말하지 않는다(리뷰 M11).
public let outingCrosswalkLateralMeters = 15.0
/// 횡단보도 노드와 음향신호기 격자 대표점의 짝짓기 거리(m) — 격자 11m + GPS 여유.
public let outingAudioSignalPairMeters = 20.0

/// 횡단보도 하나 — OSM 노드 id·좌표.
public struct OutingCrosswalk: Sendable, Equatable {
    public let id: String
    public let lat: Double
    public let lng: Double

    public init(id: String, lat: Double, lng: Double) {
        self.id = id
        self.lat = lat
        self.lng = lng
    }
}

public struct OutingCrosswalkNotice: Sendable, Equatable {
    public let id: String
    /// 음향신호기가 짝지어졌는가. false는 "없다"가 아니라 "확인되지 않았다"라 문장에 아무것도 붙이지 않는다.
    public let hasAudioSignal: Bool
}

/// 이 fix에서 예고할 횡단보도(가장 가까운 하나). 안전 정보는 지나친 뒤가 아니라 앞에서 들어야 해서
/// 조건이 지나침과 다르다: 방위 valid에서 앞 구획 ∧ s ≤ 30 ∧ |t| ≤ 15, 아직 예고하지 않은 id.
public func outingCrosswalkNoticeStep(
    crosswalks: [(crosswalk: OutingCrosswalk, relation: OutingRelation)],
    audioSignals: [RoutePoint],
    spoken: Set<String>
) -> OutingCrosswalkNotice? {
    let eligible = crosswalks.filter { c in
        !spoken.contains(c.crosswalk.id) && c.relation.validBearing != nil
            && c.relation.zone == .ahead && c.relation.s <= outingCrosswalkNoticeMeters
            && abs(c.relation.t) <= outingCrosswalkLateralMeters
    }
    guard let nearest = eligible.min(by: { $0.relation.s < $1.relation.s }) else { return nil }
    let paired = audioSignals.contains {
        haversineMeters(lat1: $0.lat, lng1: $0.lng, lat2: nearest.crosswalk.lat, lng2: nearest.crosswalk.lng)
            <= outingAudioSignalPairMeters
    }
    return OutingCrosswalkNotice(id: nearest.crosswalk.id, hasAudioSignal: paired)
}

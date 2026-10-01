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

/// ⚠ 잠정값(spec §10). 새 도로명을 한 번 본 자리에서 이만큼 이상 걷는 동안 토큰 없는 응답(지번 폴백)만 왔으면 그 도로명을
/// 확정한다. 큰길을 따라 걸어도 역지오코딩이 지번으로만 떨어지는 구간이 있어(2026-09-29·10-01 천중로) "같은 값 두 번"만으로는
/// 확정이 영영 서지 않는다 — 지번은 반대 증거가 아니라 증거 없음이다. 재조회 간격(`outingRequeryDistanceMeters` 50m)의
/// 두 배라 지번 응답 하나로는 확정하지 않는다(모퉁이에서 한 번 튄 교차 도로명을 다음 재조회가 반박할 기회를 남긴다).
/// 조회 실패는 이 판정에 들어오지 않는다(호출부가 응답이 있을 때만 부른다).
public let outingRoadConfirmMeters = 100.0

public struct OutingRoadState: Sendable, Equatable {
    /// 확정된 현재 도로명.
    public var confirmed: String?
    /// 확정과 다른 값을 한 번 본 것(같은 값을 한 번 더 보거나, 지번 응답만 오는 동안 `outingRoadConfirmMeters`를 걸으면 확정한다).
    public var pending: String?
    /// `pending`을 처음 본 조회 좌표.
    public var pendingAt: RoutePoint?

    public init(confirmed: String? = nil, pending: String? = nil, pendingAt: RoutePoint? = nil) {
        self.confirmed = confirmed
        self.pending = pending
        self.pendingAt = pendingAt
    }
}

/// 역지오코딩 결과 하나를 반영한다(`at` = 그 조회 좌표). `announce`는 말할 도로명(확정이 바뀐 순간 한 번).
/// 세션 첫 확정은 말하지 않고(출발점 문장이 그 자리다), 이후 변경은 같은 값이 두 번 연속 오거나 그 값을 본 자리에서
/// `outingRoadConfirmMeters` 이상 걷는 동안 토큰 없는 응답만 왔을 때 확정한다. 확정 도로명이 다시 오면 보류를 버린다
/// (모퉁이에서 한 번 튄 교차 도로명을 말하지 않는다). 토큰 없는 응답은 그 거리 판정 말고는 상태를 바꾸지 않는다.
public func outingRoadNameStep(
    _ state: OutingRoadState, observed: String?, at: RoutePoint
) -> (state: OutingRoadState, announce: String?) {
    guard let observed else {
        guard let pending = state.pending, let from = state.pendingAt,
              haversineMeters(lat1: from.lat, lng1: from.lng, lat2: at.lat, lng2: at.lng) >= outingRoadConfirmMeters
        else { return (state, nil) }
        return (OutingRoadState(confirmed: pending), pending)
    }
    guard let confirmed = state.confirmed else {
        return (OutingRoadState(confirmed: observed), nil)
    }
    if observed == confirmed { return (OutingRoadState(confirmed: confirmed), nil) }
    if state.pending == observed { return (OutingRoadState(confirmed: observed), observed) }
    return (OutingRoadState(confirmed: confirmed, pending: observed, pendingAt: at), nil)
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

// MARK: - 교차로 예고 (spec §6.6, E58 ①)

/// ⚠ 잠정값(spec §10). 교차로 예고 종방향 거리(m) — 앞으로 이만큼 안에 들어오면 한 번 말한다.
public let outingJunctionNoticeMeters = 20.0
/// ⚠ 잠정값(spec §10). 교차로 예고 횡거리 상한(m). 차도 중심선의 교차점이 보도에서 떨어진 거리까지만 —
/// 그보다 먼 큰 교차로는 횡단보도 예고가 맡는다.
public let outingJunctionLateralMeters = 12.0
/// ⚠ 잠정값(spec §10, §11.2 재생). 교차로 예고 사이 최소 간격(초) — 골목 밀집 구간의 연속 발화 상한.
/// 횡단보도 예고도 이 시계를 돌린다(같은 자리 두 문장 억제, 설계 리뷰 m2).
public let outingJunctionMinGapSeconds = 8.0
/// 앞·뒤 갈래와 옆 갈래를 가르는 각(도). 진행 방향에서 이보다 덜 벌어지면 앞(또는 뒤)이다.
public let outingBranchSideDegrees = 45.0
/// 앞 갈래 둘을 Y자 갈림길로 보는 최소 벌어짐(도). 큰길과 평행한 측면도로처럼 거의 같은 방향인 둘은 갈림길이 아니다.
public let outingForkMinSpreadDegrees = 20.0
/// ⚠ 잠정값(spec §10). 사용자가 교차점에서 이만큼 넘게(그리고 좌우 여유 밖으로) 옆에 있으면 차도 중심선 한쪽의 보도에
/// 있다고 보고, 교차점 너머(길 건너)로 뻗은 갈래는 말하지 않는다(설계 리뷰 M2 — "왼쪽에 골목"은 "왼쪽으로 꺾을 수 있다"로 들린다).
public let outingJunctionFarSideMeters = 6.0

/// 교차로 문장의 모양. 좌우는 `OutingSide`에서만 온다(`.side`의 값은 `.left`·`.right`뿐 — 호출부는 그래도
/// `switch side`로 받아 `.unknown`을 갈림길 문장으로 접는다, spec §6.1 소스 가드).
public enum OutingJunctionShape: Sendable, Equatable {
    /// 한쪽에만 옆 갈래 — 그쪽 갈래에 골목이 하나라도 있으면 `alley`.
    case side(OutingSide, alley: Bool)
    /// 양쪽에 옆 갈래, 앞으로도 이어진다.
    case cross
    /// 양쪽에 옆 갈래, 앞이 끊긴다.
    case tee
    /// 갈림길은 있는데 좌우를 확정하지 못했다(또는 앞으로 갈라지는 Y자).
    case branching
}

public struct OutingJunctionNotice: Sendable, Equatable {
    public let id: String
    public let shape: OutingJunctionShape
}

/// 교차점 하나의 모양(순수).
/// - `junction`: 사용자 fix에서 교차점으로의 `outingProject` 관계(구획·횡거리·길 건너 판정).
/// - `branches`: **교차점을 기준점으로**(정확도 0) 갈래 점을 `outingProject`한 관계(`outingJunctionRelations`). 갈래 방향은
///   지도 점끼리의 기하라 사용자 GPS 오차와 무관하다 — 여유는 방위 불확실성(25m·sin U)만 남는다(설계 리뷰 M1).
/// 갈래의 각 φ = atan2(t, s)로 앞(|φ| < 45°)·뒤(> 135°)·옆을 가르고, 옆 갈래의 좌우는 그 관계의 `OutingSide`다(여유 안이면
/// 미확정 → 갈림길). 사용자가 교차점 한쪽에 분명히 있으면(`junction.side` 확정 ∧ |t| > 6m) 그쪽으로 뻗은 갈래는 길 건너라 뺀다.
/// 옆 갈래가 없고 앞 갈래가 Y자(20도 이상 벌어진 둘 이상)가 아니면 nil(곧은 길의 이음점).
public func outingJunctionShape(
    junction: OutingRelation, branches: [(kind: OutingBranchKind, relation: OutingRelation)]
) -> OutingJunctionShape? {
    guard junction.validBearing != nil else { return nil }
    let farSide: OutingSide? = junction.side != .unknown && abs(junction.t) > outingJunctionFarSideMeters ? junction.side : nil
    var leftKinds: [OutingBranchKind] = []
    var rightKinds: [OutingBranchKind] = []
    var unsure = false
    var forward: [Double] = []
    for b in branches {
        guard b.relation.validBearing != nil else { unsure = true; continue }
        guard hypot(b.relation.s, b.relation.t) >= 3 else { continue }
        let phi = atan2(b.relation.t, b.relation.s) * 180 / .pi
        if abs(phi) < outingBranchSideDegrees {
            forward.append(phi)
        } else if abs(phi) <= 180 - outingBranchSideDegrees {
            switch b.relation.side {
            case .unknown: unsure = true
            case let side where side == farSide: continue
            case .left: leftKinds.append(b.kind)
            case .right: rightKinds.append(b.kind)
            }
        }
    }
    if unsure { return .branching }
    switch (leftKinds.isEmpty, rightKinds.isEmpty) {
    case (false, false): return forward.isEmpty ? .tee : .cross
    case (false, true): return .side(.left, alley: leftKinds.contains(.alley))
    case (true, false): return .side(.right, alley: rightKinds.contains(.alley))
    case (true, true):
        guard let lo = forward.min(), let hi = forward.max(), hi - lo >= outingForkMinSpreadDegrees else { return nil }
        return .branching
    }
}

/// 이 fix에서 예고할 교차로(가장 가까운 하나). 조건: 방위 valid에서 앞 구획 ∧ s ≤ 20 ∧ |t| ≤ 12, 아직 예고하지
/// 않은 id, 모양이 있음(곧은 길의 이음점이 아님), 직전 예고(`lastNoticeAt` — 교차로·횡단보도)에서
/// `outingJunctionMinGapSeconds` 지남. 간격 안이면 아무것도 침묵시키지 않는다 — 후보는 창이 끝날 때 아직 앞 20m 안이면
/// 그때 말해진다.
public func outingJunctionNoticeStep(
    junctions: [(junction: OutingJunction, relation: OutingRelation, branches: [OutingRelation])],
    spoken: Set<String>,
    lastNoticeAt: Double?,
    now: Double
) -> OutingJunctionNotice? {
    if let lastNoticeAt, now - lastNoticeAt < outingJunctionMinGapSeconds { return nil }
    let eligible = junctions.compactMap { c -> (OutingJunctionNotice, Double)? in
        guard !spoken.contains(c.junction.id), c.relation.validBearing != nil, c.relation.zone == .ahead,
              c.relation.s <= outingJunctionNoticeMeters, abs(c.relation.t) <= outingJunctionLateralMeters,
              c.branches.count == c.junction.branches.count
        else { return nil }
        let pairs = zip(c.junction.branches, c.branches).map { (kind: $0.kind, relation: $1) }
        guard let shape = outingJunctionShape(junction: c.relation, branches: pairs) else { return nil }
        return (OutingJunctionNotice(id: c.junction.id, shape: shape), c.relation.s)
    }
    return eligible.min { $0.1 < $1.1 }?.0
}

/// 한 fix의 교차로 후보 관계. 투영은 `outingProject` 하나다 — 교차점은 사용자 fix 기준(그 fix의 정확도),
/// 갈래 점은 교차점 기준(지도 점이라 정확도 0, 같은 방위).
public func outingJunctionRelations(
    _ junctions: [OutingJunction], fixLat: Double, fixLng: Double, accuracy: Double, heading: OutingHeading
) -> [(junction: OutingJunction, relation: OutingRelation, branches: [OutingRelation])] {
    junctions.map { j in
        (junction: j,
         relation: outingProject(
            fixLat: fixLat, fixLng: fixLng, accuracy: accuracy, heading: heading, placeLat: j.lat, placeLng: j.lng),
         branches: j.branches.map {
            outingProject(fixLat: j.lat, fixLng: j.lng, accuracy: 0, heading: heading, placeLat: $0.lat, placeLng: $0.lng)
         })
    }
}

/// 같은 진행선 위에서 함께 침묵시킬 횡단보도 거리(m) — 넓은 도로에서 탐침의 연석점과 OSM·서울망의 중심점이 15m를 넘어
/// 따로 남는 짝(설계 리뷰 M4)을 한 번만 말하게 한다.
public let outingCrosswalkSilenceMeters = 35.0

/// 예고한 횡단보도와 함께 `spoken`에 넣을 id(그 점에서 35m 안 ∧ 이 fix의 |t| ≤ 15 — 같은 진행선 위). 모퉁이의 직교
/// 횡단보도는 |t|가 커서 남는다. `outingCrosswalkNoticeStep`의 판정은 그대로다(판정 ②, 원천만 바꾼다).
public func outingCrosswalkSilenced(
    after noticeId: String, crosswalks: [(crosswalk: OutingCrosswalk, relation: OutingRelation)]
) -> [String] {
    guard let spoken = crosswalks.first(where: { $0.crosswalk.id == noticeId })?.crosswalk else { return [] }
    return crosswalks.compactMap { c in
        guard c.crosswalk.id != noticeId, c.relation.validBearing != nil,
              abs(c.relation.t) <= outingCrosswalkLateralMeters,
              haversineMeters(lat1: spoken.lat, lng1: spoken.lng, lat2: c.crosswalk.lat, lng2: c.crosswalk.lng)
                <= outingCrosswalkSilenceMeters
        else { return nil }
        return c.crosswalk.id
    }
}

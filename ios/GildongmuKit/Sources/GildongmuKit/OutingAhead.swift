import Foundation

// ── 나들이 앞 상황 두 줄(E82 위원장 판정 2026-11-16 4번) ──
// 시트의 방향 행 자리를 두 줄로 나눈다. 윗줄은 다음 이정표와 거리(도보·자동차 안내 화면이 남은 거리를 따로 두는 것과 같은
// 구조), 아랫줄은 앞 30m 안 길가(옆으로 20m 안)의 가까운 두세 곳(가게·횡단보도·갈림길을 가리지 않는다).
//
// ⚠ **「앞」은 진행 방향을 알 때만 말한다**(E82 첫 판 판정 3). 방위가 valid가 아니면(정지·주머니·세션 초반) 두 줄 어느
// 쪽도 앞을 판정하지 않는다 — 고르기(`outingAheadPick`)가 nil이다.
//
// ⚠ **3-state**: 아랫줄의 「없음」(`empty`)은 주변 목록을 받아 둔(`ready`) 때만이다. 아직 받지 못했거나(확인 중) 받지
// 못하고 있으면(실패·지역 밖) 그 상태를 말한다. 윗줄도 같다 — 준비되지 않은 목록으로 「앞에 이정표 없음」을 단정하지 않는다.
// 찾은 것이 있으면 상태와 무관하게 보인다(받아 둔 장소는 움직이지 않는다, `OutingSurroundingsStatus.failed`).
//
// 좌우는 `OutingSide`에서만 온다(장소 관계·교차로 모양). 거리 표기는 호출부가 `formatDistance`로 한다.

/// 다음 이정표의 앞 구역 횡폭(m) — |t|가 이 값 이하인 것만 「앞에」로 말한다. 옆 골목·다른 골목의 건물을 거른다.
public let outingNextLandmarkLateralMeters = 25.0
/// 다음 이정표의 거리 상한(m, 직선거리). 이보다 멀면 방위 오차(10°면 150m에서 횡 26m)가 앞 구역 폭을 넘어선다.
public let outingNextLandmarkMaxMeters = 150.0
/// 아랫줄 앞 구역의 종방향 거리(m) — 0 < s ≤ 이 값.
public let outingNearAheadMeters = 30.0
/// 아랫줄 앞 구역의 횡폭(m) — |t| ≤ 이 값.
public let outingNearAheadLateralMeters = 20.0
/// 아랫줄에 싣는 최대 개수(위원장 판정 「가까운 두세 곳」).
public let outingNearAheadMaxItems = 3

/// 윗줄의 다음 이정표 — 장소 id와 10m 양자화 거리.
public struct OutingNextLandmark: Sendable, Equatable {
    public let id: String
    public let meters: Int

    public init(id: String, meters: Int) {
        self.id = id
        self.meters = meters
    }
}

/// 아랫줄의 한 곳.
public enum OutingNearItem: Sendable, Equatable {
    /// 가게·이정표 구분 없이 장소 하나. 좌우를 모르면 `.unknown`(이름만 말한다).
    case place(id: String, side: OutingSide)
    /// 횡단보도(같은 줄에 둘 이상이어도 한 번만 — 거리 없이 같은 낱말을 되풀이하지 않는다).
    case crosswalk
    /// 교차로 모양(`outingJunctionShape`).
    case junction(OutingJunctionShape)
}

/// 방위가 valid인 fix 하나에서 고른 앞 상황.
public struct OutingAheadPick: Sendable, Equatable {
    public let next: OutingNextLandmark?
    public let near: [OutingNearItem]

    public init(next: OutingNextLandmark?, near: [OutingNearItem]) {
        self.next = next
        self.near = near
    }
}

/// 다음 이정표: 이정표 등급 ∧ 앞 구획(s > 옆 대역) ∧ |t| ≤ 25 ∧ d ≤ 150 중 진행축으로 가장 먼저 닿는(s 최소) 곳.
public func outingNextLandmark(
    _ places: [(id: String, tier: OutingLandmarkTier, relation: OutingRelation)]
) -> OutingNextLandmark? {
    let eligible = places.filter { p in
        p.tier == .landmark && p.relation.validBearing != nil && p.relation.zone == .ahead
            && abs(p.relation.t) <= outingNextLandmarkLateralMeters && p.relation.d <= outingNextLandmarkMaxMeters
    }
    let first = eligible.min { a, b in
        a.relation.s != b.relation.s ? a.relation.s < b.relation.s : a.id < b.id
    }
    return first.map { OutingNextLandmark(id: $0.id, meters: outingQuantizedMeters($0.relation.d)) }
}

/// 아랫줄 앞 구역 안인가(0 < s ≤ 30 ∧ |t| ≤ 20, 방위 valid).
func outingIsNearAhead(_ r: OutingRelation) -> Bool {
    r.validBearing != nil && r.s > 0 && r.s <= outingNearAheadMeters && abs(r.t) <= outingNearAheadLateralMeters
}

/// 아랫줄 교차로 후보: 앞 구역 안의 교차점만 갈래를 투영해 모양을 정한다(`outingJunctionRelations`와 같은 투영 규칙 —
/// 교차점은 사용자 fix 기준, 갈래 점은 교차점 기준·정확도 0). 곧은 길의 이음점(모양 없음)은 뺀다.
public func outingNearJunctions(
    _ junctions: [OutingJunction], fixLat: Double, fixLng: Double, accuracy: Double, heading: OutingHeading
) -> [(relation: OutingRelation, shape: OutingJunctionShape)] {
    junctions.compactMap { j in
        let rel = outingProject(
            fixLat: fixLat, fixLng: fixLng, accuracy: accuracy, heading: heading, placeLat: j.lat, placeLng: j.lng)
        guard outingIsNearAhead(rel) else { return nil }
        let branches = j.branches.map { b in
            (kind: b.kind, relation: outingProject(
                fixLat: j.lat, fixLng: j.lng, accuracy: 0, heading: heading, placeLat: b.lat, placeLng: b.lng))
        }
        guard let shape = outingJunctionShape(junction: rel, branches: branches) else { return nil }
        return (relation: rel, shape: shape)
    }
}

/// 아랫줄: 앞 구역 안의 장소·횡단보도·교차로를 진행축 순서(s 오름차순)로 최대 세 곳. 같은 항목(횡단보도, 같은 모양의
/// 교차로)은 한 번만 싣는다 — 거리를 말하지 않는 줄에서 같은 낱말이 되풀이되면 정보가 없다.
public func outingNearAhead(
    places: [(id: String, relation: OutingRelation)],
    crosswalks: [OutingRelation],
    junctions: [(relation: OutingRelation, shape: OutingJunctionShape)]
) -> [OutingNearItem] {
    var all: [(s: Double, order: Int, key: String, item: OutingNearItem)] = []
    for p in places where outingIsNearAhead(p.relation) {
        all.append((p.relation.s, 2, p.id, .place(id: p.id, side: p.relation.side)))
    }
    for c in crosswalks where outingIsNearAhead(c) {
        all.append((c.s, 0, "", .crosswalk))
    }
    for j in junctions where outingIsNearAhead(j.relation) {
        all.append((j.relation.s, 1, "", .junction(j.shape)))
    }
    all.sort { a, b in
        if a.s != b.s { return a.s < b.s }
        if a.order != b.order { return a.order < b.order }
        return a.key < b.key
    }
    var out: [OutingNearItem] = []
    for entry in all where !out.contains(entry.item) {
        out.append(entry.item)
        if out.count == outingNearAheadMaxItems { break }
    }
    return out
}

/// 한 fix의 앞 상황. 방위가 valid가 아니면 nil(「앞」을 판정하지 않는다).
public func outingAheadPick(
    heading: OutingHeading,
    places: [(id: String, tier: OutingLandmarkTier, relation: OutingRelation)],
    crosswalks: [OutingRelation],
    junctions: [(relation: OutingRelation, shape: OutingJunctionShape)]
) -> OutingAheadPick? {
    guard case .valid = heading else { return nil }
    return OutingAheadPick(
        next: outingNextLandmark(places),
        near: outingNearAhead(
            places: places.map { (id: $0.id, relation: $0.relation) }, crosswalks: crosswalks, junctions: junctions))
}

/// 윗줄의 상태.
public enum OutingAheadUpper: Sendable, Equatable {
    /// 앞을 말하지 않는다 — 진행 방위 문구만(방위 모름·마지막 진행 방향, 또는 준비되지 않은 목록에서 찾은 것 없음).
    case headingOnly
    /// 걷던 중 위치가 끊겨 앞을 내렸다(`outingAheadLocationLost`) — 「마지막 진행 방향 {방위}」. 쥔 방위는 아직 valid라
    /// 방위 문구(`headingOnly`)로 두면 「{방위}으로 이동 중」이 선다(E82 위원장 판정 2026-11-17).
    case lastHeading
    /// 다음 이정표와 거리.
    case landmark(OutingNextLandmark)
    /// 받아 둔 목록에서 앞 구역에 이정표가 없다.
    case noLandmark
}

/// 아랫줄의 상태.
public enum OutingAheadLower: Sendable, Equatable {
    /// 진행 방향을 몰라 앞을 판정하지 않는다(목록은 받아 둠).
    case noHeading
    /// 걷던 중 위치가 끊겨 앞을 판정하지 않는다(`outingAheadLocationLost`) — 「위치 확인 중」. 걷고 있는 사람에게 이동을
    /// 청하는 `noHeading` 문장을 세우지 않는다(E82 위원장 판정 2026-11-17).
    case locating
    /// 앞 구역의 한 곳 이상.
    case items([OutingNearItem])
    /// 받아 둔 목록에서 앞 구역이 비었다.
    case empty
    /// 주변 목록이 준비되지 않았다(확인 중·실패·지역 밖) — 「없음」으로 단정하지 않는다.
    case surroundings(OutingSurroundingsStatus)
}

/// `pick`은 이번 fix의 `outingAheadPick` 결과(방위가 valid가 아니면 nil)다. 방위·상태는 그리는 순간의 값. `locationLost`는 앞을
/// 내린 사유가 위치 끊김인가(`outingAheadLocationLost`로 정해 쥔 값, 기본값 없음) — 참이면 두 줄은 앞도 목록 상태도 말하지 않고
/// 위치 끊김만 말한다(쥔 고르기가 남아 있어도 그것은 끊기기 전 자리의 앞이다).
public func outingAheadUpper(
    heading: OutingHeading, status: OutingSurroundingsStatus, pick: OutingAheadPick?, locationLost: Bool
) -> OutingAheadUpper {
    if locationLost { return .lastHeading }
    guard case .valid = heading, let pick else { return .headingOnly }
    if let next = pick.next { return .landmark(next) }
    return status == .ready ? .noLandmark : .headingOnly
}

public func outingAheadLower(
    heading: OutingHeading, status: OutingSurroundingsStatus, nodes: OutingSurroundingsStatus, pick: OutingAheadPick?,
    locationLost: Bool
) -> OutingAheadLower {
    // 위치가 끊긴 동안은 주변 조회도 나아가지 못한다 — 목록 상태(확인 중·실패)보다 위치 끊김이 지금 사용자에게 맞는 말이다.
    // 「위치 확인 중」은 없음을 단정하지 않으므로 3-state를 뭉개지 않는다.
    if locationLost { return .locating }
    let valid: Bool = if case .valid = heading, pick != nil { true } else { false }
    if valid, let pick, !pick.near.isEmpty { return .items(pick.near) }
    if status != .ready { return .surroundings(status) }
    guard valid else { return .noHeading }
    // 장소는 받았어도 횡단보도·교차로 원천이 준비되지 않았으면 「없음」이 아니다 — 그 상태를 말한다.
    if nodes != .ready { return .surroundings(nodes) }
    return .empty
}

/// 보행 노드(횡단보도·교차로) 조회 한 번의 결과를 아랫줄 판정의 준비 상태로(`nodes` 인자). 조회가 실패했거나(nil) 원천 하나라도
/// 실패(`error`, 옛 서버의 필드 부재 포함)면 `failed`. 미제공(`unsupported`, 서울 밖의 서울망 등)은 「그 원천엔 없다」라 준비로 친다.
/// 아직 조회하지 않았으면 호출부가 `loading`을 쥔다.
public func outingNodesStatus(_ walk: OutingWalkNodes?) -> OutingSurroundingsStatus {
    guard let walk else { return .failed }
    if case .error = walk.infra.osm { return .failed }
    if case .error = walk.osmJunctions { return .failed }
    if case .error = walk.seoulCrosswalks { return .failed }
    if case .error = walk.seoulJunctions { return .failed }
    return .ready
}

/// 새 fix 없이 시간이 흐를 때(감시 타이머·못 쓰는 fix 경로) 쥐고 있는 방위가 아직 지금의 방위인가 — valid이고 마지막 표의
/// 나이가 `outingHeadingMaxAgeSeconds` 안일 때만 참. 거짓이면 앞 상황을 내린다(「앞」은 지금 걷는 방향을 알 때만).
public func outingHeadingIsCurrent(_ heading: OutingHeading, state: OutingHeadingState, now: Double) -> Bool {
    guard case .valid = heading, let latest = state.latest else { return false }
    let age = now - latest.at
    return age >= 0 && age <= outingHeadingMaxAgeSeconds
}

/// 걷던 중 위치가 끊겨 앞 상황을 내릴 때인가(E82 위원장 판정 2026-11-17: 두 줄은 「마지막 진행 방향 {방위}」·「위치 확인 중」).
/// 방위는 쓸 수 있는 fix가 올 때만 다시 정해지므로(fix 두절·못 쓰는 fix는 방위를 그대로 둔다) 「방위는 valid인데 지금의 방위가
/// 아니다」가 곧 걷던 중 위치를 확인하지 못하고 있는 상태다. 처음부터 방위를 모르는 상태(`none`)와 멈춰서 방위가 흐려진
/// 상태(`stale` — 쓸 수 있는 fix가 다시 정한 값)는 들지 않는다. 다음 쓸 수 있는 fix가 방위를 다시 정하면 호출부가 내린다.
public func outingAheadLocationLost(_ heading: OutingHeading, state: OutingHeadingState, now: Double) -> Bool {
    guard case .valid = heading else { return false }
    return !outingHeadingIsCurrent(heading, state: state, now: now)
}

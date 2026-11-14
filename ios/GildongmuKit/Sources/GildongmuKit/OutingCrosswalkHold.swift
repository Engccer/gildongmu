import Foundation

// 받아쓰기 중 횡단보도 경고(E82 V25~V27, spec 2026-11-14-e82-vergilius-v1-design.md §3.4).
//
// 받아쓰기(말로 묻기·채팅·검색)가 안내 발화를 막고 있는 동안 횡단보도 경고가 오면 문장을 버리지 않는다: 진동은 그
// 자리에서 한 번 내고, 그 횡단보도를 쥐고 있다가 막힘이 풀리는 순간 말한다. 막힘에는 길이 상한이 없으므로(권한·모델
// 준비) 쥔 것은 풀릴 때까지 남는다. 「말했다」 표시는 문장을 실제로 낸 때에만 선다 — 쥘 때 표시를 넣으면 문장 없이
// 「말한 횡단보도」가 된다(이 타입이 생기기 전의 결함).

/// 이 fix의 횡단보도 예고를 어떻게 할 것인가.
public enum OutingCrosswalkAction: Sendable, Equatable {
    /// 지금 말한다(「말했다」 표시가 섰다).
    case speak
    /// 발화가 막혀 있다 — 쥐었고, 진동을 낼 차례다(횡단보도마다 한 번).
    case vibrate
    /// 발화가 막혀 있다 — 쥐고 있고 진동은 이미 냈다.
    case hold
}

public struct OutingCrosswalkLedger: Sendable, Equatable {
    /// 문장을 낸 횡단보도(와 그 근접 짝). `outingCrosswalkNoticeStep`의 `spoken`으로 넘긴다.
    public private(set) var spoken: Set<String> = []
    /// 발화가 막힌 동안 쥔 횡단보도 — 하나, 최신이 이긴다(걸어서 다음 횡단보도에 닿았으면 앞의 것은 지났다).
    public private(set) var held: OutingCrosswalkNotice?
    /// 진동을 낸 횡단보도. 「말했다」 표시와 따로 둔다 — 진동을 냈다고 문장을 낸 것이 아니다.
    public private(set) var vibrated: Set<String> = []

    public init() {}

    /// 이 fix의 예고를 받는다. `suppressed`: 지금 안내 발화가 막혀 있는가(기본값 없음 — 빠뜨리면 막힌 동안의 경고가
    /// 「말했다」로 적히고 사라진다). `silencing`: 말할 때 함께 침묵시킬 근접 짝(`outingCrosswalkSilenced`).
    public mutating func notice(
        _ notice: OutingCrosswalkNotice, silencing: [String], suppressed: Bool
    ) -> OutingCrosswalkAction {
        guard !suppressed else { return grab(notice) ? .vibrate : .hold }
        held = nil  // 지금 말하는 문장이 쥔 것을 대신한다(같은 횡단보도이거나, 더 가까운 다음 횡단보도다)
        spoken.insert(notice.id)
        spoken.formUnion(silencing)
        return .speak
    }

    /// 낸 문장이 발화 막힘 때문에 실리지 못했거나 끊겼다 — 다시 쥔다. 돌려주는 값은 진동을 낼 차례인가.
    public mutating func droppedWhileSuppressed(_ notice: OutingCrosswalkNotice) -> Bool {
        grab(notice)
    }

    /// 막힘이 풀렸다(끝남·취소·실패 어느 길로든). 쥔 횡단보도를 내놓고 「말했다」 표시를 세운다 — 한 번만 내놓는다.
    /// `surelyBehind`: 풀리는 순간 마지막으로 알던 위치와 방향으로 보아 그 횡단보도가 뒤쪽이 확실한가
    /// (`outingCrosswalkSurelyBehind`). 확실하면 말하지 않고 표시도 세우지 않는다(돌아서서 다시 다가가면 예고한다).
    public mutating func release(surelyBehind: Bool, silencing: [String]) -> OutingCrosswalkNotice? {
        guard let notice = held else { return nil }
        held = nil
        guard !surelyBehind else { return nil }
        spoken.insert(notice.id)
        spoken.formUnion(silencing)
        return notice
    }

    private mutating func grab(_ notice: OutingCrosswalkNotice) -> Bool {
        held = notice
        return vibrated.insert(notice.id).inserted
    }
}

/// 쥔 횡단보도가 뒤쪽이 **확실한가**. 사람은 물을 때 서므로 방향을 새로 판정할 수 없다 — 마지막으로 알던 방위(지금의
/// 방위든 「마지막 진행 방향」이든)와 마지막 위치로 본다. 종방향이 뒤로 옆 띠(`outingBesideBandMeters`)와 위치
/// 오차를 모두 넘었을 때만 확실하다. 방위·위치·횡단보도 중 하나라도 모르면 확실하지 않다(말한다).
public func outingCrosswalkSurelyBehind(
    fix: (lat: Double, lng: Double, accuracy: Double)?, heading: OutingHeading, crosswalk: OutingCrosswalk?
) -> Bool {
    guard let fix, let crosswalk, let bearing = heading.bearing, fix.accuracy.isFinite else { return false }
    let relation = outingProject(
        fixLat: fix.lat, fixLng: fix.lng, accuracy: fix.accuracy,
        heading: .valid(bearing: bearing, uncertaintyDeg: 0),
        placeLat: crosswalk.lat, placeLng: crosswalk.lng)
    guard relation.validBearing != nil else { return false }
    return relation.s < -max(outingBesideBandMeters, fix.accuracy)
}

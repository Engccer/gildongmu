import Foundation

// 받아쓰기 중 횡단보도 경고(E82 V25~V27, spec 2026-11-14-e82-vergilius-v1-design.md §3.4).
//
// 받아쓰기(말로 묻기·채팅·검색)가 안내 발화를 막고 있는 동안 횡단보도 경고가 오면 문장을 버리지 않는다: 진동은 그
// 자리에서 한 번 내고, 그 횡단보도를 쥐고 있다가 막힘이 풀리는 순간 말한다. 막힘에는 길이 상한이 없으므로(권한·모델
// 준비) 쥔 것은 풀릴 때까지 남는다.
//
// 「말했다」 표시는 낸 때가 아니라 **끝까지 말해졌다는 끝 신호**(`spoke`)에서 선다(V0a). 낸 문장은 끝 신호를 받을 때까지
// `inFlight`에 있고, 버림이 오면 막힘 여부와 무관하게 다시 쥔다 — 받아쓰기 시작은 기기 음성을 억제보다 먼저 멈추고, 받아쓰기
// 완료는 포커스 이동과 원문 통지로 막 낸 VoiceOver 통지를 끊는다. 낸 때 표시를 세우면 두 경우 모두 경고가 사라진다.

/// 버림이 온 뒤 다시 낼 수 있는 횟수(횡단보도마다). 넘으면 포기하고 「말했다」로 적는다 — 다시 예고하지 않는다.
/// 받아쓰기 시작과 끝이 한 번씩 끊는 경우(둘)를 덮는 값이다. 화면이 꺼지고 음성 토글이 꺼져 채널이 없는 동안은 세 번
/// 버려지고 끝난다(종전처럼 효과음만).
public let outingCrosswalkRetryLimit = 2
/// 막히지 않은 채 버림이 오면 이만큼 기다렸다 다시 낸다(초). 받아쓰기 시작은 기기 음성을 먼저 멈추고 억제는 그 뒤에 서므로,
/// 곧장 다시 내면 막 켜지는 마이크에 겹친다 — 기다리는 사이 억제가 서면 쥔 채 풀릴 때를 기다린다.
public let outingCrosswalkRetryDelaySeconds = 1.0
/// 막힘이 풀린 뒤 쥔 경고를 내기까지 기다리는 시간(초). 받아쓰기를 끝낸 화면은 억제가 풀린 바로 그 순간 포커스를 옮기고
/// 받아쓴 원문을 통지한다 — 그 통지가 먼저 게시된 뒤에 경고를 VoiceOver 대기열 뒤(낮은 우선순위)로 내서 순서를 세운다.
public let outingCrosswalkReleaseDelaySeconds = 0.3

/// 이 fix의 횡단보도 예고를 어떻게 할 것인가.
public enum OutingCrosswalkAction: Sendable, Equatable {
    /// 지금 낸다(끝 신호를 기다리는 `inFlight`에 들었다).
    case speak
    /// 발화가 막혀 있다 — 쥐었고, 진동을 낼 차례다(횡단보도마다 한 번).
    case vibrate
    /// 발화가 막혀 있다 — 쥐고 있고 진동은 이미 냈다.
    case hold
}

/// 낸 횡단보도 문장이 버려졌을 때 할 일.
public enum OutingCrosswalkDropAction: Sendable, Equatable {
    /// 발화가 막혀 있다 — 다시 쥐었다. 풀릴 때 낸다. `vibrate`: 진동을 낼 차례인가(횡단보도마다 한 번).
    case hold(vibrate: Bool)
    /// 막혀 있지 않다 — 다시 쥐었다. `outingCrosswalkRetryDelaySeconds` 뒤 다시 낸다.
    case retry
    /// 재시도 상한을 넘었다 — 포기하고 「말했다」로 적었다.
    case giveUp
    /// 이 횡단보도는 더 낼 차례가 아니다: 그 뒤에 다른 횡단보도를 냈거나 쥐었다(걸어서 다음 횡단보도에 닿았다), 또는 이미
    /// 닫혔다. 「말했다」로 적지 않으므로 아직 앞에 있으면 예고 판정이 다시 고른다.
    case superseded
}

/// 쥔 횡단보도를 낼 때의 판정(`outingHeldCrosswalkVerdict`).
public enum OutingHeldCrosswalkVerdict: String, Sendable, Equatable {
    /// 말한다.
    case speak
    /// 횡단보도 후보에서 사라졌다(조회가 바뀌었다) — 말하지 않는다.
    case gone
    /// 예고 거리 밖으로 멀어졌다(긴 받아쓰기 중 걸어 멀어졌다) — 말하지 않는다.
    case far
    /// 뒤쪽이 확실하다 — 말하지 않는다.
    case behind
}

public struct OutingCrosswalkLedger: Sendable, Equatable {
    /// 끝까지 말한 횡단보도(와 그 근접 짝), 그리고 재시도를 포기한 횡단보도.
    public private(set) var spoken: Set<String> = []
    /// 쥔 횡단보도 — 하나, 최신이 이긴다(걸어서 다음 횡단보도에 닿았으면 앞의 것은 지났다). 발화가 막힌 동안 온 예고와,
    /// 낸 뒤 버려진 예고가 여기에 든다.
    public private(set) var held: OutingCrosswalkNotice?
    /// 진동을 낸 횡단보도. 「말했다」 표시와 따로 둔다 — 진동을 냈다고 문장을 낸 것이 아니다.
    public private(set) var vibrated: Set<String> = []
    /// 냈지만 끝 신호를 아직 받지 못한 횡단보도 — id → 끝까지 말해지면 함께 침묵시킬 근접 짝.
    public private(set) var inFlight: [String: [String]] = [:]
    /// 가장 나중에 낸 횡단보도. 그보다 앞서 낸 것의 늦은 버림은 다시 내지 않는다.
    private var lastPosted: String?
    /// 횡단보도별 버림 횟수(재시도 상한의 근거).
    private var drops: [String: Int] = [:]

    public init() {}

    /// 예고 판정(`outingCrosswalkNoticeStep`의 `spoken`)에 넘길 집합: 말한 것, 낸 채 끝 신호를 기다리는 것, 쥔 것.
    /// 쥔 것을 빼지 않으면 풀림 지연(`outingCrosswalkReleaseDelaySeconds`)과 재시도 지연 사이에 온 fix가 그 경고를
    /// 기본 우선순위로 먼저 내 버린다(받아쓴 원문 통지를 끊는다).
    public var settled: Set<String> {
        var ids = spoken.union(inFlight.keys)
        if let held { ids.insert(held.id) }
        return ids
    }

    /// 이 fix의 예고를 받는다. `suppressed`: 지금 안내 발화가 막혀 있는가(기본값 없음 — 빠뜨리면 막힌 동안의 경고를
    /// 그대로 내서 버려진다). `silencing`: 끝까지 말해지면 함께 침묵시킬 근접 짝(`outingCrosswalkSilenced`).
    public mutating func notice(
        _ notice: OutingCrosswalkNotice, silencing: [String], suppressed: Bool
    ) -> OutingCrosswalkAction {
        guard !suppressed else { return grab(notice) ? .vibrate : .hold }
        held = nil  // 지금 내는 문장이 쥔 것을 대신한다(더 가까운 다음 횡단보도다)
        post(notice, silencing: silencing)
        return .speak
    }

    /// 낸 문장이 끝까지 말해졌다(끝 신호) — 「말했다」 표시를 그 근접 짝과 함께 세운다.
    public mutating func spoke(_ id: String) {
        let silencing = inFlight.removeValue(forKey: id) ?? []
        spoken.insert(id)
        spoken.formUnion(silencing)
    }

    /// 낸 문장이 버려졌다(실리지 못했거나 말하다 끊겼다). 막힘 여부와 무관하게 다시 쥐고, 막혀 있으면 풀릴 때, 아니면 잠시
    /// 뒤에 다시 낸다. 횡단보도마다 `outingCrosswalkRetryLimit`번까지다. `suppressed`: 지금 안내 발화가 막혀 있는가.
    public mutating func dropped(_ notice: OutingCrosswalkNotice, suppressed: Bool) -> OutingCrosswalkDropAction {
        guard let silencing = inFlight.removeValue(forKey: notice.id) else { return .superseded }
        if let held, held.id != notice.id { return .superseded }
        guard lastPosted == notice.id else { return .superseded }
        let count = (drops[notice.id] ?? 0) + 1
        drops[notice.id] = count
        guard count <= outingCrosswalkRetryLimit else {
            spoken.insert(notice.id)
            spoken.formUnion(silencing)
            return .giveUp
        }
        if suppressed { return .hold(vibrate: grab(notice)) }
        held = notice
        return .retry
    }

    /// 쥔 것을 다시 내려던 순간 발화가 막혀 있다(재시도 지연 사이에 받아쓰기가 시작됐다) — 쥔 채 풀릴 때를 기다린다.
    /// 돌려주는 값은 진동을 낼 차례인가(횡단보도마다 한 번).
    public mutating func stillSuppressed() -> Bool {
        guard let held else { return false }
        return vibrated.insert(held.id).inserted
    }

    /// 쥔 횡단보도를 내놓는다(막힘이 풀렸을 때와 재시도 때). `verdict`가 `.speak`가 아니면 말하지 않고 표시도 세우지 않는다
    /// (돌아서서 다시 다가가면 예고한다). 내놓은 것은 끝 신호를 기다리는 `inFlight`에 든다.
    public mutating func release(verdict: OutingHeldCrosswalkVerdict, silencing: [String]) -> OutingCrosswalkNotice? {
        guard let notice = held else { return nil }
        held = nil
        guard verdict == .speak else { return nil }
        post(notice, silencing: silencing)
        return notice
    }

    private mutating func post(_ notice: OutingCrosswalkNotice, silencing: [String]) {
        inFlight[notice.id] = silencing
        lastPosted = notice.id
    }

    private mutating func grab(_ notice: OutingCrosswalkNotice) -> Bool {
        held = notice
        return vibrated.insert(notice.id).inserted
    }
}

/// 쥔 횡단보도를 지금 말할 것인가. 후보에 없으면(`crosswalk` nil) 말하지 않고, 마지막 위치에서 예고가 서는 범위(앞 30m ×
/// 옆 15m의 가장 먼 점)와 위치 오차를 넘게 멀어졌으면 말하지 않고, 뒤쪽이 확실하면 말하지 않는다. 위치를 모르면 말한다.
public func outingHeldCrosswalkVerdict(
    fix: (lat: Double, lng: Double, accuracy: Double)?, heading: OutingHeading, crosswalk: OutingCrosswalk?
) -> OutingHeldCrosswalkVerdict {
    guard let crosswalk else { return .gone }
    if let fix, fix.accuracy.isFinite {
        let reach = (outingCrosswalkNoticeMeters * outingCrosswalkNoticeMeters
            + outingCrosswalkLateralMeters * outingCrosswalkLateralMeters).squareRoot()
        let distance = haversineMeters(lat1: fix.lat, lng1: fix.lng, lat2: crosswalk.lat, lng2: crosswalk.lng)
        if distance > reach + fix.accuracy { return .far }
    }
    if outingCrosswalkSurelyBehind(fix: fix, heading: heading, crosswalk: crosswalk) { return .behind }
    return .speak
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

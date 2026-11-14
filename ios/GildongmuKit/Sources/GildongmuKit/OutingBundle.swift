import Foundation

// ── 나들이 묶어 말하기(E82 V1~V7, spec `docs/superpowers/specs/2026-11-14-e82-vergilius-v1-design.md` §3.1) ──
// 지나친 가게는 문장이 아니라 **가게 id**로 한 곳(묶음)에 쥔다. 문장은 채널이 빌 때 그 순간의 위치와 방향으로 만든다 —
// 미리 만든 문장을 최신이 이기는 칸에 넣으면 앞 문장이 사라지고, 자리에 묶인 문장은 늦게 말하면 거짓이다.
// 「말했다」 표시는 문장이 끝까지 말해진 뒤에 선다(발화 전달 계약 V0a). 끊기거나 버려진 묶음은 되돌아온다.

/// 다가옴 판정의 길가 거리(m). 가게와의 거리가 한 번이라도 이 안으로 들어왔어야 「지나쳤다」를 센다.
public let outingApproachRoadsideMeters = 20.0
/// ⚠ 잠정값(실보행 세션 재생으로 고름). 가장 가까웠던 거리에서 이만큼 멀어지면 지나친 것이다(m). 재생에서 5·8·12m가
/// 모두 길가 20m 안 가게를 전부 살렸고, GPS 흔들림(정확도 5~10m)에 한 번 튄 값으로는 넘지 않게 가운데 값을 골랐다.
public let outingApproachHysteresisMeters = 8.0
/// 묶음이 문장이 될 때 이보다 멀어진 가게는 말하지 않고 「지나옴」으로 넘긴다(m, V6).
public let outingBundleStaleMeters = 40.0
/// 한 가게가 실린 문장이 이만큼 끊기거나 버려지면 그 가게는 말하기를 그만두고 「지나옴」으로 넘긴다(회).
/// 상한이 없으면 화면을 탐색하는 낭독이 통지를 끊을 때마다 같은 문장이 끝없이 다시 나간다.
public let outingBundleMaxDrops = 3

/// 끊긴 뒤 다음 주변 문장까지 쉬는 시간(초): 끊긴 횟수 1·2·3회에 3·6·12초. 끊은 쪽(안전 문장, 사용자의 화면 탐색
/// 낭독)이 말하는 동안 같은 묶음을 곧장 다시 밀어 넣지 않는다.
public func outingBundleRetryHoldSeconds(drops: Int) -> Double {
    3 * pow(2, Double(min(max(drops, 1), outingBundleMaxDrops) - 1))
}

/// 가게별로 가장 가까웠던 거리와 「다가온 적이 있는가」. 방향 없이 「지나침」을 세는 재료다(V3).
public struct OutingApproachState: Sendable, Equatable {
    public var nearest: [String: Double]
    /// 거리가 한 번이라도 줄어든 가게 — 가장 가까웠던 값보다 먼 관측이 그 앞에 있었다.
    public var approached: Set<String>

    public init(nearest: [String: Double] = [:], approached: Set<String> = []) {
        self.nearest = nearest
        self.approached = approached
    }
}

/// 방향과 무관한 지나침: 길가 20m 안으로 들어왔던 가게와의 거리가 줄다가 `outingApproachHysteresisMeters`만큼 늘었다.
/// 진행 방향 판정(`outingPassByStep`)이 놓치는 자리(지나치는 순간 방향을 잃음, 한 번도 「앞」이었던 적이 없음)를 받는다.
/// 「줄다가」가 조건이다: 처음 본 뒤로 멀어지기만 한 가게(이미 지나온 자리에서 목록에 든 가게, 등 뒤의 가게)는 세지
/// 않는다 — 다가간 적이 없는 가게를 「지나쳤다」고 말하지 않는다.
///
/// `stopped`(정지 판정)인 fix는 **세지도 않고 거리도 갱신하지 않는다** — 서 있는 사람에게 GPS 흔들림으로 가게가 쏟아지지
/// 않게. 기본값이 없다: 빠뜨리면 정지 구간에서 발화가 난다. `held`(이미 말했거나 묶음에 있는 가게)는 거리만 갱신한다.
/// 돌려주는 목록은 가까운 순이다.
public func outingApproachStep(
    _ state: OutingApproachState, distances: [String: Double], stopped: Bool, held: Set<String>
) -> (state: OutingApproachState, passed: [String]) {
    guard !stopped else { return (state, []) }
    var next = state
    var passed: [(id: String, d: Double)] = []
    for (id, d) in distances where d.isFinite {
        let before = state.nearest[id]
        let nearest = min(before ?? .infinity, d)
        next.nearest[id] = nearest
        if let before, d < before { next.approached.insert(id) }
        guard !held.contains(id), next.approached.contains(id), nearest <= outingApproachRoadsideMeters,
              d - nearest >= outingApproachHysteresisMeters
        else { continue }
        passed.append((id, d))
    }
    return (next, passed.sorted { ($0.d, $0.id) < ($1.d, $1.id) }.map(\.id))
}

/// 한 문장이 될 가게들. 좌우는 문장이 되는 순간의 `OutingSide`에서만 온다(좌우를 확정하지 못하면 「옆에」).
/// 한 쪽 안의 순서는 가까운 순이다(V2).
public struct OutingBundleLine: Sendable, Equatable {
    public let left: [String]
    public let right: [String]
    public let beside: [String]

    public var ids: [String] { left + right + beside }
}

/// 묶음에 새로 든 가게와 그 판정 출처(로그용).
public struct OutingBundleAddition: Sendable, Equatable {
    public let id: String
    /// 방향 없는 다가옴 판정으로 들었는가(false면 진행 방향 판정).
    public let byApproach: Bool
}

/// 끊긴 문장의 처리 결과: 다음 주변 문장까지 쉴 시간과, 끊김 상한에 닿아 「지나옴」으로 넘긴 가게.
public struct OutingBundleDrop: Sendable, Equatable {
    public let holdSeconds: Double
    public let givenUp: [String]
}

/// 아직 말하지 못한 가게의 묶음과 「말했다」 표시(V4·V5). 모델에 하나만 둔다.
public struct OutingBundle: Sendable, Equatable {
    /// 지나쳤지만 아직 문장으로 내지 않은 가게(지나친 순서).
    public private(set) var pending: [String] = []
    /// 문장으로 내보냈고 끝 신호를 기다리는 가게.
    public private(set) var inFlight: [String] = []
    /// 끝까지 말한 가게.
    public private(set) var spoken: Set<String> = []
    /// 말하지 않고 넘긴 가게(「지나옴」): 말하기 전에 40m 넘게 지나왔거나, 실린 문장이 `outingBundleMaxDrops`번 끊겼다.
    public private(set) var passedBy: Set<String> = []
    /// 가게별로 실린 문장이 끊기거나 버려진 횟수.
    private var drops: [String: Int] = [:]
    private var approach = OutingApproachState()

    public init() {}

    /// 다시 후보가 되지 않는 가게 전부.
    public var held: Set<String> {
        spoken.union(passedBy).union(pending).union(inFlight)
    }

    /// 한 위치 갱신의 지나침을 묶음에 더한다(V1·V3·V4): 진행 방향 판정의 자격 있는 **전부** + 방향 없는 다가옴 판정.
    /// 덮어쓰지 않고 뒤에 붙이며 같은 가게는 한 번만 든다. `candidates`는 호출부가 낭독 단계로 이미 거른 목록이다.
    /// `stopped`는 기본값이 없다(`outingApproachStep`).
    @discardableResult
    public mutating func observe(candidates: [OutingPassByCandidate], stopped: Bool) -> [OutingBundleAddition] {
        let byBearing = outingPassByStep(candidates: candidates, spoken: held).passed
        let step = outingApproachStep(
            approach, distances: Dictionary(candidates.map { ($0.id, $0.current.d) }, uniquingKeysWith: min),
            stopped: stopped, held: held.union(byBearing))
        approach = step.state
        var added: [OutingBundleAddition] = []
        for (id, byApproach) in byBearing.map({ ($0, false) }) + step.passed.map({ ($0, true) })
        where !held.contains(id) {
            pending.append(id)
            added.append(OutingBundleAddition(id: id, byApproach: byApproach))
        }
        return added
    }

    /// 묶음을 문장으로 만든다(V6) — 채널이 비었을 때만 부른다. 좌우는 넘겨받은 **지금의** 관계에서 다시 읽는다.
    /// `outingBundleStaleMeters`보다 멀어진 가게(와 관계를 모르는 가게)는 말하지 않고 `passedBy`로 넘긴다.
    /// 문장이 된 가게는 `inFlight`로 옮긴다 — 아직 「말했다」가 아니다. 앞 문장의 끝 신호를 기다리는 중이면 아무것도 하지 않는다.
    public mutating func compose(
        relations: [String: OutingRelation]
    ) -> (line: OutingBundleLine?, passedBy: [String]) {
        guard inFlight.isEmpty, !pending.isEmpty else { return (nil, []) }
        var gone: [String] = []
        var near: [(id: String, relation: OutingRelation)] = []
        for id in pending {
            if let relation = relations[id], relation.d <= outingBundleStaleMeters {
                near.append((id, relation))
            } else {
                gone.append(id)
            }
        }
        pending = []
        passedBy.formUnion(gone)
        near.sort { ($0.relation.d, $0.id) < ($1.relation.d, $1.id) }
        guard !near.isEmpty else { return (nil, gone) }
        inFlight = near.map(\.id)
        func ids(_ side: OutingSide) -> [String] { near.filter { $0.relation.side == side }.map(\.id) }
        return (OutingBundleLine(left: ids(.left), right: ids(.right), beside: ids(.unknown)), gone)
    }

    /// 내보낸 문장이 끝까지 말해졌다(V5) — 이제 「말했다」다. 돌려주는 값은 그 가게들(기록 자리).
    @discardableResult
    public mutating func finishSpoken() -> [String] {
        let done = inFlight
        inFlight = []
        spoken.formUnion(done)
        done.forEach { drops[$0] = nil }
        return done
    }

    /// 내보낸 문장이 끊기거나 버려졌다(V0d) — 말하지 않은 것으로 되돌아온다(먼저 지나친 가게라 묶음 앞에).
    /// 끊긴 횟수가 `outingBundleMaxDrops`에 닿은 가게는 되돌리지 않고 「지나옴」으로 넘긴다. 돌려주는 쉬는 시간은 이
    /// 문장에 실렸던 가게 중 가장 많이 끊긴 횟수로 정한다(3·6·12초).
    @discardableResult
    public mutating func finishDropped() -> OutingBundleDrop {
        var back: [String] = []
        var givenUp: [String] = []
        var worst = 0
        for id in inFlight {
            let count = (drops[id] ?? 0) + 1
            drops[id] = count
            worst = max(worst, count)
            if count >= outingBundleMaxDrops {
                givenUp.append(id)
            } else {
                back.append(id)
            }
        }
        passedBy.formUnion(givenUp)
        givenUp.forEach { drops[$0] = nil }
        pending = back + pending.filter { !inFlight.contains($0) }
        inFlight = []
        return OutingBundleDrop(holdSeconds: outingBundleRetryHoldSeconds(drops: worst), givenUp: givenUp)
    }
}

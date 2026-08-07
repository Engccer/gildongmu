import Foundation

/// 안내 톤 선택(순수 함수, 웹 `src/lib/guide-tone-layer.ts` 미러).
///
/// **간략·상세가 같은 함수를 쓴다.** 모드 차이는 입력 조립에만 있다 — 두 모드가 각자
/// 계층 로직을 가지면 이 설계가 고치려던 부채(같은 `tick`이 간략에서 정체, 상세에서
/// 생존 하트비트라는 두 뜻)가 형태만 바꿔 남는다.
///
/// **우선순위 중재기가 아니라 계층 순서다.** 각 단계는 배타적이고, 위 단계가 톤을
/// 내면 아래 단계의 `trendStep`을 **호출하지 않는다**. 호출하지 않으므로 앵커·추세·
/// 타이머가 갱신되지 않고, 따라서 "억제된 후보의 latch가 커밋되어 다음 fix에서
/// 사라지는" 문제가 구조적으로 성립하지 않는다(2단계 커밋 계약이 불필요하다).
///
/// ```
/// 1. unreliable    → unreliable 톤(진입 즉시 1회 + 간격 반복)
/// 2. priorityTone  → 그 톤(상세 ahead·warning, 간략 nearby)
/// 3. eventOwned    → 침묵(이벤트가 톤 자리를 소유)
/// 4. trend         → 정지 tick / closer / farther
/// ```
///
/// ⚠ 배타성은 **추세 앵커가 정지한다**는 뜻이다. 이탈·불확실 구간이 길면 앵커가
/// 낡으므로 복귀 시 재기준화가 필요한데, 복귀하는 fix에서 상위 톤이 나면 그 fix는
/// 추세 축에 닿지 못한다. `needsRebase`를 상태에 두어 **추세 축에 도달하는 첫 fix**가
/// 소비하게 한다(그러지 않으면 재기준화 기회가 사라져 낡은 앵커로 거짓 추세가 난다).
///
/// 설계 정본: `docs/superpowers/specs/2026-08-08-background-tone-coverage-design.md` §4

public struct TrendInput: Sendable, Equatable {
    /// 추세 축 거리(간략=목적지 직선거리, 상세=경로 잔여 거리).
    public var distance: Double
    public var deadBand: Double
    /// 시간 감쇠의 하한(§데드밴드 감쇠). 이보다 작은 변화는 어떤 경우에도 추세로 읽지
    /// 않는다 — 무한 감쇠는 결국 GPS 지터를 톤으로 만든다. 간략은 `accuracy`, 상세는
    /// 투영 지터 하한을 준다. 미지정이면 `deadBand`와 같아 **감쇠가 없다**(현행 동작).
    public var deadBandFloor: Double
    public var motion: MotionState
    /// closer 최소 간격(초). **수단별로 가른다** — 차량은 데드밴드를 매 fix 넘어
    /// 2초 창에 매번 걸린다(30분 주행에 약 900회).
    public var closerIntervalSeconds: Double

    public init(
        distance: Double, deadBand: Double, deadBandFloor: Double? = nil,
        motion: MotionState, closerIntervalSeconds: Double
    ) {
        self.distance = distance
        self.deadBand = deadBand
        self.deadBandFloor = deadBandFloor ?? deadBand
        self.motion = motion
        self.closerIntervalSeconds = closerIntervalSeconds
    }
}

public struct ToneLayerInput: Sendable, Equatable {
    /// 1단계: 현재 안내를 신뢰할 수 없다(간략 weak·상세 uncertain/reacquiring·fix 워치독).
    public var unreliable: Bool
    /// 2단계: 이 fix가 소유한 우선 톤.
    public var priorityTone: BeaconTone?
    /// 3단계: 이벤트가 톤 자리를 소유한다(상세 event 존재).
    public var eventOwned: Bool
    /// 4단계: 추세 축 입력. **nil이면 추세 판정을 하지 않는다** — 이탈 중 잔여 거리는
    /// 낡은 투영이라 추세로 읽으면 거짓이고, 투영이 튄 fix도 여기서 버린다.
    public var trend: TrendInput?
    /// 도착 종단 — tick·추세·unreliable을 전부 억제한다. 억제하지 않으면 목적지에
    /// 서 있는 동안 정지 tick이 계속 난다. **우선 톤은 억제 대상이 아니다.**
    public var arrived: Bool
    /// 호출부가 요구하는 축 재기준화(이탈 복귀·handoff 축 전환).
    public var rebaseTrend: Bool

    public init(
        unreliable: Bool = false,
        priorityTone: BeaconTone? = nil,
        eventOwned: Bool = false,
        trend: TrendInput? = nil,
        arrived: Bool = false,
        rebaseTrend: Bool = false
    ) {
        self.unreliable = unreliable
        self.priorityTone = priorityTone
        self.eventOwned = eventOwned
        self.trend = trend
        self.arrived = arrived
        self.rebaseTrend = rebaseTrend
    }
}

public struct ToneLayerState: Sendable, Equatable {
    public var anchorDistance: Double?
    public var trend: BeaconTrend
    public var lastTrendToneAt: Double?
    public var lastTickAt: Double?
    public var lastUnreliableAt: Double?
    public var wasUnreliable: Bool
    /// 추세 축에 도달하는 첫 fix가 소비할 재기준화 예약.
    public var needsRebase: Bool
    /// 행동 안내(ahead·warning) 후 추세 톤 억제가 끝나는 시각.
    public var quietUntil: Double?
    /// 앵커가 마지막으로 **움직인** 시각. 데드밴드 시간 감쇠의 기준이다.
    public var anchorSetAt: Double?

    public static let initial = ToneLayerState(
        anchorDistance: nil, trend: .none, lastTrendToneAt: nil, lastTickAt: nil,
        lastUnreliableAt: nil, wasUnreliable: false, needsRebase: false, quietUntil: nil,
        anchorSetAt: nil
    )
}

public enum ToneLayerConstants {
    /// 신뢰 불가 지속 중 반복 간격(초). 초기값이며 실사용 판정 대상이다
    /// (`maxNormalSilenceSeconds` 이하여야 한다).
    public static let unreliableIntervalSeconds = 10.0
    /// 행동 안내 후 정숙 구간(초). 사용자가 행동해야 하는 안내 직후에 배경 톤이
    /// 끼어들면 의미가 흐려진다.
    public static let quietAfterActionSeconds = 3.0
    /// 정지 tick 간격(초).
    public static let tickIntervalSeconds = 3.0
    /// farther 간격(초). **수단별로 가르지 않는다** — 경고 축이기 때문이다
    /// (정상 진행 통지와 경고 통지의 빈도 비대칭은 이미 확립된 정책이다).
    public static let fartherIntervalSeconds = 2.0
    public static let walkCloserIntervalSeconds = 2.0
    /// 차량 closer 간격(초). 초기값이며 실주행 판정 대상이다.
    public static let carCloserIntervalSeconds = 10.0
    /// 허용 최대 정상 침묵(초) = 데드밴드 15m ÷ 느린 구간 0.7m/s. 위원장 판정으로
    /// 계약값 확정(2026-08-08) — "이보다 오래 조용하면 고장"이라는 사용자 계약이다.
    /// ⚠ 최소 재확인 간격 추가는 **폐기한 하트비트가 이름만 바꿔 돌아오는 것**이라
    /// 기각됐고, 데드밴드 축소는 GPS 지터 내성을 깎아 기각됐다. 되살리지 말 것.
    public static let maxNormalSilenceSeconds = 21.0
    /// 데드밴드 감쇠 유예(초). **계약값과 같게 둔다** — 그 안에서는 데드밴드가 원값
    /// 그대로라 현행 동작이 한 치도 바뀌지 않고, 계약을 넘어선 뒤에만 감쇠가 시작된다.
    /// 즉 이 장치는 계약의 변경이 아니라 **계약을 지키기 위한 구현**이다.
    public static let deadBandGraceSeconds = maxNormalSilenceSeconds
    /// 유예 이후 하한에 도달하기까지의 시간(초).
    public static let deadBandDecaySpanSeconds = 21.0
}

/// 거리 축이 평평할 때의 데드밴드 감쇠(위원장 판정 2026-08-08).
///
/// **왜 필요한가**: 21초 계약의 산식(데드밴드 ÷ 느린 구간 속도)은 "목적지를 향해 직선으로
/// 이동한다"는 미명시 전제 위에 서 있었다. 목적지와 평행하게 걷거나 블록을 돌아가면
/// 거리가 거의 변하지 않아 `hold`가 무한 지속되고, `moving`이라 정지 tick도 안 난다.
/// 종전 3초 하트비트가 그 상한을 묶고 있었는데 이 설계가 대체 없이 없앴다(접근성 감사 H1).
///
/// **왜 감쇠인가**: 고정 간격 재확인은 "폐기한 하트비트가 이름만 바꿔 돌아오는 것"이고,
/// 정적 축소는 GPS 지터 내성을 처음부터 깎는다 — 위원장이 둘 다 기각했다. 시간 감쇠는
/// 초기 내성을 온전히 유지하면서 **실제 이동이 있으면 결국 톤이 나게** 한다.
public func decayedDeadBand(
    base: Double, floor: Double, holdSeconds: Double
) -> Double {
    guard holdSeconds > ToneLayerConstants.deadBandGraceSeconds, floor < base else { return base }
    let progress = min(
        1,
        (holdSeconds - ToneLayerConstants.deadBandGraceSeconds)
            / ToneLayerConstants.deadBandDecaySpanSeconds
    )
    return max(floor, base - (base - floor) * progress)
}

public func toneLayerStep(
    state: ToneLayerState,
    input: ToneLayerInput,
    now: Double
) -> (state: ToneLayerState, tone: BeaconTone?) {
    var next = state

    // 1단계 — 신뢰 불가. 도착 후에는 억제한다(목적지에 서 있는 동안 반복 금지).
    if input.unreliable && !input.arrived {
        next.needsRebase = true
        // 진입 즉시 1회가 계약의 핵심이다. 간격 타이머만 두면 GPS 상실 후 최대
        // `unreliableIntervalSeconds`만큼 침묵해 사용자가 이상을 늦게 안다.
        let due = !state.wasUnreliable
            || now - (state.lastUnreliableAt ?? -.infinity)
                >= ToneLayerConstants.unreliableIntervalSeconds
        next.wasUnreliable = true
        guard due else { return (next, nil) }
        next.lastUnreliableAt = now
        return (next, .unreliable)
    }
    if state.wasUnreliable {
        next.wasUnreliable = false
        next.needsRebase = true
    }
    if input.rebaseTrend { next.needsRebase = true }

    // 2단계 — 우선 톤. 행동 안내는 정숙 구간을 연다.
    if let tone = input.priorityTone {
        if tone == .ahead || tone == .warning {
            next.quietUntil = now + ToneLayerConstants.quietAfterActionSeconds
        }
        // 이탈 구간의 잔여 거리는 낡은 투영이라 앵커가 낡는다.
        if tone == .warning { next.needsRebase = true }
        return (next, tone)
    }

    // 3단계 — 이벤트가 톤 자리를 소유.
    if input.eventOwned { return (next, nil) }

    // 4단계 — 추세 축.
    if let until = next.quietUntil, now < until { return (next, nil) }
    guard let t = input.trend, !input.arrived else { return (next, nil) }

    if next.needsRebase {
        next.needsRebase = false
        next.anchorDistance = t.distance
        next.anchorSetAt = now
        // 회복 즉시 1회: 데드밴드 미달이어도 현재 상태를 알린다. 없으면 사용자가
        // 회복 여부를 모른 채 최대 `maxNormalSilenceSeconds`를 더 기다린다.
        if t.motion == .stopped {
            next.lastTickAt = now
            return (next, .tick)
        }
        switch next.trend {
        case .closer:
            next.lastTrendToneAt = now
            return (next, .closer)
        case .farther:
            next.lastTrendToneAt = now
            return (next, .farther)
        case .none:
            return (next, nil)  // 승계할 추세가 없으면 앵커만 잡는다
        }
    }

    // 4.5 추세 축 내부 순서 — 정지가 먼저다.
    if t.motion == .stopped {
        guard now - (state.lastTickAt ?? -.infinity) >= ToneLayerConstants.tickIntervalSeconds
        else { return (next, nil) }
        next.lastTickAt = now
        return (next, .tick)
    }
    // ⚠ `speedUnknown`에서는 tick을 내지 않는다(속도를 모르는데 정지 톤은 거짓이다).
    // 침묵이 늘지만 거짓 정지보다 낫고, 지속되면 fix 워치독이 unreliable로 잡는다.

    // 앵커가 오래 제자리면 데드밴드를 점진 축소한다(평평한 거리 축의 무한 침묵 차단).
    let band = decayedDeadBand(
        base: t.deadBand,
        floor: t.deadBandFloor,
        holdSeconds: now - (next.anchorSetAt ?? now)
    )
    let previousAnchor = next.anchorDistance
    let stepped = trendStep(
        anchor: previousAnchor, trend: next.trend, distance: t.distance, deadBand: band
    )
    next.anchorDistance = stepped.anchor
    next.trend = stepped.trend
    // ⚠ 앵커가 **처음 설정되는** 경우도 포함해야 한다(그때 `kind`는 hold다). 값 변화로
    // 판정하지 않고 `kind != .hold`로만 갱신하면 기준이 영영 nil로 남아 감쇠가 작동하지
    // 않는다 — 계약 테스트가 이 구멍을 잡았다.
    if stepped.anchor != previousAnchor { next.anchorSetAt = now }
    let tone: BeaconTone
    let interval: Double
    switch stepped.kind {
    case .closer:
        tone = .closer
        interval = t.closerIntervalSeconds
    case .farther:
        tone = .farther
        interval = ToneLayerConstants.fartherIntervalSeconds
    case .hold:
        // `moving`인데 데드밴드 미달인 침묵은 허용한다 — 직전 톤이 상태를 이미
        // 알렸고, 여기를 채우면 도보에서 2초마다 소리가 나 빈도 절제와 충돌한다.
        return (next, nil)
    }
    guard now - (state.lastTrendToneAt ?? -.infinity) >= interval else { return (next, nil) }
    next.lastTrendToneAt = now
    return (next, tone)
}

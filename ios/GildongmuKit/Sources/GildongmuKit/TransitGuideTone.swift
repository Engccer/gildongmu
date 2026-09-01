import Foundation

/// 대중교통 승차 국면 추세 톤 계층(E15 ②, spec 2026-09-02 §2) — 웹 `src/lib/transit-guide-tone.ts`
/// 미러. 공유 fixture `transit-guide-tone-scenarios.json`이 **리듀서 입력 단위로** 두 구현의 톤 열을
/// 잠근다(`transitGuideStep` → `transitToneStep`).
///
/// 도보 `toneLayerStep`과 **계층 배타성**과 **앵커 비교**만 공유한다. 축은 정수 정거장 수 하나
/// (데드밴드 = 1)이고 정지 축은 없다(열차의 정차는 정상이라 판정 근거가 없다).
///
/// ⚠ 순서가 도보와 다르다 — **이벤트 소유가 신뢰 불가보다 앞이다.** 신호 전이가 항상 이벤트와
/// 함께 오므로 unreliable을 앞에 두면 한 폴에 경고음 둘이 나고 새 재생이 앞 소리를 선점한다
/// (설계 리뷰 #1). 이벤트 톤이 곧 이 층의 "우선 톤"이다.
///
/// ⚠ 앵커는 **마지막으로 전달된 잔여**다(도보의 "상위 단계에서 앵커 불변"과 반대) — 옮기지 않으면
/// 사다리 발화 직후 같은 값에 closer가 나 중복 진행음이 된다.

public struct TransitToneInput: Sendable, Equatable {
    /// `after.signal ∈ {signalLost, upstreamFailed}`. neverSeen·notYetVisible은 아니다.
    public var unreliable: Bool
    /// 이 스텝의 리듀서 이벤트가 있다 — 이벤트가 톤 자리를 소유한다.
    public var eventOwned: Bool
    /// 추적 중(`signal == tracking`)일 때의 잔여 정거장. 그 외 nil = 추세 판정 안 함.
    public var remaining: Int?
    /// 확정 도착 — 모든 톤 억제. 추정 도착은 억제하지 않는다.
    public var arrivedCertain: Bool

    public init(unreliable: Bool, eventOwned: Bool, remaining: Int?, arrivedCertain: Bool) {
        self.unreliable = unreliable
        self.eventOwned = eventOwned
        self.remaining = remaining
        self.arrivedCertain = arrivedCertain
    }
}

public struct TransitToneState: Sendable, Equatable {
    /// 마지막으로 전달된(이벤트 또는 톤) 잔여 정거장.
    public var anchorRemaining: Int?
    public var wasUnreliable: Bool
    public var lastUnreliableAt: Double?

    public static let initial = TransitToneState(anchorRemaining: nil, wasUnreliable: false, lastUnreliableAt: nil)
}

/// 신뢰 불가 반복 간격(초). 도보 10초보다 긴 이유는 관측 주기가 폴(15~60초)이라서다.
/// ⚠ 잠정값 — 실승차 판정(BACKLOG E15 ②).
public let transitUnreliableIntervalSeconds = 60.0

/// 순수 층(spec §2.3). `now`는 초 단위 단조 시각. 출력은 기존 소리 셋(`closer`·`farther`·`unreliable`).
public func transitToneLayerStep(
    state: TransitToneState, input: TransitToneInput, now: Double
) -> (state: TransitToneState, tone: BeaconTone?) {
    // 0단계 — 확정 도착. 이후 폴은 재관측 감시일 뿐이라 앵커·타이머도 건드리지 않는다.
    if input.arrivedCertain { return (state, nil) }

    var next = state
    // 장부(항상): 진입은 타이머만(진입 톤은 그 폴의 이벤트 몫), 이탈은 앵커를 현재 잔여로.
    if input.unreliable, !state.wasUnreliable {
        next.wasUnreliable = true
        next.lastUnreliableAt = now
    } else if !input.unreliable, state.wasUnreliable {
        next.wasUnreliable = false
        next.anchorRemaining = input.remaining ?? state.anchorRemaining
    }

    // 1단계 — 이벤트 소유. 이벤트가 말한 잔여가 앵커이고, 신뢰 불가 중의 이벤트는 그 소리 뒤
    // 60초 간격이 다시 시작되도록 타이머를 지금으로 되돌린다.
    if input.eventOwned {
        next.anchorRemaining = input.remaining ?? next.anchorRemaining
        if input.unreliable { next.lastUnreliableAt = now }
        return (next, nil)
    }

    // 2단계 — 신뢰 불가 반복.
    if input.unreliable {
        guard now - (next.lastUnreliableAt ?? -.infinity) >= transitUnreliableIntervalSeconds else {
            return (next, nil)
        }
        next.lastUnreliableAt = now
        return (next, .unreliable)
    }

    // 3단계 — 추세 축(정수 정거장, 데드밴드 1).
    guard let remaining = input.remaining else { return (next, nil) }
    guard let anchor = next.anchorRemaining else {
        next.anchorRemaining = remaining  // 첫 값은 이벤트(trackingStarted)가 말한다
        return (next, nil)
    }
    if remaining < anchor {
        next.anchorRemaining = remaining
        return (next, .closer)
    }
    if remaining > anchor {
        next.anchorRemaining = remaining
        return (next, .farther)
    }
    return (next, nil)
}

/// 리듀서 결과 → 층 입력. **전부 `after`에서** 조립한다(설계 리뷰 #2).
public func transitToneInput(after: TransitGuideState, event: TransitGuideEvent?) -> TransitToneInput {
    TransitToneInput(
        unreliable: after.signal == .signalLost || after.signal == .upstreamFailed,
        eventOwned: event != nil,
        remaining: after.signal == .tracking ? after.remaining : nil,
        arrivedCertain: after.phase == .arrived && after.arrivedCertain)
}

/// 리듀서 한 스텝 뒤의 톤 판정 — 오케스트레이터가 부르는 유일한 진입점.
///
/// - `phaseGen`이 바뀐 스텝(국면 전이 = 새 잠금·새 대상)은 층 상태를 초기화한다. 바뀌지 않는
///   전이(도착 추정·`backOnTrack` 복귀)는 같은 열차의 같은 축이라 앵커를 유지한다.
/// - 대기·boarding·done에는 적용하지 않는다(riding·arrived만).
public func transitToneStep(
    state: TransitToneState,
    before: TransitGuideState,
    after: TransitGuideState,
    event: TransitGuideEvent?,
    now: Double
) -> (state: TransitToneState, tone: BeaconTone?) {
    let base = before.phaseGen != after.phaseGen ? TransitToneState.initial : state
    guard after.phase == .riding || after.phase == .arrived else { return (base, nil) }
    return transitToneLayerStep(state: base, input: transitToneInput(after: after, event: event), now: now)
}

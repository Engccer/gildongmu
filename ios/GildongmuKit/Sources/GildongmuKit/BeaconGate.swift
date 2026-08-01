import Foundation

/// 비콘 판정 결과를 **톤과 통지로 라우팅하는 순수 게이트**.
///
/// `beaconStep`이 "무엇이 일어났는가"를 정하면 여기서 "그래서 소리를 낼까, 말을 할까"를
/// 정한다. 앱 계층에 두지 않는 이유는 두 가지다. (1) 이 기능의 실제 결함 이력이 100%
/// 이 계층이었고(웹 감사 2건: throttle 창 공유로 추세 톤 소실, 참조 불안정으로 즉시
/// 정리) (2) 앱 타깃 테스트 번들이 없어서 앱에 두면 구조적으로 검증이 불가능하다.
///
/// 시각(`now`)을 인자로 받으므로 테스트가 실시간을 기다리지 않는다.

/// 통지 내용. Kit은 로컬라이즈하지 않고 **무엇을 알릴지**만 정한다(앱이 문자열 매핑).
public enum BeaconNotice: Sendable, Equatable {
    case first(meters: Int)
    case closer(meters: Int)
    case farther(meters: Int)
    /// ⚠ 미터는 거리가 아니라 **오차 반경**이다(문구가 "약 ±N m").
    case nearby(accuracyMeters: Int)
    case weak
}

public struct BeaconGateState: Sendable, Equatable {
    var lastTrendToneAt: Double?
    var lastTickAt: Double?
    /// 도착 존 톤 래치. 존을 벗어나 추세가 재개될 때만 재무장한다.
    var nearbyToneDone: Bool
    var previousKind: AnnounceKind?

    public static let initial = BeaconGateState(
        lastTrendToneAt: nil, lastTickAt: nil, nearbyToneDone: false, previousKind: nil
    )
}

public enum BeaconGateConstants {
    /// 추세 톤 창. tick과 **독립**이다(공유하면 tick이 추세 톤 예산을 잠식한다).
    public static let trendToneWindow = 2.0
    /// hold tick 창. 추세보다 길게 잡은 소프트 하트비트.
    public static let tickWindow = 3.0
}

public func beaconGateStep(
    state: BeaconGateState,
    announce: BeaconAnnounce,
    now: Double
) -> (state: BeaconGateState, tone: BeaconTone?, notice: BeaconNotice?) {
    var next = state
    var tone: BeaconTone?

    switch announce.kind {
    case .nearby:
        // 존에 머무는 동안 매 fix가 .nearby를 내지만 톤은 진입 1회뿐이다.
        // 리듀서의 래치는 speak(음성)만 억제하므로 톤 래치는 여기 있어야 한다.
        if !state.nearbyToneDone {
            tone = .nearby
            next.nearbyToneDone = true
        }

    case .closer, .farther:
        // 추세가 재개됐다 = 존을 진짜로 벗어났다. 다음 도착은 다시 알린다.
        // (존 경계에서 흔들리는 hold는 재무장하지 않는다. 그건 재진입이 아니다.)
        next.nearbyToneDone = false
        if now - (state.lastTrendToneAt ?? -.infinity) >= BeaconGateConstants.trendToneWindow {
            tone = announce.kind == .closer ? .closer : .farther
            next.lastTrendToneAt = now
        }

    case .hold:
        if now - (state.lastTickAt ?? -.infinity) >= BeaconGateConstants.tickWindow {
            tone = .tick
            next.lastTickAt = now
        }

    case .first, .weak:
        break  // 톤 없음
    }

    // 통지. weak은 리듀서에서 항상 speak=false이므로 speak만 보면 영영 통지되지 않는다.
    // 비-weak → weak 전이에서만 1회 내고 연속 weak은 침묵한다(polite 스팸 방지).
    var notice: BeaconNotice?
    if announce.kind == .weak {
        notice = state.previousKind == .weak ? nil : .weak
    } else if announce.speak {
        let meters = Int((announce.kind == .nearby ? announce.accuracy : announce.distance).rounded())
        notice = switch announce.kind {
        case .first: .first(meters: meters)
        case .closer: .closer(meters: meters)
        case .farther: .farther(meters: meters)
        case .nearby: .nearby(accuracyMeters: meters)
        case .hold, .weak: nil
        }
    }

    next.previousKind = announce.kind
    return (next, tone, notice)
}

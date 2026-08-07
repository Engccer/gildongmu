import Foundation

/// 비콘 판정 결과를 **통지로 라우팅하는 순수 게이트**.
///
/// `beaconStep`이 "무엇이 일어났는가"를 정하면 여기서 "그래서 말을 할까"를 정한다.
/// 앱 계층에 두지 않는 이유는 두 가지다. (1) 이 기능의 실제 결함 이력이 100% 이
/// 계층이었고 (2) 앱 타깃 테스트 번들이 없어서 앱에 두면 구조적으로 검증이 불가능하다.
///
/// ⚠ **톤은 여기서 내지 않는다**(2026-08-08 분리). 톤 선택은 `toneLayerStep`이 단독
/// 소유한다 — 두 곳이 톤을 내면 어느 쪽이 정본인지 알 수 없고, 간략·상세가 같은 계층을
/// 공유한다는 통일 계약이 깨진다. 여기가 답하는 것은 "이번 fix가 **도착 톤을 소유**
/// 하는가"뿐이고, 그 값은 톤 계층의 `priorityTone` 입력이 된다.

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
    /// 도착 톤 소유 래치. 존을 벗어나 추세가 재개될 때만 재무장한다.
    var nearbyToneDone: Bool
    var previousKind: AnnounceKind?

    public static let initial = BeaconGateState(nearbyToneDone: false, previousKind: nil)
}

public func beaconGateStep(
    state: BeaconGateState,
    announce: BeaconAnnounce
) -> (state: BeaconGateState, nearbyTone: Bool, notice: BeaconNotice?) {
    var next = state
    var nearbyTone = false

    switch announce.kind {
    case .nearby:
        // 존에 머무는 동안 매 fix가 .nearby를 내지만 톤 소유는 진입 1회뿐이다.
        // 리듀서의 래치는 speak(음성)만 억제하므로 이 래치가 따로 필요하다.
        if !state.nearbyToneDone {
            nearbyTone = true
            next.nearbyToneDone = true
        }

    case .closer, .farther:
        // 추세가 재개됐다 = 존을 진짜로 벗어났다. 다음 도착은 다시 알린다.
        // (존 경계에서 흔들리는 hold는 재무장하지 않는다. 그건 재진입이 아니다.)
        next.nearbyToneDone = false

    case .first, .hold, .weak:
        break
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
    return (next, nearbyTone, notice)
}

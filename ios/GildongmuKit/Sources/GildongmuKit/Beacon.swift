import Foundation

/// 목적지 거리 비콘의 순수 판정 리듀서. 웹 `src/lib/beacon.ts` 미러.
///
/// 매 GPS fix마다 호출돼 (1) 직선거리 (2) accuracy로 스케일한 데드밴드 기준 추세
/// (3) 도착 임박 (4) 음성 발화 여부를 정한다. "무엇을 알릴지"만 정하고
/// "어떻게 소리낼지"(톤·throttle)는 `BeaconGate`, I/O는 앱 계층 몫이다.
///
/// accuracy 스케일링이 이 리듀서의 전부다. 정확도 나쁜 지역일수록 데드밴드를 키워
/// GPS jitter로 추세가 뒤집히는 것을 칼만 필터 없이 억제한다. 빠지면 걷는 내내
/// "가까워짐"과 "멀어짐"이 번갈아 난다.

public struct BeaconFix: Sendable, Equatable {
    public var lat: Double
    public var lng: Double
    /// 미터. iOS `CLLocation.horizontalAccuracy`는 **음수로 좌표 무효**를 신호한다.
    public var accuracy: Double

    public init(lat: Double, lng: Double, accuracy: Double) {
        self.lat = lat
        self.lng = lng
        self.accuracy = accuracy
    }
}

public struct BeaconDest: Sendable, Equatable {
    public var lat: Double
    public var lng: Double

    public init(lat: Double, lng: Double) {
        self.lat = lat
        self.lng = lng
    }
}

public enum BeaconTrend: Sendable, Equatable {
    case none, closer, farther
}

public enum AnnounceKind: Sendable, Equatable {
    case first, closer, farther, hold, nearby, weak
}

public struct BeaconState: Sendable, Equatable {
    /// 추세 판정 기준 거리. 첫 수용 fix 전엔 nil.
    public var anchorDistance: Double?
    public var trend: BeaconTrend
    /// 마지막으로 음성 발화한 거리(마일스톤 throttle 기준).
    public var lastSpokenDistance: Double?
    /// 도착 임박 존 래치.
    public var nearby: Bool

    public static let initial = BeaconState(
        anchorDistance: nil, trend: .none, lastSpokenDistance: nil, nearby: false
    )
}

public struct BeaconAnnounce: Sendable, Equatable {
    public var kind: AnnounceKind
    /// 목적지까지 직선거리(m). weak이면 0일 수 있다.
    public var distance: Double
    /// 해당 fix의 accuracy(m). nearby 통지의 ±값으로 쓰인다.
    public var accuracy: Double
    /// 음성 발화 여부(톤과 별개).
    public var speak: Bool

    public init(kind: AnnounceKind, distance: Double, accuracy: Double, speak: Bool) {
        self.kind = kind
        self.distance = distance
        self.accuracy = accuracy
        self.speak = speak
    }
}

public enum BeaconConstants {
    public static let maxUsableAccuracy = 100.0
    public static let baseDeadBand = 15.0
    public static let arrivalBase = 20.0
    public static let speakInterval = 50.0
    /// fix 신선도 창(초). 이보다 오래된(또는 미래인) fix는 앵커에 반영하지 않는다.
    public static let freshnessWindow = 5.0
}

/// fix를 앵커·추세에 반영해도 되는지. **캐시 위치와 무효 좌표를 배제한다.**
///
/// `startUpdatingLocation()`의 첫 콜백은 흔히 캐시라, 그대로 앵커를 잡으면 수백 m
/// 어긋난 기준이 서고 진짜 fix가 오는 순간 거짓 추세가 발화된다. 그러면 기능이 아니라
/// 첫 fix가 틀렸는데 "쓸모없다"는 판정이 날 수 있다.
///
/// 앱이 아니라 여기 있는 이유: 앱 타깃 테스트 번들이 없어 모델에 두면 이 방어에
/// 변이 주입조차 할 수 없다(리뷰 I-11).
///
/// `abs`를 쓰는 것은 기기 시계 보정으로 timestamp가 미래로 튀는 경우를 함께 거르기
/// 위해서다(미래 fix도 신뢰할 근거가 없다).
public func isUsableFix(
    accuracy: Double,
    ageSeconds: Double,
    maxAge: Double = BeaconConstants.freshnessWindow
) -> Bool {
    accuracy > 0 && abs(ageSeconds) <= maxAge
}

public func beaconStep(
    state: BeaconState,
    fix: BeaconFix,
    dest: BeaconDest
) -> (state: BeaconState, announce: BeaconAnnounce) {
    let distance = haversineMeters(lat1: fix.lat, lng1: fix.lng, lat2: dest.lat, lng2: dest.lng)

    // 신호 약함/무효: 추세·앵커 불변(상태 그대로 반환).
    // `!(accuracy > 0)`은 NaN·0·음수를 한 번에 거른다. 음수는 CoreLocation의
    // "좌표 무효" 신호이고, 통과시키면 deadBand = max(15, -1) = 15가 되어
    // 쓰레기 좌표가 앵커를 잡는다(웹 가드도 같은 조건으로 동조시켰다).
    if !distance.isFinite || !(fix.accuracy > 0) || fix.accuracy > BeaconConstants.maxUsableAccuracy {
        return (
            state,
            BeaconAnnounce(
                kind: .weak,
                distance: distance.isFinite ? distance : 0,
                accuracy: fix.accuracy.isFinite ? fix.accuracy : 0,
                speak: false
            )
        )
    }

    let deadBand = max(BeaconConstants.baseDeadBand, fix.accuracy)
    let arrivalThreshold = max(BeaconConstants.arrivalBase, fix.accuracy)

    // 첫 수용 fix: 앵커 설정 + 첫 안내(도착 존이면 nearby).
    guard let anchor = state.anchorDistance else {
        if distance <= arrivalThreshold {
            return (
                BeaconState(
                    anchorDistance: distance, trend: .none,
                    lastSpokenDistance: distance, nearby: true
                ),
                BeaconAnnounce(kind: .nearby, distance: distance, accuracy: fix.accuracy, speak: true)
            )
        }
        return (
            BeaconState(
                anchorDistance: distance, trend: .none,
                lastSpokenDistance: distance, nearby: false
            ),
            BeaconAnnounce(kind: .first, distance: distance, accuracy: fix.accuracy, speak: true)
        )
    }

    // 도착 임박(래치): 존 진입 시 1회만 발화, 머무는 동안 침묵.
    if distance <= arrivalThreshold {
        let wasNearby = state.nearby
        return (
            BeaconState(
                anchorDistance: distance, trend: .none,
                lastSpokenDistance: distance, nearby: true
            ),
            BeaconAnnounce(
                kind: .nearby, distance: distance, accuracy: fix.accuracy, speak: !wasNearby
            )
        )
    }

    // 래치 해제는 threshold + deadBand를 넘어야 한다(히스테리시스). 그 전엔 hold 침묵.
    if state.nearby && distance <= arrivalThreshold + deadBand {
        var held = state
        held.nearby = true
        return (
            held,
            BeaconAnnounce(kind: .hold, distance: distance, accuracy: fix.accuracy, speak: false)
        )
    }

    // 여기부터 nearby 해제 상태에서 추세 판정.
    var trend = state.trend
    var newAnchor = anchor
    let kind: AnnounceKind

    if distance <= anchor - deadBand {
        trend = .closer
        newAnchor = distance
        kind = .closer
    } else if distance >= anchor + deadBand {
        trend = .farther
        newAnchor = distance
        kind = .farther
    } else {
        kind = .hold  // 추세·앵커 불변
    }

    let trendFlipped = kind != .hold && state.trend != .none && kind != announceKind(of: state.trend)
    let lastSpoken = state.lastSpokenDistance ?? distance
    let milestone = abs(distance - lastSpoken) >= BeaconConstants.speakInterval
    let speak = kind != .hold && (trendFlipped || milestone)

    return (
        BeaconState(
            anchorDistance: newAnchor,
            trend: trend,
            lastSpokenDistance: speak ? distance : state.lastSpokenDistance,
            nearby: false
        ),
        BeaconAnnounce(kind: kind, distance: distance, accuracy: fix.accuracy, speak: speak)
    )
}

/// 추세를 같은 축의 AnnounceKind로 사상한다(웹은 두 값이 같은 문자열이라 직접 비교했다).
private func announceKind(of trend: BeaconTrend) -> AnnounceKind? {
    switch trend {
    case .closer: .closer
    case .farther: .farther
    case .none: nil
    }
}

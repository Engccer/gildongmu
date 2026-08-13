import Foundation

/// 경로 종점 → 목적지 오프셋 기하 — 웹 `src/lib/final-approach.ts`의 1:1 미러
/// (spec 2026-08-08 §3.1). 공유 fixture `final-approach-scenarios.json`이 동조를 강제한다.
///
/// **정적 계산이라 GPS와 무관하다.** 도보 경로는 목적지가 아니라 가장 가까운 보행로
/// 지점에서 끝나므로(실측 16~89m), 그 구간의 거리·방향을 경로 수신 시점에 확정한다.

/// 이 미만이면 방향을 주장하지 않는다 — 좌표 반올림 ±5.5m에서 방위가 뒤집힌다.
public let offsetMinMeters = 10.0
/// 종점 진행 방위를 평균할 역방향 창(m).
public let bearingWindowMeters = 15.0
/// 도착 확정 반경(m). Soundscape `enterImmediateVicinityDistance`와 같은 값.
///
/// **수치 없이 "목적지 근처"라고만 말하는 반경이기도 하다**(spec §3.6 사다리) —
/// 두 이름을 두지 않는 이유는 spec이 둘을 같은 15m로 정했고 이름이 갈리면 드리프트가
/// 생기기 때문이다. 주기 루프에서는 도착이 먼저 발화하므로 "근처" 분기가 실제로
/// 쓰이는 곳은 오프셋 자체가 10~15m인 진입 서술이다.
///
/// ⚠ Soundscape의 이탈 히스테리시스(30m)는 **일부러 쓰지 않는다.** 목적지를 지나친
/// 사용자에게 안내가 사라지는 것이 초판 결함이었고, 도착이 세션을 끝내므로 되돌아오는
/// 전이 자체가 없어 히스테리시스가 할 일이 없다(상수를 두면 죽은 코드다).
/// ⚠ 실보행 판정 전까지 동결(spec §6-3).
public let finalApproachArriveMeters = 15.0
/// 최종 접근 주기 통지 간격(초). Sendero "Getting Warmer" 실사양. 동결(spec §6-2).
public let finalApproachIntervalSeconds = 15.0

public enum BearingUnavailable: String, Sendable, Equatable {
    case tooClose
    case degenerateGeometry
}

public enum RelativeDirection: String, Sendable, Equatable {
    case ahead
    case left
    case right
    case behind
}

public struct FinalApproachGeometry: Sendable, Equatable {
    public let offsetMeters: Double
    public let relativeBearing: Double?
    public let bearingUnavailable: BearingUnavailable?

    public init(
        offsetMeters: Double,
        relativeBearing: Double?,
        bearingUnavailable: BearingUnavailable?,
    ) {
        self.offsetMeters = offsetMeters
        self.relativeBearing = relativeBearing
        self.bearingUnavailable = bearingUnavailable
    }
}

/// 4분할 경계 소유권. **부등호까지 계약이다**(웹 `relativeDirection` 미러) —
/// 웹과 Swift가 각각 `>`와 `>=`를 고르면 경계 좌표에서 서로 다른 방향을 말한다.
public func relativeDirection(_ theta: Double) -> RelativeDirection {
    let a = abs(theta)
    if a <= 45 { return .ahead }
    if a <= 135 { return theta > 0 ? .right : .left }
    return .behind
}

public func computeFinalApproach(
    route: GuideRoute, dest: RoutePoint
) -> FinalApproachGeometry? {
    let points = route.polyline.points
    let cum = route.polyline.cum
    guard points.count >= 2 else { return nil }
    let end = points[points.count - 1]
    let offset = haversineMeters(lat1: end.lat, lng1: end.lng, lat2: dest.lat, lng2: dest.lng)
    guard offset.isFinite else { return nil }

    if offset < offsetMinMeters {
        return FinalApproachGeometry(
            offsetMeters: offset, relativeBearing: nil,
            bearingUnavailable: .tooClose
        )
    }

    // 종점에서 역방향 bearingWindowMeters 창의 길이 가중 단위벡터 합.
    //
    // ⚠ 각도를 산술 평균하지 않는다(+179/-179 → 0°로 뒤집힘).
    // ⚠ 창에 걸치는 세그먼트는 **겹치는 길이만** 가중치로 쓴다. 통째로 넣으면
    //   "100m 직진 후 모퉁이를 돌아 10m" 경로에서 100m가 가중치를 지배해 방위가
    //   직진 방향으로 남고, 이미 목적지를 향해 선 사용자에게 "오른쪽"을 말한다.
    let total = cum[cum.count - 1]
    let from = max(0, total - bearingWindowMeters)
    var sx = 0.0
    var sy = 0.0
    var i = points.count - 1
    while i > 0 {
        let d0 = cum[i - 1]
        let d1 = cum[i]
        if d1 <= from { break } // 창보다 앞선 세그먼트 — 누적이라 더 볼 것이 없다
        let weight = d1 - max(d0, from)
        if weight > 0 {
            let theta = bearingDegrees(
                fromLat: points[i - 1].lat, fromLng: points[i - 1].lng,
                toLat: points[i].lat, toLng: points[i].lng
            ) * .pi / 180
            sx += weight * cos(theta)
            sy += weight * sin(theta)
        }
        i -= 1
    }
    guard (sx * sx + sy * sy).squareRoot() >= 1e-9 else {
        return FinalApproachGeometry(
            offsetMeters: offset, relativeBearing: nil,
            bearingUnavailable: .degenerateGeometry
        )
    }
    let heading = (atan2(sy, sx) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    let toDest = bearingDegrees(
        fromLat: end.lat, fromLng: end.lng, toLat: dest.lat, toLng: dest.lng
    )
    let rel = (toDest - heading + 540).truncatingRemainder(dividingBy: 360) - 180
    return FinalApproachGeometry(
        offsetMeters: offset, relativeBearing: rel,
        bearingUnavailable: nil
    )
}

// ── 도착 추정(잊힌 세션 정리, spec 2026-08-13) ──
// 웹 `final-approach.ts` 미러. 공유 fixture `presumed-arrival-scenarios.json`이 동조 강제.

/// usable fix 두절이 이만큼 지속되면 실내 진입으로 간주(잠정 — 실보행 재판정).
public let presumedArrivalNoFixSeconds = 180.0
/// usable fix는 오는데 무진행이 이만큼 지속되면 실내 고정 좌표로 간주(잠정).
public let presumedArrivalStationarySeconds = 300.0
/// 진행 관측 앵커 이탈 하한(m). 직전 fix 비교 금지 — 저속 연속 보행이 제자리로 오판된다.
public let progressEpsilonMeters = 10.0
/// 마지막 확인 거리 캡(m). 오프셋 실측 상한 89m + GPS 여유. 이 밖은 이탈이지 도착이 아니다.
public let presumedArrivalMaxDistanceMeters = 150.0

public enum PresumedArrivalReason: String, Sendable, Equatable {
    case noFix
    case stationary
}

private func finiteNonNegative(_ x: Double) -> Bool { x.isFinite && x >= 0 }

/// 도착 추정 판정. 판정 순서(국면 → 거리 캡 → noFix → stationary)까지 계약이다 —
/// 국면 게이트가 경로 중간 자동 종료 금지의 1선 방어다(spec §3).
public func presumedArrivalStep(
    inFinalApproach: Bool,
    secondsSinceUsableFix: Double,
    secondsSinceProgress: Double,
    lastKnownDistanceToDestMeters: Double?
) -> PresumedArrivalReason? {
    guard inFinalApproach else { return nil }
    guard finiteNonNegative(secondsSinceUsableFix),
          finiteNonNegative(secondsSinceProgress)
    else { return nil }
    guard let dist = lastKnownDistanceToDestMeters,
          finiteNonNegative(dist), dist <= presumedArrivalMaxDistanceMeters
    else { return nil }
    if secondsSinceUsableFix >= presumedArrivalNoFixSeconds { return .noFix }
    if secondsSinceProgress >= presumedArrivalStationarySeconds { return .stationary }
    return nil
}

/// 진행 관측 앵커 전진. **직전 fix가 아니라 앵커 기준 누적 변위**다 — 직전 비교는
/// 1m/s 연속 보행(fix 간 1m)을 5분 300m 걷고도 제자리로 오판한다(설계 리뷰 C2).
public func advanceProgressAnchor(
    anchor: RoutePoint?,
    fix: RoutePoint,
    epsilonMeters: Double = progressEpsilonMeters
) -> (anchor: RoutePoint, progressed: Bool) {
    guard let anchor else { return (fix, false) }
    let moved = haversineMeters(
        lat1: anchor.lat, lng1: anchor.lng, lat2: fix.lat, lng2: fix.lng
    )
    if moved >= epsilonMeters { return (fix, true) }
    return (anchor, false)
}

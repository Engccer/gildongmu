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
    public let roadName: String?

    public init(
        offsetMeters: Double,
        relativeBearing: Double?,
        bearingUnavailable: BearingUnavailable?,
        roadName: String?
    ) {
        self.offsetMeters = offsetMeters
        self.relativeBearing = relativeBearing
        self.bearingUnavailable = bearingUnavailable
        self.roadName = roadName
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
    route: GuideRoute, dest: RoutePoint, roadName: String? = nil
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
            bearingUnavailable: .tooClose, roadName: roadName
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
            bearingUnavailable: .degenerateGeometry, roadName: roadName
        )
    }
    let heading = (atan2(sy, sx) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    let toDest = bearingDegrees(
        fromLat: end.lat, fromLng: end.lng, toLat: dest.lat, toLng: dest.lng
    )
    let rel = (toDest - heading + 540).truncatingRemainder(dividingBy: 360) - 180
    return FinalApproachGeometry(
        offsetMeters: offset, relativeBearing: rel,
        bearingUnavailable: nil, roadName: roadName
    )
}

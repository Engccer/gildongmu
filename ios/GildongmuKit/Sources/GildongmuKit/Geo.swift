import Foundation

/// 구면 하버사인 거리(미터). 웹 `src/lib/geo.ts`(R = 6,371,000) 미러.
///
/// ⚠ `CLLocation.distance(from:)`를 쓰지 않는다. 타원체 거리라 웹과 값이 미세하게
/// 갈려 경계값 케이스가 어긋나고, Kit이 CoreLocation에 묶이면 "실기기 없이 테스트,
/// dodo 이식 시 그대로 이동"이라는 Kit 존재 이유가 무너진다.
public func haversineMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double) -> Double {
    let earthRadius = 6_371_000.0
    let dLat = (lat2 - lat1) * .pi / 180
    let dLng = (lng2 - lng1) * .pi / 180
    let a = sin(dLat / 2) * sin(dLat / 2)
        + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLng / 2) * sin(dLng / 2)
    return 2 * earthRadius * atan2(sqrt(a), sqrt(1 - a))
}

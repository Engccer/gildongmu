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

/// from→to 방위각(0~360, 북=0, 동=90). 웹 `src/lib/geo/bearing.ts` 미러.
///
/// ⚠ 이 값 자체는 **북 기준 절대 방위**다. 정면-상대 방향("오른쪽")으로 바꾸려면
/// 사용자가 향한 방위를 빼야 하고, 그 방위의 출처는 두 가지뿐이다 — 경로 기하
/// (`computeFinalApproach`, 정적) 또는 fix의 `course`(`courseStep`, 3-state).
/// 둘 중 무엇도 없으면 상대 방향을 말하지 않는다.
public func bearingDegrees(
    fromLat: Double, fromLng: Double, toLat: Double, toLng: Double
) -> Double {
    let phi1 = fromLat * .pi / 180
    let phi2 = toLat * .pi / 180
    let dLambda = (toLng - fromLng) * .pi / 180
    let y = sin(dLambda) * cos(phi2)
    let x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(dLambda)
    return (atan2(y, x) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
}

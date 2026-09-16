package space.dodoplanet.gildongmu.kit

import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * 구면 하버사인 거리(미터). 웹 `src/lib/geo.ts`(R = 6,371,000) ↔ Kit `Geo.swift` 미러.
 *
 * ⚠ 플랫폼 거리 API(`Location.distanceTo`)를 쓰지 않는다. 타원체 거리라 웹과 값이 미세하게
 * 갈려 경계값 케이스가 어긋나고, :kit이 안드로이드에 묶이면 "실기기 없이 테스트"라는 존재
 * 이유가 무너진다.
 */
fun haversineMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val earthRadius = 6_371_000.0
    val dLat = (lat2 - lat1) * PI / 180
    val dLng = (lng2 - lng1) * PI / 180
    val a = sin(dLat / 2) * sin(dLat / 2) +
        cos(lat1 * PI / 180) * cos(lat2 * PI / 180) * sin(dLng / 2) * sin(dLng / 2)
    return 2 * earthRadius * atan2(sqrt(a), sqrt(1 - a))
}

/**
 * from→to 방위각(0~360, 북=0, 동=90). 웹 `src/lib/geo/bearing.ts` 미러.
 *
 * ⚠ 이 값 자체는 **북 기준 절대 방위**다. 정면-상대 방향("오른쪽")으로 바꾸려면 사용자가 향한
 * 방위를 빼야 하고, 그 방위의 출처는 경로 기하(`computeFinalApproach`) 또는 fix의 `course`뿐이다.
 * 둘 중 무엇도 없으면 상대 방향을 말하지 않는다.
 */
fun bearingDegrees(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double): Double {
    val phi1 = fromLat * PI / 180
    val phi2 = toLat * PI / 180
    val dLambda = (toLng - fromLng) * PI / 180
    val y = sin(dLambda) * cos(phi2)
    val x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(dLambda)
    return (atan2(y, x) * 180 / PI + 360) % 360
}

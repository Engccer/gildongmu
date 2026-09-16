package space.dodoplanet.gildongmu.guide

/**
 * 안내 전용 위치 스트림 fix(spec 2026-09-16-android-m4 §4-2, iOS `LocationService.BeaconFixPayload` 대응).
 * 판정 함수(:kit)의 무효 표지 계약 그대로: 정확도·방위는 `-1.0`(`> 0`·`>= 0` 가드가 거른다), 속도 둘은 `null`
 * (`motionStep`의 3-state — 0.0을 넘기면 도플러가 신뢰 조건을 통과해 걷는 중 거짓 정지 tick이 난다).
 * 나이의 기준은 `elapsedRealtimeNanos`(벽시계 조정 무관, 단조 시계 `SystemClock.elapsedRealtime()`과 같은 축).
 */
data class GuideFixPayload(
    val lat: Double,
    val lng: Double,
    /** m. `hasAccuracy()` 거짓 → -1.0. */
    val accuracy: Double,
    /** m/s. `hasSpeed()` 거짓 → null. */
    val speed: Double?,
    /** m/s. `hasSpeedAccuracy()` 거짓 → null. */
    val speedAccuracy: Double?,
    /** 도(진북). `hasBearing()` 거짓 → -1.0 (0.0 금지 — 북쪽을 향한 것으로 `Valid`가 된다). */
    val course: Double,
    /** 도. `hasBearingAccuracy()` 거짓 → -1.0. */
    val courseAccuracy: Double,
    /** `location.elapsedRealtimeNanos / 1_000_000`. */
    val elapsedRealtimeMs: Long,
)

/** `Location`의 `hasX()`/값 쌍을 페이로드로(순수 — JVM 테스트 대상). `AndroidLocationSource.toRawFix`와 같은 정수 나눗셈. */
fun guideFixPayload(
    lat: Double,
    lng: Double,
    hasAccuracy: Boolean,
    accuracy: Float,
    hasSpeed: Boolean,
    speed: Float,
    hasSpeedAccuracy: Boolean,
    speedAccuracy: Float,
    hasBearing: Boolean,
    bearing: Float,
    hasBearingAccuracy: Boolean,
    bearingAccuracy: Float,
    elapsedRealtimeNanos: Long,
): GuideFixPayload = GuideFixPayload(
    lat = lat,
    lng = lng,
    accuracy = if (hasAccuracy) accuracy.toDouble() else -1.0,
    speed = if (hasSpeed) speed.toDouble() else null,
    speedAccuracy = if (hasSpeedAccuracy) speedAccuracy.toDouble() else null,
    course = if (hasBearing) bearing.toDouble() else -1.0,
    courseAccuracy = if (hasBearingAccuracy) bearingAccuracy.toDouble() else -1.0,
    elapsedRealtimeMs = elapsedRealtimeNanos / 1_000_000,
)

package space.dodoplanet.gildongmu.kit

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * 경로 종점 → 목적지 오프셋 기하 — 웹 `src/lib/final-approach.ts` ↔ Kit `FinalApproach.swift`
 * 1:1 미러. 공유 fixture `final-approach-scenarios.json`이 동조를 강제한다.
 * **정적 계산이라 GPS와 무관하다.**
 */

/** 이 미만이면 방향을 주장하지 않는다 — 좌표 반올림 ±5.5m에서 방위가 뒤집힌다. */
const val offsetMinMeters = 10.0

/** 종점 진행 방위를 평균할 역방향 창(m). */
const val bearingWindowMeters = 15.0

/**
 * 도착 확정 반경(m)이자 수치 없이 "목적지 근처"라고만 말하는 반경. 두 이름을 두지 않는 이유는
 * spec이 둘을 같은 15m로 정했고 이름이 갈리면 드리프트가 생기기 때문이다. 실보행 판정 전까지 동결.
 */
const val finalApproachArriveMeters = 15.0

/** 최종 접근 주기 통지 간격(초). 동결. */
const val finalApproachIntervalSeconds = 15.0

enum class BearingUnavailable { tooClose, degenerateGeometry;
    val rawValue: String get() = name
    companion object { fun fromRawValue(raw: String): BearingUnavailable? = entries.firstOrNull { it.name == raw } }
}

enum class RelativeDirection { ahead, left, right, behind;
    val rawValue: String get() = name
}

data class FinalApproachGeometry(
    val offsetMeters: Double,
    val relativeBearing: Double?,
    val bearingUnavailable: BearingUnavailable?,
)

/** 4분할 경계 소유권. **부등호까지 계약이다**(웹 `relativeDirection` 미러). */
fun relativeDirection(theta: Double): RelativeDirection {
    val a = abs(theta)
    if (a <= 45) return RelativeDirection.ahead
    if (a <= 135) return if (theta > 0) RelativeDirection.right else RelativeDirection.left
    return RelativeDirection.behind
}

fun computeFinalApproach(route: GuideRoute, dest: RoutePoint): FinalApproachGeometry? {
    val points = route.polyline.points
    val cum = route.polyline.cum
    if (points.size < 2) return null
    val end = points[points.size - 1]
    val offset = haversineMeters(end.lat, end.lng, dest.lat, dest.lng)
    if (!offset.isFinite()) return null

    if (offset < offsetMinMeters) {
        return FinalApproachGeometry(offset, null, BearingUnavailable.tooClose)
    }

    // 종점에서 역방향 bearingWindowMeters 창의 길이 가중 단위벡터 합.
    // ⚠ 각도를 산술 평균하지 않는다(+179/-179 → 0°로 뒤집힘).
    // ⚠ 창에 걸치는 세그먼트는 **겹치는 길이만** 가중치로 쓴다.
    val total = cum[cum.size - 1]
    val from = maxOf(0.0, total - bearingWindowMeters)
    var sx = 0.0
    var sy = 0.0
    var i = points.size - 1
    while (i > 0) {
        val d0 = cum[i - 1]
        val d1 = cum[i]
        if (d1 <= from) break // 창보다 앞선 세그먼트 — 누적이라 더 볼 것이 없다
        val weight = d1 - maxOf(d0, from)
        if (weight > 0) {
            val theta = bearingDegrees(
                points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng,
            ) * PI / 180
            sx += weight * cos(theta)
            sy += weight * sin(theta)
        }
        i -= 1
    }
    if (sqrt(sx * sx + sy * sy) < 1e-9) {
        return FinalApproachGeometry(offset, null, BearingUnavailable.degenerateGeometry)
    }
    val heading = (atan2(sy, sx) * 180 / PI + 360) % 360
    val toDest = bearingDegrees(end.lat, end.lng, dest.lat, dest.lng)
    val rel = (toDest - heading + 540) % 360 - 180
    return FinalApproachGeometry(offset, rel, null)
}

// ── 도착 추정(잊힌 세션 정리) — 공유 fixture `presumed-arrival-scenarios.json` ──

/** 진행 관측 앵커 이탈 하한(m). 직전 fix 비교 금지 — 저속 연속 보행이 제자리로 오판된다. */
const val progressEpsilonMeters = 10.0

/**
 * 도착 추정 임계 프로파일(수단별, 웹 `PresumedArrivalThresholds` 미러). 값은 전부 잠정 —
 * 실보행·실주행 재판정. `presumedArrivalStep`의 필수 인자라 수단을 생략할 수 없다.
 */
data class PresumedArrivalThresholds(
    /** usable fix 두절이 이만큼 지속되면 실내(지하) 진입으로 간주. */
    val noFixSeconds: Double,
    /** usable fix는 오는데 무진행이 이만큼 지속되면 고정 좌표로 간주. */
    val stationarySeconds: Double,
    /** 마지막 확인 거리 캡(m). 이 밖은 이탈이지 도착이 아니다. */
    val maxDistanceMeters: Double,
) {
    companion object {
        /** 도보: 건물 진입 뒤 wifi 측위가 드문드문 이어지는 180초, 오프셋 상한 89m + GPS 여유 150m. */
        val walk = PresumedArrivalThresholds(noFixSeconds = 180.0, stationarySeconds = 300.0, maxDistanceMeters = 150.0)

        /** 자동차: 지하 주차장 진입은 fix가 끊기는 순간 운전이 끝나므로 두절 120초. 도보와 같은 값도 별 프로파일에. */
        val car = PresumedArrivalThresholds(noFixSeconds = 120.0, stationarySeconds = 300.0, maxDistanceMeters = 150.0)
    }
}

enum class PresumedArrivalReason { noFix, stationary;
    val rawValue: String get() = name
}

private fun finiteNonNegative(x: Double): Boolean = x.isFinite() && x >= 0

/**
 * 도착 추정 판정. 판정 순서(국면 → 거리 캡 → noFix → stationary)까지 계약이다 — 국면 게이트가
 * 경로 중간 자동 종료 금지의 1선 방어다. `inFinalApproach` = 도착 창 안인가.
 */
fun presumedArrivalStep(
    inFinalApproach: Boolean,
    secondsSinceUsableFix: Double,
    secondsSinceProgress: Double,
    lastKnownDistanceToDestMeters: Double?,
    thresholds: PresumedArrivalThresholds,
): PresumedArrivalReason? {
    if (!inFinalApproach) return null
    if (!finiteNonNegative(secondsSinceUsableFix) || !finiteNonNegative(secondsSinceProgress)) return null
    val dist = lastKnownDistanceToDestMeters ?: return null
    if (!finiteNonNegative(dist) || dist > thresholds.maxDistanceMeters) return null
    if (secondsSinceUsableFix >= thresholds.noFixSeconds) return PresumedArrivalReason.noFix
    if (secondsSinceProgress >= thresholds.stationarySeconds) return PresumedArrivalReason.stationary
    return null
}

/** `advanceProgressAnchor` 결과(Swift 튜플 `(anchor, progressed)` 대응). */
data class ProgressAnchorStep(val anchor: RoutePoint, val progressed: Boolean)

/**
 * 진행 관측 앵커 전진. **직전 fix가 아니라 앵커 기준 누적 변위**다 — 직전 비교는 1m/s 연속
 * 보행을 5분 300m 걷고도 제자리로 오판한다.
 */
fun advanceProgressAnchor(
    anchor: RoutePoint?,
    fix: RoutePoint,
    epsilonMeters: Double = progressEpsilonMeters,
): ProgressAnchorStep {
    if (anchor == null) return ProgressAnchorStep(fix, false)
    val moved = haversineMeters(anchor.lat, anchor.lng, fix.lat, fix.lng)
    if (moved >= epsilonMeters) return ProgressAnchorStep(fix, true)
    return ProgressAnchorStep(anchor, false)
}

// ── 간략 창 자격 — 공유 fixture `brief-arrival-window-cases.json` ──

/**
 * 간략 창 정확도 상한(m). `carArrivalMaxAccuracyMeters`(GUIDE `CarArrival`)와 같은 뜻의 같은 값 —
 * GUIDE 이식 뒤 그 동일을 단언하는 테스트를 `CarArrivalTest`에 둔다.
 */
const val briefArrivalWindowMaxAccuracyMeters = 30.0

data class BriefArrivalWindowStep(val active: Boolean, val entered: Boolean, val exited: Boolean)

/**
 * 복합 술어(래치 ∧ 정확도 ≤ 30)의 이전·이후 값으로 진입·이탈을 정한다. 자격 없는 fix는 "무시"가
 * 아니라 "창 밖"이다. ≤0·NaN 정확도는 자격 없음.
 */
fun briefArrivalWindowStep(active: Boolean, nearby: Boolean, accuracy: Double): BriefArrivalWindowStep {
    val qualifies = nearby && accuracy > 0 && accuracy <= briefArrivalWindowMaxAccuracyMeters
    return BriefArrivalWindowStep(active = qualifies, entered = qualifies && !active, exited = !qualifies && active)
}

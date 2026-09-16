package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sqrt

/**
 * 도보 경로 기하: 폴리라인 조립·검증·투영(순수). 웹 정본 `src/lib/route-geometry.ts` ↔ Kit
 * `RouteGeometry.swift`의 1:1 미러. 공유 fixture `route-guide-scenarios.json`이 동조를 강제한다.
 *
 * ⚠ 전역 최근접 매칭 금지 — 경로가 자기 자신과 12m까지 근접해 엉뚱한 스텝을 고른다.
 * 호출자는 창을 구속하고, 전역 탐색은 후보 목록으로만 받는다.
 */

/** 40m 미만 스텝은 GPS 자동 판정 대상이 아니다: 25m 미만 구간 21%·도심 오차 7~13m. */
const val longStepMinMeters = 40.0

/** 스텝 이음매 허용 간격. 실측 0.00m지만 보증이 아니라 응답마다 검증한다. */
const val seamToleranceMeters = 5.0

/** 경로 기하 좌표 한 점(WGS84 십진). 서버 `pathCoords` 원소와 동형. */
@Serializable
data class RoutePoint(val lat: Double, val lng: Double)

data class GuidePolyline(
    val points: List<RoutePoint>,
    /** cum[i] = 시작점→points[i] 누적 미터. */
    val cum: List<Double>,
)

data class GuideStepSpan(
    val index: Int,
    val description: String,
    val startD: Double,
    val endD: Double,
    val isLong: Boolean,
    /** 서버 투영 결정 행동(자동차 `turnType` → `CarAction`). 도보 스텝엔 없다. */
    val action: WalkAction? = null,
)

data class GuideRoute(
    val polyline: GuidePolyline,
    val steps: List<GuideStepSpan>,
    val totalMeters: Double,
    /** 경유지에서 시작하는 스텝의 index(서버 `waypoint.stepIndex`). null = 경유지 없는 경로. */
    val waypointStepIndex: Int?,
)

data class GuideProjection(
    /** 경로 시작 기준 진행거리(m). */
    val d: Double,
    /** 폴리라인까지 수직거리(m). */
    val perpMeters: Double,
)

/** buildGuideRoute 입력(스텝 문장 + 기하). WalkRouteStep에서 투영해 만든다. */
data class GuideStepGeometry(
    val description: String,
    val pathCoords: List<RoutePoint>?,
    /** 서버 투영 결정 행동(자동차 전용). 도보는 null. */
    val action: WalkAction? = null,
)

/**
 * 스텝 기하를 하나의 연속 폴리라인 + 스텝 스팬으로 조립한다. 검증 실패는 null — 소비자는
 * 상세 부적격으로 간략 폴백한다(fail-closed). `waypointStepIndex`가 범위 `0 until steps.size`
 * 밖이면 null(0은 유효).
 */
fun buildGuideRoute(steps: List<GuideStepGeometry>, waypointStepIndex: Int? = null): GuideRoute? {
    if (waypointStepIndex != null && waypointStepIndex !in steps.indices) return null
    if (steps.isEmpty()) return null
    val points = ArrayList<RoutePoint>()
    val cum = ArrayList<Double>()
    val spans = ArrayList<GuideStepSpan>()
    var d = 0.0
    for ((i, step) in steps.withIndex()) {
        val pc = step.pathCoords
        if (pc.isNullOrEmpty() || !pc.all { it.lat.isFinite() && it.lng.isFinite() }) return null
        val startD = d
        for ((j, p) in pc.withIndex()) {
            if (points.isEmpty()) {
                points.add(p)
                cum.add(0.0)
                continue
            }
            val prev = points[points.size - 1]
            val seg = haversineMeters(prev.lat, prev.lng, p.lat, p.lng)
            // 스텝 첫 점은 직전 스텝 끝점과 이어져야 한다(이음매 검증).
            if (j == 0 && seg > seamToleranceMeters) return null
            if (seg == 0.0) continue // 중복점 제거
            d += seg
            points.add(p)
            cum.add(d)
        }
        // 직전 스텝 끝점과 동일한 좌표 1점뿐인 중간 스텝(0-길이 지시)은 거부한다(fail-closed).
        if (d - startD <= 0 && i > 0 && pc.size < 2) return null
        spans.add(
            GuideStepSpan(
                index = i,
                description = step.description,
                startD = startD,
                endD = d,
                isLong = d - startD >= longStepMinMeters,
                action = step.action,
            ),
        )
    }
    if (points.size < 2 || d <= 0) return null
    return GuideRoute(GuidePolyline(points, cum), spans, d, waypointStepIndex)
}

/** 위경도를 기준점(ref) 주변 로컬 평면(m)으로 변환. */
private fun toLocal(ref: RoutePoint, p: RoutePoint): Pair<Double, Double> {
    val y = (p.lat - ref.lat) * 111_320
    val x = (p.lng - ref.lng) * 111_320 * cos(ref.lat * PI / 180)
    return x to y
}

/**
 * [fromD, toD] 창 안에서 p의 최근접 투영. 창과 겹치는 세그먼트가 없으면 null.
 * ⚠ perp는 세그먼트 기하 최근접(창 클램프 전) 기준 — 클램프 후 지점까지의 거리로 재면
 * 전방 진행이 "수직 이탈"과 구분되지 않는다(웹 정본 동일 계약).
 */
fun projectOnPolyline(poly: GuidePolyline, p: RoutePoint, fromD: Double, toD: Double): GuideProjection? {
    var best: GuideProjection? = null
    for (i in 0 until poly.points.size - 1) {
        val d0 = poly.cum[i]
        val d1 = poly.cum[i + 1]
        if (d1 < fromD || d0 > toD || d1 == d0) continue
        val (ax, ay) = toLocal(p, poly.points[i])
        val (bx, by) = toLocal(p, poly.points[i + 1])
        val abx = bx - ax
        val aby = by - ay
        val len2 = abx * abx + aby * aby
        var t = if (len2 == 0.0) 0.0 else (-ax * abx - ay * aby) / len2
        t = maxOf(0.0, minOf(1.0, t))
        val px = ax + abx * t
        val py = ay + aby * t
        val perp = sqrt(px * px + py * py)
        val dd = maxOf(fromD, minOf(toD, d0 + (d1 - d0) * t))
        if (best == null || perp < best.perpMeters) best = GuideProjection(dd, perp)
    }
    return best
}

/** 세그먼트 i 단독 투영(t는 [0,1]만 클램프 — 창 없음). */
private fun projectOnSegment(poly: GuidePolyline, i: Int, p: RoutePoint): GuideProjection {
    val (ax, ay) = toLocal(p, poly.points[i])
    val (bx, by) = toLocal(p, poly.points[i + 1])
    val abx = bx - ax
    val aby = by - ay
    val len2 = abx * abx + aby * aby
    var t = if (len2 == 0.0) 0.0 else (-ax * abx - ay * aby) / len2
    t = maxOf(0.0, minOf(1.0, t))
    val px = ax + abx * t
    val py = ay + aby * t
    return GuideProjection(
        d = poly.cum[i] + (poly.cum[i + 1] - poly.cum[i]) * t,
        perpMeters = sqrt(px * px + py * py),
    )
}

/**
 * 전역 후보(국소 최소점들): perp ≤ maxPerp 후보를 진행거리 30m 간격으로 병합. 후보가 복수면
 * 호출자는 위치를 확정하지 말아야 한다. ⚠ 창 기반 projectOnPolyline 재사용 금지 — 인접
 * 세그먼트의 기하 최근접이 경계 클램프 d로 끌려 들어와 유령 후보를 만든다.
 */
fun globalCandidates(poly: GuidePolyline, p: RoutePoint, maxPerp: Double): List<GuideProjection> {
    val raw = ArrayList<GuideProjection>()
    for (i in 0 until poly.points.size - 1) {
        val pr = projectOnSegment(poly, i, p)
        if (pr.perpMeters <= maxPerp) raw.add(pr)
    }
    raw.sortBy { it.d }
    val merged = ArrayList<GuideProjection>()
    for (c in raw) {
        val last = merged.lastOrNull()
        if (last != null && c.d - last.d < 30) {
            if (c.perpMeters < last.perpMeters) merged[merged.size - 1] = c
        } else {
            merged.add(c)
        }
    }
    return merged
}

/**
 * 진행거리 `d` 지점의 경로 접선 방위(진북 기준 도, `[0,360)`). 앞뒤 `halfMeters`의 두 점을
 * 잇는 방위라 폴리라인 정점 노이즈를 평활한다. ⚠ 두 점이 같으면 null이다(0도로 접으면
 * "북쪽"이라는 거짓 정보가 된다).
 */
fun tangentAt(poly: GuidePolyline, d: Double, halfMeters: Double): Double? {
    val total = poly.cum.lastOrNull() ?: return null
    if (total <= 0) return null
    val a = pointAtD(poly, maxOf(0.0, d - halfMeters)) ?: return null
    val b = pointAtD(poly, minOf(total, d + halfMeters)) ?: return null
    val lat0 = a.lat * PI / 180
    val dx = (b.lng - a.lng) * cos(lat0)
    val dy = b.lat - a.lat
    if (dx == 0.0 && dy == 0.0) return null
    return (atan2(dx, dy) * 180 / PI + 360) % 360
}

/** 진행거리 `d` 지점의 좌표. 범위 밖은 끝점으로 물린다. */
private fun pointAtD(poly: GuidePolyline, d: Double): RoutePoint? {
    if (poly.points.isEmpty()) return null
    if (poly.points.size == 1) return poly.points[0]
    val dd = maxOf(0.0, minOf(d, poly.cum[poly.cum.size - 1]))
    for (i in 0 until poly.points.size - 1) {
        if (poly.cum[i] <= dd && dd <= poly.cum[i + 1]) {
            val seg = poly.cum[i + 1] - poly.cum[i]
            val t = if (seg == 0.0) 0.0 else (dd - poly.cum[i]) / seg
            return RoutePoint(
                lat = poly.points[i].lat + t * (poly.points[i + 1].lat - poly.points[i].lat),
                lng = poly.points[i].lng + t * (poly.points[i + 1].lng - poly.points[i].lng),
            )
        }
    }
    return poly.points[poly.points.size - 1]
}

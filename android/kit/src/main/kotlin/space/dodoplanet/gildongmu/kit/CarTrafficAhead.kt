package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.models.CarJam
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

// 주행 중 "앞으로 지날 구간에 새로 생긴 정체" 판정(E80 spec `docs/superpowers/specs/2026-11-07-e80-car-traffic-design.md` §5).
// Kit `CarTrafficAhead.swift`·웹 `src/lib/car-traffic-ahead.ts`의 1:1 미러, 공유 fixture `src/lib/__tests__/fixtures/car-jams-ahead-cases.json`.
//
// 재조회 응답은 지금 위치에서 다시 찾은 경로라 지금 안내 중인 경로와 다를 수 있다. 그래서 정체를 좌표로 받아 지금 경로에
// 투영한다 — 둘 다 경로 위(`carJamOnRouteMeters` 안)이고 시작이 지금 진행거리보다 앞일 때만 "내가 지날 구간"이다. 이미 아는
// 정체와 겹치면 새것이 아니다. 아는 정체도 좌표로 보관해 판정 때마다 다시 투영한다(재경로 뒤에도 유효).

/** 정체 좌표가 안내 경로 위로 인정되는 수직거리(m). 웹 `JAM_ON_ROUTE_M` 미러. */
const val carJamOnRouteMeters = 40.0

/**
 * 투영 구간 길이와 정체 길이의 허용 차(m)·비율. 웹 `JAM_LENGTH_TOLERANCE_M`·`JAM_LENGTH_TOLERANCE_RATIO` 미러 —
 * 양 끝만 경로 위인 우회로 정체를 내 앞 정체로 말하지 않는다.
 */
const val carJamLengthToleranceMeters = 150.0
const val carJamLengthToleranceRatio = 0.25

/** 아는 정체(좌표만). */
@Serializable
data class KnownCarJam(val start: RoutePoint, val end: RoutePoint)

/** 알릴 정체 하나와 지금 위치에서 정체 시작까지(m). */
data class CarJamAhead(val jam: CarJam, val aheadMeters: Int)

data class NewCarJamsAhead(
    /** 알릴 정체(가장 가까운 하나). 없으면 null. */
    val nearest: CarJamAhead?,
    /** 알린 뒤의 아는 정체 = 입력 + `nearest` 하나(먼 새 정체는 다음 재조회가 말한다). 호출부는 실제로 말했을 때만 채택한다. */
    val known: List<KnownCarJam>,
)

private fun jamInterval(poly: GuidePolyline, start: RoutePoint, end: RoutePoint, fromD: Double, toD: Double): Pair<Double, Double>? {
    val s = projectOnPolyline(poly, start, fromD, toD) ?: return null
    val e = projectOnPolyline(poly, end, fromD, toD) ?: return null
    if (s.perpMeters > carJamOnRouteMeters || e.perpMeters > carJamOnRouteMeters || e.d <= s.d) return null
    return s.d to e.d
}

/** 웹 `newJamsAhead` 미러. `d`는 지금 진행거리(m). */
fun newCarJamsAhead(polyline: GuidePolyline, totalMeters: Double, d: Double, known: List<KnownCarJam>, fresh: List<CarJam>): NewCarJamsAhead {
    val knownIntervals = known.mapNotNull { jamInterval(polyline, it.start, it.end, 0.0, totalMeters) }
    val added = mutableListOf<Pair<CarJam, Double>>()
    for (jam in fresh) {
        // 시작이 지금 진행거리보다 앞이 아니면 지나갔거나 이미 그 안이다(창 클램프로 s == d가 된다).
        val iv = jamInterval(polyline, jam.start, jam.end, d, totalMeters) ?: continue
        if (iv.first <= d) continue
        val tolerance = max(carJamLengthToleranceMeters, jam.lengthMeters * carJamLengthToleranceRatio)
        if (abs(iv.second - iv.first - jam.lengthMeters) > tolerance) continue
        if (knownIntervals.any { iv.first < it.second && it.first < iv.second }) continue
        added += jam to iv.first
    }
    // 안정 정렬(같은 시작이면 응답 순서) — Kotlin `sortedBy`는 안정이다(웹 Array.sort·Kit 오프셋 정렬 동형).
    val first = added.sortedBy { it.second }.firstOrNull() ?: return NewCarJamsAhead(null, known)
    return NewCarJamsAhead(
        CarJamAhead(first.first, (first.second - d).roundToInt()),
        known + KnownCarJam(first.first.start, first.first.end),
    )
}

package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.CarRouteBriefing
import kotlin.math.abs

/**
 * 자동차 안내 기하 조립(B1 스펙 §5) — 웹 `src/lib/car-route-guide.ts` ↔ Kit `CarRouteGuide.swift` 미러.
 *
 * fail-closed: 어느 guide든 기하가 결손이면 부분 조립 없이 전체 null이다. 부분 상세는 중간부터 틀린 도로에 스냅해 이탈
 * 판정이 영영 못 잡는 거짓 안내가 된다. 이음매·0-길이 검증은 `buildGuideRoute`가 두 번째 층으로 다시 본다.
 *
 * 도로명 스팬은 별도 축: 링크 길이 누적 합이 경로 총거리와 5% 이상 어긋나면 도로명 기능만 강등(빈 목록)하고 경로 안내는
 * 유지한다. (디코딩 모델 `CarRouteGuide`는 FOUNDATION `models/RouteModels.kt`에 있다 — 이 파일은 조립 함수만 든다.)
 */

/** 도로명 스팬 — 진행거리 [startD, endD) 구간의 도로명(무명 링크는 null). */
data class CarRoadSpan(val name: String?, val startD: Double, val endD: Double)

data class CarGuideData(val route: GuideRoute, val roadSpans: List<CarRoadSpan>)

private const val roadSpanToleranceRatio = 0.05

/** 종점 마커와 마지막 스텝 끝의 허용 어긋남(m) — 이음매 허용치와 같은 수준. */
private const val terminalToleranceMeters = 5.0

fun buildCarGuide(briefing: CarRouteBriefing): CarGuideData? {
    val guides = briefing.guides
    if (guides.isEmpty()) return null
    // fail-closed: 기하 결손 guide가 하나라도 있으면 전체 부적격.
    for (g in guides) {
        val coords = g.pathCoords
        if (coords == null || coords.size < 2) return null
        if (coords.any { !it.lat.isFinite() || !it.lng.isFinite() }) return null
    }
    // 전 구간 커버리지(§5): 마지막 스텝 끝 = 종점 마커(어긋나면 짧은 조립 — 부적격).
    val terminal = briefing.terminalCoord
    val lastEnd = guides.last().pathCoords?.lastOrNull()
    if (terminal != null && lastEnd != null &&
        haversineMeters(lastEnd.lat, lastEnd.lng, terminal.lat, terminal.lng) > terminalToleranceMeters
    ) {
        return null
    }

    val route = buildGuideRoute(
        // 결정 행동(K2 §2.3) — 임박 큐·하단 2행이 문장 대신 읽는다.
        guides.map { GuideStepGeometry(it.guidance, it.pathCoords, it.action?.guideAction) },
        waypointStepIndex = briefing.waypoint?.stepIndex,
    ) ?: return null

    // 도로명 스팬: 링크 길이를 경로 진행거리 축에 누적한다.
    val links = guides.flatMap { it.roadLinks ?: emptyList() }
    var acc = 0.0
    val roadSpans = ArrayList<CarRoadSpan>()
    for (link in links) {
        if (!link.distanceMeters.isFinite() || !(link.distanceMeters >= 0)) return CarGuideData(route, emptyList())
        roadSpans.add(CarRoadSpan(link.name, acc, acc + link.distanceMeters))
        acc += link.distanceMeters
    }
    // 누적 합이 총거리와 5% 이상 어긋나면 도로명 강등(경로 안내는 유지).
    if (roadSpans.isEmpty() || abs(acc - route.totalMeters) > route.totalMeters * roadSpanToleranceRatio) {
        return CarGuideData(route, emptyList())
    }
    return CarGuideData(route, roadSpans)
}

/** 진행거리 d가 속한 스팬의 도로명. 무명 스팬·빈 스팬·범위 밖은 null. */
fun roadNameAt(spans: List<CarRoadSpan>, d: Double): String? {
    spans.firstOrNull { d >= it.startD && d < it.endD }?.let { return it.name }
    // 종점 등호 경계: 마지막 스팬의 끝은 마지막 스팬 소속으로 본다.
    val last = spans.lastOrNull()
    if (last != null && d == last.endD) return last.name
    return null
}

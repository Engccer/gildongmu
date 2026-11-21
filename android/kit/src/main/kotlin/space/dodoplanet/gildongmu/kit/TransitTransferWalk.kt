package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.TransitLegStop

// === 환승 도보 인계 판정 (E73, spec 2026-10-19-e73-transfer-walk-design.md §2) — 순수, Kit `TransitTransferWalk.swift` 미러 ===
//
// 탑승 구간 사이의 도보를 승차 전 도보(A25)와 같은 도보 실시간 안내로 돌린다.

/**
 * 탑승 구간 `legIndex` 앞 도보를 걷기 안내로 돌릴 대상. null = 지금처럼 문장만(맨 앞 구간·도보 없음·정보 결손·30m 미만).
 *
 * 조건은 A25(`transitPrewalkTarget`) 그대로에 거리 하나를 더한다: 앞 구간 하차 지점 ↔ 이 구간 승차 지점의 **직선**이
 * `JourneyTuning.accessWalkMinMeters` 이상. 앞 구간 하차 좌표가 없거나 무효면 거리를 건너뛰고 대상으로 본다 — 분 ≥ 1이면
 * 경로 제공자가 걷기를 냈다(빠진 안내보다 군더더기).
 */
fun transitTransferWalkTarget(route: TransitGuideRoute, legIndex: Int): TransitPrewalkTarget? {
    if (legIndex < 1 || legIndex !in route.legs.indices) return null
    val leg = route.legs[legIndex]
    // A25 검사를 다시 쓰지 않는다 — 그 구간 하나를 넣어 같은 조건(분 ≥ 1, 승차 좌표 유효)을 지난다.
    val target = transitPrewalkTarget(TransitGuideRoute(legs = listOf(leg), walkAfterMinutes = null)) ?: return null
    val meters = transitTransferWalkMeters(route, legIndex)
    if (meters != null && !transferWalkDistanceQualifies(meters)) return null
    return target
}

/** 문턱 비교 한 자리 — "30m 이상"(하버사인으로는 정확히 30.0을 만들 수 없어 경계를 이 함수로 직접 시험한다). */
internal fun transferWalkDistanceQualifies(meters: Double): Boolean = meters >= JourneyTuning.accessWalkMinMeters

/**
 * 앞 구간 하차 지점 ↔ 구간 `legIndex` 승차 지점의 직선 거리(m). 어느 한쪽 좌표가 없거나 무효면 null. 판정과 진단 로그가 같은
 * 값을 읽는다.
 */
fun transitTransferWalkMeters(route: TransitGuideRoute, legIndex: Int): Double? {
    if (legIndex < 1 || legIndex !in route.legs.indices) return null
    val from = route.legs[legIndex - 1].alightStop?.takeIf { isUsableStopCoord(it) } ?: return null
    val to = route.legs[legIndex].boardStop?.takeIf { isUsableStopCoord(it) } ?: return null
    return haversineMeters(lat1 = from.lat, lng1 = from.lng, lat2 = to.lat, lng2 = to.lng)
}

/**
 * 도보를 안내로 소비한 뒤의 경로 — `legs[legIndex].walkBeforeMinutes`만 null(`withoutPrewalk`의 일반화). 대기 문맥·조망·다음
 * 구간 안내가 같은 필드를 읽으므로 한 곳에서 지운다. 범위 밖이면 원본 그대로.
 */
fun withoutWalkBefore(route: TransitGuideRoute, legIndex: Int): TransitGuideRoute {
    if (legIndex !in route.legs.indices) return route
    // 필드 복사는 `withoutPrewalk` 한 곳에만 둔다(필드가 늘 때 두 벌이 갈라지지 않게).
    val stripped = withoutPrewalk(TransitGuideRoute(legs = listOf(route.legs[legIndex]), walkAfterMinutes = null)).legs[0]
    val legs = route.legs.toMutableList()
    legs[legIndex] = stripped
    return TransitGuideRoute(legs = legs, walkAfterMinutes = route.walkAfterMinutes)
}

/**
 * 구간 `legIndex`의 대기 국면에서 시작하는 새 세션 상태(환승 도보 뒤 재개). 경로 전체를 들어 구간 순번·조망이 이어진다. 국면·신호는
 * `handleAdvance`가 다음 구간에 주는 값과 같고, 세션 카운터는 새 세션이라 0에서 시작한다. 범위 밖이면 0번 구간.
 */
fun initTransitGuide(route: TransitGuideRoute, startingAt: Int, now: Double): TransitGuideState {
    val state = initTransitGuide(route = route, now = now)
    if (startingAt <= 0 || startingAt !in route.legs.indices) return state
    return state.copy(
        legIndex = startingAt,
        signal = if (route.legs[startingAt].trackMode != null) TransitSignal.notYetVisible else TransitSignal.untrackable,
    )
}

private fun isUsableStopCoord(stop: TransitLegStop): Boolean =
    stop.lat.isFinite() && stop.lng.isFinite() && !(stop.lat == 0.0 && stop.lng == 0.0)

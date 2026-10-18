import Foundation

// === 환승 도보 인계 판정 (E73, spec 2026-10-19-e73-transfer-walk-design.md §2) — 순수 ===
//
// 탑승 구간 사이의 도보를 승차 전 도보(A25)와 같은 도보 실시간 안내로 돌린다. 웹 기준본이 아직 없다(웹은 iOS 실승차 판정
// 뒤 같은 규칙을 들인다, spec D13) — 그때 공유 fixture와 함께 미러한다. 등록부 `android/kit/mirrors/guide.json`은 pending.

/// 탑승 구간 `legIndex` 앞 도보를 걷기 안내로 돌릴 대상. nil = 지금처럼 문장만(맨 앞 구간·도보 없음·정보 결손·30m 미만).
///
/// 조건은 A25(`transitPrewalkTarget`) 그대로에 거리 하나를 더한다: 앞 구간 하차 지점 ↔ 이 구간 승차 지점의 **직선**이
/// `JourneyTuning.accessWalkMinMeters`(E70 D6 접근 도보와 같은 상수·같은 척도) 이상. 앞 구간 하차 좌표가 없거나 무효면
/// 거리를 건너뛰고 대상으로 본다 — 분 ≥ 1이면 경로 제공자가 걷기를 냈다(빠진 안내보다 군더더기, D6 측위 실패 갈래와 같은 방향).
public func transitTransferWalkTarget(_ route: TransitGuideRoute, legIndex: Int) -> TransitPrewalkTarget? {
    guard legIndex >= 1, route.legs.indices.contains(legIndex) else { return nil }
    let leg = route.legs[legIndex]
    // A25 검사를 다시 쓰지 않는다 — 그 구간 하나를 넣어 같은 조건(분 ≥ 1, 승차 좌표 유효)을 지난다.
    guard let target = transitPrewalkTarget(TransitGuideRoute(legs: [leg], walkAfterMinutes: nil)) else { return nil }
    if let meters = transitTransferWalkMeters(route, legIndex: legIndex) {
        guard meters >= JourneyTuning.accessWalkMinMeters else { return nil }
    }
    return target
}

/// 앞 구간 하차 지점 ↔ 구간 `legIndex` 승차 지점의 직선 거리(m). 어느 한쪽 좌표가 없거나 무효면 nil.
/// 판정(`transitTransferWalkTarget`)과 진단 로그(실승차 판정 재료 — 문턱에서 얼마나 떨어졌는가)가 같은 값을 읽는다.
public func transitTransferWalkMeters(_ route: TransitGuideRoute, legIndex: Int) -> Double? {
    guard legIndex >= 1, route.legs.indices.contains(legIndex),
          let from = route.legs[legIndex - 1].alightStop, isUsableStopCoord(from),
          let to = route.legs[legIndex].boardStop, isUsableStopCoord(to) else { return nil }
    return haversineMeters(lat1: from.lat, lng1: from.lng, lat2: to.lat, lng2: to.lng)
}

/// 도보를 안내로 소비한 뒤의 경로 — `legs[legIndex].walkBeforeMinutes`만 nil(`withoutPrewalk`의 일반화, 0이면 같다).
/// 대기 문맥·조망·다음 구간 안내가 같은 필드를 읽으므로 한 곳에서 지운다. 범위 밖이면 원본 그대로.
public func withoutWalkBefore(_ route: TransitGuideRoute, legIndex: Int) -> TransitGuideRoute {
    guard route.legs.indices.contains(legIndex) else { return route }
    // 필드 복사는 `withoutPrewalk` 한 곳에만 둔다(필드가 늘 때 두 벌이 갈라지지 않게).
    let stripped = withoutPrewalk(TransitGuideRoute(legs: [route.legs[legIndex]], walkAfterMinutes: nil)).legs[0]
    var legs = route.legs
    legs[legIndex] = stripped
    return TransitGuideRoute(legs: legs, walkAfterMinutes: route.walkAfterMinutes)
}

/// 구간 `legIndex`의 대기 국면에서 시작하는 새 세션 상태(환승 도보 뒤 재개). 경로 전체를 들어 구간 순번·조망이 이어진다.
/// 국면·신호는 `handleAdvance`가 다음 구간에 주는 값과 같고, 세션 카운터(폴 순번·세대)는 새 세션이라 0에서 시작한다.
/// 범위 밖이면 0번 구간(`initTransitGuide`와 같다).
public func initTransitGuide(route: TransitGuideRoute, startingAt legIndex: Int, now: Double) -> TransitGuideState {
    var state = initTransitGuide(route: route, now: now)
    guard legIndex > 0, route.legs.indices.contains(legIndex) else { return state }
    state.legIndex = legIndex
    state.signal = route.legs[legIndex].trackMode != nil ? .notYetVisible : .untrackable
    return state
}

private func isUsableStopCoord(_ stop: TransitLegStop) -> Bool {
    stop.lat.isFinite && stop.lng.isFinite && !(stop.lat == 0 && stop.lng == 0)
}

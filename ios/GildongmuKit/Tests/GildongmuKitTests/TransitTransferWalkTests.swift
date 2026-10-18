import Foundation
import Testing
@testable import GildongmuKit

// E73 환승 도보 인계 판정(spec 2026-10-19-e73-transfer-walk-design.md §2·§4). 좌표는 합성이다.

private let origin = (lat: 37.5, lng: 127.0)
/// 위도 1도 ≈ 111,195m(Geo.swift 지구 반지름 6,371,008.8m) — 북쪽으로 `m`미터 떨어진 위도.
private func north(_ m: Double) -> Double { origin.lat + m / (6_371_008.8 * Double.pi / 180) }

private func leg(
    _ mode: String = "bus", board: TransitLegStop?, alight: TransitLegStop?, walk: Int?,
    trackMode: TransitTrackMode? = .seoulBus
) -> TransitGuideLeg {
    TransitGuideLeg(
        mode: mode, lineName: mode == "bus" ? "100" : "수도권 1호선", trackMode: trackMode,
        boardName: board?.name ?? "승차", alightName: alight?.name ?? "하차",
        boardStop: board, alightStop: alight, viaStops: [board, alight].compactMap { $0 },
        stationCount: 3, routeId: nil, wayCode: nil, walkBeforeMinutes: walk, quickExit: nil)
}

private func twoLegRoute(gapMeters: Double, walk: Int? = 1, alight: TransitLegStop? = nil) -> TransitGuideRoute {
    let firstAlight = alight ?? TransitLegStop(name: "가 정류장", lat: origin.lat, lng: origin.lng)
    return TransitGuideRoute(legs: [
        leg(board: TransitLegStop(name: "출발", lat: 37.4, lng: 127.0), alight: firstAlight, walk: nil),
        leg("subway", board: TransitLegStop(name: "나역", lat: north(gapMeters), lng: origin.lng),
            alight: TransitLegStop(name: "다역", lat: 37.6, lng: 127.0), walk: walk, trackMode: .subway),
    ], walkAfterMinutes: 2)
}

@Test func transferWalkTargetAtThirtyMetersNotBelow() {
    #expect(transitTransferWalkTarget(twoLegRoute(gapMeters: 29.9), legIndex: 1) == nil)
    let target = transitTransferWalkTarget(twoLegRoute(gapMeters: 30.1), legIndex: 1)
    #expect(target?.name == "나역")
    #expect(target?.minutes == 1)
    // 상수는 E70 D6과 하나다.
    #expect(JourneyTuning.accessWalkMinMeters == 30)
}

/// "30m 이상" — 정확히 30.0은 대상, 바로 아래 값은 아니다(`>`로 바뀌면 깨진다).
@Test func transferWalkDistanceIncludesExactlyThirtyMeters() {
    #expect(transferWalkDistanceQualifies(30.0))
    #expect(!transferWalkDistanceQualifies(30.0.nextDown))
}

@Test func transferWalkMetersIsStraightLineOrNil() {
    let route = twoLegRoute(gapMeters: 85)
    #expect(abs((transitTransferWalkMeters(route, legIndex: 1) ?? 0) - 85) < 0.01)
    #expect(transitTransferWalkMeters(route, legIndex: 0) == nil)
    #expect(transitTransferWalkMeters(route, legIndex: 2) == nil)
    let island = twoLegRoute(gapMeters: 85, alight: TransitLegStop(name: "y", lat: 0, lng: 0))
    #expect(transitTransferWalkMeters(island, legIndex: 1) == nil)
}

@Test func transferWalkTargetEqualsPrewalkTargetOfThatLeg() {
    let route = twoLegRoute(gapMeters: 85, walk: 2)
    #expect(transitTransferWalkTarget(route, legIndex: 1)
        == transitPrewalkTarget(TransitGuideRoute(legs: [route.legs[1]], walkAfterMinutes: nil)))
}

@Test func transferWalkTargetRejectsFirstLegAndOutOfRange() {
    let route = twoLegRoute(gapMeters: 85)
    #expect(transitTransferWalkTarget(route, legIndex: 0) == nil)  // 맨 앞 도보는 A25 몫
    #expect(transitTransferWalkTarget(route, legIndex: 2) == nil)
    #expect(transitTransferWalkTarget(route, legIndex: -1) == nil)
}

@Test func transferWalkTargetFollowsPrewalkConditions() {
    #expect(transitTransferWalkTarget(twoLegRoute(gapMeters: 85, walk: nil), legIndex: 1) == nil)
    #expect(transitTransferWalkTarget(twoLegRoute(gapMeters: 85, walk: 0), legIndex: 1) == nil)
    let base = twoLegRoute(gapMeters: 85)
    for bad in [TransitLegStop(name: "x", lat: 0, lng: 0), TransitLegStop(name: "x", lat: .nan, lng: 127)] {
        let route = TransitGuideRoute(
            legs: [base.legs[0], leg("subway", board: bad, alight: base.legs[1].alightStop, walk: 1)],
            walkAfterMinutes: nil)
        #expect(transitTransferWalkTarget(route, legIndex: 1) == nil)
    }
}

@Test func transferWalkTargetSkipsDistanceWhenPreviousAlightUnknown() {
    // 앞 구간 하차 좌표가 없거나 무효면 거리를 잴 수 없다 — 분 ≥ 1이면 대상(빠진 안내보다 군더더기).
    let base = twoLegRoute(gapMeters: 5)
    let missing = TransitGuideRoute(
        legs: [leg(board: base.legs[0].boardStop, alight: nil, walk: nil), base.legs[1]], walkAfterMinutes: nil)
    #expect(transitTransferWalkTarget(missing, legIndex: 1)?.name == "나역")
    let island = twoLegRoute(gapMeters: 5, alight: TransitLegStop(name: "y", lat: 0, lng: 0))
    #expect(transitTransferWalkTarget(island, legIndex: 1)?.name == "나역")
}

@Test func withoutWalkBeforeClearsOnlyThatLegAndKeepsOriginal() {
    let route = TransitGuideRoute(legs: [
        leg(board: nil, alight: nil, walk: 3), leg(board: nil, alight: nil, walk: 2), leg(board: nil, alight: nil, walk: 4),
    ], walkAfterMinutes: 5)
    let out = withoutWalkBefore(route, legIndex: 1)
    #expect(out.legs.map(\.walkBeforeMinutes) == [3, nil, 4])
    #expect(out.walkAfterMinutes == 5)
    #expect(route.legs[1].walkBeforeMinutes == 2)  // 원본 불변
    #expect(withoutWalkBefore(route, legIndex: 0).legs.map(\.walkBeforeMinutes)
        == withoutPrewalk(route).legs.map(\.walkBeforeMinutes))
    #expect(withoutWalkBefore(route, legIndex: 3).legs.map(\.walkBeforeMinutes) == [3, 2, 4])
}

@Test func initTransitGuideStartingAtLegIsThatLegsWaitingPhase() {
    let route = TransitGuideRoute(legs: [
        leg(board: nil, alight: nil, walk: nil),
        leg("bus", board: nil, alight: nil, walk: 1, trackMode: nil),
        leg("subway", board: nil, alight: nil, walk: nil, trackMode: .subway),
    ], walkAfterMinutes: nil)
    let untracked = initTransitGuide(route: route, startingAt: 1, now: 0)
    #expect(untracked.legIndex == 1 && untracked.phase == .waiting && untracked.signal == .untrackable)
    #expect(untracked.lastSeq == 0 && untracked.phaseGen == 0 && untracked.pollCount == 0)
    let tracked = initTransitGuide(route: route, startingAt: 2, now: 0)
    #expect(tracked.legIndex == 2 && tracked.signal == .notYetVisible)
    // 다음 구간 전진이 주는 국면·신호와 같다(handleAdvance).
    var arrived = initTransitGuide(route: route, now: 0)
    arrived.phase = .arrived
    let advanced = transitGuideStep(state: arrived, input: .advance, route: route, now: 0).state
    #expect(advanced.legIndex == untracked.legIndex && advanced.phase == untracked.phase
        && advanced.signal == untracked.signal)
    // 범위 밖은 0번 구간.
    #expect(initTransitGuide(route: route, startingAt: 9, now: 0).legIndex == 0)
}

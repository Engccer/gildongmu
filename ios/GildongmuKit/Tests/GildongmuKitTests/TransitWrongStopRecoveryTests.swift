import Foundation
import Testing
@testable import GildongmuKit

// E78 잘못 내림 복구 판정(spec 2026-11-07-e78-wrong-stop-recovery-design.md §3·§5·§8). 좌표는 합성이다.

private func leg(_ mode: String = "bus", trackMode: TransitTrackMode?) -> TransitGuideLeg {
    let board = TransitLegStop(name: "가", lat: 37.5, lng: 127.0)
    let alight = TransitLegStop(name: "나", lat: 37.51, lng: 127.0)
    return TransitGuideLeg(
        mode: mode, lineName: mode == "bus" ? "100" : "수도권 2호선", trackMode: trackMode,
        boardName: "가", alightName: "나", boardStop: board, alightStop: alight, viaStops: [board, alight],
        stationCount: 1, routeId: nil, wayCode: nil, walkBeforeMinutes: nil, quickExit: nil)
}

private func route(_ legs: [TransitGuideLeg]) -> TransitGuideRoute {
    TransitGuideRoute(legs: legs, walkAfterMinutes: nil)
}

@Test func recoveryOfferedOnlyRidingOrArrivedOutsideJourney() {
    #expect(transitRecoveryOffered(phase: .riding, inJourney: false))
    #expect(transitRecoveryOffered(phase: .arrived, inJourney: false))
    for phase in [TransitPhase.waiting, .boarding, .done] {
        #expect(!transitRecoveryOffered(phase: phase, inJourney: false), "\(phase)")
    }
    // 여정 단계는 국면과 무관하게 세우지 않는다(§5-3).
    #expect(!transitRecoveryOffered(phase: .riding, inJourney: true))
    #expect(!transitRecoveryOffered(phase: .arrived, inJourney: true))
}

@Test func recoveryOriginAsksStationOnlyForSubway() {
    #expect(transitRecoveryOrigin(leg("subway", trackMode: .subway)) == .askStation)
    // 추적 불가 지하철(비수도권)도 땅속이다 — 수단으로 가른다.
    #expect(transitRecoveryOrigin(leg("subway", trackMode: nil)) == .askStation)
    #expect(transitRecoveryOrigin(leg("bus", trackMode: .seoulBus)) == .deviceFix)
    #expect(transitRecoveryOrigin(leg("bus", trackMode: .tagoBus)) == .deviceFix)
}

@Test func guidableRequiresEveryLegTrackable() {
    #expect(transitRouteGuidable(route([leg(trackMode: .seoulBus), leg("subway", trackMode: .subway)])))
    #expect(transitRouteGuidable(route([leg(trackMode: .tagoBus)])))
    #expect(!transitRouteGuidable(route([leg(trackMode: .seoulBus), leg("subway", trackMode: nil)])))
    #expect(!transitRouteGuidable(route([])))
}

@Test func pickSkipsUnguidableAndUnbuildableInOrder() {
    let good = route([leg(trackMode: .seoulBus)])
    let bad = route([leg("subway", trackMode: nil)])
    #expect(transitRecoveryPickIndex([good, bad]) == 0)
    // 추천이 안내 불가면 말없이 다음 후보(§3.3).
    #expect(transitRecoveryPickIndex([bad, nil, good]) == 2)
    // 후보는 있으나 안내 가능 0 — 조회 0건과 다른 상태(§8-2).
    #expect(transitRecoveryPickIndex([bad, nil]) == nil)
    #expect(transitRecoveryPickIndex([]) == nil)
}

@Test func recoveryRouteFromResultFollowsRecommendedThenAlternatives() {
    func transitRoute(_ key: String, _ legs: [TransitRouteLeg]) -> TransitRoute {
        TransitRoute(
            summary: TransitRouteSummary(
                totalMinutes: 20, fare: 1500, transfers: 0, walkMinutes: 0, departName: nil, arriveName: nil),
            legs: legs, routeKey: key)
    }
    func busLeg(line: String?) -> TransitRouteLeg {
        TransitRouteLeg(
            mode: "bus", lineName: line, fromName: "가", toName: "나", stationCount: 1, minutes: 5,
            serviceStatus: nil, firstServiceTime: nil, lastServiceTime: nil,
            stops: [TransitLegStop(name: "가", lat: 37.5, lng: 127.0), TransitLegStop(name: "나", lat: 37.51, lng: 127.0)])
    }
    // 노선 이름 없는 버스 구간은 추적 불가로 분류된다(`classifyTransitTrackMode`) — 추천이 그 경로면 대안으로 넘어간다.
    let unguidable = transitRoute("r0", [busLeg(line: nil)])
    let guidable = transitRoute("r1", [busLeg(line: "100")])
    #expect(buildTransitGuideRoute(unguidable).map(transitRouteGuidable) == false)
    let result = TransitRouteResult(recommended: unguidable, alternatives: [guidable], totalCandidates: 2)
    #expect(transitRecoveryRoute(result)?.routeKey == "r1")
    #expect(transitRecoveryRoute(TransitRouteResult(
        recommended: guidable, alternatives: [unguidable], totalCandidates: 2))?.routeKey == "r1")
    #expect(transitRecoveryRoute(TransitRouteResult(
        recommended: unguidable, alternatives: [], totalCandidates: 1)) == nil)
}

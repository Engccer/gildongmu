import Foundation
import Testing
@testable import GildongmuKit

/// E15-2 주변 확인 앵커 판정(spec 2026-08-23-transit-surroundings-anchor §2·§6).
private func stop(_ name: String, _ lat: Double, _ lng: Double) -> TransitLegStop {
    TransitLegStop(name: name, lat: lat, lng: lng)
}

private func leg(trackMode: TransitTrackMode?, stops: [TransitLegStop]) -> TransitGuideLeg {
    TransitGuideLeg(
        mode: trackMode == .subway ? "subway" : "bus", lineName: "2호선", trackMode: trackMode,
        boardName: stops.first?.name ?? "", alightName: stops.last?.name ?? "",
        boardStop: stops.first, alightStop: stops.count > 1 ? stops.last : nil,
        viaStops: stops, stationCount: nil, routeId: nil, wayCode: nil, walkBeforeMinutes: nil)
}

private let subwayStops = [
    stop("강동", 37.535, 127.132), stop("천호", 37.538, 127.123), stop("광나루", 37.545, 127.103),
]

private func state(_ l: TransitGuideLeg, phase: TransitPhase, signal: TransitSignal, current: String?) -> TransitGuideState {
    var s = initTransitGuide(route: TransitGuideRoute(legs: [l], walkAfterMinutes: nil), now: 0)
    s.phase = phase
    s.signal = signal
    s.currentLocation = current
    return s
}

@Test func anchorIsCurrentStationOnlyWhenOverviewHereIsStation() {
    let l = leg(trackMode: .subway, stops: subwayStops)
    let a = transitSurroundingsAnchor(state: state(l, phase: .riding, signal: .tracking, current: "천호"), leg: l)
    #expect(a == .currentStation(subwayStops[1]))
}

@Test func ambiguousStationNameFallsBackToAlight() {
    let loop = [stop("성수", 37.544, 127.056), stop("뚝섬", 37.547, 127.047), stop("성수", 37.544, 127.056)]
    let l = leg(trackMode: .subway, stops: loop)
    let a = transitSurroundingsAnchor(state: state(l, phase: .riding, signal: .tracking, current: "성수"), leg: l)
    #expect(a == .alightStop(loop[2]))
}

@Test func waitingUsesAlightStop() {
    let l = leg(trackMode: .subway, stops: subwayStops)
    let a = transitSurroundingsAnchor(state: state(l, phase: .waiting, signal: .tracking, current: "천호"), leg: l)
    #expect(a == .alightStop(subwayStops[2]))
}

@Test func busRidingUsesAlightStop() {
    let l = leg(trackMode: .seoulBus, stops: subwayStops)
    let a = transitSurroundingsAnchor(state: state(l, phase: .riding, signal: .tracking, current: "천호"), leg: l)
    #expect(a == .alightStop(subwayStops[2]))
}

@Test func signalLostUsesAlightStop() {
    let l = leg(trackMode: .subway, stops: subwayStops)
    let a = transitSurroundingsAnchor(state: state(l, phase: .riding, signal: .signalLost, current: "천호"), leg: l)
    #expect(a == .alightStop(subwayStops[2]))
}

@Test func noAlightStopMeansNoAnchor() {
    let l = leg(trackMode: .subway, stops: [stop("강동", 37.535, 127.132)])
    let a = transitSurroundingsAnchor(state: state(l, phase: .waiting, signal: .tracking, current: nil), leg: l)
    #expect(a == nil)
}

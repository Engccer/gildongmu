import Foundation
import Testing

@testable import GildongmuKit

// MARK: - A32 도착 한 줄의 현재역 꼬리 — 웹과 같은 공유 fixture(`subway-arrival-tail-cases.json`)

private func fixtureURL(_ name: String) -> URL {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/\(name)")
    return url
}

private struct TailCase: Decodable {
    let name: String
    let message: String?
    let currentLocation: String?
    let expect: Bool
}

@Test func currentLocationTailMatchesSharedFixture() throws {
    struct File: Decodable { let cases: [TailCase] }
    let file = try JSONDecoder().decode(File.self, from: Data(contentsOf: fixtureURL("subway-arrival-tail-cases.json")))
    #expect(file.cases.count >= 20)
    for c in file.cases {
        let got = subwayShowsCurrentLocationTail(message: c.message, currentLocation: c.currentLocation)
        #expect(got == c.expect, "\(c.name): \(String(describing: c.message)) / \(String(describing: c.currentLocation))")
    }
}

/// 실패 방향이 현행(붙이는 쪽)인지 — 미지 문법이 들어와도 정보가 사라지지 않는다.
@Test func unknownGrammarKeepsTail() {
    #expect(subwayShowsCurrentLocationTail(message: "우리가 모르는 새 문장", currentLocation: "강일"))
}

/// 문장이 현재역을 담으면 꼬리는 빠진다 — 같은 역이 한 접근성 객체에서 두 번 낭독되던 자리.
@Test func containedStationDropsTail() {
    #expect(!subwayShowsCurrentLocationTail(message: "6분 후 (강일)", currentLocation: "강일"))
}

// MARK: - E37 완성 문장 → 우리 문장 — 웹과 같은 공유 fixture(`subway-arrival-prose-cases.json`)

private struct ProseCase: Decodable {
    let name: String
    let message: String?
    let currentLocation: String?
    let expect: ExpectedPlan?
    let keys: ExpectedKeys?

    struct ExpectedPlan: Decodable {
        let kind: String
        let verb: String?
        let station: String?
        let count: Int?
        let minutes: Int?
        let seconds: Int?
        let stops: Int?
        let nowAt: String?
    }

    struct ExpectedKeys: Decodable {
        let joined: [String]
        let tail: String?
    }
}

private func describe(_ plan: SubwayArrivalPlan?) -> String {
    guard let plan else { return "nil" }
    switch plan {
    case let .stationEvent(verb, station): return "stationEvent(\(verb.rawValue),\(station))"
    case let .prevStationEvent(verb, station): return "prevStationEvent(\(verb.rawValue),\(station))"
    case let .departedStopsBack(count): return "departedStopsBack(\(count))"
    case let .stopsAway(count, station): return "stopsAway(\(count),\(station))"
    case let .eta(m, s, stops, nowAt):
        return "eta(\(m as Int?),\(s as Int?),\(stops as Int?),\(nowAt ?? "nil"))"
    }
}

private func expected(_ e: ProseCase.ExpectedPlan) -> SubwayArrivalPlan? {
    switch e.kind {
    case "stationEvent":
        guard let v = e.verb.flatMap(SubwayArrivalVerb.init(rawValue:)), let s = e.station else { return nil }
        return .stationEvent(verb: v, station: s)
    case "prevStationEvent":
        guard let v = e.verb.flatMap(SubwayArrivalVerb.init(rawValue:)), let s = e.station else { return nil }
        return .prevStationEvent(verb: v, station: s)
    case "departedStopsBack":
        guard let c = e.count else { return nil }
        return .departedStopsBack(count: c)
    case "stopsAway":
        guard let c = e.count, let s = e.station else { return nil }
        return .stopsAway(count: c, station: s)
    case "eta":
        return .eta(minutes: e.minutes, seconds: e.seconds, stops: e.stops, nowAt: e.nowAt)
    default:
        return nil
    }
}

@Test func arrivalProseMatchesSharedFixture() throws {
    struct File: Decodable { let cases: [ProseCase] }
    let file = try JSONDecoder().decode(File.self, from: Data(contentsOf: fixtureURL("subway-arrival-prose-cases.json")))
    #expect(file.cases.count >= 40)
    for c in file.cases {
        let got = subwayArrivalProse(message: c.message, currentLocation: c.currentLocation)
        let want = c.expect.flatMap(expected)
        #expect(got == want, "\(c.name): \(describe(got)) ≠ \(describe(want))")
        // 키 선택도 웹과 한 표다 — 같은 계획에서 서로 다른 문장을 고르면 두 플랫폼이 갈린다.
        guard let got, let keys = c.keys else {
            #expect(c.keys == nil || got != nil, "\(c.name): 원문 경로인데 keys가 있다")
            continue
        }
        let segs = subwayArrivalProseSegments(got, station: subwayArrivalPlanStation(got))
        #expect(segs.joined.map(\.key) == keys.joined, "\(c.name): joined 키")
        #expect(segs.tail?.key == keys.tail, "\(c.name): tail 키")
    }
}

/// 위치를 신뢰할 수 없는 두 문법은 역명을 어디에도 싣지 않는다 — 실으면 없는 곳을 현재 위치로 낭독한다.
@Test func untrustedLocationGrammarsCarryNoStation() {
    for (message, location) in [("강일 전역출발", "강일"), ("전전역 출발", "미사")] {
        let plan = subwayArrivalProse(message: message, currentLocation: location)
        #expect(plan != nil, "\(message)")
        #expect(subwayArrivalPlanStation(plan!) == nil, "\(message)")
        let segs = subwayArrivalProseSegments(plan!, station: nil)
        #expect(segs.joined.allSatisfy { !$0.args.contains(location) }, "\(message)")
        #expect(segs.tail == nil, "\(message)")
    }
}

/// `{무엇} 도착` 모양은 역명이 아닌 말도 통과시킨다 — 현재역 값과 같을 때만 당역 문법으로 읽는다.
@Test func stationEventNeedsMatchingCurrentLocation() {
    #expect(subwayArrivalProse(message: "곧 도착", currentLocation: nil) == nil)
    #expect(subwayArrivalProse(message: "곧 도착", currentLocation: "강일") == nil)
    #expect(subwayArrivalProse(message: "서울 도착", currentLocation: "서울") != nil)
}

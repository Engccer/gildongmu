import Foundation
import Testing
@testable import GildongmuKit

/// 안내 문장 descriptor 공유 fixture(E27 잔여 ①) — 웹 `transit-guide-text.test.ts`와 같은 파일.
private struct TextFixture: Decodable {
    struct Case: Decodable {
        let name: String
        let fn: String
        let isEn: Bool
        let expect: TransitTextLine
        let leg: TransitDisplayLeg?
        let item: TransitDisplayItem?
        let message: TransitLabel?
        let arrivalCode: String?
        let desc: TransitLabel?
        let location: TransitLabel?
        let station: TransitLabel?
        let stop: TransitLabel?
        let role: String?
        let here: Bool?
        let isCurrentLeg: Bool?
        let express: String?
        let exit: String?
        let departedMinutes: Int?
        let minutes: Int?
        let n: Int?
        let line: TransitLabel?
        let board: TransitLabel?
        let alight: TransitLabel?
    }
    let cases: [Case]
}

private func loadTextFixture() throws -> TextFixture {
    let url = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("src/lib/__tests__/fixtures/transit-guide-text-cases.json")
    return try JSONDecoder().decode(TextFixture.self, from: Data(contentsOf: url))
}

private func run(_ c: TextFixture.Case) -> TransitTextLine {
    let e = c.isEn
    switch c.fn {
    case "waitContext":
        return transitWaitContextLine(isEn: e, leg: c.leg!, isCurrentLeg: c.isCurrentLeg!)
    case "boardingContext": return transitBoardingContextLine(isEn: e, leg: c.leg!)
    case "context": return transitContextLine(isEn: e, leg: c.leg!)
    case "frame":
        return transitFrameLine(isEn: e, leg: c.leg!, message: c.message!, arrivalCode: c.arrivalCode)
    case "approachFrame":
        return transitApproachFrameLine(isEn: e, leg: c.leg!, message: c.message!)
    case "vehicleSelected": return transitVehicleSelectedLine(isEn: e, leg: c.leg!, desc: c.desc)
    case "selectedVehicle": return transitSelectedVehicleLine(isEn: e, desc: c.desc!)
    case "vehiclePassed": return transitVehiclePassedLine(isEn: e, leg: c.leg!)
    case "arrivedAtBoardStop": return transitArrivedAtBoardStopLine(isEn: e, leg: c.leg!)
    case "boarded": return transitBoardedLine(isEn: e, leg: c.leg!)
    case "currentStation": return transitCurrentStationLine(isEn: e, location: c.location!)
    case "candidateDesc":
        return transitCandidateDescLine(
            isEn: e, leg: c.leg!, item: c.item!, express: c.express.flatMap(TransitExpressVerdict.init(rawValue:)),
            departedMinutes: c.departedMinutes)
    case "vehicleDesc": return transitVehicleDescLine(isEn: e, item: c.item!)
    case "terminatesEarly": return transitTerminatesEarlyLine(isEn: e, leg: c.leg!, item: c.item!)
    case "expressSkipsAlight": return transitExpressSkipsAlightLine(isEn: e, leg: c.leg!)
    case "exitBound": return transitExitBoundLine(isEn: e, exit: c.exit!)
    case "viaStop": return transitViaStopLine(isEn: e, stop: c.stop!, role: c.role!, here: c.here!, exit: c.exit)
    case "overviewLeg":
        return transitOverviewLegLine(
            isEn: e, n: c.n!, line: c.line!, board: c.board!, alight: c.alight!)
    case "prewalkStart":
        return transitPrewalkStartLine(isEn: e, station: c.station!, minutes: c.minutes!)
    case "prewalkArrived": return transitPrewalkArrivedLine(isEn: e, station: c.station!)
    case "prewalkArrivedButton":
        return transitPrewalkArrivedButtonLine(isEn: e, station: c.station!)
    default:
        Issue.record("미지 fn: \(c.fn)")
        return TransitTextLine(parts: [], lang: "ko")
    }
}

@Test func transitGuideTextMatchesSharedFixture() throws {
    let fixture = try loadTextFixture()
    // ⚠ 케이스 0건이면 아래 루프가 공허하게 통과한다(경로 오타가 "합격"으로 위장) — 수를 먼저 본다.
    #expect(fixture.cases.count > 20)
    for c in fixture.cases {
        #expect(run(c) == c.expect, "\(c.name)")
    }
}

/// 발화 sentinel 불변식(E27 spec §3.7) — en 케이스의 어떤 조각에도 조인 토큰이 나오면 안 된다.
@Test func transitGuideTextNeverLeaksJoinSentinel() throws {
    let fixture = try loadTextFixture()
    let enCases = fixture.cases.filter { $0.isEn && $0.expect.lang == "en" }
    #expect(enCases.count > 10)
    for c in enCases {
        for part in run(c).parts {
            let text = (part.text ?? "") + (part.args ?? []).joined(separator: " ")
            #expect(!text.contains("ᛥ"), "\(c.name)")
        }
    }
}

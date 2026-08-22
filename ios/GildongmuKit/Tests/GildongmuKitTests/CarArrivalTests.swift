import Foundation
import Testing
@testable import GildongmuKit

private struct CaseFile: Decodable {
    let cases: [Case]
    struct Case: Decodable {
        let distance: Double
        let accuracy: Double
        let motion: String
        let expect: Bool
        let note: String
    }
}

private func motionFrom(_ s: String) -> MotionState {
    switch s {
    case "stopped": .stopped
    case "moving": .moving
    default: .speedUnknown
    }
}

@Test func carArrivalSharedTable() throws {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/car-arrival-cases.json")
    let cases = try JSONDecoder().decode(CaseFile.self, from: Data(contentsOf: url)).cases
    #expect(cases.count >= 6)
    for c in cases {
        #expect(
            carArrivalStep(distance: c.distance, accuracy: c.accuracy, motion: motionFrom(c.motion)) == c.expect,
            Comment(rawValue: c.note))
    }
}

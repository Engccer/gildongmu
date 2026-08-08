import Foundation
import Testing

@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/course-axis-scenarios.json`)를
/// 레포 상대 경로로 직접 읽어 같은 경계표를 단언한다(사본 금지 — 사본을 두면 갈리고,
/// 갈리면 가드가 통과하면서 두 플랫폼이 다르게 동작한다. RouteGuideTests 선례 동형).
private struct VoteCase: Decodable {
    let name: String
    let course: Double
    let courseAcc: Double
    let d: Double
    let fixAcc: Double
    let expect: String
}

private struct VerdictCase: Decodable {
    let name: String
    let votes: [[VoteEntry]]
    let expect: String

    /// fixture의 `["mismatch", 0]`은 문자열·숫자가 섞인 배열이라 항목마다 갈라 읽는다.
    enum VoteEntry: Decodable {
        case text(String)
        case number(Double)
        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let s = try? c.decode(String.self) {
                self = .text(s)
            } else {
                self = .number(try c.decode(Double.self))
            }
        }
    }
}

private struct Scenarios: Decodable {
    let votes: [VoteCase]
    let verdicts: [VerdictCase]
}

/// 남 → 북 직선 200m (접선은 어디서나 0도).
private let straight: GuideRoute = buildGuideRoute([
    GuideStepGeometry(
        description: "북진",
        pathCoords: [
            RoutePoint(lat: 37.5, lng: 127.1),
            RoutePoint(lat: 37.5 + 200 / 111_320, lng: 127.1),
        ]
    )
])!

private func loadScenarios() throws -> Scenarios {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() } // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/course-axis-scenarios.json")
    return try JSONDecoder().decode(Scenarios.self, from: Data(contentsOf: url))
}

@Suite("방위 축 (웹 공유 fixture 동조)")
struct GuideCourseAxisTests {
    @Test("공유 fixture 표결 — 웹과 같은 판정")
    func voteMatchesWebFixture() throws {
        for c in try loadScenarios().votes {
            let got = courseVote(
                CourseObservation(state: .valid(course: c.course), accuracyDeg: c.courseAcc),
                poly: straight.polyline, d: c.d, fixAccuracy: c.fixAcc
            )
            #expect(got.rawValue == c.expect, "\(c.name): got \(got.rawValue) want \(c.expect)")
        }
    }

    @Test("공유 fixture 판정 — 웹과 같은 verdict")
    func verdictMatchesWebFixture() throws {
        for c in try loadScenarios().verdicts {
            var samples: [CourseVoteSample] = []
            for pair in c.votes {
                guard case let .text(v) = pair[0], case let .number(at) = pair[1] else { continue }
                samples.append(CourseVoteSample(at: at, vote: CourseVote(rawValue: v)!))
            }
            let got = courseAxisVerdict(samples)
            #expect(got.rawValue == c.expect, "\(c.name): got \(got.rawValue) want \(c.expect)")
        }
    }

    @Test("비활성 관측은 축을 끈다")
    func inactiveObservationDisablesAxis() {
        #expect(
            courseVote(inactiveCourse, poly: straight.polyline, d: 100, fixAccuracy: 10)
                == .unknown
        )
    }
}

import Foundation
import Testing

@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/course-axis-scenarios.json`)를
/// 레포 상대 경로로 직접 읽어 같은 경계표를 단언한다(사본 금지 — 사본을 두면 갈리고,
/// 갈리면 가드가 통과하면서 두 플랫폼이 다르게 동작한다. RouteGuideTests 선례 동형).
private struct VoteCase: Decodable {
    let name: String
    let bearing: Double?
    let uncertainty: Double
    let d: Double
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
        let votes = try loadScenarios().votes
        // ⚠ 공회전 방지: 키 이름이 바뀌거나 배열이 비면 루프가 0회 돌고 조용히 통과한다.
        #expect(votes.count >= 7)
        for c in votes {
            let obs = c.bearing.map { DerivedCourse(bearing: $0, uncertaintyDeg: c.uncertainty) }
            let got = courseVote(obs, poly: straight.polyline, d: c.d)
            #expect(got.rawValue == c.expect, "\(c.name): got \(got.rawValue) want \(c.expect)")
        }
    }

    @Test("공유 fixture 판정 — 웹과 같은 verdict")
    func verdictMatchesWebFixture() throws {
        let verdicts = try loadScenarios().verdicts
        #expect(verdicts.count >= 11)
        for c in verdicts {
            var samples: [CourseVoteSample] = []
            for pair in c.votes {
                // ⚠ 어긋난 쌍을 건너뛰지 않는다 — 건너뛰면 fixture가 망가져도 남은
                //   케이스로 통과해, 표가 실제로 무엇을 단언했는지 알 수 없게 된다.
                guard case let .text(v) = pair[0], case let .number(at) = pair[1],
                    let vote = CourseVote(rawValue: v)
                else {
                    Issue.record("\(c.name): fixture 표 형식이 어긋남 \(pair)")
                    continue
                }
                samples.append(CourseVoteSample(at: at, vote: vote))
            }
            let got = courseAxisVerdict(samples)
            #expect(got.rawValue == c.expect, "\(c.name): got \(got.rawValue) want \(c.expect)")
        }
    }

    @Test("관측 없음은 unknown이다")
    func nilObservationIsUnknown() {
        #expect(courseVote(nil, poly: straight.polyline, d: 100) == .unknown)
    }
}

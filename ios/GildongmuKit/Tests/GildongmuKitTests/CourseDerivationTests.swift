import Foundation
import Testing

@testable import GildongmuKit

/// 유도기 산술 동조: 웹 정본과 같은 공유 fixture(`course-axis-scenarios.json`)의
/// `derivation` 배열을 재생해 마지막으로 방출된 관측을 같은 허용오차로 단언한다
/// (사본 금지 — GuideCourseAxisTests 선례 동형).
private struct DerivationFixCase: Decodable {
    let lat: Double
    let lng: Double
    let at: Double
}

private struct DerivationExpect: Decodable {
    let bearingMin: Double
    let bearingMax: Double
    let uMin: Double
    let uMax: Double
}

private struct DerivationCase: Decodable {
    let name: String
    let fixes: [DerivationFixCase]
    let expect: DerivationExpect?
}

private struct Scenarios: Decodable {
    let derivation: [DerivationCase]
}

private func loadScenarios() throws -> Scenarios {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() } // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/course-axis-scenarios.json")
    return try JSONDecoder().decode(Scenarios.self, from: Data(contentsOf: url))
}

@Suite("방위 유도기 (웹 공유 fixture 동조)")
struct CourseDerivationTests {
    @Test("공유 fixture derivation — 웹과 같은 관측")
    func derivationMatchesWebFixture() throws {
        let cases = try loadScenarios().derivation
        // ⚠ 공회전 방지: 배열이 비면 루프가 0회 돌고 조용히 통과한다.
        #expect(cases.count >= 3)
        for c in cases {
            var state = initialDerivationState
            var last: DerivedCourse?
            for f in c.fixes {
                let r = deriveCourse(state, lat: f.lat, lng: f.lng, at: f.at)
                state = r.state
                if let obs = r.obs { last = obs }
            }
            guard let expect = c.expect else {
                #expect(last == nil, "\(c.name): 관측이 없어야 한다")
                continue
            }
            guard let last else {
                Issue.record("\(c.name): 관측이 있어야 한다")
                continue
            }
            let norm = (last.bearing + 540).truncatingRemainder(dividingBy: 360) - 180
            #expect(norm >= expect.bearingMin && norm <= expect.bearingMax,
                    "\(c.name): bearing \(norm)")
            #expect(last.uncertaintyDeg >= expect.uMin && last.uncertaintyDeg <= expect.uMax,
                    "\(c.name): U \(last.uncertaintyDeg)")
        }
    }

    // 이하 3건은 웹 course-derivation.test.ts 단위 케이스의 미러(fixture 밖 계약).
    private let mLat = 1.0 / 111_320.0
    private let baseLat = 37.5365
    private let baseLng = 127.1469

    private func northFix(_ n: Double) -> (lat: Double, lng: Double) {
        (baseLat + n * mLat, baseLng)
    }

    @Test("전진 게이트: 직전 방출 지점에서 2m 미만이면 표를 내지 않는다")
    func advanceGate() {
        var state = initialDerivationState
        var results: [DerivedCourse?] = []
        for i in 0...12 {
            let p = northFix(Double(i))
            let r = deriveCourse(state, lat: p.lat, lng: p.lng, at: Double(i))
            state = r.state
            results.append(r.obs)
        }
        for (n, at) in [(12.5, 13.0), (14.5, 14.0)] {
            let p = northFix(n)
            let r = deriveCourse(state, lat: p.lat, lng: p.lng, at: at)
            state = r.state
            results.append(r.obs)
        }
        #expect(results[11] != nil) // 첫 방출(chord ≈ 11m ≥ 기저선)
        #expect(results[12] == nil) // 1m 전진 — 게이트
        #expect(results[13] == nil) // 1.5m 전진 — 게이트
        #expect(results[14] != nil) // 3.5m 전진 — 통과
    }

    @Test("기저선이 age 상한을 넘으면 관측·버퍼가 함께 사라진다")
    func ageCutoff() {
        var state = initialDerivationState
        for i in 0...12 {
            let p = northFix(Double(i))
            state = deriveCourse(state, lat: p.lat, lng: p.lng, at: Double(i)).state
        }
        let p = northFix(12)
        let r = deriveCourse(state, lat: p.lat, lng: p.lng, at: 50) // 38초 정지
        #expect(r.obs == nil)
        #expect(r.state.fixes.count == 1)
    }

    @Test("같은 timestamp 중복 fix는 교체한다")
    func duplicateTimestampReplaces() {
        var state = initialDerivationState
        for (n, at) in [(0.0, 0.0), (1.0, 1.0), (1.2, 1.0)] {
            let p = northFix(n)
            state = deriveCourse(state, lat: p.lat, lng: p.lng, at: at).state
        }
        #expect(state.fixes.count == 2)
    }
}

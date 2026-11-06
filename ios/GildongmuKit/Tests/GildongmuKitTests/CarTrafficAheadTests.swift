import Foundation
import Testing
@testable import GildongmuKit

/// 웹 `car-traffic-ahead.test.ts`와 같은 공유 fixture(`car-jams-ahead-cases.json`)로 같은 판정표를 단언한다(E80 §5).
private struct CarJamsAheadFixture: Decodable {
    struct Poly: Decodable {
        let points: [RoutePoint]
        let cum: [Double]
    }
    struct Case: Decodable {
        let name: String
        let d: Double
        let known: [KnownCarJam]
        let fresh: [CarJam]
        let expect: Expect
        struct Expect: Decodable {
            let nearest: Int?
            let aheadMeters: Int?
            let knownCount: Int
        }
    }
    let polyline: Poly
    let totalMeters: Double
    let cases: [Case]
}

private func loadFixture() throws -> CarJamsAheadFixture {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/car-jams-ahead-cases.json")
    return try JSONDecoder().decode(CarJamsAheadFixture.self, from: Data(contentsOf: url))
}

@Test("새 정체 판정 공유 fixture 동조")
func carJamsAheadMatchesSharedFixture() throws {
    let f = try loadFixture()
    #expect(!f.cases.isEmpty)
    let poly = GuidePolyline(points: f.polyline.points, cum: f.polyline.cum)
    for c in f.cases {
        let out = newCarJamsAhead(polyline: poly, totalMeters: f.totalMeters, d: c.d, known: c.known, fresh: c.fresh)
        if let i = c.expect.nearest {
            #expect(out.nearest?.jam == c.fresh[i], "\(c.name)")
            #expect(out.nearest?.aheadMeters == c.expect.aheadMeters, "\(c.name)")
        } else {
            #expect(out.nearest == nil, "\(c.name)")
        }
        #expect(out.known.count == c.expect.knownCount, "\(c.name)")
    }
}

@Test("같은 응답을 두 번 받으면 두 번째는 알리지 않는다")
func carJamsAheadDoesNotRepeat() throws {
    let f = try loadFixture()
    let poly = GuidePolyline(points: f.polyline.points, cum: f.polyline.cum)
    let fresh = f.cases[0].fresh
    let first = newCarJamsAhead(polyline: poly, totalMeters: f.totalMeters, d: 500, known: [], fresh: fresh)
    let second = newCarJamsAhead(polyline: poly, totalMeters: f.totalMeters, d: 900, known: first.known, fresh: fresh)
    #expect(first.nearest != nil)
    #expect(second.nearest == nil)
}

import Foundation
import Testing
@testable import GildongmuKit

/// 웹 `car-route-guide.test.ts` 미러 — 좌표 규약 동일(위도 1도 ≈ 111,320m 남→북 직선).
private let meterLat = 1.0 / 111_320

private func pt(_ m: Double) -> RoutePoint {
    RoutePoint(lat: 37.5 + m * meterLat, lng: 127.1)
}

private func makeBriefing(
    guides: [CarRouteGuide]? = nil
) -> CarRouteBriefing {
    CarRouteBriefing(
        distanceMeters: 500, durationSeconds: 120, taxiFare: 5000, tollFare: 0,
        guides: guides ?? [
            CarRouteGuide(
                name: "", guidance: "직진 200m 이동", distanceMeters: 0, durationSeconds: 0,
                pathCoords: [pt(0), pt(200)],
                roadLinks: [CarRoadLink(name: "올림픽로", distanceMeters: 200)]
            ),
            CarRouteGuide(
                name: "", guidance: "우회전 후 300m 이동", distanceMeters: 0, durationSeconds: 0,
                pathCoords: [pt(200), pt(350), pt(500)],
                roadLinks: [
                    CarRoadLink(name: "천호대로", distanceMeters: 150),
                    CarRoadLink(name: nil, distanceMeters: 150),
                ]
            ),
        ],
        provider: "tmap"
    )
}

struct CarRouteGuideTests {
    @Test func assemblesRouteAndRoadSpans() {
        let out = buildCarGuide(briefing: makeBriefing())
        #expect(out != nil)
        #expect(out?.route.steps.count == 2)
        #expect(abs((out?.route.totalMeters ?? 0) - 500) < 5)
        #expect(out?.roadSpans == [
            CarRoadSpan(name: "올림픽로", startD: 0, endD: 200),
            CarRoadSpan(name: "천호대로", startD: 200, endD: 350),
            CarRoadSpan(name: nil, startD: 350, endD: 500),
        ])
    }

    @Test func missingGeometryFailsClosed() {
        var guides = makeBriefing().guides
        guides[1] = CarRouteGuide(
            name: "", guidance: guides[1].guidance, distanceMeters: 0, durationSeconds: 0
        )
        #expect(buildCarGuide(briefing: makeBriefing(guides: guides)) == nil)
    }

    @Test func nonFiniteCoordinateFailsClosed() {
        var guides = makeBriefing().guides
        guides[0] = CarRouteGuide(
            name: "", guidance: guides[0].guidance, distanceMeters: 0, durationSeconds: 0,
            pathCoords: [pt(0), RoutePoint(lat: .nan, lng: 127.1)],
            roadLinks: guides[0].roadLinks
        )
        #expect(buildCarGuide(briefing: makeBriefing(guides: guides)) == nil)
    }

    @Test func terminalMarkerMismatchFailsClosed() {
        // 종점 마커가 마지막 스텝 끝과 5m 초과 어긋나면 전체 nil(§5 커버리지, 웹 미러).
        let base = makeBriefing()
        let mismatch = CarRouteBriefing(
            distanceMeters: base.distanceMeters, durationSeconds: base.durationSeconds,
            taxiFare: base.taxiFare, tollFare: base.tollFare,
            guides: base.guides, provider: base.provider, terminalCoord: pt(560)
        )
        #expect(buildCarGuide(briefing: mismatch) == nil)
        let match = CarRouteBriefing(
            distanceMeters: base.distanceMeters, durationSeconds: base.durationSeconds,
            taxiFare: base.taxiFare, tollFare: base.tollFare,
            guides: base.guides, provider: base.provider, terminalCoord: pt(500)
        )
        #expect(buildCarGuide(briefing: match) != nil)
    }

    @Test func roadSpanMismatchDegradesRoadNamesOnly() {
        var guides = makeBriefing().guides
        guides[1] = CarRouteGuide(
            name: "", guidance: guides[1].guidance, distanceMeters: 0, durationSeconds: 0,
            pathCoords: guides[1].pathCoords,
            roadLinks: [CarRoadLink(name: "천호대로", distanceMeters: 30)]
        )
        let out = buildCarGuide(briefing: makeBriefing(guides: guides))
        #expect(out != nil)
        #expect(out?.route.steps.count == 2)
        #expect(out?.roadSpans.isEmpty == true)
    }

    @Test func roadNameAtPicksContainingSpan() {
        let spans = buildCarGuide(briefing: makeBriefing())!.roadSpans
        #expect(roadNameAt(spans: spans, d: 0) == "올림픽로")
        #expect(roadNameAt(spans: spans, d: 199) == "올림픽로")
        #expect(roadNameAt(spans: spans, d: 200) == "천호대로")
        #expect(roadNameAt(spans: spans, d: 400) == nil) // 무명 링크
        #expect(roadNameAt(spans: spans, d: 501) == nil)
        #expect(roadNameAt(spans: [], d: 100) == nil)
    }

    @Test func briefingDecodesWithoutGeometryKeys() throws {
        // 미지정 응답(기하 키 부재)·구버전 서버(provider 부재) 디코딩 호환.
        let json = """
        {"distanceMeters":1000,"durationSeconds":300,"taxiFare":5000,"tollFare":0,
         "guides":[{"name":"","guidance":"직진","distanceMeters":0,"durationSeconds":0}]}
        """
        let b = try JSONDecoder().decode(CarRouteBriefing.self, from: Data(json.utf8))
        #expect(b.provider == nil)
        #expect(b.guides[0].pathCoords == nil)
        #expect(b.guides[0].roadLinks == nil)
    }
}

import Foundation
import Testing
@testable import GildongmuKit

// 나들이 교차로·횡단보도 원천 확장(spec 2026-09-26 §6.6, E58 ①③).

private func fixtureURL(_ name: String) -> URL {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/\(name)")
    return url
}

private let originLat = 37.5
private let originLng = 127.0

/// 원점에서 북·동 미터 오프셋 → 좌표.
private func at(north: Double, east: Double) -> (lat: Double, lng: Double) {
    (originLat + north / 111_320, originLng + east / (111_320 * cos(originLat * .pi / 180)))
}

/// 교차점에서 방위로 25m 간 갈래 점.
private func branch(from j: (lat: Double, lng: Double), bearing: Double, kind: OutingBranchKind) -> OutingBranch {
    let r = bearing * .pi / 180
    return OutingBranch(
        lat: j.lat + 25 * cos(r) / 111_320, lng: j.lng + 25 * sin(r) / (111_320 * cos(j.lat * .pi / 180)), kind: kind)
}

private func junction(
    north: Double, east: Double, _ branches: [(Double, OutingBranchKind)], id: String = "jn:test"
) -> OutingJunction {
    let j = at(north: north, east: east)
    return OutingJunction(id: id, lat: j.lat, lng: j.lng, branches: branches.map { branch(from: j, bearing: $0.0, kind: $0.1) })
}

private func notice(
    _ junctions: [OutingJunction], heading: OutingHeading = .valid(bearing: 0, uncertaintyDeg: 10), accuracy: Double = 5,
    spoken: Set<String> = [], lastNoticeAt: Double? = nil, now: Double = 100
) -> OutingJunctionNotice? {
    outingJunctionNoticeStep(
        junctions: outingJunctionRelations(
            junctions, fixLat: originLat, fixLng: originLng, accuracy: accuracy, heading: heading),
        spoken: spoken, lastNoticeAt: lastNoticeAt, now: now)
}

private func shapeLabel(_ shape: OutingJunctionShape?) -> String? {
    switch shape {
    case .none: nil
    case .side(let side, let alley)?: "\(side.rawValue)\(alley ? "Alley" : "Path")"
    case .cross?: "cross"
    case .tee?: "tee"
    case .branching?: "branching"
    }
}

private struct JunctionFixture: Decodable {
    struct Offset: Decodable { let north: Double; let east: Double }
    struct Branch: Decodable { let bearing: Double; let kind: String }
    struct Case: Decodable {
        let name: String
        let headingDeg: Double
        let uncertaintyDeg: Double
        let accuracy: Double
        let junction: Offset
        let branches: [Branch]
        let expect: String?
    }
    let cases: [Case]
}

struct OutingJunctionNoticeTests {
    @Test("공유 fixture: 모양·자격 표")
    func sharedFixture() throws {
        let data = try Data(contentsOf: fixtureURL("outing-junction-cases.json"))
        let fixture = try JSONDecoder().decode(JunctionFixture.self, from: data)
        #expect(fixture.cases.count >= 10)
        for c in fixture.cases {
            let j = junction(
                north: c.junction.north, east: c.junction.east,
                c.branches.map { ($0.bearing, OutingBranchKind(rawValue: $0.kind) ?? .unknown) })
            let got = notice(
                [j], heading: .valid(bearing: c.headingDeg, uncertaintyDeg: c.uncertaintyDeg), accuracy: c.accuracy)
            #expect(shapeLabel(got?.shape) == c.expect, "\(c.name)")
        }
    }

    @Test("방위가 valid가 아니면 예고하지 않는다")
    func staleHeading() {
        let j = junction(north: 15, east: 0, [(180, .alley), (0, .alley), (270, .alley)])
        #expect(notice([j], heading: .stale(bearing: 0)) == nil)
        #expect(notice([j], heading: .none) == nil)
    }

    @Test("이미 예고한 id는 다시 말하지 않는다")
    func latch() {
        let j = junction(north: 15, east: 0, [(180, .alley), (0, .alley), (270, .alley)])
        #expect(notice([j]) != nil)
        #expect(notice([j], spoken: ["jn:test"]) == nil)
    }

    @Test("최소 간격 안이면 아무것도 말하지 않고, 간격이 지나면 그 후보를 말한다(침묵시키지 않는다)")
    func minGap() {
        let j = junction(north: 15, east: 0, [(180, .alley), (0, .alley), (270, .alley)])
        #expect(notice([j], lastNoticeAt: 100 - outingJunctionMinGapSeconds + 1, now: 100) == nil)
        #expect(notice([j], lastNoticeAt: 100 - outingJunctionMinGapSeconds, now: 100)?.id == "jn:test")
    }

    @Test("한 fix에 여럿이면 가장 가까운 하나")
    func nearest() {
        let far = junction(north: 19, east: 0, [(180, .alley), (0, .alley), (90, .alley)], id: "jn:far")
        let near = junction(north: 13, east: 0, [(180, .alley), (0, .alley), (270, .alley)], id: "jn:near")
        #expect(notice([far, near]) == OutingJunctionNotice(id: "jn:near", shape: .side(.left, alley: true)))
    }

    @Test("모양이 없는 가까운 이음점이 먼 갈림길을 가리지 않는다")
    func vertexDoesNotShadow() {
        let vertex = junction(north: 12, east: 0, [(180, .alley), (0, .alley), (170, .path)], id: "jn:vertex")
        let real = junction(north: 18, east: 0, [(180, .alley), (0, .alley), (90, .alley)], id: "jn:real")
        #expect(notice([vertex, real])?.id == "jn:real")
    }
}

struct OutingNodeMergeTests {
    @Test("15m 안의 횡단보도는 하나로, id는 처음 본 좌표에서 유도한다")
    func crosswalks() {
        let a = at(north: 0, east: 0)
        let b = at(north: 9, east: 0)
        let c = at(north: 0, east: 20)
        var merged = outingMergeCrosswalks([:], adding: [RoutePoint(lat: a.lat, lng: a.lng)])
        let firstId = outingNodeId("cw", lat: a.lat, lng: a.lng)
        #expect(Array(merged.keys) == [firstId])
        // 다른 원천의 9m 떨어진 같은 횡단보도·재조회로 다시 온 같은 점은 흡수된다.
        merged = outingMergeCrosswalks(merged, adding: [RoutePoint(lat: b.lat, lng: b.lng), RoutePoint(lat: a.lat, lng: a.lng)])
        #expect(merged.count == 1)
        merged = outingMergeCrosswalks(merged, adding: [RoutePoint(lat: c.lat, lng: c.lng)])
        #expect(merged.count == 2)
        #expect(merged[firstId] != nil)
    }

    @Test("근접 교차점은 갈래만 더하고, 같은 방향 갈래는 버리고, 새 갈래는 기존 교차점 좌표로 옮겨 붙인다")
    func junctions() {
        let osm = junction(north: 0, east: 0, [(0, .alley), (180, .alley), (270, .alley)])
        var merged = outingMergeJunctions([:], adding: [osm])
        #expect(merged.count == 1)
        let host = merged.values.first!
        #expect(host.id == outingNodeId("jn", lat: osm.lat, lng: osm.lng))
        // 8m 동쪽의 서울망 교차점: 북(중복)·동(새 갈래).
        let seoul = junction(north: 0, east: 8, [(10, .path), (90, .path)])
        merged = outingMergeJunctions(merged, adding: [seoul])
        #expect(merged.count == 1)
        let joined = merged[host.id]!
        #expect(joined.branches.count == 4)
        let added = joined.branches.last!
        #expect(added.kind == .path)
        let b = bearingDegrees(fromLat: joined.lat, fromLng: joined.lng, toLat: added.lat, toLng: added.lng)
        #expect(abs(b - 90) < 1)
        // 멀리 떨어진 교차점은 따로.
        merged = outingMergeJunctions(merged, adding: [junction(north: 40, east: 0, [(0, .alley), (180, .alley), (90, .alley)])])
        #expect(merged.count == 2)
    }

    @Test("탐침 간격: 방위 valid ∧ (처음이거나 직선 100m 이상) ∧ 연속 실패 3회 미만일 때만 그 방위를 낸다")
    func probeStep() {
        let here = RoutePoint(lat: originLat, lng: originLng)
        let valid = OutingHeading.valid(bearing: 37, uncertaintyDeg: 10)
        #expect(outingProbeStep(lastProbe: nil, failures: 0, at: here, heading: valid) == 37)
        #expect(outingProbeStep(lastProbe: nil, failures: 0, at: here, heading: .stale(bearing: 37)) == nil)
        #expect(outingProbeStep(lastProbe: nil, failures: 0, at: here, heading: .none) == nil)
        let near = at(north: 90, east: 0)
        #expect(outingProbeStep(lastProbe: RoutePoint(lat: near.lat, lng: near.lng), failures: 0, at: here, heading: valid) == nil)
        let far = at(north: 101, east: 0)
        #expect(outingProbeStep(lastProbe: RoutePoint(lat: far.lat, lng: far.lng), failures: 0, at: here, heading: valid) == 37)
        // 연속 실패 상한이면 그 세션은 묻지 않는다.
        #expect(outingProbeStep(lastProbe: nil, failures: outingProbeFailureLimit - 1, at: here, heading: valid) == 37)
        #expect(outingProbeStep(lastProbe: nil, failures: outingProbeFailureLimit, at: here, heading: valid) == nil)
    }
}

struct OutingCrosswalkSilenceTests {
    @Test("예고한 횡단보도와 같은 진행선의 35m 안 짝은 함께 침묵, 옆(|t| > 15) 횡단보도는 남는다")
    func silence() {
        let heading = OutingHeading.valid(bearing: 0, uncertaintyDeg: 10)
        func cw(_ id: String, _ n: Double, _ e: Double) -> (crosswalk: OutingCrosswalk, relation: OutingRelation) {
            let p = at(north: n, east: e)
            return (OutingCrosswalk(id: id, lat: p.lat, lng: p.lng),
                    outingProject(fixLat: originLat, fixLng: originLng, accuracy: 5, heading: heading, placeLat: p.lat, placeLng: p.lng))
        }
        let list = [cw("curb", 25, 0), cw("center", 45, 2), cw("corner", 30, 25), cw("far", 70, 0)]
        #expect(outingCrosswalkSilenced(after: "curb", crosswalks: list) == ["center"])
        #expect(outingCrosswalkSilenced(after: "missing", crosswalks: list).isEmpty)
    }
}

struct OutingNodesDecodingTests {
    @Test("노드 옵트인 응답: 원천별 3-state, 필드가 없으면(옛 서버) 실패")
    func nodes() throws {
        let json = """
        {"walk":{"audioSignals":{"status":"unsupported","reason":"outsideSeoul"},
        "osm":{"status":"ok","data":{"features":[],"totalCount":0,"listedCount":0,"truncated":false,"crossingTotal":0,"tactileTotal":0}},
        "osmJunctions":{"status":"ok","data":{"junctions":[{"lat":37.5,"lng":127.0,"branches":[{"lat":37.5002,"lng":127.0,"kind":"alley"},{"lat":37.5,"lng":127.0003,"kind":"weird"}]}]}},
        "seoulNetwork":{"status":"unsupported","reason":"outsideSeoul"}}}
        """
        let env = try JSONDecoder().decode(OutingWalkNodesEnvelope.self, from: Data(json.utf8))
        let osm = env.walk.osmJunctions.map { _ in "x" }
        #expect(osm != nil)
        let old = """
        {"walk":{"audioSignals":{"status":"error"},"osm":{"status":"error"}}}
        """
        let oldEnv = try JSONDecoder().decode(OutingWalkNodesEnvelope.self, from: Data(old.utf8))
        #expect(oldEnv.walk.osmJunctions == nil)
        #expect(oldEnv.walk.seoulNetwork == nil)
        if case .ok(let list) = env.walk.osmJunctions {
            #expect(list.junctions[0].junction.branches.map(\.kind) == [.alley, .unknown])
        } else {
            Issue.record("osmJunctions ok 아님")
        }
        if case .unsupported = env.walk.seoulNetwork {} else { Issue.record("seoulNetwork unsupported 아님") }
    }

    @Test("탐침 응답")
    func probe() throws {
        let json = """
        {"probe":{"crosswalks":[{"lat":37.54,"lng":127.14}],"turns":[{"lat":37.541,"lng":127.141,"branch":{"lat":37.5412,"lng":127.141}}]}}
        """
        let env = try JSONDecoder().decode(OutingProbeEnvelope.self, from: Data(json.utf8))
        #expect(env.probe?.crosswalks.count == 1)
        #expect(env.probe?.turns.first?.branch.lat == 37.5412)
    }
}

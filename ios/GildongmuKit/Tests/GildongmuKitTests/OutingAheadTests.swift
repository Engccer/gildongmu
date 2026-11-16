import Foundation
import Testing
@testable import GildongmuKit

// 나들이 앞 상황 두 줄과 병원 이정표 등급(E82 위원장 판정 2026-11-16 3·4번).

private let originLat = 36.0
private let originLng = 128.0

/// 원점에서 동쪽 east m, 북쪽 north m.
private func at(east: Double, north: Double) -> (lat: Double, lng: Double) {
    (originLat + north / 111_320, originLng + east / (111_320 * cos(originLat * .pi / 180)))
}

private let northValid = OutingHeading.valid(bearing: 0, uncertaintyDeg: 10)

private func rel(east: Double, north: Double, heading: OutingHeading = northValid, accuracy: Double = 5) -> OutingRelation {
    let p = at(east: east, north: north)
    return outingProject(
        fixLat: originLat, fixLng: originLng, accuracy: accuracy, heading: heading, placeLat: p.lat, placeLng: p.lng)
}

private func landmark(_ id: String, east: Double, north: Double, heading: OutingHeading = northValid)
    -> (id: String, tier: OutingLandmarkTier, relation: OutingRelation) {
    (id: id, tier: .landmark, relation: rel(east: east, north: north, heading: heading))
}

private func shop(_ id: String, east: Double, north: Double, heading: OutingHeading = northValid)
    -> (id: String, tier: OutingLandmarkTier, relation: OutingRelation) {
    (id: id, tier: .shop, relation: rel(east: east, north: north, heading: heading))
}

/// 교차점에서 방위로 25m 간 갈래 점.
private func junction(east: Double, north: Double, _ bearings: [(Double, OutingBranchKind)]) -> OutingJunction {
    let j = at(east: east, north: north)
    let branches = bearings.map { b, kind in
        let r = b * .pi / 180
        return OutingBranch(
            lat: j.lat + 25 * cos(r) / 111_320, lng: j.lng + 25 * sin(r) / (111_320 * cos(j.lat * .pi / 180)), kind: kind)
    }
    return OutingJunction(id: "jn:\(east),\(north)", lat: j.lat, lng: j.lng, branches: branches, fromProbe: false)
}

@Suite("나들이 병원 이정표 등급(판정 3)")
struct OutingHospitalTierTests {
    @Test("종합병원·대학병원 세부 분류만 이정표다(카카오 실호출 경로)")
    func generalHospitals() {
        #expect(outingLandmarkTier(category: "hospital", categoryRaw: "의료,건강 > 병원 > 종합병원") == .landmark)
        #expect(outingLandmarkTier(category: "hospital", categoryRaw: "의료,건강 > 병원 > 대학병원") == .landmark)
    }

    @Test("진료과 의원·치과·한방병원·요양병원·동물병원은 가게로 내린다(2026-11-16 실보행 응답의 분류 그대로)")
    func clinicsAreShops() {
        for raw in [
            "의료,건강 > 병원 > 치과", "의료,건강 > 병원 > 내과", "의료,건강 > 병원 > 가정의학과",
            "의료,건강 > 병원 > 소아청소년과", "의료,건강 > 병원 > 정형외과", "의료,건강 > 병원 > 신경외과",
            "의료,건강 > 병원 > 이비인후과", "의료,건강 > 병원 > 통증클리닉", "의료,건강 > 병원 > 일반의원",
            "의료,건강 > 병원 > 한방병원", "의료,건강 > 병원 > 노인,요양병원", "가정,생활 > 반려동물 > 동물병원",
        ] {
            #expect(outingLandmarkTier(category: "hospital", categoryRaw: raw) == .shop, "\(raw)")
        }
    }

    @Test("세부 분류가 비었거나 모르는 병원은 가게다 — 판정은 마디 일치이지 부분 문자열이 아니다")
    func unknownHospitalIsShop() {
        #expect(outingLandmarkTier(category: "hospital", categoryRaw: "") == .shop)
        #expect(outingLandmarkTier(category: "hospital", categoryRaw: "의료,건강 > 병원") == .shop)
        #expect(outingLandmarkTier(category: "hospital", categoryRaw: "의료,건강 > 병원 > 종합병원앞치과") == .shop)
        // 공백 차이는 같은 마디다.
        #expect(outingLandmarkTier(category: "hospital", categoryRaw: "의료,건강>병원>대학병원") == .landmark)
    }

    @Test("병원 밖 분류는 세부 분류와 무관하다")
    func otherCategories() {
        #expect(outingLandmarkTier(category: "school", categoryRaw: "교육,학문 > 학교 > 초등학교") == .landmark)
        // 병원이 아닌 키에 「종합병원」 마디가 와도 키가 먼저다.
        #expect(outingLandmarkTier(category: "pharmacy", categoryRaw: "의료,건강 > 병원 > 종합병원") == .shop)
    }
}

@Suite("나들이 다음 이정표(윗줄)")
struct OutingNextLandmarkTests {
    @Test("앞 구역 횡폭 25m — 옆 골목 건물은 「앞에」가 아니다")
    func lateralWidth() {
        #expect(outingNextLandmark([landmark("a", east: 24, north: 60)])?.id == "a")
        #expect(outingNextLandmark([landmark("a", east: -24, north: 60)])?.id == "a")
        #expect(outingNextLandmark([landmark("a", east: 26, north: 60)]) == nil)
        #expect(outingNextLandmark([landmark("a", east: -26, north: 60)]) == nil)
    }

    @Test("거리 상한 150m(직선거리)")
    func maxDistance() {
        #expect(outingNextLandmark([landmark("a", east: 0, north: 149)]) != nil)
        #expect(outingNextLandmark([landmark("a", east: 0, north: 151)]) == nil)
    }

    @Test("옆 대역(±10m)과 뒤는 다음 이정표가 아니다")
    func aheadOnly() {
        #expect(outingNextLandmark([landmark("a", east: 5, north: 9)]) == nil)
        #expect(outingNextLandmark([landmark("a", east: 0, north: -40)]) == nil)
        #expect(outingNextLandmark([landmark("a", east: 0, north: 11)])?.id == "a")
    }

    @Test("진행축으로 먼저 닿는 곳(s 최소)을 고르고, 거리는 10m 양자화 직선거리다")
    func firstAlongTrack() {
        // b가 직선거리로는 가깝지 않아도(옆으로 24m) 진행축으로 먼저 닿는다.
        let picked = outingNextLandmark([landmark("a", east: 0, north: 50), landmark("b", east: 24, north: 40)])
        #expect(picked?.id == "b")
        #expect(picked?.meters == outingQuantizedMeters(hypot(24, 40)))
    }

    @Test("가게 등급은 다음 이정표가 아니다")
    func shopsIgnored() {
        #expect(outingNextLandmark([shop("s", east: 0, north: 30)]) == nil)
    }

    @Test("방위가 valid가 아니면 고르기 자체가 없다(「앞」을 판정하지 않는다)")
    func noValidHeading() {
        for h in [OutingHeading.none, .stale(bearing: 0)] {
            let pick = outingAheadPick(
                heading: h, places: [landmark("a", east: 0, north: 40, heading: h)], crosswalks: [], junctions: [])
            #expect(pick == nil)
        }
    }
}

@Suite("나들이 앞 30m(아랫줄)")
struct OutingNearAheadTests {
    @Test("앞 30m·옆 20m 창 — 가게·이정표를 가리지 않는다")
    func window() {
        let places = [
            (id: "in", relation: rel(east: -19, north: 29)),
            (id: "far", relation: rel(east: 0, north: 31)),
            (id: "wide", relation: rel(east: 21, north: 10)),
            (id: "behind", relation: rel(east: 0, north: -1)),
        ]
        #expect(outingNearAhead(places: places, crosswalks: [], junctions: []) == [.place(id: "in", side: .left)])
    }

    @Test("진행축 순서로 최대 세 곳, 좌우는 관계의 OutingSide")
    func orderAndCap() {
        let places = [
            (id: "c", relation: rel(east: 15, north: 25)),
            (id: "a", relation: rel(east: -15, north: 5)),
            (id: "d", relation: rel(east: 0, north: 28)),
            (id: "b", relation: rel(east: 2, north: 12)),
        ]
        let items = outingNearAhead(places: places, crosswalks: [rel(east: 0, north: 20)], junctions: [])
        #expect(items == [.place(id: "a", side: .left), .place(id: "b", side: .unknown), .crosswalk])
    }

    @Test("횡단보도는 같은 줄에 한 번만(연석점·중심점 짝)")
    func crosswalkOnce() {
        let items = outingNearAhead(
            places: [(id: "x", relation: rel(east: 18, north: 25))],
            crosswalks: [rel(east: 0, north: 10), rel(east: 3, north: 16)], junctions: [])
        #expect(items == [.crosswalk, .place(id: "x", side: .right)])
    }

    @Test("교차로는 모양으로 싣고, 곧은 길의 이음점은 뺀다")
    func junctions() {
        let cross = junction(east: 0, north: 15, [(0, .road), (90, .alley), (180, .road), (270, .alley)])
        let straight = junction(east: 0, north: 25, [(0, .road), (180, .road)])
        let far = junction(east: 0, north: 40, [(0, .road), (90, .alley), (180, .road), (270, .alley)])
        let near = outingNearJunctions(
            [cross, straight, far], fixLat: originLat, fixLng: originLng, accuracy: 5, heading: northValid)
        #expect(near.map(\.shape) == [.cross])
        #expect(outingNearAhead(places: [], crosswalks: [], junctions: near) == [.junction(.cross)])
        // 방위가 valid가 아니면 교차로 후보도 없다.
        #expect(outingNearJunctions(
            [cross], fixLat: originLat, fixLng: originLng, accuracy: 5, heading: .stale(bearing: 0)).isEmpty)
    }
}

@Suite("나들이 앞 상황 두 줄의 상태(3-state)")
struct OutingAheadLinesTests {
    private let pickWith = OutingAheadPick(
        next: OutingNextLandmark(id: "a", meters: 40), near: [.place(id: "s", side: .left)])
    private let pickEmpty = OutingAheadPick(next: nil, near: [])

    @Test("방위가 valid가 아니면 윗줄은 방위 문구만, 아랫줄은 목록이 준비됐을 때 「방향 모름」")
    func noHeading() {
        for h in [OutingHeading.none, .stale(bearing: 0)] {
            #expect(outingAheadUpper(heading: h, status: .ready, pick: nil, locationLost: false) == .headingOnly)
            #expect(outingAheadLower(heading: h, status: .ready, nodes: .ready, pick: nil, locationLost: false) == .noHeading)
            // 목록이 준비되지 않았으면 그 상태가 먼저다(방향과 무관한 정보).
            #expect(outingAheadLower(heading: h, status: .loading, nodes: .ready, pick: nil, locationLost: false) == .surroundings(.loading))
            // 직전 fix의 고르기가 남아 있어도 방위가 지금 valid가 아니면 앞을 말하지 않는다.
            #expect(outingAheadUpper(heading: h, status: .ready, pick: pickWith, locationLost: false) == .headingOnly)
            #expect(outingAheadLower(heading: h, status: .ready, nodes: .ready, pick: pickWith, locationLost: false) == .noHeading)
        }
    }

    @Test("찾은 것이 있으면 상태와 무관하게 보인다")
    func found() {
        for status in [OutingSurroundingsStatus.ready, .failed, .loading] {
            #expect(outingAheadUpper(heading: northValid, status: status, pick: pickWith, locationLost: false)
                == .landmark(OutingNextLandmark(id: "a", meters: 40)))
            #expect(outingAheadLower(heading: northValid, status: status, nodes: .failed, pick: pickWith, locationLost: false)
                == .items([.place(id: "s", side: .left)]))
        }
    }

    @Test("「없음」은 목록을 받아 둔 때만 — 확인 중·실패·지역 밖은 상태를 말한다")
    func noneVersusUnknown() {
        #expect(outingAheadUpper(heading: northValid, status: .ready, pick: pickEmpty, locationLost: false) == .noLandmark)
        #expect(outingAheadLower(heading: northValid, status: .ready, nodes: .ready, pick: pickEmpty, locationLost: false) == .empty)
        for status in [OutingSurroundingsStatus.loading, .failed, .outOfCoverage] {
            #expect(outingAheadUpper(heading: northValid, status: status, pick: pickEmpty, locationLost: false) == .headingOnly)
            #expect(outingAheadLower(heading: northValid, status: status, nodes: .ready, pick: pickEmpty, locationLost: false) == .surroundings(status))
        }
    }

    @Test("장소는 받았어도 횡단보도·교차로 원천이 준비되지 않았으면 「없음」이 아니다 — 찾은 장소만 보이거나 그 상태를 말한다")
    func nodesNotReady() {
        for nodes in [OutingSurroundingsStatus.loading, .failed] {
            #expect(outingAheadLower(heading: northValid, status: .ready, nodes: nodes, pick: pickEmpty, locationLost: false) == .surroundings(nodes))
            #expect(outingAheadLower(heading: northValid, status: .ready, nodes: nodes, pick: pickWith, locationLost: false)
                == .items([.place(id: "s", side: .left)]))
            // 방향을 모르면 앞을 판정하지 않는다는 문장이 그대로다(없음을 단정하지 않는다).
            #expect(outingAheadLower(heading: .stale(bearing: 0), status: .ready, nodes: nodes, pick: nil, locationLost: false) == .noHeading)
        }
        // 윗줄(이정표)은 장소에서만 고르므로 노드 상태와 무관하다.
        #expect(outingAheadUpper(heading: northValid, status: .ready, pick: pickEmpty, locationLost: false) == .noLandmark)
    }

    @Test("보행 노드 조회 결과의 준비 상태: 조회 실패·원천 실패는 failed, 미제공은 준비")
    func nodesStatusFromFetch() throws {
        let okJSON = """
        {"walk":{"audioSignals":{"status":"unsupported","reason":"outsideSeoul"},
        "osm":{"status":"ok","data":{"features":[],"totalCount":0,"listedCount":0,"truncated":false,"crossingTotal":0,"tactileTotal":0}}}}
        """
        let errJSON = """
        {"walk":{"audioSignals":{"status":"error"},"osm":{"status":"error"}}}
        """
        let okInfra = try JSONDecoder().decode(OutingWalkNodesEnvelope.self, from: Data(okJSON.utf8)).walk.infra
        let errInfra = try JSONDecoder().decode(OutingWalkNodesEnvelope.self, from: Data(errJSON.utf8)).walk.infra
        #expect(outingNodesStatus(nil) == .failed)
        #expect(outingNodesStatus(OutingWalkNodes(
            infra: okInfra, osmJunctions: .ok([]), seoulCrosswalks: .unsupported, seoulJunctions: .unsupported)) == .ready)
        #expect(outingNodesStatus(OutingWalkNodes(
            infra: errInfra, osmJunctions: .ok([]), seoulCrosswalks: .unsupported, seoulJunctions: .unsupported)) == .failed)
        #expect(outingNodesStatus(OutingWalkNodes(
            infra: okInfra, osmJunctions: .error, seoulCrosswalks: .unsupported, seoulJunctions: .unsupported)) == .failed)
        #expect(outingNodesStatus(OutingWalkNodes(
            infra: okInfra, osmJunctions: .ok([]), seoulCrosswalks: .error, seoulJunctions: .ok([]))) == .failed)
        #expect(outingNodesStatus(OutingWalkNodes(
            infra: okInfra, osmJunctions: .ok([]), seoulCrosswalks: .ok([]), seoulJunctions: .error)) == .failed)
    }

    @Test("새 fix 없이 시간만 흐르면 쥔 방위는 유효 나이(10초)까지만 지금의 방위다")
    func headingCurrency() {
        let course = DerivedCourse(bearing: 0, uncertaintyDeg: 10)
        let state = outingHeadingRecord(OutingHeadingState(), course: course, at: 100)
        let valid = OutingHeading.valid(bearing: 0, uncertaintyDeg: 10)
        #expect(outingHeadingIsCurrent(valid, state: state, now: 100))
        #expect(outingHeadingIsCurrent(valid, state: state, now: 100 + outingHeadingMaxAgeSeconds))
        #expect(!outingHeadingIsCurrent(valid, state: state, now: 100 + outingHeadingMaxAgeSeconds + 0.1))
        #expect(!outingHeadingIsCurrent(valid, state: state, now: 99))
        #expect(!outingHeadingIsCurrent(.stale(bearing: 0), state: state, now: 100))
        #expect(!outingHeadingIsCurrent(.none, state: OutingHeadingState(), now: 100))
        #expect(!outingHeadingIsCurrent(valid, state: OutingHeadingState(), now: 100))
    }

    @Test("위치 끊김은 쥔 방위가 valid인데 유효 나이를 넘긴 때만 — 처음부터 모름·멈춤(stale)은 들지 않는다(2026-11-17 판정)")
    func locationLost() {
        let course = DerivedCourse(bearing: 0, uncertaintyDeg: 10)
        let state = outingHeadingRecord(OutingHeadingState(), course: course, at: 100)
        let valid = OutingHeading.valid(bearing: 0, uncertaintyDeg: 10)
        #expect(!outingAheadLocationLost(valid, state: state, lastUsableFixAt: nil, now: 100 + outingHeadingMaxAgeSeconds))
        #expect(outingAheadLocationLost(valid, state: state, lastUsableFixAt: nil, now: 100 + outingHeadingMaxAgeSeconds + 0.1))
        #expect(!outingAheadLocationLost(.stale(bearing: 0), state: state, lastUsableFixAt: nil, now: 200))
        #expect(!outingAheadLocationLost(.none, state: OutingHeadingState(), lastUsableFixAt: nil, now: 200))
    }

    @Test("쓸 수 있는 fix가 최근이면 방위 표가 낡아도 위치 끊김 표식을 세우지 않는다(경계 3초)")
    func locationLostSkipsWhenFixIsFresh() {
        let course = DerivedCourse(bearing: 0, uncertaintyDeg: 10)
        let state = outingHeadingRecord(OutingHeadingState(), course: course, at: 100)
        let valid = OutingHeading.valid(bearing: 0, uncertaintyDeg: 10)
        let now = 100 + outingHeadingMaxAgeSeconds + 5
        #expect(!outingAheadLocationLost(valid, state: state, lastUsableFixAt: now - 1, now: now))
        #expect(!outingAheadLocationLost(valid, state: state, lastUsableFixAt: now - outingLocationFreshSeconds, now: now))
        #expect(outingAheadLocationLost(valid, state: state, lastUsableFixAt: now - outingLocationFreshSeconds - 0.1, now: now))
        #expect(outingAheadLocationLost(valid, state: state, lastUsableFixAt: nil, now: now))
    }

    @Test("위치가 끊긴 동안 두 줄은 「마지막 진행 방향」·「위치 확인 중」 — 쥔 고르기·목록 상태와 무관하다")
    func locationLostLines() {
        for status in [OutingSurroundingsStatus.ready, .loading, .failed, .outOfCoverage] {
            for pick in [nil, pickWith, pickEmpty] {
                #expect(outingAheadUpper(heading: northValid, status: status, pick: pick, locationLost: true) == .lastHeading)
                #expect(outingAheadLower(
                    heading: northValid, status: status, nodes: .ready, pick: pick, locationLost: true) == .locating)
            }
        }
        // 대조군: 방향을 처음부터 모르는 상태와 멈춘 상태의 종전 문장은 그대로다.
        for h in [OutingHeading.none, .stale(bearing: 0)] {
            #expect(outingAheadUpper(heading: h, status: .ready, pick: nil, locationLost: false) == .headingOnly)
            #expect(outingAheadLower(heading: h, status: .ready, nodes: .ready, pick: nil, locationLost: false) == .noHeading)
        }
    }
}

// MARK: - 실보행 재생의 모양(2026-11-16, 합성)

/// 2026-11-16 실보행 재생에서 옛 규칙(이정표 분류 다섯·앞 구획의 직선거리 최근접)이 틀린 모양을 **합성 좌표로** 다시 만든 다섯
/// 자리다. 진행 방향은 북쪽, 값은 동·북 오프셋(m)이다. 실제 장소 배치·거리는 담지 않는다(공개 저장소 익명화: 주변 장소의
/// 상대 배치도 지문이다). 재생에서 본 것은 모양뿐이다 — 앞 구획에서 가장 가까운 「이정표 분류」가 옆 골목(|t| > 25m)의
/// 의원급 병원이었고, 앞 25m 폭 안에는 이정표가 없었다.
private struct ReplayCase {
    let accuracy: Double
    let uncertainty: Double
    let places: [(east: Double, north: Double, category: String, categoryRaw: String)]
}

private let replayCases: [ReplayCase] = [
    ReplayCase(accuracy: 14, uncertainty: 20, places: [
        (60, 50, "hospital", "의료,건강 > 병원 > 가정의학과"),
        (-40, -120, "school", "교육,학문 > 학교 > 초등학교"),
        (-30, 200, "hospital", "의료,건강 > 병원 > 노인,요양병원"),
    ]),
    ReplayCase(accuracy: 14, uncertainty: 12, places: [
        (40, 30, "hospital", "의료,건강 > 병원 > 치과"),
        (70, 110, "public", "사회,공공기관 > 지방행정기관 > 시,군,구민회관"),
    ]),
    ReplayCase(accuracy: 14, uncertainty: 11, places: [
        (35, 25, "hospital", "의료,건강 > 병원 > 노인,요양병원"),
        (80, 40, "public", "사회,공공기관 > 지방행정기관 > 시,군,구민회관"),
        (-90, 60, "hospital", "의료,건강 > 병원 > 소아청소년과"),
    ]),
    ReplayCase(accuracy: 14, uncertainty: 13, places: [
        (-45, 70, "hospital", "의료,건강 > 병원 > 내과"),
        (150, 20, "school", "교육,학문 > 학교 > 초등학교"),
    ]),
    ReplayCase(accuracy: 14, uncertainty: 12, places: [
        (30, 90, "hospital", "의료,건강 > 병원 > 정형외과"),
        (-100, 100, "school", "교육,학문 > 학교 > 중학교"),
    ]),
]

@Suite("나들이 앞 상황 실보행 재생의 모양(2026-11-16, 합성)")
struct OutingAheadReplayTests {
    @Test("옛 규칙이 옆 골목의 의원·요양병원을 「앞에」로 고르던 자리에서 새 규칙은 고르지 않는다")
    func otherAlleyClinicsAreGone() {
        for (n, c) in replayCases.enumerated() {
            let heading = OutingHeading.valid(bearing: 0, uncertaintyDeg: c.uncertainty)
            let rels = c.places.enumerated().map { i, p in
                (id: "p\(i)", place: p, relation: rel(east: p.east, north: p.north, heading: heading, accuracy: c.accuracy))
            }
            // 재생 전제: 옛 규칙(분류 키 다섯 · 앞 구획 · 직선거리 최근접)은 앞 25m 폭 밖의 병원 분류(의원급)를 골랐다.
            let old = rels
                .filter { outingLandmarkCategories.contains($0.place.category) && $0.relation.zone == .ahead }
                .min { $0.relation.d < $1.relation.d }
            #expect(old?.place.category == "hospital", "사례 \(n)")
            #expect(abs(old?.relation.t ?? 0) > outingNextLandmarkLateralMeters, "사례 \(n)")
            #expect(outingLandmarkTier(category: old?.place.category ?? "", categoryRaw: old?.place.categoryRaw ?? "") == .shop)
            // 새 규칙: 이 다섯 자리에서 「앞에 ○○」로 말할 이정표가 없다(「앞에 이정표 없음」).
            let pick = outingAheadPick(
                heading: heading,
                places: rels.map { r in
                    (id: r.id, tier: outingLandmarkTier(category: r.place.category, categoryRaw: r.place.categoryRaw),
                     relation: r.relation)
                },
                crosswalks: [], junctions: [])
            #expect(pick?.next == nil, "사례 \(n)")
            #expect(outingAheadUpper(heading: heading, status: .ready, pick: pick, locationLost: false) == .noLandmark, "사례 \(n)")
        }
    }

    @Test("같은 자리에 걷는 길 위 종합병원이 있으면 그것을 고른다(대조군)")
    func generalHospitalOnPath() {
        let c = replayCases[2]
        let heading = OutingHeading.valid(bearing: 0, uncertaintyDeg: c.uncertainty)
        var places = c.places.enumerated().map { i, p in
            (id: "p\(i)", tier: outingLandmarkTier(category: p.category, categoryRaw: p.categoryRaw),
             relation: rel(east: p.east, north: p.north, heading: heading, accuracy: c.accuracy))
        }
        places.append((id: "general", tier: outingLandmarkTier(category: "hospital", categoryRaw: "의료,건강 > 병원 > 종합병원"),
                       relation: rel(east: 12, north: 90, heading: heading, accuracy: c.accuracy)))
        let pick = outingAheadPick(heading: heading, places: places, crosswalks: [], junctions: [])
        #expect(pick?.next?.id == "general")
    }
}

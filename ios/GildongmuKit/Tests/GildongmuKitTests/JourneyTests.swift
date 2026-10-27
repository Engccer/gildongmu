import Testing
import Foundation
@testable import GildongmuKit

// E70 여정 전이 표(plan Task 4 · spec §6.1) 계약 테스트. 표의 행마다 한 건, 표 밖 (국면, 사건) 쌍은 전부 ignore.

private let journeyId = UUID(uuidString: "00000000-0000-0000-0000-0000000000E7")!

/// 택시 시작 · 하차 지정 · 출구 도보 있음 — 표의 모든 갈래를 지나는 기본 모양.
private let full = JourneyShape(startsWithTaxi: true, alightDesignated: true, hasEgressWalk: true)

private func state(_ phase: JourneyPhase, shape: JourneyShape = full, seq: Int = 5) -> JourneyState {
    JourneyState(journeyId: journeyId, shape: shape, phase: phase, seq: seq)
}

private func step(
    _ s: JourneyState, _ event: JourneyEvent, token: JourneyToken? = nil
) -> JourneyStepResult {
    journeyStep(s, event, token: token ?? s.token)
}

/// 기대: 다음 국면(seq는 언제나 +1) / 종료 / 무시.
enum JourneyExpect: Equatable {
    case next(JourneyPhase)
    case end
    case ignore
}

private func outcome(_ s: JourneyState, _ event: JourneyEvent) -> JourneyExpect {
    switch step(s, event) {
    case .ignore: return .ignore
    case .end: return .end
    case .next(let n):
        // `.next`는 같은 여정·같은 모양을 유지하고 seq만 +1 한다.
        #expect(n.journeyId == s.journeyId)
        #expect(n.shape == s.shape)
        #expect(n.seq == s.seq + 1)
        return .next(n.phase)
    }
}

struct JourneyRow: CustomTestStringConvertible, Sendable {
    let phase: JourneyPhase
    let event: JourneyEvent
    let expect: JourneyExpect
    var testDescription: String { "\(phase) + \(event) -> \(expect)" }
}

private let stageEnds: [JourneyStageEnd] = [.arrived, .userStopped, .startFailed, .ended]
private let allStages: [JourneyStage] = [.taxiIn, .access, .transit, .egress, .taxiOut]

/// 표 전체(`userEnded`는 따로). `rideCompleted`는 모양 의존이라 기본 모양 기준 한 행씩.
private let rows: [JourneyRow] = [
    // running(taxiIn)
    JourneyRow(phase: .running(.taxiIn), event: .stageEnded(.arrived), expect: .next(.transitioning(to: .access))),
    JourneyRow(phase: .running(.taxiIn), event: .taxiDropped, expect: .next(.transitioning(to: .access))),
    JourneyRow(phase: .running(.taxiIn), event: .stageEnded(.userStopped), expect: .end),
    JourneyRow(phase: .running(.taxiIn), event: .stageEnded(.startFailed), expect: .next(.failed(at: .taxiIn))),
    JourneyRow(phase: .running(.taxiIn), event: .stageEnded(.ended), expect: .next(.failed(at: .taxiIn))),
    // running(access)
    JourneyRow(phase: .running(.access), event: .stageEnded(.arrived), expect: .next(.transitioning(to: .transit))),
    JourneyRow(phase: .running(.access), event: .stageEnded(.startFailed), expect: .next(.transitioning(to: .transit))),
    JourneyRow(phase: .running(.access), event: .stageEnded(.ended), expect: .next(.transitioning(to: .transit))),
    JourneyRow(phase: .running(.access), event: .stageEnded(.userStopped), expect: .end),
    // running(transit)
    JourneyRow(phase: .running(.transit), event: .rideCompleted, expect: .next(.transitioning(to: .egress))),
    JourneyRow(phase: .running(.transit), event: .transitStopped, expect: .end),
    JourneyRow(phase: .running(.transit), event: .stageEnded(.startFailed), expect: .next(.failed(at: .transit))),
    // running(egress)
    JourneyRow(phase: .running(.egress), event: .stageEnded(.arrived), expect: .next(.transitioning(to: .taxiOut))),
    JourneyRow(phase: .running(.egress), event: .taxiBoarded, expect: .next(.transitioning(to: .taxiOut))),
    JourneyRow(phase: .running(.egress), event: .stageEnded(.userStopped), expect: .end),
    JourneyRow(phase: .running(.egress), event: .stageEnded(.startFailed), expect: .next(.failed(at: .egress))),
    JourneyRow(phase: .running(.egress), event: .stageEnded(.ended), expect: .next(.failed(at: .egress))),
    // running(taxiOut)
    JourneyRow(phase: .running(.taxiOut), event: .stageEnded(.startFailed), expect: .next(.failed(at: .taxiOut))),
    JourneyRow(phase: .running(.taxiOut), event: .stageEnded(.arrived), expect: .end),
    JourneyRow(phase: .running(.taxiOut), event: .stageEnded(.userStopped), expect: .end),
    JourneyRow(phase: .running(.taxiOut), event: .stageEnded(.ended), expect: .end),
    // failed
    JourneyRow(phase: .failed(at: .taxiIn), event: .taxiDropped, expect: .next(.transitioning(to: .access))),
    JourneyRow(phase: .failed(at: .egress), event: .taxiBoarded, expect: .next(.transitioning(to: .taxiOut))),
] + allStages.flatMap { stage -> [JourneyRow] in
    [
        // transitioning(s)
        JourneyRow(phase: .transitioning(to: stage), event: .prepared(stage), expect: .next(.running(stage))),
        // access는 아래 별도 행(실패 대신 대중교통으로)
        JourneyRow(phase: .transitioning(to: stage), event: .prepFailed,
                   expect: stage == .access ? .next(.transitioning(to: .transit)) : .next(.failed(at: stage))),
        JourneyRow(phase: .transitioning(to: stage), event: .staleTimeout,
                   expect: stage == .access ? .next(.transitioning(to: .transit)) : .next(.failed(at: stage))),
        // failed(s)
        JourneyRow(phase: .failed(at: stage), event: .retry, expect: .next(.transitioning(to: stage))),
    ]
} + [
    // 접근 도보 30m 미만 생략: access를 건너뛰고 대중교통 준비 완료
    JourneyRow(phase: .transitioning(to: .access), event: .prepared(.transit), expect: .next(.running(.transit))),
]

private let allPhases: [JourneyPhase] =
    allStages.map { .running($0) } + allStages.map { .transitioning(to: $0) } + allStages.map { .failed(at: $0) }

private let allEvents: [JourneyEvent] =
    stageEnds.map { .stageEnded($0) }
    + [.taxiDropped, .taxiBoarded, .rideCompleted, .transitStopped]
    + allStages.map { .prepared($0) }
    + [.prepFailed, .retry, .staleTimeout]

@Suite struct JourneyTransitionTests {
    @Test("전이 표의 행", arguments: rows)
    func tableJourneyRow(_ row: JourneyRow) {
        #expect(outcome(state(row.phase), row.event) == row.expect)
    }

    @Test func everythingOutsideTheTableIsIgnored() {
        var checked = 0
        for phase in allPhases {
            for event in allEvents {
                if rows.contains(where: { $0.phase == phase && $0.event == event }) { continue }
                #expect(outcome(state(phase), event) == .ignore, "\(phase) + \(event)")
                checked += 1
            }
        }
        // 모든 (국면, 사건) 쌍에서 표의 행을 뺀 수 — 표 행이 서로 겹치거나 목록 밖이면 숫자가 어긋난다.
        #expect(checked == allPhases.count * allEvents.count - rows.count)
    }

    @Test func userEndedEndsFromEveryPhase() {
        for phase in allPhases {
            #expect(outcome(state(phase), .userEnded) == .end, "\(phase)")
        }
    }

    // MARK: rideCompleted — 모양 의존(위 표 행은 기본 모양 기준)

    @Test func rideCompletedFollowsShape() {
        let walkToStand = JourneyShape(startsWithTaxi: true, alightDesignated: true, hasEgressWalk: true)
        let noEgressWalk = JourneyShape(startsWithTaxi: true, alightDesignated: true, hasEgressWalk: false)
        let noAlight = JourneyShape(startsWithTaxi: true, alightDesignated: false, hasEgressWalk: false)
        // 하차 지정 + 출구 도보 → egress, 출구 후보 없음(none) → 곧장 taxiOut, 하차 미지정 → 여정 끝
        #expect(outcome(state(.running(.transit), shape: walkToStand), .rideCompleted) == .next(.transitioning(to: .egress)))
        #expect(outcome(state(.running(.transit), shape: noEgressWalk), .rideCompleted) == .next(.transitioning(to: .taxiOut)))
        #expect(outcome(state(.running(.transit), shape: noAlight), .rideCompleted) == .end)
        // 하차 미지정이면 hasEgressWalk가 참이어도 끝(모순 입력 방어: alightDesignated가 우선)
        let contradictory = JourneyShape(startsWithTaxi: false, alightDesignated: false, hasEgressWalk: true)
        #expect(outcome(state(.running(.transit), shape: contradictory), .rideCompleted) == .end)
    }

    // MARK: 시작

    @Test func startBeginsTransitioningToFirstStage() {
        let withTaxi = JourneyState.start(id: journeyId, shape: full)
        #expect(withTaxi.phase == .transitioning(to: .taxiIn))
        #expect(withTaxi.seq == 1)
        #expect(withTaxi.token == JourneyToken(journeyId: journeyId, seq: 1))

        let transitFirst = JourneyState.start(
            id: journeyId, shape: JourneyShape(startsWithTaxi: false, alightDesignated: true, hasEgressWalk: false))
        #expect(transitFirst.phase == .transitioning(to: .transit))
        #expect(transitFirst.seq == 1)
    }

    @Test func taxiStartRunsThroughToTaxiOut() {
        // 한 번에 끝까지: 시작 → taxiIn → access(30m 이상) → transit → egress → taxiOut → 끝
        var s = JourneyState.start(id: journeyId, shape: full)
        func advance(_ e: JourneyEvent, expect phase: JourneyPhase) {
            guard case .next(let n) = step(s, e) else { Issue.record("\(e) 가 전이하지 않았다"); return }
            #expect(n.phase == phase)
            s = n
        }
        advance(.prepared(.taxiIn), expect: .running(.taxiIn))
        advance(.taxiDropped, expect: .transitioning(to: .access))
        advance(.prepared(.access), expect: .running(.access))
        advance(.stageEnded(.arrived), expect: .transitioning(to: .transit))
        advance(.prepared(.transit), expect: .running(.transit))
        advance(.rideCompleted, expect: .transitioning(to: .egress))
        advance(.prepared(.egress), expect: .running(.egress))
        advance(.taxiBoarded, expect: .transitioning(to: .taxiOut))
        advance(.prepared(.taxiOut), expect: .running(.taxiOut))
        #expect(step(s, .stageEnded(.arrived)) == .end)
        #expect(s.seq == 9 + 1)   // 전이 아홉 번 + 시작 seq 1
    }

    // MARK: 낡은 사건·경쟁

    @Test func staleTokenIsIgnoredEvenForUserEnded() {
        let s = state(.running(.taxiIn), seq: 5)
        let old = JourneyToken(journeyId: journeyId, seq: 4)
        let future = JourneyToken(journeyId: journeyId, seq: 6)
        let other = JourneyToken(journeyId: UUID(), seq: 5)
        for t in [old, future, other] {
            #expect(step(s, .taxiDropped, token: t) == .ignore)
            #expect(step(s, .userEnded, token: t) == .ignore)
        }
        #expect(step(s, .taxiDropped, token: s.token) != .ignore)
    }

    /// 사용자가 「자동차에서 내렸어요」를 누른 직후 자동 도착 판정이 같은 seq로 도착하는 경쟁(Review Focus 4).
    @Test func taxiDroppedThenAutoArrivalWithSameTokenTransitionsOnce() {
        let s = state(.running(.taxiIn))
        let token = s.token
        guard case .next(let after) = journeyStep(s, .taxiDropped, token: token) else {
            Issue.record("첫 사건이 전이하지 않았다")
            return
        }
        #expect(after.phase == .transitioning(to: .access))
        // 두 번째 사건은 같은 (낡은) token을 들고 오므로 새 상태에서 무시된다.
        #expect(journeyStep(after, .stageEnded(.arrived), token: token) == .ignore)
        // 반대 순서도 같다.
        guard case .next(let after2) = journeyStep(s, .stageEnded(.arrived), token: token) else {
            Issue.record("도착이 전이하지 않았다")
            return
        }
        #expect(journeyStep(after2, .taxiDropped, token: token) == .ignore)
    }

    // MARK: 접근 도보 문턱

    @Test func accessWalkThresholdIsThirtyMeters() {
        // 위도 1도 ≈ 111,195m → 29m·31m에 해당하는 위도 차
        let base = 37.5573
        let meter = 1.0 / 111_194.9
        #expect(!journeyNeedsAccessWalk(fromLat: base, fromLng: 126.956, toLat: base + 29 * meter, toLng: 126.956))
        #expect(journeyNeedsAccessWalk(fromLat: base, fromLng: 126.956, toLat: base + 31 * meter, toLng: 126.956))
        #expect(JourneyTuning.accessWalkMinMeters == 30)
        #expect(JourneyTuning.handoffDelayMs == 600)
        #expect(JourneyTuning.staleTransitionSeconds == 30)
        #expect(JourneyTuning.stationIdentityMeters == 500)  // 서버 JOURNEY_STATION_IDENTITY_M
    }

    // MARK: 표시 이름(웹 displayStationName 미러 — 공유 fixture 전수)

    private struct DisplayNameFile: Decodable {
        struct Case: Decodable { let input: String; let expected: String }
        let cases: [Case]
    }

    @Test func displayNameSharedFixture() throws {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        url.appendPathComponent("src/lib/__tests__/fixtures/journey-display-names.json")
        let file = try JSONDecoder().decode(DisplayNameFile.self, from: Data(contentsOf: url))
        #expect(!file.cases.isEmpty)
        for c in file.cases {
            #expect(journeyStationDisplayName(c.input) == c.expected, "\(c.input)")
        }
    }

    @Test func displayNameExtraCases() {
        #expect(journeyStationDisplayName("인천공항1터미널역 공항철도") == "인천공항1터미널")
    }

    // MARK: 동명 이역 노선 머리말(판정 8)

    @Test func lineLabelNormalizesKakaoAndOdsayForms() {
        #expect(journeyLineLabel("수도권 2호선") == "2호선")
        #expect(journeyLineLabel("수도권2호선") == "2호선")
        #expect(journeyLineLabel("수도권 9호선(급행)") == "9호선")
        #expect(journeyLineLabel("수도권 수인.분당선") == "수인분당선")
        #expect(journeyLineLabel("경의중앙선") == "경의중앙선")
        #expect(journeyLineLabel(nil) == nil)
        #expect(journeyLineLabel(" ") == nil)
    }

    @Test func sameLineFollowsServerForms() {
        #expect(journeySameLine("수도권2호선", "수도권 2호선"))
        #expect(journeySameLine("9호선", "수도권 9호선(급행)"))
        #expect(journeySameLine("수인분당선", "수도권 수인.분당선"))
        // 카카오 출구 힌트는 지역을 싣지 않는다 — 같은 역 안 비교라 코어만 본다(서버 sameLine 동형)
        #expect(journeySameLine("2호선", "부산 2호선"))
        #expect(!journeySameLine("부산 2호선", "대구 2호선"))
        #expect(!journeySameLine("1호선", "11호선"))
        #expect(!journeySameLine("경의중앙선", "수도권 2호선"))
    }

    private struct LineNameFile: Decodable {
        struct Case: Decodable { let a: String; let b: String; let same: Bool }
        let cases: [Case]
    }

    /// 서버 `sameLine`과 같은 표본(웹 `station-identity.test.ts`가 같은 파일을 돈다) — 양방향.
    @Test func sameLineSharedFixture() throws {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        url.appendPathComponent("src/lib/__tests__/fixtures/journey-line-names.json")
        let file = try JSONDecoder().decode(LineNameFile.self, from: Data(contentsOf: url))
        #expect(!file.cases.isEmpty)
        for c in file.cases {
            #expect(journeySameLine(c.a, c.b) == c.same, "\(c.a) ↔ \(c.b)")
            #expect(journeySameLine(c.b, c.a) == c.same, "\(c.b) ↔ \(c.a)")
        }
    }

    private func stop(_ name: String, _ line: String?, _ lat: Double, _ lng: Double) -> JourneyStopIdentity {
        JourneyStopIdentity(name: name, line: line, lat: lat, lng: lng)
    }

    @Test func qualifierOnlyForSameNameDifferentStation() {
        // 경의중앙선 신촌을 골랐는데 추천은 2호선 신촌 승차(좌표 약 680m) — 붙인다
        let gyeongui = stop("신촌역", "경의중앙선", 37.5598, 126.9426)
        let line2 = stop("신촌", "수도권 2호선", 37.5552, 126.9369)
        #expect(journeyNeedsLineQualifier(designated: gyeongui, actual: line2))
        // 노선을 모르면 좌표로 가른다 — 멀면 다른 역
        #expect(journeyNeedsLineQualifier(designated: stop("신촌", nil, 37.5598, 126.9426), actual: line2))
        // 노선을 모르고 같은 자리면 같은 역(두 역을 다 정한 여정에서 추천이 고른 그 역에서 탈 때) — 붙이지 않는다
        #expect(!journeyNeedsLineQualifier(
            designated: stop("서울역", nil, 37.5547, 126.9707), actual: stop("서울역", "수도권 1호선", 37.5546, 126.9720)))
        // 같은 복합체의 다른 노선(노선 둘 다 앎)은 붙인다
        #expect(journeyNeedsLineQualifier(
            designated: stop("잠실", "8호선", 37.5145, 127.1059), actual: stop("잠실", "수도권 2호선", 37.5133, 127.1001)))
        // 이름이 다르면 평소 문장(애오개 ≠ 아현), 이름·노선이 같으면 붙이지 않는다
        #expect(!journeyNeedsLineQualifier(designated: stop("아현", "2호선", 37.5573, 126.956), actual: line2))
        #expect(!journeyNeedsLineQualifier(designated: stop("신촌", "수도권2호선", 37.5598, 126.9426), actual: line2))
    }

    // MARK: 쪽 판정(결과 화면 제목) — 손으로 만든 변형

    private func leg(_ mode: String, _ from: String?, _ to: String?, line: String? = nil,
                     at: (Double, Double)? = nil, end: (Double, Double)? = nil) -> TransitRouteLeg {
        let stops: [TransitLegStop]? = at.map { a in
            [TransitLegStop(name: from ?? "", lat: a.0, lng: a.1),
             TransitLegStop(name: to ?? "", lat: (end ?? a).0, lng: (end ?? a).1)]
        }
        return TransitRouteLeg(
            mode: mode, lineName: line, fromName: from, toName: to, stationCount: nil, minutes: 5,
            serviceStatus: nil, firstServiceTime: nil, lastServiceTime: nil, stops: stops)
    }

    private func variant(_ kind: JourneyVariantKind, _ legs: [TransitRouteLeg]) -> JourneyVariant {
        JourneyVariant(
            kind: kind, boardStation: nil, alightStation: nil, taxiIn: nil,
            transit: TransitRoute(
                summary: TransitRouteSummary(
                    totalMinutes: 20, fare: 1550, transfers: 0, walkMinutes: 0, departName: nil, arriveName: nil),
                legs: legs, routeKey: "p0"),
            egress: nil, totals: JourneyTotals(minutes: 20, taxiFare: 0, transitFare: 1550))
    }

    private let sinchonGyeongui = RecentStation(label: "신촌역", lat: 37.5598, lng: 126.9426, line: "경의중앙선", kind: nil)
    private let seoulKtx = RecentStation(label: "서울역", lat: 37.5547, lng: 126.9707, line: nil, kind: nil)
    private let gwanghwamun = RecentStation(label: "광화문역", lat: 37.5710, lng: 126.9768, line: "5호선", kind: nil)

    @Test func boardHomonymQualifiesBoardSideOnly() {
        let rec = variant(.recommended, [
            leg("walk", nil, "신촌"),
            leg("subway", "신촌", "광화문", line: "수도권 2호선", at: (37.5552, 126.9369), end: (37.5710, 126.9768)),
        ])
        let result = JourneyResult(variants: [rec], designatedMissing: JourneyDesignatedMissing(side: .board))
        let lines = journeyLineQualifiers(result, board: sinchonGyeongui, alight: nil)
        #expect(lines == JourneyLineQualifiers(board: true, alight: false))
        #expect(journeyRecommendedTitleIsBoardSide(rec, board: sinchonGyeongui, alight: nil, lines: lines))
    }

    /// 코드 리뷰 m2 반례: 두 역을 다 정했고 하차 쪽만 안 맞았다. 추천은 고른 서울역(힌트 없음)에서 타고 다른 역에서 내린다 —
    /// 승차 쪽에 노선을 붙이지 않고, 제목은 다른 쪽인 하차 쪽이다.
    @Test func sameStationWithUnknownLineIsNotHomonym() {
        let rec = variant(.recommended, [
            leg("subway", "서울역", "종각", line: "수도권 1호선", at: (37.5546, 126.9720), end: (37.5702, 126.9831)),
        ])
        let result = JourneyResult(variants: [rec], designatedMissing: JourneyDesignatedMissing(side: .alight))
        let lines = journeyLineQualifiers(result, board: seoulKtx, alight: gwanghwamun)
        #expect(lines == JourneyLineQualifiers(board: false, alight: false))
        #expect(!journeyRecommendedTitleIsBoardSide(rec, board: seoulKtx, alight: gwanghwamun, lines: lines))
    }

    /// 칸에 고른 역으로 비교한다: 지정 역 경로는 공덕 경의중앙선에서 타지만 칸(힌트 없는 공덕)과 같은 자리인 추천의 5호선 공덕은
    /// 서버가 같은 역으로 본다 — 승차 쪽에 붙지 않는다. 하차는 경의중앙선 신촌(칸) vs 2호선 신촌(추천)이라 붙고 제목은 하차 쪽.
    @Test func alightHomonymComparesAgainstChosenStation() {
        let designated = variant(.designated, [
            leg("subway", "공덕", "신촌", line: "경의중앙선", at: (37.5440, 126.9516), end: (37.5598, 126.9426)),
        ])
        let rec = variant(.recommended, [
            leg("subway", "공덕", "충정로", line: "수도권 5호선", at: (37.5440, 126.9516), end: (37.5600, 126.9636)),
            leg("subway", "충정로", "신촌", line: "수도권 2호선", at: (37.5600, 126.9636), end: (37.5552, 126.9369)),
            leg("walk", "신촌", nil),
        ])
        let gongdeok = RecentStation(label: "공덕역", lat: 37.5440, lng: 126.9516, line: nil, kind: nil)
        let result = JourneyResult(variants: [designated, rec], designatedMissing: nil)
        let lines = journeyLineQualifiers(result, board: gongdeok, alight: sinchonGyeongui)
        #expect(lines == JourneyLineQualifiers(board: false, alight: true))
        #expect(!journeyRecommendedTitleIsBoardSide(rec, board: gongdeok, alight: sinchonGyeongui, lines: lines))
    }

    /// 탈것이 둘 이상이어도 승차 쪽은 첫 탈것으로 가른다(재리뷰 m5 — `.first` → `.last` 변이 검출).
    @Test func boardHomonymUsesFirstVehicleAmongSeveral() {
        let rec = variant(.recommended, [
            leg("subway", "신촌", "충정로", line: "수도권 2호선", at: (37.5552, 126.9369), end: (37.5600, 126.9636)),
            leg("subway", "충정로", "광화문", line: "수도권 5호선", at: (37.5600, 126.9636), end: (37.5710, 126.9768)),
        ])
        let result = JourneyResult(variants: [rec], designatedMissing: JourneyDesignatedMissing(side: .board))
        #expect(journeyLineQualifiers(result, board: sinchonGyeongui, alight: nil) == JourneyLineQualifiers(board: true))
    }

    @Test func busSideIsNeverQualified() {
        let rec = variant(.recommended, [
            leg("bus", "신촌", "광화문", line: "7612", at: (37.5552, 126.9369), end: (37.5710, 126.9768)),
        ])
        let result = JourneyResult(variants: [rec], designatedMissing: JourneyDesignatedMissing(side: .board))
        #expect(journeyLineQualifiers(result, board: sinchonGyeongui, alight: nil) == JourneyLineQualifiers())
    }

    /// 코드 리뷰 m4: 앞뒤 도보를 건너 탈것으로 가르고, 승차·하차 쪽이 서로 다르게 나온다.
    @Test func busStopEndsSkipWalkAndDifferBySide() {
        let busFirst = variant(.recommended, [
            leg("walk", nil, "정류장"), leg("bus", "정류장", "역", line: "472"), leg("subway", "역", "광화문", line: "5호선"),
            leg("walk", "광화문", nil),
        ])
        #expect(busFirst.boardsAtBusStop)
        #expect(!busFirst.alightsAtBusStop)
        let busLast = variant(.recommended, [
            leg("walk", nil, "역"), leg("subway", "역", "환승", line: "2호선"), leg("bus", "환승", "정류장", line: "472"),
        ])
        #expect(!busLast.boardsAtBusStop)
        #expect(busLast.alightsAtBusStop)
    }

    // MARK: 버스 정류장 지정(E70-e)

    private struct BusStopKeyFile: Decodable {
        struct Name: Decodable { let name: String; let key: String }
        struct Pairs: Decodable { let names: [Name] }
        let busStops: Pairs
    }

    /// 웹 `busStopKey`와 같은 공유 fixture 표 전체를 읽는다.
    @Test func busStopKeyMatchesSharedTable() throws {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        url.appendPathComponent("src/lib/__tests__/fixtures/journey-station-pairs.json")
        let file = try JSONDecoder().decode(BusStopKeyFile.self, from: Data(contentsOf: url))
        #expect(!file.busStops.names.isEmpty)
        for c in file.busStops.names {
            #expect(journeyBusStopKey(c.name) == c.key, "\(c.name)")
        }
        // 짝 없는 여는 괄호는 그대로 남는다(웹 정규식 `\([^)]*\)`와 같다)
        #expect(journeyBusStopKey("가(나") == "가(나")
    }

    @Test func busStopSideSkipsLineQualifierAndComparesByKey() {
        let stopBoard = RecentStation(label: "강남역.삼성전자", lat: 37.4979, lng: 127.0276, line: nil, kind: .busStop)
        // 표시 이름이 역과 같고(「강남」) 600m 이상 떨어진 정류장 — 가드가 없으면 동명 이역으로 보고 노선 머리말이 붙는다
        let sameNameStop = RecentStation(label: "강남역", lat: 37.4979, lng: 127.0276, line: nil, kind: .busStop)
        let far = variant(.recommended, [
            leg("subway", "강남", "역삼", line: "수도권 5호선", at: (37.5049, 127.0276), end: (37.5007, 127.0364)),
        ])
        let farResult = JourneyResult(variants: [far], designatedMissing: JourneyDesignatedMissing(side: .board))
        #expect(journeyLineQualifiers(farResult, board: sameNameStop, alight: nil) == JourneyLineQualifiers())
        let farAlight = variant(.recommended, [
            leg("subway", "역삼", "강남", line: "수도권 5호선", at: (37.5007, 127.0364), end: (37.5049, 127.0276)),
        ])
        let farAlightResult = JourneyResult(variants: [farAlight], designatedMissing: JourneyDesignatedMissing(side: .alight))
        #expect(journeyLineQualifiers(farAlightResult, board: nil, alight: sameNameStop) == JourneyLineQualifiers())
        let otherKey = variant(.recommended, [leg("bus", "논현사거리", "역삼", line: "112")])
        let alightStop = RecentStation(label: "역삼역", lat: 37.5007, lng: 127.0364, line: nil, kind: .busStop)
        // 승차는 같은 키, 하차는 다른 키 → 하차 쪽 제목
        let toOther = variant(.recommended, [leg("bus", "강남역", "다른정류장", line: "112")])
        #expect(!journeyRecommendedTitleIsBoardSide(toOther, board: stopBoard, alight: alightStop, lines: .init()))
        // 승차가 다른 키 → 승차 쪽 제목
        #expect(journeyRecommendedTitleIsBoardSide(otherKey, board: stopBoard, alight: nil, lines: .init()))
    }

    @Test func qualifiedNamePrefixesKnownLineOnly() {
        #expect(journeyQualifiedStationName("신촌", line: "수도권 2호선") == "2호선 신촌")
        #expect(journeyQualifiedStationName("신촌역", line: "경의중앙선") == "경의중앙선 신촌")
        #expect(journeyQualifiedStationName("서울역", line: nil) == "서울")
    }
}

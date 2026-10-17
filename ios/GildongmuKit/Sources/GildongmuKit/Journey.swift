import Foundation

// E70 여정(택시 → 대중교통 → 택시) 전이 표 — spec 2026-10-17-e70-mode-change-journey-design.md §6.1 · plan Task 4.
// 순수 함수라 앱의 `GuideSession`이 소유하는 상태 위에서 실기기 없이 전수 테스트한다. 첫 판은 iOS 실험판 전용이라
// 안드로이드 미이식(등록부 pending). 웹 대응물은 표시 이름 함수 `displayStationName`(src/lib/journey/display.ts)뿐이다.

/// 여정 안내 단계. 앞 셋과 뒤 둘 사이의 준비 구간은 `JourneyPhase.transitioning`이 나타낸다.
public enum JourneyStage: String, Sendable, Hashable {
    case taxiIn, access, transit, egress, taxiOut
}

public enum JourneyPhase: Equatable, Sendable {
    /// 그 단계의 세션이 도는 중.
    case running(JourneyStage)
    /// 다음 세션을 준비하는 중(측위·경로 조회·인계 지연).
    case transitioning(to: JourneyStage)
    /// 그 단계를 시작하지 못했거나 중간에 끊긴 채 사용자의 결정을 기다리는 중.
    case failed(at: JourneyStage)
}

/// 사건이 자기가 관측한 상태를 들고 오는 표식. 지금 상태와 다르면 낡은 사건이라 무시된다.
public struct JourneyToken: Hashable, Sendable {
    public let journeyId: UUID
    public let seq: Int

    public init(journeyId: UUID, seq: Int) {
        self.journeyId = journeyId
        self.seq = seq
    }
}

/// 시작 때 정해지는 여정의 모양 — 전이 표의 갈래를 가른다.
public struct JourneyShape: Equatable, Sendable {
    /// 승차 역을 지정해 택시 앞 구간이 있다(없으면 대중교통부터 시작).
    public let startsWithTaxi: Bool
    /// 하차 역을 지정했다(아니면 대중교통 끝이 여정의 끝).
    public let alightDesignated: Bool
    /// 하차 뒤 출구·승강장까지 걷는 구간이 있다(후보 `none`이면 곧장 택시).
    public let hasEgressWalk: Bool

    public init(startsWithTaxi: Bool, alightDesignated: Bool, hasEgressWalk: Bool) {
        self.startsWithTaxi = startsWithTaxi
        self.alightDesignated = alightDesignated
        self.hasEgressWalk = hasEgressWalk
    }
}

public struct JourneyState: Equatable, Sendable {
    public let journeyId: UUID
    public let shape: JourneyShape
    public let phase: JourneyPhase
    /// 전이마다 1씩 오른다. 시작 상태는 1.
    public let seq: Int

    public init(journeyId: UUID, shape: JourneyShape, phase: JourneyPhase, seq: Int) {
        self.journeyId = journeyId
        self.shape = shape
        self.phase = phase
        self.seq = seq
    }

    public var token: JourneyToken { JourneyToken(journeyId: journeyId, seq: seq) }

    public static func start(id: UUID, shape: JourneyShape) -> JourneyState {
        JourneyState(
            journeyId: id, shape: shape,
            phase: .transitioning(to: shape.startsWithTaxi ? .taxiIn : .transit), seq: 1)
    }
}

/// 단계 세션이 끝난 사유. 앱 `BeaconModel.EndReason` 넷과 1:1이다 — 빠진 사유가 있으면 세션은 사라지고 여정만 남는다.
public enum JourneyStageEnd: Sendable, Hashable {
    case arrived, userStopped, startFailed, ended
}

public enum JourneyEvent: Equatable, Sendable {
    case stageEnded(JourneyStageEnd)
    /// 「자동차에서 내렸어요」
    case taxiDropped
    /// 「자동차에 탔어요」
    case taxiBoarded
    /// 대중교통 마지막 탈것을 내렸다(말미 도보 유무와 무관).
    case rideCompleted
    /// 대중교통 세션이 완주 말고 끝났다.
    case transitStopped
    case prepared(JourneyStage)
    case prepFailed
    case retry
    case userEnded
    /// `transitioning`이 `JourneyTuning.staleTransitionSeconds`를 넘겼다.
    case staleTimeout
}

public enum JourneyStepResult: Equatable, Sendable {
    case ignore
    case next(JourneyState)
    case end
}

public enum JourneyTuning {
    /// 접근 도보는 인계 시점 위치에서 승차 지점까지 직선이 이 값 이상일 때만 만든다(30m 미만은 생략).
    public static let accessWalkMinMeters = 30.0
    /// 단계 사이 인계 지연(ms) — 앞 통지가 끝나기를 기다리는 시간.
    public static let handoffDelayMs = 600
    /// 사이 상태(`transitioning`)에 머무를 수 있는 상한(초). 넘기면 `staleTimeout`.
    public static let staleTransitionSeconds = 30
    /// 같은 이름 정류를 같은 역으로 볼 좌표 반경(m) — 서버 `JOURNEY_STATION_IDENTITY_M`(src/lib/journey/station-identity.ts)과
    /// 같은 값. 제목의 동명 이역 노선 머리말(`journeyNeedsLineQualifier`)이 쓴다.
    public static let stationIdentityMeters = 500.0
}

/// 전이 표. `token`이 지금 상태와 다르면 무시한다 — 자동 도착 판정과 버튼이 같은 상태를 보고 둘 다 오면
/// 첫 사건만 전이하고 두 번째는 낡은 token이라 버려진다. `.next`는 언제나 seq + 1.
public func journeyStep(_ state: JourneyState, _ event: JourneyEvent, token: JourneyToken) -> JourneyStepResult {
    guard token == state.token else { return .ignore }
    if event == .userEnded { return .end }

    func go(_ phase: JourneyPhase) -> JourneyStepResult {
        .next(JourneyState(journeyId: state.journeyId, shape: state.shape, phase: phase, seq: state.seq + 1))
    }

    switch (state.phase, event) {
    case (.running(.taxiIn), .stageEnded(.arrived)), (.running(.taxiIn), .taxiDropped):
        return go(.transitioning(to: .access))
    case (.running(.taxiIn), .stageEnded(.startFailed)), (.running(.taxiIn), .stageEnded(.ended)):
        return go(.failed(at: .taxiIn))

    // 접근 도보는 도착·시작 실패·끊김 모두 대중교통으로 이어진다(역 근처라 대중교통 세션이 이어받는다).
    case (.running(.access), .stageEnded(.arrived)), (.running(.access), .stageEnded(.startFailed)),
         (.running(.access), .stageEnded(.ended)):
        return go(.transitioning(to: .transit))

    case (.running(.transit), .rideCompleted):
        guard state.shape.alightDesignated else { return .end }
        return go(.transitioning(to: state.shape.hasEgressWalk ? .egress : .taxiOut))
    case (.running(.transit), .transitStopped):
        return .end
    // 대중교통 세션이 서지 않았다(경로 변환 실패·불변식 위반) — 세션 없는 running에 남지 않게 실패 시트로(재시도 가능).
    case (.running(.transit), .stageEnded(.startFailed)):
        return go(.failed(at: .transit))

    case (.running(.egress), .stageEnded(.arrived)), (.running(.egress), .taxiBoarded):
        return go(.transitioning(to: .taxiOut))
    case (.running(.egress), .stageEnded(.startFailed)), (.running(.egress), .stageEnded(.ended)):
        return go(.failed(at: .egress))

    case (.running(.taxiOut), .stageEnded(.startFailed)):
        return go(.failed(at: .taxiOut))
    case (.running(.taxiOut), .stageEnded):
        return .end

    // 그 단계의 「안내 종료」는 여정 전체 종료(taxiIn·access·egress)
    case (.running(.taxiIn), .stageEnded(.userStopped)), (.running(.access), .stageEnded(.userStopped)),
         (.running(.egress), .stageEnded(.userStopped)):
        return .end

    case (.transitioning(let stage), .prepared(let prepared)) where prepared == stage:
        return go(.running(stage))
    case (.transitioning(to: .access), .prepared(.transit)):
        return go(.running(.transit))   // 30m 미만 접근 도보 생략
    // access 시작 실패는 막힌 화면이 아니라 대중교통 세션을 바로 시작한다(spec §6.4).
    case (.transitioning(to: .access), .prepFailed), (.transitioning(to: .access), .staleTimeout):
        return go(.transitioning(to: .transit))
    case (.transitioning(let stage), .prepFailed), (.transitioning(let stage), .staleTimeout):
        return go(.failed(at: stage))

    case (.failed(let stage), .retry):
        return go(.transitioning(to: stage))
    case (.failed(at: .taxiIn), .taxiDropped):
        return go(.transitioning(to: .access))
    case (.failed(at: .egress), .taxiBoarded):
        return go(.transitioning(to: .taxiOut))

    default:
        return .ignore
    }
}

/// 접근 도보가 필요한가 — 인계 시점 위치에서 승차 지점까지 직선이 `accessWalkMinMeters` 이상.
public func journeyNeedsAccessWalk(fromLat: Double, fromLng: Double, toLat: Double, toLng: Double) -> Bool {
    haversineMeters(lat1: fromLat, lng1: fromLng, lat2: toLat, lng2: toLng) >= JourneyTuning.accessWalkMinMeters
}

/// 문장의 `{station}` 자리에 넣을 역 이름(웹 `displayStationName` 미러). 괄호 부기는 남기고, 공백 뒤 후행 노선 토큰
/// (…선·…철도·GTX-…)과 끝 「역」 한 글자를 뗀다(「서울역역」 방지). 이름이 「역」 하나뿐이면 그대로 둔다.
/// 이름 키 정규화(`stationNameKey`)를 표시용으로 재사용하지 않는다 — 그쪽은 괄호 부기까지 지운다.
/// ⚠ 정규식 약칭 클래스를 쓰지 않는다(안드로이드 이식 규칙) — 공백은 명시 문자로 가른다.
public func journeyStationDisplayName(_ name: String) -> String {
    var tokens = name.split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\n" }).map(String.init)
    while tokens.count > 1, let last = tokens.last, isTrailingLineToken(last) {
        tokens.removeLast()
    }
    // 이름이 「서울 역」처럼 갈라진 경우 떨어져 나온 「역」 토큰은 통째로 뗀다(뒤 공백이 남지 않게).
    if tokens.count > 1, tokens.last == "역" {
        tokens.removeLast()
        return tokens.joined(separator: " ")
    }
    var out = tokens.joined(separator: " ")
    if out.count > 1, out.hasSuffix("역") { out.removeLast() }
    return out
}

private func isTrailingLineToken(_ token: String) -> Bool {
    token.hasSuffix("선") || token.hasSuffix("철도") || token.hasPrefix("GTX-")
}

// MARK: 탈것 종류와 동명 이역 노선 머리말

public extension JourneyVariant {
    /// 대중교통 구간이 버스 정류장에서 시작한다 — 택시 앞 구간 줄·도착 문장이 「역」을 붙이지 않는다(판정 5).
    var boardsAtBusStop: Bool { transit.legs.first { $0.mode != "walk" }?.mode == "bus" }
    /// 대중교통 구간이 버스 정류장에서 끝난다.
    var alightsAtBusStop: Bool { transit.legs.last { $0.mode != "walk" }?.mode == "bus" }
}

/// 제목 머리에 붙일 노선 이름(「2호선」·「경의중앙선」). 카카오 힌트(`수도권2호선`)와 ODsay `lineName`(`수도권 2호선`·
/// `수도권 수인.분당선`·`…(급행)`)을 같은 꼴로 만든다: 공백·마침표 제거, `수도권` 접두·`(급행)` 꼬리 제거(`subwayLineIdentity`와
/// 같은 정규화). 빈 값은 nil.
public func journeyLineLabel(_ raw: String?) -> String? {
    guard let raw else { return nil }
    var s = String(raw.filter { $0 != " " && $0 != "." && $0 != "\t" })
    if s.hasPrefix("수도권") { s.removeFirst(3) }
    if s.hasSuffix("(급행)") { s.removeLast(4) }
    return s.isEmpty ? nil : s
}

private let journeyRegionPrefixes = ["수도권", "부산", "대구", "광주", "대전"]

private func isJourneySeparator(_ c: Character) -> Bool {
    c == " " || c == "\t" || c == "\n" || c == "." || c == "·"
}

/// 웹 `lineHintMatches`(src/lib/station-match.ts) 이식: 「철도·호선·선」 꼬리 하나를 뗀 코어의 상호 접두 일치, 코어가 숫자뿐이면
/// 완전 일치(「1호선」 ≠ 「11호선」). ⚠ 정규식 약칭·Foundation 공백 집합을 쓰지 않는다(안드로이드 이식 규칙).
func journeyLineHintMatches(_ lineName: String, _ lineHint: String) -> Bool {
    func core(_ s: String) -> String {
        var t = s.lowercased()
        while let f = t.first, isJourneySeparator(f) { t.removeFirst() }
        while let l = t.last, isJourneySeparator(l) { t.removeLast() }
        for suffix in ["철도", "호선", "선"] where t.hasSuffix(suffix) {
            t.removeLast(suffix.count)
            break
        }
        return String(t.filter { !isJourneySeparator($0) })
    }
    let a = core(lineName)
    let b = core(lineHint)
    guard !a.isEmpty, !b.isEmpty else { return false }
    let digits: (String) -> Bool = { $0.allSatisfy { "0123456789".contains($0) } }
    if digits(a) || digits(b) { return a == b }
    return a == b || a.hasPrefix(b) || b.hasPrefix(a)
}

/// 두 노선 표기가 같은 노선인가 — 서버 `sameLine`(src/lib/journey/station-identity.ts)과 같은 판정 순서다(공유 fixture
/// `journey-line-names.json`이 잠근다). 한쪽만 비수도권 지역 접두(`부산 2호선`)이고 다른 쪽이 지역 없는 맨 번호(`2호선` —
/// 카카오 출구 힌트는 지역을 싣지 않는다)면 코어끼리, 노선명 표(`subwayLineIdentity`)에 둘 다 있으면 표 값끼리, 지역 접두가
/// 둘 다 있고 다르면 다른 노선, 아니면 코어끼리 `journeyLineHintMatches`. `수도권`도 지역 접두로 읽는다(떼고 읽으면
/// `부산1호선` ↔ `수도권 1호선`이 같은 노선이 된다).
func journeySameLine(_ a: String, _ b: String) -> Bool {
    func split(_ raw: String) -> (region: String?, core: String) {
        var s = raw
        while let l = s.last, isJourneySeparator(l) { s.removeLast() }
        if s.hasSuffix("(급행)") { s.removeLast(4) }
        while let f = s.first, isJourneySeparator(f) { s.removeFirst() }
        var region: String?
        for r in journeyRegionPrefixes where s.hasPrefix(r) {
            region = r
            s.removeFirst(r.count)
            break
        }
        return (region, String(s.filter { !isJourneySeparator($0) }))
    }
    let fa = split(a)
    let fb = split(b)
    let regional: (String?) -> Bool = { $0 != nil && $0 != "수도권" }
    if (regional(fa.region) && fb.region == nil) || (regional(fb.region) && fa.region == nil) {
        return journeyLineHintMatches(fa.core, fb.core)
    }
    if let ia = subwayLineIdentity(a), let ib = subwayLineIdentity(b) { return ia == ib }
    if let ra = fa.region, let rb = fb.region, ra != rb { return false }
    return journeyLineHintMatches(fa.core, fb.core)
}

/// 동명 이역 판정에 쓰는 정류 하나 — 이름·노선(모르면 nil)·좌표.
public struct JourneyStopIdentity: Equatable, Sendable {
    public let name: String
    public let line: String?
    public let lat: Double
    public let lng: Double

    public init(name: String, line: String?, lat: Double, lng: Double) {
        self.name = name
        self.line = line
        self.lat = lat
        self.lng = lng
    }
}

/// 지정 역과 실제로 타는(내리는) 역의 제목에 노선을 붙이는가(판정 26): 표시 이름이 같고 다른 역일 때만. 다른 역의 근거는
/// 서버 같은 역 판정(spec §4.3)과 같다 — 노선을 둘 다 알면 노선이 다를 때, 하나라도 모르면 좌표가
/// `JourneyTuning.stationIdentityMeters`보다 멀 때(동명 이역 신촌 680m대). 두 역을 다 지정한 여정에서 추천 경로가
/// 고른 바로 그 역에서 탈 수 있으므로(다른 쪽이 안 맞아 지정 역 경로가 아니었을 뿐) "이름이 같으면 다른 역"으로 보지 않는다.
public func journeyNeedsLineQualifier(designated: JourneyStopIdentity, actual: JourneyStopIdentity) -> Bool {
    guard journeyStationDisplayName(designated.name) == journeyStationDisplayName(actual.name) else { return false }
    if let a = designated.line, let b = actual.line, journeyLineLabel(a) != nil, journeyLineLabel(b) != nil {
        return !journeySameLine(a, b)
    }
    return haversineMeters(lat1: designated.lat, lng1: designated.lng, lat2: actual.lat, lng2: actual.lng)
        > JourneyTuning.stationIdentityMeters
}

/// 문장의 `{station}` 자리 이름에 노선 머리말을 붙인다(「2호선 신촌」). 노선을 모르면 표시 이름만.
public func journeyQualifiedStationName(_ name: String, line: String?) -> String {
    let display = journeyStationDisplayName(name)
    guard let label = journeyLineLabel(line) else { return display }
    return "\(label) \(display)"
}

/// 동명 이역 노선 머리말을 붙일 쪽(판정 26). 그 쪽의 지정 역 제목(또는 못 찾음 줄)과 추천 제목에 함께 붙는다.
public struct JourneyLineQualifiers: Equatable, Sendable {
    public var board: Bool
    public var alight: Bool

    public init(board: Bool = false, alight: Bool = false) {
        self.board = board
        self.alight = alight
    }
}

/// 추천 변형의 그 쪽 지하철 정류가 칸에 고른 역과 이름은 같고 다른 역인가. 비교 대상은 서버 같은 역 판정과 같이 칸의 값(이름·
/// 노선 힌트·좌표)이다 — 지정 역 경로의 탈것 노선으로 비교하면 서버가 같은 역으로 인정한 추천 승차역(힌트 없는 칸)에도 노선이
/// 붙는다. 버스는 제목이 이미 「버스」를 말해 가를 필요가 없다. 정류 좌표를 모르면 붙이지 않는다(평소 문장이 기본).
public func journeyLineQualifiers(
    _ result: JourneyResult, board: RecentStation?, alight: RecentStation?
) -> JourneyLineQualifiers {
    guard let recommended = result.variants.first(where: { $0.kind == .recommended }) else { return .init() }
    func vehicles(_ v: JourneyVariant?) -> [TransitRouteLeg] { v?.transit.legs.filter { $0.mode != "walk" } ?? [] }
    func stop(_ leg: TransitRouteLeg?, from: Bool, ref: JourneyStationRef?) -> JourneyStopIdentity? {
        guard let leg, leg.mode != "bus", let name = from ? leg.fromName : leg.toName else { return nil }
        let stop = from ? leg.stops?.first : leg.stops?.last
        guard let lat = stop?.lat ?? ref?.coord.lat, let lng = stop?.lng ?? ref?.coord.lng else { return nil }
        return JourneyStopIdentity(name: name, line: leg.lineName, lat: lat, lng: lng)
    }
    func chosen(_ station: RecentStation) -> JourneyStopIdentity {
        JourneyStopIdentity(name: station.label, line: station.line, lat: station.lat, lng: station.lng)
    }
    var out = JourneyLineQualifiers()
    if let board, let actual = stop(vehicles(recommended).first, from: true, ref: recommended.boardStation) {
        out.board = journeyNeedsLineQualifier(designated: chosen(board), actual: actual)
    }
    if let alight, let actual = stop(vehicles(recommended).last, from: false, ref: recommended.alightStation) {
        out.alight = journeyNeedsLineQualifier(designated: chosen(alight), actual: actual)
    }
    return out
}

/// 추천 변형 제목이 승차 쪽을 말하는가(spec §8.4 조합 규칙): 승차 쪽이 지정 역과 다르거나(이름, 또는 동명 이역) 하차 쪽도
/// 같을 때. 아니면(하차 쪽만 다르면) 하차 쪽 제목이다.
public func journeyRecommendedTitleIsBoardSide(
    _ v: JourneyVariant, board: RecentStation?, alight: RecentStation?, lines: JourneyLineQualifiers
) -> Bool {
    let vehicles = v.transit.legs.filter { $0.mode != "walk" }
    let display = journeyStationDisplayName
    let boardDiffers = board.map { display($0.label) != display(vehicles.first?.fromName ?? "") } ?? false
    let alightDiffers = alight.map { display($0.label) != display(vehicles.last?.toName ?? "") } ?? false
    return boardDiffers || lines.board || !(alightDiffers || lines.alight)
}

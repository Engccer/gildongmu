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
    /// 「택시에서 내렸어요」
    case taxiDropped
    /// 「택시에 탔어요」
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

/// 지정 역과 실제로 타는(내리는) 역의 제목에 노선을 붙이는가(판정 8): 표시 이름이 같고 노선이 다를 때만.
/// 한쪽 노선을 모르면 다르다고 본다 — 이름이 같은데 지정 역 경로가 아닌 정류는 서버가 이미 다른 역으로 판정한 것이다
/// (이름 키 + 좌표 500m + 노선, spec §4.3). 그때는 아는 쪽 노선만 붙는다(`journeyQualifiedStationName`).
public func journeyNeedsLineQualifier(
    designatedName: String, designatedLine: String?, actualName: String, actualLine: String?
) -> Bool {
    guard journeyStationDisplayName(designatedName) == journeyStationDisplayName(actualName) else { return false }
    guard let a = journeyLineLabel(designatedLine), let b = journeyLineLabel(actualLine) else { return true }
    return a != b
}

/// 문장의 `{station}` 자리 이름에 노선 머리말을 붙인다(「2호선 신촌」). 노선을 모르면 표시 이름만.
public func journeyQualifiedStationName(_ name: String, line: String?) -> String {
    let display = journeyStationDisplayName(name)
    guard let label = journeyLineLabel(line) else { return display }
    return "\(label) \(display)"
}

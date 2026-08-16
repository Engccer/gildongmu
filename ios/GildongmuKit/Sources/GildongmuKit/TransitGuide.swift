import Foundation

/// 대중교통 실시간 길 안내 상태 머신 — 웹 `src/lib/transit-guide.ts`의 1:1 미러
/// (B2 스펙 §4.2). 공유 fixture(`transit-guide-scenarios.json`)가 동조를 강제한다.
///
/// 입력은 GPS fix가 아니라 폴링 응답·사용자 액션·시각이다(RouteGuide 리듀서와
/// 별개). 판정은 전부 여기서 하고 앱 `TransitGuideModel`은 폴링 I/O·통지만 한다.
///
/// 핵심 계약(웹 원본 주석 참조): leg 전환은 사용자 확인(advance), 신호 상태는
/// 배타 enum(데이터 없음 ≠ 조회 실패), 잠금은 복합 키(식별자 원문 무변형),
/// phaseGen·seq 커밋(늦은 응답 폐기), 이벤트는 입력당 최대 1개(원자 전이).

public enum TransitTrackMode: String, Codable, Sendable {
    case seoulBus, tagoBus, subway
}

public enum TransitPhase: String, Sendable {
    case waiting, riding, arrived, done
}

public enum TransitSignal: String, Sendable {
    /// neverSeen: 잠금 이후 한 번도 관측되지 않은 채 상한 경과(A16 L2).
    /// signalLost(관측되다 소실)와 원인도 사용자 행동도 다르다 — 합치지 말 것.
    case tracking, notYetVisible, neverSeen, signalLost, upstreamFailed, untrackable
}

/// 잠금·매칭 복합 키(§4.2). vehicleId "" = 근사 잠금(차량 식별자 부재, §13.2).
public struct TransitLock: Codable, Sendable, Equatable {
    public let mode: TransitTrackMode
    public let routeId: String
    public let direction: String
    public let vehicleId: String

    public init(mode: TransitTrackMode, routeId: String, direction: String, vehicleId: String) {
        self.mode = mode
        self.routeId = routeId
        self.direction = direction
        self.vehicleId = vehicleId
    }
}

/// 근사 잠금 판별(§13.2): tagoBus(식별자 자체가 없다)와 "이미 탑승했습니다"
/// (seoulBus·subway에서 식별자 없이 선언)가 같은 소비 한계를 상속한다 —
/// arrived 전이 금지·advance 상시·기준 차량 교체 통지·근사 주석.
public func isApproxTransitLock(_ lock: TransitLock) -> Bool {
    lock.vehicleId.isEmpty
}

/// 안내 대상으로 조립된 탑승 leg(§4.1). 도보 leg는 대기 문맥으로 흡수된다.
public struct TransitGuideLeg: Codable, Sendable {
    public let mode: String // "bus" | "subway"
    public let lineName: String
    /// nil = 추적 불가(비수도권 지하철·정보 결손) — 수동 전진만 가능.
    public let trackMode: TransitTrackMode?
    public let boardName: String
    public let alightName: String
    public let boardStop: TransitLegStop?
    public let alightStop: TransitLegStop?
    /// 경유 전체(양 끝 포함, includeStops 미보유 시 []) — 종착 검사(§5.1) 축.
    public let viaStops: [TransitLegStop]
    public let stationCount: Int?
    public let routeId: String?
    public let wayCode: Int?
    public let walkBeforeMinutes: Int?
    /// 하차역 빠른하차 문 위치(E5). 판정 불가·미커버는 nil.
    public let quickExit: QuickExit?

    public init(
        mode: String, lineName: String, trackMode: TransitTrackMode?,
        boardName: String, alightName: String,
        boardStop: TransitLegStop?, alightStop: TransitLegStop?,
        viaStops: [TransitLegStop], stationCount: Int?,
        routeId: String?, wayCode: Int?, walkBeforeMinutes: Int?,
        quickExit: QuickExit? = nil
    ) {
        self.mode = mode
        self.lineName = lineName
        self.trackMode = trackMode
        self.boardName = boardName
        self.alightName = alightName
        self.boardStop = boardStop
        self.alightStop = alightStop
        self.viaStops = viaStops
        self.stationCount = stationCount
        self.routeId = routeId
        self.wayCode = wayCode
        self.walkBeforeMinutes = walkBeforeMinutes
        self.quickExit = quickExit
    }
}

public struct TransitGuideRoute: Codable, Sendable {
    public let legs: [TransitGuideLeg]
    /// 마지막 하차 뒤 목적지까지 도보(분) — 완료 문구 분기(§4.1).
    public let walkAfterMinutes: Int?

    public init(legs: [TransitGuideLeg], walkAfterMinutes: Int?) {
        self.legs = legs
        self.walkAfterMinutes = walkAfterMinutes
    }
}

/// 폴링 항목(`/api/transit/track` 판별 union의 투영, §7). message는 완성 문장이되
/// **upstream 원문이라고 가정하지 말 것** — 서울버스 승차 국면은 서버가 잔여 꼬리를
/// 떼고 어미를 다듬어 내려보낸다(웹 `transit-track.ts`의 `rewriteBusArrivalMessage`).
public struct TransitTrackItem: Codable, Sendable, Equatable {
    public let vehicleId: String?
    public let direction: String
    public let message: String
    /// 잔여 정거장 수(§6.2 서버 추출). 실패는 nil(사다리만 비활성).
    public let remainingStops: Int?
    public let destinationName: String?
    public let express: Bool
    public let arrivalCode: String?
    /// 현재 위치 역명(지하철 arvlMsg3, §12.2) — 미제공 수단은 nil.
    public let currentLocation: String?
    /// 데이터 수신 시각 원문(recptnDt, §12.1 스냅숏 정체성) — 미제공은 nil.
    public let dataStamp: String?
    /// 데이터 나이(초, 서버 계산·클램프). nil = 미제공·동결 판정 불가(§12.1 ⓑ).
    public let dataAgeSeconds: Int?

    public init(
        vehicleId: String?, direction: String, message: String, remainingStops: Int?,
        destinationName: String?, express: Bool, arrivalCode: String?,
        currentLocation: String? = nil, dataStamp: String? = nil, dataAgeSeconds: Int? = nil
    ) {
        self.vehicleId = vehicleId
        self.direction = direction
        self.message = message
        self.remainingStops = remainingStops
        self.destinationName = destinationName
        self.express = express
        self.arrivalCode = arrivalCode
        self.currentLocation = currentLocation
        self.dataStamp = dataStamp
        self.dataAgeSeconds = dataAgeSeconds
    }
}

public enum TransitTrackPoll: Sendable {
    case ok([TransitTrackItem])
    case empty
    case unsupported
    case failed
}

/// 대기 목록 0건 사유(§13.3): 진짜 0건 / 필터 전멸(rawCount>0) / 조회 실패·미지원.
public enum TransitWaitingEmptyReason: String, Sendable {
    case none, filtered, unavailable
}

/// 대기 폴 결과 → 0건 사유 판정(§13.3) — 웹 `waitingEmptyReason` 미러.
public func transitWaitingEmptyReason(
    poll: TransitTrackPoll, rawCount: Int?
) -> TransitWaitingEmptyReason? {
    switch poll {
    case let .ok(items) where !items.isEmpty: nil
    case .ok, .empty: (rawCount ?? 0) > 0 ? .filtered : TransitWaitingEmptyReason.none
    case .unsupported, .failed: .unavailable
    }
}

public enum TransitGuideInput: Sendable {
    case poll(seq: Int, phaseGen: Int, poll: TransitTrackPoll)
    case board(TransitLock)
    case changeBoarding
    case advance
}

/// 구조화 안내 이벤트 — 문구 조립은 앱 몫(GuideText), 완성 문장은 원문 병치(§6.1).
public enum TransitGuideEvent: Sendable, Equatable {
    case boarded(legIndex: Int)
    case trackingStarted(message: String, remaining: Int?)
    case countdown(remaining: Int, message: String, currentLocation: String?)
    case messageChanged(message: String)
    case arrived(certain: Bool)
    case backOnTrack(message: String)
    case approxVehicleChanged(message: String)
    case signalLost
    case neverSeen
    case upstreamFailed
    case signalRecovered
    case legAdvanced(legIndex: Int, final: Bool)
    case boardingReset
    case capSlowed
}

public struct TransitGuideState: Sendable {
    public var legIndex: Int
    public var phase: TransitPhase
    public var phaseGen: Int
    public var lastSeq: Int
    public var signal: TransitSignal
    public var lock: TransitLock?
    /// 탑승 변경으로 해제한 직전 잠금(§13.1) — "탑승 변경 취소"의 복귀 대상.
    public var previousLock: TransitLock?
    public var remaining: Int?
    public var lastMessage: String?
    public var lastUpdatedAt: Double?
    /// 잠금 항목의 현재 위치 역명(arvlMsg3, §12.2) — countdown 병치·M3 탑승 위치 축.
    public var currentLocation: String?
    /// 잠금 항목의 recptnDt 원문(§12.1 스냅숏 정체성 — 동일 스냅숏 무정보 폴 판정).
    public var dataStamp: String?
    /// 데이터 나이(초, 서버 계산). nil = 미제공·동결 판정 불가(§12.1) — 표기 생략.
    public var dataAgeSeconds: Int?
    public var arrivedCertain: Bool
    public var ladderAnnounced: Int?
    public var trackingAnnounced: Bool
    /// riding 진입 시각(ms). 한 번도 관측되지 않은 채 `transitNeverSeenMs`를 넘기면
    /// neverSeen. ⚠ nil이면 판정하지 않는다 — "시각 불명"을 "방금 탔다"로도
    /// "오래됐다"로도 읽지 않는다.
    public var ridingSince: Double?
    public var missCount: Int
    public var failCount: Int
    public var failSince: Double?
    public var pollCount: Int
    public var capAnnounced: Bool
}

// === 상수 (§4.2·§7) — 웹 동일값 ===

public let transitLadderMax = 3
public let transitFailNotifyCount = 3
public let transitFailNotifyMs: Double = 90_000
public let transitMissLostCount = 3
public let transitMissArriveCount = 2
/// 첫 관측 전 미등장 상한(A16 L2). 관측된 뒤의 소실은 `transitMissLostCount`가 맡고
/// 이 축은 "한 번도 못 본" 상태 전용이라 두 축이 같은 결함을 잡지 않는다.
///
/// ⚠ 폴 횟수가 아니라 시간인 이유: 화면 잠금 중 폴 타이머가 멎으면 횟수 기반은
/// 화면을 끌수록 시한이 늦게 온다(실측 35분에 11폴, 주기 60초면 35폴이어야 한다).
/// ⚠ 10분은 잠정값 — 실승차 판정 대상(BACKLOG A16).
public let transitNeverSeenMs: Double = 600_000
public let transitSessionPollCap = 240

/// 폴링 주기(ms, §7 적응형). 0 = 폴링 없음(done·untrackable).
public func transitPollIntervalMs(_ state: TransitGuideState) -> Int {
    if state.phase == .done || state.signal == .untrackable { return 0 }
    if state.capAnnounced { return 60_000 }
    if state.phase == .waiting { return 20_000 }
    // riding·arrived(재관측 감시): 미등장 60s / 추적 중 15s(§12 — 원거리 30s 폐지).
    return state.trackingAnnounced ? 15_000 : 60_000
}

public enum TransitGuideTone: String, Sendable {
    case start, ladder, imminent, arrive, weak
}

/// 이벤트 → 통지 채널·톤 매핑(§6.1). 잔여 1·도착만 interrupting.
public func transitEventProfile(_ event: TransitGuideEvent) -> (interrupt: Bool, tone: TransitGuideTone?) {
    switch event {
    case let .countdown(remaining, _, _):
        return remaining <= 1 ? (true, .imminent) : (false, .ladder)
    case .arrived:
        return (true, .arrive)
    case .boarded, .legAdvanced:
        return (false, .start)
    case .trackingStarted:
        return (false, .ladder)
    case .signalLost, .neverSeen, .upstreamFailed:
        return (false, .weak)
    default:
        return (false, nil)
    }
}

// === 노선 매핑표 (§5.1) — 웹 ODSAY_SUBWAY_LINES 미러 ===

private let odsaySubwayLines: [String: String] = [
    "1호선": "1001", "2호선": "1002", "3호선": "1003", "4호선": "1004",
    "5호선": "1005", "6호선": "1006", "7호선": "1007", "8호선": "1008",
    "9호선": "1009", "GTX-A": "1032", "중앙선": "1061", "경의중앙선": "1063",
    "공항철도": "1065", "경춘선": "1067", "수인분당선": "1075", "신분당선": "1077",
    "경강선": "1081", "우이신설선": "1092", "서해선": "1093", "신림선": "1094",
]

private func subwayLineCore(_ name: String) -> String {
    var s = name
    if s.hasPrefix("수도권") { s = String(s.dropFirst(3)) }
    return s.replacingOccurrences(of: "[.·\\s]", with: "", options: .regularExpression)
        .trimmingCharacters(in: .whitespaces)
}

/// ODsay 지하철 노선명 → 서울 실시간 subwayId(미수록 = 실시간 미커버 = nil).
public func subwayIdForOdsayLine(_ lineName: String) -> String? {
    odsaySubwayLines[subwayLineCore(lineName)]
}

// === 경로 조립 (§4.1) — Kit TransitRoute(API 디코딩)에서 안내 경로로 ===

/// 탑승 leg의 추적 수단 분류(§5.1 매핑표·§5.2 판별자). 웹 classifyTrackMode 미러.
public func classifyTransitTrackMode(
    mode: String, lineName: String, serviceRouteId: String?,
    boardStop: TransitLegStop?, alightStop: TransitLegStop?
) -> TransitTrackMode? {
    if mode == "subway" {
        return subwayIdForOdsayLine(lineName) != nil ? .subway : nil
    }
    let topis = serviceRouteId != nil
        && boardStop?.cityCode == "1000" && alightStop?.cityCode == "1000"
        && boardStop?.arsId?.isEmpty == false
        && boardStop?.localId?.isEmpty == false
        && alightStop?.localId?.isEmpty == false
    if topis { return .seoulBus }
    if alightStop != nil, !lineName.isEmpty { return .tagoBus }
    return nil
}

/// TransitRoute(+stops) → 안내 경로. 탑승 leg가 없으면 nil(시작 게이트 축).
public func buildTransitGuideRoute(_ route: TransitRoute) -> TransitGuideRoute? {
    var legs: [TransitGuideLeg] = []
    var pendingWalk: Int?
    for leg in route.legs {
        if leg.mode == "walk" {
            pendingWalk = (pendingWalk ?? 0) + leg.minutes
            continue
        }
        let stops = leg.stops ?? []
        let boardStop = stops.first
        let alightStop = stops.count > 1 ? stops.last : nil
        legs.append(TransitGuideLeg(
            mode: leg.mode,
            lineName: leg.lineName ?? "",
            trackMode: classifyTransitTrackMode(
                mode: leg.mode, lineName: leg.lineName ?? "",
                serviceRouteId: leg.serviceRouteId,
                boardStop: boardStop, alightStop: alightStop),
            boardName: leg.fromName ?? boardStop?.name ?? "",
            alightName: leg.toName ?? alightStop?.name ?? "",
            boardStop: boardStop,
            alightStop: alightStop,
            viaStops: stops,
            stationCount: leg.stationCount,
            routeId: leg.serviceRouteId,
            wayCode: leg.serviceWayCode,
            walkBeforeMinutes: pendingWalk,
            quickExit: leg.quickExit
        ))
        pendingWalk = nil
    }
    if legs.isEmpty { return nil }
    return TransitGuideRoute(legs: legs, walkAfterMinutes: pendingWalk)
}

// === 열차 선택 목록 필터 (§5.1) — 순수 판정, 시트가 소비 ===

public struct TransitBoardingCandidate: Sendable {
    public let item: TransitTrackItem
    /// 종착이 하차역 이전 — 결정적 미도달이라 활성화 차단(§5.1).
    public let terminatesEarly: Bool
    public let express: Bool
    public let directionMatched: Bool

    // 목록 정체성 키는 소비자(시트·패널) 몫 — vehId, 없으면 슬롯 위치 폴백(§13.4.
    // 종전 완성 문장 폴백은 문장 갱신마다 remount를 만들어 폐기, 감사 L2).
}

/// 2호선 계열 방향 표기. 내선·외선은 2호선 본선 순환과 두 지선(성수·신정)만 쓰고,
/// **그 계열의 종착 필드는 잔여 경로 판정에 쓸 수 없다**(실호출 2026-08-16).
///
/// - 본선: 13개 역 52표본이 전부 `"성수"`인 **상수**라, 경유 목록에서 성수가
///   하차역보다 앞선 구간이 통째로 오차단됐다. 닫힌 고리엔 종착 검사가 기대는
///   전제("경유 순서 = 잔여 경로")가 없다 — 진행 방향 어느 역이든 앞에 있다.
/// - 지선: 종착이 `"성수지선"`·`"신도림지선"`(역명이 아님) 또는 `"신설동"`·`"까치산"`
///   (그 지선의 종점)이라 어느 쪽도 하차역보다 앞설 수 없다. 지선은 선형이지만
///   검사가 잡아낼 조기 종착이 애초에 존재하지 않아 제외해도 잃는 보호가 없다.
///
/// 웹 isLine2Direction 미러.
private func isLine2Direction(_ updnLine: String) -> Bool {
    updnLine == "내선" || updnLine == "외선"
}

/// wayCode(1 상행·2 하행) ↔ updnLine 원문 대응. **실호출로 확정한 표기만 판정**하고
/// 나머지는 유보한다(오필터가 과노출보다 나쁘다).
///
/// 순환선 대응(내선=2·외선=1)은 2026-08-16 실호출로 확정했다: 순환선 반대편 4개 역
/// 에서 뽑은 ODsay leg 8건이 방향별로 갈렸고, 13개 역 도착 표본 52건의 직전 역이
/// 같은 순환 순서를 어긋남 없이 따랐다. 웹 directionMatchesWayCode 미러.
private func directionMatchesWayCode(_ updnLine: String, _ wayCode: Int?) -> Bool? {
    guard let wayCode else { return nil }
    switch updnLine {
    case "상행", "외선": return wayCode == 1
    case "하행", "내선": return wayCode == 2
    default: return nil
    }
}

/// 승차 목록 후보 판정(§5.1): 방향은 보조(전멸 시 전체 유지), 종착 검사만 결정적 차단.
///
/// `directionUncertain`은 **"방향 축이 있는데 매칭이 전멸했다"**로 좁힌다(A17,
/// 2026-08-17). 후보 전원의 `direction`이 비어 있으면(버스 — upstream이 방향 필드를
/// 주지 않는다) 방향 축 자체가 없는 것이라 uncertain이 아니다. 종전엔 빈 문자열이
/// 매칭 실패로 분류돼 모든 버스 세션에 "방면을 확인해 주세요"가 붙었는데, 버스
/// 목록엔 방면 정보가 없어 확인할 대상 없는 지시문이었다. 웹 classifyBoardingCandidates 미러.
public func classifyTransitBoardingCandidates(
    _ items: [TransitTrackItem], leg: TransitGuideLeg
) -> (candidates: [TransitBoardingCandidate], directionUncertain: Bool) {
    let decorated = items.map { item in
        TransitBoardingCandidate(
            item: item,
            // 2호선 계열은 종착 검사에서 제외한다 — 그 종착 필드가 판정 근거가
            // 아니라 오차단원이기 때문이다(isLine2Direction 주석에 표본).
            terminatesEarly: isLine2Direction(item.direction)
                ? false
                : transitTerminatesBeforeAlight(item.destinationName, leg: leg),
            express: item.express,
            directionMatched: directionMatchesWayCode(item.direction, leg.wayCode) == true
        )
    }
    let anyMatched = decorated.contains { $0.directionMatched }
    let hasDirectionAxis = decorated.contains { !$0.item.direction.isEmpty }
    let candidates = anyMatched ? decorated.filter(\.directionMatched) : decorated
    return (candidates, hasDirectionAxis && !anyMatched)
}

/// 역명 표기 차이 흡수(부역명 괄호·"역" 접미) — 종착 검사·현재 위치 매칭 공용.
private func normalizeStopName(_ s: String) -> String {
    var out = s.replacingOccurrences(of: "\\s*\\([^)]*\\)", with: "", options: .regularExpression)
    if out.hasSuffix("역") { out = String(out.dropLast()) }
    return out.trimmingCharacters(in: .whitespaces)
}

/// 경유 목록에서 현재 위치 역명(arvlMsg3, §12.2)의 인덱스(§14.1 경유역 탑승 위치).
/// 지하철 잠금 추적에서만 값이 오고, 미매칭(노선 밖 표기·버스)은 무표기가 정답이라
/// nil. 표기 차이는 종착 검사와 같은 정규화로 흡수한다. 웹 viaStopCurrentIndex 미러.
public func viaStopCurrentIndex(leg: TransitGuideLeg, currentLocation: String?) -> Int? {
    guard let currentLocation else { return nil }
    let target = normalizeStopName(currentLocation)
    guard !target.isEmpty else { return nil }
    return leg.viaStops.firstIndex { normalizeStopName($0.name) == target }
}

/// 종착역이 경유 목록에서 하차역보다 앞이면 그 열차는 하차역에 가지 않는다(§5.1).
public func transitTerminatesBeforeAlight(_ destinationName: String?, leg: TransitGuideLeg) -> Bool {
    guard let destinationName, !leg.viaStops.isEmpty else { return false }
    let dest = normalizeStopName(destinationName)
    guard let destIdx = leg.viaStops.firstIndex(where: { normalizeStopName($0.name) == dest }),
          let alightIdx = leg.viaStops.firstIndex(where: {
              normalizeStopName($0.name) == normalizeStopName(leg.alightName)
          })
    else { return false }
    return destIdx < alightIdx
}

// === 상태 머신 ===

/// 세션 시작 상태 — legIndex 0의 waiting. 시작 통지는 오케스트레이터 몫.
public func initTransitGuide(route: TransitGuideRoute, now: Double) -> TransitGuideState {
    TransitGuideState(
        legIndex: 0,
        phase: .waiting,
        phaseGen: 0,
        lastSeq: 0,
        signal: route.legs.first?.trackMode != nil ? .notYetVisible : .untrackable,
        lock: nil,
        previousLock: nil,
        remaining: nil,
        lastMessage: nil,
        lastUpdatedAt: nil,
        currentLocation: nil,
        dataStamp: nil,
        dataAgeSeconds: nil,
        arrivedCertain: false,
        ladderAnnounced: nil,
        trackingAnnounced: false,
        ridingSince: nil,
        missCount: 0,
        failCount: 0,
        failSince: nil,
        pollCount: 0,
        capAnnounced: false
    )
}

/// 복합 키 매칭(§4.2): 식별자 원문 동일 ∧ 방향(양측 보유 시) 동일.
public func transitLockMatches(_ item: TransitTrackItem, lock: TransitLock) -> Bool {
    guard let vid = item.vehicleId, !vid.isEmpty, vid == lock.vehicleId else { return false }
    if !item.direction.isEmpty, !lock.direction.isEmpty, item.direction != lock.direction {
        return false
    }
    return true
}

public func transitGuideStep(
    state: TransitGuideState,
    input: TransitGuideInput,
    route: TransitGuideRoute,
    now: Double
) -> (state: TransitGuideState, event: TransitGuideEvent?) {
    switch input {
    case let .board(lock):
        return handleBoard(state, lock: lock, now: now)
    case .changeBoarding:
        return handleChangeBoarding(state)
    case .advance:
        return handleAdvance(state, route: route)
    case let .poll(seq, phaseGen, poll):
        return handlePoll(state, seq: seq, phaseGen: phaseGen, poll: poll, now: now)
    }
}

private func handleBoard(
    _ state: TransitGuideState, lock: TransitLock, now: Double
) -> (state: TransitGuideState, event: TransitGuideEvent?) {
    guard state.phase == .waiting, state.signal != .untrackable else { return (state, nil) }
    var next = state
    next.phase = .riding
    // 미관측 상한의 기준점(A16 L2). 재탑승·leg 전진마다 새로 찍힌다.
    next.ridingSince = now
    next.phaseGen += 1
    next.lock = lock
    next.previousLock = nil
    next.remaining = nil
    next.lastMessage = nil
    next.lastUpdatedAt = nil
    next.currentLocation = nil
    next.dataStamp = nil
    next.dataAgeSeconds = nil
    next.arrivedCertain = false
    next.ladderAnnounced = nil
    next.trackingAnnounced = false
    next.missCount = 0
    return (next, .boarded(legIndex: state.legIndex))
}

private func handleChangeBoarding(
    _ state: TransitGuideState
) -> (state: TransitGuideState, event: TransitGuideEvent?) {
    guard state.phase == .riding || state.phase == .arrived else { return (state, nil) }
    var next = state
    next.phase = .waiting
    next.phaseGen += 1
    next.lock = nil
    // 직전 잠금 보존(§13.1) — "탑승 변경 취소"가 board(previousLock)로 복귀한다.
    next.previousLock = state.lock
    next.remaining = nil
    next.lastMessage = nil
    next.currentLocation = nil
    next.dataStamp = nil
    next.dataAgeSeconds = nil
    next.arrivedCertain = false
    next.ladderAnnounced = nil
    next.trackingAnnounced = false
    // 대기 국면엔 기준점이 없다 — 다음 board가 새로 찍는다.
    next.ridingSince = nil
    next.missCount = 0
    return (next, .boardingReset)
}

/// advance가 유효한 국면(§4.2): arrived 확인 / 추적 불가 수동 전진 / 근사 잠금 상시(§13.2).
private func canAdvance(_ state: TransitGuideState, route _: TransitGuideRoute) -> Bool {
    if state.phase == .arrived { return true }
    if state.signal == .untrackable { return true }
    guard let lock = state.lock else { return false }
    return state.phase == .riding && isApproxTransitLock(lock)
}

/// 다음 구간 전환 — 사용자 확인(§4.2 원자 전이). 유효 국면 밖의 advance는 no-op
/// (UI 버튼 노출 조건에만 의존하면 웹·iOS 가드가 드리프트한다 — 독립 리뷰).
private func handleAdvance(
    _ state: TransitGuideState, route: TransitGuideRoute
) -> (state: TransitGuideState, event: TransitGuideEvent?) {
    guard state.phase != .done, canAdvance(state, route: route) else { return (state, nil) }
    let nextIndex = state.legIndex + 1
    let final = nextIndex >= route.legs.count
    var next = state
    next.legIndex = final ? state.legIndex : nextIndex
    next.phase = final ? .done : .waiting
    next.phaseGen += 1
    if !final {
        next.signal = route.legs[nextIndex].trackMode != nil ? .notYetVisible : .untrackable
    }
    next.lock = nil
    next.previousLock = nil
    next.remaining = nil
    next.lastMessage = nil
    next.lastUpdatedAt = nil
    next.currentLocation = nil
    next.dataStamp = nil
    next.dataAgeSeconds = nil
    next.arrivedCertain = false
    next.ladderAnnounced = nil
    next.trackingAnnounced = false
    // 다음 leg는 아직 승차 전이다.
    next.ridingSince = nil
    next.missCount = 0
    next.failCount = 0
    next.failSince = nil
    return (next, .legAdvanced(legIndex: final ? state.legIndex : nextIndex, final: final))
}

private func handlePoll(
    _ state: TransitGuideState, seq: Int, phaseGen: Int, poll: TransitTrackPoll, now: Double
) -> (state: TransitGuideState, event: TransitGuideEvent?) {
    // 세대·순번 불일치 — 늦은 응답 폐기(§4.2).
    if phaseGen != state.phaseGen || seq <= state.lastSeq { return (state, nil) }
    if state.phase == .done || state.signal == .untrackable { return (state, nil) }

    var next = state
    next.lastSeq = seq
    next.pollCount += 1
    var event: TransitGuideEvent?

    if !next.capAnnounced, next.pollCount >= transitSessionPollCap {
        next.capAnnounced = true
        event = .capSlowed
    }

    switch poll {
    case .failed, .unsupported:
        next.failCount += 1
        if next.failSince == nil { next.failSince = now }
        let notify = next.signal != .upstreamFailed
            && (next.failCount >= transitFailNotifyCount
                || now - (next.failSince ?? now) >= transitFailNotifyMs)
        if notify {
            next.signal = .upstreamFailed
            return (next, .upstreamFailed)
        }
        return (next, event)
    case .ok, .empty:
        break
    }

    let recovered = next.signal == .upstreamFailed
    next.failCount = 0
    next.failSince = nil
    if recovered {
        next.signal = state.trackingAnnounced ? .signalLost : .notYetVisible
        event = .signalRecovered
    }

    if state.phase == .waiting {
        next.lastUpdatedAt = now
        return (next, event)
    }

    let items: [TransitTrackItem] = if case let .ok(list) = poll { list } else { [] }
    let matched = state.lock.flatMap { findLockedItem(items, lock: $0) }

    if let matched {
        return commitMatched(next, base: state, item: matched, carriedEvent: event, now: now)
    }

    if !next.trackingAnnounced {
        // ⚠ neverSeen을 이 목록에서 빼면 매 폴마다 notYetVisible로 되돌아가 아래
        // 1회성 가드가 무력화된다(반복 발화). 확정된 신호는 여기서 덮지 않는다.
        if next.signal != .upstreamFailed, next.signal != .signalLost,
           next.signal != .neverSeen {
            next.signal = .notYetVisible
        }
        next.lastUpdatedAt = now
        // 그 상태를 빠져나오는 문(A16 L2) — 웹 transit-guide.ts 미러.
        // 판정하지 않는 경우 셋: 방금 조회가 살아난 폴(recovered — 최소 한 번은
        // 실제로 보고 말한다, 그리고 signalRecovered를 덮지 않는다) · 원인이 다른
        // 신호(upstreamFailed·signalLost·자기 자신) · 기준 시각 불명.
        //
        // ⚠ phase == .riding은 현재 **도달 불가 방어**다(위 waiting 조기 반환).
        // 웹에서 변이 주입으로 실측했고 어느 게이트도 그 제거를 잡지 못했다 —
        // 검증된 가드가 아니라는 사실을 알고 남긴다(불변식의 자립적 표현).
        if !recovered, next.signal == .notYetVisible, next.phase == .riding,
           let since = next.ridingSince, now - since >= transitNeverSeenMs {
            next.signal = .neverSeen
            return (next, .neverSeen)
        }
        return (next, event)
    }
    next.missCount += 1
    next.lastUpdatedAt = now
    // 근사 잠금은 도착 추정 제외(§13.2 — 식별자가 없어 "소실"이 하차 신호가 아니다).
    if state.phase == .riding,
       let remaining = state.remaining, remaining <= 1,
       next.missCount >= transitMissArriveCount,
       let lock = state.lock, !isApproxTransitLock(lock) {
        next.phase = .arrived
        next.arrivedCertain = false
        return (next, .arrived(certain: false))
    }
    if next.missCount >= transitMissLostCount, next.signal != .signalLost {
        next.signal = .signalLost
        return (next, .signalLost)
    }
    return (next, event)
}

private func findLockedItem(_ items: [TransitTrackItem], lock: TransitLock) -> TransitTrackItem? {
    if isApproxTransitLock(lock) {
        // 근사(§5.2·§13.2): 방향 일치(양측 보유 시) 항목 중 최근접 접근 차량(잔여
        // 최소). tagoBus는 방향이 ""라 무필터 — 기존 행동 불변.
        let pool = items.filter {
            lock.direction.isEmpty || $0.direction.isEmpty || $0.direction == lock.direction
        }
        let withRemaining = pool.filter { $0.remainingStops != nil }
        if let best = withRemaining.min(by: { ($0.remainingStops ?? .max) < ($1.remainingStops ?? .max) }) {
            return best
        }
        return pool.first
    }
    return items.first { transitLockMatches($0, lock: lock) }
}

private func commitMatched(
    _ next: TransitGuideState,
    base: TransitGuideState,
    item: TransitTrackItem,
    carriedEvent: TransitGuideEvent?,
    now: Double
) -> (state: TransitGuideState, event: TransitGuideEvent?) {
    let prevRemaining = base.remaining
    let wasTracking = base.trackingAnnounced

    // 동일 스냅숏 무정보 폴(§12.1): recptnDt와 완성 문장이 직전 커밋과 같으면 새
    // 정보가 없다 — phase·signal 불변, 이벤트 없음(동결 레코드 재등장의 재발화
    // 차단). ⚠ 문장 동일 조건 필수: 신분당선은 stamp 동결 + 문장 정상 갱신(실측).
    if let stamp = item.dataStamp, stamp == base.dataStamp, item.message == base.lastMessage {
        // 무정보여도 매칭은 매칭 — 연속 미등장 카운터는 끊는다(독립 리뷰 MAJOR:
        // 미리셋 시 미등장↔동결재등장 반복에서 signalLost·도착 추정 조기 오발화).
        var unchanged = next
        unchanged.missCount = 0
        unchanged.lastUpdatedAt = now
        unchanged.dataAgeSeconds = item.dataAgeSeconds
        return (unchanged, carriedEvent)
    }

    var out = next
    out.signal = .tracking
    out.missCount = 0
    out.remaining = item.remainingStops
    out.lastMessage = item.message
    out.lastUpdatedAt = now
    out.currentLocation = item.currentLocation
    out.dataStamp = item.dataStamp
    // stamp 동결 감지(신분당선형): 같은 stamp인데 문장이 갱신됐다면 recptnDt 고장 —
    // 그 나이는 거짓 정밀이라 nil(§12.1, 접근성 감사 반영).
    out.dataAgeSeconds = (item.dataStamp != nil && item.dataStamp == base.dataStamp)
        ? nil : item.dataAgeSeconds
    out.trackingAnnounced = true

    // 도착 추정 상태에서 재관측 — riding 복귀(추정은 가역, §4.2).
    if base.phase == .arrived, !base.arrivedCertain {
        out.phase = .riding
        return (out, .backOnTrack(message: item.message))
    }
    if base.phase != .riding {
        return (out, carriedEvent)
    }

    // 도착 관측(§4.2): 지하철 arvlCd "1" / 서울버스 잔여 0. 근사 잠금은 arrived 전이
    // 없음(§5.2·§13.2 — 식별자가 없어 그 도착이 내 차량이라는 확정이 불가능하다).
    let approx = base.lock.map(isApproxTransitLock) ?? false
    let arrivedByMode: Bool = switch base.lock?.mode {
    case .subway: item.arrivalCode == "1"
    case .seoulBus: item.remainingStops == 0
    default: false
    }
    let arrivedObserved = !approx && arrivedByMode
    if arrivedObserved {
        out.phase = .arrived
        out.arrivedCertain = true
        return (out, .arrived(certain: true))
    }

    if !wasTracking {
        out.ladderAnnounced = item.remainingStops
        return (out, .trackingStarted(message: item.message, remaining: item.remainingStops))
    }

    guard let remaining = item.remainingStops else {
        // 잔여 추출 실패(§6.2) — 완성 문장 변화 통지로 폴백.
        if let last = base.lastMessage, item.message != last {
            return (out, .messageChanged(message: item.message))
        }
        return (out, carriedEvent)
    }

    // 근사 기준 차량 교체(§5.2·§13.2): 잔여 역행 관측.
    if approx, let prev = prevRemaining, remaining > prev {
        out.ladderAnnounced = nil
        return (out, .approxVehicleChanged(message: item.message))
    }

    // 사다리(§6.1): {3,2,1} 도달, 건너뜀은 현재 값 하나만, 증가에 래치 비가역.
    let latch = out.ladderAnnounced
    if remaining <= transitLadderMax, remaining >= 0,
       latch == nil || remaining < latch!,
       let prev = prevRemaining, remaining < prev {
        out.ladderAnnounced = remaining
        return (out, .countdown(
            remaining: remaining, message: item.message, currentLocation: item.currentLocation))
    }
    // 소실 후 재관측 회복(§4.2) — 상위 이벤트가 없을 때만.
    if base.signal == .signalLost, carriedEvent == nil {
        return (out, .signalRecovered)
    }
    return (out, carriedEvent)
}

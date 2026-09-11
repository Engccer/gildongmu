import Foundation

/// 안내 문장 판정(E27 잔여 ①, spec 2026-09-01 §3.7) — 웹 `transit-guide-text.ts` 미러.
/// 공유 fixture `transit-guide-text-cases.json`이 두 구현을 한 표로 잠근다.
///
/// 어떤 키를 쓰는가, 어떤 인자를 어떤 순서로 넣는가, **이 줄이 ko인가 en인가**를 여기서 정하고
/// 앱은 리터럴 `switch`로 카탈로그 조회만 한다(`TransitWalkLegText` 선례 — 앱 타깃에 테스트
/// 레인이 없으므로 판정을 Kit에 두는 것이 그 자리를 대신한다).
///
/// **입력은 표시 투영뿐이다** — 조인 필드가 타입에 없어 노선명·역명이 조회 쿼리로 새어 나갈
/// 경로가 구조적으로 없다(spec §3.5).
///
/// ⚠ **인자 순서는 ko 문장의 플레이스홀더 등장 순서가 정본**이다. 어순이 다른 로케일은 변환
/// 스크립트가 인덱스를 재배치하므로 호출부는 이 순서 하나만 지킨다.

/// 한 조각: i18n 키(+위치 인자) 또는 완성 문장 원문(서버가 준 그대로 병치).
public struct TransitTextPart: Codable, Sendable, Equatable {
    public let key: String?
    public let args: [String]?
    public let text: String?

    public static func key(_ k: String, _ a: [String] = []) -> TransitTextPart {
        TransitTextPart(key: k, args: a, text: nil)
    }
    public static func text(_ t: String) -> TransitTextPart {
        TransitTextPart(key: nil, args: nil, text: t)
    }
}

/// 한 줄(한 접근성 객체). `parts`가 비면 그 줄은 생략이고 `lang`은 **값의 언어**다.
public struct TransitTextLine: Codable, Sendable, Equatable {
    public let parts: [TransitTextPart]
    public let lang: String // "ko" | "en"
}

private let omitLine = TransitTextLine(parts: [], lang: "ko")

/// 줄 원자성 판정 — 영문 조각이 **전부** 있을 때만 영어 줄이고, 하나라도 없으면 줄 전체가 ko.
///
/// ⚠ `TransitLabel.en`의 빈 문자열은 투영 단계에서 이미 걸러졌다 — 유일한 예외인 `message`
/// 슬롯의 `""`는 "ko에도 그 조각이 없다"는 자리 표시라 여기서 완비로 친다(spec §3.4).
public func transitPickLabels(
    isEn: Bool, _ labels: [TransitLabel]
) -> (values: [String], lang: String) {
    guard isEn else { return (labels.map(\.ko), "ko") }
    let en = labels.compactMap(\.en)
    guard en.count == labels.count else { return (labels.map(\.ko), "ko") }
    return (en, "en")
}

/// 수단별 키(A33 패턴, E39) — 버스는 `{line}`이 노선 번호라 수단 낱말이 붙어야 한다.
/// ⚠ 라벨(`TransitDisplayLeg.line`)에 합성하지 않는다(조인 키 오염).
private func modeKey(_ leg: TransitDisplayLeg, _ base: String) -> String {
    leg.mode == "bus" ? base + "Bus" : base
}

private func makeLine(
    _ isEn: Bool, _ key: String, _ labels: [TransitLabel], _ build: ([String]) -> [String]
) -> TransitTextLine {
    let picked = transitPickLabels(isEn: isEn, labels)
    return TransitTextLine(parts: [.key(key, build(picked.values))], lang: picked.lang)
}

// MARK: - 문맥 문장

/// 대기 문맥(§4.1). ⚠ `isCurrentLeg`에 기본값 없음 — 다음 구간 안내가 이전 구간에서 고른 역을
/// 말하면 안 되는데 생략이 통과하면 그 결함이 조용히 들어온다.
/// ⚠ 재선택한 역이 있으면 선행 도보 문구를 붙이지 않는다(그 도보는 이미 지난 일이다).
public func transitWaitContextLine(
    isEn: Bool, leg: TransitDisplayLeg, isCurrentLeg: Bool
) -> TransitTextLine {
    let overridden = isCurrentLeg && leg.boardOverridden
    if !overridden, let walk = leg.walkBeforeMinutes, walk > 0 {
        return makeLine(isEn, modeKey(leg, "waitContextWalk"), [leg.board, leg.line]) { [String(walk), $0[0], $0[1]] }
    }
    return makeLine(isEn, modeKey(leg, "waitContext"), [leg.board, leg.line]) { $0 }
}

public func transitBoardingContextLine(isEn: Bool, leg: TransitDisplayLeg) -> TransitTextLine {
    makeLine(isEn, modeKey(leg, "boardingContext"), [leg.board, leg.line]) { $0 }
}

public func transitContextLine(isEn: Bool, leg: TransitDisplayLeg) -> TransitTextLine {
    makeLine(isEn, modeKey(leg, "context"), [leg.line, leg.alight]) { $0 }
}

// MARK: - 완성 문장 프레임

/// 승차 국면 상태 문장(§12.3·A27). ⚠ `arrivalCode` 인자에 기본값 없음.
public func transitFrameLine(
    isEn: Bool, leg: TransitDisplayLeg, message: TransitLabel, arrivalCode: String?
) -> TransitTextLine {
    if leg.mode == "subway" {
        switch subwayRidingKey(arrivalCode) {
        case .omit:
            return omitLine
        case let .key(k):
            return makeLine(isEn, k, [leg.alight]) { $0 }
        case .raw:
            // 미지 코드 — 완성 문장 원문 병치(틀 없이).
            let picked = transitPickLabels(isEn: isEn, [message])
            guard !picked.values[0].isEmpty else { return omitLine }
            return TransitTextLine(parts: [.text(picked.values[0])], lang: picked.lang)
        }
    }
    return makeLine(isEn, "messageFrame", [leg.alight, message]) { $0 }
}

public func transitApproachFrameLine(
    isEn: Bool, leg: TransitDisplayLeg, message: TransitLabel
) -> TransitTextLine {
    makeLine(isEn, "approachFrame", [leg.board, message]) { $0 }
}

private enum SubwayRidingKey {
    case key(String)
    case omit
    case raw
}

/// A27 승차 국면 지하철 문장 종류 — **판정은 `subwayRidingMessage`가 정본**이고 여기서는 그
/// 결과를 i18n 키로 옮기기만 한다.
///
/// ⚠ 판정을 여기에 다시 쓰면 CLAUDE.md가 정본이라 부르는 함수의 프로덕션 호출자가 0이 되어
/// 공유 fixture만 초록인 채 실제 문장이 따라오지 않는 드리프트 경로가 생긴다(리뷰 검출).
/// 상태 문장을 만드는 국면(E39). `waiting`은 관측값이 없어 이 함수를 지나지 않는다.
public enum TransitStatusPhase: String, Sendable {
    case boarding
    case riding
}

/// 서울버스 완성 문장(TOPIS `arrmsg`)의 모양 — 웹 `parseBusArrmsg` 미러.
enum BusArrmsgKind: Equatable {
    case eta(minutes: Int?, seconds: Int?)
    case soon
    case waiting
    case turning
    case ended
    case unknown
}

private let arrmsgTailPattern = #"\[(\d+)번째 전\]"#

/// 원문 → 모양. 잔여 꼬리는 떼고 본다(잔여 수는 구조 필드가 따로 온다).
func parseBusArrmsgKind(_ message: String) -> BusArrmsgKind {
    let body = message
        .replacingOccurrences(of: arrmsgTailPattern, with: "", options: .regularExpression)
        .trimmingCharacters(in: .whitespaces)
    if body.replacingOccurrences(of: " ", with: "") == "곧도착" { return .soon }
    if body == "출발대기" { return .waiting }
    if body == "회차대기" { return .turning }
    if body == "운행종료" { return .ended }
    // "6분47초후" / "15분후" / "55초후" — 꼬리를 뗀 몸통 전체가 걸려야 한다.
    let etaPattern = #"^(?:(\d+)분)?\s*(?:(\d+)초)?\s*후$"#
    guard let m = try? NSRegularExpression(pattern: etaPattern),
          let hit = m.firstMatch(in: body, range: NSRange(body.startIndex..., in: body))
    else { return .unknown }
    func group(_ i: Int) -> Int? {
        guard let r = Range(hit.range(at: i), in: body) else { return nil }
        return Int(body[r])
    }
    let minutes = group(1)
    let seconds = group(2)
    guard minutes != nil || seconds != nil else { return .unknown }
    return .eta(minutes: minutes, seconds: seconds)
}

/// 도착 조각 하나.
private struct ArrivalPart {
    let line: TransitTextLine
}

/// 서울버스 완성 문장 → 우리 문장(E39). 초가 있으면 정확값, 없으면 "약".
/// `ended`·`unknown`은 원문 병치 — `운행종료`는 차량 잠금 국면에 도달하지 않고(vehId 부재),
/// 미지 모양은 잘못 옮기는 것보다 원문이 낫다.
private func busArrivalPart(_ isEn: Bool, _ message: TransitLabel) -> ArrivalPart? {
    func ui(_ key: String, _ args: [String] = []) -> ArrivalPart {
        ArrivalPart(line: TransitTextLine(parts: [.key(key, args)], lang: isEn ? "en" : "ko"))
    }
    switch parseBusArrmsgKind(message.ko) {
    case .soon: return ui("busSoon")
    case .waiting: return ui("busNotDeparted")
    case .turning: return ui("busTurning")
    case let .eta(minutes, seconds):
        let min = (minutes ?? 0) > 0 ? minutes : nil
        let sec = (seconds ?? 0) > 0 ? seconds : nil
        if let min, let sec { return ui("busEtaMinSec", [String(min), String(sec)]) }
        if let min { return ui("busEtaMin", [String(min)]) }
        if let sec { return ui("busEtaSec", [String(sec)]) }
        // 분·초가 둘 다 0 — 담을 값이 없다(en 투영과 같은 판정).
        return nil
    case .ended, .unknown:
        return rawArrivalPart(isEn, message)
    }
}

/// 지하철: 승차 중은 A27 문장, 승차 대기는 종전 프레임("{stop}에 {message}").
private func subwayArrivalPart(
    _ isEn: Bool, _ leg: TransitDisplayLeg, _ message: TransitLabel,
    _ arrivalCode: String?, _ phase: TransitStatusPhase
) -> ArrivalPart? {
    if phase == .boarding {
        return ArrivalPart(line: transitApproachFrameLine(isEn: isEn, leg: leg, message: message))
    }
    switch subwayRidingKey(arrivalCode) {
    case .omit: return nil
    case let .key(k): return ArrivalPart(line: makeLine(isEn, k, [leg.alight]) { $0 })
    case .raw: return rawArrivalPart(isEn, message)
    }
}

/// 원문 병치(틀 없이) — 비어 있으면 조각 없음.
private func rawArrivalPart(_ isEn: Bool, _ message: TransitLabel) -> ArrivalPart? {
    let picked = transitPickLabels(isEn: isEn, [message])
    guard !picked.values[0].isEmpty else { return nil }
    return ArrivalPart(line: TransitTextLine(parts: [.text(picked.values[0])], lang: picked.lang))
}

/// 승차 대기·승차 중 상태 문장의 **도착 조각**(E39) — 잔여와 도착 서술을 한 줄 두 조각으로 낸다.
/// 렌더가 조각을 쉼표로 이으므로 "남은 정거장 3개, 다음 역 서대문." 한 문장이 된다.
///
/// ⚠ `phase`에 기본값을 두지 않는다 — 같은 잔여 수가 대기에서는 "버스가 여기 오기까지"이고
/// 승차 중에는 "내릴 곳까지"라 낱말이 갈린다.
public func transitArrivalStatusLine(
    isEn: Bool, leg: TransitDisplayLeg, message: TransitLabel?, arrivalCode: String?,
    remaining: Int?, phase: TransitStatusPhase
) -> TransitTextLine {
    let arrival: ArrivalPart? = message.flatMap {
        leg.mode == "bus"
            ? busArrivalPart(isEn, $0)
            : subwayArrivalPart(isEn, leg, $0, arrivalCode, phase)
    }
    // 지하철 승차 대기는 잔여를 말하지 않는다(종전 계약 — 원문 프레임이 승차 정류소를 말한다).
    // ⚠ 승차 대기의 잔여 0은 조각을 만들지 않는다 — "0정거장 전"은 한국어가 아니고, 그 상태는
    // 도착 조각("곧 도착")이 이미 말한다. 승차 중의 0은 종전대로(하차 구간 진입).
    guard let remaining, phase == .riding || (leg.mode == "bus" && remaining > 0) else {
        return arrival?.line ?? omitLine
    }
    let count = String(remaining)
    guard let arrival else {
        let only = phase == .boarding ? "stopsAwayOnly" : "remainingCount"
        return TransitTextLine(parts: [.key(only, [count])], lang: isEn ? "en" : "ko")
    }
    let joinKey = phase == .boarding ? "stopsAway" : "remainingCountJoin"
    return TransitTextLine(
        parts: [.key(joinKey, [count])] + arrival.line.parts, lang: arrival.line.lang)
}

private func subwayRidingKey(_ code: String?) -> SubwayRidingKey {
    switch subwayRidingMessage(code) {
    case let .key(k): .key(k)
    case .omit: .omit
    case .raw: .raw
    }
}

// MARK: - 이벤트 통지

public func transitVehicleSelectedLine(
    isEn: Bool, leg: TransitDisplayLeg, desc: TransitLabel?
) -> TransitTextLine {
    makeLine(isEn, "vehicleSelected", [desc ?? leg.line, leg.board]) { $0 }
}

public func transitSelectedVehicleLine(isEn: Bool, desc: TransitLabel) -> TransitTextLine {
    makeLine(isEn, "selectedVehicle", [desc]) { $0 }
}

public func transitVehiclePassedLine(isEn: Bool, leg: TransitDisplayLeg) -> TransitTextLine {
    makeLine(isEn, "vehiclePassed", [leg.board]) { $0 }
}

public func transitArrivedAtBoardStopLine(isEn: Bool, leg: TransitDisplayLeg) -> TransitTextLine {
    makeLine(isEn, modeKey(leg, "arrivedAtBoardStop"), [leg.line]) { $0 }
}

/// A41: 서울버스 "곧 도착"(잔여 0) 승차 임박 — 승격 없이 "{line} 곧 도착합니다."
public func transitArrivingAtBoardStopLine(isEn: Bool, leg: TransitDisplayLeg) -> TransitTextLine {
    makeLine(isEn, modeKey(leg, "arrivingAtBoardStop"), [leg.line]) { $0 }
}

/// 탑승 통지(E41) — 노선·하차역·정거장 수는 착지가 앉는 상태 문장이 그대로 말하므로 한 문장이다.
/// ⚠ A41 인계 기각: `departed`에 관측 서술("{노선} 출발")을 넣지 않는다 — 사용자에게 일어난
/// 일은 탑승이지 버스의 출발이 아니다(spec 2026-09-12-transit-status-prose §4).
public func transitBoardedLine(isEn: Bool) -> TransitTextLine {
    TransitTextLine(parts: [.key("boarded", [])], lang: isEn ? "en" : "ko")
}

public func transitCurrentStationLine(isEn: Bool, location: TransitLabel) -> TransitTextLine {
    makeLine(isEn, "currentStation", [location]) { $0 }
}

// MARK: - 대기 후보 목록

/// 후보 한 줄의 조각들. 줄 원자성은 **줄 단위**라 조각 하나라도 영문이 없으면 줄 전체가 ko다.
/// ⚠ 조각 순서가 곧 낭독 순서다. 빈 조각은 제거되어 구분자가 겹치지 않는다.
public func transitCandidateDescLine(
    isEn: Bool, leg: TransitDisplayLeg, item: TransitDisplayItem,
    express: TransitExpressVerdict?, departedMinutes: Int?
) -> TransitTextLine {
    var labels: [TransitLabel] = []
    if let dest = item.destination { labels.append(dest) }
    labels.append(item.direction)
    labels.append(item.message)
    // 급행 조각(A16 L1): unknown → 종전 "정차 여부 확인 필요", stops → "정차". skips는 조각 없음(차단 행의 사유 줄이 말한다).
    let expressKey: String? = switch express {
    case .unknown: "expressCheck"
    case .stops: "expressStopsAt"
    case .skips, nil: nil
    }
    if expressKey != nil { labels.append(leg.alight) }
    let picked = transitPickLabels(isEn: isEn, labels)
    var i = 0
    var parts: [TransitTextPart] = []
    if item.destination != nil {
        parts.append(.key("bound", [picked.values[i]])); i += 1
    }
    let direction = picked.values[i]; i += 1
    if !direction.isEmpty { parts.append(.text(direction)) }
    let message = picked.values[i]; i += 1
    if !message.isEmpty { parts.append(.text(message)) }
    if let expressKey {
        parts.append(.key(expressKey, [picked.values[i]])); i += 1
    }
    if let departedMinutes {
        parts.append(.key("departed", [String(departedMinutes)]))
    }
    return TransitTextLine(parts: parts, lang: picked.lang)
}

/// 선택한 차량의 **안정 조각만**으로 만든 설명(행선·방향) — 완성 문장은 폴마다 바뀌므로 넣지 않는다.
public func transitVehicleDescLine(isEn: Bool, item: TransitDisplayItem) -> TransitTextLine {
    var labels: [TransitLabel] = []
    if let dest = item.destination { labels.append(dest) }
    labels.append(item.direction)
    let picked = transitPickLabels(isEn: isEn, labels)
    var i = 0
    var parts: [TransitTextPart] = []
    if item.destination != nil {
        parts.append(.key("bound", [picked.values[i]])); i += 1
    }
    let direction = picked.values[i]
    if !direction.isEmpty { parts.append(.text(direction)) }
    return TransitTextLine(parts: parts, lang: picked.lang)
}

/// 급행이 하차역에 서지 않는 후보의 사유 줄(A16 L1 결정적 미도달, 차단 행).
public func transitExpressSkipsAlightLine(isEn: Bool, leg: TransitDisplayLeg) -> TransitTextLine {
    makeLine(isEn, "expressSkipsAlight", [leg.alight]) { $0 }
}

/// 하차 출구 방면(E25) — 확정 도착 통지(`sentence`: 마침표 있는 문장 키, 공백 연결 채널)·하차역 행
/// (쉼표 연결, 마침표 없음)에 병기. 통지 채널의 다른 조각은 마침표를 가지므로 마침표 없는 키를 쓰면
/// "3번 출구 방면 다음: …"으로 이어져 읽힌다(a11y 감사 2026-09-02).
/// 급행 선언 근사 잠금의 승차 상시 표시(§6, 웹 `expressStatusLine` 미러) — 답한 직후의 침묵이 "확인됨"으로
/// 읽히지 않게 판정을 말한다. 기존 키 재사용(`stops` → expressStopsAt, 그 밖 → expressCheck).
public func transitExpressStatusLine(
    isEn: Bool, leg: TransitDisplayLeg, verdict: TransitExpressVerdict?
) -> TransitTextLine {
    makeLine(isEn, verdict == .stops ? "expressStopsAt" : "expressCheck", [leg.alight]) { $0 }
}

public func transitExitBoundLine(isEn: Bool, exit: String, sentence: Bool = false) -> TransitTextLine {
    TransitTextLine(parts: [.key(sentence ? "exitBoundSentence" : "exitBound", [exit])], lang: isEn ? "en" : "ko")
}

public func transitTerminatesEarlyLine(
    isEn: Bool, leg: TransitDisplayLeg, item: TransitDisplayItem
) -> TransitTextLine {
    let dest = item.destination ?? TransitLabel(ko: "")
    return makeLine(isEn, "terminatesEarly", [dest, leg.alight]) { $0 }
}

// MARK: - 경유 목록·조망

/// 경유 정류소 한 줄 — 이름 + 승차·하차·현재 위치 표식(표식은 UI 라벨이라 인자가 없다).
public func transitViaStopLine(
    isEn: Bool, stop: TransitLabel, role: String, here: Bool, exit: String? = nil
) -> TransitTextLine {
    let picked = transitPickLabels(isEn: isEn, [stop])
    var parts: [TransitTextPart] = [.text(picked.values[0])]
    if role == "board" { parts.append(.key("viaBoard")) }
    else if role == "alight" { parts.append(.key("viaAlight")) }
    if here { parts.append(.key("viaCurrent")) }
    // 하차역 행에 출구 번호 병기(E25) — 하차 역할에만.
    if role == "alight", let exit, !exit.isEmpty { parts.append(.key("exitBound", [exit])) }
    return TransitTextLine(parts: parts, lang: picked.lang)
}

public func transitOverviewLegLine(
    isEn: Bool, n: Int, line: TransitLabel, board: TransitLabel, alight: TransitLabel
) -> TransitTextLine {
    makeLine(isEn, "overviewLeg", [line, board, alight]) { [String(n), $0[0], $0[1], $0[2]] }
}

// MARK: - 승차 전 도보(A25)

public func transitPrewalkStartLine(
    isEn: Bool, station: TransitLabel, minutes: Int
) -> TransitTextLine {
    makeLine(isEn, "prewalkStart", [station]) { [$0[0], String(minutes)] }
}

public func transitPrewalkArrivedLine(isEn: Bool, station: TransitLabel) -> TransitTextLine {
    makeLine(isEn, "prewalkArrived", [station]) { $0 }
}

public func transitPrewalkArrivedButtonLine(isEn: Bool, station: TransitLabel) -> TransitTextLine {
    makeLine(isEn, "prewalkArrivedButton", [station]) { $0 }
}

// MARK: - 역 상세 열기(E33)

/// 상태 문장 로터 액션 "{역} 상세 보기". 판정은 다른 descriptor와 같다 — 영문이 없으면 `lang: "ko"`.
/// ⚠ iOS 렌더러는 줄 언어로 포맷 문자열을 고르지 못한다(앱 카탈로그만, `koFallback` 계측 — BACKLOG §2 E28-①) —
/// en 세션 + 영문 없는 역이면 "View details for 천호(풍납토성)"가 되며 이것은 모든 descriptor 줄의 공통 성질이다.
public func transitOpenStationLine(isEn: Bool, station: TransitLabel) -> TransitTextLine {
    makeLine(isEn, "openStation", [station]) { $0 }
}

/// descriptor가 낼 수 있는 전체 키 — 앱 리터럴 `switch` 망라성 대조 축(spec §5.2).
public let transitTextKeys: [String] = [
    "waitContext", "waitContextBus", "waitContextWalk", "waitContextWalkBus",
    "boardingContext", "boardingContextBus", "context", "contextBus",
    "messageFrame", "subwayNextStop", "subwayArriving", "subwayAtStop", "subwayDeparted",
    "remainingCount", "remainingCountJoin", "stopsAway", "stopsAwayOnly",
    "busEtaMinSec", "busEtaMin", "busEtaSec", "busSoon", "busNotDeparted", "busTurning",
    "approachFrame", "vehicleSelected", "selectedVehicle", "vehiclePassed",
    "arrivedAtBoardStop", "arrivedAtBoardStopBus", "arrivingAtBoardStop", "arrivingAtBoardStopBus",
    "boarded", "currentStation",
    "bound", "expressCheck", "expressStopsAt", "expressSkipsAlight", "exitBound", "exitBoundSentence", "departed", "terminatesEarly",
    "viaBoard", "viaAlight", "viaCurrent", "overviewLeg",
    "prewalkStart", "prewalkArrived", "prewalkArrivedButton",
    "openStation",
]

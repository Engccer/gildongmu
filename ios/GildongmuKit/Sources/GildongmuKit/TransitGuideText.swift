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
        return makeLine(isEn, "waitContextWalk", [leg.board, leg.line]) { [String(walk), $0[0], $0[1]] }
    }
    return makeLine(isEn, "waitContext", [leg.board, leg.line]) { $0 }
}

public func transitBoardingContextLine(isEn: Bool, leg: TransitDisplayLeg) -> TransitTextLine {
    makeLine(isEn, "boardingContext", [leg.board, leg.line]) { $0 }
}

public func transitContextLine(isEn: Bool, leg: TransitDisplayLeg) -> TransitTextLine {
    makeLine(isEn, "context", [leg.line, leg.alight]) { $0 }
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

/// A27 승차 국면 지하철 문장 종류 — **언어 무관 판정**이라 여기서 키만 고른다.
private func subwayRidingKey(_ code: String?) -> SubwayRidingKey {
    switch code {
    case "3", "4", "5": .key("subwayNextStop")
    case "0": .key("subwayArriving")
    case "1": .key("subwayAtStop")
    case "2": .key("subwayDeparted")
    case "99": .omit
    default: .raw
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
    makeLine(isEn, "arrivedAtBoardStop", [leg.line]) { $0 }
}

public func transitBoardedLine(isEn: Bool, leg: TransitDisplayLeg) -> TransitTextLine {
    if let count = leg.stationCount {
        return makeLine(isEn, "boardedCount", [leg.line, leg.alight]) { [$0[0], $0[1], String(count)] }
    }
    return makeLine(isEn, "boarded", [leg.line, leg.alight]) { $0 }
}

public func transitCurrentStationLine(isEn: Bool, location: TransitLabel) -> TransitTextLine {
    makeLine(isEn, "currentStation", [location]) { $0 }
}

// MARK: - 대기 후보 목록

/// 후보 한 줄의 조각들. 줄 원자성은 **줄 단위**라 조각 하나라도 영문이 없으면 줄 전체가 ko다.
/// ⚠ 조각 순서가 곧 낭독 순서다. 빈 조각은 제거되어 구분자가 겹치지 않는다.
public func transitCandidateDescLine(
    isEn: Bool, leg: TransitDisplayLeg, item: TransitDisplayItem,
    express: Bool, departedMinutes: Int?
) -> TransitTextLine {
    var labels: [TransitLabel] = []
    if let dest = item.destination { labels.append(dest) }
    labels.append(item.direction)
    labels.append(item.message)
    if express { labels.append(leg.alight) }
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
    if express {
        parts.append(.key("expressCheck", [picked.values[i]])); i += 1
    }
    if let departedMinutes {
        parts.append(.key("departed", [String(departedMinutes)]))
    }
    return TransitTextLine(parts: parts, lang: picked.lang)
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
    isEn: Bool, stop: TransitLabel, role: String, here: Bool
) -> TransitTextLine {
    let picked = transitPickLabels(isEn: isEn, [stop])
    var parts: [TransitTextPart] = [.text(picked.values[0])]
    if role == "board" { parts.append(.key("viaBoard")) }
    else if role == "alight" { parts.append(.key("viaAlight")) }
    if here { parts.append(.key("viaCurrent")) }
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

/// descriptor가 낼 수 있는 전체 키 — 앱 리터럴 `switch` 망라성 대조 축(spec §5.2).
public let transitTextKeys: [String] = [
    "waitContext", "waitContextWalk", "boardingContext", "context",
    "messageFrame", "subwayNextStop", "subwayArriving", "subwayAtStop", "subwayDeparted",
    "approachFrame", "vehicleSelected", "selectedVehicle", "vehiclePassed",
    "arrivedAtBoardStop", "boarded", "boardedCount", "currentStation",
    "bound", "expressCheck", "departed", "terminatesEarly",
    "viaBoard", "viaAlight", "viaCurrent", "overviewLeg",
    "prewalkStart", "prewalkArrived", "prewalkArrivedButton",
]

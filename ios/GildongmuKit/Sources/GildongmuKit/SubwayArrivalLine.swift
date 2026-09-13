import Foundation

// MARK: - E37 완성 문장 → 우리 문장 (웹 `src/lib/place-lines/station-arrivals.ts` 미러)

/// 도착 사건의 동사 — 키 접미와 같은 철자다(앱 `switch`가 키를 고른다).
public enum SubwayArrivalVerb: String, Equatable, Sendable {
    case approaching
    case arrived
    case departed
}

/// 완성 문장(`arvlMsg2`)의 뜻. `station`은 문장 안에 들어가는 역(그 역이 열차 위치임이 실측으로
/// 확인된 문법만), `nowAt`은 관계를 단정하지 않는 `현재 {역}.` 꼬리. 둘이 함께 있는 계획은 없고,
/// 위치를 신뢰할 수 없는 문법은 둘 다 갖지 않는다.
public enum SubwayArrivalPlan: Equatable, Sendable {
    case stationEvent(verb: SubwayArrivalVerb, station: String)
    case prevStationEvent(verb: SubwayArrivalVerb, station: String)
    case departedStopsBack(count: Int)
    case stopsAway(count: Int, station: String)
    case eta(minutes: Int?, seconds: Int?, stops: Int?, nowAt: String?)
}

private let prevEventPattern = #"^전역 (진입|도착|출발)$"#
private let prevDepartedWithStationPattern = #"^(.+?)\s*전역출발$"#
private let stationEventPattern = #"^(.+?) (진입|도착|출발)$"#
/// ⚠ 괄호는 **필수**다. 코퍼스 254행이 전부 괄호를 다는데, 괄호 없는 변형이 오면 그 역이 열차 위치라는
/// 보장이 없다(`{X} 전역출발`의 X가 조회 역 자신인 것과 같은 계열일 수 있다) — 원문에 맡긴다.
private let stopsAwayPattern = #"^\[(\d+)\]번째 전역\s*\((.+)\)$"#
/// 괄호는 소·대괄호 둘 다 온다(`4분 후 (삼각지)` · `3분48초후[3번째 전]`).
/// ⚠ 문자 클래스 안의 `[`는 반드시 이스케이프한다 — ICU는 `[([]`를 중첩 집합의 시작으로 읽어
/// 패턴이 통째로 어긋나고(시간형 전량 미인식), JS는 같은 표기를 문자로 읽어 **웹만 통과한다**.
private let etaPattern = #"^(?:(\d+)분)?(?:\s*(\d+)초)?\s*후(?:\s*[(\[](.+)[)\]])?$"#
/// 구 문법 `3분 후(2번째 전)`의 괄호 — 역명이 아니라 잔여 정거장이다.
private let etaStopsParenPattern = #"^\[?(\d+)\]?번째 전$"#

private func match(_ pattern: String, _ text: String) -> [String?]? {
    guard let re = try? NSRegularExpression(pattern: pattern),
          let hit = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
    else { return nil }
    return (0..<hit.numberOfRanges).map { i in
        Range(hit.range(at: i), in: text).map { String(text[$0]) }
    }
}

private let verbs: [String: SubwayArrivalVerb] = ["진입": .approaching, "도착": .arrived, "출발": .departed]

/// 문장에서 읽은 역과 `arvlMsg3`를 하나로 — **둘 다 있고 다르면 모순**이라 실패다.
/// 서버 `enrichArrivalEn`의 "둘이 다르면 부재"와 같은 축(그래야 `currentLocationEn`이 이 역의 영문이다).
private func resolveStation(_ fromText: String?, _ fromMsg3: String) -> (ok: Bool, station: String?) {
    let text = fromText?.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmed = (text?.isEmpty ?? true) ? nil : text
    if let trimmed, !fromMsg3.isEmpty, trimmed != fromMsg3 { return (false, nil) }
    return (true, trimmed ?? (fromMsg3.isEmpty ? nil : fromMsg3))
}

/// 서울시 완성 문장 → 우리 문장 계획(E37). 순수. 웹 `subwayArrivalProse` 미러 — 공유 fixture
/// `src/lib/__tests__/fixtures/subway-arrival-prose-cases.json`이 두 구현을 한 표로 잠근다.
///
/// ⚠ 불변식 I1: 게이트는 **문장의 모양**이고 초 수도 문장에서 읽는다. `barvlDt`(`arrivalSeconds`)·
/// `arvlCd`(`arrivalCode`)는 판정에도 값에도 쓰지 않는다 — 비시간형 행에도 `barvlDt`가 비0으로 오고
/// (코퍼스 65행, 심야 `전역 출발`에 1200초), `[N]번째 전역`이 코드 1로도 온다(8호선 심야 24행).
/// ⚠ 불변식 I2: 역명을 싣는 것은 그 역이 열차 위치임이 실측으로 확인된 문법뿐이다. `{X} 전역출발`의
/// X는 조회 역 자신이고(12/12, 문장에 그 이름이 박혀 온다) `전전역 출발`은 관측이 얇아 `arvlMsg3`의
/// 뜻을 모른다(쓸 수 있는 1행이 한 역 앞을 가리켜 문장과 어긋났다) — 이 둘은 역명을 싣지 않는다.
/// 못 알아보면 `nil`(원문 경로) — 역을 지어내지 않는다(3-state).
public func subwayArrivalProse(message: String?, currentLocation: String?) -> SubwayArrivalPlan? {
    // ⚠ trim 집합은 웹 `String.trim()`(개행 포함)에 맞춘다 — `.whitespaces`만 쓰면 `arvlMsg3`에 개행이
    // 섞였을 때 Kit만 모순 판정으로 떨어져 두 플랫폼이 갈린다(설계 리뷰 MINOR-3).
    let msg = (message ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let msg3 = (currentLocation ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !msg.isEmpty else { return nil }

    if let m = match(prevEventPattern, msg), let verb = m[1].flatMap({ verbs[$0] }) {
        guard !msg3.isEmpty else { return nil }
        return .prevStationEvent(verb: verb, station: msg3)
    }
    // ⚠ 이 두 문법은 **위치를 말하지 않는다**(I2) — 그 역이 열차 위치라는 증거가 없는데 실으면
    // unknown을 "있음"으로 바꾸는 것이다(위원장 확정 2026-09-13).
    if msg == "전전역 출발" { return .departedStopsBack(count: 2) }
    if let m = match(prevDepartedWithStationPattern, msg) {
        // 모순(문장의 역 ≠ `arvlMsg3`)은 우리가 모르는 모양이라 원문에 맡긴다 — 값은 쓰지 않지만 판정에는 쓴다.
        guard resolveStation(m[1], msg3).ok else { return nil }
        return .departedStopsBack(count: 1)
    }
    if let m = match(stopsAwayPattern, msg), let count = m[1].flatMap(Int.init) {
        guard count >= 1 else { return nil }
        let r = resolveStation(m[2], msg3)
        guard r.ok, let station = r.station else { return nil }
        return .stopsAway(count: count, station: station)
    }
    if let m = match(etaPattern, msg), m[1] != nil || m[2] != nil {
        let minutes = m[1].flatMap(Int.init)
        let seconds = m[2].flatMap(Int.init)
        if let seconds, seconds > 59 { return nil }
        let min = minutes ?? 0
        let sec = seconds ?? 0
        guard min >= 1 || sec >= 1 else { return nil }
        // 구 문법의 괄호는 역명이 아니라 잔여 정거장이다 — 정거장 조각으로 풀고 현재역은 `arvlMsg3`가 맡는다.
        let legacy = m[3].flatMap { match(etaStopsParenPattern, $0.trimmingCharacters(in: .whitespacesAndNewlines)) }
        let stops = legacy?[1].flatMap(Int.init)
        if let stops, stops < 1 { return nil }
        let r: (ok: Bool, station: String?) =
            legacy != nil ? (true, msg3.isEmpty ? nil : msg3) : resolveStation(m[3], msg3)
        guard r.ok else { return nil }
        return .eta(minutes: min >= 1 ? min : nil, seconds: sec >= 1 ? sec : nil, stops: stops, nowAt: r.station)
    }
    // ⚠ 당역 문법은 **`arvlMsg3`와 값이 같을 때만** 인정한다 — `{무엇} 도착` 모양은 역명이 아닌 말도
    // 통과시킨다(`곧 도착`의 "곧"을 역으로 읽는다). 코퍼스의 이 문법 228행은 전부 `arvlMsg3`와 같다.
    if let m = match(stationEventPattern, msg), let verb = m[2].flatMap({ verbs[$0] }),
       !msg3.isEmpty, m[1]?.trimmingCharacters(in: .whitespacesAndNewlines) == msg3 {
        return .stationEvent(verb: verb, station: msg3)
    }
    return nil
}

/// 계획이 요구하는 역(문장의 역 또는 꼬리) — 없으면 그 줄은 역명 없이 선다.
public func subwayArrivalPlanStation(_ plan: SubwayArrivalPlan) -> String? {
    switch plan {
    case let .stationEvent(_, station), let .prevStationEvent(_, station), let .stopsAway(_, station):
        return station
    case .departedStopsBack:
        return nil
    case let .eta(_, _, _, nowAt):
        return nowAt
    }
}

/// 문장 한 조각 — 키와 인자(순서는 ko 문장의 플레이스홀더 순서 = 위치 인자 ABI).
public struct SubwayArrivalSegment: Equatable, Sendable {
    public let key: String
    public let args: [String]
}

/// 쉼표로 잇는 조각들과, 앞 문장에 공백으로 잇는 꼬리.
public struct SubwayArrivalSegments: Equatable, Sendable {
    public let joined: [SubwayArrivalSegment]
    public let tail: SubwayArrivalSegment?
}

/// 계획 + 그 줄에 실릴 역명 → 문장 조각. **키 선택이 여기 한 곳**이라 웹과 갈리지 않는다
/// (공유 fixture의 `keys` 열이 두 구현을 잠근다). 앱은 리터럴 `switch`로 카탈로그 조회만 한다
/// (`TransitWalkLegText` 선례 — 키를 보간으로 조립하면 누락 린터가 못 본다).
public func subwayArrivalProseSegments(_ plan: SubwayArrivalPlan, station: String?) -> SubwayArrivalSegments {
    let at = station ?? ""
    switch plan {
    case let .stationEvent(verb, _):
        return SubwayArrivalSegments(joined: [SubwayArrivalSegment(key: verb.rawValue, args: [at])], tail: nil)
    case let .prevStationEvent(verb, _):
        let key = ["approaching": "prevApproaching", "arrived": "prevArrived", "departed": "prevDeparted"]
        return SubwayArrivalSegments(
            joined: [SubwayArrivalSegment(key: key[verb.rawValue]!, args: [at])], tail: nil)
    case let .departedStopsBack(count):
        return SubwayArrivalSegments(
            joined: [SubwayArrivalSegment(key: "departedStopsBack", args: [String(count)])], tail: nil)
    case let .stopsAway(count, _):
        return SubwayArrivalSegments(
            joined: [SubwayArrivalSegment(key: "stopsAway", args: [String(count), at])], tail: nil)
    case let .eta(minutes, seconds, stops, nowAt):
        let eta: SubwayArrivalSegment
        if let minutes, let seconds {
            eta = SubwayArrivalSegment(key: "etaMinSec", args: [String(minutes), String(seconds)])
        } else if let minutes {
            eta = SubwayArrivalSegment(key: "etaMin", args: [String(minutes)])
        } else {
            eta = SubwayArrivalSegment(key: "etaSec", args: [String(seconds ?? 0)])
        }
        // 정거장이 함께 오면 버스 안내 상태 문장과 같은 순서·구분(정거장 먼저, 쉼표)으로 잇는다(E39).
        let joined =
            stops.map { [SubwayArrivalSegment(key: "stopsJoin", args: [String($0)]), eta] } ?? [eta]
        // 꼬리의 유무는 **계획**이 정하고 역명은 표기일 뿐이다(설계 리뷰 MINOR-4).
        let tail = nowAt.map { SubwayArrivalSegment(key: "nowAt", args: [station ?? $0]) }
        return SubwayArrivalSegments(joined: joined, tail: tail)
    }
}

// MARK: - A32 현재역 꼬리 (원문 경로 전용)

/// 지하철 도착 한 줄의 현재역 꼬리 판정(A32) — 웹 `src/lib/place-lines/station-arrivals.ts` 미러.
/// 공유 fixture `src/lib/__tests__/fixtures/subway-arrival-tail-cases.json`이 두 구현을 한 표로 잠근다.
/// ⚠ E37(문장형) 뒤로 이 판정은 **원문 경로**(문장을 못 알아본 줄)에서만 쓰인다.
///
/// 낭독 정본인 완성 문장(`arvlMsg2`)이 **이미 현재역을 담는 문법이 있다**(`6분 후 (강일)`·`강일 도착`).
/// 그 위에 `현재 {역}`을 또 이으면 한 접근성 객체 안에서 같은 역 이름이 두 번 낭독된다.
///
/// ⚠ **판정 축은 값 포함이지 글자 패턴이 아니다.** 역 이름 자체에 괄호가 있어서
/// (`천호(풍납토성) 전역출발`) "괄호가 있으면 현재역이 들어 있다"는 규칙은 바로 어긋난다.
/// 알아보지 못하면 **붙이는 쪽**으로 실패한다(= 현행 동작, 정보 손실 0).
///
/// ⚠ **언어마다 자기 값으로 판정한다.** 영문 문장(`messageEn`)은 괄호 현재역을 담지 않는다
/// (`subway-arrival-en.ts`가 `currentLocationEn` 단일 채널로 뺀다 — E27 설계 리뷰 #5). 한국어
/// 값으로 en을 판정하면 중복이 없는 줄에서 꼬리를 떼어 **en 사용자만 현재역을 잃는다**.
///
/// ⚠ **판정에는 그 줄에 실제로 렌더될 값을 먹인다.** 소비자가 렌더값이 아닌 원본 필드를 판정에 주면
/// "붙일 자격은 있는데 붙일 값이 없는" 어긋남이 생긴다(그 어긋남이 웹에서 `lang="en"` 누락 회귀를
/// 만들었다 — A32 리뷰 3층 공통 검출).
///
/// - Parameters:
///   - message: 그 줄에 실제로 쓸 완성 문장(ko `arvlMsg2` 또는 en `messageEn`).
///   - currentLocation: 같은 줄에 **실제로 실릴** 현재역(ko `arvlMsg3` 또는 en `currentLocationEn`).
/// - Returns: 꼬리(`현재 {역}`)를 붙일 것인가.
public func subwayShowsCurrentLocationTail(message: String?, currentLocation: String?) -> Bool {
    let location = (currentLocation ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    // 현재역이 애초에 없으면 붙일 것도 없다("정보 없음"이지 중복이 아니다).
    guard !location.isEmpty else { return false }
    // 문장은 trim하지 않는다 — 찾는 값의 양끝 공백이 이미 없어 문장 양끝을 다듬어도 포함 여부가
    // 바뀌지 않는데, 웹과 trim 문자 집합이 다르다는 발산 표면만 들어온다.
    return !(message ?? "").contains(location)
}

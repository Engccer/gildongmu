import Foundation

// 베르길리우스 「말로 묻기」(E82 S6, spec `2026-11-14-e82-vergilius-v1-design.md` §3.3·§4) — 앱 쪽 계약과 순수 판정.
//
// 서버 계약의 정본은 웹 `src/lib/vergilius/types.ts`다(요청 zod 스키마·NDJSON 이벤트). 여기는 그 미러와, 나들이 모델이
// 부르는 판정(재료 조립·문장 나누기·읽기 진행·선택지 순서)이다. I/O는 `VergiliusService` 하나다.
//
// ⚠ 재료에는 앱이 계산한 것만 싣는다(V18). 좌표는 `location`과 `places[].lat/lng`에만 있고, 서버는 그 좌표를 모델에게
// 주는 글에 넣지 않는다(`materials.ts`).

// MARK: - 상한과 시한

/// 주변 가게 상한(V18, 서버 `VERGILIUS_PLACES_MAX`).
public let vergiliusPlacesMax = 30
/// 최근 기록 상한(V18, 서버 `VERGILIUS_LOG_MAX`).
public let vergiliusLogMax = 20
/// 질문 글 상한(서버 `VERGILIUS_QUESTION_MAX`). 넘는 받아쓰기는 앞에서 자른다.
public let vergiliusQuestionMax = 500
/// 서버가 받는 거리 상한(m). 넘는 가게는 재료에서 뺀다(400을 받지 않게).
public let vergiliusDistanceMaxMeters = 5000.0
/// 질문이 끝난 뒤 이 시간 안에 읽을 문장이 하나도 오지 않으면 「답을 받지 못했습니다」(V17, 위원장 판정 2026-11-15: 12초,
/// 모든 모델 같은 기준). 서버의 요청 전체 시한(25초)보다 짧다 — 첫 문장이 늦으면 기다리는 침묵이 고장과 구분되지 않는다.
public let vergiliusFirstSentenceTimeoutSeconds = 12.0
/// 앱 요청의 전송 시한(초). 서버 시한 25초 + 여유.
public let vergiliusRequestTimeoutSeconds = 30.0

// MARK: - 답변 모델 선택지 (V23)

/// 설정 「답변 모델」의 저장 키와 순서.
public enum VergiliusProvider {
    public static let storageKey = "vergiliusProvider"

    /// 화면 순서(위원장 판정 2026-11-15): OpenAI → Claude Sonnet → Claude Opus → Claude Haiku → Google. 값은 서버 식별자다.
    public static let displayOrder = ["openai", "claude-sonnet", "claude-opus", "claude-haiku", "google"]

    /// 화면 이름은 회사가 아니라 모델 이름이다(위원장 2026-11-15) — 고유 명칭이라 번역하지 않는다. ⚠ 서버 식별자 `openai`·
    /// `google`이 가리키는 모델은 서버 상수(`OPENAI_VERGILIUS_MODEL`·`GOOGLE_VERGILIUS_MODEL`)가 정한다: 서버에서 모델을 바꾸면
    /// 이 이름도 함께 고친다(가드 `vergilius-model-names.test.ts`).
    public static func displayName(_ id: String) -> String? {
        switch id {
        case "openai": "GPT-6.1 Terra"
        case "claude-sonnet": "Claude Sonnet"
        case "claude-opus": "Claude Opus"
        case "claude-haiku": "Claude Haiku"
        case "google": "Gemini 3.5 Flash-Lite"
        default: nil
        }
    }

    /// 서버가 연 선택지를 화면 순서로 늘어놓는다. 앱이 모르는 이름은 건너뛴다(이름을 붙일 수 없다).
    public static func choices(server: [String]) -> [String] {
        displayOrder.filter { server.contains($0) }
    }

    /// 실제로 쓸 선택지: 저장한 값이 열려 있으면 그것, 아니면 목록 맨 앞(처음 값). 열린 것이 없으면 nil.
    public static func effective(stored: String?, choices: [String]) -> String? {
        if let stored, choices.contains(stored) { return stored }
        return choices.first
    }
}

// MARK: - 요청

public enum VergiliusZone: String, Sendable, Equatable, Encodable {
    case ahead, beside, behind, unknown
}

public struct VergiliusPlaceInput: Sendable, Equatable, Encodable {
    public let id: String
    public let name: String
    public let category: String
    public let zone: VergiliusZone
    public let side: OutingSide
    public let distance: Double
    public let lat: Double
    public let lng: Double
}

extension OutingSide: Encodable {}

public enum VergiliusLogKind: String, Sendable, Equatable, Encodable {
    case place, crosswalk, junction, road, answer
}

public struct VergiliusLogInput: Sendable, Equatable, Encodable {
    public let kind: VergiliusLogKind
    public let text: String
    public let agoSeconds: Double
    public let placeId: String?
}

public struct VergiliusJunctionAhead: Sendable, Equatable, Encodable {
    public let meters: Double
    public let branches: Int
}

/// POST /api/vergilius/ask 본문. ⚠ `junctionAhead`·`nextCrosswalkMeters`·`roadName`은 서버가 `nullable`(키 필수)로 받으므로
/// nil을 `null`로 싣는다 — 합성 인코딩은 키를 빼서 400이 된다.
public struct VergiliusAskBody: Sendable, Equatable, Encodable {
    public let question: String
    public let locale: String
    public let provider: String
    public let lat: Double
    public let lng: Double
    public let headingKnown: Bool
    public let places: [VergiliusPlaceInput]
    public let junctionAhead: VergiliusJunctionAhead?
    public let nextCrosswalkMeters: Double?
    public let roadName: String?
    public let log: [VergiliusLogInput]

    public init(
        question: String, locale: String, provider: String, lat: Double, lng: Double, headingKnown: Bool,
        places: [VergiliusPlaceInput], junctionAhead: VergiliusJunctionAhead?, nextCrosswalkMeters: Double?,
        roadName: String?, log: [VergiliusLogInput]
    ) {
        self.question = vergiliusLine(question, max: vergiliusQuestionMax, singleLine: false)
        self.locale = locale
        self.provider = provider
        self.lat = lat
        self.lng = lng
        self.headingKnown = headingKnown
        self.places = places
        self.junctionAhead = junctionAhead
        self.nextCrosswalkMeters = nextCrosswalkMeters
        self.roadName = roadName.map { vergiliusLine($0, max: 60, singleLine: true) }.flatMap { $0.isEmpty ? nil : $0 }
        self.log = log
    }

    private enum CodingKeys: String, CodingKey {
        case question, locale, provider, location, headingKnown, places, junctionAhead, nextCrosswalkMeters, roadName, log
    }

    private struct Location: Encodable {
        let lat: Double
        let lng: Double
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(question, forKey: .question)
        try c.encode(locale, forKey: .locale)
        try c.encode(provider, forKey: .provider)
        try c.encode(Location(lat: lat, lng: lng), forKey: .location)
        try c.encode(headingKnown, forKey: .headingKnown)
        try c.encode(places, forKey: .places)
        try c.encode(junctionAhead, forKey: .junctionAhead)  // nil → null
        try c.encode(nextCrosswalkMeters, forKey: .nextCrosswalkMeters)
        try c.encode(roadName, forKey: .roadName)
        try c.encode(log, forKey: .log)
    }
}

/// 서버의 한 줄 글 규칙(`line()`)에 맞춘다: 앞뒤 공백을 걷고, 줄을 가르는 문자(C0 제어·DEL·NEL·U+2028·U+2029)는 공백으로
/// 바꾸고, 상한에서 자른다. `singleLine`이 거짓이면(질문 글) 제어 문자를 그대로 둔다 — 서버도 질문에는 그 규칙을 걸지 않는다.
func vergiliusLine(_ s: String, max: Int, singleLine: Bool) -> String {
    var out = s
    if singleLine {
        out = String(String.UnicodeScalarView(out.unicodeScalars.map { u in
            let v = u.value
            return v < 0x20 || v == 0x7f || v == 0x85 || v == 0x2028 || v == 0x2029 ? " " : u
        }))
    }
    out = out.trimmingCharacters(in: .whitespacesAndNewlines)
    // 서버는 UTF-16 길이로 센다(JS `string.length`).
    if out.utf16.count > max {
        var cut = ""
        for ch in out {
            if cut.utf16.count + String(ch).utf16.count > max { break }
            cut.append(ch)
        }
        out = cut.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return out
}

// MARK: - 재료 조립 (V18)

/// 재료에 실을 가게 하나의 원재료(앱이 쥔 장소와 그 진행축 관계).
public struct VergiliusPlaceSource: Sendable {
    public let id: String
    public let name: String
    public let category: String
    public let lat: Double
    public let lng: Double
    public let relation: OutingRelation

    public init(id: String, name: String, category: String, lat: Double, lng: Double, relation: OutingRelation) {
        self.id = id
        self.name = name
        self.category = category
        self.lat = lat
        self.lng = lng
        self.relation = relation
    }
}

/// 주변 가게 재료: 가까운 순 최대 30곳. 방향을 모르면(`headingKnown` 거짓) 구획은 「모름」이고 좌우도 「모름」이다 —
/// 방향 없는 관계는 `outingProject`가 「옆」으로 두므로 그대로 보내면 모델이 「옆에」라고 단정한다(V19).
/// 이름이 비거나 거리가 서버 상한을 넘는 가게는 뺀다(요청 전체가 400이 되지 않게).
public func vergiliusPlaces(_ sources: [VergiliusPlaceSource], headingKnown: Bool) -> [VergiliusPlaceInput] {
    sources
        .filter { $0.relation.d.isFinite && $0.relation.d <= vergiliusDistanceMaxMeters }
        .sorted { ($0.relation.d, $0.id) < ($1.relation.d, $1.id) }
        .compactMap { s -> VergiliusPlaceInput? in
            let id = vergiliusLine(s.id, max: 64, singleLine: true)
            let name = vergiliusLine(s.name, max: 100, singleLine: true)
            guard !id.isEmpty, !name.isEmpty else { return nil }
            let zone: VergiliusZone
            if headingKnown {
                switch s.relation.zone {
                case .ahead: zone = .ahead
                case .beside: zone = .beside
                case .behind: zone = .behind
                }
            } else {
                zone = .unknown
            }
            return VergiliusPlaceInput(
                id: id, name: name, category: vergiliusLine(s.category, max: 60, singleLine: true), zone: zone,
                side: headingKnown ? s.relation.side : .unknown, distance: max(0, s.relation.d.rounded()),
                lat: s.lat, lng: s.lng)
        }
        .prefix(vergiliusPlacesMax)
        .map { $0 }
}

/// 최근 기록 재료: 최신부터 20건. `text`는 화면이 그 줄에 쓰는 문장(시각 꼬리 없이)이고, 비면 그 줄을 뺀다.
/// 지나온 가게(말하지 못한 것)는 싣지 않는다 — 「방금 말한 것」이 아니다.
public func vergiliusLog(
    _ entries: [OutingHistoryEntry], now: Double, text: (OutingHistoryContent) -> String
) -> [VergiliusLogInput] {
    entries.compactMap { entry -> VergiliusLogInput? in
        let kind: VergiliusLogKind
        var placeId: String?
        switch entry.content {
        case .place(let place, _, let passedBy):
            guard !passedBy else { return nil }
            kind = .place
            placeId = vergiliusLine(place.id, max: 64, singleLine: true)
        case .crosswalk: kind = .crosswalk
        case .junction: kind = .junction
        case .road: kind = .road
        case .answer: kind = .answer
        }
        let line = vergiliusLine(text(entry.content), max: 300, singleLine: true)
        guard !line.isEmpty else { return nil }
        return VergiliusLogInput(
            kind: kind, text: line, agoSeconds: min(86_400, max(0, (now - entry.at).rounded())),
            placeId: placeId.flatMap { $0.isEmpty ? nil : $0 })
    }
    .prefix(vergiliusLogMax)
    .map { $0 }
}

/// 앞쪽 갈림길 재료: 진행 방향 앞, 진행선 가까이(횡방향 `outingJunctionLateralMeters` 안)의 가장 가까운 갈림길(거리·갈래 수).
/// 방향을 모르거나 없으면 nil.
/// 갈래 수는 서버 범위(2~8) 밖이면 싣지 않는다.
public func vergiliusJunctionAhead(
    _ junctions: [(junction: OutingJunction, relation: OutingRelation, branches: [OutingRelation])]
) -> VergiliusJunctionAhead? {
    junctions
        .filter {
            $0.relation.validBearing != nil && $0.relation.zone == .ahead
                && abs($0.relation.t) <= outingJunctionLateralMeters && $0.relation.s <= vergiliusDistanceMaxMeters
        }
        .filter { (2...8).contains($0.junction.branches.count) }
        .min { $0.relation.s < $1.relation.s }
        .map { VergiliusJunctionAhead(meters: max(0, $0.relation.s.rounded()), branches: $0.junction.branches.count) }
}

/// 다음 횡단보도까지의 거리: 진행 방향 앞, 횡방향 범위 안에서 가장 가까운 것. 방향을 모르면 nil(앞을 모른다).
public func vergiliusNextCrosswalkMeters(_ relations: [OutingRelation]) -> Double? {
    relations
        .filter {
            $0.validBearing != nil && $0.zone == .ahead && abs($0.t) <= outingCrosswalkLateralMeters
                && $0.s <= vergiliusDistanceMaxMeters
        }
        .map(\.s)
        .min()
        .map { max(0, $0.rounded()) }
}

// MARK: - 응답 (NDJSON)

/// NDJSON 한 줄. 웹 `VergiliusStreamEvent` 미러 + 비스트림 200 `{"outOfCoverage":true}`. 미지 type은 `.unknown`(무시).
public enum VergiliusStreamEvent: Sendable {
    case text(delta: String, final: Bool)
    case reset
    /// `renders`는 `route-start`만 남긴다(V21 — 서버도 그것만 보내지만 앱이 다시 거른다).
    case done(text: String, renders: [RouteStartChatPayload], proposalPlaceId: String?)
    case error(code: String)
    case outOfCoverage
    case unknown
}

extension VergiliusStreamEvent: Decodable {
    private enum CodingKeys: String, CodingKey {
        case type, delta, final, text, renders, proposal, code, outOfCoverage
    }

    private struct Proposal: Decodable {
        let placeId: String
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if try c.decodeIfPresent(Bool.self, forKey: .outOfCoverage) == true {
            self = .outOfCoverage
            return
        }
        switch try c.decode(String.self, forKey: .type) {
        case "text":
            self = .text(delta: try c.decode(String.self, forKey: .delta), final: try c.decode(Bool.self, forKey: .final))
        case "reset":
            self = .reset
        case "done":
            let renders = try c.decodeIfPresent([ChatRenderPayload].self, forKey: .renders) ?? []
            self = .done(
                text: try c.decode(String.self, forKey: .text),
                renders: renders.compactMap { if case .routeStart(let p) = $0 { p } else { nil } },
                proposalPlaceId: try c.decodeIfPresent(Proposal.self, forKey: .proposal)?.placeId)
        case "error":
            self = .error(code: try c.decode(String.self, forKey: .code))
        default:
            self = .unknown
        }
    }
}

public func decodeVergiliusEventLine(_ line: String) throws -> VergiliusStreamEvent {
    try JSONDecoder().decode(VergiliusStreamEvent.self, from: Data(line.utf8))
}

// MARK: - 문장 나누기 (V16)

/// 문장 끝 부호. 그 뒤에 공백(또는 줄바꿈)이 와야 끝이다 — 「3.5km」의 점은 끝이 아니다.
private let sentenceEnders: Set<Character> = [".", "?", "!", "。", "？", "！", "…"]
/// 끝 부호 뒤에 붙어 문장에 딸리는 닫는 기호.
private let sentenceClosers: Set<Character> = ["\"", "'", "”", "’", ")", "」", "』", "]"]

/// 흘러 들어오는 글을 완결된 문장으로 자른다. 문장이 완결되는 대로 읽기 시작하려는 것이라(V16) 끝을 확신할 수 있는
/// 자리(끝 부호 + 공백, 줄바꿈)에서만 자르고, 나머지는 쥐고 있다가 `flush`에서 낸다.
public struct VergiliusSentenceSplitter: Sendable, Equatable {
    private var buffer = ""

    public init() {}

    /// 조각을 더하고 완결된 문장을 낸다(앞뒤 공백을 걷은, 비지 않은 문장만).
    public mutating func append(_ delta: String) -> [String] {
        buffer += delta
        var out: [String] = []
        var start = buffer.startIndex
        var i = buffer.startIndex
        while i < buffer.endIndex {
            let ch = buffer[i]
            var end: String.Index?
            if ch == "\n" {
                end = buffer.index(after: i)
            } else if sentenceEnders.contains(ch) {
                var j = buffer.index(after: i)
                while j < buffer.endIndex, sentenceEnders.contains(buffer[j]) || sentenceClosers.contains(buffer[j]) {
                    j = buffer.index(after: j)
                }
                // 끝 부호 뒤가 아직 오지 않았으면 기다린다(다음 조각이 숫자일 수 있다).
                if j < buffer.endIndex, buffer[j].isWhitespace { end = j }
                i = j
                if end == nil { continue }
            }
            if let e = end {
                let sentence = buffer[start..<e].trimmingCharacters(in: .whitespacesAndNewlines)
                if !sentence.isEmpty { out.append(sentence) }
                start = e
                i = e
                continue
            }
            i = buffer.index(after: i)
        }
        buffer = String(buffer[start...])
        return out
    }

    /// 남은 글(끝 부호 없이 끝난 마지막 문장)을 낸다.
    public mutating func flush() -> String? {
        let rest = buffer.trimmingCharacters(in: .whitespacesAndNewlines)
        buffer = ""
        return rest.isEmpty ? nil : rest
    }

    /// 쥐고 있던 글을 버린다(`reset` 이벤트).
    public mutating func clear() { buffer = "" }
}

// MARK: - 읽기 진행 (V16·V17·V22)

/// 답 실패의 두 갈래(V17): 읽을 문장이 하나도 오지 않았다 / 읽기 시작한 뒤 끊겼다.
public enum VergiliusFailure: String, Sendable, Equatable {
    case noAnswer
    case cutOff
}

/// 이벤트 하나를 받은 뒤 앱이 할 일.
public enum VergiliusReaderAction: Sendable, Equatable {
    /// 이 문장을 읽을 줄 뒤에 세운다.
    case speak(String)
    /// 아직 읽지 않은 문장을 버린다(`reset` — 도구 호출 앞의 군말이었다).
    case discardUnread
    /// 답이 끝났다. `proposalPlaceId`가 있으면 모델의 글이 아니라 앱의 틀 문장을 읽는다(V22).
    case finish(text: String, renders: [RouteStartChatPayload], proposalPlaceId: String?)
    case fail(VergiliusFailure)
}

/// 한 질문의 응답 읽기 상태(순수). 시한(12초)은 앱이 재고 `timedOut()`을 부른다.
public struct VergiliusReader: Sendable {
    private var splitter = VergiliusSentenceSplitter()
    /// 지금 회차에서 읽을 줄에 세운 문장 수. 0이면 아직 읽을 문장이 오지 않았다. `reset`이 0으로 돌린다 — 버린 군말은
    /// 답이 아니므로 첫 문장 시한(V17)이 아직 울리지 않았다면 그때 「받지 못함」이 된다(시한은 질문마다 한 번 울린다).
    public private(set) var queuedSentences = 0
    public private(set) var finished = false

    public init() {}

    public mutating func receive(_ event: VergiliusStreamEvent) -> [VergiliusReaderAction] {
        guard !finished else { return [] }
        switch event {
        case .text(let delta, let final):
            // 도구 호출이 낀 회차의 글(final 거짓)은 읽지 않는다(V16).
            guard final else { return [] }
            let sentences = splitter.append(delta)
            queuedSentences += sentences.count
            return sentences.map { .speak($0) }
        case .reset:
            splitter.clear()
            queuedSentences = 0
            return [.discardUnread]
        case .done(let text, let renders, let proposal):
            finished = true
            if proposal != nil {
                splitter.clear()
                return [.discardUnread, .finish(text: "", renders: [], proposalPlaceId: proposal)]
            }
            var actions: [VergiliusReaderAction] = []
            if let rest = splitter.flush() {
                queuedSentences += 1
                actions.append(.speak(rest))
            }
            actions.append(.finish(text: text, renders: renders, proposalPlaceId: nil))
            return actions
        case .error, .outOfCoverage:
            return fail()
        case .unknown:
            return []
        }
    }

    /// 스트림이 `done`·`error` 없이 끝났거나 연결이 끊겼다.
    public mutating func streamEnded() -> [VergiliusReaderAction] {
        guard !finished else { return [] }
        return fail()
    }

    /// 첫 문장 시한이 지났다. 이미 읽을 문장이 왔으면 아무 일도 없다.
    public mutating func timedOut() -> [VergiliusReaderAction] {
        guard !finished, queuedSentences == 0 else { return [] }
        return fail()
    }

    private mutating func fail() -> [VergiliusReaderAction] {
        finished = true
        splitter.clear()
        return [.fail(queuedSentences == 0 ? .noAnswer : .cutOff)]
    }
}

// MARK: - I/O

/// `/api/vergilius/ask`(NDJSON)·`/api/vergilius/providers` 소비자.
public struct VergiliusService: Sendable {
    let session: URLSession
    let baseURL: URL

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    private struct ProvidersResponse: Decodable {
        let providers: [String]
    }

    /// 서버에 키가 있는 답변 모델 식별자(서버 순서 그대로 — 화면 순서는 `VergiliusProvider.choices`).
    /// `timeout`: 질문 경로는 짧게 준다(첫 문장 12초 시한 안에서 조회가 묻는 시간을 잠식하지 않게).
    public func providers(timeout: TimeInterval = 10) async throws -> [String] {
        let response: ProvidersResponse = try await APIClient(baseURL: baseURL, session: session)
            .get("/api/vergilius/providers", query: [], timeout: timeout)
        return response.providers
    }

    /// 답 스트림. 소비 Task가 취소되면 전송을 거둔다. 2xx가 아니면 `APIError.badStatus`로 끝난다.
    public func ask(_ body: VergiliusAskBody) -> AsyncThrowingStream<VergiliusStreamEvent, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var request = URLRequest(url: baseURL.appending(path: "/api/vergilius/ask"))
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.timeoutInterval = vergiliusRequestTimeoutSeconds
                    request.httpBody = try JSONEncoder().encode(body)
                    let (bytes, response) = try await session.bytes(for: request)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    guard (200..<300).contains(status) else {
                        var data = Data()
                        for try await byte in bytes { data.append(byte) }
                        let message = try? JSONDecoder().decode(APIErrorBody.self, from: data).error
                        throw APIError.badStatus(code: status, message: message)
                    }
                    for try await line in bytes.lines {
                        let trimmed = line.trimmingCharacters(in: .whitespaces)
                        guard !trimmed.isEmpty else { continue }
                        continuation.yield(try decodeVergiliusEventLine(trimmed))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

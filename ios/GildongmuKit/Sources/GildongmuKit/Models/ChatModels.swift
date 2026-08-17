import Foundation

/// 응답 하단 출처 하나. 웹 SourceAttribution 미러(label은 i18n 키, url은 선택).
public struct ChatSource: Decodable, Sendable, Hashable {
    public let label: String
    public let url: String?

    public init(label: String, url: String? = nil) {
        self.label = label
        self.url = url
    }
}

/// 렌더 페이로드: 웹 RenderPayload의 V1 부분집합.
/// props-driven 3종(places·addresses·web-results)만 파싱하고, self-fetch 파라미터
/// 카드류와 미지 타입은 전부 .unsupported로 강등한다(산문이 정본, 계획서 렌더 정책).
public enum ChatRenderPayload: Sendable {
    /// sort는 리뷰순(네이버)일 때 .review — 카드 묶음 헤딩이 "네이버 리뷰순 N곳"으로 갈리는
    /// 유일한 재료(낭독은 선형이라 헤딩이 곧 경계, spec 2026-08-17 §5.3). 서버가 sort를
    /// 싣지 않으면 .accuracy(종전 페이로드).
    case places([Place], sort: PlaceSort)
    case addresses([JusoAddress])
    case webResults([WebSearchResult])
    case unsupported
}

extension ChatRenderPayload: Decodable {
    private enum CodingKeys: String, CodingKey {
        case type, places, results, sort
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .type) {
        case "places":
            let sort = try container.decodeIfPresent(String.self, forKey: .sort) == "review" ? PlaceSort.review : .accuracy
            self = .places(try container.decode([Place].self, forKey: .places), sort: sort)
        case "addresses":
            self = .addresses(try container.decode([JusoAddress].self, forKey: .results))
        case "web-results":
            self = .webResults(try container.decode([WebSearchResult].self, forKey: .results))
        // 웹은 self-fetch 카드(타입만)이고, 서버가 iOS를 위해 같은 렌더에 공통 Place 투영
        // (`nearby-place.ts`)을 `places`로 싣는다(2026-08-17, BACKLOG B9). 있으면 장소
        // 카드로 취급해 카드·산문 장소 언급 → 상세 진입이 다른 장소 답변과 같아진다.
        // 없으면(옛 서버) 종전대로 미표시.
        case "clinics-nearby", "kids-nearby", "surroundings-nearby", "barrier-free-nearby":
            if let places = try container.decodeIfPresent([Place].self, forKey: .places), !places.isEmpty {
                self = .places(places, sort: .accuracy)
            } else {
                self = .unsupported
            }
        default:
            self = .unsupported
        }
    }
}

/// NDJSON 스트리밍 이벤트(1줄 1이벤트). 웹 ChatStreamEvent 미러 + 전방 호환:
/// 미지 이벤트 type은 디코딩 오류가 아니라 .unknown(소비자가 무시).
public enum ChatStreamEvent: Sendable {
    case status(categories: [String])
    case done(text: String, renders: [ChatRenderPayload], sources: [ChatSource])
    case error(code: String)
    case unknown
}

extension ChatStreamEvent: Decodable {
    private enum CodingKeys: String, CodingKey {
        case type, categories, text, renders, sources, code
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .type) {
        case "status":
            self = .status(categories: try container.decode([String].self, forKey: .categories))
        case "done":
            self = .done(
                text: try container.decode(String.self, forKey: .text),
                renders: try container.decodeIfPresent([ChatRenderPayload].self, forKey: .renders) ?? [],
                sources: try container.decodeIfPresent([ChatSource].self, forKey: .sources) ?? []
            )
        case "error":
            self = .error(code: try container.decode(String.self, forKey: .code))
        default:
            self = .unknown
        }
    }
}

/// POST /api/chat 요청 body. 웹 ChatRequest 미러.
/// userLocation·placeContext는 nil이면 키 자체를 생략한다(서버 undefined 의미론).
public struct ChatRequestBody: Encodable, Sendable {
    /// 대화 턴 하나. role은 "user" | "assistant"(웹 계약 문자열 그대로).
    public struct Turn: Encodable, Sendable {
        public let role: String
        public let text: String

        public init(role: String, text: String) {
            self.role = role
            self.text = text
        }
    }

    public struct Coordinate: Encodable, Sendable {
        public let lat: Double
        public let lng: Double

        public init(lat: Double, lng: Double) {
            self.lat = lat
            self.lng = lng
        }
    }

    /// 장소 앵커(웹 불변식): 주변 도구 기준 좌표는 이 장소, 길찾기 출발지는 userLocation.
    public struct PlaceContext: Encodable, Sendable {
        public let name: String
        public let lat: Double
        public let lng: Double
        public let category: String?
        public let isStation: Bool?

        public init(name: String, lat: Double, lng: Double, category: String? = nil, isStation: Bool? = nil) {
            self.name = name
            self.lat = lat
            self.lng = lng
            self.category = category
            self.isStation = isStation
        }
    }

    public let messages: [Turn]
    public let userLocation: Coordinate?
    public let locale: String
    public let placeContext: PlaceContext?

    public init(messages: [Turn], userLocation: Coordinate?, locale: String, placeContext: PlaceContext?) {
        self.messages = messages
        self.userLocation = userLocation
        self.locale = locale
        self.placeContext = placeContext
    }
}

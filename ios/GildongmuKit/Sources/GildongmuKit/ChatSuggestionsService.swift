import Foundation

/// POST /api/chat/suggestions 요청 본문(서버 zod 스키마 미러).
struct ChatSuggestionsRequestBody: Encodable, Sendable {
    let lastUserMessage: String
    let lastAssistantMessage: String
    let locale: String
    let placeName: String?
}

/// 채팅 답변 뒤 follow-up 질문 제안 조회(spec 2026-08-24 §3.3).
/// `ChatService` 옆 구조체이고 `APIClient` 관례(URLRequest·JSONEncoder)를 따른다.
/// 실패·디코딩 불가·취소·타임아웃 전부 `[]` — 칩은 없어도 되는 보조 컨트롤이라
/// 어떤 실패도 "칩 없음"이지 오류가 아니다.
public struct ChatSuggestionsService: Sendable {
    /// 서버 제한(3개)과 같은 상한. 서버가 더 주더라도 여기서 절단한다.
    public static let maxSuggestions = 3
    /// 본 답변 뒤에 비동기로 붙는 보조 요청이라 예산을 명시한다(APIClient `timeout` 주석 동형).
    public static let timeoutSeconds: TimeInterval = 6

    let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    /// 응답 본문 `{suggestions: string[]}` → 제안 목록. 네트워크 없이 테스트하기 위해 분리한
    /// 순수 함수. `suggestions` 부재·비배열은 `[]`, 비문자열·공백 원소는 건너뛰고
    /// 최대 `maxSuggestions`개로 절단한다.
    public static func parse(_ data: Data) -> [String] {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = object["suggestions"] as? [Any] else {
            return []
        }
        return Array(
            list.lazy
                .compactMap { $0 as? String }
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .prefix(maxSuggestions)
        )
    }

    public func fetchFollowUps(
        lastUserMessage: String,
        lastAssistantMessage: String,
        locale: String,
        placeName: String?,
        baseURL: URL
    ) async -> [String] {
        var request = URLRequest(url: baseURL.appending(path: "/api/chat/suggestions"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = Self.timeoutSeconds
        let body = ChatSuggestionsRequestBody(
            lastUserMessage: lastUserMessage,
            lastAssistantMessage: lastAssistantMessage,
            locale: locale,
            placeName: placeName
        )
        guard let encoded = try? JSONEncoder().encode(body) else { return [] }
        request.httpBody = encoded

        guard let (data, response) = try? await session.data(for: request) else { return [] }
        guard !Task.isCancelled else { return [] }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { return [] }
        return Self.parse(data)
    }
}

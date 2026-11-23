import Foundation

/// NDJSON 한 줄을 채팅 이벤트로 디코딩하는 순수 함수.
/// 스트림 배관과 분리해 단위 테스트 대상으로 삼는다(스트림 자체는 실기기 실호출 게이트).
public func decodeChatEventLine(_ line: String) throws -> ChatStreamEvent {
    try JSONDecoder().decode(ChatStreamEvent.self, from: Data(line.utf8))
}

/// POST /api/chat NDJSON 스트림 소비자.
/// 서버 maxDuration(120초)보다 긴 180초 타임아웃(웹 useChat의 "클라가 더 길게" 계약).
public struct ChatService: Sendable {
    let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    private struct ModelsResponse: Decodable {
        let models: [String]
    }

    /// 서버에 키가 있는 채팅 답변 모델 식별자(Gemini 제외, E89). 화면 순서는 `ChatAnswerModel.choices`.
    public func models(baseURL: URL, timeout: TimeInterval = 10) async throws -> [String] {
        let response: ModelsResponse = try await APIClient(baseURL: baseURL, session: session)
            .get("/api/chat/models", query: [], timeout: timeout)
        return response.models
    }

    /// 이벤트 스트림. 소비 Task가 취소되면 onTermination이 전송 Task를 취소한다.
    public func stream(_ body: ChatRequestBody, baseURL: URL) -> AsyncThrowingStream<ChatStreamEvent, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var request = URLRequest(url: baseURL.appending(path: "/api/chat"))
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.timeoutInterval = 180
                    request.httpBody = try JSONEncoder().encode(body)

                    let (bytes, response) = try await session.bytes(for: request)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    guard (200..<300).contains(status) else {
                        // 오류 본문은 짧은 JSON이므로 전부 모아 message로 승격
                        var data = Data()
                        for try await byte in bytes { data.append(byte) }
                        let message = try? JSONDecoder().decode(APIErrorBody.self, from: data).error
                        throw APIError.badStatus(code: status, message: message)
                    }

                    for try await line in bytes.lines {
                        let trimmed = line.trimmingCharacters(in: .whitespaces)
                        guard !trimmed.isEmpty else { continue }
                        continuation.yield(try decodeChatEventLine(trimmed))
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

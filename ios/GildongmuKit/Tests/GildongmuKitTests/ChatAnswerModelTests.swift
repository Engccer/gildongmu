import Foundation
import Testing
@testable import GildongmuKit

@Suite("채팅 답변 모델 선택(E89)")
struct ChatAnswerModelTests {
    @Test("선택지는 Gemini가 맨 앞이고 서버 순서와 상관없이 화면 순서이며 모르는 이름은 건너뛴다")
    func order() {
        let server = ["claude-haiku", "mystery", "openai-luna", "claude-opus", "openai", "claude-sonnet"]
        #expect(
            ChatAnswerModel.choices(server: server)
                == ["gemini", "openai", "openai-luna", "claude-sonnet", "claude-opus", "claude-haiku"])
        #expect(ChatAnswerModel.choices(server: ["claude-opus"]) == ["gemini", "claude-opus"])
    }

    @Test("서버 목록이 비거나 모르는 이름뿐이면 빈 배열이다(줄을 숨긴다)")
    func emptyServer() {
        #expect(ChatAnswerModel.choices(server: []) == [])
        #expect(ChatAnswerModel.choices(server: ["mystery"]) == [])
    }

    @Test("저장값이 열려 있으면 그것, 닫혔거나 없으면 맨 앞(Gemini)")
    func effective() {
        let choices = ChatAnswerModel.choices(server: ["openai", "claude-opus"])
        #expect(ChatAnswerModel.effective(stored: "claude-opus", choices: choices) == "claude-opus")
        #expect(ChatAnswerModel.effective(stored: "claude-haiku", choices: choices) == "gemini")
        #expect(ChatAnswerModel.effective(stored: nil, choices: choices) == "gemini")
        #expect(ChatAnswerModel.effective(stored: "", choices: choices) == "gemini")
        #expect(ChatAnswerModel.effective(stored: "openai", choices: []) == nil)
    }

    @Test("요청 값은 Gemini·없음·모르는 값이면 nil, 아니면 그대로")
    func requestValue() {
        #expect(ChatAnswerModel.requestValue("gemini") == nil)
        #expect(ChatAnswerModel.requestValue(nil) == nil)
        #expect(ChatAnswerModel.requestValue("mystery") == nil)
        #expect(ChatAnswerModel.requestValue("openai-luna") == "openai-luna")
        #expect(ChatAnswerModel.requestValue("claude-sonnet") == "claude-sonnet")
    }

    @Test("화면 이름은 모델 이름이다")
    func names() {
        #expect(ChatAnswerModel.displayName("gemini") == "Gemini 3.6 Flash")
        #expect(ChatAnswerModel.displayName("openai") == "GPT-6.1 Terra")
        #expect(ChatAnswerModel.displayName("mystery") == nil)
        for id in ChatAnswerModel.displayOrder { #expect(ChatAnswerModel.displayName(id) != nil) }
    }

    @Test("요청 본문: chatModel이 nil이면 키가 없고 값이 있으면 키가 있다")
    func bodyEncoding() throws {
        let plain = ChatRequestBody(messages: [.init(role: "user", text: "안녕")], userLocation: nil, locale: "ko", placeContext: nil)
        let plainJSON = try #require(String(data: JSONEncoder().encode(plain), encoding: .utf8))
        #expect(!plainJSON.contains("chatModel"))
        let chosen = plain.with(chatModel: "claude-opus")
        let chosenJSON = try #require(String(data: JSONEncoder().encode(chosen), encoding: .utf8))
        #expect(chosenJSON.contains("\"chatModel\":\"claude-opus\""))
        #expect(!(try #require(String(data: JSONEncoder().encode(chosen.with(chatModel: nil)), encoding: .utf8))).contains("chatModel"))
    }
}

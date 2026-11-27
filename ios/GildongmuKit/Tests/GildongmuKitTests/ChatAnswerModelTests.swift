import Foundation
import Testing
@testable import GildongmuKit

@Suite("채팅 답변 모델 선택(E89·E92)")
struct ChatAnswerModelTests {
    @Test("정식판 선택지는 Terra·Gemini 둘이고 서버가 openai를 열 때만 선다")
    func releaseChoices() {
        let all = ["claude-haiku", "openai-luna", "claude-opus", "openai", "claude-sonnet"]
        #expect(ChatAnswerModel.choices(server: all, extended: false) == ["openai", "gemini"])
        #expect(ChatAnswerModel.choices(server: ["openai"], extended: false) == ["openai", "gemini"])
        // 서버가 openai를 열지 않으면 줄을 숨긴다(Gemini로 간다). Claude만 열려도 정식판에는 서지 않는다.
        #expect(ChatAnswerModel.choices(server: ["claude-opus", "openai-luna"], extended: false) == [])
        #expect(ChatAnswerModel.choices(server: [], extended: false) == [])
    }

    @Test("실험판 선택지는 여섯이고 Terra가 맨 앞, Gemini가 다음이며 모르는 이름은 건너뛴다")
    func extendedChoices() {
        let server = ["claude-haiku", "mystery", "openai-luna", "claude-opus", "openai", "claude-sonnet"]
        #expect(
            ChatAnswerModel.choices(server: server, extended: true)
                == ["openai", "gemini", "openai-luna", "claude-sonnet", "claude-opus", "claude-haiku"])
        // OpenAI 키가 없으면 Gemini가 맨 앞이다(처음 값이 닫혔을 때 다른 회사가 아니라 Gemini로 간다).
        #expect(ChatAnswerModel.choices(server: ["claude-opus"], extended: true) == ["gemini", "claude-opus"])
        #expect(ChatAnswerModel.choices(server: [], extended: true) == [])
        #expect(ChatAnswerModel.choices(server: ["mystery"], extended: true) == [])
    }

    @Test("처음 값은 Terra다: 저장값이 없거나 닫혔으면 맨 앞, 직접 고른 Gemini는 그대로")
    func effective() {
        #expect(ChatAnswerModel.defaultID == "openai")
        let release = ChatAnswerModel.choices(server: ["openai"], extended: false)
        #expect(ChatAnswerModel.effective(stored: nil, choices: release) == "openai")
        #expect(ChatAnswerModel.effective(stored: "", choices: release) == "openai")
        #expect(ChatAnswerModel.effective(stored: "gemini", choices: release) == "gemini")
        // 실험판에서 옮겨 온 값이 정식판에 열리지 않으면 처음 값이다.
        #expect(ChatAnswerModel.effective(stored: "claude-opus", choices: release) == "openai")
        #expect(ChatAnswerModel.effective(stored: "openai", choices: []) == nil)
    }

    @Test("요청 값: Terra는 openai, Gemini는 nil(필드 없음)")
    func requestValueChosen() {
        let release = ChatAnswerModel.choices(server: ["openai"], extended: false)
        #expect(ChatAnswerModel.requestValue(stored: nil, choices: release, extended: false) == "openai")
        #expect(ChatAnswerModel.requestValue(stored: "openai", choices: release, extended: false) == "openai")
        #expect(ChatAnswerModel.requestValue(stored: "gemini", choices: release, extended: false) == nil)
        let ext = ChatAnswerModel.choices(server: ["openai", "openai-luna", "claude-sonnet"], extended: true)
        #expect(ChatAnswerModel.requestValue(stored: "claude-sonnet", choices: ext, extended: true) == "claude-sonnet")
        #expect(ChatAnswerModel.requestValue(stored: "gemini", choices: ext, extended: true) == nil)
    }

    @Test("요청 값: 서버가 고를 모델을 열지 않으면(빈 선택지) nil이다")
    func requestValueClosed() {
        #expect(ChatAnswerModel.requestValue(stored: nil, choices: [], extended: false) == nil)
        #expect(ChatAnswerModel.requestValue(stored: "openai", choices: [], extended: true) == nil)
    }

    @Test("요청 값: 목록 조회가 실패하면 저장값 그대로, 없거나 그 판에서 고를 수 없는 값이면 처음 값")
    func requestValueLookupFailed() {
        #expect(ChatAnswerModel.requestValue(stored: nil, choices: nil, extended: false) == "openai")
        #expect(ChatAnswerModel.requestValue(stored: "gemini", choices: nil, extended: false) == nil)
        #expect(ChatAnswerModel.requestValue(stored: "claude-opus", choices: nil, extended: false) == "openai")
        #expect(ChatAnswerModel.requestValue(stored: "mystery", choices: nil, extended: true) == "openai")
        #expect(ChatAnswerModel.requestValue(stored: "claude-opus", choices: nil, extended: true) == "claude-opus")
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

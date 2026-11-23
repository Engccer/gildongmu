import Foundation

// 채팅 답변 모델 선택(E89, spec `2026-11-23-e89-chat-model-choice-design.md` §3·§4) — 앱 쪽 선택지 판정.
//
// 서버 계약: `POST /api/chat` 본문의 선택 필드 `chatModel`과 `GET /api/chat/models`. 처음 값(Gemini)은 필드를 보내지 않는다.

/// 설정 「채팅 답변 모델」의 저장 키와 순서.
public enum ChatAnswerModel {
    public static let storageKey = "chatAnswerModel"
    /// 처음 값. 서버 요청에는 싣지 않는다(`requestValue`).
    public static let defaultID = "gemini"

    /// 화면 순서: 나들이 답변 모델의 순서에 Gemini를 맨 앞에 둔 것.
    public static let displayOrder = ["gemini", "openai", "openai-luna", "claude-sonnet", "claude-opus", "claude-haiku"]

    /// 화면 이름은 모델 이름이다(고유 명칭이라 번역하지 않는다). ⚠ 서버 모델 상수가 바뀌면 이 이름도 함께 고친다(이름 가드 테스트).
    public static func displayName(_ id: String) -> String? {
        switch id {
        case "gemini": "Gemini 3.6 Flash"
        case "openai": "GPT-6.1 Terra"
        case "openai-luna": "GPT-6 Luna"
        case "claude-sonnet": "Claude Sonnet"
        case "claude-opus": "Claude Opus"
        case "claude-haiku": "Claude Haiku"
        default: nil
        }
    }

    /// 서버 목록(Gemini 제외)에서 화면 선택지를 만든다. 서버 목록이 비면 빈 배열이다: 고를 수 있는 다른 모델이 없으니 줄을 숨긴다.
    /// 앱이 모르는 이름은 건너뛴다.
    public static func choices(server: [String]) -> [String] {
        let others = displayOrder.dropFirst().filter { server.contains($0) }
        return others.isEmpty ? [] : [defaultID] + others
    }

    /// 실제로 쓸 선택지: 저장한 값이 열려 있으면 그것, 아니면 목록 맨 앞(처음 값). 열린 것이 없으면 nil.
    public static func effective(stored: String?, choices: [String]) -> String? {
        if let stored, choices.contains(stored) { return stored }
        return choices.first
    }

    /// 요청 본문에 실을 값. 처음 값·없음·모르는 값이면 nil(필드를 보내지 않는다).
    public static func requestValue(_ id: String?) -> String? {
        guard let id, id != defaultID, displayOrder.contains(id) else { return nil }
        return id
    }
}

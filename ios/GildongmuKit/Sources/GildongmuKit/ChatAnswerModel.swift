import Foundation

// 채팅 답변 모델 선택(E89 spec `2026-11-23-e89-chat-model-choice-design.md` §3·§4, 3.0 정식판 E92 spec
// `2026-11-27-e92-release-3.0-design.md` §2) — 앱 쪽 선택지 판정.
//
// 서버 계약: `POST /api/chat` 본문의 선택 필드 `chatModel`과 `GET /api/chat/models`. Terra는 `openai`를 보내고
// Gemini는 필드를 보내지 않는다(서버의 값 없음 = Gemini는 2.8 이하 앱을 위한 것이라 그대로다, E92 A1).

/// 설정 「채팅 답변 모델」의 저장 키와 순서.
public enum ChatAnswerModel {
    public static let storageKey = "chatAnswerModel"
    /// 처음 값(E92 A2). 저장값이 없거나 열리지 않은 값이면 이것을 쓴다.
    public static let defaultID = "openai"
    /// 필드를 보내지 않는 선택지(서버의 값 없음 = Gemini).
    public static let geminiID = "gemini"

    /// 정식판 선택지(E92 A3): Terra·Gemini 둘.
    public static let releaseOrder = ["openai", "gemini"]
    /// 실험판 선택지의 화면 순서(E92 ⓔ): 정식판 둘 뒤에 나들이 답변 모델의 순서를 잇는다.
    public static let displayOrder = ["openai", "gemini", "openai-luna", "claude-sonnet", "claude-opus", "claude-haiku"]

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

    /// 서버 목록(Gemini 제외)에서 화면 선택지를 만든다. `extended`는 실험판 여섯 선택지다.
    /// 서버가 고를 다른 모델을 열지 않으면 빈 배열이다: 줄을 숨기고 Gemini로 간다. 정식판은 `openai`가 열려야 줄이 선다.
    /// 앱이 모르는 이름은 건너뛴다.
    public static func choices(server: [String], extended: Bool) -> [String] {
        let open = (extended ? displayOrder : releaseOrder).filter { $0 == geminiID || server.contains($0) }
        return open == [geminiID] ? [] : open
    }

    /// 실제로 쓸 선택지: 저장한 값이 열려 있으면 그것, 아니면 목록 맨 앞(Terra가 열렸으면 Terra, 아니면 Gemini). 열린 것이 없으면 nil.
    public static func effective(stored: String?, choices: [String]) -> String? {
        if let stored, choices.contains(stored) { return stored }
        return choices.first
    }

    /// 요청 본문에 실을 값. `choices`가 nil이면 서버 목록 조회가 실패한 것이다(E89 규칙: 저장값 그대로, 없으면 처음 값).
    /// 빈 선택지(서버가 다른 모델을 열지 않음)·Gemini·그 판에서 고를 수 없는 값이면 nil(필드를 보내지 않는다 = Gemini).
    public static func requestValue(stored: String?, choices: [String]?, extended: Bool) -> String? {
        let allowed = extended ? displayOrder : releaseOrder
        let id: String?
        if let choices {
            id = effective(stored: stored, choices: choices)
        } else if let stored, allowed.contains(stored) {
            id = stored
        } else {
            id = defaultID
        }
        guard let id, id != geminiID, allowed.contains(id) else { return nil }
        return id
    }
}

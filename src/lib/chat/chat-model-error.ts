/**
 * Gemini 밖 채팅 모델 경로(E89)의 공용 타입. React/Next 비의존.
 */

/** 클라이언트가 보낸 대화 한 턴(`/api/chat` 본문 `messages`의 모양). */
export interface ChatHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * 다른 회사 모델 호출의 실패. 로그에는 `kind`와 `status`만 싣는다(질문 글·답 글·오류 본문은 싣지 않는다, spec C12).
 * `kind`는 코드가 정한 고정 낱말이다(회사가 준 값을 그대로 넣지 않는다).
 */
export class ChatModelError extends Error {
  constructor(
    readonly kind: string,
    readonly status: number | null = null,
  ) {
    super(status === null ? kind : `${kind} ${status}`);
    this.name = "ChatModelError";
  }
}

# E89 실험판 「채팅 답변 모델」 구현 계획

spec: `docs/superpowers/specs/2026-11-23-e89-chat-model-choice-design.md`. 기준 SHA `1672775b`.

위임 판단: 서버 층(과제 1~4)은 루프·봉인 설계가 얽혀 주 세션이 직접 한다. iOS(과제 5)는 서버 계약(`chatModel` 필드 다섯 값, `GET /api/chat/models` → `{models}`)이 spec에서 고정되고 파일이 겹치지 않아 sonnet·medium 서브에이전트에 맡긴다. 이름 가드(과제 6)는 두 쪽이 끝난 뒤 주 세션.

## 과제

1. `src/lib/chat/chat-models.ts`: 식별자 다섯·모델 상수·회사별 설정·`availableChatModels()`·`parseChatModel(raw)`·하루 상한(`createChatModelBudget`)·`createChatModelSession()`. 테스트 `chat-models.test.ts`.
2. `src/lib/chat/model-loop.ts`(`ChatModelSession` 계약 + `runChatModelLoop`), `openai-chat.ts`, `claude-chat.ts`(도구 변환 포함). 테스트: 가짜 세션 루프, 가짜 fetch·가짜 SDK 요청 모양과 실패 갈래.
3. `/api/chat` 라우트 분기(C2·C3·C4·C9·C10·C12) + `GET /api/chat/models`. 테스트: byte-identical, 502·503, 실패 응답, 목록 끝점.
4. 봉인 소스 가드 `chat-model-seal.test.ts`.
5. iOS: 플래그, Kit `ChatAnswerModel`·`ChatRequestBody.chatModel`·`ChatService.models()`, 설정 줄, `ChatModel` 요청, i18n 여섯 로케일 + 카탈로그 재생성, Kit 테스트, 설정 묶음표 가드.
6. 이름 가드 `chat-model-names.test.ts`.
7. 게이트(`test:run`·`lint`·`build`, Kit 테스트, 실험판·정식판 빌드) → 실호출 게이트 → 리뷰(fable·high 전송 경로·봉인·비용, opus·high 접근성) → 반영 → 통합 → 운영 확인 → 실기기 → 문서 분배.

# E89 실험판 「채팅 답변 모델」 선택 설계

작성 2026-11-23, 세션 `e89-chat-model`. 기준 SHA `1672775b`. 원천: BACKLOG E89 「위원장 판정(2026-11-23)」, E86 리포트 `docs/evals/2026-11-14-claude-chat-models.md`·`2026-11-15-e86-chat-openai-haiku-3.8.md`, 베르길리우스 spec `2026-11-14-e82-vergilius-v1-design.md`.

설계 리뷰 판별(글로벌 「설계 리뷰 판별 기준」): 여러 파일에 걸친 설계 변경이고 채팅 질문이 새 회사로 가는 전송 경로가 생긴다. 구현 뒤 리뷰어를 붙인다(전송 경로·봉인·비용 상한 1회, 접근성 1회).

## 1. 확정 판정(다시 묻지 않음)

1. iOS 실험판 설정에 「채팅 답변 모델」 줄을 「나들이 답변 모델」 줄과 따로 둔다.
2. 선택지: Gemini 3.6 Flash(처음 값), GPT-6.1 Terra, GPT-6 Luna, Claude Opus, Claude Sonnet, Claude Haiku. 키가 없는 회사는 선택지에 서지 않는다.
3. 정식판에는 넣지 않는다.

## 2. 결정

| # | 결정 | 근거 |
|---|---|---|
| C1 | 요청 본문에 선택 필드 `chatModel`(문자열)을 더한다. 알려진 값은 다섯: `openai`(GPT-6.1 Terra), `openai-luna`(GPT-6 Luna), `claude-opus`, `claude-sonnet`, `claude-haiku`. 베르길리우스 식별자와 철자를 맞춘다(앱 이름 표·저장값 관례 공유). Gemini는 값이 없다 | 「값 없음 = 종전」이 봉인의 1선이 되려면 처음 값이 필드 자체의 부재여야 한다 |
| C2 | 필드가 없거나, 문자열이 아니거나, 다섯 밖의 값(`gemini`·`google`·오타)이면 **종전 Gemini 경로 그대로**다(코드도 같은 줄을 지난다). 응답은 byte-identical이고 테스트가 고정한다 | 착수 지시. 모르는 값이 실패가 되면 정식판·웹·CLI의 우연한 필드가 장애가 된다 |
| C3 | 알려진 값인데 그 회사 키가 없으면 502 `{"error":"chat_model_unavailable"}`(스트림 전). Gemini로 돌리지 않는다 | 3-state: 위원장이 고른 모델이 답하지 못했으면 드러낸다. 베르길리우스 `provider_unavailable`과 같은 모양 |
| C4 | 다른 회사 경로의 모든 실패(402 잔액 소진, 429, 5xx, 시한, `status` 비완료·거절, Claude 비정상 `stop_reason`)는 종전 실패 응답 `{"type":"error","code":"chat_failed"}`이다. 서버 측 `fallbacks`(거절 시 다른 모델로 다시 돌리기)는 쓰지 않는다 | 기존 클라이언트가 이미 읽는 실패 갈래 하나. 다른 모델이 몰래 대신 답하면 견주기 목적이 무너진다 |
| C5 | Gemini 경로(`runAgentLoop`)는 손대지 않는다. 다른 회사는 새 층이 받는다: 회사별 세션(`ChatModelSession`: 회차 하나 돌리기, 도구 결과 붙이기)과 회사 중립 루프 `runChatModelLoop`(도구 병렬 `allSettled`, 실패는 `{error}`로 모델에 전달, 상한 6회, 답이 비면 도구를 닫고 1회 더). 모양은 `runAgentLoop`의 거울이고 E86 하네스 러너(`src/__ab__/openai-runner.ts`·`claude-runner.ts`)에서 계측을 뺀 것이다 | 경계 인터페이스 여섯 모듈 불변(평가 하네스가 같은 시간에 쓴다). 하네스가 잰 루프와 같은 모양이라야 E86 측정이 실사용 비교의 근거로 이어진다 |
| C6 | 모델별 설정은 E86 측정값을 따른다: Terra 추론 끔(`effort: none`), Luna 추론 낮음(`low`), Opus effort `low`(생각 생략), Sonnet effort `low` + `thinking: between_tools`, Haiku effort `low`(생각 생략) | E86 11-15 리포트: Terra 끔이 권고 1순위, Luna는 낮음이 안전 8/9로 끔(7/9)보다 낫다. Claude 셋은 11-14·11-15 측정의 「낮음」 팔. 모델 id는 2026-11-23 모델 목록 API로 확인(`gpt-6.1-terra`·`gpt-6-luna`·`claude-opus-5-5`·`claude-sonnet-5-5`·`claude-haiku-5-5`), 파라미터는 claude-api 스킬(2026-11-23 판)과 베르길리우스 어댑터의 검증된 요청 모양 |
| C7 | OpenAI는 Responses API를 `fetch`로 비스트리밍 호출(`store:false`, 응답 항목 append-only, 추론 켠 Luna는 `include: reasoning.encrypted_content`, 함수 도구 `strict:false`). Claude는 SDK `messages.stream().finalMessage()`(system 끝 캐시 지점 + 최상위 자동 캐시, 도구 선택 `auto`/`none`, 실패한 도구 결과는 `is_error`) | 하네스와 같은 전송. 채팅은 답을 완료 시점에 한 번 보내므로 회차 스트리밍이 필요 없고, Claude만 큰 `max_tokens`에 SDK가 스트리밍을 요구한다 |
| C8 | 도구 선언은 `availableDeclarations`의 `parametersJsonSchema`를 깊은 복사해 그대로 옮긴다(`parameters` Type 스키마가 있으면 throw). 지침은 `buildChatSystemInstruction` 정본 그대로 | 모델 외 변수가 섞이지 않게(하네스와 같다) |
| C9 | 시한: 요청 전체 100초(`maxDuration` 120 안), 회차 45초. 요청 취소(앱이 끊음)도 같은 신호로 모델 호출에 닿는다. Claude SDK 재시도 1회 | 120초를 넘으면 Vercel이 끊어 실패 문장도 못 보낸다 |
| C10 | 비용 방어: 기존 IP 60초 10회(채팅 공용)는 그대로 앞에 서고, 다른 회사 경로에만 **인스턴스 하루 상한 150건**(KST 자정 리셋, 다섯 모델 합산)을 더한다. 넘으면 503 `{"error":"daily_budget_exhausted"}`. 칸은 모델을 부르기 직전에만 쓴다(검증·키 게이트에서 떨어진 요청은 세지 않는다) | 베르길리우스와 같은 틀. 최악 Opus 질문당 약 2.3센트 × 150 = 인스턴스당 하루 약 3.5달러. 실사용자는 위원장 한 명이라 상한에 닿을 일은 악용뿐이다. ⚠ 인스턴스별 한계는 `rate-limit.ts` 머리 주석 그대로 |
| C11 | 고를 수 있는 모델 목록 끝점 `GET /api/chat/models` → `{"models":[...]}`(키 있는 다섯 가운데, 고정 순서, `connection()` + `no-store`). Gemini는 목록에 없다(언제나 처음 값) | 베르길리우스 `/api/vergilius/providers`와 같은 게이트 패턴. 빌드 때 굽히지 않게 `connection()` |
| C12 | 로그: 다른 회사 경로의 오류는 종류와 상태 코드만(`[chat] <회사> 오류: <종류> <상태>`). 질문 글·답 글·도구 결과는 쓰지 않는다 | 베르길리우스 V34. Gemini 경로의 기존 로그는 손대지 않는다(C5) |
| C13 | 추천 질문(`/api/chat/suggestions`)은 범위 밖, Gemini 그대로 | 착수 지시 |
| C14 | 대화 이력 변환: 클라이언트 `messages`의 역할은 `assistant`가 아니면 `user`로 접고(Gemini 경로와 같다), 오래된 턴부터 덜어 글자 합 24,000자 안에 둔다(마지막 턴은 잘라서라도 남긴다, `boundChatHistory`. 하루 상한은 건수만 세므로 건당 입력을 묶는다, 리뷰 반영 2026-11-23). 빈 글은 뺀다(Claude는 빈 글을 400으로 받는다). Claude는 첫 메시지가 user여야 하므로 앞머리의 assistant 글만 뺀다 | 현재 웹·iOS는 user로 시작한다(방어선) |

## 3. 정식판 봉인

push하면 운영에 자동 배포되므로 봉인을 구조와 테스트로 먼저 세운다.

- **1선 구조**:
  - 서버: `chatModel`을 읽는 곳은 `/api/chat` 라우트 한 곳이고, 알려진 다섯 값이 아니면 분기 자체가 없다(C2). Gemini 분기는 종전 코드 줄 그대로다.
  - 웹·CLI·MCP: 요청을 만드는 코드에 이 필드가 없다(웹 `useChat`, `packages/**`).
  - iOS: Kit `ChatRequestBody.chatModel`은 선택값이고 nil이면 JSON에서 키가 빠진다(합성 `Encodable`의 `encodeIfPresent`). 값을 채우는 자리는 `ChatModel` 한 곳이며 `#if DEBUG || EXPERIMENTAL` 안이고 `AppConfig.experimentalChatModelEnabled`(새 플래그, `#if EXPERIMENTAL`)를 거친다. 정식판(Release) 바이너리에는 그 줄이 컴파일되지 않는다.
- **2선 소스 가드**(`src/lib/chat/__tests__/chat-model-seal.test.ts`): ①`chatModel` 글자가 서버 소스에서 허용 파일(라우트, `src/lib/chat/chat-models.ts`, 테스트) 밖에 없다 ②웹 훅·컴포넌트·`packages/`에 없다 ③iOS 앱 타깃에서 `chatModel:` 인자를 채우는 줄은 `ChatModel.swift`에만 있고 `#if DEBUG || EXPERIMENTAL` 블록 안이다 ④추천 질문 라우트는 `chatModel`을 읽지 않는다.
- **byte-identical 테스트**(`src/app/api/chat/__tests__/chat-model-route.test.ts`): Gemini 클라이언트와 실행부를 가짜로 두고, 필드 없음·`"gemini"`·`"google"`·`123`·`null`·`"OPENAI"`로 보낸 요청이 같은 `generateContent` 인자와 같은 응답 바이트를 낸다.
- iOS Kit 테스트: `chatModel` nil 인코딩에 키가 없다.

공개 서버라 「실험판만 받는 서버」는 만들 수 없다(누구나 필드를 실어 보낼 수 있다). 그래서 봉인은 「정식판·웹이 보내지 않는다」이고, 공개 끝점의 남용은 C10이 막는다(베르길리우스와 같은 판단, E82 spec §4).

## 4. iOS

- 새 플래그 `AppConfig.experimentalChatModelEnabled`(`#if EXPERIMENTAL`). 나들이 플래그에 얹지 않는다(졸업 시점이 다르다, `ios-build.md`).
- Kit `ChatAnswerModel`(`ChatService.swift` 옆 새 파일 `ChatAnswerModel.swift`): 저장 키 `chatAnswerModel`, 처음 값 `gemini`, 화면 순서 `gemini` → `openai` → `openai-luna` → `claude-sonnet` → `claude-opus` → `claude-haiku`(나들이 답변 모델의 화면 순서에 Gemini를 맨 앞에 둔 것: 위원장이 「같은 구성」이라 했으므로 순서도 맞춘다), 화면 이름(모델 이름, 번역하지 않음: Gemini 3.6 Flash, GPT-6.1 Terra, GPT-6 Luna, Claude Sonnet, Claude Opus, Claude Haiku), `choices(server:)`, `effective(stored:choices:)`, `requestValue(_:)`(`gemini`이면 nil). `ChatService.models()`가 `/api/chat/models`를 읽는다.
- 설정: AI 묶음에서 동의 토글 다음, 「나들이 답변 모델」 앞에 `Picker` 메뉴 한 줄(`ios.settings.chatModel`). 컨트롤 종류·`.id(…AppLanguage.current)`는 나들이 줄과 같다. 서버 목록 조회 전·실패면 줄이 없다(고를 수 없는 이름을 보이지 않는다). 키 있는 다른 회사가 하나도 없으면 줄이 없다(Gemini 하나뿐인 선택지).
- 요청: `ChatModel`이 보내기 전에 선택을 푼다(나들이 `OutingModel.resolveProvider`와 같은 규칙: 선택지 조회 3초, 실패하면 저장값 그대로. 저장값이 닫힌 회사면 서버 502가 실패 문장으로 드러난다). 장소 채팅에도 같은 선택을 싣는다(채팅 답변 모델은 채팅 전체의 설정이다).
- 실패 표시는 기존 채팅 실패 갈래 그대로(새 문장 없음).
- 다국어: `ios.settings.chatModel` 여섯 로케일(ko 「채팅 답변 모델」, 나머지는 「나들이 답변 모델」과 같은 틀: en `Chat answer model`, ja `チャットの回答モデル`, fr `Modèle de réponse du chat`, it `Modello di risposta della chat`, es `Modelo de respuesta del chat`).
- 이름 가드: Kit 화면 이름이 서버 모델 상수와 같은 모델인지 테스트(`vergilius-model-names.test.ts`와 같은 방식, 새 파일).

## 5. 개인정보 3자 일치(BACKLOG E89 ⓔ)

| 자리 | 지금 | 이번 변경 뒤 | 판정 |
|---|---|---|---|
| 웹 `/{locale}/privacy` 채팅 문장 | 채팅 질문은 Google Gemini(+Perplexity) | 실험판에서 다른 모델을 고르면 OpenAI·Anthropic으로도 간다 | **문안 변경 필요**. E82 V34 선례(실험판 기능도 방침에 적었다)를 따르면 채팅 문장에 두 회사를 더한다. 문안 시안은 judgment 파일, 위원장 확정 전에는 운영에 내지 않는다 |
| iOS 동의 문구 `ios.chat.consentData` | Google Gemini | 정식판은 그대로 참. 실험판에서만 달라진다 | 시안을 judgment에 함께 낸다(실험판 전용 문장으로 갈라 쓰는 안과 공용 문장 하나를 고치는 안) |
| `PrivacyInfo.xcprivacy` | 위치·사용자 콘텐츠 수집 항목이 이미 있다 | 수집 항목 종류가 바뀌지 않는다(받는 회사는 이 파일의 대상이 아니다) | 변경 없음(E82 V34와 같다) |
| ASC 영양 라벨 | 위치·사용자 콘텐츠, 앱 기능 목적 | 종류·목적 같음, 정식판 동작 같음 | 변경 없음 |

기본값: 문구는 그대로 두고 judgment를 낸다. 실험판에서 처음 값은 Gemini라 위원장이 설정에서 다른 모델을 직접 고르기 전에는 채팅 질문이 다른 회사로 가지 않는다.

## 6. 비목표

- 정식판 노출, 웹 UI, CLI·MCP 옵션.
- 운영 채팅 모델 전환(E86 판정 뒤 별도 일. 전환되면 이 층을 쓴다).
- 다른 회사 경로의 스트리밍 진행 표시 차이(도구 상태 이벤트 `status`는 같은 모양으로 낸다).

## 7. 검증

- 단위: 회사 중립 루프(가짜 세션으로 도구 왕복·실패 흡수·I-2·상한), OpenAI·Claude 세션(가짜 fetch·가짜 SDK로 요청 모양, 실패 갈래), 모델 목록 게이트, 하루 상한, 라우트 갈래(502·503·실패 응답·byte-identical), 봉인 소스 가드, 이름 가드. Kit: `ChatAnswerModel` 순서·실효값·요청값, 인코딩.
- 실호출 게이트(머지 조건): 로컬 dev 서버 `/api/chat`에 회사별(Terra·Luna·Opus·Sonnet·Haiku) 도구가 끼는 질문 하나씩, `done` 텍스트와 도구 왕복(`status` 이벤트) 확인. 합계 1달러 안.
- 운영: push 직후 선택 값 없는 요청으로 `type: done` 확인, `/api/chat/models` 응답 확인.
- iOS: Kit 테스트, 실험판·정식판 구성 빌드, 실험판 실기기 설치.

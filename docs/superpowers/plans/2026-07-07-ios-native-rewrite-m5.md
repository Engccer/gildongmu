# 길동무 iOS M5 구현 계획: 장소 채팅 (NDJSON 스트리밍)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장소 상세에서 "이 장소에 관해 물어보기" sheet 채팅. 서버 에이전트 루프(`/api/chat`)를 NDJSON으로 소비한다.

## Global Constraints (M0~M4 유지 + 추가)

- **장소 앵커 불변식**(웹 계약): `placeContext`는 장소, `userLocation`은 실위치(있으면). 길찾기 출발지는 실위치.
- **장소마다 새 대화**(웹 계약). 진입은 장소 상세 버튼 → `.sheet`.
- **답변 산문은 보이는 말풍선 한 곳에만**(live region 복제 금지). 진행 통지는 status 이벤트당 1회 polite, 완료는 포커스 이동+햅틱(웹 효과음+포커스의 iOS 문법).
- **미지 이벤트 type은 무시**(전방 호환), 빈 done.text는 오류 아님("답변을 준비하지 못했습니다" 폴백 문장, 웹 1회 폴백 미러).

## API 계약 (fixture chat-stream.ndjson 커밋, prod 실캡처)

- `POST /api/chat` JSON body: `{messages:[{role:"user"|"assistant", text}], userLocation?:{lat,lng}, locale:"ko", placeContext?:{name,lat,lng,category?,isStation?}}`
- 응답: NDJSON 1줄 1이벤트. `{type:"status", categories:[String]}`(누적 도구 카테고리) / `{type:"done", text, renders:[...], sources:[{label, url?}]}` / `{type:"error", code}`
- 키 없음·오류: HTTP 502 `{error:"chat_unavailable"}` 등. `maxDuration=120`이므로 클라이언트 타임아웃 여유(180초).

## 렌더 정책 (V1 의도적 축소, PROGRESS 기록 예정)

- done.renders 중 **props-driven 3종만 표시**: `places`(PlaceRow 재사용 리스트)·`addresses`·`web-results`. **self-fetch 파라미터 카드류(air-quality·subway-nearby 등)는 V1 미탑재**: 산문이 정본(웹 원칙)이고 동일 정보의 전용 화면이 이미 앱에 존재. 미지 render type은 무시.
- sources는 답변 하단 "출처" 행들: url 있으면 Link, 없으면 Text. label은 i18n 키지만 V1 ko는 서버가 주는 label 그대로 표시(M8 i18n에서 정리).

### Task 1 (Kit): ChatModels + NDJSON 스트림 + ChatService

- `Models/ChatModels.swift`: `ChatStreamEvent` enum(custom Decodable: "type" 판별, status/done/error, **미지 type은 `.unknown`**), `ChatRenderPayload` enum(places/addresses/webResults만 associated value로 디코딩, 그 외 `.unsupported`; 내부 배열은 기존 Place·JusoAddress·WebSearchResult 재사용), `ChatSource{label, url?}`, `ChatRequestBody`(Encodable: messages·userLocation·locale·placeContext).
- `ChatService.swift`: `func stream(_ body: ChatRequestBody, baseURL: URL) -> AsyncThrowingStream<ChatStreamEvent, Error>`. 구현: URLRequest POST + `URLSession.bytes(for:)` → `bytes.lines` 순회 → 줄별 JSONDecoder. HTTP 비2xx면 APIError.badStatus throw. request timeoutInterval 180.
- 테스트: fixture chat-stream.ndjson을 줄 단위 디코딩(status categories 비어있지 않음, done text 비어있지 않음·renders에 unsupported 포함·sources 파싱), 미지 type 라인 `{"type":"future-x"}` → .unknown, error 라인 디코딩. (스트림 자체는 URLProtocol 목이 번거로우므로 **줄 디코더를 순수 함수 `decodeChatEventLine(_:)`로 분리해 단위 테스트**, 스트림 배관은 실기기 실호출 게이트.)

### Task 2 (앱): ChatView sheet + 상세 진입

- `Chat/ChatView.swift` 신규: `ChatModel`(@Observable) + `ChatView(place:)`.
- `ChatModel`: `messages: [ChatMessage]`(로컬 struct: id·role·text·renders·sources), `progress: String?`(status), `isStreaming`. `send(text:)`: in-flight 가드, 사용자 말풍선 추가 → ChatService.stream 소비 → status마다 통지(카테고리를 "정보 확인 중"과 함께), done에서 assistant 메시지 추가 + 햅틱(`UINotificationFeedbackGenerator` 또는 CoreHaptics 간단) + `@AccessibilityFocusState`로 새 답변 말풍선 포커스. error/throw → assistant 자리에 "답변을 가져오지 못했습니다" + 재시도 안내. Task 취소 관리(SearchModel 패턴), sheet dismiss 시 취소.
- `ChatView`: `NavigationStack` 안 `ScrollView`+`LazyVStack` 말풍선(사용자/어시스턴트 구분은 정렬+배경, 접근성은 각 말풍선 `accessibilityElement(children:.combine)` + 어시스턴트만 "답변" 라벨 접두 금지: 순수 텍스트), 어시스턴트 텍스트는 `Text(AttributedString(markdown:))`(파싱 실패 시 평문 폴백; ⚠ 리스트·헤딩 표현력 한계는 실기기 게이트에서 판정, 부족 시 후속 논의). renders 정책대로 places 리스트(PlaceRow 재사용, 커스텀 액션 포함)·addresses·web-results 간단 렌더. sources는 "출처" 헤더 없이 말풍선 아래 Link/Text 행들. 하단 입력: TextField+전송 Button(전송 중 aria-disabled 대신 핸들러 가드, 필드는 readOnly 아닌 유지). `.sheet` presentationDetents([.large]).
- `PlaceDetailView`: 정보 Section에 Button("이 장소에 관해 물어보기") → `.sheet(isPresented:)` ChatView(place:). userLocation은 LocationService.lastCoordinate(요청하지 않음: 채팅 진입이 위치 요청 트리거가 아님, 없으면 nil 전달).

### Task 3 (통합, 오케스트레이터): 빌드·테스트·커밋·push. 실기기 게이트(기기 연결 시): 상세→물어보기→질문→진행 통지→답변 포커스 이동·마크다운 낭독·출처, 연속 질문, dismiss 후 재진입 시 새 대화.

## Self-Review: 로드맵 M5 항목(NDJSON·sheet·마크다운·카드·출처·장소 앵커) 매핑 완료, 카드 축소는 의도 결정으로 명시. 시그니처 Task 1↔2 일치(ChatRequestBody·ChatStreamEvent·decodeChatEventLine).

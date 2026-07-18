# iOS 채팅 탭 (일반 채팅) 설계

- 날짜: 2026-07-18
- 상태: 승인됨 (위원장 설계 승인)
- 배경: 웹앱에서는 미니멀 원칙으로 메인 채팅 진입을 폐기했으나(검색⇄채팅 모드 토글 제거), iOS 앱에서는 채팅 UI의 편의성을 살려 **첫 번째 탭**으로 일반 채팅을 도입한다. 접근성·음성 입력 패턴은 dodo-planet iOS에서 검증된 계약을 참조하되, 구현은 gildongmu에 이미 있는 장소 채팅(sheet) 자산을 일반화한다(접근안 A).

## 확정 결정

| 결정 | 내용 |
|---|---|
| 탭 구성 | 3탭: **채팅 · 검색 · 내 주변** (채팅이 첫 탭, 검색 유지) |
| 빈 화면 | 고정 추천 질문 3~4개 버튼 (정적, 서버 호출 없음) |
| 위치 정책 | 일반 채팅은 **첫 전송 시점**에 `currentCoordinate()` 1회 시도 (실패 허용) |
| 리셋 의미론 | 세션 리셋(유휴 복귀·제목 탭) 시 대화도 증발, 채팅 탭으로 복귀 |
| 구현 접근 | 기존 `ChatModel`/`ChatView` 일반화 (dodo 코드 직접 이식 안 함) |

## 1. 탭 구조 (`GildongmuApp.swift`)

- `AppTab`에 `.chat` 추가. 탭 순서: 채팅 → 검색 → 내 주변.
- `selectedTab` 초기값과 `resetSession()` 복귀 탭을 `.chat`으로 변경.
- 단축어 라우팅 불변: `voiceSearch`는 `.search`(마이크 시작 플래그 포함), `nearby`는 `.nearby`. 인텐트 진입 시 epoch 재생성 규칙 그대로.
- 탭 아이콘은 SF Symbol(장식): 시스템이 탭 라벨을 낭독한다.
- 채팅 탭 콘텐츠(`ChatTabView`)의 `@State` 모델은 탭 전환 간 유지되고, `sessionEpoch` 증가 시 TabView `.id` 재생성으로 함께 증발한다(일회성 대화 계약, 별도 저장소 없음).

## 2. 공용 대화 뷰 추출: `ChatConversationView` (유일한 리팩터)

기존 `ios/Gildongmu/Chat/ChatView.swift`의 대화 UI 전체를 공용 컴포넌트로 추출한다.

- **추출 대상**: 메시지 스크롤 리스트(`ScrollViewReader` + 답변 포커스 이동), 진행 표시 행, `MessageBubbleView`(산문+렌더 카드 3종+출처), 입력바(텍스트 필드·마이크·보내기), 음성 알럿.
- **소비자 2곳**:
  - 장소 채팅 sheet(기존 `ChatView`): `NavigationStack` + 장소명 타이틀 + 닫기 툴바 래퍼. 기존 동작 불변이 목표.
  - 채팅 탭(신규 `ChatTabView`): `NavigationStack` + 타이틀 + 빈 화면 추천 질문.
- 중복 UI 0. 말풍선·입력바 수정이 양쪽에 동시 반영된다.

## 3. `ChatModel` 일반화

- `place: Place`를 `place: Place?`로. `nil`이면 `requestBody()`가 `placeContext`를 포함하지 않는다(웹 계약 "placeContext 없으면 동작 byte-identical" 재사용, 서버 변경 0).
- **위치 정책 분기**:
  - 일반 채팅(`place == nil`): `send()`가 스트림 시작 전에 `try? await LocationService.shared.currentCoordinate()` 1회 시도. 최초 전송에서만 권한 팝업이 뜨고(캐시 있으면 즉시 반환), 거부·실패 시 `userLocation` 없이 전송을 계속한다("앱 시작 즉시 금지, 기능 최초 사용 시점" 규칙 준수: 채팅 탭 진입만으로는 요청하지 않는다).
  - 장소 채팅(`place != nil`): 기존 계약 유지. `lastCoordinate` 재사용만, 위치 요청 트리거 아님.
- 위치 취득 대기 중에도 `isStreaming` in-flight 가드로 재진입 차단(전송 시작 시점에 세움). `disabled` 금지·핸들러 가드 원칙 그대로.

## 4. 빈 화면: 고정 추천 질문

- 메시지 0개일 때만 표시. 정적 문자열 3~4개, 세로 배열 버튼(`.bordered`, `minHeight: 44`), 탭하면 그 문장을 즉시 전송.
- 후보(구현 시 확정, 채팅 15개 도구가 실제 답할 수 있는 것만): 둘러보기("주변에 뭐가 있는지 알려줘"), 지하철 도착, 공기질, 소아 야간진료 계열.
- 별도 헤더·안내 문구 없음(자명한 중복 안내 금지, 미니멀). 각 버튼은 독립 접근성 객체(정상).
- 첫 전송 후 리스트는 사라지고 다시 나타나지 않는다(세션 리셋으로 대화가 증발하면 다시 표시).

## 5. 접근성 (gildongmu 기확립 계약 유지)

- **포커스 계약(헌장 §6 2026-07-19 개정, dodo R184 실기기 판정 역이식)**: 전송 시(`questionRevision` 신호) 항상 존재하는 **보내기 버튼**으로 선점 이동해 생성 내내 유지하고(포커스를 쥔 추천 질문 버튼이 전송으로 제거되며 VO가 최상단 리셋되는 이탈 차단, 타이핑 전송은 무이동), 완료 시(`answerRevision` 신호)에만 햅틱과 함께 **마지막 질문 헤딩**으로 이동한다(질문에 앉으면 다음 스와이프가 자연히 답변 첫 블록).
  - ⚠ 구계약(전송 즉시 질문 헤딩 선점 + 완료 재확정)은 폐기: dodo R184 실기기 로그로 결함 3종 확정 — ① 완료 재확정이 같은 값 재대입 no-op ② ScrollView가 화면 밖 요소를 AX 트리에서 컬링해 포커스 대입이 조용히 실패(바인딩 nil 리셋) ③ 응답 append 하단 스크롤이 질문 상단 scrollTo를 덮는 경합.
  - 완료 시퀀스(VO 실행 중에만): 질문 상단 `scrollTo`로 가시화 → 400ms 후 `isSendFocused` 해제+`focusedMessageID` 대입 → 600ms 후 바인딩 nil 리셋(실패 신호) 감지 시 재스크롤+1회 재시도. VO 실행 중엔 완료 스크롤 목적지도 하단이 아니라 질문 상단(경합 원천 제거). VO 미실행 시엔 기존 시각 동작(답변 하단 스크롤)이며 포커스 코드는 무동작.
  - 계측: DEBUG 빌드는 `ChatFocusDiag.swift`(dodo `LiveDiagFileLog` 이식)가 `UIAccessibility.elementFocusedNotification` 관찰자+완료 경로 단계 로그를 기기 파일(Documents/chat-focus-diag.log)에 남긴다. 실기기 실패 시 가설 패치 금지, 로그로 실착지 확정(회수: `xcrun devicectl device copy from --domain-type appDataContainer`).
- 진행 통지: status 이벤트당 `AccessibilityNotification.Announcement` 1회(단일 polite 채널의 iOS 문법).
- 음성 입력: **자체 온디바이스 `SpeechService`(iOS 26 SpeechAnalyzer, ko-KR 고정) 재사용**. dodo `DictationRecorder`(서버 STT)는 이식하지 않는다. 이미 sheet에서 검증됐고 서버 왕복·비용이 없다.
- `disabled` 금지(핸들러 가드+in-flight 가드), 터치 타깃 ≥44pt, 한 줄=한 접근성 객체, 산문은 말풍선 한 곳에만. 전부 기존 그대로.
- **질문 말풍선은 헤딩(trait만, 시각 불변)**: 긴 대화에서 로터 헤딩 탐색이 턴(질문) 단위 점프의 유일한 경로(위원장 실측 반영).
- **마이크 라벨은 "받아쓰기 시작/중지"**: "음성 입력"은 받아쓴 내용에 "음성"이 들어가면 SR 낭독에서 내용과 컨트롤 라벨이 구분 불가(위원장 실측). 컨트롤 라벨은 사용자 콘텐츠에 등장할 법한 일반명사를 피하고 행위구로. SearchView 동일 적용.

## 6. 디자인 정체성

gildongmu 기존 스타일 유지: 시스템 tint 말풍선(user는 `accentColor` 15%, assistant는 `secondarySystemBackground`), 시스템 타이포, 이모지 없는 라벨, `navigationTitle` 중심 미니멀 레이아웃. dodo 비주얼 요소(세그먼트 전환·이미지 첨부 버튼·라이브 채팅 버튼 등)는 가져오지 않는다.

## 7. 스코프 제외 (명시)

- 이미지 첨부 (gildongmu `/api/chat`에 이미지 계약 없음)
- 대화 히스토리 저장 (인증·저장소 없음, 일회성 대화 계약)
- 팔로업 칩 (`/api/chat/suggestions` 백엔드 없음)
- 라이브 음성 대화, TTS 자동 재생 (백엔드·설정 인프라 없음, 미니멀 원칙)
- 웹앱 변경 0, 서버 변경 0

## 8. 렌더링: 블록 분할 (실측 2회 반영)

두 실측이 설계를 확정했다:
- **prod 실호출**: 답변에 블록 마크다운(`###` 헤딩·`*` 리스트)이 오는데 인라인 전용 파서(`inlineOnlyPreservingWhitespace`)는 블록 문법을 해석하지 못해 기호가 리터럴 노출된다.
- **위원장 VoiceOver 실기기**: 산문 전체를 단일 `Text`로 렌더하면 접근성 객체 하나로 노출돼 단락·헤딩 구조 탐색이 불가능하다(질문도 답변도 통짜 낭독).

정본 해법: `parseChatMarkdownBlocks`(GildongmuKit, 순수 함수·단위 테스트)가 답변을 블록(헤딩 마커 제거·리스트 항목 `•` 완성형·단락)으로 파싱하고, 말풍선은 **블록마다 별도 `Text`(=별도 접근성 객체)**로 렌더한다. 헤딩 블록은 `.font(.headline)`+`.isHeader` trait(로터 헤딩 탐색), 인라인 강조는 블록 내부에서 AttributedString으로 해석, 완료 포커스는 §5대로 질문 헤딩이 받는다(답변 블록엔 포커스 바인딩 없음). 사용자 발화는 원문 평문 단일 Text(마크다운 재해석 금지). 웹 react-markdown 블록 노드의 iOS 문법. ⚠ dodo-planet 채팅도 동일 결함 보유(위원장 확인) — 이식 시 이 패턴 적용.

## 9. 테스트·검증

- **단위(GildongmuKit)**: `place == nil`일 때 `ChatRequestBody` 인코딩에서 `placeContext` 키가 생략되는지(서버 계약 보호). 기존 `ChatModelsTests` 레인에 추가.
- **게이트**: xcodebuild 빌드 + 기존 XCTest 전체 통과.
- **머지 게이트(실호출)**: 실기기 배포(`ios/deploy-device.sh`) 후 ① 일반 질문 실호출 ② "내 주변" 계열 질문에서 위치 팝업과 좌표 반영 확인 ③ VoiceOver로 추천 질문, 전송, 답변 포커스 흐름 확인 ④ 장소 sheet 채팅 회귀 없음.

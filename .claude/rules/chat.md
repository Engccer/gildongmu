---
paths:
  - "src/lib/chat/**"
  - "src/lib/gemini/**"
  - "src/components/chat/**"
  - "src/hooks/useChat*.ts"
  - "src/hooks/useFollowUpSuggestions.ts"
  - "src/hooks/useVoiceRecorder.ts"
  - "src/app/api/chat/**"
  - "src/__ab__/**"
  - "ios/Gildongmu/Chat/**"
  - "ios/Gildongmu/Speech*.swift"
  - "ios/Gildongmu/HoldDictationButton.swift"
  - "ios/Gildongmu/SearchView.swift"
  - "src/lib/markdown-plain-text.ts"
  - "ios/GildongmuKit/Sources/GildongmuKit/MarkdownPlainText.swift"
  - "android/kit/src/main/kotlin/**/MarkdownPlainText.kt"
  - "src/lib/nearby-place.ts"
  - "ios/GildongmuKit/Sources/GildongmuKit/PlaceProjection.swift"
  - "android/kit/src/main/kotlin/**/PlaceProjection.kt"
  - "ios/GildongmuKit/Sources/GildongmuKit/ChatMarkdown.swift"
  - "android/kit/src/main/kotlin/**/ChatMarkdown.kt"
  - "android/kit/src/main/kotlin/**/ChatService.kt"
  - "android/app/src/main/kotlin/**/chat/**"
  - "android/app/src/main/kotlin/**/speech/**"
  - "src/lib/place-open-request.ts"
  - "src/components/PlaceSearch.tsx"
  - "src/components/DirectionsView.tsx"
  - "src/components/ManualLocationPicker.tsx"
  - "ios/Gildongmu/Directions/DirectionsEndpointSearchView.swift"
  - "ios/GildongmuKit/Sources/GildongmuKit/VoiceQuery.swift"
  - "src/lib/format.ts"
---

# 채팅·받아쓰기 규칙

Claude Code는 위 `paths`에 맞는 파일을 읽을 때 이 파일을 자동으로 싣는다. 설계 단계(파일을 열기 전)이거나 다른 에이전트라면 이 영역 작업 전에 직접 읽는다. 항목 끝의 `→ INTEGRATIONS`·`→ PATTERNS`는 `docs/INTEGRATIONS.md`·`docs/PATTERNS.md`의 같은 제목 절이다. 어디서나 통하는 원칙은 루트 `CLAUDE.md`에 있다.

- **iOS 채팅·받아쓰기 계약은 헌장 §6이 정본이다.** 여기엔 이 repo의 구현 위치와 헌장에 없는 판정만 남긴다.
  - 산문 블록 분할 `parseChatMarkdownBlocks`(Kit) + 블록별 `Text`(헤딩 `.isHeader`), 질문 말풍선 헤딩 trait. 포커스 계약 구현·계측은 `ios/Gildongmu/Chat/ChatConversationView.swift`·`ChatFocusDiag.swift`.
  - 받아쓰기는 **탭 토글이 기본**(2026-07-29 위원장 결정 — 비-VO 심사자가 짧게 탭하면 홀드가 무반응으로 보여 App Store 반려됐다), 홀드는 설정 선택지이고 짧은 탭에 3초 가시 안내(`ios.voice.holdHintVisible`)를 병행한다. 구현 `HoldDictationButton.swift`.
  - ⚠ **제스처 계층은 UIKit 인식기(`HoldGestureCatcher`)가 정본** — SwiftUI LongPress+Drag 조합은 List 스크롤 팬 경합·VO pass-through 드래그 유실로 실기기 불합격했다(재도입 금지).
  - ⚠ **"녹음 시작 순간 VO 낭독 차단"은 `SpeechService.start()`의 책임이다**(홀드 버튼이 아니라). 홀드 없이 시작되는 경로엔 그 차단이 없어 녹음 중 라벨이 낭독된 회귀가 있었다.
  - **받아쓰기 엔진은 OS 버전이 정하고 둘 다 온디바이스다**(`SpeechEngine`: iOS 26+ `AnalyzerSpeechEngine`, 그 아래 `LegacySpeechEngine`+`requiresOnDeviceRecognition = true`, 이 한 줄이 개인정보 3자 일치의 근거). 상태 전이·취소 세대·VO 차단·통지는 `SpeechService`에 남긴다. → PATTERNS
  - 단축어 "음성 검색" 세션은 진입 시 VO 커서를 마이크 행에 선점한다(`SearchView.task`의 `micRowFocused`, `speech.start()` 전 + 완료 후 1회 재확정). 정지 수단이 그 행 탭인데 커서가 최상단이면 스와이프로 찾아가야 하기 때문이다.
  - 채팅 입력 필드의 지우기 버튼(`ios.chat.clear`)은 초안이 있을 때만 나타나고, 누르면 자신이 사라지므로 포커스를 입력 필드로 선점 이동한다.
  - **채팅 산문 블록은 언제나 한 접근성 객체이고, 장소 언급이 있으면 이름 링크 + 로터다**(E72: 언급 수와 무관, 블록 버튼 갈래 폐기). 새 nearby 도구에 렌더를 달면 `places` 투영(`nearby-place.ts` ↔ `PlaceProjection.swift`)도 싣는다. → PATTERNS

### 채팅 (Gemini function-calling)
- `src/lib/chat`·`src/lib/gemini`는 **React 비의존**(dodo 이식성). 진입은 장소 상세 오버레이와 홈 옴니박스 [AI에게 질문] 두 갈래(`ChatOverlay`), 검색⇄채팅 모드 토글은 폐기(되살리지 말 것). → PATTERNS
- **에이전트 루프**(`runAgentLoop`, maxIterations=6, `/api/chat` NDJSON 스트리밍): 도구는 `Promise.allSettled` 병렬이라 throw가 루프를 죽이지 않고, 카드는 done에서 1회 마운트한다(중복 낭독 차단). → PATTERNS
- **장소·주소 카드 탭=상세 진입**(`requestOpenPlace`): 카드 갈아타기는 `openSeq` 재마운트(새 `pushState` 금지). → PATTERNS
- **장소 앵커 불변식**: `placeContext`가 있으면 주변 도구는 `anchorOf(ctx)` 기준이되 **길찾기 출발지는 실제 `userLocation`**이다. 없으면 동작 byte-identical. → PATTERNS
- **⚠ 장소 특징 날조 금지**: 도구가 준 필드만 말한다(systemInstruction에 명시, [[agentic-llm-fabricates-unstated-fields]]). 도구 결과 `data`는 LLM에만(PII 누수 차단), 화면엔 카드+출처. → PATTERNS
- **마크다운 답변**: 헤딩은 강조 단락으로 다운그레이드하고, loose list는 `remarkTightLists`로 tight 강제한다(`<li><p>`가 VoiceOver 이중 낭독). → PATTERNS
- **답변 복사·듣기는 평문 한 벌과 통지 창구 하나를 쓴다**(웹 B12, `markdownToPlainText`는 Kit·`:kit`와 공유 fixture — `markdown-plain-text.ts`엔 JS 약칭 클래스·`m` 플래그 금지). → PATTERNS
- **여정 도구 `plan_journey`는 클라이언트가 능력을 신고한 요청에만 열린다**(`capabilities: ["journey"]` ∧ ko ∧ 키 셋 ∧ 장소 채팅 아님, 없으면 선언·실행·지침 0). 카드를 그리는 새 클라이언트는 신고와 카드를 함께 들이고, 여정 조회는 `queryJourney` 한 곳만 지난다(`getJourney` 직접 호출 금지). 노선을 말하지 않은 역은 노선으로 좁히지 않는다. → spec `2026-11-12-e70b-chat-journey-design.md`
- **채팅 도구는 25개(여정 도구 포함)이고 목록 정본은 코드다**(`declarations.ts`·`router.ts`). 지명→좌표는 `resolveCoord` 한 곳(실패는 `placeNotFound`, 현재 위치 폴백 금지), 지명·앵커 조회는 기기 위치 self-fetch 카드 금지(`placeMode`). → PATTERNS
- **모델 교체는 `npm run eval:ab`로 판정한다 — 벤더 벤치마크로 올리지 말 것**(날조 축은 `src/__ab__/grounding.ts` 자동 판정, pass^k 게이트). systemInstruction 정본은 `system-instruction.ts` 하나. 비용은 `candidatesTokenCount`+`thoughtsTokenCount`. → PATTERNS
- **iOS 채팅 AI 동의 게이트**(`ChatConsentView` + `ChatModel.send` 가드 이중 방어 — 새 전송 경로는 우회 여부 확인). → PATTERNS
- **음성 전사를 검색어로 쓰기 전 `normalizeVoiceQuery` 필수**(웹 `format.ts` ↔ Kit `VoiceQuery.swift`) — STT 후행 마침표에 juso가 0건이 된다. 소비 여부 판정은 별개 층 `hasSpeechContent`(Kit, `SpeechService.stop()` 한 곳). 채팅은 미적용. → INTEGRATIONS

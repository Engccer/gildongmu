# 웹 채팅 답변 복사·듣기 (B12) 설계

작성 2026-09-24. 출처: `docs/BACKLOG.md` B12(웹 설계 강한 디폴트, 2026-09-24 접수 세션)와 계획 `docs/superpowers/plans/2026-09-24-backlog-sweep-5-parallel-plan.md` §1 B12 코디네이터 판정. 설계 리뷰 판정: **생략**(새 불변식·외부 통합 계약·비가역 변경 없음, iOS 계약의 이식이다 — 계획 문서 §1).

## 1. 무엇을 만드는가

웹 채팅의 어시스턴트 답변 끝(산문 → 카드 → 출처 뒤)에 **[복사][듣기]** 두 버튼. iOS `ChatConversationView`의 듣기·공유 계약을 웹 관용구로 옮긴다.

| 항목 | 계약 |
|---|---|
| 버튼 | 텍스트 라벨만(아이콘·이모지 없음), `min-h-11`, 산문이 있는 답변에만. 사용자 질문엔 없다 |
| 복사 | `markdownToPlainText`로 평문화해 `navigator.clipboard.writeText`. 성공하면 "복사됨"을 채팅 화면의 polite 창구 하나로 통지(새 live region 금지), 거부면 통지 없음(주소 복사 선례) |
| 듣기 | 라벨 교체만("듣기" ↔ "재생 중지", `aria-pressed` 병기 금지). 같은 답변 재탭은 정지, 다른 답변 탭은 교체, 화면당 재생 1개 |
| 듣기 엔진 | 브라우저 `speechSynthesis`가 정본. 현재 로케일 보이스가 없을 때만 `/api/tts`(Google Cloud TTS, 과금). 보이스 목록이 비었으면 `voiceschanged`를 1.5초까지 기다린다 |
| 듣기 실패 | 서버까지 실패(502 `fallback` 포함)하거나 합성 오류면 같은 polite 창구로 실패 문장. iOS는 시스템 기본 보이스로 마지막 낭독을 하지만 웹은 하지 않는다 — 로케일 보이스가 없는 브라우저에서 기본 보이스로 한국어를 읽히면 무음이거나 알아들을 수 없다 |
| 정지 조건 | 채팅 화면 언마운트(오버레이 닫기), 받아쓰기 버튼 누름(시작·정지 모두, 캡처 단계라 녹음 시작보다 먼저) |

## 2. 평문 변환의 정본은 Kit다

`src/lib/markdown-plain-text.ts`는 dodo-planet `markdownToPlainText`의 이식이지만 결과는 Kit `MarkdownPlainText.strip`과 같아야 한다. 공유 fixture `src/lib/__tests__/fixtures/markdown-plain-text-cases.json`을 웹 테스트와 Kit `MarkdownPlainTextTests`가 함께 읽는다.

규칙 문자열이 같아도 엔진이 달라 결과가 갈린다. dodo 원본을 그대로 옮기면 fixture 28건 중 4건이 떨어진다(실측).

| 차이 | ICU·Foundation(Kit) | JS 기본 | 웹 처리 |
|---|---|---|---|
| `\w`(코드펜스 언어 태그) | 한글 포함 | ASCII만 | ICU 정의를 `\p{…}` 클래스로 |
| `\s` | `\p{White_Space}` | U+FEFF 포함, U+0085 제외 | `\p{White_Space}` |
| `\d` | `\p{Nd}` | ASCII | `\p{Nd}` |
| 끝 트림 | White_Space + U+200B | U+FEFF 포함, U+0085·U+200B 제외 | 명시 집합 |

규칙 순서가 만드는 기이한 결과(이미지 문법의 `!` 잔존, `snake_case` 밑줄 소실, 번호 목록 규칙이 앞 빈 줄을 먹는 것)는 두 플랫폼 공통이라 fixture에 그대로 잠근다. 고치려면 Kit와 웹을 함께 바꾼다.

## 3. 문구 (`chat.*`, 6로케일)

| 키 | ko |
|---|---|
| `chat.copy` | 복사 |
| `chat.copied` | 복사됨 |
| `chat.listen` | 듣기 |
| `chat.stopListening` | 재생 중지 |
| `chat.listenFailed` | 듣기를 재생하지 못했습니다. |

다른 로케일의 듣기 라벨은 iOS `ios.chat.listen`·`listenStop` 번역과 같다. 앱 타깃 xcstrings·안드로이드 strings는 생성물이라 재생성한다(iOS·안드로이드 호출부는 없다).

## 4. 검증

- 웹 `markdown-plain-text.test.ts`와 Kit `markdownPlainTextMatchesSharedFixture`가 같은 fixture를 돈다.
- 훅 `useTtsPlayback.test.ts`: 로컬 보이스 우선, 지연 로드, 대기 상한 뒤 서버, 서버 재생·502 통지, 늦은 응답 무시, 언마운트 정지. `/api/tts`는 스텁(실호출 없음).
- `MessageBubble.test.tsx`: 버튼 순서·위치, 토글 라벨, `aria-pressed` 부재, 평문 복사, 클립보드 거부 시 통지 없음.
- `ChatInterface.test.tsx`: polite 창구 1개 유지, 같은 문장 연속 복사도 DOM 변경 2회, 2초 뒤 비움, 받아쓰기 누름 정지, 실패 통지.
- 남는 판정: 웹 VoiceOver·NVDA 실사용(`docs/BACKLOG.md` §2).

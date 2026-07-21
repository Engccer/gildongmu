# App Store 출시 필수 요건(심사 하드 게이트) 설계

- 날짜: 2026-07-21
- 상태: 사용자 승인 설계(브레인스토밍 완료), 계획 수립 대기
- 배경 조사: 2026-07-21 세션(요건 웹조사 + iOS 인벤토리 교차 검증). 근거 요지는 본 문서에 내장, 대화 로그는 비정본.

## 목표

iOS 앱을 App Store 정식 심사에 제출할 수 있는 상태로 만든다. **이번 마일스톤 = 심사 필수 요건(코드·웹·프로젝트 설정) 완비까지.** 심사 제출 자체와 ASC 콘솔 입력(스크린샷·라벨·등급)은 약 1주 후 실사용 보완 뒤 별도 후속 작업(§8 체크리스트)으로 수행한다.

측정 가능한 성과: ① 미동의 상태에서 Gemini/Perplexity로 나가는 채팅 요청 0건(구조적 차단) ② App Store 업로드 자동 검사(프라이버시 매니페스트) 통과 가능 상태 ③ 처리방침 URL이 5개 언어로 실서비스 ④ 1.0.0(정식명) 빌드가 실기기에서 VoiceOver QA 통과.

## 범위

**In**: §1 채팅 AI 동의(iOS) / §2 PrivacyInfo.xcprivacy / §3 웹 처리방침 페이지 / §4 정식명·버전 승계 / §5 `/api/chat` 레이트리밋 / §7 검증 게이트.

**Out**(후속·비대상): ASC 콘솔 작업 전체(§8 체크리스트로만), M7 비콘(1.0 이후), 웹 채팅의 동의 UI(App Store 심사 대상 아님 — 처리방침 고지로 충분), 검색 탭 Perplexity 웹 폴백의 동의 게이트(아래 §1 판단 기록).

## 1. 채팅 AI 동의 (App Review 가이드라인 5.1.2(i), 2025-11-13 발효)

요건: 사용자 데이터를 제3자 AI에 보내기 **전** 명시적 동의, 제공자 명시, 동의 해제 수단. 미비 시 본심사 거절 위험 최고 항목.

### 상태 모델
- `@AppStorage("aiChatConsent")` Bool, 기본 `false`. 앱 타깃 소유(GildongmuKit에 두지 않는다 — Kit은 플랫폼 계약·API 클라이언트 계층, 동의는 앱 정책).
- 미결정/거부 3-state는 두지 않는다: 어느 쪽이든 동일하게 동의 화면을 보여주므로 구분이 동작을 바꾸지 않는다(미니멀리즘). PrivacyInfo·처리방침의 3-state 불변식과 무관(그쪽은 데이터 상태, 이쪽은 사용자 선택).

### 동의 화면 (인라인, 사용자 확정 2026-07-21)
- 신규 `ChatConsentView`: 미동의 상태에서 **채팅 탭(`ChatTabView`)과 장소 채팅 sheet(`ChatView`)** 모두 대화 UI 대신 표시.
- 내용(순서대로 단일 세로 흐름, 한 줄=한 객체):
  1. 제목(헤딩 trait): AI 채팅 안내
  2. 전송 데이터 설명: 질문 텍스트·대화 내용·장소 정보·현재 위치가 Google Gemini로 전송되고, 웹 검색이 필요한 질문은 Perplexity로도 전달됨
  3. AI 생성 고지: 답변은 AI가 생성하며 부정확할 수 있음
  4. 대안 안내: 동의하지 않아도 검색·내 주변 탭은 그대로 사용 가능
  5. 처리방침 링크(웹 `/{locale}/privacy`, 외부 브라우저)
  6. "동의하고 시작" 버튼(주 행동, `min-h` 터치 타깃)
- 동의 탭 → `aiChatConsent=true` → 같은 자리에서 채팅 UI로 전환, 포커스는 입력 필드로 선점 이동(헌장 §5: 포커스를 쥔 요소가 사라지는 전이).
- 시트·팝업 없음: VoiceOver 포커스 예측 가능, 받아쓰기 홀드 계약과 무충돌.

### 이중 방어(전송 경로 가드)
- `ChatModel` 전송 함수에 동의 가드: `aiChatConsent == false`면 네트워크 호출 자체를 하지 않는다(UI 게이트가 뚫려도 구조적 차단). UserDefaults 직접 조회(가드는 View 밖이므로 @AppStorage 아님).
- 적용 지점이 ChatModel 단일이므로 채팅 탭·장소 sheet·인텐트 유입 등 모든 경로를 한 곳에서 커버.

### 설정 연동 (기존 SettingsView 확장)
- "AI 채팅" 섹션 신설: ① 동의 토글(해제 시 채팅은 다시 동의 화면 — 요건 ⓒ 동의 재검토·해제) ② "문제 신고" 링크(mailto, AI 콘텐츠 신고 경로의 최소 대응) ③ "개인정보 처리방침" 링크.
- 토글은 `disabled` 금지 원칙 등 기존 설정 시트 관례 그대로.

### 판단 기록: 검색 탭 Perplexity 웹 폴백은 비게이트
전송되는 것이 검색어 텍스트뿐(좌표·대화·장소 컨텍스트 없음)이고 검색 엔진성 기능이라 5.1.2(i)의 "개인정보 공유"와 결이 다르다. 게이트를 걸면 핵심 검색 기능(장소·주소 0건 시 유일한 결과 소스)이 훼손된다. 처리방침 고지로 대응하고, 심사에서 지적되면 그때 게이트 확장(낮은 확률로 판단, 사용자 승인 2026-07-21).

### i18n
- 신규 문자열은 `ios.chat.consent.*`·`ios.settings.ai.*` 키로 `Localizable.xcstrings` 5개 언어(ko/en/es/fr/it) 동시 등록. 기존 키 린터 게이트 준수.

## 2. PrivacyInfo.xcprivacy (2024-05부터 필수, 미비 시 업로드 단계 자동 거절)

`ios/Gildongmu/PrivacyInfo.xcprivacy` 신설, 앱 타깃 리소스로 등록:
- `NSPrivacyTracking = false`, `NSPrivacyTrackingDomains = []`.
- `NSPrivacyAccessedAPITypes`: `NSPrivacyAccessedAPICategoryUserDefaults`, 사유 `CA92.1`(앱 자체 기능용 읽기·쓰기 — `AppLanguage`·테마·동의 플래그).
- `NSPrivacyCollectedDataTypes`: ① 정밀 위치(목적 App Functionality, not linked, no tracking) ② 기타 사용자 콘텐츠(채팅 텍스트, 동일 속성). ASC 영양 라벨(§8)과 문구 일치가 불변식(불일치는 거절·제거 사유).
- 서드파티 SDK 0개(SPM 원격 의존성 없음)라 추가 매니페스트 불요.

## 3. 개인정보 처리방침 페이지 (웹, 모든 앱 필수 + 5.1.2(i) 직결)

- `src/app/[locale]/privacy/page.tsx` 정적 페이지, next-intl 5개 언어(`privacy.*` 키 — 기존 `i18n-messages.test.ts` 머지 게이트가 키 일관성 자동 커버).
- 내용(정직성 원칙 — 매니페스트·라벨과 3자 일치):
  - 계정·자체 DB 없음. 위치는 실시간 검색·교통·길찾기 API 쿼리에만 사용, 자체 저장 없음(단 인프라 요청 로그에 일시 기록될 수 있음을 고지).
  - 채팅: 질문·대화·장소 정보·위치가 Google Gemini에, 웹 검색 질의는 Perplexity에 전달됨. 답변은 AI 생성.
  - 검색: 검색어가 카카오·네이버 등 검색 제공자와, 0건 폴백 시 Perplexity에 전달됨.
  - iOS 받아쓰기는 온디바이스 처리로 오디오가 기기를 떠나지 않음(웹 받아쓰기는 Deepgram 전사 경유임을 구분 고지).
  - 문의(mailto) 섹션 — 이 페이지가 ASC 처리방침 URL 겸 지원 URL.
- 메인 페이지 하단에 처리방침 텍스트 링크 1개 추가(전용 푸터 컴포넌트 신설 없이 — 미니멀). 접근성 헌장 준수(heading 계층, 과잉 landmark 금지).

## 4. 정식명·버전 승계 (M8 잔여분 흡수)

- `CFBundleDisplayName`(INFOPLIST_KEY): "길동무 베타" → **"길동무"**. ASC 스토어명 "길동무: 접근성 길찾기"는 그대로.
- `MARKETING_VERSION` 0.1.0 → **1.0.0**, `CURRENT_PROJECT_VERSION` 1 → 2.
- PWA 홈 화면 아이콘과 이름 중복 가능성은 수용(기존 M8 계획).

## 5. `/api/chat` IP 레이트리밋 (비용 방어)

- 무인증 공개 API에서 Gemini(+도구 경유 Perplexity)는 유료. 공개 배포 전 웹검색과 동일한 IP 레이트리밋 계층을 `/api/chat`에 적용(기존 유틸 재사용). 한도 기본값 **IP당 60초 10회**(웹검색 30회보다 강한 제한 — 요청당 비용이 크고 대화 턴 간격이 자연히 길다). 기존 유틸 계약이 창 크기를 달리 강제하면 plan에서 등가 수준으로 조정.
- 초과 시 429 + 클라이언트(웹·iOS)는 기존 오류 표면으로 통지(3-state: 실패는 실패로).

## 6. 이번 범위에서 이미 충족(작업 불요, 확인만)

- Xcode 26.6/iOS 26 SDK 빌드(2026-04-28 의무 발효 충족), `ITSAppUsesNonExemptEncryption=NO`(HTTPS만 사용), 1024 알파 없는 아이콘, 권한 문자열 5개 언어 구체 서술, ATS 예외 0, 계정 기능 없음(계정 삭제 요건 비해당), LSApplicationQueriesSchemes 불요(canOpenURL 미사용 설계), 네이티브 SwiftUI(4.2 최소 기능성 유리).

## 7. 검증 게이트

- **결정적 게이트**: 웹 `npm run lint`·`npm run test:run`(i18n 키 포함)·`npm run build`. iOS 빌드 성공 + xcstrings 키 린터. ChatModel 동의 가드는 단위 테스트 가능하면 동반(테스트 레인 유무는 plan에서 확인, 없으면 빌드+실기기 검증으로 대체하고 사유 기록).
- **실호출 게이트**: `/api/chat` 레이트리밋 실호출 확인(연속 호출 429), 처리방침 페이지 5개 로케일 prod 응답.
- **실기기 VoiceOver QA(위원장, 배포 게이트)**: 동의 화면 낭독·동의 후 포커스 입력 필드 안착, 설정 토글 해제 → 채팅 재진입 시 동의 화면 복귀, 장소 채팅 sheet 동일 동작, 받아쓰기 홀드 플로 회귀 없음.
- 서브에이전트 리뷰(spec-compliance + code-quality) 통과 후 commit·push·실기기 배포(`ios/deploy-device.sh`) — repo 관례.

## 8. 후속: 심사 제출 시점 작업(약 1주 후, 별도 세션 체크리스트)

1. ASC 영양 라벨 입력: 위치+사용자 콘텐츠(채팅), App Functionality, not linked, 추적 없음 — §2와 문구 일치.
2. 새 연령 등급 질문 응답(개편 체계).
3. 6.9인치(1320×2868) 스크린샷 세트(iPhone 전용이라 이 세트만, 시뮬레이터 캡처).
4. 스토어 설명·키워드(100자)·카테고리(내비게이션)·저작권·지원 URL(=처리방침 페이지).
5. 접근성 라벨(Accessibility Nutrition Labels) VoiceOver 지원 신고 — §7 통합 QA 결과가 근거.
6. 심사 노트: 접근성 우선 설계 소개, 위치·마이크 사용 이유, 동의 플로 위치 안내.
7. 1.0.0 빌드 업로드 → 심사 제출(외부 발신성 최종 행위 — 제출 직전 사용자 확인).

## 9. 오케스트레이션 판단 기록

Agent Teams 비가동(2026-07-21 검토): 도메인 2개(iOS·웹)이나 각 변경 소규모·짧은 선형 흐름으로 비적용 신호 해당. subagent-driven-development 기본 + iOS/웹 독립 태스크의 세션 내 병렬 서브에이전트로 충분.

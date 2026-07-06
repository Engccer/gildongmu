# 길동무 iOS 네이티브 재개발(SwiftUI 전면 전환) 설계

> 작성: 2026-07-06 (KST), 사용자 승인 완료.
> 선행 문서: `2026-06-21-ios-app-distribution-readiness-design.md` (배포 진단, 당시 권고는 Capacitor).
> 본 설계는 선행 문서의 대안 5.2(SwiftUI 전면 재개발)를 정식 채택한다. 단 출시 목표가 다르다: 당시 전제는 "App Store 전체 기능 동시 출시"였고, 이번 목표는 "개인 기기 우선 실험, 성숙 후 배포 재검토"다. 이 전제 변화가 SwiftUI 선택의 최대 리스크였던 기간·회귀 부담을 해소한다.

## 1. 목적과 측정 가능한 성과

**픽셀 복제가 아니라 기능 마이그레이션 + 인터랙션의 iOS 재설계.** 웹앱은 그대로 운영하며, 같은 백엔드 위에 네이티브 클라이언트를 병렬 추가한다.

움직일 성과(빌드 전 명명):

1. **VoiceOver 인터랙션 품질**: 항목당 스와이프 수 감소(커스텀 액션 로터), 포커스 이탈 0(프레임워크 수준 포커스 관리). 웹에서 반복 실측·수정해 온 회귀 계열(인라인 span 분절, live region 중복, 포커스 이탈)이 구조적으로 소멸하는지 검증.
2. **웹 불가능 영역 개방**: 화면 잠금 상태 백그라운드 거리 비콘(위치+오디오 세션), 햅틱 이중 채널, 온디바이스 STT.
3. **dodo-planet Swift 이식 선행 학습**: 아키텍처·컨벤션·함정을 이 인큐베이터에서 확정.

## 2. 확정 결정 (2026-07-06 사용자 답변 + 강한 디폴트)

| 항목 | 결정 | 근거 |
|---|---|---|
| 배포 목표 | 개인 기기 우선. 무료 프로비저닝(7일 재서명, Xcode 직접 설치) | 비용 0 시작. Developer Program(연 99 USD)은 성숙 후 별도 결정(비용 하드 스톱) |
| 검증 기기 | 주 사용 iPhone 실기기 | 시뮬레이터는 VoiceOver 미지원. 실사용 검증이 최강 루프 |
| 범위 | 전체 기능 동등성(웹 14개 기능 영역 전부)이 완료 조건 | 사용자 확정. 내부는 M0~M8 수직 슬라이스로 순차 |
| 백엔드 | 기존 Vercel `/api/*` 전량 재사용(A안) | secret 서버 격리 유지, 22개 provider·검증 이력 전부 자산화. URLSession은 CORS 무관 |
| 저장소 | 같은 repo `ios/` 디렉터리. 워크트리·별도 repo 불필요 | 신규 디렉터리 추가라 웹 코드와 충돌 없음. API 계약·spec·함정 카탈로그 공유. 되돌리기 쉬움 |
| 최소 지원 버전 | iOS 26 | 대상 기기가 사용자 iPhone 하나. availability guard 전부 잉여. Liquid Glass·SpeechAnalyzer·최신 접근성 API를 기준 문법으로 학습. App Store 단계에서 하향 재검토 |
| 서드파티 의존성 | 0이 기본값 | vanilla 원칙. NDJSON은 `URLSession.bytes`, 마크다운은 `AttributedString(markdown:)` 우선 검증, 부족할 때만 추가 논의 |
| 지도 | 미탑재 | 웹과 동일: 정보 정본은 리스트/텍스트, 실주행은 네이버·카카오 딥링크 위임. 1급 사용자(시각장애인)에게 MapKit은 잉여(YAGNI) |
| STT | 온디바이스 SpeechAnalyzer 우선, 품질 미달 언어만 `/api/speech-to-text`(Deepgram) 폴백 | 무료·저지연·오프라인. 실기기 한국어 품질 실측이 게이트 |

## 3. 아키텍처

```text
SwiftUI App (Gildongmu)
  ├─ Features: Search / PlaceDetail / Nearby / Transit / Routes / Chat / Voice / Beacon / Settings
  ├─ Services: Location / Audio / Haptics / Speech / Deeplink
  └─ GildongmuKit (SPM 패키지, UI 비의존)
        ├─ APIClient (base URL 주입, 오류 정규화)
        ├─ Codable 모델 (Route Handler 계약 미러)
        ├─ NDJSON 스트림 파서 (chat)
        └─ 도메인 로직 (거리 포맷, 도착 문장 투영 등)
              │ HTTPS (URLSession)
              ▼
Vercel `/api/*` 20개 Route Handler (기존 그대로, 변경 없음)
  └─ 22개 provider + Gemini/Perplexity/Deepgram + 공공·지도 API
```

- **GildongmuKit는 웹의 `src/lib` React 비의존 원칙의 Swift 판**이다. dodo-planet 이식 시 이 패키지가 이식 단위가 된다.
- 상태는 `@Observable` 모델, 내비게이션은 `NavigationStack` typed path, 동시성은 Swift 6 strict concurrency.
- 웹의 위치 공유 스토어 원칙(싱글턴 1곳)은 `LocationService` 하나로 이어진다. `getCurrentPosition` 직접 호출 금지 원칙과 동형: 각 Feature는 CLLocationManager를 직접 만들지 않는다.
- 위치 권한은 When In Use만, 사용자가 위치 기능을 처음 쓸 때 요청(앱 시작 즉시 금지, 선행 문서 §6.4 계승).

## 4. 인터랙션 재설계 (픽셀 복제 금지, iOS 문법)

| 웹 패턴 | iOS 재설계 | 효과 |
|---|---|---|
| History API 뷰 전환 + request-id stale 폐기 | `NavigationStack` push/pop, task 취소는 structured concurrency | 뒤로가기 제스처·상태 복원 무료, stale 응답은 Task 취소로 구조적 해결 |
| 내 주변 아코디언 패널 + `nearby-panel-store` + Esc 경합 | 표준 시트 또는 push 화면 | 스택된 전역 Esc 리스너 경합([[stacked-global-esc-listener-conflict]]) 문제 자체가 소멸 |
| 채팅 오버레이 모달 | `.sheet` + detent | 시스템 표준 dismiss·포커스 관리 |
| 항목마다 화면 버튼 노출(길찾기·전화·질문) | VoiceOver 커스텀 액션(로터)으로 항목에 부착 | 항목당 스와이프 수 격감. 시각 UI도 단순해짐 |
| `aria-live` 단일 polite + `combinedLiveMessage` | `AccessibilityNotification.Announcement` 단일 채널 | 동일 원칙(단일 통지 채널)의 1급 API |
| `joinText` 한 줄=한 객체 | `accessibilityElement(children: .combine)` | 분절 회귀가 프레임워크 수준에서 차단 |
| `aria-disabled` + in-flight ref 가드 | 표준 컨트롤 + Task 기반 재진입 가드 | disabled 포커스 이탈 문제 없음(SwiftUI 포커스 유지) |
| Web Audio 합성 효과음 | 시스템 사운드 + CoreHaptics | 소리+진동 이중 채널(청각 피드백 보강) |
| wake lock + 포그라운드 톤 비콘 | 백그라운드 위치 갱신 + 오디오 세션 + 공간 오디오 비콘(Soundscape 원형, `RESEARCH-2026-07-04` 참조) | 화면 잠근 채 주머니에서 동작. 웹 대비 최대 이점 |
| MediaRecorder 녹음 → Deepgram | 온디바이스 SpeechAnalyzer(§2 결정) | 왕복 지연 제거, 오프라인 동작 |
| next-intl 5개 언어 + 데이터 언어 분리 | String Catalog(ko/en/es/fr/it) + `dataLocale` 로직은 GildongmuKit 이식 | 시스템 언어 자동 추종. 데이터 언어 분리 원칙(ko/en만 제공, 비한국어는 영문 공유)은 그대로 |
| PWA 서비스워커 | 없음. 앱 자체가 로컬 번들 | 스테일 SW 배포 회귀([[pwa-stale-sw-deploy-hydration-418]]) 계열 소멸 |
| 딥링크 `nmap://`·`kakaomap://` + 웹 폴백 | 동일 유지 + `LSApplicationQueriesSchemes` 선언, 미설치 시 HTTPS 폴백 | 실주행 위임 원칙 불변 |

## 5. 접근성 (글로벌 헌장의 SwiftUI 구체화)

정본은 `~/.claude/ACCESSIBILITY.md`. 이 절은 repo 고유 구체화만 담는다.

- **미니멀 원칙 유지**: 네이티브 컨트롤의 기본 시맨틱 우선. 불필요한 `accessibilityLabel`(시각 텍스트 덮기)·과잉 트레이트 금지. "더할 이유"가 아니라 "뺄 이유"가 기본값.
- **한 줄=한 객체**: 항목 행은 `accessibilityElement(children: .combine)`으로 단일 객체화. 인터랙티브 요소는 커스텀 액션으로 분리(합치지 말 것).
- **발견 경로 규칙**: 자동 등장 섹션(날씨·공기질 류)은 `.accessibilityAddTraits(.isHeader)` heading으로 로터 점프 보장. 버튼으로 펼친 화면은 내비게이션 자체가 발견 경로.
- **포커스**: `@AccessibilityFocusState`로 검색 결과 도착·상세 진입·채팅 완료 시점 포커스를 명시 관리. 비동기 경계 포커스 이탈은 실기기 VoiceOver로 마일스톤마다 검증.
- **3-state 불변식 유지**: "0/없음" ≠ "정보 없음" ≠ "조회 실패"를 텍스트로 분리(웹과 동일, GildongmuKit 모델 계층에서 보장).
- **Dynamic Type**: 접근성 크기에서 가로 배치를 세로 재배치, truncation 금지. 200% 게이트.
- **도착 낭독 정본은 완성 문장 필드**(`arrmsg1`·`arvlMsg2`): 웹 함정 카탈로그 그대로 적용. 슬롯 환산 금지.

## 6. API 계약과 데이터

- 기존 `/api/*`를 변경 없이 소비한다. base URL은 빌드 설정 주입(디버그: 로컬 dev 서버 선택 가능, 릴리스: `https://gildongmu.vercel.app`).
- **계약 fixture 공유**: 웹 Vitest fixture(JSON)를 GildongmuKit 계약 테스트가 재사용한다. 같은 fixture로 TS와 Swift 디코딩이 동일 기대값을 내는지 검증. 계약 드리프트를 양쪽에서 감지.
- 채팅은 NDJSON 스트리밍(`/api/chat`, status/done/error 이벤트)을 `URLSession.bytes` 라인 파서로 소비. 카드 render 힌트·출처(sources)는 웹과 동일 계약.
- 캐시 정책은 서버가 이미 담당(`no-store`·`revalidate`). 클라이언트 추가 캐시는 넣지 않는다(YAGNI, 필요 실측 후).
- 오류 표준: HTTP 비200과 upstream 502를 사용자 문구로 정규화하되 3-state 불변식을 뭉개지 않는다.

## 7. 마일스톤 (전체 동등성이 완료 조건)

각 마일스톤 게이트: 실기기 VoiceOver 시나리오 통과 + 실호출 검증(fixture green ≠ 완료) + 리뷰 게이트(§8).

| 마일스톤 | 범위 | 핵심 검증 |
|---|---|---|
| M0 환경+골격+검색 | Xcode 26 설치(현재 미설치, 유일한 셋업 차단물), `ios/` 구조, GildongmuKit+APIClient, 검색 3섹션(장소·주소·웹 폴백)+명소 최상단 병치 | 실기기 설치·실검색, VoiceOver 결과 탐색, 결과 수 통지 |
| M1 장소 상세 | 상세 화면, 한영 주소, 전화, 딥링크(네이버·카카오+폴백), 커스텀 액션 1차 도입 | 검색→상세→복귀 포커스, 딥링크 handoff |
| M2 위치+내 주변 | LocationService(권한 흐름), 내 주변 6종(지하철·버스·따릉이·소아진료·아이놀곳·둘러보기) | 권한 허용·거부·재시도, 새로고침 정밀 재취득 |
| M3 역·환경 | 역 메타·실시간 도착·교통약자 시설, 날씨·공기질 | 도착 문장 정본 낭독, 자동 등장 섹션 heading 발견 |
| M4 경로 브리핑 | 자동차(ko 카카오·en NCP)·대중교통(ODsay) 텍스트 브리핑 | 단위 함정(ms·분) 재발 0, 출발지=실위치 불변식 |
| M5 채팅 | NDJSON 스트리밍, 마크다운 렌더, 카드·출처, 장소 앵커 불변식 | 스트리밍 진행 통지, 완료 포커스, 이중 낭독 0 |
| M6 음성 입력 | SpeechAnalyzer 통합, 효과음+햅틱 통지, Deepgram 폴백 판정 | 한국어 실측 품질, 녹음 시작·정지·취소 흐름 |
| M7 거리 비콘 | 백그라운드 위치+오디오 세션, 공간 오디오·햅틱 비콘 | 화면 잠금 동작, 배터리, 명시적 중지 |
| M8 마감 | 5개 언어 String Catalog, 설정, 아이콘·런치 스크린, 통합 VoiceOver QA(선행 문서 §8.1 14개 시나리오 전체) | 전 시나리오 실기기 통과 = 전체 동등성 선언 |

## 8. 실행 전략

### 8.1 Agent Teams 적용 (사용자 지시 2026-07-06 반영)

적합성: 마일스톤급 + 독립 도메인(GildongmuKit/Features/Services) + 계약 선동결(웹 API). 글로벌 정책 "기본 적용(우선 검토)" 충족.

| 구간 | 방식 | 근거 |
|---|---|---|
| M0 | 단일 세션 | 구조·컨벤션 확립 단계, 단일 컨텍스트 일관성이 결정적. 여기서 세운 패턴이 이후 팀 계약 |
| M1~M4 | Agent Teams 후보 | 화면 단위 독립(파일 비겹침). 예: 팀원 A=GildongmuKit 모델+계약 테스트, B=Feature 화면, C=다음 마일스톤 모델 선행 |
| M5~M7 | 단일 세션+서브에이전트 | 스트리밍·오디오 세션·백그라운드 위치는 깊은 단일 문제. 분해 이득 < 동기화 비용. 짧은 독립 태스크만 `dispatching-parallel-agents` |
| M8 | Agent Teams 후보 | 번역·감사·자산이 완전 독립 |

제약: **`project.pbxproj`는 병렬 편집 지뢰**. 타깃·파일 추가는 리더 전담(또는 폴더 참조로 pbxproj 변경 최소화). Agent Teams는 베타이므로 첫 호출 전 문서 재확인·제약 고지 절차 유지.

### 8.2 리뷰 3중 구조 (기존 역할 분리 유지)

- 팀 내부 Reviewer 기본 미배치(인터페이스가 GildongmuKit public API 하나로 좁음, 리더 겸임).
- 마일스톤 완료 직전: codex-rescue(아키텍처·invariant, hang 회피 규칙 준수).
- 커밋 직전: coderabbit(라인 스타일).
- 웹과 다른 추가 게이트: **실기기 VoiceOver 검증**(정적 리뷰가 못 잡는 영역, "코드 리뷰 ≠ 데이터 현실"의 접근성 판).

### 8.3 저장소 운용

- 같은 repo `ios/` 디렉터리, main 직접 커밋(gildongmu 관례). 워크트리 불필요: 웹 코드와 파일이 겹치지 않아 병렬 세션 충돌 소지가 없다. 웹 작업과 동시 진행 시에도 pathspec 커밋 규율([[commit-stage-explicit-files]])이면 충분.
- `ios/`는 Vercel 배포에 영향 없음(Next 빌드 범위 밖). push 자동배포는 웹 파일 변경 시에만 유의미.
- Xcode 산출물(`DerivedData`, `xcuserdata`)은 `.gitignore` 추가.

## 9. 테스트 전략

- **GildongmuKit**: Swift Testing 단위 테스트. 웹 fixture JSON 공유로 계약 테스트(디코딩·투영·거리 계산·NDJSON 파서). 매 커밋 게이트.
- **앱 계층**: node-env Vitest에 컴포넌트 레인이 없던 것과 동형으로, 화면 와이어링은 실기기 검증이 머지 게이트. XCUITest는 스모크(검색→상세→딥링크) 최소만(과잉 UI 테스트 금지).
- **접근성**: 마일스톤별 실기기 VoiceOver 시나리오(§7 표) + M8 통합 14개 시나리오. Accessibility Inspector 감사 보조.
- **실호출 게이트**: 외부 API 통합 검증은 웹에서 이미 완료된 계약을 소비하므로, iOS 쪽 게이트는 "prod API 실호출로 실데이터 렌더 확인"이다.

## 10. 리스크와 미결정

| 항목 | 내용 | 처리 |
|---|---|---|
| 무료 프로비저닝 7일 만료 | 7일마다 Mac 연결 재서명 필요, 무료 계정 앱 3개 제한 | 수용(사용자 확정). 불편이 임계 넘으면 Developer Program 가입을 비용 하드 스톱으로 상신 |
| SpeechAnalyzer 한국어 품질 | Deepgram nova-3 대비 미검증 | M6 실측 게이트. 미달 시 해당 언어만 서버 STT 폴백 |
| `AttributedString(markdown:)` 표현력 | GFM 리스트·중첩 커버리지 미검증 | M5 실측. 부족하면 swift-markdown-ui 도입을 의존성 예외로 논의 |
| 백그라운드 위치+오디오 정책 | 배터리·iOS 정책 제약 | M7 spike 선행(비콘은 보완재 원칙 유지) |
| API 남용 방어 부재 | 네이티브 클라이언트도 공개 API 소비(레이트리밋은 웹 검색 섹션에만 존재) | 개인 기기 단계에선 위험 낮음. 배포 단계에서 선행 문서 §6.6 적용 |
| Xcode 26 미설치 | M0 차단물 | M0 첫 태스크. 설치는 사용자 App Store 조작 필요 시 안내 |

## 11. 장기: dodo-planet 연계

- GildongmuKit의 계약 모델·파서·서비스 패턴이 dodo-planet Swift 이식의 청사진. 이 repo에서 확정된 함정·컨벤션은 웹 때와 마찬가지로 CLAUDE.md·메모리로 승격해 dodo 이식 시 재사용한다.
- dodo 이식 판단 시점: gildongmu iOS가 M8(전체 동등성)을 통과하고 일상 사용 피드백이 쌓인 뒤.

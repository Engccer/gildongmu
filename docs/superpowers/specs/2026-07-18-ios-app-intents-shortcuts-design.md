# iOS 단축어(App Intents) 진입 설계

날짜: 2026-07-18 · 상태: 승인(위원장 확인)

## 목적

단축어 앱·Siri·액션 버튼에서 길동무 iOS 앱의 두 흐름으로 즉시 진입한다:

1. **음성 검색**: 앱이 열리면서 초기 화면으로 리셋된 뒤 바로 마이크가 켜져, 말하면 즉시 검색된다.
2. **내 주변**: 내 주변 허브 탭으로 곧장 진입한다.

시각장애 사용자의 진입 단계를 "홈 화면에서 앱 찾기 → 마이크 버튼 찾기"에서 "Siri 한 마디/액션 버튼 한 번"으로 줄이는 것이 성과 지표다.

## 접근 결정

- **App Intents + AppShortcutsProvider** (iOS 16+, 이 앱은 26 타깃). 앱 설치만으로 단축어 앱에 자동 노출 + 한국어 Siri 문구 + 액션 버튼·잠금 화면 배치 지원.
- URL scheme 대안은 발견성(수동 "URL 열기" 조합 필요, Siri 문구 불가) 때문에 배제. 내부 라우팅이 분리되어 있어 필요해지면 나중에 얹을 수 있다(YAGNI).

## 구성 요소

### 1. `LaunchActionStore` (신규, 앱 타깃)

`@Observable @MainActor` 싱글턴. 보류 액션 1칸(`pending: LaunchAction?`, `enum LaunchAction { case voiceSearch, nearby }`).

- intent `perform()`은 앱 프로세스 안(`openAppWhenRun = true` → 포그라운드 후 실행)에서 돌므로 여기 액션을 넣는 것으로 앱과 통신한다.
- `sessionEpoch` 리셋으로 뷰가 재생성되어도 스토어는 앱 수명이라 액션이 살아남는다.

### 2. `AppShortcuts.swift` (신규, 앱 타깃)

- `StartVoiceSearchIntent` / `OpenNearbyIntent`: 둘 다 `openAppWhenRun = true`, `perform()`은 스토어에 액션만 기록.
- `GildongmuShortcuts: AppShortcutsProvider`: 두 인텐트를 한국어 Siri 문구(`\(.applicationName)` 토큰 포함)로 등록.

### 3. `GildongmuApp` 수정

- `TabView`에 selection 바인딩 추가(`enum AppTab { search, nearby }`). ⚠ selection 상태가 TabView 밖(App)으로 나오므로, **기존 세션 리셋(`resetSession`·유휴 복귀)이 탭도 검색으로 되돌리도록 `selectedTab = .search`를 명시** — 지금까지는 `.id` 재생성이 암묵적으로 첫 탭 복귀를 해줬다(회귀 방지).
- 스토어 `pending` 관찰(`.onChange` + 콜드 런치 대비 `.task` 초기 소비):
  - `.voiceSearch`: `sessionEpoch += 1`, `selectedTab = .search`. pending은 **지우지 않는다** — 새로 생성된 `SearchView`가 소비.
  - `.nearby`: `sessionEpoch += 1`, `selectedTab = .nearby`, pending 즉시 소거. (딥 내비게이션에 머물던 상태 위에 탭만 바뀌는 어정쩡함 방지 — 두 액션 모두 초기 화면 리셋.)

### 4. `SearchView` 수정

`.task`에서 `LaunchActionStore.pending == .voiceSearch`면 소거 후 `speech.start()`. 시작음·햅틱·권한 흐름은 기존 `SpeechService` 그대로(변경 없음).

## 오류·경계

- 마이크 권한 거부·인식 실패: 기존 `SearchView`의 denied/failed alert 3-state 그대로 동작(신규 경로 없음).
- 유휴 복귀 리셋과 인텐트 진입이 겹쳐도 epoch 이중 증가일 뿐 무해(멱등 리셋).
- Siri 사용 설명 plist 키 불필요(App Intents는 SiriKit 도메인과 달리 요구 없음).

## 검증

- Kit 비수정 → 신규 단위테스트 없음(라우팅은 UI 상태 한 줄 수준).
- 게이트: `xcodebuild` 빌드 통과 → `ios/deploy-device.sh` 실기기 배포 → **단축어 앱에서 두 액션 실행 + Siri 문구 실호출**이 머지 게이트(실호출 원칙).

# iOS 길동무 제목 메뉴(새로고침·설정) + 테마 선택 설계

- 날짜: 2026-07-19
- 상태: 승인(위원장, 세션 내)
- 범위: iOS 앱만. 웹 무변경.

## 배경·요구

1. 채팅 탭 예시 프롬프트 첫 항목 "주변에 뭐가 있는지 둘러줘"가 부자연스럽다. "주변에 뭐가 있는지 둘러봐 줘"로 교체한다(표준 띄어쓰기: "둘러보다"는 합성어 한 단어이고, 보조용언 "주다"는 본용언이 합성어라 붙여 쓸 수 없어 띄어 쓴다).
2. 검색 탭에만 있던 principal "길동무" 버튼(탭 시 전체 리셋+채팅 탭 복귀)을 **세 탭 공통 disclosure 메뉴**로 개편한다: 누르면 "새로고침"·"설정" 두 항목이 펼쳐진다.
3. **새로고침**: 현재 보고 있는 탭만 초기 상태로 되돌린다(채팅 대화·검색 결과·내 주변 화면). 탭 이동 없음.
4. **설정**: 시트로 앱 설정을 연다. 이번 라운드 내용은 **테마 선택 하나만**(시스템 설정 따름/라이트/다크), 저시력 사용자 배려. 언어 설정은 후속 마일스톤(아래 "제외 범위").

## 설계

### 1. 예시 프롬프트 문구
`ios/Gildongmu/Chat/ChatTabView.swift` `suggestions` 첫 항목을 `"주변에 뭐가 있는지 둘러봐 줘"`로 교체. 마침표 없음(형제 항목과 문장부호 일관).

### 2. 공통 제목 메뉴 (SwiftUI `Menu`)
- 세 탭 루트(`ChatTabView`·`SearchView`·`NearbyHubView`)의 NavigationStack 안에 공용 ViewModifier `.gildongmuTitleMenu()`로 부착. principal 자리 `Menu("길동무") { 새로고침 / 설정 }`.
- 네이티브 disclosure라 VoiceOver가 "길동무, 팝업 버튼"으로 낭독하고 항목 탐색은 표준 제스처. 열림 상태 관리가 불필요하다(confirmationDialog 대비 선택 이유).
- 각 탭의 `navigationTitle`은 유지한다(뒤로 버튼 라벨 보존, 검색 탭 기존 주석 계약 그대로). 푸시된 상세 화면엔 메뉴가 표시되지 않는 것이 SwiftUI 기본 동작이고, 내 주변 도메인 화면들은 자체 `nearbyRefreshable` 새로고침이 이미 있어 충돌 없음.

### 3. 새로고침: 현재 탭만
- `GildongmuApp`에 탭별 epoch 3개(`chatEpoch`·`searchEpoch`·`nearbyEpoch`)를 두고 각 탭 콘텐츠에 `.id(탭Epoch)`.
- 새 environment 액션 `\.refreshTab`이 `selectedTab`에 따라 해당 epoch만 증가시킨다:
  - 채팅: `chatEpoch += 1` + `chatModel.cancel()` 후 새 `ChatModel` 교체(진행 중 스트림 요청째 취소, idle-reset 불변식 재사용). 추천 질문 리스트 복귀.
  - 검색: `searchEpoch += 1`로 SearchView 재생성(검색어·결과·필터 초기화).
  - 내 주변: `nearbyEpoch += 1`로 허브 재생성.
- 탭 이동 없음. 기존 `sessionEpoch`(유휴 복귀·단축어 전체 리셋)는 유지. 검색 탭 전용이던 `\.resetSession` environment는 소비처가 사라지므로 제거(죽은 코드).

### 4. 설정 시트 + 테마
- 메뉴 "설정"이 sheet로 `SettingsView`를 연다. 내용: `Picker("테마")` inline, 3택 **시스템 설정 따름/라이트/다크**.
- `@AppStorage("themePreference")` 영속(raw string enum `ThemePreference`). `GildongmuApp` 루트에서 `.preferredColorScheme()` 적용(시스템=nil).
- 시트 등장 시 VO 포커스는 시스템이 이동시킨다. 표준 컨트롤만 쓰고 과잉 라벨을 더하지 않는다. 언어 행은 넣지 않는다(YAGNI).

### 5. 검증
- SwiftUI 와이어링(App 타깃 테스트 레인 없음): 빌드 + `ios/deploy-device.sh` 실기기 배포가 게이트. VoiceOver 확인 포인트: 메뉴 낭독("길동무, 팝업 버튼"), 새로고침 후 탭 유지, 테마 즉시 반영.

## 제외 범위 (후속 마일스톤: iOS 다국어)
언어 설정은 dodo-planet 파이프라인 이식으로 별도 진행한다: 웹 `messages/`(5 로케일, 이미 존재) 정본에서 `messages-to-xcstrings.mjs` 결정론 변환으로 String Catalog 생성, `String(localized:)` 전 뷰 교체, `ios-extra`(iOS 전용 문구), 채팅/검색/STT locale 배선. String Catalog 도입 시 iOS "앱별 언어"가 시스템 제공되므로 자체 언어 모달 대신 시스템 위임이 유력(후속 설계 지점).

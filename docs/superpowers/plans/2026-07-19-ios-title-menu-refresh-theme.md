# iOS 길동무 제목 메뉴(새로고침·설정)+테마 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채팅 예시 프롬프트 문구 교정 + 세 탭 공통 "길동무" Menu(새로고침·설정) + 테마 선택(시스템/라이트/다크) 설정 시트.

**Architecture:** 탭별 epoch(`.id`)로 현재 탭만 재생성하는 `\.refreshTab` environment 액션을 `GildongmuApp`이 소유하고, 공용 ViewModifier `.gildongmuTitleMenu()`가 세 탭 루트의 principal 자리에 SwiftUI `Menu`를 부착한다. 테마는 `@AppStorage` raw enum을 App 루트 `.preferredColorScheme()`으로 적용한다.

**Tech Stack:** SwiftUI(iOS 17+ Observation), Xcode FileSystemSynchronizedRootGroup(새 파일 자동 포함 — pbxproj 수정 불필요).

## Global Constraints

- 스펙 정본: `docs/superpowers/specs/2026-07-19-ios-title-menu-refresh-theme-design.md`
- 접근성 헌장 준수: `disabled` 금지, 과잉 라벨 금지, 표준 컨트롤만. UI 라벨 이모지 금지.
- App 타깃엔 테스트 레인이 없다 — 각 태스크의 게이트는 `xcodebuild build` 성공. 최종 게이트는 실기기 배포(`ios/deploy-device.sh`).
- 커밋은 pathspec 커밋(`git add <파일> && git commit -- <파일>` 원자 실행), `git add -A` 금지.
- 주석·커밋 메시지 한국어.
- 빌드 확인 명령(공용):
  `cd ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS' -allowProvisioningUpdates build`
  Expected: `** BUILD SUCCEEDED **`

---

### Task 1: 채팅 예시 프롬프트 문구 교정

**Files:**
- Modify: `ios/Gildongmu/Chat/ChatTabView.swift:12`

**Interfaces:**
- Consumes: 없음
- Produces: 없음(문구만)

- [ ] **Step 1: 문구 교체**

`ChatTabView.swift`의 suggestions 첫 항목을 교체:

```swift
        "주변에 뭐가 있는지 둘러봐 줘",
```

(기존 `"주변에 뭐가 있는지 둘러줘",` → 위로. 마침표 없음, 형제 항목과 일관. "둘러보다"는 합성어 한 단어라 붙이고, 보조용언 "줘"는 띄운다.)

- [ ] **Step 2: 빌드 확인**

Global Constraints의 빌드 명령 실행. Expected: BUILD SUCCEEDED.

- [ ] **Step 3: 커밋**

```bash
git add ios/Gildongmu/Chat/ChatTabView.swift && git commit -m "fix(ios): 채팅 예시 프롬프트 문구 교정 — 둘러봐 줘(표준 띄어쓰기)" -- ios/Gildongmu/Chat/ChatTabView.swift
```

---

### Task 2: ThemePreference + SettingsView + App 테마 적용

**Files:**
- Create: `ios/Gildongmu/SettingsView.swift`
- Modify: `ios/Gildongmu/GildongmuApp.swift`

**Interfaces:**
- Consumes: 없음
- Produces: `ThemePreference`(String raw enum, `.system/.light/.dark`, `var colorScheme: ColorScheme?`), `SettingsView`(파라미터 없는 View), AppStorage 키 문자열 `"themePreference"`(Task 3의 시트가 `SettingsView()`를 그대로 띄운다)

- [ ] **Step 1: SettingsView.swift 생성**

```swift
import SwiftUI

/// 테마 선택 영속값. rawValue가 AppStorage("themePreference")에 저장된다.
/// 시스템=nil 반환으로 preferredColorScheme 오버라이드를 해제한다.
enum ThemePreference: String, CaseIterable {
    case system
    case light
    case dark

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    var label: String {
        switch self {
        case .system: "시스템 설정 따름"
        case .light: "라이트"
        case .dark: "다크"
        }
    }
}

/// 앱 설정 시트. 이번 라운드 내용은 테마 선택 하나(스펙 §4) — 언어 설정은
/// 후속 마일스톤(iOS 다국어)이라 자리를 미리 잡지 않는다(YAGNI).
/// 시트 등장 시 VoiceOver 포커스는 시스템이 이동시키므로 별도 처리 없음.
struct SettingsView: View {
    @AppStorage("themePreference") private var themeRaw = ThemePreference.system.rawValue
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Picker("테마", selection: $themeRaw) {
                    ForEach(ThemePreference.allCases, id: \.rawValue) { theme in
                        Text(theme.label).tag(theme.rawValue)
                    }
                }
                .pickerStyle(.inline)
            }
            .navigationTitle("설정")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("닫기") { dismiss() }
                }
            }
        }
    }
}
```

- [ ] **Step 2: GildongmuApp에 테마 적용**

`GildongmuApp` struct에 프로퍼티 추가:

```swift
    @AppStorage("themePreference") private var themeRaw = ThemePreference.system.rawValue
```

`WindowGroup` 루트 TabView 모디파이어 체인(`.id(sessionEpoch)` 근처)에 추가:

```swift
            .preferredColorScheme(ThemePreference(rawValue: themeRaw)?.colorScheme ?? nil)
```

- [ ] **Step 3: 빌드 확인**

Global Constraints의 빌드 명령 실행. Expected: BUILD SUCCEEDED.

- [ ] **Step 4: 커밋**

```bash
git add ios/Gildongmu/SettingsView.swift ios/Gildongmu/GildongmuApp.swift && git commit -m "feat(ios): 설정 시트+테마 선택(시스템/라이트/다크, AppStorage 영속)" -- ios/Gildongmu/SettingsView.swift ios/Gildongmu/GildongmuApp.swift
```

---

### Task 3: 세 탭 공통 길동무 Menu + 현재 탭만 새로고침

**Files:**
- Create: `ios/Gildongmu/TitleMenu.swift`
- Modify: `ios/Gildongmu/GildongmuApp.swift`
- Modify: `ios/Gildongmu/SearchView.swift`
- Modify: `ios/Gildongmu/Chat/ChatTabView.swift`
- Modify: `ios/Gildongmu/NearbyHubView.swift`

**Interfaces:**
- Consumes: Task 2의 `SettingsView`
- Produces: environment 액션 `\.refreshTab: () -> Void`, ViewModifier `.gildongmuTitleMenu()`(NavigationStack 내부 루트에 부착)

- [ ] **Step 1: TitleMenu.swift 생성**

```swift
import SwiftUI

extension EnvironmentValues {
    /// 현재 탭만 초기 상태로 재생성하는 액션 — App이 탭별 epoch을 증가시킨다(스펙 §3).
    @Entry var refreshTab: () -> Void = {}
}

/// 세 탭 공통 principal "길동무" 메뉴: 새로고침(현재 탭만)·설정(시트).
/// Menu는 네이티브 disclosure라 VoiceOver가 "길동무, 팝업 버튼"으로 낭독한다.
/// 푸시된 상세 화면엔 표시되지 않는다(SwiftUI 화면별 toolbar 기본 동작).
private struct GildongmuTitleMenu: ViewModifier {
    @Environment(\.refreshTab) private var refreshTab
    @State private var showsSettings = false

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Menu("길동무") {
                        Button("새로고침") { refreshTab() }
                        Button("설정") { showsSettings = true }
                    }
                }
            }
            .sheet(isPresented: $showsSettings) {
                SettingsView()
            }
    }
}

extension View {
    /// NavigationStack 안 탭 루트 화면에 부착한다(navigationTitle은 뒤로 버튼 라벨용으로 유지).
    func gildongmuTitleMenu() -> some View {
        modifier(GildongmuTitleMenu())
    }
}
```

- [ ] **Step 2: GildongmuApp에 탭별 epoch + refreshTab 배선, resetSession environment 제거**

`GildongmuApp.swift` 수정:

(a) `extension EnvironmentValues`의 `@Entry var resetSession` 블록 전체 삭제(소비처 소멸, TitleMenu.swift의 `refreshTab`이 대체).

(b) struct에 상태 추가(`sessionEpoch` 아래):

```swift
    /// 탭별 새로고침 세대. 해당 탭 콘텐츠만 .id 재생성한다(전체 리셋 sessionEpoch과 별개).
    @State private var chatEpoch = 0
    @State private var searchEpoch = 0
    @State private var nearbyEpoch = 0
```

(c) Tab 콘텐츠에 `.id` 부여:

```swift
                Tab("채팅", systemImage: "message", value: AppTab.chat) { ChatTabView(model: chatModel).id(chatEpoch) }
                Tab("검색", systemImage: "magnifyingglass", value: AppTab.search) { SearchView().id(searchEpoch) }
                Tab("내 주변", systemImage: "location", value: AppTab.nearby) { NearbyHubView().id(nearbyEpoch) }
```

(d) `.environment(\.resetSession, resetSession)` → `.environment(\.refreshTab, refreshCurrentTab)` 교체.

(e) 메서드 추가(`resetSession()` 아래):

```swift
    /// 현재 탭만 초기 상태로(제목 메뉴 "새로고침"): 탭 이동 없음, 해당 탭 epoch만 증가.
    /// 채팅은 진행 중 스트림을 요청째 취소하고 새 대화로 교체한다(idle-reset 불변식 공유).
    private func refreshCurrentTab() {
        switch selectedTab {
        case .chat:
            chatEpoch += 1
            resetChatModel()
        case .search:
            searchEpoch += 1
        case .nearby:
            nearbyEpoch += 1
        }
    }
```

(f) `resetSession()`의 독스트링에서 "제목 탭" 표현을 "유휴 복귀·단축어"로 갱신(제목 버튼 경로 소멸):

```swift
    /// 초기 화면 복귀(유휴 복귀·단축어 공용): 뷰 전체 재생성 + 채팅 탭 복귀.
```

같은 이유로 struct 상단 `sessionEpoch` 주석의 "제목 탭" 언급도 "유휴 복귀·단축어 진입이 공유"로 정리.

- [ ] **Step 3: SearchView에서 principal 버튼 제거 + 메뉴 부착**

`SearchView.swift` 수정:

(a) `@Environment(\.resetSession) private var resetSession` 프로퍼티와 그 주석 삭제.

(b) 기존 toolbar 블록(principal Button)을 삭제하고 `.gildongmuTitleMenu()`로 교체:

```swift
            // navigationTitle은 유지(상세 push 시 뒤로 버튼 라벨 "길동무" 보존),
            // 중앙 표시는 공통 길동무 메뉴가 대체(새로고침·설정).
            .navigationTitle("길동무")
            .navigationBarTitleDisplayMode(.inline)
            .gildongmuTitleMenu()
```

- [ ] **Step 4: ChatTabView·NearbyHubView에 메뉴 부착**

`ChatTabView.swift` — `.navigationBarTitleDisplayMode(.inline)` 다음 줄에:

```swift
            .gildongmuTitleMenu()
```

`NearbyHubView.swift` — `.navigationTitle("내 주변")` 아래에:

```swift
            .navigationBarTitleDisplayMode(.inline)
            .gildongmuTitleMenu()
```

(내 주변은 기존에 displayMode 지정이 없었다. principal 메뉴는 inline 바에서만 자연스러우므로 명시하며, 채팅·검색과 동일값이라 시각 일관성도 유지된다.)

- [ ] **Step 5: 빌드 확인**

Global Constraints의 빌드 명령 실행. Expected: BUILD SUCCEEDED.

- [ ] **Step 6: 커밋**

```bash
git add ios/Gildongmu/TitleMenu.swift ios/Gildongmu/GildongmuApp.swift ios/Gildongmu/SearchView.swift ios/Gildongmu/Chat/ChatTabView.swift ios/Gildongmu/NearbyHubView.swift && git commit -m "feat(ios): 세 탭 공통 길동무 메뉴(새로고침·설정) — 현재 탭만 초기화, 탭 이동 없음" -- ios/Gildongmu/TitleMenu.swift ios/Gildongmu/GildongmuApp.swift ios/Gildongmu/SearchView.swift ios/Gildongmu/Chat/ChatTabView.swift ios/Gildongmu/NearbyHubView.swift
```

---

### Task 4: 리뷰 게이트 + 실기기 배포 + 문서 갱신

**Files:**
- Modify: `PROGRESS.md`(검증 로그 1항목 추가)

**Interfaces:**
- Consumes: Task 1~3의 커밋 전부
- Produces: 없음(게이트·기록)

- [ ] **Step 1: 코드 리뷰 서브에이전트**

`code-reviewer` 서브에이전트로 Task 1~3 diff 리뷰(스펙 대조 포함). 하드 스톱 사안 없으면 지적만 반영.

- [ ] **Step 2: 실기기 배포**

```bash
cd ios && ./deploy-device.sh
```

Expected: 빌드·설치 성공(기기 잠금 시 실행만 실패, 설치는 완료 — 스크립트가 안내).

- [ ] **Step 3: PROGRESS.md 갱신 + 커밋·push**

PROGRESS.md 최신 로그 섹션에 이번 변경(제목 메뉴·탭별 새로고침·테마, 실기기 배포 결과) 1항목 추가 후:

```bash
git add PROGRESS.md && git commit -m "docs(progress): iOS 길동무 메뉴·탭별 새로고침·테마 반영 기록" -- PROGRESS.md
git push
```

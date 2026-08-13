# 안내 중 대안 경로 프리뷰·전환 중립화 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 안내 시트의 상시 경로 전환 버튼을 제거하고, 진행 상황 조망 모달에 "대안 경로 보기" → 프리뷰 시트 → "이 경로 안내로 전환" 흐름을 신설해 추천·최단을 동등 대안으로 중립화한다.

**Architecture:** 순수 iOS UI·모델 재배치(서버 계약 무변). `BeaconModel`에 E10ⓑ proposal과 동형인 토큰(latest-wins) 패턴으로 프리뷰 상태를 추가하고, 채택은 기존 `commitReroutedRoute` 원자 커밋 경로를 재사용한다. 뷰는 `RouteOverviewSheet`의 형제로 프리뷰 시트를 신설(시트 위 시트 문법).

**Tech Stack:** SwiftUI(@Observable BeaconModel), GildongmuKit(RerouteProposalGate 재사용), ios-extra i18n → xcstrings 파이프라인.

**Spec:** `docs/superpowers/specs/2026-08-14-guide-alternative-preview-design.md` (M3 spec `2026-08-12-walk-route-alternatives-design.md` §5 대체분)

## Global Constraints

- 주석·커밋 메시지 한국어, 변수/함수명 영어. 커밋 이메일 `engccer@gmail.com`.
- `git add -A` 금지 — 의도 파일만 명시 stage, 신규 파일은 add 후 pathspec commit(`git commit -- <경로들>`), add와 commit 사이에 다른 도구 호출 금지.
- `Localizable.xcstrings`는 **생성물** — 직접 수정 금지, `ios/i18n/ios-extra/*.json` 수정 후 `node ios/scripts/messages-to-xcstrings.mjs app`으로 재생성.
- 한 줄 = 한 접근성 객체: 조합 문자열은 `joinText`(쉼표 구분), 거리 표기는 `formatDistance`, 낭독 행은 `distanceText` 경유.
- 실시간 안내 계층은 `#if EXPERIMENTAL`(`AppConfig.realtimeGuidanceEnabled`) 게이트 **안**이다 — 새 게이트를 추가하지도, 기존 게이트를 옮기지도 않는다.
- `BeaconModel`은 앱 타깃이라 단위 테스트 레인이 없다(E10ⓑ proposal도 동일) — 검증은 빌드 + 기존 Kit 회귀 + 코드 리뷰 + 실기기. 새 수학이 없으므로 새 Kit 테스트도 없다(신선도는 기존 `RerouteProposalGateTests` 커버).
- 빌드 검증 명령(스킴 불확실 시 `xcodebuild -list -project ios/Gildongmu.xcodeproj`로 확인):
  `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -sdk iphonesimulator -configuration Debug build`

---

### Task 1: i18n — 신규 키 추가 + E10ⓑ 라벨·통지 교체 (6로케일)

**Files:**
- Modify: `ios/i18n/ios-extra/ko.json`, `en.json`, `es.json`, `fr.json`, `it.json`, `ja.json` (각 파일 말미 `"guide"` 블록)
- Regenerate: `ios/Gildongmu/Resources/Localizable.xcstrings`

**Interfaces:**
- Produces: `guide.viewAlternative`·`guide.adoptAlternative`·`guide.altPreviewLoading`·`guide.altPreviewNone`·`guide.altPreviewFailed`·`guide.altPreviewSummary`·`guide.altPreviewTime`·`guide.altPreviewRemaining` 키 (Task 2·4가 `appLocalized`로 소비)
- 주의: 구키 `guide.switchToShortest`·`guide.switchToRecommended`는 **이 태스크에서 지우지 않는다**(사용처가 아직 살아 있다 — Task 4에서 버튼 제거와 동시 삭제).

- [ ] **Step 1: ko.json의 `guide` 블록 갱신**

`ios/i18n/ios-extra/ko.json` 말미 `"guide"` 블록에서 `proposalReady`·`proposalAdopt` 값을 교체하고 신규 키 8개를 추가한다(`switchToShortest`·`switchToRecommended`는 그대로 둔다):

```json
  "guide": {
    "switchedToShortest": "최단 경로로 전환했습니다. 안내 {count}개, 총 {distance}. {first}",
    "switchedToRecommended": "추천 경로로 전환했습니다. 안내 {count}개, 총 {distance}. {first}",
    "proposalReady": "현재 위치 기준 경로가 준비되었습니다. 안내 {count}개, 총 {distance}. {first}",
    "proposalAdopt": "현재 위치부터 다시 안내 시작",
    "switchToShortest": "최단 경로로 전환",
    "switchToRecommended": "추천 경로로 전환",
    "viewAlternative": "대안 경로 보기",
    "adoptAlternative": "이 경로 안내로 전환",
    "altPreviewLoading": "대안 경로 조회 중",
    "altPreviewNone": "대안 경로가 없습니다",
    "altPreviewFailed": "대안 경로 조회에 실패했습니다",
    "altPreviewSummary": "{variant}, 총 {distance}",
    "altPreviewTime": "도보 약 {minutes}분",
    "altPreviewRemaining": "지금 경로 잔여 {distance}"
  }
```

- [ ] **Step 2: 나머지 5로케일 동일 구조 갱신**

각 파일의 이웃 키(기존 `proposalReady`·`rerouteButton` 역문)의 톤을 확인하고 아래 값을 넣는다(명백한 톤 불일치만 조정, 플레이스홀더 이름은 ko와 동일 유지):

en.json:
```json
    "proposalReady": "A route from your current location is ready. {count} steps, total {distance}. {first}",
    "proposalAdopt": "Restart guidance from current location",
    "viewAlternative": "View alternative route",
    "adoptAlternative": "Switch guidance to this route",
    "altPreviewLoading": "Finding alternative route",
    "altPreviewNone": "No alternative route",
    "altPreviewFailed": "Couldn't load the alternative route",
    "altPreviewSummary": "{variant}, total {distance}",
    "altPreviewTime": "about {minutes} min walk",
    "altPreviewRemaining": "current route remaining {distance}"
```

es.json:
```json
    "proposalReady": "La ruta desde tu ubicación actual está lista. {count} pasos, total {distance}. {first}",
    "proposalAdopt": "Reiniciar la guía desde la ubicación actual",
    "viewAlternative": "Ver ruta alternativa",
    "adoptAlternative": "Cambiar la guía a esta ruta",
    "altPreviewLoading": "Buscando ruta alternativa",
    "altPreviewNone": "No hay ruta alternativa",
    "altPreviewFailed": "No se pudo cargar la ruta alternativa",
    "altPreviewSummary": "{variant}, total {distance}",
    "altPreviewTime": "unos {minutes} min a pie",
    "altPreviewRemaining": "ruta actual restante {distance}"
```

fr.json:
```json
    "proposalReady": "Un itinéraire depuis votre position actuelle est prêt. {count} étapes, total {distance}. {first}",
    "proposalAdopt": "Reprendre le guidage depuis la position actuelle",
    "viewAlternative": "Voir l'itinéraire alternatif",
    "adoptAlternative": "Basculer le guidage sur cet itinéraire",
    "altPreviewLoading": "Recherche d'itinéraire alternatif",
    "altPreviewNone": "Aucun itinéraire alternatif",
    "altPreviewFailed": "Échec du chargement de l'itinéraire alternatif",
    "altPreviewSummary": "{variant}, total {distance}",
    "altPreviewTime": "environ {minutes} min à pied",
    "altPreviewRemaining": "itinéraire actuel restant {distance}"
```

it.json:
```json
    "proposalReady": "Un percorso dalla posizione attuale è pronto. {count} indicazioni, totale {distance}. {first}",
    "proposalAdopt": "Riavvia la guida dalla posizione attuale",
    "viewAlternative": "Vedi percorso alternativo",
    "adoptAlternative": "Passa alla guida su questo percorso",
    "altPreviewLoading": "Ricerca percorso alternativo",
    "altPreviewNone": "Nessun percorso alternativo",
    "altPreviewFailed": "Impossibile caricare il percorso alternativo",
    "altPreviewSummary": "{variant}, totale {distance}",
    "altPreviewTime": "circa {minutes} min a piedi",
    "altPreviewRemaining": "percorso attuale rimanente {distance}"
```

ja.json:
```json
    "proposalReady": "現在地からのルートが準備できました。案内{count}件、合計{distance}。{first}",
    "proposalAdopt": "現在地から案内をやり直す",
    "viewAlternative": "代替ルートを見る",
    "adoptAlternative": "このルートの案内に切り替え",
    "altPreviewLoading": "代替ルートを検索中",
    "altPreviewNone": "代替ルートがありません",
    "altPreviewFailed": "代替ルートの取得に失敗しました",
    "altPreviewSummary": "{variant}、合計{distance}",
    "altPreviewTime": "徒歩約{minutes}分",
    "altPreviewRemaining": "現在のルート残り{distance}"
```

- [ ] **Step 3: xcstrings 재생성 + 반영 확인**

Run: `node ios/scripts/messages-to-xcstrings.mjs app && grep -c "altPreviewSummary\|viewAlternative\|adoptAlternative" ios/Gildongmu/Resources/Localizable.xcstrings`
Expected: 스크립트 정상 종료(린터 통과), grep 카운트 ≥ 3

- [ ] **Step 4: 빌드 확인(키 교체가 기존 코드와 무충돌)**

Run: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -sdk iphonesimulator -configuration Debug build 2>&1 | tail -3`
Expected: `BUILD SUCCEEDED`

- [ ] **Step 5: Commit**

```bash
git add ios/Gildongmu/Resources/Localizable.xcstrings
git commit -m "i18n(guide): 대안 경로 프리뷰 키 신설 + E10ⓑ 라벨 '현재 위치부터 다시 안내 시작' 교체

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- ios/i18n/ios-extra/ko.json ios/i18n/ios-extra/en.json ios/i18n/ios-extra/es.json ios/i18n/ios-extra/fr.json ios/i18n/ios-extra/it.json ios/i18n/ios-extra/ja.json ios/Gildongmu/Resources/Localizable.xcstrings
```

---

### Task 2: BeaconModel — 프리뷰 상태·조회·닫힘·헤더

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`

**Interfaces:**
- Consumes: Task 1의 i18n 키, 기존 `RerouteProposal`(Kit)·`fetchDetailData`·`DetailFetchResult`·`appLocalized`·`joinText`·`formatDistance`.
- Produces (Task 3·4가 소비): `enum AlternativePreviewState`(케이스 `idle`/`fetching(token:)`/`ready(RerouteProposal, fetched: DetailFetchResult)`/`noRoute`/`failed`), `private(set) var alternativePreviewState`, `var alternativePreviewAvailable: Bool`, `var alternativePreviewSteps: [String]?`, `func alternativePreviewHeaderText() -> String`, `func openAlternativePreview()`, `func closeAlternativePreview()`, `private func resetAlternativePreview()`.

- [ ] **Step 1: 상태 선언 추가**

`private(set) var hasPreparedProposal = false`(현재 273행) 아래에 추가:

```swift
    // MARK: 대안 경로 프리뷰 상태 (spec 2026-08-14 §3)

    /// 프리뷰 상태 — proposalState와 같은 토큰(latest-wins) 패턴. `noRoute`와
    /// `failed`를 가른다(3-state: "대안 없음"과 "조회 실패"는 다른 사실이다).
    enum AlternativePreviewState {
        case idle
        case fetching(token: Int)
        case ready(RerouteProposal, fetched: DetailFetchResult)
        case noRoute
        case failed
    }
    private(set) var alternativePreviewState: AlternativePreviewState = .idle
    private var alternativePreviewToken = 0
```

- [ ] **Step 2: 노출 조건·스텝 목록 computed 추가**

`routeStepDescriptions`(현재 100행) 아래에 추가:

```swift
    /// 조망 모달 "대안 경로 보기" 노출 조건(spec 2026-08-14 §2): 반대 축이 성립하는
    /// 세션. `shortestVariantAvailable`은 세션 시작 시 최단 세션이면 참으로 강제되므로
    /// (최단 안내 중의 반대 축 = 추천은 항상 성립) 이 플래그 하나가 両방향을 담는다.
    var alternativePreviewAvailable: Bool {
        sessionKind == .walk && mode == .detail && shortestVariantAvailable
    }

    /// 프리뷰 스텝 목록(조망 행 문법 재사용) — ready에서만. "지금 이 구간" 표식은
    /// 없다(대안 경로 위에 현재 위치가 없다 — 근거 없는 표식은 거짓 정밀).
    var alternativePreviewSteps: [String]? {
        guard case .ready(_, let fetched) = alternativePreviewState else { return nil }
        return fetched.route.steps.map(\.description)
    }
```

- [ ] **Step 3: 헤더 문장·열림·닫힘·조회 구현**

`expireProposalIfStale` 함수가 있는 "이탈 시 제안" MARK 섹션 끝에 이어서 추가:

```swift
    // MARK: - 대안 경로 프리뷰 조회·채택 (spec 2026-08-14 §3·§4)

    /// 프리뷰 헤더 문장. 시트 헤더 착지가 낭독하고(조망 선례), 이후 갱신은 조용하다
    /// (조회형 정보). 결과 커밋 시 polite 통지 1회가 완료 신호(fetch 쪽 책임).
    func alternativePreviewHeaderText() -> String {
        switch alternativePreviewState {
        case .idle, .fetching:
            return appLocalized("guide.altPreviewLoading")
        case .noRoute:
            return appLocalized("guide.altPreviewNone")
        case .failed:
            return appLocalized("guide.altPreviewFailed")
        case .ready(_, let fetched):
            // 대안 = 반대 variant의 라벨(조회 화면과 같은 이름 — 다른 이름 금지).
            let label = appLocalized(sessionVariant == nil
                ? "ios.directions.walkShortest" : "ios.directions.walkRecommended")
            let summary = appLocalized(
                "guide.altPreviewSummary", label,
                formatDistance(Int(fetched.route.totalMeters.rounded())))
            let time = fetched.durationSeconds.flatMap { dur in
                dur > 0 ? appLocalized("guide.altPreviewTime", String(max(1, dur / 60))) : nil
            }
            // 잔여·대안 총거리가 둘 다 현위치 기준이라 비교가 성립한다(spec §3).
            // 이탈 중 잔여는 거짓이라 생략(시트 잔여 행과 같은 3-state 근거).
            let remaining: String? = if !offRoute, let route = guideRoute, let state = guideState {
                appLocalized(
                    "guide.altPreviewRemaining",
                    formatDistance(Int(max(0, route.totalMeters - state.d).rounded())))
            } else {
                nil
            }
            return joinText(summary, time, remaining)
        }
    }

    /// 프리뷰 열림 — 열리는 즉시 최신 세션 fix 기준으로 반대 variant를 조회한다.
    /// 출발 전에 받아 둔 대안을 재사용하지 않는 이유: 걷는 중이라 출발점이 낡았다.
    func openAlternativePreview() {
        guard alternativePreviewAvailable, let dest else { return }
        alternativePreviewToken += 1
        let token = alternativePreviewToken
        alternativePreviewState = .fetching(token: token)
        Task { [weak self] in await self?.fetchAlternativePreview(token: token, dest: dest) }
    }

    /// 프리뷰 닫힘 — 진행 중 조회의 도착 응답을 폐기한다(latest-wins, spec §3).
    func closeAlternativePreview() {
        resetAlternativePreview()
    }

    private func resetAlternativePreview() {
        alternativePreviewToken += 1
        alternativePreviewState = .idle
    }

    private func fetchAlternativePreview(token: Int, dest: BeaconDest) async {
        let target: WalkRouteVariant? = sessionVariant == nil ? .shortest : nil
        do {
            let origin = try await LocationService.shared.currentCoordinate()
            // 신선도 기준값은 좌표와 한 쌍(E10ⓑ 동형 — fetch 완료 후 시각을 쓰면
            // 왕복이 긴 만큼 실제보다 신선하게 판정된다).
            let acquiredAt = uptimeNow
            guard token == alternativePreviewToken, isTracking, mode == .detail,
                  self.dest == dest else { return }
            let fetched = try await fetchDetailData(origin: origin, dest: dest, variant: target)
            // 커밋 가드: 닫힘·재열림·세션 변화 후 도착한 응답 폐기(latest-wins).
            guard token == alternativePreviewToken, isTracking, mode == .detail,
                  self.dest == dest else { return }
            guard let fetched else {
                alternativePreviewState = .noRoute
                announce(appLocalized("guide.altPreviewNone"))
                return
            }
            alternativePreviewState = .ready(
                RerouteProposal(originLat: origin.lat, originLng: origin.lng, acquiredAt: acquiredAt),
                fetched: fetched)
            // 완료 신호 polite 1회(nearby 결과 통지 관례) — 헤더는 조용 갱신이라
            // 이 통지가 없으면 결과 도착을 알 길이 없다.
            announce(alternativePreviewHeaderText())
        } catch {
            guard token == alternativePreviewToken else { return }
            alternativePreviewState = .failed
            announce(appLocalized("guide.altPreviewFailed"))
        }
    }
```

- [ ] **Step 4: 수명 리셋 배선**

`clearProposal()`을 호출하는 정리 지점에 `resetAlternativePreview()`를 병기한다. 대상 4곳(현재 행 번호 기준, 밀릴 수 있으니 맥락으로 확인):
- `stop()` 계열 정리 블록(현재 827행 부근, `proposalFetchCount = 0` 옆)
- 세션 해제 정리 블록(현재 878행 부근, `isSwitchingVariant = false` 옆)
- 목적지 변경 정리(현재 1292행 부근, `remainingText = nil` 옆)
- `commitReroutedRoute` 서두(현재 1831행 부근) — 경로 교체는 프리뷰 비교 기준도 무효화한다

각 위치에 한 줄:
```swift
        resetAlternativePreview()
```

⚠ 이탈 복귀 지점(현재 1589행 `clearProposal()`)에는 **추가하지 않는다** — 프리뷰는 이탈과 독립이라 복귀가 프리뷰를 죽일 근거가 없다.

- [ ] **Step 5: 빌드 확인**

Run: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -sdk iphonesimulator -configuration Debug build 2>&1 | tail -3`
Expected: `BUILD SUCCEEDED`

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(guide): 대안 경로 프리뷰 상태·조회 계층 — E10ⓑ 토큰 패턴 동형(latest-wins·3-state)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- ios/Gildongmu/Directions/BeaconModel.swift
```

---

### Task 3: BeaconModel — 채택(신선 즉시·낡음 폴백) + 전환 완료 세대

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`

**Interfaces:**
- Consumes: Task 2의 `alternativePreviewState`·`resetAlternativePreview`, 기존 `RerouteProposalGate.isFresh`·`commitReroutedRoute`·`consumeStepFreeNotice`·`GuideText.variantSwitch`·`requestVariantSwitch`·`performReroute`.
- Produces (Task 4가 소비): `func adoptAlternativePreview()`, `private(set) var variantAdoptedSeq: Int`(채택 성공 세대 — 시트 연쇄 닫힘 트리거).

- [ ] **Step 1: 채택 성공 세대 선언**

Task 2에서 추가한 `private var alternativePreviewToken = 0` 아래에:

```swift
    /// 채택 성공 세대 — 시트(프리뷰·조망)가 onChange로 연쇄 닫힘·포커스 복귀에 쓴다.
    /// 값 자체는 의미 없고 증가가 이벤트다(offRoute onChange 관례의 세대 판).
    private(set) var variantAdoptedSeq = 0
```

- [ ] **Step 2: adoptAlternativePreview 구현**

Task 2의 `fetchAlternativePreview` 아래에 추가:

```swift
    /// 프리뷰 채택(spec 2026-08-14 §4): 신선하면 본 경로를 즉시 채택(왕복 없음 —
    /// "본 것 = 안내받는 것"), 낡았으면 같은 목표 variant로 현위치 재조회에 조용히
    /// 폴백(requestVariantSwitch 재사용, 진행 신호는 isSwitchingVariant 라벨 병기).
    func adoptAlternativePreview() {
        guard case .ready(let proposal, let fetched) = alternativePreviewState,
              !rerouteInFlight else { return }
        let target: WalkRouteVariant? = sessionVariant == nil ? .shortest : nil
        if let c = lastFixCoord, let at = lastFixCoordAt, uptimeNow - at <= 15,
           RerouteProposalGate.isFresh(
               proposal, nowUptime: uptimeNow, currentLat: c.lat, currentLng: c.lng) {
            // 전환 커밋: 경로 교체와 같은 원자 블록에서만 variant가 바뀐다
            // (performReroute 동형 — commitReroutedRoute가 프리뷰도 함께 리셋).
            sessionVariant = target
            let firstIndices = commitReroutedRoute(fetched)
            let notice = consumeStepFreeNotice(
                fetched.stepFreeRaw, fetched.stepFree, fetched.stepFreeNotice)
            let summary = GuideText.variantSwitch(
                route: fetched.route, firstIndices: firstIndices, shortest: target == .shortest)
            let text = notice.map { "\($0) \(summary)" } ?? summary
            statusText = text
            // `.high`: 채택 성공으로 시트가 닫히고 포커스가 중지 버튼으로 옮겨가며
            // 그 라벨 낭독에 기본 우선순위가 잠식된다(adoptProposal 동형).
            if !announce(text, highPriority: true), let notice { pendingStepFreeNotice = notice }
            variantAdoptedSeq += 1
            return
        }
        // 낡음 폴백: 프리뷰는 열린 채 두고(실패 시 사용자가 상태를 본다) 재조회.
        // 성공하면 performReroute가 variantAdoptedSeq를 올려 시트가 닫힌다.
        requestVariantSwitch()
    }
```

- [ ] **Step 3: performReroute 전환 성공에 세대 증가 연결**

`performReroute`의 성공 발화 직후(현재 1816행 `if !announce(text, highPriority: true), let notice { pendingStepFreeNotice = notice }` 다음)에 추가:

```swift
            // 전환 성공은 채택 완료 세대를 올린다(프리뷰 낡음 폴백 경로 포함 —
            // 시트 연쇄 닫힘 트리거. keepVariant 재조회는 시트 밖 버튼이라 무관).
            if case .switchTo = intent { variantAdoptedSeq += 1 }
```

- [ ] **Step 4: 빌드 확인**

Run: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -sdk iphonesimulator -configuration Debug build 2>&1 | tail -3`
Expected: `BUILD SUCCEEDED`

- [ ] **Step 5: Kit 회귀(신선도 게이트 재사용 확인)**

Run: `cd ios/GildongmuKit && swift test --filter RerouteProposalGateTests && cd ../..`
Expected: 전 케이스 PASS(변경 없음 — 재사용만)

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(guide): 프리뷰 채택 — 신선 즉시 커밋·낡음 현위치 폴백, 전환 완료 세대 신설

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- ios/Gildongmu/Directions/BeaconModel.swift
```

---

### Task 4: UI — 시트 전환 버튼 제거 + 조망 진입점 + 프리뷰 시트

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconTrackingSheet.swift`
- Modify: `ios/i18n/ios-extra/*.json` 6개(구키 제거) + `ios/Gildongmu/Resources/Localizable.xcstrings` 재생성

**Interfaces:**
- Consumes: Task 2·3의 `alternativePreviewAvailable`·`alternativePreviewState`·`alternativePreviewSteps`·`alternativePreviewHeaderText()`·`openAlternativePreview()`·`closeAlternativePreview()`·`adoptAlternativePreview()`·`variantAdoptedSeq`·기존 `isSwitchingVariant`.
- Produces: `AlternativeRoutePreviewSheet`(같은 파일 private — 외부 소비자 없음).

- [ ] **Step 1: 안내 시트의 수동 전환 버튼 제거**

`BeaconTrackingSheet.swift` 106~123행의 수동 전환 블록 전체 삭제(주석 포함):

```swift
                // 수동 전환(M3 spec §5): 반대 variant로 현위치 재조회. 정상 추종
                // ...
                if model.sessionKind == .walk, model.mode == .detail,
                   model.shortestVariantAvailable {
                    let target = appLocalized(model.sessionVariant == nil
                        ? "guide.switchToShortest" : "guide.switchToRecommended")
                    Button(model.isSwitchingVariant
                        ? joinText(target, appLocalized("ios.directions.searching"))
                        : target
                    ) {
                        model.requestVariantSwitch()
                    }
                }
```

삭제 자리에 한 줄 주석만 남긴다:

```swift
                // 수동 전환 버튼은 폐기(spec 2026-08-14 §1 — 상시 노출이 경로 변경
                // 압박으로 읽힘). 전환 진입점은 진행 상황 조망의 프리뷰다(§2).
```

- [ ] **Step 2: 채택 성공 시 시트 연쇄 닫힘·포커스 복귀**

`BeaconTrackingSheet`의 `.onChange(of: model.offRoute)`(현재 234행 부근) 아래에 추가:

```swift
        // 프리뷰 채택 성공: 조망(과 그 위 프리뷰)을 닫고 중지 버튼으로 복귀(spec
        // 2026-08-14 §4 — 포커스를 쥔 시트가 통째로 사라지는 전이, 재조회 성공 동형).
        .onChange(of: model.variantAdoptedSeq) {
            showRouteList = false
            Task { await landStopFocus() }
        }
```

- [ ] **Step 3: RouteOverviewSheet에 "대안 경로 보기" + 프리뷰 시트 표시**

`RouteOverviewSheet`에 상태를 추가하고:

```swift
    /// 대안 경로 프리뷰(spec 2026-08-14 §3) — 시트 위 시트(조망과 같은 문법).
    @State private var showAltPreview = false
```

body의 말미 닫기 버튼(`Button(appLocalized("actions.close")) { dismiss() }` — Section 안 마지막) **바로 앞**에 추가:

```swift
                // 대안 경로 보기(spec 2026-08-14 §2): 스텝 목록 뒤·말미 닫기 앞 —
                // 조망의 주 목적(진행 확인)을 밀지 않으면서 "조망하다 대안 탐색"
                // 흐름과 읽기 순서가 일치한다. 노출은 반대 축 성립 세션만(죽은 버튼 금지).
                if model.alternativePreviewAvailable {
                    Button(appLocalized("guide.viewAlternative")) {
                        model.openAlternativePreview()
                        showAltPreview = true
                    }
                }
```

`List`에(기존 수식어 자리) 추가:

```swift
        .sheet(isPresented: $showAltPreview) { AlternativeRoutePreviewSheet(model: model) }
        // 닫힘(스와이프·VO escape 포함) 시 진행 중 조회 폐기 — 늦은 응답이 닫힌
        // 화면 상태를 되살리지 않는다(spec 2026-08-14 §3 latest-wins). 도착 전이는
        // 부모(showRouteList=false)가 이 시트까지 연쇄 소거한다.
        .onChange(of: showAltPreview) { _, presented in
            if !presented { model.closeAlternativePreview() }
        }
```

- [ ] **Step 4: AlternativeRoutePreviewSheet 신설**

같은 파일 말미(RouteOverviewSheet 아래)에 추가:

```swift
/// 대안 경로 미리 보기(spec 2026-08-14 §3·§4). 헤더(요약·비교) → 전환 버튼 →
/// 스텝 행 → 말미 닫기. 시스템 헤더 착지가 요약을 낭독하고(조망 선례), 결과 도착은
/// 모델의 polite 통지 1회가 알린다(헤더는 조용 갱신 — 조회형 정보). 전환 버튼이
/// 헤더 다음 한 스와이프인 이유: 이 화면의 결정 행동이고, 사용자가 능동적으로 연
/// 화면이라 압박 문제가 없다(spec §0-1의 압박은 "걷는 내내 상시 노출"이었다).
private struct AlternativeRoutePreviewSheet: View {
    let model: BeaconModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Section {
                // 전환은 ready에서만(조회 중·실패에 죽은 버튼 금지). 낡음 폴백
                // 재조회 중엔 라벨 병기(한 줄 = 한 객체, 쉼표).
                if case .ready = model.alternativePreviewState {
                    Button(model.isSwitchingVariant
                        ? joinText(appLocalized("guide.adoptAlternative"),
                                   appLocalized("ios.directions.searching"))
                        : appLocalized("guide.adoptAlternative")
                    ) {
                        model.adoptAlternativePreview()
                    }
                }
                if let steps = model.alternativePreviewSteps {
                    // "지금 이 구간" 표식 없음 — 대안 경로 위에 현재 위치가 없다.
                    ForEach(Array(steps.enumerated()), id: \.offset) { i, desc in
                        distanceText(appLocalized("ios.guide.routeListRow", String(i + 1), desc))
                    }
                }
                Button(appLocalized("actions.close")) { dismiss() }
            } header: {
                distanceText(model.alternativePreviewHeaderText())
                    .accessibilityAddTraits(.isHeader)
            }
        }
    }
}
```

- [ ] **Step 5: 구키 제거 + xcstrings 재생성**

6로케일 파일 전부에서 `guide.switchToShortest`·`guide.switchToRecommended` 두 줄을 제거하고(이제 사용처 0 — Step 1이 지웠다), 재생성:

Run: `node ios/scripts/messages-to-xcstrings.mjs app && grep -c "switchToShortest" ios/Gildongmu/Resources/Localizable.xcstrings || echo "removed"`
Expected: `removed`(0건) — `switchedToShortest`(성공 통지)는 남아 있어야 하므로 `grep -c "switchedToShortest"`가 ≥1인지 함께 확인

- [ ] **Step 6: 빌드 + 시뮬 스모크**

Run: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -sdk iphonesimulator -configuration Debug build 2>&1 | tail -3`
Expected: `BUILD SUCCEEDED`

시뮬 실행 스모크(선택 — 안내 세션은 위치 시뮬레이션이 필요해 프리뷰까지는 실기기 몫): `xcodebuildmcp-cli` 스킬의 `simulator build-and-run`으로 기동 크래시만 확인.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(guide): 안내 시트 전환 버튼 제거, 조망 경유 대안 경로 프리뷰·전환 신설

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- ios/Gildongmu/Directions/BeaconTrackingSheet.swift ios/i18n/ios-extra/ko.json ios/i18n/ios-extra/en.json ios/i18n/ios-extra/es.json ios/i18n/ios-extra/fr.json ios/i18n/ios-extra/it.json ios/i18n/ios-extra/ja.json ios/Gildongmu/Resources/Localizable.xcstrings
```

---

### Task 5: 문서 분배 + spec 검증 절 정합

**Files:**
- Modify: `docs/superpowers/specs/2026-08-14-guide-alternative-preview-design.md` (§6 첫 불릿)
- Modify: `CHANGELOG.md` (최신 날짜 항목 추가, 기존 형식 준수)
- Modify: `docs/BACKLOG.md` (실보행 판정 항목 추가 — `grep -n "실보행" docs/BACKLOG.md`로 F-a 계열 섹션 위치 확인)
- Modify: `~/Mac-Projects/PORTS.md` (gildongmu M3 웹 후속 행 갱신)

**Interfaces:** 없음(문서만).

- [ ] **Step 1: spec §6 첫 불릿을 검증 현실에 맞게 교체**

기존:
```
- **게이트 테스트**: 프리뷰 수명(닫힘 폐기·신선도 폴백·채택 커밋·실패 시 세션 불변), 노출 조건(추천 중 최단 축 부재 미노출·car 미노출), 라벨 교체 반영(준비됨 라벨·통지 문구).
```
교체:
```
- **게이트 검증**: 신선도 수학은 기존 `RerouteProposalGateTests`가 커버한다(재사용 — 신규 수학 없음). 프리뷰 수명(닫힘 폐기·채택 커밋·실패 시 세션 불변)과 노출 조건은 검증된 proposal 토큰·커밋 패턴 재사용 + 코드 리뷰로 확인한다 — `BeaconModel`은 앱 타깃이라 단위 테스트 레인이 없고 E10ⓑ 제안 수명도 같은 방식으로 검증했다(관례 동형). i18n 키·라벨 교체는 xcstrings 재생성 파이프라인 린터가 강제한다.
```

- [ ] **Step 2: CHANGELOG 항목 추가**

`CHANGELOG.md` 최신 날짜 블록에(형식은 기존 항목 준수, 2~4줄):

```markdown
- **안내 중 대안 경로 프리뷰·전환 중립화 (iOS)**: 안내 시트의 상시 전환 버튼 제거(경로 변경 압박 해소), 진행 상황 조망에 "대안 경로 보기" → 현위치 기준 프리뷰(요약·잔여 비교·스텝) → "이 경로 안내로 전환"(신선 즉시 채택·낡음 재조회 폴백). E10ⓑ 라벨은 "현재 위치부터 다시 안내 시작"으로 교체. spec `docs/superpowers/specs/2026-08-14-guide-alternative-preview-design.md`
```

- [ ] **Step 3: BACKLOG 실보행 판정 항목 추가**

실보행 판정(F-a 계열) 목록에 추가:

```markdown
- 대안 경로 프리뷰(2026-08-14 spec): 전환 연속성(끊김 없는 이어가기)·비교 문장 낭독·전환 후 중지 버튼 포커스 복귀·프리뷰 헤더 착지 낭독. 등굣길 코스.
```

- [ ] **Step 4: PORTS.md gildongmu 행 갱신**

`~/Mac-Projects/PORTS.md`의 gildongmu 앞 open 항목 중 "M3 도보 경로 대안 **웹 UI** 후속" 행 끝에 덧붙인다:

```
전환 UI 정본은 2026-08-14 spec으로 개정(안내 시트 전환 버튼 없음 — 진행 상황 조망 경유 프리뷰·채택. 웹도 이 설계로 간다).
```

- [ ] **Step 5: Commit(両repo)**

```bash
git commit -m "docs(guide): 대안 경로 프리뷰 마일스톤 분배 — CHANGELOG·BACKLOG 실보행 판정·spec §6 검증 정합

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- docs/superpowers/specs/2026-08-14-guide-alternative-preview-design.md CHANGELOG.md docs/BACKLOG.md
```

⚠ gildongmu push는 여기서 하지 않는다 — 리뷰 게이트(Task 6) 통과 후 일괄 push(리뷰 통과가 push 선행조건).

PORTS.md는 워크스페이스 루트 소관: `git -C ~/Mac-Projects status --short PORTS.md`로 추적 여부 확인 후, 추적 repo면 같은 요령으로 pathspec 커밋(메시지: `docs(ports): gildongmu M3 웹 후속 행을 2026-08-14 프리뷰 spec으로 개정`).

---

### Task 6: a11y 점검 + 실기기 배포

**Files:** 없음(점검·배포).

- [ ] **Step 1: a11y-auditor 서브에이전트 점검**

a11y-auditor에게 diff 범위(`BeaconTrackingSheet.swift`)를 주고 점검 — 중점: 프리뷰 시트의 헤더 착지·한 줄 = 한 객체(스텝 행·버튼 라벨 병기)·죽은 버튼 부재·포커스 복귀 계약. 지적은 헌장·spec과 대조 후 반영(아키텍처 대조 우선 — 즉시 지엽 패치 금지).

- [ ] **Step 2: 리뷰 게이트 통과 후 push**

```bash
git push
```

- [ ] **Step 3: 실기기 Experimental 배포**

전 변경이 `#if EXPERIMENTAL` 게이트 안이므로 실험판만 배포한다(공식판 바이너리는 동작 무변 — i18n 키 추가는 무해):

```bash
CONFIGURATION=Experimental ./ios/deploy-device.sh
```

⚠ 병렬 세션이 도는 중이면 배포 직전 사용자에게 알린다([[parallel-sessions-device-deploy-coordination]] — 같은 실험판 덮어쓰기 방지).

- [ ] **Step 4: 완료 보고**

DONE 보고에 포함: 실보행 판정 항목은 BACKLOG 이월(위원장 실사용 몫 — 등굣길 코스), 시뮬로는 프리뷰 상호작용 검증 불가(안내 세션에 위치 시뮬레이션 필요)했다는 검증 한계.

# A16 L2·L3 구현 계획 — 관측되지 않는 잠금의 탈출구

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` 또는 `superpowers:executing-plans`로 task 단위 실행. 체크박스로 진행을 추적한다.

**Goal:** 잠근 차량이 한 번도 관측되지 않는 상태에 시간 상한과 탈출구를 만들어, 무한 침묵을 정직한 발화와 재잠금 경로로 바꾼다.

**Architecture:** 판정은 웹 `transit-guide.ts`가 정본이고 Kit이 1:1 미러이며 공유 fixture가 동조를 강제한다. 탈출구(역 재선택)는 Kit 계약 밖 앱 계층에만 산다 — 상태 머신은 조회 대상 역을 모르기 때문이다.

**Tech Stack:** TypeScript(Vitest) · Swift(Swift Testing) · SwiftUI · next-intl

**Spec:** `docs/superpowers/specs/2026-08-16-transit-guide-never-seen-escape-design.md`

## Global Constraints

- 판정 상수 `NEVER_SEEN_MS` / `transitNeverSeenMs` = **600_000**(10분). **잠정값이며 실승차 판정 대상**이라 주석에 그 사실을 남긴다.
- 웹↔Kit은 **1:1 미러**다. 한쪽만 바꾸면 공유 fixture가 실패해야 정상이다.
- 커밋은 `git commit -- <경로>` pathspec 모드로만. `git add -A` 금지.
- 통지 문구에 꼬리 문장("잠시 후 다시 시도해 주세요" 계열) 금지. 행동 경로를 알리는 문장은 유지 대상이다.
- i18n 키 추가는 **6개 로케일 전부**(`messages/{ko,en,es,fr,it,ja}.json`) + iOS 카탈로그.
- 게이트: `npm run test:run` · `npx tsc --noEmit` · `npm run lint` 전부 error 0 유지.

---

### Task 1: 웹 판정 계층 + 공유 fixture (L2 정본)

**Files:**
- Modify: `src/lib/__tests__/fixtures/transit-guide-scenarios.json`
- Modify: `src/lib/transit-guide.ts`
- Test: `src/lib/__tests__/transit-guide.test.ts`(기존 러너가 fixture를 순회하므로 파일 수정 불요)

**Interfaces:**
- Produces: `TransitSignal`에 `"neverSeen"` 추가 · `TransitGuideEvent`에 `{ kind: "neverSeen" }` 추가 · `TransitGuideState.ridingSince: number | null` · `export const NEVER_SEEN_MS = 600_000`

- [ ] **Step 1: fixture에 시나리오 3종 추가**

`scenarios` 배열 끝에 아래를 추가한다. `route`는 기존 `subwaySingle`, `lock`은 기존 `subway5696`을 재사용한다.

```json
{
 "name": "미관측 시한 경과 → neverSeen 1회(반복 발화 없음)",
 "route": "subwaySingle",
 "steps": [
  { "at": 0, "input": { "kind": "board", "lock": "subway5696" },
    "expect": { "phase": "riding", "signal": "notYetVisible", "event": { "kind": "boarded", "legIndex": 0 } } },
  { "at": 300000, "input": { "kind": "poll", "seq": 1, "phaseGen": 1, "poll": { "kind": "empty" } },
    "expect": { "phase": "riding", "signal": "notYetVisible", "event": null } },
  { "at": 600000, "input": { "kind": "poll", "seq": 2, "phaseGen": 1, "poll": { "kind": "empty" } },
    "expect": { "phase": "riding", "signal": "neverSeen", "event": { "kind": "neverSeen" } } },
  { "at": 660000, "input": { "kind": "poll", "seq": 3, "phaseGen": 1, "poll": { "kind": "empty" } },
    "expect": { "phase": "riding", "signal": "neverSeen", "event": null } }
 ]
},
{
 "name": "시한 전 첫 관측이면 neverSeen은 영영 발화하지 않는다",
 "route": "subwaySingle",
 "steps": [
  { "at": 0, "input": { "kind": "board", "lock": "subway5696" },
    "expect": { "phase": "riding", "signal": "notYetVisible", "event": { "kind": "boarded", "legIndex": 0 } } },
  { "at": 300000, "input": { "kind": "poll", "seq": 1, "phaseGen": 1, "poll": { "kind": "ok", "items": [
     { "vehicleId": "5696", "direction": "하행", "message": "[5]번째 전역 (신길)", "remainingStops": 5,
       "destinationName": "하남검단산", "express": false, "arrivalCode": "99" } ] } },
    "expect": { "phase": "riding", "signal": "tracking", "event": { "kind": "trackingStarted", "remaining": 5 } } },
  { "at": 900000, "input": { "kind": "poll", "seq": 2, "phaseGen": 1, "poll": { "kind": "empty" } },
    "expect": { "phase": "riding", "signal": "notYetVisible", "event": null } },
  { "at": 960000, "input": { "kind": "poll", "seq": 3, "phaseGen": 1, "poll": { "kind": "empty" } },
    "expect": { "phase": "riding", "signal": "notYetVisible", "event": null } },
  { "at": 1020000, "input": { "kind": "poll", "seq": 4, "phaseGen": 1, "poll": { "kind": "empty" } },
    "expect": { "phase": "riding", "signal": "signalLost", "event": { "kind": "signalLost" } } }
 ]
},
{
 "name": "upstreamFailed 중 시한 경과는 neverSeen으로 덮지 않는다",
 "route": "subwaySingle",
 "steps": [
  { "at": 0, "input": { "kind": "board", "lock": "subway5696" },
    "expect": { "phase": "riding", "signal": "notYetVisible", "event": { "kind": "boarded", "legIndex": 0 } } },
  { "at": 60000, "input": { "kind": "poll", "seq": 1, "phaseGen": 1, "poll": { "kind": "failed" } },
    "expect": { "signal": "notYetVisible", "event": null } },
  { "at": 120000, "input": { "kind": "poll", "seq": 2, "phaseGen": 1, "poll": { "kind": "failed" } },
    "expect": { "signal": "notYetVisible", "event": null } },
  { "at": 180000, "input": { "kind": "poll", "seq": 3, "phaseGen": 1, "poll": { "kind": "failed" } },
    "expect": { "signal": "upstreamFailed", "event": { "kind": "upstreamFailed" } } },
  { "at": 900000, "input": { "kind": "poll", "seq": 4, "phaseGen": 1, "poll": { "kind": "failed" } },
    "expect": { "signal": "upstreamFailed", "event": null } }
 ]
}
```

⚠ 세 번째 시나리오의 마지막 스텝이 핵심이다 — 시한(600s)을 훌쩍 넘겼지만 폴이 계속 `failed`라 `neverSeen` 경로에 도달하지 않아야 한다.

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm run test:run -- transit-guide`
Expected: FAIL — 첫 시나리오가 `signal` 기대 `neverSeen` vs 실제 `notYetVisible`.

- [ ] **Step 3: 타입·상수 추가**

`src/lib/transit-guide.ts`:

```ts
export type TransitSignal =
  | "tracking"
  | "notYetVisible"
  | "neverSeen"
  | "signalLost"
  | "upstreamFailed"
  | "untrackable";
```

`TransitGuideEvent` union에 `| { kind: "neverSeen" }` 추가.

`TransitGuideState`에 필드 추가(`trackingAnnounced` 아래):

```ts
  /** riding 진입 시각(ms). 한 번도 관측되지 않은 채 NEVER_SEEN_MS를 넘기면 neverSeen. */
  ridingSince: number | null;
```

`MISS_LOST_COUNT` 근처에 상수 추가:

```ts
/**
 * 첫 관측 전 미등장 상한(§3.1). 시간 기반인 이유: 화면 잠금 중 폴 타이머가 멎으면
 * 횟수 기반은 화면을 끌수록 시한이 늦게 온다(실측 35분/11폴).
 * ⚠ 10분은 잠정값 — 실승차 판정 대상(BACKLOG A16).
 */
export const NEVER_SEEN_MS = 600_000;
```

- [ ] **Step 4: 상태 초기화·전이에 `ridingSince` 배선**

초기 상태 생성부(약 433행 `trackingAnnounced: false` 인접)에 `ridingSince: null` 추가. `handleChangeBoarding`의 리셋 블록(약 515행)에도 `ridingSince: null` 추가.

`transitGuideStep`의 `case "board"`가 `now`를 넘기도록 고치고:

```ts
    case "board":
      return handleBoard(state, input.lock, now);
```

`handleBoard` 시그니처와 반환에 반영:

```ts
function handleBoard(state: TransitGuideState, lock: TransitLock, now: number): TransitStepResult {
```

그 반환 객체의 `trackingAnnounced: false` 옆에 `ridingSince: now,`를 추가한다.

`handleAdvance`가 다음 leg를 `waiting`으로 넘기는 자리에도 `ridingSince: null`을 추가한다(다음 leg 탑승 시 `handleBoard`가 새로 채운다).

- [ ] **Step 5: 판정 추가**

`handlePoll`의 미등장 조기 반환 블록(약 627~634행)을 아래로 교체:

```ts
  if (!next.trackingAnnounced) {
    // 아직 한 번도 관측 전: 정상 미등장(도착 API는 근접 차량만 담는다, §5.2).
    if (next.signal !== "upstreamFailed" && next.signal !== "signalLost") {
      next.signal = "notYetVisible";
    }
    next.lastUpdatedAt = now;
    // 그러나 그 상태를 빠져나오는 문이 있어야 한다(A16 L2). upstreamFailed·
    // signalLost는 원인이 다르고 이미 자기 통지를 냈으므로 덮지 않는다.
    if (
      next.signal !== "neverSeen" &&
      next.phase === "riding" &&
      next.ridingSince != null &&
      now - next.ridingSince >= NEVER_SEEN_MS
    ) {
      next.signal = "neverSeen";
      return { state: next, event: { kind: "neverSeen" } };
    }
    return { state: next, event };
  }
```

`eventProfile`의 `case "signalLost"` 계열에 `neverSeen`을 함께 넣는다(`{ interrupt: false, tone: "weak" }`).

- [ ] **Step 6: 테스트 통과 확인**

Run: `npm run test:run -- transit-guide` → PASS
Run: `npx tsc --noEmit` → error 0 (union 확장으로 소비자 switch 누락이 드러나면 여기서 잡힌다)

- [ ] **Step 7: 커밋**

```bash
git commit -m "feat(transit-guide): 첫 관측 전 미등장에 시간 상한(neverSeen) — 웹 정본

무한 침묵의 기제는 조기 반환이 missCount 증가를 건너뛰어
signalLost 임계에 도달할 산술적 경로가 없던 것이다.

시간 기반인 근거: 실측 35분에 폴 11회(주기 60초면 35회).
화면 잠금 중 타이머 정지가 유력하고, 횟수 기반이면 화면을
끌수록 시한이 늦게 온다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" -- src/lib/transit-guide.ts src/lib/__tests__/fixtures/transit-guide-scenarios.json
```

---

### Task 2: Kit 미러

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/TransitGuide.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/TransitGuideTests.swift`(러너 수정 불요 — 같은 fixture를 읽는다)

**Interfaces:**
- Consumes: Task 1의 fixture 시나리오 3종
- Produces: `TransitSignal.neverSeen` · `TransitGuideEvent.neverSeen` · `TransitGuideState.ridingSince: Double?` · `public let transitNeverSeenMs: Double = 600_000`

- [ ] **Step 1: 테스트 실행해 실패 확인**

Run: `cd ios/GildongmuKit && swift test --filter TransitGuideTests`
Expected: FAIL — fixture가 기대하는 `neverSeen`이 Kit에 없다.

- [ ] **Step 2: 타입·상수·상태 추가**

```swift
public enum TransitSignal: String, Sendable {
    case tracking, notYetVisible, neverSeen, signalLost, upstreamFailed, untrackable
}
```

`TransitGuideEvent`에 `case neverSeen` 추가.

`TransitGuideState`에 `trackingAnnounced` 아래로:

```swift
    /// riding 진입 시각(ms). 한 번도 관측되지 않은 채 상한을 넘기면 neverSeen.
    public var ridingSince: Double?
```

⚠ `TransitGuideState`는 `public struct`라 **메모버와이즈 이니셜라이저를 쓰는 모든 호출부가 깨진다.** 컴파일 오류를 따라가 초기 상태 생성부(약 404행)와 앱 측 생성부를 모두 채운다.

상수(213~218행 블록):

```swift
/// 첫 관측 전 미등장 상한(§3.1). ⚠ 10분은 잠정 — 실승차 판정 대상(BACKLOG A16).
public let transitNeverSeenMs: Double = 600_000
```

- [ ] **Step 3: 전이 배선**

`transitGuideStep`의 `case let .board(lock)`을 `handleBoard(state, lock: lock, now: now)`로 바꾸고 `handleBoard`에 `now: Double` 인자를 추가한다. 그 함수의 `next.trackingAnnounced = false` 옆에 `next.ridingSince = now`.

`handleChangeBoarding`과 `handleAdvance`의 리셋 블록에 `next.ridingSince = nil`.

- [ ] **Step 4: 판정 추가**

`handlePoll`의 미등장 블록(588~594행)을 교체:

```swift
    if !next.trackingAnnounced {
        if next.signal != .upstreamFailed, next.signal != .signalLost {
            next.signal = .notYetVisible
        }
        next.lastUpdatedAt = now
        // 그 상태를 빠져나오는 문(A16 L2) — 웹 transit-guide.ts 미러.
        if next.signal != .neverSeen, next.phase == .riding,
           let since = next.ridingSince, now - since >= transitNeverSeenMs {
            next.signal = .neverSeen
            return (next, .neverSeen)
        }
        return (next, event)
    }
```

`transitEventProfile`의 `case .signalLost, .upstreamFailed:`를 `case .signalLost, .upstreamFailed, .neverSeen:`으로 확장.

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd ios/GildongmuKit && swift test --filter TransitGuideTests` → PASS

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(transit-guide): Kit 미러 — neverSeen 판정

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" -- ios/GildongmuKit/Sources/GildongmuKit/TransitGuide.swift
```

---

### Task 3: 문구 4키 (6로케일 + iOS 카탈로그)

**Files:**
- Modify: `messages/ko.json` · `en.json` · `es.json` · `fr.json` · `it.json` · `ja.json`
- Modify: iOS 문자열 카탈로그(변환 파이프라인 경유 — `ios/` 하위 생성 절차를 따른다)
- Test: `src/lib/__tests__/i18n-messages.test.ts`(키 일관성 게이트, 수정 불요)

**Interfaces:**
- Produces: `transitGuide.neverSeen` · `transitGuide.stateNeverSeen` · `transitGuide.stateRidingNotYetVisible` · `transitGuide.reboardStationPrompt` · `transitGuide.reboardStationCancel`

- [ ] **Step 1: ko 문구 추가**

`messages/ko.json`의 `transitGuide` 블록(`signalLost` 인접):

```json
"neverSeen": "탑승하신 차량을 찾지 못하고 있습니다. 다른 차량을 타셨다면 탑승 변경을 눌러 주세요.",
"stateNeverSeen": "차량 확인 안 됨.",
"stateRidingNotYetVisible": "차량 위치 확인 중.",
"reboardStationPrompt": "지금 어느 역에 계신가요?",
"reboardStationCancel": "탑승 변경 취소",
```

⚠ 버스 leg도 같은 문자열을 쓰므로 어휘는 "차량"으로 중립화한다(기존 `signalLost`가 이미 그렇다).

- [ ] **Step 2: 나머지 5로케일 추가**

en 예시(나머지는 같은 의미로):

```json
"neverSeen": "We can't find the vehicle you boarded. If you took a different one, use Change boarding.",
"stateNeverSeen": "Vehicle not confirmed.",
"stateRidingNotYetVisible": "Locating vehicle.",
"reboardStationPrompt": "Which stop are you at now?",
"reboardStationCancel": "Cancel change boarding",
```

- [ ] **Step 3: i18n 게이트 실행**

Run: `npm run test:run -- i18n-messages`
Expected: PASS (6로케일 키 집합 동일)

- [ ] **Step 4: iOS 카탈로그 반영 후 빌드 확인**

`[[gildongmu-ios-i18n-architecture]]`의 변환 절차를 따른다. ⚠ 수기 편집분 소멸 함정이 있으니 변환 후 새 키 5개가 실제로 들어갔는지 확인한다.

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(i18n): A16 탈출구 문구 5키 6로케일

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" -- messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json messages/ja.json
```

---

### Task 4: iOS 표시·통지 배선 (L2가 사용자에게 도달)

**Files:**
- Modify: `ios/Gildongmu/Directions/TransitGuideModel.swift`(신호→문구 매핑 약 706행, 이벤트→통지 매핑)

**Interfaces:**
- Consumes: Task 2의 `.neverSeen`, Task 3의 문구 키

- [ ] **Step 1: 신호→표시 문구 매핑 확장**

706행 인접의 `switch`에 추가하고, `notYetVisible`을 국면으로 가른다:

```swift
        case .neverSeen: appLocalized("transitGuide.stateNeverSeen")
        case .notYetVisible:
            state.phase == .riding
                ? appLocalized("transitGuide.stateRidingNotYetVisible")
                : appLocalized("transitGuide.stateNotYetVisible")
```

⚠ 이 함수가 `state`를 받지 않는 형태라면 국면을 인자로 넘기도록 시그니처를 넓힌다. **"차량 접근 대기"가 승차 중에 뜨는 것이 결함의 일부**이므로 이 분기를 생략하지 않는다.

- [ ] **Step 2: 이벤트→통지 배선**

이벤트 처리 `switch`에 `case .neverSeen:`을 더해 `transitGuide.neverSeen`을 **기본 우선순위**로 통지한다. ⚠ `.high`가 아닌 근거는 spec §3.4에 있다(자기 소멸 버튼 없음·포커스 이동 없음이라 잠식 패턴 미해당).

- [ ] **Step 3: 빌드 확인**

Run: `CONFIGURATION=Debug xcodebuild -scheme Gildongmu -destination 'generic/platform=iOS' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(ios): neverSeen 통지·표시 + 승차 중 미등장 어휘 분리

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" -- ios/Gildongmu/Directions/TransitGuideModel.swift
```

---

### Task 5: iOS 역 재선택 (L3 탈출구)

**Files:**
- Modify: `ios/Gildongmu/Directions/TransitGuideModel.swift`
- Modify: `ios/Gildongmu/Directions/TransitTrackingSheet.swift`(`phaseControls` 약 282~302행)

**Interfaces:**
- Consumes: Task 3의 `reboardStationPrompt`·`reboardStationCancel`
- Produces: `TransitGuideModel.reboardPickerActive: Bool` · `boardOverrideName: String?` · `func beginReboard()` · `func changeBoarding(at stationName: String)` · `func cancelReboard()`

- [ ] **Step 1: 모델에 상태·액션 추가**

```swift
    /// 탑승 변경 시 사용자가 고른 현재 역(§3.2). nil이면 leg 원래 승차역.
    private(set) var boardOverrideName: String?
    /// 역 선택 단계 표시 여부.
    private(set) var reboardPickerActive = false

    func beginReboard() { reboardPickerActive = true }

    func cancelReboard() { reboardPickerActive = false }

    func changeBoarding(at stationName: String) {
        boardOverrideName = stationName
        reboardPickerActive = false
        changeBoarding()
    }
```

`board`(재잠금 성공)·`advance`·세션 종료 지점에서 `boardOverrideName = nil`로 되돌린다. ⚠ 되돌리지 않으면 다음 leg가 엉뚱한 역을 조회한다.

- [ ] **Step 2: 조회 역 결정에 override 반영**

`fetchPoll` 약 485행:

```swift
            let station = phase == .waiting
                ? (boardOverrideName ?? leg.boardName)
                : leg.alightName
```

⚠ riding 쪽(`alightName`)은 건드리지 않는다 — 그것은 L1 영역이고 이번 범위 밖이다.

- [ ] **Step 3: 시트에 역 선택 단계 삽입**

`phaseControls`의 riding 분기(296~299행)를 교체:

```swift
                if state.phase == .riding, leg.trackMode != .tagoBus {
                    if model.reboardPickerActive {
                        reboardStationPicker(leg: leg, proxy: proxy)
                    } else {
                        Button(appLocalized("transitGuide.changeBoarding")) { model.beginReboard() }
                            .accessibilityFocused($changeBoardingFocused)
                    }
                }
```

새 뷰빌더를 `waitingList` 인접에 추가한다:

```swift
    @ViewBuilder private func reboardStationPicker(
        leg: TransitGuideLeg, proxy: ScrollViewProxy
    ) -> some View {
        Text(appLocalized("transitGuide.reboardStationPrompt"))
            .accessibilityAddTraits(.isHeader)
            .accessibilityFocused($reboardPromptFocused)
            .id(Self.reboardPromptId)
        ForEach(leg.viaStops, id: \.name) { stop in
            Button(stop.name) { model.changeBoarding(at: stop.name) }
        }
        Button(appLocalized("transitGuide.reboardStationCancel")) {
            model.cancelReboard()
            changeBoardingFocused = true
        }
    }
```

`@AccessibilityFocusState private var reboardPromptFocused: Bool`와 `private static let reboardPromptId = "reboard-prompt"`를 선언부에 추가한다.

- [ ] **Step 4: 진입 포커스 착지**

`reboardPickerActive`가 true가 될 때 헤딩으로 착지시킨다. **동기 대입 한 줄은 실패한다** — repo 정본(가시화 → 지연 → 대입 → 검증)을 따른다. `recoverWaitingLabelFocus`가 같은 파일에 있는 선례이므로 그 구현을 그대로 본떠 `proxy.scrollTo(Self.reboardPromptId)` 후 지연 대입한다.

⚠ `.accessibilityFocused`에 **Bool 바인딩을 여러 행에 붙이지 않는다**(헤딩 하나에만 Bool, 역 목록 항목에는 붙이지 않는다).

- [ ] **Step 5: 빌드 + 시뮬레이터 스냅숏으로 라벨 확인**

Run: `xcodebuildmcp simulator build-and-run` 후 `ui-automation snapshot-ui`
Expected: 역 선택 진입 시 프롬프트 텍스트와 역 버튼들이 접근성 트리에 보인다. ⚠ 포커스 착지 판정은 시뮬로 불가하며 **실기기 VO가 정본**이다.

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(ios): 탑승 변경이 현재 역을 묻는다 (A16 L3)

조회 기준이 원래 승차역으로 고정돼 있어 갈아탄 뒤에는 목록에
맞는 차량이 있을 수 없었다. 위치 대신 경유역 목록에서 고르게
한 것은 지하철 안 GPS 부재 때문이다(위원장 판정).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" -- ios/Gildongmu/Directions/TransitGuideModel.swift ios/Gildongmu/Directions/TransitTrackingSheet.swift
```

---

### Task 6: 웹 표시·역 재선택

**Files:**
- Modify: `src/hooks/useTransitGuide.ts`
- Modify: `src/components/TransitGuidePanel.tsx`

**Interfaces:**
- Consumes: Task 1의 `"neverSeen"`, Task 3의 문구 키
- Produces: 훅에 `boardOverrideName` · `reboardPickerActive` · `beginReboard()` · `changeBoardingAt(name)` · `cancelReboard()`

- [ ] **Step 1: 신호→문구 매핑에 `neverSeen` 추가하고 승차 중 어휘 분리**

패널의 상태 문구 매핑에 `neverSeen` 분기를 넣고, `notYetVisible`은 `phase === "riding"`일 때 `stateRidingNotYetVisible`을 쓴다.

- [ ] **Step 2: `neverSeen` 이벤트를 live region 통지로**

기존 `signalLost` 통지와 같은 창구를 쓴다. ⚠ **같은 문자열을 연달아 쓰면 침묵**하므로([[live-region-same-string-is-silent]]) 기존 통지 조립 방식을 그대로 따른다.

- [ ] **Step 3: 역 재선택 UI**

iOS와 같은 흐름(버튼 → 역 목록 → 선택 → 재잠금). 웹은 `leg.viaStops`를 버튼 리스트로 렌더하고, 훅의 조회 역 결정에 `boardOverrideName ?? leg.boardName`을 반영한다. 진입 시 프롬프트 heading으로 포커스 이동, 취소 시 트리거 버튼 복귀.

- [ ] **Step 4: 게이트 실행**

Run: `npm run test:run && npx tsc --noEmit && npm run lint`
Expected: 전부 error 0

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(web): neverSeen 표시·통지 + 역 재선택 (A16 L2·L3 웹)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" -- src/hooks/useTransitGuide.ts src/components/TransitGuidePanel.tsx
```

---

### Task 7: 변이 주입 검증 + 문서 분배

**Files:**
- Modify: `docs/BACKLOG.md` · `CHANGELOG.md` · `PROGRESS.md`

- [ ] **Step 1: 변이 주입 3종으로 검출력 실측**

각각을 임시로 적용해 **fixture가 실제로 실패하는지** 확인하고 되돌린다([[mutation-proves-test-detection-power]]).

1. `next.signal !== "neverSeen"` 가드 제거 → 시나리오 1의 마지막 스텝(`event: null`)이 실패해야 한다.
2. `next.phase === "riding"` 조건 제거 → 대기 국면 시나리오가 영향을 받는지 확인.
3. `upstreamFailed` 보호(`next.signal !== "upstreamFailed"` 선행 대입) 제거 → 시나리오 3이 실패해야 한다.

⚠ **실패하지 않는 변이가 있으면 그 축은 테스트되지 않은 것이다.** 시나리오를 보강한 뒤 다음 단계로 간다.

- [ ] **Step 2: 전체 게이트**

Run: `npm run test:run && npx tsc --noEmit && npm run lint && (cd ios/GildongmuKit && swift test)`
Expected: 전부 통과

- [ ] **Step 3: 백로그 A16 갱신**

L2·L3를 종결로 옮기고 **L1과 미확정 2건은 남긴다**. 실승차 판정 4건(spec §6)을 §2 판정 대기 표에 등재한다.

- [ ] **Step 4: CHANGELOG·PROGRESS 한 줄씩**

- [ ] **Step 5: 커밋**

```bash
git commit -m "docs: A16 L2·L3 종결 분배 — 판정은 실승차로

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" -- docs/BACKLOG.md CHANGELOG.md PROGRESS.md
```

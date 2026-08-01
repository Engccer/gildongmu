# iOS 목적지 거리 추적 이식 구현 플랜

> **작업자용:** 스펙 정본은 `docs/superpowers/specs/2026-08-01-ios-distance-beacon-design.md`. 스펙의 절 번호(§)를 그대로 인용한다.

**목표:** 길찾기 결과 화면에서 목적지까지의 거리 추세를 톤으로 알리는 기능을 iOS에 이식하고, 이어서 길찾기 탭의 자동 초점 이동을 점검·개선한다.

**아키텍처:** 판정은 전부 `GildongmuKit` 순수 함수(리듀서 + 톤/통지 게이트), 앱은 I/O 배선만. 앱 타깃 테스트 번들이 없어서 앱에 판정을 두면 구조적으로 테스트가 불가능하다는 제약이 이 경계를 강제한다.

**기술 스택:** Swift 6 / SwiftUI / CoreLocation / AVAudioEngine / Swift Testing (Kit) / Vitest (웹 대조)

## 구현 방식 판정 (자율성 헌장 §구현 방식 판정)

**inline 실행.** 근거: (1) 순차 의존이 강하다. Task 2·3은 Task 1이 정의한 타입(`BeaconAnnounce`·`AnnounceKind`)을 소비하고, Task 6은 3·4·5의 인터페이스를 전부 조립한다. (2) 탐색적이다. CoreLocation·AVAudioEngine 실동작이 설계를 뒤집을 수 있는 지점이 스펙 §7에 이미 2건 적혀 있다. (3) 같은 파일(`DirectionsTabView.swift`·`LocationService.swift`)을 여러 태스크가 건드린다.

**리뷰는 이 판정과 무관하게 별도 컨텍스트에 맡긴다**(Task 8).

## 전역 제약

- 커밋 이메일 `engccer@gmail.com`. 주석·커밋 메시지 한국어, 변수·함수명 영어.
- **em dash(`—`) 금지.** 콜론·괄호·마침표로 대체.
- **UI 라벨에 이모지 금지.**
- Kit은 SwiftUI·CoreLocation·Foundation 외 의존 금지(`Geo.swift`는 `Foundation`만).
- i18n 신규 키 금지. `beacon.*` 11키를 그대로 쓴다. 미터 값은 `%1$@` 포맷이므로 **`String(meters)`로 넘긴다**(Int 직접 전달 시 포맷 깨짐).
- 게이트: `swift test --package-path ios/GildongmuKit` · `npm run test:run` · 앱 빌드.
- **`git checkout --`로 되돌리지 말 것**(커밋 전 변경이 날아간다). 변이 주입 복구는 파일 사본으로.
- 신규 파일은 `git add` 후 커밋(`git commit -- <경로>`는 untracked를 조용히 건너뛴다).

---

## Task 1: Kit 거리 계산 + 비콘 리듀서 (+ 웹 가드 동조)

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/Geo.swift`
- Create: `ios/GildongmuKit/Sources/GildongmuKit/Beacon.swift`
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/BeaconTests.swift`
- Modify: `src/lib/beacon.ts` (약신호 가드 1줄)
- Modify: `src/lib/__tests__/beacon.test.ts` (음수 accuracy 케이스)

**Interfaces:**
- Produces: `haversineMeters(lat1:lng1:lat2:lng2:) -> Double`, `BeaconFix(lat:lng:accuracy:)`, `BeaconDest(lat:lng:)`, `BeaconState`, `BeaconAnnounce(kind:distance:accuracy:speak:)`, `AnnounceKind` (`.first`·`.closer`·`.farther`·`.hold`·`.nearby`·`.weak`), `Trend`, `beaconStep(state:fix:dest:) -> (state: BeaconState, announce: BeaconAnnounce)`, `BeaconState.initial`

- [ ] **Step 1: 웹 가드를 먼저 좁히고 테스트를 추가한다 (RED)**

`src/lib/__tests__/beacon.test.ts`에 추가:

```ts
it("음수 accuracy(무효 좌표 신호)는 weak으로 다룬다", () => {
  // CoreLocation은 horizontalAccuracy < 0으로 좌표 무효를 신호한다. 웹 입력엔
  // 오지 않지만 가드가 갈리면 "두 플랫폼 단일 정본"이 거짓이 된다(spec §3.2).
  const r = beaconStep(INITIAL_BEACON_STATE, { lat: 37.5, lng: 127.0, accuracy: -1 }, DEST);
  expect(r.announce.kind).toBe("weak");
  expect(r.state.anchorDistance).toBeNull();
});
```

`DEST`가 그 파일에 없으면 기존 테스트가 쓰는 목적지 상수를 재사용한다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/beacon.test.ts`
Expected: FAIL (kind가 `"first"`로 나온다)

- [ ] **Step 3: 웹 가드 수정**

`src/lib/beacon.ts`의 약신호 조건에서 `!Number.isFinite(fix.accuracy)`를 `!(fix.accuracy > 0)`으로 바꾼다. `NaN > 0`도 false이므로 기존 `isFinite` 케이스를 포함한다.

- [ ] **Step 4: 웹 테스트 전량 통과 확인**

Run: `npm run test:run`
Expected: PASS

- [ ] **Step 5: Kit `Geo.swift` 작성**

```swift
import Foundation

/// 구면 하버사인 거리(m). 웹 `src/lib/geo.ts`(R=6,371,000)의 포팅.
/// ⚠ `CLLocation.distance(from:)`를 쓰지 않는다. 타원체라 값이 갈리고,
/// Kit이 CoreLocation에 묶이면 실기기 없는 테스트와 dodo 이식성이 무너진다.
public func haversineMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double) -> Double {
    let r = 6_371_000.0
    let dLat = (lat2 - lat1) * .pi / 180
    let dLng = (lng2 - lng1) * .pi / 180
    let a = sin(dLat / 2) * sin(dLat / 2)
        + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLng / 2) * sin(dLng / 2)
    return 2 * r * atan2(sqrt(a), sqrt(1 - a))
}
```

- [ ] **Step 6: Kit `Beacon.swift` 작성**

웹 `src/lib/beacon.ts`를 열어 분기 순서를 그대로 옮긴다. 상수 4종(`maxUsableAccuracy` 100, `baseDeadBand` 15, `arrivalBase` 20, `speakInterval` 50)과 분기 순서(약신호 → 첫 fix → 도착 존 → 래치 히스테리시스 → 추세)는 **바꾸지 않는다**. 약신호 조건만 `!(fix.accuracy > 0) || fix.accuracy > Self.maxUsableAccuracy`.

- [ ] **Step 7: Kit 테스트 작성**

웹 `beacon.test.ts`의 케이스를 이식하고 아래를 반드시 포함한다.

```swift
@Test func negativeAccuracyIsWeakAndDoesNotAnchor() {
    let r = beaconStep(state: .initial, fix: .init(lat: 37.5, lng: 127.0, accuracy: -1), dest: dest)
    #expect(r.announce.kind == .weak)
    #expect(r.state.anchorDistance == nil)
}

@Test func deadBandScalesWithAccuracy() {
    // accuracy 40이면 데드밴드가 40이라 30m 접근은 추세를 만들지 않는다.
}

@Test func arrivalLatchReleasesOnlyBeyondHysteresis() {
    // threshold 안 → nearby(첫 1회 speak) → threshold+deadBand 이내는 hold 침묵
}

@Test func haversineMatchesWebValues() {
    // 웹에서 뽑은 기준값과 1m 이내 일치
}
```

- [ ] **Step 8: Kit 테스트 통과 확인**

Run: `swift test --package-path ios/GildongmuKit`
Expected: PASS

- [ ] **Step 9: 변이 주입으로 검출력 실측**

데드밴드를 `max(15, accuracy)` → `15` 고정으로 바꾸고 테스트가 빨개지는지, 래치 해제 조건에서 `+ deadBand`를 빼고 빨개지는지 확인한다. **파일 사본으로 복구**한다.

- [ ] **Step 10: 커밋**

```bash
git add ios/GildongmuKit/Sources/GildongmuKit/Geo.swift ios/GildongmuKit/Sources/GildongmuKit/Beacon.swift ios/GildongmuKit/Tests/GildongmuKitTests/BeaconTests.swift
git commit -m "feat(kit): 비콘 거리 리듀서 이식 + 음수 accuracy 가드 (웹 동조)" -- ios/GildongmuKit src/lib/beacon.ts src/lib/__tests__/beacon.test.ts
```

---

## Task 2: Kit 톤 테이블 + 교차 파일 드리프트 가드

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/BeaconTones.swift`
- Create: `src/lib/__tests__/beacon-tones-drift.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `BeaconTone` (`.closer`·`.farther`·`.nearby`·`.tick`·`.start`·`.stop`), `struct ToneStep { freq: Double; start: Double; dur: Double }`, `func toneSteps(for tone: BeaconTone) -> [ToneStep]`

- [ ] **Step 1: 웹 시작·정지 톤 값을 확인한다**

Run: `grep -n 'playStart\|playStop' -A6 src/hooks/useBeaconSound.ts`
이 값이 `.start`·`.stop`의 정본이다.

- [ ] **Step 2: `BeaconTones.swift` 작성**

웹 `src/lib/beacon-tones.ts`의 4종 + Step 1에서 읽은 2종. 주석에 "정본은 웹 `beacon-tones.ts`, 드리프트 가드는 `beacon-tones-drift.test.ts`"를 남긴다.

- [ ] **Step 3: 드리프트 가드 테스트 작성 (RED 먼저)**

일부러 Swift 값 하나를 틀리게 두고 시작한다.

```ts
import { readFileSync } from "node:fs";
import { CLOSER_TONES, FARTHER_TONES, NEARBY_TONES, TICK_TONES } from "../beacon-tones";

/**
 * Swift 상수를 Swift 리터럴과 비교하는 테스트는 웹이 바뀌어도 실패하지 않는다.
 * 정본(웹)을 읽어 Swift 파일과 교차 대조해야 드리프트가 잡힌다
 * (CLI/MCP 카탈로그 byte 해시 드리프트 테스트 선례).
 */
const swift = readFileSync("ios/GildongmuKit/Sources/GildongmuKit/BeaconTones.swift", "utf8");

function freqsIn(caseName: string): number[] {
  const block = new RegExp(`case \\.${caseName}:([\\s\\S]*?)(?=case \\.|\\n\\s*\\})`).exec(swift);
  if (!block) throw new Error(`${caseName} 블록을 못 찾았다`);
  return [...block[1].matchAll(/freq:\s*([\d.]+)/g)].map((m) => Number(m[1]));
}

it.each([
  ["closer", CLOSER_TONES],
  ["farther", FARTHER_TONES],
  ["nearby", NEARBY_TONES],
  ["tick", TICK_TONES],
])("%s 톤 주파수가 웹 정본과 일치한다", (name, web) => {
  expect(freqsIn(name)).toEqual(web.map((t) => t.freq));
});
```

- [ ] **Step 4: 실패 확인 → Swift 값 교정 → 통과 확인**

Run: `npx vitest run src/lib/__tests__/beacon-tones-drift.test.ts`

- [ ] **Step 5: 검출력 실측**

Swift 파일의 `closer` 주파수 하나를 660 → 661로 바꿔 테스트가 빨개지는지 확인하고 **사본으로 복구**한다.

- [ ] **Step 6: 커밋**

```bash
git add ios/GildongmuKit/Sources/GildongmuKit/BeaconTones.swift src/lib/__tests__/beacon-tones-drift.test.ts
git commit -m "feat(kit): 비콘 톤 테이블 + 웹 정본 교차 드리프트 가드"
```

---

## Task 3: Kit 톤·통지 게이트 (초안에 없던 계층)

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/BeaconGate.swift`
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/BeaconGateTests.swift`

**Interfaces:**
- Consumes: `BeaconAnnounce`·`AnnounceKind` (Task 1), `BeaconTone` (Task 2)
- Produces: `BeaconNotice` (`.first(meters: Int)`·`.closer(meters: Int)`·`.farther(meters: Int)`·`.nearby(accuracyMeters: Int)`·`.weak`), `BeaconGateState` (`.initial`), `beaconGateStep(state:announce:now:) -> (state: BeaconGateState, tone: BeaconTone?, notice: BeaconNotice?)`

`now`는 초 단위 `Double`(단조 시계). **테스트가 시각을 주입하므로 실시간 대기가 없다.**

- [ ] **Step 1: 실패 테스트 작성 (스펙 §3.4의 규칙 전부)**

```swift
@Test func trendToneAndTickUseIndependentWindows() {
    // tick이 창을 점유해도 closer 톤이 나와야 한다(웹에서 실제로 났던 회귀).
    var s = BeaconGateState.initial
    let hold = BeaconAnnounce(kind: .hold, distance: 100, accuracy: 10, speak: false)
    let closer = BeaconAnnounce(kind: .closer, distance: 90, accuracy: 10, speak: true)
    var r = beaconGateStep(state: s, announce: hold, now: 0);      s = r.state
    #expect(r.tone == .tick)
    r = beaconGateStep(state: s, announce: closer, now: 0.5);      s = r.state
    #expect(r.tone == .closer)   // tick 창(3s) 안이지만 추세 창은 별개
}

@Test func nearbyTonePlaysOncePerZoneEntry() {
    // 존 안에 머무는 동안 매 fix가 kind .nearby를 내지만 톤은 1회뿐이다.
}

@Test func nearbyToneReplaysAfterLeavingZone() {
    // 존을 벗어났다(.closer 등) 재진입하면 다시 1회.
}

@Test func weakNoticeOnlyOnTransition() {
    // 비-weak → weak 1회, 연속 weak은 nil.
}

@Test func nearbyNoticeCarriesAccuracyNotDistance() {
    let a = BeaconAnnounce(kind: .nearby, distance: 7, accuracy: 12, speak: true)
    let r = beaconGateStep(state: .initial, announce: a, now: 0)
    #expect(r.notice == .nearby(accuracyMeters: 12))
}
```

- [ ] **Step 2: 실패 확인**

Run: `swift test --package-path ios/GildongmuKit --filter BeaconGate`
Expected: 컴파일 실패(타입 없음) → 타입만 만들고 다시 실행해 단언 실패 확인

- [ ] **Step 3: 구현**

규칙은 스펙 §3.4 그대로. 상수: 추세 톤 창 2.0초, tick 창 3.0초.

- [ ] **Step 4: 통과 확인 + 변이 주입**

두 창을 하나로 합치는 변이(`lastTrendToneAt`을 tick에도 갱신)를 넣어 `trendToneAndTickUseIndependentWindows`가 빨개지는지 확인한다. **이 변이는 실제로 났던 회귀이고, 초안 설계에서는 주입할 자리조차 없었다.** 사본으로 복구.

- [ ] **Step 5: 커밋**

```bash
git add ios/GildongmuKit/Sources/GildongmuKit/BeaconGate.swift ios/GildongmuKit/Tests/GildongmuKitTests/BeaconGateTests.swift
git commit -m "feat(kit): 비콘 톤·통지 게이트 (throttle 독립 창, nearby 1회 래치)"
```

---

## Task 4: LocationService 연속 모드

**Files:**
- Modify: `ios/Gildongmu/LocationService.swift`

**Interfaces:**
- Produces: `struct BeaconFixPayload { lat, lng, accuracy: Double; timestamp: Date }`, `startBeaconUpdates(onFix:onError:onAuthChange:)`, `stopBeaconUpdates()`, `var isBeaconTracking: Bool`

- [ ] **Step 1: 연속 모드 추가**

스펙 §3.5 전부. 특히:
- 매니저 설정: `pausesLocationUpdatesAutomatically = false`, `activityType = .fitness`, `desiredAccuracy = kCLLocationAccuracyBest`, `distanceFilter = kCLDistanceFilterNone`
- 싱크 3종 저장, `[weak]` 캡처는 호출부 책임이므로 여기선 클로저를 그대로 보관하되 `stopBeaconUpdates()`에서 반드시 nil로 비운다
- `didUpdateLocations`에서 연속 fix를 `onFix`로 보내고 **`lastCoordinate`도 갱신**한다
- `didFailWithError`·`locationManagerDidChangeAuthorization`에서 추적 중이면 `onError`·`onAuthChange` 호출

- [ ] **Step 2: 추적 중 one-shot 규칙**

`currentCoordinate(force:)` 진입부에 가드를 넣는다.

```swift
// 추적 중에는 requestLocation()을 부르지 않는다(spec §3.5).
// ① :65의 desiredAccuracy 재대입이 추적 정확도를 100m로 깎고 복원되지 않는다
// ② startUpdatingLocation 활성 중 requestLocation의 안전성이 보장되지 않는다
if isBeaconTracking, let latest = lastCoordinate { return latest }
```

- [ ] **Step 3: 빌드 확인**

Run: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS Simulator' build -quiet`
Expected: 성공

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(ios): LocationService 연속 위치 모드 (매니저 단일 소유 유지)" -- ios/Gildongmu/LocationService.swift
```

---

## Task 5: 톤 재생기

**Files:**
- Create: `ios/Gildongmu/Directions/BeaconTonePlayer.swift`

**Interfaces:**
- Consumes: `BeaconTone`·`toneSteps(for:)` (Task 2)
- Produces: `@MainActor final class BeaconTonePlayer { func play(_ tone: BeaconTone); func shutdown() }`

- [ ] **Step 1: 구현**

스펙 §3.6. `AVAudioEngine` + `AVAudioPlayerNode`, 사인파 버퍼 합성. 재생 직전 `AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])`.

인터럽션 관찰(`AVAudioSession.interruptionNotification`)과 `AVAudioEngineConfigurationChange`에서 엔진 재시작. **재시작 실패는 조용한 무음이 아니라 호출부에 알린다**(`onFailure` 콜백 또는 `lastError` 프로퍼티).

- [ ] **Step 2: 시뮬에서 소리 경로 확인**

시뮬 빌드·실행 후 톤이 실제로 재생되는지 확인한다(시뮬은 오디오를 호스트로 낸다). 무음이면 카테고리·엔진 시작 순서를 먼저 의심한다.

- [ ] **Step 3: 커밋**

```bash
git add ios/Gildongmu/Directions/BeaconTonePlayer.swift
git commit -m "feat(ios): 비콘 톤 재생기 (사인파 합성, ambient+mixWithOthers)"
```

---

## Task 6: BeaconModel (얇은 껍데기)

**Files:**
- Create: `ios/Gildongmu/Directions/BeaconModel.swift`

**Interfaces:**
- Consumes: Task 1·2·3의 Kit API, Task 4의 `startBeaconUpdates`, Task 5의 `BeaconTonePlayer`
- Produces: `@Observable @MainActor final class BeaconModel { enum Status { case idle, tracking, denied, unavailable }; var status: Status; var statusText: String; func toggle(dest:); func stop(); func handleScenePhase(_:) }`

- [ ] **Step 1: 구현**

스펙 §3.7 + §4 전부. 순서: 권한 확인(§4.2) → idle timer → 시작 톤 → `startBeaconUpdates`. 매 fix는 **신선도 게이트**(§4.4: `accuracy > 0` 그리고 `timestamp` 5초 이내) → `beaconStep` → `beaconGateStep` → 톤·통지.

- 무-fix 타임아웃 15초(§4.1), 이후 30초 끊김 재통지
- `SpeechService`가 청취 중이면 톤 건너뜀(§3.6)
- `statusText`는 가시 상태 텍스트(§5.3)용 1줄
- idle timer 해제는 `stop()`의 모든 경로에서 보장

- [ ] **Step 2: 빌드 확인 + 커밋**

```bash
git add ios/Gildongmu/Directions/BeaconModel.swift
git commit -m "feat(ios): 비콘 오케스트레이터 (침묵 방지 4종 포함)"
```

---

## Task 7: 길찾기 결과 화면 UI

**Files:**
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift`

- [ ] **Step 1: 섹션 추가**

스펙 §5. 수단 섹션 **앞**, `results != nil && 도착지가 .place`일 때. 헤더는 `appLocalized("beacon.heading") + ", " + 목적지 라벨`(§5.3 I6).

- [ ] **Step 2: 생명주기 배선**

- `BeaconModel`은 `DirectionsTabView`의 `@State`
- **화면 수준** `.onDisappear`(기존 `model.cancel()`과 같은 지점)에서 `beacon.stop()`. ⚠ 행 수준 부착 금지(§5.5)
- 목적지 좌표가 바뀌면 중지 + 통지(§5.5 I7)
- `.onChange(of: scenePhase)`로 백그라운드 일시정지·복귀 앵커 재설정(§5.5 I12)

- [ ] **Step 3: 시뮬 실측**

`xcodebuildmcp`로 빌드·실행 → 길찾기 조회 → 섹션 존재·버튼 라벨 전환 확인.

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(ios): 길찾기 결과에 목적지 거리 추적 섹션" -- ios/Gildongmu/Directions/DirectionsTabView.swift
```

---

## Task 8: 게이트·리뷰·배포

- [ ] **Step 1: 전체 게이트**

```bash
swift test --package-path ios/GildongmuKit
npm run test:run
npm run lint
xcodebuild ... build
```

- [ ] **Step 2: 권한 목적 문자열 확장 (§7.3)**

`INFOPLIST_KEY_NSLocationWhenInUseUsageDescription`에 지속 추적을 한 줄 덧붙인다(6로케일 `InfoPlist.xcstrings` 동조).

- [ ] **Step 3: 별도 컨텍스트 리뷰**

요구사항(스펙)과 산출물(diff)만 준다. 세션 히스토리 금지.

- [ ] **Step 4: 커밋·push·실기기 배포**

```bash
ios/deploy-device.sh
```

---

## Task 9 (M2): 길찾기 자동 초점 점검

**Files:**
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift` (가설 확정 후)

- [ ] **Step 1: 실기기에서 3가설 재현 시도**

스펙 §10.1 **순서대로**. 가설 1(List 렌더 전 대입) → 가설 2(시트 이후 착지점) → 가설 3(같은 값 재대입, 가능성 낮음).

- [ ] **Step 2: 재현된 것만 고친다**

재현 안 되면 **기각을 기록에 남긴다**(오탐도 기록 대상). 웹 계약을 기계적으로 이식하지 않는다.

- [ ] **Step 3: 실기기 재확인 → 커밋**

---

## 자기 점검 결과

- **스펙 커버리지**: §3.1→T1, §3.2→T1, §3.3→T2, §3.4→T3, §3.5→T4, §3.6→T5, §3.7→T6, §4→T6, §5→T7, §6→각 태스크, §7.3→T8, §10→T9. 누락 없음.
- **타입 정합**: `BeaconAnnounce`(T1) → T3 소비, `BeaconTone`(T2) → T3·T5 소비, `BeaconNotice`(T3) → T6 소비. 이름 일치 확인.
- **플레이스홀더**: 없음. T5·T6은 코드 블록 대신 스펙 절 참조인데, 두 파일 모두 스펙에 규칙이 열거돼 있고 구현 형태가 실측(오디오 세션·CoreLocation 동작)에 따라 갈리므로 의도적이다.

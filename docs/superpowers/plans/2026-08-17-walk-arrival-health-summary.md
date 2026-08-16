# 도보 도착 화면 걸음·칼로리 요약 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS 도보 안내 도착 종료 화면에 "이번 구간 N걸음, 약 Mkcal" 한 줄을 표시한다(만보계 실측 + 활동 칼로리 추정).

**Architecture:** Kit 순수 함수 `WalkHealth.summary`(거리×체중×0.5)가 계산을, 앱 타깃 `PedometerService`(`CMPedometer` 래퍼, 프로토콜 주입)가 조회를, `BeaconModel`이 세션 창(시작 Date+토큰)과 도착 시 비동기 적재·전경 재조회를, `BeaconTrackingSheet.arrivalSection`이 표시를 맡는다. 설정 "칼로리 추정용 체중(kg)"과 정보 출처 한 행, `NSMotionUsageDescription`이 따라온다.

**Tech Stack:** Swift 6 / SwiftUI / Core Motion / Swift Testing(Kit) / messages→xcstrings 파이프라인.

**Spec:** `docs/superpowers/specs/2026-08-17-walk-arrival-health-summary-design.md`

**구현 방식 판정:** inline. 단일 도메인(iOS 도보 안내)이고 Task 1→2→3→4가 인터페이스를 순차로 확정한다(Kit 타입 → 모델 상태 → 시트 표시). 수정 파일이 겹치지 않는 Task 5·6(설정·plist)도 문자열 파이프라인 재생성을 공유해 같은 세션이 낫다. 리뷰는 별도 컨텍스트(코드 리뷰 서브에이전트)로 분리한다.

## Global Constraints

- 한 줄 = 한 접근성 객체: 건강 요약은 `joinText`로 합친 단일 `Text` 하나(`ios/Gildongmu/Nearby/NearbyLoadState.swift`의 `joinText`).
- 앱 타깃 로컬라이즈 키는 문자열 리터럴로 `appLocalized("키")` 호출(린터 `node ios/scripts/check-xcstrings-keys.mjs`가 대조). 새 키는 `ios/i18n/ios-extra/{ko,en,es,fr,it,ja}.json` 6개 전부에 넣고 `node ios/scripts/messages-to-xcstrings.mjs app`으로 카탈로그 재생성.
- 부재를 설명하지 않는다: 데이터가 없으면 행 자체가 없다. "0걸음"은 표시한다.
- 도착 낭독 문장(`guide.arrived`/`guide.arrivedPresumed` `.high` 통지)은 변경하지 않는다.
- 걸음·체중·요약 값을 `guideDiagLog`에 남기지 않는다(지연 시간만 허용).
- Kit 테스트: `swift test --package-path ios/GildongmuKit --filter WalkHealthTests`. 앱 빌드 확인: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS Simulator' build`(또는 xcodebuildmcp `simulator build`).
- 커밋은 의도 파일만 `git commit -- <paths>`.

---

### Task 1: Kit `WalkHealth` 순수 함수 + 테스트

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/WalkHealth.swift`
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/WalkHealthTests.swift`

**Interfaces:**
- Produces: `public struct WalkHealthSummary: Equatable { steps: Int; kcal: Int; usedDefaultWeight: Bool }`, `public enum WalkHealth { defaultWeightKg=65, fallbackStrideMeters=0.7, netKcalPerKgKm=0.5, weightStorageKey="walkWeightKg", static func summary(steps: Int, distanceMeters: Double?, weightKg: Double?) -> WalkHealthSummary, static func normalizedWeight(_ raw: Double?) -> Double? }`

- [ ] **Step 1: 실패하는 테스트 작성**

```swift
import Testing
@testable import GildongmuKit

/// 도착 화면 걸음·칼로리 요약(spec 2026-08-17 §4). 활동 칼로리 = 거리(km)×체중×0.5 —
/// ACSM 보행식에서 휴식 대사 3.5를 뺀 순 보행분은 시간이 소거되어 거리만 남는다.
@Suite struct WalkHealthTests {
    @Test func oneKilometerAt65kgIs33kcal() {
        let s = WalkHealth.summary(steps: 1400, distanceMeters: 1000, weightKg: 65)
        #expect(s == WalkHealthSummary(steps: 1400, kcal: 33, usedDefaultWeight: false))
    }

    @Test func distanceScalesLinearly() {
        let s = WalkHealth.summary(steps: 3000, distanceMeters: 2400, weightKg: 80)
        #expect(s.kcal == 96)
    }

    @Test func nilDistanceFallsBackToStride() {
        // 1,000걸음 × 0.7m = 700m × 65kg × 0.5/1000 = 22.75 → 23
        let s = WalkHealth.summary(steps: 1000, distanceMeters: nil, weightKg: 65)
        #expect(s.kcal == 23)
    }

    @Test func zeroStepsZeroDistanceIsZeroKcal() {
        let s = WalkHealth.summary(steps: 0, distanceMeters: 0, weightKg: 65)
        #expect(s == WalkHealthSummary(steps: 0, kcal: 0, usedDefaultWeight: false))
    }

    @Test func missingOrOutOfRangeWeightUsesDefault() {
        for w in [nil, 0, 19.9, 300.1, -5] as [Double?] {
            let s = WalkHealth.summary(steps: 1400, distanceMeters: 1000, weightKg: w)
            #expect(s.usedDefaultWeight, "weight \(String(describing: w))")
            #expect(s.kcal == 33)
        }
        #expect(WalkHealth.normalizedWeight(20) == 20)
        #expect(WalkHealth.normalizedWeight(300) == 300)
        #expect(WalkHealth.normalizedWeight(0) == nil)
    }

    @Test func negativeOrNaNInputsClampToZero() {
        #expect(WalkHealth.summary(steps: -3, distanceMeters: -10, weightKg: 65).steps == 0)
        #expect(WalkHealth.summary(steps: 10, distanceMeters: .nan, weightKg: 65).kcal
                == WalkHealth.summary(steps: 10, distanceMeters: nil, weightKg: 65).kcal)
        #expect(WalkHealth.summary(steps: 10, distanceMeters: .infinity, weightKg: 65).kcal
                == WalkHealth.summary(steps: 10, distanceMeters: nil, weightKg: 65).kcal)
    }
}
```

- [ ] **Step 2: 실패 확인** — `swift test --package-path ios/GildongmuKit --filter WalkHealthTests` → 컴파일 오류(`WalkHealth` 미정의).

- [ ] **Step 3: 구현**

```swift
import Foundation

/// 도착 화면 걸음·칼로리 요약(spec 2026-08-17 §4).
public struct WalkHealthSummary: Equatable, Sendable {
    public let steps: Int
    /// 활동 칼로리(반올림 정수). 휴식 대사분은 포함하지 않는다.
    public let kcal: Int
    /// 체중 미입력·범위 밖이라 기본 체중으로 계산했는가(화면이 "기준 체중" 꼬리를 붙인다).
    public let usedDefaultWeight: Bool

    public init(steps: Int, kcal: Int, usedDefaultWeight: Bool) {
        self.steps = steps
        self.kcal = kcal
        self.usedDefaultWeight = usedDefaultWeight
    }
}

public enum WalkHealth {
    public static let defaultWeightKg: Double = 65
    /// 만보계가 거리를 주지 않을 때의 보폭.
    public static let fallbackStrideMeters: Double = 0.7
    /// ACSM 보행식 `VO2 = 3.5 + 0.1×v`에서 휴식 대사 3.5를 뺀 순 보행분:
    /// `0.1×v(m/min) × 체중/200 (kcal/min)`에 시간을 곱하면 `0.0005 × 거리(m) × 체중`.
    /// 시간이 소거되어 정지·속도가 결과에 들어오지 않고 0거리는 정의상 0kcal다.
    public static let netKcalPerKgKm: Double = 0.5
    /// UserDefaults 키(설정 "칼로리 추정용 체중"). 0 = 미입력.
    public static let weightStorageKey = "walkWeightKg"
    public static let weightRange: ClosedRange<Double> = 20...300

    /// 저장값 → 유효 체중. 범위 밖·nil·비유한값은 nil(=기본 체중 사용).
    public static func normalizedWeight(_ raw: Double?) -> Double? {
        guard let raw, raw.isFinite, weightRange.contains(raw) else { return nil }
        return raw
    }

    public static func summary(steps: Int, distanceMeters: Double?, weightKg: Double?) -> WalkHealthSummary {
        let safeSteps = max(0, steps)
        let meters: Double
        if let d = distanceMeters, d.isFinite, d > 0 {
            meters = d
        } else {
            meters = Double(safeSteps) * fallbackStrideMeters
        }
        let weight = normalizedWeight(weightKg)
        let kcal = (meters / 1000) * (weight ?? defaultWeightKg) * netKcalPerKgKm
        return WalkHealthSummary(
            steps: safeSteps,
            kcal: Int(kcal.rounded()),
            usedDefaultWeight: weight == nil
        )
    }
}
```

- [ ] **Step 4: 통과 확인** — 같은 명령, 6건 PASS.
- [ ] **Step 5: 커밋** — `git commit -m "feat(ios): WalkHealth 활동 칼로리·걸음 요약 순수 함수" -- ios/GildongmuKit/Sources/GildongmuKit/WalkHealth.swift ios/GildongmuKit/Tests/GildongmuKitTests/WalkHealthTests.swift`

---

### Task 2: `PedometerService` (CMPedometer 래퍼)

**Files:**
- Create: `ios/Gildongmu/Directions/PedometerService.swift`

**Interfaces:**
- Produces:
```swift
enum PedometerResult: Equatable { case sample(steps: Int, distanceMeters: Double?); case unavailable; case failed }
protocol PedometerQuerying: Sendable {
    func requestAuthorizationIfNeeded()
    func summary(from start: Date, to end: Date) async -> PedometerResult
}
final class PedometerService: PedometerQuerying, @unchecked Sendable   // 실구현
```

- [ ] **Step 1: 구현**

```swift
import CoreMotion
import Foundation

/// 만보계 조회 결과. `.unavailable`은 이번 세션에 재시도가 무의미한 상태(권한 거부·미지원),
/// `.failed`는 재시도 가치가 있는 상태(일시 오류·권한 미확정·창 역전). 화면은 둘 다
/// 행 부재로 같지만 전경 복귀 재조회는 `.failed`만 다시 본다(spec §3).
enum PedometerResult: Equatable {
    case sample(steps: Int, distanceMeters: Double?)
    case unavailable
    case failed
}

protocol PedometerQuerying: Sendable {
    /// 권한 미확정이면 짧은 조회로 시스템 팝업을 유도한다. 결과는 버린다.
    /// 사용자가 전경에서 안내 시작 버튼을 눌렀을 때만 부른다(도착 시 팝업 금지).
    func requestAuthorizationIfNeeded()
    /// `[start, end]` 구간의 걸음·거리. 24시간 초과 창은 `.failed`.
    func summary(from start: Date, to end: Date) async -> PedometerResult
}

final class PedometerService: PedometerQuerying, @unchecked Sendable {  // CMPedometer는 스레드 안전 API
    private let pedometer = CMPedometer()

    func requestAuthorizationIfNeeded() {
        guard CMPedometer.isStepCountingAvailable(),
              CMPedometer.authorizationStatus() == .notDetermined
        else { return }
        let now = Date()
        pedometer.queryPedometerData(from: now.addingTimeInterval(-1), to: now) { _, _ in }
    }

    func summary(from start: Date, to end: Date) async -> PedometerResult {
        guard CMPedometer.isStepCountingAvailable() else { return .unavailable }
        switch CMPedometer.authorizationStatus() {
        case .denied, .restricted: return .unavailable
        case .notDetermined: return .failed
        case .authorized: break
        @unknown default: return .failed
        }
        let span = end.timeIntervalSince(start)
        guard span > 0, span <= 24 * 3600 else { return .failed }
        return await withCheckedContinuation { cont in
            pedometer.queryPedometerData(from: start, to: end) { data, error in
                guard error == nil, let data else { return cont.resume(returning: .failed) }
                cont.resume(returning: .sample(
                    steps: data.numberOfSteps.intValue,
                    distanceMeters: data.distance?.doubleValue
                ))
            }
        }
    }
}
```

- [ ] **Step 2: 앱 빌드 통과 확인**(시뮬레이터 generic 빌드).
- [ ] **Step 3: 커밋** — `git commit -m "feat(ios): PedometerService — CMPedometer 구간 조회 래퍼" -- ios/Gildongmu/Directions/PedometerService.swift`

---

### Task 3: `BeaconModel` 세션 창·도착 적재·전경 재조회

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift` (상태 선언부 ~L360, `clearArrival` L363, `start` ~L480-500, `handleFinalApproach` arrived 분기 ~L1533, `maybePresumeArrival` ~L1595, `handleScenePhaseChange` `.active` L1022)

**Interfaces:**
- Consumes: Task 1 `WalkHealth`, Task 2 `PedometerQuerying`/`PedometerService`.
- Produces: `private(set) var arrivalHealth: WalkHealthSummary?` (시트가 읽음), `init(pedometer: PedometerQuerying = PedometerService())`.

- [ ] **Step 1: 상태 추가** (`arrivalDest` 선언 근처)

```swift
    // MARK: - 도착 건강 요약(spec 2026-08-17)

    private let pedometer: PedometerQuerying
    /// 도보 세션 창의 시작(벽시계). `.car`는 nil. stop()에서 지우지 않는다 —
    /// 도착 처리가 stop() 뒤에 읽는다(arrivalDest 대입과 같은 순서 계약).
    private var sessionStartedAt: Date?
    /// 세션 세대. 비동기 조회 결과는 이 토큰이 그대로일 때만 커밋한다(같은 목적지 재시작을
    /// 목적지 비교로는 못 가른다 — 설계 리뷰 BLOCKER 3).
    private var arrivalSessionToken = UUID()
    private enum ArrivalHealthLoad { case idle, loading, loaded, unavailable, failed }
    private var arrivalHealthLoad: ArrivalHealthLoad = .idle
    private var arrivalHealthTask: Task<Void, Never>?
    /// 도착 종료 화면의 건강 요약 행. nil이면 행이 없다(부재를 설명하지 않는다).
    private(set) var arrivalHealth: WalkHealthSummary?
```

`init`이 없으면 추가: `init(pedometer: PedometerQuerying = PedometerService()) { self.pedometer = pedometer }` (기존 저장 프로퍼티는 전부 기본값이 있어야 한다 — 없으면 컴파일 오류가 알려 준다).

- [ ] **Step 2: `clearArrival()`·`start()` 초기화**

`clearArrival()`에 추가:
```swift
        arrivalHealthTask?.cancel()
        arrivalHealthTask = nil
        arrivalHealth = nil
        arrivalHealthLoad = .idle
```
`start()`의 `arrivalDest = nil` 직후에 추가:
```swift
        arrivalHealthTask?.cancel()
        arrivalHealthTask = nil
        arrivalHealth = nil
        arrivalHealthLoad = .idle
        arrivalSessionToken = UUID()
        sessionStartedAt = kind == .walk ? Date() : nil
        if kind == .walk { pedometer.requestAuthorizationIfNeeded() }
```

- [ ] **Step 3: 적재 헬퍼** (`maybePresumeArrival` 아래)

```swift
    /// 도착 종료 화면의 걸음·칼로리 요약을 비동기로 채운다(spec 2026-08-17 §3).
    /// 확정·추정 도착 두 경로가 `arrivalDest` 대입 직후 부르고, 전경 복귀가 `.failed`일 때
    /// 한 번 더 부른다. 커밋 조건은 세션 토큰 일치 AND 도착 화면이 아직 열려 있음.
    private func loadArrivalHealth() {
        guard sessionKind == .walk, let start = sessionStartedAt, arrivalDest != nil else { return }
        guard arrivalHealthLoad == .idle || arrivalHealthLoad == .failed else { return }
        arrivalHealthLoad = .loading
        let token = arrivalSessionToken
        let requestedAt = ProcessInfo.processInfo.systemUptime
        arrivalHealthTask = Task { [weak self, pedometer] in
            let result = await pedometer.summary(from: start, to: Date())
            guard let self, !Task.isCancelled, self.arrivalSessionToken == token,
                  self.arrivalDest != nil else { return }
            switch result {
            case .sample(let steps, let distance):
                let weight = WalkHealth.normalizedWeight(
                    UserDefaults.standard.object(forKey: WalkHealth.weightStorageKey) as? Double)
                self.arrivalHealth = WalkHealth.summary(
                    steps: steps, distanceMeters: distance, weightKg: weight)
                self.arrivalHealthLoad = .loaded
            case .unavailable:
                self.arrivalHealthLoad = .unavailable
            case .failed:
                self.arrivalHealthLoad = .failed
            }
            // 값은 남기지 않는다(건강 정보). 착지 400ms 안에 드는지만 계측한다.
            let ms = Int((ProcessInfo.processInfo.systemUptime - requestedAt) * 1000)
            guideDiagLog("arrivalHealth load=\(self.arrivalHealthLoad) latencyMs=\(ms)")
        }
    }
```

- [ ] **Step 4: 두 도착 경로에서 호출** — `handleFinalApproach`의 `arrivalDest = dest` 직후와 `maybePresumeArrival`의 `arrivalPresumed = true` 직후에 각각 `loadArrivalHealth()` 한 줄.

- [ ] **Step 5: 전경 복귀 재조회** — `handleScenePhaseChange` `.active` 분기의 맨 앞(missedAnnouncement 상환보다 앞이든 뒤든 무관, `guard isTracking` **보다 앞**)에:
```swift
            if arrivalDest != nil, arrivalHealthLoad == .failed { loadArrivalHealth() }
```

- [ ] **Step 6: 빌드 통과 확인. 커밋** — `git commit -m "feat(ios): 도착 시 만보계 구간 조회로 걸음·칼로리 요약 적재" -- ios/Gildongmu/Directions/BeaconModel.swift`

---

### Task 4: 도착 화면 행 + 문자열

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconTrackingSheet.swift` `arrivalSection` (~L233-255)
- Modify: `ios/i18n/ios-extra/{ko,en,es,fr,it,ja}.json` (`ios.beacon.healthSummary`, `ios.beacon.healthDefaultWeight`)
- Regenerate: `ios/Gildongmu/Resources/Localizable.xcstrings`

**Interfaces:**
- Consumes: `model.arrivalHealth: WalkHealthSummary?`.

- [ ] **Step 1: 문자열 추가** — 각 로케일 `ios.beacon`에:

| locale | healthSummary | healthDefaultWeight |
|---|---|---|
| ko | `이번 구간 {steps}걸음, 약 {kcal}kcal` | `기준 체중 {kg}kg` |
| en | `This leg: {steps} steps, about {kcal} kcal` | `based on {kg} kg` |
| es | `Este tramo: {steps} pasos, unas {kcal} kcal` | `según {kg} kg` |
| fr | `Ce trajet : {steps} pas, environ {kcal} kcal` | `base {kg} kg` |
| it | `Questo tratto: {steps} passi, circa {kcal} kcal` | `in base a {kg} kg` |
| ja | `この区間 {steps}歩、約{kcal}kcal` | `基準体重{kg}kg` |

`node ios/scripts/messages-to-xcstrings.mjs app` 실행 → 두 키가 `%1$@`·`%2$@` positional로 카탈로그에 들어갔는지 grep 확인.

- [ ] **Step 2: 시트 행 추가** — `arrivalSection`의 도착 문장 `Text(...)` 바로 뒤에:

```swift
            // 걸음·칼로리 요약(spec 2026-08-17). 값이 없으면 행이 없다 — 부재를 설명하지 않는다.
            // 한 줄 = 한 접근성 객체(joinText). 도착 낭독 문장에는 넣지 않는다.
            if let health = model.arrivalHealth {
                Text(joinText(
                    appLocalized(
                        "ios.beacon.healthSummary",
                        Self.decimal.string(from: NSNumber(value: health.steps)) ?? "\(health.steps)",
                        "\(health.kcal)"),
                    health.usedDefaultWeight
                        ? appLocalized("ios.beacon.healthDefaultWeight", "\(Int(WalkHealth.defaultWeightKg))")
                        : nil
                ))
            }
```
그리고 뷰에 `private static let decimal: NumberFormatter = { let f = NumberFormatter(); f.numberStyle = .decimal; return f }()`. `import GildongmuKit`이 파일에 있는지 확인.

- [ ] **Step 3: 린터·빌드** — `node ios/scripts/check-xcstrings-keys.mjs` 통과, 시뮬 빌드 통과.
- [ ] **Step 4: 커밋** — `git commit -m "feat(ios): 도착 종료 화면에 걸음·칼로리 요약 행" -- ios/Gildongmu/Directions/BeaconTrackingSheet.swift ios/i18n/ios-extra/*.json ios/Gildongmu/Resources/Localizable.xcstrings`

---

### Task 5: 설정 체중 입력 + 정보 출처 행

**Files:**
- Modify: `ios/Gildongmu/SettingsView.swift` (AppStorage 선언 ~L54, `Section(aiSection)` 앞에 새 행)
- Modify: `ios/Gildongmu/DataSourcesView.swift` (첫 Section 끝)
- Modify: `ios/i18n/ios-extra/{6}.json` (`ios.settings.weightKg`, `dataSources.walkHealth`)
- Regenerate: `Localizable.xcstrings`

- [ ] **Step 1: 문자열**

| locale | ios.settings.weightKg | dataSources.walkHealth |
|---|---|---|
| ko | `칼로리 추정용 체중(kg)` | `걸음 수는 iPhone 만보계 실측, 칼로리는 걸은 거리와 체중으로 계산한 추정치입니다` |
| en | `Weight for calorie estimate (kg)` | `Steps come from the iPhone pedometer; calories are an estimate from distance and weight` |
| es | `Peso para estimar calorías (kg)` | `Los pasos vienen del podómetro del iPhone; las calorías son una estimación según distancia y peso` |
| fr | `Poids pour l'estimation des calories (kg)` | `Les pas viennent du podomètre de l'iPhone ; les calories sont une estimation d'après la distance et le poids` |
| it | `Peso per la stima delle calorie (kg)` | `I passi vengono dal pedometro dell'iPhone; le calorie sono una stima da distanza e peso` |
| ja | `カロリー推定用の体重(kg)` | `歩数はiPhoneの歩数計の実測、カロリーは歩いた距離と体重から計算した推定値です` |

`ios-extra`에 `dataSources` 최상위 키가 없으면 새로 만든다(extra는 임의 네임스페이스 병합).

- [ ] **Step 2: SettingsView** — 선언: `@AppStorage(WalkHealth.weightStorageKey) private var weightKg = 0.0` + `@State private var weightText = ""`. `Section(aiSection)` 앞에:

```swift
                // 칼로리 추정용 체중(spec 2026-08-17 §5). 0 = 미입력(기본 65kg으로 계산하고
                // 도착 화면이 "기준 체중"을 밝힌다). 범위 밖(20~300)은 미입력으로 되돌린다.
                Section {
                    TextField(appLocalized("ios.settings.weightKg"), text: $weightText)
                        .keyboardType(.decimalPad)
                        .onAppear { weightText = weightKg > 0 ? Self.formatWeight(weightKg) : "" }
                        .onSubmit(commitWeight)
                        .onChange(of: weightText) { _, _ in commitWeight() }
                }
```
헬퍼:
```swift
    private static func formatWeight(_ w: Double) -> String {
        w == w.rounded() ? String(Int(w)) : String(w)
    }
    private func commitWeight() {
        let raw = Double(weightText.replacingOccurrences(of: ",", with: "."))
        weightKg = WalkHealth.normalizedWeight(raw) ?? 0
    }
```
`import GildongmuKit` 확인.

- [ ] **Step 3: DataSourcesView** — 첫 `Section`의 `ForEach` 뒤에 `Text(appLocalized("dataSources.walkHealth"))` 한 행(주석: 걸음·칼로리 방법 고지, spec §7).

- [ ] **Step 4: 재생성·린터·빌드** — `node ios/scripts/messages-to-xcstrings.mjs app && node ios/scripts/check-xcstrings-keys.mjs`, 빌드.
- [ ] **Step 5: 커밋** — `git commit -m "feat(ios): 설정 체중 입력·정보 출처에 걸음·칼로리 방법 고지" -- ios/Gildongmu/SettingsView.swift ios/Gildongmu/DataSourcesView.swift ios/i18n/ios-extra/*.json ios/Gildongmu/Resources/Localizable.xcstrings`

---

### Task 6: `NSMotionUsageDescription`

**Files:**
- Modify: `ios/Gildongmu.xcodeproj/project.pbxproj` (세 구성의 `INFOPLIST_KEY_NSMicrophoneUsageDescription` 줄 아래 각각 추가)
- Modify: `ios/Gildongmu/Resources/InfoPlist.xcstrings` (`NSMotionUsageDescription` 6개 로케일)

- [ ] **Step 1: pbxproj** — 세 구성 각각: `INFOPLIST_KEY_NSMotionUsageDescription = "도보 안내로 도착했을 때 걸은 걸음 수를 보여 주기 위해 동작 및 피트니스 데이터를 사용합니다.";` (Debug·Release·Experimental 모두 동일 문구, sed로 `NSMicrophoneUsageDescription` 줄 뒤에 삽입 후 `xcodebuild -list`로 프로젝트가 열리는지 확인).
- [ ] **Step 2: InfoPlist.xcstrings** — `NSMicrophoneUsageDescription` 항목과 같은 모양으로 추가:

| ko | 도보 안내로 도착했을 때 걸은 걸음 수를 보여 주기 위해 동작 및 피트니스 데이터를 사용합니다. |
| en | Motion & Fitness data is used to show how many steps you walked when you arrive with walking guidance. |
| es | Los datos de Movimiento y Forma física se usan para mostrar cuántos pasos diste al llegar con la guía a pie. |
| fr | Les données Mouvement et forme sont utilisées pour afficher le nombre de pas parcourus à l'arrivée du guidage à pied. |
| it | I dati Movimento e fitness sono usati per mostrare quanti passi hai fatto all'arrivo con la guida a piedi. |
| ja | 徒歩案内で到着したときに歩いた歩数を表示するために、モーションとフィットネスのデータを使用します。 |

- [ ] **Step 3: 빌드 후 산출물 Info.plist에 키가 있는지 확인** — `plutil -p <DerivedData>/.../Gildongmu.app/Info.plist | grep NSMotion`.
- [ ] **Step 4: 커밋** — `git commit -m "chore(ios): NSMotionUsageDescription 6개 로케일" -- ios/Gildongmu.xcodeproj/project.pbxproj ios/Gildongmu/Resources/InfoPlist.xcstrings`

---

### Task 7: 리뷰·문서·배포

- [ ] **Step 1: 코드 리뷰 서브에이전트**(spec+diff만 전달, 세션 히스토리 금지). 지적은 계층 대조 후 처리.
- [ ] **Step 2: 문서 분배** — `CHANGELOG.md` 항목(2~4줄+spec 링크), `docs/appstore/release-notes.md` 다음 버전 What's New 초안 1줄 + `node scripts/build-release-notes.mjs`, `PROGRESS.md` 상태 한 줄(도착 화면 건강 요약 iOS 반영). CLAUDE.md는 새 함정이 있을 때만.
- [ ] **Step 3: 실기기 배포** — `./ios/deploy-device.sh` + `CONFIGURATION=Experimental ./ios/deploy-device.sh`(기기 연결 시). 실보행 검증 대본은 `docs/FIELD-TEST.md`에 한 행(도착 화면 행 존재·VO 순서·지연 로그).
- [ ] **Step 4: 커밋·push**.

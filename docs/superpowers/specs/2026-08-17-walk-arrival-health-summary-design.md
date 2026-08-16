# 도보 도착 화면 걸음·칼로리 요약 설계 (iOS)

> 2026-08-17. 도보 안내로 목적지에 도착했을 때 그 구간에서 몇 걸음을 걸었고 몇 kcal를
> 썼는지 도착 종료 화면에 한 줄로 보여 준다. 길찾기 본연의 기능이 아니라 사용의 재미와
> 성취감을 더하는 부가 기능이다. 대상은 iOS 앱만이다(웹은 만보계가 없고 도착 화면도 없다).

## 1. 결정 요약

| 축 | 결정 | 근거 |
|---|---|---|
| 걸음 수 출처 | Core Motion `CMPedometer` 실측 | 권한 1회, 건강 앱 entitlement 불필요, 시스템이 걸음을 항상 기록하므로 앱 백그라운드 구간도 빠지지 않는다. HealthKit은 반영이 늦고 심사 항목이 는다. |
| 칼로리 | 추정치(ACSM 보행 대사 공식) | 아이폰 단독으로는 활동 칼로리 실측이 없다(애플워치 없이는 건강 앱에도 기록되지 않는다). 추정임을 "약"으로 문장 안에서 밝힌다. |
| 체중 | 설정 "체중(kg)" 선택 입력, 미입력 시 65kg | 미입력 상태의 문장 끝에 기준 체중을 밝힌다. 개인화와 미니멀의 절충. |
| 표시 위치 | iOS 도착 종료 화면(확정·추정 도착 모두), 도착 문장 아래 한 줄 | 도착 낭독 문장(`.high`)에는 넣지 않는다(1문장 1행동, 도착 사실이 먼저). |
| 못 읽었을 때 | 그 줄을 표시하지 않는다 | 3-state: "0걸음"과 "못 읽음"을 뭉개지 않는다. 0이면 0걸음을 그대로 표시. |
| 세션 종류 | 도보(`GuideSessionKind.walk`)만 | 자동차는 걸음이 의미 없다. 대중교통 안내는 별도 모델이라 대상 밖. |
| 안내 중 실시간 표시 | 하지 않는다 | 안내 시트 낭독 정보량을 늘리지 않는다([[live-guidance-one-unit-per-sentence]]). |

## 2. 사용자 경험

도착 종료 화면(`BeaconTrackingSheet.arrivalSection`)의 순서:

1. 헤딩 "도착, {목적지}" (기존)
2. 도착 문장 "목적지에 도착했습니다" (기존, VO 포커스 착지점)
3. **건강 요약 한 줄 (신규)**: `이번 구간 1,240걸음, 약 46kcal` / 체중 미입력이면 `이번 구간 1,240걸음, 약 46kcal, 기준 체중 65kg`
4. 주변 확인 (기존)
5. 닫기 (기존)

- 한 줄 = 한 접근성 객체(`joinText`로 합친 단일 `Text`). 도착 문장 착지 뒤 다음 스와이프에서 읽힌다.
- 걸음 수는 로케일 천 단위 구분(`NumberFormatter` decimal). kcal은 정수 반올림.
- 걸음이 0이고 거리도 0이면 `이번 구간 0걸음, 약 0kcal`을 그대로 표시한다(측정은 성공했고 값이 0인 상태).
- 데이터가 없으면(권한 거부·기기 미지원·조회 실패·세션 시작 시각 없음) 3번 행이 없다. 별도 안내 문장을 두지 않는다(부재를 설명하지 않는다).

## 3. 걸음 수 조회 (`PedometerService`)

앱 타깃 `ios/Gildongmu/Directions/PedometerService.swift`. `CMPedometer` 래퍼로 두 함수만 노출한다.

- `requestAuthorizationIfNeeded()`: `CMPedometer.authorizationStatus() == .notDetermined`이고 `isStepCountingAvailable()`이면 짧은 `queryPedometerData(from: now-1s, to: now)`를 한 번 던져 시스템 권한 팝업을 유도한다. 결과는 버린다. **도보 세션 시작(`BeaconModel.start`, `kind == .walk`) 시 호출** — 도착 순간에 권한 팝업이 뜨면 도착 낭독과 겹친다.
- `summary(from start: Date, to end: Date) async -> PedometerSample?`: `queryPedometerData(from:to:)` 1회. `PedometerSample { steps: Int, distanceMeters: Double? }`. 권한 없음·미지원·오류·`numberOfSteps` 부재는 전부 `nil`. 조회는 도착 확정 시점에 한 번만 한다(라이브 `startUpdates` 불필요 — 시스템 기록을 사후 질의한다).

`BeaconModel` 변경:

- `private var sessionStartedAt: Date?` 신설(기존 `startedAt`은 `systemUptime` 기반 워치독용이라 재사용하지 않는다 — 벽시계 `Date`가 필요하다). `start()`에서 `kind == .walk`일 때 대입, `stop()`에서 소거하지 않는다(도착 처리가 `stop()` **뒤에** 읽는다 — `arrivalDest` 대입과 같은 순서 계약).
- `private(set) var arrivalHealth: WalkHealthSummary?` 신설. 새 세션 시작(`start`)과 `clearArrival()`에서 `nil`.
- 확정 도착(`handleFinalApproach`의 `arrived`)과 추정 도착(`maybePresumeArrival`) 두 경로가 `arrivalDest` 대입 직후 같은 헬퍼 `loadArrivalHealth(dest:)`를 부른다: `Task`로 `PedometerService.summary` → `walkHealthSummary(...)` → `arrivalHealth` 대입. 비동기 도착 뒤 `arrivalDest`가 그대로인지(같은 dest, 시트가 아직 도착 화면인지) 확인하고 대입한다(닫힌 뒤 도착한 결과 폐기 — 이탈 게이트 동형).
- 세션 종류가 `.car`면 헬퍼는 즉시 반환한다.

## 4. 칼로리 추정 (`GildongmuKit/WalkHealth.swift`, 순수 함수)

```swift
public struct WalkHealthSummary: Equatable {
    public let steps: Int
    public let kcal: Int          // 반올림 정수
    public let usedDefaultWeight: Bool
}

public enum WalkHealth {
    public static let defaultWeightKg: Double = 65
    public static let fallbackStrideMeters: Double = 0.7
    public static let weightStorageKey = "walkWeightKg"   // UserDefaults, 0 = 미입력
    public static func summary(
        steps: Int, distanceMeters: Double?, durationSeconds: Double, weightKg: Double?
    ) -> WalkHealthSummary
}
```

- 거리: `distanceMeters`가 있으면 그것, 없으면 `steps × 0.7m`.
- 속도(m/min) = 거리 / (지속시간/60). 지속시간이 60초 미만이면 60초로 하한(0 나눗셈·순간 폭주 방지).
- ACSM 보행 공식: `VO2 = 3.5 + 0.1 × 속도(m/min)` (ml/kg/min), `kcal/min = VO2 × 체중 / 200`, `kcal = kcal/min × 분`. 속도가 100m/min(6km/h)를 넘으면 100으로 상한(보행 공식 적용 범위 밖의 GPS 튐·달리기 오적용 억제).
- 체중 `nil`이거나 20~300 밖이면 65kg + `usedDefaultWeight = true`.
- 음수·NaN 입력은 0으로 처리한다.
- 테스트(`WalkHealthTests`): 65kg·1km·12분 → 46kcal(속도 83.3m/min, VO2 11.83, 3.85kcal/min × 12 손계산 대조), 거리 nil 시 보폭 폴백, 60초 하한, 속도 상한, 체중 범위 밖 폴백, 0걸음 → 0kcal.

## 5. 설정 "체중"

- `SettingsView`에 `TextField`(숫자 패드) 한 행 "체중(kg)". `@AppStorage(WalkHealth.weightStorageKey)` `Double`(0 = 미입력). 20~300 밖 입력은 저장 시 미입력으로 되돌린다.
- 힌트 문장 없음(라벨이 곧 용도). 이 값은 기기 밖으로 나가지 않는다.
- 실험판은 번들 ID가 달라 별도 저장소다(기존 설정과 동일).

## 6. 문자열 (`messages/*.json` → xcstrings 파이프라인)

앱 전용이라 `ios/i18n/ios-extra/{locale}.json`의 `ios.beacon`·`ios.settings` 아래에 둔다(6개 로케일):

- `ios.beacon.healthSummary`: `이번 구간 {steps}걸음, 약 {kcal}kcal` (positional 변환 → `%1$@`, `%2$@`)
- `ios.beacon.healthDefaultWeight`: `기준 체중 {kg}kg`
- `ios.settings.weightKg`: `체중(kg)`

문장 조립은 `joinText(healthSummary, usedDefaultWeight ? healthDefaultWeight : nil)`.

## 7. 개인정보·심사

- `NSMotionUsageDescription`: pbxproj 세 구성의 `INFOPLIST_KEY_NSMotionUsageDescription` + `InfoPlist.xcstrings` 6개 로케일. ko: "도보 안내로 도착했을 때 걸은 걸음 수를 보여 주기 위해 동작 및 피트니스 데이터를 사용합니다."
- `PrivacyInfo.xcprivacy`·ASC 영양 라벨·웹 개인정보 페이지: **변경 없음**. 걸음 데이터는 기기 안에서 읽고 표시할 뿐 서버로 보내지 않으며 저장도 하지 않는다(수집 = 기기 밖 전송이라는 Apple 정의). 체중도 UserDefaults 로컬 값이라 동일. Required-reason API 목록에 Core Motion은 없다.
- 설계 리뷰 판정: 새 플랫폼 센서 통합 + 권한·심사 경계라 codex 적대적 설계 리뷰 대상(글로벌 규칙 ②③). 결과는 §10에 기록.

## 8. 실험/정식 게이트

플래그 없이 정식판에 바로 들어간다. 근거: 부가 정보 한 줄이고, 못 읽으면 사라지며, 안내 판정·발화 계층을 건드리지 않는다(도착 처리 뒤 비동기 대입만). 실험판에도 같은 코드가 들어간다.

## 9. 테스트·검증

- Kit 단위 테스트 `WalkHealthTests`(§4).
- `BeaconModel` 계약: 확정·추정 도착 두 경로에서 헬퍼가 호출되고, `.car`에서는 호출되지 않는다는 점은 코드 리뷰로 확인(모델이 `CMPedometer`를 직접 쥐므로 단위 테스트가 어렵다 — `PedometerService`를 프로토콜로 두어 주입 가능하게 하되 실기기 검증이 정본).
- 시뮬레이터: 만보계가 없어 줄이 **표시되지 않는 것**이 정상 동작이다(3-state).
- 실기기: 도보 안내 1회 완주 후 도착 화면에 줄이 있고, 걸음 수가 건강 앱의 같은 시간대 걸음과 대체로 일치하는지 대조. VO로 도착 문장 → 건강 요약 → 주변 확인 순서 확인.
- 정식·실험 두 구성 실기기 배포.

## 10. 설계 리뷰 판정

(codex 적대적 리뷰 결과를 여기에 기록한다.)

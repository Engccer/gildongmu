# 도보 도착 화면 걸음·칼로리 요약 설계 (iOS)

> **개정 2026-08-18(위원장 실사용 판정, §2 예시·§4 표시·§6 문자열이 이 노트로 대체됨)**: §4 표시 문장은 슬롯형("이번 구간 N걸음, 약 Kkcal, 기준 체중 65kg")에서 **문장형 + 한국 음식 비유**로 바뀌었고, "기준 체중" 꼬리는 **체중 미입력자에게만** 보이는 고지 문장 + "체중 입력하기" 버튼(설정 시트, 닫으면 같은 표본으로 재계산)으로 대체됐다. 비유 판정은 Kit `WalkHealth.foodComparison`(11단 사다리, 비율 최근접, 상단 초과 n단위, 하단 미달 침묵), 문자열은 `ios.beacon.healthSummary`·`ios.beacon.food.*`·`ios.beacon.healthWeightNotice`·`ios.beacon.healthEnterWeight`. 계산식·만보계 계약(§3·§5)은 불변.

> 2026-08-17. 도보 안내로 목적지에 도착했을 때 그 구간에서 몇 걸음을 걸었고 몇 kcal를
> 썼는지 도착 종료 화면에 한 줄로 보여 준다. 길찾기 본연의 기능이 아니라 사용의 재미와
> 성취감을 더하는 부가 기능이다. 대상은 iOS 앱만이다(웹은 만보계가 없고 도착 화면도 없다).

## 1. 결정 요약

| 축 | 결정 | 근거 |
|---|---|---|
| 걸음 수 출처 | Core Motion `CMPedometer` 실측 | 권한 1회, 건강 앱 entitlement 불필요, 시스템이 걸음을 항상 기록하므로 앱 백그라운드 구간도 빠지지 않는다. HealthKit은 반영이 늦고 심사 항목이 는다. |
| 칼로리 | **활동** 칼로리 추정치(ACSM 보행식의 순 대사분 = 거리 × 체중 × 0.5kcal/kg/km) | 아이폰 단독으로는 활동 칼로리 실측이 없다(애플워치 없이는 건강 앱에도 기록되지 않는다). 휴식 대사분을 빼야 "걸어서 쓴 칼로리"라는 화면 의미와 맞고, 그러면 시간 항이 소거되어 거리만으로 계산된다. 추정임을 "약"으로 문장 안에서 밝힌다. |
| 체중 | 설정 "체중(kg)" 선택 입력, 미입력 시 65kg | 미입력 상태의 문장 끝에 기준 체중을 밝힌다. 개인화와 미니멀의 절충. |
| 표시 위치 | iOS 도착 종료 화면(확정·추정 도착 모두), 도착 문장 아래 한 줄 | 도착 낭독 문장(`.high`)에는 넣지 않는다(1문장 1행동, 도착 사실이 먼저). |
| 못 읽었을 때 | 그 줄을 표시하지 않는다 | 3-state: "0걸음"과 "못 읽음"을 뭉개지 않는다. 0이면 0걸음을 그대로 표시. |
| 세션 종류 | 도보(`GuideSessionKind.walk`)만 | 자동차는 걸음이 의미 없다. 대중교통 안내는 별도 모델이라 대상 밖. |
| 안내 중 실시간 표시 | 하지 않는다 | 안내 시트 낭독 정보량을 늘리지 않는다([[live-guidance-one-unit-per-sentence]]). |

## 2. 사용자 경험

도착 종료 화면(`BeaconTrackingSheet.arrivalSection`)의 순서:

1. 헤딩 "도착, {목적지}" (기존)
2. 도착 문장 "목적지에 도착했습니다" (기존, VO 포커스 착지점)
3. **건강 요약 한 줄 (신규)**: `이번 구간 1,240걸음, 약 28kcal` / 체중 미입력이면 `이번 구간 1,240걸음, 약 28kcal, 기준 체중 65kg`
4. 주변 확인 (기존)
5. 닫기 (기존)

- 한 줄 = 한 접근성 객체(`joinText`로 합친 단일 `Text`). 도착 문장 착지 뒤 다음 스와이프에서 읽힌다.
- 걸음 수는 로케일 천 단위 구분(`NumberFormatter` decimal). kcal은 정수 반올림.
- 걸음이 0이고 거리도 0이면 `이번 구간 0걸음, 약 0kcal`을 그대로 표시한다(측정은 성공했고 값이 0인 상태).
- "이번 구간"은 안내 시작 이후 휴대전화가 기록한 걸음 전체다(길 이탈·건물 안 이동 포함). 그것이 곧 사용자가 이 안내 동안 걸은 양이므로 분리하지 않는다.
- 데이터가 없으면(권한 거부·기기 미지원·조회 실패·세션 시작 시각 없음) 3번 행이 없다. 별도 안내 문장을 두지 않는다(부재를 설명하지 않는다).

## 3. 걸음 수 조회 (`PedometerService`)

앱 타깃 `ios/Gildongmu/Directions/PedometerService.swift`. `CMPedometer` 래퍼. 프로토콜 `PedometerQuerying`으로 추상화해 `BeaconModel`에 주입한다(테스트 대역 가능).

- `requestAuthorizationIfNeeded()`: `CMPedometer.authorizationStatus() == .notDetermined`이고 `isStepCountingAvailable()`이면 짧은 `queryPedometerData(from: now-1s, to: now)`를 한 번 던져 시스템 권한 팝업을 유도한다. 결과는 버린다. **도보 세션 시작(`BeaconModel.start`, `kind == .walk`) 시 호출** — 시작은 사용자가 전경에서 버튼을 눌러 일으키므로 팝업이 뜰 수 있는 자리이고, 도착 순간에 팝업이 뜨면 도착 낭독과 겹친다.
- `summary(from start: Date, to end: Date) async -> PedometerResult`: `queryPedometerData(from:to:)` 1회. 결과는 3갈래 —
  - `.sample(steps: Int, distanceMeters: Double?)`: 조회 성공(0걸음도 성공).
  - `.unavailable`: 권한 거부(`.denied`/`.restricted`)·기기 미지원 — 이번 세션에 재시도 무의미.
  - `.failed`: 그 밖의 오류·`end <= start`·아직 권한 미확정(`.notDetermined`) — 재시도 가치 있음.
- 이력 한계: `CMPedometer` 과거 조회는 최근 7일이 상한이고 도보 세션은 도착 추정 자동 종료가 있어 하루를 넘지 않는다 — 분할 조회 불필요(spec에 전제로 기록, 코드에선 24시간 초과 창이면 `.failed`로 취급).

`BeaconModel` 변경:

- `private var sessionStartedAt: Date?` — `start()`에서 `kind == .walk`일 때 `Date()` 대입(`.car`는 nil). 기존 `startedAt`(`systemUptime`, 워치독용)은 재사용하지 않는다. `stop()`에서 소거하지 않는다(도착 처리가 `stop()` **뒤에** 읽는다 — `arrivalDest` 대입과 같은 순서 계약). `start()`가 다시 불리는 경로(새 안내·실패 뒤 `restart`)는 모두 새 세션이라 창을 새로 연다. 경로 재계산·이탈 재탐색·대안 전환은 `start()`를 부르지 않으므로 창이 유지된다(전이표: 시작=열기, 도착=읽기, 다음 시작=다시 열기; 그 외 불변).
- `private var arrivalSessionToken = UUID()` — `start()`마다 새 값. 비동기 결과 커밋 조건은 **토큰 일치 AND `arrivalDest != nil`** 둘 다다(같은 목적지로 새 세션을 시작한 뒤 이전 조회가 도착하는 경우를 목적지 비교로는 못 가른다 — 리뷰 BLOCKER 3). `start()`·`clearArrival()`은 진행 중인 조회 Task를 취소한다.
- `private(set) var arrivalHealth: WalkHealthSummary?`와 `private var arrivalHealthLoad: ArrivalHealthLoad = .idle`(`.idle`/`.loading`/`.loaded`/`.unavailable`/`.failed`). 새 세션 시작·`clearArrival()`에서 둘 다 초기화.
- 확정 도착(`handleFinalApproach`의 `arrived`)과 추정 도착(`maybePresumeArrival`) 두 경로가 `arrivalDest` 대입 직후 같은 헬퍼 `loadArrivalHealth()`를 부른다: 도보 세션이고 `sessionStartedAt`이 있을 때만, 지연 없이 즉시 `summary(from: sessionStartedAt, to: Date())` → `.sample`이면 `WalkHealth.summary(...)`로 `arrivalHealth` 대입(`.loaded`), `.unavailable`/`.failed`는 상태만 기록. 조회는 보통 수십 ms라 VO 착지(400ms) 전에 행이 존재한다.
- **전경 복귀 재조회 1회**(`handleScenePhaseChange` `.active`): `arrivalDest != nil`이고 상태가 `.failed`면 `loadArrivalHealth()`를 다시 부른다(`.unavailable`은 재시도하지 않는다). 도착 직후 앱이 정지했거나 권한 응답이 늦은 짧은 경로를 이 한 경로가 구제한다(리뷰 6·7·9). 이 재조회 뒤에도 실패면 그대로 부재.
- 도착 화면이 열린 채 뒤늦게 행이 생기면(첫 조회가 느렸을 때) 그 뒤에 이미 지나간 VO 커서는 그 행을 발견하지 못할 수 있다 — 통지·포커스 이동으로 보완하지 않는다(도착 문장 착지 계약과 경합, 부가 정보에 과한 비용). 대신 조회를 도착 처리와 같은 틱에 즉시 시작해 착지 전 완료를 겨냥한다(실기기에서 지연 계측, §9).

## 4. 칼로리 추정 (`GildongmuKit/WalkHealth.swift`, 순수 함수)

```swift
public struct WalkHealthSummary: Equatable {
    public let steps: Int
    public let kcal: Int          // 반올림 정수, 활동 칼로리
    public let usedDefaultWeight: Bool
}

public enum WalkHealth {
    public static let defaultWeightKg: Double = 65
    public static let fallbackStrideMeters: Double = 0.7
    public static let netKcalPerKgKm: Double = 0.5
    public static let weightStorageKey = "walkWeightKg"   // UserDefaults, 0 = 미입력
    public static func summary(steps: Int, distanceMeters: Double?, weightKg: Double?) -> WalkHealthSummary
}
```

- 거리: `distanceMeters`가 유한한 양수면 그것, 아니면 `steps × 0.7m`.
- **활동 칼로리** = 거리(km) × 체중(kg) × 0.5. 근거: ACSM 보행식 `VO2 = 3.5 + 0.1×v`에서 휴식 대사 3.5를 뺀 순수 보행분 `0.1×v(m/min) × 체중/200 (kcal/min)`은 시간을 곱하면 `0.0005 × 거리(m) × 체중`으로 시간이 소거된다. 그래서 지속시간·속도·정지 시간이 결과에 들어오지 않고, 0거리는 정의상 0kcal다.
- 체중 `nil`이거나 20~300 밖이면 65kg + `usedDefaultWeight = true`.
- 음수·NaN 걸음/거리는 0으로 처리한다.
- 테스트(`WalkHealthTests`): 65kg·1km → 33kcal(32.5 반올림), 80kg·2.4km → 96kcal, 거리 nil·1,000걸음 → 700m → 65kg 23kcal, 0걸음·0거리 → 0kcal, 체중 범위 밖·nil → 기본값 플래그, 음수·NaN 입력 → 0.

## 5. 설정 "체중"

- `SettingsView`에 `TextField`(숫자 패드) 한 행 "칼로리 추정용 체중(kg)" — 라벨이 용도를 말한다. `@AppStorage(WalkHealth.weightStorageKey)` `Double`(0 = 미입력). 20~300 밖 입력은 저장 시 미입력으로 되돌린다.
- 힌트 문장 없음. 이 값은 기기 밖으로 나가지 않는다.
- 실험판은 번들 ID가 달라 별도 저장소다(기존 설정과 동일).

## 6. 문자열 (`messages/*.json` → xcstrings 파이프라인)

앱 전용이라 `ios/i18n/ios-extra/{locale}.json`의 `ios.beacon`·`ios.settings` 아래에 둔다(6개 로케일):

- `ios.beacon.healthSummary`: `이번 구간 {steps}걸음, 약 {kcal}kcal` (positional 변환 → `%1$@`, `%2$@`)
- `ios.beacon.healthDefaultWeight`: `기준 체중 {kg}kg`
- `ios.settings.weightKg`: `칼로리 추정용 체중(kg)`
- `dataSources.walkHealth`(정보 출처 화면 한 행): `걸음 수는 iPhone 만보계, 칼로리는 걸은 거리와 체중으로 계산한 추정치입니다`

문장 조립은 `joinText(healthSummary, usedDefaultWeight ? healthDefaultWeight : nil)`.

## 7. 개인정보·심사

- `NSMotionUsageDescription`: pbxproj 세 구성의 `INFOPLIST_KEY_NSMotionUsageDescription` + `InfoPlist.xcstrings` 6개 로케일. ko: "도보 안내로 도착했을 때 걸은 걸음 수를 보여 주기 위해 동작 및 피트니스 데이터를 사용합니다."
- `PrivacyInfo.xcprivacy`·ASC 영양 라벨·웹 개인정보 페이지: **변경 없음**. 걸음 데이터는 기기 안에서 읽고 표시할 뿐 서버로 보내지 않으며 저장도 하지 않는다(수집 = 기기 밖 전송이라는 Apple 정의). 체중도 UserDefaults 로컬 값이라 동일(UserDefaults required-reason `CA92.1`은 기존 manifest에 이미 선언돼 있다). Required-reason API 목록에 Core Motion은 없다. 걸음·체중·요약은 진단 로그(`GuideDiag`)에도 남기지 않는다 — 앱은 crash/analytics SDK가 없고 진단 로그도 기기 로컬이지만, 건강 값은 아예 기록하지 않는 편이 라벨 판정을 단순하게 유지한다.
- 건강 수치 고지: 칼로리는 추정임을 문장의 "약"과 기본 체중 표기가 말하고, 설정 > 정보 출처에 방법(만보계 실측·거리×체중 추정) 한 행을 둔다(§6). 의료 목적 주장 없음.
- 설계 리뷰 판정: 새 플랫폼 센서 통합 + 권한·심사 경계라 codex 적대적 설계 리뷰 대상(글로벌 규칙 ②③). 결과는 §10에 기록.

## 8. 실험/정식 게이트

플래그 없이 정식판에 바로 들어간다. 근거: 부가 정보 한 줄이고, 못 읽으면 사라지며, 안내 판정·발화 계층을 건드리지 않는다(도착 처리 뒤 비동기 대입만). 실험판에도 같은 코드가 들어간다.

## 9. 테스트·검증

- Kit 단위 테스트 `WalkHealthTests`(§4).
- `BeaconModel` 계약(확정·추정 두 경로 호출, `.car` 미호출, 토큰 불일치 결과 폐기, `clearArrival` 취소, `.failed`만 전경 재조회): `PedometerQuerying` 대역을 주입해 앱 타깃 테스트가 없다면 코드 리뷰로 확인하고, 실기기 검증을 정본으로 한다.
- 시뮬레이터: 만보계가 없어 줄이 **표시되지 않는 것**이 정상 동작이다(3-state).
- 실기기: 도보 안내 1회 완주 후 도착 화면에 줄이 있고, VO로 도착 문장 → 건강 요약 → 주변 확인 순서 확인. 걸음 수는 건강 앱 같은 시간대 값과 대체로 일치하는지 참고 대조(건강 앱은 여러 출처를 병합하므로 정확 일치는 요구하지 않는다). 조회 지연(도착 처리→행 표시)이 착지 400ms 안에 드는지 `GuideDiag`에 걸음 값 없이 지연 시간만 기록해 계측한다.
- 정식·실험 두 구성 실기기 배포.

## 10. 설계 리뷰 판정

codex `exec` 적대적 리뷰(2026-08-17, spec 본문 직접 주입, gpt-5.6 high). 22건(BLOCKER 3·MAJOR 16·MINOR 3).

**반영(설계 변경)**:
- BLOCKER 1·2, MAJOR 11·15 → 활동 칼로리(휴식 대사 제외)로 정의 변경. 시간 항 소거로 `거리×체중×0.5`가 되어 0거리=0kcal, 벽시계 지속시간·정지 시간·속도 상한 문제가 함께 사라짐(§4).
- BLOCKER 3 → 세션 토큰(UUID)+`arrivalDest` 이중 조건 커밋, `start`/`clearArrival`에서 Task 취소(§3).
- MAJOR 6·7·9 → 전경 복귀 시 `.failed` 한정 1회 재조회(§3). MAJOR 13 → 내부 상태 `.unavailable`/`.failed` 분리(UI는 동일 부재, 재시도 여부만 다름).
- MAJOR 10 → 세션 창 전이표 명시(§3). MAJOR 5 → 7일 이력·24h 창 전제 기록. MAJOR 16·17 → UserDefaults 사유 기존 선언 확인, 건강 값 진단 로그 미기록(§7). MAJOR 18·19 → 정보 출처 한 행 + 체중 라벨에 용도(§5·§6). MINOR 21 → 건강 앱 대조는 참고로 격하(§9). MINOR 22 → 프로토콜 주입(§3·§9).

**기각(의도된 결정)**:
- MAJOR 12(비동기 행 발견 가능성): placeholder는 부재 상태에서 제거·문구가 필요해 "부재를 설명하지 않는다"와 충돌하고, 완료 통지·포커스 이동은 도착 문장 착지 계약과 경합한다. 즉시 조회로 착지 전 완료를 겨냥하고 실기기 계측으로 확인(§3·§9).
- MAJOR 14(창 안 걸음 = 이번 구간): 안내 동안 걸은 것이 곧 사용자의 걸음이라 분리하지 않는다(§2). MAJOR 4·8: 서술 정밀화만(계약 변경 없음). MINOR 20: 범위 밖은 기본값으로 정직 표기(기준 체중 문구가 드러낸다).

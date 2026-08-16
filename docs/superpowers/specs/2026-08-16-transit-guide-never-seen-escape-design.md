# 대중교통 안내: 관측되지 않는 잠금의 탈출구 (A16 L2·L3)

> 2026-08-16. 위원장 9호선 급행 실승차 중단(BACKLOG A16)에 대한 설계.
> **이번 범위는 L2·L3이고 L1(급행 정차역 데이터)은 명시적으로 제외한다** — 데이터원 판정이 선행이고 E14와 한 몸이다.

## 1. 무엇이 일어났는가

위원장 보고: *"급행을 타고 가다 동작역에서 일반 열차로 갈아타고 노들역에서 내릴 때까지 아무 변화가 없었다. 탑승 변경을 눌러 봤지만 멈춘 이유를 알 수 없어 그냥 쓰지 않았다."*

계측 로그(`logs/transit-guide-diag-2026-08-16.log`)가 그 35분을 그대로 담고 있다. `signal=notYetVisible→notYetVisible`이 세션 내내 고착이고, 01:34:02의 `boardingReset` → `waitPoll seq=14` → 01:34:11 `boarded`가 **위원장이 탈출을 시도했다가 같은 자리로 돌아온 왕복**이다.

## 2. 결함의 기제 (코드 확정)

### L2 — 첫 관측 전 상태에 시간 상한이 없다

`GildongmuKit/TransitGuide.swift` `handlePoll`:

```swift
if !next.trackingAnnounced {
    if next.signal != .upstreamFailed, next.signal != .signalLost {
        next.signal = .notYetVisible
    }
    next.lastUpdatedAt = now
    return (next, event)          // ← 여기서 조기 반환
}
next.missCount += 1               // ← 한 번도 관측되지 않으면 도달하지 않는다
```

`missCount`가 오르지 않으므로 `transitMissLostCount`(3) 임계에 **도달할 산술적 경로가 없다**. 근접 전 침묵을 정상으로 보는 판단 자체는 옳다. 없는 것은 그 상태를 빠져나오는 문이다.

⚠ 그리고 `transitPollIntervalMs`가 같은 상태에서 주기를 60초로 늘린다(`trackingAnnounced ? 15_000 : 60_000`). **침묵이 길수록 확인 빈도도 낮아지는 방향**이다.

### L3 — 탈출구가 원래 승차역을 본다

`Gildongmu/Directions/TransitGuideModel.swift`:

```swift
let station = phase == .waiting ? leg.boardName : leg.alightName
```

국면이 조회 대상 역을 정한다. 그리고 `handleChangeBoarding`은 `phase`를 `.riding` → `.waiting`으로 되돌린다. **결과적으로 "탑승 변경"은 처음 탔던 역의 도착 목록으로 돌아간다.** 몇 정거장 지난 뒤에는 거기에 맞는 열차가 있을 수 없다.

### 표시 계층도 가담한다

승차 중 화면의 유일한 신호가 `stateNotYetVisible` = **"차량 접근 대기."**다. 대기 국면 어휘라 승차 중에는 "아직 못 탔다"로 뒤집혀 읽힌다.

## 3. 설계

### 3.1 판정 계층(L2) — Kit·웹 미러

**시간 기반이지 폴 횟수 기반이 아니다.** 근거가 로그에 있다: 35분에 폴이 11회뿐이었는데(약 190초 간격) 코드상 주기는 60초라 35회여야 한다. 화면 잠금 중 타이머 정지가 유력하다. 횟수로 세면 **화면을 끄고 걸을수록 시한이 늦게 오는** 거꾸로 된 동작이 된다.

| 추가 | 정의 |
|---|---|
| `TransitGuideState.ridingSince: Double?` | riding 진입 시각(ms epoch). `board`에서 `now`, `changeBoarding`·`advance`에서 리셋 |
| `TransitSignal.neverSeen` | 잠금 이후 **한 번도** 관측되지 않은 채 시한을 넘김 |
| `TransitGuideEvent.neverSeen` | 위 전이 시 1회. `transitEventProfile` → `(false, .weak)`(기존 `signalLost`와 동급) |
| `transitNeverSeenMs: Double = 600_000` | **10분, 잠정 — 실승차 판정 대상** |

판정 위치는 위 조기 반환 블록 안이다:

```swift
if !next.trackingAnnounced {
    if next.signal != .upstreamFailed, next.signal != .signalLost {
        next.signal = .notYetVisible
    }
    next.lastUpdatedAt = now
    if next.signal != .neverSeen, next.phase == .riding,
       let since = next.ridingSince, now - since >= transitNeverSeenMs {
        next.signal = .neverSeen
        return (next, .neverSeen)
    }
    return (next, event)
}
```

**불변식 넷**:
1. **1회성이다.** `signal != .neverSeen` 가드가 반복 발화를 막는다(`signalLost`·`upstreamFailed` 동형).
2. **`upstreamFailed`·`signalLost`를 덮지 않는다.** 조회 자체가 실패 중이면 원인이 다르고, 그 둘은 이미 자기 통지를 냈다.
3. **riding 국면 전용.** 대기 중 미등장은 정상이고 이미 다른 어휘를 쓴다.
4. **관측이 한 번이라도 있었으면 이 경로에 오지 않는다** — `trackingAnnounced`가 true면 기존 `missCount` 축이 담당한다. 두 축이 같은 결함을 잡지 않는다.
5. **회복은 신규 코드가 없다.** 뒤늦게 관측되면 `commitMatched`가 `signal = .tracking`으로 덮고 `wasTracking == false`이므로 `trackingStarted`가 나간다 — 사용자에게는 "찾았다"가 된다. ⚠ 같은 함수의 "동일 스냅숏 무정보 폴" 조기 반환은 `signal`을 갱신하지 않지만, 그 분기는 직전 커밋(`base.dataStamp`)을 전제하므로 `neverSeen`(정의상 커밋 0회) 상태에서는 **도달 불가**다. 이 무해함이 우연이 아니라 전제에서 나온다는 것을 기록해 둔다 — `neverSeen`을 `trackingAnnounced == true`로도 낼 수 있게 확장하면 그 순간 깨진다.

⚠ **`neverSeen`을 `signalLost`로 합치지 않는 이유는 사용자 행동이 다르기 때문이다.** 보다가 놓친 것은 기다리면 돌아오지만, 한 번도 못 본 것은 기다려도 안 온다(잠근 열차가 그 역에 서지 않거나 다른 열차를 탔다). 문구도 제안도 갈려야 한다.

### 3.2 탈출구(L3) — 앱 계층, Kit 무변경

**Kit 상태 머신은 어느 역을 조회할지 모른다** — 폴 *결과*만 받는다. 조회 대상 역은 앱이 정해 fetch하므로 **L3는 Kit 계약도 공유 fixture도 건드리지 않는다.**

- 앱 상태 `boardOverrideName: String?` 추가. `changeBoarding` 흐름이 세팅하고, `board`(재잠금) 성공·`advance`·세션 종료에서 nil로 되돌린다.
- 조회 역 결정을 `state.boardOverrideName ?? leg.boardName`으로 바꾼다(waiting 국면 한정. riding은 `leg.alightName` 유지 — 그쪽은 L1 영역이라 이번 범위 밖이다).
- 🚨 **조회 역만 바꾸면 안 된다**(2026-08-16 독립 리뷰 MAJOR — **이 문단이 초판 spec의 구멍이었고 두 플랫폼이 똑같이 그 구멍을 복제했다**): 같은 waiting 국면의 **상시 표시·진행 상황 발화 문맥**(`waitContextText`)도 기준 역을 따라가야 한다. 어긋나면 화면·음성은 "천호역에서 승차 대기"라고 말하는데 그 아래 목록은 왕십리 도착 정보인 상태가 된다. **목록 항목에는 역명이 없으므로**(전 목록이 한 역 기준이라는 전제) SR 사용자에게는 그 문장이 **화면의 유일한 역 정보원**이고, `announceProgress`로 재확인해도 같은 거짓이 재확인된다 — A16이 고치려던 혼란을 새 UI가 재생산한다.
- ⚠ **선행 도보 문구는 함께 떨군다.** `waitContextWalk`("3분 걸어 {역}에서")의 도보는 **원래 승차역까지의 구간**이라 재선택 시점에는 이미 지난 일이다. 역명만 갈아 끼우면 "3분 걸어 왕십리역에서"라는 새 거짓이 된다.
- **판별 규칙(다음에 같은 실수를 막는 것)**: 조회 대상을 바꾸는 기능은 **그 조회 결과를 설명하는 모든 문장**을 함께 옮긴다. 판정선은 "이 문장이 무엇을 조회했는지 말하는가"이고, 이는 [[status-bar-promises-the-screens-data-source]]("표시줄은 그 화면의 조회 기준이라는 약속")의 같은 계열이다.
- 역 후보는 **`leg.viaStops`**다. `TransitGuideModel`이 이미 `includeStops: true`로 조회하므로 **신규 데이터원이 0건**이다.

**흐름**: "탑승 변경" → 역 선택 단계("지금 어느 역에 계신가요?") → 선택 → 그 역 도착 목록 → 열차 선택 → 재잠금.

⚠ **위치 기반이 아닌 이유**(위원장 판정 2026-08-16): 지하철 안에서 GPS가 잡히지 않는다. 역 목록은 지하·지상 무관하게 항상 성립하고, 역 이름은 안내방송으로 사용자가 이미 아는 정보다.

⚠ **`viaStops`가 급행 정차역이 아니라는 것은 이 용도에서 결함이 아니다.** 사용자가 지금 서 있는 역은 완행 목록에 반드시 포함된다. 급행이 서지 않는 역이 섞여 있는 문제는 E14 ①의 몫이다.

### 3.3 문구

| 키 | ko | 성격 |
|---|---|---|
| `transitGuide.neverSeen` | "탑승하신 차량을 찾지 못하고 있습니다. 다른 차량을 타셨다면 탑승 변경을 눌러 주세요." | 통지 |
| `transitGuide.stateNeverSeen` | "차량 확인 안 됨." | 표시 |
| `transitGuide.stateRidingNotYetVisible` | "차량 위치 확인 중." | 표시(승차 중 `notYetVisible` 전용) |
| `transitGuide.reboardStationPrompt` | "지금 어느 역에 계신가요?" | 역 선택 단계 헤딩 |

⚠ **통지 뒷문장은 꼬리 문장 금지 규칙에 걸리지 않는다.** 판정선은 "뒷문장이 새 정보를 주는가"이고, 이 문장은 재시도 권유가 아니라 **행동 경로**를 알린다(백로그가 명명한 제거 대상은 "잠시 후 다시 시도해 주세요" 계열이다).

⚠ **어휘는 "차량"으로 중립화한다** — 기존 `signalLost`("차량 신호를 찾지 못하고 있습니다")가 이미 그 어휘를 쓰고, 버스·지하철이 한 문자열을 공유한다.

i18n은 6개 로케일(`messages/*.json`) + iOS xcstrings 파이프라인을 지난다([[gildongmu-ios-i18n-architecture]]).

### 3.4 접근성 계약

- **역 선택 목록 포커스**: repo 정본(가시화 → 지연 → 경합 해제 → 대입 → 검증 → 1회 재시도)을 따른다. `.accessibilityFocused`에 **Bool 바인딩 금지**, 항목 정체성 옵셔널 바인딩. ⚠ 시뮬레이터로는 검출 불가라 실기기 VO가 판정이다.
- **`neverSeen` 통지 우선순위**: 기본 우선순위로 둔다. 자기 소멸 버튼이 없고 포커스 이동을 유발하지 않으므로 잠식 패턴에 해당하지 않는다(대비: `performReroute`는 `.high`가 정답이었다).
- **역 선택 진입 시 포커스**: 헤딩(`reboardStationPrompt`)에 착지. 목록 첫 항목이 아니라 헤딩인 이유는 "무엇을 고르는지"가 먼저 와야 하기 때문이다.
- 취소하면 포커스가 "탑승 변경" 버튼으로 복귀한다.

## 4. 미러·게이트

| 면 | 무엇 |
|---|---|
| Kit `TransitGuide.swift` | 3.1 전량 |
| 웹 `src/lib/transit-guide.ts` | 3.1 전량(1:1 미러) |
| 공유 fixture `transit-guide-scenarios.json` | 신규 시나리오 3종(아래) |
| iOS `TransitGuideModel`·`TransitTrackingSheet` | 3.2·3.3 |
| 웹 `useTransitGuide`·`TransitGuidePanel` | 3.2·3.3 — **상태 머신이 미러라 한쪽만 두면 웹에 죽은 상태가 생긴다** |

**신규 fixture 시나리오**:
1. 탑승 후 시한 경과까지 `empty` 연속 → `neverSeen` 1회 → 이후 폴은 무통지(1회성 검증).
2. 시한 직전 첫 관측 → `trackingStarted` → 이후 `neverSeen`이 영영 발화하지 않음(축 배타 검증).
3. `upstreamFailed` 중 시한 경과 → `neverSeen`으로 덮지 않음(3-state 보존).

**변이 주입 실측 완료**(2026-08-16, 웹 5종). 결과가 갈렸고 그 갈림 자체가 기록 대상이다:

| 변이 | 검출 | 검출한 층 |
|---|---|---|
| `!recovered` 가드 제거 | ✅ | fixture(복구 폴 시나리오) |
| 확정 신호 보존에서 `neverSeen` 제거 | ✅ | fixture(반복 발화 시나리오) |
| `ridingSince != null` 제거 | ✅ | **타입 검사**(TS18047) — vitest는 통과시킨다 |
| 1회성 가드를 `!== "neverSeen"`으로 완화 | ⚠️ 없음 | 위 "확정 신호 보존"과 **중복**이라 등가 |
| `phase === "riding"` 제거 | ⚠️ 없음 | **도달 불가 방어**(waiting 조기 반환) |

⚠ **검출되지 않은 둘을 지우지 않되, 검증된 가드인 척하지도 않는다.** 코드 주석에 그 사실을 적었다 — [[defensive-code-needs-measured-effect]]가 경고하는 것은 방어 코드 자체가 아니라 **효과 없는 방어가 검증된 인상을 남기는 것**이다. `phase === "riding"`을 남기는 근거는 이 축의 불변식을 다른 블록의 조기 반환에 의존하지 않고 자립적으로 표현하는 것이고, 그것은 테스트가 아니라 가독성의 값어치다.

## 5. 설계 리뷰 판정

**적대적 리뷰 생략.** 판정 기준 4축 대조:
- ①새 판정 계층 신설? **부분 해당하나 신설이 아니라 기존 축의 결손 보완**이다 — `signalLost`와 같은 층·같은 모양(임계 초과 시 1회 통지)이고 상태 머신 구조를 바꾸지 않는다.
- ②새 외부 통합의 계약 가정? **아니다** — 신규 데이터원 0건.
- ③비가역·고파급? **아니다** — 국소·가역이고 저장 포맷·보안 경계 무관.
- ④안전·정확성 크리티컬? **해당한다.** 다만 이 변경의 방향은 **침묵을 정직한 발화로 바꾸는 것**이라 오작동의 최악이 "조금 이르거나 늦은 안내 1회"다. 잘못된 안내를 새로 만들지 않는다.

④에 걸리므로 **구현 단계 독립 리뷰는 반드시 수행**하고, 상수는 실승차 판정 전까지 잠정으로 표기한다.

## 5.1 구현 리뷰 결과 (2026-08-16)

**코드 품질 리뷰 — 통과(지적 2건 반영, 커밋 `487820e`)**
- **MAJOR**: 대기 문맥 문장이 재선택한 기준 역을 따라가지 않았다 → §3.2에 그 계약을 추가하고 양 플랫폼 수정 + 회귀 테스트(변이로 검출 확인). **이것은 구현 실수가 아니라 spec의 구멍이었고**, 두 플랫폼이 똑같이 복제했다는 사실이 그 증거다.
- **MINOR**: iOS 취소 복귀 포커스가 이 파일 자신의 정본(가시화 → 지연 → 대입 → 검증)을 이 자리만 어기고 동기 대입이었다 → `landChangeBoardingFocus()`로 교체.

**spec 준수 리뷰 — 무응답(2회 요청). 컨트롤러가 직접 검증했고 범위는 다음과 같다**([[freeze-artifact-before-review-dispatch]] 규율상 이 대체 사실을 기록한다):
- **웹↔Kit 미러 동형**: 판정 블록의 조건 순서·가드 집합이 문자 단위로 일치(보호 목록 3종 → `!recovered` → `signal == notYetVisible` → `phase == riding` → 기준 시각 존재 → 시간). 상수 600,000 동일. `ridingSince` 대입 지점 4곳(초기화·board·changeBoarding·advance) 일치. 문맥 문장 분기도 동형.
- **불변식**: ①1회성 ②원인이 다른 신호 비덮음 ⑤회복 무신규코드는 fixture 3종 + 변이 주입으로 검출 확인. ③`phase == riding`은 **도달 불가 방어**로 실측됐고 그 사실을 코드 주석에 남겼다(§4 표). ④는 `trackingAnnounced` 분기 구조가 보장.
- **문구**: 신규 5키가 6로케일 + iOS 카탈로그에 전부 존재(`check-xcstrings-keys.mjs` 누락 0).
- ⚠ **한계**: 이 검증은 구현자가 자기 산출물을 본 것이라 **관점 비대칭이 없다**. spec 리뷰가 잡았을 법한 "요구사항 자체의 누락"은 이 경로로 잡히지 않는다 — 실제로 이번 MAJOR가 정확히 그 유형이었고 그것을 잡은 것은 독립 리뷰였다.

## 6. 판정 대기 (실승차)

1. **`transitNeverSeenMs` 10분이 적절한가.** 근거: 지하철 도착정보는 대개 잔여 3정거장 이내부터 나오므로 승차 직후 침묵은 정상이고, 역간 2~3분 × 3정거장 = 6~9분. 너무 짧으면 정상 침묵을 고장이라 부르고, 너무 길면 이번 사고가 재현된다.
2. **통지가 실제로 들리는가** — 다른 안내 채널과 경합하지 않는지.
3. **역 선택 목록이 실승차에서 쓸 만한가** — 항목 수(경유역 전량)가 스와이프 부담이 되는지. 부담이면 "현재역 부근만" 같은 축이 후속이다.
4. **재잠금 후 실제로 안내가 살아나는가** — 갈아탄 일반 열차는 하차역에 서므로 성립해야 한다. 성립하지 않으면 L1 가설이 강화된다.

## 7. 이번 범위 밖 (백로그 유지)

- **L1 급행 정차역 데이터**: E14와 한 몸. 데이터원 판정이 선행이고 설계 리뷰 대상.
- **화면 잠금 중 폴링 타이머 정지 의혹**: 로그 산술(35분/11회)이 근거이나 별도 축이다. 이번 시간 기반 판정은 **그 결함이 존재해도 올바르게 동작한다**(그것이 시계를 고른 이유다).
- **riding 국면 계측 부재**: `logWaitingPoll`이 대기 전용이라 riding 폴이 `empty`였는지 매칭 실패였는지 못 가른다. L1 착수 시 함께 연다.

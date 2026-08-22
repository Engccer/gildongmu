# 대중교통 실시간 안내 "진행 상황 조망" (E15-1) 설계

2026-08-23 확정. `docs/BACKLOG.md` E15의 첫 능력이며 병렬 브리프 `docs/superpowers/plans/2026-08-23-feedback-260822-parallel-plan.md` §1 E15-1 행을 구현한다. 선행 설계: 도보 조망·대안 프리뷰(`2026-08-14-guide-alternative-preview-design.md`), A16 L2·L3(`2026-08-16-transit-guide-never-seen-escape-design.md`), 승차 국면(`2026-08-22-transit-boarding-phase-design.md`).

## 0. 전제 (위원장·코디네이터 판정 — 여기서 재논의하지 않는다)

1. **시트를 통합하지 않는다.** 도보·자동차 시트와 대중교통 시트는 국면·행 구성이 달라 통합 셸이 분기 주머니가 된다(BACKLOG E15 권고). 공유 단위는 **능력**이다.
2. **추상화를 먼저 발명하지 않는다** — 조망 능력 하나를 두 수단에 붙이면서 프로토콜을 **발견**한다. 이번에 정의하는 프로토콜은 조망이 실제로 요구하는 것만 담고 **조망 전용으로 봉인**한다. 주변 확인·톤은 자기 프로토콜을 새로 둔다(같은 분할 원리 — 판정은 Kit 순수 함수, 배선은 앱 프로토콜).
3. 조망은 **셸 공유, 행 생성기만 교체**(leg + 정차역). "지금 여기"는 현재역이다.
4. **대안 전환 버튼은 조망 안에 산다**(2026-08-14 판정 2 "전환의 자리는 진행 상황 조망" — 대중교통 적용). 미리 보고 전환(A안).
5. A16 L2가 **설명만 해 둔 침묵**(10분 뒤 `neverSeen`)을 이 화면에서 실제로 해소한다 — 침묵의 원인 설명과 탈출구(탑승 변경)가 같은 화면에 있다.
6. 산출물 검증은 실험판(`Experimental`)이다 — 대중교통 안내가 `experimentalGuidanceEnabled` 봉인 중이다. 봉인은 유지한다.

## 1. 성과 정의 (무엇이 측정 가능하게 나아지는가)

- **실승차 중 "지금 어디쯤인가"에 한 번의 활성화로 답한다.** 지금 대중교통 시트의 "진행 상황" 버튼은 상태 한 문장만 낭독한다(`announceProgress`). 이후엔 도보와 같은 조망 시트가 열려 **헤더 착지 한 문장 + 구간 목록 + 현재 구간의 정차역 목록("지금 여기" 표식)** 을 스와이프로 훑을 수 있다.
- **침묵에 출구가 생긴다.** 잠긴 열차가 10분째 안 보일 때(A16 L2) 사용자가 듣는 것은 통지 한 문장뿐이고, 그 통지가 가리키는 "탑승 변경"은 시트 어딘가에 있다. 이후엔 조망 헤더가 침묵 상태를 말하고, 바로 다음 행에 설명과 "탑승 변경"이 있다.
- **경로를 바꿀 수 있다.** 지금은 "목적지 바꾸기"로만 경로가 바뀐다(같은 목적지의 다른 경로는 세션을 끝내고 다시 시작해야 한다). 이후엔 조망에서 **현재 위치 기준 대안 경로를 미리 보고 전환**한다.
- 판정 도구: FIELD-TEST §5-4(§10) 실승차 + 실기기 VO 착지 로그.

## 2. 능력 프로토콜 — Kit/앱 경계 판정

### 2.1 두 계층으로 가른다

| 계층 | 위치 | 내용 | 미러 |
|---|---|---|---|
| **판정(순수)** | Kit `TransitProgressOverview.swift` ↔ 웹 `src/lib/transit-progress-overview.ts` | `state`·`route`에서 조망 **디스크립터**(행 목록·순서·"지금 여기"·탈출구 제안 여부·대안 제안 여부)를 만든다. 문자열을 만들지 않는다(guide-live-rows 동형) | 공유 fixture `transit-progress-overview-scenarios.json`이 두 구현의 디스크립터 JSON 동일을 강제 |
| **능력 프로토콜 + 셸(SwiftUI)** | 앱 `ios/Gildongmu/Directions/GuideOverviewSheet.swift` | `GuideOverviewCapability` 프로토콜, 공유 셸 `GuideOverviewSheet`, 어댑터 2종 | 미러 없음(웹은 셸을 공유할 뷰가 없다 — §8) |

### 2.2 프로토콜이 앱에 있는 근거 (판정 기록)

Kit은 "React/Next 비의존 순수 로직 ↔ 웹 `src/lib` 미러" 층이다. 프로토콜의 양 끝은 **앱 모델(`BeaconModel`·`TransitGuideModel`, 둘 다 앱 타깃)** 과 **SwiftUI 셸**이라 Kit에 두면 Kit이 제공자도 소비자도 없는 인터페이스를 들게 된다(앱 전용 헬퍼 `appLocalized`·`distanceText`·`GuideSession`도 Kit에서 못 쓴다). 판정이 필요한 것(어느 행을, 어느 순서로, 어디가 지금인가)은 전부 §3의 순수 계층에 있고 그것만 Kit·웹 미러·fixture 대상이다. **프로토콜은 판정이 아니라 배선이다.** 미래 능력(주변 확인·톤)도 같은 분할을 따른다: 판정은 Kit 순수 함수, 배선은 앱 프로토콜.

도보 조망이 `BeaconTrackingSheet.swift`의 `private struct`인 것은 "공유를 금지한다"는 뜻이 아니라 공유할 두 번째 소비자가 없었다는 뜻이다 — 두 번째 소비자가 생기는 이번에 파일을 옮긴다(§9 소유권).

### 2.3 프로토콜 정의 (조망 전용으로 봉인)

```swift
/// 진행 상황 조망 능력(E15-1). 뷰는 이 프로토콜만 안다. 능력이 없는 세션은
/// 트리거 자체가 안 나온다(죽은 버튼 금지 — 키 게이트 동형).
/// ⚠ 조망 전용이다. 다음 능력(주변 확인·추세 톤)은 **자기 프로토콜**을 새로 둔다 —
/// 이 프로토콜을 넓히면 셸이 능력 종류별 분기 주머니가 된다(설계 리뷰 §12 P1).
@MainActor protocol GuideOverviewCapability: AnyObject, Observable {
    /// 헤더 한 문장 — 시스템 헤더 착지가 이 문장을 낭독한다(별도 통지 없음).
    var overviewHeaderText: String { get }
    /// 본문 행(한 행 = 한 접근성 객체). 순서가 읽기 순서다. `id`는 안정적이어야
    /// 한다(폴마다 문구가 바뀌어도 행 정체성은 유지 — 포커스가 튕기지 않게).
    var overviewRows: [GuideOverviewRow] { get }
    /// 행 목록 뒤 슬롯의 행동(대안 보기). 없으면 [].
    var overviewActions: [GuideOverviewAction] { get }
    /// 행동 실행 — **활성화 시점에 최신 상태로 재검증**한다. 행을 만든 시점과 누른
    /// 시점 사이에 국면이 바뀌었으면 `.stale`(셸은 아무것도 덧붙이지 않는다 — 그
    /// 전이가 이미 통지·착지를 했다). 조망을 떠나야 하는 행동은 `.dismissThen(…)`으로
    /// 부모에 위임한다(§4.3 "닫힌 뒤 행동" 계약).
    func perform(_ actionId: String) -> GuideOverviewActionResult
}

enum GuideOverviewRow: Identifiable {
    case text(id: String, String)             // 평문 행
    case action(id: String, label: String)    // 버튼 행(침묵 탈출구 등) — 실행은 perform
}

struct GuideOverviewAction: Identifiable {
    let id: String
    let label: String
    /// 눌렀을 때 셸이 띄울 하위 화면. nil이면 perform만.
    let presents: GuideOverviewSubsheet?
}

enum GuideOverviewActionResult {
    case performed
    case stale
    /// 조망을 닫고 나서 부모가 실행한다(탈출구·전환 성공·도착 전이 착지).
    case dismissThen(GuideOverviewFollowUp)
}
```

- `overviewRows`가 `text`/`action` 두 종류뿐인 이유: 도보(스텝·경유지 구획·"지금 이 구간")와 대중교통(도보·구간·정차역·침묵 설명·탈출구)이 전부 "평문 한 줄" 또는 "버튼 한 줄"로 환원된다. 행 종류를 수단별 enum으로 늘리면 셸이 분기 주머니가 된다(전제 1).
- 셸은 **문자열을 받는다.** i18n·거리 낭독 정정(`distanceText`)은 어댑터가 끝낸다 — 셸이 `distanceText`를 일괄 적용하면 대중교통 행(거리 없음)까지 정규식을 지나지만 무해하므로 셸이 모든 행을 `distanceText`로 렌더한다(도보 행이 지금 그렇게 렌더된다).
- 하위 화면(`GuideOverviewSubsheet`)은 **도보 대안 프리뷰**와 **대중교통 대안 목록** 둘이다. 프리뷰 골격은 2026-08-14 §3을 그대로 옮기고, 대중교통 대안 목록은 §5. 둘을 한 뷰로 합치지 않는다(국면·데이터가 다르다 — 전제 1의 하위판).

### 2.4 어댑터

- `BeaconOverviewAdapter(model: BeaconModel)`: 지금 `RouteOverviewSheet`가 `model`에서 직접 읽던 것(`progressText()`·`routeStepDescriptions`·`routeWaypointRow`·`currentStepIndex`·`alternativePreviewAvailable`)을 그대로 행·행동으로 투영한다. **동작 변경 0** — 파일 이동과 어댑터 삽입뿐(코디네이터 조건). `BeaconModel.swift`는 건드리지 않는다.
- `TransitOverviewAdapter(model: TransitGuideModel)`: §3 디스크립터를 §4 문구로 렌더한다. 모델이 프로토콜을 직접 채택하지 않고 어댑터를 두는 이유는 대칭(도보 쪽이 어댑터여야 하므로)과, 모델이 뷰 문구 조립까지 들지 않게 하기 위해서다.

## 3. 순수 계층: `transitProgressOverview(state, route)`

입력은 `TransitGuideState`의 부분집합과 `TransitGuideRoute`. 출력:

```ts
interface TransitOverview {
  /** 구간 서수(1-based)와 총수 — 헤더 앞머리. */
  legOrdinal: { n: number; count: number };
  rows: TransitOverviewRow[];
  /** "지금 여기"의 근거(3-state). 표시·출발점 앵커(§5.3)가 둘 다 이 값을 읽는다. */
  here:
    | { kind: "station"; stopIndex: number }            // 신선한 추적 관측, 유일 매칭
    | { kind: "notApplicable"; reason: "phase" | "bus" } // 승차 전·도착 후 / 위치 필드가 없는 수단
    | { kind: "unknown"; reason: "noObservation" | "signalLost" | "upstreamFailed" | "ambiguous" | "arrivedUncertain" };
  /** 침묵 탈출구(탑승 변경) 행을 조망에 낸다. */
  reboardOffered: boolean;
  /** 대안 경로 보기 행동을 낸다. */
  alternativesOffered: boolean;
}
type TransitOverviewRow =
  | { kind: "walk"; minutes: number }
  | { kind: "leg"; legIndex: number; mode: "bus" | "subway"; lineName: string;
      boardName: string; alightName: string; status: "done" | "current" | "upcoming";
      stationCount: number | null }
  | { kind: "stop"; stopIndex: number; name: string; role: "board" | "via" | "alight"; here: boolean }
  | { kind: "stopsUnavailable" }                       // 현재 구간 정차역 정보 없음(빈 배열 ≠ 0건)
  | { kind: "silence"; signal: "neverSeen" | "notYetVisible" | "signalLost" | "upstreamFailed" };
```

규칙:

1. **행 순서** = 경로 순서. 각 leg 앞에 `walkBeforeMinutes`가 있으면 `walk` 행, leg 행, **현재 구간에만** 그 leg의 `viaStops` 전체를 `stop` 행으로 펼친다(지난·예정 구간은 leg 행 하나 — 조망이 정차역 전부를 나열하면 환승 2회 경로에서 60행이 넘는다). 마지막 leg 뒤 `walkAfterMinutes`가 있으면 `walk` 행. 현재 구간의 `viaStops`가 비어 있으면 `stop` 행 대신 `stopsUnavailable` 행 1개 — 탑승 leg에 정차역이 0개인 경우는 없으므로 빈 배열은 언제나 "정보 없음"이다(3-state).
2. **status**: `legIndex < state.legIndex` → done, `==` → current, `>` → upcoming. `phase == done`이면 전부 done.
3. **here는 신선한 추적 관측에서만 나온다.** `kind: "station"`의 필요충분조건: `phase == riding` ∧ `signal == tracking` ∧ `leg.trackMode == subway` ∧ 정규화 역명 매칭이 **정확히 1건**. 그 stop 행만 `here: true`. 그 외:
   - `phase ∈ {waiting, boarding, done}` 또는 `phase == arrived ∧ arrivedCertain` → `notApplicable("phase")` — 승차 전은 도보 중일 수 있고(헤더가 "탑승 대기"를 말한다), 확정 도착은 헤더가 "도착"을 말한다. ⚠ **확정 도착이라도 하차역 stop 행에 `here`를 찍지 않는다** — `currentLocation`은 마지막 관측값이라 직전 역일 수 있고, 도착 판정이 보장하는 것은 `alightName`뿐이다(설계 리뷰 B2).
   - `phase == arrived ∧ !arrivedCertain` → `unknown("arrivedUncertain")`.
   - `trackMode != subway` → `notApplicable("bus")` — `currentLocation`이 우연히 와도 무시한다(필드 출처에 대한 주석 의존 금지, 리뷰 M3).
   - riding ∧ signal ∈ {notYetVisible, neverSeen} → `unknown("noObservation")`, signalLost → `unknown("signalLost")`, upstreamFailed → `unknown("upstreamFailed")`. ⚠ **소실·실패 중엔 `state.currentLocation`이 남아 있어도 표식하지 않는다** — 한 화면이 "위치를 모른다"(silence 행)와 "현재 위치는 강동역"을 동시에 주장하면 안 된다(리뷰 B1).
   - 매칭 2건 이상(순환·반복 경로 동명 정차) → `unknown("ambiguous")`(리뷰 M4).
   - 없는 표식은 거짓이 아니지만 있는 표식은 거짓일 수 있다 — 의심스러우면 안 찍는다.
4. **silence**: `phase == riding`이고 `signal ∈ {notYetVisible, neverSeen, signalLost, upstreamFailed}`이면 현재 leg 행 **바로 뒤**(정차역 목록 앞)에 `silence` 행 1개. tracking이면 없다. `untrackable`은 riding에 도달하지 않고(잠금 없이 수동 전진만) 시트가 이미 수동 전진 문구를 내므로 조망엔 없다.
5. **reboardOffered** = `phase == riding` ∧ `leg.trackMode != tagoBus` ∧ `signal ∈ {notYetVisible, neverSeen, signalLost, upstreamFailed}`. 앞 두 조건은 **시트의 "탑승 변경" 노출 조건과 같은 술어**다(`beginReboard()`가 지하철은 역 선택으로, 서울버스는 곧장 재선택으로 가른다 — 수단 분기는 모델이 이미 갖고 있어 여기서 재발명하지 않는다, 리뷰 M5). 세 번째 조건이 조망의 탈출구를 **침묵일 때만** 내는 이유: 추적 중엔 시트의 버튼이 정본이고, 조망까지 내면 같은 버튼이 두 화면에 상시로 떠 전환 압박이 된다(2026-08-14 판정 1 동형). 신호 집합은 silence 행과 **같은 집합**이라 탈출구 행은 언제나 silence 행 바로 뒤에 놓인다(리뷰 m1).
6. **alternativesOffered** = `phase != done`. 목적지 좌표는 세션 불변식이다(`start(dest:)`가 비옵셔널) — 어댑터가 별도로 AND하지 않는다(조용한 false 금지, 리뷰 M-dest).

고정 fixture 시나리오(최소 12): 단일 leg waiting / 환승 2회 riding 현재역 있음(가운데 leg) / riding notYetVisible(여기 unknown·silence·탈출구) / riding neverSeen / riding signalLost **+ currentLocation 잔존**(here unknown이어야 한다) / 버스 riding + 매칭되는 currentLocation(here notApplicable·탈출구는 seoulBus면 silence 시만) / 동명 정차 2건(ambiguous) / arrived 불확실(here unknown, 대안 있음) / arrived 확정(here notApplicable) / done / viaStops 빈 현재 leg(stopsUnavailable) / untrackable leg(silence 없음). 변이 주입 4건: 규칙 3의 `signal == tracking` 제거 · 유일성 제거 · 규칙 5의 `tracking` 제외 제거 · 규칙 1의 빈 배열 분기 제거 — 각각 fixture가 깨져야 한다. 결과는 §10에 적는다.

## 4. iOS 셸과 대중교통 어댑터

### 4.1 셸 `GuideOverviewSheet`

도보 `RouteOverviewSheet`의 골격을 그대로 일반화한다: `List { Section { 상단 닫기 · rows · actions · 말미 닫기 } header: { headerText(.isHeader) } }`. 상단 닫기·말미 닫기 근거는 2026-08-10 위원장 판정(기존 주석 유지). 하위 시트는 `.sheet(item:)` 하나로 `GuideOverviewSubsheet`를 띄운다. 닫힘 시 `onSubsheetDismiss`를 어댑터에 알려 진행 중 조회를 폐기한다(도보 `closeAlternativePreview`, 대중교통 `cancelAltRoutes(token:)` — 2026-08-14 §3 latest-wins 동형).

헤더는 **live region이 아니다**(조회형 정보). 폴이 와서 헤더·행 문구가 바뀌어도 통지하지 않는다.

**행 정체성은 조망이 열려 있는 동안 고정된다**(리뷰 F3). `silence`·탈출구 행은 한 번 렌더되면 같은 조망 수명 안에서 사라지지 않는다 — 어댑터가 래치한다. 추적이 회복되면 silence 행 **문구만** `transitGuide.signalRecovered`로 바뀌고 탈출구 행은 남는다(riding에서 탑승 변경은 언제나 유효하다 — 규칙 5는 *노출 시점*의 판정이지 유효성 판정이 아니다). 포커스가 얹힌 행이 폴 한 번에 사라지는 경로를 구조로 막는 것이고, 다음에 조망을 열면 래치는 새로 시작한다.

### 4.2 대중교통 어댑터 문구 (ko 정본, 6로케일)

| 디스크립터 | 문구 | 키 |
|---|---|---|
| 헤더 | "{count}구간 중 {n}번째 구간. " + `statusLineText(state, leg)` | `transitGuide.overviewOrdinal` + 기존 조립기 |
| walk | "도보 약 {minutes}분" | `transitGuide.overviewWalk` |
| leg done | "{n}. {line}, {board}에서 {alight}까지, 완료" | `transitGuide.overviewLeg` + `overviewLegDone` |
| leg current | "{n}. {line}, {board}에서 {alight}까지, 지금 이 구간" (+ ", 약 {stationCount}정거장" stationCount 있을 때) | `overviewLeg` + `overviewLegCurrent` + 기존 `stationCountAbout` |
| leg upcoming | "{n}. {line}, {board}에서 {alight}까지, 예정" | `overviewLeg` + `overviewLegUpcoming` |
| stop | "{name}, 승차/하차, 현재 위치" | 기존 `viaBoard`·`viaAlight`·`viaCurrent`(시트 경유역 목록과 같은 어휘 — 드리프트 방지) |
| stopsUnavailable | "정차역 정보가 없습니다." | `transitGuide.overviewStopsUnavailable` |
| silence neverSeen | 기존 `transitGuide.neverSeen` 문장 | 재사용 |
| silence notYetVisible / signalLost / upstreamFailed | 기존 `stateRidingNotYetVisible` / `stateSignalLost` / `stateUpstreamFailed` | 재사용 |
| silence(회복 뒤 래치) | 기존 `transitGuide.signalRecovered` | 재사용 |
| 탈출구 행 | "탑승 변경" | 기존 `transitGuide.changeBoarding` |
| 대안 행동 | "다른 경로 보기" | `transitGuide.viewAlternatives` |

조립은 `joinText`(쉼표, 한 줄 = 한 객체). 헤더가 `statusLineText`를 재사용하는 이유는 §12.3 드리프트 차단 — 상시 표시·진행 상황 통지·조망 헤더가 **한 조립기**를 지난다.

**탈출구 행(`reboardOffered`)**: `silence` 행 바로 뒤의 `action` 행. `perform`은 `phase == riding`을 재검증해(아니면 `.stale`) `.dismissThen(.beginReboard)`를 돌려준다. 부모 시트가 조망 `onDismiss`에서 `model.beginReboard()`를 실행한다 — 지하철은 `reboardStationPicker`의 `.task`가 프롬프트에 착지하고(A16 L3 기존 계약), 서울버스는 `waiting` 전이의 기존 `waitingLabel` 착지가 맡는다. ⚠ 조망이 열린 채 `beginReboard()`를 부르면 부모의 `waiting` 착지와 프롬프트 착지가 모달 뒤에서 경쟁한다(리뷰 F4) — **닫힌 뒤 행동**이 계약이다. 역 목록을 조망 안에 또 그리지 않는다(같은 목록이 두 화면에 있으면 L3의 포커스 계약이 두 벌이 된다).

### 4.3 부모 시트 배선 (`TransitTrackingSheet`) — "닫힌 뒤 행동" 계약

- "진행 상황" 버튼: `showOverview = true`**만**. `announceProgress()`를 부르지 않는다 — 조망 헤더 착지가 같은 문장을 낭독하므로 통지를 먼저 내면 둘이 서로를 잠식한다(리뷰 F1). `announceProgress`는 웹과 도보 간략 세션이 쓰므로 모델에 남긴다.
- `.sheet(isPresented: $showOverview, onDismiss: runPendingOverviewFollowUp) { GuideOverviewSheet(capability: TransitOverviewAdapter(model)) }`.
- **조망이 열린 동안 국면이 바뀌면 조망을 닫는다**(`onChange(phase)`에서 `showOverview = false`) — 열려 있던 행·행동은 그 국면의 것이라 낡았다. 그 전이가 요구하는 착지(기존 `onChange(phase)` 분기: arrived→advance, →waiting→waitingLabel, →boarding→confirmBoarded, →riding→changeBoarding/advance)는 **즉시 수행하지 않고** `pendingFollowUp = .land(target)`에 적어 두었다가 `onDismiss`에서 `landControlFocus`를 부른다. 조망이 닫혀 있을 때는 종전대로 즉시 착지. ⚠ `showOverview = false` 대입은 dismiss 완료가 아니다(리뷰 F2) — 모달 뒤의 컨트롤에 착지하면 조용히 되돌아간다.
- 이미 `arrived`인 상태에서 조망을 여는 것은 **허용**한다(불확실 도착에서 "지금 어디인가·다른 경로"는 정당한 질문이다). 자동 소거는 전이 시점에만 일어난다(리뷰 F5 — "진입 시 닫기"와 "열 수 없음"을 구분).
- 세션 종료(`state == nil`)·`done` 전이도 조망을 닫는다(핸드오프 착지는 기존 `onChange(pendingWalkHandoff)`가 맡되 같은 지연 규칙).
- `.dismissThen(followUp)` 결과는 `pendingFollowUp`에 적고 `showOverview = false`. `onDismiss`가 한 곳에서 실행한다: `.beginReboard` → `model.beginReboard()` / `.routeSwitched` → `landControlFocus(.stop)` / `.land(target)` → `landControlFocus(target)`. 하나의 슬롯이고 latest-wins(전이가 겹치면 마지막 전이의 착지가 맞다).
- 경유역 disclosure(§14.1)는 **그대로 둔다.** 조망의 정차역 행과 정보가 겹치지만 B2④ 판정이 아직 열려 있어 이번에 없애지 않는다(§10 판정 항목에 "둘 중 하나를 없앨지"를 더한다).
- 메뉴 경유 목적지 전환의 성공 착지(`landControlFocus(.stop)`)는 종전 버튼 핸들러 자리 그대로(조망 밖 경로라 이 계약의 대상이 아니다).

## 5. 대안 경로 보기·전환 (재조회형)

### 5.1 시작 시 대안 목록을 쓰지 않는 근거

ODsay 대안은 **출발 시점의 출발지** 기준이다. 실승차 중 대안이 필요한 순간은 이미 한두 구간을 지난 뒤라 그 목록은 "지금 여기서 갈 수 있는 경로"가 아니다(첫 leg 승차역이 지금 뒤에 있을 수 있다). 도보 대안 프리뷰(2026-08-14 §3)도 **최신 fix를 출발점으로 재조회**한다 — 같은 원리를 쓴다. 부수 효과로 시작 호출부(`startTransit`·`DirectionsTabView`)가 무변이다.

### 5.2 기계는 목적지 전환의 것을 **슬롯만 분리해** 쓴다

조회·stale·커밋 기계(`fetchDestChangeCandidates` → `commitDestinationChange` → `changeRoute`)를 공용 내부 함수로 뽑고, **pending 슬롯을 둘로 나눈다**: 기존 `pendingDestChange`(메뉴 목적지 전환, 동작 불변)와 신규 `pendingAltRoutes`(조망 "다른 경로"). 한 슬롯을 `source` 플래그로 나눠 쓰면 메뉴에서 고른 새 목적지 후보가 조망 요청에 덮이고(리뷰 A3), 한쪽의 지연된 dismiss가 다른 쪽의 새 요청을 취소한다(리뷰 A4). 슬롯이 다르면 둘 다 구조적으로 불가능하다. 각 슬롯은 자기 토큰을 가지며 `cancelAltRoutes(token:)`은 **캡처한 토큰과 현재 슬롯 토큰이 같을 때만** 폐기한다. 부모 시트의 `destChangeSection`은 종전대로 `pendingDestChange`만, 조망 하위 시트는 `pendingAltRoutes`만 그린다. 조망 닫힘·하위 시트 닫힘은 자기 토큰으로 `cancelAltRoutes`(하위 시트가 열린 채 조망이 통째로 닫히는 경로는 부모 `onDismiss`가 폐기). **전환 커밋은 반대 슬롯(메뉴 목적지 후보)을 무효화한다** — 출발점이 바뀌어 그 후보는 낡았다(슬롯 독립은 "서로 덮지 않는다"이지 "커밋 뒤에도 살린다"가 아니다).

### 5.3 출발점 — 근거가 있는 곳에서만

`pendingAltRoutes`는 출발점의 **근거**(`originEvidence`)를 함께 저장한다:

1. `LocationService.shared.currentCoordinate()` 성공 → `.gps`.
2. 실패(지하철 안 — 위원장이 L3에서 못 박은 전제) → `here.kind == "station"`(§3, 신선한 추적 관측)이면 그 정차역 좌표 → `.station(stopIndex)`.
3. 그 외 → `.failed(.noLocation)`. 실패 행 문구 `ios.transitGuide.altNoLocation`("현재 위치를 확인할 수 없어 대안 경로를 조회하지 못했습니다."). **단, `phase ∈ {waiting, boarding}`이면 실패 행 다음에 버튼 "{승차역} 기준으로 조회"**(`ios.transitGuide.altFromBoardStop`)를 둔다 — 누르면 `.boardStopDeclared` 근거로 재조회한다. 승차역을 **앱이 추정해 출발점으로 꾸미지 않고 사용자가 선언**하는 것이 §3 규칙 3("승차 전 승차역에 지금 여기를 찍지 않는다")과 같은 원칙의 조회판이다(리뷰 A1 — 종전 초안의 자동 승차역 폴백은 폐기).
4. 메뉴 목적지 전환은 종전대로 GPS만 — 동작 불변.

### 5.4 커밋 가드 — 시간이 아니라 근거의 변화

120초 stale 가드(시간)는 **보조**다. 주 가드는 근거 변화(리뷰 A2): `pendingAltRoutes`는 조회 시점의 `phaseGen`·`legIndex`·`originEvidence`·(station이면) `stopIndex`를 함께 저장하고, 커밋 시 현재 값과 대조해 **하나라도 다르면 재조회**(`.refetching` — 기존 `destChangeRefetched` `.high` 통지 재사용, 로딩 행 착지). 이동 중인 사용자가 역 A에서 본 후보를 역 C에서 확정하는 경로를 닫는다. 시간 가드는 근거가 같아도 120초가 지나면 재조회(정류소에 오래 서 있다가 확정하는 경우 — 도착 예정 열차가 바뀌었을 수 있다).

커밋 결과는 enum `AltRouteCommit = .committed | .refetching | .invalidCandidate | .sessionEnded`(리뷰 A5 — Bool이면 route 변환 실패가 죽은 버튼이 된다). `.invalidCandidate`는 그 후보의 전환 버튼을 실패 문구 행(`ios.transitGuide.altInvalid` "이 경로는 안내를 시작할 수 없습니다.")으로 바꾼다(활성화의 직접 응답). `.sessionEnded`는 조망이 이미 닫히는 중이다.

`changeRoute`는 통지 종류를 **값으로** 받는다: `changeRoute(…, announcement: .destinationChanged(label) | .routeSwitched)`. 커밋 검증을 통과한 시점에 지역 상수로 정하고 넘긴다 — 전역 pending을 되읽지 않는다(리뷰 A7). `.routeSwitched`는 `ios.transitGuide.routeSwitched`("경로를 바꿨습니다.") + 기존 시작 문장.

### 5.5 하위 시트 "다른 경로" 골격

`List { Section { 상태 행(조회 중·0건·실패[+승차역 기준 조회 버튼]) 또는 후보 N개 · 닫기 } header: "현재 위치 기준 다른 경로"(.isHeader) }`. 근거가 `.station`·`.boardStopDeclared`면 헤더가 그 역 이름을 말한다("{역} 기준 다른 경로", `ios.transitGuide.altHeadingFrom`) — 무엇을 기준으로 한 목록인지가 SR 사용자의 유일한 정보원이다([[status-bar-promises-the-screens-data-source]]).

- 후보 = `transitRouteEntries(result)` 전부(추천+대안, 기존 이름 규칙). **현재 경로와 `routeKey`가 같아도 특별 취급하지 않는다** — 재조회 후보는 출발점이 달라 같은 노선 조합이어도 다른 경로이고(첫 승차역이 지금 위치 기준으로 재기준화됐다), 전환은 정당하다(리뷰 M-routeKey — 종전 초안의 "지금 안내 중인 경로" 평문 처리 폐기).
- 각 후보는 `DisclosureGroup`(라벨 = 이름+요약, 본문 = `TransitRouteRows(includeSummary:false)` — 길찾기 탭과 같은 펼침 문법, VO 합격 2026-07-30) + 본문 끝 "이 경로로 전환"(`ios.transitGuide.adoptRoute`). **미리 보고 전환**(A안)이 이 펼침이다.
- 전환 = `commitAltRoute(route, token:)`: `.committed` → 어댑터가 `.dismissThen(.routeSwitched)`로 보고해 하위 시트·조망이 닫히고 부모 `onDismiss`가 중지 버튼에 착지한다(§4.3). `.high` 통지(`routeSwitched` + 시작 문장)는 `changeRoute` 안에서 즉시 나간다 — 시트가 닫히는 애니메이션과 겹치지만 착지 낭독은 dismiss **뒤**라 통지가 먼저 끝난다(리뷰 A6: 모델은 통지만, 착지는 시트 계층이 dismiss 뒤에).
- 포커스: 하위 시트 열림 → 시스템 헤더 착지(조회 중이면 헤더 다음이 상태 행). 로드 완료는 첫 후보 disclosure 라벨에 착지(`landFirstDestChangeRouteFocus` 동형 — 하위 시트가 자기 `@AccessibilityFocusState` 바인딩을 갖는다). 0건·실패는 상태 행 착지.

### 5.6 쿼터

사용자 행동당 ODsay 1회(+근거 변화·stale 재조회 1회). 자동 루프 없음. 일 1,000회 키 공유 — 조망을 열 때가 아니라 "다른 경로 보기"를 누를 때만 조회한다(조망 자체는 upstream 0회).

## 6. A16 L2 침묵 해소의 정확한 범위

해소되는 것: 침묵의 **설명과 탈출구가 한 화면**에 놓인다(§3 규칙 4·5, §4.2). 해소되지 않는 것: **급행이 하차역에 서지 않는 경우의 추적 자체**(A16 L1 — 급행 정차역 데이터원 판정, E14). 이 spec은 L1을 건드리지 않으며 BACKLOG A16·E14는 그대로 열려 있다. "침묵을 없애는 것"이 아니라 "침묵에서 나가는 길을 같은 화면에 두는 것"이다 — BACKLOG 문구 그대로.

## 7. 포커스·통지 계약 요약

| 시점 | 포커스 | 통지 |
|---|---|---|
| 조망 열림 | 시스템 헤더 착지(도보 선례) | 없음(착지 낭독이 정본) |
| 조망 닫힘 | 표준 dismiss → 트리거("진행 상황") 복귀 | 없음 |
| 탈출구 "탑승 변경" | 조망 닫힘 → `onDismiss`에서 `beginReboard()` → 지하철 `reboardPrompt`·버스 `waitingLabel` 착지(기존) | 없음 |
| 하위 시트 열림 | 헤더 착지 | 없음 |
| 후보 로드 완료 | 첫 후보 라벨 착지 | 없음 |
| 전환 성공 | 두 시트 닫힘 → `onDismiss`에서 **새 세션의 전이 착지**(riding·boarding→waiting이면 대기 라벨 — 다음 행동이 차량 선택이다), 전이 착지가 없으면(waiting→waiting) 중지 버튼. 메뉴 경유 목적지 전환과 같은 규칙(구현 리뷰 MAJOR-1로 정정) | `.high` `routeSwitched` + 시작 문장 |
| 전환 근거 변화·stale 재조회 | 조회 중 상태 행 | 기존 `destChangeRefetched` `.high` |
| 전환 후보 무효(`.invalidCandidate`) | 그 자리 실패 문구 행 | 없음(행 교체가 응답) |
| 신호 회복(조망 열린 채) | 이동 없음(행 래치) | 없음(문구만 갱신) |
| 조회 실패·0건 | 상태 행 착지 | 없음(상태 행 문구가 3-state) |
| 조망 연 채 국면 전이(도착 포함) | 조망 닫힘 → `onDismiss`에서 그 전이의 착지(기존 분기) | 기존 전이 통지 |

## 8. 웹

- 순수 계층 미러 `src/lib/transit-progress-overview.ts` + 공유 fixture 테스트 — 이것이 이번 웹 몫의 전부다.
- `TransitGuidePanel` UI는 무변(경유역 disclosure·진행 상황 낭독 그대로). 웹 조망 UI는 iOS 실승차 판정 뒤 후속(M3 웹 후속과 같은 "iOS 먼저·웹 뒤" 단계 분리) — BACKLOG E15 다음 항목에 한 줄.

## 9. 무변 경계·파일 소유

- **무변**: Kit `TransitGuide.swift` 상태 머신·이벤트·상수, 서버 `/api/transit/track`·`/api/route/transit`, `BeaconModel.swift`, 폴링 주기, 통지 채널(`announce`)·억제 규칙, `GuideSession`·띠바·최소화(K1), 경유역 disclosure, 웹 패널 UI, CLI/MCP.
- **소유 안(§2 E15-1)**: `TransitGuideModel.swift`(`pendingAltRoutes` 슬롯·근거 캡처·`commitAltRoute` enum·`changeRoute(announcement:)`), `TransitTrackingSheet.swift` 본문(K1의 toolbar 제외), Kit 신규 `TransitProgressOverview.swift` + 테스트, 웹 신규 `transit-progress-overview.ts` + fixture + 테스트, `messages/*.json` `transitGuide.*`·`ios.transitGuide.*` 신규 키, 신규 `GuideOverviewSheet.swift`.
- **소유 밖, 코디네이터 승인(2026-08-23)**: `BeaconTrackingSheet.swift`에서 private `RouteOverviewSheet`·`AlternativeRoutePreviewSheet`를 `GuideOverviewSheet.swift`로 **이동만**(동작 변경 0) — K1·K2 iOS가 main에 오른 뒤 내 통합 직전 rebase 위에서. 통합 보고에 자진 신고.
- `project.pbxproj`: 신규 파일 2개(앱 1·Kit은 SPM이라 불필요) — ID 신규, `xcodebuild -list` 검증.

## 10. 검증

- **게이트**: Kit `TransitProgressOverviewTests` + 웹 `transit-progress-overview.test.ts`가 같은 fixture로 디스크립터 동일 판정. 변이 주입 2건(§3) 결과를 이 절에 기록한다. i18n 6로케일·xcstrings 린터. `npm run test:run` 전체. Kit `swift test`.
- **시뮬 스냅샷**(`xcodebuildmcp`): 조망 골격(헤더·행·탈출구·대안 행동)·하위 시트 3상태 — 라벨 회귀 신호로만.
- **실기기 실승차(실험판, FIELD-TEST §5-4 신설)**: ①조망 착지 문장이 상태 한 문장 뒤 구간 서수까지 한 번에 들리는가 ②현재역 표식이 실제 역과 맞는가(지하철) ③침묵 상태에서 설명 행 다음 스와이프가 "탑승 변경"인가, 눌러서(조망이 닫힌 뒤) 프롬프트에 착지하는가 ④"다른 경로 보기"가 지하에서 현재역 앵커로 후보를 주는가, 승차 대기 중 GPS 실패 시 "{승차역} 기준으로 조회" 버튼이 나오는가 ④-2 후보를 읽는 사이 역이 바뀌면 전환이 재조회로 바뀌는가 ⑤전환 뒤 중지 버튼 착지 + "경로를 바꿨습니다" 낭독 ⑥조망 연 채 도착 전이 시 조망이 닫히고 "다음 구간"에 착지하는가 ⑦경유역 disclosure와 조망 정차역 목록 중 무엇을 남길지(B2④ 종결 판정).
- 변이 주입 결과(2026-08-23, 웹 구현에 주입·공유 fixture 16건): ①규칙 3 `signal == tracking` 제거 → **초기 15건은 미검출**(notYetVisible·neverSeen 시나리오가 전부 `currentLocation` null이라 경로가 같았다) → `riding-never-seen-stale-location` 시나리오를 더해 검출(1 실패) ②유일 매칭 제거 → 1 실패 ③규칙 5 침묵 제외 제거 → 3 실패 ④규칙 1 빈 배열 분기 제거 → 1 실패. 상태 머신상 neverSeen에 `currentLocation`이 남는 경로는 현재 없지만(진입 시 리셋), 규칙은 상태 모델이 허용하는 값 전체에 대해 성립해야 하므로 시나리오를 유지한다.

## 11. 설계 리뷰 게이트 판정

**대상이다** — 헌장 조건 ①(능력 프로토콜 = 새 판정 계층 신설: 조망 디스크립터 규칙 3·4·5가 전 수단 조망에 복제된다) ④(실승차 안내 정확성 — "지금 여기" 거짓 표식·죽은 전환은 SR 사용자에게 반증 채널이 없다). codex `adversarial-review`를 구현 전에 거친다. 리뷰 판정은 §12에 기록한다.

## 12. 설계 리뷰 결과 (codex adversarial-review, 2026-08-23, raw `codex exec` diff 주입)

초안은 BLOCKER 4·MAJOR 18·MINOR 3을 받았다. 같은 계층의 지적이 반복된 곳이 둘이라 지엽 패치가 아니라 계층을 바꿨다:

- **here의 근거 계층**(B1 소실 뒤 잔존 `currentLocation`·B2 불확실 도착·M3 버스·M4 동명·3-state 2-state): 초안은 `phase`와 역명 매칭만 봤다. → `here`를 **신선한 추적 관측(`signal == tracking`)·지하철·유일 매칭**에서만 내고, 그 외를 `notApplicable`/`unknown`(사유 포함)으로 구조화했다(§3 규칙 3). 확정 도착에도 표식을 찍지 않는다.
- **출발점·커밋 근거 계층**(A1 승차역 자동 앵커·A2 120초 가드가 이동을 못 막음·A5 Bool 커밋·A7 source 되읽기): 초안은 시간만 보고 위치 근거를 저장하지 않았다. → 근거(`originEvidence`)를 저장하고 **근거 변화가 주 가드**, 승차역은 사용자 선언 버튼으로만(§5.3·§5.4). 커밋 결과 enum.
- **pending 소유권**(A3 단일 슬롯 덮어쓰기·A4 전체 취소): `source` 플래그 → **슬롯 분리 + 토큰 비교 취소**(§5.2).
- **포커스 시점**(F1 통지·착지 잠식·F2 `showOverview=false` 즉시 착지·F4 탈출구 경쟁·A6 전환 착지): 전부 "모달 뒤에서 착지"라는 한 기제. → **"닫힌 뒤 행동" 계약**(§4.3 `pendingFollowUp` + `onDismiss`), 조망 트리거에서 `announceProgress` 제거.
- **프로토콜**(P1 넓히기 약속·P2 closure 최신성·P3 의도 계층): 조망 전용으로 **봉인**, 행동은 id + `perform` 재검증(§2.3). P3(Kit에 의도 계층)은 descriptor에 `reboardOffered`·`alternativesOffered`·`here` 사유가 이미 의도를 담아 충족 — 프로토콜 위치는 불변.
- **3-state**(빈 `viaStops`·`dest == nil`·`.noOrigin` 세분): `stopsUnavailable` 행 신설 / `dest`는 세션 불변식(비옵셔널 시작 인자)이라 가용성 enum 불요 / 정차역 좌표는 비옵셔널 `Double`이라 "좌표 결손" 사유는 성립하지 않아 `.noLocation`·`.fetch` 둘만.
- **M5 탈출구 소실**(seoulBus signalLost·빈 viaStops): 시트와 같은 술어(riding ∧ 비-tagoBus)로 통일 — `beginReboard()`의 수단 분기를 재사용(§3 규칙 5). **M-routeKey**: 특별 취급 폐기. **F3 회복 시 행 소실**: 조망 수명 동안 행 래치(§4.1). **F5 arrived에서 열기**: 허용, 소거는 전이 시점만(§4.3).

**기각**: "같은 routeKey를 막아야 한다"(반대로 풀었다 — 재기준화된 경로라 전환 정당) · "`dest == nil` 가용성 enum"(불변식으로 해결) · "좌표 결손 사유 분리"(성립 불가). 리뷰가 "기각 가능"으로 표시한 9건은 spec이 이미 다룬 것이라 변경 없음.


# 대중교통 실시간 안내 "진행 상황 조망" (E15-1) 설계

2026-08-23 확정. `docs/BACKLOG.md` E15의 첫 능력이며 병렬 브리프 `docs/superpowers/plans/2026-08-23-feedback-260822-parallel-plan.md` §1 E15-1 행을 구현한다. 선행 설계: 도보 조망·대안 프리뷰(`2026-08-14-guide-alternative-preview-design.md`), A16 L2·L3(`2026-08-16-transit-guide-never-seen-escape-design.md`), 승차 국면(`2026-08-22-transit-boarding-phase-design.md`).

## 0. 전제 (위원장·코디네이터 판정 — 여기서 재논의하지 않는다)

1. **시트를 통합하지 않는다.** 도보·자동차 시트와 대중교통 시트는 국면·행 구성이 달라 통합 셸이 분기 주머니가 된다(BACKLOG E15 권고). 공유 단위는 **능력**이다.
2. **추상화를 먼저 발명하지 않는다** — 조망 능력 하나를 두 수단에 붙이면서 프로토콜을 **발견**한다. 이번에 정의하는 프로토콜은 조망이 실제로 요구하는 것만 담고, 주변 확인·톤은 다음 능력이 올 때 프로토콜을 넓힌다.
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

### 2.3 프로토콜 정의

```swift
/// 진행 상황 조망 능력(E15-1). 뷰는 이 프로토콜만 안다. 능력이 없는 세션은
/// 트리거 자체가 안 나온다(죽은 버튼 금지 — 키 게이트 동형).
@MainActor protocol GuideOverviewCapability: AnyObject, Observable {
    /// 헤더 한 문장 — 시스템 헤더 착지가 이 문장을 낭독한다(별도 통지 없음).
    var overviewHeaderText: String { get }
    /// 본문 행(한 행 = 한 접근성 객체). 순서가 읽기 순서다.
    var overviewRows: [GuideOverviewRow] { get }
    /// 행 목록 뒤 슬롯의 행동(대안 보기·탈출구). 없으면 [].
    var overviewActions: [GuideOverviewAction] { get }
}

enum GuideOverviewRow: Identifiable {
    case text(id: String, String)                       // 평문 행
    case action(id: String, label: String, run: () -> Void)  // 버튼 행(침묵 탈출구 등)
}

struct GuideOverviewAction: Identifiable {
    let id: String
    let label: String
    /// 눌렀을 때 셸이 띄울 하위 화면. nil이면 run만.
    let presents: GuideOverviewSubsheet?
    let run: () -> Void
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
  /** 현재 구간의 "지금 여기"가 어디서 왔는가(3-state — 표시·판정 분리). */
  here: "station" | "none";
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
  | { kind: "silence"; signal: "neverSeen" | "notYetVisible" | "signalLost" | "upstreamFailed" };
```

규칙:

1. **행 순서** = 경로 순서. 각 leg 앞에 `walkBeforeMinutes`가 있으면 `walk` 행, leg 행, **현재 구간에만** 그 leg의 `viaStops` 전체를 `stop` 행으로 펼친다(지난·예정 구간은 leg 행 하나 — 조망이 정차역 전부를 나열하면 환승 2회 경로에서 60행이 넘는다). 마지막 leg 뒤 `walkAfterMinutes`가 있으면 `walk` 행.
2. **status**: `legIndex < state.legIndex` → done, `==` → current, `>` → upcoming. `phase == done`이면 전부 done.
3. **here**: `phase == riding || arrived`이고 `viaStopCurrentIndex(leg, state.currentLocation)`가 있으면 그 stop 행만 `here: true`, `here: "station"`. 그 외(waiting·boarding·위치 불명·버스)는 `here: "none"`이고 어떤 행에도 표식이 없다. ⚠ **waiting·boarding에서 승차역을 "지금 여기"로 찍지 않는다** — 도보 leg 중일 수 있고 그 국면은 헤더("탑승 대기")가 이미 말한다. 없는 표식은 거짓이 아니지만 있는 표식은 거짓일 수 있다.
4. **silence**: `phase == riding`이고 `signal ∈ {notYetVisible, neverSeen, signalLost, upstreamFailed}`이면 현재 leg 행 **바로 뒤**(정차역 목록 앞)에 `silence` 행 1개. tracking이면 없다. `untrackable`은 시트가 이미 수동 전진 문구를 내므로 조망엔 없다.
5. **reboardOffered** = `phase == riding && leg.trackMode == subway && viaStops.length > 0 && signal != tracking`. 시트의 "탑승 변경" 노출 조건(riding ∧ 비-tagoBus)보다 좁다 — 조망의 탈출구는 **침묵일 때만** 낸다(추적 중엔 시트의 버튼이 정본이고, 조망까지 내면 같은 버튼이 두 화면에 상시로 떠 전환 압박이 된다, 2026-08-14 판정 1 동형). ⚠ `signalLost`·`upstreamFailed`도 포함하는 이유: 사용자가 듣는 증상은 셋 다 "안내가 멈췄다"이고 탈출구가 같다. 원인 구분은 `silence` 행 문구가 맡는다.
6. **alternativesOffered** = `phase != done`. 앱 어댑터가 `model.dest != nil`을 AND한다(목적지 좌표 없이는 재조회가 성립하지 않는다 — 실제로는 시작 시 항상 있다).

고정 fixture 시나리오(최소 8): 단일 leg waiting / 환승 2회 riding 현재역 있음(가운데 leg) / riding 위치 불명 notYetVisible / riding neverSeen(reboard 제안) / 버스 riding(here none·reboard 없음) / arrived(here=하차역) / done(전부 done, 대안 없음) / untrackable leg(silence 없음). 변이 주입: 규칙 3의 waiting 승차역 표식을 켜면 fixture가 깨지는지, 규칙 5의 tracking 제외를 빼면 깨지는지 — spec §10에 결과를 적는다.

## 4. iOS 셸과 대중교통 어댑터

### 4.1 셸 `GuideOverviewSheet`

도보 `RouteOverviewSheet`의 골격을 그대로 일반화한다: `List { Section { 상단 닫기 · rows · actions · 말미 닫기 } header: { headerText(.isHeader) } }`. 상단 닫기·말미 닫기 근거는 2026-08-10 위원장 판정(기존 주석 유지). 하위 시트는 `.sheet(item:)` 하나로 `GuideOverviewSubsheet`를 띄운다. 닫힘 시 `onSubsheetDismiss`를 어댑터에 알려 진행 중 조회를 폐기한다(도보 `closeAlternativePreview`, 대중교통 `cancelDestinationChange` — 2026-08-14 §3 latest-wins 동형).

헤더는 **live region이 아니다**(조회형 정보). 폴이 와서 헤더·행이 바뀌어도 통지하지 않는다. 단 **행이 사라지는 전이**(예: 조망을 연 채 `riding → arrived`로 silence 행이 없어지는 경우)에서 포커스가 그 행에 있었으면 SwiftUI가 인접 행으로 옮긴다 — 실기기 관찰 항목(§10)이며 이 마일스톤에서 선점 이동을 만들지 않는다(국면 전이의 선점은 부모 시트의 계약이고 조망은 그 위에 얹힌 모달이라 도착 전이는 부모가 조망을 닫는다, 아래 4.3).

### 4.2 대중교통 어댑터 문구 (ko 정본, 6로케일)

| 디스크립터 | 문구 | 키 |
|---|---|---|
| 헤더 | "{count}구간 중 {n}번째 구간. " + `statusLineText(state, leg)` | `transitGuide.overviewOrdinal` + 기존 조립기 |
| walk | "도보 약 {minutes}분" | `transitGuide.overviewWalk` |
| leg done | "{n}. {line}, {board}에서 {alight}까지, 완료" | `transitGuide.overviewLeg` + `overviewLegDone` |
| leg current | "{n}. {line}, {board}에서 {alight}까지, 지금 이 구간" (+ ", 약 {stationCount}정거장" stationCount 있을 때) | `overviewLeg` + `overviewLegCurrent` + 기존 `stationCountAbout` |
| leg upcoming | "{n}. {line}, {board}에서 {alight}까지, 예정" | `overviewLeg` + `overviewLegUpcoming` |
| stop | "{name}, 승차/하차, 현재 위치" | 기존 `viaBoard`·`viaAlight`·`viaCurrent`(시트 경유역 목록과 같은 어휘 — 드리프트 방지) |
| silence neverSeen | 기존 `transitGuide.neverSeen` 문장("탑승하신 차량을 찾지 못하고 있습니다. 다른 차량을 타셨다면 탑승 변경을 눌러 주세요.") | 재사용 |
| silence notYetVisible / signalLost / upstreamFailed | 기존 `stateRidingNotYetVisible` / `stateSignalLost` / `stateUpstreamFailed` | 재사용 |
| 탈출구 행 | "탑승 변경" | 기존 `transitGuide.changeBoarding` |
| 대안 행동 | "다른 경로 보기" | `transitGuide.viewAlternatives` |

조립은 `joinText`(쉼표, 한 줄 = 한 객체). 헤더가 `statusLineText`를 재사용하는 이유는 §12.3 드리프트 차단 — 상시 표시·진행 상황 통지·조망 헤더가 **한 조립기**를 지난다.

**탈출구 행(`reboardOffered`)**: `silence` 행 바로 뒤의 `action` 행. 누르면 `model.beginReboard()` 후 조망을 닫는다 — 부모 시트의 `reboardStationPicker`가 나타나며 그 `.task`가 프롬프트("지금 어느 역에 계신가요?")에 착지한다(A16 L3 기존 계약 재사용, 새 포커스 코드 0). ⚠ 역 목록을 조망 안에 또 그리지 않는다 — 같은 목록이 두 화면에 있으면 L3의 포커스 계약이 두 벌이 된다.

### 4.3 부모 시트 배선 (`TransitTrackingSheet`)

- "진행 상황" 버튼: `model.announceProgress()` → `showOverview = true`. 대중교통 세션은 항상 경로를 보유하므로 도보의 "경로 미보유면 낭독" 분기가 없다(`announceProgress`는 웹과 도보 간략 세션이 쓰므로 모델에 남긴다).
- `.sheet(isPresented: $showOverview) { GuideOverviewSheet(capability: TransitOverviewAdapter(model)) }`.
- **연쇄 소거**: `phase`가 `arrived`·`done`으로 바뀌거나 세션이 끝나면(`state == nil`) `showOverview = false`. 도착 전이의 포커스 선점("다음 구간")은 기존 `onChange(phase)`가 맡는다 — 조망이 닫힌 뒤 그 선점이 동작해야 하므로 소거를 **먼저** 한다(같은 `onChange` 안에서 `showOverview = false`를 앞에 둔다).
- 경유역 disclosure(§14.1)는 **그대로 둔다.** 조망의 정차역 행과 정보가 겹치지만 B2④ 판정이 아직 열려 있어 이번에 없애지 않는다(§10 판정 항목에 "둘 중 하나를 없앨지"를 더한다).
- 경로 전환 성공 후 포커스: 모델의 `routeSwitchSeq`(changeRoute마다 +1)를 부모가 `onChange`로 보고 `landControlFocus(.stop)` — 메뉴 경유 목적지 전환도 같은 경로를 지나므로 기존 버튼 핸들러의 `landControlFocus(.stop)`은 제거해 한 자리로 모은다(중복 착지 금지).

## 5. 대안 경로 보기·전환 (재조회형)

### 5.1 시작 시 대안 목록을 쓰지 않는 근거

ODsay 대안은 **출발 시점의 출발지** 기준이다. 실승차 중 대안이 필요한 순간은 이미 한두 구간을 지난 뒤라 그 목록은 "지금 여기서 갈 수 있는 경로"가 아니다(첫 leg 승차역이 지금 뒤에 있을 수 있다). 도보 대안 프리뷰(2026-08-14 §3)도 **최신 fix를 출발점으로 재조회**한다 — 같은 원리를 쓴다. 부수 효과로 시작 호출부(`startTransit`·`DirectionsTabView`)가 무변이다.

### 5.2 기계는 목적지 전환의 것을 그대로 쓴다

`prepareDestinationChange(dest: model.dest, label: destinationLabel, source: .overview)` → `fetchDestChangeCandidates` → `commitDestinationChange` → `changeRoute`. **새 상태 머신·새 토큰·새 stale 가드 없음**(120초 stale 재조회 포함). `PendingDestChange`에 `source: .menu | .overview`를 더해 부모 시트의 `destChangeSection`은 `.menu`만, 조망 하위 시트는 `.overview`만 렌더한다(같은 pending을 두 화면이 동시에 그리지 않는다). 조망 닫힘(`onDismiss`)·하위 시트 닫힘은 `.overview` pending을 `cancelDestinationChange`로 폐기한다.

### 5.3 출발점 — GPS, 실패 시 역 좌표 앵커

`fetchDestChangeCandidates`의 출발점 결정을 **정책 함수로 뺀다**: `resolveOrigin(source:) async -> (lat,lng)?`

1. `LocationService.shared.currentCoordinate()` 성공 → 그 좌표.
2. 실패(지하철 안 — 위원장이 L3에서 못 박은 전제) → `source == .overview`일 때만 **앵커 폴백**: `here == "station"`이면 그 정차역 좌표, `phase ∈ {waiting, boarding}`이면 승차역(`boardStop`) 좌표, 그 외(riding 위치 불명)는 **nil → `.failed(reason: .noOrigin)`**. 위치를 모르면서 하차역을 출발점으로 꾸미지 않는다(3-state).
3. `.menu`(목적지 전환)는 종전대로 GPS만 — 동작 불변.

`PendingDestChange.Phase.failed`는 사유를 갖는다(`.noOrigin | .fetch`). 문구: `ios.transitGuide.altNoOrigin` "현재 위치를 확인할 수 없어 대안 경로를 조회하지 못했습니다. 차량 위치가 확인되면 다시 열어 주세요." / 기존 `destChangeError`. `.menu`의 failed는 종전 문구 그대로(`.fetch`로 고정).

### 5.4 하위 시트 "다른 경로" 골격

`List { Section { 상태 행(조회 중·0건·실패) 또는 후보 N개 · 닫기 } header: "현재 위치 기준 다른 경로"(.isHeader) }`.

- 후보 = `transitRouteEntries(result)` 전부(추천+대안, 기존 이름 규칙 `transitAlternativeName`). 현재 경로와 같은 routeKey가 있어도 빼지 않는다 — 재조회 결과의 routeKey는 출발점이 달라 대개 다르고, 같더라도 "지금 경로가 여전히 최선"이라는 정보다. 그 경우 버튼 라벨 대신 평문 "지금 안내 중인 경로"(`ios.transitGuide.altSameRoute`)로 표시해 죽은 전환을 막는다.
- 각 후보는 `DisclosureGroup`(라벨 = 이름+요약, 본문 = `TransitRouteRows(includeSummary:false)` — 길찾기 탭과 같은 펼침 문법, VO 합격 2026-07-30) + 본문 끝 "이 경로로 전환"(`ios.transitGuide.adoptRoute`). **미리 보고 전환**(A안)이 이 펼침이다 — 펼쳐야 버튼이 나온다.
- 전환 = `commitDestinationChange(route)`: 성공 → 하위 시트·조망 닫힘 → 부모가 중지 버튼 착지(§4.3) + 기존 `.high` 통지("{목적지}로 안내합니다. {n}구간 … 탑승 대기"는 `changeRoute`가 이미 낸다 — 목적지 라벨이 같으니 "목적지가 바뀌었다"로 읽히는 `ios.guide.destChanged` 절은 `source == .overview`면 **뺀다**: "경로를 바꿨습니다."(`ios.transitGuide.routeSwitched`)로 대체). stale 재조회(false 반환)면 하위 시트가 조회 중 행으로 돌아가고 기존 `destChangeRefetched` `.high` 통지가 난다.
- 포커스: 하위 시트 열림 → 시스템 헤더 착지(조회 중이면 헤더 다음이 상태 행). 로드 완료는 첫 후보 disclosure 라벨에 착지(`landFirstDestChangeRouteFocus` 동형 — `focusedDestChangeRoute` 바인딩을 하위 시트가 자기 것으로 갖는다). 0건·실패는 상태 행 착지.

### 5.5 쿼터

사용자 행동당 ODsay 1회(+stale 재조회 1회). 자동 루프 없음. 일 1,000회 키 공유 — 조망을 열 때가 아니라 "다른 경로 보기"를 누를 때만 조회한다(조망 자체는 upstream 0회).

## 6. A16 L2 침묵 해소의 정확한 범위

해소되는 것: 침묵의 **설명과 탈출구가 한 화면**에 놓인다(§3 규칙 4·5, §4.2). 해소되지 않는 것: **급행이 하차역에 서지 않는 경우의 추적 자체**(A16 L1 — 급행 정차역 데이터원 판정, E14). 이 spec은 L1을 건드리지 않으며 BACKLOG A16·E14는 그대로 열려 있다. "침묵을 없애는 것"이 아니라 "침묵에서 나가는 길을 같은 화면에 두는 것"이다 — BACKLOG 문구 그대로.

## 7. 포커스·통지 계약 요약

| 시점 | 포커스 | 통지 |
|---|---|---|
| 조망 열림 | 시스템 헤더 착지(도보 선례) | 없음(착지 낭독이 정본) |
| 조망 닫힘 | 표준 dismiss → 트리거("진행 상황") 복귀 | 없음 |
| 탈출구 "탑승 변경" | 조망 닫힘 → 부모 `reboardPrompt` 착지(기존) | 없음 |
| 하위 시트 열림 | 헤더 착지 | 없음 |
| 후보 로드 완료 | 첫 후보 라벨 착지 | 없음 |
| 전환 성공 | 두 시트 닫힘 → 부모 중지 버튼 | `.high` `routeSwitched` + 시작 문장 |
| 전환 stale 재조회 | 조회 중 상태 행 | 기존 `destChangeRefetched` `.high` |
| 조회 실패·0건 | 상태 행 착지 | 없음(상태 행 문구가 3-state) |
| 조망 연 채 도착 전이 | 조망 소거 후 부모 "다음 구간" 선점(기존) | 기존 도착 통지 |

## 8. 웹

- 순수 계층 미러 `src/lib/transit-progress-overview.ts` + 공유 fixture 테스트 — 이것이 이번 웹 몫의 전부다.
- `TransitGuidePanel` UI는 무변(경유역 disclosure·진행 상황 낭독 그대로). 웹 조망 UI는 iOS 실승차 판정 뒤 후속(M3 웹 후속과 같은 "iOS 먼저·웹 뒤" 단계 분리) — BACKLOG E15 다음 항목에 한 줄.

## 9. 무변 경계·파일 소유

- **무변**: Kit `TransitGuide.swift` 상태 머신·이벤트·상수, 서버 `/api/transit/track`·`/api/route/transit`, `BeaconModel.swift`, 폴링 주기, 통지 채널(`announce`)·억제 규칙, `GuideSession`·띠바·최소화(K1), 경유역 disclosure, 웹 패널 UI, CLI/MCP.
- **소유 안(§2 E15-1)**: `TransitGuideModel.swift`(source·resolveOrigin·routeSwitchSeq·failed 사유), `TransitTrackingSheet.swift` 본문(K1의 toolbar 제외), Kit 신규 `TransitProgressOverview.swift` + 테스트, 웹 신규 `transit-progress-overview.ts` + fixture + 테스트, `messages/*.json` `transitGuide.*`·`ios.transitGuide.*` 신규 키, 신규 `GuideOverviewSheet.swift`.
- **소유 밖, 코디네이터 승인(2026-08-23)**: `BeaconTrackingSheet.swift`에서 private `RouteOverviewSheet`·`AlternativeRoutePreviewSheet`를 `GuideOverviewSheet.swift`로 **이동만**(동작 변경 0) — K1·K2 iOS가 main에 오른 뒤 내 통합 직전 rebase 위에서. 통합 보고에 자진 신고.
- `project.pbxproj`: 신규 파일 2개(앱 1·Kit은 SPM이라 불필요) — ID 신규, `xcodebuild -list` 검증.

## 10. 검증

- **게이트**: Kit `TransitProgressOverviewTests` + 웹 `transit-progress-overview.test.ts`가 같은 fixture로 디스크립터 동일 판정. 변이 주입 2건(§3) 결과를 이 절에 기록한다. i18n 6로케일·xcstrings 린터. `npm run test:run` 전체. Kit `swift test`.
- **시뮬 스냅샷**(`xcodebuildmcp`): 조망 골격(헤더·행·탈출구·대안 행동)·하위 시트 3상태 — 라벨 회귀 신호로만.
- **실기기 실승차(실험판, FIELD-TEST §5-4 신설)**: ①조망 착지 문장이 상태 한 문장 뒤 구간 서수까지 한 번에 들리는가 ②현재역 표식이 실제 역과 맞는가(지하철) ③침묵 상태에서 설명 행 다음 스와이프가 "탑승 변경"인가, 눌러서 프롬프트에 착지하는가 ④"다른 경로 보기"가 지하에서 앵커 폴백으로 후보를 주는가(아니면 `altNoOrigin` 문장인가) ⑤전환 뒤 중지 버튼 착지 + "경로를 바꿨습니다" 낭독 ⑥조망 연 채 도착 전이 시 조망이 닫히고 "다음 구간"에 착지하는가 ⑦경유역 disclosure와 조망 정차역 목록 중 무엇을 남길지(B2④ 종결 판정).
- 변이 주입 결과: (구현 후 기입)

## 11. 설계 리뷰 게이트 판정

**대상이다** — 헌장 조건 ①(능력 프로토콜 = 새 판정 계층 신설: 조망 디스크립터 규칙 3·4·5가 전 수단 조망에 복제된다) ④(실승차 안내 정확성 — "지금 여기" 거짓 표식·죽은 전환은 SR 사용자에게 반증 채널이 없다). codex `adversarial-review`를 구현 전에 거친다. 리뷰 판정은 §12에 기록한다.

## 12. 설계 리뷰 결과

(codex adversarial-review 후 기입)

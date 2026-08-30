# 대중교통 안내 — 승차 전 도보 핸드오프 설계 (A25, 2026-08-30)

위원장 판정(2026-08-30): 대중교통 안내를 시작할 때 첫 탑승 leg 앞의 도보 구간을 **도보 실시간 안내(GPS)로 먼저 돌리고, 승차역에 도착하면 대기 국면(열차 후보)으로 이어간다**. 하차 후 도보 핸드오프(spec `2026-08-04-transit-guidance-design.md` §14.2)와 대칭이다. 대안 "GPS 없는 역 도착 버튼 국면"·"현행 유지"는 기각됐다. 근거 로그: `~/gildongmu-private/field-logs/transit-guide-diag-2026-08-29.log`(저장소 밖) — 경로 "도보 5분 333m → 시청 → 2호선 → 충정로"가 시작 직후 `waitPoll seq=1`, 열차 후보 2개를 보이는 대기 국면이었다.

## 1. 배경

§4.1은 "탑승 leg만 국면이고 승차 전 도보는 대기 문맥 한 문장"으로 정했다(`buildTransitGuideRoute`가 walk leg를 `walkBeforeMinutes`로 접는다). 그래서 승차역까지 걷는 5분 동안 사용자는 "탑승할 열차를 고르라"는 화면과 도착편 폴링만 듣는다. 하차 뒤에는 §14.2 제안형 핸드오프가 있는데 승차 전에는 아무것도 없다. 하차 뒤가 **제안형**인 이유(지하 역사 GPS 공백 — 하차 직후 fix가 없다)는 승차 전에는 성립하지 않는다: 출발점은 사용자가 지금 서 있는 지상이고, 도보 안내가 실제로 필요한 곳은 역까지의 길이다.

## 2. 확정 판단

- **자동 연결(B안)** — 승차 전은 지상에서 시작하므로 §14.2가 B안을 기각한 근거가 없다. 시작 버튼 하나로 도보 → 대기 국면이 이어진다(추가 버튼 없음).
- **도보 leg의 하한은 `walkBeforeMinutes ≥ 1`**이다. ODsay는 분 단위 정수를 주고 0분 leg는 역 안 이동이라 GPS 안내 대상이 아니다. 거리 축을 따로 두지 않는다(같은 정보의 두 임계는 drift다).
- **판정은 순수 함수 하나가 한다**(`transitPrewalkTarget`, 웹·Kit 미러 + 공유 fixture). 시작 진입점 두 곳(iOS `GuideSession.startTransit`·웹 `TransitGuidePanel`)이 같은 함수를 부르고, null이면 종전 경로를 그대로 탄다(§7 "관찰 동작 동일" 범위).
- **도보 안내의 목적지는 첫 leg `boardStop` 좌표**(ODsay 정류소·역 좌표, `TransitLegStop.lat/lng`)이고 라벨은 `boardName`이다. `boardStop`이 없으면(정보 결손) 판정은 null — 좌표 없는 안내는 존재하지 않는다.
- **도착 판정은 도보 세션의 것을 그대로 쓴다**(확정 도착·도착 추정). 새 판정 축을 만들지 않는다. 지하철역 좌표는 역사 중심이라 지상에서 수십 m 이격될 수 있는데, 그 오프셋은 도보 안내의 `finalApproach`(마지막 몇 미터)가 이미 흡수하는 축이고, 흡수하지 못하는 경우(입구가 멀어 지하로 먼저 들어감)를 위해 **"승차역 도착" 선언 버튼**을 둔다(§4.3). 이 버튼은 §4.2 "행동 추정 금지"의 사용자 행위다 — 미도착을 도착으로 추론하는 자리가 아니다.
- **도보 안내 중 사용자 중지 = 전체 종료**(대중교통 세션은 시작되지 않는다). 근거: 사용자가 누른 것은 "안내 종료" 버튼이고, 그 라벨은 세션 전체를 서술한다(`control-label-states-the-action-scope`). 중지 뒤 "대기 국면으로 넘어갈까요"를 묻는 것은 사용자가 이미 내린 결정을 되묻는 것이다. 중지한 뒤 대중교통만 원하면 시작 버튼을 다시 누르면 되고(경로는 화면에 그대로 있다), 그때는 §2의 판정이 다시 돌아 도보부터 시작한다 — 역에 이미 와 있다면 "승차역 도착"을 바로 누른다.
- **권한 상실 종료도 전체 종료**다. "위치를 모른다"가 원인인데 그 상태에서 대기 국면으로 넘어가면 사용자가 역에 없는데 열차 후보를 읽는 원증상이 되돌아온다. 종료 사유 문장은 도보 세션 것이 나가고, 대중교통 세션이 시작되지 않았다는 사실은 그 문장 **뒤에** 한 문장으로 덧붙인다(§5, 순서는 §4.4 비동기 전달이 보장).
- **잊힌 세션 안전망(`sessionIdleStep`)은 prewalk 세션에 걸지 않는다**(설계 리뷰 반영). 그 안전망이 끝내려는 상황(fix 두절 10분)은 prewalk에서는 십중팔구 **지하 역사 진입**이고, 그때 세션을 끝내면 바로 그 경우를 위해 둔 "승차역 도착" 버튼(§4.3)까지 함께 사라진다. 유일한 출구가 사용자 선언·중지이므로 잊힌 세션의 상한은 없다 — 대중교통 세션 자체도 유휴 상한이 없다(폴 상한뿐)는 점에서 같은 계열이다. 도착 추정(`presumedArrivalStep`, 최종 접근 국면 안 무진행 3~5분)은 그대로 살아 있어 역사 중심 150m 안에서 신호를 잃은 대부분의 경우는 자동 연결된다.
- **도보 안내 시작 실패(위치 없음 등)는 종전처럼 바로 대기 국면**이다. 도보 안내가 불가능하다고 대중교통 안내까지 못 하는 것은 아니다 — 통지 한 줄(`transitGuide.prewalkUnavailable`)을 앞세우고 시작한다. 이때 도보 문맥은 **지우지 않는다**(`prewalkCompleted: false` — 사용자는 아직 걷지 않았으므로 "도보 5분 이동 후 시청에서"가 참이다, 설계 리뷰 반영). 시작 실패의 판정은 `begin()`의 시작 Task가 끝난 시점에 `isTracking`이 아닌 것이다(권한 거부·정밀 위치 꺼짐·서비스 꺼짐·경합 거부·취소 전부 한 판정 — 경로별 `fail` 호출을 세지 않는다). 경로 조회 실패는 실패가 아니다: `BeaconModel`이 직선거리로 내부 강등해 안내를 계속하므로(E16 축2) 세션은 살아 있고 도착 판정도 성립한다.
- **prewalk 도보 세션은 종료 화면(걸음·칼로리 요약)을 남기지 않는다.** 그 화면은 여정의 끝에 서는 것이고 승차역은 끝이 아니다. 도착 순간 도보 시트가 내려가고 대중교통 시트가 올라온다. ⚠ 종료 화면은 `stop()` **뒤에** `arrivalDest`를 대입하는 세 경로(확정·추정·`stopLeavingSummary`)가 만드는데, `stop()`이 `prewalkTarget`을 지우면 그 뒤 분기는 prewalk를 모른다 — 그래서 세 경로 모두 `stop()` **앞에서** prewalk 여부를 지역 변수로 캡처해 종료 화면 분기를 건너뛴다(설계 리뷰 BLOCKER 반영). `screen`이 `.beacon`을 우선하므로 이 불변식이 깨지면 대중교통 시트가 영구 은폐된다.
- **역 좌표의 한계는 수용한다**(설계 리뷰 BLOCKER 기각 근거): ODsay 정류소·역 좌표 외에 출입구·접근점 좌표원이 응답에 없고, 목적지 출입구 승격(`/api/places/entrance`)은 지하철 출구를 **다른 카테고리**로 의도적으로 배제한다. 역사 중심에서 수십 m 떨어진 자동 도착은 대기 국면에 해가 없다 — 대기 국면은 승차 정류소 도착편을 폴링하며 사용자가 열차를 고르는 국면이라 정확히 승강장에 있을 필요가 없다. 반대 방향 정류소 문제도 없다: `boardStop`은 ODsay가 고른 **특정** 정류소(arsId·좌표)다. 좌표 유효성(유한값·(0,0) 아님)만 순수 함수가 본다.
- **비범위**: 환승 leg 사이 도보(같은 역 안 이동이거나 지하)·하차 후 도보(§14.2 제안형 유지)·대중교통 세션 도중의 목적지 전환(prewalk가 끝난 뒤의 세션이라 이 설계와 무관)·CLI/MCP(실시간 안내 없음).

## 3. 판정 계층 (순수, 웹·Kit 미러)

```
transitPrewalkTarget(route: TransitGuideRoute) -> { name, lat, lng, minutes } | null
  leg0 = route.legs[0]
  if leg0.walkBeforeMinutes == null || < 1 → null
  if leg0.boardStop == null → null
  if !isFinite(lat,lng) || (lat==0 && lng==0) → null
  → { name: leg0.boardName, lat: boardStop.lat, lng: boardStop.lng, minutes: walkBeforeMinutes }

withoutPrewalk(route) -> TransitGuideRoute   // legs[0].walkBeforeMinutes = null, 나머지 불변
```

- 위치: `src/lib/transit-guide.ts` ↔ `ios/GildongmuKit/Sources/GildongmuKit/TransitGuide.swift`. fixture는 `transit-guide-scenarios.json`에 `prewalk` 키를 더한다(routes 이름 → 기대값. `subwaySingle`은 3분·천호 좌표, `seoulBusSingle`은 null). Kit 테스트의 fixture 디코더는 미지 키를 무시하므로 스키마 확장은 기존 시나리오를 깨지 않는다.
- `withoutPrewalk`가 필요한 이유: 도보를 안내로 소비한 뒤 대중교통 세션이 시작될 때 대기 문맥(`waitContextText`)이 "도보 5분 이동 후 시청에서"라고 다시 말하면 이미 지난 일을 미래형으로 말하는 거짓이 된다(`boardOverrideName` 주석과 같은 원리). 조망 행·시작 통지·`legAdvanced`는 전부 `walkBeforeMinutes`를 읽으므로 **한 곳에서 지운다**(문장마다 분기하지 않는다).
- `withoutPrewalk`는 값 복사다(웹은 새 객체·새 legs 배열, Kit은 값 타입 재구성). 원본은 불변이고 테스트가 원본 deep equality를 확인한다.
- 세션 상태 머신(`transitGuideStep`)·기존 fixture 시나리오·`initTransitGuide`는 **무변경**이다. prewalk는 대중교통 세션이 시작되기 **전**의 오케스트레이터 계층이지 국면이 아니다(§14.2 "세션 밖 수명" 동형).

## 4. iOS 배선

### 4.1 진입 — `GuideSession.startTransit`

```
startTransit(route, destinationLabel, dest, accessible):
  guard !refuseIfActive()
  cancelPrewalk()                                   // 낡은 continuation·지연 Task 폐기(매 진입)
  beacon.clearArrival()
  if let target = buildTransitGuideRoute(route).flatMap(transitPrewalkTarget):
      prewalk = PrewalkContext(id: UUID(), route, destinationLabel, dest, accessible, target)
      beacon.prewalkTarget = target.name
      beacon.onSessionEnd = { [id] reason in self.endPrewalk(id, reason) }   // requestStart 앞에 설치
      transit.announce(prewalkStart)                // "승차역 시청까지 도보 5분. 도보 안내를 먼저 시작합니다."
      startBeacon(StartRequest(dest: target 좌표, label: target.name, kind: .walk,
                               accessible: accessible, variant: nil, shortestAvailable: false, waypoint: nil))
      if !beacon.starting && !beacon.isTracking { endPrewalk(id, .startFailed) }  // 동기 거부 방어
  else:
      transit.start(...)                            // 종전 진입점·인자 그대로(§7 "관찰 동일" 범위)
```

- `transit.start`의 시그니처는 **바꾸지 않는다**(설계 리뷰 반영). prewalk 완료 진입점은 별도 `transit.startAfterPrewalk(...)`이고 `withoutPrewalk` 결과로 세션을 초기화한다 — 종전 경로는 새 분기를 하나도 지나지 않는다. 판정용 `buildTransitGuideRoute` 재호출은 순수·결정적이라 관찰 가능한 차이가 없다.

- `startBeacon` 호출은 `guidance-gate-drift.test.ts` 진입점 전수의 **8번째**다(`self.startBeacon(` 3곳). 이 자리는 대중교통 시작 버튼(실험판 봉인 `experimentalGuidanceEnabled`) 안에서만 도달하므로 정식판에 닿지 않는다 — 테스트 표와 spec 표를 함께 갱신한다.
- `accessible`은 대중교통 시작 시점의 계단 회피 값을 그대로 승계한다(§14.2 하차 후 핸드오프와 같은 계약).
- 실험판 게이트: 대중교통 시작 버튼이 이미 `experimentalGuidanceEnabled` 안이라 추가 게이트 없음.

### 4.2 도보 세션의 종료 신호 — `BeaconModel.onSessionEnd`

`BeaconModel`에 세 값을 더한다.

- `prewalkTarget: String?` — 승차역 라벨. nil이 아니면 ①종료 화면을 남기지 않고(확정·추정·`stopLeavingSummary`가 `stop()` 앞에서 캡처해 분기) ②시트가 "승차역 도착" 버튼을 보인다 ③잊힌 세션 안전망(`maybeEndIdleSession`)이 돌지 않는다. `stop()`이 nil로 되돌린다.
- `onSessionEnd: ((EndReason) -> Void)?` — 발화점은 둘뿐이다. ⓐ `stop()`: 정리가 **끝난 뒤** 콜백을 꺼내 nil로 비우고 **다음 MainActor 턴**(`Task { @MainActor }`)에 전달한다 — `stop()`을 부른 자리가 그 뒤에 내는 종료 문장(`guide.endedIdle`·권한 실패·도착 문장)이 연결 문장보다 **먼저** 나가고, 모델 정리 도중 다른 모델 시작이 재진입하지 않는다(설계 리뷰 반영). ⓑ `begin()`의 시작 Task 말미: `starting = false` 뒤 `!isTracking`이면 `.startFailed`(세션이 시작되지 않아 `stop()`이 돌지 않는 경로 전부 — 권한 거부·정밀 위치·서비스 꺼짐·claim 거부·취소). `stop()`이 이미 비웠으면 no-op이라 이중 발화가 없다.
- `EndReason`: `arrived`(확정·추정·선언) | `userStopped`(`stopByUser`) | `startFailed` | `ended`(그 외: 권한 상실·목적지 변경·다른 세션 claim·teardown). 사유는 `pendingEndReason`에 `stop()` 직전 적고 `stop()`이 소비·초기화하며 세션 시작(`begin`)이 `.ended`로 되돌린다(이전 세션 값 재사용 금지). 종료 경로가 여럿이라(실측 7곳) 콜백을 경로마다 부르면 하나를 빠뜨린 경로가 조용히 연결을 끊는다 — 그래서 사유는 대입이고 발화는 `stop()` 한 곳이다. 이전 세션의 늦은 콜백은 `GuideSession`이 **컨텍스트 id**로 걸러 낸다(§4.4).

### 4.3 승차역 도착 선언 — `BeaconModel.declarePrewalkArrival()`

`BeaconTrackingSheet`가 `prewalkTarget != nil`일 때 종료 버튼 위에 "승차역 도착" 버튼(`ios.beacon.prewalkArrived`)을 둔다. 핸들러는 도착 경로와 같은 모양이다: `pendingEndReason = .arrived` → `stop()` → 도착 문장(`transitGuide.prewalkArrived`, §5). 톤은 `.nearby`(도착 종). 사용자 행위의 직접 응답이라 `.high`. 접근 가능한 이름에 역명을 넣는다("시청 도착" — 오조작 방지의 1선은 라벨이 무엇을 선언하는지 말하는 것이다). 되돌리기는 두지 않는다 — 잘못 눌렀으면 대기 국면의 "안내 종료" 뒤 재시작이 §2의 경로다.

### 4.4 연결 — `GuideSession`

```
endPrewalk(id, reason):
  guard let c = prewalk, c.id == id else { return }   // 다른 도보 세션·낡은 콜백은 무관
  prewalk = nil
  switch reason:
    .arrived:
        prewalkTask = 600ms 뒤 { transit.startAfterPrewalk(c.route, c.label, c.dest, c.accessible, prewalkCompleted: true) }
    .startFailed:
        transit.announce(prewalkUnavailable); transit.startAfterPrewalk(c..., prewalkCompleted: false)
    .userStopped:
        transit.announce(joinText(ios.beacon.stopped, prewalkCancelled))   // 요약 화면이 없어 stopByUser의 통지가 안 나가므로 여기서 함께
    .ended:
        transit.announce(prewalkCancelled)            // 그 앞에 종료 사유 문장은 도보 모델이 이미 냈다(비동기 전달 순서)
cancelPrewalk(): prewalk = nil; prewalkTask?.cancel(); beacon.onSessionEnd = nil; beacon.prewalkTarget = nil
```

- `startAfterPrewalk(..., prewalkCompleted:)`는 **기본값 없는 인자**다(안전 인자 규칙). 거부 게이트는 `start`와 같다 — 600ms 창에서 사용자가 다른 안내를 시작했다면 거부 통지가 나가고 연결은 끊긴다(정직한 실패이고, 그 창에서 두 세션을 억지로 잇지 않는다). `prewalkTask`는 세션이 소유하고 `startBeacon`·`startTransit`·`cancelPrewalk` 진입마다 취소한다(유령 시작 차단, 설계 리뷰 반영).
- **600ms는 §14.2 하차 후 핸드오프와 같은 값·같은 근거**(같은 계층 두 시트의 단일 presentation 제약)다. 설계 리뷰가 `onDismiss` 확인을 권했으나 `.sheet(item:)` 하나가 두 화면을 직렬화하는 현 구조에서 `onDismiss`는 사용자 제스처(=최소화)와 프로그램 dismiss를 구분하지 못하고, §14.2 선례가 실기기에서 2026-08-06부터 문제없이 도는 값이라 그대로 쓴다. 실기기 판정 항목으로 남긴다(§7).
- 화면 전환은 `screen` 계산 속성이 이미 한다: 도보 `stop()`으로 `.beacon`이 nil이 되어 시트가 내려가고(`hasScreen` false → `isMinimized` 리셋), 600ms 뒤 `transit.isTracking`이 `.transit`을 세운다. `GildongmuApp`의 시트 배선은 무변경이다.
- 착지: 대중교통 시트의 `.task`가 제목 행에 착지한다(종전 시작과 동일). 도착 통지(`.high`) 뒤 시작 통지가 이어진다 — 도착 문장은 `stop()` 직후 동기로, 시작 문장은 600ms 뒤라 순서가 구조적이다.
- 최소화(띠바) 상태에서 도착하면: `hasScreen`이 false로 떨어지는 순간 `isMinimized`가 리셋되어 600ms 뒤 대중교통 시트가 **펼쳐진 채** 올라온다. 이것이 유일한 기대 동작이다(국면이 바뀌었고 열차 선택은 시트 안 행동이다). 시트가 없는 600ms 동안 VO 커서는 탭 콘텐츠에 있고, 새 시트의 `.task` 착지가 제목 행으로 데려온다(종전 시작 착지와 같은 경로).

## 5. 통지·문구 (i18n `transitGuide.*`, 6로케일 + xcstrings 재생성)

| 키 | ko | 시점·채널 |
|---|---|---|
| `prewalkStart` | 승차역 {station}까지 도보 {minutes}분. 도보 안내를 먼저 시작합니다. | 시작 버튼 직후, 도보 시작 통지 앞. 대중교통 모델 창구(`announce`) |
| `prewalkArrivedButton` | {station} 도착 | iOS 시트 버튼·웹 버튼 라벨(선언) |
| `prewalkArrived` | 승차역 {station}에 도착했습니다. | 확정·추정·선언 도착의 문장(도보 세션의 `guide.arrived`·`guide.arrivedPresumed`를 prewalk에서 대체 — "목적지"라는 낱말이 승차역에서 거짓이다, 설계 리뷰 반영) |
| `prewalkUnavailable` | 도보 안내를 시작할 수 없어 승차 대기로 바로 넘어갑니다. | 시작 실패 시, 대중교통 시작 통지 앞 |
| `prewalkCancelled` | 대중교통 안내는 시작하지 않았습니다. | 도보 세션이 도착 아닌 사유로 끝났을 때, 그 종료 문장 뒤(사용자 중지는 `ios.beacon.stopped`와 한 문장으로 결합) |

- `prewalkArrived` 뒤에 "대중교통 안내를 시작합니다. 탑승 구간 N개. {승차역}에서 {노선} 탑승"(종전 시작 문장, 도보 문맥 없음)이 이어진다.
- 뻔한 꼬리 금지 규칙 준수: `prewalkCancelled`는 새 정보(대중교통 세션이 시작되지 않았다)라 유지.

## 6. 웹 미러 (`TransitGuidePanel`·`useTransitGuide`)

- `useTransitGuide`: `start()`는 **무변경**, `startAfterPrewalk(prewalkCompleted: boolean)`를 더한다(iOS §4.1 대칭). `prewalkTarget`을 훅이 계산해 노출한다(`guide.prewalkTarget`).
- 패널 시작 버튼: `prewalkTarget`이 있으면 세션을 시작하지 않고 `prewalk` 상태(진입 순간의 target·route를 ref 스냅숏 — props 변경에 흔들리지 않는다)로 들어가 `DistanceBeacon(dest=승차역, kind walk, accessible=walkAccessible, startOnOpen, focusTriggerOnMount, onSessionEnd)`을 마운트하고 `prewalkStart` 문장을 live region에 낸다. `onActiveChange(true)`는 prewalk 진입 시점부터 낸다(접힘으로 언마운트되면 도보 세션이 죽는다 — 기존 계약 그대로).
- `DistanceBeacon`·`useRouteGuide`에 `onSessionEnd?: (reason: "arrived" | "ended") => void`를 **추가만** 한다. 발화점은 `useRouteGuide`의 세션 종료 함수 한 곳이고 도착 분기는 도착 문장을 live region에 커밋한 **뒤** 세션을 끝낸다(설계 리뷰 반영 — 종전 순서는 stop 뒤 announce였으나 같은 렌더 배치라 관찰 차이는 없다. 순서를 명시적으로 도착 문장 → 종료 콜백으로 둔다). 두 파일은 계획 §2의 소유 목록 밖이지만 동시 활성 세션이 없고 추가 전용이라 이 세션이 만진다 — 통합 보고에 명시한다.
- 패널의 `onSessionEnd`: `arrived` → `prewalk` 소거 + `startAfterPrewalk(true)`(시작 문장 앞에 `prewalkArrived`를 붙여 같은 live region 한 번에 — `DistanceBeacon`이 언마운트되며 자기 live region을 잃으므로 도착 문장은 패널이 낸다). `ended` → `prewalk` 소거 + `prewalkCancelled`(iOS와 같은 **전체 종료** 정책 — 설계 리뷰가 지적한 플랫폼 간 계약 차이를 없앤다). 선언 버튼("{station} 도착")은 `declaredRef`를 세운 뒤 `startAfterPrewalk(true)`를 부른다 — `claimGuideSession`이 도보 세션의 stop을 먼저 부르고 그 stop이 낸 `ended`는 `declaredRef`로 무시한다(자기 유도 종료를 취소로 읽지 않게).
- `startAfterPrewalk`는 시작 실패 경로가 없다 — 웹 도보 세션은 시작 즉시 tracking이고 권한 거부는 세션 안 실패(`ended`)로 온다. 그 경우 iOS `.startFailed`와 달리 전체 종료다(웹은 "시작되지 않음"과 "시작 뒤 실패"를 가르는 층이 없고, 거부된 뒤 사용자가 시작 버튼을 다시 누르면 된다).

## 7. 테스트·검증 게이트

- 순수 함수: `transitPrewalkTarget`·`withoutPrewalk` 웹 단위 테스트 + Kit `TransitGuideTests` fixture 대조(공유 `prewalk` 키 — 두 플랫폼이 같은 기대값을 읽는다). 경계: 0분·null·`boardStop` 없음·2 leg 중 첫 leg만 판정·`withoutPrewalk`가 leg 1의 `walkBeforeMinutes`를 건드리지 않음.
- `guidance-gate-drift.test.ts`: 진입점 7 → 8, `self.startBeacon(` 2 → 3, `startTransit` 선언 본문에 `self.startBeacon(` 포함.
- 웹 컴포넌트(`TransitGuidePanel.test.tsx`): 도보 있는 경로의 시작 → `DistanceBeacon` 마운트 + prewalk 문장, `onSessionEnd("arrived")` → 세션 시작 + 대기 문맥에 "도보 N분" 부재, `onSessionEnd("ended")` → 세션 미시작 + 취소 문장, 선언 버튼 → 세션 시작, 도보 없는 경로 → 종전 렌더 그대로(기존 테스트 무변경 통과가 곧 증거).
- "종전과 같다"의 범위: **prewalk 판정이 null인 경로의 사용자 관찰 동작**(문장·DOM·상태 fixture). 저장소 바이트 동일이 아니다(i18n 키 추가·xcstrings 재생성이 있다).
- iOS 실기기(실승차 대본 `docs/FIELD-TEST.md`): 지상 출발 → 역 도착 종 → 시트 전환 → 열차 후보 착지 / 지하 진입으로 도착 미판정 → "승차역 도착" 버튼 / 도보 중 종료 → 대중교통 미시작 문장.

## 8. 설계 리뷰 판정

새 상태 전이·세션 연결(글로벌 규칙 ①)에 해당해 codex adversarial-review를 **실시했다**(§9). 반영 뒤 재리뷰는 하지 않는다 — 반영분은 기존 계약(§14.2 핸드오프·`stop()` 단일 소거·안전 인자 규칙)의 재조합이라 구현 단계 spec-compliance 리뷰가 잔여 리스크를 덮는다.

## 9. 적대적 리뷰 반영 기록 (2026-08-30, codex gpt-5.6-sol·high, 43건)

프롬프트에 spec 전문 + `GuideSession`·`BeaconModel` 종료 경로·`TransitGuideModel.start`·앱 시트 배선·웹 훅 발췌를 주입(파일 탐색·셸 금지). 판정 "승인 불가"였고 아래처럼 갈랐다. 같은 계층 지적이 반복된 곳(종료 사유·발화 시점)은 계층 자체를 고쳤다.

**반영(설계 변경)**
- 종료 화면이 `stop()` 뒤 `arrivalDest` 대입으로 되살아나 `.beacon`이 대중교통 시트를 영구 은폐(BLOCKER ×3) → 세 경로 모두 `stop()` 앞 캡처 분기(§2·§4.2).
- 시작 실패와 추적 중 권한 상실이 같은 `.startFailed`로 합쳐짐(BLOCKER) → 시작 실패 판정을 `begin()` Task 말미 `!isTracking` 한 곳으로, 추적 중 실패는 `stop()` 경유 `.ended`(§4.2).
- 콜백을 `stop()` 안에서 부르면 종료 문장보다 연결 문장이 먼저 나가고 정리 도중 재진입(BLOCKER·MAJOR) → 정리 완료 뒤 다음 MainActor 턴 전달(§4.2).
- 600ms Task 미소유·낡은 continuation·이전 세션 늦은 콜백(BLOCKER·MAJOR ×4) → 컨텍스트 id + 세션 소유 Task + 매 진입 취소(§4.4).
- 시작 실패에 `prewalkCompleted: true`는 걷지 않은 도보를 완료로 기록(MAJOR) → false 유지(§2).
- 유휴 안전망이 지하 진입 시 선언 버튼을 없앰(BLOCKER) → prewalk 세션엔 안전망 비적용(§2).
- 사용자 중지의 통지 부재(MAJOR) → `.userStopped` 사유 분리 + 결합 문장(§4.4·§5). "목적지에 도착" 낱말의 거짓(MINOR) → `prewalkArrived` 신설(§5).
- 웹 사용자 중지 정책이 iOS와 다름(BLOCKER), `onArrived`만으론 종료 사유를 모름(MAJOR), 선언 버튼의 claim 경합(BLOCKER), props 변경 시 route 불일치(MAJOR) → `onSessionEnd(reason)` 단일 계약 + 전체 종료 + `declaredRef` + 진입 스냅숏(§6).
- `transit.start` 시그니처 변경이 종전 경로를 새 분기로 보냄(MAJOR ×2)·byte-identical 표현(BLOCKER·MAJOR) → 별도 진입점 `startAfterPrewalk` + 주장 범위를 "관찰 동작 동일"로 축소(§4.1·§7). `withoutPrewalk` 복사 의미 명시(§3). 좌표 유효성 검사(MAJOR)(§3).

**기각(근거 기록)**
- 역사 중심 좌표 대신 출입구·접근점 좌표(BLOCKER ×2): 응답에 그 좌표원이 없고 출입구 승격은 지하철 출구를 의도적으로 배제한다. 수십 m 오차의 자동 도착은 대기 국면에 해가 없다(§2). 실기기 판정 항목.
- 600ms 대신 `onDismiss` 확인(BLOCKER): 단일 `.sheet(item:)` 구조에서 `onDismiss`가 최소화 제스처와 프로그램 dismiss를 못 가르고, §14.2 선례가 실기기 검증된 값(§4.4).
- 두 announcer 공유 arbiter(MAJOR): `prewalkStart`(대중교통 창구)와 도보 시작 통지(비콘 창구)는 둘 다 기본 우선순위라 VoiceOver가 큐에서 직렬화한다. 실기기 판정 항목.
- 버스 정류소 상·하행 구분(MAJOR): `boardStop`은 ODsay가 고른 특정 정류소(arsId·좌표)라 이미 구분된다.
- 선언 버튼 되돌리기(MAJOR): 대기 국면의 "안내 종료" + 재시작이 그 경로다(§4.3). 라벨에 역명을 넣는 것은 반영.
- Kit fixture 디코더 대칭화(MAJOR): 이미 §7이 두 플랫폼이 같은 `prewalk` 키를 읽어 같은 기대값과 대조한다고 정한다 — 지적의 전제가 spec과 다르다.

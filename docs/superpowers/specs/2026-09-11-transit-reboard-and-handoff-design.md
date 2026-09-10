# 대중교통 안내: 하차역 선언·탑승 열차 재확인·도보 인계 단일 버튼 설계 (A37 ② · A34 ②+① · E34)

> 2026-09-11, transit-1 세션. 판정 정본은 `docs/BACKLOG.md` §1 A37·A34, §5 E34(위원장 판정 2026-09-10). 실험판 봉인(`#if EXPERIMENTAL`) 안이며 서버 변경 없음. 상태 머신 정본은 B2 spec `2026-08-04-transit-guidance-design.md` §13과 N3 spec `2026-08-22-transit-boarding-phase-design.md`.
>
> **설계 리뷰 판정**: 필수(새 상태 전이 2종이 §13 상태 머신·`guidance-gate-drift`·A16 탈출구를 지난다). 1회 적대적 리뷰(opus, `~/gildongmu-wt/reports/transit-1-review-design.md`)를 받아 §9대로 반영했다 — 이 문서는 반영 뒤 판이다.

## 1. 문제 (판정 원문 요지)

세 항목은 뿌리가 하나다 — **leg 종료가 관측(`arrived`)에만 매달려 있고, 사용자 선언은 "이미 탑승했습니다"라는 정반대 라벨의 버튼이 우연히 겸한다.**

- **A37 ②** 하차역을 지나쳐 되돌아온 사용자가 역 선택(`reboardStationPicker`)에서 하차역을 골라도 앱은 대기 국면으로 되돌려 "탑승할 차량을 선택하세요"라고 되묻는다. [다음 구간]은 관측 도착이 없으면 영영 안 나온다. 판정: **하차역 선택 = 도착 선언**(대기 국면으로 되돌리지 않는다). 상시 종료 버튼은 기각.
- **A34 ②+①** [이미 탑승했습니다]가 만드는 근사 잠금은 하차역에 가장 가까운 열차를 잡아 "도착지 코앞 역에 탑승한 것"으로 표시된다. 판정: **먼저 "지금 어느 역인가요"를 묻고 그 역의 도착 목록에서 실제 열차를 고르게 한다**(A37의 역 선택 화면 재사용). 목록이 빌 때만 근사이고 **그때는 열차 위치·남은 정거장을 말하지 않는다**. 급행 확인(A16 ⑦⑧)은 흐름 안에서 유지.
- **E34** 마지막 leg에서 [다음 구간] → 인계 시트 [남은 도보 안내 시작]을 두 번 누른다. 판정: **버튼 하나, 라벨이 처음부터 "남은 도보 안내 시작"**, 한 번 누르면 leg 종료와 도보 시작이 함께.

## 2. 범위

**한다**: 위 셋의 iOS(실험판) + 웹 미러 + 공유 fixture + 6로케일 문장. 판정 회수 행(BACKLOG §2·FIELD-TEST §5).

**하지 않는다**(판정 원문이 밖으로 둔 것): A37 ①(지나친 역을 목록에 넣기)·③(국면 무관 종료 수단) / N3 "[탑승했습니다] 제거·이름 판정"(별건 — 단, 이 spec의 새 버튼 이름은 N3 이름 판정과 겹치지 않게 고른다) / A35 착지 실패율 / A36 `neverSeen` 축 / 서울버스·지방버스의 역 선택(§4.2 근거) / 승차 중 "탑승 변경"(A16 L3) 경로의 의미 변경(§4.2 끝).

## 3. 현행 계약 중 이 설계가 딛는 것 (리뷰가 코드로 확인한 서술)

- 국면 `waiting → boarding → riding → arrived → (advance) → waiting|done`. 사용자 입력은 `board(lock)`·`confirmBoarded`·`restoreBoarding`·`changeBoarding`·`advance`, 나머지는 `poll`. 리듀서는 Kit `transitGuideStep` ↔ 웹 `transitGuideStep` 미러이고 공유 fixture `transit-guide-scenarios.json`이 동조를 강제한다.
- `canAdvance` = `arrived` ∨ `untrackable` ∨ (riding ∧ 근사 잠금). 근사 잠금 = `vehicleId == ""`(`isApproxTransitLock`). 근사 잠금의 riding은 `transitFindLockedItem` 근사 분기(방향 일치 ∧ 잔여 최소)로 매칭해 `trackingStarted`·`countdown`·`approxVehicleChanged`를 낸다 — **이것이 A34의 어림값이다**. 지방버스(`tagoBus`)는 설계상 근사가 유일한 추적이라 이 분기의 정당한 소비자다.
- 앱 층 상태(리듀서 밖): `boardOverrideIndex`(대기 조회 기준 역, riding 진입에 소거) · `reboardPickerActive`(riding 전용 역 선택 화면, 국면이 riding을 벗어나면 소거) · `pendingWalkHandoff`(마지막 `advance` 뒤 `stop()` **다음에** 남는 인계 제안, `GuideSession.acceptWalkHandoff`가 소비).
- ⚠ **즉폴은 주기 0을 무시한다**: `restartPollLoop(immediate: true)`의 조기 반환은 `!immediate`에만 걸려, 주기가 0이어도 폴 한 번은 나간다(백그라운드 복귀도 즉폴). "주기 0 = 폴 없음"은 이 게이트를 함께 고쳐야 성립한다(리뷰 B1).
- ⚠ **`acceptWalkHandoff`의 `transit.stop()`이 지연 슬롯의 보류 문장을 취소한다**(`advanceGeneration`). `advance()`가 지연 슬롯에 낸 `doneWalk`는 같은 턴에 인계를 수락하면 게시되지 않는다(리뷰 M3).
- 도보 세션 시작 진입점은 8곳이고 `guidance-gate-drift.test.ts`가 `beacon.toggle(`·`beacon.restart(`·`session.startBeacon(`·`self.startBeacon(` 형태로 센다. `GuideSession` 안 `self.startBeacon(`은 3(`acceptWalkHandoff`·`acceptCarWalkHandoff`·`startTransit`).
- 착지 정본 시퀀스 `TransitTrackingSheet.landControlFocus`(가시화 → 지연 → 경합 해제 → 대입 → 검증 → 1회 재시도) + `TransitGuideDiag` 로그 `controlFocus target= landed=`. 국면 전이 착지는 `phaseTransitionLanding`(arrived → `.advance`).
- `onWalkHandoff`는 `transit.dest == nil`일 때만 nil인데 `dest`는 세션 시작의 비옵셔널 인자이고 `stop()`이 비우지 않는다 — 세션이 한 번 시작됐으면 **nil이 되는 경로가 없다**(리뷰 M7).

## 4. 설계

### 4.1 A37 ② — 하차역 선언 입력 `declareArrived`

**리듀서(Kit ↔ 웹)**: 새 입력 `declareArrived`.
- 가드: `phase ∈ {waiting, riding}` ∧ `signal != untrackable`. 그 밖(boarding·arrived·done)은 no-op(UI 노출 조건에만 기대지 않는다 — 기존 `advance` 가드와 같은 이유).
- 전이: `phase = arrived`, `arrivedCertain = true`, `phaseGen += 1`, 잠금 추적 필드 초기화(`remaining`·`lastMessage*`·`currentLocation`·`dataStamp`·`dataAgeSeconds`·`ladderAnnounced`·`trackingAnnounced`·`missCount`·`lastUpdatedAt`), `lock`은 유지(riding에서 온 경우 어떤 열차였는지의 기록 — `expressStatusLine` 상시 표시가 읽는다), `ridingSince = nil`.
- 이벤트: `arrived(certain: true)`. 새 이벤트 종류를 만들지 않는다 — 소비자(통지 문장·톤 프로파일·톤 계층·조망)가 관측 도착과 같은 뜻으로 읽어도 맞기 때문이다.
- `certain = true`인 근거: 사용자 선언은 되돌릴 대상이 아니다. `certain: false`로 두면 늦은 폴의 재관측이 `backOnTrack`으로 riding에 되돌린다(정확히 A37이 막으려는 막다른 길의 재진입).
- **`handleChangeBoarding`은 `arrived ∧ arrivedCertain`에서 no-op**(리뷰 관찰): 종전엔 arrived를 허용해 `previousPhase = riding`으로 복귀시켰다. 두 플랫폼 UI 모두 arrived에서 그 버튼을 세우지 않아 도달 불가지만, `advance` 가드가 UI에 기대지 않는 것과 같은 논거로 리듀서가 막는다. 추정 도착(`certain: false`)은 종전대로 허용.
- **폴 없음(선언·관측 공통)**: `transitPollIntervalMs`가 **`arrived ∧ arrivedCertain`에서 0**을 내고, **`restartPollLoop`의 조기 반환을 `immediate`와 무관하게 `interval <= 0`으로 바꾼다**(B1). 그래야 선언 직후·백그라운드 복귀의 즉폴이 새 세대로 나가 `remaining`·`lastMessage`를 되살리는 일이 없다. `phaseGen += 1`은 선언 **전에** 나간 폴의 응답을 폐기하는 몫이다. 웹 `scheduleNext`는 주기 0에 예약하지 않으므로 `pollOnce`를 직접 부르는 자리(`declareArrived`·복귀)에서 같은 게이트를 건다.

**앱 층(iOS `TransitGuideModel` ↔ 웹 `useTransitGuide`)**: `declareArrived()` = dispatch + 폴 루프 재시작(주기 0이라 정지) + 대기 스냅숏 소거. 통지는 **관측 도착과 같은 지연 창구 `announce`**(리뷰 M4 — `.arrive` 톤(도착 종 2.25초)이 문장 앞머리를 자르는 것을 막는 것이 지연 슬롯의 도입 근거이고, 이 경로엔 즉시 창구가 필요한 폴 이벤트 경합이 없다).

**역 선택 화면(iOS `reboardStationPicker` ↔ 웹 픽커)**: 행 인덱스가 `stops.count - 1`(하차역)이면 `changeBoarding(at:)` 대신 `declareArrived()`. 나머지 행·취소는 불변. 하차역 행의 라벨은 그대로 역 이름이다 — "여의도(하차)"처럼 꼬리를 붙이지 않는다(그 목록의 마지막 행이 하차역이라는 것은 이미 `viaStopsRows`가 "하차" 역할로 보여 주고, 이 화면은 "지금 어느 역인가"를 묻는 화면이라 답 후보에 설명을 얹으면 질문이 바뀐다).

**착지**: 전이 `riding|waiting → arrived`는 기존 `phaseTransitionLanding`이 `.advance`에 착지시킨다(E34로 그 자리 버튼이 "남은 도보 안내 시작"이어도 `SheetControl.advance` 동일). 로그는 기존 `controlFocus target=advance landed=`.

**상태줄**: `arrived` 국면의 신호 문장은 신호와 무관하게 **`stateArrived`("하차 지점 도착.")** 하나다(관측·선언 공통). 종전엔 관측 도착이 "추적 중.", 추정 도착이 직전 신호 문장을 그대로 냈고, 선언 도착은 A33 문장("하차역에 가까워지면 열차 위치가 표시됩니다")을 내게 되어 거짓이 된다.

### 4.2 A34 — "이미 탑승했습니다"는 역을 묻고, 목록에서 고르면 식별 잠금으로 riding

**흐름(지하철, 대기 국면)**:

```
[이미 탑승했습니다]
  → (aboardStep = pickStation) 역 선택 화면 재사용: 헤딩 "지금 어느 역을 지나고 계신가요?"(전용 키) + 경유역 행 + [역 선택 취소]
     · 중간역·승차역 행 → boardOverrideIndex = i, aboardStep = pickVehicle, 대기 스냅숏·3분 버퍼 소거, 즉폴
     · 하차역 행       → declareArrived (§4.1 — "하차역을 지나고 있다" = 도착 선언)
     · 취소            → aboardStep = nil, 착지 [이미 탑승했습니다]
  → (pickVehicle) 그 역 기준 목록(그 역에 있는 열차만, 아래 후보 필터): 라벨 "타고 계신 차량을 선택하세요" + 후보 행 + [새로고침] + [다른 역 선택]
     · 후보 행 선택    → boardAboard(lock)  ⇒ riding(declared, 식별 잠금)   ← 정상 잠금
     · 목록 0건일 때만 → [열차 정보 없이 계속] (급행 집합 노선이면 급행 확인 프롬프트 선행) → boardAlready(express:) ⇒ riding(declared, 근사 잠금 = 비관측)
     · [다른 역 선택]  → pickStation
```

**질문 문장(리뷰 M2)**: 이 화면의 질문은 A16 L3의 "지금 어느 역에 계신가요?"(갈아탄 뒤 서 있는 역)와 **다른 질문**이다 — 목록이 성립하는 조건이 "내 열차가 그 역에 접근·정차·출발 중"이기 때문이다. 전용 키 `aboardStationPrompt` = "지금 어느 역을 지나고 계신가요?"(위원장 판정 원문의 표현). 화면·행·취소·착지는 재사용.

**후보 필터(리뷰 B2)**: pickVehicle 목록은 그 역 도착 목록 전체가 아니라 **그 역에 있는 열차**(`arrivalCode ∈ {0,1,2,3,4,5}` — 진입·도착·출발·전역 출발/진입/도착, 즉 한 정거장 안)만 세운다(`transitAboardCandidates` 순수 함수, Kit ↔ 웹). `99`("N번째 전역", 두 정거장 이상 밖)는 사용자가 타고 있을 수 없으므로 뺀다. 이 필터가 N3의 교차검증(선택 열차의 승차 정류소 도착 관측)과 같은 급의 증거 — "내가 있다고 말한 역에 그 열차가 있다" — 를 만들고, 그래서 아래 `boardAboard`가 식별 잠금의 확정 도착 권한을 그대로 갖는다. 오선택 위험은 인접 열차 하나로 좁혀지며 완성 문장("X 도착" vs "전역 출발")이 마지막 구분 재료다. ⚠ 이 판정(선언 식별 잠금에 확정 도착 권한)은 §7 실승차 표에 회수 행으로 세운다 — 실승차에서 조기 도착 선언이 관측되면 `certain: false` 갈래(늦은 폴 `backOnTrack`과의 상호작용 재설계 포함)로 되돌린다.

**리듀서 — 새 입력 `boardAboard(lock)`**: 가드 `phase == waiting ∧ signal != untrackable ∧ !isApproxTransitLock(lock)`. 전이 `enterRiding(lock, cause: .declared)`, 이벤트 `boarded(cause: declared)`. `board(lock)` + `confirmBoarded` 두 스텝으로 만들지 않는 이유: 그 경로는 `vehicleSelected`("{desc} 선택. {역} 도착을 기다립니다.")를 먼저 내는데 이미 탄 사용자에게 거짓이고, boarding 국면을 스쳐 지나며 `phaseTransitionLanding(waiting→boarding)`이 `.confirmBoarded` 착지를 예약한다. 앱 층은 `selectedDescription`을 dispatch 전에 세우고(`board()` 동형), `boarded(declared)` 통지 문장 뒤에 "선택한 차량: {desc}."(`selectedVehicle` 키 재사용)를 붙여 **어느 열차를 잠갔는지** 확인시킨다(리뷰 m5). riding 상태줄도 `selectedDescription`이 있으면 같은 조각을 낸다(관측 riding도 동일 — 어느 열차인가는 정보다).

**리듀서 — 근사 잠금의 두 갈래**: 근사 잠금 중 **지방버스가 아닌 것**(= 지하철·서울버스의 "이미 탑승했습니다" 폴백)을 **비관측 잠금**(`transitLockIsUnobserved(lock)` = `isApprox ∧ mode != tagoBus`)으로 정의한다.
- `transitPollIntervalMs`: riding ∧ 비관측 잠금 → **0**(폴 없음, B1 게이트로 즉폴도 없음). 어느 열차인지 모르는데 하차역 목록을 읽어 봐야 쓸 곳이 없고(표시 폐지), 예산만 쓴다.
- `handlePoll`: riding ∧ 비관측 잠금이면 매칭·미등장 판정을 지나지 않는다(`lastUpdatedAt`만 갱신 후 반환 — 방어선). 그래서 `trackingStarted`·`countdown`·`approxVehicleChanged`·`signalLost`·`neverSeen`이 **구조적으로 나지 않는다**(표시만 가리면 톤 계층 `transitToneStep`이 잔여 앵커로 사다리 톤을 내는 구멍이 남는다 — 1선은 구조).
- **`transitFindLockedItem`의 급행 우선 분기는 은퇴한다**(리뷰 M6): 유일한 소비자가 지하철 근사 잠금이었고(지방버스는 `express`를 싣지 않는다) 그 잠금이 비관측이 되면 도달 0이다. 도달 불가 코드를 "검증된 계약"으로 남기지 않는다. A16 §6 급행 확인에 남는 가치는 **통과 급행이면 잠금 자체를 막는 거절**(`transitDeclaredExpressVerdict == .skips`)과 `lock.express` 상시 문장이다 — 이 두 축은 불변. 방향 필터·잔여 최소 분기는 지방버스가 계속 소비한다.
- `canAdvance`는 불변(riding ∧ 근사 → 상시 `advance`). 비관측 riding의 출구는 셋: 하차역 부근에서 `advance`(E34면 "남은 도보 안내 시작") / [탑승 변경] → 역 선택 → 목록에서 실제 열차(A16 L3 경로) / [안내 종료].

**상태줄·문장 선택기(리뷰 M1)**: `signalStatusText(signal, phase:, isTrain:, unobserved:)`에 **비관측 여부를 기본값 없는 필수 인자**로 더한다. 세 호출 지점(상시 표시·백그라운드 복귀 통지·조망 침묵 행 `silenceText`)이 컴파일로 강제되고, 비관측이면 신호와 무관하게 **`stateRidingUnobserved`**("탑승 열차가 확인되지 않아 열차 위치를 표시하지 않습니다." / 버스 변형)를 낸다. 웹 `signalText` 2곳 동형. 비관측 riding 상태줄 = 문맥 + 그 문장 + 급행 선언 문장(있으면). **잔여·프레임·`dataAge`·"마지막 갱신"(폴이 없으니 신선도는 정보가 아니다 — m4)·`approxNote`는 내지 않는다.** `approxNote`("근사 추적: 같은 노선의 접근 차량 기준")의 판별자는 국면이 아니라 **`leg.trackMode == .tagoBus`** 하나로 좁힌다(m2 — 비관측 잠금은 접근 차량 기준이 아니고, 선언 도착 뒤에도 그 주석이 상속되지 않게).

**급행 확인(A16 ⑦⑧) 유지 방식**: 프롬프트는 [열차 정보 없이 계속] 앞에만 선다. 목록에서 실제 열차를 고르는 경로는 후보 행 자체가 `expressVerdict`·`unreachable(expressSkipsAlight)`를 이미 판정해 통과 급행을 버튼 없는 사유 줄로 막으므로(A16 L1, 하차역 기준이라 조회 역과 무관) 물을 것이 없다. 거절 문장(`expressBlockedNote`)·착지 폴백·`lock.express` 상시 문장은 종전 그대로. 프롬프트 리셋 축에 **`aboardStep` 변화**를 더한다(m3 — 역을 바꾸면 그 역에 대한 답이 아니다).

**앱 층 상태**: `aboardStep: AboardStep?`(`pickStation`·`pickVehicle`), 대기 국면 전용. 소거: 국면이 waiting을 벗어날 때(`dispatch`, `reboardPickerActive`와 같은 국면 기반 규칙), 취소, `stop()`, 경로 교체(`changeRoute`). pickVehicle 진입은 `waitingLive`·`waitingDeparted`·`waitingReason`·`retained`를 비운다(m1 — 승차역 목록·3분 버퍼가 다른 역 목록에 섞이지 않게; `changeBoarding()`이 스냅숏을 비우는 것과 같은 근거이고, 이 흐름은 재선택이 아니라 첫 잠금이라 버퍼도 함께 비운다). `boardOverrideIndex`는 종전 계약 그대로(riding 진입에 소거).

**왜 지하철만인가**: 역 선택의 조회 기준 교체는 `fetchPoll(.subway)`가 역 *이름*으로 조회하기 때문에 성립한다. 서울버스 대기 조회는 승차 정류소 `arsId`이고 경유 정류소의 `arsId` 보유를 검증하지 않았다(`beginReboard`가 지하철 전용인 근거와 같다). 서울버스 [이미 탑승했습니다]는 종전대로 곧장 근사 잠금으로 가되 **비관측 잠금**이 되어 어림값을 내지 않는다(A34 ①은 적용, ②는 미적용 — 이 비대칭을 §7 실승차 표에 적는다).

**승차 중 "탑승 변경"(A16 L3) 경로는 바꾸지 않는다**: riding → 역 선택 → waiting(목록) → 후보 선택 → **boarding**(승차 정류소 도착 관측 대기) → 관측 또는 [탑승했습니다]로 riding. 09-09 로그가 이 경로로 정확한 잠금에 이르렀고(16:12:46 `boarded(observed)`), N3 판정이 [탑승했습니다]의 운명을 따로 정하므로 여기서 손대면 두 spec이 같은 버튼을 다룬다. 다만 하차역 행만은 §4.1이 이 경로에도 적용된다(A37 ②의 자리).

### 4.3 E34 — 마지막 leg의 버튼은 "남은 도보 안내 시작" 하나

**조건**: `state.legIndex == route.legs.count - 1` ∧ `route.walkAfterMinutes != nil` ∧ `onWalkHandoff != nil`. §3대로 세 번째 항은 세션이 시작된 뒤엔 항상 참이라, 실질 조건은 앞의 둘이다. 하나라도 빠지면 종전 [다음 구간]·[이 구간을 마치고 다음 구간으로].

**동작(iOS 시트)**: `advance` 자리 두 키(`advance` — arrived·근사 riding, `advanceUntrackable` — 추적 불가 수동 전진; 리뷰 m6)의 버튼 라벨을 `transitGuide.walkHandoffStart`로 바꾸고, 핸들러는 **`model.advanceIntoWalkHandoff()`** 뒤 그 반환이 참일 때만 `onWalkHandoff?()`(= `GuideSession.acceptWalkHandoff`: transit 종료 → 제안 소거 → 600ms → `startBeacon`). `advanceIntoWalkHandoff()`는 `advance()`와 같은 전이이되 **`doneWalk` 문장을 내지 않는다**(리뷰 M3 — 그 문장은 어차피 `acceptWalkHandoff`의 `stop()`이 취소하고, `arrived` 통지가 이미 도보 분을 말했다. 우연이 아니라 설계로 침묵시킨다). 반환 false(전이 실패)면 세션을 끊지 않는다. `SheetControl`은 `.advance` 그대로(착지 대상 정체성 불변). untrackable 자리는 종전대로 착지 바인딩이 없다(현행과 같음, A35 범위).
- 새 진입점을 만들지 않는다 — 도보 세션 시작은 여전히 `acceptWalkHandoff`의 `self.startBeacon(` 한 곳이고 `guidance-gate-drift` 계수(8, GuideSession 안 3)는 **불변**이다. 그 테스트의 §3 주석과 G4 주석("대중교통→도보 핸드오프는 사용자 활성화가 아니고" — 현행에서도 틀렸다)을 고친다.
- **인계 제안 화면(`walkHandoffSection`)은 통째로 지운다**(리뷰 M7): §3대로 `onWalkHandoff == nil` 경로가 없어 도달 0이다. `SheetControl.walkHandoff`·`controlExists(.walkHandoff)`·`.onChange(of: pendingWalkHandoff)` 착지·`state == nil` 분기의 섹션 렌더를 함께 지운다. `pendingWalkHandoff`는 "이번 `advance`가 말미 도보를 남겼다"는 **한 턴 수명 신호**로만 남고 `acceptWalkHandoff`가 같은 턴에 소비한다. `GuideSession.screen`·`GuideBand.hasWalkHandoff`가 그 값을 읽는 자리는 한 턴 안에 set→clear라 화면 전이가 없다 — 소유 밖 파일(`GildongmuApp`·Kit `GuideBand`)이라 손대지 않고 보고에 남긴다(후속 doc-audit/정리 후보).

**도착 통지 문장**: `arrived`·`arrivedGuess`의 꼬리 "다음 구간 버튼을 눌러 주세요"가 그 자리에 없는 버튼을 가리키게 되므로, §4.3 조건이 참인 leg에서는 **`arrivedWalkNext`·`arrivedGuessWalkNext`**("… 내리신 뒤 남은 도보 안내 시작 버튼을 눌러 주세요. 목적지까지 도보 {minutes}분.")를 쓰고 그 leg에서는 뒤따르던 "다음: 대중교통 구간이 끝났습니다. 목적지까지 도보 N분."(`nextLeg(doneWalk)`) 조각을 **내지 않는다**(리뷰 M3·관찰 — 도보 분은 새 문장이 담고, "대중교통 구간이 끝났습니다"는 내리기 전에 들으면 어색하다). 중간 leg는 불변.

**웹 미러**: `TransitGuidePanel`의 `advance` 버튼이 같은 조건에서 라벨 `walkHandoffStart`, 클릭 = `guide.advanceIntoWalkHandoff()`(→ `doneHandoff`, `doneWalk` 통지 없음) 뒤 `DistanceBeacon`을 **`autoStart`**로 마운트. `autoStart`의 계약(리뷰 M5): ①`open`의 초기값이 `autoStart`(패널 내용이 함께 열린다) ②트리거 라벨 판정은 `(startOnOpen || autoStart) && tracking ? "중지"` ③세션 시작은 **커밋 뒤 effect**(마운트 1회)에서 — live region이 빈 채로 먼저 DOM에 있어야 첫 통지가 발화된다(그 자리 주석의 en 무발화 결함 조건) ④`focusTriggerOnMount`는 그대로 함께 넘긴다(착지). ⚠ `DistanceBeacon.tsx`는 코디네이터 허가로 transit-1 소유(2026-09-11).

### 4.4 문장·키 (`messages/*.json` `transitGuide.*`, 6로케일, ko 원문)

| 키 | ko | 자리 |
|---|---|---|
| `stateArrived` | 하차 지점 도착. | arrived 국면 상태줄 신호 문장(§4.1) |
| `stateRidingUnobserved` | 탑승 열차가 확인되지 않아 열차 위치를 표시하지 않습니다. | 비관측 riding 상태줄·복귀 통지·조망 침묵 행(§4.2) |
| `stateRidingUnobservedBus` | 탑승 버스가 확인되지 않아 버스 위치를 표시하지 않습니다. | 서울버스 비관측 riding |
| `aboardStationPrompt` | 지금 어느 역을 지나고 계신가요? | pickStation 헤딩(§4.2 M2) |
| `waitingLabelAboard` | 타고 계신 차량을 선택하세요 | pickVehicle 목록 라벨(착지점) |
| `continueWithoutTrain` | 열차 정보 없이 계속 | pickVehicle 0건 폴백 버튼(지하철 전용 화면이라 버스 변형 없음) |
| `pickAnotherStation` | 다른 역 선택 | pickVehicle → pickStation |
| `arrivedWalkNext` | 하차 지점에 도착했습니다. 내리신 뒤 남은 도보 안내 시작 버튼을 눌러 주세요. 목적지까지 도보 {minutes}분. | E34 leg의 확정 도착 통지 |
| `arrivedGuessWalkNext` | 하차 지점에 도착한 것으로 보입니다. 내리셨으면 남은 도보 안내 시작 버튼을 눌러 주세요. 목적지까지 도보 {minutes}분. | E34 leg의 추정 도착 통지 |

재사용: `reboardStationPrompt`(riding 픽커만)·`reboardCancel`·`refresh`·`walkHandoffStart`·`selectTrain`·`selectedVehicle`·`expressPrompt`·`expressYes`·`expressNo`. [열차 정보 없이 계속]은 N3 이름 판정의 예외 수단 이름과 같다 — 같은 개념(관측 불가 상황의 수동 진행)이라 의도적으로 같게 둔다. `{minutes}`는 새 키라 `arg-order.json`에 자동 등록된다.

### 4.5 접근성

- 새 통지는 전부 `announce`/`announceNow` 창구(모델). 시트는 통지를 내지 않는다.
- 착지(전부 `landControlFocus` 정본 시퀀스, 새 대상은 `TransitGuideDiag` `controlFocus target=… landed=`가 기록):
  - [이미 탑승했습니다] → pickStation: `.reboardPrompt`(헤딩, 기존 `.task` 착지 재사용 — 버튼으로 펼친 것이라 헤딩이 발견 경로, 헌장 §3).
  - pickStation [역 선택 취소] → 새 `SheetControl.boardAlready`(눌렀던 자리로 복귀 — riding 취소가 `.changeBoarding`으로 돌아가는 것과 동형).
  - 역 선택 → pickVehicle: `.waitingLabel`(라벨 텍스트가 "타고 계신 차량을 선택하세요"로 바뀌어 착지 낭독이 곧 질문).
  - [다른 역 선택] → `.reboardPrompt`.
  - 하차역 선택·후보 선택 → 국면 전이 착지(`phaseTransitionLanding`: arrived → `.advance`, waiting→riding → `.changeBoarding`).
  - `controlExists`에 `aboardStep` 조건 추가(`.reboardPrompt`는 riding 픽커 ∨ waiting pickStation, `.boardAlready`는 waiting ∧ aboardStep == nil).
- 한 줄 = 한 객체 유지: 새 문장은 전부 단일 `Text`/`<p>`. 버튼 라벨에 상태 꼬리 없음.
- A35(착지 실패율)는 손대지 않는다 — 기존 헬퍼 그대로.

### 4.6 계측

`transitGuideLog`: `declareArrived from=<phase> leg=<i>` · `aboard step=<pickStation|pickVehicle|cancel> station=<i>` · `boardAboard vehicle=<id>` · `walkHandoffNow pending=<bool>`. ⚠ 비관측 riding에선 폴이 없어 `ridePoll` 계측(A16 미확정 ①)이 0건이다 — 예산과 맞바꾼 의도된 상실이니 다음 로그 회수에서 "왜 비었나"를 다시 조사하지 않는다. 로그 파일은 커밋하지 않는다.

## 5. 불변식 점검

| 축 | 결과 |
|---|---|
| §13 상태 머신 | 새 입력 2(`declareArrived`·`boardAboard`)·새 전이 `waiting→arrived`·`waiting→riding(식별 선언)`. 새 국면·새 신호·새 이벤트 종류 없음. `changeBoarding`은 확정 도착에서 no-op으로 좁힌다(§4.1). |
| `guidance-gate-drift` | 진입점 8·`GuideSession` 3 불변(§4.3). 주석만 갱신. |
| A16 L2 탈출구(`neverSeen` → 역 선택) | 식별 잠금 riding은 불변. 비관측 잠금은 `neverSeen`이 구조적으로 안 나므로 그 탈출구가 필요 없다(대신 `advance` 상시 + [탑승 변경]). |
| A16 ⑦⑧ 급행 확인 | 폴백 앞에 유지. 목록 경로는 L1 판정이 대신한다(§4.2). **추적 개선 축(급행 항목 우선 매칭)은 은퇴** — 남는 가치는 통과 급행 잠금 거절 + 상시 문장. |
| A16 L3 기준 역 수명 | `boardOverrideIndex` 소거 규칙 불변(riding 진입·advance). `boardAboard`도 riding 진입이라 같은 자리에서 지워진다. |
| N3 boarding 국면 | 손대지 않는다. `boardAboard`는 boarding을 지나지 않는다. 증거 수준은 후보 필터가 대신한다(§4.2). |
| E15 ② 톤 계층 | 비관측 riding은 이벤트·잔여가 없어 톤 0. 선언 도착의 `arrived` 이벤트는 관측 도착과 같은 도착 톤(1회)이고 문장은 지연 슬롯이라 잘리지 않는다. |
| E15-1 조망 | `here`는 `unknown(noObservation)`. 침묵 행 문장은 `signalStatusText` 선택기를 지나 비관측이면 `stateRidingUnobserved`(M1). `reboardOffered`는 riding에서만이라 선언 도착 뒤 없음. |
| A25 prewalk·N1 시트 수명 | 무관(시작 경로 불변). `acceptWalkHandoff`의 600ms 단일 presentation 계약 그대로 — E34는 현행 2탭 흐름의 두 번째 탭과 같은 전이. |
| 개인정보 3자 일치 | 수집·전송 항목 변화 없음. |

## 6. 테스트

- 공유 fixture(`transit-guide-scenarios.json`, 웹·Kit 러너 양쪽에 `declareArrived`·`boardAboard` 입력 변환 추가):
  1. riding(식별 잠금, 관측 없음) → `declareArrived` → `arrived`·`arrivedCertain`·`arrived(certain:true)` → 옛 세대 폴 폐기 → `changeBoarding` no-op → `advance` → done.
  2. waiting → `declareArrived` → arrived → advance → 다음 leg waiting.
  3. boarding·arrived·done에서 `declareArrived`는 no-op.
  4. waiting → `boardAboard(subway5696)` → riding·`boarded(declared)` → 하차역 폴 매칭 → `trackingStarted`(식별 잠금이라 관측 정상).
  5. `boardAboard(근사 잠금)`·boarding에서 no-op.
  6. **기존 근사 시나리오 전수(파일별)**: 리듀서 fixture 3 — "근사 잠금(지하철 이미 탑승): 방향 필터·잔여 최소 매칭·arrived 미발동" → **비관측 계약**으로 다시 쓴다(폴이 와도 `remaining == null`·이벤트 없음·신호 `notYetVisible` 유지·10분 뒤에도 `neverSeen` 없음) / "근사 잠금: 임박 소실은 도착 추정이 아니다" → 잠금을 `tagoApprox`로 바꿔 축 보존 / "근사 잠금 급행 선언(§6): 급행 항목만" → **삭제**(분기 은퇴). 톤 fixture 1 — "⑬ 근사 잠금: 잔여 증가는 approxVehicleChanged" → 잠금을 `tagoApprox`로.
  7. `pollIntervalMs`: 비관측 riding 0 · 확정 arrived 0 · 추정 arrived 15/60s 유지 · 지방버스 근사 riding 종전 값.
  8. `transitAboardCandidates` 단위(코드 0~5 통과, 99·nil 제외).
  9. 변이 주입 1회: 비관측 잠금의 `handlePoll` 조기 반환을 제거했을 때 fixture 6의 첫 시나리오가 빨간불인지 실측해 커밋 메시지에 남긴다.
- 웹 jsdom(`TransitGuidePanel.test.tsx`): (a) 이미 탑승 → 전용 헤딩 착지 → 중간역 → 목록 라벨 "타고 계신 차량" 착지 → 후보 선택 → riding + `changeBoarding` 착지, 조회 URL이 고른 역, 상태줄에 선택 차량. (b) 목록 0건(99뿐이면 필터로 0건) → [열차 정보 없이 계속] → 상태줄에 `stateRidingUnobserved`·`approxNote` 없음·`remainingCount` 없음·`lastUpdated` 없음. (c) 역 선택에서 하차역 → arrived(`stateArrived`) → 마지막 leg 버튼 라벨 `walkHandoffStart` → 클릭 1회로 세션 종료 + `DistanceBeacon` 자동 시작(live region에 시작 문장, 트리거 "중지"). (d) 중간 leg의 arrived는 여전히 `advance`. (e) 급행 집합 노선의 0건 폴백은 급행 확인을 먼저 묻는다. (f) 복귀 통지가 비관측이면 `stateRidingUnobserved`.
- Kit: fixture 러너 + `transitPollIntervalMs`·`transitLockIsUnobserved`·`transitAboardCandidates` 단위.
- `guidance-gate-drift.test.ts` 통과(계수 불변)·`i18n-messages`·`xcstrings-arg-order`·`transit-text-args`.

## 7. 실승차 판정 (BACKLOG §2 표 · FIELD-TEST §5)

- A37 ②: 하차역을 지나쳐 되돌아온 뒤 [탑승 변경] → 하차역 선택 → "하차 지점에 도착했습니다" + 마지막 leg면 [남은 도보 안내 시작] 하나가 서는가. 착지 `controlFocus target=advance landed=`. 상태줄이 "하차 지점 도착."인가.
- A34: [이미 탑승했습니다] → 역 선택 → 그 역 목록에 타고 있는 열차가 있는가(로그 `aboard step=pickVehicle` 뒤 `boardAboard vehicle=`), **고른 역이 이미 지난 역일 때도 열차가 남아 있었는가**(M2), 잠금 뒤 카운트다운이 실제 열차를 따르는가, **조기 도착 선언(오선택)이 있었는가**(B2 — 있으면 `certain: false` 갈래로). 0건 폴백에서 상태줄이 위치·잔여·갱신 시각을 말하지 않는가. 서울버스 [이미 탑승했습니다]는 역 선택 없이 비관측 잠금(비대칭 확인).
- E34: 마지막 leg 도착 뒤 버튼이 하나이고 한 번 누르면 도보 세션이 시작되는가(`walkHandoffNow pending=true` 뒤 600ms 내 도보 시작 로그). 도착 통지(`arrivedWalkNext`)·착지 라벨·도보 시작 통지의 총량이 과한가.

## 8. 파일

Kit `TransitGuide.swift`(+`TransitGuideTests.swift`) / iOS `TransitGuideModel.swift`·`TransitTrackingSheet.swift`·`GuideOverviewSheet.swift`(silenceText) / 웹 `src/lib/transit-guide.ts`·`src/hooks/useTransitGuide.ts`·`src/components/TransitGuidePanel.tsx`·`src/components/DistanceBeacon.tsx`(prop 1) / fixture `transit-guide-scenarios.json`·`transit-guide-tone-scenarios.json` + `transit-guide.test.ts`·`transit-guide-tone.test.ts`·`TransitGuidePanel.test.tsx`·`guidance-gate-drift.test.ts`(주석) / `messages/*.json` / 생성물 `Localizable.xcstrings`·`arg-order.json`.

## 9. 설계 리뷰 판정 (2026-09-11, opus 서브에이전트, HEAD `cafe5e43`)

**판정: 진단(§1·§3 현행 서술)은 전부 참, 설계가 딛는 계약 셋이 틀렸다 → 전부 반영 후 착수.** 보고 정본 `~/gildongmu-wt/reports/transit-1-review-design.md`.

| 항목 | 처리 |
|---|---|
| B1 즉폴이 주기 0을 무시 | 채택 — `restartPollLoop` 조기 반환을 `immediate` 무관으로(§4.1). 웹은 `pollOnce` 직접 호출 자리에 같은 게이트. |
| B2 선언 식별 잠금의 확정 도착 권한 | **후보 필터(그 역에 있는 열차만)로 N3급 증거를 만든 뒤 권한 유지**(§4.2). 위원장 판정 사안이나 재작업 비용이 작아(플래그 한 줄) 강한 디폴트로 진행하고 §7 실승차 행 + 보고로 회수한다. 대안 ⓐ(`certain:false`)는 `backOnTrack` 재설계가 따라와 기각, ⓑ 채택. |
| M1 A33 문장 소비자 3곳 | 채택 — 선택기에 `unobserved` 필수 인자(§4.2). |
| M2 질문 문장 | 채택 ⓐ — 전용 키 `aboardStationPrompt`(§4.2). ⓑ(두 역 폴)·ⓒ(다음 역 자동 재조회)는 예산·복잡도로 보류, §7에 판정 행. |
| M3 `doneWalk` 소실 | 채택 — E34 경로에서 내지 않기로 확정(`advanceIntoWalkHandoff`), `nextLeg(doneWalk)` 조각도 그 leg에서 제거, 도보 분은 `arrivedWalkNext`에(§4.3). |
| M4 선언 도착 즉시 창구 | 채택 — 지연 창구로, 플래그 제거(§4.1). |
| M5 웹 `autoStart` | 채택 — open 초기값·라벨 판정·커밋 뒤 시작·착지 유지(§4.3). |
| M6 fixture 범위·급행 분기 | 채택 — 파일별 전수 열거(§6), 급행 우선 분기 은퇴(§4.2), 변이 주입 1회. |
| M7 인계 화면 도달 0 | 채택 — 섹션·컨트롤·착지 삭제(§4.3). `GildongmuApp`·`GuideBand` 잔여는 소유 밖이라 보고. |
| m1~m6 | 전부 채택(스냅숏·버퍼 소거, `approxNote` 판별자, 프롬프트 리셋 축, 신선도 줄 제거, 선택 차량 문장, untrackable 라벨 키 2개 명시). |
| 관찰 `changeBoarding` 가드 | 채택 — 확정 도착에서 no-op(§4.1). G4 주석 정정. |

## 10. 구현 리뷰 판정 (2026-09-11, HEAD `961170fd` → 반영 `0a8bc54d`)

세 리뷰(별도 컨텍스트, diff `main...HEAD`만)의 보고는 `~/gildongmu-wt/reports/transit-1-review-{spec,code,a11y}.md`(커밋 밖).

| 리뷰 | 판정 | 반영 |
|---|---|---|
| spec-compliance(opus) | 적합(BLOCKER·MAJOR 0, MINOR 6) | MINOR 3 채택: CLAUDE.md 규칙 문구 = INTEGRATIONS 절 제목 / 웹 도착 문장 축·버튼 라벨 축 통일(훅 옵션 `walkHandoffAvailable` → `handoffNow`) / 선언 도착 → autoStart 잇는 jsdom 클릭. 나머지는 관찰. |
| code-quality(opus) | 조건부 통과(MAJOR 3, MINOR 7) | M1 웹 역 선택 in-flight 폴 경합: `pollOnce`가 조회 기준 역을 세대 축으로 잡고 in-flight면 `finally`에서 즉폴(변이 실측 빨간불 확인). M2 새로고침 수가 pickVehicle 필터를 지난다. M3 필터 전멸 사유 `noCandidatesAboard`(웹·iOS, 6로케일). MINOR: 단계 가드 3·주석 정정 4·`ABOARD_CODES` 선언 순서. 기각(소유 밖·의도): `GuideBand.hasWalkHandoff` 잔여(소유 밖, 보고에 후속 정리 후보로), iOS `boardAboard`의 `selectedDescription`은 가드 뒤에 쓴다(오독), `DistanceBeacon` effect 순서(라벨은 `tracking`에 묶여 순서와 무관 — a11y 감사 통과). |
| a11y(sonnet) | 통과(결함 0, 관찰 3) | LOW 1 채택: 웹 취소 착지에 `isConnected` 명시. 실기기 권고: 이미 탑승 → 역 선택 → 목록, 마지막 leg → 도보 인계 두 흐름 VoiceOver 1회(§7 실승차 표에 포함). |

# 대중교통 "탑승" 의미 재정의 — `boarding` 국면 신설 + 상태 문구 전수 + A19 (N3)

> 출처: 위원장 실사용 피드백 2026-08-21 #4, 판정 2026-08-22(`docs/superpowers/plans/2026-08-22-feedback-260821-parallel-plan.md` §1 N3 행). 로그 `~/gildongmu-private/field-logs/transit-guide-diag-2026-08-21.log`(사설). 이 문서가 N3의 설계 정본이고 B2 spec(`2026-08-05-transit-guide-design.md` 계열)의 §4.2 상태 머신을 개정한다.
>
> 설계 리뷰 판정: **실시**(새 국면 = 판정 계층 신설, 웹·Kit 두 구현에 복제되는 유형). 결과는 §9.

## 1. 문제

로그상 "탑승" 버튼이 곧 `waiting→riding` 전이다(09:29:42 `boarded` 직후 추적이 하차역 기준으로 돌아간다). 사용자는 정류소에 서서 **올 차량을 고른 것**인데 앱은 **이미 탔다**고 말한다("{line} 탑승 중, {stop}에서 하차합니다"). 문구가 아니라 버튼의 뜻이 틀렸다.

부산물 A19: 탑승 변경 → 역 선택 프롬프트 포커스 착지 `reboardPromptFocus landed=false` 2/2(09:31:12·10:11:23).

## 2. 확정 판정(위원장)

1. "탑승" 버튼 = **차량 고르기**. 탑승 여부는 **앱이 판정**한다: 선택한 차량이 **내 승차 정류소·역에 도착하면** `riding`.
2. 그 전의 상태 문구는 "탑승 기다리는 중".
3. `transitGuide` 네임스페이스 상태 문구 전수 재점검(B2 ② 흡수).
4. A19를 함께 닫는다 — `CLAUDE.md` "iOS 목록 포커스 이동 정본 시퀀스" 적용.

## 3. 상태 머신 개정 (Kit `TransitGuide.swift` ↔ 웹 `transit-guide.ts` 미러, fixture 동조)

### 3.1 국면

```
waiting ──board(lock, 식별자 있음)──▶ boarding ──승차 정류소 도착 관측 / confirmBoarded──▶ riding ──▶ arrived ──advance──▶ done
   │                                     │                                               ▲
   └──board(근사 잠금: tagoBus·"이미 탑승했습니다")──────────────────────────────────────┘
boarding·riding·arrived ──changeBoarding──▶ waiting (previousLock + previousPhase 보존)
waiting(previousLock 있음) ──restoreBoarding──▶ previousPhase(boarding 또는 riding)
```

- **`boarding`(신설)**: 차량을 골랐고 그 차량이 승차 정류소에 오기를 기다린다. **폴링 대상은 waiting과 같은 승차 정류소**(서울버스 `seoulWait(arsId)`, 지하철 `subwayTrack(boardOverrideName ?? boardName)`) — 상태 머신은 대상을 모르고(종전 계약 유지) 앱 `fetchPoll(phase:)`가 `waiting`과 `boarding`을 같은 갈래로 묶는다. `tagoCacheKey`도 같은 갈래(`board`).
- **근사 잠금은 `boarding`을 거치지 않는다.** tagoBus는 식별자가 없어 "고를 차량"이 없고, "이미 탑승했습니다"는 선언이다. 둘 다 종전대로 `waiting→riding`.
- `boarding`에서 `advance` 불가(`canAdvance`는 종전 그대로 — `boarding`은 어느 조건에도 안 걸린다). `untrackable`은 `waiting`에 머물므로 무관.

### 3.2 입력

| 입력 | 유효 국면 | 전이 | 이벤트 |
|---|---|---|---|
| `board(lock)` | waiting(비-untrackable) | 근사 → riding / 식별자 있음 → **boarding** | `boarded(legIndex, cause: declared)` / **`vehicleSelected(legIndex)`** |
| **`confirmBoarded`**(신설) | boarding | riding(잠금 유지) | `boarded(legIndex, cause: declared)` |
| **`restoreBoarding`**(신설, "탑승 변경 취소") | waiting ∧ `previousLock != nil` | `previousPhase`(boarding이면 boarding, riding·arrived였으면 riding) | boarding → `vehicleSelected` / riding → `boarded(cause: declared)` |
| `changeBoarding` | **boarding**·riding·arrived | waiting(`previousLock`·`previousPhase` 보존) | `boardingReset` |
| `advance` | 종전 | 종전 | 종전 |
| `poll` | 종전 + boarding | §3.3 | §3.3 |

`board`·`confirmBoarded`·`restoreBoarding`·`changeBoarding`·riding 진입은 전부 `phaseGen += 1`(폴링 대상이 바뀌거나 스냅숏을 버려야 하는 지점). riding 진입 시 초기화: `ridingSince = now`, `signal = notYetVisible`, `remaining/lastMessage/currentLocation/dataStamp/dataAgeSeconds = nil`, `trackingAnnounced = false`, `ladderAnnounced = nil`, `missCount = 0`, `arrivedCertain = false`, **`failCount = 0`·`failSince = nil`**(폴링 대상이 바뀌므로 이전 대상의 실패 이력을 새 대상에 이월하지 않는다 — 리뷰 M6) — 종전 `handleBoard`의 초기화 블록을 riding 진입 공용으로 뽑는다. boarding 진입은 같은 블록에서 `ridingSince`만 `nil`(폴링 대상은 waiting과 같아 fail 이력은 유지해도 무방하나 블록 공용이라 함께 초기화한다).

⚠ **종전 `cancelChangeBoarding`(= `board(previousLock)`)은 폐기한다.** 식별자 잠금의 `board`가 boarding으로 가게 되므로 riding에서 변경→취소한 사용자가 승차 정류소 폴링으로 되돌아간다(리뷰 M5). 복귀는 `restoreBoarding`이 `previousPhase`로 돌린다.

### 3.3 `boarding` 국면의 폴 처리

폴 항목은 **승차 정류소 기준 도착 정보**다(`remainingStops` = 승차 정류소까지 남은 정거장, `message` = "3분48초후[3번째 전]"·"[2]번째 전역 (군자)"·"곧 도착"). 잠금 매칭은 종전 `findLockedItem`(복합 키).

**매칭됨**:
0. 동일 스냅숏 무정보 폴(§12.1, stamp·문장 동일) — riding과 **달리 `missCount += 1`**(리뷰 M3: boarding엔 neverSeen 시간축이 없어 동결 레코드가 국면을 영구 고착시킨다. 동결은 "추적 불가"라는 정보이고 그 귀결이 §미매칭의 `signalLost` 안내라 허위 경보 비용이 낮다). 그 외 필드 갱신 없음·이벤트 없음. 버스는 stamp가 없어 이 규칙에 걸리지 않는다.
1. **도착 관측** = 서울버스 `remainingStops == 0`("곧 도착"·구조 필드 0) / 지하철 `arrivalCode ∈ {"0","1"}`(진입·도착) **∧ 동결 아님**(`dataAgeSeconds == nil || ≤ 120` — 서버 `STALE_FROZEN_SECONDS`와 같은 값. 리뷰 C3·M1: 종착 코드 동결 레코드가 선택 직후 폴에 "새 도착"으로 둔갑하는 경로 차단). 지하철 `"2"`(출발)는 **제외** — 이미 떠난 열차에 "탑승하세요"를 말하지 않는다(그 뒤 목록에서 사라지면 아래 `vehiclePassed`). → **riding**, `boarded(legIndex, cause: observed)`.
2. 첫 매칭(`trackingAnnounced == false`) → `signal = tracking`, `ladderAnnounced = remaining`, **`approaching(remaining, message)`**. `signalLost` 뒤의 첫 매칭도 이것이 이긴다(`signalRecovered` 없음 — 문장 자체가 "찾았다"를 담는다. 리뷰 M4).
3. 이후 사다리 {3,2,1} 하강(종전 래치 규칙 동일) → `approaching(remaining, message)`. `signalLost` 뒤 재매칭은 riding과 같이 `signalRecovered`(상위 이벤트 없을 때).
4. 잔여 없음 + 문장 변화 → `messageChanged(message)`(종전 이벤트 재사용, 앱이 국면으로 프레임을 가른다).

**매칭 안 됨** — 선택 시점에 목록에 있던 차량이라 미등장은 곧 정보다. `missCount += 1`을 **첫 매칭 전에도** 센다(riding의 `trackingAnnounced` 가드와 다른 점).
1. 직전 `remaining ≤ 1` ∧ `missCount ≥ MISS_ARRIVE_COUNT(2)` ∧ `signal != signalLost` → `signal = signalLost`, **`vehiclePassed`**(1회). **자동 riding 전이는 없다**(리뷰 C2 수용: 미등장은 API 누락·빈 응답으로도 생기고, 원 피드백이 바로 "안 탔는데 탑승 중이라 한다"였다 — 거짓 riding이 거짓 boarding보다 나쁘다). 문구가 선택지를 준다("선택한 차량이 지나간 것으로 보입니다. 타셨으면 탑승했습니다, 아니면 다른 차량 선택").
2. 그 외 `missCount ≥ MISS_LOST_COUNT(3)` ∧ `signal != signalLost` → `signal = signalLost`, `signalLost`(boarding 문구).

따라서 **boarding → riding은 도착 관측 또는 사용자 선언(`confirmBoarded`·`restoreBoarding`) 두 길뿐**이다. `boarded.cause`는 `observed | declared`.

`upstreamFailed`·회복·`capSlowed`는 국면 무관 종전 경로.

### 3.4 이벤트·프로파일

```
vehicleSelected(legIndex)                        (interrupt: false, tone: nil)   — 활성화 응답은 앱이 .high로 낭독
approaching(remaining, message)                  remaining ≤ 1 → (true, imminent) / 그 외 (false, ladder)
boarded(legIndex, cause: observed|declared)      observed → (true, start) / declared → (false, start)
vehiclePassed                                    (false, weak)
```

`state`에 `previousPhase: TransitPhase?`를 더한다(`changeBoarding`이 채우고 `restoreBoarding`·`board`·`advance`가 비운다).

`boarded`의 fixture 표기는 `kind: "boarded"` + `cause` 필드(부분 대조). 종전 24 시나리오의 식별자 잠금 `board` 스텝은 기대가 `riding`에서 **`boarding`** 으로 바뀌므로 **`confirmBoarded` 스텝을 바로 뒤에 삽입**하고, 그 뒤 같은 국면의 `poll` 스텝 `phaseGen`을 +1 보정해 종전 riding 궤적을 보존한다(결정론 변환 — 스크립트로 하고 개수·기대 동치를 assert. 리뷰 M9). 종전 "탑승 변경 취소" 시나리오의 `board(previousLock)`은 **`restoreBoarding`으로 치환**하며 confirm을 삽입하지 않는다(복귀 board와 선택 board를 구분, 리뷰 M10). 신규 시나리오 8: ①선택→접근 3·2·1→도착 관측→riding ②remaining 1 뒤 2회 미등장→`vehiclePassed`·국면 유지→`confirmBoarded`→riding ③3회 미등장→signalLost→재등장 `approaching`(recovered 아님) ④boarding에서 changeBoarding→waiting(previousLock·previousPhase=boarding)→restoreBoarding→boarding ⑤riding에서 changeBoarding→restoreBoarding→riding ⑥지하철 `"2"`만 관측·동결 레코드(age 300)는 riding 불가 ⑦boarding 중 advance·늦은 phaseGen 폴 무시 ⑧동결 동일 스냅숏 3폴→signalLost.

### 3.5 폴 주기

`boarding` = 20초(waiting과 동일 — 같은 엔드포인트·같은 비용). `transitPollIntervalMs`에 한 줄.

## 4. 앱(iOS) 변경

### 4.1 `TransitGuideModel`
- `board(item:)`: 종전 그대로 dispatch. 선택 항목의 설명을 `selectedDescription`(후보 행 라벨과 같은 조립)으로 보관 — `vehicleSelected` 통지에 쓴다. riding 진입·changeBoarding·advance에서 nil.
- `confirmBoarded()`: `dispatch(.confirmBoarded)` + 즉폴. `cancelChangeBoarding()`은 `dispatch(.restoreBoarding)`.
- `fetchPoll(phase:)`·`tagoCacheKey`·`resolveTagoIfNeeded`: `phase == .waiting || phase == .boarding` → 승차 정류소 갈래.
- `pollOnce`의 대기 스냅숏 갱신은 `waiting`만(boarding은 목록을 보여주지 않는다).
- `boardOverrideName` 소거 시점: 종전 `.board`에서 → **riding 진입·`.advance`**. boarding이 재선택 역을 계속 조회해야 한다.
- `statusLineText`: boarding 문맥 = `boardingContext`("{stop}에서 {line} 탑승 기다리는 중.") + 선택 차량 설명 + 신호 문구 + 잔여("{stop}까지 남은 정거장" 대신 **승차 정류소 기준**이라 `approachFrame` "{stop}에 {message}") + 신선도. `stationCountAbout`은 riding만(종전).
- `signalStatusText(signal, phase)`: boarding의 `notYetVisible` = "선택 차량 확인 중.", `tracking` = "차량 접근 중."(riding "추적 중."과 구분), 나머지 공통.
- `announcementText`: `vehicleSelected` = "{desc} 선택. {stop} 도착을 기다립니다." / `approaching` 첫 회 = "선택한 차량을 추적합니다. " + `approachFrame`, 이후 `approachFrame`(+ remaining ≤ 1이면 "곧 도착합니다" 대신 원문이 이미 말한다 — 병치 금지) / `boarded(observed)` = "{line} 도착. 탑승하세요." + 종전 `boarded`/`boardedCount` / `boarded(declared)` = 종전 문장 / `vehiclePassed` = "선택한 차량이 {stop}을 지난 것으로 보입니다. 타셨으면 탑승했습니다, 아니면 다른 차량 선택을 눌러 주세요."(뒷문장이 선택지를 주므로 꼬리 금지 규칙의 예외). `signalLost`는 boarding이면 "선택한 차량을 찾지 못하고 있습니다."(riding 문구 "차량 신호를 찾지 못하고 있습니다"와 분리 — 전자는 아직 안 탔다는 뜻이 살아야 한다). `messageChanged`는 국면별 프레임.
- `reboardPickerActive` 소거 조건 `!= .riding` 유지.

### 4.2 `TransitTrackingSheet` (문구·포커스만 — 최소화 버튼은 N1)
- boarding 컨트롤: [탑승했습니다](`confirmBoarded`) · [다른 차량 선택](`changeBoarding`). 후보 목록·새로고침·이미 탑승·취소는 waiting 전용 유지.
- 후보 버튼 라벨 `boardTrain/boardBus` → `selectTrain/selectBus`("{desc}, 이 열차 선택"). tago `boardApprox` → "탑승했습니다".
- **포커스 단일 바인딩(A19 정본)**: 시트 컨트롤용 `Bool` 바인딩 6개(`stop·advance·changeBoarding·walkHandoff·waitingLabel·reboardPrompt`)를 **하나의 옵셔널 정체성 바인딩** `@AccessibilityFocusState var focusedControl: SheetControl?`로 합친다(`equals:`). 근거: 사라진 버튼의 `Bool`이 `true`로 남은 채 새 대상에 `true`를 대입하면 경합한다 — `SearchView.applyRowFocus`의 "경합하는 포커스 바인딩을 먼저 놓아야 대입이 먹는다"가 이 repo의 확정 교훈이고, 옵셔널 단일 바인딩은 그 해제를 구조로 만든다. 후보 목록·목적지 후보의 `String?` 바인딩은 유지.
- 착지 시퀀스는 정본 전문을 **헬퍼 하나**(`landControlFocus(_:proxy:)`)로: 직전 착지 Task 취소 → **`focusedCandidate = nil`·`focusedDestChangeRoute = nil`**(다른 바인딩 해제, 리뷰 M7) → `scrollTo` → 400ms → **대상 컨트롤이 현재 국면에 아직 존재하는지 재검증**(없으면 중단, 리뷰 M8) → 대입 → 600ms 검증 → `scrollTo` 재실행 → 300ms → 재대입(종전 `landReboardPromptFocus`는 재시도에서 가시화를 다시 하지 않았다) → 로그 `landed=`(+ 실착지 바인딩 값). 국면 전이 `onChange`는 먼저 진행 중 착지 Task를 취소한다.
- 전이 착지: waiting→boarding = `confirmBoarded` 버튼(누른 후보 행이 사라진다), boarding→riding·waiting→riding = 종전(`changeBoarding`/근사는 `advance`), arrived = `advance`(종전).

## 5. 웹 변경 (`src/hooks/useTransitGuide.ts`·`TransitGuidePanel.tsx`)
4와 동형: `fetchPoll` 갈래, `boardOverride` 소거 시점, 상태 문구 조립, `confirmBoarded`, boarding 섹션(상태 문장 + 버튼 2), 전이 포커스(waiting→boarding = 탑승했습니다 버튼). 웹 실승차는 미검증이라(B2) 포커스 계약은 iOS와 같은 지점에만 둔다.

## 6. 문구 (`messages/*.json` `transitGuide`, 6개 로케일)

신설: `boardingContext`·`approachFrame`·`approachingStarted`·`vehicleSelected`·`arrivedAtBoardStop`·`vehiclePassed`·`boardingSignalLost`·`stateBoardingNotYetVisible`·`stateApproaching`·`confirmBoarded`·`reselectVehicle`·`selectTrain`·`selectBus`.
개정: `boardApprox` "탑승"→"탑승했습니다", `changeBoardingDone` "탑승을 다시 선택합니다."→"차량을 다시 선택합니다.".
삭제: `boardTrain`·`boardBus`.
전수 점검 결과 나머지(`boarded`·`context`·`neverSeen`·`stateNotYetVisible`·`stateRidingNotYetVisible` 등)는 riding·waiting 어휘로 정확하다 — 유지. `Localizable.xcstrings`는 `messages-to-xcstrings.mjs` 재생성.

## 7. 테스트·게이트
- 공유 fixture 변환 + 신규 6 시나리오, 웹 `transit-guide.test.ts`·Kit `TransitGuideTests` 양쪽 green.
- i18n 키 일관성(`i18n-messages.test.ts`), `check-xcstrings-keys.mjs`.
- 실호출 게이트: 도착 관측 술어의 입력 모양은 이미 실측된 필드(`remainingStops` 0·`arrivalCode`)라 신규 계약 없음 — 실승차(위원장)가 최종 판정이고 `docs/FIELD-TEST.md`에 행을 더한다: "선택 뒤 '탑승 기다리는 중'이 들리는가 / 차량 도착 때 '도착. 탑승하세요'가 나오는가 / 탑승 변경 프롬프트 착지 `landed=true`".

## 8. 범위 밖
시트 최소화 버튼(N1), 띠바(N1), tagoBus 차량 식별(서버 미제공), 웹 실승차 검증.

## 9. 설계 리뷰 결과 (codex exec 적대적 리뷰, 2026-08-22, spec+상태 머신 주입)

| # | 지적 | 판정 | 반영 |
|---|---|---|---|
| C1 | 차량 도착 ≠ 사용자 탑승 — 중간 국면 필요 | **기각** | 위원장 판정("도착하면 riding, 앱이 판정")과 정면 충돌. riding의 "탑승 변경"(→waiting)이 못 탄 경우의 탈출구이고 10분 neverSeen이 백스톱. 문구는 "도착. 탑승하세요."로 행동을 요구한다 |
| C2 | 미등장 2회를 탑승으로 추론 | **수용** | §3.3 `vehiclePassed`(국면 유지·선택지 안내). `boarded.cause`에서 `assumed` 삭제 |
| C3 | 선택 직전 낡은 스냅숏이 도착 관측으로 둔갑 | **수용** | 도착 관측에 동결 가드(`dataAgeSeconds ≤ 120`) |
| M1 | arvlCd "0"·"2" 의미 | **부분 수용** | "2"(출발) 제외. "0"(진입)은 유지 — 진입은 곧 정차라 "탑승하세요"의 선행 통지로 맞다 |
| M2 | 선택 시 remaining 소거로 assumed 불가 | 무효화 | assumed 자체를 뺐다. 미등장은 missCount만으로 signalLost |
| M3 | 동결 동일 스냅숏이 boarding 고착 | **수용** | boarding은 동일 스냅숏에 `missCount += 1` |
| M4 | signalLost 뒤 첫 매칭의 이벤트 우선순위 | **수용** | `approaching`이 이긴다고 명시 |
| M5 | previousLock 복귀가 boarding으로 | **수용** | `restoreBoarding` + `previousPhase` |
| M6 | failCount 이월 | **수용** | riding 진입 블록에서 초기화 |
| M7 | 후보 `String?` 바인딩 경합 | **수용** | 착지 헬퍼가 먼저 nil |
| M8 | 지연 착지가 국면 전이를 추월 | **수용** | Task 취소 + 대상 존재 재검증 |
| M9·M10 | fixture 변환의 phaseGen·복귀 board | **수용** | §3.4 변환 규칙 |
| m1 | upstream 회복과 차량 재발견 혼합 | 기각 | 종전 riding 계약이고 범위 밖(B2). 필요 시 별 항목 |
| m2 | vehicleSelected에 설명 부재 | 기각 | `board(item:)`이 dispatch 전에 동기로 보관 — 순서가 구조로 고정된다 |

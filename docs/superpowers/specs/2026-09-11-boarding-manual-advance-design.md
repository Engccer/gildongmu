# 대중교통 boarding 국면: [탑승했습니다] 제거와 대기 국면 버튼 이름 (N3 ①②)

**판정**: 위원장 2026-09-10(`docs/BACKLOG.md` §5 N3). ①고른 차량의 **승차 정류소 도착 관측**이 riding 승격을 자동으로 하므로 boarding 국면에 [탑승했습니다]를 세우지 않는다. 도착 정보가 없어 관측이 원리적으로 불가능한 경우(심야·미제공·조회 실패)에만 **다른 문구로** 수동 진행 수단을 낸다. ②대기 국면 [이미 탑승했습니다]는 **"이미 탔습니다"**(누르면 다음 화면이 역을 묻는다 — A34 흐름).

**설계 리뷰 생략**: 판정이 확정이고 변경이 국소(뷰 표시 조건 + 문자열)다. 상태 머신 입력·전이는 하나도 바뀌지 않는다 — `confirmBoarded` 입력과 그 전이는 그대로이고 **그 입력을 누가 언제 낼 수 있는가**만 좁힌다. 구현 리뷰(spec-compliance·code-quality·a11y)는 공통 계약대로 돈다.

## 1. 판정의 뿌리

위원장 인용(2026-09-10): *"내가 계속 헷갈렸던 것도 버튼 이름이 비슷한 게 두 개가 계속 나와서 그랬어."* 대기 국면 [이미 탑승했습니다]와 boarding 국면 [탑승했습니다]가 번갈아 서는 것이 혼란의 뿌리였고, A34로 대기 쪽 버튼은 하는 일 자체가 바뀌었다(선언 → 역을 묻기). 그래서 처방은 둘이다 — 하나를 없애고(①) 남은 하나의 이름을 동작에 맞춘다(②).

## 2. 범위

**한다**: iOS 시트의 boarding 컨트롤 표시 조건 + 그 조건의 순수 술어(Kit ↔ 웹 미러) + 앱 층 래치 + 웹 미러 + 문장 5키(신설 2·개정 3) 6로케일.

**하지 않는다**: 리듀서 입력·전이·이벤트(무변경) / 지방버스 대기 국면의 [탑승했습니다](`boardApprox` — 대기 국면이고 근사 잠금 진입이라 이 판정의 대상이 아니다. ①이 사라지면 같은 문자열을 쓰는 자리는 이것 하나만 남는다) / A35 착지 헬퍼 / 승차 중 "탑승 변경"(A16 L3) 경로의 의미.

## 3. 현행 계약 중 이 설계가 딛는 것

- `boarding`(N3 2026-08-22)은 "차량을 골랐고 그 차량의 승차 정류소 도착을 기다린다"는 국면이고, riding 승격은 **도착 관측**(`commitBoardingMatched`의 `arrivedAtBoardStop` — 지하철 `arvlCd` 0·1, 서울버스 잔여 0, 동결 레코드 제외) 또는 **사용자 선언**(`confirmBoarded`·`restoreBoarding`) 두 길뿐이다. 09-09 16:12:46 실측이 관측 경로로 정확한 잠금에 이르렀다.
- boarding 국면의 신호는 넷이다: `notYetVisible`(선택 직후) → `tracking`(관측 중, 사다리) / `signalLost`(연속 미등장 `transitMissLostCount`, 또는 잔여 ≤1에서 사라짐 = `vehiclePassed`) / `upstreamFailed`(조회 실패). `neverSeen`은 riding 전용 축이라 이 국면엔 없다.
- 국면 전이 착지 `phaseTransitionLanding`이 `waiting → boarding`에서 `.confirmBoarded`에 착지시켰다(누른 후보 행이 사라지는 전이 — 헌장 §5).
- `SheetControl`은 옵셔널 단일 `@AccessibilityFocusState` 바인딩이고 부착 자리는 `landingTarget` 하나(소스 가드 `transit-landing-guard.test.ts`).

## 4. 설계

### 4.1 ① 등장 조건 — "관측이 끝났다"

**순수 술어(Kit `transitBoardingObservationLost(_:)` ↔ 웹 `boardingObservationLost(signal)`)**: `signal == .signalLost || signal == .upstreamFailed`.

- `notYetVisible`·`tracking`에서는 **버튼이 없다**. 도착하면 관측이 승격을 한다.
- `signalLost`는 두 경로가 모인다 — 연속 미등장(3회 ≈ 60초)과 `vehiclePassed`(잔여 ≤1에서 사라짐). 어느 쪽이든 "그 차량의 도착을 우리는 못 본다"이고, 사용자는 그 차를 탔을 수 있다.
- `upstreamFailed`는 조회 실패(심야·미제공 포함 — 응답이 오지 않거나 목록이 비어 매칭이 안 되는 상태가 결국 이 둘 중 하나로 떨어진다).

**래치(앱 층)**: boarding 국면 안에서 한 번 참이면 그 국면이 끝날 때까지 유지한다(`TransitGuideModel.boardingManualAvailable` ↔ 웹 `guide.boardingManualAvailable`). 근거는 포커스다 — `upstreamFailed`는 회복하면 `notYetVisible`로 돌아가고 `signalLost`는 재발견하면 `tracking`이 되는데, 그때 버튼이 사라지면 **포커스를 쥔 컨트롤이 제거되는 전이**(헌장 §5)가 폴 한 번에 일어난다. 관측이 회복돼도 수동 수단이 남는 것은 해롭지 않다(사용자가 실제로 탔다면 여전히 맞는 버튼이다).

- 세움: `dispatch` 뒤 국면이 `boarding`이고 술어가 참이면 `true`.
- 지움: 국면이 `boarding`이 아니게 되면 `false`(`restoreBoarding`의 재진입도 `enterBoarding`을 지나 국면이 잠깐 바뀌지 않으므로, **국면 진입 자체**(`waiting → boarding`)에서도 지운다).
- 리듀서 상태로 두지 않는 근거: 화면 표시 수명뿐이고 공유 fixture 전량의 상태 모양을 바꾼다. `aboardStep`·`reboardPickerActive`와 같은 자리다.

### 4.2 ① 문구

| 키 | ko | 자리 |
|---|---|---|
| `boardWithoutArrival`(신설) | 도착 정보 없이 탑승 진행 | boarding 국면 수동 진행 버튼 |
| `boardingUpstreamFailed`(신설) | 실시간 신호가 끊겼습니다. 타셨으면 도착 정보 없이 탑승 진행을 눌러 주세요. | boarding 국면의 조회 실패 통지(종전엔 `upstreamFailed` 공용) |
| `boardingSignalLost`(개정) | 선택한 차량을 찾지 못하고 있습니다. 타셨으면 도착 정보 없이 탑승 진행을 눌러 주세요. | 연속 미등장 통지 |
| `vehiclePassed`(개정) | 선택한 차량이 {stop}을 지난 것으로 보입니다. 그 차량에 타셨으면 도착 정보 없이 탑승 진행을, 타지 않으셨으면 다른 차량 선택을 눌러 주세요. | 잔여 ≤1 소실 통지 |
| `boardAlready`(개정, ②) | 이미 탔습니다 | 대기 국면 |

이름이 상황을 담는다: 없는 것은 **도착 정보**이고 하는 일은 **탑승으로 진행**이다. 형제 `continueWithoutTrain`("열차 정보 없이 계속" — 어느 열차인지 모를 때)과 같은 틀({없는 정보} 없이 {행동})이고, 둘은 서로 다른 화면에서 서로 다른 결핍을 말한다. ②의 "이미 탔습니다"와 겹치는 낱말이 없다.

**통지 셋이 버튼 이름을 부르는 이유**: 이 버튼은 폴 결과로 **조용히 나타난다**. 그 순간 나는 통지가 유일한 발견 경로다(헌장 §3). 뒷문장은 뻔한 꼬리가 아니라 **새로 생긴 수단**을 알린다(CLAUDE.md 통지 꼬리 판정선). 버튼이 이미 서 있는 동안에는 신호가 이미 그 값이라 통지가 다시 나지 않는다(1회성).

**비-ko**: ①은 6로케일 전부 새로 쓴다. ②는 **ko만 바꾼다** — 다른 로케일의 [이미 탑승했습니다]/[탑승했습니다] 쌍은 ①이 사라지면서 자동으로 해소되고("I boarded"가 없어져 "I already boarded"만 남는다), 한국어의 격식체 중복("탑승했습니다"가 두 버튼에 든 것)은 다른 언어에 대응물이 없다.

### 4.3 ① 착지

`waiting → boarding` 전이의 착지 대상을 `.confirmBoarded`에서 **`.status`(상태 문장 줄)** 로 옮긴다.

- 그 전이에서 사라지는 것은 누른 후보 행이고, 새로 서는 "다음 행동"은 **없다**(기다리는 국면이다). [다른 차량 선택]에 착지시키면 커서가 "다시 고르라"는 권유 위에 앉는다 — 위원장이 지적한 혼선의 재생산이다.
- 상태 문장은 그 화면에서 지금 무슨 일이 일어나는지를 말하는 유일한 줄이고(`{역}에서 {노선} 탑승 기다리는 중. 선택한 차량: {desc}. 선택 차량 확인 중.`), 국면·폴과 무관하게 항상 렌더된다.
- `SheetControl.confirmBoarded`는 **삭제**한다(`landingFallbackText`·`controlExists`·소스 가드 목록에서 함께). 수동 버튼은 폴이 세우는 것이라 착지 대상이 아니다 — 나타나는 순간 포커스를 옮기면 낭독 중인 문장을 끊는다(그 순간의 안내는 §4.2의 통지가 한다).
- `.status`는 `controlExists` = 세션·leg 존재, 폴백 문장 = `statusLineText`(뷰와 같은 식).

### 4.4 웹 미러

`useTransitGuide`가 `boardingManualAvailable`을 내고, `TransitGuidePanel`의 boarding 섹션이 그 값으로 버튼을 가른다. 전이 포커스는 상태 문장(`statusRef` — 이미 세션 시작 착지가 쓰는 자리)으로. 리듀서·훅의 `confirmBoarded` 액션 자체는 불변.

## 5. 불변식 점검

- **3-state**: "탔다(선언)"·"탄 것으로 관측됨"·"모른다"를 뭉개지 않는다. 버튼이 없는 동안은 앱이 "관측 중"이라고 말하고 있고, 버튼이 서면 "관측을 못 한다"고 말한 뒤다. 관측 실패를 탑승으로 추론하는 자리는 여전히 없다(Kit 머리 주석의 계약 불변).
- **탈출구**: 버튼이 없는 동안 사용자가 실제로 타 버렸다면 두 길이 남는다 — ⓐ 40~60초 뒤 미등장이 쌓여 이 버튼이 선다 ⓑ 지금 곧바로면 [다른 차량 선택] → 대기 국면 → **[이미 탔습니다]**(A34: 역을 묻고 그 역에 있는 열차를 고르면 식별 잠금으로 riding 직행). ⓑ가 오히려 더 정확한 잠금을 만든다(실제 탄 열차를 다시 지목하므로). 즉 N3 판정의 "그 사이 국면의 탈출구"는 ②가 대신한다.
- **착지 계약**: `focusedControl` 부착은 여전히 `landingTarget` 한 자리, 가시화는 전 대상, 트리거는 상태 변화.
- **게이트 계수**: 도보 세션 시작 진입점은 손대지 않는다 — `guidance-gate-drift.test.ts` 계수 불변(8, GuideSession 안 3).

## 6. 테스트

- Kit `TransitGuideTests`: `transitBoardingObservationLost` 6신호 진리표.
- 웹 `transit-guide.test.ts`: 같은 진리표(미러).
- 웹 `TransitGuidePanel.test.tsx`:
  - (a) 차량 선택 직후 boarding: [도착 정보 없이 탑승 진행] **없음**, [다른 차량 선택] 있음, 커서는 상태 문장.
  - (b) 승차역 도착 레코드(`arrivalCode: "0"`)를 보면 버튼 없이 riding으로 승격.
  - (c) 조회 실패가 쌓이면 버튼 등장 + 통지가 그 이름을 부른다. 회복해도 버튼 유지(래치).
  - (d) 기존 여정 테스트의 `boardTrain()` 헬퍼는 **관측 경로**로 다시 쓴다(선택 직후 첫 boarding 폴에 도착 레코드를 흘려 넣는다) — 12개 테스트가 그 헬퍼를 지난다.
- 소스 가드 `transit-landing-guard.test.ts`: `SheetControl`에 `confirmBoarded`가 없고 `status`가 있다, boarding 버튼이 래치를 지난다.
- 변이 주입 1회: 술어를 `true` 고정으로 바꾸면 (a)가 빨간불인지 실측.

## 7. 실승차 판정 (BACKLOG §2 · FIELD-TEST §5)

- 차량을 고른 직후 화면에 [탑승했습니다]가 **없는가**, 커서가 상태 문장에 앉는가(`controlFocus target=status landed=`).
- 승차역 도착이 관측되어 자동으로 riding이 되는가(로그 `step phase=boarding→riding` + `boarded(observed)`), 그때까지 화면에 수동 버튼이 없었는가.
- 관측이 끊긴 실사례에서 통지가 버튼 이름을 부르고 그 버튼이 실제로 서 있는가.
- 대기 국면 버튼이 "이미 탔습니다"로 읽히는가, 누르면 역을 묻는가.

## 8. 파일

Kit `TransitGuide.swift`(+`TransitGuideTests.swift`) / iOS `TransitGuideModel.swift`·`TransitTrackingSheet.swift` / 웹 `src/lib/transit-guide.ts`·`src/hooks/useTransitGuide.ts`·`src/components/TransitGuidePanel.tsx` / `messages/*.json` `transitGuide.*` / 테스트 `transit-guide.test.ts`·`TransitGuidePanel.test.tsx`·`transit-landing-guard.test.ts` / 생성물 `Localizable.xcstrings`·`arg-order.json`.

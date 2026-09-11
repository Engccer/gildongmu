# 대중교통 안내 상태 문장 문장형화 + 시작 통지 목적지 + 통지·착지 중복 제거 (E39·E40·E41)

> 2026-09-12, 세션 `status-prose`(웨이브 2). 선행 통합: E38 `d6abbfe9`(착지 대상 `status` 통일) → A41 `65c3eb9b`(서울버스 정차 신호).
> 설계 적대적 리뷰 **생략** — 판정 계층·상태 머신·외부 계약을 신설하지 않는다(문장 계층과 i18n만). 판정은 §6에 한 줄씩 남긴다.
> ⚠ **낭독 문장의 정본은 문자열 자원**(`messages/*.json` ↔ xcstrings)이다. 이 문서에 문장을 복제하지 않고 키 이름만 적는다. 위원장 확정 문안의 렌더본은 `~/gildongmu-wt/reports/status-prose-copy.md`.

## 0. 접수와 확정 판정

| 항목 | 접수 | 확정 |
|---|---|---|
| E39 | 상태 문장이 명사구 나열이고 `[1번째 전]` 대괄호가 난반하며 노선이 `421`로 끝난다 | 위원장 TextEdit 왕복 3판(2026-09-12). **문체는 그대로 두고** 겹치는 조각과 항상 참인 조각을 빼고 대괄호만 푼다 |
| E40 | 안내 시작 통지가 목적지를 말하지 않는다 | 세 수단 모두 시작 통지 첫머리에 목적지 라벨(위원장 판정, 재질문 없음) |
| E41 | 전이 통지와 착지 낭독이 같은 정보를 두 번 말한다 | **통지를 줄인다**(`AskUserQuestion` 2026-09-12). 통지는 "방금 무슨 일이 일어났고 다음에 무엇을 하는가"만, 상황 서술은 착지가 앉는 상태 문장에 맡긴다 |

**위원장 왕복에서 새로 나온 판정 3건**
1. 대기 국면 신호 문구(`stateNotYetVisible`)는 **뺀다**. 그 국면 내내 고정이라 정보가 0이다(§1.1).
2. `출발대기`·`회차대기`는 뜻이 드러나는 우리 문장으로 옮긴다. 음슴체(`아직 차고지에서 출발하지 않음`), 회차는 `종점에서 회차 대기 중`.
3. `운행종료`는 **문장을 만들지 않는다.** 특정 차량을 따라가는 국면에서 도달 불가다(§1.2).

## 1. 실측과 구조 판정

### 1.1 대기 국면 신호 문구는 상수다
`initTransitGuide`가 `signal`을 `notYetVisible`로 놓고, `transitGuideStep`의 waiting 분기는 `lastUpdatedAt`만 기록하고 반환한다(`transit-guide.ts`). `commitMatched`/`commitBoardingMatched`는 잠금이 있어야 돌므로 waiting에서는 `tracking`이 될 수 없다. 즉 후보가 몇 대든 `차량 접근 대기.`가 고정으로 나온다. 0건 사유는 목록 자리(`noCandidates*`)가 이미 3-state로 말한다. → waiting + `notYetVisible`이면 신호 조각을 생략하고, 그 밖(`upstreamFailed` 등)은 그대로 낸다.

### 1.2 `운행종료`는 잠금 국면에 도달하지 않는다
`lockMatches`는 `item.vehicleId`가 있고 잠금과 같을 때만 참이다. `운행종료`는 차량 상태가 아니라 정류소·노선 상태라 `vehId`가 `0`/빈값이고, `slotToTrack`이 그것을 `vehicleId: null`로 접는다(같은 이유로 `seoul-bus.ts`가 구조 잔여를 vehId 보유 슬롯으로만 신뢰한다 — 심야 실호출 2026-08-04). → 선택 불가이자 매칭 불가. 문장을 만들지 않고 미지 모양 폴백에 맡긴다.

### 1.3 실측 모양 분포 (A41 실호출 코퍼스 재분석, 21개 노선 2,430행, 2026-09-11 20:24~20:33 KST)
`N분후` 2,037 · `곧 도착` 255 · **`회차대기` 120** · `N분N초후` 18 · `출발대기` 0 · `운행종료` 0 · `N초후` 0.
`회차대기`는 **vehId를 가진다**(잠글 수 있는 차량이고 표본은 잔여 89정거장·약 165분). 기존 파서 `parseBusArrmsg`가 이 모양을 모르고 `unknown`으로 떨어뜨려 ko는 원문, en은 부재였다. → `turning` 종류를 더한다.
`출발대기`는 이 표본(저녁 10분)에 없다. 시간대 한계이지 부재의 증거가 아니라 문장은 만들되 실측 미확인으로 표기한다.

### 1.4 승차 국면 서버 재작성은 제거한다
`slotToItem(phase: "ride")`의 `rewriteBusArrivalMessage`(꼬리 제거 + `…후` → `… 남음`)는 **이 상태 문장 하나만을 위해 존재**했다. 클라이언트가 원문을 파싱해 문장을 조립하면 그 재작성이 파싱을 막는 장애물이 되고(`…후$` 불일치 → 미지 폴백), 같은 원문을 두 계층이 각자 해석하는 상태가 된다. → 재작성을 제거하고 원문을 그대로 싣는다. 영문 투영(`busArrivalMessageEnFrom`)은 이미 원문에서 만들므로 무변화.

## 2. 문장 조립 계약 (E39)

### 2.1 수단별 키 (A33 "수단별 키" 패턴 그대로)
노선명이 낭독되는 문맥·임박 문장은 `leg.mode === "bus"`로 갈려 `*Bus` 키를 쓴다: `waitContext`·`waitContextWalk`·`boardingContext`·`context`·`arrivedAtBoardStop`·`arrivingAtBoardStop`.
⚠ 노선 라벨 자체(`TransitDisplayLeg.line`)는 **건드리지 않는다**. 투영도 텍스트 계층도 i18n 카탈로그를 모르므로 `421번 버스`를 라벨로 합성할 자리가 없고, 합성하면 조인 키(`transitStopPlace`·띠바)까지 오염된다.

### 2.2 잔여와 도착을 한 줄 두 조각으로
`TransitTextLine.parts`는 렌더 시 **쉼표로** 이어진다(웹 `joinText` ↔ Kit `TransitGuideTextRenderer.render`). 잔여 조각과 도착 문장을 한 줄에 담아 `남은 정거장 3개, 다음 역 서대문.` 한 문장을 만든다. 결합용 잔여 키(`remainingCountJoin`·`busStopsAway`)는 **마침표가 없고**, 단독으로 설 때는 종전 `remainingCount`(마침표 있음)를 쓴다.
이 규칙은 지하철에도 그대로 걸린다 — 지하철 승차 중 문장의 A27 키(`subwayNextStop` 등)가 둘째 조각이 된다.

### 2.3 서울버스 도착 문장
`parseBusArrmsg`(순수, `bus-arrival-en.ts` ↔ Kit 미러) 결과로 키를 고른다.

| 종류 | 키 | 비고 |
|---|---|---|
| `eta` 분+초 | `busEtaMinSec` | 초가 있으면 정확값 |
| `eta` 분만 | `busEtaMin` | 초가 없으면 "약" |
| `eta` 초만 | `busEtaSec` | 실측 0건, en 계약과 대칭 유지 |
| `soon` | `busSoon` | A41 `arrivingAtBoardStop` 통지와 같은 어휘 |
| `waiting` | `busNotDeparted` | 실측 미확인(§1.3) |
| `turning` | `busTurning` | 신규 종류 |
| `ended`·`unknown` | 없음 | 원문 병치(폴백) |

⚠ **`phase` 인자에 기본값을 두지 않는다.** 같은 원문이 대기(버스가 여기 오기까지)와 승차(내릴 곳까지)에서 뜻이 다르다(`slotToItem`·`busArrivalMessageEn` 선례).

### 2.4 신호 조각의 자리
- `tracking`: 도착 조각이 그 사실을 이미 말하므로 신호 조각을 **내지 않는다**. 도착 조각이 비면 `noArrivalInfo`(3-state의 unknown — "차량이 없다"가 아니라 "언제 오는지 못 받았다").
- `notYetVisible`: waiting은 생략(§1.1), boarding은 `stateBoardingNotYetVisible`(고른 차가 목록에 없다 = 정보), riding은 종전 수단별 문장.
- `arrived`: `stateArrived`만 낸다. 잔여·도착 문장·신선도는 **전부 생략** — 도착한 뒤의 접근 정보는 낡은 값이다.
- `signalLost`·`neverSeen`·`upstreamFailed`·`untrackable`: 종전 그대로.
⚠ `signalStatusText`(iOS) / `signalText`(웹) 자체는 바꾸지 않는다 — 조망 시트(`GuideOverviewSheet`)가 같은 함수를 도착 조각 없이 쓴다. 생략 판정은 **조립기**에 둔다.

### 2.5 신선도
`lastUpdated`를 `{time} 기준.`으로 바꾼다(내 주변·도착 화면 전반의 `asOf` 표기와 통일). 인자 수·순서 불변.

## 3. 시작 통지 목적지 (E40)

`transitGuide.started`·`guide.detailStart`·`guide.carStart`·`guide.detailUnavailable`에 목적지 라벨을 **첫 인자**로 더한다.
⚠ 기존 키의 플레이스홀더 순서 변경이라 `ios/i18n/arg-order.json`이 exit 1로 막는다 — 호출부 인자와 함께 고친 뒤 `--update-arg-order`.
`guide.detailNoLocation`은 대상 외다(위치를 못 잡은 상태라 목적지를 말해도 행동이 바뀌지 않는다).
대중교통 세션 중 경로 교체(`changeRoute`)는 `guide.destChanged`·`transitGuide.routeSwitched`가 이미 앞에 서므로 목적지를 두 번 말하지 않게 `started`를 목적지 없는 자리로 남긴다 → **`startedAt`(목적지 있음)과 `started`(없음) 두 키로 가른다.**

## 4. 통지 축소 (E41)

착지가 일어나는 전이의 통지에서 **상태 문장이 이미 말하는 조각을 뺀다.**

| 이벤트 | 남기는 것 | 빼는 것(상태 문장이 말함) |
|---|---|---|
| `arrived` | 다음 행동 지시(+확정 도착의 출구 방면, +다음 구간 문맥) | "하차 지점에 도착했습니다" 선두 문장 |
| `boarded` | cause `observed`는 `arrivedAtBoardStop*`만, 그 밖은 `boarded`("탑승했습니다") | 노선·하차역·정거장 수 → `boardedCount` 키 폐지 |
| `legAdvanced`(비-final) | `legAdvancedNext` + 미추적 고지 | 다음 구간 문맥(착지한 상태 문장이 그것으로 바뀐다) |

⚠ **`arrived`의 다음 구간 조각(`nextLeg`)은 남긴다.** 도착 국면 상태 문장은 *현재* 구간을 말하므로 다음 구간은 중복이 아니다. 위원장이 본 선택지 미리보기에는 그 조각이 없었으나, 판정의 규칙("상태 문장에 없는 것만")이 남기라고 말한다 — 보고에 명시한다.
⚠ **A41 인계 기각**: `boarded(cause: .departed)`에 관측 서술("{노선} 출발")을 넣는 안은 채택하지 않는다. E41 판정으로 통지는 "무슨 일이 일어났나"만 말하는데, 사용자에게 일어난 일은 탑승이지 버스의 출발이 아니다.

## 5. 범위 밖

- **E37**(내 주변 목록·장소 상세의 지하철 도착 줄). 이 문서는 안내 시트 상태 문장만 만진다.
- 지하철 승차 중 A27 문장 자체(`subwayNextStop` 등)의 문안. §2.2의 쉼표 결합만 적용한다.
- 띠바(`guide.band.*`)의 노선 표기. 상태 문장이 아니다.
- 대기 후보 목록(`candidateDescLine`)의 완성 문장. 목록은 원문이 잔여 정보의 유일한 채널이라는 종전 계약(`rewriteBusArrivalMessage` 주석)이 그대로 유효하다.

## 6. 판정 기록

- **설계 적대적 리뷰 생략**: 새 불변식·판정 계층·상태 머신·외부 계약이 없다(문장 계층 + i18n). 구현 리뷰는 spec-compliance + code-quality + a11y 감사로 간다.
- **노선 라벨 합성 위치**: 투영·텍스트 계층이 아니라 **수단별 i18n 키**(§2.1). 근거는 두 계층 모두 카탈로그를 모른다는 것과, 라벨을 합성하면 조인 키가 오염된다는 것.
- **초 표기**: 원문에 초가 있으면 정확값, 없으면 "약"(§2.3). 국면으로 가르지 않는다.
- **서버 재작성 제거**(§1.4): `rewriteBusArrivalMessage`와 그 전용 테스트를 지운다. `slotToItem`의 `phase` 인자는 영문 투영이 계속 쓰므로 남는다.
- **`운행종료` 문장 미작성**(§1.2): 도달 불가. 만들면 검증할 수 없는 문장이 늘고 실제로는 미지 폴백이 동작한다.

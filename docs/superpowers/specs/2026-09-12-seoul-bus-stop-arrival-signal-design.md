# 서울버스 정차 신호 설계 — "곧 도착"은 정차가 아니다 (A41, 2026-09-12)

> 접수 항목 `docs/BACKLOG.md` A41. 원 설계 `2026-08-04-transit-guidance-design.md`(국면표 "곧 도착은 임박 신호이지 도착 확정이 아니다")와 `2026-08-22-transit-boarding-phase-design.md` §1(잔여 0 = 승차 정류소 도착 관측)의 충돌을 실호출로 푼다. 판정 확정분(위원장, 재질문 없음): "곧 도착" 시점 통지는 남긴다 — 승차 "{노선} 곧 도착합니다"(승격 없이), 하차 "이번 정류장에서 내리세요". riding 승격·`arrived(certain)`·"도착" 통지만 실호출로 확정한 신호로 옮긴다. 지하철 `arvlCd` 0·1은 범위 밖.

## 0. 실호출 조사 (2026-09-12 05:24~05:34 KST, 갈월동 `arsId=03012`, `scripts/verify-seoul-bus-stop-arrival.mjs`)

한 정류소의 `getStationByUid`(승차 대기 op)를 10~15초 간격으로 폴해 **차량 단위**로 전이를 기록했다(한 호출이 그 정류소 전 노선을 주므로 정류소 폴이 차량 표본을 가장 싸게 모은다). 잔여 ≤1 차량이 있을 때는 그 노선의 `getArrInfoByRoute`(하차 카운트다운 op)도 함께 받아 두 op를 대조했다. 호출 60+15회, 원문 2,430행(부분 저장 JSONL, `--from-corpus`로 무호출 재집계 가능).

| 노선/vehId | 잔여1 마지막 관측(traTime) | 곧 도착 첫 관측(traTime) | 곧 도착 마지막 관측(traTime) | 소실 확인 폴 | 곧 도착 지속 | isArrive / stationNm(곧 도착 중) |
|---|---|---|---|---|---|---|
| 6001/115065705 | 05:25:22 (154s) | 05:25:32 (100s) | 05:27:13 (8s) | 05:27:23 | ≥100s | 0 / 갈월동 |
| 150/109059236 | 05:33:24 (248s) | 05:33:34 (159s) | 05:33:55 (147s) | (관측 종료까지 잔존) | ≥20s | 0 / 갈월동 |
| 151/108018458 | (관측 전) | 05:24:01 (5s) ※첫 관측부터 | 05:24:11 (5s) | 05:24:21 | ≥10s | 0 / 갈월동 |
| 151/108018009 | 05:33:45 (213s) | 05:33:55 (185s) | 05:33:55 (185s) | (관측 종료까지 잔존) | ≥0s | 0 / 갈월동 |
| 152/108018555 | (관측 전) | 05:24:01 (101s) ※첫 관측부터 | 05:26:02 (5s) | 05:26:12 | ≥120s | 0 / 갈월동 |
| 152/108018137 | 05:30:44 (212s) | 05:30:54 (178s) | 05:33:55 (10s) | (관측 종료까지 잔존) | ≥180s | 0 / 갈월동 |
| 162/107012141 | (관측 전) | 05:24:01 (110s) ※첫 관측부터 | 05:26:32 (5s) | 05:26:42 | ≥151s | 0 / 갈월동 |
| 162/107012276 | 05:28:23 (202s) | 05:28:33 (167s) | 05:32:04 (5s) | 05:32:14 | ≥211s | 0 / 갈월동 |
| 202/110054340 | 05:27:53 (229s) | 05:28:03 (171s) | 05:31:04 (4s) | 05:31:14 | ≥180s | 0 / 갈월동 |
| 202/110054174 | 05:31:04 (218s) | 05:31:14 (170s) | 05:33:55 (18s) | (관측 종료까지 잔존) | ≥160s | 0 / 갈월동 |
| 500/109059064 | 05:33:34 (191s) | 05:33:45 (174s) | 05:33:55 (174s) | (관측 종료까지 잔존) | ≥10s | 0 / 갈월동 |
| 501/120004117 | 05:27:43 (187s) | 05:27:53 (180s) | 05:31:04 (6s) | 05:31:14 | ≥190s | 0 / 갈월동 |
| 503/117023288 | 05:32:34 (184s) | 05:33:04 (156s) | 05:33:55 (109s) | (관측 종료까지 잔존) | ≥50s | 0 / 갈월동 |
| 504/108057431 | (관측 전) | 05:24:01 (89s) ※첫 관측부터 | 05:26:02 (5s) | 05:26:12 | ≥120s | 0 / 갈월동 |
| 504/108057423 | 05:30:34 (187s) | 05:30:44 (181s) | 05:33:45 (6s) | 05:33:55 | ≥180s | 0 / 갈월동 |
| 742/111033478 | (관측 전) | 05:24:01 (138s) ※첫 관측부터 | 05:26:22 (5s) | 05:26:32 | ≥141s | 0 / 갈월동 |
| 742/111033397 | 05:32:54 (184s) | 05:33:14 (171s) | 05:33:55 (152s) | (관측 종료까지 잔존) | ≥40s | 0 / 갈월동 |
| 750A/112007366 | 05:24:42 (184s) | 05:24:52 (164s) | 05:26:22 (97s) | 05:26:32 | ≥90s | 0 / 갈월동 |
| 750A/112007012 | 05:32:34 (184s) | 05:32:54 (169s) | 05:33:55 (124s) | (관측 종료까지 잔존) | ≥60s | 0 / 갈월동 |
| 752/111033564 | 05:32:54 (184s) | 05:33:04 (175s) | 05:33:55 (127s) | (관측 종료까지 잔존) | ≥50s | 0 / 갈월동 |
| 1711/107015020 | (관측 전) | 05:24:01 (33s) ※첫 관측부터 | 05:24:11 (19s) | 05:24:21 | ≥10s | 0 / 갈월동 |
| 1711/107015447 | 05:28:33 (131s) | 05:28:43 (102s) | 05:31:04 (5s) | 05:31:14 | ≥140s | 0 / 갈월동 |

(차량 22대 · 폴 60회 · 원문 2,430행 중 `isArrive` 분포 `{"0": 2430}` · 같은 시각 같은 차량의 두 op 필드 일치: `sectOrd`·`remaining`·`isArrive`·`stationNm` 30/30, `arrmsg`는 12/30 — `getArrInfoByRoute`가 초 단위("12분39초후")까지 담는 표기 차이뿐. 원문 JSONL은 `~/gildongmu-private/field-logs/seoul-bus-stop-arrival-03012-2026-09-12.jsonl`.)

**판정**

- ① **`isArrive1`·`stationNm1`은 정차를 가르지 못한다.** 2,430행 전부 `isArrive=0`이고(정차 중이었을 시간대 포함) `stationNm1`은 `sectOrd1`이 가리키는 정류소명이라 잔여 0이면 언제나 우리 정류소다 — 잔여와 같은 정보의 다른 표기다. `repTm1`은 2018·2021년 고정값으로 무효. **provider에 새로 실을 필드가 없다**(A41 접수 때의 "추가 데이터 0으로 정차를 잡는다" 가정 기각).
- ② **소실이 유일한 구조 신호다.** "곧 도착" 차량은 `traTime1`이 ~5초까지 내려간 뒤 0~50초 안에 목록에서 사라진다 = 그 차량이 서고 떠났다(정차 자체는 관측되지 않는다). 750A는 `traTime 97`에서 곧장 사라져 `traTime` 하한을 정차 판정에 쓸 수 없다(카운트다운 표시용 정확도는 좋지만 3-state 판정 축으로는 부적격).
- ③ **"곧 도착"은 간선에서 90~211초 유지된다**(발화 시점 `traTime` 100~181초). A41 증상(2~3분 이르다)과 정확히 같은 크기이고, 마을버스 강동01의 16초(2026-08-16)도 같은 기제의 짧은 구간이다.
- 두 op(`getStationByUid`·`getArrInfoByRoute`)는 같은 차량에 같은 구조 값을 주므로 승차·하차 두 자리에 같은 판정을 쓸 수 있다.
- **소실 뒤 재등장 0건**(폴 10~15초, 관측 차량 53대 전수에서 폴 공백이 있는 차량 없음). `MISS_ARRIVE_COUNT = 2`(연속 2폴)는 깜빡임 방어로 충분하고 앱 폴 20초에서는 여지가 더 작다.

## 1. 문제

리듀서(Kit `TransitGuide.swift` ↔ 웹 `transit-guide.ts`)가 서울버스 잔여 0을 두 자리에서 정차로 읽는다: boarding `arrivedAtBoardStop`(→ `boarded(observed)` 자동 승격 + "{노선} 도착. 탑승하세요.")과 riding `arrivedByMode`(→ `arrived(certain: true)` + "하차 지점에 도착했습니다"). 실측상 잔여 0은 직전 정류소 출발이라 둘 다 직전 구간 주행 시간만큼 이르다.

## 2. 설계

### 2.1 신호와 이벤트

| 자리 | 잔여 0 첫 관측("곧 도착") | 잔여 0 뒤 소실(2폴 연속 미등장, `MISS_ARRIVE_COUNT`) |
|---|---|---|
| boarding(승차 정류소) | 새 이벤트 `arrivingAtBoardStop` 1회. 국면 유지 | `boarded(cause: "departed")` — riding 승격. "차량이 서고 떠났다"가 관측된 자리이고 사용자는 그 차에 탔거나 놓쳤다. 놓쳤으면 종전대로 [탑승 변경]이 boarding으로 되돌린다(`restoreBoarding`) |
| riding(하차 정류소) | 새 이벤트 `arrivingAtAlightStop` 1회. 국면 유지 | 종전 **도착 추정** 경로(`arrived(certain: false)`, 가역 — 재관측이면 `backOnTrack`). 확정 도착은 하차역 선언(`declareArrived`)뿐. **단 "0을 본 뒤의 추정 도착"(`lock.mode == seoulBus ∧ ladderAnnounced == 0`)은 소실이 이어져도 `signalLost`를 내지 않고 폴을 60초로 늦춘다**(설계 리뷰 M1 — 그 소실이 곧 신호였으므로 지속은 예상된 후속이다. 종전 확정 도착이 침묵하던 자리에 "차량 신호를 찾지 못하고 있습니다"+60초 경고음이 들어오는 회귀를 막는다. 0이 아닌 이유는 `backOnTrack`이 가역성의 유일한 문). 지하철 추정(1정거장 전 소실)은 종전대로 경고 |

- 잔여 1에서 잔여 0을 거치지 않고 사라지면(마을버스 짧은 구간·데이터 공백) 종전대로 `vehiclePassed`(boarding)·도착 추정(riding). 새 술어는 **잔여 0을 본 뒤의 소실**로 좁힌다 — 0을 못 본 소실은 "서고 떠났다"의 증거가 아니라 종전 3-state 그대로다.
- 지하철은 변경 없음(boarding 0·1 → `observed`, riding 1 → `certain`). 지방버스 근사 잠금·비관측 잠금은 종전대로 이 판정을 지나지 않는다.
- 이벤트 두 종은 payload가 없다(문장 조립에 항목 값이 필요 없다 — "곧 도착" 원문은 상태줄 `lastMessage`로 이미 흐른다).
- `TransitBoardedCause`에 `"departed"` 추가. 통지는 `boardedLine`만("{노선} 탑승. 하차: {하차역}."), `arrivedAtBoardStop` 문장("도착. 탑승하세요")은 `observed`(지하철)에만 남는다. `eventProfile`: `boarded(departed)`는 interrupt false·tone start(사용자는 이미 탔다 — 선언 응답과 같은 급). `arrivingAtBoardStop`·`arrivingAtAlightStop`은 interrupt true·tone imminent(종전 잔여 ≤1 사다리와 같은 축).
- 1회 발화 래치는 새 상태 필드 없이 `ladderAnnounced = 0`을 쓴다(사다리 래치가 이미 "이보다 작아질 때만 재발화"라 0에서 두 번 나지 않는다). 첫 관측이 곧 잔여 0이면(재선택 직후 실사고 20:43) `approaching`·`trackingStarted` 대신 이 이벤트가 난다 — 사용자에게 필요한 문장은 "추적합니다"가 아니라 "곧 도착합니다"다. 래치는 `resetLockTracking`을 지나는 전이(재선택·탑승 변경 취소·advance)에서만 지워지므로, 되돌린 뒤 같은 차량을 다시 고르면 "곧 도착합니다"가 다시 난다(새 잠금 세대의 첫 문장 — 중복이 아니다). `backOnTrack`은 래치를 지나지 않는다.

### 2.2 리듀서 변경 자리(웹 ↔ Kit 미러)

- `commitBoardingMatched`: 승격 판정을 지하철만 남기고, 서울버스 잔여 0은 `arrivingAtBoardStop` 분기로. **자리는 `!wasTracking`(첫 관측)·사다리 분기보다 앞**이고 조건은 `remaining === 0`뿐(사다리와 달리 `prevRemaining` 감소를 요구하지 않는다 — 첫 관측·소실 후 재등장 모두 통과). 이미 래치 0이면 무이벤트(단 `signalLost`에서 돌아온 폴은 `signalRecovered`).
- `boardingUnmatched`: 판정 순서는 ①`signal === signalLost` 조기 반환 → **②`base.remaining === 0 ∧ lock.mode === seoulBus ∧ missCount ≥ MISS_ARRIVE_COUNT` → `enterRiding(lock, "departed")`** → ③`vehiclePassed`(잔여 ≤1) → ④`signalLost`. ①보다 앞에 두면 "0 관측 → 조회 실패 3폴 → 회복 폴 부재" 경로(회복이 `signalLost`를 세운 채 진입)가 승격된다 — 장애 구간에 걸친 소실은 "서고 떠났다"의 증거가 아니다(설계 리뷰 M3, fixture ⓖ가 잠근다).
- `commitMatched`(riding): 확정 도착 판정을 지하철만 남기고, 서울버스 잔여 0은 `arrivingAtAlightStop` 분기(래치 0, 역시 `!wasTracking` 앞). 추정 도착 상태의 재관측은 종전대로 `backOnTrack`이 먼저다 — (a) 0을 본 뒤 추정 → 재관측 0: `backOnTrack`만, 래치 0이라 "내리세요" 재발화 없음(이미 말했다) (b) 잔여 1에서 소실 → 추정 → 재관측 0: `backOnTrack` → 다음 폴에도 0이면 그때 `arrivingAtAlightStop`(fixture ⓙ).
- `handlePoll` riding 미등장: 도착 추정 판정 뒤·`signalLost` 판정 앞에 `seoulBusArrivedAfterSoon`(위 M1) 조기 반환.
- 폴 주기(`pollIntervalMs` ↔ `transitPollIntervalMs`) 변경 **둘**: ⓐ**riding 첫 조회 한 번만 15초**(`riding ∧ !trackingAnnounced ∧ ridingPolls == 0`, 설계 리뷰 M2 — 승격이 "곧 도착 뒤 소실"(출발 20~40초 뒤)로 밀려 첫 하차 정류소 폴이 종전 60초 뒤면 마을버스 1~2정거장 구간의 하차 신호를 통째로 놓친다. 즉폴이 아닌 이유는 승격 문장의 지연 슬롯(N3 ① H1). 선언 진입은 즉폴이 있어 `ridingPolls`가 곧 1이라 영향 없음. 부수효과: riding 첫 조회가 실패로 이어지면 `ridingPolls`가 0에 머물러 15초 재시도가 계속되고 `upstreamFailed` 통지가 종전 riding의 120초가 아니라 30초에 온다 — boarding의 40초와 같은 급, 의도된 값) ⓑM1 상태 60초. 그 밖(boarding 20초 등)은 불변 — 마을버스에서 boarding 0 관측을 놓칠 확률을 줄이는 잔여 ≤1 boarding 15초는 실승차 판정 뒤로 미룬다(§5).

### 2.3 통지 문장(새 키, 6로케일)

- `transitGuide.arrivingAtBoardStop` = "{line} 곧 도착합니다." — 공유 descriptor 경유(노선 라벨 en 축): `TRANSIT_TEXT_KEYS`·`TRANSIT_TEXT_ARG_NAMES`·Kit `transitTextKeys`·앱 `TransitGuideTextRenderer` switch·`transit-guide-text-cases.json`.
- `transitGuide.arrivingAtAlightStop` = "이번 정류장에서 내리세요." — 인자 없음, 플랫폼이 직접 조회(`arrived`와 같은 자리).
- 기존 키 문안은 건드리지 않는다(E39 몫). `vehiclePassed` 문장은 잔여 1 소실에 그대로 맞다.

### 2.4 provider·라우트

변경 없음. `SeoulTrackSlot`·`TrackItem`에 새 필드를 싣지 않는다(§0 ①). `remainingFromArrmsg` 주석의 "곧 도착은 0(하차 구간 진입)"은 옳고, 틀린 것은 그 0을 정차로 읽은 리듀서였다.

⚠ **버스 항목에 `dataStamp`·`dataAgeSeconds`를 싣지 않는 것이 이 판정의 전제다**(`slotToItem`). `commitBoardingMatched`는 동일 스냅숏 폴에도 `missCount`를 올리므로(국면 고착 방지) 누군가 `recptnDt` 유래 stamp를 버스에 실으면 "0 관측 → 동일 스냅숏 1폴 → 실제 부재 1폴 → 승격"으로 연속 2폴 미등장 계약이 1폴로 조용히 약해진다. 같은 이유로 `fresh`(`BOARD_STOP_FRESH_SECONDS`) 게이트는 버스에 무의미하고 "동결 레코드가 0으로 둔갑"(지하철 C3)의 재현 조건도 버스엔 없다.

## 3. 테스트

- 공유 fixture `transit-guide-scenarios.json`에 추가(이름에 "A41"): ⓐ boarding 서울버스 "잔여 2 → 1 → 곧 도착 지속 3폴(첫 폴만 `arrivingAtBoardStop`, 이후 무이벤트) → 소실 2폴 → `boarded(departed)`, riding 진입 `ridingPolls 0`" ⓑ boarding "첫 관측이 잔여 0 → `arrivingAtBoardStop`(approaching 아님)" ⓒ boarding "잔여 1 소실은 종전 `vehiclePassed`" ⓓ riding 서울버스 "2 → 1(countdown) → 0 `arrivingAtAlightStop` 1회 → 지속 무이벤트 → 소실 2폴 → `arrived(false)` → 재관측 `backOnTrack`(재발화 없음) → 다시 소실 → 추정" ⓔ riding "첫 관측이 잔여 0 → `arrivingAtAlightStop`" ⓕ boarding "0 → 1폴 공백 → 재등장(무이벤트·missCount 리셋) → 소실 2폴 → departed" ⓖ boarding "0 → 실패 3폴 → 회복 폴 부재 → 부재: 승격 없음·signalLost 유지"(M3) ⓗ boarding "잔여 1 소실 vehiclePassed → 재등장 0 `arrivingAtBoardStop`(래치 1→0) → 소실 2폴 → departed" ⓘ riding "0 → 소실 2폴 추정 → 소실 3·4·5폴 무이벤트·signal tracking"(M1) ⓙ riding "잔여 1 소실 추정 → 재관측 0 `backOnTrack` → 다음 0 `arrivingAtAlightStop` → 소실 → 추정"(m4 b) ⓚ riding "0 → 1 역행 무이벤트 → 0 무이벤트(래치 비가역)" ⓛ boarding departed → riding 첫 폴 0 → `arrivingAtAlightStop`(trackingStarted 아님) ⓜ riding "잔여 1 관측(0 미관측) → 소실 2폴 추정 → 소실 3폴 `signalLost`"(코드 리뷰 M1 — M1 한정자 `ladderAnnounced == 0`의 경계, 단위 테스트가 15초 폴도 단언) ⓝ riding "0 → 실패 3폴 → 회복 폴 부재(signalRecovered·signalLost) → 재등장 0은 `signalRecovered`(재발화 없음)"(코드 리뷰 m1, ⓖ 꼬리에도 같은 재등장 스텝). 기존 두 시나리오("boarding: … 서울버스 잔여 0은 도착 관측"·"다중 leg" 첫 leg의 잔여 0 확정 도착)는 새 계약으로 고친다(다중 leg는 `declareArrived`로 확정 도착).
- 톤 fixture `transit-guide-tone-scenarios.json` ⑭: 서울버스 1 → 0은 `arrivingAtAlightStop` 이벤트 소유(closer 없음·앵커 0), 0 지속 무음, 소실 2폴 `arrived` 이벤트 소유, 그 뒤 0을 본 추정 도착은 `signalLost`·`unreliable` 없음(M1).
- `pollIntervalMs` 단위(웹 ↔ Kit): riding 첫 조회 15초 → 미등장 60초(M2), 0을 본 추정 도착 60초 + 소실 지속 4폴 무이벤트·signal tracking(M1). 기존 "riding 첫 폴 60초" 단언 2건(선언 진입·지방버스 근사)은 15초로 개정.
- `transit-guide-text-cases.json`에 `arrivingAtBoardStop` ko·en 케이스. `eventProfile` 단위 검증(웹) + Kit `transitEventProfile`.
- 계측: iOS 로그는 `String(describing:)`라 `boarded(legIndex: 0, cause: GildongmuKit.TransitBoardedCause.departed)`가 그대로 찍힌다 — 실승차 판정의 grep 토큰은 `cause: … departed`·`arrivingAtBoardStop`·`arrivingAtAlightStop`.
- 실호출 게이트: `scripts/verify-seoul-bus-stop-arrival.mjs`(§0 표의 출처, 판정 스크립트가 아니라 관측 스크립트 — 결론은 이 spec §0이 정본).

## 4. 문서 분배

CHANGELOG 항목 / BACKLOG A41 종결 + §2 N3 ② 재판정 행("곧 도착합니다"가 타기 전, "탑승" 문장이 출발 뒤 20~40초 안, 하차 "이번 정류장에서 내리세요"가 차내 방송과 같은 시점인가) / FIELD-TEST §5-2 N3 도착 행 / INTEGRATIONS §시내버스 / CLAUDE.md 규칙 1~2줄 / research `RESEARCH-2026-08-03` 머리 한 줄(§1.1 전제 반전) / PROGRESS 한 줄.

## 5. 미결·후속

- **버스위치 API(`getBusPosByRtid`, `stopFlag`)의 필요성**: 이 설계는 정차를 관측하지 않고 "출발"만 잡는다. 승차는 그것으로 충분하지만(탔으면 그때 riding), 하차의 확정 도착은 여전히 없다(추정만). "이 정류소에 섰다"가 필요해지면 그 API(활용신청 = 위원장 몫)가 유일한 후보다 — 이 세션은 신청하지 않았다.
- boarding 잔여 ≤1 폴 주기 15초 축소 여부는 실승차(마을버스 포함) 판정 뒤.
- `traTime1`은 카운트다운 표시 후보로는 정확했다(표). 판정 축이 아니라 표시 축으로만 검토 가능. "곧 도착합니다"는 간선에서 실제 도착보다 최대 3.5분 앞선다(§0 지속 최대 211초 + 늦은 선택은 그 중간부터) — 위원장 확정 판정이라 지적이 아니라 기록이고, 보완 자리는 이 표시 축("곧 도착합니다, 약 2분").
- `boarded(departed)`의 문장은 `boardedLine`("{노선} 탑승. 하차: {하차역}.") 그대로다 — 관측이 아니라 추정을 단언하지만 `declared`와 같은 문장 계약의 연장이고 [탑승 변경]으로 되돌린다. 관측을 서술하는 문안("{노선} 출발. …")은 E39(상태 문장 문장형) 세션에 `cause`별 분기 한 줄로 인계한다. ▶ **인계 결말: 기각**(2026-09-12 E39 세션) — 통지가 "무슨 일이 일어났나"만 말하는데 사용자에게 일어난 일은 탑승이지 버스의 출발이 아니다(`docs/PATTERNS.md` §안내 시트 상태 문장… "A41 인계 기각").

## 6. 설계 리뷰 판정

새 판정 계층(승격·도착 신호)이라 적대적 리뷰 1회 대상. **판정: APPROVE_WITH_CHANGES(2026-09-12, 보고 `~/gildongmu-wt/reports/transit-signal-review-design.md`)** — BLOCKER 0, MAJOR 3(M1 "0을 본 뒤 추정 도착"의 signalLost·경고음·15초 폴 회귀 → 침묵+60초 / M2 riding 첫 폴 60초가 짧은 구간 하차 신호를 놓침 → 첫 폴 15초 / M3 `boardingUnmatched` 순서 명시) 전부 반영, MINOR 8건 중 m1은 E39 인계·나머지 spec 반영. 기각: "동결 레코드 둔갑"(버스에 stamp 없음), "departed는 3-state 위반"(확정 판정 범위·되돌림 수단 있음), "추정 도착이 E34 버튼을 막는다"(`canAdvance`는 arrived 전체 허용).

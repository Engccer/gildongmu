# 대중교통 강등 정렬에서 `unknown`을 뺀다 (A21)

> 2026-08-25. BACKLOG A21(김찬홍 선생님 리포트에서 발견). 선행 spec `2026-08-01-subway-service-hours-design.md` §3-4-1 "지하철 `unknown`이 `running` 버스 뒤로 밀린다"의 수용 근거 ②("강등이지 제외가 아니다")를 **철회**한다 — 2026-08-07 선정 5개(`MAX_TRANSIT_ROUTES`) 도입으로 그 전제가 깨졌다.
> 설계 적대적 리뷰: **생략**. 정렬 키 하나를 빼는 변경이고 표기·선정·라벨 계층은 무변경. 잔여 리스크는 구현 리뷰 + §5 실호출 게이트.

## 1. 문제

| # | 사실 | 근거 |
|---|---|---|
| 1 | 4호선은 노원·사당·창동·혜화 전부 `coverage: unknown` — TAGO가 인증 정상 `00`에 `totalCount 0`(노선 단위) | prod `/api/station/timetable`, `GetSubwaySttnAcctoSchdulList` 직접 호출 |
| 2 | ODsay 후보 21건 중 1순위 "4호선 노원→사당→2호선 73분"이 prod 5개에 **없다** | `unknown`(rank 1)이 `running` 버스 경로(rank 0) 뒤로 밀리고 5개 절단에 걸린다 |

정렬 강등 × 절단 = 제외. TAGO가 노선째 비어 있는 4호선에서는 하루 종일 상시다.

## 2. 계약

**정렬 키는 `outside` 유무 하나다.** `unknown`은 정렬에 참여하지 않는다(= `running`과 같은 자리). 근거는 선행 spec의 원래 문장 — "조회 실패·미지원 지역을 결함으로 단정하면 멀쩡한 경로가 강등된다".

| 계층 | 변경 |
|---|---|
| `annotateServiceStatus`(`odsay.ts`) | `routeRank` = 경로에 `outside` leg가 있으면 1, 없으면 0. 안정 정렬이라 나머지는 ODsay 추천순 |
| `SERVICE_RANK`(`service-hours.ts`) | **삭제**. 3단 서열이 정렬 정책으로 읽히는데 정책은 2단이다. `outside` 술어는 `odsay-select.ts`의 `isOutside`를 export해 강등·축 제외가 **한 술어**를 쓴다 |
| leg `serviceStatus` 부착 | 불변 — `unknown`은 여전히 붙는다(3-state 표기 계약). 표기는 종전대로 `outside`만 |
| 선정(5)·축 라벨 | 불변 |

**수용하는 트레이드오프**: `unknown`이 `running`과 동순위가 되므로, 심야에 조인 미스(역·방향 단위로 임의 노선에서 난다 — 사당발 2호선 실관측)가 난 지하철 경로가 확인된 심야버스 경로보다 **앞에 남을 수 있다**(ODsay 원순서 보존). 수용 근거: ① `unknown`은 "끊겼다"의 증거가 아니라 "모른다"이고, 모르는 것을 뒤로 보내는 정책은 절단과 결합해 하루 종일 멀쩡한 경로를 지웠다(4호선) — 심야 몇 시간의 오노출보다 상시 제외가 더 큰 해다 ② 심야 지하철은 조인이 되는 노선에선 `outside`로 강등되고 그것이 정확한 층이다 — 조인 미스를 줄이는 것(A22)이 답이지 `unknown`을 결함으로 읽는 것이 답이 아니다 ③ 표기는 종전대로 침묵이라 낭독에 거짓 문장이 추가되지는 않는다.

⚠ 종전 "조인 축 결측 leg도 반드시 상태를 갖는다"(회귀 가드)는 유지한다 — 정렬에 안 쓰더라도 `unknown` 표기 3-state는 상태가 있어야 성립한다.

## 3. 비범위

- TAGO 4호선 0행 자체(업스트림) — A19 게이트에 **관측**만 더한다(`scripts/verify-korea-subway-timetable.mjs` 역 목록에 노원역 추가, 요일 무관 불변식만 단언).
- 선정에서 ODsay 1순위 보존 — `unknown`이 정렬에서 빠지면 불필요.
- 아침 09:22 리포트에서 사당 경로가 추천으로 보인 이유 — 미재현, BACKLOG 종결 시 "미확인"으로 남긴다.

## 4. 테스트

- `odsay-service-hours.test.ts`: "조회 실패는 unknown이고 순위를 바꾸지 않는다" 계약을 **running 경로가 뒤에 있어도** 원순서 보존으로 확장(종전 "unknown이 running 뒤" 단언 2건 뒤집음 — 상태 부착 단언은 유지). `outside`만 강등되는 케이스는 기존 그대로.
- `service-hours.test.ts`: `SERVICE_RANK` 서열 테스트 삭제.
- `odsay-select.test.ts`: `isOutside` export 계약(변경 없으면 생략).

## 5. 실호출 게이트 (머지 조건)

노원 → 구로디지털단지(A20과 같은 OD, `scripts/verify-odsay-transfer-door.mjs`에 단언 추가): ODsay 1순위 "4호선 노원→사당→2호선"이 `recommended`로 온다(4호선 leg `serviceStatus: unknown`인 채로). ⚠ 심야(01~05시)에는 2호선·버스가 `outside`라 순위 근거가 달라지므로 게이트는 그 시간대 밖에서 돌린다.

## 6. 검증 기록 (2026-08-25)

- 단위: `odsay-service-hours.test.ts` — unknown 지하철(4호선 노원)·running 버스·outside 버스 3건이 `["4호선","N30","342"]` 원순서 보존(A21 케이스 신설), 종전 "unknown이 running 뒤" 단언 2건을 원순서 보존으로 뒤집음, 상태 부착 단언 유지. `SERVICE_RANK` 테스트 삭제. 전체 3,260 green.
- 실호출 `scripts/verify-odsay-transfer-door.mjs` 6/6 PASS(23:50 KST): 추천 = "4호선 노원→사당[unknown] → 2호선[unknown]". ⚠ **이 시각의 PASS는 변경의 판별력을 증명하지 못한다** — 23:50엔 5536이 `outside`, 나머지 후보의 2호선 leg도 `unknown`이라 변경 전에도 같은 순위가 나왔다(23:42 A20 게이트 로그로 확인). 판별력 있는 관측은 접수 세션 19:30의 prod 응답(추천 79분 7호선+5536 `running`, 4호선 경로 5개 밖)이고, 그 조건에서의 재관측은 주간에 같은 스크립트를 한 번 더 돌려 BACKLOG A21 종결 항목에 적는다.
- `verify-korea-subway-timetable.mjs` 22/22 PASS, 노원역 관측: `4호선=unknown(0행), 7호선=ok`(weekday).
- 부수 관측: 사당발 2호선 leg도 `unknown`으로 나온다(순환선 시간표 조인 미스 가능성). A21 범위 밖 — BACKLOG에 후보로 남긴다.

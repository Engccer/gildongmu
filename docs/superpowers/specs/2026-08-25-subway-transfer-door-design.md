# 환승역 빠른하차 — ODsay `door`를 환승 구간의 정본으로 (A20)

> 2026-08-25. BACKLOG A20(김찬홍 선생님 리포트). 기존 spec `2026-08-08-subway-quick-exit-design.md` §6 "환승 구간에서 자연히 여러 번 나온다 — 별도 처리가 필요 없다"를 **철회**한다.
> 설계 적대적 리뷰: **생략**. 사실 관계(§1 표)는 접수 세션 실호출로 확정됐고, 새 불변식·상태 머신·외부 계약의 첫 정의가 없다(기존 `QuickExit` 계약에 필드 하나를 더하고 provider 분기 하나를 바꾼다). 잔여 리스크는 구현 리뷰와 §5 실호출 게이트가 덮는다.

## 1. 문제

| # | 사실 | 근거 |
|---|---|---|
| 1 | 사당 4호선(오이도 방면) → 2호선 빠른환승 문은 **5-2** | ODsay `searchPubTransPathT` `subPath.door="5-2"`, 카카오지하철과 일치(노원→동대문역사문화공원 `10-4`도 일치) |
| 2 | 길동무는 "사당 하차, 엘리베이터 2-3 문, 계단 1-1 문"을 냈다 | 서교공 seed 사당 4호선 하행: 엘베 `2-3`, 계단 `1-1`·`5-2`. 쌍 최적화가 엘베 옆 계단 `1-1`을 골랐다 |
| 3 | 서교공 원본(15143840)은 계단이 **환승 통로인지 출구인지 구분하지 않는다** | 14필드 전수 |
| 4 | `door`는 **환승 leg에만** 실리고 하차 leg는 문자열 `"null"` | 사당→구로디지털단지 `door="null"` |

환승역에서 필요한 것은 *출구로 가는 계단*이 아니라 *환승 통로*다. seed에는 그 구분이 없고 ODsay 응답에 이미 답이 실려 온다.

## 2. 계약

### 2.1 값 (`QuickExit`, 웹 `types.ts` ↔ Kit `RouteModels.swift` ↔ CLI `QuickExitItem`)

```ts
interface QuickExit {
  /** 환승 leg: ODsay 빠른환승 문. 이 필드가 있으면 elevator·stairs는 없다 */
  transfer?: QuickExitDoor; // { kind: "door", doors: ["5-2"] }
  /** 최종 하차 leg: 서교공 seed 최근접 문(종전 그대로) */
  elevator?: QuickExitDoor;
  stairs?: QuickExitDoor;
}
```

**배타 불변식**: `transfer`와 `elevator|stairs`는 한 값에 공존하지 않는다. 한 leg는 환승 leg이거나 최종 하차 leg이지 둘 다가 아니다. 소비자는 `transfer`를 먼저 보고 있으면 그 문장만 낸다.

### 2.2 provider 분기 (`odsay.ts` `toLeg`)

leg의 종류를 먼저 가르고 종류마다 소스가 다르다.

| leg 종류 | 판정 | `quickExit` |
|---|---|---|
| **환승 leg** | `door`가 `^\d+-\d+$`에 맞는다 | `{ transfer }` |
| **역내 환승인데 `door` 없음** | `door` 미매칭 **이고** 다음 탑승 subPath가 지하철이며 그 사이 도보가 전부 `distance 0` | **필드 부재** — seed 계단은 환승 통로가 아닐 수 있어 싣지 않는다(거짓보다 침묵) |
| **최종 하차 leg** | 그 외(다음 탑승이 없거나 버스이거나 역 밖 도보를 낀다) | seed 엘베·계단(종전 `findQuickExit`) |

⚠ `door`는 `"null"` **문자열**로 온다. `typeof door === "string" && door !== "null"`로 가르면 다음 표기 변종(`""`·`"-"`)에 뚫린다 — 정규식 **긍정 매칭**만 통과시킨다. 통과하지 못한 값은 낭독 어디에도 닿지 않는다.

### 2.3 문장 (웹 `quick-exit-text.ts` ↔ Kit `QuickExitText.swift` ↔ CLI `transitQuickExitLine` 3벌 미러)

새 키 `route.transit.quickExitTransfer` 6로케일. `transfer` 조각은 기존 `quickExitDoor`("5-2 문")를 재사용한다.

| 로케일 | 문장 |
|---|---|
| ko | `{station} 하차, 빠른 환승 {transfer}` → "사당 하차, 빠른 환승 5-2 문" |
| en | `Get off at {station}, quick transfer {transfer}` → "Get off at Sadang, quick transfer at door 5-2" |

"빠른 환승"은 카카오지하철·서울교통공사 안내판 표기와 같다(사용자가 다른 앱에서 들어 본 낱말). 분기 순서: `transfer` → `both` → `elevator` → `stairs`. 3벌 동조는 기존 `format-drift.test.ts`(웹↔CLI 실행 대조)·Kit 테스트가 같은 케이스로 강제한다.

### 2.4 노출 지점

변경 없음 — 웹·iOS 브리핑, CLI, 안내 세션 **승차 대기 국면**(웹 `TransitGuidePanel`·iOS `TransitTrackingSheet`). 값이 바뀌면 문장이 바뀌는 구조라 소비자 배선은 그대로다. 대기 국면에서 환승 leg를 타기 전 "사당 하차, 빠른 환승 5-2 문"이 나온다 — 이것이 리포트가 요구한 자리다.

iOS는 `QuickExit.transfer`를 **선언해야 값이 온다**(additive 디코딩 계약, `QuickExitTextTests`가 디코딩부터 문장까지 훑는다).

## 3. 비범위

- ODsay `exitNo`(출구 번호)·지하철 최단시간 경로 → E25.
- seed 계단이 환승 통로인지 판별하는 시도 — 원본에 정보가 없다.
- 하차역(구로디지털단지 `7-4`·`8-3`)의 실승차 판정은 E5 ① 그대로 열려 있다.

## 4. 테스트

- `odsay-quick-exit.test.ts`: ①`door="5-2"` → `transfer`만 ②`door="null"` + 다음 탑승 지하철(역내 환승) → 필드 부재 ③`door="null"` + 최종 leg → seed ④`door="null"` + 다음 탑승 버스 → seed ⑤`door="5-2"`인데 seed도 있는 역 → `transfer`만(배타).
- `quick-exit-text.test.ts`(6로케일)·Kit `QuickExitTextTests`·CLI `format-drift` transfer 케이스.
- Kit `QuickExitTextTests`: `transfer` 디코딩 → 문장(디코딩 계약 케이스).

## 5. 실호출 게이트 (머지 조건)

노원(127.0634, 37.6563) → 구로디지털단지(126.8965, 37.4849) `getTransitRoute`:
1. 4호선 → 2호선 사당 환승 leg의 `quickExit.transfer.doors[0] === "5-2"`.
2. 응답 JSON 직렬화 어디에도 `"null"` 문자열 값이 없다.
3. 최종 하차 leg(구로디지털단지)에는 `transfer`가 없고 seed 값만 있다.

결과는 이 spec §6에 기록한다.

## 6. 검증 기록 (2026-08-25)

- 실호출 게이트 `scripts/verify-odsay-transfer-door.mjs` **5/5 PASS**(23:42 KST): 사당 4호선 leg `{transfer:{doors:["5-2"]}}`(엘베·계단 없음), 구로디지털단지 leg `{elevator:"7-4", stairs:"8-3"}`(transfer 없음), 직렬화에 `"null"` 0건. 같은 응답에서 1호선→신도림 환승 `2-3`, 4호선→서울역 환승 `10-4`(접수 세션 관측과 일치). 후보 21건 중 5건 반환.
- 단위: `odsay-quick-exit.test.ts` +6(door 매칭·역내 환승 침묵·버스 환승 seed·역 밖 도보), `quick-exit-text.test.ts` +2(ko·en·ja, 배타 소비자 측, 6로케일 플레이스홀더), CLI `format-drift` +2, Kit `QuickExitTextTests` +2(문장·디코딩). 전체 3,259 green, Kit 15 green.
- `messages-to-xcstrings.mjs all` 재생성 diff는 `route.transit.quickExitTransfer` 추가뿐(삭제 키 0).

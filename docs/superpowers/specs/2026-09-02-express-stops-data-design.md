# 급행 정차역 집합 데이터층 (A16 L1) + 출구 번호 투영 (E25) 설계

> 2026-09-02. 병렬 계획 `docs/superpowers/plans/2026-09-02-backlog-sweep-2-parallel-plan.md` §1 transit-data 행의 확정 판정(위원장 2026-09-02 "A16 L1 만든다 — ODsay 런타임 조회 + 장기 캐시")을 구현하는 데이터층 설계다. 판정 계층(`terminatesBeforeAlight` 급행 분기·낭독)은 transit-guide 세션 몫이고 이 spec은 **필드를 어떻게 정확하게 채우는가**만 다룬다.
>
> **설계 리뷰 게이트: 적용** — ④ 안전·정확성 축. 이 집합은 소비자가 "이 급행은 {하차역}에 서지 않습니다"라는 **결정적 문장과 활성화 차단**의 근거로 쓴다. 집합에 정차역이 빠지면 타도 되는 열차를 막고(오차단), 없는 역이 들어가면 안 서는 열차를 허용한다(A16 원증상). 어느 방향 오류도 화면·노선도를 못 보는 사용자에게 반증 채널이 없다. 결과는 §9.

## 0. 근거 (실호출 2026-09-02, ODsay `searchPubTransPathT`)

| 호출 | 관측 |
|---|---|
| 개화(126.7969,37.5786) → 중앙보훈병원(127.1508,37.5205), `OPT=0&SearchPathType=1` | path 2건. p0: `수도권 9호선` 개화→김포공항(2역) + **`수도권 9호선(급행)` 김포공항→중앙보훈병원 `passStopList` 16역** (902 김포공항·905 마곡나루·907 가양·910 염창·913 당산·915 여의도·917 노량진·920 동작·923 고속터미널·925 신논현·927 선정릉·929 봉은사·930 종합운동장·933 석촌·936 올림픽공원·938 중앙보훈병원). p1: `수도권 9호선` 개화→중앙보훈병원 38역(완행 전량). 급행 16역 ⊂ 완행 38역 |
| 용산 → 동인천, `SearchPathType=1` | path 1건, `수도권 1호선` 완행 26역 59분뿐. **ODsay는 1호선 급행(경인급행 등)을 lane으로 모델하지 않는다** |
| subPath 키 | `startExitNo`·`startExitX`·`startExitY` / `endExitNo`·`endExitX`·`endExitY`. 값은 **문자열**(`"2"`·`"1"`), 출구가 없는 leg(환승 leg의 승차 쪽·하차 쪽)는 **키 자체가 없다**. 같은 응답에서 `door`가 `"0-0"`(개화→김포공항 완행→급행 동일 승강장 환승)·`"null"`로 관측됐다 |

2026-08-23 조사(`docs/research/RESEARCH-2026-08-23-express-stop-data.md`)와 일치한다: 급행 leg의 `passStopList`는 급행 정차역만 담고, `stationID`도 완행 일련번호를 건너뛴다.

## 1. 범위

- `/api/route/transit` 지하철 leg에 additive `expressStops?: string[]`와 `exit?: { board?: string; alight?: string }`를 싣는다. 웹 `TransitLeg` 타입, Kit `TransitRouteLeg` 옵셔널 디코딩.
- 신규 모듈 `src/lib/express-stops.ts`(순수 판정 + ODsay 전 구간 조회 + 캐시), provider `odsay.ts`의 부착·투영.
- 실호출 게이트 `scripts/verify-odsay-express-stops.mjs`.
- 부산물 수정: `transferDoor`가 `"0-0"`을 문으로 통과시키는 결함(§7).
- **비범위**: `src/lib/transit-guide.ts`·Kit `TransitGuide.swift`·낭독 문구·i18n(transit-guide 세션). 급행 노선 확장(표에 9호선 이외 노선을 더하는 것)은 노선별 실호출 증명이 선행이고 이 spec의 절차(§3)를 따르되 이번 범위 밖.

## 2. 필드 계약 (변경 금지 — transit-guide가 이 이름으로 소비한다)

```ts
export interface TransitLeg {
  …
  /** 이 leg 노선의 급행 정차역 이름 전체 집합(노선 순서, ODsay passStopList 원문). 급행 운행이 있고 집합이 검증된 노선의 지하철 leg에만. 부재 = 판정 불가. */
  expressStops?: string[];
  /** 승차·하차 출구 번호(ODsay startExitNo/endExitNo 원문). 지하철 leg에만, 없는 쪽은 키 부재, 둘 다 없으면 exit 자체 부재. */
  exit?: { board?: string; alight?: string };
}
```

- `expressStops`는 **완행 leg에도 급행 leg에도** 같은 집합이 붙는다. 소비자 시나리오가 "완행 leg × 급행 잠금 후보"이므로 완행 leg에 없으면 이 필드는 존재 이유가 없다. 급행 leg에서는 하차역이 정의상 집합 안이라 무해하다.
- 이름은 ODsay `passStopList.stations[].stationName` 원문 그대로다(`"김포공항"`, 접미 "역" 없음). 정규화는 소비자(`normalizeStopName`)가 한다 — 서버가 정규화하면 `stops[].name`(같은 원문)과 표기가 갈린다.
- 부재의 뜻은 "판정 불가"이지 "급행 없음"이 아니다. 소비자는 부재에서 종전 `expressCheck` 라벨을 유지한다(plan §1 transit-guide 행). **3-state를 필드 하나로 접는 것이 의도다** — "급행 없음"을 빈 배열로 싣지 않는다(빈 배열은 "어느 역에도 안 선다"로 읽혀 전 열차 차단이 된다).
- `exit`은 `mode === "subway"`에만. 버스 정류소에 출구 개념이 없다. `startExitNo`는 `board`, `endExitNo`는 `alight`.
- 옵트인: **`includeStops=1` 응답에만** 두 필드를 싣는다. 실시간 안내의 `viaStops`가 `stops`에서 나오므로 급행 판정이 성립하는 소비자는 정확히 `includeStops` 소비자(웹·iOS)다. CLI/MCP의 미지정 응답은 byte-identical(B2 §7 `stops` 선례와 같은 경계). `exit`도 같은 게이트를 쓴다 — 낭독 소비자가 같고, 게이트가 둘이면 "어느 필드가 어느 조건에서 오는가"가 표가 된다.

## 3. 집합을 얻는 계약 — 노선 표 + 전 구간 조회 + 수락 판정

### 3.1 노선 표 `EXPRESS_LINES`

```ts
{
  line: "수도권 9호선",                 // ODsay lane[0].name에서 "(급행)"을 벗긴 완행 표기 = 조인 키
  expressLane: "수도권 9호선(급행)",     // 급행 leg를 고르는 표기(완전 일치)
  probe: { origin: 개화, dest: 중앙보훈병원 },   // 노선 전 구간을 한 번에 얻는 OD(SearchPathType=1)
  span: { first: "김포공항", last: "중앙보훈병원" }, // 급행 운행 구간 양 끝(전 구간 커버의 증명 기준)
}
```

**항목이 표에 오르는 조건**(전부 실호출로 증명하고 spec §0에 기록): ①ODsay가 그 노선 급행을 `(급행)` 접미 lane으로 모델한다 ②급행 정차 패턴이 **노선당 하나**이고 **양방향 동일**이다 ③전 구간을 한 path의 한 급행 subPath로 돌려주는 OD가 존재한다. 초기 항목은 **9호선 하나**다.

표에 넣지 않는 노선과 근거:
- **1호선**: ODsay가 급행 lane을 주지 않는다(§0 용산→동인천). 주더라도 경인급행·경원급행·천안급행·특급이 서로 다른 정차 패턴이라 ②가 깨진다. 노선당 집합 하나로는 어느 패턴이 서는지 말할 수 없다 → 거짓 집합보다 부재.
- **공항철도 직통**: lane 표기가 `(직통)`이고 정차역이 서울역·인천공항 2곳뿐이며 실시간 도착 피드에 축이 없다(INTEGRATIONS §노선명 표기). 소비자 판정(잠금 후보 급행 표기)이 성립하지 않는다.
- **경의중앙·수인분당·경춘 급행**: 급행 패턴이 시간대·행선지별로 갈리고(②) 이번에 실호출하지 않았다(③ 미증명).

이 표의 정확성 자체는 코드 리뷰가 아니라 **실호출 게이트**가 지킨다(§6). 노선을 더할 때는 §0에 그 노선의 실호출 행을 더하고 게이트에 단언을 더한다.

### 3.2 수락 판정 `extractExpressStops(forward, reverse, entry)` (순수)

**노선당 정방향·역방향 두 응답**(`probe.origin→dest`와 `dest→origin`)을 함께 판정한다(설계 리뷰 #2 채택 — 한 방향 호출은 "양방향 동일"을 증명하지 못한다). 각 응답에서 `trafficType === 1`이고 `lane[0].name === entry.expressLane`이며 **정방향은 `startName === span.first && endName === span.last`, 역방향은 그 반대**인 subPath만 후보다. 아래 하나라도 어긋나면 **null(부재)**:

1. 어느 방향이든 후보 0건 — 전 구간을 덮는 급행 leg가 없다(ODsay가 환승 경로만 주거나 표기가 바뀌었다). 부분 구간 leg의 집합을 쓰면 **정차역인데 집합에 없는 역**이 생겨 타도 되는 열차를 막는다.
2. `passStopList.stations` 이름이 하나라도 비어 있거나, 첫 이름 ≠ 방향의 출발 끝, 끝 이름 ≠ 도착 끝.
3. 길이 < 3, 이름 중복, **`stationID` 부재·중복** — 정차역 축약이 살아 있지 않거나 목록이 깨졌다. 정규화(`normalizeStationName`) 뒤에도 이름이 유일해야 한다(소비자가 정규화 매칭을 하므로 원문만 유일한 목록은 소비자에게 두 역이 한 역이다 — 리뷰 #3).
4. 같은 방향 후보가 둘 이상인데 (ID, 이름) 목록이 서로 다르다(같은 응답 안 불일치).
5. **역방향 목록이 정방향의 정확한 역순이 아니다**(ID·이름 모두). ODsay가 한 방향만 다르게 모델하거나 방향별 정차 패턴이 다르면 여기서 떨어진다.
6. `stationID`가 정방향에서 **강단조**가 아니다(9호선 902→938 증가, 역방향은 감소). 다른 노선·다른 순서의 역이 섞이면 깨진다.
7. 같은 span을 덮는 완행 subPath가 **있으면**, 급행 집합이 그 완행 (ID) 목록의 진부분집합이어야 한다(축약 검증). 없으면 건너뛴다.

통과하면 정방향 후보의 이름 배열(순서 보존)을 돌려준다. ⚠ `en` 응답을 쓰지 않는다 — 조회는 항상 `lang` 없는 ko 호출이라 `*Kor` 분기가 없다(집합은 조인용 한국어 원문).

⚠ **이 판정이 잡지 못하는 것**: ODsay 데이터 자체가 양방향 일관되게 틀린 경우(예: 여의도 대신 샛강). ODsay 단일 소스 안에서는 어떤 판정도 이것을 못 잡는다 — 그 축은 **실호출 게이트의 16역 골든 전수 대조**(§6)가 맡고, 게이트는 머지 전 + A22 주간 재관측에 함께 돈다. 골든을 런타임 코드에 두면 데이터가 seed가 되어 위원장 판정(런타임 캐시, seed 커밋 금지)과 충돌하므로 게이트에만 둔다(§9 결정 2). 그래도 남는 오류의 파급은 두 방향 다 **기존 동작으로 강등**된다: 정차역 누락 → 그 역 급행 잠금 차단(완행으로 안내), 비정차역 혼입 → 종전 A16 L1 침묵(L2 10분 탈출구가 잡는다).

### 3.3 조회와 캐시 `fetchExpressStopsMap(entries)`

- 노선당 **ODsay 2콜**(정·역방향, `SearchPathType=1`, `cache: "no-store"` — fetch 층에 실패 응답이 남지 않게). 각 호출 **8초 타임아웃**(`AbortSignal.timeout`, 리뷰 #9 — 부가 조회가 길찾기 응답을 무기한 붙들면 안 된다).
- `unstable_cache(fn, ["odsay-express-stops", "v1", line], { revalidate: 7일 })`. 종전 안 30일에서 줄였다(리뷰 #4 — 다이어 개정 직후 낡은 집합이 발행되는 창을 줄인다. 권위 있는 다이어 버전 API는 없다). 7일 × 2콜은 쿼터에서 무시할 수 있다. 캐시 키에 계약 버전을 넣어 구버전 배포의 캐시가 새 형태를 오염시키지 않게 한다(리뷰 #6).
- **캐시 함수는 검증된 비어 있지 않은 집합만 정상 반환하고 그 외는 전부 throw**한다(HTTP 실패·봉투 오류·수락 판정 부재). `unstable_cache`는 예외를 굳히지 않으므로 다음 요청이 재시도하고 소비자에겐 부재로 떨어진다. **부재를 정상 반환하는 경로는 캐시 안에 없다**(리뷰 #5 — 쿨다운은 캐시 함수 바깥에 있다).
- **재시도 억제는 캐시 바깥 두 겹**: ①노선별 단일 실행(in-flight promise 공유 — 같은 인스턴스의 동시 요청이 probe를 중복 호출하지 않게, 리뷰 #7) ②실패 종류별 쿨다운(리뷰 #8): 수락 판정 부재·봉투 오류(표기·스키마 드리프트 = 지속적) **6시간**, HTTP·네트워크·타임아웃(일시적) **10분**, ODsay 429(쿼터) **1시간**. 프로세스 메모리라 인스턴스마다 따로지만, 재시도는 "includeStops 길찾기 요청 중 표 노선 leg가 있는 것"에서만 일어나므로 상한이 시간 창이 아니라 **요청 수**다(일 수십 건). 외부 공유 잠금은 그 규모에서 과설계라 두지 않는다(§9 결정 3).
- 요청 형태는 provider와 같다(Referer·raw apiKey·좌표 4자리, `odsay-fetch.ts` 공용).
- 프로세스 밖(esbuild 번들 게이트 스크립트)에서는 `next/cache`가 없다. 게이트는 캐시 없는 `fetchExpressStopsUncached`를 직접 태운다(§6).
- 운영 스위치는 표 자체다 — 노선을 끄려면 `EXPRESS_LINES`에서 항목을 빼고 배포한다(캐시 키가 노선이라 그 순간부터 부재).

### 3.4 부착 `attachExpressStops(routes)` (provider)

`getTransitRoute`에서 `includeStops`일 때만: 전체 후보(`routes`)의 지하철 leg 중 `expressLineKey(leg.lineName)`가 표에 있는 노선을 모아(dedupe) `fetchExpressStops`를 **운행시간 조회와 병렬**로 부른다. 성공한 노선의 leg 전부에 `expressStops`를 붙인다. 실패 노선은 무부착. 부착은 정규화 단계 뒤·강등 정렬 앞이며 순서에 무관하다(정렬 키가 아니다).

`expressLineKey(name)` = 끝에 붙은 `(급행)` 한 토큰만 벗긴다(`transit-guide.ts`의 `subwayLineCore`와 같은 앵커 원칙, 단 `수도권` 접두는 남긴다 — 표 키가 완행 원문이다). 괄호 일반을 벗기지 않는다(`(직통)`이 9호선으로 오인될 길은 없지만 원칙이 같다).

## 4. 출구 번호 투영 (E25)

`toLeg`에서 `mode === "subway"`이고 `includeStops`일 때 `exit.board`·`exit.alight`를 싣되, **필드 존재가 아니라 경로 문맥으로** 허용한다(리뷰 #12 채택 — "환승 leg에 키가 없었다"는 관측이지 계약이 아니다):

- `alight`: 하차 종류(`alightKindAt`)가 **`final`**(역 밖으로 나간다 — 마지막 탑승·버스 환승·역 밖 도보)일 때만. 환승 leg(`transfer`·`inStationTransfer`)는 ODsay가 값을 채우기 시작해도 싣지 않는다.
- `board`: 승차 종류(`boardKindAt`, 대칭)가 **역 밖에서 진입**(첫 탑승·버스 뒤·0m 아닌 도보 뒤)일 때만. 지하철 뒤 0m 도보로 이어지는 승차(역내 환승)는 싣지 않는다.
- 값은 **긍정 정규식** `^[1-9]\d*(?:-[1-9]\d*)?$`만 통과(리뷰 #11 — `"0"`·`"00"`·`"2-0"`·앞자리 0 거부, `"null"`·빈 값·미지 표기는 부재). 좌표 대조(`startExitX/Y` ↔ `startX/Y`)는 출구가 역에서 1km 안이면 참이라 sanity로 둔다 — 넘으면 부재(리뷰 #13 부분 채택; 좌표가 없으면 검사하지 않는다 — 좌표 부재는 ODsay 형태 변화이지 출구 오류 증거가 아니다).
- 둘 다 부재면 `exit` 키 자체를 싣지 않는다.

실호출에서 확정한 것: 환승 leg에는 승차 쪽 출구가 없고(김포공항 환승 승차 `startExitNo` 키 없음) 종점 leg에만 `endExitNo`가 온다.

## 5. 타입·Kit

- 웹 `src/lib/types.ts` `TransitLeg` 절: §2 두 필드.
- Kit `RouteModels.swift` `TransitRouteLeg`: `public let expressStops: [String]?` · `public let exit: TransitLegExit?`(`board: String?`·`alight: String?`), init 기본값 nil(다른 additive와 동형). ⚠ **선언하지 않으면 서버가 실어도 앱만 침묵한다**(quickExit 주석과 같은 계약) — `RouteModelsTests`에 두 필드 있는 JSON·없는 JSON 디코딩 테스트를 둔다.

## 6. 실호출 게이트 `scripts/verify-odsay-express-stops.mjs`

esbuild로 provider를 번들해(transfer-door 게이트 동형) **ODsay 4콜**로:

1. `fetchExpressStopsUncached(9호선 항목)`(정·역방향 2콜) → **16역 골든 전수 일치**(이름·순서: 김포공항·마곡나루·가양·염창·당산·여의도·노량진·동작·고속터미널·신논현·선정릉·봉은사·종합운동장·석촌·올림픽공원·중앙보훈병원 — §0 실호출, 리뷰 #14). 부분 단언(당산 포함·노들 미포함)은 같은 길이 치환을 못 잡는다. ⚠ 골든이 어긋나면 **다이어 개정인지 ODsay 오류인지 사람이 가른다** — 개정이면 골든을 고치고 CHANGELOG에 남긴다.
2. `getTransitRoute(개화→중앙보훈병원, includeStops)`(1콜 + 캐시 없는 환경이라 express 2콜은 위와 별도 — 총 4콜을 넘기지 않으려면 이 단계는 `fetchExpressStopsMap`을 스텁하지 않고 그대로 두되 호출 수를 세어 보고한다) → 9호선 leg(완행·급행)에 `expressStops` 16역, 어느 leg의 `expressStops`도 빈 배열이 아니다, 버스·도보 leg 부재. 완행 전용 노선 부재는 단위 테스트(5호선 fixture)가 맡는다 — 게이트 콜을 아끼기 위해 실호출로 재확인하지 않는다.
3. 같은 응답의 `exit`: 첫 지하철 leg `board === "2"`·마지막 지하철 leg `alight === "1"`(§0 고정 probe 기대값, 리뷰 #13), 환승 leg `board`·`alight` 없음, 값은 운영 정규식과 **같은 완전 일치**(리뷰 #16), 응답 직렬화에 `"null"` 문자열 0.

exit 코드: 0 통과 / 1 위반·호출 불가 / 2 ODsay 429(쿼터). 429는 재시도하지 않는다. 실행 시점(리뷰 #17): 머지 전 필수 + A22 주간 재관측에 `verify-odsay-transfer-door.mjs`와 함께 돈다(`docs/BACKLOG.md` A22).

## 7. 부산물 — `transferDoor`의 `"0-0"`

§0에서 개화→김포공항 완행 leg(다음 leg가 같은 승강장 급행)의 `door`가 `"0-0"`이다. 현행 `transferDoor`의 `^\d+-\d+$`는 이것을 통과시켜 `quickExit.transfer = {doors:["0-0"]}`이 되고 낭독은 "0-0 문"이 된다 — 0번 칸은 없다. 긍정 정규식을 `^[1-9]\d*-[1-9]\d*$`로 조여 `"0-0"`을 부재로 돌린다(A20 원칙: 다음 변종에 뚫리지 않게 긍정 매칭만). 테스트 1건.

## 8. 테스트

- `express-stops.test.ts`: §3.2 수락 판정 7조건 각각의 부재 케이스 + 통과 케이스(§0 응답 축약 fixture, 역방향 fixture 포함), `expressLineKey` 앵커, `attachExpressStops` 빈 배열 금지.
- `odsay-express-stops.test.ts`(`next/cache` 통과 스텁 + fetch 목 + 주입 시계, 리뷰 #15): 성공만 캐시 함수가 반환·실패는 throw, 단일 실행(동시 2요청에 fetch 2콜 = 정·역 1세트), 실패 종류별 쿨다운 창 안 재호출 0, 창 지나면 재호출, 타임아웃 → 부재.
- `odsay-normalize.test.ts` 추가: `includeStops` 미지정이면 두 필드 부재(byte-호환), 지정 시 `exit` 투영·`"null"`·`"0"` 부재·환승 leg 무투영·버스 leg 무투영.
- `odsay-pipeline.test.ts` 추가: 표 노선 leg에 부착, 조회 실패 시 부재 + 경로 응답 유지(throw 금지).
- `odsay-quick-exit.test.ts` 추가: `door: "0-0"` 부재.
- Kit `RouteModelsTests` 디코딩 2건.
- 변이: `expressLineKey`가 `(급행)`을 안 벗기면 급행 leg 무부착 → 테스트 실패 확인.

## 9. 설계 리뷰 결과

codex `adversarial-review` 1회(2026-09-02, raw `codex exec` + spec 본문 주입, worktree라 companion 미사용). 판정 "반려", 지적 17건(BLOCKER 7·MAJOR 10). 본문은 정상 회수됐고 codex의 TTS 요약 재시도가 뒤따랐다(codex-ops 네 번째 사례 동형, 본문 손실 없음).

**채택(설계에 반영)**: #2 양방향 조회·역순 일치(§3.2 ⑤) · #3 stationID 정본·정규화 후 유일성(§3.2 ③⑥) · #4 TTL 30일→7일(§3.3) · #5 캐시 안 부재 반환 경로 0(§3.3) · #6 빈 배열 금지의 계약화 + 캐시 키 버전(§3.3, 타입 주석) · #7 노선별 단일 실행(§3.3) · #8 실패 종류별 쿨다운(§3.3) · #9 타임아웃(§3.3) · #11 출구 정규식 0 계열 거부(§4) · #12 출구를 경로 문맥으로(§4) · #13 게이트 기대 출구 번호 + 좌표 sanity(§4·§6) · #14 게이트 16역 골든 전수(§6) · #15 캐시·쿨다운 통합 테스트(§8) · #16 게이트 정규식 완전 일치(§6) · #17 게이트 실행 시점 명시(§6).

**결정(부분 채택·기각, 근거)**:
1. **#1·#14 "정본 stationID·이름을 코드에 버전으로 고정하고 정확히 일치할 때만 발행"** — 런타임 코드에는 두지 않는다. 그것은 데이터를 seed로 커밋하는 것이고 위원장 판정(2026-09-02 "ODsay 런타임 조회 + 캐시, 공개 저장소라 seed 커밋 금지")과 충돌한다. 골든은 **실호출 게이트**에 둔다(§6 1) — ODsay 데이터가 양방향 일관되게 틀린 경우를 잡는 축이 게이트로 옮겨진 것이며, 그 오류의 파급은 두 방향 다 기존 동작으로 강등된다(§3.2 끝). ⚠ 위원장 재판정 지점: 골든을 런타임에도 둘지(그러면 런타임 조회는 무효화 감지 전용이 된다).
2. **#4 "권위 있는 다이어 버전을 캐시 값에 포함"** — 그런 API가 없다. TTL 단축 + 게이트 주간 재관측으로 대체.
3. **#7 "외부 공유 저장소 잠금·전역 회로"** — 기각. 재시도 상한이 시간 창이 아니라 요청 수(일 수십 건)라 그 규모의 인프라가 정당화되지 않는다. 단일 실행 + 종류별 쿨다운으로 충분.
4. **#10 "검증 객체(`pattern`·`directionsVerified`·`sourceVersion`)"** — 기각(YAGNI). 표에 오르는 조건(§3.1)이 곧 그 객체이고, 복수 패턴 노선은 표에 오르지 못한다.
5. **#13 좌표 대조** — sanity(1km)로만. 좌표가 없으면 검사하지 않는다.

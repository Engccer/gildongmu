# data.go.kr envelope 공용화 설계 (2026-08-01)

백로그 D1. 레거시 감사(2026-07-30) 잔여 1건.

## 1. 문제 — 무엇이 몇 벌인가

data.go.kr 계열 provider 10개가 같은 envelope를 각자 해석한다. 실측 집계(2026-08-01):

| 중복 축 | 벌 수 | 위치 |
|---|---|---|
| items 추출 | **9** | `tago-bus.parseTagoItems` · `tago-subway.ensureItemArray` · `korail-facilities.parseStationItems` · `night-clinic.extractItems` · `air-quality.extractItems` · `weather.extractItems` · `tour-barrier-free.extractTourItems` · `holiday`(인라인) · `tour-api`(인라인) |
| resultCode 추출 | **7** | `air-quality.resultCode` · `tour-barrier-free.resultCode` · `night-clinic.header` · `tago-bus`·`tago-subway`·`holiday`·`tour-api`(인라인) |
| totalCount 추출 | **4** | `tago-bus.readTotalCount` · `seoul-metro-facilities.totalCount` · `night-clinic.header` · `tago-subway`(인라인) |
| JSON-or-XML 가드 | **3** | `tago-bus` · `air-quality` · `weather` |
| 게이트웨이 에러 가드 | **2** | `tago-bus` · `air-quality` |

합 25지점. 그런데 **줄 수보다 중요한 건 아래 두 결과**다.

### 1-1. 같은 모양을 9벌이 다르게 읽는다

| 벌 | 빈 판정 | `item`이 원시값일 때 | `items`가 직접 배열일 때 |
|---|---|---|---|
| tago-bus · korail | `!items \|\| items === ""` | **버림** | **[] (조용한 전멸)** |
| tago-subway · holiday | `items == null \|\| items === ""` | 감쌈 | [] |
| night-clinic · weather · tour-barrier-free | `!items \|\| typeof === "string"` | 감쌈 | [] |
| air-quality | 〃 | 감쌈 | **읽음** |
| tour-api | `items && typeof === "object"` | — | [] |

세 가지가 드러난다.

- **원시값 처리가 갈린다.** 절반은 버리고 절반은 감싼다. 감싸면 그 행은 모든 필드가 `undefined`인 유령 항목이 되어 목록에 빈 줄로 남는다. 시각 사용자에겐 빈 칸이지만 스크린 리더 사용자에겐 **이름 없는 항목**이다.
- **`items` 직접 배열을 8벌이 못 읽는다.** 에어코리아만 처리한다(2026-06-17 실호출로 발견). 다른 서비스가 같은 모양을 내면 8벌은 **예외 없이 빈 배열**을 돌려준다. 조용한 전멸은 3-state 불변식 위반이다("0건"과 "못 읽음"이 구분 불가).
- **`tour-api`만 단건 객체를 처리하지 않는다.** `items.item`을 `TourApiItem[]`으로 단정하고 `.map()`을 부른다. 같은 B551011 계열인 형제 `tour-barrier-free`는 바로 옆에서 "단일 객체/배열/빈문자열"을 명시적으로 처리한다. 같은 upstream 가족에 대해 두 파일이 모순되는 가정을 갖고 있었고, 어느 쪽이 맞는지는 **호출해 보기 전엔 알 수 없었다**(§8 실측 참조).

### 1-2. 가장 단단한 두 벌의 진단이 나머지에 없다

`tago-bus`·`air-quality`만 갖고 있는 방어:

- **`_type=json`인데 XML이 온다.** 키 만료·미신청 시 data.go.kr은 HTTP 200 + XML 본문을 준다. `res.json()`을 부르면 `Unexpected token '<'`라는 무의미한 SyntaxError가 나고, 원인(키)이 메시지에 없다.
- **게이트웨이 인증 에러 `OpenAPI_ServiceResponse`.** 서비스 응답이 아니라 게이트웨이 응답이라 `response.header`가 아예 없다. 미검출 시 `resultCode`가 `null`로 읽혀 "비정상 응답: resultCode null"이 된다.

나머지 6곳(`night-clinic`·`korail`·`tour-barrier-free`·`tour-api`·`holiday`·`seoul-metro-facilities`)엔 둘 다 없다. 이 앱의 반복 사고 패턴이 정확히 이것이다([[deepgram-prod-key-401]]·[[vercel-env-add-noninteractive-bug]]: "prod 502면 코드보다 키 등록 유효성을 먼저 의심"). 진단 문구가 없으면 그 의심이 늦어진다.

**따라서 이 작업은 DRY가 목적이 아니다.** 목적은 ①조용한 전멸·유령 항목 제거 ②두 벌만 가진 진단을 전 계열로 확산이다. 중복 제거는 그 수단이다.

## 2. 설계 — 모양은 합치고 정책은 남긴다

백로그의 경고가 정확했다: "설계 없이 합치면 조건 분기만 한 곳에 모인다." 그 경고를 피하는 선은 하나다.

> **합칠 것 = 응답의 모양(shape). 각 provider에 남길 것 = 그 서비스의 정책(policy).**

판별식: 서비스마다 답이 다르면 정책, 같으면 모양이다.

| 질문 | 답 | 판정 |
|---|---|---|
| `items`가 `""`면 빈 결과인가 | 전 계열 예 | 모양 |
| `item`이 단건이면 객체로 오나 | 전 계열 예 | 모양 |
| 원시값 `item`을 항목으로 볼까 | 전 계열 아니오 | 모양 |
| XML 본문을 어떻게 볼까 | 전 계열 장애 | 모양 |
| **정상 resultCode가 뭔가** | `"00"` / `"0"` / `"0000"` | **정책** |
| **NODATA 코드를 통과시킬까** | TAGO만 `"03"` | **정책** |
| **비정상일 때 throw인가 null인가** | holiday만 null | **정책** |
| **totalCount 초과를 막을까** | 3곳만 | **정책** |

모양은 8벌이 같은 답을 갖고 있으므로 **플래그 0개로** 하나가 된다. 정책은 진짜로 갈리므로 합치면 `okCodes: string[]`·`onError: "throw" | "null"` 같은 분기 주머니가 생긴다. 정책은 각자의 자리에 둔다. 그 자리엔 이미 왜 그런지를 적은 주석이 붙어 있고, 그 주석과 코드를 떼어놓는 것이 손해다.

### 2-1. 새 모듈 `src/lib/providers/datagokr-envelope.ts`

이름이 `datagokr.ts`가 아니라 `-envelope`인 것은 의도다. 이 파일이 "data.go.kr 관련 잡동사니"로 자라는 것을 이름이 막는다.

```ts
readItems(raw): Record<string, unknown>[]   // 모양 5종 흡수, 비객체 제외
readResultCode(raw): string | null          // response.header.resultCode
readResultMsg(raw): string | null           // response.header.resultMsg
readTotalCount(raw): number                 // response.body.totalCount, 없으면 0
fetchDataGoKrJson(url, { label, init }): Promise<unknown>
```

`fetchDataGoKrJson`이 하는 일은 넷뿐이고 **넷 다 모양이다**: HTTP 실패 throw(본문 발췌 포함) → `text()` → `JSON.parse` 가드 → 게이트웨이 에러 가드. **resultCode는 보지 않는다.** 정책이기 때문이다. 호출부가 받은 raw에 자기 정책을 적용한다.

`readItems`가 흡수하는 모양 5종:

| 입력 | 결과 | 근거 |
|---|---|---|
| `items` 부재·`null` | `[]` | 전 계열 |
| `items` 문자열(`""` 포함) | `[]` | data.go.kr 빈 결과 표기 |
| `items` 배열 | 그 배열의 객체 원소 | 에어코리아 실측(2026-06-17) |
| `items.item` 배열 | 그 배열의 객체 원소 | 표준 |
| `items.item` 단일 객체 | `[item]` | 1건 응답 |
| `items.item` 원시값 | `[]` | 레코드가 아니면 항목이 아니다 |

### 2-2. 행동 변화 3건 (전부 의도)

리팩터가 무행동일 수 없다. 갈렸던 것을 하나로 모으면 어느 쪽인가는 바뀐다. 셋 다 **더 정직한 쪽**으로 모은다.

| # | 대상 | 종전 | 변경 후 | 왜 안전한가 |
|---|---|---|---|---|
| 1 | tago-subway·night-clinic·weather·tour-barrier-free | 원시값 `item`을 `[item]`로 감쌈 | 버림 | 하류가 전부 `Record`로 캐스팅해 읽으므로 감싼 행은 전 필드 `undefined`인 유령 항목이다. 좌표·이름 필터에 걸려 대부분 탈락하지만 `korail`처럼 필터가 없는 곳은 빈 행을 낸다 |
| 2 | 에어코리아 외 8벌 | `items` 직접 배열 → `[]` | 읽음 | 종전 동작은 "데이터가 있는데 없다고 답함"이다. 관측된 적은 없지만 관측되면 조용히 틀린다 |
| 3 | tour-api | 단건 객체면 `.map is not a function` | `[item]` | B551011은 1건에도 배열을 유지해 **관측 범위에선 종전 가정이 참**이었다(§8). 방어의 근거는 실측된 고장이 아니라 "계열마다 다르고 미리 알 수 없다"는 §8의 발견이다 |

### 2-3. 스코프 밖 — 합치지 않는 것

| provider | envelope | 왜 제외인가 |
|---|---|---|
| `seoul-bus` (TOPIS) | `msgHeader.headerCd` + `msgBody.itemList` | `response` 래퍼 자체가 없다. 코드 의미도 다르다(`"4"`=정상 빈결과) |
| `seoul-subway-arrival` | `errorMessage.code` \|\| `code` + `realtimeArrivalList` | 정상·에러에서 코드 위치가 다르다 |
| `seoul-bike`·`seoul-elevator` | 서울 열린데이터 `<서비스명>.row[]` | 서비스명이 키라 경로가 서비스마다 다르다 |
| `odsay`·`kakao-*`·`tmap-*`·`ncp-*` | 각자 | data.go.kr 아님 |

이 넷을 같은 함수에 넣으려면 "어느 봉투인가"를 인자로 받아야 하고, 그게 곧 백로그가 경고한 분기 주머니다. **봉투가 다르면 파서도 다르다**가 이 설계의 경계선이다.

## 3. 변경 파일

| 파일 | 변경 |
|---|---|
| `providers/datagokr-envelope.ts` | 신규 |
| `providers/tago-bus.ts` | `parseTagoItems`·`readTotalCount` 삭제, `fetchTago`가 공용 fetch 사용. resultCode 정책 유지 |
| `providers/tago-subway.ts` | `ensureItemArray` 삭제. `"00"`/`"03"`·totalCount 정책 유지 |
| `providers/korail-facilities.ts` | `parseStationItems` 삭제 |
| `providers/seoul-metro-facilities.ts` | 로컬 `totalCount` 삭제, import 교체 |
| `providers/night-clinic.ts` | `extractItems`·`header` 삭제 |
| `providers/pediatric-clinics.ts` | import 교체 |
| `providers/air-quality.ts` | `extractItems`·`resultCode` 삭제, 공용 fetch 사용 |
| `providers/weather.ts` | `extractItems` 삭제, 공용 fetch 사용 |
| `providers/tour-barrier-free.ts` | `extractTourItems`·`resultCode` 삭제, 공용 fetch 사용 |
| `providers/tour-api.ts` | 인라인 추출 삭제(단건 결함 해소), 공용 fetch 사용 |
| `providers/holiday.ts` | 인라인 추출 삭제. null 정책 유지(try/catch가 흡수) |

## 4. 테스트 계약

- **신규** `providers/__tests__/datagokr-envelope.test.ts`: 모양 6종 · resultCode/Msg/totalCount 추출 · `fetchDataGoKrJson` 4경로(HTTP 실패·XML 본문·게이트웨이 에러·정상).
- **기존 fixture 테스트는 유지하되 호출만 교체**한다(`parseTagoItems(fixture)` → `readItems(fixture)`). 이 테스트들이 **공용화의 머지 게이트**다: 각 서비스의 실응답 fixture가 한 파서로 그대로 파싱되어야 통합이 성립한다. 별칭 재수출은 두지 않는다(이름만 둘이 된다).
- **변이 주입으로 검출력 확인**([[mutation-proves-test-detection-power]]): 계약 테스트가 있다는 사실이 그 축이 지켜진다는 뜻은 아니다.

## 5. 스코프 밖

- 정책 통일(허용 코드·throw/null 수렴) — 서비스별 계약이라 통일 대상이 아니다.
- `totalCount` 가드 확산 — 페이지네이션 정책이라 별건.
- 비-data.go.kr envelope(§2-3).

## 6. 변이 주입 (검출력 실측 2026-08-01)

계약 테스트가 있다는 사실과 그 축이 지켜진다는 사실은 다르다. 7종 주입, 6종 검출.

| 변이 | 결과 |
|---|---|
| `items` 직접 배열 분기 제거 | 계약 2 red **+ `air-quality.test.ts` 3 red** |
| 단건 `isRecord` 가드 제거 | 1 red |
| 배열 원소 `isRecord` 필터 제거 | 1 red |
| 게이트웨이 에러 가드 제거 | 1 red |
| `text()`+`JSON.parse` → `res.json()` | 4 red |
| `readResultCode`의 `String()` 제거 | 1 red |
| 빈 판정 `typeof === "string"` → `=== ""` | **green — 등가 변이** |

마지막 것은 검출 실패가 아니다. 문자열엔 `.item` 속성이 없어 두 판정이 모든 입력에서 같은 결과를 내므로 관측으로 구분할 수 없다(`typeof` 형태는 의도를 드러내려는 선택이지 동작 차이가 아니다).

첫 줄이 이 작업의 핵심 증거다: 공용화가 **에어코리아 고유 커버리지를 흡수하지 않았다**. 그 서비스의 실응답 fixture 테스트가 여전히 같은 결함을 독립적으로 잡는다.

## 7. 실호출 게이트 (2026-08-01)

| 계열 | 경로 | 결과 |
|---|---|---|
| TAGO 시내버스 | `/api/bus/nearby` 부산역 | 정류소 파싱·거리 정렬 정상 |
| 에어코리아 | `/api/air-quality/nearby` 길동 | 천호대로 0.9km, PM10 24 좋음 (**`items` 직접 배열 경로**) |
| 기상청 | `/api/weather/nearby` 길동 | 31.2℃·맑음 |
| 코레일 | `/api/station/facilities` 서울역 | 엘리베이터 18·리프트 1 |
| 서울교통공사 wksn | `/api/station/metro-facilities` 강동역 5호선 | elevator 그룹 정상 |
| TAGO 지하철 + 특일정보 | `/api/station/timetable` 강동역 5호선 | 첫차 05:32·막차 00:06(익일) |
| NMC 소아진료 | `/api/clinic/nearby` 길동 | 62m 의원부터 거리순 |
| TourAPI 무장애 | `/api/places/barrier-free` 시청 | 서울도서관 34m |
| TourAPI 검색(en) | `/api/places?lang=en&limit=1` | TourAPI·카카오 병합 정상 |

### ⚠ 실호출이 반박한 것 — 단건 응답 모양은 **계열마다 다르다**

초안은 "tour-api가 단건 응답에서 죽는다"고 썼는데 실호출이 그 전제를 무너뜨렸다. `numOfRows=1`로 4개 계열을 직접 재 보니:

| 기관코드 | `items.item` |
|---|---|
| B551011 (TourAPI) | **배열 유지**(길이 1) |
| B551457 (코레일) | **배열 유지**(길이 1) |
| B552657 (NMC 응급의료) | **단일 객체** |
| 1613000 (TAGO) | **단일 객체** |

즉 `tour-api`의 배열 단정도, `night-clinic`의 단건 방어도 각자의 계열에선 맞았다. **틀린 것은 어느 한쪽이 아니라 "계열을 보고 알 수 있다"는 생각**이었다. 새 API를 붙일 때 어느 쪽인지는 호출해 봐야 알고, 틀리면 증상이 런타임 TypeError(단건이 오는데 배열 단정) 또는 조용한 누락이다. 두 모양을 다 받는 파서가 그 질문 자체를 없앤다 — 이것이 공용화의 사후적 정당화 중 가장 강한 근거다.

## 8. 리뷰 처리 (별도 컨텍스트, 2026-08-01)

Critical 0 · Important 1 · Minor 0.

| # | 지적 | 처리 |
|---|---|---|
| Important 1 | `air-quality.test.ts`의 HTTP 실패 목에 `text`가 없어, 공용 fetch로 옮긴 뒤로는 그 테스트가 HTTP 500 판정이 아니라 `res.text is not a function` TypeError를 잡고 있었다. `.rejects.toThrow()`에 매처가 없어 green으로 보였다 | **수용.** 목에 `text` 추가 + `toThrow(/HTTP 500/)`로 메시지를 요구하게 바꿨다. 옛 목으로 되돌려 red를 확인했다(`expected … matching /HTTP 500/ but got 'res.text is not a function'`). XML 케이스에도 `/XML/` 매처를 붙였다 |

리뷰어가 확인한 것: provider 11곳의 허용 코드·throw/null 정책이 리팩터 전후로 1:1 보존됨, 공용 모듈에 `resultCode` 비교가 0건(정책 누수 없음), 에러 메시지의 진단 정보 손실 없음(오히려 본문 발췌가 추가됨).

이 지적이 값진 이유는 **내가 손댄 파일이 아니어서 놓쳤다**는 데 있다. 리팩터로 이동한 코드가 *다른 파일의* 테스트 전제를 무효화하는 유형이라, 변경 파일만 훑는 자기 검토로는 구조적으로 잡히지 않는다. 같은 유형(`ok: false` 목에 `text` 부재)을 전 테스트에서 전수 조사해 이 1건뿐임을 확인했다(나머지는 공용 fetch를 타지 않는 provider).

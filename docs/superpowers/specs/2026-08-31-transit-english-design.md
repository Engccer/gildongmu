# 대중교통 영문화 (E27) — 설계

> 백로그 [E27](../../BACKLOG.md). 위원장 판정(2026-08-31, `docs/superpowers/plans/2026-08-31-en-locale-korean-cleanup-parallel-plan.md` §1 판정 1·2·4)을 구현하는 설계. 병렬 세션 transit-en 소유 범위(같은 문서 §2).
>
> **설계 리뷰 판정**: 새 판정 계층(도착 문장 영어 생성·노선명 표)과 외부 계약 첫 정의(ODsay `lang=1`)를 담으므로 codex adversarial-review 대상(글로벌 규칙 ①·②). ✅ 2026-08-31 실행, 17건 — 반영 결과 §9(이 문서는 반영 후 판본이다).

## 1. 문제

비-ko 로케일(en·es·fr·it·ja)에서 대중교통은 구조(문장 틀)만 번역되고 **고유명은 전부 한국어**다: 경로 브리핑의 노선·역·정류소명(`수도권 5호선`·`천호`), 내 주변 지하철·역 상세의 노선명(`5호선`)·도착 문장(`3분 후`·`성수행 - 역삼방면`)·첫차막차 노선명. 영어 화면에서 한국어 데이터를 읽는 사용자는 두 부류다 — 시각 사용자는 한글을 못 읽고, 스크린 리더 사용자는 영어 엔진이 한글을 건너뛰거나 한국어 엔진이 영어 낱말을 읽는다.

원천은 있다: ODsay `searchPubTransPathT`는 `lang=1`로 역·노선·정류소를 영문으로 주고(한글은 `*Kor` 병기), 지하철역 seed는 영문 역명이 1,098/1,098이며, 전국 지하철 노선명은 닫힌 집합(seed 고유값 47)이다. 없는 것은 **버스 정류소의 영문(내 주변)·실시간 도착 문장의 영문**이고, 전자는 E28(로마자), 후자는 이 설계(코드 기반 생성)가 맡는다.

## 2. 실호출 관측 (2026-08-31, 이 설계의 근거)

### 2.1 ODsay `lang=1` (5개 경로 조회: 길동→강남·홍대입구→판교·부산 서면→해운대·길동→하남·김포→마곡)

- **영문 결측 0**: 636개 역·정류소 이름 전부 `stationName`(영문)·`stationNameKor`(한글) 쌍으로 온다. `startName/startNameKor`·`endName/endNameKor`·`firstStartStation/firstStartStationKor`·`lastEndStation/lastEndStationKor`·lane `name/nameKor`·`busNo/busNoKor` 전부 관측.
- **급행 표지가 영문에서 사라진다**: `nameKor:"수도권 9호선(급행)"` → `name:"Line 9"`(완행도 `Line 9`). 따라서 `subwayLineCore`(실시간 매핑)·`subwayHoursKey`(운행시간)·`findQuickExit`(빠른하차)·`normalizeStationName`(역명 조인)은 **전부 한글**로 해야 한다.
- **ODsay 영문 노선명은 공식 표기가 아니다**: `Suin·Bundang Line`(가운뎃점 — 일부 SR이 낱말로 낭독, 헌장 금지 구분자)·`Busan 1 Line`(공식은 Busan Line 1)·`Airport Railroad`(브랜드는 AREX). 노선명은 우리 표가 정본이고 ODsay 영문은 쓰지 않는다(§3.3).
- **버스 정류소 영문 품질**: 복합명 구분자가 `. `/` & `/`, ` 혼재(`Gil-dong Sageori. Gangdong District Tax Office`·`Dangsan Stn. & Samsung Raemian Apt.`·`Centum City Station, BEXCO`), `Station`/`Stn.` 혼용, `ㆍ` 잔존(`Kyungsung Univ.ㆍPukyong Nat'l Univ.`), 겹친 마침표(`Hanyang Apt.. Apgujeong Rodeo Station`), 음차(`Sageori`·`Geomchalcheong`). 지하철역 영문에도 `Stn.`이 있다(`Gwanghwamun Stn.`).
- **한글 `*Kor`는 ko 모드 `name`과 같은 값이다**(§3.8 게이트가 전수 대조): 조인 키가 ko·en 응답에서 갈리지 않는다. ⚠ 이 관측은 표본 5경로의 증거일 뿐 계약이 아니다 — 런타임 검증은 §3.1이 맡는다.
- **`lang=1`은 URL이 달라 `revalidate` 캐시 항목이 분리된다**. 이 provider의 캐시 계층은 그 fetch 캐시 하나뿐이다(라우트에 `revalidate` 없음·`unstable_cache` 없음, 운행시간 캐시는 한국어 키라 언어 무관).

### 2.2 서울 지하철 실시간 도착 `arvlMsg2` 변형 (강남·천호·홍대입구·서울역 실호출 + fixture)

| `arvlCd` | 관측 문장 | 비고 |
|---|---|---|
| 0 | `강남 진입` | `{역} 진입` |
| 1 | `강남 도착`·`서울 도착` | `{역} 도착` |
| 2 | `서울 출발` | `{역} 출발` |
| 3 | `전역 출발` | 고정 |
| 4 | (미관측, 명세) `전역 진입` | 고정 |
| 5 | `전역 도착` | 고정 |
| 99 | `7분 후`·`2분 30초 후`·`5분 후 (종각)`·`8분 후 (이촌)`·`[3]번째 전역 (청계산입구)`·`[12]번째 전역 (청량리)` | 분·초·잔여역 + 괄호 현재역 |

`trainLineNm`은 `{종착}행 - {방면}방면` 고정이고 급행은 꼬리 ` (급행)`(`팔당행 - 서강대방면 (급행)`), 방면에 노선 괄호가 붙는 변형이 있다(`문산행 - 신촌(경의중앙선)방면`). `updnLine`은 `상행`·`하행`·`내선`·`외선` 4값. `bstatnNm`·`arvlMsg3`(현재역)·괄호 안 역명은 전부 seed 역명과 정규화 매칭된다(`normalizeStationName` — 괄호 부가명 제거·"역" 접미 제거).

## 3. 설계

### 3.0 원칙 셋

1. **기존 필드는 한국어 그대로, 영문은 additive `*En`.** `lang=en` 응답에서도 `lineName`·`fromName`·`toName`·`stops[].name`·`departName`·`arriveName`·`SubwayArrival.line/message/trainLineNm/direction`·`StationMeta.lines`·`TimetableLine.lineName`은 한국어 원문이다. 그래서 **조인 경로(운행시간·빠른하차·실시간 추적·역명 매칭·TAGO routeNo)는 한 줄도 바뀌지 않는다**. ⚠ 이 불변식은 "한국어 자리에 한국어만 들어간다"가 성립할 때만 참이다 — §3.1의 `*Kor` 완전성 검증이 그 조건을 강제한다(리뷰 #1). 구서버+신앱·신서버+구앱 어느 조합에서도 종전 동작이다.
2. **영문은 서버 한 곳에서 만든다**(노선명 표·정류소명 정규화·도착 문장). 영문은 UI 언어가 아니라 **데이터 언어**다(`dataLocale` — en·es·fr·it·ja가 같은 영문 데이터를 공유) — A26의 "클라이언트가 자기 언어로 조립"은 로케일별로 문장이 갈리는 접미·조립문에 대한 규칙이고, 여기서는 6로케일 중 5개가 같은 영문 문자열을 본다. 게다가 seed(영문 역명)는 서버 전용이라 클라이언트는 어차피 서버 투영 없이는 문장을 못 만든다. Kit 미러(`SubwayLineName.swift`·`SubwayArrivalText.swift`)는 두지 않는다 — 코디네이터 착수 프롬프트와 다른 점이며 §7에서 근거를 남긴다.
3. **`lang=en`을 요청한 응답에만 실린다.** `lang` 부재·`ko`는 종전 코드 경로 그대로(byte-identical) — CLI/MCP·채팅은 `lang`을 보내지 않으므로 무변화.

### 3.1 `/api/route/transit` — `lang` → ODsay `lang=1` → `*En`

- 쿼리 `lang`: walk `route-schema.ts` 동형(`z.union([ko, en, null])`, 미지 값은 400 — 조용한 ko 강등 금지). 라우트 로컬 스키마에 추가.
- `getTransitRoute({ origin, dest, includeStops, lang })`: `lang === "en"`이면 URL에 `&lang=1`.
- **`*Kor` 완전성 검증(fail-closed, 리뷰 #1·#8·#12)**: `lang=1` 응답을 정규화하기 전에 `assertKorComplete(data)`가 전 path의 `firstStartStationKor`·`lastEndStationKor`, 전 탑승 subPath의 `startNameKor`·`endNameKor`·lane `nameKor`(지하철), 전 `passStopList.stations[].stationNameKor`가 **비어 있지 않고 한글을 포함**하는지, 버스 `busNoKor`는 **존재**하는지(번호 `"3413"`엔 한글이 없다) 본다. 하나라도 어긋나면 **영문 응답을 버리고 ko 모드(`lang` 없는 URL)로 재조회**해 그 결과를 `*En` 없이 돌려준다(캐시가 있어 대부분 무비용, 최악 +1콜). `console.warn`으로 결측 필드 경로를 남긴다(개인정보 없음). 영문 값이 한국어 필드에 들어가는 경로는 **존재하지 않는다** — 그래서 원칙 1이 구조로 성립한다.
- 정규화(`normalizeOdsayRoutes(data, { includeStops, lang })`): 검증을 통과한 en 응답에서만 **한글(`*Kor`)을 기존 필드에, 영문을 `*En`에** 싣는다. `*Kor` 부재(ko 모드)면 종전과 같은 객체.
- `*En` 값 자격: `normalizeTransitNameEn` 결과가 비어 있지 않고 **한글을 포함하지 않아야** 싣는다(리뷰 #12 — 필드 존재 ≠ 영문). 자격 미달은 그 필드 부재.
- 필드 대응(전부 optional, en 응답에만):

| 기존(한국어) | 신규 `*En` | 값 |
|---|---|---|
| `TransitLeg.lineName` | `lineNameEn` | 지하철: `subwayLineNameEn(nameKor)`(표 미스면 **부재** — ODsay 영문 폴백 없음, 리뷰 #11) / 버스: `busNo`(영문 그대로, 위원장 판정 "버스 번호는 그대로") |
| `TransitLeg.fromName`·`toName` | `fromNameEn`·`toNameEn` | `normalizeTransitNameEn(startName/endName)`. 도보 leg의 `toName`(뒤 탑승 `fromName` 유도)도 같은 규칙으로 `toNameEn` 유도 |
| `TransitLegStop.name` | `nameEn` | `normalizeTransitNameEn(stationName)` |
| `summary.departName`·`arriveName` | `departNameEn`·`arriveNameEn` | `normalizeTransitNameEn(firstStartStation/lastEndStation)` |

### 3.2 정류소·역 영문 표시 정규화 `normalizeTransitNameEn` (`src/lib/transit-name-en.ts`, 순수)

위원장 판정: 구분자·약어만 손댄다. 음차·오타는 데이터 현실. 규칙(순서가 계약, 멱등):

1. `ㆍ`·`·`·`､` → `, `
2. `..` → `.`(겹친 마침표)
3. `\bStn\.` → `Station`
4. **구분자 `. `** → `, ` — 단 다음 앞 토큰 뒤는 예외(원문 보존): 약어 목록(`Apt`·`Univ`·`Nat'l`·`Edu`·`St`·`Mt`·`Jr`·`Sr`·`Dr`·`Co`·`Dept`·`Elem`·`Bldg`·`Ave`·`Rd`·`Blvd`·`Ctr`·`Hosp`·`No`·`Gen`·`Bros`·`Inc`·`Ltd`·`II`·`III`), **대문자 한 글자 이니셜**(`U.S. Army`·`J. Kim`), **숫자**(`Complex 3. 4`는 원문 그대로 — 판단 근거 없음). 한글 원문이 `.`로 잇는 복합명은 이 규칙으로 쉼표가 되고(`Gil-dong Sageori, Gangdong District Tax Office`), 약어 뒤 `. `는 그대로 둔다(`Jamsil Parkrio Apt. Shopping Area`). 불확실하면 보기 좋은 오답보다 원문 보존(리뷰 #13).
5. ` & `·`, ` 유지.
6. 연속 공백·양끝 공백 정리, `, ,`·`,,` 중복 정리.

알려진 한계(수용): `Hanyang Apt.. Apgujeong` → `Hanyang Apt. Apgujeong Rodeo Station`(약어 뒤 실제 구분자는 사라진다). 한글 괄호 병기는 **시각 사용자에게만** 반증 채널이다(리뷰 #14 — SR 사용자에겐 숨겨진다). fixture `transit-name-en-cases.json`(§2.1 관측 표본 + 경계·멱등·이니셜·숫자 케이스)로 단위 테스트. 서버 투영 시 한 번만 적용한다.

### 3.3 노선명 영문 표 `subwayLineNameEn` (`src/lib/subway-line-names.ts`, 순수)

- 입력 정규화 `lineKey(ko)`: 양끝 공백·연속 공백 정리 → 선두 `수도권 ` 제거 → `.` 제거(`수인.분당선`) → 꼬리 `(급행)` 분리(플래그). 그 밖의 지역 접두(`서울 `·`부산 `·`대구 `·`인천`…)는 **벗기지 않는다** — 표에 그 표기 그대로 둔다(seed 고유값 47을 그대로 키로 쓴다).
- 표: 서울교통공사·각 도시철도 공식 영문(하이픈 표기 — en dash `–`는 낭독 미확인이라 쓰지 않는다. `Gyeongui-Jungang Line`·`Suin-Bundang Line`·`Ui-Sinseol Line`·`Ansan-Gwacheon Line`·`Busan-Gimhae LRT`). `1~9호선`·`도시철도 9호선`·`서울 도시철도 9호선` → `Line N`, `도시철도 7호선` → `Line 7`, `광역철도 8호선` → `Line 8`, `경량도시철도 신림선` → `Sillim Line`, `경부선`·`경원선`·`경인선`·`일산선`·`장항선`·`진접선`·`안산과천선` → `Gyeongbu Line`…(seed가 코레일 선로명을 노선명으로 두는 역이 있어 표에 있어야 한다), `공항철도`·`인천국제공항선` → `AREX`, `김포도시철도`·`김포골드라인` → `Gimpo Goldline`, `의정부` → `Uijeongbu LRT`, `에버라인` → `EverLine`, `자기부상철도` → `Incheon Airport Maglev`, `부산 (경량)도시철도 N호선`·`부산 N호선` → `Busan Line N`, `대구 도시철도 N호선` → `Daegu Line N`, `대전 도시철도 1호선` → `Daejeon Line 1`, `광주도시철도 1호선` → `Gwangju Line 1`, `인천지하철 N호선`·`인천 N호선` → `Incheon Line N`, `대경선` → `Daegyeong Line`, `동해선` → `Donghae Line`, `GTX-A` → `GTX-A`.
- 급행 플래그는 ` Express` 접미(`Line 9 Express`) — ODsay 영문이 잃는 표지를 우리 표가 되살린다.
- 미지 입력은 **null**(조용한 음차·provider 폴백 금지) — 모든 소비자가 같은 정책이다: 부재 → 한국어 원문 줄(리뷰 #11). 서버는 미지 키를 프로세스당 1회 `console.warn`으로 계측한다(리뷰 #10·#17).
- **drift 테스트(리뷰 #10 — 생산자 기준)**: 표에 넣는 최종 입력을 **실제 호출 지점이 넘기는 값**으로 모은다 — ①seed `lineName` 고유값 전수 ②`SUBWAY_LINES`(실시간 subwayId 표) 값 전수 ③`ODSAY_SUBWAY_LINES` 키 전수 ④§2.1 관측 ODsay `nameKor` 목록(fixture, `(급행)` 포함) ⑤`tago-subway` fixture의 `routeName`에 `displayLineName`을 통과시킨 값 전수. 전부 non-null이어야 한다.
- 적용 면(서버 투영, 전부 `lang=en`에서만): transit leg `lineNameEn`(§3.1) · 실시간 도착 `SubwayArrival.lineEn` · 내 주변 `NearbySubwayStation.linesEn`·`NearestSubwayStation.linesEn` · 역 메타 `StationMeta.linesEn` · 시간표 `TimetableLine.lineNameEn`(`displayLineName` 결과를 표에 통과). 배열형은 **원소 단위 폴백 없이 배열 전체가 있거나 없다** — 하나라도 null이면 `linesEn` 부재.

### 3.4 지하철 도착 영어 문장 `subway-arrival-en.ts` (서버, 순수 + seed 조회 주입)

`enrichArrivalEn(arrival, ctx)`가 `SubwayArrival`에 필드를 더한다. 각 필드는 독립이고, **줄 단위 원자성은 소비자(§3.6)가 든다**.

| 필드 | 원천 | 생성 |
|---|---|---|
| `lineEn` | `line` | `subwayLineNameEn` |
| `directionEn` | `direction` | `상행` Up · `하행` Down · `내선` Inner Circle · `외선` Outer Circle. 그 외 값은 부재 |
| `trainLineNmEn` | `trainLineNm` | `^(.+?)행 - (.+?)방면(?: \(급행\))?$` → 종착·방면 각각 `ctx.stationNameEn`. `To {Dest} via {Via}`. 급행 꼬리는 버린다(`express` 필드가 따로 있다) |
| `messageEn` | `arrivalCode` + `message` | **코드×문장 정확 행렬(리뷰 #4)**: `0`↔`^(.+?) 진입$` → `Approaching {S}` / `1`↔`^(.+?) 도착$` → `Arrived at {S}` / `2`↔`^(.+?) 출발$` → `Departed {S}` / `3`↔`전역 출발` → `Departed previous station` / `4`↔`전역 진입` → `Approaching previous station` / `5`↔`전역 도착` → `Arrived at previous station` / `99`↔`^(\d+)분(?: (\d+)초)? 후(?: \((.+)\))?$` → `In {N} min`·`In {N} min {M} sec` / `99`↔`^\[(\d+)\]번째 전역(?: \((.+)\))?$` → `{K} stations away`(`1 station away`). 코드와 문장 모양이 어긋나면 부재. **수치 유효성(리뷰 #7)**: 분 ≥ 1, 초 0~59, 잔여역 ≥ 1 — 벗어나면 보정하지 않고 부재. **괄호 현재역은 `messageEn`에 넣지 않는다**(리뷰 #5) — 아래 `currentLocationEn`의 원천이다 |
| `currentLocationEn` | `currentLocation`(arvlMsg3), 없으면 99 문장의 괄호 역명 | `ctx.stationNameEn`. 둘 다 있고 정규화 역명이 다르면 부재(모순은 침묵) |

- ⚠ `barvlDt`(초)는 쓰지 않는다(CLAUDE.md 함정: 운행종료에도 비0).
- **seed 조회 `stationNameEn(ctx, name, lineKo)`**(리뷰 #6): `findStationsByName(name, lineHint)`(괄호 노선 힌트 `신촌(경의중앙선)`은 직접 뽑아 넘긴다) 후보 중 **도착 노선과 같은 노선인 후보를 우선**하고 — 같은 노선 판정은 영문 표 동치(`공항철도` ↔ seed `인천국제공항선` = AREX, §8 게이트 검출) → 코어 접두 일치(`lineHintMatches`) 두 겹 — 없으면 전체 후보(1호선 열차의 종착 `동두천`은 seed `경원선` 행이라 노선 필터를 강제할 수 없다). 남은 후보의 `nameEn`을 대소문자 무시로 모아 **둘 이상이면 null**(추측 금지). 잔여 위험(수용): 같은 이름의 타 도시 역만 seed에 있고 진짜 역이 없는 경우 — 서울 실시간 커버 역은 전부 수도권 seed에 있어 실측상 성립하지 않는다.
- 순수 함수는 seed 없이 fixture로 테스트한다(라우트가 seed 바인딩을 주입). fixture `subway-arrival-en-cases.json`: §2.2 표 전 행 + 코드/문장 불일치 + 수치 범위 밖 + 미매칭 역 + 방면 괄호 노선 힌트 + `updnLine` 미지 값 + 괄호 현재역 vs arvlMsg3 모순.
- 계측(리뷰 #17): 코드·문장 모양이 행렬 밖이면 `console.warn`(문장 모양만, 역명은 제외) 프로세스당 모양별 1회. 실시간 API가 문구를 바꾸면 조용한 한국어 강등 대신 로그가 남는다.

### 3.5 라우트 `lang` 파라미터 (5곳, 전부 zod `ko|en|null`, 미지 값 400)

| 라우트 | en에서 더해지는 것 |
|---|---|
| `/api/route/transit` | §3.1 |
| `/api/station/subway-arrival` | 각 `arrivals[].{lineEn,directionEn,trainLineNmEn,messageEn,currentLocationEn}` |
| `/api/station/subway-arrival/nearby` | `stations[].linesEn`·`nearest.linesEn` + 각 arrival 위 필드 |
| `/api/station/meta` | `meta.linesEn` |
| `/api/station/timetable` | `lines[].lineNameEn` |

`lang` 미지정 응답은 종전과 byte-identical(각 라우트 테스트가 ko 스냅샷으로 단언). 캐시 계층(리뷰 #9): 이 다섯 라우트 중 fetch 캐시를 쓰는 것은 transit(ODsay URL에 `lang=1` 포함)·meta(`revalidate` 라우트 — Next는 검색 파라미터가 다르면 별도 항목)뿐이고, 도착·nearby는 `no-store`, timetable은 TAGO 캐시가 한국어 키라 언어 무관이다. 라우트 테스트가 ko→en→ko 순서로 같은 프로세스에서 호출해 응답 격리를 본다.

### 3.6 클라이언트 소비 (표시 전용, 조인 무관)

**줄 단위 원자성(리뷰 #2)**: 한 접근성 객체(한 줄) 안에서 언어를 섞지 않는다. 웹은 공용 헬퍼 `pickLine(isEn, ko: string, enParts: (string | undefined)[], build: (parts: string[]) => string): { text: string; lang: "ko" | "en" }` — `isEn`이고 `enParts`가 **전부** 있을 때만 영어 줄, 아니면 한국어 줄. 줄을 만드는 모든 자리(`place-lines/*`·컴포넌트 헤딩)가 이 헬퍼만 지나고, 테스트는 조각 하나를 빼는 변이로 한국어 폴백을 확인한다. iOS는 같은 계약의 `pickLine(isEn:ko:enParts:build:)`(Kit, 새 파일 `TransitDisplay.swift`).

**언어 태그(리뷰 #3, a11y 감사 #4)**: 웹은 줄의 `lang`을 마크업에 단다 — **한국어 폴백 줄은 언제나 `lang="ko"`**(UI 라벨이 섞여도 값이 한국어인 줄은 통째로 ko, A26 선례), **순수 데이터 영어 줄**(도착 편성 줄, 역 메타 영문 이름 줄)은 UI 로케일이 en 계열이 아닐 때 `lang="en"`(ja 화면에서 `Gangnam`을 일본어 음성으로 읽지 않게). UI 문장 틀과 영어 데이터가 한 줄에 섞이는 영어 줄(`about 350m`·`Board <line> at <from>`·`Now at {station}`)은 태그를 달지 않는다(분절 없이 못 달고, 분절은 헌장 위반 — E28 재료로 남긴다). `pickLine`의 조각 3-state: `undefined`=결측(→ 한국어 폴백), `""`=자리 표시(ko에도 없는 조각 — 노선 미매핑·현재역 부재, 영문 요구 대상 아님), 문자열=영문(a11y 감사 #1 — 종전엔 `""`를 결측으로 봐서 영문이 있는데도 한국어로 떨어졌다). iOS 언어 태깅은 이 마일스톤 밖(§6).

**병기(위원장 판정 4)**: 이름이 단독으로 서는 자리는 `Gangnam (강남)` — 웹은 `English<span lang="ko" aria-hidden="true"> (한글)</span>`, iOS는 `Text(visual).accessibilityLabel(englishOnly)`. 접근 가능한 이름은 영문뿐이고 괄호 한글은 **시각 전용 정보**다(리뷰 #14 — 안전망으로 계산하지 않는다). 조립 헬퍼는 E28(`bilingual-name.ts`·Kit `BilingualName.swift`)이 정본이고, 통합 시점에 main에 있으면 그것을 쓰고 없으면 같은 계약(`bilingualName(primary, ko)`)의 최소 구현을 자기 소유 파일에 두고 코디네이터에 신고한다. 병기가 한 객체로 읽히는지는 a11y-auditor(Chrome 접근성 트리)로 확인하고 실기기 VoiceOver 판정은 E28과 함께 등재한다.

| 자리 | 변경 |
|---|---|
| 웹 `TransitRouteBriefing` | fetch URL에 `lang=${dataLocale(locale)}`(종전 주석 "ODsay 무료 티어 국문 전용"은 실측으로 폐기). `TransitRouteResult`: 탑승 leg 줄은 노선·승차명·하차명이 **다** 영문일 때만 en(iOS와 같은 조건 — 하차명은 빠른하차 줄에 쓰인다; 승차명 병기), `arrive`는 병기. **도보 `toName`은 병기 없이 영문만** — `{name}` 문자열 자리라 괄호 span을 넣을 수 없고, 문장 안 이름은 위원장 판정 4의 "단독으로 서는 자리"가 아니다(iOS `transitLegLine` walk 동형). `lang="ko"` span은 한국어 폴백에만 |
| 웹 `DirectionsView` (소유 밖, 1줄 — 자진 신고) | 대중교통 fetch URL `&lang=${dataLocale(locale)}`; 본문은 `TransitRouteResult`를 쓰므로 자동. `transitRouteLabel`은 요약(분·원·환승)뿐이라 무변경 |
| 웹 `SubwayArrivalList`·`place-lines/station-arrivals.ts` | `arrivalItems(arrivals, t, isEn)` → 항목 줄마다 `{text, lang}`. 편성 줄 = `lineEn directionEn, trainLineNmEn, Express`, 메시지 줄 = `messageEn(, Now at {currentLocationEn})`(현재역이 있는데 영문이 없으면 그 줄은 한국어) |
| 웹 `SubwayArrivalsNearby` | fetch URL `lang`; 헤딩 `pickLine`(병기 역명 + `linesEn` + 거리 — 노선 영문이 없으면 헤딩 전체 한국어 역명·노선); `emptyNearest`도 같은 규칙 |
| 웹 `StationMeta`·`place-lines/station-meta.ts` | fetch URL `lang`; en 이름 줄은 `nameEn (한글)` 병기 + `lang="en"`(비-en 로케일), 노선 줄은 `pickLine` |
| 웹 `StationTimetable`·`place-lines/station-timetable.ts` | fetch URL `lang`; `lineNameEn ?? (lineCore ? lineSuffixed : lineName)` — 한 줄에 종착 `terminusEn`도 있으므로 두 조각을 `pickLine`으로 |
| iOS Kit 모델 | `TransitRouteLeg`·`TransitLegStop`·`TransitRouteSummary`·`SubwayArrival`·`NearbySubwayStation`·`NearestSubwayStation`·`StationMeta`·`TimetableLine`에 optional `*En` 디코딩(⚠ 선언하지 않으면 값이 오지 않는다 — RouteModels 주석의 계약) |
| iOS Kit `RouteService.transit(…, lang:)` | **기본값 없는 필수 인자**(walk·car 규율). 호출 2곳(`DirectionsTabView:507` — 소유 밖 1줄 자진 신고, `TransitGuideModel:427`) |
| iOS Kit `StationService.meta/arrivals/timetable`·`NearbyService.subwayArrivals` | `lang` 인자 추가(같은 규율: 기본값 없음). 호출부는 `AppLanguage.dataLocale` |
| iOS `RouteBriefing.transitLegText` | `pickLine` + 병기. `accessibilityLabel`은 영문 줄 |
| iOS `SubwayNearbyView`·`StationSections` | 헤딩·도착 줄·메타 줄·시간표 노선명에 위 규칙. ⚠ iOS 도착 항목은 `Text` 하나(편성+메시지)가 한 객체라 **원자 단위도 한 건 전체**다 — 다섯 조각이 다 있을 때만 영어(웹은 두 `div`라 줄마다) |

### 3.7 안내 상태 머신 — 이 마일스톤 밖 (리뷰 #15 반영)

실시간 대중교통 안내의 en 게이트(웹 `!prefersEnglish`·iOS `dataLocale == "ko"`)가 닫혀 있어 `TransitGuideLeg` 표시 라벨은 도달 가능한 사용자가 없는 죽은 배선이고, 반대로 게이트를 여는 날엔 `viaStops[].name`·실시간 provider 정류소명·차량 선택 문맥까지 별도 display DTO가 필요하다. **게이트 해제 마일스톤으로 통째로 미룬다**(BACKLOG E27 잔여). 그때의 불변식은 "상태 머신 테스트가 조인 필드에 식별 가능한 한국어 sentinel을 넣고 어떤 발화에도 그 값이 나오지 않는다"이다. ⚠ A27(§3.9)이 상태 머신에 더한 `lastArrivalCode`·이벤트 `arrivalCode`는 이 축이 아니다 — 언어 무관의 문장 **종류** 판정이고 조인 필드·라벨은 불변이다.

### 3.9 A27 — 승차 국면 지하철 상태줄 (코디네이터 추가 배정, 위원장 실승차 피드백 2026-08-29)

탑승 직후 상태줄 "충정로까지 전역 도착"이 부자연스럽다는 피드백. 원인: `transitGuide.messageFrame`("{stop}까지 {message}.")은 버스 완성 문장("2분 남음")을 전제한 틀인데, 지하철 `arvlMsg2`("전역 도착"·"[3]번째 전역")는 조회역(=하차역) 기준 **열차 위치 서술**이라 "까지"가 앞에 붙으면 뜻이 뒤집힌다. 버스는 승차 국면 재작성(`rewriteBusArrivalMessage`)이 있고 지하철은 없었다.

- **ko도 코드 기반 문장으로 바뀐 근거 = A27.** 순수 함수 `subwayRidingMessage(arrivalCode)`(웹 `transit-guide.ts` ↔ Kit `TransitGuide.swift`, 공유 fixture `subway-riding-message-cases.json`): 3·4·5 → `transitGuide.subwayNextStop`("다음 역 {stop}.") · 0 → `subwayArriving`("{stop} 진입 중.") · 1 → `subwayAtStop`("{stop} 도착.") · 2 → `subwayDeparted`("{stop} 출발." — 하차역을 지나친 신호. 상태 머신의 도착 판정은 코드 1만 보므로 충돌 없음) · 99 → 생략(`remainingCount`가 잔여 수를 말한다) · 미지·결측 → `arvlMsg2` 원문을 **까지 틀 없이** 그대로(3-state 폴백). 6로케일 키.
- 상태 머신에 `lastArrivalCode`(state)·`arrivalCode`(`trackingStarted`·`countdown`·`messageChanged`·`backOnTrack` 이벤트)를 additive로 더한다 — 소비자(웹 `useTransitGuide.frameText`·iOS `TransitGuideModel.frameText`)가 문장을 고르는 유일한 축. §3.7의 "표시 라벨 배선 금지"와 다른 축이다: 이건 영문 표시가 아니라 ko·en 공통의 문장 **종류** 판정이고, 도달 가능한 사용자(ko 실승차)가 있다.
- 경계: 대기 국면 후보 목록(`approachFrameText`)·내 주변 역 도착 목록은 완성 문장 정본 불변. 버스 승차 국면은 종전 `messageFrame` 그대로. `frameText`의 `arrivalCode` 인자에 기본값 없음(`slotToItem` 선례).

### 3.8 실호출 게이트 `scripts/verify-odsay-lang.mjs`

`verify-odsay-transfer-door.mjs` 동형(esbuild로 provider를 그대로 태운다). **게이트는 관측 증거이고 계약의 정본은 §3.1 런타임 검증이다**(리뷰 #8). 경로 셋 — 길동→강남(지하철 3구간)·**김포공항→신논현(9호선 급행 필수 표본** — 급행 lane이 없으면 게이트 자체가 FAIL)·길동→하남(버스 정류소 복합명) — 을 `lang: "en"`·`lang: "ko"`로 조회해 단언:

1. en 응답의 탑승 leg·stops·summary에 `*En` 결측 0, 값에 한글 0.
2. en 응답의 한국어 필드(`lineName`·`fromName`·`toName`·`stops[].name`·`departName`·`arriveName`)가 같은 경로의 ko 응답과 **전수 일치** — 짝은 `routeKey`가 아니라 언어 무관 서명(탑승 leg의 `mode`·`stationCount`·`serviceWayCode` 수열 + `totalMinutes`·`fare`)으로 맺고, 짝이 안 맺히는 경로가 있으면 FAIL(호출 시점 차로 경로 집합이 달라진 것도 관측으로 남긴다).
3. 급행 표본에서 `lineName`에 `(급행)` 보존·`lineNameEn === "Line 9 Express"`(선정 5개 밖이어도 정규화 전체 배열에서 본다).
4. `*En` 어디에도 `ㆍ`·`Stn.`·`..`이 없고, `. `는 §3.2 예외 토큰 뒤에만 남는다.
5. en 지하철 leg의 `lineNameEn` 결측 0(표 미스 0).
6. ko 응답(`lang` 미지정)에 `*En` 키가 하나도 없다.
7. **실시간 도착 관측**(리뷰 #17): 강남·서울역 `lang=en` 조회에서 도착 항목의 `messageEn`·`trainLineNmEn` 생성률 100%(오늘 문구가 전부 행렬 안이라는 증거).

결과는 §8에 기록.

## 4. 3-state·접근성 정합

- 영문 부재는 **필드 부재**이지 빈 문자열·음차가 아니다. 소비자는 부재를 "한국어 원문 + `lang="ko"`"로 읽는다(종전 화면과 동일) — 3-state 위장 없음.
- 한 줄 한 객체: 줄 안 언어 혼합 금지는 줄을 만드는 자리마다 같은 규칙(영문 조각 전부 있을 때만 영어)을 지키고 변이 테스트가 잠근다(§3.6 — `pickLine`·`TransitDisplay.pickLine`이 공용 헬퍼이고, 탑승 leg·nearby 헤딩·시간표는 조각 구조가 달라 같은 규칙의 지역 판정이다. 새 자리를 만들면 이 규칙과 테스트를 함께 둔다). 병기 괄호부는 `aria-hidden` + `lang="ko"`라 접근 가능한 이름에서 빠진다.
- 도착 영어 문장은 서버 데이터라 웹·iOS·6로케일이 같은 문자열을 본다(플랫폼 간 갈림 0).
- 거짓 문장보다 부재를 택한다: 코드×문장 행렬·수치 범위·역명 모호·모순 현재역은 전부 부재.

## 5. 구현 순서 (plan)

1. `transit-name-en.ts` + fixture + 테스트 → 2. `subway-line-names.ts` + drift 테스트(생산자 5축) → 3. `odsay.ts` `lang`·`*Kor` 검증·`*En` 투영 + `lang=1` fixture(`odsay-lang1.json`, §2.1 응답 절단본) + 정규화 테스트(ko byte-identical·`*Kor` 결측 변이 → ko 재조회 포함) → 4. `/api/route/transit` `lang` + 라우트 테스트 → 5. `subway-arrival-en.ts` + fixture + 테스트 → 6. 도착·nearby·meta·timetable 라우트 `lang` + 테스트 → 7. 웹 `pickLine`·병기 헬퍼 + 컴포넌트 6곳 → 8. iOS Kit 모델·서비스·`pickLine` + 앱 표시 5곳 + 시뮬 빌드 → 9. `verify-odsay-lang.mjs` 실행·기록 → 10. 리뷰(spec-compliance·code-quality·a11y-auditor) → 11. 문서 분배(CHANGELOG·BACKLOG E27 종결+잔여·CLAUDE.md 함정·INTEGRATIONS §대중교통·§서울 지하철 실시간) → 12. 통합(rebase·게이트·ff push).

구현 방식 판정: 순차 의존이 강하다(1·2 → 3 → 4·6 → 7·8) — inline. 리뷰만 분리.

## 6. 범위 밖 (BACKLOG에 남긴다)

- 실시간 대중교통 안내 en 게이트 해제 + 안내 상태 머신 display DTO(§3.7).
- CLI/MCP `route transit`·`station` 계열의 `lang`(E26 동형).
- 내 주변 버스 정류소명 영문(E28 로마자).
- iOS 줄 단위 언어 태깅(한국어 폴백 줄·비-en 로케일의 영어 줄, 리뷰 #16) — E28 실기기 판정 항목(SwiftUI `accessibilitySpeechLanguage` 미동작 보고). 이 마일스톤의 iOS 한국어 폴백 줄은 **줄 전체가 한국어**라(원자성) 오늘의 화면과 같은 모양이고, 부분 실패가 줄 안에 섞이는 경로는 없다.
- 채팅 산문의 영문 노선명(채팅은 ko 산문 정본).

## 7. 검토한 대안

| 대안 | 기각 근거 |
|---|---|
| **A. en이면 영문을 기존 필드에, 한글을 `*Ko`에**(코디네이터 착수 프롬프트의 모양) | 조인 경로 전부(`subwayHoursKey`·`findQuickExit`·`subwayIdForOdsayLine`·`normalizeStopName`·TAGO `routeNo`·`fetchSubwayArrivals(station)`)를 `*Ko`로 갈아야 하고 하나만 빠져도 **조용히 전멸**(운행시간 강등·빠른하차·실시간 추적). 실패 모양이 비대칭이라 B를 택했다 — B의 누락은 "한국어가 보인다"로 드러난다 |
| `*Kor` 결측 시 영문을 한국어 필드에 넣기(초안) | 리뷰 #1이 뒤집었다 — 그 한 항목에서 조인이 조용히 죽어 원칙 1이 거짓이 된다. ko 재조회 fail-closed로 대체 |
| Kit 미러(`SubwayLineName.swift`·`SubwayArrivalText.swift`) + 공유 fixture | 클라이언트가 만들려면 seed 영문 역명이 서버 투영으로 와야 해서 "순수 함수"가 문장 템플릿만 남는다 — 같은 템플릿을 서버가 한 번 돌리는 것이 미러+drift 테스트보다 적다. 영문은 데이터 언어라 로케일별 조립이 없다 |
| ODsay 영문 노선명 그대로·표 미스 시 폴백 | 급행 표지 소실·가운뎃점·비공식 표기. 폴백으로 두면 소비자마다 정책이 갈린다(리뷰 #11) — 표 미스는 부재 |
| 항상 `lang=1`로 부르고 ko 응답도 `*Kor`에서 한글을 뽑기 | ko 캐시 키·응답이 바뀌어 회귀 면이 넓다. ko는 종전 경로 그대로가 가장 싸다 |
| 도착 문장을 클라이언트 i18n 키로 조립(6로케일) | 영문 데이터 정책(`dataLocale`)과 어긋난다 — 역명·노선명은 영문인데 문장 틀만 프랑스어면 한 줄에 두 언어가 선다 |
| 안내 상태 머신 표시 라벨 지금 배선(초안 §3.7) | 리뷰 #15 — 도달 사용자 0인 죽은 배선이고 미래 계약도 불완전. 게이트 해제 마일스톤으로 |

## 8. 실호출 게이트 결과 (2026-08-31, `node scripts/verify-odsay-lang.mjs`)

**35/35 PASS**(1차 33/35 → 서울역 도착 2건 검출 → 수정 후 재실행 PASS).

- 경로 3종(길동→강남·김포공항→신논현·길동→하남) × en·ko: 탑승 leg `*En` 결측 0(8·5·4 legs), 경유 정류장 `nameEn` 결측 0, 요약 결측 0, `*En` 한글 0, 정규화 잔존물 0, 노선 표 미스 0, **en·ko 한국어 필드 전수 일치(짝 5/5 ×3)**, ko 응답 `*En` 키 0.
- 급행 필수 표본: `수도권 9호선(급행)` 보존 + `lineNameEn = "Line 9 Express"`(ODsay 영문은 `Line 9`).
- 정류소 표본: `30-3 Gil-dong Community Service Center, Dunchon 2-dong Community Service Center → Hanam City Hall` · `Line 5 Gildong → Hanam City Hall(Deokpung, Sinjang)`(원문 `(덕풍·신장)`의 가운뎃점이 쉼표로).
- 실시간 도착 en: 강남 8/8 · 서울역 20/20(`messageEn`·`trainLineNmEn` 생성률 100%), 한국어 원문 불변. **1차 검출**: 서울역에서 공항철도 열차의 `서울 출발`·`서울행 - 서울방면`이 부재였다 — seed에 서울역이 4행(`Seoul Station`×2·`Seoul`(인천국제공항선)·`Seoul station`(경의중앙선))이고 도착 노선 `공항철도`와 seed `인천국제공항선`이 `lineHintMatches`로 안 묶여 후보 셋의 영문이 갈렸다. 수정: 같은 노선 판정에 **영문 표 동치**(둘 다 AREX)를 먼저 보고, 표기 차이(`Seoul station`)는 대소문자 무시로 모은다(§3.4 갱신). fixture에 그 케이스 3건 추가.
- ODsay 호출 수: 경로 3종 × 2언어 = 6콜(캐시 없는 상태) + 실시간 2콜.

## 9. 설계 리뷰 (codex adversarial-review, 2026-08-31)

raw `codex exec` + spec 본문 직접 주입(`< /dev/null`), 17건. 처리:

| # | 심각도 | 요지 | 처리 |
|---|---|---|---|
| 1 | high | `*Kor` 결측 시 영문이 한국어 필드로 들어가 조인 파손 | **뒤집음** — §3.1 완전성 검증 + ko 재조회 fail-closed |
| 2 | high | 필드 optional로는 줄 단위 언어 원자성 미보장 | 반영 — §3.6 `pickLine` 헬퍼(웹·Kit) + 변이 테스트 |
| 3 | high | 비-en 로케일에서 영어 줄에 `lang` 태그 부재 | 반영(웹) — 순수 데이터 영어 줄 `lang="en"`. 혼합 줄은 A26 선례대로 미태깅(분절이 헌장 위반), iOS는 §6 |
| 4 | high | 코드·동작어 대응 미정의 | 반영 — §3.4 정확 행렬 |
| 5 | high | 현재역 중복·모순 | 반영 — `messageEn`에서 괄호 제외, `currentLocationEn` 단일 채널·모순은 부재 |
| 6 | high | seed 매칭이 노선 위상을 안 본다 | 부분 반영 — 도착 노선 우선 후보 + 영문 집합 다중이면 null. 강제 노선 필터는 1호선 종착(경원선 seed) 때문에 불가, 잔여 위험 수용 근거 기록 |
| 7 | medium | 수치 유효성 | 반영 |
| 8 | high | 표본 게이트가 계약을 못 닫는다 | 반영 — 런타임 검증이 정본, 급행 필수 표본, 언어 무관 서명으로 짝 |
| 9 | medium | 캐시 계층 열거 | 반영 — §2.1·§3.5 열거 + 라우트 테스트 ko→en→ko |
| 10 | high | drift 테스트가 중간 생산자를 안 본다 | 반영 — 5축(`displayLineName` 통과값 포함) + 미지 키 계측 |
| 11 | medium | 표 미스 폴백이 소비자마다 다르다 | 반영 — provider 폴백 삭제, 전 소비자 "부재 → 한국어" |
| 12 | high | 필드 존재 ≠ 영문 | 반영 — 한글 포함 값은 부재 |
| 13 | medium | 문장부호 추정 오탐 | 반영 — 이니셜·숫자·`No.` 예외, 불확실 시 원문 보존, 멱등 테스트 |
| 14 | medium | aria-hidden 한글은 SR 안전망이 아니다 | 반영(문서) — 시각 전용으로 명시 |
| 15 | medium | 상태 머신 라벨은 죽은 배선 | 반영 — §3.7 범위 밖으로 이동 |
| 16 | high | iOS 폴백 줄 언어 태깅 미해결 | **기각(범위)** — E28 실기기 판정 항목과 동일 축이고 이 마일스톤의 원자성 규칙으로 부분 실패가 줄 안에 섞이지 않는다(오늘의 화면과 같은 모양). §6 명시 |
| 17 | medium | 실시간 문구 drift가 조용한 강등 | 반영 — 행렬 밖 모양 계측 + 게이트 7 |

# 역 상세 보강 — 첫차·막차 시간표 + 시설 패널 보강 + 역명 매칭 결함 수정 (2026-07-22)

> 입력: `docs/RESEARCH-2026-07-routing-enhancement.md` §3·§4, PROGRESS "다음 마일스톤 후보 ①".
> 이 스펙의 모든 외부 데이터 주장은 2026-07-22 실호출로 확인한 값이다(추정 없음).
> codex 적대적 설계 리뷰 1회 반영(17건 중 14건 수용·2건 기수용 확인·1건 기각 — §7).

## 0. 목표와 성과

역 상세(장소 상세의 역 섹션)에 시각장애 사용자가 출발 전 텍스트로 완결할 수 있는 정보 두 축을 더한다:

1. **첫차·막차**(노선·방향별, 전국) — "막차까지 얼마 남았나"를 실시간 도착이 못 주는 시간대(운행 전·심야)에 준다.
2. **시각장애인 음성유도기 설치 위치**(서울교통공사 1~8호선) + **엘리베이터 위치 폴백**(9호선·우이신설 등 wksn 미커버 역) — 기존 교통약자 시설 패널을 보강한다.

부수하되 가장 파급이 큰 수정: **카카오 검색 진입 역 상세의 역 섹션 4종이 전부 死 상태였던 선재 결함**(§3)을 고친다.

측정 가능한 성과:
- "강동역 5호선"(카카오 검색 1위 그대로)으로 진입해도 역 메타·실시간 도착·시설 2종이 뜬다 (현재: 전부 미노출, 실서버 재현 `{"meta":null}`).
- 강동역 상세에서 5호선 상·하행 첫차·막차가 행선지와 함께 낭독된다. 서면역(부산)도 동작(전국).
- 강동역 시설 패널에 "시각장애인 음성유도기 N개 + 설치 위치" 그룹이 추가된다.
- 봉은사역(9호선, wksn 미커버)의 시설 패널에 엘리베이터 위치(방위·거리)가 뜬다.

## 1. 데이터 소스 (전부 실호출 확정)

### 1-A. TAGO 지하철정보 (data.go.kr 15098554, `DATA_GO_KR_API_KEY`)

- Base `http://apis.data.go.kr/1613000/SubwayInfo/` — 서비스명 `SubwayInfo`, **오퍼레이션 첫 글자 대문자**(소문자 get은 "API not found", 기존 PROGRESS 함정 재확인).
- `GetKwrdFndSubwaySttnList?subwayStationName=강동` → `{subwayStationId:"MTRS152549", subwayStationName:"강동", subwayRouteName:"5호선"}`. **포함검색**이라 "강동" 질의에 강동구청·굽은다리도 온다 → 정확매칭은 코드 책임. `numOfRows=500`, `totalCount > 500`이면 throw(페이지 누락 침묵 금지 — wksn 동형. "중앙"류 다건 역명 방어).
- `GetSubwaySttnAcctoSchdulList?subwayStationId=&dailyTypeCode=&upDownTypeCode=` → row: `{subwayStationNm, endSubwayStationId, endSubwayStationNm, depTime:"000210", arrTime, dailyTypeCode, upDownTypeCode}`. 강동 평일 상행 totalCount 199 (`numOfRows=500` 단일 페이지 수용, 초과 시 throw).
- `dailyTypeCode`: 01 평일 / 02 토요일 / 03 일요일·공휴일. `upDownTypeCode`: U 상행 / D 하행.
- envelope는 data.go.kr 표준(`response.body.items.item[]`), **item이 1건이면 배열이 아니라 객체**(서울역 프로브에서 확인) — 배열 강제 헬퍼 필수. 빈 결과 `items:""` 허용(0행 취급).
- 커버리지 전국: 서면(부산 1·2호선)·서울역(1호선·공항·GTX-A·경의중앙 등) 확인.
- 노선명이 축약형으로 온다: "공항"·"수인분당"·"경의중앙"·"GTX-A". 표시 규칙: `호선`/`선`으로 끝나지 않으면 `선`을 붙인다("수인분당선"·"공항선"·"GTX-A선") — 결정론 규칙, 매핑 테이블 금지.

#### 첫차·막차 산출 계약 (spec 정본)

1. **서비스데이 보정(정렬)**: `depTime`은 HHMMSS이고 00시대 심야열차(전일 막차의 연장, 강동 "000210")가 배열 앞에 온다. 03:00 미만은 +24h로 보정해 정렬한 뒤 첫차=min·막차=max. 보정 없이 min을 취하면 "첫차 00:02" 오답. 03:00 경계는 국내 도시철도 공통 운행 공백(대략 01~05시)에 놓인 휴리스틱임을 코드 주석에 명시한다.
2. **서비스데이 보정(요일 타입)**: `dailyTypeCode` 판정 기준일도 같은 경계를 쓴다 — **KST 현재 시각에서 3시간을 뺀 시각의 날짜**(`serviceDate`)로 요일을 계산한다. 월요일 00:30에 조회하면 일요일(03) 시간표가 맞다. 서버 타임존 의존 금지(`Asia/Seoul` 고정 계산).
3. **공휴일 보정(게이트형)**: 특일정보 API(data.go.kr 15012690 `SpcdeInfoService/getRestDeInfo`, 동일 `DATA_GO_KR_API_KEY`)로 serviceDate가 공휴일이면 03을 쓴다. `revalidate 86_400`(월 단위 조회 캐시). **2026-07-22 현재 미신청(403 실측)** — 활용신청은 이번 마일스톤 작업 항목이며, 신청 전·조회 실패 시엔 요일 기반으로 폴백한다(어느 경로든 UI가 기준 라벨을 명시하므로 정직성 유지).
4. **당역 종착 제외**: `endSubwayStationId == subwayStationId`인 row는 이 역에 도착해 끝나는 열차라 탑승 불가 — 첫차·막차 후보에서 제외한다.
5. **행 유효성 가드**: `depTime`이 6자리 숫자가 아니면 그 행은 제외(오염 행 하나가 첫차·막차를 오염시키지 않게). 제외 사유별 테스트.
6. **기준 라벨 필수**: UI는 항상 "평일 기준"/"토요일 기준"/"일요일·공휴일 기준"을 병기한다(어떤 타입을 조회했는지 명시 — 공휴일 보정 실패 시에도 오도 없음).
7. **익일 표기**: 표시 시각은 원시각 HH:MM이되, 서비스데이 보정이 걸린 심야 시각(<03:00)에는 "익일"을 붙인다("막차 익일 00:24") — 음성만 듣는 사용자의 날짜 경계 모호성 제거. 보정값(24:24)은 정렬에만 쓴다.

### 1-B. 서울 지하철 엘리베이터 위치 (서울 열린데이터 OA-21212, `SEOUL_OPEN_DATA_KEY`)

- `http://openapi.seoul.go.kr:8088/{key}/json/tbTraficElvtr/{start}/{end}/` — 현재 총 552건. envelope `tbTraficElvtr.RESULT.CODE=="INFO-000"` + `row[]`(따릉이 동형). **`list_total_count`를 확인해 1,000 초과 시 페이지 루프**(따릉이 동형 — "현재 552"의 영구 가정 금지).
- 필드: `NODE_WKT` `"POINT(127.13 37.53)"`(**lng lat 순서**), `SBWY_STN_NM`/`SBWY_STN_CD`, `SGG_NM`/`EMD_NM`. **위치 설명 텍스트·출구 번호 없음.**
- 커버리지: 271역 — 9호선(봉은사·신논현)·우이신설(북한산우이) 포함, 즉 wksn(서울교통공사 1~8호선)이 못 주는 노선을 준다.
- **역할은 폴백 한정**: 기존 wksn 엘리베이터(`dtlPstn` "1번 출입구"·가동상태)가 있는 역에서는 쓰지 않는다(강동 실측: wksn 3대 위치 텍스트 > OA-21212 좌표 2건). 이중 노출은 미니멀리즘 위반.

### 1-C. 시각장애인 음성유도기 설치 위치 (서울 열린데이터 OA-22526, CSV 정적 seed)

- 파일 다운로드(무인증): POST `https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false` body `infId=OA-22526&seq=1&infSeq=2`. **cp949 인코딩**, 5,551 데이터 행, 컬럼 `연번,호선,외부역번호,역명,설치위치`.
- 역명에 호선 병기 괄호가 붙는다: "서울역 (1)"·"동대문(4)"·"교대 (3)"(공백 유무 혼재) — seed 빌드 시 제거·정규화.
- 설치위치는 풍부한 한국어 텍스트("지하1층 3번출구 내부", "상선 승강장 내려가는 A계단 위"). 강동 21개. 호선 빈 문자열 행 존재(허용).
- 갱신 주기 불명(파일명 20250812) → **정적 seed 방식**(subway-stations XLSX 파이프라인 동형): `scripts/build-voice-guides.py`가 CSV → `src/lib/data/voice-guides.json`(서버 전용 import, 기준일 필드 포함). 갱신은 수동 재실행(연 1회 관례, subway-stations 동형). **출처 문구에 데이터 기준일을 병기**한다("서울교통공사 제공, 2025-08 기준" — 오래된 시설 정보를 현재처럼 낭독하지 않기 위한 정직성 장치).

## 2. 아키텍처

```
PlaceDetail (역 판정 시)
 ├─ StationMeta            (기존, 자동)
 ├─ SeoulSubwayArrival     (기존, 자동)
 ├─ StationTimetable  ★신규(자동 등장 섹션, StationMeta 동형 + 실패 문장)
 │    └─ GET /api/station/timetable?station=  ★신규 라우트(레이트리밋)
 │         └─ src/lib/providers/tago-subway.ts  ★신규 provider
 ├─ StationFacilities      (기존, 온디맨드 버튼)
 └─ SeoulMetroFacilities   (기존, 온디맨드 버튼 — 응답에 그룹 2종 추가)
      └─ GET /api/station/metro-facilities (기존 라우트, 응답 확장)
           ├─ wksn 9종 (기존)
           ├─ ＋ voiceGuide 그룹  ★신규(정적 seed, 서울교통공사 1~8호선)
           └─ ＋ elevatorLocation 그룹  ★신규(OA-21212, wksn 엘리베이터 부재 시만)
```

- **신규 화면·신규 버튼 0** — 자동 섹션 1개 추가, 기존 패널 데이터 보강. 발견 경로 규칙 준수: StationTimetable은 조용히 자동 등장하므로 region 랜드마크(`<section aria-labelledby>`+`useId`+`h3`), 시설 그룹은 기존 버튼 패널 내부라 `h4` 그룹 헤딩만.
- 게이트: 시간표=`DATA_GO_KR_API_KEY`(키 없으면 라우트 null → 섹션 미노출), 엘리베이터 폴백=`SEOUL_OPEN_DATA_KEY`(없으면 그룹 생략), voiceGuide=정적 seed(무게이트).
- CLI/MCP 카탈로그 반영은 이번 범위에서 제외(기존 "배차간격 미러" 백로그와 함께 이월).

### 2-A. 신규 provider `tago-subway.ts` — 상태 모델 정본

`fetchStationTimetable(stationName)`:

1. `GetKwrdFndSubwaySttnList`(키워드=정규화 역명) → **정확매칭 필터**(§3 확장 정규화 — TAGO "청량리(서울시립대입구)" 괄호 부가명 흡수) + **노선 힌트 필터**(§3 `lineHint` — "양평역 5호선"이 경의중앙선 양평역과 합쳐지지 않게) → 노선별 subwayStationId 목록(상한 8 — 호출 증폭 cap).
2. 노선 ID마다 serviceDate의 dailyTypeCode로 U·D 両방향 `GetSubwaySttnAcctoSchdulList` 병렬 `Promise.allSettled`.
3. 노선·방향별 첫차·막차 산출(§1-A 계약 적용).

**결과 판정 규칙(3-state 붕괴 방지 — 부분 실패를 무운행으로 위장 금지)**:

| 상황 | 반환 | UI |
|---|---|---|
| 키워드 정확매칭 0건 | `null` (미커버) | 섹션 미노출 |
| 시간표 호출 전부 실패 | throw → 라우트 502 | 실패 문장 노출(숨김 금지) |
| 일부 노선·방향 실패, 일부 성공 | 결과 + `partial: true` | 결과 + "일부 노선 정보를 불러오지 못했습니다" |
| 전 호출 성공, 유효 행 0 | `{lines: []}` | "오늘 시간표 정보가 없습니다" 문장 |
| 정상 | `StationTimetable` | 첫차·막차 낭독 |

- 타입: `StationTimetable{stationName, dailyType:"weekday"|"saturday"|"sunday", partial?:true, lines:[{lineName, directions:[{direction:"up"|"down", first:{time, nextDay?:true, terminus, terminusEn?}, last:{...}}]}]}`. 한 (노선,방향)의 유효 행이 0이면 그 방향만 생략.
- 행선지 영문: `findStationsByName(terminus)` seed 조회로 `nameEn` 병기(en 로케일용). 미매칭이면 한글 그대로(정직 폴백, §7-17 결정).
- 캐시: 두 오퍼레이션 모두 `next: { revalidate: 86_400 }`(URL에 dailyTypeCode 포함이라 요일 타입별 캐시 분리).

### 2-B. `/api/station/timetable` (신규 라우트)

- `GET ?station=` — 기존 역 상세 4종과 동일 균일 계약(zod `station` 1~50자). 응답 `{timetable: StationTimetable | null}`, upstream 실패 502.
- **IP 레이트리밋 60초 10회**(walk route 공용 모듈 재사용) — 임의 문자열로 fetch 캐시를 우회하는 쿼터 소진 공격 방어(키워드 1 + 노선×2 증폭 고려).
- serviceDate·dailyType 계산은 라우트가 아니라 provider 책임(KST 고정).

### 2-C. metro-facilities 응답 확장 (기존 라우트·provider)

- `fetchSeoulMetroFacilities` 반환 직전에 두 그룹을 병합:
  - **voiceGuide**: seed에서 정규화 역명 매칭 → 항목 텍스트는 `joinText(설치위치, 호선)`을 **단일 문자열로 합성해 `name`에 담는다**(호선은 그 역 항목이 2개 노선 이상일 때만 병기, 나머지 필드 미사용) — 기존 렌더러(웹 `joinText(f.name, ...)` 단일 li 텍스트·iOS 동형)에서 한 항목=한 객체가 보장된다.
  - **elevatorLocation**: groups에 `elevator` 그룹이 **없을 때만** OA-21212(1-B 페이지 규칙) 역명 매칭 → 항목 텍스트 "역 중심 기준 북동쪽 약 60m, 성내동"(기준점 명시 — 출입구 방향으로 오인 방지). 기준 좌표는 **매칭된 seed 행 중 해당 엘리베이터와 최근접인 행**(환승역 복수 좌표에서 임의 첫 행 금지). seed에 역 좌표가 없으면 그룹 생략(방위 없는 좌표 나열은 무가치).
  - 병합은 `Promise.allSettled` — 보강 실패가 주 시설 조회를 죽이지 않되, **실패를 무음으로 삼키지 않는다**: 보강 소스(OA-21212) 실패 시 응답에 `supplementFailed: true`를 세워 UI가 "일부 시설 정보를 불러오지 못했습니다" 한 줄을 병기한다(실패 은폐 금지). voiceGuide는 정적 seed라 실패 경로 없음.
- 방위·항목 텍스트는 서버가 ko로 합성한다. 근거: 이 패널의 항목 텍스트는 원천이 전부 한국어 데이터(wksn `dtlPstn` 동일)이고 웹·iOS가 `lang="ko"`로 낭독한다 — 클라이언트 구조화·로케일화는 과잉(그룹 라벨만 5로케일).
- 기존 계약 유지: wksn 전부 비고 신규 그룹도 비면 null. wksn이 null이어도 신규 그룹이 있으면 결과 반환(9호선 역이 처음으로 비-null이 된다 — stationName은 입력 역명, line은 undefined 허용).
- Kit `SeoulMetroFacilityGroup.kind`는 String, 미지 필드는 Codable이 무시 — 신규 kind·`supplementFailed`가 구버전 iOS를 깨지 않는다(실코드 확인). 웹·iOS kind 라벨 키 2개 추가(`subway.kind.voiceGuide`·`subway.kind.elevatorLocation`, 5로케일 + Kit xcstrings).

### 2-D. `StationTimetable` 컴포넌트 (신규, 자동 섹션)

- StationMeta 동형 자동 fetch + region 랜드마크 + `h3` 헤딩("첫차·막차"). **단, 실패를 조용히 숨기지 않는다**(§2-A 표): 미커버(null)만 미노출, 502·네트워크 실패는 섹션 골격 + 실패 문장, `lines:[]`는 "정보 없음" 문장 — 시각장애 사용자가 "원래 없음"과 "고장"을 구분한다(재시도 버튼은 미도입 — 기존 자동 섹션 관례상 과잉, 재진입=재조회).
- 본문: 기준 라벨 한 줄("평일 기준" 등, partial이면 부분 실패 문구 병기) + 노선·방향마다 `한 줄 = 한 객체`:
  - ko: `5호선 상행, 첫차 05:15 방화행, 막차 익일 00:24 애오개행`
  - en: `Line 5 up, first 05:15 to Banghwa, last 00:24 (next day) to Aeogae`
  - `joinText`(쉼표 구분, 가운뎃점 금지). 방향 라벨 i18n(`up`/`down`).
- en 포함 전 로케일 노출(시각은 언어 중립, 행선지는 seed 영문 폴백).

## 3. 선재 결함 수정 — 역명 매칭 계층

**현상(실서버 재현)**: 카카오 역 place_name은 "강동역 5호선"·"굽은다리역 5호선" 형태 → 현행 정규화(접미 "역"만 제거)로는 seed·wksn·korail 어느 쪽과도 매칭 실패 → **카카오 검색으로 진입한 역 상세에서 StationMeta·실시간 도착·시설 2종이 전부 미노출**. ("내 주변 지하철"의 seed 이름 진입만 살아 있었다.)

**수정 A — `normalizeStationName` 확장(매칭 키 전용)**:
1. 괄호 부가명 제거: `(...)` 제거 — 카카오 "청량리역"↔TAGO "청량리(서울시립대입구)"↔CSV "동대문(4)" 동일 키.
2. 후행 노선 토큰 제거: 공백 뒤 `선`으로 끝나는 후행 토큰 반복 제거(`/(?:\s+\S*선)+$/`) — "강동역 5호선"→"강동역". 그 다음 기존 "역"/"station" 접미 제거.
- 표시명에는 쓰지 않는다(기존 계약 동일). 사용처 4곳(seed·wksn·korail·신규 tago) 일괄 적용.

**수정 B — 노선 힌트 보존(`parseStationQuery`)**: 정규화가 버리는 노선 토큰은 정보다("양평역 5호선"의 5호선은 경의중앙선 양평역(경기 양평군, 동명이역)과의 유일한 구분자). `parseStationQuery(name) → {nameKey, lineHint?}`를 station-match에 신설하고:
- **tago-subway**: lineHint 있으면 `subwayRouteName` 정규화 일치 노선만(§2-A 1단계).
- **subway-stations seed**: `matchStationsByName`에 옵션 lineHint — meta 라우트 적용(동명이역 노선 오합병 방지).
- **wksn**: 정확매칭 필터에 lineHint(`lineNm`) 병용.
- korail(철도)은 노선 개념이 달라 미적용. lineHint 없으면(내 주변 진입 등) 전 노선 — 현행 동작.

**검증**:
- 회귀 가드: 기존 station-match·subway-stations·seoul-metro-facilities·korail 테스트 green + 신규 케이스(카카오 실명 4종, TAGO 괄호명, CSV 괄호명, 동명이역 양평).
- **괄호 제거 충돌 전수 검증**: seed 1,098 ∪ voice-guide CSV 222 역명에 대해 "괄호 제거 후 키 충돌이 원문 별개 역을 합치는 사례 0"을 확인하는 테스트를 seed 빌드에 동반(결정론 검증 — 리뷰 지적 8 수용).
- 무공백 역명("선릉"·"선바위")은 노선 토큰 규칙(공백 필수)에 안 걸림 — 테스트 포함.

## 4. i18n

- 신규 키(웹 `messages/{5로케일}.json`): `timetable.heading`·`timetable.dailyType.{weekday,saturday,sunday}`·`timetable.row`(노선·방향·첫차·막차 조합)·`timetable.up`/`down`·`timetable.first`/`last`·`timetable.nextDay`·`timetable.empty`·`timetable.error`·`timetable.partial`·`timetable.source`, `subway.kind.voiceGuide`·`subway.kind.elevatorLocation`·`subway.supplementFailed`.
- iOS: 웹 정본 → `messages-to-xcstrings.mjs` 재생성 + Kit 참조 키 린터 통과. 시간표 섹션 iOS 미러는 후속 phase(§6).

## 5. 테스트·검증 게이트

- **단위(fixture)**: tago-subway 파서(서비스데이 정렬·요일 타입 03시 경계·당역종착 제외·행 유효성·단일 item 객체 envelope·노선명 `선` 접미·partial 판정 표 5행 전부), voice-guide seed 매칭(괄호 정규화·충돌 전수), elevatorLocation 폴백(wksn 엘베 존재 시 미부착·부재 시 부착·좌표 부재 시 생략·최근접 기준 좌표·supplementFailed), parseStationQuery·normalizeStationName 신규 케이스, 기존 테스트 전량 green.
- **실호출 머지 게이트**(로컬 dev):
  1. `/api/station/timetable?station=강동역 5호선` → 5호선 상·하행 첫차·막차, 첫차 05시대(00시대 아님), 막차 익일 표기.
  2. `?station=서면역` → 부산 1·2호선 (전국 확인).
  3. `?station=양평역 5호선` → 5호선만(경의중앙선 미혼입 — lineHint).
  4. `/api/station/metro-facilities?station=강동역 5호선` → wksn 기존 그룹 + voiceGuide 21개, elevatorLocation 없음.
  5. `?station=봉은사역` → elevatorLocation 그룹(방위·거리·기준점 문구), wksn null이어도 비-null.
  6. `/api/station/meta?station=강동역 5호선` → meta 비-null(§3 검증).
  7. 특일정보 활용신청 후: 공휴일 보정 실호출(신청 전이면 요일 폴백 동작 확인으로 대체).
- **a11y**: `a11y-auditor` 점검(신규 자동 섹션 region·한 줄 한 객체·기준 라벨·실패 문장).

## 6. 범위 제외·후속

- **iOS phase(같은 마일스톤 후속)**: StationTimetable 미러 섹션(Kit `StationService.timetable` + PlaceDetailView), kind 라벨·supplementFailed 표기. 웹 머지·실호출 검증 후 착수.
- CLI/MCP `station-timetable` 카탈로그: 이월(배차간격 미러 백로그와 함께).
- 서울 첫차막차 OA-15492: TAGO가 전국 커버하므로 미도입(중복).
- OA-21212를 wksn 커버 역에 병기: 안 함(이중 노출 노이즈).
- StationMeta 등 기존 자동 섹션의 실패 문장 소급: 안 함(보조 메타는 현행 관례 유지 — 시간표는 의사결정 정보라 실패 노출, 메타는 장식적 보강이라 무음 유지. 경계 의식적 결정).
- 혼잡도(OA-12928)·장거리(고속·시외·열차): 로드맵 별도 항목 유지.

## 7. 설계 리뷰 반영 기록 (codex adversarial-review 2026-07-22)

수용: ①실패 문장 노출(§2-D — 단 재시도 버튼은 관례상 미도입) ②partial 판정 표(§2-A) ③serviceDate 03시 경계(§1-A-2) ④공휴일 특일 API 게이트형(§1-A-3) ⑤익일 표기(§1-A-7) ⑥행 유효성 가드(§1-A-5) ⑦lineHint(§3-B) ⑨키워드 totalCount 가드(§1-A) ⑩유효 행 0 상태 정의(§2-A 표) ⑪레이트리밋(§2-B) ⑫supplementFailed(§2-C) ⑬OA-21212 페이지 루프(§1-B) ⑭기준점 명시+최근접 좌표(§2-C) ⑯seed 기준일 병기(§1-C).
기수용 확인: ⑮한 줄 한 객체 — 기존 렌더러가 이미 단일 텍스트 합성(name 합성 규칙으로 명문화), ⑧괄호 의미 — lineHint가 노선 정보를 보존하고 충돌은 전수 검증으로 담보(출처별 alias 파서는 과잉).
기각: ⑰영문 문장 내 한글 행선지 lang 분리 — 한 줄=한 객체 우선(헌장 §4), seed 커버리지상 드문 폴백이라 수용.

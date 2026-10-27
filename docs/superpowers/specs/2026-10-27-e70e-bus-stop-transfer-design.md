# E70-e 버스 정류장도 갈아탈 곳으로 지정 — 설계 (2026-10-27)

선행: E70 첫 판 spec `2026-10-17-e70-mode-change-journey-design.md`(D1~D14, 판정 1~32 — 재논의하지 않는다). BACKLOG E70-e(2026-10-17 위원장 판정). 계획 `docs/superpowers/plans/2026-10-27-backlog-sweep-14-parallel-plan.md` §1 코디네이터 판정 5·6.

설계 리뷰 판정: **한다** — 새 판정 계층(지정 정류장 술어)과 ODsay 호출 계약(버스만 재조회)을 담는다(§9).

## 0. 한 문단 요약

여정의 「자동차에서 내리는 역」·「자동차를 탈 역」 칸이 버스 정류장도 받는다. 카카오 장소 검색은 시내버스 정류장을 찾지 못하므로(실측 §1), 칸 검색에 **정류장 이름 검색**을 병렬로 더해 결과 목록에 「{정류장명}, 정류장, {거리}」 줄이 역·장소 줄과 함께 나온다(위원장 판정 2026-10-27 21:05 — 판정 요청 `judgment-202610272058`의 선택지 나). 서울은 TOPIS 정류소명 검색, 지방은 TAGO 정류소 검색이고, TAGO가 요구하는 도시코드는 여정의 출발·도착 좌표에서 유도한다(사용자에게 묻지 않는다). 서버 여정 조립은 옵트인 `stops=1`일 때 (가) 정류장 입력을 버스 leg의 승차·하차 정류장과 이름 앞부분 + 500m로 맞추고 (나) 역 입력도 지하철 경로가 없으면 그 역 이름이 붙은 근처 정류장(「강남역12번출구」·「강남역.삼성전자」)의 버스 경로로 맞추며 (다) 못 찾으면 지하철만에 더해 **버스만(`SearchPathType=2`)** 후보를 한 번 더 본다. 정류장에서 내리면 출구가 없어 출구 선정·출구 도보를 건너뛴다(추천 경로가 버스로 끝나는 첫 판 갈래 그대로). 메뉴·칸 이름은 「역/정류장」으로 넓힌다.

## 1. 실측 (2026-10-27)

### 1.1 카카오 키워드 검색은 시내버스 정류장을 잡지 않는다 (실호출 6건)

| 질의 | 결과 |
|---|---|
| 서울역버스환승센터 | 「서울역 버스환승센터」 등 환승센터 시설(분류 `교통,수송 > 교통시설`) 2건 |
| 광화문 버스정류장 | 0건 |
| 시청앞.덕수궁 | 0건 |
| 강남역 버스정류장 | 「강남역정류소」(분류 `고속,시외버스정류장`) 1건 |
| 세종문화회관 정류장 | 분식점·사진관 등 무관 3건 |
| 종로2가 | 문화유적만 10건 |

카테고리 그룹 코드에 정류장이 없고, 키워드는 시설만 돌려준다. → 입력 경로를 새로 둔다: 위원장 판정(2026-10-27 21:05)으로 정류장 이름 직접 검색(TOPIS·TAGO, §3·§4.6). ODsay 정류장 검색은 호출당 과금이라 쓰지 않는다.

### 1.2 ODsay 정류장 이름 꼴 (저장 corpus 13개 응답, 정류장 이름 119개, 호출 0)

- 점 구분 부속명: 32개(「시청.교육청」·「강남역.삼성전자」·「서면역.롯데호텔백화점」 — 점이 둘 이상인 것도 있다).
- 역 이름을 담는 꼴이 여럿이다: 「강남역12번출구」·「강남역.삼성전자」·「신분당선강남역」·「지하철2호선강남역」·「서울역버스환승센터(5번승강장)」·「동대구역건너」·「반월당역(1번출구)1」·「도시철도담티역(3번출구)」·「잠실역1번.11번출구」.
- 점이 숫자 안에 있는 이름: 「2.28기념중앙공원건너1」. 공백 + 괄호 안 점: 「부산진역 (해양수산부.동구청)」.

이 목록을 그대로 공유 fixture로 잠근다(§4.2, 정류장 이름은 공개 정류장만 — 위원장 실조회 구간·자택 부근 이름은 뺀다).

## 2. 범위

- 서버: `/api/route/journey` 옵트인 확장(§4.1~§4.5, 미지정 응답 바이트 동일)과 새 정류장 이름 검색 라우트 `/api/route/journey/stops`(§4.6).
- iOS 실험판: 칸 검색 시트의 정류장 줄(§3), 문구(§6), 결과 제목·못 찾음 줄·최근 경로 줄의 정류장 문장(§6), 최근 경로 저장의 정류장 표식(§5).
- 범위 밖: ODsay 정류장 검색(과금), 웹·CLI·MCP·안드로이드(여정은 iOS 실험판 전용), 출발지 「지금 탄 열차」(E71).

## 3. 입력: 칸 검색에 정류장 줄 (iOS)

- 칸 검색 시트(`DirectionsEndpointSearchView`, 대상 `.boardStation`·`.alightStation`)에서 검색을 제출하면 장소 검색(종전)과 정류장 이름 검색(§4.6)이 **병렬**로 돈다. 역 칸 대상일 때만이다(출발·도착·경유지 칸은 종전 그대로).
- 목록 순서(한 목록, 고를 수 있는 것이 먼저 — 읽기 순서에서 위치는 반복 비용이다): **역 장소 줄**(카카오 순서 그대로) → **정류장 줄**(거리순, 최대 5) → **그 밖 장소 줄**(카카오 순서). 장소 줄끼리의 상대 순서는 바꾸지 않는다(정확도순 재정렬 금지 규칙은 그대로).
- 정류장 줄: 정류장 하나 = 버튼 하나, 라벨 `joinText(정류장 이름, 「정류장」, formatDistance(거리))`(한 줄 = 한 객체). 거리는 같은 시트의 근접 블렌딩 기준점(`LocationService.coordinateForRanking()`)에서 잰 직선거리이고, 기준점이 없으면 거리 조각을 뺀다.
- 정류장을 고르면 칸에 `RecentStation(label: 정류장 이름, lat, lng, line: nil, kind: .busStop)`이 들어가고 시트가 닫힌다. 역 장소를 고르면 종전과 같다. 그 밖 장소를 고르면 시트를 연 채 통지 「역이나 정류장을 골라 주세요.」(종전 「역을 골라 주세요.」 자리, `.high` + 주의 진동 — 종전 판별선 그대로).
- 건수 통지(`directions.candidateCount`)는 보이는 줄 전부(장소 + 정류장)를 센다. 첫 후보 착지는 목록 첫 줄(종전 규칙).
- 3-state: 정류장 검색만 실패하면(throw 또는 `failed`) 정류장 자리에 「정류장을 불러오지 못했습니다.」 한 줄(장소 줄·받은 정류장 줄은 그대로). `truncated`면 정류장 줄 뒤에 「정류장 이름을 더 길게 입력해 주세요.」 한 줄(일부만 받았다 — 할 일을 말한다). 정류장 0건이면 정류장 줄이 없다(장소 줄이 그대로 정본이다). 장소·정류장이 **둘 다 0건**이고 응답이 `unsearched`(행정구역 표에도 근접 TAGO 정류소에도 도시코드가 없는 지역 — §4.6)면 기존 문장 「이 지역은 정류소 정보가 제공되지 않습니다」(`ios.common.unavailableHere.noBusData` 재사용)를 0건 안내와 함께 둔다. 검색어가 두 글자 미만이면 정류장 검색을 하지 않는다.
- 정류장 검색 요청이 싣는 좌표: 길찾기 화면의 출발·도착 좌표 중 알려진 것(현재 위치 출발이면 위치 스토어의 마지막 좌표). 하나도 없으면 정류장 검색을 하지 않는다(장소 검색만).

## 4. 서버 (`/api/route/journey`, 순서가 계약 — E70 §4.2의 ②만 바뀐다)

### 4.1 요청 (additive)

- `stops=1` 옵트인. 없으면 종전과 바이트 동일(역 입력은 지하철 leg만, 재조회는 지하철만).
- `boardKind`·`alightKind`: `stop`만 받는다(없으면 역). `stops=1` 없이 오면 400.
- `JourneyStationInput`에 `kind?: "stop"`, `JourneyRequest`에 `stops?: boolean`.

### 4.2 정류장 판정 술어 (순수, `src/lib/journey/station-identity.ts`)

- **`busStopKey(name)`**: 공백 제거 → 괄호 묶음 전부 제거 → 숫자 사이가 아닌 첫 `.` 앞부분. 예: 「강남역.삼성전자」→「강남역」, 「부산진역 (해양수산부.동구청)」→「부산진역」, 「2.28기념중앙공원건너1」→ 그대로, 「서울역버스환승센터(5번승강장)」→「서울역버스환승센터」.
- **정류장 입력 ↔ 버스 leg 끝 정류**(`isSameBusStop`): (`busStopKey` 같음, 빈 키 아님 ∧ 좌표 ≤ `JOURNEY_STATION_IDENTITY_M` 500m) ∨ 좌표 ≤ `JOURNEY_SAME_STOP_M`(50m, 이름 무관). 길 건너 같은 이름 정류장·부속명만 다른 정류장(「강남역」↔「강남역.○○」)은 같은 곳으로 본다. 사용자가 고른 것은 "이 근처에서 갈아탄다"이고 방향은 ODsay가 고른다. 50m 조항은 같은 모퉁이에 이름이 다른 정류장이 나란히 있는 경우다: TOPIS 검색은 「시청.덕수궁」과 「시청앞.덕수궁」을 둘 다 주는데 ODsay는 뒤의 것만 쓰고, 두 점은 37m다(실호출 게이트 2026-10-27).
- **역 입력 ↔ 버스 leg 끝 정류**(`busStopNamesStation`, `stops=1`일 때만): 좌표 ≤ 500m ∧ 다음 중 하나. 역 키 `k = normalizeStationName(역 이름)`(재사용, 자체 역명 정규화 없음).
  1. `normalizeStationName(busStopKey(정류장))`이 `k`와 같다(「시청.교육청」 ↔ 시청역).
  2. `busStopKey(정류장)` 안에 `${k}역`이 있고 그 앞 글자가 없거나 한글 음절이 아니거나 `선`·`도`다(「강남역12번출구」·「신분당선강남역」·「지하철2호선강남역」·「도시철도담티역(3번출구)」은 맞고, 「동대구역건너」는 대구역과 맞지 않는다).
- 정류장 입력은 지하철 leg와 맞추지 않는다(사용자가 정류장을 골랐다).
- 공유 fixture `journey-station-pairs.json`에 `busStops` 배열을 더한다: §1.2 이름 꼴과 기대 키, 역 입력 대응(맞음·안 맞음) 표본. 좌표 반경 근거는 종전 `pairs` 그대로(정류장 짝은 같은 반경을 쓴다 — 길 건너 쌍은 수십 m).

### 4.3 지정 경로 찾기 (`designated.ts`)

- 한 경로의 한쪽 맞음은 두 등급이다. **강**: 역 입력 ↔ 지하철·철도 leg(`isSameStation`, 종전), 정류장 입력 ↔ 버스 leg(`isSameBusStop`). **약**: 역 입력 ↔ 버스 leg(`busStopNamesStation`, `stops=1`만).
- **강이 약보다 앞선다 — 풀 사이에서도.** 순서대로 보고 찾으면 멈춘다:
  1. 전체 후보(1회, 종전)에서 지정한 모든 쪽이 **강**인 첫 경로.
  2. **지하철만**(`modeAxis: "subwayOnly"`)에서 강인 첫 경로. 지정한 모든 쪽이 역 입력일 때만 부른다(정류장 입력이 있으면 지하철만 후보로는 맞을 수 없다 — 호출하지 않는다).
  3. (`stops=1`만) 이미 받은 풀(전체 → 지하철만 순)에서 각 쪽이 강 또는 약인 첫 경로 — 호출 없음.
  4. (`stops=1`만) **버스만**(`modeAxis: "busOnly"`, `SearchPathType=2`)에서 각 쪽이 강 또는 약인 첫 경로.
  - → 역을 고르면 그 역의 지하철 경로가 어느 풀에 있든 먼저이고(전체 후보는 버스 경로만인데 지하철만 재조회에 지정 역 경로가 있는 사례 — 기존 `assemble.test.ts` — 를 약한 맞음이 가로채지 않는다), 없을 때만 그 역 이름 정류장의 버스 경로다. 회귀 테스트: 전체 후보의 약한 맞음 대 지하철만 후보의 강한 맞음 → 강이 이긴다.
  - ODsay 호출 상한은 요청당 3회(종전 2회). 정류장만 지정했으면 2회(전체 + 버스만). `stops` 없으면 1·2단계만(종전 그대로).
- `missingSide`는 조회한 모든 풀 위에서 강·약 구분 없이 "맞음"으로 가른다(종전 규칙 그대로).
- 응답 모양은 바뀌지 않는다. 변형의 `boardStation`·`alightStation`은 ODsay 정류 이름 그대로(버스면 정류장 이름).

### 4.4 정류장에서 내릴 때: 출구 생략 (`assemble.ts` ⑤)

- 마지막 탈것이 버스인 변형은 이미 출구·승강장 조회를 하지 않고(`subway` 거짓 → `stop|좌표` 그룹) `egress.options = [{kind:"none"}]`(택시는 내린 정류장 좌표에서)다. 지정 정류장 변형도 같은 갈래를 탄다 — 새 코드 없음, 테스트로 잠근다(카카오 출구·승강장 호출 0, Tmap 비용 = 택시 뒤 1).
- 정류장에서 타는 쪽(택시 앞)은 정류 좌표가 택시 목적지다(D4 그대로).

### 4.5 비용

- 카카오: 정류장 변형은 출구·승강장 조회 0(오히려 준다).
- ODsay: 못 찾은 경우만 +1(버스만). `budget.ts`의 Tmap 예약은 바뀌지 않는다(ODsay는 예약 밖 — 종전과 같다).

### 4.6 정류장 이름 검색 (새 라우트 `/api/route/journey/stops`)

`GET /api/route/journey/stops?q=<이름>&origin=<위도,경도>&dest=<위도,경도>` — `q`는 trim 2~30자(한 글자 부분 일치는 수천 건이다 — iOS는 두 글자 미만이면 정류장 검색을 하지 않는다), 좌표는 형제 여정 라우트와 같은 `coordSchema` 쌍이고 둘 중 하나 이상 필수. 한국 밖 좌표는 버린다(둘 다 밖이면 200 `{"outOfCoverage":true}`). 키 게이트 `hasDataGoKrKey() && hasKakaoKey()`(지역 판정이 카카오 역지오코딩) 아니면 200 `{"stops":[]}`이 아니라 503(여정 라우트와 같은 죽은 기능 0 계약 — 실험판만 부른다).

1. **좌표 → 검색 대상 지역**(좌표마다, 병렬): 카카오 `coordToRegionNames`(기존, revalidate 300) → 새 순수 함수 `tagoCityCodeOf(province, city)`(`tago-coverage.ts`, 같은 seed·같은 표 재사용): 서울특별시 → `"seoul"`(TOPIS), 광역시·세종·제주 → TAGO 2자리 코드(부산 21·대구 22·인천 23·광주 24·대전 25·울산 26·세종 12·제주 39 — 통합 시도의 광주 자치구는 24), 도의 시군 → seed에서 `도 접두:시군명`으로 찾은 코드(동명 시군 고성 규칙 그대로), 그 밖 → `null`.
   - **역지오코딩이 답하지 못하면(null·throw) 조회 실패다**(`failed`로 센다). `coordToRegionNames`는 HTTP 오류에도 null을 주므로 null을 "지역 없음"으로 읽으면 카카오 장애가 미제공으로 위장한다.
   - **행정구역은 TAGO 제공 도시코드와 일대일이 아니다**(담양·화순 좌표에 광주 버스 `citycode=24`가 온다 — `2026-08-02-bus-uncovered-region-design.md` 실측). 그래서 서울로 판정되지 않은 좌표(역지오코딩 실패 포함)는 표 결과와 별개로 **좌표 근접 TAGO 정류소**(기존 `fetchTagoStopsNear`, 1회, 무료)의 `cityCode` 집합을 대상에 더한다. 근접 조회가 throw면 `failed`.
   - 대상이 하나도 없는 좌표(서울 아님 ∧ 표 `null` ∧ 근접 정류소 0건)만 `unsearched`다. 대상은 중복 제거한다.
2. **검색**(대상마다, 병렬): TOPIS `stationinfo/getStationByName`(`stSrch=q`, 기존 `fetchSeoul` — TOPIS 봉투, revalidate 86400), TAGO `BusSttnInfoInqireService/getSttnNoList`(`cityCode`, `nodeNm=q`, 기존 `fetchTago` — 공용 data.go.kr 봉투, revalidate 86400). TAGO는 **부분 일치이고 요청에 좌표가 없어** 첫 페이지가 가까운 순이 아니다: `numOfRows=100`으로 `totalCount`에 이를 때까지 최대 5페이지(500건, `fetchTagoNearby` 선례) 모은 뒤에만 거리 정렬한다. 상한에 걸려 남은 페이지가 있으면 `truncated`. TOPIS는 한 응답에 전부 준다(실측 2026-10-27 — 페이지 파라미터 없음). 봉투가 다르면 파서도 다르다 — 각 provider 파일에 파서를 둔다(공용 모듈에 넣지 않는다). 캐시는 요청 URL 단위 = 이름(×도시) 단위다.
3. **응답** `{ stops: JourneyStopHit[], unsearched?: true, failed?: true, truncated?: true }`. `JourneyStopHit = { name, lat, lng, stopNo?, source: "seoul" | "tago" }`. 좌표 없는(파싱 불가) 항목은 버린다. 정렬은 요청 좌표 중 가까운 쪽까지의 거리 오름차순, `busStopKey`가 같은(빈 키 제외) 정류장이 이미 실렸고 그로부터 500m(`JOURNEY_STATION_IDENTITY_M`) 안이면 뺀다(길 건너 같은 이름 — 서버 판정이 같은 곳으로 맞춘다), 상위 10.
   - `unsearched`: 대상 지역을 유도하지 못한 좌표가 하나라도 있다(`null`).
   - `failed`: 역지오코딩·근접 조회·이름 검색 중 일부가 실패했다(나머지 결과는 싣는다). 성공한 이름 검색이 하나도 없고 실패가 하나라도 있으면 502(전부 `unsearched`면 200).
   - `truncated`: TAGO 페이지 상한에 걸렸다(가까운 정류장이 빠졌을 수 있다).
   - 3-state: 정상 0건은 `{"stops":[]}`, 미유도는 `unsearched`, 조회 실패는 `failed`/502 — 셋을 뭉개지 않는다.
4. 비용: 검색 1회 = 카카오 역지오코딩 ≤2(캐시) + TAGO 근접 ≤2 + TOPIS ≤1 + TAGO 이름 ≤(도시 수 × 5페이지)(무료). 시트 제출 때만 부른다(타자마다가 아니다).

## 5. iOS 저장·조회

- Kit `RecentStation`에 `kind: JourneyStationKind?`(`busStop` 하나, nil = 역). 구버전 저장본 디코딩은 부재 = nil. 동일 판정에 포함된다(같은 이름의 역과 정류장은 다른 지정이다).
- Kit `JourneyStationQuery`에 `kind`(기본값 없는 인자). `RouteService.journey`는 **늘 `stops=1`**을 싣고, 정류장이면 `boardKind=stop`/`alightKind=stop`.
- 노선 힌트(`line`)는 정류장이면 nil.
- `journeyLineQualifiers`(동명 이역 노선 머리)는 지정 쪽이 정류장이면 그 쪽을 보지 않는다(버스 leg는 이미 제외).
- `journeyRecommendedTitleIsBoardSide`의 "지정과 다른가" 비교는 정류장이면 `busStopKey` 대응(Kit 미러 `journeyBusStopKey`, 공유 fixture 같은 표)으로 한다 — 역 표시 이름 함수로 정류장 이름을 깎지 않는다.

## 6. 문구 (ko 확정안, 6로케일 동조)

| 키 | 종전 | 바뀐 문장 (ko — 여정 키는 ko 한 벌) |
|---|---|---|
| `ios.journey.addBoardStation` | 자동차에서 내리는 역 추가 | 자동차에서 내리는 역/정류장 추가 |
| `ios.journey.addAlightStation` | 자동차를 탈 역 추가 | 자동차를 탈 역/정류장 추가 |
| `ios.journey.boardField` | 자동차에서 내리는 역 | 자동차에서 내리는 역/정류장 |
| `ios.journey.alightField` | 자동차를 탈 역 | 자동차를 탈 역/정류장 |
| `ios.journey.clearStations` | 갈아탈 역 지우기 | 갈아탈 역/정류장 지우기 |
| `ios.journey.notStation` | 역을 골라 주세요. | 역이나 정류장을 골라 주세요. |

새 키(여정 문구는 첫 판 관례대로 ko 한 벌 — 기능이 데이터 로케일 ko 전용이다):

| 키 | 문장 | 쓰는 자리 |
|---|---|---|
| `ios.journey.busStopKind` | 정류장 | 시트 정류장 줄의 둘째 조각 |
| `ios.journey.stopSearchFailed` | 정류장을 불러오지 못했습니다. | 정류장 검색 실패(미유도 지역은 기존 `ios.common.unavailableHere.noBusData`) |
| `ios.journey.stopSearchTruncated` | 정류장 이름을 더 길게 입력해 주세요. | TAGO 페이지 상한 |
| `ios.journey.designatedHeadingBus` | {stop}에서 버스를 타는 경로 | 지정 경로가 버스로 시작(역 입력의 약 맞음 포함) |
| `ios.journey.designatedHeadingBusAlight` | {stop}에서 버스에서 내리는 경로 | 하차만 지정, 버스로 끝남 |
| `ios.journey.designatedMissingStop` | {stop}에서 타는 경로를 찾지 못했습니다. | 정류장 입력, 못 찾음 |
| `ios.journey.designatedMissingStopAlight` | {stop}에서 내리는 경로를 찾지 못했습니다. | 정류장 입력, 못 찾음 |
| `ios.journey.recentRouteStop` | {from}에서 {to}까지, {stop}에서 갈아타기 | 최근 경로(정류장 하나) |
| `ios.journey.recentRouteBothPlaces` | {from}에서 {to}까지, {board}, {alight}에서 갈아타기 | 최근 경로(둘 중 하나 이상 정류장) |
| `ios.journey.stationPlace` | {station}역 | `recentRouteBothPlaces`의 역 쪽 이름 |

- 지정 경로 제목이 버스면 정류장 문장이다(첫 판 판정 23의 대칭 — 추천 경로의 `recommendedHeadingBus*`와 같은 짜임). 역을 골랐는데 그 역 이름 정류장의 버스 경로가 잡히면 「강남역12번출구에서 버스를 타는 경로」로 들려 무엇이 잡혔는지 안다.
- 택시 앞 줄·도착 문장·택시 뒤 줄은 첫 판 정류장 문장(`taxiInStop`·`arrivedStop`·`egressNoneStop`)이 이미 버스 leg로 가른다.
- 정류장 이름은 ODsay·TOPIS 원문 그대로 말한다(「강남역.삼성전자」의 점은 VoiceOver가 읽지 않거나 짧게 쉰다 — 실기기 확인 항목).

## 7. 정식판 불변

- 정식판 앱·웹은 여정을 부르지 않는다(봉인 `experimentalJourneyEnabled` 그대로). 시트 변경은 역 칸 대상(실험판에서만 열림)에만 닿는다.
- `/api/route/journey` 미지정(`stops` 없음) 응답 바이트 동일 — 테스트로 잠근다.

## 8. 검증

- 단위: `tagoCityCodeOf` 표(서울·광역시·세종·제주·광주 자치구·도 시군·동명 고성·미등록), 역지오코딩 null·throw → `failed`(미제공 아님), 담양·화순류(표 null + 근접 정류소 `citycode=24`) → 광주 코드로 검색, TAGO 페이지 수집(가장 가까운 정류장이 둘째 페이지) · 5페이지 상한 → `truncated`, 정류장 검색 파서(TOPIS·TAGO 각각)·정렬·500m 같은 이름 제거·`unsearched`·`failed`·전부 실패 502, 시트 순서(역 → 정류장 → 그 밖)와 정류장 실패 줄, `busStopKey`·`isSameBusStop`·`busStopNamesStation` 공유 fixture(웹 ↔ Kit), `findDesignated` 강·약 순서(풀 사이 경쟁 포함), 재조회 순서·호출 수(정류장만 2회, 역만 3회, 미지정 종전 2회), 출구 생략(카카오 0회), 라우트 400(`boardKind` without `stops`)·바이트 동일.
- 실호출 게이트 `scripts/verify-journey-bus-stops.mjs`(`--out`/`--from-corpus`, 머지 게이트): ①정류장 이름 검색 — TOPIS(서울 공개 명소 이름)·TAGO(지방 광역시·도 시군 각 하나·행정구역과 제공 코드가 어긋나는 지역 하나, 도시코드는 좌표에서 유도)가 각각 결과를 주고 좌표가 그 도시 안인가 ②그 검색 결과의 정류장으로 지정한 여정(`getJourney`, `stops`)이 `designated`를 찾는가(서울·지방 각 하나) ③역 입력의 약 맞음 표본 하나(참고). TOPIS·TAGO 실호출 상한 30건(위원장 판정 허용분). ODsay 실호출 상한 10건(세션 전체), 카카오 상한 30건(세션 전체 — 이미 6건). 통과: 표본마다 designated 있음 ∨ (designatedMissing + 버스만 후보에도 그 정류장 이름이 실제로 없음을 보고) — 후자는 실패로 세어 판정 보고.
- iOS: Kit `swift test`, 앱 Experimental·Release 빌드.
- 실기기(위원장): FIELD-TEST §6-3에 행 추가 — 칸 검색의 정류장 줄 고르기(역 → 정류장 → 그 밖 순서), 정류장 이름 낭독(점), 정류장에서 택시 하차 판정.

### 8.1 실호출 게이트 결과 (2026-10-27)

`node scripts/verify-journey-bus-stops.mjs --out ~/gildongmu-private/probes/journey-bus-stops-2026-10-27` PASS, 같은 폴더 `--from-corpus` 재생 PASS(호출 0).

| 표본 | 검색 결과 | 여정 |
|---|---|---|
| 서울 TOPIS 「덕수궁」 | 2건(「시청앞.덕수궁」·「시청.덕수궁」) | 「시청.덕수궁」 승차 지정 → 709번 「시청앞.덕수궁」 승차(50m 조항) PASS |
| 서울 TOPIS 「광화문」 | 8건 | 검색만 |
| 부산 TAGO 「서면역」(광역시 21) | 3건 | 「서면역.롯데호텔백화점」 하차 지정 → 17번 하차, egress `none` PASS |
| 수원 TAGO 「수원역」(도 시군) | 10건 | 검색만 |
| 담양 TAGO 「담양」(행정구역 표 없음 → 근접 정류소 광주 24) | 10건 | 검색만 |

관측: ①이름이 다른 같은 자리 정류장(37m)을 다른 곳으로 보던 판정 결함 → §4.2 50m 조항. ②TAGO 동시 세션 한도 응답(HTTP 200 + resultCode 99)이 실제로 온다 → 검색은 `failed`로 표시(정상). ③후보 경로가 서지 않는 정류장(「서면역12번출구」, 실제 하차 정류장과 410m·다른 이름)을 고르면 「찾지 못했습니다」가 정직한 답이다.

실호출 누적: ODsay 5 · Tmap 9 · 카카오 42 · 정류장 검색(TOPIS·TAGO) 24 · 여정의 기존 노선 운행시간 조회 60.

## 9. 설계 리뷰

### 9.1 1회차 (codex adversarial-review, 대상 `3816fdb6` — 입력 경로를 장소 → 근처 정류장으로 두었던 판) — needs-attention, high 1 · medium 1, 전부 수용

- [high] 전체 후보의 약한 버스 맞음이 지하철만 재조회를 막아 지정 역의 지하철 경로를 놓친다 → §4.3을 "강이 약보다 앞선다 — 풀 사이에서도" 네 단계로 바꾸고 경쟁 회귀 테스트를 검증에 넣었다.
- [medium] `unavailableHere(noBusData)`를 「근처에 정류장이 없습니다」로 접으면 미제공이 없음으로 위장한다(3-state 붕괴) → 입력 경로가 바뀐 뒤에도 같은 원칙을 §3·§4.6 `unsearched`로 지킨다.

위원장 판정(2026-10-27 21:05)으로 입력 경로가 정류장 이름 검색으로 바뀌어 2회차를 새 spec으로 돌린다.

### 9.2 2회차 (codex adversarial-review, 대상 `d8901a6b` + 서버 술어 커밋 `1cd5bcfd`) — needs-attention, medium 3, 전부 수용. §4.2·§4.3 구현엔 추가 지적 없음

- [medium] 역지오코딩 실패(null)를 `unsearched` → 「제공되지 않습니다」로 보내 카카오 장애가 미제공으로 위장 → §4.6-1에서 null·throw는 `failed`.
- [medium] 행정구역 → 도시코드 표만 쓰면 담양·화순처럼 인접 광역시 코드로 제공되는 지역을 건너뜀 → 서울 밖 좌표는 근접 TAGO 정류소의 `cityCode`를 대상에 더한다.
- [medium] TAGO 첫 100건만 정렬하면 가까운 정류장이 빠짐 → `totalCount`까지 최대 5페이지 수집 뒤 정렬, 상한이면 `truncated` + 「정류장 이름을 더 길게 입력해 주세요.」, `q` 두 글자 이상.

### 9.3 구현 리뷰(묶음별 opus 서브에이전트)

- 서버 판정(A): MAJOR 2(옵트인 게이트 테스트 검출력, 자택 부근 예시 이름) · MINOR 6, 전부 반영.
- 정류장 검색(A2): MINOR 6, 반영(502 경계, TAGO 2페이지부터 병렬·중간 실패는 그 도시 실패, 테스트 공백, 빈 키 중복 제거). 구현자 차이 4건(키 기준 같은 이름, 지역 판정 실패 좌표의 근접 조회, 광주 24는 통합 시도만, `arsId` "0" 생략) 수용.
- Kit(B): MINOR 5 중 4 반영. 공백 문자 차이(U+FEFF·U+0085·점 뒤 결합 문자)는 실데이터 가능성이 낮아 두었다.
- 실호출 게이트가 판정 결함 하나를 찾았다: 이름이 다른 같은 자리 정류장(37m) → §4.2 50m 조항.


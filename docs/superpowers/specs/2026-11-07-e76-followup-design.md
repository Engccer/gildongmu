# E76 후속 — 지금 서 있는 정류소 기준 노선 목록 · 「이미 탔어요」 뒤 번호 없는 문장 · 지방버스 대기 목록 노선 전부 (2026-11-07)

정본 판정: `docs/BACKLOG.md` §5 **E76 후속**의 「▶ 위원장 판정 2026-11-07」(ⓔⓕⓓ). 바탕 계약은 E76 spec `2026-10-31-e76-bus-lane-set-design.md`(이하 「E76 spec」)이고, 이 문서는 **그 계약의 어느 자리를 바꾸는가**로 적는다. 범위: 서버(`/api/transit/track`) + 웹 안내 + iOS 안내(Kit 판정 미러). 안드로이드는 대중교통 안내가 없어 범위 밖이다(Kit 새 파일은 등록부 `pending`만).

설계 리뷰 판정(글로벌 지침 「개발 리뷰」 4종): **새 외부 통합 계약**(TOPIS 경유 정류소를 노선마다 부르는 새 호출 경로)에 해당 → codex 적대적 설계 리뷰 1회(2026-11-07, needs-attention 5건 전부 반영 — §9). ⓕ·ⓓ는 기존 판정의 확장이라 그 리뷰에 같이 실었다.

## 1. 판정 → 바뀌는 계약

| 판정 | E76 spec 자리 | 바뀌는 것 |
|---|---|---|
| ⓔ 지금 서 있는 정류소 기준 집합(서울버스) | §6 둘째 항목(범위 밖) · §4.1 「집합은 세션 내내 그대로」 · §4.3 취소 | 승차 중 [탑승 변경]이 서울버스에서도 「지금 어느 정류장」을 묻고(§2.1), leg를 그 정류장 기준으로 바꾸며(§2.2), 그 정류장의 집합을 서버가 다시 센다(§2.3, 새 `phase=lanes`). 집합 불변은 「한 승차 기준 안에서」로 좁혀진다. |
| ⓕ 노선 여럿인 구간의 [이미 탔어요] 뒤 번호 없는 문장 | §6 셋째 항목 | 근사 잠금 ∧ 집합 둘 이상이면 승차 중 문장의 노선 자리가 「버스」다(§3). 묻는 단계는 없다. |
| ⓓ 지방버스 대기 목록 노선 전부 | §4.1 「지방버스는 대상이 아니다」 · §6 첫 항목 | 지방버스 leg도 안내 집합을 갖고(키 = 노선 번호), 대기·승차 폴이 집합 전부를 받는다(§4). 잠금 버튼은 하나 그대로, 탄 뒤 문장은 ⓕ와 같다. |

## 2. ⓔ 지금 서 있는 정류소 기준 노선 집합(서울버스)

### 2.1 언제 다른 정류소에서 다시 기다리는가 — 정류장 질문

- 증상(2026-10-18 420번): 승차 중에 한 정거장 전에 내려 [탑승 변경]을 눌렀더니 대기 국면이 **원래 승차 정류소**를 계속 조회했다. 웹 `beginReboard`·iOS `beginReboard`가 「지금 있는 역」 질문(A16 L3)을 지하철에만 열고, 버스는 곧장 `changeBoarding`이었기 때문이다(주석: "버스는 갈아타면 대개 다른 leg다"). 앱은 사용자가 어느 정류소에 서 있는지 알 길이 없었다.
- **riding 국면의 [탑승 변경]은 서울버스도 정류장을 먼저 묻는다** — 지하철 L3 질문과 같은 화면·같은 규칙이다(목록 = leg `viaStops`, 마지막 = 하차 정류장이면 도착 선언 A37 ②, 취소 = 상태 문장 착지). 질문 문장만 수단 낱말이 다르다(§5 `reboardStopPrompt`·`reboardStopCancel`).
  - 위치(GPS)로 짐작하지 않는 이유: 지하철 L3의 위원장 판정과 같은 결(질문이 확실하다). 버스 정류장은 GPS가 잡히지만 왕복 쌍 정류장이 길 양편 수십 m라 짐작이 틀리면 반대 방향 도착을 듣는다.
  - 열리는 조건: `trackMode == seoulBus` ∧ `viaStops`가 비지 않음 ∧ 모든 경유 정류장에 `arsId`·`localId`가 있다. 하나라도 없으면 종전대로 곧장 `changeBoarding`(원래 정류소 대기)이다 — 그 정류장으로는 대기 폴(`arsId`)도 하차 순번(`localId`)도 만들 수 없다.
- boarding 국면의 [다른 차량 선택]은 바뀌지 않는다(아직 원래 정류소에 서 있다).
- ⚠ 누르는 횟수가 하나 는다(서울버스 riding [탑승 변경] → 정류장 선택). 판정 ⓕ의 「누르는 횟수 그대로」는 [이미 탔어요]에 대한 것이라 충돌하지 않지만, 제품 판단이라 판정 요청 파일에 기본값으로 적는다.

### 2.2 leg를 그 정류장 기준으로 바꾼다 — `transitLegFromStop`

웹 `legFromStop(leg, index)`(`transit-guide.ts`) ↔ Kit `transitLegFromStop(_:index:)`. 정류장 `i`(0 < i < 마지막)를 고르면 **세션 경로의 그 leg를 바꾼 뒤** `changeBoarding`한다(E76 `legWithLane`과 같은 「leg 자체를 바꾼다」 계층 — 노선별·정류장별 문장 분기를 따로 두지 않는다).

| 필드 | 새 값 |
|---|---|
| `boardStop`·`boardName`·`boardNameEn` | `viaStops[i]`와 그 이름·영문 |
| `viaStops` | `viaStops[i...]` |
| `stationCount` | `viaStops.count − 1 − i`(원래 값이 null이면 null) |
| `walkBeforeMinutes` | null(지난 도보를 다시 말하지 않는다) |
| `lanes` | **지우고 `lanesPending: true`**(그 정류장의 집합은 §2.3 응답이 채운다 — 응답 전·실패는 「노선 모름」, §3) |
| 그 밖(`lineName`·`routeId`·`alightStop`·`exitAlight`…) | 그대로 |

- 지하철 L3처럼 표시 인덱스(`boardOverride`)를 덧씌우지 않는 이유: 서울버스 하차 추적(`phase=ride`)은 `boardId`(승차 정류장 `localId`)로 하차 순번을 푼다(`pickAlightOrd`). 새 정류장에서 **다른 노선**을 고르면 그 노선은 원래 승차 정류장을 지나지 않을 수 있어, 덧씌우기로는 `unsupported`가 된다. leg를 바꾸면 대기 폴·하차 폴·상태 문장·경유 목록이 전부 한 값을 읽는다.
- `i == 0`(원래 정류장)은 leg를 바꾸지 않는다 — 종전 `changeBoarding`과 같다.
- ⚠ **재기준은 대기 스냅숏과 3분 보관 후보(`retained`)를 비운다**(리뷰 H1): 종전 `changeBoarding`은 잘못 잠근 채 이동한 뒤 돌아올 때를 위해 보관분을 남기는데, 다른 정류장에서는 옛 정류장의 차량이 새 목록에 섞여 그 차량을 지금 leg 노선으로 잠그게 된다. 같은 정류장(`i == 0`)은 종전대로 남긴다.
- 재기준은 반복될 수 있다(인덱스는 그때 leg의 `viaStops` 기준).
- **취소**(`cancelChangeBoarding`): 재기준 직전 leg를 스냅숏으로 들고 있다가 「탑승 변경 취소」에서 그 leg로 되돌린 뒤 `restoreBoarding`한다. 스냅숏 leg는 직전 잠금의 노선이 이미 반영된 leg라 E76의 `selectLane(previous.routeId)`가 따로 필요 없다(스냅숏이 없으면 종전 경로). 스냅숏은 국면이 waiting을 벗어나거나(잠금) 다음 `changeBoarding`이 오면 버린다.

### 2.3 서버 — `/api/transit/track?mode=seoulBus&phase=lanes`

```
GET /api/transit/track?mode=seoulBus&phase=lanes&arsId={정류장 arsId}&boardId={정류장 localId}&alightId={하차 localId}&routeId={지금 leg 노선}&lang=ko|en
200 { mode: "seoulBus", status: "ok", routes: [{ routeId, lineName, lineNameEn? }], checked: n, unverified: m }
```

- `routes`는 **지금 leg 노선을 뺀** 나머지다. 클라이언트가 `[지금 노선] + routes`로 집합을 만든다 — 「첫 항목 = leg 자신」(E76 §2.2) 계약을 서버가 이름을 몰라 어기는 경로를 없앤다(지금 노선이 그 정류장 도착 목록에 없어도 첫 항목은 leg다).
- 판정(`trackSeoulLanes`, `transit-track.ts`):
  1. 정류장의 노선: TOPIS `getStationByUid(arsId)`(대기 폴과 같은 오퍼레이션, `no-store`)의 항목에서 `busRouteId`·`rtNm`. 같은 ID 중복 제거, 지금 노선 제외, 예약 노선(`(예약)`, E76 §2.2 정규식 공유) 제외.
  2. 같은 하차 정류장(판정 ⓑ와 같은 기준): 노선마다 `getStaionByRoute`(`fetchSeoulRouteStops`, **하루 캐시**, 하차 폴의 순번 해석과 같은 캐시 칸)를 받아 `pickAlightOrd(stops, boardId, alightId) != null`인 노선만 남긴다. ⚠ **그 정류장이 노선 경유에 두 번 이상 나오면(순환·회차) 뺀다**(리뷰 H2 — `pickAlightOrd`는 첫 회차를 골라 사용자가 선 회차 뒤의 하차가 아니라 지난 구간을 읽을 수 있다, `unverified`에 센다).
  3. 운행 시간: E76 §2.3과 같은 `fetchServiceHoursMap`(하루 캐시) — **밖으로 판정된** 노선만 뺀다. 판정 불가는 남긴다.
  4. 상한: `SEOUL_WAIT_ROUTE_SET_MAX − 1`(지금 노선 자리 하나). 순서는 TOPIS 응답 순서.
- **3-state**: ① 정류장 조회 실패(throw) → 502, 클라이언트는 단일 노선 대기를 계속한다(집합 없음) ② 노선 하나의 경유 조회 실패 → 그 노선은 **뺀다**(`unverified`에 센다). 운행 시간과 방향이 반대인 이유: 운행 시간은 「모르면 탈 수도 있다」지만 경유는 「모르면 다른 곳으로 갈 수도 있다」 — 엉뚱한 곳으로 가는 버스를 고를 수 있게 하는 쪽이 더 나쁘다 ③ 확인된 노선 0 → `routes: []`(집합 없음, 정상).
- `checked`·`unverified`는 계측·실호출 게이트용이다. 「매핑 미스가 미커버로 위장」(정류장 ID 축 어긋남이면 모든 노선이 조용히 탈락) 함정을 **0건이 아니라 `unverified` 수와 게이트 ②**로 잡는다.
- 경유 조회는 동시에 최대 5개(`SEOUL_LANES_CONCURRENCY`). 서버 메모리 캐시(노선별 하루, 같은 노선 동시 요청은 하나로 합침) **뒤에** 인스턴스 하루 예산 `SEOUL_LANES_DAILY_MISS_BUDGET` 300(가정 한도의 30%)을 둔다 — 캐시 적중은 예산을 쓰지 않고, 소진되면 그 노선은 `unverified`(집합이 작아질 뿐 단일 노선 대기는 그대로, 리뷰 M2).
- `lineNameEn`은 `lang=en`에서 `toDisplayEnglish(rtNm)`(E76 §2.2와 같은 함수 — 한글이 섞이면 부재).
- 요청 한도: 기존 IP 60초 20회(`checkTransitTrackRateLimit`) 안이다. 재기준 1회에 요청 1회라 폴 예산을 거의 쓰지 않는다.

### 2.4 클라이언트 — 집합 채우기

- 정류장을 고르면: leg 재기준 → `changeBoarding`(즉폴 = 그 정류장의 **단일 노선** 대기 폴, 목록이 바로 뜬다) → 동시에 `phase=lanes` 1회.
- 응답이 오면 **세대 결박**으로만 반영한다: 국면이 아직 waiting이고 지금 leg가 그 재기준 leg(재기준 순번이 같음)일 때만 `lanes = [지금 노선] + routes`(둘 이상일 때만, 상한 12)로 채우고 `lanesPending`을 지운 뒤 즉폴. 늦게 온 응답(그 사이 차량을 골랐거나 다른 정류장을 골랐거나 안내가 끝남)은 버린다 — 그 leg는 `lanesPending`이 남아 「노선 모름」으로 정직하게 남는다. 실패도 `lanesPending`을 남긴다.
- 실패·0건은 조용하다(통지 없음) — 단일 노선 목록이 이미 정직하게 떠 있고, 「다른 노선도 있을 수 있다」는 사용자 행동을 바꾸지 않는다.
- 집합이 채워지면 대기 문맥이 E76 §4.4 그대로 집합 전부를 말한다(「{정류장}에서 1711, 7016번 버스 탑승.」).

### 2.5 호출량 설계

**한도**: 공공데이터포털 TOPIS 세 서비스(버스도착정보 15000314·노선정보 15000193·정류소정보 15000303)와 TAGO 상세 페이지에는 트래픽 수치가 공개 표기되지 않는다(2026-11-07 확인, 로그인 마이페이지에만 있다). 이 설계는 **포털 개발계정 기본값 오퍼레이션당 일 1,000회**를 보수 가정으로 둔다. 실수치 확인은 위원장 몫(BACKLOG C4에 한 줄, 미결).

**키 공유**: TOPIS는 `DATA_GO_KR_API_KEY`(TAGO·지하철 시간표·공기질 등과 같은 키, 한도는 서비스·오퍼레이션 단위). E35 열차 위치·지하철 도착은 `SEOUL_SUBWAY_REALTIME_KEY`(서울 열린데이터 실시간 키, 일 1,000회)라 **이 예산과 나누지 않는다**.

| 오퍼레이션 | 지금 쓰는 곳 | 하루 기준치(개인 사용, 버스 leg 4개·대기 15분·승차 20분) | ⓔ가 더하는 것 |
|---|---|---|---|
| `getStationByUid` | 대기·boarding 폴(20초), 내 주변 버스 | 대기 45 × 4 = 약 180 | 재기준 1회당 1 |
| `getArrInfoByRoute` | 승차 폴(15초) | 80 × 4 = 약 320 | 0 |
| `getStaionByRoute` | 하차 순번 해석(노선당 하루 캐시) | leg당 1 = 4 | 재기준 1회당 정류장 노선 수 K(실측 5~20, 하루 캐시 — 같은 노선은 그날 다시 안 부른다) |
| `getRouteInfo`(운행 시간) | 경로 조회 운행 시간(노선당 하루 캐시) | 경로당 노선 수 | 재기준 1회당 ≤ K(하루 캐시) |

- 재기준은 「잘못 내린 날」의 일이라 하루 0~2회다. 최악 하루 2회 × K 20 = 경유 40·운행 시간 40 — 보수 가정 한도의 4%다. 캐시 덕에 상한은 요청 수가 아니라 **그날 처음 본 노선 수**로 묶인다(C4와 같은 구조).
- **예산은 캐시 뒤에 둔다**: 서버 메모리 캐시(노선별 하루)에 적중한 노선은 예산을 쓰지 않고, 미스만 인스턴스 하루 예산 300을 쓴다(메모리 「쿨다운·예산 게이트는 캐시 뒤」 — 앞에 두면 이미 캐시된 노선까지 막는다). 같은 노선의 동시 요청은 한 호출로 합친다. 소진은 그 노선 `unverified`이고 단일 노선 대기는 그대로다. 요청 자체의 남용 방어는 기존 IP 레이트리밋이다.
- ⚠ 재배포가 fetch 캐시를 비우면 그날 첫 재기준이 K를 다시 태운다(C4 「배포 직후」와 같은 최악) — 상한 안이다.

## 3. ⓕ [이미 탔어요] 뒤 번호 없는 문장

- 판정 술어 **`rideLineUnconfirmed(leg, lock)`**(웹 `transit-guide.ts` ↔ Kit `transitRideLineUnconfirmed`): `lock != nil ∧ isApproxTransitLock(lock) ∧ leg.mode == bus ∧ ((leg.lanes?.count ?? 0) >= 2 ∨ leg.lanesPending)`. `lanesPending`(재기준 뒤 집합 미조회·실패)도 「노선 모름」이다 — 응답 전에 [이미 탔어요]를 누르거나 조회가 실패하면 다른 버스를 탔을 수 있는데 번호를 확정해 말하게 된다(리뷰 M1). 서울버스 [이미 탔어요](비관측)와 지방버스(ⓓ, 근사가 유일한 잠금) 둘을 한 술어가 덮는다. 지하철은 집합이 없어 거짓이다. 노선이 하나인 구간은 거짓 — 지금처럼 번호.
- 술어는 상태에서 **유도**한다(leg에 표식을 저장하지 않는다): 잠금이 풀리면(탑승 변경) 자동으로 거짓이 되고, 취소로 근사 잠금에 돌아오면 자동으로 참이다. 저장 표식은 해제·복귀 경로마다 지우고 다시 세워야 해서 하나를 빠뜨리면 낡은 표식이 남는다.
- 소비자 — 승차 중 노선을 말하는 문장 전부:
  1. 문맥 `contextLine(isEn, leg, lineUnconfirmed)` — **셋째 인자는 기본값 없는 필수 인자**(웹·Kit). 참이고 버스면 키 `contextBusUnconfirmed` 「버스 탑승 중, {stop}에서 하차합니다.」(기존 「{line}번 버스 탑승 중, {stop}에서 하차합니다.」에서 번호 자리만 지운 초안, 확정은 판정 왕복). 쓰이는 자리: 상시 상태 문장·진행 상황·추적 시작 통지.
  2. iOS 띠바 승차 줄(`guide.band.transitRiding`·`…NoCount`의 `{line}` 자리): 참이면 `guide.band.busUnconfirmed` 「버스」를 넣는다(「버스 탑승 중, 남은 정거장 3개」).
  3. 지방버스 근사 주석(`approxNote` 「근사 추적: 같은 노선의 접근 차량 기준.」): 집합이 있으면 탄 노선을 모르므로 `approxNoteLanes` 「근사 추적: 추천 노선의 접근 차량 기준.」(초안, 판정 왕복) — 승차 중 카운트다운이 추천 노선 하나를 따른다는 것(§4)을 말한다.
- 바뀌지 않는 것: 대기 문맥(집합 전부를 말한다), 조망의 구간 행(경로 계획), 탑승 통지 `boarded`(노선 인자 없음), 하차 임박·도착 문장(하차 정류장만 말한다).

## 4. ⓓ 지방버스(TAGO) 대기 목록 노선 전부

- **안내 집합**: `guideLanesOf`가 `tagoBus` leg에도 집합을 만든다 — 키는 **노선 번호**(`lane.lineName`), TAGO 도착 `routeno`와 같은 축(단일 노선 추적 `trackTago`가 이미 `routeNo === leg.lineName`으로 거른다). 첫 항목이 leg의 `lineName`이 아니면 버린다. ID(`serviceRouteId`) 유무는 보지 않는다.
- **폴**: `/api/transit/track?mode=tagoBus&phase=track&…`에 `routeNo`(종전) 또는 `routeNos`(쉼표, 중복 제거 뒤 1~12) 중 정확히 하나. `routeNos` 폴은 항목마다 `route`(노선 번호)를 싣고 잔여 오름차순(서울 집합과 같은 `sortByRemaining`). `rawCount`는 종전대로 필터 전 정류소 도착 수. TAGO 도착 API는 정류소 전 노선을 한 번에 주므로 **추가 upstream 호출 0**.
- 집합 폴은 **waiting에만**이다. riding(근사 잠금 뒤 하차 정류소 도착)은 종전대로 **추천 노선 하나**(`routeNo`)다(리뷰 H3): 집합 전부에서 잔여 최소를 고르면 폴마다 다른 노선 버스로 기준이 바뀌는데, 리듀서는 근사 기준 교체를 잔여 증가로만 알아 A노선 5 → B노선 1이 「기준 교체」가 아니라 카운트다운 1·임박 톤으로 나온다(재현). 추천 노선 하나는 탄 노선이 아닐 수 있지만 수치가 한 노선 안에서 연속이고, 근사 주석(§3 ③)이 그 기준을 말한다. 탄 노선을 묻지 않는 판정 아래에서 더 나은 기준(관측으로 노선 고정 등)은 첫 관측 버스가 대개 앞서가는 다른 버스라 성립하지 않는다 — 실승차 판정 항목으로 남긴다.
- 대기 목록 줄은 서울 집합처럼 노선 번호가 맨 앞(`candidateDescLine`의 `route`, `laneForItem`). 줄은 버튼이 아니다(종전). [이미 탔어요](`boardApprox`)는 버튼 하나 그대로.
- 탄 뒤 문장은 §3(번호 없음).
- TAGO 동시 세션 한도(HTTP 200 + resultCode 99)는 기존 provider가 throw로 읽어 502 → `upstreamFailed`다(집합 폴도 같은 한 번의 호출이라 위험이 늘지 않는다).

## 5. 문자열(6로케일, `transitGuide.*` 자기 키만)

| 키 | ko 초안 | 쓰는 곳 |
|---|---|---|
| `contextBusUnconfirmed` | 버스 탑승 중, {stop}에서 하차합니다. | §3 ① |
| `approxNoteLanes` | 근사 추적: 이 구간 노선들의 접근 차량 기준. | §3 ③ |
| `reboardStopPrompt` | 지금 어느 정류장에 계신가요? | §2.1 |
| `reboardStopCancel` | 정류장 선택 취소 | §2.1 |
| iOS `guide.band.busUnconfirmed` | 버스 | §3 ② |

확정 문안은 판정 파일(`judgment-*.md`)로 위원장 TextEdit 왕복을 받고, 확정본이 오면 글자를 맞춘다. 기다리는 동안 초안으로 진행한다.

## 6. iOS

- Kit: `transitLegFromStop`·`transitRideLineUnconfirmed`·`transitContextLine(…, lineUnconfirmed:)`·TAGO 집합(`transitGuideLanes`의 tagoBus 갈래)·`TransitTrackService`의 `phase=lanes` 요청과 `routeNos`. 공유 fixture(`transit-guide-text-cases.json`)에 `contextBusUnconfirmed` 케이스를 더해 웹·Kit이 같은 판정을 읽는다.
- 앱: `TransitGuideModel`의 `beginReboard`(서울버스 갈래)·`changeBoardingAt`(재기준 + `lanes` 요청 세대 결박)·`cancelChangeBoarding`(스냅숏 복원)·폴 URL(`routeNos`)·`contextText`(술어 전달), `TransitTrackingSheet`의 정류장 질문 문장, 띠바 줄.
- E76은 정식판 2.5에 들어 있고 이 변경은 실험 게이트 밖이라 Release·Experimental 두 구성 배포.
- 다음 웨이브 E79가 `TransitGuideModel.swift`를 이어 고친다 — 바꾼 자리를 통합 보고에 함수 이름으로 적는다.

## 7. 실호출 게이트 `scripts/verify-bus-lanes-followup.mjs`

ODsay는 부르지 않는다(Flex 과금) — 경로는 E76 fixture `odsay-e70`의 공개 명소 구간(아현역 → 광화문역 271·273·721·270)과 TOPIS 실호출만 쓴다.

1. ⓔ 재기준 집합: 그 leg의 경유 정류장 `i = 1`과 `i = 마지막 − 1`에서 `trackSeoulLanes`를 태운다. PASS 조건: `checked ≥ 1` ∧ 지금 노선이 아닌 노선이 1개 이상 확인(정류장에 다른 노선이 있는 표본) ∧ 확인된 노선마다 `pickAlightOrd` 재검증. `unverified > 0`은 WARN, `checked > 0 ∧ 확인 0 ∧ unverified == checked`는 FAIL(ID 축 어긋남 = 매핑 미스).
2. ⓔ 키 호환: 확인된 집합으로 그 정류장 집합 대기 폴(`trackSeoulWait` `routeIds`)에 1개 이상 나타나는가(0이면 FAIL, 일부 없음 WARN).
3. ⓓ TAGO: 공개 명소 지방 정류소 하나(TAGO 해석 가능 좌표)의 도착 전체에서 노선 번호 둘 이상을 `routeNos`로 폴해 `route`가 실리고 잔여순인지. 표본 정류소 도착이 0이면 「측정 못 함」(PASS 아님).
- 상한 `BUS_CAP` 60(TOPIS·TAGO 합). `--out <저장소 밖>`·`--from-corpus` 규약은 `verify-bus-lanes.mjs`와 같다. 결과 corpus는 보고 디렉터리에 둔다.

## 8. 범위 밖

- 정류장 질문 없이 GPS로 지금 정류장을 짐작하기(§2.1 근거).
- 경로 밖 정류장(경유 목록에 없는 곳까지 걸어간 경우) — 그때는 새 길찾기다.
- 지방버스 재기준(TAGO는 [탑승 변경]이 없다, 종전).
- ODsay가 묶지 않은 노선의 원래 승차 정류소 집합 보강(E76 §6 넷째) — 재기준한 정류장만 서버가 센다.
- 안드로이드.

## 9. 설계 리뷰 반영(codex 적대적 리뷰 2026-11-07, `e76-followup-reports/review-design-202611070659.md`)

| 지적 | 처리 |
|---|---|
| H1 재기준에 옛 정류장 보관 후보가 남는다 | 반영 — 재기준은 스냅숏·보관분을 비운다(§2.2). 같은 정류장은 종전대로 |
| H2 순환 노선에서 정류장 ID만으로 회차를 못 가른다 | 반영(새 경로) — 그 정류장이 두 번 이상 나오는 노선은 집합에서 뺀다(§2.3). 지금 leg 노선 자체의 하차 폴(`trackSeoulRide`)이 첫 회차를 고르는 것은 B2부터의 기존 동작이라 범위 밖(재기준 leg도 같다) |
| H3 지방버스 승차 중 집합 최솟값이 다른 노선으로 튀어 임박 톤 | 반영 — 집합 폴은 대기에만, 승차 중은 추천 노선 하나(§4). 주석 문안 교체(판정 보강 `judgment-202611070720.md`) |
| M1 집합 미조회·실패를 단일 노선 확정으로 읽는다 | 반영 — `lanesPending`도 「노선 모름」(§3) |
| M2 개인 사용 가정은 공개 팬아웃 상한이 아니다 | 반영 — 메모리 캐시 뒤 하루 예산 + 동시 요청 합침(§2.3). 실제 계정 한도 확인은 위원장 몫(미결, 출시를 막지 않는다 — 소진 시 단일 노선 대기 보존) |

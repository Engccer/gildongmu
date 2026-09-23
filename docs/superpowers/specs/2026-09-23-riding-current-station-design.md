# 승차 중 현재역을 실제 열차 위치로 채운다 (E35)

> 판정 한 줄(리뷰 게이트): 새 외부 계약(서울 `realtimePosition`)과 승차 상태 머신 옆에 붙는 표시 상태라 **설계 단계 적대적 리뷰 대상**이다(글로벌 codex 운영 ①·②). 리뷰 결과는 §10.

## 0. 요지

승차(riding) 중 경유역 목록의 "현재 위치" 표식은 지금 하차역 **도착** 정보의 `arvlMsg3`에서만 나온다. 그 값은 내 열차가 하차역 도착 목록에 실린 뒤에야 생기므로 승차 초반 10분 안팎은 표식이 없다(2026-09-09 실측 10분 54초). 서울 실시간 **열차 위치**(`realtimePosition`)는 노선 단위로 운행 중 열차의 현재역을 주고, 그 열차번호(`trainNo`)는 도착 API `btrainNo`와 같은 식별자다. 잠근 열차를 열차번호로 찾아 **표식만** 채운다.

**표시 전용 계약**: 승차 상태 머신(`transitGuideReduce`)의 입력·상태·전이는 한 줄도 바뀌지 않는다. 도착·riding 승격·하차·`neverSeen` 판정은 도착 API가 그대로 한다. 위치는 상태 머신 밖의 별도 표시 상태가 들고, 화면·문장이 그것을 읽는다(판정서 `2026-08-23-express-stop-data-verdict-design.md` §3 기각 사유 1~11은 전부 "판정을 위치로 대체"에서 나왔다 — 이 설계는 그 경로를 만들지 않는다).

## 1. 범위

| 면 | 무엇이 바뀌나 |
|---|---|
| 서버 | 새 provider `seoul-subway-position.ts` + 노선 단위 캐시 + 새 라우트 `GET /api/transit/position` |
| 순수 계층 | 웹 `src/lib/transit-riding-position.ts` ↔ Kit `TransitRidingPosition.swift` 미러 + 공유 fixture `transit-riding-position-cases.json` |
| 웹 | `useTransitGuide` 폴에 위치 조회를 얹고, `TransitGuidePanel` 경유역 목록 표식·상태 문장이 그것을 읽는다 |
| iOS | `TransitGuideModel` 폴에 위치 조회를 얹고, 경유역 목록·상태 문장·조망(`overview`)·주변 확인 앵커·다른 경로 출발점이 그것을 읽는다. 대중교통 안내는 EXPERIMENTAL 봉인 안 그대로 |
| 안드로이드 | 없다. 새 Kit 파일은 미러 등록부 `guide.json`에 `pending`으로 싣는다(대중교통 안내 화면이 안드로이드에 아직 없다) |

**범위 밖**: `updnLine`(규격 문언과 실측이 반대 — 쓰지 않는 것이 방어, §2) · 잔여 정거장 계산(위치 index 차로 잔여를 만들지 않는다 — 판정서 §3 5번, 급행 잠금 × 완행 leg에서 거짓) · 버스 · 비수도권 · 기기 좌표(E36 ⓐ′ "keep-alive 좌표를 실제로 쓴다"는 이 설계가 채우지 않는다 — §9 열린 판정).

## 2. 외부 계약 (실측)

**2026-09-23 14:50 KST 탐색 실호출 4건**(위치 5호선·2호선, 도착 강동·강남):

- 호출: `http://swopenapi.seoul.go.kr/api/subway/{KEY}/json/realtimePosition/{start}/{end}/{노선명}` — 도착 API와 같은 호스트·키(`SEOUL_SUBWAY_REALTIME_KEY`)·http 전용.
- 봉투: 정상 `{ errorMessage:{ code:"INFO-000", total }, realtimePositionList:[…] }`, 데이터 없음은 평면 `{ status, code:"INFO-200", message }` — **도착 API와 같은 봉투 계열**이라 결과 코드 판독(중첩 → 평면)을 공유한다. 서울 열린데이터 일반(`readSeoulOpenJson`)·data.go.kr(`datagokr-envelope`) 파서와는 다른 봉투라 그쪽에 넣지 않는다.
- 행: `trainNo` · `statnNm`(부역명 포함, 예 `군자(능동)`) · `trainSttus` · `recptnDt`(KST `yyyy-MM-dd HH:mm:ss`) · `updnLine` · `directAt` · `lstcarAt` · `subwayId` · `statnTid`/`statnTnm`(종착).
- 건수: 5호선 33행(total 33), 2호선 36행(total 36) — `0/99` 창으로 전량.
- **조인 8/8**: 강동 도착 5호선 4편성·강남 도착 2호선 4편성의 `btrainNo`가 전부 해당 노선 위치 목록의 `trainNo`에 있었다. 신분당선(1077) 3편성은 2호선 목록에 없는 것이 정상(노선이 다르다).
- `trainSttus`: 0 진입 · 1 도착 · 2 출발 · **3 전역 출발**(직전 역을 떠나 `statnNm`으로 가는 중). 3은 2026-08-03 조사에 없던 값이다. 같은 순간 도착 API `arvlMsg3`는 직전 역을 말하고 위치 API는 3으로 다음 역을 말하는 사례가 있었다(5128: 도착 `굽은다리` / 위치 `길동`, 3) — **위치 피드가 도착 피드보다 한 역 앞서 바뀐다.** 2026-09-09 위원장 요청 ①("역간 중간 지점에서 바뀌면 좋겠음")이 표식을 `statnNm`에 두는 것만으로 채워진다.
- `recptnDt` 나이: 조회 시각 대비 0~2분(도착 API보다 늦을 수 있다).
- `updnLine`: 이번 표본의 대응은 상행·내선=`0`, 하행·외선=`1`(8편성). 규격 문언과의 대조는 하지 않았다 — 2026-08-03 조사가 "규격과 반대"로 기록했고, **쓰지 않으므로 다시 판정할 필요가 없다**. 조인은 노선 + 열차번호로 충분하다.

## 3. 서버

### 3.1 provider `src/lib/providers/seoul-subway-position.ts`

- `fetchSubwayLinePositions(line: string): Promise<SubwayLinePositions | null>` — `line`은 서울 표기(`5호선`). 키 없음 → `null`. INFO-000 → `{ trains, total }`. **INFO-200 → `{ trains: [], total: 0 }`**(운행 밖과 노선 미제공이 같은 코드 — 도착 추적의 4-state 교훈과 같은 이유로 "0행"으로 둔다, 아래 라우트가 `notFound`로 말한다). 그 밖의 코드·HTTP 오류 → throw.
- 행 정규화는 `trainNo`·`statnNm`·`trainSttus`·`recptnDt` 넷만 싣는다(`updnLine`은 파싱하지 않는다 — 소스에 이름이 없으면 나중에도 못 쓴다).
- 조회 창 `0/99`(100행). `total > 행 수`면 `truncated: true`를 싣고 서버 로그 1줄 — 그때 못 찾은 열차는 `notFound`다(조용한 은폐가 아니라 로그로 드러나는 한계). 러시아워 2호선 편성 수는 게이트에서 한 번 더 본다(§8).
- **노선 단위 캐시**: 모듈 수명 `Map<노선, {at, value}>`, TTL **20초**, 비행 중 요청 공유(`inFlight` Map — `odsay-express-stops.ts` 선례). 실패는 캐시하지 않는다(일시 장애가 굳지 않게). Next 데이터 캐시(`fetch` `revalidate`·`unstable_cache`)를 쓰지 않는 이유: stale-while-revalidate라 한동안 조회가 없던 노선의 첫 요청이 **낡은 목록**을 받는다 — 실시간 표식에선 그것이 곧 거짓 위치다. 인스턴스 간 공유는 없다(Fluid 인스턴스 재사용 범위 안에서만 공유 — 현 규모에서 충분하고, 부족하면 쿼터 계측이 먼저 말한다).

### 3.2 라우트 `GET /api/transit/position?line={ODsay 노선명}&train={열차번호}`

- `dynamic = "force-dynamic"`, 응답 캐시 없음. 레이트 리밋 전용 저장소 60초 10회(riding 미관측 주기 60초 + 첫 폴 15초 + 복귀 즉폴 여유).
- 파싱(zod: `line` 1~30자, `train` `^[0-9A-Za-z]{1,10}$`) → 노선 매핑(`subwayIdForOdsayLine` → `subwayLineNameForId`, 추적 라우트와 같은 표) → 키 게이트 → upstream. 좌표 입력이 없어 커버리지 마커는 해당 없다.
- 응답(판별 union, 3-state + 조인):

| 응답 | 뜻 |
|---|---|
| `200 {status:"found", station, trainStatus, dataStamp, dataAgeSeconds}` | 그 열차가 목록에 있다. `dataAgeSeconds`는 서버 계산(`parseRecptnDt` 재사용, 미래값 0 클램프, 파싱 불가 `null`) |
| `200 {status:"notFound", total}` | 목록은 받았는데 그 열차가 없다(INFO-200 포함, `total: 0`) — "정보 없음" |
| `200 {status:"unsupported"}` | 노선이 매핑표 밖이거나 키가 없다 — 이 leg에선 다시 묻지 않는다 |
| `502 {error}` | upstream 실패 — "조회 실패" |

`lang`은 받지 않는다: 역명은 조인 키로만 쓰이고 화면 라벨은 leg의 경유역 표시 투영(영문 포함)에서 고른다.

## 4. 순수 계층 (웹 ↔ Kit 미러, 공유 fixture)

```
TransitPositionOutcome = found(station, dataAgeSeconds?) | notFound | unsupported | failed
TransitRidingPosition = { legIndex, phaseGen, vehicleId,      // 결박: 이 riding 진입·이 열차
                          stopIndex?, lastFoundAt?,           // 래치(단조)와 마지막 관측 시각
                          lookups, stopped }
```

1. **`transitPositionLookupDue(state, leg, position) -> Bool`** — 켜는 조건(§5 ①). 전부 참일 때만:
   `phase == riding` ∧ `leg.trackMode == subway` ∧ 식별 잠금(`lock.vehicleId` 비어 있지 않음 — 근사·비관측 잠금 제외) ∧ `signal ∈ {notYetVisible, neverSeen}` ∧ (결박이 같으면) `!stopped ∧ lookups < 30`.
2. **`transitRidingPositionStep(prev, state, leg, outcome, now) -> TransitRidingPosition`** — 결박(`legIndex`·`phaseGen`·`vehicleId`)이 다르면 새로 시작. `lookups += 1`.
   - `found`: 나이가 `null`이거나 300초 초과면 관측으로 치지 않는다(동결 레코드). 아니면 `uniqueViaStopIndex(leg, station)`(조망과 같은 유일 매칭 — 동명 반복은 모호). 매칭 없음(승차역 전·하차역 너머·표기 불일치)은 관측으로 치지 않는다. 매칭 index가 래치보다 **작으면 무시**(열차는 뒤로 가지 않는다 — 뒤로 가는 표식은 데이터 흔들림이다), 같거나 크면 `stopIndex = index`, `lastFoundAt = now`.
   - `notFound`·`failed`: 상태 불변(카운트만).
   - `unsupported`: `stopped = true`.
3. **`transitPositionShownIndex(state, leg, position, now) -> Int?`** — 결박이 현재와 같고 `phase == riding`이고 `now − lastFoundAt ≤ 180초`일 때만 `stopIndex`. **보존 창 180초 = riding 미관측 주기 60초 × 3** — 한두 번의 누락·실패로 표식이 깜박이지 않고, 세 번 연속이면 낡은 값을 더 주장하지 않는다.
4. **`transitViaStopHereIndex(state, leg, position, now) -> Int?`** — 경유역 목록의 표식. 도착 유래 `viaStopCurrentIndex(leg, state.currentLocation)`(현행)와 위치 유래 `shownIndex` 중 **큰 값**(둘 중 하나만 있으면 그것). 큰 값인 이유: 인계 순간 도착 `arvlMsg3`가 위치보다 한 역 뒤일 수 있어(§2) 작은 값을 고르면 표식이 한 칸 뒤로 튄다.
5. **`transitPositionStatusIndex(state, leg, position, now) -> Int?`** — 상태 문장이 위치를 말할 index. `signal ∈ {notYetVisible, neverSeen}`이고 `shownIndex`가 있을 때만. 추적 중(`tracking`)은 도착 조각이 이미 말하므로 nil, 소실·실패 신호는 그 신호 문장이 정본이라 nil.
6. **`transitOverviewApplyingPosition(overview, state, leg, position, now) -> TransitOverview`** — 조망 후처리. 기존 `transitProgressOverview`와 그 fixture는 **그대로** 두고(안드로이드 이식본을 흔들지 않는다) 결과에 얹는다:
   - `here == .station(a)`이고 `shownIndex = p > a` → `.station(p)`.
   - `here == .unknown(.noObservation)`이고 `statusIndex = p` → `.station(p)`.
   - 그 밖(`signalLost`·`upstreamFailed`·`ambiguous`·국면 밖)은 불변 — 위치가 신호 문장을 덮지 않는다.
   - 현재 leg 정차역 행의 `here` 플래그를 새 `here`에 맞춘다. silence 행·`reboardOffered`는 **불변**(탈출구를 지우지 않는다 — 판정서 §3 4번).
7. **`transitSurroundingsAnchorFor(here, leg)`** — 기존 `transitSurroundingsAnchor`와 같은 규칙을 `here` 인자로 받는 판(후처리된 조망의 `here`를 쓰게). 기존 함수는 그대로 둔다(안드로이드 이식본).

상수(웹·Kit 동일값): `transitPositionLookupCap = 30` · `transitPositionHoldMs = 180_000` · `transitPositionMaxAgeSeconds = 300`. **셋 다 잠정값**(실승차 판정 대상, §9).

## 5. 설계 결정

### ① 언제 위치 조회를 켜는가 — 도착 피드가 아직 열차를 못 본 riding 구간에서만

- 켜는 구간이 곧 **표식이 없던 구간**이다: riding 진입 뒤 하차역 도착 목록에 내 열차가 실리기 전(`notYetVisible`, 10폴 뒤 `neverSeen`). 도착 피드가 열차를 보기 시작하면(`tracking`) 끈다 — 그때부터 표식은 현행대로 도착 `arvlMsg3`가 채우고, 위치 조회는 새 정보를 주지 않는 추가 호출일 뿐이다.
- 정상 초기 미관측과의 구분: **상태 머신의 신호는 그대로 `notYetVisible`이다**. 구분은 신호가 아니라 표시 계층에서 한다 — 위치가 잡혔으면 상태 문장의 신호 자리를 위치 문장이 차지한다(§6 판정 1). 그렇지 않으면 A33 문장("하차역에 가까워지면 열차 위치가 표시됩니다.")이 바로 옆 경유역 목록의 "현재 위치"와 모순된다.
- **표식이 있다가 없어지는 경로를 구조로 줄인다**: ⓐ인계 — 도착 쪽이 잡히는 순간 위치 조회를 끄지만 보존 창(180초) 동안 위치 표식이 남고, 경유역 표식은 두 출처 중 큰 값이라 도착 `arvlMsg3`가 한 역 뒤여도 뒤로 튀지 않는다 ⓑ일시 누락·실패 — 보존 창 안에서는 표식 유지 ⓒ단조 래치 — 흔들린 레코드가 표식을 뒤로 끌지 않는다. 남는 소멸은 "세 번 연속 위치를 못 받았고 도착 쪽도 아직 못 봤다"뿐이고, 그때 낡은 역을 계속 말하는 것은 거짓이라 소멸이 정직하다(상태 문장은 A33 문장으로 돌아간다).
- 근사·비관측 잠금은 켜지 않는다: 열차번호가 없다(A34 ① "어느 열차인지 모르므로 폴하지 않는다"와 같은 선).
- 첫 조회는 riding 첫 폴(15초)에 같이 나간다 — 승차 직후 표식이 승차역(또는 다음 역)으로 곧장 선다.

### ② 쿼터 — 노선 캐시 + leg당 30회 상한

- `SEOUL_SUBWAY_REALTIME_KEY` 일 1,000회를 도착 API와 나눈다. 위치 조회는 **별도 타이머가 없다** — riding 폴 한 번에 최대 1회 얹힌다(도착 조회·dispatch 뒤, 갱신된 상태로 `lookupDue`를 판정). 그래서 주기는 riding 미관측 주기(첫 15초, 이후 60초)를 따르고, E36 유휴 폴 정지·백그라운드 폴·세션 폴 상한(240)·즉폴 금지 규칙을 전부 자동 상속한다.
- **세션당 증분 상한(수치)**: riding leg 결박 하나당 위치 조회 ≤ **30회**(60초 주기로 30분). 전형은 미관측 구간 10분 안팎(09-09 실측 10분 54초)이라 **leg당 10~12회**, 도착 쪽 같은 구간 호출 수와 1:1이다. 한 세션(탑승 leg 2개 가정)의 증분 상한은 60회.
- 서버 노선 캐시(20초)가 같은 노선을 동시에 타는 세션들의 호출을 하나로 합친다. 도착 조회는 역 단위라 합칠 수 없지만 위치는 노선 단위라 합칠 수 있다 — 이것이 "쿼터 배증"에 대한 구조적 답이다(사용자가 늘수록 증분 비율이 준다).
- 상한에 닿으면 조회를 멈추고 보존 창이 지나면 표식이 사라진다(상태 문장은 A33 문장으로).

### ③ 웹·iOS 동조

웹 `TransitGuidePanel`에 같은 표식이 있다(경유역 목록 `viaStopCurrentIndex`). 그래서 **순수 계층 미러 + 공유 fixture**, 웹 훅·패널과 iOS 모델·시트를 함께 고친다. iOS에만 있는 소비자(조망·주변 확인 앵커·다른 경로 출발점)는 iOS만. 웹은 전경 전용 폴이라 백그라운드 위치 조회도 없다(현행 웹 폴 계약 그대로).

### ④ 3-state — 조인 실패·결측·조회 실패를 뭉개지 않는다

- 라우트가 `found`/`notFound`/`unsupported`/502를 가른다. 클라이언트 순수 계층은 결과를 `TransitPositionOutcome` 넷으로 받고, 조인 실패(매칭 없음·모호)와 동결(나이 초과)을 "관측 아님"으로 따로 판정한다.
- **표식은 "있다"만 주장한다.** 없는 표식은 "모른다"이지 "없다"가 아니다(조망 불변식 "없는 표식은 거짓이 아니지만 있는 표식은 거짓일 수 있다"). 그래서 네 사유 모두 화면에서는 표식 부재 + 현행 신호 문장으로 나가고 **새 문구를 만들지 않는다** — 사유를 사용자에게 가르는 문장은 행동을 바꾸지 않는다(위치 조회 실패에 사용자가 할 일이 없다).
- 사유는 계측 로그에 남긴다(iOS `transitGuideLog` `posPoll seq= outcome= station= idx= age=` 1줄/조회) — 실승차 사후 판정에서 "결측이었나 조인 실패였나"를 가를 유일한 증거다.

## 6. 사용자에게 보이는 변화 (코디네이터 판정 대기 2건)

**새 문구 키는 없다.** 기존 키 `transitGuide.currentStation`("현재 위치 {station}.")·`viaCurrent`("현재 위치")를 새 자리에서 쓴다.

**판정 1 — 상태 문장의 신호 자리**(권고안으로 구현, 반려되면 되돌린다): 위치가 잡혀 있으면(`statusIndex`) 신호 문장(`stateRidingNotYetVisible`·`stateNeverSeen`) 자리에 `현재 위치 {역}.`을 쓴다. 조망 silence 행·백그라운드 복귀 낭독의 상태 문장도 같은 선택기를 지난다.

> 현행: 수도권 5호선 탑승 중, 동대문역사문화공원에서 하차합니다. 하차역에 가까워지면 열차 위치가 표시됩니다. 약 12개 정거장. 16:19 기준.
> 변경: 수도권 5호선 탑승 중, 동대문역사문화공원에서 하차합니다. 현재 위치 길동. 약 12개 정거장. 16:19 기준.

**판정 2 — `neverSeen` 1회성 경고**(권고안으로 구현): 위치가 잡혀 있는 동안 `neverSeen` 전이가 일어나면 그 경고(통지 "탑승하신 차량을 찾지 못하고 있습니다. 다른 차량을 타셨다면 탑승 변경을 눌러 주세요." + 경고음)를 **내지 않고 보류**한다. 보류 중 위치 표식이 사라지면(보존 창 경과) 그때 경고를 낸다. 상태 머신의 `neverSeen`·탈출구([탑승 변경])는 그대로다. 근거: 그 문장의 전제("찾지 못하고 있습니다")가 거짓이 된다 — 잠근 열차가 우리 경로를 따라 움직이는 것이 보이는데 "못 찾는다"고 말하게 된다. 도착 목록 미등장은 대부분 "아직 멀다"(A33)였고, 위치가 그 경우를 가려낸다. 대안은 "그대로 낸다"(표식과 경고가 동시에 들린다).

시안 파일: `~/gildongmu-wt/e35-reports/copy-draft-*.md`.

## 7. 비채택안

- **상태 머신 입력으로 위치를 넣기**: 판정서 §3이 기각(11건). 이 설계의 위치 상태는 리듀서 밖에 있고 리듀서는 그 존재를 모른다.
- **클라이언트가 노선 목록 전부 받기**: 50행을 매 폴 내려받아 열차를 찾는 것은 서버 필터와 결과가 같고 전송만 크다.
- **`trainSttus`별 문장**("길동 진입 중."·"다음 역 길동." — 기존 키 `subwayArriving`·`subwayNextStop`): 더 세밀하지만 그 키들은 A27에서 **하차역**을 말하는 자리라 같은 틀로 다른 역을 말하면 "다음 역"이 하차 신호로 오독될 수 있다. 요청 ①은 표식이 `statnNm`(전역 출발 시 다음 역)으로 앞서 바뀌는 것으로 채워진다. 필요해지면 별건.
- **시간표 평균 나누기**: 어림이고 어긋남을 알 수 없다(BACKLOG E35). 실데이터가 있으니 쓰지 않는다.
- **별도 위치 폴 타이머**: 주기·유휴·백그라운드·상한 규칙을 전부 다시 짜야 한다. 폴 한 번에 얹으면 상속된다.
- **Next 데이터 캐시로 노선 공유**: §3.1(낡은 목록).
- **잔여 정거장을 위치 index 차로 계산**: 판정서 §3 5번(급행 잠금 × 완행 leg에서 절반).

## 8. 검증

- **실호출 게이트**(머지 조건, 낮 시간대, 수십 건 이내): `scripts/verify-transit-position.mjs` — 5호선·2호선 각각 한 역의 도착 목록에서 열차번호를 뽑아(도착 2건) **우리 라우트**(로컬 dev)로 위치를 물어 `found` 비율과 역명이 그 노선 seed 역명과 정규화 일치하는지를 단언한다. 없는 열차번호 1건으로 `notFound`, 매핑 밖 노선 1건으로 `unsupported`를 확인한다(upstream 0회). 조회 창 확인: `0/5`로 `total > 행 수`가 `truncated`로 나오는가. 호출 수를 보고에 적는다. ODsay는 부르지 않는다.
- 공유 fixture `transit-riding-position-cases.json`을 웹 vitest·Kit `swift test`가 같은 입력·기대로 돈다(켜는 조건·결박·단조·보존 창·동결·조인 실패·큰 값 선택·조망 후처리).
- 서버 단위 테스트: 봉투 두 형(중첩·평면), INFO-200 → 0행, 행 정규화에 `updnLine` 부재, 캐시 TTL·비행 공유·실패 비캐시, 라우트 union 네 갈래·400·429.
- 소스 가드: 상태 머신 파일(`transit-guide.ts`·`TransitGuide.swift`)이 위치 모듈을 import하지 않는다(표시 전용의 1선이 구조, 2선이 이 가드).
- 변이 주입: 단조 가드 제거·보존 창 무시·`max` → `min`·켜는 조건에서 `tracking` 허용 — 각각 fixture가 빨개지는지 커밋 뒤에 실측.

## 9. 열린 판정·잠정값

- §6 판정 1·2(코디네이터).
- **E36 ⓐ′(keep-alive 좌표를 실제로 쓴다)와의 관계**: 이 설계는 서버 열차 위치를 쓰고 기기 좌표는 쓰지 않는다(지하에서 fix가 없다 — 조사 §3.1). ⓐ′ 판정문은 "E35와 한 묶음"이라 적었으므로, 좌표 소비(버스 현재 정류장 추정 등)를 별건으로 둘지 코디네이터 판정이 필요하다.
- 잠정 상수 셋(30회·180초·300초) — 실승차 로그(`posPoll`)로 판정.
- 조회 창 100행이 러시아워 2호선에서 모자라는가(`truncated` 로그).

## 10. 설계 리뷰

(리뷰 뒤 채운다)

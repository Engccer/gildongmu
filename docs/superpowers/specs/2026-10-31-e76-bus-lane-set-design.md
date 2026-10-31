# E76 같은 하차 정류소로 가는 버스 노선 전부 보이고 고르기 — 서버·웹 설계 (2026-10-31)

정본 판정: `docs/BACKLOG.md` E76 ⓐⓑⓒ(위원장 2026-10-31). 이 문서는 **서버 계약의 정본**이다. iOS 세션(로컬, 착수 순서 표 「E76 iOS」)은 §2·§3의 필드 이름·형태를 그대로 디코딩하고 §4·§5의 판정을 Kit에 미러한다.

범위: 서버(`/api/route/transit` 옵트인 필드, `/api/transit/track` 대기 폴 노선 집합), 웹 경로 브리핑 탑승 줄, 웹 대중교통 안내 패널 대기 목록, 실호출 게이트. iOS·안드로이드는 이 문서 밖이다.

## 1. 무엇을 바꾸나

- ODsay `subPath.lane`은 배열이다. 같은 승차·하차 정류소 쌍을 잇는 노선을 ODsay가 한 subPath로 묶어 준다(fixture `odsay-e70` 실측: 아현역 → 광화문역 `271·273·721·270`, 소공동주민센터 → 광화문역2번출구 `1711·7016·708·N51`). 종전 `odsay.ts`는 `lane[0]` 하나만 읽었다.
- 대기 폴(`getStationByUid`)은 정류소 전 노선 도착을 받아 노선 하나로 걸러 버렸다.
- 판정 ⓑ의 묶음 기준 「같은 하차 정류소에 서는 노선」은 ODsay의 subPath 묶음과 같다(같은 subPath = 같은 `startID`·`endID`). 실호출 게이트 ②가 TOPIS 경유 정류소로 그것을 확인한다(§8).

## 2. 경로 응답 — `TransitLeg.lanes` (옵트인 `lanes=1`)

```ts
interface TransitLeg {
  // …종전 필드
  lanes?: TransitLane[];
}
interface TransitLane {
  lineName: string;        // 한국어 번호(ko 응답 busNo, en 응답 busNoKor)
  lineNameEn?: string;     // 영문 번호(lang=en에만, toDisplayEnglish(busNo))
  serviceRouteId?: string; // ODsay busLocalBlID — 서울은 TOPIS busRouteId와 같은 값
  serviceCityCode?: number;// ODsay busCityCode(서울=1000). serviceRouteId와 항상 함께
}
```

### 2.1 언제 실리나

- 쿼리 `lanes=1`일 때만. `"1"` 밖의 값은 400(`includeStops` 동형). 미지정 응답은 byte-identical — CLI·MCP·채팅 도구·기존 앱이 받는 응답은 바뀌지 않는다.
- 버스 leg에만. 지하철 leg에는 키가 없다(실측 2026-08-01 지하철 53건 전량 lane 1개).
- 쓸 수 있는 노선이 **둘 이상**일 때만. 하나면 키 부재(그 하나는 `lineName`이 이미 말한다).
- `includeStops`와 독립이다. 웹 길찾기 화면은 둘 다 보낸다.

### 2.2 순서와 내용

- **첫 항목은 언제나 leg 자신**이다(`lineName`·`serviceRouteId`와 같은 값). 나머지는 ODsay 순서.
- 번호가 빈 lane, 앞과 같은 노선(ID, ID가 없으면 번호로 비교)은 뺀다.
- 예약 노선(이름에 「(예약)」, 실측 `M4108(예약)`)은 뺀다. 정류소에서 그냥 탈 수 없다. 단 첫 항목은 예외다(빼면 첫 항목 = leg 계약이 깨진다).
- en 응답에서 `busNoKor`가 없는 lane은 뺀다(영문을 한국어 자리에 넣지 않는다, E27 §3.1). `assertKorComplete`는 종전대로 `lane[0]`만 본다.

### 2.3 운행 시간

- 나머지 노선의 첫차·막차를 leg와 같은 조회(`fetchServiceHoursMap`, 중복 제거·24시간 캐시)로 받는다. 옵트인 응답에만 추가 조회가 생긴다.
- **운행 시간 밖으로 판정된** 노선은 뺀다(낮의 심야 버스 `N51`·`심야A21`). 판정 불가(시간표 없음·조회 실패)는 남긴다. 탈 수 있는 노선을 근거 없이 지우면 고를 것이 사라진다(3-state).
- 첫 항목은 운행 밖이어도 남긴다. 그 상태는 leg의 `serviceStatus`가 말하고 강등 정렬이 처리한다.
- 빼고 나서 하나만 남으면 키 부재.

## 3. 대기 폴 — `/api/transit/track?mode=seoulBus&phase=wait&routeIds=…`

### 3.1 요청

- `routeId`(종전, 노선 하나)와 `routeIds`(노선 집합, 쉼표 구분) 중 **정확히 하나**. 둘 다·둘 다 없음은 400.
- `routeIds`는 앞뒤 공백을 지우고 중복을 뺀 뒤 1~12개(`SEOUL_WAIT_ROUTE_SET_MAX`, 실측 최대 10 + 여유), 각 1~20자. 빈 항목(`A,,B`)·초과는 400.
- 다른 갈래(`phase=ride`·`tagoBus`·`subway`)는 바뀌지 않는다.

### 3.2 응답

- `routeIds` 폴은 항목마다 `route`(그 항목의 TOPIS `busRouteId`)를 싣는다. `routeId` 폴엔 `route`가 없다(기존 앱 응답 byte-호환).
- `routeIds` 폴은 항목을 **잔여 정거장 오름차순**으로 정렬한다. 잔여를 모르면 뒤, 같으면 응답 순서(안정 정렬). 예상 시각(`traTime`)으로 정렬하지 않는다(운행종료에도 비0이라 신뢰 불가).
- `rawCount`는 종전대로 노선 필터 전 정류소 도착 수다. 집합의 노선이 하나도 안 오면 `empty` + `rawCount`(필터 전멸)다.
- 완성 문장(`message`)은 종전대로 원문 그대로다(E39).

## 4. 웹 안내 — 노선 집합의 투영과 잠금

### 4.1 `TransitGuideLeg.lanes`

```ts
interface TransitGuideLane { lineName: string; lineNameEn?: string; key: string } // key = TOPIS busRouteId
```

- `buildTransitGuideRoute`가 서버 `lanes`에서 만든다. **서울버스(`trackMode === "seoulBus"`) leg에만**, `serviceRouteId`가 있는 노선만, 둘 이상이고 첫 항목의 키가 leg의 `serviceRouteId`일 때만. 그 밖은 키 부재.
- 지방버스(TAGO)는 이번 판의 대상이 아니다(§6).
- 집합의 순서·내용은 세션 내내 그대로다.

### 4.2 폴 URL(`trackTargetUrl`)

- **waiting** 국면 ∧ `lanes` 둘 이상 → `routeIds=`(집합 전부, 집합 순서).
- **boarding·riding**은 노선 하나(`routeId=` / `phase=ride&routeId=`) — 그 국면의 leg는 이미 고른 노선으로 바뀌어 있다(§4.3).
- 탑승 변경으로 waiting에 돌아오면 다시 집합 전부다.

### 4.3 고르면 leg가 바뀐다(`legWithLane`)

- 후보를 고르면(`boardCandidate`) 항목의 `route`로 노선을 찾고(`laneForItem`), 그 노선이 지금 leg와 다르면 **세션 경로의 그 leg를 바꾼 뒤** 잠근다. 바뀌는 것은 `lineName`·`lineNameEn`(고른 노선에 영문이 없으면 지운다 — 앞 노선 영문이 남지 않게)·`routeId` 셋. 정류소·경유·집합은 그대로다.
- 이 한 자리가 판정 ⓐ의 「고른 차량의 노선으로 승차·추적이 잠긴다」의 구현이다. 잠금 직후 즉폴, 하차 추적(`phase=ride`), 상태 문장·통지(boarding 문맥·추세 톤·도착 임박)가 전부 바뀐 leg를 읽는다. 통지 설계는 판정대로 새로 만들지 않는다.
- ⚠ 잠금(`board`) **전에** 바꾼다. 잠금 직후 즉폴이 바뀌기 전 노선으로 나가면 다른 노선의 하차 추적이 시작된다.
- 「탑승 변경 취소」(`restoreBoarding`)는 직전 잠금의 `routeId`(서울버스 잠금에선 노선 키)로 leg를 되돌린 뒤 복귀한다. 변경 중에 다른 노선을 골랐다 취소하면 leg와 잠금이 어긋나는 것을 막는다.
- ⚠ 경유(`viaStops`)·정거장 수는 첫 노선 것으로 남는다. ODsay가 사이 정류소가 다른 노선을 한 묶음으로 준다면 승차 중 정류소 기반 안내(다음 정류장·하차 표식·위치 줄)가 고른 노선과 어긋날 수 있다. 하차 추적 폴 자체는 서버가 노선별로 순번을 다시 풀어 맞다. 실호출 게이트 ②'가 그 빈도를 WARN으로 잰다 — 나오면 노선별 경유 보강을 판정한다.
- 집합은 대기 폴 상한(`SEOUL_WAIT_ROUTE_SET_MAX` 12, `transit-guide.ts` 한 곳을 서버가 다시 내보낸다)으로 자른다. 첫 항목은 남는다.
- 리듀서(`transitGuideStep`)는 바뀌지 않는다. 매칭은 종전대로 `vehicleId`다.

### 4.4 문장

- **대기 문맥**(`waitContextLine`)은 집합 전부를 말한다: 「{승차 정류소}에서 1711, 7016, 708번 버스 탑승.」 표시 투영 `TransitDisplayLeg.laneList`(번호를 쉼표로 이은 한 조각)가 `line` 대신 쓰인다. 고른 뒤 탑승 변경으로 돌아와도 집합 순서 그대로다.
- **후보 줄**(`candidateDescLine`)은 노선 번호가 맨 앞이다: 「7016, 3분후[1번째 전]」. 인자 `route`는 기본값 없는 필수 인자다(단일 노선이면 `null`).
- 영문 조각은 **모든 노선의 영문이 있을 때만**이다(한 조각 안에서 언어를 섞지 않는다). 하나라도 없으면 그 조각은 한국어이고 줄 원자성 규칙(`pickLabels`)이 그 줄을 통째로 한국어로 낸다.
- 버튼 이름은 종전 틀(`selectBus`) 그대로다.

## 5. 웹 경로 브리핑 탑승 줄

- `transitBoardLegNames(leg).line`이 집합이 있으면 번호 전부를 쉼표로 이은 한 조각이다. 문장 틀(`busNo` 「{route}번 버스」, `legBoard`)은 그대로라 판정 ⓐ의 예문 「…에서 1711, 1020, 7016, 7018, 7212번 버스 탑승, 3정거장」이 된다. 한 줄 = 한 객체(쉼표).
- `transitLegUsesEnglish`는 모든 노선의 영문을 요구한다(줄 단위 원자성, E27). Kit `transitLegUsesEnglish`·안드로이드 `:kit` 미러가 따라와야 한다(§7).
- WebMCP 계획 투영(`DirectionsView`)은 같은 함수를 지나므로 자동으로 같다.
- 브리핑을 부르는 웹 화면 둘(`DirectionsView` 본 조회·수단 재조회, 채팅 카드 `TransitRouteBriefing`)이 `lanes=1`을 보낸다.

## 6. 이번 판 밖(BACKLOG로)

- **지방버스(TAGO)**: 차량 식별자가 없어 대기 목록 줄이 버튼이 아니고 [이 버스 탔어요](근사) 한 버튼으로 잠근다. 집합을 보이려면 「어느 노선을 탔는가」를 고를 화면이 새로 필요하다. 이번 판은 브리핑 줄만 집합이고(경로 응답에 실린다), 안내는 추천 노선 하나다.
- **지금 서 있는 정류소 기준 집합**(BACKLOG 증상 두 번째, 420번 한 정거장 전 하차): 이번 판의 집합은 경로 조회 때 ODsay가 묶은 **원래 승차 정류소** 기준이다. 다른 정류소에서 다시 기다릴 때 그 정류소의 노선을 세려면 TOPIS 경유 정류소(`getStaionByRoute`)를 정류소의 노선마다 불러야 하고(정류소당 10여 회, 24시간 캐시), 그 비용 설계가 따로 필요하다.
- **서울버스 [이미 탔어요](비관측 잠금)**: 노선을 묻지 않는다. 상태 문장의 노선 이름은 그때 leg의 노선(추천 노선 또는 직전에 고른 노선)이다.
- ODsay가 묶지 않은 노선(같은 정류소 쌍인데 다른 subPath)은 집합에 없다. 실측 빈도는 게이트가 쌓이면 판정한다.

## 7. iOS·안드로이드가 따라올 것

- 디코딩: `TransitLeg.lanes`(선택), `TrackItem.route`(선택). 둘 다 additive라 종전 앱은 무시한다.
- 요청: 경로 조회에 `lanes=1`, waiting 폴에 `routeIds=`.
- Kit 미러: `guideLanesOf`·`laneForItem`·`legWithLane`(`transit-guide.ts`), `laneList`·`laneLabel`(`transit-display.ts` ↔ `TransitDisplayProjection.swift`), `waitContextLine`·`candidateDescLine`의 `route`(`transit-guide-text.ts` ↔ `TransitGuideText.swift`), `transitLegUsesEnglish`·`transitBoardLegNames`(`transit-leg-english.ts` ↔ `TransitExitLines.swift`).
- 공유 fixture: `candidateDesc` 케이스의 `route`는 이번 판에 공유 fixture에 넣지 않았다(Kit이 아직 읽지 않는다). Kit 미러가 따라올 때 fixture로 옮기고 웹 테스트의 `route: null` 고정(`transit-guide-text.test.ts`)을 fixture 값으로 바꾼다.

## 8. 실호출 게이트 `scripts/verify-bus-lanes.mjs`

공개 명소 3표본(아현역 → 광화문, 신촌역 → 서울역, 서울시청 → 동대문디자인플라자). 실승차 증상 구간은 표본으로 쓰지 않는다.

1. 경로 조회(`lanes=1`)에 서울 버스 집합 leg가 있는가, 첫 항목이 leg 자신인가.
2. 같은 하차 정류소(판정 ⓑ): 집합의 노선마다 TOPIS 경유 정류소에서 승차 정류소 뒤에 하차 정류소가 오는가(`pickAlightOrd`).
   2'. 사이 정류소: 그 노선의 승차→하차 정거장 수가 leg 경유와 다르면 WARN(§4.3 위험).
3. 키 호환: 집합 대기 폴에 집합의 노선 ID가 나타나는가. 0개면 FAIL(키 어긋남), 일부 없음은 WARN(운행 밖·차고지 대기).

상한: ODsay 4·TOPIS 80, 집합 leg 4개까지. `--out`(저장소 밖)·`--from-corpus` 규약은 `odsay-corpus.mjs`와 같다.

작성 세션은 키가 없어 돌리지 못했고, **2026-10-31 KST 08시대 키가 주입된 클라우드 세션이 `--out`으로 돌려 PASS**했다(실호출 ODsay 3 · TOPIS·공공 101, WARN 0, 저장본 재생도 PASS):

| 표본 | 집합 leg | ② 같은 하차 정류소 | ③ 키 호환 |
|---|---|---|---|
| 아현역 → 광화문 | 아현역 → 광화문역: 271·273·721·270 | 4/4 | 정류소 도착 20건에 전부 |
| 신촌역 → 서울역 | 0(집합 없음) | — | — |
| 서울시청 → 동대문디자인플라자 | 명동.롯데영플라자 → 동대문역사문화공원: 152·261·105 | 3/3 | 정류소 도착 29건에 전부 |

②' 사이 정류소 WARN은 0이었다. 첫 실행이 TOPIS 상한 80에서 멈췄다 — 운행시간 조회가 집합 노선만이 아니라 후보 경로 전체의 버스 노선마다 나가고 게이트는 캐시를 걷어 내기 때문이라 상한을 160으로 고쳤다(운영은 하루 캐시라 무관). fixture 층은 ODsay 실응답 저장본(`odsay-e70`)으로 `odsay-lanes.test.ts`가 잠근다.

## 9. 로컬 통합과 iOS 검증

- 구현은 기존 웹 판정을 Kit에 미러하므로 별도 아키텍처를 추가하지 않는다. iOS 파일 소유 작업자와 통합·문서 담당을 분리했다.
- iOS는 선택 필드 `lanes`·`route` 디코딩, `lanes=1` 경로 요청, 대기 집합 폴, 후보 선택 전 노선 교체와 취소 복귀를 구현했다. 선행 도보 뒤에도 노선 집합을 보존한다.
- 공유 후보 문장 fixture에 한국어·영어·노선 영문 누락 3건을 추가했다. Swift 전체 1,031개 테스트(90개 스위트), 웹 접근성 9개 검사를 통과했다.
- 서버·웹 독립 리뷰에서 첫 노선 번호 누락 시 후속 노선이 첫 항목으로 승격되는 경계를 발견해, 집합 부재로 처리하고 회귀 테스트를 추가했다.
- 실호출은 §8의 검증을 사용했고 유료 API를 다시 호출하지 않았다. VoiceOver 실승차 청취는 BACKLOG §2 E76에서 판정한다.
- 최종 웹 테스트 5,995개 통과(7개 건너뜀). Release 2.5.0(36) 빌드·아이폰 설치·산출물 검사 통과. 기기 잠금으로 자동 실행은 거절됐다.
- iOS·웹 후속 리뷰에서 노선 교체 전에 대기 국면·추적 가능 상태를 확인하도록 보완했다. iOS 수단 재조회에도 `lanes=1`을 추가하고 요청 테스트로 검증했다.
- 변경 파일 공개 흔적 검사는 기존 지침 경로·공개 연락처 11건만 검출했다. HEAD와 대조해 신규 노출이 없음을 확인했다.

### 아이폰 미러링 화면 확인(2026-10-31)

- 정식판·실험판 모두 2.5.0(36)을 설치하고 각각 번들 ID로 실행했다. 실험판 기존 안내 세션은 변경하지 않았다.
- 정식판 아현역 2호선 → 광화문역 5호선의 버스 경로 브리핑에서 271·273·721·270번 집합을 확인했다. 승차 전 도보의 도착 선언으로 대기 화면에 진입했다(실제 이동 아님).
- 대기 문맥에 네 노선이 표시되고 후보마다 번호와 도착 문장이 나타났다. 추천 노선이 아닌 273번 선택 후 상태 줄이 273번으로 바뀌었다. 다른 차량 선택 → 탑승 변경 취소 뒤에도 273번 상태로 복귀했다.
- 테스트 안내는 종료하고 입력을 초기화했다. 테스트 조회 두 건은 최근 경로에 남는다. 기존 최근 경로는 삭제하지 않았다.
- 별도 버스 수단 재조회 버튼은 이 표본에서 나타나지 않아 화면 검증하지 못했다(요청 테스트 통과와 구분). 실험판은 실행만 확인했다.
- 미러링은 화면·조작 흐름만 관측한다. VoiceOver 낭독·음성 통지의 번호·실제 승하차·백그라운드 안내는 검증하지 않았다.

# E70 첫 판: 역에서 수단을 바꾸는 여정 (택시 → 대중교통 → 택시) 설계

- 상태: 설계 확정 대기(적대적 설계 리뷰 뒤 확정). 코드 구현 없음.
- 판정 정본: `docs/BACKLOG.md` E70(위원장 판정 1~11 + 이 spec의 판정 12~16). 조사: `docs/research/RESEARCH-2026-10-17-e70-taxi-exit-probe.md`(출구 실측), `docs/research/RESEARCH-2026-10-17-e70-maasrp-probe.md`(`maasRP`·지정 역 경로 실측).
- 범위: **iOS 실험판 전용**(판정 5). 서버는 옵트인 새 라우트 하나만 더하고 기존 `/api/route/*` 응답은 바이트 동일. 웹 UI·안드로이드·en은 첫 판 밖(§10).
- **설계 리뷰 판정: 해당.** 새 상태 머신(여정 단계 인계), 새 판정 계층(지정 역 경로·출구 선정), 새 외부 통합 계약(카카오 지하철출구 번호별 검색, Tmap 후보별 호출 예산)을 담는다. codex 적대적 설계 리뷰 결과는 §13.

## 0. 한 문단 요약

사용자가 길찾기 화면에서 "택시에서 내려 지하철 타는 역"(역 A)과 "지하철에서 내려 택시 타는 역"(역 B) 중 하나 또는 둘을 지정하면, 서버 `/api/route/journey`가 자동차(출발 → A) + 대중교통(A → B) + 자동차(B의 출구 → 도착) **조회 셋을 조립**해 돌려준다. ODsay가 지정 역에서 타지 않는 경로를 추천하면 두 변형(지정 역 경로 / 추천 경로)을 함께 주고 사용자가 고른다. 안내는 앱 수명 `GuideSession` 위에서 택시(자동차 승객 모드) → 접근 도보 → 대중교통 → 출구 도보 → 택시로 세션을 이어 붙인다. 인계는 자동 판정과 버튼 중 먼저 오는 쪽이다.

## 1. 의도와 목표

**왜**: 위원장은 택시 → 지하철 → 택시 여정을 자주 탄다(BACKLOG E70 피드백: 평소 종로행·여의도행, 2026-10-10 부천 왕복). 앱에는 이 여정을 담을 자리가 없어 출발지를 역으로 바꿔 구간을 손으로 쪼개 조회했고, 안내 중 앱이 전체 계획을 몰라 "그 역에서 새로 출발하는 사람"으로 경로를 잡았다.

**목표**
1. 바꾸는 역(최대 둘, 판정 3)을 지정해 한 번에 여정을 조회하고, 구간 셋을 한 조망에서 듣는다.
2. 지정한 역을 말없이 다른 역으로 바꾸지 않는다(판정 7 — 이 기능의 핵심 불변식, §3.2).
3. 택시에서 내려 지하철을 타고, 내려서 출구로 나가 다시 택시를 탈 때까지 안내가 끊기지 않는다(판정 8·9).
4. 내린 노선의 출구 중 택시 시간이 가장 짧은 출구로 안내한다(판정 10). 승강장이 있으면 함께 보이고 고른다(판정 11).

**비목표(첫 판 밖)**: 채팅 입구(E70-b), 그때그때 이어 가기(E70-c), 지금 탄 열차에서 시작(E71), 지하철 중간에 택시(판정 3), 웹 UI 입구, 안드로이드, en(§10), 정식판.

**반목표(동작해도 실패인 것)**
- 지정 역과 다른 역에서 타는 경로를 "지정 역 경로"처럼 내보내는 것.
- 여정의 한 단계가 끝났는데 다음 단계가 시작되지 않고 아무 말도 없는 것(정상 대기와 고장이 구분되지 않는다).
- 기존 도보·자동차·대중교통 안내 동작이나 기존 라우트 응답이 실험 기능 때문에 바뀌는 것.

## 2. 조사 결론 (설계를 묶는 사실)

1. **`maasRP`는 쓰지 않는다**: 수단이 도보·대중교통·대중교통+자전거·자전거뿐이고(문서에 없는 값은 빈 결과), 승차역·하차역·경유지 파라미터가 없으며 응답 모양이 지금 파이프라인과 다르다. 판정 6(조회 셋의 조립) 유지.
2. **ODsay는 승차역을 지정받지 못한다**: `searchPubTransPathT`는 좌표만 받는다. 역 좌표로 불러도 이웃 역에서 타는 경로를 1순위로 줄 수 있다(아현 → 광화문, 1순위 애오개). `SearchPathType=1` 재조회는 후보를 좁히지만 순서는 같다. 역 번호 지정 `subwayPath`는 정차역·급행·출구가 없어 안내 원천이 못 된다.
3. **지정 역 경로 찾기는 선정 전 전체 후보 위에서**: `odsay.ts` `getTransitRoute`는 정규화·강등 뒤 `ranked` 전체를 들고 있다가 `selectTransitRoutes(ranked)`(1순위 + 축별 최선)에서 자른다. 지정 역 경로는 그 선정 밖에 있을 수 있다.
4. **같은 이름 다른 역**: 경의중앙선 신촌 좌표 조회 후보에 2호선 신촌 승차 경로가 섞인다. 이름만으로 가르지 않고 노선까지 본다.
5. **출구는 번호별 검색만 된다**(`"{역}역 {n}번출구"`, 카카오 `… > 지하철출구`, 노선별 등록). 한 번 검색은 0건. 택시 승강장은 이름에 "택시"가 든 POI, 10곳 중 2곳.
6. **ODsay `exit`(`startExitNo`·`endExitNo`)는 판정 10을 대신하지 못한다**: ODsay가 출발·도착 좌표로 고른 출구라 "택시 시간이 가장 짧은 출구"가 아니다.
7. **Tmap 자동차는 캐시하지 않고(`no-store`, 실시간 교통) 일 1,000건 무료분을 도보 폴백과 공유한다**. 자동차 라우트에는 IP당 60초 10회 상한이 있다(`checkCarRateLimit`). 후보 출구마다 부르면 이 둘에 걸린다(§4.5).

## 3. 판정 기록

### 3.1 위원장 판정 (2026-10-17, 이 세션 문답)

12. **추천 경로를 고르면 택시는 그 경로가 타는 곳 앞까지 간다**: 처음 정한 역은 그 변형에서 빠진다. 대칭으로 추천 경로가 다른 역에서 내리면 택시는 그 역(의 출구)에서 탄다.
13. **두 변형의 제목은 둘 다 역 이름을 밝히고 지정 역 경로가 먼저다**: 「아현역에서 타는 경로」 → 「애오개역에서 타는 추천 경로」. 두 변형이 같으면 변형 목록 없이 한 경로.
14. **지정 역 경로를 끝내 못 찾으면 사실 한 줄 + 추천 경로**: 결과 맨 위 「아현역에서 타는 경로를 찾지 못했습니다.」, 그 아래 추천 경로를 그대로 보여 주고 안내를 시작할 수 있다. 여정 자체를 실패로 만들지 않는다.
15. **입력은 버튼 하나로 펼친다**: 평소엔 「택시로 갈아탈 역 정하기」 버튼 하나(경유지 다음). 누르면 「택시에서 내려 지하철 타는 역」·「지하철에서 내려 택시 타는 역」 두 칸이 나오고 하나만 채워도 된다.
16. **출구·승강장은 조회 결과에서 미리 고른다**: 마지막 택시 구간에 「1번 출구로 나가 택시로 13분, 약 7,800원」 / 「택시 승강장에서 택시로 19분, 약 9,800원」 두 줄이 나오고 기본은 빠른 출구. 내린 뒤에는 고른 곳으로 바로 도보 안내.

예문의 숫자·역은 설명용이다. 위 예문은 확정본 문장으로 맞춰 적었고, 화면 문장의 정본은 §8.4 문안 표다(위원장 문안 왕복 2026-10-17 확정).

### 3.2 지정 역 경로 불변식 (판정 7의 계약)

- **지정 역 경로**: 대중교통 변형의 첫 탈것(도보가 아닌 첫 leg)이 지하철·철도이고 그 승차역이 역 A와 **같은 역**이며(A를 지정했을 때), 마지막 탈것이 지하철·철도이고 하차역이 역 B와 같은 역이다(B를 지정했을 때).
- **같은 역** 판정은 역 이름 키 + 노선이다(§4.3). 노선 정보가 없는 장소(카테고리·이름 어디에도 노선이 없음)는 이름 키만 본다.
- **응답의 `designated` 변형은 이 술어를 통과한 경로뿐이다.** 술어를 통과하지 못한 경로를 `designated` 자리에 두는 코드 경로는 없다(서버 순수 함수 하나가 판정하고 그 결과로만 채운다). 못 찾으면 `designated: null` + `designatedMissing`(판정 14).
- 클라이언트는 `designated`를 재판정하지 않는다(표시만).

### 3.3 설계 결정 (위원장 판정이 아닌, 이 spec이 정한 것)

| # | 결정 | 근거 |
|---|---|---|
| D1 | **서버 조립**: 새 라우트 `/api/route/journey` 하나 | 조회 셋 + 지정 역 판정 + 출구 선정이 한 트랜잭션이고, 지정 역 판정이 ODsay 선정 전 후보(서버에만 있음)를 본다. 채팅 E70-b·CLI·MCP도 같은 계약을 부르게 된다. |
| D2 | 여정 조회는 **ko 전용**(`lang` 미지정·`ko`만, 그 밖은 400) | 자동차 안내 시작 게이트(`carGuideStartable`)가 데이터 로케일 ko + Tmap provider다. en 택시 안내 경로가 없다. |
| D3 | 여정의 대중교통 구간은 **첫 탈것부터 마지막 탈것까지로 자른다**(역 A 쪽 앞 도보, 역 B 쪽 뒤 도보) | 택시 하차 지점 ↔ 승차역, 하차역 ↔ 출구는 여정이 따로 가진 도보 구간(접근 도보·출구 도보)이고, 안내 시점의 실제 위치로 잡는다(판정 9 "그때 위치"와 같은 원리). 역을 지정하지 않은 쪽은 자르지 않는다(보통 대중교통처럼 출발지·도착지 도보 포함). |
| D4 | 택시 목적지 = 변형의 **첫 탈것 승차 지점 좌표**(ODsay 승차역·정류장 좌표), 택시 출발 = 선택한 출구·승강장(없으면 마지막 탈것 하차 지점) | 판정 12. 지정 역 경로에서는 승차 지점이 곧 역 A다. |
| D5 | 택시 → 대중교통 자동 인계의 "역 근처" = **기존 자동차 확정 도착 판정 그대로**(`carArrivalStep`: 택시 경로 종점 40m 이하·정지·정확도 30m 이하) | Tmap은 종점을 가장 가까운 도로에 붙이므로(`terminalCoord`) 역 중심이 아니라 택시가 서는 도로가 기준이다. 새 수치를 만들지 않는다. 택시 하차 지점이 역 출입구와 어긋나는 거리는 접근 도보(D6)가 흡수한다. 실차 판정 항목(§11). |
| D6 | 접근 도보: 인계 시점 위치에서 승차 지점까지 직선 **30m 이상이면** 도보 세션 하나(승차 전 도보 A25와 같은 성격), 미만이면 바로 대중교통 세션 | 택시가 역 앞에 세웠으면 걷기 안내가 군더더기다. 30m는 도보 최종 접근 판정 반경(15m)의 두 배. 실보행 판정 항목. |
| D7 | 출구 도보·접근 도보는 **prewalk와 같은 성격의 도보 세션**: 종료 화면을 남기지 않고, 잊힌 세션 안전망을 끄고, 끝난 사유가 다음 단계를 정한다 | A25 선례(`markPrewalk` + `onSessionEnd(reason)`)를 일반화한다(§6.3). |
| D8 | 출구 도보 목적지 표시는 **출구 번호가 주인공**(「1번 출구」), 역 안 위치 부정확은 기존 도보 안내가 그대로 감당 | 판정 9. |
| D9 | 출구 도착 또는 「택시에 탔어요」 → 그때 위치로 택시 경로 조회 → 자동차 승객 세션 | 판정 9. 조회 실패는 침묵이 아니라 문장 + 재시도 버튼(§6.4). |
| D10 | 여정의 자동차 세션은 **늘 승객 모드**(설정의 운전자 모드 무시) | 택시다. `CarListener`는 세션 시작 때 한 번 읽으므로 여정 시작 경로가 `.passenger`를 넘긴다. |
| D11 | 여정 중 「안내 종료」는 **여정 전체를 끝낸다** | 한 단계만 끝내고 다음이 자동 시작되면 끄려던 사람에게 말이 계속된다. |
| D12 | 역을 하나라도 지정하면 그 조회는 **여정만** 한다(대중교통·도보·자동차 세 수단 병렬 조회를 하지 않는다) | 역을 지정했다는 것이 곧 수단 조합을 정했다는 뜻이다. 세 수단이 필요하면 역 칸을 비운다. |
| D13 | 최근 경로에 여정을 저장한다(역 둘을 함께) | 위원장 여정이 반복형(종로행·여의도행)이다. |
| D14 | 경유지와 바꾸는 역은 함께 쓰지 않는다(역 칸을 펼치면 경유지 칸이 사라지고 그 반대도 같다) | 첫 판에서 경유지 + 여정 조합은 판정이 없다(어느 택시 구간의 경유지인가). |

## 4. 서버: `/api/route/journey`

### 4.1 요청

`GET /api/route/journey?fromLat&fromLng&toLat&toLng&boardLat&boardLng&boardName&boardLine&alightLat&alightLng&alightName&alightLine`

- `board*`(역 A)·`alight*`(역 B) 중 **최소 하나** 필수, 각각은 좌표 + 이름 함께. `*Line`은 선택(카카오 장소 카테고리 마지막 조각 또는 이름 꼬리에서 클라이언트가 뽑은 노선 힌트, 예 `수도권2호선`). 좌표는 `coord-param.ts`(`latParam`/`lngParam`).
- 커버리지: 좌표 넷(또는 셋) 모두 `isInKorea` → 밖이면 200 `{"outOfCoverage":true}`.
- 키 게이트: `hasOdsayKey() && hasTmapKey() && hasKakaoKey()` 아니면 503(죽은 기능 0 — iOS는 503이면 역 지정 버튼 자체를 숨기지 않고 "여정을 조회할 수 없습니다" 실패로 처리; 키는 프로덕션에 다 있다).
- 레이트 리밋: 새 버킷 `checkJourneyRateLimit`(IP당 60초 3회). 한 여정 조회가 Tmap을 여러 번 부르므로 자동차 버킷(10회)과 따로 센다.
- 캐시: 라우트 `force-dynamic`, 응답 `no-store`(택시 시간이 실시간). 하위 조회의 캐시는 §4.6.

### 4.2 파이프라인 (순서가 계약)

1. **대중교통 후보 전체**: 출발점 = A 좌표(A 지정) 또는 `from`, 도착점 = B 좌표(B 지정) 또는 `to`. `getTransitRoute`의 정규화·강등까지(선정 전 `ranked`)를 돌려주는 새 진입점 `getTransitCandidates`(같은 `fetchOdsay`·`revalidate: 3600`, `includeStops: true` — 실시간 안내가 정차역을 쓴다). 기존 `getTransitRoute`는 이 함수 + 선정·라벨로 다시 쓰고 바이트 동일을 테스트로 잠근다.
2. **지정 역 판정**: `ranked`에서 §3.2 술어를 통과하는 첫 경로 = `designated`. 없으면 `SearchPathType=1`(지하철만, 기존 `modeAxis: "subwayOnly"` 경로) 전체 후보에서 한 번 더. 그래도 없으면 `designated = null`.
3. **추천**: 기존 선정의 1순위(`selectTransitRoutes(ranked)[0]`) = `recommended`. `designated`와 `routeKey`가 같으면 변형 하나(판정 13).
4. **자르기(D3)**: 각 변형의 legs에서 A 지정 시 첫 탈것 앞 도보를, B 지정 시 마지막 탈것 뒤 도보를 떼어 낸다. 합계(`totalMinutes`·`walkMinutes`)는 남은 legs로 다시 계산한다(요금은 ODsay `payment` 그대로).
5. **택시 앞 구간**(A 지정 시, 변형마다): `from` → 첫 탈것 승차 지점(D4). `getCarRoute`(Tmap ko, 실패 시 카카오 폴백 — 폴백 응답은 `provider: "kakao"`라 안내 불가 표시). 두 변형의 승차 지점이 같으면 한 번만 부른다.
6. **출구 후보**(B 지정 시, 변형마다, 마지막 탈것이 지하철·철도일 때만): §4.4.
7. **택시 뒤 구간**: 선택 후보(기본 = 택시 시간 최단 출구, 승강장은 별도 후보)마다 후보 좌표 → `to`. §4.5 예산 안에서.
8. **조립·합산**: 변형마다 `totalMinutes = 택시 앞 + 대중교통(잘린) + 택시 뒤(기본 후보)`, 요금은 택시 요금 합(Tmap `taxiFare` 추정)과 대중교통 요금을 따로 싣는다(합치지 않는다 — 택시는 추정치, 대중교통은 정액).

### 4.3 역 같음 판정 (순수 함수, 새 파일 `src/lib/journey/station-identity.ts`)

- 이름 키: `normalizeStationName`(기존). ODsay leg의 `fromName`/`toName`, 요청 `boardName`/`alightName` 양쪽에 같은 함수.
- 노선: 요청 노선 힌트와 ODsay `lineName`을 **지역 접두(`수도권`·`부산`·`대구`·`광주`·`대전`)와 구분자를 걷은 코어**로 비교. ⚠ 기존 `lineHintMatches("수도권 2호선", "2호선")`은 코어가 `수도권2` 대 `2`라 거짓이다(숫자 코어는 완전 일치만) — 그대로 쓰지 말고 접두를 먼저 걷는 래퍼를 둔다. 카카오 카테고리 표기(`수도권2호선`·`경의중앙선`·`수인분당선` 등)와 ODsay 표기(`수도권 2호선`·`경의중앙선`·`수도권 수인.분당선`)의 대응은 **실호출 표본으로 만든 공유 fixture**로 잠근다(구현 세션: 카카오 키워드로 수도권 노선별 역 하나씩 + 저장 corpus의 ODsay `lineName`).
- 힌트가 없으면 이름 키만. 이름 키가 같고 노선이 다르면 다른 역이다(신촌 사례).

### 4.4 출구·승강장 후보 (새 provider 함수 + 순수 선정)

- **수집**: `searchSubwayExitsKakao(stationName, coord)` — `"{역}역 {n}번출구"`를 n=1부터, 좌표 반경 800m, 3번 연속 미발견이면 중단, 상한 n ≤ 25(`probe-taxi-exit.py` 방법 A 그대로). 결과 중 카테고리 끝이 `지하철출구`이고 이름이 `"{역}역"`으로 시작하는 것만. 이름에서 노선(`노량진역 1호선 9번출구`)과 번호(`9`, `3-1`)를 뽑는다. 기존 `buildKakaoSearchUrl`은 `radius`를 받지 않으므로 새 URL 빌더.
- **노선 거르기(판정 10)**: 마지막 탈것 노선과 같은 노선의 출구만(§4.3 노선 비교). 노선 표기가 없는 출구(단일 노선 역은 `"{역}역 2번출구"`로만 등록되기도 한다)는 그 역의 등록 출구가 모두 노선 표기 없음일 때만 후보로 받는다 — 섞여 있으면 표기 없는 것은 버린다.
- **승강장(판정 11)**: `"{역}역 택시승강장"`·`"택시승강장"` 반경 500m, 이름에 "택시"가 든 POI. 하차역 좌표 300m 안에서 가장 가까운 하나만 후보.
- **0건**: 출구도 승강장도 없으면 택시 뒤 구간 출발 = 하차역 좌표, 출구 도보 없음(응답 `egress: { kind: "none" }`). 출구 조회 실패(카카오 throw)도 같은 갈래로 가되 `egressLookupFailed: true`를 싣는다(3-state: 없음 ≠ 조회 실패).
- **캐시**: 출구·승강장 좌표는 정적이라 `unstable_cache` 7일, 키 = 역 이름 키 + 좌표 3자리.

### 4.5 Tmap 호출 예산 (택시 뒤 구간)

- **후보 상한 K = 6**: 노선 거른 출구가 6개를 넘으면 하차역 → `to` 방위와 출구 위치의 직선 기준(출구에서 `to`까지 직선거리 오름차순)으로 6개를 고른다. 승강장은 상한 밖에 하나 더(최대 7회).
- 한 여정 조회의 Tmap 최대 = 택시 앞 2(변형 둘) + 택시 뒤 7 × 변형 2 = 16. 실제로는 대부분 변형 하나·승강장 없음이라 1 + 6 = 7 이하.
- ⚠ K와 직선 예선은 **이 spec의 추정**이다: 9월 실측 원본 응답이 남아 있지 않아 "직선 상위 6 안에 시간 최단 출구가 드는가"를 재지 못했다. 구현 세션의 실호출 게이트(§9.2)가 역 10곳(실측 기록의 표본)에서 전수 대 예선 결과를 대조해 K를 확정한다. 예선이 최단을 놓치면 K를 올린다(위원장 판정 없이 바꿀 수 있는 설계 수치).
- 동점(분 단위 같음)은 역 중심 → 출구 직선거리가 짧은 쪽(판정 10 "역 안 걷는 거리"의 근사).

### 4.6 캐시와 비용

| 조회 | 캐시 | 한 여정 조회당 |
|---|---|---|
| ODsay 후보 | 기존 `revalidate: 3600`, 좌표 4자리 | 1회(+ 지하철만 재조회 1회, 지정 역이 없을 때만) |
| 카카오 출구·승강장 | `unstable_cache` 7일 | 캐시 미스 때 역당 약 10~25회(무료) |
| Tmap 택시 | 없음(`no-store`) | 위 §4.5 |
| 여정 응답 | 없음 | — |

ODsay는 건당 약 27원(Flex). 여정 조회는 일반 대중교통 조회보다 ODsay를 더 쓰지 않는다(최악 2회).

### 4.7 응답

```ts
interface JourneyResult {
  variants: JourneyVariant[];          // 1~2개, [0]이 기본 선택(지정 역 경로, 없으면 추천)
  designatedMissing?: { side: "board" | "alight" | "both" }; // 판정 14
}
interface JourneyVariant {
  kind: "designated" | "recommended";   // 둘이 같으면 "designated" 하나
  boardStation?: { name: string; coord: Coord };   // 이 변형이 실제 타는 곳(판정 12)
  alightStation?: { name: string; coord: Coord };
  taxiIn?: CarRouteBriefing;            // A 지정 시
  transit: TransitRoute;                // 잘린(D3) 경로, routeKey 유지
  egress?: {
    options: EgressOption[];            // [0] = 택시 시간 최단 출구(기본), 승강장은 있으면 마지막
    lookupFailed?: true;
  };
  totals: { minutes: number; taxiFare: number; transitFare: number };
}
interface EgressOption {
  kind: "exit" | "stand" | "none";
  label: string;                        // "1", "3-1"(출구 번호) | 승강장 이름 | ""
  lineName?: string;
  coord: Coord;
  taxiOut: CarRouteBriefing;            // 이 후보에서 도착지까지
}
```

- 실패: ODsay·카카오 경로 throw → 502(3-state), 대중교통 후보 0 → 200 `{ variants: [] }`(경로 없음), 택시 앞 구간 실패 → 그 변형 502가 아니라 여정 전체 502(택시 없는 여정은 여정이 아니다).
- `TransitRoute`는 기존 타입 그대로라 iOS 실시간 안내(`buildTransitGuideRoute`)가 그대로 읽는다.

## 5. iOS 길찾기 화면

### 5.1 입력 (판정 15)

- 경유지 행 다음에 버튼 「택시로 갈아탈 역 정하기」. 누르면 두 칸 「택시에서 내려 지하철 타는 역」·「지하철에서 내려 택시 타는 역」이 나오고 포커스는 첫 칸으로. 칸 검색은 기존 끝점 검색 시트(`DirectionsEndpointSearchView`, 대상 `DirectionsFieldTarget`에 `.boardStation`·`.alightStation` 추가).
- 역만 받는다: 고른 장소가 `stationLayoutKind`(Kit `StationPhone.swift`) `subway`/`rail`이 아니면 칸에 넣지 않고 polite 통지 「역을 골라 주세요.」. 노선 힌트는 장소 이름 꼬리(`parseStationQuery`의 Kit 대응) 또는 카테고리 마지막 조각.
- 두 칸이 다 비면 지금과 같은 세 수단 조회. 하나라도 있으면 여정 조회(D12). 펼친 상태에서 경유지 행은 사라진다(D14).
- 봉인: 버튼과 두 칸은 `AppConfig.experimentalJourneyEnabled`(`#if EXPERIMENTAL`) 안에만.

### 5.2 결과 (판정 13·14·16)

읽기 순서(한 줄 = 한 접근성 객체):

1. (못 찾았을 때만) 「아현역에서 타는 경로를 찾지 못했습니다.」
2. 변형이 둘이면 변형마다 heading 한 줄(「아현역에서 타는 경로」 / 「애오개역에서 타는 추천 경로」) + 선택 버튼. 하나면 heading 없이 바로 3.
3. 합계 줄: 「총 41분, 택시 요금 약 15,600원, 대중교통 요금 1,550원」.
4. 구간 줄: 「택시로 아현역까지 8분, 약 7,800원」 → 기존 대중교통 구간 줄들(`legBoard` 등, 앞뒤 도보 없음) → 출구 선택(승강장이 있으면 두 줄 버튼, 없으면 한 줄 「1번 출구로 나가 택시로 13분, 약 7,800원」).
5. [안내 시작] 버튼(선택된 변형·출구로).

포커스: 조회 완료 시 기존 규칙(첫 성공 수단 heading으로 1회)과 같은 자리 하나 — 변형이 둘이면 첫 변형 heading, 아니면 합계 줄.

### 5.3 저장·복원 (D13)

- `RecentRoute`에 선택 필드 `boardStation`·`alightStation`(장소 한 벌) 추가, `sameRoute`가 둘도 비교. 구버전 저장본 디코딩은 부재 = nil.
- 최근 경로에서 여정을 고르면 칸을 채우고 펼친 상태로 조회(양끝이 있을 때만 자동 조회 — 기존 프리필 규칙).
- 웹 `?dir=`는 첫 판에서 건드리지 않는다(웹 UI 없음).

## 6. iOS 여정 안내 (상태 머신)

### 6.1 단계

```
taxiIn ──(확정 도착 ∨ [택시에서 내렸어요])──▶ access? ──(도착 ∨ 선언)──▶ transit
   (A 미지정이면 시작 단계가 transit)                                         │
transit ──(마지막 탈것 하차: 기존 advanceIntoWalkHandoff 자리)──▶ egress? ──(출구 도착 ∨ [택시에 탔어요])──▶ taxiOut ──▶ 끝(일반 자동차 종료 화면)
   (B 미지정이면 기존 도착 도보 인계 그대로)
```

- `access`·`egress`는 D6·출구 0건(`kind: "none"`)이면 건너뛴다.
- 모든 단계 사이 인계는 **한 함수**(`GuideSession.advanceJourney(from: stage, reason:)`)를 지난다. 단계 전이 표는 Kit 순수 함수 `journeyNextStage(current:, event:, plan:) -> JourneyStage?`(새 파일 `Journey.swift`)가 정하고 `JourneyTests`가 전이 전수를 잠근다.

### 6.2 시작과 봉인

- 시작은 `GuideSession.startJourney(plan:)` 한 곳. `plan` = 선택된 변형 + 선택된 출구(서버 응답 투영) + 출발·도착 라벨.
- `guidance-gate-drift.test.ts`: 세션 시작 호출 전수에 `startJourney` 진입점과 그 안의 `self.startBeacon(`·`startTransit` 호출을 더하고(현재 7·4 수치 갱신), 길찾기 화면의 호출이 `AppConfig.experimentalJourneyEnabled` 조건 안에 있는지 `enclosingHeaders`로 검사한다(나들이 선례).

### 6.3 세션 이어짓기 장치

- `GuideSession`이 `JourneyContext`(plan + 현재 단계 + 세대 id)를 가진다. 나들이 귀환·prewalk와 같은 패턴(컨텍스트 id로 늦은 콜백을 거른다).
- **도보 단계(access·egress)**: `BeaconModel`에 prewalk 표식의 일반화(`markChained(stage:)`)를 건다 — 종료 화면을 남기지 않고, 잊힌 세션 안전망을 끄고, `onSessionEnd(reason)`로 끝난 사유를 넘긴다. 단일 슬롯 `onSessionEnd`는 그대로 쓰고(한 번에 도보 세션 하나), 걸 때마다 세대를 확인한다.
- **대중교통 → egress**: `TransitGuideModel`에 종료 콜백이 없다. 마지막 leg 하차 시 지금 `advanceIntoWalkHandoff()`가 `pendingWalkHandoff`를 남기는 자리에서, 여정이면 `pendingJourneyEgress`를 남기고 `GildongmuApp`의 기존 인계 클로저 옆에서 `advanceJourney`를 부른다. 확정 도착 시 폴 주기 0 규칙은 그대로.
- **택시 → 대중교통**: 자동차 확정 도착(D5)에서 지금은 종료 화면 + 「걸어서 안내」(`acceptCarWalkHandoff`)가 뜬다. 여정 `taxiIn`이면 종료 화면 대신 `advanceJourney(reason: .arrived)`. 「택시에서 내렸어요」 버튼은 `taxiIn` 동안 시트에 늘 있다(`.declared`).
- **egress → taxiOut**: 출구 도착(도보 최종 접근) 또는 「택시에 탔어요」(egress 동안 시트에 늘 있음) → 그때 위치로 `RouteService.car`(force 측위, 나이 상한 기존 길찾기 3분) → `startBeacon(kind: .car, listener: .passenger)`.
- 인계 지연: 기존 600ms(prewalk·도보 인계)와 같은 값. 단계 전환 통지는 다음 세션의 시작 통지 하나로 대신하고, 단계 사이에 별도 문장을 더하지 않는다(뻔한 꼬리 금지). 단, 자동 인계(D5)는 사용자가 누르지 않았으므로 다음 세션 시작 통지 앞에 「아현역에 도착했습니다.」 한 문장(§8.4).

### 6.4 실패 갈래 (침묵 금지)

| 자리 | 실패 | 앱이 하는 것 |
|---|---|---|
| taxiOut 경로 조회 | 측위 실패·조회 실패 | 「택시 경로를 불러오지 못했습니다.」 + [다시 시도] 버튼, 단계 유지 |
| access 시작 | 도보 경로 실패 | prewalk `.startFailed`와 같이 대중교통 세션을 바로 시작 |
| egress 시작 | 도보 경로 실패 | 「출구까지 도보 안내를 시작하지 못했습니다.」 + [택시에 탔어요] 버튼 유지 |
| 어느 단계든 | 사용자 「안내 종료」 | 여정 전체 종료(D11), 다음 단계 없음 |
| taxiIn | 카카오 폴백 응답(안내 불가) | 시작 전 결과 화면에서 [안내 시작] 대신 기존 자동차 불가 문장(시작 게이트와 같은 술어) |

## 7. 실험판 게이트와 정식판 불변

- 앱: 입력 버튼·두 칸·여정 결과·`startJourney` 호출 자리가 전부 `AppConfig.experimentalJourneyEnabled` 뒤. 검증되면 `#if`를 지운다(항상 참 상수 금지).
- 서버: `/api/route/journey`는 웹 배포로 열리지만 정식판 앱·웹은 부르지 않는다. 기존 라우트는 `getTransitRoute` 재구성(§4.2-1)만 닿으므로 **기존 대중교통 응답 바이트 동일**을 저장 corpus 재생 테스트로 잠근다.
- 웹에는 실험판 봉인 같은 장치가 없다는 점을 적어 둔다: 라우트를 아는 누구나 부를 수 있고, 레이트 리밋(§4.1)과 키 쿼터가 유일한 방어다.

## 8. 표시·낭독 계약

### 8.1 한 줄 = 한 객체

모든 줄은 `joinText`(웹)·Kit 대응으로 쉼표 결합한 단일 `Text`. 출구 선택 두 줄은 각각 버튼(선택 상태는 trait).

### 8.2 3-state

- 출구: 있음 / 없음(`kind: "none"`, 줄 「내린 역에서 택시로 …」) / 조회 실패(`lookupFailed`, 줄 「출구 정보를 불러오지 못했습니다. 내린 역에서 택시로 …」).
- 지정 역: 찾음 / 못 찾음(판정 14 문장) / 대중교통 조회 실패(502 → 기존 대중교통 실패 문장).

### 8.3 요금

택시 요금은 추정이라 「약」을 붙이고, 대중교통 요금과 합치지 않는다(§4.2-8).

### 8.4 문안 표 (확정본, 위원장 문안 왕복 2026-10-17)

문장은 아래 그대로 옮긴다(키 이름만 가칭). 원본 파일은 저장소 밖 `~/gildongmu-wt/e70-design-reports/e70-문안-초안.txt`(위원장 저장 06:23).

| 키(가칭) | ko 문장 | 자리 |
|---|---|---|
| `journey.toggle` | 택시로 갈아탈 역 정하기 | 입력 버튼 |
| `journey.boardField` | 택시에서 내려 지하철 타는 역 | 입력 칸(역 A) |
| `journey.alightField` | 지하철에서 내려 택시 타는 역 | 입력 칸(역 B) |
| `journey.notStation` | 역을 골라 주세요. | 통지 |
| `journey.designatedHeading` | {station}역에서 타는 경로 | 변형 heading |
| `journey.recommendedHeading` | {station}역에서 타는 추천 경로 | 변형 heading(승차 쪽이 다를 때) |
| `journey.recommendedHeadingBus` | {stop}에서 버스를 타는 추천 경로 | 변형 heading(추천이 버스로 시작) |
| `journey.recommendedHeadingAlight` | {station}역에서 내리는 추천 경로 | 변형 heading(하차 쪽만 다를 때) |
| `journey.designatedMissing` | {station}역에서 타는 경로를 찾지 못했습니다. | 결과 맨 위 |
| `journey.designatedMissingAlight` | {station}역에서 내리는 경로를 찾지 못했습니다. | 결과 맨 위 |
| `journey.totals` | 총 {minutes}분, 택시 요금 약 {taxiFare}원, 대중교통 요금 {transitFare}원 | 합계 줄 |
| `journey.taxiIn` | 택시로 {station}역까지 {minutes}분, 약 {fare}원 | 구간 줄 |
| `journey.egressExit` | {exit}번 출구로 나가 택시로 {minutes}분, 약 {fare}원 | 구간 줄·선택 |
| `journey.egressStand` | 택시 승강장에서 택시로 {minutes}분, 약 {fare}원 | 선택 |
| `journey.egressNone` | 내린 역에서 택시로 {minutes}분, 약 {fare}원 | 구간 줄 |
| `journey.egressLookupFailed` | 출구 정보를 불러오지 못했습니다. 내린 역에서 택시로 {minutes}분, 약 {fare}원 | 구간 줄 |
| `journey.taxiDropped` | 택시에서 내렸어요 | taxiIn 버튼 |
| `journey.taxiBoarded` | 택시에 탔어요 | egress 버튼 |
| `journey.arrivedStation` | {station}역에 도착했습니다. | 자동 인계 통지 |
| `journey.taxiOutFailed` | 택시 경로를 불러오지 못했습니다. | taxiOut 실패 |
| `journey.egressStartFailed` | 출구까지 도보 안내를 시작하지 못했습니다. | egress 실패 |

- 승차·하차 양쪽이 모두 지정 역과 다른 추천 경로는 승차 쪽 제목(`recommendedHeading`/`recommendedHeadingBus`)을 쓴다(제목은 한 줄, 하차역 차이는 구간 줄에서 들린다). 이 조합 규칙은 설계 결정이다.
- 역 이름이 이미 "역"으로 끝나는 장소(예: 서울역)는 `{station}`에 "역"을 떼고 넣는다(「서울역역」 금지). 이름 키 정규화(`stripStationDecorations`)를 표시용으로 재사용하지 않고, 표시용 이름 함수를 따로 둔다.

수량 문장은 ICU plural 규칙(A29)을 따르고(분은 숫자 그대로라 plural 불요), ko 위치 인자 순서는 `ios/i18n/arg-order.json`이 잠근다.

## 9. 검증

### 9.1 단위·계약 테스트

- 서버 순수: 지정 역 판정(§3.2 술어, 저장 corpus 4쌍 + 신촌 동명 역 + 노선 표기 fixture), 자르기(D3) 합계 재계산, 출구 노선 거르기·예선·동점, 응답 조립(변형 하나/둘/못 찾음).
- 기존 대중교통 라우트 바이트 동일: `getTransitRoute` 재구성 전후 저장 corpus(`odsay-alternatives-2026-09-24`, `e70-design-reports/odsay-samples`) 재생 결과 동일.
- Kit: `journeyNextStage` 전이 전수(시작 단계 4가지 × 사건), 인계 세대 거르기.
- 소스 가드: `guidance-gate-drift.test.ts` 갱신(§6.2), 여정 자동차 세션의 승객 고정(D10).

### 9.2 실호출 게이트 (머지 조건)

- `scripts/verify-journey-exits.mjs`(새 파일): 실측 기록 역 10곳 + 목적지에서 출구 수집(카카오) → 노선 거르기 → 전수 Tmap 대 예선 K Tmap 비교. 예선이 최단 출구를 놓친 역 0이 통과 조건(놓치면 K 상향 후 재실행). Tmap 호출 수를 출력하고 결과를 `--out` 저장(재실행은 저장본). 위원장 실조회 구간·자택 근처 역은 쓰지 않는다(공개 저장소).
- `/api/route/journey` 실호출 3건(A만·B만·둘 다, 일반 역 쌍): ODsay 호출은 corpus 저장, 합계 예산 10건 이하.

### 9.3 실기기·실차 (위원장, §11)

## 10. 첫 판 밖과 그 이유

- **en**: 택시 구간이 Tmap ko 경로에만 안내 기하가 있다(D2). en 여정은 NCP 자동차 + 안내 가능 여부 판정이 따로 필요.
- **웹 UI**: 판정 5(iOS 실험판). 서버 계약이 같으므로 뒤에 붙일 때 `?dir=` 복원 표식(A61)을 함께 설계.
- **안드로이드**: 자동차 안내가 없다.
- **채팅 E70-b**: 같은 라우트를 도구로 부르면 된다(LLM은 여정 입력만 채운다).

## 11. 실기기·실차 판정 항목 (FIELD-TEST 후보)

1. 택시 확정 도착(D5: 종점 40m·정지·정확도 30m)이 역 앞 하차에서 제때 서는가, 신호 대기 정차에 일찍 서지 않는가.
2. 접근 도보 30m 문턱(D6)이 군더더기 안내도, 빠진 안내도 만들지 않는가.
3. 출구 도보의 역 안 위치 부정확이 "출구 번호 주인공" 안내로 감당되는가(D8).
4. 「택시에 탔어요」 뒤 첫 택시 경로가 역 안 나쁜 fix로 잡히지 않는가(A18 계열).
5. 출구 선정이 실제로 가장 빠른가(택시가 그 출구 앞에 설 수 있는지는 데이터가 없다).

## 12. 구현 순서와 소유 파일 후보

판정 근거(태스크 결합도): 서버 1~3은 파일이 겹치지 않고 계약(§4.7)으로 이어지므로 위임 가능, Kit 4는 서버와 독립, 앱 5~7은 같은 파일(`DirectionsTabView`·`GuideSessionCoordinator`·`BeaconModel`)을 순차로 고치므로 inline.

1. **ODsay 후보 진입점 분리** — `src/lib/providers/odsay.ts`(`getTransitCandidates` + `getTransitRoute` 재구성), 바이트 동일 테스트.
2. **여정 순수 계층** — `src/lib/journey/station-identity.ts`·`designated.ts`·`trim.ts`·`egress.ts`·`assemble.ts` + 테스트·fixture.
3. **provider·라우트** — `src/lib/providers/kakao-local.ts`(`searchSubwayExitsKakao`·승강장, 새 URL 빌더), `src/app/api/route/journey/route.ts`, `src/lib/rate-limit.ts`(새 버킷), `src/lib/types.ts`(Journey 타입), 실호출 게이트 `scripts/verify-journey-exits.mjs`.
4. **Kit** — `Models/RouteModels.swift`(Journey 디코딩), `RouteService.swift`(`journey(...)`), 새 `Journey.swift`(단계 전이) + `JourneyTests.swift`, `RecentSearchStore.swift`(역 필드). Kit 파일 추가는 `android/kit/mirrors/<그룹>.json`에 `pending` 등재.
5. **앱 입력·결과** — `AppConfig.swift`(플래그), `DirectionsTabView.swift`(토글·두 칸·여정 조회·결과·시작), `DirectionsEndpointSearchView.swift`(대상 둘), 문안 `ios/i18n/ios-extra/*`(§8.4 확정본).
6. **앱 세션 이어짓기** — `GuideSessionCoordinator.swift`(`startJourney`·`advanceJourney`·`JourneyContext`), `BeaconModel.swift`(`markChained`, 여정 taxiIn 확정 도착 분기, 승객 고정), `TransitGuideModel.swift`(`pendingJourneyEgress`), `BeaconTrackingSheet.swift`·`TransitTrackingSheet.swift`(두 버튼), `GildongmuApp.swift`(인계 클로저).
7. **가드·문서** — `guidance-gate-drift.test.ts`, `docs/INTEGRATIONS.md` 새 절(여정 조립·출구 수집 함정), BACKLOG E70·FIELD-TEST·CHANGELOG·PROGRESS.

## 13. 설계 리뷰

(적대적 설계 리뷰 뒤 기록)

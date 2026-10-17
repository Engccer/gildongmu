# E70 첫 판: 역에서 수단을 바꾸는 여정 (택시 → 대중교통 → 택시) 설계

- 상태: **첫 판 구현 완료**(2026-10-17, iOS 실험판 — 구현 계획 `docs/superpowers/plans/2026-10-17-e70-journey-impl-plan.md`). 설계 확정은 같은 날(적대적 설계 리뷰 2회 BLOCKER 잔여 0, 빌더 점검 반영 §13.3).
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

17. **하차 쪽만 다르고 추천 경로가 버스로 끝나면 제목은 「{정류장}에서 버스에서 내리는 추천 경로」**(2026-10-17, 빌더 점검 뒤 문답).

18. **하차 역만 정했을 때 지정 역 경로의 제목은 「{station}역에서 내리는 경로」**(2026-10-17, 구현 세션 판정 요청 — 확정 문안에 그 줄이 없었다. 「{station}역에서 내리는 경로를 찾지 못했습니다.」와 같은 짜임).

판정 19~27은 첫 판 구현 리뷰가 남긴 열린 판정 아홉(BACKLOG E70)의 위원장 판정이다(2026-10-17 코디네이터 문답).

19. **출구 도보 도착은 그 자리 이름 문장**: 「{번호}번 출구에 도착했습니다.」, 승강장이면 「택시 승강장에 도착했습니다.」 — 「목적지에 도착했습니다」는 여정이 끝난 것처럼 들린다.
20. **최근 경로 줄은 여정이면 짧은 여정 문장**: 「현재 위치에서 광화문까지, 아현역에서 갈아타기」, 역이 둘이면 「…, 아현역과 역곡역에서 갈아타기」(보통 경로는 「…부터 …까지 경로 조회」 그대로 — 위원장 재판정, 판정 요청 `judgment-202610171113` ①).
21. **펼친 역 칸 아래 보이는 버튼 「갈아탈 역 지우기」**: 두 칸을 다 비우고 접는다. 칸마다의 밀기 「삭제」는 그대로.
22. **조회 완료 알림은 지금 문장 그대로**(「1개 수단의 경로 안내가 준비되었습니다.」).
23. **추천 경로가 버스로 시작하면 정류장 문장**: 「택시로 {정류장}까지 {분}분, 약 {요금}원」·「{정류장}에 도착했습니다.」 대칭으로 버스로 끝나면 마지막 택시 줄은 「내린 정류장에서 택시로 {분}분, 약 {요금}원」(같은 판정 요청 ②).
24. **역 B를 정한 여정의 하차 직후 버튼 이름은 「다음 구간」**: 하차 통지 「내리신 뒤 다음 구간 버튼을 눌러 주세요.」가 부르는 이름과 맞춘다(다음이 출구 도보든 택시든). 다른 자리의 「택시에 탔어요」(출구 도보 중·실패 시트)는 그대로.
25. **여정 중 목적지·경유지·다른 경로 바꾸기는 숨긴다**(§6.4, 확정).
26. **동명 이역이면 두 제목에 노선을 붙인다**: 지정 역과 추천 경로의 그 쪽 역이 이름은 같고 노선이 다를 때만 「경의중앙선 신촌역에서 타는 경로를 찾지 못했습니다.」 → 「2호선 신촌역에서 타는 추천 경로」. 평소엔 지금 문장.
27. **접근 도보를 시작하지 못하면 승차 전 도보 선례의 다리 문장**(「도보 안내를 시작할 수 없어 승차 대기로 바로 넘어갑니다.」)을 원인 문장 뒤, 대중교통 시작 통지 앞에 낸다. 원인 문장과 **한 통지**(「{원인}. 도보 안내를 시작할 수 없어 …」)로 도보 모델이 낸다 — 대중교통 창구는 세션 전이라 백그라운드에서 버려지고, 따로 내면 같은 턴의 원인 문장을 끊는다(A54와 같은 이유, 구현 접근성 감사). 원인이 없는 동기 거부만 다리 문장 단독.

예문의 숫자·역은 설명용이다. 위 예문은 확정본 문장으로 맞춰 적었고, 화면 문장의 정본은 §8.4 문안 표다(위원장 문안 왕복 2026-10-17 확정).

### 3.2 지정 역 경로 불변식 (판정 7의 계약)

- **지정 역 경로**: 대중교통 변형의 첫 탈것(도보가 아닌 첫 leg)이 지하철·철도이고 그 승차역이 역 A와 **같은 역**이며(A를 지정했을 때), 마지막 탈것이 지하철·철도이고 하차역이 역 B와 같은 역이다(B를 지정했을 때).
- **같은 역** 판정은 세 조건의 곱이다(§4.3): 이름 키가 같고 ∧ ODsay 탈것의 승차(하차) 정류 좌표가 사용자가 고른 역 장소 좌표에서 **500m 안**이고 ∧ 노선 힌트가 있으면 노선도 같다. 좌표 조건은 노선 힌트 유무와 무관하게 늘 건다 — 노선 정보가 없는 입력에서 이름만으로 동일성을 확정하는 경로는 없다.
- **응답의 `designated` 변형은 이 술어를 통과한 경로뿐이다.** 술어를 통과하지 못한 경로를 `designated` 자리에 두는 코드 경로는 없다(서버 순수 함수 하나가 판정하고 그 결과로만 채운다). 못 찾으면 `designated: null` + `designatedMissing`(판정 14).
- **둘 다 지정했는데 둘 다 맞는 경로가 없을 때**: 한쪽만 맞는 경로를 세 번째 변형으로 내지 않는다(변형은 언제나 1~2개 — 판정 14의 "사실 + 추천"). `designatedMissing.side`는 두 번의 조회(전체 후보 + 지하철만) 위에서 정한다: 승차만 맞는 후보가 있으면 `"alight"`, 하차만 맞는 후보가 있으면 `"board"`, 둘 다 있거나 어느 쪽도 없으면 `"both"`. 문장은 `board` → 9번, `alight` → 10번, `both` → 9번 다음 10번 두 줄(새 문장 없음).
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
- 레이트 리밋·예산: §4.5. 요청 수가 아니라 **Tmap 호출 수**로 센다.
- 캐시: 라우트 `force-dynamic`, 응답 `no-store`(택시 시간이 실시간). 하위 조회의 캐시는 §4.6.

### 4.2 파이프라인 (순서가 계약)

1. **대중교통 후보 전체**: 출발점 = A 좌표(A 지정) 또는 `from`, 도착점 = B 좌표(B 지정) 또는 `to`. `getTransitRoute`의 정규화·강등까지(선정 전 `ranked`)를 돌려주는 새 진입점 `getTransitCandidates`(같은 `fetchOdsay`·`revalidate: 3600`, `includeStops: true` — 실시간 안내가 정차역을 쓴다). 기존 `getTransitRoute`는 이 함수 + 선정·라벨로 다시 쓰고 바이트 동일을 테스트로 잠근다.
2. **지정 역 판정**: `ranked`에서 §3.2 술어를 통과하는 첫 경로 = `designated`. 없으면 `SearchPathType=1`(지하철만, 기존 `modeAxis: "subwayOnly"` 경로) 전체 후보에서 한 번 더. 그래도 없으면 `designated = null`.
3. **추천**: 기존 선정의 1순위(`selectTransitRoutes(ranked)[0]`) = `recommended`. `designated`와 `routeKey`가 같으면 변형 하나(판정 13).
4. **자르기(D3)**: 각 변형의 legs에서 A 지정 시 첫 탈것 앞 도보를, B 지정 시 마지막 탈것 뒤 도보를 떼어 낸다. 합계는 **원래 합계에서 떼어 낸 도보의 분만 뺀다**(`totalMinutes − 뗀 도보 분`, `walkMinutes − 뗀 도보 분`) — 남은 legs로 다시 더하지 않는다. `toTransitRoute`가 거리 0인 역내 환승 도보를 legs에서 이미 빼고 그 시간은 `summary.walkMinutes`·`totalTime`에만 남겨 두므로(`odsay.ts` 정규화), 다시 더하면 환승 통로 시간이 사라진다. 요금은 ODsay `payment` 그대로. 택시가 대신하는 쪽 끝 탈것의 ODsay 출구 번호(`exit.board`/`exit.alight`)는 뗀다 — ODsay가 지정 역 좌표로 고른 출구라 하차 줄 「8번 출구 방면」과 출구 선택 줄 「2번 출구로 나가 …」가 어긋난다(구현 리뷰, 실호출 저장본 실측). 테스트: 거리 0·시간 양수 환승 통로가 있는 경로에서 총시간·도보시간 보존.
5. **택시 앞 구간**(A 지정 시, 변형마다): `from` → 첫 탈것 승차 지점(D4). `getCarRoute`(Tmap ko, 실패 시 카카오 폴백 — 폴백 응답은 `provider: "kakao"`라 안내 불가 표시). 두 변형의 승차 지점이 같으면 한 번만 부른다.
6. **출구 후보**(B 지정 시, 변형마다, 마지막 탈것이 지하철·철도일 때만): §4.4.
7. **택시 뒤 구간**: 선택 후보(기본 = 택시 시간 최단 출구, 승강장은 별도 후보)마다 후보 좌표 → `to`. §4.5 예산 안에서.
8. **조립·합산**: 변형마다 `totalMinutes = 택시 앞 + 대중교통(잘린) + 택시 뒤(기본 후보)`, 요금은 택시 요금 합(Tmap `taxiFare` 추정)과 대중교통 요금을 따로 싣는다(합치지 않는다 — 택시는 추정치, 대중교통은 정액).

### 4.3 역 같음 판정 (순수 함수, 새 파일 `src/lib/journey/station-identity.ts`)

- 이름 키: `normalizeStationName`(기존). ODsay leg의 `fromName`/`toName`, 요청 `boardName`/`alightName` 양쪽에 같은 함수.
- 노선: 요청 노선 힌트와 ODsay `lineName`을 **지역 접두(`수도권`·`부산`·`대구`·`광주`·`대전`)와 구분자를 걷은 코어**로 비교. ⚠ 기존 `lineHintMatches("수도권 2호선", "2호선")`은 코어가 `수도권2` 대 `2`라 거짓이다(숫자 코어는 완전 일치만) — 그대로 쓰지 말고 접두를 먼저 걷는 래퍼를 둔다. 카카오 카테고리 표기(`수도권2호선`·`경의중앙선`·`수인분당선` 등)와 ODsay 표기(`수도권 2호선`·`경의중앙선`·`수도권 수인.분당선`)의 대응은 **실호출 표본으로 만든 공유 fixture**로 잠근다(구현 세션: 카카오 키워드로 수도권 노선별 역 하나씩 + 저장 corpus의 ODsay `lineName`).
- **좌표 조건(늘 건다)**: ODsay 탈것의 `startX/startY`(승차)·`endX/endY`(하차)와 요청 역 좌표의 Haversine ≤ `JOURNEY_STATION_IDENTITY_M = 500`. 근거(저장 corpus 실측 2026-10-17): 한 환승 복합체 안 노선 간 정류 좌표 거리 최대 426m(잠실 8호선 ↔ 2호선), 서울역 공항철도 331m. 동명 이역 신촌(경의중앙선 ↔ 2호선)은 680m(카카오 경의중앙선 신촌 좌표 기준). 반경 안이면 노선 힌트가 없을 때 그 복합체의 어느 노선이든 같은 역으로 본다(사용자가 노선 없이 고른 역이므로).
- 이름 키가 같고 노선이 다르면 다른 역이다. 이름 키가 같고 좌표가 반경 밖이면 다른 역이다(신촌 사례 — 노선 없는 입력 `신촌역` + 경의중앙선 좌표가 필수 반례 fixture).
- 반경 상수는 이 판정의 유일한 새 수치이고, 구현 세션이 수도권 환승역 전수(저장 corpus + 실호출 게이트 표본)로 "복합체 최대 거리 < 500 < 동명 이역 최소 거리"를 테스트로 잠근다. 깨지면 이 절로 돌아온다.

### 4.4 출구·승강장 후보 (새 provider 함수 + 순수 선정)

- **수집**: `searchSubwayExitsKakao(stationName, coord)` — `"{역}역 {n}번출구"`를 n=1부터, 좌표 반경 800m, 3번 연속 미발견이면 중단, 상한 n ≤ 25(`probe-taxi-exit.py` 방법 A 그대로). 결과 중 카테고리 끝이 `지하철출구`이고 이름이 `"{역}역"`으로 시작하는 것만. 이름에서 노선(`노량진역 1호선 9번출구`)과 번호(`9`, `3-1`)를 뽑는다. 기존 `buildKakaoSearchUrl`은 `radius`를 받지 않으므로 새 URL 빌더.
- **노선 거르기(판정 10)**: 마지막 탈것 노선과 같은 노선의 출구만(§4.3 노선 비교). 노선 표기가 없는 출구(단일 노선 역은 `"{역}역 2번출구"`로만 등록되기도 한다)는 그 역의 등록 출구가 모두 노선 표기 없음일 때만 후보로 받는다 — 섞여 있으면 표기 없는 것은 버린다.
- **승강장(판정 11)**: `"{역}역 택시승강장"`·`"택시승강장"` 반경 500m, 이름에 "택시"가 든 POI. 하차역 좌표 300m 안에서 가장 가까운 하나만 후보.
- **0건**: 출구도 승강장도 없으면 택시 뒤 구간 출발 = 하차 정류 좌표, 출구 도보 없음(후보 `kind: "none"`). 출구 조회 실패(카카오 throw)도 같은 후보를 쓰되 `egress.lookupFailed: true`를 싣는다(3-state: 없음 ≠ 조회 실패).
- **캐시**: 카카오 응답 보관 상한 300초(2026-10-03 위원장 판정, `kakao-cache-ttl.test.ts`)를 그대로 따른다 — 출구가 정적이어도 더 길게 두지 않는다. 각 번호 질의는 `revalidate: 300` 숫자 리터럴(가드가 읽는 형식). 래퍼 캐시(`unstable_cache` 등)로 카카오 응답을 300초 넘게 들고 있지 않는다(그 래퍼도 같은 가드 대상에 넣는다).
- 질의 수: 캐시 미스 때 역당 약 10~25회(무료, 카카오 로컬 일 한도 안). 지연을 줄이려 n=1..8을 병렬로 먼저 보내고 발견이 이어지면 다음 묶음.

### 4.5 Tmap 호출 예산

**문제**: 여정 조회는 Tmap을 여러 번 부르고, Tmap 일 1,000건 무료분은 정식판 자동차 안내·도보 폴백과 공유한다. 서버 조립 호출은 `/api/route/car` 핸들러의 `checkCarRateLimit`을 지나지 않으므로, 따로 세면 한 IP가 두 버킷을 합쳐 더 쓸 수 있다.

1. **한 조회의 상한 8회, 팬아웃 전 정확한 비용으로 예약**: 카카오 출구 수집(무료)이 끝난 뒤, Tmap을 부르기 **전에** 이번 조회가 부를 Tmap 호출 수를 정확히 계산해 한 번에 예약한다. 비용 = 서로 다른 택시 앞 목적지 수(≤ 2) + 서로 다른 택시 뒤 출발 좌표 수. 택시 뒤 출발 좌표는 하차 그룹(아래 2)마다의 출구 후보 + 승강장(좌표가 같으면 하나) + 출구 0건·카카오 실패 그룹의 하차 정류 좌표 하나다. 합이 8을 넘으면 출구 후보를 줄인다(기본 변형 그룹이 남은 칸의 올림 몫). **예약하지 않은 Tmap 호출은 없다** — 후보가 전부 실패해도 복구 호출을 더 하지 않는다(아래 6).
2. **출구 선정의 단위는 (하차역, 하차 노선) 그룹**: 카카오 원시 출구 검색은 하차역 이름 키 단위로 한 번 하고 공유하지만, 후보 자격(판정 10 "내린 노선의 출구만")과 최종 선정은 그룹마다 한다. 노선 힌트 없는 환승역 입력에서 두 변형이 같은 역에 다른 노선으로 내리면 두 그룹이다. 좌표가 같은 Tmap 조회(같은 출구·같은 승강장)만 그룹 사이에 공유한다. 계약 테스트: 같은 역·다른 하차 노선 두 변형의 출구가 섞이지 않고 예약 비용이 위 계산과 같다.
3. **여정 버킷을 호출 수로**: 여정 라우트는 자기 버킷 `journeyStore`(IP당 60초 **16회**, 호출 수 단위)에 위 1의 비용을 `reserveCalls(store, ip, now, cost)`(`evaluateRateLimit`의 비용 판 — 모자라면 아무것도 쓰지 않고 거절)로 예약한다. 거절이면 429, iOS는 기존 길찾기 조회 실패 문장. 16은 1분 안에 두 번 조회(예: 역 A만 넣고 조회한 뒤 B를 더해 다시)를 받는 값이다. 자동차 라우트 버킷(10회)과 합치지 않는다 — 합치면 여정 조회 직후 안내 시작의 자동차 상세 조회(`/api/route/car`)와 재조회가 스스로 429에 걸린다(빌더 점검 6). 공유 일일 쿼터 보호는 이 IP 버킷이 아니라 아래 4의 일 상한이 맡는다.
4. **인스턴스 일 상한**: 여정 라우트가 쓴 Tmap 호출을 KST 하루 단위로 세어 200회에서 503 `{ "budgetExhausted": true }`(iOS: 기존 조회 실패 문장). ⚠ in-memory라 인스턴스별이다(`rate-limit.ts` 머리 주석과 같은 한계) — 전역 정확한 상한·정식판 예약분은 외부 공유 저장소가 있어야 하고, 그것은 새 외부 통합이라 첫 판 밖이다. 첫 판의 실사용자는 실험판 사용자(위원장)뿐이라 하루 호출이 수십 회 수준이다. 실험판을 넓히기 전에 이 절을 다시 연다(BACKLOG 편승 항목).
5. **후보 예선**: 노선 거른 출구가 그룹의 칸 수(위 1)를 넘으면 출구에서 `to`까지 직선거리 오름차순 5개. ⚠ 이 예선은 이 spec의 추정이다(9월 실측 원본 응답이 남아 있지 않아 "직선 상위 5 안에 시간 최단 출구가 드는가"를 재지 못했다). 구현 세션의 실호출 게이트(§9.2)가 실측 기록 역 10곳에서 전수 대 예선(한 그룹 5칸)을 대조한다. 예선이 최단을 놓친 역이 있으면 예선 기준을 바꾸거나(예: 하차역 → `to` 방위 쪽 출구 우선) 상한을 올리되 위 3의 버킷 안에 들어야 하므로, 상한을 올리려면 이 절과 버킷 수치를 함께 고친다.
6. 동점(분 단위 같음)은 하차역 정류 좌표 → 출구 직선거리가 짧은 쪽(판정 10 "역 안 걷는 거리"의 근사).
7. **Tmap 실패·폴백**: 택시 뒤 후보 하나가 실패하면 그 후보만 뺀다(남은 후보로 선정). 한 그룹의 후보가 전부 실패하면 여정 502다(추가 복구 호출 없음 — 예약 밖 호출을 만들지 않고, Tmap이 그 정도로 실패하면 택시 구간 자체가 성립하지 않는다). `egress.lookupFailed`는 **카카오 출구 조회 실패**만 뜻하고, 그때 그 그룹의 후보는 하차 정류 좌표 하나다(위 1의 비용에 이미 들어 있다). 카카오 폴백 응답(`provider: "kakao"`)은 후보 시간 비교에는 쓰되 안내 가능 여부는 §6.4가 실제 승차 시점에 다시 판정한다.

### 4.6 캐시와 비용

| 조회 | 캐시 | 한 여정 조회당 |
|---|---|---|
| ODsay 후보 | 기존 `revalidate: 3600`, 좌표 4자리 | 1회(+ 지하철만 재조회 1회, 지정 역이 없을 때만). `includeStops`라 급행 정차역 조회(`fetchExpressStopsMap`, 7일 캐시)가 후보 묶음마다 따라붙는다 — 일반 iOS 대중교통 조회와 같은 경로 |
| 카카오 출구·승강장 | `revalidate: 300`(카카오 상한) | 캐시 미스 때 하차역당 약 10~25회(무료) |
| Tmap 택시 | 없음(`no-store`, 실시간 교통) | 최대 8회, 팬아웃 전 정확한 비용 예약(§4.5) |
| 여정 응답 | 없음 | — |

ODsay는 건당 약 27원(Flex). 여정 조회는 일반 대중교통 조회보다 ODsay를 더 쓰지 않는다(최악 2회). E47 ②③ 보류 판정(월 청구 3만 원 재검토 신호)에 닿을 규모가 아니다.

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
- 역만 받는다: 고른 장소가 `stationLayoutKind`(Kit `StationPhone.swift`) `subway`/`rail`이 아니면 칸에 넣지 않고 통지 「역을 골라 주세요.」(`.high` + 주의 진동 — 화면 변화 없는 활성화 응답이라 저장소 통지 우선순위 판별선을 따른다). 역 칸 검색은 주소 후보를 담지 않는다(건수·0건이 보이는 후보 기준).
- 채운 칸은 밀기 「삭제」(최근 기록 행과 같은 동작 이름)로 비운다. 두 칸 아래 보이는 버튼 「갈아탈 역 지우기」는 두 칸을 함께 비우고 접는다(판정 21). 두 칸이 다 비면 접혀 펼침 버튼으로 돌아가고 커서는 조회 버튼으로 간다(D12 "세 수단이 필요하면 역 칸을 비운다"의 길). 노선 힌트는 장소 이름 꼬리(`parseStationQuery`의 Kit 대응) 또는 카테고리 마지막 조각.
- 검색 시트의 반환(빌더 점검 5): 지금 시트는 끝점(`DirectionsEndpoint` — 이름·좌표·로마자)만 돌려주고 분류를 넘기지 않는다. 역 칸 둘은 **역 칸 전용 결과**(`Place` 그대로 — 분류 포함)를 받는 별도 콜백으로 연다. `DirectionsEndpoint`(Kit 공유 타입·최근 기록 저장 포맷)는 넓히지 않는다. 역 칸의 시트에는 최근 끝점 목록을 보이지 않는다(분류가 없어 역인지 알 수 없다) — 반복 여정은 최근 경로(§5.3)가 통째로 복원한다.
- 두 칸이 다 비면 지금과 같은 세 수단 조회. 하나라도 있으면 여정 조회(D12). 펼친 상태에서 경유지 행은 사라진다(D14).
- 봉인: 버튼과 두 칸은 `AppConfig.experimentalJourneyEnabled`(`#if EXPERIMENTAL`) 안에만.

### 5.2 결과 (판정 13·14·16)

읽기 순서(한 줄 = 한 접근성 객체):

1. (못 찾았을 때만) 「아현역에서 타는 경로를 찾지 못했습니다.」
2. 변형이 둘이면 변형마다 heading 한 줄(「아현역에서 타는 경로」 / 「애오개역에서 타는 추천 경로」) + 선택 버튼. 하나면 heading 없이 바로 3.
3. 합계 줄: 「총 41분, 택시 요금 약 15,600원, 대중교통 요금 1,550원」.
4. 구간 줄: 「택시로 아현역까지 8분, 약 7,800원」 → 기존 대중교통 구간 줄들(`legBoard` 등, 앞뒤 도보 없음) → 출구 선택(승강장이 있으면 두 줄 버튼, 없으면 한 줄 「1번 출구로 나가 택시로 13분, 약 7,800원」).
5. [안내 시작] 버튼(선택된 변형·출구로).

포커스: 조회 완료 시 옮기지 않는다 — 이 화면의 현행 규칙(위원장 판정 2026-08-02: 조회 버튼에 머물고 다음 스와이프가 상태 → 결과로 잇는다). 여정을 찾으면 최근 경로 목록은 숨긴다(결과 앞에 끼지 않게).

heading 구조(구현 접근성 감사): 변형이 둘이면 선택 버튼 둘은 선택 trait + 시각 체크만 갖고, heading은 **고른 변형의 제목 한 줄**에만 둔다 — 선택 버튼에 heading을 달면 고르지 않은 변형 제목 아래에 고른 변형의 합계가 이어진다.

### 5.3 저장·복원 (D13)

- `RecentRoute`에 선택 필드 `boardStation`·`alightStation`(이름·좌표·노선 힌트 — 역 칸 전용 값, `DirectionsEndpoint`가 아님) 추가, `sameRoute`가 둘도 비교. 구버전 저장본 디코딩은 부재 = nil.
- 최근 경로에서 여정을 고르면 칸을 채우고 펼친 상태로 조회(양끝이 있을 때만 자동 조회 — 기존 프리필 규칙).
- 최근 경로 줄은 여정이면 여정 문장 「{출발}에서 {도착}까지, {역}역에서 갈아타기」다(판정 20) — 같은 출발·도착의 보통 경로와 들어서 가른다. 활성화가 역을 쓰는 조건(실험판·앱 언어 ko)에서만이고, 그 밖엔 활성화가 역을 버리므로 줄도 보통 문장이다.
- 웹 `?dir=`는 첫 판에서 건드리지 않는다(웹 UI 없음).

## 6. iOS 여정 안내 (상태 머신)

### 6.1 단계와 사건

여정 단계 `JourneyStage`는 안내 단계 넷과 그 사이 상태 둘이다.

| 단계 | 그 동안 도는 세션 | 끝나는 사건 |
|---|---|---|
| `taxiIn` | 자동차(승객, chained) | `taxiArrived`(자동차 확정 도착, D5) ∨ `taxiDropped`(「택시에서 내렸어요」) ∨ 세션 종료 사유(아래 표) |
| `access` | 도보(chained) | 세션 종료 사유(아래 표) |
| `transit` | 대중교통 | `rideCompleted`(§6.3, 말미 도보 유무와 무관) ∨ `transitStopped`(그 밖의 종료) |
| `egress` | 도보(chained) | `taxiBoarded`(「택시에 탔어요」) ∨ 세션 종료 사유(아래 표) |
| `taxiOut` | 자동차(승객) | 일반 자동차 도착·종료(여정 끝) |
| `transitioning(to:)` | 없음(다음 세션 준비: 측위·경로 조회·600ms 인계) | 준비 성공 → 다음 단계 / 실패 → `failed(at:)` |
| `failed(at:)` | 없음 | `retry` → `transitioning(to: at)` / 「안내 종료」 |

**chained 세션의 종료 사유 전수 대응**(`BeaconModel.EndReason` 넷 전부 — 빠진 사유가 있으면 세션은 사라지고 여정만 남는다):

| 사유 | taxiIn | access | egress |
|---|---|---|---|
| `.arrived`(확정·추정 도착, prewalk의 도착 선언 포함) | → access/transit(`taxiArrived`와 같은 전이) | → transit | → taxiOut |
| `.userStopped`(그 시트의 「안내 종료」) | 여정 전체 종료(D11) | 여정 전체 종료 | 여정 전체 종료 |
| `.startFailed` | `failed(at: .taxiIn)` | → transit(prewalk 선례) | `failed(at: .egress)` |
| `.ended`(진행 중 끊김: 위치 권한 철회·정밀 위치 꺼짐 `stopAndFail`, 잊힌 세션 안전망 등) | `failed(at: .taxiIn, cause:)` | → transit(역 근처라 대중교통 세션이 이어받는다) | `failed(at: .egress, cause:)` |

- `cause`(`.ended`와 `.startFailed` 둘 다 — 시작 실패의 흔한 원인도 권한·정밀 위치다, 구현 리뷰)는 그 모델이 이미 낸 실패 문장 키와 해결 수단(`stopAndFail`의 `key`·`FailResolution` — `.settings`·`.precise`)이다. `BeaconModel`이 마지막 실패를 `lastFailure`로 남기고 `onSessionEnd` 콜백 시점에 코디네이터가 읽는다. `.journey` 시트는 그 문장을 상태 줄로 쓰고(새 문장 없음) 해결 수단 버튼(기존 「설정 열기」류) + [다시 시도] + 단계 버튼(taxiIn이면 「택시에서 내렸어요」, egress면 「택시에 탔어요」) + [안내 종료]를 둔다. 통지는 그 모델이 이미 했으므로 다시 하지 않는다.
- `transitStopped`(대중교통 시트의 「안내 종료」·그 밖의 `stop()`): 여정 전체 종료. `TransitGuideModel.stop()`이 `.done` 갈래가 아닌 경로로 불렸을 때 `onJourneyStopped`를 한 번 부른다.
- taxiOut은 chained가 아니다(여정의 마지막 세션 — 일반 자동차 종료 화면을 남기고, 끝나면 여정 상태를 지운다).

- 시작 단계는 plan이 정한다: A 지정이면 `taxiIn`, 아니면 `transit`. 접근 도보는 인계 시점 위치 → 승차 지점 직선 30m 이상일 때만(D6), 출구 도보는 출구·승강장 후보가 있을 때만(`kind: "none"`이면 `transit → taxiOut`).
- B 미지정이면 `transit`의 끝은 지금의 말미 도보 인계(`acceptWalkHandoff`)를 그대로 쓰고 여정은 거기서 끝난다(여정이 아는 마지막 단계가 transit).
- 「안내 종료」는 어느 단계(사이 상태 포함)에서든 여정 전체 종료(D11).
- 전이 표는 Kit 순수 함수 `journeyStep(state:, event:) -> JourneyState?`(새 파일 `Journey.swift`)가 정한다. `JourneyState`는 `{ journeyId, stage, transitionSeq }`이고 모든 사건은 자기가 관측한 `(journeyId, transitionSeq)`를 들고 온다 — 지금 값과 다르면 `nil`(무시). `JourneyTests`가 전이 전수 + 낡은 사건 무시 + 경쟁(자동 도착과 버튼이 같은 seq로 둘 다 옴 → 첫 사건만 전이)을 잠근다.

### 6.2 시작과 봉인

- 시작은 `GuideSession.startJourney(plan:)` 한 곳. `plan` = 선택된 변형 + 선택된 출구(서버 응답 투영) + 출발·도착 라벨.
- `guidance-gate-drift.test.ts`: 세션 시작 호출 전수에 `startJourney` 진입점과 여정 단계 시작 `startJourneyStage`(그 안의 `beginBeacon(`·`beginTransit(` — §6.3)를 더하고(현재 7·4 수치 갱신), `begin*`의 호출자가 공개 `start*`와 `startJourneyStage` 둘뿐임을 세며, 길찾기 화면의 `startJourney` 호출이 `AppConfig.experimentalJourneyEnabled` 조건 안에 있는지 `enclosingHeaders`로 검사한다(나들이 선례).

### 6.3 세션 이어짓기 장치

**점유와 화면은 여정이 소유하고, 여정 자신의 다음 세션만 그 점유를 지난다**(사이 상태 포함):

- `GuideSession`이 `journey: JourneyState?` + plan을 가진다. **점유 판정은 두 층이다**(빌더 점검 1):
  - `isActive`(지금 그대로: 코디네이터 점유 ∨ 모델 시작 대기) — **단계 세션이 도는가**. 모델 입구 셋(`BeaconModel.requestStart`, `TransitGuideModel.start`·`startAfterPrewalk`)이 보는 값이고 바꾸지 않는다. 그래서 단계 사이(단계 세션 없음)에는 여정 자신의 다음 세션 시작이 모델 입구를 통과한다.
  - 새 `isOccupied = isActive ∨ journey != nil` — **외부 시작을 막는가**. `refuseIfActive`(공개 `start*`·`startOuting`)와 길찾기 탭의 `beacon.restart()` 호출 자리(정밀 위치 허용 뒤 재시작)가 이 값을 본다. 여정 중 `restart()`는 부르지 않는다 — 여정의 `failed` 시트가 해결 수단(정밀 위치) 뒤 [다시 시도]로 같은 일을 한다.
  - 여정이 없을 때 `isOccupied == isActive`라 정식판 동작은 그대로다.
- `screen`은 단계 세션이 없는 동안(`transitioning`·`failed`) 새 화면 종류 `.journey`를 돌려준다 — 재시도 버튼이 놓일 시트가 늘 있다. `.journey` 시트는 상태 문장 한 줄 + (failed면) 해결 수단·[다시 시도]·단계 버튼 + [안내 종료]이고 착지는 상태 문장. `transitioning`의 상태 문장은 다음 세션 준비 중이라는 기존 진행 문장(구현 세션이 기존 키에서 고른다 — 새 문장이 필요하면 문안 왕복).
- 기존 루트 `.sheet(item:)` 하나 규칙(N1)을 그대로 쓴다: `.journey`는 그 item의 새 경우일 뿐 시트를 더하지 않는다.
- **외부 시작과 내부 인계를 가른다**: 지금 `startBeacon`·`startTransit`은 첫 줄이 `refuseIfActive()`이고 그것이 `isOccupied`를 보게 되므로, 여정이 같은 함수로 자기 다음 세션을 시작하면 막힌다. 그래서 두 함수의 본문을 거부 가드 없는 private `beginBeacon(_:)`·`beginTransit(...)`으로 옮기고, 공개 `startBeacon`·`startTransit`은 `refuseIfActive()` + 그 호출로 남긴다(외부 시작은 여정 중 거부 — 지금 동작 그대로). 여정의 단계 시작은 `startJourneyStage(_:token:)` 한 함수만 `begin*`을 부르고, 들어오자마자 ① `token == (journeyId, transitionSeq)` ② 단계 세션이 돌고 있지 않음(`!beacon.isTracking && !beacon.starting && !transit.isTracking`)을 확인한다 — 둘 중 하나라도 거짓이면 아무것도 시작하지 않는다. 점유를 잠시 푸는 방식은 쓰지 않는다(그 틈에 외부 시작이 끼어든다).
- 기존 인계 `acceptWalkHandoff`·`acceptCarWalkHandoff`·`acceptOutingReturn`은 여정 안에서 쓰지 않는다(여정의 다음 단계가 그 자리를 맡는다). 승차 전 도보(prewalk)는 갈린다(모델 입구 `startAfterPrewalk`의 가드는 `isActive`를 보므로 prewalk 도보 세션이 끝난 뒤 통과한다): **A 지정** 여정은 잘린 경로라 첫 탈것 앞 도보가 없어 `transitPrewalkTarget`이 서지 않고, 택시 하차 뒤 걷기는 여정 단계 access가 맡는다. **A 미지정** 여정은 첫 단계가 출발지에서 시작하는 보통 대중교통이므로 `beginTransit` 본문의 prewalk(`endPrewalk` → `transit.startAfterPrewalk`, 거부 가드를 지나지 않는 내부 인계)를 그대로 쓴다. 두 경우 모두 단일 슬롯 `onSessionEnd`를 동시에 두 소유자가 쓰지 않는다(prewalk와 chained 도보는 한 여정에서 겹치지 않는다).
- 통합 테스트(소스 가드 + Kit 순수): 최초 시작, 단계 인계 전부, 실패 뒤 재시도가 시작에 성공하고, 여정 중 외부 시작(길찾기 탭 도보·자동차·대중교통 시작, 나들이)은 `guide.alreadyActive`로 거부된다. `guidance-gate-drift.test.ts`의 `ENTRY_CALL`은 `beginBeacon(`도 센다.

**전이는 원자적으로 예약한다**:

- 단계 세션이 끝나는 사건은 `GuideSession.advanceJourney(event:)` 한 곳으로 온다. 이 함수는 **동기로** `journeyStep`을 돌려 `transitioning(to:)` + `transitionSeq += 1`을 먼저 커밋하고, 그 뒤에 `Task`로 준비 작업(측위·`RouteService.car`·600ms 지연)을 시작한다. 그 `Task` 핸들은 `JourneyState` 옆에 하나만 보관하고, 완료는 자기 seq가 지금 seq와 같을 때만 다음 세션을 시작한다.
- 「안내 종료」·여정 종료는 seq를 올리고 보관한 `Task`를 취소하며 단계 세션을 멈춘다. 늦게 도착한 prewalk 콜백·조회 완료·600ms 지연은 seq 불일치로 버려진다.
- 백그라운드: 사이 상태의 준비 작업은 측위·HTTP 한 번이라 백그라운드에서도 끝난다(대중교통 keep-alive 위치 스트림은 transit 세션이 끝나면 멈추므로, `egress → taxiOut` 준비는 egress 도보 세션의 위치 스트림이 살아 있는 동안 커밋된 seq로 돈다). 앱이 중단되어 복귀하면 `failed` 또는 `transitioning`이 남아 있고 시트가 그 상태를 보여 준다 — 복귀 시 `transitioning`이 30초 넘게 남아 있으면 `failed`로 내린다(조용한 영구 대기 금지).

**도보 단계(access·egress)**: `BeaconModel`의 prewalk 표식을 일반화한 `markChained(journeyId:, seq:)` — 종료 화면을 남기지 않고, 잊힌 세션 안전망을 끄고, 단일 슬롯 `onSessionEnd(reason)`로 끝난 사유를 `advanceJourney`에 넘긴다(사유와 함께 seq를 실어 낡은 콜백을 거른다). 출구 도보의 목적지 라벨은 출구 번호(D8).

**대중교통의 끝 = `rideCompleted`(말미 도보와 무관)**:

- 지금 마지막 leg의 전이는 `TransitGuideModel.completeOrAdvance`의 `phase == .done` 갈래 한 곳에서만 끝나고(시트 버튼 `advanceOrHandoff` → `advance()`/`advanceIntoWalkHandoff()` 둘 다 여기로 온다), 말미 도보 인계 신호 `pendingWalkHandoff`는 `route.walkAfterMinutes`가 있을 때만 생긴다. 여정 경로는 B 쪽 말미 도보를 잘라 냈으므로(D3) 이 신호에 기대면 인계가 사라진다.
- 그래서 여정이면 같은 `.done` 갈래가 `walkAfterMinutes`를 보지 않고 **`onJourneyRideCompleted` 콜백을 정확히 한 번** 부른다(`stop()` 뒤, 기존 `pendingWalkHandoff` 대신 — 둘이 동시에 서지 않는다). 콜백은 `GildongmuApp`의 기존 인계 클로저 옆에서 `advanceJourney(.rideCompleted)`로 이어진다.
- 시트의 마지막 leg 버튼: 여정이면 `handoffNow`가 `walkAfterMinutes`가 아니라 여정 다음 단계로 정해지고, 라벨은 다음 단계와 무관하게 「다음 구간」(`transitGuide.advance`)이다 — 하차 통지가 그 이름을 부른다(판정 24, 잘린 경로엔 말미 도보 분이 없어 통지는 `arrived` 문장). 새 문구는 없다.
- 소스 가드: `.done`에 닿는 자리가 `completeOrAdvance` 하나뿐이고 그 갈래가 여정 콜백을 부른다는 것을 `TransitGuideModel.swift` 소스로 센다(새 `.done` 진입 자리가 생기면 빨갛게).
- B 미지정 여정은 이 콜백을 걸지 않는다(기존 말미 도보 인계 그대로).

**택시 → 대중교통**: 자동차 확정 도착(D5)에서 지금은 종료 화면 + 「걸어서 안내」(`acceptCarWalkHandoff`)가 뜬다. 여정 `taxiIn`이면 종료 화면을 만들지 않고(`arrivalDest`를 세우지 않는다) `advanceJourney(.taxiArrived)`. 「택시에서 내렸어요」는 `taxiIn` 동안 시트에 늘 있다(`.taxiDropped`). 둘 다 같은 seq를 실어 먼저 온 쪽만 전이한다.

**egress → taxiOut**: 출구 도착(도보 최종 접근) 또는 「택시에 탔어요」(egress 동안 시트에 늘 있음) → `transitioning(to: .taxiOut)` → 600ms 뒤 자동차 세션 시작(`kind: .car`, `listener: .passenger`). 경로 조회·출발 좌표는 세션이 첫 fix로 스스로 정하므로(아래 "택시 세션의 경로") 사전 측위를 하지 않는다 — 측위 실패는 그 세션의 `.startFailed`로 온다(구현에서 두 절의 모순을 이 쪽으로 정리). 접근 도보 판정(D6)의 위치는 캐시 우선(`currentCoordinate(force: false)`)이다 — 택시가 막 확정 도착했으면 정확도 30m 안 fix가 있고, 잠금 화면에서 새 측위를 걸면 다음 단계가 말없이 늦는다. 측위 실패면 접근 도보를 시작한다.

**접근 도보의 도착 선언**: 접근 도보는 승차 전 도보(A25)와 같은 자리라 같은 「{역} 도착」 선언 버튼과 도착 문장 「승차역 {역}에 도착했습니다.」를 쓴다(`markPrewalk` 병행 — 지하로 먼저 들어가 도착 판정이 닿지 않으면 시트의 유일한 버튼이 여정 전체 종료가 된다, 구현 리뷰). 택시 자동 도착 문장은 승차 지점이 버스 정류장이면 「{정류장}에 도착했습니다.」(판정 23, Kit `JourneyVariant.boardsAtBusStop`). 출구 도보 도착은 「{번호}번 출구에 도착했습니다.」·「택시 승강장에 도착했습니다.」(판정 19).

**택시 세션의 경로**(빌더 점검 2): 자동차 세션은 `StartRequest`로 경로를 받지 않고 첫 fix에서 `/api/route/car`를 스스로 부른다(`BeaconModel.fetchDetailData`). 여정은 이 시작 경로를 바꾸지 않는다(정식판 자동차 시작 회귀 0) — 서버 여정 응답의 택시 브리핑은 결과 화면 표시·출구 선정에만 쓰고 세션에 넘기지 않으며, 시작 전 별도 조회·검사도 하지 않는다(버려지는 Tmap 호출 0). 세션 안 조회가 카카오 폴백·기하 실패로 끝나면 지금처럼 직선거리 간략 모드로 계속한다: 택시 승객에게 필요한 것은 회전 안내가 아니라 남은 거리와 도착 판정이고, 확정 도착(`carArrivalStep`)은 거리만으로 선다. 그래서 여정의 택시 단계에서 간략 모드는 실패가 아니다.

**승객 고정(D10)**: `StartRequest`에 `carListener: CarListener?`를 기본값 없는 필드로 더한다(nil = 지금처럼 설정값을 읽는다, 여정은 `.passenger`). 기존 호출 자리 전부가 nil을 명시한다(안전 인자 기본값 금지 규율).

**통지**: 인계 지연은 기존 600ms(prewalk·도보 인계)와 같은 값. 단계 전환 통지는 다음 세션의 시작 통지 하나로 대신하고 단계 사이에 문장을 더하지 않는다(뻔한 꼬리 금지). 단, 자동 인계(`taxiArrived`)는 사용자가 누르지 않았으므로 다음 세션 시작 통지 앞에 「{station}역에 도착했습니다.」 한 문장.

### 6.4 실패 갈래 (침묵 금지)

**택시 단계의 실패는 세션 시작 실패와 진행 중 끊김뿐이다**: 카카오 폴백·기하 실패는 간략 모드로 계속하므로 실패가 아니다(§6.3 "택시 세션의 경로"). 비동기 시작 실패(`onSessionEnd(.startFailed)` — 측위 실패 등)와 진행 중 `.ended`(§6.1 표)가 `failed`로 간다. 동기 거부는 `startJourneyStage`가 단계 세션 부재를 먼저 확인하므로 일어나지 않는다(일어나면 불변식 위반 — 로그 + `failed`).

| 자리 | 실패 | 앱이 하는 것 |
|---|---|---|
| taxiIn·taxiOut 시작 | `transitioning`의 force 측위 실패, 세션 `.startFailed` | `failed(at: 그 단계)`: 시트 상태 문장 「택시 경로를 불러오지 못했습니다.」 + [다시 시도] + [안내 종료] |
| access 시작 | 도보 경로 실패 | prewalk `.startFailed`와 같이 다리 문장 「도보 안내를 시작할 수 없어 승차 대기로 바로 넘어갑니다.」(`transitGuide.prewalkUnavailable`, 판정 27) 뒤 대중교통 세션을 바로 시작(`transitioning(to: .transit)`) |
| egress 시작 | 도보 경로 실패 | `failed(at: .egress)`: 「출구까지 도보 안내를 시작하지 못했습니다.」 + [택시에 탔어요] + [안내 종료]([택시에 탔어요]가 곧 재시도 대신 다음 단계) |
| 사이 상태 30초 초과(복귀 시) | 준비 작업이 끝나지 않음 | 그 단계의 `failed`로 |
| 어느 단계든 | 「안내 종료」 | 여정 전체 종료(D11), 보관 `Task` 취소, 다음 단계 없음 |

- 대중교통 단계 시작에는 실패 갈래가 없다: 거부할 수 있는 것은 모델 입구 가드(`GuideSession.shared.isActive`)뿐이고 `startJourneyStage`가 그 조건(단계 세션 부재)을 먼저 확인한다. 이 불변식은 테스트로 잠근다. 그래도 깨지면(지금 token인데 단계 세션이 돎·계획 누락·경로 변환 실패) 침묵 종료가 아니라 `.stageEnded(.startFailed)`로 넘긴다 — 대중교통 단계는 `failed(at: .transit)`(Kit 표에 행을 더했다, 상태 문장 「경로를 불러오지 못했습니다.」 + [경로 다시 조회]).
- 여정 중에는 목적지·경유지·다른 경로 바꾸기를 숨긴다(제목 메뉴·장소 상세·경유지 버튼·조망) — 바꾸면 계획과 갈라지고 길찾기 폼이 유료 여정 재조회를 무통지로 돌린다(구현 교차 검토, 판정 25로 확정).
- [다시 시도]는 기존 키 「경로 다시 조회」(`guide.rerouteButton`)다 — 저장소에 「다시 시도」 키가 없다. 대중교통 단계 준비가 복귀 시 30초를 넘겨 `failed(.transit)`이 되면 상태 문장은 「경로를 불러오지 못했습니다.」(`route.transit.error`), 30초 초과 실패는 한 번 통지한다(어느 모델도 말하지 않은 실패라 최소화 중에도 들리게). access 준비 실패·30초 초과는 대중교통으로 넘어간다(Kit `journeyStep`).

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
| `journey.designatedHeadingAlight` | {station}역에서 내리는 경로 | 변형 heading(하차 역만 지정, 판정 18) |
| `journey.recommendedHeading` | {station}역에서 타는 추천 경로 | 변형 heading(승차 쪽이 다를 때) |
| `journey.recommendedHeadingBus` | {stop}에서 버스를 타는 추천 경로 | 변형 heading(추천이 버스로 시작) |
| `journey.recommendedHeadingAlight` | {station}역에서 내리는 추천 경로 | 변형 heading(하차 쪽만 다를 때) |
| `journey.recommendedHeadingBusAlight` | {stop}에서 버스에서 내리는 추천 경로 | 변형 heading(하차 쪽만 다르고 버스로 끝날 때, 판정 17) |
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
| `journey.arrivedExit` | {exit}번 출구에 도착했습니다. | 출구 도보 도착(판정 19) |
| `journey.arrivedStand` | 택시 승강장에 도착했습니다. | 승강장 도보 도착(판정 19) |
| `journey.recentRoute` | {from}에서 {to}까지, {station}역에서 갈아타기 | 최근 경로 줄, 여정(판정 20) |
| `journey.recentRouteBoth` | {from}에서 {to}까지, {board}역과 {alight}역에서 갈아타기 | 최근 경로 줄, 여정·역 둘(판정 20) |
| `journey.egressNoneStop` | 내린 정류장에서 택시로 {minutes}분, 약 {fare}원 | 구간 줄, 추천이 버스로 끝남(판정 23) |
| `journey.accessFailedWith` | {reason}. 도보 안내를 시작할 수 없어 승차 대기로 바로 넘어갑니다. | 접근 도보 시작 실패, 원인 + 다리 문장(판정 27) |
| `journey.clearStations` | 갈아탈 역 지우기 | 펼친 칸 아래 버튼(판정 21) |
| `journey.taxiInStop` | 택시로 {stop}까지 {minutes}분, 약 {fare}원 | 구간 줄, 추천이 버스로 시작(판정 23) |
| `journey.arrivedStop` | {stop}에 도착했습니다. | 택시 자동 인계, 추천이 버스로 시작(판정 23) |

동명 이역(판정 26)은 새 키 없이 `{station}` 자리에 「노선 역이름」을 넣는다(Kit `journeyQualifiedStationName` — 노선 이름은 `수도권` 접두·공백·마침표·급행 꼬리를 뗀 꼴). 붙이는 조건은 Kit `journeyLineQualifiers`·`journeyNeedsLineQualifier`: 칸에 고른 역(이름·노선 힌트·좌표)과 추천 경로의 그 쪽 지하철 정류를 서버 같은 역 판정(§4.3)과 같은 축으로 비교한다 — 표시 이름이 같고, 노선을 둘 다 알면 노선이 다를 때, 하나라도 모르면 좌표가 500m(`JourneyTuning.stationIdentityMeters`)보다 멀 때. 두 역을 다 정한 여정은 추천이 고른 바로 그 역에서 탈 수 있어(다른 쪽이 안 맞았을 뿐) "이름이 같으면 다른 역"으로 보지 않는다(구현 코드 리뷰). 노선은 아는 쪽에만 붙고, 추천이 그 쪽에서 버스면 제목이 이미 「버스」를 말해 붙이지 않는다. 추천 제목이 어느 쪽을 말할지(`journeyRecommendedTitleIsBoardSide`)는 동명 이역을 "다른 쪽"으로 친다.

[다시 시도]·[안내 종료]·대중교통 시작 실패는 기존 키를 그대로 쓰고, 여정의 마지막 leg 버튼은 기존 「다음 구간」(`transitGuide.advance`, 판정 24)이다. `journey.taxiOutFailed`는 taxiIn 시작 실패에도 쓴다(문장이 같은 사실을 말한다).

- 승차·하차 양쪽이 모두 지정 역과 다른 추천 경로는 승차 쪽 제목(`recommendedHeading`/`recommendedHeadingBus`)을 쓴다(제목은 한 줄, 하차역 차이는 구간 줄에서 들린다). 이 조합 규칙은 설계 결정이다.
- 역 이름이 이미 "역"으로 끝나는 장소(예: 서울역)는 `{station}`에 "역"을 떼고 넣는다(「서울역역」 금지). 이름 키 정규화(`stripStationDecorations`)를 표시용으로 재사용하지 않고, 표시용 이름 함수를 따로 둔다.

수량 문장은 ICU plural 규칙(A29)을 따르고(분은 숫자 그대로라 plural 불요), ko 위치 인자 순서는 `ios/i18n/arg-order.json`이 잠근다.

## 9. 검증

### 9.1 단위·계약 테스트

- 서버 순수: 지정 역 판정(§3.2 술어 — 저장 corpus 4쌍, 신촌 노선 없는 입력 반례, 환승역 복합체 거리 < 500 < 동명 이역 거리, 노선 표기 fixture), 자르기(D3) 합계 재계산, 출구 노선 거르기·예선·동점, Tmap 비용 계산과 예약(`reserveCalls` — 모자라면 아무것도 쓰지 않음, 여정 전용 버킷 16회, 예약 수 = 실제 호출 수 상한, 같은 역 다른 노선 두 그룹), 인스턴스 일 상한, 응답 조립(변형 하나/둘/못 찾음, 출구 후보 일부·전부 실패).
- 기존 대중교통 라우트 바이트 동일: `getTransitRoute` 재구성 전후 저장 corpus(`odsay-alternatives-2026-09-24`, `e70-design-reports/odsay-samples`) 재생 결과 동일.
- Kit: `journeyStep` 전이 전수(시작 단계 × 사건 × 사이 상태), 낡은 `(journeyId, transitionSeq)` 사건 무시, 자동 도착과 버튼 경쟁(첫 사건만), 종료 뒤 늦은 완료 무시.
- 소스 가드: `guidance-gate-drift.test.ts` 갱신(§6.2), 여정 자동차 세션의 승객 고정(D10), `TransitGuideModel`의 `.done` 진입 자리 하나 + 여정 콜백(§6.3), 카카오 출구 provider의 `revalidate: 300`(`kakao-cache-ttl.test.ts`가 새 provider 함수도 덮는지 확인).

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
3. **provider·라우트** — `src/lib/providers/kakao-local.ts`(`searchSubwayExitsKakao`·승강장, 새 URL 빌더, `revalidate: 300`), `src/app/api/route/journey/route.ts`, `src/lib/rate-limit.ts`(`reserveCalls` 비용 판 + 여정 전용 버킷 + 인스턴스 일 상한, 자동차 버킷은 그대로), `src/lib/types.ts`(Journey 타입), 실호출 게이트 `scripts/verify-journey-exits.mjs`.
4. **Kit** — `Models/RouteModels.swift`(Journey 디코딩), `RouteService.swift`(`journey(...)`), 새 `Journey.swift`(`JourneyState`·`journeyStep`) + `JourneyTests.swift`, `RecentSearchStore.swift`(역 필드). Kit 파일 추가는 `android/kit/mirrors/<그룹>.json`에 `pending` 등재.
5. **앱 입력·결과** — `AppConfig.swift`(플래그), `DirectionsTabView.swift`(토글·두 칸·여정 조회·결과·시작), `DirectionsEndpointSearchView.swift`(대상 둘), 문안 `ios/i18n/ios-extra/*`(§8.4 확정본).
6. **앱 세션 이어짓기** — `GuideSessionCoordinator.swift`(`startJourney`·`advanceJourney`·`journey` 상태·`isActive`/`screen`의 `.journey`, 보관 `Task`), `BeaconModel.swift`(`markChained`, 여정 taxiIn 확정 도착 분기, 승객 고정), `TransitGuideModel.swift`(`.done` 갈래의 `onJourneyRideCompleted`), `BeaconTrackingSheet.swift`·`TransitTrackingSheet.swift`(두 버튼, 마지막 leg 라벨), 새 `JourneySheet.swift`(사이 상태·실패 시트), `GildongmuApp.swift`(인계 클로저·시트 item 경우).
7. **가드·문서** — `guidance-gate-drift.test.ts`, `docs/INTEGRATIONS.md` 새 절(여정 조립·출구 수집 함정), BACKLOG E70·FIELD-TEST·CHANGELOG·PROGRESS.

## 13. 설계 리뷰

### 13.1 1회차 (codex adversarial-review, 2026-10-17, 대상 `5946e021`) — needs-attention, BLOCKER 2 · MAJOR 4, 전부 수용

| # | 지적 | 처리 |
|---|---|---|
| B1 | 노선 힌트가 없으면 이름만으로 같은 역 확정 → 동명 이역(신촌)이 지정 역 경로로 새고 택시 목적지까지 바뀐다 | §3.2·§4.3: 좌표 조건(고른 역 좌표 500m 안)을 늘 거는 세 조건 곱으로. 반경 근거를 저장 corpus로 실측(복합체 최대 426m, 신촌 동명 이역 680m), 노선 없는 신촌 입력을 필수 반례로 |
| B2 | D3으로 자른 말미 도보가 기존 인계 진입 조건(`walkAfterMinutes`·`handoffNow`) → B 지정 여정은 마지막 하차에서 출구 안내 없이 끝난다 | §6.3: `.done` 갈래 한 자리에서 말미 도보와 무관한 `onJourneyRideCompleted`를 정확히 한 번, 마지막 leg 버튼 라벨도 여정 다음 단계로. 소스 가드 |
| M1 | 단계 사이 대기·실패 상태가 점유·화면을 갖지 않아 다른 안내가 끼어들고 재시도 버튼이 놓일 곳이 없다, 경쟁 전이 미정 | §6.1·§6.3: `transitioning`·`failed` 사이 상태, `isActive`·`screen`에 여정 포함(`.journey` 시트), 동기 전이 예약 + `(journeyId, transitionSeq)` 결박, 종료 시 보관 `Task` 취소, 복귀 시 30초 초과 사이 상태는 `failed` |
| M2 | 여정 요청 버킷이 자동차 버킷과 따로라 Tmap 공유 쿼터를 지키지 못한다(요청당 16회 × 분당 3) | §4.5: 한 조회 상한 8회, 자동차 라우트와 같은 버킷을 **호출 수**로 팬아웃 전 예약, 인스턴스 일 상한 200. 전역 정확 상한·정식판 예약분은 외부 공유 저장소가 필요해 첫 판 밖(한계와 재개 조건을 명시) |
| M3 | taxiOut의 카카오 폴백(HTTP 200·안내 불가)에 복구 전이가 없다 | §6.4: taxiIn·taxiOut 공통 안내 가능 술어(`carGuideStartable`과 같은 판정), 동기 거부·비동기 시작 실패까지 `failed(at:)` + 재시도 |
| M4 | 출구 7일 캐시가 카카오 300초 상한(위원장 판정, `kakao-cache-ttl.test.ts`) 위반 | §4.4·§4.6: `revalidate: 300`, 래퍼 캐시 금지, 질의 병렬 묶음 |

### 13.2 2회차 (codex adversarial-review, 대상 `0ce4d62c`) — needs-attention, BLOCKER 1 · MAJOR 4, 전부 수용

설계 리뷰 회전 상한(2회)에 닿아 3회차는 돌리지 않았다. 아래 처리는 지적마다 근거 코드를 직접 열어 사실을 확인한 뒤 반영했다(검증 범위: `GuideSessionCoordinator.swift` 시작 진입점·`refuseIfActive`, `BeaconModel.swift` `EndReason`·`stopAndFail`, `TransitGuideModel.swift` `completeOrAdvance`·`finalLegWalkMinutes`, `TransitTrackingSheet.swift` `handoffNow`, `odsay.ts` `toTransitRoute` 합계, `rate-limit.ts` 버킷).

| # | 지적 | 처리 |
|---|---|---|
| B1 | 1회차 M1 처리(여정을 `isActive`에 포함)가 여정 자신의 다음 세션 시작까지 `refuseIfActive`로 막는다 | §6.3: 공개 `start*`(거부 가드 유지)와 가드 없는 private `begin*`으로 가르고, 여정 단계 시작 `startJourneyStage`만 `(journeyId, transitionSeq)` 결박 + 단계 세션 부재를 확인해 `begin*`을 부른다. 점유를 풀지 않는다. 외부 시작 거부·내부 인계·재시도 성공 통합 테스트 |
| M1 | 후보 전부 실패 뒤 복구 호출이 예약 밖이라 상한이 깨진다 | §4.5-1·7: 팬아웃 전 **정확한 비용**(서로 다른 좌표 수)으로 예약, 예약 밖 호출 0. 그룹 후보 전부 실패는 복구 호출 없이 502, `lookupFailed`는 카카오 실패만(하차 정류 좌표 후보가 비용에 이미 포함) |
| M2 | 같은 하차역이면 출구 선정을 공유해 다른 노선 출구가 붙는다 | §4.5-2: 선정 단위 = (하차역, 하차 노선) 그룹. 원시 카카오 검색과 같은 좌표 Tmap 조회만 공유 |
| M3 | 진행 중 도보 종료(`.ended` — 권한 철회·정밀 위치 꺼짐)가 전이 표에 없어 세션은 사라지고 여정만 남는다 | §6.1: chained 세션(taxiIn·access·egress)의 `EndReason` 넷 전수 대응 표, `.ended`는 원인(`lastFailure` 키·해결 수단)을 보존한 `failed`, 대중교통의 그 밖의 종료는 여정 종료 |
| M4 | 남은 legs로 합계를 다시 더하면 legs에 없는 역내 환승 시간이 사라진다 | §4.2-4: 원래 합계에서 뗀 도보 분만 뺀다. 거리 0 환승 통로 보존 테스트 |

**BLOCKER 잔여 0**(1회차 2건·2회차 1건 모두 처리).

### 13.3 빌더 점검 (spec만 읽은 새 에이전트, 대상 `17527033`) — 질문 6, 위원장 몫 1

| # | 질문 | 처리 |
|---|---|---|
| 1 | 모델 입구 셋도 `GuideSession.shared.isActive`를 봐서, 여정을 `isActive`에 넣으면 내부 시작이 모델에서 다시 막힌다. `beacon.restart()`는 모든 가드를 건너뛴다 | 설계 결정: 점유 두 층 — `isActive`(단계 세션, 그대로)와 `isOccupied`(외부 시작 거부, 여정 포함). 여정 중 `restart()` 호출 자리는 `isOccupied`로 막고 `failed` 시트의 재시도가 대신한다(§6.3) |
| 2 | 자동차 세션은 넘겨받은 경로를 쓰지 않고 스스로 다시 조회하며 카카오 폴백이면 간략 모드로 계속한다 | 설계 결정: 시작 경로를 바꾸지 않는다. 시작 전 검사·추가 호출 없음, 간략 모드는 택시 승객에게 실패가 아니다(남은 거리·도착 판정은 선다). 승객 고정은 `StartRequest.carListener`(기본값 없음) |
| 3 | 둘 다 지정했는데 둘 다 맞는 경로가 없을 때, `side` 규칙 | 설계 결정: 세 번째 변형 없음, `side` 규칙과 문장 조합(9·10번, `both`면 두 줄)을 §3.2에 |
| 4 | 문안 표에 없는 문장(양쪽 못 찾음, 버스로 끝나는 하차 쪽 추천, 대중교통 시작 실패) | 양쪽 못 찾음은 기존 두 문장. 버스 하차 제목은 **위원장 판정 17**. 대중교통 시작 실패는 도달 불가로 표에서 지우고 불변식 테스트로(§6.4) |
| 5 | 끝점 검색 시트가 분류를 넘기지 않아 역 판정·노선 힌트를 칸에서 못 한다 | 설계 결정: 역 칸 전용 결과(`Place`) 콜백, `DirectionsEndpoint` 불변, 역 칸 시트엔 최근 끝점 없음(§5.1) |
| 6 | 자동차와 같은 IP 버킷이면 1분 안 재조회·조회 직후 안내 시작이 스스로 429 | 설계 결정: 여정 전용 버킷(호출 수, 60초 16회)으로 되돌리고, 공유 쿼터 보호는 인스턴스 일 상한이 맡는다(§4.5-3·4). 1회차 M2의 "같은 버킷" 처리를 이 근거로 바꿨다 — 예약 단위가 호출 수라는 것과 예약 밖 호출 0은 그대로 |

## 14. 구현 기록 (2026-10-17, 세션 e70-impl)

계획 `docs/superpowers/plans/2026-10-17-e70-journey-impl-plan.md`. 위 절의 문장은 구현에서 정한 차이를 이미 반영했다(§4.2-4 출구 번호, §5.1 통지·삭제, §5.2 포커스·heading, §6.1 cause, §6.3 측위·도착 선언, §6.4 재시도·대중교통 실패). 그 밖의 구현 결정:

- 좌표 파라미터는 형제 경로 라우트의 `"위도,경도"` 쌍(`origin`·`dest`·`board`·`alight`, `coordSchema`)이다(§4.1의 lat/lng 분리 표기 대신).
- 정류 좌표는 ODsay `startX/Y`·`endX/Y` 대신 같은 값인 `stops[0]`/`stops[끝]`(`includeStops` 필수) — 기존 `TransitLeg` 응답을 바꾸지 않는다.
- 지하철만 재조회 후보는 routeKey 접두가 `s`라 "지정 역 경로 = 추천"을 탈것 구성으로 가른다.
- 카카오 출구 질의 이름은 괄호 부기까지 뗀 `exitQueryStationName`(표시 이름 `displayStationName`과 분리), 출구 이름 속 맨 노선 토큰은 비수도권 하차 노선과 코어로 비교, 카카오 출구 조회 실패 그룹은 승강장을 싣지 않는다(§4.5-7).
- 일 상한이 이미 소진됐으면 ODsay·카카오 전에 503. 빈 노선 힌트는 부재.
- `EgressOption.placeName`(카카오 POI 원문) — 출구 도보의 목적지 라벨(D8).

**검증**: 서버·Kit·앱 웹 레인(vitest 전체·tsc·lint), Kit `swift test` 전체, 앱 두 구성 빌드. 실호출: ODsay 3건(라우트 A만·B만·둘 다), 카카오 약 260건·Tmap 약 64건(게이트 + 라우트). 예선 게이트(역 11곳, 비교 8그룹 — 위원장 실조회 역을 공공 역으로 바꿔 재측정) 놓침 0, 측정 불가 0, 운영 감축 폭 k=2 놓침 1(BACKLOG E70 편승). 같은 역 반경: 같은 이름·다른 노선 정류 45쌍(복합체 최대 427m < 500 ≤ 신촌 705m)을 fixture로 잠금. 리뷰: 서버·Kit spec 준수·코드 품질(opus) 각 MAJOR 3, 앱 spec 준수·코드 품질(opus) 각 MAJOR 4, 접근성 감사(opus) BLOCKER 1·MAJOR 10 — 새 문안이 필요한 것 외 전부 반영, 문안 판정 요청 7건(구현 보고 디렉터리 `judgment-*`, 판정 18은 채택 반영). 보고 원본은 저장소 밖 `~/gildongmu-wt/e70-impl-reports/`.

**문안 판정 반영**(2026-10-17, 세션 e70-wording — 판정 19~27): 새 키 9(§8.4 표), 앱 배선 `GuideSessionCoordinator`(도착 문장·동기 거부 다리 문장)·`BeaconModel`(`markChained(bridgesStartFailure:)` — 시작 실패 원인 + 다리 문장 한 통지)·`JourneyResultRows`(정류장 줄·노선 머리말)·`TransitTrackingSheet`(「다음 구간」)·`DirectionsTabView`(지우기 버튼·최근 경로 여정 문장, 활성화와 같은 조건), Kit `JourneyVariant.boardsAtBusStop`·`alightsAtBusStop`·`journeyLineLabel`·`journeyNeedsLineQualifier`·`journeyLineQualifiers`·`journeyRecommendedTitleIsBoardSide`·`journeyQualifiedStationName`. 배선은 소스 가드 `e70-journey-wording-guard.test.ts`, 순수 판정은 Kit `JourneyTests`가 잠근다. 리뷰(보고 `~/gildongmu-wt/e70-wording-reports/review-*`): 접근성 감사(opus) MAJOR 1(다리 문장 창구)·MINOR 3, 코드 리뷰(opus) MAJOR 1(최근 경로 줄 언어 조건)·MINOR 6 — 「지우기」 뒤 통지 없음(선례와 같음)과 정류장 「승차역」(편승) 외 반영.

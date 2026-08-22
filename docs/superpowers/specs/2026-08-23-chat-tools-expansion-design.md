# 채팅 function-calling 도구 확장 (K3) 설계

> 위원장 판정 2026-08-23(plan `2026-08-23-feedback-260822-parallel-plan.md` §1 K3): 채팅 도구 7종 확장, 버스 노선 경유 정류소만 제외(재론 금지). 설계 리뷰 판정: **생략** — 전부 검증된 기존 서비스 계약(`fetchStationTimetable`·`fetchSubwayArrivals`·`assembleWhereAmI`·`assembleNearbyOverview`·`getBarrierFreeDetail`·route `via`)의 재조합이고 파급이 `src/lib/chat/**`에 국소·가역이라 헌장 설계 리뷰 조건 ①~④에 해당하지 않는다. 구현 리뷰(spec-compliance·code-quality)와 실호출 게이트가 잔여 리스크를 덮는다.

## 1. 원칙 (불변)

- **산문 정본, 신규 렌더 카드 없음.** 기존 카드 타입 재사용만 허용하되, 카드가 기기 위치를 self-fetch하는 종류는 **지명·앵커 조회에서 카드를 내지 않는다**(카드와 산문이 다른 좌표를 말하면 SR 사용자에겐 반증 채널이 없다 — 기존 `placeAnchor` 규칙을 `place` 인자까지 확장).
- **키 게이트 동형**: 도구 존재는 `DECLARATIONS.gate`, 실행부는 서비스가 키 없음을 null로 돌리는 계약 그대로.
- **systemInstruction 정본 1곳 불변**(`src/lib/chat/system-instruction.ts`). 도구 사용 지시는 declaration description에만 둔다 — 프롬프트 증설은 A/B로 필요가 입증될 때만(미니멀리즘).
- **날조 금지**: 서버가 판정한 상태값(`null`·`unsupported`·`unavailableHere`·`partial`)을 그대로 싣고 LLM에 해석을 맡긴다. 3-state(없음/정보 없음/실패)는 데이터 모양으로 구분된다.
- **CLI·MCP·iOS 무변경.** 채팅 도구는 서버 내부 계약이다.

## 2. 도구별 계약

| # | 도구 | 게이트 | 인자 | 서비스 | data | render | source |
|---|---|---|---|---|---|---|---|
| ① | `get_station_timetable` (신규) | `hasDataGoKrKey` | `stationName` 필수 | `fetchStationTimetable` | `{timetable}` — `null`=TAGO 미커버 역, `partial:true`=일부 노선 실패(무운행 위장 금지), `dailyType`=판정 기준 | 없음 | TAGO |
| ② | `get_subway_arrivals` (확장) | 기존 | `stationName` 선택, `place` 선택(⑥) | 역명이면 `fetchSubwayArrivals(name)`(좌표·커버리지 게이트 무관 — 이름 기반 기능은 전 세계 유효), 아니면 기존 근접 조회 | 역명: `{stationName, arrivals}` — `arrivals:null`=서울 도시철도 외·실시간 미제공 | 역명·place 조회는 없음(기존 `subway-nearby` 카드는 기기 위치 self-fetch) | 서울 열린데이터 |
| ③ | `get_where_am_i` (신규) | `hasKakaoKey` | `place` 선택 | `assembleWhereAmI` | `{address, region, nearestStation, landmarks}` 그대로(네 조각 전부 null/빈 배열이면 `{error}`) | 없음 | 카카오 + KRIC |
| ④ | `get_nearby_overview` (신규) | 없음(대중교통 불릿은 seed) | `place` 선택 | `assembleNearbyOverview` | `{place, radiusMeters, bullets}` 그대로 — 불릿별 `ok/none/unavailable/failed` 3-state, 키 없는 불릿은 부재 | 없음 | 실린 불릿의 제공처만(transit→KRIC·TAGO, food/cafe/kids→카카오, events→서울 열린데이터, barrierFree→TourAPI) |
| ⑤ | `get_walk_route`·`get_car_route`·`get_transit_route` (확장) | 기존 | `via` 선택(지명) | 지명→좌표는 `searchPlaces` 첫 결과(목적지와 동형). walk/car는 `via` 좌표 전달, 응답 `waypoint{stepIndex,coord}`에 `name`을 붙여 `via`로 싣는다. **transit은 ODsay 미호출** `{route:null, unsupported:"waypoint", notice}` | car·transit 카드는 경유 없는 경로를 self-fetch하므로 `via`가 있으면 카드 없음 | 기존 |
| ⑥ | 앵커 고정 8도구 `place` 인자 | 기존 | `place` 선택(지명) | `resolveCoord(place, ctx)` — 우선순위 **명시 지명 > 장소 앵커 > 현재 위치** | 기존 | `place`·앵커 조회는 카드 없음 | 기존 |
| ⑦ | `get_barrier_free_detail` (신규) | `hasDataGoKrKey` | `contentId` 필수(`get_nearby_barrier_free` 결과의 `contentId` 연쇄) | `getBarrierFreeDetail` | `{detail}` — `null`=항목 없음, `facilities:[]`=등록 시설 없음 | 없음 | TourAPI |

⑥의 8도구: `get_subway_arrivals`·`get_night_clinics`·`get_kids_places`·`get_nearby_events`·`get_surroundings`·`get_congestion`·`get_nearby_barrier_free`·`get_walk_infrastructure`. 커버리지 게이트·서울 전용 판정은 해석된 좌표에 그대로 적용된다(지명이 해외면 `outOfCoverage`, 부산이면 `seoulOnly`).

도구 수: 20 → **24**(신규 4, 확장 12).

## 3. 쿼터

- TAGO 첫차·막차는 1역당 키워드 1 + 노선×방향 2 호출이 증폭된다. 채팅 라우트 레이트리밋(60초 10회)이 상한이고, 라우트 쪽 전용 리밋(60초 10회)과 별개 경로라 **최악 2배**다 — 일 쿼터 대비 무시 가능(data.go.kr 일 1,000회 × 여러 API 공유).
- 한눈에 보기는 서울 열린데이터(문화행사 캐시 6h)·TourAPI·카카오 3종 동시 호출 — 기존 웹 둘러보기와 같은 부하.

## 4. 검증

- 게이트 테스트: 도구별 router 단위(mock provider) + declarations 수·인자 스키마.
- 실호출 게이트: 도구마다 `executeFunction` 직접 실호출(강동역 첫차·막차 / 천호 실시간 / 자택 정위·한눈에 / 천호역 경유 도보·자동차·대중교통 / `place` 여의도 / 무장애 contentId 연쇄). 결과는 §6.
- `npm run test:ab` 증설 전후 비교(§7).

## 5. 미니멀 판정 기록

- ②를 신규 도구가 아니라 기존 도구의 `stationName` 인자로 둔 이유: 같은 데이터(실시간 도착)에 진입만 다르다. 도구 둘이면 LLM이 근접/역명을 고르는 분기가 하나 더 생긴다.
- ⑤의 `via`를 지명 문자열로 받는 이유: 목적지가 이미 지명이고 LLM은 좌표를 모른다. 해석 실패는 `{error}`로 정직 반환(경유 없는 경로로 조용히 대체 금지 — "경유한 경로"가 거짓이 된다).

## 6. 실호출 게이트 결과

(구현 후 기록)

## 7. A/B 증설 전후 비교

(구현 후 기록)

# N4 경유지 — 서버·웹·CLI/MCP 설계 (2026-08-22)

> 마일스톤 브리프: `docs/superpowers/plans/2026-08-22-feedback-260821-parallel-plan.md` §1 N4 행. 판정(경유지 1개·도보·자동차만·대중교통 정직 표시·버튼 위치·포커스 불변·도착 시 알리고 계속)은 위원장이 내렸고 여기선 **그 판정을 서버·웹·CLI에 옮기는 설계**만 다룬다. iOS(폼·시트·장소 상세·도착 통지)는 웨이브 3 `n4-waypoint-ios` 세션의 별도 spec이다.

## 1. 실호출 게이트 결과 (설계의 전제)

2026-08-22 천호역(37.5386,127.1237) → 강동역 경유(37.5353,127.1323) → 길동(37.5272,127.1268) 실호출. **4개 provider 모두 경유지 1개를 받는다.** 그래서 "카카오가 경유지를 못 받으면 도보가 Tmap 단독이 되는가"는 **아니오**로 닫혔다 — 도보 기본 카카오·폴백 Tmap, 자동차 기본 Tmap·폴백 카카오 파이프라인이 그대로 유지된다.

| provider | 파라미터 | 응답의 경유지 표지 | 비고 |
|---|---|---|---|
| 카카오 도보 `v2/routing/walk` | `via_x`·`via_y` (경도·위도) | `route.legs`가 **2개**로 갈린다(leg 0 = 출발→경유지, leg 1 = 경유지→도착). 스텝엔 경유지 문장 없음 | ⚠ `waypoints`·`waypoint_x`·`passlist`는 **무시되고 200 정상 응답**이 온다(이름을 틀려도 오류가 없다 — 테스트는 `via_x` 문자열을 URL에서 단언한다) |
| Tmap 보행자 `routes/pedestrian` | `passList: "lng,lat"` | Point `pointType: "PP1"`, description `"경유지 후 313m 이동"` | 문서 계약과 일치 |
| Tmap 자동차 `routes` | `passList: "lng,lat"` | Point `pointType: "B1"`, description `"도착지 건너편 후 천호대로168길을 따라 315m 이동"` + 말미에 description·index 없는 B1 Point 1개 더 | 말미 B1은 description이 없어 현행 normalizer가 건너뛴다(terminal은 E가 정한다) |
| 카카오 내비 `v1/directions` | `waypoints: "lng,lat"` | `sections`가 2개, 경유지 guide가 `type 1000 "경유지"`로 **section 0 끝과 section 1 첫머리에 중복** 등장, `summary.waypoints[]` 좌표 | 중복 guide는 정규화에서 하나로 접는다 |

## 2. API 계약

### 2.1 요청

- `/api/route/walk`·`/api/route/car`: 선택 파라미터 **`via`** = `"위도,경도"`(origin·dest와 같은 `coordSchema`). 누락이면 현행과 byte-동일 응답(옵트인 필드는 키 자체가 없다).
- 검증 순서는 횡단 함정 그대로: 파싱(400) → 커버리지(`via`도 `isInKorea`, 하나라도 밖이면 `outOfCoverage`) → 키 게이트 → 레이트리밋 → upstream.
- `/api/route/transit`: `via`가 오면 파싱·커버리지까지 통과시킨 뒤 **upstream을 부르지 않고** 200 `{ "result": null, "unsupported": "waypoint" }`. ODsay에 경유지가 없어 *못 하는 것*이지 *경로가 없는 것*이 아니다 — `result: null`만 주면 "대중교통 경로를 찾을 수 없습니다"로 낭독돼 거짓이 된다(3-state). 마커 이름은 `unavailableHere`(지역 미제공)·`outOfCoverage`(국외)와 같은 층의 네 번째 정직 상태다.
- 도보 `variant`·`alternatives`·`accessible`은 `via`와 **직교**한다(최단도 Tmap passList를 그대로 받고, 계단 회피는 카카오 `route_mode`와 `via_x`가 함께 간다). 금지 조합을 새로 만들지 않는다.

### 2.2 응답

`WalkRouteBriefing`·`CarRouteBriefing`에 선택 필드 하나:

```ts
waypoint?: {
  /** 경유지에서 시작하는 첫 안내 단계의 인덱스. steps[stepIndex]가 곧 "경유지 도착 뒤 할 일". */
  stepIndex: number;
  /** 경유지 도착 판정 좌표(provider가 보행로·도로 위로 스냅한 점). */
  coord: Coord;
};
```

`via`를 받은 요청에만 존재한다. provider별 투영:

| provider | `stepIndex` | `coord` |
|---|---|---|
| 카카오 도보 | leg 0의 안내 스텝 수(= leg 1 첫 스텝의 평탄화 인덱스) | leg 0 마지막 스텝 `path.points`의 끝점(없으면 leg 1 첫 스텝의 첫 점, 둘 다 없으면 요청 `via` 원좌표) |
| Tmap 보행자 | `PP1` Point가 만든 스텝의 인덱스 | 그 Point 좌표 |
| Tmap 자동차 | description 있는 `B1` Point가 만든 guide의 인덱스 | 그 Point 좌표 |
| 카카오 내비 | 접힌 `type 1000` guide의 인덱스 | 그 guide의 `x`,`y` |

- 경유지 표지를 **찾지 못하면 throw**한다(`via`를 보냈는데 응답에 경유지가 없으면 provider가 파라미터를 무시한 것 — "경유 안 한 경로"를 "경유한 경로"로 낭독하는 것이 최악이다). 카카오 도보 `waypoints`류가 조용히 무시되는 것을 실호출로 봤기 때문에 이 가드는 추측이 아니다.
- 스텝 문장은 손대지 않는다(provider 원문 → 기존 재작성 파이프라인). 경유지 스텝 삽입·"C 경유지 도착" 합성은 하지 않는다 — 서버는 라벨을 모르고(좌표만 받는다), 소비자가 `stepIndex` 자리에 자기 라벨로 구획을 그린다(웹 헤딩·CLI 한 줄·iOS 통지).
- 기하 옵트인(`includeGeometry=1`)에서도 `waypoint`는 같은 자리에 실린다. `buildGuideRoute`·`finalApproach`·`terminalCoord` 계약은 불변이다(Tmap 자동차 말미 무설명 B1은 현행 분기가 건너뛰고 E가 terminal을 정한다 — 실호출로 확인).
- 캐시 키: 카카오 도보는 `via_x`가 URL에 들어가 자연 분리, Tmap은 POST라 실효 없음(현행과 같다).

### 2.3 채팅·딥링크 (비적용, 기록만)

- 채팅 도구 `get_walk_route`·자동차 도구엔 `via`를 넣지 않는다(이번 범위 밖, 요청도 없다).
- 웹 네이티브 지도 딥링크(`nmap://`·`kakaomap://`)는 경유지를 싣지 않는다. 경유지가 있는 조회에서 딥링크 버튼은 **현행 그대로 출발→도착**으로 열린다. 정직 표시는 하지 않는다 — 딥링크는 "실주행 위임"이고 그 앱 안에서 사용자가 경로를 다시 보므로 반증 채널이 있다. 네이버 스킴의 `v1lat/v1lng` 경유 인자 적용은 `docs/BACKLOG.md` N4 후속으로 남긴다.

## 3. 웹 `DirectionsView`

- **폼**: 도착지 필드와 경로 조회 버튼 사이에 버튼 **"경유지 추가"**. 누르면 그 자리가 `EndpointField`(라벨 "경유지", 검색 라벨 "경유지 검색")로 바뀌고 포커스는 그 입력으로(버튼이 사라지므로 선점 이동, 헌장 §5). 확정하면 포커스는 **경로 조회 버튼**으로(`focusAfterResolve`, 도착지와 동형). 필드 아래 "경유지 삭제" 버튼 — 누르면 필드가 사라지고 포커스는 경로 조회 버튼으로. 도착지 확정 뒤 포커스는 종전대로 경로 조회 버튼이다(경유지 버튼으로 보내지 않는다 — 선택 사항이 기본 흐름을 늘리면 안 된다).
- 경유지는 "현재 위치"가 될 수 없다(`onUseCurrent` 미제공). 최근 장소 목록은 `RecentEndpointField`에 `"via"`를 더해 분리 저장한다(도착지 목록과 섞으면 경유지가 목적지 최근 목록에 오른다).
- 경유지가 미확정(텍스트만)인 채 조회를 누르면 도착지 미확정과 같은 `needEndpoints` 통지다 — 반쯤 적힌 경유지를 조용히 버리고 조회하지 않는다.
- **조회**: 도보·자동차는 `via`를 붙여 호출, **대중교통은 호출하지 않고** outcome `unsupportedWaypoint`로 섹션에 "경유지는 대중교통 경로에서 지원하지 않습니다" 한 문장(서버 마커와 같은 뜻, CLI/MCP는 서버 마커로 같은 문장). 합산 통지는 현행 규칙(성공 N건)에 이 섹션을 "실패"가 아니라 "미지원"으로 센다 — 문구는 `directions.unsupportedWaypoint`.
- **결과 렌더**: 도보·자동차 스텝 목록에서 `waypoint.stepIndex` 앞에 한 줄 `"경유지 {label} 도착"`(h4가 아니라 스텝과 같은 급의 텍스트 항목 — 스텝 목록은 `ol`이라 항목 하나로 넣되 번호 흐름을 깨지 않도록 `li` 안 텍스트로). 경유지 라벨은 폼 상태에서 온다.
- **`?dir=`**: `from/to/via` 세 토막(현행 두 토막 호환, 세 번째는 장소 토큰만·`cur` 금지). 파싱은 `parseDir`이 `via`를 돌려주고 복원 시 폼에 경유지 필드를 펼친 상태로 놓는다.
- **최근 경로**: `RecentRoute.via?: RecentEndpoint`. 동일 판정은 from·to·via 셋 전부. 문장은 `recentRoutes.itemVia` = "{from}부터 {to}까지 {via}를 경유하는 경로 조회"(6개 로케일), 활성화는 세 필드 원자 확정 + 즉시 조회.
- **실시간 안내(`DistanceBeacon`/`useRouteGuide`)**: 경유지가 있는 조회에서는 **도보·자동차 안내 시작 버튼을 내지 않는다.** 안내 훅이 출발지→도착지로 자기 조회를 다시 하므로 경유지가 조용히 빠진 경로를 안내하게 된다 — 그보다 버튼 부재가 정직하다. 경유지 안내(도착 통지·계속)는 iOS가 먼저 실보행으로 판정하고 웹은 그 뒤(`docs/BACKLOG.md` N4 후속, 웹 실보행 미검증 축과 같은 줄). 조회 결과 브리핑은 그대로 읽을 수 있다.

## 4. CLI/MCP

- 카탈로그 `route-walk`·`route-car`·`route-transit`에 `via`(선택, "경유 좌표 '위도,경도', 1개") 등록(両미러 동일).
- `formatRouteWalk`·`formatRouteCar`: `waypoint`가 있으면 `stepIndex` 앞에 `"경유지 도착"` 한 줄(라벨을 모르므로 좌표·이름 없이). `formatRouteTransit`: `unsupported === "waypoint"`면 `"경유지는 대중교통 경로에서 지원하지 않습니다."`(null과 다른 문장).

## 5. 테스트·게이트

- 스키마: `via` 누락=undefined, 형식 오류 400, `via`만 국외 → `outOfCoverage`(walk·car·transit 셋).
- 정규화 순수 함수 4종: 실호출 응답을 fixture로 박아 `waypoint` 투영 + 표지 부재 throw(카카오 도보 legs 1개 + via 요청 → throw).
- URL 단언: 카카오 `via_x`·`via_y`, Tmap `passList`, 카카오 내비 `waypoints` — 이름이 틀려도 200이 오는 API라 **문자열 단언이 유일한 가드**다.
- 응답 byte-호환: `via` 없는 요청의 스냅숏 불변(기존 스냅숏 테스트 통과).
- `directions-state` `from/to/via` 왕복, `recent-searches` via 동일 판정·라벨.
- 실호출 게이트(머지 전): 웹 dev 서버로 walk(카카오·`variant=shortest` Tmap)·car(Tmap)·transit(unsupported) 3건 + `includeGeometry=1` 도보·자동차에서 `buildGuideRoute` 성공 확인.

## 6. 리뷰 판정

설계 단계 codex adversarial-review **생략**. 근거: 외부 계약 가정은 spec보다 **먼저 실호출로 확정**했고(§1), 새 불변식·상태 머신 없음(옵트인 필드 1개·마커 1개 추가), 비가역 변경 없음, 안전 축(실보행 안내)은 이번 범위에서 **버튼 부재로 봉인**했다. 구현 단계 spec-compliance·code-quality 리뷰 + 실호출 게이트가 잔여 리스크를 덮는다.

## 7. 실호출 결과 (2026-08-22, 서버 구현 뒤)

dev 서버 경유, 같은 좌표(천호역→강동역 경유→길동).

| 요청 | 결과 |
|---|---|
| walk(카카오 기본) | 2,497m·13스텝, `waypoint.stepIndex 5`(leg 1 첫 스텝 "늘푸른정신과까지 … 43m 이동"), coord 37.53529,127.13234 |
| walk `variant=shortest`(Tmap) | 2,060m·16스텝, `stepIndex 5` = "경유지 후 313m 이동"(Tmap 원문, 재작성 통과) |
| car(Tmap) | 2,066m·8 guide, `stepIndex 2` = "도착지 건너편 후 천호대로168길을 따라 315m 이동" — Tmap이 경유지를 "도착지"라 부르는 원문. 소비자가 앞에 "경유지 도착" 구획을 그리므로 문맥이 선다(재작성 패턴 추가 안 함) |
| transit | `{"result":null,"unsupported":"waypoint"}`, upstream 미호출 |
| walk `via` 없음 | 응답에 `waypoint` 문자열 0회(byte-호환) |
| `includeGeometry=1` walk(카카오)·walk shortest(Tmap)·car(Tmap) | `buildGuideRoute`·`buildCarGuide` 모두 non-null(`src/__realcall__/waypoint-geometry.test.ts`, `REALCALL=1`로 수동 실행) |

카카오 내비 폴백은 서버 경유 실호출이 아니라 API 직접 프로브(§1)와 그 응답 fixture의 단위 테스트로 확인했다(Tmap 키가 있어 서비스 경유로는 도달하지 않는다).

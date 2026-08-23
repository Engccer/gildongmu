# M4 iOS "내 주변" 탭 재편 — 설계 (2026-08-22)

> 판정 정본: `docs/superpowers/plans/2026-08-22-feedback-260821-parallel-plan.md` §1 M4 행(위원장 2026-08-22) + 이 세션 추가 판정 2건(대표 장소 = 가장 가까운 곳 2개, 통합 화면 이름 = "둘러보기"). 코드 분석 근거는 `docs/research/RESEARCH-2026-08-12-nearby-tab-restructure.md`. 백로그 `docs/BACKLOG.md` M4.
> ⚠ 2026-08-24 개정: "가장 가까운 곳 2개" 고정 캡은 개수 비례 계단식(`overviewNearestCap`, <5: 2 · 5~9: 3 · ≥10: 4)으로 바뀌었고 채팅은 장소 카드를 함께 낸다 — `2026-08-24-chat-overview-cards-followup-chips-design.md`가 정본. 아래 "2개"는 그 시점 기록이다.
> 적용 순서: **iOS 먼저, 웹은 후속 이식**(§9 phase 경계).

**설계 리뷰 게이트 판정**: 이 spec은 새 판정 계층(불릿별 3-state 집계, §4)과 새 응답 계약(`/api/nearby/overview`, `SceneItem` 확장, §3)을 신설하므로 글로벌 규칙상 적대적 설계 리뷰 **대상**이다. 단 구성 요소가 전부 검증된 기존 계약의 재조합(`assembleWhereAmI` 동형 allSettled, 5종 provider의 기존 `radiusMeters` 옵션, `NearbyLoadCore`, `nearbyFocusOnLoad`)이고 파급이 iOS 화면 1개·신규 라우트 1개로 국소·가역이라, 구현 단계 subagent 리뷰(spec-compliance + code-quality) + 실호출 게이트로 잔여 리스크를 덮는다 — **설계 단계 codex 리뷰는 생략**.

## 1. 성과 (측정 가능)

- "내 주변" 탭 → "둘러보기" 진입 한 번으로, **버튼을 한 번도 누르지 않고** (a) 내가 어디 서 있는지 (b) 1km 안에 5종 POI가 무엇이 있는지 (c) 150m 안 좌·우·맞은편에 무엇이 있는지를 VO 선형 읽기로 듣는다. 종전엔 화면 2개("현재 위치 확인"·"둘러보기") + 버튼 1회("주변 확인")가 필요했다.
- 주변 상황 묶음의 각 장소가 **장소 상세로 열린다**(종전 단순 텍스트).
- 검증: 실기기 VO(위원장) + 실호출 게이트(`scripts/verify-nearby-overview.mjs`).

## 2. 화면 구조 (iOS `AroundNearbyView` 재편)

허브 `NearbyHubView`: `whereAmI.button` 행 **삭제**, `ios.nearby.around` 행을 **맨 위**(`LocationBarView` 바로 아래)로. 나머지 행·순서·BLE 진단 섹션 불변. `WhereAmIView.swift`는 **삭제**(진입점이 허브뿐, Kit `WhereAmIService`·서버 `/api/where-am-i`는 웹·CLI·채팅이 쓰므로 유지).

둘러보기 화면(List, 위→아래, 전부 자동 로드):

| # | 요소 | 접근성 |
|---|---|---|
| 1 | **위치 문장** — "현재 위치 기준, {place} 근처" / 수동 위치 "지정한 위치 기준, {place} 근처". place 없으면 "현재 위치 기준" 만. | 헤딩(`.isHeader`). **VO 착지 지점(첫 로드 1회)**. 수동 vs GPS 선언의 유일 자리(종전 `WhereAmIView.headerText` 책임 승계) |
| 2 | **"한눈에 보기"** 헤딩 + 불릿 5개(각 단일 `Text`, `distanceText` 낭독 정정) | 헤딩. 불릿은 텍스트(버튼 아님 — 상세는 §2 #4·#6 목록이 담당) |
| 3 | **"주변 상황"** 헤딩 + `SurroundingsSceneSection(mode: .auto)` 본문(묶음 헤딩 + 장소 행 = `NavigationLink → PlaceDetailView`) + 출처 각주 | 자동 펼침. **포커스 이동 없음**(헤딩이 발견 경로) |
| 4 | "이 위치에 관해 물어보기" 버튼 | 버튼 |
| 5 | **"주변 가게와 시설"** 헤딩 + 기존 둘러보기 목록(500m·10종·더 보기) | 현행 행 유지 |

제목: `ios.nearby.around` 값을 "둘러보기"로 변경(6 로케일). 수동 위치일 때도 제목 불변(출처는 #1이 말한다).

### 2.1 포커스·통지 계약

- 로드는 **둘**: 조망(`/api/nearby/overview`, #1·#2 재료)과 장면(`/api/surroundings/scene`, #3) + 목록(`/api/places/around`, #5). 모델 하나(`AroundNearbyModel`)가 `NearbyLoadCore<AroundPayload>` 껍데기로 **세 요청을 한 fetch 안에서 allSettled**로 묶어 한 번에 커밋한다 → 코어 계약(첫 로드 착지 1회·통지 1회·latest-wins·재조회 시 직전 데이터 유지)을 그대로 쓴다. 화면 단위 단일 상태가 부분 실패를 못 담는 문제(research §3.4)는 **payload 안에서 조각별 상태를 들고 가는 것**으로 푼다(코어는 "payload가 있다/없다"만 본다).
- 전체 실패 판정: 조망·장면·목록 **셋 다** 실패 → throw(코어 `.failedServer`). 하나라도 성공이면 loaded, 실패한 조각은 그 자리에 실패 문장(`around.overviewFailed`·`surroundings.error`·`ios.nearby.aroundEmpty` 류)으로 남는다(침묵 금지).
- 착지: `nearbyFocusOnLoad(id: "around-top")` — #1 위치 문장 행. 장면·목록이 늦게 와도 한 커밋이라 경합 자체가 없다.
- 통지: `nearbyAnnouncer(loaded:)` 한 문장 — "둘러보기를 확인했습니다"(수동 위치면 "지정한 위치 주변을 확인했습니다"). 조각 수·실패는 통지에 싣지 않는다(본문이 말한다).
- `SurroundingsSceneSection`의 `.auto` 모드: 트리거 버튼·`busy` 라벨·닫기·`landAfterLoad` **없음**, 데이터는 부모 payload에서 주입(`scene: SurroundingsScene?` + `failed: Bool`)받아 렌더만. 기존 `.manual` 모드(버튼형)는 **byte-identical 유지** — `BeaconTrackingSheet`(N1 소유)가 그대로 쓴다. 행 렌더(장소 행을 `NavigationLink`로)는 두 모드 공통으로 바꾼다(안내 시트에서도 상세로 열리는 것이 맞다 — 판정 ⑤).

## 3. 서버 계약

### 3.1 `GET /api/nearby/overview?lat&lng` (신규)

순서: 파싱(`latParam`/`lngParam`) → `isInKorea` 아니면 `{outOfCoverage:true}` → 조립. 키 게이트는 **불릿 단위**(키 없는 불릿은 응답에서 제외, 화면에 0 노출). 대중교통 불릿은 seed라 키와 무관하게 항상 있으므로 `{data:null}` 상태는 **없다**(응답은 항상 `data`, 리뷰 D1로 정정 2026-08-22). 조립 예외는 조각별로 흡수하므로 라우트 502는 조립 함수 자체의 예외뿐. `force-dynamic`, 응답 `no-store`(조각별 revalidate는 provider fetch 층이 가짐).

```ts
interface NearbyOverview {
  place: string | null;                 // assembleWhereAmI와 같은 조립(행정동 + 도로명, 접두 중복 제거)
  radiusMeters: 1000;                   // 공통 반경(§5)
  bullets: OverviewBullet[];            // 순서 고정: transit, food, kids, events, barrierFree
}
type OverviewBullet =
  | { kind: "transit"; state: "ok"; station: NearestStation | null; busStops: { count: number; nearest: OverviewPlace[] } | { count: 0; uncovered: true } | null }
  | { kind: "food" | "kids" | "events" | "barrierFree"; state: "ok"; count: number; nearest: OverviewPlace[] }   // nearest ≤ 2, 거리순
  | { kind: …; state: "none" }                                   // 반경 내 0건
  | { kind: "events"; state: "unavailable"; reason: "seoulOnly" } // 국내 미제공 지역
  | { kind: …; state: "failed" };                                 // upstream 실패(throw 흡수)
interface OverviewPlace { name: string; distanceMeters: number; bearing: CompassDirection }
interface NearestStation { name: string; line?: string; bearing: CompassDirection; distanceMeters: number }
```

- transit: 지하철 = seed `findStationsNear(1km, dedupeByName, limit 1)`(동기·실패 없음). 버스 = `fetchNearbyBusStops`(상류 고정 반경) → 0건이면 `isUncoveredBusRegion`으로 `uncovered` 판정, 실패(throw)는 `busStops: null`. transit 불릿은 지하철 키가 없어도(seed라 키 무관) 항상 존재하며 버스만 키 게이트(`hasDataGoKrKey`).
- food: `findSurroundingsNear(groups FD6·CE7, radius 1000, cap 50)`. count는 상류 캡(2×15=30)에 걸리면 `30`이 아니라 **"30곳 이상"**으로 표현해야 하므로 `countCapped: boolean`을 함께 싣는다(실호출에서 서울 전 좌표가 캡에 걸렸다).
- kids: `findKidsPlacesNear(lat,lng,{radiusMeters:1000})` — provider에 `radiusMeters` 옵션 **추가**(기본값 2000 유지 → 기존 라우트 무영향).
- events: `isEventServiceArea` 아니면 `unavailable`; 아니면 `findEventsNear(…,{radiusMeters:1000})` `total`.
- barrierFree: `searchBarrierFreeNearby(…,{radiusMeters:1000, limit:50})`.
- `nearest`는 각 조각의 거리 오름차순 상위 2(1건이면 1). bearing은 `bearingToCompass8`.
- 조각 4개 + 버스 = `Promise.allSettled`; rejected → `failed`.

### 3.2 `SceneItem` 확장 (`/api/surroundings/scene`)

`SceneItem`에 `id`·`lat`·`lng`·`categoryRaw`·`roadAddress`·`phone?`·`link?`·`address`(지번) 추가 — `findSurroundingsNear`의 `SurroundingPlace`가 이미 전부 가진 값이라 투영만 늘린다. 기존 필드 불변(웹 `SurroundingsScene.tsx` 무영향). Kit `SurroundingsSceneItem` 미러 + `sceneItemToPlace()`(Kit, `surroundingPlaceToPlace` 동형).

### 3.3 CLI/MCP

`endpoint-catalog-shared.ts`에 `nearby-overview`(`/api/nearby/overview`) 1항목 + cli `FORMATTERS` 등록(불릿을 텍스트로: 문장 조립은 CLI가 ko 전용 고정 템플릿 — `where-am-i` 포매터 동형). 両미러 byte 동일.

## 4. 문장 조립 (결정론 템플릿, 클라이언트 i18n)

서버는 구조화 데이터만 내고 문장은 소비자가 `messages/*.json` `around.overview.*` 템플릿으로 조립한다(`whereAmI.narrative` 관례, 6 로케일, LLM 없음). 규율: **불릿 5개 · 항목당 한 문장 · 가까운 곳 최대 2개 명명 · 반경 문구는 불릿 안에 쓰지 않고 "한눈에 보기" 헤딩 한 줄 뒤 부제 "1km 안"으로 한 번만**.

ko 예(상태별 전부 다른 문장 — 3-state 불변식). **문장형 개정 2026-08-22(위원장 판정: 불릿마다 완성 문장, 식당·카페 분리 → 6불릿)**:

| 상태 | 문장 |
|---|---|
| transit ok(둘 다) | "가장 가까운 지하철역은 5호선 길동으로 북동쪽 262m입니다. 버스 정류소가 5곳 있습니다. 가장 가까운 곳은 길동사거리로 동쪽 80m, 길동역으로 북쪽 120m입니다." |
| transit 역 없음·버스 있음 | "1km 안에 지하철역이 없습니다. 버스 정류소가 5곳 있습니다. …" |
| transit 역 없음·버스 조각 없음(키 부재) | "1km 안에 지하철역이 없습니다."(문장이 독립이라 종전 `transitNoStationOnly` 분기는 사라졌다) |
| transit 버스 uncovered | "… 버스 정류소 정보는 이 지역에서 제공되지 않습니다." |
| transit 버스 failed | "… 버스 정류소 정보를 가져오지 못했습니다." |
| food ok | "식당이 15곳 이상 있습니다. 가장 가까운 곳은 봉래면옥으로 남쪽 40m, 김밥천국으로 동쪽 60m입니다." (`countCapped` 아니면 "12곳") |
| cafe ok | "카페가 3곳 있습니다. 가장 가까운 곳은 …입니다." (식당 FD6·카페 CE7을 **따로** 받아 종별 캡 판정, 합치지 않는다) |
| kids none | "아이 놀 곳은 1km 안에 없습니다." |
| events unavailable | "문화 행사는 서울에서만 안내합니다." |
| barrierFree failed | "무장애 관광지 정보를 가져오지 못했습니다." |
| 키 없음 | (불릿 없음) |

**조사는 코드가 고른다.** 라벨의 이/가·은/는과 장소명의 (으)로는 받침에 따라 갈리고 장소명은 동적이라 템플릿에 박을 수 없다 — `KoreanParticle`(Kit ↔ 웹 `korean-particle.ts` ↔ CLI 미러, 드리프트 가드)이 ko에서만 붙인다. **비한글 장소명은 판정 불가라 조사 대신 쉼표로 물러난다**("GS25, 남쪽 40m" — 조사를 못 정하는 것이 낭독 불능이 되면 안 된다). `nearest` 조각은 `"{name}(으)로 {direction}쪽 {distance}"`를 쉼표로 잇고 "가장 가까운 곳은 …입니다."로 감싼다. 거리는 `formatDistance` → iOS `distanceText`가 m만 낭독 정정. 부제·문장 어디에도 가운뎃점 없음. 다른 5개 로케일도 같은 문장형(조사 없음).

## 5. 공통 반경 1,000m — 실호출 근거 (2026-08-22)

서울 주거(길동)·상권(강남역)·업무(여의도)·전주 한옥마을·강릉 교동·양평 용문 6좌표 × 반경 300~3,000m 7단계를 실제 provider로 조회했다(프로브는 미커밋, 결과 전표는 아래 요약).

| 반경 | 아이 놀 곳(서울 3곳) | 무장애(서울 3곳) | 문화행사(서울 3곳) | 판정 |
|---|---|---|---|---|
| 500 | 5 / 1 / 0 | 0 / 2 / 4 | 0 / 1 / 0 | 불릿 둘이 서울에서도 상시 "없음" |
| 700 | 6 / 3 / 2 | 0 / 5 / 7 | 1 / 1 / 1 | 주거지 무장애 0 |
| **1000** | **13 / 12 / 2** | **1 / 8 / 14** | **1 / 1 / 1** | 서울 3곳 전부 5종 비0이 되는 첫 단계 |
| 1500 | 29 / 26 / 11 | 4 / 18 / 25 | 1 / 2 / 2 | 도보 20분 초과 — "가까운 곳" 깨짐 |

식당·카페는 전 반경에서 상류 캡(30)에 걸렸고(반경 무관), 지하철역은 1km에서 서울 3~6개(seed 기준 현행 `STATION_RADIUS`와 동일). 지방: 전주 1km 아이 놀 곳 4·무장애 18, 강릉 6·88, 양평 0·1 — 농촌은 어느 반경이든 성기므로 "없음" 문장이 정직한 답이다. **1km = 도보 약 15분**이 "가까운 곳"의 상한이고 그 안에서 희소 도메인 둘이 서울 전역에서 비0이 되는 최소값이라 채택한다. 버스 정류소는 상류 반경 고정(서울 500m·TAGO ~700m)이라 반경 조정 대상이 아니고 문장에 반경을 쓰지 않는다.

## 6. 3-state·게이트 매트릭스 (불릿별 독립)

| 축 | 0건 | 정보 없음 | 실패 | 키 없음 |
|---|---|---|---|---|
| 지하철 | "1km 안에 지하철역이 없고" | (seed라 없음) | (seed라 없음) | (seed라 없음) |
| 버스 | "버스 정류소가 없고" | uncovered "이 지역에서 제공되지 않습니다" | "가져오지 못했습니다" | 버스 조각 생략(지하철만) |
| 식당·카페 | none | — | failed | 불릿 생략 |
| 아이 놀 곳 | none | — | failed | 불릿 생략 |
| 문화 행사 | none | seoulOnly | failed | 불릿 생략 |
| 무장애 | none | — | failed | 불릿 생략 |

## 7. 제거·유지 경계

- 삭제: `ios/Gildongmu/Nearby/WhereAmIView.swift`, 허브 `whereAmI.button` 행, i18n `ios.nearby.whereAmI*` 중 iOS 전용 키(웹이 쓰는 `whereAmI.*`는 유지 — 웹 `WhereAmI.tsx` 현존).
- 유지: `/api/where-am-i`·`assembleWhereAmI`·Kit `WhereAmIService`·`buildLocationNarrative`(웹·CLI·채팅 소비자 현존. iOS 소비자 0이 되어도 Kit 코드는 웹 미러 계약이라 남긴다 — 죽은 코드 판정은 웹 이식 때).
- 유지: 보행 인프라 행·BLE 진단 섹션(판정 ②), `SurroundingsSceneSection` `.manual` 모드.

## 8. 테스트·게이트

- 순수: `nearby-overview.test.ts` — 조각별 fulfilled/rejected 조합 → 불릿 상태 매핑(변이: rejected를 none으로 뭉개면 실패), `countCapped`, nearest ≤ 2·거리순, 키 게이트로 불릿 제외, events seoulOnly 선판정(upstream 미호출).
- 라우트: `coord-param-usage.test.ts`가 자동 포함. 라우트 테스트: 한국 밖 `outOfCoverage`, 전 키 부재여도 `data` 비null.
- 계약 가드: scene 응답 스키마 테스트에 새 필드 존재·기존 필드 불변.
- Kit: `SurroundingsSceneItem` 디코딩(새 필드), `sceneItemToPlace`; 조망 문장 조립 테스트(ko, 상태별 문장이 전부 다른지 — 3-state 변이).
- **실호출 게이트** `scripts/verify-nearby-overview.mjs`: 서울 좌표 1곳·서울 밖 1곳·해외 1곳 — 불릿 5 존재, 서울 밖 events `unavailable`, 해외 `outOfCoverage`, scene 항목에 lat/lng 존재. 종료 코드로 머지 게이트. **결과(2026-08-22, dev 서버 실호출): 11/11 PASS** — 길동 5조각 전부 ok(buses ok), 전주 events unavailable·station null, 파리 outOfCoverage, scene 49건 전 항목 장소 재료.
- **리뷰(2026-08-22)**: spec-compliance 판정 8항목 PASS·결함 D1~D4(D1 `data:null` 도달 불가 → 분기 제거·spec 정정, D2 CLI 문장 Kit 동형화, D3 `transitNoStationOnly`, D4 기록만) / code-quality MED 4·LOW 2(식당·카페 캡 판정을 종별 raw 건수로, `placesFailed` 분리, 자동 펼침 더 보기 창 커밋 리셋, 문화행사 선판정 1km) 전부 반영. 시뮬레이터(iPhone 17, dev 서버) 실측: 불릿 5개 각 1객체, 장면 행 버튼 → 장소 상세 열림.
- CLI: `formatter-coverage`·`version-drift`·카탈로그 drift 자동.
- i18n: `i18n-messages.test.ts` + `check-xcstrings-keys.mjs`.
- 실기기: 위원장 VO — 착지가 위치 문장 1회인가, "한눈에 보기" 불릿이 객체 하나씩인가, 주변 상황 장소가 상세로 열리는가, 안내 시트 "주변 확인"이 종전과 같은가.

## 9. Phase 경계 (웹 후속)

- **이 마일스톤**: 서버(§3) + iOS(§2) + CLI/MCP. 웹 `NearbyHub`·`WhereAmI.tsx`·`SurroundingsScene.tsx`는 **불변**(scene 새 필드는 무시된다). 미러가 어긋나는 구간: 웹은 "현재 위치 확인"·"둘러보기" 두 패널 + 버튼형 주변 확인 유지.
- **후속(PORTS.md 등재)**: 웹 `AroundNearby` 재편(조망 불릿 렌더·자동 장면·장소 링크), 그때 `buildLocationNarrative` 죽은 코드 판정, 웹 `WalkInfraNearby` 판정.

## 10. 비용

화면 진입 1회당 upstream: 카카오(역지오코딩 2 + 카테고리 2 + 키워드 3 + 장면 18 + 목록 10 = 35) + data.go.kr 2(버스 TAGO·무장애) + TOPIS 1 + 서울열린데이터 0(문화행사는 일자 캐시) . 장면 18종은 종전 "버튼 누를 때만"에서 "진입마다"로. 카카오 일 쿼터 대비 무시 가능, `DATA_GO_KR_API_KEY`는 무장애 1회/진입이 추가(일 1,000 공유 — 백로그 C4 사용량 트리거 그대로).

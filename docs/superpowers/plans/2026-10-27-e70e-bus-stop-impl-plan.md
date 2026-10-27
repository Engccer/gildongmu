# E70-e 구현 계획 (2026-10-27)

spec: `docs/superpowers/specs/2026-10-27-e70e-bus-stop-transfer-design.md`(정본). 입력 경로는 위원장 판정(2026-10-27 21:05)으로 정류장 이름 검색(spec §3·§4.6). 브랜치 `feat/e70e-bus-stop`, worktree `~/gildongmu-wt/e70e-bus-stop`.

위임 판정: A(서버 판정 술어)·A2(정류장 검색 라우트)·D(게이트 스크립트)는 서로 파일이 겹치지 않아 병행할 수 있고(A2는 `src/lib/journey/stop-search.ts`·`route/journey/stops`·provider 두 파일·`tago-coverage.ts`만), D는 A·A2 결과를 부른다. 종전 문장: A(서버)와 D(게이트 스크립트)는 파일이 겹치지 않아 병행, B(Kit)는 A가 만든 공유 fixture를 읽어 A 뒤, C(앱)는 B의 타입(`RecentStation.kind`·`JourneyStationQuery.kind`·`journeyBusStopKey`)을 써서 B 뒤. A·B·C는 서브에이전트(sonnet), D는 inline(호출 비용 통제).

## A. 서버 (TS) — `src/lib/journey/*`·`src/lib/types.ts`·`src/app/api/route/journey/route.ts`·`src/lib/__tests__/fixtures/journey-station-pairs.json`

1. `types.ts`: `JourneyStationInput.kind?: "stop"`. `JourneyRequest`(assemble.ts)에 `stops?: boolean`.
2. `station-identity.ts`: `busStopKey(name)`·`isSameBusStop(stop, input)`·`busStopNamesStation(stop, input)` (spec §4.2 그대로). 자체 역명 정규화 금지 — 역 키는 `normalizeStationName`.
3. fixture `journey-station-pairs.json`에 `busStops` 배열: `{ name, key }` 표본(spec §1.2 이름 중 공개 정류장 — 자택 부근 이름은 넣지 않는다, `public-repo-privacy-guard` 목록 기준)과 `stationMatches: [{ station, stop, match }]` 표본(맞음: 강남↔강남역12번출구·신분당선강남역·지하철2호선강남역·강남역.삼성전자, 시청↔시청.교육청, 서울역↔서울역버스환승센터(5번승강장), 담티↔도시철도담티역(3번출구) / 안 맞음: 대구↔동대구역건너, 강남↔강남구청역, 시청↔시청앞… 아님 주의 — 「시청앞」은 키가 「시청앞」이라 1번 규칙 불일치, 2번 규칙 `시청역` 미포함 → 안 맞음). 좌표 조건은 테스트가 따로 준다.
4. `designated.ts`: 쪽 맞음 등급 `"strong" | "weak" | null`(`sideMatch(route, end, input, stops)`), `findDesignated(ranked, d, { allowWeak })`(강만 또는 강·약), spec §4.3 네 단계는 `assemble.ts`가 부른다. `missingSide`는 강·약 구분 없이(stops일 때 약 포함). 정류장 입력은 버스 leg만, 역 입력은 지하철 leg(강)·버스 leg(약, stops만).
5. `assemble.ts` ②: spec §4.3 네 단계(지하철만은 모든 지정 쪽이 역일 때만, 버스만은 `stops`일 때만). 미지정(`stops` 없음) 경로는 종전과 호출·결과 동일.
6. `route.ts`: `stops`(`"1"`|null), `boardKind`·`alightKind`(`"stop"`|null), `stops` 없이 kind면 400. kind는 그 쪽 좌표·이름이 있을 때만 의미(없는 쪽 kind도 400).
7. 테스트(기존 `src/lib/journey/__tests__`·라우트 테스트에 더한다): busStopKey 표본(fixture), 술어 좌표 반경, 강·약 우선(풀 사이 경쟁: 전체 후보의 약 vs 지하철만의 강 → 강), 호출 수(정류장만 2·역만 최대 3·미지정 종전), 정류장 하차 변형의 카카오 출구·승강장 호출 0 + egress `none`, 라우트 400·미지정 응답 동일.
8. `npm run test:run`(게이트 락) 해당 파일 + `npx tsc --noEmit`.

## A2. 정류장 이름 검색 (spec §4.6)

1. `tago-coverage.ts`: `tagoCityCodeOf(province, city): string | null`(`"seoul"` 포함) — 기존 표·seed 재사용, 표 테스트.
2. `providers/seoul-bus.ts`: `searchSeoulStopsByName(q)` — `fetchSeoul("stationinfo/getStationByName", { stSrch: q }, { next: { revalidate: 86400 } })` + 파서(`stNm`·`tmX`(경도)·`tmY`(위도)·`arsId` — 필드는 실호출로 확인, 다르면 게이트가 잡는다).
3. `providers/tago-bus.ts`: `searchTagoStopsByName(cityCode, q)` — `fetchTago(STN_BASE, "getSttnNoList", { cityCode, nodeNm: q, numOfRows: 100 }, { next: { revalidate: 86400 } })` + 기존 `parseBusStops` 재사용 가능 여부 확인.
4. `src/lib/journey/stop-search.ts`: `searchJourneyStops(q, coords, deps)` 순수 조립(지역 유도 → 검색 → 정렬·500m 같은 이름 제거·상위 10·`unsearched`·`failed`·전부 실패 throw).
5. `src/app/api/route/journey/stops/route.ts`: spec §4.6 요청 계약(400·outOfCoverage·503 키 게이트·502).
6. 테스트: 위 전부 + 라우트.

## B. Kit (Swift) — `RecentSearchStore.swift`·`RouteService.swift`·`Journey.swift`·테스트

0. `RouteService.journeyStops(query:origin:dest:)` + 응답 모델(`JourneyStopHit`·`unsearched`·`failed`).
1. `JourneyStationKind: String, Codable { case busStop }`, `RecentStation.kind: JourneyStationKind?`(init 인자 기본값 없음, 디코딩 부재 = nil). 호출부 전부 갱신.
2. `JourneyStationQuery.kind`(기본값 없는 인자), `RouteService.journey`가 늘 `stops=1`, 정류장이면 `boardKind=stop`/`alightKind=stop`.
3. `journeyBusStopKey(_:)` — 웹 `busStopKey` 미러, 공유 fixture `busStops`로 테스트(기존 `JourneyTests`가 fixture를 읽는 방식 재사용).
4. `journeyLineQualifiers`: 지정 쪽이 정류장이면 그 쪽 false. `journeyRecommendedTitleIsBoardSide`: 정류장 쪽은 `journeyBusStopKey` 비교.
5. 정규식 미러 주의: 문자 클래스 안 `[` 이스케이프(CLAUDE.md).
6. `swift test`(게이트 락).

## C. 앱 (SwiftUI) + 문구

1. `ios/i18n/ios-extra/{ko,en,es,fr,it,ja}.json`: spec §6 표(바뀐 5키, `notStation` 삭제, 새 10키). 생성물 재생성: `node ios/scripts/messages-to-xcstrings.mjs all`, `node android/scripts/messages-to-android-strings.mjs`(+ kit strings 필요 시), arg-order 갱신 플래그는 새 키라 필요 없을 수 있음 — 스크립트 출력대로.
2. `DirectionsEndpointSearchView.swift`: 역 칸 대상일 때 제출하면 장소 검색과 정류장 검색(Kit `RouteService.journeyStops` — B에 추가) 병렬, 목록 순서 역 → 정류장(≤5) → 그 밖, 정류장 줄 라벨·실패 줄·`unsearched` 줄, 비역 장소는 `notStation` 통지(spec §3). 선택 콜백은 `RecentStation`을 돌려주게 바꾼다(역은 kind nil, 정류장은 `.busStop`). 시트는 출발·도착 좌표를 받는다.
3. `DirectionsTabView.swift`: 콜백 배선, `journeyStationQuery`에 kind, 최근 경로 줄(`recentRouteStop`·`recentRouteBothPlaces`·`stationPlace`).
4. `JourneyResultRows.swift`: 지정 제목 버스 판본, 못 찾음 줄 정류장 판본(정류장 이름은 표시 함수로 깎지 않는다).
5. 소스 가드가 키 전수를 세면(`check-xcstrings-keys.mjs`, i18n 테스트) 함께 통과.
6. 앱 빌드: Experimental·Release(`-derivedDataPath ~/gildongmu-wt/e70e-bus-stop-dd`, 게이트 락).

## D. 실호출 게이트 `scripts/verify-journey-bus-stops.mjs` (inline, 머지 게이트)

- ① 정류장 이름 검색(`searchJourneyStops`, 실 deps): TOPIS(서울 공개 명소 이름)·TAGO(지방 광역시 하나·도 시군 하나, 도시코드는 좌표에서 유도)가 각각 결과를 주고 좌표가 요청 좌표 근처(≤ 20km)인가.
- ② 그 결과의 정류장으로 지정한 여정(`getJourney`, `stops`, kind stop) — 서울 승차·하차, 지방 하나 — 가 `designated`를 찾고 정류장 하차면 egress `none` 하나인가.
- ③ 역 입력 약 맞음 표본 하나(참고).
- `--out`/`--from-corpus`(저장소 밖). 상한: ODsay 8(세션 10), 카카오 잔여 안, Tmap 15, TOPIS·TAGO 30.
- 통과 실행 결과를 spec §8 아래 기록.

## 문서 분배 (마지막)

BACKLOG E70-e 항목·머리 착수 순서 표, FIELD-TEST §6-3 행, CHANGELOG, PROGRESS 자기 자리, INTEGRATIONS §여정 조립과 출구 수집.

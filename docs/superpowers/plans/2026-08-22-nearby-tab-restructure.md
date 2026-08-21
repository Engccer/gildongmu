# M4 iOS "내 주변" 탭 재편 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS "내 주변" 탭의 "현재 위치 확인"과 "둘러보기"를 하나의 "둘러보기" 화면으로 합치고, 맨 위에 위치 문장 + "한눈에 보기" 5불릿(공통 반경 1km, 서버 집계) + 자동 펼침 "주변 상황"(장소 상세 진입)을 둔다.

**Architecture:** 서버에 집계 라우트 `/api/nearby/overview`(`assembleWhereAmI` 동형 allSettled, 불릿별 3-state)를 신설하고 `/api/surroundings/scene` 항목에 장소 투영 필드를 싣는다. iOS는 `AroundNearbyModel` 하나가 조망·장면·목록 세 요청을 한 fetch로 묶어 `NearbyLoadCore`에 한 번 커밋한다(착지·통지 1회). 문장은 Kit의 결정론 템플릿(i18n)으로 조립.

**Tech Stack:** Next.js 16 Route Handler, zod 4, Vitest 4, Swift 6/SwiftUI, Swift Testing, citty CLI.

**Spec:** `docs/superpowers/specs/2026-08-22-nearby-tab-restructure-design.md`

**구현 방식 판정**: inline. 서버 계약 → Kit 모델 → iOS 화면이 순차 의존이고(인터페이스가 앞 태스크에서 확정), 수정 파일이 겹친다(`SurroundingsSceneSection.swift`를 두 태스크가 만짐). 리뷰는 태스크 묶음별 subagent(spec-compliance + code-quality)로 분리.

## Global Constraints

- 공통 반경 **1,000m**(`OVERVIEW_RADIUS_M`), 대표 장소 **최대 2개**(거리순), 불릿 순서 고정 `transit, food, kids, events, barrierFree`.
- 키 없는 불릿은 응답에서 **제외**(0 노출). 상태 `ok | none | unavailable | failed`를 문장에서 절대 뭉개지 않는다.
- §2 소유 파일 밖 수정 금지(`BeaconTrackingSheet.swift`·`ios` 네임스페이스의 타 키·`project.pbxproj`는 파일 삭제로만 변경). 새 Swift 파일은 만들지 않는다(기존 파일에 넣는다).
- 커밋은 `git commit -- <paths>` pathspec. `git add -A` 금지.
- 한 줄 = 한 접근성 객체(불릿·장소 행), 가운뎃점 금지, UI 이모지 금지.
- `SurroundingsSceneSection`의 버튼형(`.manual`) 동작은 byte-identical(안내 시트 소비).

---

### Task 1: 서버 집계 `nearby-overview.ts` (순수 + I/O)

**Files:**
- Modify: `src/lib/providers/kids-places.ts` (`findKidsPlacesNear(lat,lng,opts?)`에 `radiusMeters` 옵션)
- Modify: `src/lib/where-am-i.ts` (`stripRegionPrefix`를 `export`)
- Create: `src/lib/nearby-overview.ts`
- Test: `src/lib/__tests__/nearby-overview.test.ts`

**Interfaces (Produces):**
```ts
export const OVERVIEW_RADIUS_M = 1000;
export const OVERVIEW_NEAREST_CAP = 2;
export interface OverviewPlace { name: string; distanceMeters: number; bearing: CompassDirection }
export interface OverviewStation { name: string; line?: string; bearing: CompassDirection; distanceMeters: number }
export type OverviewBusStops =
  | { state: "ok"; count: number; nearest: OverviewPlace[] }
  | { state: "none" } | { state: "uncovered" } | { state: "failed" };
export type OverviewKind = "transit" | "food" | "kids" | "events" | "barrierFree";
export type OverviewBullet =
  | { kind: "transit"; state: "ok"; station: OverviewStation | null; busStops: OverviewBusStops | null }
  | { kind: Exclude<OverviewKind,"transit">; state: "ok"; count: number; countCapped: boolean; nearest: OverviewPlace[] }
  | { kind: Exclude<OverviewKind,"transit">; state: "none" }
  | { kind: "events"; state: "unavailable"; reason: "seoulOnly" }
  | { kind: Exclude<OverviewKind,"transit">; state: "failed" };
export interface NearbyOverview { place: string | null; radiusMeters: number; bullets: OverviewBullet[] }
// 순수: settled 결과 → 불릿 (테스트 대상)
export function composeOverview(input: OverviewInput): NearbyOverview;
// I/O: 좌표 → 조각 병렬 조회 → composeOverview
export async function assembleNearbyOverview(lat: number, lng: number): Promise<NearbyOverview>;
```
`OverviewInput = { lat, lng, address: {road,jibun}|null, region: string|null, station: (SubwayStation&{distanceMeters})|null, bus: PromiseSettledResult<BusStop[]>|null /*null=키 없음*/, busUncovered: boolean, food: PromiseSettledResult<SurroundingPlace[]>|null, kids: PromiseSettledResult<KidsPlace[]>|null, events: PromiseSettledResult<NearbyEventsResult>|"unavailable"|null, barrierFree: PromiseSettledResult<BarrierFreePlace[]>|null }`.

- [ ] **Step 1: 실패 테스트** — `composeOverview`:
  - rejected 조각 → `state:"failed"`(none으로 뭉개면 실패하는 단언)
  - fulfilled 빈 배열 → `none`
  - `null` 조각(키 없음) → 불릿 **부재**, 순서 유지
  - food 30건 → `countCapped:true`, 12건 → false; nearest 2개 거리순·bearing 8방위
  - events `"unavailable"` → `{kind:"events",state:"unavailable",reason:"seoulOnly"}`
  - transit: station null + bus fulfilled 0 + busUncovered true → `busStops.state:"uncovered"`; bus null → `busStops:null`
  - place: region+road 접두 중복 제거(`서울특별시 강동구 길동` + `서울특별시 강동구 천중로44길 74` → `서울특별시 강동구 길동, 천중로44길 74`)
- [ ] **Step 2: 실행 → FAIL** `npx vitest run src/lib/__tests__/nearby-overview.test.ts`
- [ ] **Step 3: 구현** — `composeOverview` + `assembleNearbyOverview`: `Promise.allSettled([coordToAddress, coordToRegion, hasDataGoKrKey()&&fetchNearbyBusStops, hasKakaoKey()&&findSurroundingsNear({groups:["FD6","CE7"],radiusMeters:1000,cap:50}), hasKakaoKey()&&findKidsPlacesNear(lat,lng,{radiusMeters:1000}), hasSeoulOpenDataKey()&&(isEventServiceArea? findEventsNear(lat,lng,{radiusMeters:1000}) : "unavailable"), hasDataGoKrKey()&&searchBarrierFreeNearby(lat,lng,{radiusMeters:1000,limit:50})])`; bus fulfilled 0건일 때만 `isUncoveredBusRegion`. station은 `findStationsNear(lat,lng,{radiusMeters:1000,dedupeByName:true,limit:1})[0]`. food `countCapped = places.length >= 30`(2그룹×15). kids provider: `opts?.radiusMeters ?? RADIUS_METERS`를 `fetchKakaoKeyword`에 전달.
- [ ] **Step 4: 실행 → PASS**, 기존 `kids-places` 테스트도 PASS
- [ ] **Step 5: Commit** `git commit -- src/lib/nearby-overview.ts src/lib/__tests__/nearby-overview.test.ts src/lib/providers/kids-places.ts src/lib/where-am-i.ts`

### Task 2: 라우트 `/api/nearby/overview` + `SceneItem` 확장

**Files:**
- Create: `src/app/api/nearby/overview/route.ts`
- Test: `src/app/api/nearby/overview/__tests__/route.test.ts`
- Modify: `src/lib/surroundings-scene.ts` (`SceneItem`에 `id, lat, lng, categoryRaw, roadAddress, phone?, link?` 추가 — `toItem`이 `SurroundingPlace`에서 투영)
- Test: `src/lib/__tests__/surroundings-scene.test.ts`(기존 있으면 케이스 추가, 없으면 생성: 새 필드 존재 + 기존 필드 불변)

**Interfaces:** 라우트 순서 파싱→`isInKorea`→`assembleNearbyOverview`. 응답 `{data: NearbyOverview}`; `bullets.length===0 && place===null` → `{data:null}`; 예외 → 502.

- [ ] Step 1: 라우트 테스트(`vi.mock("@/lib/nearby-overview")`): lat 누락 400, 해외 `outOfCoverage`, 정상 `{data}`, 전부 비면 `{data:null}`, throw → 502. scene 테스트: `toItem` 투영 필드.
- [ ] Step 2: FAIL 확인 → Step 3: 구현(`where-am-i/route.ts` 골격 복제, 키 게이트는 조립 안에 있으므로 라우트엔 없음) → Step 4: PASS + `coord-param-usage.test.ts` PASS
- [ ] Step 5: Commit `git commit -- src/app/api/nearby/overview src/lib/surroundings-scene.ts src/lib/__tests__/surroundings-scene.test.ts`

### Task 3: CLI/MCP 카탈로그 + 포매터

**Files:**
- Modify: `packages/cli/src/lib/endpoint-catalog-shared.ts`, `packages/mcp/src/lib/endpoint-catalog-shared.ts`(両미러 동일) — `{ name: "nearby-overview", description: "내 주변 한눈에 보기(1km 안 대중교통·식당카페·아이 놀 곳·문화행사·무장애 관광지)", path: "/api/nearby/overview", method: "GET", params: LATLNG, envelope: "data", locationParam: true, mcp: true }` (where-am-i 항목 바로 뒤)
- Modify: `packages/cli/src/lib/formatters.ts` — `formatNearbyOverview`: place 1줄 + 불릿당 1줄(ko 고정 템플릿, Task 5의 Kit 문장과 같은 구조: 상태별 문장 분리)
- Test: 기존 `formatter-coverage.test.ts`·catalog drift 자동. `formatters.test.ts`에 케이스: failed/none/unavailable 문장이 서로 다름.

- [ ] Step 1~4: 테스트 → 구현 → `cd packages/cli && npx vitest run`, `cd packages/mcp && npx vitest run` PASS
- [ ] Step 5: Commit(両 카탈로그 + 포매터 + 테스트). CHANGELOG/버전 올림은 릴리스 시점이라 여기선 안 한다.

### Task 4: i18n 키 (6 로케일) + xcstrings 재생성

**Files:** `messages/{ko,en,es,fr,it,ja}.json` — `nearby` 네임스페이스에 추가:
```
nearby.around.title            "둘러보기"            (ios.nearby.around 값도 이 문자열로 변경)
nearby.around.here             "현재 위치 기준, {place} 근처"
nearby.around.hereNoPlace      "현재 위치 기준"
nearby.around.hereManual       "지정한 위치 기준, {place} 근처"
nearby.around.hereManualNoPlace "지정한 위치 기준"
nearby.around.loaded           "둘러보기를 확인했습니다"
nearby.around.loadedManual     "지정한 위치 주변을 확인했습니다"
nearby.around.placesHeading    "주변 가게와 시설"
nearby.overview.heading        "한눈에 보기"
nearby.overview.radius         "{distance} 안"
nearby.overview.failed         "한눈에 보기 정보를 가져오지 못했습니다"
nearby.overview.nearestLead    "가장 가까운 곳은 {items}"
nearby.overview.nearestItem    "{direction}쪽 {distance} {name}"
nearby.overview.transit.station "지하철 {name}{line} {direction}쪽 {distance}"   (line은 "(5호선)" 조각, 없으면 빈 문자열)
nearby.overview.transit.noStation "{distance} 안에 지하철역이 없고"
nearby.overview.transit.bus     "버스 정류소 {count}곳, {nearest}"
nearby.overview.transit.busNone "버스 정류소가 없습니다"
nearby.overview.transit.busUncovered "버스 정류소 정보는 이 지역에서 제공되지 않습니다"
nearby.overview.transit.busFailed "버스 정류소 정보를 가져오지 못했습니다"
nearby.overview.transit.lead    "대중교통: {body}"
nearby.overview.label.food / kids / events / barrierFree  "식당과 카페" / "아이 놀 곳" / "문화 행사" / "무장애 관광지"
nearby.overview.ok             "{label} {count}곳, {nearest}"
nearby.overview.okCapped       "{label} {count}곳 이상, {nearest}"
nearby.overview.none           "{label}은 {distance} 안에 없습니다"     (조사는 로케일별 자연스럽게)
nearby.overview.unavailable.seoulOnly "{label}는 서울에서만 안내합니다"
nearby.overview.failedItem     "{label} 정보를 가져오지 못했습니다"
```
- [ ] Step 1: 6 로케일 추가(영어·스페인어·프랑스어·이탈리아어·일본어는 자연어 번역, 플레이스홀더 동일) → `npx vitest run src/lib/__tests__/i18n-messages.test.ts` PASS
- [ ] Step 2: `node ios/scripts/messages-to-xcstrings.mjs && node ios/scripts/check-xcstrings-keys.mjs` PASS
- [ ] Step 3: Commit `git commit -- messages ios/Gildongmu/Localizable.xcstrings ios/GildongmuKit/Sources/GildongmuKit/Resources/Localizable.xcstrings`(실제 경로는 스크립트 출력으로 확인)

### Task 5: Kit — 모델·서비스·투영·문장 조립

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Models/SurroundingsSceneModels.swift` — `SurroundingsSceneItem`에 `id, lat, lng, categoryRaw, roadAddress: String?, phone: String?, link: String?`
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Models/NearbyModels.swift` — `NearbyOverview`, `OverviewBullet`(enum with kind+state, 디코딩은 `kind`·`state` 문자열 기반 수동 `init(from:)`), `OverviewPlace`, `OverviewStation`, `OverviewBusStops`, `NearbyOverviewResponse{data: NearbyOverview?}`
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/PlaceProjection.swift` — `public func sceneItemToPlace(_ item: SurroundingsSceneItem) -> Place`(`surroundingPlaceToPlace` 동형, category=categoryRaw)
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/NearbyService.swift` — `public func nearbyOverview(lat:lng:) async throws -> NearbyOverview?`
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/WhereAmIModels.swift` 옆이 아니라 **같은 파일에 두지 말고** `Models/NearbyModels.swift` 끝에 `public func buildOverviewLines(_ o: NearbyOverview, lang: String) -> [String]`(불릿당 한 문장, 상태별 키 분기, `joinText`·`formatDistance`·`kitLocalized`)
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/NearbyOverviewTests.swift` — 디코딩(5 kind × 상태), `buildOverviewLines` ko: failed/none/unavailable/ok/okCapped 문장이 전부 다름, nearest 2개 쉼표 결합, transit 조합 4종; `sceneItemToPlace` 좌표·category.

- [ ] Step 1: 테스트 → FAIL(`cd ios/GildongmuKit && swift test --filter NearbyOverviewTests`) → Step 3: 구현 → Step 4: PASS(전체 `swift test`)
- [ ] Step 5: Commit(Kit 파일 + 테스트)

### Task 6: iOS 화면 — `SurroundingsSceneSection` `.auto` 모드 + 장소 행 NavigationLink

**Files:** Modify `ios/Gildongmu/Nearby/SurroundingsSceneSection.swift`

**Interfaces (Produces):**
```swift
enum SurroundingsSceneMode { case manual(anchor: NearbyCoord, proxy: ScrollViewProxy); case auto(scene: SurroundingsScene?, failed: Bool) }
struct SurroundingsSceneSection: View { init(anchor:proxy:) /*기존, = .manual*/ ; init(scene: SurroundingsScene?, failed: Bool) /*= .auto*/ }
```
- `.auto`: 헤딩 `surroundings.ready`(`.isHeader`) → `scene==nil && failed` → `surroundings.error` 행; `scene==nil && !failed` 또는 `total==0` → `surroundings.empty`; 아니면 묶음 렌더(기존 `ForEach` 재사용, `model` 없이 로컬 `@State windows` 더 보기) + 출처 각주. 버튼·닫기·착지 없음.
- 両모드 공통: 장소 행 `NavigationLink { PlaceDetailView(place: sceneItemToPlace(item)) } label: { distanceText(itemLine(item)) }` (기존 `.id`·`accessibilityFocused` 유지 — 더 보기 착지).
- [ ] Step 1: 구현 → Step 2: `xcodebuild`(Debug, 시뮬) 빌드 PASS → Step 3: Commit

### Task 7: iOS 화면 — `AroundNearbyView` 재편 + 허브 + `WhereAmIView` 삭제

**Files:**
- Modify: `ios/Gildongmu/Nearby/AroundNearbyView.swift` — `AroundPayload{ overview: NearbyOverview?; overviewFailed: Bool; scene: SurroundingsScene?; sceneFailed: Bool; places: [SurroundingPlace]?; placesFailed: Bool; lat; lng }`, `fetch`는 `async let` 3개 + 개별 `try?`/Result로 묶어 **셋 다 실패면 throw**, 아니면 payload. `onEvent: nearbyAnnouncer(loaded: { _ in manual==nil ? "nearby.around.loaded" : "nearby.around.loadedManual" })`. 본문 순서 spec §2 표. 착지 id `"around-top"`(위치 문장 Text). `navigationTitle(appLocalized("nearby.around.title"))`. 기존 `PlaceRow` 목록은 "주변 가게와 시설" 헤딩 아래. overlay descriptor `.absentCapable`(data 전부 null → `ios.nearby.whereAmIEmpty` 재사용 금지: 새 키 불필요 — `.list(empty: ios.nearby.aroundEmpty, isEmpty: { $0.isAllAbsent })`).
- Modify: `ios/Gildongmu/NearbyHubView.swift` — `whereAmI.button` 행 삭제, `around` 행을 `LocationBarView` 직후로.
- Delete: `ios/Gildongmu/Nearby/WhereAmIView.swift` + `project.pbxproj`에서 참조 제거(파일 참조·빌드 페이즈 2곳, ID 재사용 없음) → `xcodebuild -list` 검증.
- [ ] Step 1: 구현 → Step 2: 시뮬 빌드 + `xcodebuildmcp simulator build-and-run` 후 `snapshot-ui`로 둘러보기 화면 요소 순서 확인(위치 문장 → 한눈에 보기 → 주변 상황 → 물어보기 → 주변 가게와 시설) → Step 3: `grep -rn "WhereAmIView\|ios.nearby.whereAmI" ios/Gildongmu` 0건(죽은 키는 messages에서 제거 — `ios.nearby.whereAmIReady/whereAmIAsOf/whereAmIChat/whereAmIEmpty/whereAmIFailed/whereAmIServerFailed` 6키, 웹 미사용 확인 후) → Step 4: Commit

### Task 8: 실호출 게이트 + 리뷰 + 문서 분배 + 통합

- [ ] `scripts/verify-nearby-overview.mjs`: dev 서버(또는 `BASE_URL`)에 길동·전주·후쿠오카 좌표 3회 → 단언: 서울 불릿 5개 존재·events ok/none, 전주 events `unavailable`, 후쿠오카 `outOfCoverage`; `/api/surroundings/scene` 길동 항목에 `lat`·`lng`·`id` 존재. 종료 코드 0/1. 결과를 spec §8에 1줄 기록.
- [ ] subagent 리뷰 2종(spec-compliance·code-quality) — diff 범위 = 브랜치 전체, 세션 히스토리 미전달. 지적은 아키텍처 대조 후 처리.
- [ ] 문서: `CHANGELOG.md`(2026-08-22 아래 M4 소제목), `docs/BACKLOG.md` M4 → 종결(웹 후속 이식 1줄만 남김), `PROGRESS.md` 상태 1줄, `CLAUDE.md` 함정(새로 배운 것만), `PORTS.md`(워크스페이스 루트, 웹 이식 open 행), `docs/appstore/release-notes.md`는 릴리스 세션 몫.
- [ ] 통합: plan §3 절차(`git fetch && git rebase origin/main` → xcstrings 재생성 → `npm run test:run` → `git push origin feat/m4-nearby:main`).
- [ ] 실기기 배포: 다른 세션에 알린 뒤 `ios/deploy-device.sh`(Debug) + `CONFIGURATION=Experimental ./ios/deploy-device.sh`.

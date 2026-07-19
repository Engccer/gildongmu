# 검색 정확도순 전환 + 명소 섹션 통합 폐지 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장소 검색을 거리순에서 "정확도순+좌표 블렌딩"으로 전환하고, 명소 전용 경로(웹·iOS·CLI/MCP)를 완전 제거해 칩 필터가 검색 장소 결과 전체를 커버하게 한다.

**Architecture:** 카카오 `sort=accuracy`(기본값)+x·y가 근접 블렌딩을 제공함을 실호출로 확정했으므로(스펙 참조), 거리순 3겹(카카오 요청·서버 병합 재정렬·클라이언트 재정렬)을 제거한다. 거리 **표기**는 서버 진입점(`searchPlaces`)에서 정렬 없이 `distanceMeters`만 부여하는 `annotateDistances`로 일원화한다(웹·iOS·CLI가 전부 서버 주석을 소비 — DRY). 명소 트랙은 웹 상태·라우트·provider·iOS 트랙·CLI/MCP 카탈로그에서 삭제하고, `BUCKET_ORDER`(관광명소 최상단)가 병치 효과를 대체한다.

**Tech Stack:** Next.js 16, TypeScript, Vitest, SwiftUI/GildongmuKit(SPM), npm Trusted Publishing.

**정본 스펙:** `docs/superpowers/specs/2026-07-20-accuracy-first-search-design.md`

## Global Constraints

- 커밋 이메일 `engccer@gmail.com`, 주석·커밋 한국어, `git add -A` 금지(의도 파일만, 신규 파일은 add+commit 원자 실행).
- 매 태스크 커밋 전 `npm run test:run` green. 최종 게이트: `npm run lint` + `npm run build` + 실호출 3종.
- i18n 키는 전 로케일(ko·en·es·fr·it) 동시 제거 — `i18n-messages.test.ts`가 parity 강제.
- 카탈로그는 cli·mcp 両미러 동일 유지(drift 테스트 강제).
- `category.attraction`(버킷 라벨)·barrier-free의 "attractions" 문구는 **삭제 금지**(명소 섹션과 무관).

---

### Task 1: 서버 정렬 전환 — annotateDistances 신설 + 거리순 2겹 제거

**Files:**
- Modify: `src/lib/geo.ts` (annotateDistances 추가)
- Modify: `src/lib/providers/kakao-local.ts:58-74` (sort=distance 제거)
- Modify: `src/lib/providers/places.ts` (재정렬 제거 + 진입점 주석)
- Modify: `src/lib/types.ts:35` (주석의 sortPlacesByDistance 언급 갱신)
- Test: `src/lib/__tests__/geo.test.ts`, `src/lib/providers/__tests__/` 기존 테스트 갱신

**Interfaces:**
- Produces: `annotateDistances(places: Place[], origin: Coord): Place[]` — 정렬 없이 distanceMeters 부여(비유한 좌표는 미부여). `searchPlaces` 결과는 좌표 파라미터 존재 시 항상 distanceMeters 포함.
- `sortPlacesByDistance`는 남은 사용처가 없으면 삭제(Task 3에서 웹 사용처 제거 후 확인 — 이 태스크 시점엔 PlaceSearch가 아직 쓰므로 유지).

- [ ] **Step 1: geo.test.ts에 annotateDistances 실패 테스트 추가**

```ts
import { annotateDistances } from "../geo";

describe("annotateDistances", () => {
  const origin = { lat: 37.5, lng: 127.0 };
  it("입력 순서를 보존하며 distanceMeters만 부여한다", () => {
    const far = { id: "a", name: "먼곳", category: "", address: "", roadAddress: "", lat: 38.0, lng: 128.0 };
    const near = { id: "b", name: "가까운곳", category: "", address: "", roadAddress: "", lat: 37.5, lng: 127.001 };
    const out = annotateDistances([far, near], origin);
    expect(out.map((p) => p.id)).toEqual(["a", "b"]); // 정렬 안 함
    expect(out[0].distanceMeters).toBeGreaterThan(out[1].distanceMeters!);
  });
  it("비유한 좌표는 distanceMeters를 부여하지 않는다", () => {
    const bad = { id: "c", name: "", category: "", address: "", roadAddress: "", lat: NaN, lng: 127.0 };
    expect(annotateDistances([bad], origin)[0].distanceMeters).toBeUndefined();
  });
  it("입력 배열·원소를 변형하지 않는다", () => {
    const p = { id: "d", name: "", category: "", address: "", roadAddress: "", lat: 37.5, lng: 127.0 };
    const arr = [p];
    annotateDistances(arr, origin);
    expect(p).not.toHaveProperty("distanceMeters");
  });
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:run -- geo` → FAIL (annotateDistances not exported)

- [ ] **Step 3: geo.ts에 구현**

```ts
/**
 * 정렬 없이 각 장소에 origin 기준 distanceMeters만 부여한 새 배열(순수).
 * 정확도순 전환(2026-07-20) 후 거리는 "표기 정보"이지 정렬 축이 아니다 —
 * 순서는 provider 관련도를 그대로 보존한다. 비유한 좌표는 미부여(표기 생략).
 */
export function annotateDistances(places: Place[], origin: Coord): Place[] {
  return places.map((p) =>
    Number.isFinite(p.lat) && Number.isFinite(p.lng)
      ? { ...p, distanceMeters: haversineMeters(origin.lat, origin.lng, p.lat, p.lng) }
      : p,
  );
}
```

- [ ] **Step 4: kakao-local.ts `buildKakaoSearchUrl` — sort=distance 제거·주석 갱신**

```ts
/**
 * 검색 URL 빌더(순수) — query·size에 더해, 좌표가 둘 다 있으면 x(경도)·y(위도)를
 * 붙인다. sort는 지정하지 않는다(기본 정확도순) — 좌표가 있으면 카카오가 근접성을
 * 관련도에 블렌딩한다(실호출 확정 2026-07-20: "맥도날드"는 근처 지점 상위,
 * "경복궁"은 15km 밖에서도 본체·부속 명소 최상단). radius도 미지정(0건 위험 회피).
 */
export function buildKakaoSearchUrl(params: PlaceSearchParams): URL {
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", params.query);
  url.searchParams.set("size", String(Math.min(params.limit ?? 10, 15)));
  if (params.lat != null && params.lng != null) {
    url.searchParams.set("x", String(params.lng));
    url.searchParams.set("y", String(params.lat));
  }
  return url;
}
```

- [ ] **Step 5: places.ts — MergedKo 재정렬 제거 + searchPlaces 진입점 주석**

`searchPlacesMergedKo`의 정렬 분기를 제거하고 병합 순서 그대로 반환:

```ts
  const merged = mergePlaces(kakao, naver);
  return { places: merged, provider: "merged", query: params.query };
```

(주석도 갱신: "좌표가 있으면 재정렬" 문단 → "카카오 정확도순 15건 뒤에 네이버 5건(자체 정확도순)을 이어 붙인다. 네이버 전용 근처 가게가 하단에 오는 트레이드오프는 수용(보강 소스 역할, 스펙 §1). 재정렬은 하지 않는다 — 정확도 축 보존.")

`searchPlaces`는 provider 선택 결과에 좌표 존재 시 distanceMeters를 주석해 반환(모든 소비자 — 웹 route·채팅 도구·CLI — 가 서버 주석 하나를 공유):

```ts
export async function searchPlaces(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  const result = await pickPlacesProvider(params);
  // 거리 "표기"는 서버 일원화 — 정렬 없이 주석만(정확도순 전환, 스펙 §1).
  if (params.lat != null && params.lng != null) {
    return {
      ...result,
      places: annotateDistances(result.places, { lat: params.lat, lng: params.lng }),
    };
  }
  return result;
}

/** provider 선택 체인(기존 searchPlaces 본문 그대로 이동). */
async function pickPlacesProvider(
  params: PlaceSearchParams,
): Promise<PlaceSearchResult> {
  const forced = process.env.PLACES_PROVIDER;
  if (forced === "kakao") return searchPlacesKakaoLocal(params);
  if (forced === "naver") return searchPlacesNaverLocal(params);
  if (forced === "tour") return searchPlacesTourApi(params);
  if (forced === "mock") return searchPlacesMock(params);
  if (params.lang === "en" && hasTourApiKey() && hasKakaoKey()) {
    return searchPlacesMergedEn(params);
  }
  if (params.lang === "en" && hasTourApiKey()) {
    return searchPlacesTourApi(params);
  }
  if (hasKakaoKey() && hasNaverLocalKeys() && params.lang !== "en") {
    return searchPlacesMergedKo(params);
  }
  if (hasKakaoKey()) return searchPlacesKakaoLocal(params);
  if (hasNaverLocalKeys()) return searchPlacesNaverLocal(params);
  return searchPlacesMock(params);
}
```

import에서 `sortPlacesByDistance` 제거, `annotateDistances` 추가.

- [ ] **Step 6: 기존 테스트 갱신** — `buildKakaoSearchUrl`이 sort를 안 넣는지(기존 "sort=distance" 기대 테스트 반전), MergedKo가 재정렬 없이 카카오→네이버 순서를 보존하는지, searchPlaces가 좌표 시 distanceMeters를 주석하는지. types.ts:35 주석의 `sortPlacesByDistance` 언급을 `annotateDistances`로.

- [ ] **Step 7: `npm run test:run` 전체 green 확인 후 커밋**

```bash
git commit -m "feat(search): 서버 정렬을 정확도순+좌표 블렌딩으로 전환, 거리 표기는 annotateDistances 일원화" -- src/lib/geo.ts src/lib/providers/kakao-local.ts src/lib/providers/places.ts src/lib/types.ts src/lib/__tests__/geo.test.ts <갱신한 테스트 경로들>
```

---

### Task 2: search-sections에서 attraction 제거

**Files:**
- Modify: `src/lib/search-sections.ts`
- Test: `src/lib/__tests__/search-sections.test.ts`

**Interfaces:**
- Produces: `SectionKind = "place" | "address" | "web"`, `orderResultSections(placeCount, addrCount, webCount?)` (3인자), `combinedLiveMessage` input에서 `attractionCount` 제거. Task 3의 PlaceSearch가 이 시그니처를 소비.

- [ ] **Step 1: 테스트 갱신(실패 선행)** — attraction 관련 기대를 제거·반전한다. attraction 인자를 넘기던 케이스 삭제, `"search.attractionCount"` part 기대 삭제. 3섹션 동작(건수 내림차순, place>web>address 동률 규칙, 폴백 판정)은 기존 기대 유지.
- [ ] **Step 2: 구현** — `SectionKind`에서 `"attraction"` 제거, `orderResultSections` 4번째 인자·unshift 블록 제거, `combinedLiveMessage`에서 `attractionCount` input·`attraction` part 제거. 파일 상단·함수 주석의 명소 문구 제거.
- [ ] **Step 3: `npm run test:run` green — 커밋**

```bash
git commit -m "refactor(search): 섹션 순서·통지에서 명소 트랙 제거 (명소 섹션 통합 폐지)" -- src/lib/search-sections.ts src/lib/__tests__/search-sections.test.ts
```

---

### Task 3: 웹 UI 명소 섹션 제거 + 클라 재정렬 제거 + i18n 정리

**Files:**
- Modify: `src/components/PlaceSearch.tsx`
- Modify: `src/app/[locale]/page.tsx` (`canSearchAttractions` prop 제거)
- Modify: `messages/{ko,en,es,fr,it}.json` (`search.attractionSection`·`search.attractionCount` 제거 — `category.attraction`은 유지)
- Modify: `src/lib/geo.ts` (웹 사용처 소멸 후 `sortPlacesByDistance` 삭제 — 다른 사용처 grep 확인 후)

**Interfaces:**
- Consumes: Task 1 서버 주석(distanceMeters), Task 2 시그니처.

- [ ] **Step 1: PlaceSearch.tsx 제거 목록 적용**
  - props: `canSearchAttractions` 제거(주석 포함).
  - state·ref: `attractionStatus`·`attractionReqIdRef` 제거.
  - `performAttractionSearch` 함수 제거. `runQuerySearch`의 `canAttraction` 분기·`performAttractionSearch` 병렬 항목 제거(Promise.all은 장소·주소 2원소로).
  - 포커스 settled effect: `attractionSettled` 절·deps의 `attractionStatus.kind` 제거.
  - `loading`·`liveParts`·`headingParts`·카운트 계산에서 attraction 항목 제거(`combinedLiveMessage` 새 시그니처).
  - `orderResultSections` 호출 3인자로. `sectionOrder.map`의 `attraction` 분기·`attractionSectionBody` 제거.
  - 결과 컨테이너 조건에서 `attractionStatus.kind === "done"` 제거.
  - **클라 재정렬 제거**: `const places = userCoords ? sortPlacesByDistance(rawPlaces, userCoords) : rawPlaces;` → `const places = rawPlaces;`로 단순화(서버가 이미 distanceMeters 주석). `sortPlacesByDistance`·(불용 시) `PlaceCard` import 정리. 주석 갱신: "거리순 재정렬은 정확도순 전환으로 폐기(스펙 2026-07-20), distanceMeters는 서버 주석."
- [ ] **Step 2: page.tsx에서 `canSearchAttractions` 전달부 제거** (계산식 `hasKakaoKey() || hasTourApiKey()` 포함)
- [ ] **Step 3: i18n 5개 로케일에서 `search.attractionSection`·`search.attractionCount` 제거** — ⚠ `category.attraction`(칩 라벨)·`ios.*` barrier-free 문구는 보존. iOS 키 `ios.search.attractionSection`도 제거(웹 messages가 정본 — Task 6에서 xcstrings 재생성).
- [ ] **Step 4: `sortPlacesByDistance` 잔여 사용처 grep** — `grep -rn "sortPlacesByDistance" src/`가 0건이면 geo.ts에서 함수·관련 테스트 삭제(주석의 "정렬" 언급 정리). 잔여 있으면 유지하고 커밋 메시지에 명기.
- [ ] **Step 5: `npm run test:run`(i18n parity 포함) green — 커밋**

```bash
git commit -m "feat(search): 명소 섹션 제거·클라 거리 재정렬 폐기 — 칩 필터가 검색 장소 전체를 커버" -- src/components/PlaceSearch.tsx "src/app/[locale]/page.tsx" messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json src/lib/geo.ts src/lib/__tests__/geo.test.ts
```

---

### Task 4: 명소 라우트·provider 삭제

**Files:**
- Delete: `src/app/api/places/attractions/route.ts`, `src/lib/providers/attractions.ts`, `src/lib/providers/kakao-attractions.ts`
- Modify: `src/lib/providers/tour-api.ts` — `ATTRACTION_CONTENT_TYPE_ID`·`ATTRACTION_CAP`·`buildTourAttractionUrl`·`extractTourAttractions`·`searchAttractionsTourApi`와 이제 불용이 된 `haversineMeters` import 제거(`searchPlacesTourApi`·`normalizeTourItem`은 유지)
- Delete/Modify: 위 삭제 대상의 테스트 파일(`__tests__`에서 attractions·kakao-attractions·tour-api 명소 함수 테스트)

- [ ] **Step 1: 파일 삭제·tour-api 명소 함수 제거**
- [ ] **Step 2: 잔여 참조 0 확인** — `grep -rn "attractions\|searchAttractions" src/`가 스펙·주석 외 코드 참조 0건(章 category.attraction 제외)
- [ ] **Step 3: `npm run test:run` + `npm run lint` + `npm run build` green — 커밋**

```bash
git rm src/app/api/places/attractions/route.ts src/lib/providers/attractions.ts src/lib/providers/kakao-attractions.ts <관련 테스트>
git commit -m "refactor(search): 명소 전용 라우트·provider 삭제 (정확도순이 랜드마크 부상을 대체)" -- <삭제·수정 경로들>
```

---

### Task 5: CLI·MCP 명소 제거 + 버전 bump

**Files:**
- Modify: `packages/cli/src/lib/endpoint-catalog-shared.ts`·`packages/mcp/src/endpoint-catalog-shared.ts` (両미러 `attractions-search` 항목 제거 — 동일 diff)
- Modify: `packages/cli/src/commands/search.ts` (attractionsPromise·attractions 섹션 출력·웹 폴백 조건의 attractions 제거)
- Modify: `packages/cli/src/lib/formatters.ts:556` (`"attractions-search": formatPlaces,` 행 제거)
- Modify: `packages/cli/src/__tests__/command-tree.test.ts`·`formatters.test.ts` (attractions 기대 제거)
- Modify: `packages/cli/package.json`·`packages/mcp/package.json` — version `0.1.0` → `0.2.0` (breaking-soft, 동조 bump)

- [ ] **Step 1: search.ts 정리** — `attractionsPromise` 선언·allSettled 3번째 항목·`attractions` 변수·명소 출력 블록(`if (attractions.length)`) 제거, `allFailed`는 `settled.every(...)`(2원소)로, 웹 폴백 조건 `!places.length && !addresses.length`로.
- [ ] **Step 2: 카탈로그 両미러·포매터·테스트에서 attractions-search 제거**
- [ ] **Step 3: 버전 両 0.2.0 동조** — 릴리스 태그는 Task 7에서(프로덕션 배포 후).
- [ ] **Step 4: packages 테스트·drift 테스트 green(`npm run test:run` 루트 포함 여부 확인, packages 자체 테스트 러너 실행) — 커밋**

```bash
git commit -m "feat(cli,mcp)!: attractions-search 엔드포인트 제거, v0.2.0 (명소 섹션 통합 폐지)" -- packages/cli packages/mcp
```

---

### Task 6: iOS 동조 — 명소 트랙 제거 + 좌표 전달 전환

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/SearchService.swift` — `SearchOutcome.attractions` 필드·init 파라미터·attractionsTask 제거
- Modify: `ios/Gildongmu/SearchModel.swift` — `submit()`이 `LocationService.shared.lastCoordinate`를 `service.search(lat:lng:)`로 전달, 사후 `sortPlacesByDistance` 재정렬 블록 제거, `totalCount`에서 attractions 제거
- Modify: `ios/Gildongmu/SearchView.swift` — 명소 Section·`attractionIDs` 파라미터(sectionView·placesSectionView)·`base` 필터·`firstRowID`의 attraction 분기 제거
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/SearchFilters.swift` — `sortPlacesByDistance` 사용처 소멸 시 삭제(+테스트)
- Modify: GildongmuKit 테스트(`SearchServiceTests`·`SearchModelsTests`의 attractions fixture)·`ios/i18n/*`에 attraction 키 있으면 제거
- Run: `node ios/scripts/messages-to-xcstrings.mjs` + `node ios/scripts/check-xcstrings-keys.mjs`

**Interfaces:**
- Consumes: 서버 distanceMeters 주석(Task 1) — iOS `Place.distanceMeters` decode 기존 지원.

- [ ] **Step 1: SearchService — attractions 트랙 제거**

```swift
public struct SearchOutcome: Sendable {
    public let places: SectionState<Place>
    public let addresses: SectionState<JusoAddress>
    public let web: SectionState<WebSearchResult>
    public init(
        places: SectionState<Place>,
        addresses: SectionState<JusoAddress>,
        web: SectionState<WebSearchResult>
    ) {
        self.places = places
        self.addresses = addresses
        self.web = web
    }
    public var allFailed: Bool { places.isFailed && addresses.isFailed }
    public var orderedSections: [SearchSection] {
        let all: [SearchSection] = [.places(places.items), .addresses(addresses.items), .web(web.items)]
        return all.filter { $0.count > 0 }.sorted { $0.count > $1.count }
    }
}
```

`search(query:lat:lng:lang:)`에서 attractionsTask·attractions 계산 제거, `SearchOutcome(places:addresses:web:)` 반환.

- [ ] **Step 2: SearchModel — 좌표 전달·재정렬 제거**

```swift
searchTask = Task {
    let coordinate = LocationService.shared.lastCoordinate
    let result = await service.search(
        query: trimmed,
        lat: coordinate?.lat,
        lng: coordinate?.lng,
        lang: AppLanguage.dataLocale
    )
    guard !Task.isCancelled else { return }
    // 정확도순 전환(웹 스펙 2026-07-20 미러): 좌표는 API로 보내 카카오 근접
    // 블렌딩에 쓰고, 클라 재정렬은 하지 않는다. distanceMeters는 서버 주석.
    outcome = result
    failed = result.allFailed && totalCount == 0
    isSearching = false
    resultsRevision += 1
    announce()
}
```

`totalCount`는 `outcome.orderedSections.reduce(0) { $0 + $1.count }`만.

- [ ] **Step 3: SearchView — 명소 섹션·attractionIDs 제거** — attraction Section 블록 삭제, `sectionView(_:)`·`placesSectionView(_:)` 시그니처에서 attractionIDs 제거·`base = places`로, `firstRowID`에서 attraction 분기 삭제(첫 섹션 첫 행 규칙만).
- [ ] **Step 4: Kit 정리** — `sortPlacesByDistance` 잔여 사용처 grep 후 함수·테스트 삭제, SearchServiceTests·fixture에서 attractions 제거. `ios.search.attractionSection` 키가 xcstrings·ios-extra에 있으면 제거 후 `node ios/scripts/messages-to-xcstrings.mjs && node ios/scripts/check-xcstrings-keys.mjs`.
- [ ] **Step 5: Kit 테스트 실행** — `cd ios/GildongmuKit && swift test` green.
- [ ] **Step 6: 앱 빌드 확인** — `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS' build` 또는 deploy 스크립트의 빌드 단계. green이면 커밋.

```bash
git commit -m "feat(ios): 검색 명소 트랙 제거·좌표 API 전달 전환 (웹 정확도순 스펙 미러)" -- ios/
```

---

### Task 7: 실호출 검증 + 문서 + 배포·릴리스

**Files:**
- Modify: `CLAUDE.md` (카탈로그 명소 행 제거·장소 행 정렬 정책 갱신·검색창 설명 갱신)
- Modify: `PROGRESS.md` (전환 기록·실호출 검증 로그)

- [ ] **Step 1: dev 서버 실호출 3종** — `npm run dev` 후:
  - `curl "localhost:3000/api/places?query=맥도날드&lat=37.535&lng=127.145"` → 첫 결과들이 강동구 지점(근접 편향), distanceMeters 주석 존재.
  - `curl "localhost:3000/api/places?query=경복궁&lat=37.535&lng=127.145"` → 경복궁 본체·부속이 상위(카테고리 "여행 > 관광,명소" — 그룹핑 시 최상단 확인).
  - `curl "localhost:3000/api/places?query=백년찌개집&lat=37.5222&lng=126.9242"` (여의도) → 네이버 보강 결과 생존(merged provider) + 중복 없음.
- [ ] **Step 2: CLAUDE.md·PROGRESS.md 갱신** — 카탈로그의 "관광지·명소" 행 삭제, "장소 검색" 행에 "정확도순+좌표 블렌딩(sort 미지정), 서버 annotateDistances 주석, 재정렬 금지" 반영. UI·상태 패턴 절의 "명소 4번째 병렬 섹션" 문구 제거. PROGRESS.md에 실호출 로그.
- [ ] **Step 3: 최종 게이트** — `npm run lint && npm run build && npm run test:run` green.
- [ ] **Step 4: 문서 커밋 + push(자동배포)** — 배포 후 프로덕션 실호출 1종(맥도날드)으로 확인.
- [ ] **Step 5: CLI/MCP 릴리스** — `git tag cli-v0.2.0 && git push origin main --tags` → Actions 발행 확인.
- [ ] **Step 6: iOS 실기기 배포** — 기기 연결 시 `ios/deploy-device.sh`.

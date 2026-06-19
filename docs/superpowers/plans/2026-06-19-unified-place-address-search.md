# 장소·주소 통합 단일 검색 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `SearchKindToggle`(장소/주소 모드 토글)를 제거하고, 단일 검색창에서 장소·주소를 병렬 검색해 적응형 결과 화면으로 합친다.

**Architecture:** 단일 검색창 제출 → `performSearch`(`/api/places`)와 `performAddressSearch`(`/api/address/search`, juso 키 있을 때만)를 병렬 발사. 결과 영역은 두 서브섹션(장소·주소)을 "결과 있는 섹션 위로" 적응형 순서로 렌더하고, 빈 섹션은 숨긴다. 순서·합산 통지 결정은 순수 함수(`src/lib/search-sections.ts`)로 뽑아 결정적 테스트한다. 두 흐름의 종착점(`openDetail(Place)`)은 동일하므로 하부 상세 흐름은 불변.

**Tech Stack:** Next.js 16, React 19, next-intl 4, Vitest 4 (node env, jsdom 없음), TypeScript.

## Global Constraints

- 테스트 프레임워크: Vitest. 명령 `npm run test:run`(전체), 단건은 `npx vitest run <path> -t "<name>"`.
- `src/lib/`는 React/Next 비의존 순수 로직만(이식성 — dodo-planet 수입 대비). `geo.ts`가 선례.
- 커밋 이메일 `engccer@gmail.com`(이미 repo 설정). 커밋 메시지 한국어, 변수/함수명 영어.
- 커밋 푸터: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01H686ZD819EDvhN1pSYvdUX`.
- 접근성: 단일 polite live region, assertive 미사용, 포커스 1회 이동. 터치 타깃 `min-h-11`. UI 라벨 이모지 금지.
- i18n: `messages/ko.json`·`messages/en.json` 항상 같은 키로 동시 수정. 누락 키는 런타임 경고.
- juso 키 게이트: `canSearchAddress`(=`hasJusoKey()`)가 false면 주소 호출·섹션·import 없이 순수 장소 검색(회귀 0).

---

### Task 1: 순수 로직 `search-sections.ts` — 섹션 순서 + 합산 통지

**Files:**
- Create: `src/lib/search-sections.ts`
- Test: `src/lib/__tests__/search-sections.test.ts`

**Interfaces:**
- Consumes: (없음 — 순수 함수, 표준 타입만)
- Produces:
  - `type SectionKind = "place" | "address"`
  - `orderResultSections(placeCount: number, addrCount: number): SectionKind[]` — 결과 0건 섹션 제외, 건수 내림차순, 동률 시 `"place"` 우선. 둘 다 0이면 `[]`.
  - `type LiveSpec = { key: string; values?: Record<string, number> }`
  - `combinedLiveMessage(input: { loading: boolean; placeCount: number | null; addrCount: number | null; spokenQuery: string | null }): LiveSpec | null` — 로딩/완료/음성 질의에 따라 어떤 i18n 키·인자를 쓸지 결정. `null`이면 통지 없음(idle). `placeCount`/`addrCount`가 `null`이면 "그 검색은 결과 없음/미실행"으로 간주(0과 동일 취급). 반환 키 값은 아래 매핑 표 그대로.

`combinedLiveMessage` 결정 표 (위에서부터 우선):
| 조건 | 반환 |
|---|---|
| `loading && spokenQuery` | `{ key: "search.searchingFor", values: { } }` ※ query는 문자열이라 컴포넌트가 직접 주입 → 아래 주: `values` 대신 `key`만 반환하고 컴포넌트가 spokenQuery를 t()에 넘김. 표현 단순화 위해 `combinedLiveMessage`는 **로딩 시 `{ key: spokenQuery ? "search.searchingFor" : "search.searching" }`** 반환(values 없음, 컴포넌트가 spokenQuery 주입) |
| `loading` (음성 아님) | `{ key: "search.searching" }` |
| `place>0 && addr>0` | `{ key: "search.combinedAnnouncement", values: { place, addr } }` |
| `place>0 && addr==0` | `{ key: "search.resultsAnnouncement", values: { count: place } }` |
| `place==0 && addr>0` | `{ key: "search.addressResultsAnnouncement", values: { count: addr } }` |
| `place==0 && addr==0` (둘 다 완료) | `{ key: "search.resultsAnnouncement", values: { count: 0 } }` |
| 그 외(완료 전 idle) | `null` |

> 주: "완료"는 `loading === false`. 호출부가 `placeCount`/`addrCount`에 done 상태의 카운트(없으면 null)를 넘기고, 아직 검색 전 idle이면 `loading=false, placeCount=null, addrCount=null` → 마지막 행에서 `null` 반환하도록, **둘 다 null이면 `null` 반환**을 가장 먼저 처리한다(아래 구현 참조).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, it, expect } from "vitest";
import { orderResultSections, combinedLiveMessage } from "../search-sections";

describe("orderResultSections", () => {
  it("장소만 있으면 place만", () => {
    expect(orderResultSections(5, 0)).toEqual(["place"]);
  });
  it("주소만 있으면 address만", () => {
    expect(orderResultSections(0, 3)).toEqual(["address"]);
  });
  it("둘 다 있으면 건수 많은 쪽 위", () => {
    expect(orderResultSections(2, 5)).toEqual(["address", "place"]);
    expect(orderResultSections(7, 1)).toEqual(["place", "address"]);
  });
  it("동률이면 장소 우선", () => {
    expect(orderResultSections(3, 3)).toEqual(["place", "address"]);
  });
  it("둘 다 0이면 빈 배열", () => {
    expect(orderResultSections(0, 0)).toEqual([]);
  });
});

describe("combinedLiveMessage", () => {
  const base = { loading: false, placeCount: null, addrCount: null, spokenQuery: null };
  it("idle(둘 다 null, 비로딩)이면 null", () => {
    expect(combinedLiveMessage(base)).toBeNull();
  });
  it("로딩이면 searching", () => {
    expect(combinedLiveMessage({ ...base, loading: true })).toEqual({
      key: "search.searching",
    });
  });
  it("로딩 + 음성질의면 searchingFor", () => {
    expect(
      combinedLiveMessage({ ...base, loading: true, spokenQuery: "강남 맛집" }),
    ).toEqual({ key: "search.searchingFor" });
  });
  it("장소만 완료면 resultsAnnouncement", () => {
    expect(combinedLiveMessage({ ...base, placeCount: 5, addrCount: 0 })).toEqual({
      key: "search.resultsAnnouncement",
      values: { count: 5 },
    });
  });
  it("주소만 완료면 addressResultsAnnouncement", () => {
    expect(combinedLiveMessage({ ...base, placeCount: 0, addrCount: 3 })).toEqual({
      key: "search.addressResultsAnnouncement",
      values: { count: 3 },
    });
  });
  it("둘 다 완료면 combinedAnnouncement", () => {
    expect(combinedLiveMessage({ ...base, placeCount: 2, addrCount: 4 })).toEqual({
      key: "search.combinedAnnouncement",
      values: { place: 2, addr: 4 },
    });
  });
  it("둘 다 0건 완료면 결과 0건", () => {
    expect(combinedLiveMessage({ ...base, placeCount: 0, addrCount: 0 })).toEqual({
      key: "search.resultsAnnouncement",
      values: { count: 0 },
    });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/search-sections.test.ts`
Expected: FAIL — "Cannot find module '../search-sections'" 또는 함수 미정의.

- [ ] **Step 3: 최소 구현 작성**

```ts
/**
 * 통합 검색 결과의 섹션 순서·합산 통지 결정 (deterministic — React/Next 비의존).
 *
 * 장소(POI)와 juso 주소를 단일 검색창에서 병렬 검색한 뒤, 어떤 섹션을 어떤
 * 순서로 보일지와 스크린 리더에 무엇을 통지할지는 같은 입력에 같은 정답이
 * 보장되는 deterministic 작업이라 코드로 잠그고 테스트로 검증한다(I/O와 분리).
 */
export type SectionKind = "place" | "address";

/**
 * 결과 있는 섹션을 위로(적응형). 0건 섹션은 제외, 건수 내림차순, 동률 시 장소 우선.
 * 둘 다 0이면 빈 배열(호출부가 "결과 없음" 처리).
 */
export function orderResultSections(
  placeCount: number,
  addrCount: number,
): SectionKind[] {
  const sections: SectionKind[] = [];
  if (placeCount > 0) sections.push("place");
  if (addrCount > 0) sections.push("address");
  if (sections.length < 2) return sections;
  // 둘 다 있음 — 건수 내림차순, 동률(place≥addr)이면 place 우선 유지.
  return placeCount >= addrCount ? ["place", "address"] : ["address", "place"];
}

export type LiveSpec = { key: string; values?: Record<string, number> };

/**
 * 단일 polite 채널 통지 결정. loading이면 검색 중(음성이면 searchingFor),
 * 완료면 양쪽 카운트로 합산/단일 통지를 고른다. 검색 전 idle(둘 다 null·비로딩)은
 * null(통지 없음). count가 null인 검색은 0으로 간주(미실행/결과 없음).
 */
export function combinedLiveMessage(input: {
  loading: boolean;
  placeCount: number | null;
  addrCount: number | null;
  spokenQuery: string | null;
}): LiveSpec | null {
  const { loading, placeCount, addrCount, spokenQuery } = input;
  if (loading) {
    return { key: spokenQuery ? "search.searchingFor" : "search.searching" };
  }
  // 비로딩 + 둘 다 미실행 = idle
  if (placeCount === null && addrCount === null) return null;
  const place = placeCount ?? 0;
  const addr = addrCount ?? 0;
  if (place > 0 && addr > 0) {
    return { key: "search.combinedAnnouncement", values: { place, addr } };
  }
  if (addr > 0) {
    return { key: "search.addressResultsAnnouncement", values: { count: addr } };
  }
  // 주소 0 — 장소 통지(0건 포함)
  return { key: "search.resultsAnnouncement", values: { count: place } };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/search-sections.test.ts`
Expected: PASS (13 테스트).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/search-sections.ts src/lib/__tests__/search-sections.test.ts
git commit -m "feat(search): 통합 검색 순서·합산 통지 순수 로직(orderResultSections·combinedLiveMessage)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01H686ZD819EDvhN1pSYvdUX"
```

---

### Task 2: i18n 키 정리 (토글 제거 + 섹션/합산 추가)

**Files:**
- Modify: `messages/ko.json:23-29` (search.kind, addressLabel, addressPlaceholder 제거 + 신규 키 추가)
- Modify: `messages/en.json:23-29` (동형)

**Interfaces:**
- Consumes: Task 1의 키 이름(`search.placeSection`·`search.addressSection`·`search.combinedAnnouncement`)
- Produces: 컴포넌트(Task 3)가 쓸 i18n 키. 제거 키: `search.kind.*`, `search.addressLabel`, `search.addressPlaceholder`.

- [ ] **Step 1: ko.json 수정**

`messages/ko.json`의 `"search"` 블록에서 `"kind": { ... }`(라인 23-27)와 `"addressLabel"`, `"addressPlaceholder"`(라인 28-29)를 삭제하고, 그 자리에 아래 3개 키를 추가한다. 최종 `search` 블록의 주소 관련 부분은 이렇게 된다(`searching`~`mockNotice`는 유지):

```json
    "placeSection": "장소",
    "addressSection": "주소",
    "combinedAnnouncement": "장소 {place}건, 주소 {addr}건",
    "addressSearching": "주소 검색 중…",
    "addressResultsAnnouncement": "주소 검색 결과 {count}건",
    "addressNoResults": "해당 주소를 찾지 못했습니다. 다시 입력해 보세요.",
    "addressError": "주소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    "addressCoordFailed": "이 주소의 좌표를 찾지 못해 상세를 열 수 없습니다."
```

즉 `"mockNotice": "..."` 다음 줄에 `placeSection`/`addressSection`/`combinedAnnouncement`를 넣고, `kind`/`addressLabel`/`addressPlaceholder`를 지운다.

- [ ] **Step 2: en.json 수정 (동형)**

`messages/en.json`의 같은 위치에서 `kind`/`addressLabel`/`addressPlaceholder`를 지우고 추가:

```json
    "placeSection": "Places",
    "addressSection": "Addresses",
    "combinedAnnouncement": "{place} places, {addr} addresses found",
```

(`addressSearching`~`addressCoordFailed`는 유지.)

- [ ] **Step 3: JSON 유효성 + 키 대칭 확인**

Run:
```bash
node -e "const ko=require('./messages/ko.json'),en=require('./messages/en.json'); const k=Object.keys(ko.search).sort().join(','),e=Object.keys(en.search).sort().join(','); console.log(k===e?'OK keys match':'MISMATCH\nko:'+k+'\nen:'+e); console.log('kind gone:', !ko.search.kind && !en.search.kind);"
```
Expected: `OK keys match` 와 `kind gone: true`.

- [ ] **Step 4: 커밋**

```bash
git add messages/ko.json messages/en.json
git commit -m "i18n(search): 검색 종류 토글 키 제거 + 섹션 헤딩·합산 통지 키 추가

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01H686ZD819EDvhN1pSYvdUX"
```

---

### Task 3: PlaceSearch 통합 — 토글 제거·병렬 발사·적응형 결과

**Files:**
- Modify: `src/components/PlaceSearch.tsx` (모드 분기 전체 제거, 병렬 호출, 적응형 렌더)
- Delete: `src/components/SearchKindToggle.tsx`

**Interfaces:**
- Consumes: `orderResultSections`·`combinedLiveMessage`·`LiveSpec` (Task 1), 신규 i18n 키 (Task 2). 기존 `performAddressSearch`·`onSelectAddress`·`AddressResultList`·`addrStatus` 상태머신 재사용.
- Produces: (UI 동작 — 후속 태스크 의존 없음)

설계 핵심:
1. `searchKind`/`setSearchKind`/`searchKindRef` 상태와 `SearchKindToggle` import·렌더 제거. `addrQuery` 상태 제거(단일 `query` 사용).
2. `runSearch`가 장소·주소 병렬 발사. `handleTranscribed`도 동일.
3. 렌더: 모드 분기(`searchKind === "place" ? ... : ...`) 제거. 단일 `SearchBar` + 단일 live region(`combinedLiveMessage`) + 적응형 결과 영역.
4. 포커스: 두 호출이 모두 settled된 뒤 1회 이동.

- [ ] **Step 1: import·상태 정리**

`src/components/PlaceSearch.tsx` 상단에서 `SearchKindToggle` import(라인 21) 삭제. `AddressResultList` import는 유지. Task 1 함수 import 추가:

```ts
import { orderResultSections, combinedLiveMessage } from "@/lib/search-sections";
```

상태 변경: `searchKind`/`setSearchKind`(라인 95), `addrQuery`/`setAddrQuery`(라인 96), `searchKindRef`·그 effect(라인 133-136) 제거. `addrStatus`/`setAddrStatus`/`addrReqIdRef`/`addrResolveRef`/`addrHeadingRef`/`addrStatusRef`·그 effect는 유지(주소 흐름 본체).

- [ ] **Step 2: 병렬 발사로 runSearch·performAddressSearch 연결**

`runSearch`를 장소·주소 병렬 발사로 교체. `performAddressSearch`는 시그니처 유지하되 호출 조건만 `canSearchAddress`로 가드:

```ts
function runSearch() {
  if (status.kind === "loading") return;
  setSpokenQuery(null);
  void performSearch(query);
  if (canSearchAddress) void performAddressSearch(query);
}
```

`handleTranscribed`도 병렬화:

```ts
function handleTranscribed(text: string) {
  setSpokenQuery(text);
  setQuery(text);
  void performSearch(text);
  if (canSearchAddress) void performAddressSearch(text);
}
```

`runAddressSearch` 함수(라인 265-268)는 더 이상 쓰지 않으므로 제거.

- [ ] **Step 3: 단일 포커스 이동으로 정리 — performSearch/performAddressSearch의 개별 포커스 제거**

`performSearch` 내부의 `requestAnimationFrame(() => resultsHeadingRef.current?.focus())`(라인 225)와 `performAddressSearch` 내부의 `requestAnimationFrame(() => addrHeadingRef.current?.focus())`(라인 258)를 **삭제**한다(개별 포커스 점프 방지). 대신 "둘 다 settled" 전이에서 한 번만 포커스를 옮기는 effect를 추가한다. `resultsHeadingRef`를 결과 영역 최상단 단일 헤딩에 붙일 것이므로(Step 5), 그 헤딩으로 이동:

```ts
// 장소·주소가 모두 정착(neither loading)한 뒤 결과 헤딩으로 1회 포커스 이동.
// juso 키 없으면 주소 검색을 안 하므로 장소 settled만으로 판정한다. 검색이 한 번도
// 일어나지 않은 idle에서는 옮기지 않는다(둘 다 idle).
const focusedForSearchRef = useRef(false);
useEffect(() => {
  const placeSettled = status.kind === "done" || status.kind === "error";
  const addrSettled =
    !canSearchAddress ||
    addrStatus.kind === "done" ||
    addrStatus.kind === "error";
  const anyStarted =
    status.kind !== "idle" ||
    (canSearchAddress && addrStatus.kind !== "idle");
  if (placeSettled && addrSettled && anyStarted) {
    if (!focusedForSearchRef.current) {
      focusedForSearchRef.current = true;
      requestAnimationFrame(() => resultsHeadingRef.current?.focus());
    }
  } else if (status.kind === "loading" || addrStatus.kind === "loading") {
    // 새 검색이 시작되면 다음 settled에서 다시 포커스하도록 리셋.
    focusedForSearchRef.current = false;
  }
}, [status.kind, addrStatus.kind, canSearchAddress]);
```

- [ ] **Step 4: 단일 live message로 통합**

기존 `liveMessage`(라인 329-340)와 `addrLiveMessage`(라인 342-353)를 제거하고, `combinedLiveMessage`로 단일화한다. coordError는 별도 시점이라 우선 처리:

```ts
const placeCount = status.kind === "done" ? status.result.places.length : null;
const addrCount =
  addrStatus.kind === "done" ? addrStatus.addresses.length : null;
const loading = status.kind === "loading" || addrStatus.kind === "loading";
// coordError(주소 선택 후 좌표 실패)는 검색 완료 통지와 시점이 달라 우선 노출.
const liveSpec: { key: string; values?: Record<string, number> } | null =
  addrStatus.kind === "coordError"
    ? { key: "search.addressCoordFailed" }
    : combinedLiveMessage({ loading, placeCount, addrCount, spokenQuery });
const liveMessage = liveSpec
  ? liveSpec.key === "search.searchingFor"
    ? t(liveSpec.key, { query: spokenQuery ?? "" })
    : t(liveSpec.key, liveSpec.values ?? {})
  : "";
```

> 주: `search.addressCoordFailed`는 인자 없는 메시지라 `liveSpec.values` 미사용으로 안전. `searchingFor`만 문자열 인자(`query`)를 컴포넌트에서 주입한다.

- [ ] **Step 5: 렌더 — 모드 분기 제거, 적응형 결과 영역**

라인 396-539의 `return (...)`를 아래로 교체한다. `SearchKindToggle`·모드 삼항을 없애고, 단일 SearchBar + 적응형 두 섹션으로 만든다. 장소 섹션 본체(칩+ResultList)와 주소 섹션 본체(AddressResultList)를 각각 함수/JSX로 두고, `orderResultSections`로 순서를 정한다.

```tsx
return (
  <section aria-label={t("search.label")}>
    {isMockMode && (
      <p
        role="note"
        className="mb-4 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
      >
        {t("search.mockNotice")}
      </p>
    )}

    <SearchBar
      query={query}
      onQueryChange={setQuery}
      onSubmit={runSearch}
      busy={status.kind === "loading"}
      onTranscribed={handleTranscribed}
    />

    <p aria-live="polite" role="status" className="mt-3 min-h-6 text-sm">
      {liveMessage}
    </p>

    {/* 검색 전 첫 화면 진입점 — 내 주변 5종(키 게이트). idle일 때만. */}
    {canShowSubway && status.kind === "idle" && (
      <div className="mt-4">
        <SubwayArrivalsNearby />
      </div>
    )}
    {canShowBus && status.kind === "idle" && (
      <div className="mt-4">
        <BusArrivals mode="current" />
      </div>
    )}
    {canShowBike && status.kind === "idle" && (
      <div className="mt-4">
        <BikeStations mode="current" />
      </div>
    )}
    {canShowClinic && status.kind === "idle" && (
      <div className="mt-4">
        <NightClinicsNearby />
      </div>
    )}
    {canShowKids && status.kind === "idle" && (
      <div className="mt-4">
        <KidsPlacesNearby />
      </div>
    )}

    {(status.kind === "done" || addrStatus.kind === "done") && (
      <div className="mt-4">
        <h2
          ref={resultsHeadingRef}
          tabIndex={-1}
          className="text-xl font-semibold"
        >
          {resultsHeading}
        </h2>
        {sectionOrder.length === 0 ? (
          <p className="mt-2">{t("search.noResults")}</p>
        ) : (
          sectionOrder.map((kind) =>
            kind === "place" ? (
              <section key="place" className="mt-4">
                {showSectionHeadings && (
                  <h3 className="text-lg font-semibold">
                    {t("search.placeSection")}
                  </h3>
                )}
                {placeSectionBody}
              </section>
            ) : (
              <section key="address" className="mt-4">
                {showSectionHeadings && (
                  <h3 className="text-lg font-semibold">
                    {t("search.addressSection")}
                  </h3>
                )}
                {addressSectionBody}
              </section>
            ),
          )
        )}
      </div>
    )}
  </section>
);
```

그리고 위 `return` **직전**에 파생값·섹션 본체를 계산한다(기존 `places`/`bucketItems`/`groups` 계산 블록 라인 371-394 바로 다음에 둔다):

```tsx
// 두 섹션 카운트(미완료는 0으로 — 적응형 순서/헤딩 판정용).
const placeResultCount = status.kind === "done" ? places.length : 0;
const addrResultCount =
  addrStatus.kind === "done" ? addrStatus.addresses.length : 0;
const sectionOrder = orderResultSections(placeResultCount, addrResultCount);
// 두 섹션이 모두 렌더될 때만 구분 헤딩(단일 섹션은 오늘처럼 헤딩 없이).
const showSectionHeadings = sectionOrder.length === 2;

// 결과 영역 최상단 헤딩 텍스트 — 합산 통지와 동일 규칙.
const headingSpec = combinedLiveMessage({
  loading: false,
  placeCount: status.kind === "done" ? places.length : null,
  addrCount: addrStatus.kind === "done" ? addrStatus.addresses.length : null,
  spokenQuery: null,
});
const resultsHeading = headingSpec
  ? t(headingSpec.key, headingSpec.values ?? {})
  : t("search.resultsAnnouncement", { count: 0 });

// 장소 섹션 본체(기존 칩 + ResultList). places 0이면 sectionOrder가 제외하므로
// 여기 도달 시 places>0 가정.
const placeSectionBody = (
  <>
    <div className="mt-3 flex flex-col gap-2">
      <ChipFilter
        groupLabel={t("category.filterLabel")}
        allLabel={t("category.all")}
        items={bucketItems}
        selected={bucket}
        onSelect={setBucket}
      />
      <ChipFilter
        groupLabel={t("region.filterLabel")}
        allLabel={t("region.all")}
        items={regionItems}
        selected={region}
        onSelect={setRegion}
      />
    </div>
    {filtered.length === 0 ? (
      <p className="mt-3">{t("search.noFilterResults")}</p>
    ) : (
      <ResultList groups={groups} onOpen={openDetail} />
    )}
  </>
);

// 주소 섹션 본체. addrStatus.done && length>0일 때만 sectionOrder에 포함.
const addressSectionBody = (
  <AddressResultList
    addresses={addrStatus.kind === "done" ? addrStatus.addresses : []}
    onSelect={onSelectAddress}
  />
);
```

`addrHeadingRef`는 더 이상 별도 헤딩에 안 붙으므로, popstate 핸들러(라인 152-168)에서 `addrHeadingRef` 분기를 `resultsHeadingRef`로 통일한다:

```ts
useEffect(() => {
  function onPop() {
    setSelected(null);
    focusResultsHeadingIfDone();
  }
  window.addEventListener("popstate", onPop);
  return () => window.removeEventListener("popstate", onPop);
}, []);
```

그리고 `focusResultsHeadingIfDone`을 장소·주소 어느 쪽이든 결과가 있으면 동작하도록 수정:

```ts
function focusResultsHeadingIfDone() {
  const hasResults =
    statusRef.current.kind === "done" || addrStatusRef.current.kind === "done";
  if (!hasResults) return;
  requestAnimationFrame(() => resultsHeadingRef.current?.focus());
}
```

이제 미사용이 된 `addrHeadingRef`·`searchKindRef`(이미 Step 1에서 제거)와 그 effect를 정리한다. `addrHeadingRef` 선언(라인 108)과 그 useEffect 미러가 없으면 `addrStatusRef`만 유지(popstate에서 읽음). `addrHeadingRef` declaration을 삭제하라.

- [ ] **Step 6: 빌드·린트·타입 확인**

Run: `npm run lint && npm run build`
Expected: 린트 통과, 빌드 성공. (미사용 변수 경고 0 — 제거 누락 시 여기서 잡힘.)

- [ ] **Step 7: SearchKindToggle 삭제 + 잔존 참조 확인**

```bash
git rm src/components/SearchKindToggle.tsx
grep -rn "SearchKindToggle\|searchKind\|addrQuery\|addressLabel\|addressPlaceholder\|search.kind" src messages
```
Expected: grep 출력 없음(완전 제거).

- [ ] **Step 8: 전체 테스트**

Run: `npm run test:run`
Expected: 전부 PASS(기존 + Task 1 신규). 실패 시 토글 제거로 깨진 테스트가 있으면 갱신.

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "feat(search): 장소·주소 통합 단일 검색(토글 제거→병렬+적응형 결과)

- SearchKindToggle 모드 분기 제거, 단일 검색창에서 장소·juso 주소 병렬 호출
- 결과 있는 섹션을 위로(orderResultSections), 빈 섹션 숨김, 동률 장소 우선
- 단일 섹션은 헤딩 없이, 둘 다일 때만 h3 구분
- 단일 polite 통지(combinedLiveMessage) + 둘 다 settled 후 1회 포커스 이동
- coordError는 별도 시점이라 통지 경합 없음

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01H686ZD819EDvhN1pSYvdUX"
```

---

### Task 4: 실호출 수동 검증 + a11y 점검 + 문서 갱신

**Files:**
- Modify: `CLAUDE.md` (C2-b 아키텍처 항목을 "토글 모드"→"통합 단일 검색"으로 갱신)
- 검증만: dev 서버 실호출

**Interfaces:**
- Consumes: Task 3 완성 UI
- Produces: (없음 — 검증·문서)

- [ ] **Step 1: dev 서버 기동**

Run: `npm run dev` (백그라운드). `http://localhost:3000/ko` 접속.

- [ ] **Step 2: 장소-only 회귀 확인**

"경복궁" 검색 → 장소 섹션만, "장소"/"주소" 구분 헤딩 **없음**(오늘과 동일), 칩·결과 정상. 콘솔 에러 0.

- [ ] **Step 3: 주소-only 확인**

"세종대로 110" 검색 → 주소 섹션만 상단, juso 도로명·우편번호 표시. 항목 선택 → 좌표 변환 → 상세 진입 정상. (juso 키 필요 — `.env.local`에 `JUSO_CONFM_KEY` 있어야 함.)

- [ ] **Step 4: 합산 통지·포커스 확인**

가능하면 장소·주소 둘 다 잡히는 질의로 두 섹션 동시 노출 + `h3` 구분 확인. live region이 "장소 N건, 주소 M건" 1회 통지, 포커스가 결과 헤딩으로 1회 이동(중간 점프 없음)하는지 확인. VoiceOver(macOS)로 헤딩 내비 점검.

- [ ] **Step 5: juso 키 없는 회귀(게이트) 확인**

`.env.local`에서 `JUSO_CONFM_KEY`를 잠시 비우고 dev 재기동 → 주소 호출·섹션 없이 순수 장소 검색만(회귀 0). 확인 후 키 복원.

- [ ] **Step 6: a11y-auditor 서브에이전트 점검**

`a11y-auditor` 서브에이전트로 `PlaceSearch.tsx` 변경분 점검(과잉 ARIA·포커스·헤딩 구조). 지적은 미니멀 접근성 기준으로 취사.

- [ ] **Step 7: CLAUDE.md 갱신**

`CLAUDE.md`의 C2-b 항목(주소·우편번호 검색)에서 "`PlaceSearch`에 검색 종류 토글(장소/주소, `fieldset` 라디오)을 두고…" 부분을 통합 설계로 교체한다. 핵심 문장:

> **주소·우편번호 검색** (C2-b, `juso-address.ts`의 `searchJusoAddresses` + `/api/address/search` + `AddressResultList`): 카카오 POI 검색과 **보완**(POI=상호, juso=도로명/지번/우편번호 주소). **단일 검색창에서 장소·주소를 병렬 검색**(2026-06-19 토글 제거)해 결과 화면에 두 섹션으로 합치고, **결과 있는 섹션을 위로**(`orderResultSections`, 빈 섹션 숨김·동률 장소 우선), 단일 섹션은 헤딩 없이·둘 다일 때만 `h3` 구분한다. 통지는 단일 polite 채널 합산(`combinedLiveMessage` — "장소 N건, 주소 M건"), 포커스는 둘 다 settled 후 1회. `canSearchAddress`(`hasJusoKey()`) 게이트로 키 없으면 주소 호출·섹션 미노출(死기능 방지). 항목 선택 → 카카오 지오코딩(limit=1) → `jusoAddressToPlace` → `openDetail`. 순수 로직(`orderResultSections`·`combinedLiveMessage`·`normalizeJusoResults`·`jusoAddressToPlace`) fixture 테스트. 설계 `docs/superpowers/specs/2026-06-19-unified-place-address-search-design.md`.

(과잉 ARIA 정리 항목의 토글 언급이 있으면 함께 정리.)

- [ ] **Step 8: AGENTS.md 동기화 + 커밋**

```bash
cd /Users/hunyongkim/Mac-Projects && python sync_agent_docs.py && cd gildongmu
git add CLAUDE.md ../AGENTS.md AGENTS.md 2>/dev/null; git add -A
git commit -m "docs(search): 장소·주소 통합 단일 검색 반영(토글 제거→병렬+적응형)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01H686ZD819EDvhN1pSYvdUX"
```

---

## 자기 검토 결과

**Spec coverage:** 스펙의 모든 결정이 태스크에 매핑됨 — 병렬 호출(T3), 적응형 순서·빈 섹션(T1·T3), 단일/이중 섹션 헤딩(T1·T3), 합산 통지·단일 포커스(T1·T3), 부분 실패 분리(T3 Step 4), i18n 정리(T2), 순수 로직 테스트(T1), 실호출 검증(T4), CLAUDE.md 갱신(T4).

**Placeholder scan:** "적절히 처리"류 없음 — 모든 코드 블록 실코드, 명령에 기대 출력 명시.

**Type consistency:** `orderResultSections(placeCount, addrCount): SectionKind[]`·`combinedLiveMessage(input): LiveSpec | null` 시그니처가 T1 정의와 T3 사용에서 일치. `LiveSpec.key`/`values` 구조 일관. `addrStatus`/`status` 판별 union 키(`done`/`loading`/`error`/`coordError`/`idle`)는 기존 정의 그대로 사용.

# 최근 목록 고정 (Recent Pinning) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 최근 목록 4종(검색어·출발지·도착지·경로)의 항목별 고정/고정 해제 — 고정 항목은 상단 유지, 라벨 접미사 "고정됨", VoiceOver 로터 접근(웹+iOS 공통).

**Architecture:** 각 항목에 `pinned` 플래그 내장. 저장 배열 불변식 = [고정 블록(고정 시점 순)] + [비고정 최신순, cap 20]. 토글 직후 화면은 재정렬하지 않고(포커스 유실 방지) 다음 로드부터 정렬 반영. 정본 spec: `docs/superpowers/specs/2026-08-12-recent-pinning-design.md`.

**Tech Stack:** TypeScript(웹 store+React UI), Swift(GildongmuKit store+SwiftUI), Vitest, Swift Testing, messages→xcstrings 파이프라인.

**구현 방식 판정(자율성 헌장):** inline — store 계약이 UI 4곳 인터페이스를 선행 결정하고, 웹↔iOS 미러 동조가 같은 컨텍스트를 요구하며 수정 파일이 태스크 간 겹친다. 리뷰는 별도 컨텍스트 서브에이전트로 분리.

## Global Constraints

- 미러 유지: 웹 `src/lib/recent-searches.ts` ↔ iOS `RecentSearchStore.swift` 동작 동일(테스트 케이스 상호 이식).
- dedupe(`sameCoord`·`sameRoute`·검색어 완전 일치)는 `pinned`를 보지 않는다.
- cap 20은 비고정 블록에만. 모두 지우기는 비고정만 삭제. 개별 삭제는 고정 무관.
- 라벨: `joinText(라벨, "고정됨")` 단일 텍스트(쉼표 구분). 별도 헤딩·섹션 신설 금지.
- 액션 순서: 고정 토글이 삭제보다 **앞**(iOS 선언 순서·웹 DOM 순서).
- 토글 직후 화면 내 재정렬 금지. iOS는 갱신된 항목 값으로 포커스 재확정(라벨이 상태 신호, 별도 통지 없음). 웹은 polite 통지("고정됨"/"고정 해제됨").
- `#if EXPERIMENTAL` 게이트 없음(배포판·실험판 공통).
- i18n `recent` 네임스페이스 7키 × 6로케일(ko/en/es/fr/it/ja): `pin`·`unpin`·`pinItem`·`unpinItem`·`pinned`·`unpinned`·`clearedExceptPinned`. 웹 항목별 버튼 접근명은 `pinItem`/`unpinItem`(동명 버튼 구분 — deleteItem 관례). iOS swipe 액션은 행 문맥이 있어 `pin`/`unpin`만.
- 모두 지우기 후 고정 항목이 남으면 통지는 `clearedExceptPinned`(기존 `cleared`는 결과가 빈 경우만 — "모두 지웠습니다"가 거짓이 되면 안 된다), 포커스는 이동하지 않는다(버튼·섹션이 남아 있다). 비면 기존 계약 유지(마이크 행/입력/조회 버튼).

---

### Task 1: 웹 store — pinned 모델·연산·v2 마이그레이션

**Files:**
- Modify: `src/lib/recent-searches.ts`
- Test: `src/lib/__tests__/recent-searches.test.ts`

**Interfaces (Produces):**
```ts
export type RecentQuery = { text: string; pinned?: boolean };
export type RecentEndpoint = { label: string; lat: number; lng: number; pinned?: boolean };
export type RecentRoute = { from: RecentEndpoint | null; to: RecentEndpoint | null; pinned?: boolean };
// 반환 배열은 항상 [고정 블록]+[비고정] 불변식 순서. pinned 부재 = false.
loadRecentQueries(): RecentQuery[]           // 키 v2, v1(string[]) 자동 승계
recordRecentQuery(raw: string): RecentQuery[]
removeRecentQuery(text: string): RecentQuery[]
clearRecentQueries(): RecentQuery[]          // 고정 보존, 남은 목록 반환
setRecentQueryPinned(text: string, pinned: boolean): RecentQuery[]
setRecentEndpointPinned(field, e: RecentEndpoint, pinned: boolean): RecentEndpoint[]
clearRecentEndpoints(field): RecentEndpoint[]   // 고정 보존
setRecentRoutePinned(route: RecentRoute, pinned: boolean): RecentRoute[]
clearRecentRoutes(): RecentRoute[]              // 고정 보존
```

- [ ] **Step 1: 실패하는 테스트부터.** `recent-searches.test.ts`의 검색어 케이스를 `RecentQuery` 모양으로 갱신하고 신규 케이스 추가(각 목록 대표 1벌씩 — 검색어는 전체, 장소·경로는 공통 코어 공유라 고정 정렬·clear 보존만):

```ts
// 헬퍼: 텍스트 배열 투영
const texts = (l: RecentQuery[]) => l.map((q) => q.text);

it("v1 문자열 배열을 v2로 승계한다", () => {
  storage.setItem("gildongmu:recent-queries:v1", JSON.stringify(["a", "b"]));
  expect(loadRecentQueries(storage)).toEqual([
    { text: "a", pinned: false },
    { text: "b", pinned: false },
  ]);
});

it("고정하면 고정 블록 맨 뒤로, 먼저 고정한 항목이 위를 지킨다", () => {
  recordRecentQuery("a", storage); recordRecentQuery("b", storage); recordRecentQuery("c", storage);
  setRecentQueryPinned("a", true, storage);           // [a(pin), c, b]
  const after = setRecentQueryPinned("b", true, storage); // [a(pin), b(pin), c]
  expect(texts(after)).toEqual(["a", "b", "c"]);
  expect(after.map((q) => q.pinned)).toEqual([true, true, false]);
});

it("고정 해제는 비고정 블록 맨 앞으로 온다", () => {
  recordRecentQuery("a", storage); recordRecentQuery("b", storage);
  setRecentQueryPinned("a", true, storage);           // [a(pin), b]
  const after = setRecentQueryPinned("a", false, storage);
  expect(after).toEqual([{ text: "a", pinned: false }, { text: "b", pinned: false }]);
});

it("고정 항목 재기록은 자리를 유지한다", () => {
  recordRecentQuery("a", storage); recordRecentQuery("b", storage);
  setRecentQueryPinned("a", true, storage);           // [a(pin), b]
  const after = recordRecentQuery("a", storage);      // 재사용해도 그대로
  expect(texts(after)).toEqual(["a", "b"]);
});

it("cap 20은 비고정에만 적용된다", () => {
  recordRecentQuery("keep", storage);
  setRecentQueryPinned("keep", true, storage);
  for (let i = 1; i <= 21; i++) recordRecentQuery(`q${i}`, storage);
  const list = loadRecentQueries(storage);
  expect(list).toHaveLength(21);                      // 고정 1 + 비고정 20
  expect(list[0]).toEqual({ text: "keep", pinned: true });
  expect(texts(list)).not.toContain("q1");
});

it("모두 지우기는 고정을 보존한다", () => {
  recordRecentQuery("a", storage); recordRecentQuery("b", storage);
  setRecentQueryPinned("a", true, storage);
  expect(clearRecentQueries(storage)).toEqual([{ text: "a", pinned: true }]);
});

it("장소: 고정 보존 clear와 고정 우선 정렬", () => {
  recordRecentEndpoint("to", ep("집", 37.5, 127.1), storage);
  recordRecentEndpoint("to", ep("회사", 37.6, 127.0), storage);
  setRecentEndpointPinned("to", ep("집", 37.5, 127.1), true, storage);
  expect(loadRecentEndpoints("to", storage).map((e) => e.label)).toEqual(["집", "회사"]);
  expect(clearRecentEndpoints("to", storage).map((e) => e.label)).toEqual(["집"]);
});

it("경로: 고정 후 재기록해도 상단 유지, clear 보존", () => {
  const r1 = { from: null, to: ep("집", 37.5, 127.1) };
  const r2 = { from: null, to: ep("회사", 37.6, 127.0) };
  recordRecentRoute(r1, storage); recordRecentRoute(r2, storage);
  setRecentRoutePinned(r1, true, storage);
  recordRecentRoute(r2, storage);                     // r2 재기록 — r1이 여전히 위
  expect(loadRecentRoutes(storage)[0].to?.label).toBe("집");
  expect(clearRecentRoutes(storage)).toHaveLength(1);
});
```
(기존 케이스 중 `loadRecentQueries()`가 `string[]`을 기대하는 단언은 전부 `RecentQuery[]`로 갱신. `ep(label, lat, lng)`는 파일 내 기존/신규 헬퍼.)

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run src/lib/__tests__/recent-searches.test.ts` → FAIL(신규 export 부재).

- [ ] **Step 3: 구현.** `recent-searches.ts` 핵심 코어(공용, 세 목록이 공유):

```ts
const asPinned = (v: unknown) => v === true;

/** 불변식 정규화: [고정(저장 순서 유지)] + [비고정(저장 순서 유지)]. 레거시·수기 데이터 방어. */
function partitionPinned<T extends { pinned?: boolean }>(items: T[]): T[] {
  return [...items.filter((x) => asPinned(x.pinned)), ...items.filter((x) => !asPinned(x.pinned))];
}

/** 재기록: 고정 항목과 같으면 자리 유지(항목만 최신본으로 교체 — 장소 라벨 갱신), 아니면
 *  비고정 dup 제거 후 고정 블록 바로 뒤 삽입, 비고정만 cap. */
function appendKeepingPins<T extends { pinned?: boolean }>(
  items: T[], item: T, isSame: (a: T, b: T) => boolean,
): T[] {
  const pinnedIdx = items.findIndex((x) => asPinned(x.pinned) && isSame(x, item));
  if (pinnedIdx >= 0) {
    const next = [...items];
    next[pinnedIdx] = { ...item, pinned: true };
    return next;
  }
  const pins = items.filter((x) => asPinned(x.pinned));
  const rest = items.filter((x) => !asPinned(x.pinned) && !isSame(x, item));
  return [...pins, ...[{ ...item, pinned: false }, ...rest].slice(0, RECENT_CAP)];
}

/** 고정 토글: 두 경우 모두 물리 위치는 경계(고정 블록 끝 == 비고정 블록 앞)로 이동. */
function setPinnedIn<T extends { pinned?: boolean }>(
  items: T[], item: T, pinned: boolean, isSame: (a: T, b: T) => boolean,
): T[] {
  const idx = items.findIndex((x) => isSame(x, item));
  if (idx < 0) return items;
  const rest = items.filter((_, i) => i !== idx);
  return [
    ...rest.filter((x) => asPinned(x.pinned)),
    { ...items[idx], pinned },
    ...rest.filter((x) => !asPinned(x.pinned)),
  ];
}

const keepPins = <T extends { pinned?: boolean }>(items: T[]) =>
  items.filter((x) => asPinned(x.pinned));
```

적용:
- 검색어: `QUERIES_KEY_V2 = "gildongmu:recent-queries:v2"`, `loadRecentQueries`는 v2 우선, 비어 있으면 v1 `string[]`을 `{text, pinned:false}`로 승계(v1 미삭제). validator `isQueryItem`(text string + pinned optional boolean). load 후 `partitionPinned`. `recordRecentQuery`/`removeRecentQuery`/`clearRecentQueries`/`setRecentQueryPinned`는 위 코어 경유, 저장은 v2에만.
- 장소·경로: 기존 키 유지. validator에 `pinned` optional 허용(기존 검사에 `(v.pinned === undefined || typeof v.pinned === "boolean")` 추가). `appendRecent` 호출부를 `appendKeepingPins`로 교체, `clear*`는 `keepPins` 저장 후 반환, `setRecent*Pinned` 신설. load 후 `partitionPinned`.
- `sameEndpoint`/`sameRoute`/검색어 비교는 그대로(pinned 무시 자동 성립).

- [ ] **Step 4: 테스트 통과 확인** — `npx vitest run src/lib/__tests__/recent-searches.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add src/lib/recent-searches.ts src/lib/__tests__/recent-searches.test.ts && git commit -m "feat(recent): 웹 store 고정(pin) 모델 — 정렬 불변식·cap 면제·검색어 v2 승계" -- <두 파일>`

---

### Task 2: i18n 7키 × 6로케일 + iOS xcstrings 재생성

**Files:**
- Modify: `messages/{ko,en,es,fr,it,ja}.json` (`recent` 네임스페이스)
- Regenerate: `node ios/scripts/messages-to-xcstrings.mjs all`

- [ ] **Step 1: 키 추가.** 각 로케일 `recent`에:

| 키 | ko | en | es | fr | it | ja |
|---|---|---|---|---|---|---|
| pin | 고정 | Pin | Fijar | Épingler | Fissa | 固定 |
| unpin | 고정 해제 | Unpin | Dejar de fijar | Désépingler | Sblocca | 固定を解除 |
| pinItem | {name} 고정 | Pin {name} | Fijar {name} | Épingler {name} | Fissa {name} | {name}を固定 |
| unpinItem | {name} 고정 해제 | Unpin {name} | Dejar de fijar {name} | Désépingler {name} | Sblocca {name} | {name}の固定を解除 |
| pinned | 고정됨 | Pinned | Fijado | Épinglé | Fissato | 固定済み |
| unpinned | 고정 해제됨 | Unpinned | Ya no está fijado | Désépinglé | Sbloccato | 固定を解除しました |
| clearedExceptPinned | 고정 항목을 제외하고 모두 지웠습니다 | Cleared all except pinned items | Se borró todo excepto los elementos fijados | Tout est effacé sauf les éléments épinglés | Cancellato tutto tranne gli elementi fissati | 固定した項目以外をすべて削除しました |

- [ ] **Step 2: 게이트 확인** — `npx vitest run src/i18n/__tests__/i18n-messages.test.ts`(경로는 실제 파일명 확인) PASS.
- [ ] **Step 3: xcstrings 재생성** — `node ios/scripts/messages-to-xcstrings.mjs all` 실행, `node ios/scripts/check-xcstrings-keys.mjs` 통과.
- [ ] **Step 4: Commit** — messages 6파일 + 생성된 xcstrings.

---

### Task 3: 웹 UI — PlaceSearch(검색어) + DirectionsView(장소·경로)

**Files:**
- Modify: `src/components/PlaceSearch.tsx`, `src/components/DirectionsView.tsx`
- Test: `src/components/__tests__/DirectionsView.test.tsx`(최근 관련 기존 단언 갱신 + 신규)

**Interfaces (Consumes):** Task 1의 store API. `joinText`는 `src/lib/format.ts`.

공통 행 패턴(세 목록 동일 — 항목 버튼 라벨은 `pinned ? joinText(라벨, t("recent.pinned")) : 라벨`, 고정 버튼은 삭제 버튼 **앞**):

```tsx
<button type="button"
  aria-label={t(item.pinned ? "recent.unpinItem" : "recent.pinItem", { name: 라벨 })}
  onClick={() => togglePin(item)}
  className="min-h-11 rounded-md border border-border px-3 text-sm">
  {t(item.pinned ? "recent.unpin" : "recent.pin")}
</button>
```

토글 핸들러 계약(즉시 재정렬 금지 — 로컬 상태는 참조 동일성 in-place 교체, 저장만 store):

```tsx
function togglePin(q: RecentQuery) {
  const pinned = !q.pinned;
  setRecentQueryPinned(q.text, pinned);                       // 저장(정렬은 다음 로드부터)
  setRecentQueries((prev) => prev.map((x) => (x === q ? { ...x, pinned } : x)));
  setRecentNotice(t(pinned ? "recent.pinned" : "recent.unpinned"));
}
```

- [ ] **Step 1: PlaceSearch.tsx** — `recentQueries` 타입 `RecentQuery[]`로: 사용처 갱신(`key={q.text}`, 활성화 `setQuery(q.text)`, `deleteRecent(q.text, i)`), 행에 고정 버튼 삽입(삭제 앞), 라벨 접미사, `togglePin`. `clearRecent`:

```tsx
function clearRecent() {
  const kept = clearRecentQueries();
  setRecentQueries(kept);
  setRecentNotice(t(kept.length > 0 ? "recent.clearedExceptPinned" : "recent.cleared"));
}
```

- [ ] **Step 2: DirectionsView.tsx** — ① EndpointField: props에 `onTogglePinRecent(e: RecentEndpoint, pinned: boolean)` 추가, 행 렌더에 고정 버튼(삭제 앞)+라벨 접미사, 토글 시 `announce(tRecent(pinned ? "pinned" : "unpinned"))`. 부모(from/to 두 곳):

```tsx
onTogglePinRecent={(e, pinned) => {
  setRecentEndpointPinned("from", e, pinned);
  setRecentFrom((prev) => prev.map((x) => (x === e ? { ...x, pinned } : x)));
}}
```
② 최근 경로 섹션: 동일 패턴(`setRecentRoutePinned`, `setRecentRoutes` in-place, 라벨 = `joinText(routeItemLabel(r), tRecent("pinned"))`). ③ `clearRoutes`/EndpointField `clearRecent`: 남으면 `clearedExceptPinned` 통지 + 포커스 이동 없음, 비면 기존 계약(입력/기존 동작) 유지.

- [ ] **Step 3: 컴포넌트 테스트** — `DirectionsView.test.tsx` 기존 최근 단언 갱신 + 신규 2건: (a) 한 행 안 버튼 순서 = [활성화, 고정, 삭제](DOM 순서 단언), (b) 고정 토글 후 항목 접근명에 "고정됨" 접미사 + 화면 순서 불변. jsdom localStorage 함정 주의([[vitest-jsdom-lacks-localstorage]] — 스텁 말고 진짜 구현 연결, 기존 테스트 셋업 재사용).

- [ ] **Step 4: 게이트** — `npx vitest run src/components/__tests__/DirectionsView.test.tsx src/lib/__tests__/recent-searches.test.ts` PASS → `npm run lint`.

- [ ] **Step 5: Commit.**

---

### Task 4: iOS store — RecentSearchStore pinned

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RecentSearchStore.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/RecentSearchStoreTests.swift`

**Interfaces (Produces):**
```swift
public struct RecentQuery: Codable, Equatable, Hashable, Sendable { public let text: String; public let pinned: Bool }
// RecentEndpoint/RecentRoute에 public let pinned: Bool (init 기본값 false, decodeIfPresent ?? false)
queries() -> [RecentQuery]                            // v2 + v1 승계 + 방어 파티션
recordQuery(_ raw: String) -> [RecentQuery]
removeQuery(_ text: String) -> [RecentQuery]
clearQueries() -> [RecentQuery]                       // 고정 보존
setQueryPinned(_ text: String, pinned: Bool) -> [RecentQuery]
setEndpointPinned(_ e: RecentEndpoint, scope:, pinned: Bool) -> [RecentEndpoint]
setRoutePinned(_ route: RecentRoute, pinned: Bool) -> [RecentRoute]
clearEndpoints/clearRoutes → 고정 보존 + @discardableResult 목록 반환
```

- [ ] **Step 1: 실패 테스트.** 웹 Task 1 케이스를 그대로 이식(파일 관례 유지 — 기존 검색어 단언은 `.map(\.text)` 투영으로 갱신). 마이그레이션 케이스:

```swift
@Test func migratesV1Strings() throws {
    let defaults = freshDefaults("migrate")
    defaults.set(try JSONEncoder().encode(["a", "b"]), forKey: "recentQueries.v1")
    let store = RecentSearchStore(defaults: defaults)
    #expect(store.queries() == [RecentQuery(text: "a", pinned: false), RecentQuery(text: "b", pinned: false)])
}
@Test func legacyEndpointDataDecodesUnpinned() throws {
    let defaults = freshDefaults("legacy-ep")
    let raw = #"[{"label":"집","lat":37.5,"lng":127.1}]"#      // pinned 필드 없는 기존 데이터
    defaults.set(Data(raw.utf8), forKey: "recentEndpoints.to.v1")
    let store = RecentSearchStore(defaults: defaults)
    #expect(store.endpoints(.to) == [RecentEndpoint(label: "집", lat: 37.5, lng: 127.1)])
}
```

- [ ] **Step 2: 실행해 실패 확인** — `cd ios/GildongmuKit && swift test --filter RecentSearchStoreTests`(빌드 에러 = 실패로 간주).

- [ ] **Step 3: 구현.** 웹 코어 미러(제네릭 + 클로저):

```swift
/// 재기록: 고정 동일 항목은 자리 유지(최신본으로 교체 — 장소 라벨 갱신), 아니면
/// 비고정 dup 제거 후 고정 블록 바로 뒤 삽입, 비고정만 cap(웹 appendKeepingPins 미러).
static func appendKeepingPins<T>(
    _ item: T, to items: [T],
    isSame: (T, T) -> Bool, isPinned: (T) -> Bool, pinnedCopy: (T) -> T
) -> [T] {
    if let i = items.firstIndex(where: { isPinned($0) && isSame($0, item) }) {
        var out = items; out[i] = pinnedCopy(item); return out
    }
    let pins = items.filter(isPinned)
    let rest = items.filter { !isPinned($0) && !isSame($0, item) }
    return pins + Array(([item] + rest).prefix(cap))
}

/// 고정 토글: 어느 방향이든 물리 위치는 두 블록의 경계(웹 setPinnedIn 미러).
static func setPinnedIn<T>(
    _ item: T, in items: [T], isSame: (T, T) -> Bool, isPinned: (T) -> Bool, updated: (T) -> T
) -> [T] {
    guard let idx = items.firstIndex(where: { isSame($0, item) }) else { return items }
    var rest = items; rest.remove(at: idx)
    return rest.filter(isPinned) + [updated(items[idx])] + rest.filter { !isPinned($0) }
}
```

- `RecentQuery` 신설, `queriesKey v2 = "recentQueries.v2"`, `queries()`: v2 decode → 비어 있으면 v1 `[String]` decode를 `RecentQuery(text:pinned:false)`로 승계(v1 미삭제) → 방어 파티션(`filter(isPinned) + filter(!isPinned)`).
- `RecentEndpoint`·`RecentRoute`: `pinned` 추가(init 파라미터 기본값 false — 기존 호출부 무변경), 커스텀 `init(from:)`에서 `decodeIfPresent(Bool.self, forKey: .pinned) ?? false`. ⚠ 커스텀 디코딩을 넣으면 인코딩은 합성 유지(CodingKeys에 pinned 포함).
- `recordQuery`/`recordEndpoint`/`recordRoute` → `appendKeepingPins`(pinnedCopy: 새 값에 pinned=true). `clear*` → 고정만 저장·반환. `set*Pinned` 신설. `remove*`는 기존 필터 유지(검색어만 시그니처 `removeQuery(_ text: String)`).

- [ ] **Step 4: 테스트 통과** — `swift test --filter RecentSearchStoreTests` PASS.
- [ ] **Step 5: Commit.**

---

### Task 5: iOS UI — SearchView·DirectionsEndpointSearchView·DirectionsTabView

**Files:**
- Modify: `ios/Gildongmu/SearchView.swift`, `ios/Gildongmu/Directions/DirectionsEndpointSearchView.swift`, `ios/Gildongmu/Directions/DirectionsTabView.swift`

**Interfaces (Consumes):** Task 4 store API, `joinText`(`ios/Gildongmu/Nearby/NearbyLoadState.swift` — 앱 타깃 전역), Task 2 키.

세 목록 공통 행 패턴(swipeActions 선언: 고정 토글 → 삭제 순. full swipe = 고정 토글이 되는 것은 수용 — 비파괴·가역):

```swift
Button(rowLabel(item)) { /* 기존 활성화 */ }
    .accessibilityFocused($focusedX, equals: item)
    .swipeActions {
        Button(appLocalized(item.pinned ? "recent.unpin" : "recent.pin")) { togglePin(item) }
        Button(appLocalized("recent.delete"), role: .destructive) { deleteRecent(item) }
    }
// rowLabel: item.pinned ? joinText(기존라벨, appLocalized("recent.pinned")) : 기존라벨
```

토글 계약(화면 재정렬 금지 + 포커스 재확정 = 새 라벨 낭독이 상태 신호):

```swift
private func togglePin(_ query: RecentQuery) {
    guard let index = recentQueries.firstIndex(of: query) else { return }
    let updated = RecentQuery(text: query.text, pinned: !query.pinned)
    recentQueries[index] = updated               // 화면 자리 유지 — 정렬은 다음 로드부터
    recentStore.setQueryPinned(query.text, pinned: updated.pinned)
    focusedRecentQuery = updated                 // 값이 달라져 no-op 아님(스펙 §4)
}
```

- [ ] **Step 1: SearchView.swift** — `recentQueries: [RecentQuery]`, `focusedRecentQuery: RecentQuery?`. 활성화 `model.query = query.text`. `deleteRecent(_ query: RecentQuery)`: `firstIndex(of:)`·`removeQuery(query.text)`. `applyRowFocus`의 `focusedRecentQuery = nil` 그대로. `clearRecent()`:

```swift
private func clearRecent() {
    recentQueries = recentStore.clearQueries()
    if recentQueries.isEmpty {
        AccessibilityNotification.Announcement(appLocalized("recent.cleared")).post()
        micRowFocused = true                      // 섹션 소멸 — 기존 계약
    } else {
        AccessibilityNotification.Announcement(appLocalized("recent.clearedExceptPinned")).post()
        // 섹션·버튼이 남아 있으므로 포커스 무이동
    }
}
```

- [ ] **Step 2: DirectionsEndpointSearchView.swift** — 동일 패턴(`togglePin(_ endpoint: RecentEndpoint)`은 `RecentEndpoint(label:lat:lng:pinned:)` 재조립 + `setEndpointPinned`, `focusedRecent = updated`). clear도 Step 1과 동일 분기(빈 경우 기존 포커스 계약 유지).

- [ ] **Step 3: DirectionsTabView.swift** — 모델에 추가:

```swift
func setRoutePinned(_ route: RecentRoute, pinned: Bool) {
    // 화면 자리 유지 계약: 배열 재정렬 없이 그 항목만 교체(정렬은 store가 저장분에만)
    guard let index = recentRoutes.firstIndex(of: route) else { return }
    recentStore.setRoutePinned(route, pinned: pinned)
    recentRoutes[index] = RecentRoute(from: route.from, to: route.to, pinned: pinned)
}
```
뷰: 행 라벨 `route.pinned ? joinText(recentRouteLabel(route), appLocalized("recent.pinned")) : recentRouteLabel(route)`, swipeActions 고정→삭제 순, `togglePin`은 `model.setRoutePinned` 후 `focusedRecentRoute = RecentRoute(from:to:pinned:)` 재확정. `clearRecentRoutes()`: 남으면 `recent.clearedExceptPinned`(.high 유지 — 활성화 응답 관례) + `submitFocused` 미설정, 비면 기존(`recentRoutes.cleared` + `submitFocused = true`).
⚠ 모델 `recordRecentRoute`·`removeRecentRoute`·`clearRecentRoutes`는 store 반환값 재대입으로 갱신(clear가 목록을 반환하도록 바뀜).

- [ ] **Step 4: 빌드+Kit 테스트** — `cd ios/GildongmuKit && swift test` 전체 PASS, 앱 빌드는 `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS Simulator' build` 급 확인(관례 명령 사용).
- [ ] **Step 5: Commit.**

---

### Task 6: 게이트·리뷰·마무리

- [ ] `npm run test:run` 전체 + `npm run lint` + `npm run build`(Vitest green ≠ 타입 통과 — build 필수).
- [ ] `a11y-auditor` 서브에이전트 점검(a11y 변경 규칙) + `code-reviewer` 서브에이전트(spec+diff만 전달, 세션 히스토리 금지).
- [ ] 리뷰 fix 반영 → 문서 분배: CHANGELOG 항목(2~4줄+spec 링크), spec §7 실기기 검증 항목 유지, BACKLOG 변경 없음.
- [ ] commit+push(자동 배포). 실기기 배포 전 병렬 세션 확인([[parallel-sessions-device-deploy-coordination]]) 후 `./ios/deploy-device.sh`(공식판) — 실험판 반영은 `CONFIGURATION=Experimental ./ios/deploy-device.sh`.
- [ ] 위원장 실기기 검증 요청: 로터 액션 순서(고정이 삭제보다 위인가), 토글 후 새 라벨 낭독 여부.

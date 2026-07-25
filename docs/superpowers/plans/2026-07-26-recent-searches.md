# 최근 검색 기록 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검색 탭 검색창과 길찾기 출발지/도착지 검색창에 최근 검색 기록(검색어/장소 이원)을 노출하고, 전체 삭제 + 항목별 삭제(iOS 로터, 웹 버튼)를 제공한다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-07-26-recent-searches-design.md` 정본. 저장 로직은 양 플랫폼 모두 React/뷰 비의존 순수 모듈(웹 `src/lib/recent-searches.ts`, iOS Kit `RecentSearchStore.swift`)에 두고 단위 테스트를 동반한다. 뷰 배선은 기존 화면 4곳(웹 PlaceSearch·DirectionsView/EndpointField, iOS SearchView·DirectionsEndpointSearchView)+기록 지점(iOS DirectionsModel).

**Tech Stack:** Next.js 16 + Vitest 4(node env) / SwiftUI + swift-testing / next-intl 5로케일 + messages→xcstrings 결정론 변환.

## Global Constraints

- 최대 **20개**, 최신순, dedupe 끌어올림(검색어=trim 후 완전 일치, 장소=좌표 소수 4자리 일치 시 최신 라벨로 교체).
- 저장은 기기 로컬 전용: iOS `UserDefaults` 키 `recentQueries.v1`/`recentEndpoints.v1`, 웹 `localStorage` 키 `gildongmu:recent-queries:v1`/`gildongmu:recent-endpoints:v1`.
- 파싱 실패·스키마 불일치·storage 접근 불가는 **빈 목록으로 조용히 복구**(throw 금지). 웹은 SSR 가드 필수.
- "현재 위치"는 기록하지 않는다. 기록 시점: 검색어=검색 제출 시(0건이어도), 장소=endpoint 확정 시(`.place`/`kind:"place"`만).
- 목록이 비면 섹션 자체 미노출. 한 줄=한 객체(항목 텍스트 단일, 인터랙티브는 별도 객체 정상).
- 삭제 후 포커스: 다음 항목 → (마지막이면) 이전 항목 → (목록 소멸) iOS=마이크 행, 웹=검색 input. 삭제 결과는 polite 통지 1건.
- 커밋 이메일 `engccer@gmail.com`, 주석·커밋 한국어, `git add -A` 금지(의도 파일만 pathspec 커밋).
- i18n: 신규 키는 `messages/*.json` 5로케일(ko/en/es/fr/it) 전부 동시 추가(`i18n-messages.test.ts` 게이트). iOS 카탈로그는 `node ios/scripts/messages-to-xcstrings.mjs all`로 재생성(수동 편집 금지).

---

### Task 1: 웹 저장 모듈 `recent-searches.ts` + 단위 테스트

**Files:**
- Create: `src/lib/recent-searches.ts`
- Test: `src/lib/__tests__/recent-searches.test.ts`

**Interfaces:**
- Produces (Task 3·4가 사용):
  - `type RecentEndpoint = { label: string; lat: number; lng: number }`
  - `RECENT_CAP = 20`
  - `loadRecentQueries(storage?) : string[]` / `recordRecentQuery(raw, storage?)` / `removeRecentQuery(q, storage?)` / `clearRecentQueries(storage?)` — 모두 갱신 후 목록 반환
  - `loadRecentEndpoints(storage?)` / `recordRecentEndpoint(e, storage?)` / `removeRecentEndpoint(e, storage?)` / `clearRecentEndpoints(storage?)` — 동형
  - `storage` 인자는 테스트 주입용(기본값: SSR 가드된 `window.localStorage`, 접근 불가 시 null → 빈 목록/no-op)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/lib/__tests__/recent-searches.test.ts
import { describe, it, expect } from "vitest";
import {
  RECENT_CAP,
  loadRecentQueries,
  recordRecentQuery,
  removeRecentQuery,
  clearRecentQueries,
  loadRecentEndpoints,
  recordRecentEndpoint,
  removeRecentEndpoint,
  clearRecentEndpoints,
  type RecentEndpoint,
} from "../recent-searches";

/** 인메모리 Storage 스텁(node env엔 localStorage가 없다 — 주입 경로 검증 겸용). */
function memStorage(seed?: Record<string, string>): Storage {
  const m = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
}

const QK = "gildongmu:recent-queries:v1";
const EK = "gildongmu:recent-endpoints:v1";

describe("recentQueries", () => {
  it("기록은 trim 후 맨 앞 삽입, 빈 문자열은 무시한다", () => {
    const s = memStorage();
    expect(recordRecentQuery("  경복궁  ", s)).toEqual(["경복궁"]);
    expect(recordRecentQuery("서울역", s)).toEqual(["서울역", "경복궁"]);
    expect(recordRecentQuery("   ", s)).toEqual(["서울역", "경복궁"]);
  });

  it("중복은 새로 만들지 않고 맨 위로 끌어올린다", () => {
    const s = memStorage();
    recordRecentQuery("a", s);
    recordRecentQuery("b", s);
    expect(recordRecentQuery("a", s)).toEqual(["a", "b"]);
  });

  it("20개 cap을 넘으면 가장 오래된 항목이 밀려난다", () => {
    const s = memStorage();
    for (let i = 1; i <= RECENT_CAP + 1; i++) recordRecentQuery(`q${i}`, s);
    const list = loadRecentQueries(s);
    expect(list).toHaveLength(RECENT_CAP);
    expect(list[0]).toBe(`q${RECENT_CAP + 1}`);
    expect(list).not.toContain("q1");
  });

  it("삭제·전체 삭제", () => {
    const s = memStorage();
    recordRecentQuery("a", s);
    recordRecentQuery("b", s);
    expect(removeRecentQuery("a", s)).toEqual(["b"]);
    expect(clearRecentQueries(s)).toEqual([]);
    expect(loadRecentQueries(s)).toEqual([]);
  });

  it("깨진 JSON·비배열·비문자열 요소는 빈 목록/필터로 조용히 복구한다", () => {
    expect(loadRecentQueries(memStorage({ [QK]: "{oops" }))).toEqual([]);
    expect(loadRecentQueries(memStorage({ [QK]: '{"a":1}' }))).toEqual([]);
    expect(loadRecentQueries(memStorage({ [QK]: '["ok", 3]' }))).toEqual(["ok"]);
  });

  it("storage가 없으면(SSR) 빈 목록·no-op", () => {
    expect(loadRecentQueries(null)).toEqual([]);
    expect(recordRecentQuery("a", null)).toEqual([]);
  });
});

describe("recentEndpoints", () => {
  const gyeongbok: RecentEndpoint = { label: "경복궁", lat: 37.579617, lng: 126.977041 };

  it("기록·cap·삭제·전체 삭제가 검색어와 동형으로 동작한다", () => {
    const s = memStorage();
    expect(recordRecentEndpoint(gyeongbok, s)).toEqual([gyeongbok]);
    for (let i = 1; i <= RECENT_CAP; i++)
      recordRecentEndpoint({ label: `p${i}`, lat: i, lng: i }, s);
    expect(loadRecentEndpoints(s)).toHaveLength(RECENT_CAP);
    expect(loadRecentEndpoints(s).some((e) => e.label === "경복궁")).toBe(false);
    const p1 = { label: "p1", lat: 1, lng: 1 };
    expect(removeRecentEndpoint(p1, s).some((e) => e.label === "p1")).toBe(false);
    expect(clearRecentEndpoints(s)).toEqual([]);
  });

  it("좌표 소수 4자리가 같으면 같은 장소 — 최신 라벨로 교체하며 끌어올린다", () => {
    const s = memStorage();
    recordRecentEndpoint(gyeongbok, s);
    recordRecentEndpoint({ label: "서울역", lat: 37.5547, lng: 126.9707 }, s);
    // 소수 5자리째만 다른 좌표(반올림 4자리 동일) + 라벨 변형
    const next = recordRecentEndpoint(
      { label: "경복궁 (고궁)", lat: 37.5796172, lng: 126.9770413 },
      s,
    );
    expect(next).toHaveLength(2);
    expect(next[0].label).toBe("경복궁 (고궁)");
  });

  it("스키마 불일치 요소는 걸러낸다", () => {
    const s = memStorage({ [EK]: '[{"label":"ok","lat":1,"lng":2},{"label":"bad"}]' });
    expect(loadRecentEndpoints(s)).toEqual([{ label: "ok", lat: 1, lng: 2 }]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- recent-searches`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```ts
// src/lib/recent-searches.ts
/**
 * 최근 검색 기록 저장(스펙 docs/superpowers/specs/2026-07-26-recent-searches-design.md).
 * 검색어(검색 탭)·장소(길찾기 endpoint) 이원 기록, 기기 로컬(localStorage) 전용.
 * React/Next 비의존(dodo 이식성). 파싱 실패·storage 접근 불가는 빈 목록으로 조용히
 * 복구한다(기록은 부가 기능 — 본 기능을 막지 않는다).
 */

export type RecentEndpoint = { label: string; lat: number; lng: number };

export const RECENT_CAP = 20;
const QUERIES_KEY = "gildongmu:recent-queries:v1";
const ENDPOINTS_KEY = "gildongmu:recent-endpoints:v1";

/** SSR·프라이버시 모드(접근 throw) 가드. 실패는 null → 모든 연산이 빈 목록/no-op. */
function defaultStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function load<T>(
  storage: Storage | null,
  key: string,
  isValid: (v: unknown) => v is T,
): T[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValid) : [];
  } catch {
    return [];
  }
}

function save<T>(storage: Storage | null, key: string, items: T[]): T[] {
  try {
    storage?.setItem(key, JSON.stringify(items));
  } catch {
    // quota 초과 등 — 기록 실패는 무시(메모리 상 목록은 반환돼 UI는 일관)
  }
  return items;
}

/** 순수 코어: 중복 제거 후 맨 앞 삽입, cap 절단(iOS RecentSearchStore.append 미러). */
function appendRecent<T>(items: T[], item: T, isSame: (a: T, b: T) => boolean): T[] {
  return [item, ...items.filter((x) => !isSame(x, item))].slice(0, RECENT_CAP);
}

// ── 검색어 ──────────────────────────────────────────────────────────

const isQuery = (v: unknown): v is string => typeof v === "string";

export function loadRecentQueries(storage: Storage | null = defaultStorage()): string[] {
  return load(storage, QUERIES_KEY, isQuery);
}

export function recordRecentQuery(
  raw: string,
  storage: Storage | null = defaultStorage(),
): string[] {
  const q = raw.trim();
  const items = loadRecentQueries(storage);
  if (!q) return items;
  return save(storage, QUERIES_KEY, appendRecent(items, q, (a, b) => a === b));
}

export function removeRecentQuery(
  q: string,
  storage: Storage | null = defaultStorage(),
): string[] {
  return save(
    storage,
    QUERIES_KEY,
    loadRecentQueries(storage).filter((x) => x !== q),
  );
}

export function clearRecentQueries(
  storage: Storage | null = defaultStorage(),
): string[] {
  return save(storage, QUERIES_KEY, []);
}

// ── 장소 (길찾기 endpoint) ──────────────────────────────────────────

const isEndpoint = (v: unknown): v is RecentEndpoint =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as RecentEndpoint).label === "string" &&
  typeof (v as RecentEndpoint).lat === "number" &&
  typeof (v as RecentEndpoint).lng === "number" &&
  Number.isFinite((v as RecentEndpoint).lat) &&
  Number.isFinite((v as RecentEndpoint).lng);

/** 좌표 소수 4자리(≈11m) 일치 = 같은 장소. 라벨 변형은 최신 라벨로 교체된다. */
export function sameEndpoint(a: RecentEndpoint, b: RecentEndpoint): boolean {
  return a.lat.toFixed(4) === b.lat.toFixed(4) && a.lng.toFixed(4) === b.lng.toFixed(4);
}

export function loadRecentEndpoints(
  storage: Storage | null = defaultStorage(),
): RecentEndpoint[] {
  return load(storage, ENDPOINTS_KEY, isEndpoint);
}

export function recordRecentEndpoint(
  e: RecentEndpoint,
  storage: Storage | null = defaultStorage(),
): RecentEndpoint[] {
  return save(
    storage,
    ENDPOINTS_KEY,
    appendRecent(loadRecentEndpoints(storage), e, sameEndpoint),
  );
}

export function removeRecentEndpoint(
  e: RecentEndpoint,
  storage: Storage | null = defaultStorage(),
): RecentEndpoint[] {
  return save(
    storage,
    ENDPOINTS_KEY,
    loadRecentEndpoints(storage).filter((x) => !sameEndpoint(x, e)),
  );
}

export function clearRecentEndpoints(
  storage: Storage | null = defaultStorage(),
): RecentEndpoint[] {
  return save(storage, ENDPOINTS_KEY, []);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- recent-searches`
Expected: PASS 전건

- [ ] **Step 5: 커밋**

```bash
git add src/lib/recent-searches.ts src/lib/__tests__/recent-searches.test.ts
git commit -m "feat(recent): 최근 검색 저장 모듈 — 검색어/장소 이원, cap 20, 조용한 복구" -- src/lib/recent-searches.ts src/lib/__tests__/recent-searches.test.ts
```

---

### Task 2: i18n 키 5로케일 + iOS 카탈로그 재생성

**Files:**
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json` (최상위 `recent` 네임스페이스 신설)
- Regenerate: `ios/Gildongmu/Resources/Localizable.xcstrings` (+ Kit 카탈로그는 무변경 — `recent`는 KIT_NAMESPACES에 없음)

**Interfaces:**
- Produces: 키 `recent.title` / `recent.clearAll` / `recent.delete` / `recent.deleteItem`(`{name}`) / `recent.deleted` / `recent.cleared`. 웹은 root 번역기 `t("recent.…")`, iOS는 `appLocalized("recent.…")`.

- [ ] **Step 1: 5로케일에 `recent` 네임스페이스 추가** (각 파일 최상위, 알파벳 위치 무관 — 기존 파일 순서 관례 유지, `privacy` 앞에 삽입)

ko.json:
```json
"recent": {
  "title": "최근 검색",
  "clearAll": "최근 검색 모두 지우기",
  "delete": "삭제",
  "deleteItem": "{name} 삭제",
  "deleted": "삭제했습니다",
  "cleared": "최근 검색을 모두 지웠습니다"
}
```

en.json:
```json
"recent": {
  "title": "Recent searches",
  "clearAll": "Clear all recent searches",
  "delete": "Delete",
  "deleteItem": "Delete {name}",
  "deleted": "Deleted",
  "cleared": "All recent searches cleared"
}
```

es.json:
```json
"recent": {
  "title": "Búsquedas recientes",
  "clearAll": "Borrar todas las búsquedas recientes",
  "delete": "Eliminar",
  "deleteItem": "Eliminar {name}",
  "deleted": "Eliminado",
  "cleared": "Se borraron todas las búsquedas recientes"
}
```

fr.json:
```json
"recent": {
  "title": "Recherches récentes",
  "clearAll": "Effacer toutes les recherches récentes",
  "delete": "Supprimer",
  "deleteItem": "Supprimer {name}",
  "deleted": "Supprimé",
  "cleared": "Toutes les recherches récentes ont été effacées"
}
```

it.json:
```json
"recent": {
  "title": "Ricerche recenti",
  "clearAll": "Cancella tutte le ricerche recenti",
  "delete": "Elimina",
  "deleteItem": "Elimina {name}",
  "deleted": "Eliminato",
  "cleared": "Tutte le ricerche recenti sono state cancellate"
}
```

- [ ] **Step 2: i18n 게이트 통과 확인**

Run: `npm run test:run -- i18n-messages`
Expected: PASS (5로케일 키 집합·플레이스홀더 일치)

- [ ] **Step 3: iOS 카탈로그 재생성 + 무손상 확인**

Run: `node ios/scripts/messages-to-xcstrings.mjs all && node ios/scripts/check-xcstrings-keys.mjs`
Expected: 앱 카탈로그에 `recent.*` 6키 추가, Kit 카탈로그 diff 없음, 키 린터 PASS

- [ ] **Step 4: 커밋**

```bash
git add messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json ios/Gildongmu/Resources/Localizable.xcstrings
git commit -m "feat(recent): i18n recent 네임스페이스 5로케일 + iOS 카탈로그 재생성" -- messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json ios/Gildongmu/Resources/Localizable.xcstrings
```

---

### Task 3: 웹 검색 탭 배선 (PlaceSearch)

**Files:**
- Modify: `src/components/PlaceSearch.tsx`

**Interfaces:**
- Consumes: Task 1의 `loadRecentQueries`/`recordRecentQuery`/`removeRecentQuery`/`clearRecentQueries`, Task 2의 `recent.*` 키.
- Produces: 없음(화면 배선 종점).

컴포넌트 배선은 node-env Vitest 레인이 없으므로(프로젝트 관례) lint+build+실브라우저 확인이 게이트다.

- [ ] **Step 1: 상태·로드·기록 추가**

```tsx
// import에 추가
import {
  clearRecentQueries,
  loadRecentQueries,
  recordRecentQuery,
  removeRecentQuery,
} from "@/lib/recent-searches";

// 상태 블록(spokenQuery 근처)에 추가:
// 최근 검색(스펙 2026-07-26). 초기값 []로 SSR/CSR 일치(hydration), 마운트 후 로드.
const [recentQueries, setRecentQueries] = useState<string[]>([]);
// 삭제·전체삭제 polite 통지(단일 live region 공유 — idle에서만 표시되므로 검색 통지와 경합 없음)
const [recentNotice, setRecentNotice] = useState("");
const recentDeleteRefs = useRef<(HTMLButtonElement | null)[]>([]);
// 삭제 후 포커스 복원: 렌더 반영 뒤 이동(rAF 금지 — useEffect+focus가 repo 정본 패턴)
const recentFocusIndexRef = useRef<number | null>(null);
const [recentRevision, setRecentRevision] = useState(0);

useEffect(() => {
  setRecentQueries(loadRecentQueries());
}, []);

useEffect(() => {
  const idx = recentFocusIndexRef.current;
  if (idx === null) return;
  recentFocusIndexRef.current = null;
  recentDeleteRefs.current[idx]?.focus();
}, [recentRevision]);
```

- [ ] **Step 2: runQuerySearch에 기록·통지 리셋 삽입** (`if (!raw.trim()) return;` 바로 다음 줄)

```tsx
// 검색 제출 = 기록 시점(0건이어도 기록 — 재시도 가치). 이전 삭제 통지는 리셋.
setRecentNotice("");
setRecentQueries(recordRecentQuery(raw));
```

- [ ] **Step 3: 삭제·전체 삭제 핸들러 추가** (runSearch 함수 근처)

```tsx
/** 항목 삭제(스펙 §5 포커스 계약): 다음 항목 → 이전 항목 → 목록 소멸 시 검색 input. */
function deleteRecent(q: string, index: number) {
  const next = removeRecentQuery(q);
  setRecentQueries(next);
  setRecentNotice(t("recent.deleted"));
  if (next.length === 0) {
    searchInputRef.current?.focus();
    return;
  }
  recentFocusIndexRef.current = Math.min(index, next.length - 1);
  setRecentRevision((r) => r + 1);
}

function clearRecent() {
  setRecentQueries(clearRecentQueries());
  setRecentNotice(t("recent.cleared"));
  searchInputRef.current?.focus();
}
```

주의: `searchInputRef`는 기존에 SearchBar로 넘기는 ref를 재사용한다(신규 생성 금지).

- [ ] **Step 4: liveMessage에 recentNotice 분기 추가**

기존 liveMessage 파생식(약 line 530, `combinedLiveMessage` 사용부)을 찾아 idle+notice 우선 분기를 앞에 둔다:

```tsx
const liveMessage =
  status.kind === "idle" && recentNotice
    ? recentNotice
    : /* 기존 파생식 그대로 */;
```

- [ ] **Step 5: 최근 검색 섹션 렌더** (길찾기 진입 버튼 `{canShowDirections && …}` 블록 바로 다음, WhereAmI 위)

```tsx
{/* 최근 검색(스펙 2026-07-26): 검색 전 초기 상태에만. 자동 등장 정적 목록이라
    heading이 발견 경로(h2 — 결과 헤딩과 동급). 목록 비면 섹션 자체 미노출. */}
{status.kind === "idle" && recentQueries.length > 0 && (
  <section className="mt-4">
    <h2 className="text-xl font-semibold">{t("recent.title")}</h2>
    <ul className="mt-2">
      {recentQueries.map((q, i) => (
        <li key={q} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSpokenQuery(null);
              setQuery(q);
              void runQuerySearch(q);
            }}
            className="min-h-11 flex-1 text-left text-sm underline"
          >
            {q}
          </button>
          {/* 시각 라벨은 "삭제", 접근 이름은 "{항목} 삭제"(동명 버튼 구분 — 정보 보강이라 덮기 아님) */}
          <button
            type="button"
            ref={(el) => {
              recentDeleteRefs.current[i] = el;
            }}
            aria-label={t("recent.deleteItem", { name: q })}
            onClick={() => deleteRecent(q, i)}
            className="min-h-11 rounded-md border border-border px-3 text-sm"
          >
            {t("recent.delete")}
          </button>
        </li>
      ))}
    </ul>
    <button
      type="button"
      onClick={clearRecent}
      className="mt-1 min-h-11 text-sm underline"
    >
      {t("recent.clearAll")}
    </button>
  </section>
)}
```

- [ ] **Step 6: 게이트 실행**

Run: `npm run lint && npm run test:run && npm run build`
Expected: 전부 PASS

- [ ] **Step 7: 커밋**

```bash
git add src/components/PlaceSearch.tsx
git commit -m "feat(recent): 검색 탭 최근 검색 섹션 — 재검색·항목 삭제·모두 지우기·포커스 계약" -- src/components/PlaceSearch.tsx
```

---

### Task 4: 웹 길찾기 배선 (DirectionsView / EndpointField) + 스펙 보완

**Files:**
- Modify: `src/components/DirectionsView.tsx`
- Modify: `docs/superpowers/specs/2026-07-26-recent-searches-design.md` (§4에 한 줄 추가)

**Interfaces:**
- Consumes: Task 1의 endpoint 계열 함수 + `RecentEndpoint`, Task 2의 `recent.*` 키.

배경: 웹 길찾기는 출발지·도착지 두 필드가 **한 화면에 동시에** 있어, 20건 목록을 두 필드에 그대로 자동 노출하면 조회 버튼·결과가 최대 40행 뒤로 밀린다(iOS는 필드당 전용 시트라 무해). 완충: **필드당 최신 5건만 표시**(저장은 20건 공유). 이 결정을 스펙 §4에 한 줄로 반영한다.

- [ ] **Step 1: 스펙 §4에 표시 건수 보완 추가** (길찾기 항목 아래)

```markdown
  - 웹 EndpointField는 **최신 5건만 표시**(저장은 20건 공유) — 두 필드 동시 노출로
    조회 버튼이 밀리는 노이즈 완충(iOS 시트는 전용 화면이라 전량 표시).
```

- [ ] **Step 2: DirectionsView에 공유 상태·기록 추가**

```tsx
// import에 추가
import {
  clearRecentEndpoints,
  loadRecentEndpoints,
  recordRecentEndpoint,
  removeRecentEndpoint,
  type RecentEndpoint,
} from "@/lib/recent-searches";

// DirectionsView 본문(notice 상태 근처)에 추가:
// 최근 장소(스펙 2026-07-26) — 출발지/도착지 공유 목록. 마운트 후 로드(SSR 가드).
const [recentEndpoints, setRecentEndpoints] = useState<RecentEndpoint[]>([]);
const tRecent = useTranslations("recent");
useEffect(() => {
  setRecentEndpoints(loadRecentEndpoints());
}, []);

// 프리필 도착지(장소 상세 "여기까지 길찾기")도 확정 경로와 동일하게 기록(마운트 1회).
// ?dir= 복원의 재기록은 dedupe 끌어올림이라 무해.
const recordedInitialRef = useRef(false);
useEffect(() => {
  if (recordedInitialRef.current) return;
  recordedInitialRef.current = true;
  if (initialTo?.kind === "place")
    setRecentEndpoints(
      recordRecentEndpoint({
        label: initialTo.label,
        lat: initialTo.coord.lat,
        lng: initialTo.coord.lng,
      }),
    );
}, [initialTo]);

/** endpoint 확정 공용 기록 지점(현재 위치 제외 — kind:"place"만). */
function recordResolved(ep: DirEndpoint) {
  if (ep.kind === "place")
    setRecentEndpoints(
      recordRecentEndpoint({ label: ep.label, lat: ep.coord.lat, lng: ep.coord.lng }),
    );
}
```

주의: `DirEndpoint`의 place 분기 형태는 이 파일 기존 코드(`{ kind: "place", label, coord: { lat, lng } }`) 기준. 다르면 기존 타입 정의를 따른다.

- [ ] **Step 3: 두 EndpointField 호출부에 props 연결**

기존 `onResolve` 콜백(출발지·도착지 각각) 안에서 `recordResolved(ep)`를 먼저 호출하고, 최근 목록 props를 넘긴다:

```tsx
<EndpointField
  … 기존 props 유지 …
  onResolve={(ep) => {
    recordResolved(ep);
    /* 기존 setFromField(…) 등 원래 로직 그대로 */
  }}
  recentEndpoints={recentEndpoints}
  onDeleteRecent={(e) => {
    setRecentEndpoints(removeRecentEndpoint(e));
    return loadRecentEndpoints();
  }}
  onClearRecent={() => setRecentEndpoints(clearRecentEndpoints())}
  tRecent={tRecent}
/>
```

`onDeleteRecent`는 갱신 목록을 반환하게 해 필드 내부 포커스 계산에 쓴다(아래 Step 4). 반환은 `removeRecentEndpoint`의 반환값을 그대로 써도 된다:

```tsx
onDeleteRecent={(e) => {
  const next = removeRecentEndpoint(e);
  setRecentEndpoints(next);
  return next;
}}
```

- [ ] **Step 4: EndpointField에 최근 장소 목록 렌더 + 삭제 포커스 계약**

EndpointField props에 추가:

```tsx
recentEndpoints: RecentEndpoint[];
onDeleteRecent: (e: RecentEndpoint) => RecentEndpoint[];
onClearRecent: () => void;
tRecent: ReturnType<typeof useTranslations<"recent">>;
```

본문에 추가(기존 `geocodeRef` 근처):

```tsx
// 필드당 최신 5건만(두 필드 동시 노출 노이즈 완충 — 스펙 §4). 저장·삭제는 20건 공유.
const visibleRecent = recentEndpoints.slice(0, 5);
const recentDeleteRefs = useRef<(HTMLButtonElement | null)[]>([]);
const recentFocusIndexRef = useRef<number | null>(null);
const [recentRevision, setRecentRevision] = useState(0);
useEffect(() => {
  const idx = recentFocusIndexRef.current;
  if (idx === null) return;
  recentFocusIndexRef.current = null;
  recentDeleteRefs.current[idx]?.focus();
}, [recentRevision]);

function deleteRecent(e: RecentEndpoint, index: number) {
  const next = onDeleteRecent(e);
  announce(tRecent("deleted"));
  const visibleCount = Math.min(next.length, 5);
  if (visibleCount === 0) {
    inputRef.current?.focus();
    return;
  }
  recentFocusIndexRef.current = Math.min(index, visibleCount - 1);
  setRecentRevision((r) => r + 1);
}

function clearRecent() {
  // 전체 삭제 버튼도 함께 사라진다 — 제거 전 입력으로 선점 이동(§5).
  inputRef.current?.focus();
  onClearRecent();
  announce(tRecent("cleared"));
}
```

렌더(후보 목록 `{candidates && …}` 블록 **아래**, 검색 전 상태에만):

```tsx
{/* 최근 장소(스펙 2026-07-26): 후보 검색 전 상태에만. 조용히 나타나는 목록이라
    heading이 발견 경로(h3 — 뷰 제목 h2 아래 관례). 선택은 확정 공용 경로 재사용. */}
{candidates === null && visibleRecent.length > 0 && (
  <section className="mt-2">
    <h3 className="text-sm font-semibold">{tRecent("title")}</h3>
    <ul className="mt-1">
      {visibleRecent.map((e, i) => (
        <li key={`${e.lat},${e.lng}`} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              resolveAndClose({
                kind: "place",
                label: e.label,
                coord: { lat: e.lat, lng: e.lng },
              })
            }
            className="min-h-11 flex-1 text-left text-sm underline"
          >
            {e.label}
          </button>
          <button
            type="button"
            ref={(el) => {
              recentDeleteRefs.current[i] = el;
            }}
            aria-label={tRecent("deleteItem", { name: e.label })}
            onClick={() => deleteRecent(e, i)}
            className="min-h-11 rounded-md border border-border px-3 text-sm"
          >
            {tRecent("delete")}
          </button>
        </li>
      ))}
    </ul>
    <button
      type="button"
      onClick={clearRecent}
      className="mt-1 min-h-11 text-sm underline"
    >
      {tRecent("clearAll")}
    </button>
  </section>
)}
```

주의: `resolveAndClose`가 후보·최근 공용 확정 경로이므로 DirectionsView의 `onResolve` 래퍼(Step 3)가 기록까지 담당 — EndpointField 안에서 별도 기록 금지(이중 기록).

- [ ] **Step 5: 게이트 실행**

Run: `npm run lint && npm run test:run && npm run build`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/components/DirectionsView.tsx docs/superpowers/specs/2026-07-26-recent-searches-design.md
git commit -m "feat(recent): 길찾기 최근 장소 — 즉시 확정·필드당 5건 표시·프리필 기록, 스펙 §4 보완" -- src/components/DirectionsView.tsx docs/superpowers/specs/2026-07-26-recent-searches-design.md
```

---

### Task 5: iOS Kit `RecentSearchStore` + 단위 테스트

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/RecentSearchStore.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/RecentSearchStoreTests.swift`

**Interfaces:**
- Produces (Task 6·7이 사용):
  - `public struct RecentEndpoint: Codable, Equatable, Hashable, Sendable { label, lat, lng }`
  - `public struct RecentSearchStore { init(defaults: UserDefaults = .standard) }`
  - 검색어: `queries() -> [String]` / `@discardableResult recordQuery(_:) -> [String]` / `@discardableResult removeQuery(_:) -> [String]` / `clearQueries()`
  - 장소: `endpoints() -> [RecentEndpoint]` / `@discardableResult recordEndpoint(_:) -> [RecentEndpoint]` / `@discardableResult removeEndpoint(_:) -> [RecentEndpoint]` / `clearEndpoints()`

- [ ] **Step 1: 실패하는 테스트 작성**

```swift
// ios/GildongmuKit/Tests/GildongmuKitTests/RecentSearchStoreTests.swift
import Testing
import Foundation
@testable import GildongmuKit

// 웹 src/lib/__tests__/recent-searches.test.ts의 대표 케이스를 그대로 옮긴다(기대값 재사용).

/// 케이스 격리 suite: 테스트별 UserDefaults를 비우고 시작한다.
private func freshDefaults(_ name: String) -> UserDefaults {
    let suite = "recent-search-tests-\(name)"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    return defaults
}

@Suite struct RecentQueryTests {
    @Test func trimAndPrependAndIgnoreEmpty() {
        let store = RecentSearchStore(defaults: freshDefaults("trim"))
        #expect(store.recordQuery("  경복궁  ") == ["경복궁"])
        #expect(store.recordQuery("서울역") == ["서울역", "경복궁"])
        #expect(store.recordQuery("   ") == ["서울역", "경복궁"])
    }

    @Test func dedupeMovesToTop() {
        let store = RecentSearchStore(defaults: freshDefaults("dedupe"))
        store.recordQuery("a")
        store.recordQuery("b")
        #expect(store.recordQuery("a") == ["a", "b"])
    }

    @Test func capAt20() {
        let store = RecentSearchStore(defaults: freshDefaults("cap"))
        for i in 1...21 { store.recordQuery("q\(i)") }
        let list = store.queries()
        #expect(list.count == 20)
        #expect(list.first == "q21")
        #expect(!list.contains("q1"))
    }

    @Test func removeAndClear() {
        let store = RecentSearchStore(defaults: freshDefaults("remove"))
        store.recordQuery("a")
        store.recordQuery("b")
        #expect(store.removeQuery("a") == ["b"])
        store.clearQueries()
        #expect(store.queries() == [])
    }

    @Test func corruptDataRecoversToEmpty() {
        let defaults = freshDefaults("corrupt")
        defaults.set(Data("{oops".utf8), forKey: "recentQueries.v1")
        #expect(RecentSearchStore(defaults: defaults).queries() == [])
    }
}

@Suite struct RecentEndpointTests {
    let gyeongbok = RecentEndpoint(label: "경복궁", lat: 37.579617, lng: 126.977041)

    @Test func recordRemoveClear() {
        let store = RecentSearchStore(defaults: freshDefaults("ep"))
        #expect(store.recordEndpoint(gyeongbok) == [gyeongbok])
        #expect(store.removeEndpoint(gyeongbok) == [])
        store.recordEndpoint(gyeongbok)
        store.clearEndpoints()
        #expect(store.endpoints() == [])
    }

    @Test func coord4DigitDedupeReplacesLabel() {
        let store = RecentSearchStore(defaults: freshDefaults("coord"))
        store.recordEndpoint(gyeongbok)
        store.recordEndpoint(RecentEndpoint(label: "서울역", lat: 37.5547, lng: 126.9707))
        // 소수 5자리째만 다른 좌표(4자리 반올림 동일) + 라벨 변형 → 교체·끌어올림
        let next = store.recordEndpoint(
            RecentEndpoint(label: "경복궁 (고궁)", lat: 37.5796172, lng: 126.9770413))
        #expect(next.count == 2)
        #expect(next.first?.label == "경복궁 (고궁)")
    }

    @Test func capAt20() {
        let store = RecentSearchStore(defaults: freshDefaults("epcap"))
        for i in 1...21 {
            store.recordEndpoint(RecentEndpoint(label: "p\(i)", lat: Double(i), lng: Double(i)))
        }
        #expect(store.endpoints().count == 20)
        #expect(store.endpoints().first?.label == "p21")
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd ios/GildongmuKit && swift test --filter RecentSearch 2>&1 | tail -5`
Expected: 컴파일 실패(타입 없음)

- [ ] **Step 3: 구현**

```swift
// ios/GildongmuKit/Sources/GildongmuKit/RecentSearchStore.swift
import Foundation

/// 최근 검색 장소 항목(길찾기 endpoint 기록). 좌표 소수 4자리(≈11m) 일치 = 같은 장소.
public struct RecentEndpoint: Codable, Equatable, Hashable, Sendable {
    public let label: String
    public let lat: Double
    public let lng: Double

    public init(label: String, lat: Double, lng: Double) {
        self.label = label
        self.lat = lat
        self.lng = lng
    }
}

/// 최근 검색 기록 저장소(스펙 docs/superpowers/specs/2026-07-26-recent-searches-design.md).
/// 검색어(검색 탭)·장소(길찾기) 이원 기록, 기기 로컬(UserDefaults) 전용, 최대 20개 최신순.
/// 파싱 실패는 빈 목록으로 조용히 복구한다(기록은 부가 기능 — 본 기능을 막지 않는다).
/// 웹 src/lib/recent-searches.ts 미러.
public struct RecentSearchStore {
    public static let cap = 20
    static let queriesKey = "recentQueries.v1"
    static let endpointsKey = "recentEndpoints.v1"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    // MARK: 검색어

    public func queries() -> [String] {
        decode([String].self, forKey: Self.queriesKey)
    }

    /// trim 후 기록. 빈 문자열은 무시(현재 목록 반환).
    @discardableResult
    public func recordQuery(_ raw: String) -> [String] {
        let query = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return queries() }
        return save(Self.append(query, to: queries(), isSame: ==), forKey: Self.queriesKey)
    }

    @discardableResult
    public func removeQuery(_ query: String) -> [String] {
        save(queries().filter { $0 != query }, forKey: Self.queriesKey)
    }

    public func clearQueries() {
        save([String](), forKey: Self.queriesKey)
    }

    // MARK: 장소

    public func endpoints() -> [RecentEndpoint] {
        decode([RecentEndpoint].self, forKey: Self.endpointsKey)
    }

    /// 좌표 4자리 dedupe — 같은 장소의 라벨 변형은 최신 라벨로 교체하며 끌어올린다.
    @discardableResult
    public func recordEndpoint(_ endpoint: RecentEndpoint) -> [RecentEndpoint] {
        save(Self.append(endpoint, to: endpoints(), isSame: Self.sameCoord), forKey: Self.endpointsKey)
    }

    @discardableResult
    public func removeEndpoint(_ endpoint: RecentEndpoint) -> [RecentEndpoint] {
        save(endpoints().filter { !Self.sameCoord($0, endpoint) }, forKey: Self.endpointsKey)
    }

    public func clearEndpoints() {
        save([RecentEndpoint](), forKey: Self.endpointsKey)
    }

    // MARK: 내부

    static func sameCoord(_ a: RecentEndpoint, _ b: RecentEndpoint) -> Bool {
        String(format: "%.4f", a.lat) == String(format: "%.4f", b.lat)
            && String(format: "%.4f", a.lng) == String(format: "%.4f", b.lng)
    }

    /// 순수 코어: 중복 제거 후 맨 앞 삽입, cap 절단(웹 appendRecent 미러).
    static func append<T>(_ item: T, to items: [T], isSame: (T, T) -> Bool) -> [T] {
        Array(([item] + items.filter { !isSame($0, item) }).prefix(cap))
    }

    private func decode<T: Decodable>(_ type: [T].Type, forKey key: String) -> [T] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode(type, from: data)) ?? []
    }

    @discardableResult
    private func save<T: Encodable>(_ items: [T], forKey key: String) -> [T] {
        if let data = try? JSONEncoder().encode(items) {
            defaults.set(data, forKey: key)
        }
        return items
    }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd ios/GildongmuKit && swift test --filter RecentSearch 2>&1 | tail -5`
Expected: 전건 PASS

- [ ] **Step 5: 커밋**

```bash
git add ios/GildongmuKit/Sources/GildongmuKit/RecentSearchStore.swift ios/GildongmuKit/Tests/GildongmuKitTests/RecentSearchStoreTests.swift
git commit -m "feat(recent): Kit RecentSearchStore — 검색어/장소 이원, cap 20, 웹 미러" -- ios/GildongmuKit/Sources/GildongmuKit/RecentSearchStore.swift ios/GildongmuKit/Tests/GildongmuKitTests/RecentSearchStoreTests.swift
```

---

### Task 6: iOS 검색 탭 배선 (SearchView)

**Files:**
- Modify: `ios/Gildongmu/SearchView.swift`

**Interfaces:**
- Consumes: Task 5의 `RecentSearchStore`, Task 2의 `recent.*` 키(`appLocalized`).

- [ ] **Step 1: 상태·로드 추가** (SearchView 프로퍼티 블록)

```swift
/// 최근 검색(스펙 2026-07-26). 검색 전 초기 화면에만 노출, 기록은 runSearch 공용 경로.
private let recentStore = RecentSearchStore()
@State private var recentQueries: [String] = []
@AccessibilityFocusState private var focusedRecentQuery: String?
/// 목록 소멸 시 포커스 착지점 — 항상 존재하는 마이크 행(스펙 §5).
@AccessibilityFocusState private var micRowFocused: Bool
```

기존 `.task { … }`(단축어 소비) 앞줄에 로드 추가가 아니라, **같은 `.task` 블록 첫 줄**에 넣는다(모디파이어 중복 방지):

```swift
.task {
    recentQueries = recentStore.queries()
    let store = LaunchActionStore.shared
    …기존 그대로…
}
```

- [ ] **Step 2: 마이크 행에 포커스 타깃 부착** (기존 `HoldDictationButton(...)` 호출에 모디파이어 추가)

```swift
HoldDictationButton(
    …기존 인자 그대로…
)
.accessibilityFocused($micRowFocused)
```

- [ ] **Step 3: runSearch에 기록 삽입**

```swift
private func runSearch() {
    recentQueries = recentStore.recordQuery(model.query)  // 제출 = 기록 시점(음성 경로 포함)
    bucket = nil
    region = nil
    model.submit()
}
```

- [ ] **Step 4: 최근 검색 섹션 렌더** (마이크 Section 바로 다음, `if let outcome` 앞)

```swift
// 최근 검색(스펙 2026-07-26): 검색 전 초기 상태에만. 행 활성화=재검색,
// swipeActions 삭제가 VoiceOver 로터 커스텀 액션으로 자동 노출된다.
if model.outcome == nil && !model.isSearching && !recentQueries.isEmpty {
    Section(appLocalized("recent.title")) {
        ForEach(recentQueries, id: \.self) { query in
            Button(query) {
                model.query = query
                runSearch()
            }
            .accessibilityFocused($focusedRecentQuery, equals: query)
            .swipeActions {
                Button(appLocalized("recent.delete"), role: .destructive) {
                    deleteRecent(query)
                }
            }
        }
        Button(appLocalized("recent.clearAll")) { clearRecent() }
    }
}
```

- [ ] **Step 5: 삭제 핸들러 추가** (runSearch 아래)

```swift
/// 항목 삭제(스펙 §5 포커스 계약): 다음 항목 → 이전 항목 → 목록 소멸 시 마이크 행.
/// 통지 1건 + 포커스 이동(이동 착지 라벨 낭독과 순서 무해 — polite 큐).
private func deleteRecent(_ query: String) {
    guard let index = recentQueries.firstIndex(of: query) else { return }
    recentQueries = recentStore.removeQuery(query)
    AccessibilityNotification.Announcement(appLocalized("recent.deleted")).post()
    if recentQueries.isEmpty {
        micRowFocused = true
        return
    }
    focusedRecentQuery = recentQueries[min(index, recentQueries.count - 1)]
}

private func clearRecent() {
    recentStore.clearQueries()
    recentQueries = []
    AccessibilityNotification.Announcement(appLocalized("recent.cleared")).post()
    micRowFocused = true
}
```

- [ ] **Step 6: 빌드 + 키 린터**

Run: `node ios/scripts/check-xcstrings-keys.mjs && xcodebuildmcp simulator build --workspace ios/Gildongmu.xcodeproj --scheme Gildongmu 2>&1 | tail -3`
(빌드 명령이 다르면 기존 관례 `xcodebuildmcp` CLI의 build 사용법을 따른다. 시뮬레이터 빌드 성공이 기준.)
Expected: 린터 PASS, BUILD SUCCEEDED

- [ ] **Step 7: 커밋**

```bash
git add ios/Gildongmu/SearchView.swift
git commit -m "feat(recent): iOS 검색 탭 최근 검색 — 로터 삭제·모두 지우기·마이크 행 포커스 착지" -- ios/Gildongmu/SearchView.swift
```

---

### Task 7: iOS 길찾기 배선 (DirectionsEndpointSearchView + DirectionsModel 기록)

**Files:**
- Modify: `ios/Gildongmu/Directions/DirectionsEndpointSearchView.swift`
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift` (DirectionsModel의 setEndpoint·init)

**Interfaces:**
- Consumes: Task 5의 `RecentSearchStore`·`RecentEndpoint`, Task 2의 `recent.*` 키.

- [ ] **Step 1: DirectionsModel에 기록 지점 삽입** (`DirectionsTabView.swift`)

기록은 endpoint 확정 단일 경로 `setEndpoint`와 프리필 `init`에서 — 시트·검색결과 로터 프리필·swap 무관하게 `.place` 확정만 남는다:

```swift
init(prefilledDestination: DirectionsEndpoint? = nil) {
    from = .current
    to = prefilledDestination
    recordRecent(prefilledDestination)
}
```

```swift
/// 필드 확정은 항상 엔드포인트 전체 교체(원자). 이전 결과는 새 질의와 무관해져 폐기.
func setEndpoint(_ endpoint: DirectionsEndpoint, for target: DirectionsFieldTarget) {
    if target == .from { from = endpoint } else { to = endpoint }
    recordRecent(endpoint)
    clearResults()
}

/// 최근 장소 기록(스펙 2026-07-26): 확정 단일 경로에서 .place만("현재 위치" 제외).
private func recordRecent(_ endpoint: DirectionsEndpoint?) {
    if case .place(let label, let lat, let lng) = endpoint {
        RecentSearchStore().recordEndpoint(RecentEndpoint(label: label, lat: lat, lng: lng))
    }
}
```

- [ ] **Step 2: DirectionsEndpointSearchView에 상태·로드 추가**

```swift
/// 최근 장소(스펙 2026-07-26) — 출발지/도착지 공유 목록, 시트 열릴 때 로드.
private let recentStore = RecentSearchStore()
@State private var recentEndpoints: [RecentEndpoint] = []
@AccessibilityFocusState private var focusedRecent: RecentEndpoint?
/// 목록 소멸 시 포커스 착지점 — 항상 존재하는 마이크 행(스펙 §5, SearchView 동형).
@AccessibilityFocusState private var micRowFocused: Bool
```

`NavigationStack`의 List에 `.task { recentEndpoints = recentStore.endpoints() }` 추가(기존 `.onDisappear` 근처), 마이크 `HoldDictationButton`에 `.accessibilityFocused($micRowFocused)` 부착(SearchView Step 2 동형).

- [ ] **Step 3: 최근 장소 섹션 렌더** ("현재 위치 사용" 버튼·notice 다음, 장소 후보 ForEach 앞)

```swift
// 최근 장소(스펙 2026-07-26): 후보 검색 전 상태에만. 행 활성화=재검색 없이 즉시 확정,
// swipeActions 삭제가 VoiceOver 로터로 자동 노출. 기록은 select→setEndpoint가 담당(이중 기록 금지).
if model.places.isEmpty && model.addresses.isEmpty && !recentEndpoints.isEmpty {
    Section(appLocalized("recent.title")) {
        ForEach(recentEndpoints, id: \.self) { endpoint in
            Button(endpoint.label) {
                select(.place(label: endpoint.label, lat: endpoint.lat, lng: endpoint.lng))
            }
            .accessibilityFocused($focusedRecent, equals: endpoint)
            .swipeActions {
                Button(appLocalized("recent.delete"), role: .destructive) {
                    deleteRecent(endpoint)
                }
            }
        }
        Button(appLocalized("recent.clearAll")) { clearRecent() }
    }
}
```

- [ ] **Step 4: 삭제 핸들러 추가** (select 함수 근처, SearchView 동형)

```swift
/// 항목 삭제(스펙 §5): 다음 항목 → 이전 항목 → 목록 소멸 시 마이크 행. 통지 1건.
private func deleteRecent(_ endpoint: RecentEndpoint) {
    guard let index = recentEndpoints.firstIndex(of: endpoint) else { return }
    recentEndpoints = recentStore.removeEndpoint(endpoint)
    AccessibilityNotification.Announcement(appLocalized("recent.deleted")).post()
    if recentEndpoints.isEmpty {
        micRowFocused = true
        return
    }
    focusedRecent = recentEndpoints[min(index, recentEndpoints.count - 1)]
}

private func clearRecent() {
    recentStore.clearEndpoints()
    recentEndpoints = []
    AccessibilityNotification.Announcement(appLocalized("recent.cleared")).post()
    micRowFocused = true
}
```

- [ ] **Step 5: 빌드 확인**

Run: Task 6 Step 6과 동일한 시뮬레이터 빌드 명령
Expected: BUILD SUCCEEDED

- [ ] **Step 6: 커밋**

```bash
git add ios/Gildongmu/Directions/DirectionsEndpointSearchView.swift ios/Gildongmu/Directions/DirectionsTabView.swift
git commit -m "feat(recent): iOS 길찾기 최근 장소 — 즉시 확정·로터 삭제, 기록은 setEndpoint 단일 경로" -- ios/Gildongmu/Directions/DirectionsEndpointSearchView.swift ios/Gildongmu/Directions/DirectionsTabView.swift
```

---

### Task 8: 통합 검증·리뷰·배포

**Files:** 없음(검증·프로세스)

- [ ] **Step 1: 전체 게이트 재실행**

Run: `npm run lint && npm run test:run && npm run build && (cd ios/GildongmuKit && swift test 2>&1 | tail -3)`
Expected: 전부 PASS

- [ ] **Step 2: 시뮬레이터 실측** — `xcodebuildmcp` CLI `simulator build-and-run`으로 앱 구동, `ui-automation snapshot-ui`로 검색 탭 최근 검색 섹션·삭제 라벨 존재 확인(라벨 회귀 신호 용도 — 로터 판정 정본은 실기기 VoiceOver). 검색 1회 후 재진입해 목록 기록·재검색 동작 확인.

- [ ] **Step 3: 웹 실측** — dev 서버에서 검색 1회 → 새로고침 → 최근 검색 섹션 표시·재검색·삭제·모두 지우기·포커스 이동 확인(Chrome). 길찾기 뷰 endpoint 확정 → 재진입 → 최근 장소 표시 확인.

- [ ] **Step 4: 코드 리뷰** — code-reviewer 서브에이전트로 전체 diff 리뷰(스펙 대비 계약: 포커스 계약·이중 기록 금지·3-state 무관 확인). 지적은 아키텍처 수준 대조 후 반영.

- [ ] **Step 5: push(자동 배포) + iOS 실기기 배포**

```bash
git push origin main
./ios/deploy-device.sh
```

- [ ] **Step 6: PROGRESS.md 갱신** — 최근 검색 기능 완료 상태·실측 결과 기록, 커밋·푸시.

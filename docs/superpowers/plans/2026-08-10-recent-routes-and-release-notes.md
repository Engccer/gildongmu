# 최근 경로 + 업데이트 이력 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 길찾기 탭에 "최근 경로" 섹션(웹+iOS, 활성화=즉시 조회)과 iOS 설정 "업데이트 이력" 화면을 붙인다. 스펙: `docs/superpowers/specs/2026-08-10-recent-routes-and-release-notes-design.md`.

**Architecture:** 최근 경로는 기존 최근 검색 저장 계층(웹 `recent-searches.ts` ↔ Kit `RecentSearchStore`)에 route 쌍 목록을 추가하고, 기록은 양 플랫폼 조회 settled 지점 1곳. 업데이트 이력은 `docs/appstore/release-notes.md` 정본을 스크립트로 파싱해 iOS 번들 JSON으로 굳히고 드리프트 가드 테스트로 동조를 강제한다.

**Tech Stack:** Next.js 16 + Vitest 4(jsdom 컴포넌트 레인) / SwiftUI + Swift Testing / node mjs 스크립트.

**구현 방식 판정(AUTONOMY 기록 원칙):** 태스크 간 수정 파일이 서로 겹치지 않고(태스크 전용 파일), 선행 관계는 1→2, 3→4, 5→6뿐이며 인터페이스는 이 플랜에 고정 — **subagent-driven, 순차 실행**(xcstrings·번들 JSON 등 생성물 공유 충돌 방지).

## Global Constraints

- 커밋: `git add <의도 파일>` 후 즉시 `git commit -- <경로들>`(pathspec), `git add -A` 금지, 메시지 한국어 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 푸터. 커밋 직후 `git show HEAD --stat`으로 의도 파일만 들었는지 확인.
- 웹 게이트: `npm run test:run` 매 태스크 통과. 컴포넌트 테스트는 파일 상단 `// @vitest-environment jsdom`.
- Kit 게이트: `cd ios/GildongmuKit && swift test`.
- iOS 빌드 게이트(iOS 태스크): `cd ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS Simulator' build | tail -5` (성공 확인).
- i18n: 새 키는 `messages/{ko,en,es,fr,it,ja}.json` 6곳 전부(누락은 `i18n-messages.test.ts`가 잡음). iOS 전용 키는 `ios/i18n/ios-extra/{locale}.json` 6곳. xcstrings 재생성은 `node ios/scripts/messages-to-xcstrings.mjs app` + 린터 `node ios/scripts/check-xcstrings-keys.mjs`.
- Xcode 프로젝트는 `PBXFileSystemSynchronizedRootGroup`이라 **새 Swift 파일·리소스에 pbxproj 편집 불필요**(디스크에 두면 자동 포함).
- 접근성: 버튼 비활성화 금지 계약·한 줄=한 객체·통지 1건 등 repo CLAUDE.md 절대 원칙 준수. UI 라벨 이모지 금지.
- SR 통지 문구에 뻔한 꼬리 문장 금지.

---

### Task 1: 웹 저장 계층 — recent-searches.ts routes

**Files:**
- Modify: `src/lib/recent-searches.ts` (파일 말미에 routes 절 추가)
- Test: `src/lib/__tests__/recent-searches.test.ts` (기존 파일 확장)

**Interfaces:**
- Consumes: 기존 `RecentEndpoint`·`isEndpoint`·`sameEndpoint`·`appendRecent`·`load`·`save`·`defaultStorage`·`RECENT_CAP`.
- Produces (Task 2가 사용): `type RecentRoute = { from: RecentEndpoint | null; to: RecentEndpoint | null }`(null = 현재 위치), `loadRecentRoutes(storage?)`, `recordRecentRoute(route, storage?)`(양측 null이면 무기록·현재 목록 반환), `removeRecentRoute(route, storage?)`, `clearRecentRoutes(storage?)`. 저장 키 `gildongmu:recent-routes:v1`.

- [ ] **Step 1: 실패하는 테스트 작성** — `recent-searches.test.ts` 말미에 추가(기존 `memStorage` 헬퍼 재사용):

```ts
import {
  loadRecentRoutes, recordRecentRoute, removeRecentRoute, clearRecentRoutes,
  type RecentRoute,
} from "../recent-searches"; // 기존 import 블록에 병합

describe("recent routes", () => {
  const home = { label: "자택", lat: 37.535, lng: 127.145 };
  const school = { label: "신명중학교", lat: 37.529, lng: 127.138 };
  const homeToSchool: RecentRoute = { from: home, to: school };
  const curToSchool: RecentRoute = { from: null, to: school };

  it("기록은 맨 앞 삽입, 쌍 단위 dedupe(끌어올림)", () => {
    const s = memStorage();
    expect(recordRecentRoute(homeToSchool, s)).toEqual([homeToSchool]);
    expect(recordRecentRoute(curToSchool, s)).toEqual([curToSchool, homeToSchool]);
    // 같은 쌍(라벨 변형 포함)은 최신으로 끌어올림
    const relabeled = { from: { ...home, label: "자택 아파트" }, to: school };
    expect(recordRecentRoute(relabeled, s)).toEqual([relabeled, curToSchool]);
  });

  it("양측 현재 위치 쌍은 기록하지 않는다", () => {
    const s = memStorage();
    expect(recordRecentRoute({ from: null, to: null }, s)).toEqual([]);
    expect(loadRecentRoutes(s)).toEqual([]);
  });

  it("한쪽 null과 place는 다른 쌍이다", () => {
    const s = memStorage();
    recordRecentRoute(homeToSchool, s);
    recordRecentRoute(curToSchool, s);
    expect(loadRecentRoutes(s)).toHaveLength(2);
  });

  it("cap 20 절단", () => {
    const s = memStorage();
    for (let i = 0; i < 25; i++) {
      recordRecentRoute({ from: null, to: { label: `t${i}`, lat: 37 + i * 0.01, lng: 127 } }, s);
    }
    expect(loadRecentRoutes(s)).toHaveLength(20);
  });

  it("remove·clear·파싱 실패 복구", () => {
    const s = memStorage();
    recordRecentRoute(homeToSchool, s);
    recordRecentRoute(curToSchool, s);
    expect(removeRecentRoute(curToSchool, s)).toEqual([homeToSchool]);
    expect(clearRecentRoutes(s)).toEqual([]);
    expect(loadRecentRoutes(memStorage({ "gildongmu:recent-routes:v1": "{oops" }))).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/lib/__tests__/recent-searches.test.ts` → FAIL(export 없음).

- [ ] **Step 3: 구현** — `recent-searches.ts` 말미:

```ts
// ── 경로 (길찾기 출발·도착 쌍, 스펙 2026-08-10) ──────────────────────

/** null = "현재 위치"(활성화 시점에 재측위 — 좌표를 굳히지 않는다). */
export type RecentRoute = { from: RecentEndpoint | null; to: RecentEndpoint | null };

const ROUTES_KEY = "gildongmu:recent-routes:v1";

const isRouteSide = (v: unknown): v is RecentEndpoint | null => v === null || isEndpoint(v);

const isRoute = (v: unknown): v is RecentRoute =>
  typeof v === "object" && v !== null &&
  isRouteSide((v as RecentRoute).from) && isRouteSide((v as RecentRoute).to);

function sameSide(a: RecentEndpoint | null, b: RecentEndpoint | null): boolean {
  if (a === null || b === null) return a === b;
  return sameEndpoint(a, b);
}

/** 쌍 단위 동일 판정: from 동일 ∧ to 동일(현재 위치끼리도 동일). */
function sameRoute(a: RecentRoute, b: RecentRoute): boolean {
  return sameSide(a.from, b.from) && sameSide(a.to, b.to);
}

export function loadRecentRoutes(storage: Storage | null = defaultStorage()): RecentRoute[] {
  return load(storage, ROUTES_KEY, isRoute);
}

export function recordRecentRoute(
  route: RecentRoute,
  storage: Storage | null = defaultStorage(),
): RecentRoute[] {
  // 양측 현재 위치는 자기 자리→자기 자리라 재조회 의미가 없다(스펙 §1.1).
  if (!route.from && !route.to) return loadRecentRoutes(storage);
  return save(storage, ROUTES_KEY, appendRecent(loadRecentRoutes(storage), route, sameRoute));
}

export function removeRecentRoute(
  route: RecentRoute,
  storage: Storage | null = defaultStorage(),
): RecentRoute[] {
  return save(storage, ROUTES_KEY, loadRecentRoutes(storage).filter((x) => !sameRoute(x, route)));
}

export function clearRecentRoutes(storage: Storage | null = defaultStorage()): RecentRoute[] {
  return save(storage, ROUTES_KEY, []);
}
```

⚠ JSON 직렬화에서 `from: null`은 그대로 보존된다(undefined 아님) — validator가 `null`을 허용하는 이유. `undefined`로 두면 키가 사라져 `isRouteSide(undefined)`가 false가 되므로 **타입을 `| null`로 고정**한다.

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/lib/__tests__/recent-searches.test.ts` → PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/recent-searches.ts src/lib/__tests__/recent-searches.test.ts
git commit -m "feat(web): 최근 경로 저장 계층 — 출발·도착 쌍 기록(spec 2026-08-10)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/lib/recent-searches.ts src/lib/__tests__/recent-searches.test.ts
```

---

### Task 2: 웹 길찾기 화면 최근 경로 섹션 + i18n 키

**Files:**
- Modify: `src/components/DirectionsView.tsx`
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json`, `messages/ja.json` (최상위 `recentRoutes` 네임스페이스 추가)
- Test: `src/components/__tests__/DirectionsView.test.tsx` (기존 파일 확장)

**Interfaces:**
- Consumes: Task 1의 `RecentRoute`·`loadRecentRoutes`·`recordRecentRoute`·`removeRecentRoute`·`clearRecentRoutes`. 기존 `endpointToField`·`recordRecentEndpoint`·`submitRef`·`setNotice`·`DirEndpoint`.
- Produces: i18n `recentRoutes.{title,item,clearAll,cleared}` — Task 4의 iOS가 xcstrings 재생성으로 같은 키를 소비한다(`item`의 `{from}`·`{to}`는 ko 등장 순서로 %1$@·%2$@ 변환).

- [ ] **Step 1: i18n 키 추가** — 6개 로케일 `messages/*.json` 최상위에 `recentRoutes` 네임스페이스(알파벳 위치 무관, 기존 `recent` 인접 권장):

```jsonc
// ko.json
"recentRoutes": {
  "title": "최근 경로",
  "item": "{from}부터 {to}까지 경로 조회",
  "clearAll": "최근 경로 모두 지우기",
  "cleared": "최근 경로를 모두 지웠습니다"
}
// en.json
"recentRoutes": {
  "title": "Recent routes",
  "item": "Route from {from} to {to}",
  "clearAll": "Clear all recent routes",
  "cleared": "All recent routes cleared"
}
// es.json
"recentRoutes": {
  "title": "Rutas recientes",
  "item": "Ruta de {from} a {to}",
  "clearAll": "Borrar todas las rutas recientes",
  "cleared": "Se borraron todas las rutas recientes"
}
// fr.json
"recentRoutes": {
  "title": "Itinéraires récents",
  "item": "Itinéraire de {from} à {to}",
  "clearAll": "Effacer tous les itinéraires récents",
  "cleared": "Tous les itinéraires récents ont été effacés"
}
// it.json
"recentRoutes": {
  "title": "Percorsi recenti",
  "item": "Percorso da {from} a {to}",
  "clearAll": "Cancella tutti i percorsi recenti",
  "cleared": "Tutti i percorsi recenti sono stati cancellati"
}
// ja.json
"recentRoutes": {
  "title": "最近の経路",
  "item": "{from}から{to}までの経路検索",
  "clearAll": "最近の経路をすべて削除",
  "cleared": "最近の経路をすべて削除しました"
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `DirectionsView.test.tsx` 말미에 추가. 기존 next-intl mock(`useTranslations: () => (key) => key`)은 파라미터를 버리므로 항목 텍스트는 키(`item`)로 렌더된다 — 단언은 heading·역할·localStorage 상태로 한다. localStorage는 test-setup이 실제 jsdom 구현을 연결해 두었다(직접 사용 가능, 케이스 시작 시 `localStorage.clear()`).

```tsx
describe("최근 경로 섹션", () => {
  const ROUTES_KEY = "gildongmu:recent-routes:v1";
  const seedRoutes = () =>
    localStorage.setItem(ROUTES_KEY, JSON.stringify([
      { from: { label: "자택", lat: 37.535, lng: 127.145 },
        to: { label: "신명중학교", lat: 37.529, lng: 127.138 } },
      { from: null, to: { label: "강남역", lat: 37.497, lng: 127.027 } },
    ]));

  function renderView() {
    return render(
      <DirectionsView canShowWalk={false} canShowTransit={true} canBriefCarRoute={false} onBack={() => {}} />,
    );
  }

  it("결과 없을 때 섹션·항목·전체 지우기가 보인다", async () => {
    localStorage.clear();
    seedRoutes();
    stubFetch();
    renderView();
    expect(await screen.findByRole("heading", { name: "title" })).toBeTruthy(); // recentRoutes.title
    expect(screen.getAllByText("item")).toHaveLength(2);
    expect(screen.getByText("clearAll")).toBeTruthy();
  });

  it("활성화: 즉시 조회 시작 + 조회 버튼 포커스 선점, settled 후 섹션 숨김·기록 끌어올림", async () => {
    localStorage.clear();
    seedRoutes();
    stubFetch(); // /api/route/* 미매핑 URL은 throw → 수단 error → settled(성공 0)
    renderView();
    const items = await screen.findAllByText("item");
    fireEvent.click(items[1]); // 두 번째 항목(강남역행)을 최신으로
    expect((document.activeElement as HTMLElement).textContent).toBe("submit");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "title" })).toBeNull());
    const stored = JSON.parse(localStorage.getItem(ROUTES_KEY)!);
    expect(stored[0].to.label).toBe("강남역"); // dedupe 끌어올림 = settled 기록 실행 증거
  });

  it("측위 실패 조회는 기록하지 않는다", async () => {
    localStorage.clear();
    stubFetch();
    // 도착지만 프리필, 출발지는 현재 위치 → geolocation mock이 error → geoError
    render(
      <DirectionsView canShowWalk={false} canShowTransit={true} canBriefCarRoute={false}
        initialTo={{ kind: "place", label: "강남역", coord: { lat: 37.497, lng: 127.027 } }}
        onBack={() => {}} />,
    );
    fireEvent.click(screen.getByText("submit"));
    await waitFor(() => expect(localStorage.getItem(ROUTES_KEY)).toBeNull());
  });

  it("삭제: 항목 제거 + 마지막 항목 삭제 시 조회 버튼 포커스", async () => {
    localStorage.clear();
    localStorage.setItem(ROUTES_KEY, JSON.stringify([
      { from: null, to: { label: "강남역", lat: 37.497, lng: 127.027 } },
    ]));
    stubFetch();
    renderView();
    const del = (await screen.findAllByText("delete")).at(-1)!; // 항목 삭제 버튼(mock은 네임스페이스를 벗긴다)
    fireEvent.click(del);
    expect(JSON.parse(localStorage.getItem(ROUTES_KEY)!)).toEqual([]);
    await waitFor(() =>
      expect((document.activeElement as HTMLElement).textContent).toBe("submit"));
  });
});
```

⚠ mock `useTranslations`는 네임스페이스를 무시하고 key만 돌려주므로 `tRecent("delete")`는 `"delete"`로 렌더된다 — 기존 mock 형태를 먼저 확인해 단언 문자열을 실제 렌더 값에 맞출 것(기존 케이스가 쓰는 문자열이 정본). 조회 버튼 텍스트가 `"submit"`인 것도 같은 이유.

- [ ] **Step 3: 실패 확인** — Run: `npx vitest run src/components/__tests__/DirectionsView.test.tsx` → 새 케이스 FAIL.

- [ ] **Step 4: DirectionsView 구현.** 변경점 6곳:

(a) import 확장:

```ts
import {
  clearRecentEndpoints, loadRecentEndpoints, recordRecentEndpoint, removeRecentEndpoint,
  loadRecentRoutes, recordRecentRoute, removeRecentRoute, clearRecentRoutes,
  type RecentEndpoint, type RecentEndpointField, type RecentRoute,
} from "@/lib/recent-searches";
```

(b) 상태·로드(기존 recentFrom/recentTo 블록 옆):

```ts
// 최근 경로(스펙 2026-08-10): 출발·도착 쌍. 결과 없는 화면에서만 노출.
const [recentRoutes, setRecentRoutes] = useState<RecentRoute[]>([]);
const tRecentRoutes = useTranslations("recentRoutes");
const visibleRecentRoutes = recentRoutes.slice(0, 5); // 웹 최근 목록 관례(상위 5)
const routeDeleteRefs = useRef<(HTMLButtonElement | null)[]>([]);
const routeFocusIndexRef = useRef<number | null>(null);
const [routeRevision, setRouteRevision] = useState(0);
useEffect(() => {
  const idx = routeFocusIndexRef.current;
  if (idx === null) return;
  routeFocusIndexRef.current = null;
  routeDeleteRefs.current[idx]?.focus();
}, [routeRevision]);
```

기존 마운트 effect의 `queueMicrotask` 안에 `setRecentRoutes(loadRecentRoutes());` 한 줄 추가.

(c) `runQuery` 시그니처에 override 추가(활성화가 setState 비동기를 우회해 같은 경로를 태우기 위함):

```ts
async function runQuery(fromOverride?: DirEndpoint, toOverride?: DirEndpoint) {
  if (inFlight.current) return;
  const from = fromOverride ?? fromField.resolved;
  const to = toOverride ?? toField.resolved;
  // …이하 기존 본문 그대로
```

⚠ 조회 버튼 `onClick={runQuery}`는 MouseEvent가 첫 인자로 들어가므로 **반드시 `onClick={() => runQuery()}`로 변경**한다.

(d) settled 커밋 지점(`setPhase({ kind: "settled", … })` 직후)에 기록 — 스펙 §1.2의 유일 기록 지점:

```ts
// 최근 경로 기록(스펙 §1.2): settled 도달 시 1곳. 실패 phase·outOfCoverage·취소 경로는
// 여기 도달하지 않아 자연 배제된다. current는 null 투영(실좌표를 굳히지 않는다).
setRecentRoutes(recordRecentRoute({
  from: from.kind === "current" ? null : { label: from.label, lat: from.coord.lat, lng: from.coord.lng },
  to: to.kind === "current" ? null : { label: to.label, lat: to.coord.lat, lng: to.coord.lng },
}));
```

(e) 핸들러 3종(컴포넌트 함수 스코프):

```ts
function routeEndpoint(side: RecentEndpoint | null): DirEndpoint {
  return side
    ? { kind: "place", label: side.label, coord: { lat: side.lat, lng: side.lng } }
    : { kind: "current" };
}
function routeItemLabel(r: RecentRoute): string {
  const side = (s: RecentEndpoint | null) => (s ? s.label : t("currentLocation"));
  return tRecentRoutes("item", { from: side(r.from), to: side(r.to) });
}
/** 활성화 = 두 필드 원자 확정 + 즉시 조회(스펙 §1.4). 결과 도착 시 이 섹션이 통째로
 * 사라지므로 포커스를 먼저 조회 버튼으로 선점한다(헌장 §5). endpoint 최근 목록도
 * 확정 경로와 동일하게 기록(iOS setEndpoint 경유와 대칭). */
function activateRecentRoute(r: RecentRoute) {
  submitRef.current?.focus();
  const fromEp = routeEndpoint(r.from);
  const toEp = routeEndpoint(r.to);
  setFromField(endpointToField(fromEp, currentLabel));
  setToField(endpointToField(toEp, currentLabel));
  if (r.from) setRecentFrom(recordRecentEndpoint("from", r.from));
  if (r.to) setRecentTo(recordRecentEndpoint("to", r.to));
  void runQuery(fromEp, toEp);
}
function deleteRecentRoute(r: RecentRoute, index: number) {
  const next = removeRecentRoute(r);
  setRecentRoutes(next);
  setNotice(tRecent("deleted"));
  const visibleCount = Math.min(next.length, 5);
  if (visibleCount === 0) {
    submitRef.current?.focus();
    return;
  }
  routeFocusIndexRef.current = Math.min(index, visibleCount - 1);
  setRouteRevision((v) => v + 1);
}
function clearRoutes() {
  setRecentRoutes(clearRecentRoutes());
  setNotice(tRecentRoutes("cleared"));
  submitRef.current?.focus();
}
```

(f) 섹션 렌더 — live region `<p aria-live…>` 블록 **바로 다음**(간략 폴백 앞), EndpointField 최근 목록과 같은 마크업 문법:

```tsx
{/* 최근 경로(스펙 2026-08-10 §1.3): 결과 없는 화면에서만 — 결과 아래 20행은 탐색 방해.
    조용히 나타나는 목록이라 heading이 발견 경로. 항목 한 줄 = 한 객체(라벨 문장이
    곧 버튼 이름), 삭제 버튼은 인터랙티브라 별도 객체가 정상. */}
{!results && !busy && visibleRecentRoutes.length > 0 && (
  <section className="mt-4">
    <h3 className="text-sm font-semibold">{tRecentRoutes("title")}</h3>
    <ul className="mt-1">
      {visibleRecentRoutes.map((r, i) => {
        const label = routeItemLabel(r);
        return (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => activateRecentRoute(r)}
              className="min-h-11 flex-1 text-left text-sm underline"
            >
              {label}
            </button>
            <button
              type="button"
              ref={(el) => { routeDeleteRefs.current[i] = el; }}
              aria-label={tRecent("deleteItem", { name: label })}
              onClick={() => deleteRecentRoute(r, i)}
              className="min-h-11 rounded-md border border-border px-3 text-sm"
            >
              {tRecent("delete")}
            </button>
          </li>
        );
      })}
    </ul>
    <button type="button" onClick={clearRoutes} className="mt-1 min-h-11 text-sm underline">
      {tRecentRoutes("clearAll")}
    </button>
  </section>
)}
```

⚠ `key={label}`은 mock 환경에서 중복될 수 있으므로 실제 구현은 좌표 기반 키를 쓴다: `key={`${r.from?.lat ?? "cur"},${r.from?.lng ?? ""}→${r.to?.lat ?? "cur"},${r.to?.lng ?? ""}`}`.

- [ ] **Step 5: 통과 확인** — Run: `npx vitest run src/components/__tests__/DirectionsView.test.tsx src/lib/__tests__/i18n-messages.test.ts` → PASS. 이어 `npm run test:run` 전체 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/components/DirectionsView.tsx src/components/__tests__/DirectionsView.test.tsx messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json messages/ja.json
git commit -m "feat(web): 길찾기 최근 경로 섹션 — 활성화 즉시 조회 + 조회 버튼 포커스 선점

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/components/DirectionsView.tsx src/components/__tests__/DirectionsView.test.tsx messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json messages/ja.json
```

---

### Task 3: Kit 저장 계층 — RecentSearchStore routes

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RecentSearchStore.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/RecentSearchStoreTests.swift` (기존 파일 확장)

**Interfaces:**
- Consumes: 기존 `RecentEndpoint`·`sameCoord`·`append`·`decode`·`save`.
- Produces (Task 4가 사용): `public struct RecentRoute: Codable, Equatable, Hashable, Sendable { public let from: RecentEndpoint?; public let to: RecentEndpoint? }`(nil = 현재 위치), `RecentSearchStore.routes() -> [RecentRoute]`, `recordRoute(_:) -> [RecentRoute]`(양측 nil 무기록), `removeRoute(_:) -> [RecentRoute]`, `clearRoutes()`. 저장 키 `recentRoutes.v1`.

- [ ] **Step 1: 실패하는 테스트 작성** — `RecentSearchStoreTests.swift` 말미(파일 내 `freshDefaults` 재사용, 웹 Task 1 케이스와 기대값 동형):

```swift
@Suite struct RecentRouteTests {
    private let home = RecentEndpoint(label: "자택", lat: 37.535, lng: 127.145)
    private let school = RecentEndpoint(label: "신명중학교", lat: 37.529, lng: 127.138)

    @Test func prependAndDedupeByPair() {
        let store = RecentSearchStore(defaults: freshDefaults("route-dedupe"))
        let a = RecentRoute(from: home, to: school)
        let b = RecentRoute(from: nil, to: school)
        #expect(store.recordRoute(a) == [a])
        #expect(store.recordRoute(b) == [b, a])   // 한쪽 nil ≠ place: 다른 쌍
        let relabeled = RecentRoute(from: RecentEndpoint(label: "자택 아파트", lat: home.lat, lng: home.lng), to: school)
        #expect(store.recordRoute(relabeled) == [relabeled, b])   // 같은 쌍은 끌어올림+라벨 갱신
    }

    @Test func rejectsBothCurrent() {
        let store = RecentSearchStore(defaults: freshDefaults("route-both-nil"))
        #expect(store.recordRoute(RecentRoute(from: nil, to: nil)) == [])
        #expect(store.routes() == [])
    }

    @Test func capAt20() {
        let store = RecentSearchStore(defaults: freshDefaults("route-cap"))
        for i in 0..<25 {
            store.recordRoute(RecentRoute(from: nil, to: RecentEndpoint(label: "t\(i)", lat: 37 + Double(i) * 0.01, lng: 127)))
        }
        #expect(store.routes().count == 20)
    }

    @Test func removeClearAndDecodeRecovery() {
        let defaults = freshDefaults("route-remove")
        let store = RecentSearchStore(defaults: defaults)
        let a = RecentRoute(from: home, to: school)
        let b = RecentRoute(from: nil, to: school)
        store.recordRoute(a)
        store.recordRoute(b)
        #expect(store.removeRoute(b) == [a])
        store.clearRoutes()
        #expect(store.routes() == [])
        defaults.set(Data("broken".utf8), forKey: "recentRoutes.v1")
        #expect(store.routes() == [])
    }
}
```

- [ ] **Step 2: 실패 확인** — Run: `cd ios/GildongmuKit && swift test` → 컴파일 실패(`RecentRoute` 없음).

- [ ] **Step 3: 구현** — `RecentSearchStore.swift`. 타입은 `RecentEndpoint` 아래에:

```swift
/// 최근 조회 경로(출발·도착 쌍, 스펙 2026-08-10). nil = "현재 위치" —
/// 활성화 시점에 재측위하므로 좌표를 굳히지 않는다. 웹 RecentRoute 미러.
public struct RecentRoute: Codable, Equatable, Hashable, Sendable {
    public let from: RecentEndpoint?
    public let to: RecentEndpoint?

    public init(from: RecentEndpoint?, to: RecentEndpoint?) {
        self.from = from
        self.to = to
    }
}
```

store 본문(`// MARK: 장소` 절 다음에 `// MARK: 경로` 절):

```swift
// MARK: 경로 (출발·도착 쌍, 스펙 2026-08-10)

static let routesKey = "recentRoutes.v1"

public func routes() -> [RecentRoute] {
    decode([RecentRoute].self, forKey: Self.routesKey)
}

/// 쌍 단위 dedupe 끌어올림. 양측 nil(현재 위치→현재 위치)은 재조회 의미가 없어 무기록.
@discardableResult
public func recordRoute(_ route: RecentRoute) -> [RecentRoute] {
    guard route.from != nil || route.to != nil else { return routes() }
    return save(Self.append(route, to: routes(), isSame: Self.sameRoute), forKey: Self.routesKey)
}

@discardableResult
public func removeRoute(_ route: RecentRoute) -> [RecentRoute] {
    save(routes().filter { !Self.sameRoute($0, route) }, forKey: Self.routesKey)
}

public func clearRoutes() {
    save([RecentRoute](), forKey: Self.routesKey)
}

static func sameRoute(_ a: RecentRoute, _ b: RecentRoute) -> Bool {
    sameSide(a.from, b.from) && sameSide(a.to, b.to)
}

/// 한쪽 판정: 현재 위치(nil)끼리 동일, place끼리는 좌표 4자리 일치.
static func sameSide(_ a: RecentEndpoint?, _ b: RecentEndpoint?) -> Bool {
    switch (a, b) {
    case (nil, nil): true
    case let (l?, r?): sameCoord(l, r)
    default: false
    }
}
```

- [ ] **Step 4: 통과 확인** — Run: `cd ios/GildongmuKit && swift test` → PASS(기존 스위트 포함).

- [ ] **Step 5: 커밋**

```bash
git add ios/GildongmuKit/Sources/GildongmuKit/RecentSearchStore.swift ios/GildongmuKit/Tests/GildongmuKitTests/RecentSearchStoreTests.swift
git commit -m "feat(ios-kit): RecentSearchStore 경로 쌍 목록 — 웹 recent-searches 미러

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- ios/GildongmuKit/Sources/GildongmuKit/RecentSearchStore.swift ios/GildongmuKit/Tests/GildongmuKitTests/RecentSearchStoreTests.swift
```

---

### Task 4: iOS 길찾기 탭 최근 경로 섹션

**Files:**
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift`
- Modify(재생성): `ios/Gildongmu/Resources/Localizable.xcstrings` (`node ios/scripts/messages-to-xcstrings.mjs app` — Task 2의 recentRoutes 키가 흘러든다)

**Interfaces:**
- Consumes: Task 3 `RecentRoute`·`routes()`·`recordRoute`·`removeRoute`·`clearRoutes`; Task 2 i18n 키 `recentRoutes.*`(app 카탈로그, `item`은 %1$@=from·%2$@=to); 기존 `appLocalized`·`submitFocused`·`setEndpoint`·`runQuery`·`isBusy`.
- Produces: 없음(말단 UI).

- [ ] **Step 1: xcstrings 재생성 + 린터**

Run: `node ios/scripts/messages-to-xcstrings.mjs app && node ios/scripts/check-xcstrings-keys.mjs`
Expected: 카탈로그에 `recentRoutes.title` 등 4키 추가, 린터 통과(아직 미참조 키는 린터가 잡지 않는지 확인 — 잡으면 Step 2와 같은 커밋으로 진행).

- [ ] **Step 2: DirectionsModel 확장** — `DirectionsTabView.swift`의 `DirectionsModel`에:

(a) 프로퍼티·로드(프로퍼티 선언부, `stepFreeBusy` 근처):

```swift
/// 최근 조회 경로(스펙 2026-08-10). 결과 없는 화면에서만 뷰가 노출한다.
/// init 로드는 읽기 전용이라 State(initialValue:) 재평가에도 안전(기록 부수효과 금지).
private(set) var recentRoutes: [RecentRoute]
private let recentStore = RecentSearchStore()
```

`init(prefilledDestination:)`에 `recentRoutes = RecentSearchStore().routes()` 추가(저장 프로퍼티 초기화 순서상 `recentStore` 사용 전 직접 생성이 단순).

(b) `performQuery`의 settled 커밋 지점 — `hasQueriedOnce = true` 직후에 1줄:

```swift
recordRecentRoute(from: from, to: to)
```

(c) 메서드 3종(`recordRecent` 근처):

```swift
/// 최근 경로 기록(스펙 §1.2): settled 도달 시 1곳. 실패 phase·outOfCoverage·취소는
/// 여기 도달하지 않는다. current는 nil 투영 — 측위된 실좌표를 굳히지 않는다.
private func recordRecentRoute(from: DirectionsEndpoint, to: DirectionsEndpoint) {
    recentRoutes = recentStore.recordRoute(
        RecentRoute(from: Self.recentSide(from), to: Self.recentSide(to)))
}

private static func recentSide(_ endpoint: DirectionsEndpoint) -> RecentEndpoint? {
    if case .place(let label, let lat, let lng) = endpoint {
        return RecentEndpoint(label: label, lat: lat, lng: lng)
    }
    return nil
}

func removeRecentRoute(_ route: RecentRoute) {
    recentRoutes = recentStore.removeRoute(route)
}

func clearRecentRoutes() {
    recentStore.clearRoutes()
    recentRoutes = []
}
```

- [ ] **Step 3: 뷰 섹션·핸들러 추가** — `DirectionsTabView`:

(a) 포커스 상태(기존 `@AccessibilityFocusState` 선언부 옆 — ⚠ Bool 바인딩 다중 부착 금지 규칙: 항목 정체성 옵셔널 바인딩):

```swift
@AccessibilityFocusState private var focusedRecentRoute: RecentRoute?
```

(b) List 안, 첫 번째 Section(필드·조회 버튼) **직후**에 섹션:

```swift
// 최근 경로(스펙 2026-08-10 §1.3): 결과 없는 화면에서만 — 결과 아래 20행은 탐색
// 방해. 실패 phase에서는 보인다(다른 경로를 고르는 우회로). swipeActions 삭제가
// VoiceOver 로터로 자동 노출된다(endpoint 시트 동형).
if model.results == nil && !model.isBusy && !model.recentRoutes.isEmpty {
    Section {
        ForEach(model.recentRoutes, id: \.self) { route in
            Button(recentRouteLabel(route)) { activateRecentRoute(route) }
                .accessibilityFocused($focusedRecentRoute, equals: route)
                .swipeActions {
                    Button(appLocalized("recent.delete"), role: .destructive) {
                        deleteRecentRoute(route)
                    }
                }
        }
        Button(appLocalized("recentRoutes.clearAll")) { clearRecentRoutes() }
    } header: {
        Text(appLocalized("recentRoutes.title"))
            .accessibilityAddTraits(.isHeader)
    }
}
```

(c) 핸들러(뷰 private 메서드, `landFocusAfterResolve` 근처):

```swift
private func recentRouteLabel(_ route: RecentRoute) -> String {
    let from = route.from?.label ?? appLocalized("directions.currentLocation")
    let to = route.to?.label ?? appLocalized("directions.currentLocation")
    return appLocalized("recentRoutes.item", from, to)
}

private func directionsEndpoint(_ side: RecentEndpoint?) -> DirectionsEndpoint {
    side.map { .place(label: $0.label, lat: $0.lat, lng: $0.lng) } ?? .current
}

/// 활성화 = 두 필드 원자 확정 + 즉시 조회(스펙 §1.4). 결과 도착 시 이 섹션이 통째로
/// 사라지므로 포커스를 먼저 조회 버튼으로 선점한다(헌장 §5 — 제거될 요소에 커서를
/// 남기지 않는다). setEndpoint 경유라 endpoint 최근 목록 기록도 기존 규칙대로 따라온다.
private func activateRecentRoute(_ route: RecentRoute) {
    submitFocused = true
    model.setEndpoint(directionsEndpoint(route.from), for: .from)
    model.setEndpoint(directionsEndpoint(route.to), for: .to)
    model.runQuery()
}

/// 삭제 포커스: 다음 항목 → 이전 항목 → 목록 소멸 시 조회 버튼(스펙 §1.5,
/// endpoint 시트의 마이크 행에 대응하는 이 화면의 안정 착지점).
private func deleteRecentRoute(_ route: RecentRoute) {
    guard let index = model.recentRoutes.firstIndex(of: route) else { return }
    model.removeRecentRoute(route)
    AccessibilityNotification.Announcement(appLocalized("recent.deleted")).post()
    if model.recentRoutes.isEmpty {
        submitFocused = true
        return
    }
    focusedRecentRoute = model.recentRoutes[min(index, model.recentRoutes.count - 1)]
}

private func clearRecentRoutes() {
    model.clearRecentRoutes()
    AccessibilityNotification.Announcement(appLocalized("recentRoutes.cleared")).post()
    submitFocused = true
}
```

- [ ] **Step 4: 빌드 게이트** — Run: `cd ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -5` → `BUILD SUCCEEDED`. 이어 `node ios/scripts/check-xcstrings-keys.mjs` 통과(이제 4키 전부 참조됨).

- [ ] **Step 5: 커밋**

```bash
git add ios/Gildongmu/Directions/DirectionsTabView.swift ios/Gildongmu/Resources/Localizable.xcstrings
git commit -m "feat(ios): 길찾기 탭 최근 경로 섹션 — 활성화 즉시 조회 + 조회 버튼 포커스 선점

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- ios/Gildongmu/Directions/DirectionsTabView.swift ios/Gildongmu/Resources/Localizable.xcstrings
```

---

### Task 5: 릴리스 노트 파이프라인 (스크립트 + 가드 + 번들 JSON)

**Files:**
- Create: `scripts/build-release-notes.mjs`
- Create(생성물): `ios/Gildongmu/Resources/release-notes.json`
- Test: `src/lib/__tests__/release-notes-bundle.test.ts`
- Modify: `CLAUDE.md` (개발 규칙의 iOS 릴리스 문장에 스크립트 실행 추가)

**Interfaces:**
- Consumes: `docs/appstore/release-notes.md`(정본 — 수정하지 않는다).
- Produces (Task 6이 사용): `release-notes.json` = `[{ "version": "1.4", "ko": "…", "en": "…" }, …]`(md 등장 순서=최신순). 스크립트 export `parseReleaseNotes(md)`.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/__tests__/release-notes-bundle.test.ts`(mjs 직접 import는 `build-audio-signals.test.ts` 선례):

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseReleaseNotes } from "../../../scripts/build-release-notes.mjs";

const REPO_ROOT = join(__dirname, "..", "..", "..");

const md = (body: string) => `# 머리말\n\n작성 규칙 프로즈.\n\n---\n\n${body}`;

describe("parseReleaseNotes", () => {
  it("버전별 ko·en 코드블록을 추출한다(등장 순서 보존)", () => {
    const notes = parseReleaseNotes(md(
      "## 1.4 (빌드 10)\n\n제출 메모.\n\n### ko\n\n```\n새로운 기능\n- 가\n```\n\n### en\n\n```\nNew\n- a\n```\n\n## 1.3 (빌드 9)\n\n### ko\n\n```\n개선\n```\n\n### en\n\n```\nImproved\n```\n",
    ));
    expect(notes).toEqual([
      { version: "1.4", ko: "새로운 기능\n- 가", en: "New\n- a" },
      { version: "1.3", ko: "개선", en: "Improved" },
    ]);
  });

  it("ko·en 둘 다 없는 버전은 제외한다(1.0형 — What's New 없는 첫 출시)", () => {
    const notes = parseReleaseNotes(md(
      "## 1.1 (빌드 7)\n\n### ko\n\n```\n가\n```\n\n### en\n\n```\na\n```\n\n## 1.0 (빌드 6)\n\n첫 출시라 What's New가 없다.\n",
    ));
    expect(notes.map((n) => n.version)).toEqual(["1.1"]);
  });

  it("한쪽 언어만 있으면 throw한다(불완전 데이터로 조용히 출시 금지)", () => {
    expect(() => parseReleaseNotes(md(
      "## 1.2 (빌드 8)\n\n### ko\n\n```\n가\n```\n",
    ))).toThrow(/1\.2/);
  });
});

describe("번들 드리프트 가드", () => {
  it("release-notes.json이 md 정본과 일치한다", () => {
    const source = readFileSync(join(REPO_ROOT, "docs", "appstore", "release-notes.md"), "utf8");
    const bundled = JSON.parse(readFileSync(
      join(REPO_ROOT, "ios", "Gildongmu", "Resources", "release-notes.json"), "utf8"));
    expect(
      bundled,
      "release-notes.md가 바뀌었다 — `node scripts/build-release-notes.mjs`로 번들을 재생성할 것",
    ).toEqual(parseReleaseNotes(source));
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/lib/__tests__/release-notes-bundle.test.ts` → FAIL(스크립트 없음).

- [ ] **Step 3: 스크립트 작성** — `scripts/build-release-notes.mjs`:

```js
#!/usr/bin/env node
// docs/appstore/release-notes.md(What's New 정본) → ios/Gildongmu/Resources/release-notes.json
// (설정 > 업데이트 이력 화면의 번들 소스, 스펙 2026-08-10 §2.1)
//
// 파서 규칙: `## <버전> (빌드 N)` 섹션 안 `### ko`/`### en` 각각의 첫 fenced 코드블록이
// 본문. 둘 다 없는 버전은 제외(1.0 — What's New 없는 첫 출시가 정본), 한쪽만 있으면
// throw(불완전 데이터로 조용히 출시되는 것을 막는다). 드리프트는
// src/lib/__tests__/release-notes-bundle.test.ts가 강제한다(이 파서를 그대로 import).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(REPO_ROOT, 'docs', 'appstore', 'release-notes.md');
const OUTPUT = path.join(REPO_ROOT, 'ios', 'Gildongmu', 'Resources', 'release-notes.json');

export function parseReleaseNotes(md) {
  const notes = [];
  for (const section of md.split(/^## /m).slice(1)) {
    const header = section.slice(0, section.indexOf('\n'));
    const version = header.match(/^(\d+(?:\.\d+)*) \(빌드 \d+\)/)?.[1];
    if (!version) throw new Error(`버전 헤더 형식 아님: "## ${header}"`);
    const ko = languageBlock(section, 'ko');
    const en = languageBlock(section, 'en');
    if (ko === null && en === null) continue;
    if (ko === null || en === null) {
      throw new Error(`${version}: ko·en 중 한쪽만 있다 — 스펙 §2.1 위반(불완전 데이터)`);
    }
    notes.push({ version, ko, en });
  }
  return notes;
}

// `### <lang>` 하위 절의 첫 fenced 코드블록. 절 분할이 먼저라 ko 검색이 en 블록을
// 넘겨 잡는 일이 구조적으로 없다.
function languageBlock(section, lang) {
  const sub = section.split(/^### /m).slice(1).find((s) => s.startsWith(`${lang}\n`));
  const body = sub?.match(/```\n([\s\S]*?)\n```/)?.[1];
  return body ?? null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const notes = parseReleaseNotes(readFileSync(SOURCE, 'utf8'));
  writeFileSync(OUTPUT, `${JSON.stringify(notes, null, 2)}\n`);
  console.log(`release-notes.json: ${notes.length}개 버전 (최신 ${notes[0]?.version})`);
}
```

- [ ] **Step 4: 생성 실행 + 통과 확인**

Run: `node scripts/build-release-notes.mjs` → `release-notes.json: 4개 버전 (최신 1.4)` (1.1~1.4, 1.0 제외).
Run: `npx vitest run src/lib/__tests__/release-notes-bundle.test.ts` → PASS.
Run: `python3 -c "import json; d=json.load(open('ios/Gildongmu/Resources/release-notes.json')); print([n['version'] for n in d]); assert all(n['ko'] and n['en'] for n in d)"` → 실데이터 눈검증(첫 항목 ko가 "새로운 기능"으로 시작하는지 출력 확인).

- [ ] **Step 5: CLAUDE.md 릴리스 규칙 1줄** — 개발 규칙 절의 "iOS 릴리스는 `docs/appstore/release-notes.md`에 What's New를 함께 남긴다(ASC에 입력한 문구 그대로가 정본)." 문장 뒤에 이어붙임: `노트를 적으면 \`node scripts/build-release-notes.mjs\`로 번들 JSON(설정>업데이트 이력 소스)을 재생성한다 — 잊으면 release-notes-bundle 드리프트 테스트가 잡는다.`

- [ ] **Step 6: 커밋**

```bash
git add scripts/build-release-notes.mjs ios/Gildongmu/Resources/release-notes.json src/lib/__tests__/release-notes-bundle.test.ts CLAUDE.md
git commit -m "feat(release-notes): md 정본 → iOS 번들 JSON 파이프라인 + 드리프트 가드

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- scripts/build-release-notes.mjs ios/Gildongmu/Resources/release-notes.json src/lib/__tests__/release-notes-bundle.test.ts CLAUDE.md
```

---

### Task 6: iOS 설정 업데이트 이력 화면

**Files:**
- Create: `ios/Gildongmu/ReleaseNotesView.swift`
- Modify: `ios/Gildongmu/SettingsView.swift`
- Modify: `ios/i18n/ios-extra/{ko,en,es,fr,it,ja}.json` (settings 3키)
- Modify(재생성): `ios/Gildongmu/Resources/Localizable.xcstrings`

**Interfaces:**
- Consumes: Task 5의 `release-notes.json`(번들 리소스, 동기화 그룹이라 pbxproj 무편집), 기존 `appLocalized`·`AppLanguage.dataLocale`.
- Produces: 없음(말단 UI).

- [ ] **Step 1: ios-extra 키 추가** — 각 로케일 `ios/i18n/ios-extra/<locale>.json`의 `ios.settings`에:

```jsonc
// ko: "releaseNotes": "업데이트 이력", "releaseNotesVersion": "버전 {version}", "releaseNotesError": "업데이트 이력을 불러올 수 없습니다"
// en: "Release notes", "Version {version}", "Could not load release notes"
// es: "Notas de la versión", "Versión {version}", "No se pudieron cargar las notas de la versión"
// fr: "Notes de version", "Version {version}", "Impossible de charger les notes de version"
// it: "Note di rilascio", "Versione {version}", "Impossibile caricare le note di rilascio"
// ja: "アップデート履歴", "バージョン {version}", "アップデート履歴を読み込めませんでした"
```

Run: `node ios/scripts/messages-to-xcstrings.mjs app`

- [ ] **Step 2: ReleaseNotesView 작성** — `ios/Gildongmu/ReleaseNotesView.swift`:

```swift
import SwiftUI

/// 설정 > 업데이트 이력(스펙 2026-08-10 §2). 정본 docs/appstore/release-notes.md를
/// scripts/build-release-notes.mjs가 굳힌 번들 release-notes.json을 표시한다.
/// 언어는 ko만 한국어, 나머지는 en 폴백(정본이 2벌 — 스펙 §2.3).
struct ReleaseNote: Decodable, Identifiable {
    let version: String
    let ko: String
    let en: String
    var id: String { version }
}

enum ReleaseNotesLoader {
    /// 리소스 부재·디코드 실패는 nil — 화면이 오류 1행으로 정직하게 알린다
    /// (빈 목록으로 위장 금지, 3-state).
    static func load(bundle: Bundle = .main) -> [ReleaseNote]? {
        guard let url = bundle.url(forResource: "release-notes", withExtension: "json"),
              let data = try? Data(contentsOf: url)
        else { return nil }
        return try? JSONDecoder().decode([ReleaseNote].self, from: data)
    }
}

struct ReleaseNotesView: View {
    private let notes = ReleaseNotesLoader.load()

    var body: some View {
        List {
            if let notes {
                ForEach(notes) { note in
                    Section {
                        // 한 줄 = 한 접근성 객체: 본문을 빈 줄 제외 줄 단위 Text로.
                        // "새로운 기능"/"개선" 소제목 줄도 본문 행(heading 부여는 과잉).
                        ForEach(Array(lines(of: note).enumerated()), id: \.offset) { _, line in
                            Text(line)
                        }
                    } header: {
                        // 버전 heading이 로터 헤딩 점프의 버전 간 이동 수단(스펙 §2.2).
                        Text(appLocalized("ios.settings.releaseNotesVersion", note.version))
                            .accessibilityAddTraits(.isHeader)
                    }
                }
            } else {
                Text(appLocalized("ios.settings.releaseNotesError"))
            }
        }
        .navigationTitle(appLocalized("ios.settings.releaseNotes"))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func lines(of note: ReleaseNote) -> [String] {
        let body = AppLanguage.dataLocale == "ko" ? note.ko : note.en
        return body.split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
}
```

- [ ] **Step 3: SettingsView 진입점** — `aiSection` Section 닫힘 직후에:

```swift
Section {
    NavigationLink(appLocalized("ios.settings.releaseNotes")) {
        ReleaseNotesView()
    }
}
```

- [ ] **Step 4: 빌드 게이트 + 린터** — Run: `cd ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -5` → `BUILD SUCCEEDED`; `node ios/scripts/check-xcstrings-keys.mjs` 통과.

- [ ] **Step 5: 시뮬 실측(xcodebuildmcp CLI)** — `simulator build-and-run` 후 `ui-automation snapshot-ui`로 설정→업데이트 이력 진입, 버전 헤딩·줄 단위 행이 접근성 트리에 잡히는지 확인(라벨 회귀 신호용 — 정본 판정은 실기기).

- [ ] **Step 6: 커밋**

```bash
git add ios/Gildongmu/ReleaseNotesView.swift ios/Gildongmu/SettingsView.swift ios/i18n/ios-extra/ko.json ios/i18n/ios-extra/en.json ios/i18n/ios-extra/es.json ios/i18n/ios-extra/fr.json ios/i18n/ios-extra/it.json ios/i18n/ios-extra/ja.json ios/Gildongmu/Resources/Localizable.xcstrings
git commit -m "feat(ios): 설정 업데이트 이력 화면 — 번들 릴리스 노트 열람(버전 heading 로터 점프)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- ios/Gildongmu/ReleaseNotesView.swift ios/Gildongmu/SettingsView.swift ios/i18n/ios-extra/ko.json ios/i18n/ios-extra/en.json ios/i18n/ios-extra/es.json ios/i18n/ios-extra/fr.json ios/i18n/ios-extra/it.json ios/i18n/ios-extra/ja.json ios/Gildongmu/Resources/Localizable.xcstrings
```

---

### Task 7: 통합 검증 · 문서 분배 · 배포

**Files:**
- Modify: `CHANGELOG.md`(항목 추가), `PROGRESS.md`(상태 한 줄), `../PORTS.md`(dodo 이식 후보 1행)

**Interfaces:** Consumes: Task 1~6 전부 완료 상태.

- [ ] **Step 1: 전체 게이트** — Run: `npm run test:run && npm run lint && npm run build` 전부 통과, `cd ios/GildongmuKit && swift test` 통과.
- [ ] **Step 2: a11y-auditor 서브에이전트 점검** — 대상: DirectionsView 최근 경로 섹션, DirectionsTabView 섹션, ReleaseNotesView. 기준은 접근성 헌장(과잉 ARIA 제거 포함). 지적은 계층 대조 후 반영.
- [ ] **Step 3: 문서 분배** — CHANGELOG.md에 2026-08-10 항목(2~4줄 + spec 링크), PROGRESS.md 상태 한 줄 갱신, 워크스페이스 `PORTS.md`의 dodo-planet 섹션에 `[open] 설정 릴리스 노트 화면(md→번들 JSON 파이프라인) — gildongmu@<SHA>, spec 2026-08-10` 1행.
- [ ] **Step 4: 커밋 + push** — 문서 3건 pathspec 커밋 → `git push origin main`(웹 자동 배포).
- [ ] **Step 5: 실기기 배포** — 기기 연결 확인 후 `cd ios && ./deploy-device.sh`(Debug=공식판 검증용). 실기기 VoiceOver 판정 항목(활성화 직후 조회 버튼 포커스 유지 / 마지막 항목 삭제 후 조회 버튼 착지 / 릴리스 노트 헤딩 로터 점프)을 위원장에게 보고하고 확인 요청.

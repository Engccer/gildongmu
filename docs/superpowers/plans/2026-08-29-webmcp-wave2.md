# WebMCP 도구층 W2 구현 플랜 — 상시 집합 7개

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱 루트가 도구 7개(`describe_app`·`search_places`·`get_place_info`·`plan_directions`·`get_transit_route_detail`·`get_route_steps`·`read_current_view`)를 상시 등록하고, 도구가 필요한 화면으로 스스로 이동해 화면이 그린 문장을 돌려주게 만들며, W1 도구 5개와 그 소비물을 삭제한다.

**Architecture:** 화면(홈·길찾기·상세)은 마운트 effect에서 자기 브릿지를 `view-registry`(모듈 싱글턴)에 게시하고, 도구는 실행 시점에 그것을 읽는다. 잠금을 지나는 도구는 `tool-lock`에서 `op` 토큰(30초 상한)을 받아 화면 이동·축 실행·정착 대기를 전부 거기에 결박한다. 손잡이는 `place-refs`의 불투명 `ref`(문서 nonce·검색 세대·출처·순번)이고 해석은 `runSearch` 정착 시 동결한 스냅샷에서 한 번만 한다. 사람 문장은 `src/lib/place-lines/*`(컴포넌트·도구 공용)에서 나온다.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Vitest 4(node-env 기본, 컴포넌트 테스트는 `// @vitest-environment jsdom` + @testing-library/react) / next-intl 4. `document.modelContext` 직접 등록(`usewebmcp` 미도입).

**Spec:** `docs/superpowers/specs/2026-08-29-webmcp-wave2-design.md`(W1 공통 계약은 `docs/superpowers/specs/2026-08-27-webmcp-tool-layer-design.md` §3.0·§4·§5·§6)

## Global Constraints

- 출력은 `finish(value, SHAPE, plan)`만 지난다. allowlist에 좌표성 키(`lat`·`lng`·`coord`·`coords`·`geometry`·`pathCoords`)를 넣지 않는다. 문자열을 자르지 않는다(항목 단위 생략만). 상한 1,500자.
- 도구 이름 30자 이내·`[a-z_]`, 설명 500자 이내, 파라미터 설명 150자 이내, 영어 고정 문자열.
- 전부 정적 등록(`useWebMcpTools`, 루트 1회). 조건부 등록 금지. 런타임 부재는 침묵.
- 사람 문장은 화면과 같은 함수에서 나온다. **도구·lib가 컴포넌트 모듈(`src/components/*`)의 named export를 import하지 않는다**(기존 테스트의 모듈 목킹으로 스위트가 죽는다 — 2026-08-27 실측 40건).
- `src/lib/**`는 React/Next 비의존. 브릿지·훅만 `src/hooks/**`·컴포넌트.
- 도구층이 능동적으로 옮기는 포커스는 0. 한 도구 호출에 착지는 최대 하나(최종 화면의 기존 착지). 중간 착지·완료 통지는 `source:"tool"`/`op` 억제 신호로 건너뛴다. 오류 통지는 억제하지 않는다.
- 사용자 조작은 언제나 도구를 이긴다(도구는 `superseded`). 도구는 모달(채팅·현재 위치 지정)을 닫지 않고 `modalOpen`으로 거절한다.
- 삭제 승인 조건은 참조 0이 아니라 **삭제 전에 고정한 사용자 동작 회귀 테스트가 삭제 뒤에도 통과하는 것**이다(Task 11).
- 커밋은 `git add <신규 경로>` 뒤 `git commit -- <경로들>` pathspec. `git add -A` 금지. 메시지 한국어, 푸터 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- 테스트는 `npm run test:run -- <파일>`; 전체 게이트 `npm run test:run`·`npm run lint`·`npx tsc --noEmit`(Vitest green ≠ 타입 통과).
- privacy `privacy.agent` 문안 변경은 **위원장 TextEdit 왕복**으로 확정(Task 17, 배포 전 게이트). 그 전엔 문자열을 건드리지 않는다.
- **구현 방식 판정**(AUTONOMY §구현 방식): Task 1~5(기반 모듈)는 서로 독립이라 subagent 병렬 가능(파일 겹침 0). Task 6(place-lines 6축)은 동형 반복이라 병렬 가능. Task 7~10(화면 배선)은 브릿지 인터페이스(Task 3·7)가 확정된 뒤 화면별 독립이지만 `context.ts`를 셋이 함께 만지므로 **순차**. Task 11(삭제)은 Task 10 뒤 inline. Task 12~16(도구)은 `manifest.ts`·`index.ts`를 공유하므로 순차. 근거: 수정 파일 겹침(`context.ts`·`manifest.ts`·`index.ts`·`PlaceSearch.tsx`)과 선행 관계(브릿지 → 도구).

---

### Task 1: 사유 코드·좌표쌍 스캔 강화

**Files:**
- Modify: `src/lib/webmcp/types.ts`(`ToolReason`·`REASON_FLAGS`)
- Modify: `src/lib/webmcp/output.ts`(`assertNoCoordinates` 추가)
- Test: `src/lib/webmcp/__tests__/output.test.ts`(기존 파일에 describe 추가)

**Interfaces:**
- Produces: `ToolReason`에 `"staleResult" | "notConfigured" | "notApplicable" | "viewChanging" | "geocodeFailed" | "modalOpen"`; `export function assertNoCoordinates(serialized: string): string | null`(위반 설명 또는 null).

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/webmcp/__tests__/output.test.ts 에 추가
import { assertNoCoordinates } from "../output";
import { failure } from "../types";

describe("W2 사유 코드·좌표 스캔", () => {
  it("새 사유 6종의 플래그", () => {
    expect(failure("staleResult")).toMatchObject({ retryable: true, userActionRequired: false });
    expect(failure("notConfigured")).toMatchObject({ retryable: false, userActionRequired: false });
    expect(failure("notApplicable")).toMatchObject({ retryable: false, userActionRequired: false });
    expect(failure("viewChanging")).toMatchObject({ retryable: true, userActionRequired: false });
    expect(failure("geocodeFailed")).toMatchObject({ retryable: true, userActionRequired: false });
    expect(failure("modalOpen")).toMatchObject({ retryable: false, userActionRequired: true });
  });
  it("직렬화 결과에서 좌표 쿼리 이름·십진 좌표쌍·숫자 2원소 배열을 잡는다", () => {
    expect(assertNoCoordinates('{"url":"https://a.b/p?lat=37.5"}')).not.toBeNull();
    expect(assertNoCoordinates('{"line":"37.5231,127.1234"}')).not.toBeNull();
    expect(assertNoCoordinates('{"p":[37.5231,127.1234]}')).not.toBeNull();
    expect(assertNoCoordinates('{"url":"https://a.b/place/37.52,127.12"}')).not.toBeNull();
    expect(assertNoCoordinates('{"line":"5호선 상행 첫차 05:30, 막차 00:12","n":[1,2]}')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:run -- src/lib/webmcp/__tests__/output.test.ts` → `assertNoCoordinates is not a function`, 사유 타입 오류.

- [ ] **Step 3: 구현**

`types.ts` `ToolReason` union 끝에 여섯 줄을 더하고 `REASON_FLAGS`에:
```ts
  staleResult: { retryable: true, userActionRequired: false },
  notConfigured: { retryable: false, userActionRequired: false },
  notApplicable: { retryable: false, userActionRequired: false },
  viewChanging: { retryable: true, userActionRequired: false },
  geocodeFailed: { retryable: true, userActionRequired: false },
  modalOpen: { retryable: false, userActionRequired: true },
```
`output.ts` 끝에:
```ts
const COORD_QUERY_RE = /[?&](lat|lng|lon|x|y)=/i;
const COORD_PAIR_RE = /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/;
const COORD_ARRAY_RE = /\[\s*-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}\s*\]/;

/** 직렬화된 도구 출력에 좌표가 섞였는지(테스트·개발 가드). 위반이면 설명, 아니면 null. */
export function assertNoCoordinates(serialized: string): string | null {
  if (COORD_QUERY_RE.test(serialized)) return "coordinate query parameter";
  if (COORD_PAIR_RE.test(serialized)) return "decimal coordinate pair";
  if (COORD_ARRAY_RE.test(serialized)) return "coordinate array";
  return null;
}
```
(숫자 2원소 배열은 소수 3자리 이상 쌍만 잡는다 — `[1,2]` 같은 순번 배열은 통과.)

- [ ] **Step 4: 통과 확인** — 같은 명령, PASS.
- [ ] **Step 5: 커밋** — `git commit -m "feat(webmcp): W2 사유 코드 6종·좌표쌍 스캔" -- src/lib/webmcp/types.ts src/lib/webmcp/output.ts src/lib/webmcp/__tests__/output.test.ts`

---

### Task 2: 단일 실행 잠금 `tool-lock.ts`

**Files:**
- Create: `src/lib/webmcp/tool-lock.ts`
- Test: `src/lib/webmcp/__tests__/tool-lock.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Op { readonly id: number; readonly name: string; readonly signal: AbortSignal; readonly startedAt: number; isLive(): boolean }
export function acquireOp(name: string, hostSignal: AbortSignal | undefined, now?: number): Op | { busy: string }
export function releaseOp(op: Op): void
export function runningToolName(): string | null
export const OP_TIMEOUT_MS = 30_000
export function __resetToolLockForTest(): void
```

- [ ] **Step 1: 실패하는 테스트**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { OP_TIMEOUT_MS, __resetToolLockForTest, acquireOp, releaseOp, runningToolName } from "../tool-lock";

afterEach(() => { __resetToolLockForTest(); vi.useRealTimers(); });

describe("tool-lock(spec §3.0)", () => {
  it("둘째 호출은 busy{running}이고 release 뒤 다시 잡힌다", () => {
    const a = acquireOp("search_places", undefined);
    expect("busy" in a).toBe(false);
    expect(acquireOp("get_place_info", undefined)).toEqual({ busy: "search_places" });
    expect(runningToolName()).toBe("search_places");
    releaseOp(a as Exclude<typeof a, { busy: string }>);
    expect(runningToolName()).toBeNull();
    expect("busy" in acquireOp("get_place_info", undefined)).toBe(false);
  });
  it("전체 상한이 지나면 op.signal이 끊기고 isLive()가 false다", () => {
    vi.useFakeTimers();
    const op = acquireOp("x", undefined) as Exclude<ReturnType<typeof acquireOp>, { busy: string }>;
    vi.advanceTimersByTime(OP_TIMEOUT_MS + 1);
    expect(op.signal.aborted).toBe(true);
    expect(op.isLive()).toBe(false);
    expect(runningToolName()).toBeNull();
  });
  it("호스트 signal abort가 op에 전파되고 잠금이 풀린다", () => {
    const host = new AbortController();
    const op = acquireOp("x", host.signal) as Exclude<ReturnType<typeof acquireOp>, { busy: string }>;
    host.abort();
    expect(op.signal.aborted).toBe(true);
    expect(runningToolName()).toBeNull();
  });
  it("release된 옛 op는 isLive() false — 늦은 완료 무시의 근거", () => {
    const op = acquireOp("x", undefined) as Exclude<ReturnType<typeof acquireOp>, { busy: string }>;
    releaseOp(op);
    expect(op.isLive()).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** — 모듈 없음.
- [ ] **Step 3: 구현**

```ts
/**
 * 도구층 단일 실행 잠금 + operation 토큰(spec §3.0). 화면을 옮기는 도구는 한 번에 하나다 —
 * 두 도구가 서로 다른 화면으로 끌고 가는 경합을 구조적으로 없앤다. `op`는 전체 상한을 가지며
 * 만료·release된 op의 늦은 완료는 도구 결과에 반영되지 않는다(호출자가 `isLive()`를 본다).
 */
import { anySignal } from "./types";

export const OP_TIMEOUT_MS = 30_000;

export interface Op {
  readonly id: number;
  readonly name: string;
  readonly signal: AbortSignal;
  readonly startedAt: number;
  isLive(): boolean;
}

let current: { op: Op; controller: AbortController; timer: ReturnType<typeof setTimeout> } | null = null;
let seq = 0;

export function acquireOp(name: string, hostSignal: AbortSignal | undefined, now = Date.now()): Op | { busy: string } {
  if (current) return { busy: current.op.name };
  const controller = new AbortController();
  const id = ++seq;
  const op: Op = {
    id, name, startedAt: now,
    signal: anySignal([controller.signal, hostSignal]),
    isLive: () => current?.op.id === id && !controller.signal.aborted && !(hostSignal?.aborted ?? false),
  };
  const timer = setTimeout(() => { controller.abort(new Error("timeout")); releaseOp(op); }, OP_TIMEOUT_MS);
  hostSignal?.addEventListener("abort", () => releaseOp(op), { once: true });
  current = { op, controller, timer };
  return op;
}

export function releaseOp(op: Op): void {
  if (current?.op.id !== op.id) return;
  clearTimeout(current.timer);
  current = null;
}

export function runningToolName(): string | null { return current?.op.name ?? null; }

export function __resetToolLockForTest(): void {
  if (current) clearTimeout(current.timer);
  current = null; seq = 0;
}
```

- [ ] **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `git add src/lib/webmcp/tool-lock.ts src/lib/webmcp/__tests__/tool-lock.test.ts && git commit -m "feat(webmcp): 단일 실행 잠금 tool-lock(op 토큰·30초 상한)" -- src/lib/webmcp/tool-lock.ts src/lib/webmcp/__tests__/tool-lock.test.ts`

---

### Task 3: 뷰 레지스트리 `view-registry.ts`

**Files:**
- Create: `src/lib/webmcp/view-registry.ts`
- Test: `src/lib/webmcp/__tests__/view-registry.test.ts`

**Interfaces:**
- Produces:
```ts
export type ViewName = "home" | "directions" | "place" | "nearby";
export interface Navigator {
  toHome(op: Op): Promise<void>;          // 유한 루프 언와인드(§3.2) — 화면이 구현
  toDirections(op: Op): void;             // openDirections(null)
  toPlace(place: Place, op: Op): void;    // requestOpenPlace
  isModalOpen(): boolean;
}
export function publishView<B>(view: ViewName, bridge: B, identity?: string): void
export function withdrawView(view: ViewName, bridge: unknown): void
export function markNearby(open: boolean): void
export function currentSeq(): number
export function currentView(): ViewName | "changing" | null
export function bridgeOf<B>(view: ViewName): { bridge: B; identity?: string; seq: number } | null
export function waitForView<B>(view: ViewName, match: { placeId?: string; publishedAfter?: number }, op: Op, timeoutMs?: number): Promise<B>  // reject Error("viewChanging"|"aborted")
export function setNavigator(nav: Navigator | null): void
export function navigator(): Navigator | null
export function markChanging(op: Op | null): void   // 도구 이동 중 표시
export function __resetViewRegistryForTest(): void
```

- [ ] **Step 1: 실패하는 테스트**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetToolLockForTest, acquireOp, type Op } from "../tool-lock";
import { __resetViewRegistryForTest, bridgeOf, currentSeq, currentView, markChanging, publishView, waitForView, withdrawView } from "../view-registry";

const op = () => acquireOp("t", undefined) as Op;
afterEach(() => { __resetViewRegistryForTest(); __resetToolLockForTest(); vi.useRealTimers(); });

describe("view-registry(spec §5.2)", () => {
  it("게시·철회·정체성 가드: 옛 브릿지의 withdraw는 새 게시를 지우지 않는다", () => {
    const a = { tag: "A" }, b = { tag: "B" };
    publishView("place", a, "p1");
    publishView("place", b, "p2");
    withdrawView("place", a);
    expect(bridgeOf("place")?.identity).toBe("p2");
    expect(currentView()).toBe("place");
  });
  it("waitForView는 뷰 이름만으로 일치하지 않는다 — placeId·publishedAfter", async () => {
    publishView("place", { tag: "A" }, "p1");
    const seqBefore = currentSeq();
    const o = op();
    const p = waitForView<{ tag: string }>("place", { placeId: "p2" }, o, 50);
    publishView("place", { tag: "B" }, "p2");
    await expect(p).resolves.toEqual({ tag: "B" });
    const q = waitForView("directions", { publishedAfter: seqBefore }, o, 50);
    publishView("directions", { tag: "D" });
    await expect(q).resolves.toEqual({ tag: "D" });
  });
  it("이미 일치 게시면 즉시, 상한 초과는 viewChanging", async () => {
    publishView("directions", { tag: "D" });
    await expect(waitForView("directions", { publishedAfter: 0 }, op(), 10)).resolves.toEqual({ tag: "D" });
    __resetViewRegistryForTest();
    await expect(waitForView("place", { placeId: "x" }, op(), 10)).rejects.toThrow("viewChanging");
  });
  it("markChanging 중엔 currentView가 changing이다", () => {
    publishView("home", { tag: "H" });
    const o = op();
    markChanging(o);
    expect(currentView()).toBe("changing");
    markChanging(null);
    expect(currentView()).toBe("home");
  });
});
```

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현**

```ts
/**
 * 뷰 레지스트리(spec §5.2) — 어느 화면이 어떤 정체성으로 지금 브릿지를 게시했는가. React 비의존.
 * 등록 교체가 없으므로 viewEpoch·ready는 없다. 이동 뒤 대기는 뷰 이름이 아니라 정체성(placeId·
 * 게시 순번)에 결박한다 — 장소 A 게시 중 B 요청이 조기 성공하지 않게(리뷰 #1).
 */
import type { Place } from "@/lib/types";
import type { Op } from "./tool-lock";

export type ViewName = "home" | "directions" | "place" | "nearby";
export interface Navigator {
  toHome(op: Op): Promise<void>;
  toDirections(op: Op): void;
  toPlace(place: Place, op: Op): void;
  isModalOpen(): boolean;
}
interface Entry { bridge: unknown; identity?: string; seq: number }

const entries = new Map<ViewName, Entry>();
const listeners = new Set<() => void>();
let seq = 0;
let nearbyOpen = false;
let nav: Navigator | null = null;
let changing: Op | null = null;
const PRIORITY: ViewName[] = ["directions", "nearby", "place", "home"];

export function publishView<B>(view: ViewName, bridge: B, identity?: string): void {
  entries.set(view, { bridge, identity, seq: ++seq });
  for (const l of listeners) l();
}
export function withdrawView(view: ViewName, bridge: unknown): void {
  if (entries.get(view)?.bridge === bridge) entries.delete(view);
  for (const l of listeners) l();
}
export function markNearby(open: boolean): void { nearbyOpen = open; for (const l of listeners) l(); }
export function currentSeq(): number { return seq; }
export function bridgeOf<B>(view: ViewName): { bridge: B; identity?: string; seq: number } | null {
  const e = entries.get(view);
  return e ? { bridge: e.bridge as B, identity: e.identity, seq: e.seq } : null;
}
export function currentView(): ViewName | "changing" | null {
  if (changing?.isLive()) return "changing";
  for (const v of PRIORITY) {
    if (v === "nearby" ? nearbyOpen : entries.has(v)) return v;
  }
  return null;
}
function matches(e: Entry | undefined, match: { placeId?: string; publishedAfter?: number }): boolean {
  if (!e) return false;
  if (match.placeId !== undefined && e.identity !== match.placeId) return false;
  if (match.publishedAfter !== undefined && e.seq <= match.publishedAfter) return false;
  return true;
}
export function waitForView<B>(view: ViewName, match: { placeId?: string; publishedAfter?: number }, op: Op, timeoutMs = 2_000): Promise<B> {
  const now = entries.get(view);
  if (matches(now, match)) return Promise.resolve(now!.bridge as B);
  return new Promise<B>((resolve, reject) => {
    const done = (fn: () => void) => { listeners.delete(check); clearTimeout(timer); op.signal.removeEventListener("abort", onAbort); fn(); };
    const check = () => { const e = entries.get(view); if (matches(e, match)) done(() => resolve(e!.bridge as B)); };
    const timer = setTimeout(() => done(() => reject(new Error("viewChanging"))), timeoutMs);
    const onAbort = () => done(() => reject(new Error("aborted")));
    op.signal.addEventListener("abort", onAbort, { once: true });
    listeners.add(check);
  });
}
export function setNavigator(n: Navigator | null): void { nav = n; }
export function navigator(): Navigator | null { return nav; }
export function markChanging(op: Op | null): void { changing = op; }
export function __resetViewRegistryForTest(): void { entries.clear(); listeners.clear(); seq = 0; nearbyOpen = false; nav = null; changing = null; }
```

- [ ] **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(webmcp): 뷰 레지스트리(정체성 결박 대기·navigator)`.

---

### Task 4: 불투명 `ref` `place-refs.ts`

**Files:**
- Create: `src/lib/webmcp/place-refs.ts`
- Test: `src/lib/webmcp/__tests__/place-refs.test.ts`

**Interfaces:**
- Produces:
```ts
export interface SearchSnapshot { attempt: number; query: string; sort: "accuracy" | "review"; places: readonly Place[]; addresses: readonly JusoAddress[] }
export function encodeRef(attempt: number, source: "p" | "a", row: number): string
export type RefResolution = { kind: "place"; place: Place; ref: string } | { kind: "address"; address: JusoAddress; ref: string } | { kind: "staleResult" } | { kind: "notFound" }
export function resolveRef(ref: unknown, snapshot: SearchSnapshot | null): RefResolution
export function __setNonceForTest(n: string): void
```

- [ ] **Step 1: 실패하는 테스트**

```ts
import { describe, expect, it } from "vitest";
import { __setNonceForTest, encodeRef, resolveRef, type SearchSnapshot } from "../place-refs";
import type { JusoAddress, Place } from "@/lib/types";

const place = (id: string): Place => ({ id, name: id, category: "c", address: "a", roadAddress: "r", lat: 37.5, lng: 127.1 });
const addr: JusoAddress = { roadAddr: "서울 중구 세종대로 110", roadAddrPart1: "서울 중구 세종대로 110", jibunAddr: "태평로1가 31", engAddr: "110 Sejong-daero", zipNo: "04524", bdNm: "" };
const snap = (attempt: number): SearchSnapshot => ({ attempt, query: "q", sort: "accuracy", places: [place("p1"), place("p2")], addresses: [addr] });

describe("place-refs(spec §5.3)", () => {
  it("왕복: 장소·주소 ref가 같은 스냅샷에서 풀린다", () => {
    __setNonceForTest("n1");
    const s = snap(3);
    expect(resolveRef(encodeRef(3, "p", 1), s)).toMatchObject({ kind: "place", place: { id: "p2" } });
    expect(resolveRef(encodeRef(3, "a", 0), s)).toMatchObject({ kind: "address", address: { zipNo: "04524" } });
  });
  it("검사 순서: nonce → attempt(staleResult) → row(notFound)", () => {
    __setNonceForTest("n1");
    const r = encodeRef(3, "p", 9);
    expect(resolveRef(r, snap(3))).toEqual({ kind: "notFound" });
    expect(resolveRef(encodeRef(2, "p", 0), snap(3))).toEqual({ kind: "staleResult" });
    __setNonceForTest("n2");
    expect(resolveRef(r, snap(3))).toEqual({ kind: "staleResult" });
    expect(resolveRef("garbage", snap(3))).toEqual({ kind: "notFound" });
    expect(resolveRef(encodeRef(3, "p", 0), null)).toEqual({ kind: "staleResult" });
  });
});
```

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현**

```ts
/**
 * 불투명 ref(spec §5.3): `{nonce}.{attempt}.{source}.{row}` base36. nonce는 문서 로드마다 새 값 —
 * 리로드 뒤 옛 ref가 새 결과의 같은 순번으로 풀리지 않게(리뷰 #7). 해석은 정착 시 동결한 스냅샷에서
 * 한 번이고 가변 화면 상태를 다시 읽지 않는다.
 */
import type { JusoAddress, Place } from "@/lib/types";

export interface SearchSnapshot { attempt: number; query: string; sort: "accuracy" | "review"; places: readonly Place[]; addresses: readonly JusoAddress[] }
export type RefResolution =
  | { kind: "place"; place: Place; ref: string }
  | { kind: "address"; address: JusoAddress; ref: string }
  | { kind: "staleResult" }
  | { kind: "notFound" };

let nonce = Math.floor(Math.random() * 36 ** 6).toString(36);
const REF_RE = /^([a-z0-9]+)\.([a-z0-9]+)\.([pa])\.([a-z0-9]+)$/;

export function encodeRef(attempt: number, source: "p" | "a", row: number): string {
  return `${nonce}.${attempt.toString(36)}.${source}.${row.toString(36)}`;
}
export function resolveRef(ref: unknown, snapshot: SearchSnapshot | null): RefResolution {
  if (typeof ref !== "string") return { kind: "notFound" };
  const m = REF_RE.exec(ref);
  if (!m) return { kind: "notFound" };
  if (m[1] !== nonce) return { kind: "staleResult" };
  if (!snapshot || parseInt(m[2], 36) !== snapshot.attempt) return { kind: "staleResult" };
  const row = parseInt(m[4], 36);
  if (m[3] === "p") {
    const place = snapshot.places[row];
    return place ? { kind: "place", place, ref } : { kind: "notFound" };
  }
  const address = snapshot.addresses[row];
  return address ? { kind: "address", address, ref } : { kind: "notFound" };
}
export function __setNonceForTest(n: string): void { nonce = n; }
```

- [ ] **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(webmcp): 불투명 ref(nonce·세대·순번, 동결 스냅샷 해석)`.

---

### Task 5: 쿨다운·세션 예산 `tool-budget.ts`

**Files:**
- Create: `src/lib/webmcp/tool-budget.ts`
- Test: `src/lib/webmcp/__tests__/tool-budget.test.ts`

**Interfaces:**
- Produces:
```ts
export type BudgetBucket = "search" | "plan" | "stationArrivals" | "stationTimetable" | "stationFacilities" | "barrierFree";
export function checkBudget(bucket: BudgetBucket, now?: number): { ok: true } | { ok: false; retryAfterMs: number }
export function consumeBudget(bucket: BudgetBucket, now?: number): void
export function __resetToolBudgetForTest(): void
```
쿨다운: search·plan 3,000 / stationArrivals 10,000 / 나머지 60,000. 시간당 30회.

- [ ] **Step 1: 실패하는 테스트**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { __resetToolBudgetForTest, checkBudget, consumeBudget } from "../tool-budget";
afterEach(__resetToolBudgetForTest);
describe("tool-budget(spec §5.5)", () => {
  it("쿨다운 안이면 retryAfterMs가 결정적이다", () => {
    consumeBudget("search", 1_000);
    expect(checkBudget("search", 2_000)).toEqual({ ok: false, retryAfterMs: 2_000 });
    expect(checkBudget("search", 4_000)).toEqual({ ok: true });
    consumeBudget("stationArrivals", 0);
    expect(checkBudget("stationArrivals", 9_999)).toEqual({ ok: false, retryAfterMs: 1 });
  });
  it("시간당 30회를 넘기면 창이 열릴 때까지 cooldown이다", () => {
    for (let i = 0; i < 30; i++) consumeBudget("search", i * 10_000);
    expect(checkBudget("search", 300_000)).toEqual({ ok: false, retryAfterMs: 3_600_000 - 300_000 });
  });
  it("확인만으로는 소비되지 않는다(재직렬화 무과금의 근거)", () => {
    expect(checkBudget("barrierFree", 0)).toEqual({ ok: true });
    expect(checkBudget("barrierFree", 1)).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현**

```ts
/** 쿨다운·세션 예산(spec §5.5) — upstream 키 버킷, 실제 fetch를 일으킬 때만 consume한다. */
export type BudgetBucket = "search" | "plan" | "stationArrivals" | "stationTimetable" | "stationFacilities" | "barrierFree";
const COOLDOWN_MS: Record<BudgetBucket, number> = { search: 3_000, plan: 3_000, stationArrivals: 10_000, stationTimetable: 60_000, stationFacilities: 60_000, barrierFree: 60_000 };
const HOUR_MS = 3_600_000;
const PER_HOUR = 30;
const stamps = new Map<BudgetBucket, number[]>();

export function checkBudget(bucket: BudgetBucket, now = Date.now()): { ok: true } | { ok: false; retryAfterMs: number } {
  const list = (stamps.get(bucket) ?? []).filter((t) => now - t < HOUR_MS);
  stamps.set(bucket, list);
  const last = list[list.length - 1];
  if (last !== undefined && now - last < COOLDOWN_MS[bucket]) return { ok: false, retryAfterMs: COOLDOWN_MS[bucket] - (now - last) };
  if (list.length >= PER_HOUR) return { ok: false, retryAfterMs: list[0] + HOUR_MS - now };
  return { ok: true };
}
export function consumeBudget(bucket: BudgetBucket, now = Date.now()): void {
  const list = stamps.get(bucket) ?? [];
  list.push(now);
  stamps.set(bucket, list);
}
export function __resetToolBudgetForTest(): void { stamps.clear(); }
```

- [ ] **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(webmcp): 쿨다운·세션 예산 버킷`.

---

### Task 6: 줄 조립 `src/lib/place-lines/*` (6축) + 화면 대조

**Files:**
- Create: `src/lib/place-lines/station-meta.ts` · `station-timetable.ts` · `station-facilities.ts` · `station-metro.ts` · `station-arrivals.ts` · `barrier-free.ts`
- Modify: `src/components/StationMeta.tsx` · `StationTimetable.tsx` · `StationFacilities.tsx` · `SeoulMetroFacilities.tsx` · `SubwayArrivalList.tsx` · `BarrierFreeInfo.tsx`(렌더 문장을 새 함수로 교체)
- Test: `src/lib/place-lines/__tests__/place-lines.test.tsx`(jsdom)

**Interfaces:**
- Produces(전부 순수, `t: (key: string, values?: Record<string, string | number>) => string`를 인자로 받는다 — `useTranslations`의 반환값을 화면이 넘긴다):
```ts
// station-meta.ts
export function stationMetaLines(meta: StationMeta, t: T, isEn: boolean): string[]   // [역명 줄, 노선 줄, 운영기관 줄]
// station-timetable.ts
export interface TimetableLineItem { line: string; coverage: TimetableLineCoverage; first?: string; last?: string; direction?: "up" | "down"; text: string }
export function timetableHeaderLine(tt: StationTimetable, t: T): string
export function timetableLineItems(tt: StationTimetable, t: T, isEn: boolean): TimetableLineItem[]
// station-facilities.ts
export function korailFacilityLines(f: StationFacilities, t: T): string[]   // 4줄, 화면 <li>와 동일
// station-metro.ts
export interface MetroGroupItem { name: string; lines: string[] }
export function metroFacilityGroups(f: SeoulMetroFacilities, t: T): MetroGroupItem[]
// station-arrivals.ts
export interface ArrivalItem { line: string; direction: string; message: string; state: { kind: "ok" } }
export function arrivalItems(arrivals: SubwayArrival[], t: T): ArrivalItem[]   // line = joinText(노선 방향, trainLineNm, 급행), message = joinText(message, 현재위치)
// barrier-free.ts
export function barrierFreeLines(d: BarrierFreeDetail): Array<{ label: string; value: string; text: string }>
```

- [ ] **Step 1: 실패하는 테스트** — 축마다 "컴포넌트를 렌더한 `<li>`/`<p>` textContent == 함수 출력" 대조. 예(시설):

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { korailFacilityLines } from "../station-facilities";
import { arrivalItems } from "../station-arrivals";
import type { StationFacilities, SubwayArrival } from "@/lib/types";

const t = (key: string, values?: Record<string, string | number>) => (values ? `${key}:${JSON.stringify(values)}` : key);
vi.mock("next-intl", () => ({ useTranslations: () => t, useLocale: () => "ko" }));

describe("place-lines == 화면 문장", () => {
  it("코레일 시설 4줄", async () => {
    const f: StationFacilities = { stationName: "서울역", accessibleToilet: true, accessibleSlope: false, wheelchairLifts: undefined, elevators: 3 };
    const mod = await import("@/components/StationFacilities");
    // 컴포넌트는 버튼 뒤에 렌더하므로 status를 done으로 만드는 테스트 전용 prop 대신 fetch를 목킹한다.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ facilities: f }) })));
    render(<mod.StationFacilities stationName="서울역" />);
    screen.getByRole("button").click();
    const items = await screen.findAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(korailFacilityLines(f, t));
  });
  it("도착 항목의 line·message", () => {
    const a: SubwayArrival = { line: "2호선", direction: "외선", trainLineNm: "성수행 - 역삼방면", destination: "성수", message: "3분 후(2번째 전)", currentLocation: "방배", arrivalSeconds: 180, express: false };
    expect(arrivalItems([a], t)).toEqual([{ line: "2호선 외선, 성수행 - 역삼방면", direction: "외선", message: "3분 후(2번째 전), currentLocation:{\"location\":\"방배\"}", state: { kind: "ok" } }]);
  });
});
```
(나머지 4축도 같은 골격 — 메타 3줄·시간표 항목·서울 시설 그룹·무장애 줄. 각 축 `it` 하나씩, 총 6개.)

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — 각 lib 파일은 해당 컴포넌트의 JSX 문장 조립을 그대로 옮긴다(`joinText` 사용). 예:

```ts
// src/lib/place-lines/station-facilities.ts
import type { StationFacilities } from "@/lib/types";
type T = (key: string, values?: Record<string, string | number>) => string;
export function korailFacilityLines(f: StationFacilities, t: T): string[] {
  return [
    `${t("accessibleToilet")}: ${f.accessibleToilet ? t("yes") : t("no")}`,
    `${t("accessibleSlope")}: ${f.accessibleSlope ? t("yes") : t("no")}`,
    `${t("wheelchairLifts")}: ${f.wheelchairLifts ?? t("unknown")}`,
    `${t("elevators")}: ${f.elevators ?? t("unknown")}`,
  ];
}
```
컴포넌트는 `korailFacilityLines(status.facilities, t).map((line) => <li key={line}>{line}</li>)`로 교체. 시간표는 `timetableLineItems`가 ok 노선은 방향별 항목(`text = joinText(\`${lineName} ${t(\`direction.${d}\`)}\`, \`${t("first")} ${train(first)}\`, \`${t("last")} ${train(last)}\`)`), 비-ok는 `text = t(\`coverage.${coverageKey}\`, { line })` 한 항목. 도착은 `SubwayArrivalList`가 `arrivalItems`의 `line`·`message`를 두 `<div>`에 그린다. 무장애는 `text = \`${label} ${value}\``. 메타는 `[isEn ? nameEn : nameEn(보조), joinText(\`${t("lines")} ${lines.join(", ")}\`, isTransfer && t("transfer")), \`${t("operator")} ${operator}\`]`.

- [ ] **Step 4: 통과 확인** — 새 스위트 + 기존 `PlaceDetail.test.tsx`.
- [ ] **Step 5: 커밋** — `refactor(webmcp): 역·무장애 줄 조립을 place-lines로 추출(컴포넌트·도구 공용)`.

---

### Task 7: `PlaceBridge` 계약 + `useAxisBridge` + 역 섹션 `load(force, source)`

**Files:**
- Modify: `src/lib/webmcp/tools/context.ts`(`PlaceBridge`·`AxisKey`·`AxisEntry`·`AxisOutcome` 추가; `DirectionsBridge`에서 `ensureVisible`·`expandRoute`는 Task 11에서 삭제)
- Create: `src/hooks/useAxisBridge.ts`
- Modify: `StationMeta.tsx` · `StationTimetable.tsx` · `StationFacilities.tsx` · `SeoulMetroFacilities.tsx` · `SeoulSubwayArrival.tsx` · `BarrierFreeInfo.tsx`
- Test: `src/hooks/__tests__/useAxisBridge.test.tsx`

**Interfaces:**
- Produces:
```ts
// context.ts
export type AxisKey = "basic" | "timetable" | "facilities" | "arrivals" | "barrierFree";
export type AxisStatus = "idle" | "loading" | "done" | "empty" | "unknown" | "error" | "notConfigured" | "notApplicable" | "partial";
export interface AxisSnapshot { status: AxisStatus; gen: number; data?: unknown; refreshError?: true }
export interface AxisSource { read(): AxisSnapshot; load(force: boolean, source: "user" | "tool"): void }
export interface AxisEntry {
  axis: AxisKey; present: boolean; kind: "mount" | "trigger";
  read(): AxisSnapshot;
  ensureLoaded(op: Op): Promise<AxisOutcome>;
  refresh(op: Op): Promise<AxisOutcome>;
}
export type AxisOutcome = { kind: "settled"; snapshot: AxisSnapshot } | { kind: "superseded" } | { kind: "aborted" } | { kind: "notConfigured" } | { kind: "notApplicable" };
export interface PlaceBridge { placeId: string; read(): { name: string; category: string; isStation: boolean; addressLines: { english?: string; road?: string; jibun?: string }; phone?: string; chatOpen: boolean }; axes: Record<AxisKey, AxisEntry> }
// useAxisBridge.ts
export function useAxisBridge(axis: AxisKey, source: AxisSource | null): void   // PlaceBridgeContext에 attach/detach
export const PlaceBridgeContext: React.Context<PlaceBridgeRegistrar | null>
export interface PlaceBridgeRegistrar { attach(axis: AxisKey, source: AxisSource): () => void }
```
- 역 섹션 컴포넌트의 `load`는 `load(force: boolean, source: "user" | "tool")` 시그니처로 바뀌고 버튼 `onClick={() => load(false, "user")}`. `source === "tool"`이면 완료 뒤 `headingRef.focus()`를 건너뛴다. 상태에 `gen`(요청 세대) 필드를 더한다(`setStatus({kind:"loading", gen: ++genRef.current})`). 마운트 fetch 컴포넌트(메타·시간표·무장애)는 `reload()`를 `load(true, source)`로 노출하고 마운트 effect가 `load(false, "user")`를 부른다. `force`는 마운트 축에서 캐시 무시(`cache: "no-store"`), 트리거 축에서 `done`이어도 재조회(직전 데이터 유지: `setStatus(prev => ({...prev, refreshing: true}))` 대신 **loading 중에도 직전 `data`를 스냅샷에 남긴다** — `read()`가 `{status:"loading", gen, data: prevData}`를 준다).

- [ ] **Step 1: 실패하는 테스트**

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { useState } from "react";
import { PlaceBridgeContext, useAxisBridge, type PlaceBridgeRegistrar } from "../useAxisBridge";
import type { AxisSource } from "@/lib/webmcp/tools/context";

function Child({ source }: { source: AxisSource }) { useAxisBridge("timetable", source); return null; }

describe("useAxisBridge", () => {
  it("마운트에 attach, 언마운트에 detach", () => {
    const attached: string[] = [];
    let detached = 0;
    const registrar: PlaceBridgeRegistrar = { attach: (axis) => { attached.push(axis); return () => { detached++; }; } };
    const source: AxisSource = { read: () => ({ status: "idle", gen: 0 }), load: () => {} };
    const view = render(<PlaceBridgeContext.Provider value={registrar}><Child source={source} /></PlaceBridgeContext.Provider>);
    expect(attached).toEqual(["timetable"]);
    view.unmount();
    expect(detached).toBe(1);
  });
  it("registrar가 없으면(상세 밖 렌더) 아무것도 하지 않는다", () => {
    const source: AxisSource = { read: () => ({ status: "idle", gen: 0 }), load: () => {} };
    expect(() => render(<Child source={source} />)).not.toThrow();
  });
});
```
그리고 `src/components/__tests__/PlaceDetail.test.tsx`에 "시설 버튼 클릭(user)은 헤딩 착지, `load(false,"tool")`은 무착지" 케이스를 더한다(컴포넌트의 `load`를 노출하려면 `useAxisBridge`의 source를 통해 부른다 — PlaceDetail 테스트에서 registrar를 주입).

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현**

```ts
// src/hooks/useAxisBridge.ts
"use client";
import { createContext, useContext, useEffect } from "react";
import type { AxisKey, AxisSource } from "@/lib/webmcp/tools/context";
export interface PlaceBridgeRegistrar { attach(axis: AxisKey, source: AxisSource): () => void }
export const PlaceBridgeContext = createContext<PlaceBridgeRegistrar | null>(null);
/** 역 섹션이 자기 축 엔트리를 채운다(엔트리는 PlaceDetail이 만든다 — spec §5.4). */
export function useAxisBridge(axis: AxisKey, source: AxisSource | null): void {
  const registrar = useContext(PlaceBridgeContext);
  useEffect(() => {
    if (!registrar || !source) return;
    return registrar.attach(axis, source);
  }, [registrar, axis, source]);
}
```
`source`는 컴포넌트에서 `useMemo`로 만들되 `read`는 ref를 읽는다(`statusRef.current`). 각 컴포넌트 변경 요지:
- `StationFacilities`: `const genRef = useRef(0); async function load(force: boolean, source: "user"|"tool") { if (inFlightRef.current) return; const gen = ++genRef.current; ... setStatus({kind:"loading", gen, previous: status.kind==="done" ? status.facilities : undefined}); ... 성공: setStatus({kind:"done", gen, facilities}); if (source==="user") rAF focus; 실패: setStatus(prev => prev.kind==="loading" && prev.previous ? {kind:"done", gen, facilities: prev.previous, refreshError: true} : {kind:"error", gen}) }`. `close`는 gen 증가(사용자 닫기는 도구 대기자를 `superseded`로 만든다). `useAxisBridge("facilities", source)`에서 `read()`는 `{status: kind→AxisStatus, gen, data: facilities, refreshError}`.
- `SeoulMetroFacilities`·`SeoulSubwayArrival` 동형(축 `facilities`의 서울 출처는 별도 축 키가 아니라 **같은 축의 둘째 소스** — `useAxisBridge("facilities:metro", …)`가 되지 않게 `AxisKey`에 `"facilitiesMetro"`를 추가하고 도구가 `facilities` 요청 시 둘을 함께 실행한다. `AxisKey = "basic" | "timetable" | "facilities" | "facilitiesMetro" | "arrivals" | "barrierFree"`로 확정).
- `StationMeta`·`StationTimetable`·`BarrierFreeInfo`: effect 본문을 `load(false, "user")`로 추출, `useAxisBridge`. 메타는 축 `basic`의 `stationMeta` 소스(`useAxisBridge("basic", …)`).
- `SubwayArrivalList`는 변경 없음(Task 6에서 끝).

- [ ] **Step 4: 통과 확인** — `useAxisBridge.test.tsx`·`PlaceDetail.test.tsx`·`place-lines.test.tsx`.
- [ ] **Step 5: 커밋** — `feat(webmcp): PlaceBridge 축 계약·useAxisBridge·역 섹션 load(force, source)`.

---

### Task 8: `PlaceDetail`이 `PlaceBridge`를 게시한다

**Files:**
- Modify: `src/components/PlaceDetail.tsx`
- Test: `src/components/__tests__/PlaceDetailWebMcp.test.tsx`

**Interfaces:**
- Consumes: Task 3 `publishView/withdrawView`, Task 7 `PlaceBridgeContext`·`AxisEntry`.
- Produces: 게시된 `PlaceBridge`(identity = `place.id`). `ensureLoaded(op)`: ①`present:false` → `notConfigured`, 비역 역축 → `notApplicable` ②attach 대기(op 상한 안, 50ms 폴링 대신 registrar attach 이벤트) ③`read().status === "idle"`이면 `source.load(false,"tool")` ④명령 시점 `gen` 기록 → settle(status ∉ loading·idle) 대기, 그 사이 `gen`이 명령 시점 +1이 아니면 `superseded`. `refresh(op)`: `load(true,"tool")` 뒤 같은 대기.

- [ ] **Step 1: 실패하는 테스트** — deferred fetch로:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlaceDetail } from "../PlaceDetail";
import { __resetViewRegistryForTest, bridgeOf } from "@/lib/webmcp/view-registry";
import { __resetToolLockForTest, acquireOp, type Op } from "@/lib/webmcp/tool-lock";
import type { PlaceBridge } from "@/lib/webmcp/tools/context";
import type { Place } from "@/lib/types";

vi.mock("next-intl", () => { const t = (k: string) => k; Object.assign(t, { rich: t, markup: t, raw: t, has: () => true }); return { useTranslations: () => t, useLocale: () => "ko" }; });
vi.mock("../RouteLinks", () => ({ RouteLinks: () => null }));
vi.mock("../chat/ChatOverlay", () => ({ ChatOverlay: () => null }));

const station: Place = { id: "s1", name: "강남역", category: "교통,수송 > 지하철,전철 > 수도권2호선", address: "a", roadAddress: "r", lat: 37.49, lng: 127.02 };
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => (resolve = r)); return { promise, resolve }; }
afterEach(() => { cleanup(); __resetViewRegistryForTest(); __resetToolLockForTest(); vi.unstubAllGlobals(); });
const op = () => acquireOp("t", undefined) as Op;

describe("PlaceDetail × PlaceBridge(spec §5.4)", () => {
  it("마운트에 placeId 정체성으로 게시하고 present는 props에서 온다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ meta: null, timetable: null, detail: null }) })));
    render(<PlaceDetail place={station} onBack={() => {}} canShowSubway={false} canShowBarrierFree={true} canShowBus={false} canShowBike={false} canShowAir={false} />);
    const b = bridgeOf<PlaceBridge>("place");
    expect(b?.identity).toBe("s1");
    expect(b?.bridge.axes.arrivals.present).toBe(false);
    expect(b?.bridge.axes.barrierFree.present).toBe(true);
    expect(await b!.bridge.axes.arrivals.ensureLoaded(op())).toEqual({ kind: "notConfigured" });
  });
  it("트리거 축 ensureLoaded는 tool 소스로 로드하고 헤딩 착지 없이 정착한다", async () => {
    const d = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("/facilities") ? d.promise : Promise.resolve({ ok: true, json: async () => ({ meta: null, timetable: null, detail: null }) })));
    render(<PlaceDetail place={station} onBack={() => {}} canShowSubway={false} canShowBarrierFree={false} canShowBus={false} canShowBike={false} canShowAir={false} />);
    const entry = bridgeOf<PlaceBridge>("place")!.bridge.axes.facilities;
    const p = entry.ensureLoaded(op());
    d.resolve({ ok: true, json: async () => ({ facilities: { stationName: "강남", accessibleToilet: true, accessibleSlope: true, wheelchairLifts: 1, elevators: 2 } }) });
    const r = await p;
    expect(r).toMatchObject({ kind: "settled", snapshot: { status: "done" } });
    expect(document.activeElement).toBe(document.body);
  });
  it("대기 중 사용자가 같은 축을 닫으면 superseded", async () => {
    const d = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("/facilities") ? d.promise : Promise.resolve({ ok: true, json: async () => ({ meta: null, timetable: null, detail: null }) })));
    render(<PlaceDetail place={station} onBack={() => {}} canShowSubway={false} canShowBarrierFree={false} canShowBus={false} canShowBike={false} canShowAir={false} />);
    const entry = bridgeOf<PlaceBridge>("place")!.bridge.axes.facilities;
    const p = entry.ensureLoaded(op());
    // 사용자가 버튼을 다시 눌러 새 세대를 만든다(실제 UI는 로딩 중 aria-disabled지만 gen 증가 경로는 close/재로드).
    fireEvent.click(screen.getByRole("button", { name: "button" }));
    d.resolve({ ok: true, json: async () => ({ facilities: null }) });
    await expect(p).resolves.toEqual({ kind: "superseded" });
  });
  it("refresh 실패는 직전 데이터 + refreshError", async () => { /* facilities done 후 fetch 실패 주입 → snapshot.data 유지, refreshError true */ });
  it("언마운트는 대기자를 aborted로 끝낸다", async () => { /* deferred 미해결 상태에서 unmount → aborted */ });
});
```
(마지막 두 `it`의 본문은 위 둘째·셋째와 같은 골격이며 단언만 다르다 — 구현자가 그대로 채운다.)

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — `PlaceDetail`에 `useMemo`로 registrar·bridge를 만든다:

```ts
const sourcesRef = useRef(new Map<AxisKey, AxisSource>());
const attachListeners = useRef(new Set<() => void>());
const registrar = useMemo<PlaceBridgeRegistrar>(() => ({
  attach: (axis, source) => { sourcesRef.current.set(axis, source); attachListeners.current.forEach((l) => l()); return () => { sourcesRef.current.delete(axis); }; },
}), []);
function makeEntry(axis: AxisKey, present: boolean, kind: "mount" | "trigger"): AxisEntry {
  const waitSource = (op: Op) => new Promise<AxisSource | null>((resolve) => {
    const s = sourcesRef.current.get(axis); if (s) return resolve(s);
    const l = () => { const s2 = sourcesRef.current.get(axis); if (s2) { attachListeners.current.delete(l); resolve(s2); } };
    attachListeners.current.add(l);
    op.signal.addEventListener("abort", () => { attachListeners.current.delete(l); resolve(null); }, { once: true });
  });
  const settle = (source: AxisSource, gen: number, op: Op) => new Promise<AxisOutcome>((resolve) => {
    const tick = () => {
      if (!op.isLive()) return resolve({ kind: "aborted" });
      const snap = source.read();
      if (snap.gen !== gen) return resolve({ kind: "superseded" });
      if (snap.status !== "loading" && snap.status !== "idle") return resolve({ kind: "settled", snapshot: snap });
      settleWaiters.current.add(tick);
    };
    tick();
  });
  const run = async (op: Op, force: boolean): Promise<AxisOutcome> => {
    if (!present) return { kind: isStationPlace ? "notConfigured" : "notApplicable" };
    const source = await waitSource(op);
    if (!source) return { kind: "aborted" };
    const before = source.read();
    if (!force && before.status !== "idle") return before.status === "loading" ? settle(source, before.gen, op) : { kind: "settled", snapshot: before };
    source.load(force, "tool");
    return settle(source, before.gen + 1, op);
  };
  return { axis, present, kind, read: () => sourcesRef.current.get(axis)?.read() ?? { status: "idle", gen: 0 }, ensureLoaded: (op) => run(op, false), refresh: (op) => run(op, true) };
}
```
`settleWaiters`는 `useEffect(() => { settleWaiters.current.forEach((w) => w()); settleWaiters.current.clear(); })`(의존성 없음 — 매 커밋 뒤)로 푼다([[effect-resolver-must-guard-committed-state]]: 커밋된 상태를 `read()`가 보므로 안전). 언마운트 effect cleanup은 대기자를 전부 호출해 `aborted`로(각 `tick`이 `op.isLive()`가 아니라 **언마운트 플래그**를 먼저 본다 — `unmountedRef`). 게시:
```ts
useEffect(() => {
  const bridge: PlaceBridge = { placeId: place.id, read: () => ({ name: place.name, category: place.category, isStation: isStationPlace, addressLines: { english: place.englishAddress, road: place.roadAddress || undefined, jibun: place.address || undefined }, phone: place.phone, chatOpen: chatOpenRef.current }), axes: { basic: makeEntry("basic", true, "mount"), timetable: makeEntry("timetable", isStationPlace, "mount"), facilities: makeEntry("facilities", isStationPlace, "trigger"), facilitiesMetro: makeEntry("facilitiesMetro", isStationPlace, "trigger"), arrivals: makeEntry("arrivals", isStationPlace && canShowSubway, "trigger"), barrierFree: makeEntry("barrierFree", canShowBarrierFree, "mount") } };
  publishView("place", bridge, place.id);
  return () => withdrawView("place", bridge);
}, [place.id, isStationPlace, canShowSubway, canShowBarrierFree]);
```
비역의 `basic`은 메타 소스가 attach되지 않으므로 `basic.ensureLoaded`는 **메타 소스 없이도 settled**여야 한다: `basic` 엔트리는 `waitSource`를 기다리지 않고 `sourcesRef.get("basic")`이 없으면 `{kind:"settled", snapshot:{status:"notApplicable", gen:0}}`. 렌더 트리를 `<PlaceBridgeContext.Provider value={registrar}>`로 감싼다.

- [ ] **Step 4: 통과 확인** — 새 스위트 + `PlaceDetail.test.tsx`.
- [ ] **Step 5: 커밋** — `feat(webmcp): PlaceDetail이 PlaceBridge를 게시(축 6 엔트리·정착 대기·소스 attach)`.

---

### Task 9: `HomeBridge` — `runSearch` 트랜잭션·동결 스냅샷·`navigator`·모달 상태

**Files:**
- Modify: `src/lib/webmcp/tools/context.ts`(`HomeBridge` 재정의)
- Modify: `src/components/PlaceSearch.tsx`
- Test: `src/components/__tests__/PlaceSearchWebMcp.test.tsx`

**Interfaces:**
- Produces:
```ts
export interface SearchRequest { query: string; sort: "accuracy" | "review" }
export type BranchState = "pending" | "done" | "empty" | "error" | "skipped";
export type SearchOutcome = { kind: "settled"; attempt: number; branches: { places: BranchState; addresses: BranchState; web: BranchState } } | { kind: "busy" } | { kind: "superseded" } | { kind: "aborted" };
export interface HomeBridge {
  read(): { query: string; sort: "accuracy" | "review"; attempt: number | null; branches: HomeBranches | null; counts: { places: number; addresses: number; web: number }; chatOpen: boolean; webResults: Array<{ title: string; url: string; snippet: string }> };
  runSearch(request: SearchRequest, op: Op): Promise<SearchOutcome>;
  snapshotFor(attempt: number): SearchSnapshot | null;       // 정착 시 동결
  openAddress(address: JusoAddress, op: Op): Promise<{ ok: true } | { ok: false; reason: "geocodeFailed" }>;   // onSelectAddress와 같은 경로
}
```
- `PlaceSearch`: `searchAttemptRef`(정수 세대)·`branchesRef`·`frozenRef: Map<attempt, SearchSnapshot>`(최근 2개만 보관)·`searchWaiterRef {attempt, resolve}`·`pendingSearchOutcomeRef`. `runQuerySearch`를 `runSearch(request, opts?: {source?: "tool"})`로 바꾸고 `toggleSort`·폼 제출·음성·`?q=` 자동검색이 이것을 부른다. 웹 폴백 미발사는 `branches.web = "skipped"`. 정착 판정은 **커밋 뒤 effect**: `useEffect(() => { const w = searchWaiterRef.current; if (!w) return; const b = branchesRef.current; if (!b || b.attempt !== w.attempt) return; if (Object.values(b.state).some(s => s === "pending")) return; frozenRef.current.set(w.attempt, {...}); searchWaiterRef.current = null; w.resolve({kind:"settled", attempt: w.attempt, branches: b.state}); })`. 새 검색 시작이 앞 대기자를 `superseded`로 끝낸다. `source:"tool"`이면 결과 헤딩 포커스 effect를 **한 번** 건너뛴다(`suppressLandingRef`)— 단 홈이 이동의 최종 화면이면 착지한다(§6: 최종 착지 하나). 구현: `runSearch`는 착지를 건너뛰지 않고, `navigator.toHome`의 중간 단계만 `suppressFocusRef`로 억제한다(홈 도착 뒤 `search_places`의 결과 헤딩 착지가 그 호출의 유일한 착지).
- `navigator`: `useEffect(() => { setNavigator({ toHome, toDirections: (op) => { if (!directionsOpenRef.current) openDirections(null); }, toPlace: (place) => requestOpenPlace(place), isModalOpen: () => manualPickerOpen || generalChat !== null || chatOpenInDetailRef.current }); return () => setNavigator(null); }, [...])`. `toHome(op)`:
```ts
async function toHome(op: Op): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const v = currentViewState(); // ref 미러: directions > nearby > place > home
    if (v === "home") return;
    suppressFocusRef.current = true;
    if (v === "directions") backFromDirections(); else if (v === "nearby") backFromNearbyHub(); else backToResults();
    await Promise.race([nextPopstate(), sleep(1_000, op.signal)]);
    if (!op.isLive()) throw new Error("aborted");
  }
  suppressFocusRef.current = false;
  if (currentViewState() !== "home") throw new Error("viewChanging");
}
```
`focusResultsHeadingIfDone`·허브 칩 복귀 rAF는 `suppressFocusRef.current`가 참이면 건너뛰고, `toHome`이 끝나면 플래그를 내린다(마지막 단계의 착지도 억제 — 그 뒤 `search_places`의 결과 헤딩 착지가 최종 착지).
- `chatOpen`: `PlaceDetail`의 채팅 열림은 `PlaceBridge.read().chatOpen`이 알고, 홈 범용 채팅은 `generalChat !== null`.

- [ ] **Step 1: 실패하는 테스트**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { PlaceSearch } from "../PlaceSearch";
import { __resetViewRegistryForTest, bridgeOf, navigator } from "@/lib/webmcp/view-registry";
import { __resetToolLockForTest, acquireOp, type Op } from "@/lib/webmcp/tool-lock";
import type { HomeBridge } from "@/lib/webmcp/tools/context";
import type { Place } from "@/lib/types";

vi.mock("next-intl", () => { const t = (k: string) => k; Object.assign(t, { rich: t, markup: t, raw: t, has: () => true }); return { useTranslations: () => t, useLocale: () => "ko" }; });
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../DirectionsView", () => ({ DirectionsView: ({ onBack }: { onBack: () => void }) => <button onClick={onBack}>back</button> }));
vi.mock("../NearbyHub", () => ({ NearbyHub: () => null }));
vi.mock("../PlaceDetail", () => ({ PlaceDetail: ({ place, onBack }: { place: Place; onBack: () => void }) => <div><h2>{place.name}</h2><button onClick={onBack}>back</button></div> }));

const p1: Place = { id: "p1", name: "강남역", category: "c", address: "a", roadAddress: "r", lat: 37.49, lng: 127.02 };
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => (resolve = r)); return { promise, resolve }; }
const op = () => acquireOp("t", undefined) as Op;
afterEach(() => { cleanup(); __resetViewRegistryForTest(); __resetToolLockForTest(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

describe("PlaceSearch × HomeBridge(spec §3.2·§5.2)", () => {
  it("runSearch는 세 분기 정착 뒤 settled를 주고 스냅샷을 동결한다(웹은 skipped)", async () => {
    const d = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("/api/places") ? d.promise : Promise.resolve({ ok: true, json: async () => ({ addresses: [] }) })));
    render(<PlaceSearch isMockMode={false} canSearchAddress canSearchWeb />);
    const home = bridgeOf<HomeBridge>("home")!.bridge;
    const p = home.runSearch({ query: "강남역", sort: "accuracy" }, op());
    d.resolve({ ok: true, json: async () => ({ places: [p1], total: 1 }) });
    const r = await p;
    expect(r).toMatchObject({ kind: "settled", branches: { places: "done", addresses: "empty", web: "skipped" } });
    expect(home.snapshotFor((r as { attempt: number }).attempt)?.places[0].id).toBe("p1");
  });
  it("대기 중 새 검색이 시작되면 앞 대기자는 superseded", async () => { /* 첫 runSearch deferred → 둘째 runSearch 시작 → 첫 promise superseded */ });
  it("toHome: 길찾기 위 상세에서 두 단계 언와인드, 중간 착지 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ places: [p1], total: 1, addresses: [] }) })));
    render(<PlaceSearch isMockMode={false} canShowTransit />);
    const home = bridgeOf<HomeBridge>("home")!.bridge;
    await home.runSearch({ query: "강남역", sort: "accuracy" }, op());
    navigator()!.toPlace(p1, op());
    await waitFor(() => expect(bridgeOf("place")).not.toBeNull());
    navigator()!.toDirections(op());
    await waitFor(() => expect(bridgeOf("directions")).not.toBeNull());
    await navigator()!.toHome(op());
    expect(bridgeOf("home")).not.toBeNull();
    expect(bridgeOf("directions")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
  it("toHome 상한: 3회 뒤에도 홈이 아니면 viewChanging", async () => { /* backFromDirections를 no-op으로 만드는 history.state 조작 후 rejects.toThrow("viewChanging") */ });
});
```

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — 위 인터페이스대로. 홈 브릿지 게시: `useEffect(() => { const bridge: HomeBridge = {...}; if (homeVisible) publishView("home", bridge); return () => withdrawView("home", bridge); }, [homeVisible])`(`read`·`runSearch`는 ref로 최신 클로저를 읽는다 — `bridgeRef` 패턴). 허브는 `useEffect(() => { markNearby(nearbyOpen); }, [nearbyOpen])`.

- [ ] **Step 4: 통과 확인** — 새 스위트 + `PlaceSearch.test.tsx`·`PlaceSearch.reviewSort.test.tsx`.
- [ ] **Step 5: 커밋** — `feat(webmcp): HomeBridge — runSearch 트랜잭션·동결 스냅샷·navigator(toHome 유한 언와인드)`.

---

### Task 10: `DirectionsView` 브릿지 게시로 전환 + W1-R 도보 최단

**Files:**
- Modify: `src/components/DirectionsView.tsx`(`useWebMcpTools` 호출 제거 → `publishView("directions", bridge)`; `buildToolPlan`에 `walk.shortest`·`walk.shortestSteps`)
- Modify: `src/lib/webmcp/tools/context.ts`(`ToolPlan.walk.shortest?: { distanceMeters; durationSeconds; steps: string[] }`)
- Modify: `src/lib/webmcp/tools/get-route-steps.ts`(`variant`), `src/lib/webmcp/tools/plan-directions.ts`(`summarizePlan`에 `walk.shortest`)
- Test: `src/components/__tests__/DirectionsWebMcp.test.tsx`(등록 단언 → 게시 단언으로 개정), `src/lib/webmcp/tools/__tests__/get-route-steps.test.ts`(신규)

- [ ] **Step 1: 실패하는 테스트** — `DirectionsWebMcp.test.tsx`의 "마운트 시 registerTool 9회" 단언을 `bridgeOf("directions")`가 non-null, `registerTool` 0회로 바꾼다. `get-route-steps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getRouteStepsTool } from "../get-route-steps";
import type { DirectionsBridge, ToolPlan } from "../context";
const plan = (): ToolPlan => ({ planId: "P1", destination: "d", resolved: { from: "a", to: "b", via: null, avoidStairs: false }, routeRefs: { refOf: () => null, keyOf: () => null, size: 0 }, transit: null, car: null, modes: ["walk"],
  walk: { outcome: "done", steps: ["직진", "좌회전"], startable: true, shortest: { distanceMeters: 900, durationSeconds: 700, steps: ["최단1", "최단2", "최단3"] } } });
const bridge: DirectionsBridge = { read: () => ({ fields: { from: "", to: "", via: null, avoidStairs: false }, phase: "settled", plan: plan(), lang: "ko" }), runQuery: async () => ({ kind: "busy" }) };
describe("get_route_steps variant", () => {
  it("shortest는 최단 배열을 페이지한다", async () => {
    const out = JSON.parse(await getRouteStepsTool(bridge).execute({ planId: "P1", mode: "walk", variant: "shortest" }));
    expect(out.steps.map((s: { text: string }) => s.text)).toEqual(["최단1", "최단2", "최단3"]);
    expect(out.variant).toBe("shortest");
  });
  it("shortest가 없으면 unsupported{detail:'noShortest'}", async () => { /* shortest 제거 후 */ });
});
```

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — `DirectionsView`: `useWebMcpTools(...)` 블록을 지우고
```ts
useEffect(() => {
  const bridge: DirectionsBridge = { read: () => bridgeRef.current.read(), runQuery: (request, signal) => bridgeRef.current.runQuery(request, signal) };
  publishView("directions", bridge);
  return () => withdrawView("directions", bridge);
}, []);
```
`buildToolPlan`의 walk에 `shortest: walkOutcome.shortest ? { distanceMeters: walkOutcome.shortest.distanceMeters, durationSeconds: walkOutcome.shortest.durationSeconds, steps: walkStepItems(walkOutcome.shortest, true).items } : undefined`. `get-route-steps.ts`: `variant` 입력(enum, 기본 recommended), `mode==="walk" && variant==="shortest"`면 `m.shortest?.steps` 없으면 `unsupported{detail:"noShortest"}`, SHAPE에 `variant`, `targetId` 필드 제거(Task 11과 함께). `summarizePlan` walk에 `shortest: plan.walk.shortest ? { distanceMeters, durationSeconds, stepCount: steps.length } : undefined`, SHAPE에 `walk.shortest: {distanceMeters, durationSeconds, stepCount}`. 설명문 갱신.

- [ ] **Step 4: 통과 확인** — `DirectionsWebMcp.test.tsx`·`get-route-steps.test.ts`·`DirectionsWalkAlternatives.test.tsx`.
- [ ] **Step 5: 커밋** — `feat(webmcp): DirectionsView 브릿지 게시 전환 + 도보 최단 대안(W1-R #1)`.

---

### Task 11: 삭제 — 회귀 테스트 고정 → 도구 5개와 소비물 제거 → 재발 가드

**Files:**
- Test(먼저 고정): `src/components/__tests__/PlaceSearch.test.tsx`(상세 "여기까지 길찾기" 프리필 케이스가 이미 있는지 확인, 없으면 추가) · `DirectionsView.test.tsx`(뒤로가기 착지) · `DirectionsGuideEntry.test.tsx`(사용자 안내 시작·중지 — `claimGuideSession`/`releaseGuideSession` 원자성)
- Delete: `src/lib/webmcp/tools/focus-item.ts` · `start-guidance.ts` · `stop-guidance.ts` · `guidance-status.ts` · `get-walk-infrastructure-nearby.ts` · `open-directions.ts` · `src/lib/webmcp/dom.ts` · `src/lib/webmcp/accessible-name.ts` · `src/lib/webmcp/__tests__/targets.test.ts`(→ `route-refs.test.ts`로 축소)
- Rename: `src/lib/webmcp/targets.ts` → `src/lib/webmcp/route-refs.ts`(`RouteRefTable`·`buildRouteRefTable`만 남긴다)
- Modify: `src/lib/guide-session-store.ts`(`publishGuideSnapshot`·`readGuideSnapshot`·`clearRetainedGuideSnapshot`·`GuideSnapshot`·`retained` 삭제), `src/hooks/useRouteGuide.ts`·`useTransitGuide.ts`(게시 호출 삭제), `DirectionsView.tsx`·`WalkRouteBriefing.tsx`·`TransitRouteBriefing.tsx`·`DistanceBeacon.tsx`·`TransitGuidePanel.tsx`(`data-focus-target`·`data-guide-trigger`·`triggerTarget` prop·착지 전용 `tabIndex={-1}` 제거 — 뷰 제목 `headingRef`의 `tabIndex={-1}`은 남긴다), `context.ts`(`DirectionsBridge.ensureVisible/expandRoute`·`HomeBridge.openDirections/isDirectionsOpen`·`PlanTransitLeg.targetId` 삭제), `PlaceSearch.tsx`(`openDirectionsWithText`·`abortHomeTools`·`homeVisible` 조건의 도구 등록 삭제 — 홈 브릿지 게시는 유지), `DirectionsView.tsx`(`initialToText` prop 삭제 — 사용처 4곳이 전부 `open_directions` 경로임을 `grep -n initialToText src`로 확인한 뒤), `src/hooks/useWebMcpTools.ts`(`abortNow` 반환 삭제), `get-route-steps.ts`·`get-transit-route-detail.ts`(`targetId` 삭제), `read-current-view.ts`·`plan-directions.ts`(`listHighLevelTargets`·`targets` 삭제 — Task 12에서 재작성하므로 여기선 import만 끊는다)
- Create: `src/lib/webmcp/__tests__/webmcp-removal.test.ts`

- [ ] **Step 1: 회귀 테스트 고정** — 세 동작을 단언하는 케이스가 각 스위트에 있는지 확인하고 없으면 추가: ①`PlaceDetail`의 "여기까지 길찾기" 클릭 → `DirectionsView`가 `initialTo.label === place.name`으로 마운트 ②길찾기 뒤로가기 → 결과 헤딩 포커스 ③`DistanceBeacon` 시작 버튼 → `hasActiveGuideSession()` true, 중지 → false. 실행해 PASS를 본다.
- [ ] **Step 2: 재발 가드 테스트(실패)**

```ts
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
const FORBIDDEN = ["focus_item", "start_guidance", "guidance_status", "stop_guidance", "get_walk_infrastructure_nearby", "open_directions", "data-focus-target", "data-guide-trigger", "publishGuideSnapshot", "readGuideSnapshot", "listHighLevelTargets"];
describe("W2 삭제 재발 가드(spec §8.4)", () => {
  it("삭제된 도구·속성·API 참조가 src에 없다", () => {
    for (const word of FORBIDDEN) {
      const out = execSync(`grep -rl --include=*.ts --include=*.tsx -F "${word}" src || true`, { encoding: "utf8" }).trim();
      expect(out, word).toBe("");
    }
  });
});
```
(이 파일 자신은 `.test.ts`라 grep 대상이지만 문자열을 배열 리터럴로만 들고 있다 — `--include` 뒤에 `--exclude=webmcp-removal.test.ts`를 붙인다.)

- [ ] **Step 3: 삭제 수행** — 위 파일 목록대로. 각 삭제는 **그 도구의 실행 경로를 따라가** 잡는다(낱말 검색 아님). `guide-session-store.ts`는 `claimGuideSession`·`releaseGuideSession`·`hasActiveGuideSession`·`stopActiveGuideSession`·`__reset…`만 남긴다(주석의 "WebMCP 스냅샷 슬롯" 문단 삭제). `DirectionsWebMcp.test.tsx`의 `publishGuideSnapshot` 목 사용도 지운다(Task 10에서 이미 개정했다면 그 자리).
- [ ] **Step 4: 통과 확인** — `npm run test:run` 전체 + `npx tsc --noEmit` + `npm run lint`. Step 1 회귀 3건 PASS 유지.
- [ ] **Step 5: 커밋** — `refactor(webmcp): focus_item·안내 3종·보행 인프라·open_directions 삭제(소비자 기준), 재발 가드`.

---

### Task 12: `manifest.ts` + `describe_app` + `read_current_view` 개정

**Files:**
- Create: `src/lib/webmcp/manifest.ts`, `src/lib/webmcp/tools/describe-app.ts`
- Modify: `src/lib/webmcp/tools/read-current-view.ts`, `src/lib/webmcp/tools/index.ts`
- Test: `src/lib/webmcp/__tests__/manifest.test.ts`, `src/lib/webmcp/tools/__tests__/read-current-view.test.ts`

**Interfaces:**
- Produces:
```ts
// manifest.ts
export interface ToolGates { hasWalk: boolean; hasTransit: boolean; hasCar: boolean; canShowSubway: boolean; canShowBarrierFree: boolean }
export interface ToolDef { name: ToolName; description: string; inputSchema: Record<string, unknown>; outputShape: Shape; readOnly: boolean; locks: boolean; requires?: string; produces?: string; available(g: ToolGates): boolean; build(): WebMcpTool }
export type ToolName = "describe_app" | "search_places" | "get_place_info" | "plan_directions" | "get_transit_route_detail" | "get_route_steps" | "read_current_view";
export const TOOL_NAMES: readonly ToolName[]
export function manifest(gates: ToolGates): ToolDef[]
export function buildAppTools(gates: ToolGates): WebMcpTool[]    // index.ts가 re-export
```
- 도구는 브릿지를 인자로 받지 않는다 — 실행 시점에 `view-registry`를 읽는다(`bridgeOf`·`navigator`). `gates`는 루트가 props에서 만든 고정값.
- `describe_app` 출력 §3.1. `read_current_view` 출력 §3.6(`view`·화면별 필드·`toolRunning`·`viewChanging` 실패).

- [ ] **Step 1: 실패하는 테스트**

```ts
// manifest.test.ts
import { describe, expect, it } from "vitest";
import { TOOL_NAMES, buildAppTools, manifest } from "../manifest";
const gates = { hasWalk: true, hasTransit: true, hasCar: true, canShowSubway: true, canShowBarrierFree: true };
describe("manifest(spec §5.1)", () => {
  it("등록 이름 집합은 정확히 7개다", () => {
    expect(new Set(buildAppTools(gates).map((t) => t.name))).toEqual(new Set(["describe_app", "search_places", "get_place_info", "plan_directions", "get_transit_route_detail", "get_route_steps", "read_current_view"]));
    expect(TOOL_NAMES).toHaveLength(7);
  });
  it("이름 30자·[a-z_], 설명 500자, 파라미터 설명 150자", () => {
    for (const t of buildAppTools(gates)) {
      expect(t.name).toMatch(/^[a-z_]{1,30}$/);
      expect(t.description.length).toBeLessThanOrEqual(500);
      const props = (t.inputSchema as { properties: Record<string, { description?: string }> }).properties;
      for (const p of Object.values(props)) expect((p.description ?? "").length).toBeLessThanOrEqual(150);
    }
  });
  it("available은 게이트를 반영한다", () => {
    const none = manifest({ ...gates, hasWalk: false, hasTransit: false, hasCar: false });
    expect(none.find((d) => d.name === "plan_directions")!.available(none[0] && { ...gates, hasWalk: false, hasTransit: false, hasCar: false })).toBe(false);
  });
  it("describe_app 출력의 tools 이름 = 등록 이름, axes에 arrivals·barrierFree 게이트", async () => {
    const d = buildAppTools({ ...gates, canShowSubway: false }).find((t) => t.name === "describe_app")!;
    const out = JSON.parse(await d.execute({}));
    expect(out.tools.map((t: { name: string }) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(out.axes).toContainEqual({ axis: "arrivals", available: false });
    expect(out.notes.some((n: string) => n.includes("One tool runs at a time"))).toBe(true);
  });
});
```
```ts
// read-current-view.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { readCurrentViewTool } from "../read-current-view";
import { __resetViewRegistryForTest, markChanging, publishView } from "../../view-registry";
import { __resetToolLockForTest, acquireOp, type Op } from "../../tool-lock";
afterEach(() => { __resetViewRegistryForTest(); __resetToolLockForTest(); });
describe("read_current_view(spec §3.6)", () => {
  it("홈: query·sort·counts·chatOpen", async () => {
    publishView("home", { read: () => ({ query: "강남", sort: "accuracy", attempt: 1, branches: { places: "done", addresses: "empty", web: "skipped" }, counts: { places: 3, addresses: 0, web: 0 }, chatOpen: false, webResults: [] }) });
    const out = JSON.parse(await readCurrentViewTool().execute({}));
    expect(out).toMatchObject({ ok: true, view: "home", query: "강남", counts: { places: 3 } });
  });
  it("도구 이동 중이면 viewChanging", async () => {
    publishView("home", { read: () => ({ query: "", sort: "accuracy", attempt: null, branches: null, counts: { places: 0, addresses: 0, web: 0 }, chatOpen: false, webResults: [] }) });
    const op = acquireOp("get_place_info", undefined) as Op;
    markChanging(op);
    const out = JSON.parse(await readCurrentViewTool().execute({}));
    expect(out).toMatchObject({ ok: false, reason: "viewChanging", toolRunning: "get_place_info" });
  });
  it("아무 화면도 없으면(허브) view nearby와 note", async () => { /* markNearby(true) */ });
});
```

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — `manifest.ts`는 각 도구 파일의 `SHAPE`·`description`·`inputSchema`를 모아 `ToolDef` 배열을 만든다(도구 파일이 `export const DEF: Omit<ToolDef, "build">`와 `export function build(gates): WebMcpTool`을 낸다 — 이름·설명·스키마를 한 곳에만 둔다). `describe-app.ts`:
```ts
export function describeAppTool(gates: ToolGates): WebMcpTool {
  return { name: "describe_app", description: "Describe what the Gildongmu app can do for an agent: the tools, which are available in this deployment, how they chain (search_places → get_place_info / plan_directions → route detail), and the station info axes. Call once at the start.", inputSchema: EMPTY_SCHEMA, annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async () => finish({ ok: true, currentView: currentView() ?? "home",
      tools: manifest(gates).map((d) => ({ name: d.name, available: d.available(gates), reason: d.available(gates) ? undefined : "notConfigured", requires: d.requires, produces: d.produces })),
      axes: [{ axis: "arrivals", available: gates.canShowSubway }, { axis: "barrierFree", available: gates.canShowBarrierFree }, { axis: "timetable", available: true }, { axis: "facilities", available: true }, { axis: "basic", available: true }],
      notes: NOTES }, SHAPE) };
}
```
`NOTES`는 spec §3.1 다섯 문장. `read-current-view.ts`는 `currentView()`로 분기해 홈/길찾기/상세/허브 필드를 조립하고 `changing`이면 `failure("viewChanging", { toolRunning: runningToolName() })`, 성공에도 `toolRunning`을 싣는다. 길찾기 `guidanceActive: hasActiveGuideSession()`. 설명문은 §3.6 문장.

- [ ] **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(webmcp): manifest 한 벌·describe_app·read_current_view 화면 분기`.

---

### Task 13: `search_places`

**Files:**
- Create: `src/lib/webmcp/tools/search-places.ts`, `src/lib/webmcp/tools/ensure-view.ts`(공용 이동 헬퍼)
- Test: `src/lib/webmcp/tools/__tests__/search-places.test.ts`

**Interfaces:**
- Produces:
```ts
// ensure-view.ts
export async function withOp<T>(name: string, hostSignal: AbortSignal | undefined, body: (op: Op) => Promise<T>, onBusy: (running: string) => T): Promise<T>   // acquire → finally release
export async function ensureHome(op: Op): Promise<HomeBridge | ToolFailure>       // modalOpen → toHome → waitForView("home", {publishedAfter: seqBeforeNavigate})
export async function ensurePlace(place: Place, op: Op): Promise<PlaceBridge | ToolFailure>
export async function ensureDirections(op: Op): Promise<DirectionsBridge | ToolFailure>
```
각 `ensure*`는 이미 일치 게시면 이동하지 않고, 이동 중엔 `markChanging(op)`를 걸었다 푼다. 실패 매핑: `viewChanging` 예외 → `failure("viewChanging")`, `aborted` → `failure("aborted")`, `navigator().isModalOpen()` → `failure("modalOpen")`.

- [ ] **Step 1: 실패하는 테스트** — 가짜 `HomeBridge`·`Navigator`를 레지스트리에 게시하고:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { searchPlacesTool } from "../search-places";
import { __resetViewRegistryForTest, publishView, setNavigator } from "../../view-registry";
import { __resetToolLockForTest } from "../../tool-lock";
import { __resetToolBudgetForTest } from "../../tool-budget";
import { __setNonceForTest } from "../../place-refs";
import type { HomeBridge } from "../context";
afterEach(() => { __resetViewRegistryForTest(); __resetToolLockForTest(); __resetToolBudgetForTest(); });
function home(overrides: Partial<HomeBridge> = {}): HomeBridge {
  const snap = { attempt: 1, query: "강남역", sort: "accuracy" as const, places: [{ id: "p1", name: "강남역", category: "지하철역", address: "a", roadAddress: "r", lat: 37.49, lng: 127.02, phone: "02-1" }], addresses: [] };
  return { read: () => ({ query: "강남역", sort: "accuracy", attempt: 1, branches: { places: "done", addresses: "empty", web: "skipped" }, counts: { places: 1, addresses: 0, web: 0 }, chatOpen: false, webResults: [] }),
    runSearch: async () => ({ kind: "settled", attempt: 1, branches: { places: "done", addresses: "empty", web: "skipped" } }), snapshotFor: () => snap, openAddress: async () => ({ ok: true }), ...overrides };
}
describe("search_places(spec §3.2)", () => {
  it("홈에서 검색 → places에 ref·isStation, 좌표 없음", async () => {
    __setNonceForTest("n");
    publishView("home", home());
    setNavigator({ toHome: async () => {}, toDirections: () => {}, toPlace: () => {}, isModalOpen: () => false });
    const out = JSON.parse(await searchPlacesTool().execute({ query: "강남역" }));
    expect(out).toMatchObject({ ok: true, view: "home", places: [{ ref: "n.1.p.0", name: "강남역", isStation: true, phone: "02-1" }] });
    expect(JSON.stringify(out)).not.toMatch(/lat|lng/);
  });
  it("모달이 열려 있으면 modalOpen", async () => { publishView("home", home()); setNavigator({ toHome: async () => {}, toDirections: () => {}, toPlace: () => {}, isModalOpen: () => true }); expect(JSON.parse(await searchPlacesTool().execute({ query: "x" }))).toMatchObject({ ok: false, reason: "modalOpen" }); });
  it("빈 질의는 unsupported emptyQuery, 쿨다운 3초", async () => { /* 두 번 연속 → 둘째 cooldown{retryAfterMs} */ });
  it("web url은 origin+path, 좌표쌍 path면 url 생략", async () => { /* webResults에 https://a.b/x?lat=1 과 https://a.b/place/37.52,127.12 */ });
});
```

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — `execute`: `withOp("search_places", signal, async (op) => { query 검증; const home = await ensureHome(op); if ("ok" in home && home.ok === false) return finish(home, SHAPE); budget check/consume("search"); const outcome = await home.runSearch({query, sort}, op); switch → busy/superseded/aborted; const snap = home.snapshotFor(outcome.attempt); places = snap.places.map((p, i) => ({ ref: encodeRef(attempt, "p", i), name, category, address, roadAddress, distance: p.distanceMeters !== undefined ? formatDistance(p.distanceMeters) : undefined, phone, isStation: isStation(p) })); addresses = snap.addresses.map((a, i) => ({ ref: encodeRef(attempt, "a", i), road: a.roadAddr, jibun: a.jibunAddr, zip: a.zipNo, english: a.engAddr || undefined })); web = home.read().webResults.map(w => ({ title, url: safeUrl(w.url), snippet })) ; searchFailed 판정(places·addresses 둘 다 error) → failure; finish(..., SHAPE, { arrays: [{path:"web",mode:"count"},{path:"addresses",mode:"count"},{path:"places",mode:"count"}] }) }, (running) => finish(failure("busy", { running }), SHAPE))`. `safeUrl`: `new URL(u)` → `origin + pathname`, pathname에 `COORD_PAIR_RE`가 걸리면 `undefined`. `isStation`은 `@/lib/station-match`(lib이라 import 허용). `formatDistance`는 `@/lib/format`.

- [ ] **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(webmcp): search_places(홈 이동·runSearch·ref)`.

---

### Task 14: `get_place_info`

**Files:**
- Create: `src/lib/webmcp/tools/get-place-info.ts`
- Test: `src/lib/webmcp/tools/__tests__/get-place-info.test.ts`

**Interfaces:**
- Consumes: Task 4 `resolveRef`, Task 7·8 `PlaceBridge`, Task 6 `place-lines`(도구는 `t`를 어디서 받나 — **화면 소스의 `read().data`가 이미 줄 배열을 담는다**: 각 `AxisSource.read()`가 `lines`(문자열 배열)·`items`를 `data`에 싣는다. 그래서 도구는 i18n을 모른다. Task 7의 `read()` 구현을 이 계약으로 맞춘다: 시설 `data = { lines: korailFacilityLines(f, t) }`, 서울 `data = { groups: metroFacilityGroups(f, t), supplementFailed }`, 도착 `data = { items: arrivalItems(arrivals, t) }`, 시간표 `data = { basis: timetableHeaderLine(tt, t), lines: timetableLineItems(tt, t, isEn) }`, 메타 `data = { lines: stationMetaLines(meta, t, isEn) }`, 무장애 `data = { match, facilities: barrierFreeLines(d), source: t("source") }`).
- Produces: 출력 §3.3.

- [ ] **Step 1: 실패하는 테스트** — 가짜 `HomeBridge`(스냅샷)·`PlaceBridge`(축 엔트리 스텁)·`Navigator`로:

```ts
describe("get_place_info(spec §3.3)", () => {
  it("장소 ref → toPlace → 축 전부, 미요청 축 키 생략, notApplicable은 status", async () => { /* 비역: basic·barrierFree만, station 축 키 없음 */ });
  it("역: facilities는 korail+metro 두 소스, 하나만 done이면 partial", async () => {});
  it("staleResult 실패에 recovery·query가 실린다", async () => { expect(out).toMatchObject({ ok: false, reason: "staleResult", recovery: "search_places", query: "강남역" }); });
  it("이미 같은 placeId 게시면 toPlace를 부르지 않는다", async () => {});
  it("단일 축 + offset 페이징으로 전량 회수, 재직렬화는 예산 미소비", async () => { /* arrivals 60건 → truncated → offset 반복 → 합집합 60, consumeBudget 호출 1회 */ });
  it("refresh는 refresh(op)를 부르고 refreshError를 싣는다", async () => {});
  it("axes 여럿 + offset → unsupported offsetNeedsSingleAxis", async () => {});
});
```
(각 `it`은 위 골격의 가짜 브릿지로 채운다 — 축 엔트리 스텁은 `{ present, kind, read: () => snap, ensureLoaded: async () => ({kind:"settled", snapshot: snap}), refresh: vi.fn(async () => ...) }`.)

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — 요지:
```ts
execute: (input, ctx) => withOp("get_place_info", ctx?.signal, async (op) => {
  const home = bridgeOf<HomeBridge>("home")?.bridge ?? homeFallback(); // 홈 브릿지는 루트가 항상 게시(홈 비가시에도 read/snapshotFor는 유효) — Task 9에서 homeVisible 조건을 게시 조건에서 뺀다.
  const r = resolveRef(input.ref, latestSnapshot(home));
  if (r.kind === "staleResult") return finish(failure("staleResult", { recovery: "search_places", query: home.read().query }), SHAPE);
  if (r.kind === "notFound") return finish(failure("notFound"), SHAPE);
  const axesReq = parseAxes(input.axes); const offset = ...; if (offset !== undefined && axesReq.length !== 1) return unsupported offsetNeedsSingleAxis;
  const place = r.kind === "place" ? r.place : await (async () => { const o = await home.openAddress(r.address, op); ... })();
  const bridge = await ensurePlace(place, op); if (isFailure(bridge)) return finish(bridge, SHAPE);
  const wanted = axesReq ?? applicableAxes(bridge.read().isStation);
  const results = {}; for (const axis of wanted) { for (const key of axisEntries(axis)) { // facilities → ["facilities","facilitiesMetro"]
      const entry = bridge.axes[key]; const needsFetch = input.refresh === true || entry.read().status === "idle";
      if (needsFetch && entry.present) { const b = checkBudget(bucketOf(key)); if (!b.ok) { results[axis] = { status: "cooldown", retryAfterMs: b.retryAfterMs }; continue; } consumeBudget(bucketOf(key)); }
      const out = input.refresh ? await entry.refresh(op) : await entry.ensureLoaded(op);
      results[axis] = merge(results[axis], project(key, out)); } }
  return finish({ ok: true, view: "place", ref: r.ref, ...bridge.read() 기본 필드, ...results, axesRequested: wanted, offset }, SHAPE, { arrays: capPlan(wanted, offset) });
})
```
`capPlan`: 축 하나 + offset이면 그 축 배열 `mode:"page"`, 아니면 spec 순서(`arrivals.items` → `facilities.metro.groups` → `facilities.korail.lines` → `timetable.lines` → `basic.stationMeta.lines` → `barrierFree.facilities`)로 `mode:"count"`. `latestSnapshot(home)`은 `home.read().attempt`로 `snapshotFor`. 설명문(≤500자): "Open a place from search_places by ref and return its info exactly as shown: category, addresses, phone; for stations the timetable (first/last trains), accessibility facilities, real-time arrivals; and barrier-free facilities. Pick axes to narrow. If truncated, call again with one axis and offset. The app moves to the place screen."

- [ ] **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(webmcp): get_place_info(축 봉투·페이징·refresh)`.

---

### Task 15: `plan_directions` `toRef`·`ensureDirections` + W1 조회 도구 2종 레지스트리화

**Files:**
- Modify: `src/lib/webmcp/tools/plan-directions.ts`, `get-transit-route-detail.ts`, `get-route-steps.ts`
- Test: `src/lib/webmcp/tools/__tests__/plan-directions.test.ts`(신규 또는 기존 확장)

- [ ] **Step 1: 실패하는 테스트**

```ts
describe("plan_directions W2(spec §3.4)", () => {
  it("toRef는 좌표 endpoint로 runQuery에 실리고 텍스트 해석을 하지 않는다", async () => { /* fetch 스텁이 호출되지 않음을 단언, runQuery 인자 to.kind === "place" && coord */ });
  it("to와 toRef 둘 다면 unsupported toAndToRef", async () => {});
  it("길찾기 뷰가 아니면 toDirections 뒤 publishedAfter 일치 게시를 기다린다", async () => { /* navigator.toDirections에서 publishView("directions") 지연 게시 */ });
  it("sessionActive면 세션을 끊지 않는다(stop 호출 0)", async () => {});
  it("get_route_steps는 길찾기 뷰가 없으면 noResult{detail:'noDirectionsView'}", async () => {});
});
```

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — `planDirectionsTool()`(인자 없음): `withOp` → `toRef`가 있으면 `resolveRef` → place는 `{kind:"place", label: name, coord:{lat,lng}}`, address는 `resolveAddressCoord(roadAddrPart1 || roadAddr)` 실패 `geocodeFailed`; `to`·`toRef` 배타; `const bridge = await ensureDirections(op)`; 이후 W1 로직(`bridge.runQuery(request, op.signal)`). 쿨다운은 `tool-budget`의 `plan` 버킷으로 통일(`makeCooldown` 삭제됨). 출력에 `view:"directions"`. 나머지 두 도구는 `bridgeOf<DirectionsBridge>("directions")`가 null이면 `noResult{detail:"noDirectionsView"}`.

- [ ] **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(webmcp): plan_directions toRef·화면 자가 이동, 조회 도구 레지스트리화`.

---

### Task 16: 루트 상시 등록 + 통합 테스트

**Files:**
- Modify: `src/components/PlaceSearch.tsx`(`useWebMcpTools(() => buildAppTools(gates), { enabled: true })`; `gates`는 props에서), `src/hooks/useWebMcpTools.ts`(`abortNow` 제거 — Task 11에서 했다면 생략)
- Modify: `src/app/[locale]/page.tsx`(게이트 props 추가 필요 시 — `canShowWalk`·`canShowTransit`·`canBriefCarRoute`·`canShowSubway`·`canShowBarrierFree`는 이미 있다)
- Test: `src/components/__tests__/PlaceSearchWebMcp.test.tsx`에 추가

- [ ] **Step 1: 실패하는 테스트**

```tsx
it("마운트에 registerTool 7회, 상세·길찾기 전환 뒤 추가 등록 0", async () => {
  const registerTool = vi.fn(async () => {});
  Object.defineProperty(document, "modelContext", { configurable: true, value: { registerTool } });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ places: [p1], total: 1, addresses: [] }) })));
  render(<PlaceSearch isMockMode={false} canShowTransit />);
  await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(7));
  navigator()!.toPlace(p1, op()); await waitFor(() => expect(bridgeOf("place")).not.toBeNull());
  navigator()!.toDirections(op()); await waitFor(() => expect(bridgeOf("directions")).not.toBeNull());
  expect(registerTool).toHaveBeenCalledTimes(7);
  Reflect.deleteProperty(document, "modelContext");
});
it("연쇄: search_places → get_place_info(등록된 도구 execute로) 가 상세 제목 착지 한 번", async () => { /* 등록된 도구 객체를 registerTool 목에서 꺼내 execute; 착지는 h2 한 번(document.activeElement.tagName === "H2") */ });
```

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — `PlaceSearch` 상단에 `const gates = useMemo<ToolGates>(() => ({ hasWalk: canShowWalk, hasTransit: canShowTransit, hasCar: canBriefCarRoute, canShowSubway, canShowBarrierFree }), [...])`; `useWebMcpTools(() => buildAppTools(gates), { enabled: true })`. 홈 브릿지 게시 조건은 `homeVisible`이 아니라 **항상**(홈 브릿지는 결과 표 소유자이고 `currentView()`가 우선순위로 가른다) — Task 9의 게시 effect를 `[]` 의존으로 바꾼다.

- [ ] **Step 4: 통과 확인** — `npm run test:run` 전체, `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- [ ] **Step 5: 커밋** — `feat(webmcp): 루트 상시 등록 7개`.

---

### Task 17: 문서 분배 + privacy 문안 게이트 + 실기기 준비

**Files:**
- Modify: `CLAUDE.md` §WebMCP 도구층(정적 등록 문단·착지 ID·`guide-session-store` 스냅샷 문단을 이 판으로 교체 — "도구 목록 정본 7개, 루트 상시 등록, 도구가 화면을 스스로 옮긴다, 단일 잠금·op, 뷰 레지스트리 정체성 결박, ref nonce, 착지 최대 1"), `docs/INTEGRATIONS.md`(있으면 §WebMCP 갱신), `CHANGELOG.md`(2026-08-29 항목), `PROGRESS.md`(상태 한 줄), `docs/BACKLOG.md`(W2 게이트 ②→③, W1-R 종결), `docs/FIELD-TEST.md`(이미 갱신됨 — 확인만), `messages/{ko,en,es,fr,it,ja}.json` `privacy.agent`
- [ ] **Step 1: privacy 문안** — ko 초안을 TextEdit으로 띄워 위원장 왕복으로 확정(안내 상태·보행 인프라 삭제, 검색어·검색 결과·장소 정보 추가). 확정본을 나머지 5로케일로 번역해 `i18n-messages.test.ts` 통과.
- [ ] **Step 2: 문서 분배** — 서사 → CHANGELOG(spec 링크), 남은 판정(실기기 ⑧~⑪·순수 이동 도구 후속) → BACKLOG, 새 함정 → CLAUDE.md, 상태 한 줄 → PROGRESS.
- [ ] **Step 3: 게이트** — `npm run test:run`·`npm run lint`·`npx tsc --noEmit`·`npm run build`·`python sync_agent_docs.py`(워크스페이스 루트, CLAUDE.md 수정 시).
- [ ] **Step 4: 커밋·push** — `docs(webmcp): W2 마일스톤 분배 + privacy 문안`. push는 자동 배포이므로 실기기 게이트 ⑧~⑪은 배포 뒤 위원장이 ChatGPT 데스크톱 + VoiceOver로 수행(배포 차단 판정 — 실패 시 후속 세션).

## Self-Review

- **Spec coverage**: §3.0 잠금·op·사용자 우선·modalOpen·사유 코드(T1·T2·T13~15) / §3.1(T12) / §3.2(T9·T13) / §3.3(T6·T7·T8·T14) / §3.4·§3.5(T10·T15) / §3.6(T12) / §4·§8.4 삭제(T11) / §5.1(T12) / §5.2(T3·T8·T9·T10) / §5.3(T4) / §5.4(T7·T8) / §5.5(T5·T14) / §5.6(T16) / §6 착지 억제(T7·T9) / §7 스캔·privacy(T1·T17) / §8.2 테스트 전부 각 태스크에 / §8.3 실기기(T17).
- **Placeholder scan**: T8·T9·T14·T15의 일부 `it` 본문이 주석 서술이다 — 골격은 이웃 케이스와 동일하며 단언만 다르다고 명시했다. 구현자가 채운다.
- **Type consistency**: `AxisKey`에 `facilitiesMetro`를 T7에서 확정했고 T8·T14가 같은 키를 쓴다. `HomeBridge.snapshotFor`·`openAddress`·`SearchOutcome`은 T9 정의를 T13·T14가 소비한다. `Op`·`acquireOp`(T2)를 T3·T8·T9·T13~15가 같은 시그니처로 쓴다. `ToolGates`(T12)를 T16이 만든다.

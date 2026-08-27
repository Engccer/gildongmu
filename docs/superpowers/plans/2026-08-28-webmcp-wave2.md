# WebMCP 도구층 W2 구현 플랜

> **폐기(2026-08-29)**: 같은 날 저녁 위원장 재판정(사례 ① 한정·상시 집합 한 벌·`get_place_info` 하나)으로 이 플랜(화면별 배타 4집합, 20태스크)은 폐기됐다. 후속 정본은 spec `../specs/2026-08-29-webmcp-wave2-design.md`와 plan `2026-08-29-webmcp-wave2.md`. 본문은 기록으로 불변.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 검색·"내 주변" 허브·장소 상세 세 화면에 WebMCP 도구층을 얹고(홈 7·허브 14·상세 11, 길찾기는 `describe_app` +1), W1 도구 3건을 데이터 반환형 기준으로 재작업한다.

**Architecture:** 도구 정의는 `src/lib/webmcp/manifest.ts` 한 벌에서 화면별 집합을 생성한다. 데이터 반환 도구는 화면 브릿지의 **원자 호출**(`runSearch`·`runSectionLoad`)을 부르고 커밋 뒤 effect가 푸는 대기자로 정착을 기다린 뒤 화면이 그린 줄(`src/lib/nearby-lines/*`, 컴포넌트와 공용)을 돌려준다. 손잡이는 출처·화면 세대·조회 세대·순번을 결박한 불투명 `ref` 하나이고, 화면 전환은 `view-registry` 코디네이터가 새 집합 등록 완료를 확인한 뒤 `open_*`가 돌아온다.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Vitest 4(node-env 기본, 컴포넌트 테스트는 `// @vitest-environment jsdom` + @testing-library/react) / next-intl 4. `document.modelContext` 직접 등록(`usewebmcp` 미도입).

**Spec:** `docs/superpowers/specs/2026-08-28-webmcp-wave2-design.md` (W1 공통 계약은 `docs/superpowers/specs/2026-08-27-webmcp-tool-layer-design.md` §3.0·§4·§5·§6)

## Global Constraints

- 출력은 `finish(value, SHAPE, plan)`만 지난다. allowlist에 좌표성 키(`lat`·`lng`·`coord`·`coords`·`geometry`·`pathCoords`)를 넣지 않는다. 문자열을 자르지 않는다(항목 단위 생략만). 상한 1,500자.
- 도구 이름 30자 이내·`[a-z_]`, 설명 500자 이내, 파라미터 설명 150자 이내, 영어 고정 문자열.
- 전부 정적 등록(`useWebMcpTools`, `enabled`당 1회). 조건부 등록 금지. 런타임 부재는 침묵.
- 사람 문장은 화면과 같은 함수에서 나온다. 도구가 컴포넌트 모듈(`src/components/*`)의 named export를 import하지 않는다(기존 테스트의 모듈 목킹으로 스위트가 죽는다).
- `src/lib/**`는 React/Next 비의존. 브릿지·훅만 `src/hooks/**`·컴포넌트.
- 커밋은 `git commit -- <경로들>` pathspec(신규 파일은 `git add <경로>` 뒤 같은 명령). `git add -A` 금지. 커밋 메시지 한국어, 푸터 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- 테스트는 `npm run test:run -- <파일>`; 전체 게이트 `npm run test:run`·`npm run lint`·`npx tsc --noEmit`(Vitest green ≠ 타입 통과).
- privacy `privacy.agent` 문안 변경은 **위원장 TextEdit 왕복**으로 확정(Task 20, 배포 전 게이트). 그 전엔 문자열을 건드리지 않는다.
- 구현 방식 판정(AUTONOMY §구현 방식): Task 1~7(기반)은 선행 결정이 인터페이스를 정하므로 **inline 순차**, Task 8~11(줄 추출 10섹션)은 동형 반복이라 **subagent 병렬 가능**, Task 12~19는 브릿지 인터페이스 고정 뒤 화면별 독립이라 **subagent 가능**. 수정 파일이 겹치는 곳(`manifest.ts`·`index.ts`·`context.ts`)은 병렬 금지.

---

### Task 1: 사유 코드·섹션 키·상태 구조 타입

**Files:**
- Modify: `src/lib/webmcp/types.ts`
- Create: `src/lib/webmcp/section-types.ts`
- Test: `src/lib/webmcp/__tests__/section-types.test.ts`

**Interfaces:**
- Produces: `ToolReason`에 `staleView`·`staleResult`·`notConfigured`·`notApplicable`·`viewChanging` 추가. `SectionKey` union, `SectionStatus` union, `SectionItem`, `SectionSnapshot`, `AxisStatus`, `ViewName`.

- [ ] **Step 1: 실패 테스트**

```ts
// src/lib/webmcp/__tests__/section-types.test.ts
import { describe, expect, it } from "vitest";
import { failure } from "../types";
import { SECTION_KEYS, isSectionKey } from "../section-types";

describe("W2 reason codes", () => {
  it("staleView/staleResult are retryable, notConfigured/notApplicable are not", () => {
    expect(failure("staleView")).toMatchObject({ retryable: true, userActionRequired: false });
    expect(failure("staleResult")).toMatchObject({ retryable: true, userActionRequired: false });
    expect(failure("notConfigured")).toMatchObject({ retryable: false, userActionRequired: false });
    expect(failure("notApplicable")).toMatchObject({ retryable: false, userActionRequired: false });
    expect(failure("viewChanging")).toMatchObject({ retryable: true, userActionRequired: false });
  });
});

describe("section keys", () => {
  it("has 16 keys and a predicate", () => {
    expect(SECTION_KEYS).toHaveLength(16);
    expect(isSectionKey("clinics")).toBe(true);
    expect(isSectionKey("nope")).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:run -- src/lib/webmcp/__tests__/section-types.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: 구현**

`types.ts`의 `ToolReason` union 끝에 다섯 줄, `REASON_FLAGS`에 다섯 항목:

```ts
  | "upstreamError"
  /** W2: `ref`의 화면 세대가 지났다(화면 전환 뒤). */
  | "staleView"
  /** W2: `ref`의 조회 세대가 지났다(재조회 뒤) — W1 `stalePlan` 동형. */
  | "staleResult"
  /** W2: 키 게이트로 이 배포에 그 기능이 없다(데이터 0건과 다르다). */
  | "notConfigured"
  /** W2: 이 화면 대상에 해당 없음(비역에서 역 도구). */
  | "notApplicable"
  /** W2: 화면 전환 중(이전 집합 해제~새 집합 등록 사이). */
  | "viewChanging";
```

```ts
  staleView: { retryable: true, userActionRequired: false },
  staleResult: { retryable: true, userActionRequired: false },
  notConfigured: { retryable: false, userActionRequired: false },
  notApplicable: { retryable: false, userActionRequired: false },
  viewChanging: { retryable: true, userActionRequired: false },
```

```ts
// src/lib/webmcp/section-types.ts
/**
 * W2 섹션 어휘(spec §3.0·§4·§5). React 비의존.
 * `SectionKey`는 허브 패널 스토어 ID이자 착지 ID의 `key`이자 manifest의 섹션 도구 키다 — 한 어휘.
 */
import type { UnavailableHereReason } from "@/lib/out-of-coverage";

export const SECTION_KEYS = [
  "surroundings", "conditions", "subway", "bus", "bike", "clinics", "barrierFree", "kids",
  "events", "walkInfra",
  "stationTimetable", "stationFacilities", "stationMetro", "stationArrivals", "barrierFreeInfo",
  "stationMeta",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export function isSectionKey(v: unknown): v is SectionKey {
  return typeof v === "string" && (SECTION_KEYS as readonly string[]).includes(v);
}

export type ViewName = "home" | "directions" | "nearby" | "place";

/** 화면 union 그대로(spec §3.0 — 문자열로 접지 않는다). */
export type SectionStatus =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "done" }
  | { kind: "empty"; detail?: string }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "outOfCoverage" }
  | { kind: "unavailableHere"; reason: UnavailableHereReason };

export type AxisStatus = "done" | "empty" | "unknown" | "error" | "notConfigured";

/** 화면이 그린 항목 하나 — `line`은 h4+본문을 합친 단일 문장, `sub`는 그 아래 줄들. */
export interface SectionItem {
  n: number;
  line: string;
  sub: string[];
  /** 장소형 섹션만. `ref` 조립은 도구가 한다(순번 `row`만 둔다). */
  placeRow?: number;
  /** 도메인 상태 구조(진료 open/closed/unknown, 지하철 4-state). */
  state?: Record<string, string>;
}

/** 브릿지가 도구에 주는 스냅샷. 축형 섹션(`conditions`·`surroundings`)은 `axes`로. */
export interface SectionSnapshot {
  status: SectionStatus;
  /** 조회 시도 세대(모든 종단에 있다). */
  attempt: number;
  /** 화면이 지금 보여 주는 결과의 세대(복원되면 attempt와 다르다). */
  resultAttempt: number | null;
  heading: string;
  message: string;
  origin: "gps" | "manual" | "place" | null;
  manualLabel?: string;
  at?: string;
  items: SectionItem[];
  axes?: Record<string, { status: AxisStatus; lines: string[] }>;
}

export interface SectionOutcome {
  kind: "settled" | "busy" | "superseded" | "aborted" | "notConfigured" | "notApplicable";
  attempt: number;
  restoredPrevious?: boolean;
}
```

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS. `npx tsc --noEmit`도 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/webmcp/section-types.ts src/lib/webmcp/__tests__/section-types.test.ts
git commit -m "feat(webmcp): W2 사유 코드 5종·섹션 어휘·상태 구조 타입" -- src/lib/webmcp/types.ts src/lib/webmcp/section-types.ts src/lib/webmcp/__tests__/section-types.test.ts
```

---

### Task 2: 불투명 `ref` 토큰

**Files:**
- Create: `src/lib/webmcp/place-refs.ts`
- Test: `src/lib/webmcp/__tests__/place-refs.test.ts`

**Interfaces:**
- Produces: `encodeRef({viewEpoch, source, attempt, row}): string`, `decodeRef(s): RefParts | null`, `checkRef(parts, {viewEpoch, source?, attempt, rowCount}): "ok" | "staleView" | "staleResult" | "notFound" | "wrongSource"`. `source`는 `"search" | SectionKey`.

- [ ] **Step 1: 실패 테스트**

```ts
// src/lib/webmcp/__tests__/place-refs.test.ts
import { describe, expect, it } from "vitest";
import { checkRef, decodeRef, encodeRef } from "../place-refs";

describe("place refs", () => {
  const parts = { viewEpoch: 7, source: "clinics" as const, attempt: 3, row: 12 };
  it("round-trips and is opaque-looking", () => {
    const s = encodeRef(parts);
    expect(s).toMatch(/^[a-z0-9.]+$/);
    expect(decodeRef(s)).toEqual(parts);
  });
  it("rejects garbage", () => {
    expect(decodeRef("")).toBeNull();
    expect(decodeRef("a.b")).toBeNull();
    expect(decodeRef("7.nope.3.c")).toBeNull();
  });
  it("checks in the order viewEpoch → source → attempt → row", () => {
    expect(checkRef(parts, { viewEpoch: 8, attempt: 3, rowCount: 20 })).toBe("staleView");
    expect(checkRef(parts, { viewEpoch: 7, source: "events", attempt: 3, rowCount: 20 })).toBe("wrongSource");
    expect(checkRef(parts, { viewEpoch: 7, attempt: 4, rowCount: 20 })).toBe("staleResult");
    expect(checkRef(parts, { viewEpoch: 7, attempt: 3, rowCount: 12 })).toBe("notFound");
    expect(checkRef(parts, { viewEpoch: 7, attempt: 3, rowCount: 13 })).toBe("ok");
  });
});
```

- [ ] **Step 2: 실패 확인** — FAIL(모듈 없음).

- [ ] **Step 3: 구현**

```ts
// src/lib/webmcp/place-refs.ts
/**
 * `ref` — 출처·화면 세대·조회 세대·순번을 결박한 불투명 토큰(spec §3.0, 리뷰 #1).
 * 형식 `{viewEpoch}.{source}.{attempt}.{row}`(수는 base36). 파싱은 여기서만.
 */
import { isSectionKey, type SectionKey } from "./section-types";

export type RefSource = "search" | SectionKey;
export interface RefParts {
  viewEpoch: number;
  source: RefSource;
  attempt: number;
  row: number;
}

export function encodeRef(p: RefParts): string {
  return `${p.viewEpoch.toString(36)}.${p.source}.${p.attempt.toString(36)}.${p.row.toString(36)}`;
}

export function decodeRef(s: string): RefParts | null {
  if (typeof s !== "string") return null;
  const m = /^([0-9a-z]+)\.([a-zA-Z]+)\.([0-9a-z]+)\.([0-9a-z]+)$/.exec(s);
  if (!m) return null;
  const source = m[2];
  if (source !== "search" && !isSectionKey(source)) return null;
  const viewEpoch = parseInt(m[1], 36);
  const attempt = parseInt(m[3], 36);
  const row = parseInt(m[4], 36);
  if ([viewEpoch, attempt, row].some((n) => !Number.isInteger(n) || n < 0)) return null;
  return { viewEpoch, source, attempt, row };
}

export type RefCheck = "ok" | "staleView" | "staleResult" | "notFound" | "wrongSource";

export function checkRef(
  p: RefParts,
  now: { viewEpoch: number; source?: RefSource; attempt: number; rowCount: number },
): RefCheck {
  if (p.viewEpoch !== now.viewEpoch) return "staleView";
  if (now.source !== undefined && p.source !== now.source) return "wrongSource";
  if (p.attempt !== now.attempt) return "staleResult";
  if (p.row >= now.rowCount) return "notFound";
  return "ok";
}
```

- [ ] **Step 4: 통과 확인** → PASS.
- [ ] **Step 5: 커밋**

```bash
git add src/lib/webmcp/place-refs.ts src/lib/webmcp/__tests__/place-refs.test.ts
git commit -m "feat(webmcp): 불투명 ref 토큰(출처·화면 세대·조회 세대·순번 결박)" -- src/lib/webmcp/place-refs.ts src/lib/webmcp/__tests__/place-refs.test.ts
```

---

### Task 3: 전환 코디네이터 `view-registry` + 훅 연동

**Files:**
- Create: `src/lib/webmcp/view-registry.ts`
- Modify: `src/hooks/useWebMcpTools.ts`
- Test: `src/lib/webmcp/__tests__/view-registry.test.ts`, `src/hooks/__tests__/useWebMcpTools.test.tsx`(기존 파일에 케이스 추가)

**Interfaces:**
- Produces: `viewRegistry` 싱글턴 — `currentEpoch(): number`, `currentView(): ViewName | null`, `state(): "ready" | "leaving" | "none"`, `markLeaving(): number`, `markReady(view, epoch)`, `waitReady(view, {timeoutMs, signal}): Promise<boolean>`, `__reset()`. `useWebMcpTools(build, {enabled, view, onRegisterError?})` — `view` 인자 **필수**(`ViewName`). 훅이 등록 완료에 `markReady(view, epoch)`, abort에 `markLeaving()`을 부른다. 훅이 `execute`를 한 번 더 감싸 등록 epoch ≠ 현재 epoch면 `viewChanging` 실패 JSON을 돌려준다.

- [ ] **Step 1: 실패 테스트**

```ts
// src/lib/webmcp/__tests__/view-registry.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { viewRegistry } from "../view-registry";

describe("view registry", () => {
  beforeEach(() => viewRegistry.__reset());
  it("starts none, becomes ready, leaving bumps epoch", () => {
    expect(viewRegistry.state()).toBe("none");
    const e = viewRegistry.markLeaving();
    viewRegistry.markReady("home", e);
    expect(viewRegistry.state()).toBe("ready");
    expect(viewRegistry.currentView()).toBe("home");
    const e2 = viewRegistry.markLeaving();
    expect(e2).toBe(e + 1);
    expect(viewRegistry.state()).toBe("leaving");
  });
  it("ignores markReady for a stale epoch", () => {
    const e = viewRegistry.markLeaving();
    viewRegistry.markLeaving();
    viewRegistry.markReady("home", e);
    expect(viewRegistry.state()).toBe("leaving");
  });
  it("waitReady resolves true when the view becomes ready, false on timeout", async () => {
    const p = viewRegistry.waitReady("place", { timeoutMs: 50 });
    const e = viewRegistry.markLeaving();
    viewRegistry.markReady("place", e);
    await expect(p).resolves.toBe(true);
    await expect(viewRegistry.waitReady("nearby", { timeoutMs: 10 })).resolves.toBe(false);
  });
});
```

`useWebMcpTools.test.tsx`에 추가(기존 fake `document.modelContext` 스텁 관례를 그대로 쓴다):

```tsx
it("marks the view ready after registration and leaving on abort; execute during a newer epoch returns viewChanging", async () => {
  viewRegistry.__reset();
  const tool = { name: "t", description: "d", inputSchema: {}, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: async () => JSON.stringify({ ok: true }) };
  const { unmount } = renderHook(() => useWebMcpTools(() => [tool], { enabled: true, view: "home" }));
  await waitFor(() => expect(viewRegistry.state()).toBe("ready"));
  const registered = registeredTools()[0];
  viewRegistry.markLeaving(); // 다른 화면이 전환을 시작했다
  expect(JSON.parse(await registered.execute({}, {}))).toMatchObject({ ok: false, reason: "viewChanging" });
  unmount();
  expect(viewRegistry.state()).toBe("leaving");
});
```

- [ ] **Step 2: 실패 확인** — 두 파일 FAIL.

- [ ] **Step 3: 구현**

```ts
// src/lib/webmcp/view-registry.ts
/**
 * 화면 전환 코디네이터(spec §5.3, 리뷰 #4). React 비의존 싱글턴.
 * 겹침 0을 주장하지 않는다 — 전환 중 호출은 `viewChanging`으로 결정적으로 끝나고,
 * `open_*`는 새 화면의 `ready`를 기다려 `toolsReady`를 싣는다.
 */
import type { ViewName } from "./section-types";

type State = "none" | "leaving" | "ready";
let epoch = 0;
let state: State = "none";
let view: ViewName | null = null;
const listeners = new Set<() => void>();
function emit() { for (const l of Array.from(listeners)) l(); }

export const viewRegistry = {
  currentEpoch: () => epoch,
  currentView: () => view,
  state: () => state,
  /** 전환 시작(이전 집합 해제). 새 epoch를 돌려준다 — 등록자는 이 값을 `markReady`에 되돌린다. */
  markLeaving(): number {
    epoch += 1;
    state = "leaving";
    emit();
    return epoch;
  },
  markReady(v: ViewName, e: number) {
    if (e !== epoch) return; // 낡은 등록의 뒤늦은 완료 — 무시
    view = v;
    state = "ready";
    emit();
  },
  waitReady(v: ViewName, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<boolean> {
    if (state === "ready" && view === v) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (ok: boolean) => { listeners.delete(check); clearTimeout(timer); opts.signal?.removeEventListener("abort", onAbort); resolve(ok); };
      const check = () => { if (state === "ready" && view === v) done(true); };
      const onAbort = () => done(false);
      const timer = setTimeout(() => done(false), opts.timeoutMs);
      listeners.add(check);
      opts.signal?.addEventListener("abort", onAbort, { once: true });
    });
  },
  subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); },
  __reset() { epoch = 0; state = "none"; view = null; listeners.clear(); },
};
```

`useWebMcpTools.ts` 변경(전체 교체 — 시그니처에 `view` 추가, `wrapExecute`에 epoch 가드):

```ts
"use client";

import { useEffect, useRef } from "react";
import { anySignal, failure, modelContext, type WebMcpTool } from "@/lib/webmcp/types";
import { viewRegistry } from "@/lib/webmcp/view-registry";
import type { ViewName } from "@/lib/webmcp/section-types";

export function useWebMcpTools(
  build: () => WebMcpTool[],
  options: { enabled: boolean; view: ViewName; onRegisterError?: () => void },
): { abortNow: () => void } {
  const buildRef = useRef(build);
  const onErrorRef = useRef(options.onRegisterError);
  const controllerRef = useRef<AbortController | null>(null);
  const { enabled, view } = options;

  useEffect(() => {
    buildRef.current = build;
    onErrorRef.current = options.onRegisterError;
  });

  useEffect(() => {
    if (!enabled) return;
    // 등록 집합이 서는 순간이 곧 전환의 끝이다 — 런타임이 없어도 epoch는 굴린다(도구가 없을 뿐
    // "지금 어느 화면인가"는 화면 자신이 안다).
    const epoch = viewRegistry.markLeaving();
    const context = modelContext();
    if (!context) {
      viewRegistry.markReady(view, epoch);
      return () => { viewRegistry.markLeaving(); };
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    const tools = buildRef.current().map((tool) => wrapExecute(tool, controller.signal, epoch));
    void (async () => {
      try {
        for (const tool of tools) {
          if (controller.signal.aborted) return;
          await context.registerTool(tool, { signal: controller.signal });
        }
        if (!controller.signal.aborted) viewRegistry.markReady(view, epoch);
      } catch {
        if (!controller.signal.aborted) {
          controller.abort();
          onErrorRef.current?.();
        }
      }
    })();
    return () => {
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
      viewRegistry.markLeaving();
    };
  }, [enabled, view]);

  return {
    abortNow: () => {
      if (!controllerRef.current) return;
      controllerRef.current.abort();
      controllerRef.current = null;
      viewRegistry.markLeaving();
    },
  };
}

/** 호스트 signal + 등록 signal 합성, 그리고 등록 epoch 가드(spec §5.3 — 전환 중 호출은 `viewChanging`). */
function wrapExecute(tool: WebMcpTool, registration: AbortSignal, epoch: number): WebMcpTool {
  return {
    ...tool,
    execute: (input, context) => {
      if (viewRegistry.currentEpoch() !== epoch) return JSON.stringify(failure("viewChanging"));
      return tool.execute(input, { signal: anySignal([registration, context?.signal]) });
    },
  };
}
```

`DirectionsView.tsx`와 `PlaceSearch.tsx`의 기존 호출에 `view: "directions"`·`view: "home"`을 넣는다(타입 오류가 자리를 알려 준다). ⚠ `abortNow`가 `markLeaving`을 부르므로 W1의 "홈 → 길찾기 커밋 직전 abort" 순서는 그대로 코디네이터를 지난다.

- [ ] **Step 4: 통과 확인** — 두 테스트 + 기존 `useWebMcpTools.test.tsx` 전부 PASS, `npx tsc --noEmit` PASS.
- [ ] **Step 5: 커밋**

```bash
git add src/lib/webmcp/view-registry.ts src/lib/webmcp/__tests__/view-registry.test.ts
git commit -m "feat(webmcp): 화면 전환 코디네이터 — 등록 epoch·viewChanging·waitReady" -- src/lib/webmcp/view-registry.ts src/lib/webmcp/__tests__/view-registry.test.ts src/hooks/useWebMcpTools.ts src/hooks/__tests__/useWebMcpTools.test.tsx src/components/DirectionsView.tsx src/components/PlaceSearch.tsx
```

---

### Task 4: 쿨다운·세션 예산 버킷

**Files:**
- Create: `src/lib/webmcp/tool-budget.ts`
- Test: `src/lib/webmcp/__tests__/tool-budget.test.ts`

**Interfaces:**
- Produces: `BudgetKey` union(`subwayArrival|busArrival|bike|clinics|events|kids|barrierFree|walkInfra|surroundings|weather|air|congestion|stationTimetable|stationFacilities|stationArrivals|search`), `toolBudget.check(key, now): { ok: true } | { ok: false; retryAfterMs: number }`, `toolBudget.mark(key, now)`, `toolBudget.__reset()`. 규칙: 실시간(`subwayArrival`·`busArrival`·`stationArrivals`) 10초, `search` 3초, 그 외 60초; 버킷당 시간당 30회.

- [ ] **Step 1: 실패 테스트**

```ts
// src/lib/webmcp/__tests__/tool-budget.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { toolBudget } from "../tool-budget";

describe("tool budget", () => {
  beforeEach(() => toolBudget.__reset());
  it("realtime bucket cools down 10s, others 60s, search 3s — deterministic retryAfterMs", () => {
    toolBudget.mark("busArrival", 1_000);
    expect(toolBudget.check("busArrival", 4_000)).toEqual({ ok: false, retryAfterMs: 7_000 });
    expect(toolBudget.check("busArrival", 11_000)).toEqual({ ok: true });
    toolBudget.mark("clinics", 1_000);
    expect(toolBudget.check("clinics", 31_000)).toEqual({ ok: false, retryAfterMs: 30_000 });
    toolBudget.mark("search", 1_000);
    expect(toolBudget.check("search", 2_000)).toEqual({ ok: false, retryAfterMs: 2_000 });
  });
  it("hub and place share one bucket", () => {
    toolBudget.mark("busArrival", 0);
    expect(toolBudget.check("busArrival", 1)).toMatchObject({ ok: false });
  });
  it("caps 30 marks per rolling hour", () => {
    for (let i = 0; i < 30; i++) toolBudget.mark("clinics", i * 61_000);
    const r = toolBudget.check("clinics", 30 * 61_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterMs).toBe(3_600_000 - 30 * 61_000);
    expect(toolBudget.check("clinics", 3_600_001)).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현**

```ts
// src/lib/webmcp/tool-budget.ts
/**
 * 도구 유발 fetch의 쿨다운·세션 예산(spec §5.5, 리뷰 #14). 버킷은 컴포넌트가 아니라
 * **upstream 키**라 허브 버스와 상세 버스가 한 버킷이다. 모듈 싱글턴(재마운트에 안 지워진다).
 */
export type BudgetKey =
  | "subwayArrival" | "busArrival" | "bike" | "clinics" | "events" | "kids" | "barrierFree"
  | "walkInfra" | "surroundings" | "weather" | "air" | "congestion"
  | "stationTimetable" | "stationFacilities" | "stationArrivals" | "search";

const REALTIME: ReadonlySet<BudgetKey> = new Set(["subwayArrival", "busArrival", "stationArrivals"]);
const HOUR_MS = 3_600_000;
const PER_HOUR = 30;

function cooldownOf(key: BudgetKey): number {
  if (key === "search") return 3_000;
  if (REALTIME.has(key)) return 10_000;
  return 60_000;
}

const marks = new Map<BudgetKey, number[]>();

export const toolBudget = {
  check(key: BudgetKey, now: number): { ok: true } | { ok: false; retryAfterMs: number } {
    const list = (marks.get(key) ?? []).filter((t) => now - t < HOUR_MS);
    marks.set(key, list);
    const last = list[list.length - 1];
    if (last !== undefined) {
      const wait = cooldownOf(key) - (now - last);
      if (wait > 0) return { ok: false, retryAfterMs: wait };
    }
    if (list.length >= PER_HOUR) return { ok: false, retryAfterMs: list[0] + HOUR_MS - now };
    return { ok: true };
  },
  mark(key: BudgetKey, now: number) {
    const list = marks.get(key) ?? [];
    list.push(now);
    marks.set(key, list);
  },
  __reset() { marks.clear(); },
};
```

- [ ] **Step 4: 통과 확인** → PASS.
- [ ] **Step 5: 커밋**

```bash
git add src/lib/webmcp/tool-budget.ts src/lib/webmcp/__tests__/tool-budget.test.ts
git commit -m "feat(webmcp): upstream 키 버킷 쿨다운·세션 예산" -- src/lib/webmcp/tool-budget.ts src/lib/webmcp/__tests__/tool-budget.test.ts
```

---

### Task 5: 착지 ID 문법 확장

**Files:**
- Modify: `src/lib/webmcp/targets.ts`, `src/lib/webmcp/dom.ts`(`listHighLevelTargets`가 `item` 종류를 제외)
- Test: `src/lib/webmcp/__tests__/targets.test.ts`(기존에 케이스 추가)

**Interfaces:**
- Produces: `ParsedTarget`에 `{scope:"view", kind:"queryField"}`·`{scope:"view", kind:"placeHeading"}`·`{scope:"view", kind:"control", control:"submit"|"directions"|"chat"}`·`{scope:"view", kind:"panel", key: SectionKey}`·`{scope:"view", kind:"section", key: SectionKey}`·`{scope:"result", kind:"item", source: RefSource, n: number}`. `targetId.queryField()`·`placeHeading()`·`control(name)`·`panel(key)`·`section(key)`·`item(source, n)`. `isResultScoped(parsed)`.

- [ ] **Step 1: 실패 테스트(추가)**

```ts
it("parses W2 targets", () => {
  expect(parseTargetId("field:query")).toEqual({ scope: "view", kind: "queryField" });
  expect(parseTargetId("heading:place")).toEqual({ scope: "view", kind: "placeHeading" });
  expect(parseTargetId("control:directions")).toEqual({ scope: "view", kind: "control", control: "directions" });
  expect(parseTargetId("panel:clinics")).toEqual({ scope: "view", kind: "panel", key: "clinics" });
  expect(parseTargetId("section:stationTimetable")).toEqual({ scope: "view", kind: "section", key: "stationTimetable" });
  expect(parseTargetId("panel:clinics:item:3")).toEqual({ scope: "result", kind: "item", source: "clinics", n: 3 });
  expect(parseTargetId("place:item:1")).toEqual({ scope: "result", kind: "item", source: "search", n: 1 });
  expect(parseTargetId("address:item:2")).toEqual({ scope: "result", kind: "item", source: "search", n: 2, list: "address" });
  expect(parseTargetId("panel:nope:item:1")).toBeNull();
  expect(isResultScoped(parseTargetId("panel:bus:item:1")!)).toBe(true);
});
```

- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현** — `targets.ts`의 `ParsedTarget`에 위 variant를 더하고 `parseTargetId`에 분기를 추가한다:

```ts
  if (id === "field:query") return { scope: "view", kind: "queryField" };
  if (id === "heading:place") return { scope: "view", kind: "placeHeading" };
  if (parts[0] === "control" && parts.length === 2 && (parts[1] === "submit" || parts[1] === "directions" || parts[1] === "chat")) {
    return { scope: "view", kind: "control", control: parts[1] };
  }
  if ((parts[0] === "panel" || parts[0] === "section") && parts.length === 2 && isSectionKey(parts[1])) {
    return { scope: "view", kind: parts[0], key: parts[1] };
  }
  if ((parts[0] === "panel" || parts[0] === "section") && parts.length === 4 && parts[2] === "item" && isSectionKey(parts[1])) {
    const n = Number(parts[3]);
    if (!Number.isInteger(n) || n < 1) return null;
    return { scope: "result", kind: "item", source: parts[1], n };
  }
  if ((parts[0] === "place" || parts[0] === "address") && parts[1] === "item" && parts.length === 3) {
    const n = Number(parts[2]);
    if (!Number.isInteger(n) || n < 1) return null;
    return parts[0] === "place"
      ? { scope: "result", kind: "item", source: "search", n }
      : { scope: "result", kind: "item", source: "search", n, list: "address" };
  }
```

기존 `control:submit` 분기는 위 `control` 분기로 흡수한다(`ParsedTarget`의 `control` 타입을 `"submit" | "directions" | "chat"`으로 넓힌다 — W1 소비자는 `control === "submit"`만 본다). `targetId`에 빌더 여섯 개를 더하고 `export function isResultScoped(p: ParsedTarget) { return p.scope === "result"; }`. `dom.ts`의 `listHighLevelTargets`는 `parsed.kind === "item"`도 건너뛴다.

- [ ] **Step 4: 통과 확인** — `targets.test.ts`·기존 `focus-item` 관련 테스트 PASS, `tsc` PASS.
- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(webmcp): 착지 ID 문법 확장 — 홈·허브·상세 대상, 결과 범위 item" -- src/lib/webmcp/targets.ts src/lib/webmcp/dom.ts src/lib/webmcp/__tests__/targets.test.ts
```

---

### Task 6: manifest 골격 + `describe_app` + `index.ts` 재편

**Files:**
- Create: `src/lib/webmcp/manifest.ts`, `src/lib/webmcp/tools/describe-app.ts`
- Modify: `src/lib/webmcp/tools/index.ts`, `src/lib/webmcp/tools/context.ts`
- Test: `src/lib/webmcp/__tests__/manifest.test.ts`

**Interfaces:**
- Produces: `manifest.ts` — `ToolEntry<B> { name; description; inputSchema; annotations; shape; reasons: ToolReason[]; build: (bridge: B) => WebMcpTool }`, `VIEW_TOOLS: Record<ViewName, readonly string[]>`(정본 집합), `viewToolNames(view)`, `buildToolsFor(view, bridge)`. `context.ts` — `AppBridge { view: ViewName; gates: () => Partial<Record<SectionKey, boolean>>; isStation?: () => boolean }`(모든 화면 브릿지가 상속). `describe_app`은 `AppBridge`만 받는다.
- 이 태스크에서 `VIEW_TOOLS`는 W1 도구 + `describe_app`만 채우고, 뒤 태스크가 항목을 더한다(집합 equality 테스트의 기대값도 그때 갱신).

- [ ] **Step 1: 실패 테스트**

```ts
// src/lib/webmcp/__tests__/manifest.test.ts
import { describe, expect, it } from "vitest";
import { VIEW_TOOLS, TOOL_ENTRIES, viewToolNames } from "../manifest";

describe("manifest", () => {
  it("every view set names only registered entries, exactly", () => {
    for (const view of ["home", "directions", "nearby", "place"] as const) {
      for (const name of viewToolNames(view)) expect(TOOL_ENTRIES[name], name).toBeDefined();
    }
    expect([...viewToolNames("directions")].sort()).toEqual([
      "describe_app", "focus_item", "get_route_steps", "get_transit_route_detail", "get_walk_infrastructure_nearby",
      "guidance_status", "plan_directions", "read_current_view", "start_guidance", "stop_guidance",
    ]);
    expect([...viewToolNames("home")].sort()).toEqual(["describe_app", "open_directions"]);
  });
  it("names and descriptions fit Chrome budgets", () => {
    for (const [name, e] of Object.entries(TOOL_ENTRIES)) {
      expect(name.length).toBeLessThanOrEqual(30);
      expect(e.description.length).toBeLessThanOrEqual(500);
    }
  });
  it("describe_app lists the other views with availability from gates", async () => {
    const tool = TOOL_ENTRIES.describe_app.build({ view: "home", gates: () => ({ events: false }) });
    const out = JSON.parse(await tool.execute({}, {}));
    expect(out.currentView).toBe("home");
    const nearby = out.views.find((v: { view: string }) => v.view === "nearby");
    expect(nearby.unavailable).toContainEqual({ tool: "get_nearby_events", reason: "notConfigured" });
    expect(out.notes.join(" ")).toMatch(/AI chat/);
  });
});
```

- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현**

`context.ts`에 추가:

```ts
import type { SectionKey, ViewName } from "../section-types";

/** 모든 화면 브릿지의 공통부(spec §3.1 — `describe_app`이 읽는다). */
export interface AppBridge {
  view: ViewName;
  /** 키 게이트: 이 배포에서 그 섹션이 있는가(없는 키는 "이 화면과 무관"). */
  gates: () => Partial<Record<SectionKey, boolean>>;
  /** 장소 상세만: 현재 장소가 역인가. */
  isStation?: () => boolean;
}
```

`HomeBridge`·`DirectionsBridge`는 `extends AppBridge`로 바꾸고 `DirectionsView`·`PlaceSearch`의 브릿지 객체에 `view`·`gates`를 채운다(길찾기는 `gates: () => ({})`, 홈은 이 시점엔 `{}` — Task 14에서 채운다).

```ts
// src/lib/webmcp/manifest.ts
/**
 * 도구 정의 한 벌(spec §5.4, 리뷰 #5·#10). 같은 이름은 어느 화면이든 이 항목 하나에서 조립된다.
 * `VIEW_TOOLS`가 화면별 집합의 정본이고 `describe_app`·등록·테스트가 전부 이 표를 읽는다.
 */
import type { WebMcpTool, ToolReason } from "./types";
import type { Shape } from "./output";
import type { ViewName, SectionKey } from "./section-types";
import type { AppBridge, DirectionsBridge, HomeBridge } from "./tools/context";
import { readCurrentViewTool } from "./tools/read-current-view";
import { focusItemTool } from "./tools/focus-item";
import { planDirectionsTool } from "./tools/plan-directions";
import { getTransitRouteDetailTool } from "./tools/get-transit-route-detail";
import { getRouteStepsTool } from "./tools/get-route-steps";
import { startGuidanceTool } from "./tools/start-guidance";
import { guidanceStatusTool } from "./tools/guidance-status";
import { stopGuidanceTool } from "./tools/stop-guidance";
import { getWalkInfrastructureNearbyTool } from "./tools/get-walk-infrastructure-nearby";
import { openDirectionsTool } from "./tools/open-directions";
import { describeAppTool } from "./tools/describe-app";

export interface ToolEntry<B = never> {
  description: string;
  /** 이 도구가 어느 섹션 게이트에 묶이는가(`describe_app`의 available/unavailable 판정). */
  gate?: SectionKey;
  /** 역 전용 도구(비역이면 `notApplicable`). */
  stationOnly?: boolean;
  build: (bridge: B) => WebMcpTool;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOL_ENTRIES: Record<string, ToolEntry<any>> = {
  describe_app: { description: describeAppTool.description, build: (b: AppBridge) => describeAppTool.build(b) },
  read_current_view: { description: "…", build: (b: DirectionsBridge) => readCurrentViewTool(b) },
  focus_item: { description: "…", build: (b: DirectionsBridge) => focusItemTool(b) },
  plan_directions: { description: "…", build: (b: DirectionsBridge) => planDirectionsTool(b) },
  get_transit_route_detail: { description: "…", build: (b: DirectionsBridge) => getTransitRouteDetailTool(b) },
  get_route_steps: { description: "…", build: (b: DirectionsBridge) => getRouteStepsTool(b) },
  start_guidance: { description: "…", build: (b: DirectionsBridge) => startGuidanceTool(b) },
  guidance_status: { description: "…", build: () => guidanceStatusTool() },
  stop_guidance: { description: "…", build: () => stopGuidanceTool() },
  get_walk_infrastructure_nearby: { description: "…", gate: "walkInfra", build: () => getWalkInfrastructureNearbyTool() },
  open_directions: { description: "…", build: (b: HomeBridge) => openDirectionsTool(b) },
};
```

⚠ 위 `description: "…"`는 **각 도구 파일의 description 문자열을 export한 상수**로 채운다: 각 `tools/*.ts`에 `export const DESCRIPTION = "…"`를 두고 도구 객체도 그 상수를 쓴다(문자열이 두 벌이 되지 않게). 이 태스크에서 W1 도구 10개 파일 전부에 그 상수를 추가한다.

```ts
export const VIEW_TOOLS: Record<ViewName, readonly string[]> = {
  home: ["describe_app", "open_directions"],
  directions: [
    "describe_app", "read_current_view", "focus_item", "plan_directions", "get_transit_route_detail",
    "get_route_steps", "start_guidance", "guidance_status", "stop_guidance", "get_walk_infrastructure_nearby",
  ],
  nearby: ["describe_app"],
  place: ["describe_app"],
};

export function viewToolNames(view: ViewName): readonly string[] { return VIEW_TOOLS[view]; }

export function buildToolsFor<B extends AppBridge>(view: ViewName, bridge: B): WebMcpTool[] {
  return VIEW_TOOLS[view].map((name) => TOOL_ENTRIES[name].build(bridge));
}

/** `describe_app`이 읽는 화면 설명(영어 고정). */
export const VIEW_INFO: Record<ViewName, { description: string; reach: Array<{ tool: string; requires?: string; produces?: string }> }> = {
  home: { description: "Search places and addresses; entry to the other screens.", reach: [] },
  directions: { description: "Plan transit, walking and driving routes; start live guidance.", reach: [{ tool: "open_directions" }] },
  nearby: { description: "What is around the user's current location: surroundings, weather/air, subway, bus, bike, clinics, barrier-free places, kids places, events, pedestrian infrastructure.", reach: [{ tool: "open_nearby" }] },
  place: { description: "One place in detail; for stations also timetable, facilities and live arrivals.", reach: [{ tool: "search_places", produces: "ref" }, { tool: "open_place", requires: "ref" }] },
};
```

```ts
// src/lib/webmcp/tools/describe-app.ts
import { finish, withFailure } from "../output";
import type { WebMcpTool } from "../types";
import type { AppBridge } from "./context";
import { TOOL_ENTRIES, VIEW_INFO, VIEW_TOOLS } from "../manifest";

export const DESCRIPTION =
  "Describe what the Gildongmu web app can do for the agent: the four screens, which tools each screen registers, which of them are available in this deployment, and how to reach each screen. Tools belong to the screen that is open; open_* switches screens. AI chat has no tool. Call this first when unsure what the app offers.";

export const SHAPE = withFailure({
  ok: true,
  currentView: true,
  views: [{ view: true, description: true, available: [true], unavailable: [{ tool: true, reason: true }], reach: [{ tool: true, requires: true, produces: true }] }],
  notes: [true],
});

export const describeAppTool = {
  description: DESCRIPTION,
  build(bridge: AppBridge): WebMcpTool {
    return {
      name: "describe_app",
      description: DESCRIPTION,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => {
        const gates = bridge.gates();
        const station = bridge.isStation?.() ?? null;
        const views = (Object.keys(VIEW_TOOLS) as Array<keyof typeof VIEW_TOOLS>).map((view) => {
          const available: string[] = [];
          const unavailable: Array<{ tool: string; reason: string }> = [];
          for (const name of VIEW_TOOLS[view]) {
            const e = TOOL_ENTRIES[name];
            if (e.gate && gates[e.gate] === false) unavailable.push({ tool: name, reason: "notConfigured" });
            else if (e.stationOnly && view === bridge.view && station === false) unavailable.push({ tool: name, reason: "notApplicable" });
            else available.push(name);
          }
          return { view, description: VIEW_INFO[view].description, available, unavailable, reach: VIEW_INFO[view].reach };
        });
        return finish(
          {
            ok: true,
            currentView: bridge.view,
            views,
            notes: [
              "AI chat exists on the home and place screens; it has no tool — use the individual tools instead.",
              "Tools belong to the screen that is open. open_* switches screens and returns when the new tools are registered.",
              "The app never returns coordinates.",
            ],
          },
          SHAPE,
        );
      },
    };
  },
};
```

`index.ts`는 `buildDirectionsTools(bridge) = buildToolsFor("directions", bridge)`, `buildHomeTools(bridge) = buildToolsFor("home", bridge)`로 바꾸고 `DIRECTIONS_TOOL_NAMES`·`HOME_TOOL_NAMES`는 `VIEW_TOOLS`에서 파생한다(기존 소비자 유지). ⚠ 순환 import(`manifest` ↔ `describe-app`)는 `describe-app`이 manifest를 **런타임에**만 읽고 manifest는 `describe-app`의 값을 import하므로 ESM에서 성립하지만, 확실히 하려면 `describe-app.ts`가 `import * as manifest from "../manifest"`로 지연 참조한다.

- [ ] **Step 4: 통과 확인** — `manifest.test.ts` + 기존 W1 스위트 전부 PASS(기존 `DirectionsWebMcp.test.tsx`는 등록 수 9→10을 기대하도록 갱신).
- [ ] **Step 5: 커밋**

```bash
git add src/lib/webmcp/manifest.ts src/lib/webmcp/tools/describe-app.ts src/lib/webmcp/__tests__/manifest.test.ts
git commit -m "feat(webmcp): manifest 한 벌 + describe_app(런타임 게이트 결합) + index 재편" -- src/lib/webmcp/manifest.ts src/lib/webmcp/tools src/lib/webmcp/__tests__/manifest.test.ts src/components/DirectionsView.tsx src/components/PlaceSearch.tsx src/components/__tests__/DirectionsWebMcp.test.tsx
```

---

### Task 7: 안정 패널 키 + 섹션 브릿지 + 원자 `runSectionLoad`

**Files:**
- Modify: `src/hooks/useNearbyPanel.ts`(옵션 `key: SectionKey` 필수, `useId` 제거), `src/hooks/useNearbyFetch.ts`(옵션 `key: SectionKey`·`bridge?: SectionRegistry` 추가, 대기자 슬롯)
- Create: `src/lib/webmcp/section-registry.ts`, `src/hooks/useSectionBridge.ts`
- Test: `src/lib/webmcp/__tests__/section-registry.test.ts`, `src/hooks/__tests__/useNearbyFetch-bridge.test.tsx`

**Interfaces:**
- Produces: `SectionRegistry`(React 비의존, 화면마다 인스턴스) — `createSectionRegistry(keys: SectionKey[], gates: Partial<Record<SectionKey, boolean>>)`, `registry.entry(key): SectionEntry`, `SectionEntry { key; present: boolean; read: () => SectionSnapshot; runLoad: (opts: {force: boolean}, signal: AbortSignal) => Promise<SectionOutcome>; expand: () => void }`, 채움 API `registry.attach(key, impl: { read, startLoad: (force) => number | null /* attempt or null when busy */, expand })`, `registry.settle(key, attempt)`(커밋 뒤 effect가 부른다), `registry.detach(key)`(대기자 `aborted`).
- `useNearbyFetch`는 `key`를 받아 `useNearbyPanel({ key, … })`에 넘기고, `bridge`가 있으면 `attach`하며 status가 종단으로 **커밋된 뒤** `useEffect`에서 `bridge.settle(key, seqRef.current)`를 부른다. `load(force)`의 반환형을 `number | null`(시작한 attempt, 잠금 중이면 null)로 바꾼다.

- [ ] **Step 1: 실패 테스트**

```ts
// src/lib/webmcp/__tests__/section-registry.test.ts
import { describe, expect, it } from "vitest";
import { createSectionRegistry } from "../section-registry";

const snap = (kind: "idle" | "done" | "loading", attempt: number) => ({
  status: { kind } as const, attempt, resultAttempt: kind === "done" ? attempt : null,
  heading: "", message: "", origin: null, items: [],
});

describe("section registry", () => {
  it("absent key → notConfigured without touching the impl", async () => {
    const reg = createSectionRegistry(["clinics", "events"], { events: false });
    const out = await reg.entry("events").runLoad({ force: false }, new AbortController().signal);
    expect(out.kind).toBe("notConfigured");
  });
  it("runLoad starts, waits for settle of the same attempt, returns settled", async () => {
    const reg = createSectionRegistry(["clinics"], {});
    let current = snap("idle", 0);
    reg.attach("clinics", { read: () => current, startLoad: () => { current = snap("loading", 1); return 1; }, expand: () => {} });
    const p = reg.entry("clinics").runLoad({ force: false }, new AbortController().signal);
    current = snap("done", 1);
    reg.settle("clinics", 1);
    await expect(p).resolves.toEqual({ kind: "settled", attempt: 1, restoredPrevious: false });
  });
  it("done and not force → returns immediately without startLoad", async () => {
    const reg = createSectionRegistry(["clinics"], {});
    let started = 0;
    reg.attach("clinics", { read: () => snap("done", 4), startLoad: () => { started++; return 5; }, expand: () => {} });
    const out = await reg.entry("clinics").runLoad({ force: false }, new AbortController().signal);
    expect(out).toEqual({ kind: "settled", attempt: 4, restoredPrevious: false });
    expect(started).toBe(0);
  });
  it("busy when startLoad returns null; superseded when a newer attempt settles; aborted on detach", async () => {
    const reg = createSectionRegistry(["clinics"], {});
    let current = snap("idle", 0);
    reg.attach("clinics", { read: () => current, startLoad: () => null, expand: () => {} });
    await expect(reg.entry("clinics").runLoad({ force: true }, new AbortController().signal)).resolves.toMatchObject({ kind: "busy" });
    reg.attach("clinics", { read: () => current, startLoad: () => { current = snap("loading", 2); return 2; }, expand: () => {} });
    const p = reg.entry("clinics").runLoad({ force: true }, new AbortController().signal);
    current = snap("done", 3);
    reg.settle("clinics", 3);
    await expect(p).resolves.toMatchObject({ kind: "superseded" });
    const p2 = reg.entry("clinics").runLoad({ force: true }, new AbortController().signal);
    reg.detach("clinics");
    await expect(p2).resolves.toMatchObject({ kind: "aborted" });
  });
  it("restoredPrevious when the settled snapshot shows an older resultAttempt", async () => {
    const reg = createSectionRegistry(["clinics"], {});
    let current = snap("done", 5);
    reg.attach("clinics", { read: () => current, startLoad: () => { current = { ...snap("loading", 6) }; return 6; }, expand: () => {} });
    const p = reg.entry("clinics").runLoad({ force: true }, new AbortController().signal);
    current = { ...snap("done", 6), resultAttempt: 5 };
    reg.settle("clinics", 6);
    await expect(p).resolves.toEqual({ kind: "settled", attempt: 6, restoredPrevious: true });
  });
});
```

- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현**

```ts
// src/lib/webmcp/section-registry.ts
/**
 * 화면이 소유하는 섹션 엔트리 표(spec §5.2, 리뷰 #2·#6). 모든 키의 엔트리가 처음부터 있고,
 * 컴포넌트는 `attach`로 채울 뿐이다. `runLoad`는 시작과 대기를 한 원자 호출로 묶는다.
 */
import type { SectionKey, SectionOutcome, SectionSnapshot } from "./section-types";

export interface SectionImpl {
  read: () => SectionSnapshot;
  /** 새 attempt를 시작하고 그 번호를 돌려준다. 잠금 중이면 null. */
  startLoad: (force: boolean) => number | null;
  expand: () => void;
}

export interface SectionEntry {
  key: SectionKey;
  present: boolean;
  attached: () => boolean;
  read: () => SectionSnapshot;
  expand: () => void;
  runLoad: (opts: { force: boolean }, signal: AbortSignal) => Promise<SectionOutcome>;
}

export interface SectionRegistry {
  entry: (key: SectionKey) => SectionEntry;
  attach: (key: SectionKey, impl: SectionImpl) => void;
  detach: (key: SectionKey) => void;
  /** 커밋 뒤 effect가 부른다 — `attempt`가 종단에 도달했다. */
  settle: (key: SectionKey, attempt: number) => void;
}

type Waiter = { attempt: number; resolve: (o: SectionOutcome) => void };

const IDLE: SectionSnapshot = { status: { kind: "idle" }, attempt: 0, resultAttempt: null, heading: "", message: "", origin: null, items: [] };

export function createSectionRegistry(
  keys: readonly SectionKey[],
  gates: Partial<Record<SectionKey, boolean>>,
): SectionRegistry {
  const impls = new Map<SectionKey, SectionImpl>();
  const waiters = new Map<SectionKey, Waiter>();

  function finishWaiter(key: SectionKey, outcome: SectionOutcome) {
    const w = waiters.get(key);
    if (!w) return;
    waiters.delete(key);
    w.resolve(outcome);
  }

  function makeEntry(key: SectionKey): SectionEntry {
    const present = gates[key] !== false;
    return {
      key,
      present,
      attached: () => impls.has(key),
      read: () => impls.get(key)?.read() ?? IDLE,
      expand: () => impls.get(key)?.expand(),
      runLoad(opts, signal) {
        if (!present) return Promise.resolve({ kind: "notConfigured", attempt: 0 });
        const impl = impls.get(key);
        if (!impl) return Promise.resolve({ kind: "notConfigured", attempt: 0 });
        const before = impl.read();
        impl.expand();
        if (!opts.force && before.status.kind === "done") {
          return Promise.resolve({ kind: "settled", attempt: before.attempt, restoredPrevious: false });
        }
        if (waiters.has(key)) return Promise.resolve({ kind: "busy", attempt: before.attempt });
        const attempt = impl.startLoad(opts.force);
        if (attempt === null) return Promise.resolve({ kind: "busy", attempt: before.attempt });
        return new Promise<SectionOutcome>((resolve) => {
          waiters.set(key, { attempt, resolve });
          const onAbort = () => finishWaiter(key, { kind: "aborted", attempt });
          signal.addEventListener("abort", onAbort, { once: true });
        });
      },
    };
  }

  const entries = new Map<SectionKey, SectionEntry>(keys.map((k) => [k, makeEntry(k)]));

  return {
    entry: (key) => entries.get(key) ?? makeEntry(key),
    attach: (key, impl) => { impls.set(key, impl); },
    detach: (key) => { impls.delete(key); finishWaiter(key, { kind: "aborted", attempt: 0 }); },
    settle(key, attempt) {
      const w = waiters.get(key);
      if (!w) return;
      if (attempt < w.attempt) return; // 옛 세대의 뒤늦은 정착 — 무시
      if (attempt > w.attempt) { finishWaiter(key, { kind: "superseded", attempt }); return; }
      const snap = impls.get(key)?.read();
      const restored = snap ? snap.resultAttempt !== null && snap.resultAttempt !== attempt : false;
      finishWaiter(key, { kind: "settled", attempt, restoredPrevious: restored });
    },
  };
}
```

`useNearbyPanel.ts`: `Options`에 `key: SectionKey` 추가, `const id = useId()` 삭제, `id` 자리에 `key`를 쓴다.

`useNearbyFetch.ts` 변경점:
1. `Options<T>`에 `key: SectionKey`·`bridge?: SectionRegistry`·`toSnapshot?: (status: NearbyStatus<T>) => Pick<SectionSnapshot, "heading" | "message" | "items" | "axes">` 추가(줄 조립은 Task 8~11이 넣는다).
2. `useNearbyPanel({ key, engaged, onDismiss, onEscape })`.
3. `load(force)`가 `number | null`을 돌려준다(`if (lockRef.current !== null) return null;` … `return id;`). 기존 호출부는 반환값을 안 써도 된다.
4. 복원 세대 추적: `resultAttemptRef = useRef<number | null>(null)`. `done` 커밋 시 `resultAttemptRef.current = id`. force 실패로 `prevStatus`를 복원하는 두 분기에서는 갱신하지 않는다(그래서 `attempt ≠ resultAttempt`가 된다).
5. attach/settle effect:

```ts
  useEffect(() => {
    if (!bridge) return;
    bridge.attach(key, {
      read: () => ({
        status: toSectionStatus(statusRef.current),
        attempt: seqRef.current,
        resultAttempt: resultAttemptRef.current,
        origin: statusRef.current.kind === "done" ? statusRef.current.origin : null,
        manualLabel: statusRef.current.kind === "done" ? statusRef.current.manualLabel : undefined,
        at: statusRef.current.kind === "done" ? statusRef.current.at : undefined,
        ...(toSnapshotRef.current?.(statusRef.current) ?? { heading: "", message: "", items: [] }),
      }),
      startLoad: (force) => loadRef.current(force),
      expand: () => { if (participates) claim(); },
    });
    return () => bridge.detach(key);
  }, [bridge, key, participates, claim]);

  // 종단 커밋 뒤 정착 통보(리뷰 #2 — 동기 resolve 금지).
  useEffect(() => {
    if (!bridge) return;
    const k = status.kind;
    if (k === "idle" || k === "locating" || k === "loading") return;
    bridge.settle(key, seqRef.current);
  }, [bridge, key, status]);
```

`statusRef`·`loadRef`·`toSnapshotRef`는 매 렌더 effect로 최신화한다(W1 `bridgeRef` 관례). `toSectionStatus`는 `NearbyStatus<T>` → `SectionStatus`(`empty.detail`은 도메인이 문자열로 준 것만, 없으면 생략).

```tsx
// src/hooks/__tests__/useNearbyFetch-bridge.test.tsx
// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import { createSectionRegistry } from "@/lib/webmcp/section-registry";

vi.mock("@/lib/geolocation", () => ({ awaitGeolocation: async () => ({ status: "ready", coords: { lat: 37.5, lng: 127.1 } }) }));
vi.mock("@/lib/effective-location", () => ({ awaitManualLocation: async () => null }));

describe("useNearbyFetch × section registry", () => {
  it("runLoad resolves after the done commit, and read() sees the committed snapshot", async () => {
    const reg = createSectionRegistry(["clinics"], {});
    const fetchAt = vi.fn(async () => new Response(JSON.stringify({ clinics: [{ name: "A" }] }), { status: 200 }));
    renderHook(() =>
      useNearbyFetch<{ n: number }>({
        key: "clinics", bridge: reg, source: { kind: "current" }, fetchAt,
        parse: (b) => ({ kind: "done", data: { n: (b as { clinics: unknown[] }).clinics.length } }),
        toSnapshot: (s) => ({ heading: s.kind === "done" ? "h" : "", message: "", items: s.kind === "done" ? [{ n: 1, line: "A", sub: [] }] : [] }),
      }),
    );
    let out: unknown;
    await act(async () => { out = await reg.entry("clinics").runLoad({ force: false }, new AbortController().signal); });
    expect(out).toMatchObject({ kind: "settled", attempt: 1 });
    await waitFor(() => expect(reg.entry("clinics").read().items).toEqual([{ n: 1, line: "A", sub: [] }]));
  });
});
```

- [ ] **Step 4: 통과 확인** — 두 새 테스트 + `nearby-contract.tsx` 스위트(섹션 10곳의 `useNearbyFetch` 호출에 `key`를 넣어야 타입이 통과한다 — 이 태스크에서 각 컴포넌트에 `key: "<SectionKey>"` 한 줄씩 추가) PASS, `tsc` PASS.
- [ ] **Step 5: 커밋**

```bash
git add src/lib/webmcp/section-registry.ts src/hooks/useSectionBridge.ts src/lib/webmcp/__tests__/section-registry.test.ts src/hooks/__tests__/useNearbyFetch-bridge.test.tsx
git commit -m "feat(nearby): 안정 패널 키·섹션 레지스트리·원자 runSectionLoad(커밋 뒤 정착)" -- src/hooks src/lib/webmcp/section-registry.ts src/lib/webmcp/__tests__/section-registry.test.ts src/components
```

(`useSectionBridge.ts`는 `useNearbyFetch`를 쓰지 않는 섹션(`LocalConditions`·역 4종·`BarrierFreeInfo`)이 같은 attach/settle 계약을 따르게 하는 얇은 훅이다 — `useSectionBridge(registry, key, { read, startLoad, expand }, settledDeps)`; 본문은 위 두 effect와 같다. Task 11·16·17이 쓴다.)

---

### Task 8: 줄 조립 추출 — 소아 진료(정본 패턴) + 화면 대조 테스트

**Files:**
- Create: `src/lib/nearby-lines/types.ts`, `src/lib/nearby-lines/clinics.ts`
- Modify: `src/components/NightClinicsNearby.tsx`
- Test: `src/lib/nearby-lines/__tests__/clinics.test.tsx`

**Interfaces:**
- Produces: `Translator` 타입(`nearby-live.ts`와 동일), `clinicLines(data: ClinicsData, t: Translator): SectionItem[]`(항목당 `line` = h4 문장, `sub` = [진료 상태 줄, 공휴일 줄?, 전화?, 주소, 안내?], `state: { open }`), `clinicsHeading(status, t)`. 컴포넌트는 이 배열로 렌더한다(`<h4>{item.line}</h4>` + `sub.map(<p>)`, 전화만 `<a href="tel:">`로 따로 — `sub`에는 전화 문자열이 들어가고 렌더가 링크로 감싼다).

- [ ] **Step 1: 실패 테스트(jsdom 대조)**

```tsx
// src/lib/nearby-lines/__tests__/clinics.test.tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import ko from "@/../messages/ko.json";
import { clinicLines } from "@/lib/nearby-lines/clinics";
import { NightClinicsNearby } from "@/components/NightClinicsNearby";

const clinic = {
  id: "c1", name: "우리소아과", kind: "소아청소년과", address: "서울 강동구 천호대로 1", phone: "02-000-0000",
  distanceMeters: 420, directions: "2층", hours: {}, openStatus: { state: "open", start: 900, end: 2100 },
};
const data = { clinics: [clinic], basis: "weekday" as const, supplementFailed: false };

vi.mock("@/hooks/useNearbyFetch", () => ({
  useNearbyFetch: () => ({
    status: { kind: "done", data, at: "10:00", coords: { lat: 0, lng: 0 }, origin: "gps" },
    doneSeq: 1, load: () => 1, close: () => {}, busy: false, headingRef: { current: null }, triggerRef: { current: null },
  }),
}));

describe("clinic lines == rendered lines", () => {
  it("the tool line and sub match the <li> text", () => {
    render(<NextIntlClientProvider locale="ko" messages={ko}><NightClinicsNearby /></NextIntlClientProvider>);
    const li = screen.getAllByRole("listitem")[0];
    const t = (k: string, p?: Record<string, string | number | Date>) => {
      // next-intl 동형 최소 변환기: messages.clinicNearby[k]에 {x} 치환
      let s = (ko as Record<string, Record<string, string>>).clinicNearby[k];
      for (const [name, v] of Object.entries(p ?? {})) s = s.replace(`{${name}}`, String(v));
      return s;
    };
    const [item] = clinicLines(data, t);
    expect(li.querySelector("h4")?.textContent).toBe(item.line);
    const paragraphs = Array.from(li.querySelectorAll("p")).map((p) => p.textContent);
    expect(paragraphs).toEqual(item.sub);
    expect(item.state).toEqual({ open: "open" });
  });
});
```

- [ ] **Step 2: 실패 확인** — FAIL(모듈 없음).
- [ ] **Step 3: 구현**

```ts
// src/lib/nearby-lines/types.ts
export type Translator = (key: string, params?: Record<string, string | number | Date>) => string;
export type { SectionItem } from "@/lib/webmcp/section-types";
```

```ts
// src/lib/nearby-lines/clinics.ts
/**
 * 소아 진료 항목의 줄 조립 — 컴포넌트와 도구가 같은 함수를 부른다(spec §3.5 "화면과 같은 함수").
 * 본문은 종전 `NightClinicsNearby.tsx`의 joinText 호출을 그대로 옮긴 것이다.
 */
import { formatDistance, joinText } from "@/lib/format";
import type { ClinicOpenStatus, NightClinic } from "@/lib/types";
import type { SectionItem, Translator } from "./types";

export type ClinicWithStatus = NightClinic & { openStatus: ClinicOpenStatus };
export interface ClinicsData { clinics: ClinicWithStatus[]; basis: "holiday" | "weekday"; supplementFailed: boolean }

export function formatClinicTime(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  const s = String(Math.trunc(n)).padStart(4, "0");
  return `${s.slice(0, 2)}:${s.slice(2)}`;
}

export function clinicLines(data: ClinicsData, t: Translator): SectionItem[] {
  return data.clinics.map((c, i) => {
    const holiday = c.hours[7];
    const sub: string[] = [];
    sub.push(
      joinText(
        c.openStatus.state === "open" ? t("open") : c.openStatus.state === "closed" ? t("closed") : t("unknown"),
        c.openStatus.start != null && c.openStatus.end != null &&
          t("todayHours", { start: formatClinicTime(c.openStatus.start), end: formatClinicTime(c.openStatus.end) }),
      ),
    );
    if (data.basis === "weekday" && holiday && holiday.start != null && holiday.end != null) {
      sub.push(t("holidayHours", { start: formatClinicTime(holiday.start), end: formatClinicTime(holiday.end) }));
    }
    if (c.phone) sub.push(c.phone);
    sub.push(c.address);
    if (c.directions) sub.push(t("directions", { text: c.directions }));
    return {
      n: i + 1,
      placeRow: i,
      line: joinText(c.name, c.kind, t("distance", { distance: formatDistance(c.distanceMeters) })),
      sub,
      state: { open: c.openStatus.state },
    };
  });
}

export function clinicsHeading(at: string, t: Translator): string {
  return `${t("ready")} ${t("asOf", { time: at })}`;
}
```

`NightClinicsNearby.tsx`: `ClinicWithStatus`·`ClinicsData`·`formatTime`을 lib에서 import(중복 정의 삭제), `useNearbyFetch`에 `key: "clinics"`, `bridge: useContext(NearbyRegistryContext)`(Task 13이 컨텍스트를 만든다 — 이 태스크에서는 `bridge: undefined`로 두고 Task 13이 연결), `toSnapshot: (s) => s.kind === "done" ? { heading: clinicsHeading(s.at, t), message: live, items: clinicLines(s.data, t) } : { heading: "", message: live, items: [] }`. 렌더는 `const items = clinicLines(status.data, t)`를 한 번 만들어 `items.slice(0, visibleCount).map((item, i) => <li>…<h4>{item.line}</h4>{item.sub.map((s, j) => s === clinic.phone ? <p><a href={`tel:${s}`} …>{s}</a></p> : <p …>{s}</p>)}…</li>)`. `lang="ko"`·클래스는 기존 그대로 유지(대조 테스트는 `textContent`만 본다).

- [ ] **Step 4: 통과 확인** — 새 테스트 + `nearby-contract.tsx` 스위트 PASS.
- [ ] **Step 5: 커밋**

```bash
git add src/lib/nearby-lines
git commit -m "refactor(nearby): 소아 진료 줄 조립을 lib으로 추출 — 화면·도구 공용 + jsdom 대조" -- src/lib/nearby-lines src/components/NightClinicsNearby.tsx
```

---

### Task 9: 줄 조립 추출 — 지하철·버스·따릉이

**Files:**
- Create: `src/lib/nearby-lines/subway.ts`, `bus.ts`, `bike.ts`
- Modify: `src/components/SubwayArrivalsNearby.tsx`(line 40~), `BusArrivals.tsx`(line 89~120), `BikeStations.tsx`(line 70~)
- Test: `src/lib/nearby-lines/__tests__/subway.test.tsx`, `bus.test.tsx`, `bike.test.tsx`

**Interfaces:**
- Produces: `subwayLines(data, t, isEn): SectionItem[]`(`line` = 역명·노선·거리, `sub` = 방면별 도착 문장 배열, `state: { arrival: s.arrivalStatus }`), `subwayEmptyMessage(nearest, t, isEn)`(현 `emptyNearest` 분기), `busLines(data, t): SectionItem[]`(정류소당 `line`, `sub` = 노선별 도착), `bikeLines(data, t): SectionItem[]`(`line` 하나, `sub: []`). 각 함수의 본문은 해당 컴포넌트의 `joinText(...)` 표현식을 **글자 그대로** 옮긴 것이고 컴포넌트는 반환 배열로 렌더한다(Task 8 패턴).

- [ ] **Step 1: 실패 테스트** — Task 8 테스트를 복제하되 fixture·mock 데이터를 도메인에 맞춘다(지하철: `stations:[{stationName:"강동", nameEn:"Gangdong", lines:["5호선"], distanceMeters:300, arrivalStatus:"ok", arrivals:[{direction:"하남검단산 방면", message:"곧 도착"}]}]`; 버스: `stops:[{source:"seoul", cityCode:"", nodeId:"1", name:"길동사거리", distanceMeters:120, arrivals:[{source:"seoul", routeId:"r1", routeName:"3318", message:"2분 후"}]}]`; 따릉이: `stations:[{stationId:"ST-1", name:"길동역 1번 출구", distanceMeters:80, bikes:3}]`). 실제 필드명은 각 컴포넌트의 `useNearbyFetch<…>` 제네릭 타입(`src/lib/types.ts`)을 열어 맞춘다 — 타입이 틀리면 `tsc`가 잡는다. 단언은 Task 8과 같다: `h4.textContent === item.line`, `li` 안 `p`/`li` 텍스트 배열 `=== item.sub`.
- [ ] **Step 2: 실패 확인** — 셋 다 FAIL.
- [ ] **Step 3: 구현** — 세 파일을 만들고 컴포넌트를 배열 렌더로 바꾼다. `useNearbyFetch`에 `key: "subway" | "bus" | "bike"`·`toSnapshot`을 넣는다. `BusArrivals`·`BikeStations`는 `mode="place"`도 같은 함수(앵커만 다르다).
- [ ] **Step 4: 통과 확인** — 새 3 + `nearby-contract.tsx` PASS.
- [ ] **Step 5: 커밋**

```bash
git add src/lib/nearby-lines/subway.ts src/lib/nearby-lines/bus.ts src/lib/nearby-lines/bike.ts src/lib/nearby-lines/__tests__
git commit -m "refactor(nearby): 지하철·버스·따릉이 줄 조립 lib 추출 + 대조 테스트" -- src/lib/nearby-lines src/components/SubwayArrivalsNearby.tsx src/components/BusArrivals.tsx src/components/BikeStations.tsx
```

---

### Task 10: 줄 조립 추출 — 아이 놀 곳·문화행사·무장애·둘러보기

**Files:**
- Create: `src/lib/nearby-lines/kids.ts`, `events.ts`, `barrier-free.ts`, `surroundings.ts`
- Modify: `src/components/KidsPlacesNearby.tsx`(line 67~95), `CultureEventsNearby.tsx`(line 61~92), `BarrierFreeNearby.tsx`(line 137~189), `AroundNearby.tsx`(line 143~212)
- Test: 각 `__tests__/<name>.test.tsx`

**Interfaces:**
- Produces: `kidsLines(data, t)`, `eventLines(data, t)`, `barrierFreeLines(data, t)`(항목 `sub`에 편의시설 줄, 상세 펼침은 화면 전용이라 `sub`엔 펼친 상태와 무관하게 요약 줄만), `surroundingsAxes(data, t…): { overview: {status, lines}, scene: {status, lines}, places: {status, lines} }` + `surroundingsPlaceItems(data, t): SectionItem[]`(장소 목록만 `items`, `placeRow` 부여). 넷 다 `placeRow`를 준다(장소형 — `open_place` 가능).
- 둘러보기는 축형이라 `toSnapshot`이 `axes`와 `items`를 함께 낸다.

- [ ] **Step 1~5**: Task 9와 같은 순서(테스트 → 실패 → 추출 → 통과 → 커밋). 커밋 메시지 `refactor(nearby): 아이·행사·무장애·둘러보기 줄 조립 lib 추출`.

---

### Task 11: 줄 조립 추출 — 보행 인프라·날씨/공기질/혼잡도(축형) + `LocalConditions` 브릿지

**Files:**
- Create: `src/lib/nearby-lines/walk-infra.ts`, `src/lib/nearby-lines/conditions.ts`
- Modify: `src/components/WalkInfraNearby.tsx`(line 73·120~225), `src/components/LocalConditions.tsx`
- Test: `__tests__/walk-infra.test.tsx`, `__tests__/conditions.test.tsx`

**Interfaces:**
- Produces: `walkInfraItems(walk, t, tDir): SectionItem[]`(항목 3개 = 그룹, `line` = 그룹 h4 문장, `sub` = 점 목록 줄), `walkInfraMessage(walk, t)`(현 line 73 합성). `conditionsAxes(weather, air, congestion, t…): Record<"weather"|"air"|"congestion", {status: AxisStatus, lines: string[]}>` — 게이트 없음 `notConfigured`, null 응답 `empty`, fetch 실패 `error`, 등급 미제공 `unknown`.
- `LocalConditions`는 `useNearbyFetch`를 쓰지 않으므로 `useSectionBridge(registry, "conditions", { read, startLoad, expand: () => {} }, [weather, air, congestion])`로 attach한다. `startLoad`는 세 fetch를 다시 돌리는 내부 함수 `reload()`를 부르고 attempt 카운터(`useRef(0)`)를 증가시켜 돌려준다. 세 상태가 모두 정착(각각 done/null/error)한 커밋에서 settle.

- [ ] **Step 1~5**: 같은 순서. 커밋 `refactor(nearby): 보행 인프라·날씨 축형 줄 조립 + LocalConditions 브릿지`.

---

### Task 12: 섹션 도구 조립 `sectionTool` + 허브 10개 등록

**Files:**
- Create: `src/lib/webmcp/tools/section-tool.ts`, `src/lib/webmcp/tools/section-schemas.ts`
- Modify: `src/lib/webmcp/manifest.ts`(10 항목 + `VIEW_TOOLS.nearby`), `src/lib/webmcp/tools/context.ts`(`HubBridge`)
- Test: `src/lib/webmcp/__tests__/section-tool.test.ts`

**Interfaces:**
- Consumes: `SectionRegistry`(Task 7), `toolBudget`(Task 4), `encodeRef`(Task 2), `viewRegistry.currentEpoch()`.
- Produces: `HubBridge extends AppBridge { registry: SectionRegistry; origin: () => {origin, manualLabel?} }`. `SECTION_INPUT_SCHEMA`(`{refresh?: boolean}`), `SECTION_SHAPE`, `sectionTool(def: SectionToolDef, bridge: HubBridge | PlaceBridge): WebMcpTool` with `SectionToolDef { name; key: SectionKey; budget: BudgetKey; description; placeCapable: boolean; stationOnly?: boolean }`. `SECTION_TOOL_DEFS`(10개) 상수.

- [ ] **Step 1: 실패 테스트**

```ts
// src/lib/webmcp/__tests__/section-tool.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { createSectionRegistry } from "../section-registry";
import { sectionTool, SECTION_TOOL_DEFS } from "../tools/section-tool";
import { toolBudget } from "../tool-budget";
import { viewRegistry } from "../view-registry";

const def = SECTION_TOOL_DEFS.find((d) => d.key === "clinics")!;
const snap = (kind: "idle" | "done" | "loading", attempt: number, items = [{ n: 1, line: "A", sub: ["x"], placeRow: 0, state: { open: "open" } }]) => ({
  status: { kind } as const, attempt, resultAttempt: kind === "done" ? attempt : null,
  heading: "h", message: "m", origin: "gps" as const, at: "10:00", items: kind === "done" ? items : [],
});

describe("section tool", () => {
  beforeEach(() => { toolBudget.__reset(); viewRegistry.__reset(); });
  it("notConfigured when gate is off, never touching the budget", async () => {
    const reg = createSectionRegistry(["clinics"], { clinics: false });
    const tool = sectionTool(def, { view: "nearby", gates: () => ({ clinics: false }), registry: reg, origin: () => ({ origin: "gps" }) });
    expect(JSON.parse(await tool.execute({}, {}))).toMatchObject({ ok: false, reason: "notConfigured" });
  });
  it("returns the screen snapshot with structured status, refs bound to attempt, and marks the budget", async () => {
    const reg = createSectionRegistry(["clinics"], {});
    let cur = snap("idle", 0);
    reg.attach("clinics", { read: () => cur, startLoad: () => { cur = snap("loading", 1); queueMicrotask(() => { cur = snap("done", 1); reg.settle("clinics", 1); }); return 1; }, expand: () => {} });
    const tool = sectionTool(def, { view: "nearby", gates: () => ({}), registry: reg, origin: () => ({ origin: "gps" }) });
    const out = JSON.parse(await tool.execute({}, {}));
    expect(out).toMatchObject({ ok: true, section: "clinics", status: { kind: "done" }, heading: "h", message: "m", origin: "gps" });
    expect(out.items[0]).toMatchObject({ n: 1, line: "A", sub: ["x"], state: { open: "open" } });
    expect(out.items[0].ref).toMatch(/^0\.clinics\.1\.0$/);
    expect(toolBudget.check("clinics", Date.now())).toMatchObject({ ok: false });
  });
  it("empty/geoerror are ok:true with structured status; error is upstreamError", async () => {
    const reg = createSectionRegistry(["clinics"], {});
    let cur = { ...snap("idle", 0), status: { kind: "geoerror", reason: "denied" } as const, attempt: 2, resultAttempt: null };
    reg.attach("clinics", { read: () => cur, startLoad: () => 2, expand: () => {} });
    const tool = sectionTool(def, { view: "nearby", gates: () => ({}), registry: reg, origin: () => ({ origin: "gps" }) });
    const p = tool.execute({}, {});
    reg.settle("clinics", 2);
    expect(JSON.parse(await p)).toMatchObject({ ok: true, status: { kind: "geoerror", reason: "denied" } });
    cur = { ...cur, status: { kind: "error" }, attempt: 3 };
    toolBudget.__reset();
    const p2 = tool.execute({ refresh: true }, {});
    reg.settle("clinics", 3);
    expect(JSON.parse(await p2)).toMatchObject({ ok: false, reason: "upstreamError", status: { kind: "error" } });
  });
  it("busy → cooldown ordering", async () => {
    const reg = createSectionRegistry(["clinics"], {});
    reg.attach("clinics", { read: () => snap("loading", 1), startLoad: () => null, expand: () => {} });
    const tool = sectionTool(def, { view: "nearby", gates: () => ({}), registry: reg, origin: () => ({ origin: "gps" }) });
    expect(JSON.parse(await tool.execute({ refresh: true }, {}))).toMatchObject({ reason: "busy" });
    toolBudget.mark("clinics", Date.now());
    reg.attach("clinics", { read: () => snap("done", 1), startLoad: () => 2, expand: () => {} });
    expect(JSON.parse(await tool.execute({ refresh: true }, {}))).toMatchObject({ reason: "cooldown" });
  });
});
```

- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현**

```ts
// src/lib/webmcp/tools/section-schemas.ts
import { withFailure } from "../output";
export const SECTION_INPUT_SCHEMA = {
  type: "object",
  properties: { refresh: { type: "boolean", description: "Re-run the query even if results are already shown. Default false." } },
  additionalProperties: false,
} as const;
const STATUS = { kind: true, reason: true, detail: true };
export const SECTION_SHAPE = withFailure({
  ok: true, section: true, status: STATUS, refreshOutcome: STATUS, restoredPrevious: true,
  heading: true, message: true, origin: true, manualLabel: true, at: true,
  items: [{ n: true, ref: true, line: true, sub: [true], state: { open: true, arrival: true, basis: true, kind: true } }],
  axes: { weather: { status: true, lines: [true] }, air: { status: true, lines: [true] }, congestion: { status: true, lines: [true] }, overview: { status: true, lines: [true] }, scene: { status: true, lines: [true] }, places: { status: true, lines: [true] } },
});
```

```ts
// src/lib/webmcp/tools/section-tool.ts
import { finish } from "../output";
import { failure, type WebMcpTool } from "../types";
import { encodeRef } from "../place-refs";
import { toolBudget, type BudgetKey } from "../tool-budget";
import { viewRegistry } from "../view-registry";
import type { SectionKey } from "../section-types";
import { SECTION_INPUT_SCHEMA, SECTION_SHAPE } from "./section-schemas";
import type { HubBridge, PlaceBridge } from "./context";

export interface SectionToolDef {
  name: string;
  key: SectionKey;
  budget: BudgetKey;
  description: string;
  stationOnly?: boolean;
}

export const SECTION_TOOL_DEFS: readonly SectionToolDef[] = [
  { name: "get_nearby_surroundings", key: "surroundings", budget: "surroundings", description: "What surrounds the user's current location: a one-glance overview, the street scene at the entrance, and nearby places by category, exactly as the Nearby screen shows. Returns refs usable with open_place." },
  { name: "get_local_conditions", key: "conditions", budget: "weather", description: "Current weather, air quality grade and crowd level around the anchor of this screen (the user's location on Nearby, the place on Place detail). Axes report done/empty/unknown/error separately." },
  { name: "get_nearby_subway_arrivals", key: "subway", budget: "subwayArrival", description: "Subway stations near the user with live arrivals per direction, as the Nearby screen shows. Stations stay listed even outside service hours; each carries an arrival state (ok, unavailable, closed, unknown)." },
  { name: "get_nearby_bus_arrivals", key: "bus", budget: "busArrival", description: "Bus stops near the anchor of this screen with live arrival sentences per route, exactly as shown. Zero stops usually means outside the ~700 m radius, not no service." },
  { name: "get_nearby_bike_stations", key: "bike", budget: "bike", description: "Seoul public bike (Ttareungyi) stations near the anchor with available bikes. Seoul only; elsewhere returns status unavailableHere." },
  { name: "get_nearby_night_clinics", key: "clinics", budget: "clinics", description: "Pediatric night and holiday clinics near the user, open ones first, each with an open/closed/unknown state, today's hours, phone and address. Returns refs usable with open_place." },
  { name: "get_nearby_barrier_free_places", key: "barrierFree", budget: "barrierFree", description: "Barrier-free tourism places near the user (Korea Tourism Organization) with their accessibility facilities. Returns refs usable with open_place." },
  { name: "get_nearby_kids_places", key: "kids", budget: "kids", description: "Places for children near the user with indoor/outdoor state. Returns refs usable with open_place." },
  { name: "get_nearby_events", key: "events", budget: "events", description: "Cultural events in progress today within 3 km of the user (Seoul only; elsewhere status unavailableHere). Returns refs usable with open_place." },
  { name: "get_walk_infrastructure_nearby", key: "walkInfra", budget: "walkInfra", description: "Pedestrian infrastructure within about 150 m of the user: audible traffic signals, crosswalks and tactile paving with direction and distance. Registry data (Seoul, OpenStreetMap) that may differ from the street." },
];

export function sectionTool(def: SectionToolDef, bridge: HubBridge | PlaceBridge): WebMcpTool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: SECTION_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input, context) => {
      const refresh = input.refresh === true;
      if (def.stationOnly && bridge.isStation && !bridge.isStation()) return finish(failure("notApplicable"), SECTION_SHAPE);
      const entry = bridge.registry.entry(def.key);
      if (!entry.present || !entry.attached()) return finish(failure("notConfigured"), SECTION_SHAPE);
      const before = entry.read();
      const willFetch = refresh || before.status.kind !== "done";
      if (willFetch) {
        const now = Date.now();
        if (bridge.registry.entry(def.key).read().status.kind === "loading" || before.status.kind === "locating") {
          return finish(failure("busy"), SECTION_SHAPE);
        }
        const b = toolBudget.check(def.budget, now);
        if (!b.ok) return finish(failure("cooldown", { retryAfterMs: b.retryAfterMs }), SECTION_SHAPE);
        toolBudget.mark(def.budget, now);
      }
      const signal = context?.signal ?? new AbortController().signal;
      const outcome = await entry.runLoad({ force: refresh }, signal);
      if (outcome.kind !== "settled") {
        const reason = outcome.kind === "busy" ? "busy" : outcome.kind === "superseded" ? "superseded" : outcome.kind === "aborted" ? "aborted" : outcome.kind;
        return finish(failure(reason), SECTION_SHAPE);
      }
      const s = entry.read();
      const epoch = viewRegistry.currentEpoch();
      const items = s.items.map((it) => ({
        ...it,
        ref: it.placeRow === undefined ? undefined : encodeRef({ viewEpoch: epoch, source: def.key, attempt: s.resultAttempt ?? s.attempt, row: it.placeRow }),
        placeRow: undefined,
      }));
      const base = {
        section: def.key,
        status: s.status,
        refreshOutcome: outcome.restoredPrevious ? { kind: "error" } : undefined,
        restoredPrevious: outcome.restoredPrevious || undefined,
        heading: s.heading, message: s.message, origin: s.origin, manualLabel: s.manualLabel, at: s.at,
        items, axes: s.axes,
      };
      if (s.status.kind === "error") return finish({ ...failure("upstreamError"), ...base }, SECTION_SHAPE);
      return finish({ ok: true, ...base }, SECTION_SHAPE, { arrays: [{ path: "items", mode: "count" }] });
    },
  };
}
```

`context.ts`:

```ts
import type { SectionRegistry } from "../section-registry";
export interface HubBridge extends AppBridge {
  view: "nearby";
  registry: SectionRegistry;
  origin: () => { origin: "gps" | "manual"; manualLabel?: string };
}
export interface PlaceBridge extends AppBridge {
  view: "place";
  registry: SectionRegistry;
  isStation: () => boolean;
  place: () => { name: string; category: string; addressLines: string[]; phone: string | null };
  openDirections: (toText: string | null) => void;
}
```

`manifest.ts`: `SECTION_TOOL_DEFS`를 순회해 `TOOL_ENTRIES[def.name] = { description, gate: def.key, build: (b) => sectionTool(def, b) }`를 등록하고, `VIEW_TOOLS.nearby`에 10개 이름을 더한다(총 11 — 나머지 3은 Task 13). `get_walk_infrastructure_nearby`는 W1 항목을 **이 정의로 교체**하되 길찾기 화면에서는 W1 self-fetch 판이 서야 하므로 `build`가 `bridge.view === "directions"`면 W1 `getWalkInfrastructureNearbyTool()`을 돌려준다(입력 스키마·SHAPE는 Task 19에서 공통으로 맞춘다).

- [ ] **Step 4: 통과 확인** — 새 테스트 + `manifest.test.ts`(nearby 집합 기대값 갱신) PASS.
- [ ] **Step 5: 커밋**

```bash
git add src/lib/webmcp/tools/section-tool.ts src/lib/webmcp/tools/section-schemas.ts src/lib/webmcp/__tests__/section-tool.test.ts
git commit -m "feat(webmcp): 섹션 도구 공통 조립 + 허브 10개 정의(구조 상태·ref·버킷)" -- src/lib/webmcp
```

---

### Task 13: 허브 배선 — 레지스트리 컨텍스트·`read_current_view`·`focus_item`·`open_place`·착지 속성·아코디언 보존 이동

**Files:**
- Create: `src/components/NearbyRegistryContext.ts`, `src/lib/webmcp/tools/read-nearby-view.ts`, `src/lib/webmcp/tools/open-place.ts`
- Modify: `src/components/NearbyHub.tsx`, `src/components/NearbyPanelShell.tsx`(h3에 `data-focus-target={targetId.panel(key)}`; prop `panelKey` 추가), 섹션 10 컴포넌트(`<li>`에 `data-focus-target={targetId.item(key, n)}`·`tabIndex={-1}`), `src/lib/webmcp/tools/focus-item.ts`(브릿지 일반화), `src/lib/webmcp/tools/read-current-view.ts`(화면별 분기), `src/lib/webmcp/manifest.ts`, `src/hooks/useNearbyPanel.ts`(보존 이동)
- Test: `src/components/__tests__/HubWebMcp.test.tsx`

**Interfaces:**
- Produces: `NearbyRegistryContext = createContext<SectionRegistry | null>(null)`; `NearbyHub`가 `useMemo(() => createSectionRegistry(HUB_KEYS, gates), [])`로 만들어 Provider로 감싸고 `useWebMcpTools(() => buildToolsFor("nearby", hubBridge), { enabled: true, view: "nearby" })`. 각 섹션의 `useNearbyFetch({ bridge: useContext(NearbyRegistryContext) ?? undefined })`.
- `focus_item`의 브릿지 인자를 `FocusBridge { read?: () => { plan?: {planId} } ; ensureVisible?: (t) => void; refCheck?: (parsed, ref) => "ok" | ToolReason }`로 일반화: 결과 범위 대상은 `ref` 필수 → `decodeRef` → `checkRef(parts, { viewEpoch, source: parsed.source, attempt: entry.read().resultAttempt ?? attempt, rowCount })` → 실패 사유 그대로. 허브에서 `ensureVisible(panel item)`은 `registry.entry(key).expand()`.
- `read_current_view`(허브): `{ok, view:"nearby", origin, manualLabel, sections:[{key, present, status, itemCount, ref?}], activePanel, activeElementLabel, targets}` — `ref`는 그 섹션의 결과 세대 토큰(`row` 0, 에이전트가 `focus_item`에 넘길 세대 증거).
- `open_place({ref})`: `decodeRef` → 세대 검사 → 표에서 `Place` → `requestOpenPlace(place)` → `viewRegistry.waitReady("place", {timeoutMs: 2000, signal})` → `{ok, name, view:"place", toolsReady}`. 허브 섹션의 `Place` 조회는 `HubBridge.placeAt(key, row): Place | null`(각 장소형 섹션이 `toSnapshot`과 함께 `placeAt`을 attach — `SectionImpl`에 `placeAt?: (row) => Place | null` 추가).
- 아코디언 보존 이동: `useNearbyPanel`의 `onDismiss` 호출 전에 `if (panelRootRef.current?.contains(document.activeElement)) triggerRef.current?.focus()`. `useNearbyFetch`가 `panelRootRef`를 노출하고 `NearbyPanelShell`이 패널 `<div>`에 단다.

- [ ] **Step 1: 실패 테스트(jsdom, deferred Promise 경합)**

```tsx
// src/components/__tests__/HubWebMcp.test.tsx
// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi, beforeEach } from "vitest";
import ko from "@/../messages/ko.json";
import { viewRegistry } from "@/lib/webmcp/view-registry";
import { toolBudget } from "@/lib/webmcp/tool-budget";

const registered: Array<{ name: string; execute: (i: Record<string, unknown>, c: Record<string, unknown>) => Promise<string> | string }> = [];
Object.defineProperty(document, "modelContext", { value: { registerTool: async (t: (typeof registered)[number]) => { registered.push(t); } }, configurable: true });
vi.mock("@/lib/geolocation", () => ({ awaitGeolocation: async () => ({ status: "ready", coords: { lat: 37.53, lng: 127.13 } }), useGeolocation: () => ({ status: "ready", coords: { lat: 37.53, lng: 127.13 } }) }));
vi.mock("@/lib/effective-location", () => ({ awaitManualLocation: async () => null, useEffectiveLocation: () => null }));

function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => (resolve = r)); return { promise, resolve }; }

describe("Nearby hub WebMCP", () => {
  beforeEach(() => { registered.length = 0; viewRegistry.__reset(); toolBudget.__reset(); });

  it("registers 14 tools and get_nearby_night_clinics waits for the committed done state", async () => {
    const d = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("/api/clinic/nearby") ? d.promise : Promise.resolve(new Response("{}", { status: 200 }))));
    const { NearbyHub } = await import("@/components/NearbyHub");
    render(<NextIntlClientProvider locale="ko" messages={ko}><NearbyHub onBack={() => {}} canShowClinic canShowSubway={false} canShowBus={false} canShowBike={false} canShowAir={false} canShowBarrierFree={false} canShowKids={false} canShowEvents={false} canShowAround={false} /></NextIntlClientProvider>);
    await waitFor(() => expect(registered).toHaveLength(14));
    const tool = registered.find((t) => t.name === "get_nearby_night_clinics")!;
    const p = tool.execute({}, {});
    d.resolve(new Response(JSON.stringify({ clinics: [{ id: "c1", name: "우리소아과", kind: "소아청소년과", address: "주소", distanceMeters: 100, hours: {}, openStatus: { state: "open" } }], basis: "weekday" }), { status: 200 }));
    const out = JSON.parse(await p);
    expect(out).toMatchObject({ ok: true, section: "clinics", status: { kind: "done" } });
    expect(out.items[0].line).toContain("우리소아과");
    expect(document.querySelector('[data-focus-target="panel:clinics:item:1"]')).not.toBeNull();
    const events = registered.find((t) => t.name === "get_nearby_events")!;
    expect(JSON.parse(await events.execute({}, {}))).toMatchObject({ reason: "notConfigured" });
  });

  it("focus_item on a result item needs the ref; stale ref after refresh → staleResult; accordion keeps focus on the closing panel's trigger", async () => {
    // (위 렌더·조회를 반복한 뒤)
    const focus = registered.find((t) => t.name === "focus_item")!;
    expect(JSON.parse(await focus.execute({ target: "panel:clinics:item:1" }, {}))).toMatchObject({ reason: "staleResult" });
    // ref로는 착지
    // 새로고침 뒤 옛 ref → staleResult, 다른 패널 도구 호출 시 activeElement가 이전 패널 안이면 트리거로 이동
  });
});
```

(두 번째 케이스는 첫 케이스의 렌더를 helper로 뽑아 완성한다 — 단언: `document.activeElement`가 `<li data-focus-target="panel:clinics:item:1">`; 새로고침(`{refresh:true}`) 뒤 옛 `ref`로 `staleResult`; `activeElement`를 그 `<li>`에 둔 채 `get_nearby_kids_places`를 부르면 `activeElement`가 clinics 트리거 버튼.)

- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces대로. `read-current-view.ts`는 `bridge.view`로 분기해 홈·허브·상세 본문을 낸다(Task 14·18이 홈·상세 분기를 채운다). `manifest.ts`의 `read_current_view`·`focus_item`·`open_place` 항목은 `AppBridge` 계열 어느 브릿지든 받는다. `VIEW_TOOLS.nearby` = 14개.
- [ ] **Step 4: 통과 확인** — `HubWebMcp.test.tsx`·`nearby-contract.tsx`·`manifest.test.ts` PASS, `tsc`·`lint` PASS.
- [ ] **Step 5: 커밋**

```bash
git add src/components/NearbyRegistryContext.ts src/lib/webmcp/tools/read-nearby-view.ts src/lib/webmcp/tools/open-place.ts src/components/__tests__/HubWebMcp.test.tsx
git commit -m "feat(webmcp): 내 주변 허브 도구층 14개 — 레지스트리 컨텍스트·착지·open_place·아코디언 보존 이동" -- src/components src/lib/webmcp src/hooks
```

---

### Task 14: 홈 — `runSearch` 트랜잭션화 + `search_places` + 진입 도구 + 착지

**Files:**
- Modify: `src/components/PlaceSearch.tsx`(`runQuerySearch` → `runSearch(request, signal?)`, 대기자 슬롯, `HomeBridge` 확장, 결과 `<li>` 착지 속성, 검색 입력 `data-focus-target="field:query"`)
- Create: `src/lib/webmcp/tools/search-places.ts`, `src/lib/webmcp/tools/open-nearby.ts`
- Modify: `src/lib/webmcp/tools/context.ts`(`HomeBridge`), `src/lib/webmcp/tools/read-current-view.ts`(홈 분기), `src/lib/webmcp/manifest.ts`(`VIEW_TOOLS.home` 7개)
- Test: `src/components/__tests__/HomeWebMcp.test.tsx`

**Interfaces:**
- Produces: `HomeBridge extends AppBridge { view:"home"; isDirectionsOpen; openDirections(toText|null); openNearby(); runSearch(request: {query: string; sort: PlaceSort}, signal): Promise<SearchOutcome>; readSearch(): SearchSnapshot; placeAt(row): Place | null; addressAt(row): JusoAddress | null }`. `SearchOutcome = {kind:"settled"; attempt} | {kind:"busy"} | {kind:"superseded"} | {kind:"aborted"}`. `SearchSnapshot { attempt: number; query: string; sort; branches: Record<"places"|"addresses"|"web", "pending"|"done"|"empty"|"error"|"skipped">; places: Place[]; addresses: JusoAddress[]; web: WebSearchResult[] }`.
- `runSearch` 내부: `searchAttemptRef` 증가 → `performSearch`·`performAddressSearch`를 `sort` 인자로(현 `sortRef` 읽기를 인자로 대체, `toggleSort`도 `runSearch({query: lastQuery, sort: next})`를 부른다) → 분기 상태를 `branchesRef`에 기록 → 웹 폴백 조건 미충족이면 `web: "skipped"` → 세 분기 비-pending 커밋 뒤 effect에서 `settleSearchWaiter(attempt)`(W1 `settleAfterCommit` 동형).
- `search_places` 출력 SHAPE: `{ok, searchRef, query, sort, branches:{places,addresses,web}, places:[{ref,name,category,address,roadAddress,distance,phone,isStation}], addresses:[{ref,road,jibun,zip,english}], web:[{title,url,snippet}]}`; cap plan `[web, addresses, places]` 순 `count`. `web[].url`은 `new URL(u); url.search=""; url.hash=""`. `distance`는 `formatDistance(distanceMeters)` 문자열(없으면 키 부재).

- [ ] **Step 1: 실패 테스트** — jsdom, `fetch`를 deferred 3개(`/api/places`·`/api/address/search`·`/api/search/web`)로 스텁. 케이스: ①홈 등록 7개 ②`search_places({query:"강동역"})`가 장소·주소 모두 resolve된 **뒤** 돌아오고 `branches.web === "skipped"`, `places[0].ref`가 `^0\.search\.1\.0$` ③둘 다 0건이면 웹까지 기다려 `branches.web === "done"` ④진행 중 재호출 `busy` ⑤`open_place({ref})`가 `requestOpenPlace`를 부르고 상세 등록(`viewRegistry.markReady("place")`를 테스트가 흉내) 뒤 `toolsReady:true` ⑥옛 `ref` → `staleResult` ⑦`open_nearby` → `?panel=nearby`.
- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces. `search-places.ts`는 `toolBudget.check("search")` → `bridge.runSearch` → `readSearch()`로 조립. `open-nearby.ts`는 `bridge.openNearby()` 뒤 `viewRegistry.waitReady("nearby", {timeoutMs: 2000, signal})`.
- [ ] **Step 4: 통과 확인** — `HomeWebMcp.test.tsx`·기존 `PlaceSearch` 스위트·`manifest.test.ts`(home 7) PASS.
- [ ] **Step 5: 커밋**

```bash
git add src/lib/webmcp/tools/search-places.ts src/lib/webmcp/tools/open-nearby.ts src/components/__tests__/HomeWebMcp.test.tsx
git commit -m "feat(webmcp): 홈 도구층 7개 — runSearch 트랜잭션·search_places·open_nearby·착지" -- src/components/PlaceSearch.tsx src/lib/webmcp src/components/__tests__/HomeWebMcp.test.tsx
```

---

### Task 15: 장소 상세 — `PlaceBridge`·주변 4섹션 브릿지·`get_barrier_free_info`·`open_directions` 통일

**Files:**
- Modify: `src/components/PlaceDetail.tsx`(레지스트리 생성·Provider·`useWebMcpTools(view:"place")`·착지 속성 `heading:place`·`control:directions`·`control:chat`·섹션 h3 `section:{key}`), `src/components/BarrierFreeInfo.tsx`(`useSectionBridge` attach + 줄 조립 `src/lib/nearby-lines/barrier-free-info.ts`), `src/lib/webmcp/tools/open-directions.ts`(`{to?}` 통일, 홈·상세 공용)
- Create: `src/lib/webmcp/tools/get-barrier-free-info.ts`, `src/lib/nearby-lines/barrier-free-info.ts`
- Modify: `src/lib/webmcp/manifest.ts`(`VIEW_TOOLS.place` 채움 — 이 태스크 끝에 `describe_app`·`read_current_view`·`focus_item`·`open_directions`·`get_nearby_bus_arrivals`·`get_nearby_bike_stations`·`get_local_conditions`·`get_barrier_free_info` 8개; 역 3개는 Task 17)
- Test: `src/components/__tests__/PlaceWebMcp.test.tsx`(1차)

**Interfaces:**
- `PlaceSearch`가 `PlaceDetail`에 `onOpenDirectionsWithText?: (text: string) => void`를 추가로 넘긴다(기존 `openDirectionsWithText`). `PlaceBridge.openDirections(toText)`는 `toText === null ? onOpenDirections() : onOpenDirectionsWithText(toText)`.
- `open_directions` 도구는 이제 `HomeBridge | PlaceBridge`를 받고 `{to?: string}`; 설명: "Open the directions screen. On the home screen the destination is empty unless `to` is given; on a place screen the destination is the place shown unless `to` overrides it. Returns when the directions tools are registered."
- `get_barrier_free_info` 출력 `{ok, match: {kind:"matched", facilityCount} | {kind:"unmatched"}, facilities:[{label, value}], source}`; `canShowBarrierFree`가 거짓이면 `notConfigured`.

- [ ] **Step 1: 실패 테스트** — jsdom. 케이스: ①상세 등록 8개(역 아님) ②`get_nearby_bus_arrivals`가 `origin:"place"` ③`get_barrier_free_info` 매칭/미매칭 구조 ④`open_directions({})`가 `onOpenDirections`를 부르고 `open_directions({to:"x"})`가 `onOpenDirectionsWithText("x")` ⑤`get_station_timetable`은 아직 없음(Task 17에서 11개로).
- [ ] **Step 2~5**: 실패 확인 → 구현 → 통과(`PlaceDetail.test.tsx` 기존 스위트 포함) → 커밋 `feat(webmcp): 장소 상세 도구층 1차 — 브릿지·주변 3종 동명 도구·무장애·open_directions 통일`.

---

### Task 16: 장소 상세 — 역 도구 3종 + `data-section-trigger`

**Files:**
- Create: `src/lib/webmcp/tools/station-tools.ts`, `src/lib/nearby-lines/station.ts`
- Modify: `src/components/StationTimetable.tsx`·`StationFacilities.tsx`·`SeoulMetroFacilities.tsx`·`SeoulSubwayArrival.tsx`(`useSectionBridge` attach, 트리거 버튼에 `data-section-trigger="<key>"`, 줄 조립 lib 사용), `src/lib/webmcp/targets.ts`(`SECTION_TRIGGER_ATTR`·`sectionTriggerSelector`), `src/lib/webmcp/manifest.ts`(`VIEW_TOOLS.place` 11개)
- Test: `src/components/__tests__/PlaceWebMcp.test.tsx`(케이스 추가), `src/lib/nearby-lines/__tests__/station.test.tsx`

**Interfaces:**
- `get_station_timetable` → `{ok, lines:[{line, first, last, coverage}], basis}`; `get_station_facilities` → `{ok, korail:{status, groups:[{name, lines:[string]}]}, metro:{status, groups:[…], supplementFailed}}`; `get_station_arrivals` → `{ok, at, items:[{n, line, sub:[string], state:{kind}}]}`. 셋 다 `stationOnly: true`(비역 `notApplicable`), 키 게이트 없으면 축별 `notConfigured`(시설) / 도구 `notConfigured`(도착: `canShowSubway`).
- 버튼 트리거 도구는 `document.querySelector(sectionTriggerSelector(key))`를 `click()`하고(핸들러 복제 금지) `registry.entry(key).runLoad`로 정착을 기다린다. `useSectionBridge`의 `startLoad`는 그 컴포넌트의 fetch 함수를 직접 부르므로 클릭 대신 `startLoad`를 써도 같다 — **`startLoad`를 정본으로**(클릭은 포커스 이벤트를 만든다).

- [ ] **Step 1~5**: 테스트(역 장소 fixture `{name:"강동역", category:"교통,수송 > 지하철,전철"}`로 11개 등록, 비역이면 `notApplicable`, 시설 한 축 실패 시 그 축만 `error`) → 실패 → 구현 → 통과 → 커밋 `feat(webmcp): 역 도구 3종 — 첫차막차·시설 두 축·실시간 도착`.

---

### Task 17: 장소 상세 — `read_current_view`·`focus_item` 상세 분기 + 최종 등록 수 검증

**Files:**
- Modify: `src/lib/webmcp/tools/read-current-view.ts`(상세 분기: `{view:"place", name, category, addressLines, phone, isStation, sections:[{key, present, status}], chatAvailable, activeElementLabel, targets}`), `src/lib/webmcp/tools/focus-item.ts`(상세 대상 `heading:place`·`control:*`·`section:{key}`·`section:{key}:item:{n}`), 섹션 컴포넌트 4+4의 `<li>` 착지 속성
- Test: `PlaceWebMcp.test.tsx`(케이스 추가), `manifest.test.ts`(네 화면 equality 최종값 7·10·14·11)

- [ ] **Step 1~5**: 테스트 → 실패 → 구현 → 통과 → 커밋 `feat(webmcp): 장소 상세 read/focus + 화면별 집합 최종 고정(7·10·14·11)`.

---

### Task 18: W1-R — 도보 최단 대안·`read_current_view` 설명·보행 인프라 공통 계약

**Files:**
- Modify: `src/lib/webmcp/tools/context.ts`(`ToolPlan.walk.shortest?: {distanceMeters; durationSeconds; steps: string[]}`), `src/components/DirectionsView.tsx`(`buildToolPlan`에 `shortest` 투영 — `walkStepItems(shortest)` 같은 함수), `src/lib/webmcp/tools/plan-directions.ts`(`walk.shortest` 요약 3키), `src/lib/webmcp/tools/get-route-steps.ts`(`variant?: "recommended"|"shortest"` 입력, 기본 recommended), `src/lib/webmcp/targets.ts`(`walk:shortest:step:{n}` — `ParsedTarget step`에 `variant`), `src/components/WalkRouteBriefing.tsx`(최단 스텝 `<li>` 착지 속성), `src/lib/webmcp/tools/read-current-view.ts`(설명문 교체), `src/lib/webmcp/tools/get-walk-infrastructure-nearby.ts`(입력 `SECTION_INPUT_SCHEMA`, 출력을 `SECTION_SHAPE` 모양 — `items` 3그룹 + `origin:"gps"`, `walkInfraItems`(Task 11) 재사용)
- Test: `src/components/__tests__/DirectionsWebMcp.test.tsx`(최단 케이스), `src/lib/webmcp/__tests__/manifest.test.ts`(동명 도구 스키마·SHAPE byte 동일 — `get_walk_infrastructure_nearby` 길찾기 판 vs 허브 판, `open_directions` 홈 vs 상세, `read_current_view`·`focus_item`·`open_place` 화면 간)

- [ ] **Step 1: 실패 테스트**

```ts
it("same-named tools share inputSchema, SHAPE and reasons across views", () => {
  const pairs: Array<[string, ViewName, ViewName]> = [
    ["get_walk_infrastructure_nearby", "directions", "nearby"], ["open_directions", "home", "place"],
    ["read_current_view", "home", "place"], ["focus_item", "nearby", "place"], ["open_place", "home", "nearby"],
    ["get_nearby_bus_arrivals", "nearby", "place"], ["get_local_conditions", "nearby", "place"],
  ];
  for (const [name, a, b] of pairs) {
    const ta = buildToolsFor(a, fakeBridge(a)).find((t) => t.name === name)!;
    const tb = buildToolsFor(b, fakeBridge(b)).find((t) => t.name === name)!;
    expect(JSON.stringify(ta.inputSchema)).toBe(JSON.stringify(tb.inputSchema));
    expect(ta.description).toBe(tb.description);
    expect(JSON.stringify(SHAPES[name])).toBe(JSON.stringify(SHAPES[name])); // SHAPE는 manifest 항목이 하나뿐임을 export로 강제
  }
});
```

(`fakeBridge(view)`는 테스트 헬퍼 — 각 브릿지 인터페이스의 최소 스텁. `SHAPES`는 manifest가 항목별 `shape`를 export.)

- [ ] **Step 2~5**: 실패 → 구현 → 통과(`DirectionsWebMcp`·`route-step-items`·`output.test.ts` 포함) → 커밋 `feat(webmcp): W1-R — 도보 최단 대안 노출·read_current_view 설명·보행 인프라 공통 계약`.

---

### Task 19: 출력 스캔 강화 + 최소 폴백 상한

**Files:**
- Modify: `src/lib/webmcp/__tests__/output.test.ts`
- Modify(필요 시): `src/lib/webmcp/output.ts`(최소 폴백이 상한을 넘으면 `truncated:true` + 빈 배열로 강제)

- [ ] **Step 1: 실패 테스트**

```ts
it("no SHAPE in the manifest contains a coordinate key, and serialized samples contain no coordinate query or decimal pair", () => {
  const banned = /^(lat|lng|lon|latitude|longitude|coord|coords|geometry|pathCoords|x|y)$/;
  const walk = (s: Shape) => { if (s === true) return; if (Array.isArray(s)) return walk(s[0]); for (const k of Object.keys(s)) { expect(k).not.toMatch(banned); walk(s[k]); } };
  for (const e of Object.values(TOOL_ENTRIES)) walk(SHAPES_BY_NAME(e));
  for (const sample of SAMPLE_OUTPUTS) {
    expect(sample).not.toMatch(/[?&](lat|lng|x|y)=/i);
    expect(sample).not.toMatch(/\b3[3-8]\.\d{3,}\s*,\s*12[4-9]\.\d{3,}\b/);
  }
});
it("minimum fallback fits the limit even when every item is dropped", () => {
  const huge = { ok: true, section: "clinics", status: { kind: "done" }, heading: "h".repeat(1400), message: "", items: [{ n: 1, line: "x".repeat(200), sub: [] }] };
  const out = capOutput(serialize(huge, SECTION_SHAPE) as Record<string, unknown>, { arrays: [{ path: "items", mode: "count" }] });
  expect("reason" in out ? out.reason : "").toBe("unsupported"); // heading이 1,400자면 항목을 다 빼도 넘는다 — itemTooLarge로 정직 실패
});
```

`SAMPLE_OUTPUTS`는 각 화면 테스트가 남긴 실제 도구 출력 문자열 fixture(`src/lib/webmcp/__tests__/fixtures/outputs/*.json`) — Task 13·14·15·16이 각 한 건씩 저장한다(테스트 안에서 `JSON.parse(await tool.execute(...))` 결과를 파일과 대조).

- [ ] **Step 2~5**: 실패 → 구현 → 통과 → 커밋 `test(webmcp): 전 SHAPE 좌표 키 스캔·직렬화 좌표 패턴·최소 폴백 상한`.

---

### Task 20: 문서 분배 + privacy 문안 게이트 + 전체 게이트

**Files:**
- Modify: `CLAUDE.md` §WebMCP 도구층(도구 수 "10개" → 화면별 7·10·14·11, manifest 정본, `ref` 토큰, 코디네이터 `viewChanging`, 섹션 레지스트리·`runSectionLoad`, `nearby-lines` 공용 규칙, 버킷 예산 — **함정만**), `CHANGELOG.md`(2026-08-2x W2 항목 2~4줄 + spec 링크), `PROGRESS.md`(상태 한 줄), `docs/BACKLOG.md`(W2 게이트 ②·W1-R 종결, 실기기 ③ 대기), `docs/FIELD-TEST.md` §8(⑧~⑪ 대본은 이미 있음 — 실제 도구 이름·명령 예시 확정), `messages/{ko,en,es,fr,it,ja}.json` `privacy.agent`(위원장 확정 문안)
- Run: `npm run test:run`, `npm run lint`, `npx tsc --noEmit`, `npm run build`

- [ ] **Step 1: privacy 문안 왕복** — 현 ko 문장을 TextEdit으로 열어 위원장이 직접 고친다(제안 초안: "…길동무의 도구를 쓰면, 도구 출력(검색어와 검색 결과, 출발지·도착지·경유지 이름, 경로 요약과 안내 문장, 안내 상태, 내 주변 목록, 역 정보, 주변 보행 인프라)이 그 에이전트 제공자에게 전달됩니다. …"). 확정본을 6로케일에 반영(번역은 확정 ko 기준). `i18n-messages.test.ts` PASS.
- [ ] **Step 2: 문서 분배** — 위 파일 갱신. `python sync_agent_docs.py`(워크스페이스 루트)로 `AGENTS.md` 재생성.
- [ ] **Step 3: 전체 게이트** — 네 명령 전부 PASS. `packages/cli`·`packages/mcp`는 무변경(카탈로그 미수정).
- [ ] **Step 4: doc-audit** — `doc-audit` 스킬 1회.
- [ ] **Step 5: 커밋·push** — `git commit -- CLAUDE.md AGENTS.md CHANGELOG.md PROGRESS.md docs/BACKLOG.md docs/FIELD-TEST.md messages/*.json` 메시지 `docs(webmcp): W2 분배 — CLAUDE.md 함정·CHANGELOG·PROGRESS·BACKLOG·privacy 문안`. 리뷰(spec-compliance + code-quality 서브에이전트, 마일스톤 cross-cutting 1회) 통과 후 `git push origin main`(Vercel 자동 배포). 배포 뒤 실기기 게이트 ③은 위원장.

---

## Self-Review

**Spec coverage**: §2 표(홈 7·길찾기 10·허브 14·상세 11) → T6·T12·T13·T14·T15·T16·T17. §3.0 `ref`·사유 코드·구조 상태 → T1·T2·T12. §3.1 `describe_app` manifest 생성·런타임 게이트 → T6. §3.2 `runSearch` 분기 `skipped`·`searchFailed`·URL query 제거 → T14. §3.3 `open_place` 준비 확인 → T13·T14. §3.4 `open_directions {to?}` 통일 → T15. §3.5 섹션 도구·busy→cooldown 순서·`restoredPrevious`·축형 → T7·T11·T12. §3.6 역 3종 축별 게이트 → T16. §3.7 무장애 `match` 구조 → T15. §3.8·§3.9 → T13·T14·T17. §4 착지 문법 → T5. §5.1 안정 키 → T7. §5.2 레지스트리 전 키 엔트리 → T7. §5.3 코디네이터 → T3. §5.4 manifest equality·동명 byte 동일 → T6·T18. §5.5 버킷 → T4. §6 보존 이동·refresh 선점(T13 — `refresh` 선점은 `sectionTool`이 `runLoad` 전 `entry.read()`의 패널 루트에 `activeElement`가 있으면 헤딩으로 옮기는 한 줄: `SectionImpl.expand`와 같은 자리에 `preserveFocus()` 추가 — T13 구현 시 포함). §7 스캔·privacy → T19·T20. §8.2 테스트 목록 전부 대응. W1-R 3건 → T18.

**Placeholder scan**: T9·T10·T11·T15·T16·T17의 "Step 1~5 같은 순서"는 T8의 전체 코드 패턴을 가리키며 각 태스크의 Interfaces 블록이 함수명·시그니처·항목 모양·어느 컴포넌트의 어느 라인을 옮기는지까지 적었다. T6의 `description: "…"`는 각 파일 `DESCRIPTION` 상수 규칙을 명시했다.

**Type consistency**: `SectionSnapshot.items[].placeRow` ↔ `sectionTool`의 `encodeRef(row)`; `SectionOutcome.kind` ↔ `sectionTool` 사유 매핑; `viewRegistry.waitReady(view, {timeoutMs, signal})` ↔ `open_place`/`open_nearby`/`open_directions`; `toolBudget.check/mark(BudgetKey, now)` ↔ `SectionToolDef.budget`; `useWebMcpTools(build, {enabled, view})` ↔ 네 화면 호출.

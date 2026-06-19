# 채팅 인터페이스 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 길동무에 Gemini function-calling 채팅 모드를 추가해, 기존 외부 서비스 provider 14종을 자연어로 호출하고 결과를 기존 리치 컴포넌트로 렌더한다.

**Architecture:** dodo-planet의 `executeFunction` 라우터 패턴을 이식한다. 채팅 엔진(`src/lib/chat`, `src/lib/gemini`)은 React 비의존으로, 기존 provider 진입점을 호출하는 얇은 디스패치 레이어다. dodo 대비 유일한 확장은 도구 반환을 `{ summary, render? }`로 — summary는 Gemini 산문용, render는 클라가 기존 컴포넌트로 그릴 structured 데이터. 검색이 기본 모드이고 채팅은 토글/단축키로 전환한다.

**Tech Stack:** Next.js 16(App Router), React 19, TypeScript, `@google/genai`(Gemini), next-intl 5, Vitest 4(node env), zod 4.

## Global Constraints

- Next.js 16: 요청 API 비동기(`await params`/`await cookies()`), `proxy.ts`(middleware 아님). 코드 작성 전 `node_modules/next/dist/docs/` 확인.
- `src/lib/chat`·`src/lib/gemini`는 **React/Next 비의존** 유지(dodo 이식성). UI 의존은 `src/components/chat`·`src/hooks`에만.
- 외부 데이터 언어 분기는 **절대 `locale` 원시값 직접 사용 금지** → `dataLocale(locale)`/`prefersEnglish(locale)` 경유.
- UI 라벨에 **이모지 금지**. lucide-react 아이콘은 `aria-hidden`.
- 접근성: 키보드 도달 + `:focus-visible`, 터치 타깃 `min-h-11`(44px), 버튼 비활성화는 `disabled` 대신 `aria-disabled`+핸들러 가드, 비동기 트리거는 in-flight ref 가드. 단축키 안내는 `aria-keyshortcuts` 금지 → `aria-label`에 합침.
- live region은 **단일 polite 채널**, 과잉 ARIA(landmark/region/role 중복) 금지(First Rule of ARIA).
- 키 게이트 패턴: `env.ts`에 optional 키 + `hasXxxKey()` 헬퍼. 키 없으면 기능 미노출·회귀 0.
- 테스트: 기능·버그픽스는 같은 커밋에 테스트 동반. node-env Vitest(`npm run test:run`)가 매 커밋 게이트. Gemini 실호출은 게이트 밖(주기 eval).
- 커밋 이메일 `engccer@gmail.com`. 커밋 메시지·주석·문서 한국어, 변수/함수명 영어. **명시 파일만 stage**(working tree에 병렬 변경 공존 — `git add -A` 금지).
- 커밋 푸터:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VuZawesgavyGicEpf5rt1o
  ```
- spec: `docs/superpowers/specs/2026-06-20-chat-interface-design.md`.

---

## 파일 구조

**신규(React 비의존 엔진):**
- `src/lib/gemini/client.ts` — Gemini 클라이언트(모델·키 래퍼)
- `src/lib/chat/types.ts` — `ExecutionContext`·`RenderPayload`·`ChatMessage`·`ToolResult`
- `src/lib/chat/declarations.ts` — function declarations + 게이트 필터
- `src/lib/chat/render.ts` — provider 결과 → `RenderPayload` 매핑 헬퍼(도구별)
- `src/lib/chat/router.ts` — `executeFunction` 디스패치
- `src/lib/chat/keyboard-shortcuts.ts` — 단축키 매칭(dodo 이식 + 모드 액션)
- `src/lib/chat/mode-state.ts` — 모드 상태 순수 로직(URL/localStorage)

**신규(UI):**
- `src/app/api/chat/route.ts` — 채팅 엔드포인트(2-pass function 실행)
- `src/hooks/useChat.ts` — 메시지 상태·sendMessage
- `src/components/chat/ChatInterface.tsx` — 채팅 화면 컨테이너 + live region
- `src/components/chat/ChatInput.tsx` — 입력창 + 마이크(기존 VoiceRecordButton)
- `src/components/chat/MessageBubble.tsx` — 메시지 1건(산문 + render 디스패치)
- `src/components/ModeToggle.tsx` — 검색⇄채팅 토글 버튼

**수정:**
- `src/lib/env.ts` — `GEMINI_API_KEY` + `hasGeminiKey()`
- `src/components/PlaceSearch.tsx`(또는 홈 컨테이너) — 모드 분기·토글·전역 단축키 리스너
- `messages/*.json`(5개) — 채팅 i18n 키
- `.env.local.example`(있으면) — `GEMINI_API_KEY` 주석

---

## Phase 0: 인프라 게이트

### Task 1: Gemini 키 게이트

**Files:**
- Modify: `src/lib/env.ts`
- Test: `src/lib/__tests__/env-gemini.test.ts`

**Interfaces:**
- Produces: `hasGeminiKey(): boolean` — `GEMINI_API_KEY` 존재 여부.

- [ ] **Step 1: 기존 게이트 패턴 확인**

Read: `src/lib/env.ts` 하단의 `hasKakaoKey`/`hasDataGoKrKey` 등 `hasXxxKey` 정의 위치와 형태.

- [ ] **Step 2: 실패 테스트 작성**

```ts
// src/lib/__tests__/env-gemini.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";

describe("hasGeminiKey", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("키가 있으면 true", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const { hasGeminiKey } = await import("../env");
    expect(hasGeminiKey()).toBe(true);
  });

  it("키가 없으면 false", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const { hasGeminiKey } = await import("../env");
    expect(hasGeminiKey()).toBe(false);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm run test:run -- env-gemini`
Expected: FAIL ("hasGeminiKey is not a function" 또는 import 실패)

- [ ] **Step 4: 구현**

`envSchema`에 추가:
```ts
  // Google Gemini — 채팅 function-calling 엔진(서버 전용). 유료 API.
  GEMINI_API_KEY: z.string().min(1).optional(),
```
`env.parse({...})` 객체에 `GEMINI_API_KEY: process.env.GEMINI_API_KEY,` 추가.
기존 `hasXxxKey` 들과 같은 위치에:
```ts
export function hasGeminiKey(): boolean {
  return !!env.GEMINI_API_KEY;
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm run test:run -- env-gemini`
Expected: PASS (2 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/env.ts src/lib/__tests__/env-gemini.test.ts
git commit -m "feat(chat): GEMINI_API_KEY 게이트 추가"
```

---

### Task 2: chat 타입 정의

**Files:**
- Create: `src/lib/chat/types.ts`
- Test: (타입 전용, 별도 런타임 테스트 없음 — Task 4에서 사용처 테스트로 검증)

**Interfaces:**
- Produces:
  - `ExecutionContext { userLocation?: {lat:number;lng:number}; locale: string; dataLocale: "ko"|"en" }`
  - `ToolResult { summary: string; render?: RenderPayload }`
  - `RenderPayload`(discriminated union, `type` 필드)
  - `ChatMessage { id: string; role: "user"|"assistant"; text: string; render?: RenderPayload; error?: string }`

- [ ] **Step 1: 기존 provider 반환 타입 확인**

Read 헤더만(타입 import 경로 확인): `src/lib/types.ts`(`Place`), `src/lib/providers/juso-address.ts`(주소 결과), `seoul-subway-arrival.ts`/`subway-nearby.ts`(arrival), `tago-bus.ts`(`BusStop`), `seoul-bike.ts`(`BikeStation`), `air-quality.ts`(`AirQuality`), `night-clinic.ts`(`NightClinic`), `korail-facilities.ts`/`seoul-metro-facilities.ts`, `subway-stations.ts`(`StationMeta`), `surroundings.ts`, `kids-places.ts`, `odsay.ts`(`TransitRoute`), `kakao-navi.ts`/`ncp-directions.ts`(`CarRoute`).

- [ ] **Step 2: 타입 작성**

```ts
// src/lib/chat/types.ts — 채팅 엔진 공유 타입 (React/Next 비의존)
import type { Place } from "@/lib/types";
// ↓ 실제 export 이름은 Step 1에서 확인한 것으로 맞춘다.
import type { JusoAddress } from "@/lib/providers/juso-address";
import type { CarRoute } from "@/lib/providers/kakao-navi";
import type { TransitRoute } from "@/lib/providers/odsay";
import type { NearbyStationArrival } from "@/lib/providers/subway-nearby";
import type { BusStop } from "@/lib/providers/tago-bus";
import type { BikeStation } from "@/lib/providers/seoul-bike";
import type { AirQuality } from "@/lib/providers/air-quality";
import type { NightClinic } from "@/lib/providers/night-clinic";
import type { StationFacilities } from "@/lib/providers/korail-facilities";
import type { SeoulMetroFacilities } from "@/lib/providers/seoul-metro-facilities";
import type { StationMeta } from "@/lib/subway-stations";
import type { SurroundingPlace } from "@/lib/providers/surroundings";
import type { KidsPlace } from "@/lib/providers/kids-places";

export interface ExecutionContext {
  userLocation?: { lat: number; lng: number };
  locale: string;            // UI 로케일 (ko|en|es|fr|it)
  dataLocale: "ko" | "en";   // 외부 데이터 언어 (dataLocale()로 파생)
}

export type RenderPayload =
  | { type: "places"; places: Place[] }
  | { type: "addresses"; results: JusoAddress[] }
  | { type: "car-route"; route: CarRoute }
  | { type: "transit-route"; route: TransitRoute | null }
  | { type: "subway-arrivals"; stations: NearbyStationArrival[] }
  | { type: "bus-arrivals"; stops: BusStop[] }
  | { type: "bike-stations"; stations: BikeStation[] }
  | { type: "air-quality"; air: AirQuality | null }
  | { type: "night-clinics"; clinics: NightClinic[] }
  | { type: "station-facilities"; korail?: StationFacilities; metro?: SeoulMetroFacilities }
  | { type: "station-meta"; meta: StationMeta | null }
  | { type: "surroundings"; places: SurroundingPlace[] }
  | { type: "kids-places"; places: KidsPlace[] };

export interface ToolResult {
  summary: string;
  render?: RenderPayload;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  render?: RenderPayload;
  error?: string;
}
```

> 주: import 경로/이름이 실제와 다르면 Step 1에서 확인한 실제 export로 교정한다. 일부 타입(`JusoAddress`·`SurroundingPlace` 등)이 미export면 해당 provider에서 `export`를 추가한다(같은 커밋).

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음(미export 타입은 provider에 export 추가로 해소).

- [ ] **Step 4: 커밋**

```bash
git add src/lib/chat/types.ts src/lib/providers/*.ts src/lib/subway-stations.ts
git commit -m "feat(chat): 채팅 엔진 공유 타입(ExecutionContext·RenderPayload·ToolResult)"
```

---

### Task 3: Gemini 클라이언트

**Files:**
- Create: `src/lib/gemini/client.ts`
- Test: `src/lib/gemini/__tests__/client.test.ts`

**Interfaces:**
- Consumes: `hasGeminiKey`, `env`(Task 1).
- Produces:
  - `getGeminiModel(): { ... }` — `@google/genai` 클라이언트 + 모델명 상수.
  - `GEMINI_MODEL: string` 상수(dodo와 동일 모델 계열).

- [ ] **Step 1: 패키지 설치 + dodo client 참조**

```bash
npm install @google/genai
```
Read: `~/Mac-Projects/dodo-planet/src/lib/gemini/client.ts` — 클라이언트 생성·모델명·function-calling 호출 형태를 패턴으로 참조(코드 복붙 아님, API 형태 확인).

- [ ] **Step 2: 실패 테스트 작성**

```ts
// src/lib/gemini/__tests__/client.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";

describe("gemini client", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("키 없으면 getGeminiClient가 null", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const { getGeminiClient } = await import("../client");
    expect(getGeminiClient()).toBeNull();
  });

  it("GEMINI_MODEL 상수가 정의됨", async () => {
    const { GEMINI_MODEL } = await import("../client");
    expect(typeof GEMINI_MODEL).toBe("string");
    expect(GEMINI_MODEL.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm run test:run -- gemini/client`
Expected: FAIL (모듈 없음)

- [ ] **Step 4: 구현**

```ts
// src/lib/gemini/client.ts — Gemini 클라이언트 래퍼 (React/Next 비의존)
import { GoogleGenAI } from "@google/genai";
import { env, hasGeminiKey } from "@/lib/env";

// dodo-planet과 동일 모델 계열(최신 안정 Gemini). 실제 값은 dodo client.ts 확인 후 일치.
export const GEMINI_MODEL = "gemini-2.5-flash";

let cached: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI | null {
  if (!hasGeminiKey()) return null;
  if (!cached) cached = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY! });
  return cached;
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm run test:run -- gemini/client`
Expected: PASS (2 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/gemini/client.ts src/lib/gemini/__tests__/client.test.ts package.json package-lock.json
git commit -m "feat(chat): Gemini 클라이언트 래퍼"
```

---

## Phase 1: 라우터 + 첫 도구 E2E (search_places)

### Task 4: render 매핑 헬퍼 (search_places)

**Files:**
- Create: `src/lib/chat/render.ts`
- Test: `src/lib/chat/__tests__/render.test.ts`

**Interfaces:**
- Consumes: `Place`, `RenderPayload`.
- Produces: `placesToRender(places: Place[]): RenderPayload`, `placesSummary(places: Place[], locale: string): string`.

> render.ts는 도구별 (a) provider 결과 → `RenderPayload` 투영 (b) Gemini용 `summary` 문자열 생성을 모은다. Task 4는 search_places만, Phase 3에서 도구별 함수를 같은 파일에 추가한다.

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/lib/chat/__tests__/render.test.ts
import { describe, it, expect } from "vitest";
import { placesToRender, placesSummary } from "../render";

const sample = [
  { id: "1", name: "길동 카페", category: "카페", address: "서울 강동구", lat: 37.5, lng: 127.1 },
  { id: "2", name: "길동 약국", category: "약국", address: "서울 강동구", lat: 37.5, lng: 127.1 },
] as any;

describe("placesToRender", () => {
  it("places RenderPayload로 투영", () => {
    expect(placesToRender(sample)).toEqual({ type: "places", places: sample });
  });
});

describe("placesSummary", () => {
  it("건수와 첫 항목명을 포함", () => {
    const s = placesSummary(sample, "ko");
    expect(s).toContain("2");
    expect(s).toContain("길동 카페");
  });
  it("빈 결과는 결과 없음 요약", () => {
    expect(placesSummary([], "ko")).toMatch(/없|0/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- chat/__tests__/render`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```ts
// src/lib/chat/render.ts — provider 결과 → RenderPayload + Gemini용 summary (React 비의존)
import type { Place } from "@/lib/types";
import type { RenderPayload } from "./types";

export function placesToRender(places: Place[]): RenderPayload {
  return { type: "places", places };
}

export function placesSummary(places: Place[], _locale: string): string {
  if (places.length === 0) return "조건에 맞는 장소를 찾지 못했습니다(0건).";
  const names = places.slice(0, 5).map((p) => p.name).join(", ");
  return `장소 ${places.length}건을 찾았습니다. 예: ${names}.`;
}
```

> `summary`는 Gemini가 사용자 언어로 산문화할 **사실 요약**이므로 한국어 고정이어도 무방(최종 응답 언어는 시스템 프롬프트가 `locale`로 지정). `Place`의 실제 필드명(`name`)은 Step 1 fixture와 실제 타입 확인 후 일치.

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- chat/__tests__/render`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/chat/render.ts src/lib/chat/__tests__/render.test.ts
git commit -m "feat(chat): render 매핑 헬퍼(search_places)"
```

---

### Task 5: declarations + 게이트 필터 (search_places)

**Files:**
- Create: `src/lib/chat/declarations.ts`
- Test: `src/lib/chat/__tests__/declarations.test.ts`

**Interfaces:**
- Consumes: `hasGeminiKey`·`hasKakaoKey`·`hasJusoKey`·`hasOdsayKey`·`hasSeoulSubwayRealtimeKey`·`hasDataGoKrKey`·`hasSeoulOpenDataKey`·`hasNcpMapsKeys`(env).
- Produces:
  - `ALL_DECLARATIONS: FunctionDeclaration[]` — 도구별 스키마(`name`·`description`·`parameters`).
  - `availableDeclarations(): FunctionDeclaration[]` — 게이트 통과 도구만.

> declarations는 도구마다 `{ name, description, parameters, gate }`로 정의하고, `availableDeclarations`가 `gate()`가 true인 것만 반환한다. Task 5는 search_places만, Phase 3에서 도구를 같은 배열에 추가한다.

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/lib/chat/__tests__/declarations.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";

describe("availableDeclarations", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("카카오 키 있으면 search_places 노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "k");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "search_places")).toBe(true);
  });

  it("카카오 키 없으면 search_places 미노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "search_places")).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- chat/__tests__/declarations`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```ts
// src/lib/chat/declarations.ts — Gemini function declarations + 게이트 (React 비의존)
import { Type, type FunctionDeclaration } from "@google/genai";
import { hasKakaoKey } from "@/lib/env";

interface GatedDeclaration {
  declaration: FunctionDeclaration;
  gate: () => boolean;
}

const DECLARATIONS: GatedDeclaration[] = [
  {
    gate: hasKakaoKey,
    declaration: {
      name: "search_places",
      description:
        "키워드로 장소(상호·POI)를 검색한다. 예: '길동 카페', '강남역 맛집'. " +
        "사용자가 특정 지명/상호를 찾을 때 사용. 현재 위치 기준 거리 정렬을 원하면 useCurrentLocation=true.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: { type: Type.STRING, description: "검색 키워드" },
          useCurrentLocation: { type: Type.BOOLEAN, description: "현재 위치 기준 거리 정렬 여부" },
        },
        required: ["query"],
      },
    },
  },
];

export const ALL_DECLARATIONS = DECLARATIONS.map((d) => d.declaration);

export function availableDeclarations(): FunctionDeclaration[] {
  return DECLARATIONS.filter((d) => d.gate()).map((d) => d.declaration);
}
```

> `Type`/`FunctionDeclaration` 실제 import 경로는 `@google/genai` 버전에 맞춰 확인(Task 3에서 설치한 버전). 다르면 교정.

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- chat/__tests__/declarations`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/chat/declarations.ts src/lib/chat/__tests__/declarations.test.ts
git commit -m "feat(chat): function declarations + 게이트 필터(search_places)"
```

---

### Task 6: router executeFunction (search_places)

**Files:**
- Create: `src/lib/chat/router.ts`
- Test: `src/lib/chat/__tests__/router.test.ts`

**Interfaces:**
- Consumes: `ExecutionContext`·`ToolResult`(types), `searchPlaces`/`searchPlacesMergedEn`(providers/places), `placesToRender`·`placesSummary`(render).
- Produces: `executeFunction(name: string, args: Record<string, unknown>, ctx: ExecutionContext): Promise<ToolResult>`.

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/lib/chat/__tests__/router.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/providers/places", () => ({
  searchPlaces: vi.fn(async () => [{ id: "1", name: "길동 카페", category: "카페", address: "강동구", lat: 37.5, lng: 127.1 }]),
  searchPlacesMergedEn: vi.fn(async () => [{ id: "1", name: "Gildong Cafe", category: "cafe", address: "Gangdong", lat: 37.5, lng: 127.1 }]),
}));

import { executeFunction } from "../router";

const ctx = { locale: "ko", dataLocale: "ko" as const };

describe("executeFunction search_places", () => {
  it("ko는 searchPlaces 호출 + places render + summary", async () => {
    const r = await executeFunction("search_places", { query: "카페" }, ctx);
    expect(r.render).toEqual({ type: "places", places: [expect.objectContaining({ name: "길동 카페" })] });
    expect(r.summary).toContain("길동 카페");
  });

  it("en(dataLocale) 은 searchPlacesMergedEn 호출", async () => {
    const r = await executeFunction("search_places", { query: "cafe" }, { locale: "en", dataLocale: "en" });
    expect((r.render as any).places[0].name).toBe("Gildong Cafe");
  });

  it("알 수 없는 도구는 throw", async () => {
    await expect(executeFunction("nope", {}, ctx)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- chat/__tests__/router`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```ts
// src/lib/chat/router.ts — Gemini function call → provider 디스패치 (React 비의존)
import type { ExecutionContext, ToolResult } from "./types";
import { searchPlaces, searchPlacesMergedEn } from "@/lib/providers/places";
import { placesToRender, placesSummary } from "./render";

export async function executeFunction(
  name: string,
  args: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<ToolResult> {
  switch (name) {
    case "search_places": {
      const query = String(args.query ?? "");
      const places =
        ctx.dataLocale === "en"
          ? await searchPlacesMergedEn(query)
          : await searchPlaces(query);
      return { summary: placesSummary(places, ctx.locale), render: placesToRender(places) };
    }
    default:
      throw new Error(`알 수 없는 도구: ${name}`);
  }
}
```

> `searchPlaces`/`searchPlacesMergedEn`의 실제 시그니처(인자 순서·옵션)는 `src/lib/providers/places.ts` 확인 후 일치(좌표 정렬 인자가 있으면 `args.useCurrentLocation`+`ctx.userLocation` 연결).

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- chat/__tests__/router`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/chat/router.ts src/lib/chat/__tests__/router.test.ts
git commit -m "feat(chat): executeFunction 라우터(search_places)"
```

---

### Task 7: /api/chat 엔드포인트

**Files:**
- Create: `src/app/api/chat/route.ts`
- Test: `src/app/api/chat/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `getGeminiClient`·`GEMINI_MODEL`, `availableDeclarations`, `executeFunction`, `dataLocale`.
- Produces: `POST` — body `{ messages: {role,text}[], userLocation?, locale }` → `{ text: string, render?: RenderPayload }` 또는 502.

> 2-pass function-calling: (1) Gemini에 메시지+declarations → functionCall 수신 (2) `executeFunction` 실행 → tool 응답(summary)을 Gemini에 되돌려 산문 응답 수신. `render`는 (2)의 ToolResult에서 추출해 응답에 첨부. function call이 없으면 Gemini 텍스트만 반환.

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/app/api/chat/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMessage = vi.fn();
vi.mock("@/lib/gemini/client", () => ({
  GEMINI_MODEL: "gemini-2.5-flash",
  getGeminiClient: vi.fn(() => ({ chats: { create: () => ({ sendMessage }) } })),
}));
vi.mock("@/lib/chat/declarations", () => ({ availableDeclarations: () => [{ name: "search_places" }] }));
vi.mock("@/lib/chat/router", () => ({
  executeFunction: vi.fn(async () => ({ summary: "장소 1건", render: { type: "places", places: [{ name: "길동 카페" }] } })),
}));

import { POST } from "../route";

function req(body: unknown) {
  return new Request("http://x/api/chat", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => { sendMessage.mockReset(); });

describe("POST /api/chat", () => {
  it("function call → execute → 산문 + render 반환", async () => {
    sendMessage
      .mockResolvedValueOnce({ functionCalls: [{ name: "search_places", args: { query: "카페" } }], text: "" })
      .mockResolvedValueOnce({ functionCalls: [], text: "길동 카페를 찾았어요." });
    const res = await POST(req({ messages: [{ role: "user", text: "길동 카페" }], locale: "ko" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.text).toContain("길동 카페");
    expect(json.render).toEqual({ type: "places", places: [{ name: "길동 카페" }] });
  });

  it("키 없으면 502", async () => {
    const { getGeminiClient } = await import("@/lib/gemini/client");
    (getGeminiClient as any).mockReturnValueOnce(null);
    const res = await POST(req({ messages: [{ role: "user", text: "x" }], locale: "ko" }));
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- api/chat`
Expected: FAIL (route 없음)

- [ ] **Step 3: 구현**

```ts
// src/app/api/chat/route.ts
import { NextResponse } from "next/server";
import { getGeminiClient, GEMINI_MODEL } from "@/lib/gemini/client";
import { availableDeclarations } from "@/lib/chat/declarations";
import { executeFunction } from "@/lib/chat/router";
import { dataLocale } from "@/lib/data-locale";
import type { ExecutionContext, RenderPayload } from "@/lib/chat/types";

export const dynamic = "force-dynamic";

interface ChatRequest {
  messages: { role: "user" | "assistant"; text: string }[];
  userLocation?: { lat: number; lng: number };
  locale?: string;
}

export async function POST(request: Request) {
  const client = getGeminiClient();
  if (!client) {
    return NextResponse.json({ error: "chat_unavailable" }, { status: 502 });
  }
  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const locale = body.locale ?? "ko";
  const ctx: ExecutionContext = { userLocation: body.userLocation, locale, dataLocale: dataLocale(locale) };

  try {
    const chat = client.chats.create({
      model: GEMINI_MODEL,
      config: {
        tools: [{ functionDeclarations: availableDeclarations() }],
        systemInstruction:
          `너는 한국 로컬 정보 도우미다. 사용자의 언어(${locale})로 간결히 답한다. ` +
          `도구 결과(summary)를 바탕으로만 사실을 말하고, 추측하지 않는다.`,
      },
      history: body.messages.slice(0, -1).map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.text }],
      })),
    });

    const last = body.messages[body.messages.length - 1]?.text ?? "";
    let resp = await chat.sendMessage({ message: last });
    let render: RenderPayload | undefined;

    const calls = resp.functionCalls ?? [];
    if (calls.length > 0) {
      const call = calls[0];
      const result = await executeFunction(call.name ?? "", call.args ?? {}, ctx);
      render = result.render;
      resp = await chat.sendMessage({
        message: [{ functionResponse: { name: call.name, response: { summary: result.summary } } }],
      });
    }

    return NextResponse.json({ text: resp.text ?? "", render });
  } catch (e) {
    console.error("[chat] Gemini 오류:", e);
    return NextResponse.json({ error: "chat_failed" }, { status: 502 });
  }
}
```

> `@google/genai`의 실제 호출 형태(`chats.create`/`sendMessage`/`functionCalls`/`functionResponse`)는 설치 버전과 dodo `api/chat/route.ts`를 대조해 정확히 맞춘다. 다르면 교정하되 2-pass 구조는 유지.

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- api/chat`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/chat/route.ts src/app/api/chat/__tests__/route.test.ts
git commit -m "feat(chat): /api/chat 2-pass function-calling 엔드포인트"
```

---

### Task 8: useChat 훅

**Files:**
- Create: `src/hooks/useChat.ts`
- Test: `src/hooks/__tests__/useChat.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`(types), `useGeolocation`(coordinates), `useLocale`(next-intl).
- Produces: `useChat()` → `{ messages, isLoading, error, sendMessage(text), dismissError() }`.

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/hooks/__tests__/useChat.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({ useLocale: () => "ko" }));
vi.mock("@/hooks/useGeolocation", () => ({ useGeolocation: () => ({ coordinates: null }) }));

import { useChat } from "../useChat";

beforeEach(() => {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ text: "길동 카페를 찾았어요.", render: { type: "places", places: [] } }), { status: 200 }),
  ) as any;
});

describe("useChat", () => {
  it("sendMessage가 user+assistant 메시지를 추가", async () => {
    const { result } = renderHook(() => useChat());
    await act(async () => { await result.current.sendMessage("길동 카페"); });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages[0]).toMatchObject({ role: "user", text: "길동 카페" });
    expect(result.current.messages[1]).toMatchObject({ role: "assistant", text: "길동 카페를 찾았어요." });
    expect(result.current.messages[1].render).toEqual({ type: "places", places: [] });
  });

  it("502면 error 설정", async () => {
    global.fetch = vi.fn(async () => new Response("{}", { status: 502 })) as any;
    const { result } = renderHook(() => useChat());
    await act(async () => { await result.current.sendMessage("x"); });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- useChat`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```ts
// src/hooks/useChat.ts
"use client";
import { useCallback, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { useGeolocation } from "@/hooks/useGeolocation";
import type { ChatMessage } from "@/lib/chat/types";

let counter = 0;
const nextId = () => `m${++counter}`;

export function useChat() {
  const locale = useLocale();
  const { coordinates } = useGeolocation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    const userMsg: ChatMessage = { id: nextId(), role: "user", text: trimmed };
    const history = [...messages, userMsg];
    setMessages(history);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, text: m.text })),
          userLocation: coordinates ? { lat: coordinates.lat, lng: coordinates.lng } : undefined,
          locale,
        }),
      });
      if (!res.ok) { setError("chat_failed"); return; }
      const data = await res.json();
      setMessages((prev) => [...prev, { id: nextId(), role: "assistant", text: data.text ?? "", render: data.render }]);
    } catch {
      setError("chat_failed");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [messages, coordinates, locale]);

  const dismissError = useCallback(() => setError(null), []);
  return { messages, isLoading, error, sendMessage, dismissError };
}
```

> `useGeolocation`의 실제 반환 필드명(`coordinates.lat`/`.lng` 또는 `.latitude`)은 `src/hooks/useGeolocation.ts` 확인 후 일치.

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- useChat`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/hooks/useChat.ts src/hooks/__tests__/useChat.test.ts
git commit -m "feat(chat): useChat 훅(메시지 상태·sendMessage)"
```

---

### Task 9: MessageBubble (render 디스패치 — places)

**Files:**
- Create: `src/components/chat/MessageBubble.tsx`
- Test: `src/components/chat/__tests__/MessageBubble.test.tsx`

**Interfaces:**
- Consumes: `ChatMessage`·`RenderPayload`, 기존 `ResultList`/`PlaceCard`(places 렌더).
- Produces: `<MessageBubble message={ChatMessage} />`.

- [ ] **Step 1: 기존 places 렌더 컴포넌트 확인**

Read: `src/components/ResultList.tsx`·`src/components/PlaceCard.tsx` props — places 배열을 어떤 prop으로 받는지, `openDetail` 콜백 필요 여부. 채팅에선 상세 진입을 V1 비목표로 두되, 카드 자체는 재사용.

- [ ] **Step 2: 실패 테스트 작성**

```tsx
// src/components/chat/__tests__/MessageBubble.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k, useLocale: () => "ko" }));

import { MessageBubble } from "../MessageBubble";

describe("MessageBubble", () => {
  it("사용자 메시지 텍스트 표시", () => {
    render(<MessageBubble message={{ id: "1", role: "user", text: "안녕" }} />);
    expect(screen.getByText("안녕")).toBeTruthy();
  });
  it("assistant 산문 표시", () => {
    render(<MessageBubble message={{ id: "2", role: "assistant", text: "찾았어요" }} />);
    expect(screen.getByText("찾았어요")).toBeTruthy();
  });
  it("places render면 장소명 노출", () => {
    render(<MessageBubble message={{ id: "3", role: "assistant", text: "결과", render: { type: "places", places: [{ id: "p1", name: "길동 카페", category: "카페", address: "강동구", lat: 37.5, lng: 127.1 }] as any } }} />);
    expect(screen.getByText(/길동 카페/)).toBeTruthy();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm run test:run -- MessageBubble`
Expected: FAIL (모듈 없음)

- [ ] **Step 4: 구현**

```tsx
// src/components/chat/MessageBubble.tsx
"use client";
import type { ChatMessage } from "@/lib/chat/types";
import { ResultList } from "@/components/ResultList";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "text-right" : "text-left"}>
      {message.text && <p className="whitespace-pre-wrap">{message.text}</p>}
      {message.render && <RenderBlock render={message.render} />}
    </div>
  );
}

function RenderBlock({ render }: { render: NonNullable<ChatMessage["render"]> }) {
  switch (render.type) {
    case "places":
      return <ResultList places={render.places} /* openDetail 비전달: V1 채팅은 상세 진입 비목표 */ />;
    default:
      return null; // Phase 3에서 도구별 case 추가
  }
}
```

> `ResultList`의 실제 props(필수 콜백 등)는 Step 1 확인 후 맞춘다. 상세 진입 콜백이 필수면 no-op 또는 채팅용 경량 리스트로 대체.

- [ ] **Step 5: 통과 확인**

Run: `npm run test:run -- MessageBubble`
Expected: PASS (3 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/components/chat/MessageBubble.tsx src/components/chat/__tests__/MessageBubble.test.tsx
git commit -m "feat(chat): MessageBubble + places render 디스패치"
```

---

### Task 10: ChatInput (입력 + 마이크 재사용)

**Files:**
- Create: `src/components/chat/ChatInput.tsx`
- Test: `src/components/chat/__tests__/ChatInput.test.tsx`

**Interfaces:**
- Consumes: 기존 `VoiceRecordButton`(받아쓰기 콜백).
- Produces: `<ChatInput onSend={(text)=>void} disabled={boolean} inputRef={Ref} />`.

- [ ] **Step 1: VoiceRecordButton props 확인**

Read: `src/components/VoiceRecordButton.tsx`(28행~) — 전사 결과 콜백 prop명(예: `onTranscribed`)·로딩/비활성 prop.

- [ ] **Step 2: 실패 테스트 작성**

```tsx
// src/components/chat/__tests__/ChatInput.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k, useLocale: () => "ko" }));
vi.mock("@/components/VoiceRecordButton", () => ({ VoiceRecordButton: () => <button>mic</button> }));

import { ChatInput } from "../ChatInput";

describe("ChatInput", () => {
  it("입력 후 전송하면 onSend 호출, 입력 비움", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} disabled={false} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "길동 카페" } });
    fireEvent.submit(input.closest("form")!);
    expect(onSend).toHaveBeenCalledWith("길동 카페");
    expect(input.value).toBe("");
  });
  it("빈 입력은 전송 안 함", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} disabled={false} />);
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    expect(onSend).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm run test:run -- ChatInput`
Expected: FAIL (모듈 없음)

- [ ] **Step 4: 구현**

```tsx
// src/components/chat/ChatInput.tsx
"use client";
import { useState, type Ref } from "react";
import { useTranslations } from "next-intl";
import { VoiceRecordButton } from "@/components/VoiceRecordButton";

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
  inputRef?: Ref<HTMLInputElement>;
}

export function ChatInput({ onSend, disabled, inputRef }: Props) {
  const t = useTranslations("chat");
  const [value, setValue] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={t("inputLabel")}
        className="flex-1 min-h-11 ..."
      />
      <VoiceRecordButton onTranscribed={(text: string) => onSend(text)} />
      <button type="submit" aria-disabled={disabled || !value.trim()} className="min-h-11 min-w-11 ...">
        {t("send")}
      </button>
    </form>
  );
}
```

> `VoiceRecordButton`의 전사 콜백 prop명은 Step 1 확인값으로 교정(`onTranscribed` 가정). 받아쓰기는 즉시 전송 또는 입력창 채움 중 — 위원장 기존 선호(즉시 검색)에 맞춰 즉시 전송.

- [ ] **Step 5: 통과 확인**

Run: `npm run test:run -- ChatInput`
Expected: PASS (2 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/components/chat/ChatInput.tsx src/components/chat/__tests__/ChatInput.test.tsx
git commit -m "feat(chat): ChatInput(입력 + 기존 VoiceRecordButton 재사용)"
```

---

### Task 11: ChatInterface 컨테이너 + live region

**Files:**
- Create: `src/components/chat/ChatInterface.tsx`
- Test: `src/components/chat/__tests__/ChatInterface.test.tsx`

**Interfaces:**
- Consumes: `useChat`, `MessageBubble`, `ChatInput`.
- Produces: `<ChatInterface inputRef={Ref} />`(전역 단축키가 inputRef로 포커스).

- [ ] **Step 1: 실패 테스트 작성**

```tsx
// src/components/chat/__tests__/ChatInterface.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k, useLocale: () => "ko" }));
vi.mock("@/hooks/useChat", () => ({
  useChat: () => ({
    messages: [{ id: "1", role: "assistant", text: "안녕하세요" }],
    isLoading: false, error: null, sendMessage: vi.fn(), dismissError: vi.fn(),
  }),
}));
vi.mock("@/components/chat/ChatInput", () => ({ ChatInput: () => <div data-testid="chat-input" /> }));

import { ChatInterface } from "../ChatInterface";

describe("ChatInterface", () => {
  it("메시지와 입력창을 렌더", () => {
    render(<ChatInterface />);
    expect(screen.getByText("안녕하세요")).toBeTruthy();
    expect(screen.getByTestId("chat-input")).toBeTruthy();
  });
  it("polite live region 존재", () => {
    const { container } = render(<ChatInterface />);
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- ChatInterface`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```tsx
// src/components/chat/ChatInterface.tsx
"use client";
import { useEffect, useRef, type Ref } from "react";
import { useTranslations } from "next-intl";
import { useChat } from "@/hooks/useChat";
import { MessageBubble } from "./MessageBubble";
import { ChatInput } from "./ChatInput";

export function ChatInterface({ inputRef }: { inputRef?: Ref<HTMLInputElement> }) {
  const t = useTranslations("chat");
  const { messages, isLoading, error, sendMessage } = useChat();
  const liveRef = useRef<HTMLDivElement>(null);

  // 새 assistant 산문만 polite 통지(카드 내용은 카드 시맨틱이 담당)
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  useEffect(() => {
    if (liveRef.current && lastAssistant) liveRef.current.textContent = lastAssistant.text;
  }, [lastAssistant?.id]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-4">
        {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
      </div>
      <div ref={liveRef} aria-live="polite" className="sr-only" />
      {error && <p role="alert">{t(`error.${error}`)}</p>}
      <ChatInput onSend={sendMessage} disabled={isLoading} inputRef={inputRef} />
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- ChatInterface`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋 + E2E 스모크(search_places)**

```bash
git add src/components/chat/ChatInterface.tsx src/components/chat/__tests__/ChatInterface.test.tsx
git commit -m "feat(chat): ChatInterface 컨테이너 + polite live region"
```

E2E 스모크(GEMINI_API_KEY 보유 dev 서버): `npm run dev` 후 채팅 화면에서 "길동 카페" → 산문 + 장소 카드 렌더 확인. 키 없으면 Phase 2 후 통합 시점에 검증.

---

## Phase 2: 모드 토글 + 키보드 단축키

### Task 12: 키보드 단축키 매칭

**Files:**
- Create: `src/lib/chat/keyboard-shortcuts.ts`
- Test: `src/lib/chat/__tests__/keyboard-shortcuts.test.ts`

**Interfaces:**
- Produces:
  - `ChatShortcutAction = "chat-mode" | "search-mode" | "focus-input" | "dictation"`
  - `matchChatShortcut(e): ChatShortcutAction | null`
  - `appendShortcutHint(label, shortcut?): string`
  - `CHAT_SHORTCUT_KEYS`(표기 상수)

- [ ] **Step 1: dodo 모듈 참조 + 실패 테스트 작성**

Read: `~/Mac-Projects/dodo-planet/src/lib/chat/keyboard-shortcuts.ts`(패턴 이식 — `event.code`·`ctrlKey`·`appendShortcutHint`).

```ts
// src/lib/chat/__tests__/keyboard-shortcuts.test.ts
import { describe, it, expect } from "vitest";
import { matchChatShortcut, appendShortcutHint } from "../keyboard-shortcuts";

const ev = (o: Partial<{code:string;ctrlKey:boolean;shiftKey:boolean;altKey:boolean;metaKey:boolean}>) =>
  ({ code: "", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o });

describe("matchChatShortcut", () => {
  it("Ctrl+Shift+C → chat-mode", () => {
    expect(matchChatShortcut(ev({ code: "KeyC", ctrlKey: true, shiftKey: true }))).toBe("chat-mode");
  });
  it("Ctrl+Shift+S → search-mode", () => {
    expect(matchChatShortcut(ev({ code: "KeyS", ctrlKey: true, shiftKey: true }))).toBe("search-mode");
  });
  it("Shift+Esc → focus-input", () => {
    expect(matchChatShortcut(ev({ code: "Escape", shiftKey: true }))).toBe("focus-input");
  });
  it("Ctrl+Shift+D → dictation", () => {
    expect(matchChatShortcut(ev({ code: "KeyD", ctrlKey: true, shiftKey: true }))).toBe("dictation");
  });
  it("Alt 섞이면 null", () => {
    expect(matchChatShortcut(ev({ code: "KeyC", ctrlKey: true, shiftKey: true, altKey: true }))).toBeNull();
  });
  it("수식 없는 c는 null(입력 충돌 회피)", () => {
    expect(matchChatShortcut(ev({ code: "KeyC" }))).toBeNull();
  });
});

describe("appendShortcutHint", () => {
  it("+를 공백으로 치환해 라벨에 합침", () => {
    expect(appendShortcutHint("채팅", "Control+Shift+C")).toBe("채팅, Control Shift C");
  });
  it("shortcut 없으면 라벨 그대로", () => {
    expect(appendShortcutHint("채팅")).toBe("채팅");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- keyboard-shortcuts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```ts
// src/lib/chat/keyboard-shortcuts.ts — 채팅/검색 모드 단축키 (dodo 패턴 이식, React 비의존)
export type ChatShortcutAction = "chat-mode" | "search-mode" | "focus-input" | "dictation";

export const CHAT_SHORTCUT_KEYS = {
  chatMode: "Control+Shift+C",
  searchMode: "Control+Shift+S",
  focusInput: "Shift+Escape",
  dictation: "Control+Shift+D",
} as const;

export function appendShortcutHint(label: string, shortcut?: string): string {
  if (!shortcut) return label;
  return `${label}, ${shortcut.replace(/\+/g, " ")}`;
}

interface ShortcutEventLike {
  code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean;
}

export function matchChatShortcut(e: ShortcutEventLike): ChatShortcutAction | null {
  if (e.code === "Escape" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) return "focus-input";
  if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
    switch (e.code) {
      case "KeyC": return "chat-mode";
      case "KeyS": return "search-mode";
      case "KeyD": return "dictation";
    }
  }
  return null;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- keyboard-shortcuts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/chat/keyboard-shortcuts.ts src/lib/chat/__tests__/keyboard-shortcuts.test.ts
git commit -m "feat(chat): 모드 전환 키보드 단축키(Ctrl+Shift+C/S, Shift+Esc)"
```

---

### Task 13: 모드 상태 순수 로직

**Files:**
- Create: `src/lib/chat/mode-state.ts`
- Test: `src/lib/chat/__tests__/mode-state.test.ts`

**Interfaces:**
- Produces:
  - `type AppMode = "search" | "chat"`
  - `parseModeFromUrl(search: string): AppMode | null` — `?mode=chat`만 chat, 그 외 null.
  - `modeToUrl(current: string, mode: AppMode): string` — `?mode` 갱신(검색 모드면 파라미터 제거, `?q=` 보존).
  - `STORAGE_KEY = "gildongmu:mode"`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/lib/chat/__tests__/mode-state.test.ts
import { describe, it, expect } from "vitest";
import { parseModeFromUrl, modeToUrl } from "../mode-state";

describe("parseModeFromUrl", () => {
  it("?mode=chat → chat", () => expect(parseModeFromUrl("?mode=chat")).toBe("chat"));
  it("?mode=search → search", () => expect(parseModeFromUrl("?mode=search")).toBe("search"));
  it("없으면 null", () => expect(parseModeFromUrl("?q=cafe")).toBeNull());
});

describe("modeToUrl", () => {
  it("chat 모드는 ?mode=chat 추가, q 보존", () => {
    expect(modeToUrl("?q=cafe", "chat")).toContain("mode=chat");
    expect(modeToUrl("?q=cafe", "chat")).toContain("q=cafe");
  });
  it("search 모드는 mode 파라미터 제거, q 보존", () => {
    const r = modeToUrl("?q=cafe&mode=chat", "search");
    expect(r).not.toContain("mode=");
    expect(r).toContain("q=cafe");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- mode-state`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```ts
// src/lib/chat/mode-state.ts — 검색/채팅 모드 상태 (React 비의존)
export type AppMode = "search" | "chat";
export const STORAGE_KEY = "gildongmu:mode";

export function parseModeFromUrl(search: string): AppMode | null {
  const p = new URLSearchParams(search);
  const m = p.get("mode");
  return m === "chat" ? "chat" : m === "search" ? "search" : null;
}

export function modeToUrl(currentSearch: string, mode: AppMode): string {
  const p = new URLSearchParams(currentSearch);
  if (mode === "chat") p.set("mode", "chat");
  else p.delete("mode");
  const s = p.toString();
  return s ? `?${s}` : "";
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- mode-state`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/chat/mode-state.ts src/lib/chat/__tests__/mode-state.test.ts
git commit -m "feat(chat): 모드 상태 순수 로직(URL ?mode 동기화)"
```

---

### Task 14: ModeToggle 버튼 + 홈 통합 + 전역 단축키

**Files:**
- Create: `src/components/ModeToggle.tsx`
- Modify: `src/components/PlaceSearch.tsx`(홈 컨테이너 — 모드 분기·토글·단축키 리스너)
- Test: `src/components/__tests__/ModeToggle.test.tsx`

**Interfaces:**
- Consumes: `AppMode`, `appendShortcutHint`·`CHAT_SHORTCUT_KEYS`.
- Produces: `<ModeToggle mode={AppMode} onChange={(m)=>void} />`.

- [ ] **Step 1: PlaceSearch 구조 확인**

Read: `src/components/PlaceSearch.tsx` — 검색창·결과 렌더 위치, 헤딩 구조, geolocation `requestLocation` 호출 위치(토글 버튼 배치점·모드 분기점·`canShowChat` 게이트 주입점 파악).

- [ ] **Step 2: 실패 테스트 작성(ModeToggle)**

```tsx
// src/components/__tests__/ModeToggle.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

import { ModeToggle } from "../ModeToggle";

describe("ModeToggle", () => {
  it("검색 모드면 '채팅으로' 전환 버튼", () => {
    const onChange = vi.fn();
    render(<ModeToggle mode="search" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalledWith("chat");
  });
  it("채팅 모드면 '검색으로' 전환 버튼", () => {
    const onChange = vi.fn();
    render(<ModeToggle mode="chat" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalledWith("search");
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm run test:run -- ModeToggle`
Expected: FAIL (모듈 없음)

- [ ] **Step 4: ModeToggle 구현**

```tsx
// src/components/ModeToggle.tsx
"use client";
import { useTranslations } from "next-intl";
import { MessageSquare, Search } from "lucide-react";
import type { AppMode } from "@/lib/chat/mode-state";
import { appendShortcutHint, CHAT_SHORTCUT_KEYS } from "@/lib/chat/keyboard-shortcuts";

export function ModeToggle({ mode, onChange }: { mode: AppMode; onChange: (m: AppMode) => void }) {
  const t = useTranslations("chat");
  const next: AppMode = mode === "search" ? "chat" : "search";
  const label = next === "chat" ? t("switchToChat") : t("switchToSearch");
  const hint = next === "chat" ? CHAT_SHORTCUT_KEYS.chatMode : CHAT_SHORTCUT_KEYS.searchMode;
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      aria-label={appendShortcutHint(label, hint)}
      className="inline-flex items-center gap-2 min-h-11 ..."
    >
      {next === "chat" ? <MessageSquare aria-hidden /> : <Search aria-hidden />}
      <span>{label}</span>
    </button>
  );
}
```

- [ ] **Step 5: 통과 확인(ModeToggle)**

Run: `npm run test:run -- ModeToggle`
Expected: PASS (2 tests)

- [ ] **Step 6: PlaceSearch 통합(모드 분기 + 전역 단축키)**

`PlaceSearch.tsx`에 추가(구조는 Step 1 확인에 맞춤):
- `canShowChat` prop(서버에서 `hasGeminiKey()` 주입) — false면 `ModeToggle`·`ChatInterface`·단축키 미등록(순수 검색 회귀 0).
- `const [mode, setMode] = useState<AppMode>(() => parseModeFromUrl(location.search) ?? (localStorage.getItem(STORAGE_KEY) as AppMode) ?? "search")` — 단 SSR 안전 위해 `useEffect`에서 초기화(서버 스냅샷 "search").
- `setMode` 시 `history.replaceState(null,"", modeToUrl(...))` + `localStorage.setItem`.
- 전역 `keydown` 리스너(`useEffect`): `matchChatShortcut(e)` → `chat-mode`/`search-mode`는 `setMode`, `focus-input`은 `e.preventDefault()` + 현재 모드 입력창 `inputRef.current?.focus()`. `searchInputRef`(검색)·`chatInputRef`(채팅)를 모드별로 전달.
- 렌더: `mode === "chat" && canShowChat ? <ChatInterface inputRef={chatInputRef} /> : <기존 검색 UI inputRef={searchInputRef} />`. 토글 버튼은 `canShowChat`일 때만 헤딩 영역에.
- 모드 전환 직후 새 화면 첫 요소 포커스(접근성): `chat`→채팅 입력창, `search`→검색창.

테스트(PlaceSearch 모드 분기) 추가:
```tsx
// src/components/__tests__/PlaceSearch-mode.test.tsx (요지)
// canShowChat=false면 토글 미렌더 / true면 토글 렌더 + 채팅 전환 시 ChatInterface 마운트
```
(기존 PlaceSearch 테스트 패턴에 맞춰 mock 구성. 최소 2 케이스: 게이트 off 미노출 / 토글 클릭 시 모드 전환.)

- [ ] **Step 7: 통과 확인 + 커밋**

Run: `npm run test:run -- "ModeToggle|PlaceSearch"`
Expected: PASS

```bash
git add src/components/ModeToggle.tsx src/components/PlaceSearch.tsx src/components/__tests__/ModeToggle.test.tsx src/components/__tests__/PlaceSearch-mode.test.tsx
git commit -m "feat(chat): 모드 토글 버튼 + 홈 통합 + 전역 단축키 리스너"
```

---

## Phase 3: 나머지 13개 도구

> **도구 추가 레시피**(각 도구 공통 — Task 4~6·9가 템플릿): ① `render.ts`에 `xToRender`+`xSummary` 추가 ② `declarations.ts` `DECLARATIONS` 배열에 `{gate, declaration}` 추가 ③ `router.ts` switch에 case 추가(기존 provider 호출 + 매핑) ④ `MessageBubble.tsx` `RenderBlock` switch에 case 추가(기존 컴포넌트 렌더) ⑤ 각 단계 테스트(declarations 게이트·router 매핑·render 투영). 좌표 필요 도구는 `ctx.userLocation` 사용, 없으면 declaration description에 "현재 위치 필요" 명시.

각 묶음 태스크는 **TDD 사이클**(실패 테스트 → 구현 → 통과 → 커밋)을 도구별로 반복한다. 아래 표가 도구별 구체값이다.

### Task 15: 주소 검색 도구 (search_address)

**도구값:**
- declaration: `name: "search_address"`, gate: `hasJusoKey`, params: `{ keyword: string }`. description: "도로명/지번 주소·우편번호를 검색한다. 상호가 아니라 '세종대로 110' 같은 주소를 찾을 때."
- provider: `searchJusoAddresses(keyword)` → `render.ts` `addressesToRender`/`addressesSummary`.
- RenderPayload: `{ type: "addresses", results }` → MessageBubble은 기존 `AddressResultList` 렌더.

- [ ] declarations 테스트(juso 키 게이트) → 추가 → 통과
- [ ] render 테스트(`addressesToRender`/`addressesSummary`) → 추가 → 통과
- [ ] router 테스트(`search_address` → `searchJusoAddresses` mock) → case 추가 → 통과
- [ ] MessageBubble 테스트(`addresses` render → AddressResultList) → case 추가 → 통과
- [ ] 커밋: `feat(chat): search_address 도구(juso 주소 검색)`

> `AddressResultList`의 props(en 영문 분기 `prefersEnglish`)는 기존 컴포넌트 확인 후 맞춤.

### Task 16: 길찾기 도구 (get_car_route, get_transit_route)

**도구값:**
- `get_car_route`: gate `hasKakaoKey`(en은 `hasNcpMapsKeys`), params `{ origin: string, destination: string }`. provider `getCarRouteBriefing`(ko)/`getCarRouteBriefingEn`(dataLocale==="en"). RenderPayload `{type:"car-route", route}` → `CarRouteBriefing`.
- `get_transit_route`: gate `hasOdsayKey`, params `{ originLat,originLng,destLat,destLng }` 또는 지명. provider `getTransitRoute`. RenderPayload `{type:"transit-route", route}`(null 가능) → `TransitRouteBriefing`.

- [ ] get_car_route: declarations/render/router/MessageBubble 테스트 → 구현 → 통과 → 커밋
- [ ] get_transit_route: 동일 사이클 → 커밋
- [ ] 커밋 메시지: `feat(chat): 길찾기 도구(자동차·대중교통)`

> 좌표 입력은 출발지 미지정 시 `ctx.userLocation`. 지명만 주어지면 router에서 `/api/geocode`(카카오) 경유 좌표 변환 — 기존 패턴 재사용. transit는 ODsay 프로덕션 미동작이라 게이트로 프로덕션 자동 비노출(개발만).

### Task 17: 대중교통 실시간 도구 (get_subway_arrivals, get_bus_arrivals, get_bus_route, get_bike_stations)

**도구값:**
- `get_subway_arrivals`: gate `hasSeoulSubwayRealtimeKey`, 좌표 기반. provider `fetchNearbySubwayArrivals(lat,lng)`(좌표→`findStationsNear`→역별 실시간). RenderPayload `{type:"subway-arrivals", stations}` → `SubwayArrivalsNearby`/`SubwayArrivalList`.
- `get_bus_arrivals`: gate `hasDataGoKrKey`, 좌표 기반. provider `fetchNearbyBusStops(lat,lng)`. RenderPayload `{type:"bus-arrivals", stops}` → `BusArrivals`.
- `get_bus_route`: gate `hasDataGoKrKey`, params `{ routeId, cityCode }`(또는 노선번호). provider `fetchBusRouteStops`. RenderPayload 재사용 또는 `BusRouteStops` 렌더.
- `get_bike_stations`: gate `hasSeoulOpenDataKey`, 좌표 기반. provider `fetchNearbyBikeStations(lat,lng)`. RenderPayload `{type:"bike-stations", stations}` → `BikeStations`.

- [ ] 도구 4종 각각 declarations/render/router/MessageBubble TDD 사이클
- [ ] 좌표 도구는 `ctx.userLocation` 없으면 summary에 "현재 위치가 필요합니다" → Gemini가 위치 요청 산문(render 없음). router 테스트에 위치 없음 케이스 포함.
- [ ] 커밋: `feat(chat): 대중교통 실시간 도구(지하철·버스·따릉이)`

### Task 18: 환경·건강 도구 (get_air_quality, get_night_clinics)

**도구값:**
- `get_air_quality`: gate `hasDataGoKrKey`, 좌표 기반. provider `findAirQualityNear(lat,lng)`. RenderPayload `{type:"air-quality", air}` → `AirQuality`.
- `get_night_clinics`: gate `hasDataGoKrKey`, 좌표 기반. provider `findNightClinicsNear(lat,lng)`. RenderPayload `{type:"night-clinics", clinics}` → `NightClinicsNearby`.

- [ ] 2종 각각 TDD 사이클(declarations/render/router/MessageBubble)
- [ ] 커밋: `feat(chat): 환경·건강 도구(공기질·소아진료)`

### Task 19: 역 정보 도구 (get_station_facilities, get_station_meta)

**도구값:**
- `get_station_facilities`: gate `hasDataGoKrKey`, params `{ stationName }`. provider `fetchStationFacilities`(코레일)+`fetchSeoulMetroFacilities`(서울) 병렬. RenderPayload `{type:"station-facilities", korail?, metro?}` → `StationFacilities`+`SeoulMetroFacilities`.
- `get_station_meta`: gate 없음(정적 seed). params `{ stationName }`. provider `findStationMeta`/`findStationsByName`. RenderPayload `{type:"station-meta", meta}` → `StationMeta`.

- [ ] 2종 각각 TDD 사이클
- [ ] 커밋: `feat(chat): 역 정보 도구(편의시설·역 메타)`

### Task 20: 주변 탐색 도구 (get_surroundings, get_kids_places)

**도구값:**
- `get_surroundings`: gate `hasKakaoKey`, 좌표 기반. provider `findSurroundingsNear(lat,lng)`. RenderPayload `{type:"surroundings", places}` → `SurroundingsNearby`.
- `get_kids_places`: gate `hasKakaoKey`, 좌표 기반. provider `findKidsPlacesNear(lat,lng)`. RenderPayload `{type:"kids-places", places}` → `KidsPlacesNearby`.

- [ ] 2종 각각 TDD 사이클
- [ ] 커밋: `feat(chat): 주변 탐색 도구(둘러보기·아이 놀 곳)`

> Phase 3 끝에서 `availableDeclarations`가 14개 도구 게이트를 모두 다루는지 통합 테스트 1개 추가(키 전부 stub → 14개 노출, 전부 빈 → 0개).

---

## Phase 4: i18n + 마감

### Task 21: 채팅 i18n 메시지

**Files:**
- Modify: `messages/ko.json`·`en.json`·`es.json`·`fr.json`·`it.json`
- Test: 기존 `src/lib/__tests__/i18n-messages.test.ts`(게이트) 통과

**Interfaces:**
- Produces: `chat.*` 키 — `switchToChat`·`switchToSearch`·`inputLabel`·`send`·`emptyHint`·`loading`·`error.chat_failed`·`error.chat_unavailable`.

- [ ] **Step 1: ko.json에 chat 블록 추가**

```json
"chat": {
  "switchToChat": "채팅으로",
  "switchToSearch": "검색으로",
  "inputLabel": "메시지 입력",
  "send": "보내기",
  "emptyHint": "무엇이든 물어보세요. 예: 길동 주변 약국",
  "loading": "답변 생성 중",
  "error": { "chat_failed": "답변을 가져오지 못했습니다.", "chat_unavailable": "채팅을 사용할 수 없습니다." }
}
```

- [ ] **Step 2: en/es/fr/it 동일 키 번역 추가**(값만 각 언어로).

- [ ] **Step 3: i18n 게이트 통과 확인**

Run: `npm run test:run -- i18n-messages`
Expected: PASS(ko 기준 키 집합·ICU·t.rich 태그 5개 언어 동일).

- [ ] **Step 4: 커밋**

```bash
git add messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json
git commit -m "feat(chat): 채팅 UI i18n 메시지(5개 언어)"
```

### Task 22: 접근성 마감 + 전체 게이트 + 실호출 스모크

**Files:**
- Modify: 필요 시 `ChatInterface`·`MessageBubble`·`ModeToggle`(a11y 보강)

- [ ] **Step 1: 전체 게이트 테스트**

Run: `npm run test:run`
Expected: 전부 PASS(신규 + 기존 회귀 0).

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공(타입·번들).

- [ ] **Step 3: a11y-auditor 점검**

`a11y-auditor` 서브에이전트로 `ChatInterface`·`MessageBubble`·`ModeToggle`·`ChatInput` 점검: 단일 polite live region, 모드 전환 포커스 이동, 단축키 aria-label 합침, 카드 중복 aria-label 없음(First Rule of ARIA), 터치 타깃 44px, `:focus-visible`. 지적사항 수정.

- [ ] **Step 4: 실호출 스모크(머지 게이트, GEMINI_API_KEY dev 서버)**

`npm run dev` 후 도구별 대표 문장 각 1개로 카드 렌더 확인(최소): "길동 카페"(places)·"세종대로 110 주소"(addresses)·"강남역 지하철 도착"(subway)·"여기 공기질"(air)·"내 주변 약국"(places/clinic). 키 미보유 도구(ODsay 등)는 게이트 미노출 확인. 키 없는 환경에선 채팅 토글 자체 미노출 확인.

- [ ] **Step 5: 커밋(보강 있으면)**

```bash
git add -p   # 명시 파일만
git commit -m "fix(chat): 접근성 마감(live region·포커스·단축키 안내)"
```

### Task 23: 문서 + 환경변수 + 배포 준비

**Files:**
- Modify: `CLAUDE.md`(채팅 아키텍처 항목 + API 키 표에 `GEMINI_API_KEY` 행), `docs/SPEC.md`(실험 백로그)
- Modify(있으면): `.env.local.example`

- [ ] **Step 1: CLAUDE.md 갱신** — 아키텍처 섹션에 채팅 엔진 항목(엔진·라우터·`{summary,render}` 확장·도구 카탈로그·게이트·dodo 호환), API 키 표에 `GEMINI_API_KEY` 행(상태·용도). `sync_agent_docs.py` 실행해 AGENTS.md 재생성.

- [ ] **Step 2: 커밋**

```bash
git add CLAUDE.md AGENTS.md docs/SPEC.md
git commit -m "docs(chat): 채팅 인터페이스 아키텍처·API 키 문서화"
```

- [ ] **Step 3: 프로덕션 배포(키 등록 — 하드 스톱: 비용)**

⚠ `GEMINI_API_KEY`는 **유료 API**라 프로덕션 등록 전 위원장 확인. 등록 시:
```bash
printf '%s' "$GEMINI_API_KEY" | vercel env add GEMINI_API_KEY production
git push origin main   # 자동 배포 (gildongmu 관례)
```
prod 실호출 스모크(`gildongmu.vercel.app`에서 채팅 1회) 확인.

---

## Self-Review (작성자 체크 결과)

**1. Spec 커버리지**: §1 성과→Task 22 스모크 / §3 아키텍처→Task 4~7 / §4 파일구조→전 Task / §5 계약→Task 2,4,6 / §6 도구14종→Task 6+15~20 / §7 UI→Task 9~11,14 / §8 단축키→Task 12,14 / §9 접근성→Task 11,22 / §10 음성→Task 10 / §11 i18n→Task 21 / §12 게이트→Task 1,14 / §13 테스트→전 Task / §14 dodo호환→Task 2,12 구조 / §15 범위밖→도구 게이트로 처리. **갭 없음**.

**2. Placeholder**: 도구별 코드는 "추가 레시피"(Task 4~6·9 템플릿) + 구체 도구값 표로 실값 제공 — 보일러플레이트 반복 대신 실제 provider명·gate·RenderPayload·컴포넌트를 명시했다. 미해결 표시 없음.

**3. 타입 일관성**: `executeFunction(name,args,ctx)`·`ToolResult{summary,render}`·`RenderPayload`(type 판별)·`ChatMessage`·`AppMode`·`ChatShortcutAction`이 전 Task에서 동일 시그니처로 사용됨. provider 함수명은 §6 검증값(`searchPlaces`·`findAirQualityNear` 등 실재 export) 사용.

**주의(구현 중 교정 지점)**: ① `@google/genai` 실제 API 형태(client·chats·functionCalls) — Task 3·7에서 설치 버전+dodo 대조 ② 기존 컴포넌트 실제 props(`ResultList`·`AddressResultList`·`VoiceRecordButton` 등) — 각 Task Step 1에서 확인 ③ provider 시그니처 인자 순서 — router case에서 확인. 모두 "확인 후 일치" 명시됨.

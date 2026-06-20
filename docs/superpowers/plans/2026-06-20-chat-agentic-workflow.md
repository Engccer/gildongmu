# 길동무 채팅 에이전틱 워크플로우 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채팅을 2-pass 단발 호출에서 multi-turn 에이전트 루프로 전환한다 — 도구가 실데이터를 LLM에 반환하고, Gemini가 연쇄 호출·종합해 산문 답변을 만들며, NDJSON 스트리밍으로 진행을 통지하고, 하단에 카드·딥링크·출처를 붙인다.

**Architecture:** `runAgentLoop`(maxIterations=6, ai 주입)가 functionCall→실데이터 실행→결과 관찰을 반복하며 renders·sources를 누적한다. 도구는 provider를 **직접 import 호출**(HTTP 우회)해 LLM-facing JSON을 만들고, 기존 self-fetch 카드는 무수정 재사용한다. route는 ReadableStream+NDJSON으로 status/done/error 이벤트를 흘린다.

**Tech Stack:** Next.js 16(App Router), `@google/genai`, TypeScript, Vitest 4(node-env), next-intl 4.

설계 정본: `docs/superpowers/specs/2026-06-20-chat-agentic-workflow-design.md`

## Global Constraints

- **React/Next 비의존 유지**: `src/lib/chat/*`·`src/lib/gemini/*`는 React·Next import 금지(dodo-planet 이식성). 컴포넌트만 `"use client"`.
- **데이터 언어 분리**: 외부 데이터 fetch·영문 분기는 `ctx.dataLocale`(ko|en)을 거친다. `useLocale()` 원시값 직접 사용 금지.
- **가짜 실데이터 금지**: 도구 실패 시 mock 폴백 없이 `data: { error }`로 LLM에 전달. LLM이 실패를 안내.
- **provider 무수정 / 컴포넌트 무수정**: 기존 provider 시그니처·self-fetch 카드 컴포넌트를 바꾸지 않는다.
- **커밋**: 의도 파일만 `git commit -m "..." -- <paths>`(pathspec 모드, `git add -A` 금지). 메시지 한국어 + 푸터.
- **테스트 게이트**: `npm run test:run`·`npm run lint`·`npm run build` 통과. node-env라 컴포넌트 와이어링은 실호출 게이트로 보강.
- **불변식**: I-1 도구실패가 루프 안 죽임 / I-2 빈 text 폴백 / I-3 카드 done 1회 마운트 / I-4 router provider 직접 호출 / I-5 dataLocale 분리.

---

## File Structure

| 파일 | 책임 | Task |
|------|------|------|
| `src/lib/chat/sources.ts` | 도구→출처 매핑·중복제거 (순수) | 1 |
| `src/lib/chat/types.ts` | ToolResult 3분할, ChatMessage renders[]+sources, SourceAttribution, ChatStreamEvent | 2 |
| `src/lib/chat/render.ts` | provider 결과→data·render 헬퍼 | 2 |
| `src/lib/chat/router.ts` | 도구→provider 직접 호출, `{data,render?,source?}` 반환 | 2 |
| `src/lib/chat/agent-loop.ts` | `runAgentLoop` (multi-turn, ai 주입) | 3 |
| `src/app/api/chat/route.ts` | NDJSON 스트리밍 + maxDuration + runAgentLoop | 2(data feed)→4(stream) |
| `src/hooks/useChat.ts` | NDJSON 파싱, progressCategories, 타임아웃 | 4 |
| `src/components/chat/ChatInterface.tsx` | 진행 status live region | 4 |
| `src/components/chat/MessageBubble.tsx` | renders[] 맵 + SourceList | 4(renders), 5(SourceList) |
| `src/components/chat/SourceList.tsx` | 출처 푸터 (신설) | 5 |
| `messages/*.json` ×5 | progress·sources·source 라벨 | 6 |

---

## Task 1: 출처 맵 (sources.ts)

**Files:**
- Create: `src/lib/chat/sources.ts`
- Test: `src/lib/chat/__tests__/sources.test.ts`

**Interfaces:**
- Consumes: `ExecutionContext`(기존 types.ts), `SourceAttribution`(Task 2에서 확정 — 이 Task에선 sources.ts 내부에 임시 타입 선언 후 Task 2에서 types.ts로 이동). **편의상 이 Task에서 `SourceAttribution`을 types.ts에 먼저 추가**(아래 Step 3 포함).
- Produces: `sourceFor(tool: string, ctx: { dataLocale: "ko" | "en" }): SourceAttribution[]`, `dedupeSources(list: SourceAttribution[]): SourceAttribution[]`.

- [ ] **Step 1: SourceAttribution 타입을 types.ts에 추가**

`src/lib/chat/types.ts` 상단 import 아래에 추가:

```ts
/** 응답 하단에 표시할 데이터 제공처. label은 i18n 키(chat.<label>), url은 선택. */
export interface SourceAttribution {
  label: string;
  url?: string;
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/chat/__tests__/sources.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sourceFor, dedupeSources } from "../sources";

describe("sourceFor", () => {
  it("장소 검색은 ko에서 카카오만", () => {
    expect(sourceFor("search_places", { dataLocale: "ko" })).toEqual([
      { label: "source.kakao" },
    ]);
  });
  it("장소 검색은 en에서 카카오+TourAPI", () => {
    expect(sourceFor("search_places", { dataLocale: "en" })).toEqual([
      { label: "source.kakao" },
      { label: "source.tourapi" },
    ]);
  });
  it("자동차 경로는 ko=카카오모빌리티, en=NCP", () => {
    expect(sourceFor("get_car_route", { dataLocale: "ko" })).toEqual([
      { label: "source.kakaomobility" },
    ]);
    expect(sourceFor("get_car_route", { dataLocale: "en" })).toEqual([
      { label: "source.ncp" },
    ]);
  });
  it("공기질은 에어코리아", () => {
    expect(sourceFor("get_air_quality", { dataLocale: "ko" })).toEqual([
      { label: "source.airkorea" },
    ]);
  });
  it("미등록 도구는 빈 배열", () => {
    expect(sourceFor("unknown_tool", { dataLocale: "ko" })).toEqual([]);
  });
});

describe("dedupeSources", () => {
  it("label 기준 중복제거(첫 등장 보존)", () => {
    const out = dedupeSources([
      { label: "source.kakao" },
      { label: "source.airkorea" },
      { label: "source.kakao" },
    ]);
    expect(out).toEqual([{ label: "source.kakao" }, { label: "source.airkorea" }]);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm run test:run -- sources`
Expected: FAIL — "Cannot find module '../sources'"

- [ ] **Step 4: sources.ts 구현**

`src/lib/chat/sources.ts`:

```ts
/**
 * 도구 → 데이터 제공처(SourceAttribution) 매핑. 순수 함수(React/Next 비의존).
 * label은 i18n 키(messages의 chat.<label>). dataLocale로 ko/en 분기(경로·장소).
 */
import type { SourceAttribution } from "./types";

const KAKAO: SourceAttribution = { label: "source.kakao" };
const TOURAPI: SourceAttribution = { label: "source.tourapi" };
const JUSO: SourceAttribution = { label: "source.juso" };
const SEOUL_OPEN: SourceAttribution = { label: "source.seoulopen" };
const AIRKOREA: SourceAttribution = { label: "source.airkorea" };
const KMA: SourceAttribution = { label: "source.kma" };
const TAGO: SourceAttribution = { label: "source.tago" };
const NMC: SourceAttribution = { label: "source.nmc" };
const KAKAO_MOBILITY: SourceAttribution = { label: "source.kakaomobility" };
const NCP: SourceAttribution = { label: "source.ncp" };
const ODSAY: SourceAttribution = { label: "source.odsay" };
const KRIC: SourceAttribution = { label: "source.kric" };
const KORAIL: SourceAttribution = { label: "source.korail" };
const SEOUL_METRO: SourceAttribution = { label: "source.seoulmetro" };

export function sourceFor(
  tool: string,
  ctx: { dataLocale: "ko" | "en" },
): SourceAttribution[] {
  switch (tool) {
    case "search_places":
      return ctx.dataLocale === "en" ? [KAKAO, TOURAPI] : [KAKAO];
    case "search_address":
      return [JUSO];
    case "get_subway_arrivals":
      return [SEOUL_OPEN];
    case "get_bike_stations":
      return [SEOUL_OPEN];
    case "get_bus_arrivals":
      return [TAGO];
    case "get_air_quality":
      return [AIRKOREA];
    case "get_night_clinics":
      return [NMC];
    case "get_kids_places":
    case "get_surroundings":
      return [KAKAO];
    case "get_station_meta":
      return [KRIC];
    case "get_station_facilities":
      return [KORAIL, SEOUL_METRO];
    case "get_car_route":
      return ctx.dataLocale === "en" ? [NCP] : [KAKAO_MOBILITY];
    case "get_transit_route":
      return [ODSAY];
    default:
      return [];
  }
}

export function dedupeSources(list: SourceAttribution[]): SourceAttribution[] {
  const seen = new Set<string>();
  const out: SourceAttribution[] = [];
  for (const s of list) {
    if (seen.has(s.label)) continue;
    seen.add(s.label);
    out.push(s);
  }
  return out;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm run test:run -- sources`
Expected: PASS (6 tests)

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(chat): 도구→출처 매핑 sources.ts + SourceAttribution 타입

각 도구의 데이터 제공처를 i18n 키로 매핑(dataLocale로 ko/en 분기),
label 기준 중복제거. 응답 하단 출처 블록의 데이터 소스.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FLiTRTi2TUVPqf2J544Kvp" \
  -- src/lib/chat/sources.ts src/lib/chat/__tests__/sources.test.ts src/lib/chat/types.ts
```

---

## Task 2: 타입 계약 + 도구 라우터 실데이터화

ToolResult를 `{summary}`에서 `{data, render?, source?}`로 바꾸고, 각 도구가 provider를 직접 호출해 LLM용 실데이터를 만든다. route.ts는 이 Task에서 **기존 2-pass 구조를 유지**하되 summary 대신 data를 LLM에 먹인다(스트리밍·루프는 Task 4). 컴파일 그린.

**Files:**
- Modify: `src/lib/chat/types.ts` (ToolResult, ChatMessage)
- Modify: `src/lib/chat/render.ts` (data 헬퍼)
- Modify: `src/lib/chat/router.ts` (전면 재작성)
- Modify: `src/app/api/chat/route.ts:80-100` (summary→data, 2-pass 유지)
- Test: `src/lib/chat/__tests__/router.test.ts` (갱신), `src/lib/chat/__tests__/render.test.ts` (갱신)

**Interfaces:**
- Consumes: `sourceFor`(Task 1), provider 함수들(직접 import — 아래 매핑), `ExecutionContext`.
- Produces: `executeFunction(name, args, ctx): Promise<ToolResult>` where `ToolResult = { data: Record<string,unknown>; render?: RenderPayload; source?: SourceAttribution[] }`.

**provider 직접 호출 매핑** (router가 import할 함수, 모두 확인된 시그니처):
- `searchPlaces({ query, lang }): Promise<{places: Place[]}>`
- `searchJusoAddresses(keyword): Promise<JusoAddress[]>`
- `findAirQualityNear(lat, lng): Promise<AirQuality|null>`
- `fetchNearbySubwayArrivals(lat, lng): Promise<NearbySubwayStation[]>`
- `fetchNearbyBusStops(lat, lng): Promise<BusStop[]>`
- `fetchNearbyBikeStations(lat, lng): Promise<BikeStation[]>`
- `findNightClinicsNear(lat, lng): Promise<NightClinic[]>`
- `findKidsPlacesNear(lat, lng): Promise<KidsPlace[]>`
- `findSurroundingsNear(lat, lng): Promise<SurroundingPlace[]>`
- `findStationMeta(query): StationMeta|null` (동기, 정적 seed)
- `fetchStationFacilities(stationName): Promise<StationFacilities|null>`
- `fetchSeoulMetroFacilities(stationName): Promise<SeoulMetroFacilities|null>`
- `getCarRouteBriefing({origin, dest})` / `getCarRouteBriefingEn({origin, dest})`
- `getTransitRoute({origin, dest}): Promise<TransitRouteResult|null>`

- [ ] **Step 1: types.ts — ToolResult·ChatMessage 변경**

`src/lib/chat/types.ts`에서 `ToolResult`를 교체하고 `ChatMessage`에 필드 추가:

```ts
/** 도구 실행 결과 — LLM용 데이터 + 선택적 카드 + 출처. */
export interface ToolResult {
  /** LLM이 추론·종합할 실제 JSON (요약 문자열 아님). 실패 시 { error } */
  data: Record<string, unknown>;
  /** 구조화 데이터를 렌더할 카드 (없으면 텍스트만) */
  render?: RenderPayload;
  /** 이 도구가 사용한 데이터 제공처(0..n) */
  source?: SourceAttribution[];
}

/** 채팅 메시지 하나. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** 어시스턴트 응답에 첨부되는 카드들(복수 — 한 답변에 여러 카드 가능) */
  renders?: RenderPayload[];
  /** 응답 하단 출처 목록 */
  sources?: SourceAttribution[];
  error?: string;
}
```

(기존 `ChatMessage.render` 단수 필드는 제거. `ToolResult.summary` 제거.)

- [ ] **Step 2: render.ts — data 헬퍼로 정리**

`src/lib/chat/render.ts` 교체(요약 문자열 헬퍼 삭제, render 헬퍼 유지 + data 헬퍼 추가):

```ts
/** provider 결과 → RenderPayload + LLM용 data. React/Next 비의존. */
import type { Place, JusoAddress } from "@/lib/types";
import type { RenderPayload } from "./types";

export function placesToRender(places: Place[]): RenderPayload {
  return { type: "places", places };
}

/** LLM용: 상위 N건·핵심 필드만(토큰 절약). */
export function placesToData(places: Place[]): Record<string, unknown> {
  return {
    count: places.length,
    places: places.slice(0, 8).map((p) => ({
      name: p.name,
      category: p.category,
      address: p.roadAddress || p.address,
    })),
  };
}

export function addressesToRender(results: JusoAddress[]): RenderPayload {
  return { type: "addresses", results };
}

export function addressesToData(results: JusoAddress[]): Record<string, unknown> {
  return {
    count: results.length,
    addresses: results.slice(0, 5).map((r) => ({
      roadAddr: r.roadAddr,
      zipNo: r.zipNo,
    })),
  };
}
```

- [ ] **Step 3: router.test.ts — 새 계약 테스트 작성(실패)**

`src/lib/chat/__tests__/router.test.ts` 교체. provider mock 추가:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/providers/places", () => ({
  searchPlaces: vi.fn(async ({ lang }: { lang: string }) => ({
    places: [{ id: "1", name: lang === "en" ? "Gildong Cafe" : "길동 카페",
      category: "카페", address: "강동구", roadAddress: "강동대로 1", lat: 37.5, lng: 127.1 }],
    provider: "kakao-local", query: "q",
  })),
}));
vi.mock("@/lib/providers/juso-address", () => ({
  searchJusoAddresses: vi.fn(async () => [
    { roadAddr: "서울특별시 중구 세종대로 110", roadAddrPart1: "", jibunAddr: "",
      engAddr: "110 Sejong-daero", zipNo: "04524", bdNm: "서울시청" }]),
}));
vi.mock("@/lib/providers/air-quality", () => ({
  findAirQualityNear: vi.fn(async () => ({ khai: 229, grade: "나쁨", pm10: 80, pm25: 40, station: "천호대로", distanceKm: 0.5 })),
}));
vi.mock("@/lib/providers/subway-nearby", () => ({
  fetchNearbySubwayArrivals: vi.fn(async () => [{ name: "강남", arrivals: [] }]),
}));

import { executeFunction } from "../router";

const ctxKo = { locale: "ko", dataLocale: "ko" as const, userLocation: { lat: 37.5, lng: 127.1 } };
const ctxNoLoc = { locale: "ko", dataLocale: "ko" as const };

describe("executeFunction — 실데이터 + render + source", () => {
  it("search_places: data.places + render + source(kakao)", async () => {
    const r = await executeFunction("search_places", { query: "길동 카페" }, ctxKo);
    expect((r.data as any).count).toBe(1);
    expect(r.render).toEqual({ type: "places", places: expect.any(Array) });
    expect(r.source).toEqual([{ label: "source.kakao" }]);
  });

  it("get_air_quality: provider 실데이터를 data에 싣고 카드 마운트", async () => {
    const r = await executeFunction("get_air_quality", {}, ctxKo);
    expect((r.data as any).air.grade).toBe("나쁨");
    expect(r.render).toEqual({ type: "air-quality", lat: 37.5, lng: 127.1 });
    expect(r.source).toEqual([{ label: "source.airkorea" }]);
  });

  it("get_subway_arrivals: 위치 있으면 실데이터", async () => {
    const r = await executeFunction("get_subway_arrivals", {}, ctxKo);
    expect((r.data as any).arrivals).toHaveLength(1);
    expect(r.render).toEqual({ type: "subway-nearby" });
  });

  it("위치 없는 nearby 도구는 data.error", async () => {
    const r = await executeFunction("get_subway_arrivals", {}, ctxNoLoc);
    expect((r.data as any).error).toBeTruthy();
    expect(r.render).toBeUndefined();
  });

  it("알 수 없는 도구는 throw", async () => {
    await expect(executeFunction("nope", {}, ctxKo)).rejects.toThrow();
  });
});
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `npm run test:run -- router`
Expected: FAIL — router가 아직 `{summary}` 반환(또는 컴파일 에러)

- [ ] **Step 5: router.ts 전면 재작성**

`src/lib/chat/router.ts` 교체:

```ts
/**
 * Gemini function call → provider 직접 호출 라우터. React/Next 비의존.
 * 각 도구는 provider를 직접 호출해 LLM용 data를 만들고, 카드 마운트 지시(render)와
 * 출처(source)를 함께 반환한다. 도구 내부 실패는 호출자(agent-loop)가 흡수한다.
 */
import type { ExecutionContext, ToolResult } from "./types";
import { searchPlaces } from "@/lib/providers/places";
import { searchJusoAddresses } from "@/lib/providers/juso-address";
import { findAirQualityNear } from "@/lib/providers/air-quality";
import { fetchNearbySubwayArrivals } from "@/lib/providers/subway-nearby";
import { fetchNearbyBusStops } from "@/lib/providers/tago-bus";
import { fetchNearbyBikeStations } from "@/lib/providers/seoul-bike";
import { findNightClinicsNear } from "@/lib/providers/night-clinic";
import { findKidsPlacesNear } from "@/lib/providers/kids-places";
import { findSurroundingsNear } from "@/lib/providers/surroundings";
import { findStationMeta } from "@/lib/subway-stations";
import { fetchStationFacilities } from "@/lib/providers/korail-facilities";
import { fetchSeoulMetroFacilities } from "@/lib/providers/seoul-metro-facilities";
import { getCarRouteBriefing } from "@/lib/providers/kakao-navi";
import { getCarRouteBriefingEn } from "@/lib/providers/ncp-directions";
import { getTransitRoute } from "@/lib/providers/odsay";
import { hasNcpMapsKeys } from "@/lib/env";
import { placesToRender, placesToData, addressesToRender, addressesToData } from "./render";
import { sourceFor } from "./sources";

/** 지명 → 좌표(카카오 지오코딩 첫 결과) 또는 현재 위치. */
async function resolveCoord(
  place: string | undefined,
  ctx: ExecutionContext,
): Promise<{ lat: number; lng: number } | undefined> {
  if (place) {
    const r = await searchPlaces({ query: place, lang: ctx.dataLocale });
    const p = r.places[0];
    return p ? { lat: p.lat, lng: p.lng } : undefined;
  }
  return ctx.userLocation;
}

const NO_LOCATION = { error: "현재 위치를 알 수 없습니다." };

export async function executeFunction(
  name: string,
  args: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<ToolResult> {
  const src = sourceFor(name, ctx);
  switch (name) {
    case "search_places": {
      const query = String(args.query ?? "");
      const result = await searchPlaces({ query, lang: ctx.dataLocale });
      return { data: placesToData(result.places), render: placesToRender(result.places), source: src };
    }
    case "search_address": {
      const keyword = String(args.keyword ?? "");
      const results = await searchJusoAddresses(keyword);
      return { data: addressesToData(results), render: addressesToRender(results), source: src };
    }
    case "get_subway_arrivals": {
      if (!ctx.userLocation) return { data: NO_LOCATION };
      const arrivals = await fetchNearbySubwayArrivals(ctx.userLocation.lat, ctx.userLocation.lng);
      return { data: { count: arrivals.length, arrivals }, render: { type: "subway-nearby" }, source: src };
    }
    case "get_night_clinics": {
      if (!ctx.userLocation) return { data: NO_LOCATION };
      const clinics = await findNightClinicsNear(ctx.userLocation.lat, ctx.userLocation.lng);
      return { data: { count: clinics.length, clinics: clinics.slice(0, 5) }, render: { type: "clinics-nearby" }, source: src };
    }
    case "get_kids_places": {
      if (!ctx.userLocation) return { data: NO_LOCATION };
      const kids = await findKidsPlacesNear(ctx.userLocation.lat, ctx.userLocation.lng);
      return { data: { count: kids.length, places: kids.slice(0, 8) }, render: { type: "kids-nearby" }, source: src };
    }
    case "get_surroundings": {
      if (!ctx.userLocation) return { data: NO_LOCATION };
      const around = await findSurroundingsNear(ctx.userLocation.lat, ctx.userLocation.lng);
      return { data: { count: around.length, places: around.slice(0, 12) }, render: { type: "surroundings-nearby" }, source: src };
    }
    case "get_bus_arrivals": {
      const coord = await resolveCoord(args.place ? String(args.place) : undefined, ctx);
      if (!coord) return { data: NO_LOCATION };
      const stops = await fetchNearbyBusStops(coord.lat, coord.lng);
      const mode = args.place ? "place" : "current";
      const render = mode === "place"
        ? { type: "bus" as const, mode: "place" as const, lat: coord.lat, lng: coord.lng }
        : { type: "bus" as const, mode: "current" as const };
      return { data: { count: stops.length, stops: stops.slice(0, 5) }, render, source: src };
    }
    case "get_bike_stations": {
      const coord = await resolveCoord(args.place ? String(args.place) : undefined, ctx);
      if (!coord) return { data: NO_LOCATION };
      const stations = await fetchNearbyBikeStations(coord.lat, coord.lng);
      const render = args.place
        ? { type: "bike" as const, mode: "place" as const, lat: coord.lat, lng: coord.lng }
        : { type: "bike" as const, mode: "current" as const };
      return { data: { count: stations.length, stations: stations.slice(0, 5) }, render, source: src };
    }
    case "get_air_quality": {
      const coord = await resolveCoord(args.place ? String(args.place) : undefined, ctx);
      if (!coord) return { data: NO_LOCATION };
      const air = await findAirQualityNear(coord.lat, coord.lng);
      return { data: { air }, render: { type: "air-quality", lat: coord.lat, lng: coord.lng }, source: src };
    }
    case "get_station_meta": {
      const stationName = String(args.stationName ?? "");
      if (!stationName) return { data: { error: "역 이름이 필요합니다." } };
      const meta = findStationMeta(stationName);
      return { data: { meta }, render: { type: "station-meta", stationName }, source: src };
    }
    case "get_station_facilities": {
      const stationName = String(args.stationName ?? "");
      if (!stationName) return { data: { error: "역 이름이 필요합니다." } };
      const [korail, metro] = await Promise.all([
        fetchStationFacilities(stationName),
        fetchSeoulMetroFacilities(stationName),
      ]);
      return { data: { korail, metro }, render: { type: "station-facilities", stationName }, source: src };
    }
    case "get_car_route": {
      const destination = String(args.destination ?? "");
      if (!destination) return { data: { error: "목적지가 필요합니다." } };
      const r = await searchPlaces({ query: destination, lang: ctx.dataLocale });
      const p = r.places[0];
      if (!p) return { data: { error: `'${destination}' 위치를 찾지 못했습니다.` } };
      const dest = { lat: p.lat, lng: p.lng, name: p.name };
      const render = { type: "car-route" as const, dest };
      if (!ctx.userLocation) return { data: NO_LOCATION, render, source: src };
      const briefing = ctx.dataLocale === "en" && hasNcpMapsKeys()
        ? await getCarRouteBriefingEn({ origin: ctx.userLocation, dest: { lat: p.lat, lng: p.lng } })
        : await getCarRouteBriefing({ origin: ctx.userLocation, dest: { lat: p.lat, lng: p.lng } });
      return { data: { destination: p.name, briefing }, render, source: src };
    }
    case "get_transit_route": {
      const destination = String(args.destination ?? "");
      if (!destination) return { data: { error: "목적지가 필요합니다." } };
      const r = await searchPlaces({ query: destination, lang: ctx.dataLocale });
      const p = r.places[0];
      if (!p) return { data: { error: `'${destination}' 위치를 찾지 못했습니다.` } };
      const dest = { lat: p.lat, lng: p.lng, name: p.name };
      const render = { type: "transit-route" as const, dest };
      if (!ctx.userLocation) return { data: NO_LOCATION, render, source: src };
      const route = await getTransitRoute({ origin: ctx.userLocation, dest: { lat: p.lat, lng: p.lng } });
      return { data: { destination: p.name, route }, render, source: src };
    }
    default:
      throw new Error(`알 수 없는 도구: ${name}`);
  }
}
```

> ⚠ `findStationMeta`는 `@/lib/subway-stations`에서 import(provider 디렉터리 아님 — Task 사전조사로 확인). `CarRouteBriefing`/`TransitRouteBriefing` render의 dest는 `{lat,lng,name}`(기존 RenderPayload 정의와 일치).

- [ ] **Step 6: route.ts — summary→data (2-pass 유지)**

`src/app/api/chat/route.ts:80-100` 영역에서 functionResponse를 data로 교체:

```ts
      // tool 응답(실데이터)을 user role로 되돌려 2차 generateContent 호출
      history.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: name!,
              response: result.data,   // ← summary → 실데이터
            },
          },
        ],
      });
```

`render = result.render;` 줄은 그대로(단수 render 반환 유지 — Task 4에서 renders[]로 전환). 응답은 `{ text, render }` 유지.

- [ ] **Step 7: render.test.ts 갱신**

`src/lib/chat/__tests__/render.test.ts`를 새 헬퍼에 맞게 교체:

```ts
import { describe, it, expect } from "vitest";
import { placesToData, placesToRender, addressesToData } from "../render";

const place = { id: "1", name: "길동 카페", category: "카페", address: "강동구",
  roadAddress: "강동대로 1", lat: 37.5, lng: 127.1 };

describe("render 헬퍼", () => {
  it("placesToData는 count + 상위 8건 핵심필드", () => {
    const d = placesToData([place]) as any;
    expect(d.count).toBe(1);
    expect(d.places[0]).toEqual({ name: "길동 카페", category: "카페", address: "강동대로 1" });
  });
  it("placesToRender는 places 페이로드", () => {
    expect(placesToRender([place])).toEqual({ type: "places", places: [place] });
  });
  it("addressesToData는 count + roadAddr/zipNo", () => {
    const d = addressesToData([{ roadAddr: "세종대로 110", roadAddrPart1: "", jibunAddr: "",
      engAddr: "", zipNo: "04524", bdNm: "" } as any]) as any;
    expect(d.addresses[0]).toEqual({ roadAddr: "세종대로 110", zipNo: "04524" });
  });
});
```

- [ ] **Step 8: 전체 테스트·lint·build 통과 확인**

Run: `npm run test:run && npm run lint`
Expected: PASS (sources·router·render 포함 전체 그린). route는 2-pass로 컴파일·동작.

- [ ] **Step 9: 커밋**

```bash
git commit -m "feat(chat): 도구 라우터 실데이터화 — ToolResult 3분할

각 도구가 provider를 직접 호출해 LLM용 data를 반환(요약 문자열 폐기).
render(카드 마운트)·source(출처) 병행. route는 2-pass 유지하되 data를
LLM에 먹임(스트리밍·멀티턴은 후속). ChatMessage renders[]+sources 필드 추가.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FLiTRTi2TUVPqf2J544Kvp" \
  -- src/lib/chat/types.ts src/lib/chat/render.ts src/lib/chat/router.ts \
     src/app/api/chat/route.ts src/lib/chat/__tests__/router.test.ts \
     src/lib/chat/__tests__/render.test.ts
```

---

## Task 3: 에이전트 루프 (agent-loop.ts)

multi-turn 루프를 ai 주입형 순수 모듈로 작성. route와 독립이라 이 Task는 격리 테스트로 그린.

**Files:**
- Create: `src/lib/chat/agent-loop.ts`
- Test: `src/lib/chat/__tests__/agent-loop.test.ts`

**Interfaces:**
- Consumes: `executeFunction`(Task 2), `ToolResult`/`RenderPayload`/`SourceAttribution`(types), `dedupeSources`(sources), `@google/genai`의 `GoogleGenAI`/`Content`/`Part`/`FunctionCall`/`FunctionDeclaration` 타입.
- Produces: `runAgentLoop(opts): Promise<AgentLoopResult>` where `AgentLoopResult = { text: string; renders: RenderPayload[]; sources: SourceAttribution[] }`.

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/chat/__tests__/agent-loop.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

// executeFunction을 mock — 도구 시나리오 주입
vi.mock("../router", () => ({
  executeFunction: vi.fn(async (name: string) => {
    if (name === "fail_tool") throw new Error("provider 폭발");
    return {
      data: { ok: true, name },
      render: { type: "air-quality", lat: 1, lng: 2 },
      source: [{ label: "source.airkorea" }],
    };
  }),
}));

import { runAgentLoop } from "../agent-loop";

/** generateContent가 순차적으로 돌려줄 응답 스크립트를 만든다. */
function makeAi(responses: any[]) {
  let i = 0;
  return {
    models: {
      generateContent: vi.fn(async () => responses[Math.min(i++, responses.length - 1)]),
    },
  } as any;
}
const fcResponse = (name: string) => ({
  candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args: {} } }] } }],
  text: "",
});
const textResponse = (text: string) => ({
  candidates: [{ content: { role: "model", parts: [{ text }] } }],
  text,
});
const baseOpts = (ai: any) => ({
  ai, model: "m", systemInstruction: "s",
  tools: [{ functionDeclarations: [] }],
  history: [{ role: "user", parts: [{ text: "q" }] }],
  ctx: { locale: "ko", dataLocale: "ko" as const, userLocation: { lat: 1, lng: 2 } },
});

describe("runAgentLoop", () => {
  it("도구 호출 후 최종 산문 반환 + renders/sources 수집", async () => {
    const ai = makeAi([fcResponse("get_air_quality"), textResponse("공기질은 나쁨입니다.")]);
    const r = await runAgentLoop(baseOpts(ai));
    expect(r.text).toBe("공기질은 나쁨입니다.");
    expect(r.renders).toEqual([{ type: "air-quality", lat: 1, lng: 2 }]);
    expect(r.sources).toEqual([{ label: "source.airkorea" }]);
    expect(ai.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it("연쇄 2회 도구 호출 후 종합", async () => {
    const ai = makeAi([fcResponse("get_air_quality"), fcResponse("get_subway_arrivals"), textResponse("종합")]);
    const r = await runAgentLoop(baseOpts(ai));
    expect(r.text).toBe("종합");
    expect(ai.models.generateContent).toHaveBeenCalledTimes(3);
  });

  it("도구 실패는 루프를 죽이지 않고 LLM에 error 전달(I-1)", async () => {
    const ai = makeAi([fcResponse("fail_tool"), textResponse("조회에 실패했어요. 다시 시도해 주세요.")]);
    const r = await runAgentLoop(baseOpts(ai));
    expect(r.text).toContain("실패");
    expect(r.renders).toEqual([]); // 실패 도구는 render 미수집
  });

  it("빈 text는 tools 없이 1회 강제 폴백(I-2)", async () => {
    const ai = makeAi([fcResponse("get_air_quality"), textResponse(""), textResponse("폴백 답변")]);
    const r = await runAgentLoop(baseOpts(ai));
    expect(r.text).toBe("폴백 답변");
  });

  it("onStatus 콜백이 도구 카테고리를 통지", async () => {
    const onStatus = vi.fn();
    const ai = makeAi([fcResponse("get_air_quality"), textResponse("끝")]);
    await runAgentLoop({ ...baseOpts(ai), onStatus });
    expect(onStatus).toHaveBeenCalledWith(["get_air_quality"]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- agent-loop`
Expected: FAIL — "Cannot find module '../agent-loop'"

- [ ] **Step 3: agent-loop.ts 구현**

`src/lib/chat/agent-loop.ts`:

```ts
/**
 * multi-turn 함수호출 에이전트 루프. ai 클라이언트 주입형(테스트 가능), React/Next 비의존.
 *
 * functionCall → executeFunction(실데이터) → 결과 관찰을 maxIterations까지 반복하며
 * renders·sources를 누적한다. 도구 실패는 흡수해 LLM에 error로 전달(루프 안 죽임).
 * 루프 후 text가 비면 tools 없이 1회 강제(빈 버블 차단).
 */
import type { GoogleGenAI, Content, Part, FunctionCall } from "@google/genai";
import type { FunctionDeclaration } from "@google/genai";
import type { ExecutionContext, RenderPayload, SourceAttribution } from "./types";
import { executeFunction } from "./router";
import { dedupeSources } from "./sources";

export interface AgentLoopResult {
  text: string;
  renders: RenderPayload[];
  sources: SourceAttribution[];
}

export interface AgentLoopOptions {
  ai: GoogleGenAI;
  model: string;
  systemInstruction: string;
  tools: { functionDeclarations: FunctionDeclaration[] }[];
  history: Content[];
  ctx: ExecutionContext;
  onStatus?: (toolNames: string[]) => void;
  maxIterations?: number;
}

function functionCallParts(parts: Part[]): (Part & { functionCall: FunctionCall })[] {
  return parts.filter((p): p is Part & { functionCall: FunctionCall } => "functionCall" in p);
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const { ai, model, systemInstruction, tools, ctx, onStatus } = opts;
  const maxIterations = opts.maxIterations ?? 6;
  const history = [...opts.history];
  const renders: RenderPayload[] = [];
  const sources: SourceAttribution[] = [];

  let response = await ai.models.generateContent({
    model, contents: history, config: { systemInstruction, tools },
  });

  for (let iter = 0; iter < maxIterations; iter++) {
    const parts: Part[] = response.candidates?.[0]?.content?.parts ?? [];
    const fcParts = functionCallParts(parts);
    if (fcParts.length === 0) break;

    // Gemini 3 규약: model content(thoughtSignature 포함) 보존
    history.push(response.candidates![0].content! as Content);
    onStatus?.(fcParts.map((p) => p.functionCall.name ?? "unknown"));

    const settled = await Promise.allSettled(
      fcParts.map((p) => executeFunction(p.functionCall.name ?? "", (p.functionCall.args ?? {}) as Record<string, unknown>, ctx)),
    );

    const responseParts: Part[] = settled.map((s, idx) => {
      const name = fcParts[idx].functionCall.name!;
      if (s.status === "fulfilled") {
        if (s.value.render) renders.push(s.value.render);
        if (s.value.source) sources.push(...s.value.source);
        return { functionResponse: { name, response: s.value.data } };
      }
      // I-1: 실패를 LLM에 전달, 루프 유지
      return { functionResponse: { name, response: { error: String(s.reason) } } };
    });
    history.push({ role: "user", parts: responseParts });

    response = await ai.models.generateContent({
      model, contents: history, config: { systemInstruction, tools },
    });
  }

  let text = response.text ?? "";
  if (text.trim() === "") {
    // I-2: tools 없이 1회 강제 산문
    const retry = await ai.models.generateContent({
      model, contents: history, config: { systemInstruction },
    });
    text = retry.text ?? "";
  }

  return { text, renders, sources: dedupeSources(sources) };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:run -- agent-loop`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(chat): multi-turn 에이전트 루프 runAgentLoop

ai 주입형 순수 루프 — functionCall→실데이터 실행→관찰을 maxIterations(6)까지
반복하며 renders·sources 누적. 도구 실패 흡수(I-1), 빈 text는 tools 없이
1회 강제 폴백(I-2). mock ai로 시나리오 결정적 테스트.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FLiTRTi2TUVPqf2J544Kvp" \
  -- src/lib/chat/agent-loop.ts src/lib/chat/__tests__/agent-loop.test.ts
```

---

## Task 4: NDJSON 스트리밍 라우트 + 클라이언트 전환

route를 runAgentLoop + NDJSON 스트리밍으로 교체하고, useChat을 스트림 리더로, MessageBubble을 renders[]로, ChatInterface에 진행 통지를 추가한다.

**Files:**
- Modify: `src/app/api/chat/route.ts` (전면 재작성)
- Modify: `src/hooks/useChat.ts`
- Modify: `src/components/chat/MessageBubble.tsx`
- Modify: `src/components/chat/ChatInterface.tsx`
- Modify: `src/app/api/chat/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `runAgentLoop`(Task 3), `availableDeclarations`, `getGeminiClient`/`GEMINI_MODEL`, `dataLocale`, `ChatStreamEvent`(types, 이 Task에서 추가).
- Produces: `/api/chat`가 NDJSON 스트림(`status`/`done`/`error` 줄) 반환. useChat이 `{ messages, isLoading, error, progressCategories, sendMessage, dismissError }` 반환.

- [ ] **Step 1: types.ts에 ChatStreamEvent 추가**

`src/lib/chat/types.ts` 끝에:

```ts
/** NDJSON 스트리밍 이벤트 (서버 → 클라이언트, 1줄 1이벤트). */
export type ChatStreamEvent =
  | { type: "status"; categories: string[] }
  | { type: "done"; text: string; renders: RenderPayload[]; sources: SourceAttribution[] }
  | { type: "error"; code: string };
```

- [ ] **Step 2: route.ts 재작성**

`src/app/api/chat/route.ts` 전체 교체:

```ts
// /api/chat — Gemini multi-turn 에이전트 루프 + NDJSON 스트리밍
import type { Content } from "@google/genai";
import { getGeminiClient, GEMINI_MODEL } from "@/lib/gemini/client";
import { availableDeclarations } from "@/lib/chat/declarations";
import { runAgentLoop } from "@/lib/chat/agent-loop";
import { dataLocale } from "@/lib/data-locale";
import type { ExecutionContext, ChatStreamEvent } from "@/lib/chat/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // 적극 연쇄 + 여러 Gemini 호출 — 조기 중단 방지

interface ChatRequest {
  messages: { role: "user" | "assistant"; text: string }[];
  userLocation?: { lat: number; lng: number };
  locale?: string;
}

export async function POST(request: Request) {
  const ai = getGeminiClient();
  if (!ai) {
    return new Response(JSON.stringify({ error: "chat_unavailable" }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }

  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const locale = body.locale ?? "ko";
  const ctx: ExecutionContext = { userLocation: body.userLocation, locale, dataLocale: dataLocale(locale) };

  const systemInstruction =
    `너는 한국 로컬 정보 에이전트다. 사용자 언어(${locale})로 답한다.\n` +
    `[도구 사용]\n` +
    `- 사용자 의도를 충족하는 데 필요한 도구를 충분히 호출하라. 관련 정보(경로 질문이면 날씨·공기질 등)는 자율적으로 연쇄 조회하되, 명백히 무관한 건 호출하지 마라.\n` +
    `- "확인 중", "잠시만요" 같은 대기 멘트로 턴을 끝내지 마라. 이 채팅엔 자동 후속이 없다 — 도구를 쓸 거면 같은 턴에 호출하고, 충분한 결과를 모은 뒤에만 최종 답변하라.\n` +
    `[신뢰성]\n` +
    `- 도구 결과 데이터에 근거해서만 사실을 말하라. 도구가 실패하거나 빈 결과면 지어내지 말고, 실패를 분명히 알린 뒤 구체적 대안 한 가지를 제시하라.\n` +
    `- 출처·딥링크는 시스템이 응답 하단에 자동으로 붙인다. 본문엔 URL을 나열하지 말고 간결하게 핵심만 종합하라.`;

  const tools = [{ functionDeclarations: availableDeclarations() }];
  const history: Content[] = body.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.text }],
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ChatStreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        const result = await runAgentLoop({
          ai, model: GEMINI_MODEL, systemInstruction, tools, history, ctx,
          onStatus: (names) => send({ type: "status", categories: names }),
        });
        send({ type: "done", text: result.text, renders: result.renders, sources: result.sources });
      } catch (e) {
        console.error("[chat] 에이전트 루프 오류:", e);
        send({ type: "error", code: "chat_failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
```

- [ ] **Step 3: route.test.ts 갱신(스트림 검증)**

`src/app/api/chat/__tests__/route.test.ts` 교체. getGeminiClient·runAgentLoop를 mock:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/gemini/client", () => ({
  getGeminiClient: vi.fn(() => ({})),
  GEMINI_MODEL: "m",
}));
vi.mock("@/lib/chat/declarations", () => ({ availableDeclarations: () => [] }));
vi.mock("@/lib/chat/agent-loop", () => ({
  runAgentLoop: vi.fn(async (opts: any) => {
    opts.onStatus?.(["get_air_quality"]);
    return { text: "최종 답변", renders: [{ type: "air-quality", lat: 1, lng: 2 }], sources: [{ label: "source.airkorea" }] };
  }),
}));

import { POST } from "../route";

async function readNdjson(res: Response): Promise<any[]> {
  const text = await res.text();
  return text.trim().split("\n").map((l) => JSON.parse(l));
}

describe("POST /api/chat", () => {
  it("NDJSON status + done 이벤트 스트리밍", async () => {
    const req = new Request("http://x/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", text: "공기질" }], locale: "ko" }),
    });
    const res = await POST(req);
    expect(res.headers.get("Content-Type")).toContain("ndjson");
    const events = await readNdjson(res);
    expect(events[0]).toEqual({ type: "status", categories: ["get_air_quality"] });
    expect(events.at(-1)).toEqual({
      type: "done", text: "최종 답변",
      renders: [{ type: "air-quality", lat: 1, lng: 2 }],
      sources: [{ label: "source.airkorea" }],
    });
  });

  it("키 없으면 502", async () => {
    const { getGeminiClient } = await import("@/lib/gemini/client");
    (getGeminiClient as any).mockReturnValueOnce(null);
    const req = new Request("http://x/api/chat", { method: "POST", body: "{}" });
    const res = await POST(req);
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 4: route 테스트 확인**

Run: `npm run test:run -- "api/chat"`
Expected: PASS

- [ ] **Step 5: useChat.ts 재작성(NDJSON 리더)**

`src/hooks/useChat.ts`의 `sendMessage` try 블록과 반환을 교체. 상단에 progress 상태 추가:

```ts
  const [progressCategories, setProgressCategories] = useState<string[]>([]);
```

`sendMessage`의 fetch 이후:

```ts
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120_000);
        let res: Response;
        try {
          res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: history.map((m) => ({ role: m.role, text: m.text })),
              userLocation, locale,
            }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }
        if (!res.ok || !res.body) { setError("chat_failed"); return; }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done: { text: string; renders?: unknown[]; sources?: unknown[] } | null = null;
        let streamError: string | null = null;

        while (true) {
          const { done: streamDone, value } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let evt: ChatStreamEvent;
            try { evt = JSON.parse(line); } catch { continue; }
            if (evt.type === "status") setProgressCategories(evt.categories);
            else if (evt.type === "done") done = evt;
            else if (evt.type === "error") streamError = evt.code;
          }
        }

        if (streamError) { setError(streamError); return; }
        const assistantMsg: ChatMessage = {
          id: nextId(), role: "assistant",
          text: done?.text ?? "",
          renders: (done?.renders as ChatMessage["renders"]) ?? undefined,
          sources: (done?.sources as ChatMessage["sources"]) ?? undefined,
        };
        const next = [...messagesRef.current, assistantMsg];
        messagesRef.current = next;
        setMessages(next);
      } catch (e) {
        setError(e instanceof DOMException && e.name === "AbortError" ? "timeout" : "chat_failed");
      } finally {
        setProgressCategories([]);
        setLoading(false);
        inFlight.current = false;
      }
```

import에 `ChatStreamEvent` 추가, 반환 객체에 `progressCategories` 추가:

```ts
import type { ChatMessage, ChatStreamEvent } from "@/lib/chat/types";
...
  return { messages, isLoading, error, progressCategories, sendMessage, dismissError };
```

- [ ] **Step 6: MessageBubble.tsx — renders[] 맵**

`src/components/chat/MessageBubble.tsx`의 단수 render를 복수로:

```tsx
      {message.renders?.map((render, i) => (
        <RenderBlock key={i} render={render} onOpenPlace={onOpenPlace} />
      ))}
```

(기존 `{message.render && (<RenderBlock .../>)}` 줄 교체. `RenderBlock` 함수·import는 그대로.)

- [ ] **Step 7: ChatInterface.tsx — 진행 통지 live region**

`src/components/chat/ChatInterface.tsx`에서 `progressCategories`를 구독해 별도 polite region에 통지:

```tsx
  const { messages, isLoading, error, progressCategories, sendMessage } = useChat();
  ...
  const progressRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (progressRef.current) {
      progressRef.current.textContent = progressCategories.length
        ? t("progress.searching", { tools: progressCategories.map((c) => t(`progress.tool.${c}`)).join(", ") })
        : "";
    }
  }, [progressCategories, t]);
```

JSX에 최종답변 region과 **별도**로:

```tsx
      <div ref={progressRef} aria-live="polite" className="sr-only" />
```

> `t("progress.tool.<도구명>")`이 없으면 next-intl이 키를 그대로 노출하므로, Task 6에서 13개 도구 키를 채운다. 키 누락 시 fallback은 도구명 문자열(허용).

- [ ] **Step 8: 전체 테스트·lint·build 확인**

Run: `npm run test:run && npm run lint && npm run build`
Expected: PASS. 기존 MessageBubble.test·ChatInterface.test가 깨지면 renders[]/progressCategories에 맞게 갱신(아래 Step 9).

- [ ] **Step 9: MessageBubble.test·ChatInterface.test 갱신**

`src/components/chat/__tests__/MessageBubble.test.tsx`에서 `render:` 단수를 `renders: [ ... ]`로 바꾼다(기존 테스트가 단수 render를 쓰면 복수 배열로). ChatInterface.test는 useChat mock에 `progressCategories: []`를 추가한다. (구체 변경은 기존 테스트 내용에 따라 — 깨진 단언만 최소 수정.)

- [ ] **Step 10: 커밋**

```bash
git commit -m "feat(chat): NDJSON 스트리밍 라우트 + multi-turn 전환

route를 runAgentLoop + ReadableStream NDJSON으로 교체(maxDuration=120),
status/done/error 이벤트. useChat 스트림 리더 + progressCategories +
120s 타임아웃. MessageBubble renders[] 복수 카드, ChatInterface 진행 통지.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FLiTRTi2TUVPqf2J544Kvp" \
  -- src/lib/chat/types.ts src/app/api/chat/route.ts src/hooks/useChat.ts \
     src/components/chat/MessageBubble.tsx src/components/chat/ChatInterface.tsx \
     src/app/api/chat/__tests__/route.test.ts \
     src/components/chat/__tests__/MessageBubble.test.tsx \
     src/components/chat/__tests__/ChatInterface.test.tsx
```

---

## Task 5: 출처 푸터 (SourceList)

응답 하단에 출처 목록을 미니멀하게 렌더한다.

**Files:**
- Create: `src/components/chat/SourceList.tsx`
- Modify: `src/components/chat/MessageBubble.tsx`
- Test: `src/components/chat/__tests__/SourceList.test.tsx`

**Interfaces:**
- Consumes: `SourceAttribution`(types), `useTranslations`(next-intl).
- Produces: `<SourceList sources={SourceAttribution[] | undefined} />`.

- [ ] **Step 1: 실패 테스트 작성**

`src/components/chat/__tests__/SourceList.test.tsx`(기존 컴포넌트 테스트의 NextIntlClientProvider 래퍼 패턴을 따른다 — 같은 디렉터리 테스트 참고):

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SourceList } from "../SourceList";

const messages = { chat: { sources: "출처", source: { kakao: "카카오", airkorea: "에어코리아" } } };
const wrap = (ui: React.ReactNode) =>
  render(<NextIntlClientProvider locale="ko" messages={messages}>{ui}</NextIntlClientProvider>);

describe("SourceList", () => {
  it("sources 없으면 아무것도 렌더 안 함", () => {
    const { container } = wrap(<SourceList sources={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("출처 라벨을 i18n으로 표시", () => {
    wrap(<SourceList sources={[{ label: "source.kakao" }, { label: "source.airkorea" }]} />);
    expect(screen.getByText("출처")).toBeInTheDocument();
    expect(screen.getByText("카카오")).toBeInTheDocument();
    expect(screen.getByText("에어코리아")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- SourceList`
Expected: FAIL — "Cannot find module '../SourceList'"

- [ ] **Step 3: SourceList.tsx 구현**

`src/components/chat/SourceList.tsx`(미니멀 — 과잉 ARIA 없이 작은 헤딩 + 목록):

```tsx
"use client";
import { useTranslations } from "next-intl";
import type { SourceAttribution } from "@/lib/chat/types";

/**
 * 응답 하단 출처 푸터. label은 i18n 키(chat.<label>). url 있으면 링크.
 * 미니멀: 작은 텍스트 헤딩 + 목록(과잉 ARIA·region 없음).
 */
export function SourceList({ sources }: { sources?: SourceAttribution[] }) {
  const t = useTranslations("chat");
  if (!sources || sources.length === 0) return null;
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      <span className="font-medium">{t("sources")}</span>{" "}
      {sources.map((s, i) => (
        <span key={s.label}>
          {i > 0 && ", "}
          {s.url ? (
            <a href={s.url} className="underline" target="_blank" rel="noreferrer">
              {t(s.label)}
            </a>
          ) : (
            t(s.label)
          )}
        </span>
      ))}
    </p>
  );
}
```

> `text-muted-foreground`가 토큰에 없으면 기존 컴포넌트가 쓰는 muted 토큰(예: `text-foreground/60`)으로 교체 — Task 사전 grep으로 확인.

- [ ] **Step 4: MessageBubble에 SourceList 연결**

`src/components/chat/MessageBubble.tsx` import 추가 + renders 아래 렌더:

```tsx
import { SourceList } from "./SourceList";
...
      {message.renders?.map((render, i) => (
        <RenderBlock key={i} render={render} onOpenPlace={onOpenPlace} />
      ))}
      {!isUser && <SourceList sources={message.sources} />}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm run test:run -- SourceList`
Expected: PASS (2 tests)

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(chat): 응답 하단 출처 푸터 SourceList

i18n 라벨로 데이터 제공처 표시(url 있으면 링크). 미니멀 — 과잉 ARIA 없이
작은 텍스트 목록. MessageBubble이 어시스턴트 메시지에만 렌더.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FLiTRTi2TUVPqf2J544Kvp" \
  -- src/components/chat/SourceList.tsx src/components/chat/MessageBubble.tsx \
     src/components/chat/__tests__/SourceList.test.tsx
```

---

## Task 6: i18n 메시지 (5개 언어)

진행 통지·출처 헤딩·13개 도구 라벨·13개 제공처 라벨을 5개 언어에 추가.

**Files:**
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json`
- Test: 기존 `src/lib/__tests__/i18n-messages.test.ts`(키 정합 게이트)

**Interfaces:**
- Consumes: 없음. Produces: `chat.progress.searching`, `chat.progress.tool.<13>`, `chat.sources`, `chat.source.<13>` 키.

- [ ] **Step 1: ko.json의 chat 객체에 키 추가**

`messages/ko.json`의 `chat` 객체에 병합(기존 키 보존):

```json
"progress": {
  "searching": "{tools} 조회 중",
  "tool": {
    "search_places": "장소", "search_address": "주소",
    "get_subway_arrivals": "지하철 도착", "get_night_clinics": "야간 진료",
    "get_kids_places": "아이 놀 곳", "get_surroundings": "주변",
    "get_bus_arrivals": "버스 도착", "get_bike_stations": "따릉이",
    "get_air_quality": "공기질", "get_station_meta": "역 정보",
    "get_station_facilities": "역 편의시설", "get_car_route": "자동차 경로",
    "get_transit_route": "대중교통 경로"
  }
},
"sources": "출처",
"source": {
  "kakao": "카카오", "tourapi": "한국관광공사 TourAPI", "juso": "행정안전부 도로명주소",
  "seoulopen": "서울 열린데이터광장", "airkorea": "에어코리아", "kma": "기상청",
  "tago": "국토교통부 TAGO", "nmc": "국립중앙의료원", "kakaomobility": "카카오모빌리티",
  "ncp": "네이버 클라우드 플랫폼", "odsay": "ODsay", "kric": "국가철도공단",
  "korail": "한국철도공사", "seoulmetro": "서울교통공사"
}
```

- [ ] **Step 2: en/es/fr/it에 동일 키 구조로 번역 추가**

각 `messages/<lang>.json`의 `chat`에 같은 키를 해당 언어로(제공처 고유명은 영문 음역 또는 원문 유지). 예 en:

```json
"progress": { "searching": "Looking up {tools}", "tool": { "search_places": "places", "search_address": "address", "get_subway_arrivals": "subway arrivals", "get_night_clinics": "night clinics", "get_kids_places": "kids places", "get_surroundings": "surroundings", "get_bus_arrivals": "bus arrivals", "get_bike_stations": "bike stations", "get_air_quality": "air quality", "get_station_meta": "station info", "get_station_facilities": "station facilities", "get_car_route": "driving route", "get_transit_route": "transit route" } },
"sources": "Sources",
"source": { "kakao": "Kakao", "tourapi": "Korea Tourism TourAPI", "juso": "MOIS Road Name Address", "seoulopen": "Seoul Open Data Plaza", "airkorea": "AirKorea", "kma": "Korea Meteorological Administration", "tago": "MOLIT TAGO", "nmc": "National Medical Center", "kakaomobility": "Kakao Mobility", "ncp": "Naver Cloud Platform", "odsay": "ODsay", "kric": "Korea National Railway", "korail": "Korail", "seoulmetro": "Seoul Metro" }
```

(es·fr·it도 progress 라벨은 해당 언어 번역, source 고유명은 en과 동일하게 두거나 현지 표기.)

- [ ] **Step 3: i18n 키 정합 테스트 통과 확인**

Run: `npm run test:run -- i18n-messages`
Expected: PASS — 5개 언어 키 집합·ICU 플레이스홀더(`{tools}`) 동일.

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(chat): 진행 통지·출처 i18n 5개 언어

chat.progress(도구별 진행 라벨)·chat.sources·chat.source(13개 제공처)를
ko/en/es/fr/it에 추가. i18n 키 정합 게이트 통과.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FLiTRTi2TUVPqf2J544Kvp" \
  -- messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json
```

---

## Task 7: 실호출 머지 게이트 + 정리

dev 서버에서 에이전틱 동작을 실호출로 검증하고(node-env 테스트 레인이 없는 컴포넌트 와이어링 보강), 빌드·린트 최종 확인.

**Files:**
- 변경 없음(검증). 필요 시 미세 수정.

- [ ] **Step 1: dev 서버 기동**

Run: `npm run dev` (백그라운드). `http://localhost:3000/ko` 접속.

- [ ] **Step 2: 단일 도구 실호출**

채팅 모드 전환 → "길동 카페 알려줘" 전송.
Expected: 종합 산문(장소명 언급) + 장소 카드 + 하단 "출처 카카오". 빈 버블 아님.

- [ ] **Step 3: 연쇄 도구 실호출 (핵심 성과)**

"강남역 정보랑 거기 공기질 알려줘" 전송.
Expected: ≥2 도구 연쇄(station-meta + air-quality), 산문이 노선·공기질 등급을 실수치로 인용, 카드 2개 마운트, 출처에 국가철도공단·에어코리아.

curl 보조 검증:

```bash
curl -N -s http://localhost:3000/api/chat -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","text":"강남역 정보랑 공기질"}],"userLocation":{"lat":37.498,"lng":127.028},"locale":"ko"}'
```
Expected: NDJSON 줄들 — `{"type":"status",...}` ≥1회, 마지막 `{"type":"done","text":"...","renders":[...],"sources":[...]}`. text가 비어있지 않음.

- [ ] **Step 4: 실패 graceful 실호출**

위치 권한 없는 상태(userLocation 생략)로 "주변 지하철 도착" curl:

```bash
curl -N -s http://localhost:3000/api/chat -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","text":"주변 지하철 도착 알려줘"}],"locale":"ko"}'
```
Expected: done.text가 "위치를 알 수 없다"는 취지 안내(빈 버블·무응답 아님). 에러 502 아님.

- [ ] **Step 5: lint + build 최종**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 6: CLAUDE.md 채팅 섹션 갱신**

`gildongmu/CLAUDE.md`의 "채팅 인터페이스" 항목을 에이전틱 전환에 맞게 개정(2-pass→multi-turn 루프, 도구 실데이터 반환, NDJSON 스트리밍, 출처 블록, maxDuration=120). 옵션 C 설명을 "하이브리드: 산문 종합 + self-fetch 카드 + 출처"로 갱신. 실호출 검증 결과 1줄 기록.

- [ ] **Step 7: 최종 커밋**

```bash
git commit -m "docs(chat): 에이전틱 워크플로우 전환 CLAUDE.md 정본 반영 + 실호출 검증

multi-turn 루프·도구 실데이터·NDJSON 스트리밍·출처 블록 정본화. dev 실호출
검증(단일 장소·연쇄 강남역+공기질·위치없음 graceful).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FLiTRTi2TUVPqf2J544Kvp" \
  -- CLAUDE.md
```

- [ ] **Step 8: push (gildongmu 자동 commit+push 관례 — 자동배포 포함)**

```bash
git push
```
> Vercel 자동배포. 프로덕션 실호출은 배포 후 `gildongmu.vercel.app/api/chat`로 Step 3 curl 재실행(GEMINI 키는 프로덕션 등록 완료 상태).

---

## Self-Review

**1. Spec coverage:**
- §3 결정① 하이브리드 → Task 4(renders[]) + Task 5(SourceList) ✅
- §3 결정② 스트리밍+1회 낭독 → Task 4(NDJSON, status/done) + ChatInterface 별도 region ✅
- §3 결정③ 적극 연쇄 → Task 3(maxIterations=6) + Task 4 systemInstruction ✅
- §3 결정④ 출처 블록 → Task 1(sources) + Task 5(SourceList) + Task 6(i18n) ✅
- §4 불변식 I-1~I-5 → I-1/I-2 Task 3 테스트, I-3 Task 4(done 1회), I-4 Task 2(provider 직접), I-5 Task 2(dataLocale) ✅
- §5 데이터 계약 → Task 2(ToolResult), Task 4(ChatStreamEvent) ✅
- §6 라우터 13도구 → Task 2 전체 case 작성 ✅
- §11 테스트 게이트 → Task 1/2/3/4/5 단위 + Task 7 실호출 ✅

**2. Placeholder scan:** "TBD"/"적절히"/"위와 유사" 없음. 모든 코드 step에 실제 코드. i18n es/fr/it는 "해당 언어 번역"으로 위임하나 ko/en 전문 제공 + 키 구조 명시(번역은 기계적). ✅

**3. Type consistency:**
- `ToolResult.source`는 `SourceAttribution[]`(복수) — sources.ts `sourceFor` 반환(복수), router `source: src`, agent-loop `sources.push(...s.value.source)` 일관 ✅
- `ChatMessage.renders`(복수) — route done.renders, useChat, MessageBubble map 일관 ✅
- `runAgentLoop` 반환 `{text, renders, sources}` — route done 이벤트와 일치 ✅
- `findStationMeta`는 `@/lib/subway-stations`(provider 디렉터리 아님) — Task 2 Step 5 import 주의 명시 ✅
- 경로 provider `{origin, dest}` — router에서 `ctx.userLocation`을 origin으로 전달 ✅

이슈 없음.

# 무장애 여행 정보 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한국관광공사 무장애 여행 정보(KorWithService2)를 nearby·장소상세·채팅 도구 3계층으로 통합해, 시각장애·교통약자 사용자가 주변 접근가능 관광지와 그 무장애 편의시설을 확인할 수 있게 한다.

**Architecture:** 기존 provider 추상화·게이트 패턴을 그대로 따른다. `tour-barrier-free` provider(night-clinic 형제)가 KorWithService2를 호출하고, route handler 3종(`/api/places/barrier-free` nearby·detail·match)이 이를 노출한다. UI는 nearby 컴포넌트(KidsPlacesNearby 형제)·장소상세 자동 등장 region(StationMeta 형제)·채팅 도구(router+declarations) 셋. 무장애 필드는 "알려진 키 화이트리스트→한글 라벨, 빈 값 제외"로 철자 불확실성에 강건하게 처리하고, 활용신청 승인 후 실호출로 키를 확정한다.

**Tech Stack:** Next.js 16(App Router, route handlers), TypeScript, zod, Vitest(node env), next-intl 4. 외부: data.go.kr KorWithService2(serviceKey=`TOUR_API_KEY`).

## Global Constraints

- **게이트:** 모든 계층은 `hasDataGoKrKey()`로 게이트. 키 없으면 nearby route→`{places:[]}`, 상세 region→null, 채팅 declaration 미노출(死기능·회귀 0).
- **3-state 불변식:** 편의시설 필드는 값 있음(노출)/빈 값(숨김="시설 없음")/조회 실패(throw→502)를 절대 뭉개지 않는다. 비어있는 필드는 화면에 나열하지 않는다(미니멀).
- **좌표:** mapx=경도/mapy=위도 WGS84 십진. 빈결과는 `items:""` 또는 `items.item` 부재.
- **a11y(CLAUDE.md):** nearby 항목 이름 `<h4>`, 섹션 헤더 `<h3>`. 버튼으로 펼치는 패널은 `<div>`, 자동 등장 섹션만 `<section aria-labelledby>`+`useId`+`<h3 id>`. 터치 타깃 `min-h-11`, `:focus-visible`, 단일 polite live region. UI 라벨 이모지 금지. `disabled` 대신 `aria-disabled`+in-flight ref 가드. `<dl>` 금지(평문 `<p><span class="font-medium">라벨</span> 값</p>`).
- **데이터 언어:** KorWithService2는 ko 데이터만 — 영어 로케일도 한글 데이터 표시(`lang="ko"`), `dataLocale` 분기 불필요.
- **i18n:** 새 UI 텍스트 키는 ko/en/es/fr/it 5개 메시지 파일 모두에 추가(`i18n-messages.test.ts` 머지 게이트).
- **커밋:** `git add <의도 파일>` 후 같은 명령에서 commit(`git add -A` 금지). 이메일 `engccer@gmail.com`. 메시지 한국어 + Co-Authored-By/Claude-Session 푸터.
- **활용신청 선결조건:** 현재 `KorWithService2`는 HTTP 403(미승인). Task 1~5는 활용신청과 독립으로 구현·단위테스트(fixture)한다. **실호출 머지 게이트는 Task 6**(승인 후).

---

### Task 1: Provider — `tour-barrier-free.ts` + 단위테스트

**Files:**
- Create: `src/lib/providers/tour-barrier-free.ts`
- Modify: `src/lib/types.ts` (BarrierFreePlace, BarrierFreeDetail, BarrierFreeFacility 타입 추가)
- Test: `src/lib/__tests__/tour-barrier-free.test.ts`

**Interfaces:**
- Produces:
  - `searchBarrierFreeNearby(lat: number, lng: number, opts?: {radiusMeters?: number; limit?: number}): Promise<BarrierFreePlace[]>` — 위치기반 거리순 목록(거리 부여).
  - `getBarrierFreeDetail(contentId: string): Promise<BarrierFreeDetail | null>` — detailWithTour2 → 라벨링된 편의시설. 항목 없으면 null.
  - `matchBarrierFreePlace(args: {lat: number; lng: number; name: string}): Promise<BarrierFreeDetail | null>` — 좌표 50m ∩ 이름 일치 시에만 detail, 아니면 null.
  - `extractTourItems(raw: unknown): Record<string, unknown>[]`, `labelFacilities(item: Record<string, unknown>): BarrierFreeFacility[]` (테스트용 export).
  - `BARRIER_FREE_FIELD_LABELS: Record<string, string>` (화이트리스트 맵, export).
- types.ts:
  ```ts
  export interface BarrierFreePlace {
    contentId: string;
    name: string;
    category: string;       // contenttypeid 라벨(빈 문자열 허용)
    address: string;
    lat: number;
    lng: number;
    distanceMeters: number;
  }
  export interface BarrierFreeFacility {
    key: string;            // 원본 필드 키 (예: "wheelchair")
    label: string;          // 한글 라벨 (예: "휠체어 대여")
    value: string;          // 서술형 텍스트(비어있지 않음)
  }
  export interface BarrierFreeDetail {
    contentId: string;
    name: string;
    facilities: BarrierFreeFacility[];  // 값 있는 것만, 빈 배열 가능
  }
  ```

- [ ] **Step 1: 타입 추가**

`src/lib/types.ts` 끝에 위 Interfaces 블록의 3개 인터페이스를 추가한다.

- [ ] **Step 2: 실패 테스트 작성**

`src/lib/__tests__/tour-barrier-free.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  extractTourItems,
  labelFacilities,
  BARRIER_FREE_FIELD_LABELS,
} from "../providers/tour-barrier-free";

describe("extractTourItems", () => {
  it("빈결과 items:'' → 빈 배열", () => {
    const raw = { response: { body: { items: "" } } };
    expect(extractTourItems(raw)).toEqual([]);
  });
  it("단일 객체 item → 배열 1개로 정규화", () => {
    const raw = { response: { body: { items: { item: { contentid: "1" } } } } };
    expect(extractTourItems(raw)).toHaveLength(1);
  });
  it("배열 item → 그대로", () => {
    const raw = { response: { body: { items: { item: [{ contentid: "1" }, { contentid: "2" }] } } } };
    expect(extractTourItems(raw)).toHaveLength(2);
  });
});

describe("labelFacilities — 3-state(값 있는 키만)", () => {
  it("값 있는 화이트리스트 키만 라벨링, 빈 값·미상 키 제외", () => {
    const item = {
      wheelchair: "휠체어 대여 가능(1층 안내데스크)",
      restroom: "",                 // 빈 값 → 제외
      unknownfield: "어떤 값",      // 화이트리스트 밖 → 제외
      braileblock: "점자블록 설치", // 시각
    };
    const out = labelFacilities(item);
    const keys = out.map((f) => f.key);
    expect(keys).toContain("wheelchair");
    expect(keys).toContain("braileblock");
    expect(keys).not.toContain("restroom");
    expect(keys).not.toContain("unknownfield");
    expect(out.find((f) => f.key === "wheelchair")?.label).toBe(
      BARRIER_FREE_FIELD_LABELS["wheelchair"],
    );
  });
  it("모든 필드가 비면 빈 배열", () => {
    expect(labelFacilities({ wheelchair: "", restroom: "   " })).toEqual([]);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm run test:run -- tour-barrier-free`
Expected: FAIL ("does not provide an export named 'extractTourItems'")

- [ ] **Step 4: provider 구현**

`src/lib/providers/tour-barrier-free.ts` (night-clinic.ts의 extractItems/header/str/numF 패턴 + tour-api.ts의 엔드포인트·envelope 규약을 따른다):

```ts
import type { BarrierFreePlace, BarrierFreeDetail, BarrierFreeFacility } from "../types";
import { env } from "../env";
import { haversineMeters } from "../geo";

/**
 * 한국관광공사 무장애 여행 정보 provider — B551011/KorWithService2.
 *
 * 장애유형별 무장애 편의시설(휠체어·장애인화장실·점자블록·음성안내 등)을 제공.
 * tour-api.ts(KorService2)와 키·envelope·좌표 규약 동일(serviceKey=TOUR_API_KEY,
 * mapx=경도/mapy=위도, 빈결과 items:"").
 *
 * ⚠ 필드 철자는 활용신청 승인 후 실호출로 확정(Task 6) — 한국 공공 API는 철자가
 * 비표준(braile 단철자 등)이라, 화이트리스트 키 중 값이 비어있지 않은 것만 라벨링해
 * 철자 불확실성에 강건하게 둔다(틀린 키는 조용히 누락, 오정보 노출 없음).
 *
 * 3-state: 값 있음(노출)/빈 값(제외)/조회 실패(throw→502).
 */

const BASE = "https://apis.data.go.kr/B551011/KorWithService2";
const MAX_DISTANCE_METERS = 3000; // 관광지 — 도보권보다 넓게
const TOP_N = 8;
const MATCH_RADIUS_METERS = 50; // 장소 상세 매칭 — 좁게(false positive 차단)

/** 무장애 편의시설 필드 화이트리스트 → 한글 라벨. ⚠ Task 6에서 실응답으로 교정. */
export const BARRIER_FREE_FIELD_LABELS: Record<string, string> = {
  // 지체/공통
  wheelchair: "휠체어 대여",
  restroom: "장애인 화장실",
  elevator: "엘리베이터",
  parking: "장애인 주차장",
  route: "주출입구 접근로",
  exit: "출입문",
  publictransport: "대중교통",
  // 시각
  braileblock: "점자블록",
  audioguide: "음성안내",
  braileguide: "점자 안내책자",
  guidehuman: "안내요원",
  helpdog: "보조견 동반",
  bigprint: "큰글씨 자료",
  guidesystem: "음성안내 시스템",
  // 청각
  signguide: "수어 안내",
  videoguide: "자막 영상안내",
  hearinghandicapetc: "청각장애 편의(기타)",
  // 영유아
  lactationroom: "수유실",
  stroller: "유모차 대여",
  babysparechair: "유아용 의자",
};

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}
function numF(v: unknown): number {
  if (v == null || (typeof v === "string" && v.trim() === "")) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** data.go.kr JSON: items.item 은 단일 객체/배열/빈문자열. 안전 추출(night-clinic 동형). */
export function extractTourItems(raw: unknown): Record<string, unknown>[] {
  const items = (raw as { response?: { body?: { items?: unknown } } })?.response?.body?.items;
  if (!items || typeof items === "string") return [];
  const item = (items as { item?: unknown }).item;
  if (item == null) return [];
  return Array.isArray(item)
    ? (item as Record<string, unknown>[])
    : [item as Record<string, unknown>];
}

function resultCode(raw: unknown): string | null {
  const c = (raw as { response?: { header?: { resultCode?: unknown } } })?.response?.header
    ?.resultCode;
  return c != null ? String(c) : null;
}

/** 화이트리스트 키 중 값이 비어있지 않은 것만 → 라벨링된 편의시설 목록. */
export function labelFacilities(item: Record<string, unknown>): BarrierFreeFacility[] {
  const out: BarrierFreeFacility[] = [];
  for (const [key, label] of Object.entries(BARRIER_FREE_FIELD_LABELS)) {
    const value = str(item[key]);
    if (value) out.push({ key, label, value });
  }
  return out;
}

function normalizePlace(item: Record<string, unknown>, originLat: number, originLng: number): BarrierFreePlace | null {
  const lat = numF(item.mapy);
  const lng = numF(item.mapx);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = str(item.title);
  if (!name) return null;
  return {
    contentId: str(item.contentid),
    name,
    category: "", // contenttypeid 라벨은 Task 1 비범위(빈 문자열) — 필요 시 후속
    address: [str(item.addr1), str(item.addr2)].filter(Boolean).join(" "),
    lat,
    lng,
    distanceMeters: Math.round(haversineMeters(originLat, originLng, lat, lng)),
  };
}

async function callKorWith(operation: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${BASE}/${operation}`);
  url.searchParams.set("serviceKey", env.TOUR_API_KEY ?? "");
  url.searchParams.set("MobileOS", "WEB");
  url.searchParams.set("MobileApp", "gildongmu");
  url.searchParams.set("_type", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { next: { revalidate: 86_400 } });
  if (!res.ok) throw new Error(`무장애 여행 정보 조회 실패: HTTP ${res.status}`);
  const raw = await res.json();
  const code = resultCode(raw);
  if (code !== "0000") throw new Error(`무장애 여행 정보 비정상 응답: resultCode ${code}`);
  return raw;
}

/** 좌표 → 반경 내 무장애 관광지 상위 N(거리순). 키 없으면 빈 배열. */
export async function searchBarrierFreeNearby(
  lat: number,
  lng: number,
  opts: { radiusMeters?: number; limit?: number } = {},
): Promise<BarrierFreePlace[]> {
  if (!env.TOUR_API_KEY) return [];
  const radius = opts.radiusMeters ?? MAX_DISTANCE_METERS;
  const limit = opts.limit ?? TOP_N;
  const raw = await callKorWith("locationBasedList2", {
    mapX: String(lng),
    mapY: String(lat),
    radius: String(radius),
    arrange: "E", // 거리순
    numOfRows: String(limit),
  });
  return extractTourItems(raw)
    .map((it) => normalizePlace(it, lat, lng))
    .filter((p): p is BarrierFreePlace => p !== null)
    .sort((a, b) => a.distanceMeters - b.distanceMeters) // dist 신뢰 대신 코드 정렬
    .slice(0, limit);
}

/** contentId → 무장애 편의시설 상세(값 있는 항목만). 항목 자체가 없으면 null. */
export async function getBarrierFreeDetail(contentId: string): Promise<BarrierFreeDetail | null> {
  if (!env.TOUR_API_KEY || !contentId) return null;
  const raw = await callKorWith("detailWithTour2", { contentId });
  const items = extractTourItems(raw);
  if (items.length === 0) return null;
  const item = items[0];
  return {
    contentId,
    name: str(item.title),
    facilities: labelFacilities(item),
  };
}

/** 좌표 50m ∩ 이름 일치 시에만 detail. false positive 차단. 매칭 실패 null. */
export async function matchBarrierFreePlace(args: {
  lat: number;
  lng: number;
  name: string;
}): Promise<BarrierFreeDetail | null> {
  if (!env.TOUR_API_KEY) return null;
  const near = await searchBarrierFreeNearby(args.lat, args.lng, {
    radiusMeters: MATCH_RADIUS_METERS,
    limit: 10,
  });
  const target = normalizeName(args.name);
  const matched = near.find((p) => normalizeName(p.name) === target);
  if (!matched) return null;
  return getBarrierFreeDetail(matched.contentId);
}

/** 공백·괄호·흔한 지점 접미 제거 후 비교(보수적 동일성). */
export function normalizeName(name: string): string {
  return name
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, "")
    .replace(/(본점|점|지점)$/u, "")
    .toLowerCase();
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm run test:run -- tour-barrier-free`
Expected: PASS (5 tests)

- [ ] **Step 6: 매칭 단위테스트 추가**

같은 테스트 파일에 `normalizeName` 케이스 추가:

```ts
import { normalizeName } from "../providers/tour-barrier-free";

describe("normalizeName — 보수적 동일성", () => {
  it("괄호·공백·지점 접미 제거", () => {
    expect(normalizeName("국립중앙박물관 (용산)")).toBe("국립중앙박물관");
    expect(normalizeName("스타벅스 강남본점")).toBe("스타벅스 강남".replace(/\s+/g, ""));
  });
  it("다른 이름은 다른 정규화", () => {
    expect(normalizeName("경복궁")).not.toBe(normalizeName("덕수궁"));
  });
});
```

Run: `npm run test:run -- tour-barrier-free` → PASS

- [ ] **Step 7: lint + commit**

```bash
npm run lint
git add src/lib/providers/tour-barrier-free.ts src/lib/types.ts src/lib/__tests__/tour-barrier-free.test.ts
git commit -m "feat(barrier-free): KorWithService2 provider — nearby·detail·match + 화이트리스트 라벨링

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011PJuVK3b6C6oTC7xnGYuYL" -- src/lib/providers/tour-barrier-free.ts src/lib/types.ts src/lib/__tests__/tour-barrier-free.test.ts
```

---

### Task 2: Route handlers — nearby · detail · match

**Files:**
- Create: `src/app/api/places/barrier-free/route.ts` (nearby)
- Create: `src/app/api/places/barrier-free/detail/route.ts` (펼침용 contentId 상세)
- Create: `src/app/api/places/barrier-free/match/route.ts` (장소상세 매칭)
- Test: `src/lib/__tests__/tour-barrier-free.test.ts` (provider 테스트로 충분 — route는 얇은 어댑터, 별도 테스트 없이 lint+build 게이트)

**Interfaces:**
- Consumes: `searchBarrierFreeNearby`, `getBarrierFreeDetail`, `matchBarrierFreePlace`, `hasDataGoKrKey`.
- Produces (HTTP):
  - `GET /api/places/barrier-free?lat&lng` → `{ places: BarrierFreePlace[] }` (키 없음/403 안전 → `{places:[]}`, 장애 → 502)
  - `GET /api/places/barrier-free/detail?contentId` → `{ detail: BarrierFreeDetail | null }`
  - `GET /api/places/barrier-free/match?lat&lng&name` → `{ detail: BarrierFreeDetail | null }`

- [ ] **Step 1: nearby route 작성**

`src/app/api/places/barrier-free/route.ts` (clinic/nearby/route.ts 패턴):

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDataGoKrKey } from "@/lib/env";
import { searchBarrierFreeNearby } from "@/lib/providers/tour-barrier-free";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lat: z.coerce.number().min(33).max(43),
  lng: z.coerce.number().min(124).max(132),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    lat: request.nextUrl.searchParams.get("lat") ?? "",
    lng: request.nextUrl.searchParams.get("lng") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }
  if (!hasDataGoKrKey()) return NextResponse.json({ places: [] });
  try {
    const places = await searchBarrierFreeNearby(parsed.data.lat, parsed.data.lng);
    return NextResponse.json({ places });
  } catch (e) {
    console.error("[api/places/barrier-free]", e);
    return NextResponse.json({ error: "무장애 여행 정보 조회 실패" }, { status: 502 });
  }
}
```

- [ ] **Step 2: detail route 작성**

`src/app/api/places/barrier-free/detail/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDataGoKrKey } from "@/lib/env";
import { getBarrierFreeDetail } from "@/lib/providers/tour-barrier-free";

const querySchema = z.object({ contentId: z.string().min(1) });

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    contentId: request.nextUrl.searchParams.get("contentId") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "contentId가 필요합니다." }, { status: 400 });
  }
  if (!hasDataGoKrKey()) return NextResponse.json({ detail: null });
  try {
    const detail = await getBarrierFreeDetail(parsed.data.contentId);
    return NextResponse.json({ detail });
  } catch (e) {
    console.error("[api/places/barrier-free/detail]", e);
    return NextResponse.json({ error: "무장애 편의시설 조회 실패" }, { status: 502 });
  }
}
```

- [ ] **Step 3: match route 작성**

`src/app/api/places/barrier-free/match/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDataGoKrKey } from "@/lib/env";
import { matchBarrierFreePlace } from "@/lib/providers/tour-barrier-free";

const querySchema = z.object({
  lat: z.coerce.number().min(33).max(43),
  lng: z.coerce.number().min(124).max(132),
  name: z.string().min(1),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    lat: request.nextUrl.searchParams.get("lat") ?? "",
    lng: request.nextUrl.searchParams.get("lng") ?? "",
    name: request.nextUrl.searchParams.get("name") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ detail: null }); // 매칭 보조 — 잘못된 입력도 조용히 null
  }
  if (!hasDataGoKrKey()) return NextResponse.json({ detail: null });
  try {
    const detail = await matchBarrierFreePlace(parsed.data);
    return NextResponse.json({ detail });
  } catch (e) {
    console.error("[api/places/barrier-free/match]", e);
    return NextResponse.json({ detail: null }); // 매칭 실패는 미노출(throw 아님)
  }
}
```

- [ ] **Step 4: build 확인 + commit**

```bash
npm run build
git add src/app/api/places/barrier-free/
git commit -m "feat(barrier-free): nearby·detail·match route handler 3종

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011PJuVK3b6C6oTC7xnGYuYL" -- src/app/api/places/barrier-free/
```

Expected: build 성공(타입·라우트 등록 확인).

---

### Task 3: nearby UI — `BarrierFreeNearby.tsx` + 홈 마운트 + i18n

**Files:**
- Create: `src/components/BarrierFreeNearby.tsx`
- Modify: 홈 nearby 묶음 컴포넌트 (KidsPlacesNearby/NightClinicsNearby가 마운트된 파일 — `grep -rln "NightClinicsNearby" src/app src/components`로 찾아 같은 자리에 추가)
- Modify: `messages/ko.json` `en.json` `es.json` `fr.json` `it.json` (`barrierFreeNearby` 네임스페이스)
- Test: `src/lib/__tests__/i18n-messages.test.ts` (기존 게이트가 5개 파일 키 일치 검증 — 자동)

**Interfaces:**
- Consumes: `GET /api/places/barrier-free`, `awaitGeolocation`, `useNearbyPanel`, `BarrierFreePlace`, `GET /api/places/barrier-free/detail`.
- Produces: `<BarrierFreeNearby />` (홈 nearby 묶음용), `<BarrierFreeNearby autoLoad />` (채팅 카드용 — Task 5에서 사용).

- [ ] **Step 1: i18n 키 추가 (5개 파일 동일 구조)**

각 `messages/<locale>.json`에 `barrierFreeNearby` 네임스페이스 추가. ko 예시(en/es/fr/it는 해당 언어로 번역, 데이터는 한글 유지):

```json
"barrierFreeNearby": {
  "button": "내 주변 무장애 관광지",
  "refresh": "새로고침",
  "locating": "위치 확인 중…",
  "loading": "무장애 관광지를 찾는 중…",
  "ready": "내 주변 무장애 관광지",
  "empty": "주변에 등록된 무장애 관광지가 없습니다.",
  "error": "무장애 관광지 정보를 불러오지 못했습니다.",
  "geoDenied": "위치 권한이 거부되었습니다.",
  "geoUnsupported": "이 기기에서 위치를 사용할 수 없습니다.",
  "asOf": "{time} 기준",
  "distance": "{distance}",
  "showFacilities": "무장애 편의시설 보기",
  "hideFacilities": "편의시설 접기",
  "facilitiesLoading": "편의시설 불러오는 중…",
  "facilitiesEmpty": "등록된 무장애 편의시설 정보가 없습니다.",
  "source": "출처: 한국관광공사 무장애 여행 정보"
}
```

- [ ] **Step 2: i18n 게이트 통과 확인**

Run: `npm run test:run -- i18n-messages`
Expected: PASS (5개 파일 키 일치).

- [ ] **Step 3: BarrierFreeNearby 컴포넌트 작성**

`src/components/BarrierFreeNearby.tsx` — KidsPlacesNearby.tsx 패턴(awaitGeolocation·useNearbyPanel·in-flight ref·status 머신·done에서 헤딩 포커스). 차이: 각 항목에 **편의시설 펼침(disclosure)** — 버튼으로 `/api/places/barrier-free/detail?contentId` lazy fetch. `autoLoad` prop(채팅 카드용): true면 마운트 시 `load()` 자동 호출(버튼 없이). 항목 이름 `<h4>`, 펼침 패널은 `<div>`(버튼이 발견경로). 편의시설은 평문 `<p><span class="font-medium">{label}</span> {value}</p>`(콜론·dl 금지), `lang="ko"`. 펼친 편의시설 상세는 컴포넌트 상태에 contentId별 캐시.

(전체 구현은 KidsPlacesNearby.tsx를 복제해 다음을 적용: fetch URL `/api/places/barrier-free`, 응답 키 `places`, 항목 타입 `BarrierFreePlace`, 항목 렌더에서 전화·링크 대신 "무장애 편의시설 보기" 토글 버튼 + 펼침 시 detail fetch→facilities 목록. `canShowChat`/usePlaceChat 부분은 무장애 nearby엔 불필요하면 생략 — 미니멀. `autoLoad`면 `useEffect(() => { load(); }, [])`로 자동 로드하고 닫기 버튼 숨김.)

- [ ] **Step 4: 홈에 마운트**

`grep -rln "NightClinicsNearby" src/app src/components`로 홈 nearby 묶음 파일을 찾아, NightClinicsNearby 옆에 `<BarrierFreeNearby />`를 추가한다(접근성 직결 기능이므로 묶음 상단 가까이).

- [ ] **Step 5: build + 수동 확인 + commit**

```bash
npm run build
```
Expected: 빌드 성공. (실데이터는 활용신청 후 Task 6에서 확인 — 지금은 키 없음/403이면 빈 섹션.)

```bash
git add src/components/BarrierFreeNearby.tsx messages/ <홈 마운트 파일>
git commit -m "feat(barrier-free): 내 주변 무장애 관광지 nearby + 편의시설 펼침 + i18n 5종

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011PJuVK3b6C6oTC7xnGYuYL" -- src/components/BarrierFreeNearby.tsx messages/ <홈 마운트 파일>
```

---

### Task 4: 장소 상세 자동 등장 region — `BarrierFreeInfo.tsx`

**Files:**
- Create: `src/components/BarrierFreeInfo.tsx`
- Modify: `src/components/PlaceDetail.tsx` (StationMeta 마운트 부근에 추가)
- Modify: `messages/*.json` (`barrierFreeInfo` 네임스페이스, 5개)
- Test: i18n 게이트(자동)

**Interfaces:**
- Consumes: `GET /api/places/barrier-free/match?lat&lng&name`, `BarrierFreeDetail`, `hasDataGoKrKey`(상위 prop으로 게이트).
- Produces: `<BarrierFreeInfo lat name lng canShow />` — 매칭 성공 시 region, 실패 null.

- [ ] **Step 1: i18n 키 추가 (5개 파일)**

ko 예시:
```json
"barrierFreeInfo": {
  "heading": "무장애 편의시설",
  "source": "출처: 한국관광공사 무장애 여행 정보"
}
```

- [ ] **Step 2: i18n 게이트 통과**

Run: `npm run test:run -- i18n-messages` → PASS

- [ ] **Step 3: BarrierFreeInfo 작성**

`src/components/BarrierFreeInfo.tsx` — StationMeta.tsx 패턴(useEffect 자동 fetch, AbortController, active 가드, 매칭 실패/에러는 null 렌더, 자동 등장 region `<section aria-labelledby={useId}>`+`<h3 id>`):

```tsx
"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { BarrierFreeDetail } from "@/lib/types";

/**
 * 장소 상세 무장애 편의시설(자동 등장 region) — StationMeta 동형.
 * 좌표+이름 교차검증(서버 match)이 성공할 때만 표시. 매칭 실패·에러·시설 0건은
 * 조용히 숨김(null) — 틀린 무장애 정보가 정보 없음보다 위험(false positive 차단).
 * 버튼 없이 조용히 나타나므로 region 랜드마크가 유일한 발견 경로.
 */
export function BarrierFreeInfo({
  lat,
  lng,
  name,
  canShow,
}: {
  lat: number;
  lng: number;
  name: string;
  canShow: boolean;
}) {
  const t = useTranslations("barrierFreeInfo");
  const [detail, setDetail] = useState<BarrierFreeDetail | null>(null);
  const headingId = useId();

  useEffect(() => {
    if (!canShow) return;
    const controller = new AbortController();
    let active = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/places/barrier-free/match?lat=${lat}&lng=${lng}&name=${encodeURIComponent(name)}`,
          { signal: controller.signal },
        );
        if (!active) return;
        if (!res.ok) return setDetail(null);
        const body = await res.json();
        // 시설 0건도 숨김 — 무장애 관광지로 매칭됐어도 표시할 항목이 없으면 노이즈.
        const d = body.detail as BarrierFreeDetail | null;
        setDetail(d && d.facilities.length > 0 ? d : null);
      } catch {
        if (active) setDetail(null);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [lat, lng, name, canShow]);

  if (!detail) return null;

  return (
    <section aria-labelledby={headingId} className="mt-3 rounded-md border border-border p-3">
      <h3 id={headingId} className="text-base font-semibold">
        {t("heading")}
      </h3>
      <div className="mt-1 space-y-1 text-sm leading-relaxed">
        {detail.facilities.map((f) => (
          <p key={f.key}>
            <span className="font-medium">{f.label}</span>{" "}
            <span lang="ko">{f.value}</span>
          </p>
        ))}
      </div>
      <p className="mt-2 text-xs opacity-70">{t("source")}</p>
    </section>
  );
}
```

- [ ] **Step 4: PlaceDetail에 마운트**

`src/components/PlaceDetail.tsx`에서 `{canShowAir && <LocalConditions .../>}` 부근에 추가(canShow는 PlaceDetail이 받는 데이터고킬 게이트 prop을 따른다 — LocalConditions의 `canShowAir`와 동형으로 상위에서 `hasDataGoKrKey()` 주입):

```tsx
import { BarrierFreeInfo } from "./BarrierFreeInfo";
// ... LocalConditions 라인 근처:
<BarrierFreeInfo lat={place.lat} lng={place.lng} name={place.name} canShow={canShowBarrierFree} />
```

`canShowBarrierFree` prop을 PlaceDetail의 props에 추가하고, PlaceDetail을 렌더하는 상위(검색 결과 상세 진입부)에서 `hasDataGoKrKey()` 결과를 주입한다(canShowAir와 같은 경로 — 그 prop이 어디서 오는지 따라가 동일 위치에 추가).

- [ ] **Step 5: build + commit**

```bash
npm run build
git add src/components/BarrierFreeInfo.tsx src/components/PlaceDetail.tsx messages/
git commit -m "feat(barrier-free): 장소 상세 무장애 편의시설 자동 등장 region(좌표+이름 매칭)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011PJuVK3b6C6oTC7xnGYuYL" -- src/components/BarrierFreeInfo.tsx src/components/PlaceDetail.tsx messages/
```

(상위 prop 경로에 따라 추가 파일이 stage될 수 있음 — `git status`로 확인 후 의도 파일만.)

---

### Task 5: 채팅 도구 — `get_nearby_barrier_free`

**Files:**
- Modify: `src/lib/chat/declarations.ts` (declaration + gate 추가)
- Modify: `src/lib/chat/router.ts` (case 추가)
- Modify: `src/lib/chat/render.ts` 또는 `types.ts` (render union에 `barrier-free-nearby` 추가 — 기존 `clinics-nearby` 정의 위치를 따라감)
- Modify: `src/components/chat/MessageBubble.tsx` (render dispatch case 추가)
- Modify: `src/lib/chat/sources.ts` (도구명→출처 매핑)
- Test: `src/lib/chat/__tests__/declarations.test.ts` (게이트 동작 — 기존 테스트 패턴 따라 추가)

**Interfaces:**
- Consumes: `searchBarrierFreeNearby`, `anchorOf`, `hasDataGoKrKey`, `<BarrierFreeNearby autoLoad />`.
- Produces: 도구 `get_nearby_barrier_free`. 총 도구 14→15.

- [ ] **Step 1: declaration 추가**

`src/lib/chat/declarations.ts`의 `DECLARATIONS` 배열에 추가(get_night_clinics 패턴):

```ts
{
  gate: hasDataGoKrKey,
  declaration: {
    name: "get_nearby_barrier_free",
    description:
      "현재 위치(또는 보고 있는 장소) 주변의 무장애 관광지(휠체어·점자블록·음성안내 등 장애인 편의시설을 갖춘 곳)를 보여준다.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
},
```

- [ ] **Step 2: router case 추가**

`src/lib/chat/router.ts`의 switch에 추가(get_night_clinics 패턴 — 장소 앵커 시 render 생략, 산문 정본):

```ts
case "get_nearby_barrier_free": {
  const anchor = anchorOf(ctx);
  if (!anchor) return { data: NO_LOCATION };
  const places = await searchBarrierFreeNearby(anchor.lat, anchor.lng);
  const render = ctx.placeAnchor ? undefined : ({ type: "barrier-free-nearby" } as const);
  return { data: { count: places.length, places: places.slice(0, 8) }, render, source: src };
}
```

import 추가: `import { searchBarrierFreeNearby } from "@/lib/providers/tour-barrier-free";`

- [ ] **Step 3: render union + 출처 + dispatch**

- `clinics-nearby`가 정의된 render union 타입에 `| { type: "barrier-free-nearby" }` 추가(파일은 `grep -rn "clinics-nearby" src/lib src/components`로 확인).
- `src/lib/chat/sources.ts`에서 `get_night_clinics` 출처 매핑 옆에 `get_nearby_barrier_free` → "한국관광공사 무장애 여행 정보" 추가.
- `src/components/chat/MessageBubble.tsx`의 render dispatch에 추가:
  ```tsx
  case "barrier-free-nearby":
    return <BarrierFreeNearby autoLoad />;
  ```
  import: `import { BarrierFreeNearby } from "../BarrierFreeNearby";`

- [ ] **Step 4: 게이트 테스트 추가**

`src/lib/chat/__tests__/declarations.test.ts`에 `get_nearby_barrier_free`가 `hasDataGoKrKey` 게이트를 따르는지 기존 테스트 패턴대로 1케이스 추가.

Run: `npm run test:run -- declarations` → PASS

- [ ] **Step 5: build + commit**

```bash
npm run build
git add src/lib/chat/ src/components/chat/MessageBubble.tsx
git commit -m "feat(barrier-free): 채팅 도구 get_nearby_barrier_free(장소 앵커 불변식·게이트)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011PJuVK3b6C6oTC7xnGYuYL" -- src/lib/chat/ src/components/chat/MessageBubble.tsx
```

---

### Task 6: 실호출 머지 게이트 (활용신청 승인 후) — 필드 확정 + fixture 갱신

> ⚠ **선결조건:** 사용자가 https://www.data.go.kr/data/15101897/openapi.do 에서 무장애 여행 정보 활용신청 → 승인(게이트웨이 전파 수 분~1시간). 승인 전엔 이 Task 보류(Task 1~5는 독립 완료).

**Files:**
- Modify: `src/lib/providers/tour-barrier-free.ts` (`BARRIER_FREE_FIELD_LABELS` 키 철자 교정)
- Modify: `src/lib/__tests__/tour-barrier-free.test.ts` (실응답 fixture로 갱신)

- [ ] **Step 1: locationBasedList2 실호출 — 무장애 관광지 contentId 획득**

```bash
KEY=$(grep -E '^TOUR_API_KEY=' .env.local | cut -d= -f2-)
curl -s "https://apis.data.go.kr/B551011/KorWithService2/locationBasedList2?serviceKey=${KEY}&MobileOS=WEB&MobileApp=gildongmu&_type=json&mapX=126.9779&mapY=37.5663&radius=3000&arrange=E&numOfRows=5" | python3 -m json.tool | head -60
```
Expected: HTTP 200, `resultCode:"0000"`, item 배열에 `contentid`·`title`·`mapx`·`mapy`. (403이면 활용신청 미승인/미전파 — 대기.)

- [ ] **Step 2: detailWithTour2 실호출 — 실제 무장애 필드 키 확정**

위에서 얻은 contentId로:
```bash
curl -s "https://apis.data.go.kr/B551011/KorWithService2/detailWithTour2?serviceKey=${KEY}&MobileOS=WEB&MobileApp=gildongmu&_type=json&contentId=<CONTENT_ID>" | python3 -m json.tool
```
Expected: 무장애 편의시설 필드. **응답에 실제로 오는 키 이름을 기록**(예: `wheelchair`인지 `wheelchairn`인지, `braileblock`인지 `brailleblock`인지).

- [ ] **Step 3: 화이트리스트 맵 교정**

Step 2 실응답 키에 맞춰 `BARRIER_FREE_FIELD_LABELS`의 키 철자를 교정한다(틀린 키는 라벨링에서 누락됐을 것 — 실키로 교체). 실응답에만 있는 추가 무장애 필드가 있으면 라벨과 함께 추가.

- [ ] **Step 4: fixture 갱신**

Step 1·2 실응답을 축약해 테스트 fixture로 박는다(실 키 포함). `labelFacilities` 테스트가 실제 키로 통과하는지 확인.

Run: `npm run test:run -- tour-barrier-free` → PASS

- [ ] **Step 5: nearby·상세·채팅 실동작 확인**

`npm run dev` → 홈 "내 주변 무장애 관광지" 버튼 → 실데이터 목록·펼침 편의시설 확인. 무장애 관광지(예: 국립중앙박물관)를 검색→상세에서 무장애 region 노출 확인. 채팅에서 "주변 무장애 관광지" 질의 확인.

- [ ] **Step 6: 최종 검토 + commit + push**

a11y-auditor 서브에이전트 점검(새 UI 3개). lint+test+build 통과 후:

```bash
git add src/lib/providers/tour-barrier-free.ts src/lib/__tests__/tour-barrier-free.test.ts
git commit -m "fix(barrier-free): 실호출로 detailWithTour2 필드 철자 확정 + fixture 갱신(머지 게이트)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011PJuVK3b6C6oTC7xnGYuYL" -- src/lib/providers/tour-barrier-free.ts src/lib/__tests__/tour-barrier-free.test.ts
git push
```

push하면 Vercel 자동배포(env에 활용신청 승인된 키 반영 확인 — 프로덕션 키도 같은 TOUR_API_KEY).

---

## Self-Review

**Spec coverage:**
- §4 Provider → Task 1 ✓ (3 함수 + 화이트리스트 + 3-state)
- §5 nearby → Task 3 ✓ (route Task 2, UI Task 3, N+1 회피=펼침 lazy)
- §6 장소 상세 region → Task 4 ✓ (좌표+이름 매칭, 자동 등장 region, false positive 차단)
- §7 채팅 도구 → Task 5 ✓ (장소 앵커 불변식, 게이트, 출처)
- §8 테스트 → Task 1·6 ✓ (단위 fixture + 실호출 머지 게이트)
- §2 활용신청 선결조건 → Task 6 게이트로 분리 ✓

**Placeholder scan:** Task 3 Step 3은 "KidsPlacesNearby 복제+차이 적용"으로 전체 코드 대신 변형 지시 — 참조 파일이 명확하고 차이가 구체적이라 허용(BarrierFreeInfo·provider는 전체 코드 제공). `<홈 마운트 파일>`은 grep 명령으로 특정하도록 지시(런타임 확인 필요한 경로).

**Type consistency:** `BarrierFreePlace`/`BarrierFreeDetail`/`BarrierFreeFacility`는 Task 1에서 정의, Task 2~5에서 동일 사용. 함수명 `searchBarrierFreeNearby`/`getBarrierFreeDetail`/`matchBarrierFreePlace`/`normalizeName`/`labelFacilities`/`extractTourItems` 전 Task 일관. render type `barrier-free-nearby` Task 5 내 일관.

**미해결(의도):** 무장애 필드 철자는 Task 6 실호출까지 추정 — 화이트리스트 방식이라 틀린 키는 조용히 누락(오정보 없음), Task 6에서 확정. 이것이 spec §8의 실호출 머지 게이트.

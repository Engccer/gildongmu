# ODsay 대중교통 길찾기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 출발지→도착지 대중교통(버스+지하철 환승) 경로를 텍스트로 "출발 전 미리 듣기" 하는 기능을 ODsay API로 구현한다.

**Architecture:** 기존 자동차 브리핑(`CarRouteBriefing`)과 동형. 클라이언트(`TransitRouteBriefing`) → `/api/route/transit` → `providers/odsay.ts`(순수 정규화) → `api.odsay.com`. ODsay의 `path/subPath` 응답을 길동무 자체 `TransitRoute` shape로 정규화해 ODsay 종속을 provider 안에 격리한다.

**Tech Stack:** Next.js 16 App Router, TypeScript, zod 4, next-intl 4, Vitest 4. ODsay 대중교통 길찾기 API.

## Global Constraints

- 커밋 이메일 `engccer@gmail.com`. 코드 주석·커밋 메시지·문서 한국어, 변수/함수명 영어.
- `src/lib/`는 React/Next 비의존(이식성). 기능·버그픽스는 같은 커밋에 테스트 동반.
- 좌표는 WGS84 십진 도(lat/lng). route 좌표 파라미터는 "위도,경도" 순서(기존 도메인 표준).
- 실데이터 원칙: mock 폴백 없음. 키 없음→기능 미노출, upstream 장애→502, 경로 없음→graceful 빈 결과(502 아님).
- 미니멀 접근성(First Rule of ARIA): 키보드·이름·포커스·대비·단일 polite live region. 불필요 ARIA 금지. 터치 44px. en 고유명 `lang="ko"`.
- 설계 계약: `docs/superpowers/specs/2026-06-18-odsay-transit-routing-design.md`.
- **⚠ ODsay `apiKey`는 URL 인코딩된 값을 재인코딩하면 깨진다** — `URLSearchParams`/`url.searchParams.set`이 자동 인코딩하므로, **이미 인코딩된 키라면 raw 문자열로 쿼리에 붙인다**(Task 3 참조). data.go.kr serviceKey와 동일 함정.
- **⚠ ODsay 응답 필드명·단위·에러코드는 pre-merge 실호출(Task 8)로 확정한다.** 아래 fixture는 ODsay 문서 기반 best-effort이며, Task 8에서 실응답으로 교정한 뒤 머지한다(fixture green ≠ 실계약).

## 전제조건 (사용자 작업 — 구현 시작 전/Task 8 전까지 완료)

ODsay [lab.odsay.com](https://lab.odsay.com) 회원가입 → 애플리케이션 등록 → `apiKey` 발급(개인/5인 이하, 6개월 무료, 1,000회/일) → `.env.local`에 `ODSAY_API_KEY=<발급키>` 추가. Task 1~7(순수 로직·UI)은 키 없이 진행 가능, Task 8(실호출 검증)만 키 필요.

## 파일 구조

| 파일 | 책임 |
|------|------|
| `src/lib/env.ts` (수정) | `ODSAY_API_KEY` 스키마 + `hasOdsayKey()` |
| `src/lib/types.ts` (수정) | `TransitLeg`·`TransitRoute`·`TransitRouteResult` |
| `src/lib/providers/odsay.ts` (생성) | `normalizeOdsayRoute`(순수) + `getTransitRoute`(fetch) |
| `src/lib/__tests__/odsay.test.ts` (생성) | normalize 결정적 테스트 |
| `src/app/api/route/transit/route.ts` (생성) | 입력검증·게이트·3-state 에러·revalidate 3600 |
| `messages/ko.json`·`messages/en.json` (수정) | `route.transit.*` ICU 메시지 |
| `src/components/TransitRouteBriefing.tsx` (생성) | 현재위치/출발지변경·추천+대안·브리핑 렌더 |
| 장소 상세 컴포넌트 (수정) | `TransitRouteBriefing` 게이트 렌더 |

---

### Task 1: env 키 게이트 + Transit 타입

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces: `hasOdsayKey(): boolean`, `env.ODSAY_API_KEY`, 타입 `TransitLeg`/`TransitRoute`/`TransitRouteResult`.

- [ ] **Step 1: env 스키마에 ODSAY_API_KEY 추가**

`src/lib/env.ts`의 `envSchema` 객체에서 `SEOUL_SUBWAY_REALTIME_KEY` 줄 다음에 추가:

```ts
  // ODsay 대중교통 길찾기 — api.odsay.com apiKey (서버 전용).
  // ⚠ URL 인코딩된 키를 재인코딩하면 깨짐(data.go.kr serviceKey와 동형).
  ODSAY_API_KEY: z.string().min(1).optional(),
```

같은 파일 `envSchema.parse({...})` 객체에서 `SEOUL_SUBWAY_REALTIME_KEY` 줄 다음에 추가:

```ts
  ODSAY_API_KEY: process.env.ODSAY_API_KEY,
```

파일 맨 끝 `hasSeoulSubwayRealtimeKey` 함수 다음에 추가:

```ts
/** ODsay 대중교통 길찾기 사용 가능 여부 */
export function hasOdsayKey(): boolean {
  return Boolean(env.ODSAY_API_KEY);
}
```

- [ ] **Step 2: types.ts에 Transit 타입 추가**

`src/lib/types.ts`의 `CarRouteBriefing` 인터페이스(약 175줄) 다음에 추가:

```ts
/** 대중교통 경로 한 구간(도보/버스/지하철). 고유명은 ODsay 한국어 원문 그대로. */
export interface TransitLeg {
  mode: "walk" | "bus" | "subway";
  /** "수도권 5호선" / "341" 등 ODsay 한국어 원문 (도보는 없음) */
  lineName?: string;
  /** 승차 정류장 (도보는 없음) */
  fromName?: string;
  /** 하차 정류장 (도보는 없음) */
  toName?: string;
  /** 정거장 수 (도보는 없음) */
  stationCount?: number;
  /** 구간 소요시간(분) */
  minutes: number;
}

/** 대중교통 경로 1개(요약 + 구간 리스트). */
export interface TransitRoute {
  summary: {
    totalMinutes: number;
    /** 요금(원) */
    fare: number;
    /** 환승 횟수 */
    transfers: number;
    /** 총 도보 시간(분) */
    walkMinutes: number;
    /** 첫 승차 정류장 (한국어 원문) */
    departName?: string;
    /** 막 하차 정류장 (한국어 원문) */
    arriveName?: string;
  };
  legs: TransitLeg[];
}

/** 대중교통 길찾기 결과: 추천 1개 + 대안 최대 2개. */
export interface TransitRouteResult {
  recommended: TransitRoute;
  alternatives: TransitRoute[];
}
```

- [ ] **Step 3: 타입체크/린트**

Run: `npm run lint`
Expected: PASS (새 export만 추가, 에러 없음)

- [ ] **Step 4: Commit**

```bash
git add src/lib/env.ts src/lib/types.ts
git commit -m "feat(transit): ODsay 키 게이트 + 대중교통 경로 타입"
```

---

### Task 2: ODsay 응답 정규화 (순수, TDD)

**Files:**
- Create: `src/lib/providers/odsay.ts`
- Test: `src/lib/__tests__/odsay.test.ts`

**Interfaces:**
- Consumes: `TransitLeg`/`TransitRoute`/`TransitRouteResult` (Task 1).
- Produces: `normalizeOdsayRoute(data: OdsayResponse): TransitRouteResult | null` (경로 없음이면 null), 타입 `OdsayResponse`.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/odsay.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeOdsayRoute } from "@/lib/providers/odsay";

// ODsay searchPubTransPathT 응답(문서 기반, Task 8에서 실응답 교정).
// 단위: totalTime/sectionTime=분, payment=원, totalWalk=미터.
const sample = {
  result: {
    searchType: 0,
    outTrafficCheck: 0,
    path: [
      {
        pathType: 3,
        info: {
          totalTime: 35,
          payment: 1500,
          totalWalk: 480,
          firstStartStation: "길동",
          lastEndStation: "강남",
        },
        subPath: [
          { trafficType: 3, distance: 350, sectionTime: 5 },
          {
            trafficType: 1,
            distance: 4000,
            sectionTime: 8,
            stationCount: 3,
            startName: "길동",
            endName: "천호",
            lane: [{ name: "수도권 5호선" }],
          },
          {
            trafficType: 2,
            distance: 3000,
            sectionTime: 12,
            stationCount: 5,
            startName: "천호역",
            endName: "강남역",
            lane: [{ busNo: "341" }],
          },
          { trafficType: 3, distance: 130, sectionTime: 3 },
          // 거리/시간 0 도보 — skip 대상
          { trafficType: 3, distance: 0, sectionTime: 0 },
        ],
      },
      {
        pathType: 1,
        info: { totalTime: 40, payment: 1400, totalWalk: 600 },
        subPath: [
          { trafficType: 3, distance: 600, sectionTime: 9 },
          {
            trafficType: 1,
            distance: 9000,
            sectionTime: 28,
            stationCount: 9,
            startName: "길동",
            endName: "강남",
            lane: [{ name: "수도권 2호선" }],
          },
        ],
      },
    ],
  },
};

describe("normalizeOdsayRoute", () => {
  it("path[0]을 추천, 다음을 대안으로 분리한다", () => {
    const result = normalizeOdsayRoute(sample)!;
    expect(result.recommended.summary.totalMinutes).toBe(35);
    expect(result.alternatives).toHaveLength(1);
    expect(result.alternatives[0].summary.totalMinutes).toBe(40);
  });

  it("subPath를 도보/지하철/버스 leg로 투영하고 0거리 도보를 skip한다", () => {
    const { legs } = normalizeOdsayRoute(sample)!.recommended;
    expect(legs.map((l) => l.mode)).toEqual(["walk", "subway", "bus", "walk"]);
    expect(legs[1]).toMatchObject({
      mode: "subway",
      lineName: "수도권 5호선",
      fromName: "길동",
      toName: "천호",
      stationCount: 3,
      minutes: 8,
    });
    expect(legs[2]).toMatchObject({ mode: "bus", lineName: "341", minutes: 12 });
  });

  it("환승 횟수 = 탑승 leg 수 - 1, 도보시간은 도보 leg 합", () => {
    const { summary } = normalizeOdsayRoute(sample)!.recommended;
    expect(summary.transfers).toBe(1); // 지하철1 + 버스1 - 1
    expect(summary.walkMinutes).toBe(8); // 5 + 3 (0 도보 제외)
    expect(summary.fare).toBe(1500);
    expect(summary.departName).toBe("길동");
    expect(summary.arriveName).toBe("강남");
  });

  it("단일 수단(환승 0) 경로의 환승은 0", () => {
    const { summary } = normalizeOdsayRoute(sample)!.alternatives[0];
    expect(summary.transfers).toBe(0);
  });

  it("경로가 없으면 null", () => {
    expect(normalizeOdsayRoute({ result: { path: [] } })).toBeNull();
    expect(normalizeOdsayRoute({ result: {} })).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- odsay`
Expected: FAIL ("normalizeOdsayRoute is not a function" / 모듈 없음)

- [ ] **Step 3: 최소 구현**

`src/lib/providers/odsay.ts`:

```ts
import { env } from "../env";
import type { TransitLeg, TransitRoute, TransitRouteResult } from "../types";

/**
 * ODsay 대중교통 길찾기 provider.
 *
 * api.odsay.com/v1/api/searchPubTransPathT 의 path/subPath 응답을
 * 길동무 자체 TransitRoute shape로 정규화해 ODsay 종속을 격리한다.
 * 정규화는 순수 함수(normalizeOdsayRoute)라 fixture로 결정적 테스트한다.
 *
 * ⚠ 필드명/단위/에러코드는 pre-merge 실호출로 확정(설계 §2). 단위는 문서 기준
 *   totalTime/sectionTime=분, payment=원, totalWalk=미터.
 */

const ENDPOINT = "https://api.odsay.com/v1/api/searchPubTransPathT";

interface OdsayLane {
  name?: string; // 지하철 노선명
  busNo?: string; // 버스 번호
}
interface OdsaySubPath {
  trafficType: number; // 1=지하철, 2=버스, 3=도보
  distance?: number;
  sectionTime?: number;
  stationCount?: number;
  startName?: string;
  endName?: string;
  lane?: OdsayLane[];
}
interface OdsayPath {
  pathType: number;
  info: {
    totalTime: number;
    payment: number;
    totalWalk?: number;
    firstStartStation?: string;
    lastEndStation?: string;
  };
  subPath: OdsaySubPath[];
}
export interface OdsayResponse {
  result?: { path?: OdsayPath[] };
  error?: unknown;
}

function toLeg(sp: OdsaySubPath): TransitLeg {
  const minutes = sp.sectionTime ?? 0;
  if (sp.trafficType === 3) {
    return { mode: "walk", minutes };
  }
  const mode = sp.trafficType === 1 ? "subway" : "bus";
  const lane = sp.lane?.[0];
  return {
    mode,
    lineName: mode === "subway" ? lane?.name : lane?.busNo,
    fromName: sp.startName,
    toName: sp.endName,
    stationCount: sp.stationCount,
    minutes,
  };
}

function toTransitRoute(path: OdsayPath): TransitRoute {
  // 거리·시간 0 도보 구간은 의미 없으니 제외
  const legs = path.subPath
    .filter(
      (sp) =>
        !(
          sp.trafficType === 3 &&
          (sp.sectionTime ?? 0) === 0 &&
          (sp.distance ?? 0) === 0
        ),
    )
    .map(toLeg);
  const boardCount = legs.filter((l) => l.mode !== "walk").length;
  const walkMinutes = legs
    .filter((l) => l.mode === "walk")
    .reduce((sum, l) => sum + l.minutes, 0);
  return {
    summary: {
      totalMinutes: path.info.totalTime,
      fare: path.info.payment,
      transfers: Math.max(0, boardCount - 1),
      walkMinutes,
      departName: path.info.firstStartStation,
      arriveName: path.info.lastEndStation,
    },
    legs,
  };
}

/** ODsay 응답 → TransitRouteResult. 경로 없으면 null(graceful "찾지 못함"). */
export function normalizeOdsayRoute(
  data: OdsayResponse,
): TransitRouteResult | null {
  const paths = data.result?.path ?? [];
  if (paths.length === 0) return null;
  const routes = paths.slice(0, 3).map(toTransitRoute);
  return { recommended: routes[0], alternatives: routes.slice(1) };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:run -- odsay`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/odsay.ts src/lib/__tests__/odsay.test.ts
git commit -m "feat(transit): ODsay 응답 정규화(순수) + fixture 테스트"
```

---

### Task 3: ODsay fetch 함수 (getTransitRoute)

**Files:**
- Modify: `src/lib/providers/odsay.ts`

**Interfaces:**
- Consumes: `normalizeOdsayRoute`, `OdsayResponse` (Task 2), `Coord` (`src/lib/types.ts`).
- Produces: `getTransitRoute(params: { origin: Coord; dest: Coord }): Promise<TransitRouteResult | null>`.

- [ ] **Step 1: getTransitRoute 추가**

`src/lib/providers/odsay.ts` 상단 import에 `Coord` 추가:

```ts
import type { Coord, TransitLeg, TransitRoute, TransitRouteResult } from "../types";
```

파일 맨 끝에 추가:

```ts
/**
 * ODsay 대중교통 길찾기 조회. 경로 없으면 null, ODsay 오류/HTTP 실패면 throw.
 *
 * ⚠ apiKey는 이미 URL 인코딩된 값일 수 있어 재인코딩하면 깨진다 →
 *   URLSearchParams로 인코딩하지 말고 raw로 쿼리에 붙인다.
 * ODsay 좌표 파라미터는 SX/EX=경도(lng), SY/EY=위도(lat).
 */
export async function getTransitRoute(params: {
  origin: Coord;
  dest: Coord;
}): Promise<TransitRouteResult | null> {
  const { origin, dest } = params;
  const q = new URLSearchParams({
    SX: String(origin.lng),
    SY: String(origin.lat),
    EX: String(dest.lng),
    EY: String(dest.lat),
    OPT: "0",
  });
  // apiKey는 인코딩하지 않고 raw로 덧붙인다(이중 인코딩 방지)
  const url = `${ENDPOINT}?${q.toString()}&apiKey=${env.ODSAY_API_KEY ?? ""}`;

  const res = await fetch(url, {
    // 경로는 준정적 — 같은 좌표쌍 캐시로 1,000회/일 쿼터를 보호
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ODsay 길찾기 실패: HTTP ${res.status} ${body}`);
  }
  const data = (await res.json()) as OdsayResponse;
  if (data.error) {
    // ODsay는 200 + result.error로 오류를 주기도 한다 → upstream/입력 오류로 throw
    throw new Error(`ODsay 길찾기 오류: ${JSON.stringify(data.error)}`);
  }
  return normalizeOdsayRoute(data);
}
```

- [ ] **Step 2: 린트/타입체크**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: 기존 테스트 회귀 확인**

Run: `npm run test:run -- odsay`
Expected: PASS (normalize 테스트 그대로 통과 — fetch는 실호출 게이트라 단위 테스트 없음)

- [ ] **Step 4: Commit**

```bash
git add src/lib/providers/odsay.ts
git commit -m "feat(transit): ODsay getTransitRoute fetch (캐시 revalidate, 키 raw)"
```

---

### Task 4: route handler `/api/route/transit`

**Files:**
- Create: `src/app/api/route/transit/route.ts`

**Interfaces:**
- Consumes: `getTransitRoute` (Task 3), `hasOdsayKey` (Task 1), `isInKorea` (`src/lib/deeplink.ts`).
- Produces: `GET /api/route/transit?origin=lat,lng&dest=lat,lng` → `TransitRouteResult` JSON, 경로없음 `{ result: null }`, 오류 4xx/5xx.

- [ ] **Step 1: route handler 작성** (`car` route 패턴 복제)

`src/app/api/route/transit/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasOdsayKey } from "@/lib/env";
import { isInKorea } from "@/lib/deeplink";
import { getTransitRoute } from "@/lib/providers/odsay";

/**
 * 대중교통 길찾기 프록시(ODsay). 좌표는 "위도,경도" 순서(도메인 표준).
 *
 * 3-state 응답(설계 §I5): 경로 없음과 조회 실패를 뭉개지 않는다.
 * - 입력 오류(좌표 범위 밖) → 400
 * - 경로 없음(graceful) → 200 { result: null }
 * - upstream 장애 → 502
 * 실데이터만 의미 있으므로 mock 폴백 없음(키 없으면 503, 단 게이트로 호출 자체가 안 옴).
 */

const coordSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "좌표 형식은 '위도,경도'")
  .transform((raw) => {
    const [lat, lng] = raw.split(",").map(Number);
    return { lat, lng };
  })
  .refine((c) => isInKorea(c.lat, c.lng), "좌표가 한반도 권역을 벗어남");

const querySchema = z.object({ origin: coordSchema, dest: coordSchema });

export async function GET(request: NextRequest) {
  if (!hasOdsayKey()) {
    return NextResponse.json(
      { error: "대중교통 길찾기는 API 키 등록 후 사용할 수 있습니다." },
      { status: 503 },
    );
  }

  const parsed = querySchema.safeParse({
    origin: request.nextUrl.searchParams.get("origin") ?? "",
    dest: request.nextUrl.searchParams.get("dest") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }

  try {
    const result = await getTransitRoute(parsed.data);
    // null = 경로 없음(graceful). 컴포넌트가 "찾지 못함"으로 표시.
    return NextResponse.json({ result });
  } catch (e) {
    console.error("[api/route/transit] 길찾기 실패:", e);
    return NextResponse.json(
      { error: "대중교통 길찾기에 실패했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: 린트/빌드 확인**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: 게이트 동작 수동 확인** (키 없을 때 503)

Run: `npm run dev` 후 다른 터미널에서
`curl -s "http://localhost:3000/api/route/transit?origin=37.5,127.1&dest=37.49,127.02" | head -c 200`
Expected: 키 없으면 `{"error":"대중교통 길찾기는 API 키 등록 후..."}` (503). (키가 .env.local에 있으면 Task 8에서 실데이터 검증)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/route/transit/route.ts
git commit -m "feat(transit): /api/route/transit 라우트 (3-state 에러·게이트)"
```

---

### Task 5: i18n 메시지 (ko/en)

**Files:**
- Modify: `messages/ko.json`
- Modify: `messages/en.json`

**Interfaces:**
- Produces: `route.transit.*` 메시지 키 (Task 6 컴포넌트가 소비).

- [ ] **Step 1: ko.json에 route.transit 추가**

`messages/ko.json`의 `route` 객체 안(기존 `briefing` 옆)에 `transit` 키 추가:

```json
"transit": {
  "button": "여기까지 대중교통 길찾기",
  "heading": "{name}까지 대중교통",
  "locating": "현재 위치를 확인하는 중입니다.",
  "loading": "경로를 찾는 중입니다.",
  "ready": "경로 안내가 준비되었습니다.",
  "error": "경로를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  "geoError": "현재 위치를 확인할 수 없습니다. 출발지를 검색해 지정해 주세요.",
  "noRoute": "대중교통 경로를 찾지 못했습니다. 출발지와 목적지를 확인해 주세요.",
  "summary": "총 {minutes}분, {fare}원, 환승 {transfers}회",
  "walkSummary": "도보 {minutes}분 포함",
  "legWalk": "도보 {minutes}분",
  "legBoard": "{from}에서 {line} 승차, {count}정거장",
  "legTransfer": "{from}에서 {line} 환승, {count}정거장",
  "arrive": "{name} 도착",
  "changeOrigin": "출발지 바꾸기",
  "originLabel": "출발지 검색",
  "originPlaceholder": "출발지를 입력하세요",
  "useCurrentLocation": "현재 위치에서 출발",
  "showAlternatives": "다른 경로 보기",
  "alternativeHeading": "대안 경로 {index}"
}
```

- [ ] **Step 2: en.json에 route.transit 추가** (구조는 영문, 고유명 `{line}`/`{from}`/`{name}`은 변수라 한국어 원문 주입됨)

`messages/en.json`의 `route` 객체 안에 추가:

```json
"transit": {
  "button": "Public transit to here",
  "heading": "Transit to {name}",
  "locating": "Locating you…",
  "loading": "Finding a route…",
  "ready": "Route is ready.",
  "error": "Couldn't load the route. Please try again.",
  "geoError": "Couldn't get your location. Please search for a starting point.",
  "noRoute": "No public transit route found. Check the start and destination.",
  "summary": "{minutes} min, {fare} won, {transfers} transfer(s)",
  "walkSummary": "incl. {minutes} min walking",
  "legWalk": "Walk {minutes} min",
  "legBoard": "Board {line} at {from}, {count} stops",
  "legTransfer": "Transfer to {line} at {from}, {count} stops",
  "arrive": "Arrive at {name}",
  "changeOrigin": "Change start",
  "originLabel": "Search start point",
  "originPlaceholder": "Enter a starting point",
  "useCurrentLocation": "Start from current location",
  "showAlternatives": "See other routes",
  "alternativeHeading": "Alternative {index}"
}
```

- [ ] **Step 3: JSON 유효성 + 빌드 확인**

Run: `npm run lint && node -e "JSON.parse(require('fs').readFileSync('messages/ko.json')); JSON.parse(require('fs').readFileSync('messages/en.json')); console.log('OK')"`
Expected: `OK` (JSON 파싱 성공)

- [ ] **Step 4: Commit**

```bash
git add messages/ko.json messages/en.json
git commit -m "feat(transit): 대중교통 길찾기 i18n 메시지(ko/en)"
```

---

### Task 6: TransitRouteBriefing 컴포넌트

**Files:**
- Create: `src/components/TransitRouteBriefing.tsx`

**Interfaces:**
- Consumes: `route.transit.*` (Task 5), `TransitRouteResult`/`TransitRoute` (Task 1), `/api/route/transit` (Task 4).
- Produces: `<TransitRouteBriefing dest={{ lat, lng, name }} />`.

- [ ] **Step 1: 컴포넌트 작성** (`CarRouteBriefing` 기반 + 출발지 변경 + 대안 펼치기)

`src/components/TransitRouteBriefing.tsx`:

```tsx
"use client";

import { useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type {
  Place,
  PlaceSearchResult,
  TransitRoute,
  TransitRouteResult,
} from "@/lib/types";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" } // 경로 없음(graceful)
  | { kind: "done"; result: TransitRouteResult };

/**
 * 대중교통 경로 텍스트 브리핑 — 자동차 브리핑(CarRouteBriefing)과 동형.
 * 출발지는 현재 위치 기본, "출발지 바꾸기"로 좌표 지정 가능. 추천경로 1개를
 * 낭독 정본으로 표시하고 대안은 펼치기. 실주행은 딥링크 위임(설계 §1).
 */
export function TransitRouteBriefing({
  dest,
}: {
  dest: { lat: number; lng: number; name: string };
}) {
  const t = useTranslations("route.transit");
  const locale = useLocale();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [showAlts, setShowAlts] = useState(false);
  const [showOriginSearch, setShowOriginSearch] = useState(false);
  const [originQuery, setOriginQuery] = useState("");
  const [originResults, setOriginResults] = useState<Place[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const originInputId = useId();
  const inFlight = useRef(false);
  const reqId = useRef(0);

  async function fetchRoute(originLat: number, originLng: number) {
    const myReq = ++reqId.current;
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/route/transit?origin=${originLat},${originLng}&dest=${dest.lat},${dest.lng}&lang=${locale}`,
      );
      const body = await res.json();
      if (myReq !== reqId.current) return; // stale 응답 폐기
      if (!res.ok) {
        setStatus({
          kind: "error",
          message: typeof body.error === "string" ? body.error : t("error"),
        });
        return;
      }
      if (!body.result) {
        setStatus({ kind: "empty" });
        return;
      }
      setShowAlts(false);
      setStatus({ kind: "done", result: body.result as TransitRouteResult });
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      if (myReq === reqId.current) setStatus({ kind: "error", message: t("error") });
    }
  }

  function requestFromCurrent() {
    if (inFlight.current) return;
    if (!("geolocation" in navigator)) {
      setStatus({ kind: "error", message: t("geoError") });
      return;
    }
    inFlight.current = true;
    setStatus({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await fetchRoute(pos.coords.latitude, pos.coords.longitude);
        inFlight.current = false;
      },
      () => {
        setStatus({ kind: "error", message: t("geoError") });
        inFlight.current = false;
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  // 출발지 변경: 기존 장소 검색(/api/places) 재사용
  async function runOriginSearch() {
    const q = originQuery.trim();
    if (!q) return;
    try {
      const res = await fetch(
        `/api/places?query=${encodeURIComponent(q)}&lang=${locale}`,
      );
      const body = (await res.json()) as PlaceSearchResult;
      setOriginResults(res.ok ? (body.places ?? []) : []);
    } catch {
      setOriginResults([]);
    }
  }

  function selectOrigin(place: Place) {
    setShowOriginSearch(false);
    setOriginResults([]);
    setOriginQuery("");
    void fetchRoute(place.lat, place.lng);
  }

  const busy = status.kind === "locating" || status.kind === "loading";
  const liveMessage =
    status.kind === "locating"
      ? t("locating")
      : status.kind === "loading"
        ? t("loading")
        : status.kind === "error"
          ? status.message
          : status.kind === "empty"
            ? t("noRoute")
            : status.kind === "done"
              ? t("ready")
              : "";

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={requestFromCurrent}
        aria-disabled={busy}
        aria-busy={busy}
        className="min-h-11 rounded-md border border-blue-700 px-4 py-2 text-sm font-medium text-blue-700 aria-disabled:opacity-50 dark:text-blue-300"
      >
        {t("button")}
      </button>
      <button
        type="button"
        onClick={() => setShowOriginSearch((v) => !v)}
        aria-expanded={showOriginSearch}
        className="ml-3 min-h-11 text-sm font-medium text-blue-700 underline dark:text-blue-300"
      >
        {t("changeOrigin")}
      </button>

      {showOriginSearch && (
        <div className="mt-2">
          <label htmlFor={originInputId} className="block text-sm font-medium">
            {t("originLabel")}
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id={originInputId}
              type="text"
              value={originQuery}
              onChange={(e) => setOriginQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runOriginSearch();
              }}
              placeholder={t("originPlaceholder")}
              className="min-h-11 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={runOriginSearch}
              className="min-h-11 rounded-md border border-blue-700 px-3 text-sm text-blue-700 dark:text-blue-300"
            >
              {t("originLabel")}
            </button>
          </div>
          {originResults.length > 0 && (
            <ul className="mt-1">
              {originResults.map((p) => (
                <li key={`${p.lat},${p.lng}`}>
                  <button
                    type="button"
                    onClick={() => selectOrigin(p)}
                    className="min-h-11 w-full text-left text-sm underline"
                    lang="ko"
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        {liveMessage}
      </p>

      {status.kind === "done" && (
        <section
          aria-labelledby={headingId}
          className="mt-2 rounded-md border border-gray-300 p-3"
        >
          <h3
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            {t("heading", { name: dest.name })}
          </h3>
          <RouteView route={status.result.recommended} t={t} locale={locale} dest={dest.name} />

          {status.result.alternatives.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowAlts((v) => !v)}
                aria-expanded={showAlts}
                className="min-h-11 text-sm font-medium text-blue-700 underline dark:text-blue-300"
              >
                {t("showAlternatives")}
              </button>
              {showAlts &&
                status.result.alternatives.map((alt, i) => (
                  <div key={i} className="mt-2 border-t border-gray-200 pt-2">
                    <h4 className="text-sm font-semibold">
                      {t("alternativeHeading", { index: i + 1 })}
                    </h4>
                    <RouteView route={alt} t={t} locale={locale} dest={dest.name} />
                  </div>
                ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** 경로 1개의 요약 + 구간 리스트. 고유명(노선·정류장)은 lang="ko". */
function RouteView({
  route,
  t,
  locale,
  dest,
}: {
  route: TransitRoute;
  t: ReturnType<typeof useTranslations>;
  locale: string;
  dest: string;
}) {
  let boardSeen = 0;
  return (
    <>
      <p className="mt-1 text-sm">
        {t("summary", {
          minutes: route.summary.totalMinutes,
          fare: route.summary.fare.toLocaleString(locale),
          transfers: route.summary.transfers,
        })}
        {route.summary.walkMinutes > 0 && (
          <> {t("walkSummary", { minutes: route.summary.walkMinutes })}</>
        )}
      </p>
      <ol className="mt-2 list-decimal pl-6 text-sm leading-relaxed">
        {route.legs.map((leg, i) => {
          if (leg.mode === "walk") {
            return <li key={i}>{t("legWalk", { minutes: leg.minutes })}</li>;
          }
          const key = boardSeen++ === 0 ? "legBoard" : "legTransfer";
          return (
            <li key={i}>
              {t.rich(key, {
                line: () => <span lang="ko">{leg.lineName ?? ""}</span>,
                from: () => <span lang="ko">{leg.fromName ?? ""}</span>,
                count: leg.stationCount ?? 0,
              })}
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-sm" lang="ko">
        {t("arrive", { name: route.summary.arriveName ?? dest })}
      </p>
    </>
  );
}
```

> 참고: `t.rich`로 `{line}`/`{from}`을 `lang="ko"` span으로 감싸 en에서도 고유명이 한국어로 낭독되게 한다. `count`는 숫자 변수. 메시지의 `{line}`/`{from}`은 rich 태그가 아니라 변수지만, next-intl 4의 `t.rich`는 함수형 변수를 ReactNode로 렌더한다.

- [ ] **Step 2: 린트/타입체크**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: 빌드 확인** (클라이언트 컴포넌트 컴파일)

Run: `npm run build 2>&1 | tail -20`
Expected: 빌드 성공(타입 에러 없음). 실패 시 `t.rich` 시그니처를 next-intl 4 문서로 확인해 조정.

- [ ] **Step 4: Commit**

```bash
git add src/components/TransitRouteBriefing.tsx
git commit -m "feat(transit): TransitRouteBriefing 컴포넌트(현재위치·대안·a11y)"
```

---

### Task 7: 장소 상세에 통합 (게이트 렌더)

**Files:**
- Modify: 장소 상세 컴포넌트(아래 grep로 특정)

**Interfaces:**
- Consumes: `TransitRouteBriefing` (Task 6), `hasOdsayKey` (Task 1).

- [ ] **Step 1: CarRouteBriefing 사용처(장소 상세) 찾기**

Run: `grep -rln "CarRouteBriefing" src/components src/app`
이 파일이 장소 상세다. 해당 파일을 연다.

- [ ] **Step 2: 게이트 플래그 전달 경로 확인**

다른 섹션(예: `BusArrivals`/`StationFacilities`)이 `canShow*` 게이트를 어떻게 받는지 같은 파일에서 확인한다(서버에서 prop으로 내려주는지, 클라에서 판단하는지). `hasOdsayKey()`는 서버 전용(env)이므로, 기존 `canShowBus`/`canShowClinic` 등과 **동일한 경로**로 `canShowTransit` prop을 전달한다.

Run: `grep -rn "canShow" src/components src/app | head -20`

- [ ] **Step 3: TransitRouteBriefing 렌더 추가**

장소 상세에서 `CarRouteBriefing`을 렌더하는 위치 바로 아래(또는 같은 경로 섹션)에, 기존 `canShow*` 패턴과 동형으로 추가. 예시(실제 prop 흐름에 맞춰 조정):

```tsx
import { TransitRouteBriefing } from "@/components/TransitRouteBriefing";
// ...
{canShowTransit && (
  <TransitRouteBriefing dest={{ lat: place.lat, lng: place.lng, name: place.name }} />
)}
```

게이트 prop을 내려주는 서버 컴포넌트/페이지에서 `canShowTransit={hasOdsayKey()}`를 기존 `canShow*`들과 함께 계산해 전달한다.

- [ ] **Step 4: 린트/빌드**

Run: `npm run lint && npm run build 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5: 수동 확인** (키 없을 때 버튼 미노출)

`npm run dev` → 장소 상세 진입 → 키가 없으면 "여기까지 대중교통 길찾기" 버튼이 보이지 않아야 한다(게이트 동작).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(transit): 장소 상세에 대중교통 길찾기 통합(게이트)"
```

---

### Task 8: pre-merge 실호출 검증 + fixture 교정 (키 필요)

**Files:**
- Modify (필요 시): `src/lib/providers/odsay.ts`, `src/lib/__tests__/odsay.test.ts`

**전제:** `.env.local`에 `ODSAY_API_KEY` 등록 완료.

- [ ] **Step 1: 실호출로 실응답 구조 확인** (강동 길동 → 강남)

Run:
```bash
cd /Users/hunyongkim/Mac-Projects/gildongmu
set -a; source .env.local; set +a
curl -s "https://api.odsay.com/v1/api/searchPubTransPathT?SX=127.1378&SY=37.5385&EX=127.0276&EY=37.4979&OPT=0&apiKey=${ODSAY_API_KEY}" | head -c 2000
```
Expected: `result.path[]` 구조의 JSON. **실응답의 필드명을 확인** — `info.totalTime`/`payment`/`firstStartStation`/`lastEndStation`, `subPath[].trafficType`/`sectionTime`/`stationCount`/`startName`/`endName`, `lane[].name`(지하철)/`busNo`(버스), 단위(분/원/미터).

- [ ] **Step 2: 실응답과 fixture 대조, 불일치 교정**

실응답 필드명이 Task 2 fixture/normalize와 다르면:
- `src/lib/providers/odsay.ts`의 인터페이스·`toLeg`/`toTransitRoute` 필드 접근을 실응답에 맞게 수정.
- `src/lib/__tests__/odsay.test.ts`의 `sample`을 실응답 발췌로 교체.
- 단위가 분이 아니면(예: 초) 변환 추가(ncp-directions의 ms→초 교훈).

- [ ] **Step 3: 라우트 실데이터 검증**

Run: `npm run dev` 후
```bash
curl -s "http://localhost:3000/api/route/transit?origin=37.5385,127.1378&dest=37.4979,127.0276&lang=ko" | head -c 1000
```
Expected: `{ "result": { "recommended": {...}, "alternatives": [...] } }` 실데이터.
범위 밖(예: `origin=1,1`)은 400, 경로 없음 케이스는 `{ "result": null }` 확인.

- [ ] **Step 4: 전체 테스트 통과**

Run: `npm run test:run`
Expected: 전체 PASS (odsay 포함).

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/odsay.ts src/lib/__tests__/odsay.test.ts
git commit -m "test(transit): ODsay 실호출로 필드·단위 확정 + fixture 교정"
```

---

## 마무리 (구현 완료 후)

- **a11y 점검**: `a11y-auditor` 서브에이전트로 `TransitRouteBriefing` 점검(키보드·포커스·live region·en lang).
- **SPEC 백로그 갱신**: `docs/SPEC.md` 실험 백로그 표에 ODsay 대중교통 길찾기 행 추가.
- **CLAUDE.md 갱신**: provider 목록에 ODsay 한 줄, API 키 현황 표에 `ODSAY_API_KEY` 행 추가(실호출 검증일 명기).
- **프로덕션 배포**: `ODSAY_API_KEY`를 Vercel Production env 등록 후 재배포(키 추가만으론 기존 함수 미반영 — 재배포 필수).
- **cross-cutting 리뷰**: 묶음 경계를 넘는 일관성은 code-reviewer 서브에이전트로(설계 단계 adversarial 검토는 생략 — 단일 provider·기존 패턴 복제라 invariant gap 위험 낮음).

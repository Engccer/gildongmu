# 따릉이(서울 공공자전거) 실시간 대여소 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장소 상세·홈(현위치)에서 근처 따릉이 대여소와 대여 가능 자전거 수를 스크린 리더로 완결 낭독한다.

**Architecture:** 버스(`tago-bus.ts`/`BusArrivals`) 패턴을 복제한다. bikeList는 좌표 필터가 없어 전체(~2,720)를 페이지 루프로 받아 서버에서 Haversine 정렬→1km cap→상위 5. 캐시 60초 revalidate. provider는 React/Next 비의존(순수 파서 + fetch 분리).

**Tech Stack:** TypeScript, Next.js 16 Route Handler, zod, next-intl, Vitest, 서울 열린데이터광장 bikeList(OA-15493).

설계 정본: `docs/superpowers/specs/2026-06-16-seoul-bike-design.md`

---

### Task 1: BikeStation 타입

**Files:**
- Modify: `src/lib/types.ts` (파일 끝 `BusRouteStop` 블록 뒤)

- [ ] **Step 1: 인터페이스 추가**

`src/lib/types.ts` 끝에 추가:

```ts
/**
 * 따릉이(서울 공공자전거) 대여소 하나 — bikeList(OA-15493) 정규화 + 계산 거리.
 * 좌표는 WGS84 십진 도. 서울 전용(따릉이는 서울시 운영).
 */
export interface BikeStation {
  /** 대여소 ID(예 "ST-2749") */
  stationId: string;
  /** 대여소명 — 원문 그대로(번호 접두 포함, 예 "3681. 길동 마루빌딩") */
  name: string;
  lat: number;
  lng: number;
  /** 출발 좌표로부터 Haversine 거리(m). 좌표 비유한이면 Infinity(정렬 후미). */
  distanceMeters: number;
  /** 거치대 총수(rackTotCnt) */
  racksTotal: number;
  /** 대여 가능 자전거 수(parkingBikeTotCnt) */
  bikesAvailable: number;
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음(아직 사용처 없음).

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): BikeStation 인터페이스 추가"
```

---

### Task 2: 환경변수 SEOUL_OPEN_DATA_KEY + 게이트

**Files:**
- Modify: `src/lib/env.ts` (스키마 + parse + 게이트 헬퍼)

- [ ] **Step 1: 스키마에 키 추가**

`src/lib/env.ts`의 `envSchema` 안, `DEEPGRAM_API_KEY` 정의 바로 뒤에 추가:

```ts
  // 서울 열린데이터광장 일반 인증키 — 따릉이(bikeList) 등 openapi.seoul.go.kr 계열
  SEOUL_OPEN_DATA_KEY: z.string().min(1).optional(),
```

- [ ] **Step 2: parse 객체에 추가**

`export const env = envSchema.parse({ ... })`의 `DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,` 뒤에 추가:

```ts
  SEOUL_OPEN_DATA_KEY: process.env.SEOUL_OPEN_DATA_KEY,
```

- [ ] **Step 3: 게이트 헬퍼 추가**

`hasDeepgramKey()` 함수 뒤에 추가:

```ts
/** 서울 열린데이터광장(따릉이 등) 사용 가능 여부 */
export function hasSeoulOpenDataKey(): boolean {
  return Boolean(env.SEOUL_OPEN_DATA_KEY);
}
```

- [ ] **Step 4: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add src/lib/env.ts
git commit -m "feat(env): SEOUL_OPEN_DATA_KEY + hasSeoulOpenDataKey 게이트"
```

---

### Task 3: 파서 parseBikeStations (TDD)

**Files:**
- Create: `src/lib/providers/seoul-bike.ts`
- Create: `src/lib/__tests__/seoul-bike.test.ts`
- 사용 fixture(이미 생성됨): `src/lib/__tests__/fixtures/seoul-bike.json`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/seoul-bike.test.ts`:

```ts
// 2026-06-16 실 bikeList 호출로 envelope·필드명 검증 완료(강동구 길동 실응답). fixture 구조가 실응답과 일치.
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../env", () => ({
  env: { SEOUL_OPEN_DATA_KEY: "test-key" },
}));

import fixture from "./fixtures/seoul-bike.json";
import {
  parseBikeRows,
  parseBikeStations,
  fetchNearbyBikeStations,
} from "../providers/seoul-bike";

// 강동구 길동 기준 좌표(설계 문서와 동일)
const O_LAT = 37.5385;
const O_LNG = 127.1378;

describe("parseBikeRows", () => {
  it("rentBikeStatus.row 배열을 뽑는다", () => {
    expect(parseBikeRows(fixture.nearbyPage).length).toBe(5);
  });
  it("빈 결과·비정상 입력은 빈 배열", () => {
    expect(parseBikeRows(fixture.emptyPage)).toEqual([]);
    expect(parseBikeRows(null)).toEqual([]);
    expect(parseBikeRows({})).toEqual([]);
  });
});

describe("parseBikeStations", () => {
  it("거리 오름차순 정렬 + 필드 매핑", () => {
    const stations = parseBikeStations(fixture.nearbyPage, O_LAT, O_LNG);
    // 좌표 정상 4개 + 좌표불명 1개 = 5개(필터는 fetch 단계 cap에서)
    expect(stations.length).toBe(5);
    // 최근접은 "3681. 길동 마루빌딩"(236m)
    expect(stations[0].name).toBe("3681. 길동 마루빌딩");
    expect(stations[0].bikesAvailable).toBe(31);
    expect(stations[0].racksTotal).toBe(10);
    expect(stations[0].distanceMeters).toBeGreaterThan(220);
    expect(stations[0].distanceMeters).toBeLessThan(260);
  });
  it("좌표 비유한 row는 distanceMeters Infinity로 후미", () => {
    const stations = parseBikeStations(fixture.nearbyPage, O_LAT, O_LNG);
    const last = stations[stations.length - 1];
    expect(last.stationId).toBe("ST-BAD");
    expect(last.distanceMeters).toBe(Number.POSITIVE_INFINITY);
  });
  it("bikesAvailable 0은 0으로 보존(정보 없음과 구분 안 함 — 따릉이는 항상 수치)", () => {
    const stations = parseBikeStations(fixture.nearbyPage, O_LAT, O_LNG);
    const bad = stations.find((s) => s.stationId === "ST-BAD")!;
    expect(bad.bikesAvailable).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- seoul-bike`
Expected: FAIL ("Failed to resolve import ../providers/seoul-bike" 또는 함수 미정의).

- [ ] **Step 3: 파서 구현**

`src/lib/providers/seoul-bike.ts`:

```ts
import type { BikeStation } from "../types";
import { env } from "../env";
import { haversineMeters } from "../geo";

/**
 * 서울 따릉이(공공자전거) provider — bikeList(OA-15493).
 *
 * bikeList는 좌표/반경 파라미터가 없어 전체(~2,720)를 페이지 루프로 받은 뒤
 * 서버에서 Haversine 정렬→1km cap→상위 5로 좁힌다(산술은 코드 책임).
 * envelope: rentBikeStatus.RESULT.CODE("INFO-000") + rentBikeStatus.row[].
 * list_total_count는 "전체 수"가 아니라 "그 페이지 row 수"라 종료 조건에 신뢰하지 않는다.
 */

type RawRow = Record<string, unknown>;

/** rentBikeStatus.row 배열을 안전 추출. */
export function parseBikeRows(raw: unknown): RawRow[] {
  const row = (raw as { rentBikeStatus?: { row?: unknown } })?.rentBikeStatus?.row;
  return Array.isArray(row) ? (row as RawRow[]) : [];
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/** 유한 실수 또는 NaN(파싱 불가 표식). */
function numF(v: unknown): number {
  if (v == null || (typeof v === "string" && v.trim() === "")) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** 음수·비유한 방어 후 반올림 정수(0 이상). */
function nonNegInt(v: unknown): number {
  const n = numF(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/** bikeList 응답 → 거리 오름차순 BikeStation[]. 좌표 비유한이면 거리 Infinity(후미). */
export function parseBikeStations(
  raw: unknown,
  originLat: number,
  originLng: number,
): BikeStation[] {
  return parseBikeRows(raw)
    .map((it): BikeStation => {
      const lat = numF(it.stationLatitude);
      const lng = numF(it.stationLongitude);
      const finite = Number.isFinite(lat) && Number.isFinite(lng);
      return {
        stationId: str(it.stationId),
        name: str(it.stationName),
        lat,
        lng,
        distanceMeters: finite
          ? Math.round(haversineMeters(originLat, originLng, lat, lng))
          : Number.POSITIVE_INFINITY,
        racksTotal: nonNegInt(it.rackTotCnt),
        bikesAvailable: nonNegInt(it.parkingBikeTotCnt),
      };
    })
    .filter((s) => s.stationId)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- seoul-bike`
Expected: parseBikeRows·parseBikeStations 테스트 PASS. (fetchNearbyBikeStations import는 다음 Task에서 정의 — 현재 import만 있으면 미정의로 그 describe만 실패할 수 있으니, Task 4 전까지 fetchNearbyBikeStations 테스트는 작성하지 않음. 위 Step 1 테스트엔 fetch 테스트 미포함.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/seoul-bike.ts src/lib/__tests__/seoul-bike.test.ts src/lib/__tests__/fixtures/seoul-bike.json
git commit -m "feat(bike): parseBikeStations 파서 + 게이트 테스트"
```

---

### Task 4: fetchNearbyBikeStations (페이지 루프·cap·revalidate, TDD)

**Files:**
- Modify: `src/lib/providers/seoul-bike.ts` (fetch 추가)
- Modify: `src/lib/__tests__/seoul-bike.test.ts` (fetch mock 테스트 추가)

- [ ] **Step 1: 실패하는 테스트 추가**

`src/lib/__tests__/seoul-bike.test.ts`의 마지막 `});`(파일 끝) 뒤에 추가:

```ts
describe("fetchNearbyBikeStations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1km 이내 상위 5 + 거리 정렬, 1km 밖·좌표불명 제외", async () => {
    // 단일 페이지(5건 < 1000)라 한 번만 fetch하고 종료
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture.nearbyPage), { status: 200 }),
    );
    const stations = await fetchNearbyBikeStations(O_LAT, O_LNG);
    // 좌표 정상 4개 중 1km 이내 3개("먼곳" 2km·"좌표불명" Infinity 제외)
    expect(stations.every((s) => s.distanceMeters <= 1000)).toBe(true);
    expect(stations.map((s) => s.stationId)).not.toContain("ST-BAD");
    expect(stations.map((s) => s.stationId)).not.toContain("ST-FAR");
    expect(stations[0].name).toBe("3681. 길동 마루빌딩");
  });

  it("RESULT.CODE가 INFO-000이 아니면 throw(조회 실패와 정보 없음 구분)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ rentBikeStatus: { RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } } }),
        { status: 200 },
      ),
    );
    await expect(fetchNearbyBikeStations(O_LAT, O_LNG)).rejects.toThrow();
  });

  it("키 없으면 빈 배열(방어적)", async () => {
    const mod = await import("../env");
    const orig = mod.env.SEOUL_OPEN_DATA_KEY;
    // @ts-expect-error 테스트 한정 변조
    mod.env.SEOUL_OPEN_DATA_KEY = undefined;
    const spy = vi.spyOn(globalThis, "fetch");
    const stations = await fetchNearbyBikeStations(O_LAT, O_LNG);
    expect(stations).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    // @ts-expect-error 복원
    mod.env.SEOUL_OPEN_DATA_KEY = orig;
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- seoul-bike`
Expected: FAIL ("fetchNearbyBikeStations is not a function").

- [ ] **Step 3: fetch 구현**

`src/lib/providers/seoul-bike.ts` 끝에 추가:

```ts
const BASE = "http://openapi.seoul.go.kr:8088";
const PAGE = 1000; // bikeList 1회 상한
const MAX_PAGES = 5; // 안전상한(~5,000건, 현재 전체 ~2,720)
const MAX_DISTANCE_METERS = 1000; // 도보권 cap
const TOP_N = 5;

/**
 * bikeList 한 페이지를 호출하고 정상 envelope를 반환한다.
 * RESULT.CODE가 INFO-000이 아니거나 rentBikeStatus가 없으면 throw
 * (라우트가 502로 변환 — "조회 실패"와 "정보 없음"을 구분).
 */
async function fetchBikePage(start: number, end: number): Promise<unknown> {
  const key = env.SEOUL_OPEN_DATA_KEY!;
  const url = `${BASE}/${key}/json/bikeList/${start}/${end}/`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`bikeList HTTP ${res.status}`);
  const data = (await res.json()) as {
    rentBikeStatus?: { RESULT?: { CODE?: string } };
  };
  const status = data?.rentBikeStatus;
  if (!status) throw new Error("bikeList 비정상 응답(rentBikeStatus 없음)");
  const code = status.RESULT?.CODE;
  if (code && code !== "INFO-000") throw new Error(`bikeList ${code}`);
  return data;
}

/**
 * 좌표 → 1km 이내 근접 따릉이 대여소 상위 5(거리순).
 * 키 없으면 빈 배열(라우트 게이트로 사실상 미도달, 방어적).
 * 전체를 페이지 루프로 모은 뒤에야 정렬·cap(부분집합 슬라이스 금지).
 */
export async function fetchNearbyBikeStations(
  lat: number,
  lng: number,
): Promise<BikeStation[]> {
  if (!env.SEOUL_OPEN_DATA_KEY) return [];
  let all: BikeStation[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE + 1;
    const end = start + PAGE - 1;
    const raw = await fetchBikePage(start, end);
    const rowCount = parseBikeRows(raw).length;
    all = all.concat(parseBikeStations(raw, lat, lng));
    if (rowCount < PAGE) break; // 받은 row 수 < 요청 크기 = 마지막 페이지(list_total_count 불신)
  }
  return all
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .filter((s) => s.distanceMeters <= MAX_DISTANCE_METERS)
    .slice(0, TOP_N);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- seoul-bike`
Expected: 전체 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/seoul-bike.ts src/lib/__tests__/seoul-bike.test.ts
git commit -m "feat(bike): fetchNearbyBikeStations 페이지 루프·1km cap·60초 캐시"
```

---

### Task 5: API 라우트 /api/bike/nearby

**Files:**
- Create: `src/app/api/bike/nearby/route.ts`

- [ ] **Step 1: 라우트 구현(버스 라우트 복제)**

`src/app/api/bike/nearby/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasSeoulOpenDataKey } from "@/lib/env";
import { fetchNearbyBikeStations } from "@/lib/providers/seoul-bike";

/**
 * GET /api/bike/nearby?lat=..&lng=..
 * 좌표 근접 따릉이 대여소(1km 이내 상위 5). provider가 60초 revalidate.
 *
 * 좌표는 한국 위경도 범위(위도 33~43, 경도 124~132)로 가드한다(버스 라우트와 통일).
 */
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
  if (!hasSeoulOpenDataKey()) {
    return NextResponse.json({ stations: [] });
  }
  try {
    const stations = await fetchNearbyBikeStations(parsed.data.lat, parsed.data.lng);
    return NextResponse.json({ stations });
  } catch (e) {
    console.error("[api/bike/nearby]", e);
    return NextResponse.json({ error: "따릉이 정보 조회 실패" }, { status: 502 });
  }
}
```

- [ ] **Step 2: 타입체크 + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/bike/nearby/route.ts
git commit -m "feat(bike): GET /api/bike/nearby 라우트"
```

---

### Task 6: i18n 메시지 bike.*

**Files:**
- Modify: `messages/ko.json` (`bus` 객체 뒤에 `bike` 추가)
- Modify: `messages/en.json` (동일 위치)

- [ ] **Step 1: ko.json에 추가**

`messages/ko.json`의 `"bus": { ... }` 객체 바로 뒤에 `bike` 키 추가(JSON 콤마 주의):

```json
  "bike": {
    "currentButton": "현재 위치 근처 따릉이",
    "placeButton": "근처 따릉이 대여소",
    "refresh": "새로고침",
    "locating": "현재 위치를 확인하는 중입니다.",
    "loading": "따릉이 대여소를 불러오는 중입니다.",
    "empty": "근처 1km 안에 따릉이 대여소가 없습니다.",
    "error": "따릉이 정보를 불러오지 못했습니다.",
    "geoDenied": "위치 권한이 거부되었습니다.",
    "geoUnsupported": "이 브라우저는 위치 기능을 지원하지 않습니다.",
    "ready": "근처 따릉이 대여소",
    "asOf": "{time} 기준",
    "stationDistance": "도보 {distance}",
    "availability": "대여 가능 {bikes}대 · 거치대 {racks}개",
    "source": "출처: 서울 열린데이터광장 따릉이"
  },
```

- [ ] **Step 2: en.json에 추가**

`messages/en.json`의 `"bus"` 객체 뒤에:

```json
  "bike": {
    "currentButton": "Ttareungyi near me",
    "placeButton": "Bike stations nearby",
    "refresh": "Refresh",
    "locating": "Getting your location…",
    "loading": "Loading bike stations…",
    "empty": "No bike stations within 1 km.",
    "error": "Could not load bike information.",
    "geoDenied": "Location permission denied.",
    "geoUnsupported": "This browser does not support location.",
    "ready": "Nearby bike stations",
    "asOf": "as of {time}",
    "stationDistance": "{distance} walk",
    "availability": "{bikes} available · {racks} racks",
    "source": "Source: Seoul Open Data Plaza (Ttareungyi)"
  },
```

- [ ] **Step 3: 메시지 키 정합 확인**

Run: `npm run test:run` (전체 — 메시지 키 누락 검사 테스트가 있으면 여기서 검출. 없으면 빌드 단계에서)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add messages/ko.json messages/en.json
git commit -m "feat(i18n): 따릉이 bike.* 메시지(ko/en)"
```

---

### Task 7: BikeStations 컴포넌트 + 통합

**Files:**
- Create: `src/components/BikeStations.tsx`
- Modify: `src/components/PlaceDetail.tsx` (BusArrivals 뒤에 BikeStations 삽입)
- Modify: `src/components/PlaceSearch.tsx` (BusArrivals 뒤에 BikeStations 삽입)

- [ ] **Step 1: 컴포넌트 구현(BusArrivals 패턴 복제)**

`src/components/BikeStations.tsx`:

```tsx
"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BikeStation } from "@/lib/types";
import { formatDistance } from "@/lib/format";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "done"; stations: BikeStation[]; at: string };

/**
 * 근처 따릉이 대여소 + 대여 가능 수 — 지도 없이 완결되는 공공자전거 정보.
 *
 * mode="current": 버튼 → geolocation → 현재 위치 좌표로 조회.
 * mode="place":   상세 화면의 장소 좌표(props)로 바로 조회.
 *
 * 실시간이라 자동 폴링하지 않고 수동 "새로고침"으로 신선도를 보장한다
 * (스크린 리더 반복 통지 방지 — 접근성 결정). BusArrivals와 동형.
 */
export function BikeStations(
  props: { mode: "current" } | { mode: "place"; lat: number; lng: number },
) {
  const t = useTranslations("bike");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const inFlightRef = useRef(false);

  async function fetchAt(lat: number, lng: number) {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(`/api/bike/nearby?lat=${lat}&lng=${lng}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      const stations = (body.stations ?? []) as BikeStation[];
      if (stations.length === 0) {
        setStatus({ kind: "empty" });
        return;
      }
      const at = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      setStatus({ kind: "done", stations, at });
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setStatus({ kind: "error" });
    }
  }

  function load() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const done = () => {
      inFlightRef.current = false;
    };
    if (props.mode === "place") {
      void fetchAt(props.lat, props.lng).finally(done);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus({ kind: "geoerror", reason: "unsupported" });
      done();
      return;
    }
    setStatus({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void fetchAt(pos.coords.latitude, pos.coords.longitude).finally(done);
      },
      () => {
        setStatus({ kind: "geoerror", reason: "denied" });
        done();
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 },
    );
  }

  const busy = status.kind === "locating" || status.kind === "loading";
  const buttonLabel =
    status.kind === "done"
      ? t("refresh")
      : props.mode === "current"
        ? t("currentButton")
        : t("placeButton");

  const live =
    status.kind === "locating"
      ? t("locating")
      : status.kind === "loading"
        ? t("loading")
        : status.kind === "empty"
          ? t("empty")
          : status.kind === "error"
            ? t("error")
            : status.kind === "geoerror"
              ? status.reason === "denied"
                ? t("geoDenied")
                : t("geoUnsupported")
              : status.kind === "done"
                ? t("ready")
                : "";

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={load}
        aria-disabled={busy}
        aria-busy={busy}
        className="min-h-11 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent aria-disabled:opacity-50"
      >
        {buttonLabel}
      </button>

      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        {live}
      </p>

      {status.kind === "done" && (
        <section
          aria-labelledby={headingId}
          className="mt-2 rounded-md border border-border p-3"
        >
          <h3
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            {t("ready")}
            <span className="ml-2 text-xs font-normal opacity-70">
              {t("asOf", { time: status.at })}
            </span>
          </h3>

          <ul className="mt-2 space-y-3">
            {status.stations.map((s) => (
              <li key={s.stationId}>
                <p className="font-medium" lang="ko">
                  {s.name}{" "}
                  <span className="text-xs font-normal opacity-70">
                    {t("stationDistance", {
                      distance: formatDistance(s.distanceMeters),
                    })}
                  </span>
                </p>
                <p className="text-sm">
                  {t("availability", {
                    bikes: s.bikesAvailable,
                    racks: s.racksTotal,
                  })}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: PlaceDetail 통합**

`src/components/PlaceDetail.tsx` 상단 import에 추가(BusArrivals import 옆):

```tsx
import { BikeStations } from "./BikeStations";
```

그리고 `<BusArrivals mode="place" lat={place.lat} lng={place.lng} />`(약 99행) **바로 뒤 줄**에 추가:

```tsx
        <BikeStations mode="place" lat={place.lat} lng={place.lng} />
```

- [ ] **Step 3: PlaceSearch 통합**

`src/components/PlaceSearch.tsx` 상단 import에 추가:

```tsx
import { BikeStations } from "./BikeStations";
```

그리고 `<BusArrivals mode="current" />`(약 292행) **바로 뒤 줄**에 추가:

```tsx
          <BikeStations mode="current" />
```

- [ ] **Step 4: 타입체크 + lint + 전체 테스트**

Run: `npx tsc --noEmit && npm run lint && npm run test:run`
Expected: 모두 통과.

- [ ] **Step 5: Commit**

```bash
git add src/components/BikeStations.tsx src/components/PlaceDetail.tsx src/components/PlaceSearch.tsx
git commit -m "feat(bike): BikeStations 컴포넌트 + 장소상세·홈 통합"
```

---

### Task 8: 실호출 게이트 + 문서 + a11y 점검

**Files:**
- Modify: `CLAUDE.md` (API 키 현황 표 + provider 섹션)
- Modify: `docs/SPEC.md` (실험 백로그 갱신)
- 확인: `.env.local`에 `SEOUL_OPEN_DATA_KEY` 존재(이미 있음)

- [ ] **Step 1: 빌드 검증**

Run: `npm run build`
Expected: 성공(라우트 `/api/bike/nearby` 포함).

- [ ] **Step 2: 실호출 게이트(로컬)**

```bash
npm run dev &  # 또는 이미 실행 중
sleep 4
curl -s "http://localhost:3000/api/bike/nearby?lat=37.5385&lng=127.1378" | head -c 600
```
Expected: `{"stations":[{"stationId":"ST-...","name":"... 길동 ...","bikesAvailable":..,"racksTotal":..,"distanceMeters":..}, ...]}` — 길동 마루빌딩 등 실데이터, 모든 distanceMeters ≤ 1000, 최대 5건.

- [ ] **Step 3: a11y 점검**

`a11y-auditor` 서브에이전트로 `BikeStations.tsx` 점검(과잉 ARIA 없는지 — aria-live polite 단일, 시각 텍스트 덮는 aria-label 없는지, 버튼 이름 자연 계산).

- [ ] **Step 4: 문서 갱신**

`CLAUDE.md` API 키 현황 표에 `SEOUL_OPEN_DATA_KEY` 행 추가(동작 확인 2026-06-16, 따릉이 INFO-000, 서울 버스는 ws.bus.go.kr 전파 대기). provider 섹션에 따릉이 한 줄. `docs/SPEC.md` 실험 백로그에서 따릉이 행을 "구현 완료"로 갱신.

- [ ] **Step 5: AGENTS.md 동기화**

```bash
cd /Users/hunyongkim/Mac-Projects && python sync_agent_docs.py
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/SPEC.md AGENTS.md
git commit -m "docs(bike): 따릉이 연동 — 키 현황·provider·백로그 갱신"
```

- [ ] **Step 7: 프로덕션 env + 재배포(사용자 요청 시)**

`SEOUL_OPEN_DATA_KEY`를 Vercel Production env에 등록 후 재배포해야 프로덕션에서 동작(env는 배포 시점 주입). 등록·배포·push는 사용자 요청 시에만.

```bash
printf '%s' "$SEOUL_OPEN_DATA_KEY" | vercel env add SEOUL_OPEN_DATA_KEY production
vercel deploy --prod --yes
```

---

## Self-Review (작성자 점검)

- **Spec 커버리지**: 데이터소스(Task 3·4)·전체fetch+Haversine(Task 4)·60초 캐시(Task 4)·1km cap(Task 4)·graceful(Task 4·5)·두 곳 노출(Task 7)·게이트 테스트(Task 3·4)·실호출 게이트(Task 8)·env(Task 2·8) 모두 매핑됨.
- **타입 정합**: `BikeStation`(stationId/name/lat/lng/distanceMeters/racksTotal/bikesAvailable)이 Task 1 정의와 파서(Task 3)·컴포넌트(Task 7)에서 일치. `fetchNearbyBikeStations`·`parseBikeStations`·`parseBikeRows`·`hasSeoulOpenDataKey` 시그니처 전 Task 일치.
- **Placeholder 없음**: 모든 코드 블록 실제 코드. "유사" 참조 없음(BusArrivals는 전체 복제 코드 제공).
- **주의**: Task 6의 JSON 콤마 — `bus` 객체 뒤 `bike` 추가 시 직전 객체에 콤마 필요. Task 7 통합 행 번호(99·292)는 근사치라 실제 BusArrivals 줄을 grep로 확인 후 그 뒤에 삽입.

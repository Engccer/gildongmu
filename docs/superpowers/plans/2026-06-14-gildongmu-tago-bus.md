# TAGO 시내버스 도착·정류소 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 위치 또는 검색한 장소 좌표에서 근접 버스 정류소와 실시간 도착 예정 버스(저상버스 여부 포함)를 텍스트로 조회해, 지도 없이 스크린 리더만으로 완결되게 한다.

**Architecture:** `tago-bus.ts` provider 한 벌이 TAGO 3종 API(A-2 근접정류소 → A-1 도착예정 병렬 → A-3 경유정류소 lazy)를 호출하고, 순수 파서로 정규화한다. UI는 `BusArrivals` 컴포넌트가 `mode:"current"|"place"`로 좌표 출처만 분기하며, `StationFacilities`의 온디맨드 상태머신 패턴을 재사용한다. 인증은 `DATA_GO_KR_API_KEY`(코레일과 공유), 새 env 없음.

**Tech Stack:** Next.js 16 App Router(Route Handler), TypeScript, Vitest(순수 파서), next-intl, React 19 client component, 브라우저 Geolocation API.

**선행 문서:** `docs/superpowers/specs/2026-06-14-gildongmu-tago-bus-design.md`

**전제조건(사용자 액션):** data.go.kr에서 TAGO 3종(15098534·15098530·15098529) 활용신청 완료. 미완이면 파서 단위 테스트(fixture 기반)는 통과하나 실호출 라우트는 502. 키 승인 후 fixture를 실응답으로 교정한다(Task 10).

---

## File Structure

```
src/lib/types.ts                              수정 — BusStop/BusArrival/BusRouteStop 추가
src/lib/providers/tago-bus.ts                 신규 — Haversine + 3종 파서 + fetch 래퍼
src/lib/__tests__/tago-bus.test.ts            신규 — 파서·Haversine·graceful 테스트
src/lib/__tests__/fixtures/tago-bus.json      신규 — 예상 envelope fixture
src/app/api/bus/nearby/route.ts               신규 — A-2+A-1 묶음 (lat/lng → stops)
src/app/api/bus/route/route.ts                신규 — A-3 lazy (cityCode/routeId → stops)
messages/ko.json, messages/en.json            수정 — bus.* 라벨
src/components/BusArrivals.tsx                 신규 — 정류소+도착, mode 분기, 수동 새로고침
src/components/BusRouteStops.tsx              신규 — 경유정류소 펼치기(lazy)
src/components/PlaceDetail.tsx                 수정 — BusArrivals(mode="place") 삽입
src/app/[locale]/page.tsx                      수정 — hasDataGoKrKey() prop 전달
src/components/PlaceSearch.tsx                 수정 — canShowBus prop + "내 주변 버스"(mode="current") 진입
```

각 파일은 단일 책임을 가진다: provider는 외부 API↔도메인 타입 변환만, route는 HTTP 경계만, 컴포넌트는 표현·상호작용만.

---

## Task 1: 도메인 타입 추가

**Files:**
- Modify: `src/lib/types.ts` (파일 끝에 추가)

- [ ] **Step 1: 타입 추가**

`src/lib/types.ts` 파일 끝에 다음을 추가한다:

```ts
/**
 * 버스 정류소 하나 — TAGO 근접정류소(A-2) + 도착예정(A-1) + 계산 거리.
 * 좌표는 WGS84 십진 도. nodeId·cityCode는 도착(A-1)·경유정류소(A-3) 조회 키.
 */
export interface BusStop {
  nodeId: string;
  cityCode: string;
  /** 정류소명(한글 — TAGO는 영문 미제공) */
  name: string;
  /** 정류소 표지판 번호(없을 수 있음) */
  stopNo?: string;
  lat: number;
  lng: number;
  /** 출발 좌표로부터 Haversine 거리(m) — 정렬·표시용 */
  distanceMeters: number;
  /** 도착 예정 버스(도착 임박 순) */
  arrivals: BusArrival[];
}

/** 정류소에 도착 예정인 버스 하나 — TAGO 도착정보(A-1) 정규화. */
export interface BusArrival {
  /** 노선 ID — 경유정류소(A-3) 조회 키 */
  routeId: string;
  /** 노선번호(예 "272") */
  routeNo: string;
  /** 노선유형(한글, 예 "간선버스") */
  routeType: string;
  /** 도착 예정(초) */
  arrivalSeconds: number;
  /** 남은 정류장 수 */
  prevStationCount: number;
  /** 저상버스 여부(vehicletp에 "저상" 포함) — 교통약자 정본 */
  lowFloor: boolean;
}

/** 노선 경유정류소 하나 — TAGO 노선정보(A-3) 정규화. */
export interface BusRouteStop {
  nodeId: string;
  name: string;
  /** 정류소 순번(nodeord) */
  order: number;
  lat: number;
  lng: number;
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음(새 타입은 아직 미사용이라 통과).

- [ ] **Step 3: 커밋**

```bash
git add src/lib/types.ts
git commit -m "feat(types): TAGO 버스 도메인 타입(BusStop/BusArrival/BusRouteStop)"
```

---

## Task 2: Haversine + 순수 파서 (TDD)

**Files:**
- Create: `src/lib/__tests__/fixtures/tago-bus.json`
- Create: `src/lib/providers/tago-bus.ts`
- Create: `src/lib/__tests__/tago-bus.test.ts`

> 파서는 TAGO data.go.kr 표준 envelope(`response.body.items.item`)를 코레일과 동일하게 가정한다. 실응답은 활용신청 후 Task 10에서 교정한다. fixture는 그 가정에 맞춘 **예상 형태**다.

- [ ] **Step 1: fixture 작성**

`src/lib/__tests__/fixtures/tago-bus.json`:

```json
{
  "nearbyStops": {
    "response": {
      "header": { "resultCode": "00", "resultMsg": "NORMAL SERVICE." },
      "body": {
        "items": {
          "item": [
            { "citycode": 23, "gpslati": 35.1795, "gpslong": 129.0756, "nodeid": "DGB7011001400", "nodenm": "부산역", "nodeno": 7011 },
            { "citycode": 23, "gpslati": 35.1810, "gpslong": 129.0760, "nodeid": "DGB7011001500", "nodenm": "부산역환승센터", "nodeno": 7012 }
          ]
        },
        "numOfRows": 10, "pageNo": 1, "totalCount": 2
      }
    }
  },
  "arrivals": {
    "response": {
      "header": { "resultCode": "00", "resultMsg": "NORMAL SERVICE." },
      "body": {
        "items": {
          "item": [
            { "routeid": "DGB3000", "routeno": 1003, "routetp": "급행버스", "arrtime": 720, "arrprevstationcnt": 5, "vehicletp": "일반차량", "nodeid": "DGB7011001400", "nodenm": "부산역" },
            { "routeid": "DGB3001", "routeno": 81, "routetp": "일반버스", "arrtime": 180, "arrprevstationcnt": 2, "vehicletp": "저상버스", "nodeid": "DGB7011001400", "nodenm": "부산역" }
          ]
        },
        "numOfRows": 50, "pageNo": 1, "totalCount": 2
      }
    }
  },
  "routeStops": {
    "response": {
      "header": { "resultCode": "00", "resultMsg": "NORMAL SERVICE." },
      "body": {
        "items": {
          "item": [
            { "nodeid": "DGB7011001400", "nodenm": "부산역", "nodeord": 1, "gpslati": 35.1795, "gpslong": 129.0756 },
            { "nodeid": "DGB7011002000", "nodenm": "중앙동", "nodeord": 2, "gpslati": 35.1830, "gpslong": 129.0700 }
          ]
        },
        "numOfRows": 200, "pageNo": 1, "totalCount": 2
      }
    }
  },
  "empty": { "response": { "header": { "resultCode": "00", "resultMsg": "NORMAL SERVICE." }, "body": { "items": "", "numOfRows": 10, "pageNo": 1, "totalCount": 0 } } },
  "serviceError": { "OpenAPI_ServiceResponse": { "cmmMsgHeader": { "errMsg": "SERVICE ERROR", "returnAuthMsg": "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", "returnReasonCode": "30" } } }
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/__tests__/tago-bus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fixture from "./fixtures/tago-bus.json";
import {
  parseTagoItems,
  haversineMeters,
  parseBusStops,
  parseBusArrivals,
  parseBusRouteStops,
} from "../providers/tago-bus";

describe("parseTagoItems", () => {
  it("envelope에서 item 배열을 뽑는다", () => {
    expect(parseTagoItems(fixture.nearbyStops).length).toBe(2);
  });
  it("빈 결과(items:'')는 빈 배열", () => {
    expect(parseTagoItems(fixture.empty)).toEqual([]);
    expect(parseTagoItems(null)).toEqual([]);
    expect(parseTagoItems({})).toEqual([]);
  });
  it("item이 단일 객체로 와도 배열로 정규화", () => {
    const single = { response: { body: { items: { item: { nodeid: "X" } } } } };
    expect(parseTagoItems(single).length).toBe(1);
  });
});

describe("haversineMeters", () => {
  it("같은 점은 0", () => {
    expect(haversineMeters(35.1795, 129.0756, 35.1795, 129.0756)).toBe(0);
  });
  it("부산역↔부산역환승센터 ≈ 170m(±30m)", () => {
    const d = haversineMeters(35.1795, 129.0756, 35.181, 129.076);
    expect(d).toBeGreaterThan(140);
    expect(d).toBeLessThan(200);
  });
});

describe("parseBusStops", () => {
  it("정류소를 거리 오름차순으로 정렬한다", () => {
    // 출발점을 첫 정류소 좌표로 → 그 정류소가 distance 0으로 맨 앞
    const stops = parseBusStops(fixture.nearbyStops, 35.1795, 129.0756);
    expect(stops.length).toBe(2);
    expect(stops[0].name).toBe("부산역");
    expect(stops[0].distanceMeters).toBe(0);
    expect(stops[0].nodeId).toBe("DGB7011001400");
    expect(stops[0].cityCode).toBe("23");
    expect(stops[0].stopNo).toBe("7011");
    expect(stops[1].distanceMeters).toBeGreaterThan(stops[0].distanceMeters);
    expect(stops[0].arrivals).toEqual([]);
  });
  it("좌표 결측 항목은 제외", () => {
    const raw = { response: { body: { items: { item: [{ nodeid: "X", nodenm: "결측", citycode: 1 }] } } } };
    expect(parseBusStops(raw, 35, 129)).toEqual([]);
  });
});

describe("parseBusArrivals", () => {
  it("도착 임박 순으로 정렬하고 저상버스를 판정한다", () => {
    const arr = parseBusArrivals(fixture.arrivals);
    expect(arr.length).toBe(2);
    // arrtime 180(81번)이 720(1003번)보다 먼저
    expect(arr[0].routeNo).toBe("81");
    expect(arr[0].arrivalSeconds).toBe(180);
    expect(arr[0].prevStationCount).toBe(2);
    expect(arr[0].lowFloor).toBe(true);
    expect(arr[0].routeId).toBe("DGB3001");
    expect(arr[1].routeNo).toBe("1003");
    expect(arr[1].lowFloor).toBe(false);
  });
  it("빈 결과는 빈 배열", () => {
    expect(parseBusArrivals(fixture.empty)).toEqual([]);
  });
});

describe("parseBusRouteStops", () => {
  it("순번(nodeord) 오름차순으로 정렬", () => {
    const stops = parseBusRouteStops(fixture.routeStops);
    expect(stops.map((s) => s.order)).toEqual([1, 2]);
    expect(stops[0].name).toBe("부산역");
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/tago-bus.test.ts`
Expected: FAIL — `tago-bus.ts`의 export가 없어 import 에러.

- [ ] **Step 4: provider 순수부 구현**

`src/lib/providers/tago-bus.ts`:

```ts
import type { BusArrival, BusRouteStop, BusStop } from "../types";

/**
 * 국토교통부 TAGO(국가대중교통정보센터) 시내버스 provider.
 *
 * 3종 data.go.kr API(인증: DATA_GO_KR_API_KEY 공유):
 * - A-2 BusSttnInfoInqireService/getCrdntPrxmtSttnList — 좌표 근접 정류소
 * - A-1 ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList — 정류소별 도착예정
 * - A-3 BusRouteInfoInqireService/getRouteAcctoThrghSttnList — 노선 경유정류소
 *
 * data.go.kr 표준 envelope(response.body.items.item, 빈결과 items:"")를
 * 코레일 편의시설과 동일하게 가정한다. 거리 정렬은 Haversine로 직접 계산한다
 * (A-2가 거리순을 보장하지 않으므로 — 산술은 코드의 책임).
 */

type RawItem = Record<string, unknown>;

/** data.go.kr 표준 envelope에서 item 배열을 안전 추출(코레일과 동일 규약). */
export function parseTagoItems(raw: unknown): RawItem[] {
  const items = (raw as { response?: { body?: { items?: unknown } } })?.response
    ?.body?.items;
  if (!items || items === "") return [];
  const item = (items as { item?: unknown }).item;
  if (Array.isArray(item)) return item as RawItem[];
  if (item && typeof item === "object") return [item as RawItem];
  return [];
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

/** 두 WGS84 좌표 간 대원거리(m). */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))));
}

/** A-2 응답 → 거리 오름차순 BusStop[](도착정보는 빈 배열로 시작). */
export function parseBusStops(
  raw: unknown,
  originLat: number,
  originLng: number,
): BusStop[] {
  return parseTagoItems(raw)
    .map((it): BusStop => {
      const lat = numF(it.gpslati);
      const lng = numF(it.gpslong);
      return {
        nodeId: str(it.nodeid),
        cityCode: str(it.citycode),
        name: str(it.nodenm),
        stopNo: it.nodeno != null && str(it.nodeno) !== "" ? str(it.nodeno) : undefined,
        lat,
        lng,
        distanceMeters: haversineMeters(originLat, originLng, lat, lng),
        arrivals: [],
      };
    })
    .filter((s) => s.nodeId && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/** A-1 응답 → 도착 임박 순 BusArrival[]. */
export function parseBusArrivals(raw: unknown): BusArrival[] {
  return parseTagoItems(raw)
    .map((it): BusArrival => ({
      routeId: str(it.routeid),
      routeNo: str(it.routeno),
      routeType: str(it.routetp),
      arrivalSeconds: nonNegInt(it.arrtime),
      prevStationCount: nonNegInt(it.arrprevstationcnt),
      lowFloor: str(it.vehicletp).includes("저상"),
    }))
    .filter((a) => a.routeNo)
    .sort((a, b) => a.arrivalSeconds - b.arrivalSeconds);
}

/** A-3 응답 → 순번 오름차순 BusRouteStop[]. */
export function parseBusRouteStops(raw: unknown): BusRouteStop[] {
  return parseTagoItems(raw)
    .map((it): BusRouteStop => ({
      nodeId: str(it.nodeid),
      name: str(it.nodenm),
      order: nonNegInt(it.nodeord),
      lat: numF(it.gpslati),
      lng: numF(it.gpslong),
    }))
    .filter((s) => s.nodeId)
    .sort((a, b) => a.order - b.order);
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/tago-bus.test.ts`
Expected: PASS (모든 describe 통과).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/providers/tago-bus.ts src/lib/__tests__/tago-bus.test.ts src/lib/__tests__/fixtures/tago-bus.json
git commit -m "feat(tago): 버스 정류소·도착·경유정류소 순수 파서 + Haversine (TDD)"
```

---

## Task 3: provider fetch 래퍼 + graceful (TDD)

**Files:**
- Modify: `src/lib/providers/tago-bus.ts`
- Modify: `src/lib/__tests__/tago-bus.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가**

`src/lib/__tests__/tago-bus.test.ts` 상단 import 아래에 env 모킹을 추가하고(파일 맨 위), fetch 모킹 테스트를 파일 끝에 붙인다.

파일 **맨 위**(기존 import들 위)에:

```ts
import { afterEach, vi } from "vitest";

vi.mock("../env", () => ({
  env: { DATA_GO_KR_API_KEY: "test-key" },
}));
```

> 주의: 기존 `import { describe, it, expect } from "vitest";`에 `afterEach, vi`를 합쳐 한 줄로 두어도 된다. `vi.mock`은 호이스팅되므로 provider import보다 위에 있으면 된다.

파일 **끝**에 추가:

```ts
import { fetchNearbyBusStops, fetchBusRouteStops } from "../providers/tago-bus";

function mockFetchSequence(...payloads: unknown[]) {
  const fn = vi.fn();
  for (const p of payloads) {
    fn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(p),
    });
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchNearbyBusStops", () => {
  it("근접 정류소 + 각 정류소 도착정보를 병렬로 채운다", async () => {
    // 1) A-2 nearbyStops, 2) 정류소1 A-1, 3) 정류소2 A-1
    mockFetchSequence(fixture.nearbyStops, fixture.arrivals, fixture.empty);
    const stops = await fetchNearbyBusStops(35.1795, 129.0756);
    expect(stops.length).toBe(2);
    expect(stops[0].arrivals.length).toBe(2); // fixture.arrivals
    expect(stops[1].arrivals).toEqual([]); // fixture.empty
  });

  it("한 정류소 도착조회 실패해도 나머지는 보존(allSettled)", async () => {
    const fn = vi.fn();
    fn.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(fixture.nearbyStops) });
    fn.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err" }); // 정류소1 실패
    fn.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(fixture.arrivals) }); // 정류소2 성공
    vi.stubGlobal("fetch", fn);
    const stops = await fetchNearbyBusStops(35.1795, 129.0756);
    expect(stops[0].arrivals).toEqual([]); // 실패 → 빈 배열
    expect(stops[1].arrivals.length).toBe(2);
  });

  it("서비스 에러 envelope는 throw(정보 없음과 구분)", async () => {
    mockFetchSequence(fixture.serviceError);
    await expect(fetchNearbyBusStops(35.1795, 129.0756)).rejects.toThrow();
  });
});

describe("fetchBusRouteStops", () => {
  it("경유정류소를 순번 순으로 반환", async () => {
    mockFetchSequence(fixture.routeStops);
    const stops = await fetchBusRouteStops("23", "DGB3000");
    expect(stops.map((s) => s.order)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/tago-bus.test.ts`
Expected: FAIL — `fetchNearbyBusStops`, `fetchBusRouteStops` 미정의.

- [ ] **Step 3: fetch 래퍼 구현**

`src/lib/providers/tago-bus.ts` 끝에 추가(상단 import에 `import { env } from "../env";` 추가):

```ts
import { env } from "../env";

const STN_BASE = "http://apis.data.go.kr/1613000/BusSttnInfoInqireService";
const ARV_BASE = "http://apis.data.go.kr/1613000/ArvlInfoInqireService";
const RTE_BASE = "http://apis.data.go.kr/1613000/BusRouteInfoInqireService";

/**
 * TAGO 한 오퍼레이션을 호출하고 표준 envelope JSON을 돌려준다.
 *
 * graceful 원칙: HTTP 실패·JSON 아님·서비스 에러 envelope는 throw(라우트가
 * 502로 변환, "조회 실패"와 "정보 없음"을 구분). 정상 빈결과(resultCode "00"
 * + items:"")는 throw하지 않고 그대로 반환해 파서가 빈 배열을 만든다.
 */
async function fetchTago(
  base: string,
  op: string,
  params: Record<string, string | number>,
  init?: RequestInit & { next?: { revalidate: number } },
): Promise<unknown> {
  const key = env.DATA_GO_KR_API_KEY!;
  const url = new URL(`${base}/${op}`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("_type", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, init ?? { cache: "no-store" });
  if (!res.ok) throw new Error(`TAGO ${op} HTTP ${res.status}`);

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // 인증 실패 등은 _type=json이어도 XML 에러로 오기도 한다.
    throw new Error(`TAGO ${op} 비정상 응답: ${text.slice(0, 200)}`);
  }

  const svcErr = (data as { OpenAPI_ServiceResponse?: { cmmMsgHeader?: Record<string, unknown> } })
    .OpenAPI_ServiceResponse;
  if (svcErr) {
    const h = svcErr.cmmMsgHeader ?? {};
    throw new Error(
      `TAGO ${op} 서비스 에러: ${h.returnAuthMsg ?? h.returnReasonCode ?? "unknown"}`,
    );
  }

  const header = (data as { response?: { header?: { resultCode?: unknown; resultMsg?: unknown } } })
    .response?.header;
  const code = header?.resultCode == null ? null : String(header.resultCode);
  // "00"/"0" 정상. NODATA류(03 등)는 정상 빈결과로 통과. 그 외는 장애로 throw.
  if (code != null && code !== "00" && code !== "0") {
    const msg = String(header?.resultMsg ?? code);
    if (code === "03" || /NODATA|NO_?DATA/i.test(msg)) return data;
    throw new Error(`TAGO ${op} resultCode ${code}: ${msg}`);
  }
  return data;
}

/**
 * 좌표 → 근접 정류소 상위 5개 + 각 정류소 도착예정(병렬).
 * 키 없으면 빈 배열(진입점은 키 게이트로 미렌더되므로 방어적).
 */
export async function fetchNearbyBusStops(
  lat: number,
  lng: number,
): Promise<BusStop[]> {
  if (!env.DATA_GO_KR_API_KEY) return [];
  const stnRaw = await fetchTago(STN_BASE, "getCrdntPrxmtSttnList", {
    gpsLati: lat,
    gpsLong: lng,
    numOfRows: 10,
  });
  const stops = parseBusStops(stnRaw, lat, lng).slice(0, 5);
  const settled = await Promise.allSettled(
    stops.map((s) =>
      fetchTago(ARV_BASE, "getSttnAcctoArvlPrearngeInfoList", {
        cityCode: s.cityCode,
        nodeId: s.nodeId,
        numOfRows: 50,
      }),
    ),
  );
  return stops.map((s, i) => {
    const r = settled[i];
    if (r.status === "rejected") {
      console.error(`[tago] 도착조회 실패 ${s.name}:`, r.reason);
      return { ...s, arrivals: [] };
    }
    return { ...s, arrivals: parseBusArrivals(r.value) };
  });
}

/** 노선 경유정류소(거의 불변 → 하루 캐시). */
export async function fetchBusRouteStops(
  cityCode: string,
  routeId: string,
): Promise<BusRouteStop[]> {
  if (!env.DATA_GO_KR_API_KEY) return [];
  const raw = await fetchTago(
    RTE_BASE,
    "getRouteAcctoThrghSttnList",
    { cityCode, routeId, numOfRows: 200 },
    { next: { revalidate: 86_400 } },
  );
  return parseBusRouteStops(raw);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/tago-bus.test.ts`
Expected: PASS.

- [ ] **Step 5: 전체 게이트 테스트**

Run: `npm run test:run`
Expected: PASS (기존 + 신규 전부).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/providers/tago-bus.ts src/lib/__tests__/tago-bus.test.ts
git commit -m "feat(tago): 근접정류소+도착 병렬 fetch 래퍼, graceful 에러 분리 (TDD)"
```

---

## Task 4: API Route Handlers

**Files:**
- Create: `src/app/api/bus/nearby/route.ts`
- Create: `src/app/api/bus/route/route.ts`

> 기존 `src/app/api/station/facilities/route.ts`의 형태(쿼리 파싱 → provider 호출 → throw 시 502)를 따른다.

- [ ] **Step 1: nearby 라우트 구현**

`src/app/api/bus/nearby/route.ts`:

```ts
import { NextResponse } from "next/server";
import { hasDataGoKrKey } from "@/lib/env";
import { fetchNearbyBusStops } from "@/lib/providers/tago-bus";

/**
 * GET /api/bus/nearby?lat=..&lng=..
 * 좌표 근접 정류소 + 각 정류소 도착예정. 실시간이라 캐시하지 않는다.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat/lng 필요" }, { status: 400 });
  }
  if (!hasDataGoKrKey()) {
    return NextResponse.json({ stops: [] });
  }
  try {
    const stops = await fetchNearbyBusStops(lat, lng);
    return NextResponse.json({ stops });
  } catch (e) {
    console.error("[api/bus/nearby]", e);
    return NextResponse.json({ error: "버스 정보 조회 실패" }, { status: 502 });
  }
}
```

- [ ] **Step 2: route(경유정류소) 라우트 구현**

`src/app/api/bus/route/route.ts`:

```ts
import { NextResponse } from "next/server";
import { hasDataGoKrKey } from "@/lib/env";
import { fetchBusRouteStops } from "@/lib/providers/tago-bus";

/**
 * GET /api/bus/route?cityCode=..&routeId=..
 * 노선 경유정류소(lazy, 펼칠 때만). 거의 불변이라 provider에서 하루 캐시.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cityCode = searchParams.get("cityCode") ?? "";
  const routeId = searchParams.get("routeId") ?? "";
  if (!cityCode || !routeId) {
    return NextResponse.json({ error: "cityCode/routeId 필요" }, { status: 400 });
  }
  if (!hasDataGoKrKey()) {
    return NextResponse.json({ stops: [] });
  }
  try {
    const stops = await fetchBusRouteStops(cityCode, routeId);
    return NextResponse.json({ stops });
  } catch (e) {
    console.error("[api/bus/route]", e);
    return NextResponse.json({ error: "경유 정류소 조회 실패" }, { status: 502 });
  }
}
```

- [ ] **Step 3: 타입체크·빌드**

Run: `npx tsc --noEmit && npm run build`
Expected: 성공(라우트가 빌드에 잡힘).

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/bus/nearby/route.ts src/app/api/bus/route/route.ts
git commit -m "feat(api): /api/bus/nearby·/api/bus/route — TAGO 버스 라우트 (502 graceful)"
```

---

## Task 5: i18n 메시지(bus.*)

**Files:**
- Modify: `messages/ko.json`
- Modify: `messages/en.json`

- [ ] **Step 1: ko.json에 bus 섹션 추가**

`messages/ko.json`의 최상위에 `"bus"` 키를 추가한다(`station` 옆):

```json
"bus": {
  "currentButton": "내 주변 버스 도착 정보",
  "placeButton": "근처 정류소·버스 도착",
  "refresh": "새로고침",
  "locating": "현재 위치 확인 중…",
  "loading": "정류소·도착 정보 조회 중…",
  "empty": "주변에 버스 정류소가 없습니다.",
  "error": "버스 정보 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  "ready": "버스 도착 정보가 준비되었습니다.",
  "asOf": "{time} 기준",
  "stopDistance": "약 {distance}",
  "noArrivals": "도착 예정 버스가 없습니다.",
  "lowFloor": "저상버스",
  "normalBus": "일반버스",
  "arrival": "{route} {type}, {prev}번째 전 정류장, 약 {min}분 후 도착",
  "geoDenied": "현재 위치 권한이 필요합니다. 브라우저에서 위치 접근을 허용해 주세요.",
  "geoUnsupported": "이 브라우저는 현재 위치를 지원하지 않습니다.",
  "routeStopsButton": "{route}번 경유 정류소 보기",
  "routeStopsHeading": "{route}번 경유 정류소",
  "routeStopsLoading": "경유 정류소 조회 중…",
  "routeStopsEmpty": "경유 정류소 정보가 없습니다.",
  "routeStopsError": "경유 정류소 조회에 실패했습니다.",
  "source": "출처: 국토교통부 TAGO(국가대중교통정보센터)."
}
```

- [ ] **Step 2: en.json에 bus 섹션 추가**

`messages/en.json`의 최상위에:

```json
"bus": {
  "currentButton": "Bus arrivals near me",
  "placeButton": "Nearby stops & arrivals",
  "refresh": "Refresh",
  "locating": "Getting your location…",
  "loading": "Loading stops & arrivals…",
  "empty": "No bus stops nearby.",
  "error": "Failed to load bus info. Please try again shortly.",
  "ready": "Bus arrival info is ready.",
  "asOf": "as of {time}",
  "stopDistance": "about {distance}",
  "noArrivals": "No buses arriving.",
  "lowFloor": "low-floor bus",
  "normalBus": "standard bus",
  "arrival": "Route {route} {type}, {prev} stops away, in about {min} min",
  "geoDenied": "Location permission is required. Please allow location access in your browser.",
  "geoUnsupported": "This browser does not support location.",
  "routeStopsButton": "Show stops on route {route}",
  "routeStopsHeading": "Stops on route {route}",
  "routeStopsLoading": "Loading route stops…",
  "routeStopsEmpty": "No route stop info.",
  "routeStopsError": "Failed to load route stops.",
  "source": "Source: MOLIT TAGO (National Transport Information Center)."
}
```

- [ ] **Step 3: JSON 유효성 + 빌드**

Run: `node -e "require('./messages/ko.json');require('./messages/en.json');console.log('ok')" && npm run build`
Expected: `ok` + 빌드 성공.

- [ ] **Step 4: 커밋**

```bash
git add messages/ko.json messages/en.json
git commit -m "feat(i18n): 버스 도착·경유정류소 라벨(ko/en)"
```

---

## Task 6: BusArrivals 컴포넌트

**Files:**
- Create: `src/components/BusArrivals.tsx`

> `StationFacilities.tsx`의 온디맨드 상태머신·in-flight ref·aria-live·헤딩 포커스 패턴을 재사용한다. 추가로 `mode:"current"`는 geolocation 단계를, 두 모드 공통으로 수동 새로고침·조회시각을 가진다. 이 프로젝트는 컴포넌트 단위 테스트가 없으므로(기존 패턴) 타입체크·lint·빌드로 게이트한다.

- [ ] **Step 1: 구현**

`src/components/BusArrivals.tsx`:

```tsx
"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BusStop } from "@/lib/types";
import { formatDistance, durationToMinutes } from "@/lib/format";
import { BusRouteStops } from "./BusRouteStops";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "done"; stops: BusStop[]; at: string };

/**
 * 근처 정류소 + 도착 예정 버스 — 지도 없이 완결되는 대중교통 정보 정본.
 *
 * mode="current": 버튼 → geolocation → 현재 위치 좌표로 조회.
 * mode="place":   상세 화면의 장소 좌표(props)로 바로 조회(위치 단계 없음).
 *
 * 실시간이라 자동 폴링하지 않고 수동 "새로고침" + 조회시각으로 신선도를 보장한다
 * (스크린 리더에 반복 통지가 끼어들지 않도록 — 접근성 결정).
 */
export function BusArrivals(
  props:
    | { mode: "current" }
    | { mode: "place"; lat: number; lng: number },
) {
  const t = useTranslations("bus");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const inFlightRef = useRef(false);

  async function fetchAt(lat: number, lng: number) {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/bus/nearby?lat=${lat}&lng=${lng}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      const stops = (body.stops ?? []) as BusStop[];
      if (stops.length === 0) {
        setStatus({ kind: "empty" });
        return;
      }
      const at = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      setStatus({ kind: "done", stops, at });
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
    // current 모드 — geolocation
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
            {status.stops.map((stop) => (
              <li key={`${stop.cityCode}-${stop.nodeId}`}>
                <p className="font-medium" lang="ko">
                  {stop.name}{" "}
                  <span className="text-xs font-normal opacity-70">
                    {t("stopDistance", {
                      distance: formatDistance(stop.distanceMeters),
                    })}
                  </span>
                </p>
                {stop.arrivals.length === 0 ? (
                  <p className="text-sm opacity-70">{t("noArrivals")}</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm">
                    {stop.arrivals.map((a) => (
                      <li key={a.routeId}>
                        <span lang="ko">
                          {t("arrival", {
                            route: a.routeNo,
                            type: a.routeType || (a.lowFloor ? t("lowFloor") : t("normalBus")),
                            prev: a.prevStationCount,
                            min: durationToMinutes(a.arrivalSeconds),
                          })}
                        </span>
                        {a.lowFloor && (
                          <span className="ml-1 rounded bg-accent/10 px-1 text-xs text-accent">
                            {t("lowFloor")}
                          </span>
                        )}
                        <BusRouteStops
                          cityCode={stop.cityCode}
                          routeId={a.routeId}
                          routeNo={a.routeNo}
                        />
                      </li>
                    ))}
                  </ul>
                )}
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

- [ ] **Step 2: 커밋 보류 — Task 7과 함께 빌드·커밋**

BusArrivals는 BusRouteStops를 import하므로 이 시점 `tsc`는 실패가 정상이다. **커밋하지 말고** Task 7로 이어가 둘을 함께 빌드·커밋한다(빌드 깨진 커밋을 history에 남기지 않기 위해 — 두 컴포넌트는 상호 의존이라 한 단위로 묶는다).

---

## Task 7: BusRouteStops 컴포넌트

**Files:**
- Create: `src/components/BusRouteStops.tsx`

- [ ] **Step 1: 구현**

`src/components/BusRouteStops.tsx`:

```tsx
"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { BusRouteStop } from "@/lib/types";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "done"; stops: BusRouteStop[] };

/**
 * 노선 경유정류소 펼치기 — 도착 버스 항목에서 lazy fetch.
 * 거의 불변 데이터라 서버 라우트가 하루 캐시한다.
 */
export function BusRouteStops({
  cityCode,
  routeId,
  routeNo,
}: {
  cityCode: string;
  routeId: string;
  routeNo: string;
}) {
  const t = useTranslations("bus");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const inFlightRef = useRef(false);

  async function load() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/bus/route?cityCode=${encodeURIComponent(cityCode)}&routeId=${encodeURIComponent(routeId)}`,
      );
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      const stops = (body.stops ?? []) as BusRouteStop[];
      if (stops.length === 0) {
        setStatus({ kind: "empty" });
        return;
      }
      setStatus({ kind: "done", stops });
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setStatus({ kind: "error" });
    } finally {
      inFlightRef.current = false;
    }
  }

  const busy = status.kind === "loading";
  const live =
    status.kind === "loading"
      ? t("routeStopsLoading")
      : status.kind === "empty"
        ? t("routeStopsEmpty")
        : status.kind === "error"
          ? t("routeStopsError")
          : "";

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={load}
        aria-disabled={busy}
        aria-busy={busy}
        className="min-h-11 text-xs font-medium text-accent underline aria-disabled:opacity-50"
      >
        {t("routeStopsButton", { route: routeNo })}
      </button>

      <p aria-live="polite" role="status" className="min-h-4 text-xs">
        {live}
      </p>

      {status.kind === "done" && (
        <section aria-labelledby={headingId} className="mt-1">
          <h4
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-xs font-semibold"
          >
            {t("routeStopsHeading", { route: routeNo })}
          </h4>
          <ol className="mt-1 list-decimal pl-5 text-xs" lang="ko">
            {status.stops.map((s) => (
              <li key={s.nodeId}>{s.name}</li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입체크·lint·빌드**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 모두 성공(BusArrivals ↔ BusRouteStops 상호 해소).

- [ ] **Step 3: 커밋(BusArrivals + BusRouteStops 한 단위)**

```bash
git add src/components/BusArrivals.tsx src/components/BusRouteStops.tsx
git commit -m "feat(ui): BusArrivals(근처 정류소·도착, mode current/place) + BusRouteStops(경유정류소 lazy)"
```

---

## Task 8: PlaceDetail 통합(mode="place")

**Files:**
- Modify: `src/components/PlaceDetail.tsx`

- [ ] **Step 1: BusArrivals 삽입**

`src/components/PlaceDetail.tsx` 상단 import에 추가:

```ts
import { BusArrivals } from "./BusArrivals";
```

`PlaceDetail` 함수 시그니처에 `canShowBus` prop 추가:

```ts
export function PlaceDetail({
  place,
  canBriefCarRoute,
  canShowBus,
  onBack,
}: {
  place: Place;
  canBriefCarRoute: boolean;
  canShowBus: boolean;
  onBack: () => void;
}) {
```

JSX에서 `StationFacilities` 렌더 줄 **아래**에 추가:

```tsx
      {isStation(place) && <StationFacilities stationName={place.name} />}
      {canShowBus && (
        <BusArrivals mode="place" lat={place.lat} lng={place.lng} />
      )}
```

- [ ] **Step 2: 커밋 보류 — Task 9와 함께 빌드·커밋**

`PlaceDetail`에 `canShowBus`를 추가하면 호출처 `PlaceSearch`가 그 prop을 넘기기 전까지 `tsc`가 실패한다(정상). **커밋하지 말고** Task 9로 이어가 둘을 함께 빌드·커밋한다(상호 의존 한 단위).

---

## Task 9: page + PlaceSearch 통합(키 게이트 + 현재위치 진입)

**Files:**
- Modify: `src/app/[locale]/page.tsx`
- Modify: `src/components/PlaceSearch.tsx`

- [ ] **Step 1: page.tsx에서 키 유무 평가·전달**

`src/app/[locale]/page.tsx`를 다음으로 교체:

```tsx
import { setRequestLocale } from "next-intl/server";
import { PlaceSearch } from "@/components/PlaceSearch";
import { activeProviderName } from "@/lib/providers/places";
import { hasKakaoKey, hasDataGoKrKey } from "@/lib/env";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <PlaceSearch
      isMockMode={activeProviderName() === "mock"}
      canBriefCarRoute={hasKakaoKey()}
      canShowBus={hasDataGoKrKey()}
    />
  );
}
```

- [ ] **Step 2: PlaceSearch에 prop·진입점 추가**

`src/components/PlaceSearch.tsx`의 import에 추가:

```ts
import { BusArrivals } from "./BusArrivals";
```

함수 시그니처(props)에 `canShowBus` 추가:

```ts
export function PlaceSearch({
  isMockMode,
  canBriefCarRoute = false,
  canShowBus = false,
}: {
  isMockMode: boolean;
  canBriefCarRoute?: boolean;
  canShowBus?: boolean;
}) {
```

`PlaceDetail`을 렌더하는 곳에 `canShowBus`를 전달한다(파일에서 `<PlaceDetail` 검색):

```tsx
        <PlaceDetail
          place={selected}
          canBriefCarRoute={canBriefCarRoute}
          canShowBus={canShowBus}
          onBack={...}  // 기존 onBack 핸들러 그대로 유지
        />
```

> 기존 `<PlaceDetail ... />`의 props(특히 `onBack`)는 그대로 두고 `canShowBus={canShowBus}` 한 줄만 추가한다.

검색 전(idle) 화면에 "내 주변 버스" 진입을 배치한다. `status.kind === "idle"`일 때 렌더되는 영역(검색 안내/빈 상태)을 찾아, 그 안에 키가 있을 때만 추가한다:

```tsx
      {canShowBus && status.kind === "idle" && (
        <div className="mt-4">
          <BusArrivals mode="current" />
        </div>
      )}
```

> idle 영역의 정확한 위치는 `PlaceSearch.tsx` JSX에서 검색 결과/상세가 아닌 기본 상태 블록이다. 결과 목록·상세와 겹치지 않도록 `status.kind === "idle"` 가드를 유지한다. 상세(selected != null) 표시 중에는 자연히 숨겨진다.

- [ ] **Step 3: 전체 게이트(타입·lint·테스트·빌드)**

Run: `npm run test:run && npx tsc --noEmit && npm run lint && npm run build`
Expected: 모두 PASS/성공.

- [ ] **Step 4: 커밋(PlaceDetail + PlaceSearch + page 한 단위)**

```bash
git add src/components/PlaceDetail.tsx src/app/[locale]/page.tsx src/components/PlaceSearch.tsx
git commit -m "feat(ui): 장소 상세 버스 도착 + 첫 화면 '내 주변 버스' 진입 + 키 게이트(canShowBus)"
```

---

## Task 10: 실호출 검증·fixture 교정 (활용신청 완료 후)

> **전제조건 게이트**: data.go.kr TAGO 3종 활용신청이 승인된 뒤에만 수행. 미승인 상태면 이 Task를 건너뛰고 위 Task 1~9까지 머지한다(파서 테스트는 키 없이 통과).

**Files:**
- 검증 후 필요 시 Modify: `src/lib/__tests__/fixtures/tago-bus.json`, `src/lib/providers/tago-bus.ts`

- [ ] **Step 1: 실 좌표로 nearby 호출**

dev 서버를 띄우고(`npm run dev`) 알려진 좌표(예: 부산역 35.1151,129.0415 또는 서울 강동구청 37.5301,127.1238)로 호출:

Run: `curl -s "http://localhost:3000/api/bus/nearby?lat=37.5301&lng=127.1238" | head -c 1200`
Expected: `{"stops":[...]}` — 정류소·도착이 채워진 JSON.

- [ ] **Step 2: spec 미해결 항목 확정**

design.md §11의 확정 항목을 실응답으로 검증한다:
1. 3종 ServiceKey 공유 여부(셋 다 같은 키로 200).
2. https/http 스킴 — `https://apis.data.go.kr/...`로 바꿔 동작하면 provider의 BASE 3개를 https로 교체.
3. envelope 정합(`response.body.items.item`, 빈결과 `""`, `resultCode "00"`).
4. 필드명(nodeid/nodenm/citycode/gpslati/gpslong/routeno/routetp/arrtime/arrprevstationcnt/vehicletp/nodeord)이 실응답과 일치.

- [ ] **Step 3: fixture·파서 교정(필요 시)**

실응답이 fixture와 다르면 `tago-bus.json`을 실응답 1건으로 교체하고(`docs` 주석에 캡처일자), 파서 필드 매핑을 맞춘 뒤:

Run: `npm run test:run`
Expected: PASS.

- [ ] **Step 4: 저상버스(`vehicletp`) 실값 확인**

실응답에서 `vehicletp` 실제 문자열을 확인한다("저상버스"/"일반차량"이 맞는지). 다르면 `parseBusArrivals`의 `includes("저상")` 판정을 실값에 맞춘다(테스트도 갱신).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/__tests__/fixtures/tago-bus.json src/lib/providers/tago-bus.ts src/lib/__tests__/tago-bus.test.ts
git commit -m "test(tago): 실응답으로 fixture·필드 매핑 교정"
```

---

## Task 11: 문서 갱신 + 마일스톤 리뷰

**Files:**
- Modify: `CLAUDE.md`(API 키 현황 표), `docs/SPEC.md`(실험 백로그)

- [ ] **Step 1: CLAUDE.md 키 현황 갱신**

`gildongmu/CLAUDE.md`의 "API 키 현황" 표에 TAGO 3종 행을 추가(`DATA_GO_KR_API_KEY`가 코레일+TAGO 공용임을 명시), 아키텍처 절에 버스 provider 한 줄 추가.

- [ ] **Step 2: SPEC.md 실험 백로그 갱신**

TAGO 버스(A-1/A-2/A-3)를 "구현 완료"로 이동.

- [ ] **Step 3: AGENTS.md 동기화**

Run: `cd /Users/hunyongkim/Mac-Projects && python sync_agent_docs.py`
Expected: 형제 AGENTS.md 재생성.

- [ ] **Step 4: codex-rescue 마일스톤 리뷰**

마일스톤 완료 직전 `git diff main..HEAD`(또는 커밋 범위)를 codex-rescue에 **`--wait`로** 전달해 cross-cutting invariant를 검토받는다. 리뷰 포커스: graceful 에러 분리(throw vs 빈배열), 키 게이트 정합, allSettled 부분실패 보존, 좌표/거리 단위 일관성. 리뷰 결과는 즉시 지엽 패치하지 말고 아키텍처 수준 대조 후 반영(워크스페이스 규칙).

- [ ] **Step 5: 커밋**

```bash
git add gildongmu/CLAUDE.md gildongmu/docs/SPEC.md gildongmu/AGENTS.md
git commit -m "docs: TAGO 버스 연동 반영(키 현황·백로그·AGENTS 동기화)"
```

---

## Self-Review (작성자 체크 완료)

**1. Spec coverage:** spec §3 아키텍처(Task 2·3·4), §4 저상버스(Task 2 파서 + Task 6 UI), §5 캐싱(Task 3 no-store/revalidate), §6 graceful(Task 3·4), §7 타입(Task 1), §8 파일(전 Task), §9 UI 동작(Task 6·7), §10 테스트(Task 2·3), §11 전제·확정(Task 10). 모든 절에 대응 Task 존재.

**2. Placeholder scan:** "기존 onBack 핸들러 그대로"는 실제 코드 위치 지시(placeholder 아님). idle 영역 위치는 검색 가이드를 명시. 그 외 모든 코드 블록은 완전한 실구현.

**3. Type consistency:** `BusStop.cityCode/nodeId`, `BusArrival.routeId/routeNo`, `fetchNearbyBusStops(lat,lng)`, `fetchBusRouteStops(cityCode,routeId)`, 컴포넌트 props(`mode`,`canShowBus`,`cityCode/routeId/routeNo`) — Task 1~9에서 동일 시그니처로 일관. 라우트 쿼리키(`lat/lng`, `cityCode/routeId`)도 컴포넌트 fetch URL과 일치.

**주의(상호 의존 묶음):** Task 6은 Task 7과, Task 8은 Task 9와 **한 커밋 단위**다(상호 import라 단독으로는 `tsc`가 실패). Task 6·8 끝에서는 커밋하지 않고, Task 7·9 끝에서 두 파일을 함께 add·커밋해 빌드 깨진 커밋을 history에 남기지 않는다. subagent-driven 실행 시 6+7, 8+9를 각각 한 작업 묶음으로 디스패치하면 매 커밋이 그린 상태를 유지한다.

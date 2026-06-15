# 서울 시내버스 API 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TAGO 미수록인 서울 시내버스를 data.go.kr 서울 3종(ws.bus.go.kr)으로 붙여, 강동구 길동에서 근접 정류소·실시간 도착·저상버스가 텍스트로 나오게 한다.

**Architecture:** TAGO와 동일 반환 타입(`BusStop[]`/`BusArrival[]`/`BusRouteStop[]`)으로 정규화하는 별도 `seoul-bus` provider를 만들고, `fetchNearbyBusStops`를 TAGO+서울 `Promise.allSettled` 병렬 병합 진입점으로 승격(좌표 4자리 dedup·거리순·상위 5 cap). `BusStop`/`BusArrival`에 `source` 판별자를 더해 `/api/bus/route`가 올바른 provider로 디스패치한다. UI는 거의 그대로 재사용.

**Tech Stack:** Next.js 16, TypeScript, zod 4, Vitest 4, next-intl 4, data.go.kr serviceKey(`DATA_GO_KR_API_KEY` 재사용), ws.bus.go.kr REST.

---

## 현재 진행 상태 / 다음 세션 재개 가이드 (2026-06-16)

**완료(durable, git):**
- 브랜치 `feat/seoul-bus`.
- 실증 확정: 엔드포인트 `getStationByPos`/`getStationByUid`/`getStaionByRoute`, envelope `msgHeader.headerCd`(`"0"`정상/`"7"`인증실패) + `msgBody.itemList`. ServiceResult 래퍼 없음. (사전 메모 표 교정 완료)
- data.go.kr 서울 3종(15000303·15000314·15000193) **활용신청 [승인]** 완료(2026-06-16, 만료 2028-06-16).
- **Task 2 완료**(커밋 `d60f89d`): `BusSource` 타입 + `BusStop`/`BusArrival`에 `source`, TAGO에 `source:"tago"`. 전체 156 테스트 통과.

**진행 차단(블로커):** ws.bus.go.kr이 우리 키를 `SERVICE KEY IS NOT REGISTERED`(headerCd 7)로 거부.
- 진단 확정: **키는 유효**(같은 `DATA_GO_KR_API_KEY`로 TAGO는 `resultCode 00` 정상), 64자 hex(인코딩 이슈 없음). data.go.kr 활용신청 [승인]은 됐으나 **서울시 자체 서버(ws.bus.go.kr/TOPIS)로의 키 동기화 배치가 미반영**(3시간+ 대기에도 미반영 → 익일 overnight 배치로 추정).
- 즉 "data.go.kr 승인 ✓ ≠ ws.bus.go.kr 즉시 동작". 이건 코드 결함이 아니라 외부 동기화 타이밍.

**다음 세션 재개 절차:**
1. 동기화 반영 여부 먼저 확인(아래 스파이크 1줄). `/tmp` 스크립트는 컴퓨터 재시작 시 사라지므로 아래로 재생성:
   ```bash
   cd ~/Mac-Projects/gildongmu
   export $(grep -E '^DATA_GO_KR_API_KEY=' .env.local | sed 's/[[:space:]]*#.*//' | xargs)
   node --input-type=module -e '
   const K=process.env.DATA_GO_KR_API_KEY;
   const u=new URL("http://ws.bus.go.kr/api/rest/stationinfo/getStationByPos");
   u.searchParams.set("serviceKey",K);u.searchParams.set("resultType","json");
   u.searchParams.set("tmX","127.1378");u.searchParams.set("tmY","37.5385");u.searchParams.set("radius","400");
   const j=JSON.parse(await (await fetch(u)).text());
   console.log("headerCd:",j?.msgHeader?.headerCd, j?.msgHeader?.headerMsg);
   console.log(JSON.stringify(j?.msgBody?.itemList?.[0]??j?.msgBody?.itemList));' < /dev/null
   ```
   - `headerCd "0"` + 정류소 JSON이 나오면 → **동기화 완료**. Task 1 Step 2~4로 진행(강동구 좌표로 근접→arsId 도착→busRouteId 경유정류소 실응답을 `src/lib/__tests__/fixtures/seoul-bus.json`에 캡처, 실 필드명으로 아래 파서 가정 교정).
   - 여전히 `headerCd "7"`이면 → 아직 미동기화. 더 기다리거나, 사용자와 **서울 열린데이터광장(data.seoul.go.kr) 인증키 발급**(ws.bus.go.kr 네이티브 키, 즉시 동작) 경로 전환을 상의. 그 경우 새 env `SEOUL_BUS_API_KEY` 추가 + `seoul-bus.ts`가 그 키 사용(설계의 "새 키 없음" 목표만 양보, 나머지 구조 동일).
2. fixture 확보 후 Task 3~7(seoul provider) → Task 8(병합) → Task 9~10(라우트·UI) → Task 11(실호출 게이트·문서) 순으로 진행.

**세션 종료로 사라지는 것(재생성 필요):** 백그라운드 폴러(`bbpernyq1` 등), `/tmp/seoul-*.mjs`·`/tmp/seoul-fixtures-raw.json`, 인메모리 TaskCreate 목록. → 위 1번 스파이크로 상태만 재확인하면 재개 가능(나머지는 이 문서가 정본).

---

## 사전 메모 (실계약 미확정 — Task 1이 잠금)

서울 API의 정확한 envelope·필드명·도착시간 형식은 **Task 1 실호출로 최종 확정**한다. 이 계획의 파서 코드는 공식 문서 기준 가정값을 쓰며, Task 1에서 실응답과 다르면 **그 자리에서 필드명을 실값으로 교정**하고 이후 태스크는 교정된 이름을 따른다. 문서 기준 가정:

| 오퍼레이션 | 호스트/경로 | 입력 | 핵심 응답 필드(가정) |
|---|---|---|---|
| 근접 정류소 | `ws.bus.go.kr/api/rest/stationinfo/getStationByPos` | `tmX`(경도), `tmY`(위도), `radius`(m), `serviceKey`, `resultType=json` | `arsId`, `stationId`, `stationNm`, `gpsX`(경도), `gpsY`(위도), `dist` |
| 도착정보 | `ws.bus.go.kr/api/rest/stationinfo/getStationByUid` | `arsId`, `serviceKey`, `resultType=json` | `rtNm`(노선번호), `busRouteId`, `arrmsg1`, `traTime1`(초), `busType1`(`"1"`=저상), `staOrd` |
| 노선 경유정류소 | `ws.bus.go.kr/api/rest/busRouteInfo/getStaionByRoute` | `busRouteId`, `serviceKey`, `resultType=json` | `station`(정류소ID), `stationNm`, `gpsX`, `gpsY`, `seq`(순번), `arsId` |

> **2026-06-16 실증 교정**: 오퍼레이션 이름은 data.go.kr 문서가 아닌 실호출 기준. 근접=`getStationByPos`(문서의 `getStaionsByPosList` 아님), 도착=`getStationByUid`(arsId), 노선=`getStaionByRoute`. envelope 실측 확정: `{ "comMsgHeader": {...}, "msgHeader": { "headerCd": "0"|"7"..., "headerMsg": "...", "itemCount": N }, "msgBody": { "itemList": [...]|null } }`. `headerCd "0"`=정상, `"7"`=인증실패(SERVICE KEY IS NOT REGISTERED — 활용신청 필요), 빈결과는 `itemList: null` + `itemCount: 0`. **ServiceResult 래퍼 없음** — `parseSeoulItems`에서 래퍼 벗기기 분기는 불필요(있어도 무해).

## 파일 구조

- Create: `src/lib/providers/seoul-bus.ts` — 서울 provider(파서 + fetch). `src/lib/` React/Next 비의존 유지.
- Create: `src/lib/bus.ts` — 병합 진입점(`fetchNearbyBusStops`, `mergeBusStops`). TAGO·서울을 import하는 중립 계층.
- Create: `src/lib/__tests__/fixtures/seoul-bus.json` — Task 1 실응답 캡처.
- Create: `src/lib/__tests__/seoul-bus.test.ts` — 서울 파서/ fetch 게이트 테스트.
- Create: `src/lib/__tests__/bus-merge.test.ts` — 병합 dedup 테스트.
- Modify: `src/lib/types.ts` — `BusSource` 타입 + `BusStop`/`BusArrival`에 `source`.
- Modify: `src/lib/providers/tago-bus.ts` — 정규화에 `source:"tago"` 추가, 근접 진입점을 `fetchTagoNearby`로 改名(병합 진입점이 호출).
- Modify: `src/app/api/bus/nearby/route.ts` — import를 `@/lib/bus`로 변경(시그니처 동일).
- Modify: `src/app/api/bus/route/route.ts` — `source` 쿼리 파라미터 디스패치.
- Modify: `src/components/BusArrivals.tsx` — 정류소 key에 `source`, 도착에 `source` 전달.
- Modify: `src/components/BusRouteStops.tsx` — `source` prop → `/api/bus/route?source=..`.
- Modify: `messages/ko.json`·`messages/en.json` — `bus.empty` 문구(서울 미수록 안내 제거).
- Modify: `src/lib/__tests__/tago-bus.test.ts` — `source:"tago"` 단언 추가.

---

### Task 1: 활용신청 + 실호출 스파이크 (실계약 잠금)

**목적:** 서울 3종을 기존 키로 활용신청하고, 강동구 길동 좌표로 실호출해 **진짜 envelope·필드명·저상값·도착시간 형식**을 캡처한다. 이 결과가 이후 모든 파서의 정본.

**Files:**
- Create: `src/lib/__tests__/fixtures/seoul-bus.json`
- (임시) `/tmp/seoul-bus-spike.mjs`

- [ ] **Step 1: 활용신청 확인/수행**

data.go.kr에서 아래 3종을 `DATA_GO_KR_API_KEY` 계정으로 활용신청(자동승인). 이미 승인돼 있으면 생략:
- https://www.data.go.kr/data/15000303/openapi.do (정류소정보조회)
- https://www.data.go.kr/data/15000314/openapi.do (버스도착정보조회)
- https://www.data.go.kr/data/15000193/openapi.do (노선정보조회)

> ⚠ **사용자 액션일 수 있음**: 활용신청은 로그인 세션이 필요하다. 에이전트가 바로 못 하면 사용자에게 위 3개 링크 "활용신청" 클릭을 요청. 승인 후 전파 ~10분간 인증오류 가능(TOUR_API_KEY 때와 동일).

- [ ] **Step 2: 스파이크 스크립트로 실호출 + 캡처**

`/tmp/seoul-bus-spike.mjs` 작성 후 실행. 강동구 길동 좌표(위도 37.5385, 경도 127.1378)로 근접 정류소 → 첫 정류소 arsId로 도착정보 → 첫 도착의 busRouteId로 경유정류소를 순차 호출하고 raw JSON을 출력.

```js
// /tmp/seoul-bus-spike.mjs
const KEY = process.env.DATA_GO_KR_API_KEY;
const B = "http://ws.bus.go.kr/api/rest";
const j = async (url) => {
  const r = await fetch(url);
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 400) }; }
};
const u = (path, params) => {
  const url = new URL(`${B}/${path}`);
  url.searchParams.set("serviceKey", KEY);
  url.searchParams.set("resultType", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
};
const near = await j(u("stationinfo/getStaionsByPosList", { tmX: "127.1378", tmY: "37.5385", radius: "500" }));
console.log("=== NEARBY ===\n", JSON.stringify(near, null, 2).slice(0, 2000));
// 위 응답에서 arsId 하나 골라 도착정보, 그 busRouteId로 경유정류소 — 출력 보고 수동 2차 호출
```

Run: `DATA_GO_KR_API_KEY="$DATA_GO_KR_API_KEY" node /tmp/seoul-bus-spike.mjs < /dev/null`
Expected: 강동구 정류소 목록 JSON. (인증오류면 전파 대기 후 재시도.)

- [ ] **Step 3: 도착·경유정류소도 캡처**

Step 2 출력의 실제 `arsId`로 `getStationByUidItem`, 실제 `busRouteId`로 `getStaionByRoute`를 추가 호출(스크립트에 이어붙이거나 수동). 빈결과 케이스(존재하지 않는 arsId)도 한 번 호출해 빈결과 envelope 모양 확보.

- [ ] **Step 4: fixture 저장 + 실계약 노트**

캡처한 raw JSON을 `src/lib/__tests__/fixtures/seoul-bus.json`에 저장. 키: `nearbyStops`, `arrivals`, `routeStops`, `empty`, (가능하면) `serviceError`. 각 응답에서 **실제 필드명**을 확인하고, 사전 메모 표와 다르면 이 plan 문서의 표를 실값으로 수정.

```json
{
  "nearbyStops": { "...": "강동구 근접 정류소 실응답 그대로" },
  "arrivals": { "...": "getStationByUidItem 실응답" },
  "routeStops": { "...": "getStaionByRoute 실응답" },
  "empty": { "...": "빈결과 envelope" },
  "serviceError": { "...": "인증오류/장애 envelope (있으면)" }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/__tests__/fixtures/seoul-bus.json docs/superpowers/plans/2026-06-15-seoul-bus-api.md
git -c user.email=engccer@gmail.com commit -m "feat(bus): 서울 버스 실호출 스파이크 — envelope·필드 fixture 캡처"
```

> **STOP CHECKPOINT:** fixture 확보 전엔 이후 파서 코드의 필드명이 가정값이다. Task 2부터는 fixture의 실제 키 이름을 쓴다. 아래 코드의 `arsId`/`stationNm`/`gpsX`/`busType1`/`traTime1` 등이 실응답과 다르면 교체.

---

### Task 2: 타입 — BusSource 판별자

**Files:**
- Modify: `src/lib/types.ts:147-178` (BusStop, BusArrival)
- Modify: `src/lib/providers/tago-bus.ts` (정규화에 source 추가)
- Modify: `src/lib/__tests__/tago-bus.test.ts`

- [ ] **Step 1: tago 테스트에 source 단언 추가(실패 유도)**

`src/lib/__tests__/tago-bus.test.ts`의 `parseBusStops` 첫 테스트에 추가:

```ts
    expect(stops[0].source).toBe("tago");
```

그리고 `parseBusArrivals` 정렬 테스트에 추가:

```ts
    expect(arr[0].source).toBe("tago");
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- tago-bus`
Expected: FAIL — `source` 프로퍼티 없음(타입/런타임).

- [ ] **Step 3: 타입 추가**

`src/lib/types.ts`에서 `BusStop` 위에 추가:

```ts
/** 버스 정보 제공자 — 병합 후 정류소/노선이 어느 API 소속인지 구분(라우트 디스패치 키). */
export type BusSource = "tago" | "seoul";
```

`BusStop` 인터페이스에 추가:

```ts
  /** 제공자 — "tago"(경기·지방·부산) | "seoul"(서울 TOPIS). 경유정류소 조회 디스패치에 사용. */
  source: BusSource;
```

`BusArrival` 인터페이스에 추가:

```ts
  /** 제공자 — 경유정류소 조회를 올바른 provider로 보내는 키. */
  source: BusSource;
```

- [ ] **Step 4: tago provider에 source 채우기**

`src/lib/providers/tago-bus.ts`의 `parseBusStops` map 반환 객체에 `source: "tago" as const,` 추가(예: `arrivalStatus` 줄 위). `parseBusArrivals` map 반환 객체에 `source: "tago" as const,` 추가.

- [ ] **Step 5: 통과 확인**

Run: `npm run test:run -- tago-bus`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/providers/tago-bus.ts src/lib/__tests__/tago-bus.test.ts
git -c user.email=engccer@gmail.com commit -m "feat(bus): BusStop/BusArrival에 source 판별자 추가(tago)"
```

---

### Task 3: seoul provider — envelope 파서 `parseSeoulItems`

**Files:**
- Create: `src/lib/providers/seoul-bus.ts`
- Create: `src/lib/__tests__/seoul-bus.test.ts`

> 아래 코드의 envelope 경로(`msgBody.itemList`)는 Task 1 fixture 실값으로 교정한다.

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/__tests__/seoul-bus.test.ts`:

```ts
// 2026-06-15 서울 TOPIS(ws.bus.go.kr) 실호출 fixture로 envelope·필드·저상 검증.
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../env", () => ({ env: { DATA_GO_KR_API_KEY: "test-key" } }));

import fixture from "./fixtures/seoul-bus.json";
import { parseSeoulItems } from "../providers/seoul-bus";

describe("parseSeoulItems", () => {
  it("envelope에서 itemList 배열을 뽑는다", () => {
    expect(parseSeoulItems(fixture.nearbyStops).length).toBeGreaterThan(0);
  });
  it("빈 결과는 빈 배열", () => {
    expect(parseSeoulItems(fixture.empty)).toEqual([]);
    expect(parseSeoulItems(null)).toEqual([]);
    expect(parseSeoulItems({})).toEqual([]);
  });
  it("itemList가 단일 객체로 와도 배열로 정규화", () => {
    const single = { msgBody: { itemList: { arsId: "X" } } };
    expect(parseSeoulItems(single).length).toBe(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- seoul-bus`
Expected: FAIL — `parseSeoulItems` 미정의.

- [ ] **Step 3: 구현**

`src/lib/providers/seoul-bus.ts`:

```ts
import type { BusArrival, BusRouteStop, BusStop } from "../types";
import { env } from "../env";
import { haversineMeters } from "../geo";

/**
 * 서울 TOPIS 시내버스 provider(ws.bus.go.kr). TAGO 미수록인 서울 전용.
 * data.go.kr 서울 3종(15000303 정류소·15000314 도착·15000193 노선)을
 * 기존 DATA_GO_KR_API_KEY로 호출. TAGO와 동일 반환 타입으로 정규화한다.
 *
 * envelope는 서울 TOPIS 형식(msgBody.itemList)이라 TAGO와 다른 파서를 쓴다.
 */
type RawItem = Record<string, unknown>;

/** 서울 envelope에서 itemList 배열을 안전 추출. */
export function parseSeoulItems(raw: unknown): RawItem[] {
  // ServiceResult 래퍼가 있으면 벗긴다(실응답에 따라 Task 1에서 확정).
  const root = (raw as { ServiceResult?: unknown })?.ServiceResult ?? raw;
  const list = (root as { msgBody?: { itemList?: unknown } })?.msgBody?.itemList;
  if (!list) return [];
  if (Array.isArray(list)) return list as RawItem[];
  if (typeof list === "object") return [list as RawItem];
  return [];
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function numF(v: unknown): number {
  if (v == null || (typeof v === "string" && v.trim() === "")) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function nonNegInt(v: unknown): number {
  const n = numF(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- seoul-bus`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/seoul-bus.ts src/lib/__tests__/seoul-bus.test.ts
git -c user.email=engccer@gmail.com commit -m "feat(bus): seoul provider envelope 파서 parseSeoulItems"
```

---

### Task 4: seoul provider — 근접 정류소 파서 `parseSeoulStops`

**Files:**
- Modify: `src/lib/providers/seoul-bus.ts`
- Modify: `src/lib/__tests__/seoul-bus.test.ts`

> 필드명 `arsId`/`stationId`/`stationNm`/`gpsX`/`gpsY`는 Task 1 fixture로 교정.

- [ ] **Step 1: 실패 테스트 작성**

`seoul-bus.test.ts`에 추가(`import`에 `parseSeoulStops` 추가):

```ts
describe("parseSeoulStops", () => {
  it("정류소를 거리 오름차순으로 정렬하고 source=seoul", () => {
    const stops = parseSeoulStops(fixture.nearbyStops, 37.5385, 127.1378);
    expect(stops.length).toBeGreaterThan(0);
    expect(stops[0].source).toBe("seoul");
    expect(stops[0].name).not.toBe("");
    expect(stops[0].nodeId).not.toBe("");      // arsId
    expect(stops[0].arrivalStatus).toBe("ok");
    expect(stops[0].arrivals).toEqual([]);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i].distanceMeters).toBeGreaterThanOrEqual(stops[i - 1].distanceMeters);
    }
  });
  it("좌표 결측 항목은 제외", () => {
    const raw = { msgBody: { itemList: [{ arsId: "X", stationNm: "결측" }] } };
    expect(parseSeoulStops(raw, 37.5, 127.1)).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- seoul-bus`
Expected: FAIL — `parseSeoulStops` 미정의.

- [ ] **Step 3: 구현**

`seoul-bus.ts`에 추가:

```ts
/** 근접 정류소 응답 → 거리 오름차순 BusStop[](도착정보는 빈 배열로 시작).
 *  cityCode는 서울 도착/경유 조회에 불필요하지만 타입 호환 위해 "seoul" 센티넬. */
export function parseSeoulStops(
  raw: unknown,
  originLat: number,
  originLng: number,
): BusStop[] {
  return parseSeoulItems(raw)
    .map((it): BusStop => {
      const lat = numF(it.gpsY); // 위도
      const lng = numF(it.gpsX); // 경도
      const arsId = str(it.arsId) || str(it.stationId);
      return {
        nodeId: arsId,
        cityCode: "seoul",
        name: str(it.stationNm),
        stopNo: str(it.arsId) !== "" ? str(it.arsId) : undefined,
        lat,
        lng,
        distanceMeters: Math.round(haversineMeters(originLat, originLng, lat, lng)),
        arrivalStatus: "ok",
        arrivals: [],
        source: "seoul",
      };
    })
    .filter((s) => s.nodeId && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- seoul-bus`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/seoul-bus.ts src/lib/__tests__/seoul-bus.test.ts
git -c user.email=engccer@gmail.com commit -m "feat(bus): seoul 근접 정류소 파서 parseSeoulStops"
```

---

### Task 5: seoul provider — 도착정보 파서 `parseSeoulArrivals`

**Files:**
- Modify: `src/lib/providers/seoul-bus.ts`
- Modify: `src/lib/__tests__/seoul-bus.test.ts`

> 도착시간 형식(초 `traTime1` vs 메시지 `arrmsg1`)·저상값(`busType1`)은 Task 1 fixture로 확정. 아래는 `traTime1`(초)·`busType1=="1"` 가정.

- [ ] **Step 1: 실패 테스트 작성**

`seoul-bus.test.ts`에 추가(`import`에 `parseSeoulArrivals` 추가):

```ts
describe("parseSeoulArrivals", () => {
  it("도착 임박 순 정렬 + 저상 판정 + source=seoul", () => {
    const arr = parseSeoulArrivals(fixture.arrivals);
    expect(arr.length).toBeGreaterThan(0);
    expect(arr[0].source).toBe("seoul");
    expect(arr[0].routeNo).not.toBe("");
    expect(arr[0].routeId).not.toBe("");       // busRouteId
    for (let i = 1; i < arr.length; i++) {
      expect(arr[i].arrivalSeconds).toBeGreaterThanOrEqual(arr[i - 1].arrivalSeconds);
    }
    expect(typeof arr[0].lowFloor).toBe("boolean");
  });
  it("노선번호 없는 항목은 제외", () => {
    const raw = { msgBody: { itemList: [{ busRouteId: "1", traTime1: 60 }] } };
    expect(parseSeoulArrivals(raw)).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- seoul-bus`
Expected: FAIL — `parseSeoulArrivals` 미정의.

- [ ] **Step 3: 구현**

`seoul-bus.ts`에 추가:

```ts
/** 도착정보 응답 → 도착 임박 순 BusArrival[]. 서울 getStationByUidItem은
 *  한 항목에 첫째(traTime1/arrmsg1)·둘째(traTime2) 도착이 함께 온다 — 첫째만 채택.
 *  저상: busType1 "1"=저상(0 일반·2 굴절). routeType은 서울 미제공이라 공란. */
export function parseSeoulArrivals(raw: unknown): BusArrival[] {
  return parseSeoulItems(raw)
    .map((it): BusArrival => ({
      routeId: str(it.busRouteId),
      routeNo: str(it.rtNm),
      routeType: "",
      arrivalSeconds: nonNegInt(it.traTime1),
      prevStationCount: 0, // 서울은 정류장 수 대신 arrmsg1 텍스트로 제공 — 0 고정(미사용)
      lowFloor: str(it.busType1) === "1",
      source: "seoul",
    }))
    .filter((a) => a.routeNo)
    .sort((a, b) => a.arrivalSeconds - b.arrivalSeconds);
}
```

> **확정 포인트(Task 1)**: `traTime1`이 초가 아니면(예: 분, 또는 `arrmsg1`만 존재) `arrivalSeconds` 산출 규칙을 실값에 맞춘다. `prevStationCount`를 주는 필드(예: 남은 정류장)가 있으면 채운다.

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- seoul-bus`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/seoul-bus.ts src/lib/__tests__/seoul-bus.test.ts
git -c user.email=engccer@gmail.com commit -m "feat(bus): seoul 도착정보 파서 parseSeoulArrivals(저상 판정)"
```

---

### Task 6: seoul provider — 경유정류소 파서 `parseSeoulRouteStops`

**Files:**
- Modify: `src/lib/providers/seoul-bus.ts`
- Modify: `src/lib/__tests__/seoul-bus.test.ts`

> 필드명 `station`/`stationNm`/`gpsX`/`gpsY`/`seq`는 Task 1 fixture로 교정.

- [ ] **Step 1: 실패 테스트 작성**

`seoul-bus.test.ts`에 추가(`import`에 `parseSeoulRouteStops`):

```ts
describe("parseSeoulRouteStops", () => {
  it("경유정류소를 순번 순으로 반환", () => {
    const stops = parseSeoulRouteStops(fixture.routeStops);
    expect(stops.length).toBeGreaterThan(0);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i].order).toBeGreaterThanOrEqual(stops[i - 1].order);
    }
    expect(stops[0].name).not.toBe("");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- seoul-bus`
Expected: FAIL — 미정의.

- [ ] **Step 3: 구현**

`seoul-bus.ts`에 추가:

```ts
/** 노선 경유정류소 응답 → 순번 오름차순 BusRouteStop[]. */
export function parseSeoulRouteStops(raw: unknown): BusRouteStop[] {
  return parseSeoulItems(raw)
    .map((it): BusRouteStop => ({
      nodeId: str(it.station) || str(it.arsId),
      name: str(it.stationNm),
      order: nonNegInt(it.seq),
      lat: numF(it.gpsY),
      lng: numF(it.gpsX),
    }))
    .filter((s) => s.nodeId)
    .sort((a, b) => a.order - b.order);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- seoul-bus`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/seoul-bus.ts src/lib/__tests__/seoul-bus.test.ts
git -c user.email=engccer@gmail.com commit -m "feat(bus): seoul 경유정류소 파서 parseSeoulRouteStops"
```

---

### Task 7: seoul provider — fetch 함수 (graceful) `fetchSeoulNearby`/`fetchSeoulRouteStops`

**Files:**
- Modify: `src/lib/providers/seoul-bus.ts`
- Modify: `src/lib/__tests__/seoul-bus.test.ts`

TAGO `fetchTago`의 graceful 규약(HTTP 실패·비정상 응답·서비스 장애 throw, 정상 빈결과는 통과)을 서울 envelope에 맞게 구현.

- [ ] **Step 1: 실패 테스트 작성**

`seoul-bus.test.ts`에 추가(`import`에 `fetchSeoulNearby`, `fetchSeoulRouteStops`):

```ts
function mockFetchSequence(...payloads: unknown[]) {
  const fn = vi.fn();
  for (const p of payloads) {
    fn.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(p) });
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("fetchSeoulNearby", () => {
  it("근접 정류소 + 각 정류소 도착정보를 병렬로 채운다", async () => {
    // 1) 근접, 2..) 각 정류소 도착(여기선 모두 arrivals fixture)
    const near = parseSeoulItemsCount(fixture.nearbyStops);
    mockFetchSequence(fixture.nearbyStops, ...Array(near).fill(fixture.arrivals));
    const stops = await fetchSeoulNearby(37.5385, 127.1378);
    expect(stops.length).toBeGreaterThan(0);
    expect(stops[0].source).toBe("seoul");
    expect(stops[0].arrivalStatus).toBe("ok");
  });

  it("도착조회 실패는 unavailable로 구분", async () => {
    const fn = vi.fn();
    fn.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(fixture.nearbyStops) });
    fn.mockResolvedValue({ ok: false, status: 500, text: async () => "err" });
    vi.stubGlobal("fetch", fn);
    const stops = await fetchSeoulNearby(37.5385, 127.1378);
    expect(stops[0].arrivalStatus).toBe("unavailable");
    expect(stops[0].arrivals).toEqual([]);
  });
});

describe("fetchSeoulRouteStops", () => {
  it("경유정류소를 순번 순으로 반환", async () => {
    mockFetchSequence(fixture.routeStops);
    const stops = await fetchSeoulRouteStops("100100118");
    expect(stops.length).toBeGreaterThan(0);
  });
});
```

> `parseSeoulItemsCount`는 fixture 도착 호출 횟수를 맞추기 위한 헬퍼 — 테스트 상단에 `const parseSeoulItemsCount = (raw) => parseSeoulItems(raw).length;` 로 정의(상위 cap 5 고려해 `Math.min(5, ...)`). 정류소가 5개 초과면 cap 적용.

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- seoul-bus`
Expected: FAIL — fetch 함수 미정의.

- [ ] **Step 3: 구현**

`seoul-bus.ts`에 추가:

```ts
const BASE = "http://ws.bus.go.kr/api/rest";

/** 서울 TOPIS 한 오퍼레이션 호출 + 표준 envelope 반환.
 *  graceful: HTTP 실패·비정상 응답·헤더 에러는 throw(라우트 502), 정상 빈결과는 통과. */
async function fetchSeoul(
  path: string,
  params: Record<string, string | number>,
  init?: RequestInit & { next?: { revalidate: number } },
): Promise<unknown> {
  const key = env.DATA_GO_KR_API_KEY!;
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("resultType", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, init ?? { cache: "no-store" });
  if (!res.ok) throw new Error(`Seoul ${path} HTTP ${res.status}`);
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Seoul ${path} 비정상 응답: ${text.slice(0, 200)}`);
  }
  // headerCd "0"=정상, "4"류=빈결과(통과), 그 외 인증/장애=throw. (Task 1로 코드값 확정)
  const root = (data as { ServiceResult?: unknown })?.ServiceResult ?? data;
  const hdr = (root as { msgHeader?: { headerCd?: unknown; headerMsg?: unknown } })?.msgHeader;
  const code = hdr?.headerCd == null ? null : String(hdr.headerCd);
  if (code != null && code !== "0") {
    const msg = String(hdr?.headerMsg ?? code);
    // 결과없음류는 정상 빈결과로 통과(실제 코드값은 Task 1 fixture로 확정 — 예: "4").
    if (/없음|결과|no\s*data/i.test(msg) || code === "4") return data;
    throw new Error(`Seoul ${path} headerCd ${code}: ${msg}`);
  }
  return data;
}

/** 좌표 → 근접 정류소 상위 5 + 각 정류소 도착(병렬). */
export async function fetchSeoulNearby(lat: number, lng: number): Promise<BusStop[]> {
  if (!env.DATA_GO_KR_API_KEY) return [];
  const raw = await fetchSeoul("stationinfo/getStaionsByPosList", {
    tmX: lng, tmY: lat, radius: 500,
  });
  const stops = parseSeoulStops(raw, lat, lng).slice(0, 5);
  const settled = await Promise.allSettled(
    stops.map((s) =>
      fetchSeoul("stationinfo/getStationByUidItem", { arsId: s.nodeId }),
    ),
  );
  return stops.map((s, i) => {
    const r = settled[i];
    if (r.status === "rejected") {
      console.error(`[seoul] 도착조회 실패 ${s.name}:`, r.reason);
      return { ...s, arrivalStatus: "unavailable" as const, arrivals: [] };
    }
    return { ...s, arrivalStatus: "ok" as const, arrivals: parseSeoulArrivals(r.value) };
  });
}

/** 노선 경유정류소(거의 불변 → 하루 캐시). */
export async function fetchSeoulRouteStops(routeId: string): Promise<BusRouteStop[]> {
  if (!env.DATA_GO_KR_API_KEY) return [];
  const raw = await fetchSeoul(
    "busRouteInfo/getStaionByRoute",
    { busRouteId: routeId },
    { next: { revalidate: 86_400 } },
  );
  return parseSeoulRouteStops(raw);
}
```

> 서울 근접조회는 `radius`로 범위를 받으므로 TAGO 같은 totalCount 페이징이 불필요(반경 내 전부 반환). 상위 5 cap만 적용.

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- seoul-bus`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/seoul-bus.ts src/lib/__tests__/seoul-bus.test.ts
git -c user.email=engccer@gmail.com commit -m "feat(bus): seoul fetch 함수(graceful) + 도착 병렬 채움"
```

---

### Task 8: 병합 진입점 `src/lib/bus.ts`

**Files:**
- Create: `src/lib/bus.ts`
- Create: `src/lib/__tests__/bus-merge.test.ts`
- Modify: `src/lib/providers/tago-bus.ts` (`fetchNearbyBusStops` → `fetchTagoNearby` 改名)
- Modify: `src/lib/__tests__/tago-bus.test.ts` (改名 반영)

- [ ] **Step 1: tago 근접 진입점 改名**

`src/lib/providers/tago-bus.ts`에서 `export async function fetchNearbyBusStops(` → `export async function fetchTagoNearby(`. `tago-bus.test.ts`의 `import`와 호출부의 `fetchNearbyBusStops` → `fetchTagoNearby` 전부 치환.

Run: `npm run test:run -- tago-bus`
Expected: PASS (改名만)

- [ ] **Step 2: 병합 실패 테스트 작성**

`src/lib/__tests__/bus-merge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeBusStops } from "../bus";
import type { BusStop } from "../types";

function stop(p: Partial<BusStop>): BusStop {
  return {
    nodeId: "n", cityCode: "c", name: "정류소", lat: 37.5, lng: 127.1,
    distanceMeters: 0, arrivalStatus: "ok", arrivals: [], source: "tago",
    ...p,
  };
}

describe("mergeBusStops", () => {
  it("좌표 4자리 중복은 거리 가까운 쪽만 남긴다", () => {
    const a = stop({ source: "tago", lat: 37.53850, lng: 127.13780, distanceMeters: 120 });
    const b = stop({ source: "seoul", lat: 37.53851, lng: 127.13782, distanceMeters: 40 });
    const merged = mergeBusStops([a], [b]);
    expect(merged.length).toBe(1);
    expect(merged[0].source).toBe("seoul"); // 더 가까운 쪽
  });
  it("서로 다른 좌표는 모두 남기고 거리순 정렬·상위 5 cap", () => {
    const tago = [stop({ source: "tago", lat: 37.50, lng: 127.10, distanceMeters: 300 })];
    const seoul = Array.from({ length: 6 }, (_, i) =>
      stop({ source: "seoul", lat: 37.6 + i * 0.001, lng: 127.2, distanceMeters: 100 + i }),
    );
    const merged = mergeBusStops(tago, seoul);
    expect(merged.length).toBe(5); // 상위 5 cap
    expect(merged[0].distanceMeters).toBe(100); // 거리순
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm run test:run -- bus-merge`
Expected: FAIL — `../bus` 미존재.

- [ ] **Step 4: 구현**

`src/lib/bus.ts`:

```ts
import type { BusStop } from "./types";
import { fetchTagoNearby } from "./providers/tago-bus";
import { fetchSeoulNearby } from "./providers/seoul-bus";

/** 좌표 4자리(약 11m) 중복 판정 키 — en 장소병합과 동일 기준. */
function coordKey(s: BusStop): string {
  return `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
}

/**
 * TAGO + 서울 정류소를 병합한다. 좌표 4자리가 같으면 같은 정류소로 보고
 * 거리가 더 가까운 쪽만 남긴다(경계의 동일 정류소 중복 방지). 거리순 정렬 후 상위 5.
 */
export function mergeBusStops(tago: BusStop[], seoul: BusStop[]): BusStop[] {
  const byKey = new Map<string, BusStop>();
  for (const s of [...tago, ...seoul]) {
    const k = coordKey(s);
    const prev = byKey.get(k);
    if (!prev || s.distanceMeters < prev.distanceMeters) byKey.set(k, s);
  }
  return [...byKey.values()]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 5);
}

/**
 * 좌표 근접 정류소 — TAGO·서울 병렬 병합 진입점.
 * 둘 다 실패해야 throw, 하나라도 성공이면 그 실데이터를 보존(가짜 폴백 금지).
 */
export async function fetchNearbyBusStops(lat: number, lng: number): Promise<BusStop[]> {
  const [tagoR, seoulR] = await Promise.allSettled([
    fetchTagoNearby(lat, lng),
    fetchSeoulNearby(lat, lng),
  ]);
  if (tagoR.status === "rejected" && seoulR.status === "rejected") {
    throw new Error(`버스 정보 조회 실패: tago=${tagoR.reason}; seoul=${seoulR.reason}`);
  }
  const tago = tagoR.status === "fulfilled" ? tagoR.value : [];
  const seoul = seoulR.status === "fulfilled" ? seoulR.value : [];
  return mergeBusStops(tago, seoul);
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm run test:run -- bus-merge tago-bus seoul-bus`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/bus.ts src/lib/__tests__/bus-merge.test.ts src/lib/providers/tago-bus.ts src/lib/__tests__/tago-bus.test.ts
git -c user.email=engccer@gmail.com commit -m "feat(bus): TAGO+서울 병렬 병합 진입점 fetchNearbyBusStops"
```

---

### Task 9: API 라우트 — nearby import 교체 + route source 디스패치

**Files:**
- Modify: `src/app/api/bus/nearby/route.ts:4`
- Modify: `src/app/api/bus/route/route.ts`

- [ ] **Step 1: nearby import 교체**

`src/app/api/bus/nearby/route.ts`의 import를 변경:

```ts
import { fetchNearbyBusStops } from "@/lib/bus";
```

(`@/lib/providers/tago-bus` 제거. 나머지 동일.)

- [ ] **Step 2: route 핸들러에 source 디스패치**

`src/app/api/bus/route/route.ts` 전체를 교체:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDataGoKrKey } from "@/lib/env";
import { fetchBusRouteStops } from "@/lib/providers/tago-bus";
import { fetchSeoulRouteStops } from "@/lib/providers/seoul-bus";

/**
 * GET /api/bus/route?source=tago&cityCode=..&routeId=..
 *      /api/bus/route?source=seoul&routeId=..
 * 노선 경유정류소(lazy). source로 provider 디스패치. 거의 불변이라 provider에서 하루 캐시.
 */
const querySchema = z
  .object({
    source: z.enum(["tago", "seoul"]),
    routeId: z.string().min(1),
    cityCode: z.string().optional(),
  })
  .refine((v) => v.source !== "tago" || (v.cityCode && v.cityCode.length > 0), {
    message: "tago source는 cityCode가 필요합니다",
    path: ["cityCode"],
  });

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    source: sp.get("source") ?? "",
    routeId: sp.get("routeId") ?? "",
    cityCode: sp.get("cityCode") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }
  if (!hasDataGoKrKey()) {
    return NextResponse.json({ stops: [] });
  }
  try {
    const { source, routeId, cityCode } = parsed.data;
    const stops =
      source === "seoul"
        ? await fetchSeoulRouteStops(routeId)
        : await fetchBusRouteStops(cityCode!, routeId);
    return NextResponse.json({ stops });
  } catch (e) {
    console.error("[api/bus/route]", e);
    return NextResponse.json({ error: "경유 정류소 조회 실패" }, { status: 502 });
  }
}
```

- [ ] **Step 3: 빌드/타입 확인**

Run: `npm run build`
Expected: 성공(타입 에러 없음).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/bus/nearby/route.ts src/app/api/bus/route/route.ts
git -c user.email=engccer@gmail.com commit -m "feat(bus): nearby 병합 진입점 연결 + route source 디스패치"
```

---

### Task 10: UI — source 전달 + bus.empty 문구

**Files:**
- Modify: `src/components/BusRouteStops.tsx`
- Modify: `src/components/BusArrivals.tsx`
- Modify: `messages/ko.json`, `messages/en.json`

- [ ] **Step 1: BusRouteStops에 source prop 추가**

`src/components/BusRouteStops.tsx`를 읽고, props 타입에 `source: BusSource` 추가(`import type { BusSource } from "@/lib/types"`). fetch URL을 변경:

```ts
// 기존: `/api/bus/route?cityCode=${cityCode}&routeId=${routeId}`
// 변경: source별 쿼리 구성
const qs = new URLSearchParams({ source, routeId });
if (source === "tago") qs.set("cityCode", cityCode);
const res = await fetch(`/api/bus/route?${qs.toString()}`, ...);
```

`cityCode`는 서울일 때 빈 문자열일 수 있으므로 optional 처리(타입 유지, tago만 사용).

- [ ] **Step 2: BusArrivals에서 source 전달**

`src/components/BusArrivals.tsx`:
- 정류소 `<li key>`를 `` `${stop.source}-${stop.cityCode}-${stop.nodeId}` ``로 변경.
- `<BusRouteStops .../>`에 `source={stop.source}` 추가.

- [ ] **Step 3: bus.empty 문구 갱신**

`messages/ko.json`·`messages/en.json`의 `bus.empty`가 "서울 미수록" 뉘앙스면, 일반 "근처에 정류소가 없습니다"로 수정. (현재 문구 확인 후 서울 한정 안내였으면 교체. 아니면 그대로.)

- [ ] **Step 4: 빌드 + 전체 테스트**

Run: `npm run build && npm run test:run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/BusRouteStops.tsx src/components/BusArrivals.tsx messages/ko.json messages/en.json
git -c user.email=engccer@gmail.com commit -m "feat(bus): UI에 source 전달 + bus.empty 문구 일반화"
```

---

### Task 11: 실호출 검증 게이트 + 문서 갱신

**Files:**
- Modify: `CLAUDE.md` (API 키 현황·아키텍처 TAGO 항목)
- Modify: `docs/SPEC.md` (실험 백로그)

- [ ] **Step 1: 로컬 실호출 게이트**

`npm run dev` 후 강동구 길동 좌표로:

Run: `curl -s "http://localhost:3000/api/bus/nearby?lat=37.5385&lng=127.1378" | head -c 1500`
Expected: 서울 정류소(`source` 없이 클라엔 stops만; 내부 source 포함) + 도착 + 저상 판정. **빈 배열이면 실패** — 활용신청/필드명/엔드포인트 재점검(Task 1 fixture와 대조).

경계 검증(선택): 강동구에서 서울+하남(경기) 정류소가 함께 나오는지 확인.

- [ ] **Step 2: 경유정류소 실호출**

Step 1 결과의 서울 노선 routeId로:

Run: `curl -s "http://localhost:3000/api/bus/route?source=seoul&routeId=<busRouteId>" | head -c 800`
Expected: 경유정류소 순번순 목록.

- [ ] **Step 3: 프로덕션 검증(재배포 후)**

env는 이미 프로덕션에 `DATA_GO_KR_API_KEY` 존재. push로 자동 배포(사용자 요청 시) 또는 `vercel deploy --prod --yes` 후:

Run: `curl -s "https://gildongmu.vercel.app/api/bus/nearby?lat=37.5385&lng=127.1378" | head -c 1500`
Expected: 로컬과 동일하게 서울 정류소 반환.

- [ ] **Step 4: CLAUDE.md 갱신**

- `DATA_GO_KR_API_KEY` 행에 서울 3종(15000303·15000314·15000193) 활용신청·실호출 검증 추가, "⚠ 서울 시내버스 미수록" 경고를 "서울은 ws.bus.go.kr(TOPIS) provider로 커버, TAGO는 경기·지방·부산" 으로 정정.
- 아키텍처 TAGO 시내버스 항목에 서울 병렬 병합(`src/lib/bus.ts`)·`source` 판별자·서울 provider 추가.

- [ ] **Step 5: docs/SPEC.md 실험 백로그 갱신**

서울 버스 항목을 "완료"로 이동(있으면).

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/SPEC.md
git -c user.email=engccer@gmail.com commit -m "docs(bus): 서울 시내버스 연동 완료 — CLAUDE.md·SPEC 갱신"
```

- [ ] **Step 7: AGENTS.md 동기화**

Run: `cd /Users/hunyongkim/Mac-Projects && python sync_agent_docs.py && cd gildongmu`
그 후 변경된 AGENTS.md를 커밋:

```bash
git add -A && git -c user.email=engccer@gmail.com commit -m "chore: AGENTS.md 동기화(서울 버스)"
```

---

## Self-Review 결과

- **Spec coverage**: 데이터소스/인증→Task 1·7·11, seoul provider→Task 3~7, 타입 source→Task 2, 병합→Task 8, 라우트→Task 9, UI→Task 10, 검증 게이트→Task 1·11, 비목표(따릉이/지하철/버스위치/노선검색)→플랜 미포함(준수). 전 섹션 커버.
- **Placeholder scan**: 파서 필드명은 Task 1 fixture로 잠그는 의도적 가정(각 태스크에 "확정 포인트" 명시) — TBD 방치 아님. 코드 블록 모두 구체.
- **Type consistency**: `BusSource`·`source` 필드, `fetchNearbyBusStops`(병합)·`fetchTagoNearby`(改名)·`fetchSeoulNearby`/`fetchSeoulRouteStops`, `parseSeoul*` 이름이 태스크 간 일치. `mergeBusStops` 시그니처 일관.
- **리스크**: 실계약(envelope·필드·도착시간·저상값)은 Task 1이 단일 잠금점. 다르면 Task 3~7 파서를 실값으로 교정(계획에 명시).

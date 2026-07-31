# 대중교통 운행 시간 판정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ODsay가 심야에 추천하는 "운행하지 않는 버스" 경로를 운행시간 조인으로 판정해 강등하고 낭독에 사유를 실는다.

**Architecture:** provider 진입점 `getTransitRoute` 안에서 ODsay 정규화 결과에 운행시간을 보강한다. 판정은 시각을 인자로 받는 순수 함수로 분리해 심야 재현 없이 테스트하고, 조회는 실패해도 throw하지 않고 `unknown`으로 떨어뜨려 경로 응답을 살린다. 정렬은 안정 정렬이라 같은 상태 안에서 ODsay 추천순이 보존된다.

**Tech Stack:** TypeScript, Next.js 16 route handler, Vitest, next-intl, Swift(GildongmuKit)

**설계 정본:** `docs/superpowers/specs/2026-08-01-odsay-service-hours-design.md`

## Global Constraints

- 커밋 이메일 `engccer@gmail.com`. 주석·커밋 메시지 한국어, 변수·함수명 영어.
- `git add -A` 금지. 의도 파일만 stage하고 `git commit -- <경로>`로 원자화한다(신규 파일은 `git add <경로> && git commit -- <경로>`를 한 명령으로).
- 산문·주석·커밋 메시지에 em dash(`—`) 금지. 연결은 가운뎃점(`·`), 범위는 물결표(`~`).
- 매 커밋 전 `npm run test:run`과 `npm run lint` 통과 필수.
- 3-state 불변식: "운행중"·"정보 없음"·"운행 밖"을 뭉개지 않는다. `unknown`을 `running`이나 `outside` 어느 쪽으로도 단정하지 않는다.
- `normalizeOdsayRoute`는 순수 함수로 유지한다. 보강 로직을 그 안에 넣지 않는다.
- 판정 기준 시각은 KST다. 서버 타임존에 의존하지 않는다.
- 운행시간 조회 실패는 절대 throw하지 않는다. 길찾기 응답 자체를 죽이면 안 된다.

---

### Task 1: 순수 판정 모듈

**Files:**
- Create: `src/lib/service-hours.ts`
- Test: `src/lib/__tests__/service-hours.test.ts`

**Interfaces:**
- Consumes: 없음(순수 모듈)
- Produces: `ServiceStatus`, `parseServiceTime(raw: string | null | undefined): number | null`, `judgeServiceStatus(nowMinutes: number, firstMinutes: number | null, lastMinutes: number | null): ServiceStatus`, `kstNowMinutes(now: Date): number`, `SERVICE_RANK: Record<ServiceStatus, number>`

- [ ] **Step 1: 실패 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import {
  judgeServiceStatus,
  parseServiceTime,
  kstNowMinutes,
  SERVICE_RANK,
} from "../service-hours";

describe("parseServiceTime", () => {
  it("TOPIS 12자리(YYYYMMDDHHMM)를 분으로 변환한다", () => {
    expect(parseServiceTime("202608010400")).toBe(240);
    expect(parseServiceTime("202608012230")).toBe(1350);
  });
  it("TAGO 4자리(HHMM)를 분으로 변환한다", () => {
    expect(parseServiceTime("0430")).toBe(270);
    expect(parseServiceTime("2300")).toBe(1380);
  });
  it("TOPIS 14자리(YYYYMMDDHHMMSS)도 받는다", () => {
    expect(parseServiceTime("20260801040000")).toBe(240);
  });
  it("결측·형식 위반은 null이다(0으로 뭉개지 않는다)", () => {
    expect(parseServiceTime(null)).toBeNull();
    expect(parseServiceTime(undefined)).toBeNull();
    expect(parseServiceTime("")).toBeNull();
    expect(parseServiceTime("abc")).toBeNull();
    expect(parseServiceTime("999")).toBeNull();
    expect(parseServiceTime("2561")).toBeNull(); // 25시 61분
  });
});

describe("judgeServiceStatus", () => {
  it("주간 노선: 운행 구간 안이면 running", () => {
    expect(judgeServiceStatus(600, 240, 1350)).toBe("running"); // 10:00, 04:00~22:30
  });
  it("주간 노선: 첫차 전이면 outside", () => {
    expect(judgeServiceStatus(238, 240, 1350)).toBe("outside"); // 03:58
  });
  it("주간 노선: 막차 후면 outside", () => {
    expect(judgeServiceStatus(1400, 240, 1350)).toBe("outside"); // 23:20
  });
  it("경계값(첫차·막차 정각)은 running이다", () => {
    expect(judgeServiceStatus(240, 240, 1350)).toBe("running");
    expect(judgeServiceStatus(1350, 240, 1350)).toBe("running");
  });
  it("심야 노선(자정 넘김): 막차<첫차일 때 양쪽 구간을 running으로 본다", () => {
    // N30 23:10~03:50
    expect(judgeServiceStatus(1400, 1390, 230)).toBe("running"); // 23:20
    expect(judgeServiceStatus(60, 1390, 230)).toBe("running"); // 01:00
    expect(judgeServiceStatus(238, 1390, 230)).toBe("outside"); // 03:58, 막차 후
    expect(judgeServiceStatus(600, 1390, 230)).toBe("outside"); // 10:00
  });
  it("첫차·막차 중 하나라도 없으면 unknown이다(추정 금지)", () => {
    expect(judgeServiceStatus(600, null, 1350)).toBe("unknown");
    expect(judgeServiceStatus(600, 240, null)).toBe("unknown");
    expect(judgeServiceStatus(600, null, null)).toBe("unknown");
  });
});

describe("kstNowMinutes", () => {
  it("UTC Date를 KST 기준 분으로 변환한다", () => {
    // 2026-07-31T18:58:00Z = 2026-08-01 03:58 KST
    expect(kstNowMinutes(new Date("2026-07-31T18:58:00Z"))).toBe(238);
    // 2026-08-01T05:00:00Z = 14:00 KST
    expect(kstNowMinutes(new Date("2026-08-01T05:00:00Z"))).toBe(840);
  });
});

describe("SERVICE_RANK", () => {
  it("running < unknown < outside 순이다(정보 없음을 결함으로 단정하지 않는다)", () => {
    expect(SERVICE_RANK.running).toBeLessThan(SERVICE_RANK.unknown);
    expect(SERVICE_RANK.unknown).toBeLessThan(SERVICE_RANK.outside);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- src/lib/__tests__/service-hours.test.ts`
Expected: FAIL, "Failed to resolve import ../service-hours"

- [ ] **Step 3: 최소 구현**

```ts
/**
 * 대중교통 노선 운행 시간 판정(순수).
 *
 * 시각을 인자로 받는 이유: 심야 결함은 시각 의존이라 실호출로 재현할 수 없다.
 * 판정을 순수 함수로 분리하면 주입 시각으로 결정적 테스트가 가능하다.
 * 설계 정본 docs/superpowers/specs/2026-08-01-odsay-service-hours-design.md
 */

export type ServiceStatus = "running" | "outside" | "unknown";

/** 운행중 > 정보없음 > 운행밖. 조회 실패를 결함으로 단정하면 멀쩡한 경로가 강등된다. */
export const SERVICE_RANK: Record<ServiceStatus, number> = {
  running: 0,
  unknown: 1,
  outside: 2,
};

/**
 * 운행 시각 문자열 → 0시부터의 분.
 * TOPIS는 "YYYYMMDDHHMM"(12자리) 또는 "YYYYMMDDHHMMSS"(14자리),
 * TAGO는 "HHMM"(4자리)로 준다. 형식 위반·결측은 null(0으로 뭉개지 않는다).
 */
export function parseServiceTime(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const digits = raw.trim();
  if (!/^\d+$/.test(digits)) return null;
  let hhmm: string;
  if (digits.length === 4) hhmm = digits;
  else if (digits.length === 12 || digits.length === 14) hhmm = digits.slice(8, 12);
  else return null;
  const hour = Number(hhmm.slice(0, 2));
  const minute = Number(hhmm.slice(2, 4));
  // 운행 시각은 24시 표기를 넘지 않는다(25시류 표기는 관측되지 않음 → 형식 위반 취급)
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** KST 기준 0시부터의 분. 서버 타임존에 의존하지 않도록 UTC에서 +9h 한다. */
export function kstNowMinutes(now: Date): number {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

/**
 * 현재 시각이 운행 구간 안인가.
 * 막차 < 첫차면 자정을 넘기는 심야 노선이라 구간이 두 토막이다(N30 23:10~03:50).
 */
export function judgeServiceStatus(
  nowMinutes: number,
  firstMinutes: number | null,
  lastMinutes: number | null,
): ServiceStatus {
  if (firstMinutes == null || lastMinutes == null) return "unknown";
  const running =
    lastMinutes < firstMinutes
      ? nowMinutes >= firstMinutes || nowMinutes <= lastMinutes
      : nowMinutes >= firstMinutes && nowMinutes <= lastMinutes;
  return running ? "running" : "outside";
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:run -- src/lib/__tests__/service-hours.test.ts`
Expected: PASS (전 케이스)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/service-hours.ts src/lib/__tests__/service-hours.test.ts
git commit -- src/lib/service-hours.ts src/lib/__tests__/service-hours.test.ts -m "feat(transit): 노선 운행 시간 판정 순수 모듈

시각을 인자로 받아 심야 재현 없이 결정적 테스트가 가능하게 했다.
막차<첫차인 심야 노선의 자정 넘김을 두 토막 구간으로 판정하고,
첫차·막차가 하나라도 없으면 추정하지 않고 unknown을 반환한다."
```

---

### Task 2: 서울 TOPIS 운행시간 조회

**Files:**
- Create: `src/lib/providers/bus-service-hours.ts`
- Test: `src/lib/providers/__tests__/bus-service-hours.test.ts`

**Interfaces:**
- Consumes: Task 1의 `parseServiceTime`
- Produces: `type ServiceHours = { firstMinutes: number | null; lastMinutes: number | null }`, `parseSeoulRouteInfo(raw: unknown): ServiceHours | null`, `fetchServiceHoursMap(routeIds: string[]): Promise<Map<string, ServiceHours>>`

- [ ] **Step 1: 실패 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { parseSeoulRouteInfo } from "../bus-service-hours";

// 2026-08-01 실호출 캡처(342번, busRouteId=124000038)
const SEOUL_342 = {
  msgHeader: { headerCd: "0", headerMsg: "정상적으로 처리되었습니다." },
  msgBody: {
    itemList: [
      {
        busRouteId: "124000038",
        busRouteNm: "342",
        firstBusTm: "202608010400",
        lastBusTm: "202608012230",
      },
    ],
  },
};

describe("parseSeoulRouteInfo", () => {
  it("TOPIS 응답에서 첫차·막차를 분으로 뽑는다", () => {
    expect(parseSeoulRouteInfo(SEOUL_342)).toEqual({
      firstMinutes: 240,
      lastMinutes: 1350,
    });
  });
  it("itemList가 비면 null이다", () => {
    expect(parseSeoulRouteInfo({ msgHeader: { headerCd: "4" }, msgBody: { itemList: [] } })).toBeNull();
  });
  it("itemList가 없으면 null이다", () => {
    expect(parseSeoulRouteInfo({ msgHeader: { headerCd: "0" } })).toBeNull();
  });
  it("시각 필드가 결측이면 null 슬롯으로 보존한다(0으로 뭉개지 않는다)", () => {
    const raw = { msgBody: { itemList: [{ busRouteId: "1", busRouteNm: "X" }] } };
    expect(parseSeoulRouteInfo(raw)).toEqual({ firstMinutes: null, lastMinutes: null });
  });
  it("응답이 객체가 아니면 null이다", () => {
    expect(parseSeoulRouteInfo(null)).toBeNull();
    expect(parseSeoulRouteInfo("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- src/lib/providers/__tests__/bus-service-hours.test.ts`
Expected: FAIL, "Failed to resolve import ../bus-service-hours"

- [ ] **Step 3: 최소 구현**

```ts
import { env } from "../env";
import { parseServiceTime } from "../service-hours";

/**
 * 버스 노선 운행 시간(첫차·막차) 조회.
 *
 * 서울은 ODsay lane[0].busLocalBlID가 TOPIS busRouteId와 동일 값이라
 * ID 직결 조인이 성립한다(342=124000038 실측 확정 2026-08-01).
 * 이름 매칭이 아니므로 동명 노선 함정이 없다.
 *
 * ⚠ 이 모듈은 절대 throw하지 않는다. 운행시간은 부가 정보이고,
 *   조회 실패가 길찾기 응답 자체를 죽이면 결함을 고치려다 더 큰 회귀를 만든다.
 *   실패한 노선은 Map에서 빠지고 호출부가 unknown으로 처리한다.
 */

const SEOUL_BASE = "http://ws.bus.go.kr/api/rest";

export interface ServiceHours {
  firstMinutes: number | null;
  lastMinutes: number | null;
}

interface SeoulRouteItem {
  firstBusTm?: string;
  lastBusTm?: string;
}

/** TOPIS getRouteInfo 응답 → ServiceHours. 결과 없으면 null. */
export function parseSeoulRouteInfo(raw: unknown): ServiceHours | null {
  if (!raw || typeof raw !== "object") return null;
  const body = (raw as { msgBody?: { itemList?: unknown } }).msgBody;
  const list = body?.itemList;
  if (!Array.isArray(list) || list.length === 0) return null;
  const item = list[0] as SeoulRouteItem;
  return {
    firstMinutes: parseServiceTime(item.firstBusTm),
    lastMinutes: parseServiceTime(item.lastBusTm),
  };
}

async function fetchSeoulRouteHours(routeId: string): Promise<ServiceHours | null> {
  const url = new URL(`${SEOUL_BASE}/busRouteInfo/getRouteInfo`);
  url.searchParams.set("serviceKey", env.DATA_GO_KR_API_KEY!);
  url.searchParams.set("resultType", "json");
  url.searchParams.set("busRouteId", routeId);
  // 운행 시간은 준정적이라 하루 캐시. GET이라 revalidate가 실효한다.
  const res = await fetch(url, { next: { revalidate: 86400 } });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return parseSeoulRouteInfo(data);
}

/**
 * 노선 ID들의 운행 시간을 병렬 조회. 실패·미조회 노선은 Map에서 빠진다
 * (호출부가 부재를 unknown으로 읽는다). 키 없으면 빈 Map(게이트 패턴).
 */
export async function fetchServiceHoursMap(
  routeIds: string[],
): Promise<Map<string, ServiceHours>> {
  const map = new Map<string, ServiceHours>();
  if (!env.DATA_GO_KR_API_KEY || routeIds.length === 0) return map;
  const unique = [...new Set(routeIds.filter(Boolean))];
  const settled = await Promise.allSettled(
    unique.map(async (id) => ({ id, hours: await fetchSeoulRouteHours(id) })),
  );
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value.hours) map.set(r.value.id, r.value.hours);
  }
  return map;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:run -- src/lib/providers/__tests__/bus-service-hours.test.ts`
Expected: PASS

- [ ] **Step 5: 실호출 게이트**

Run:
```bash
node -e '
const k=require("fs").readFileSync(".env.local","utf8").match(/^DATA_GO_KR_API_KEY=(.*)$/m)[1].trim();
const u=new URL("http://ws.bus.go.kr/api/rest/busRouteInfo/getRouteInfo");
u.searchParams.set("serviceKey",decodeURIComponent(k));
u.searchParams.set("resultType","json"); u.searchParams.set("busRouteId","124000038");
fetch(u).then(r=>r.json()).then(d=>console.log(JSON.stringify(d.msgBody?.itemList?.[0]).slice(0,300)));
'
```
Expected: `busRouteNm":"342"`와 `firstBusTm`·`lastBusTm` 필드가 실제로 존재. 필드명이 다르면 fixture와 구현을 실응답에 맞춰 고친다(추측 금지).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/providers/bus-service-hours.ts src/lib/providers/__tests__/bus-service-hours.test.ts
git commit -- src/lib/providers/bus-service-hours.ts src/lib/providers/__tests__/bus-service-hours.test.ts -m "feat(transit): 서울 TOPIS 노선 운행시간 조회

ODsay busLocalBlID가 TOPIS busRouteId와 동일 값이라 ID 직결 조인이
성립한다(342=124000038 실측). 조회 실패는 throw하지 않고 Map에서
빠지며 호출부가 unknown으로 읽는다. 준정적이라 하루 캐시."
```

---

### Task 3: getTransitRoute 보강과 타입 확장

**Files:**
- Modify: `src/lib/types.ts:228-242` (TransitLeg에 옵셔널 3필드 추가)
- Modify: `src/lib/providers/odsay.ts` (OdsayLane 확장, 보강 파이프라인 추가)
- Test: `src/lib/providers/__tests__/odsay-service-hours.test.ts`

**Interfaces:**
- Consumes: Task 1의 `judgeServiceStatus`·`kstNowMinutes`·`SERVICE_RANK`, Task 2의 `fetchServiceHoursMap`·`ServiceHours`
- Produces: `annotateServiceStatus(result, hoursMap, nowMinutes): TransitRouteResult`(export, 순수)

- [ ] **Step 1: 실패 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { annotateServiceStatus } from "../odsay";
import type { TransitRouteResult } from "../../types";

function leg(lineName: string, routeId?: string) {
  return { mode: "bus" as const, lineName, minutes: 10, serviceRouteId: routeId };
}
function route(legs: ReturnType<typeof leg>[]) {
  return {
    summary: { totalMinutes: 20, fare: 1500, transfers: 0, walkMinutes: 5 },
    legs,
  };
}

const HOURS = new Map([
  ["A", { firstMinutes: 240, lastMinutes: 1350 }], // 04:00~22:30 주간
  ["B", { firstMinutes: 1390, lastMinutes: 230 }], // 23:10~03:50 심야
]);
const NIGHT = 238; // 03:58

describe("annotateServiceStatus", () => {
  it("심야에 주간 노선을 outside로, 심야 노선을 running으로 판정한다", () => {
    const input = {
      recommended: route([leg("342", "A")]),
      alternatives: [route([leg("N30", "B")])],
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NIGHT);
    // 심야 노선이 앞으로 올라온다
    expect(out.recommended.legs[0].lineName).toBe("N30");
    expect(out.recommended.legs[0].serviceStatus).toBe("running");
    expect(out.alternatives[0].legs[0].serviceStatus).toBe("outside");
  });

  it("첫차·막차 시각을 HH:MM 문자열로 싣는다", () => {
    const input = {
      recommended: route([leg("342", "A")]),
      alternatives: [],
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NIGHT);
    expect(out.recommended.legs[0].firstServiceTime).toBe("04:00");
    expect(out.recommended.legs[0].lastServiceTime).toBe("22:30");
  });

  it("조회 실패(Map에 없음)는 unknown이고 순위를 바꾸지 않는다", () => {
    const input = {
      recommended: route([leg("999", "MISSING")]),
      alternatives: [route([leg("342", "A")])],
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NIGHT);
    // unknown(1) < outside(2)이므로 원래 1순위가 유지된다
    expect(out.recommended.legs[0].lineName).toBe("999");
    expect(out.recommended.legs[0].serviceStatus).toBe("unknown");
  });

  it("환승 경로는 가장 나쁜 구간 상태를 경로 상태로 쓴다", () => {
    const input = {
      recommended: route([leg("N30", "B"), leg("342", "A")]), // running + outside
      alternatives: [route([leg("N30", "B")])], // running
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NIGHT);
    // 한 구간이 outside면 경로 전체가 outside라 뒤로 밀린다
    expect(out.recommended.legs).toHaveLength(1);
    expect(out.recommended.legs[0].lineName).toBe("N30");
  });

  it("버스 leg가 없는 경로(지하철·도보 전용)는 원순서를 보존한다", () => {
    const subwayOnly = {
      summary: { totalMinutes: 20, fare: 1500, transfers: 0, walkMinutes: 5 },
      legs: [{ mode: "subway" as const, lineName: "수도권 5호선", minutes: 10 }],
    };
    const input = {
      recommended: subwayOnly,
      alternatives: [route([leg("N30", "B")])], // running
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NIGHT);
    // 지하철 전용은 판정 대상이 아니라 rank 0 → running과 동률 → 원순서 유지
    expect(out.recommended.legs[0].lineName).toBe("수도권 5호선");
    expect(out.recommended.legs[0].serviceStatus).toBeUndefined();
  });

  it("같은 상태 안에서는 ODsay 추천순이 보존된다(안정 정렬)", () => {
    const input = {
      recommended: route([leg("342", "A")]),
      alternatives: [route([leg("370", "A")]), route([leg("30-3", "A")])],
    } as unknown as TransitRouteResult;
    const out = annotateServiceStatus(input, HOURS, NIGHT);
    expect(out.recommended.legs[0].lineName).toBe("342");
    expect(out.alternatives.map((a) => a.legs[0].lineName)).toEqual(["370", "30-3"]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- src/lib/providers/__tests__/odsay-service-hours.test.ts`
Expected: FAIL, "annotateServiceStatus is not a function"

- [ ] **Step 3: 타입 확장**

`src/lib/types.ts`의 `TransitLeg`(228행) 끝, `minutes: number;` 앞에 추가:

```ts
  /** 운행 시간 판정 결과(버스만, 지하철·도보는 undefined) */
  serviceStatus?: "running" | "outside" | "unknown";
  /** 첫차 시각 "04:00"(판정된 경우만) */
  firstServiceTime?: string;
  /** 막차 시각 "22:30"(판정된 경우만) */
  lastServiceTime?: string;
  /** 운행시간 조인 키(ODsay busLocalBlID). 낭독에 쓰지 않는 내부 식별자 */
  serviceRouteId?: string;
```

- [ ] **Step 4: odsay.ts 보강 구현**

`OdsayLane` 인터페이스(18행)에 필드 추가:

```ts
interface OdsayLane {
  name?: string; // 지하철 노선명
  busNo?: string; // 버스 번호
  busLocalBlID?: string; // 지역 사업자 노선 ID — TOPIS busRouteId와 동일 값(서울)
  busCityCode?: number; // ODsay 도시 코드(서울=1000)
}
```

`toLeg`(54행)의 버스 분기에 `serviceRouteId`를 싣는다. 기존 return 문을 다음으로 교체:

```ts
  return {
    mode,
    lineName: mode === "subway" ? lane?.name : lane?.busNo,
    fromName: sp.startName,
    toName: sp.endName,
    stationCount: sp.stationCount,
    // 0은 "정보 없음"으로 취급해 생략(3-state: 배차 0분은 존재하지 않는 값)
    intervalMinutes: sp.intervalTime || undefined,
    minutes,
    // 운행시간 조인 키는 서울(1000)만 TOPIS ID 직결이 확정됐다.
    // 지방은 TAGO routeid에 지역 접두사가 붙어 별도 처리가 필요하다(Task 7).
    ...(mode === "bus" && lane?.busCityCode === 1000 && lane?.busLocalBlID
      ? { serviceRouteId: lane.busLocalBlID }
      : {}),
  };
```

파일 상단 import에 추가:

```ts
import {
  judgeServiceStatus,
  kstNowMinutes,
  SERVICE_RANK,
  type ServiceStatus,
} from "../service-hours";
import { fetchServiceHoursMap, type ServiceHours } from "./bus-service-hours";
```

파일 끝(`getTransitRoute` 앞)에 보강 함수 추가:

```ts
function formatHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * 운행시간 판정을 leg에 싣고 경로를 강등 정렬한다(순수).
 *
 * 경로 상태 = 그 경로 버스 leg 중 SERVICE_RANK 최대값.
 * ⚠ 버스 leg가 없는 경로(지하철·도보 전용)는 판정 대상이 아니라 rank 0을 준다.
 *   unknown(1)을 주면 지하철 경로가 운행 중 버스보다 밀리는데, 지하철 운행시간은
 *   범위 밖이라 근거 없는 강등이 된다. 0이면 안정 정렬과 맞물려 원순서가 보존된다.
 */
export function annotateServiceStatus(
  result: TransitRouteResult,
  hours: Map<string, ServiceHours>,
  nowMinutes: number,
): TransitRouteResult {
  const annotateRoute = (route: TransitRoute): TransitRoute => ({
    ...route,
    legs: route.legs.map((leg) => {
      if (leg.mode !== "bus" || !leg.serviceRouteId) return leg;
      const h = hours.get(leg.serviceRouteId);
      const status: ServiceStatus = h
        ? judgeServiceStatus(nowMinutes, h.firstMinutes, h.lastMinutes)
        : "unknown";
      return {
        ...leg,
        serviceStatus: status,
        ...(h?.firstMinutes != null ? { firstServiceTime: formatHHMM(h.firstMinutes) } : {}),
        ...(h?.lastMinutes != null ? { lastServiceTime: formatHHMM(h.lastMinutes) } : {}),
      };
    }),
  });

  const routeRank = (route: TransitRoute): number => {
    const ranks = route.legs
      .filter((l) => l.serviceStatus != null)
      .map((l) => SERVICE_RANK[l.serviceStatus!]);
    return ranks.length === 0 ? 0 : Math.max(...ranks);
  };

  const all = [result.recommended, ...result.alternatives].map(annotateRoute);
  const sorted = [...all].sort((a, b) => routeRank(a) - routeRank(b));
  return { recommended: sorted[0], alternatives: sorted.slice(1) };
}
```

`getTransitRoute`의 마지막 `return normalizeOdsayRoute(data);`를 다음으로 교체:

```ts
  const normalized = normalizeOdsayRoute(data);
  if (!normalized) return null;

  // 운행시간 보강. 실패해도 경로는 그대로 반환한다(부가 정보가 본 기능을 죽이지 않는다).
  const routeIds = [normalized.recommended, ...normalized.alternatives]
    .flatMap((r) => r.legs)
    .map((l) => l.serviceRouteId)
    .filter((id): id is string => !!id);
  const hours = await fetchServiceHoursMap(routeIds);
  return annotateServiceStatus(normalized, hours, kstNowMinutes(new Date()));
```

`TransitRoute` 타입 import가 없으면 상단 import에 추가한다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm run test:run -- src/lib/providers/__tests__/`
Expected: PASS. 기존 `odsay` 관련 테스트도 함께 통과해야 한다(정규화 계약 무변경 확인).

- [ ] **Step 6: 전체 게이트**

Run: `npm run test:run && npm run lint`
Expected: 전체 PASS, lint 0

- [ ] **Step 7: 커밋**

```bash
git add src/lib/types.ts src/lib/providers/odsay.ts src/lib/providers/__tests__/odsay-service-hours.test.ts
git commit -- src/lib/types.ts src/lib/providers/odsay.ts src/lib/providers/__tests__/odsay-service-hours.test.ts -m "feat(transit): 운행 시간 판정을 경로 응답에 반영

getTransitRoute 진입점에서 보강해 라우트·채팅·CLI·iOS 소비자를 한 번에
커버한다(채팅이 라우트를 거치지 않고 이 함수를 직접 호출한다).
정렬은 안정 정렬이라 같은 상태 안 ODsay 추천순이 보존되고, 버스 구간이
없는 지하철 경로는 rank 0으로 원순서를 지킨다."
```

---

### Task 4: 웹 렌더와 i18n

**Files:**
- Modify: `src/components/TransitRouteBriefing.tsx:270-278` (leg li 렌더)
- Modify: `messages/ko.json`·`en.json`·`es.json`·`fr.json`·`it.json`·`ja.json` (`route.transit`에 키 1개)
- Test: `src/components/__tests__/transit-service-hours.test.tsx`

**Interfaces:**
- Consumes: Task 3의 `TransitLeg.serviceStatus`·`firstServiceTime`·`lastServiceTime`
- Produces: 없음(말단 소비자)

- [ ] **Step 1: i18n 키 추가**

각 파일 `route.transit`에 추가(기존 키 뒤, `legInterval` 다음):

```json
"legServiceOutside": "첫차 {first}, 막차 {last}, 지금은 운행하지 않습니다"
```

- `en.json`: `"legServiceOutside": "First bus {first}, last bus {last}, not running now"`
- `es.json`: `"legServiceOutside": "Primer autobús {first}, último {last}, no circula ahora"`
- `fr.json`: `"legServiceOutside": "Premier bus {first}, dernier {last}, ne circule pas actuellement"`
- `it.json`: `"legServiceOutside": "Primo autobus {first}, ultimo {last}, non in servizio ora"`
- `ja.json`: `"legServiceOutside": "始発 {first}、終発 {last}、現在は運行していません"`

- [ ] **Step 2: 실패 테스트 작성**

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { TransitRouteResult } from "../TransitRouteBriefing";
import messages from "../../../messages/ko.json";

// TransitRouteResult는 t를 prop으로 받으므로 provider 안쪽 컴포넌트에서 훅으로 만들어 넘긴다
function Harness({ leg }: { leg: Record<string, unknown> }) {
  const t = useTranslations("route.transit");
  const route = {
    summary: { totalMinutes: 22, fare: 1500, transfers: 0, walkMinutes: 5, arriveName: "목적지" },
    legs: [leg],
  };
  return <TransitRouteResult route={route as never} t={t} locale="ko" dest="목적지" />;
}

function renderLeg(leg: Record<string, unknown>) {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <Harness leg={leg} />
    </NextIntlClientProvider>,
  );
}

describe("운행 시간 낭독", () => {
  it("outside면 첫차·막차와 미운행 문구를 같은 항목에 이어 붙인다", () => {
    renderLeg({
      mode: "bus",
      lineName: "342",
      fromName: "강동역",
      toName: "길동생태공원",
      stationCount: 14,
      minutes: 22,
      serviceStatus: "outside",
      firstServiceTime: "04:00",
      lastServiceTime: "22:30",
    });
    const item = screen.getByRole("listitem");
    expect(item.textContent).toContain("첫차 04:00");
    expect(item.textContent).toContain("지금은 운행하지 않습니다");
  });

  it("running이면 아무 문구도 붙이지 않는다(정상은 침묵)", () => {
    renderLeg({
      mode: "bus",
      lineName: "N30",
      fromName: "강동역",
      toName: "천호역",
      stationCount: 4,
      minutes: 10,
      serviceStatus: "running",
      firstServiceTime: "23:10",
      lastServiceTime: "03:50",
    });
    expect(screen.getByRole("listitem").textContent).not.toContain("첫차");
  });

  it("unknown이면 아무 문구도 붙이지 않는다(정보 없음 반복 낭독 금지)", () => {
    renderLeg({
      mode: "bus",
      lineName: "141",
      fromName: "서면",
      toName: "해운대",
      stationCount: 10,
      minutes: 30,
      serviceStatus: "unknown",
    });
    expect(screen.getByRole("listitem").textContent).not.toContain("첫차");
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm run test:run -- src/components/__tests__/transit-service-hours.test.tsx`
Expected: FAIL(문구가 렌더되지 않음)

- [ ] **Step 4: 렌더 구현**

`TransitRouteBriefing.tsx`의 배차간격 블록(275행 부근) 바로 뒤, 같은 `<li>` 안에 추가:

```tsx
              {/* 운행 밖만 표기한다. 정상·정보없음까지 표기하면 매 항목에 노이즈가
                  붙는다(조건부 실패 표기 원칙). 같은 li에 쉼표로 이어 한 줄=한 객체 유지 */}
              {leg.serviceStatus === "outside" && leg.firstServiceTime && leg.lastServiceTime && (
                <>
                  ,{" "}
                  {t("legServiceOutside", {
                    first: leg.firstServiceTime,
                    last: leg.lastServiceTime,
                  })}
                </>
              )}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm run test:run -- src/components/__tests__/transit-service-hours.test.tsx`
Expected: PASS

- [ ] **Step 6: i18n 게이트 확인**

Run: `npm run test:run -- src/lib/__tests__/i18n-messages.test.ts`
Expected: PASS(6개 언어 키 일관성)

- [ ] **Step 7: 커밋**

```bash
git add src/components/TransitRouteBriefing.tsx src/components/__tests__/transit-service-hours.test.tsx messages/
git commit -- src/components/TransitRouteBriefing.tsx src/components/__tests__/transit-service-hours.test.tsx messages/ -m "feat(transit): 운행 밖 구간 낭독 문구 6개 언어

같은 li에 쉼표로 이어 붙여 한 줄=한 접근성 객체를 유지한다.
정상·정보없음은 침묵이고 운행 밖만 표기한다(조건부 실패 표기 원칙)."
```

---

### Task 5: CLI·MCP 반영

**Files:**
- Modify: `packages/cli/src/lib/formatters.ts:239-247`(TransitLegItem), `:654-662`(transitLegLine)
- Test: `packages/cli/src/__tests__/formatters-transit.test.ts`(신규. CLI 테스트는 `src/__tests__/`가 관례)

**Interfaces:**
- Consumes: Task 3의 응답 필드
- Produces: 없음(말단 소비자)

- [ ] **Step 1: 실패 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { FORMATTERS } from "../lib/formatters";

// FORMATTERS는 엔드포인트 키 → 포매터 레코드다. transit 키는 "route-transit"(슬래시 아님).
const formatTransit = (body: unknown) => FORMATTERS["route-transit"](body as never).join("\n");

describe("route transit 운행 시간", () => {
  const body = {
    result: {
      recommended: {
        summary: { totalMinutes: 22, fare: 1500, transfers: 0, walkMinutes: 5 },
        legs: [
          {
            mode: "bus",
            lineName: "342",
            fromName: "강동역",
            toName: "길동생태공원",
            stationCount: 14,
            minutes: 22,
            serviceStatus: "outside",
            firstServiceTime: "04:00",
            lastServiceTime: "22:30",
          },
        ],
      },
      alternatives: [],
    },
  };

  it("운행 밖 구간에 첫차·막차와 미운행을 덧붙인다", () => {
    const out = formatTransit(body);
    expect(out).toContain("첫차 04:00");
    expect(out).toContain("운행하지 않음");
  });

  it("running은 덧붙이지 않는다", () => {
    const running = structuredClone(body);
    running.result.recommended.legs[0].serviceStatus = "running";
    expect(formatTransit(running)).not.toContain("첫차");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/cli && npx vitest run src/__tests__/formatters-transit.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`TransitLegItem`에 필드 추가:

```ts
  serviceStatus?: "running" | "outside" | "unknown";
  firstServiceTime?: string;
  lastServiceTime?: string;
```

`transitLegLine`의 `joinText` 마지막 인자 뒤에 추가:

```ts
    leg.serviceStatus === "outside" &&
      leg.firstServiceTime &&
      leg.lastServiceTime &&
      `첫차 ${leg.firstServiceTime}, 막차 ${leg.lastServiceTime}, 지금은 운행하지 않음`,
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd packages/cli && npx vitest run`
Expected: PASS

- [ ] **Step 5: MCP 미러 확인**

Run: `grep -rn "transitLegLine\|TransitLegItem" packages/mcp/src/`
Expected: 결과가 있으면 같은 수정을 mcp에도 적용한다. 없으면(포매터가 CLI 전용) 그대로 둔다. drift 테스트가 있으면 `npm run test:run -- version-drift` 로 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add packages/cli/src/lib/formatters.ts packages/cli/src/__tests__/formatters-transit.test.ts
git commit -- packages/cli/src/lib/formatters.ts packages/cli/src/__tests__/formatters-transit.test.ts -m "feat(cli): 대중교통 구간에 운행 밖 표기

웹과 동일하게 운행 밖만 덧붙이고 정상·정보없음은 침묵한다."
```

⚠ 버전 올림·태그 push는 이 태스크에서 하지 않는다. 다음 `cli-v*` 릴리스에 편승한다(버전 4곳 동조 규칙).

---

### Task 6: iOS 반영

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift:57-69`
- Modify: `ios/Gildongmu/RouteBriefing.swift:62-74`(`transitLegText`)
- Modify: `ios/Gildongmu/Resources/Localizable.xcstrings`(키 추가)
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/RouteModelsTests.swift`(없으면 생성)

**Interfaces:**
- Consumes: Task 3의 응답 필드
- Produces: 없음(말단 소비자)

- [ ] **Step 1: 실패 테스트 작성**

```swift
import Testing
@testable import GildongmuKit

@Test func 운행시간_필드를_디코딩한다() throws {
    let json = """
    {"mode":"bus","lineName":"342","fromName":"강동역","toName":"길동생태공원",
     "stationCount":14,"minutes":22,"serviceStatus":"outside",
     "firstServiceTime":"04:00","lastServiceTime":"22:30"}
    """.data(using: .utf8)!
    let leg = try JSONDecoder().decode(TransitRouteLeg.self, from: json)
    #expect(leg.serviceStatus == "outside")
    #expect(leg.firstServiceTime == "04:00")
    #expect(leg.lastServiceTime == "22:30")
}

@Test func 운행시간_필드가_없어도_디코딩된다() throws {
    let json = """
    {"mode":"bus","lineName":"342","minutes":22}
    """.data(using: .utf8)!
    let leg = try JSONDecoder().decode(TransitRouteLeg.self, from: json)
    #expect(leg.serviceStatus == nil)
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd ios/GildongmuKit && swift test --filter RouteModelsTests`
Expected: FAIL(속성 없음 컴파일 에러)

- [ ] **Step 3: 모델 확장**

`TransitRouteLeg`의 `public let minutes: Int` 뒤에 추가:

```swift
    /// 운행 시간 판정("running"·"outside"·"unknown"). 버스만, 그 외 nil
    public let serviceStatus: String?
    /// 첫차 시각 "04:00"(판정된 경우만)
    public let firstServiceTime: String?
    /// 막차 시각 "22:30"(판정된 경우만)
    public let lastServiceTime: String?
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd ios/GildongmuKit && swift test`
Expected: PASS(기존 테스트 포함)

- [ ] **Step 5: 뷰 렌더**

`RouteBriefing.swift`의 `transitLegText`는 이미 `joinText`로 한 줄을 합친다. 마지막 인자 뒤에 한 줄만 더한다(별도 `Text`를 만들면 접근성 객체가 쪼개져 헌장 위반).

```swift
    return joinText(
        leg.lineName,
        leg.fromName.map { appLocalized("ios.route.board", $0) },
        leg.toName.map { appLocalized("ios.route.alight", $0) },
        leg.stationCount.map { String(format: countKey, String($0)) },
        appLocalized("ios.route.legMinutes", String(leg.minutes)),
        // 운행 밖만 표기(정상·정보없음은 침묵). joinText가 nil 조각을 걸러 준다.
        leg.serviceStatus == "outside"
            ? zip(leg.firstServiceTime, leg.lastServiceTime).map {
                appLocalized("ios.route.serviceOutside", $0, $1)
              }
            : nil)
```

`zip`이 옵셔널 쌍 헬퍼로 없으면 `if let` 두 개로 지역 변수를 만들어 넘긴다(기존 파일 스타일을 따른다).

`Localizable.xcstrings`에 `ios.route.serviceOutside`를 6개 언어로 추가한다(ko: `"첫차 %@, 막차 %@, 지금은 운행하지 않습니다"`). 웹 `legServiceOutside`와 같은 의미를 쓰고, `appLocalized`의 인자 개수(2개)를 맞춘다.

- [ ] **Step 6: 빌드·시뮬 확인**

Run: `cd ios && ./deploy-device.sh` (기기 연결 시) 또는 `xcodebuildmcp simulator build-and-run`
Expected: 빌드 성공. 기기 미연결이면 시뮬레이터 빌드까지만 확인하고 배포는 다음 기회로 미룬다.

- [ ] **Step 7: 커밋**

```bash
git add ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift ios/GildongmuKit/Tests/GildongmuKitTests/RouteModelsTests.swift ios/Gildongmu/Directions/DirectionsTabView.swift ios/Gildongmu/Resources/Localizable.xcstrings
git commit -- ios/ -m "feat(ios): 대중교통 구간 운행 밖 표기

Kit 모델에 옵셔널 3필드를 더하고 행 문자열에 합쳐 한 줄=한 접근성
객체를 유지한다. 옵셔널이라 구버전 응답과도 호환된다."
```

---

### Task 7: 2단계 지방 TAGO 조인

**Files:**
- Modify: `src/lib/providers/bus-service-hours.ts`
- Modify: `src/lib/providers/odsay.ts`(`toLeg`의 서울 한정 조건 해제)
- Test: `src/lib/providers/__tests__/bus-service-hours.test.ts`(케이스 추가)

**Interfaces:**
- Consumes: Task 2의 `ServiceHours`·`fetchServiceHoursMap`
- Produces: `TAGO_CITY_CODE: Record<number, number>`(ODsay busCityCode → TAGO cityCode)

- [ ] **Step 1: 매칭 규칙 실호출 확인(머지 게이트)**

Run: 부산·대구·인천 각 1개 구간으로 ODsay 경로를 뽑아 `busLocalBlID`·`busCityCode`를 얻고, TAGO `getRouteNoList`(해당 cityCode + 노선번호)로 검색해 `routeid.endsWith(busLocalBlID)`가 성립하는지 확인한다.

Expected: 세 지역 모두 `endsWith` 성립(부산은 `BSB5200141000`.endsWith(`5200141000`) 실측 확정). **성립하지 않는 지역은 `TAGO_CITY_CODE`에서 빼고 `unknown`으로 남긴다.** 접두사를 추측해 조립하지 않는다.

- [ ] **Step 2: 실패 테스트 작성**

```ts
// 2026-08-01 실호출 캡처(부산 141번)
const TAGO_141 = {
  response: {
    body: {
      items: {
        item: [
          {
            routeid: "BSB5200141000",
            routeno: "141",
            startvehicletime: "0500",
            endvehicletime: "2200",
          },
          { routeid: "BSB5200999000", routeno: "141", startvehicletime: "0600", endvehicletime: "2100" },
        ],
      },
    },
  },
};

describe("parseTagoRouteHours", () => {
  it("routeid가 busLocalBlID로 끝나는 항목만 고른다", () => {
    expect(parseTagoRouteHours(TAGO_141, "5200141000")).toEqual({
      firstMinutes: 300,
      lastMinutes: 1320,
    });
  });
  it("끝자리가 맞는 항목이 없으면 null이다(이름만 같은 노선 오매칭 금지)", () => {
    expect(parseTagoRouteHours(TAGO_141, "9999999999")).toBeNull();
  });
  it("item이 단일 객체로 와도 처리한다(data.go.kr 1건 관례)", () => {
    const single = {
      response: { body: { items: { item: { routeid: "BSB1", routeno: "1", startvehicletime: "0430", endvehicletime: "2300" } } } },
    };
    expect(parseTagoRouteHours(single, "1")).toEqual({ firstMinutes: 270, lastMinutes: 1380 });
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm run test:run -- src/lib/providers/__tests__/bus-service-hours.test.ts`
Expected: FAIL, "parseTagoRouteHours is not a function"

- [ ] **Step 4: 구현**

`bus-service-hours.ts`에 추가:

```ts
const TAGO_BASE = "http://apis.data.go.kr/1613000/BusRouteInfoInqireService";

/**
 * ODsay busCityCode → TAGO cityCode. 두 체계가 달라 매핑이 불가피하다
 * (부산 ODsay 7000 ↔ TAGO 21). Step 1 실호출로 endsWith 매칭이
 * 확인된 지역만 넣는다. 없는 지역은 조회하지 않고 unknown으로 남는다.
 */
export const TAGO_CITY_CODE: Record<number, number> = {
  // Step 1에서 확인된 값으로 채운다. 부산은 실측 확정.
  7000: 21,
};

/** TAGO 노선 검색 응답에서 busLocalBlID로 끝나는 routeid 항목의 운행시간. */
export function parseTagoRouteHours(raw: unknown, localId: string): ServiceHours | null {
  const item = (raw as { response?: { body?: { items?: { item?: unknown } } } })
    ?.response?.body?.items?.item;
  const list = Array.isArray(item) ? item : item ? [item] : [];
  const hit = list.find(
    (x) => typeof (x as { routeid?: unknown }).routeid === "string" &&
      (x as { routeid: string }).routeid.endsWith(localId),
  ) as { startvehicletime?: string; endvehicletime?: string } | undefined;
  if (!hit) return null;
  return {
    firstMinutes: parseServiceTime(hit.startvehicletime),
    lastMinutes: parseServiceTime(hit.endvehicletime),
  };
}
```

조회 함수와 `fetchServiceHoursMap`의 분기는 서울(`cityCode === 1000`)과 지방을 나눈다. 노선 ID만으로는 지역을 모르므로, `fetchServiceHoursMap`의 인자를 `{ localId: string; cityCode: number; routeNo: string }[]`로 바꾸고 `odsay.ts`의 호출부와 `serviceRouteId` 구성도 함께 고친다(`toLeg`에서 `busCityCode === 1000` 조건을 제거하고 도시코드·노선번호를 함께 싣는다).

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm run test:run`
Expected: 전체 PASS. Task 3의 기존 케이스도 새 시그니처로 함께 갱신되어야 한다.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/providers/bus-service-hours.ts src/lib/providers/odsay.ts src/lib/providers/__tests__/bus-service-hours.test.ts
git commit -- src/lib/providers/bus-service-hours.ts src/lib/providers/odsay.ts src/lib/providers/__tests__/bus-service-hours.test.ts -m "feat(transit): 지방 버스 운행시간 TAGO 조인

TAGO routeid는 ODsay busLocalBlID 앞에 지역 접두사가 붙어(부산 BSB)
직접 조회가 안 된다. 노선번호 검색 후 endsWith 대조로 붙이고,
매칭이 확인된 지역만 매핑에 넣어 나머지는 unknown으로 남긴다."
```

---

### Task 8: 통합 검증과 문서 갱신

**Files:**
- Modify: `PROGRESS.md`
- Modify: `CLAUDE.md`(통합 카탈로그 대중교통 행)

- [ ] **Step 1: 로컬 실호출 검증**

Run: `npm run dev` 후 다른 셸에서
```bash
curl -s "http://localhost:3001/api/route/transit?origin=37.5358819,127.1323963&dest=37.5408157,127.1554188" | python3 -m json.tool | head -40
```
좌표는 `coordSchema`(`src/lib/route-coord-schema.ts:11`)라 `"위도,경도"` 단일 문자열이다. 포트는 3001(3000은 lg-thinq-console launchd 상주).

Expected: 각 버스 leg에 `serviceStatus`가 실리고, 주간이면 `running`. 심야 시간대라면 `outside`가 뒤로 밀린다.

- [ ] **Step 2: 전체 게이트**

Run: `npm run test:run && npm run lint && npm run build`
Expected: 전부 통과

- [ ] **Step 3: 문서 갱신**

`CLAUDE.md` 통합 카탈로그의 대중교통 행에 다음 취지를 한 문장 추가한다: ODsay는 출발 시각을 반영하지 않아 `getTransitRoute`가 TOPIS·TAGO 운행시간을 조인해 `serviceStatus`(running·unknown·outside)를 싣고 안정 정렬로 강등한다. 낭독은 `outside`만 표기한다.

`PROGRESS.md`의 Google Maps 평가 항목에서 "후속 과제로 남긴다"를 실제 결과로 갱신한다(구현 완료 사실, 커밋 범위, 실호출 검증 결과).

- [ ] **Step 4: 커밋·push**

```bash
git add CLAUDE.md PROGRESS.md
git commit -- CLAUDE.md PROGRESS.md -m "docs: 대중교통 운행 시간 판정 반영"
git push origin main
```

- [ ] **Step 5: 최종 리뷰**

`code-reviewer` 서브에이전트로 브랜치 전체 diff를 리뷰한다. 리뷰 지적은 즉시 지엽 패치하지 말고 계층 정합성을 먼저 확인한다.

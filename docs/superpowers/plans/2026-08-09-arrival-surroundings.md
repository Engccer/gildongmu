# 도착지 부근 상황 재구성 (M1) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 목적지 또는 현재 위치 앞에 선 사용자가 "여기가 맞나"를 확인할 수 있도록, 입구를 마주 본 기준의 왼쪽·오른쪽·맞은편·건물 너머로 주변을 재구성해 요청 시 보여준다.

**Architecture:** 계산은 전부 순수 함수(`road-address.ts`·`geo/road-axis.ts`)로 두고, I/O 조립(`road-axis-service.ts`·`surroundings-scene.ts`)이 그 위에 앉는다. 도로 진행축은 juso 건물 목록을 카카오로 지오코딩해 최소제곱으로 복원하고 도로 단위로 캐시한다. 라우트 하나가 앵커 좌표만 받아 장면을 조립하고, 웹 UI가 묶음 제목 + 항목 행으로 렌더한다.

**Tech Stack:** TypeScript, Next.js 16 App Router, zod 4, Vitest 4, @testing-library/react, 카카오 로컬(장소·주소·역지오코딩), 행안부 juso.

## Global Constraints

- **설계 정본은 `docs/superpowers/specs/2026-08-09-arrival-surroundings-design.md`.** 판정 12건과 한계 4종을 바꾸지 않는다.
- **좌우 기준은 "입구를 마주 본" 상태**다. 반대로 구현하면 좌우가 정반대가 된다.
- **축 표본은 juso 건물 목록으로 고정한다.** POI로 세우면 조회마다 축이 회전해 같은 가게가 묶음을 오간다.
- **3-state**: "후보 0건" ≠ "축 복원 실패(방위로 물러남)" ≠ "조회 실패". 뭉개지 않는다.
- **맞은편은 같은 도로 + 본번 + 홀짝 반대일 때만** 판정한다. 모르면 말하지 않는다.
- **한 줄은 단일 텍스트로 합친다**(`joinText`). 시각 스타일용 인라인 `<span>` 분절 금지(접근성 헌장 §4).
- **거리 표기는 `formatDistance`만 지난다**(`src/lib/format.ts`). 소수 km를 직접 조립하지 않는다.
- 커밋 이메일 `engccer@gmail.com`. 주석·커밋 메시지 한국어, 변수·함수명 영어.
- `git add -A` 금지. 의도 파일만 stage한다.
- 이 플랜의 범위는 **웹 + 계산 코어**다. iOS(Kit 미러·뷰)는 별도 플랜.

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/road-address.ts` (신규) | 도로명주소 문자열 → `{road, main, sub}` 파싱, 홀짝 판정 |
| `src/lib/geo/road-axis.ts` (신규) | 축 최소제곱 복원, 입구 좌표계 투영, 묶음 분류 (순수) |
| `src/lib/road-axis-service.ts` (신규) | juso + 지오코딩으로 축 조립, 도로 단위 캐시 |
| `src/lib/surroundings-scene.ts` (신규) | 앵커 → 주소 → 축 → POI → 묶음 → 장면 조립 |
| `src/lib/providers/surroundings.ts` (수정) | 카테고리 세트를 인자로 받도록 확장(기본값은 현행 10종) |
| `src/app/api/surroundings/scene/route.ts` (신규) | 라우트 |
| `src/components/SurroundingsScene.tsx` (신규) | 묶음 제목 + 항목 행 렌더 |
| `src/components/WhereAmI.tsx` (수정) | "내 주변" 진입점 배선 |
| `src/components/DistanceBeacon.tsx` (수정) | 안내 시트 진입점 배선 |
| `messages/*.json` (수정) | 문구 6로케일 |

---

### Task 1: 도로명주소 파싱

**Files:**
- Create: `src/lib/road-address.ts`
- Test: `src/lib/__tests__/road-address.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `parseRoadAddress(addr: string): RoadAddress | null`, `interface RoadAddress { road: string; main: number; sub: number | null }`, `isOddSide(a: RoadAddress): boolean`

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/__tests__/road-address.test.ts
import { describe, expect, it } from "vitest";
import { parseRoadAddress, isOddSide } from "../road-address";

describe("parseRoadAddress", () => {
  it("시·도 접두가 있는 도로명주소를 도로명·본번으로 가른다", () => {
    expect(parseRoadAddress("서울특별시 강동구 명일로24길 25")).toEqual({
      road: "명일로24길", main: 25, sub: null,
    });
  });

  it("부번을 분리한다", () => {
    expect(parseRoadAddress("서울 강동구 명일로 200-16")).toEqual({
      road: "명일로", main: 200, sub: 16,
    });
  });

  it("'대로'·'로'·'길' 세 접미를 모두 받는다", () => {
    expect(parseRoadAddress("서울 강동구 천호대로 1201")?.road).toBe("천호대로");
    expect(parseRoadAddress("서울 강동구 성내로 25")?.road).toBe("성내로");
    expect(parseRoadAddress("서울 강동구 명일로24길 33")?.road).toBe("명일로24길");
  });

  it("지하 표기를 건물번호로 오인하지 않는다", () => {
    expect(parseRoadAddress("서울 서초구 신반포로 지하 188")).toEqual({
      road: "신반포로", main: 188, sub: null,
    });
  });

  it("도로명주소가 아니면 null", () => {
    expect(parseRoadAddress("서울 강동구 길동 470")).toBeNull();
    expect(parseRoadAddress("")).toBeNull();
  });
});

describe("isOddSide", () => {
  it("홀수 본번은 도로 진행 왼쪽이다", () => {
    expect(isOddSide({ road: "성내로", main: 25, sub: null })).toBe(true);
    expect(isOddSide({ road: "성내로", main: 22, sub: null })).toBe(false);
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/__tests__/road-address.test.ts`
Expected: FAIL — `Failed to resolve import "../road-address"`

- [x] **Step 3: 최소 구현**

```ts
// src/lib/road-address.ts
/**
 * 도로명주소 파싱 — M1 좌표계의 입력.
 *
 * 건물번호는 **주된 출입구가 접하는 도로구간의 기초번호**이고(도로명주소법
 * 시행령 제23조①), 홀수는 도로 진행 왼쪽·짝수는 오른쪽이다(제7조④). 그래서
 * 이 파싱 하나가 "입구가 어느 도로 어느 편을 향하는가"를 준다.
 */
export interface RoadAddress {
  road: string;
  /** 본번. 기초번호이자 도로 진행거리의 함수(번호 1당 실측 8~10m). */
  main: number;
  /** 부번. 같은 기초번호를 나눠 쓰므로 축 추정·홀짝 판정에서 제외한다. */
  sub: number | null;
}

/** "지하"·"신관" 같은 수식어가 도로명과 번호 사이에 낀다. */
const ROAD_ADDRESS = /(^|\s)([^\s]*(?:대로|로|길))\s+(?:[가-힣]+\s+)?(\d+)(?:-(\d+))?\s*$/;

export function parseRoadAddress(addr: string): RoadAddress | null {
  const m = String(addr ?? "").trim().match(ROAD_ADDRESS);
  if (!m) return null;
  return { road: m[2], main: Number(m[3]), sub: m[4] ? Number(m[4]) : null };
}

/** 홀수 본번 = 도로 진행 방향 왼쪽(시행령 제7조④). */
export function isOddSide(a: RoadAddress): boolean {
  return a.main % 2 === 1;
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/__tests__/road-address.test.ts`
Expected: PASS (6 tests)

- [x] **Step 5: 커밋**

```bash
git commit -m "feat(m1): 도로명주소 파싱 — 건물번호가 곧 출입구 축이다" -- src/lib/road-address.ts src/lib/__tests__/road-address.test.ts
```

---

### Task 2: 도로 진행축 최소제곱 복원

**Files:**
- Create: `src/lib/geo/road-axis.ts`
- Test: `src/lib/geo/__tests__/road-axis.test.ts`

**Interfaces:**
- Consumes: Task 1의 `RoadAddress`
- Produces: `fitRoadAxis(origin: Coord, samples: AxisSample[]): RoadAxis | null`, `interface AxisSample { main: number; lat: number; lng: number }`, `interface RoadAxis { ux: number; uy: number; metersPerNumber: number; sampleCount: number }`, `toLocalXY(origin: Coord, p: Coord): { x: number; y: number }`

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/geo/__tests__/road-axis.test.ts
import { describe, expect, it } from "vitest";
import { fitRoadAxis, toLocalXY } from "../road-axis";

const ORIGIN = { lat: 37.5, lng: 127.0 };

/** 원점에서 정동쪽으로 번호 1당 10m 늘어서는 가상 도로 */
function eastwardSamples() {
  const mPerDegLng = 111_320 * Math.cos((37.5 * Math.PI) / 180);
  return [1, 3, 5, 7, 9].map((main) => ({
    main,
    lat: 37.5,
    lng: 127.0 + ((main - 1) * 10) / mPerDegLng,
  }));
}

describe("toLocalXY", () => {
  it("동쪽으로 100m 떨어진 점은 x≈100, y≈0", () => {
    const mPerDegLng = 111_320 * Math.cos((37.5 * Math.PI) / 180);
    const p = { lat: 37.5, lng: 127.0 + 100 / mPerDegLng };
    const { x, y } = toLocalXY(ORIGIN, p);
    expect(x).toBeCloseTo(100, 0);
    expect(y).toBeCloseTo(0, 0);
  });
});

describe("fitRoadAxis", () => {
  it("번호 증가 방향을 단위벡터로 준다", () => {
    const axis = fitRoadAxis(ORIGIN, eastwardSamples())!;
    expect(axis.ux).toBeCloseTo(1, 2);
    expect(axis.uy).toBeCloseTo(0, 2);
  });

  it("번호 1당 진행거리를 낸다", () => {
    const axis = fitRoadAxis(ORIGIN, eastwardSamples())!;
    expect(axis.metersPerNumber).toBeCloseTo(10, 0);
  });

  it("표본이 3개 미만이면 null (축을 세울 수 없다)", () => {
    expect(fitRoadAxis(ORIGIN, eastwardSamples().slice(0, 2))).toBeNull();
  });

  it("번호와 좌표가 무상관이면 null — 거짓 축을 세우지 않는다", () => {
    const samples = [1, 3, 5, 7].map((main) => ({ main, lat: 37.5, lng: 127.0 }));
    expect(fitRoadAxis(ORIGIN, samples)).toBeNull();
  });

  it("본번이 같은 표본만 있으면 null (분산 0)", () => {
    const samples = [5, 5, 5].map((main) => ({ main, lat: 37.5, lng: 127.001 }));
    expect(fitRoadAxis(ORIGIN, samples)).toBeNull();
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/geo/__tests__/road-axis.test.ts`
Expected: FAIL — 모듈 없음

- [x] **Step 3: 최소 구현**

```ts
// src/lib/geo/road-axis.ts
import type { Coord } from "../types";

const EARTH_R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** 원점 기준 국소 평면(m). x=동, y=북. 수백 m 범위에서 충분히 정확하다. */
export function toLocalXY(origin: Coord, p: Coord): { x: number; y: number } {
  return {
    x: rad(p.lng - origin.lng) * EARTH_R * Math.cos(rad(origin.lat)),
    y: rad(p.lat - origin.lat) * EARTH_R,
  };
}

export interface AxisSample {
  main: number;
  lat: number;
  lng: number;
}

export interface RoadAxis {
  /** 번호가 커지는 방향 단위벡터 */
  ux: number;
  uy: number;
  /** 번호 1당 도로 진행거리(m). 법정 기초간격 20m에 홀짝 한 쌍이라 8~10m가 정상. */
  metersPerNumber: number;
  sampleCount: number;
}

/** 축을 세우는 데 필요한 최소 표본. 2개면 직선이 유일해 검증이 안 된다. */
const MIN_SAMPLES = 3;
/** 번호 1당 진행거리가 이보다 작으면 번호와 좌표가 무상관이다(거짓 축 방지). */
const MIN_METERS_PER_NUMBER = 1;

/**
 * (본번, 좌표)에 최소제곱 직선을 맞춰 도로 진행축을 복원한다.
 *
 * 번호를 독립변수로 두는 이유: 측면 오프셋(건물이 도로에서 물러난 거리)은
 * 번호와 무상관이라 회귀에서 상쇄된다. 좌표만으로 주성분을 잡으면 그 오프셋이
 * 축을 회전시킨다.
 */
export function fitRoadAxis(origin: Coord, samples: AxisSample[]): RoadAxis | null {
  if (samples.length < MIN_SAMPLES) return null;
  const pts = samples.map((s) => ({ n: s.main, ...toLocalXY(origin, s) }));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const mn = mean(pts.map((p) => p.n));
  const mx = mean(pts.map((p) => p.x));
  const my = mean(pts.map((p) => p.y));
  let sxn = 0, syn = 0, snn = 0;
  for (const p of pts) {
    sxn += (p.n - mn) * (p.x - mx);
    syn += (p.n - mn) * (p.y - my);
    snn += (p.n - mn) ** 2;
  }
  if (snn === 0) return null;
  const dx = sxn / snn;
  const dy = syn / snn;
  const len = Math.hypot(dx, dy);
  if (len < MIN_METERS_PER_NUMBER) return null;
  return { ux: dx / len, uy: dy / len, metersPerNumber: len, sampleCount: pts.length };
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/geo/__tests__/road-axis.test.ts`
Expected: PASS (6 tests)

- [x] **Step 5: 커밋**

```bash
git commit -m "feat(m1): 도로 진행축 최소제곱 복원 — 번호를 독립변수로" -- src/lib/geo/road-axis.ts src/lib/geo/__tests__/road-axis.test.ts
```

---

### Task 3: 입구 좌표계 투영과 묶음 분류

**Files:**
- Modify: `src/lib/geo/road-axis.ts`
- Test: `src/lib/geo/__tests__/road-axis.test.ts` (같은 파일에 describe 추가)

**Interfaces:**
- Consumes: Task 2의 `RoadAxis`·`toLocalXY`, Task 1의 `RoadAddress`
- Produces: `entranceFrame(axis: RoadAxis, anchorIsOdd: boolean): EntranceFrame`, `interface EntranceFrame { vx: number; vy: number; rx: number; ry: number }`, `classifyBucket(frame, origin, target, opts): SurroundingBucket`, `type SurroundingBucket = "left" | "right" | "across" | "beyond"`

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/geo/__tests__/road-axis.test.ts 에 추가
import { entranceFrame, classifyBucket } from "../road-axis";

describe("entranceFrame", () => {
  // 축이 정동쪽(ux=1)일 때, 홀수 건물은 진행 왼쪽 = 북쪽에 있다.
  // 사용자는 도로(남쪽)에서 건물(북쪽)을 본다 → 시선은 북쪽(+y).
  const axis = { ux: 1, uy: 0, metersPerNumber: 10, sampleCount: 5 };

  it("홀수 앵커의 시선은 축을 +90° 돌린 방향", () => {
    const f = entranceFrame(axis, true);
    expect(f.vx).toBeCloseTo(0, 6);
    expect(f.vy).toBeCloseTo(1, 6);
  });

  it("짝수 앵커의 시선은 정반대", () => {
    const f = entranceFrame(axis, false);
    expect(f.vy).toBeCloseTo(-1, 6);
  });

  it("사용자 오른쪽은 시선을 -90° 돌린 방향 (홀수면 축 방향)", () => {
    const f = entranceFrame(axis, true);
    expect(f.rx).toBeCloseTo(1, 6);
    expect(f.ry).toBeCloseTo(0, 6);
  });
});

describe("classifyBucket", () => {
  const axis = { ux: 1, uy: 0, metersPerNumber: 10, sampleCount: 5 };
  const frame = entranceFrame(axis, true); // 홀수 앵커, 시선 북
  const ORIGIN = { lat: 37.5, lng: 127.0 };
  const mPerDegLng = 111_320 * Math.cos((37.5 * Math.PI) / 180);
  const east = (m: number) => ({ lat: 37.5, lng: 127.0 + m / mPerDegLng });
  const north = (m: number) => ({ lat: 37.5 + m / 110_574, lng: 127.0 });

  it("축 방향(동쪽)은 오른쪽", () => {
    expect(classifyBucket(frame, ORIGIN, east(50), {})).toBe("right");
  });

  it("축 반대(서쪽)는 왼쪽", () => {
    expect(classifyBucket(frame, ORIGIN, east(-50), {})).toBe("left");
  });

  it("시선 방향으로 임계를 넘으면 건물 너머", () => {
    expect(classifyBucket(frame, ORIGIN, north(40), {})).toBe("beyond");
  });

  it("시선 방향이라도 임계 안이면 좌우로 남는다", () => {
    expect(classifyBucket(frame, ORIGIN, { lat: north(10).lat, lng: east(30).lng }, {})).toBe("right");
  });

  it("같은 도로 홀짝 반대는 맞은편이 건물 너머를 이긴다", () => {
    expect(classifyBucket(frame, ORIGIN, north(40), { acrossByParity: true })).toBe("across");
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/geo/__tests__/road-axis.test.ts`
Expected: FAIL — `entranceFrame is not a function`

- [x] **Step 3: 최소 구현 (`road-axis.ts`에 추가)**

```ts
/** 입구를 마주 본 사용자의 좌표계. v=시선(도로→건물), r=오른손 방향. */
export interface EntranceFrame {
  vx: number;
  vy: number;
  rx: number;
  ry: number;
}

/**
 * 홀수 앵커면 건물이 축의 왼쪽에 있으므로 도로는 건물의 오른쪽(축 -90°)이고,
 * 도로에서 건물을 보는 시선은 그 반대인 축 +90°다. 짝수는 부호가 뒤집힌다.
 *
 * ⚠ 이 부호를 뒤집으면 좌우가 정반대가 된다. 위원장 판정은 "입구를 마주 본" 기준이다.
 */
export function entranceFrame(axis: RoadAxis, anchorIsOdd: boolean): EntranceFrame {
  const sign = anchorIsOdd ? 1 : -1;
  const vx = -axis.uy * sign;
  const vy = axis.ux * sign;
  // 오른손 = 시선을 -90° 회전
  return { vx, vy, rx: vy, ry: -vx };
}

export type SurroundingBucket = "left" | "right" | "across" | "beyond";

/** 시선 방향으로 이만큼 넘어가면 건물 너머(돌아가야 한다). spec §3.3 동결값. */
export const BEYOND_THRESHOLD_M = 25;

export function classifyBucket(
  frame: EntranceFrame,
  origin: Coord,
  target: Coord,
  opts: { acrossByParity?: boolean },
): SurroundingBucket {
  // 맞은편은 법이 정한 판정이라 기하보다 강하다(spec §3.3).
  if (opts.acrossByParity) return "across";
  const q = toLocalXY(origin, target);
  const forward = q.x * frame.vx + q.y * frame.vy;
  if (forward > BEYOND_THRESHOLD_M) return "beyond";
  const right = q.x * frame.rx + q.y * frame.ry;
  return right >= 0 ? "right" : "left";
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/geo/__tests__/road-axis.test.ts`
Expected: PASS (14 tests)

- [x] **Step 5: 변이 주입으로 검출력을 실측한다**

`entranceFrame`의 `sign`을 `anchorIsOdd ? -1 : 1`로 뒤집고 테스트를 돌린다.
Expected: 좌우 케이스가 **깨져야 한다**. 안 깨지면 테스트가 축 부호를 잠그지 못하는 것이므로 케이스를 보강한다. 확인 후 원복한다.

- [x] **Step 6: 커밋**

```bash
git commit -m "feat(m1): 입구 좌표계 투영 + 네 묶음 분류" -- src/lib/geo/road-axis.ts src/lib/geo/__tests__/road-axis.test.ts
```

---

### Task 4: 축 조립 서비스 (juso + 지오코딩 + 캐시)

**Files:**
- Create: `src/lib/road-axis-service.ts`
- Test: `src/lib/__tests__/road-axis-service.test.ts`

**Interfaces:**
- Consumes: Task 1·2, `searchJusoAddresses(keyword, page, size)` (`src/lib/providers/juso-address.ts`, `JusoAddress.roadAddrPart1`), `geocodeAddress` (아래 Step 3에서 `kakao-address.ts` 확인)
- Produces: `resolveRoadAxis(region: string, road: string, origin: Coord): Promise<RoadAxis | null>`

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/__tests__/road-axis-service.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const searchJusoAddresses = vi.fn();
const geocodeAddress = vi.fn();
vi.mock("../providers/juso-address", () => ({ searchJusoAddresses: (...a: unknown[]) => searchJusoAddresses(...a) }));
vi.mock("../providers/kakao-address", () => ({ geocodeAddress: (...a: unknown[]) => geocodeAddress(...a) }));

const { resolveRoadAxis } = await import("../road-axis-service");

const ORIGIN = { lat: 37.5415, lng: 127.1495 };
const mPerDegLng = 111_320 * Math.cos((37.5415 * Math.PI) / 180);

beforeEach(() => {
  searchJusoAddresses.mockReset();
  geocodeAddress.mockReset();
});

describe("resolveRoadAxis", () => {
  it("juso 건물 목록을 지오코딩해 축을 세운다", async () => {
    searchJusoAddresses.mockResolvedValue(
      [5, 11, 13, 25, 33].map((n) => ({ roadAddrPart1: `서울특별시 강동구 명일로24길 ${n}` })),
    );
    geocodeAddress.mockImplementation(async (addr: string) => {
      const n = Number(addr.match(/(\d+)$/)![1]);
      return { lat: 37.5415, lng: 127.1495 + (n * 8) / mPerDegLng };
    });
    const axis = await resolveRoadAxis("서울특별시 강동구", "명일로24길", ORIGIN);
    expect(axis).not.toBeNull();
    expect(axis!.metersPerNumber).toBeCloseTo(8, 0);
    expect(axis!.ux).toBeCloseTo(1, 2);
  });

  it("부번 주소는 축 표본에서 뺀다 — 같은 기초번호라 축을 흐린다", async () => {
    searchJusoAddresses.mockResolvedValue([
      { roadAddrPart1: "서울 강동구 명일로 200-16" },
      { roadAddrPart1: "서울 강동구 명일로 200-34" },
      { roadAddrPart1: "서울 강동구 명일로 200-9" },
    ]);
    geocodeAddress.mockResolvedValue({ lat: 37.5415, lng: 127.1495 });
    expect(await resolveRoadAxis("서울 강동구", "명일로", ORIGIN)).toBeNull();
    expect(geocodeAddress).not.toHaveBeenCalled();
  });

  it("표본이 모자라면 null (거짓 축을 세우지 않는다)", async () => {
    searchJusoAddresses.mockResolvedValue([{ roadAddrPart1: "서울 강동구 성내로 25" }]);
    expect(await resolveRoadAxis("서울 강동구", "성내로", ORIGIN)).toBeNull();
  });

  it("juso가 throw하면 null로 흡수한다 — 축 실패는 방위 폴백이지 오류가 아니다", async () => {
    searchJusoAddresses.mockRejectedValue(new Error("HTTP 500"));
    expect(await resolveRoadAxis("서울 강동구", "성내로", ORIGIN)).toBeNull();
  });

  it("지오코딩이 일부 실패해도 남은 표본으로 세운다", async () => {
    searchJusoAddresses.mockResolvedValue(
      [1, 3, 5, 7].map((n) => ({ roadAddrPart1: `서울 강동구 성내로 ${n}` })),
    );
    geocodeAddress.mockImplementation(async (addr: string) => {
      const n = Number(addr.match(/(\d+)$/)![1]);
      if (n === 3) return null;
      return { lat: 37.5415, lng: 127.1495 + (n * 10) / mPerDegLng };
    });
    const axis = await resolveRoadAxis("서울 강동구", "성내로", ORIGIN);
    expect(axis?.sampleCount).toBe(3);
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/__tests__/road-axis-service.test.ts`
Expected: FAIL — 모듈 없음

- [x] **Step 3: 카카오 주소 지오코딩 함수 이름을 확인한다**

Run: `grep -n "export async function" src/lib/providers/kakao-address.ts`

`geocodeAddress`가 없으면 그 파일에 아래를 추가하고, 테스트의 `vi.mock` 대상도 실제 이름에 맞춘다.

```ts
/** 도로명주소 문자열 → 좌표. 없으면 null(3-state: 실패는 throw). */
export async function geocodeAddress(address: string): Promise<Coord | null> {
  const url = new URL("https://dapi.kakao.com/v2/local/search/address.json");
  url.searchParams.set("query", address);
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY ?? ""}` },
    next: { revalidate: 86_400 },
  });
  if (!res.ok) throw new Error(`카카오 주소 지오코딩 실패: HTTP ${res.status}`);
  const data = (await res.json()) as { documents?: { x: string; y: string }[] };
  const d = data.documents?.[0];
  return d ? { lat: Number(d.y), lng: Number(d.x) } : null;
}
```

- [x] **Step 4: 최소 구현**

```ts
// src/lib/road-axis-service.ts
import { unstable_cache } from "next/cache";
import { searchJusoAddresses } from "./providers/juso-address";
import { geocodeAddress } from "./providers/kakao-address";
import { parseRoadAddress } from "./road-address";
import { fitRoadAxis, type AxisSample, type RoadAxis } from "./geo/road-axis";
import type { Coord } from "./types";

/** 축 표본 상한. 도로 하나에 지오코딩을 무한정 돌리지 않는다. */
const MAX_SAMPLES = 12;

/**
 * 도로 진행축을 juso 건물 목록으로 복원한다.
 *
 * ⚠ **표본을 POI로 잡지 않는다.** 카테고리 세트·반경이 조금만 달라져도 축이
 * 미세하게 회전해, 임계 근처 장소가 조회할 때마다 다른 묶음으로 간다(실측).
 * juso는 같은 도로에 대해 항상 같은 건물 집합을 주므로 결정론적이다. 골목처럼
 * POI가 적은 곳도 건물은 있어서 살아난다(명일로24길: POI 3건 vs 건물 5건).
 *
 * 실패는 전부 null이다. 축이 없으면 상위 계층이 절대 방위로 물러난다(3-state).
 */
async function fetchRoadAxis(region: string, road: string, origin: Coord): Promise<RoadAxis | null> {
  let rows: { roadAddrPart1: string }[];
  try {
    rows = await searchJusoAddresses(`${region} ${road}`, 1, 100);
  } catch {
    return null;
  }
  // 본번만 남기고 중복 제거 — 부번은 같은 기초번호라 축 추정을 흐린다.
  const byMain = new Map<number, string>();
  for (const r of rows) {
    const parsed = parseRoadAddress(r.roadAddrPart1);
    if (!parsed || parsed.road !== road || parsed.sub !== null) continue;
    if (!byMain.has(parsed.main)) byMain.set(parsed.main, r.roadAddrPart1);
  }
  if (byMain.size < 3) return null;

  const picked = [...byMain.entries()].slice(0, MAX_SAMPLES);
  const samples: AxisSample[] = [];
  for (const [main, addr] of picked) {
    try {
      const coord = await geocodeAddress(addr);
      if (coord) samples.push({ main, lat: coord.lat, lng: coord.lng });
    } catch {
      // 개별 실패는 표본 하나를 잃을 뿐이다.
    }
  }
  return fitRoadAxis(origin, samples);
}

/**
 * 도로 축은 변하지 않으므로 도로 단위로 캐시한다. 요청형 기능이라 첫 조회의
 * 왕복 지연은 허용된다(자동 발화 경로가 아니다).
 */
export function resolveRoadAxis(region: string, road: string, origin: Coord): Promise<RoadAxis | null> {
  return unstable_cache(
    () => fetchRoadAxis(region, road, origin),
    ["road-axis", region, road],
    { revalidate: 86_400 },
  )();
}
```

- [x] **Step 5: 통과를 확인한다**

Run: `npx vitest run src/lib/__tests__/road-axis-service.test.ts`
Expected: PASS (5 tests)

⚠ `unstable_cache`가 테스트 환경에서 문제를 일으키면 `fetchRoadAxis`를 export해 테스트가 그것을 부르게 하고, `resolveRoadAxis`는 캐시 래퍼로만 남긴다.

- [x] **Step 6: 커밋**

```bash
git commit -m "feat(m1): 축 조립 서비스 — juso 건물로 표본을 고정한다" -- src/lib/road-axis-service.ts src/lib/__tests__/road-axis-service.test.ts src/lib/providers/kakao-address.ts
```

---

### Task 5: 둘러보기 provider의 카테고리 세트를 인자로

**Files:**
- Modify: `src/lib/providers/surroundings.ts`
- Test: `src/lib/providers/__tests__/surroundings.test.ts` (없으면 생성)

**Interfaces:**
- Produces: `findSurroundingsNear(lat, lng, opts?: { groups?: string[]; radiusMeters?: number })` — 기존 호출부는 인자를 안 주므로 동작이 바뀌지 않는다. `ALL_CATEGORY_GROUPS` 상수 export.

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/providers/__tests__/surroundings.test.ts
import { describe, expect, it } from "vitest";
import { ALL_CATEGORY_GROUPS, DEFAULT_CATEGORY_GROUPS } from "../surroundings";

describe("카테고리 세트", () => {
  it("기본 세트는 현행 10종 그대로다 — 둘러보기 회귀 0", () => {
    expect(DEFAULT_CATEGORY_GROUPS).toEqual(
      expect.arrayContaining(["CS2", "SW8", "FD6", "CE7", "BK9", "PM9", "HP8", "MT1", "PO3", "AT4"]),
    );
    expect(DEFAULT_CATEGORY_GROUPS).toHaveLength(10);
  });

  it("전체 세트는 카카오 18종이고 학교(SC4)를 포함한다", () => {
    expect(ALL_CATEGORY_GROUPS).toHaveLength(18);
    expect(ALL_CATEGORY_GROUPS).toContain("SC4");
    expect(ALL_CATEGORY_GROUPS).toContain("PS3");
    expect(ALL_CATEGORY_GROUPS).toContain("CT1");
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/providers/__tests__/surroundings.test.ts`
Expected: FAIL — `ALL_CATEGORY_GROUPS` 없음

- [x] **Step 3: 구현**

`surroundings.ts`의 `CATEGORY_GROUPS` 레코드는 그대로 두고 아래를 추가한다. 그리고 `findSurroundingsNear`가 순회하는 `Object.keys(CATEGORY_GROUPS)` 자리를 `opts?.groups ?? DEFAULT_CATEGORY_GROUPS`로 바꾼다. 반경도 `opts?.radiusMeters ?? RADIUS_METERS`로 받는다.

```ts
/** 현행 둘러보기 세트. 바꾸면 "내 주변 → 둘러보기"가 함께 바뀐다. */
export const DEFAULT_CATEGORY_GROUPS = Object.keys(CATEGORY_GROUPS);

/**
 * 카카오 category_group_code 전 18종. M1(부근 재구성)이 쓴다.
 * 둘러보기가 10종만 받는 것은 "갈 곳 고르기"라는 목적 때문이고, M1은
 * "여기가 맞나"라 학교·유치원·주차장·문화시설이 오히려 핵심 단서다.
 */
export const ALL_CATEGORY_GROUPS = [
  "MT1", "CS2", "PS3", "SC4", "AC5", "PK6", "OL7", "SW8", "BK9",
  "CT1", "AG2", "PO3", "AT4", "AD5", "FD6", "CE7", "HP8", "PM9",
];
```

⚠ `CATEGORY_GROUPS` 매핑에 없는 코드는 `normalizeSurroundingDoc`이 null로 버린다. 18종 전부를 살리려면 그 레코드에도 나머지 8종의 라벨을 더해야 한다(`PS3: "kindergarten"`, `SC4: "school"`, `AC5: "academy"`, `PK6: "parking"`, `OL7: "gasStation"`, `CT1: "culture"`, `AG2: "realEstate"`, `AD5: "lodging"`). `SurroundingCategory` 유니온과 i18n `category.*` 키도 함께 넓힌다.

⚠ **`SurroundingPlace`에 `roadAddress`를 추가한다** — Task 6이 이 필드로 "같은 도로인가"를 판정한다. 카카오 응답에 `road_address_name`이 이미 들어 있으므로 `normalizeSurroundingDoc`에서 실어 보내기만 하면 된다. `KakaoCatDoc`에도 `road_address_name?: string`을 더한다.

```ts
// src/lib/types.ts — SurroundingPlace에 추가
/** 도로명주소. M1이 "같은 도로인가"·"맞은편인가" 판정에 쓴다. 없으면 null. */
roadAddress: string | null;

// surroundings.ts — normalizeSurroundingDoc 반환에 추가
roadAddress: doc.road_address_name ?? null,
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/providers/__tests__/surroundings.test.ts && npx vitest run src/lib/__tests__/i18n-messages.test.ts`
Expected: PASS 둘 다 (i18n 키 정합이 머지 게이트다)

- [x] **Step 5: 둘러보기 회귀가 없는지 확인한다**

Run: `npx vitest run src/components/__tests__/ src/lib/__tests__/`
Expected: PASS — 기존 호출부가 인자를 안 주므로 동작 불변

- [x] **Step 6: 커밋**

```bash
git commit -m "feat(m1): 둘러보기 카테고리 세트를 인자로 — 기본값은 현행 10종" -- src/lib/providers/surroundings.ts src/lib/providers/__tests__/surroundings.test.ts src/lib/types.ts messages/
```

---

### Task 6: 장면 조립 서비스

**Files:**
- Create: `src/lib/surroundings-scene.ts`
- Test: `src/lib/__tests__/surroundings-scene.test.ts`

**Interfaces:**
- Consumes: Task 1~5 전부, `coordToAddress`·`coordToRegion`(`kakao-address.ts`), `findSurroundingsNear`
- Produces: `assembleScene(lat: number, lng: number): Promise<Scene>`, `interface Scene { place: string | null; frame: "entrance" | "compass"; groups: SceneGroup[]; total: number }`, `interface SceneGroup { bucket: SurroundingBucket | CompassDirection; items: SceneItem[] }`, `interface SceneItem { name: string; distanceMeters: number; road: string | null; category: string }`

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/__tests__/surroundings-scene.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const coordToAddress = vi.fn();
const coordToRegion = vi.fn();
const findSurroundingsNear = vi.fn();
const resolveRoadAxis = vi.fn();

vi.mock("../providers/kakao-address", () => ({
  coordToAddress: (...a: unknown[]) => coordToAddress(...a),
  coordToRegion: (...a: unknown[]) => coordToRegion(...a),
}));
vi.mock("../providers/surroundings", () => ({
  findSurroundingsNear: (...a: unknown[]) => findSurroundingsNear(...a),
  ALL_CATEGORY_GROUPS: ["SC4"],
}));
vi.mock("../road-axis-service", () => ({ resolveRoadAxis: (...a: unknown[]) => resolveRoadAxis(...a) }));

const { assembleScene } = await import("../surroundings-scene");

const mPerDegLng = 111_320 * Math.cos((37.5415 * Math.PI) / 180);
const east = (m: number) => 127.1495 + m / mPerDegLng;

beforeEach(() => {
  coordToAddress.mockResolvedValue({ roadAddress: "서울특별시 강동구 명일로24길 25", jibunAddress: null });
  coordToRegion.mockResolvedValue("서울특별시 강동구 길동");
  resolveRoadAxis.mockResolvedValue({ ux: 1, uy: 0, metersPerNumber: 8, sampleCount: 5 });
  findSurroundingsNear.mockResolvedValue([
    { name: "서울신명초등학교", lat: 37.5415, lng: east(75), distanceMeters: 75, category: "school", roadAddress: "서울특별시 강동구 명일로24길 33" },
    { name: "봉래면옥", lat: 37.5415, lng: east(-62), distanceMeters: 62, category: "restaurant", roadAddress: "서울 강동구 명일로 200-16" },
  ]);
});

describe("assembleScene", () => {
  it("축이 서면 입구 기준 좌우로 묶는다", async () => {
    const scene = await assembleScene(37.5415, 127.1495);
    expect(scene.frame).toBe("entrance");
    const right = scene.groups.find((g) => g.bucket === "right");
    expect(right?.items[0]?.name).toBe("서울신명초등학교");
    const left = scene.groups.find((g) => g.bucket === "left");
    expect(left?.items[0]?.name).toBe("봉래면옥");
  });

  it("목적지와 다른 도로면 길 이름을 단서로 남긴다", async () => {
    const scene = await assembleScene(37.5415, 127.1495);
    const left = scene.groups.find((g) => g.bucket === "left");
    expect(left?.items[0]?.road).toBe("명일로");
  });

  it("같은 도로면 길 이름을 붙이지 않는다 — 잉여다", async () => {
    const scene = await assembleScene(37.5415, 127.1495);
    const right = scene.groups.find((g) => g.bucket === "right");
    expect(right?.items[0]?.road).toBeNull();
  });

  it("축을 못 세우면 절대 방위로 물러난다 — 침묵하지 않는다", async () => {
    resolveRoadAxis.mockResolvedValue(null);
    const scene = await assembleScene(37.5415, 127.1495);
    expect(scene.frame).toBe("compass");
    expect(scene.groups.flatMap((g) => g.items)).toHaveLength(2);
  });

  it("도로명주소를 못 얻어도 방위로 물러난다", async () => {
    coordToAddress.mockResolvedValue({ roadAddress: null, jibunAddress: "서울 강동구 길동 477" });
    const scene = await assembleScene(37.5415, 127.1495);
    expect(scene.frame).toBe("compass");
    expect(resolveRoadAxis).not.toHaveBeenCalled();
  });

  it("후보가 0건이면 빈 묶음이 아니라 total 0을 준다", async () => {
    findSurroundingsNear.mockResolvedValue([]);
    const scene = await assembleScene(37.5415, 127.1495);
    expect(scene.total).toBe(0);
    expect(scene.groups).toHaveLength(0);
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/__tests__/surroundings-scene.test.ts`
Expected: FAIL — 모듈 없음

- [x] **Step 3: 최소 구현**

```ts
// src/lib/surroundings-scene.ts
import { coordToAddress, coordToRegion } from "./providers/kakao-address";
import { findSurroundingsNear, ALL_CATEGORY_GROUPS } from "./providers/surroundings";
import { resolveRoadAxis } from "./road-axis-service";
import { parseRoadAddress, isOddSide } from "./road-address";
import { classifyBucket, entranceFrame, type SurroundingBucket } from "./geo/road-axis";
import { bearingDegrees, bearingToCompass8, type CompassDirection } from "./geo/bearing";

/** spec §8: "한눈에 보이는" 범위. 넓히면 "옆에 있다"는 진술이 약해진다. */
const RADIUS_M = 150;

export interface SceneItem {
  name: string;
  distanceMeters: number;
  /** 앵커와 다른 도로일 때만 채운다(같으면 잉여). */
  road: string | null;
  category: string;
}
export interface SceneGroup {
  bucket: SurroundingBucket | CompassDirection;
  items: SceneItem[];
}
export interface Scene {
  place: string | null;
  /** entrance = 입구 기준 좌우, compass = 절대 방위 폴백(3-state) */
  frame: "entrance" | "compass";
  groups: SceneGroup[];
  total: number;
}

const BUCKET_ORDER: SurroundingBucket[] = ["left", "right", "across", "beyond"];

export async function assembleScene(lat: number, lng: number): Promise<Scene> {
  const [addr, region, places] = await Promise.all([
    coordToAddress({ lat, lng }).catch(() => null),
    coordToRegion({ lat, lng }).catch(() => null),
    findSurroundingsNear(lat, lng, { groups: ALL_CATEGORY_GROUPS, radiusMeters: RADIUS_M }),
  ]);

  const roadAddress = addr?.roadAddress ?? null;
  const place = [region, roadAddress ?? addr?.jibunAddress].filter(Boolean).join(", ") || null;
  const anchor = roadAddress ? parseRoadAddress(roadAddress) : null;

  const axis = anchor && region
    ? await resolveRoadAxis(region.split(" ").slice(0, -1).join(" "), anchor.road, { lat, lng })
    : null;

  const toItem = (p: { name: string; distanceMeters: number; category: string; roadAddress?: string | null }) => {
    const parsed = p.roadAddress ? parseRoadAddress(p.roadAddress) : null;
    return {
      name: p.name,
      distanceMeters: Math.round(p.distanceMeters),
      road: parsed && parsed.road !== anchor?.road ? parsed.road : null,
      category: p.category,
    };
  };

  const grouped = new Map<string, SceneItem[]>();
  if (axis && anchor) {
    const frame = entranceFrame(axis, isOddSide(anchor));
    for (const p of places) {
      const parsed = p.roadAddress ? parseRoadAddress(p.roadAddress) : null;
      const acrossByParity =
        !!parsed && parsed.road === anchor.road && parsed.sub === null && anchor.sub === null &&
        parsed.main % 2 !== anchor.main % 2;
      const bucket = classifyBucket(frame, { lat, lng }, { lat: p.lat, lng: p.lng }, { acrossByParity });
      grouped.set(bucket, [...(grouped.get(bucket) ?? []), toItem(p)]);
    }
    const groups = BUCKET_ORDER.filter((b) => grouped.has(b)).map((b) => ({
      bucket: b as SurroundingBucket,
      items: grouped.get(b)!.sort((a, c) => a.distanceMeters - c.distanceMeters),
    }));
    return { place, frame: "entrance", groups, total: places.length };
  }

  // 폴백: 축을 못 세웠다. 침묵하지 않고 절대 방위로 물러난다(3-state).
  for (const p of places) {
    const dir = bearingToCompass8(bearingDegrees(lat, lng, p.lat, p.lng));
    grouped.set(dir, [...(grouped.get(dir) ?? []), toItem(p)]);
  }
  const groups = [...grouped.entries()]
    .map(([bucket, items]) => ({
      bucket: bucket as CompassDirection,
      items: items.sort((a, c) => a.distanceMeters - c.distanceMeters),
    }))
    .sort((a, b) => (a.items[0]?.distanceMeters ?? 0) - (b.items[0]?.distanceMeters ?? 0));
  return { place, frame: "compass", groups, total: places.length };
}
```

⚠ `findSurroundingsNear`가 반환하는 항목에 `roadAddress`가 없으면 Task 5에서 `normalizeSurroundingDoc`이 `doc.road_address_name`을 실어 보내도록 함께 넓힌다(카카오 응답에 이미 들어 있다).

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/__tests__/surroundings-scene.test.ts`
Expected: PASS (6 tests)

- [x] **Step 5: 커밋**

```bash
git commit -m "feat(m1): 장면 조립 — 축이 서면 입구 기준, 아니면 방위 폴백" -- src/lib/surroundings-scene.ts src/lib/__tests__/surroundings-scene.test.ts src/lib/providers/surroundings.ts
```

---

### Task 7: 라우트

**Files:**
- Create: `src/app/api/surroundings/scene/route.ts`
- Test: `src/app/api/__tests__/surroundings-scene-route.test.ts`

**Interfaces:**
- Consumes: Task 6의 `assembleScene`
- Produces: `GET /api/surroundings/scene?lat=..&lng=..` → `{ data: Scene }` | `{ outOfCoverage: true }` | `{ data: null }`(키 없음) | 400 | 502

- [x] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/app/api/__tests__/surroundings-scene-route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const assembleScene = vi.fn();
const hasKakaoKey = vi.fn(() => true);
vi.mock("@/lib/surroundings-scene", () => ({ assembleScene: (...a: unknown[]) => assembleScene(...a) }));
vi.mock("@/lib/env", () => ({ hasKakaoKey: () => hasKakaoKey() }));

const { GET } = await import("../surroundings/scene/route");
const req = (qs: string) => new Request(`http://localhost/api/surroundings/scene${qs}`) as never;

beforeEach(() => {
  assembleScene.mockReset();
  hasKakaoKey.mockReturnValue(true);
});

describe("GET /api/surroundings/scene", () => {
  it("좌표 누락은 400 — (0,0)으로 흘려보내지 않는다", async () => {
    const res = await GET(req("?lng=127.0"));
    expect(res.status).toBe(400);
  });

  it("한국 밖은 200 outOfCoverage (upstream 미호출)", async () => {
    const res = await GET(req("?lat=48.85&lng=2.35"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(assembleScene).not.toHaveBeenCalled();
  });

  it("키가 없으면 data null", async () => {
    hasKakaoKey.mockReturnValue(false);
    const res = await GET(req("?lat=37.5415&lng=127.1495"));
    expect(await res.json()).toEqual({ data: null });
  });

  it("조립 실패는 502 — 0건과 구분한다", async () => {
    assembleScene.mockRejectedValue(new Error("upstream"));
    const res = await GET(req("?lat=37.5415&lng=127.1495"));
    expect(res.status).toBe(502);
  });

  it("정상은 장면을 그대로 싣는다", async () => {
    assembleScene.mockResolvedValue({ place: "성내로 25", frame: "entrance", groups: [], total: 0 });
    const res = await GET(req("?lat=37.5415&lng=127.1495"));
    expect((await res.json()).data.frame).toBe("entrance");
  });
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/app/api/__tests__/surroundings-scene-route.test.ts`
Expected: FAIL — 라우트 없음

- [x] **Step 3: 구현** (`src/app/api/where-am-i/route.ts`를 골격으로 삼는다)

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { hasKakaoKey } from "@/lib/env";
import { isInKorea } from "@/lib/coverage";
import { assembleScene } from "@/lib/surroundings-scene";

/**
 * GET /api/surroundings/scene?lat=..&lng=..
 * 앵커 주변을 입구 기준 좌우로 재구성한다(M1). 축을 못 세우면 방위 폴백이라
 * 200이고, 조회 실패만 502다(3-state).
 */
export const dynamic = "force-dynamic";

const querySchema = z.object({ lat: latParam(), lng: lngParam() });

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    lat: request.nextUrl.searchParams.get("lat") ?? "",
    lng: request.nextUrl.searchParams.get("lng") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "잘못된 요청" }, { status: 400 });
  }
  if (!isInKorea(parsed.data.lat, parsed.data.lng)) {
    return NextResponse.json({ outOfCoverage: true });
  }
  if (!hasKakaoKey()) return NextResponse.json({ data: null });
  try {
    const data = await assembleScene(parsed.data.lat, parsed.data.lng);
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[surroundings/scene] 조립 실패:", e);
    return NextResponse.json({ error: "주변 정보를 조회하지 못했습니다." }, { status: 502 });
  }
}
```

- [x] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/app/api/__tests__/surroundings-scene-route.test.ts && npx vitest run src/app/api/__tests__/coord-param-usage.test.ts`
Expected: PASS 둘 다 (좌표 파라미터 가드가 신규 라우트를 스캔한다)

- [x] **Step 5: 커밋**

```bash
git commit -m "feat(m1): 부근 재구성 라우트" -- src/app/api/surroundings/scene/route.ts src/app/api/__tests__/surroundings-scene-route.test.ts
```

---

### Task 8: 웹 UI — 묶음 제목 + 항목 행

**Files:**
- Create: `src/components/SurroundingsScene.tsx`
- Test: `src/components/__tests__/SurroundingsScene.test.tsx`
- Modify: `messages/ko.json`·`en.json`·`es.json`·`fr.json`·`it.json`·`ja.json`

**Interfaces:**
- Consumes: Task 6의 `Scene` 타입, `useNearbyFetch`(`src/hooks/useNearbyFetch.ts`), `NearbyPanelShell`, `formatDistance`·`joinText`(`src/lib/format.ts`)
- Produces: `<SurroundingsScene anchor={{ lat, lng } | null} />`

- [x] **Step 1: i18n 키를 추가한다** (6로케일 전부. ko 예시)

```json
"surroundings": {
  "button": "주변 확인",
  "refresh": "주변 다시 확인",
  "loading": "주변 조회 중…",
  "ready": "주변 상황",
  "empty": "150m 안에 등록된 가게나 시설이 없습니다.",
  "error": "주변 정보를 조회하지 못했습니다.",
  "source": "출처: 카카오맵",
  "bucket": {
    "left": "왼쪽", "right": "오른쪽", "across": "맞은편", "beyond": "건물 너머",
    "n": "북쪽", "ne": "북동쪽", "e": "동쪽", "se": "남동쪽",
    "s": "남쪽", "sw": "남서쪽", "w": "서쪽", "nw": "북서쪽"
  },
  "item": "{distance} {name}",
  "itemWithRoad": "{distance} {name}, {road} 쪽",
  "count": "{count}곳"
}
```

- [x] **Step 2: 실패하는 테스트를 쓴다**

```tsx
// @vitest-environment jsdom
// src/components/__tests__/SurroundingsScene.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SurroundingsScene } from "../SurroundingsScene";
// 프로젝트의 next-intl 테스트 래퍼를 쓴다(PlaceDetail.test.tsx 선례를 그대로 따를 것).

const scene = {
  place: "서울특별시 강동구 성내1동, 성내로 25",
  frame: "entrance" as const,
  groups: [
    { bucket: "left" as const, items: [{ name: "봉래면옥", distanceMeters: 62, road: "명일로", category: "restaurant" }] },
    { bucket: "beyond" as const, items: [{ name: "카페만월경", distanceMeters: 58, road: null, category: "cafe" }] },
  ],
  total: 2,
};

describe("SurroundingsScene", () => {
  it("묶음 제목을 heading으로 낸다 — 제목 단위 점프가 발견 경로다", () => {
    render(<SurroundingsScene scene={scene} />);
    expect(screen.getByRole("heading", { name: "왼쪽" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /건물 너머/ })).toBeTruthy();
  });

  it("한 항목은 한 줄로 합친다 — 거리·이름·길 이름이 조각나지 않는다", () => {
    render(<SurroundingsScene scene={scene} />);
    expect(screen.getByText("62m 봉래면옥, 명일로 쪽")).toBeTruthy();
  });

  it("같은 도로면 길 이름을 붙이지 않는다", () => {
    render(<SurroundingsScene scene={scene} />);
    expect(screen.getByText("58m 카페만월경")).toBeTruthy();
  });

  it("위치 확인 문장이 먼저 온다", () => {
    const { container } = render(<SurroundingsScene scene={scene} />);
    expect(container.textContent?.indexOf("성내로 25")).toBeLessThan(
      container.textContent!.indexOf("봉래면옥"),
    );
  });
});
```

- [x] **Step 3: 실패를 확인한다**

Run: `npx vitest run src/components/__tests__/SurroundingsScene.test.tsx`
Expected: FAIL — 컴포넌트 없음

- [x] **Step 4: 구현**

`NightClinicsNearby.tsx`를 골격 선례로 삼는다(`useNearbyFetch` + `NearbyPanelShell` + 단계 공개). 항목 한 줄은 반드시 `joinText`로 합친다.

**단계 공개는 `useRevealMore`(`src/hooks/useRevealMore.ts`)를 쓴다** — 아래 `shown`이 그 훅에서 온다. 묶음마다 독립적으로 쓰되(한 묶음의 "더 보기"가 다른 묶음을 펼치지 않는다), 10건 이하인 묶음에는 버튼을 내지 않는다. 누르면 첫 새 항목으로 포커스를 옮기고 **별도 통지는 내지 않는다**(repo 계약, `NightClinicsNearby` 정본).

```tsx
// 핵심만 — 전체 골격은 NightClinicsNearby.tsx를 따른다
{scene.groups.map((g) => (
  <section key={g.bucket}>
    <h4>{t(`bucket.${g.bucket}`)}{g.items.length > 3 ? ` ${t("count", { count: g.items.length })}` : ""}</h4>
    <ul>
      {g.items.slice(0, shown).map((it) => (
        <li key={`${it.name}-${it.distanceMeters}`}>
          {joinText(
            formatDistance(it.distanceMeters),
            it.name,
            it.road ? `${it.road} 쪽` : null,
          )}
        </li>
      ))}
    </ul>
  </section>
))}
```

⚠ `joinText`의 구분자는 쉼표다. 가운뎃점을 쓰지 않는다(일부 SR이 단어로 낭독).
⚠ 묶음 제목은 `<h4>`다(nearby 관례: 섹션 `h3` → 항목 `h4`).

- [x] **Step 5: 통과를 확인한다**

Run: `npx vitest run src/components/__tests__/SurroundingsScene.test.tsx`
Expected: PASS (4 tests)

- [x] **Step 6: 커밋**

```bash
git commit -m "feat(m1): 부근 재구성 웹 UI — 묶음 제목 + 한 줄 한 항목" -- src/components/SurroundingsScene.tsx src/components/__tests__/SurroundingsScene.test.tsx messages/
```

---

### Task 9: 진입점 배선 2곳

**Files:**
- Modify: `src/components/WhereAmI.tsx` ("내 주변" 현재 위치 확인)
- Modify: `src/components/DistanceBeacon.tsx` (안내 세션 시트)
- Test: `src/components/__tests__/WhereAmI.contract.test.tsx`에 케이스 추가

**Interfaces:**
- Consumes: Task 8의 `<SurroundingsScene>`
- Produces: 없음(최종 배선)

- [x] **Step 1: 실패하는 테스트를 쓴다**

```tsx
// WhereAmI.contract.test.tsx 에 추가
it("현재 위치 확인 결과 아래에 '주변 확인' 진입점이 있다", async () => {
  // 기존 파일의 렌더 헬퍼를 그대로 쓴다
  renderWhereAmI({ status: "done" });
  expect(await screen.findByRole("button", { name: "주변 확인" })).toBeTruthy();
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/components/__tests__/WhereAmI.contract.test.tsx`
Expected: FAIL — 버튼 없음

- [x] **Step 3: 배선**

- `WhereAmI.tsx`: 정위 결과가 `done`일 때 그 아래에 `<SurroundingsScene anchor={사용한 좌표} />`를 둔다. **앵커는 `useNearbyFetch`가 이미 유효 위치로 바꿔 준 좌표**를 그대로 쓴다(수동 위치가 자동 반영된다).
- `DistanceBeacon.tsx`: 안내 시트 컨트롤 줄에 "주변 확인"을 더하고 앵커로 **목적지 좌표**를 넘긴다(실시간 안내는 실좌표를 쓰지만 이 기능의 앵커는 목적지다 — spec §5).

- [x] **Step 4: 통과를 확인한다**

Run: `npm run test:run`
Expected: PASS 전량

- [x] **Step 5: 타입 검사와 린트**

Run: `npm run build && npm run lint`
Expected: 통과. ⚠ Vitest green은 타입 검사를 포함하지 않는다.

- [x] **Step 6: 커밋**

```bash
git commit -m "feat(m1): 진입점 배선 — 내 주변·안내 시트" -- src/components/WhereAmI.tsx src/components/DistanceBeacon.tsx src/components/__tests__/WhereAmI.contract.test.tsx
```

---

### Task 10: 실호출 게이트

**Files:**
- Create: `scripts/verify-surroundings-scene.mjs`

**Interfaces:** 없음(검증 전용)

- [x] **Step 1: 검증 스크립트를 쓴다**

`node scripts/verify-surroundings-scene.mjs`가 dev 서버(`localhost:3000`)에 아래 좌표로 실호출하고 결과를 표로 출력한다.

| 목적지 | 확인할 것 |
|---|---|
| 신명중학교 (37.5415, 127.1495) | 골목인데 `frame: "entrance"`인가(juso 건물 5건으로 축이 서야 한다). 신명초가 **오른쪽** 묶음인가 |
| 강동구청 (37.5301, 127.1237) | 성내로 짝수(계명치과·공차)가 **맞은편** 묶음인가 |
| 자택 아파트 (37.5366, 127.1473) | 봉래면옥 **왼쪽**, 세븐일레븐 **오른쪽 또는 건물 너머** |
| 망원시장 | `frame: "compass"`로 물러나는가(도로명주소 없음) |
| 해외 좌표 (48.85, 2.35) | `outOfCoverage: true` |

- [x] **Step 2: 돌려서 다섯 줄이 모두 예상대로인지 본다**

Run: `npm run dev` (별 터미널) 후 `node scripts/verify-surroundings-scene.mjs`
Expected: 5/5 통과. **하나라도 어긋나면 그 자리에서 원인을 규명한다** — fixture green은 실계약 검증이 아니다.

- [x] **Step 3: 결과를 spec §9에 기록하고 커밋**

```bash
git commit -m "test(m1): 실호출 게이트 5경로" -- scripts/verify-surroundings-scene.mjs docs/superpowers/specs/2026-08-09-arrival-surroundings-design.md
```

---

## 남은 것 (이 플랜 밖)

- **iOS 이식**: Kit 미러(`RoadAxis.swift`·`RoadAddress.swift`) + 뷰. 웹 실사용 판정 뒤 별도 플랜.
- **업종 통계·버스정류소·음향신호기 문장**(spec §6 아래 세 줄). 묶음 목록이 실사용에서 값어치를 확인받은 뒤 붙인다.
- **미결 4**(자동 발화와 문구 중복): 위원장 실보행 피드백이 입력이다.

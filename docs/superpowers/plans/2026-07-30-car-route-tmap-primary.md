# 자동차 ko 경로 Tmap 기본 승격 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자동차 ko 경로 브리핑의 기본 provider를 카카오모빌리티에서 Tmap으로 승격하고, 카카오모빌리티를 throw 시 폴백으로 강등한다(2026-07-30 실호출 대조·위원장 판정).

**Architecture:** 도보 `walk-route.ts` 폴백 패턴 미러. 신규 provider `tmap-car.ts`(Tmap 자동차 `description` 완성 문장이 낭독 정본) + 서비스 진입점 `car-route.ts`(라우트·채팅 공용, provider 직접 호출 금지) + 게이트 `hasCarRouteKey()`(=tmap∥kakao). en 경로는 NCP 현행 유지. API 응답 스키마(`CarRouteBriefing`)는 byte-호환 — 단 Tmap guide는 문장에 거리 내장이라 `distanceMeters: 0`(미제공 의미론)으로 두고, 소비자 3곳(웹·CLI·iOS)이 `>0`일 때만 수치를 병기한다.

**Tech Stack:** Next.js 16 Route Handler, Vitest(fixture 단위테스트), Tmap SK Open API(POST `tmap/routes?version=1`), SwiftUI(RouteBriefing 행 가드).

## Global Constraints

- 실호출(실데이터)이 머지 게이트 — fixture green ≠ 실계약 검증 (repo CLAUDE.md).
- `git add -A` 금지 — pathspec 커밋(`git commit -m "..." -- <파일들>`)만.
- 주석·커밋 한국어, em dash 금지, 변수/함수명 영어. 커밋 이메일 `engccer@gmail.com`.
- Tmap 키는 기존 `TMAP_APP_KEY`(도보 폴백과 공유, 일 1,000건) — env 신규 등록 없음.
- 자동차 경로는 실시간 교통 반영이라 캐시 금지(`cache: "no-store"`) — kakao-navi 관례 유지(Tmap POST는 revalidate 자체가 실효이기도 함).
- iOS `CarRouteGuide`는 엄격 Int 디코딩 — 서버 수치는 전부 `Math.round`.
- 완성 문장 재조합 금지: Tmap `description`이 낭독 정본, turnType 코드로 문장을 만들지 않는다.

## 파일 구조

| 파일 | 책임 |
|---|---|
| Create `src/lib/providers/tmap-car.ts` | Tmap 자동차 호출+정규화(순수 함수 분리) |
| Create `src/lib/__tests__/tmap-car.test.ts` | 정규화 fixture 테스트 |
| Create `src/lib/car-route.ts` | 서비스 진입점: Tmap 기본→카카오 폴백+폴백 로그 |
| Create `src/lib/__tests__/car-route.test.ts` | 폴백 분기 테스트 |
| Modify `src/lib/env.ts` | `hasCarRouteKey()` 추가 |
| Modify `src/app/api/route/car/route.ts`(+test) | ko 분기를 서비스 경유로, 게이트 교체 |
| Modify `src/app/[locale]/page.tsx` | `canBriefCarRoute={hasCarRouteKey()}` |
| Modify `src/lib/chat/declarations.ts` | `get_car_route` 게이트 교체 |
| Modify `src/lib/chat/router.ts` | `get_car_route` ko 호출을 서비스로 |
| Modify `src/lib/chat/sources.ts`(+test) | ko 출처 `[TMAP, KAKAO_MOBILITY]` 병기 |
| Modify `packages/cli/src/lib/formatters.ts`(+test) | guide 거리 `>0` 병기 가드 |
| Modify `ios/Gildongmu/RouteBriefing.swift` | guide 거리 `>0` 병기 가드 |
| Modify `CLAUDE.md`·`PROGRESS.md` | 카탈로그·키 표·검증 로그 갱신 |

---

### Task 1: Tmap 자동차 provider + 정규화 테스트

**Files:**
- Create: `src/lib/providers/tmap-car.ts`
- Create: `src/lib/__tests__/tmap-car.test.ts`

**Interfaces:**
- Consumes: `env.TMAP_APP_KEY`, `CarRouteBriefing`/`CarRouteGuide`/`Coord`(`src/lib/types.ts`)
- Produces: `getTmapCarBriefing(params: {origin: Coord; dest: Coord}): Promise<CarRouteBriefing>`(실패는 전부 throw, null 없음 — kakao-navi 계약 동형), `normalizeTmapCarRoute(data: TmapCarResponse): CarRouteBriefing`(순수)

- [ ] **Step 1: 실호출로 응답 계약 확정(fixture 재료 캡처)**

스크래치패드에 1회용 스크립트를 만들어 실행한다(`.env.local`에서 `TMAP_APP_KEY` 파싱, 값 미노출):

```bash
cd /Users/hunyongkim/Mac-Projects/gildongmu && python3 - <<'EOF'
import json, pathlib, urllib.request
env = dict(l.split("=",1) for l in pathlib.Path(".env.local").read_text().splitlines() if "=" in l and not l.startswith("#"))
body = json.dumps({"startX":"127.1435","startY":"37.5380","endX":"127.0276","endY":"37.4979","reqCoordType":"WGS84GEO","resCoordType":"WGS84GEO"}).encode()
req = urllib.request.Request("https://apis.openapi.sk.com/tmap/routes?version=1", data=body, headers={"appKey": env["TMAP_APP_KEY"].strip(), "Content-Type":"application/json"})
d = json.load(urllib.request.urlopen(req, timeout=15))
out = pathlib.Path("/private/tmp/claude-502/-Users-hunyongkim-Mac-Projects-gildongmu/6f68aa89-2488-4eb6-9bea-8fbc3f6893d5/scratchpad/tmap-car-gildong-gangnam.json")
out.write_text(json.dumps(d, ensure_ascii=False, indent=1))
first = next(f["properties"] for f in d["features"] if f["properties"].get("totalDistance") is not None)
print({k: first.get(k) for k in ("totalDistance","totalTime","totalFare","taxiFare")})
print([f["properties"].get("description") for f in d["features"] if f["geometry"]["type"]=="Point"][:5])
EOF
```

확인 항목: ① 첫 Point properties에 `totalDistance`(m)·`totalTime`(초 — 분 환산이 카카오 대비 상식 범위인지)·`totalFare`(통행료 원)·`taxiFare`(택시요금 원) 4필드 존재 ② Point feature `description`이 완성 문장 ③ 도착 Point의 description 유무. 어긋나면 아래 인터페이스·fixture를 실측값으로 고쳐서 진행(추측 금지).

- [ ] **Step 2: 실패하는 정규화 테스트 작성**

`src/lib/__tests__/tmap-car.test.ts` (fixture는 Step 1 캡처를 축약해 구성 — 필드명은 캡처 원문과 일치시킬 것):

```ts
import { describe, expect, it } from "vitest";
import { normalizeTmapCarRoute, type TmapCarResponse } from "../providers/tmap-car";

/** Step 1 실호출 캡처(길동→강남) 축약 fixture. 필드명·중첩은 원문 그대로. */
function fixture(): TmapCarResponse {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [127.1435, 37.538] },
        properties: {
          totalDistance: 18651.4,
          totalTime: 2712.6,
          totalFare: 0,
          taxiFare: 21300.2,
          description: "출발지에서 좌회전",
        },
      },
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[127.1435, 37.538], [127.14, 37.537]] },
        properties: { distance: 244, time: 60 },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [127.14, 37.537] },
        properties: { description: "교차로에서 우회전 후 명일로를 따라 244m 이동" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [127.0276, 37.4979] },
        properties: {},
      },
    ],
  };
}

describe("normalizeTmapCarRoute", () => {
  it("첫 Point의 총계 4필드를 반올림 투영한다(iOS 엄격 Int 디코딩)", () => {
    const out = normalizeTmapCarRoute(fixture());
    expect(out.distanceMeters).toBe(18651);
    expect(out.durationSeconds).toBe(2713);
    expect(out.tollFare).toBe(0);
    expect(out.taxiFare).toBe(21300);
  });

  it("description 있는 Point만 guide가 되고 name은 빈 문자열, 수치는 0(문장 내장 정본)", () => {
    const out = normalizeTmapCarRoute(fixture());
    expect(out.guides).toEqual([
      { name: "", guidance: "출발지에서 좌회전", distanceMeters: 0, durationSeconds: 0 },
      {
        name: "",
        guidance: "교차로에서 우회전 후 명일로를 따라 244m 이동",
        distanceMeters: 0,
        durationSeconds: 0,
      },
    ]);
  });

  it("totalFare 부재는 통행료 0으로 투영한다(무통행 구간 관례)", () => {
    const data = fixture();
    delete (data.features[0].properties as Record<string, unknown>).totalFare;
    expect(normalizeTmapCarRoute(data).tollFare).toBe(0);
  });

  it("총 거리·시간·택시요금이 유한 양수/유한이 아니면 throw(3-state — 깨진 경로 확정 낭독 금지)", () => {
    for (const key of ["totalDistance", "totalTime", "taxiFare"]) {
      const data = fixture();
      delete (data.features[0].properties as Record<string, unknown>)[key];
      expect(() => normalizeTmapCarRoute(data)).toThrow();
    }
  });

  it("안내 단계 0개면 throw", () => {
    const data = fixture();
    for (const f of data.features) delete (f.properties as Record<string, unknown>).description;
    expect(() => normalizeTmapCarRoute(data)).toThrow();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/lib/__tests__/tmap-car.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 4: provider 구현**

`src/lib/providers/tmap-car.ts`:

```ts
import { env } from "../env";
import type { CarRouteBriefing, CarRouteGuide, Coord } from "../types";

/**
 * Tmap(SK Open API) 자동차 경로 provider — ko 기본(2026-07-30 실호출 대조·위원장 판정).
 *
 * 엔드포인트: POST https://apis.openapi.sk.com/tmap/routes?version=1
 * 인증: 헤더 appKey(도보 폴백과 동일한 SK Open API 앱 "gildongmu" 단일 키).
 *
 * 낭독 정본은 Point feature의 properties.description — 도로명·거리가 내장된
 * 완성 문장("교차로에서 우회전 후 명일로를 따라 244m 이동")이라 그대로 쓴다
 * (turnType 재조합 금지, tmap-pedestrian 동형). 따라서 guide별
 * distanceMeters/durationSeconds는 0(미제공 의미론) — 소비자는 >0일 때만
 * 수치를 병기하므로 카카오 폴백(실수치)과 중복 없이 공존한다.
 *
 * 캐시 금지(no-store): 실시간 교통 반영 응답(kakao-navi 관례 동형.
 * POST는 Next fetch revalidate가 실효이기도 하다).
 * "경로 없음"류 오류 코드는 실제 관측 시에만 graceful 분기를 추가한다
 * (추측 금지) — 현재는 전부 throw라 서비스 계층이 카카오로 폴백한다.
 */

const ENDPOINT = "https://apis.openapi.sk.com/tmap/routes?version=1";

/** Point feature(안내 지점). 첫 지점만 총계 4필드를 싣는다. */
interface TmapCarPointFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    description?: string;
    totalDistance?: number;
    totalTime?: number;
    totalFare?: number;
    taxiFare?: number;
    [key: string]: unknown;
  };
}

/** LineString feature(구간 폴리라인). 지도 없는 이 앱에선 쓰지 않는다. */
interface TmapCarLineFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: { [key: string]: unknown };
}

type TmapCarFeature = TmapCarPointFeature | TmapCarLineFeature;

/** Tmap 자동차 경로 원본 응답(GeoJSON FeatureCollection). */
export interface TmapCarResponse {
  type: "FeatureCollection";
  features: TmapCarFeature[];
}

function isPointFeature(f: TmapCarFeature): f is TmapCarPointFeature {
  return f.geometry.type === "Point";
}

/**
 * Tmap 응답 → CarRouteBriefing 정규화(순수 함수).
 * 총 거리·시간·택시요금이 깨져 있으면 throw(3-state — 깨진 경로를 확정
 * 낭독하지 않는다. throw는 서비스 계층에서 카카오 폴백으로 흡수).
 * totalFare(통행료) 부재만 0으로 투영한다(무통행 구간 관례).
 */
export function normalizeTmapCarRoute(data: TmapCarResponse): CarRouteBriefing {
  const points = data.features.filter(isPointFeature);
  const head = points.find((p) => p.properties.totalDistance != null);
  const distanceMeters = head?.properties.totalDistance ?? NaN;
  const durationSeconds = head?.properties.totalTime ?? NaN;
  const taxiFare = head?.properties.taxiFare ?? NaN;

  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    throw new Error("Tmap 자동차 경로 정규화 실패: 총 거리 값 이상");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Tmap 자동차 경로 정규화 실패: 총 시간 값 이상");
  }
  if (!Number.isFinite(taxiFare)) {
    throw new Error("Tmap 자동차 경로 정규화 실패: 택시요금 값 이상");
  }

  const guides: CarRouteGuide[] = [];
  for (const point of points) {
    const description = point.properties.description;
    if (!description) continue;
    guides.push({ name: "", guidance: description, distanceMeters: 0, durationSeconds: 0 });
  }
  if (guides.length === 0) {
    throw new Error("Tmap 자동차 경로 정규화 실패: 안내 단계 0개");
  }

  return {
    // iOS CarRouteBriefing이 엄격 Int 디코딩이라 전부 반올림
    distanceMeters: Math.round(distanceMeters),
    durationSeconds: Math.round(durationSeconds),
    taxiFare: Math.round(taxiFare),
    tollFare: Math.round(head?.properties.totalFare ?? 0),
    guides,
  };
}

/** 자동차 경로 텍스트 브리핑 조회. 실패는 전부 throw(폴백 판단은 car-route.ts 몫). */
export async function getTmapCarBriefing(params: {
  origin: Coord;
  dest: Coord;
}): Promise<CarRouteBriefing> {
  const { origin, dest } = params;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      appKey: env.TMAP_APP_KEY ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startX: String(origin.lng),
      startY: String(origin.lat),
      endX: String(dest.lng),
      endY: String(dest.lat),
      reqCoordType: "WGS84GEO",
      resCoordType: "WGS84GEO",
    }),
    // 실시간 교통이 반영되는 응답이라 캐시하지 않는다
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tmap 자동차 경로 실패: HTTP ${res.status} ${body}`);
  }
  const data = (await res.json()) as TmapCarResponse;
  return normalizeTmapCarRoute(data);
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/__tests__/tmap-car.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(route): Tmap 자동차 경로 provider 신설 — description 완성 문장 정본, guide 수치 0(미제공) 투영" -- src/lib/providers/tmap-car.ts src/lib/__tests__/tmap-car.test.ts
```

---

### Task 2: car-route 서비스 진입점(Tmap 기본 → 카카오 폴백)

**Files:**
- Create: `src/lib/car-route.ts`
- Create: `src/lib/__tests__/car-route.test.ts`

**Interfaces:**
- Consumes: `getTmapCarBriefing`(Task 1), `getCarRouteBriefing`(`src/lib/providers/kakao-navi.ts`), `hasKakaoKey`/`hasTmapKey`(`src/lib/env.ts`), `roundCoord`(`src/lib/coord-round.ts`)
- Produces: `getCarRoute(params: {origin: Coord; dest: Coord}): Promise<CarRouteBriefing>`(throw = 両실패 또는 키 전무 — null 경로 없음, 기존 라우트 계약 동형)

- [ ] **Step 1: 실패하는 폴백 테스트 작성**

`src/lib/__tests__/car-route.test.ts` (walk-route.test.ts mock 패턴 동형):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../providers/tmap-car", () => ({ getTmapCarBriefing: vi.fn() }));
vi.mock("../providers/kakao-navi", () => ({ getCarRouteBriefing: vi.fn() }));
vi.mock("../env", () => ({ hasKakaoKey: vi.fn(() => true), hasTmapKey: vi.fn(() => true) }));

import { getTmapCarBriefing } from "../providers/tmap-car";
import { getCarRouteBriefing } from "../providers/kakao-navi";
import { hasKakaoKey, hasTmapKey } from "../env";
import { getCarRoute } from "../car-route";
import type { CarRouteBriefing } from "../types";

const COORDS = { origin: { lat: 37.538, lng: 127.1435 }, dest: { lat: 37.4979, lng: 127.0276 } };
const TMAP_BRIEFING: CarRouteBriefing = {
  distanceMeters: 18651, durationSeconds: 2713, taxiFare: 21300, tollFare: 0,
  guides: [{ name: "", guidance: "교차로에서 우회전 후 명일로를 따라 244m 이동", distanceMeters: 0, durationSeconds: 0 }],
};
const KAKAO_BRIEFING: CarRouteBriefing = {
  distanceMeters: 18700, durationSeconds: 2800, taxiFare: 21500, tollFare: 0,
  guides: [{ name: "", guidance: "우회전", distanceMeters: 228, durationSeconds: 40 }],
};

describe("getCarRoute", () => {
  beforeEach(() => {
    vi.mocked(hasKakaoKey).mockReturnValue(true);
    vi.mocked(hasTmapKey).mockReturnValue(true);
    vi.mocked(getTmapCarBriefing).mockResolvedValue(TMAP_BRIEFING);
    vi.mocked(getCarRouteBriefing).mockResolvedValue(KAKAO_BRIEFING);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("両키 정상이면 Tmap 결과를 쓰고 카카오는 호출하지 않는다", async () => {
    await expect(getCarRoute(COORDS)).resolves.toEqual(TMAP_BRIEFING);
    expect(getCarRouteBriefing).not.toHaveBeenCalled();
  });

  it("Tmap throw + 카카오 키 있음 → 카카오 폴백 + 폴백 경고 로그", async () => {
    vi.mocked(getTmapCarBriefing).mockRejectedValue(new Error("HTTP 500"));
    await expect(getCarRoute(COORDS)).resolves.toEqual(KAKAO_BRIEFING);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("Tmap throw + 카카오 키 없음 → 원래 오류 rethrow", async () => {
    vi.mocked(hasKakaoKey).mockReturnValue(false);
    vi.mocked(getTmapCarBriefing).mockRejectedValue(new Error("HTTP 500"));
    await expect(getCarRoute(COORDS)).rejects.toThrow("HTTP 500");
  });

  it("Tmap 키 없음 + 카카오 키 있음 → 카카오 직행(폴백 로그 없음)", async () => {
    vi.mocked(hasTmapKey).mockReturnValue(false);
    await expect(getCarRoute(COORDS)).resolves.toEqual(KAKAO_BRIEFING);
    expect(getTmapCarBriefing).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("両키 없음 → throw(게이트 이중 방어)", async () => {
    vi.mocked(hasTmapKey).mockReturnValue(false);
    vi.mocked(hasKakaoKey).mockReturnValue(false);
    await expect(getCarRoute(COORDS)).rejects.toThrow();
  });
});
```

⚠ `beforeEach` 화살표 함수는 반드시 중괄호 블록으로(한 줄 화살표가 mock을 반환하면 teardown으로 등록되는 vitest 함정 — [[vitest-hook-returned-function-is-teardown]]).

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/car-route.test.ts`
Expected: FAIL (`../car-route` 모듈 없음)

- [ ] **Step 3: 서비스 구현**

`src/lib/car-route.ts`:

```ts
import { getTmapCarBriefing } from "./providers/tmap-car";
import { getCarRouteBriefing } from "./providers/kakao-navi";
import { hasKakaoKey, hasTmapKey } from "./env";
import { roundCoord } from "./coord-round";
import type { CarRouteBriefing, Coord } from "./types";

/**
 * 자동차 경로(ko) 서비스 진입점(라우트·채팅 공용 — provider 직접 호출 금지,
 * walk-route.ts 동형). 기본 Tmap, Tmap throw 시에만 카카오모빌리티 폴백
 * (2026-07-30 실호출 대조·위원장 판정 — 도보와 정반대 방향: 자동차는 Tmap
 * description이 도로명 포함 완성 문장, 카카오 guidance는 조각형).
 * en 경로는 NCP 현행 유지라 이 서비스를 타지 않는다.
 *
 * Tmap "경로 없음"류 코드가 아직 미관측이라 모든 실패가 폴백을 탄다 —
 * 관측 시 tmap-car.ts에 graceful 분기를 추가한다(추측 금지).
 */

/**
 * 폴백 원인 로그 — Vercel 로그로 폴백률·구간을 관측한다(파서 회귀 조기 발견).
 * 좌표는 4자리 반올림(약 ±5.5m) — 로그 가독성용.
 */
function logFallback(origin: Coord, dest: Coord, reason: unknown) {
  console.warn(
    "[car-route] Tmap 실패, 카카오모빌리티 폴백:",
    roundCoord(origin.lat, 4),
    roundCoord(origin.lng, 4),
    "→",
    roundCoord(dest.lat, 4),
    roundCoord(dest.lng, 4),
    reason,
  );
}

export async function getCarRoute(params: {
  origin: Coord;
  dest: Coord;
}): Promise<CarRouteBriefing> {
  if (hasTmapKey()) {
    try {
      return await getTmapCarBriefing(params);
    } catch (e) {
      if (!hasKakaoKey()) throw e;
      logFallback(params.origin, params.dest, e);
      return getCarRouteBriefing(params);
    }
  }
  if (hasKakaoKey()) return getCarRouteBriefing(params);
  // 게이트(hasCarRouteKey)가 먼저 막지만 직접 호출 경로 이중 방어
  throw new Error("자동차 경로 브리핑은 API 키 등록 후 사용할 수 있습니다.");
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/car-route.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(route): 자동차 ko 서비스 진입점 car-route.ts — Tmap 기본, 카카오모빌리티 폴백(폴백률 로그)" -- src/lib/car-route.ts src/lib/__tests__/car-route.test.ts
```

---

### Task 3: 게이트·라우트 핸들러·페이지 전환

**Files:**
- Modify: `src/lib/env.ts`(hasWalkRouteKey 바로 아래)
- Modify: `src/app/api/route/car/route.ts`
- Modify: `src/app/api/route/car/__tests__/route.test.ts`
- Modify: `src/app/[locale]/page.tsx:30`

**Interfaces:**
- Consumes: `getCarRoute`(Task 2)
- Produces: `hasCarRouteKey(): boolean`(= `hasTmapKey() || hasKakaoKey()`) — Task 4의 declaration 게이트가 사용

- [ ] **Step 1: env 게이트 추가**

`src/lib/env.ts`의 `hasWalkRouteKey` 함수 바로 아래에:

```ts
/** 자동차 경로 브리핑(ko) 사용 가능 여부 — 기본 Tmap, 폴백 카카오모빌리티. 어느 한쪽 키만 있어도 동작. */
export function hasCarRouteKey(): boolean {
  return hasTmapKey() || hasKakaoKey();
}
```

- [ ] **Step 2: 라우트 테스트를 새 계약으로 갱신(실패 확인)**

`src/app/api/route/car/__tests__/route.test.ts`에서:
- env mock에 `hasCarRouteKey: vi.fn(() => true)` 추가(기존 `hasKakaoKey` mock은 제거하지 말 것 — 다른 모듈이 env를 공유 import하면 누락 키가 undefined 호출 오류를 낸다. 파일 내 사용처가 없어지면 mock의 `hasKakaoKey`도 유지한 채 두는 편이 안전).
- `@/lib/providers/kakao-navi` mock을 `@/lib/car-route` mock으로 교체: `vi.mock("@/lib/car-route", () => ({ getCarRoute: vi.fn(async () => ({ ...기존 briefing 형태 })) }))`.
- ko 정상 케이스의 호출 검증을 `getCarRoute`로, 503 케이스는 `hasCarRouteKey`가 false일 때로 수정.
- en+NCP 케이스는 기존 그대로(`getCarRouteBriefingEn` 직행 유지 검증).

Run: `npx vitest run src/app/api/route/car/__tests__/route.test.ts`
Expected: FAIL (라우트가 아직 구 provider 직접 호출)

- [ ] **Step 3: 라우트 핸들러 전환**

`src/app/api/route/car/route.ts`:
- import 교체: `hasKakaoKey` → `hasCarRouteKey`(env), `getCarRouteBriefing`(kakao-navi) → `getCarRoute`(`@/lib/car-route`).
- 게이트: `if (!useNcp && !hasCarRouteKey())`로 교체(503 분기 유지).
- 호출: `useNcp ? await getCarRouteBriefingEn(parsed.data) : await getCarRoute(parsed.data)`.
- 파일 상단 주석의 "provider 디스패치" 절을 현행화: ko는 `car-route.ts` 서비스(Tmap 기본·카카오 폴백), en+NCP는 NCP 직행.

- [ ] **Step 4: 페이지 게이트 교체**

`src/app/[locale]/page.tsx`: `canBriefCarRoute={hasKakaoKey()}` → `canBriefCarRoute={hasCarRouteKey()}` (import에 `hasCarRouteKey` 추가 — `hasKakaoKey`는 다른 prop들이 계속 사용).

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/app/api/route/car`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(route): 자동차 ko 라우트를 car-route 서비스 경유로 전환 — 게이트 hasCarRouteKey(tmap∥kakao)" -- src/lib/env.ts src/app/api/route/car/route.ts "src/app/api/route/car/__tests__/route.test.ts" "src/app/[locale]/page.tsx"
```

---

### Task 4: 채팅 전환(declaration 게이트·router·출처 병기)

**Files:**
- Modify: `src/lib/chat/declarations.ts`(get_car_route 게이트, 현재 `gate: hasKakaoKey` — 205행 부근)
- Modify: `src/lib/chat/router.ts`(get_car_route 케이스, 226행 부근)
- Modify: `src/lib/chat/sources.ts`(get_car_route 케이스, 54행 부근)
- Modify: `src/lib/chat/__tests__/sources.test.ts`(기대값 갱신)
- Modify(필요 시): `src/lib/chat/__tests__/router.test.ts`·`router-coverage.test.ts`(kakao-navi mock을 car-route mock으로)

**Interfaces:**
- Consumes: `getCarRoute`(Task 2), `hasCarRouteKey`(Task 3), 기존 `TMAP`·`KAKAO_MOBILITY` 상수(`sources.ts`)
- Produces: 없음(말단)

- [ ] **Step 1: sources 테스트 기대값 갱신(실패 확인)**

`src/lib/chat/__tests__/sources.test.ts`에서 get_car_route ko 기대값을 `[{ label: "source.tmap" }, { label: "source.kakaomobility" }]`로 수정(정확한 label 문자열은 sources.ts의 `TMAP` 상수 정의를 확인해 일치시킬 것).

Run: `npx vitest run src/lib/chat/__tests__/sources.test.ts`
Expected: FAIL

- [ ] **Step 2: 채팅 3파일 전환**

- `declarations.ts`: get_car_route의 `gate: hasKakaoKey` → `gate: hasCarRouteKey`(import 추가).
- `router.ts`: import에서 `getCarRouteBriefing`(kakao-navi) 제거, `getCarRoute`(`@/lib/car-route`) 추가. get_car_route 케이스의 ko 분기 호출을 교체:

```ts
const briefing = ctx.dataLocale === "en" && hasNcpMapsKeys()
  ? await getCarRouteBriefingEn({ origin: ctx.userLocation, dest: { lat: p.lat, lng: p.lng } })
  : await getCarRoute({ origin: ctx.userLocation, dest: { lat: p.lat, lng: p.lng } });
```

- `sources.ts`: walk 케이스의 병기 주석 관례 그대로:

```ts
case "get_car_route":
  // 기본 Tmap·폴백 카카오모빌리티 — 응답이 어느 쪽에서 왔는지 서비스가
  // 노출하지 않으므로(스키마 불변 계약) 두 제공처를 정직하게 병기.
  return ctx.dataLocale === "en" ? [NCP] : [TMAP, KAKAO_MOBILITY];
```

- [ ] **Step 3: 채팅 테스트 전체 통과 확인**

Run: `npx vitest run src/lib/chat`
Expected: PASS. router 테스트가 kakao-navi mock으로 get_car_route를 검증하고 있으면 `@/lib/car-route` mock으로 교체해 통과시킨다(검증 의미는 동일 유지 — 목적지 지오코딩·coverageGate·NO_LOCATION 분기).

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(chat): get_car_route를 car-route 서비스로 전환 — 게이트 hasCarRouteKey, 출처 Tmap·카카오모빌리티 병기" -- src/lib/chat/declarations.ts src/lib/chat/router.ts src/lib/chat/sources.ts src/lib/chat/__tests__/sources.test.ts
```

(router 테스트 파일을 고쳤으면 pathspec에 추가.)

---

### Task 5: 소비자 "0m" 가드(CLI·iOS — 웹은 기존 가드 확인만)

**Files:**
- Modify: `packages/cli/src/lib/formatters.ts:640` 부근(자동차 guide 행)
- Modify: `ios/Gildongmu/RouteBriefing.swift:63` 부근(자동차 guide 행)
- Verify: `src/components/CarRouteBriefing.tsx:177`(이미 `distanceMeters > 0 &&` 가드 존재 — 변경 없음 확인만)

**Interfaces:**
- Consumes: Task 1의 "guide 수치 0 = 미제공" 의미론
- Produces: 없음(말단)

- [ ] **Step 1: CLI 가드**

`packages/cli/src/lib/formatters.ts`의 자동차 guide 행:

```ts
body.guides.forEach((g, i) => {
  lines.push(joinText(`${i + 1}. ${g.guidance}`, g.distanceMeters > 0 ? m(g.distanceMeters) : undefined));
});
```

CLI에 자동차 포매터 기대 출력 테스트가 있으면(`packages/cli/src/__tests__` grep) 기대값을 갱신한다.

Run: `cd packages/cli && npm test 2>/dev/null || npx vitest run` (CLI 테스트 러너는 package.json scripts 확인)
Expected: PASS

- [ ] **Step 2: iOS 가드**

`ios/Gildongmu/RouteBriefing.swift`의 자동차 guide 행:

```swift
Text(joinText(text, guide.distanceMeters > 0 ? "\(guide.distanceMeters)m" : nil))
```

(같은 파일 57행이 `nil` 조각을 이미 쓰므로 joinText 시그니처 호환.)

- [ ] **Step 3: iOS 빌드 확인**

Run: `cd /Users/hunyongkim/Mac-Projects/gildongmu && xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS' build 2>&1 | tail -5` (프로젝트 파일 경로는 ios/ 실물 확인 — 실패 시 xcodebuildmcp-cli 스킬의 빌드 명령 사용)
Expected: BUILD SUCCEEDED

- [ ] **Step 4: 커밋**

```bash
git commit -m "fix(a11y): 자동차 guide 거리 수치는 >0일 때만 병기(CLI·iOS) — Tmap 문장 내장 거리와 중복·0m 낭독 차단" -- packages/cli/src/lib/formatters.ts ios/Gildongmu/RouteBriefing.swift
```

(CLI 테스트 파일을 고쳤으면 pathspec에 추가.)

---

### Task 6: 실호출 머지 게이트·문서·배포

**Files:**
- Modify: `CLAUDE.md`(통합 카탈로그 "자동차 경로" 행 + API 키 표 `TMAP_APP_KEY` 행)
- Modify: `PROGRESS.md`(미해결 항목 해소·검증 로그)
- Verify: 워크스페이스 `sync_agent_docs.py` 재생성

**Interfaces:**
- Consumes: Task 1~5 전부 완료 상태
- Produces: main push(자동배포) + iOS 실기기 배포

- [ ] **Step 1: 전체 게이트 테스트·린트·빌드**

Run: `npm run test:run && npm run lint && npm run build`
Expected: 전부 PASS

- [ ] **Step 2: 실호출 머지 게이트(로컬 dev 서버)**

```bash
npm run dev & sleep 5
curl -s "http://localhost:3000/api/route/car?origin=37.5380,127.1435&dest=37.4979,127.0276" | python3 -m json.tool | head -40
```

판정: ① guides[].guidance가 Tmap 완성 문장(도로명 포함, "따라 …m 이동" 패턴)인지 — 카카오 조각형("우회전")이면 전환 실패 ② `distanceMeters`·`durationSeconds`·`taxiFare`·`tollFare` 정수 ③ guide `distanceMeters` 전부 0 ④ 총 시간이 카카오 대조값(약 45분대)과 상식 범위. 확인 후 dev 서버 종료.

- [ ] **Step 3: 문서 갱신**

- `CLAUDE.md` 통합 카탈로그 "자동차 경로" 행을 현행화: `**tmap-car(기본)+kakao-navi(폴백)** → car-route.ts (ko) / ncp-directions(en) / /api/route/car` + 핵심 함정(guide 수치 0=미제공·소비자 >0 병기 가드, 폴백은 throw 시에만, no-store, 게이트 `hasCarRouteKey`). `TMAP_APP_KEY` 행의 용도를 "보행자 폴백 + **자동차 기본**"으로 갱신.
- `PROGRESS.md`: "경로 provider 실호출 대조 2차" 미해결 항목에서 자동차 판정을 "전환 완료(2026-07-30)"로 이동, 실호출 게이트 결과 기록. 대중교통 주간 재대조 항목은 유지.
- 워크스페이스 루트에서 `python3 sync_agent_docs.py` 실행(AGENTS.md 재생성).

- [ ] **Step 4: 커밋·push(자동배포)**

```bash
git commit -m "docs: 자동차 ko 기본 Tmap 전환 반영 — 카탈로그·키 표·PROGRESS 검증 로그" -- CLAUDE.md AGENTS.md PROGRESS.md
git push origin main
git show HEAD --stat
```

push 후 프로덕션 실호출 1회로 재검증:
`curl -s "https://gildongmu.vercel.app/api/route/car?origin=37.5380,127.1435&dest=37.4979,127.0276" | head -c 400` — guidance가 Tmap 문장인지 확인.

- [ ] **Step 5: iOS 실기기 배포**

기기가 연결되어 있으면 `ios/deploy-device.sh` 실행(웹 push=배포와 동형 사이클). 미연결이면 보고에 명시.

---

## Self-Review 결과

- 스펙 커버리지: 기본 승격(Task 1~4)·폴백(2)·게이트(3)·채팅(4)·소비자 정합(5)·실호출 게이트·문서(6) — 누락 없음. en NCP 불변 확인(3·4에서 명시).
- 타입 일관성: `getCarRoute`·`hasCarRouteKey`·`getTmapCarBriefing`·`normalizeTmapCarRoute`·`TmapCarResponse` 명칭이 태스크 간 일치.
- fixture 수치는 Step 1 실호출 캡처로 확정하는 절차를 명시(추측 금지) — 계획의 수치는 자리 표시가 아니라 대조 세션 실측 근사값이며, 캡처와 다르면 캡처가 정본.

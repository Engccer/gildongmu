# "현재 위치" 정위 카드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 낯선 곳에서 "내가 지금 어디 있는가"를 한눈에 파악하는 텍스트 정위 카드 — 도로명·행정동·가장 가까운 역·주변 기준점을 결정론 산문 두세 단락으로, '내 현재 위치에 관해 물어보기' 채팅 버튼 포함.

**Architecture:** 새 엔드포인트 `/api/where-am-i`가 좌표를 받아 네 조각(주소·행정동·근접역·주변 시설)을 `Promise.allSettled` 병렬 조립 → `WhereAmI` 반환. 순수 `buildLocationNarrative`가 구조화 산문 데이터를 만들고 컴포넌트가 next-intl로 5개 언어 렌더. 채팅 버튼은 현재 위치를 `Place`로 합성해 기존 `ChatOverlay`(Perplexity 포함) 무수정 재사용.

**Tech Stack:** Next.js 16(App Router), TypeScript, next-intl 4, zod 4, Vitest 4. 카카오 로컬 API(기존 `KAKAO_REST_API_KEY`). 신규 외부 API·키·비용 0.

## Global Constraints

- `src/lib/`는 React/Next 비의존(dodo-planet 이식성) — 순수 로직만, 컴포넌트/훅 import 금지.
- 좌표는 WGS84 십진 도. 카카오 좌표 파라미터는 `x`=경도·`y`=위도(provider 밖으로 새지 않게).
- 카카오 좌표→주소/행정동은 `kakao-address.ts`에만 둔다.
- 결정론 산문(LLM 아님) — 같은 좌표에 같은 글, 날조 0.
- 정면-상대 방향(앞/오른쪽) 금지 — 북 기준 8방위만(heading 미보유).
- mock 폴백 없음. `canShowWhereAmI`=`hasKakaoKey()` 게이트, 키 없으면 버튼 미노출(회귀 0).
- UI 라벨 이모지 금지(lucide-react SVG는 `aria-hidden` 허용).
- 고유명(역명·시설명·행정동·도로명)은 `lang="ko"`(영문 UI 음성 엔진 정합).
- 버튼으로 펼치는 패널 → `<div>` 유지(자동 등장 아님, region 불필요). 결과 항목 이름 `<h4>`.
- 단일 polite live region. 산문은 보이는 본문 한 곳에만(live 복제 금지).
- 커밋 이메일 `engccer@gmail.com`. 커밋 메시지 한국어. 기능·버그픽스는 같은 커밋에 테스트 동반.
- 커밋 시 `git add -A` 금지 — 명시 파일만, add 후 즉시 commit(사이에 다른 호출 금지).

---

## File Structure

| 파일 | 책임 | 신규/수정 |
|---|---|---|
| `src/lib/providers/kakao-address.ts` | `coordToRegion()` + `pickRegionDocument()` 추가 | 수정 |
| `src/lib/types.ts` | `WhereAmI`·`LocationNarrative` 타입 추가 | 수정 |
| `src/lib/where-am-i.ts` | `assembleWhereAmI`(I/O 조립) + `buildLocationNarrative`(순수) | 신규 |
| `src/lib/where-am-i-place.ts` | `whereAmIToPlace`(순수 Place 합성) | 신규 |
| `src/app/api/where-am-i/route.ts` | GET 라우트(zod·게이트·502) | 신규 |
| `src/components/WhereAmI.tsx` | 버튼·산문·채팅 컴포넌트 | 신규 |
| `messages/{ko,en,es,fr,it}.json` | `whereAmI.*` 그룹 + `placeChat.launchForLocation` | 수정 |
| `src/components/PlaceSearch.tsx` | `canShowWhereAmI` prop + nearby 묶음 맨 위 마운트 | 수정 |
| `src/app/[locale]/page.tsx` | `canShowWhereAmI={hasKakaoKey()}` 전달 | 수정 |
| `src/lib/__tests__/where-am-i.test.ts` | `buildLocationNarrative` 결정적 테스트 | 신규 |
| `src/lib/__tests__/where-am-i-place.test.ts` | `whereAmIToPlace` 테스트 | 신규 |
| `src/lib/providers/__tests__/kakao-address.test.ts` | `pickRegionDocument` 테스트(없으면 신규) | 신규/수정 |

---

## Task 1: `coordToRegion()` — 좌표 → 행정동

**Files:**
- Modify: `src/lib/providers/kakao-address.ts`
- Test: `src/lib/providers/__tests__/kakao-address.test.ts`

**Interfaces:**
- Consumes: 기존 `env.KAKAO_REST_API_KEY`, `Coord`.
- Produces:
  - `pickRegionDocument(docs: KakaoRegionDocument[]): KakaoRegionDocument | null` — H(행정동) 우선, 없으면 B(법정동) 첫 항목, 없으면 null.
  - `coordToRegion(coord: Coord): Promise<string | null>` — 행정동 표시 문자열(예 "서울특별시 강동구 길동") 또는 null.

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/providers/__tests__/kakao-address.test.ts`에 추가(파일 없으면 생성):

```ts
import { describe, it, expect } from "vitest";
import { pickRegionDocument } from "../kakao-address";

describe("pickRegionDocument", () => {
  const H = { region_type: "H", address_name: "서울특별시 강동구 길동" } as const;
  const B = { region_type: "B", address_name: "서울특별시 강동구 길동" } as const;

  it("행정동(H)을 법정동(B)보다 우선한다", () => {
    expect(pickRegionDocument([B, H])?.region_type).toBe("H");
  });

  it("H가 없으면 B를 쓴다", () => {
    expect(pickRegionDocument([B])?.region_type).toBe("B");
  });

  it("빈 배열이면 null", () => {
    expect(pickRegionDocument([])).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- kakao-address`
Expected: FAIL — `pickRegionDocument` is not exported / not a function.

- [ ] **Step 3: 구현 추가**

`src/lib/providers/kakao-address.ts` 맨 끝에 추가:

```ts
const COORD2REGION_ENDPOINT =
  "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json";

export interface KakaoRegionDocument {
  /** "H"=행정동, "B"=법정동 */
  region_type: "H" | "B";
  /** "서울특별시 강동구 길동" */
  address_name: string;
}

/** 행정동(H) 우선, 없으면 법정동(B) 첫 항목, 없으면 null. */
export function pickRegionDocument(
  docs: KakaoRegionDocument[],
): KakaoRegionDocument | null {
  return (
    docs.find((d) => d.region_type === "H") ?? docs[0] ?? null
  );
}

/** 좌표 → 행정동 표시 문자열(예 "서울특별시 강동구 길동"). 없으면 null. */
export async function coordToRegion(coord: Coord): Promise<string | null> {
  const url = new URL(COORD2REGION_ENDPOINT);
  url.searchParams.set("x", String(coord.lng));
  url.searchParams.set("y", String(coord.lat));

  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`카카오 좌표→행정동 변환 실패: HTTP ${res.status} ${body}`);
  }
  const data = (await res.json()) as { documents: KakaoRegionDocument[] };
  const doc = pickRegionDocument(data.documents ?? []);
  return doc?.address_name || null;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- kakao-address`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/providers/kakao-address.ts src/lib/providers/__tests__/kakao-address.test.ts
git commit -m "feat(where-am-i): 좌표→행정동 coordToRegion provider 추가"
```

---

## Task 2: `WhereAmI` 타입 + 조립 + 산문 빌더

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/where-am-i.ts`
- Test: `src/lib/__tests__/where-am-i.test.ts`

**Interfaces:**
- Consumes: `coordToAddress`·`coordToRegion`(Task 1), `findStationsNear`(subway-stations), `findSurroundingsNear`(surroundings), `bearingDegrees`·`bearingToCompass8`(bearing), `CompassDirection`, `SurroundingPlace`.
- Produces:
  - `interface WhereAmI` — `{ address, region, nearestStation, landmarks }`.
  - `interface LocationNarrative` — `{ place: string | null; station: WhereAmI["nearestStation"]; landmarks: SurroundingPlace[] }`.
  - `buildLocationNarrative(data: WhereAmI): LocationNarrative` (순수).
  - `assembleWhereAmI(lat: number, lng: number): Promise<WhereAmI>` (I/O, allSettled).

- [ ] **Step 1: 타입 추가 (types.ts)**

`src/lib/types.ts`의 `SurroundingPlace` 정의 바로 아래에 추가:

```ts
/**
 * "현재 위치" 정위 카드(where-am-i) — 좌표를 받아 네 조각을 병렬 조립한 결과.
 * 각 조각은 독립 실패(부분 실패 격리) — 전부 비면 라우트가 502.
 */
export interface WhereAmI {
  /** 도로명/지번 주소(coordToAddress). 둘 다 없으면 null. */
  address: { road?: string; jibun?: string } | null;
  /** 행정동 표시 문자열(coordToRegion, 예 "서울특별시 강동구 길동"). 없으면 null. */
  region: string | null;
  /** 가장 가까운 도시철도역 1곳(1km 내). 없으면 null. */
  nearestStation: {
    name: string;
    line?: string;
    bearing: CompassDirection;
    distanceMeters: number;
  } | null;
  /** 주변 기준점(거리순, 카페·음식점 포함). 없으면 빈 배열. */
  landmarks: SurroundingPlace[];
}

/** 산문 렌더용 구조화 데이터 — 순수 buildLocationNarrative 산출(컴포넌트가 5개 언어로 렌더). */
export interface LocationNarrative {
  /** 단락1 위치 문자열(행정동 + 도로명 조합). 둘 다 없으면 null → 위치 문장 생략. */
  place: string | null;
  /** 단락1 역 문장 데이터. 없으면 null → 역 문장 생략. */
  station: WhereAmI["nearestStation"];
  /** 단락2 기준점(상위 6). 빈 배열이면 단락2 생략. */
  landmarks: SurroundingPlace[];
}
```

- [ ] **Step 2: 실패 테스트 작성**

`src/lib/__tests__/where-am-i.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildLocationNarrative } from "../where-am-i";
import type { WhereAmI, SurroundingPlace } from "../types";

function lm(id: string, distanceMeters: number): SurroundingPlace {
  return {
    id,
    name: id,
    category: "convenience",
    categoryRaw: "가정,생활 > 편의점",
    distanceMeters,
    bearing: "n",
    lat: 37.5,
    lng: 127.1,
  };
}

const base: WhereAmI = {
  address: { road: "천호대로 1042", jibun: "길동 123" },
  region: "서울특별시 강동구 길동",
  nearestStation: { name: "굽은다리", line: "5호선", bearing: "se", distanceMeters: 250 },
  landmarks: [],
};

describe("buildLocationNarrative", () => {
  it("행정동과 도로명을 ', '로 합쳐 place를 만든다", () => {
    expect(buildLocationNarrative(base).place).toBe(
      "서울특별시 강동구 길동, 천호대로 1042",
    );
  });

  it("행정동만 있으면 행정동만, 도로명만 있으면 도로명만", () => {
    expect(
      buildLocationNarrative({ ...base, address: null }).place,
    ).toBe("서울특별시 강동구 길동");
    expect(
      buildLocationNarrative({ ...base, region: null, address: { road: "천호대로 1042" } }).place,
    ).toBe("천호대로 1042");
  });

  it("주소·행정동 모두 없으면 place는 null", () => {
    expect(
      buildLocationNarrative({ ...base, address: null, region: null }).place,
    ).toBeNull();
  });

  it("도로명이 없으면 지번으로 폴백한다", () => {
    expect(
      buildLocationNarrative({ ...base, region: null, address: { jibun: "길동 123" } }).place,
    ).toBe("길동 123");
  });

  it("landmarks는 거리순 상위 6개로 자른다", () => {
    const many = Array.from({ length: 10 }, (_, i) => lm(`p${i}`, (i + 1) * 10));
    const out = buildLocationNarrative({ ...base, landmarks: many });
    expect(out.landmarks).toHaveLength(6);
    expect(out.landmarks[0].distanceMeters).toBe(10);
    expect(out.landmarks[5].distanceMeters).toBe(60);
  });

  it("station은 그대로 통과시킨다", () => {
    expect(buildLocationNarrative(base).station?.name).toBe("굽은다리");
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm run test:run -- where-am-i`
Expected: FAIL — Cannot find module `../where-am-i`.

- [ ] **Step 4: `where-am-i.ts` 구현**

`src/lib/where-am-i.ts`:

```ts
import { coordToAddress, coordToRegion } from "./providers/kakao-address";
import { findSurroundingsNear } from "./providers/surroundings";
import { findStationsNear } from "./subway-stations";
import { bearingDegrees, bearingToCompass8 } from "./geo/bearing";
import type { LocationNarrative, SurroundingPlace, WhereAmI } from "./types";

/** 산문 단락2에 노출할 기준점 최대 개수. */
const LANDMARK_CAP = 6;
/** 근접역 탐색 반경(m) — 이 밖이면 역 문장 생략. */
const STATION_RADIUS = 1000;

/**
 * 순수: WhereAmI → 산문 렌더용 구조화 데이터.
 * place는 행정동 + 도로명(없으면 지번)을 ", "로 합친 위치 문자열, 둘 다 없으면 null.
 * landmarks는 거리순 상위 LANDMARK_CAP. 입력을 변형하지 않는다.
 */
export function buildLocationNarrative(data: WhereAmI): LocationNarrative {
  const road = data.address?.road || data.address?.jibun || null;
  const parts = [data.region, road].filter((s): s is string => Boolean(s));
  const place = parts.length > 0 ? parts.join(", ") : null;
  return {
    place,
    station: data.nearestStation,
    landmarks: data.landmarks.slice(0, LANDMARK_CAP),
  };
}

/**
 * I/O: 좌표 → 네 조각 병렬 조립. 각 조각 독립 실패(allSettled) — 한 조각 실패가
 * 나머지를 죽이지 않는다. 근접역은 정적 seed(거의 항상 성공)지만 1km 밖이면 null.
 * 전부 비는 경우의 502 판정은 라우트가 한다(여기선 비어도 정상 반환).
 */
export async function assembleWhereAmI(
  lat: number,
  lng: number,
): Promise<WhereAmI> {
  const [addrR, regionR, surroundingsR] = await Promise.allSettled([
    coordToAddress({ lat, lng }),
    coordToRegion({ lat, lng }),
    findSurroundingsNear(lat, lng),
  ]);

  const addr = addrR.status === "fulfilled" ? addrR.value : null;
  const address =
    addr && (addr.roadAddress || addr.jibunAddress)
      ? { road: addr.roadAddress, jibun: addr.jibunAddress }
      : null;

  const region = regionR.status === "fulfilled" ? regionR.value : null;

  const landmarks: SurroundingPlace[] =
    surroundingsR.status === "fulfilled" ? surroundingsR.value : [];

  // 근접역: seed 동기 호출(예외 없음). 1km 내 최근접 1역.
  const near = findStationsNear(lat, lng, {
    radiusMeters: STATION_RADIUS,
    dedupeByName: true,
    limit: 1,
  });
  const st = near[0];
  const nearestStation = st
    ? {
        name: st.name,
        line: st.lineName || undefined,
        bearing: bearingToCompass8(bearingDegrees(lat, lng, st.lat, st.lng)),
        distanceMeters: Math.round(st.distanceMeters),
      }
    : null;

  return { address, region, nearestStation, landmarks };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm run test:run -- where-am-i`
Expected: PASS (6 tests in where-am-i.test.ts).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/types.ts src/lib/where-am-i.ts src/lib/__tests__/where-am-i.test.ts
git commit -m "feat(where-am-i): WhereAmI 타입·조립·산문 빌더(순수) 추가"
```

---

## Task 3: `whereAmIToPlace` — 현재 위치 → Place 합성

**Files:**
- Create: `src/lib/where-am-i-place.ts`
- Test: `src/lib/__tests__/where-am-i-place.test.ts`

**Interfaces:**
- Consumes: `WhereAmI`(Task 2), `Place`, `Coord`.
- Produces: `whereAmIToPlace(data: WhereAmI, coord: Coord): Place` — 채팅 앵커용. `name`=행정동→도로명→"현재 위치" 폴백, `category=""`(isStation false 보장), 좌표=현재 위치.

> ⚠ `name` 폴백에 "현재 위치"는 한국어 하드코딩이 아니라 채팅 placeContext의 `name`(좌표 앵커 식별용)일 뿐 — UI 표시는 컴포넌트가 i18n으로 따로 한다. category는 빈 문자열로 둬 `ChatOverlay`의 `isStation(place)`가 false가 되게 한다(역 프롬프트 오분류 방지).

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/__tests__/where-am-i-place.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { whereAmIToPlace } from "../where-am-i-place";
import type { WhereAmI } from "../types";

const coord = { lat: 37.538, lng: 127.139 };
const base: WhereAmI = {
  address: { road: "천호대로 1042", jibun: "길동 123" },
  region: "서울특별시 강동구 길동",
  nearestStation: null,
  landmarks: [],
};

describe("whereAmIToPlace", () => {
  it("행정동을 name으로, 좌표를 그대로 쓴다", () => {
    const p = whereAmIToPlace(base, coord);
    expect(p.name).toBe("서울특별시 강동구 길동");
    expect(p.lat).toBe(37.538);
    expect(p.lng).toBe(127.139);
  });

  it("행정동이 없으면 도로명, 그것도 없으면 '현재 위치'", () => {
    expect(whereAmIToPlace({ ...base, region: null }, coord).name).toBe("천호대로 1042");
    expect(
      whereAmIToPlace({ ...base, region: null, address: null }, coord).name,
    ).toBe("현재 위치");
  });

  it("category는 빈 문자열(역 오분류 방지)", () => {
    expect(whereAmIToPlace(base, coord).category).toBe("");
  });

  it("주소 필드를 채운다", () => {
    const p = whereAmIToPlace(base, coord);
    expect(p.roadAddress).toBe("천호대로 1042");
    expect(p.address).toBe("길동 123");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- where-am-i-place`
Expected: FAIL — Cannot find module `../where-am-i-place`.

- [ ] **Step 3: 구현**

`src/lib/where-am-i-place.ts`:

```ts
import type { Coord, Place, WhereAmI } from "./types";

/**
 * 현재 위치(WhereAmI) → 채팅 앵커용 Place 합성(nearby-place.ts 패턴 동형).
 *
 * category를 빈 문자열로 둬 ChatOverlay의 isStation(place)가 false가 되게 한다
 * (현재 위치를 역으로 오분류해 역 프롬프트를 주는 것 방지). name은 placeContext의
 * 좌표 앵커 식별 문자열 — 행정동 > 도로명 > "현재 위치" 순 폴백.
 * 순수 함수 — React/Next 비의존.
 */
export function whereAmIToPlace(data: WhereAmI, coord: Coord): Place {
  const name = data.region || data.address?.road || data.address?.jibun || "현재 위치";
  return {
    id: `where-am-i-${coord.lat.toFixed(5)}-${coord.lng.toFixed(5)}`,
    name,
    category: "",
    address: data.address?.jibun ?? "",
    roadAddress: data.address?.road ?? "",
    lat: coord.lat,
    lng: coord.lng,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- where-am-i-place`
Expected: PASS (4 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/where-am-i-place.ts src/lib/__tests__/where-am-i-place.test.ts
git commit -m "feat(where-am-i): 현재 위치→Place 합성(채팅 앵커) 추가"
```

---

## Task 4: `/api/where-am-i` 라우트

**Files:**
- Create: `src/app/api/where-am-i/route.ts`

**Interfaces:**
- Consumes: `hasKakaoKey`(env), `assembleWhereAmI`(Task 2).
- Produces: `GET /api/where-am-i?lat=&lng=` → `{ data: WhereAmI }` 또는 `{ error }`. 좌표 무효 400, 키 없음 `{ data: null }`, 네 조각 전부 비면 502, 그 외 200.

- [ ] **Step 1: 구현 (route는 I/O — lint+build+실호출 게이트, 단위테스트 없음)**

`src/app/api/where-am-i/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasKakaoKey } from "@/lib/env";
import { assembleWhereAmI } from "@/lib/where-am-i";

/**
 * GET /api/where-am-i?lat=..&lng=..
 * "현재 위치" 정위 카드 — 주소·행정동·근접역·주변 기준점을 병렬 조립.
 * 키 없음 → { data: null }(canShowWhereAmI 게이트와 이중 방어).
 * 네 조각 전부 비면 502(조회 실패 ≠ 정보 없음), 그 외 200.
 */

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
  if (!hasKakaoKey()) {
    return NextResponse.json({ data: null });
  }
  try {
    const data = await assembleWhereAmI(parsed.data.lat, parsed.data.lng);
    const empty =
      !data.address &&
      !data.region &&
      !data.nearestStation &&
      data.landmarks.length === 0;
    if (empty) {
      return NextResponse.json({ error: "현재 위치 정보를 찾지 못했습니다" }, { status: 502 });
    }
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[api/where-am-i]", e);
    return NextResponse.json({ error: "현재 위치 조회 실패" }, { status: 502 });
  }
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 라우트 `/api/where-am-i` 컴파일 성공, 타입 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/where-am-i/route.ts
git commit -m "feat(where-am-i): /api/where-am-i 라우트 추가"
```

---

## Task 5: i18n — `whereAmI.*` 그룹 + `placeChat.launchForLocation`

**Files:**
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json`

**Interfaces:**
- Produces: `whereAmI` 그룹(button/refresh/상태/narrative/direction/category/chatButton/source) + `placeChat.launchForLocation`. `i18n-messages.test.ts`가 5개 언어 키 집합·ICU 플레이스홀더·t.rich 태그 동일성을 자동 검증.

> 산문 조립 규칙: 단락2 landmarks는 `narrative.landmarksLead` + 항목들(`narrative.landmarkItem`, rich `<name>`) join(", ") + `narrative.landmarksTail`로 조립한다. 한국어는 "… 등이 있습니다."처럼 **"등"이 조사 버퍼**라 항목 이름 받침과 무관하게 안전. `direction`·`category`는 `surroundingsNearby`와 같은 8방위·10카테고리 라벨을 복제(키 결합도 낮춤).

- [ ] **Step 1: `messages/ko.json`에 `whereAmI` 그룹 추가** (`surroundingsNearby` 뒤)

```json
"whereAmI": {
  "button": "현재 위치 확인",
  "refresh": "위치 새로고침",
  "locating": "현재 위치 확인 중…",
  "loading": "주변 정보 조회 중…",
  "empty": "현재 위치 정보를 찾지 못했습니다.",
  "error": "현재 위치 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  "ready": "현재 위치",
  "asOf": "{time} 기준",
  "geoDenied": "현재 위치 권한이 필요합니다. 브라우저에서 위치 접근을 허용해 주세요.",
  "geoUnsupported": "이 브라우저는 현재 위치를 지원하지 않습니다.",
  "narrative": {
    "here": "현재 위치는 <place></place>입니다.",
    "station": "가장 가까운 지하철역은 <name></name>{line}, {direction}쪽 약 {distance}입니다.",
    "landmarksLead": "주변에는 ",
    "landmarkItem": "{direction}쪽 약 {distance}에 <name></name> {category}",
    "landmarksTail": " 등이 있습니다.",
    "lineSuffix": "({line})"
  },
  "chatButton": "내 현재 위치에 관해 물어보기",
  "source": "출처: 카카오맵. 방향은 북 기준 방위입니다.",
  "direction": {
    "n": "북", "ne": "북동", "e": "동", "se": "남동",
    "s": "남", "sw": "남서", "w": "서", "nw": "북서"
  },
  "category": {
    "convenience": "편의점", "subway": "지하철역", "restaurant": "음식점",
    "cafe": "카페", "bank": "은행", "pharmacy": "약국", "hospital": "병원",
    "mart": "마트", "public": "공공기관", "attraction": "관광명소"
  }
}
```

그리고 `placeChat` 그룹에 한 줄 추가:

```json
"launchForLocation": "내 현재 위치에 관해 물어보기"
```

- [ ] **Step 2: `messages/en.json`에 동일 키 구조로 영문 추가**

```json
"whereAmI": {
  "button": "Where am I",
  "refresh": "Refresh location",
  "locating": "Checking your location…",
  "loading": "Looking up your surroundings…",
  "empty": "Could not determine your current location.",
  "error": "Failed to look up your location. Please try again shortly.",
  "ready": "Current location",
  "asOf": "as of {time}",
  "geoDenied": "Location permission is required. Please allow location access in your browser.",
  "geoUnsupported": "This browser does not support location.",
  "narrative": {
    "here": "You are at <place></place>.",
    "station": "The nearest subway station is <name></name>{line}, about {distance} to the {direction}.",
    "landmarksLead": "Nearby you'll find ",
    "landmarkItem": "<name></name> ({category}) about {distance} to the {direction}",
    "landmarksTail": ", and more.",
    "lineSuffix": " ({line})"
  },
  "chatButton": "Ask about my current location",
  "source": "Source: Kakao Map. Directions are compass bearings from north.",
  "direction": {
    "n": "north", "ne": "northeast", "e": "east", "se": "southeast",
    "s": "south", "sw": "southwest", "w": "west", "nw": "northwest"
  },
  "category": {
    "convenience": "convenience store", "subway": "subway station", "restaurant": "restaurant",
    "cafe": "café", "bank": "bank", "pharmacy": "pharmacy", "hospital": "hospital",
    "mart": "mart", "public": "public office", "attraction": "attraction"
  }
}
```

`placeChat.launchForLocation`: `"Ask about my current location"`.

- [ ] **Step 3: `messages/es.json` 추가**

```json
"whereAmI": {
  "button": "Dónde estoy",
  "refresh": "Actualizar ubicación",
  "locating": "Comprobando tu ubicación…",
  "loading": "Consultando tu entorno…",
  "empty": "No se pudo determinar tu ubicación actual.",
  "error": "No se pudo consultar tu ubicación. Inténtalo de nuevo en breve.",
  "ready": "Ubicación actual",
  "asOf": "a las {time}",
  "geoDenied": "Se requiere permiso de ubicación. Permite el acceso a la ubicación en tu navegador.",
  "geoUnsupported": "Este navegador no admite la ubicación.",
  "narrative": {
    "here": "Estás en <place></place>.",
    "station": "La estación de metro más cercana es <name></name>{line}, a unos {distance} al {direction}.",
    "landmarksLead": "Cerca encontrarás ",
    "landmarkItem": "<name></name> ({category}) a unos {distance} al {direction}",
    "landmarksTail": ", y más.",
    "lineSuffix": " ({line})"
  },
  "chatButton": "Preguntar sobre mi ubicación actual",
  "source": "Fuente: Kakao Map. Las direcciones son rumbos desde el norte.",
  "direction": {
    "n": "norte", "ne": "noreste", "e": "este", "se": "sureste",
    "s": "sur", "sw": "suroeste", "w": "oeste", "nw": "noroeste"
  },
  "category": {
    "convenience": "tienda de conveniencia", "subway": "estación de metro", "restaurant": "restaurante",
    "cafe": "cafetería", "bank": "banco", "pharmacy": "farmacia", "hospital": "hospital",
    "mart": "supermercado", "public": "oficina pública", "attraction": "atracción"
  }
}
```

`placeChat.launchForLocation`: `"Preguntar sobre mi ubicación actual"`.

- [ ] **Step 4: `messages/fr.json` 추가**

```json
"whereAmI": {
  "button": "Où suis-je",
  "refresh": "Actualiser la position",
  "locating": "Vérification de votre position…",
  "loading": "Recherche de votre environnement…",
  "empty": "Impossible de déterminer votre position actuelle.",
  "error": "Échec de la localisation. Veuillez réessayer dans un instant.",
  "ready": "Position actuelle",
  "asOf": "à {time}",
  "geoDenied": "L'autorisation de localisation est requise. Autorisez l'accès à la position dans votre navigateur.",
  "geoUnsupported": "Ce navigateur ne prend pas en charge la localisation.",
  "narrative": {
    "here": "Vous êtes à <place></place>.",
    "station": "La station de métro la plus proche est <name></name>{line}, à environ {distance} au {direction}.",
    "landmarksLead": "À proximité, vous trouverez ",
    "landmarkItem": "<name></name> ({category}) à environ {distance} au {direction}",
    "landmarksTail": ", et plus encore.",
    "lineSuffix": " ({line})"
  },
  "chatButton": "Poser une question sur ma position actuelle",
  "source": "Source : Kakao Map. Les directions sont des relèvements depuis le nord.",
  "direction": {
    "n": "nord", "ne": "nord-est", "e": "est", "se": "sud-est",
    "s": "sud", "sw": "sud-ouest", "w": "ouest", "nw": "nord-ouest"
  },
  "category": {
    "convenience": "supérette", "subway": "station de métro", "restaurant": "restaurant",
    "cafe": "café", "bank": "banque", "pharmacy": "pharmacie", "hospital": "hôpital",
    "mart": "supermarché", "public": "bureau public", "attraction": "attraction"
  }
}
```

`placeChat.launchForLocation`: `"Poser une question sur ma position actuelle"`.

- [ ] **Step 5: `messages/it.json` 추가**

```json
"whereAmI": {
  "button": "Dove mi trovo",
  "refresh": "Aggiorna posizione",
  "locating": "Controllo della tua posizione…",
  "loading": "Ricerca dei dintorni…",
  "empty": "Impossibile determinare la tua posizione attuale.",
  "error": "Impossibile localizzarti. Riprova tra poco.",
  "ready": "Posizione attuale",
  "asOf": "alle {time}",
  "geoDenied": "È richiesta l'autorizzazione alla posizione. Consenti l'accesso alla posizione nel browser.",
  "geoUnsupported": "Questo browser non supporta la posizione.",
  "narrative": {
    "here": "Ti trovi a <place></place>.",
    "station": "La stazione della metropolitana più vicina è <name></name>{line}, a circa {distance} a {direction}.",
    "landmarksLead": "Nelle vicinanze troverai ",
    "landmarkItem": "<name></name> ({category}) a circa {distance} a {direction}",
    "landmarksTail": ", e altro ancora.",
    "lineSuffix": " ({line})"
  },
  "chatButton": "Chiedi informazioni sulla mia posizione attuale",
  "source": "Fonte: Kakao Map. Le direzioni sono rilevamenti dal nord.",
  "direction": {
    "n": "nord", "ne": "nord-est", "e": "est", "se": "sud-est",
    "s": "sud", "sw": "sud-ovest", "w": "ovest", "nw": "nord-ovest"
  },
  "category": {
    "convenience": "minimarket", "subway": "stazione della metropolitana", "restaurant": "ristorante",
    "cafe": "caffè", "bank": "banca", "pharmacy": "farmacia", "hospital": "ospedale",
    "mart": "supermercato", "public": "ufficio pubblico", "attraction": "attrazione"
  }
}
```

`placeChat.launchForLocation`: `"Chiedi informazioni sulla mia posizione attuale"`.

- [ ] **Step 6: i18n 키 일관성 + 빌드 확인**

Run: `npm run test:run -- i18n-messages`
Expected: PASS — 5개 언어 `whereAmI` 키 집합·ICU 플레이스홀더(`{time}`·`{line}`·`{direction}`·`{distance}`·`{category}`)·t.rich 태그(`<place>`·`<name>`) 동일.

- [ ] **Step 7: 커밋**

```bash
git add messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json
git commit -m "feat(where-am-i): whereAmI i18n 5개 언어 + 위치 채팅 버튼 라벨"
```

---

## Task 6: `WhereAmI` 컴포넌트

**Files:**
- Create: `src/components/WhereAmI.tsx`

**Interfaces:**
- Consumes: `assembleWhereAmI` 결과를 `/api/where-am-i`로 fetch, `buildLocationNarrative`·`whereAmIToPlace`(순수), `awaitGeolocation`, `useNearbyPanel`, `usePlaceChat`, `ChatOverlay`, `formatDistance`, `WhereAmI` 타입.
- Produces: `<WhereAmI canShowChat?: boolean />` — `SurroundingsNearby` 동형(버튼·아코디언·force 새로고침·prevStatus 복원·Esc 경합 차단).

> ⚠ force 새로고침 실패 시 직전 `done` 데이터 복원(`prevStatus`), `engaged: status.kind !== "idle" && !isChatOpen`(Esc 경합 차단), 닫기 시 trigger 포커스 복귀 — 세 가지를 `SurroundingsNearby`와 동일하게 유지한다. 산문은 보이는 `<p>` 한 곳에만(live 복제 금지). 정밀 좌표를 `whereAmIToPlace`에 그대로 넘겨 채팅 앵커가 카드와 같은 좌표를 쓰게 한다.

- [ ] **Step 1: 컴포넌트 작성**

`src/components/WhereAmI.tsx`:

```tsx
"use client";

import { Fragment, useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageSquare } from "lucide-react";
import type { Coord, WhereAmI as WhereAmIData } from "@/lib/types";
import { buildLocationNarrative } from "@/lib/where-am-i";
import { whereAmIToPlace } from "@/lib/where-am-i-place";
import { formatDistance } from "@/lib/format";
import { awaitGeolocation } from "@/lib/geolocation";
import { useNearbyPanel } from "@/hooks/useNearbyPanel";
import { usePlaceChat } from "@/hooks/usePlaceChat";
import { ChatOverlay } from "./chat/ChatOverlay";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "done"; data: WhereAmIData; coord: Coord; at: string };

/**
 * "현재 위치" 정위 카드 — 홈 "내 주변" 묶음 맨 위 별도 버튼. SurroundingsNearby
 * 동형(공유 geolocation·아코디언·force 새로고침·prevStatus 복원·Esc 경합 차단).
 * 차이: 카테고리 리스트가 아니라 도로명·행정동·근접역·기준점을 결정론 산문 두세
 * 단락으로 제시(buildLocationNarrative). 채팅 버튼은 현재 위치를 Place로 합성해
 * 같은 ChatOverlay(Perplexity 포함)를 연다.
 */
export function WhereAmI({ canShowChat = false }: { canShowChat?: boolean }) {
  const t = useTranslations("whereAmI");
  const tActions = useTranslations("actions");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inFlightRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { chatPlace, isChatOpen, openChat, closeChat } = usePlaceChat();

  async function fetchAt(lat: number, lng: number) {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(`/api/where-am-i?lat=${lat}&lng=${lng}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok || !body.data) {
        setStatus({ kind: res.ok ? "empty" : "error" });
        return;
      }
      const at = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      setStatus({ kind: "done", data: body.data, coord: { lat, lng }, at });
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setStatus({ kind: "error" });
    }
  }

  function load(force = false) {
    const prevStatus = status;
    claim();
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const done = () => {
      inFlightRef.current = false;
    };
    setStatus({ kind: "locating" });
    void awaitGeolocation({ force }).then((g) => {
      if (g.status === "ready") {
        void fetchAt(g.coords.lat, g.coords.lng).finally(done);
      } else {
        setStatus(
          prevStatus.kind === "done"
            ? prevStatus
            : {
                kind: "geoerror",
                reason: g.status === "unsupported" ? "unsupported" : "denied",
              },
        );
        done();
      }
    });
  }

  const close = useCallback((restoreFocus = true) => {
    setStatus({ kind: "idle" });
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const onDismiss = useCallback(() => close(false), [close]);
  const onEscape = useCallback(() => close(true), [close]);
  const { claim } = useNearbyPanel({
    engaged: status.kind !== "idle" && !isChatOpen,
    onDismiss,
    onEscape,
  });

  const busy = status.kind === "locating" || status.kind === "loading";
  const buttonLabel = status.kind === "done" ? t("refresh") : t("button");

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
              : "";

  const narrative =
    status.kind === "done" ? buildLocationNarrative(status.data) : null;

  return (
    <div className="mt-3">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => load(status.kind === "done")}
        aria-disabled={busy}
        aria-busy={busy}
        className="min-h-11 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent aria-disabled:opacity-50"
      >
        {buttonLabel}
      </button>

      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        {live}
      </p>

      {status.kind === "done" && narrative && (
        <div className="mt-2 rounded-md border border-border p-3">
          <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold">
            {t("ready")}
            <span className="ml-2 text-xs font-normal opacity-70">
              {t("asOf", { time: status.at })}
            </span>
          </h3>

          <button
            type="button"
            onClick={() => close()}
            className="mt-1 min-h-11 text-sm text-accent underline"
          >
            {tActions("close")}
          </button>

          {/* 단락 1 — 위치 + 가장 가까운 역 */}
          <p className="mt-2 text-sm leading-relaxed">
            {narrative.place &&
              t.rich("narrative.here", {
                place: () => <span lang="ko">{narrative.place}</span>,
              })}
            {narrative.station && (
              <>
                {" "}
                {t.rich("narrative.station", {
                  name: () => <span lang="ko">{narrative.station!.name}</span>,
                  line: narrative.station.line
                    ? t("narrative.lineSuffix", { line: narrative.station.line })
                    : "",
                  direction: t(`direction.${narrative.station.bearing}`),
                  distance: formatDistance(narrative.station.distanceMeters),
                })}
              </>
            )}
          </p>

          {/* 단락 2 — 주변 기준점(거리순 상위 6) */}
          {narrative.landmarks.length > 0 && (
            <p className="mt-2 text-sm leading-relaxed">
              {t("narrative.landmarksLead")}
              {narrative.landmarks.map((l, i) => (
                <Fragment key={l.id}>
                  {i > 0 && ", "}
                  {t.rich("narrative.landmarkItem", {
                    name: () => <span lang="ko">{l.name}</span>,
                    category: t(`category.${l.category}`),
                    direction: t(`direction.${l.bearing}`),
                    distance: formatDistance(l.distanceMeters),
                  })}
                </Fragment>
              ))}
              {t("narrative.landmarksTail")}
            </p>
          )}

          {canShowChat && (
            <p className="mt-3 text-sm">
              <button
                type="button"
                onClick={(e) =>
                  openChat(whereAmIToPlace(status.data, status.coord), e.currentTarget)
                }
                className="inline-flex min-h-11 items-center gap-1 text-accent underline"
              >
                <MessageSquare aria-hidden="true" className="h-4 w-4 shrink-0" />
                {t("chatButton")}
              </button>
            </p>
          )}

          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}

      {chatPlace && <ChatOverlay place={chatPlace} onClose={closeChat} />}
    </div>
  );
}
```

- [ ] **Step 2: 빌드 + lint 확인**

Run: `npm run lint && npm run build`
Expected: 타입·lint 에러 없음. (아직 마운트 전이라 화면엔 안 뜸.)

- [ ] **Step 3: 커밋**

```bash
git add src/components/WhereAmI.tsx
git commit -m "feat(where-am-i): 현재 위치 정위 카드 컴포넌트(산문·채팅)"
```

---

## Task 7: 마운트 — PlaceSearch 맨 위 + page.tsx 게이트

**Files:**
- Modify: `src/components/PlaceSearch.tsx`
- Modify: `src/app/[locale]/page.tsx`

**Interfaces:**
- Consumes: `WhereAmI` 컴포넌트(Task 6), `hasKakaoKey`.
- Produces: 홈 idle 상태에서 '내 주변' 묶음 맨 위(지하철 위)에 `<WhereAmI>` 렌더. `canShowWhereAmI` prop 추가.

- [ ] **Step 1: PlaceSearch에 import + prop 추가**

`src/components/PlaceSearch.tsx` 상단 import 블록(다른 nearby import 옆)에 추가:

```tsx
import { WhereAmI } from "./WhereAmI";
```

props 구조분해(다른 `canShow*` 기본값 옆, 예: `canShowSurroundings = false,` 줄 근처)에 추가:

```tsx
  canShowWhereAmI = false,
```

props 타입(다른 `canShowSurroundings?: boolean;` 옆)에 추가:

```tsx
  canShowWhereAmI?: boolean;
```

- [ ] **Step 2: 마운트 — nearby 묶음 맨 위(지하철 위)**

`src/components/PlaceSearch.tsx`의 `{canShowSubway && status.kind === "idle" && (` 블록 **바로 앞**에 추가:

```tsx
      {canShowWhereAmI && status.kind === "idle" && (
        <WhereAmI canShowChat={canShowChat} />
      )}
```

- [ ] **Step 3: page.tsx에서 게이트 전달**

`src/app/[locale]/page.tsx`의 `<PlaceSearch ... />`에 prop 추가(`hasKakaoKey`는 이미 import되어 있음 — `canShowSurroundings={hasKakaoKey()}` 등으로 사용 중):

```tsx
      canShowWhereAmI={hasKakaoKey()}
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 에러 없음. (`hasKakaoKey` 미import면 page.tsx 상단 import 확인 — 이미 사용 중이라 있을 것.)

- [ ] **Step 5: 커밋**

```bash
git add src/components/PlaceSearch.tsx src/app/[locale]/page.tsx
git commit -m "feat(where-am-i): 홈 내 주변 묶음 맨 위에 현재 위치 카드 마운트"
```

---

## Task 8: 게이트 통과 + 실호출 검증 + 마무리

**Files:** 없음(검증·커밋만).

- [ ] **Step 1: 전체 테스트·lint·빌드**

Run: `npm run test:run && npm run lint && npm run build`
Expected: 전부 PASS. 새 테스트(kakao-address 3 + where-am-i 6 + where-am-i-place 4 + i18n 일관성)와 기존 테스트 모두 green.

- [ ] **Step 2: dev 실호출 검증 (머지 게이트 — fixture green ≠ 실계약)**

Run: `npm run dev` 후 별도 셸에서:

```bash
# 길동 좌표 — 도로명·행정동·근접역·기준점 6개 확인
curl -s "http://localhost:3000/api/where-am-i?lat=37.538&lng=127.139" | head -c 1200
```

Expected: `{"data":{"address":{"road":"서울 강동구 …","jibun":"…"},"region":"서울특별시 강동구 …동","nearestStation":{"name":"…","line":"…호선","bearing":"…","distanceMeters":<n>},"landmarks":[… 6개 …]}}`. region·address 채워짐, landmarks에 카페·음식점 포함, nearestStation bearing이 8방위 중 하나.

```bash
# 좌표 범위 밖 → 400
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/where-am-i?lat=10&lng=10"   # 400
# 무효 좌표(누락) → 400
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/where-am-i"                  # 400
```

- [ ] **Step 3: 브라우저 스모크 (선택, Claude in Chrome)**

`http://localhost:3000/ko` 홈에서 "현재 위치 확인" 버튼이 '내 주변' 묶음 맨 위에 보이고, 클릭 시(위치 권한 허용) 산문 두세 단락 + "내 현재 위치에 관해 물어보기" 버튼이 뜨는지. 채팅 버튼 클릭 → ChatOverlay 열림 → Esc로 채팅만 닫히고 카드는 유지(Esc 경합 차단)되는지.

- [ ] **Step 4: 최종 상태 확인**

```bash
git log --oneline -8
git status   # clean
```

Expected: Task 1~7 커밋이 순서대로, working tree clean.

---

## Self-Review (작성자 체크 — 작성 완료)

**1. Spec coverage:**
- §2 아키텍처 4조각 병렬 → Task 2 `assembleWhereAmI`(allSettled) ✓
- §2 부분 실패·전부 비면 502 → Task 4 route `empty` 판정 ✓
- §3 결정론 산문(LLM 아님) → Task 2 `buildLocationNarrative` 순수 + Task 6 i18n 렌더 ✓
- §3 상대 방향 금지·8방위 → `bearing` 재사용, narrative에 bearing만 ✓
- §4 채팅 버튼 Perplexity 재사용 → Task 3 `whereAmIToPlace` + Task 6 `ChatOverlay` ✓
- §5 내 주변 맨 위 별도 버튼·아코디언·force·div·h4·single live → Task 6·7 ✓
- §5 `canShowWhereAmI`=`hasKakaoKey()` 게이트 → Task 4·7 ✓
- §6 한계(상대방향·실시간추적·건물명·GPS) → 설계 반영, 구현 범위 밖 명시 ✓
- §7 순수 fixture 테스트 + 실호출 게이트 → Task 1·2·3·8 ✓

**2. Placeholder scan:** TBD/TODO 없음. 모든 코드 블록 완전. ✓

**3. Type consistency:** `WhereAmI`(types.ts) ↔ `assembleWhereAmI` 반환 ↔ route `data` ↔ 컴포넌트 `body.data` 일치. `LocationNarrative.place: string | null` ↔ 컴포넌트 `narrative.place &&` 가드 일치. `whereAmIToPlace(data, coord)` 2-인자 ↔ Task 6 호출 `whereAmIToPlace(status.data, status.coord)` 일치. `coordToRegion(coord: Coord)` ↔ `assembleWhereAmI`의 `coordToRegion({lat,lng})` 일치. ✓

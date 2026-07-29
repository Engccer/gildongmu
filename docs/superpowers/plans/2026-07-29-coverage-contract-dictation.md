# 서비스 지역 계약 + 받아쓰기 재설계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App Review 2.1(a) 반려 해소 — 한국 밖 좌표를 오류가 아닌 "서비스 지역" 상태로 응답·렌더하고, iOS 받아쓰기를 탭 토글 기본 + 준비 상태 가시화로 재설계한 뒤 재제출한다.

**Architecture:** 커버리지 술어를 `src/lib/coverage.ts` 1벌로 통일하고, 좌표 라우트 13개가 한국 밖 좌표에 200 `{outOfCoverage:true}` 마커를 반환한다(정상 응답 byte-불변). 웹·iOS는 fetch 전 선분기 + 마커 이중 방어로 안내를 렌더하고, 채팅 라우터는 앵커 좌표 기준으로 도구를 게이트한다. iOS 받아쓰기는 기본값을 탭 토글로 바꾸고 전사 모델 preflight·오류 종별 표면화를 넣는다.

**Tech Stack:** Next.js 16 · zod 4 · Vitest 4 · next-intl 4 · SwiftUI(iOS 26 SpeechAnalyzer) · packages/cli·mcp(npm)

**정본 스펙:** `docs/superpowers/specs/2026-07-29-coverage-contract-dictation-design.md`

## Global Constraints

- 커버리지 경계: 위도 31.43~44.35, 경도 122.37~132.0 (기존 `deeplink.ts` 값 승격, 웹·iOS 동조).
- 마커 계약: 한국 밖 좌표 → HTTP 200, body 정확히 `{"outOfCoverage":true}`. 정상 응답·400(형식 오류)·502(upstream 장애)는 byte-불변.
- 안내 문구 톤: "앱 전체 불가"로 읽히는 문구 금지. 정본 ko: "현재 위치 기반 기능은 대한민국 안에서 제공됩니다. 장소 검색, 역 정보, 길찾기는 계속 사용할 수 있습니다." / en: "Location-based features are available within South Korea. Place search, station info, and directions remain available."
- 커버리지 안내는 오류가 아니다: 오류 색·오류 아이콘 미사용, 기존 단일 polite live region/통지 채널 재사용.
- em dash 금지, UI 라벨 이모지 금지, 주석·커밋 한국어, `git add -A` 금지(의도 파일만), 매 태스크 커밋.
- 모든 웹 태스크는 `npm run test:run`+`npm run lint` 통과, i18n 키는 6로케일(ko/en/es/fr/it/ja) 동조(`i18n-messages.test.ts` 게이트).
- iOS 문자열은 `Localizable.xcstrings`에 6로케일 추가, `appLocalized()` 경유.

---

### Task 1: 커버리지 정본 술어 `src/lib/coverage.ts`

**Files:**
- Create: `src/lib/coverage.ts`
- Create: `src/lib/__tests__/coverage.test.ts`
- Modify: `src/lib/deeplink.ts:14-24` (경계·isInKorea 정의 제거, coverage import·re-export)
- Modify: `src/lib/route-coord-schema.ts:2` (import 출처 교체)

**Interfaces:**
- Produces: `isInKorea(lat: number, lng: number): boolean`, `KOREA_COVERAGE_BBOX = { latMin, latMax, lngMin, lngMax }` (이후 모든 태스크가 `@/lib/coverage`에서 import)
- `deeplink.ts`는 `export { isInKorea } from "./coverage"`로 기존 소비자 호환 유지.

- [ ] **Step 1: 실패 테스트 작성** — `src/lib/__tests__/coverage.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { isInKorea, KOREA_COVERAGE_BBOX } from "@/lib/coverage";

describe("isInKorea", () => {
  it("한국 좌표는 true (서울·제주·독도)", () => {
    expect(isInKorea(37.5665, 126.978)).toBe(true);
    expect(isInKorea(33.4996, 126.5312)).toBe(true);
    expect(isInKorea(37.2422, 131.8674)).toBe(true);
  });
  it("해외 좌표는 false (샌프란시스코·도쿄·파리)", () => {
    expect(isInKorea(37.7749, -122.4194)).toBe(false);
    expect(isInKorea(35.6762, 139.6503)).toBe(false);
    expect(isInKorea(48.8566, 2.3522)).toBe(false);
  });
  it("경계 상수는 deeplink 유래 값(31.43~44.35 / 122.37~132.0)", () => {
    expect(KOREA_COVERAGE_BBOX).toEqual({ latMin: 31.43, latMax: 44.35, lngMin: 122.37, lngMax: 132.0 });
  });
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:run -- coverage.test` → FAIL(모듈 없음)
- [ ] **Step 3: 구현** — `src/lib/coverage.ts`

```ts
/**
 * 대한민국 서비스 커버리지 정본 술어.
 * 값은 네이버 지도 URL scheme 유효 범위(구 deeplink.ts) 승격 — iOS Kit Coverage.swift 미러(값 변경 시 동조).
 * 제약의 근원은 upstream API의 데이터 커버리지이며, 이 술어는 그 현실을 앞당긴 방어막이다(spec §설계 원칙 1).
 */
export const KOREA_COVERAGE_BBOX = {
  latMin: 31.43,
  latMax: 44.35,
  lngMin: 122.37,
  lngMax: 132.0,
} as const;

export function isInKorea(lat: number, lng: number): boolean {
  return (
    lat >= KOREA_COVERAGE_BBOX.latMin &&
    lat <= KOREA_COVERAGE_BBOX.latMax &&
    lng >= KOREA_COVERAGE_BBOX.lngMin &&
    lng <= KOREA_COVERAGE_BBOX.lngMax
  );
}
```

`deeplink.ts`: `LAT_RANGE`/`LNG_RANGE`/`isInKorea` 정의를 삭제하고 상단에 `import { isInKorea } from "./coverage";` + 파일 하단(또는 기존 위치)에 `export { isInKorea };` (기존 `import { isInKorea } from "@/lib/deeplink"` 소비자 무파손). 내부 사용처(`buildRouteDeeplink` 등)는 그대로 동작.
`route-coord-schema.ts`: `import { isInKorea } from "@/lib/deeplink";` → `"@/lib/coverage"`.

- [ ] **Step 4: 통과 확인** — `npm run test:run` 전체 + `npm run lint` (deeplink 기존 테스트 회귀 포함)
- [ ] **Step 5: 커밋** — `git add src/lib/coverage.ts src/lib/__tests__/coverage.test.ts src/lib/deeplink.ts src/lib/route-coord-schema.ts && git commit -m "feat(coverage): 한반도 커버리지 술어 정본 모듈 신설(deeplink 경계 승격)" -- <동일 4파일>`

---

### Task 2: nearby 계열 10개 라우트에 마커 계약 적용

**Files:**
- Modify(10): `src/app/api/weather/nearby/route.ts` · `air-quality/nearby` · `where-am-i` · `bus/nearby` · `bike/nearby` · `clinic/nearby` · `places/around` · `places/kids` · `places/barrier-free` · `station/subway-arrival/nearby` (각 route.ts)
- Test: 각 라우트의 기존 `__tests__/route.test.ts`에 케이스 추가(없는 라우트는 마커 검증만 담은 최소 테스트 신설)

**Interfaces:**
- Consumes: Task 1의 `isInKorea`
- Produces: HTTP 계약 — 한국 밖 유효 좌표 → 200 `{outOfCoverage:true}`; 전지구 범위 밖·비수치 → 400(종전 문구); 한국 안은 기존 흐름 byte-불변. (웹·iOS·CLI·채팅 태스크가 이 계약에 의존)

- [ ] **Step 1: 실패 테스트 작성** — 각 라우트 테스트에 동일 패턴 추가(예: weather):

```ts
it("한국 밖 좌표는 200 outOfCoverage 마커(upstream 미호출)", async () => {
  const res = await GET(makeRequest({ lat: "37.7749", lng: "-122.4194" }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ outOfCoverage: true });
});
it("전지구 범위 밖 좌표는 여전히 400", async () => {
  const res = await GET(makeRequest({ lat: "95", lng: "200" }));
  expect(res.status).toBe(400);
});
```

(`makeRequest`는 각 테스트 파일의 기존 헬퍼를 따른다. upstream 미호출은 provider mock의 `toHaveBeenCalledTimes(0)`로 검증.)

- [ ] **Step 2: 실패 확인** — `npm run test:run -- api` → 신규 케이스 FAIL(현재는 400)
- [ ] **Step 3: 구현** — 10개 라우트 공통 편집 패턴(weather 예시, 나머지 동일 구조):

```ts
import { isInKorea } from "@/lib/coverage";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

// parsed.success 분기 바로 뒤, 키 게이트보다 앞에:
if (!isInKorea(parsed.data.lat, parsed.data.lng)) {
  return NextResponse.json({ outOfCoverage: true });
}
```

주의: ① 키 게이트(`hasXKey`)보다 **앞** — 키 없는 배포에서도 커버리지가 우선 판정. ② 기존 zod `.min(33).max(43)`/`.min(124).max(132)`를 전지구 값으로 교체(라우트별 파라미터명 차이 확인: 전부 lat/lng). ③ 응답 status 명시 불필요(기본 200).

- [ ] **Step 4: 통과 확인** — `npm run test:run` 전체(기존 한국 좌표 케이스 회귀 0 확인)
- [ ] **Step 5: 커밋** — 수정한 라우트·테스트 파일만 pathspec 커밋: `fix(api): 좌표 nearby 라우트 10종 한국 밖 좌표를 200 outOfCoverage 마커로 응답`

---

### Task 3: 길찾기 3종 라우트 마커 적용

**Files:**
- Modify: `src/app/api/route/car/route.ts` · `route/transit/route.ts` · `route/walk/route.ts`
- Modify: `src/lib/route-coord-schema.ts` (isInKorea refine 제거 → 전지구 정합성만)
- Test: 각 라우트 기존 테스트 + walk 테스트에 마커 케이스

**Interfaces:**
- Consumes: Task 1 `isInKorea`
- Produces: 출발·도착 어느 한쪽이라도 한국 밖 → 200 `{outOfCoverage:true}`. `coordSchema`는 형식·전지구 범위만 검증(refine 메시지 "좌표가 한반도 권역을 벗어남" 삭제).

- [ ] **Step 1: 실패 테스트** — walk 라우트 테스트에:

```ts
it("출발지가 한국 밖이면 200 outOfCoverage(provider 미호출)", async () => {
  const res = await GET(makeRequest({ origin: "37.7749,-122.4194", dest: "37.5665,126.978" }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ outOfCoverage: true });
});
```

- [ ] **Step 2: 실패 확인** — 현재는 coordSchema refine이 400을 만든다 → FAIL
- [ ] **Step 3: 구현** — `route-coord-schema.ts`의 `.refine((c) => isInKorea(...), ...)` 줄 삭제 + 전지구 범위 refine 추가(`.refine((c) => Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180, "좌표 범위 오류")`). 각 라우트 핸들러에서 parse 성공 직후:

```ts
if (!isInKorea(origin.lat, origin.lng) || !isInKorea(dest.lat, dest.lng)) {
  return NextResponse.json({ outOfCoverage: true });
}
```

(walk 라우트는 `accessible` 검증보다 앞에 둔다. 세 라우트의 파라미터 추출 변수명은 각 파일 확인 후 동일 위치에 삽입.)

- [ ] **Step 4: 통과 확인** — `npm run test:run` 전체
- [ ] **Step 5: 커밋** — `fix(api): 길찾기 3종 한국 밖 좌표 200 outOfCoverage 마커(coordSchema는 형식 검증만)`

---

### Task 4: 웹 i18n 키 + 공용 커버리지 헬퍼 + 마커 감지

**Files:**
- Modify: `messages/ko.json`·`en.json`·`es.json`·`fr.json`·`it.json`·`ja.json` (common 네임스페이스에 `outOfCoverage` 1키)
- Create: `src/lib/out-of-coverage.ts` (fetch 응답 마커 감지 헬퍼)
- Test: `src/lib/__tests__/out-of-coverage.test.ts`

**Interfaces:**
- Produces: `isOutOfCoverageBody(body: unknown): body is { outOfCoverage: true }` · i18n 키 `common.outOfCoverage` (Task 5·6이 소비)

- [ ] **Step 1: 실패 테스트**

```ts
import { describe, expect, it } from "vitest";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";

describe("isOutOfCoverageBody", () => {
  it("마커 body만 true", () => {
    expect(isOutOfCoverageBody({ outOfCoverage: true })).toBe(true);
    expect(isOutOfCoverageBody({ weather: null })).toBe(false);
    expect(isOutOfCoverageBody(null)).toBe(false);
    expect(isOutOfCoverageBody({ outOfCoverage: false })).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**

```ts
/** 서버 커버리지 마커(spec §2) 감지 — 200 응답 body 전용, React 비의존. */
export function isOutOfCoverageBody(body: unknown): body is { outOfCoverage: true } {
  return typeof body === "object" && body !== null &&
    (body as { outOfCoverage?: unknown }).outOfCoverage === true;
}
```

i18n 6로케일 `common.outOfCoverage` 추가 — ko/en은 Global Constraints의 정본 문구, es/fr/it/ja는 동일 의미 번역(en 기준). 배치는 각 파일의 기존 `common` 오브젝트 안(키 정렬 관례 따름).

- [ ] **Step 4: 통과 확인** — `npm run test:run`(i18n-messages.test 포함)
- [ ] **Step 5: 커밋** — `feat(web): 커버리지 안내 i18n 키·마커 감지 헬퍼`

---

### Task 5: 웹 위치 의존 컴포넌트 선분기 + 이중 방어

**Files:**
- Modify(11): `src/components/WhereAmI.tsx` · `LocalConditions.tsx` · `SubwayArrivalsNearby.tsx` · `BusArrivals.tsx` · `BikeStations.tsx` · `NightClinicsNearby.tsx` · `KidsPlacesNearby.tsx` · `SurroundingsNearby.tsx` · `BarrierFreeNearby.tsx` · `WalkInfraNearby.tsx`(마커 아님 — 선분기 제외, 무변경 확인만) · `DirectionsView.tsx`(현위치 출발 `cur` 토큰)
- Modify: `src/components/PlaceSearch.tsx`(한국 밖 좌표 블렌딩·reverse 라벨 호출 생략)
- Test: 기존 컴포넌트 테스트 레인 없음 → 로직은 Task 4 헬퍼가 커버, 여기선 lint+build+실측(Task 12)

**Interfaces:**
- Consumes: `isInKorea`(coverage) · `isOutOfCoverageBody` · `common.outOfCoverage`
- Produces: 각 컴포넌트의 `status`에 `"outOfCoverage"` 분기(기존 상태 union 확장)

- [ ] **Step 1: 공통 패턴 확정(대표: LocalConditions)** — 위치 취득 성공 직후:

```tsx
const pos = await awaitGeolocation();
if (!isInKorea(pos.lat, pos.lng)) {
  setStatus("outOfCoverage");
  return;
}
```

fetch 응답 처리에 이중 방어:

```tsx
const body = await res.json();
if (isOutOfCoverageBody(body)) { setStatus("outOfCoverage"); return; }
```

렌더 분기(오류 스타일 금지 — 일반 본문 텍스트):

```tsx
{status === "outOfCoverage" && <p>{t("common.outOfCoverage")}</p>}
```

live region 통지는 각 컴포넌트의 기존 단일 채널에 같은 문구로 1회(별도 region 신설 금지).

- [ ] **Step 2: 11개 파일 순차 적용** — 각 파일의 상태 union·fetch 지점·렌더 스위치에 위 패턴 삽입. `DirectionsView`는 `cur` 토큰 해석 시 현재 위치가 한국 밖이면 폼 하단에 같은 문구 렌더 + 조회 중단. `WalkInfraNearby`는 서버가 마커를 안 보내므로 선분기·마커 처리 모두 추가하지 않는다(자체 unsupported 유지 확인만).
- [ ] **Step 3: PlaceSearch 좌표 생략** — 검색 fetch에 좌표를 붙이는 지점에서 `isInKorea` false면 lat/lng 파라미터 생략(검색 자체는 진행), `geocode/reverse` 현재 위치 라벨 호출도 같은 조건으로 생략.
- [ ] **Step 4: 확인** — `npm run lint` + `npm run build` + `npm run test:run`
- [ ] **Step 5: 커밋** — `feat(web): 위치 의존 컴포넌트 커버리지 선분기·마커 이중 방어`

---

### Task 6: 채팅 라우터 앵커 기준 게이트

**Files:**
- Modify: `src/lib/chat/router.ts`
- Test: `src/lib/chat/__tests__/router-coverage.test.ts` (신설)

**Interfaces:**
- Consumes: `isInKorea` · `anchorOf(ctx)`(기존, `ctx.placeAnchor ?? ctx.userLocation`)
- Produces: 좌표 의존 도구가 앵커(길찾기 3종은 `ctx.userLocation`) 한국 밖일 때 provider 미호출로 `{ data: OUT_OF_COVERAGE }` 반환

- [ ] **Step 1: 실패 테스트** — 핵심 3케이스:

```ts
it("userLocation이 해외면 get_weather는 provider 없이 outOfCoverage 데이터", async () => {
  const r = await executeFunction("get_weather", {}, ctxWith({ userLocation: SF }));
  expect(r.data).toEqual({ outOfCoverage: true,
    notice: "현재 위치 기반 기능은 대한민국 안에서 제공됩니다. 장소 검색, 역 정보, 길찾기는 계속 사용할 수 있습니다." });
});
it("placeAnchor가 한국이면 userLocation이 해외여도 주변 도구 정상 실행", async () => {
  const r = await executeFunction("get_subway_arrivals", {}, ctxWith({ placeAnchor: SEOUL, userLocation: SF }));
  expect(r.data).not.toHaveProperty("outOfCoverage");
});
it("길찾기는 출발지(userLocation) 기준 — 해외면 outOfCoverage", async () => {
  const r = await executeFunction("get_car_route", { place: "경복궁" }, ctxWith({ placeAnchor: SEOUL, userLocation: SF }));
  expect(r.data).toMatchObject({ outOfCoverage: true });
});
```

(기존 라우터 테스트의 ctx 헬퍼·provider mock 관례를 따른다. SF=`{lat:37.7749,lng:-122.4194}`, SEOUL=`{lat:37.5665,lng:126.978}`.)

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `router.ts` 상단에:

```ts
import { isInKorea } from "@/lib/coverage";

const OUT_OF_COVERAGE = {
  outOfCoverage: true,
  notice: "현재 위치 기반 기능은 대한민국 안에서 제공됩니다. 장소 검색, 역 정보, 길찾기는 계속 사용할 수 있습니다.",
};

function coverageGate(coord: { lat: number; lng: number } | undefined) {
  return coord && !isInKorea(coord.lat, coord.lng) ? { data: OUT_OF_COVERAGE } : null;
}
```

적용 지점: 앵커 사용 도구(`get_subway_arrivals`·`get_night_clinics`·`get_nearby_barrier_free`·`get_kids_places`·`get_surroundings`·`get_walk_infrastructure`·`get_bus_arrivals`·`get_bike_stations`·`get_air_quality`·`get_weather`)는 `const anchor = anchorOf(ctx)`(또는 resolveCoord 결과) 직후 `const gated = coverageGate(anchor); if (gated) return gated;`. 길찾기 3종(`get_car_route`·`get_transit_route`·`get_walk_route`)은 `ctx.userLocation` null 체크 직후 `coverageGate(ctx.userLocation)`. `search_places`·`search_address`·역명 2종·`search_web`은 게이트하지 않는다(이름 기반, spec §설계 원칙 2). render·source는 게이트 응답에 포함하지 않는다.

- [ ] **Step 4: 통과 확인** — `npm run test:run`(기존 라우터·도구 테스트 회귀 0)
- [ ] **Step 5: 커밋** — `feat(chat): 좌표 도구 앵커 기준 커버리지 게이트(장소 앵커는 해외 사용자도 정상)`

---

### Task 7: CLI·MCP 마커 소비

**Files:**
- Modify: `packages/cli/src/lib/api-client.ts` (마커 감지 → 전용 오류 아님, 정보 출력용 타입)
- Modify: `packages/cli/src/commands/` 중 좌표 명령(`nearby.ts`·`whereami.ts`·`route.ts`·`bus.ts`) 출력 분기
- Modify: `packages/mcp/src/index.ts` (도구 응답 텍스트 분기)
- Test: `packages/cli/src/__tests__/` 기존 관례에 마커 케이스 추가

**Interfaces:**
- Consumes: 서버 마커 계약(Task 2·3)
- Produces: CLI/MCP 사용자 문구 — "서비스 지역(대한민국) 밖 좌표입니다. 장소 검색, 역 정보, 길찾기는 계속 사용할 수 있습니다."

- [ ] **Step 1: 실패 테스트** — CLI 테스트 관례(mock fetch)로 nearby 명령이 마커 응답 시 위 문구를 출력하고 exit 0인지 검증.
- [ ] **Step 2: 실패 확인** → FAIL(현재는 페이로드 파싱 실패 경로)
- [ ] **Step 3: 구현** — 공용 헬퍼를 `packages/cli/src/lib/api-client.ts`에:

```ts
export function isOutOfCoverage(body: unknown): boolean {
  return typeof body === "object" && body !== null &&
    (body as { outOfCoverage?: unknown }).outOfCoverage === true;
}
export const OUT_OF_COVERAGE_NOTICE =
  "서비스 지역(대한민국) 밖 좌표입니다. 장소 검색, 역 정보, 길찾기는 계속 사용할 수 있습니다.";
```

각 좌표 명령은 `apiRequest` 결과를 파싱하기 전에 `isOutOfCoverage(result)`면 NOTICE를 출력하고 정상 종료. MCP는 같은 조건에서 도구 결과 텍스트로 NOTICE 반환. `endpoint-catalog-shared.ts` 両미러(cli·mcp)는 설명 문구 변경이 없으면 무변경(drift 테스트로 확인).

- [ ] **Step 4: 통과 확인** — `npm run test:run`(workspace 포함 여부는 기존 스크립트 확인, 별도면 `npm test -w packages/cli`)
- [ ] **Step 5: 커밋** — `feat(cli,mcp): outOfCoverage 마커 안내 출력`. (npm 릴리스 태그는 재제출과 독립 — 마일스톤 완료 후 일괄)

---

### Task 8: iOS Kit — Coverage.swift + APIClient 마커 감지

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/Coverage.swift`
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Deeplink.swift` (자체 isInKorea 제거, Coverage 사용)
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/APIClient.swift` (`APIError.outOfCoverage` + get에서 마커 감지)
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/CoverageTests.swift` (신설)

**Interfaces:**
- Produces: `public func isInKorea(lat: Double, lng: Double) -> Bool` · `APIError.outOfCoverage` (뷰 태스크 9가 소비)

- [ ] **Step 1: 실패 테스트**

```swift
import Testing
@testable import GildongmuKit

@Test func 한국_좌표는_커버리지_안() {
    #expect(isInKorea(lat: 37.5665, lng: 126.978))
    #expect(!isInKorea(lat: 37.7749, lng: -122.4194))
}

@Test func 마커_응답은_outOfCoverage_오류로_던진다() async {
    // URLProtocol mock으로 200 {"outOfCoverage":true} 응답을 주고
    // client.get이 APIError.outOfCoverage를 던지는지 검증(기존 Kit 테스트의 mock 관례 재사용)
}
```

- [ ] **Step 2: 실패 확인** — `cd ios/GildongmuKit && swift test` → FAIL
- [ ] **Step 3: 구현** — `Coverage.swift`:

```swift
import Foundation

/// 대한민국 서비스 커버리지 정본 술어 — 웹 src/lib/coverage.ts 미러(값 변경 시 동조).
public func isInKorea(lat: Double, lng: Double) -> Bool {
    (31.43...44.35).contains(lat) && (122.37...132.0).contains(lng)
}
```

`Deeplink.swift`: 자체 `isInKorea` 정의 삭제(공개 시그니처 동일하므로 소비자 무파손 — 삭제 후 전체 빌드로 확인).
`APIClient.swift`: `APIError`에 `case outOfCoverage` 추가, `get`의 2xx 분기에서 디코딩 전에:

```swift
struct OutOfCoverageMarker: Decodable { let outOfCoverage: Bool }
if let marker = try? JSONDecoder().decode(OutOfCoverageMarker.self, from: data), marker.outOfCoverage {
    throw APIError.outOfCoverage
}
```

(정상 페이로드에 `outOfCoverage` 필드가 없으므로 오탐 불가. 마커 body는 `{"outOfCoverage":true}` 고정.)

- [ ] **Step 4: 통과 확인** — `swift test` 전체
- [ ] **Step 5: 커밋** — `feat(ios-kit): 커버리지 술어·APIClient outOfCoverage 마커 감지`

---

### Task 9: iOS 뷰 — .outOfCoverage 상태 + WhereAmI 문구 분리

**Files:**
- Modify: `ios/Gildongmu/Nearby/NearbyLoadState.swift` (케이스 추가)
- Modify(9): `Nearby/` 하위 `SubwayNearbyView`·`BusNearbyView`·`BikeNearbyView`·`ClinicNearbyView`·`BarrierFreeNearbyView`·`KidsNearbyView`·`AroundNearbyView`·`ConditionsView`·`WhereAmIView` (+ Directions 현위치 출발 경로: `Directions/DirectionsView.swift`)
- Modify: `ios/Gildongmu/Resources/Localizable.xcstrings` (키 2개: `ios.common.outOfCoverage`, `ios.nearby.whereAmIServerFailed`)

**Interfaces:**
- Consumes: `APIError.outOfCoverage`(Task 8) · Kit `isInKorea`
- Produces: 각 화면의 커버리지 안내 렌더(`ContentUnavailableView(appLocalized("ios.common.outOfCoverage"), systemImage: "map")` — 오류 아이콘 금지)

- [ ] **Step 1: 상태 확장** — `NearbyLoadState`에 `case outOfCoverage` 추가(주석: "서비스 지역 밖 — 실패 아님, spec 2026-07-29").
- [ ] **Step 2: 공통 매핑 패턴(대표: ClinicNearbyView 계열)** — 각 모델 load의 catch에서:

```swift
} catch APIError.outOfCoverage {
    state = .outOfCoverage
}
```

위치 취득 직후 선분기(네트워크 생략 이중 방어):

```swift
guard isInKorea(lat: coord.lat, lng: coord.lng) else { state = .outOfCoverage; return }
```

각 뷰 stateOverlay에:

```swift
case .outOfCoverage:
    ContentUnavailableView(appLocalized("ios.common.outOfCoverage"), systemImage: "map")
```

`ConditionsView`는 `try?` 삼킴을 do-catch로 전환해 `.outOfCoverage`(화면 단위 Phase에 케이스 추가)와 일반 실패를 구분 — 위치가 한국 밖이면 두 fetch 모두 생략하고 화면 단위 안내. 통지는 기존 완료 통지 채널에 같은 문구 1회.

- [ ] **Step 3: WhereAmI 문구 분리** — `WhereAmIView` `.failed` 렌더의 `ios.nearby.whereAmIFailed`("현재 위치 조회 실패")를 신설 키 `ios.nearby.whereAmIServerFailed`(ko "현재 위치 정보를 불러오지 못했습니다" / en "Couldn't load information for your location")로 교체. `whereAmIFailed`는 `LocationError` 경로(진짜 위치 취득 실패)에만 남긴다 — 모델 catch를 LocationError(위치 실패)와 그 외(서버 실패)로 이미 구분 중이므로 `.failed`를 `.failedServer`/`.failedLocation` 2케이스로 분리해 각각 문구 매핑.
- [ ] **Step 4: xcstrings 6로케일 추가** — `ios.common.outOfCoverage` = Global Constraints 정본 문구(웹과 동일), `ios.nearby.whereAmIServerFailed` 상기 문구. 키 린터 게이트 통과 확인.
- [ ] **Step 5: 빌드 확인** — `xcodebuildmcp simulator build`(또는 기존 빌드 명령)로 컴파일 통과.
- [ ] **Step 6: 커밋** — `feat(ios): 서비스 지역 밖 상태 렌더·WhereAmI 실패 문구 분리`

---

### Task 10: iOS 받아쓰기 기본값 탭 토글 + 홀드 짧은 탭 가시 안내

**Files:**
- Modify: `ios/Gildongmu/HoldDictationButton.swift:7-21` (기본값), `:82-85`(AppStorage 기본), 짧은 탭 경로(가시 안내)
- Modify: `ios/Gildongmu/SettingsView.swift:47,101-103` (기본값·옵션 순서)

**Interfaces:**
- Produces: `DictationStyle.current` 기본 `.tapToggle`. 설정 Picker 순서 탭 토글 → 홀드.

- [ ] **Step 1: 기본값 전환** — `DictationStyle.current`의 `?? .hold` → `?? .tapToggle`, `HoldDictationButton`·`SettingsView`의 `@AppStorage(... ) = DictationStyle.hold.rawValue` → `.tapToggle.rawValue` (세 지점 전부 동조 — 한 곳이라도 남으면 화면 간 기본값 불일치). `CaseIterable` 선언 순서를 `case tapToggle, hold`로 바꿔 설정 Picker가 탭 토글을 먼저 노출(기존 rawValue 문자열은 불변 — 저장값 호환).
- [ ] **Step 2: 홀드 모드 짧은 탭 가시 안내** — 홀드 스타일에서 짧은 탭(기존 VO polite 안내 발화 지점)에 비-VO 사용자용 일시 안내를 추가: 버튼 인근 `Text(appLocalized("ios.voice.holdHintVisible"))`를 3초 표시(상태 `@State private var showHoldHint`, `task`로 자동 소거). 신설 키 `ios.voice.holdHintVisible` ko "길게 누르고 말하기" / en "Press and hold to speak" (6로케일). VO 계약(라벨·통지) 불변 — 안내 Text는 `accessibilityHidden(true)`(VO는 기존 통지가 담당, 이중 낭독 금지).
- [ ] **Step 3: 빌드+수동 확인** — 시뮬레이터에서 탭 토글 기본 동작(탭=시작, 라벨 "중지" 전환), 설정에서 홀드 선택 시 기존 홀드 계약 유지.
- [ ] **Step 4: 커밋** — `feat(ios): 받아쓰기 기본 탭 토글 전환·홀드 짧은 탭 가시 안내`

---

### Task 11: iOS 음성 preflight·오류 표면화·Siri 다국어

**Files:**
- Modify: `ios/Gildongmu/SpeechService.swift` (installedLocales 선판정·reserve·진행 상태·오류 종별·스트림 catch)
- Modify: `ios/Gildongmu/HoldDictationButton.swift` (준비 중 상태 표시)
- Modify: `ios/Gildongmu/AppShortcuts.swift` (영어 phrases)
- Modify: `ios/Gildongmu.xcodeproj/project.pbxproj` (`INFOPLIST_KEY_NSSpeechRecognitionUsageDescription` 2개 구성) + `ios/Gildongmu/Resources/InfoPlist.xcstrings`
- Modify: `ios/Gildongmu/Resources/Localizable.xcstrings` (오류·준비 문구 키)

**Interfaces:**
- Consumes: 기존 `SpeechService.Phase`·`SpeechError`
- Produces: `Phase`에 `.preparing`(모델 다운로드) 추가, `SpeechError`에 `.assetDownloadFailed` 추가, 종별 알럿 키 4종

- [ ] **Step 1: preflight 구현** — `beginListening()`의 `supportedLocale` 판정 직후:

```swift
let installed = await SpeechTranscriber.installedLocales
if !installed.contains(where: { $0.identifier(.bcp47) == locale.identifier(.bcp47) }) {
    phase = .preparing
    do {
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await request.downloadAndInstall()
        }
    } catch { throw SpeechError.assetDownloadFailed }
}
try await AssetInventory.reserve(locale: locale)
```

(기존 152-154의 무조건 설치 요청을 위 선판정 구조로 교체. reserve 실패는 non-fatal — `try?`로 감싸고 os_log만. 정확한 API 시그니처는 구현 시 iOS 26 SDK 문서로 검증하되, 설치 선판정 → 가시 상태 → 설치 → 예약 순서는 불변.)

- [ ] **Step 2: 준비 상태 가시화** — `HoldDictationButton`(및 마이크 행 라벨)이 `.preparing`일 때 라벨을 `ios.voice.preparing`(ko "음성 인식 준비 중" / en "Preparing speech recognition")으로 표시(ProgressView 병기). 준비 중 재진입은 기존 in-flight 가드로 차단, `disabled` 금지(포커스 유지 원칙) — `aria-disabled` 등가인 핸들러 가드 사용.
- [ ] **Step 3: 오류 종별 표면화** — `SpeechError`에 `.assetDownloadFailed` 추가. `start()`의 catch를:

```swift
} catch {
    Logger(subsystem: "app.gildongmu", category: "speech").error("start 실패: \(String(describing: error))")
    lastError = error as? SpeechError
    await teardown()
    phase = .failed
}
```

소비 3뷰(`SearchView`·`ChatConversationView`·`DirectionsEndpointSearchView`)의 알럿 문구를 `lastError` 종별로 분기: `.localeUnsupported` → `ios.voice.errorLocale`(ko "이 언어는 음성 인식을 지원하지 않습니다"), `.audioUnavailable` → `ios.voice.errorAudio`(ko "마이크를 사용할 수 없습니다. 다른 앱이 사용 중인지 확인해 주세요"), `.assetDownloadFailed` → `ios.voice.errorDownload`(ko "음성 인식 준비에 실패했습니다. 네트워크 연결 후 다시 시도해 주세요"), 그 외 → 기존 `ios.voice.failed`. en·나머지 로케일 동조. 스트림 소비 빈 catch(`SpeechService.swift:174-176`)는 os_log + `phase = .failed` 전이로 교체.
- [ ] **Step 4: NSSpeechRecognitionUsageDescription** — pbxproj 두 구성에 `INFOPLIST_KEY_NSSpeechRecognitionUsageDescription = "받아쓰기를 위해 음성 인식을 사용합니다"` 추가, InfoPlist.xcstrings에 en "Speech recognition is used for dictation" 포함 6로케일.
- [ ] **Step 5: Siri 다국어 phrases** — `AppShortcuts.swift` phrases에 영어 문구 추가(`"Voice search in \(.applicationName)"` 등 기존 한국어 phrase당 en 1개 이상). 외부 시작 세션 계약(탭=정지) 불변.
- [ ] **Step 6: 빌드+수동 확인** — 시뮬레이터 en 로케일로 받아쓰기 시작 → `.preparing` 표시 여부(모델 미설치 시), 오류 알럿 종별 분기.
- [ ] **Step 7: 커밋** — `feat(ios): 전사 모델 preflight·음성 오류 종별 표면화·Siri 영어 문구`

---

### Task 12: 통합 실검증 (머지 게이트)

**Files:** 없음(검증 전용). 발견 결함은 해당 태스크로 돌아가 수정.

- [ ] **Step 1: 웹 게이트** — `npm run test:run` + `npm run lint` + `npm run build` 전체 그린.
- [ ] **Step 2: 서버 실호출(로컬)** — dev 서버 기동 후:

```bash
curl -s 'localhost:3000/api/weather/nearby?lat=37.7749&lng=-122.4194'   # {"outOfCoverage":true}
curl -s 'localhost:3000/api/weather/nearby?lat=37.5665&lng=126.978'      # 기존 날씨 페이로드
curl -s 'localhost:3000/api/route/walk?origin=37.7749,-122.4194&dest=37.5665,126.978'  # 마커
```

- [ ] **Step 3: 웹 UI 실측** — 브라우저 geolocation을 샌프란시스코로 오버라이드해 내 주변·날씨·WhereAmI가 커버리지 안내(오류 톤 아님)를 렌더하는지, 검색 "경복궁"이 정상 동작하는지 확인.
- [ ] **Step 4: iOS 심사 등가 재현** — 시뮬레이터 위치 SF(`xcrun simctl location <udid> set 37.7749,-122.4194`), 영어 로케일: Nearby 전 종목·Conditions·WhereAmI 커버리지 안내, 받아쓰기 탭 토글 시작·정지, 검색 "Gyeongbokgung" 정상, 장소 앵커 채팅에서 주변 질문 정상(앵커 기준). `xcodebuildmcp simulator build-and-run` + `snapshot-ui`로 라벨 확인.
- [ ] **Step 5: a11y 점검** — `a11y-auditor` 서브에이전트로 변경 화면(커버리지 안내·받아쓰기 라벨) 점검.
- [ ] **Step 6: push·프로덕션 검증** — 리뷰 게이트 통과 후 push(자동배포) → prod에 Step 2 동일 curl → 마커 확인.

---

### Task 13: 재제출·심사 회신 (외부 발신 게이트)

- [ ] **Step 1: 빌드 번호 상승**(1.0 (5)) 후 아카이브 업로드(기존 TestFlight 절차: CLI 업로드, Cloud Managed 서명).
- [ ] **Step 2: 심사 회신 영문 초안 작성** — 내용: ① 길동무는 대한민국 지역 서비스(데이터 소스가 한국 공공·상용 API) ② 지역 밖에서는 명시적 안내를 표시하도록 개선(스크린샷 지점 전부) ③ 받아쓰기 탭 토글 기본·준비 상태 가시화 ④ 해외에서도 장소 검색·역 정보·길찾기 브리핑·채팅은 동작(심사 시 확인 경로 안내). **초안은 위원장 승인 후에만 발송(하드 스톱).**
- [ ] **Step 3: 승인 후** — ASC에서 회신 발송 + Resubmit to App Review.
- [ ] **Step 4: PROGRESS.md 갱신**(반려 경위·대응·재제출 일시) + 접근성 헌장 §6 기본 계약 서술 갱신은 후속 메모로 위임.

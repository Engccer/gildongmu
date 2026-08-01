# 실시간 인구 혼잡도 구현 플랜

> **에이전틱 워커용:** 이 플랜은 태스크 단위로 실행한다. 스펙 정본은 `docs/superpowers/specs/2026-08-01-realtime-congestion-design.md`.

**목표:** 서울 121개 핫스팟의 실시간 혼잡도를, 구성 정류장 좌표로 영역을 판정해 웹·iOS·채팅·CLI에 낸다.

**아키텍처:** 오프라인 스크립트가 121개 영역의 구성 지점 좌표를 seed로 굳히고(`congestion-areas.json`), 순수 함수가 사용자 좌표에서 최근접 구성 지점 300m 이내 영역을 고르며, provider가 그 `AREA_CD`로 실시간 등급을 가져온다. 판정(순수)과 호출(네트워크)을 분리해 임계값 회귀를 fixture로 잡는다.

**스택:** TypeScript, Next.js 16 Route Handler, zod 4, Vitest 4, Swift(GildongmuKit), citty(CLI).

## 전역 제약

- `SEOUL_OPEN_DATA_KEY` 게이트(`hasSeoulOpenDataKey`). 키 없으면 `{area:null}`, **mock 폴백 금지**.
- 좌표 라우트 순서: **파싱 → 커버리지 마커 → 키 게이트 → upstream**.
- 좌표 파라미터는 `z.coerce.number()` 직접 사용 금지. `/api/events/nearby`의 `coord()` 패턴(문자열 존재 선요구)을 쓴다(백로그 D3).
- 3-state를 뭉개지 않는다: 영역 밖(`area:null`) ≠ 조회 실패(throw→502) ≠ 한국 밖(200 `outOfCoverage`).
- 인구수·예보는 UI 미표기(스펙 §2-6, §3). 등급어가 낭독 정본.
- em dash 금지, UI 라벨 이모지 금지, 주석·커밋 한국어.
- CLI 카탈로그에 항목을 더하면 `FORMATTERS`에도 등록한다(등록 누락은 text 모드에서만 보인다).

## 구현 방식 판정

**혼합.** T1~T4는 **순차 의존**이라 inline으로 한다(seed 형식이 판정 함수의 입력을, 판정 결과가 서비스 반환형을, 서비스가 라우트 계약을 정한다. 게다가 외부 API 통합이라 실측이 설계를 뒤집을 수 있다). T4에서 **라우트 응답 스키마와 i18n 키가 고정되면** T5~T8은 서로 다른 파일·다른 언어를 만지는 진짜 독립 태스크가 되므로 위임 대상이다.

관측 가능한 근거: T1~T4는 수정 파일이 겹치고(`src/lib/` 같은 계층) 선행 산출물을 입력으로 받는다. T5(`src/components/`)·T6(`ios/`)·T7(`src/lib/chat/`)·T8(`packages/`)은 수정 파일 교집합이 0이다.

리뷰는 구현 방식과 무관하게 별도 컨텍스트에 맡긴다.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `scripts/build-congestion-areas.mjs` | 121개 훑어 seed 생성 + 무결성 가드 (오프라인) |
| `src/lib/providers/data/congestion-areas.json` | seed(116영역·1,969지점). 서버 전용 import |
| `src/lib/congestion-area.ts` | **순수** 판정. 좌표 → `CongestionArea \| null` |
| `src/lib/providers/seoul-congestion.ts` | 실시간 호출 + 전용 봉투 파서 + 영역별 캐시 |
| `src/lib/congestion.ts` | 진입점. 판정 + 호출 조립(라우트·채팅 공용) |
| `src/app/api/congestion/nearby/route.ts` | 라우트 |
| `src/components/LocalConditions.tsx` | 혼잡도 줄 추가(수정) |
| `ios/GildongmuKit/.../CongestionService.swift` 외 | iOS |
| `src/lib/chat/{declarations,router,sources}.ts` | 20번째 도구(수정) |
| `packages/{cli,mcp}/...` | 카탈로그·포매터 + D1 편승(수정) |

---

## Task 1: seed 빌드 스크립트

**Files**
- Create: `scripts/build-congestion-areas.mjs`
- Create: `src/lib/providers/data/congestion-areas.json` (스크립트 산출물)
- Test: `scripts/__tests__/build-congestion-areas.test.ts`

**Interfaces**
- Produces: seed JSON `{ generatedAt: string, areas: Array<{ code: string; name: string; c: [number, number]; pts: Array<[number, number]> }> }`
- Produces: `export function validateAreas(areas)` — 가드를 순수 함수로 분리해 테스트 가능하게

- [ ] **Step 1: 가드 함수의 실패 테스트를 쓴다**

```ts
// scripts/__tests__/build-congestion-areas.test.ts
import { describe, it, expect } from "vitest";
import { validateAreas } from "../build-congestion-areas.mjs";

const ok = Array.from({ length: 120 }, (_, i) => ({
  code: `POI${String(i + 1).padStart(3, "0")}`,
  name: `영역${i}`,
  c: [37.4988, 127.0276] as [number, number],
  pts: Array.from({ length: 20 }, () => [37.4988, 127.0276] as [number, number]),
}));
// 강남역 golden을 만족시키는 항목을 하나 심는다
ok[13] = { code: "POI014", name: "강남역", c: [37.4988, 127.0276], pts: [[37.4988, 127.0276]] };

describe("seed 무결성 가드", () => {
  it("정상 입력은 통과한다", () => {
    expect(() => validateAreas(ok)).not.toThrow();
  });
  it("영역 수가 100 미만이면 abort", () => {
    expect(() => validateAreas(ok.slice(0, 99))).toThrow(/영역 수/);
  });
  it("서울 bbox를 벗어난 지점이 있으면 abort", () => {
    const bad = structuredClone(ok);
    bad[0].pts.push([35.1, 129.0]); // 부산
    expect(() => validateAreas(bad)).toThrow(/bbox/);
  });
  it("강남역 golden에서 500m 넘게 벗어나면 abort", () => {
    const bad = structuredClone(ok);
    bad[13].c = [37.55, 126.98]; // 시청 부근
    expect(() => validateAreas(bad)).toThrow(/강남역/);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run scripts/__tests__/build-congestion-areas.test.ts` → 모듈 없음으로 FAIL

- [ ] **Step 3: 스크립트 구현**

`POI001`~`POI131`을 동시성 6으로 훑어 `CITYDATA.SUB_STTS`(`SUB_STN_X/Y`)·`BUS_STN_STTS`(`BUS_STN_X/Y`)에서 지점을 모은다. `CITYDATA` 부재는 공백 코드라 건너뛴다(오류 아님). 좌표는 소수 6자리 절단. `validateAreas`는 위 4가드 + 총 지점 수 1,500 미만 abort.

- [ ] **Step 4: 테스트 통과 확인 + 실제 seed 생성** — `node scripts/build-congestion-areas.mjs` 실행 후 116영역·약 1,969지점인지 stdout으로 확인

- [ ] **Step 5: 커밋** — `git commit -- scripts/build-congestion-areas.mjs scripts/__tests__/build-congestion-areas.test.ts src/lib/providers/data/congestion-areas.json`

---

## Task 2: 순수 판정 함수

**Files**
- Create: `src/lib/congestion-area.ts`
- Test: `src/lib/__tests__/congestion-area.test.ts`

**Interfaces**
- Consumes: T1의 seed JSON
- Produces:
```ts
export interface CongestionArea { code: string; name: string; }
export const MATCH_RADIUS_METERS = 300;
export function findCongestionArea(lat: number, lng: number): CongestionArea | null;
```

- [ ] **Step 1: 실패 테스트** — 스펙 §1-4 8지점을 그대로 fixture로

```ts
it.each([
  ["길동 주택가", 37.5380, 127.1420, null],
  ["강동역", 37.5354, 127.1325, null],
  ["일산", 37.6584, 126.7700, null],
  ["강남역 11번 출구", 37.4979, 127.0276, "강남역"],
  ["성수동 카페거리", 37.5445, 127.0557, "성수카페거리"],
  ["여의도 IFC", 37.5254, 126.9256, "여의도"],
])("%s", (_, lat, lng, expected) => {
  expect(findCongestionArea(lat, lng)?.name ?? null).toBe(expected);
});

it("중첩 시 중심이 가장 가까운 영역을 고른다(잠실역 1번 출구)", () => {
  expect(findCongestionArea(37.5133, 127.1001)?.name).toBe("잠실역");
});
```

- [ ] **Step 2: 실패 확인**

- [ ] **Step 3: 구현** — 각 영역의 `pts` 최근접 거리(하버사인) ≤ `MATCH_RADIUS_METERS`인 후보를 모으고, 그중 `c`까지 거리 최소 1개 반환. 후보 없으면 null.

- [ ] **Step 4: 통과 확인 + 경계 테스트 추가** — 실제 seed의 한 지점에서 정확히 299m/301m 떨어진 좌표를 계산해 매칭·미매칭 확인

- [ ] **Step 5: 커밋**

---

## Task 3: provider (봉투 + 캐시)

**Files**
- Create: `src/lib/providers/seoul-congestion.ts`
- Test: `src/lib/providers/__tests__/seoul-congestion.test.ts`

**Interfaces**
- Produces:
```ts
export interface CongestionReading {
  level: string;        // AREA_CONGEST_LVL 원문(4단계 밖 값도 통과 — 스펙 §7)
  message: string;      // AREA_CONGEST_MSG 완성 문장
  asOf: string;         // PPLTN_TIME
  forecast: Array<{ time: string; level: string }>;  // 채팅 전용, UI 미표기
}
export function parseCongestion(raw: unknown): CongestionReading | null;  // 봉투 전용(테스트 대상)
export function loadCongestion(areaCode: string): Promise<CongestionReading | null>;
```

- [ ] **Step 1: 봉투 실패 테스트**

```ts
it("정상 배열을 읽는다", () => {
  const r = parseCongestion({ "SeoulRtd.citydata_ppltn": [{
    AREA_CONGEST_LVL: "붐빔", AREA_CONGEST_MSG: "사람들이 몰려있을…",
    PPLTN_TIME: "2026-08-01 13:40", FCST_YN: "Y",
    FCST_PPLTN: [{ FCST_TIME: "2026-08-01 15:00", FCST_CONGEST_LVL: "약간 붐빔" }],
  }] });
  expect(r?.level).toBe("붐빔");
  expect(r?.forecast).toHaveLength(1);
});
it("평면 키 오류 봉투는 throw(조회 실패와 영역 없음을 뭉개지 않는다)", () => {
  expect(() => parseCongestion({ "RESULT.CODE": "ERROR-500", "RESULT.MESSAGE": "서버 오류입니다." }))
    .toThrow(/ERROR-500/);
});
it("빈 배열은 null", () => {
  expect(parseCongestion({ "SeoulRtd.citydata_ppltn": [] })).toBeNull();
});
it("배열이 아니면 throw", () => {
  expect(() => parseCongestion({})).toThrow();
});
it("FCST_YN이 N이면 예보는 빈 배열", () => { /* FCST_PPLTN 부재 입력 */ });
```

- [ ] **Step 2: 실패 확인**

- [ ] **Step 3: 구현** — `fetch(BASE/{key}/json/citydata_ppltn/1/5/{areaCode}, { cache: "no-store" })`, `res.ok` 아니면 throw. `loadCongestion`은 `unstable_cache(fn, ["seoul-congestion", areaCode], { revalidate: 300 })`. 키 없으면 `null` 반환(호출 0회).

- [ ] **Step 4: 통과 확인**

- [ ] **Step 5: 커밋**

---

## Task 4: 서비스 진입점 + 라우트 + i18n 키 확정

**Files**
- Create: `src/lib/congestion.ts`
- Create: `src/app/api/congestion/nearby/route.ts`
- Create: `src/app/api/congestion/nearby/__tests__/route.test.ts`
- Modify: `messages/{ko,en,es,fr,it,ja}.json`
- Modify: `src/lib/types.ts`

**Interfaces**
- Produces:
```ts
// src/lib/congestion.ts
export interface CongestionResult { area: { code: string; name: string } & CongestionReading | null; }
export function findCongestionNear(lat: number, lng: number): Promise<CongestionResult>;
```
- Produces(라우트 응답): `{ area: null }` 또는 `{ area: { code, name, level, message, asOf } }` (**`forecast`는 라우트 응답에서 제외** — UI 미표기라 전송할 이유가 없다. 채팅은 서비스를 직접 호출하므로 예보를 본다)
- Produces(i18n, `congestion.*`): `heading`(이 지역 상황 = `weather.heading` 교체) · `label`(혼잡도) · `asOf`(기준 {time}) · `source`(출처 서울시 실시간 도시데이터)

- [ ] **Step 1: 라우트 실패 테스트** — 좌표 누락 400 · 부산 200 `outOfCoverage`(키 게이트 앞) · 키 없음 `{area:null}` · 영역 밖 `{area:null}` · provider throw 502 · 레이트리밋 429

- [ ] **Step 2: 실패 확인**

- [ ] **Step 3: 구현** — `findCongestionNear`는 `findCongestionArea`가 null이면 **provider를 호출하지 않고** `{area:null}` 반환(호출 0회를 테스트로 고정). 라우트는 `coord()` 헬퍼 사용.

- [ ] **Step 4: 통과 확인 + i18n 6개 언어 키 추가** — `weather.heading` 문구를 "이 지역 상황"류로 교체하고 `congestion.*` 4키 추가. `npm run test:run`의 `i18n-messages.test.ts` 통과 확인

- [ ] **Step 5: 커밋** — 여기까지가 인터페이스 고정. T5~T8은 이 스키마만 보면 된다.

---

## Task 5: 웹 UI (위임 가능)

**Files**
- Modify: `src/components/LocalConditions.tsx`
- Test: `src/components/__tests__/LocalConditions.test.tsx` (신규 또는 기존에 추가)

- [ ] **Step 1: 실패 테스트** — 등급어·문장 렌더 · `area:null`이면 줄 부재 · 인구수 문자열 미포함 · 혼잡도 `<p>` 안 `<span>` 0개 · 502여도 날씨·공기질은 살아남음(독립 fetch)

- [ ] **Step 2~4:** 기존 두 `useEffect`와 같은 형태로 세 번째 fetch 추가(`isOutOfCoverageBody` 처리 포함), `weather` `air` `congestion` 셋 다 null이면 `return null`. heading은 새 키.

- [ ] **Step 5: 커밋**

---

## Task 6: iOS (위임 가능)

**Files**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Models/*.swift`(`Congestion` 모델), `NearbyService.swift`(또는 대응 서비스)
- Modify: iOS의 `LocalConditions` 대응 화면
- Modify: `ios/i18n/ios-extra/*.json` → `Localizable.xcstrings` 재생성

- [ ] 웹과 같은 계약(`/api/congestion/nearby`)을 소비. `Coverage.swift` 선분기 유지. 인구수 미표기. 빌드 + xcstrings 키 린터 통과.

---

## Task 7: 채팅 도구 (위임 가능)

**Files**
- Modify: `src/lib/chat/declarations.ts` · `router.ts` · `sources.ts`

- [ ] `get_congestion` 추가(20번째). 게이트 `hasSeoulOpenDataKey`. 앵커 인식(`anchorOf(ctx)`) + `coverageGate`. **카드 없음**(산문 정본, `get_weather` 선례). `data`에 `forecast` 포함. 영역 밖이면 `{ data: { area: null } }`로 정직하게.

---

## Task 8: CLI/MCP + D1 편승 (위임 가능)

**Files**
- Modify: `packages/cli/src/lib/endpoint-catalog-shared.ts` · `packages/mcp/src/lib/endpoint-catalog-shared.ts`(byte 동일)
- Modify: `packages/cli/src/lib/formatters.ts` · `packages/cli/src/commands/nearby.ts`
- Modify: `packages/cli/src/commands/route.ts` (**D1 편승**)

- [ ] `congestion` 엔드포인트 + `formatCongestion` 등록(`formatter-coverage.test.ts` 통과).
- [ ] **D1**: `makeRoute("walk")`에 `accessible` 플래그를 배선한다. 카탈로그엔 이미 선언되어 있으므로 `args`에 `accessible: { type: "string", description: "true면 계단 회피 경로" }`를 더하고 `verb === "walk" && args.accessible === "true"`일 때만 `{ accessible: "true" }`를 넘긴다(그 외 값은 라우트가 400을 내므로 CLI에서 조용히 삼키지 않는다).
- [ ] 카운트 가드 테스트(`command-tree.test.ts`·`commands-nearby.test.ts`·`server.test.ts`) 갱신.

---

## Task 9: 문서 + 릴리스

- [ ] `CLAUDE.md` 통합 카탈로그에 혼잡도 행 추가(봉투 함정·판정 규칙·임계값 근거), 도구 19→20, `SEOUL_OPEN_DATA_KEY` 설명에 혼잡도 추가.
- [ ] `python sync_agent_docs.py` (워크스페이스 루트)
- [ ] `PROGRESS.md`에 마일스톤 기록, `docs/BACKLOG.md`에서 **E1 제거·D1 제거**.
- [ ] CLI 릴리스: 버전 4곳 동조(`packages/*/package.json` 2 + `src/index.ts` 2) → `cli-v0.7.0` 태그.

---

## 되돌아갈 조건

- seed 빌드가 116영역을 못 채우면(서울시가 구조를 바꿨으면) T1에서 멈추고 스펙 §1로 되돌아간다.
- 판정 함수가 8지점 fixture를 통과하지 못하면 임계값을 만지지 말고 **판정 축**을 다시 본다(스펙 §7).

# 길찾기 화면 재편 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장거리 도보 상세를 접고, 대중교통 대안을 축 기반으로 최대 5개까지 고르며, 도보 구간에 거리와 행선지를 실어 낭독한다.

**Architecture:** ODsay 정규화를 "정규화(전체) → 운행상태 강등(전체) → 선정(5) → 축 라벨" 순수 함수 파이프라인으로 바꾼다. 판정은 전부 서버가 하고 웹·iOS·CLI는 필드를 문구로 옮기기만 한다. 화면 재편은 기존 disclosure 관용구를 재사용한다.

**Tech Stack:** Next.js 16 / TypeScript / Vitest(웹) · SwiftUI / Swift Testing(iOS) · citty(CLI) · next-intl 6로케일

**설계 정본:** `docs/superpowers/specs/2026-08-07-directions-view-restructure-design.md` (이하 "spec"). 이 계획과 spec이 어긋나면 spec이 이긴다.

## Global Constraints

- **커밋 이메일** `engccer@gmail.com`. 커밋 메시지·주석·문서는 한국어, 변수·함수명은 영어.
- **`git add -A` 금지.** 의도 파일만 stage하고, 신규 파일은 `git add <경로> && git commit -m "..." -- <경로>`로 한 명령에 원자화한다(병렬 세션 index 흡수 차단).
- **em dash(`—`)·en dash(`–`) 금지.** 산문·UI 문구·커밋 메시지 전부. 대체는 콜론·쉼표·괄호·마침표.
- **UI 라벨에 이모지 금지.**
- **거리 표기는 `formatDistance`(웹 `src/lib/format.ts` ↔ Kit `Format.swift` ↔ CLI `formatters.ts` `dist()`)만 지난다.** 소수 km를 직접 조립하면 `src/lib/__tests__/format-drift.test.ts`가 전 소스를 스캔해 실패시킨다.
- **3-state 불변식**: "0/없음" ≠ "정보 없음" ≠ "조회 실패"를 뭉개지 않는다.
- **한 줄 = 한 접근성 객체**: 한 논리적 줄을 시각 스타일용 인라인 `<span>`으로 쪼개지 않는다. 합칠 땐 `joinText`(`src/lib/format.ts`), 구분자는 쉼표(가운뎃점 금지).
- **게이트**: `npm run test:run`(웹) · `npm run lint` · `npx tsc --noEmit` · Kit `swift test` · `node ios/scripts/messages-to-xcstrings.mjs app` 후 `node ios/scripts/check-xcstrings-keys.mjs`. **Vitest green은 타입 검사를 대신하지 않는다**(트랜스파일만 한다).
- **i18n 키를 더하면 6로케일(`messages/{ko,en,es,fr,it,ja}.json`) 전부**에 넣는다. `src/lib/__tests__/i18n-messages.test.ts`가 머지 게이트다.
- **iOS 문자열 카탈로그(`*.xcstrings`)를 손으로 편집하지 않는다.** `messages/*.json`이 정본이고 재생성이 수기 편집분을 조용히 지운다.

---

## File Structure

| 파일 | 책임 | 신규 |
|---|---|---|
| `src/lib/providers/odsay-envelope.ts` | ODsay error 봉투 2형(객체·배열) 판독, 경로 없음 코드 판정 | 신규 |
| `src/lib/providers/odsay-select.ts` | `selectTransitRoutes`·`annotateHighlights` 순수 함수 | 신규 |
| `src/lib/providers/odsay.ts` | 정규화(도보 거리·행선지 포함), 파이프라인 배선 | 수정 |
| `src/lib/types.ts` | `TransitLeg.distanceMeters`, `TransitRoute.highlight`·`displayIndex`·`routeKey`, `TransitRouteResult.totalCandidates` | 수정 |
| `src/lib/transit-alternative-name.ts` | 축·번호 → i18n 키·인자 매핑(웹 2개 소비자 공유) | 신규 |
| `src/components/TransitRouteBriefing.tsx` | 도보 구간 문장, `arrive` 조건부, 대안 이름 | 수정 |
| `src/components/DirectionsView.tsx` | 도보 접힘, 대안 이름·안내 버튼, `routeKey` 세션 추적 | 수정 |
| `ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift` | 신규 필드 디코딩 | 수정 |
| `ios/GildongmuKit/Sources/GildongmuKit/TransitAlternativeName.swift` | 축·번호 → 로컬라이즈 키 매핑(iOS 공유) | 신규 |
| `ios/Gildongmu/RouteBriefing.swift` | 도보 구간 문장, `arrive` 조건부 | 수정 |
| `ios/Gildongmu/Directions/DirectionsTabView.swift` | 도보 접힘, 대안 이름, `routeKey` 추적 | 수정 |
| `packages/cli/src/lib/formatters.ts` | 도보 구간 거리·행선지, 축 이름 | 수정 |
| `messages/{ko,en,es,fr,it,ja}.json` | 신규 문구 | 수정 |

**작업 순서의 근거(자율성 헌장 §구현 방식 판정):** Task 1~5는 **순차 의존**이다. provider 계약이 확정돼야 소비자의 인터페이스가 정해지므로 inline으로 간다. Task 6~9(웹·iOS·CLI 소비자)는 **서로 독립**이라 위임 가능하다. 혼합이 정상이며 마일스톤 전체를 한쪽으로 몰지 않는다.

---

## Task 1: ODsay error 봉투 2형 판독

**Files:**
- Create: `src/lib/providers/odsay-envelope.ts`
- Create: `src/lib/providers/__tests__/odsay-envelope.test.ts`

**Interfaces:**
- Produces: `readOdsayError(raw: unknown): { code: string; message: string } | null`, `isNoRouteError(code: string): boolean`

**배경(spec §3.3):** ODsay error는 경로 없음(`-98`)이 객체 `{code, msg}`로, 인증 실패(`500`)가 **배열** `[{code, message}]`로 온다. 현행 `data.error.code`는 배열에서 `undefined`라 코드 판정이 무력화된다. 무효 키도 **HTTP 200**이라 상태 코드로는 못 가른다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/providers/__tests__/odsay-envelope.test.ts
import { describe, expect, it } from "vitest";
import { isNoRouteError, readOdsayError } from "../odsay-envelope";

describe("readOdsayError", () => {
  it("객체 봉투에서 code와 msg를 읽는다", () => {
    expect(readOdsayError({ code: "-98", msg: "출, 도착지가 700m이내입니다." })).toEqual({
      code: "-98",
      message: "출, 도착지가 700m이내입니다.",
    });
  });

  it("배열 봉투에서 첫 원소의 code와 message를 읽는다", () => {
    // 실호출 확정(2026-08-07 무효 키): 인증 실패는 배열 + message 키
    expect(readOdsayError([{ code: "500", message: "[ApiKeyAuthFailed] ..." }])).toEqual({
      code: "500",
      message: "[ApiKeyAuthFailed] ...",
    });
  });

  it("숫자 code를 문자열로 정규화한다", () => {
    expect(readOdsayError({ code: -98, msg: "x" })?.code).toBe("-98");
  });

  it("error가 없거나 빈 배열이면 null", () => {
    expect(readOdsayError(undefined)).toBeNull();
    expect(readOdsayError(null)).toBeNull();
    expect(readOdsayError([])).toBeNull();
  });

  it("코드가 없으면 null이 아니라 빈 코드로 읽어 throw 경로로 보낸다", () => {
    // 모양을 모르는 오류를 "경로 없음"으로 오분류하지 않는다
    expect(readOdsayError({ msg: "알 수 없음" })).toEqual({ code: "", message: "알 수 없음" });
    expect(isNoRouteError("")).toBe(false);
  });
});

describe("isNoRouteError", () => {
  it("-98만 경로 없음으로 본다", () => {
    expect(isNoRouteError("-98")).toBe(true);
    expect(isNoRouteError("500")).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/providers/__tests__/odsay-envelope.test.ts`
Expected: FAIL (`Cannot find module '../odsay-envelope'`)

- [ ] **Step 3: 최소 구현**

```ts
// src/lib/providers/odsay-envelope.ts
/**
 * ODsay error 봉투 판독.
 *
 * ⚠ 봉투가 두 모양이다(2026-08-07 실호출 확정):
 *   객체: {code:"-98", msg:"출, 도착지가 700m이내입니다."}   경로 없음
 *   배열: [{code:"500", message:"[ApiKeyAuthFailed] ..."}]  인증 실패
 * 키 이름도 msg/message로 갈린다. 배열을 객체로 읽으면 code가 undefined가 되어
 * 코드 판정이 통째로 무력화되고, 배열 모양으로 경로 없음류가 오는 순간
 * 그것이 502 장애로 둔갑한다. 두 모양을 다 받는 것이 이 모듈의 존재 이유다.
 *
 * ⚠ 무효 키는 HTTP 200으로 온다. 상태 코드로 인증 실패를 가를 수 없다.
 */

/** "경로 없음"으로 graceful 처리할 코드. 관측된 것만 넣는다(추측 금지). */
const NO_ROUTE_CODES = new Set(["-98"]);

export function isNoRouteError(code: string): boolean {
  return NO_ROUTE_CODES.has(code);
}

export function readOdsayError(raw: unknown): { code: string; message: string } | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first || typeof first !== "object") return null;
  const rec = first as { code?: unknown; msg?: unknown; message?: unknown };
  const code = rec.code == null ? "" : String(rec.code);
  const message = String(rec.msg ?? rec.message ?? "");
  return { code, message };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/providers/__tests__/odsay-envelope.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/providers/odsay-envelope.ts src/lib/providers/__tests__/odsay-envelope.test.ts
git commit -m "feat(odsay): error 봉투 2형(객체·배열) 판독 함수

경로 없음(-98)은 객체 {code,msg}, 인증 실패(500)는 배열 [{code,message}]로
온다. 현행 data.error.code는 배열에서 undefined라 코드 판정이 무력화되며,
배열로 경로 없음류가 오면 502 장애로 둔갑한다." -- src/lib/providers/odsay-envelope.ts src/lib/providers/__tests__/odsay-envelope.test.ts
```

---

## Task 2: 타입 확장

**Files:**
- Modify: `src/lib/types.ts` (`TransitLeg`·`TransitRoute`·`TransitRouteResult`)

**Interfaces:**
- Produces: `TransitLeg.distanceMeters?: number`, `TransitRoute.routeKey: string`·`highlight?: TransitHighlight[]`·`displayIndex?: number`, `TransitRouteResult.totalCandidates: number`, `type TransitHighlight = "fastest" | "fewestTransfers"`

- [ ] **Step 1: 타입을 고친다**

```ts
// src/lib/types.ts — TransitLeg 안, toName 주석 교체 + 필드 추가
  /** 하차 정류장. 도보 구간에서는 "걸어서 도착할 곳"(뒤 첫 탑승 구간의 fromName) */
  toName?: string;
  /**
   * 도보 구간 거리(미터). ODsay subPath.distance.
   * ⚠ 3-state: 값이 없거나 유한한 0 이상 수가 아니면 **필드 자체를 싣지 않는다**.
   *   0으로 채우면 "정보 없음"이 "0m"로 둔갑한다. 탑승 구간에는 싣지 않는다
   *   (정거장 수가 이미 표현하며 낭독에 더할 값이 아니다).
   */
  distanceMeters?: number;
```

```ts
// src/lib/types.ts — TransitRoute 위에 추가
/** 대안 경로의 축. 한 경로가 둘 다일 수 있어 배열이다(spec §3.3) */
export type TransitHighlight = "fastest" | "fewestTransfers";
```

```ts
// src/lib/types.ts — TransitRoute 안, legs 아래에 추가
  legs: TransitLeg[];
  /**
   * 응답 안에서 유일한 경로 식별자(정규화 시점의 ODsay 인덱스 기반).
   * ⚠ 활성 안내 세션 추적·강제 펼침·포커스 복귀는 **배열 인덱스가 아니라 이 키로** 한다.
   *   강등 정렬·재조회로 표시 순서가 바뀌면 인덱스는 다른 경로를 가리킨다.
   */
  routeKey: string;
  /** 이 경로가 1순위보다 나은 축. 없으면 필드 부재(spec §3.3 3단계) */
  highlight?: TransitHighlight[];
  /** 축 라벨이 없는 대안의 표시 번호(1부터). 서버가 정해 3플랫폼 갈림을 막는다 */
  displayIndex?: number;
```

```ts
// src/lib/types.ts — TransitRouteResult
export interface TransitRouteResult {
  recommended: TransitRoute;
  alternatives: TransitRoute[];
  /**
   * 절단 전 후보 경로 총수(조용한 절단 금지). ODsay는 수도권 9개·부산 16개를
   * 주는데 5개만 표시하므로 그 사실이 API에 남아야 한다. UI 표기는 하지 않는다
   * (표기 심사는 "사용자 행동을 바꾸는가"이고 총수는 바꾸지 않는다).
   */
  totalCandidates: number;
}
```

- [ ] **Step 2: 타입 검사로 영향 범위를 드러낸다**

Run: `npx tsc --noEmit`
Expected: `routeKey`·`totalCandidates`가 필수라 `odsay.ts`와 테스트 fixture에서 오류가 난다. **이 오류 목록이 Task 3~5에서 고칠 지점의 정확한 목록이다.** 목록을 적어 둔다.

- [ ] **Step 3: 커밋(타입만, 빌드는 아직 깨진 상태)**

```bash
git commit -m "types(transit): 도보 거리·경로 축·안정 식별자·후보 총수 필드 추가" -- src/lib/types.ts
```

---

## Task 3: 정규화에 도보 거리·행선지와 안정 키를 싣는다

**Files:**
- Modify: `src/lib/providers/odsay.ts` (`OdsaySubPath`·`toLeg`·`toTransitRoute`·`normalizeOdsayRoute`)
- Create: `src/lib/providers/__tests__/odsay-normalize.test.ts`

**Interfaces:**
- Consumes: Task 1 `readOdsayError`·`isNoRouteError`, Task 2 타입
- Produces: `normalizeOdsayRoutes(data: OdsayResponse, opts?: { includeStops?: boolean }): TransitRoute[] | null`

**배경(spec §3.2·§7):** ODsay 도보 subPath는 `trafficType`·`distance`·`sectionTime` 3필드뿐이고 행선지 이름이 없다. 두 지역 25경로 실호출로 확정했다. 유도 규칙은 하나다: **도보 구간의 `toName` = 그 뒤 첫 탑승 구간의 `fromName`. 뒤에 탑승 구간이 없으면 설정하지 않는다.** 유도는 **환승 통로(`distance:0`) 필터링 뒤**의 배열에서 돈다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/providers/__tests__/odsay-normalize.test.ts
import { describe, expect, it } from "vitest";
import { normalizeOdsayRoutes } from "../odsay";

/** 자택 → 서울역 path[0] 실응답(2026-08-07 실호출) */
const SUBWAY_ONLY = {
  pathType: 1,
  info: { totalTime: 45, payment: 1750, firstStartStation: "길동", lastEndStation: "서울역" },
  subPath: [
    { trafficType: 3, distance: 178, sectionTime: 3 },
    { trafficType: 1, distance: 14200, sectionTime: 26, startName: "길동", endName: "동대문역사문화공원", stationCount: 13, lane: [{ name: "수도권 5호선" }], wayCode: 1 },
    { trafficType: 3, distance: 0, sectionTime: 3 },
    { trafficType: 1, distance: 3600, sectionTime: 7, startName: "동대문역사문화공원", endName: "서울역", stationCount: 4, lane: [{ name: "수도권 4호선" }], wayCode: 2 },
    { trafficType: 3, distance: 221, sectionTime: 3 },
  ],
};

/** 같은 응답 p6: 버스와 지하철 혼합(중간 도보가 버스 하차 → 지하철 승차) */
const MIXED = {
  pathType: 3,
  info: { totalTime: 62, payment: 1750, firstStartStation: "길동역1번출구", lastEndStation: "서울역" },
  subPath: [
    { trafficType: 3, distance: 182, sectionTime: 3 },
    { trafficType: 2, distance: 5000, sectionTime: 20, startName: "길동역1번출구", endName: "동대문구청.용두동주민센터", stationCount: 15, lane: [{ busNo: "130", busLocalBlID: "B1", busCityCode: 1000 }] },
    { trafficType: 3, distance: 371, sectionTime: 6 },
    { trafficType: 1, distance: 4000, sectionTime: 10, startName: "제기동", endName: "서울역", stationCount: 6, lane: [{ name: "수도권 1호선" }], wayCode: 2 },
    { trafficType: 3, distance: 198, sectionTime: 3 },
  ],
};

const wrap = (paths: unknown[]) => ({ result: { path: paths } }) as never;

describe("normalizeOdsayRoutes 도보 구간", () => {
  it("첫 도보의 행선지는 다음 탑승 구간의 승차역이다", () => {
    const legs = normalizeOdsayRoutes(wrap([SUBWAY_ONLY]))![0].legs;
    expect(legs[0]).toMatchObject({ mode: "walk", minutes: 3, distanceMeters: 178, toName: "길동" });
  });

  it("혼합 경로의 중간 도보는 다음 지하철 승차역을 가리킨다", () => {
    // 버스 하차지(동대문구청)에서 제기동역까지 371m 걷는 구간
    const legs = normalizeOdsayRoutes(wrap([MIXED]))![0].legs;
    const mid = legs.filter((l) => l.mode === "walk")[1];
    expect(mid).toMatchObject({ distanceMeters: 371, toName: "제기동" });
  });

  it("마지막 도보에는 행선지를 붙이지 않는다", () => {
    const legs = normalizeOdsayRoutes(wrap([SUBWAY_ONLY]))![0].legs;
    const last = legs[legs.length - 1];
    expect(last.mode).toBe("walk");
    expect(last.distanceMeters).toBe(221);
    expect(last.toName).toBeUndefined();
  });

  it("환승 통로(0m 도보)는 leg에서 빠지고 유도는 그 뒤 배열에서 돈다", () => {
    const legs = normalizeOdsayRoutes(wrap([SUBWAY_ONLY]))![0].legs;
    expect(legs.filter((l) => l.mode === "walk")).toHaveLength(2);
    // 0m 도보가 남아 있었다면 첫 도보의 toName이 "동대문역사문화공원"이 됐을 것
    expect(legs[0].toName).toBe("길동");
  });

  it("거리가 없거나 비수치면 필드를 싣지 않는다(3-state)", () => {
    const noDist = { ...SUBWAY_ONLY, subPath: [{ trafficType: 3, sectionTime: 3 }, ...SUBWAY_ONLY.subPath.slice(1)] };
    const bad = { ...SUBWAY_ONLY, subPath: [{ trafficType: 3, distance: -1, sectionTime: 3 }, ...SUBWAY_ONLY.subPath.slice(1)] };
    expect(normalizeOdsayRoutes(wrap([noDist]))![0].legs[0].distanceMeters).toBeUndefined();
    expect(normalizeOdsayRoutes(wrap([bad]))![0].legs[0].distanceMeters).toBeUndefined();
  });

  it("탑승 구간에는 거리를 싣지 않는다", () => {
    const legs = normalizeOdsayRoutes(wrap([SUBWAY_ONLY]))![0].legs;
    expect(legs.find((l) => l.mode === "subway")!.distanceMeters).toBeUndefined();
  });
});

describe("normalizeOdsayRoutes 봉투 3-state", () => {
  it("전체 경로를 정규화하고 routeKey를 원본 순서로 부여한다", () => {
    const routes = normalizeOdsayRoutes(wrap([SUBWAY_ONLY, MIXED]))!;
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.routeKey)).toEqual(["p0", "p1"]);
  });

  it("경로 없음 코드는 null(graceful)", () => {
    expect(normalizeOdsayRoutes({ error: { code: "-98", msg: "x" } } as never)).toBeNull();
  });

  it("배열 봉투의 인증 실패는 throw", () => {
    expect(() =>
      normalizeOdsayRoutes({ error: [{ code: "500", message: "[ApiKeyAuthFailed]" }] } as never),
    ).toThrow(/ODsay/);
  });

  it("path가 빈 배열이면 null(진짜 0건)", () => {
    expect(normalizeOdsayRoutes(wrap([]))).toBeNull();
  });

  it("result나 path가 없으면 throw (조회 실패를 0건으로 뭉개지 않는다)", () => {
    expect(() => normalizeOdsayRoutes({} as never)).toThrow(/스키마/);
    expect(() => normalizeOdsayRoutes({ result: {} } as never)).toThrow(/스키마/);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/providers/__tests__/odsay-normalize.test.ts`
Expected: FAIL (`normalizeOdsayRoutes is not a function`)

- [ ] **Step 3: 구현**

`src/lib/providers/odsay.ts`에서:

```ts
// 상단 import에 추가
import { isNoRouteError, readOdsayError } from "./odsay-envelope";
```

```ts
// OdsayResponse의 error 타입을 unknown으로 넓힌다(봉투 2형은 판독 함수가 흡수)
export interface OdsayResponse {
  result?: { path?: OdsayPath[] };
  /** ⚠ 객체와 배열 두 모양으로 온다. 직접 읽지 말고 readOdsayError를 쓴다 */
  error?: unknown;
}
```

```ts
/** 유한한 0 이상 수만 통과. 그 외는 undefined(3-state: 0으로 채우지 않는다) */
function walkDistance(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return undefined;
  return v;
}
```

`toLeg`의 도보 분기를 교체한다:

```ts
  if (sp.trafficType === 3) {
    const distanceMeters = walkDistance(sp.distance);
    // toName은 toTransitRoute가 뒤 첫 탑승 구간에서 유도해 채운다
    return { mode: "walk", minutes, ...(distanceMeters != null ? { distanceMeters } : {}) };
  }
```

`toTransitRoute`에 유도 단계와 `routeKey`를 더한다(기존 `legs` 계산 직후):

```ts
function toTransitRoute(path: OdsayPath, includeStops: boolean, routeKey: string): TransitRoute {
  const legs = path.subPath
    .filter((sp) => !(sp.trafficType === 3 && (sp.distance ?? 0) === 0))
    .map((sp) => toLeg(sp, includeStops));

  // 도보 구간의 행선지 유도: 그 뒤 첫 탑승 구간의 fromName.
  // ⚠ 환승 통로 필터 **뒤**의 배열에서 돈다. 필터 전에 돌면 0m 통로가 사이에 끼어
  //   첫 도보가 환승역을 가리킨다. 뒤에 탑승 구간이 없으면(마지막 도보) 설정하지
  //   않고, 그 자리는 소비자가 목적지 의미로 채운다(spec §4.3).
  for (let i = 0; i < legs.length; i++) {
    if (legs[i].mode !== "walk") continue;
    const next = legs.slice(i + 1).find((l) => l.mode !== "walk");
    if (next?.fromName) legs[i] = { ...legs[i], toName: next.fromName };
  }

  const boardCount = legs.filter((l) => l.mode !== "walk").length;
  const walkMinutes = path.subPath
    .filter((sp) => sp.trafficType === 3)
    .reduce((sum, sp) => sum + (sp.sectionTime ?? 0), 0);
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
    routeKey,
  };
}
```

`normalizeOdsayRoute`를 `normalizeOdsayRoutes`로 교체한다:

```ts
/**
 * ODsay 응답 → 전체 TransitRoute 배열. 경로 없음이면 null.
 *
 * ⚠ 3-state: "경로 없음"(null)과 "조회 실패"(throw)를 가른다. 종전
 *   `data.result?.path ?? []`는 result 자체가 없는 응답을 "경로 없음"으로 바꿔
 *   장애를 사용자에게 "대중교통 경로가 없습니다"로 전달했다.
 */
export function normalizeOdsayRoutes(
  data: OdsayResponse,
  opts?: { includeStops?: boolean },
): TransitRoute[] | null {
  const err = readOdsayError(data.error);
  if (err) {
    if (isNoRouteError(err.code)) return null;
    throw new Error(`ODsay 길찾기 오류: ${err.code} ${err.message}`);
  }
  const paths = data.result?.path;
  if (!Array.isArray(paths)) {
    throw new Error("ODsay 응답 스키마 위반: result.path가 배열이 아닙니다");
  }
  if (paths.length === 0) return null;
  return paths.map((p, i) => toTransitRoute(p, opts?.includeStops === true, `p${i}`));
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/providers/__tests__/odsay-normalize.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/providers/__tests__/odsay-normalize.test.ts
git commit -m "feat(odsay): 도보 구간에 거리·행선지, 경로에 안정 키

도보 subPath는 3필드뿐이라 행선지를 뒤 첫 탑승 구간에서 유도한다.
유도는 환승 통로 필터 뒤 배열에서 돌아야 첫 도보가 환승역을 가리키지
않는다. 거리는 3-state를 지켜 결측·비수치면 필드를 싣지 않는다.
result 누락을 0건으로 뭉개던 3-state 위반도 함께 고친다." -- src/lib/providers/odsay.ts src/lib/providers/__tests__/odsay-normalize.test.ts
```

---

## Task 4: 선정과 축 라벨 (순수 함수)

**Files:**
- Create: `src/lib/providers/odsay-select.ts`
- Create: `src/lib/providers/__tests__/odsay-select.test.ts`

**Interfaces:**
- Consumes: Task 2 타입
- Produces: `MAX_TRANSIT_ROUTES = 5`, `selectTransitRoutes(routes: TransitRoute[]): TransitRoute[]`, `annotateHighlights(selected: TransitRoute[], totalCandidates: number): TransitRouteResult`

**배경(spec §3.3):** 선정과 라벨을 가르는 이유는 강등이 **1순위 자체를 바꾸기** 때문이다. 라벨을 먼저 붙이면 승격된 경로가 렌더되지 않는 자리에서 라벨을 들고 있고 남은 대안의 축은 사라진 기준으로 계산된 값이 된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/lib/providers/__tests__/odsay-select.test.ts
import { describe, expect, it } from "vitest";
import type { TransitRoute } from "@/lib/types";
import { annotateHighlights, selectTransitRoutes } from "../odsay-select";

/** 최소 골격 경로 생성기. serviceStatus는 탑승 leg에 싣는다 */
function route(
  key: string,
  totalMinutes: number,
  transfers: number,
  status: "running" | "outside" | "unknown" = "running",
): TransitRoute {
  return {
    summary: { totalMinutes, fare: 1500, transfers, walkMinutes: 5 },
    legs: [{ mode: "bus", minutes: totalMinutes, serviceStatus: status }],
    routeKey: key,
  };
}

describe("selectTransitRoutes", () => {
  it("1순위 + 축 경로 + 정렬순 채움으로 5개까지 고른다", () => {
    // 실측 구조(길동→서울역): 무환승 370번이 7번째라 앞 3개로는 도달 불가
    const routes = [
      route("p0", 45, 1), route("p1", 52, 1), route("p2", 53, 1),
      route("p3", 54, 2), route("p4", 62, 1), route("p5", 55, 2),
      route("p6", 62, 1), route("p7", 71, 0), route("p8", 57, 2),
    ];
    const keys = selectTransitRoutes(routes).map((r) => r.routeKey);
    expect(keys[0]).toBe("p0");
    expect(keys).toContain("p7"); // 무환승이 축으로 뽑힌다
    expect(keys).toHaveLength(5);
  });

  it("운행 밖 경로는 축 후보에서 빠진다", () => {
    const routes = [
      route("p0", 45, 1), route("p1", 50, 1), route("p2", 51, 1),
      route("p3", 52, 1), route("p4", 53, 1),
      route("p5", 71, 0, "outside"), // 무환승이지만 운행 종료
    ];
    expect(selectTransitRoutes(routes).map((r) => r.routeKey)).not.toContain("p5");
  });

  it("후보가 5개 미만이면 있는 만큼만", () => {
    expect(selectTransitRoutes([route("p0", 20, 0), route("p1", 25, 0)])).toHaveLength(2);
  });

  it("경로가 하나면 그것만", () => {
    expect(selectTransitRoutes([route("p0", 20, 0)]).map((r) => r.routeKey)).toEqual(["p0"]);
  });

  it("1순위보다 나은 축이 없으면 정렬순으로만 채운다", () => {
    const routes = [route("p0", 10, 0), route("p1", 20, 0), route("p2", 30, 0)];
    expect(selectTransitRoutes(routes).map((r) => r.routeKey)).toEqual(["p0", "p1", "p2"]);
  });
});

describe("annotateHighlights", () => {
  it("1순위보다 빠르고 환승 적은 축에 라벨을 붙인다", () => {
    const result = annotateHighlights([route("p0", 45, 1), route("p1", 71, 0), route("p2", 40, 1)], 9);
    expect(result.alternatives[0].highlight).toEqual(["fewestTransfers"]);
    expect(result.alternatives[1].highlight).toEqual(["fastest"]);
    expect(result.totalCandidates).toBe(9);
  });

  it("한 경로가 두 축을 모두 만족하면 둘 다 싣는다", () => {
    const result = annotateHighlights([route("p0", 45, 1), route("p1", 30, 0)], 5);
    expect(result.alternatives[0].highlight).toEqual(["fewestTransfers", "fastest"]);
  });

  it("축 없는 대안에만 1부터 표시 번호를 준다", () => {
    const result = annotateHighlights([route("p0", 45, 1), route("p1", 71, 0), route("p2", 50, 1), route("p3", 52, 1)], 9);
    expect(result.alternatives[0].displayIndex).toBeUndefined(); // 축 경로
    expect(result.alternatives[1].displayIndex).toBe(1);
    expect(result.alternatives[2].displayIndex).toBe(2);
  });

  it("1순위가 이미 최단·최소환승이면 축 라벨이 없다", () => {
    const result = annotateHighlights([route("p0", 20, 0), route("p1", 30, 1)], 3);
    expect(result.alternatives[0].highlight).toBeUndefined();
    expect(result.alternatives[0].displayIndex).toBe(1);
  });

  it("강등이 1순위를 바꾼 뒤 축은 새 1순위 기준으로 계산된다", () => {
    // 강등 결과 p7(무환승 71분)이 1순위로 올라온 상태를 입력으로 준다.
    // 옛 1순위(p0 45분 환승1)는 이제 "가장 빠른 경로"여야 한다.
    const result = annotateHighlights([route("p7", 71, 0), route("p0", 45, 1)], 9);
    expect(result.recommended.routeKey).toBe("p7");
    expect(result.recommended.highlight).toBeUndefined(); // 1순위는 라벨을 갖지 않는다
    expect(result.alternatives[0].highlight).toEqual(["fastest"]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/providers/__tests__/odsay-select.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```ts
// src/lib/providers/odsay-select.ts
import type { TransitHighlight, TransitRoute, TransitRouteResult } from "../types";

/**
 * 대안 경로 선정과 축 라벨(spec §3.3).
 *
 * 파이프라인 순서가 계약이다: 정규화(전체) → 강등(전체) → **선정** → **라벨**.
 * 선정을 강등보다 앞에 두면 선정 밖의 유일한 운행 중 경로를 영영 못 본다.
 * 라벨을 선정보다 앞에 두면 강등이 1순위를 바꿨을 때 축의 기준점이 낡는다.
 */

/** 추천 1 + 대안 4. 접힘 버튼이 화면을 채우지 않는 선(위원장 판정) */
export const MAX_TRANSIT_ROUTES = 5;

/** 그 경로에 운행 종료가 확정된 탑승 구간이 있는가 */
function isOutside(route: TransitRoute): boolean {
  return route.legs.some((l) => l.serviceStatus === "outside");
}

/** pool에서 기준보다 나은 것 중 최소값을 가진 첫 경로(정렬 순서 보존) */
function pickBest(
  pool: TransitRoute[],
  value: (r: TransitRoute) => number,
  baseline: number,
): TransitRoute | undefined {
  let best: TransitRoute | undefined;
  for (const r of pool) {
    if (value(r) >= baseline) continue;
    if (!best || value(r) < value(best)) best = r;
  }
  return best;
}

const minutesOf = (r: TransitRoute) => r.summary.totalMinutes;
const transfersOf = (r: TransitRoute) => r.summary.transfers;

/**
 * 강등 정렬된 전체 경로에서 표시할 5개를 고른다.
 * 축 후보는 운행 종료가 아닌 경로로 제한한다 (권할 수 없는 경로를 권유 자리에
 * 올리지 않는다 — 접힌 라벨에는 운행 상태가 안 보인다).
 */
export function selectTransitRoutes(routes: TransitRoute[]): TransitRoute[] {
  if (routes.length <= 1) return routes.slice();
  const [base, ...pool] = routes;
  const axisPool = pool.filter((r) => !isOutside(r));
  const picked = [
    pickBest(axisPool, transfersOf, transfersOf(base)),
    pickBest(axisPool, minutesOf, minutesOf(base)),
  ].filter((r): r is TransitRoute => r != null);

  const selected: TransitRoute[] = [base];
  const seen = new Set([base.routeKey]);
  for (const r of picked) {
    if (seen.has(r.routeKey)) continue;
    seen.add(r.routeKey);
    selected.push(r);
  }
  for (const r of pool) {
    if (selected.length >= MAX_TRANSIT_ROUTES) break;
    if (seen.has(r.routeKey)) continue;
    seen.add(r.routeKey);
    selected.push(r);
  }
  return selected;
}

/**
 * 최종 순서가 확정된 뒤 1순위를 기준으로 축을 판정해 라벨과 표시 번호를 싣는다.
 * 1순위 자신은 라벨을 갖지 않는다(자기보다 나은 자기는 없다).
 */
export function annotateHighlights(
  selected: TransitRoute[],
  totalCandidates: number,
): TransitRouteResult {
  const [recommended, ...alternatives] = selected;
  const axisPool = alternatives.filter((r) => !isOutside(r));
  const fewest = pickBest(axisPool, transfersOf, transfersOf(recommended));
  const fastest = pickBest(axisPool, minutesOf, minutesOf(recommended));

  let nextIndex = 1;
  const annotated = alternatives.map((route) => {
    const highlight: TransitHighlight[] = [];
    if (fewest?.routeKey === route.routeKey) highlight.push("fewestTransfers");
    if (fastest?.routeKey === route.routeKey) highlight.push("fastest");
    if (highlight.length > 0) return { ...route, highlight };
    return { ...route, displayIndex: nextIndex++ };
  });

  return { recommended, alternatives: annotated, totalCandidates };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/providers/__tests__/odsay-select.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/providers/odsay-select.ts src/lib/providers/__tests__/odsay-select.test.ts
git commit -m "feat(odsay): 축 기반 대안 선정과 축 라벨 순수 함수

선정과 라벨을 가르는 이유는 강등이 1순위 자체를 바꾸기 때문이다.
라벨을 먼저 붙이면 승격된 경로가 렌더되지 않는 자리에서 라벨을 들고
있고 남은 대안의 축은 사라진 기준으로 계산된다.
축 후보는 운행 종료가 아닌 경로로 제한한다." -- src/lib/providers/odsay-select.ts src/lib/providers/__tests__/odsay-select.test.ts
```

---

## Task 5: 파이프라인 배선과 합성 테스트

**Files:**
- Modify: `src/lib/providers/odsay.ts` (`annotateServiceStatus` 시그니처, `getTransitRoute`)
- Modify: `src/lib/providers/__tests__/odsay-service-hours.test.ts` · `odsay-service-hours-failure.test.ts` (시그니처 변경 반영)
- Create: `src/lib/providers/__tests__/odsay-pipeline.test.ts`

**Interfaces:**
- Consumes: Task 3 `normalizeOdsayRoutes`, Task 4 `selectTransitRoutes`·`annotateHighlights`
- Produces: `annotateServiceStatus(routes: TransitRoute[], busHours, subwayHours, nowMinutes): TransitRoute[]` (반환 타입이 `TransitRouteResult`에서 배열로 바뀐다)

**왜 합성 테스트인가:** 순수 함수가 각각 통과해도 생산 코드가 `annotateHighlights`를 강등 앞에서 부르거나 반환값을 버릴 수 있다. 단계 호출 순서는 배선에서만 검증된다.

- [ ] **Step 1: 합성 테스트를 쓴다**

```ts
// src/lib/providers/__tests__/odsay-pipeline.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
vi.mock("../bus-service-hours", () => ({
  fetchServiceHoursMap: vi.fn(async () => new Map()),
}));
vi.mock("../subway-service-hours", () => ({
  fetchSubwayServiceHoursMap: vi.fn(async () => new Map()),
  subwayHoursKey: (r: { stationName: string; lineName: string; wayCode: number }) =>
    `${r.stationName}|${r.lineName}|${r.wayCode}`,
}));

import { getTransitRoute } from "../odsay";

/** ⚠ 화살표 한 줄로 쓰면 mock 자체가 반환되어 teardown으로 등록된다(중괄호 필수) */
beforeEach(() => {
  fetchMock.mockReset();
});

function busPath(minutes: number, boards: number) {
  const subPath: unknown[] = [{ trafficType: 3, distance: 100, sectionTime: 2 }];
  for (let i = 0; i < boards; i++) {
    subPath.push({
      trafficType: 2, distance: 1000, sectionTime: minutes, stationCount: 5,
      startName: `승차${i}`, endName: `하차${i}`,
      lane: [{ busNo: `${100 + i}`, busLocalBlID: `B${i}`, busCityCode: 1000 }],
    });
    if (i < boards - 1) subPath.push({ trafficType: 3, distance: 50, sectionTime: 1 });
  }
  subPath.push({ trafficType: 3, distance: 200, sectionTime: 3 });
  return { pathType: 2, info: { totalTime: minutes, payment: 1500 }, subPath };
}

function respond(paths: unknown[]) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ result: { path: paths } }),
  });
}

describe("getTransitRoute 파이프라인", () => {
  it("5개까지만 돌려주고 후보 총수를 보존한다", async () => {
    respond(Array.from({ length: 9 }, (_, i) => busPath(20 + i, 1)));
    const result = (await getTransitRoute({ origin: { lat: 37.5, lng: 127.1 }, dest: { lat: 37.55, lng: 126.97 } }))!;
    expect(1 + result.alternatives.length).toBe(5);
    expect(result.totalCandidates).toBe(9);
  });

  it("무환승 경로가 뒤에 있어도 대안에 오른다", async () => {
    const paths = [
      busPath(20, 2), busPath(22, 2), busPath(23, 2),
      busPath(24, 2), busPath(25, 2), busPath(26, 2),
      busPath(40, 1), // 무환승, 7번째
    ];
    respond(paths);
    const result = (await getTransitRoute({ origin: { lat: 37.5, lng: 127.1 }, dest: { lat: 37.55, lng: 126.97 } }))!;
    const labeled = result.alternatives.find((r) => r.highlight?.includes("fewestTransfers"));
    expect(labeled?.summary.transfers).toBe(0);
  });

  it("스키마 위반은 throw (0건으로 뭉개지 않는다)", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(
      getTransitRoute({ origin: { lat: 37.5, lng: 127.1 }, dest: { lat: 37.55, lng: 126.97 } }),
    ).rejects.toThrow(/스키마/);
  });

  it("경로 없음은 null", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ error: { code: "-98", msg: "x" } }) });
    expect(
      await getTransitRoute({ origin: { lat: 37.5, lng: 127.1 }, dest: { lat: 37.55, lng: 126.97 } }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/providers/__tests__/odsay-pipeline.test.ts`
Expected: FAIL (`totalCandidates` 없음 등)

- [ ] **Step 3: `annotateServiceStatus` 시그니처를 배열로 바꾼다**

`src/lib/providers/odsay.ts`에서 함수 끝부분만 교체한다(내부 `annotateRoute`·`routeRank`는 그대로):

```ts
export function annotateServiceStatus(
  routes: TransitRoute[],
  busHours: Map<string, ServiceHours>,
  subwayHours: Map<string, ServiceHours>,
  nowMinutes: number,
): TransitRoute[] {
  // ... hoursFor / annotateRoute / routeRank 기존 그대로 ...
  const all = routes.map(annotateRoute);
  // 안정 정렬이라 같은 rank 안에서는 ODsay 추천순이 보존된다
  return [...all].sort((a, b) => routeRank(a) - routeRank(b));
}
```

- [ ] **Step 4: `getTransitRoute`를 4단계로 배선한다**

```ts
  const data = (await res.json()) as OdsayResponse;
  // 0단계 정규화(전체). 봉투 3-state는 normalizeOdsayRoutes가 담당한다.
  const routes = normalizeOdsayRoutes(data, { includeStops: params.includeStops });
  if (!routes) return null;

  // 1단계 강등(전체). ⚠ 선정보다 **먼저** 돈다: 선정 밖의 유일한 운행 중
  // 경로를 못 보는 결함을 막는다. 시간표 조회는 노선·역 단위 중복 제거 +
  // 24시간 캐시라 전체 적용 비용이 방어할 값이 아니다(spec §3.3).
  const allLegs = routes.flatMap((r) => r.legs);
  const refs = allLegs.flatMap((l) =>
    l.serviceRouteId && l.serviceCityCode != null
      ? [{ localId: l.serviceRouteId, cityCode: l.serviceCityCode, routeNo: l.lineName ?? "" }]
      : [],
  );
  const subwayRefs = allLegs.flatMap((l) =>
    l.mode === "subway" && l.fromName && l.lineName && l.serviceWayCode != null
      ? [{ stationName: l.fromName, lineName: l.lineName, wayCode: l.serviceWayCode }]
      : [],
  );
  const [busHours, subwayHours] = await Promise.all([
    fetchServiceHoursMap(refs),
    fetchSubwayServiceHoursMap(subwayRefs),
  ]);
  const ranked = annotateServiceStatus(routes, busHours, subwayHours, kstNowMinutes(new Date()));

  // 2단계 선정 → 3단계 라벨. 순서를 바꾸면 축의 기준점이 낡는다.
  return annotateHighlights(selectTransitRoutes(ranked), ranked.length);
```

상단 import에 추가한다:

```ts
import { annotateHighlights, selectTransitRoutes } from "./odsay-select";
```

- [ ] **Step 5: 기존 service-hours 테스트를 새 시그니처로 고친다**

두 파일에서 `annotateServiceStatus({ recommended, alternatives }, ...)` 호출을 `annotateServiceStatus([recommended, ...alternatives], ...)`로 바꾸고, 반환값 단언을 `result.recommended` 대신 `result[0]`으로 바꾼다. fixture 경로 객체에는 `routeKey`를 더한다.

- [ ] **Step 6: 전 게이트를 돌린다**

Run: `npm run test:run && npx tsc --noEmit && npm run lint`
Expected: 전부 PASS. 실패하면 Task 2 Step 2에서 적어 둔 타입 오류 목록과 대조한다.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/providers/__tests__/odsay-pipeline.test.ts
git commit -m "feat(odsay): 강등을 전체 후보에 적용한 뒤 선정하도록 배선

선정을 강등보다 앞에 두면 선정 밖의 유일한 운행 중 경로를 영영 못 본다.
시간표 조회는 노선·역 단위 중복 제거와 24시간 캐시가 있어 전체 적용
비용이 정확성을 깎아 가며 방어할 값이 아니다(실측 상한 4콜에서 12콜).
합성 테스트로 단계 호출 순서를 못 박는다." -- src/lib/providers/odsay.ts src/lib/providers/__tests__/
```

---

## Task 6: i18n 문구 (6로케일)

**Files:**
- Modify: `messages/ko.json` · `en.json` · `es.json` · `fr.json` · `it.json` · `ja.json`

**Interfaces:**
- Produces: `route.transit.alternativeFastest`·`alternativeFewestTransfers`·`alternativeFastestFewestTransfers`·`legWalkTo`·`legWalkToNoDistance`·`legWalkToDest`·`legWalkToDestNoDistance`, `beacon.guideStartTransitAlt`(개정)

**주의:** `route.transit.legWalk`("도보 {minutes}분")는 **지우지 않는다**. 거리도 행선지도 없는 경우의 폴백으로 남는다.

- [ ] **Step 1: ko를 넣는다**

`messages/ko.json`의 `route.transit`에 추가하고 `beacon.guideStartTransitAlt`를 교체한다:

```json
"alternativeFastest": "가장 빠른 경로",
"alternativeFewestTransfers": "환승이 가장 적은 경로",
"alternativeFastestFewestTransfers": "가장 빠르고 환승도 가장 적은 경로",
"legWalkTo": "{name}까지 도보 {minutes}분, {distance}",
"legWalkToNoDistance": "{name}까지 도보 {minutes}분",
"legWalkToDest": "목적지까지 도보 {minutes}분, {distance}",
"legWalkToDestNoDistance": "목적지까지 도보 {minutes}분"
```

```json
"guideStartTransitAlt": "{name} 안내 시작"
```

- [ ] **Step 2: 나머지 5로케일을 넣는다**

en:
```json
"alternativeFastest": "Fastest route",
"alternativeFewestTransfers": "Fewest transfers",
"alternativeFastestFewestTransfers": "Fastest with fewest transfers",
"legWalkTo": "Walk {minutes} min to {name}, {distance}",
"legWalkToNoDistance": "Walk {minutes} min to {name}",
"legWalkToDest": "Walk {minutes} min to the destination, {distance}",
"legWalkToDestNoDistance": "Walk {minutes} min to the destination",
"guideStartTransitAlt": "Start guidance: {name}"
```

es:
```json
"alternativeFastest": "Ruta más rápida",
"alternativeFewestTransfers": "Menos transbordos",
"alternativeFastestFewestTransfers": "La más rápida y con menos transbordos",
"legWalkTo": "Camina {minutes} min hasta {name}, {distance}",
"legWalkToNoDistance": "Camina {minutes} min hasta {name}",
"legWalkToDest": "Camina {minutes} min hasta el destino, {distance}",
"legWalkToDestNoDistance": "Camina {minutes} min hasta el destino",
"guideStartTransitAlt": "Iniciar guía: {name}"
```

fr:
```json
"alternativeFastest": "Itinéraire le plus rapide",
"alternativeFewestTransfers": "Le moins de correspondances",
"alternativeFastestFewestTransfers": "Le plus rapide avec le moins de correspondances",
"legWalkTo": "Marchez {minutes} min jusqu'à {name}, {distance}",
"legWalkToNoDistance": "Marchez {minutes} min jusqu'à {name}",
"legWalkToDest": "Marchez {minutes} min jusqu'à la destination, {distance}",
"legWalkToDestNoDistance": "Marchez {minutes} min jusqu'à la destination",
"guideStartTransitAlt": "Démarrer le guidage : {name}"
```

it:
```json
"alternativeFastest": "Percorso più veloce",
"alternativeFewestTransfers": "Meno cambi",
"alternativeFastestFewestTransfers": "Il più veloce con meno cambi",
"legWalkTo": "Cammina {minutes} min fino a {name}, {distance}",
"legWalkToNoDistance": "Cammina {minutes} min fino a {name}",
"legWalkToDest": "Cammina {minutes} min fino alla destinazione, {distance}",
"legWalkToDestNoDistance": "Cammina {minutes} min fino alla destinazione",
"guideStartTransitAlt": "Avvia la guida: {name}"
```

ja:
```json
"alternativeFastest": "最速ルート",
"alternativeFewestTransfers": "乗り換えが最も少ないルート",
"alternativeFastestFewestTransfers": "最速で乗り換えも最少のルート",
"legWalkTo": "{name}まで徒歩{minutes}分、{distance}",
"legWalkToNoDistance": "{name}まで徒歩{minutes}分",
"legWalkToDest": "目的地まで徒歩{minutes}分、{distance}",
"legWalkToDestNoDistance": "目的地まで徒歩{minutes}分",
"guideStartTransitAlt": "案内開始: {name}"
```

- [ ] **Step 3: 키 일관성 게이트를 돌린다**

Run: `npx vitest run src/lib/__tests__/i18n-messages.test.ts`
Expected: PASS

- [ ] **Step 4: iOS 카탈로그를 재생성한다**

Run: `node ios/scripts/messages-to-xcstrings.mjs app && node ios/scripts/check-xcstrings-keys.mjs`
Expected: 재생성 성공 + 키 검사 PASS

- [ ] **Step 5: 커밋**

```bash
git commit -m "i18n(transit): 대안 축 이름과 도보 구간 문구 6로케일 추가" -- messages/ ios/Gildongmu/
```

---

## Task 7: 웹 표시 계층

**Files:**
- Create: `src/lib/transit-alternative-name.ts`
- Modify: `src/components/TransitRouteBriefing.tsx:230-300`(`TransitRouteResult` 렌더), `:180-220`(채팅 카드 대안 disclosure)
- Create: `src/components/__tests__/TransitRouteBriefing.test.tsx`

**Interfaces:**
- Consumes: Task 2 타입, Task 6 문구
- Produces: `alternativeNameKey(route): { key: string; values: Record<string, string|number> }`

**함정:** 대안 disclosure가 **두 곳**에 있다(`DirectionsView`와 채팅 카드 `TransitRouteBriefing`). 이름 산출을 공유 함수로 두지 않으면 갈린다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```tsx
// src/components/__tests__/TransitRouteBriefing.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { alternativeNameKey } from "@/lib/transit-alternative-name";
import type { TransitRoute } from "@/lib/types";

const base: TransitRoute = {
  summary: { totalMinutes: 40, fare: 1500, transfers: 0, walkMinutes: 5 },
  legs: [],
  routeKey: "p1",
};

describe("alternativeNameKey", () => {
  it("두 축이면 조합 키", () => {
    expect(alternativeNameKey({ ...base, highlight: ["fewestTransfers", "fastest"] }).key)
      .toBe("alternativeFastestFewestTransfers");
  });
  it("환승 축만이면 환승 키", () => {
    expect(alternativeNameKey({ ...base, highlight: ["fewestTransfers"] }).key)
      .toBe("alternativeFewestTransfers");
  });
  it("시간 축만이면 시간 키", () => {
    expect(alternativeNameKey({ ...base, highlight: ["fastest"] }).key).toBe("alternativeFastest");
  });
  it("축이 없으면 번호 키에 displayIndex를 넘긴다", () => {
    expect(alternativeNameKey({ ...base, displayIndex: 2 })).toEqual({
      key: "alternativeHeading",
      values: { index: 2 },
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/components/__tests__/TransitRouteBriefing.test.tsx`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 이름 함수를 만든다**

```ts
// src/lib/transit-alternative-name.ts
import type { TransitRoute } from "./types";

/**
 * 대안 경로의 표시 이름 키. disclosure 라벨·안내 시작 버튼·스크린 리더 로터가
 * 같은 이름을 써야 하므로 산출을 한 곳에 모은다.
 * ⚠ 대안 disclosure는 길찾기 뷰와 채팅 카드 두 곳에 있다. 이 함수를 공유하지
 *   않으면 두 화면의 이름이 갈린다.
 */
export function alternativeNameKey(route: TransitRoute): {
  key: string;
  values: Record<string, string | number>;
} {
  const h = route.highlight ?? [];
  const fast = h.includes("fastest");
  const few = h.includes("fewestTransfers");
  if (fast && few) return { key: "alternativeFastestFewestTransfers", values: {} };
  if (few) return { key: "alternativeFewestTransfers", values: {} };
  if (fast) return { key: "alternativeFastest", values: {} };
  return { key: "alternativeHeading", values: { index: route.displayIndex ?? 1 } };
}
```

- [ ] **Step 4: 도보 구간 문장과 `arrive` 조건부를 고친다**

`TransitRouteBriefing.tsx`의 `TransitRouteResult`에서 도보 분기를 교체한다:

```tsx
          if (leg.mode === "walk") {
            // 마지막 도보는 provider가 이름을 모른다. 소비자가 목적지 이름을
            // 알면 그것을, 모르면 "목적지까지"라는 의미를 쓴다(이름 부재와
            // 구간 의미 부재는 다른 층이다).
            const name = leg.toName ?? dest;
            const distance =
              leg.distanceMeters != null ? formatDistance(leg.distanceMeters) : null;
            const key = name
              ? distance ? "legWalkTo" : "legWalkToNoDistance"
              : distance ? "legWalkToDest" : "legWalkToDestNoDistance";
            return (
              <li key={i}>
                {t(key, { minutes: leg.minutes, ...(name ? { name } : {}), ...(distance ? { distance } : {}) })}
              </li>
            );
          }
```

`arrive` 문단을 조건부로 바꾼다:

```tsx
      {/* 마지막 구간이 도보면 그 문장이 이미 도착을 말한다. 하차역 이름으로
          "도착"을 덧붙이면 순서가 거꾸로다(도보는 하차역에서 목적지로 간다). */}
      {route.legs[route.legs.length - 1]?.mode !== "walk" && (
        <p className="mt-1 text-sm">
          {t.rich("arrive", {
            name: () => <span lang="ko">{route.summary.arriveName ?? dest}</span>,
          })}
        </p>
      )}
```

상단에 `import { formatDistance, joinText } from "@/lib/format";`가 있는지 확인하고 없으면 `formatDistance`를 추가한다.

- [ ] **Step 5: 채팅 카드의 대안 라벨을 공유 함수로 바꾼다**

`TransitRouteBriefing.tsx:180-220`의 disclosure 라벨에서 `t("alternativeHeading", { index: i + 1 })`를 다음으로 교체한다:

```tsx
                            {(() => {
                              const n = alternativeNameKey(alt);
                              return joinText(
                                t(n.key, n.values),
                                t("summary", { minutes: alt.summary.totalMinutes, fare: alt.summary.fare.toLocaleString(locale), transfers: alt.summary.transfers }),
                                alt.summary.walkMinutes > 0 ? t("walkSummary", { minutes: alt.summary.walkMinutes }) : null,
                              );
                            })()}
```

- [ ] **Step 6: 게이트**

Run: `npm run test:run && npx tsc --noEmit && npm run lint`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add src/lib/transit-alternative-name.ts src/components/__tests__/TransitRouteBriefing.test.tsx
git commit -m "feat(web): 도보 구간 문장, 대안 축 이름, 도착 문구 조건부

대안 disclosure가 길찾기 뷰와 채팅 카드 두 곳에 있어 이름 산출을 공유
함수로 모은다. 마지막 구간이 도보면 그 뒤 도착 문구는 순서가 거꾸로라
제거한다." -- src/lib/transit-alternative-name.ts src/components/TransitRouteBriefing.tsx src/components/__tests__/TransitRouteBriefing.test.tsx
```

---

## Task 8: 웹 길찾기 뷰 (도보 접힘 + 대안 + routeKey)

**Files:**
- Modify: `src/components/DirectionsView.tsx` (도보 섹션 `:790` 부근, 대안 `:805-864`)
- Modify: `src/components/__tests__/DirectionsGuideEntry.test.tsx` 또는 신규 `DirectionsWalkCollapse.test.tsx`

**Interfaces:**
- Consumes: Task 7 `alternativeNameKey`, Task 2 `routeKey`

**함정 넷(조사 실측):**
1. `walkAccessible` 초기값은 **lazy `useState`로 렌더 시점 동기 읽기**여야 한다. `useEffect`로 바꾸면 같은 커밋의 `?dir=` 동기화 effect가 먼저 그 파라미터를 URL에서 지워 항상 실패한다.
2. 계단 회피 토글은 조회 버튼과 `inFlight`/`genRef`를 **공유**한다. 이 공유가 교차 레이스를 구조적으로 막는 장치라 분리하지 않는다.
3. **"최근 장소" 직행 선택은 `onTextChange`를 거치지 않는다.** 상태 초기화를 `onResolve`에도 걸어야 한다.
4. `activeGuideAlt`를 인덱스에서 `routeKey`로 바꾼다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```tsx
// src/components/__tests__/DirectionsWalkCollapse.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { shouldCollapseWalk } from "@/lib/walk-collapse";

describe("shouldCollapseWalk", () => {
  it("표시 분 값이 30을 넘으면 접는다", () => {
    expect(shouldCollapseWalk(31 * 60)).toBe(true);
  });
  it("정확히 30분이면 펼친다", () => {
    expect(shouldCollapseWalk(30 * 60)).toBe(false);
  });
  it("판정은 표시와 같은 분 값을 쓴다(초 단위로 가르지 않는다)", () => {
    // 30분 1초는 반올림하면 30분이라 라벨이 "약 30분"이다. 접으면 모순이다.
    expect(shouldCollapseWalk(30 * 60 + 1)).toBe(false);
    expect(shouldCollapseWalk(30 * 60 + 31)).toBe(true); // 반올림하면 31분
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/components/__tests__/DirectionsWalkCollapse.test.tsx`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 판정 함수를 만든다**

```ts
// src/lib/walk-collapse.ts
/**
 * 장거리 도보 상세를 접을지 판정한다(spec §4.4).
 *
 * ⚠ 판정과 표시가 같은 분 값을 써야 한다. 초 단위로 가르면 "약 30분"으로
 *   표시되는 경로가 접혀 사용자가 경계를 설명할 수 없다.
 */
export const WALK_COLLAPSE_MINUTES = 30;

export function shouldCollapseWalk(durationSeconds: number): boolean {
  return Math.round(durationSeconds / 60) > WALK_COLLAPSE_MINUTES;
}
```

- [ ] **Step 4: 도보 섹션에 disclosure를 넣는다**

`DirectionsView.tsx`에 상태를 더한다(`stepFreeEnabled` 근처):

```tsx
  /**
   * 도보 상세 펼침 상태. null = 자동(문턱 판정), boolean = 사용자 조작.
   * 사용자 조작이 자동 판정을 이긴다: 계단 회피로 경로가 바뀌며 문턱을
   * 넘나들 때 펼쳐 둔 것이 닫히면 조작이 배신당한다.
   */
  const [walkExpanded, setWalkExpanded] = useState<boolean | null>(null);
```

`outcome.kind === "done" && outcome.mode === "walk"` 분기를 교체한다:

```tsx
                {outcome.kind === "done" && outcome.mode === "walk" && (() => {
                  const collapsible = shouldCollapseWalk(outcome.result.durationSeconds);
                  const expanded = walkExpanded ?? !collapsible;
                  if (!collapsible) return <WalkRouteResult briefing={outcome.result} t={tPed} />;
                  return (
                    <div className="mt-2">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setWalkExpanded(!expanded)}
                        className="min-h-11 text-left text-sm text-blue-700 underline dark:text-blue-300"
                      >
                        {tPed("summary", {
                          distance: formatDistance(outcome.result.distanceMeters),
                          minutes: Math.round(outcome.result.durationSeconds / 60),
                        })}
                      </button>
                      {/* 버튼이 발견 경로라 본문은 div(region·heading 부여 금지) */}
                      {expanded && <WalkRouteResult briefing={outcome.result} t={tPed} />}
                    </div>
                  );
                })()}
```

⚠ **계단 회피 토글과 `DistanceBeacon`은 이 블록 밖에 그대로 둔다.** 접힘 안에 넣으면 접힌 상태에서 도달할 수 없고, 재조회 후 도보 heading 포커스 이동이 접힌 대상을 향해 조용히 실패한다.

- [ ] **Step 5: 상태 전이를 건다**

`setResults(null)`을 부르는 모든 자리(조회 버튼, 종단점 편집 `onTextChange`, **`onResolve`**, 스왑)에 `setWalkExpanded(null)`을 함께 건다. `toggleStepFree`에는 **걸지 않는다**(보존이 계약이다).

- [ ] **Step 6: 대안 이름과 `routeKey`를 배선한다**

`activeGuideAlt`의 타입을 `number | null`에서 `string | null`(routeKey)로 바꾸고, `expandedAlts`를 `Set<number>`에서 `Set<string>`으로 바꾼다. 대안 렌더에서:

```tsx
                    {outcome.result.alternatives.map((alt) => {
                      const expanded = expandedAlts.has(alt.routeKey) || activeGuideAlt === alt.routeKey;
                      const n = alternativeNameKey(alt);
                      const name = tTransit(n.key, n.values);
                      // ... joinText(name, summary, walkSummary) ...
                      // 안내 버튼 라벨: tBeacon("guideStartTransitAlt", { name })
                      // onActiveChange: setActiveGuideAlt(active ? alt.routeKey : (prev) => prev === alt.routeKey ? null : prev)
                    })}
```

- [ ] **Step 7: 게이트**

Run: `npm run test:run && npx tsc --noEmit && npm run lint`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add src/lib/walk-collapse.ts src/components/__tests__/DirectionsWalkCollapse.test.tsx
git commit -m "feat(web): 장거리 도보 상세 접힘, 대안 축 이름, routeKey 세션 추적

접히는 것은 상세뿐이고 계단 회피 토글과 안내 시작 버튼은 밖에 남는다.
접힘 안에 넣으면 접힌 상태에서 도달할 수 없고 재조회 후 포커스 이동이
조용히 실패한다. 사용자 조작이 자동 판정을 이긴다." -- src/lib/walk-collapse.ts src/components/DirectionsView.tsx src/components/__tests__/DirectionsWalkCollapse.test.tsx
```

---

## Task 9: iOS

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift`
- Create: `ios/GildongmuKit/Sources/GildongmuKit/TransitAlternativeName.swift`
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/TransitAlternativeNameTests.swift`
- Modify: `ios/Gildongmu/RouteBriefing.swift:54-85`(`transitLegText`), `ios/Gildongmu/Directions/DirectionsTabView.swift:880-910`(대안), 도보 섹션

**Interfaces:**
- Consumes: Task 2 서버 필드, Task 6 문구
- Produces: `TransitAlternativeName.key(for:) -> (key: String, index: Int?)`

**함정 셋(조사 실측):**
1. `.accessibilityFocused($binding, equals:)`에 **`Bool` 바인딩을 여러 행에 붙이지 않는다.** 항목 정체성 옵셔널 바인딩이 정본.
2. 대안 개수가 늘어도 **세션 활성 대안의 접힘 클릭은 무시**한다(접힘 unmount가 세션을 죽인다).
3. `GuideStartButton.transitAlt(Int)`를 **`transitAlt(String)`(routeKey)로 바꾼다.** 표시 번호와 배열 인덱스가 다른 좌표계라 둘 다 포커스 키로 쓰지 않는다.

- [ ] **Step 1: Kit 테스트를 쓴다**

```swift
// ios/GildongmuKit/Tests/GildongmuKitTests/TransitAlternativeNameTests.swift
import Testing
@testable import GildongmuKit

@Suite("대안 경로 표시 이름")
struct TransitAlternativeNameTests {
    @Test("두 축이면 조합 키")
    func bothAxes() {
        #expect(TransitAlternativeName.key(highlight: ["fewestTransfers", "fastest"], displayIndex: nil).key
                == "route.transit.alternativeFastestFewestTransfers")
    }
    @Test("환승 축만")
    func fewest() {
        #expect(TransitAlternativeName.key(highlight: ["fewestTransfers"], displayIndex: nil).key
                == "route.transit.alternativeFewestTransfers")
    }
    @Test("축 없으면 번호 키와 displayIndex")
    func numbered() {
        let r = TransitAlternativeName.key(highlight: nil, displayIndex: 2)
        #expect(r.key == "route.transit.alternativeHeading")
        #expect(r.index == 2)
    }
}
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd ios/GildongmuKit && swift test --filter TransitAlternativeNameTests`
Expected: FAIL (타입 없음)

- [ ] **Step 3: Kit 구현**

```swift
// ios/GildongmuKit/Sources/GildongmuKit/TransitAlternativeName.swift
/// 대안 경로 표시 이름 키(웹 `transit-alternative-name.ts` 미러).
/// disclosure 라벨·안내 시작 버튼·VoiceOver 로터가 같은 이름을 써야 한다.
public enum TransitAlternativeName {
    public static func key(
        highlight: [String]?, displayIndex: Int?
    ) -> (key: String, index: Int?) {
        let h = highlight ?? []
        let fast = h.contains("fastest")
        let few = h.contains("fewestTransfers")
        if fast && few { return ("route.transit.alternativeFastestFewestTransfers", nil) }
        if few { return ("route.transit.alternativeFewestTransfers", nil) }
        if fast { return ("route.transit.alternativeFastest", nil) }
        return ("route.transit.alternativeHeading", displayIndex ?? 1)
    }
}
```

- [ ] **Step 4: 모델에 필드를 더한다**

`RouteModels.swift`의 `TransitRouteLeg`에 `public let distanceMeters: Int?`, `TransitRoute`에 `public let routeKey: String`·`highlight: [String]?`·`displayIndex: Int?`, `TransitRouteResult`에 `public let totalCandidates: Int`를 더한다. **`Int` 엄격 디코딩**이라 서버가 `Math.round`한 정수를 보내는지 확인한다(`distanceMeters`는 ODsay 원값이 정수다).

- [ ] **Step 5: 도보 구간 문장과 도착 문구를 고친다**

`RouteBriefing.swift`의 `transitLegText` 도보 분기에서 `toName ?? dest`와 `distanceMeters`로 §4.3 표의 4개 키를 고른다. 거리는 **Kit `Format.swift`의 `formatDistance`**를 지난다. 도착 행은 `route.legs.last?.mode != "walk"`일 때만 렌더한다.

- [ ] **Step 6: 도보 접힘과 대안을 고친다**

`DirectionsTabView.swift`:
- 도보 섹션의 `WalkRouteRows`를 `DisclosureGroup`으로 감싼다(30분 초과일 때만). 라벨은 기존 도보 요약. 계단 회피 `Toggle`과 안내 시작 버튼은 **밖**에 남긴다.
- `expandedAlts`를 `Set<Int>`에서 `Set<String>`(routeKey)으로, `GuideStartButton.transitAlt(Int)`를 `transitAlt(String)`으로 바꾼다.
- 대안 라벨은 `TransitAlternativeName.key(...)` + `appLocalized`.

- [ ] **Step 7: 게이트**

Run: `cd ios/GildongmuKit && swift test` 그리고 `CONFIGURATION=Experimental ./ios/deploy-device.sh`
Expected: 테스트 PASS + 실기기 설치 성공

- [ ] **Step 8: 커밋**

```bash
git add ios/GildongmuKit/Sources/GildongmuKit/TransitAlternativeName.swift ios/GildongmuKit/Tests/GildongmuKitTests/TransitAlternativeNameTests.swift
git commit -m "feat(ios): 도보 접힘, 대안 축 이름, routeKey 기반 세션 추적" -- ios/
```

---

## Task 10: CLI

**Files:**
- Modify: `packages/cli/src/lib/formatters.ts` (transit 포매터)

- [ ] **Step 1: 도보 구간에 거리·행선지를 넣는다**

CLI는 목적지 이름을 항상 알지 못하므로 `toName`이 없으면 "목적지까지"를 쓴다. 거리는 `dist()`를 지난다.

- [ ] **Step 2: 축 이름을 넣는다**

`highlight`가 있으면 축 이름을, 없으면 `displayIndex`로 번호를 쓴다.

- [ ] **Step 3: 경로 수 변화 회귀를 확인한다**

Run: `npx vitest run packages/cli` 그리고 **`--output text` 명시** 실호출 1회
Expected: 3경로가 5경로로 늘어난 출력이 깨지지 않는다. ⚠ 파이프로 돌리면 비-TTY라 JSON 모드가 되어 text 포매터를 검증하지 못한다.

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(cli): 도보 구간 거리·행선지와 대안 축 이름" -- packages/cli/
```

---

## Task 11: 실호출과 접근성 실측 게이트

- [ ] **Step 1: 실호출 4종**

프로덕션(또는 로컬 dev)에서 확인한다.
- 자택 → 서울역: 무환승 370번이 대안에 오르고 축 라벨이 붙는가.
- 자택 → 강동역: 최단 축이 추천과 다른 경로에 붙고 환승 축은 안 생기는가.
- 700m 이내 좌표쌍: 대중교통 "경로 없음"이 유지되는가.
- **심야 시간대**: 강등 후 1순위가 바뀌고 축이 새 1순위 기준으로 계산되는가, `outside`에 축 라벨이 없는가.

- [ ] **Step 2: 웹 접근성 트리 실측**

Chrome 접근성 트리로 대안 disclosure와 도보 disclosure의 접근명을 확인한다. 축 라벨과 요약이 **한 객체**인가, 분절이 없는가.

- [ ] **Step 3: iOS 실기기 VoiceOver 실측**

`CONFIGURATION=Experimental ./ios/deploy-device.sh` 후 확인한다.
- 도보 `DisclosureGroup`의 펼침 상태가 낭독되는가.
- 대안 버튼 목록(로터)에서 축 이름으로 구분되는가.
- 안내 시작 후 시트를 닫으면 포커스가 그 대안 버튼으로 복귀하는가.
- 접힘·펼침에 중복 통지가 없는가.

- [ ] **Step 4: 변이 주입 7종(spec §9)**

각 변이를 생산 코드에 넣고 테스트가 실패하는지 확인한 뒤 되돌린다. 잡지 못한 축은 테스트를 보강한다.

- [ ] **Step 5: 문서 갱신과 최종 커밋**

`PROGRESS.md`에 실호출·실측 결과를 기록하고, `docs/BACKLOG.md`에서 이 재편으로 닫힌 항목이 있으면 정리한다. `CLAUDE.md`의 통합 카탈로그 ODsay 행에 파이프라인 순서와 error 봉투 2형을 한 줄로 반영한다.

---

## Self-Review

**Spec coverage**

| spec | 담당 |
|---|---|
| §2 문턱·배치·개수·축 | Task 8(문턱·배치), Task 4(개수·축) |
| §3.1 응답 계약 | Task 3 fixture |
| §3.2 도보 거리·행선지·3-state | Task 3 |
| §3.3 파이프라인 4단계·error 봉투·throw·routeKey·displayIndex·totalCandidates | Task 1·3·4·5 |
| §3.4 arrive 조건부 | Task 7(웹)·Task 9(iOS)·Task 10(CLI) |
| §4.1 표시 이름 | Task 7(웹)·Task 9(iOS) |
| §4.2 안내 버튼 라벨·routeKey 포커스 | Task 8·Task 9 |
| §4.3 도보 문구 5형 | Task 6·7·9·10 |
| §4.4 접힘·3값 전이 | Task 8(웹)·Task 9(iOS) |
| §5 접근성 계약 | Task 8·9·11 |
| §6 플랫폼 파급 | Task 7~10 |
| §8 테스트 4층 | Task 3·4·5(순수·합성), 8·9(컴포넌트), 11(실측·실호출) |
| §9 변이 주입 | Task 11 Step 4 |

**Type consistency**: `TransitRoute.routeKey: string`(Task 2) → `p${i}`(Task 3) → `selected` 중복 제거 키(Task 4) → `expandedAlts: Set<string>`·`activeGuideAlt: string | null`(Task 8) → Swift `routeKey: String`·`GuideStartButton.transitAlt(String)`(Task 9)로 일관된다. `highlight: TransitHighlight[]`가 Task 4에서 배열로 실리고 Task 7·9가 배열로 읽는다.

**남은 판단(구현 중 결정)**: Task 9의 iOS 도보 `DisclosureGroup` 라벨이 시뮬레이터 접근성 트리에서 무라벨 셰브런 노드를 만들 수 있으나, 이는 실기기 VoiceOver에서 비문제로 확인된 아티팩트다(재규명 금지).

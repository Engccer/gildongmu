# 역 상세 보강 구현 플랜 (웹 phase)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 역 상세에 첫차·막차 자동 섹션(TAGO 전국)과 시설 패널 보강(음성유도기 seed + 엘리베이터 위치 폴백)을 추가하고, 카카오 역명("강동역 5호선") 매칭 선재 결함을 수정한다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-07-22-station-detail-enrichment-design.md`가 정본. 매칭 계층(station-match) 확장 → 신규 provider 2개(tago-subway·seoul-elevator)+정적 seed 1개(voice-guides) → 기존 metro-facilities 응답 확장 + 신규 timetable 라우트 → 신규 자동 섹션 컴포넌트 1개.

**Tech Stack:** Next.js 16 App Router, TypeScript, Vitest(node env, fixture 단위테스트), next-intl 5로케일, Python(seed 빌드).

## Global Constraints

- 커밋 이메일 `engccer@gmail.com`, 주석·커밋 한국어, 변수/함수명 영어. `git add -A` 금지 — 의도 파일만.
- 외부 API 실호출이 머지 게이트(fixture green ≠ 실계약). dev 서버가 localhost:3000에 이미 떠 있음.
- 3-state 불변식: "0건/없음" ≠ "정보 없음" ≠ "조회 실패". 스펙 §2-A 판정 표 준수.
- 한 줄 = 한 접근성 객체(`joinText`, 쉼표 구분·가운뎃점 금지). 자동 등장 섹션은 region 랜드마크.
- 키는 전부 서버 전용 env. 게이트: `hasDataGoKrKey()`·`hasSeoulOpenDataKey()`(`src/lib/env.ts` 기존).
- data.go.kr envelope: `response.body.items.item[]`, **1건이면 객체**, 빈 결과 `items:""`.
- 신규 fetch 캐시는 전부 `next: { revalidate: 86_400 }`.

---

### Task 1: station-match 확장 — 괄호·노선 토큰 정규화 + 노선 힌트

**Files:**
- Modify: `src/lib/station-match.ts`
- Test: `src/lib/__tests__/station-match.test.ts` (기존 파일에 추가)

**Interfaces:**
- Produces: `stripStationDecorations(name: string): string`(대소문자 보존, API contains-필터·표시 겸용 정제), `normalizeStationName(name): string`(기존 시그니처 유지 — 내부가 strip+lowercase로 확장), `parseStationQuery(name): { nameKey: string; lineHint?: string }`, `lineHintMatches(lineName: string, lineHint: string): boolean`.

- [ ] **Step 1: 실패 테스트 추가** — `station-match.test.ts`에:

```ts
import { normalizeStationName, parseStationQuery, lineHintMatches, stripStationDecorations } from "../station-match";

describe("역명 정규화 확장 (카카오 노선 접미·괄호 부가명)", () => {
  it("카카오 실명의 노선 접미를 제거한다", () => {
    expect(normalizeStationName("강동역 5호선")).toBe("강동");
    expect(normalizeStationName("굽은다리역 5호선")).toBe("굽은다리");
    expect(normalizeStationName("강남역 신분당선")).toBe("강남");
    expect(normalizeStationName("서울역 공항철도")).toBe("서울"); // "공항철도"는 선 미종결 — 아래 참조
  });
  it("괄호 부가명을 제거한다 (TAGO·CSV 변형)", () => {
    expect(normalizeStationName("청량리(서울시립대입구)")).toBe("청량리");
    expect(normalizeStationName("동대문(4)")).toBe("동대문");
    expect(normalizeStationName("서울역 (1)")).toBe("서울");
    expect(normalizeStationName("굽은다리(강동구민회관앞)")).toBe("굽은다리");
  });
  it("무공백 역명·기존 케이스는 불변", () => {
    expect(normalizeStationName("선릉")).toBe("선릉");
    expect(normalizeStationName("선바위역")).toBe("선바위");
    expect(normalizeStationName("강동")).toBe("강동");
    expect(normalizeStationName("Gangdong Station")).toBe("gangdong");
  });
});

describe("parseStationQuery — 노선 힌트 보존", () => {
  it("노선 토큰을 힌트로 분리한다", () => {
    expect(parseStationQuery("양평역 5호선")).toEqual({ nameKey: "양평", lineHint: "5호선" });
    expect(parseStationQuery("강동역")).toEqual({ nameKey: "강동" });
  });
  it("공항철도류 비-선 접미 토큰도 힌트가 된다", () => {
    expect(parseStationQuery("서울역 공항철도")).toEqual({ nameKey: "서울", lineHint: "공항철도" });
  });
});

describe("lineHintMatches", () => {
  it("완전 일치·접두 포함을 허용한다", () => {
    expect(lineHintMatches("5호선", "5호선")).toBe(true);
    expect(lineHintMatches("공항", "공항철도")).toBe(true); // TAGO 축약 ↔ 카카오 전체명
    expect(lineHintMatches("경의중앙", "경의중앙선")).toBe(true);
  });
  it("다른 노선을 거부한다 (1호선 vs 11호선 포함)", () => {
    expect(lineHintMatches("경의중앙", "5호선")).toBe(false);
    expect(lineHintMatches("11호선", "1호선")).toBe(false);
  });
});
```

주의: "서울역 공항철도"의 "공항철도"는 `선` 종결이 아니다 — 노선 토큰 판정은 `선` 종결 **또는** 노선 어휘(`철도`·`호선` 포함, `GTX-` 접두) 종결로 정의한다(아래 구현).

- [ ] **Step 2: 실패 확인** — `npm run test:run -- station-match` → 신규 케이스 FAIL.

- [ ] **Step 3: 구현** — `station-match.ts`의 `normalizeStationName`을 교체하고 신규 함수 추가:

```ts
// 후행 노선 토큰: 공백 뒤 "…선"("5호선"·"신분당선") 또는 "…철도"("공항철도"),
// "GTX-…" 형태. 역명 자체는 무공백이 관례라 공백 분리 후행 토큰만 건드린다.
const TRAILING_LINE_TOKEN = /(?:\s+(?:\S*(?:선|철도)|GTX-\S*))+$/i;

/**
 * 역명 장식 제거(대소문자 보존) — 괄호 부가명·후행 노선 토큰·"역"/"station" 접미.
 * API contains-필터 질의(wksn stnNm·swopenapi)와 매칭 키의 공통 전처리.
 */
export function stripStationDecorations(name: string): string {
  return name
    .replace(/\s*\([^)]*\)/g, "")
    .replace(TRAILING_LINE_TOKEN, "")
    .trim()
    .replace(/\s*station$/i, "")
    .replace(/역$/, "")
    .trim();
}

/** 역 이름 정규화(매칭 키 전용) — 장식 제거 + 소문자. 표시명에는 쓰지 않는다. */
export function normalizeStationName(name: string): string {
  return stripStationDecorations(name).toLowerCase();
}

/**
 * 역 질의 분해 — 매칭 키와 노선 힌트("양평역 5호선"의 "5호선"은 경의중앙선
 * 양평역(동명이역)과의 유일한 구분자라 버리면 안 된다).
 */
export function parseStationQuery(name: string): { nameKey: string; lineHint?: string } {
  const noParen = name.replace(/\s*\([^)]*\)/g, "").trim();
  const m = noParen.match(TRAILING_LINE_TOKEN);
  const nameKey = normalizeStationName(name);
  if (!m) return { nameKey };
  const lineHint = m[0].trim();
  return lineHint ? { nameKey, lineHint } : { nameKey };
}

/** 노선명 ↔ 힌트 매칭 — "선"/"철도" 접미를 벗긴 코어의 상호 접두 일치(TAGO 축약형 흡수). */
export function lineHintMatches(lineName: string, lineHint: string): boolean {
  const core = (s: string) => s.trim().toLowerCase().replace(/(철도|호선|선)$/g, "");
  const a = core(lineName);
  const b = core(lineHint);
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}
```

주의 — `lineHintMatches`의 core: "5호선"→`호선` 제거→"5", "11호선"→"11". "1".startsWith("11") false, "11".startsWith("1") **true** → 오매칭! 방지: 코어가 숫자로만 구성되면 **완전 일치만** 허용한다:

```ts
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return a === b;
  return a === b || a.startsWith(b) || b.startsWith(a);
```

- [ ] **Step 4: 통과 확인** — `npm run test:run -- station-match` PASS. 이어서 **전체** `npm run test:run` — 기존 테스트(subway-stations·seoul-metro-facilities·korail 등)가 확장 정규화로 깨지지 않는지 확인. 깨지면 케이스를 검토해 원인 보고(기대값이 구정규화에 묶인 것만 갱신, 동작 회귀는 수정).

- [ ] **Step 5: Commit** — `git add src/lib/station-match.ts src/lib/__tests__/station-match.test.ts && git commit -m "fix(station): 역명 정규화 확장 — 카카오 노선 접미·괄호 부가명 제거+노선 힌트 분리(선재 매칭 결함 수정 1/2)"`

---

### Task 2: 기존 역 상세 4종에 확장 매칭 배선

**Files:**
- Modify: `src/lib/subway-stations.ts`(lineHint 옵션), `src/lib/providers/seoul-metro-facilities.ts`(질의 정제+lineHint), `src/lib/providers/seoul-subway-arrival.ts`(cleanName을 공유 helper로)
- Test: `src/lib/__tests__/subway-stations.test.ts`, `src/lib/__tests__/seoul-metro-facilities.test.ts` (추가)

**Interfaces:**
- Consumes: Task 1의 `stripStationDecorations`·`parseStationQuery`·`lineHintMatches`.
- Produces: `matchStationsByName(stations, query, lineHint?)`(제3인자 옵션 — 기존 호출부 무변경), `findStationMeta(query)`는 내부에서 `parseStationQuery`로 lineHint 자동 적용.

- [ ] **Step 1: 실패 테스트** — `subway-stations.test.ts`에 동명이역 fixture 추가:

```ts
const 양평5 = { name: "양평", nameEn: "Yangpyeong", lineName: "5호선", operator: "서울교통공사", lat: 37.5254, lng: 126.8853, isTransfer: false };
const 양평중앙 = { name: "양평", nameEn: "Yangpyeong", lineName: "경의중앙선", operator: "한국철도공사", lat: 37.4925, lng: 127.4896, isTransfer: false };

it("lineHint가 동명이역을 분리한다", () => {
  expect(matchStationsByName([양평5, 양평중앙], "양평역 5호선", "5호선")).toEqual([양평5]);
});
it("findStationMeta가 카카오 실명에서 lineHint를 자동 적용한다", () => {
  // seed 실데이터: "양평역 5호선"의 lines에 경의중앙선이 섞이면 안 된다
  const meta = findStationMeta("양평역 5호선");
  expect(meta?.lines).toEqual(["5호선"]);
});
it("카카오 실명 '강동역 5호선'이 seed와 매칭된다", () => {
  expect(findStationMeta("강동역 5호선")?.name).toBe("강동");
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:run -- subway-stations` FAIL.

- [ ] **Step 3: 구현**

`subway-stations.ts`:
```ts
export function matchStationsByName(
  stations: SubwayStation[],
  query: string,
  lineHint?: string,
): SubwayStation[] {
  const target = normalizeStationName(query);
  if (!target) return [];
  return stations.filter(
    (s) =>
      normalizeStationName(s.name) === target &&
      (!lineHint || lineHintMatches(s.lineName, lineHint)),
  );
}

export function findStationsByName(query: string, lineHint?: string): SubwayStation[] {
  return matchStationsByName(STATIONS, query, lineHint);
}

export function findStationMeta(query: string): StationMeta | null {
  const { lineHint } = parseStationQuery(query);
  return summarizeStation(findStationsByName(query, lineHint));
}
```

`seoul-metro-facilities.ts` — `fetchSeoulMetroFacilities`의 질의 정제를 교체하고 정확매칭에 lineHint 병용:
```ts
// 포함필터 질의: 괄호·노선 토큰·"역"까지 벗긴 원문형("강동역 5호선"→"강동").
const query = stripStationDecorations(stationName);
const { lineHint } = parseStationQuery(stationName);
```
정확매칭 필터 3곳(`parseFacilityGroup` 경유 필터·firstMatched)에 `(!lineHint || lineHintMatches(str(it.lineNm), lineHint))` 조건 추가 — 시그니처는 내부 전달 인자로(공개 API 무변경). `parseSeoulMetroFacilities(raws, stationName)`는 내부에서 `parseStationQuery(stationName)` 호출.

`seoul-subway-arrival.ts` — 자체 `cleanName`을 삭제하고:
```ts
import { stripStationDecorations } from "../station-match";
// 조회 키이자 표시명 — swopenapi는 정확 역명("강동")을 요구한다.
const cleanName = stripStationDecorations;
```

- [ ] **Step 4: 통과 확인** — `npm run test:run` 전체 green.

- [ ] **Step 5: 실서버 스모크** — dev 서버에서:
```bash
curl -s "http://localhost:3000/api/station/meta?station=$(python3 -c "import urllib.parse;print(urllib.parse.quote('강동역 5호선'))")"
# 기대: meta 비-null, lines ["5호선"]
curl -s "http://localhost:3000/api/station/subway-arrival?station=$(python3 -c "import urllib.parse;print(urllib.parse.quote('강동역 5호선'))")"
# 기대: arrivals 비-null(실시간 도착 존재 시간대 기준)
```

- [ ] **Step 6: Commit** — `git add src/lib/subway-stations.ts src/lib/providers/seoul-metro-facilities.ts src/lib/providers/seoul-subway-arrival.ts src/lib/__tests__/subway-stations.test.ts src/lib/__tests__/seoul-metro-facilities.test.ts && git commit -m "fix(station): 역 상세 4종에 확장 매칭 배선 — 카카오 진입 死 섹션 부활+동명이역 lineHint(선재 결함 수정 2/2)"`

---

### Task 3: 타입 + 공휴일 provider + tago-subway 순수 파서

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/providers/holiday.ts`, `src/lib/providers/tago-subway.ts`
- Test: `src/lib/providers/__tests__/tago-subway.test.ts`, fixture `src/lib/__tests__/fixtures/tago-subway-schedule.json`(강동 실응답 축약 — 00시대 심야·당역종착·정상 행 혼합 12행 내외로 손수 구성)

**Interfaces:**
- Produces(types.ts):
```ts
export interface TimetableTrain { time: string; nextDay?: true; terminus: string; terminusEn?: string; }
export interface TimetableDirection { direction: "up" | "down"; first: TimetableTrain; last: TimetableTrain; }
export interface TimetableLine { lineName: string; directions: TimetableDirection[]; }
export interface StationTimetable {
  stationName: string;
  dailyType: "weekday" | "saturday" | "sunday";
  partial?: true;
  lines: TimetableLine[];
}
```
- Produces(tago-subway.ts 순수부): `ensureItemArray(raw): unknown[]`(객체 1건→배열, `""`→[]), `parseKeywordStations(raw): {id,name,routeName}[]`, `displayLineName(routeName): string`(`선` 종결 아니면 `선` 부가), `computeServiceDailyType(nowUtcMs: number): {date: string; type: "weekday"|"saturday"|"sunday"}`(KST-3h 경계), `deriveFirstLast(rows, stationId): {first,last} | null`(서비스데이 정렬·당역종착 제외·유효성 가드·nextDay 판정).
- Produces(holiday.ts): `fetchIsHoliday(dateYYYYMMDD: string): Promise<boolean | null>`(키 없음·미신청 403·실패 → null = 판정 불가).

- [ ] **Step 1: 실패 테스트** — `tago-subway.test.ts` 핵심 케이스(코드 전문):

```ts
import { describe, it, expect } from "vitest";
import {
  ensureItemArray, parseKeywordStations, displayLineName,
  computeServiceDailyType, deriveFirstLast,
} from "../tago-subway";

describe("ensureItemArray", () => {
  it("객체 1건을 배열로, 빈 문자열을 []로", () => {
    expect(ensureItemArray({ response: { body: { items: { item: { a: 1 } } } } })).toEqual([{ a: 1 }]);
    expect(ensureItemArray({ response: { body: { items: "" } } })).toEqual([]);
  });
});

describe("displayLineName", () => {
  it("축약 노선명에 선을 붙인다", () => {
    expect(displayLineName("5호선")).toBe("5호선");
    expect(displayLineName("수인분당")).toBe("수인분당선");
    expect(displayLineName("GTX-A")).toBe("GTX-A선");
  });
});

describe("computeServiceDailyType — KST-3h 서비스데이", () => {
  it("월요일 00:30 KST는 일요일 타입", () => {
    // 2026-07-27(월) 00:30 KST = 2026-07-26T15:30Z
    expect(computeServiceDailyType(Date.UTC(2026, 6, 26, 15, 30)).type).toBe("sunday");
  });
  it("월요일 05:00 KST는 평일 타입", () => {
    expect(computeServiceDailyType(Date.UTC(2026, 6, 26, 20, 0)).type).toBe("weekday");
  });
  it("토요일 낮은 saturday", () => {
    // 2026-07-25(토) 12:00 KST = 03:00Z
    expect(computeServiceDailyType(Date.UTC(2026, 6, 25, 3, 0)).type).toBe("saturday");
  });
});

const SELF = "MTRS152549";
const row = (dep: string, end = "MTRS152531", endNm = "애오개") => ({
  subwayStationId: SELF, endSubwayStationId: end, endSubwayStationNm: endNm, depTime: dep,
});

describe("deriveFirstLast", () => {
  it("심야(<03시)를 +24h 보정해 첫차가 05시대가 된다", () => {
    const r = deriveFirstLast([row("002450"), row("051310", "MTRS152501", "방화"), row("235150")], SELF)!;
    expect(r.first).toEqual({ time: "05:13", terminus: "방화" });
    expect(r.last).toEqual({ time: "00:24", nextDay: true, terminus: "애오개" });
  });
  it("당역 종착·비정상 depTime을 제외한다", () => {
    const r = deriveFirstLast([row("000210", SELF, "강동"), row("abc"), row("051310")], SELF)!;
    expect(r.first.time).toBe("05:13");
    expect(r.last.time).toBe("05:13");
  });
  it("유효 행 0이면 null", () => {
    expect(deriveFirstLast([row("000210", SELF, "강동")], SELF)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:run -- tago-subway` FAIL (모듈 없음).

- [ ] **Step 3: 구현** — `tago-subway.ts` 순수부(fetch 통합은 Task 4):

```ts
const BASE = "http://apis.data.go.kr/1613000/SubwayInfo";
const PAGE_SIZE = 500;
const SERVICE_DAY_BOUNDARY = 30000; // HHMMSS 수치 03:00:00 — 국내 도시철도 공통 운행 공백(01~05시)에 놓인 휴리스틱

export function ensureItemArray(raw: unknown): unknown[] {
  const items = (raw as { response?: { body?: { items?: unknown } } })?.response?.body?.items;
  if (items == null || items === "") return [];
  const item = (items as { item?: unknown }).item;
  if (item == null) return [];
  return Array.isArray(item) ? item : [item];
}

export function parseKeywordStations(raw: unknown): Array<{ id: string; name: string; routeName: string }> {
  return ensureItemArray(raw)
    .map((it) => {
      const o = it as Record<string, unknown>;
      return {
        id: o.subwayStationId == null ? "" : String(o.subwayStationId),
        name: o.subwayStationName == null ? "" : String(o.subwayStationName),
        routeName: o.subwayRouteName == null ? "" : String(o.subwayRouteName),
      };
    })
    .filter((s) => s.id && s.name);
}

/** TAGO 축약 노선명("수인분당"·"공항") 표시 규칙 — 선 종결 아니면 "선" 부가. 매핑 테이블 금지. */
export function displayLineName(routeName: string): string {
  const t = routeName.trim();
  return /선$/.test(t) ? t : `${t}선`;
}

/** KST-3h 경계의 서비스데이 날짜·요일 타입. 서버 타임존 비의존(UTC 산술 고정). */
export function computeServiceDailyType(nowUtcMs: number): { date: string; type: "weekday" | "saturday" | "sunday" } {
  const kstMinus3h = new Date(nowUtcMs + 9 * 3600_000 - 3 * 3600_000);
  const y = kstMinus3h.getUTCFullYear();
  const m = String(kstMinus3h.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kstMinus3h.getUTCDate()).padStart(2, "0");
  const dow = kstMinus3h.getUTCDay(); // 0=일
  const type = dow === 0 ? "sunday" : dow === 6 ? "saturday" : "weekday";
  return { date: `${y}${m}${d}`, type };
}

interface ScheduleRow { subwayStationId?: unknown; endSubwayStationId?: unknown; endSubwayStationNm?: unknown; depTime?: unknown; }

/** 첫차·막차 산출(스펙 §1-A 계약) — 서비스데이 정렬·당역종착 제외·행 유효성 가드·익일 판정. */
export function deriveFirstLast(
  rows: unknown[],
  stationId: string,
): { first: { time: string; nextDay?: true; terminus: string }; last: { time: string; nextDay?: true; terminus: string } } | null {
  const candidates = rows.flatMap((r) => {
    const o = r as ScheduleRow;
    const dep = o.depTime == null ? "" : String(o.depTime);
    if (!/^\d{6}$/.test(dep)) return []; // 오염 행 가드
    if (String(o.endSubwayStationId ?? "") === stationId) return []; // 당역 종착 — 탑승 불가
    const raw = Number(dep);
    const adjusted = raw < SERVICE_DAY_BOUNDARY ? raw + 240000 : raw;
    const train = {
      time: `${dep.slice(0, 2)}:${dep.slice(2, 4)}`,
      ...(raw < SERVICE_DAY_BOUNDARY ? { nextDay: true as const } : {}),
      terminus: o.endSubwayStationNm == null ? "" : String(o.endSubwayStationNm),
    };
    return [{ adjusted, train }];
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.adjusted - b.adjusted);
  return { first: candidates[0].train, last: candidates[candidates.length - 1].train };
}
```

`holiday.ts`:
```ts
import { env } from "../env";

/**
 * 특일정보(공공데이터 15012690) — serviceDate 공휴일 판정.
 * 게이트형: 키 없음·미신청(403)·파싱 실패 전부 null(판정 불가 → 호출부 요일 폴백).
 * UI가 항상 기준 라벨을 명시하므로 폴백이 오도를 만들지 않는다(스펙 §1-A-3).
 */
export async function fetchIsHoliday(dateYYYYMMDD: string): Promise<boolean | null> {
  const key = env.DATA_GO_KR_API_KEY;
  if (!key) return null;
  const year = dateYYYYMMDD.slice(0, 4);
  const month = dateYYYYMMDD.slice(4, 6);
  const url = `http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?serviceKey=${encodeURIComponent(key)}&solYear=${year}&solMonth=${month}&_type=json&numOfRows=50`;
  try {
    const res = await fetch(url, { next: { revalidate: 86_400 } });
    if (!res.ok) return null;
    const raw: unknown = await res.json();
    const items = (raw as { response?: { body?: { items?: unknown } } })?.response?.body?.items;
    if (items == null || items === "") return false; // 그 달 공휴일 없음 — 정상 판정
    const item = (items as { item?: unknown }).item;
    const list = Array.isArray(item) ? item : item != null ? [item] : [];
    return list.some((it) => {
      const o = it as { locdate?: unknown; isHoliday?: unknown };
      return String(o.locdate ?? "") === dateYYYYMMDD && String(o.isHoliday ?? "") === "Y";
    });
  } catch {
    return null;
  }
}
```

types.ts에 위 Interfaces 블록의 4개 인터페이스 추가(기존 Station* 타입들 근처).

- [ ] **Step 4: 통과 확인** — `npm run test:run -- tago-subway` PASS.
- [ ] **Step 5: Commit** — `git add src/lib/types.ts src/lib/providers/holiday.ts src/lib/providers/tago-subway.ts src/lib/providers/__tests__/tago-subway.test.ts && git commit -m "feat(timetable): TAGO 지하철 순수 파서+공휴일 게이트 provider — 서비스데이 보정·당역종착 제외·행 가드"`

---

### Task 4: fetchStationTimetable 통합 + /api/station/timetable 라우트

**Files:**
- Modify: `src/lib/providers/tago-subway.ts`(fetch 통합), `src/lib/rate-limit.ts`
- Create: `src/app/api/station/timetable/route.ts`
- Test: `src/lib/providers/__tests__/tago-subway.test.ts`(추가 — fetch 모킹으로 판정 표 검증)

**Interfaces:**
- Consumes: Task 1 `parseStationQuery`·`lineHintMatches`·`normalizeStationName`, Task 3 순수부·`fetchIsHoliday`, `findStationsByName`(행선지 영문).
- Produces: `fetchStationTimetable(stationName: string): Promise<StationTimetable | null>`(미커버 null·전실패 throw·부분실패 partial), `checkTimetableRateLimit(ip, now): boolean`(60초 10회).

- [ ] **Step 1: 실패 테스트** — 판정 표(스펙 §2-A) 5행을 `vi.stubGlobal("fetch", ...)` 모킹으로:

```ts
// 헬퍼: 키워드 응답 1노선(MTRS152549/강동/5호선), 시간표 응답을 시나리오별 주입
// 시나리오 A: 両방향 성공 → lines[0].directions.length===2, partial 없음
// 시나리오 B: U 성공·D reject → partial:true, directions는 U만
// 시나리오 C: 両방향 reject → rejects.toThrow()
// 시나리오 D: 両방향 성공·유효 행 0(전부 당역종착) → { lines: [] }
// 시나리오 E: 키워드 정확매칭 0건(다른 역만) → null
// 추가: lineHint — 키워드 응답에 5호선+경의중앙 2노선, "양평역 5호선" 입력 → 5호선만 조회
```

각 시나리오를 실제 코드로 작성한다(fetch 호출 URL의 오퍼레이션 이름으로 분기해 mock 응답 반환). `env` 모킹은 기존 provider 테스트(`seoul-metro-facilities.test.ts`)의 `vi.mock("../env", ...)` 패턴을 그대로 따른다.

- [ ] **Step 2: 실패 확인** — FAIL.

- [ ] **Step 3: 구현** — `tago-subway.ts`에 추가:

```ts
const MAX_LINES = 8; // 호출 증폭 cap(스펙 §2-A)

async function fetchTago(op: string, params: Record<string, string>): Promise<unknown> {
  const key = env.DATA_GO_KR_API_KEY!;
  const search = new URLSearchParams({ serviceKey: key, _type: "json", numOfRows: String(PAGE_SIZE), pageNo: "1", ...params });
  const res = await fetch(`${BASE}/${op}?${search}`, { next: { revalidate: 86_400 } });
  if (!res.ok) throw new Error(`TAGO ${op} HTTP ${res.status}`);
  const raw: unknown = await res.json();
  const header = (raw as { response?: { header?: { resultCode?: unknown } } })?.response?.header;
  const code = String(header?.resultCode ?? "");
  // 00 정상. NODATA류가 별코드로 오면 통과(빈 items 처리) — 그 외는 throw.
  if (code !== "00" && code !== "03") throw new Error(`TAGO ${op} resultCode ${code}`);
  const total = Number((raw as { response?: { body?: { totalCount?: unknown } } })?.response?.body?.totalCount ?? 0);
  if (total > PAGE_SIZE) throw new Error(`TAGO ${op} totalCount(${total}) > ${PAGE_SIZE} — 페이지 누락`);
  return raw;
}

export async function fetchStationTimetable(stationName: string): Promise<StationTimetable | null> {
  if (!env.DATA_GO_KR_API_KEY) return null;
  const { nameKey, lineHint } = parseStationQuery(stationName);
  if (!nameKey) return null;
  const keywordRaw = await fetchTago("GetKwrdFndSubwaySttnList", { subwayStationName: nameKey });
  const matched = parseKeywordStations(keywordRaw)
    .filter((s) => normalizeStationName(s.name) === nameKey)
    .filter((s) => !lineHint || lineHintMatches(s.routeName, lineHint))
    .slice(0, MAX_LINES);
  if (matched.length === 0) return null; // 미커버 — 섹션 미노출

  const service = computeServiceDailyType(Date.now());
  const holiday = await fetchIsHoliday(service.date); // null=판정 불가 → 요일 폴백
  const dailyType = holiday === true ? "sunday" : service.type;
  const dailyTypeCode = dailyType === "weekday" ? "01" : dailyType === "saturday" ? "02" : "03";

  const jobs = matched.flatMap((st) =>
    (["U", "D"] as const).map((dir) => ({ st, dir })),
  );
  const settled = await Promise.allSettled(
    jobs.map(({ st, dir }) =>
      fetchTago("GetSubwaySttnAcctoSchdulList", {
        subwayStationId: st.id, dailyTypeCode, upDownTypeCode: dir,
      }),
    ),
  );
  const failures = settled.filter((r) => r.status === "rejected").length;
  if (failures === settled.length) {
    // 전 호출 실패 — "운행 없음"으로 위장 금지(스펙 판정 표)
    throw new Error("TAGO 시간표 전 호출 실패");
  }

  const lines: TimetableLine[] = [];
  matched.forEach((st, i) => {
    const directions: TimetableDirection[] = [];
    (["up", "down"] as const).forEach((direction, d) => {
      const r = settled[i * 2 + d];
      if (r.status !== "fulfilled") return;
      const fl = deriveFirstLast(ensureItemArray(r.value), st.id);
      if (!fl) return; // 그 방향 유효 행 0 — 생략
      directions.push({
        direction,
        first: withTerminusEn(fl.first),
        last: withTerminusEn(fl.last),
      });
    });
    if (directions.length > 0) lines.push({ lineName: displayLineName(st.routeName), directions });
  });

  return {
    stationName,
    dailyType,
    ...(failures > 0 ? { partial: true as const } : {}),
    lines,
  };
}

/** 행선지 영문 병기 — seed 미매칭이면 한글 그대로(정직 폴백, 스펙 §7-17). */
function withTerminusEn(t: { time: string; nextDay?: true; terminus: string }): TimetableTrain {
  const en = findStationsByName(t.terminus)[0]?.nameEn;
  return en ? { ...t, terminusEn: en } : t;
}
```

`rate-limit.ts`에 기존 패턴 그대로:
```ts
// 시간표는 키워드 1 + 노선×2 호출 증폭이 있어 채팅과 동일한 60초 10회.
const TIMETABLE_LIMIT = 10;
const timetableStore = new Map<string, RateLimitEntry>();

/** /api/station/timetable 전용 레이트 리밋(60초 10회). 허용이면 true. */
export function checkTimetableRateLimit(ip: string, now: number): boolean {
  return evaluateRateLimit(timetableStore, ip, now, TIMETABLE_LIMIT, WINDOW_MS).allowed;
}
```

`route.ts`(metro-facilities 라우트 동형 + 레이트리밋):
```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchStationTimetable } from "@/lib/providers/tago-subway";
import { checkTimetableRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";

/**
 * 역 첫차·막차 프록시(TAGO SubwayInfo). 미커버 역·키 없음은 { timetable: null } 200,
 * upstream 장애는 502(스펙 §2-A 판정 표 — 컴포넌트가 실패 문장을 노출한다).
 * 임의 역명 폭주로 인한 쿼터 소진 방어(60초 10회 — 키워드 1+노선×2 증폭 고려).
 */
const schema = z.object({ station: z.string().trim().min(1).max(50) });

export async function GET(request: NextRequest) {
  if (!checkTimetableRateLimit(clientIpFromHeaders(request.headers), Date.now())) {
    return NextResponse.json({ error: "요청이 너무 잦습니다" }, { status: 429 });
  }
  const parsed = schema.safeParse({ station: request.nextUrl.searchParams.get("station") ?? "" });
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  try {
    const timetable = await fetchStationTimetable(parsed.data.station);
    return NextResponse.json({ timetable });
  } catch (e) {
    console.error("[api/station/timetable] 조회 실패:", e);
    return NextResponse.json({ error: "첫차·막차 조회 실패" }, { status: 502 });
  }
}
```

- [ ] **Step 4: 통과 확인** — `npm run test:run` 전체 green.
- [ ] **Step 5: 실호출 스모크**:
```bash
curl -s "http://localhost:3000/api/station/timetable?station=$(python3 -c "import urllib.parse;print(urllib.parse.quote('강동역 5호선'))")" | python3 -m json.tool | head -40
# 기대: 5호선, 상·하행, 첫차 05시대, 막차 nextDay
curl -s "http://localhost:3000/api/station/timetable?station=%EC%84%9C%EB%A9%B4%EC%97%AD" | python3 -m json.tool | head -30
# 기대: 부산 1·2호선
```
- [ ] **Step 6: Commit** — `git add src/lib/providers/tago-subway.ts src/lib/rate-limit.ts src/app/api/station/timetable/route.ts src/lib/providers/__tests__/tago-subway.test.ts && git commit -m "feat(timetable): 역 첫차·막차 조회 — 판정 표 5행·lineHint·레이트리밋·공휴일 게이트"`

---

### Task 5: i18n 5로케일 + StationTimetable 컴포넌트 + PlaceDetail 배선

**Files:**
- Modify: `messages/ko.json`·`en.json`·`es.json`·`fr.json`·`it.json`, `src/components/PlaceDetail.tsx`
- Create: `src/components/StationTimetable.tsx`

**Interfaces:**
- Consumes: `GET /api/station/timetable?station=` → `{timetable: StationTimetable | null}`(200) / 502 / 429.

- [ ] **Step 1: i18n 키 추가** — 5개 로케일 전부, ko 기준(각 언어 자연스러운 번역, en 예시 병기):

```jsonc
"timetable": {
  "heading": "첫차·막차",                       // First & last trains
  "dailyType": {
    "weekday": "평일 기준",                     // Weekday schedule
    "saturday": "토요일 기준",                  // Saturday schedule
    "sunday": "일요일·공휴일 기준"              // Sunday & holiday schedule
  },
  "direction": { "up": "상행", "down": "하행" }, // Up / Down
  "first": "첫차",                              // First train
  "last": "막차",                               // Last train
  "nextDay": "익일",                            // next day
  "toTerminus": "{terminus}행",                 // to {terminus}
  "empty": "오늘 시간표 정보가 없습니다.",       // No timetable information for today.
  "error": "첫차·막차 정보를 불러오지 못했습니다.", // Couldn't load first/last train info.
  "partial": "일부 노선 정보를 불러오지 못했습니다.", // Some line info couldn't be loaded.
  "source": "국토교통부 TAGO 제공"               // Source: MOLIT TAGO
}
```

`npm run test:run -- i18n-messages` — 키 일관성 게이트 통과 확인.

- [ ] **Step 2: 컴포넌트** — `StationTimetable.tsx`(StationMeta 동형 + 실패 문장 노출이 차이):

```tsx
"use client";

import { useEffect, useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { StationTimetable as Timetable, TimetableTrain } from "@/lib/types";
import { prefersEnglish } from "@/lib/data-locale";
import { joinText } from "@/lib/format";

type Status =
  | { kind: "hidden" }   // 미커버(null)·로딩 전 — 섹션 미노출
  | { kind: "error" }    // 조회 실패 — 숨기지 않고 문장 노출(3-state)
  | { kind: "done"; timetable: Timetable };

/**
 * 역 첫차·막차 자동 섹션 — StationMeta 동형(진입 시 fetch, region 랜드마크).
 * 차이: 시간표는 의사결정 정보라 실패를 조용히 숨기지 않는다(스펙 §2-D) —
 * 미커버(null)만 미노출, 실패·빈 결과는 문장으로 구분해 낭독한다.
 */
export function StationTimetable({ stationName }: { stationName: string }) {
  const t = useTranslations("timetable");
  const locale = useLocale();
  const [status, setStatus] = useState<Status>({ kind: "hidden" });
  const headingId = useId();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/station/timetable?station=${encodeURIComponent(stationName)}`,
          { signal: controller.signal },
        );
        if (!active) return;
        if (!res.ok) {
          setStatus({ kind: "error" });
          return;
        }
        const body = await res.json();
        const timetable = (body.timetable as Timetable) ?? null;
        setStatus(timetable ? { kind: "done", timetable } : { kind: "hidden" });
      } catch {
        if (active) setStatus({ kind: "hidden" }); // 취소·네트워크 중단 — 무노출(오탐 방지)
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [stationName]);

  if (status.kind === "hidden") return null;

  const isEn = prefersEnglish(locale);
  const train = (v: TimetableTrain) =>
    joinText(
      v.nextDay ? `${t("nextDay")} ${v.time}` : v.time,
      t("toTerminus", { terminus: isEn && v.terminusEn ? v.terminusEn : v.terminus }),
    ).replace(", ", " "); // 시각+행선지는 한 호흡("05:15 방화행")

  return (
    // 자동 등장 보조 섹션 — region 랜드마크가 유일한 발견 경로(CLAUDE.md 규칙).
    <section aria-labelledby={headingId} className="mt-3 rounded-md border border-border p-3">
      <h3 id={headingId} className="text-base font-semibold">{t("heading")}</h3>
      {status.kind === "error" ? (
        <p className="mt-1 text-sm">{t("error")}</p>
      ) : (
        <>
          <p className="mt-1 text-sm">
            {joinText(
              t(`dailyType.${status.timetable.dailyType}`),
              status.timetable.partial && t("partial"),
            )}
          </p>
          {status.timetable.lines.length === 0 ? (
            <p className="mt-1 text-sm">{t("empty")}</p>
          ) : (
            <div className="mt-1 text-sm leading-relaxed">
              {status.timetable.lines.map((line) =>
                line.directions.map((d) => (
                  <p key={`${line.lineName}-${d.direction}`}>
                    {joinText(
                      `${line.lineName} ${t(`direction.${d.direction}`)}`,
                      `${t("first")} ${train(d.first)}`,
                      `${t("last")} ${train(d.last)}`,
                    )}
                  </p>
                )),
              )}
            </div>
          )}
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </>
      )}
    </section>
  );
}
```

주의: `train()`의 `.replace(", ", " ")`는 joinText 오용 — 그냥 템플릿 리터럴로 직접 합성한다:
```tsx
const train = (v: TimetableTrain) => {
  const time = v.nextDay ? `${t("nextDay")} ${v.time}` : v.time;
  return `${time} ${t("toTerminus", { terminus: isEn && v.terminusEn ? v.terminusEn : v.terminus })}`;
};
```

- [ ] **Step 3: PlaceDetail 배선** — `SeoulSubwayArrival` 아래에:
```tsx
import { StationTimetable } from "./StationTimetable";
// … 역 블록 안:
<StationTimetable stationName={place.name} />
```
(게이트 prop 불요 — 키 없으면 라우트 null → hidden. StationFacilities 관례 동형.)

- [ ] **Step 4: 검증** — `npm run lint && npm run test:run && npm run build` 전부 통과. dev 서버에서 강동역 5호선 상세 진입해 섹션 HTML 확인:
```bash
curl -s "http://localhost:3000/ko?q=%EA%B0%95%EB%8F%99%EC%97%AD" >/dev/null # 페이지 자체는 CSR — API 스모크로 갈음
```

- [ ] **Step 5: Commit** — `git add messages/*.json src/components/StationTimetable.tsx src/components/PlaceDetail.tsx && git commit -m "feat(timetable): 첫차·막차 자동 섹션 — 기준 라벨·익일 표기·실패 문장, 5로케일"`

---

### Task 6: 음성유도기 정적 seed — 빌드 스크립트 + 조회 모듈

**Files:**
- Create: `scripts/build-voice-guides.py`, `src/lib/data/voice-guides.json`(스크립트 산출물), `src/lib/voice-guides.ts`
- Test: `src/lib/__tests__/voice-guides.test.ts`

**Interfaces:**
- Produces: `findVoiceGuides(nameKey: string): Array<{ line: string; location: string }>`(nameKey는 `normalizeStationName` 결과), `VOICE_GUIDES_AS_OF = "2025-08"`(출처 병기용 상수 — JSON `asOf` 필드에서 로드).

- [ ] **Step 1: 빌드 스크립트** — `build-voice-guides.py`(subway-stations 파이프라인 동형, 표준 라이브러리만):

```python
#!/usr/bin/env python3
"""서울교통공사 음성유도기 CSV(OA-22526) → 정적 seed JSON.

다운로드부터 수행(재현 가능). cp949, 컬럼: 연번,호선,외부역번호,역명,설치위치.
역명 괄호 병기("서울역 (1)")를 제거하고 정규화 키(소문자·역 접미 제거)를 사전 계산한다.
갱신: 수동 재실행(연 1회 관례). 산출물 asOf는 원본 파일명 기준일.
"""
import csv, io, json, re, urllib.request, urllib.parse

URL = "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false"
BODY = urllib.parse.urlencode({"infId": "OA-22526", "seq": "1", "infSeq": "2"}).encode()
AS_OF = "2025-08"  # 원본 파일명 …_20250812.csv — 갱신 시 함께 수정

def normalize(name: str) -> str:
    n = re.sub(r"\s*\([^)]*\)", "", name).strip()
    n = re.sub(r"(?:\s+(?:\S*(?:선|철도)|GTX-\S*))+$", "", n).strip()
    n = re.sub(r"\s*station$", "", n, flags=re.I)
    n = re.sub(r"역$", "", n).strip()
    return n.lower()

req = urllib.request.Request(URL, data=BODY, method="POST")
raw = urllib.request.urlopen(req).read().decode("cp949")
rows = list(csv.reader(io.StringIO(raw)))[1:]
entries = []
for r in rows:
    if len(r) < 5 or not r[3].strip() or not r[4].strip():
        continue
    entries.append({"key": normalize(r[3]), "line": r[1].strip(), "location": r[4].strip()})
out = {"asOf": AS_OF, "entries": entries}
with open("src/lib/data/voice-guides.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(f"entries: {len(entries)}, stations: {len(set(e['key'] for e in entries))}")
```

실행: `python3 scripts/build-voice-guides.py` → `entries: 5551` 근처, stations ~222 확인.

- [ ] **Step 2: 실패 테스트** — `voice-guides.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findVoiceGuides, VOICE_GUIDES_AS_OF } from "../voice-guides";
import { normalizeStationName } from "../station-match";

describe("음성유도기 seed", () => {
  it("강동역 설치 위치가 조회된다(실 seed)", () => {
    const items = findVoiceGuides(normalizeStationName("강동역 5호선"));
    expect(items.length).toBeGreaterThan(10);
    expect(items[0].location).toBeTruthy();
  });
  it("미커버 역은 빈 배열", () => {
    expect(findVoiceGuides(normalizeStationName("서면역"))).toEqual([]);
  });
  it("기준일 상수가 노출된다", () => {
    expect(VOICE_GUIDES_AS_OF).toMatch(/^\d{4}-\d{2}$/);
  });
  it("괄호 제거가 별개 역을 합치지 않는다 — CSV 키의 괄호 변형은 동일 기저명뿐", () => {
    // seed 빌드 정규화의 안전성 스냅샷: 파이썬 normalize와 TS normalizeStationName이
    // 동일 결과를 내는지 CSV 유래 대표 변형으로 교차 검증
    for (const [rawName, expected] of [
      ["서울역 (1)", "서울"], ["동대문(4)", "동대문"], ["교대 (3)", "교대"],
      ["굽은다리(강동구민회관앞)", "굽은다리"],
    ] as const) {
      expect(normalizeStationName(rawName)).toBe(expected);
    }
  });
});
```

- [ ] **Step 3: 조회 모듈** — `voice-guides.ts`:

```ts
import rawGuides from "./data/voice-guides.json";

/**
 * 서울교통공사 음성유도기 설치 위치 정적 seed(OA-22526 CSV → build-voice-guides.py).
 * 서버 전용 import(클라이언트 번들 제외 — subway-stations 동형). 키는
 * normalizeStationName 결과와 동일 규칙으로 빌드 시 사전 계산돼 있다.
 */
const GUIDES = rawGuides as { asOf: string; entries: Array<{ key: string; line: string; location: string }> };

/** 출처 병기용 데이터 기준일(YYYY-MM) — 오래된 시설 정보의 정직성 장치(스펙 §1-C). */
export const VOICE_GUIDES_AS_OF = GUIDES.asOf;

/** 정규화 역명 키 → 설치 위치 목록(원문 순서 보존). 미커버는 []. */
export function findVoiceGuides(nameKey: string): Array<{ line: string; location: string }> {
  if (!nameKey) return [];
  return GUIDES.entries
    .filter((e) => e.key === nameKey)
    .map(({ line, location }) => ({ line, location }));
}
```

- [ ] **Step 4: 통과 확인** — `npm run test:run -- voice-guides` PASS.
- [ ] **Step 5: Commit** — `git add scripts/build-voice-guides.py src/lib/data/voice-guides.json src/lib/voice-guides.ts src/lib/__tests__/voice-guides.test.ts && git commit -m "feat(facilities): 음성유도기 정적 seed — OA-22526 CSV 파이프라인+정규화 키 조회(5,551건 275역)"`

---

### Task 7: 엘리베이터 위치 provider + 시설 패널 병합 + UI 보강

**Files:**
- Create: `src/lib/providers/seoul-elevator.ts`
- Modify: `src/lib/providers/seoul-metro-facilities.ts`(병합), `src/lib/types.ts`(`SeoulMetroFacilities.supplementFailed?: true`), `src/components/SeoulMetroFacilities.tsx`(문구 2종), `messages/*.json`(키 3개)
- Test: `src/lib/providers/__tests__/seoul-elevator.test.ts`, `src/lib/__tests__/seoul-metro-facilities.test.ts`(병합 케이스 추가)

**Interfaces:**
- Consumes: Task 1 `normalizeStationName`, Task 6 `findVoiceGuides`·`VOICE_GUIDES_AS_OF`, `findStationsByName`(기준 좌표), `bearingDegrees`·`bearingToCompass8`·`haversineMeters`(`src/lib/geo/bearing.ts`).
- Produces: `fetchSeoulElevators(): Promise<Array<{ stationKey: string; lat: number; lng: number; dong: string }>>`, 순수 `parseElevatorRows(raw)`·`composeElevatorItems(elevators, seedRows): SeoulMetroFacility[]`. `fetchSeoulMetroFacilities` 응답에 그룹 `voiceGuide`·`elevatorLocation` 및 `supplementFailed` 추가.

- [ ] **Step 1: 실패 테스트** — `seoul-elevator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseElevatorRows, composeElevatorItems } from "../seoul-elevator";

const raw = {
  tbTraficElvtr: {
    list_total_count: 2,
    RESULT: { CODE: "INFO-000" },
    row: [
      { NODE_WKT: "POINT(127.1329072 37.5359120)", SBWY_STN_NM: "강동", EMD_NM: "성내동" },
      { NODE_WKT: "POINT(127.1317901 37.5362824)", SBWY_STN_NM: "강동", EMD_NM: "성내동" },
      { NODE_WKT: "bogus", SBWY_STN_NM: "파싱불가" },
    ],
  },
};

describe("parseElevatorRows", () => {
  it("WKT(lng lat)를 파싱하고 비정상 행을 버린다", () => {
    const rows = parseElevatorRows(raw);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ stationKey: "강동", lat: 37.535912, lng: 127.1329072, dong: "성내동" });
  });
});

describe("composeElevatorItems — 방위·거리 ko 합성", () => {
  const seedRows = [
    { name: "강동", nameEn: "Gangdong", lineName: "5호선", operator: "서울교통공사", lat: 37.5354, lng: 127.1323, isTransfer: false },
  ];
  it("최근접 seed 좌표 기준 방위·거리 텍스트를 만든다", () => {
    const items = composeElevatorItems(parseElevatorRows(raw), seedRows);
    expect(items).toHaveLength(2);
    expect(items[0].name).toMatch(/^역 중심 기준 (북|북동|동|남동|남|남서|서|북서)쪽 약 \d+m, 성내동$/);
  });
  it("seed 좌표가 없으면 빈 배열(방위 없는 나열은 무가치)", () => {
    expect(composeElevatorItems(parseElevatorRows(raw), [])).toEqual([]);
  });
});
```

`seoul-metro-facilities.test.ts` 추가 케이스(기존 fixture 재사용 + 모킹):
```ts
// ① 강동(wksn elevator 그룹 존재) → elevatorLocation 그룹 없음, voiceGuide 그룹 존재(실 seed)
// ② wksn 전부 빈 raws + voiceGuide 매칭 있음 → 비-null 반환, groups=[voiceGuide]
// ③ 엘리베이터 fetch reject 모킹 → supplementFailed: true, 기존 그룹 보존
```

- [ ] **Step 2: 실패 확인** — FAIL.

- [ ] **Step 3: 구현**

`seoul-elevator.ts`:
```ts
import type { SeoulMetroFacility, SubwayStation } from "../types";
import { env } from "../env";
import { normalizeStationName } from "../station-match";
import { bearingDegrees, bearingToCompass8, haversineMeters } from "../geo/bearing";

/**
 * 서울 지하철 엘리베이터 위치(OA-21212 tbTraficElvtr) — wksn 미커버 노선(9호선·
 * 우이신설 등) 폴백 전용. 위치 설명이 없어 방위·거리 텍스트를 합성한다(스펙 §1-B).
 */
const BASE = "http://openapi.seoul.go.kr:8088";
const PAGE = 1000;
const MAX_PAGES = 5;

const COMPASS_KO: Record<string, string> = {
  n: "북", ne: "북동", e: "동", se: "남동", s: "남", sw: "남서", w: "서", nw: "북서",
};

export interface ElevatorPoint { stationKey: string; lat: number; lng: number; dong: string; }

export function parseElevatorRows(raw: unknown): ElevatorPoint[] {
  const row = (raw as { tbTraficElvtr?: { row?: unknown } })?.tbTraficElvtr?.row;
  if (!Array.isArray(row)) return [];
  return row.flatMap((it) => {
    const o = it as Record<string, unknown>;
    const m = String(o.NODE_WKT ?? "").match(/^POINT\(([\d.]+) ([\d.]+)\)$/);
    const name = String(o.SBWY_STN_NM ?? "").trim();
    if (!m || !name) return [];
    const lng = Number(m[1]);
    const lat = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    return [{ stationKey: normalizeStationName(name), lat, lng, dong: String(o.EMD_NM ?? "").trim() }];
  });
}

/** 전체 목록(페이지 루프 — list_total_count 확인, 따릉이 동형). 실패는 throw(호출부 allSettled). */
export async function fetchSeoulElevators(): Promise<ElevatorPoint[]> {
  if (!env.SEOUL_OPEN_DATA_KEY) return [];
  const key = env.SEOUL_OPEN_DATA_KEY;
  let all: ElevatorPoint[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE + 1;
    const end = start + PAGE - 1;
    const res = await fetch(`${BASE}/${key}/json/tbTraficElvtr/${start}/${end}/`, {
      next: { revalidate: 86_400 },
    });
    if (!res.ok) throw new Error(`tbTraficElvtr HTTP ${res.status}`);
    const raw: unknown = await res.json();
    const svc = (raw as { tbTraficElvtr?: { RESULT?: { CODE?: string }; row?: unknown[] } })?.tbTraficElvtr;
    if (svc?.RESULT?.CODE !== "INFO-000") throw new Error(`tbTraficElvtr ${svc?.RESULT?.CODE ?? "비정상"}`);
    const rowCount = Array.isArray(svc.row) ? svc.row.length : 0;
    all = all.concat(parseElevatorRows(raw));
    if (rowCount < PAGE) break;
  }
  return all;
}

/**
 * 방위·거리 항목 합성 — 기준점은 매칭 seed 행 중 그 엘리베이터와 최근접 좌표
 * (환승역 복수 좌표에서 임의 첫 행 금지, 스펙 §2-C). "역 중심 기준"을 명시해
 * 출입구 방향으로 오인하지 않게 한다. seed 좌표 없으면 [](그룹 생략).
 */
export function composeElevatorItems(
  elevators: ElevatorPoint[],
  seedRows: Pick<SubwayStation, "lat" | "lng">[],
): SeoulMetroFacility[] {
  if (seedRows.length === 0) return [];
  return elevators.map((e) => {
    const anchor = seedRows.reduce((best, s) =>
      haversineMeters(s.lat, s.lng, e.lat, e.lng) < haversineMeters(best.lat, best.lng, e.lat, e.lng) ? s : best,
    );
    const meters = Math.round(haversineMeters(anchor.lat, anchor.lng, e.lat, e.lng) / 10) * 10;
    const compass = COMPASS_KO[bearingToCompass8(bearingDegrees(anchor.lat, anchor.lng, e.lat, e.lng))];
    const name = e.dong
      ? `역 중심 기준 ${compass}쪽 약 ${meters}m, ${e.dong}`
      : `역 중심 기준 ${compass}쪽 약 ${meters}m`;
    return { name };
  });
}
```

`types.ts` — `SeoulMetroFacilities`에 `supplementFailed?: true` 추가(주석: "보강 소스(OA-21212) 실패 시 — 실패 은폐 금지, 스펙 §2-C").

`seoul-metro-facilities.ts` — `fetchSeoulMetroFacilities` 말미를 병합 구조로 교체:

```ts
export async function fetchSeoulMetroFacilities(
  stationName: string,
): Promise<SeoulMetroFacilities | null> {
  const target = normalizeStationName(stationName);
  if (!target) return null;
  const { lineHint } = parseStationQuery(stationName);

  // 주 조회(wksn)와 보강(엘리베이터 위치)을 분리 — 주 실패는 throw(502) 유지,
  // 보강 실패는 supplementFailed로 표기(무음 은폐 금지, 스펙 §2-C).
  const key = env.DATA_GO_KR_API_KEY;
  let base: SeoulMetroFacilities | null = null;
  if (key) {
    const query = stripStationDecorations(stationName);
    const kinds = Object.keys(OPERATIONS) as SeoulMetroFacilityKind[];
    const results = await Promise.all(kinds.map((k) => fetchOp(OPERATIONS[k], query, key)));
    const raws = Object.fromEntries(kinds.map((k, i) => [k, results[i]])) as Record<SeoulMetroFacilityKind, unknown>;
    base = parseSeoulMetroFacilities(raws, stationName);
  }

  const groups = base ? [...base.groups] : [];

  // 음성유도기(정적 seed — 실패 경로 없음)
  const guides = findVoiceGuides(target);
  if (guides.length > 0) {
    const multiLine = new Set(guides.map((g) => g.line).filter(Boolean)).size > 1;
    groups.push({
      kind: "voiceGuide",
      facilities: guides.map((g) => ({
        name: joinText(g.location, multiLine && g.line ? `${g.line}호선` : ""),
      })),
    });
  }

  // 엘리베이터 위치 폴백 — wksn elevator 그룹이 없을 때만
  let supplementFailed = false;
  if (!groups.some((g) => g.kind === "elevator")) {
    const [settled] = await Promise.allSettled([fetchSeoulElevators()]);
    if (settled.status === "fulfilled") {
      const matched = settled.value.filter((e) => e.stationKey === target);
      if (matched.length > 0) {
        const seedRows = findStationsByName(stationName, lineHint);
        const items = composeElevatorItems(matched, seedRows);
        if (items.length > 0) groups.push({ kind: "elevatorLocation", facilities: items });
      }
    } else {
      supplementFailed = true;
    }
  }

  if (groups.length === 0) return base; // null(전부 없음) 또는 기존 계약 그대로
  return {
    stationName: (base?.stationName ?? stripStationDecorations(stationName)) || stationName,
    line: base?.line,
    groups,
    ...(supplementFailed ? { supplementFailed: true as const } : {}),
  };
}
```

주의: `joinText`는 `src/lib/format.ts`에서 import. 기존 `fetchSeoulMetroFacilities`의 키 없음 조기 반환(`if (!key) return null`)은 제거된다 — 키 없어도 voiceGuide seed는 동작해야 한다(게이트는 wksn 부분에만). `parseFacilityGroup`/`parseSeoulMetroFacilities`의 lineHint 병용은 Task 2에서 반영됨.

`SeoulMetroFacilities.tsx`(웹): done 렌더에 두 줄 추가 —
```tsx
{status.facilities.supplementFailed && (
  <p className="mt-2 text-sm">{t("supplementFailed")}</p>
)}
{status.facilities.groups.some((g) => g.kind === "voiceGuide") && (
  <p className="mt-2 text-xs opacity-70">{t("voiceGuideSource", { asOf: VOICE_GUIDES_AS_OF })}</p>
)}
```
주의: `VOICE_GUIDES_AS_OF`는 서버 전용 seed 모듈이므로 클라이언트 컴포넌트에서 직접 import 금지 — **라우트 응답에 실어 보내는 대신, 값이 정적이므로 i18n 메시지에 하드코딩한다**: `voiceGuideSource: "음성유도기: 서울교통공사 제공(2025-08 기준)"`(5로케일, seed 갱신 시 build 스크립트 AS_OF와 함께 수동 동기 — 스크립트 주석에 명시).

i18n 키(5로케일): `subway.kind.voiceGuide`("시각장애인 음성유도기" / "Audio guidance beacons"), `subway.kind.elevatorLocation`("엘리베이터 위치" / "Elevator locations"), `subway.supplementFailed`("일부 시설 정보를 불러오지 못했습니다." / "Some facility info couldn't be loaded."), `subway.voiceGuideSource`(위).

- [ ] **Step 4: 통과 확인** — `npm run test:run` 전체 green, `npm run lint`.
- [ ] **Step 5: 실호출 스모크**:
```bash
curl -s "http://localhost:3000/api/station/metro-facilities?station=$(python3 -c "import urllib.parse;print(urllib.parse.quote('강동역 5호선'))")" | python3 -c "import json,sys; d=json.load(sys.stdin)['facilities']; print([ (g['kind'], len(g['facilities'])) for g in d['groups']])"
# 기대: 기존 wksn 그룹들 + ('voiceGuide', 21±), elevatorLocation 없음
curl -s "http://localhost:3000/api/station/metro-facilities?station=%EB%B4%89%EC%9D%80%EC%82%AC%EC%97%AD" | python3 -m json.tool | head -30
# 기대: 비-null, groups에 elevatorLocation(방위·거리 텍스트)
```
- [ ] **Step 6: Commit** — `git add src/lib/providers/seoul-elevator.ts src/lib/providers/seoul-metro-facilities.ts src/lib/types.ts src/components/SeoulMetroFacilities.tsx messages/*.json src/lib/providers/__tests__/seoul-elevator.test.ts src/lib/__tests__/seoul-metro-facilities.test.ts && git commit -m "feat(facilities): 시설 패널 보강 — 음성유도기 그룹+엘리베이터 위치 폴백(9호선 커버)+supplementFailed"`

---

### Task 8: 실호출 머지 게이트 + 특일 활용신청 + a11y 감사 (메인 세션 직접 수행)

- [ ] **Step 1: 특일정보 활용신청 시도** — Claude in Chrome으로 data.go.kr 15012690 활용신청(로그인 상태면 자동승인). 실패 시 위원장 후속 작업으로 보고하고 요일 폴백 동작만 검증.
- [ ] **Step 2: 실호출 게이트 7항목**(스펙 §5) 전부 실행·기록 — 강동역 5호선 timetable(첫차 05시대·막차 익일)/서면역/양평역 5호선(경의중앙 미혼입)/metro-facilities 강동(voiceGuide 21)/봉은사(elevatorLocation)/meta 강동역 5호선/특일(또는 폴백).
- [ ] **Step 3: `a11y-auditor` 서브에이전트** — 신규 StationTimetable 섹션(region·h3·한 줄 한 객체·기준 라벨·실패 문장)과 SeoulMetroFacilities 변경분 점검.
- [ ] **Step 4: `npm run lint && npm run test:run && npm run build`** 최종 확인.

### Task 9: 최종 리뷰 + 문서 갱신 + push

- [ ] **Step 1: 전체 브랜치 코드리뷰** — code-reviewer 서브에이전트로 마일스톤 diff 검토(포커스: 3-state 판정 표·매칭 회귀·레이트리밋·캐시). 지적은 codex 처리 원칙(계층 대조 우선)으로 처리.
- [ ] **Step 2: 문서** — PROGRESS.md 운영 표에 행 추가·"미해결" 로드맵 갱신(역 상세 보강 완료 표기), CLAUDE.md 통합 카탈로그에 2행(TAGO 지하철 시간표·서울 엘리베이터/음성유도기) 추가. `python ../sync_agent_docs.py`(워크스페이스 루트) 실행으로 AGENTS.md 재생성.
- [ ] **Step 3: push** — 리뷰 통과 후 `git push`(자동배포). 배포 후 prod 실호출 spot check(timetable 강동역 5호선·metro-facilities 봉은사역).

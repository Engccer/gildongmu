# 이 지역 날씨(기상청+공기질 통합) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈·장소 상세의 공기질 카드를 "이 지역 날씨" 단일 region으로 확장해 기상청 현재 날씨(하늘상태·강수형태·현재기온·최고/최저·습도·강수확률)와 공기질을 한 섹션으로 묶는다.

**Architecture:** 신규 `weather.ts` provider가 WGS84→기상청 격자(LCC) 변환 후 초단기실황+단기예보 2-오퍼레이션을 `Promise.allSettled`로 합성한다(공기질 `air-quality.ts` 패턴 미러). 신규 `LocalConditions` 컴포넌트가 날씨·공기질 두 fetch를 소유해 단일 `<section><h3>이 지역 날씨</h3>`로 렌더하며, 둘 다 null이면 렌더하지 않는다. 기존 `AirQuality` 표시부는 headless `AirQualityBody`로 추출해 두 곳에서 공유한다.

**Tech Stack:** Next.js 16(App Router, Route Handler), TypeScript, next-intl 4(5개 언어), zod 4, Vitest 4(순수 로직 fixture). 기상청 단기예보 API(data.go.kr `DATA_GO_KR_API_KEY` 공유, 신규 키 없음).

## Global Constraints

- 코드 주석·커밋 메시지·문서: 한국어. 변수/함수명: 영어. 커밋 이메일 `engccer@gmail.com`.
- **mock 폴백 없음** — 키 없음/미커버/무데이터 → null(graceful 숨김), upstream 장애 → throw → 502. dodo의 정적 더미 데이터(−2°C 서울)는 이식하지 않는다(가짜 실데이터 금지).
- **상태 단어가 낭독 정본**: 하늘상태/강수형태 단어가 1차 정보, 수치는 보강. 미매핑 코드 → "정보 없음"(unknown).
- 게이트는 `hasDataGoKrKey()` 재사용(날씨·공기질 동일 키, 별도 `canShowWeather` 신설 금지).
- 접근성: 단일 region "이 지역 날씨"(`<section aria-labelledby>` + `<h3>`), 평문 `<p>`(definition list 금지·콜론 낭독 노이즈), `lang="ko"`(한글 고유명) 유지. ARIA 추가 금지(시맨틱 HTML만).
- 커밋 시 **명시 파일만 stage**(`git add -A` 금지 — 워킹 트리에 병렬 변경 공존). 각 task 끝에 의도 파일만 add 후 commit.
- 좌표 검증 범위: lat 33~43, lng 124~132(공기질 라우트와 동일).
- 선행조건: data.go.kr `DATA_GO_KR_API_KEY` 계정에 **기상청_단기예보조회서비스(15084084) 활용신청**(자동승인 ~5분). Task 1~7은 선행 가능, Task 8(실호출)만 승인 필요.

---

### Task 1: 격자 변환 `latLngToGrid` + Weather 타입

WGS84 위경도 → 기상청 격자(nx, ny) Lambert 정각원추 변환(공식 `dfs_xy_conv`). 순수·결정적, fixture로 잠근다. + `Weather`/라벨 타입 정의.

**Files:**
- Create: `src/lib/providers/weather.ts`
- Modify: `src/lib/types.ts` (AirQuality 블록 뒤에 Weather 타입 추가)
- Test: `src/lib/__tests__/weather.test.ts`

**Interfaces:**
- Produces:
  - `latLngToGrid(lat: number, lng: number): { nx: number; ny: number }`
  - 타입: `SkyLabel`, `PrecipLabel`, `Weather`

- [ ] **Step 1: Weather 타입 추가** (`src/lib/types.ts`, 기존 `AirQuality` 인터페이스 정의 바로 뒤에 삽입)

```typescript
/** 하늘상태 라벨 — 기상청 SKY 코드(1/3/4) 매핑. 미매핑 → unknown. */
export type SkyLabel = "clear" | "partlyCloudy" | "cloudy" | "unknown";

/** 강수형태 라벨 — 기상청 PTY 코드(0~4) 매핑. 미매핑 → unknown. */
export type PrecipLabel =
  | "none"
  | "rain"
  | "rainSnow"
  | "snow"
  | "shower"
  | "unknown";

/**
 * 이 지역 날씨 — 기상청 초단기실황(현재 실측) + 단기예보(하늘상태·최고최저·강수확률) 합성.
 *
 * 상태 단어(하늘상태/강수형태)가 낭독 정본, 수치는 보강. 부분 성공 가능
 * (실황만/예보만) — 없는 값은 null(해당 줄 생략). 둘 다 없으면 Weather 자체가 null.
 */
export interface Weather {
  /** 하늘상태(단기예보 SKY). 예보 부재 → label "unknown" */
  sky: { code: number | null; label: SkyLabel };
  /** 강수형태(초단기실황 PTY). 실황 부재 → label "unknown" */
  precipitation: { code: number | null; label: PrecipLabel };
  /** 현재기온(°C, 초단기실황 T1H). 부재 → null */
  tempC: number | null;
  /** 일 최고기온(단기예보 TMX, 오늘분). 부재 → null */
  tempMax: number | null;
  /** 일 최저기온(단기예보 TMN, 오늘분). 부재 → null */
  tempMin: number | null;
  /** 습도(%, 초단기실황 REH). 부재 → null */
  humidity: number | null;
  /** 강수확률(%, 단기예보 POP). 부재 → null */
  precipProbability: number | null;
  /** 조회 기준 시각 "HH:mm"(실황 base_time). 낭독 "조회시각" */
  baseTime: string;
  /** 기상청 격자(디버그·캐시 키) */
  grid: { nx: number; ny: number };
}
```

- [ ] **Step 2: Write the failing test** (`src/lib/__tests__/weather.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
import { latLngToGrid } from "../providers/weather";

describe("latLngToGrid", () => {
  it("서울시청(37.5665, 126.9780) → nx 60, ny 127 (기상청 레퍼런스)", () => {
    expect(latLngToGrid(37.5665, 126.978)).toEqual({ nx: 60, ny: 127 });
  });

  it("동일 입력 동일 출력(결정적)", () => {
    const a = latLngToGrid(37.538, 127.139);
    const b = latLngToGrid(37.538, 127.139);
    expect(a).toEqual(b);
  });

  it("정수 격자를 반환한다", () => {
    const { nx, ny } = latLngToGrid(35.1796, 129.0756); // 부산
    expect(Number.isInteger(nx)).toBe(true);
    expect(Number.isInteger(ny)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/weather.test.ts`
Expected: FAIL — `latLngToGrid` is not a function / 모듈 없음.

- [ ] **Step 4: Write minimal implementation** (`src/lib/providers/weather.ts`, 파일 생성)

```typescript
/**
 * 이 지역 날씨 provider — 기상청 단기예보 API(data.go.kr 15084084).
 *
 * 2-오퍼레이션 체인: WGS84→격자(LCC) 변환 → 초단기실황(getUltraSrtNcst, 현재
 * 실측 기온·습도·강수형태) + 단기예보(getVilageFcst, 하늘상태·최고최저·강수확률).
 * 인증: data.go.kr serviceKey(`DATA_GO_KR_API_KEY`, 공기질/버스와 동일 키).
 *
 * 정본 원칙(설계 `docs/superpowers/specs/2026-06-20-local-weather-conditions-design.md`):
 * - 격자 변환은 기상청 공식 LCC 알고리즘(자체 파라미터라 표준 EPSG 없음 — 직접 이식).
 * - 상태 단어(하늘상태/강수형태)가 낭독 정본, 수치는 보강. 미매핑 코드 → unknown.
 * - upstream 장애 → throw → 502. 무데이터·미커버 → null(graceful). mock 폴백 없음.
 * - 부분 성공 보존: 실황·예보를 allSettled 독립 처리, 둘 다 실패해야 throw.
 */

import type { PrecipLabel, SkyLabel, Weather } from "../types";
import { env } from "../env";

/** 기상청 격자 변환 상수(공식 dfs_xy_conv). */
const RE = 6371.00877; // 지구 반경(km)
const GRID = 5.0; // 격자 간격(km)
const SLAT1 = 30.0; // 표준 위도 1
const SLAT2 = 60.0; // 표준 위도 2
const OLON = 126.0; // 기준점 경도
const OLAT = 38.0; // 기준점 위도
const XO = 43; // 기준점 격자 X
const YO = 136; // 기준점 격자 Y

/** WGS84(위도, 경도) → 기상청 격자(nx, ny). 순수·결정적(Lambert 정각원추). */
export function latLngToGrid(lat: number, lng: number): { nx: number; ny: number } {
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn =
    Math.tan(Math.PI * 0.25 + slat2 * 0.5) /
    Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  const nx = Math.floor(ra * Math.sin(theta) + XO + 0.5);
  const ny = Math.floor(ro - ra * Math.cos(theta) + YO + 0.5);
  return { nx, ny };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/weather.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/providers/weather.ts src/lib/types.ts src/lib/__tests__/weather.test.ts
git commit -m "feat(weather): 기상청 격자 변환(LCC)·Weather 타입 추가

WGS84→기상청 격자(nx,ny) dfs_xy_conv 변환(서울 60/127 잠금).
Weather/SkyLabel/PrecipLabel 타입 정의. 순수·결정적 fixture 테스트.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: base_date/base_time 계산(KST)

초단기실황(매시 40분 이후 제공)·단기예보(02/05/.../23시 발표) 발표시각을 서버 KST로 결정적 산출. 자정·40분 경계 fixture.

**Files:**
- Modify: `src/lib/providers/weather.ts`
- Test: `src/lib/__tests__/weather.test.ts`

**Interfaces:**
- Produces:
  - `ultraSrtNcstBaseTime(now: Date): { baseDate: string; baseTime: string }` — "YYYYMMDD","HHmm"
  - `vilageFcstBaseTime(now: Date): { baseDate: string; baseTime: string }`

- [ ] **Step 1: Write the failing test** (append to `src/lib/__tests__/weather.test.ts`)

```typescript
import { ultraSrtNcstBaseTime, vilageFcstBaseTime } from "../providers/weather";

describe("ultraSrtNcstBaseTime (KST, 40분 경계)", () => {
  it("KST 13:30(분<40) → 직전 정시 12:00", () => {
    // 2026-06-20T04:30:00Z == KST 13:30
    expect(ultraSrtNcstBaseTime(new Date("2026-06-20T04:30:00Z"))).toEqual({
      baseDate: "20260620",
      baseTime: "1200",
    });
  });

  it("KST 13:50(분>=40) → 당시 정시 13:00", () => {
    expect(ultraSrtNcstBaseTime(new Date("2026-06-20T04:50:00Z"))).toEqual({
      baseDate: "20260620",
      baseTime: "1300",
    });
  });

  it("KST 00:10 → 전날 23:00(자정 경계)", () => {
    // 2026-06-19T15:10:00Z == KST 00:10(20일)
    expect(ultraSrtNcstBaseTime(new Date("2026-06-19T15:10:00Z"))).toEqual({
      baseDate: "20260619",
      baseTime: "2300",
    });
  });
});

describe("vilageFcstBaseTime (KST, 발표시각)", () => {
  it("KST 13:30 → 11:00 발표분(가장 최근)", () => {
    expect(vilageFcstBaseTime(new Date("2026-06-20T04:30:00Z"))).toEqual({
      baseDate: "20260620",
      baseTime: "1100",
    });
  });

  it("KST 01:00(첫 발표 전) → 전날 23:00", () => {
    // 2026-06-19T16:00:00Z == KST 01:00(20일)
    expect(vilageFcstBaseTime(new Date("2026-06-19T16:00:00Z"))).toEqual({
      baseDate: "20260619",
      baseTime: "2300",
    });
  });

  it("KST 14:05(14시 발표+10분 미경과) → 11:00", () => {
    expect(vilageFcstBaseTime(new Date("2026-06-20T05:05:00Z"))).toEqual({
      baseDate: "20260620",
      baseTime: "1100",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/weather.test.ts`
Expected: FAIL — `ultraSrtNcstBaseTime` / `vilageFcstBaseTime` is not a function.

- [ ] **Step 3: Write minimal implementation** (append to `src/lib/providers/weather.ts`)

```typescript
/** KST(+9) 벽시계 구성요소. 서버 TZ와 무관하게 결정적(공기질·B1 동형). */
function kstParts(now: Date): {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
} {
  const shifted = new Date(now.getTime() + 9 * 3_600_000);
  return {
    y: shifted.getUTCFullYear(),
    mo: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    mi: shifted.getUTCMinutes(),
  };
}

/** (y, 0-based month, d) → "YYYYMMDD". */
function fmtDate(y: number, mo: number, d: number): string {
  return (
    String(y) +
    String(mo + 1).padStart(2, "0") +
    String(d).padStart(2, "0")
  );
}

/** KST 자정 직전 날짜로 하루 되돌린 "YYYYMMDD"(자정 경계용). */
function prevDate(y: number, mo: number, d: number): string {
  const prev = new Date(Date.UTC(y, mo, d) - 24 * 3_600_000);
  return fmtDate(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate());
}

/**
 * 초단기실황 base_date/base_time(KST). 매시 정시 발표·40분 이후 제공이라
 * 분<40이면 직전 정시 사용. 00시대에 되돌리면 전날 23시.
 */
export function ultraSrtNcstBaseTime(now: Date): {
  baseDate: string;
  baseTime: string;
} {
  const p = kstParts(now);
  let h = p.h;
  let date = fmtDate(p.y, p.mo, p.d);
  if (p.mi < 40) h -= 1;
  if (h < 0) {
    h = 23;
    date = prevDate(p.y, p.mo, p.d);
  }
  return { baseDate: date, baseTime: String(h).padStart(2, "0") + "00" };
}

const FCST_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];

/**
 * 단기예보 base_date/base_time(KST). 발표시각(02/05/…/23) 중 발표+10분이
 * 현재 이하인 가장 최근. 첫 발표(02:10) 전이면 전날 23시.
 */
export function vilageFcstBaseTime(now: Date): {
  baseDate: string;
  baseTime: string;
} {
  const p = kstParts(now);
  const mins = p.h * 60 + p.mi;
  let chosen = -1;
  for (const fh of FCST_HOURS) {
    if (fh * 60 + 10 <= mins) chosen = fh;
  }
  if (chosen === -1) {
    return { baseDate: prevDate(p.y, p.mo, p.d), baseTime: "2300" };
  }
  return {
    baseDate: fmtDate(p.y, p.mo, p.d),
    baseTime: String(chosen).padStart(2, "0") + "00",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/weather.test.ts`
Expected: PASS (격자 3 + base_time 6 = 9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/weather.ts src/lib/__tests__/weather.test.ts
git commit -m "feat(weather): 초단기실황·단기예보 base_time 계산(KST 경계)

매시 40분 제공·발표시각(02/05/…/23) 규칙을 서버 KST로 결정적 산출.
자정·40분·발표+10분 경계 fixture 테스트.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: item 파싱 + 코드→라벨 + 합성

기상청 응답 item 배열에서 실황(T1H/REH/PTY)·예보(SKY/TMX/TMN/POP) 추출, 코드→라벨 매핑(미매핑 unknown), 부분 성공 합성. 모두 순수·fixture.

**Files:**
- Modify: `src/lib/providers/weather.ts`
- Test: `src/lib/__tests__/weather.test.ts`

**Interfaces:**
- Consumes: `Weather`, `SkyLabel`, `PrecipLabel` (Task 1)
- Produces:
  - `skyLabel(code: unknown): SkyLabel`
  - `precipLabel(code: unknown): PrecipLabel`
  - `parseNcst(raw: unknown): { tempC: number | null; humidity: number | null; precipitation: { code: number | null; label: PrecipLabel } } | null`
  - `parseFcst(raw: unknown, todayYmd: string): { sky: { code: number | null; label: SkyLabel }; tempMax: number | null; tempMin: number | null; precipProbability: number | null } | null`
  - `mergeWeather(ncst, fcst, baseTime, grid): Weather | null`

- [ ] **Step 1: Write the failing test** (append to `src/lib/__tests__/weather.test.ts`)

```typescript
import {
  skyLabel,
  precipLabel,
  parseNcst,
  parseFcst,
  mergeWeather,
} from "../providers/weather";

describe("skyLabel / precipLabel (미매핑 → unknown)", () => {
  it("SKY 1/3/4 → clear/partlyCloudy/cloudy", () => {
    expect(skyLabel("1")).toBe("clear");
    expect(skyLabel("3")).toBe("partlyCloudy");
    expect(skyLabel("4")).toBe("cloudy");
    expect(skyLabel("9")).toBe("unknown");
  });
  it("PTY 0~4 → none/rain/rainSnow/snow/shower, 그 외 unknown", () => {
    expect(precipLabel("0")).toBe("none");
    expect(precipLabel("1")).toBe("rain");
    expect(precipLabel("2")).toBe("rainSnow");
    expect(precipLabel("3")).toBe("snow");
    expect(precipLabel("4")).toBe("shower");
    expect(precipLabel("")).toBe("unknown");
  });
});

const NCST_RAW = {
  response: {
    header: { resultCode: "00" },
    body: {
      items: {
        item: [
          { category: "T1H", obsrValue: "21.3" },
          { category: "REH", obsrValue: "55" },
          { category: "PTY", obsrValue: "0" },
          { category: "WSD", obsrValue: "1.2" },
        ],
      },
    },
  },
};

const FCST_RAW = {
  response: {
    header: { resultCode: "00" },
    body: {
      items: {
        item: [
          { category: "SKY", fcstDate: "20260620", fcstTime: "1500", fcstValue: "3" },
          { category: "POP", fcstDate: "20260620", fcstTime: "1500", fcstValue: "20" },
          { category: "TMX", fcstDate: "20260620", fcstTime: "1500", fcstValue: "27.0" },
          { category: "TMN", fcstDate: "20260620", fcstTime: "0600", fcstValue: "18.0" },
          { category: "SKY", fcstDate: "20260621", fcstTime: "1500", fcstValue: "1" },
        ],
      },
    },
  },
};

describe("parseNcst", () => {
  it("T1H/REH/PTY 추출", () => {
    expect(parseNcst(NCST_RAW)).toEqual({
      tempC: 21.3,
      humidity: 55,
      precipitation: { code: 0, label: "none" },
    });
  });
  it("빈 응답 → null", () => {
    expect(parseNcst({ response: { body: { items: "" } } })).toBeNull();
  });
});

describe("parseFcst", () => {
  it("가장 이른 SKY/POP + 오늘 TMX/TMN", () => {
    expect(parseFcst(FCST_RAW, "20260620")).toEqual({
      sky: { code: 3, label: "partlyCloudy" },
      tempMax: 27,
      tempMin: 18,
      precipProbability: 20,
    });
  });
  it("오늘 TMX/TMN 없으면 null 값(예보가 내일치뿐)", () => {
    const r = parseFcst(FCST_RAW, "20260621");
    expect(r?.tempMax).toBeNull();
    expect(r?.tempMin).toBeNull();
  });
});

describe("mergeWeather (부분 성공)", () => {
  const grid = { nx: 60, ny: 127 };
  it("실황+예보 모두 → 완전 Weather", () => {
    const ncst = parseNcst(NCST_RAW)!;
    const fcst = parseFcst(FCST_RAW, "20260620")!;
    const w = mergeWeather(ncst, fcst, "13:00", grid)!;
    expect(w.tempC).toBe(21.3);
    expect(w.sky.label).toBe("partlyCloudy");
    expect(w.precipitation.label).toBe("none");
    expect(w.tempMax).toBe(27);
    expect(w.humidity).toBe(55);
    expect(w.precipProbability).toBe(20);
    expect(w.baseTime).toBe("13:00");
  });
  it("예보만(실황 null) → 기온·습도 null, 하늘상태 보존", () => {
    const fcst = parseFcst(FCST_RAW, "20260620")!;
    const w = mergeWeather(null, fcst, "13:00", grid)!;
    expect(w.tempC).toBeNull();
    expect(w.sky.label).toBe("partlyCloudy");
    expect(w.precipitation.label).toBe("unknown");
  });
  it("둘 다 null → null", () => {
    expect(mergeWeather(null, null, "13:00", grid)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/weather.test.ts`
Expected: FAIL — `skyLabel` 등 미정의.

- [ ] **Step 3: Write minimal implementation** (append to `src/lib/providers/weather.ts`)

```typescript
type RawItem = Record<string, unknown>;

/** 수치 문자열 → number. 빈 값·"-"·비유한 → null. */
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * 기상청 표준 envelope items 추출 — `response.body.items.item[]`.
 * (공기질 에어코리아의 직접 배열 quirk와 다름 — 기상청은 표준 item 중첩.)
 * 빈 결과 `items:""` → []. resultCode≠"00" 검증은 fetch 계층 책임.
 */
function extractItems(raw: unknown): RawItem[] {
  const items = (raw as { response?: { body?: { items?: unknown } } })?.response
    ?.body?.items;
  if (!items || typeof items === "string") return [];
  const item = (items as { item?: unknown }).item;
  if (item == null) return [];
  return Array.isArray(item) ? (item as RawItem[]) : [item as RawItem];
}

/** SKY 코드 → 라벨. 1 맑음·3 구름많음·4 흐림, 그 외 unknown. */
export function skyLabel(code: unknown): SkyLabel {
  switch (String(code ?? "").trim()) {
    case "1":
      return "clear";
    case "3":
      return "partlyCloudy";
    case "4":
      return "cloudy";
    default:
      return "unknown";
  }
}

/** PTY 코드 → 라벨. 0 없음·1 비·2 비눈·3 눈·4 소나기, 그 외 unknown. */
export function precipLabel(code: unknown): PrecipLabel {
  switch (String(code ?? "").trim()) {
    case "0":
      return "none";
    case "1":
      return "rain";
    case "2":
      return "rainSnow";
    case "3":
      return "snow";
    case "4":
      return "shower";
    default:
      return "unknown";
  }
}

/** 카테고리별 첫 obsrValue. */
function ncstValue(items: RawItem[], category: string): unknown {
  return items.find((it) => String(it.category).trim() === category)?.obsrValue;
}

/** 초단기실황 → 현재기온·습도·강수형태. 빈 응답 → null. */
export function parseNcst(raw: unknown): {
  tempC: number | null;
  humidity: number | null;
  precipitation: { code: number | null; label: PrecipLabel };
} | null {
  const items = extractItems(raw);
  if (items.length === 0) return null;
  const ptyRaw = ncstValue(items, "PTY");
  return {
    tempC: numOrNull(ncstValue(items, "T1H")),
    humidity: numOrNull(ncstValue(items, "REH")),
    precipitation: { code: numOrNull(ptyRaw), label: precipLabel(ptyRaw) },
  };
}

/** fcstDate+fcstTime 오름차순 키. */
function fcstKey(it: RawItem): string {
  return String(it.fcstDate ?? "") + String(it.fcstTime ?? "");
}

/** 카테고리의 fcst 항목들 중 시각 오름차순 첫 항목 fcstValue. */
function firstFcst(items: RawItem[], category: string): unknown {
  const matched = items
    .filter((it) => String(it.category).trim() === category)
    .sort((a, b) => fcstKey(a).localeCompare(fcstKey(b)));
  return matched[0]?.fcstValue;
}

/** 카테고리의 오늘(todayYmd) 항목 fcstValue. */
function todayFcst(
  items: RawItem[],
  category: string,
  todayYmd: string,
): unknown {
  return items.find(
    (it) =>
      String(it.category).trim() === category &&
      String(it.fcstDate).trim() === todayYmd,
  )?.fcstValue;
}

/**
 * 단기예보 → 하늘상태(가장 이른 SKY)·강수확률(가장 이른 POP)·오늘 최고/최저.
 * 빈 응답 → null. 오늘 TMX/TMN이 예보에 없으면(밤늦게) 해당 값 null.
 */
export function parseFcst(
  raw: unknown,
  todayYmd: string,
): {
  sky: { code: number | null; label: SkyLabel };
  tempMax: number | null;
  tempMin: number | null;
  precipProbability: number | null;
} | null {
  const items = extractItems(raw);
  if (items.length === 0) return null;
  const skyRaw = firstFcst(items, "SKY");
  return {
    sky: { code: numOrNull(skyRaw), label: skyLabel(skyRaw) },
    tempMax: numOrNull(todayFcst(items, "TMX", todayYmd)),
    tempMin: numOrNull(todayFcst(items, "TMN", todayYmd)),
    precipProbability: numOrNull(firstFcst(items, "POP")),
  };
}

/** 실황·예보 합성 → Weather. 둘 다 null이면 null(빈 카드 금지). */
export function mergeWeather(
  ncst: ReturnType<typeof parseNcst>,
  fcst: ReturnType<typeof parseFcst>,
  baseTime: string,
  grid: { nx: number; ny: number },
): Weather | null {
  if (!ncst && !fcst) return null;
  return {
    sky: fcst?.sky ?? { code: null, label: "unknown" },
    precipitation: ncst?.precipitation ?? { code: null, label: "unknown" },
    tempC: ncst?.tempC ?? null,
    tempMax: fcst?.tempMax ?? null,
    tempMin: fcst?.tempMin ?? null,
    humidity: ncst?.humidity ?? null,
    precipProbability: fcst?.precipProbability ?? null,
    baseTime,
    grid,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/weather.test.ts`
Expected: PASS (격자 3 + base_time 6 + 파싱/라벨/합성 9 = 18 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/weather.ts src/lib/__tests__/weather.test.ts
git commit -m "feat(weather): 실황·예보 item 파싱·코드 라벨·부분성공 합성

T1H/REH/PTY·SKY/TMX/TMN/POP 추출, SKY/PTY 코드→라벨(미매핑 unknown),
실황만/예보만도 보존하는 mergeWeather. fixture 결정적 테스트.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: fetch 합성 `findWeatherNear` + 라우트

2-오퍼레이션 호출(allSettled)·키 게이트·라우트. 공기질 라우트/fetch 정책 미러(인증 실패 XML 방어, resultCode 검증). 네트워크 I/O라 **단위 테스트 없이 build/lint·실호출 게이트**(공기질 라우트도 단위 테스트 없음 — 동일 정책).

**Files:**
- Modify: `src/lib/providers/weather.ts`
- Create: `src/app/api/weather/nearby/route.ts`

**Interfaces:**
- Consumes: `latLngToGrid`, `ultraSrtNcstBaseTime`, `vilageFcstBaseTime`, `parseNcst`, `parseFcst`, `mergeWeather` (Tasks 1~3)
- Produces: `findWeatherNear(lat: number, lng: number): Promise<Weather | null>`; route `GET /api/weather/nearby?lat&lng` → `{ weather: Weather | null }` | `{ error }`(400/502)

- [ ] **Step 1: fetch 합성 구현** (append to `src/lib/providers/weather.ts`)

```typescript
const NCST_BASE =
  "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst";
const FCST_BASE =
  "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";

/** envelope resultCode 추출(정상 "00"). */
function resultCode(raw: unknown): string | null {
  const c = (raw as { response?: { header?: { resultCode?: unknown } } })
    ?.response?.header?.resultCode;
  return c != null ? String(c) : null;
}

/**
 * 기상청 한 오퍼레이션 호출 → 검증된 raw JSON. 공기질 fetchAirkorea 동형 방어:
 * - serviceKey 등 모든 파라미터 URLSearchParams 인코딩.
 * - 인증 실패 등은 dataType=JSON이어도 XML 에러를 HTTP 200으로 보냄 → text()
 *   받아 JSON.parse try-catch, 게이트웨이 에러 envelope·resultCode≠"00" → throw
 *   (라우트 502 — "조회 실패"와 "정보 없음" 구분).
 */
async function fetchKma(
  base: string,
  params: Record<string, string | number>,
  label: string,
): Promise<unknown> {
  const key = env.DATA_GO_KR_API_KEY!;
  const url = new URL(base);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("dataType", "JSON");
  url.searchParams.set("pageNo", "1");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, { next: { revalidate: 1800 } });
  if (!res.ok) throw new Error(`${label} 조회 실패: HTTP ${res.status}`);

  const text = await res.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${label} 비정상 응답(XML?): ${text.slice(0, 200)}`);
  }
  if ((raw as { OpenAPI_ServiceResponse?: unknown }).OpenAPI_ServiceResponse) {
    throw new Error(`${label} 서비스 에러(인증?): ${text.slice(0, 200)}`);
  }
  const code = resultCode(raw);
  if (code !== "00") throw new Error(`${label} 비정상 응답: resultCode ${code}`);
  return raw;
}

/** "HHmm" → "HH:mm"(낭독 조회시각). */
function formatBaseTime(hhmm: string): string {
  return hhmm.length === 4 ? `${hhmm.slice(0, 2)}:${hhmm.slice(2)}` : hhmm;
}

/**
 * 좌표 → 가장 가까운 격자의 현재 날씨(2-오퍼레이션 allSettled). 키 없으면 null.
 * 무데이터 → null(graceful). 실황·예보 둘 다 실패해야 throw(502). 한쪽만 실패면
 * 부분 Weather 보존(mergeWeather). 시각은 실호출 시점 기준(`new Date()`).
 */
export async function findWeatherNear(
  lat: number,
  lng: number,
): Promise<Weather | null> {
  if (!env.DATA_GO_KR_API_KEY) return null;
  const grid = latLngToGrid(lat, lng);
  const now = new Date();
  const ncstBase = ultraSrtNcstBaseTime(now);
  const fcstBase = vilageFcstBaseTime(now);

  const [ncstRes, fcstRes] = await Promise.allSettled([
    fetchKma(
      NCST_BASE,
      { base_date: ncstBase.baseDate, base_time: ncstBase.baseTime, nx: grid.nx, ny: grid.ny, numOfRows: 10 },
      "초단기실황",
    ),
    fetchKma(
      FCST_BASE,
      { base_date: fcstBase.baseDate, base_time: fcstBase.baseTime, nx: grid.nx, ny: grid.ny, numOfRows: 1000 },
      "단기예보",
    ),
  ]);

  if (ncstRes.status === "rejected" && fcstRes.status === "rejected") {
    throw ncstRes.reason;
  }

  const todayYmd = ncstBase.baseDate;
  const ncst = ncstRes.status === "fulfilled" ? parseNcst(ncstRes.value) : null;
  const fcst =
    fcstRes.status === "fulfilled" ? parseFcst(fcstRes.value, todayYmd) : null;

  return mergeWeather(ncst, fcst, formatBaseTime(ncstBase.baseTime), grid);
}
```

- [ ] **Step 2: 라우트 생성** (`src/app/api/weather/nearby/route.ts`)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasDataGoKrKey } from "@/lib/env";
import { findWeatherNear } from "@/lib/providers/weather";

/**
 * GET /api/weather/nearby?lat=..&lng=..
 * 이 지역 날씨 — 기상청 격자 변환 후 초단기실황+단기예보 합성.
 *
 * 키 없음 → { weather: null }(canShowAir 게이트와 이중 방어, 동일 키).
 * 무데이터·미커버 → { weather: null }(graceful). upstream 장애 → 502.
 */

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
  if (!hasDataGoKrKey()) {
    return NextResponse.json({ weather: null });
  }
  try {
    const weather = await findWeatherNear(parsed.data.lat, parsed.data.lng);
    return NextResponse.json({ weather });
  } catch (e) {
    console.error("[api/weather/nearby]", e);
    return NextResponse.json({ error: "날씨 정보 조회 실패" }, { status: 502 });
  }
}
```

- [ ] **Step 3: build·lint·기존 테스트 게이트**

Run: `npm run lint && npx vitest run src/lib/__tests__/weather.test.ts && npm run build`
Expected: lint 통과, 18 tests PASS, build 성공(타입 정합).

- [ ] **Step 4: Commit**

```bash
git add src/lib/providers/weather.ts src/app/api/weather/nearby/route.ts
git commit -m "feat(weather): findWeatherNear 2-오퍼레이션 합성 + /api/weather/nearby

실황·예보 allSettled 호출(부분성공 보존, 둘 다 실패만 502), 키 게이트.
공기질 라우트 미러(인증 XML 방어·resultCode 검증). 라우트 단위테스트
없이 build/lint·실호출 게이트(공기질 라우트 동일 정책).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: i18n weather 네임스페이스(5개 언어)

상태 코드→자국어 매핑 + 라벨. ko 기준 키 집합을 5개 언어에 동일 추가, `i18n-messages.test.ts` 정합 게이트.

**Files:**
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json` (각 `airQuality` 블록 바로 뒤에 `weather` 블록 추가)
- Test: `src/lib/__tests__/i18n-messages.test.ts` (기존 게이트, 신규 코드 불필요)

**Interfaces:**
- Produces: `weather` 메시지 네임스페이스(heading·highLow·humidity·precipProbability·airLabel·asOf·source·unknown·sky.{clear,partlyCloudy,cloudy}·precipitation.{none,rain,rainSnow,snow,shower})

- [ ] **Step 1: ko 추가** (`messages/ko.json`, `"airQuality": { ... },` 뒤)

```json
  "weather": {
    "heading": "이 지역 날씨",
    "highLow": "최고 {max}° 최저 {min}°",
    "humidity": "습도 {humidity}%",
    "precipProbability": "강수확률 {pop}%",
    "airLabel": "공기질",
    "asOf": "{time} 기준",
    "source": "출처: 기상청 단기예보.",
    "unknown": "정보 없음",
    "sky": {
      "clear": "맑음",
      "partlyCloudy": "구름많음",
      "cloudy": "흐림"
    },
    "precipitation": {
      "none": "강수 없음",
      "rain": "비",
      "rainSnow": "비/눈",
      "snow": "눈",
      "shower": "소나기"
    }
  },
```

- [ ] **Step 2: en 추가** (`messages/en.json`, `airQuality` 뒤)

```json
  "weather": {
    "heading": "Local weather",
    "highLow": "High {max}° Low {min}°",
    "humidity": "Humidity {humidity}%",
    "precipProbability": "Chance of rain {pop}%",
    "airLabel": "Air quality",
    "asOf": "As of {time}",
    "source": "Source: KMA short-term forecast.",
    "unknown": "No data",
    "sky": {
      "clear": "Clear",
      "partlyCloudy": "Partly cloudy",
      "cloudy": "Cloudy"
    },
    "precipitation": {
      "none": "No precipitation",
      "rain": "Rain",
      "rainSnow": "Rain and snow",
      "snow": "Snow",
      "shower": "Showers"
    }
  },
```

- [ ] **Step 3: es 추가** (`messages/es.json`, `airQuality` 뒤)

```json
  "weather": {
    "heading": "Tiempo en la zona",
    "highLow": "Máx {max}° Mín {min}°",
    "humidity": "Humedad {humidity}%",
    "precipProbability": "Prob. de lluvia {pop}%",
    "airLabel": "Calidad del aire",
    "asOf": "A las {time}",
    "source": "Fuente: previsión a corto plazo de KMA.",
    "unknown": "Sin datos",
    "sky": {
      "clear": "Despejado",
      "partlyCloudy": "Parcialmente nublado",
      "cloudy": "Nublado"
    },
    "precipitation": {
      "none": "Sin precipitación",
      "rain": "Lluvia",
      "rainSnow": "Lluvia y nieve",
      "snow": "Nieve",
      "shower": "Chubascos"
    }
  },
```

- [ ] **Step 4: fr 추가** (`messages/fr.json`, `airQuality` 뒤)

```json
  "weather": {
    "heading": "Météo locale",
    "highLow": "Max {max}° Min {min}°",
    "humidity": "Humidité {humidity}%",
    "precipProbability": "Risque de pluie {pop}%",
    "airLabel": "Qualité de l'air",
    "asOf": "À {time}",
    "source": "Source : prévisions à court terme de la KMA.",
    "unknown": "Pas de données",
    "sky": {
      "clear": "Dégagé",
      "partlyCloudy": "Partiellement nuageux",
      "cloudy": "Couvert"
    },
    "precipitation": {
      "none": "Pas de précipitations",
      "rain": "Pluie",
      "rainSnow": "Pluie et neige",
      "snow": "Neige",
      "shower": "Averses"
    }
  },
```

- [ ] **Step 5: it 추가** (`messages/it.json`, `airQuality` 뒤)

```json
  "weather": {
    "heading": "Meteo locale",
    "highLow": "Max {max}° Min {min}°",
    "humidity": "Umidità {humidity}%",
    "precipProbability": "Prob. di pioggia {pop}%",
    "airLabel": "Qualità dell'aria",
    "asOf": "Alle {time}",
    "source": "Fonte: previsioni a breve termine KMA.",
    "unknown": "Nessun dato",
    "sky": {
      "clear": "Sereno",
      "partlyCloudy": "Parzialmente nuvoloso",
      "cloudy": "Nuvoloso"
    },
    "precipitation": {
      "none": "Nessuna precipitazione",
      "rain": "Pioggia",
      "rainSnow": "Pioggia e neve",
      "snow": "Neve",
      "shower": "Rovesci"
    }
  },
```

- [ ] **Step 6: 정합 테스트**

Run: `npx vitest run src/lib/__tests__/i18n-messages.test.ts`
Expected: PASS — 5개 언어 weather 키 집합·ICU 플레이스홀더(`{max}` `{min}` `{humidity}` `{pop}` `{time}`) 동일.

- [ ] **Step 7: Commit**

```bash
git add messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json
git commit -m "i18n(weather): 이 지역 날씨 네임스페이스 5개 언어 추가

하늘상태/강수형태 코드→자국어 매핑(기상청 lang 파라미터 부재 대응),
라벨·조회시각·출처. i18n-messages 키 정합 통과.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `AirQualityBody` 추출 + `LocalConditions` 컴포넌트

`AirQuality` 표시부를 headless `AirQualityBody`로 추출(기존 self-fetch `AirQuality`는 Body를 감싸는 래퍼로 유지 — chat용 region·h3 보존). 신규 `LocalConditions`가 날씨·공기질 두 fetch를 소유해 단일 region 렌더. node-env에 컴포넌트 레인 없어 **lint+build 게이트**.

**Files:**
- Modify: `src/components/AirQuality.tsx` (Body 추출 + 래퍼화)
- Create: `src/components/LocalConditions.tsx`

**Interfaces:**
- Consumes: `Weather` (Task 1), `/api/weather/nearby`·`/api/air-quality/nearby` (Task 4 / 기존), `weather`·`airQuality` 메시지 (Task 5 / 기존)
- Produces: `export function AirQualityBody({ air }: { air: AirQuality }): JSX.Element`; `export function LocalConditions({ lat, lng }: { lat: number; lng: number }): JSX.Element | null`

- [ ] **Step 1: `AirQuality.tsx` 리팩터** (전체 교체 — Body 추출, 래퍼는 Body 사용)

```tsx
"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { AirPollutant, AirQuality as Air } from "@/lib/types";

/**
 * 공기질 표시부(headless) — 측정소 줄 + KHAI/PM10/PM2.5 + 조회시각·출처.
 * region·heading 없음(상위가 소유). LocalConditions(통합 카드)와 단독
 * AirQuality(chat)가 공유해 표시 일관성을 한 곳에 둔다.
 */
export function AirQualityBody({ air }: { air: Air }) {
  const t = useTranslations("airQuality");
  return (
    <>
      <p className="mt-1 text-sm opacity-80">
        {t("station", { name: air.stationName, distance: air.distanceKm })}
      </p>
      <div className="mt-1 text-sm leading-relaxed">
        <PollutantRow label={t("khai")} p={air.khai} t={t} />
        <PollutantRow label={t("pm10")} p={air.pm10} unit="㎍/㎥" t={t} />
        <PollutantRow label={t("pm25")} p={air.pm25} unit="㎍/㎥" t={t} />
      </div>
      <p className="mt-2 text-xs opacity-70">{t("asOf", { time: air.dataTime })}</p>
      <p className="mt-1 text-xs opacity-70">{t("source")}</p>
    </>
  );
}

/**
 * 단독 공기질 카드 — 자동 fetch + region·heading. chat get_air_quality·
 * MessageBubble 등 날씨와 묶이지 않는 단독 노출용(자동 등장 섹션이라 region 유지).
 * 홈·장소 상세의 통합 노출은 LocalConditions가 담당.
 */
export function AirQuality({ lat, lng }: { lat: number; lng: number }) {
  const t = useTranslations("airQuality");
  const [air, setAir] = useState<Air | null>(null);
  const headingId = useId();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/air-quality/nearby?lat=${lat}&lng=${lng}`, {
          signal: controller.signal,
        });
        if (!active) return;
        if (!res.ok) {
          setAir(null);
          return;
        }
        const body = await res.json();
        if (active) setAir((body.air as Air) ?? null);
      } catch {
        if (active) setAir(null);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [lat, lng]);

  if (!air) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="mt-3 rounded-md border border-border p-3"
    >
      <h3 id={headingId} className="text-base font-semibold">
        {t("heading")}
      </h3>
      <AirQualityBody air={air} />
    </section>
  );
}

/**
 * 오염물질 한 줄 — "라벨 등급 (수치 단위)".
 * grade==="unknown"이면 등급은 "정보 없음"이고 수치는 표시하지 않는다.
 */
function PollutantRow({
  label,
  p,
  unit = "",
  t,
}: {
  label: string;
  p: AirPollutant;
  unit?: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const gradeText = p.grade === "unknown" ? t("unknown") : t(`grade.${p.grade}`);
  const showValue = p.grade !== "unknown" && p.value != null;
  return (
    <p>
      <span className="font-medium">{label}</span> {gradeText}
      {showValue ? ` (${p.value}${unit})` : ""}
    </p>
  );
}
```

- [ ] **Step 2: `LocalConditions.tsx` 생성**

```tsx
"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { AirQuality as Air, Weather } from "@/lib/types";
import { AirQualityBody } from "./AirQuality";

/**
 * 이 지역 날씨 — 기상청 현재 날씨 + 에어코리아 공기질을 단일 region으로 통합.
 *
 * 날씨·공기질 두 fetch를 직접 소유하고 둘 다 null이면 렌더하지 않는다(빈 heading
 * 방지). 두 fetch는 독립이라 한쪽 502가 다른 쪽을 죽이지 않는다(graceful 조합).
 * 자동 등장 섹션이라 region 랜드마크 유지(버튼 없는 발견 경로 — CLAUDE.md 정책).
 */
export function LocalConditions({ lat, lng }: { lat: number; lng: number }) {
  const t = useTranslations("weather");
  const [weather, setWeather] = useState<Weather | null>(null);
  const [air, setAir] = useState<Air | null>(null);
  const headingId = useId();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/weather/nearby?lat=${lat}&lng=${lng}`, {
          signal: controller.signal,
        });
        if (!active) return;
        if (!res.ok) {
          setWeather(null);
          return;
        }
        const body = await res.json();
        if (active) setWeather((body.weather as Weather) ?? null);
      } catch {
        if (active) setWeather(null);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [lat, lng]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/air-quality/nearby?lat=${lat}&lng=${lng}`, {
          signal: controller.signal,
        });
        if (!active) return;
        if (!res.ok) {
          setAir(null);
          return;
        }
        const body = await res.json();
        if (active) setAir((body.air as Air) ?? null);
      } catch {
        if (active) setAir(null);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [lat, lng]);

  if (!weather && !air) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="mt-3 rounded-md border border-border p-3"
    >
      <h3 id={headingId} className="text-base font-semibold">
        {t("heading")}
      </h3>

      {weather && <WeatherBody weather={weather} />}

      {air && (
        <div className="mt-3">
          <p className="text-sm">
            <span className="font-medium">{t("airLabel")}</span>
          </p>
          <AirQualityBody air={air} />
        </div>
      )}
    </section>
  );
}

/**
 * 날씨 표시부 — 상태 단어가 낭독 정본. 강수형태가 "강수 없음/정보 없음"이면
 * 하늘상태를, 비/눈/소나기면 강수형태를 메인 상태어로 쓴다. 평문 `<p>`.
 */
function WeatherBody({ weather }: { weather: Weather }) {
  const t = useTranslations("weather");

  const hasPrecip =
    weather.precipitation.label !== "none" &&
    weather.precipitation.label !== "unknown";
  const conditionWord = hasPrecip
    ? t(`precipitation.${weather.precipitation.label}`)
    : weather.sky.label !== "unknown"
      ? t(`sky.${weather.sky.label}`)
      : t("unknown");

  const detailParts: string[] = [];
  if (weather.humidity != null) {
    detailParts.push(t("humidity", { humidity: weather.humidity }));
  }
  if (weather.precipProbability != null) {
    detailParts.push(t("precipProbability", { pop: weather.precipProbability }));
  }

  return (
    <div className="text-sm leading-relaxed">
      <p>
        <span className="font-medium">{conditionWord}</span>
        {weather.tempC != null ? `, ${weather.tempC}°C` : ""}
      </p>
      {weather.tempMax != null && weather.tempMin != null && (
        <p>{t("highLow", { max: weather.tempMax, min: weather.tempMin })}</p>
      )}
      {detailParts.length > 0 && <p>{detailParts.join(", ")}</p>}
      <p className="mt-2 text-xs opacity-70">
        {t("asOf", { time: weather.baseTime })}
      </p>
      <p className="mt-1 text-xs opacity-70">{t("source")}</p>
    </div>
  );
}
```

- [ ] **Step 3: lint·build 게이트**

Run: `npm run lint && npm run build`
Expected: 통과(타입 정합 — `AirQualityBody`·`LocalConditions` export, Weather 타입 사용).

- [ ] **Step 4: Commit**

```bash
git add src/components/AirQuality.tsx src/components/LocalConditions.tsx
git commit -m "feat(weather): AirQualityBody 추출 + LocalConditions 통합 컴포넌트

공기질 표시부를 headless Body로 분리(단독 AirQuality는 region 래퍼 유지).
LocalConditions가 날씨·공기질 두 fetch를 소유해 단일 region '이 지역 날씨'로
렌더, 둘 다 null이면 미렌더. 상태 단어 낭독 정본, 평문 단락.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 마운트 교체(홈·장소 상세)

홈 idle·장소 상세의 `<AirQuality>`를 `<LocalConditions>`로 교체. 게이트 `canShowAir` 그대로. lint+build 게이트.

**Files:**
- Modify: `src/components/PlaceSearch.tsx` (import 33~34행 인근 + 마운트 636~640행)
- Modify: `src/components/PlaceDetail.tsx` (import 16행 + 마운트 133행)

**Interfaces:**
- Consumes: `LocalConditions` (Task 6), `canShowAir`(= `hasDataGoKrKey()`, 기존 prop)

- [ ] **Step 1: `PlaceSearch.tsx` import 교체** (기존 `import { AirQuality } from "./AirQuality";`)

```tsx
import { LocalConditions } from "./LocalConditions";
```

- [ ] **Step 2: `PlaceSearch.tsx` 마운트 교체** (기존 홈 idle 공기질 블록 — 주석 포함 교체)

```tsx
      {/* 이 지역 날씨 — 버튼 없이 좌표 준비 시 자동 등장하는 통합 카드(현재 날씨 +
          공기질). 외출 전 환경 브리핑. 내 주변 버튼 6종(지하철~둘러보기) 아래에
          배치(위원장 선호). LocalConditions가 두 fetch를 소유해 단일 region. */}
      {canShowAir && status.kind === "idle" && userCoords && (
        <div className="mt-4">
          <LocalConditions lat={userCoords.lat} lng={userCoords.lng} />
        </div>
      )}
```

- [ ] **Step 3: `PlaceDetail.tsx` import 교체** (기존 `import { AirQuality } from "./AirQuality";`)

```tsx
import { LocalConditions } from "./LocalConditions";
```

- [ ] **Step 4: `PlaceDetail.tsx` 마운트 교체** (기존 `{canShowAir && <AirQuality lat={place.lat} lng={place.lng} />}`)

```tsx
      {canShowAir && <LocalConditions lat={place.lat} lng={place.lng} />}
```

- [ ] **Step 5: lint·build·전체 테스트 게이트**

Run: `npm run lint && npm run test:run && npm run build`
Expected: 통과(`AirQuality`는 chat에서만 import되어 잔존, `LocalConditions`가 홈·상세에서 사용).

- [ ] **Step 6: Commit**

```bash
git add src/components/PlaceSearch.tsx src/components/PlaceDetail.tsx
git commit -m "feat(weather): 홈·장소 상세 공기질 카드를 이 지역 날씨로 교체

PlaceSearch(홈 idle)·PlaceDetail의 AirQuality를 LocalConditions로 교체
(현재 날씨+공기질 단일 region). 게이트 canShowAir 동일 키 재사용.
chat 단독 AirQuality는 잔존.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: 기상청 실호출 검증(머지 게이트) + CLAUDE.md 정본 갱신

**선행:** data.go.kr 단기예보(15084084) 활용신청 승인. dev 서버로 실호출해 격자·base_time·파싱을 실응답으로 잠그고 CLAUDE.md에 반영한다(node-env에 컴포넌트/네트워크 레인 없어 실호출이 머지 게이트 — 공기질 동형).

**Files:**
- Modify: `gildongmu/CLAUDE.md` (공기질 항목 인근에 "이 지역 날씨" 정본 추가)
- Modify: `docs/superpowers/specs/2026-06-20-local-weather-conditions-design.md` (§2 "검증 대기" → 실호출 검증값으로 잠금)

- [ ] **Step 1: dev 서버 기동**

Run: `npm run dev`
(별도 셸에서 아래 호출. `.env.local`에 `DATA_GO_KR_API_KEY` 존재 가정.)

- [ ] **Step 2: 실호출 검증 — 길동(좌표 정상)**

Run: `curl -s "http://localhost:3000/api/weather/nearby?lat=37.538&lng=127.139" | head -c 600`
Expected: `{"weather":{"sky":{...},"precipitation":{...},"tempC":<숫자>,"tempMax":...,"humidity":...,"baseTime":"HH:mm","grid":{"nx":62,"ny":126}}}` 형태. `tempC`가 합리적 현재기온, `sky.label`이 clear/partlyCloudy/cloudy 중 하나.

- [ ] **Step 3: 실호출 검증 — 부산(타지역 정상) + 범위 밖(400)**

Run: `curl -s "http://localhost:3000/api/weather/nearby?lat=35.1796&lng=129.0756" | head -c 400`
Expected: 부산 격자의 weather 객체(미커버 아님 — 전국 격자 커버).

Run: `curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/weather/nearby?lat=10&lng=10"`
Expected: `400`(zod 좌표 범위 밖).

- [ ] **Step 4: 통합 화면 스모크** (브라우저 또는 `curl` 렌더 확인)

`/ko`(홈)에서 현재 위치 권한 허용 시 "이 지역 날씨" region에 날씨+공기질이 한 섹션으로 노출되는지, 장소 상세 진입 시에도 동일한지 확인. 날씨 502여도 공기질만, 그 역도 graceful 표시되는지(독립 fetch).

- [ ] **Step 5: 설계 문서 §2 잠금** (`docs/superpowers/specs/2026-06-20-local-weather-conditions-design.md`)

§2 헤더의 "(검증 대기)"를 제거하고, 실호출로 확인한 길동 격자(nx/ny)·실황·예보 필드 실값과 검증일(2026-06-20)을 기록. 미매핑 코드·빈 응답 graceful도 실응답 기준으로 확정.

- [ ] **Step 6: CLAUDE.md 정본 추가** (`gildongmu/CLAUDE.md`, 공기질(B2) 항목 바로 뒤)

기상청 단기예보 provider 정본 한 단락 추가: 출처(15084084, `DATA_GO_KR_API_KEY` 공유)·격자 LCC 변환(서울 60/127)·2-오퍼레이션 체인(실황엔 SKY 없음)·base_time 규칙·상태 코드 자국어 매핑(lang 파라미터 부재)·부분 성공 allSettled·`LocalConditions` 단일 region 통합(공기질 카드 흡수)·실호출 검증일. API 키 표에 기상청 단기예보 활용신청 상태 행 추가.

- [ ] **Step 7: AGENTS.md 동기화**

Run: `cd /Users/hunyongkim/Mac-Projects && python sync_agent_docs.py`
Expected: gildongmu/AGENTS.md 재생성(CLAUDE.md 변경 반영).

- [ ] **Step 8: Commit**

```bash
git add gildongmu/CLAUDE.md gildongmu/AGENTS.md docs/superpowers/specs/2026-06-20-local-weather-conditions-design.md
git commit -m "docs(weather): 이 지역 날씨 실호출 검증·CLAUDE.md 정본 반영

기상청 단기예보 격자·base_time·파싱을 실응답으로 잠금(길동·부산·범위밖).
CLAUDE.md에 provider 정본·API 키 표 행 추가, AGENTS.md 동기화.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- §2 격자 변환 → Task 1. base_time → Task 2. 2-오퍼레이션 파싱 → Task 3. fetch 체인 → Task 4. ✓
- §3 불변식: 코드→라벨 자국어 매핑 → Task 3+5. 상태 단어 정본 → Task 6(WeatherBody). upstream throw/graceful null → Task 4. 부분 성공 allSettled → Task 4. 격자 결정적 테스트 → Task 1. 3-state(둘 다 없으면 null) → Task 3(mergeWeather). ✓
- §4 LocalConditions 두 fetch 소유·단일 region·빈 heading 방지 → Task 6. AirQualityBody 추출·AirQuality 래퍼 유지 → Task 6. 마운트 교체 → Task 7. 게이트 단일화 → Task 4+7. ✓
- §5 접근성(단일 region·평문·공기질 인라인 라벨·graceful 조합·lang) → Task 6. ✓
- §6 i18n 5개 언어·코드 매핑·airQuality.heading 잔존·키 정합 게이트 → Task 5. ✓
- §7 구조(파일·함수명) → Task 1~6. 캐시 revalidate 1800 → Task 4. ✓
- §8 테스트(순수 fixture·실호출 게이트·i18n 정합) → Task 1~5, 8. ✓
- §9 선행조건(활용신청)·프로덕션(재배포 불요) → Task 8 선행. CLAUDE.md 갱신 → Task 8. ✓
- §10 dodo 이식 메모(개념만, 정적 더미 미이식) → Global Constraints + Task 4. ✓

**2. Placeholder scan:** "TBD/TODO/적절히" 없음. 모든 코드 스텝에 실제 코드. i18n 5개 언어 전체 문자열 제공(요약 아님). ✓

**3. Type consistency:**
- `latLngToGrid` → `{nx,ny}` (Task 1 정의, Task 3 `mergeWeather` grid 파라미터·Task 4 사용) ✓
- `ultraSrtNcstBaseTime`/`vilageFcstBaseTime` → `{baseDate,baseTime}` (Task 2 정의, Task 4 사용) ✓
- `parseNcst`/`parseFcst`/`mergeWeather` 시그니처 (Task 3 정의, Task 4 `findWeatherNear` 사용 — `parseFcst(raw, todayYmd)` 인자 일치) ✓
- `Weather`(sky·precipitation·tempC·tempMax·tempMin·humidity·precipProbability·baseTime·grid) — Task 1 타입 ↔ Task 3 mergeWeather 반환 ↔ Task 6 WeatherBody 소비 필드명 일치 ✓
- `AirQualityBody({air})`·`LocalConditions({lat,lng})` (Task 6 정의, Task 7 사용) ✓
- 메시지 키(`weather.heading`·`sky.*`·`precipitation.*`·`highLow`·`humidity`·`precipProbability`·`airLabel`·`asOf`·`source`·`unknown`) — Task 5 정의 ↔ Task 6 사용 일치 ✓

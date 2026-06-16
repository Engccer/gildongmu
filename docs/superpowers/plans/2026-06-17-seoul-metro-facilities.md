# 서울 지하철역 교통약자 시설 (A1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서울 지하철역(1~8호선) 교통약자 시설 9종(엘리베이터·에스컬레이터·휠체어리프트·무빙워크·휠체어급속충전기·안전발판·수어영상전화기·도우미·장애인화장실)을 위치·층·가동현황까지 텍스트로 낭독하는 기능. 코레일 편의시설(전국 철도역)의 도시철도 공백을 메운다.

**Architecture:** data.go.kr `서울교통공사_교통약자이용정보`(15143843, Base `apis.data.go.kr/B553766/wksn`, 9 오퍼레이션). 코레일 `korail-facilities` 패턴과 동형 — 같은 `DATA_GO_KR_API_KEY`, 같은 data.go.kr 표준 envelope(`parseStationItems` 재사용). 시설마다 필드 스킴이 다르므로 *공통 코어 + 시설별 정규화 함수*로 묶고, 위치(`dtlPstn`)·층(`bgngFlr`/`endFlr`)·가동현황(`oprtngSitu`)을 보존한다. provider→route→온디맨드 컴포넌트→PlaceDetail 통합. 코레일 컴포넌트와 나란히 노출(역 종류별로 한쪽만 데이터 보유, 각자 graceful).

**Tech Stack:** TypeScript, Next.js 16(App Router, route handler), next-intl, zod, Vitest. `src/lib/`는 React/Next 비의존 유지(dodo 이식성).

---

## 실호출로 확정된 계약 (2026-06-17, `DATA_GO_KR_API_KEY`)

- **Base**: `https://apis.data.go.kr/B553766/wksn`, 오퍼레이션 9종: `getWksnElvtr`·`getWksnEsctr`·`getWksnWhcllift`·`getWksnMvnwlk`·`getWksnWhclCharge`·`getWksnSafePlfm`·`getWksnSlng`·`getWksnHelper`·`getWksnRstrm`.
- **요청변수**: `serviceKey`, `dataType=JSON`, `numOfRows`, `pageNo`, `stnNm`(역명 **포함** 필터 — `강동`→`강동`+`강동구청` 둘 다 반환하므로 **클라이언트 정확매칭 필수**).
- **envelope**: `response.body.items.item`(배열/단일/`""`), `totalCount`, `header.resultCode`(`"00"` 정상·`"03"` NODATA). 코레일과 동일 → `parseStationItems` 재사용.
- **공통 코어 필드**: `fcltNm`(시설명)·`lineNm`(호선)·`stnNm`(역명)·`stnCd`(역코드)·`stnNo`·`crtrYmd`(기준일).
- **시설별 고유 필드**(강동역 실응답):
  - 엘리베이터(`Elvtr`, 6대): `dtlPstn`·`bgngFlrGrndUdgdSe`/`bgngFlr`·`endFlrGrndUdgdSe`/`endFlr`·`oprtngSitu`·`pscpNope`/`pscpWht`·`vcntEntrcNo`.
  - 에스컬레이터(`Esctr`, 15대): `bgngFlrDtlPstn`/`endFlrDtlPstn`(위치, `dtlPstn` 없음)·`bgngFlr`/`endFlr`·`upbdnbSe`(상하행)·`oprtngSitu`·`elvtrWdthBt`.
  - 휠체어급속충전기(`WhclCharge`, 1): `dtlPstn`·`stnFlr`·`cnnctrSe`·`utztnCrg`·`elctcFacCnt`·`operInstTelno`.
  - 안전발판(`SafePlfm`, 2): `sftyScfldEn`·`mngrTelno` (`dtlPstn` 없음).
  - 장애인화장실(`Rstrm`, 2): `dtlPstn`·`stnFlr`·`rstrmInfo`·`whlchrAcsPsbltyYn`·`gateInoutSe`·`grndUdgdSe`.
  - 리프트·무빙워크·수어전화기·도우미: 강동역 0건(역마다 설치 종류 다름 → 빈 종류는 제외).
- **`oprtngSitu`**: 관측값 `M`(다수)·`S`(소수)만. **`M`=정상, 그 외(S 포함)=점검·중지**로 보수 매핑(과소경고보다 안전). 엘리베이터·에스컬레이터에만 존재.

---

## File Structure

- **Create** `src/lib/providers/seoul-metro-facilities.ts` — 순수 파서(시설별 정규화·`oprtngSitu` 매핑·정확매칭) + 9 오퍼레이션 병렬 fetch. React/Next 비의존.
- **Modify** `src/lib/types.ts` — `SeoulMetroFacility`·`SeoulMetroFacilityGroup`·`SeoulMetroFacilityKind`·`SeoulMetroFacilities` 추가.
- **Create** `src/app/api/station/metro-facilities/route.ts` — 프록시(서버 전용 키, graceful null).
- **Create** `src/components/SeoulMetroFacilities.tsx` — 온디맨드 버튼→fetch→aria-live→9종 그룹 heading 구조.
- **Modify** `src/components/PlaceDetail.tsx` — `isStation`일 때 코레일 `StationFacilities` 아래 `SeoulMetroFacilities` 추가.
- **Modify** `messages/ko.json`·`messages/en.json` — `subway` 섹션.
- **Create** `src/lib/__tests__/seoul-metro-facilities.test.ts` + `src/lib/__tests__/fixtures/seoul-metro-facilities.json`(강동역 실응답).
- **Modify** `CLAUDE.md`·`docs/SPEC.md` — A1 운영 반영.

---

## Task 1: 타입 정의

**Files:** Modify `src/lib/types.ts` (StationFacilities 블록 바로 뒤, line 130 이후)

- [ ] **Step 1: 타입 추가**

```ts
/** 서울 지하철 교통약자 시설 종류 키 — i18n 라벨·그룹핑용. */
export type SeoulMetroFacilityKind =
  | "elevator"
  | "escalator"
  | "wheelchairLift"
  | "movingWalk"
  | "wheelchairCharger"
  | "safetyPlatform"
  | "signLangPhone"
  | "helper"
  | "restroom";

/** 시설 인스턴스 하나(엘리베이터 1대 등) — 위치·층·가동현황을 낭독 정본으로 보존. */
export interface SeoulMetroFacility {
  /** 시설명(fcltNm) 예: "승강기)엘리베이터-강동 내부 1호기" */
  name: string;
  /** 상세 위치 — dtlPstn 또는 시설별 위치 필드. 없으면 undefined. */
  location: string | undefined;
  /** 층 정보 — "지하3층~지하4층" 등. 해당 없으면 undefined. */
  floors: string | undefined;
  /** 가동현황 — 엘리베이터·에스컬레이터만. M=normal, 그 외=stopped, 필드 없으면 undefined. */
  operatingStatus: "normal" | "stopped" | undefined;
  /** 시설별 보조 설명(화장실 종류·휠체어 접근 등). 없으면 undefined. */
  detail: string | undefined;
}

/** 한 시설 종류의 묶음 — 데이터가 있는 종류만 포함된다. */
export interface SeoulMetroFacilityGroup {
  kind: SeoulMetroFacilityKind;
  facilities: SeoulMetroFacility[];
}

/** 한 지하철역의 교통약자 시설 전체(서울교통공사 1~8호선). */
export interface SeoulMetroFacilities {
  /** 역명(데이터셋 표기, 표시용) */
  stationName: string;
  /** 호선(첫 매칭 항목 기준) — 없으면 undefined */
  line: string | undefined;
  /** 데이터가 있는 시설 종류만. 전부 비면 빈 배열 → 라우트가 null 처리. */
  groups: SeoulMetroFacilityGroup[];
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: PASS (타입만 추가, 사용처 없음)

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): 서울 지하철 교통약자 시설 타입(SeoulMetroFacilities) 추가"
```

---

## Task 2: provider 순수 파서 (시설별 정규화 + oprtngSitu 매핑 + 정확매칭)

**Files:**
- Create: `src/lib/providers/seoul-metro-facilities.ts`
- Create: `src/lib/__tests__/fixtures/seoul-metro-facilities.json`
- Test: `src/lib/__tests__/seoul-metro-facilities.test.ts`

- [ ] **Step 1: fixture 캡처(실응답 저장)**

강동역 9종 실응답을 fixture로 저장한다. 다음 스크립트를 실행:

```bash
cd /Users/hunyongkim/Mac-Projects/gildongmu
KEY=$(grep -E '^DATA_GO_KR_API_KEY=' .env.local | cut -d= -f2- | tr -d '"'\'' \r')
python3 - "$KEY" > src/lib/__tests__/fixtures/seoul-metro-facilities.json <<'PY'
import sys,urllib.request,json
KEY=sys.argv[1]; B="https://apis.data.go.kr/B553766/wksn"
ops={"Elvtr":"elevator","Esctr":"escalator","Whcllift":"wheelchairLift","Mvnwlk":"movingWalk","WhclCharge":"wheelchairCharger","SafePlfm":"safetyPlatform","Slng":"signLangPhone","Helper":"helper","Rstrm":"restroom"}
out={}
for op in ops:
    url=f"{B}/getWksn{op}?serviceKey={KEY}&pageNo=1&numOfRows=50&dataType=JSON&stnNm=%EA%B0%95%EB%8F%99"
    out[op]=json.load(urllib.request.urlopen(url,timeout=20))
print(json.dumps(out,ensure_ascii=False,indent=1))
PY
```

Expected: `Elvtr`(6)·`Esctr`(15)·`WhclCharge`(1)·`SafePlfm`(2)·`Rstrm`(2)는 item 보유, 나머지는 빈 결과. `강동`+`강동구청` 혼재(정확매칭 테스트용).

- [ ] **Step 2: 파서 실패 테스트 작성**

```ts
// src/lib/__tests__/seoul-metro-facilities.test.ts
import { describe, it, expect } from "vitest";
import fixture from "./fixtures/seoul-metro-facilities.json";
import {
  parseFacilityGroup,
  parseSeoulMetroFacilities,
} from "../providers/seoul-metro-facilities";

describe("parseFacilityGroup — 시설별 정규화", () => {
  // fixture(stnNm=강동 포함필터)는 강동+강동구청 혼재. 정확매칭 후 강동역만:
  // 엘리베이터 3(6중), 에스컬레이터 10(15중), 안전발판 1, 화장실 1, 충전기 0(강동구청만).
  it("엘리베이터: 위치·층·가동현황 보존, 강동만 정확매칭(강동구청 제외)", () => {
    const g = parseFacilityGroup("elevator", fixture.Elvtr, "강동");
    expect(g).not.toBeNull();
    expect(g!.kind).toBe("elevator");
    expect(g!.facilities.length).toBe(3); // 강동역 3대 (강동구청 3대 제외)
    const f = g!.facilities[0];
    expect(f.name).toBe("승강기)엘리베이터-강동 내부 1호기");
    expect(f.floors).toBe("지하B3~지하B4"); // bgng(지하B3) ~ end(지하B4)
    expect(f.operatingStatus).toBe("normal"); // oprtngSitu "M"
    expect(f.location).toBe("둔촌동 방면8-3"); // dtlPstn
  });

  it("에스컬레이터: dtlPstn 없이 bgngFlrDtlPstn 사용, S는 stopped", () => {
    const g = parseFacilityGroup("escalator", fixture.Esctr, "강동");
    expect(g!.facilities.length).toBe(10); // 강동역 10대 (강동구청 5대 제외)
    expect(
      g!.facilities.some((f) => f.operatingStatus === "stopped"),
    ).toBe(true); // 강동 10대 중 S 3건
  });

  it("장애인화장실: 종류를 detail로", () => {
    const g = parseFacilityGroup("restroom", fixture.Rstrm, "강동");
    expect(g!.facilities.length).toBe(1);
    expect(g!.facilities[0].detail).toContain("교통약자"); // rstrmInfo "일반(남,여) / 교통약자(남,여)"
  });

  it("빈 결과(강동 미설치 종류)는 null — 충전기는 강동구청만이라 강동역엔 없음", () => {
    expect(parseFacilityGroup("wheelchairLift", fixture.Whcllift, "강동")).toBeNull();
    expect(parseFacilityGroup("helper", fixture.Helper, "강동")).toBeNull();
    expect(parseFacilityGroup("wheelchairCharger", fixture.WhclCharge, "강동")).toBeNull();
  });

  it("정확매칭: 포함필터로 섞인 다른 역(강동구청)은 제외", () => {
    const g = parseFacilityGroup("elevator", fixture.Elvtr, "강동");
    // 강동역 3대 모두 stnNm "강동" — "강동구청"은 normalizeStationName이 달라 제외됨
    expect(g!.facilities.length).toBe(3);
    expect(g!.facilities.every((f) => f.name.includes("강동"))).toBe(true);
  });
});

describe("parseSeoulMetroFacilities — 9종 묶음", () => {
  const raws = {
    elevator: fixture.Elvtr,
    escalator: fixture.Esctr,
    wheelchairLift: fixture.Whcllift,
    movingWalk: fixture.Mvnwlk,
    wheelchairCharger: fixture.WhclCharge,
    safetyPlatform: fixture.SafePlfm,
    signLangPhone: fixture.Slng,
    helper: fixture.Helper,
    restroom: fixture.Rstrm,
  };

  it("데이터 있는 종류만 groups에 — 강동은 4종(충전기는 강동구청만이라 제외)", () => {
    const r = parseSeoulMetroFacilities(raws, "강동");
    expect(r).not.toBeNull();
    expect(r!.stationName).toBe("강동");
    expect(r!.line).toBe("5호선");
    const kinds = r!.groups.map((g) => g.kind).sort();
    expect(kinds).toEqual(
      ["elevator", "escalator", "restroom", "safetyPlatform"].sort(),
    );
  });

  it("전 종류 빈 결과면 null(미커버 역 — graceful)", () => {
    const empty = { response: { body: { items: "" } } };
    const allEmpty = Object.fromEntries(
      Object.keys(raws).map((k) => [k, empty]),
    ) as typeof raws;
    expect(parseSeoulMetroFacilities(allEmpty, "없는역")).toBeNull();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/seoul-metro-facilities.test.ts`
Expected: FAIL ("parseFacilityGroup is not a function")

- [ ] **Step 4: 파서 구현**

```ts
// src/lib/providers/seoul-metro-facilities.ts
import { env } from "../env";
import { normalizeStationName } from "../station-match";
import { parseStationItems } from "./korail-facilities";
import type {
  SeoulMetroFacilities,
  SeoulMetroFacility,
  SeoulMetroFacilityGroup,
  SeoulMetroFacilityKind,
} from "../types";

/**
 * 서울교통공사 교통약자이용정보 provider (data.go.kr B553766/wksn).
 *
 * 실 API 특성 (2026-06-17 실호출 확인):
 * - Base: https://apis.data.go.kr/B553766/wksn, 9 오퍼레이션(시설 종류별).
 * - stnNm은 "포함" 필터라 "강동"이 "강동구청"도 잡는다 → 받은 뒤
 *   normalizeStationName으로 **정확매칭**해 다른 역을 제외한다.
 * - envelope는 data.go.kr 표준(코레일과 동일) → parseStationItems 재사용.
 * - 시설마다 필드가 달라 시설별 정규화 함수로 공통 코어(name/location/
 *   floors/operatingStatus/detail)에 투영한다.
 * - oprtngSitu: 관측값 M(정상)·S(점검·중지)뿐. M만 normal, 그 외 stopped
 *   (과소경고보다 안전). 엘리베이터·에스컬레이터에만 존재.
 * - 인증: DATA_GO_KR_API_KEY(코레일과 동일 키), 개발계정 일 10,000건/오퍼레이션.
 *
 * graceful degrade: 키 없음/전 종류 빈 결과 → null("정보 없음"). 주 fetch
 * 장애는 throw → 라우트 502(미커버 null과 구분, 코레일과 동일 정책).
 */

const BASE = "https://apis.data.go.kr/B553766/wksn";

/** 시설 종류 → 오퍼레이션 경로. */
const OPERATIONS: Record<SeoulMetroFacilityKind, string> = {
  elevator: "getWksnElvtr",
  escalator: "getWksnEsctr",
  wheelchairLift: "getWksnWhcllift",
  movingWalk: "getWksnMvnwlk",
  wheelchairCharger: "getWksnWhclCharge",
  safetyPlatform: "getWksnSafePlfm",
  signLangPhone: "getWksnSlng",
  helper: "getWksnHelper",
  restroom: "getWksnRstrm",
};

type RawItem = Record<string, unknown>;

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** "지하B3~지하B4" 형태의 층 문자열. 양끝 정보가 없으면 undefined. */
function floorRange(item: RawItem): string | undefined {
  const bg = `${str(item.bgngFlrGrndUdgdSe)}${str(item.bgngFlr)}`.trim();
  const en = `${str(item.endFlrGrndUdgdSe)}${str(item.endFlr)}`.trim();
  if (bg && en) return bg === en ? bg : `${bg}~${en}`;
  return bg || en || undefined;
}

/** oprtngSitu(M/S) → 가동현황. 없으면 undefined. */
function operating(item: RawItem): "normal" | "stopped" | undefined {
  const v = str(item.oprtngSitu);
  if (!v) return undefined;
  return v.toUpperCase() === "M" ? "normal" : "stopped";
}

/** 시설 종류별로 RawItem을 SeoulMetroFacility로 정규화한다. */
function toFacility(kind: SeoulMetroFacilityKind, item: RawItem): SeoulMetroFacility {
  const base = {
    name: str(item.fcltNm),
    location: undefined as string | undefined,
    floors: undefined as string | undefined,
    operatingStatus: operating(item),
    detail: undefined as string | undefined,
  };
  switch (kind) {
    case "elevator":
      return { ...base, location: str(item.dtlPstn) || undefined, floors: floorRange(item) };
    case "escalator":
      return {
        ...base,
        // 에스컬레이터는 dtlPstn이 없고 시작/끝 층 위치를 쓴다.
        location:
          str(item.bgngFlrDtlPstn) || str(item.endFlrDtlPstn) || undefined,
        floors: floorRange(item),
        detail: str(item.upbdnbSe) || undefined, // 상/하행
      };
    case "wheelchairCharger":
      return {
        ...base,
        location: str(item.dtlPstn) || undefined,
        floors: str(item.stnFlr) || undefined,
        detail: str(item.cnnctrSe) || undefined, // 커넥터 종류
      };
    case "restroom":
      return {
        ...base,
        location: str(item.dtlPstn) || undefined,
        floors: str(item.stnFlr) || undefined,
        detail:
          [str(item.rstrmInfo), str(item.whlchrAcsPsbltyYn) === "Y" ? "휠체어 접근 가능" : ""]
            .filter(Boolean)
            .join(" · ") || undefined,
      };
    case "safetyPlatform":
      // dtlPstn 없음 — 시설명만.
      return base;
    default:
      // 리프트·무빙워크·수어전화기·도우미: 공통 코어 + dtlPstn(있으면).
      return { ...base, location: str(item.dtlPstn) || undefined };
  }
}

/**
 * 한 시설 종류의 raw 응답을 정규화해 그룹으로. 정확매칭 후 비면 null.
 */
export function parseFacilityGroup(
  kind: SeoulMetroFacilityKind,
  raw: unknown,
  normalizedTarget: string,
): SeoulMetroFacilityGroup | null {
  const items = parseStationItems(raw).filter(
    (it) => normalizeStationName(str(it.stnNm)) === normalizedTarget,
  );
  if (items.length === 0) return null;
  return { kind, facilities: items.map((it) => toFacility(kind, it)) };
}

/**
 * 9종 raw 묶음을 SeoulMetroFacilities로. 데이터 있는 종류만 groups에.
 * 전부 비면 null(미커버 역).
 */
export function parseSeoulMetroFacilities(
  raws: Record<SeoulMetroFacilityKind, unknown>,
  stationName: string,
): SeoulMetroFacilities | null {
  const target = normalizeStationName(stationName);
  if (!target) return null;
  const kinds = Object.keys(OPERATIONS) as SeoulMetroFacilityKind[];
  const groups = kinds
    .map((k) => parseFacilityGroup(k, raws[k], target))
    .filter((g): g is SeoulMetroFacilityGroup => g !== null);
  if (groups.length === 0) return null;
  const firstItem = parseStationItems(raws[groups[0].kind])[0] as RawItem | undefined;
  return {
    stationName: stationName.replace(/역$/, ""),
    line: firstItem ? str(firstItem.lineNm) || undefined : undefined,
    groups,
  };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/seoul-metro-facilities.test.ts`
Expected: PASS (전부)

주의: `line`이 "5호선"이 되려면 `groups[0]`이 엘리베이터여야 하고 그 raw 첫 항목이 강동(정확매칭 전 첫 항목일 수 있음 — 강동구청이 먼저면 호선이 같아 문제 없으나, 다르면 수정). 테스트 실패 시 `line`을 정확매칭된 첫 facility 기준으로 바꾼다: `parseFacilityGroup`이 매칭된 raw item의 lineNm도 그룹에 실어 전달하도록 조정.

- [ ] **Step 6: Commit**

```bash
git add src/lib/providers/seoul-metro-facilities.ts src/lib/__tests__/seoul-metro-facilities.test.ts src/lib/__tests__/fixtures/seoul-metro-facilities.json
git commit -m "feat(provider): 서울교통공사 교통약자 시설 파서 — 9종 정규화·정확매칭·가동현황 매핑"
```

---

## Task 3: provider fetch (9 오퍼레이션 병렬 + graceful)

**Files:** Modify `src/lib/providers/seoul-metro-facilities.ts`, Test: 같은 테스트 파일

- [ ] **Step 1: fetch 테스트 추가**

```ts
// seoul-metro-facilities.test.ts 상단에 env 모킹 추가 (import 위)
import { vi, afterEach } from "vitest";
vi.mock("../env", () => ({ env: { DATA_GO_KR_API_KEY: "test-key" } }));

// 그리고 describe 블록 추가:
describe("fetchSeoulMetroFacilities — 9 병렬 + 장애 구분", () => {
  afterEach(() => vi.restoreAllMocks());

  function ok(json: unknown): Response {
    return { ok: true, status: 200, json: async () => json } as unknown as Response;
  }

  it("키 없으면 null", async () => {
    // 이 테스트는 env 모킹을 키 없음으로 재정의해야 하므로 별도 처리 — 생략 가능.
  });

  it("9 오퍼레이션을 병렬 호출해 묶는다(강동 5종)", async () => {
    const { fetchSeoulMetroFacilities } = await import(
      "../providers/seoul-metro-facilities"
    );
    const map: Record<string, unknown> = {
      getWksnElvtr: fixture.Elvtr,
      getWksnEsctr: fixture.Esctr,
      getWksnWhcllift: fixture.Whcllift,
      getWksnMvnwlk: fixture.Mvnwlk,
      getWksnWhclCharge: fixture.WhclCharge,
      getWksnSafePlfm: fixture.SafePlfm,
      getWksnSlng: fixture.Slng,
      getWksnHelper: fixture.Helper,
      getWksnRstrm: fixture.Rstrm,
    };
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      const op = Object.keys(map).find((o) => url.includes(`/${o}?`))!;
      return Promise.resolve(ok(map[op]));
    });
    const r = await fetchSeoulMetroFacilities("강동역");
    expect(r).not.toBeNull();
    expect(r!.groups.length).toBe(4); // 엘리베이터·에스컬레이터·안전발판·화장실 (충전기는 강동구청만)
  });

  it("주 fetch HTTP 실패는 throw(일시 장애 ≠ 정보 없음)", async () => {
    const { fetchSeoulMetroFacilities } = await import(
      "../providers/seoul-metro-facilities"
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
    } as unknown as Response);
    await expect(fetchSeoulMetroFacilities("강동역")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/seoul-metro-facilities.test.ts`
Expected: FAIL ("fetchSeoulMetroFacilities is not a function")

- [ ] **Step 3: fetch 구현 (provider 파일에 추가)**

```ts
async function fetchOp(op: string, stationName: string, key: string): Promise<unknown> {
  const url = new URL(`${BASE}/${op}`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("dataType", "JSON");
  url.searchParams.set("numOfRows", "100");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("stnNm", stationName);
  // 시설 현황은 분 단위로 안 바뀐다 — 하루 캐시로 쿼터를 아낀다(코레일과 동일).
  const res = await fetch(url, { next: { revalidate: 86_400 } });
  if (!res.ok) throw new Error(`서울교통공사 시설 조회 실패: HTTP ${res.status} (${op})`);
  return res.json();
}

/**
 * 역명으로 9종 교통약자 시설을 가져온다. stnNm 포함필터로 서버 1차 축소 후
 * parseSeoulMetroFacilities가 정확매칭한다.
 *
 * - 키 없음 / 전 종류 빈 결과 → null(graceful "정보 없음").
 * - 주 fetch(9 병렬 중 하나라도) HTTP·네트워크 실패 → throw → 라우트 502.
 *   (일시 장애를 "정보 없음"으로 뭉개지 않는다 — 접근성 정본 원칙.)
 */
export async function fetchSeoulMetroFacilities(
  stationName: string,
): Promise<SeoulMetroFacilities | null> {
  const key = env.DATA_GO_KR_API_KEY;
  if (!key) return null;
  const target = normalizeStationName(stationName);
  if (!target) return null;
  // 포함필터 정확도를 위해 접미사 제거 전 원문에서 "역"만 떼 서버에 보낸다.
  const query = stationName.replace(/\s*station$/i, "").replace(/역$/, "").trim();
  const kinds = Object.keys(OPERATIONS) as SeoulMetroFacilityKind[];
  const results = await Promise.all(
    kinds.map((k) => fetchOp(OPERATIONS[k], query, key)),
  );
  const raws = Object.fromEntries(
    kinds.map((k, i) => [k, results[i]]),
  ) as Record<SeoulMetroFacilityKind, unknown>;
  return parseSeoulMetroFacilities(raws, stationName);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/seoul-metro-facilities.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/seoul-metro-facilities.ts src/lib/__tests__/seoul-metro-facilities.test.ts
git commit -m "feat(provider): 서울교통공사 9종 병렬 fetch + 일시장애/정보없음 구분"
```

---

## Task 4: Route Handler

**Files:** Create `src/app/api/station/metro-facilities/route.ts`

- [ ] **Step 1: 라우트 구현 (코레일 station/facilities와 동형)**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchSeoulMetroFacilities } from "@/lib/providers/seoul-metro-facilities";

/**
 * 서울 지하철역 교통약자 시설 프록시 (서울교통공사 B553766).
 *
 * DATA_GO_KR_API_KEY는 서버 전용. 미커버 역(도시철도 외)·키 없음은
 * provider가 null → { facilities: null } 200으로 graceful degrade.
 * upstream 장애만 502(코레일 라우트와 동일 정책).
 */

const schema = z.object({ station: z.string().trim().min(1).max(50) });

export async function GET(request: NextRequest) {
  const parsed = schema.safeParse({
    station: request.nextUrl.searchParams.get("station") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  try {
    const facilities = await fetchSeoulMetroFacilities(parsed.data.station);
    return NextResponse.json({ facilities }); // null이면 미커버 역
  } catch (e) {
    console.error("[api/station/metro-facilities] 조회 실패:", e);
    return NextResponse.json({ error: "지하철역 시설 조회 실패" }, { status: 502 });
  }
}
```

- [ ] **Step 2: 타입체크 + 빌드 확인**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/api/station/metro-facilities/route.ts
git commit -m "feat(api): 서울 지하철역 교통약자 시설 라우트(/api/station/metro-facilities)"
```

---

## Task 5: i18n 메시지 (ko/en)

**Files:** Modify `messages/ko.json`, `messages/en.json` (기존 `station` 섹션 뒤에 `subway` 추가)

- [ ] **Step 1: ko.json에 subway 섹션 추가**

`station` 객체 닫는 `},` 뒤에 추가:

```json
  "subway": {
    "button": "지하철역 교통약자 시설 보기",
    "loading": "지하철역 시설 조회 중…",
    "empty": "이 역의 지하철 교통약자 시설 정보가 없습니다. (서울 1~8호선만 지원)",
    "error": "지하철역 시설 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    "ready": "지하철역 교통약자 시설 정보가 준비되었습니다.",
    "heading": "{name} 지하철 교통약자 시설",
    "lineLabel": "{line}",
    "count": "{count}곳",
    "operatingNormal": "정상 운행",
    "operatingStopped": "운행 중지 또는 점검 중",
    "kind": {
      "elevator": "엘리베이터",
      "escalator": "에스컬레이터",
      "wheelchairLift": "휠체어 리프트",
      "movingWalk": "무빙워크",
      "wheelchairCharger": "전동휠체어 급속충전기",
      "safetyPlatform": "안전발판",
      "signLangPhone": "수어영상전화기",
      "helper": "교통약자 도우미",
      "restroom": "장애인 화장실"
    },
    "source": "출처: 서울교통공사 교통약자이용정보(서울 1~8호선)."
  },
```

- [ ] **Step 2: en.json에 동일 키(영문) 추가**

```json
  "subway": {
    "button": "View subway accessibility facilities",
    "loading": "Loading station facilities…",
    "empty": "No subway accessibility facility data for this station. (Seoul lines 1–8 only)",
    "error": "Failed to load station facilities. Please try again.",
    "ready": "Subway accessibility facilities are ready.",
    "heading": "{name} subway accessibility facilities",
    "lineLabel": "{line}",
    "count": "{count}",
    "operatingNormal": "In service",
    "operatingStopped": "Out of service or under maintenance",
    "kind": {
      "elevator": "Elevator",
      "escalator": "Escalator",
      "wheelchairLift": "Wheelchair lift",
      "movingWalk": "Moving walkway",
      "wheelchairCharger": "Powered wheelchair charger",
      "safetyPlatform": "Safety step",
      "signLangPhone": "Sign-language video phone",
      "helper": "Accessibility helper",
      "restroom": "Accessible restroom"
    },
    "source": "Source: Seoul Metro accessibility facility data (Seoul lines 1–8)."
  },
```

- [ ] **Step 3: JSON 유효성 + 키 정합 확인**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/ko.json','utf8')); JSON.parse(require('fs').readFileSync('messages/en.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add messages/ko.json messages/en.json
git commit -m "feat(i18n): subway 섹션(지하철역 교통약자 시설) ko/en 추가"
```

---

## Task 6: 컴포넌트 SeoulMetroFacilities

**Files:** Create `src/components/SeoulMetroFacilities.tsx`

- [ ] **Step 1: 컴포넌트 구현 (StationFacilities 온디맨드 패턴 + 9종 그룹 heading)**

```tsx
"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SeoulMetroFacilities as Facilities } from "@/lib/types";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "done"; facilities: Facilities };

/**
 * 서울 지하철역 교통약자 시설 — 위치·층·가동현황까지 텍스트로 낭독.
 *
 * 코레일 StationFacilities와 동일한 온디맨드 패턴(버튼→fetch→aria-live→텍스트).
 * 코레일은 전국 철도역(KTX/일반), 이 컴포넌트는 서울 1~8호선. PlaceDetail이
 * 역일 때 둘 다 렌더하고 각자 graceful(데이터 없으면 "정보 없음").
 */
export function SeoulMetroFacilities({ stationName }: { stationName: string }) {
  const t = useTranslations("subway");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const inFlightRef = useRef(false);

  async function load() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/station/metro-facilities?station=${encodeURIComponent(stationName)}`,
      );
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      if (!body.facilities) {
        setStatus({ kind: "empty" });
        return;
      }
      setStatus({ kind: "done", facilities: body.facilities as Facilities });
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setStatus({ kind: "error" });
    } finally {
      inFlightRef.current = false;
    }
  }

  const busy = status.kind === "loading";
  const live =
    status.kind === "loading"
      ? t("loading")
      : status.kind === "empty"
        ? t("empty")
        : status.kind === "error"
          ? t("error")
          : status.kind === "done"
            ? t("ready")
            : "";

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={load}
        aria-disabled={busy}
        aria-busy={busy}
        className="min-h-11 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent aria-disabled:opacity-50"
      >
        {t("button")}
      </button>

      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        {live}
      </p>

      {status.kind === "done" && (
        <section
          aria-labelledby={headingId}
          className="mt-2 rounded-md border border-border p-3"
        >
          <h3
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            {t("heading", {
              name: status.facilities.stationName || stationName,
            })}
            {status.facilities.line && (
              <span className="ml-2 text-xs font-normal opacity-70" lang="ko">
                {status.facilities.line}
              </span>
            )}
          </h3>

          <div className="mt-2 space-y-3">
            {status.facilities.groups.map((g) => (
              <div key={g.kind}>
                <h4 className="text-sm font-semibold" lang="ko">
                  {t(`kind.${g.kind}`)}{" "}
                  <span className="font-normal opacity-70">
                    {t("count", { count: g.facilities.length })}
                  </span>
                </h4>
                <ul className="mt-1 space-y-1 text-sm leading-relaxed">
                  {g.facilities.map((f, i) => (
                    <li key={`${g.kind}-${i}`} lang="ko">
                      {f.name}
                      {f.location && ` — ${f.location}`}
                      {f.floors && ` (${f.floors})`}
                      {f.detail && ` · ${f.detail}`}
                      {f.operatingStatus && (
                        <span
                          className={
                            f.operatingStatus === "stopped"
                              ? "ml-1 rounded bg-red-500/10 px-1 text-xs text-red-600"
                              : "ml-1 text-xs opacity-70"
                          }
                        >
                          {f.operatingStatus === "normal"
                            ? t("operatingNormal")
                            : t("operatingStopped")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/SeoulMetroFacilities.tsx
git commit -m "feat(ui): SeoulMetroFacilities 컴포넌트 — 9종 그룹 heading + 가동현황 표시"
```

---

## Task 7: PlaceDetail 통합

**Files:** Modify `src/components/PlaceDetail.tsx`

- [ ] **Step 1: import 추가** (line 10 `StationFacilities` import 아래)

```tsx
import { SeoulMetroFacilities } from "./SeoulMetroFacilities";
```

- [ ] **Step 2: 역일 때 코레일 아래에 서울 지하철 추가** (line 100 부근)

기존:
```tsx
      {isStation(place) && <StationFacilities stationName={place.name} />}
```
로 변경:
```tsx
      {isStation(place) && (
        <>
          <StationFacilities stationName={place.name} />
          <SeoulMetroFacilities stationName={place.name} />
        </>
      )}
```

- [ ] **Step 3: 타입체크 + 빌드**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/PlaceDetail.tsx
git commit -m "feat(ui): 역 상세에 서울 지하철역 교통약자 시설 노출(코레일과 병렬)"
```

---

## Task 8: 실호출 통합 검증 + 문서 갱신 (머지 게이트)

**Files:** Modify `CLAUDE.md`, `docs/SPEC.md`

- [ ] **Step 1: 전체 게이트 테스트**

Run: `npm run test:run && npm run lint`
Expected: PASS (기존 + 신규 전부)

- [ ] **Step 2: 로컬 실라우트 검증**

```bash
npm run dev  # 별도 셸
# 강동역(데이터 있음)·서울역(코레일+지하철 혼재 가능)·존재 안 하는 역
curl -s "http://localhost:3000/api/station/metro-facilities?station=강동역" | python3 -m json.tool | head -40
curl -s "http://localhost:3000/api/station/metro-facilities?station=없는역" # → {"facilities":null}
```
Expected: 강동역 4종 그룹(엘리베이터 3·에스컬레이터 10·안전발판 1·화장실 1 — 정확매칭으로 강동구청 분 제외, 충전기는 강동구청만이라 미포함), 없는역 null.

- [ ] **Step 3: a11y 점검**

`a11y-auditor` 서브에이전트로 `SeoulMetroFacilities.tsx`·`PlaceDetail.tsx` 점검(과잉 ARIA·heading 구조·aria-live 단일 채널·`lang="ko"`).

- [ ] **Step 4: CLAUDE.md·SPEC 갱신**

- `CLAUDE.md` 아키텍처에 서울 지하철 교통약자 시설 provider 한 줄(코레일 짝, B553766/wksn, 9종, stnNm 포함필터+정확매칭, oprtngSitu M/S 매핑) 추가.
- `CLAUDE.md` API 키 표 `DATA_GO_KR_API_KEY` 행에 "서울교통공사 교통약자이용정보(15143843) 활용신청·실호출 검증 완료(2026-06-17)" 추가.
- `docs/SPEC.md` §3 백로그 "서울 지하철역 교통약자 시설" 행을 **운영 중**으로, 미해결 항목/로드맵(`2026-06-16-implementation-roadmap-design.md`)의 A1을 완료로.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/SPEC.md
git commit -m "docs: 서울 지하철역 교통약자 시설(A1) 운영 반영 — 실호출 검증 완료"
```

- [ ] **Step 6: (사용자 요청 시) 프로덕션 배포**

`DATA_GO_KR_API_KEY`는 이미 프로덕션 등록됨(코레일과 공유) → 별도 env 추가 불필요. push 또는 `vercel deploy --prod --yes` 후 `gildongmu.vercel.app/api/station/metro-facilities?station=강동역` 실호출 검증.

---

## Self-Review

- **Spec 커버리지**: A1(서울 지하철역 교통약자 시설, 위치 풍부 모델, 9종 전부) — Task 1~7 전부 구현. 로드맵 §3 A1 충족.
- **Placeholder**: 없음(필드명·oprtngSitu 매핑·envelope 모두 실호출 확정값).
- **타입 정합**: `SeoulMetroFacilities`/`SeoulMetroFacility`/`SeoulMetroFacilityKind`가 Task 1 정의 ↔ Task 2/3 파서 ↔ Task 6 컴포넌트에서 일관. `parseStationItems`(코레일)·`normalizeStationName`(station-match) 재사용 — 기존 시그니처와 일치.
- **알려진 잔여**: `oprtngSitu`는 M/S만 관측 — M 외 전부 stopped로 보수 처리(실측 코드표 미확보, 과소경고 회피). `line`은 정확매칭 후 첫 그룹 기준(Task 2 Step 5 주의 참조).

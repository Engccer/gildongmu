# CLI/MCP 카탈로그 미러 cli-v0.4.0 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** route-walk(0.3.0) 이후 웹 신규분(station-timetable 신설, metro-facilities 보강 그룹, transit 배차간격)을 CLI/MCP 카탈로그·산문 포매터에 반영하고 이월 백로그(formatRouteWalk 죽은 분기, coordSchema 3중복)를 정리해 cli-v0.4.0으로 발행한다.

**Architecture:** `packages/cli/src/lib/endpoint-catalog-shared.ts`가 정본, `packages/mcp/src/endpoint-catalog-shared.ts`는 byte 복사본(catalog-drift 테스트가 sha256으로 강제). MCP 도구는 카탈로그에서 자동 파생되므로 카탈로그 추가만으로 `station_timetable` 도구가 노출된다. CLI 산문은 `packages/cli/src/lib/formatters.ts`의 레지스트리(카탈로그 name 키 일치)가 담당한다.

**Tech Stack:** TypeScript(ESM), citty, Vitest, zod, npm Trusted Publishing(cli-v* 태그 → GitHub Actions OIDC).

## Global Constraints

- 카탈로그 両미러는 byte 동일 유지 — cli 쪽 수정 후 `cp packages/cli/src/lib/endpoint-catalog-shared.ts packages/mcp/src/endpoint-catalog-shared.ts`.
- 3-state 불변식: "0건/없음" ≠ "정보 없음(unknown/null)" ≠ "조회 실패"를 산문에서 뭉개지 않는다.
- joinText 규칙: 한 항목 한 줄, 구분자는 쉼표(joinText가 담당), 가운뎃점 금지.
- CLI는 웹 타입을 import하지 않는다 — 필드는 `src/lib/types.ts`와 대조한 로컬 재선언.
- 커밋: `git add -A` 금지, 의도 파일만 pathspec으로. 메시지 한국어 + Co-Authored-By/Claude-Session 푸터. 커밋 후 `git show HEAD --stat` 검증.
- `--provenance` 금지(private repo, 404로 위장된 422).
- 주석·문서 한국어, 변수/함수명 영어. em dash 금지.

---

### Task 1: 카탈로그 両미러에 station-timetable 추가

**Files:**
- Modify: `packages/cli/src/lib/endpoint-catalog-shared.ts` (74행 station-metro-facilities 항목 뒤)
- Modify: `packages/mcp/src/endpoint-catalog-shared.ts` (cp로 동기화)
- Modify: `packages/mcp/src/__tests__/server.test.ts:7-9` (개수 23→24, mcp 22→23)

**Interfaces:**
- Produces: 카탈로그 name `"station-timetable"` (envelope `"timetable"`) — Task 2 포매터 키, Task 4 CLI 명령이 참조.

- [ ] **Step 1: server.test.ts 개수 어서션 갱신(먼저 실패시키기)**

`packages/mcp/src/__tests__/server.test.ts`의 개수 어서션을 갱신:

```ts
  it("mcp:true 항목이 23개(web-search 1건만 제외)", () => {
    expect(ENDPOINT_CATALOG.length).toBe(24);
    expect(mcpTools.length).toBe(23);
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/mcp && npx vitest run src/__tests__/server.test.ts`
Expected: FAIL (23 ≠ 24)

- [ ] **Step 3: cli 카탈로그에 항목 추가**

`packages/cli/src/lib/endpoint-catalog-shared.ts`의 `station-metro-facilities` 항목(74행) 바로 뒤에:

```ts
  { name: "station-timetable", description: "역 첫차·막차 시간표(TAGO, 서비스데이 기준 라벨 포함)", path: "/api/station/timetable", method: "GET",
    params: [{ key: "station", type: "string", required: true, description: "역명" }], envelope: "timetable", locationParam: false, mcp: true },
```

- [ ] **Step 4: mcp 미러 동기화**

Run: `cp packages/cli/src/lib/endpoint-catalog-shared.ts packages/mcp/src/endpoint-catalog-shared.ts`

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm run test:run` (repo 루트 — cli catalog.test·mcp server.test·catalog-drift.test 모두 포함)
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(cli): 카탈로그에 station-timetable 신설 — 両미러 동기화" -- packages/cli/src/lib/endpoint-catalog-shared.ts packages/mcp/src/endpoint-catalog-shared.ts packages/mcp/src/__tests__/server.test.ts
```

---

### Task 2: formatStationTimetable 포매터 신설

**Files:**
- Modify: `packages/cli/src/lib/formatters.ts` (역명 기반 조회 섹션에 타입+포매터, 레지스트리에 `"station-timetable"` 키)
- Test: `packages/cli/src/__tests__/formatters.test.ts`

**Interfaces:**
- Consumes: 카탈로그 name `"station-timetable"` (Task 1).
- Produces: `FORMATTERS["station-timetable"]` — `{ timetable: StationTimetableItem | null }`를 받아 산문 배열 반환. Task 4의 `station info` 4번째 섹션·`station timetable` 명령이 사용.

- [ ] **Step 1: 실패 테스트 작성**

`packages/cli/src/__tests__/formatters.test.ts`에 추가(기존 describe 블록들과 같은 레벨):

```ts
describe("station-timetable", () => {
  it("노선·방향별 첫차·막차와 기준 라벨을 낭독한다", () => {
    const lines = FORMATTERS["station-timetable"]({
      timetable: {
        dailyType: "weekday",
        lines: [
          {
            lineName: "5호선",
            directions: [
              { direction: "up", first: { time: "05:31", terminus: "방화" }, last: { time: "00:31", nextDay: true, terminus: "마천" } },
              { direction: "down", first: { time: "05:40", terminus: "하남검단산" }, last: { time: "23:50", terminus: "하남검단산" } },
            ],
          },
        ],
      },
    } as never);
    expect(lines[0]).toBe("평일 기준");
    expect(lines[1]).toBe("5호선 상행, 첫차 05:31 방화행, 막차 익일 00:31 마천행");
    expect(lines[2]).toBe("5호선 하행, 첫차 05:40 하남검단산행, 막차 23:50 하남검단산행");
  });
  it("partial이면 기준 라벨 줄에 불완전 안내를 병기한다", () => {
    const lines = FORMATTERS["station-timetable"]({
      timetable: { dailyType: "sunday", partial: true, lines: [] },
    } as never);
    expect(lines[0]).toBe("일요일·공휴일 기준, 일부 노선 정보를 불러오지 못했습니다");
    expect(lines[1]).toBe("오늘 시간표 정보가 없습니다.");
  });
  it("null(미커버 역·키 없음)은 미제공 문장(3-state)", () => {
    expect(FORMATTERS["station-timetable"]({ timetable: null } as never)).toEqual([
      "이 역은 첫차·막차 정보 제공 대상이 아닙니다.",
    ]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/cli && npx vitest run src/__tests__/formatters.test.ts`
Expected: FAIL (`FORMATTERS["station-timetable"]` undefined)

- [ ] **Step 3: 타입+포매터 구현**

`formatters.ts` "역명 기반 조회" 섹션(로컬 타입은 타입 구역)에 추가. 필드는 웹 `src/lib/types.ts` `TimetableTrain`/`TimetableDirection`/`TimetableLine`/`StationTimetable` 대조 완료본(terminusEn은 CLI ko 산문이라 미사용 — 재선언 생략):

```ts
interface TimetableTrainItem {
  time: string;
  nextDay?: true;
  terminus: string;
}

interface TimetableDirectionItem {
  direction: "up" | "down";
  first: TimetableTrainItem;
  last: TimetableTrainItem;
}

interface TimetableLineItem {
  lineName: string;
  directions: TimetableDirectionItem[];
}

interface StationTimetableItem {
  dailyType: "weekday" | "saturday" | "sunday";
  partial?: true;
  lines: TimetableLineItem[];
}
```

헬퍼 상수(공통 헬퍼 구역):

```ts
// 웹 messages/ko.json timetable.* 카피와 동일 유지(CLI 산문 미러).
const DAILY_TYPE_KO: Record<StationTimetableItem["dailyType"], string> = {
  weekday: "평일 기준", saturday: "토요일 기준", sunday: "일요일·공휴일 기준",
};
```

포매터("역명 기반 조회" 구역, formatSubwayArrival 앞):

```ts
function timetableTrainText(label: string, t: TimetableTrainItem): string {
  return `${label} ${t.nextDay ? "익일 " : ""}${t.time} ${t.terminus}행`;
}

/** 200 + null = TAGO 미커버 역·키 없음(라우트 판정 표) — 조회 실패(502)와 다른 문장. */
function formatStationTimetable(body: { timetable: StationTimetableItem | null }): string[] {
  const tt = body.timetable;
  if (!tt) return ["이 역은 첫차·막차 정보 제공 대상이 아닙니다."];
  const lines: string[] = [
    joinText(DAILY_TYPE_KO[tt.dailyType], tt.partial && "일부 노선 정보를 불러오지 못했습니다"),
  ];
  if (tt.lines.length === 0) {
    lines.push("오늘 시간표 정보가 없습니다.");
    return lines;
  }
  for (const line of tt.lines) {
    for (const d of line.directions) {
      lines.push(joinText(
        `${line.lineName} ${d.direction === "up" ? "상행" : "하행"}`,
        timetableTrainText("첫차", d.first),
        timetableTrainText("막차", d.last),
      ));
    }
  }
  return lines;
}
```

레지스트리에 등록(`"station-metro-facilities"` 다음 줄):

```ts
  "station-timetable": formatStationTimetable,
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd packages/cli && npx vitest run src/__tests__/formatters.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(cli): station-timetable 산문 포매터 — 기준 라벨·익일·행선지 낭독" -- packages/cli/src/lib/formatters.ts packages/cli/src/__tests__/formatters.test.ts
```

---

### Task 3: metro-facilities 보강 그룹 + transit 배차간격 + formatRouteWalk 정리

**Files:**
- Modify: `packages/cli/src/lib/formatters.ts`
- Test: `packages/cli/src/__tests__/formatters.test.ts`

**Interfaces:**
- Consumes: 기존 `FORMATTERS["station-metro-facilities" | "route-transit" | "route-walk"]`.
- Produces: 시그니처 변경 없음(내부 보강만).

- [ ] **Step 1: 실패 테스트 3벌 작성**

`formatters.test.ts`의 해당 describe들에 추가:

```ts
// station-metro-facilities describe 안에:
  it("보강 그룹(음성유도기·엘리베이터 위치)과 detail·supplementFailed를 낭독한다", () => {
    const lines = FORMATTERS["station-metro-facilities"]({
      facilities: {
        groups: [
          { kind: "voiceGuide", facilities: [{ name: "음성유도기", location: "1번 출구", floors: undefined, detail: undefined, operatingStatus: undefined }] },
          { kind: "elevatorLocation", facilities: [{ name: "엘리베이터", location: "대합실", floors: undefined, detail: "북동쪽 120m", operatingStatus: undefined }] },
        ],
        supplementFailed: true,
      },
    } as never);
    expect(lines).toContain("시각장애인 음성유도기: 1개");
    expect(lines).toContain("엘리베이터 위치: 1개");
    expect(lines).toContain("엘리베이터, 대합실, 북동쪽 120m");
    expect(lines[lines.length - 1]).toBe("일부 시설 정보를 불러오지 못했습니다.");
  });
  it("groups 전멸 + supplementFailed면 실패 문장만(은폐 금지)", () => {
    expect(FORMATTERS["station-metro-facilities"]({
      facilities: { groups: [], supplementFailed: true },
    } as never)).toEqual(["일부 시설 정보를 불러오지 못했습니다."]);
  });

// route-transit describe 안에:
  it("배차간격이 있으면 구간 줄에 병기한다", () => {
    const lines = FORMATTERS["route-transit"]({
      result: {
        recommended: {
          summary: { totalMinutes: 30, fare: 1500, transfers: 0, walkMinutes: 5 },
          legs: [{ mode: "subway", lineName: "5호선", fromName: "길동", toName: "강남", stationCount: 10, minutes: 25, intervalMinutes: 6 }],
        },
        alternatives: [],
      },
    } as never);
    expect(lines).toContain("5호선 길동→강남, 10개 역, 25분, 배차간격 약 6분");
  });

// route-walk describe 안에:
  it("result null(3102 경로 없음)은 미발견 문장(크래시 금지)", () => {
    expect(FORMATTERS["route-walk"]({ result: null } as never)).toEqual(["도보 경로를 찾을 수 없습니다."]);
  });
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/cli && npx vitest run src/__tests__/formatters.test.ts`
Expected: FAIL (undefined 라벨·배차 미병기·null 크래시)

- [ ] **Step 3: 구현**

(a) metro-facilities — 타입 확장(웹 `SeoulMetroFacilityGroupKind`·`SeoulMetroFacility.detail`·`SeoulMetroFacilities.supplementFailed` 대조):

```ts
type MetroFacilityGroupKind = MetroFacilityKind | "voiceGuide" | "elevatorLocation";

interface MetroFacilityItem {
  name: string;
  location: string | undefined;
  floors: string | undefined;
  detail: string | undefined;
  operatingStatus: "normal" | "stopped" | undefined;
}

interface MetroFacilityGroupItem {
  kind: MetroFacilityGroupKind;
  facilities: MetroFacilityItem[];
}

interface SeoulMetroFacilitiesItem {
  groups: MetroFacilityGroupItem[];
  supplementFailed?: true;
}
```

`METRO_KIND_KO`를 `Record<MetroFacilityGroupKind, string>`으로 바꾸고 두 항목 추가(웹 ko.json 카피 동일):

```ts
  voiceGuide: "시각장애인 음성유도기", elevatorLocation: "엘리베이터 위치",
```

`formatMetroFacilities` 교체:

```ts
function formatMetroFacilities(body: { facilities: SeoulMetroFacilitiesItem | null }): string[] {
  const f = body.facilities;
  // groups 전멸이어도 supplementFailed면 non-null로 온다(실패 은폐 금지) — 빈 배열+플래그 조합 보존.
  if (!f || (f.groups.length === 0 && !f.supplementFailed)) return ["교통약자 시설 정보가 없습니다."];
  const lines: string[] = [];
  for (const g of f.groups) {
    lines.push(`${METRO_KIND_KO[g.kind]}: ${g.facilities.length}개`);
    for (const fac of g.facilities) {
      lines.push(joinText(fac.name, fac.location, fac.floors, fac.detail, fac.operatingStatus === "stopped" && "가동 중지"));
    }
  }
  if (f.supplementFailed) lines.push("일부 시설 정보를 불러오지 못했습니다.");
  return lines;
}
```

(b) transit — `TransitLegItem`에 `intervalMinutes?: number;` 추가, `transitLegLine` 교체:

```ts
function transitLegLine(leg: TransitLegItem): string {
  if (leg.mode === "walk") return `도보 ${leg.minutes}분`;
  return joinText(
    `${leg.lineName} ${leg.fromName}→${leg.toName}`,
    `${leg.stationCount}개 역`,
    `${leg.minutes}분`,
    typeof leg.intervalMinutes === "number" && `배차간격 약 ${leg.intervalMinutes}분`,
  );
}
```

(c) route-walk — `WalkRouteStepItem`에서 `distanceMeters` 제거(provider가 step 거리를 만들지 않아 죽은 분기), null 분기 추가:

```ts
interface WalkRouteStepItem {
  description: string;
}

/** envelope "result" — Tmap 완성 문장(description)이 낭독 정본, 재조합 없이 그대로.
 *  null = 3102 경로 없음(라우트 200 graceful) — 조회 실패(502)와 다른 문장(3-state). */
function formatRouteWalk(body: { result: WalkRouteBriefingItem | null }): string[] {
  const r = body.result;
  if (!r) return ["도보 경로를 찾을 수 없습니다."];
  const lines: string[] = [
    joinText(`${(r.distanceMeters / 1000).toFixed(1)}km`, `약 ${Math.round(r.durationSeconds / 60)}분`),
  ];
  r.steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.description}`);
  });
  return lines;
}
```

기존 route-walk 테스트가 step distanceMeters를 넣고 있으면 description-only fixture로 정리한다.

- [ ] **Step 4: 전체 테스트 통과 확인**

Run: `npm run test:run`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git commit -m "fix(cli): 시설 보강 그룹·배차간격 산문 반영 + route-walk null 분기(죽은 거리 분기 제거)" -- packages/cli/src/lib/formatters.ts packages/cli/src/__tests__/formatters.test.ts
```

---

### Task 4: CLI 명령 배선 — station timetable 서브커맨드 + station info 4섹션 + completion + README

**Files:**
- Modify: `packages/cli/src/commands/station.ts`
- Modify: `packages/cli/src/commands/completion.ts:13` (station 배열)
- Modify: `packages/cli/README.md` (예시·명령 표)
- Modify: `packages/mcp/README.md` (도구 22종→23종 + station_timetable 행)
- Test: `packages/cli/src/__tests__/commands-station.test.ts` (기존 패턴 참조), `command-tree.test.ts`·`commands-completion.test.ts`는 기존 어서션이 새 서브커맨드를 자동 검증하는지 확인 후 필요 시 갱신

**Interfaces:**
- Consumes: `FORMATTERS["station-timetable"]`(Task 2), 카탈로그 `"station-timetable"`(Task 1), `runEndpoint`(shared.ts).
- Produces: `gil station timetable <역명>` 명령, `gil station info`의 "첫차·막차" 섹션.

- [ ] **Step 1: 실패 테스트 작성**

`commands-station.test.ts`의 기존 스타일(msw 또는 fetch mock — 파일 열어 기존 패턴 그대로)을 따라: ① `station timetable 강동` 호출 시 `/api/station/timetable?station=강동` 요청·산문 출력 ② `station info`가 4섹션(meta·timetable·facilities·metro-facilities)을 병렬 호출하고 timetable rejected 시 "첫차·막차 조회 실패" 한 줄을 내는 케이스.

- [ ] **Step 2: 실패 확인**

Run: `cd packages/cli && npx vitest run src/__tests__/commands-station.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`station.ts` — `INFO_SECTIONS`에 meta 다음(웹 장소 상세 표시 순서 미러) 추가:

```ts
  { catalog: "station-timetable", envelopeKey: "timetable", title: "첫차·막차", jsonKey: "timetable" },
```

서브커맨드 추가(arrivalsCommand와 동형):

```ts
/** 역 첫차·막차 시간표 — 단순 카탈로그 위임. */
const timetableCommand = defineCommand({
  meta: { name: "timetable", description: "역 첫차·막차 시간표" },
  args: {
    station: { type: "positional", description: "역명", required: true },
    output: sharedArgs.output,
  },
  async run({ args }) {
    await runEndpoint("station-timetable", { station: args.station }, args.output);
  },
});
```

`subCommands: { info: infoCommand, timetable: timetableCommand, arrivals: arrivalsCommand }`.

`completion.ts`: `station: ["info", "timetable", "arrivals"]`.

`packages/cli/README.md`: 예시 블록에 `gil station timetable "강동역"             # 역 첫차·막차 시간표` 추가, 명령 표 `station` 행을 `` `info <역명>`, `timetable <역명>`, `arrivals <역명>` ``로.

`packages/mcp/README.md`: "노출되는 도구 (22종)"→"(23종)", 도구 표에 `station_timetable` 행(설명: 역 첫차·막차 시간표) 추가.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:run`
Expected: PASS (command-tree·completion 테스트 포함)

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(cli): station timetable 명령 + station info 첫차·막차 섹션 — completion·README 동기" -- packages/cli/src/commands/station.ts packages/cli/src/commands/completion.ts packages/cli/src/__tests__/commands-station.test.ts packages/cli/README.md packages/mcp/README.md
```

(command-tree·completion 테스트를 고쳤으면 해당 파일도 pathspec에 포함)

---

### Task 5: coordSchema 3중복 공용화(웹, 이월 백로그)

**Files:**
- Create: `src/lib/route-coord-schema.ts`
- Modify: `src/app/api/route/car/route.ts`, `src/app/api/route/walk/route.ts`, `src/app/api/route/transit/route.ts` (로컬 coordSchema 제거→import)
- Test: `src/lib/__tests__/route-coord-schema.test.ts` (신규)

**Interfaces:**
- Produces: `coordSchema` — `"위도,경도"` 문자열을 `{lat,lng}`로 변환·한반도 권역 검증하는 zod 스키마. 세 길찾기 라우트가 공유.

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/__tests__/route-coord-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { coordSchema } from "../route-coord-schema";

describe("coordSchema", () => {
  it("'위도,경도' 문자열을 {lat,lng}로 변환한다", () => {
    expect(coordSchema.parse("37.535,127.140")).toEqual({ lat: 37.535, lng: 127.14 });
  });
  it("형식 위반은 실패한다", () => {
    expect(coordSchema.safeParse("127.140;37.535").success).toBe(false);
  });
  it("한반도 권역 밖 좌표는 거부한다", () => {
    expect(coordSchema.safeParse("48.85,2.35").success).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/route-coord-schema.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 공용 모듈 생성 + 3라우트 치환**

`src/lib/route-coord-schema.ts`:

```ts
import { z } from "zod";
import { isInKorea } from "@/lib/deeplink";

/**
 * "위도,경도" 문자열 → {lat,lng} (WGS84) — 자동차·대중교통·도보 길찾기 라우트 공용.
 * 세 라우트에 동일 스키마가 3중복돼 있던 것을 공용화(2026-07-22 백로그).
 */
export const coordSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "좌표 형식은 '위도,경도'")
  .transform((raw) => {
    const [lat, lng] = raw.split(",").map(Number);
    return { lat, lng };
  })
  .refine((c) => isInKorea(c.lat, c.lng), "좌표가 한반도 권역을 벗어남");
```

세 라우트에서 로컬 `const coordSchema = …` 블록 삭제, `import { coordSchema } from "@/lib/route-coord-schema";` 추가(각 파일의 기존 `querySchema`는 그대로). walk·transit의 `isInKorea`/`z` import가 다른 용도로 안 쓰이면 정리(car는 `z`를 querySchema에 계속 사용 — lang 필드 유무를 파일에서 확인 후 불필요 import만 제거).

- [ ] **Step 4: 전체 테스트+빌드 확인**

Run: `npm run test:run && npm run lint && npm run build`
Expected: PASS (기존 라우트 동작 byte-identical — 오류 메시지 문자열 동일)

- [ ] **Step 5: 커밋**

```bash
git commit -m "refactor(route): coordSchema 3중복 공용화 — route-coord-schema 모듈 신설" -- src/lib/route-coord-schema.ts src/lib/__tests__/route-coord-schema.test.ts src/app/api/route/car/route.ts src/app/api/route/walk/route.ts src/app/api/route/transit/route.ts
```

---

### Task 6: 프로덕션 실호출 검증(머지 게이트)

**Files:** 없음(검증 전용). CLI는 로컬 빌드, API는 프로덕션(`https://gildongmu.vercel.app` — timetable·시설 보강·배차간격 라우트는 이미 배포되어 있음).

- [ ] **Step 1: CLI 빌드**

Run: `cd packages/cli && npm run build` (빌드 스크립트 없으면 `npx tsc -p tsconfig.json` — package.json 확인)
Expected: dist/ 생성

- [ ] **Step 2: 실호출 6종**

```bash
node packages/cli/dist/index.js station timetable 강동          # 5호선 상·하행, 평일/휴일 기준 라벨
node packages/cli/dist/index.js station timetable 김포공항      # 다노선(5·9·공항·김포골드) 시간표 또는 partial
node packages/cli/dist/index.js station info 강동               # 4섹션: 메타+첫차·막차+코레일+서울지하철(음성유도기 그룹 포함)
node packages/cli/dist/index.js station info "여의도"           # 9호선 elevatorLocation 폴백 그룹 확인
node packages/cli/dist/index.js route transit "길동생태공원" "강남역"   # 배차간격 약 N분 병기 확인
node packages/cli/dist/index.js route walk "서울역" "제주공항"   # null 분기: "도보 경로를 찾을 수 없습니다." (크래시 0)
```

Expected: 각 산문에 신규 요소가 실데이터로 표기. `undefined:` 문자열 출력 0. exit 코드 0.

- [ ] **Step 3: MCP 스모크**

```bash
cd packages/mcp && npm run build
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node dist/index.js | grep -o '"station_timetable"'
```

Expected: `"station_timetable"` 출력(도구 자동 파생 확인).

- [ ] **Step 4: 웹 coordSchema 회귀 실호출(푸시·자동배포 후)**

Task 5 커밋이 push되어 자동배포 완료된 뒤:

```bash
curl -s "https://gildongmu.vercel.app/api/route/walk?origin=37.538,127.146&dest=37.535,127.132" | head -c 200
curl -s "https://gildongmu.vercel.app/api/route/car?origin=37.538,127.146&dest=37.497,127.027" | head -c 200
curl -s "https://gildongmu.vercel.app/api/route/transit?origin=37.538,127.146&dest=37.497,127.027" | head -c 200
curl -s "https://gildongmu.vercel.app/api/route/walk?origin=abc&dest=1,2" # 400 "좌표 형식은 '위도,경도'"
```

Expected: 세 경로 정상 JSON, 형식 오류 400 메시지 동일(회귀 0).

- [ ] **Step 5: 검증 결과를 PROGRESS.md에 기록할 메모로 정리** (Task 8에서 반영)

---

### Task 7: 버전 동조 0.4.0 + 태그 발행 + npm 스모크

**Files:**
- Modify: `packages/cli/package.json` (0.3.0→0.4.0), `packages/mcp/package.json` (0.3.0→0.4.0)
- Modify: `packages/mcp/src/index.ts:15` (`version: "0.1.0"` 리터럴 → `"0.4.0"` — 발행 버전과 동조)
- 확인: `packages/cli/src/index.ts`에 버전 리터럴이 있으면 함께 동조

- [ ] **Step 1: 버전 갱신 + 리터럴 동조**

두 package.json `"version": "0.4.0"`, mcp index.ts `new McpServer({ name: "gildongmu", version: "0.4.0" })`. `grep -rn "0\.3\.0\|0\.1\.0" packages/*/src packages/*/package.json`으로 잔여 리터럴 확인.

- [ ] **Step 2: 최종 게이트**

Run: `npm run test:run && npm run lint`
Expected: PASS

- [ ] **Step 3: 커밋 + 태그 push**

```bash
git commit -m "chore(release): cli·mcp 0.4.0 — station-timetable·시설 보강 그룹·배차간격 미러" -- packages/cli/package.json packages/mcp/package.json packages/mcp/src/index.ts
git push origin main
git tag cli-v0.4.0 && git push origin cli-v0.4.0
```

- [ ] **Step 4: Actions 발행 확인**

Run: `gh run list --workflow=cli-publish.yml --limit 1` → 완료까지 `gh run watch <id>` (실패 시 로그 확인, `--provenance` 금지 함정 상기)
Expected: success, npm에 `gildongmu@0.4.0`·`gildongmu-mcp@0.4.0`.

- [ ] **Step 5: npm 설치 스모크**

```bash
npm view gildongmu version && npm view gildongmu-mcp version   # 0.4.0
npx -y gildongmu@0.4.0 station timetable 강동
```

Expected: 0.4.0, 첫차·막차 산문 출력.

---

### Task 8: PROGRESS.md 마일스톤 기록

**Files:**
- Modify: `PROGRESS.md` (운영 표 CLI/MCP 행 또는 신규 행 + "다음 마일스톤" ① 완료 처리, 이월 백로그에서 coordSchema·formatRouteWalk 제거)

- [ ] **Step 1: 기록 + 커밋**

운영 표에 v0.4.0 발행·실호출 검증 결과(Task 6 메모) 요약, A-트랙 ① 완료 표기. 커밋:

```bash
git commit -m "docs(progress): CLI/MCP 카탈로그 미러 v0.4.0 발행 기록 — A-트랙 ① 완료" -- PROGRESS.md
git push origin main
```

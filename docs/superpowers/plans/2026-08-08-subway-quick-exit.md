# 지하철 빠른하차 출입문 병치 구현 계획 (백로그 E5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지하철 하차역에서 계단·엘리베이터에 가장 가까운 칸·문 번호를 승차 전에 알려, 하차 후 승강장을 흰지팡이로 훑는 탐색을 없앤다.

**Architecture:** 서울교통공사 빠른하차 2,358행을 정적 seed로 굳혀 런타임 upstream 호출을 0으로 만든다. 순수 함수가 (하차역·노선·직전역)으로 방향을 긍정 확정하고 열차 선형 위치로 엘리베이터·계단 쌍을 고른다. 서버가 `TransitLeg.quickExit`에 값을 싣고 문장은 각 소비자가 i18n으로 만든다.

**Tech Stack:** Node 빌드 스크립트(mjs) · TypeScript 순수 함수 · Vitest · Next.js 16 route · next-intl 6로케일 · SwiftUI + GildongmuKit · citty CLI

**설계 정본:** `docs/superpowers/specs/2026-08-08-subway-quick-exit-design.md` (codex 적대적 리뷰 24건 판정 반영본)

## Global Constraints

- **3-state**: 판정 불가·미커버·시설 없음은 전부 **필드 부재**. "정보 없음" 문구를 만들지 않는다.
- **한 줄 = 한 접근성 객체**: 문장을 인라인 `<span>`으로 쪼개지 않는다.
- **통지 금지**: 정적 정보이므로 live region·announce를 쓰지 않는다.
- **미지 형태는 빌드 중단**: 문 번호·시설·방향 문법 화이트리스트 밖은 관용 파싱하지 않는다.
- **커밋**: `git add -A` 금지, 의도 파일만. 이메일 `engccer@gmail.com`, 푸터 유지.
- **게이트**: 매 커밋 `npm run test:run` 통과. 타입은 `npx tsc --noEmit`(선재 5건 외 0), Kit은 `swift test`.
- **i18n 6로케일 동시**(`ko`·`en`·`es`·`fr`·`it`·`ja`) — `i18n-messages.test.ts`가 머지 게이트.

## 구현 방식 판정

**inline.** T1→T2→T3이 강한 순차 의존이다(seed 모양이 함수 시그니처를, 함수 반환형이 API 필드를, 필드가 6개 소비자의 문장을 정한다). 자율성 헌장 §구현 방식 판정의 "선행 결정이 후속 태스크의 인터페이스를 바꾸는가"에 **바꾼다**로 답한다. T5~T9는 인터페이스 고정 후 독립이지만 각각 파일 1~2개라 위임 오버헤드가 이득을 넘는다. **리뷰는 판정과 무관하게 분리한다**(T11).

## File Structure

| 파일 | 책임 |
|---|---|
| `scripts/build-subway-quick-exit.mjs` (신규) | 전량 수집·정제·가드 10종·seed 생성 |
| `src/lib/data/subway-quick-exit.json` (생성물) | (역·노선·방향)별 방면·시설·문 |
| `src/lib/quick-exit.ts` (신규) | 노선 정규화 → 방향 긍정 확정 → 선형 쌍 최적화 |
| `src/lib/types.ts` | `QuickExitDoor`·`QuickExit`·`TransitLeg.quickExit` |
| `src/lib/providers/odsay.ts` | `toLeg`가 지하철 leg에 `quickExit` 부착 |
| `messages/{ko,en,es,fr,it,ja}.json` | `route.transit.quickExit*` 5키 |
| `src/lib/quick-exit-text.ts` (신규) | 값 → 문장 조립(웹 공용, 3분기 × 2형태) |
| `src/components/TransitRouteBriefing.tsx` | 브리핑 지하철 leg 아래 줄 |
| `src/components/TransitGuidePanel.tsx` | 대기 국면, 열차 목록 heading 앞 |
| `packages/cli/src/lib/formatters.ts` | `transitLegLine` 확장 |
| `ios/GildongmuKit/.../Models/RouteModels.swift` | `TransitRouteLeg.quickExit` 디코딩 |
| `ios/GildongmuKit/.../QuickExitText.swift` (신규) | Swift 문장 조립(웹 미러) |
| `ios/Gildongmu/RouteBriefing.swift` | `transitLegText` 뒤 줄 |
| `ios/Gildongmu/Directions/TransitTrackingSheet.swift` | 대기 국면 |

---

### Task 1: seed 빌드 스크립트와 데이터

**Files:**
- Create: `scripts/build-subway-quick-exit.mjs`
- Create(생성물): `src/lib/data/subway-quick-exit.json`
- Test: `src/lib/__tests__/subway-quick-exit-seed.test.ts`

**Interfaces:**
- Produces: seed JSON 형태
  ```ts
  type QuickExitSeed = {
    meta: { crtrYmd: string; builtAt: string; rows: number };
    // 키: `${정규화역명}|${노선}` → 방향별
    stations: Record<string, QuickExitDirection[]>;
  };
  type QuickExitDirection = {
    up: boolean;                 // true=상행
    toward: string[];            // drtnInfo (분기역은 2개)
    elevator: string[];          // 문 번호 원문("6-4"·"3-2,3-3 사이")
    stairs: string[];
  };
  ```

- [ ] **Step 1: 스크립트 작성 — 수집**

`DATA_GO_KR_API_KEY`로 `https://apis.data.go.kr/B553766/inout/getFstExit`를 `numOfRows=500`씩 페이징. ⚠ **`dataType=json`**(`_type=json`은 XML을 준다). 각 페이지에서 `response.header.resultCode`가 `00`인지 확인하고, 아니면 즉시 throw.

- [ ] **Step 2: 정제**

① 에스컬레이터 행 제외 ② `qckgffVhclDoorNo === "NA-NA"` 폐기(개수를 로그로) ③ `(stnCd,lineNm,upbdnbSe,drtnInfo,qckgffVhclDoorNo,plfmCmgFac)` 완전 중복 제거 ④ 역명은 `station-match.ts`와 같은 규칙으로 후행 괄호 제거.

- [ ] **Step 3: 가드 10종 구현 — 하나라도 실패하면 `process.exit(1)`**

수집 완전성 3종(행 수 == `totalCount` · `qckgffMngNo` 중복·누락 0 · `crtrYmd` 단일), 문법 화이트리스트 3종(문 번호 `^\d+-\d+$`|`^\d+-\d+,\d+-\d+ 사이$`|`NA-NA` · 시설 3종 · 방향 2종), 구조 4종(노선 8종 · 역 seed 조인 100% · 두 방향 `drtnInfo` 교집합 0 · `drtnInfo`가 `stnNo` 인접역과 일치[서교공 목록 밖 인접역은 검사 제외] · `상행`=번호−1·`하행`=번호+1), 이전본 대비 1종((역·노선·방향) 집합과 시설별 행 수 감소 시 중단).

- [ ] **Step 4: 실행하고 산출물 확인**

Run: `node scripts/build-subway-quick-exit.mjs`
Expected: 가드 전량 통과, `stations` 키 276, 방향 543.

- [ ] **Step 5: seed 형태 테스트**

```ts
it("에스컬레이터를 싣지 않는다", () => {
  const all = Object.values(seed.stations).flat();
  expect(all.every((d) => !("escalator" in d))).toBe(true);
});
it("NA-NA를 싣지 않는다", () => {
  const doors = Object.values(seed.stations).flat().flatMap((d) => [...d.elevator, ...d.stairs]);
  expect(doors).not.toContain("NA-NA");
});
it("창동 4호선 상행은 계단 2개를 남긴다", () => {
  const dirs = seed.stations["창동|4호선"];
  const up = dirs.find((d) => d.up)!;
  expect(up.stairs.sort()).toEqual(["3-4", "7-3"]);
});
```

- [ ] **Step 6: 가드 변이 주입**

각 가드마다 입력을 변조해(행 삭제·형태 변조·한 방향 제거) **빌드가 실제로 서는지** 확인하고 결과를 커밋 메시지에 기록.

- [ ] **Step 7: 커밋**

```bash
git add scripts/build-subway-quick-exit.mjs src/lib/data/subway-quick-exit.json src/lib/__tests__/subway-quick-exit-seed.test.ts
git commit -m "feat(subway): 빠른하차 정적 seed와 가드 10종" -- scripts/build-subway-quick-exit.mjs src/lib/data/subway-quick-exit.json src/lib/__tests__/subway-quick-exit-seed.test.ts
```

---

### Task 2: 판정 순수 함수

**Files:**
- Create: `src/lib/quick-exit.ts`
- Test: `src/lib/__tests__/quick-exit.test.ts`

**Interfaces:**
- Consumes: T1의 seed JSON
- Produces:
  ```ts
  export interface QuickExitDoor { kind: "door" | "between"; doors: string[] }
  export interface QuickExit { elevator?: QuickExitDoor; stairs?: QuickExitDoor }
  export function findQuickExit(input: {
    stationName: string; lineName: string; previousStopName: string | null;
  }): QuickExit | null;
  ```

- [ ] **Step 1: 실패 테스트 먼저 — 방향 판정 8케이스**

```ts
const f = (station: string, line: string, prev: string | null) =>
  findQuickExit({ stationName: station, lineName: line, previousStopName: prev });

it("일반: 여의나루에서 온 여의도는 상행", () => {
  expect(f("여의도", "수도권 5호선", "여의나루")?.elevator?.doors).toEqual(["6-4"]);
});
it("종점: 개화산에서 온 방화는 상행(방면이 자기 역명)", () => {
  expect(f("방화", "수도권 5호선", "개화산")).not.toBeNull();
});
it("분기역은 null", () => { expect(f("강동", "수도권 5호선", "천호")).toBeNull(); });
it("단방향 수록 역의 정방향은 성공", () => { expect(f("한양대", "수도권 2호선", "뚝섬")).not.toBeNull(); });
it("단방향 수록 역의 역방향은 null", () => { expect(f("한양대", "수도권 2호선", "왕십리")).toBeNull(); });
it("응암순환은 성공", () => { expect(f("연신내", "수도권 6호선", "독바위")).not.toBeNull(); });
it("부역명은 정규화한다", () => { expect(f("강변(동서울터미널)", "수도권 2호선", "구의")).not.toBeNull(); });
it("직전역이 없으면 null", () => { expect(f("여의도", "수도권 5호선", null)).toBeNull(); });
```

- [ ] **Step 2: 노선 정규화 3케이스**

```ts
it("수도권 접두를 벗긴다", () => { expect(f("여의도", "수도권 5호선", "여의나루")).not.toBeNull(); });
it("서교공 밖 노선은 null", () => { expect(f("여의도", "수도권 9호선", "샛강")).toBeNull(); });
it("미지 표기는 null", () => { expect(f("여의도", "신분당선", "샛강")).toBeNull(); });
```

- [ ] **Step 3: 시설 선택 6케이스 — 칸 경계가 핵심**

```ts
it("선형 거리로 쌍을 고른다(서울역 1호선 하행은 계단 4-2)", () => {
  const r = f("서울역", "수도권 1호선", "시청");
  expect(r?.elevator?.doors).toEqual(["4-4"]);
  expect(r?.stairs?.doors).toEqual(["4-2"]);
});
it("칸 경계: 1-4와 2-1은 같은 칸 양끝보다 가깝다", () => {
  // 사전순 모델이면 실패한다 — 순수 함수를 직접 노출해 단위 검증
  expect(doorPosition("1-4")).toBe(4);
  expect(doorPosition("2-1")).toBe(5);
  expect(doorPosition("2-4")).toBe(8);
});
it("문 사이는 중간값을 앵커로 쓴다", () => { expect(doorPosition("3-2,3-3 사이")).toBe(10.5); });
```

엘베 복수(창동)·계단만·엘베만 3케이스 추가.

- [ ] **Step 4: 구현**

`normalizeLine`(수도권 접두 제거 + 8종 화이트리스트) → `normalizeStationName`(기존 함수 재사용) → 방향 그룹에서 `toward`에 직전역이 포함된 쪽 배제 → 정확히 1개 남을 때만 진행 → `doorPosition`으로 선형 거리 최소 쌍(동률은 엘베 위치 → 계단 위치 오름차순).

- [ ] **Step 5: 테스트 통과 확인** — `npx vitest run src/lib/__tests__/quick-exit.test.ts`

- [ ] **Step 6: 변이 주입 4종**

방향 배제를 반대로 · 쌍 최적화를 각자 최저로 · 선형 위치를 사전순으로 · `between` 앵커를 앞 문으로. **넷 다 red가 되어야 한다.** 되지 않으면 fixture에 갈리는 표본을 추가한다.

- [ ] **Step 7: 커밋**

---

### Task 3: 타입과 provider 배선

**Files:**
- Modify: `src/lib/types.ts` (`TransitLeg`에 `quickExit?`)
- Modify: `src/lib/providers/odsay.ts:118` (`toLeg`)
- Test: `src/lib/providers/__tests__/odsay.test.ts`

**Interfaces:**
- Consumes: T2 `findQuickExit`
- Produces: `TransitLeg.quickExit?: QuickExit`

- [ ] **Step 1: 실패 테스트**

```ts
it("지하철 leg에 quickExit를 싣는다", () => { /* passStopList 있는 fixture */ });
it("includeStops=false여도 싣는다", () => { /* 같은 fixture, 플래그만 off */ });
it("버스·도보 leg에는 싣지 않는다", () => {});
it("quickExit 없는 응답은 키 자체가 없다(byte-호환)", () => {});
```

- [ ] **Step 2: 구현** — `toLeg`에서 `mode === "subway"`일 때 `sp.passStopList`의 **끝에서 두 번째** 역을 직전역으로 `findQuickExit` 호출. 결과가 null이면 키를 만들지 않는다(스프레드 조건부, 기존 관례).

- [ ] **Step 3~4: 테스트 통과 · 커밋**

---

### Task 4: i18n 5키 × 6로케일과 문장 조립

**Files:**
- Modify: `messages/{ko,en,es,fr,it,ja}.json`
- Create: `src/lib/quick-exit-text.ts`
- Test: `src/lib/__tests__/quick-exit-text.test.ts`

**Interfaces:**
- Produces: `quickExitText(t, station, quickExit): string | null`

- [ ] **Step 1: 키 5개 추가(ko 기준)**

```json
"quickExitDoor": "{door} 문",
"quickExitBetween": "{first} 문과 {second} 문 사이",
"quickExitBoth": "{station} 하차, 엘리베이터 {elevator}, 계단 {stairs}.",
"quickExitElevator": "{station} 하차, 엘리베이터 {elevator}.",
"quickExitStairs": "{station} 하차, 계단 {stairs}."
```

en/es/fr/it/ja는 같은 구조로 번역. ⚠ 위치 인자 순서는 각 로케일 어순 기준.

- [ ] **Step 2: 조립 함수 테스트 5케이스** — 둘 다 · 엘베만 · 계단만 · between 포함 · null 입력.

- [ ] **Step 3~5: 구현 · `i18n-messages.test.ts` 통과 확인 · 커밋**

---

### Task 5: 웹 브리핑

**Files:** Modify `src/components/TransitRouteBriefing.tsx` (`TransitRouteResult` leg 렌더, 307행 부근) / Test: `src/components/__tests__/TransitRouteBriefing.test.tsx`

- [ ] **Step 1: 테스트** — 지하철 leg 아래에 문장이 단일 텍스트 노드로 나오고, `quickExit` 없으면 아무것도 나오지 않는다.
- [ ] **Step 2: 구현** — `legBoard`/`legTransfer` `<li>` 안에 `<p>{text}</p>` 한 줄 추가. 인라인 `<span>` 금지.
- [ ] **Step 3~4: 통과 · 커밋**

---

### Task 6: 웹 세션 대기 화면

**Files:** Modify `src/components/TransitGuidePanel.tsx` (200행 `phase === "waiting"` 블록) / Test: 같은 파일 테스트

- [ ] **Step 1: 테스트** — 대기 국면에서 문장이 **열차 목록 heading 앞**에 렌더되고, live region 밖이며(`aria-live` 조상 없음), `quickExit` 없으면 부재.
- [ ] **Step 2: 구현** — `waitingLabel` 다음 줄에 삽입. **통지·포커스 이동을 추가하지 않는다**(기존 대기 국면 포커스 계약 불변).
- [ ] **Step 3~4: 통과 · 커밋**

---

### Task 7: CLI·MCP 포매터

**Files:** Modify `packages/cli/src/lib/formatters.ts:784` (`transitLegLine`) / Test: `packages/cli/src/__tests__/formatters.test.ts`

- [ ] **Step 1: 테스트** — `--output text`에서 지하철 leg 다음 줄에 문장. ⚠ **파이프 검증은 JSON 모드라 못 잡는다**([[cli-formatter-registration-gap]]) — 테스트는 text 모드를 명시.
- [ ] **Step 2: 구현** — CLI는 i18n이 없으므로 ko 고정 문자열(기존 관례 확인 후 따름).
- [ ] **Step 3~4: 통과 · 커밋**

---

### Task 8: iOS Kit 모델과 브리핑

**Files:** Modify `ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift` · Create `ios/GildongmuKit/Sources/GildongmuKit/QuickExitText.swift` · Modify `ios/Gildongmu/RouteBriefing.swift:90` / Test: `ios/GildongmuKit/Tests/.../QuickExitTextTests.swift`

- [ ] **Step 1: 디코딩 테스트** — `quickExit` 있는 JSON·없는 JSON 둘 다 디코딩 성공(옵셔널). ⚠ **필드를 선언하지 않으면 값이 오지 않는다** — 이것이 "additive라 변경 없이 받는다"가 성립하지 않는 지점이다.
- [ ] **Step 2: 문장 조립 테스트** — 웹과 동일 5케이스(미러 동조).
- [ ] **Step 3: 구현** — `TransitRouteLeg`에 `quickExit`, `QuickExitText.swift`에 조립.
- [ ] **Step 4: 브리핑 배선** — `transitLegText` 뒤에 별도 `Text` 행(같은 `Text`에 합치면 한 줄이 길어진다).
- [ ] **Step 5~6: `swift test` 통과 · 커밋**

---

### Task 9: iOS 세션 대기 화면

**Files:** Modify `ios/Gildongmu/Directions/TransitTrackingSheet.swift`

- [ ] **Step 1: 구현** — 대기 국면 열차 목록 heading 앞에 `Text` 한 행. 통지·포커스 변경 없음.
- [ ] **Step 2: 시뮬레이터 실측** — `xcodebuildmcp simulator build-and-run` + `snapshot-ui`로 문장 존재와 순서 확인.
- [ ] **Step 3: 커밋**

---

### Task 10: 실호출 게이트

- [ ] **Step 1: 소비자별 `passStopList` 확인** — 웹·iOS·CLI·MCP 각각의 **실제 요청 형태**로 `/api/route/transit`를 호출해 지하철 leg에 `quickExit`가 오는지. 웹만 오면 §5.2 전제가 깨진 것이므로 설계로 되돌아간다.
- [ ] **Step 2: ODsay `lineName` 실값 수집** — 여러 노선의 경로를 조회해 표기 수집(현재 확인분 `"수도권 5호선"`). 8종 화이트리스트가 실제로 다 매칭되는지.
- [ ] **Step 3: 서교공 1~8호선 급행 유무 확인** — 있으면 그 노선의 실동작(null 침묵)을 기록.
- [ ] **Step 4: 결과를 `PROGRESS.md`에 기록** — 통과·실패 모두. 실패를 통과로 적지 않는다.

---

### Task 11: 독립 리뷰

- [ ] **Step 1: 코드 리뷰 디스패치** — 요구사항(이 플랜)과 산출물(커밋 범위)만 전달. **세션 히스토리·중점 지시 금지**(자율성 헌장 §리뷰 계층). 산출물을 먼저 **동결**한다([[freeze-artifact-before-review-dispatch]]).
- [ ] **Step 2: 접근성 감사 디스패치** — `a11y-auditor`. 발견 경로·한 줄 한 객체·통지 부재가 초점.
- [ ] **Step 3: 반영** — 지적을 계층 대조 후 반영. 기각은 근거를 남긴다.

---

### Task 12: 문서·배포

- [ ] **Step 1: `CLAUDE.md`** — 통합 카탈로그에 빠른하차 행 추가. ⚠ **`dataType=json` 함정**을 data.go.kr 공용 파서 항목에 한 줄로 박는다(`_type=json`이 통하지 않는 첫 사례).
- [ ] **Step 2: `PROGRESS.md`** — 마일스톤 절 + 실호출 게이트 결과.
- [ ] **Step 3: `docs/BACKLOG.md`** — E5 종결 표로 이동, 분기역 방면 확정을 새 항목으로, F-a에 실승차 판정 4건 추가.
- [ ] **Step 4: `AGENTS.md` 재생성** — `python sync_agent_docs.py`
- [ ] **Step 5: push + 실기기 배포** — `CONFIGURATION=Experimental ./ios/deploy-device.sh`

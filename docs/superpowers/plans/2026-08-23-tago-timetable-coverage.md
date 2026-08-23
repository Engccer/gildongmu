# A19 TAGO 시간표 커버리지 3-state 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스케줄 0행인 (역·노선)을 `lines[]`에 남기고 `coverage`로 가르며, 소비자 4곳(웹·CLI·채팅·iOS)이 "확인 불가"를 운행 종료·0건과 다르게 낭독하게 한다.

**Architecture:** provider가 방향 4분류(`classifyDirection`) → 노선 결합(`combineLineCoverage`)으로 `TimetableLine.coverage`를 싣는다. `subway-nearby`의 심야 단정은 allowlist 게이트로 fail-closed. 소비자는 `coverage !== "ok"`면 노선당 한 줄 문구(`timetable.coverage.*`). `deriveFirstLast` 시그니처는 소유 밖 소비자(`subway-service-hours.ts`) 때문에 불변.

**Tech Stack:** TS/Next 16, Vitest(jsdom 레인), citty CLI, SwiftUI/Kit(Swift Testing), esbuild 번들 실호출 게이트.

**Spec:** `docs/superpowers/specs/2026-08-23-tago-timetable-coverage-design.md`

**구현 방식 판정:** inline. 타입 → provider → 소비자 4곳이 한 계약을 순차로 따르고 수정 파일이 겹친다(`types.ts`를 모든 태스크가 본다). 리뷰만 서브에이전트 분리.

## Global Constraints

- 소유 파일(계획 §2 A19)만 수정. `subway-service-hours.ts`·`deriveFirstLast` 시그니처 불변.
- `messages/*.json`은 `timetable.*`만, 6로케일 동시. `timetable.empty` 삭제.
- iOS 새 필드는 옵셔널(`coverage: String?`).
- `git add -A` 금지, pathspec 커밋.
- 외부 API 변경은 실호출 게이트(`scripts/verify-korea-subway-timetable.mjs`) 1회 실행이 머지 게이트.

---

### Task 1: 타입 + provider 분류·결합 (TDD)

**Files:**
- Modify: `src/lib/types.ts` (`TimetableLine`)
- Modify: `src/lib/providers/tago-subway.ts`
- Test: `src/lib/providers/__tests__/tago-subway.test.ts`

**Produces:** `type TimetableLineCoverage = "ok"|"noTrains"|"unknown"|"unavailable"`, `TimetableLine.coverage` 필수, `classifyDirection(rows, stationId): { outcome: TimetableLineCoverage; fl: FirstLast | null }`, `combineLineCoverage(outcomes)`.

- [ ] **Step 1: 실패 테스트** — `tago-subway.test.ts`에 추가:

```ts
describe("classifyDirection / combineLineCoverage (스펙 §2)", () => {
  it("원시 0행 → unknown", () => expect(classifyDirection([], SELF).outcome).toBe("unknown"));
  it("파싱 불가 행만 → unknown(참인 0과 뭉개지 않는다)", () =>
    expect(classifyDirection([row("abc")], SELF).outcome).toBe("unknown"));
  it("전부 당역 종착 → noTrains", () =>
    expect(classifyDirection([row("000210", SELF, "강동")], SELF).outcome).toBe("noTrains"));
  it("편성 ≥1 → ok + fl", () => {
    const r = classifyDirection([row("051310")], SELF);
    expect(r.outcome).toBe("ok"); expect(r.fl?.first.time).toBe("05:13");
  });
  it("결합 순서: ok > unavailable > unknown > noTrains", () => {
    expect(combineLineCoverage(["noTrains", "ok"])).toBe("ok");
    expect(combineLineCoverage(["unknown", "unavailable"])).toBe("unavailable");
    expect(combineLineCoverage(["noTrains", "unknown"])).toBe("unknown");
    expect(combineLineCoverage(["noTrains", "noTrains"])).toBe("noTrains");
  });
});
```
시나리오 D를 셋으로 분할(전부 당역 종착 → `lines:[{coverage:"noTrains",directions:[]}]`, 0행 → `unknown`, 2노선 중 하나 0행 → 둘 다 실리고 partial 없음), 비대칭(상행 실패·하행 0행 → `unavailable`+`partial`). 시나리오 A·B에 `coverage:"ok"` 단언 추가.

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run src/lib/providers/__tests__/tago-subway.test.ts`
- [ ] **Step 3: 구현** — `types.ts`에 타입·필드, provider에 `classifyDirection`(parsable 카운트, `deriveFirstLast`는 이를 감싸 `fl`만 반환), `combineLineCoverage`, `fetchStationTimetable`의 노선 루프를 `matched.map`으로 바꿔 전 노선 실림.
- [ ] **Step 4: 통과 확인** 후 커밋 `feat(timetable): (역·노선) 0행을 coverage로 보존 — classifyDirection·combineLineCoverage`

### Task 2: subway-nearby allowlist 게이트

**Files:** `src/lib/providers/subway-nearby.ts`, `src/lib/__tests__/subway-nearby.test.ts`

- [ ] **Step 1: 실패 테스트**

```ts
it("unknown 노선이 섞이면 판정 불가(거짓 '운행 종료' 금지)", () =>
  expect(judgeStationService(tt([line5(outsideWindow), { lineName: "2호선", coverage: "unknown", directions: [] }]), 180).closed).toBe(false));
it("noTrains 노선은 판정에 참여한다(참인 0)", () =>
  expect(judgeStationService(tt([line5(outsideWindow), { lineName: "2호선", coverage: "noTrains", directions: [] }]), 180).closed).toBe(true));
it("존재하지 않는 coverage 값 → 판정 불가(fail-closed)", () =>
  expect(judgeStationService(tt([{ ...line5(outsideWindow), coverage: "bogus" as never }]), 180).closed).toBe(false));
```
기존 fixture에 `coverage:"ok"` 추가.

- [ ] **Step 2: 실패 확인** → **Step 3: 구현** — `judgeStationService` 머리에 `if (timetable.lines.some(l => l.coverage !== "ok" && l.coverage !== "noTrains")) return { closed: false };` + 주석(대가 명시).
- [ ] **Step 4: 통과·커밋** `fix(subway-nearby): 심야 단정은 coverage ok·noTrains만 참여(allowlist, fail-closed)`

### Task 3: i18n + 웹 컴포넌트

**Files:** `messages/{ko,en,es,fr,it,ja}.json` `timetable`, `src/components/StationTimetable.tsx`, Create `src/components/__tests__/StationTimetable.test.tsx`

- [ ] **Step 1: 6로케일** `timetable.empty` 삭제, `timetable.coverage.{unknown,unavailable,noTrains}` 추가(`{line}`). ko: §3 표. en: "{line}: today's timetable couldn't be confirmed." / "{line}: timetable couldn't be loaded." / "{line}: no boardable trains today." 나머지 로케일 동형 번역.
- [ ] **Step 2: 실패 테스트**(jsdom 프라그마, fetch 스텁): coverage unknown 노선은 `"2호선 오늘 시간표를 확인할 수 없습니다"` 한 `<p>`, ok 노선은 방향 행.
- [ ] **Step 3: 구현** — `lines.length === 0` 분기 삭제, map 안에서 `line.coverage === "ok" ? 방향 행 : <p>{t(`coverage.${line.coverage}`, { line: line.lineName })}</p>`.
- [ ] **Step 4: `npx vitest run src/components/__tests__/StationTimetable.test.tsx src/lib/__tests__/i18n-messages.test.ts`** 통과·커밋.

### Task 4: CLI 포매터 + 채팅 선언

**Files:** `packages/cli/src/lib/formatters.ts`(시간표 포매터만), `packages/cli/src/__tests__/formatters.test.ts`, `src/lib/chat/declarations.ts`(항목만), `src/lib/chat/router.ts`(주석), `src/lib/chat/__tests__/station-timetable-tool.test.ts`

- [ ] CLI 테스트: coverage 3값 각각 한 줄(ko 사본), `empty` 케이스 → noTrains로 교체. 구현 `COVERAGE_KO` 상수 + 분기. `cd packages/cli && npx vitest run`.
- [ ] 채팅: 선언 description에 "lines[].coverage — ok: 첫차·막차 있음 / unknown: 그 노선의 오늘 시간표를 확인할 수 없음(운행이 없다는 뜻이 아니다) / unavailable: 조회 실패 / noTrains: 오늘 탑승 가능한 편성 없음. 어떤 값이든 노선을 생략하지 말고 이름과 함께 말하라." 테스트 fixture에 coverage.
- [ ] 커밋 `feat(cli,chat): 시간표 coverage 낭독·선언`

### Task 5: iOS Kit 모델 + StationSections

**Files:** `ios/GildongmuKit/Sources/GildongmuKit/Models/StationModels.swift`, `ios/GildongmuKit/Tests/GildongmuKitTests/StationModelsTests.swift`, `ios/Gildongmu/StationSections.swift`, 생성물 xcstrings(`node ios/scripts/messages-to-xcstrings.mjs`)

- [ ] Kit 테스트: `coverage` 있는 JSON·없는 JSON 둘 다 디코딩(`coverage == "unknown"` / `nil`). `stationTimetableEmptyLinesAndNullEnvelopeDecode`의 빈 lines 케이스는 유지(디코딩 계약).
- [ ] 모델 `public let coverage: String?`.
- [ ] 뷰: `isEmpty` 분기 삭제; `ForEach(lines)`에서 `line.coverage == "ok" || (line.coverage == nil && !line.directions.isEmpty)`면 방향 행, 아니면 `Text(appLocalized("timetable.coverage.\(line.coverage ?? "unknown")", line.lineName))`.
- [ ] xcstrings 재생성 + `node ios/scripts/check-xcstrings-keys.mjs`, `swift test --package-path ios/GildongmuKit --filter StationModels`, 시뮬레이터 빌드로 라벨 확인(xcodebuildmcp).
- [ ] 커밋 `feat(ios): 시간표 coverage 옵셔널 디코딩·노선별 확인 불가 문구`

### Task 6: 실호출 게이트 `scripts/verify-korea-subway-timetable.mjs`

- [ ] dodo판 복제, 경로 `src/lib/providers/tago-subway`·`src/lib/station-match`, `MAX_LINES` export. 불변식 3종 단언 + 홍대입구·강남·서울역 관측 로그.
- [ ] `node scripts/verify-korea-subway-timetable.mjs` 실행 → 결과를 spec §6에 기록. 커밋.

### Task 7: 리뷰 → 통합 → 문서 분배

- [ ] 서브에이전트 리뷰(spec-compliance + code-quality, HEAD SHA 명시) → 반영.
- [ ] `git fetch && git rebase origin/main` → xcstrings 재생성 → `npm run test:run && npx tsc --noEmit && npm run lint` → 코디네이터 보고 → `git push origin feat/a19:main`.
- [ ] 문서: CHANGELOG 항목, BACKLOG A19 종결(게이트 경로 참조 수정), CLAUDE.md 통합 카탈로그 "역 첫차·막차" 행에 coverage 함정 한 줄, PROGRESS 상태 한 줄. `comm -23` 소실 대조.

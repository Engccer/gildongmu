# A31 간략 세션 도착 종료 + 종료 잔재 정리 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 간략 안내 세션이 목적지 근처에서 멈추면 도착 추정으로 스스로 끝나고, 30분 넘은 종료 화면은 복귀 시 걷어내며, 종료 문장이 길찾기 화면에 남지 않게 한다.

**Architecture:** 판정은 Kit 순수 함수(웹 미러·공유 fixture)에 두고 `BeaconModel`은 배선만 한다. 축 ①은 `presumedArrivalStep`의 국면 게이트를 "도착 창"(최종 접근 ∨ 간략 근처 창)으로 넓히되 간략 창 자격은 새 리듀서 `briefArrivalWindowStep`(래치 ∧ 정확도 ≤ 30m)이 정한다. 축 ②는 `ContinuousClock` 종료 시각 + `isEndScreenStale`, 축 ③은 `clearArrival`의 판별선 교체.

**Tech Stack:** Swift 6(GildongmuKit SPM + 앱 타깃, Swift Testing), TypeScript(Vitest), 공유 JSON fixture.

**Spec:** `docs/superpowers/specs/2026-09-02-brief-session-arrival-end-design.md`

**구현 방식 판정(AUTONOMY §구현 방식 판정):** inline. 세 축이 모두 `BeaconModel.swift` 한 파일을 고치고(파일 겹침), 앱 배선(Task 4~6)이 Kit 함수(Task 1~2)의 시그니처에 의존한다(선행 관계). 리뷰만 별도 컨텍스트(서브에이전트)로 분리한다.

## Global Constraints

- 판정 함수는 웹·Kit 미러 + 공유 fixture(`src/lib/__tests__/fixtures/`)로 동조를 강제한다. `presumedArrivalStep`은 바이트 동일.
- `BeaconModel`은 프로파일 리터럴(`.walk`/`.car`)을 판정 함수에 직접 넘기지 않고 `tuning.presumedArrival`을 읽는다(`beacon-tuning-wiring.test.ts`).
- 간략 창 정확도 상한 `briefArrivalWindowMaxAccuracyMeters = 30` = `carArrivalMaxAccuracyMeters`(테스트가 동일 단언).
- 종료 화면 소거 기준 `endScreenStaleSeconds = 1800`, 시계는 `ContinuousClock`.
- 자동 종료 경로는 셋뿐(확정 도착·추정 도착·안전망) — 새 `stop()` 호출 경로를 만들지 않는다.
- 커밋은 `git add <파일> && git commit -- <파일>`로 의도 파일만. 커밋 이메일 `engccer@gmail.com`.
- 문서 언어 한국어, 산문 산출물에 em dash 금지(에이전트 문서·코드 주석은 제외).

---

### Task 1: Kit·웹 `briefArrivalWindowStep` + 공유 fixture

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/FinalApproach.swift`(도착 추정 절 뒤에 추가, `presumedArrivalStep` doc 주석 갱신)
- Modify: `src/lib/final-approach.ts`(같은 자리 미러)
- Create: `src/lib/__tests__/fixtures/brief-arrival-window-cases.json`
- Modify: `ios/GildongmuKit/Tests/GildongmuKitTests/FinalApproachTests.swift`
- Modify: `src/lib/__tests__/final-approach.test.ts`

**Interfaces:**
- Produces (Kit): `public let briefArrivalWindowMaxAccuracyMeters = 30.0`, `public struct BriefArrivalWindowStep: Sendable, Equatable { let active: Bool; let entered: Bool; let exited: Bool }`, `public func briefArrivalWindowStep(active: Bool, nearby: Bool, accuracy: Double) -> BriefArrivalWindowStep`
- Produces (웹): `BRIEF_ARRIVAL_WINDOW_MAX_ACC_M = 30`, `briefArrivalWindowStep(input: { active, nearby, accuracy }): { active, entered, exited }`

- [ ] **Step 1: fixture 작성**

```json
{
  "comment": "briefArrivalWindowStep 웹·Kit 동조 fixture (spec 2026-09-02 §2.2). 간략 창 자격 = nearby 래치 ∧ 정확도 ≤ 30m. entered/exited는 복합 술어의 전이. 무효 정확도(≤0·NaN)는 자격 없음이지 '유지'가 아니다 — usable 게이트는 호출자(BeaconModel)가 앞서 거른다.",
  "cases": [
    { "name": "래치 켜짐·정확도 6.6 → 진입", "input": { "active": false, "nearby": true, "accuracy": 6.6 }, "expect": { "active": true, "entered": true, "exited": false } },
    { "name": "진입 뒤 같은 조건 → 유지(전이 없음)", "input": { "active": true, "nearby": true, "accuracy": 6.6 }, "expect": { "active": true, "entered": false, "exited": false } },
    { "name": "정확도 30 경계는 자격 안", "input": { "active": false, "nearby": true, "accuracy": 30 }, "expect": { "active": true, "entered": true, "exited": false } },
    { "name": "정확도 30.1은 자격 밖 → 진입 안 함", "input": { "active": false, "nearby": true, "accuracy": 30.1 }, "expect": { "active": false, "entered": false, "exited": false } },
    { "name": "유지 중 정확도 열화(30.1) → 이탈", "input": { "active": true, "nearby": true, "accuracy": 30.1 }, "expect": { "active": false, "entered": false, "exited": true } },
    { "name": "유지 중 래치 해제 → 이탈", "input": { "active": true, "nearby": false, "accuracy": 6.6 }, "expect": { "active": false, "entered": false, "exited": true } },
    { "name": "래치 꺼짐·창 밖 → 그대로", "input": { "active": false, "nearby": false, "accuracy": 6.6 }, "expect": { "active": false, "entered": false, "exited": false } },
    { "name": "BLOCKER 모양: 정확도 100·래치 켜짐 → 진입 안 함", "input": { "active": false, "nearby": true, "accuracy": 100 }, "expect": { "active": false, "entered": false, "exited": false } },
    { "name": "정확도 0(무효)은 자격 없음", "input": { "active": true, "nearby": true, "accuracy": 0 }, "expect": { "active": false, "entered": false, "exited": true } }
  ]
}
```

- [ ] **Step 2: 웹 실패 테스트** — `final-approach.test.ts`에 추가

```ts
import windowFixture from "./fixtures/brief-arrival-window-cases.json";
import { BRIEF_ARRIVAL_WINDOW_MAX_ACC_M, briefArrivalWindowStep } from "../final-approach";
import { CAR_ARRIVAL_MAX_ACC_M } from "../car-arrival";

describe("briefArrivalWindowStep (공유 fixture, spec 2026-09-02 §2.2)", () => {
  for (const c of windowFixture.cases) {
    it(c.name, () => {
      expect(briefArrivalWindowStep(c.input)).toEqual(c.expect);
    });
  }
  it("정확도 상한은 자동차 도착 정확도 상한과 같은 뜻의 같은 값이다", () => {
    expect(BRIEF_ARRIVAL_WINDOW_MAX_ACC_M).toBe(CAR_ARRIVAL_MAX_ACC_M);
  });
  it("NaN 정확도는 자격 없음", () => {
    expect(briefArrivalWindowStep({ active: true, nearby: true, accuracy: NaN })).toEqual({ active: false, entered: false, exited: true });
  });
});
```

(`car-arrival.ts`의 정확도 상수 export 이름을 먼저 확인해 맞춘다 — 없으면 `export const CAR_ARRIVAL_MAX_ACC_M`으로 노출.)

- [ ] **Step 3: 실패 확인** `npm run test:run -- src/lib/__tests__/final-approach.test.ts` → import 실패.

- [ ] **Step 4: 웹 구현** — `final-approach.ts` 도착 추정 절 끝에

```ts
// ── 간략 창 자격(spec 2026-09-02 §2.1·§2.2) ──
/** 간략 창 정확도 상한(m). `carArrivalMaxAccuracyMeters`와 같은 뜻("도착을 선언할 만큼 믿을 수 있는 정확도")의 같은 값 — 테스트가 동일을 단언. */
export const BRIEF_ARRIVAL_WINDOW_MAX_ACC_M = 30;
export interface BriefArrivalWindowInput { active: boolean; nearby: boolean; accuracy: number }
export interface BriefArrivalWindowStep { active: boolean; entered: boolean; exited: boolean }
/** 복합 술어(래치 ∧ 정확도 ≤ 30)의 이전·이후 값으로 진입·이탈을 정한다. 무효 정확도는 자격 없음. */
export function briefArrivalWindowStep(input: BriefArrivalWindowInput): BriefArrivalWindowStep {
  const qualifies = input.nearby && input.accuracy > 0 && input.accuracy <= BRIEF_ARRIVAL_WINDOW_MAX_ACC_M;
  return { active: qualifies, entered: qualifies && !input.active, exited: !qualifies && input.active };
}
```

`presumedArrivalStep`의 `inFinalApproach` doc 주석에 "도착 창(최종 접근 국면 ∨ 간략 근처 창) 안인가 — 이름은 도착 추정 도입 시점의 것" 한 줄.

- [ ] **Step 5: 통과 확인** 같은 명령 → PASS.

- [ ] **Step 6: Kit 구현** — `FinalApproach.swift` 끝에

```swift
// ── 간략 창 자격(spec 2026-09-02 §2.1·§2.2) — 웹 `briefArrivalWindowStep` 미러 ──

/// 간략 창 정확도 상한(m). `carArrivalMaxAccuracyMeters`와 같은 뜻의 같은 값(테스트가 동일 단언).
/// 래치는 정확도로 스케일돼 100m fix에서 200m까지 유지되므로 그대로는 종료 권한이 될 수 없다.
public let briefArrivalWindowMaxAccuracyMeters = 30.0

public struct BriefArrivalWindowStep: Sendable, Equatable {
    public let active: Bool
    public let entered: Bool
    public let exited: Bool
    public init(active: Bool, entered: Bool, exited: Bool) { … }
}

/// 복합 술어(래치 ∧ 정확도 ≤ 30)의 이전·이후 값으로 진입·이탈을 정한다. 무효 정확도(≤0·NaN)는 자격 없음.
public func briefArrivalWindowStep(active: Bool, nearby: Bool, accuracy: Double) -> BriefArrivalWindowStep {
    let qualifies = nearby && accuracy > 0 && accuracy <= briefArrivalWindowMaxAccuracyMeters
    return BriefArrivalWindowStep(active: qualifies, entered: qualifies && !active, exited: !qualifies && active)
}
```

- [ ] **Step 7: Kit 테스트** — `FinalApproachTests.swift`에 fixture 디코딩(`BriefWindowFixtureFile { cases: [{name, input{active,nearby,accuracy}, expect{active,entered,exited}}] }`) + `@Test("간략 창 공유 fixture 동조")` 루프 + `@Test("정확도 상한 = carArrivalMaxAccuracyMeters")` + NaN 케이스.

- [ ] **Step 8: Kit 테스트 실행** `cd ios/GildongmuKit && swift test --filter FinalApproachTests` → PASS.

- [ ] **Step 9: 커밋** `feat(kit,web): 간략 창 자격 리듀서 briefArrivalWindowStep + 공유 fixture (A31 §2.2)`

### Task 2: Kit·웹 `isEndScreenStale` + fixture

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/EndScreen.swift`, `ios/GildongmuKit/Tests/GildongmuKitTests/EndScreenTests.swift`
- Create: `src/lib/end-screen.ts`, `src/lib/__tests__/end-screen.test.ts`, `src/lib/__tests__/fixtures/end-screen-stale-cases.json`

**Interfaces:**
- Kit: `public let endScreenStaleSeconds = 1800.0`, `public func isEndScreenStale(secondsSinceEnd: Double) -> Bool`
- 웹: `END_SCREEN_STALE_S = 1800`, `isEndScreenStale(secondsSinceEnd: number): boolean`

- [ ] **Step 1: fixture**

```json
{
  "comment": "isEndScreenStale 웹·Kit 동조 fixture (spec 2026-09-02 §3). 종료 뒤 경과(초, 단조 시계). 무효 입력은 소거하지 않는다 — 종료 화면은 걸음 요약의 유일한 채널이라 근거 없는 소거 금지.",
  "cases": [
    { "name": "1799.9는 유지", "secondsSinceEnd": 1799.9, "expect": false },
    { "name": "1800 경계는 소거", "secondsSinceEnd": 1800, "expect": true },
    { "name": "8시간(09-01 실사고)은 소거", "secondsSinceEnd": 28800, "expect": true },
    { "name": "0은 유지", "secondsSinceEnd": 0, "expect": false },
    { "name": "음수(시계 역행)는 유지", "secondsSinceEnd": -5, "expect": false }
  ]
}
```

- [ ] **Step 2: 웹 테스트·구현** (fixture 루프 + NaN·Infinity → false), 구현 `Number.isFinite(s) && s >= END_SCREEN_STALE_S`. `npm run test:run -- src/lib/__tests__/end-screen.test.ts` PASS.
- [ ] **Step 3: Kit 구현·테스트** (`EndScreen.swift` 미러, `EndScreenTests.swift` fixture 루프 + `.nan`/`.infinity` false). `swift test --filter EndScreenTests` PASS.
- [ ] **Step 4: 커밋** `feat(kit,web): 종료 화면 소거 판정 isEndScreenStale + 공유 fixture (A31 §3)`

### Task 3: 09-01 리플레이 fixture + 간략 창 시나리오

**Files:**
- Create: `src/lib/__tests__/fixtures/guide-diag-2026-09-01-brief-window.json`(스크립트로 생성, 좌표 경도 평행이동)
- Create: `src/lib/__tests__/brief-window-replay.test.ts`
- Modify: `src/lib/__tests__/fixtures/presumed-arrival-scenarios.json`(간략 창 라벨 시나리오 3건 append)
- Modify: `docs/superpowers/specs/logs/README.md`(fixture 색인 한 줄)

- [ ] **Step 1: fixture 생성 스크립트(1회, 저장소 밖 로그 읽음)** — scratchpad에 python:

```python
import gzip, json, re
src = "/Users/hunyongkim/gildongmu-private/field-logs/guide-diag-2026-09-01.log.gz"
rows = []
start = "2026-08-31T23:45:15Z"; end = "2026-09-01T00:05:22Z"
pat = re.compile(r"\[(\S+)\] brief t=([\d.]+) lat=([\d.]+) lng=([\d.]+) acc=([\d.\-]+) motion=(\w+) age=([\d.]+) usable=(\w+) dist=([\d.]+) nearby=(\w+)")
handoff_t = None
for line in gzip.open(src, "rt"):
    if "briefHandoff reason=tooClose" in line and start[:19] in line: pass
    m = pat.search(line)
    if not m: continue
    ts = m.group(1)
    if ts < start or ts > end: continue
    rows.append({"t": float(m.group(2)), "lat": round(float(m.group(3)), 6), "lng": round(float(m.group(4)) - 0.05, 6),
                 "acc": float(m.group(5)), "usable": m.group(8) == "true", "dist": float(m.group(9)), "nearby": m.group(10) == "true"})
assert len(rows) > 300, len(rows)
json.dump({"note": "2026-09-01 KST 08:45 등굣길 tooClose 인계 이후 brief 행(t·acc·usable·dist·nearby + 경도 -0.05° 평행이동 좌표). 원본 로그는 repo 밖. 인계 t=216463.4, 안전망 종료 t≈217670.", "handoffT": 216463.4, "idleEndT": rows[-1]["t"], "fixes": rows},
          open("src/lib/__tests__/fixtures/guide-diag-2026-09-01-brief-window.json", "w"), ensure_ascii=False, separators=(",", ":"))
```

인계·안전망 t 값은 로그의 `briefHandoff`·`sessionIdleEnd` 직전 fix `t`로 대조해 넣는다(`zcat … | grep -n "briefHandoff\|sessionIdleEnd"`). 생성 뒤 `git check-ignore`로 fixture가 무시되지 않는지 확인(`.gitignore`가 `*.log*`만 막는다).

- [ ] **Step 2: 리플레이 테스트**

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/guide-diag-2026-09-01-brief-window.json";
import { PRESUMED_ARRIVAL_WALK, advanceProgressAnchor, briefArrivalWindowStep, presumedArrivalStep } from "../final-approach";

/** 2026-09-01 등굣길: 08:45:15 tooClose 인계 → dist 24.3 고정 → 09:05:22 안전망 종료. 이 설계(간략 창)로는 인계 뒤 5분 안에 stationary가 나야 한다. */
describe("간략 창 리플레이 (2026-09-01 등굣길)", () => {
  function replay() {
    let active = false, enteredAt: number | null = null, anchor = null as { lat: number; lng: number } | null;
    let lastProgressAt: number | null = null, lastFixAt: number | null = null, lastDist: number | null = null;
    let firedAt: number | null = null, reason: string | null = null;
    for (const f of fixture.fixes) {
      if (!f.usable) continue;
      lastFixAt = f.t;
      const step = briefArrivalWindowStep({ active, nearby: f.nearby, accuracy: f.acc });
      if (step.entered) { enteredAt = f.t; anchor = null; lastProgressAt = null; lastDist = f.dist; }
      if (step.exited) { enteredAt = null; anchor = null; lastProgressAt = null; lastDist = null; }
      active = step.active;
      if (!active) continue;
      lastDist = f.dist;
      const a = advanceProgressAnchor(anchor, { lat: f.lat, lng: f.lng });
      anchor = a.anchor; if (a.progressed) lastProgressAt = f.t;
      const r = presumedArrivalStep({
        inFinalApproach: true,
        secondsSinceUsableFix: f.t - Math.max(enteredAt!, lastFixAt),
        secondsSinceProgress: f.t - Math.max(enteredAt!, lastProgressAt ?? enteredAt!),
        lastKnownDistanceToDestMeters: lastDist,
      }, PRESUMED_ARRIVAL_WALK);
      if (r) { firedAt = f.t; reason = r; break; }
    }
    return { firedAt, reason };
  }
  it("인계 뒤 5분 안에 stationary로 끝난다", () => {
    const { firedAt, reason } = replay();
    expect(reason).toBe("stationary");
    expect(firedAt! - fixture.handoffT).toBeGreaterThanOrEqual(PRESUMED_ARRIVAL_WALK.stationarySeconds);
    expect(firedAt! - fixture.handoffT).toBeLessThan(PRESUMED_ARRIVAL_WALK.stationarySeconds + 60);
  });
  it("실제 안전망 종료(20분)보다 앞이다", () => {
    expect(replay().firedAt!).toBeLessThan(fixture.idleEndT - 600);
  });
  it("정확도 상한 30을 넘는 fix는 전 구간 자격 밖이다 — 이 세션엔 하나도 없다(전부 ≤ 17.3)", () => {
    expect(fixture.fixes.filter((f) => f.usable && f.acc > 30)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: presumed fixture 시나리오 3건 append**(`stepScenarios` 끝): "간략 근처 창: 09-01 등굣길 모양 stationary 300s·24.3m" → `stationary`; "간략 근처 창 밖(래치 해제)은 none" → `inFinalApproach: false`; "간략 근처 창 진입 직후(0·0)는 none".
- [ ] **Step 4: 실행** `npm run test:run -- src/lib/__tests__/brief-window-replay.test.ts src/lib/__tests__/final-approach.test.ts` PASS, `swift test --filter FinalApproachTests` PASS(fixture 추가분).
- [ ] **Step 5: README 색인 한 줄 + 커밋** `test: 2026-09-01 간략 창 리플레이 게이트 + 도착 추정 fixture 간략 창 시나리오 (A31 §2.5)`

### Task 4: `BeaconModel` 축 ① 배선 + 소스 가드

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`(상태 선언 ~380, 간략 fix 처리 ~1618-1700, `resetFinalApproach` ~1864, `beginFinalApproach` 인계 분기 ~1906, `fallbackToBrief` ~1076, `handleScenePhaseChange` 래치 초기화 ~1496, `maybePresumeArrival` ~2119, `handleFinalApproach` 진입 초기화 ~1917, 로그)
- Modify: `src/lib/__tests__/beacon-tuning-wiring.test.ts`

- [ ] **Step 1: 소스 가드 먼저(실패 확인)** — `beacon-tuning-wiring.test.ts`에 추가:

```ts
describe("도착 창(A31 §2): 간략 창 배선", () => {
  const presume = src.slice(src.indexOf("func maybePresumeArrival"), src.indexOf("func loadArrivalHealth"));
  it("추정 도착 가드는 inArrivalWindow를 읽고 inFinalApproach 단독으로 되돌아가지 않는다", () => {
    expect(presume).toMatch(/guard isTracking, inArrivalWindow/);
    expect(presume).not.toMatch(/guard isTracking, inFinalApproach/);
  });
  it("maybePresumeArrival 호출은 세 자리(최종 접근·간략·워치독)", () => {
    expect(src.match(/maybePresumeArrival\(now: now\)/g)?.length).toBe(3);
  });
  it("간략 fix 처리는 창 자격을 Kit 리듀서로 정한다(nearby 직접 판정 금지)", () => {
    expect(src.includes("briefArrivalWindowStep(")).toBe(true);
  });
  it("resetFinalApproach가 간략 창 플래그를 지운다", () => {
    const reset = src.slice(src.indexOf("func resetFinalApproach"), src.indexOf("func beginFinalApproach"));
    expect(reset).toMatch(/briefWindowActive = false/);
  });
});
```

실행 → 실패.

- [ ] **Step 2: 상태·계산 속성** — `finalApproachEnteredAt` → `arrivalWindowEnteredAt`(전 참조 rename), `private var briefWindowActive = false`, `private var inArrivalWindow: Bool { inFinalApproach || briefWindowActive }`, `private func resetArrivalWindow()`(네 값 nil + 플래그 false, `resetFinalApproach`가 호출).

- [ ] **Step 3: 간략 fix 처리** — `beaconState = stepped.state` 직후:

```swift
// 도착 창(간략, spec 2026-09-02 §2.2): 자격은 Kit 리듀서(래치 ∧ 정확도 ≤ 30m). 무시가 아니라 '창 밖'이라 이탈이 상태를 지운다.
let window = briefArrivalWindowStep(active: briefWindowActive, nearby: stepped.state.nearby, accuracy: fix.accuracy)
let distance = stepped.announce.distance
if window.entered {
    arrivalWindowEnteredAt = now; progressAnchor = nil; lastProgressAt = nil
    lastUsableDistanceToDest = distance
    guideDiagLog("arrivalWindowEnter mode=brief dist=\(fmt distance) acc=\(fmt fix.accuracy)")
} else if window.exited {
    guideDiagLog("arrivalWindowExit reason=\(stepped.state.nearby ? "accuracy" : "released")")
    resetArrivalWindow()   // 플래그는 아래에서 대입
}
briefWindowActive = window.active
if window.active {
    lastUsableDistanceToDest = distance
    let a = advanceProgressAnchor(anchor: progressAnchor, fix: RoutePoint(lat: fix.lat, lng: fix.lng))
    progressAnchor = a.anchor
    if a.progressed { lastProgressAt = now }
}
```

그리고 함수 말미(통지 처리 뒤) `if maybePresumeArrival(now: now) { return }`. ⚠ `resetArrivalWindow()`가 플래그를 false로 두고 그 뒤 `briefWindowActive = window.active`가 덮는 순서를 지킨다.

- [ ] **Step 4: 명시 리셋 호출** — `fallbackToBrief` 첫 줄, `beginFinalApproach`의 간략 인계 분기(`mode = .brief` 앞), `handleScenePhaseChange`의 `beaconState = .initial` 옆에 `resetArrivalWindow()`.

- [ ] **Step 5: `maybePresumeArrival`** — `guard isTracking, inArrivalWindow, let thresholds = tuning.presumedArrival, let dest, let enteredAt = arrivalWindowEnteredAt`; 로그에 `window=\(inFinalApproach ? "final" : "brief")` 추가. `handleFinalApproach`·워치독 호출은 불변.

- [ ] **Step 6: 빌드** `cd ios && xcodebuild -scheme Gildongmu -configuration Experimental -destination 'generic/platform=iOS' build CODE_SIGNING_ALLOWED=NO -quiet`(또는 `xcodebuildmcp` build) → 성공. 소스 가드 실행 → PASS.
- [ ] **Step 7: 커밋** `feat(ios): 간략 세션 도착 창 — 근처 래치 ∧ 정확도 ≤30m에서 도착 추정 작동 (A31 축 ①)`

### Task 5: `BeaconModel` 축 ② + 앱 루트 순서 + 가드

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`(`arrivalDest` didSet ~416, `handleScenePhaseChange` ~1446)
- Modify: `ios/Gildongmu/GildongmuApp.swift`(~184-207)
- Modify: `src/lib/__tests__/beacon-tuning-wiring.test.ts`

- [ ] **Step 1: 가드 추가(실패 확인)**

```ts
describe("종료 화면 수명(A31 §3)", () => {
  const scene = src.slice(src.indexOf("func handleScenePhaseChange"), src.indexOf("// MARK: - 톤 계층 배선"));
  it("복귀 판정은 백그라운드 경유 플래그를 맨 앞에서 소비한다", () => {
    expect(scene).toMatch(/let returnedFromBackground = wasBackgrounded\s*\n\s*wasBackgrounded = false/);
    expect(scene).toMatch(/isEndScreenStale\(/);
  });
  it("종료 시각은 단조 시계(ContinuousClock)", () => {
    expect(src).toMatch(/endedAt: ContinuousClock\.Instant\?/);
  });
  it("앱 루트는 유휴 리셋보다 먼저 세션에 전경 전환을 전달한다", () => {
    const app = readFileSync(new URL("../../../ios/Gildongmu/GildongmuApp.swift", import.meta.url), "utf8");
    expect(app.indexOf("guideSession.handleScenePhaseChange(to: phase)")).toBeLessThan(app.indexOf("IdleReset.shouldReset("));
  });
});
```

- [ ] **Step 2: 모델** — `arrivalDest` didSet: `endedAt = arrivalDest == nil ? nil : (oldValue == nil ? .now : endedAt)`; `private var endedAt: ContinuousClock.Instant?`. `.active` 분기 맨 앞:

```swift
let returnedFromBackground = wasBackgrounded
wasBackgrounded = false
if returnedFromBackground, !isTracking, arrivalDest != nil, let endedAt {
    let age = endedAt.duration(to: .now)
    let seconds = Double(age.components.seconds) + Double(age.components.attoseconds) / 1e18
    if isEndScreenStale(secondsSinceEnd: seconds) {
        guideDiagLog("endScreenExpired age=\(Int(seconds))")
        pendingFinalApproachIntro = nil
        pendingStepFreeNotice = nil
        clearArrival()   // 종료 문장은 지워지고 실패 문장(축 ③)만 남아 아래 상환이 그것만 읽는다
    }
}
```

기존 `guard wasBackgrounded else { return }; wasBackgrounded = false`는 `guard returnedFromBackground else { return }`로.

- [ ] **Step 3: 앱 루트** — `.onChange(of: scenePhase)` 본문 첫 줄로 `guideSession.handleScenePhaseChange(to: phase)` 이동(switch 앞), 끝의 호출 삭제. 주석: 유휴 리셋의 TabView 재생성보다 먼저 오래된 종료 화면을 걷어야 옛 시트가 한 프레임 떴다 닫히지 않는다.
- [ ] **Step 4: 빌드 + 가드 PASS + 커밋** `feat(ios): 30분 지난 종료 화면은 백그라운드 복귀 시 소거 (A31 축 ②)`

### Task 6: `clearArrival` 판별선 + 가드

- [ ] **Step 1: 가드(실패 확인)** — `clearArrival` 본문: `status.isFailure` 포함, `endKind != .stopped`·`status == .idle` 불포함.
- [ ] **Step 2: 구현** — `Status`에 `var isFailure: Bool { self == .denied || self == .unavailable }`; `clearArrival`: `liveTopText = nil; if !status.isFailure { statusText = "" }`(주석 갱신: 판별선은 실패 상태 잔존).
- [ ] **Step 3: 빌드 + 가드 PASS + 커밋** `fix(ios): 종료 화면 닫기 뒤 상태 문장은 실패 상태가 남았을 때만 유지 (A31 축 ③)`

### Task 7: 전체 검증·리뷰·문서·배포

- [ ] **Step 1:** `npm run test:run`(전체) + `cd ios/GildongmuKit && swift test` + 앱 Experimental·Release 빌드.
- [ ] **Step 2: 변이 주입 4종**(spec §6 ⓐ~ⓓ)을 임시로 넣고 소스 가드가 실패하는지 확인 후 되돌린다(`git stash` 금지 — 파일 편집 후 `git checkout -- 파일`).
- [ ] **Step 3: 리뷰** — 서브에이전트 코드 리뷰(spec + `git diff <spec commit>..HEAD`만 전달, 세션 히스토리 금지). 지적은 계층 대조 후 반영.
- [ ] **Step 4: 문서 분배** — `CHANGELOG.md` 2026-09-02 항목, `docs/BACKLOG.md` A31 종결(+E13 판정 축 "간략 창 정확도 상한 30m 완화 여부"), `docs/FIELD-TEST.md` §3 행 2개(인계 뒤 5분 내 추정 도착 / 퇴근 복귀 시 잔재 0), `CLAUDE.md` 함정(도착 창·종료 화면 수명·clearArrival 판별선 — 한 항목으로), `PROGRESS.md` 상태 한 줄(필요 시).
- [ ] **Step 5:** 커밋·푸시(main 직접) → `CONFIGURATION=Experimental ./ios/deploy-device.sh` + `CONFIGURATION=Release ./ios/deploy-device.sh`(기기 연결 시).

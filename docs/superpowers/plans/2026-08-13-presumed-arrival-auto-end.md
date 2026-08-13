# 도착 추정 자동 종료 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도보 안내 최종 접근 국면에서 실내 진입 신호(usable fix 두절 3분 / 정지 5분)가 지속되면 도착으로 간주해 종·낭독 후 자동 종료한다.

**Architecture:** 판정은 순수 함수 `presumedArrivalStep`+`advanceProgressAnchor`(웹 `final-approach.ts` ↔ Kit `FinalApproach.swift` 미러, 공유 fixture 동조). iOS 배선은 `BeaconModel`의 기존 워치독 틱(noFix 모양)과 `handleFinalApproach`(stationary 모양) 두 곳, 자동 종료는 단일 함수로 봉인. `GuideTuning.presumedArrivalEnabled`로 walk만 활성.

**Tech Stack:** TypeScript(Vitest) / Swift(Swift Testing) / SwiftUI

**Spec:** `docs/superpowers/specs/2026-08-13-presumed-arrival-auto-end-design.md`

**구현 방식 판정(자율성 헌장):** inline 실행. 근거 — 판정 계약이 태스크 1~6을 관통하는 순차 의존이고, 태스크 6이 `BeaconModel` 단일 파일에 수정을 집중한다(파일 겹침). 리뷰는 판정과 무관하게 태스크 묶음별 서브에이전트 리뷰로 분리한다.

## Global Constraints

- 상수는 spec §3 값 그대로: noFix **180s**, stationary **300s**, progressEpsilon **10m**, 거리 캡 **150m**. 전부 잠정값(실보행 재판정 전 변경 금지).
- 판정 순서 고정: 국면 게이트 → 거리 캡 → noFix → stationary (spec §3).
- 무효 입력(음수·NaN·무한, 거리 null)은 `.none`(spec §3 입력 계약).
- 자동 종료는 walk 전용(`presumedArrivalEnabled`, car=false — spec §4).
- 낭독 문구에 원인("신호가 약해져") 단정 금지 — 중립 서술(spec §4-4).
- 웹은 판정 함수 미러+fixture까지만(화면 배선 금지 — spec §7).
- 커밋마다 테스트 동반, `git add -A` 금지(의도 파일만).
- 주석·커밋 메시지 한국어.

---

### Task 1: 웹 판정 순수 함수 + 공유 fixture

**Files:**
- Modify: `src/lib/final-approach.ts` (말미에 추가)
- Create: `src/lib/__tests__/fixtures/presumed-arrival-scenarios.json`
- Modify: `src/lib/__tests__/final-approach.test.ts` (describe 블록 추가)

**Interfaces:**
- Produces: `presumedArrivalStep(input: PresumedArrivalInput): PresumedArrivalReason | null`, `advanceProgressAnchor(anchor, fix, epsilonMeters?)`, 상수 4종 `PRESUMED_ARRIVAL_NO_FIX_S`·`PRESUMED_ARRIVAL_STATIONARY_S`·`PROGRESS_EPSILON_M`·`PRESUMED_ARRIVAL_MAX_DIST_M`. Task 2(Swift 미러)·Task 4(리플레이)가 이 계약을 그대로 따른다.

- [ ] **Step 1: 공유 fixture 작성**

`src/lib/__tests__/fixtures/presumed-arrival-scenarios.json` (좌표는 `final-approach-scenarios.json` 관례와 같은 기준점 37.5/127.1의 미터 오프셋):

```json
{
  "comment": "presumedArrivalStep·advanceProgressAnchor 웹·Kit 동조 fixture (spec 2026-08-13 §3·§6). 무효 입력(NaN 등)은 JSON 표현 불가라 각 플랫폼 단위 테스트가 별도 커버.",
  "stepScenarios": [
    { "name": "국면 밖은 항상 none", "input": { "inFinalApproach": false, "secondsSinceUsableFix": 9999, "secondsSinceProgress": 9999, "lastKnownDistanceToDestMeters": 20 }, "expect": null },
    { "name": "거리 미확인(null)은 none", "input": { "inFinalApproach": true, "secondsSinceUsableFix": 9999, "secondsSinceProgress": 9999, "lastKnownDistanceToDestMeters": null }, "expect": null },
    { "name": "거리 캡 초과는 none", "input": { "inFinalApproach": true, "secondsSinceUsableFix": 9999, "secondsSinceProgress": 9999, "lastKnownDistanceToDestMeters": 150.1 }, "expect": null },
    { "name": "거리 캡 경계 150m는 통과", "input": { "inFinalApproach": true, "secondsSinceUsableFix": 180, "secondsSinceProgress": 0, "lastKnownDistanceToDestMeters": 150 }, "expect": "noFix" },
    { "name": "noFix 임계 직전은 none", "input": { "inFinalApproach": true, "secondsSinceUsableFix": 179.9, "secondsSinceProgress": 0, "lastKnownDistanceToDestMeters": 42.6 }, "expect": null },
    { "name": "noFix 180s 발동 (2026-08-13 실사고 모양)", "input": { "inFinalApproach": true, "secondsSinceUsableFix": 180, "secondsSinceProgress": 0, "lastKnownDistanceToDestMeters": 42.6 }, "expect": "noFix" },
    { "name": "stationary 임계 직전은 none", "input": { "inFinalApproach": true, "secondsSinceUsableFix": 2, "secondsSinceProgress": 299.9, "lastKnownDistanceToDestMeters": 42.6 }, "expect": null },
    { "name": "stationary 300s 발동 (fix는 살아 있음)", "input": { "inFinalApproach": true, "secondsSinceUsableFix": 2, "secondsSinceProgress": 300, "lastKnownDistanceToDestMeters": 42.6 }, "expect": "stationary" },
    { "name": "両축 초과 시 noFix 우선(순서 고정)", "input": { "inFinalApproach": true, "secondsSinceUsableFix": 400, "secondsSinceProgress": 400, "lastKnownDistanceToDestMeters": 42.6 }, "expect": "noFix" }
  ],
  "anchorScenarios": [
    { "name": "저속 연속 보행은 진행이다 (리뷰 C2 반례)", "epsilonMeters": 10, "steps": [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9], [0, 10], [0, 11]], "expectProgressedAt": [10] },
    { "name": "앵커 주변 지터 왕복은 진행이 아니다", "epsilonMeters": 10, "steps": [[0, 0], [0, 6], [0, -6], [6, 0], [-6, 0], [0, 6]], "expectProgressedAt": [] },
    { "name": "재앵커 후 재이동도 진행", "epsilonMeters": 10, "steps": [[0, 0], [0, 12], [0, 13], [0, 24]], "expectProgressedAt": [1, 3] }
  ]
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `src/lib/__tests__/final-approach.test.ts` 말미에 추가:

```ts
import presumedFixture from "./fixtures/presumed-arrival-scenarios.json";
import {
  advanceProgressAnchor,
  presumedArrivalStep,
  type PresumedArrivalInput,
} from "../final-approach";

// fixture 좌표 → 위경도 (기존 final-approach 시나리오와 같은 기준점)
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 111_320 * Math.cos((37.5 * Math.PI) / 180);
const toCoord = ([dLat, dLng]: number[]) => ({
  lat: 37.5 + dLat / M_PER_DEG_LAT,
  lng: 127.1 + dLng / M_PER_DEG_LNG,
});

describe("presumedArrivalStep (공유 fixture)", () => {
  for (const s of presumedFixture.stepScenarios) {
    it(s.name, () => {
      expect(presumedArrivalStep(s.input as PresumedArrivalInput)).toBe(s.expect);
    });
  }

  it("무효 입력(음수·NaN·무한)은 null", () => {
    const base: PresumedArrivalInput = {
      inFinalApproach: true,
      secondsSinceUsableFix: 200,
      secondsSinceProgress: 0,
      lastKnownDistanceToDestMeters: 20,
    };
    expect(presumedArrivalStep({ ...base, secondsSinceUsableFix: -1 })).toBeNull();
    expect(presumedArrivalStep({ ...base, secondsSinceUsableFix: NaN })).toBeNull();
    expect(presumedArrivalStep({ ...base, secondsSinceProgress: Infinity })).toBeNull();
    expect(
      presumedArrivalStep({ ...base, lastKnownDistanceToDestMeters: NaN }),
    ).toBeNull();
    expect(
      presumedArrivalStep({ ...base, lastKnownDistanceToDestMeters: -5 }),
    ).toBeNull();
  });
});

describe("advanceProgressAnchor (공유 fixture)", () => {
  for (const s of presumedFixture.anchorScenarios) {
    it(s.name, () => {
      let anchor: { lat: number; lng: number } | null = null;
      const progressedAt: number[] = [];
      s.steps.forEach((step, i) => {
        const out = advanceProgressAnchor(anchor, toCoord(step), s.epsilonMeters);
        anchor = out.anchor;
        if (out.progressed) progressedAt.push(i);
      });
      expect(progressedAt).toEqual(s.expectProgressedAt);
    });
  }
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/lib/__tests__/final-approach.test.ts`
Expected: FAIL — `presumedArrivalStep` export 없음.

- [ ] **Step 4: 구현** — `src/lib/final-approach.ts` 말미에 추가:

```ts
// ── 도착 추정(잊힌 세션 정리, spec 2026-08-13) ──────────────────────────────
// Kit 미러는 `FinalApproach.swift`, 공유 fixture `presumed-arrival-scenarios.json`.

/** usable fix 두절이 이만큼 지속되면 실내 진입으로 간주(잠정 — 실보행 재판정). */
export const PRESUMED_ARRIVAL_NO_FIX_S = 180;
/** usable fix는 오는데 무진행이 이만큼 지속되면 실내 고정 좌표로 간주(잠정). */
export const PRESUMED_ARRIVAL_STATIONARY_S = 300;
/** 진행 관측 앵커 이탈 하한(m). 직전 fix 비교 금지 — 저속 연속 보행이 제자리로 오판된다. */
export const PROGRESS_EPSILON_M = 10;
/** 마지막 확인 거리 캡(m). 오프셋 실측 상한 89m + GPS 여유. 이 밖은 이탈이지 도착이 아니다. */
export const PRESUMED_ARRIVAL_MAX_DIST_M = 150;

export type PresumedArrivalReason = "noFix" | "stationary";

export interface PresumedArrivalInput {
  inFinalApproach: boolean;
  /** 기준: max(최종 접근 진입, 마지막 usable fix) — 진입 전 노화가 새면 즉시 발동한다. */
  secondsSinceUsableFix: number;
  /** 기준: max(최종 접근 진입, 마지막 진행 관측). */
  secondsSinceProgress: number;
  /** 마지막 usable fix 기준 목적지 직선거리. null = 미확인(발동 불가). */
  lastKnownDistanceToDestMeters: number | null;
}

const finiteNonNegative = (x: number) => Number.isFinite(x) && x >= 0;

/**
 * 도착 추정 판정. 판정 순서(국면 → 거리 캡 → noFix → stationary)까지 계약이다 —
 * 국면 게이트가 경로 중간 자동 종료 금지의 1선 방어다(spec §3).
 */
export function presumedArrivalStep(
  input: PresumedArrivalInput,
): PresumedArrivalReason | null {
  if (!input.inFinalApproach) return null;
  const dist = input.lastKnownDistanceToDestMeters;
  if (
    !finiteNonNegative(input.secondsSinceUsableFix) ||
    !finiteNonNegative(input.secondsSinceProgress)
  )
    return null;
  if (dist === null || !finiteNonNegative(dist) || dist > PRESUMED_ARRIVAL_MAX_DIST_M)
    return null;
  if (input.secondsSinceUsableFix >= PRESUMED_ARRIVAL_NO_FIX_S) return "noFix";
  if (input.secondsSinceProgress >= PRESUMED_ARRIVAL_STATIONARY_S) return "stationary";
  return null;
}

/**
 * 진행 관측 앵커 전진. **직전 fix가 아니라 앵커 기준 누적 변위**다 — 직전 비교는
 * 1m/s 연속 보행(fix 간 1m)을 5분 300m 걷고도 제자리로 오판한다(설계 리뷰 C2).
 */
export function advanceProgressAnchor(
  anchor: Coord | null,
  fix: Coord,
  epsilonMeters: number = PROGRESS_EPSILON_M,
): { anchor: Coord; progressed: boolean } {
  if (!anchor) return { anchor: fix, progressed: false };
  if (haversineMeters(anchor.lat, anchor.lng, fix.lat, fix.lng) >= epsilonMeters) {
    return { anchor: fix, progressed: true };
  }
  return { anchor, progressed: false };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/__tests__/final-approach.test.ts`
Expected: PASS (기존 기하 테스트 포함 전체 green)

- [ ] **Step 6: 변이 주입 (spec §6)** — 일시적으로 ①국면 게이트 첫 줄 제거 ②거리 캡 조건 제거를 각각 적용해 테스트가 최소 1케이스씩 깨지는지 확인 후 원복. 결과를 Step 7 커밋 메시지 본문에 한 줄 기록.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/final-approach.ts src/lib/__tests__/final-approach.test.ts src/lib/__tests__/fixtures/presumed-arrival-scenarios.json
git commit -m "feat(guide): 도착 추정 판정 순수 함수 presumedArrivalStep (웹)" -- src/lib/final-approach.ts src/lib/__tests__/final-approach.test.ts src/lib/__tests__/fixtures/presumed-arrival-scenarios.json
```

---

### Task 2: Kit 미러 + fixture 동조 테스트

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/FinalApproach.swift` (말미에 추가)
- Modify: `ios/GildongmuKit/Tests/GildongmuKitTests/FinalApproachTests.swift` (말미에 추가)

**Interfaces:**
- Consumes: Task 1의 fixture(`presumed-arrival-scenarios.json`, 레포 상대 경로 직접 읽기 — 사본 금지).
- Produces: `presumedArrivalStep(inFinalApproach:secondsSinceUsableFix:secondsSinceProgress:lastKnownDistanceToDestMeters:) -> PresumedArrivalReason?`, `advanceProgressAnchor(anchor:fix:epsilonMeters:) -> (anchor: RoutePoint, progressed: Bool)`, 상수 `presumedArrivalNoFixSeconds`·`presumedArrivalStationarySeconds`·`progressEpsilonMeters`·`presumedArrivalMaxDistanceMeters`. Task 6(BeaconModel)이 소비.

- [ ] **Step 1: 실패하는 테스트 작성** — `FinalApproachTests.swift` 말미에 추가(기존 `loadScenarios` 관례 동형):

```swift
// ── 도착 추정 판정 fixture 동조 (spec 2026-08-13) ──

private struct PresumedFixtureFile: Decodable {
    let stepScenarios: [PresumedStepScenario]
    let anchorScenarios: [AnchorScenario]
}

private struct PresumedStepScenario: Decodable {
    let name: String
    let input: Input
    let expect: String?

    struct Input: Decodable {
        let inFinalApproach: Bool
        let secondsSinceUsableFix: Double
        let secondsSinceProgress: Double
        let lastKnownDistanceToDestMeters: Double?
    }
}

private struct AnchorScenario: Decodable {
    let name: String
    let epsilonMeters: Double
    let steps: [[Double]]
    let expectProgressedAt: [Int]
}

private func loadPresumedFixture() throws -> PresumedFixtureFile {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("src/lib/__tests__/fixtures/presumed-arrival-scenarios.json")
    return try JSONDecoder().decode(PresumedFixtureFile.self, from: Data(contentsOf: url))
}

@Test("도착 추정 판정 공유 fixture 동조")
func presumedArrivalMatchesSharedFixture() throws {
    for s in try loadPresumedFixture().stepScenarios {
        let got = presumedArrivalStep(
            inFinalApproach: s.input.inFinalApproach,
            secondsSinceUsableFix: s.input.secondsSinceUsableFix,
            secondsSinceProgress: s.input.secondsSinceProgress,
            lastKnownDistanceToDestMeters: s.input.lastKnownDistanceToDestMeters
        )
        #expect(got?.rawValue == s.expect, "\(s.name)")
    }
}

@Test("진행 앵커 공유 fixture 동조")
func progressAnchorMatchesSharedFixture() throws {
    for s in try loadPresumedFixture().anchorScenarios {
        var anchor: RoutePoint? = nil
        var progressedAt: [Int] = []
        for (i, step) in s.steps.enumerated() {
            let out = advanceProgressAnchor(
                anchor: anchor, fix: toPoint(step), epsilonMeters: s.epsilonMeters
            )
            anchor = out.anchor
            if out.progressed { progressedAt.append(i) }
        }
        #expect(progressedAt == s.expectProgressedAt, "\(s.name)")
    }
}

@Test("도착 추정 무효 입력은 none")
func presumedArrivalRejectsInvalidInput() {
    #expect(presumedArrivalStep(
        inFinalApproach: true, secondsSinceUsableFix: -1,
        secondsSinceProgress: 0, lastKnownDistanceToDestMeters: 20) == nil)
    #expect(presumedArrivalStep(
        inFinalApproach: true, secondsSinceUsableFix: .nan,
        secondsSinceProgress: 0, lastKnownDistanceToDestMeters: 20) == nil)
    #expect(presumedArrivalStep(
        inFinalApproach: true, secondsSinceUsableFix: 200,
        secondsSinceProgress: .infinity, lastKnownDistanceToDestMeters: 20) == nil)
    #expect(presumedArrivalStep(
        inFinalApproach: true, secondsSinceUsableFix: 200,
        secondsSinceProgress: 0, lastKnownDistanceToDestMeters: -5) == nil)
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd ios/GildongmuKit && swift test --filter FinalApproachTests`
Expected: 컴파일 실패 — `presumedArrivalStep` 미정의.

- [ ] **Step 3: 구현** — `FinalApproach.swift` 말미에 추가:

```swift
// ── 도착 추정(잊힌 세션 정리, spec 2026-08-13) ──
// 웹 `final-approach.ts` 미러. 공유 fixture `presumed-arrival-scenarios.json`이 동조 강제.

/// usable fix 두절이 이만큼 지속되면 실내 진입으로 간주(잠정 — 실보행 재판정).
public let presumedArrivalNoFixSeconds = 180.0
/// usable fix는 오는데 무진행이 이만큼 지속되면 실내 고정 좌표로 간주(잠정).
public let presumedArrivalStationarySeconds = 300.0
/// 진행 관측 앵커 이탈 하한(m). 직전 fix 비교 금지 — 저속 연속 보행이 제자리로 오판된다.
public let progressEpsilonMeters = 10.0
/// 마지막 확인 거리 캡(m). 오프셋 실측 상한 89m + GPS 여유. 이 밖은 이탈이지 도착이 아니다.
public let presumedArrivalMaxDistanceMeters = 150.0

public enum PresumedArrivalReason: String, Sendable, Equatable {
    case noFix
    case stationary
}

private func finiteNonNegative(_ x: Double) -> Bool { x.isFinite && x >= 0 }

/// 도착 추정 판정. 판정 순서(국면 → 거리 캡 → noFix → stationary)까지 계약이다 —
/// 국면 게이트가 경로 중간 자동 종료 금지의 1선 방어다(spec §3).
public func presumedArrivalStep(
    inFinalApproach: Bool,
    secondsSinceUsableFix: Double,
    secondsSinceProgress: Double,
    lastKnownDistanceToDestMeters: Double?
) -> PresumedArrivalReason? {
    guard inFinalApproach else { return nil }
    guard finiteNonNegative(secondsSinceUsableFix),
          finiteNonNegative(secondsSinceProgress)
    else { return nil }
    guard let dist = lastKnownDistanceToDestMeters,
          finiteNonNegative(dist), dist <= presumedArrivalMaxDistanceMeters
    else { return nil }
    if secondsSinceUsableFix >= presumedArrivalNoFixSeconds { return .noFix }
    if secondsSinceProgress >= presumedArrivalStationarySeconds { return .stationary }
    return nil
}

/// 진행 관측 앵커 전진. **직전 fix가 아니라 앵커 기준 누적 변위**다 — 직전 비교는
/// 1m/s 연속 보행(fix 간 1m)을 5분 300m 걷고도 제자리로 오판한다(설계 리뷰 C2).
public func advanceProgressAnchor(
    anchor: RoutePoint?,
    fix: RoutePoint,
    epsilonMeters: Double = progressEpsilonMeters
) -> (anchor: RoutePoint, progressed: Bool) {
    guard let anchor else { return (fix, false) }
    let moved = haversineMeters(
        lat1: anchor.lat, lng1: anchor.lng, lat2: fix.lat, lng2: fix.lng
    )
    if moved >= epsilonMeters { return (fix, true) }
    return (anchor, false)
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd ios/GildongmuKit && swift test --filter FinalApproachTests`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add ios/GildongmuKit/Sources/GildongmuKit/FinalApproach.swift ios/GildongmuKit/Tests/GildongmuKitTests/FinalApproachTests.swift
git commit -m "feat(guide): 도착 추정 판정 Kit 미러 + 공유 fixture 동조" -- ios/GildongmuKit/Sources/GildongmuKit/FinalApproach.swift ios/GildongmuKit/Tests/GildongmuKitTests/FinalApproachTests.swift
```

---

### Task 3: GuideTuning 게이트 (walk 전용, 両미러)

**Files:**
- Modify: `src/lib/route-guide.ts` (`GuideTuning` interface + `WALK_TUNING`/`CAR_TUNING`)
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift` (`GuideTuning` struct + `.walk`/`.car`)
- Modify: `src/lib/__tests__/route-guide.test.ts`, `ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift` (게이트 값 단언 추가)

**Interfaces:**
- Produces: `GuideTuning.presumedArrivalEnabled: Bool` — walk `true`, car `false`. Task 6이 소비.

- [ ] **Step 1: 実패하는 단언 추가** — `src/lib/__tests__/route-guide.test.ts`에:

```ts
it("도착 추정은 walk 전용이다 (spec 2026-08-13 §4)", () => {
  expect(WALK_TUNING.presumedArrivalEnabled).toBe(true);
  expect(CAR_TUNING.presumedArrivalEnabled).toBe(false);
});
```

`RouteGuideTests.swift`에:

```swift
@Test("도착 추정은 walk 전용이다 (spec 2026-08-13 §4)")
func presumedArrivalGateIsWalkOnly() {
    #expect(GuideTuning.walk.presumedArrivalEnabled)
    #expect(!GuideTuning.car.presumedArrivalEnabled)
}
```

- [ ] **Step 2: 실패 확인** — 両테스트 실행, 컴파일 실패 예상.

- [ ] **Step 3: 구현** — 웹 `GuideTuning` interface에(`courseAxisEnabled` 아래):

```ts
  /**
   * 도착 추정 자동 종료(spec 2026-08-13). **보행 전용** — 자동차는 정체 5분 정지·
   * 지하차도가 일상이라 도보 상수를 공유하면 주행 중 안내가 끊긴다(설계 리뷰 C5).
   */
  presumedArrivalEnabled: boolean;
```

`WALK_TUNING`에 `presumedArrivalEnabled: true,`, `CAR_TUNING`에 `presumedArrivalEnabled: false,` 추가. Kit `GuideTuning`에 같은 주석의 `public var presumedArrivalEnabled: Bool` 필드 + init 파라미터 + `.walk`에 `presumedArrivalEnabled: true`, `.car`에 `presumedArrivalEnabled: false`. ⚠ 기본값 금지([[no-default-for-safety-parameters]]) — init 호출부가 깨지면 명시값으로 고친다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/route-guide.test.ts && cd ios/GildongmuKit && swift test --filter RouteGuideTests`
Expected: PASS (다른 GuideTuning 생성 지점 컴파일 오류가 나면 그 자리에서 명시값 추가)

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(guide): GuideTuning.presumedArrivalEnabled — 도착 추정 walk 전용 게이트" -- src/lib/route-guide.ts ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift src/lib/__tests__/route-guide.test.ts ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift
```

---

### Task 4: 리플레이 테스트 (2026-08-13 실사고 로그)

**Files:**
- Create: `src/lib/__tests__/presumed-arrival-replay.test.ts`

**Interfaces:**
- Consumes: Task 1의 `presumedArrivalStep`, 아카이브 로그 `docs/superpowers/specs/logs/guide-diag-2026-08-13.log.gz`.

- [ ] **Step 1: 테스트 작성** (`course-derivation-replay.test.ts` 관례 동형 — 로그를 직접 gunzip):

```ts
// @vitest-environment node
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { presumedArrivalStep } from "../final-approach";

/**
 * 실사고 리플레이 게이트(spec 2026-08-13 §6). 17:03 KST 귀가 세션 —
 * finalApproachEnter(08:08:31Z) 직후 usable fix 0건이 되며 세션이 잊혔다.
 * 이 타임라인에 판정을 재생해 "마지막 fix + 180초에 noFix 발동, 그 전엔 침묵"을
 * 회귀 기준으로 잠근다. 거리 입력은 진입 fix의 perp(42.6m)를 근사로 쓴다
 * (목적지 좌표는 로그에 없다 — 최종 접근 진입 직후라 직선거리와 대차 없음).
 */
const LOG = path.join(
  process.cwd(),
  "docs/superpowers/specs/logs/guide-diag-2026-08-13.log.gz",
);

interface Entry {
  t: number;
  event: string;
}

function parseSession(): Entry[] {
  const lines = gunzipSync(readFileSync(LOG)).toString("utf8").split("\n");
  const out: Entry[] = [];
  for (const line of lines) {
    if (!line.includes("[2026-08-13T08:0")) continue;
    const t = /fix t=([0-9.]+)/.exec(line);
    const ev = /event=([a-zA-Z-]+)/.exec(line);
    if (t) out.push({ t: Number(t[1]), event: ev?.[1] ?? "-" });
  }
  return out;
}

describe("도착 추정 리플레이 (2026-08-13 실사고)", () => {
  const fixes = parseSession();
  const entered = fixes.find((f) => f.event === "finalApproachEnter");
  const last = fixes[fixes.length - 1];
  const ENTRY_PERP_M = 42.6;

  it("세션이 기대 모양이다 (최종 접근 진입 = 마지막 fix)", () => {
    expect(fixes.length).toBeGreaterThan(200);
    expect(entered).toBeDefined();
    expect(last.t).toBe(entered!.t);
  });

  it("fix 스트림 생존 중에는 발동하지 않는다", () => {
    for (const f of fixes) {
      expect(
        presumedArrivalStep({
          inFinalApproach: f.event === "finalApproachEnter",
          secondsSinceUsableFix: 0,
          secondsSinceProgress: 0,
          lastKnownDistanceToDestMeters: ENTRY_PERP_M,
        }),
      ).toBeNull();
    }
  });

  it("마지막 fix + 180초에 noFix 발동, 그 전엔 침묵 (2초 워치독 틱 재생)", () => {
    const lastT = last.t;
    for (let tick = lastT; tick < lastT + 179; tick += 2) {
      expect(
        presumedArrivalStep({
          inFinalApproach: true,
          secondsSinceUsableFix: tick - lastT,
          secondsSinceProgress: tick - lastT,
          lastKnownDistanceToDestMeters: ENTRY_PERP_M,
        }),
      ).toBeNull();
    }
    expect(
      presumedArrivalStep({
        inFinalApproach: true,
        secondsSinceUsableFix: 180,
        secondsSinceProgress: 180,
        lastKnownDistanceToDestMeters: ENTRY_PERP_M,
      }),
    ).toBe("noFix");
  });
});
```

- [ ] **Step 2: 통과 확인**

Run: `npx vitest run src/lib/__tests__/presumed-arrival-replay.test.ts`
Expected: PASS. ⚠ "세션이 기대 모양이다"가 FAIL이면 로그 파싱 가정이 틀린 것 — 판정을 고치지 말고 파서를 로그 실물과 대조.

- [ ] **Step 3: 커밋**

```bash
git add src/lib/__tests__/presumed-arrival-replay.test.ts
git commit -m "test(guide): 도착 추정 리플레이 게이트 — 2026-08-13 실사고 타임라인" -- src/lib/__tests__/presumed-arrival-replay.test.ts
```

---

### Task 5: i18n 문자열 (6로케일 + xcstrings 재생성)

**Files:**
- Modify: `messages/{ko,en,es,fr,it,ja}.json` (`guide` 네임스페이스)
- Modify: `ios/i18n/ios-extra/{ko,en,es,fr,it,ja}.json` (`ios.beacon` 밑)
- Regenerate: `ios/Gildongmu/Resources/Localizable.xcstrings` (`node ios/scripts/messages-to-xcstrings.mjs app`)

**Interfaces:**
- Produces: `guide.arrivedPresumed`, `ios.beacon.arrivedPresumedHeading`. Task 6이 `appLocalized`로 소비.

- [ ] **Step 1: messages에 `guide.arrivedPresumed` 추가** — 각 로케일 `guide` 객체의 `"arrived"` 옆에. ⚠ 플레이스홀더 없음(기존 `guide.arrived` 동형 — 목적지명은 시트 헤딩이 전달, xcstrings 위치 인자 함정 회피). 원인 단정("신호가 약해져") 금지(spec §4-4):

| 로케일 | 값 |
|---|---|
| ko | `목적지 부근에 도착한 것으로 판단해 안내를 종료했습니다` |
| en | `You appear to have arrived near the destination, so guidance has ended` |
| es | `Parece que has llegado cerca del destino, así que la guía ha finalizado` |
| fr | `Vous semblez être arrivé près de la destination, le guidage est donc terminé` |
| it | `Sembra che tu sia arrivato vicino alla destinazione, quindi la guida è terminata` |
| ja | `目的地付近に到着したと判断し、案内を終了しました` |

- [ ] **Step 2: ios-extra에 `ios.beacon.arrivedPresumedHeading` 추가** — 각 로케일 기존 `arrivedHeading`("도착") 옆에: ko `도착 추정` / en `Presumed arrival` / es `Llegada estimada` / fr `Arrivée estimée` / it `Arrivo stimato` / ja `到着推定`.

- [ ] **Step 3: xcstrings 재생성 + 검증**

Run: `node ios/scripts/messages-to-xcstrings.mjs app && node ios/scripts/check-xcstrings-keys.mjs && npx vitest run src/i18n/__tests__ 2>/dev/null || npx vitest run -t i18n`
Expected: 재생성 후 키 린터·i18n 일관성 게이트 green (i18n 테스트 파일 경로는 `git grep -l i18n-messages.test` 로 확인해 실행).

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(guide): 도착 추정 문구 6로케일 — 원인 단정 없는 중립 서술" -- messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json messages/ja.json ios/i18n/ios-extra/ko.json ios/i18n/ios-extra/en.json ios/i18n/ios-extra/es.json ios/i18n/ios-extra/fr.json ios/i18n/ios-extra/it.json ios/i18n/ios-extra/ja.json ios/Gildongmu/Resources/Localizable.xcstrings
```

---

### Task 6: BeaconModel 배선 + 도착 시트 분기

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`
- Modify: `ios/Gildongmu/Directions/BeaconTrackingSheet.swift:258-271` (`arrivalSection`)

**Interfaces:**
- Consumes: Task 2 `presumedArrivalStep`·`advanceProgressAnchor`, Task 3 `tuning.presumedArrivalEnabled`, Task 5 문자열 키.
- Produces: `BeaconModel.arrivalPresumed: Bool`(시트 분기용).

- [ ] **Step 1: 상태 필드 추가** — `private var finalApproachGeometry` (291행 부근) 아래에:

```swift
    // 도착 추정(spec 2026-08-13): 최종 접근 한정 상태. resetFinalApproach가 전부
    // 소거하고 beginFinalApproach가 에피소드 기준을 다시 세운다 — 이전 에피소드
    // 값이 새 에피소드로 새면 조기 종료가 된다(§4 상태 초기화 계약).
    private var finalApproachEnteredAt: Double?
    private var progressAnchor: RoutePoint?
    private var lastProgressAt: Double?
    private var lastUsableDistanceToDest: Double?
    /// 도착 종료 화면의 확정/추정 분기(3-state 정직성 — 시트가 소비).
    private(set) var arrivalPresumed = false
```

- [ ] **Step 2: 초기화 계약 배선**

`resetFinalApproach(geometry:)` 본문 끝에:

```swift
        finalApproachEnteredAt = nil
        progressAnchor = nil
        lastProgressAt = nil
        lastUsableDistanceToDest = nil
```

`beginFinalApproach()`의 `inFinalApproach = true` 직후에:

```swift
        finalApproachEnteredAt = uptimeNow
        progressAnchor = nil
        lastProgressAt = nil
        // 진입 fix가 곧 마지막 usable fix일 수 있다(2026-08-13 실사고가 정확히 그
        // 모양) — 거리 캡 입력을 진입 시점 좌표로 미리 세운다. 이후 usable fix마다
        // handleFinalApproach가 갱신한다.
        if let c = lastFixCoord, let dest {
            lastUsableDistanceToDest = haversineMeters(
                lat1: c.lat, lng1: c.lng, lat2: dest.lat, lng2: dest.lng
            )
        }
```

`start(dest:label:kind:)`의 `arrivalDest = nil` (386행) 옆과 `clearArrival()`·`teardown()`의 `arrivalDest = nil` 옆에 각각 `arrivalPresumed = false` 추가.

- [ ] **Step 3: stationary 모양 배선** — `handleFinalApproach`의 `let arrived = distance <= finalApproachArriveMeters` 직전에:

```swift
        lastUsableDistanceToDest = distance
        let anchorStep = advanceProgressAnchor(
            anchor: progressAnchor, fix: RoutePoint(lat: fix.lat, lng: fix.lng)
        )
        progressAnchor = anchorStep.anchor
        if anchorStep.progressed { lastProgressAt = now }
```

그리고 `if arrived { ... return }` 블록 **뒤**(주기 틱 가드 앞)에:

```swift
        // 확정 도착이 항상 이긴다 — 추정은 확정 판정이 지나간 뒤에만 본다.
        if maybePresumeArrival(now: now) { return }
```

- [ ] **Step 4: noFix 모양 배선** — `tickWatchdog()`의 `routeTone(...)` 블록 뒤, `noticeStaleIfNeeded` 앞에:

```swift
        // 도착 추정(.noFix 모양)은 fix가 안 와서 fix 경로에 걸 수 없다 — 워치독이
        // 유일한 도달 경로다(spec §4). 발동하면 세션이 끝났으므로 약신호 통지도 없다.
        if maybePresumeArrival(now: now) { return }
```

- [ ] **Step 5: 자동 종료 단일 함수** — `handleFinalApproach` 아래에 추가:

```swift
    /// 도착 추정 자동 종료(spec 2026-08-13 §4) — 자동 종료의 유일한 추가 경로.
    /// 판정은 순수 함수가, 실행은 확정 도착(handleFinalApproach의 arrived)과 같은
    /// 모양이 맡는다(문구만 분리). true = 세션을 끝냈다.
    ///
    /// 백그라운드면 announce가 missedAnnouncement만 세우고 떨어지는데, 전경 복귀
    /// 상환(handleScenePhaseChange)이 추적 가드보다 앞이라 stop() 뒤에도 statusText
    /// 꼬리로 갚아진다 — statusText 대입이 stop() 뒤인 것이 그 전제다(리뷰 M7).
    @discardableResult
    private func maybePresumeArrival(now: Double) -> Bool {
        guard isTracking, inFinalApproach, tuning.presumedArrivalEnabled,
              let dest, let enteredAt = finalApproachEnteredAt
        else { return false }
        let fixRef = max(enteredAt, lastFixAt ?? enteredAt)
        let progressRef = max(enteredAt, lastProgressAt ?? enteredAt)
        guard let reason = presumedArrivalStep(
            inFinalApproach: true,
            secondsSinceUsableFix: now - fixRef,
            secondsSinceProgress: now - progressRef,
            lastKnownDistanceToDestMeters: lastUsableDistanceToDest
        ) else { return false }
        guideDiagLog(
            "presumedArrival reason=\(reason.rawValue) "
                + "dist=\(lastUsableDistanceToDest.map { String(format: "%.1f", $0) } ?? "-")"
        )
        let text = appLocalized("guide.arrivedPresumed")
        playTone(.nearby)
        stop()  // ⚠ dest·statusText를 지우므로 문장은 위에서 미리 만든다(확정 도착 동형)
        arrivalDest = dest
        arrivalPresumed = true
        statusText = text
        lastGuidance = text
        liveTopText = text
        announce(text, highPriority: true)
        return true
    }
```

- [ ] **Step 6: 도착 시트 분기** — `BeaconTrackingSheet.arrivalSection`:

```swift
            Text(appLocalized(
                model.arrivalPresumed ? "guide.arrivedPresumed" : "guide.arrived"
            ))
                .accessibilityFocused($arrivedFocused)
```

헤더도:

```swift
            Text(joinText(
                appLocalized(
                    model.arrivalPresumed
                        ? "ios.beacon.arrivedPresumedHeading" : "ios.beacon.arrivedHeading"
                ),
                model.destinationLabel
            ))
            .accessibilityAddTraits(.isHeader)
```

- [ ] **Step 7: 빌드·전체 테스트 검증**

Run: `cd ios/GildongmuKit && swift test && cd ../.. && npm run test:run && npm run build`
Expected: 전부 green ([[vitest-green-does-not-typecheck]] — build까지가 타입 게이트). iOS 앱 타깃은 테스트 번들이 없으므로 컴파일 검증은 Task 7 배포 빌드가 겸한다.

- [ ] **Step 8: 커밋**

```bash
git commit -m "feat(guide): 잊힌 안내 세션 도착 추정 자동 종료 — BeaconModel 배선(walk 전용)" -- ios/Gildongmu/Directions/BeaconModel.swift ios/Gildongmu/Directions/BeaconTrackingSheet.swift
```

---

### Task 7: 리뷰·문서 분배·배포

- [ ] **Step 1: cross-cutting 코드 리뷰** — 서브에이전트(code-reviewer)에 태스크 1~6 diff(커밋 범위)와 spec 경로만 넘긴다(세션 히스토리 금지). 리뷰 포커스: 상태 초기화 계약 누락, 추정/확정 경로 경합, walk 게이트 우회 경로. 지적은 아키텍처 대조 후 반영.
- [ ] **Step 2: 문서 분배** — `CHANGELOG.md`에 날짜 항목(2~4줄 + spec 링크), `docs/BACKLOG.md` E13에 "실보행 판정 대기(상수 4종 잠정)" 한 줄 추가, `PROGRESS.md` 상태 한 줄 갱신. spec §6 실보행 게이트가 열린 판정임을 백로그에 남긴다.
- [ ] **Step 3: 커밋 + push** (자동 배포 포함, 웹은 lib 추가뿐이라 무해).
- [ ] **Step 4: 실기기 배포** — `CONFIGURATION=Experimental ./ios/deploy-device.sh` (기능이 `#if EXPERIMENTAL` 실시간 안내 게이트 안이라 실험판만. 공식판은 다음 릴리스에 자연 편승). 병렬 세션 배포 충돌 주의([[parallel-sessions-device-deploy-coordination]]).
- [ ] **Step 5: 완료 보고** — DONE 상태 + 실보행 판정(다음 귀가)이 남은 게이트임을 명시.

---

## Self-Review 결과

- **Spec coverage**: §3 판정(Task 1·2), 상수(Task 1·2), §4 게이트(Task 3)·배선·초기화 계약·문구(Task 5·6), §5 불변식(Task 6 단일 함수·MainActor), §6 단위·반례(Task 1 fixture — 저속 보행·지터·거리 캡·기준 하한은 `fixRef`/`progressRef`의 `max(enteredAt, …)` 구현)·리플레이(Task 4)·변이(Task 1 Step 6), §7 제외 준수. 실보행 게이트는 Task 7에서 백로그로 이관(코드 밖 판정).
- **반례 ④(진입 시점 4분 묵은 fix)**: fixture가 아니라 배선 계약(`max(enteredAt, lastFixAt)`)이 담당 — Task 6 Step 5 코드에 박혀 있고 순수 함수 입력 정의(spec §3)에 명시.
- **Type consistency**: `RoutePoint`(Kit)·`Coord`(웹) 기존 타입 재사용, `presumedArrivalStep` 시그니처 Task 1·2·4·6 일치, `arrivalPresumed` Task 6 생산·소비 일치.

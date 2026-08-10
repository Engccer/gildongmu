# 실시간 도보 안내 하단 2행 재설계 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실시간 도보 안내 화면 하단을 "현재 행동(동적 카운트다운) + 다음 예고(정적)" 역할 고정 2행으로 재편한다 — 표시 좌표계(`effectiveD`) 통일, 리듀서형 `guideLiveRows` 웹↔Kit 미러, 서버 `live{target,anchor}` 구조화 조각, 종전 currentText/statusText 자리 폐지.

**설계 정본:** `docs/superpowers/specs/2026-08-11-guide-live-two-rows-design.md` (위원장 확정 + 적대적 리뷰 11건 반영 완료 — 설계 재론 금지)

**Architecture:** ①서버 `rewriteWalkGuidance`가 재작성 정규식의 분해 조각(target/anchor)을 `includeGeometry=1` 응답 스텝에 선택 필드로 노출 ②`route-guide.ts`↔`RouteGuide.swift`에 `PROJECTION_LAG_M`·`displayEffectiveD` 한 쌍 정의(`IMMINENT_AHEAD_M = 10 + lag` 유도식 재정의, 값 25 불변) ③새 순수 계층 `guide-live-rows.ts`↔`GuideLiveRows.swift`가 표시 유닛 병합 + 국면 전이표 + 단조 클램프를 리듀서형으로 소유, 공유 fixture가 동조 강제 ④웹 훅·iOS 모델은 배선만(디스크립터 → i18n 렌더).

**Tech Stack:** TypeScript(Next.js 16, Vitest 4) / Swift(GildongmuKit, Swift Testing) / next-intl · xcstrings 파이프라인

**구현 방식 판정(자율성 헌장):** inline. 근거 — 서버 조각 → 좌표계 → 리듀서 → 플랫폼 통합이 같은 계약(디스크립터·키 이름)을 순차 공유하고, 수정 파일이 `route-guide.ts`·`useRouteGuide.ts` 등에서 겹친다. 리뷰는 판정과 무관하게 별도 컨텍스트 서브에이전트(Task 11).

## Global Constraints (spec에서 전사)

- `PROJECTION_LAG_M = 15`(m), `IMMINENT_AHEAD_M = 10 + PROJECTION_LAG_M`(= 25, **값 불변**). lag 상수와 `effectiveD` 유도는 웹 `route-guide.ts` ↔ Kit `RouteGuide.swift` **한 쌍에만** 존재(불변식 B). 표시 계층에 15·25 직접 쓰기 금지.
- **불변식 A(음성 불변)**: 음성·톤·햅틱 파이프라인은 원시 `d` 유지. 기존 음성 시나리오 fixture(`route-guide-scenarios.json`) 전체가 **기대값 무수정** 통과해야 한다(리팩터 증명 게이트) — 웹·Kit 양쪽.
- `effectiveLag = min(PROJECTION_LAG_M, 기준점 이후 원시 진행거리)` 램프인(F7). `displayRemaining = floor(max(0, 표시 유닛 끝 − effectiveD))`(F8).
- 단조 클램프는 표시 계층에만(같은 표시 유닛 안에서 직전 표시값 초과 시 직전 값 유지), **국면 판정도 클램프된 값으로**(F4). 표시 유닛 전이·재조회·이탈 복귀는 rowState 리셋.
- 국면 우선순위(F9): 도착 > 최종접근 > 이탈 > 재획득 > 불확실 > 횡단 > 회전접근(표시 잔여 ≤ 10) > 직진. 이탈 중엔 **아랫줄도 비움**(F2). 최종 유닛은 회전 접근 없이 직진을 0까지(F6). 빈 값은 요소 제거(빈 텍스트 낭독 금지).
- 클라이언트 한국어 재파싱 금지 — target/anchor는 서버 조각만. 추출 실패 = 필드 부재(지어내지 않는다).
- VO: live region 금지(두 행은 정적 텍스트 요소). iOS 라벨은 `spokenDistanceUnits` 경유(`distanceText` 헬퍼).
- V1 ko 전용(도보 안내 기존 게이트 그대로). 자동차 세션 화면 비범위(car는 기존 currentText/statusText 유지).
- 카운트다운 `{n}m`은 계기판 수치라 `formatDistance`를 타지 않는 의도적 예외(오차 반경 `±{meters}m`과 같은 계열 — 소수 km 직접 조립이 아니라 정수 m이므로 format-drift 가드와 무충돌).
- git: `git add -A` 금지, 의도 파일 pathspec commit. 커밋·push는 리뷰 게이트 통과 후(Task 11).

---

### Task 1: 서버 구조화 조각 — `live{target,anchor}`

**Files:**
- Modify: `src/lib/walk-guidance.ts`
- Modify: `src/lib/types.ts` (WalkRouteStep)
- Modify: `src/lib/walk-route.ts:131` (rewriteWalkBriefing 호출)
- Test: `src/lib/__tests__/walk-guidance.test.ts`

**Interfaces:**
- Produces: `WalkLiveFragments { target?: string; anchor?: string }`, `rewriteWalkGuidanceWithLive(description, meters?) → { text: string; live?: WalkLiveFragments }`, `rewriteWalkBriefing(briefing, includeLive: boolean)` — includeLive는 **기본값 없는 필수 인자**([[no-default-for-safety-parameters]] 동형: 응답 모양을 바꾸는 스위치라 호출 지점이 판단을 건너뛸 수 없어야 한다).
- 소비처: Task 6 fixture의 target/anchor, Task 8·9의 표시 유닛.

- [ ] **Step 1: 실패하는 테스트 작성** — `walk-guidance.test.ts`에 추가(실호출 코퍼스 문형):

```ts
import { rewriteWalkGuidance, rewriteWalkGuidanceWithLive, rewriteWalkBriefing } from "../walk-guidance";

describe("rewriteWalkGuidanceWithLive — live 조각(spec 2026-08-11 §5)", () => {
  it("이동 문장에서 anchor(…에서)·target(…까지)을 뽑는다", () => {
    const r = rewriteWalkGuidanceWithLive(
      "천호역 4번 출구에서 파리바게뜨까지 왼쪽길로 58m 이동(명일로)",
    );
    expect(r.text).toBe("천호역 4번 출구에서 왼쪽으로 돌아 파리바게뜨까지 명일로를 따라 58m 이동");
    expect(r.live).toEqual({ target: "파리바게뜨", anchor: "천호역 4번 출구" });
  });
  it("anchor의 후행 '앞'은 벗긴다(예고 틀 '{anchor} 앞에서'와 중복 방지)", () => {
    const r = rewriteWalkGuidanceWithLive("메가 MGC커피 앞에서 횡단보도 이용", 21);
    expect(r.text).toBe("메가 MGC커피 앞에서 횡단보도를 건너세요, 21m");
    expect(r.live).toEqual({ anchor: "메가 MGC커피" });
  });
  it("…에서/…까지 절이 없으면 필드 부재(지어내지 않는다)", () => {
    const r = rewriteWalkGuidanceWithLive("길동역 1번 출구 진출 후 94m 이동(양재대로)");
    expect(r.live).toBeUndefined();
  });
  it("미매칭 폴백('역사 내 이동')은 조각 없음", () => {
    expect(rewriteWalkGuidanceWithLive("역사 내 이동", 411).live).toBeUndefined();
  });
  it("rewriteWalkGuidance 래퍼는 종전 문자열 계약 그대로", () => {
    expect(rewriteWalkGuidance("천호역 4번 출구에서 파리바게뜨까지 왼쪽길로 58m 이동(명일로)"))
      .toBe("천호역 4번 출구에서 왼쪽으로 돌아 파리바게뜨까지 명일로를 따라 58m 이동");
  });
});

describe("rewriteWalkBriefing — live 부착은 옵트인", () => {
  const briefing = {
    distanceMeters: 58, durationSeconds: 60,
    steps: [{ description: "천호역 4번 출구에서 파리바게뜨까지 왼쪽길로 58m 이동(명일로)", distanceMeters: 58 }],
  };
  it("includeLive=true면 스텝에 live가 실린다", () => {
    expect(rewriteWalkBriefing(briefing, true).steps[0].live)
      .toEqual({ target: "파리바게뜨", anchor: "천호역 4번 출구" });
  });
  it("includeLive=false면 필드 자체 부재(기존 응답 byte-호환)", () => {
    expect("live" in rewriteWalkBriefing(briefing, false).steps[0]).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/__tests__/walk-guidance.test.ts` → FAIL (rewriteWalkGuidanceWithLive not exported). 기존 rewriteWalkBriefing 호출부(1-인자)도 컴파일 오류 대상.
- [ ] **Step 3: 구현** — `walk-guidance.ts`:

```ts
/** 실시간 표시 계층용 구조화 조각(spec 2026-08-11 §5). 추출 실패 필드는 부재. */
export interface WalkLiveFragments {
  /** 직진 목표 이름("파리바게뜨까지"의 까지 앞). */
  target?: string;
  /** 경계 기준 이름("메가 MGC커피 앞에서"의 에서·후행 '앞' 제거). */
  anchor?: string;
}

/** "…에서" 절 → 기준 이름. 후행 " 앞"은 벗긴다(예고 틀이 "앞에서"를 붙인다). */
function anchorFrom(from: string | undefined): string | undefined {
  if (!from?.endsWith("에서")) return undefined;
  let name = from.slice(0, -2).trim();
  if (name.endsWith(" 앞")) name = name.slice(0, -2).trim();
  return name || undefined;
}

/** "…까지" 절 → 목표 이름. */
function targetFrom(to: string | undefined): string | undefined {
  if (!to?.endsWith("까지")) return undefined;
  const name = to.slice(0, -2).trim();
  return name || undefined;
}

function liveOf(target?: string, anchor?: string): WalkLiveFragments | undefined {
  if (!target && !anchor) return undefined;
  return { ...(target && { target }), ...(anchor && { anchor }) };
}
```

기존 `rewriteWalkGuidance` 본문을 `rewriteWalkGuidanceWithLive`로 옮기고 각 분기에서 live를 함께 만든다:
- MOVE 분기: `from`(HEAD 그룹1일 때만)→`anchorFrom`, `to`(HEAD 그룹2)→`targetFrom`. ⚠ HEAD 미매칭으로 `from = trimmed`가 된 경우("진출 후" 류 서술)는 anchor로 쓰지 않는다 — `anchorFrom`의 "에서" 종결 조건이 그 판정이다. 조사 실패로 원문을 그대로 돌려주는 경로(`road && !particle`)에서도 파싱된 조각은 참이므로 live는 붙인다.
- CROSS 분기: 그룹1→anchor, 그룹2→target.
- BRIDGE 분기: 그룹1→anchor.
- "역사 내 이동" 폴백·완전 미매칭: live 없음.

```ts
export function rewriteWalkGuidanceWithLive(
  description: string,
  meters?: number,
): { text: string; live?: WalkLiveFragments } { /* 위 분기 구현 */ }

/** 종전 계약 유지 래퍼 — 기존 소비자(walk-action 주석 등)는 문자열만 필요하다. */
export function rewriteWalkGuidance(description: string, meters?: number): string {
  return rewriteWalkGuidanceWithLive(description, meters).text;
}

/** includeLive는 필수다 — 응답 모양 스위치의 생략이 조용한 계약 변경이 되지 않게. */
export function rewriteWalkBriefing(
  briefing: WalkRouteBriefing,
  includeLive: boolean,
): WalkRouteBriefing {
  const steps: WalkRouteStep[] = briefing.steps.map((step) => {
    const { text, live } = rewriteWalkGuidanceWithLive(step.description, step.distanceMeters);
    return { ...step, description: text, ...(includeLive && live ? { live } : {}) };
  });
  return { ...briefing, steps };
}
```

`types.ts` `WalkRouteStep`에 추가:

```ts
  /**
   * 실시간 표시 계층용 구조화 조각(서버 재작성 정규식의 분해 결과, spec 2026-08-11 §5).
   * `includeGeometry=1` 응답에만 실린다. 추출 실패는 필드 부재 — 클라이언트가
   * 한국어 문장을 재파싱해 얻지 않는다(재조합 금지 계약의 연장).
   */
  live?: { target?: string; anchor?: string };
```

`walk-route.ts:131`: `annotateAudioSignals(rewriteWalkBriefing(b, includeGeometry), includeGeometry)`.

- [ ] **Step 4: 통과 확인** — `npx vitest run src/lib/__tests__/walk-guidance.test.ts src/lib/__tests__/walk-route.test.ts src/lib/__tests__/walk-action.test.ts` 전부 PASS(기존 재작성 기대값 무수정).
- [ ] **Step 5: 로컬 커밋** — `git commit -m "feat(walk-guidance): 재작성 조각 live{target,anchor} 노출 — includeGeometry 옵트인 (spec 2026-08-11 §5)" -- src/lib/walk-guidance.ts src/lib/types.ts src/lib/walk-route.ts src/lib/__tests__/walk-guidance.test.ts`

### Task 2: 표시 좌표계(웹) — `PROJECTION_LAG_M`·`displayEffectiveD`·유도식 재정의

**Files:**
- Modify: `src/lib/route-guide.ts:49` (IMMINENT_AHEAD_M 자리)
- Test: 기존 `src/lib/__tests__/route-guide.test.ts` **무수정 통과가 곧 테스트**(불변식 A) + 신규 단위 테스트 3건

**Interfaces:**
- Produces: `export const PROJECTION_LAG_M = 15`, `export const IMMINENT_AHEAD_M = 10 + PROJECTION_LAG_M`, `export function displayEffectiveD(d: number, baselineD: number): number`

- [ ] **Step 1: 실패하는 테스트** — `route-guide.test.ts` 말미에 추가:

```ts
import { displayEffectiveD, IMMINENT_AHEAD_M, PROJECTION_LAG_M } from "../route-guide";

describe("표시 좌표계 (spec 2026-08-11 §3)", () => {
  it("IMMINENT_AHEAD_M은 10 + lag 유도식이고 값은 25 불변", () => {
    expect(PROJECTION_LAG_M).toBe(15);
    expect(IMMINENT_AHEAD_M).toBe(25);
  });
  it("램프인: 기준점 직후엔 걸은 만큼만 지연을 더한다(F7)", () => {
    expect(displayEffectiveD(0, 0)).toBe(0);
    expect(displayEffectiveD(5, 0)).toBe(10);   // lag 5
    expect(displayEffectiveD(20, 0)).toBe(35);  // lag 15 포화
    expect(displayEffectiveD(60, 50)).toBe(70); // 재조회 기준점 50 이후 10 → lag 10
  });
  it("기준점 이전 d(방어)는 지연 0", () => {
    expect(displayEffectiveD(40, 50)).toBe(40);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/__tests__/route-guide.test.ts` → FAIL (export 없음).
- [ ] **Step 3: 구현** — `route-guide.ts`의 `IMMINENT_AHEAD_M = 25` 선언을 다음으로 교체(기존 25m 근거 주석은 유지하고 아래를 덧붙인다):

```ts
/**
 * 표시 계층의 투영 지연 추정(m) — 실보행 2회 일관 실측(~15m) 기반 초기값
 * (spec 2026-08-11 §3). ⚠ **이 값의 갱신은 IMMINENT_AHEAD_M을 함께 움직이는
 * 의도적 행동 변경이다**(불변식 A는 "이번 변경 한정") — 실보행 리플레이 근거 +
 * spec 개정 + 실보행 재판정 없이 바꾸지 말 것. 표시 계층에 15를 직접 쓰면 drift다.
 */
export const PROJECTION_LAG_M = 15;
export const IMMINENT_AHEAD_M = 10 + PROJECTION_LAG_M; // = 25, 값 불변(유도식 재정의)

/**
 * 표시 좌표계 유효 진행거리(spec 2026-08-11 §3). 표시 계층(guide-live-rows)의
 * 구간 선택·국면·잔여가 전부 이 좌표를 쓴다. **음성·톤·햅틱 계층은 원시 d 유지.**
 * 램프인: 지연은 이동 중 쌓이는 오차라 기준점(세션·재조회 시작 시점의 d) 직후에는
 * 걸은 거리만큼만 차오른다(F7 — 출발·재조회 직후 과소 표시 방지).
 */
export function displayEffectiveD(d: number, baselineD: number): number {
  return d + Math.min(PROJECTION_LAG_M, Math.max(0, d - baselineD));
}
```

- [ ] **Step 4: 통과 + 불변식 A 게이트** — `npx vitest run src/lib/__tests__/route-guide.test.ts src/lib/__tests__/guide-tone-layer.test.ts` → 기존 시나리오 전부 **무수정** PASS.
- [ ] **Step 5: 로컬 커밋** — `git commit -m "refactor(route-guide): IMMINENT_AHEAD_M을 10+PROJECTION_LAG_M 유도식으로 — 값 25 불변, displayEffectiveD 신설 (spec §3)" -- src/lib/route-guide.ts src/lib/__tests__/route-guide.test.ts`

### Task 3: 표시 좌표계(Kit 미러)

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift:22` (imminentAheadMeters 자리)
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift` 말미 추가

**Interfaces:**
- Produces: `public let projectionLagMeters = 15.0`, `public let imminentAheadMeters = 10.0 + projectionLagMeters`, `public func displayEffectiveD(d: Double, baselineD: Double) -> Double`

- [ ] **Step 1: 실패하는 테스트** — RouteGuideTests.swift에:

```swift
@Test func displayCoordinate() {
    #expect(projectionLagMeters == 15)
    #expect(imminentAheadMeters == 25)
    #expect(displayEffectiveD(d: 5, baselineD: 0) == 10)
    #expect(displayEffectiveD(d: 20, baselineD: 0) == 35)
    #expect(displayEffectiveD(d: 60, baselineD: 50) == 70)
    #expect(displayEffectiveD(d: 40, baselineD: 50) == 40)
}
```

- [ ] **Step 2: 실패 확인** — `cd ios/GildongmuKit && swift test --filter RouteGuideTests` → 컴파일 실패.
- [ ] **Step 3: 구현** — RouteGuide.swift에서 `public let imminentAheadMeters = 25.0`을 교체(웹과 같은 주석 요지):

```swift
/// 표시 계층의 투영 지연 추정(m) — spec 2026-08-11 §3. ⚠ 갱신은 imminentAheadMeters를
/// 함께 움직이는 의도적 행동 변경(실보행 리플레이 + spec 개정 동반). 웹 PROJECTION_LAG_M 미러.
public let projectionLagMeters = 15.0
public let imminentAheadMeters = 10.0 + projectionLagMeters // = 25, 값 불변(유도식 재정의)

/// 표시 좌표계 유효 진행거리(spec §3) — 웹 displayEffectiveD 미러. 음성 계층은 원시 d 유지.
public func displayEffectiveD(d: Double, baselineD: Double) -> Double {
    d + min(projectionLagMeters, max(0, d - baselineD))
}
```

- [ ] **Step 4: 통과 + 불변식 A 게이트** — `swift test` 전체 → 기존 공유 시나리오 무수정 PASS.
- [ ] **Step 5: 로컬 커밋** — `git commit -m "refactor(kit): imminentAheadMeters 유도식 재정의 + displayEffectiveD — 웹 미러 (spec §3)" -- ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift`

### Task 4: `guide-live-rows.ts` — 표시 유닛 병합 + 리듀서

**Files:**
- Create: `src/lib/guide-live-rows.ts`
- Test: `src/lib/__tests__/guide-live-rows-units.test.ts` (병합·클램프 단위 테스트 — 문자열 fixture는 Task 6)

**Interfaces:**
- Consumes: `displayEffectiveD`, `GuidePhase`(route-guide), `walkStepAction`(walk-action), `GuideRoute`(route-geometry), `WalkRouteStep.live`(Task 1)
- Produces(전부 export, Kit 미러 대상):

```ts
export const TURN_APPROACH_M = 10;          // 회전 접근 전환 표시 잔여(spec §2-4)
export const SHORT_UNIT_PREVIEW_M = 10;     // 예고에서 "연속 회전"으로 접는 유닛 길이

export interface LiveStepInput {
  description: string;
  startD: number;
  endD: number;
  live?: { target?: string; anchor?: string };
}
export interface DisplayUnit {
  stepIndices: number[];
  startD: number;
  endD: number;
  crossing: boolean;
  /** 횡단 유닛의 표시 문장(주석 포함 스텝 전문). 비횡단은 null. */
  crossingText: string | null;
  /** 횡단 유닛의 행동 종류(crosswalk|underpass). 비횡단은 null. */
  crossingAction: WalkAction | null;
  /** 유닛 끝 경계의 행동(다음 유닛 첫 스텝에서 유도). 최종 유닛은 null. */
  endAction: WalkAction | null;
  /** 끝 행동의 기준 이름(다음 유닛 첫 스텝의 live.anchor). */
  endAnchor: string | null;
  /** 직진 목표 이름(유닛 마지막 스텝의 live.target). */
  target: string | null;
}
export function buildDisplayUnits(steps: LiveStepInput[]): DisplayUnit[];
export function liveStepsFrom(
  route: GuideRoute,
  steps: { live?: { target?: string; anchor?: string } }[],
): LiveStepInput[];

export interface LiveRowsState { unitIndex: number; clamped: number; }
export type LiveTopRow =
  | { kind: "offRoute" } | { kind: "reacquiring" } | { kind: "uncertain" }
  | { kind: "crossing"; text: string }
  | { kind: "turnIn"; meters: number; action: WalkAction }   // meters ≥ 1
  | { kind: "turnSoon"; action: WalkAction }                 // 표시 잔여 0 = "잠시 후"
  | { kind: "straight"; meters: number; target: string | null };
export type LiveNextRow =
  | { kind: "action"; action: WalkAction; anchor: string | null }  // 직진 국면: 현재 유닛 끝 행동
  | { kind: "straight"; meters: number; target: string | null }    // 다음 유닛 직진 예고(지도 값)
  | { kind: "crossing"; action: WalkAction }
  | { kind: "turn"; action: WalkAction };                          // 연속 회전
export interface LiveRowsOutput {
  state: LiveRowsState | null;
  top: LiveTopRow | null;
  next: LiveNextRow | null;
}
export function guideLiveRows(
  prev: LiveRowsState | null,
  units: DisplayUnit[],
  d: number,
  baselineD: number,
  phase: GuidePhase,
): LiveRowsOutput;
```

- [ ] **Step 1: 실패하는 테스트** — `guide-live-rows-units.test.ts`:

```ts
import { buildDisplayUnits, guideLiveRows, type LiveStepInput } from "../guide-live-rows";

function steps(...defs: [number, string, { target?: string; anchor?: string }?][]): LiveStepInput[] {
  let d = 0;
  return defs.map(([len, description, live]) => {
    const s = { description, startD: d, endD: d + len, ...(live ? { live } : {}) };
    d += len;
    return s;
  });
}

describe("buildDisplayUnits (spec §4.1)", () => {
  it("행동 없는 경계는 이전 유닛에 흡수한다(F5)", () => {
    const u = buildDisplayUnits(steps(
      [40, "천중로를 따라 40m 이동"],
      [30, "30m 이동"],
      [35, "오른쪽으로 돌아 35m 이동"],
    ));
    expect(u.map((x) => x.stepIndices)).toEqual([[0, 1], [2]]);
    expect(u[0].endD).toBe(70);
    expect(u[0].endAction).toBe("right");
    expect(u[1].endAction).toBeNull(); // 최종 유닛
  });
  it("횡단 스텝은 단독 유닛이고 흡수하지 않는다", () => {
    const u = buildDisplayUnits(steps(
      [58, "파리바게뜨까지 58m 이동", { target: "파리바게뜨" }],
      [21, "횡단보도를 건너세요, 21m, 음향신호기 있음"],
      [40, "40m 이동"],
    ));
    expect(u.map((x) => x.stepIndices)).toEqual([[0], [1], [2]]);
    expect(u[0].endAction).toBe("crosswalk");
    expect(u[1].crossing).toBe(true);
    expect(u[1].crossingText).toBe("횡단보도를 건너세요, 21m, 음향신호기 있음");
  });
  it("이름은 서버 조각에서만 온다 — target·endAnchor 배선", () => {
    const u = buildDisplayUnits(steps(
      [58, "파리바게뜨까지 58m 이동", { target: "파리바게뜨" }],
      [35, "약국 앞에서 오른쪽으로 돌아 35m 이동", { anchor: "약국" }],
    ));
    expect(u[0].target).toBe("파리바게뜨");
    expect(u[0].endAnchor).toBe("약국");
  });
  it("지명 속 '횡단보도'(회전 문장)는 횡단 유닛이 아니다", () => {
    const u = buildDisplayUnits(steps(
      [40, "직진 40m 이동"],
      [30, "천호역 횡단보도에서 왼쪽으로 돌아 30m 이동"],
    ));
    expect(u[1].crossing).toBe(false);
    expect(u[0].endAction).toBe("left");
  });
});

describe("guideLiveRows — 클램프·리셋(F4)", () => {
  const units = buildDisplayUnits(steps([100, "목적지까지 100m 이동", { target: "목적지" }]));
  it("역행 잔여는 직전 표시값 유지, 국면도 클램프 값으로 판정", () => {
    const a = guideLiveRows(null, units, 30, 0, "following");   // eff 45 → 55
    expect(a.top).toEqual({ kind: "straight", meters: 55, target: "목적지" });
    const b = guideLiveRows(a.state, units, 28, 0, "following"); // raw 57 → 클램프 55
    expect(b.top).toEqual({ kind: "straight", meters: 55, target: "목적지" });
  });
  it("prev=null 리셋이면 새 기준으로 다시 계산한다", () => {
    const a = guideLiveRows(null, units, 50, 0, "following");    // eff 65 → 35
    expect(a.top).toEqual({ kind: "straight", meters: 35, target: "목적지" });
    const r = guideLiveRows(null, units, 50, 50, "following");   // 재조회: 램프인 재시작 → 50
    expect(r.top).toEqual({ kind: "straight", meters: 50, target: "목적지" });
  });
  it("이탈은 両행 처리 — top=offRoute, next=null, state 리셋", () => {
    const o = guideLiveRows({ unitIndex: 0, clamped: 55 }, units, 30, 0, "offRoute");
    expect(o).toEqual({ state: null, top: { kind: "offRoute" }, next: null });
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/__tests__/guide-live-rows-units.test.ts` → FAIL (모듈 없음).
- [ ] **Step 3: 구현** — `src/lib/guide-live-rows.ts` 신규(파일 헤더 주석에 spec 참조 + "Kit 미러: GuideLiveRows.swift, 공유 fixture guide-live-rows-scenarios.json이 동조 강제" 명시):

```ts
import { displayEffectiveD, type GuidePhase } from "./route-guide";
import type { GuideRoute } from "./route-geometry";
import { walkStepAction, type WalkAction } from "./walk-action";

// (위 Interfaces 블록의 상수·타입 선언 그대로)

/**
 * 횡단 유닛 판정. walkStepAction만으로는 부족하다 — "횡단보도"는 지명으로도
 * 등장하므로(회전 우선순위가 회전 문장은 걸러 주지만, 회전 없는 "천호역 횡단보도까지
 * 100m 이동"이 남는다) 재작성 행동문("…건너세요")까지 요구한다.
 */
function isCrossing(action: WalkAction | null, description: string): boolean {
  return (action === "crosswalk" || action === "underpass") && description.includes("건너");
}

export function buildDisplayUnits(steps: LiveStepInput[]): DisplayUnit[] {
  const groups: { indices: number[]; crossing: boolean; action: WalkAction | null }[] = [];
  for (let i = 0; i < steps.length; i++) {
    const action = walkStepAction(steps[i].description);
    const crossing = isCrossing(action, steps[i].description);
    const prev = groups[groups.length - 1];
    // 행동 없는 경계(지도 분할 직진)는 흡수한다(F5). 횡단 유닛은 흡수하지 않는다 —
    // 국면이 유닛 단위라 꼬리를 붙이면 다 건넌 뒤에도 "건너세요"가 남는다.
    if (i > 0 && action === null && prev && !prev.crossing) {
      prev.indices.push(i);
    } else {
      groups.push({ indices: [i], crossing, action });
    }
  }
  return groups.map((g, gi) => {
    const first = steps[g.indices[0]];
    const last = steps[g.indices[g.indices.length - 1]];
    const next = groups[gi + 1];
    const nextFirst = next ? steps[next.indices[0]] : null;
    return {
      stepIndices: g.indices,
      startD: first.startD,
      endD: last.endD,
      crossing: g.crossing,
      crossingText: g.crossing ? first.description : null,
      crossingAction: g.crossing ? g.action : null,
      // 끝 행동 = 다음 유닛 첫 스텝이 알리는 행동(횡단 유닛 진입 포함). 최종 유닛 null(F6).
      endAction: nextFirst ? walkStepAction(nextFirst.description) : null,
      endAnchor: nextFirst?.live?.anchor ?? null,
      target: last.live?.target ?? null,
    };
  });
}

/** 리듀서 스팬(StepSpan)과 응답 스텝(live)을 index로 짝지어 표시 입력을 만든다. */
export function liveStepsFrom(
  route: GuideRoute,
  steps: { live?: { target?: string; anchor?: string } }[],
): LiveStepInput[] {
  return route.steps.map((s) => ({
    description: s.description,
    startD: s.startD,
    endD: s.endD,
    ...(steps[s.index]?.live ? { live: steps[s.index].live } : {}),
  }));
}

/** 다음 유닛 예고(종류별 — 직진 가정 금지, F11). */
function previewOf(unit: DisplayUnit): LiveNextRow {
  if (unit.crossing) return { kind: "crossing", action: unit.crossingAction ?? "crosswalk" };
  const len = Math.floor(unit.endD - unit.startD);
  // 직진 창이 사실상 없는 짧은 유닛은 길이 예고가 무의미하다 — 행동만 예고(연속 회전).
  if (len <= SHORT_UNIT_PREVIEW_M && unit.endAction) return { kind: "turn", action: unit.endAction };
  return { kind: "straight", meters: len, target: unit.target };
}

export function guideLiveRows(
  prev: LiveRowsState | null,
  units: DisplayUnit[],
  d: number,
  baselineD: number,
  phase: GuidePhase,
): LiveRowsOutput {
  if (units.length === 0) return { state: null, top: null, next: null };
  // 이탈: 両행을 비운다(F2 — 낡은 예고는 따라가게 된다). 문장은 렌더 계층의 기존 키.
  if (phase === "offRoute") return { state: null, top: { kind: "offRoute" }, next: null };
  // 최종 접근·도착(우선순위 1·2)은 이 계층 밖 — 오케스트레이터가 행을 소유한다.
  if (phase === "finalApproach") return { state: null, top: null, next: null };

  const effD = displayEffectiveD(d, baselineD);
  const found = units.findIndex((u) => effD < u.endD);
  const unitIndex = found === -1 ? units.length - 1 : found;
  const unit = units[unitIndex];
  const raw = Math.floor(Math.max(0, unit.endD - effD)); // F8: 버림
  // 단조 클램프(같은 표시 유닛 스코프). 국면 판정도 이 값으로(F4).
  const clamped = prev !== null && prev.unitIndex === unitIndex ? Math.min(prev.clamped, raw) : raw;
  const state: LiveRowsState = { unitIndex, clamped };

  // 밑국면(상태 대체와 무관한 유닛 기준 국면) — 아랫줄이 이것을 따른다(상태 중 유지).
  const isLast = unitIndex === units.length - 1;
  const turnApproach = !unit.crossing && clamped <= TURN_APPROACH_M && unit.endAction !== null;
  const next: LiveNextRow | null = isLast
    ? null
    : unit.crossing || turnApproach
      ? previewOf(units[unitIndex + 1])          // 행동 실행 중 → 그 행동 뒤 유닛 예고
      : { kind: "action", action: unit.endAction!, anchor: unit.endAnchor }; // 직진 중 → 끝 행동 예고

  // 상태 대체(우선순위 4·5): 윗줄만 바꾸고 아랫줄·클램프는 유지(해소 시 그 자리 복귀).
  if (phase === "reacquiring") return { state, top: { kind: "reacquiring" }, next };
  if (phase === "uncertain") return { state, top: { kind: "uncertain" }, next };

  const top: LiveTopRow = unit.crossing
    ? { kind: "crossing", text: unit.crossingText ?? "" }
    : turnApproach
      ? clamped <= 0
        ? { kind: "turnSoon", action: unit.endAction! }
        : { kind: "turnIn", meters: clamped, action: unit.endAction! }
      : { kind: "straight", meters: clamped, target: unit.target };
  return { state, top, next };
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/lib/__tests__/guide-live-rows-units.test.ts` PASS.
- [ ] **Step 5: 로컬 커밋** — `git commit -m "feat(guide-live-rows): 표시 유닛 병합 + 2행 리듀서 순수 계층 (spec §4)" -- src/lib/guide-live-rows.ts src/lib/__tests__/guide-live-rows-units.test.ts`

### Task 5: i18n 키(6로케일)

**Files:**
- Modify: `messages/ko.json`, `messages/en.json`, `messages/es.json`, `messages/fr.json`, `messages/it.json`, `messages/ja.json` (guide 네임스페이스)

**Interfaces:**
- Produces(키 이름 고정 — Task 6·8·9가 소비): `guide.liveStraight`, `guide.liveStraightNoName`, `guide.liveTurnIn`, `guide.liveAction.{left,right,crosswalk,underpass}`, `guide.nextAction`, `guide.nextStraight`, `guide.nextStraightNoName`. n=0은 기존 `guide.imminent.{action}` 재사용, 아랫줄 라벨은 기존 `guide.progressNext` 재사용.

- [ ] **Step 1: ko 키 추가** — `guide` 네임스페이스에(`imminent` 아래 배치):

```json
"liveStraight": "{target}까지 {n}m 직진하세요",
"liveStraightNoName": "{n}m 직진하세요",
"liveTurnIn": "{n}m 후 {action}",
"liveAction": {
  "left": "왼쪽으로 도세요",
  "right": "오른쪽으로 도세요",
  "crosswalk": "횡단보도를 건너세요",
  "underpass": "지하보도로 건너세요"
},
"nextAction": "{anchor} 앞에서 {action}",
"nextStraight": "{target}까지 {n}m 직진",
"nextStraightNoName": "{n}m 직진"
```

- [ ] **Step 2: 나머지 5로케일** — 같은 키를 각 언어로(도보 안내는 ko 전용 게이트라 잠재 문구이지만 키 일관성 게이트가 요구한다). en 기준: `liveStraight` "Go straight {n}m toward {target}" / `liveStraightNoName` "Go straight {n}m" / `liveTurnIn` "In {n}m, {action}" / `liveAction` left "turn left" · right "turn right" · crosswalk "cross the crosswalk" · underpass "use the underpass" / `nextAction` "{action} at {anchor}" / `nextStraight` "Go straight {n}m toward {target}" / `nextStraightNoName` "Go straight {n}m". es·fr·it·ja는 동일 의미로 각 언어 작성(액센트·표기 정확히).
- [ ] **Step 3: 게이트 통과** — `npx vitest run src/i18n/__tests__/i18n-messages.test.ts`(키 일관성) PASS. (경로가 다르면 `git grep -l "i18n-messages" src`로 확인.)
- [ ] **Step 4: 로컬 커밋** — `git commit -m "feat(i18n): 하단 2행 표시 키 7종 6로케일 (spec §6)" -- messages/ko.json messages/en.json messages/es.json messages/fr.json messages/it.json messages/ja.json`

### Task 6: 공유 fixture + 웹 러너 (기대 문자열)

**Files:**
- Create: `src/lib/__tests__/fixtures/guide-live-rows-scenarios.json`
- Create: `src/lib/__tests__/guide-live-rows.test.ts` (fixture 러너 — ko.json 렌더 대조)

**Interfaces:**
- Produces: fixture 포맷(Kit 러너 Task 7이 같은 파일·같은 렌더 규칙 소비):

```
scenario := { name, steps: [{len, desc, target?, anchor?}], inputs: [{d, phase, reset?, baselineD?}], expect: [{afterInput, top, next}] }
```

렌더 규칙(웹 러너·Kit 러너·앱 렌더러 공통 — 디스크립터→문자열):
- `straight` → target 있으면 `liveStraight{target,n}`, 없으면 `liveStraightNoName{n}`
- `turnIn` → `liveTurnIn{n, action: liveAction[a]}` / `turnSoon` → `imminent[a]` / `crossing` → text 원문
- `offRoute`·`uncertain`·`reacquiring` → 기존 `guide.offRoute`·`guide.uncertain`·`guide.reacquiring`
- next null → `""` / 그 외 → `progressNext{step}`; step은 `action`(anchor 있으면 `nextAction{anchor, action}`, 없으면 `liveAction[a]`), `straight`(`nextStraight`/`nextStraightNoName`), `crossing`(`liveAction[a]`), `turn`(`liveAction[a]`)

- [ ] **Step 1: fixture 작성** — 시나리오 3개. **메인: 실경로 8스텝 근사**(2026-08-10 저녁 왕복의 스텝 길이·행동 시퀀스를 기존 좌표 규약으로 이식 — 원좌표 재생은 경로 폴리라인이 로그에 없어 불가하며, 이 계층은 기하 무관이라 d 직접 주입이 정본이다. comment에 이 근거 명기):

steps(누적 endD: 24·34·92·113·153·183·218·230):

```json
[
  { "len": 24, "desc": "자택 앞에서 진입로를 따라 24m 이동", "anchor": "자택" },
  { "len": 10, "desc": "오른쪽으로 돌아 10m 이동" },
  { "len": 58, "desc": "왼쪽으로 돌아 파리바게뜨까지 명일로를 따라 58m 이동", "target": "파리바게뜨" },
  { "len": 21, "desc": "횡단보도를 건너세요, 21m, 음향신호기 있음" },
  { "len": 40, "desc": "천중로를 따라 40m 이동" },
  { "len": 30, "desc": "30m 이동" },
  { "len": 35, "desc": "약국 앞에서 오른쪽으로 돌아 주택 A까지 35m 이동", "target": "주택 A", "anchor": "약국" },
  { "len": 12, "desc": "왼쪽으로 돌아 목적지까지 12m 이동", "target": "목적지" }
]
```

inputs/expect (baselineD=0, eff = d + min(15, d)):

| # | d | phase | top 기대 | next 기대 | 커버 축 |
|---|---|---|---|---|---|
| 0 | 0 | following | `24m 직진하세요` | `다음 안내, 오른쪽으로 도세요` | 램프인 0 |
| 1 | 5 | following | `14m 직진하세요` | `다음 안내, 오른쪽으로 도세요` | 램프인 절반(무램프면 4m 후 회전) |
| 2 | 10 | following | `4m 후 오른쪽으로 도세요` | `다음 안내, 왼쪽으로 도세요` | 회전 접근 + 연속 회전 예고 |
| 3 | 11.6 | following | `잠시 후 오른쪽으로 도세요` | `다음 안내, 왼쪽으로 도세요` | 바닥 강등(n=0) |
| 4 | 16 | following | `3m 후 왼쪽으로 도세요` | `다음 안내, 파리바게뜨까지 58m 직진` | 짧은 유닛 즉시 임박 |
| 5 | 25 | following | `파리바게뜨까지 52m 직진하세요` | `다음 안내, 횡단보도를 건너세요` | 직진 + 끝 행동 예고 |
| 6 | 25 | uncertain | `위치 확신이 낮습니다` | `다음 안내, 횡단보도를 건너세요` | 상태 대체·아랫줄 유지 |
| 7 | 25 | reacquiring | `현재 위치를 다시 파악하는 중입니다` | `다음 안내, 횡단보도를 건너세요` | 우선순위 4 |
| 8 | 25 | following | `파리바게뜨까지 52m 직진하세요` | `다음 안내, 횡단보도를 건너세요` | 그 자리 숫자 복귀 |
| 9 | 70 | following | `7m 후 횡단보도를 건너세요` | `다음 안내, 횡단보도를 건너세요` | 횡단 접근 |
| 10 | 80 | following | `횡단보도를 건너세요, 21m, 음향신호기 있음` | `다음 안내, 70m 직진` | 횡단 국면(카운트다운 없음) + 병합 유닛 예고 |
| 11 | 105 | following | `63m 직진하세요` | `다음 안내, 약국 앞에서 오른쪽으로 도세요` | 행동 없는 경계 병합 + anchor 예고 |
| 12 | 105 | offRoute | `경로에서 벗어난 것 같습니다` | `` | 이탈 両행(F2) |
| 13 | 163 | following | `5m 후 오른쪽으로 도세요` | `다음 안내, 주택 A까지 35m 직진` | 이탈 복귀 후 재계산 |
| 14 | 200 | following | `3m 후 왼쪽으로 도세요` | `다음 안내, 목적지까지 12m 직진` | 12m 유닛은 예고 임계(10) 초과라 직진 예고 |
| 15 | 210 | following | `목적지까지 5m 직진하세요` | `` | 최종 유닛: 회전 접근 없음 + 아랫줄 비움(F6) |
| 16 | 230 | following | `목적지까지 0m 직진하세요` | `` | 직진 국면 0까지 유지 |

**보조 시나리오 2 "단조 클램프"**: steps `[{len:100, desc:"목적지까지 100m 이동", target:"목적지"}]`, inputs d=30→`55m`, d=28(주입 역행, 실전 d는 단조라 방어층)→`55m 직진하세요` 유지 2건.
**보조 시나리오 3 "재조회 리셋"**: 같은 steps, inputs `{d:50}`→`목적지까지 35m 직진하세요`, `{d:50, reset:true, baselineD:50}`→`목적지까지 50m 직진하세요`(램프인 재시작 — 값이 커지는 것이 정당).

- [ ] **Step 2: 러너 작성** — `guide-live-rows.test.ts`: fixture steps→`LiveStepInput`(len 누적), 각 input에 `reset`이면 state=null·baselineD 교체, `guideLiveRows` 실행, 디스크립터를 `messages/ko.json` 템플릿으로 렌더(위 렌더 규칙, `{x}` 치환 헬퍼 ~10줄)해 기대 문자열과 대조. `expect[i].next === ""`는 next===null 단언과 동치로 처리.
- [ ] **Step 3: 통과 확인** — `npx vitest run src/lib/__tests__/guide-live-rows.test.ts` PASS. 수치가 표와 어긋나면 **표가 아니라 구현·산수 중 무엇이 틀렸는지 spec §3 식으로 재검산**(표는 eff=d+min(15,d) 손계산이다).
- [ ] **Step 4: 로컬 커밋** — `git commit -m "test(guide-live-rows): 실경로 8스텝 근사 공유 fixture — §8-1 전이점 기대 문자열 (spec §8)" -- src/lib/__tests__/fixtures/guide-live-rows-scenarios.json src/lib/__tests__/guide-live-rows.test.ts`

### Task 7: Kit 미러 — `GuideLiveRows.swift` + 러너

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/GuideLiveRows.swift`
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/GuideLiveRowsTests.swift`

**Interfaces:**
- Produces(웹 1:1 미러, 이름 대응): `LiveStepInput`(struct: description·startD·endD·target·anchor), `DisplayUnit`, `buildDisplayUnits(_:)`, `LiveRowsState`, `LiveTopRow`/`LiveNextRow`(enum + associated values), `guideLiveRows(prev:units:d:baselineD:phase:)`, `turnApproachMeters = 10.0`, `shortUnitPreviewMeters = 10.0`. Task 9의 BeaconModel·GuideText가 소비.

- [ ] **Step 1: 러너 작성(실패 확인용)** — `GuideLiveRowsTests.swift`: `RouteGuideTests`와 같은 `#filePath` 5-단계 상향으로 `src/lib/__tests__/fixtures/guide-live-rows-scenarios.json`과 `messages/ko.json`을 읽는다. ko.json 디코딩은 `[String: Any]` 대신 필요한 키만 가진 Decodable(중첩 `guide` 구조체)로. 렌더 규칙은 Task 6과 동일(치환 헬퍼 `func fmt(_ tpl: String, _ args: [String: String])`). 각 시나리오를 순회하며 top/next 렌더 문자열 대조.
- [ ] **Step 2: 실패 확인** — `cd ios/GildongmuKit && swift test --filter GuideLiveRowsTests` → 컴파일 실패.
- [ ] **Step 3: 구현** — 웹 Task 4 로직을 구조 그대로 이식(주석에 "웹 정본 guide-live-rows.ts 미러, 공유 fixture가 동조 강제"). phase는 기존 `GuidePhase` 재사용. `Int(floor(...))` 버림, `min`/`max` 대응. 클램프·리셋·previewOf·isCrossing 분기 순서 동일.
- [ ] **Step 4: 통과 확인** — `swift test` 전체 PASS(기존 스위트 포함).
- [ ] **Step 5: 로컬 커밋** — `git commit -m "feat(kit): GuideLiveRows 미러 + 공유 fixture 러너 (spec §4)" -- ios/GildongmuKit/Sources/GildongmuKit/GuideLiveRows.swift ios/GildongmuKit/Tests/GildongmuKitTests/GuideLiveRowsTests.swift`

### Task 8: 웹 통합 — useRouteGuide + DistanceBeacon

**Files:**
- Modify: `src/hooks/useRouteGuide.ts` (currentText 폐지 → liveRows, baselineD 관리, finalApproach 윗줄)
- Modify: `src/components/DistanceBeacon.tsx` (2행 렌더)
- Test: `src/components/__tests__/DistanceBeacon-live-rows.test.tsx` (jsdom, 빈 값 요소 제거 확인)

**Interfaces:**
- Consumes: Task 4 전부, Task 1 `WalkRouteStep.live`, Task 5 키.
- Produces: `RouteGuideApi.liveRows: { top: string | null; next: string | null }`. `currentText`는 **car 세션 전용**으로 축소(walk에선 항상 null — car 화면 비범위 §7 보존).

- [ ] **Step 1: 훅 수정** — `useRouteGuide.ts`:
  - import: `buildDisplayUnits, guideLiveRows, liveStepsFrom, type DisplayUnit, type LiveRowsState, type LiveRowsOutput, type LiveTopRow, type LiveNextRow` + `WalkRouteStep` 타입.
  - 상태·ref 추가: `const [liveRows, setLiveRows] = useState<{ top: string | null; next: string | null }>({ top: null, next: null });`, `displayUnitsRef = useRef<DisplayUnit[]>([])`, `liveRowsStateRef = useRef<LiveRowsState | null>(null)`, `liveBaselineDRef = useRef(0)`.
  - `fetchGuideRoute` walk 분기 반환에 `liveSteps: liveStepsFrom(route, result.steps)` 추가(car는 `[]`).
  - **렌더러**(디스크립터→문자열, Task 6 렌더 규칙의 t() 판):

```ts
const actionPhrase = useCallback(
  (a: WalkAction): string => t(`liveAction.${a}`),
  [t],
);
const renderLiveRows = useCallback(
  (out: LiveRowsOutput): { top: string | null; next: string | null } => {
    const top = out.top;
    const topText =
      top === null ? null
      : top.kind === "offRoute" ? t("offRoute")
      : top.kind === "uncertain" ? t("uncertain")
      : top.kind === "reacquiring" ? t("reacquiring")
      : top.kind === "crossing" ? top.text
      : top.kind === "turnSoon" ? t(`imminent.${top.action}`)
      : top.kind === "turnIn"
        ? t("liveTurnIn", { n: top.meters, action: actionPhrase(top.action) })
        : top.target
          ? t("liveStraight", { target: top.target, n: top.meters })
          : t("liveStraightNoName", { n: top.meters });
    const nx = out.next;
    const step =
      nx === null ? null
      : nx.kind === "action"
        ? nx.anchor
          ? t("nextAction", { anchor: nx.anchor, action: actionPhrase(nx.action) })
          : actionPhrase(nx.action)
      : nx.kind === "straight"
        ? nx.target
          ? t("nextStraight", { target: nx.target, n: nx.meters })
          : t("nextStraightNoName", { n: nx.meters })
      : actionPhrase(nx.action); // crossing·turn
    return { top: topText, next: step ? t("progressNext", { step }) : null };
  },
  [actionPhrase, t],
);
const refreshLiveRows = useCallback(
  (state: GuideState) => {
    if (kindFixed !== "walk") return;
    const out = guideLiveRows(
      liveRowsStateRef.current,
      displayUnitsRef.current,
      state.d,
      liveBaselineDRef.current,
      state.phase,
    );
    liveRowsStateRef.current = out.state;
    setLiveRows(renderLiveRows(out)); // 같은 문자열은 React 베일아웃
  },
  [kindFixed, renderLiveRows],
);
```

  - `commitDetail(route, state)` 확장: `liveBaselineDRef.current = state.d; liveRowsStateRef.current = null;` 후 `refreshLiveRows(state)`. 기존 `setCurrentText(...)` 블록은 `kindFixed === "car"`일 때만 수행(walk는 `setCurrentText(null)`).
  - `commitDetail` 호출부 3곳(start·resolvePending·toggleMode·requestReroute)에 앞서 `displayUnitsRef.current = buildDisplayUnits(fetched.liveSteps)`를 **경로 fetch 성공 시점**에 세팅(start·reroute). toggle/resolve는 기존 route 재사용이므로 units도 기존 값 유지.
  - `stepDetail`: guideStep 후 — `if (result.event?.kind === "backOnRoute" || result.event?.kind === "reacquired") { liveBaselineDRef.current = result.state.d; liveRowsStateRef.current = null; }` 그리고 기존 walk currentText 세팅 블록을 `refreshLiveRows(result.state)`로 교체(car 분기는 기존 currentText 유지). `finalApproachEnter` 분기의 `setCurrentText(null)` 옆에 `setLiveRows({ top: null, next: null }); liveRowsStateRef.current = null;`.
  - `stepFinalApproach`: 진입 서술·주기 tick·arrived에서 `announce(text)` 직전 `setLiveRows({ top: text, next: null })`(윗줄 = 기존 최종 접근 문형 유지, §4.2 우선순위 2. brief 폴백 경로 제외).
  - `stop()`·`toggleMode`(detail→brief): `setLiveRows({ top: null, next: null }); liveRowsStateRef.current = null; displayUnitsRef.current = stop이면 [];`
  - 반환 객체에 `liveRows` 추가, `currentText` doc 주석을 "car 전용(walk는 liveRows가 대체 — spec 2026-08-11)"로 갱신.
- [ ] **Step 2: DistanceBeacon 수정** — 기존 currentText 블록(244-246행)을 교체:

```tsx
{/* 하단 2행(spec 2026-08-11): 윗줄 = 현재 행동(동적), 아랫줄 = 다음 예고.
    live region 밖 정적 텍스트 — 상태 통지는 기존 polite 채널이 담당(이중 낭독 금지).
    이탈 중엔 리듀서가 윗줄=이탈 문장·아랫줄 비움을 소유하므로 여기서 가리지 않는다.
    빈 값은 요소 제거(빈 텍스트 낭독 금지). */}
{tracking && guide.mode === "detail" && guide.liveRows.top && (
  <p className="mt-1 text-sm">{guide.liveRows.top}</p>
)}
{tracking && guide.mode === "detail" && guide.liveRows.next && (
  <p className="mt-1 text-sm text-muted">{guide.liveRows.next}</p>
)}
{/* car 세션은 기존 "현재 안내" 행 유지(spec §7 비범위) */}
{tracking && guide.mode === "detail" && kind === "car" && !guide.offRoute && guide.currentText && (
  <p className="mt-1 text-sm">{guide.currentText}</p>
)}
```

- [ ] **Step 3: jsdom 테스트** — `DistanceBeacon-live-rows.test.tsx`: `useRouteGuide`를 vi.mock으로 대체해 ①`liveRows={top:"파리바게뜨까지 52m 직진하세요", next:"다음 안내, 횡단보도를 건너세요"}` → 두 행 텍스트 렌더 확인 ②`{top:null,next:null}` → 해당 `<p>` 부재 확인(빈 요소 낭독 금지) ③rows 블록에 `aria-live` 속성이 없는지 확인. 파일 상단 `// @vitest-environment jsdom` + NextIntlClientProvider 래핑(선례 `PlaceDetail.test.tsx`).
- [ ] **Step 4: 게이트** — `npx vitest run src/components/__tests__/DistanceBeacon-live-rows.test.tsx` PASS → `npm run test:run` 전체 PASS → `npm run build`(타입 검사 — Vitest green ≠ tsc) 성공.
- [ ] **Step 5: 로컬 커밋** — `git commit -m "feat(guide): 웹 하단 2행 통합 — currentText 폐지(walk), baselineD 관리, 최종접근 윗줄 (spec §4·§6)" -- src/hooks/useRouteGuide.ts src/components/DistanceBeacon.tsx src/components/__tests__/DistanceBeacon-live-rows.test.tsx`

### Task 9: iOS 통합 — BeaconModel + BeaconTrackingSheet + xcstrings

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift` (WalkRouteStep.live 디코드)
- Modify: `ios/Gildongmu/Directions/GuideText.swift` (liveTop/liveNext 렌더러)
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift` (rows 배선)
- Modify: `ios/Gildongmu/Directions/BeaconTrackingSheet.swift` (2행 렌더)
- Regenerate: `ios/Gildongmu/Resources/Localizable.xcstrings` (`node ios/scripts/messages-to-xcstrings.mjs all`)

**Interfaces:**
- Consumes: Task 7 Kit API, Task 5 키(xcstrings 경유).
- Produces: `BeaconModel.liveTopText: String?`, `BeaconModel.liveNextText: String?`(walk 상세 전용), `WalkRouteStep.live: WalkLiveFragments?`.

- [ ] **Step 1: Kit 모델 디코드** — RouteModels.swift `WalkRouteStep`에:

```swift
    /// 실시간 표시 계층용 구조화 조각(spec 2026-08-11 §5). `includeGeometry=1` 응답에만
    /// 온다. ⚠ 선택 디코딩 — 필수로 두면 구버전 응답에서 브리핑 전체가 실패한다.
    public let live: WalkLiveFragments?

public struct WalkLiveFragments: Codable, Sendable, Hashable {
    public let target: String?
    public let anchor: String?
}
```

`swift build`로 기존 fixture 디코딩(Fixtures/route-walk.json — live 없음) 회귀 없음 확인(`swift test --filter RouteService` 계열).

- [ ] **Step 2: GuideText 렌더러** — GuideText.swift에(웹 renderLiveRows 미러, 렌더 규칙은 fixture 러너와 동일):

```swift
    // MARK: - 하단 2행 (spec 2026-08-11 §4.2·§4.3)

    static func liveActionPhrase(_ a: WalkAction) -> String {
        appLocalized("guide.liveAction.\(a.rawValue)")
    }

    static func liveTop(_ row: LiveTopRow) -> String {
        switch row {
        case .offRoute: appLocalized("guide.offRoute")
        case .uncertain: appLocalized("guide.uncertain")
        case .reacquiring: appLocalized("guide.reacquiring")
        case let .crossing(text): text
        case let .turnSoon(action): appLocalized("guide.imminent.\(action.rawValue)")
        case let .turnIn(meters, action):
            appLocalized("guide.liveTurnIn", String(meters), liveActionPhrase(action))
        case let .straight(meters, target):
            target.map { appLocalized("guide.liveStraight", $0, String(meters)) }
                ?? appLocalized("guide.liveStraightNoName", String(meters))
        }
    }

    static func liveNext(_ row: LiveNextRow) -> String {
        let step: String
        switch row {
        case let .action(action, anchor):
            step = anchor.map { appLocalized("guide.nextAction", $0, liveActionPhrase(action)) }
                ?? liveActionPhrase(action)
        case let .straight(meters, target):
            step = target.map { appLocalized("guide.nextStraight", $0, String(meters)) }
                ?? appLocalized("guide.nextStraightNoName", String(meters))
        case let .crossing(action), let .turn(action):
            step = liveActionPhrase(action)
        }
        return appLocalized("guide.progressNext", step)
    }
```

⚠ `guide.liveStraight`의 인자 순서는 xcstrings 변환기의 **등장 순서 규칙**을 따른다({target}이 먼저) — [[guidance-template-value-type]]의 위치 인자 함정. 변환 후 `check-xcstrings-keys.mjs`로 검증.

- [ ] **Step 3: BeaconModel 배선** —
  - 프로퍼티: `private(set) var liveTopText: String?`, `private(set) var liveNextText: String?`, `private var displayUnits: [DisplayUnit] = []`, `private var liveRowsState: LiveRowsState?`, `private var liveBaselineD: Double = 0`.
  - `fetchDetailData` walk 분기: briefing 확보 후 `let liveSteps = route.steps.map { span in LiveStepInput(description: span.description, startD: span.startD, endD: span.endD, target: briefing.steps[span.index].live?.target, anchor: briefing.steps[span.index].live?.anchor) }`를 함께 반환(car는 빈 배열).
  - 커밋 지점(fetchGuideRoute 성공 495행 부근·재조회 1508행 부근): `displayUnits = buildDisplayUnits(liveSteps); liveBaselineD = initial.state.d; liveRowsState = nil;` 후 `refreshLiveRows(state:)`. toggleMode 재커밋(1352행)은 units 유지 + `liveBaselineD = state.d; liveRowsState = nil; refreshLiveRows`.
  - 새 함수(refreshCurrentGuidance 옆):

```swift
    /// 하단 2행 갱신(walk 상세 전용, spec 2026-08-11). 매 fix·커밋 지점에서 부른다 —
    /// 상태 국면(uncertain·offRoute 포함)도 리듀서가 행을 소유하므로 국면 가드가 없다.
    private func refreshLiveRows(state: GuideState) {
        guard sessionKind == .walk else { return }
        let out = guideLiveRows(
            prev: liveRowsState, units: displayUnits,
            d: state.d, baselineD: liveBaselineD, phase: state.phase
        )
        liveRowsState = out.state
        let top = out.top.map(GuideText.liveTop)
        let next = out.next.map(GuideText.liveNext)
        if liveTopText != top { liveTopText = top }       // 동일 값 재대입 관찰 무효화 방지
        if liveNextText != next { liveNextText = next }
    }
```

  - `handleDetail`(961행 부근): `if out.state.phase == .following || out.state.phase == .bundle { refreshCurrentGuidance(...) }`를 → `if sessionKind == .walk { refreshLiveRows(state: out.state) } else if out.state.phase == .following || out.state.phase == .bundle { refreshCurrentGuidance(route: route, state: out.state) }`. 이벤트 처리 후 `case .backOnRoute, .reacquired:` 경로에서 `liveBaselineD = state.d; liveRowsState = nil`(consume는 route만 받으므로 handleDetail에서 event 종류 검사로 처리).
  - `beginFinalApproach`: `liveNextText = nil`(윗줄은 이어지는 handleFinalApproach 문장이 채운다). `handleFinalApproach`의 intro·arrived·tick에서 `statusText = text` 옆에 `liveTopText = text`.
  - `stop()`·`fallbackToBrief()`·`teardown()`: `liveTopText = nil; liveNextText = nil; liveRowsState = nil; displayUnits = []`(stop·teardown), fallbackToBrief는 텍스트만 nil.
- [ ] **Step 4: 시트 렌더** — BeaconTrackingSheet.swift: 기존 currentGuidanceText 행(91-94행)과 statusText 행(107-113행)을 다음으로 재편(잔여 거리 행·soundDegraded 행은 불변):

```swift
                // 하단 2행(spec 2026-08-11): 윗줄 = 현재 행동(동적), 아랫줄 = 다음 예고.
                // walk 상세 전용 — car·간략은 종전 행 유지(§7 비범위). 이탈 중에도
                // 리듀서가 윗줄(이탈 문장)·아랫줄(비움)을 소유하므로 여기서 가리지 않는다.
                // 낭독은 distanceText(spokenDistanceUnits) 경유, live region 없음.
                if model.sessionKind == .walk, model.mode == .detail {
                    if let top = model.liveTopText { distanceText(top) }
                    if let next = model.liveNextText {
                        distanceText(next).foregroundStyle(.secondary)
                    }
                } else {
                    if model.mode == .detail, !model.offRoute,
                       let current = model.currentGuidanceText {
                        distanceText(current)
                    }
                    if !model.statusText.isEmpty {
                        distanceText(
                            model.statusIsNextPreview
                                ? appLocalized("guide.progressNext", model.statusText)
                                : model.statusText
                        ).foregroundStyle(.secondary)
                    }
                }
```

⚠ 종전 statusText 행은 **간략(brief) 모드의 상태 표시**(2.1(a) 가시 상태)도 담당했다 — else 분기가 그 역할을 그대로 보존한다. walk 상세에서 statusText로만 흐르는 문장(fail·handoff)은 전부 모드가 brief/idle로 바뀌는 경로라 else 분기가 받는다.

- [ ] **Step 5: xcstrings 재생성 + 빌드 게이트** — `node ios/scripts/messages-to-xcstrings.mjs all && node ios/scripts/check-xcstrings-keys.mjs` → `cd ios/GildongmuKit && swift test` → 앱 빌드 검증 `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -configuration Debug -destination 'generic/platform=iOS' build`(정확한 프로젝트 경로·스킴은 `xcodebuild -list`로 확인).
- [ ] **Step 6: 로컬 커밋** — `git commit -m "feat(ios): 하단 2행 통합 — BeaconModel rows 배선, 시트 재편, live 디코드, xcstrings (spec §4·§6)" -- ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift ios/Gildongmu/Directions/GuideText.swift ios/Gildongmu/Directions/BeaconModel.swift ios/Gildongmu/Directions/BeaconTrackingSheet.swift ios/Gildongmu/Resources/Localizable.xcstrings`

### Task 10: 게이트 검증 + 실호출

- [ ] **Step 1: 전체 게이트** — `npm run test:run && npm run lint && npm run build` 전부 성공, `cd ios/GildongmuKit && swift test` 전부 성공. 특히 `route-guide-scenarios.json` 소비 스위트가 **무수정 그린**임을 명시 확인(불변식 A).
- [ ] **Step 2: 실호출 live 필드 게이트** — dev 서버(`npm run dev`) 후 실좌표(길동 부근)로:

```bash
curl -s "http://localhost:3000/api/route/walk?origin=37.5364,127.1469&dest=37.5385,127.1421&includeGeometry=1" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); steps=d['result']['steps']; \
lives=[s.get('live') for s in steps]; print(json.dumps(lives, ensure_ascii=False)); \
assert any(lives), 'live 조각 0건'"
# 옵트인 대조: includeGeometry 없이 → 모든 스텝에 live 부재 확인
curl -s "http://localhost:3000/api/route/walk?origin=37.5364,127.1469&dest=37.5385,127.1421" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); \
assert all('live' not in s for s in d['result']['steps']); print('opt-out OK')"
```

추출 결과(어느 문장에서 target/anchor가 나왔나)를 spec §8-4 검증 기록으로 spec 말미 또는 커밋 메시지에 남긴다.

### Task 11: 문서 분배 + 리뷰 + 커밋·push + 실기기 배포

- [ ] **Step 1: 문서 분배** —
  - `docs/BACKLOG.md`: H M0 항목을 종결 처리(서사는 CHANGELOG로)하고, spec §8-5 실보행 판정 축 5건(①짧은 유닛 연쇄 리듬 ②VO 커서 위 갱신 소음 ③lag 15 적합 ④상태 대체·복귀 매끄러움 ⑤램프인 체감)을 실보행 판정 섹션에 등재(spec 링크 포함).
  - `CHANGELOG.md`: 항목 2~4줄 + spec 링크.
  - `PROGRESS.md`: 상태 한 줄 갱신(해당 절이 있으면).
- [ ] **Step 2: 별도 컨텍스트 리뷰** — `code-reviewer` 서브에이전트 디스패치. 넘기는 것: 이 플랜 경로 + spec 경로 + 로컬 커밋 범위(diff 기준 SHA — 산출물 동결). **세션 히스토리·의도 서술 금지.** 중점 지시 없이 요구사항·diff만. 지적은 아키텍처 대조 후 수용/기각 판정 기록(기각 근거 필수).
- [ ] **Step 3: 리뷰 반영 후 push** — 수정 커밋 → `npm run test:run && npm run build` 재확인 → `git push`(자동 배포). prod에서 Step 10-2의 실호출을 gildongmu.dodoplanet.space로 1회 재확인.
- [ ] **Step 4: 실기기 배포** — `CONFIGURATION=Experimental ./ios/deploy-device.sh`(실시간 안내는 Experimental 게이트). 기기 잠금 시 설치 완료·실행 실패 안내 그대로 보고.

## Self-Review 결과 (플랜 작성 시점)

- spec 커버리지: §3(Task 2·3) §4.1~4.3(Task 4·6·7) §5(Task 1) §6(Task 5·8·9) §8-1~4(Task 6·10) §8-5(Task 11) — 공백 없음. §4.2 우선순위 1·2(도착·최종접근)는 리듀서 밖 오케스트레이터 소유로 구현(Task 8·9), spec "기존 문형 유지"와 정합.
- 타입 일관성: `LiveTopRow`/`LiveNextRow`/`DisplayUnit`/`LiveRowsState` 이름·필드가 Task 4(정의)·6(러너)·7(Swift)·8(훅)·9(모델)에서 동일한지 재확인함.
- 기대 문자열 산수: eff = d + min(15, d−baseline), 유닛 경계 24/34/92/113/183/218/230 기준 손검산 — 구현 중 어긋나면 spec §3 식으로 재검산(표 우선이 아니라 식 우선).

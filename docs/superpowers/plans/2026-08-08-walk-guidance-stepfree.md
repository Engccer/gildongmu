# 계단 회피 상태의 실시간 도보 안내 전달 (A4+D1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브리핑에서 켠 계단 회피가 실시간 도보 안내의 경로 조회에도 실리게 하고, 그 판정이 열화됐을 때 사용자가 듣게 한다.

**Architecture:** 서버는 `includeGeometry=1` 응답에서 기하 없는 유사 스텝을 빼고 안내 문장을 `stepFreeNotice` 필드로 내린다(기하 소비자가 경로를 통째로 거부하는 것을 막는다). 클라이언트는 계단 회피를 봉인하지 않고 **조회 시점에 읽어** 싣고, **열화 상태로의 전이**에서만 1회 통지하되 그 문장을 시작·재조회 발화와 한 문자열로 결합한다. 재발 방지는 기본값 있는 안전 인자를 웹·iOS 양쪽에서 제거해 컴파일러·타입 검사가 맡는다.

**Tech Stack:** Next.js 16 / TypeScript / Vitest 4(+jsdom, @testing-library/react) / Swift 6 · Swift Testing(GildongmuKit) / SwiftUI

**설계 정본:** `docs/superpowers/specs/2026-08-08-walk-guidance-stepfree-design.md`(커밋 `d57bd52`). 이 계획의 절 참조(§2.1 등)는 전부 그 문서를 가리킨다.

**구현 방식 판정(헌장 §구현 방식 판정): inline 순차.** 근거 셋: ①단일 도메인(도보 경로 계약)이다 ②T1이 응답 필드의 이름·의미를 정하고 T3~T7이 전부 그것에 의존하는 **순차 선행 관계**다 ③웹 훅의 전이 통지는 fake timer·`announce` 재낭독 우회 등 실측으로 뒤집힐 수 있는 탐색적 배선이다. 수정 파일도 겹친다(T1·T2가 `walk-route.ts`를 함께 만진다). **리뷰는 이 판정과 무관하게 항상 분리한다**(T11).

---

## Global Constraints

- 커밋 이메일 `engccer@gmail.com`. 주석·커밋 메시지·문서 한국어, 변수·함수명 영어.
- **`git add -A`/`git add .` 금지.** 의도 파일만 stage하고 `git add <files> && git commit -m "..." -- <paths>`를 **한 명령**으로 원자화한다. 커밋 직후 `git show HEAD --stat`로 의도 파일만 들었는지 검증.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- 기능·버그픽스는 **같은 커밋에 테스트 동반**. "나중에 추가" 금지.
- 게이트: `npm run test:run` · `npm run lint` · `npm run build` · Kit `swift test` · iOS `Experimental` 빌드. 매 태스크 끝에 관련 게이트를 돌린다.
- 도보 경로는 **V1 ko 전용**이다. 통지 문장은 서버가 주므로 **새 i18n 키를 만들지 않는다**(웹 `messages/*.json`·iOS `xcstrings` 무변경).
- `StepFreeStatus` 열거형 값은 정확히 `"applied"` · `"no_stepfree_route"` · `"unavailable"` 셋이다. **넷째 상태를 추가하지 않는다.**
- 통지 결합 순서는 **안내 문장이 먼저, 기존 발화가 뒤**다(세션 전체에 걸린 조건이므로 걷기 전에 들어야 한다). 구분은 공백 하나.
- 실시간 안내 iOS 코드는 `Experimental` 구성에서만 도달 가능하다. 실기기 배포는 `CONFIGURATION=Experimental ./ios/deploy-device.sh`.

---

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `src/lib/types.ts` | `WalkRouteBriefing`에 `stepFreeNotice?: string` | T1 |
| `src/lib/walk-route.ts` | `withStepFree`의 기하 분기, `STEP_FREE_NOTICE` 문구 | T1·T2 |
| `src/lib/walk-route-url.ts` **(신규)** | 도보 조회 URL 단일 조립점(인자 전부 required) | T3 |
| `src/components/DirectionsView.tsx` | `fetchMode` required 인자 + 빌더 사용 + 비콘 prop | T3·T4 |
| `src/components/DistanceBeacon.tsx` | `accessible` required prop → 훅 전달 | T4 |
| `src/components/PlaceDetail.tsx` · `TransitGuidePanel.tsx` | `accessible={false}` 명시 | T4 |
| `src/hooks/useRouteGuide.ts` | 3번째 인자·ref 판독·조회에 싣기·열화 전이 통지 | T4·T5 |
| `ios/GildongmuKit/.../Models/RouteModels.swift` | `StepFreeStatus`·두 필드·전방 호환 판독 | T6 |
| `ios/GildongmuKit/.../RouteService.swift` | `accessible` 기본값 제거 | T7 |
| `ios/Gildongmu/Directions/BeaconModel.swift` | 세션 값 보관·조회에 싣기·전이 통지 | T7 |
| `ios/Gildongmu/Directions/DirectionsTabView.swift` | `toggle` 호출부 5곳 명시 전달 | T7 |

---

## Task 1: 서버 — 기하 응답에서 유사 스텝을 빼고 문장을 필드로 내린다

**Files:**
- Modify: `src/lib/types.ts` (`WalkRouteBriefing`, 약 380행)
- Modify: `src/lib/walk-route.ts` (`withStepFree` 약 70-81행, `getWalkRoute` 약 107-148행)
- Test: `src/lib/__tests__/walk-route.test.ts`

**Interfaces:**
- Consumes: 없음(첫 태스크)
- Produces: `WalkRouteBriefing.stepFreeNotice?: string` — 열화 상태에서만 존재하는 안내 문장. `includeGeometry=1` 응답은 유사 스텝을 포함하지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/__tests__/walk-route.test.ts`에 추가(기존 파일의 모킹 관례를 그대로 따른다):

```ts
describe("계단 회피 안내 문장의 전달 채널", () => {
  it("includeGeometry=1이면 유사 스텝 없이 필드로만 전달한다", async () => {
    // 무계단 경로 부재 → 기본 모드 재호출(카카오) 분기
    mockKakaoWalk
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(briefingWithGeometry(2));

    const r = await getWalkRoute({
      origin: ORIGIN, dest: DEST, accessible: true, includeGeometry: true,
    });

    expect(r?.stepFree).toBe("no_stepfree_route");
    expect(r?.stepFreeNotice).toBeTruthy();
    // ① 기하 없는 스텝이 하나도 없다 — 있으면 buildGuideRoute가 경로를 통째로 거부한다.
    expect(r!.steps.every((s) => s.pathCoords && s.pathCoords.length > 0)).toBe(true);
    // ② 스텝 수 보존 — 불변식 1만으로는 실제 스텝을 걸러낸 구현도 통과한다(spec §3-2).
    expect(r!.steps).toHaveLength(2);
  });

  it("includeGeometry 미지정이면 종전대로 유사 스텝을 맨 앞에 넣고 문장이 일치한다", async () => {
    mockKakaoWalk
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(briefingWithGeometry(2));

    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });

    expect(r!.steps).toHaveLength(3);
    expect(r!.steps[0].description).toBe(r!.stepFreeNotice);
    expect(r!.steps[0].pathCoords).toBeUndefined();
  });

  it("applied면 문장 필드가 없다", async () => {
    mockKakaoWalk.mockResolvedValueOnce(briefingWithGeometry(2));

    const r = await getWalkRoute({
      origin: ORIGIN, dest: DEST, accessible: true, includeGeometry: true,
    });

    expect(r?.stepFree).toBe("applied");
    expect(r?.stepFreeNotice).toBeUndefined();
  });
});
```

⚠ `briefingWithGeometry(n)`은 이 파일에 이미 있는 fixture 헬퍼가 없으면 새로 만든다 — **모든 스텝이 `pathCoords`를 갖는** 브리핑이어야 한다(기하 없는 fixture로는 불변식 1이 자명하게 거짓이 되어 테스트가 구현을 검증하지 못한다).

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run src/lib/__tests__/walk-route.test.ts`
Expected: FAIL — `stepFreeNotice`가 `undefined`이고, 기하 테스트는 유사 스텝의 `pathCoords`가 없어 첫 단언에서 실패.

- [ ] **Step 3: 타입에 필드를 더한다**

`src/lib/types.ts`의 `WalkRouteBriefing`에서 `stepFree?: StepFreeStatus;` 바로 아래:

```ts
  /**
   * 열화 상태의 안내 문장(서버 정본). `stepFree`가 존재하고 `applied`가 아닐 때만
   * 있다. `includeGeometry=1` 소비자는 유사 스텝을 받지 않으므로 이 필드가 유일한
   * 채널이다(spec §2.1).
   */
  stepFreeNotice?: string;
```

- [ ] **Step 4: `withStepFree`를 기하 분기로 바꾼다**

`src/lib/walk-route.ts`의 `withStepFree`를 통째로 교체:

```ts
/**
 * 안전 문장을 전달한다. 산문 소비자에겐 스텝 0번 삽입(기존 문장 개변 금지 — 별도
 * 스텝), 구조화 소비자(`includeGeometry`)에겐 필드로만.
 *
 * ⚠ 기하 응답에 유사 스텝을 넣으면 안 된다: `buildGuideRoute`(웹 route-geometry.ts:62 ·
 * Kit RouteGeometry.swift:73)가 기하 없는 스텝을 만나면 **경로 전체를 거부**해,
 * 무계단 경로가 없을 때 상세 안내가 통째로 간략으로 조용히 강등된다(spec §1.2).
 */
function withStepFree(
  briefing: WalkRouteBriefing,
  status: StepFreeStatus,
  includeGeometry: boolean,
): WalkRouteBriefing {
  if (status === "applied") return { ...briefing, stepFree: status };
  const notice = STEP_FREE_NOTICE[status];
  const withField = { ...briefing, stepFree: status, stepFreeNotice: notice };
  if (includeGeometry) return withField;
  return { ...withField, steps: [{ description: notice }, ...briefing.steps] };
}
```

- [ ] **Step 5: `getWalkRoute`의 세 호출부에 인자를 넘긴다**

`getWalkRoute` 안 `withStepFree(...)` 세 곳에 `includeGeometry`를 세 번째 인자로 추가한다:

```ts
    return r.briefing ? withStepFree(annotate(r.briefing), "unavailable", includeGeometry) : null;
```
```ts
    return withStepFree(annotate(r.briefing), hasStairs ? "no_stepfree_route" : "applied", includeGeometry);
```
```ts
  return withStepFree(
    annotate(base.briefing),
    base.via === "tmap" ? "unavailable" : "no_stepfree_route",
    includeGeometry,
  );
```

- [ ] **Step 6: 테스트 통과를 확인한다**

Run: `npx vitest run src/lib/__tests__/walk-route.test.ts`
Expected: PASS (신규 3건 포함 전량)

- [ ] **Step 7: 전체 게이트**

Run: `npm run test:run && npm run lint`
Expected: 전량 green, lint 0 errors

- [ ] **Step 8: 커밋**

```bash
git add src/lib/types.ts src/lib/walk-route.ts src/lib/__tests__/walk-route.test.ts && git commit -m "$(cat <<'EOF'
feat(walk): 기하 응답에는 계단 회피 문장을 스텝이 아니라 필드로 내린다

buildGuideRoute는 기하 없는 스텝을 만나면 경로 전체를 거부한다(웹·Kit
동일). 그래서 안내가 accessible을 싣기 시작하면, 무계단 경로가 없는
순간 상세 안내가 통째로 간략으로 조용히 강등된다. includeGeometry=1
응답에서 유사 스텝을 빼고 stepFreeNotice 필드로 같은 문장을 전달한다.

산문 소비자(브리핑·채팅·CLI)는 steps 배열과 기존 필드가 불변이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)" -- src/lib/types.ts src/lib/walk-route.ts src/lib/__tests__/walk-route.test.ts && git show HEAD --stat
```

---

## Task 2: 서버 — D1 두 건과 분기 곱 보강

**Files:**
- Modify: `src/lib/walk-route.ts` (`STEP_FREE_NOTICE` 약 37-43행)
- Test: `src/lib/__tests__/walk-route.test.ts`

**Interfaces:**
- Consumes: T1의 `withStepFree(briefing, status, includeGeometry)`
- Produces: 없음(문구·테스트만)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
describe("계단 회피 안내 문장의 정확성과 분기 곱", () => {
  // ⚠ 부정 검사("일반 경로를 안내합니다" 미포함)로 대신하지 않는다 —
  //    빈 문자열·문구 교환이 전부 통과한다(codex M18).
  it("no_stepfree_route 문장은 어느 경로를 반환하는지 단정하지 않는다", async () => {
    // ACCESSIBLE 응답에 계단 문구 잔존 → fail-closed 강등. 반환은 ACCESSIBLE 경로다.
    mockKakaoWalk.mockResolvedValueOnce(briefingWithStairs());

    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });

    expect(r?.stepFree).toBe("no_stepfree_route");
    expect(r?.stepFreeNotice).toBe(
      "계단 없는 경로를 확정하지 못했습니다. 안내 경로에 계단이 포함될 수 있습니다.",
    );
  });

  it("unavailable 문장은 종전 그대로다(실제로 일반 경로를 반환하므로 참)", async () => {
    mockKakaoWalk.mockRejectedValueOnce(new Error("카카오 장애"));
    mockTmapWalk.mockResolvedValueOnce(briefingWithGeometry(2));

    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });

    expect(r?.stepFree).toBe("unavailable");
    expect(r?.stepFreeNotice).toBe(
      "계단 회피 경로를 조회하지 못했습니다. 일반 경로를 안내하며 계단이 포함될 수 있습니다.",
    );
  });

  // via==="tmap"과 계단 문구가 동시에 참인 칸. 개별 fixture로는 분기 순서 버그
  // (정답 unavailable인데 no_stepfree_route로 새는 것)를 못 잡는다(codex M13).
  it("Tmap 폴백 경로에 계단 문구가 있어도 unavailable이다", async () => {
    mockKakaoWalk.mockRejectedValueOnce(new Error("카카오 장애"));
    mockTmapWalk.mockResolvedValueOnce(briefingWithStairs());

    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });

    expect(r?.stepFree).toBe("unavailable");
  });

  // D1-a: 무계단 부재 → 기본 모드 재호출이 throw하면 전파된다(502의 근원).
  it("무계단 부재 후 기본 모드 재호출이 실패하면 throw한다", async () => {
    mockKakaoWalk
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("재호출 실패"));
    mockTmapWalk.mockRejectedValueOnce(new Error("Tmap도 실패"));

    await expect(
      getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true }),
    ).rejects.toThrow();
  });

  it("첫 ACCESSIBLE 호출이 throw하면 Tmap 폴백을 거쳐 unavailable이 된다", async () => {
    mockKakaoWalk.mockRejectedValueOnce(new Error("카카오 장애"));
    mockTmapWalk.mockResolvedValueOnce(briefingWithGeometry(2));

    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });

    expect(r?.stepFree).toBe("unavailable");
  });
});
```

⚠ `briefingWithStairs()`는 `description`에 `"계단"`을 포함하는 스텝을 가진 fixture다.

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run src/lib/__tests__/walk-route.test.ts -t "정확성과 분기 곱"`
Expected: 첫 테스트 FAIL(문장이 아직 "계단 없는 경로를 찾지 못해 일반 경로를 안내합니다…"), D1-a 테스트는 통과하거나 실패 — **어느 쪽이든 실행 결과를 기록한다**(통과하면 "이미 동작하나 무테스트였다"가 확인된 것이고, 그 사실 자체가 D1-a의 내용이다).

- [ ] **Step 3: 문구를 고친다**

`src/lib/walk-route.ts`의 `STEP_FREE_NOTICE`:

```ts
/** 계단 회피 미적용 시 전달하는 안전 문장(모든 소비자 결정론 전달). */
const STEP_FREE_NOTICE: Record<Exclude<StepFreeStatus, "applied">, string> = {
  // ⚠ 이 상태는 두 분기가 공유한다: ACCESSIBLE 응답의 계단 문구 잔존(fail-closed —
  // 반환은 ACCESSIBLE 경로)과 무계단 경로 부재 후 기본 모드 재호출(반환은 일반 경로).
  // 그래서 어느 경로를 반환하는지 단정하지 않는다 — 문장의 역할은 경로 설명이
  // 아니라 계단 경고다(spec §2.6, 종전 "일반 경로를 안내합니다"는 앞 분기에서 거짓).
  no_stepfree_route:
    "계단 없는 경로를 확정하지 못했습니다. 안내 경로에 계단이 포함될 수 있습니다.",
  // 이 분기는 실제로 일반 경로를 반환하므로 종전 문장이 참이다.
  unavailable:
    "계단 회피 경로를 조회하지 못했습니다. 일반 경로를 안내하며 계단이 포함될 수 있습니다.",
};
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npm run test:run`
Expected: 전량 green. ⚠ 기존 테스트가 옛 문장을 문자열로 단언하고 있으면 함께 갱신한다(`grep -rn "일반 경로를 안내합니다" src`로 전수 확인).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/walk-route.ts src/lib/__tests__/walk-route.test.ts && git commit -m "$(cat <<'EOF'
fix(walk): 계단 회피 강등 문장이 두 분기 모두에서 참이 되게 한다 (D1)

no_stepfree_route는 두 분기가 공유한다. ACCESSIBLE 응답에 계단 문구가
남아 fail-closed로 강등되는 쪽은 실제로 ACCESSIBLE 경로를 반환하는데,
문장은 "일반 경로를 안내합니다"라고 말하고 있었다. 어느 경로를
반환하는지 단정하지 않는 문장으로 바꾼다 - 이 문장의 역할은 경로
설명이 아니라 계단 경고다. unavailable은 실제로 일반 경로를 반환하므로
종전 문장이 참이라 건드리지 않는다.

무계단 부재 후 기본 모드 재호출 throw 경로에 테스트를 더했다(D1-a).
via=tmap과 계단 문구가 동시에 참인 칸도 채워 분기 순서 버그를 막는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)" -- src/lib/walk-route.ts src/lib/__tests__/walk-route.test.ts && git show HEAD --stat
```

---

## Task 3: 웹 — 도보 조회 URL 단일 조립점

**Files:**
- Create: `src/lib/walk-route-url.ts`
- Create: `src/lib/__tests__/walk-route-url.test.ts`
- Modify: `src/components/DirectionsView.tsx` (`fetchMode` 116-145행, 호출부 462행)

**Interfaces:**
- Consumes: 없음
- Produces: `walkRouteUrl(params: { origin: Coord; dest: Coord; accessible: boolean; includeGeometry: boolean }): string` — 인자 전부 required.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/__tests__/walk-route-url.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { walkRouteUrl } from "../walk-route-url";

const ORIGIN = { lat: 37.5, lng: 127.1 };
const DEST = { lat: 37.6, lng: 127.2 };

describe("walkRouteUrl", () => {
  it("기본: 좌표만 붙인다(옵트인 파라미터 부재 = 기존 캐시 경로 유지)", () => {
    expect(walkRouteUrl({ origin: ORIGIN, dest: DEST, accessible: false, includeGeometry: false }))
      .toBe("/api/route/walk?origin=37.5,127.1&dest=37.6,127.2");
  });

  it("계단 회피만", () => {
    expect(walkRouteUrl({ origin: ORIGIN, dest: DEST, accessible: true, includeGeometry: false }))
      .toBe("/api/route/walk?origin=37.5,127.1&dest=37.6,127.2&accessible=true");
  });

  it("기하만", () => {
    expect(walkRouteUrl({ origin: ORIGIN, dest: DEST, accessible: false, includeGeometry: true }))
      .toBe("/api/route/walk?origin=37.5,127.1&dest=37.6,127.2&includeGeometry=1");
  });

  it("둘 다 — A4 수정 이전에는 존재하지 않던 조합이다", () => {
    expect(walkRouteUrl({ origin: ORIGIN, dest: DEST, accessible: true, includeGeometry: true }))
      .toBe("/api/route/walk?origin=37.5,127.1&dest=37.6,127.2&accessible=true&includeGeometry=1");
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run src/lib/__tests__/walk-route-url.test.ts`
Expected: FAIL — `Cannot find module '../walk-route-url'`

- [ ] **Step 3: 빌더를 만든다**

`src/lib/walk-route-url.ts`:

```ts
import type { Coord } from "./types";

/**
 * 도보 경로 조회 URL의 단일 조립점(브리핑·실시간 안내 공용).
 *
 * ⚠ **인자를 전부 required로 두는 것이 이 모듈의 존재 이유다.** 백로그 A4는
 * "생략 가능한 안전 인자"가 만든 결함이었다 — 안내 조회가 `accessible`을 빠뜨려도
 * 아무 오류가 나지 않아, 계단 회피를 켠 사용자가 계단으로 안내받았다(spec §2.5).
 *
 * ⚠ 좌표 구분자는 인코딩하지 않은 쉼표다(`URLSearchParams`는 `%2C`로 바꾼다).
 * 기능은 같지만 URL 문자열이 달라져 기존 캐시 키와 테스트 단언이 어긋난다.
 * 옵트인 파라미터는 꺼짐이면 붙이지 않는다 — 기존 캐시 경로 유지.
 */
export function walkRouteUrl(params: {
  origin: Coord;
  dest: Coord;
  accessible: boolean;
  includeGeometry: boolean;
}): string {
  const { origin, dest, accessible, includeGeometry } = params;
  let url = `/api/route/walk?origin=${origin.lat},${origin.lng}&dest=${dest.lat},${dest.lng}`;
  if (accessible) url += "&accessible=true";
  if (includeGeometry) url += "&includeGeometry=1";
  return url;
}
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npx vitest run src/lib/__tests__/walk-route-url.test.ts`
Expected: PASS (4건)

- [ ] **Step 5: `fetchMode`가 빌더를 쓰고 인자를 required로 바꾼다**

`src/components/DirectionsView.tsx` 상단에 `import { walkRouteUrl } from "@/lib/walk-route-url";`를 더하고, `fetchMode`의 시그니처와 URL 조립을 교체:

```ts
async function fetchMode(
  mode: ModeKey,
  origin: Coord,
  dest: Coord,
  lang: "ko" | "en",
  signal: AbortSignal,
  /**
   * 계단 회피(도보 전용). ⚠ **선택 인자로 두지 않는다** — A4가 생략 가능한 안전
   * 인자에서 나왔다(spec §2.5). 도보가 아닌 수단은 `false`를 명시한다.
   */
  walkAccessible: boolean,
): Promise<ModeOutcome> {
  const qs = `origin=${origin.lat},${origin.lng}&dest=${dest.lat},${dest.lng}`;
  if (mode === "car") {
    const res = await fetch(`/api/route/car?${qs}&lang=${lang}`, { signal });
    if (!res.ok) return { kind: "error" };
    const body = await res.json();
    if (isOutOfCoverageBody(body)) return { kind: "outOfCoverage" };
    return { kind: "done", mode, result: body as CarRouteBriefing };
  }
  // 대중교통은 경유 정류장 옵트인(B2 §7) — 실시간 안내(승차·하차 정류소 ID·좌표)의
  // 유일한 데이터원이고, 시작 시 재조회 없이 브리핑과 같은 경로를 안내한다(§2).
  const url =
    mode === "walk"
      ? walkRouteUrl({ origin, dest, accessible: walkAccessible, includeGeometry: false })
      : `/api/route/transit?${qs}&includeStops=1`;
  const res = await fetch(url, { signal });
  if (!res.ok) return { kind: "error" };
  const body = (await res.json()) as { result: unknown };
  if (isOutOfCoverageBody(body)) return { kind: "outOfCoverage" };
  if (!body.result) return { kind: "empty" };
  return mode === "transit"
    ? { kind: "done", mode, result: body.result as TransitData }
    : { kind: "done", mode, result: body.result as WalkRouteBriefing };
}
```

호출부(약 462행)는 이미 `stepFreeRef.current`를 넘기고 있으므로 그대로 두면 required를 만족한다.

- [ ] **Step 6: 게이트**

Run: `npm run test:run && npm run lint && npx tsc --noEmit`
Expected: 전량 green. ⚠ Vitest는 트랜스파일만 하므로 **`tsc --noEmit`을 반드시 함께 돌린다** — required 인자 전환은 타입 검사에서만 드러난다([[vitest-green-does-not-typecheck]]).

- [ ] **Step 7: 커밋**

```bash
git add src/lib/walk-route-url.ts src/lib/__tests__/walk-route-url.test.ts src/components/DirectionsView.tsx && git commit -m "$(cat <<'EOF'
refactor(walk): 도보 조회 URL을 단일 조립점으로 모으고 인자를 required로

A4는 생략 가능한 안전 인자가 만든 결함이다. 브리핑과 실시간 안내가
같은 URL 계약을 각자 조립하고 있었고, 안내 쪽만 accessible을
빠뜨려도 아무 오류가 나지 않았다. walkRouteUrl로 모으고 인자를 전부
required로 둬 다음 소비자가 같은 방식으로 생략할 수 없게 한다.

fetchMode의 walkAccessible도 선택에서 필수로 바꿨다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)" -- src/lib/walk-route-url.ts src/lib/__tests__/walk-route-url.test.ts src/components/DirectionsView.tsx && git show HEAD --stat
```

---

## Task 4: 웹 — 안내 세션이 계단 회피를 조회에 싣는다 (A4 본체)

**Files:**
- Modify: `src/hooks/useRouteGuide.ts` (시그니처 252행, ref 미러 `useEffect` 약 1155행, 도보 fetch 약 570행)
- Modify: `src/components/DistanceBeacon.tsx` (props 약 40-70행)
- Modify: `src/components/DirectionsView.tsx` (`<DistanceBeacon>` 739·772·781행)
- Modify: `src/components/PlaceDetail.tsx` (208행), `src/components/TransitGuidePanel.tsx` (365행)
- Test: `src/hooks/__tests__/useRouteGuide.stepfree.test.tsx` (신규)

**Interfaces:**
- Consumes: `walkRouteUrl` (T3)
- Produces: `useRouteGuide(dest, kind, accessible: boolean)` — 3번째 인자 required. `DistanceBeacon`의 `accessible: boolean` prop required.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/hooks/__tests__/useRouteGuide.stepfree.test.tsx`(신규). 기존 `useRouteGuide.car.test.tsx`의 렌더·geolocation 목 관례를 그대로 따른다:

```tsx
// @vitest-environment jsdom
/**
 * 계단 회피가 안내 경로 조회에 실리는가(백로그 A4). 봉인이 아니라 **조회 시점
 * 판독**이라는 계약을 함께 못 박는다 — 웹 useState 초기값은 컴포넌트 마운트
 * 수명이지 세션 수명이 아니다(spec §2.2, codex C2).
 */
describe("계단 회피가 안내 조회에 실린다", () => {
  it("세션 시작 요청에 accessible=true가 붙는다", async () => {
    const { result } = renderGuide({ accessible: true });
    act(() => result.current.start());
    await settleFirstFix();

    expect(walkFetchUrls()).toContainEqual(
      expect.stringContaining("accessible=true"),
    );
  });

  it("이탈 재조회도 그 시점 값을 읽는다", async () => {
    const { result } = renderGuide({ accessible: true });
    act(() => result.current.start());
    await settleFirstFix();
    fetchSpy.mockClear();

    act(() => result.current.requestReroute());
    await settleFetch();

    expect(walkFetchUrls()).toContainEqual(
      expect.stringContaining("accessible=true"),
    );
  });

  // ⚠ 같은 마운트에서 값이 바뀌는 시나리오여야 한다. prop을 처음부터 true로 두면
  //   초기값 고정과 조회 시점 판독이 같은 값을 내 변이 M8이 관측 불가가 된다.
  it("세션 종료 후 값이 바뀌면 다음 세션이 새 값을 쓴다", async () => {
    const { result, rerender } = renderGuide({ accessible: false });
    act(() => result.current.start());
    await settleFirstFix();
    act(() => result.current.stop());

    rerender({ accessible: true });
    fetchSpy.mockClear();
    act(() => result.current.start());
    await settleFirstFix();

    expect(walkFetchUrls()).toContainEqual(
      expect.stringContaining("accessible=true"),
    );
  });
});
```

⚠ `renderGuide`·`settleFirstFix`·`walkFetchUrls`는 이 파일의 로컬 헬퍼로 만든다. `walkFetchUrls()`는 `fetchSpy.mock.calls`에서 `/api/route/walk`로 시작하는 URL만 뽑는다. ⚠ **fake timer를 쓰면 `waitFor` 금지**이고 `toFake`에 `"performance"`를 넣는다(훅의 시각축이 `performance.now()`라 타이머만 진행시키면 경과가 0으로 남는다).

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run src/hooks/__tests__/useRouteGuide.stepfree.test.tsx`
Expected: FAIL — 요청 URL에 `accessible`이 없다(A4 본체 재현).

- [ ] **Step 3: 훅이 3번째 인자를 받아 ref로 보관한다**

`src/hooks/useRouteGuide.ts`:

```ts
export function useRouteGuide(
  dest: RouteGuideDest,
  kind: GuideKind = "walk",
  /**
   * 계단 회피(도보 전용). ⚠ **봉인하지 않는다** — `useState` 초기값 고정은
   * *컴포넌트 마운트* 수명이라 세션 종료 후 값이 바뀌어도 같은 마운트에서는 옛
   * 값이 남는다(spec §2.2). 매 렌더 갱신되는 ref로 두고 조회 직전에 읽는다.
   */
  accessible: boolean = false,
): RouteGuideApi {
```

⚠ 기본값 `= false`는 `DistanceBeacon` 한 곳만 이 훅을 호출하고 그 prop이 required라 실질 위험이 없으나, **T4 Step 5에서 기본값을 제거한다**(아래).

ref 선언은 `destRef` 옆에:

```ts
  /** 계단 회피 최신값(조회 시점 판독 — spec §2.2). */
  const accessibleRef = useRef(accessible);
```

매 렌더 미러 `useEffect`(약 1155행, `destRef.current = dest;`가 있는 블록)에 한 줄:

```ts
    accessibleRef.current = accessible;
```

⚠ 그 `useEffect`에는 의존성 배열이 없다(매 렌더 실행) — 그대로 둔다.

- [ ] **Step 4: 도보 fetch가 빌더를 쓰고 값을 싣는다**

`src/hooks/useRouteGuide.ts` 상단에 `import { walkRouteUrl } from "@/lib/walk-route-url";`를 더하고, 도보 분기(약 570행)를 교체:

```ts
      const res = await fetch(
        walkRouteUrl({
          origin: { lat: geo.coords.lat, lng: geo.coords.lng },
          dest: { lat: target.lat, lng: target.lng },
          accessible: accessibleRef.current,
          includeGeometry: true,
        }),
      );
```

- [ ] **Step 5: prop을 required로 배선한다**

`src/components/DistanceBeacon.tsx`의 props에 추가(선택 아님):

```ts
  /**
   * 계단 회피(도보 전용). ⚠ required다 — A4가 생략 가능한 안전 인자에서 나왔다
   * (spec §2.5). 토글이 없는 진입점(장소 상세·대중교통 인계)은 `false`를 명시한다.
   */
  accessible: boolean;
```

그리고 `const guide = useRouteGuide(dest, kind);` → `const guide = useRouteGuide(dest, kind, accessible);`

훅 시그니처의 `= false` 기본값을 제거한다(`accessible: boolean,`).

호출부 5곳:

| 파일·행 | 추가할 prop |
|---|---|
| `DirectionsView.tsx:739` 간략 폴백 | `accessible={stepFreeEnabled}` |
| `DirectionsView.tsx:772` 도보 | `accessible={stepFreeEnabled}` |
| `DirectionsView.tsx:781` 자동차 | `accessible={false}` |
| `PlaceDetail.tsx:208` | `accessible={false}` |
| `TransitGuidePanel.tsx:365` | `accessible={false}` |

⚠ 간략 폴백에도 도보 값을 싣는다 — 그 세션도 시작 시 상세 조회를 시도한다(폴백 판정은 브리핑 조회 결과이지 안내 조회 결과가 아니다).

- [ ] **Step 6: 게이트**

Run: `npm run test:run && npm run lint && npx tsc --noEmit`
Expected: 전량 green. required prop 누락은 `tsc`가 잡는다.

- [ ] **Step 7: 커밋**

```bash
git add src/hooks/useRouteGuide.ts src/components/DistanceBeacon.tsx src/components/DirectionsView.tsx src/components/PlaceDetail.tsx src/components/TransitGuidePanel.tsx src/hooks/__tests__/useRouteGuide.stepfree.test.tsx && git commit -m "$(cat <<'EOF'
fix(walk): 실시간 안내가 계단 회피를 경로 조회에 싣는다 (웹, A4)

브리핑에서 계단 회피를 켠 뒤 안내를 시작하면 안내가 따라가는 경로는
계단 회피가 꺼진 기본 경로였다. 화면과 귀가 다른 경로를 가리키는데
어느 쪽도 오류를 내지 않아 실패가 조용했다.

값은 봉인하지 않고 조회 시점에 읽는다. useState 초기값 고정은
컴포넌트 마운트 수명이라 세션 종료 후 토글을 바꿔도 같은 마운트에서는
옛 값이 남는다 - 세션 사이에 값이 바뀌는 시나리오를 테스트가 덮는다.

DistanceBeacon의 prop과 훅 인자를 required로 뒀다. 토글이 없는
진입점이 false를 명시하는 것은 잉여가 아니라 그 사실의 선언이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)" -- src/hooks/useRouteGuide.ts src/components/DistanceBeacon.tsx src/components/DirectionsView.tsx src/components/PlaceDetail.tsx src/components/TransitGuidePanel.tsx src/hooks/__tests__/useRouteGuide.stepfree.test.tsx && git show HEAD --stat
```

---

## Task 5: 웹 — 열화 상태로의 전이에서 1회 통지

**Files:**
- Modify: `src/hooks/useRouteGuide.ts` (도보 fetch 반환값 약 575-590행, 시작 성공 약 930-960행, 재조회 성공 약 1108-1138행, `start` 초기화 약 900행)
- Test: `src/hooks/__tests__/useRouteGuide.stepfree.test.tsx`

**Interfaces:**
- Consumes: T1의 `stepFreeNotice` 필드, T4의 `accessibleRef`
- Produces: 없음(훅 내부)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

같은 파일에 추가:

```tsx
describe("계단 회피 열화 통지", () => {
  it("시작 조회가 열화면 시작 발화와 한 문자열로 결합해 통지한다", async () => {
    walkResponse({ stepFree: "no_stepfree_route", stepFreeNotice: NOTICE });
    const { result } = renderGuide({ accessible: true });
    act(() => result.current.start());
    await settleFirstFix();

    expect(result.current.liveText).toContain(NOTICE);
    // ⚠ 두 번 set 하지 않는다 — React 배칭이 첫 발화를 삼키거나 두 번째가 첫
    //   낭독을 끊는다(codex H6). 요약도 같은 문자열에 있어야 한다.
    expect(result.current.liveText).toMatch(/총 \d+단계/);
  });

  it("applied면 통지하지 않는다", async () => {
    walkResponse({ stepFree: "applied" });
    const { result } = renderGuide({ accessible: true });
    act(() => result.current.start());
    await settleFirstFix();

    expect(result.current.liveText).not.toContain("계단");
  });

  // codex C1이 지목한 놓친 변이: 시작은 정상인데 재조회에서 열화로 바뀌는 경로.
  it("시작 applied → 재조회 열화 전이에서 통지한다", async () => {
    walkResponse({ stepFree: "applied" });
    const { result } = renderGuide({ accessible: true });
    act(() => result.current.start());
    await settleFirstFix();

    walkResponse({ stepFree: "no_stepfree_route", stepFreeNotice: NOTICE });
    act(() => result.current.requestReroute());
    await settleFetch();

    expect(result.current.liveText).toContain(NOTICE);
  });

  it("같은 열화 상태가 이어지면 재통지하지 않는다", async () => {
    walkResponse({ stepFree: "no_stepfree_route", stepFreeNotice: NOTICE });
    const { result } = renderGuide({ accessible: true });
    act(() => result.current.start());
    await settleFirstFix();

    act(() => result.current.requestReroute());
    await settleFetch();

    expect(result.current.liveText).not.toContain(NOTICE);
  });

  it("기하 빌드 실패로 간략 폴백되면 통지하지 않고 상태가 초기화된다", async () => {
    walkResponseRaw({ result: null });
    const { result } = renderGuide({ accessible: true });
    act(() => result.current.start());
    await settleFirstFix();
    expect(result.current.liveText).not.toContain(NOTICE);

    // 복구된 상세 경로가 열화면 다시 통지된다(새 경로에 대한 새 판정).
    walkResponse({ stepFree: "no_stepfree_route", stepFreeNotice: NOTICE });
    act(() => result.current.requestReroute());
    await settleFetch();
    expect(result.current.liveText).toContain(NOTICE);
  });
});
```

`const NOTICE = "계단 없는 경로를 확정하지 못했습니다. 안내 경로에 계단이 포함될 수 있습니다.";`

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run src/hooks/__tests__/useRouteGuide.stepfree.test.tsx -t "열화 통지"`
Expected: FAIL — `liveText`에 문장이 없다.

- [ ] **Step 3: fetch 반환값에 상태를 싣는다**

도보 분기의 반환을 교체(약 580행):

```ts
      return {
        route,
        durationSeconds:
          Number.isFinite(result.durationSeconds) && result.durationSeconds > 0
            ? result.durationSeconds
            : null,
        roadSpans: [],
        stepFree: result.stepFree ?? null,
        stepFreeNotice: result.stepFreeNotice ?? null,
      };
```

car 분기의 반환에도 `stepFree: null, stepFreeNotice: null`을 더한다(자동차에 계단 회피 개념이 없다는 사실을 타입이 말하게 한다).

- [ ] **Step 4: 전이 판정 헬퍼와 상태를 만든다**

ref 선언(`accessibleRef` 옆):

```ts
  /** 직전 계단 회피 판정(열화 전이 통지의 기준 — spec §2.3). */
  const lastStepFreeRef = useRef<StepFreeStatus | null>(null);
```

`announce` 아래에 헬퍼:

```ts
  /**
   * 열화 전이 판정(spec §2.3). 상태가 열화이고 **직전과 다를 때만** 문장을 돌려준다.
   * 직전 상태를 갱신하는 부작용이 있으므로 **조회 성공 경로에서 정확히 1회** 부른다.
   * 기하 빌드까지 성공한 뒤에 불러야 한다 — "조회 성공"의 시점이 HTTP·디코딩·기하
   * 셋으로 갈리는데 가장 늦은 것이 정본이다(codex H5).
   */
  const consumeStepFreeNotice = useCallback(
    (status: StepFreeStatus | null, notice: string | null): string | null => {
      const prev = lastStepFreeRef.current;
      lastStepFreeRef.current = status;
      if (!status || status === "applied" || status === prev) return null;
      return notice;
    },
    [],
  );
```

- [ ] **Step 5: 두 성공 경로에서 결합 발화한다**

시작 성공(약 955행)의 `announce(...)`를 교체:

```ts
      const notice = consumeStepFreeNotice(fetched.stepFree, fetched.stepFreeNotice);
      const summary = t(kindFixed === "car" ? "carStart" : "detailStart", {
        count: route.steps.length,
        distance: formatDistance(route.totalMeters),
        first,
      });
      // 안내 문장이 앞이다 — 세션 전체에 걸린 조건이라 걷기 전에 들어야 한다.
      announce(notice ? `${notice} ${summary}` : summary);
```

재조회 성공(약 1136행)의 `announce(first);`를 교체:

```ts
        const notice = consumeStepFreeNotice(fetched.stepFree, fetched.stepFreeNotice);
        announce(notice ? `${notice} ${first}` : first);
```

- [ ] **Step 6: 폴백·시작에서 상태를 초기화한다**

`start` 초기화 블록(약 905행, `lastGuidanceRef.current = null;` 옆)에:

```ts
    lastStepFreeRef.current = null;
```

시작 폴백(`announce(t("detailUnavailable"));` 직전)과 재조회 실패(`announce(t("rerouteFailed"));` 직전)에 각각:

```ts
        // 경로가 없으면 경로 기반 계단 판정도 없다(3-state). 복구된 상세가 열화면
        // 그때 다시 통지된다 — 새 경로에 대한 새 판정이므로 반복이 아니다.
        lastStepFreeRef.current = null;
```

- [ ] **Step 7: 테스트 통과를 확인한다**

Run: `npm run test:run && npm run lint && npx tsc --noEmit`
Expected: 전량 green

- [ ] **Step 8: 커밋**

```bash
git add src/hooks/useRouteGuide.ts src/hooks/__tests__/useRouteGuide.stepfree.test.tsx && git commit -m "$(cat <<'EOF'
feat(walk): 계단 회피 열화를 상태 전이에서 1회 통지한다 (웹)

안내 세션은 브리핑과 다른 출발지로 경로를 다시 뽑으므로 계단 회피
판정이 브리핑과 달라질 수 있다. 그래서 통지 조건은 "세션 시작"이
아니라 "열화 상태로의 전이"다 - 시작 조회가 정상이었다가 이탈
재조회에서 무계단 경로가 사라지는 경로가 종전 설계의 사각이었다.

발화는 시작·재조회 문장과 한 문자열로 결합한다. 두 번 set 하면 React
배칭이 첫 발화를 삼키거나 두 번째가 첫 낭독을 끊는다.

간략 폴백에서는 상태를 초기화한다. 경로가 없으면 경로 기반 계단
판정도 없고, 복구된 상세가 열화면 새 판정으로 다시 통지된다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)" -- src/hooks/useRouteGuide.ts src/hooks/__tests__/useRouteGuide.stepfree.test.tsx && git show HEAD --stat
```

---

## Task 6: Kit — 응답 필드 디코딩 (전방 호환)

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift` (247-255행)
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/RouteModelsTests.swift`(없으면 신규)

**Interfaces:**
- Consumes: T1의 응답 계약
- Produces: `WalkRouteBriefing.stepFree: String?`, `.stepFreeNotice: String?`, 계산 프로퍼티 `.stepFreeStatus: StepFreeStatus?`, `public enum StepFreeStatus: String`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```swift
@Suite("도보 브리핑의 계단 회피 필드")
struct WalkRouteBriefingStepFreeTests {
    private func decode(_ json: String) throws -> WalkRouteBriefing {
        try JSONDecoder().decode(WalkRouteBriefing.self, from: Data(json.utf8))
    }

    @Test("필드가 없으면 판정 없음이다(구버전 서버 응답)")
    func absent() throws {
        let b = try decode(#"{"distanceMeters":100,"durationSeconds":60,"steps":[]}"#)
        #expect(b.stepFreeStatus == nil)
        #expect(b.stepFreeNotice == nil)
    }

    @Test("알려진 상태를 매핑한다")
    func known() throws {
        let b = try decode(#"""
        {"distanceMeters":100,"durationSeconds":60,"steps":[],
         "stepFree":"no_stepfree_route","stepFreeNotice":"계단이 포함될 수 있습니다."}
        """#)
        #expect(b.stepFreeStatus == .noStepFreeRoute)
        #expect(b.stepFreeNotice == "계단이 포함될 수 있습니다.")
    }

    /// ⚠ raw enum으로 직접 디코딩하면 서버가 넷째 상태를 추가할 때
    /// `WalkRouteBriefing` **전체**가 깨진다(spec §2.4). 모르는 값은 "판정 없음"이다.
    @Test("미지의 상태 문자열이 브리핑 전체를 깨뜨리지 않는다")
    func unknownStatusDoesNotBreakDecoding() throws {
        let b = try decode(#"""
        {"distanceMeters":100,"durationSeconds":60,"steps":[],"stepFree":"partially_applied"}
        """#)
        #expect(b.distanceMeters == 100)
        #expect(b.stepFreeStatus == nil)
    }
}
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `cd ios/GildongmuKit && swift test --filter WalkRouteBriefingStepFree`
Expected: FAIL — `stepFreeStatus`·`StepFreeStatus`가 없어 컴파일 실패

- [ ] **Step 3: 열거형과 필드를 더한다**

`RouteModels.swift`의 `WalkRouteBriefing` 바로 위에:

```swift
/// 계단 회피 적용 상태(웹 `StepFreeStatus` 미러 — applied·no_stepfree_route·unavailable).
public enum StepFreeStatus: String, Codable, Sendable, Hashable {
    case applied
    case noStepFreeRoute = "no_stepfree_route"
    case unavailable
}
```

`WalkRouteBriefing`을 교체:

```swift
/// 도보 경로 브리핑(자동차 CarRouteBriefing과 동형, 지도 없이 완결되는 텍스트 정본).
public struct WalkRouteBriefing: Codable, Sendable, Hashable {
    /// 총 거리(m)
    public let distanceMeters: Int
    /// 총 소요(초)
    public let durationSeconds: Int
    /// 안내 단계들
    public let steps: [WalkRouteStep]
    /// 계단 회피 판정(원시 문자열). `accessible` 요청에만 존재한다.
    /// ⚠ **raw enum으로 디코딩하지 않는다** — 서버가 넷째 상태를 추가하면
    /// 브리핑 전체의 디코딩이 실패한다(spec §2.4). 판독은 `stepFreeStatus`가 한다.
    public let stepFree: String?
    /// 열화 상태의 안내 문장(서버 정본). `applied`이거나 미요청이면 nil.
    /// ⚠ `includeGeometry=1` 응답에는 유사 스텝이 없으므로 이것이 유일한 채널이다.
    public let stepFreeNotice: String?

    /// 알려진 상태만 매핑하고 미지의 값은 nil("판정 없음")이다.
    public var stepFreeStatus: StepFreeStatus? {
        stepFree.flatMap(StepFreeStatus.init(rawValue:))
    }
}
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `cd ios/GildongmuKit && swift test`
Expected: 전량 PASS. ⚠ `WalkRouteBriefing`을 memberwise init으로 만드는 기존 코드가 있으면 새 인자 두 개를 넘기도록 함께 고친다(컴파일러가 지목한다).

- [ ] **Step 5: 커밋**

```bash
git add ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift ios/GildongmuKit/Tests/GildongmuKitTests/RouteModelsTests.swift && git commit -m "$(cat <<'EOF'
feat(ios): 도보 브리핑에 계단 회피 판정 필드를 더한다

iOS는 stepFree 필드를 아예 디코딩하지 않아, 계단 회피 상태를 아는
유일한 채널이 서버가 삽입한 산문 스텝이었다. 기하 응답에서 그 스텝이
빠지므로 필드 디코딩이 전제다.

원시 문자열로 받고 계산 프로퍼티가 매핑한다. raw enum으로 직접
디코딩하면 서버가 넷째 상태를 추가할 때 브리핑 전체가 깨진다.
두 필드 모두 옵셔널이라 구버전 서버 응답에서도 디코딩된다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)" -- ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift ios/GildongmuKit/Tests/GildongmuKitTests/RouteModelsTests.swift && git show HEAD --stat
```

---

## Task 7: iOS — 안내가 계단 회피를 싣고 열화를 통지한다

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RouteService.swift:64` (기본값 제거)
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift` (`toggle` 206행, `start` 218행, `fetchDetailData` 327-352행, 성공 발화 385-399행, `fallbackToBrief` 448행)
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift` (`service.walk` 351행, `beacon.toggle` 471·489·522·532·717행)

**Interfaces:**
- Consumes: T6의 `WalkRouteBriefing.stepFreeStatus`·`.stepFreeNotice`
- Produces: `BeaconModel.toggle(dest:label:kind:accessible:)` — `accessible` required

- [ ] **Step 1: Kit에서 기본값을 제거한다**

`RouteService.swift`의 `walk`:

```swift
    /// includeGeometry=true는 스텝 폴리라인 보존 옵트인(웹 `?includeGeometry=1` 계약,
    /// 실시간 상세 안내 전용).
    /// ⚠ `accessible`에 **기본값을 두지 않는다** — 백로그 A4는 이 기본값이 만든
    /// 결함이었다. 안내 조회가 인자를 생략해도 컴파일이 통과해, 계단 회피를 켠
    /// 사용자가 계단으로 안내받았다(spec §2.5).
    public func walk(
        originLat: Double, originLng: Double,
        destLat: Double, destLng: Double,
        accessible: Bool,
        includeGeometry: Bool = false
    ) async throws -> WalkRouteBriefing? {
```

- [ ] **Step 2: 빌드해 컴파일 실패를 확인한다**

Run: `cd ios/GildongmuKit && swift build`
Expected: Kit 자체는 성공. 이어서 iOS 빌드가 호출부 2곳에서 실패해야 한다:

Run: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -configuration Experimental -destination 'generic/platform=iOS Simulator' build 2>&1 | grep -E "error:"`
Expected: `BeaconModel.swift:341` missing argument for parameter 'accessible' — **A4가 컴파일 오류로 드러나는 순간이다.**

- [ ] **Step 3: `BeaconModel`이 값을 보관하고 싣는다**

`toggle`과 `start`의 시그니처에 `accessible: Bool`을 더하고(기본값 없음) 모델 필드에 저장:

```swift
    /// 이 세션의 계단 회피(도보 전용). iOS는 추적 중 시트가 화면을 덮어 토글에
    /// 도달할 수 없으므로 시작 시 전달값이 세션 내내 유효하다(spec §2.2).
    private var accessible = false
    /// 직전 계단 회피 판정(열화 전이 통지 기준 — spec §2.3).
    private var lastStepFree: StepFreeStatus?

    func toggle(dest: BeaconDest, label: String, kind: GuideSessionKind = .walk, accessible: Bool) {
        if isTracking {
            stop(playStopTone: true)
        } else {
            guard !starting else { return }
            starting = true
            self.accessible = accessible
            self.lastStepFree = nil
            startTask = Task { [weak self] in
                await self?.start(dest: dest, label: label, kind: kind)
                self?.starting = false
            }
        }
    }
```

`fetchDetailData`의 walk 분기에 인자를 넘기고 상태를 함께 돌려준다:

```swift
        let briefing = try await routeService.walk(
            originLat: origin.lat, originLng: origin.lng,
            destLat: dest.lat, destLng: dest.lng,
            accessible: accessible,
            includeGeometry: true
        )
```

반환 튜플에 `stepFree: StepFreeStatus?`·`stepFreeNotice: String?`을 더한다(car 분기는 둘 다 `nil`).

- [ ] **Step 4: 전이 판정과 결합 발화를 넣는다**

`BeaconModel`에 헬퍼:

```swift
    /// 열화 전이 판정(spec §2.3, 웹 `consumeStepFreeNotice` 미러). 상태가 열화이고
    /// 직전과 다를 때만 문장을 돌려준다. 직전 상태를 갱신하는 부작용이 있으므로
    /// 기하 빌드까지 성공한 뒤 정확히 1회 부른다.
    private func consumeStepFreeNotice(
        _ status: StepFreeStatus?, _ notice: String?
    ) -> String? {
        let prev = lastStepFree
        lastStepFree = status
        guard let status, status != .applied, status != prev else { return nil }
        return notice
    }
```

성공 발화(약 391-398행)를 교체:

```swift
            // 시작 요약 + 첫 안내를 한 문장으로(원자 발화 — 두 통지의 경합 제거).
            // 계단 회피 열화 문장이 있으면 그 앞에 붙인다 — 세션 전체에 걸린
            // 조건이라 걷기 전에 들어야 한다(spec §2.3).
            let summary = sessionKind == .car
                ? GuideText.carStart(route: fetched.route, firstIndices: initial.firstIndices)
                : GuideText.start(route: fetched.route, firstIndices: initial.firstIndices)
            let notice = consumeStepFreeNotice(fetched.stepFree, fetched.stepFreeNotice)
            let text = notice.map { "\($0) \(summary)" } ?? summary
            lastGuidance = GuideText.unit(route: fetched.route, indices: initial.firstIndices)
            statusText = text
            announce(text)
```

`fallbackToBrief`에 상태 초기화 한 줄:

```swift
    private func fallbackToBrief(key: String = "guide.detailUnavailable") {
        mode = .brief
        remainingText = nil
        // 경로가 없으면 경로 기반 계단 판정도 없다(3-state). 복구된 상세가 열화면
        // 새 판정으로 다시 통지된다.
        lastStepFree = nil
```

- [ ] **Step 5: `DirectionsTabView` 호출부를 채운다**

`service.walk`(351행)에 이미 `accessible: stepFreeEnabled`가 있으므로 무변경. `beacon.toggle` 5곳:

| 행 | 추가할 인자 |
|---|---|
| 471 (walk) | `accessible: model.stepFreeEnabled` |
| 489 (권한 승인 후, walk 기본) | `accessible: model.stepFreeEnabled` |
| 522 | 그 호출의 `kind`가 walk면 `model.stepFreeEnabled`, 아니면 `false` |
| 532 | 같음 |
| 717 (walk 인계) | `accessible: model.stepFreeEnabled` |

⚠ 522·532의 `kind`를 **읽고 판단한다**. 자동차·대중교통이면 `accessible: false`가 정답이고, 그 사실이 코드에 드러나는 것이 이 required 인자의 목적이다.

- [ ] **Step 6: 빌드**

Run: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -configuration Experimental -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -5`
Expected: `BUILD SUCCEEDED`

Run: `cd ios/GildongmuKit && swift test`
Expected: 전량 PASS

- [ ] **Step 7: 커밋**

```bash
git add ios/GildongmuKit/Sources/GildongmuKit/RouteService.swift ios/Gildongmu/Directions/BeaconModel.swift ios/Gildongmu/Directions/DirectionsTabView.swift && git commit -m "$(cat <<'EOF'
fix(ios): 실시간 안내가 계단 회피를 경로 조회에 싣는다 (A4)

RouteService.walk의 accessible 기본값을 제거했다. 그 기본값이 A4를
만든 기제다 - 안내 조회가 안전 관련 인자를 생략해도 컴파일이
통과했다. 제거하면 같은 누락이 컴파일 오류가 된다.

BeaconModel이 세션 시작 시 값을 받아 상세 조회에 싣고, 계단 회피
판정이 열화로 전이하면 시작 발화에 문장을 결합해 1회 통지한다.
간략 폴백에서는 판정 상태를 초기화한다.

toggle 호출부 5곳이 각자 값을 명시한다. 계단 회피 개념이 없는
수단에서 false를 적는 것은 그 사실의 선언이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)" -- ios/GildongmuKit/Sources/GildongmuKit/RouteService.swift ios/Gildongmu/Directions/BeaconModel.swift ios/Gildongmu/Directions/DirectionsTabView.swift && git show HEAD --stat
```

---

## Task 8: 변이 주입으로 검출력을 실측한다

**Files:** 없음(실험 후 원복)

**Interfaces:** Consumes: T1~T7 전부

- [ ] **Step 1: 변이 스크립트를 만든다**

`/private/tmp/claude-502/.../scratchpad/mutate.py`에 변이 10종을 정의한다(각 변이 = 대상 파일·찾을 문자열·바꿀 문자열). 목록은 spec §4.4의 M1~M10.

⚠ **셸 스크립트가 아니라 Python으로 쓴다** — 종전 마일스톤에서 bash 판이 `fails: unbound variable`로 죽었다.

- [ ] **Step 2: 각 변이마다 red를 확인한다**

각 변이에 대해: 적용 → 해당 스위트 실행 → 실패 건수 기록 → 원복. 웹 변이는 `npm run test:run`, Kit 변이는 `swift test`.

- [ ] **Step 3: 미검출 변이를 판정한다**

미검출이 나오면 [[mutation-proves-test-detection-power]] 2026-08-07 갱신을 적용한다: **ⓐ 테스트가 놓친 실재 축이면 봉합**하고, **ⓑ 그 계층에서 도달 불가능한 상태를 가정한 변이면 봉합하지 않고 근거를 기록**한다. 판별 질문은 "이 변이가 만드는 잘못된 상태에 사용자가 도달할 경로가 있는가".

특히 확인할 것:
- **M2**는 `applied` fixture에서 항등이 된다 — 열화 ∧ `includeGeometry=1` 조합으로 돌렸는지 확인
- **M8**은 prop이 처음부터 `true`면 항등이 된다 — 세션 사이에 값이 바뀌는 시나리오로 돌렸는지 확인

- [ ] **Step 4: 원복 검증**

Run: `git status --porcelain && git diff --stat`
Expected: 출력 없음(변이 잔재 0)

- [ ] **Step 5: 결과를 PROGRESS.md에 기록한다** (T10에서 함께 커밋)

---

## Task 9: 실호출 게이트

**Files:** 없음(검증만, 결과는 T10에서 기록)

- [ ] **Step 1: dev 서버를 띄운다**

Run: `npm run dev`(백그라운드)

- [ ] **Step 2: 계단이 실재하는 좌표쌍을 찾는다**

지하보도·육교가 있는 구간으로 조회해 `accessible` 없이 응답의 `steps` 중 `description`에 `"계단"`이 포함된 경로를 찾는다. 후보: 종전 마일스톤이 쓴 서울역·수원역→강남역 구간(역사 내 이동이 많아 계단 포함 확률이 높다).

- [ ] **Step 3: 게이트 4종을 돌린다**

```bash
BASE="http://localhost:3000/api/route/walk?origin=<O>&dest=<D>"
# ① 기하 온전 + 스텝 수 보존
curl -s "$BASE&accessible=true&includeGeometry=1" | jq '{
  stepFree: .result.stepFree,
  notice: .result.stepFreeNotice,
  steps: (.result.steps | length),
  noGeometry: [.result.steps[] | select((.pathCoords // []) | length == 0)] | length
}'
# ② 파라미터 upstream 도달 증거 = stepFree 필드 존재(경로 차이는 보조 관찰)
curl -s "$BASE&includeGeometry=1" | jq '.result.stepFree'   # null이어야 한다
# ④ 미지정 응답의 steps·기존 필드 불변
curl -s "$BASE" | jq '{steps: (.result.steps | length), first: .result.steps[0].description}'
```

Expected: ① `noGeometry: 0`, 열화면 `notice` 존재 ② `null` ④ 종전과 동일

- [ ] **Step 4: ③ 무계단 부재 좌표쌍**

`stepFree === "no_stepfree_route"`가 나오는 좌표쌍을 찾아 같은 검사를 돌린다. ⚠ **실측으로 찾지 못하면 그 사실을 기록하고 fixture로 대신한다**(없는 것을 있다고 적지 않는다).

- [ ] **Step 5: CLI 회귀 확인**

Run: `npx tsx packages/cli/src/index.ts walk-route --origin <O> --dest <D> --output text`
Expected: 종전과 같은 출력. ⚠ **`--output text`를 명시한다** — 파이프는 비-TTY라 JSON 모드가 되어 text 전용 결함을 못 잡는다([[cli-formatter-registration-gap]]).

---

## Task 10: 꼬리 문장 11건 (별도 커밋)

**Files:** `src/app/api/` 하위 9개 라우트(`speech-to-text` 2 · `walk/nearby` 1 · `route/car` 2 · `route/walk` 2 · `places` 1 · `address/search` 1 · `geocode` 1 · `geocode/reverse` 1)

**근거:** spec §7. `[[sr-announcement-tails-live-in-server-strings]]`가 지목한 잔여분이고 클라이언트가 `body.error`를 그대로 낭독한다. A4와 무관하므로 **커밋을 분리한다.**

- [ ] **Step 1: 전수 확인**

Run: `grep -rn "잠시 후 다시 시도" src/app/api --include="*.ts"`
Expected: 11건

- [ ] **Step 2: 문장을 자른다**

각 문자열에서 `" 잠시 후 다시 시도해 주세요."`를 제거한다. 예: `"도보 길찾기에 실패했습니다. 잠시 후 다시 시도해 주세요."` → `"도보 길찾기에 실패했습니다."`

⚠ **`"네트워크 연결 후 다시 시도해 주세요"`류는 유지 대상**이다 — 조건을 알리므로 새 정보다. 판정선은 "뒷문장이 새 정보를 주는가"이고, 실패했으면 재시도가 가능하다는 것은 자명하다.

⚠ 정규식으로 훑지 말고 **여러 문장인 문자열 전부를 놓고 판정한다** — 정규식 스캔이 "이용하세요"를 놓친 실사고가 있다.

- [ ] **Step 3: 게이트**

Run: `npm run test:run && npm run lint`
Expected: 전량 green. ⚠ 옛 문장을 단언하는 테스트가 있으면 함께 갱신한다.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api && git commit -m "$(cat <<'EOF'
fix(a11y): 라우트 오류 문자열의 자명한 꼬리 문장 11건을 걷어낸다

클라이언트가 body.error를 그대로 낭독한다. "잠시 후 다시 시도해
주세요"는 실패했으면 자명해 새 정보가 없다. 2026-08-02 UI 35건
정리에서 서버 문자열이 스코프 밖이라 남아 있던 잔여분이다.

"네트워크 연결 후 다시 시도해 주세요"류는 조건을 알리므로 유지했다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)" -- src/app/api && git show HEAD --stat
```

---

## Task 11: 독립 리뷰

**근거:** 헌장 §리뷰 계층 — 리뷰는 구현 방식과 무관하게 항상 별도 컨텍스트에 맡긴다. **리뷰어에게 세션 히스토리·생성 의도·중점 지시를 넘기지 않는다.** 요구사항(spec + 이 계획)과 산출물(커밋 범위)만 준다.

- [ ] **Step 1: 산출물을 얼린다**

Run: `git log --oneline -8 && git status --porcelain`
Expected: 미커밋 0. 리뷰어에게 넘길 커밋 범위 SHA를 확정한다([[freeze-artifact-before-review-dispatch]] — 트리를 계속 고치면 지적 절반이 유령이 된다).

- [ ] **Step 2: 리뷰어 2종을 동시에 띄운다**

`code-reviewer`(정합·계약)와 `a11y-auditor`(통지 계약·발화 경합)를 병렬 디스패치한다. 각각에게 spec 경로·계획 경로·커밋 범위만 준다.

⚠ 두 리뷰어 모두에게 **독립 변이 설계를 요구한다** — 구현자 변이는 하한이지 상한이 아니다([[mutation-proves-test-detection-power]] 2026-08-08 갱신). 특히 "상위 조건과 하위 조건이 동시에 참이라 한쪽 판정이 다른 쪽에 가려지는" 지점을 찾게 한다.

⚠ 백그라운드 에이전트에는 `SendMessage({to:"main"})` 보고를 명시한다.

- [ ] **Step 3: 지적을 판정한다**

즉시 지엽 패치 금지. 먼저 아키텍처 수준에서 대조하고, 같은 계층 지적이 2회 이상 반복되면 계층 선택 자체를 의심한다. 기각도 근거와 함께 기록한다(오탐도 기록 대상).

- [ ] **Step 4: 반영 후 전 게이트 재실행**

Run: `npm run test:run && npm run lint && npx tsc --noEmit && npm run build`
Run: `cd ios/GildongmuKit && swift test`
Run: `xcodebuild ... -configuration Experimental build`

---

## Task 12: 문서 갱신과 배포

**Files:** `CLAUDE.md` · `PROGRESS.md` · `docs/BACKLOG.md` · `AGENTS.md`(생성물)

- [ ] **Step 1: `CLAUDE.md` 도보 경로 행에 항구 규칙을 더한다**

통합 카탈로그 "도보 경로" 행에 추가할 계약 셋:

```
**계단 회피는 안내 조회에도 실린다**(A4, 2026-08-08). `includeGeometry=1`
응답에는 안전 문장을 유사 스텝으로 넣지 않고 `stepFreeNotice` 필드로 내린다 —
기하 없는 스텝은 `buildGuideRoute`가 경로 전체를 거부해 상세 안내가 조용히
간략으로 강등된다(웹·Kit 동일). 값은 봉인하지 않고 **조회 시점에 읽고**
(`useState` 초기값은 마운트 수명이지 세션 수명이 아니다), 통지는 **열화 상태로의
전이**에서 1회이며 시작·재조회 발화와 **한 문자열로 결합**한다. ⚠ 안전 관련
인자에 기본값을 두지 말 것 — A4가 그 기제에서 나왔다(`RouteService.walk`·
`walkRouteUrl`·`DistanceBeacon` prop 전부 required).
```

- [ ] **Step 2: `PROGRESS.md`에 마일스톤 절을 추가한다**

"### 계단 회피의 실시간 안내 전달 (2026-08-08 — 백로그 A4·D1)" 절에 담을 것: 결함 실재 확인, §1.2 함정, codex 19건 판정 요약, 변이 주입 실측표, 실호출 게이트 결과, 남은 실기기 판정.

- [ ] **Step 3: `docs/BACKLOG.md`를 갱신한다**

- §A4를 종결 표로 옮긴다(`| A4 | 계단 회피 상태의 실시간 도보 안내 전달 | 2026-08-08 |`)
- §D1을 종결 처리한다(두 건 모두 해소)
- **§F-a에 실기기 판정 항목을 추가한다**: 계단 회피 켠 도보 안내에서 ①열화 문장이 시작 발화에 이어 **끊기지 않고** 낭독되는가 ②정상 적용이면 침묵인가 ③이탈 재조회에서 열화로 바뀔 때 들리는가
- **꼬리 문장 항목을 등재한다**(T10에서 처리했으면 종결로, 남겼으면 신규 항목으로)
- §다음 마일스톤을 갱신한다

⚠ 마일스톤 줄에 남긴 관찰을 백로그로 옮기는 것이 **그 마일스톤의 마지막 단계**다(백로그 자신의 실패 모드 ④).

- [ ] **Step 4: `AGENTS.md`를 재생성한다**

Run: `cd /Users/hunyongkim/Mac-Projects && python sync_agent_docs.py`
Expected: gildongmu의 형제 `AGENTS.md`가 갱신됨

- [ ] **Step 5: 커밋·푸시**

```bash
git add CLAUDE.md PROGRESS.md docs/BACKLOG.md AGENTS.md && git commit -m "$(cat <<'EOF'
docs(progress): 계단 회피 실시간 안내 전달 마일스톤 기록 (A4·D1 종결)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)" -- CLAUDE.md PROGRESS.md docs/BACKLOG.md AGENTS.md && git show HEAD --stat && git push origin main
```

- [ ] **Step 6: 실기기 배포**

Run: `CONFIGURATION=Experimental ./ios/deploy-device.sh`
Expected: `Launched application with space.dodoplanet.gildongmu.dev bundle identifier`

⚠ **웹이 먼저 나가야 한다**(spec §6). Step 5의 push가 Vercel 자동 배포를 일으키므로 순서가 자연히 맞는다 — 배포 완료를 확인한 뒤 기기에 넣는다.

---

## 자기 검산 (계획 작성자 수행)

**1. 스펙 커버리지**

| spec 절 | 태스크 |
|---|---|
| §2.1 서버 기하 분기 | T1 |
| §2.2 조회 시점 판독·호출부 전수 | T3·T4 |
| §2.3 열화 전이 통지·결합 발화 | T5(웹)·T7(iOS) |
| §2.4 Kit 디코딩·전방 호환 | T6 |
| §2.5 기본값 제거 | T3(웹)·T7(iOS) |
| §2.6 D1-b 문구 | T2 |
| §2.7 D1-a 테스트 | T2 |
| §3 불변식 1~5 | T1(1·2·5)·T2(4)·T1(3) |
| §4.4 변이 M1~M10 | T8 |
| §5 실호출 게이트 | T9 |
| §6 배포 순서 | T12 Step 6 |
| §7 꼬리 문장 | T10 |

공백 없음.

**2. 플레이스홀더 스캔**: "TBD"·"적절히 처리"·"Task N과 유사" 0건. 모든 코드 단계에 실제 코드 블록이 있다.

**3. 타입 일관성**: `stepFreeNotice`(웹 필드 = Kit 필드 = 테스트 단언) · `StepFreeStatus`(웹 `src/lib/types.ts` ↔ Kit `RouteModels.swift`, raw 값 3개 일치) · `consumeStepFreeNotice`(웹 훅 ↔ iOS 모델 동명) · `walkRouteUrl`(T3 정의 ↔ T3·T4 소비) · `accessible`(모든 계층 동명). 불일치 없음.

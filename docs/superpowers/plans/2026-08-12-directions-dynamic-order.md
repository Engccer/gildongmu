# 길찾기 결과 섹션 동적 순서 (E11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 길찾기 결과 섹션 순서를 조회 결과로 정한다 — 성공 수단 앞·비성공 뒤, 도보 30분 이하면 최상단. 순서는 settled 시점 1회 스냅샷.

**Architecture:** 순수 함수 1개를 웹(`src/lib/directions-order.ts`)과 Kit(`Directions.swift`)에 미러하고 공유 fixture로 동조를 강제한다. 웹은 `activeModes`(조회 대상)와 `QueryResults.orderedModes`(표시 순서 스냅샷)를 분리하고, iOS는 `DirectionsResults.orderedModes`를 저장 프로퍼티로 두고 `replacingWalk`로 부분 재조회 시 순서를 보존한다.

**Tech Stack:** TypeScript(Vitest), Swift(Swift Testing), 공유 fixture JSON.

**구현 방식 판정(AUTONOMY §구현 방식):** inline. 웹 함수 시그니처·fixture 스키마가 Kit 미러의 인터페이스를 정하는 순차 의존이고, 단일 도메인 소규모(수정 파일 6개 내외)라 위임 이득이 없다. 리뷰는 구현 완료 후 별도 컨텍스트 서브에이전트 1회(소규모 묶음).

## Global Constraints

- spec 정본: `docs/superpowers/specs/2026-08-12-directions-dynamic-order-design.md`
- 30분 판정은 새 상수 금지 — 웹 `shouldCollapseWalk` 재사용, Kit은 같은 반올림 미러(`분 반올림 > 30`).
- 순서는 settled 시점 1회 확정, 이후 재계산 금지(계단 회피 토글·대안 전환·재탐색 불변).
- 순서 변경 별도 통지 금지. 3-state 본문 문구 불변(empty ≠ error).
- i18n·서버·API 변경 0건.
- 커밋은 의도 파일 pathspec만(`git add -A` 금지), 메시지 한국어 + Co-Authored-By 푸터.
- 테스트: `npm run test:run`(웹), `swift test`(ios/GildongmuKit), 빌드 `npm run build`.

---

### Task 1: 공유 fixture + 웹 순수 함수

**Files:**
- Create: `src/lib/__tests__/fixtures/directions-order-scenarios.json`
- Create: `src/lib/directions-order.ts`
- Test: `src/lib/__tests__/directions-order.test.ts`

**Interfaces:**
- Produces: `orderDirectionsModes(modes: DirectionsModeKey[], isSuccess: Partial<Record<DirectionsModeKey, boolean>>, walkDurationSeconds: number | null): DirectionsModeKey[]` — Task 2가 소비. fixture 스키마 `{ order: [{ name, modes, success, walkDurationSeconds, expect }] }` — Task 3의 Kit 테스트가 같은 파일을 소비.

- [ ] **Step 1: fixture 작성**

`src/lib/__tests__/fixtures/directions-order-scenarios.json`:

```json
{
  "order": [
    { "name": "전 성공, 도보 29분 — 도보 최상단", "modes": ["transit", "car", "walk"], "success": { "transit": true, "car": true, "walk": true }, "walkDurationSeconds": 1740, "expect": ["walk", "transit", "car"] },
    { "name": "전 성공, 도보 30분 — 경계 포함 승격", "modes": ["transit", "car", "walk"], "success": { "transit": true, "car": true, "walk": true }, "walkDurationSeconds": 1800, "expect": ["walk", "transit", "car"] },
    { "name": "전 성공, 도보 30분 1초 — 반올림 30분이라 승격(표시와 같은 분 값)", "modes": ["transit", "car", "walk"], "success": { "transit": true, "car": true, "walk": true }, "walkDurationSeconds": 1801, "expect": ["walk", "transit", "car"] },
    { "name": "전 성공, 도보 31분 — 제자리", "modes": ["transit", "car", "walk"], "success": { "transit": true, "car": true, "walk": true }, "walkDurationSeconds": 1860, "expect": ["transit", "car", "walk"] },
    { "name": "대중교통 실패 — 최하단", "modes": ["transit", "car", "walk"], "success": { "transit": false, "car": true, "walk": true }, "walkDurationSeconds": 2400, "expect": ["car", "walk", "transit"] },
    { "name": "도보 비성공(empty·error 공통) — 하단, 승격 판정 미적용", "modes": ["transit", "car", "walk"], "success": { "transit": true, "car": false, "walk": false }, "walkDurationSeconds": null, "expect": ["transit", "car", "walk"] },
    { "name": "도보만 성공(장거리) — 승격 없이도 성공군이라 맨 앞", "modes": ["transit", "car", "walk"], "success": { "transit": false, "car": false, "walk": true }, "walkDurationSeconds": 2400, "expect": ["walk", "transit", "car"] },
    { "name": "전 실패 — 현행 순서 유지", "modes": ["transit", "car", "walk"], "success": { "transit": false, "car": false, "walk": false }, "walkDurationSeconds": null, "expect": ["transit", "car", "walk"] },
    { "name": "도보 제외 조회(en 로케일 등) — 2수단만", "modes": ["transit", "car"], "success": { "transit": false, "car": true }, "walkDurationSeconds": null, "expect": ["car", "transit"] }
  ]
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/__tests__/directions-order.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { orderDirectionsModes, type DirectionsModeKey } from "../directions-order";
import scenarios from "./fixtures/directions-order-scenarios.json";

type OrderCase = {
  name: string;
  modes: DirectionsModeKey[];
  success: Partial<Record<DirectionsModeKey, boolean>>;
  walkDurationSeconds: number | null;
  expect: DirectionsModeKey[];
};

describe("orderDirectionsModes (공유 fixture — Kit 미러 동조)", () => {
  const cases = scenarios.order as OrderCase[];
  // 공회전 방지: fixture가 비면 조용히 통과한다(Kit 테스트와 같은 가드).
  it("fixture에 경계 케이스가 있다", () => {
    expect(cases.length).toBeGreaterThanOrEqual(9);
  });
  for (const c of cases) {
    it(c.name, () => {
      expect(orderDirectionsModes(c.modes, c.success, c.walkDurationSeconds)).toEqual(c.expect);
    });
  }
  it("입력 배열을 변경하지 않는다", () => {
    const modes: DirectionsModeKey[] = ["transit", "car", "walk"];
    orderDirectionsModes(modes, { walk: true }, 600);
    expect(modes).toEqual(["transit", "car", "walk"]);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/lib/__tests__/directions-order.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 4: 구현**

`src/lib/directions-order.ts`:

```ts
import { shouldCollapseWalk } from "./walk-collapse";

export type DirectionsModeKey = "transit" | "walk" | "car";

/**
 * 길찾기 결과 섹션 표시 순서(spec 2026-08-12 §2, Kit Directions.swift 미러 —
 * 공유 fixture directions-order-scenarios.json이 동조 강제).
 *
 * 1. 성공 수단 앞, 비성공(경로 없음·조회 실패) 뒤 — 각 군 안은 입력 순서 유지.
 * 2. 도보 성공이고 30분 이하(도보 상세 접기와 같은 경계)면 성공군 맨 앞.
 *
 * ⚠ 호출은 조회 settled 시점 1회뿐이다. 부분 재조회(계단 회피 토글)에서
 *   다시 부르면 사용자가 조작 중인 섹션이 발밑에서 이동한다(spec §2 규칙 3).
 */
export function orderDirectionsModes(
  modes: DirectionsModeKey[],
  isSuccess: Partial<Record<DirectionsModeKey, boolean>>,
  walkDurationSeconds: number | null,
): DirectionsModeKey[] {
  const successes = modes.filter((m) => isSuccess[m] === true);
  const failures = modes.filter((m) => isSuccess[m] !== true);
  const promoteWalk =
    isSuccess.walk === true &&
    walkDurationSeconds !== null &&
    !shouldCollapseWalk(walkDurationSeconds);
  const orderedSuccesses = promoteWalk
    ? ["walk" as const, ...successes.filter((m) => m !== "walk")]
    : successes;
  return [...orderedSuccesses, ...failures];
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/__tests__/directions-order.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/lib/directions-order.ts src/lib/__tests__/directions-order.test.ts src/lib/__tests__/fixtures/directions-order-scenarios.json
git commit -m "feat(directions): E11 섹션 순서 순수 함수 + 공유 fixture" -- src/lib/directions-order.ts src/lib/__tests__/directions-order.test.ts src/lib/__tests__/fixtures/directions-order-scenarios.json
```

---

### Task 2: 웹 DirectionsView 통합

**Files:**
- Modify: `src/components/DirectionsView.tsx` (QueryResults 타입 ~65행, settled 커밋 ~546행, settledCount ~639행, 렌더 루프 ~984행)
- Test: `src/components/__tests__/DirectionsOrder.test.tsx` (신규)

**Interfaces:**
- Consumes: Task 1의 `orderDirectionsModes`.
- Produces: `QueryResults.orderedModes: ModeKey[]` (렌더·포커스·집계의 표시 축 정본).

- [ ] **Step 1: 실패하는 컴포넌트 테스트 작성**

`src/components/__tests__/DirectionsOrder.test.tsx` — 스캐폴딩(mock·stub·조회 헬퍼)은 `DirectionsWalkCollapse.test.tsx`와 동형으로 복제하되, fetch stub에 대중교통 오류와 도보 응답 전환(호출 차수별)을 추가한다:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Place } from "@/lib/types";
import messages from "../../../messages/ko.json";

/**
 * E11 섹션 동적 순서 계약(spec 2026-08-12 §2·§3.2):
 * 성공 앞·비성공 뒤, 도보 30분 이하 최상단, settled 후 순서 불변.
 */

vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({ status: "error" as const })),
  getGeolocationSnapshot: () => ({ status: "idle" as const }),
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../WalkRouteBriefing", () => ({
  WalkRouteResult: () => <p>도보 구간 상세</p>,
}));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteResult: () => null }));

import { DirectionsView } from "../DirectionsView";

const gangnam: Place = {
  id: "p-gangnam",
  name: "강남역",
  category: "지하철역",
  address: "서울 강남구 역삼동 858",
  roadAddress: "서울 강남구 강남대로 396",
  lat: 37.497,
  lng: 127.027,
};

const WALK_SHORT = {
  result: { distanceMeters: 900, durationSeconds: 20 * 60, steps: [{ description: "직진 900m 이동" }] },
};
const WALK_LONG = {
  result: { distanceMeters: 2500, durationSeconds: 35 * 60, steps: [{ description: "직진 2.5km 이동" }] },
};
const TRANSIT_OK = {
  result: {
    recommended: {
      summary: { totalMinutes: 30, fare: 1550, transfers: 0, walkMinutes: 6 },
      legs: [{ mode: "walk", minutes: 6 }],
      routeKey: "p0",
    },
    alternatives: [],
    totalCandidates: 1,
  },
};

/** walk는 호출 차수별 응답 배열(계단 회피 재조회의 응답 전환용) */
function stubFetch(opts: { walks: Array<object | "error">; transit: object | "error" }) {
  let walkCall = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/places")) {
        return { ok: true, json: async () => ({ places: [gangnam], provider: "kakao-local", query: "q" }) } as Response;
      }
      if (url.startsWith("/api/address/search")) {
        return { ok: true, json: async () => ({ addresses: [] }) } as Response;
      }
      if (url.startsWith("/api/route/walk")) {
        const body = opts.walks[Math.min(walkCall++, opts.walks.length - 1)];
        if (body === "error") return { ok: false, json: async () => ({}) } as Response;
        return { ok: true, json: async () => body } as Response;
      }
      if (url.startsWith("/api/transit/track")) {
        return { ok: false, json: async () => ({}) } as Response;
      }
      if (url.startsWith("/api/route/transit")) {
        if (opts.transit === "error") return { ok: false, json: async () => ({}) } as Response;
        return { ok: true, json: async () => opts.transit } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

function stubGeolocationApi() {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
  });
}

async function queryRoutes() {
  stubGeolocationApi();
  render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <DirectionsView canShowWalk canShowTransit canBriefCarRoute={false} onBack={() => {}} />
    </NextIntlClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("출발지"), { target: { value: "강남" } });
  fireEvent.click(screen.getByRole("button", { name: "출발지 검색" }));
  await waitFor(() => {
    expect(document.activeElement?.textContent).toContain("강남역,");
  });
  fireEvent.click(document.activeElement as HTMLElement);

  fireEvent.change(screen.getByLabelText("도착지"), { target: { value: "강남" } });
  fireEvent.click(screen.getByRole("button", { name: "도착지 검색" }));
  await waitFor(() => {
    expect(document.activeElement?.textContent).toContain("강남역,");
  });
  fireEvent.click(document.activeElement as HTMLElement);

  fireEvent.click(screen.getByRole("button", { name: "경로 조회" }));
  await waitFor(() => {
    expect(
      screen.queryByText(/경로 안내가 준비되었습니다/) ??
        screen.queryByText("경로를 찾지 못했습니다."),
    ).not.toBeNull();
  });
}

/** 수단 heading(h3) 텍스트를 문서 순서로 수집 */
function modeHeadings(): string[] {
  return screen
    .getAllByRole("heading", { level: 3 })
    .map((h) => h.textContent ?? "")
    .filter((tx) => ["대중교통", "자동차", "도보"].includes(tx));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("길찾기 섹션 동적 순서(E11 spec §2)", () => {
  it("도보 30분 이하 성공이면 도보가 최상단이고 포커스도 도보 heading이다", async () => {
    stubFetch({ walks: [WALK_SHORT], transit: TRANSIT_OK });
    await queryRoutes();
    expect(modeHeadings()).toEqual(["도보", "대중교통"]);
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("도보");
    });
  });

  it("장거리 도보는 제자리, 실패한 대중교통은 최하단(첫 성공 포커스는 도보)", async () => {
    stubFetch({ walks: [WALK_LONG], transit: "error" });
    await queryRoutes();
    expect(modeHeadings()).toEqual(["도보", "대중교통"]);
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("도보");
    });
  });

  it("전 수단 성공에 도보 장거리면 현행 순서 유지", async () => {
    stubFetch({ walks: [WALK_LONG], transit: TRANSIT_OK });
    await queryRoutes();
    expect(modeHeadings()).toEqual(["대중교통", "도보"]);
  });

  it("계단 회피 재조회는 도보가 empty→성공으로 바뀌어도 순서를 재계산하지 않는다", async () => {
    stubFetch({ walks: [{ result: null }, WALK_SHORT], transit: TRANSIT_OK });
    await queryRoutes();
    expect(modeHeadings()).toEqual(["대중교통", "도보"]);

    fireEvent.click(screen.getByRole("button", { name: "계단 없는 경로" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "계단 없는 경로" }).getAttribute("aria-busy"),
      ).toBe("false");
    });
    // 도보가 성공(20분)이 됐지만 순서는 settled 스냅샷 그대로다(spec §2 규칙 3).
    expect(screen.getByText("도보 구간 상세")).toBeTruthy();
    expect(modeHeadings()).toEqual(["대중교통", "도보"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/components/__tests__/DirectionsOrder.test.tsx`
Expected: FAIL — 첫·둘째 테스트의 순서 단언(`["도보", "대중교통"]`)이 현행 고정 순서(`["대중교통", "도보"]`)와 어긋남. 넷째는 통과할 수 있음(현행도 재계산 없음).

- [ ] **Step 3: DirectionsView 수정 (4곳)**

① `QueryResults` 타입에 필드 추가 + import:

```ts
import { orderDirectionsModes } from "@/lib/directions-order";
```

```ts
type QueryResults = {
  destLabel: string;
  destCoord: Coord;
  outcomes: Partial<Record<ModeKey, ModeOutcome>>;
  /**
   * 표시 순서 스냅샷(spec 2026-08-12 §2) — settled 커밋 시 1회 확정.
   * 계단 회피 토글은 outcomes.walk만 교체하므로 순서는 자동 불변이다.
   */
  orderedModes: ModeKey[];
  originSource: "gps" | "manual" | null;
};
```

② settled 커밋(~546행): `successes` 계산을 orderedModes로 대체하고 setResults·포커스가 그것을 쓴다.

```ts
      const orderedModes = orderDirectionsModes(
        activeModes,
        Object.fromEntries(
          activeModes.map((m) => [m, outcomes[m]?.kind === "done"]),
        ),
        outcomes.walk?.kind === "done" ? outcomes.walk.result.durationSeconds : null,
      );
      setResults({
        destLabel: to.kind === "current" ? currentLabel : to.label,
        destCoord: dest,
        outcomes,
        orderedModes,
        originSource,
      });
```

포커스(~564행): 성공군이 앞이므로 새 순서에서 첫 성공을 찾는다.

```ts
      // 첫 성공 수단 heading으로 1회 포커스. 성공 0건이면 이동 없음(통지만).
      const first = orderedModes.find((m) => outcomes[m]?.kind === "done");
```

(기존 `const successes = activeModes.filter(...)` 줄은 삭제 — 소비자가 사라진다.)

③ settledCount(~639행): 진실원을 results 하나로 유지하는 기존 방침대로 orderedModes 기준으로.

```ts
  const settledCount = results
    ? results.orderedModes.filter((m) => results.outcomes[m]?.kind === "done").length
    : null;
```

④ 렌더 루프(~984행):

```tsx
          {results.orderedModes.map((mode) => {
```

`toggleStepFree`(~612행)는 수정 없음 — `{ ...prev, outcomes: { ...prev.outcomes, walk: outcome } }`이 `orderedModes`를 그대로 보존한다.

- [ ] **Step 4: 신규 + 기존 스위트 통과 확인**

Run: `npx vitest run src/components/__tests__/DirectionsOrder.test.tsx src/components/__tests__/DirectionsWalkCollapse.test.tsx`
Expected: PASS 양쪽 (WalkCollapse 스위트의 도보 단독·대중교통 단독 시나리오는 순서 영향 없음)

- [ ] **Step 5: 전체 게이트**

Run: `npm run test:run && npm run build`
Expected: PASS (build는 타입 검사 겸용 — Vitest green ≠ 타입 통과)

- [ ] **Step 6: 커밋**

```bash
git add src/components/__tests__/DirectionsOrder.test.tsx
git commit -m "feat(directions): 웹 결과 섹션 동적 순서 — orderedModes 스냅샷" -- src/components/DirectionsView.tsx src/components/__tests__/DirectionsOrder.test.tsx
```

---

### Task 3: Kit 미러 (정렬 + 30분 판정 + 순서 보존 교체)

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Directions.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/DirectionsTests.swift` (기존 파일에 스위트 추가)

**Interfaces:**
- Consumes: Task 1의 fixture(`src/lib/__tests__/fixtures/directions-order-scenarios.json`, repo 상대 경로 — CourseDerivationTests 로딩 패턴).
- Produces: `DirectionsResults.orderedModes: [DirectionsMode]`, `DirectionsResults.replacingWalk(_:) -> DirectionsResults`, `DirectionsOrder.orderModes(modes:isSuccess:walkDurationSeconds:)`, `WalkCollapse.shouldCollapse(durationSeconds:)` — Task 4가 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

`DirectionsTests.swift`에 추가(파일 상단 private 헬퍼 + 스위트):

```swift
// E11 섹션 동적 순서 — 웹 공유 fixture 동조(CourseDerivationTests 로딩 패턴).
private struct OrderCase: Decodable {
    let name: String
    let modes: [String]
    let success: [String: Bool]
    let walkDurationSeconds: Int?
    let expect: [String]
}

private struct OrderScenarios: Decodable {
    let order: [OrderCase]
}

private func loadOrderScenarios() throws -> OrderScenarios {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() } // GildongmuKitTests→Tests→GildongmuKit→ios→repo
    url.appendPathComponent("src/lib/__tests__/fixtures/directions-order-scenarios.json")
    return try JSONDecoder().decode(OrderScenarios.self, from: Data(contentsOf: url))
}

@Suite("길찾기 섹션 동적 순서 (E11, 웹 공유 fixture 동조)")
struct DirectionsOrderTests {
    @Test("공유 fixture order — 웹과 같은 순서")
    func orderMatchesWebFixture() throws {
        let cases = try loadOrderScenarios().order
        // ⚠ 공회전 방지: 배열이 비면 루프가 0회 돌고 조용히 통과한다.
        #expect(cases.count >= 9)
        for c in cases {
            let modes = c.modes.compactMap(DirectionsMode.init(rawValue:))
            #expect(modes.count == c.modes.count, "\(c.name): 미지의 수단")
            let got = DirectionsOrder.orderModes(
                modes: modes,
                isSuccess: { c.success[$0.rawValue] == true },
                walkDurationSeconds: c.walkDurationSeconds
            )
            #expect(got.map(\.rawValue) == c.expect, "\(c.name)")
        }
    }

    @Test("30분 판정은 웹과 같은 반올림(분 값 > 30)")
    func walkCollapseMirrorsWeb() {
        #expect(WalkCollapse.shouldCollapse(durationSeconds: 31 * 60))
        #expect(!WalkCollapse.shouldCollapse(durationSeconds: 30 * 60))
        #expect(!WalkCollapse.shouldCollapse(durationSeconds: 30 * 60 + 1))
        #expect(WalkCollapse.shouldCollapse(durationSeconds: 30 * 60 + 31))
    }

    @Test("replacingWalk는 outcome만 바꾸고 순서를 보존한다")
    func replacingWalkPreservesOrder() {
        // 도보 empty로 settled → 순서 확정(도보 하단).
        let initial = DirectionsResults(outcomes: [
            .transit: .empty, .car: .error, .walk: .empty,
        ])
        // 전 수단 비성공 → 현행 고정 순서.
        #expect(initial.orderedModes == [.transit, .car, .walk])
        // 계단 회피 재조회로 도보가 20분 성공이 되어도 순서는 스냅샷 그대로(spec §2 규칙 3).
        let brief = WalkRouteBriefing(
            distanceMeters: 900, durationSeconds: 20 * 60,
            steps: [], stepFree: nil, stepFreeNotice: nil, finalApproach: nil
        )
        let updated = initial.replacingWalk(.walk(brief))
        #expect(updated.orderedModes == [.transit, .car, .walk])
        #expect(updated.outcomes[.walk]?.isSuccess == true)
        // 파생값은 새 outcome을 본다: 첫 성공은 도보(순서상 마지막이어도 유일한 성공).
        #expect(updated.firstSuccess == .walk)
        #expect(updated.successCount == 1)
    }

    @Test("새 조회(init)는 순서를 다시 계산한다 — 30분 이하 도보 최상단")
    func initPromotesWalkableWalk() {
        let brief = WalkRouteBriefing(
            distanceMeters: 900, durationSeconds: 20 * 60,
            steps: [], stepFree: nil, stepFreeNotice: nil, finalApproach: nil
        )
        let results = DirectionsResults(outcomes: [
            .transit: .empty, .walk: .walk(brief),
        ])
        #expect(results.orderedModes == [.walk, .transit])
        #expect(results.displayedModes == [.walk, .transit])
        #expect(results.firstSuccess == .walk)
    }
}
```

⚠ `WalkRouteBriefing` init 인자가 실제 선언과 다르면(memberwise 비공개 등) 실제 public init 시그니처에 맞춰 조정한다 — 시그니처 조정만 허용, 시나리오 변경 금지.

- [ ] **Step 2: 실패 확인**

Run: `cd ios/GildongmuKit && swift test --filter DirectionsOrderTests`
Expected: FAIL (컴파일 오류 — `DirectionsOrder`·`WalkCollapse`·`orderedModes`·`replacingWalk` 미정의)

- [ ] **Step 3: Kit 구현**

`Directions.swift`에 추가·수정:

```swift
/// 도보 상세 접기 경계(웹 src/lib/walk-collapse.ts 미러 — E11이 승격 판정에 재사용).
/// ⚠ 판정과 표시가 같은 분 값을 써야 한다(웹 정본 주석 동일).
public enum WalkCollapse {
    public static let minutes = 30
    public static func shouldCollapse(durationSeconds: Int) -> Bool {
        Int((Double(durationSeconds) / 60).rounded()) > minutes
    }
}

/// E11 섹션 표시 순서(웹 src/lib/directions-order.ts 미러 — 공유 fixture
/// directions-order-scenarios.json이 동조 강제).
/// 1. 성공 수단 앞, 비성공 뒤 — 각 군 안은 입력 순서 유지.
/// 2. 도보 성공이고 30분 이하면 성공군 맨 앞.
public enum DirectionsOrder {
    public static func orderModes(
        modes: [DirectionsMode],
        isSuccess: (DirectionsMode) -> Bool,
        walkDurationSeconds: Int?
    ) -> [DirectionsMode] {
        let successes = modes.filter(isSuccess)
        let failures = modes.filter { !isSuccess($0) }
        let promoteWalk: Bool = if let walkDurationSeconds, successes.contains(.walk) {
            !WalkCollapse.shouldCollapse(durationSeconds: walkDurationSeconds)
        } else {
            false
        }
        let orderedSuccesses = promoteWalk
            ? [.walk] + successes.filter { $0 != .walk }
            : successes
        return orderedSuccesses + failures
    }
}
```

`DirectionsResults` 교체:

```swift
/// 한 조회의 최종 산출. 표시·포커스·통지 문장이 전부 여기서 파생된다.
public struct DirectionsResults: Sendable {
    public let outcomes: [DirectionsMode: DirectionsModeOutcome]
    /// 표시 순서 스냅샷(E11 spec §2) — 조회 settled의 init에서 1회 확정한다.
    /// ⚠ computed로 바꾸지 말 것: 부분 재조회가 암묵 재계산을 일으켜 사용자가
    ///   조작 중인 섹션이 이동한다. 부분 교체는 replacingWalk가 순서를 보존한다.
    public let orderedModes: [DirectionsMode]

    public init(outcomes: [DirectionsMode: DirectionsModeOutcome]) {
        self.outcomes = outcomes
        self.orderedModes = DirectionsOrder.orderModes(
            modes: DirectionsMode.displayOrder.filter { outcomes[$0] != nil },
            isSuccess: { outcomes[$0]?.isSuccess == true },
            walkDurationSeconds: {
                if case .walk(let brief)? = outcomes[.walk] { brief.durationSeconds } else { nil }
            }()
        )
    }

    private init(outcomes: [DirectionsMode: DirectionsModeOutcome], orderedModes: [DirectionsMode]) {
        self.outcomes = outcomes
        self.orderedModes = orderedModes
    }

    /// 계단 회피 재조회: 도보 outcome만 교체하고 순서는 보존한다(웹 toggleStepFree 동형).
    public func replacingWalk(_ outcome: DirectionsModeOutcome) -> DirectionsResults {
        var next = outcomes
        next[.walk] = outcome
        return DirectionsResults(outcomes: next, orderedModes: orderedModes)
    }

    /// 화면에 노출할 수단(동적 순서). 미조회 수단·게이트(404)·서비스 지역 밖은 섹션 자체 미노출
    /// (outOfCoverage는 정상적으로 DirectionsModel이 화면 전체를 전환해 여기 도달하지 않지만,
    /// 방어적으로 개별 수단 렌더에서도 제외한다).
    public var displayedModes: [DirectionsMode] {
        orderedModes.filter { mode in
            guard let outcome = outcomes[mode] else { return false }
            return !outcome.isGated && !outcome.isOutOfCoverage
        }
    }

    /// 성공 수단(동적 순서). 첫 항목이 완료 시 포커스 목적지(성공 0건이면 이동 없음).
    public var successModes: [DirectionsMode] {
        orderedModes.filter { outcomes[$0]?.isSuccess == true }
    }

    public var firstSuccess: DirectionsMode? { successModes.first }

    /// 완료 통지 합산 1문장의 수(readySummary {count}).
    public var successCount: Int { successModes.count }
}
```

`DirectionsMode.displayOrder`의 주석을 "군 내 고정 순서(동적 순서의 타이브레이커)"로 갱신:

```swift
/// 수단 식별. displayOrder는 각 군(성공·비성공) 안의 고정 순서다(웹 activeModes 동형) —
/// E11부터 화면 순서 자체는 DirectionsResults.orderedModes(조회 결과 파생 스냅샷)가 정한다.
```

- [ ] **Step 4: Kit 전체 테스트**

Run: `cd ios/GildongmuKit && swift test`
Expected: PASS. 기존 `DirectionsTests`에 고정 순서를 단언하는 케이스가 있으면 spec §2 규칙에 맞는 기대값으로 갱신(예: 성공·비성공 혼합 fixture의 `displayedModes` 순서). 단언 약화 금지 — 새 계약의 정확한 순서로 교체.

- [ ] **Step 5: 커밋**

```bash
git add ios/GildongmuKit/Sources/GildongmuKit/Directions.swift ios/GildongmuKit/Tests/GildongmuKitTests/DirectionsTests.swift
git commit -m "feat(ios): Kit 길찾기 섹션 동적 순서 미러 + 순서 보존 교체" -- ios/GildongmuKit/Sources/GildongmuKit/Directions.swift ios/GildongmuKit/Tests/GildongmuKitTests/DirectionsTests.swift
```

---

### Task 4: iOS 앱 통합 (refetchWalk 순서 보존)

**Files:**
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift:388-390`

**Interfaces:**
- Consumes: Task 3의 `replacingWalk(_:)`.

- [ ] **Step 1: refetchWalk 교체**

`DirectionsTabView.swift` `refetchWalk` 안(~388행):

```swift
        // 순서는 settled 스냅샷을 보존한다(E11 spec §2 규칙 3) — 재계산 init 금지.
        results = current.replacingWalk(outcome)
```

(기존 `var outcomes = current.outcomes` / `outcomes[.walk] = outcome` / `results = DirectionsResults(outcomes: outcomes)` 3줄을 대체.)

- [ ] **Step 2: 앱 빌드로 검증**

Run: `cd ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -destination 'generic/platform=iOS' -configuration Debug build CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5`
Expected: BUILD SUCCEEDED (뷰 계층은 `ForEach(results.displayedModes)`라 추가 수정 없음 — 순서가 데이터로 내려온다)

- [ ] **Step 3: 커밋**

```bash
git add ios/Gildongmu/Directions/DirectionsTabView.swift
git commit -m "feat(ios): 계단 회피 재조회가 섹션 순서 스냅샷을 보존" -- ios/Gildongmu/Directions/DirectionsTabView.swift
```

---

### Task 5: 리뷰 + 마일스톤 닫기 + 배포

**Files:**
- Modify: `docs/BACKLOG.md` (E11 항목 제거), `CHANGELOG.md` (서사 2~4줄 + spec 링크), `PROGRESS.md` (상태 한 줄)

- [ ] **Step 1: 코드 리뷰 디스패치** — code-reviewer 서브에이전트에 **spec 경로 + 커밋 범위(SHA)만** 넘긴다(세션 히스토리 금지). 지적은 아키텍처 대조 후 반영/기각 기록.
- [ ] **Step 2: 전체 게이트 재확인** — `npm run test:run && npm run build`, `cd ios/GildongmuKit && swift test`.
- [ ] **Step 3: 문서 분배** — BACKLOG E11 삭제, CHANGELOG 2026-08-12 항목 추가, PROGRESS 상태 갱신. pathspec 커밋.
- [ ] **Step 4: push** (자동 배포 — 웹).
- [ ] **Step 5: iOS 양 구성 실기기 배포** (위원장 지시 2026-08-12):

```bash
./ios/deploy-device.sh                                # 배포판(기본)
CONFIGURATION=Experimental ./ios/deploy-device.sh     # 실험판
```

# 현위치 수동 지정 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 자기 현재 위치를 장소 검색으로 직접 지정하고, 이동하면 자동으로 GPS로 복귀하는 계층을 웹·iOS에 동시에 넣는다.

**Architecture:** 판정은 웹 `src/lib/manual-location.ts` ↔ Kit `ManualLocation.swift` 순수 함수 미러이고 공유 fixture가 동조를 강제한다. 좌표 출처는 함수 이름이 아니라 **타입**(`RealFix` / `EffectiveLocation`)으로 봉인해 실시간 안내에 수동 좌표가 새지 않게 한다. 소비자 배선은 단일 관문 두 곳(웹 `useNearbyFetch`, iOS `nearbyCoordinateSource()`)만 고치면 21개 화면이 따라온다.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / zod 4 / Vitest 4 · SwiftUI / Swift Testing / GildongmuKit(SPM)

**설계 정본:** [`docs/superpowers/specs/2026-08-09-manual-location-design.md`](../specs/2026-08-09-manual-location-design.md) (커밋 `669dd51`)

## 구현 방식 판정 (자율성 헌장 §구현 방식 판정)

**혼합.** Task 1~8은 **inline** — 선행 결정이 후속 태스크의 인터페이스를 바꾼다(`ManualLocation`/`Fix`/`ManualVerdict` 타입이 저장소·트리거·관문 전부를 정하고, `RealFix` 브랜드가 안내 경로 시그니처를 바꾼다). Task 9~15는 **subagent-driven 가능** — 인터페이스가 고정된 뒤의 UI·i18n 작업이고 웹/iOS가 서로 다른 파일을 만진다.

수정 파일 겹침: Task 1~8은 `geolocation.ts`·`LocationService.swift`를 순차로 만지므로 병렬 불가. Task 12·13(길찾기)은 각각 `DirectionsView.tsx`·`DirectionsTabView.swift` 단독 소유라 병렬 가능.

## Global Constraints

- **커밋은 명시 경로만.** `git add -A`·`git add .` 금지. `git commit -m "…" -- <경로들>` 원자화 후 `git show HEAD --stat`로 혼입 검증. 병렬 세션이 `LocationService.swift`·`DirectionsTabView.swift`를 동시에 만질 수 있다.
- **커밋 이메일** `engccer@gmail.com`. 주석·커밋 메시지·문서는 한국어, 변수·함수명은 영어.
- **매 커밋 `npm run test:run` 통과.** iOS는 `swift test --package-path ios/GildongmuKit`.
- **수동 위치가 켜져 있을 때 "현재 위치"라는 문자열을 표시 경로에 내지 않는다**(6로케일 전부).
- **최근접 POI로 위치 라벨을 만들지 않는다**(spec §6.2 금지).
- **i18n 키는 6로케일**(`ko`·`en`·`es`·`fr`·`it`·`ja`) 동시 추가. `i18n-messages.test.ts`가 게이트.
- **`src/lib/`는 React·Next 비의존**(dodo 이식성).
- **UI 라벨에 이모지 금지.** 터치 타깃 ≥44×44px(`min-h-11`). 한 줄 = 한 접근성 객체.
- **상수 3종 값**: `MOVED_M = 100`, `JUDGE_CEILING_M = 100`, `FIX_MAX_AGE_S = 10`. 값이 같은 앞의 둘은 **축이 달라 별도 선언**한다.

---

## File Structure

### 웹 신규
| 파일 | 책임 |
|---|---|
| `src/lib/manual-location.ts` | 타입(`Fix`·`ManualLocation`·`ManualVerdict`)·상수·판정 순수 함수·스키마 파싱. React 비의존 |
| `src/lib/manual-location-store.ts` | 영속(localStorage) + 구독 가능 싱글턴. `geolocation.ts` 패턴 미러 |
| `src/lib/effective-location.ts` | `RealFix`/`EffectiveLocation` 타입 + `awaitRealFix`/`awaitEffectiveLocation` + 판정 실행 |
| `src/lib/resolve-address-coord.ts` | 주소 후보 → 좌표 해석(현재 홈·길찾기에 복붙 2벌). 5-state 결과 |
| `src/hooks/useManualLocation.ts` | `useSyncExternalStore` 구독 훅 |
| `src/components/LocationBar.tsx` | 표시줄(형제 버튼 둘) |
| `src/lib/__tests__/fixtures/manual-location-scenarios.json` | 웹↔Kit 공유 판정 fixture |

### 웹 수정
`src/hooks/useNearbyFetch.ts` · `src/hooks/useRouteGuide.ts` · `src/components/PlaceSearch.tsx` · `src/components/NearbyHub.tsx` · `src/components/DirectionsView.tsx` · `messages/{ko,en,es,fr,it,ja}.json`

### iOS 신규
| 파일 | 책임 |
|---|---|
| `ios/GildongmuKit/Sources/GildongmuKit/ManualLocation.swift` | 웹 판정 함수 미러 |
| `ios/GildongmuKit/Tests/GildongmuKitTests/ManualLocationTests.swift` | 공유 fixture 대조 |
| `ios/Gildongmu/ManualLocationStore.swift` | `@Observable` + `UserDefaults` 단일 소유자 |
| `ios/Gildongmu/LocationBarView.swift` | 표시줄 |

### iOS 수정
`ios/Gildongmu/LocationService.swift` · `Nearby/NearbyLoadState.swift` · `GildongmuApp.swift` · `SearchView.swift` · `Chat/ChatConversationView.swift` · `NearbyHubView.swift` · `Directions/DirectionsEndpointSearchView.swift` · `Directions/DirectionsTabView.swift` · `Resources/Localizable.xcstrings`

---

## Task 1: 판정 순수 함수 + 공유 fixture (웹)

**Files:**
- Create: `src/lib/manual-location.ts`
- Create: `src/lib/__tests__/fixtures/manual-location-scenarios.json`
- Create: `src/lib/__tests__/manual-location.test.ts`

**Interfaces:**
- Consumes: `haversineMeters(lat1, lng1, lat2, lng2)` from `src/lib/geo.ts`
- Produces: `Fix`, `ManualLocation`, `ManualVerdict`, `MOVED_M`, `JUDGE_CEILING_M`, `FIX_MAX_AGE_S`, `isEligibleFix(fix, nowSeconds)`, `judgeManualLocation(manual, fix, nowSeconds)`, `parseManualLocation(raw)`

- [ ] **Step 1: 공유 fixture를 쓴다**

`src/lib/__tests__/fixtures/manual-location-scenarios.json`:

```json
{
  "comment": "수동 위치 이동 판정 경계표. 웹 manual-location.test.ts와 Kit ManualLocationTests가 함께 소비한다(드리프트 가드). origin은 지정 시점 실측 fix, fix는 판정 시점 fix. now는 판정 시각(epoch seconds). separation = haversine(fix, origin) - fix.accuracy - origin.accuracy.",
  "cases": [
    {
      "name": "기준점 없음 — 판정 불가",
      "manual": { "revision": 1, "label": "길동 카페", "lat": 37.5384, "lng": 127.1432, "origin": null, "setAt": 1000 },
      "fix": { "lat": 37.6000, "lng": 127.1432, "accuracy": 10, "at": 2000 },
      "now": 2000,
      "expect": "undecidable"
    },
    {
      "name": "fix 없음 — 판정 불가",
      "manual": { "revision": 1, "label": "길동 카페", "lat": 37.5384, "lng": 127.1432, "origin": { "lat": 37.5384, "lng": 127.1432, "accuracy": 10, "at": 1000 }, "setAt": 1000 },
      "fix": null,
      "now": 2000,
      "expect": "undecidable"
    },
    {
      "name": "정확도 음수 — 판정 불가 (iOS 무효 fix)",
      "manual": { "revision": 1, "label": "길동 카페", "lat": 37.5384, "lng": 127.1432, "origin": { "lat": 37.5384, "lng": 127.1432, "accuracy": 10, "at": 1000 }, "setAt": 1000 },
      "fix": { "lat": 37.6000, "lng": 127.1432, "accuracy": -1, "at": 2000 },
      "now": 2000,
      "expect": "undecidable"
    },
    {
      "name": "정확도 자격 초과(101m) — 판정 불가",
      "manual": { "revision": 1, "label": "길동 카페", "lat": 37.5384, "lng": 127.1432, "origin": { "lat": 37.5384, "lng": 127.1432, "accuracy": 10, "at": 1000 }, "setAt": 1000 },
      "fix": { "lat": 37.6000, "lng": 127.1432, "accuracy": 101, "at": 2000 },
      "now": 2000,
      "expect": "undecidable"
    },
    {
      "name": "fix 나이 초과(11초) — 판정 불가",
      "manual": { "revision": 1, "label": "길동 카페", "lat": 37.5384, "lng": 127.1432, "origin": { "lat": 37.5384, "lng": 127.1432, "accuracy": 10, "at": 1000 }, "setAt": 1000 },
      "fix": { "lat": 37.6000, "lng": 127.1432, "accuracy": 10, "at": 2000 },
      "now": 2011,
      "expect": "undecidable"
    },
    {
      "name": "같은 자리 — 유지",
      "manual": { "revision": 1, "label": "길동 카페", "lat": 37.5384, "lng": 127.1432, "origin": { "lat": 37.5384, "lng": 127.1432, "accuracy": 10, "at": 1000 }, "setAt": 1000 },
      "fix": { "lat": 37.5384, "lng": 127.1432, "accuracy": 10, "at": 2000 },
      "now": 2000,
      "expect": "keep"
    },
    {
      "name": "거리 121m·양쪽 정확도 10m — separation 101m 이동 확정",
      "manual": { "revision": 1, "label": "길동 카페", "lat": 37.5384, "lng": 127.1432, "origin": { "lat": 37.5384, "lng": 127.1432, "accuracy": 10, "at": 1000 }, "setAt": 1000 },
      "fix": { "lat": 37.539488, "lng": 127.1432, "accuracy": 10, "at": 2000 },
      "now": 2000,
      "expect": "drop"
    },
    {
      "name": "거리 119m·양쪽 정확도 10m — separation 99m 유지",
      "manual": { "revision": 1, "label": "길동 카페", "lat": 37.5384, "lng": 127.1432, "origin": { "lat": 37.5384, "lng": 127.1432, "accuracy": 10, "at": 1000 }, "setAt": 1000 },
      "fix": { "lat": 37.539470, "lng": 127.1432, "accuracy": 10, "at": 2000 },
      "now": 2000,
      "expect": "keep"
    },
    {
      "name": "거리 150m지만 fix 정확도 60m·origin 40m — separation 50m 유지(오차 원 겹침)",
      "manual": { "revision": 1, "label": "길동 카페", "lat": 37.5384, "lng": 127.1432, "origin": { "lat": 37.5384, "lng": 127.1432, "accuracy": 40, "at": 1000 }, "setAt": 1000 },
      "fix": { "lat": 37.539749, "lng": 127.1432, "accuracy": 60, "at": 2000 },
      "now": 2000,
      "expect": "keep"
    },
    {
      "name": "먼 이동(5km) — 해제",
      "manual": { "revision": 1, "label": "길동 카페", "lat": 37.5384, "lng": 127.1432, "origin": { "lat": 37.5384, "lng": 127.1432, "accuracy": 10, "at": 1000 }, "setAt": 1000 },
      "fix": { "lat": 37.5834, "lng": 127.1432, "accuracy": 10, "at": 2000 },
      "now": 2000,
      "expect": "drop"
    }
  ]
}
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`src/lib/__tests__/manual-location.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import scenarios from "./fixtures/manual-location-scenarios.json";
import {
  FIX_MAX_AGE_S,
  JUDGE_CEILING_M,
  MOVED_M,
  judgeManualLocation,
  parseManualLocation,
  type Fix,
  type ManualLocation,
} from "../manual-location";

describe("judgeManualLocation — 공유 fixture", () => {
  for (const c of scenarios.cases) {
    it(c.name, () => {
      const verdict = judgeManualLocation(
        c.manual as ManualLocation,
        c.fix as Fix | null,
        c.now,
      );
      expect(verdict).toBe(c.expect);
    });
  }
});

describe("상수", () => {
  it("두 100m는 축이 달라 별도 선언이다", () => {
    // 값이 같다는 이유로 하나로 합치면 한 축만 조정하려다 둘 다 바뀐다.
    expect(MOVED_M).toBe(100);
    expect(JUDGE_CEILING_M).toBe(100);
    expect(FIX_MAX_AGE_S).toBe(10);
  });
});

describe("parseManualLocation — 저장 경계 검증", () => {
  const valid: ManualLocation = {
    revision: 3,
    label: "길동 카페",
    lat: 37.5384,
    lng: 127.1432,
    origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: 1000 },
    setAt: 1000,
  };

  it("정상값을 통과시킨다", () => {
    expect(parseManualLocation(valid)).toEqual(valid);
  });

  it("origin이 null이어도 통과시킨다", () => {
    const noOrigin = { ...valid, origin: null };
    expect(parseManualLocation(noOrigin)).toEqual(noOrigin);
  });

  it.each([
    ["문자열 좌표", { ...valid, lat: "37.5" }],
    ["NaN 좌표", { ...valid, lat: Number.NaN }],
    ["범위 밖 위도", { ...valid, lat: 91 }],
    ["범위 밖 경도", { ...valid, lng: 181 }],
    ["공백뿐인 label", { ...valid, label: "   " }],
    ["origin 정확도 0", { ...valid, origin: { ...valid.origin!, accuracy: 0 } }],
    ["origin 정확도 음수", { ...valid, origin: { ...valid.origin!, accuracy: -5 } }],
    ["revision 누락", { ...valid, revision: undefined }],
    ["객체가 아님", "길동"],
    ["null", null],
  ])("%s를 폐기한다", (_name, raw) => {
    expect(parseManualLocation(raw)).toBeNull();
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npm run test:run -- src/lib/__tests__/manual-location.test.ts`
Expected: FAIL — `Failed to resolve import "../manual-location"`

- [ ] **Step 4: 최소 구현을 쓴다**

`src/lib/manual-location.ts`:

```ts
import { z } from "zod";
import { haversineMeters } from "./geo";

/**
 * 판정에 쓰는 실측 fix. `accuracy`는 미터, `at`은 epoch seconds.
 *
 * ⚠ iOS `horizontalAccuracy`는 무효 fix에 **음수**를 준다. 음수를 그대로 빼면
 * separation이 커져 거짓 이동이 되므로 `accuracy > 0`이 자격 조건이다.
 */
export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  at: number;
}

/**
 * 사용자가 직접 지정한 현재 위치.
 *
 * `origin`은 **지정 시점의 적격 실측 fix**이고 이동 판정의 기준점이다.
 * `{lat,lng}`(장소 좌표)를 기준점으로 쓰지 않는다 — 장소 검색 결과 좌표는
 * 건물 중심이나 대표 출입구라 사용자가 서 있는 지점과 100m 이상 떨어질 수
 * 있고(지하철역·대형 병원·공원), 그러면 같은 자리인데 이동으로 판정된다.
 * 지정 시점에 적격 fix가 없으면 `null`이고 판정은 `undecidable`이 된다.
 */
export interface ManualLocation {
  /** 단조 증가. 판정 왕복 중 재지정을 가르는 CAS 토큰. */
  revision: number;
  label: string;
  lat: number;
  lng: number;
  origin: Fix | null;
  setAt: number;
}

export type ManualVerdict = "keep" | "drop" | "undecidable";

/**
 * 답이 달라지는 거리(m). `LocationFix.swift`가 "100m가 최근접 정류소 순위를
 * 뒤집는다"를 두 번 기록했다. 답이 달라지는 거리가 곧 "이동했다"의 정의다.
 */
export const MOVED_M = 100;

/**
 * 판정용 fix의 사용 자격 상한(m). `LocationFixPolicy.storeCeiling`과 같은
 * 값·같은 취지(셀·Wi-Fi 측위의 km급 좌표는 어떤 용도로도 위치가 아니다).
 *
 * ⚠ `MOVED_M`과 값은 같지만 **축이 다르다**(답이 달라지는 거리 / 사용 자격).
 * 하나로 합치면 다음 사람이 한 축만 조정하려다 둘 다 바꾼다.
 */
export const JUDGE_CEILING_M = 100;

/**
 * 판정용 fix의 나이 상한(초). `LocationFixPolicy.acceptAge` 미러.
 * `force:true`는 신선도를 보장하지 않는다 — iOS는 매니저 시작 직후 캐시 fix를
 * 먼저 전달할 수 있다.
 */
export const FIX_MAX_AGE_S = 10;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isEligibleFix(fix: Fix, nowSeconds: number): boolean {
  if (!isFiniteNumber(fix.accuracy) || fix.accuracy <= 0) return false;
  if (fix.accuracy > JUDGE_CEILING_M) return false;
  if (!isFiniteNumber(fix.lat) || !isFiniteNumber(fix.lng)) return false;
  if (fix.lat < -90 || fix.lat > 90 || fix.lng < -180 || fix.lng > 180) return false;
  if (!isFiniteNumber(fix.at)) return false;
  return nowSeconds - fix.at <= FIX_MAX_AGE_S;
}

/**
 * 수동 위치를 유지할지, 이동으로 보고 해제할지, 판정할 수 없는지.
 *
 * `separation`은 "두 오차 원이 겹치지 않고도 남는 거리"다. 중심점 거리만 보면
 * 거리 101m·정확도 100m가 이동으로 판정되는데, 그 경우 수동 좌표는 fix의 오차
 * 원 안에 있어 이동의 증거가 아니다. `JUDGE_CEILING_M`은 fix의 **사용 자격**만
 * 가를 뿐 이동을 **증명**하지 않는다.
 */
export function judgeManualLocation(
  manual: ManualLocation,
  fix: Fix | null,
  nowSeconds: number,
): ManualVerdict {
  if (!manual.origin) return "undecidable";
  if (!fix) return "undecidable";
  if (!isEligibleFix(fix, nowSeconds)) return "undecidable";

  const centerDistance = haversineMeters(fix.lat, fix.lng, manual.origin.lat, manual.origin.lng);
  const separation = centerDistance - fix.accuracy - manual.origin.accuracy;
  return separation > MOVED_M ? "drop" : "keep";
}

const fixSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().positive(),
  at: z.number().finite(),
});

const manualLocationSchema = z.object({
  revision: z.number().finite(),
  label: z.string().trim().min(1),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  origin: fixSchema.nullable(),
  setAt: z.number().finite(),
});

/**
 * 저장 경계 검증. 손상된 값을 복원하면 `haversineMeters`가 NaN을 내고 모든
 * 비교가 false가 되어 **영구 유지**된다(가장 나쁜 실패 방향). 실패는 폐기.
 */
export function parseManualLocation(raw: unknown): ManualLocation | null {
  const parsed = manualLocationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
```

- [ ] **Step 5: 테스트가 통과하는지 확인**

Run: `npm run test:run -- src/lib/__tests__/manual-location.test.ts`
Expected: PASS (fixture 10건 + 상수 1건 + 파싱 12건)

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(location): 수동 위치 판정 순수 함수 + 공유 fixture

기준점은 지정 시점 실측 fix(origin)다. 장소 검색 결과 좌표는 건물 중심이라
같은 자리에서도 100m 넘게 떨어져 오해제가 난다. separation은 양쪽 정확도를
차감해 오차 원이 겹치지 않고도 남는 거리만 이동으로 센다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
  -- src/lib/manual-location.ts src/lib/__tests__/manual-location.test.ts \
     src/lib/__tests__/fixtures/manual-location-scenarios.json
git show HEAD --stat
```

---

## Task 2: 판정 함수 Kit 미러 + fixture 대조 (iOS)

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/ManualLocation.swift`
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/ManualLocationTests.swift`

**Interfaces:**
- Consumes: `haversineMeters(lat1:lng1:lat2:lng2:)` from Kit `Geo.swift`; Task 1의 fixture JSON
- Produces: `ManualFix`, `ManualLocation`, `ManualVerdict`, `ManualLocationPolicy`, `judgeManualLocation(manual:fix:now:)`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`ios/GildongmuKit/Tests/GildongmuKitTests/ManualLocationTests.swift`:

```swift
import Foundation
import Testing
@testable import GildongmuKit

/// 웹 정본과 같은 공유 fixture(`src/lib/__tests__/fixtures/manual-location-scenarios.json`)를
/// 소비해 두 판정이 갈리지 않게 한다(드리프트 가드).
private struct Scenarios: Decodable {
    struct FixJSON: Decodable { let lat: Double; let lng: Double; let accuracy: Double; let at: Double }
    struct ManualJSON: Decodable {
        let revision: Int; let label: String; let lat: Double; let lng: Double
        let origin: FixJSON?; let setAt: Double
    }
    struct Case: Decodable {
        let name: String; let manual: ManualJSON; let fix: FixJSON?
        let now: Double; let expect: String
    }
    let cases: [Case]
}

private func loadScenarios() throws -> Scenarios {
    // Kit 테스트는 repo 루트 기준 상대 경로로 웹 fixture를 읽는다(기존 관례).
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }   // …/ios/GildongmuKit/Tests/GildongmuKitTests/X.swift → repo 루트
    url.appendPathComponent("src/lib/__tests__/fixtures/manual-location-scenarios.json")
    return try JSONDecoder().decode(Scenarios.self, from: Data(contentsOf: url))
}

@Test func 공유_fixture로_웹과_같은_판정을_낸다() throws {
    let scenarios = try loadScenarios()
    #expect(scenarios.cases.count >= 10)
    for c in scenarios.cases {
        let manual = ManualLocation(
            revision: c.manual.revision, label: c.manual.label,
            lat: c.manual.lat, lng: c.manual.lng,
            origin: c.manual.origin.map { ManualFix(lat: $0.lat, lng: $0.lng, accuracy: $0.accuracy, at: $0.at) },
            setAt: c.manual.setAt
        )
        let fix = c.fix.map { ManualFix(lat: $0.lat, lng: $0.lng, accuracy: $0.accuracy, at: $0.at) }
        let verdict = judgeManualLocation(manual: manual, fix: fix, now: c.now)
        #expect(verdict.rawValue == c.expect, "\(c.name): got \(verdict.rawValue), want \(c.expect)")
    }
}

@Test func 상수가_웹과_같고_두_축이_분리돼_있다() {
    #expect(ManualLocationPolicy.movedMeters == 100)
    #expect(ManualLocationPolicy.judgeCeilingMeters == 100)
    #expect(ManualLocationPolicy.fixMaxAgeSeconds == 10)
}
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `swift test --package-path ios/GildongmuKit --filter ManualLocation`
Expected: FAIL — `cannot find 'ManualLocation' in scope`

- [ ] **Step 3: 최소 구현을 쓴다**

`ios/GildongmuKit/Sources/GildongmuKit/ManualLocation.swift`:

```swift
import Foundation

/// 판정에 쓰는 실측 fix. `accuracy`는 미터, `at`은 epoch seconds.
///
/// ⚠ `CLLocation.horizontalAccuracy`는 무효 fix에 **음수**를 준다. 음수를 그대로
/// 빼면 separation이 커져 거짓 이동이 되므로 `accuracy > 0`이 자격 조건이다.
public struct ManualFix: Equatable, Codable, Sendable {
    public let lat: Double
    public let lng: Double
    public let accuracy: Double
    public let at: Double

    public init(lat: Double, lng: Double, accuracy: Double, at: Double) {
        self.lat = lat; self.lng = lng; self.accuracy = accuracy; self.at = at
    }
}

/// 사용자가 직접 지정한 현재 위치. 웹 `src/lib/manual-location.ts` 미러.
///
/// `origin`은 **지정 시점의 적격 실측 fix**이고 이동 판정의 기준점이다.
/// `lat`/`lng`(장소 좌표)를 기준점으로 쓰지 않는다 — 장소 검색 결과 좌표는
/// 건물 중심이나 대표 출입구라 사용자가 서 있는 지점과 100m 이상 떨어질 수 있다.
public struct ManualLocation: Equatable, Codable, Sendable {
    /// 단조 증가. 판정 왕복 중 재지정을 가르는 CAS 토큰.
    public let revision: Int
    public let label: String
    public let lat: Double
    public let lng: Double
    public let origin: ManualFix?
    public let setAt: Double

    public init(revision: Int, label: String, lat: Double, lng: Double, origin: ManualFix?, setAt: Double) {
        self.revision = revision; self.label = label
        self.lat = lat; self.lng = lng; self.origin = origin; self.setAt = setAt
    }
}

public enum ManualVerdict: String, Equatable, Sendable {
    case keep, drop, undecidable
}

public enum ManualLocationPolicy {
    /// 답이 달라지는 거리(m). `LocationFixPolicy`가 "100m가 최근접 정류소 순위를
    /// 뒤집는다"를 실측했다.
    public static let movedMeters: Double = 100

    /// 판정용 fix의 사용 자격 상한(m). `LocationFixPolicy.storeCeiling`과 같은 취지.
    /// ⚠ `movedMeters`와 값은 같지만 **축이 다르다**(답이 달라지는 거리 / 사용 자격).
    public static let judgeCeilingMeters: Double = 100

    /// 판정용 fix의 나이 상한(초). `LocationFixPolicy.acceptAge` 미러.
    public static let fixMaxAgeSeconds: Double = 10
}

public func isEligibleManualFix(_ fix: ManualFix, now: Double) -> Bool {
    guard fix.accuracy.isFinite, fix.accuracy > 0,
          fix.accuracy <= ManualLocationPolicy.judgeCeilingMeters,
          fix.lat.isFinite, fix.lng.isFinite,
          (-90...90).contains(fix.lat), (-180...180).contains(fix.lng),
          fix.at.isFinite else { return false }
    return now - fix.at <= ManualLocationPolicy.fixMaxAgeSeconds
}

/// 웹 `judgeManualLocation` 미러. separation은 "두 오차 원이 겹치지 않고도 남는 거리"다.
public func judgeManualLocation(manual: ManualLocation, fix: ManualFix?, now: Double) -> ManualVerdict {
    guard let origin = manual.origin else { return .undecidable }
    guard let fix, isEligibleManualFix(fix, now: now) else { return .undecidable }

    let centerDistance = haversineMeters(lat1: fix.lat, lng1: fix.lng, lat2: origin.lat, lng2: origin.lng)
    let separation = centerDistance - fix.accuracy - origin.accuracy
    return separation > ManualLocationPolicy.movedMeters ? .drop : .keep
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `swift test --package-path ios/GildongmuKit --filter ManualLocation`
Expected: PASS 2건

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(location): 판정 함수 Kit 미러 + 공유 fixture 대조

웹 정본과 같은 fixture를 읽어 두 판정이 갈리지 않게 한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
  -- ios/GildongmuKit/Sources/GildongmuKit/ManualLocation.swift \
     ios/GildongmuKit/Tests/GildongmuKitTests/ManualLocationTests.swift
git show HEAD --stat
```

---

## Task 3: 웹 수동 위치 저장소 (observable + localStorage)

**Files:**
- Create: `src/lib/manual-location-store.ts`
- Create: `src/hooks/useManualLocation.ts`
- Create: `src/lib/__tests__/manual-location-store.test.ts`

**Interfaces:**
- Consumes: `ManualLocation`, `parseManualLocation` (Task 1)
- Produces: `getManualLocation()`, `setManualLocation(input)`, `clearManualLocation()`, `subscribeManualLocation(listener)`, `getManualLocationServerSnapshot()`, `__resetManualLocationForTest()`, `useManualLocation()`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/__tests__/manual-location-store.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetManualLocationForTest,
  clearManualLocation,
  getManualLocation,
  setManualLocation,
  subscribeManualLocation,
} from "../manual-location-store";

const STORAGE_KEY = "gildongmu:manual-location";

describe("manual-location-store", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetManualLocationForTest();
  });

  it("지정하면 읽히고 localStorage에 남는다", () => {
    setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1000 });
    expect(getManualLocation()?.label).toBe("길동 카페");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).label).toBe("길동 카페");
  });

  it("revision이 지정마다 증가한다 (CAS 토큰)", () => {
    setManualLocation({ label: "A", lat: 37.5, lng: 127.1, origin: null, setAt: 1 });
    const first = getManualLocation()!.revision;
    setManualLocation({ label: "B", lat: 37.6, lng: 127.2, origin: null, setAt: 2 });
    expect(getManualLocation()!.revision).toBeGreaterThan(first);
  });

  it("해제하면 null이 되고 저장도 지워진다", () => {
    setManualLocation({ label: "A", lat: 37.5, lng: 127.1, origin: null, setAt: 1 });
    clearManualLocation();
    expect(getManualLocation()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("구독자에게 변경을 통지한다", () => {
    const listener = vi.fn();
    const unsub = subscribeManualLocation(listener);
    setManualLocation({ label: "A", lat: 37.5, lng: 127.1, origin: null, setAt: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    clearManualLocation();
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
    setManualLocation({ label: "B", lat: 37.6, lng: 127.2, origin: null, setAt: 2 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("손상된 저장값을 복원하지 않고 폐기한다", () => {
    localStorage.setItem(STORAGE_KEY, '{"label":"","lat":"x"}');
    __resetManualLocationForTest();
    expect(getManualLocation()).toBeNull();
  });

  it("JSON이 아닌 저장값도 폐기한다", () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    __resetManualLocationForTest();
    expect(getManualLocation()).toBeNull();
  });

  it("다른 탭의 storage 이벤트를 반영한다", () => {
    const listener = vi.fn();
    subscribeManualLocation(listener);
    const next = {
      revision: 9, label: "다른 탭", lat: 37.5, lng: 127.1, origin: null, setAt: 5,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: JSON.stringify(next) }));
    expect(getManualLocation()?.label).toBe("다른 탭");
    expect(listener).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm run test:run -- src/lib/__tests__/manual-location-store.test.ts`
Expected: FAIL — `Failed to resolve import "../manual-location-store"`

- [ ] **Step 3: 최소 구현을 쓴다**

`src/lib/manual-location-store.ts`:

```ts
import { parseManualLocation, type Fix, type ManualLocation } from "./manual-location";

/**
 * 수동 위치의 **런타임 정본**. `localStorage`는 그 뒤의 영속 매체일 뿐이다.
 *
 * 저장 매체를 직접 읽고 쓰면 이미 열린 화면의 표시줄·길찾기 출발지가 즉시
 * 동기화되지 않고, 다른 탭의 변경이 전파되지 않는다. `geolocation.ts`의 모듈
 * 싱글턴 + 구독 패턴을 그대로 미러한다.
 */
const STORAGE_KEY = "gildongmu:manual-location";

let state: ManualLocation | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    state = raw ? parseManualLocation(JSON.parse(raw)) : null;
  } catch {
    // JSON 파싱 실패·저장소 접근 거부 모두 "없음"으로 떨어뜨린다. 손상된 값을
    // 복원하면 haversine이 NaN을 내고 모든 비교가 false가 되어 영구 유지된다.
    state = null;
  }
  if (state === null) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 저장소 접근 불가는 무시 — 런타임 상태는 이미 null이다.
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    state = e.newValue ? parseManualLocation(JSON.parse(e.newValue)) : null;
    emit();
  });
}

export function getManualLocation(): ManualLocation | null {
  hydrate();
  return state;
}

/** SSR 스냅샷 — 서버에는 저장소가 없다. */
export function getManualLocationServerSnapshot(): ManualLocation | null {
  return null;
}

export function subscribeManualLocation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface ManualLocationInput {
  label: string;
  lat: number;
  lng: number;
  /** 지정 시점의 적격 실측 fix. 없으면 판정이 undecidable이 된다. */
  origin: Fix | null;
  setAt: number;
}

/** 지정. `revision`은 이 함수만 증가시킨다(CAS 토큰의 단일 발급처). */
export function setManualLocation(input: ManualLocationInput): void {
  hydrate();
  const next = parseManualLocation({
    ...input,
    revision: (state?.revision ?? 0) + 1,
  });
  if (!next) return;
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 저장 실패해도 런타임 상태는 유지한다(세션 안에서는 동작).
  }
  emit();
}

export function clearManualLocation(): void {
  hydrate();
  if (state === null) return;
  state = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 무시 — 런타임 상태가 정본이다.
  }
  emit();
}

export function __resetManualLocationForTest(): void {
  state = null;
  hydrated = false;
  listeners.clear();
}
```

`src/hooks/useManualLocation.ts`:

```ts
"use client";

import { useSyncExternalStore } from "react";
import type { ManualLocation } from "@/lib/manual-location";
import {
  getManualLocation,
  getManualLocationServerSnapshot,
  subscribeManualLocation,
} from "@/lib/manual-location-store";

/** 수동 위치 구독 훅. 쓰기는 스토어 함수를 직접 import 한다(useGeolocation 동형). */
export function useManualLocation(): ManualLocation | null {
  return useSyncExternalStore(
    subscribeManualLocation,
    getManualLocation,
    getManualLocationServerSnapshot,
  );
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `npm run test:run -- src/lib/__tests__/manual-location-store.test.ts`
Expected: PASS 7건

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(location): 웹 수동 위치 저장소 — observable 정본 + storage 전파

런타임 정본은 모듈 싱글턴이고 localStorage는 영속 매체다. 손상된 저장값은
복원하지 않고 폐기한다 — 복원하면 haversine이 NaN을 내 영구 유지된다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
  -- src/lib/manual-location-store.ts src/hooks/useManualLocation.ts \
     src/lib/__tests__/manual-location-store.test.ts
git show HEAD --stat
```

---

## Task 4: iOS 수동 위치 저장소 (@Observable + UserDefaults)

**Files:**
- Create: `ios/Gildongmu/ManualLocationStore.swift`

**Interfaces:**
- Consumes: `ManualLocation`, `ManualFix` (Task 2)
- Produces: `ManualLocationStore.shared`(`@Observable`, `@MainActor`), `.current: ManualLocation?`, `.set(label:lat:lng:origin:)`, `.clear()`

- [ ] **Step 1: 구현을 쓴다**

> 앱 타깃에 테스트 번들이 없어 이 저장소는 단위 테스트 대상이 아니다(Kit의
> `LocationFixPolicy` 선례와 같은 사정). 판정 로직은 Task 2에서 이미 Kit으로
> 내려 테스트되므로, 여기에는 저장·전파만 남긴다.

`ios/Gildongmu/ManualLocationStore.swift`:

```swift
import Foundation
import Observation
import GildongmuKit

/// 수동 위치의 **런타임 정본**. `UserDefaults`는 그 뒤의 영속 매체다.
///
/// 웹 `src/lib/manual-location-store.ts` 미러. 화면이 `UserDefaults`를 직접
/// 읽고 쓰면 이미 열린 표시줄·길찾기 출발지가 즉시 갱신되지 않는다.
@Observable
@MainActor
final class ManualLocationStore {
    static let shared = ManualLocationStore()

    private static let storageKey = "gildongmu.manualLocation"

    private(set) var current: ManualLocation?

    private init() {
        current = Self.load()
    }

    private static func load() -> ManualLocation? {
        guard let data = UserDefaults.standard.data(forKey: storageKey) else { return nil }
        guard let decoded = try? JSONDecoder().decode(ManualLocation.self, from: data),
              isValid(decoded) else {
            // 손상된 값을 복원하면 haversine이 NaN을 내고 모든 비교가 false가 되어
            // 영구 유지된다(가장 나쁜 실패 방향). 폐기한다.
            UserDefaults.standard.removeObject(forKey: storageKey)
            return nil
        }
        return decoded
    }

    private static func isValid(_ m: ManualLocation) -> Bool {
        guard m.lat.isFinite, m.lng.isFinite,
              (-90...90).contains(m.lat), (-180...180).contains(m.lng),
              !m.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        if let o = m.origin {
            guard o.lat.isFinite, o.lng.isFinite, o.accuracy.isFinite, o.accuracy > 0,
                  (-90...90).contains(o.lat), (-180...180).contains(o.lng) else { return false }
        }
        return true
    }

    /// 지정. `revision`은 이 메서드만 증가시킨다(CAS 토큰의 단일 발급처).
    func set(label: String, lat: Double, lng: Double, origin: ManualFix?) {
        let next = ManualLocation(
            revision: (current?.revision ?? 0) + 1,
            label: label, lat: lat, lng: lng,
            origin: origin,
            setAt: Date().timeIntervalSince1970
        )
        guard Self.isValid(next) else { return }
        current = next
        if let data = try? JSONEncoder().encode(next) {
            UserDefaults.standard.set(data, forKey: Self.storageKey)
        }
    }

    func clear() {
        guard current != nil else { return }
        current = nil
        UserDefaults.standard.removeObject(forKey: Self.storageKey)
    }
}
```

- [ ] **Step 2: 컴파일 확인**

Run: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -configuration Debug -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|\*\* BUILD"`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: 커밋**

```bash
git commit -m "feat(location): iOS 수동 위치 저장소 — @Observable 단일 소유자

웹 store 미러. 손상된 UserDefaults 값은 폐기한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
  -- ios/Gildongmu/ManualLocationStore.swift ios/Gildongmu.xcodeproj/project.pbxproj
git show HEAD --stat
```

⚠ 새 Swift 파일은 pbxproj에 등록해야 한다. 편집 후 `xcodebuild -list -project ios/Gildongmu.xcodeproj`로 검증한다(`plutil -lint`는 객체 ID 중복을 잡지 못한다). **기존 객체 ID를 재사용하지 말 것** — 그 객체를 덮어써 프로젝트가 열리지 않는다.

---

## Task 5: 웹 출처 타입 봉인 + effective 해석 + 판정 트리거 3종

**Files:**
- Create: `src/lib/effective-location.ts`
- Create: `src/lib/__tests__/effective-location.test.ts`

**Interfaces:**
- Consumes: `awaitGeolocation`, `getGeolocationSnapshot` (`src/lib/geolocation.ts`), Task 1·3 전부
- Produces: `RealFix`, `EffectiveLocation`, `awaitRealFix(opts)`, `awaitEffectiveLocation(opts)`, `runManualLocationJudgment()`, `setManualJudgmentAnnouncer(fn)`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/__tests__/effective-location.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetGeolocationForTest } from "../geolocation";
import {
  __resetManualLocationForTest,
  getManualLocation,
  setManualLocation,
} from "../manual-location-store";
import {
  awaitEffectiveLocation,
  awaitRealFix,
  runManualLocationJudgment,
  setManualJudgmentAnnouncer,
} from "../effective-location";

/** getCurrentPosition을 좌표·정확도로 고정한다. */
function stubGeolocation(coords: { lat: number; lng: number; accuracy: number } | null) {
  const impl = (ok: PositionCallback, fail?: PositionErrorCallback) => {
    if (!coords) {
      fail?.({ code: 2, message: "unavailable" } as GeolocationPositionError);
      return;
    }
    ok({
      coords: {
        latitude: coords.lat, longitude: coords.lng, accuracy: coords.accuracy,
        altitude: null, altitudeAccuracy: null, heading: null, speed: null,
      },
      timestamp: Date.now(),
    } as GeolocationPosition);
  };
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: impl } });
}

describe("effective-location", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetGeolocationForTest();
    __resetManualLocationForTest();
    setManualJudgmentAnnouncer(null);
    vi.unstubAllGlobals();
  });

  it("수동 위치가 없으면 GPS 좌표를 source:'gps'로 준다", async () => {
    stubGeolocation({ lat: 37.5, lng: 127.1, accuracy: 10 });
    const eff = await awaitEffectiveLocation({ force: false });
    expect(eff).toEqual({ lat: 37.5, lng: 127.1, source: "gps" });
  });

  it("수동 위치가 있으면 force:false는 측위 없이 수동 좌표를 준다", async () => {
    const spy = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: spy } });
    setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1 });
    const eff = await awaitEffectiveLocation({ force: false });
    expect(eff).toEqual({ lat: 37.5384, lng: 127.1432, source: "manual" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("force:true는 수동 위치가 있어도 판정을 동반한다 — 멀리 이동했으면 GPS로 복귀", async () => {
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    stubGeolocation({ lat: 37.6384, lng: 127.1432, accuracy: 10 }); // 약 11km
    const eff = await awaitEffectiveLocation({ force: true });
    expect(eff?.source).toBe("gps");
    expect(getManualLocation()).toBeNull();
  });

  it("force:true라도 같은 자리면 수동 위치를 유지한다", async () => {
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    stubGeolocation({ lat: 37.5384, lng: 127.1432, accuracy: 10 });
    const eff = await awaitEffectiveLocation({ force: true });
    expect(eff?.source).toBe("manual");
    expect(getManualLocation()).not.toBeNull();
  });

  it("origin이 없으면 아무리 멀리 있어도 해제하지 않는다 (undecidable)", async () => {
    setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1 });
    stubGeolocation({ lat: 35.1796, lng: 129.0756, accuracy: 10 }); // 부산
    await awaitEffectiveLocation({ force: true });
    expect(getManualLocation()).not.toBeNull();
  });

  it("측위 실패면 수동 위치를 유지한다 (증거 부재)", async () => {
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    stubGeolocation(null);
    await runManualLocationJudgment();
    expect(getManualLocation()).not.toBeNull();
  });

  it("자동 해제는 통지를 정확히 1회 낸다", async () => {
    const announce = vi.fn();
    setManualJudgmentAnnouncer(announce);
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    stubGeolocation({ lat: 37.6384, lng: 127.1432, accuracy: 10 });
    await runManualLocationJudgment();
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("유지·판정불가는 통지하지 않는다", async () => {
    const announce = vi.fn();
    setManualJudgmentAnnouncer(announce);
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    stubGeolocation({ lat: 37.5384, lng: 127.1432, accuracy: 10 });
    await runManualLocationJudgment();
    expect(announce).not.toHaveBeenCalled();
  });

  it("판정 왕복 중 재지정되면 늦게 온 drop을 폐기한다 (CAS)", async () => {
    setManualLocation({
      label: "A", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    let release: (() => void) | null = null;
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) => {
          release = () =>
            ok({
              coords: {
                latitude: 37.6384, longitude: 127.1432, accuracy: 10,
                altitude: null, altitudeAccuracy: null, heading: null, speed: null,
              },
              timestamp: Date.now(),
            } as GeolocationPosition);
        },
      },
    });
    const pending = runManualLocationJudgment();
    setManualLocation({ label: "B", lat: 37.6, lng: 127.2, origin: null, setAt: 2 });
    release!();
    await pending;
    expect(getManualLocation()?.label).toBe("B");
  });

  it("awaitRealFix는 수동 위치를 무시하고 실좌표만 준다", async () => {
    setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1 });
    stubGeolocation({ lat: 37.9, lng: 127.9, accuracy: 10 });
    const real = await awaitRealFix({ force: true });
    expect(real).toEqual(
      expect.objectContaining({ lat: 37.9, lng: 127.9, accuracy: 10, __source: "real" }),
    );
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm run test:run -- src/lib/__tests__/effective-location.test.ts`
Expected: FAIL — `Failed to resolve import "../effective-location"`

- [ ] **Step 3: 최소 구현을 쓴다**

`src/lib/effective-location.ts`:

```ts
import { awaitGeolocation, getGeolocationSnapshot, type LocateOptions } from "./geolocation";
import { judgeManualLocation, type Fix } from "./manual-location";
import { clearManualLocation, getManualLocation } from "./manual-location-store";

/**
 * **실측위로만 생산되는** fix. 브랜드 필드가 구조적 타이핑을 막아, 수동 좌표로
 * 만든 객체가 실시간 안내 경로에 들어갈 수 없게 한다.
 *
 * ⚠ 초판 설계는 함수 이름(`awaitGeolocation` vs `awaitEffectiveLocation`)으로
 * 막으려 했으나 **이름은 값의 출처를 따라가지 못한다.** 길찾기 조회에서 얻은
 * 수동 좌표가 route state에 저장되면, 안내 시작 함수에 `awaitEffectiveLocation`
 * 호출이 없어도 그 state를 재사용하는 경로로 수동 좌표가 안내에 들어간다.
 */
export interface RealFix extends Fix {
  readonly __source: "real";
}

/** 조회에 쓰는 유효 위치. 출처가 값에 실린다. */
export interface EffectiveLocation {
  lat: number;
  lng: number;
  source: "gps" | "manual";
}

type Announcer = ((verdict: "drop") => void) | null;
let announcer: Announcer = null;

/**
 * 자동 해제 통지 채널. UI 계층이 단일 polite live region을 물린다.
 *
 * ⚠ 자동 해제는 반드시 통지한다. 포커스 밖 텍스트 변경을 VoiceOver는 읽지
 * 않으므로 "표시줄이 말한다"는 사용자가 그 줄로 돌아갈 때만 성립하고,
 * 표시줄이 없는 화면(장소 상세·길찾기)에서 복귀하면 아예 만나지 못한다.
 */
export function setManualJudgmentAnnouncer(fn: Announcer): void {
  announcer = fn;
}

function toRealFix(state: ReturnType<typeof getGeolocationSnapshot>): RealFix | null {
  if (state.status !== "ready") return null;
  return {
    lat: state.coords.lat,
    lng: state.coords.lng,
    // 공유 스토어는 정확도를 보관하지 않는다. 판정 자격 상한과 같은 값을 써서
    // "자격은 있으나 최선은 아닌 fix"로 취급한다 — 이 값이 separation에서
    // 차감되므로 판정은 보수적(유지 쪽)으로 기운다.
    accuracy: state.coords.accuracy ?? 100,
    at: Date.now() / 1000,
    __source: "real",
  };
}

/**
 * 실좌표 전용. 실시간 안내(시작·이탈 재조회·자동차 ETA)만 이 함수를 쓴다.
 * 수동 위치를 절대 보지 않는다.
 */
export async function awaitRealFix(opts: LocateOptions): Promise<RealFix | null> {
  const state = await awaitGeolocation(opts);
  return toRealFix(state);
}

/**
 * 판정 1회. 트리거 3종(포그라운드 복귀 · force 조회 · 앱/탭 시작)이 호출한다.
 *
 * ⚠ 캐시를 읽으면 판정이 성립하지 않는다. 공유 스토어는 TTL이 없어 `ready`
 * 좌표가 세션 최초 값이므로 이동을 영영 놓친다. 그래서 항상 `force:true`다.
 */
export async function runManualLocationJudgment(): Promise<void> {
  const manual = getManualLocation();
  if (!manual) return;
  // origin이 없으면 어떤 fix로도 판정할 수 없다 — 측위 비용을 치르지 않는다.
  if (!manual.origin) return;

  const captured = manual.revision;
  const fix = await awaitRealFix({ force: true });
  const verdict = judgeManualLocation(manual, fix, Date.now() / 1000);
  if (verdict !== "drop") return;

  // CAS: 판정 왕복 중 사용자가 새 위치를 지정했으면 늦게 온 옛 판정이 그것을
  // 지운다. revision이 같을 때만 반영한다.
  if (getManualLocation()?.revision !== captured) return;

  clearManualLocation();
  announcer?.("drop");
}

/**
 * 조회용 유효 위치. "내 주변"·검색 거리·채팅 앵커·길찾기 출발지가 쓴다.
 *
 * `force:true`는 "지금 어디 있는가"를 다시 묻는 행동이므로 수동 위치라도
 * 판정을 동반한다. 이것이 없으면 앱을 켠 채 걸어가는 동안 복귀 트리거가 영영
 * 발화하지 않아 옛 자리로 계속 조회한다.
 */
export async function awaitEffectiveLocation(opts: LocateOptions): Promise<EffectiveLocation | null> {
  if (opts.force) await runManualLocationJudgment();

  const manual = getManualLocation();
  if (manual) return { lat: manual.lat, lng: manual.lng, source: "manual" };

  const state = await awaitGeolocation(opts);
  if (state.status !== "ready") return null;
  return { lat: state.coords.lat, lng: state.coords.lng, source: "gps" };
}
```

- [ ] **Step 4: `Coord`에 선택적 `accuracy`를 더한다**

`src/lib/types.ts`의 `Coord`(72행)에 다음을 추가한다:

```ts
export interface Coord {
  lat: number;
  lng: number;
  /**
   * 측위 정확도(m). 이동 판정이 오차 원을 차감하는 데 쓴다.
   * 기존 소비자는 이 필드를 읽지 않으므로 선택적이다.
   */
  accuracy?: number;
}
```

그리고 `src/lib/geolocation.ts`의 `getCurrentPosition` 성공 핸들러가 `accuracy`를 함께 싣게 한다(현재 `{ lat, lng }`만 저장):

```ts
setState({
  status: "ready",
  coords: {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
  },
});
```

- [ ] **Step 5: 테스트가 통과하는지 확인**

Run: `npm run test:run -- src/lib/__tests__/effective-location.test.ts src/lib/__tests__/geolocation.test.ts`
Expected: PASS (신규 10건 + 기존 geolocation 8건 회귀 없음)

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(location): 출처 타입 봉인 + effective 해석 + 판정 CAS

RealFix 브랜드로 실좌표를 봉인한다. 함수 이름은 값의 출처를 따라가지 못해
route state 재사용 경로로 수동 좌표가 안내에 샌다. force:true 조회가 판정을
동반해 앱을 켠 채 이동하는 경우를 잡는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
  -- src/lib/effective-location.ts src/lib/__tests__/effective-location.test.ts \
     src/lib/geolocation.ts src/lib/types.ts
git show HEAD --stat
```

---

## Task 6: iOS 출처 타입 봉인 + effective 해석 + 판정

**Files:**
- Modify: `ios/Gildongmu/LocationService.swift`
- Create: `ios/Gildongmu/ManualLocationJudge.swift`

**Interfaces:**
- Consumes: `LocationService.shared.currentCoordinate(force:)`, `ManualLocationStore.shared`, `judgeManualLocation` (Task 2)
- Produces: `LocationService.currentFix(force:) async throws(LocationError) -> ManualFix`, `ManualLocationJudge.run() async`, `ManualLocationJudge.effectiveCoordinate(force:) async throws(LocationError) -> NearbyCoord`, `ManualLocationJudge.announcer`

- [ ] **Step 1: `LocationService`에 정확도를 함께 주는 접근자를 더한다**

`ios/Gildongmu/LocationService.swift`의 `coordinateForDisplay()` 아래에 추가:

```swift
    /// 판정용 fix — 좌표에 **정확도와 시각**을 함께 준다.
    ///
    /// `currentCoordinate`는 좌표만 반환해 이동 판정에 쓸 수 없다(오차 원을
    /// 차감하려면 정확도가, 신선도를 보려면 시각이 필요하다).
    func currentFix(force: Bool = false) async throws(LocationError) -> ManualFix {
        _ = try await currentCoordinate(force: force)
        guard let s = stored else { throw LocationError.unavailable }
        return ManualFix(lat: s.coord.lat, lng: s.coord.lng, accuracy: s.accuracy, at: s.fixedAt.timeIntervalSince1970)
    }
```

> `stored`는 `StoredFix(coord, accuracy, fixedAt)`이고 `currentCoordinate`가
> 성공하면 반드시 채워져 있다. `import GildongmuKit`이 파일 상단에 이미 있다.

- [ ] **Step 2: 판정기를 만든다**

`ios/Gildongmu/ManualLocationJudge.swift`:

```swift
import Foundation
import GildongmuKit

/// 수동 위치 이동 판정과 유효 좌표 해석. 웹 `src/lib/effective-location.ts` 미러.
@MainActor
enum ManualLocationJudge {
    /// 자동 해제 통지 채널. 앱 계층이 `AccessibilityNotification.Announcement`를 문다.
    ///
    /// ⚠ 자동 해제는 반드시 통지한다. 포커스 밖 텍스트 변경을 VoiceOver는 읽지
    /// 않으므로 "표시줄이 말한다"는 사용자가 그 줄로 돌아갈 때만 성립하고,
    /// 표시줄이 없는 화면에서 복귀하면 아예 만나지 못한다.
    nonisolated(unsafe) static var announcer: (@MainActor () -> Void)?

    /// 판정 1회. 트리거 3종(scenePhase 복귀 · force 조회 · 앱 시작)이 호출한다.
    static func run() async {
        guard let manual = ManualLocationStore.shared.current else { return }
        // origin이 없으면 어떤 fix로도 판정할 수 없다 — 측위 비용을 치르지 않는다.
        guard manual.origin != nil else { return }
        // 권한이 없으면 팝업을 띄우지 않고 유지한다(증거 부재).
        guard LocationService.shared.authorizationSnapshot == .authorizedWhenInUse
                || LocationService.shared.authorizationSnapshot == .authorizedAlways else { return }

        let captured = manual.revision
        let fix = try? await LocationService.shared.currentFix(force: true)
        let verdict = judgeManualLocation(manual: manual, fix: fix, now: Date().timeIntervalSince1970)
        guard verdict == .drop else { return }

        // CAS: 판정 왕복 중 재지정됐으면 늦게 온 옛 판정을 폐기한다.
        guard ManualLocationStore.shared.current?.revision == captured else { return }

        ManualLocationStore.shared.clear()
        announcer?()
    }

    /// 조회용 유효 좌표. "내 주변"·검색 거리·채팅 앵커·길찾기 출발지가 쓴다.
    ///
    /// `force:true`는 "지금 어디 있는가"를 다시 묻는 행동이므로 수동 위치라도
    /// 판정을 동반한다. 이것이 없으면 앱을 켠 채 걸어가는 동안 복귀 트리거가
    /// 영영 발화하지 않아 옛 자리로 계속 조회한다.
    static func effectiveCoordinate(force: Bool) async throws(LocationService.LocationError) -> NearbyCoord {
        if force { await run() }
        if let manual = ManualLocationStore.shared.current {
            return (lat: manual.lat, lng: manual.lng)
        }
        return try await LocationService.shared.currentCoordinate(force: force)
    }
}
```

- [ ] **Step 3: 빌드 확인**

Run: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -configuration Debug -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|\*\* BUILD"`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(location): iOS effective 좌표 해석 + 판정 CAS

currentFix가 정확도·시각을 함께 준다(좌표만으로는 오차 원 차감·신선도 판정이
불가능). 권한이 없으면 팝업 없이 유지한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
  -- ios/Gildongmu/LocationService.swift ios/Gildongmu/ManualLocationJudge.swift \
     ios/Gildongmu.xcodeproj/project.pbxproj
git show HEAD --stat
```

---

## Task 7: 웹 관문 배선 + 우선순위 + 트리거 2종

**Files:**
- Modify: `src/hooks/useNearbyFetch.ts:143`
- Modify: `src/components/PlaceSearch.tsx:405-407`
- Create: `src/hooks/useManualLocationJudgment.ts`
- Create: `src/hooks/__tests__/useNearbyFetch.manual.test.tsx`

**Interfaces:**
- Consumes: `awaitEffectiveLocation`, `runManualLocationJudgment` (Task 5)
- Produces: `useManualLocationJudgment()` — 마운트 시 1회 + `visibilitychange` 판정

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/hooks/__tests__/useNearbyFetch.manual.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetGeolocationForTest } from "@/lib/geolocation";
import { __resetManualLocationForTest, setManualLocation } from "@/lib/manual-location-store";
import { useNearbyFetch } from "../useNearbyFetch";

const fetchAt = vi.fn(async (lat: number, lng: number) => ({ lat, lng }));

function Probe({ place }: { place?: { lat: number; lng: number } }) {
  const { status, load } = useNearbyFetch<{ lat: number; lng: number }>({
    source: place ? { kind: "place", ...place } : { kind: "current" },
    fetchAt: (lat, lng) => fetchAt(lat, lng),
    parse: (d) => d,
  });
  return (
    <>
      <button onClick={() => load(false)}>조회</button>
      <output>{status.kind === "done" ? `${status.data.lat},${status.data.lng}` : status.kind}</output>
    </>
  );
}

describe("useNearbyFetch — 수동 위치 배선", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetGeolocationForTest();
    __resetManualLocationForTest();
    fetchAt.mockClear();
  });

  it("수동 위치가 있으면 그 좌표로 조회한다", async () => {
    setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1 });
    render(<Probe />);
    screen.getByRole("button", { name: "조회" }).click();
    await waitFor(() => expect(fetchAt).toHaveBeenCalledWith(37.5384, 127.1432));
  });

  it("장소 앵커는 수동 위치보다 우선한다", async () => {
    setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1 });
    render(<Probe place={{ lat: 37.9, lng: 127.9 }} />);
    screen.getByRole("button", { name: "조회" }).click();
    await waitFor(() => expect(fetchAt).toHaveBeenCalledWith(37.9, 127.9));
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm run test:run -- src/hooks/__tests__/useNearbyFetch.manual.test.tsx`
Expected: FAIL — 첫 케이스가 `fetchAt`을 수동 좌표로 부르지 않는다(공유 스토어 좌표를 쓴다)

- [ ] **Step 3: 관문을 바꾼다**

`src/hooks/useNearbyFetch.ts` 상단 import에 추가:

```ts
import { awaitEffectiveLocation } from "@/lib/effective-location";
```

143행 부근의 `void awaitGeolocation({ force }).then((g) => { … })` 블록을 다음으로 교체한다. `source.kind === "place"` 선분기(136-139행)는 **그대로 둔다** — 장소 앵커가 수동 위치보다 우선한다는 계약이 그 선분기다.

```ts
    setStatus({ kind: "locating" });
    // 수동 위치가 있으면 그 좌표를, 없으면 공유 스토어 좌표를 쓴다.
    // force:true는 "지금 어디 있는가"를 다시 묻는 행동이라 수동 위치라도
    // 이동 판정을 동반한다(effective-location.ts).
    void awaitEffectiveLocation({ force }).then((eff) => {
      if (seqRef.current !== id) {
        unlock();
        return;
      }
      if (eff) {
        if (coverage === "korea" && !isInKorea(eff.lat, eff.lng)) {
          setStatus({ kind: "outOfCoverage" });
          unlock();
          return;
        }
        void run(eff.lat, eff.lng).finally(unlock);
      } else {
        const g = getGeolocationSnapshot();
        setStatus(
          prevStatus.kind === "done"
            ? prevStatus
            : {
                kind: "geoerror",
                reason: g.status === "unsupported" ? "unsupported" : "denied",
              },
        );
        unlock();
      }
    });
```

`awaitGeolocation` import를 `getGeolocationSnapshot`으로 바꾼다.

- [ ] **Step 4: 트리거 훅을 만든다**

`src/hooks/useManualLocationJudgment.ts`:

```ts
"use client";

import { useEffect } from "react";
import { runManualLocationJudgment } from "@/lib/effective-location";

/**
 * 판정 트리거 ①(탭이 보이는 상태로 돌아옴) + ③(탭 시작).
 * ②(force 조회)는 `awaitEffectiveLocation`이 스스로 처리한다.
 *
 * ⚠ 트리거 ③이 없으면 웹은 탭을 닫는 순간 모듈 싱글턴이 초기화되는데
 * `localStorage`의 수동 위치는 남아, 다른 도시에서 새 탭을 열어도 옛 위치로
 * 조회하고 **영원히 교정되지 않는다**.
 */
export function useManualLocationJudgment(): void {
  useEffect(() => {
    void runManualLocationJudgment();
    const onVisible = () => {
      if (document.visibilityState === "visible") void runManualLocationJudgment();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
}
```

- [ ] **Step 5: 앱 진입점에 건다**

`src/components/PlaceSearch.tsx`의 컴포넌트 본문 상단(기존 `useGeolocation()` 호출 근처)에 추가:

```tsx
  useManualLocationJudgment();
```

import를 더한다: `import { useManualLocationJudgment } from "@/hooks/useManualLocationJudgment";`

- [ ] **Step 6: 테스트가 통과하는지 확인**

Run: `npm run test:run -- src/hooks/__tests__ src/components/__tests__/nearby-contract.tsx`
Expected: PASS — 신규 2건 + nearby 계약 스위트 회귀 없음

- [ ] **Step 7: 커밋**

```bash
git commit -m "feat(location): 웹 관문 배선 — 내 주변 10종이 수동 위치를 탄다

장소 앵커 선분기는 그대로 둔다(앵커 > 수동 > GPS). 트리거 ③(탭 시작)이
없으면 다른 도시에서 새 탭을 열어도 옛 위치로 조회하고 영원히 교정되지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
  -- src/hooks/useNearbyFetch.ts src/hooks/useManualLocationJudgment.ts \
     src/hooks/__tests__/useNearbyFetch.manual.test.tsx src/components/PlaceSearch.tsx
git show HEAD --stat
```

---

## Task 8: iOS 관문 배선 + 트리거 2종

**Files:**
- Modify: `ios/Gildongmu/Nearby/NearbyLoadState.swift:63-83`
- Modify: `ios/Gildongmu/GildongmuApp.swift`

**Interfaces:**
- Consumes: `ManualLocationJudge.effectiveCoordinate(force:)` (Task 6)
- Produces: 없음(기존 `nearbyCoordinateSource()` 시그니처 유지)

- [ ] **Step 1: 관문을 바꾼다**

`ios/Gildongmu/Nearby/NearbyLoadState.swift`의 `nearbyCoordinateSource()` 안에서 `LocationService.shared.currentCoordinate(force: force)` 호출을 `ManualLocationJudge.effectiveCoordinate(force: force)`로 교체한다. **오류 번역표(`LocationError` → `NearbyLocationError`)는 그대로 둔다** — `effectiveCoordinate`가 같은 `LocationError`를 던진다.

```swift
extension LocationService {
    /// "내 주변" 11개 화면의 단일 좌표 관문.
    ///
    /// 수동 위치가 있으면 그 좌표를 쓴다(`ManualLocationJudge`). `.fixed`(장소
    /// 앵커)는 이 클로저를 아예 거치지 않으므로 앵커 > 수동 > GPS 우선순위가
    /// `NearbyLoadCore`의 switch에서 구조적으로 성립한다.
    static func nearbyCoordinateSource() -> NearbyCoordinateSource {
        .current { force in
            do {
                return try await ManualLocationJudge.effectiveCoordinate(force: force)
            } catch {
                // (기존 오류 번역표 그대로)
            }
        }
    }
}
```

- [ ] **Step 2: scenePhase 트리거를 건다**

`ios/Gildongmu/GildongmuApp.swift`의 `WindowGroup` 본문에 추가:

```swift
        .onChange(of: scenePhase) { _, phase in
            // 판정 트리거 ①. ②(force 조회)는 effectiveCoordinate가, ③(앱 시작)은
            // init 직후 이 onChange가 .active로 한 번 발화하며 함께 처리된다.
            guard phase == .active else { return }
            Task { await ManualLocationJudge.run() }
        }
```

`@Environment(\.scenePhase) private var scenePhase`를 `App` 구조체에 더한다.

- [ ] **Step 3: 통지 채널을 연결한다**

같은 파일의 `init()` 또는 `.task`에 추가:

```swift
        ManualLocationJudge.announcer = {
            // 자동 해제는 사용자가 요청하지 않은 상태 변경이라 polite로 낸다.
            AccessibilityNotification.Announcement(
                appLocalized("manualLocation.autoCleared")
            ).post()
        }
```

- [ ] **Step 4: 빌드 + Kit 테스트 확인**

Run: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -configuration Debug -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|\*\* BUILD"` 그리고 `swift test --package-path ios/GildongmuKit`
Expected: `** BUILD SUCCEEDED **` · Kit 테스트 전량 통과

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(location): iOS 관문 배선 + scenePhase 판정 트리거

nearbyCoordinateSource 한 곳이 11개 화면의 관문이라 여기만 바꾸면 전부
따라온다. .fixed(장소 앵커)는 이 클로저를 거치지 않아 우선순위가 구조적으로
성립한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
  -- ios/Gildongmu/Nearby/NearbyLoadState.swift ios/Gildongmu/GildongmuApp.swift
git show HEAD --stat
```

---

## Task 9: 웹 주소→좌표 공용 추출 (오류 5-state)

**Files:**
- Create: `src/lib/resolve-address-coord.ts`
- Create: `src/lib/__tests__/resolve-address-coord.test.ts`
- Modify: `src/components/PlaceSearch.tsx:581-608`
- Modify: `src/components/DirectionsView.tsx:1131-1156`

**Interfaces:**
- Produces: `AddressResolution` 유니온, `resolveAddressCoord(roadAddr, signal?)`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/__tests__/resolve-address-coord.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAddressCoord } from "../resolve-address-coord";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })));
}

describe("resolveAddressCoord", () => {
  it("좌표를 찾으면 resolved", async () => {
    stubFetch(200, { matches: [{ lat: 37.5, lng: 127.1, addressName: "서울 강동구 성내로 12" }] });
    expect(await resolveAddressCoord("서울 강동구 성내로 12")).toEqual({
      kind: "resolved", lat: 37.5, lng: 127.1,
    });
  });

  it("매칭 0건은 empty", async () => {
    stubFetch(200, { matches: [] });
    expect(await resolveAddressCoord("없는 주소")).toEqual({ kind: "empty" });
  });

  it("upstream 실패는 failed — empty로 뭉개지 않는다", async () => {
    stubFetch(502, {});
    expect(await resolveAddressCoord("서울 강동구 성내로 12")).toEqual({ kind: "failed" });
  });

  it("네트워크 예외도 failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await resolveAddressCoord("서울 강동구 성내로 12")).toEqual({ kind: "failed" });
  });

  it("빈 질의는 invalid", async () => {
    expect(await resolveAddressCoord("   ")).toEqual({ kind: "invalid" });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm run test:run -- src/lib/__tests__/resolve-address-coord.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현을 쓴다**

`src/lib/resolve-address-coord.ts`:

```ts
/**
 * 주소 문자열 → 좌표. 홈 검색(`PlaceSearch`)과 길찾기 검색(`DirectionsView`)에
 * **복붙 2벌**로 존재하던 로직의 단일 정본이다. 수동 위치 선택기가 세 번째
 * 소비자가 되므로 여기서 합친다.
 *
 * ⚠ 오류 계약까지 공용화한다. upstream 502를 빈 배열로 정규화하면 사용자가
 * 서비스 실패인데도 "검색 결과가 없습니다"를 듣는다.
 */
export type AddressResolution =
  | { kind: "resolved"; lat: number; lng: number }
  | { kind: "empty" }
  | { kind: "failed" }
  | { kind: "invalid" };

export async function resolveAddressCoord(
  roadAddr: string,
  signal?: AbortSignal,
): Promise<AddressResolution> {
  const query = roadAddr.trim();
  if (!query) return { kind: "invalid" };

  try {
    const res = await fetch(
      `/api/geocode?query=${encodeURIComponent(query)}&limit=1`,
      { signal },
    );
    if (!res.ok) return { kind: "failed" };
    const data = (await res.json()) as { matches?: Array<{ lat: number; lng: number }> };
    const first = data.matches?.[0];
    if (!first) return { kind: "empty" };
    return { kind: "resolved", lat: first.lat, lng: first.lng };
  } catch {
    return { kind: "failed" };
  }
}
```

- [ ] **Step 4: 두 복붙 지점을 이 함수로 교체한다**

`PlaceSearch.tsx`의 `onSelectAddress`(581-608행)와 `DirectionsView.tsx`의 `selectAddress`(1131-1156행)에서 각자의 fetch·파싱 블록을 `resolveAddressCoord`로 바꾼다. **각 호출부의 in-flight ref 가드와 통지 문구는 그대로 둔다** — 그것은 UI 계약이지 해석 로직이 아니다. `kind`별 분기:

```ts
const r = await resolveAddressCoord(roadAddrPart1 || a.roadAddr);
if (r.kind === "resolved") { /* 기존 성공 경로 */ }
else if (r.kind === "empty") { announce(t("candidateNone")); }
else { announce(t("coordError")); }
```

- [ ] **Step 5: 테스트가 통과하는지 확인**

Run: `npm run test:run`
Expected: 전량 PASS(신규 5건 + `PlaceSearch`·`DirectionsView` 기존 스위트 회귀 없음)

- [ ] **Step 6: 커밋**

```bash
git commit -m "refactor(search): 주소→좌표 해석 공용화 (복붙 2벌 해소) + 오류 5-state

upstream 502를 빈 배열로 정규화하면 서비스 실패가 '결과 없음'으로 낭독된다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
  -- src/lib/resolve-address-coord.ts src/lib/__tests__/resolve-address-coord.test.ts \
     src/components/PlaceSearch.tsx src/components/DirectionsView.tsx
git show HEAD --stat
```

---

## Task 10: 웹 표시줄 + 검색 모달 연결

**Files:**
- Create: `src/components/LocationBar.tsx`
- Create: `src/components/__tests__/LocationBar.test.tsx`
- Modify: `src/components/PlaceSearch.tsx` · `src/components/NearbyHub.tsx`

**Interfaces:**
- Consumes: `useManualLocation` (Task 3), `setManualLocation`/`clearManualLocation` (Task 3), `resolveAddressCoord` (Task 9), `useGeolocation`
- Produces: `<LocationBar onPick={() => void} />`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/components/__tests__/LocationBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ko.json";
import { __resetGeolocationForTest } from "@/lib/geolocation";
import { __resetManualLocationForTest, getManualLocation, setManualLocation } from "@/lib/manual-location-store";
import { LocationBar } from "../LocationBar";

function renderBar(onPick = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <LocationBar onPick={onPick} />
    </NextIntlClientProvider>,
  );
}

describe("LocationBar", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetGeolocationForTest();
    __resetManualLocationForTest();
  });

  it("수동 위치가 없으면 지정 버튼만 있다", () => {
    renderBar();
    expect(screen.getByRole("button", { name: /현재 위치/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "지정 해제" })).toBeNull();
  });

  it("수동 위치가 있으면 '지정한 위치'로 읽히고 해제 버튼이 형제로 생긴다", () => {
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: 1 }, setAt: 1,
    });
    renderBar();
    const pick = screen.getByRole("button", { name: "지정한 위치, 길동 카페" });
    const clear = screen.getByRole("button", { name: "지정 해제" });
    // 중첩 인터랙티브 금지 — 두 버튼은 형제여야 한다.
    expect(pick.contains(clear)).toBe(false);
    expect(clear.contains(pick)).toBe(false);
  });

  it("origin이 없으면 확인 불가를 병기한다", () => {
    setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1 });
    renderBar();
    expect(screen.getByRole("button", { name: "지정한 위치, 길동 카페(위치 확인 불가)" })).toBeTruthy();
  });

  it("해제하면 포커스가 지정 버튼으로 이동한다", async () => {
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: 1 }, setAt: 1,
    });
    renderBar();
    await userEvent.click(screen.getByRole("button", { name: "지정 해제" }));
    expect(getManualLocation()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /현재 위치/ }));
  });

  it("지정 버튼을 누르면 onPick이 불린다", async () => {
    const onPick = vi.fn();
    renderBar(onPick);
    await userEvent.click(screen.getByRole("button", { name: /현재 위치/ }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm run test:run -- src/components/__tests__/LocationBar.test.tsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현을 쓴다**

`src/components/LocationBar.tsx`:

```tsx
"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useManualLocation } from "@/hooks/useManualLocation";
import { clearManualLocation } from "@/lib/manual-location-store";

/**
 * 현재 위치 표시줄. **형제 버튼 둘**이다(중첩 인터랙티브 금지).
 *
 * 상태 텍스트는 지정 버튼의 접근 가능한 이름에 포함한다(한 줄 = 한 객체).
 * 수동 위치가 켜져 있으면 "현재 위치"라는 표현을 쓰지 않는다 — GPS가 알아낸
 * 위치와 사용자가 지정한 위치는 다른 것이고 시각장애 사용자는 화면으로
 * 구분할 수 없다.
 */
export function LocationBar({ onPick }: { onPick: () => void }) {
  const t = useTranslations("manualLocation");
  const manual = useManualLocation();
  const geo = useGeolocation();
  const pickRef = useRef<HTMLButtonElement>(null);

  const label = manual
    ? manual.origin
      ? t("manual", { label: manual.label })
      : t("manualUnverifiable", { label: manual.label })
    : geo.status === "ready"
      ? t("gps")
      : geo.status === "locating"
        ? t("locating")
        : t("gpsFailed");

  return (
    <div className="flex items-center gap-2">
      <button
        ref={pickRef}
        type="button"
        onClick={onPick}
        className="min-h-11 flex-1 text-left underline"
      >
        {label}
      </button>
      {manual && (
        <button
          type="button"
          onClick={() => {
            clearManualLocation();
            // 자기를 없애는 버튼이라 포커스가 body로 이탈한다. 계속 존재하는
            // 지정 버튼으로 옮긴다(헌장 §5).
            pickRef.current?.focus();
          }}
          className="min-h-11 min-w-11 underline"
        >
          {t("clear")}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 두 화면에 붙인다**

`PlaceSearch.tsx`의 홈 렌더(`SearchBar` 위)와 `NearbyHub.tsx`의 목록 위에 각각:

```tsx
<LocationBar onPick={() => setManualPickerOpen(true)} />
```

`manualPickerOpen`이 true면 기존 검색 UI를 재사용해 장소를 고르고, 선택 시 다음을 호출한다. **`origin`은 지정 시점의 적격 실측 fix**이고, 없으면 `null`로 둔다(판정이 `undecidable`이 된다).

```tsx
import { awaitRealFix } from "@/lib/effective-location";
import { isEligibleFix } from "@/lib/manual-location";
import { setManualLocation } from "@/lib/manual-location-store";

async function commitManual(label: string, lat: number, lng: number) {
  const fix = await awaitRealFix({ force: true });
  const now = Date.now() / 1000;
  const origin = fix && isEligibleFix(fix, now)
    ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, at: fix.at }
    : null;
  setManualLocation({ label, lat, lng, origin, setAt: now });
}
```

- [ ] **Step 5: 테스트가 통과하는지 확인**

Run: `npm run test:run -- src/components/__tests__/`
Expected: PASS — 신규 5건 + 기존 컴포넌트 스위트 회귀 없음

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(location): 웹 표시줄 — 형제 버튼 둘 + 포커스 계약

행 전체를 버튼으로 만들고 안에 해제 버튼을 넣으면 중첩 인터랙티브가 된다.
해제 버튼은 자기를 없애므로 포커스를 지정 버튼으로 선점 이동한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
  -- src/components/LocationBar.tsx src/components/__tests__/LocationBar.test.tsx \
     src/components/PlaceSearch.tsx src/components/NearbyHub.tsx
git show HEAD --stat
```

---

## Task 11: iOS 표시줄 + 검색 모달 연결

**Files:**
- Create: `ios/Gildongmu/LocationBarView.swift`
- Modify: `ios/Gildongmu/SearchView.swift` · `Chat/ChatConversationView.swift` · `NearbyHubView.swift` · `Directions/DirectionsEndpointSearchView.swift`

**Interfaces:**
- Consumes: `ManualLocationStore.shared`, `LocationService.shared.currentFix(force:)` (Task 6)
- Produces: `LocationBarView()` — 자체적으로 sheet를 띄운다

- [ ] **Step 1: 표시줄 뷰를 만든다**

`ios/Gildongmu/LocationBarView.swift`:

```swift
import SwiftUI
import GildongmuKit

/// 현재 위치 표시줄. **형제 버튼 둘**이다(중첩 인터랙티브 금지).
///
/// 수동 위치가 켜져 있으면 "현재 위치"라는 표현을 쓰지 않는다.
struct LocationBarView: View {
    @State private var store = ManualLocationStore.shared
    @State private var pickerOpen = false
    @AccessibilityFocusState private var pickFocused: Bool

    var body: some View {
        HStack {
            Button(label) { pickerOpen = true }
                .frame(minHeight: 44)
                .accessibilityFocused($pickFocused)
            if store.current != nil {
                Button(appLocalized("manualLocation.clear")) {
                    store.clear()
                    // 자기를 없애는 버튼이라 포커스가 이탈한다. 계속 존재하는
                    // 지정 버튼으로 옮긴다(헌장 §5).
                    pickFocused = true
                }
                .frame(minWidth: 44, minHeight: 44)
            }
        }
        .sheet(isPresented: $pickerOpen) {
            DirectionsEndpointSearchView(target: .manualLocation) { endpoint in
                Task { await commit(endpoint) }
            }
        }
    }

    private var label: String {
        guard let m = store.current else {
            return appLocalized("manualLocation.gps")
        }
        return m.origin == nil
            ? appLocalized("manualLocation.manualUnverifiable", m.label)
            : appLocalized("manualLocation.manual", m.label)
    }

    @MainActor
    private func commit(_ endpoint: DirectionsEndpoint) async {
        switch endpoint {
        case .current:
            store.clear()   // 이 맥락에서 "현재 위치 사용"은 해제를 뜻한다
        case .place(let label, let lat, let lng):
            // origin은 지정 시점의 적격 실측 fix. 없으면 판정이 undecidable이 된다.
            let fix = try? await LocationService.shared.currentFix(force: true)
            let now = Date().timeIntervalSince1970
            let origin = fix.flatMap { isEligibleManualFix($0, now: now) ? $0 : nil }
            store.set(label: label, lat: lat, lng: lng, origin: origin)
        }
    }
}
```

- [ ] **Step 2: 검색 시트를 일반화한다**

`DirectionsEndpointSearchView.swift`의 `DirectionsFieldTarget`(정의는 `DirectionsTabView.swift:21-24`)에 `case manualLocation`을 더하고, 163-166행의 "현재 위치 사용" 노출 조건을 바꾼다:

```swift
// 출발지에서는 "현재 위치 사용"이 GPS 선택을, 수동 위치 지정 맥락에서는
// 지정 해제를 뜻한다. 도착지에는 노출하지 않는다(스왑이 담당).
if target == .from || target == .manualLocation {
    Button(appLocalized(target == .manualLocation
                        ? "manualLocation.useGps"
                        : "directions.useCurrentLocation")) {
        select(.current)
    }
}
```

- [ ] **Step 3: 세 탭에 붙인다**

- `SearchView.swift:35`의 마이크 Section **앞**에 `Section { LocationBarView() }`. 28행 주석을 "마이크는 위치 표시줄 다음 행"으로 갱신한다.
- `NearbyHubView.swift:8`의 `List` 첫 자식에 `Section { LocationBarView() }`.
- `Chat/ChatConversationView.swift:52`의 `VStack(spacing: 0)` 첫 자식에 `LocationBarView().padding(.horizontal)`.

- [ ] **Step 4: 빌드 확인**

Run: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -configuration Debug -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|\*\* BUILD"`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(location): iOS 표시줄 3탭 + 검색 시트 일반화

DirectionsEndpointSearchView에 manualLocation 타깃을 더해 재사용한다.
검색 탭에서는 위치줄이 마이크 행보다 앞이라 주석도 함께 갱신했다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
  -- ios/Gildongmu/LocationBarView.swift ios/Gildongmu/SearchView.swift \
     ios/Gildongmu/NearbyHubView.swift ios/Gildongmu/Chat/ChatConversationView.swift \
     ios/Gildongmu/Directions/DirectionsEndpointSearchView.swift \
     ios/Gildongmu/Directions/DirectionsTabView.swift ios/Gildongmu.xcodeproj/project.pbxproj
git show HEAD --stat
```

---

## Task 12: 웹 길찾기 출발지 + 안내 fail-closed

**Files:**
- Modify: `src/components/DirectionsView.tsx:436-458` · `src/hooks/useRouteGuide.ts:644,721`
- Create: `src/hooks/__tests__/useRouteGuide.realfix.test.ts`

**Interfaces:**
- Consumes: `awaitEffectiveLocation`, `awaitRealFix` (Task 5)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/hooks/__tests__/useRouteGuide.realfix.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 안내 경로가 수동 위치를 절대 보지 않는다는 소스 가드.
 *
 * ⚠ 이 가드는 타입 봉인의 **보조**다. 정본은 `awaitRealFix`가 `RealFix`를
 * 반환하고 안내 함수들이 그 타입만 받는 것이며, 이 테스트는 실수로
 * `awaitEffectiveLocation`을 import 하는 것을 커밋 시점에 잡는다.
 */
describe("useRouteGuide — 실좌표 봉인", () => {
  const src = readFileSync("src/hooks/useRouteGuide.ts", "utf8");

  it("awaitEffectiveLocation을 import 하지 않는다", () => {
    expect(src).not.toMatch(/awaitEffectiveLocation/);
  });

  it("awaitRealFix를 쓴다", () => {
    expect(src).toMatch(/awaitRealFix/);
  });

  it("manual-location-store를 참조하지 않는다", () => {
    expect(src).not.toMatch(/manual-location-store/);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm run test:run -- src/hooks/__tests__/useRouteGuide.realfix.test.ts`
Expected: FAIL — "awaitRealFix를 쓴다"가 실패(아직 `awaitGeolocation`을 쓴다)

- [ ] **Step 3: 안내 경로를 `awaitRealFix`로 바꾼다**

`useRouteGuide.ts`의 두 지점(644행 `fetchGuideRoute`, 721행 `refreshCarEta`)에서 `awaitGeolocation({ force })` → `awaitRealFix({ force })`로 교체하고, 반환 형태가 `GeoState`에서 `RealFix | null`로 바뀌므로 `g.status === "ready"` 분기를 `if (!fix) return null;`로 바꾼다. import를 `@/lib/effective-location`으로 옮긴다.

```ts
  const fix = await awaitRealFix({ force });
  // fail-closed: 실좌표가 없으면 안내를 시작하지 않는다. 수동 위치로 만든
  // 기존 경로 기하를 재사용하면 첫 실제 fix에서 즉시 이탈 판정이 난다.
  if (!fix) return null;
```

- [ ] **Step 4: 길찾기 출발지를 effective로 바꾼다**

`DirectionsView.tsx` 438행의 `awaitGeolocation()`을 `awaitEffectiveLocation({ force: false })`로 바꾸고, 결과의 `source`를 조회 결과 state에 실어 안내 시작 버튼이 읽을 수 있게 한다. 387행의 "현재 위치 사용" 버튼은 `awaitEffectiveLocation({ force: true })`로 바꾼다(force가 판정을 동반한다).

안내 시작 핸들러에 가드를 더한다:

```ts
  // 수동 위치로 만든 경로에서 안내를 시작하면 실좌표로 다시 조회한다.
  // 실패하면 그 사실을 말한다 — 침묵하거나 "경로를 찾을 수 없습니다"로
  // 뭉개면 사용자가 원인을 알 수 없다.
  if (originSource === "manual") {
    announce(t("guideNeedsRealLocation"));
  }
```

- [ ] **Step 5: 테스트가 통과하는지 확인**

Run: `npm run test:run -- src/hooks/__tests__ src/components/__tests__/DirectionsView.test.tsx`
Expected: PASS — 신규 3건 + 기존 DirectionsView 스위트 회귀 없음

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(guide): 웹 안내 경로를 실좌표로 봉인 + 길찾기 출발지 effective

안내 시작·ETA는 RealFix만 받는다. 실좌표를 못 얻으면 기존 경로 기하를
재사용하지 않고 실패시킨다(fail-closed) — 재사용하면 첫 실제 fix에서 즉시
이탈 판정이 난다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
  -- src/hooks/useRouteGuide.ts src/components/DirectionsView.tsx \
     src/hooks/__tests__/useRouteGuide.realfix.test.ts
git show HEAD --stat
```

---

## Task 13: iOS 길찾기 출발지 + 안내 fail-closed

**Files:**
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift:152,165,202` · `ios/Gildongmu/Directions/BeaconModel.swift`

**Interfaces:**
- Consumes: `ManualLocationJudge.effectiveCoordinate(force:)` (Task 6)

- [ ] **Step 1: 출발지 해석을 effective로 바꾼다**

`DirectionsTabView.swift`에서:
- 165행 `currentCoordinate(force: true)` → `ManualLocationJudge.effectiveCoordinate(force: true)`
- 202행 `currentCoordinate()` → `ManualLocationJudge.effectiveCoordinate(force: false)`
- 152행 `coordinateForDisplay()`는 **그대로 둔다** — 주소 병기용이고 수동일 때는 `currentLocationText`가 라벨을 대체한다.

`currentLocationText`(842-848행)에 수동 분기를 더한다:

```swift
    private var currentLocationText: String {
        if let m = ManualLocationStore.shared.current {
            // 수동 위치가 켜져 있으면 "현재 위치"라는 표현을 쓰지 않는다.
            return appLocalized("manualLocation.manual", m.label)
        }
        if model.isRefreshingCurrent { return appLocalized("directions.refreshingCurrent") }
        if let address = model.currentAddress { return appLocalized("directions.currentLocationNear", address) }
        return appLocalized("directions.currentLocation")
    }
```

- [ ] **Step 2: `BeaconModel`이 실좌표만 쓰는지 확인한다**

`BeaconModel.swift`의 좌표 취득 지점(262·266·272·274·287·327·509·594·693·1350행)은 전부 `LocationService.shared`의 스트림·`currentCoordinate`를 직접 쓴다. **`ManualLocationJudge`를 import 하지 않는다**는 것을 확인만 하고 변경하지 않는다.

안내 시작 진입점에 가드를 더한다:

```swift
        // 수동 위치로 만든 경로에서 안내를 시작하면 실좌표가 필요하다.
        // 침묵하거나 일반 오류로 뭉개면 사용자가 원인을 알 수 없다.
        if ManualLocationStore.shared.current != nil {
            AccessibilityNotification.Announcement(
                appLocalized("manualLocation.guideNeedsRealLocation")
            ).post()
        }
```

- [ ] **Step 3: 소스 가드 테스트를 더한다**

`ios/GildongmuKit/Tests/GildongmuKitTests/ManualLocationTests.swift`에 추가:

```swift
@Test func 안내_모델이_수동_위치를_참조하지_않는다() throws {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url.deleteLastPathComponent() }
    url.appendPathComponent("ios/Gildongmu/Directions/BeaconModel.swift")
    let src = try String(contentsOf: url, encoding: .utf8)
    #expect(!src.contains("effectiveCoordinate"), "안내는 실좌표만 쓴다")
}
```

- [ ] **Step 4: 빌드 + 테스트 확인**

Run: `swift test --package-path ios/GildongmuKit --filter ManualLocation` 그리고 `xcodebuild … -configuration Debug … build`
Expected: 테스트 3건 PASS · `** BUILD SUCCEEDED **`

- [ ] **Step 5: 커밋**

```bash
git commit -m "feat(guide): iOS 길찾기 출발지 effective + 안내 실좌표 봉인 가드

BeaconModel이 effectiveCoordinate를 참조하지 않는다는 소스 가드를 더했다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
  -- ios/Gildongmu/Directions/DirectionsTabView.swift ios/Gildongmu/Directions/BeaconModel.swift \
     ios/GildongmuKit/Tests/GildongmuKitTests/ManualLocationTests.swift
git show HEAD --stat
```

---

## Task 14: i18n 6로케일 + 문구 게이트

**Files:**
- Modify: `messages/{ko,en,es,fr,it,ja}.json`
- Modify: `ios/Gildongmu/Resources/Localizable.xcstrings`
- Create: `src/lib/__tests__/manual-location-copy.test.ts`

**Interfaces:**
- Produces: `manualLocation` 네임스페이스 8키

- [ ] **Step 1: 실패하는 문구 게이트 테스트를 쓴다**

`src/lib/__tests__/manual-location-copy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import ko from "../../../messages/ko.json";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import it_ from "../../../messages/it.json";
import ja from "../../../messages/ja.json";

const LOCALES = { ko, en, es, fr, it: it_, ja } as Record<string, Record<string, unknown>>;
const KEYS = [
  "gps", "locating", "gpsFailed", "manual", "manualUnverifiable",
  "clear", "useGps", "autoCleared", "guideNeedsRealLocation",
];

describe("manualLocation 문구", () => {
  it.each(Object.keys(LOCALES))("%s에 9키가 전부 있다", (locale) => {
    const ns = LOCALES[locale].manualLocation as Record<string, string> | undefined;
    expect(ns).toBeDefined();
    for (const k of KEYS) expect(typeof ns![k]).toBe("string");
  });

  it.each(Object.keys(LOCALES))("%s의 수동 문구에 '현재 위치' 계열 표현이 없다", (locale) => {
    const ns = LOCALES[locale].manualLocation as Record<string, string>;
    // 수동 상태 문구가 GPS 상태 문구와 같은 말을 쓰면 시각장애 사용자가
    // 위치 출처를 구분할 수 없다.
    expect(ns.manual).not.toBe(ns.gps);
    expect(ns.manualUnverifiable).not.toBe(ns.gps);
    expect(ns.manual).toContain("{label}");
    expect(ns.manualUnverifiable).toContain("{label}");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm run test:run -- src/lib/__tests__/manual-location-copy.test.ts`
Expected: FAIL — `manualLocation` 네임스페이스 없음

- [ ] **Step 3: ko 문구를 넣는다**

`messages/ko.json` 최상위에 추가:

```json
  "manualLocation": {
    "gps": "현재 위치",
    "locating": "현재 위치 확인 중",
    "gpsFailed": "위치를 확인할 수 없습니다",
    "manual": "지정한 위치, {label}",
    "manualUnverifiable": "지정한 위치, {label}(위치 확인 불가)",
    "clear": "지정 해제",
    "useGps": "현재 위치로 되돌리기",
    "autoCleared": "이동이 감지되어 지정한 위치를 해제했습니다",
    "guideNeedsRealLocation": "실시간 안내는 실제 위치가 필요합니다"
  },
```

나머지 5로케일에 같은 키를 각 언어로 넣는다. `{label}` 자리표시자를 유지한다.

| 키 | en |
|---|---|
| `gps` | `Current location` |
| `locating` | `Checking current location` |
| `gpsFailed` | `Location unavailable` |
| `manual` | `Set location, {label}` |
| `manualUnverifiable` | `Set location, {label} (cannot verify)` |
| `clear` | `Clear set location` |
| `useGps` | `Back to current location` |
| `autoCleared` | `Movement detected. The set location was cleared.` |
| `guideNeedsRealLocation` | `Live guidance needs your actual location.` |

- [ ] **Step 4: iOS xcstrings에 같은 9키를 넣는다**

`ios/Gildongmu/Resources/Localizable.xcstrings`에 `manualLocation.<key>` 형태로 9키 × 6로케일. **`{label}`은 iOS에서 `%@` 위치 인자**가 되므로 `appLocalized("manualLocation.manual", m.label)` 호출부와 순서를 맞춘다.

- [ ] **Step 5: 테스트가 통과하는지 확인**

Run: `npm run test:run -- src/lib/__tests__/manual-location-copy.test.ts src/i18n/__tests__/i18n-messages.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(i18n): 수동 위치 문구 9키 × 6로케일 (웹·iOS)

수동 상태 문구가 GPS 문구와 같으면 시각장애 사용자가 위치 출처를 구분할 수
없다. 게이트 테스트가 그 동일성을 막는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
  -- messages/ko.json messages/en.json messages/es.json messages/fr.json \
     messages/it.json messages/ja.json ios/Gildongmu/Resources/Localizable.xcstrings \
     src/lib/__tests__/manual-location-copy.test.ts
git show HEAD --stat
```

---

## Task 15: 변이 주입 검증 + 최종 게이트

**Files:** 없음(검증 전용). 변이는 확인 후 **전부 되돌린다**.

- [ ] **Step 1: 변이 9종을 하나씩 주입하고 red를 확인한다**

각 변이마다 해당 테스트를 돌려 **실패하는지** 확인하고 즉시 되돌린다. 통과해 버리면 그 축에 검출력이 없다는 뜻이므로 테스트를 보강한다.

| # | 변이 | 되돌릴 파일 | 기대 red |
|---|---|---|---|
| ① | `MOVED_M` 100 → 1000 | `src/lib/manual-location.ts` | fixture "거리 121m…drop" |
| ② | `separation`에서 정확도 차감 제거 | `src/lib/manual-location.ts` | fixture "거리 150m지만…keep" |
| ③ | `isEligibleFix`의 `fix.accuracy > 0` 제거 | `src/lib/manual-location.ts` | fixture "정확도 음수" |
| ④ | `judgeManualLocation`의 `origin` nil 가드 제거 | `src/lib/manual-location.ts` | fixture "기준점 없음" |
| ⑤ | `awaitEffectiveLocation`의 `if (opts.force) await runManualLocationJudgment()` 제거 | `src/lib/effective-location.ts` | effective "force:true는…GPS로 복귀" |
| ⑥ | `useManualLocationJudgment`의 마운트 시 `runManualLocationJudgment()` 제거 | `src/hooks/useManualLocationJudgment.ts` | 아래 Step 2의 신규 테스트 |
| ⑦ | CAS(`revision` 비교) 제거 | `src/lib/effective-location.ts` | effective "판정 왕복 중 재지정" |
| ⑧ | `judgeManualLocation`이 `undecidable` 대신 `keep`을 반환 | `src/lib/manual-location.ts` | Kit fixture 대조(문자열 불일치) |
| ⑨ | `announcer?.("drop")` 제거 | `src/lib/effective-location.ts` | effective "자동 해제는 통지를 정확히 1회" |

- [ ] **Step 2: ⑥이 red가 되도록 트리거 테스트를 더한다**

`src/hooks/__tests__/useManualLocationJudgment.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetGeolocationForTest } from "@/lib/geolocation";
import { __resetManualLocationForTest, getManualLocation, setManualLocation } from "@/lib/manual-location-store";
import { useManualLocationJudgment } from "../useManualLocationJudgment";

function Probe() {
  useManualLocationJudgment();
  return null;
}

describe("useManualLocationJudgment", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetGeolocationForTest();
    __resetManualLocationForTest();
  });

  it("마운트 시 판정이 돈다 (트리거 ③ — 탭 시작)", async () => {
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({
            coords: {
              latitude: 35.1796, longitude: 129.0756, accuracy: 10,
              altitude: null, altitudeAccuracy: null, heading: null, speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition),
      },
    });
    render(<Probe />);
    await vi.waitFor(() => expect(getManualLocation()).toBeNull());
  });
});
```

- [ ] **Step 3: 전체 게이트를 돌린다**

```bash
npm run test:run
npm run lint
npx tsc --noEmit
swift test --package-path ios/GildongmuKit
xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -configuration Release -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|\*\* BUILD"
```

Expected: Vitest 전량 PASS · lint error 0 · **`tsc --noEmit`은 선재 5 error 기준선**(BACKLOG D10) 이상으로 늘지 않음 · Kit 테스트 전량 PASS · `** BUILD SUCCEEDED **`

- [ ] **Step 4: 커밋**

```bash
git commit -m "test(location): 변이 주입 9종으로 검출력 실측 + 트리거 테스트

계약 테스트가 있다는 것과 그 축이 지켜진다는 것은 다르다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
  -- src/hooks/__tests__/useManualLocationJudgment.test.tsx
git show HEAD --stat
```

- [ ] **Step 5: 실기기 배포**

```bash
./ios/deploy-device.sh
```

**실기기 판정 항목**(spec §5.2 — 이 게이트는 리뷰로 대체할 수 없다):
- 표시줄 두 버튼이 각각 이름을 갖고 형제로 읽히는가
- 검색 탭에서 위치 → 마이크 순서가 자연스러운가
- 해제 후 포커스가 지정 버튼에 남는가
- 100m 이상 이동 후 복귀했을 때 `이동이 감지되어 지정한 위치를 해제했습니다`가 실제로 **발화**되는가
- 같은 자리에서 앱을 여러 번 여닫아도 유지되는가
- `.undecidable`(권한 없이 지정) 상태에서 `(위치 확인 불가)`가 낭독되는가

---

## Self-Review

**1. Spec coverage**

| spec 절 | 담당 Task |
|---|---|
| §4.1 데이터 모델·스키마 검증 | 1(웹), 2(Kit), 3(웹 store), 4(iOS store) |
| §4.2 판정 함수·상수·`eligible` | 1, 2 |
| §4.3 트리거 3종·CAS·캐시 금지·권한 | 5, 6, 7, 8 |
| §4.4 타입 봉인·fail-closed·우선순위·채팅 | 5, 6, 7, 8, 12, 13 |
| §4.5 상태 노출·통지 | 5(채널), 8(iOS 배선), 10·11(표시줄), 14(문구) |
| §4.6 UI 배치·시맨틱·포커스·추출 축소 | 9, 10, 11 |
| §4.7 문구 6로케일 | 14 |
| §5.1 게이트 테스트·변이 9종 | 1·3·5·7·10·12·14 각 테스트, 15 |
| §5.2 실기기·실보행 | 15 Step 5 |
| §7 릴리스·병렬 세션 규율 | Global Constraints |

갭 없음.

**2. Placeholder scan** — "TBD"·"적절한 오류 처리"·"Task N과 유사" 없음. 모든 코드 단계에 실제 코드가 있다.

**3. Type consistency** — 웹 `Fix`/`ManualLocation`/`ManualVerdict` ↔ Kit `ManualFix`/`ManualLocation`/`ManualVerdict` 필드명 일치(`revision`·`label`·`lat`·`lng`·`origin`·`setAt`, `accuracy`·`at`). `judgeManualLocation(manual, fix, nowSeconds)` ↔ `judgeManualLocation(manual:fix:now:)` 인자 순서 일치. `ManualVerdict` 문자열(`keep`/`drop`/`undecidable`)이 fixture `expect`와 Swift `rawValue`에서 동일. `setManualLocation`은 `revision`을 인자로 받지 않고 스토어가 발급한다(Task 3·4 동형).

**4. 스펙 §9 열린 판정** — `.undecidable` 비율과 웹 표시줄 확장은 실사용 후 판정이므로 이 계획 범위 밖이다. Task 15 Step 5의 실기기 항목이 첫 데이터를 만든다.

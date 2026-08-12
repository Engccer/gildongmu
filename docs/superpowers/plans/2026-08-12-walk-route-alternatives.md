# 도보 경로 대안 제시·안내 중 전환 (M3+E10ⓑ) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도보 길찾기에 추천·최단 두 경로를 항상 제시하고, 안내 중 수동 전환과 이탈 확정 시 1회 자동 조회 후 제안(수락제)을 만든다.

**Architecture:** 서버가 옵트인 파라미터(`variant`/`alternatives`)로 카카오 기본 + Tmap `searchOption=10` 최단을 한 응답에 싣는다(additive). iOS는 도보 섹션을 2행 disclosure로 렌더하고, 안내 세션은 variant를 보유하며 전환·제안은 기존 `performReroute` 커밋 경로를 재사용한다. 정본 spec: `docs/superpowers/specs/2026-08-12-walk-route-alternatives-design.md`.

**Tech Stack:** Next.js 16 Route Handler + zod, Vitest, SwiftUI + GildongmuKit(SPM), Swift Testing.

**구현 방식 판정(헌장 §구현 방식):** inline. 근거: 서버 계약→Kit→UI→세션→제안이 순차 의존이고, Task 7·8이 같은 파일(`BeaconModel.swift`)을 수정하며, Tmap LineString 실구조는 실호출로 설계가 뒤집힐 수 있는 탐색 축이다.

## Global Constraints (spec에서 발췌 — 모든 태스크에 암묵 적용)

- 도보 경로는 **V1 ko 전용**. 신규 문구는 ko 정본(웹 `messages/ko.json` 없음 — iOS 전용 키는 iOS i18n 파이프라인만).
- API 변경은 **additive**: 옵트인 미지정 시 기존 응답과 byte 동일. **기본 경로 실패는 502 유지**(부분 성공은 최단 실패 흡수만).
- `alternatives`+`includeGeometry`, `variant`+`alternatives`는 **400**(조합표, spec §3.1).
- Tmap POST fetch는 `revalidate` 실효(비캐시) — 쿼터 방어는 옵트인 축소가 실질.
- 재작성→주석 파이프라인 순서 계약 유지. 파이프라인 **종단**에서 기하 보존 검증(spec §3.3).
- 커밋은 의도 파일 pathspec만(`git add -A` 금지). 기능·픽스는 같은 커밋에 테스트 동반.
- 접근성: 한 줄=한 접근성 객체(쉼표 구분), 거리 표기는 `formatDistance`/`Format.swift`만, 버튼 활성화 결과 통지는 `.high`.
- 이탈 제안은 **walk 세션 전용**(car는 M3 범위 밖 — spec이 도보 마일스톤).

---

### Task 1: Tmap searchOption + LineString 기하 보존

**Files:**
- Modify: `src/lib/providers/tmap-pedestrian.ts`
- Test: `src/lib/providers/__tests__/tmap-pedestrian.test.ts` (기존 파일 유무 확인 후 없으면 생성)

**Interfaces:**
- Produces: `getWalkRouteBriefing(params: { origin: Coord; dest: Coord; searchOption?: "10"; includeLineGeometry?: boolean; noStore?: boolean })`
- Produces: `normalizeTmapWalkRoute(data: TmapRouteResponse, opts?: { includeLineGeometry?: boolean }): WalkRouteBriefing`

- [ ] **Step 1: 실패하는 normalize 테스트 작성**

Tmap GeoJSON fixture(Point→LineString 교대, description 없는 경유 Point 포함)로:

```ts
import { describe, expect, it } from "vitest";
import { normalizeTmapWalkRoute, type TmapRouteResponse } from "../tmap-pedestrian";

const FIXTURE: TmapRouteResponse = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [127.1, 37.5] },
      properties: { description: "158m 이동 후 우회전", totalDistance: 715, totalTime: 660 } },
    { type: "Feature", geometry: { type: "LineString", coordinates: [[127.1, 37.5], [127.101, 37.5005]] },
      properties: {} },
    { type: "Feature", geometry: { type: "Point", coordinates: [127.101, 37.5005] },
      properties: { description: "도착" } },
  ],
};

describe("normalizeTmapWalkRoute 기하 보존", () => {
  it("기본(비기하)은 현행과 동일 — pathCoords 없음, coord만", () => {
    const b = normalizeTmapWalkRoute(FIXTURE);
    expect(b.steps[0].pathCoords).toBeUndefined();
    expect(b.steps[0].coord).toEqual({ lat: 37.5, lng: 127.1 });
  });
  it("includeLineGeometry는 직후 LineString을 그 스텝 pathCoords로 귀속한다", () => {
    const b = normalizeTmapWalkRoute(FIXTURE, { includeLineGeometry: true });
    expect(b.steps[0].pathCoords).toEqual([
      { lat: 37.5, lng: 127.1 },
      { lat: 37.5005, lng: 127.101 },
    ]);
    // 마지막 스텝(후속 LineString 없음)은 coord 폴백 유지
    expect(b.steps[1].pathCoords).toBeUndefined();
  });
  it("Point 연속·LineString 다중도 순서 귀속이 깨지지 않는다", () => {
    // features: P1, L1a, L1b, P2 → P1.pathCoords = L1a+L1b 이어붙임
    const data: TmapRouteResponse = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [127.1, 37.5] },
          properties: { description: "직진", totalDistance: 100, totalTime: 90 } },
        { type: "Feature", geometry: { type: "LineString", coordinates: [[127.1, 37.5], [127.1005, 37.5]] }, properties: {} },
        { type: "Feature", geometry: { type: "LineString", coordinates: [[127.1005, 37.5], [127.101, 37.5]] }, properties: {} },
        { type: "Feature", geometry: { type: "Point", coordinates: [127.101, 37.5] },
          properties: { description: "도착" } },
      ],
    };
    const b = normalizeTmapWalkRoute(data, { includeLineGeometry: true });
    expect(b.steps[0].pathCoords).toHaveLength(3); // 중복 접점 1개 제거
  });
});
```

- [ ] **Step 2: 실행해 실패 확인** — `npm run test:run -- tmap-pedestrian` → FAIL(옵션 인자 없음).

- [ ] **Step 3: 구현**

`normalizeTmapWalkRoute`에 두 번째 인자 추가. features를 **순서대로** 순회하며 description 있는 Point → 스텝 push, LineString → `includeLineGeometry`일 때 직전 push된 스텝의 `pathCoords`에 이어붙임(첫 좌표가 직전 누적 마지막과 같으면 중복 제거). description 없는 Point는 현행대로 스킵하되 **귀속 대상 스텝 포인터는 유지**(경유 Point가 귀속을 끊지 않게). `getWalkRouteBriefing`은 `searchOption`을 body에 조건부 포함(`...(searchOption ? { searchOption } : {})`), `noStore`면 `cache: "no-store"`(kakao-walk 관례 동형), 결과 normalize에 옵션 전달.

- [ ] **Step 4: 테스트 통과 확인** — `npm run test:run -- tmap-pedestrian` → PASS.

- [ ] **Step 5: 커밋** — `git commit -m "feat(walk): Tmap searchOption·LineString 기하 보존" -- src/lib/providers/tmap-pedestrian.ts src/lib/providers/__tests__/tmap-pedestrian.test.ts` (신규 파일은 add 후 pathspec 커밋, 사이에 다른 도구 호출 금지).

---

### Task 2: walk-route 서비스 variant 축 + 대안 병렬 진입점

**Files:**
- Modify: `src/lib/walk-route.ts`
- Test: `src/lib/__tests__/walk-route.test.ts` (기존 유무 확인 후 확장/생성, provider는 `vi.mock`)

**Interfaces:**
- Consumes: Task 1의 `getWalkRouteBriefing({ searchOption, includeLineGeometry, noStore })`
- Produces: `getWalkRoute(params: { origin; dest; accessible?; includeGeometry?; variant?: "shortest" })`
- Produces: `getWalkRouteAlternatives(params: { origin; dest; accessible? }): Promise<{ result: WalkRouteBriefing | null; shortest?: WalkRouteBriefing | null }>`

- [ ] **Step 1: 실패하는 테스트 작성** — 케이스 4개:
  1. `variant: "shortest"` → tmap이 `searchOption: "10"`으로 호출되고 카카오 미호출.
  2. `variant: "shortest", accessible: true` → 반환 briefing이 `stepFree: "unavailable"` + `stepFreeNotice === "최단 경로에는 계단 회피가 적용되지 않습니다. 계단이 포함될 수 있습니다."` + 비기하 소비자면 스텝 0번 삽입(기존 `withStepFree` 계약).
  3. `getWalkRouteAlternatives`: 기본 성공+최단 throw → `{ result, shortest: null }` (**최단 실패 흡수**).
  4. `getWalkRouteAlternatives`: 기본 throw → **전체 reject**(기본 실패 502 계약, spec 리뷰 #5).

```ts
// 골격 (vi.mock으로 provider 치환)
vi.mock("../providers/kakao-walk");
vi.mock("../providers/tmap-pedestrian");
vi.mock("../env", async (orig) => ({ ...(await orig()), hasKakaoKey: () => true, hasTmapKey: () => true }));
```

- [ ] **Step 2: 실행해 실패 확인** — `npm run test:run -- walk-route`.

- [ ] **Step 3: 구현**
  - `SHORTEST_STEPFREE_NOTICE` 상수 신설, `withStepFree(briefing, status, includeGeometry, noticeOverride?)`로 확장(기존 호출부 무변).
  - `getWalkRoute`에 `variant` 분기: `shortest`면 `hasTmapKey()` 게이트 후 tmap 단독(폴백 없음), `annotate` 동일 적용, accessible이면 위 notice로 `withStepFree(..., "unavailable", includeGeometry, SHORTEST_STEPFREE_NOTICE)`.
  - `getWalkRouteAlternatives`: `Promise.allSettled([getWalkRoute({...}), getWalkRoute({..., variant: "shortest"})])` — 기본 rejected면 rethrow, 최단 rejected면 `shortest: null`, `hasTmapKey()` 불통과면 `shortest` 키 자체 생략.

- [ ] **Step 4: 테스트 통과 확인.**

- [ ] **Step 5: 커밋** — `git commit -m "feat(walk): variant=shortest 축·대안 병렬 진입점" -- src/lib/walk-route.ts src/lib/__tests__/walk-route.test.ts`

---

### Task 3: `/api/route/walk` 파라미터·조합표·부분 성공 비대칭

**Files:**
- Modify: `src/app/api/route/walk/route.ts`
- Test: `src/app/api/__tests__/route-walk-params.test.ts` (생성)

**Interfaces:**
- Consumes: Task 2의 `getWalkRoute`·`getWalkRouteAlternatives`
- Produces: 응답 `{ result }`(현행·variant) / `{ result, shortest? }`(alternatives)

- [ ] **Step 1: 실패하는 테스트 작성** — zod 스키마를 export해 단위 검증(라우트 함수 직접 호출 대신 스키마·조합 가드 함수 분리):

```ts
import { describe, expect, it } from "vitest";
import { parseWalkQuery } from "../../route/walk/route-schema";

const base = { origin: "37.5,127.1", dest: "37.51,127.11", accessible: null, includeGeometry: null, variant: null, alternatives: null };

describe("walk 파라미터 조합표", () => {
  it("variant+alternatives 동시 지정은 거부", () => {
    expect(parseWalkQuery({ ...base, variant: "shortest", alternatives: "1" }).ok).toBe(false);
  });
  it("alternatives+includeGeometry는 거부", () => {
    expect(parseWalkQuery({ ...base, alternatives: "1", includeGeometry: "1" }).ok).toBe(false);
  });
  it("variant=shortest+includeGeometry=1 허용", () => {
    expect(parseWalkQuery({ ...base, variant: "shortest", includeGeometry: "1" }).ok).toBe(true);
  });
  it("variant 오값은 거부", () => {
    expect(parseWalkQuery({ ...base, variant: "fastest" }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: 실행해 실패 확인.**

- [ ] **Step 3: 구현**
  - 스키마·조합 가드를 `src/app/api/route/walk/route-schema.ts`로 분리(`querySchema` 이동 + `variant: z.union([z.literal("shortest"), z.null()])` + `alternatives: z.union([z.literal("1"), z.null()]).transform(v => v === "1")` + `.superRefine`으로 조합표 2건 400). `parseWalkQuery`는 `{ ok, data?, error? }` 반환.
  - 라우트: `alternatives`면 `getWalkRouteAlternatives` 호출 후 `{ result, ...(shortest 키 존재 시 { shortest }) }` 반환(기하 없음 — `withFinalApproach` 미적용). 아니면 현행 흐름에 `variant` 전달(`withFinalApproach`는 현행 그대로 반환 briefing에 적용 — variant=shortest+includeGeometry 경로도 자동 커버).
  - 레이트리밋·커버리지·키 게이트 순서는 현행 유지(파싱→마커→키 게이트→upstream).

- [ ] **Step 4: 테스트 통과 + 전체 스위트** — `npm run test:run` (기존 `coord-param-usage` 가드가 스키마 이동을 추적하는지 확인 — 실패 시 그 테스트의 파일 목록에 `route-schema.ts` 반영).

- [ ] **Step 5: 커밋** — `git commit -m "feat(api): /api/route/walk variant·alternatives 옵트인 + 조합표 400" -- src/app/api/route/walk/route.ts src/app/api/route/walk/route-schema.ts src/app/api/__tests__/route-walk-params.test.ts`

---

### Task 4: 서버 실호출 게이트 (머지 게이트 — fixture green으로 닫지 않는다)

**Files:** 없음(검증 태스크). 결과는 spec §8에 추기.

- [ ] **Step 1: dev 서버 기동** — `npm run dev` (또는 로컬 env 로드 확인).
- [ ] **Step 2: 등굣길 両경로 실호출** (좌표는 BACKLOG M3 실측 구간 — 집→신명중):

```bash
curl -s "http://localhost:3000/api/route/walk?origin=<집 lat,lng>&dest=<신명중 lat,lng>&alternatives=1" | python3 -m json.tool
```

판정: ① `result.distanceMeters` ≈ 880(추천) ② `shortest.distanceMeters` ≈ 715(이면도로) ③ 両경로 steps 문장이 정상 한국어.
- [ ] **Step 3: 최단+기하 실호출** — `variant=shortest&includeGeometry=1`로 ① steps에 `pathCoords` 존재 ② `finalApproach` 존재 ③ LineString 귀속이 스텝 진행 순서와 일치(인접 스텝 pathCoords가 이어짐)를 확인.
- [ ] **Step 4: 계단 회피 조합 실호출** — `variant=shortest&accessible=true`로 `stepFreeNotice` 전용 문장 확인.
- [ ] **Step 5: 결과를 spec §8에 실측값으로 추기하고 커밋** — `git commit -m "docs(spec): M3 서버 실호출 게이트 결과" -- docs/superpowers/specs/2026-08-12-walk-route-alternatives-design.md`

---

### Task 5: Kit — envelope `shortest`·variant 쿼리·하위 호환 fixture

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift` (`WalkRouteEnvelope` 352행 부근)
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RouteService.swift` (`walk(...)` 65행 부근)
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/WalkRouteEnvelopeCompatTests.swift` (생성)

**Interfaces:**
- Produces: `public enum WalkRouteVariant: String, Sendable { case shortest }`
- Produces: `RouteService.walk(originLat:originLng:destLat:destLng:accessible:includeGeometry:variant:)` (variant 기본값 `nil` — 기존 호출부 무변)
- Produces: `RouteService.walkAlternatives(originLat:originLng:destLat:destLng:accessible:) async throws -> (result: WalkRouteBriefing?, shortest: WalkRouteBriefing?)`

- [ ] **Step 1: 실패하는 하위 호환 테스트 작성** — 응답 6종 fixture 문자열을 `WalkRouteEnvelope`로 디코딩(spec 리뷰 #17):

```swift
import Testing
@testable import GildongmuKit

@Suite struct WalkRouteEnvelopeCompatTests {
    private func decode(_ json: String) throws -> WalkRouteEnvelope {
        try JSONDecoder().decode(WalkRouteEnvelope.self, from: Data(json.utf8))
    }
    @Test func 기본_응답_shortest_부재() throws {
        let e = try decode(#"{"result":{"distanceMeters":880,"durationSeconds":780,"steps":[{"description":"직진"}]}}"#)
        #expect(e.result != nil); #expect(e.shortest == nil)
    }
    @Test func shortest_객체() throws {
        let e = try decode(#"{"result":{"distanceMeters":880,"durationSeconds":780,"steps":[{"description":"직진"}]},"shortest":{"distanceMeters":715,"durationSeconds":660,"steps":[{"description":"직진"}]}}"#)
        #expect(e.shortest??.distanceMeters == 715 || e.shortest?.distanceMeters == 715) // 옵셔널 계층은 구현에 맞춰 단언 정리
    }
    @Test func shortest_null() throws {
        let e = try decode(#"{"result":{"distanceMeters":880,"durationSeconds":780,"steps":[{"description":"직진"}]},"shortest":null}"#)
        #expect(e.result != nil)
    }
    @Test func result_null_경로없음() throws {
        let e = try decode(#"{"result":null}"#)
        #expect(e.result == nil)
    }
    @Test func 미지_필드_무시() throws {
        let e = try decode(#"{"result":{"distanceMeters":880,"durationSeconds":780,"steps":[{"description":"직진"}]},"unknownFutureField":1}"#)
        #expect(e.result != nil)
    }
    @Test func stepFreeNotice_전용_문장() throws {
        let e = try decode(#"{"result":{"distanceMeters":715,"durationSeconds":660,"steps":[{"description":"직진"}],"stepFree":"unavailable","stepFreeNotice":"최단 경로에는 계단 회피가 적용되지 않습니다. 계단이 포함될 수 있습니다."}}"#)
        #expect(e.result?.stepFreeNotice?.contains("최단") == true)
    }
}
```

- [ ] **Step 2: 실행해 실패 확인** — `cd ios/GildongmuKit && swift test --filter WalkRouteEnvelopeCompatTests` → FAIL(`shortest` 멤버 없음). ⚠ 기존 `WalkRouteEnvelope`의 `result` 디코딩 방식(옵셔널/`decodeIfPresent`)을 먼저 읽고 fixture 단언을 실제 타입 계층에 맞출 것.

- [ ] **Step 3: 구현** — `WalkRouteEnvelope`에 `public let shortest: WalkRouteBriefing??` 또는 기존 관례에 맞는 옵셔널 형태로 추가(부재·null 모두 안전 디코딩). `WalkRouteVariant` enum 신설. `walk(...)`에 `variant: WalkRouteVariant? = nil` 추가, 있으면 `URLQueryItem(name: "variant", value: variant.rawValue)`. `walkAlternatives(...)`는 `alternatives=1` 쿼리로 envelope를 받아 튜플 반환.

- [ ] **Step 4: 테스트 통과 확인** — `swift test --filter WalkRouteEnvelopeCompatTests` → PASS.

- [ ] **Step 5: 커밋** — `git commit -m "feat(ios-kit): 도보 대안 envelope·variant 쿼리 + 하위 호환 fixture" -- ios/GildongmuKit/Sources/GildongmuKit/Models/RouteModels.swift ios/GildongmuKit/Sources/GildongmuKit/RouteService.swift ios/GildongmuKit/Tests/GildongmuKitTests/WalkRouteEnvelopeCompatTests.swift`

---

### Task 6: iOS 조회 화면 — 도보 2행 disclosure (Release·Experimental 공통)

**Files:**
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift` (`settleWalk` 305행 부근·도보 섹션 렌더·`GuideStartButton` enum 475행)
- Modify: iOS i18n 정본(메시지 소스 — `gildongmu-ios-i18n-architecture` 파이프라인 확인 후 그 정본 파일에 키 추가)

**Interfaces:**
- Consumes: Task 5의 `walkAlternatives`, `WalkRouteVariant`
- Produces: 도보 모델 상태에 `walkShortest: WalkRouteBriefing?` 보관, 최단 행의 안내 시작이 `variant: .shortest`를 세션에 전달(Task 7 소비)

- [ ] **Step 1: 현행 도보 섹션 구조 파악** — `DirectionsTabView.swift`에서 `settleWalk`·`outcomes[.walk]` 렌더·`walkGuideStartable`·대중교통 대안 `DisclosureGroup` 사용부를 읽고, 대중교통 disclosure의 요약 라벨·펼침 본문 패턴을 확인한다(브리핑 라벨 disclosure 선례가 이 파일 안에 있다 — 그 관례를 복제하지 말고 공통 구조가 있으면 재사용).
- [ ] **Step 2: 조회 배선** — `settleWalk`이 `service.walkAlternatives(...)`를 쓰도록 바꾸고(도보 게이트·ko 게이트 현행 유지), 성공 시 `outcomes[.walk]`(추천, 현행 분류 그대로) + 신규 `walkShortest` 프로퍼티에 최단을 **같은 응답에서만** 커밋한다(스냅샷 교체 — 새 조회 시작 시 `walkShortest = nil` 선행. spec §4 "같은 응답에서 온 쌍만").
- [ ] **Step 3: 렌더** — 도보 섹션을 2행으로:
  - 행 1(추천): 요약 라벨 `"\(추천 라벨), \(Format.formatDistance(880)), 도보 약 13분"` 형태 — 라벨 키 `ios.directions.walkRecommended` = "추천 경로", 시간은 기존 duration 표기 헬퍼 재사용. 펼침 본문·안내 시작 버튼은 현행 도보 상세를 이동.
  - 행 2(최단): `walkShortest` 존재 시에만. 라벨 키 `ios.directions.walkShortest` = "최단 경로". `stepFreeNotice` 있으면 요약 뒤 쉼표로 병기(한 줄=한 객체). 안내 시작 버튼은 `GuideStartButton`에 `case walkShortest` 추가 후 Task 7의 variant 전달로 연결(Task 7 전까지는 버튼 비노출이 아니라 **이 태스크에서 enum·버튼까지 만들고 세션 전달만 Task 7에서 배선** — 컴파일 유지 위해 이 시점엔 기존 walk 시작과 동일 동작).
  - 実験 게이트 없음: 이 화면은 Release에도 나간다(spec §4 빌드 구성). 안내 시작 버튼 자체는 기존 `realtimeGuidanceEnabled` 게이트 안이므로 그대로 둔다.
- [ ] **Step 4: i18n 키 추가 + 빌드 확인** — i18n 파이프라인(xcstrings 변환·키 린터)을 돌리고 `xcodebuildmcp` simulator build-and-run으로 도보 2행 렌더·VO 라벨(스냅샷은 참고 신호)을 확인.
- [ ] **Step 5: 커밋** — `git commit -m "feat(ios): 도보 조회 2행 disclosure(추천·최단)" -- ios/Gildongmu/Directions/DirectionsTabView.swift <i18n 정본 파일들>`

---

### Task 7: 세션 variant 배선 + 안내 중 수동 전환

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift` (`fetchDetailData` 호출부·`requestReroute` 1555행·`performReroute` 1566행)
- Modify: `ios/Gildongmu/Directions/GuideSessionCoordinator.swift` (세션 시작 파라미터)
- Modify: `ios/Gildongmu/Directions/BeaconTrackingSheet.swift` (전환 버튼)
- Modify: `ios/Gildongmu/Directions/DirectionsTabView.swift` (최단 안내 시작 → variant 전달)

**Interfaces:**
- Consumes: Task 5 `WalkRouteVariant`, Task 6 `GuideStartButton.walkShortest`
- Produces: `BeaconModel.sessionVariant: WalkRouteVariant?`(세션 시작 시 확정, 세션 수명 불변 — 전환 커밋에서만 변경), `requestVariantSwitch()`

- [ ] **Step 1: 세션 시작 경로에 variant 주입** — `GuideSessionCoordinator`의 시작 시그니처와 `BeaconModel` 세션 시작을 읽고 `variant: WalkRouteVariant? = nil`을 관통시킨다. `fetchDetailData(origin:dest:)`가 `RouteService.walk`을 부르는 지점에 `variant: sessionVariant` 전달. ⚠ **`accessible`은 세션 인자 그대로**(spec §3.2 — 전환·재조회·제안 전부 세션 값 사용, 탈락 금지).
- [ ] **Step 2: 수동 전환** — `requestVariantSwitch()`: `requestReroute()`와 같은 가드(`isTracking, mode == .detail, !rerouteInFlight` — 단 `offRoute` 조건 없음: 정상 추종 중에도 전환 가능)로 target = `sessionVariant == nil ? .shortest : nil`을 `performReroute` 계층에 전달. **`sessionVariant`는 fetch 성공 커밋 지점(latest-wins 가드 통과 후)에서만 갱신**(실패 시 기존 경로·기존 variant 유지). 전환 성공 통지는 기존 재조회 통지 계약(`.high`)에 variant를 밝히는 문장: `guide.switchedToShortest` = "최단 경로로 전환했습니다." / `guide.switchedToRecommended` = "추천 경로로 전환했습니다." + 기존 새 경로 요약 이어붙임.
- [ ] **Step 3: 시트 버튼** — `BeaconTrackingSheet`에 "다른 경로로 전환" 버튼(`guide.switchRoute`): walk 세션이고 `mode == .detail`일 때 노출. SR 읽기 순서: 기존 재조회 버튼 **뒤**(자주 쓰는 순서 우선 원칙 — 재조회가 1순위 동작).
- [ ] **Step 4: 최단 안내 시작 배선** — Task 6의 `GuideStartButton.walkShortest`가 세션 시작에 `variant: .shortest`를 넘기도록 연결.
- [ ] **Step 5: 빌드·시뮬 확인 + 커밋** — `git commit -m "feat(ios): 안내 세션 variant·안내 중 수동 전환" -- ios/Gildongmu/Directions/BeaconModel.swift ios/Gildongmu/Directions/GuideSessionCoordinator.swift ios/Gildongmu/Directions/BeaconTrackingSheet.swift ios/Gildongmu/Directions/DirectionsTabView.swift <i18n 정본 파일들>`

---

### Task 8: 이탈 시 제안 (E10ⓑ) — 순수 게이트 + 모델 배선

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/RerouteProposalGate.swift` (순수 판정 — 신선도·상한·커밋 가드)
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/RerouteProposalGateTests.swift`
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift` (이탈 확정 이벤트 소비 지점 = `case .offRoute` 1438행 부근, `requestReroute`, 폐기 리셋 지점들)
- Modify: `ios/Gildongmu/Directions/BeaconTrackingSheet.swift` (버튼 라벨 전환)

**Interfaces:**
- Consumes: Task 7의 `sessionVariant`·`performReroute` 커밋 경로
- Produces (Kit 순수 타입):

```swift
public struct RerouteProposal: Sendable {
    public let originLat: Double
    public let originLng: Double
    public let acquiredAt: TimeInterval  // uptime 기준
    public init(originLat: Double, originLng: Double, acquiredAt: TimeInterval)
}

public enum RerouteProposalGate {
    /// 신선도: 30m 초과 이동 또는 120초 경과면 만료(잠정값 — spec §6).
    public static func isFresh(_ p: RerouteProposal, nowUptime: TimeInterval,
                               currentLat: Double, currentLng: Double) -> Bool
    /// 세션당 자동 조회 허용 여부(상한 5회, 잠정값).
    public static func mayFetch(episodeFetchCount: Int) -> Bool
}
```

- [ ] **Step 1: Kit 순수 게이트 TDD** — 테스트: 29m·119초는 fresh, 31m 또는 121초는 만료, 5회째까지 허용·6회째 거부. `swift test --filter RerouteProposalGateTests` FAIL → 구현(Haversine은 Kit 기존 거리 유틸 재사용 — 신규 구현 금지) → PASS.
- [ ] **Step 2: 모델 상태 신설** — `BeaconModel`에:

```swift
private enum ProposalState { case none, fetching(token: Int), ready(RerouteProposal, fetched: DetailFetchResult) }
private var proposalState: ProposalState = .none
private var proposalToken = 0
private var proposalFetchCount = 0           // 세션당 상한 5(잠정값)
private(set) var hasPreparedProposal = false // 시트 라벨 바인딩용
```

(`DetailFetchResult`는 `fetchDetailData` 반환 타입의 실제 이름으로 맞출 것 — Step 3에서 확인.)
- [ ] **Step 3: 트리거 배선** — `case .offRoute`(1438행 부근, `offRoute = true` 직후): `sessionKind == .walk && mode == .detail && phase가 최종 접근 전 && RerouteProposalGate.mayFetch(episodeFetchCount: proposalFetchCount)`이면 `proposalToken += 1; proposalFetchCount += 1; proposalState = .fetching(token:)` 후 Task로 `LocationService.shared.currentCoordinate()` → `fetchDetailData(origin:dest:)`(variant는 `sessionVariant`). 커밋 가드: `token == proposalToken && offRoute && isTracking && mode == .detail` 전부 일치할 때만 `.ready` 커밋 + polite 1회 통지(`guide.proposalReady` = "새 경로가 준비되었습니다. {요약}") + `hasPreparedProposal = true`. **조회 실패는 그 회차 종결**(`.none` 복귀, 통지 없음 — spec §6 트레이드오프).
- [ ] **Step 4: 만료·폐기 배선** — 매 fix 처리 루프(기존 `guideState` 갱신 지점)에서 `.ready`면 `RerouteProposalGate.isFresh` 검사, 불통과 시 `.none` + `hasPreparedProposal = false`(통지 없음, 라벨 원복이 신호). 폐기 지점: `offRoute = false` 전이(524·757·816행 부근의 복귀·리셋 계열)·세션 중지·목적지 변경에서 `.none` 리셋 + 토큰 증가.
- [ ] **Step 5: 수락 배선** — `requestReroute()` 진입부에서 `.ready`이고 fresh면 왕복 없이 보관 `fetched`를 **`performReroute`의 성공 커밋 블록과 같은 경로**로 채택한다: 커밋 블록(1586~1620행의 경로 교체·`resetFinalApproach`·`initialGuideState`·표시 유닛 재구성)을 `private func commitReroutedRoute(_ fetched:)`로 추출해 両경로가 호출(spec 리뷰 #4 — 별도 채택 전이 신설 금지). 채택 성공 통지 `.high`. 시트 버튼 라벨: `hasPreparedProposal ? "guide.proposalAdopt"("준비된 새 경로로 안내") : "guide.rerouteButton"`.
- [ ] **Step 6: 빌드·시뮬 확인 + 커밋** — `git commit -m "feat(ios): 이탈 확정 시 경로 제안(E10ⓑ) — 순수 게이트+모델 상태 머신" -- ios/GildongmuKit/Sources/GildongmuKit/RerouteProposalGate.swift ios/GildongmuKit/Tests/GildongmuKitTests/RerouteProposalGateTests.swift ios/Gildongmu/Directions/BeaconModel.swift ios/Gildongmu/Directions/BeaconTrackingSheet.swift <i18n 정본 파일들>`

---

### Task 9: 리뷰·구성 검증·문서 분배·배포

**Files:**
- Modify: `docs/BACKLOG.md`(M3 종결·E10 판정 기록), `CHANGELOG.md`, `PROGRESS.md`(상태 한 줄), `/Users/hunyongkim/Mac-Projects/PORTS.md`(웹 UI 후속 이식 등록), `CLAUDE.md`(새 함정 있으면)

- [ ] **Step 1: 서브에이전트 리뷰** — spec-compliance + code-quality 리뷰를 별도 컨텍스트로 디스패치(요구사항=spec·plan 텍스트와 diff만 — 세션 히스토리 전달 금지). a11y 변경이므로 `a11y-auditor`도 1회.
- [ ] **Step 2: 게이트 전체 실행** — `npm run test:run` + `npm run build`(Vitest green ≠ 타입 통과) + `cd ios/GildongmuKit && swift test`.
- [ ] **Step 3: 구성별 산출물 확인** — Release 빌드에 2행 disclosure가 있고 안내 시작·전환·제안 진입점이 없는지, Experimental엔 전부 있는지(spec §8. `xcodebuild -list`로 스킴 확인 후 両구성 빌드).
- [ ] **Step 4: 문서 분배** — 서사→CHANGELOG(스펙 링크), M3·E10 종결과 실보행 잔여 판정(신선도 잠정값·상한 5회·A6 상호작용)→BACKLOG, 상태 한 줄→PROGRESS, 웹 UI 이식 행→PORTS.md(`cross-port` 스킬 절차), 새 함정 발견 시→CLAUDE.md.
- [ ] **Step 5: push + 실기기 배포** — 리뷰 통과 후 commit·push(자동배포). 기기 연결 시 `CONFIGURATION=Experimental ./ios/deploy-device.sh`(병렬 세션 확인 후 직전 알림 관례). Release 트레인 합류는 다음 심사 제출 때(별도 판정).

---

## Self-Review 결과

- **Spec coverage**: §3.1(Task 3)·§3.2(Task 2·7)·§3.3(Task 1·4)·§4(Task 6)·§5(Task 7)·§6(Task 8)·§8(Task 4·5·9) 전부 태스크 매핑 확인. §7(범위 제외)은 태스크 없음이 정답.
- **Placeholder**: 좌표 실측값(`<집 lat,lng>`)은 실행 시점에 BACKLOG M3 로그에서 취득(개인 위치라 plan에 박지 않음 — 의도적).
- **Type consistency**: `WalkRouteVariant`(5→6→7→8), `getWalkRouteAlternatives`(2→3), `walkAlternatives`(5→6), `commitReroutedRoute`(8 내부) 일관 확인.
- ⚠ iOS 내부 시그니처 중 미확정 2건은 해당 태스크 Step에 "먼저 읽고 맞출 것"을 명시했다(`WalkRouteEnvelope.result` 옵셔널 계층, `fetchDetailData` 반환 타입명) — 추측 코드를 박지 않는다.

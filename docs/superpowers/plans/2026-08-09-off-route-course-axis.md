# 이탈 판정 방위 축 (A6) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수직거리와 독립된 방위 축을 이탈 판정에 더해, 완만한 갈림·역주행에서 이탈 확정을 앞당긴다.

**Architecture:** 기기가 주는 진행 방위를 경로 접선과 비교해 매 fix마다 3-state 표(`mismatch`/`match`/`unknown`)를 만들고, 시간 창의 표 분포로 축을 확정·해제한다. 판정은 순수 함수이고 웹 ↔ Kit 미러이며 공유 fixture가 동조를 강제한다. 기존 수직거리 축과 OR로 병렬이고, 축마다 latch를 따로 들고 복귀는 활성 축이 모두 해제될 때만 성립한다.

**Tech Stack:** TypeScript(웹 `src/lib`) · Swift(iOS Kit) · Vitest · Swift Testing

**설계 정본:** `docs/superpowers/specs/2026-08-09-off-route-course-axis-design.md`

**구현 방식 판정(자율성 헌장):** Task 1(진단 로그)은 다른 태스크와 파일이 겹치지 않고 선행 관계도 없어 **독립**이다. Task 2~7은 **순차 의존**이다(Task 3이 표결 인터페이스를 확정해야 Kit 미러·리듀서 배선의 시그니처가 정해지고, 그 인터페이스가 바뀌면 뒤 태스크를 전부 다시 쓴다). Task 4·5는 같은 리듀서 파일의 웹·Kit 양쪽이라 인터페이스 확정 뒤에는 병렬 가능하다. **혼합이 정상이고 마일스톤 전체를 한쪽으로 몰지 않는다.**

## Global Constraints

- **파라미터는 잠정값이다.** spec §6이 "값을 숫자로 확정하지 않는다"고 선언했고 §7이 실기기 로그를 값의 근거로 정했다. 이 계획의 상수는 **실보행 전 잠정값**이며, 각 상수 선언에 `⚠ 잠정값(spec §6·§7)` 주석을 단다. **값을 근거처럼 문서에 옮겨 적지 말 것.**
- **게이트에 걸리면 축이 꺼지고 기존 동작이 남는다.** 어떤 태스크도 기존 수직거리 축의 동작을 바꾸지 않는다(회귀 0).
- **웹은 방위를 채우지 않는다.** 웹 호출부는 항상 비활성 관측을 넘긴다. 플랫폼 갭은 "코드 부재"가 아니라 "데이터 부재"다.
- **거리 표기는 `formatDistance`만 지난다**(CLAUDE.md 횡단 함정). 이 마일스톤은 거리 문자열을 새로 만들지 않는다.
- **`git add -A` 금지.** 의도 파일만 stage하고 `git commit -- <경로>`로 원자화한다(다른 세션이 같은 워킹 트리에서 작업 중).
- **커밋 이메일** `engccer@gmail.com`, 주석·커밋 메시지 한국어, 변수·함수명 영어.
- **em dash 금지 대상이 아니다**(에이전트가 읽는 문서·코드 주석은 글로벌 규칙 C층).

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `ios/Gildongmu/Directions/GuideDiag.swift` (신규) | 안내 세션 fix 진단 로그. 파라미터 확정의 유일한 근거 | 1 |
| `src/lib/route-geometry.ts` (수정) | `tangentAt` 추가 | 2 |
| `ios/GildongmuKit/Sources/GildongmuKit/RouteGeometry.swift` (수정) | `tangentAt` 미러 | 2 |
| `src/lib/guide-course-axis.ts` (신규) | 표결 3-state · 창 · 확정/해제 판정 | 3 |
| `ios/GildongmuKit/Sources/GildongmuKit/GuideCourseAxis.swift` (신규) | 위의 미러 | 4 |
| `src/lib/__tests__/fixtures/course-axis-scenarios.json` (신규) | 웹 ↔ Kit 공유 경계표 | 3 |
| `src/lib/route-guide.ts` (수정) | 상태 확장 · 표결 기록 · OR 확정 · 복귀 계약 · 실행 순서 | 5 |
| `ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift` (수정) | 위의 미러 | 6 |
| `src/hooks/useRouteGuide.ts` (수정) | 비활성 관측 전달 | 7 |
| `ios/Gildongmu/Directions/BeaconModel.swift` (수정) | `courseStep` 결과 전달 + 진단 로그 배선 | 1·7 |
| `src/lib/__tests__/a6-probe.test.ts` (수정) | 탐사 하네스를 단언 가진 계약 테스트로 승격 | 8 |

---

### Task 1: iOS 안내 세션 진단 로그

**Files:**
- Create: `ios/Gildongmu/Directions/GuideDiag.swift`
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift` (`handleDetail` 안, `guideStep` 호출 직후)

**Interfaces:**
- Consumes: 없음(독립 태스크)
- Produces: `guideDiagLog(_ msg: @autoclosure () -> String)` — 이후 태스크가 추가 계측을 넣을 자리

**왜 먼저인가:** spec §7이 이것을 1단계로 정했다. §6의 파라미터를 정하는 유일한 근거이고, 이 로그 없이 정한 값은 측정된 적 없는 가정 위에 있다.

- [ ] **Step 1: 로그 모듈 작성**

`ios/Gildongmu/Directions/GuideDiag.swift`를 만든다. `TransitGuideDiag.swift`와 같은 구조이되 파일명·태그만 다르다.

```swift
import Foundation

// 도보 안내 세션 fix 계측(spec 2026-08-09 §7 1단계). 방위 축 파라미터를 정하는
// 유일한 근거이므로 매 fix의 원시 센서값을 그대로 남긴다.
// TransitGuideDiag 선례의 파일 로그 패턴 — 콘솔 + 기기 파일(Documents/
// guide-diag.log, 2MB 초과 시 .old로 교체)이라 USB 콘솔 없는 실보행에서도 보존된다.
// 회수: `xcrun devicectl device copy from --domain-type appDataContainer`.
// ⚠ Experimental 구성은 DEBUG를 정의하지 않으므로 게이트에 EXPERIMENTAL 명시 필수.
// 릴리스 빌드는 no-op(자동 클로저라 로그 문자열 조립 자체가 일어나지 않는다).

#if DEBUG || EXPERIMENTAL
nonisolated final class GuideFileLog: @unchecked Sendable {
    static let shared = GuideFileLog()
    private let lock = NSLock()
    private var handle: FileHandle?
    private static let maxBytes: UInt64 = 2_000_000

    private static var logURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("guide-diag.log")
    }

    func append(_ line: String) {
        lock.withLock {
            guard let handle = ensureHandleLocked() else { return }
            handle.write(Data((line + "\n").utf8))
        }
    }

    private func ensureHandleLocked() -> FileHandle? {
        if let handle {
            if (try? handle.offset()) ?? 0 > Self.maxBytes {
                try? handle.close()
                self.handle = nil
                let url = Self.logURL
                let old = url.deletingLastPathComponent()
                    .appendingPathComponent("guide-diag.old.log")
                try? FileManager.default.removeItem(at: old)
                try? FileManager.default.moveItem(at: url, to: old)
            } else {
                return handle
            }
        }
        let url = Self.logURL
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        guard let newHandle = try? FileHandle(forWritingTo: url) else { return nil }
        _ = try? newHandle.seekToEnd()
        handle = newHandle
        return newHandle
    }
}

/// ISO8601DateFormatter는 문서상 스레드 안전 — 컴파일러가 Sendable을 증명 못 해
/// unsafe 표기만 붙인다(TransitGuideDiag 동형).
private nonisolated(unsafe) let guideDiagDateFormatter = ISO8601DateFormatter()

nonisolated func guideDiagLog(_ msg: @autoclosure () -> String) {
    let wallClock = guideDiagDateFormatter.string(from: Date())
    let line = "[GuideDiag] [\(wallClock)] \(msg())"
    print(line)
    GuideFileLog.shared.append(line)
}
#else
@inline(__always) nonisolated func guideDiagLog(_ msg: @autoclosure () -> String) {}
#endif
```

- [ ] **Step 2: 빌드 확인**

Run: `cd ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -configuration Experimental -destination 'generic/platform=iOS' build 2>&1 | tail -5`
Expected: `BUILD SUCCEEDED`

⚠ 새 파일이 타깃에 포함되지 않으면 컴파일은 통과하지만 심볼이 없어 다음 스텝에서 링크 오류가 난다. `pbxproj`에 파일 참조와 `Sources` 빌드 페이즈 항목을 함께 추가한다. **객체 ID는 파일 전체에서 유일해야 한다**(기존 ID 재사용은 그 객체를 덮어써 프로젝트가 열리지 않고, `plutil -lint`는 이것을 못 잡는다 — 검증은 `xcodebuild -list`).

- [ ] **Step 3: BeaconModel에 계측 한 줄 배선**

`ios/Gildongmu/Directions/BeaconModel.swift`의 `handleDetail`에서 `guideState = out.state` **바로 다음**에 넣는다.

```swift
        guideDiagLog(
            "fix t=\(String(format: "%.1f", now)) "
                + "lat=\(String(format: "%.6f", fix.lat)) lng=\(String(format: "%.6f", fix.lng)) "
                + "acc=\(String(format: "%.1f", fix.accuracy)) "
                + "course=\(String(format: "%.1f", fix.course)) "
                + "courseAcc=\(String(format: "%.1f", fix.courseAccuracy)) "
                + "speed=\(String(format: "%.2f", fix.speed)) "
                + "speedAcc=\(String(format: "%.2f", fix.speedAccuracy)) "
                + "motion=\(motion) age=\(String(format: "%.1f", age)) "
                + "phase=\(out.state.phase) d=\(String(format: "%.1f", out.state.d)) "
                + "event=\(out.event.map { "\($0)" } ?? "-")"
        )
```

⚠ **원시값을 그대로 남긴다.** `courseStep`을 통과시킨 결과만 남기면 게이트가 무엇을 걸렀는지 알 수 없고, 그 판단이 옳았는지가 §7 3단계의 핵심 질문이다.

⚠ **수직거리는 `out.state`에 없다.** 필요하면 `projectOnPolyline` 결과를 리듀서가 노출해야 하는데 그것은 Task 5의 범위다. 지금은 `d`만 남기고, Task 5에서 수직거리 필드가 생기면 이 줄에 더한다.

- [ ] **Step 4: 실기기 배포로 로그 생성 확인**

Run: `CONFIGURATION=Experimental ./ios/deploy-device.sh`
그다음 앱에서 도보 상세 안내를 30초 이상 켜고:
Run: `xcrun devicectl device copy from --domain-type appDataContainer --domain-identifier space.dodoplanet.gildongmu.dev --source Documents/guide-diag.log --destination /tmp/guide-diag.log --device $(xcrun devicectl list devices | awk 'NR==3{print $3}')`
Expected: 파일이 존재하고 `fix t=` 줄이 fix마다 하나씩 있다. `course=-1`(무효 신호)도 그대로 보여야 한다.

- [ ] **Step 5: 커밋**

```bash
git add ios/Gildongmu/Directions/GuideDiag.swift ios/Gildongmu/Directions/BeaconModel.swift ios/Gildongmu.xcodeproj/project.pbxproj
git commit -m "feat(ios): 도보 안내 fix 진단 로그

방위 축 파라미터를 정할 근거를 만든다(spec 2026-08-09 §7 1단계). 매 fix의 원시
센서값을 남긴다 — 게이트 통과분만 남기면 게이트가 무엇을 걸렀는지 알 수 없고
그 판단이 옳았는지가 3단계의 핵심 질문이다. TransitGuideDiag 동형 파일 로그.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" -- ios/Gildongmu/Directions/GuideDiag.swift ios/Gildongmu/Directions/BeaconModel.swift ios/Gildongmu.xcodeproj/project.pbxproj
git show HEAD --stat
```

---

### Task 2: 폴리라인 접선 순수 함수

**Files:**
- Modify: `src/lib/route-geometry.ts` (파일 끝에 추가)
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RouteGeometry.swift` (파일 끝에 추가)
- Test: `src/lib/__tests__/route-geometry.test.ts` (기존 파일에 describe 추가)
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/RouteGeometryTests.swift` (기존 파일에 추가)

**Interfaces:**
- Consumes: 기존 `Polyline`(웹) / `GuidePolyline`(Kit), `pointAtD` 상당 로직
- Produces:
  - 웹 `export function tangentAt(poly: Polyline, d: number, halfMeters: number): number | null`
  - Kit `public func tangentAt(poly: GuidePolyline, d: Double, halfMeters: Double) -> Double?`
  - 반환은 진북 기준 방위(도, `[0,360)`). 앞뒤 점이 같으면 `null`/`nil`.

- [ ] **Step 1: 웹 실패 테스트 작성**

`src/lib/__tests__/route-geometry.test.ts` 끝에 추가한다.

```ts
describe("tangentAt", () => {
  // 남 → 북 직선 100m
  const straight = buildGuideRoute([
    { description: "북진", pathCoords: [
      { lat: 37.5, lng: 127.1 },
      { lat: 37.5 + 100 / 111320, lng: 127.1 },
    ] },
  ])!;

  it("직선 구간은 진행 방위 0도", () => {
    expect(tangentAt(straight.polyline, 50, 15)).toBeCloseTo(0, 0);
  });

  it("경로 시작·끝에서도 방위를 낸다(구간을 잘라 쓴다)", () => {
    expect(tangentAt(straight.polyline, 0, 15)).toBeCloseTo(0, 0);
    expect(tangentAt(straight.polyline, 100, 15)).toBeCloseTo(0, 0);
  });

  it("앞뒤 점이 같으면 null (0도로 접지 않는다)", () => {
    const degenerate = { points: [{ lat: 37.5, lng: 127.1 }], cum: [0] };
    expect(tangentAt(degenerate, 0, 15)).toBeNull();
  });

  it("직각으로 꺾이는 지점의 접선은 두 방위 사이", () => {
    // 북 50m 뒤 동 50m
    const corner = buildGuideRoute([
      { description: "북", pathCoords: [
        { lat: 37.5, lng: 127.1 },
        { lat: 37.5 + 50 / 111320, lng: 127.1 },
      ] },
      { description: "동", pathCoords: [
        { lat: 37.5 + 50 / 111320, lng: 127.1 },
        { lat: 37.5 + 50 / 111320, lng: 127.1 + 50 / (111320 * Math.cos((37.5 * Math.PI) / 180)) },
      ] },
    ])!;
    const t = tangentAt(corner.polyline, 50, 15)!;
    expect(t).toBeGreaterThan(20);
    expect(t).toBeLessThan(70);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/route-geometry.test.ts -t tangentAt`
Expected: FAIL — `tangentAt is not a function`

- [ ] **Step 3: 웹 구현**

`src/lib/route-geometry.ts` 끝에 추가한다.

```ts
/**
 * 진행거리 `d` 지점의 경로 접선 방위(진북 기준 도, `[0,360)`).
 * 앞뒤 `halfMeters`의 두 점을 잇는 방위라 폴리라인 정점 노이즈를 평활한다.
 *
 * ⚠ **두 점이 같으면 `null`이다.** 중복 정점·짧은 경로 끝에서 방위는 정의되지
 * 않는데, 0도로 접으면 소비자가 "북쪽"이라는 거짓 정보를 얻는다(3-state 불변식).
 */
export function tangentAt(poly: Polyline, d: number, halfMeters: number): number | null {
  const total = poly.cum[poly.cum.length - 1];
  if (!(total > 0)) return null;
  const a = pointAtD(poly, Math.max(0, d - halfMeters));
  const b = pointAtD(poly, Math.min(total, d + halfMeters));
  if (!a || !b) return null;
  const lat0 = (a.lat * Math.PI) / 180;
  const dx = (b.lng - a.lng) * Math.cos(lat0);
  const dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) return null;
  return (((Math.atan2(dx, dy) * 180) / Math.PI) + 360) % 360;
}

/** 진행거리 `d` 지점의 좌표. 범위 밖은 끝점으로 물린다. */
function pointAtD(poly: Polyline, d: number): Coord | null {
  const { points, cum } = poly;
  if (points.length === 0) return null;
  if (points.length === 1) return points[0];
  const dd = Math.max(0, Math.min(d, cum[cum.length - 1]));
  for (let i = 0; i < points.length - 1; i++) {
    if (cum[i] <= dd && dd <= cum[i + 1]) {
      const seg = cum[i + 1] - cum[i];
      const t = seg === 0 ? 0 : (dd - cum[i]) / seg;
      return {
        lat: points[i].lat + t * (points[i + 1].lat - points[i].lat),
        lng: points[i].lng + t * (points[i + 1].lng - points[i].lng),
      };
    }
  }
  return points[points.length - 1];
}
```

- [ ] **Step 4: 웹 통과 확인**

Run: `npx vitest run src/lib/__tests__/route-geometry.test.ts -t tangentAt`
Expected: PASS (4 tests)

- [ ] **Step 5: Kit 미러 구현**

`ios/GildongmuKit/Sources/GildongmuKit/RouteGeometry.swift` 끝에 추가한다.

```swift
/// 진행거리 `d` 지점의 경로 접선 방위(진북 기준 도, `[0,360)`).
/// 웹 `route-geometry.ts` `tangentAt` 미러.
///
/// ⚠ **두 점이 같으면 `nil`이다.** 0도로 접으면 소비자가 "북쪽"이라는 거짓 정보를 얻는다.
public func tangentAt(poly: GuidePolyline, d: Double, halfMeters: Double) -> Double? {
    guard let total = poly.cum.last, total > 0 else { return nil }
    guard let a = pointAtD(poly: poly, d: max(0, d - halfMeters)),
          let b = pointAtD(poly: poly, d: min(total, d + halfMeters))
    else { return nil }
    let lat0 = a.lat * .pi / 180
    let dx = (b.lng - a.lng) * cos(lat0)
    let dy = b.lat - a.lat
    if dx == 0 && dy == 0 { return nil }
    return (atan2(dx, dy) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
}

/// 진행거리 `d` 지점의 좌표. 범위 밖은 끝점으로 물린다.
private func pointAtD(poly: GuidePolyline, d: Double) -> RoutePoint? {
    guard !poly.points.isEmpty else { return nil }
    if poly.points.count == 1 { return poly.points[0] }
    let dd = max(0, min(d, poly.cum[poly.cum.count - 1]))
    for i in 0..<(poly.points.count - 1) where poly.cum[i] <= dd && dd <= poly.cum[i + 1] {
        let seg = poly.cum[i + 1] - poly.cum[i]
        let t = seg == 0 ? 0 : (dd - poly.cum[i]) / seg
        return RoutePoint(
            lat: poly.points[i].lat + t * (poly.points[i + 1].lat - poly.points[i].lat),
            lng: poly.points[i].lng + t * (poly.points[i + 1].lng - poly.points[i].lng)
        )
    }
    return poly.points[poly.points.count - 1]
}
```

- [ ] **Step 6: Kit 테스트 작성·실행**

`ios/GildongmuKit/Tests/GildongmuKitTests/RouteGeometryTests.swift`에 추가한다.

```swift
@Test("tangentAt: 직선은 진행 방위, 퇴화 구간은 nil")
func tangentAtBasics() {
    let straight = buildGuideRoute([
        GuideStepGeometry(description: "북진", pathCoords: [
            RoutePoint(lat: 37.5, lng: 127.1),
            RoutePoint(lat: 37.5 + 100 / 111320, lng: 127.1),
        ])
    ])!
    #expect(abs(tangentAt(poly: straight.polyline, d: 50, halfMeters: 15)! - 0) < 1)
    #expect(abs(tangentAt(poly: straight.polyline, d: 0, halfMeters: 15)! - 0) < 1)
    #expect(tangentAt(poly: GuidePolyline(points: [RoutePoint(lat: 37.5, lng: 127.1)], cum: [0]),
                      d: 0, halfMeters: 15) == nil)
}
```

Run: `cd ios/GildongmuKit && swift test --filter tangentAtBasics`
Expected: PASS

⚠ `GuidePolyline`·`GuideStepGeometry`의 이니셜라이저 인자 이름은 `RouteGeometry.swift` 정의를 그대로 따른다. 다르면 컴파일 오류로 즉시 드러난다.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/route-geometry.ts src/lib/__tests__/route-geometry.test.ts ios/GildongmuKit/Sources/GildongmuKit/RouteGeometry.swift ios/GildongmuKit/Tests/GildongmuKitTests/RouteGeometryTests.swift
git commit -m "feat(guide): 폴리라인 접선 순수 함수 (웹 ↔ Kit 미러)

방위 축이 경로 방향과 비교할 기준. 앞뒤 halfMeters 두 점을 잇는 방위라 정점
노이즈를 평활한다. 두 점이 같으면 nil — 0도로 접으면 '북쪽'이라는 거짓 정보가
된다(3-state 불변식).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" -- src/lib/route-geometry.ts src/lib/__tests__/route-geometry.test.ts ios/GildongmuKit/Sources/GildongmuKit/RouteGeometry.swift ios/GildongmuKit/Tests/GildongmuKitTests/RouteGeometryTests.swift
```

---

### Task 3: 표결·창·판정 순수 함수 (웹) + 공유 fixture

**Files:**
- Create: `src/lib/guide-course-axis.ts`
- Create: `src/lib/__tests__/fixtures/course-axis-scenarios.json`
- Test: `src/lib/__tests__/guide-course-axis.test.ts`

**Interfaces:**
- Consumes: Task 2의 `tangentAt`, 기존 `CourseState`(`guide-course.ts`), 기존 `Polyline`
- Produces (뒤 태스크가 이 이름과 타입에 의존한다):
  - `export interface CourseObservation { state: CourseState; accuracyDeg: number }`
  - `export const INACTIVE_COURSE: CourseObservation`
  - `export type CourseVote = "mismatch" | "match" | "unknown"`
  - `export interface CourseVoteSample { at: number; vote: CourseVote }`
  - `export function courseVote(obs: CourseObservation, poly: Polyline, d: number, fixAccuracy: number): CourseVote`
  - `export function recordVote(samples: readonly CourseVoteSample[], at: number, vote: CourseVote): CourseVoteSample[]`
  - `export type CourseAxisVerdict = "off" | "on" | "unknown"`
  - `export function courseAxisVerdict(samples: readonly CourseVoteSample[]): CourseAxisVerdict`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/__tests__/guide-course-axis.test.ts`를 만든다.

```ts
import { describe, expect, it } from "vitest";
import {
  courseAxisVerdict,
  courseVote,
  recordVote,
  INACTIVE_COURSE,
  COURSE_AXIS_WINDOW_S,
  type CourseVoteSample,
} from "../guide-course-axis";
import { buildGuideRoute } from "../route-geometry";

// 남 → 북 직선 200m (접선은 어디서나 0도)
const route = buildGuideRoute([
  { description: "북진", pathCoords: [
    { lat: 37.5, lng: 127.1 },
    { lat: 37.5 + 200 / 111320, lng: 127.1 },
  ] },
])!;
const obs = (course: number, accuracyDeg: number) => ({
  state: { kind: "valid" as const, course },
  accuracyDeg,
});

describe("courseVote", () => {
  it("나란하면 match", () => {
    expect(courseVote(obs(5, 10), route.polyline, 100, 10)).toBe("match");
  });

  it("크게 어긋나고 불확실성이 작으면 mismatch", () => {
    expect(courseVote(obs(120, 10), route.polyline, 100, 10)).toBe("mismatch");
  });

  it("어긋남이 불확실성 안에 들어가면 unknown — 통과권이 아니라 오차범위로 쓴다", () => {
    // 각도차 50°, 보고된 불확실성 40° → 실제로는 10°일 수 있다
    expect(courseVote(obs(50, 40), route.polyline, 100, 10)).toBe("unknown");
  });

  it("course가 valid가 아니면 unknown", () => {
    expect(courseVote(INACTIVE_COURSE, route.polyline, 100, 10)).toBe("unknown");
    expect(
      courseVote({ state: { kind: "invalid" }, accuracyDeg: 5 }, route.polyline, 100, 10),
    ).toBe("unknown");
  });

  it("위치 정확도가 나쁘면 unknown — 투영점이 틀리면 접선 비교가 무의미", () => {
    expect(courseVote(obs(120, 5), route.polyline, 100, 40)).toBe("unknown");
  });

  it("course가 유한 [0,360) 밖이면 unknown", () => {
    expect(courseVote(obs(Number.POSITIVE_INFINITY, 5), route.polyline, 100, 10)).toBe("unknown");
    expect(courseVote(obs(360, 5), route.polyline, 100, 10)).toBe("unknown");
    expect(courseVote(obs(Number.NaN, 5), route.polyline, 100, 10)).toBe("unknown");
  });

  it("유효 접선이 하나도 없으면 unknown", () => {
    const degenerate = { points: [{ lat: 37.5, lng: 127.1 }], cum: [0] };
    expect(courseVote(obs(120, 5), degenerate, 0, 10)).toBe("unknown");
  });
});

describe("recordVote", () => {
  it("창 밖 표본을 버린다", () => {
    let s: CourseVoteSample[] = [];
    s = recordVote(s, 0, "mismatch");
    s = recordVote(s, COURSE_AXIS_WINDOW_S + 1, "match");
    expect(s).toEqual([{ at: COURSE_AXIS_WINDOW_S + 1, vote: "match" }]);
  });

  it("같은 시각의 중복 fix는 하나로 합친다 — 배치 도착이 다수결을 장악하지 못하게", () => {
    let s: CourseVoteSample[] = [];
    s = recordVote(s, 5, "mismatch");
    s = recordVote(s, 5, "mismatch");
    s = recordVote(s, 5, "mismatch");
    expect(s).toHaveLength(1);
  });
});

describe("courseAxisVerdict", () => {
  const fill = (n: number, vote: "mismatch" | "match", startAt = 0): CourseVoteSample[] =>
    Array.from({ length: n }, (_, i) => ({ at: startAt + i * 2, vote }));

  it("표본이 시간을 충분히 덮지 않으면 unknown — 첫 표 하나로 확정하지 않는다", () => {
    expect(courseAxisVerdict([{ at: 0, vote: "mismatch" }])).toBe("unknown");
    // 4초만 덮은 3표는 전부 mismatch여도 확정하지 않는다
    expect(courseAxisVerdict(fill(3, "mismatch"))).toBe("unknown");
  });

  it("충분한 시간·표본에서 mismatch가 다수면 off", () => {
    expect(courseAxisVerdict(fill(10, "mismatch"))).toBe("off");
  });

  it("충분한 시간·표본에서 match가 다수면 on", () => {
    expect(courseAxisVerdict(fill(10, "match"))).toBe("on");
  });

  it("확정과 해제 사이 회색지대는 unknown — 히스테리시스", () => {
    const mixed: CourseVoteSample[] = [
      ...fill(5, "mismatch"),
      ...fill(5, "match", 10),
    ];
    expect(courseAxisVerdict(mixed)).toBe("unknown");
  });

  it("unknown 표는 분모에서 뺀다", () => {
    const s: CourseVoteSample[] = [
      ...fill(10, "mismatch"),
      ...Array.from({ length: 20 }, (_, i) => ({ at: i * 0.5, vote: "unknown" as const })),
    ];
    expect(courseAxisVerdict(s)).toBe("off");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/guide-course-axis.test.ts`
Expected: FAIL — 모듈을 찾을 수 없음

- [ ] **Step 3: 구현**

`src/lib/guide-course-axis.ts`를 만든다.

```ts
/**
 * 이탈 판정 방위 축(spec 2026-08-09). 웹 ↔ Kit `GuideCourseAxis.swift` 미러.
 *
 * 수직거리 축이 못 보는 이탈(자기근접으로 수직거리가 무너지는 갈림, 역주행)을
 * 진행 방위로 잡는다. 두 축은 독립 병렬이고 확정은 OR, 복귀는 활성 축 전체 해제다.
 *
 * ⚠ **`courseAccuracy`는 통과권이 아니라 불확실성이다.** 기존 `courseStep`의 45°
 * 게이트는 *4분할 방향 어절을 생략할지* 정하는 기준이지 *이탈을 증명하는* 기준이
 * 아니다. 각도차 50°에 불확실성 40°면 실제 차이는 10°일 수 있고, 그런 표를 모으면
 * 확신이 아니라 같은 오차의 반복 집계가 된다. 실측에서 이 구분을 빼면(다수결)
 * 지속 편향 잡음의 헛경고가 0.3% → 7.0%(가혹 조건 50.7%)로 무너졌다.
 */
import type { CourseState } from "./guide-course";
import { tangentAt, type Polyline } from "./route-geometry";

/** ⚠ 잠정값(spec §6·§7) — 실기기 로그로 확정한다. */
export const COURSE_AXIS_THRESHOLD_DEG = 45;
/** ⚠ 잠정값(spec §6·§7). */
export const COURSE_AXIS_WINDOW_S = 20;
/** ⚠ 잠정값(spec §6·§7). 확정 임계. */
export const COURSE_AXIS_CONFIRM_RATIO = 0.7;
/** ⚠ 잠정값(spec §6·§7). 해제 임계. 확정과 다른 값이라야 경계 진동이 없다. */
export const COURSE_AXIS_CLEAR_RATIO = 0.3;
/** ⚠ 잠정값(spec §6·§7). 판정 가능한 표가 덮어야 할 최소 시간(초). */
export const COURSE_AXIS_MIN_SPAN_S = 16;
/** ⚠ 잠정값(spec §6·§7). 판정 가능한 표의 최소 개수. */
export const COURSE_AXIS_MIN_VOTES = 8;
/** ⚠ 잠정값(spec §6·§7). 위원장 판정으로 앞뒤 10m. */
export const COURSE_AXIS_BACK_M = 10;
/** ⚠ 잠정값(spec §6·§7). */
export const COURSE_AXIS_AHEAD_M = 10;
/** ⚠ 잠정값(spec §6·§7). 접선 반폭. */
export const COURSE_AXIS_TANGENT_HALF_M = 15;
/** ⚠ 잠정값(spec §6·§7). 이 이상 부정확한 fix는 투영점이 틀려 접선 비교가 무의미하다. */
export const COURSE_AXIS_MAX_ACCURACY_M = 12;
/** 대조 접선 표본 간격(m). */
const SAMPLE_STEP_M = 5;

/**
 * 기기 방위 관측. `state`는 기존 `courseStep` 결과이고 `accuracyDeg`는 그 원본
 * 불확실성이다.
 *
 * ⚠ **둘을 함께 넘긴다.** `state`만 넘기면 불확실성이 사라져 이 축이 다시
 * 통과권 방식으로 되돌아간다.
 */
export interface CourseObservation {
  state: CourseState;
  accuracyDeg: number;
}

/** 방위를 제공하지 않는 플랫폼(웹)이 넘기는 값. 축이 통째로 꺼진다. */
export const INACTIVE_COURSE: CourseObservation = {
  state: { kind: "unknown" },
  accuracyDeg: 0,
};

export type CourseVote = "mismatch" | "match" | "unknown";

export interface CourseVoteSample {
  at: number;
  vote: CourseVote;
}

export type CourseAxisVerdict = "off" | "on" | "unknown";

const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * 한 fix의 표결.
 *
 * ⚠ **"경로의 어느 부분과도 나란하지 않은가"를 묻는다.** 단일 지점 접선과 비교하면
 * 모퉁이를 도는 동안 헛경고가 쏟아진다 — 사람은 2~3초에 급히 꺾는데 접선은 15m
 * 폭으로 완만하기 때문이다. 도는 중에도 꺾기 전이나 꺾은 뒤 방향과는 나란하다.
 */
export function courseVote(
  obs: CourseObservation,
  poly: Polyline,
  d: number,
  fixAccuracy: number,
): CourseVote {
  if (obs.state.kind !== "valid") return "unknown";
  const course = obs.state.course;
  if (!Number.isFinite(course) || course < 0 || course >= 360) return "unknown";
  if (!Number.isFinite(obs.accuracyDeg) || obs.accuracyDeg < 0) return "unknown";
  if (!(fixAccuracy > 0) || fixAccuracy > COURSE_AXIS_MAX_ACCURACY_M) return "unknown";

  let best: number | null = null;
  for (let offset = -COURSE_AXIS_BACK_M; offset <= COURSE_AXIS_AHEAD_M; offset += SAMPLE_STEP_M) {
    const t = tangentAt(poly, d + offset, COURSE_AXIS_TANGENT_HALF_M);
    if (t === null) continue;
    const diff = angDiff(course, t);
    if (best === null || diff < best) best = diff;
  }
  // 유효 접선이 하나도 없으면 판정하지 않는다(0도로 접지 않는다).
  if (best === null) return "unknown";

  if (best - obs.accuracyDeg > COURSE_AXIS_THRESHOLD_DEG) return "mismatch";
  if (best + obs.accuracyDeg < COURSE_AXIS_THRESHOLD_DEG) return "match";
  return "unknown";
}

/**
 * 표를 창에 기록한다.
 *
 * ⚠ **같은 시각의 중복 fix는 하나로 합친다.** 안 그러면 배치 도착한 fix 묶음이
 * 2초 움직임으로 20초 창의 다수를 장악한다.
 */
export function recordVote(
  samples: readonly CourseVoteSample[],
  at: number,
  vote: CourseVote,
): CourseVoteSample[] {
  const kept = samples.filter((s) => s.at > at - COURSE_AXIS_WINDOW_S && s.at !== at);
  return [...kept, { at, vote }];
}

/**
 * 창의 판정. `off`=이탈, `on`=경로 방향 정합, `unknown`=판정 불가.
 *
 * ⚠ **`unknown`은 `on`이 아니다.** 판정 근거가 없는데 정합으로 접으면, 실제 방향을
 * 전혀 모르는 상태에서 "돌아왔습니다"를 발화하게 된다(3-state 불변식).
 */
export function courseAxisVerdict(samples: readonly CourseVoteSample[]): CourseAxisVerdict {
  const decisive = samples.filter((s) => s.vote !== "unknown");
  if (decisive.length < COURSE_AXIS_MIN_VOTES) return "unknown";
  const span = Math.max(...decisive.map((s) => s.at)) - Math.min(...decisive.map((s) => s.at));
  if (span < COURSE_AXIS_MIN_SPAN_S) return "unknown";
  const ratio = decisive.filter((s) => s.vote === "mismatch").length / decisive.length;
  if (ratio >= COURSE_AXIS_CONFIRM_RATIO) return "off";
  if (ratio <= COURSE_AXIS_CLEAR_RATIO) return "on";
  return "unknown";
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/guide-course-axis.test.ts`
Expected: PASS (전체)

- [ ] **Step 5: 공유 fixture 작성**

`src/lib/__tests__/fixtures/course-axis-scenarios.json`을 만든다. Kit이 같은 표를 소비해 동조를 강제한다.

```json
{
  "comment": "방위 축 표결·판정 경계표. 웹 guide-course-axis.test.ts와 Kit GuideCourseAxisTests가 함께 소비한다(드리프트 가드). 경로는 남→북 직선 200m이므로 접선은 어디서나 0도다. d는 진행거리(m).",
  "votes": [
    { "name": "나란함", "course": 5, "courseAcc": 10, "d": 100, "fixAcc": 10, "expect": "match" },
    { "name": "크게 어긋남", "course": 120, "courseAcc": 10, "d": 100, "fixAcc": 10, "expect": "mismatch" },
    { "name": "불확실성이 임계를 걸침", "course": 50, "courseAcc": 40, "d": 100, "fixAcc": 10, "expect": "unknown" },
    { "name": "위치 부정확", "course": 120, "courseAcc": 5, "d": 100, "fixAcc": 40, "expect": "unknown" },
    { "name": "course 범위 밖", "course": 360, "courseAcc": 5, "d": 100, "fixAcc": 10, "expect": "unknown" },
    { "name": "경계 바로 위", "course": 56, "courseAcc": 5, "d": 100, "fixAcc": 10, "expect": "mismatch" },
    { "name": "경계 바로 아래", "course": 39, "courseAcc": 5, "d": 100, "fixAcc": 10, "expect": "match" }
  ],
  "verdicts": [
    { "name": "표본 부족", "votes": [["mismatch", 0]], "expect": "unknown" },
    { "name": "시간 미달", "votes": [["mismatch", 0], ["mismatch", 2], ["mismatch", 4], ["mismatch", 6], ["mismatch", 8], ["mismatch", 10], ["mismatch", 12], ["mismatch", 14]], "expect": "unknown" },
    { "name": "확정", "votes": [["mismatch", 0], ["mismatch", 2], ["mismatch", 4], ["mismatch", 6], ["mismatch", 8], ["mismatch", 10], ["mismatch", 12], ["mismatch", 14], ["mismatch", 16], ["mismatch", 18]], "expect": "off" },
    { "name": "해제", "votes": [["match", 0], ["match", 2], ["match", 4], ["match", 6], ["match", 8], ["match", 10], ["match", 12], ["match", 14], ["match", 16], ["match", 18]], "expect": "on" },
    { "name": "회색지대", "votes": [["mismatch", 0], ["mismatch", 2], ["mismatch", 4], ["mismatch", 6], ["mismatch", 8], ["match", 10], ["match", 12], ["match", 14], ["match", 16], ["match", 18]], "expect": "unknown" }
  ]
}
```

⚠ "시간 미달" 케이스는 8표가 14초만 덮는다(`MIN_SPAN_S`=16 미만). 개수는 채우고 시간은 못 채우는 경계다.

- [ ] **Step 6: fixture 소비 테스트 추가**

`src/lib/__tests__/guide-course-axis.test.ts` 끝에 추가한다.

```ts
import scenarios from "./fixtures/course-axis-scenarios.json";

describe("공유 fixture (Kit 동조 가드)", () => {
  it.each(scenarios.votes)("표결: $name", (c) => {
    expect(
      courseVote(
        { state: { kind: "valid", course: c.course }, accuracyDeg: c.courseAcc },
        route.polyline,
        c.d,
        c.fixAcc,
      ),
    ).toBe(c.expect);
  });

  it.each(scenarios.verdicts)("판정: $name", (c) => {
    const samples = (c.votes as [string, number][]).map(([vote, at]) => ({
      at,
      vote: vote as CourseVote,
    }));
    expect(courseAxisVerdict(samples)).toBe(c.expect);
  });
});
```

Run: `npx vitest run src/lib/__tests__/guide-course-axis.test.ts`
Expected: PASS (fixture 12건 포함)

- [ ] **Step 7: 커밋**

```bash
git add src/lib/guide-course-axis.ts src/lib/__tests__/guide-course-axis.test.ts src/lib/__tests__/fixtures/course-axis-scenarios.json
git commit -m "feat(guide): 방위 축 표결·창·판정 순수 함수

courseAccuracy를 통과권이 아니라 불확실성으로 써 mismatch/match/unknown 3-state로
표결한다. 다수결(2-state)은 잡음이 독립일 때만 성립하고, 지속 편향에서는 오류를
거르는 게 아니라 반복 관측으로 승격시킨다(실측 헛경고 0.3%→7.0%).

- 대조는 '경로의 어느 부분과도 나란하지 않은가' — 단일 접선 비교는 모퉁이에서 오탐
- 같은 시각 중복 fix는 합친다(배치 도착이 창을 장악하지 못하게)
- 최소 표본 수 + 최소 시간 span 둘 다 요구(첫 표 하나로 확정 금지)
- unknown은 on이 아니다(근거 없이 복귀를 선언하지 않는다)
- 상수는 전부 잠정값 — 실기기 로그로 확정한다(spec §6·§7)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" -- src/lib/guide-course-axis.ts src/lib/__tests__/guide-course-axis.test.ts src/lib/__tests__/fixtures/course-axis-scenarios.json
```

---

### Task 4: Kit 미러 + fixture 동조

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/GuideCourseAxis.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/GuideCourseAxisTests.swift`
- Modify: `ios/GildongmuKit/Tests/GildongmuKitTests/` 리소스 경로 설정(공유 fixture 접근)

**Interfaces:**
- Consumes: Task 3의 계약(같은 이름·같은 판정), Task 2의 `tangentAt`
- Produces: `CourseObservation`(Swift struct), `inactiveCourse`, `CourseVote`, `CourseVoteSample`, `courseVote(_:poly:d:fixAccuracy:)`, `recordVote(_:at:vote:)`, `CourseAxisVerdict`, `courseAxisVerdict(_:)`

- [ ] **Step 1: Kit 구현**

`ios/GildongmuKit/Sources/GildongmuKit/GuideCourseAxis.swift`를 만든다.

```swift
import Foundation

/// 이탈 판정 방위 축(spec 2026-08-09). 웹 `guide-course-axis.ts` 미러.
///
/// ⚠ **`courseAccuracy`는 통과권이 아니라 불확실성이다.** 기존 `courseStep`의 45°
/// 게이트는 4분할 방향 어절 생략 기준이지 이탈 증명 기준이 아니다. 실측에서 이
/// 구분을 빼면 지속 편향 잡음의 헛경고가 0.3% → 7.0%로 무너졌다.

/// ⚠ 잠정값(spec §6·§7) — 실기기 로그로 확정한다.
public let courseAxisThresholdDegrees = 45.0
/// ⚠ 잠정값(spec §6·§7).
public let courseAxisWindowSeconds = 20.0
/// ⚠ 잠정값(spec §6·§7). 확정 임계.
public let courseAxisConfirmRatio = 0.7
/// ⚠ 잠정값(spec §6·§7). 해제 임계.
public let courseAxisClearRatio = 0.3
/// ⚠ 잠정값(spec §6·§7).
public let courseAxisMinSpanSeconds = 16.0
/// ⚠ 잠정값(spec §6·§7).
public let courseAxisMinVotes = 8
/// ⚠ 잠정값(spec §6·§7). 위원장 판정으로 앞뒤 10m.
public let courseAxisBackMeters = 10.0
/// ⚠ 잠정값(spec §6·§7).
public let courseAxisAheadMeters = 10.0
/// ⚠ 잠정값(spec §6·§7).
public let courseAxisTangentHalfMeters = 15.0
/// ⚠ 잠정값(spec §6·§7).
public let courseAxisMaxAccuracyMeters = 12.0
private let courseAxisSampleStepMeters = 5.0

/// 기기 방위 관측. ⚠ `state`와 `accuracyDeg`를 **함께** 넘긴다.
public struct CourseObservation: Sendable, Equatable {
    public let state: CourseState
    public let accuracyDeg: Double

    public init(state: CourseState, accuracyDeg: Double) {
        self.state = state
        self.accuracyDeg = accuracyDeg
    }
}

/// 방위를 제공하지 않는 경로가 넘기는 값. 축이 통째로 꺼진다.
public let inactiveCourse = CourseObservation(state: .unknown, accuracyDeg: 0)

public enum CourseVote: String, Sendable, Equatable {
    case mismatch, match, unknown
}

public struct CourseVoteSample: Sendable, Equatable {
    public let at: Double
    public let vote: CourseVote

    public init(at: Double, vote: CourseVote) {
        self.at = at
        self.vote = vote
    }
}

public enum CourseAxisVerdict: String, Sendable, Equatable {
    case off, on, unknown
}

private func angDiff(_ a: Double, _ b: Double) -> Double {
    abs((a - b + 540).truncatingRemainder(dividingBy: 360) - 180)
}

/// 한 fix의 표결. ⚠ "경로의 어느 부분과도 나란하지 않은가"를 묻는다.
public func courseVote(
    _ obs: CourseObservation, poly: GuidePolyline, d: Double, fixAccuracy: Double
) -> CourseVote {
    guard case let .valid(course) = obs.state else { return .unknown }
    guard course.isFinite, course >= 0, course < 360 else { return .unknown }
    guard obs.accuracyDeg.isFinite, obs.accuracyDeg >= 0 else { return .unknown }
    guard fixAccuracy > 0, fixAccuracy <= courseAxisMaxAccuracyMeters else { return .unknown }

    var best: Double?
    var offset = -courseAxisBackMeters
    while offset <= courseAxisAheadMeters {
        if let t = tangentAt(poly: poly, d: d + offset, halfMeters: courseAxisTangentHalfMeters) {
            let diff = angDiff(course, t)
            if best == nil || diff < best! { best = diff }
        }
        offset += courseAxisSampleStepMeters
    }
    guard let best else { return .unknown }

    if best - obs.accuracyDeg > courseAxisThresholdDegrees { return .mismatch }
    if best + obs.accuracyDeg < courseAxisThresholdDegrees { return .match }
    return .unknown
}

/// ⚠ 같은 시각의 중복 fix는 하나로 합친다.
public func recordVote(
    _ samples: [CourseVoteSample], at: Double, vote: CourseVote
) -> [CourseVoteSample] {
    var kept = samples.filter { $0.at > at - courseAxisWindowSeconds && $0.at != at }
    kept.append(CourseVoteSample(at: at, vote: vote))
    return kept
}

/// ⚠ `unknown`은 `on`이 아니다(근거 없이 복귀를 선언하지 않는다).
public func courseAxisVerdict(_ samples: [CourseVoteSample]) -> CourseAxisVerdict {
    let decisive = samples.filter { $0.vote != .unknown }
    guard decisive.count >= courseAxisMinVotes else { return .unknown }
    let ats = decisive.map(\.at)
    guard let hi = ats.max(), let lo = ats.min(), hi - lo >= courseAxisMinSpanSeconds else {
        return .unknown
    }
    let ratio = Double(decisive.filter { $0.vote == .mismatch }.count) / Double(decisive.count)
    if ratio >= courseAxisConfirmRatio { return .off }
    if ratio <= courseAxisClearRatio { return .on }
    return .unknown
}
```

- [ ] **Step 2: fixture 읽기 — 기존 선례를 그대로 따른다**

`RouteGuideTests.swift:50`이 이미 `#filePath` 상대 경로로 웹 fixture를 읽는다. **그 함수를 복사해 경로만 바꾼다.**

```swift
// GuideCourseAxisTests.swift 안 (RouteGuideTests.swift:50 선례 동형)
private func scenariosURL() -> URL {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<4 { url.deleteLastPathComponent() }  // GildongmuKitTests → Tests → GildongmuKit → ios
    url.appendPathComponent("src/lib/__tests__/fixtures/course-axis-scenarios.json")
    return url
}
```

⚠ **fixture를 Kit 쪽으로 복사하지 말 것.** `Package.swift`의 `resources: [.copy("Fixtures")]`는 Kit **고유** fixture용이고, 웹과 공유하는 표는 상대 경로로 읽는 것이 이 repo 관례다. 사본을 두면 두 파일이 갈리고, 갈리면 동조 가드가 통과하면서 두 플랫폼이 다르게 동작한다.

⚠ 상위 디렉터리 개수(`0..<4`)는 `RouteGuideTests.swift`의 것과 같아야 한다. 다르면 파일을 못 찾아 테스트가 즉시 실패하므로 조용한 오류는 아니다.

- [ ] **Step 3: Kit 테스트 작성**

`ios/GildongmuKit/Tests/GildongmuKitTests/GuideCourseAxisTests.swift`를 만든다.

```swift
import Foundation
import Testing

@testable import GildongmuKit

private struct VoteCase: Decodable {
    let name: String
    let course: Double
    let courseAcc: Double
    let d: Double
    let fixAcc: Double
    let expect: String
}

private struct VerdictCase: Decodable {
    let name: String
    let votes: [[VoteEntry]]
    let expect: String

    enum VoteEntry: Decodable {
        case text(String)
        case number(Double)
        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let s = try? c.decode(String.self) { self = .text(s) } else {
                self = .number(try c.decode(Double.self))
            }
        }
    }
}

private struct Scenarios: Decodable {
    let votes: [VoteCase]
    let verdicts: [VerdictCase]
}

private let straight: GuideRoute = buildGuideRoute([
    GuideStepGeometry(description: "북진", pathCoords: [
        RoutePoint(lat: 37.5, lng: 127.1),
        RoutePoint(lat: 37.5 + 200 / 111320, lng: 127.1),
    ])
])!

private func loadScenarios() throws -> Scenarios {
    let here = URL(fileURLWithPath: #filePath)
    let root = here
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let url = root
        .appendingPathComponent("src/lib/__tests__/fixtures/course-axis-scenarios.json")
    return try JSONDecoder().decode(Scenarios.self, from: Data(contentsOf: url))
}

@Test("공유 fixture 표결 — 웹과 같은 판정")
func voteMatchesWebFixture() throws {
    for c in try loadScenarios().votes {
        let got = courseVote(
            CourseObservation(state: .valid(course: c.course), accuracyDeg: c.courseAcc),
            poly: straight.polyline, d: c.d, fixAccuracy: c.fixAcc
        )
        #expect(got.rawValue == c.expect, "\(c.name): got \(got.rawValue) want \(c.expect)")
    }
}

@Test("공유 fixture 판정 — 웹과 같은 verdict")
func verdictMatchesWebFixture() throws {
    for c in try loadScenarios().verdicts {
        var samples: [CourseVoteSample] = []
        for pair in c.votes {
            guard case let .text(v) = pair[0], case let .number(at) = pair[1] else { continue }
            samples.append(CourseVoteSample(at: at, vote: CourseVote(rawValue: v)!))
        }
        let got = courseAxisVerdict(samples)
        #expect(got.rawValue == c.expect, "\(c.name): got \(got.rawValue) want \(c.expect)")
    }
}

@Test("비활성 관측은 축을 끈다")
func inactiveObservationDisablesAxis() {
    #expect(courseVote(inactiveCourse, poly: straight.polyline, d: 100, fixAccuracy: 10) == .unknown)
}
```

- [ ] **Step 4: Kit 테스트 실행**

Run: `cd ios/GildongmuKit && swift test --filter GuideCourseAxis`
Expected: PASS (3 tests). 웹과 판정이 하나라도 다르면 실패 메시지가 케이스 이름과 함께 뜬다.

- [ ] **Step 5: 커밋**

```bash
git add ios/GildongmuKit/Sources/GildongmuKit/GuideCourseAxis.swift ios/GildongmuKit/Tests/GildongmuKitTests/GuideCourseAxisTests.swift
git commit -m "feat(guide): 방위 축 Kit 미러 + 공유 fixture 동조

웹 guide-course-axis.ts와 같은 판정을 내는지 공유 fixture가 강제한다. fixture는
웹 경로를 상대 경로로 읽는다 — 사본을 두면 갈리고, 갈리면 가드가 통과하면서
두 플랫폼이 다르게 동작한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" -- ios/GildongmuKit/Sources/GildongmuKit/GuideCourseAxis.swift ios/GildongmuKit/Tests/GildongmuKitTests/GuideCourseAxisTests.swift
```

---

### Task 5: 웹 리듀서 통합

**Files:**
- Modify: `src/lib/route-guide.ts`
- Test: `src/lib/__tests__/route-guide.test.ts` (기존 파일에 describe 추가)

**Interfaces:**
- Consumes: Task 3의 전부
- Produces:
  - `GuideState`에 `offRouteAxes: { distance: boolean; course: boolean }`, `courseVotes: readonly CourseVoteSample[]`
  - `guideStep(state, fix, route, now, tuning, course: CourseObservation)` — **6번째 인자는 필수다**

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/__tests__/route-guide.test.ts` 끝에 추가한다. 헬퍼(`makeRoute` 등)는 그 파일의 기존 것을 재사용한다.

```ts
describe("방위 축 통합", () => {
  // 남→북 직선 400m. 접선은 어디서나 0도.
  const route = buildGuideRoute([
    { description: "북진", pathCoords: [
      { lat: 37.5, lng: 127.1 },
      { lat: 37.5 + 400 / 111320, lng: 127.1 },
    ] },
  ])!;
  const at = (along: number) => ({
    lat: 37.5 + along / 111320,
    lng: 127.1,
    accuracy: 8,
  });
  const facing = (deg: number): CourseObservation => ({
    state: { kind: "valid", course: deg },
    accuracyDeg: 5,
  });

  it("경로 위에 있어도 방향이 지속적으로 어긋나면 이탈을 확정한다", () => {
    let { state } = initialGuideState(route, 0);
    let sawOffRoute = false;
    // 25초 동안 경로 위를 따라가되 방위만 남쪽(180도)으로 보고한다.
    for (let t = 1; t <= 25; t++) {
      const out = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, facing(180));
      state = out.state;
      if (out.event?.kind === "offRoute") sawOffRoute = true;
    }
    expect(sawOffRoute).toBe(true);
    expect(state.phase).toBe("offRoute");
    expect(state.offRouteAxes.course).toBe(true);
    // 수직거리는 0이므로 거리 축은 잠기지 않았다.
    expect(state.offRouteAxes.distance).toBe(false);
  });

  it("방위 축으로 확정한 이탈은 방향이 맞아야 복귀한다", () => {
    let { state } = initialGuideState(route, 0);
    for (let t = 1; t <= 25; t++) {
      state = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, facing(180)).state;
    }
    expect(state.phase).toBe("offRoute");
    // 위치는 계속 경로 위다. 방위만 어긋난 채로 두면 복귀하지 않는다.
    for (let t = 26; t <= 40; t++) {
      const out = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, facing(180));
      state = out.state;
      expect(out.event?.kind).not.toBe("backOnRoute");
    }
    // 방향이 맞기 시작하면 복귀한다.
    let recovered = false;
    for (let t = 41; t <= 70; t++) {
      const out = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, facing(0));
      state = out.state;
      if (out.event?.kind === "backOnRoute") recovered = true;
    }
    expect(recovered).toBe(true);
  });

  it("방위를 못 읽으면 복귀를 선언하지 않는다 — unknown은 정합이 아니다", () => {
    let { state } = initialGuideState(route, 0);
    for (let t = 1; t <= 25; t++) {
      state = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, facing(180)).state;
    }
    expect(state.phase).toBe("offRoute");
    for (let t = 26; t <= 60; t++) {
      const out = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, INACTIVE_COURSE);
      state = out.state;
      expect(out.event?.kind).not.toBe("backOnRoute");
    }
    expect(state.phase).toBe("offRoute");
  });

  it("비활성 관측만 주면 동작이 종전과 같다(웹 회귀 0)", () => {
    let a = initialGuideState(route, 0).state;
    let b = initialGuideState(route, 0).state;
    for (let t = 1; t <= 30; t++) {
      a = guideStep(a, at(t * 1.2), route, t, WALK_TUNING, INACTIVE_COURSE).state;
      b = guideStep(b, at(t * 1.2), route, t, WALK_TUNING, INACTIVE_COURSE).state;
    }
    expect(a.phase).toBe(b.phase);
    expect(a.offRouteAxes).toEqual({ distance: false, course: false });
  });

  it("상태 재구성은 표결 창을 비운다 — 옛 경로의 표가 새 경로에 적용되면 안 된다", () => {
    let { state } = initialGuideState(route, 0);
    for (let t = 1; t <= 10; t++) {
      state = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, facing(180)).state;
    }
    expect(state.courseVotes.length).toBeGreaterThan(0);
    const fresh = guideStateAt(route, 0, 100, {});
    expect(fresh.courseVotes).toEqual([]);
    expect(fresh.offRouteAxes).toEqual({ distance: false, course: false });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/route-guide.test.ts -t "방위 축 통합"`
Expected: FAIL — `guideStep` 인자 개수 불일치 / `offRouteAxes` 없음

- [ ] **Step 3: 상태 확장**

`src/lib/route-guide.ts`의 `GuideState`에 추가한다.

```ts
  /**
   * 축별 이탈 latch. 확정은 OR, 복귀는 **평가 가능한 활성 축 전체 해제**다.
   *
   * ⚠ 단일 "원인" 문자열로 접지 않는다 — 거리 축으로 이탈한 뒤 사용자가 역주행해도
   * 방위 상태가 기록되지 않아 방향이 어긋난 채 복귀가 선언된다(codex 리뷰 7).
   */
  offRouteAxes: { distance: boolean; course: boolean };
  /** 방위 표결 창. 상태 재구성 시 비워진다(경로 identity 바인딩). */
  courseVotes: readonly CourseVoteSample[];
```

`guideStateAt`의 반환 객체에 추가한다.

```ts
    offRouteAxes: { distance: false, course: false },
    courseVotes: [],
```

- [ ] **Step 4: 시그니처와 표결 기록**

`guideStep` 시그니처를 바꾼다. **기본값을 주지 않는다** — 생략이 컴파일을 통과하면 호출 지점 누락이 조용한 결함이 된다.

```ts
export function guideStep(
  state: GuideState,
  fix: GuideFix,
  route: GuideRoute,
  now: number,
  tuning: GuideTuning,
  course: CourseObservation,
): GuideOutput {
```

⚠ `tuning`의 기존 기본값(`= WALK_TUNING`)도 함께 제거한다. 뒤 인자가 필수인데 앞 인자가 선택이면 호출부가 `tuning`을 건너뛸 수 없다.

3절 투영 직후(`const d = Math.max(state.d, proj.d);` 다음)에 표결을 기록한다.

```ts
  // 방위 축 표결(spec §2.1). 추종 중 기준은 구속 창 투영 결과다.
  const vote = courseVote(course, route.polyline, d, fix.accuracy);
  const courseVotes = recordVote(state.courseVotes, now, vote);
```

`next` 조립에 `courseVotes`를 넣는다.

- [ ] **Step 5: 이탈 확정을 OR로**

5절의 `isOff` 아래를 바꾼다. 거리 축의 기존 누적(`offRouteSince`·hold)은 **그대로 두고**, 확정 시 latch만 세운다.

```ts
  const courseVerdict = courseAxisVerdict(courseVotes);
  const isOff = proj.perpMeters > offThreshold;
  if (isOff) {
    let since = state.offRouteSince ?? now;
    let peak = Math.max(state.offRoutePeakPerp ?? 0, proj.perpMeters);
    if (tuning.offRouteTrend && proj.perpMeters < peak - 5) {
      since = now;
      peak = proj.perpMeters;
    }
    next = { ...next, offRouteSince: since, offRoutePeakPerp: peak };
    if (now - since >= tuning.offRouteHoldS) {
      next = {
        ...next,
        phase: "offRoute",
        resumePhase: stepAt(route, d).isLong ? "following" : "bundle",
        lastOffRouteNoticeAt: now,
        offRoutePeakPerp: null,
        offRouteAxes: { ...next.offRouteAxes, distance: true },
      };
      return { state: next, event: { kind: "offRoute" }, tone: "warning" };
    }
  } else if (state.offRouteSince !== null) {
    next = { ...next, offRouteSince: null, offRoutePeakPerp: null };
  }
  // 방위 축은 거리 축과 독립이다. 수직거리가 임계 안이어도 확정한다.
  if (courseVerdict === "off") {
    next = {
      ...next,
      phase: "offRoute",
      resumePhase: stepAt(route, d).isLong ? "following" : "bundle",
      lastOffRouteNoticeAt: now,
      offRouteAxes: { ...next.offRouteAxes, course: true },
    };
    return { state: next, event: { kind: "offRoute" }, tone: "warning" };
  }
```

- [ ] **Step 6: 복귀 계약**

5절 앞머리의 `if (state.phase === "offRoute")` 블록을 바꾼다.

```ts
  if (state.phase === "offRoute") {
    const entry = entryProjection(route, fix, tuning);
    // ⚠ 이탈 중 표결 기준은 `state.d`가 아니라 `entryProjection`이 고른 지점이다.
    //   `state.d`는 단조 전진이라 역주행·되돌아가기에서 실제 복귀 지점과 다르다.
    //   후보가 모호하면 방위가 맞아도 복귀를 확정하지 않는다(판정 근거 없음).
    const offVote =
      entry.status === "ok"
        ? courseVote(course, route.polyline, entry.d, fix.accuracy)
        : ("unknown" as CourseVote);
    const offVotes = recordVote(state.courseVotes, now, offVote);
    next = { ...next, courseVotes: offVotes };
    if (entry.status === "ok") {
      // 축별 해제. 평가 불가(`unknown`)는 해제가 아니다.
      const courseCleared =
        !state.offRouteAxes.course || courseAxisVerdict(offVotes) === "on";
      if (courseCleared) {
        const back: GuideState = {
          ...restateAt(route, entry.d, now, state),
          speedSamples: samples,
          speedGuardActive,
          speedWarned: state.speedWarned,
          lastFixAt: now,
        };
        return { state: back, event: { kind: "backOnRoute" }, tone: null };
      }
    }
    const canRenotify =
      !speedGuardActive &&
      (state.lastOffRouteNoticeAt === null ||
        now - state.lastOffRouteNoticeAt >= tuning.offRouteRenotifyS);
    if (canRenotify) {
      next = { ...next, lastOffRouteNoticeAt: now };
      return {
        state: next,
        event: { kind: "offRoute" },
        tone: tuning.offRouteRenotifyWarns ? "warning" : null,
      };
    }
    return { state: next, event: null, tone: null };
  }
```

⚠ `restateAt`이 `guideStateAt`을 거치므로 복귀 시 창과 latch가 자동으로 초기화된다(§2.8). 이것이 창 무효화 계약의 구현이다.

⚠ **이탈 중에도 창을 비우지 않는다.** 국면 초기화는 `uncertain`·`reacquiring`·`finalApproach`에만 적용된다. `offRoute`에서 비우면 복귀 판정 표본이 영영 최소치에 못 미친다.

- [ ] **Step 7: 국면 초기화와 실행 순서**

2절(`uncertain`)과 `reacquiring` 분기에서 `courseVotes: []`로 비운다. `finalApproach` early-return(0a)에도 넣는다.

6a절 최종 접근 진입 조건을 넓힌다.

```ts
  if (
    !isOff &&
    courseVerdict !== "off" &&
    next.autoHandoffArmed &&
```

⚠ **새 축의 표결과 확정이 6a보다 앞이다.** 뒤에 두면 종점 근처에서 `finalApproachEnter`가 먼저 반환되고, 다음 fix부터 0a 가드가 모든 판정을 멈춰 확인된 이탈이 영구히 소실된다.

- [ ] **Step 8: `reacquiring` 복귀도 같은 계약을 거치게**

`reacquiring` 분기는 후보를 `entryD`(`number | null`)에 담고, `entryD !== null`이면 `restateAt(route, entryD, now, state)`로 복귀하며 이벤트를 `state.reacquiringFromOffRoute ? "backOnRoute" : "reacquired"`로 가른다. **그 `restateAt` 호출 바로 앞**에 넣는다.

```ts
      // ⚠ 재획득 성공도 복귀다. 방위 축이 잠겨 있으면 위치만으로 풀지 않는다.
      //   이 경로가 §5의 offRoute 분기보다 **먼저** 실행되므로, 여기를 빼면
      //   fix 공백 10초만으로 복귀 계약이 통째로 우회된다.
      const reVotes = recordVote(
        state.courseVotes,
        now,
        courseVote(course, route.polyline, entryD, fix.accuracy),
      );
      if (state.offRouteAxes.course && courseAxisVerdict(reVotes) !== "on") {
        // 위치는 되찾았지만 방향이 확인되지 않았다 — 이탈 상태를 유지한다.
        return {
          state: {
            ...state,
            phase: "offRoute",
            lastFixAt: now,
            courseVotes: reVotes,
            reacquiringFromOffRoute: false,
          },
          event: null,
          tone: null,
        };
      }
```

⚠ `reacquiringFromOffRoute`를 `false`로 내리는 이유: 국면을 `offRoute`로 되돌리므로 재획득 상태가 아니다. 남겨 두면 다음 재획득에서 이미 소비된 플래그가 이벤트 종류를 잘못 가른다.

- [ ] **Step 8b: `uncertain` 복귀에서 축 latch 보존 확인**

`uncertain` 복귀 분기는 `phase: state.resumePhase`로 국면을 되돌리고 나머지는 스프레드로 보존한다. `offRouteAxes`·`courseVotes`가 그 스프레드에 포함되는지 **읽어서 확인**하고, 명시적으로 덮어쓰는 자리가 있으면 제거한다.

`resumePhase`가 `"offRoute"`인 경우(이탈 중 정확도 악화로 uncertain을 경유)에 latch가 살아 있어야 한다. 테스트를 추가한다.

```ts
  it("uncertain을 경유해도 축 latch가 보존된다", () => {
    let { state } = initialGuideState(route, 0);
    for (let t = 1; t <= 25; t++) {
      state = guideStep(state, at(t * 1.2), route, t, WALK_TUNING, facing(180)).state;
    }
    expect(state.offRouteAxes.course).toBe(true);
    // 정확도 악화로 uncertain 진입
    for (let t = 26; t <= 30; t++) {
      state = guideStep(
        state,
        { ...at(t * 1.2), accuracy: 80 },
        route,
        t,
        WALK_TUNING,
        INACTIVE_COURSE,
      ).state;
    }
    expect(state.phase).toBe("uncertain");
    expect(state.resumePhase).toBe("offRoute");
    expect(state.offRouteAxes.course).toBe(true);
  });
```

⚠ **창(`courseVotes`)은 uncertain에서 비운다**(투영을 신뢰할 수 없으니 그 기간의 표는 근거가 아니다). **latch는 보존한다**(이탈 사실이 정확도 악화로 소실되면 안 된다). 둘을 같이 취급하지 말 것.

- [ ] **Step 9: 통과 확인**

Run: `npx vitest run src/lib/__tests__/route-guide.test.ts`
Expected: PASS 전체. 기존 시나리오 fixture도 통과해야 한다(호출부에 `INACTIVE_COURSE`를 넘기도록 테스트 헬퍼를 고친다).

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `5`(선재 기준선. 늘었으면 이 태스크가 원인이다)

- [ ] **Step 10: 커밋**

```bash
git add src/lib/route-guide.ts src/lib/__tests__/route-guide.test.ts
git commit -m "feat(guide): 방위 축 리듀서 통합 (웹)

- 축별 latch(offRouteAxes)로 확정은 OR, 복귀는 활성 축 전체 해제
- 이탈 중 표결 기준은 entryProjection이 고른 지점(state.d는 단조 전진이라 다르다)
- unknown은 해제가 아니다 — 방위를 못 읽는 동안 복귀를 선언하지 않는다
- reacquiring 성공도 같은 복귀 계약을 거친다(위치만으로 풀지 않는다)
- 표결·확정을 finalApproach 진입보다 앞에 배선(뒤면 확인된 이탈이 영구 소실)
- guideStep의 course 인자는 필수 — 기본값을 주면 호출 지점 누락이 조용한 결함이 된다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" -- src/lib/route-guide.ts src/lib/__tests__/route-guide.test.ts
```

---

### Task 6: Kit 리듀서 통합

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift`

**Interfaces:**
- Consumes: Task 4·5의 전부
- Produces: `GuideState.offRouteAxes: OffRouteAxes`, `GuideState.courseVotes: [CourseVoteSample]`, `guideStep(state:fix:route:now:tuning:course:)`

- [ ] **Step 1: 상태 확장**

`RouteGuide.swift`의 `GuideState`에 추가한다.

```swift
    /// 축별 이탈 latch. 확정은 OR, 복귀는 평가 가능한 활성 축 전체 해제다.
    /// ⚠ 단일 "원인"으로 접지 않는다 — 거리로 이탈한 뒤 역주행해도 방위 상태가
    /// 기록되지 않아 방향이 어긋난 채 복귀가 선언된다.
    public var offRouteAxes: OffRouteAxes
    /// 방위 표결 창. 상태 재구성 시 비워진다.
    public var courseVotes: [CourseVoteSample]
```

같은 파일에 타입을 더한다.

```swift
public struct OffRouteAxes: Sendable, Equatable {
    public var distance: Bool
    public var course: Bool

    public init(distance: Bool = false, course: Bool = false) {
        self.distance = distance
        self.course = course
    }
}
```

`guideStateAt`의 반환에 `offRouteAxes: OffRouteAxes()`, `courseVotes: []`를 넣는다.

- [ ] **Step 2: 시그니처와 배선**

웹 Task 5 Step 4~8과 **같은 순서·같은 조건**으로 옮긴다. 기본값을 주지 않는다.

```swift
public func guideStep(
    state: GuideState, fix: GuideFix, route: GuideRoute, now: Double,
    tuning: GuideTuning, course: CourseObservation
) -> GuideOutput {
```

⚠ `tuning`의 기존 기본값(`= .walk`)도 제거한다.

- [ ] **Step 3: Kit 테스트 작성**

`RouteGuideTests.swift`에 웹 Task 5 Step 1의 5개 시나리오와 **같은 이름·같은 기대**로 추가한다.

```swift
private let axisRoute: GuideRoute = buildGuideRoute([
    GuideStepGeometry(description: "북진", pathCoords: [
        RoutePoint(lat: 37.5, lng: 127.1),
        RoutePoint(lat: 37.5 + 400 / 111320, lng: 127.1),
    ])
])!

private func axisFix(_ along: Double) -> GuideFix {
    GuideFix(lat: 37.5 + along / 111320, lng: 127.1, accuracy: 8)
}

private func facing(_ deg: Double) -> CourseObservation {
    CourseObservation(state: .valid(course: deg), accuracyDeg: 5)
}

@Test("경로 위에 있어도 방향이 지속 어긋나면 이탈 확정")
func courseAxisConfirmsOnRoute() {
    var state = initialGuideState(route: axisRoute, now: 0).state
    var sawOffRoute = false
    for t in 1...25 {
        let out = guideStep(
            state: state, fix: axisFix(Double(t) * 1.2), route: axisRoute,
            now: Double(t), tuning: .walk, course: facing(180)
        )
        state = out.state
        if out.event == .offRoute { sawOffRoute = true }
    }
    #expect(sawOffRoute)
    #expect(state.phase == .offRoute)
    #expect(state.offRouteAxes.course)
    #expect(!state.offRouteAxes.distance)
}

@Test("방위를 못 읽으면 복귀를 선언하지 않는다")
func unknownIsNotRecovery() {
    var state = initialGuideState(route: axisRoute, now: 0).state
    for t in 1...25 {
        state = guideStep(
            state: state, fix: axisFix(Double(t) * 1.2), route: axisRoute,
            now: Double(t), tuning: .walk, course: facing(180)
        ).state
    }
    #expect(state.phase == .offRoute)
    for t in 26...60 {
        let out = guideStep(
            state: state, fix: axisFix(Double(t) * 1.2), route: axisRoute,
            now: Double(t), tuning: .walk, course: inactiveCourse
        )
        state = out.state
        #expect(out.event != .backOnRoute)
    }
    #expect(state.phase == .offRoute)
}
```

- [ ] **Step 3b: 리듀서 trace 공유 fixture (spec §4 두 번째 층)**

⚠ **순수 함수 fixture는 산술만 맞춘다.** Swift 리듀서가 호출 순서를 틀리거나 `offRouteAxes`를 `uncertain`에서 잃어도 Task 4 Step 3의 테스트는 통과한다. 배선까지 묶으려면 **리듀서 trace**를 비교해야 한다.

`src/lib/__tests__/fixtures/course-axis-scenarios.json`에 섹션을 더한다.

```json
  "reducer": [
    {
      "name": "경로 위 역주행은 방위 축이 확정한다",
      "steps": [{ "len": 400, "desc": "북진" }],
      "fixes": [
        { "t": 1, "along": 1.2, "lateral": 0, "acc": 8, "course": 180, "courseAcc": 5 },
        { "t": 25, "along": 30, "lateral": 0, "acc": 8, "course": 180, "courseAcc": 5 }
      ],
      "expectPhaseAtEnd": "offRoute",
      "expectAxes": { "distance": false, "course": true }
    },
    {
      "name": "비활성 관측이면 축이 꺼진다",
      "steps": [{ "len": 400, "desc": "북진" }],
      "fixes": [
        { "t": 1, "along": 1.2, "lateral": 0, "acc": 8, "course": -1, "courseAcc": -1 },
        { "t": 25, "along": 30, "lateral": 0, "acc": 8, "course": -1, "courseAcc": -1 }
      ],
      "expectPhaseAtEnd": "following",
      "expectAxes": { "distance": false, "course": false }
    }
  ]
```

⚠ `fixes`는 **경계만 적고 그 사이는 소비자가 1초 간격으로 보간한다**(기존 `route-guide-scenarios.json`이 매 fix를 나열하는 것과 다른 이유: 방위 축은 20초 창을 채워야 해서 fix가 25개씩 필요하고, 전부 나열하면 표가 읽을 수 없게 된다). 보간 규칙을 `comment`에 적는다.

⚠ `course: -1`은 CLLocation의 **무효 신호**다. 이것이 웹의 비활성 관측과 같은 결과를 내는지가 이 케이스의 요점이다.

웹 `route-guide.test.ts`와 Kit `RouteGuideTests.swift`가 **둘 다** 이 섹션을 소비해 `phase`와 `offRouteAxes`를 비교한다.

- [ ] **Step 4: 실행**

Run: `cd ios/GildongmuKit && swift test`
Expected: PASS 전체(기존 `RouteGuideTests`는 호출부에 `course: inactiveCourse`를 넘기도록 고친다)

- [ ] **Step 5: 커밋**

```bash
git add ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift
git commit -m "feat(guide): 방위 축 리듀서 통합 (Kit 미러)

웹 route-guide.ts와 같은 순서·조건. 축별 latch, entryProjection 기준 복귀 표결,
unknown은 해제 아님, reacquiring도 같은 계약, finalApproach보다 앞 배선.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" -- ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift ios/GildongmuKit/Tests/GildongmuKitTests/RouteGuideTests.swift
```

---

### Task 7: 호출부 배선

**Files:**
- Modify: `src/hooks/useRouteGuide.ts:981` 부근
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift:889` 부근
- Test: `src/hooks/__tests__/useRouteGuide.final-approach.test.tsx` (컴파일 통과 확인)

**Interfaces:**
- Consumes: Task 5·6의 `guideStep` 시그니처
- Produces: 없음(말단 배선)

- [ ] **Step 1: 웹 호출부**

`src/hooks/useRouteGuide.ts`의 `stepDetail` 안을 바꾼다.

```ts
      // ⚠ 웹은 방위를 채우지 않는다. `GeolocationCoordinates`에 `heading`은 있으나
      //   정확도 필드가 없어 불확실성 판정을 할 수 없다(spec §4). 플랫폼 갭이
      //   "코드 부재"가 아니라 "데이터 부재"이므로, 표준이 생기면 이 값만 채우면 켜진다.
      const result = guideStep(state, fix, route, now, tuning, INACTIVE_COURSE);
```

`INACTIVE_COURSE`를 import한다.

- [ ] **Step 2: iOS 호출부**

`ios/Gildongmu/Directions/BeaconModel.swift`의 `handleDetail`을 바꾼다.

```swift
        // 방위 관측은 기존 품질 게이트(`courseStep`)를 통과시킨 결과와 원본 불확실성을
        // 함께 넘긴다. ⚠ 둘 중 하나만 넘기면 이 축이 통과권 방식으로 되돌아간다.
        let courseObs = CourseObservation(
            state: courseStep(
                course: fix.course, courseAccuracy: fix.courseAccuracy,
                speed: fix.speed, motion: motion, ageSeconds: age
            ),
            accuracyDeg: fix.courseAccuracy
        )
        let out = guideStep(
            state: state,
            fix: GuideFix(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy),
            route: route,
            now: now,
            tuning: tuning,
            course: courseObs
        )
```

- [ ] **Step 3: 진단 로그에 축 상태 추가**

Task 1에서 넣은 `guideDiagLog` 줄 끝에 더한다.

```swift
                + " axes=d:\(out.state.offRouteAxes.distance)/c:\(out.state.offRouteAxes.course)"
                + " votes=\(out.state.courseVotes.count)"
                + " verdict=\(courseAxisVerdict(out.state.courseVotes).rawValue)"
```

⚠ **판정 결과를 로그에 남기는 것이 3단계의 핵심이다.** 실보행에서 "왜 안 잡혔나"·"왜 헛경고가 났나"를 원시값과 함께 되짚을 수 있어야 한다.

- [ ] **Step 4: 빌드·테스트**

Run: `npm run build 2>&1 | tail -5`
Expected: 성공

Run: `npm run test:run 2>&1 | tail -5`
Expected: 전체 통과

Run: `cd ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -configuration Experimental -destination 'generic/platform=iOS' build 2>&1 | tail -5`
Expected: `BUILD SUCCEEDED`

- [ ] **Step 5: 커밋**

```bash
git add src/hooks/useRouteGuide.ts ios/Gildongmu/Directions/BeaconModel.swift
git commit -m "feat(guide): 방위 축 호출부 배선

iOS는 courseStep 결과와 원본 불확실성을 함께 넘기고, 웹은 비활성 관측을 넘겨
축이 꺼진다. 진단 로그에 축 latch·표 수·판정을 함께 남긴다 — 실보행에서
'왜 안 잡혔나'를 원시값과 함께 되짚을 수 있어야 파라미터를 정할 수 있다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" -- src/hooks/useRouteGuide.ts ios/Gildongmu/Directions/BeaconModel.swift
```

---

### Task 8: 변이 주입 검증 + 경로 재생 승격

**Files:**
- Modify: `src/lib/__tests__/a6-probe.test.ts` (`.skip` 해제 + 단언 추가)
- Create: `src/lib/__tests__/course-axis-cadence.test.ts`

**Interfaces:**
- Consumes: Task 3·5의 전부
- Produces: 없음(검증 태스크)

- [ ] **Step 1: cadence 불변 테스트 작성**

`src/lib/__tests__/course-axis-cadence.test.ts`를 만든다.

```ts
import { describe, expect, it } from "vitest";
import { courseAxisVerdict, recordVote, type CourseVoteSample } from "../guide-course-axis";

/** 같은 20초 구간을 서로 다른 cadence로 채운다. */
const fill = (hz: number, vote: "mismatch" | "match"): CourseVoteSample[] => {
  let s: CourseVoteSample[] = [];
  for (let i = 0; i <= 20 * hz; i++) s = recordVote(s, i / hz, vote);
  return s;
};

describe("cadence 불변", () => {
  it("1Hz와 10Hz가 같은 판정을 낸다", () => {
    expect(courseAxisVerdict(fill(1, "mismatch"))).toBe(courseAxisVerdict(fill(10, "mismatch")));
    expect(courseAxisVerdict(fill(1, "match"))).toBe(courseAxisVerdict(fill(10, "match")));
  });

  it("같은 시각에 배치 도착한 fix 묶음이 창을 장악하지 못한다", () => {
    // 2초 구간에 30개가 몰려도 시간 span이 모자라 확정하지 못한다.
    let s: CourseVoteSample[] = [];
    for (let i = 0; i < 30; i++) s = recordVote(s, i % 2, "mismatch");
    expect(courseAxisVerdict(s)).toBe("unknown");
  });
});
```

Run: `npx vitest run src/lib/__tests__/course-axis-cadence.test.ts`
Expected: PASS

- [ ] **Step 2: 경로 재생 하네스를 계약 테스트로 승격**

`src/lib/__tests__/a6-probe.test.ts`에서 `describe.skip`을 `describe`로 바꾸고, 자체 구현했던 `judge`/`vote` 로직을 **실제 `courseVote`·`recordVote`·`courseAxisVerdict` 호출로 교체**한 뒤, 표 출력 대신 단언을 넣는다.

```ts
  it("지속 편향 잡음에서 헛경고가 상한 아래", { timeout: 300000 }, () => {
    const r = evaluate(BIASED, 60);
    // ⚠ 상한은 잠정값이다(spec §6). 실기기 로그로 확정되면 이 수를 고친다.
    expect(r.fp / r.walks).toBeLessThan(0.03);
  });

  it("이탈 검출이 현행보다 빠르다", { timeout: 300000 }, () => {
    const r = evaluate(BIASED, 60);
    expect(r.nextMed).toBeLessThan(r.nowMed!);
  });
```

⚠ **`evaluate`가 하네스 내부 판정이 아니라 실제 모듈을 부르게 바꾸는 것이 이 스텝의 요점이다.** 하네스가 자기 사본으로 판정하면 구현이 바뀌어도 통과한다.

- [ ] **Step 3: 변이 주입 6종 검증**

각 변이를 소스에 **일시적으로** 넣고 테스트가 실패하는지 확인한 뒤 되돌린다. 통과해 버리는 변이가 있으면 그 축을 덮는 테스트를 추가한다.

| # | 변이 | 되돌리기 전 확인할 것 |
|---|---|---|
| 1 | `guideStep`의 국면 초기화(`courseVotes: []`) 제거 | 헛경고 상한 테스트 실패 |
| 2 | 복귀 계약에서 `courseCleared` 조건 제거(항상 true) | "방위를 못 읽으면 복귀 안 함" 실패 |
| 3 | `courseVote`의 최소값 루프를 단일 `tangentAt(poly, d, half)`로 | 헛경고 상한 실패 |
| 4 | `courseVote`의 3-state를 2-state로(`accuracyDeg` 무시) | 헛경고 상한 실패 |
| 5 | `courseAxisVerdict`의 `MIN_VOTES`·`MIN_SPAN_S` 검사 제거 | cadence 배치 테스트 실패 |
| 6 | 최종 접근 진입 조건에서 `courseVerdict !== "off"` 제거 | 새 테스트 필요(아래) |

변이 6을 잡는 테스트를 `route-guide.test.ts`에 추가한다.

```ts
  it("방위 축이 확정 이탈이면 최종 접근에 진입하지 않는다", () => {
    // 종점 부근까지 이동하되 방위를 계속 반대로 보고한다.
    let { state } = initialGuideState(route, 0, { hasFinalApproachGeometry: true });
    let enteredFinal = false;
    for (let t = 1; t <= 330; t++) {
      const out = guideStep(state, at(Math.min(399, t * 1.2)), route, t, WALK_TUNING, facing(180));
      state = out.state;
      if (out.event?.kind === "finalApproachEnter") enteredFinal = true;
    }
    expect(enteredFinal).toBe(false);
    expect(state.offRouteAxes.course).toBe(true);
  });
```

- [ ] **Step 4: 전체 게이트**

Run: `npm run test:run 2>&1 | tail -5`
Expected: 전체 통과

Run: `npm run lint 2>&1 | tail -3`
Expected: error 0 (warning은 기준선 4건까지 허용)

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `5`

Run: `cd ios/GildongmuKit && swift test 2>&1 | tail -3`
Expected: 전체 통과

- [ ] **Step 5: 커밋**

```bash
git add src/lib/__tests__/a6-probe.test.ts src/lib/__tests__/course-axis-cadence.test.ts src/lib/__tests__/route-guide.test.ts
git commit -m "test(guide): 방위 축 계약 테스트 승격 + cadence 불변 + 변이 주입

탐사 하네스가 자기 사본으로 판정하던 것을 실제 모듈 호출로 바꾸고 단언을 넣었다.
사본으로 판정하면 구현이 바뀌어도 통과한다.

변이 6종(국면 초기화 제거·복귀 조건 제거·단일 접선·2-state·최소 증거량 제거·
최종 접근 순서)이 전부 테스트를 깨뜨리는 것을 확인했다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" -- src/lib/__tests__/a6-probe.test.ts src/lib/__tests__/course-axis-cadence.test.ts src/lib/__tests__/route-guide.test.ts
```

---

## 마일스톤 종료 — 실기기로 넘긴다

**이 계획은 A6를 닫지 않는다.** 8태스크가 끝나면 실험 빌드가 준비된 것이고, 남은 것은 spec §7 3단계다.

- [ ] **실험판 배포**

Run: `CONFIGURATION=Experimental ./ios/deploy-device.sh`

- [ ] **위원장 실보행 1회** — 두 가지를 동시에 얻는다: ⓐ축이 실제로 작동하는지 체감 ⓑ`guide-diag.log`

- [ ] **로그 회수**

Run: `xcrun devicectl device copy from --domain-type appDataContainer --domain-identifier space.dodoplanet.gildongmu.dev --source Documents/guide-diag.log --destination /tmp/guide-diag.log --device $(xcrun devicectl list devices | awk 'NR==3{print $3}')`

- [ ] **실제 센서열로 파라미터 확정** — 로그를 그대로 재생해 §6 상수를 정한다. 잡음이 독립에 가까우면 공격적으로, 편향이 크면 보수적으로.

⚠ **파라미터 탐색용 보행과 검증용 보행을 분리한다.** 같은 로그로 값을 정하고 그 값을 검증하면 순환이다.

- [ ] **문서 분배** — 서사는 `CHANGELOG.md`, 남은 판정은 `docs/BACKLOG.md`(A6 상태 갱신 + 진짜 평행 도로 이탈 신규 항목 + 웹·iOS 방위 갭), 새 함정은 `CLAUDE.md`, 상태 한 줄은 `PROGRESS.md`.

## 리뷰 게이트

- **구현 중**: 태스크 묶음별 spec-compliance + code-quality 서브에이전트 리뷰(요구사항과 diff만 넘긴다. 세션 히스토리·생성 의도는 넘기지 않는다).
- **마일스톤 최종**: cross-cutting 서브에이전트 리뷰. **설계 단계 codex 적대적 검토는 이미 수행했고 18건을 반영했으므로**, 같은 결함을 두 번 보는 over-review를 피해 구현 후 codex 마일스톤 리뷰는 생략 가능하다. 부족하다고 판단되면 PR 직전 `codex exec` diff 주입 방식으로 수행한다(`< /dev/null` 필수, worktree 금지).
- **리뷰로 대체 불가**: 이 마일스톤의 정본 게이트는 **실기기 실보행**이다. 어떤 정적 리뷰도 "실제 course 오차가 독립인가 편향인가"를 답하지 못한다.

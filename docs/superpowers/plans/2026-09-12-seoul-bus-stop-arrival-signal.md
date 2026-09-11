# 서울버스 정차 신호(A41) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서울버스 잔여 0("곧 도착")을 정차로 읽던 리듀서 두 자리(승차 승격·하차 확정 도착)를 임박 통지로 바꾸고, 승격은 "잔여 0 뒤 소실"로 옮긴다.

**Architecture:** 순수 리듀서(웹 `transit-guide.ts` ↔ Kit `TransitGuide.swift`)에 이벤트 2종(`arrivingAtBoardStop`·`arrivingAtAlightStop`)과 승격 원인 `departed`를 더하고 공유 fixture로 동조를 잠근다. provider·라우트는 무변경(spec §0 ①). 문장은 새 i18n 키 2개(6로케일)이고 소비자(웹 훅·iOS 모델)는 이벤트→문장 배선만 더한다.

**Tech Stack:** TypeScript(Vitest) · Swift(Swift Testing, GildongmuKit) · next-intl messages → xcstrings 생성 스크립트.

**Spec:** `docs/superpowers/specs/2026-09-12-seoul-bus-stop-arrival-signal-design.md`

**구현 방식 판정:** inline. 근거 — 웹·Kit·fixture가 한 계약이라 같은 커밋에서 함께 움직여야 하고(파일 겹침), 이벤트 이름(Task 1)이 문장 키(Task 2)와 소비자 배선(Task 3)의 인터페이스를 정한다(선행 관계).

## Global Constraints

- 기존 i18n 키 문안 변경 금지(E39 몫). 새 키는 `transitGuide.*` 네임스페이스에만.
- `TransitTrackingSheet.swift`·`src/components/TransitGuidePanel.tsx` 편집 금지(E38 세션 소유).
- 문자열 필드·기존 이벤트 payload 불변. 지하철 판정 불변. 지방버스 근사·비관측 잠금 경로 불변.
- 커밋은 pathspec(`git add -A` 금지), 기능과 테스트는 같은 커밋. origin push 금지.
- ko 문장 플레이스홀더 순서 = iOS 위치 인자 ABI(`ios/i18n/arg-order.json`, 새 키는 자동 등록).

---

### Task 1: 리듀서 + 공유 fixture (웹 ↔ Kit)

**Files:**
- Modify: `src/lib/transit-guide.ts` (`TransitBoardedCause` L~250, `TransitGuideEvent` L~258, `eventProfile` L~398, `commitBoardingMatched` L~1150, `boardingUnmatched` L~1208, `commitMatched` L~1290)
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/TransitGuide.swift` (`TransitBoardedCause` L25, `TransitGuideEvent` L276, `transitEventProfile` L380, `commitBoardingMatched` L1067~, `boardingUnmatched` L1139~, `commitMatched` L1181~)
- Modify: `src/lib/__tests__/fixtures/transit-guide-scenarios.json` (기존 2건 수정 + 신규 5건)
- Modify: `ios/GildongmuKit/Tests/GildongmuKitTests/TransitGuideTests.swift` `kindName`(L156), `ios/GildongmuKit/Tests/GildongmuKitTests/TransitGuideToneTests.swift` `eventKind`(L92)
- Test: `src/lib/__tests__/transit-guide.test.ts`(`eventProfile` describe L237)

**Interfaces:**
- Produces: `TransitGuideEvent` 신규 `{ kind: "arrivingAtBoardStop" }`·`{ kind: "arrivingAtAlightStop" }`(payload 없음), `TransitBoardedCause = "observed" | "declared" | "departed"`. Kit `case arrivingAtBoardStop`·`case arrivingAtAlightStop`, `TransitBoardedCause.departed`.

- [ ] **Step 1: fixture에 시나리오를 먼저 쓴다(실패해야 한다)**

`src/lib/__tests__/fixtures/transit-guide-scenarios.json`의 `scenarios` 배열에 추가(항목 헬퍼: `V0 = {"vehicleId":"111033479","direction":"","message":"곧 도착","remainingStops":0,"destinationName":null,"express":false,"arrivalCode":null}`, `V1`은 message `"3분후[1번째 전]"`·remainingStops 1, `V2`는 `"5분후[2번째 전]"`·2):

```json
{
 "name": "boarding 서울버스(A41): 잔여 2→1 접근 → 곧 도착(잔여 0)은 arrivingAtBoardStop 1회, 지속 무이벤트 → 소실 2폴 → boarded(departed) riding",
 "route": "seoulBusSingle",
 "steps": [
  {"at": 0, "input": {"kind": "board", "lock": "seoulBusV1"}, "expect": {"phase": "boarding", "event": {"kind": "vehicleSelected"}}},
  {"at": 20000, "input": {"kind": "poll", "seq": 1, "phaseGen": 1, "poll": {"kind": "ok", "items": [V2]}}, "expect": {"phase": "boarding", "event": {"kind": "approaching", "remaining": 2}}},
  {"at": 40000, "input": {"kind": "poll", "seq": 2, "phaseGen": 1, "poll": {"kind": "ok", "items": [V1]}}, "expect": {"event": {"kind": "approaching", "remaining": 1}}},
  {"at": 60000, "input": {"kind": "poll", "seq": 3, "phaseGen": 1, "poll": {"kind": "ok", "items": [V0]}}, "expect": {"phase": "boarding", "remaining": 0, "event": {"kind": "arrivingAtBoardStop"}}},
  {"at": 80000, "input": {"kind": "poll", "seq": 4, "phaseGen": 1, "poll": {"kind": "ok", "items": [V0]}}, "expect": {"phase": "boarding", "event": null}},
  {"at": 100000, "input": {"kind": "poll", "seq": 5, "phaseGen": 1, "poll": {"kind": "ok", "items": [V0]}}, "expect": {"phase": "boarding", "event": null}},
  {"at": 120000, "input": {"kind": "poll", "seq": 6, "phaseGen": 1, "poll": {"kind": "ok", "items": []}}, "expect": {"phase": "boarding", "signal": "tracking", "event": null}},
  {"at": 140000, "input": {"kind": "poll", "seq": 7, "phaseGen": 1, "poll": {"kind": "ok", "items": []}}, "expect": {"phase": "riding", "signal": "notYetVisible", "remaining": null, "ridingPolls": 0, "event": {"kind": "boarded", "legIndex": 0, "cause": "departed"}}},
  {"at": 160000, "input": {"kind": "poll", "seq": 8, "phaseGen": 2, "poll": {"kind": "empty"}}, "expect": {"phase": "riding", "ridingPolls": 1, "event": null}}
 ]
},
{
 "name": "boarding 서울버스(A41): 첫 관측이 곧 도착이면 approaching이 아니라 arrivingAtBoardStop",
 "route": "seoulBusSingle",
 "steps": [
  {"at": 0, "input": {"kind": "board", "lock": "seoulBusV1"}, "expect": {"phase": "boarding"}},
  {"at": 20000, "input": {"kind": "poll", "seq": 1, "phaseGen": 1, "poll": {"kind": "ok", "items": [V0]}}, "expect": {"phase": "boarding", "signal": "tracking", "event": {"kind": "arrivingAtBoardStop"}}},
  {"at": 40000, "input": {"kind": "poll", "seq": 2, "phaseGen": 1, "poll": {"kind": "ok", "items": [V0]}}, "expect": {"event": null}},
  {"at": 60000, "input": {"kind": "poll", "seq": 3, "phaseGen": 1, "poll": {"kind": "ok", "items": []}}, "expect": {"phase": "boarding", "event": null}},
  {"at": 80000, "input": {"kind": "poll", "seq": 4, "phaseGen": 1, "poll": {"kind": "ok", "items": []}}, "expect": {"phase": "riding", "event": {"kind": "boarded", "cause": "departed"}}}
 ]
},
{
 "name": "boarding 서울버스(A41): 잔여 1에서 0을 거치지 않은 소실은 종전 vehiclePassed(승격 아님)",
 "route": "seoulBusSingle",
 "steps": [
  {"at": 0, "input": {"kind": "board", "lock": "seoulBusV1"}, "expect": {"phase": "boarding"}},
  {"at": 20000, "input": {"kind": "poll", "seq": 1, "phaseGen": 1, "poll": {"kind": "ok", "items": [V1]}}, "expect": {"event": {"kind": "approaching", "remaining": 1}}},
  {"at": 40000, "input": {"kind": "poll", "seq": 2, "phaseGen": 1, "poll": {"kind": "ok", "items": []}}, "expect": {"phase": "boarding", "event": null}},
  {"at": 60000, "input": {"kind": "poll", "seq": 3, "phaseGen": 1, "poll": {"kind": "ok", "items": []}}, "expect": {"phase": "boarding", "signal": "signalLost", "event": {"kind": "vehiclePassed"}}}
 ]
},
{
 "name": "riding 서울버스(A41): 2→1 countdown → 곧 도착(잔여 0)은 arrivingAtAlightStop 1회, 지속 무이벤트 → 소실 2폴 → 도착 추정 → 재관측 backOnTrack(재발화 없음) → 다시 소실 → 도착 추정",
 "route": "seoulBusSingle",
 "steps": [
  {"at": 0, "input": {"kind": "board", "lock": "seoulBusV1"}, "expect": {"phase": "boarding"}},
  {"at": 0, "input": {"kind": "confirmBoarded"}, "expect": {"phase": "riding", "event": {"kind": "boarded", "cause": "declared"}}},
  {"at": 15000, "input": {"kind": "poll", "seq": 1, "phaseGen": 2, "poll": {"kind": "ok", "items": [V2]}}, "expect": {"event": {"kind": "trackingStarted", "remaining": 2}}},
  {"at": 30000, "input": {"kind": "poll", "seq": 2, "phaseGen": 2, "poll": {"kind": "ok", "items": [V1]}}, "expect": {"event": {"kind": "countdown", "remaining": 1}}},
  {"at": 45000, "input": {"kind": "poll", "seq": 3, "phaseGen": 2, "poll": {"kind": "ok", "items": [V0]}}, "expect": {"phase": "riding", "remaining": 0, "event": {"kind": "arrivingAtAlightStop"}}},
  {"at": 60000, "input": {"kind": "poll", "seq": 4, "phaseGen": 2, "poll": {"kind": "ok", "items": [V0]}}, "expect": {"phase": "riding", "event": null}},
  {"at": 75000, "input": {"kind": "poll", "seq": 5, "phaseGen": 2, "poll": {"kind": "ok", "items": []}}, "expect": {"phase": "riding", "event": null}},
  {"at": 90000, "input": {"kind": "poll", "seq": 6, "phaseGen": 2, "poll": {"kind": "ok", "items": []}}, "expect": {"phase": "arrived", "event": {"kind": "arrived", "certain": false}}},
  {"at": 105000, "input": {"kind": "poll", "seq": 7, "phaseGen": 2, "poll": {"kind": "ok", "items": [V0]}}, "expect": {"phase": "riding", "event": {"kind": "backOnTrack"}}},
  {"at": 120000, "input": {"kind": "poll", "seq": 8, "phaseGen": 2, "poll": {"kind": "ok", "items": [V0]}}, "expect": {"phase": "riding", "event": null}},
  {"at": 135000, "input": {"kind": "poll", "seq": 9, "phaseGen": 2, "poll": {"kind": "ok", "items": []}}, "expect": {"event": null}},
  {"at": 150000, "input": {"kind": "poll", "seq": 10, "phaseGen": 2, "poll": {"kind": "ok", "items": []}}, "expect": {"phase": "arrived", "event": {"kind": "arrived", "certain": false}}}
 ]
},
{
 "name": "riding 서울버스(A41): 첫 관측이 곧 도착이면 trackingStarted가 아니라 arrivingAtAlightStop",
 "route": "seoulBusSingle",
 "steps": [
  {"at": 0, "input": {"kind": "board", "lock": "seoulBusV1"}, "expect": {"phase": "boarding"}},
  {"at": 0, "input": {"kind": "confirmBoarded"}, "expect": {"phase": "riding"}},
  {"at": 15000, "input": {"kind": "poll", "seq": 1, "phaseGen": 2, "poll": {"kind": "ok", "items": [V0]}}, "expect": {"phase": "riding", "signal": "tracking", "remaining": 0, "event": {"kind": "arrivingAtAlightStop"}}}
 ]
}
```

기존 시나리오 수정:
- "boarding: advance 무시, 늦은 세대 폴 폐기, 서울버스 잔여 0은 도착 관측" → 이름 끝을 "서울버스 잔여 0은 곧 도착(승격 아님)"으로, 마지막 스텝 expect를 `{"phase": "boarding", "remaining": 0, "event": {"kind": "arrivingAtBoardStop"}}`로.
- "다중 leg: 하차 확정 → …" 첫 leg: `at 15000` 잔여 0 폴의 expect를 `{"phase": "riding", "event": {"kind": "arrivingAtAlightStop"}}`로 바꾸고 그 뒤에 `{"at": 20000, "input": {"kind": "declareArrived"}, "expect": {"phase": "arrived", "event": {"kind": "arrived", "certain": true}}}`를 삽입. 이후 스텝의 `phaseGen`을 1씩 올린다(seq 2 폴 `phaseGen` 3→4, seq 3 폴 5→6).

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/transit-guide.test.ts`
Expected: 신규 5건 + 수정 2건 FAIL(`arrivingAtBoardStop` 대신 `boarded`/`arrived`).

- [ ] **Step 3: 웹 리듀서 구현**

`src/lib/transit-guide.ts`:

```ts
/** riding 진입 경위 — observed=승차 정류소 도착 관측(지하철), declared=사용자 선언·근사 잠금,
 *  departed=서울버스 "곧 도착"(잔여 0) 뒤 소실 관측(A41 — 차량이 서고 떠났다). */
export type TransitBoardedCause = "observed" | "declared" | "departed";

// TransitGuideEvent에 추가(payload 없음 — 문장에 항목 값이 필요 없다, spec §2.1):
  /** boarding 서울버스: 잔여 0("곧 도착" = 직전 정류소 출발) 첫 관측. 승격 아님(A41). */
  | { kind: "arrivingAtBoardStop" }
  /** riding 서울버스: 하차 정류소 기준 잔여 0 첫 관측 — 차내 "이번 정류장" 방송과 같은 시점(A41). */
  | { kind: "arrivingAtAlightStop" }
```

`eventProfile`:
```ts
    case "arrivingAtBoardStop":
    case "arrivingAtAlightStop":
      // 곧 온다/곧 내린다 — 잔여 ≤1 사다리와 같은 축(A41).
      return { interrupt: true, tone: "imminent" };
    case "boarded":
      // 도착 관측은 "지금 타라"라 interrupting, 선언·출발 관측은 사용자가 이미 행동한 뒤라 기본.
      return { interrupt: event.cause === "observed", tone: "start" };
```

`commitBoardingMatched`의 `fresh`/`arrivedAtBoardStop` 블록을 다음으로 교체:
```ts
  // A41(spec 2026-09-12 §0): 서울버스 잔여 0("곧 도착")은 **직전 정류소 출발**이지 정차가 아니다 —
  // 임박 1회(`ladderAnnounced = 0` 래치)만 내고 국면을 유지한다. 승격은 그 뒤 소실(boardingUnmatched)이 맡는다.
  // 첫 관측이 곧 잔여 0이어도 이 문장이 "추적합니다"보다 먼저다(재선택 직후 실사고 2026-09-11 20:43).
  if (base.lock?.mode === "seoulBus" && item.remainingStops === 0) {
    const announced = wasTracking && base.ladderAnnounced === 0;
    next.ladderAnnounced = 0;
    if (!announced) return { state: next, event: { kind: "arrivingAtBoardStop" } };
    if (base.signal === "signalLost" && carriedEvent === null) {
      return { state: next, event: { kind: "signalRecovered" } };
    }
    return { state: next, event: carriedEvent };
  }
  // 도착 관측 = riding 승격(지하철 진입 0·도착 1). 출발 2는 제외 — 이미 떠난 열차에 "탑승하세요"를
  // 말하지 않는다. 동결 레코드(나이 > BOARD_STOP_FRESH_SECONDS)는 도착으로 보지 않는다(설계 리뷰 C3·M1).
  const fresh = item.dataAgeSeconds == null || item.dataAgeSeconds <= BOARD_STOP_FRESH_SECONDS;
  const arrivedAtBoardStop =
    base.lock?.mode === "subway" && (item.arrivalCode === "0" || item.arrivalCode === "1");
  if (base.lock != null && fresh && arrivedAtBoardStop) {
    return enterRiding(next, base.lock, "observed");
  }
```

`boardingUnmatched`의 `signalLost` 조기 반환 다음에 삽입:
```ts
  // A41: 잔여 0("곧 도착")을 본 뒤의 소실 = 그 차량이 서고 떠났다 → riding 승격(departed). 놓쳤으면
  // [탑승 변경]이 boarding으로 되돌린다(restoreBoarding). 0을 못 본 소실은 아래 vehiclePassed 그대로.
  if (
    base.remaining === 0 &&
    base.lock != null &&
    base.lock.mode === "seoulBus" &&
    next.missCount >= MISS_ARRIVE_COUNT
  ) {
    return enterRiding(next, base.lock, "departed");
  }
```

`commitMatched`의 `approx`/`arrivedObserved` 블록을 다음으로 교체:
```ts
  // 도착 관측(§4.2): 지하철 arvlCd "1"(도착)만 확정. 근사 잠금은 arrived 전이 없음(§5.2·§13.2).
  const approx = base.lock != null && isApproxTransitLock(base.lock);
  // A41: 서울버스 잔여 0("곧 도착")은 하차 정류소 **직전 정류소 출발** — 차내 "이번 정류장" 방송 시점.
  // 임박 1회(`ladderAnnounced = 0` 래치)만 내고 riding 유지. 확정 도착은 없고(정차 신호가 API에 없다,
  // spec §0 ①) 소실이 종전 도착 추정(가역)으로 간다.
  if (!approx && base.lock?.mode === "seoulBus" && item.remainingStops === 0) {
    const announced = wasTracking && base.ladderAnnounced === 0;
    next.ladderAnnounced = 0;
    if (!announced) return { state: next, event: { kind: "arrivingAtAlightStop" } };
    if (base.signal === "signalLost" && carriedEvent === null) {
      return { state: next, event: { kind: "signalRecovered" } };
    }
    return { state: next, event: carriedEvent };
  }
  const arrivedObserved = !approx && base.lock?.mode === "subway" && item.arrivalCode === "1";
  if (arrivedObserved) {
    next.phase = "arrived";
    next.arrivedCertain = true;
    return { state: next, event: { kind: "arrived", certain: true } };
  }
```

`eventProfile` 단위 테스트(`transit-guide.test.ts` L237 describe)에 추가:
```ts
  it("A41: 곧 도착 이벤트 2종은 imminent·interrupt, boarded(departed)는 비-interrupt", () => {
    expect(eventProfile({ kind: "arrivingAtBoardStop" })).toEqual({ interrupt: true, tone: "imminent" });
    expect(eventProfile({ kind: "arrivingAtAlightStop" })).toEqual({ interrupt: true, tone: "imminent" });
    expect(eventProfile({ kind: "boarded", legIndex: 0, cause: "departed" })).toEqual({ interrupt: false, tone: "start" });
    expect(eventProfile({ kind: "boarded", legIndex: 0, cause: "observed" }).interrupt).toBe(true);
  });
```

- [ ] **Step 4: 웹 통과 확인**

Run: `npx vitest run src/lib/__tests__/transit-guide.test.ts src/lib/__tests__/transit-guide-tone.test.ts`
Expected: PASS 전부.

- [ ] **Step 5: Kit 미러**

`TransitGuide.swift`:
```swift
public enum TransitBoardedCause: String, Sendable {
    /// departed = 서울버스 "곧 도착"(잔여 0) 뒤 소실 관측(A41 — 차량이 서고 떠났다).
    case observed, declared, departed
}
// TransitGuideEvent에 추가:
    /// boarding 서울버스: 잔여 0("곧 도착" = 직전 정류소 출발) 첫 관측. 승격 아님(A41).
    case arrivingAtBoardStop
    /// riding 서울버스: 하차 정류소 기준 잔여 0 첫 관측 — 차내 "이번 정류장" 방송 시점(A41).
    case arrivingAtAlightStop
```
`transitEventProfile`: `case .arrivingAtBoardStop, .arrivingAtAlightStop: return (true, .imminent)` 추가(기존 `.boarded` 분기는 `cause == .observed` 그대로).

`commitBoardingMatched`(L1098~1108 `fresh`/`arrivedAtBoardStop` 블록) 교체:
```swift
    // A41(spec 2026-09-12 §0): 서울버스 잔여 0("곧 도착")은 직전 정류소 출발이지 정차가 아니다 —
    // 임박 1회(`ladderAnnounced = 0` 래치)만 내고 국면 유지. 승격은 소실(boardingUnmatched)이 맡는다.
    if base.lock?.mode == .seoulBus, item.remainingStops == 0 {
        let announced = wasTracking && base.ladderAnnounced == 0
        out.ladderAnnounced = 0
        if !announced { return (out, .arrivingAtBoardStop) }
        if base.signal == .signalLost, carriedEvent == nil { return (out, .signalRecovered) }
        return (out, carriedEvent)
    }
    let fresh = (item.dataAgeSeconds ?? 0) <= transitBoardStopFreshSeconds
    let arrivedAtBoardStop = base.lock?.mode == .subway
        && (item.arrivalCode == "0" || item.arrivalCode == "1")
    if let lock = base.lock, fresh, arrivedAtBoardStop {
        return enterRiding(out, lock: lock, cause: .observed)
    }
```
`boardingUnmatched`(`signalLost` 조기 반환 다음):
```swift
    // A41: 잔여 0을 본 뒤의 소실 = 서고 떠났다 → riding 승격(departed). 0을 못 본 소실은 vehiclePassed 그대로.
    if base.remaining == 0, let lock = base.lock, lock.mode == .seoulBus,
       out.missCount >= transitMissArriveCount {
        return enterRiding(out, lock: lock, cause: .departed)
    }
```
`commitMatched`(L1230~1240 `approx`/`arrivedByMode` 블록) 교체:
```swift
    let approx = base.lock.map(isApproxTransitLock) ?? false
    // A41: 서울버스 잔여 0은 하차 정류소 직전 정류소 출발 — 임박 1회, riding 유지. 확정 도착 없음(소실 → 추정).
    if !approx, base.lock?.mode == .seoulBus, item.remainingStops == 0 {
        let announced = wasTracking && base.ladderAnnounced == 0
        out.ladderAnnounced = 0
        if !announced { return (out, .arrivingAtAlightStop) }
        if base.signal == .signalLost, carriedEvent == nil { return (out, .signalRecovered) }
        return (out, carriedEvent)
    }
    let arrivedObserved = !approx && base.lock?.mode == .subway && item.arrivalCode == "1"
    if arrivedObserved {
        out.phase = .arrived
        out.arrivedCertain = true
        return (out, .arrived(certain: true))
    }
```
테스트 러너 두 파일의 이벤트 이름 switch에 `case .arrivingAtBoardStop: "arrivingAtBoardStop"`·`case .arrivingAtAlightStop: "arrivingAtAlightStop"`(ToneTests는 `return` 형태) 추가.

- [ ] **Step 6: Kit 통과 확인**

Run: `(cd ios/GildongmuKit && swift test --filter TransitGuide)`
Expected: PASS(공유 fixture 신규 5건 포함).

- [ ] **Step 7: Commit**

```bash
git add src/lib/transit-guide.ts src/lib/__tests__/transit-guide.test.ts src/lib/__tests__/fixtures/transit-guide-scenarios.json ios/GildongmuKit/Sources/GildongmuKit/TransitGuide.swift ios/GildongmuKit/Tests/GildongmuKitTests/TransitGuideTests.swift ios/GildongmuKit/Tests/GildongmuKitTests/TransitGuideToneTests.swift
git commit -m "fix(transit): A41 서울버스 곧 도착은 정차가 아니다 — 임박 이벤트 2종 + 소실 승격(departed), 웹·Kit·공유 fixture" -- <같은 경로들>
```

---

### Task 2: 문장 키 2개 + descriptor + i18n(6로케일) + xcstrings

**Files:**
- Modify: `messages/{ko,en,es,fr,it,ja}.json` (`transitGuide.arrivedAtBoardStop` 바로 뒤, 각 L1089)
- Modify: `src/lib/transit-guide-text.ts`(`arrivedAtBoardStopLine` L167 뒤 + `TRANSIT_TEXT_KEYS`), `src/lib/transit-text-args.ts`(`TRANSIT_TEXT_ARG_NAMES`)
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/TransitGuideText.swift`(`transitArrivedAtBoardStopLine` L144 뒤 + `transitTextKeys`), `ios/Gildongmu/Directions/TransitGuideTextRenderer.swift` switch, `ios/GildongmuKit/Tests/GildongmuKitTests/TransitGuideTextTests.swift` fn switch(L57 부근)
- Modify: `src/lib/__tests__/fixtures/transit-guide-text-cases.json`, `src/lib/__tests__/transit-guide-text.test.ts`(CASES 등록 + fixture 실행기 fn 매핑)
- Generated: `ios/Gildongmu/Resources/Localizable.xcstrings`, `ios/i18n/arg-order.json`

**Interfaces:**
- Produces: 웹 `arrivingAtBoardStopLine(isEn: boolean, leg: TransitDisplayLeg): TransitTextLine`, Kit `transitArrivingAtBoardStopLine(isEn:leg:)`, i18n 키 `transitGuide.arrivingAtBoardStop`({line})·`transitGuide.arrivingAtAlightStop`(인자 없음).

- [ ] **Step 1: text-cases fixture에 케이스 추가(실패 확인용)** — 기존 `"arrivedAtBoardStop en"` 항목(L769~)을 복사해 `"name": "arrivingAtBoardStop en"`, `"fn": "arrivingAtBoardStop"`, expect key `arrivingAtBoardStop` args `["Line 5"]`로, 그리고 `isEn: false`인 ko 짝(`"arrivingAtBoardStop ko"`, args `["노선ᛥ"]`, lang `ko`)을 추가.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/__tests__/transit-guide-text.test.ts src/lib/__tests__/transit-text-args.test.ts src/lib/__tests__/transit-display-guard.test.ts` → FAIL(미지 fn / 키 목록 불일치).

- [ ] **Step 3: 구현**

`transit-guide-text.ts`:
```ts
/** A41: 서울버스 "곧 도착"(잔여 0) 승차 임박 — 승격 없이 "{line} 곧 도착합니다." */
export function arrivingAtBoardStopLine(isEn: boolean, leg: TransitDisplayLeg): TransitTextLine {
  return line(isEn, "arrivingAtBoardStop", [leg.line], (v) => v);
}
```
`TRANSIT_TEXT_KEYS`에 `"arrivingAtBoardStop"`(`"arrivedAtBoardStop"` 뒤). `TRANSIT_TEXT_ARG_NAMES`에 `arrivingAtBoardStop: ["line"]`. 테스트 파일의 CASES 배열과 fixture 실행기 `fn` 매핑에 `arrivingAtBoardStop` → `arrivingAtBoardStopLine(isEn, leg)` 등록(기존 `arrivedAtBoardStop` 항목과 같은 모양으로).

Kit `TransitGuideText.swift`:
```swift
public func transitArrivingAtBoardStopLine(isEn: Bool, leg: TransitDisplayLeg) -> TransitTextLine {
    makeLine(isEn, "arrivingAtBoardStop", [leg.line]) { $0 }
}
```
`transitTextKeys`에 `"arrivingAtBoardStop"`. 렌더러 switch에 `case "arrivingAtBoardStop": return appLocalized("transitGuide.arrivingAtBoardStop", arguments: args)`. `TransitGuideTextTests` fn switch에 `case "arrivingAtBoardStop": return transitArrivingAtBoardStopLine(isEn: e, leg: c.leg!)`.

messages(각 파일 `"arrivedAtBoardStop"` 줄 다음에 두 줄):
- ko: `"arrivingAtBoardStop": "{line} 곧 도착합니다."`, `"arrivingAtAlightStop": "이번 정류장에서 내리세요."`
- en: `"{line} is arriving now."`, `"Get off at this stop."`
- es: `"{line} está llegando."`, `"Bájese en esta parada."`
- fr: `"{line} arrive."`, `"Descendez à cet arrêt."`
- it: `"{line} sta arrivando."`, `"Scendi a questa fermata."`
- ja: `"{line}がまもなく到着します。"`, `"この停留所で降りてください。"`

- [ ] **Step 4: 생성물 재생성 + 통과 확인**

```bash
node ios/scripts/messages-to-xcstrings.mjs all && node ios/scripts/check-xcstrings-keys.mjs
npx vitest run src/lib/__tests__/transit-guide-text.test.ts src/lib/__tests__/transit-text-args.test.ts src/lib/__tests__/transit-display-guard.test.ts src/lib/__tests__/i18n-messages.test.ts
(cd ios/GildongmuKit && swift test --filter TransitGuideText)
```
Expected: 전부 PASS, `arg-order.json`에 `transitGuide.arrivingAtBoardStop: ["line"]` 자동 등록(신규 키는 플래그 불필요 — 기존 키 순서 변경이 없어야 한다; 있으면 exit 1이고 그건 내 실수다).

- [ ] **Step 5: Commit** — 위 파일 전부 pathspec, 메시지 `feat(i18n): A41 곧 도착 문장 키 2개(승차·하차) + descriptor·렌더러·xcstrings`.

---

### Task 3: 소비자 배선 (웹 훅 · iOS 모델)

**Files:**
- Modify: `src/hooks/useTransitGuide.ts`(이벤트 switch L578~, `"boarded"` 케이스 L603 인근, import 목록 L40~)
- Modify: `ios/Gildongmu/Directions/TransitGuideModel.swift`(`announcementText` switch L1440~, `.boarded` 케이스 L1462 인근)

**Interfaces:**
- Consumes: Task 1 이벤트 2종·`departed`, Task 2 `arrivingAtBoardStopLine`/`transitArrivingAtBoardStopLine`·키 `transitGuide.arrivingAtAlightStop`.

- [ ] **Step 1: 웹 훅**

import에 `arrivingAtBoardStopLine` 추가. switch에:
```ts
        case "arrivingAtBoardStop":
          // A41: "곧 도착" = 직전 정류소 출발. 승격 없이 임박만 — 탑승 문장은 소실 뒤 boarded(departed)가 낸다.
          if (leg) pushPiece(piece(arrivingAtBoardStopLine(isEn, displayLegOf(leg, null))));
          break;
        case "arrivingAtAlightStop":
          // 차내 "이번 정류장" 방송과 같은 시점. 도착 문장은 소실 뒤 arrived(certain:false)가 낸다.
          parts.push(t("arrivingAtAlightStop"));
          break;
```
`"boarded"` 케이스는 그대로(`event.cause === "observed"`일 때만 `arrivedAtBoardStopLine` — `departed`는 `boardedLine`만 낸다). 주석 한 줄 추가: `// departed(A41)는 "도착. 탑승하세요"를 내지 않는다 — 차량은 이미 떠났다.`

- [ ] **Step 2: iOS 모델**

`announcementText` switch에:
```swift
        case .arrivingAtBoardStop:
            // A41: "곧 도착" = 직전 정류소 출발. 승격 없이 임박만 — 탑승 문장은 소실 뒤 boarded(departed)가 낸다.
            if let leg {
                parts.append(TransitGuideTextRenderer.render(
                    transitArrivingAtBoardStopLine(isEn: transitGuideIsEn, leg: displayLeg(leg, useOverride: false))))
            }
        case .arrivingAtAlightStop:
            // 차내 "이번 정류장" 방송과 같은 시점. 도착 문장은 소실 뒤 arrived(certain: false)가 낸다.
            parts.append(appLocalized("transitGuide.arrivingAtAlightStop"))
```
`handle(event:)`의 즉시 창구 분기(`.boarded(legIndex: _, cause: .declared), .legAdvanced`)는 그대로 — `departed`는 폴 유래라 지연 창구(주석에 그 문장 한 줄).

- [ ] **Step 3: 빌드·타입 확인**

```bash
npx tsc --noEmit
xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -configuration Experimental -destination 'generic/platform=iOS Simulator' build -quiet
```
Expected: 오류 0(Swift switch 망라성 — 새 case가 빠졌으면 여기서 컴파일 오류).

- [ ] **Step 4: Commit** — `feat(transit): A41 곧 도착 이벤트 통지 배선(웹 훅·iOS 모델)`.

---

### Task 4: 문서 분배

**Files:** `CHANGELOG.md`(2026-09-12 절 신설, 맨 위), `docs/BACKLOG.md`(A41 절 종결 표기 + §2 N3 행 ② 재판정), `docs/FIELD-TEST.md` L290(N3 도착 행), `docs/INTEGRATIONS.md` §시내버스(L195 문단 뒤), `CLAUDE.md`(횡단 함정 "도착 낭독 정본" 불릿 뒤 1~2줄), `docs/research/RESEARCH-2026-08-03-mode-specific-guidance.md`(머리 인용문 뒤 한 줄), `PROGRESS.md`(boarding 국면 행에 한 줄).

- [ ] **Step 1: 각 문서 편집** — 내용은 spec §4. CLAUDE.md 규칙 문안: `- **서울버스 "곧 도착"(잔여 0)은 정차가 아니라 직전 정류소 출발이다**(A41 실호출 2026-09-12: \`isArrive1\` 0 고정, 정차 신호는 API에 없다). 승차 승격은 "잔여 0 뒤 소실"(\`boarded(departed)\`), 하차 확정 도착은 없고 소실 → 도착 추정만. 잔여 0을 정차·도착 확정으로 다시 읽지 말 것. → INTEGRATIONS`
- [ ] **Step 2: 크기 예산 확인** — `npx vitest run src/lib/__tests__/claude-md-budget.test.ts`
- [ ] **Step 3: Commit** — `docs: A41 종결 분배(CHANGELOG·BACKLOG·FIELD-TEST·INTEGRATIONS·CLAUDE.md·research·PROGRESS)`.

---

### Task 5: 리뷰 → rebase → 게이트 → 로컬 main ff (플랜 §3 절차)

- [ ] spec-compliance + code-quality 서브에이전트(입력: spec·이 플랜·`git diff main...HEAD`, 보고 `~/gildongmu-wt/reports/transit-signal-review-{spec,code}.md`). 지적 처리 후 재커밋.
- [ ] `git rebase main` → `node ios/scripts/messages-to-xcstrings.mjs all && node ios/scripts/check-xcstrings-keys.mjs` → CHANGELOG·BACKLOG·FIELD-TEST `comm` 대조.
- [ ] 락 → `npm run test:run -- --maxWorkers=2 && npx tsc --noEmit && npm run lint` → `(cd ios/GildongmuKit && swift test)` → xcodebuild Experimental → 락 해제.
- [ ] `git -C ~/Mac-Projects/gildongmu merge --ff-only feat/transit-signal` → 보고 파일 ② + SendMessage.

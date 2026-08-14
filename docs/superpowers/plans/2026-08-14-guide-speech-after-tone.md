# 안내 효과음 뒤 발화 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 안내 효과음(잔여 0.6초 이상)이 재생 중이면 그 소리가 끝난 뒤에 VoiceOver/live region 발화를 게시한다. iOS·웹 동시.

**Architecture:** 판정은 순수 함수 `speechDeferStep`(Kit ↔ 웹 미러, 축은 톤 이름이 아니라 남은 재생 시간), 지연은 발화 창구 한 곳의 단일 슬롯(latest-wins·세대 토큰·게시 직전 재평가). iOS는 비동기 수명 계약을 `DeferredAnnouncer` 전용 타입으로 분리(시계·sleeper 주입)하고, 웹은 기존 재발화 타이머와 슬롯을 공유한다.

**Tech Stack:** Swift 6.2(Swift Testing, GildongmuKit SPM) / TypeScript(React hook, Vitest fake timers).

**Spec:** `docs/superpowers/specs/2026-08-14-guide-speech-after-tone-design.md` (codex 적대적 리뷰 반영본 — §4 계약 여섯·§10 판정표를 임의 단순화 금지)

**구현 방식 판정(AUTONOMY §구현 방식):** inline. 순수 함수 계약이 両배선의 인터페이스를 정하는 선행 결정이고, iOS 배선 3파일(`BeaconTonePlayer`→`DeferredAnnouncer`→`BeaconModel`)과 웹 2파일(`useBeaconSound`→`useRouteGuide`)이 각각 강한 순차 의존이며 수정 파일이 겹친다. 리뷰(spec-compliance·code-quality)만 별도 컨텍스트로 분리한다.

## Global Constraints

- 상수 3종: `speechDeferThresholdSeconds = 0.6` / `speechDeferGapSeconds = 0.15` / `speechDeferMaxSeconds = 3.0` (spec §3 — 웹은 `SPEECH_DEFER_THRESHOLD_S` 등 미러, 드리프트 테스트 필수).
- **톤 이름 목록을 코드에 두지 않는다** — 판정 축은 남은 재생 시간뿐.
- 상한은 clamp이지 무효화가 아니다(초과 → 3.0, 0 아님).
- 기능·수정은 같은 커밋에 테스트 동반. 게이트: `npm run test:run` + `cd ios/GildongmuKit && swift test` + `npm run build` + iOS 빌드.
- ⚠ spec §11은 `DeferredAnnouncer`를 앱 타깃에 두지만, 앱에는 테스트 타깃이 없어(§8 수명 테스트가 요구하는 주입 시계·sleeper 테스트가 열리지 않음) **Kit으로 옮긴다**(`NearbyLoadCore` 선례 — §5의 "테스트가 열려야 한다"가 §11 표보다 상위 요구).

---

### Task 1: 판정 순수 함수 (Kit + 웹 미러 + 드리프트)

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/GuideSpeechGate.swift`
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/GuideSpeechGateTests.swift`
- Create: `src/lib/guide-speech-gate.ts`
- Create: `src/lib/__tests__/guide-speech-gate.test.ts` (경계 표 + 웹↔Kit 드리프트 — `guide-motion-drift.test.ts` 패턴)

**Interfaces (Produces):**
- Swift: `public func speechDeferStep(now: Double, toneEndsAt: Double?) -> Double`, `public enum SpeechDeferConstants { speechDeferThresholdSeconds / speechDeferGapSeconds / speechDeferMaxSeconds }`
- TS: `export function speechDeferStep(now: number, toneEndsAt: number | null): number`, `SPEECH_DEFER_THRESHOLD_S` / `SPEECH_DEFER_GAP_S` / `SPEECH_DEFER_MAX_S`

- [ ] **Step 1: 실패하는 테스트 両쪽 작성** — 경계 표(spec §8): remaining 0.235·0.470·0.522 → `0` / 0.731·0.836·1.332·2.246 → `잔여 + 0.15` / `nil(null)`·NaN·±Infinity(**now·toneEndsAt 양쪽**)·이미 지난 톤(remaining 음수) → `0` / remaining 2.9·3.5 → `3.0` clamp / 경계 remaining == 0.6 → `0.75`(지연). 드리프트: 상수 3종 웹 값 == Swift `static let` 정규식 추출값 + Swift 선언 전수 == 표(한쪽만 추가 차단).
- [ ] **Step 2: 실행해 실패 확인** — `npm run test:run -- guide-speech-gate` / `cd ios/GildongmuKit && swift test --filter GuideSpeechGateTests`
- [ ] **Step 3: 구현** (판정 순서 고정 — spec §3):

```swift
public enum SpeechDeferConstants {
    public static let speechDeferThresholdSeconds = 0.6
    public static let speechDeferGapSeconds = 0.15
    public static let speechDeferMaxSeconds = 3.0
}
public func speechDeferStep(now: Double, toneEndsAt: Double?) -> Double {
    guard let toneEndsAt, toneEndsAt.isFinite, now.isFinite else { return 0 }
    let remaining = toneEndsAt - now
    guard remaining >= SpeechDeferConstants.speechDeferThresholdSeconds else { return 0 }
    return min(remaining + SpeechDeferConstants.speechDeferGapSeconds,
               SpeechDeferConstants.speechDeferMaxSeconds)
}
```

```ts
export const SPEECH_DEFER_THRESHOLD_S = 0.6;
export const SPEECH_DEFER_GAP_S = 0.15;
export const SPEECH_DEFER_MAX_S = 3.0;
export function speechDeferStep(now: number, toneEndsAt: number | null): number {
  if (toneEndsAt === null || !Number.isFinite(toneEndsAt) || !Number.isFinite(now)) return 0;
  const remaining = toneEndsAt - now;
  if (remaining < SPEECH_DEFER_THRESHOLD_S) return 0;
  return Math.min(remaining + SPEECH_DEFER_GAP_S, SPEECH_DEFER_MAX_S);
}
```

- [ ] **Step 4: 테스트 통과 확인 후 커밋** (`git commit -- <의도 파일 4개>`)

### Task 2: `DeferredAnnouncer` (Kit, 주입 시계·sleeper)

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/DeferredAnnouncer.swift`
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/DeferredAnnouncerTests.swift`

**Interfaces (Produces):**
- `@MainActor public final class DeferredAnnouncer`
  - `init(clock: @escaping () -> Double, sleeper: @escaping (Double) async -> Void = <Task.sleep>, toneEndsAt: @escaping () -> Double?, post: @escaping (String, Bool) -> Bool)`
  - `func announce(_ text: String, highPriority: Bool = false, onDropped: (() -> Void)? = nil)`
  - `func invalidatePending()` — announceNow 진입·세대 증가에서(§4-1)
  - `func advanceGeneration()` — start·stop·teardown(§4-2)

- [ ] **Step 1: 수명 계약 테스트 작성** (테스트 sleeper = `clock.now += seconds` 동기 진행 — 실제 `Task.sleep`의 "취소 시 즉시 반환" 의미론과 동형. `await Task.yield()` 수회로 Task 소진):
  1. 지연 예약 → `invalidatePending()`/`advanceGeneration()` → yield → **post 0회**(§4-3: 취소한 문장 미발화).
  2. 지연 중 새 `announce` → 옛 문장 post 0회, 새 문장 post 1회(§4-1 latest-wins).
  3. `advanceGeneration()` 후 이전 세대 예약이 발화되지 않음(§4-2).
  4. 게시 직전 재평가(§4-5): `toneEndsAt` 클로저를 스크립트(1회차 0.731, 2회차 이후 새 톤 종료 시각)로 — sleeper 요청 이력이 `[0.881, <추가 대기>]` 2회이고 post 1회.
  5. 총 대기 상한: `toneEndsAt = { clock.now + 2 }`(항상 잔여 2초) → 경과 3.0초 시점에 그대로 post(무한 연기 없음).
  6. `post`가 false 반환 → `onDropped` 1회 호출(§4-4·§4-6). true 반환 → 미호출.
  7. 즉시 경로(wait 0): post 동기 호출 + 진입 시 보류 슬롯 폐기.
- [ ] **Step 2: 실패 확인** — `swift test --filter DeferredAnnouncerTests`
- [ ] **Step 3: 구현**:

```swift
@MainActor
public final class DeferredAnnouncer {
    private let clock: () -> Double
    private let sleeper: (Double) async -> Void
    private let toneEndsAt: () -> Double?
    private let post: (String, Bool) -> Bool
    private var generation = 0
    private var nextToken = 0
    private var slot: (token: Int, task: Task<Void, Never>)?

    public init(clock:sleeper:toneEndsAt:post:) { ... }  // sleeper 기본값 = Task.sleep(nanoseconds:)

    public func advanceGeneration() { generation += 1; invalidatePending() }
    public func invalidatePending() { slot?.task.cancel(); slot = nil }

    public func announce(_ text: String, highPriority: Bool = false, onDropped: (() -> Void)? = nil) {
        invalidatePending()  // §4-1: latest-wins는 창구와 무관
        let wait = speechDeferStep(now: clock(), toneEndsAt: toneEndsAt())
        guard wait > 0 else {
            if !post(text, highPriority) { onDropped?() }  // §4-4: 실패 처리는 즉시 발화와 동일
            return
        }
        nextToken += 1
        let token = nextToken
        let gen = generation
        let scheduledAt = clock()
        let task = Task { [weak self] in
            var pending = wait
            while true {
                await self?.sleeper(pending)
                guard let self, !Task.isCancelled else { return }
                // §4-3: 취소만으론 부족 — sleep은 취소되면 즉시 반환하므로 토큰·세대 확인이 정본.
                guard self.slot?.token == token, self.generation == gen else { return }
                // §4-5: 게시 직전 재평가. 총 대기 상한 안에서만 더 기다린다.
                let elapsed = self.clock() - scheduledAt
                let more = speechDeferStep(now: self.clock(), toneEndsAt: self.toneEndsAt())
                if more > 0, elapsed < SpeechDeferConstants.speechDeferMaxSeconds {
                    pending = min(more, SpeechDeferConstants.speechDeferMaxSeconds - elapsed)
                    continue
                }
                // §4-3 ABA: 슬롯 해제는 자기 토큰일 때만.
                if self.slot?.token == token { self.slot = nil }
                if !self.post(text, highPriority) { onDropped?() }
                return
            }
        }
        slot = (token, task)
    }
}
```

- [ ] **Step 4: 통과 확인 후 커밋**

### Task 3: iOS `BeaconTonePlayer` — `toneEndsAt` 노출·잔여 산출 일원화

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconTonePlayer.swift`

**Interfaces (Produces):** `private(set) var toneEndsAt: Double?`

- [ ] **Step 1: 구현** (spec §5, MINOR 3):
  - `private(set) var toneEndsAt: Double?` 추가.
  - `private var remainingPlaybackSeconds: Double? { guard let p = playing, p.isPlaying else { return nil }; return max(0, p.duration - p.currentTime) }` — `endSession()`의 `player.duration - player.currentTime` 계산을 이것으로 교체(산출 일원화).
  - `play(_:)` **첫 줄에서 `toneEndsAt = nil`** (조기 반환 3경로를 개별로 지우지 않는다 — 소리 안 나는데 이전 톤 시각으로 문장이 미뤄지는 결함 차단). `player.play()` 성공 분기에서 `playing = player` 뒤 `toneEndsAt = ProcessInfo.processInfo.systemUptime + (remainingPlaybackSeconds ?? player.duration)`.
  - `shutdown()`에서 `playing = nil` 옆에 `toneEndsAt = nil`.
- [ ] **Step 2: 빌드 확인 후 Task 4와 함께 커밋**

### Task 4: iOS `BeaconModel` 재배선

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`

- [ ] **Step 1: 창구 재구성** (spec §4-6 — 반환값 제거가 강제 수단):
  - 기존 `announce`(2242행) 본문을 `private func post(_ message: String, highPriority: Bool = false, bypassSuppression: Bool = false) -> Bool`로 개명(가드 순서·주석 유지). `@discardableResult` 제거.
  - `private lazy var deferredAnnouncer = DeferredAnnouncer(clock: { ProcessInfo.processInfo.systemUptime }, toneEndsAt: { [weak self] in self?.tones.toneEndsAt }, post: { [weak self] text, high in self?.post(text, highPriority: high) ?? false })`
  - `private func announce(_ message: String, highPriority: Bool = false, onDropped: (() -> Void)? = nil)` → `deferredAnnouncer.announce(...)` 위임.
  - `private func announceNow(_ message: String, highPriority: Bool = false, bypassSuppression: Bool = false)` → `deferredAnnouncer.invalidatePending()` 후 `_ = post(...)` (§4-1: 즉시 창구도 진입 즉시 슬롯 무효화).
- [ ] **Step 2: 세대 증가** — `start()`(상태 리셋 구간)·`stop()`(머리 부분, `pendingStepFreeNotice = nil` 옆)에 `deferredAnnouncer.advanceGeneration()`. `teardown()`은 `stop()` 경유로 충족(주석 한 줄). ⚠ **게시 시점 `isTracking` 검사 금지**(§4-2 — 도착 통지는 정의상 stop() 이후).
- [ ] **Step 3: 호출부 이관** (`grep -n "announce(" BeaconModel.swift` 전수 — spec §5):
  - 반환값 소비 4곳(640·1771·1853·2101, `if !announce(text, highPriority: true), let notice { pendingStepFreeNotice = notice }`) → `announce(text, highPriority: true, onDropped: { [weak self] in if let notice { self?.pendingStepFreeNotice = notice } })`
  - 1444행 `if !announce(text) { pendingFinalApproachIntro = text }` → `announce(text, onDropped: { [weak self] in self?.pendingFinalApproachIntro = text })`
  - 983행(성공 시 지우는 역방향) → 먼저 지우고 onDropped에서 복원:
    ```swift
    if !owed.isEmpty {
        let notice = pendingStepFreeNotice; let intro = pendingFinalApproachIntro
        pendingStepFreeNotice = nil; pendingFinalApproachIntro = nil
        announce(owed) { [weak self] in
            self?.pendingStepFreeNotice = notice
            self?.pendingFinalApproachIntro = intro
        }
    }
    ```
  - `bypassSuppression` 사용 2곳(898·948, 목적지 전환 확인) → `announceNow(...)`.
  - 나머지 호출은 형태 불변.
- [ ] **Step 4: iOS 빌드 + Kit 테스트 통과 확인, Task 3과 함께 커밋**

### Task 5: 웹 `useBeaconSound` — `play` 길이 반환 + `preload`

**Files:**
- Modify: `src/hooks/useBeaconSound.ts`

**Interfaces (Produces):** `play(sound): number`(초, 버퍼 없으면 0) / `preload(sounds: GuideSound[]): void`

- [ ] **Step 1: 구현** (spec §6, BLOCKER 4):
  - `loadBuffer(ctx, sound): Promise<AudioBuffer | null>` 추출(fetch→decode→buffersRef 저장, 실패 null).
  - `play`: cached 경로에서 `startBuffer` 성공 시 `cached.duration` 반환, 그 외 전부 `0`. cold 경로는 종전대로 로드 후 재생(길이 미반환).
  - `preload(sounds)`: 각 sound에 대해 buffers/loading 미보유 시 `loadingRef` 가드 걸고 `loadBuffer`만(재생 없음).
- [ ] **Step 2: Task 6과 함께 테스트·커밋**

### Task 6: 웹 `useRouteGuide` — 지연 게이트 배선

**Files:**
- Modify: `src/hooks/useRouteGuide.ts`
- Create: `src/hooks/__tests__/useRouteGuide.speech-defer.test.tsx`
- Modify: 기존 `useBeaconSound` mock을 쓰는 테스트들(`grep -l 'useBeaconSound' src/hooks/__tests__/`)에 `preload: vi.fn()` 추가

- [ ] **Step 1: 실패하는 훅 테스트 작성** (vitest fake timers + performance, `useRouteGuide.tone.test.tsx` 하네스 재사용. play mock은 톤별 실측 길이 반환):
  1. 긴 톤(start 1.332) 재생 직후의 통지 → live region은 지연(≈1.48s) 경과 후에만 채워진다.
  2. 지연 중 새 통지 → 옛 문장은 끝내 DOM에 나타나지 않는다(latest-wins).
  3. 짧은 톤(closer 0.235) 뒤 통지 → 즉시.
  4. 타이머가 늦게 깨면(performance.now 스파이로 예정+2초 오프셋 후 실행) 폐기(MAJOR 6).
- [ ] **Step 2: 실패 확인** — `npm run test:run -- speech-defer`
- [ ] **Step 3: 구현**:
  - `const toneEndsAtRef = useRef<number | null>(null);` + `playTone(sound, now)` 헬퍼(`const len = play(sound); if (len > 0) toneEndsAtRef.current = now + len;`). `emitTone`의 `play(out.tone)`과 `start()`/`stop()`의 직접 `play("start")`/`play("stop")`을 전부 헬퍼로 교체(세션 경계 톤도 지연 대상 — spec §1 표).
  - `start()`의 `playTone("start", ...)` 뒤 `preload(["ahead", "warning", "nearby"])`.
  - `announce` 분해: live region 반영(같은 문자열 재발화 우회 포함)을 `commit(text)`로 추출. `announce(text)`는 진입 시 `reannounceTimerRef` 해제(단일 슬롯 latest-wins — 지연·재발화 공유, ref 추가 금지), 빈 문자열은 즉시 `commit`, `wait = speechDeferStep(performance.now()/1000, toneEndsAtRef.current)`이 0이면 즉시 `commit`, 아니면 `scheduleDeferred(text, wait, scheduledAt, genRef.current)`:
    ```ts
    const scheduleDeferred = (text, wait, scheduledAt, gen) => {
      const due = performance.now() / 1000 + wait;
      reannounceTimerRef.current = window.setTimeout(() => {
        reannounceTimerRef.current = null;
        if (!mountedRef.current || gen !== genRef.current) return;
        const now = performance.now() / 1000;
        if (now - due > DEFER_LATE_DISCARD_S) return;      // MAJOR 6: 낡은 예약 폐기(1초)
        const elapsed = now - scheduledAt;
        const more = speechDeferStep(now, toneEndsAtRef.current);
        if (more > 0 && elapsed < SPEECH_DEFER_MAX_S) {     // §4-5 재평가, 상한 안
          scheduleDeferred(text, Math.min(more, SPEECH_DEFER_MAX_S - elapsed), scheduledAt, gen);
          return;
        }
        commit(text);
      }, wait * 1000);
    };
    ```
  - 세대는 기존 `genRef` 재사용(시작·중지에서 이미 증가 — 발화 폐기 의미론과 일치함을 확인, spec §6). 취소 지점: `stop()`의 `announce("")`가 진입 해제로 슬롯을 비우고, 언마운트는 `mountedRef` 가드.
- [ ] **Step 4: `npm run test:run` 전체 + `npm run build`(타입 게이트) 통과, Task 5와 함께 커밋**

### Task 7: 변이 주입 검출력 실증 → spec §8 기록

- [ ] spec §8 변이 6종을 하나씩 실제로 주입하고 어느 테스트가 깨지는지 기록, 원복:
  1. 대기 뒤 토큰·`Task.isCancelled` 확인 삭제 (iOS)
  2. `announceNow`의 `invalidatePending()` 삭제 (iOS)
  3. `stop()`/`start()`의 `advanceGeneration()` 삭제 (iOS)
  4. 게시 시점 억제·전경 재평가 우회(post를 지연 예약 시점 평가로) (iOS)
  5. ABA: 슬롯 해제를 무조건 `slot = nil`로 (iOS)
  6. `onDropped` 미호출 (iOS)
  - 웹: latest-wins 해제 삭제·낡은 예약 폐기 삭제·`toneEndsAt` 기록 삭제 3종도 주입.
- [ ] 깨지지 않는 변이가 있으면 그 축의 테스트를 보강한 뒤 재주입. 결과를 spec §8에 표로 기록, 커밋.

### Task 8: 리뷰 → 커밋·배포 → 문서 분배

- [ ] spec-compliance + code-quality 서브에이전트 리뷰(각각 spec 경로와 diff 범위만 전달, 세션 히스토리 금지). 지적 처리 후 재검증.
- [ ] 최종 커밋·push(자동배포). `git add -A` 금지.
- [ ] 실기기 배포: 병렬 세션 확인(ListAgents) 후 `CONFIGURATION=Experimental ./ios/deploy-device.sh` + 공식판(Debug) 배포 — 지연 계층은 간략 비콘(공식판 출하 기능)에도 걸린다([[ios-device-deploy-both-configurations]]).
- [ ] 문서 분배: `CHANGELOG.md` 항목 / `docs/BACKLOG.md` A12 상태(구현 완료·실보행 판정 대기, `imminentAheadMeters` 재판정 후속 명시) / `CLAUDE.md` 함정 한 줄(소리와 음성은 같은 청각 채널 — 톤 뒤 발화 계약) / `PROGRESS.md` 상태 한 줄.

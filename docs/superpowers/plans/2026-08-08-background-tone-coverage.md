# 백그라운드 사운드 + 톤 커버리지 통일 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 잠금·백그라운드에서도 안내 톤이 들리게 하고(음성은 억제), 간략·상세 두 모드의 톤 의미론을 하나로 통일하며, 톤이 없는 신뢰 불가 구간을 전용 소리로 메운다.

**Architecture:** 톤 선택을 앱 계층에서 걷어내 Kit/lib **순수 함수 3종**(`motionStep`·`trendStep`·`toneLayerStep`)으로 내린다. 두 모드는 같은 `toneLayerStep`을 쓰고 차이는 입력 조립에만 둔다. 오디오 세션은 "안내가 원하는 카테고리 / 우리가 승격했는가 / 다른 소비자가 점유 중인가" 세 값을 든 상태 머신이 소유하고, 그 판정도 Kit 순수 함수로 분리한다. 앱·훅은 배선(위치 스트림, 타이머, 문자열, I/O)만 담당한다.

**Tech Stack:** Swift 6(GildongmuKit·SwiftUI 앱) / TypeScript(Next.js 16·React 19) / Vitest 4 · Swift Testing / AVAudioSession · Web Audio

**설계 정본:** `docs/superpowers/specs/2026-08-08-background-tone-coverage-design.md`

## Global Constraints

- **소리 9종**: `start`·`stop`·`closer`·`farther`·`tick`·`ahead`·`warning`·`nearby` + 신규 `unreliable`. `tick`의 뜻은 "하트비트"에서 **"정지"**로 바뀐다.
- **사운드 파일은 웹↔iOS 바이트 동일**(`src/lib/__tests__/sounds-drift.test.ts`가 강제). 웹 `public/sounds/guide/<이름>.mp3` ↔ 앱 `ios/Gildongmu/Resources/Sounds/guide-<이름>.mp3`.
- **정지 임계 확정값**(위원장 판정 2026-08-08, 재계산 금지): `stopEnterMps` **0.4** / `stopExitMps` **0.6** / `stopEnterHoldS` **2.0**.
- **허용 최대 정상 침묵 `maxNormalSilenceS` = 21초**(위원장 판정으로 계약값 확정. 최소 재확인 간격 추가·데드밴드 축소는 기각됨 — 되살리지 말 것).
- **초기값**(실사용 조정 대상, 블로킹 아님): `unreliableIntervalS` 10 / `noFixSeconds` 8 / 차량 closer 간격 10초 / `speedAccuracyCeiling` 1.0 m/s.
- **백그라운드 오디오는 Experimental 구성만**. `ios/Support/Info.plist`(Release)에는 넣지 않는다.
- **웹은 §3(백그라운드 오디오·음성 억제) 비적용**. 웹은 `visibilitychange`에서 세션을 중지하므로 백그라운드 자체가 없다. 나머지 §4~§8은 전부 적용하고 상수를 동조시킨다.
- **웹 속도 표현이 iOS와 다르다**: `GeolocationCoordinates.speed`는 무효일 때 **`null`**이고 `speedAccuracy`가 **없다**. `speed < 0` 분기를 그대로 옮기면 `null`이 0으로 암묵 변환되어 거짓 정지 tick이 난다.
- **판정은 Kit/lib, 배선은 앱/훅**. 앱 타깃 테스트 번들이 없으므로 `BeaconModel`에 판정을 두면 구조적으로 검증 불가다.
- 커밋 이메일 `engccer@gmail.com`, 커밋 메시지·주석·문서는 한국어. `git add -A` 금지, 의도 파일만 stage.
- 게이트: `npm run test:run` 전량 green + `swift test`(GildongmuKit) + `npm run build`(타입 검사 — Vitest는 트랜스파일만 하므로 타입 오류를 못 잡는다).

---

## 파일 구조

### 신규

| 파일 | 책임 |
|---|---|
| `ios/GildongmuKit/Sources/GildongmuKit/GuideMotion.swift` | 3-state 정지 판정(`MotionState`·`motionStep`) + 임계 상수 |
| `ios/GildongmuKit/Sources/GildongmuKit/GuideToneLayer.swift` | 배타적 톤 계층(`toneLayerStep`) + 추세 축 + 빈도 상수 |
| `ios/GildongmuKit/Sources/GildongmuKit/GuideAudioSession.swift` | 오디오 세션 소유권 판정(순수) |
| `ios/GildongmuKit/Tests/GildongmuKitTests/GuideMotionTests.swift` | 정지 3-state 경계·히스테리시스 |
| `ios/GildongmuKit/Tests/GildongmuKitTests/GuideToneLayerTests.swift` | 계층 배타성·간격·재기준화·최대 침묵 |
| `ios/GildongmuKit/Tests/GildongmuKitTests/GuideAudioSessionTests.swift` | 승격·원복·suppression·인터럽션 |
| `src/lib/guide-motion.ts` | Kit `GuideMotion.swift` 미러 |
| `src/lib/guide-tone-layer.ts` | Kit `GuideToneLayer.swift` 미러 |
| `src/lib/__tests__/guide-motion.test.ts` | 웹 미러 계약(특히 `speed: null`) |
| `src/lib/__tests__/guide-tone-layer.test.ts` | 웹 미러 계약 |
| `src/lib/__tests__/fixtures/tone-layer-scenarios.json` | 웹↔Kit 공유 시나리오(드리프트 강제) |
| `public/sounds/guide/unreliable.mp3` + `ios/Gildongmu/Resources/Sounds/guide-unreliable.mp3` | 신규 소리(바이트 동일) |
| `scripts/build-unreliable-candidates.py` | 후보 합성 스크립트(선정 재현용) |

### 수정

| 파일 | 변경 |
|---|---|
| `ios/GildongmuKit/Sources/GildongmuKit/BeaconTones.swift` | `unreliable` 케이스 추가 |
| `ios/GildongmuKit/Sources/GildongmuKit/Beacon.swift` | `trendStep` 추출, `beaconStep`이 재사용(동작 불변) |
| `ios/GildongmuKit/Sources/GildongmuKit/BeaconGate.swift` | 톤 책임 제거(통지 전용으로 축소) |
| `ios/Gildongmu/Directions/BeaconTonePlayer.swift` | 세션 상태 머신·선점 재생·`isSilenced` 확장·`unreliable` 게인 |
| `ios/Gildongmu/Directions/BeaconModel.swift` | 톤 계층 배선, fix 워치독, 음성 게이트, handoff 재기준화 |
| `ios/Gildongmu/LocationService.swift` | `BeaconFixPayload`에 `speed`·`speedAccuracy` |
| `ios/Support/Info-Experimental.plist` | `UIBackgroundModes`에 `audio` |
| `src/lib/beacon.ts` | `trendStep` 추출 |
| `src/hooks/useBeaconSound.ts` | `unreliable` 사운드 |
| `src/hooks/useRouteGuide.ts` | 톤 계층 배선, 워치독, handoff 재기준화 |
| `src/lib/__tests__/sounds-drift.test.ts` | 9종으로 확장 |
| `messages/*.json`(6종) · `ios/Gildongmu/Resources/Localizable.xcstrings` | 승격 실패 문구 |
| `CLAUDE.md` · `PROGRESS.md` | 계약 기록 |

---

## 마일스톤

| # | 이름 | 내용 | 선행 |
|---|---|---|---|
| M0 | 신규 소리 확정 | `unreliable` 후보 합성 → 위원장 청취 → 배치 | 없음(블로킹 태스크, 최우선 착수) |
| M1 | 오디오 출력 계층 | 세션 상태 머신·백그라운드 audio·음성 억제 게이트 | 없음 |
| M2 | 판정 코어 | `motionStep`·`trendStep`·`toneLayerStep`(Kit+웹) | M0(톤 식별자만) |
| M3 | 배선 | iOS·웹 오케스트레이터 교체, 워치독, handoff | M1·M2 |
| M4 | 검증·문서 | 변이 주입, 최대 침묵 계약, 리뷰, 배포 | M3 |

**구현 방식 판정(자율성 헌장 §구현 방식 판정):** **inline 순차**. M2 내부가 강한 선행 관계(`trendStep` 추출 → `toneLayerStep`이 그것을 호출 → fixture가 둘을 동시에 검증)이고, M3의 두 태스크가 같은 파일(`BeaconModel.swift`·`useRouteGuide.ts`)을 편집한다. M1만 파일이 겹치지 않으나 단독 위임의 이득이 리뷰 왕복 비용을 넘지 않는다. **리뷰는 이 판정과 무관하게 분리한다**(M4).

---

## M0: 신규 소리 확정

### Task 1: `unreliable` 후보 합성과 선정

**Files:**
- Create: `scripts/build-unreliable-candidates.py`
- Create: `public/sounds/guide/unreliable.mp3`
- Create: `ios/Gildongmu/Resources/Sounds/guide-unreliable.mp3`
- Modify: `src/lib/__tests__/sounds-drift.test.ts`

**Interfaces:**
- Produces: 파일 2개(바이트 동일) + 드리프트 가드가 아는 9번째 이름 `unreliable`

**설계 근거:** 신규 소리의 뜻은 "위치 불확실"이 아니라 **"현재 안내를 신뢰할 수 없음"**이다(spec §4.1). 원인이 셋(GPS 정확도 불량·fix 부재·경로 재획득)이지만 사용자가 취할 행동은 같아서(기다리거나 하늘이 트인 곳으로 이동) 소리를 나누면 학습 부담만 는다. 원인 구분은 전경 음성이 담당한다.

- [ ] **Step 1: 후보 합성 스크립트 작성**

`scripts/build-unreliable-candidates.py`:

```python
#!/usr/bin/env python3
"""`unreliable` 톤 후보 합성(2026-08-08 선정용).

기존 8종 중 closer·farther가 합성 렌더 파일이라 합성 후보는 선례가 있다.
제약(spec §10): ① `warning`(낮은 이중음·이탈)과 확실히 구분될 것 — 이탈은
사용자 행동, 신뢰 불가는 기기 사정이라 취할 행동이 다르다 ② `.mixWithOthers`
이므로 배경 미디어 위에서 묻히지 않을 것 ③ 1초 미만.

출력: /tmp 후보 wav + mp3. 확정본만 저장소에 배치한다.
"""
import math
import subprocess
import sys
import wave
from pathlib import Path

SR = 44100


def render(samples: list[float], path: Path) -> None:
    peak = max(1e-9, max(abs(s) for s in samples))
    frames = bytearray()
    for s in samples:
        v = int(max(-1.0, min(1.0, s / peak * 0.89)) * 32767)
        frames += v.to_bytes(2, "little", signed=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(frames))


def env(i: int, n: int, attack: float = 0.01, release: float = 0.06) -> float:
    """클릭 방지 어택·릴리스 포락선(초 단위)."""
    t = i / SR
    total = n / SR
    a = min(1.0, t / attack) if attack > 0 else 1.0
    r = min(1.0, (total - t) / release) if release > 0 else 1.0
    return max(0.0, a * r)


def wobble(freq: float, depth: float, rate: float, dur: float) -> list[float]:
    """진폭이 흔들리는 톤. '불안정'을 음색 자체로 전달한다."""
    n = int(SR * dur)
    out = []
    for i in range(n):
        t = i / SR
        amp = 1.0 - depth * (0.5 - 0.5 * math.cos(2 * math.pi * rate * t))
        out.append(math.sin(2 * math.pi * freq * t) * amp * env(i, n))
    return out


def two_tone(f1: float, f2: float, dur: float, gap: float = 0.0) -> list[float]:
    """두 음 연속. gap이 0이면 붙여서 낸다."""
    out = []
    for f in (f1, f2):
        n = int(SR * dur)
        out += [math.sin(2 * math.pi * f * (i / SR)) * env(i, n) for i in range(n)]
        out += [0.0] * int(SR * gap)
    return out


def beat(f: float, delta: float, dur: float) -> list[float]:
    """두 근접 주파수의 맥놀이. 협화가 깨진 소리라 '못 믿겠다'와 짝이 맞는다."""
    n = int(SR * dur)
    return [
        (math.sin(2 * math.pi * f * (i / SR)) + math.sin(2 * math.pi * (f + delta) * (i / SR)))
        * 0.5
        * env(i, n)
        for i in range(n)
    ]


CANDIDATES = {
    # A: 흔들리는 단음(진폭 트레몰로) — 가장 조용하고 배경에 잘 섞인다.
    "a-wobble": wobble(760, depth=0.7, rate=18, dur=0.42),
    # B: 하강 2음의 좁은 간격(장2도) — 불협 하강, warning보다 높고 짧다.
    "b-dissonant": two_tone(880, 784, dur=0.16, gap=0.03),
    # C: 맥놀이 단음 — 두 음이 서로 어긋나며 흔들린다.
    "c-beat": beat(700, delta=7, dur=0.5),
}


def main() -> int:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/unreliable-candidates")
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, samples in CANDIDATES.items():
        wav = out_dir / f"{name}.wav"
        mp3 = out_dir / f"{name}.mp3"
        render(samples, wav)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),
             "-codec:a", "libmp3lame", "-b:a", "128k", str(mp3)],
            check=True,
        )
        print(f"{name}: {mp3}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: 후보 생성**

Run: `python3 scripts/build-unreliable-candidates.py /tmp/unreliable-candidates`
Expected: `a-wobble.mp3`·`b-dissonant.mp3`·`c-beat.mp3` 3개 생성.

- [ ] **Step 3: 배경 미디어 위 청취본 준비**

`.mixWithOthers`라 팟캐스트·음악 위에서 저이득 톤이 묻히면 그 톤은 사실상 없는 것이다. 공존 확인만으로는 이 결함이 안 잡힌다(spec §10.2). 기존 `tick`(게인 0.3)과 같은 조건으로 확인할 수 있도록 **게인 0.3을 적용한 사본**과 **기존 `warning`과 이어 붙인 대조본**을 만든다.

```bash
cd /tmp/unreliable-candidates
for c in a-wobble b-dissonant c-beat; do
  ffmpeg -y -loglevel error -i $c.mp3 -filter:a "volume=0.3" ${c}-gain03.mp3
  ffmpeg -y -loglevel error -i "$PWD/../../$OLDPWD/public/sounds/guide/warning.mp3" \
    -i ${c}-gain03.mp3 -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1" ${c}-vs-warning.mp3
done
ls -la
```

(경로가 어긋나면 `warning.mp3` 절대경로를 직접 지정한다: `/Users/hunyongkim/Mac-Projects/gildongmu/public/sounds/guide/warning.mp3`)

- [ ] **Step 4: 위원장 청취 요청**

AskUserQuestion으로 3후보를 제시한다. 질문에 반드시 포함할 것:
- 파일 경로(직접 재생용)
- 각 후보의 음색 설명 1줄
- **배경 미디어(팟캐스트·음악)를 재생한 채로 들어 달라는 요청**(spec §10.2 게이트)
- `warning`과 구분되는지 확인 요청

⚠ 이 단계는 **사람 판정이며 자동화 대상이 아니다**. 답이 오기 전까지 M0는 열린 채로 두고 M1·M2를 먼저 진행한다(파일이 없어도 `BeaconTone.unreliable` 식별자와 계층 로직은 구현·테스트 가능하다. 재생만 M0 완료 후 살아난다).

- [ ] **Step 5: 확정본 배치**

```bash
cp /tmp/unreliable-candidates/<선정>.mp3 public/sounds/guide/unreliable.mp3
cp public/sounds/guide/unreliable.mp3 ios/Gildongmu/Resources/Sounds/guide-unreliable.mp3
```

⚠ 두 파일은 **복사로 만든다**(재인코딩 금지 — 바이트 동일 가드).

- [ ] **Step 6: 드리프트 가드 확장**

`src/lib/__tests__/sounds-drift.test.ts`의 `SOUNDS` 배열에 `"unreliable"`을 추가한다(마지막 원소). 같은 파일의 "iOS BeaconTone 케이스와 파일 집합이 일치한다" 테스트가 `case closer, farther, nearby, tick, start, stop, ahead, warning, unreliable` 문자열을 요구하게 되므로 Task 5와 순서가 맞물린다.

- [ ] **Step 7: 테스트**

Run: `npm run test:run -- sounds-drift`
Expected: 9종 전부 PASS(Task 5 완료 후).

- [ ] **Step 8: 커밋**

```bash
git commit -- scripts/build-unreliable-candidates.py public/sounds/guide/unreliable.mp3 \
  ios/Gildongmu/Resources/Sounds/guide-unreliable.mp3 src/lib/__tests__/sounds-drift.test.ts \
  -m "feat(guide): 신뢰 불가 상태 전용 소리 추가

위원장 청취 선정. 뜻은 '위치 불확실'이 아니라 '현재 안내를 신뢰할 수 없음'이다
(원인 셋에 사용자가 취할 행동은 같아 소리를 나누지 않는다 — 원인 구분은 전경 음성).
배경 미디어 위 청취로 저이득 매몰을 함께 확인했다."
```

---

## M1: 오디오 출력 계층 (iOS 전용)

### Task 2: 오디오 세션 소유권 판정(Kit 순수 함수)

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/GuideAudioSession.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/GuideAudioSessionTests.swift`

**Interfaces:**
- Produces: `GuideAudioCategory`, `GuideAudioSessionState`, `GuideAudioEvent`, `GuideAudioAction`, `guideAudioStep(state:event:) -> (state, action)`

**설계 근거:** "세션 시작 시 승격, 종료 시 원복"만으로는 안전하지 않다(spec §3.2). 오디오 세션은 프로세스 전역 자원이고 소비자가 셋(안내 톤·TTS `.playback`·받아쓰기 `.playAndRecord`)이라, 무조건 원복하면 다른 소비자의 카테고리를 파괴한다. **판정을 순수 함수로 내리는 이유**는 앱 타깃에 테스트 번들이 없어 `BeaconTonePlayer` 안에 두면 "suppression 중 시작 → 해제 시 승격" 같은 계약에 변이 주입조차 못 하기 때문이다.

- [ ] **Step 1: 실패 테스트 작성**

`ios/GildongmuKit/Tests/GildongmuKitTests/GuideAudioSessionTests.swift`:

```swift
import Testing
@testable import GildongmuKit

@Suite("안내 오디오 세션 소유권")
struct GuideAudioSessionTests {
    @Test("세션 시작은 .playback으로 승격한다")
    func startPromotes() {
        let (state, action) = guideAudioStep(state: .initial, event: .sessionStarted)
        #expect(action == .apply(.playback))
        #expect(state.desired == .playback)
        #expect(state.didPromote)
    }

    @Test("suppression 중 시작은 의도만 저장하고 적용하지 않는다")
    func startWhileSuppressed() {
        var (state, _) = guideAudioStep(state: .initial, event: .suppressionChanged(true))
        let stepped = guideAudioStep(state: state, event: .sessionStarted)
        state = stepped.state
        #expect(stepped.action == .none)
        #expect(state.desired == .playback)
        #expect(!state.didPromote)  // 적용하지 않았으므로 원복 자격도 없다
    }

    @Test("suppression 해제 시 저장된 의도를 재적용한다")
    func reconcileOnSuppressionEnd() {
        var state = GuideAudioSessionState.initial
        state = guideAudioStep(state: state, event: .suppressionChanged(true)).state
        state = guideAudioStep(state: state, event: .sessionStarted).state
        let (next, action) = guideAudioStep(state: state, event: .suppressionChanged(false))
        #expect(action == .apply(.playback))
        #expect(next.didPromote)
    }

    @Test("우리가 승격하지 않았으면 종료 시 원복하지 않는다")
    func noRevertWithoutPromotion() {
        var state = GuideAudioSessionState.initial
        state = guideAudioStep(state: state, event: .suppressionChanged(true)).state
        state = guideAudioStep(state: state, event: .sessionStarted).state
        let (_, action) = guideAudioStep(state: state, event: .sessionEnded)
        #expect(action == .none)
    }

    @Test("승격했으면 종료 시 .ambient로 원복한다")
    func revertAfterPromotion() {
        var state = GuideAudioSessionState.initial
        state = guideAudioStep(state: state, event: .sessionStarted).state
        let (next, action) = guideAudioStep(state: state, event: .sessionEnded)
        #expect(action == .apply(.ambient))
        #expect(!next.didPromote)
        #expect(next.desired == .ambient)
    }

    @Test("인터럽션 종료가 suppression 중에 도착해도 해제 시 복구된다")
    func interruptionDuringSuppression() {
        var state = GuideAudioSessionState.initial
        state = guideAudioStep(state: state, event: .sessionStarted).state
        state = guideAudioStep(state: state, event: .suppressionChanged(true)).state
        let ignored = guideAudioStep(state: state, event: .interrupted)
        #expect(ignored.action == .none)
        state = ignored.state
        let (_, action) = guideAudioStep(state: state, event: .suppressionChanged(false))
        #expect(action == .apply(.playback))
    }

    @Test("route 변경·media reset은 재조정 경로를 지난다")
    func routeChangeReconciles() {
        var state = GuideAudioSessionState.initial
        state = guideAudioStep(state: state, event: .sessionStarted).state
        let (_, action) = guideAudioStep(state: state, event: .routeChanged)
        #expect(action == .rebuild(.playback))
    }

    @Test("세션 밖 인터럽션 종료는 .ambient를 되살린다")
    func interruptionOutsideSession() {
        let (_, action) = guideAudioStep(state: .initial, event: .interrupted)
        #expect(action == .apply(.ambient))
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd ios/GildongmuKit && swift test --filter GuideAudioSessionTests`
Expected: 컴파일 실패(`guideAudioStep` 미정의).

- [ ] **Step 3: 구현**

`ios/GildongmuKit/Sources/GildongmuKit/GuideAudioSession.swift`:

```swift
import Foundation

/// 안내 톤 오디오 세션의 **소유권 판정**(순수 함수). AVAudioSession 호출은 앱이 한다.
///
/// 세션은 프로세스 전역 자원이고 소비자가 셋(안내 톤·TTS `.playback`·받아쓰기
/// `.playAndRecord`)이다. "시작하면 승격, 끝나면 원복"만으로는 다른 소비자의
/// 카테고리를 파괴하므로 세 값을 든다: 원하는 카테고리(`desired`), 우리가 실제로
/// 승격했는가(`didPromote` = 원복 자격), 다른 소비자가 점유 중인가(`isSuppressed`).
///
/// **재조정(reconcile)이 이 모델의 심장이다.** suppression 해제·인터럽션 종료·route
/// 변경이 전부 같은 경로로 모이므로 "인터럽션 종료가 suppression 중에 도착해 영영
/// 복구 못 함"이 성립하지 않는다.

public enum GuideAudioCategory: Sendable, Equatable {
    /// 세션 밖 기본값. 정의상 백그라운드에서 무음이다.
    case ambient
    /// 안내 세션 중. 잠금·백그라운드에서도 소리가 나고 무음 스위치를 무시한다.
    case playback
}

public enum GuideAudioEvent: Sendable, Equatable {
    case sessionStarted
    case sessionEnded
    /// 다른 소비자(받아쓰기·TTS)의 점유 여부 변화.
    case suppressionChanged(Bool)
    /// 인터럽션 종료(전화 등). 세션이 멎었으므로 되살려야 한다.
    case interrupted
    /// 출력 route 변경·media services reset. 플레이어 재생성이 필요하다.
    case routeChanged
}

public enum GuideAudioAction: Sendable, Equatable {
    case none
    /// 카테고리를 설정하고 활성화한다.
    case apply(GuideAudioCategory)
    /// 카테고리 적용 + **플레이어 재생성**(route 변경·media reset).
    case rebuild(GuideAudioCategory)
}

public struct GuideAudioSessionState: Sendable, Equatable {
    public var desired: GuideAudioCategory
    /// 우리가 `.playback`을 실제로 적용했는가. 원복 자격이다.
    public var didPromote: Bool
    public var isSuppressed: Bool

    public static let initial = GuideAudioSessionState(
        desired: .ambient, didPromote: false, isSuppressed: false
    )
}

public func guideAudioStep(
    state: GuideAudioSessionState,
    event: GuideAudioEvent
) -> (state: GuideAudioSessionState, action: GuideAudioAction) {
    var next = state

    switch event {
    case .sessionStarted:
        next.desired = .playback
        return reconcile(next, rebuild: false)

    case .sessionEnded:
        next.desired = .ambient
        // 우리가 승격하지 않았다면 다른 소비자가 잡은 카테고리다 — 건드리지 않는다.
        guard state.didPromote else { return (next, .none) }
        next.didPromote = false
        guard !next.isSuppressed else { return (next, .none) }
        return (next, .apply(.ambient))

    case let .suppressionChanged(suppressed):
        next.isSuppressed = suppressed
        // 억제 진입은 아무것도 하지 않는다. 점유자의 카테고리를 되돌리면 그쪽이 깨진다.
        guard !suppressed else { return (next, .none) }
        return reconcile(next, rebuild: false)

    case .interrupted:
        guard !next.isSuppressed else { return (next, .none) }
        return reconcile(next, rebuild: false)

    case .routeChanged:
        guard !next.isSuppressed else { return (next, .none) }
        return reconcile(next, rebuild: true)
    }
}

/// 저장된 의도를 지금 적용한다. 억제 중이면 의도만 남기고 나중에 다시 지난다.
private func reconcile(
    _ state: GuideAudioSessionState, rebuild: Bool
) -> (state: GuideAudioSessionState, action: GuideAudioAction) {
    var next = state
    guard !next.isSuppressed else { return (next, .none) }
    if next.desired == .playback { next.didPromote = true }
    return (next, rebuild ? .rebuild(next.desired) : .apply(next.desired))
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd ios/GildongmuKit && swift test --filter GuideAudioSessionTests`
Expected: 8 tests PASS.

- [ ] **Step 5: 커밋**

```bash
git commit -- ios/GildongmuKit/Sources/GildongmuKit/GuideAudioSession.swift \
  ios/GildongmuKit/Tests/GildongmuKitTests/GuideAudioSessionTests.swift \
  -m "feat(guide): 오디오 세션 소유권 판정을 Kit 순수 함수로

세션은 프로세스 전역 자원이라 무조건 원복하면 받아쓰기·TTS를 깬다. desired·
didPromote·isSuppressed 세 값과 단일 재조정 경로로 '억제 중 시작 → 해제 시 승격'과
'인터럽션 종료가 억제 중 도착'을 함께 닫는다."
```

### Task 3: 백그라운드 오디오 모드 선언

**Files:**
- Modify: `ios/Support/Info-Experimental.plist`

**Interfaces:**
- Consumes: 없음
- Produces: Experimental 산출물의 `UIBackgroundModes = ["location", "audio"]`

**설계 근거:** 앱을 깨어 있게 유지하는 것은 여전히 `location` 모드다. `audio`는 **재생 허용**만 담당한다. Release plist에 넣지 않는 이유는 실시간 안내 자체가 `#if EXPERIMENTAL` 게이트라 공식판에는 기능이 없기 때문이다. ⚠ `INFOPLIST_KEY_UIBackgroundModes` 빌드 설정은 존재하지 않아 조용히 무시되고, `experimental-infoplist.sh` 후처리는 `ProcessInfoPlistFile`이 뒤에서 덮어쓴다(둘 다 산출물 실측 2026-08-06). 비로컬라이즈 키의 정본은 구성별 `INFOPLIST_FILE` 분기뿐이다.

- [ ] **Step 1: plist 수정**

`ios/Support/Info-Experimental.plist`의 `UIBackgroundModes` 배열에 `audio`를 추가한다:

```xml
	<key>UIBackgroundModes</key>
	<array>
		<string>location</string>
		<string>audio</string>
	</array>
```

같은 파일 상단 주석에 다음을 추가한다(공통 항목 수동 동기화 주석 옆):

```
    audio: 안내 톤의 잠금·백그라운드 재생 허용(2026-08-08). location이 앱을 깨어
    있게 하고 audio는 재생만 허용한다. ⚠ 플래그 졸업 시 Release plist로 옮길 때는
    심사 노트에 용도(시각장애 사용자를 위한 내비게이션 오디오 신호)를 명시해야 한다.
```

- [ ] **Step 2: 두 구성 산출물 검증**

```bash
cd /Users/hunyongkim/Mac-Projects/gildongmu/ios
xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -configuration Experimental \
  -sdk iphonesimulator -derivedDataPath /tmp/gd-exp build 2>&1 | tail -3
/usr/libexec/PlistBuddy -c "Print :UIBackgroundModes" \
  /tmp/gd-exp/Build/Products/Experimental-iphonesimulator/*.app/Info.plist
```

Expected: `location`과 `audio` 두 원소.

```bash
xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -configuration Release \
  -sdk iphonesimulator -derivedDataPath /tmp/gd-rel build 2>&1 | tail -3
/usr/libexec/PlistBuddy -c "Print :UIBackgroundModes" \
  /tmp/gd-rel/Build/Products/Release-iphonesimulator/*.app/Info.plist
```

Expected: `Print: Entry, ":UIBackgroundModes", Does Not Exist`(키 부재가 정답).

- [ ] **Step 3: 커밋**

```bash
git commit -- ios/Support/Info-Experimental.plist \
  -m "feat(ios): 실험판에 백그라운드 오디오 모드 선언

location이 앱을 깨우고 audio가 재생을 허용한다. 두 구성 산출물로 검증(Experimental
2원소·Release 키 부재). 공식판은 기능 자체가 EXPERIMENTAL 게이트라 미선언."
```

### Task 4: `BeaconTonePlayer` 세션 상태 머신·선점 재생

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconTonePlayer.swift`
- Modify: `messages/{ko,en,es,fr,it,ja}.json`
- Modify: `ios/Gildongmu/Resources/Localizable.xcstrings`

**Interfaces:**
- Consumes: `guideAudioStep`, `GuideAudioSessionState`, `GuideAudioAction`(Task 2)
- Produces: `BeaconTonePlayer.beginSession()`, `.endSession()`, `.isDegraded`(승격 실패 노출)

**설계 근거:** 승격 실패를 알리지 않으면 사용자는 정상 시작으로 믿고 잠근 뒤 무음을 만난다. 전경에서 `start` 톤은 `.ambient`로도 들리기 때문에 실패가 보이지 않는다(spec §3.2). 또 톤은 전부 1초 미만이라 겹치면 두 소리가 섞여 어느 쪽도 식별되지 않으므로 **재생 중 새 요청은 기존 재생을 중단하고 교체**한다(§4.4).

- [ ] **Step 1: i18n 문구 추가**

`messages/ko.json`의 `ios.beacon` 그룹(없으면 `beacon` 그룹)에 추가:

```json
"soundBackgroundUnavailable": "잠금 화면에서는 안내 소리가 나지 않습니다."
```

6로케일 전부에 같은 키를 넣는다(en: `"Guide sounds will not play while the screen is locked."`, es: `"Los sonidos de la guía no sonarán con la pantalla bloqueada."`, fr: `"Les sons du guidage ne seront pas audibles écran verrouillé."`, it: `"I suoni della guida non verranno riprodotti a schermo bloccato."`, ja: `"画面がロックされている間は案内音が鳴りません。"`).

⚠ 이 문구는 `ios.beacon.soundUnavailable`(재생기 사망)과 **다른 상태**다. 전자는 "잠그면 안 들림", 후자는 "지금도 안 들림"이라 사용자가 취할 행동이 다르다.

`ios/Gildongmu/Resources/Localizable.xcstrings`는 웹 messages에서 결정론 변환으로 생성되므로 변환 스크립트를 돌린다(`ios/scripts/` 아래 생성기 — 수기 편집 금지, 다음 재생성이 조용히 삭제한다).

- [ ] **Step 2: 세션 상태 머신 배선**

`BeaconTonePlayer.swift`에서 `ensureSession()`을 상태 머신 소비로 교체한다. 기존 `sessionReady` 불리언은 제거하고 다음을 추가한다:

```swift
    /// 오디오 세션 소유권(판정은 Kit `guideAudioStep`, 여기는 적용만).
    private var audio = GuideAudioSessionState.initial
    /// 승격에 실패해 잠금 중 무음이 예상되는 상태. 호출부가 통지 대상으로 삼는다.
    private(set) var isDegraded = false
    /// 현재 적용된 카테고리. 미적용(nil)이면 첫 재생 때 적용한다.
    private var appliedCategory: GuideAudioCategory?
```

`isSuppressed`는 상태 머신으로 흡수한다:

```swift
    var isSuppressed: Bool {
        get { audio.isSuppressed }
        set { dispatch(.suppressionChanged(newValue)) }
    }
```

세션 경계 API:

```swift
    /// 안내 세션 시작 — 오디오 카테고리를 `.playback`으로 승격한다.
    /// ⚠ 톤 재생 전에 불러야 한다(승격 실패를 시작 시점에 알려야 하므로).
    func beginSession() {
        isDegraded = false
        dispatch(.sessionStarted)
    }

    /// 안내 세션 종료 — 우리가 승격했을 때만 `.ambient`로 원복한다.
    func endSession() {
        dispatch(.sessionEnded)
        isDegraded = false
    }
```

디스패치·적용:

```swift
    private func dispatch(_ event: GuideAudioEvent) {
        let out = guideAudioStep(state: audio, event: event)
        audio = out.state
        switch out.action {
        case .none:
            break
        case let .apply(category):
            apply(category, rebuildPlayers: false)
        case let .rebuild(category):
            apply(category, rebuildPlayers: true)
        }
    }

    /// 카테고리 적용. 실패는 **삼키지 않는다** — 전경에서는 `.ambient`로도 톤이
    /// 들리므로, 조용히 넘기면 사용자가 정상으로 믿고 잠근 뒤 무음을 만난다.
    private func apply(_ category: GuideAudioCategory, rebuildPlayers: Bool) {
        if rebuildPlayers {
            for player in players.values { player.stop() }
            players = [:]
            playing = nil
        }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                category == .playback ? .playback : .ambient,
                options: [.mixWithOthers]
            )
            try session.setActive(true)
            appliedCategory = category
            isSilenced = false
            // 승격을 원했는데 성사된 경우에만 degraded 해제.
            if category == .playback { isDegraded = false }
        } catch {
            appliedCategory = nil
            if category == .playback {
                // 세션은 계속한다(전경 톤은 `.ambient`로도 난다). 잠금 시 무음만 예고.
                isDegraded = true
            } else {
                isSilenced = true
            }
        }
    }
```

`play(_:)` 앞부분의 `guard ensureSession() else { return }`를 다음으로 교체한다:

```swift
        // 세션이 아직 적용되지 않았으면 지금 적용한다(세션 밖 단발 재생 경로).
        if appliedCategory == nil { dispatch(.interrupted) }
```

⚠ `.interrupted`를 쓰는 것은 그것이 "지금 저장된 의도를 적용하라"는 재조정 이벤트이기 때문이다(이름은 인터럽션이지만 동작은 재조정). 세션 밖이면 `desired == .ambient`라 기존 동작과 같다.

- [ ] **Step 3: 재생 선점**

`players` 옆에 추가:

```swift
    /// 현재 재생 중인 톤. 톤은 전부 1초 미만이라 겹치면 두 소리가 섞여 어느 쪽도
    /// 식별되지 않는다 — 새 요청은 기존 재생을 끊고 교체한다(spec §4.4).
    private var playing: AVAudioPlayer?
```

`play(_:)`의 재생 직전에:

```swift
        if let current = playing, current !== player, current.isPlaying { current.stop() }
        player.currentTime = 0
        if player.play() {
            isSilenced = false
            playing = player
        } else {
            isSilenced = true
            playing = nil
        }
```

- [ ] **Step 4: 게인 등록 + 옵서버 확장**

`gains`에 추가(값 변경 시 웹 `useBeaconSound.ts`와 동조):

```swift
        .unreliable: 0.45,
```

⚠ `tick`(0.3)보다 높다. 신뢰 불가는 상태 경고라 배경 미디어 위에서 묻히면 안 된다(spec §10.2).

`observeInterruptions()`에 route 변경·media reset 옵서버를 추가한다:

```swift
        for name in [
            AVAudioSession.routeChangeNotification,
            AVAudioSession.mediaServicesWereResetNotification,
        ] {
            observers.append(
                NotificationCenter.default.addObserver(
                    forName: name, object: nil, queue: .main
                ) { [weak self] _ in
                    MainActor.assumeIsolated {
                        self?.dispatch(.routeChanged)
                    }
                }
            )
        }
```

기존 인터럽션 옵서버의 본문에서 `self.sessionReady = false; _ = self.ensureSession()`을 `self.dispatch(.interrupted)`로 교체한다(`isSuppressed` 가드는 상태 머신이 이미 소유하므로 제거).

`shutdown()`에서 `sessionReady = false`를 `appliedCategory = nil`·`playing = nil`로 교체한다.

- [ ] **Step 5: 빌드 확인**

Run: `cd ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -configuration Experimental -sdk iphonesimulator -derivedDataPath /tmp/gd-exp build 2>&1 | tail -5`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 6: 커밋**

```bash
git commit -- ios/Gildongmu/Directions/BeaconTonePlayer.swift messages/ko.json messages/en.json \
  messages/es.json messages/fr.json messages/it.json messages/ja.json \
  ios/Gildongmu/Resources/Localizable.xcstrings \
  -m "feat(ios): 안내 세션 중 오디오를 .playback으로 승격

잠금·백그라운드 무음의 원인이 .ambient 카테고리였다. 세션 경계에서만 승격하고
원복 자격(didPromote)을 지켜 받아쓰기·TTS를 깨지 않는다. 승격 실패는 전경에서
정상으로 보이므로 degraded로 노출한다. 톤 겹침은 선점으로 차단."
```

### Task 5: 음성 억제 게이트와 전경 복귀 재동기화

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`

**Interfaces:**
- Consumes: `BeaconTonePlayer.beginSession/endSession/isDegraded`(Task 4)
- Produces: `BeaconModel.handleScenePhaseChange`가 `isForeground`를 갱신, `announce()`가 그 게이트를 지남

**설계 근거:** 백그라운드에서 announcement가 발화되지 않는 것은 실측으로 확인했으나 **한 차례 실측은 API 계약이 아니다**(spec §3.1). OS 버전·VoiceOver 상태에 따라 무시·지연 전달·복귀 후 뒤늦은 발화가 가능하므로 플랫폼 동작에 의존하지 않는다. 게이트 기준은 `.active`이며 `.inactive`(제어센터·알림 센터)에서는 **발화를 허용한다** — 그 상태는 사용자가 화면을 보고 있는 중이다.

- [ ] **Step 1: 상태 추가**

```swift
    /// 앱이 전경 활성 상태인가. 음성 통지 게이트(spec §3.1) — 백그라운드에서 톤은
    /// 남기고 발화만 막는다. `.inactive`(제어센터·알림 센터)는 사용자가 화면을 보고
    /// 있는 중이라 허용한다.
    private var isForeground = true
    /// 백그라운드에서 억제된 발화가 있었는가. 복귀 시 **현재 상태 하나만** 낭독한다
    /// (누적 재생은 낡은 정보를 순서대로 읽어 혼란만 준다, spec §6.5).
    private var missedAnnouncement = false
```

- [ ] **Step 2: `announce`에 게이트 적용**

```swift
    private func announce(_ message: String, highPriority: Bool = false) {
        guard !outputSuppressed else { return }
        // 백그라운드에서는 발화만 막는다. statusText·lastGuidance는 호출부에서 이미
        // 갱신됐으므로 복귀 시 화면이 최신이다(spec §3.1 상태·발화 분리).
        guard isForeground else {
            missedAnnouncement = true
            return
        }
        var attributed = AttributedString(spokenUnits(message))
        if highPriority { attributed.accessibilitySpeechAnnouncementPriority = .high }
        AccessibilityNotification.Announcement(attributed).post()
    }
```

- [ ] **Step 3: scenePhase 배선**

`handleScenePhaseChange(to:)`의 각 분기에 추가한다:

```swift
        case .background:
            isForeground = false
            wasBackgrounded = true
            UIApplication.shared.isIdleTimerDisabled = false
        case .inactive:
            // 제어센터·알림 센터. 화면을 보고 있으므로 발화를 막지 않는다.
            isForeground = true
        case .active:
            isForeground = true
            guard isTracking else { return }
            UIApplication.shared.isIdleTimerDisabled = true
            // 억제된 동안 상태가 여러 번 바뀌었을 수 있다 — 현재 상태 하나만 낭독한다.
            if missedAnnouncement {
                missedAnnouncement = false
                if !statusText.isEmpty { announce(statusText) }
            }
            guard wasBackgrounded else { return }
            ...
```

⚠ `default:`로 뭉쳐 있던 `.inactive`를 명시 분기로 꺼낸다. 기존 `default: break`는 유지한다(미래 케이스 대비).

- [ ] **Step 4: 세션 경계에 오디오 승격 배선**

`start()`의 `playTone(.start)` **앞에**:

```swift
        tones.beginSession()
        if tones.isDegraded {
            // 전경에서 start 톤은 .ambient로도 들린다 — 알리지 않으면 사용자가
            // 정상으로 믿고 잠근 뒤 무음을 만난다(spec §3.2).
            let text = appLocalized("ios.beacon.soundBackgroundUnavailable")
            statusText = text
            announce(text)
        }
```

`stop()`의 `if playStopTone && status == .tracking { playTone(.stop) }` **뒤에**:

```swift
        tones.endSession()
```

⚠ 순서가 중요하다. 원복을 먼저 하면 정지 톤이 `.ambient`로 나가고, 잠금 상태에서 세션을 끝내면 그 톤이 들리지 않는다.

- [ ] **Step 5: 빌드 확인**

Run: `cd ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -configuration Experimental -sdk iphonesimulator -derivedDataPath /tmp/gd-exp build 2>&1 | tail -5`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 6: 커밋**

```bash
git commit -- ios/Gildongmu/Directions/BeaconModel.swift \
  -m "feat(ios): 백그라운드 음성 억제를 명시 게이트로

주기적 음성은 다른 앱 사용을 침해한다(위원장 결정). 한 차례 실측은 API 계약이
아니므로 플랫폼 동작에 기대지 않고 scenePhase로 막는다. 상태 텍스트는 계속 갱신해
복귀 시 화면이 최신이고, 복귀 발화는 누적이 아니라 현재 상태 하나다."
```

---

## M2: 판정 코어 (Kit + 웹 미러)

### Task 6: `trendStep` 추출

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/Beacon.swift`
- Modify: `src/lib/beacon.ts`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/BeaconTests.swift`(추가), `src/lib/__tests__/beacon.test.ts`(추가)

**Interfaces:**
- Produces:
  - Swift: `public func trendStep(anchor: Double?, trend: BeaconTrend, distance: Double, deadBand: Double) -> (kind: TrendKind, anchor: Double?, trend: BeaconTrend)`, `public enum TrendKind { case closer, farther, hold }`
  - TS: `export function trendStep(anchor: number | null, trend: Trend, distance: number, deadBand: number): { kind: TrendKind; anchor: number | null; trend: Trend }`, `export type TrendKind = "closer" | "farther" | "hold"`

**설계 근거:** `beaconStep` **전체** 재사용은 폐기됐다(spec §4.3). 그 리듀서는 추세 판정 외에 도착 판정(`arrivalThreshold`)·`weak` 게이트(100m)·음성 마일스톤을 함께 소유하는데 셋 다 상세 모드와 충돌한다(잔여 40m+accuracy 50m면 beacon이 먼저 도착을 선언해 남은 결정 지점을 삼키고, 75m fix가 한쪽은 불확실 한쪽은 유효가 된다). **추세 판정만** 빼낸다.

⚠ 이 태스크는 **동작을 바꾸지 않는다.** 기존 `beaconStep` 테스트가 전부 green으로 남아야 한다.

- [ ] **Step 1: 실패 테스트 작성(Swift)**

`BeaconTests.swift`에 추가:

```swift
@Suite("추세 판정 추출")
struct TrendStepTests {
    @Test("앵커가 없으면 현재 거리를 앵커로 잡고 hold")
    func firstCall() {
        let r = trendStep(anchor: nil, trend: .none, distance: 100, deadBand: 15)
        #expect(r.kind == .hold)
        #expect(r.anchor == 100)
        #expect(r.trend == .none)
    }

    @Test("데드밴드를 넘어 줄면 closer이고 앵커가 전진한다")
    func closerAdvancesAnchor() {
        let r = trendStep(anchor: 100, trend: .none, distance: 84, deadBand: 15)
        #expect(r.kind == .closer)
        #expect(r.anchor == 84)
        #expect(r.trend == .closer)
    }

    @Test("데드밴드를 넘어 늘면 farther")
    func farther() {
        let r = trendStep(anchor: 100, trend: .closer, distance: 116, deadBand: 15)
        #expect(r.kind == .farther)
        #expect(r.trend == .farther)
    }

    @Test("데드밴드 안이면 hold이고 앵커·추세가 불변이다")
    func holdKeepsAnchor() {
        let r = trendStep(anchor: 100, trend: .closer, distance: 90, deadBand: 15)
        #expect(r.kind == .hold)
        #expect(r.anchor == 100)
        #expect(r.trend == .closer)
    }

    @Test("경계값은 포함이다(정확히 데드밴드만큼 줄면 closer)")
    func boundaryInclusive() {
        #expect(trendStep(anchor: 100, trend: .none, distance: 85, deadBand: 15).kind == .closer)
        #expect(trendStep(anchor: 100, trend: .none, distance: 115, deadBand: 15).kind == .farther)
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd ios/GildongmuKit && swift test --filter TrendStepTests`
Expected: 컴파일 실패.

- [ ] **Step 3: Swift 구현**

`Beacon.swift`에 추가하고 `beaconStep`의 추세 블록을 이 함수 호출로 치환한다:

```swift
public enum TrendKind: Sendable, Equatable {
    case closer, farther, hold
}

/// 데드밴드 기준 추세 판정(순수, 상태 미커밋). 간략(직선거리)과 상세(경로 잔여
/// 거리)가 **같은 판정을 공유하는 유일한 지점**이다(spec §4.3 — 리듀서 전체 재사용은
/// 도착 판정·정확도 게이트·음성 마일스톤까지 딸려와 상세와 충돌해 폐기됐다).
///
/// 호출부가 결과를 채택할지 결정한다. 앵커·추세는 반환값일 뿐 여기서 저장하지 않는다.
public func trendStep(
    anchor: Double?,
    trend: BeaconTrend,
    distance: Double,
    deadBand: Double
) -> (kind: TrendKind, anchor: Double?, trend: BeaconTrend) {
    guard let anchor else { return (.hold, distance, trend) }
    if distance <= anchor - deadBand { return (.closer, distance, .closer) }
    if distance >= anchor + deadBand { return (.farther, distance, .farther) }
    return (.hold, anchor, trend)
}
```

`beaconStep`의 기존 추세 블록(`if distance <= anchor - deadBand { ... } else if ... }`)을 다음으로 교체한다:

```swift
    let t = trendStep(anchor: anchor, trend: state.trend, distance: distance, deadBand: deadBand)
    let trend = t.trend
    let newAnchor = t.anchor ?? anchor
    let kind: AnnounceKind = switch t.kind {
    case .closer: .closer
    case .farther: .farther
    case .hold: .hold
    }
```

- [ ] **Step 4: 테스트 통과 + 기존 회귀 확인**

Run: `cd ios/GildongmuKit && swift test`
Expected: 신규 5 PASS + 기존 `BeaconTests`·`BeaconGateTests` 전량 PASS(동작 불변).

- [ ] **Step 5: 웹 미러**

`src/lib/beacon.ts`에 같은 함수를 추가하고 `beaconStep`을 동일하게 치환한다:

```typescript
export type TrendKind = "closer" | "farther" | "hold";

/**
 * 데드밴드 기준 추세 판정(순수, 상태 미커밋). Kit `trendStep` 미러.
 * 간략(직선거리)과 상세(경로 잔여 거리)가 같은 판정을 공유하는 유일한 지점이다.
 * 호출부가 결과를 채택할지 결정한다.
 */
export function trendStep(
  anchor: number | null,
  trend: Trend,
  distance: number,
  deadBand: number,
): { kind: TrendKind; anchor: number | null; trend: Trend } {
  if (anchor === null) return { kind: "hold", anchor: distance, trend };
  if (distance <= anchor - deadBand) return { kind: "closer", anchor: distance, trend: "closer" };
  if (distance >= anchor + deadBand) return { kind: "farther", anchor: distance, trend: "farther" };
  return { kind: "hold", anchor, trend };
}
```

`src/lib/__tests__/beacon.test.ts`에 Swift와 같은 5케이스를 추가한다:

```typescript
describe("trendStep 추출", () => {
  it("앵커가 없으면 현재 거리를 앵커로 잡고 hold", () => {
    expect(trendStep(null, "none", 100, 15)).toEqual({
      kind: "hold", anchor: 100, trend: "none",
    });
  });
  it("데드밴드를 넘어 줄면 closer이고 앵커가 전진한다", () => {
    expect(trendStep(100, "none", 84, 15)).toEqual({
      kind: "closer", anchor: 84, trend: "closer",
    });
  });
  it("데드밴드를 넘어 늘면 farther", () => {
    expect(trendStep(100, "closer", 116, 15).kind).toBe("farther");
  });
  it("데드밴드 안이면 앵커·추세가 불변이다", () => {
    expect(trendStep(100, "closer", 90, 15)).toEqual({
      kind: "hold", anchor: 100, trend: "closer",
    });
  });
  it("경계값은 포함이다", () => {
    expect(trendStep(100, "none", 85, 15).kind).toBe("closer");
    expect(trendStep(100, "none", 115, 15).kind).toBe("farther");
  });
});
```

- [ ] **Step 6: 웹 테스트**

Run: `npm run test:run -- beacon`
Expected: 전량 PASS(기존 케이스 포함).

- [ ] **Step 7: 커밋**

```bash
git commit -- ios/GildongmuKit/Sources/GildongmuKit/Beacon.swift \
  ios/GildongmuKit/Tests/GildongmuKitTests/BeaconTests.swift \
  src/lib/beacon.ts src/lib/__tests__/beacon.test.ts \
  -m "refactor(guide): 추세 판정만 trendStep으로 추출

리듀서 전체 재사용은 도착 판정·100m 정확도 게이트·음성 마일스톤까지 딸려와
상세 모드와 충돌한다(잔여 40m+accuracy 50m면 비콘이 먼저 도착을 선언). 두 모드가
공유할 축은 데드밴드 추세 판정 하나뿐이다. 동작 불변."
```

### Task 7: 3-state 정지 판정

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/GuideMotion.swift`
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/GuideMotionTests.swift`
- Create: `src/lib/guide-motion.ts`
- Create: `src/lib/__tests__/guide-motion.test.ts`

**Interfaces:**
- Produces:
  - Swift: `MotionState`(`.stopped`/`.moving`/`.speedUnknown`), `MotionSample`, `MotionJudgeState`, `MotionConstants`, `motionStep(state:sample:speed:speedAccuracy:maxSpeedMps:) -> (state, MotionState)`
  - TS: 동일 이름의 미러(`motionStep`, `MotionState = "stopped" | "moving" | "speedUnknown"`)

**설계 근거:** 현행 `hold`는 "정지"가 아니라 **"아직 데드밴드를 못 넘음"**이라 도보(1.4m/s)에서 15m를 넘는 데 약 11초가 걸려 closer 1회당 tick 3~4회가 난다. 같은 소리가 수단에 따라 정반대 빈도가 되는 것이 부채의 정체다(spec §5.1). 정지·이동 이진화는 3-state 불변식 위반이므로 "속도를 모름"을 별도 상태로 둔다. **도플러 속도가 경로와 목적지 양쪽에 독립이라 두 모드에 같은 판정을 쓸 수 있는 유일한 축이다**(직선거리 미분은 "목적지 접근 속도"이지 "이동 속도"가 아니라서 목적지를 옆으로 지나쳐 걸으면 정지로 보인다).

⚠ **임계값은 위원장 판정으로 확정됐다**(비장애 보행 속도의 90% 기준: 평상 1.17m/s·느린 구간 0.7m/s에서 도출). 재계산하지 말 것. 초판이 쓴 "보행 최저 0.8~1.0m/s"는 비장애 평균을 최저값으로 잘못 옮긴 것이었고 흰지팡이 탐색 보행을 정지로 오판했을 값이다.

- [ ] **Step 1: 실패 테스트 작성(Swift)**

`ios/GildongmuKit/Tests/GildongmuKitTests/GuideMotionTests.swift`:

```swift
import Testing
@testable import GildongmuKit

@Suite("3-state 정지 판정")
struct GuideMotionTests {
    private func sample(_ at: Double, lat: Double = 37.5, lng: Double = 127.0, acc: Double = 10)
        -> MotionSample {
        MotionSample(lat: lat, lng: lng, accuracy: acc, at: at)
    }

    @Test("도플러 속도가 신뢰 조건을 만족하면 그 값을 쓴다")
    func dopplerAccepted() {
        let (_, motion) = motionStep(
            state: .initial, sample: sample(0), speed: 1.5, speedAccuracy: 0.5, maxSpeedMps: 8
        )
        #expect(motion == .moving)
    }

    @Test("speedAccuracy가 상한을 넘으면 그 speed는 근거가 못 된다")
    func speedAccuracyCeiling() {
        // speed 0.2는 정지처럼 보이지만 정확도가 나쁘면 판정 근거가 아니다.
        let (_, motion) = motionStep(
            state: .initial, sample: sample(0), speed: 0.2, speedAccuracy: 5, maxSpeedMps: 8
        )
        #expect(motion == .speedUnknown)
    }

    @Test("음수 speed는 무효 신호다")
    func negativeSpeed() {
        let (_, motion) = motionStep(
            state: .initial, sample: sample(0), speed: -1, speedAccuracy: 0.5, maxSpeedMps: 8
        )
        #expect(motion == .speedUnknown)
    }

    @Test("정지 진입은 유지 시간을 채워야 성립한다")
    func stopEnterRequiresHold() {
        var state = MotionJudgeState.initial
        var out = motionStep(
            state: state, sample: sample(0), speed: 0.1, speedAccuracy: 0.3, maxSpeedMps: 8
        )
        state = out.state
        #expect(out.motion == .moving)  // 아직 2초를 못 채웠다

        out = motionStep(
            state: state, sample: sample(1.5), speed: 0.1, speedAccuracy: 0.3, maxSpeedMps: 8
        )
        state = out.state
        #expect(out.motion == .moving)

        out = motionStep(
            state: state, sample: sample(2.1), speed: 0.1, speedAccuracy: 0.3, maxSpeedMps: 8
        )
        #expect(out.motion == .stopped)
    }

    @Test("이탈은 즉시다(비대칭이 의도)")
    func stopExitImmediate() {
        var state = MotionJudgeState.initial
        for t in [0.0, 2.5] {
            state = motionStep(
                state: state, sample: sample(t), speed: 0.1, speedAccuracy: 0.3, maxSpeedMps: 8
            ).state
        }
        let (_, motion) = motionStep(
            state: state, sample: sample(3.0), speed: 0.7, speedAccuracy: 0.3, maxSpeedMps: 8
        )
        #expect(motion == .moving)
    }

    @Test("히스테리시스 구간(0.4~0.6)에서는 직전 상태를 유지한다")
    func hysteresisBand() {
        var state = MotionJudgeState.initial
        for t in [0.0, 2.5] {
            state = motionStep(
                state: state, sample: sample(t), speed: 0.1, speedAccuracy: 0.3, maxSpeedMps: 8
            ).state
        }
        // 0.5는 진입선(0.4)보다 크고 이탈선(0.6)보다 작다 — 정지 유지.
        let (_, motion) = motionStep(
            state: state, sample: sample(3.0), speed: 0.5, speedAccuracy: 0.3, maxSpeedMps: 8
        )
        #expect(motion == .stopped)
    }

    @Test("도플러가 없으면 거리 미분 폴백을 쓴다")
    func distanceFallback() {
        var state = MotionJudgeState.initial
        state = motionStep(
            state: state, sample: sample(0, lat: 37.5000), speed: nil, speedAccuracy: nil,
            maxSpeedMps: 8
        ).state
        // 약 22m 북쪽으로 2초 = 11m/s → 물리 상한(8) 초과라 폐기.
        let tooFast = motionStep(
            state: state, sample: sample(2, lat: 37.50020), speed: nil, speedAccuracy: nil,
            maxSpeedMps: 8
        )
        #expect(tooFast.motion == .speedUnknown)

        // 약 2.2m를 2초 = 1.1m/s → 유효.
        let ok = motionStep(
            state: state, sample: sample(2, lat: 37.50002), speed: nil, speedAccuracy: nil,
            maxSpeedMps: 8
        )
        #expect(ok.motion == .moving)
    }

    @Test("폴백은 간격이 너무 짧거나 길면 쓰지 않는다")
    func fallbackIntervalBounds() {
        var state = MotionJudgeState.initial
        state = motionStep(
            state: state, sample: sample(0), speed: nil, speedAccuracy: nil, maxSpeedMps: 8
        ).state
        // 0.5초: GPS 지터가 속도로 증폭된다.
        #expect(
            motionStep(
                state: state, sample: sample(0.5, lat: 37.50002), speed: nil, speedAccuracy: nil,
                maxSpeedMps: 8
            ).motion == .speedUnknown
        )
        // 7초: 실제 이동이 평균화되어 정지로 보인다.
        #expect(
            motionStep(
                state: state, sample: sample(7, lat: 37.50002), speed: nil, speedAccuracy: nil,
                maxSpeedMps: 8
            ).motion == .speedUnknown
        )
    }

    @Test("폴백은 두 fix 정확도가 20m를 넘으면 쓰지 않는다")
    func fallbackAccuracyBound() {
        var state = MotionJudgeState.initial
        state = motionStep(
            state: state, sample: sample(0, acc: 35), speed: nil, speedAccuracy: nil, maxSpeedMps: 8
        ).state
        #expect(
            motionStep(
                state: state, sample: sample(2, lat: 37.50002, acc: 10), speed: nil,
                speedAccuracy: nil, maxSpeedMps: 8
            ).motion == .speedUnknown
        )
    }

    @Test("속도를 모르면 정지 계측이 초기화된다")
    func unknownResetsStopTimer() {
        var state = MotionJudgeState.initial
        state = motionStep(
            state: state, sample: sample(0), speed: 0.1, speedAccuracy: 0.3, maxSpeedMps: 8
        ).state
        // 계측 중 unknown이 끼어들면 처음부터 다시 세야 한다(모르는 구간을 정지로
        // 셈하면 그 사이 이동을 정지로 오판한다).
        state = motionStep(
            state: state, sample: sample(1), speed: nil, speedAccuracy: nil, maxSpeedMps: 8
        ).state
        let (_, motion) = motionStep(
            state: state, sample: sample(2.5), speed: 0.1, speedAccuracy: 0.3, maxSpeedMps: 8
        )
        #expect(motion == .moving)
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd ios/GildongmuKit && swift test --filter GuideMotionTests`
Expected: 컴파일 실패.

- [ ] **Step 3: Swift 구현**

`ios/GildongmuKit/Sources/GildongmuKit/GuideMotion.swift`:

```swift
import Foundation

/// 이동·정지 판정(순수 함수, 웹 `src/lib/guide-motion.ts` 미러).
///
/// **왜 3-state인가**: "속도를 모름"은 "정지"도 "이동"도 아니다. 이진화하면 GPS가
/// 속도를 못 줄 때 거짓 정지 tick이 나고, 시각장애 사용자는 화면으로 반증할 수 없다.
///
/// **왜 도플러 속도인가**: 상세 모드에는 경로 진행거리 미분(`GuideSpeedSample`)이
/// 있으나 간략 모드에는 경로가 없다. 직선거리 미분은 "목적지 접근 속도"이지 "이동
/// 속도"가 아니라서 목적지를 옆으로 지나쳐 걸으면 거의 안 변한다. 도플러는 경로와
/// 목적지 양쪽에 독립이라 두 모드에 같은 판정을 쓸 수 있는 유일한 축이다.
///
/// ⚠ 기존 속도 표본 기계(`speedGuardActive` 등)는 건드리지 않는다. 그것은 "속도
/// 빠름" 오판 가드라는 다른 목적을 가진다.

public enum MotionState: Sendable, Equatable {
    case stopped, moving, speedUnknown
}

public struct MotionSample: Sendable, Equatable {
    public var lat: Double
    public var lng: Double
    /// 수평 정확도(m). 음수는 좌표 무효 신호.
    public var accuracy: Double
    /// 단조 시각(초).
    public var at: Double

    public init(lat: Double, lng: Double, accuracy: Double, at: Double) {
        self.lat = lat
        self.lng = lng
        self.accuracy = accuracy
        self.at = at
    }
}

public struct MotionJudgeState: Sendable, Equatable {
    public var isStopped: Bool
    /// 정지 임계 미만이 시작된 시각. nil이면 계측 중이 아니다.
    public var belowSince: Double?
    public var lastSample: MotionSample?

    public static let initial = MotionJudgeState(
        isStopped: false, belowSince: nil, lastSample: nil
    )
}

public enum MotionConstants {
    /// 이 값 **미만**이 `stopEnterHoldSeconds` 이상 지속되면 정지 진입.
    /// 위원장 판정(2026-08-08): 비장애 보행의 90% 기준으로 도출한 느린 구간
    /// 0.7m/s의 57%. 정상 보행 중 가장 느린 구간보다 확실히 아래라 오판 여유가 있다.
    public static let stopEnterMps = 0.4
    /// 이 값 **초과**면 즉시 이동. 진입보다 높다 — 정지 오판은 계속 들리는 거짓
    /// tick을 만들고 이동 오판은 한 번의 침묵으로 끝난다(비대칭이 의도).
    public static let stopExitMps = 0.6
    /// 신호 대기 같은 실제 정지는 이 시간을 넘고, 보행 중 순간 감속은 넘지 않는다.
    public static let stopEnterHoldSeconds = 2.0
    /// `speedAccuracy` 신뢰 상한(m/s). ⚠ 음수 여부만으로 판정하지 않는다 —
    /// `speed = 0.2`인데 정확도가 매우 크면 그 값은 정지 근거가 못 된다.
    public static let speedAccuracyCeiling = 1.0
    /// 거리 미분 폴백의 최소 간격(초). 더 짧으면 GPS 지터가 속도로 증폭된다
    /// (40m 정확도 두 fix가 1초에 20m 흔들리면 20m/s).
    public static let fallbackMinIntervalSeconds = 1.0
    /// 최대 간격(초). 더 길면 실제 이동이 평균화되어 정지로 보인다.
    public static let fallbackMaxIntervalSeconds = 5.0
    /// 폴백에 쓸 수 있는 fix 정확도 상한(m).
    public static let fallbackMaxAccuracyMeters = 20.0
    /// 물리 상한(m/s) — 이를 넘는 산출 속도는 GPS 점프다.
    public static let maxWalkSpeedMps = 8.0
    public static let maxCarSpeedMps = 60.0
}

/// 한 fix의 이동 상태를 판정한다. `speed`·`speedAccuracy`는 없으면 nil
/// (웹 `GeolocationCoordinates.speed`가 무효일 때 `null`이라 Optional로 통일한다 —
/// `speed < 0` 분기를 그대로 옮기면 `null`이 0으로 암묵 변환되어 거짓 정지가 난다).
public func motionStep(
    state: MotionJudgeState,
    sample: MotionSample,
    speed: Double?,
    speedAccuracy: Double?,
    maxSpeedMps: Double
) -> (state: MotionJudgeState, motion: MotionState) {
    var next = state
    let velocity = resolveSpeed(
        state: state, sample: sample, speed: speed, speedAccuracy: speedAccuracy,
        maxSpeedMps: maxSpeedMps
    )
    next.lastSample = sample

    guard let v = velocity else {
        // 모르는 구간을 정지로 셈하면 그 사이 이동이 정지로 굳는다.
        next.belowSince = nil
        return (next, .speedUnknown)
    }

    if state.isStopped {
        if v > MotionConstants.stopExitMps {
            next.isStopped = false
            next.belowSince = nil
            return (next, .moving)
        }
        return (next, .stopped)
    }

    guard v < MotionConstants.stopEnterMps else {
        next.belowSince = nil
        return (next, .moving)
    }
    let since = state.belowSince ?? sample.at
    next.belowSince = since
    if sample.at - since >= MotionConstants.stopEnterHoldSeconds {
        next.isStopped = true
        return (next, .stopped)
    }
    return (next, .moving)
}

/// 채택할 속도(m/s). 도플러 우선, 조건 불충족 시 거리 미분 폴백, 둘 다 불가면 nil.
private func resolveSpeed(
    state: MotionJudgeState,
    sample: MotionSample,
    speed: Double?,
    speedAccuracy: Double?,
    maxSpeedMps: Double
) -> Double? {
    if let speed, speed >= 0, speed.isFinite,
       let acc = speedAccuracy, acc >= 0, acc <= MotionConstants.speedAccuracyCeiling {
        return speed
    }
    guard let prev = state.lastSample else { return nil }
    let dt = sample.at - prev.at
    guard dt >= MotionConstants.fallbackMinIntervalSeconds,
          dt <= MotionConstants.fallbackMaxIntervalSeconds,
          prev.accuracy > 0, prev.accuracy <= MotionConstants.fallbackMaxAccuracyMeters,
          sample.accuracy > 0, sample.accuracy <= MotionConstants.fallbackMaxAccuracyMeters
    else { return nil }
    let meters = haversineMeters(
        lat1: prev.lat, lng1: prev.lng, lat2: sample.lat, lng2: sample.lng
    )
    guard meters.isFinite else { return nil }
    let v = meters / dt
    guard v <= maxSpeedMps else { return nil }
    return v
}
```

- [ ] **Step 4: 테스트 통과**

Run: `cd ios/GildongmuKit && swift test --filter GuideMotionTests`
Expected: 10 tests PASS.

- [ ] **Step 5: 웹 미러 구현**

`src/lib/guide-motion.ts` — 위 Swift와 1:1 대응. 주석은 "Kit `GuideMotion.swift` 미러"로 시작하고 **웹 고유 주의**를 명시한다:

```typescript
/**
 * 이동·정지 판정(순수 함수). Kit `GuideMotion.swift` 미러 — 상수·경계·상태 전이가
 * 동일해야 한다(`guide-motion.test.ts`가 같은 케이스로 강제).
 *
 * ⚠ **웹의 속도 표현이 iOS와 다르다.** `GeolocationCoordinates.speed`는 무효일 때
 * `null`이고 음수 sentinel이 아니며, `speedAccuracy`에 해당하는 필드가 아예 없다.
 * `speed < 0` 분기를 그대로 옮기면 `null`이 암묵 변환으로 0이 되어 **거짓 정지
 * tick**이 난다. `null`·비유한값·필드 누락을 전부 `speedUnknown`으로 보내고,
 * 결과 상태(3-state)만 iOS와 동조시킨다. speedAccuracy가 없으므로 웹은 폴백 경로
 * 비중이 iOS보다 크다.
 */
import { haversineMeters } from "./geo";

export type MotionState = "stopped" | "moving" | "speedUnknown";

export interface MotionSample {
  lat: number;
  lng: number;
  accuracy: number;
  at: number;
}

export interface MotionJudgeState {
  isStopped: boolean;
  belowSince: number | null;
  lastSample: MotionSample | null;
}

export const INITIAL_MOTION_STATE: MotionJudgeState = {
  isStopped: false,
  belowSince: null,
  lastSample: null,
};

export const STOP_ENTER_MPS = 0.4;
export const STOP_EXIT_MPS = 0.6;
export const STOP_ENTER_HOLD_S = 2.0;
export const SPEED_ACCURACY_CEILING_MPS = 1.0;
export const FALLBACK_MIN_INTERVAL_S = 1.0;
export const FALLBACK_MAX_INTERVAL_S = 5.0;
export const FALLBACK_MAX_ACCURACY_M = 20;
export const MAX_WALK_SPEED_MPS = 8;
export const MAX_CAR_SPEED_MPS = 60;

function resolveSpeed(
  state: MotionJudgeState,
  sample: MotionSample,
  speed: number | null | undefined,
  speedAccuracy: number | null | undefined,
  maxSpeedMps: number,
): number | null {
  if (
    typeof speed === "number" &&
    Number.isFinite(speed) &&
    speed >= 0 &&
    typeof speedAccuracy === "number" &&
    Number.isFinite(speedAccuracy) &&
    speedAccuracy >= 0 &&
    speedAccuracy <= SPEED_ACCURACY_CEILING_MPS
  ) {
    return speed;
  }
  const prev = state.lastSample;
  if (!prev) return null;
  const dt = sample.at - prev.at;
  if (dt < FALLBACK_MIN_INTERVAL_S || dt > FALLBACK_MAX_INTERVAL_S) return null;
  if (!(prev.accuracy > 0) || prev.accuracy > FALLBACK_MAX_ACCURACY_M) return null;
  if (!(sample.accuracy > 0) || sample.accuracy > FALLBACK_MAX_ACCURACY_M) return null;
  const meters = haversineMeters(prev.lat, prev.lng, sample.lat, sample.lng);
  if (!Number.isFinite(meters)) return null;
  const v = meters / dt;
  return v <= maxSpeedMps ? v : null;
}

export function motionStep(
  state: MotionJudgeState,
  sample: MotionSample,
  speed: number | null | undefined,
  speedAccuracy: number | null | undefined,
  maxSpeedMps: number,
): { state: MotionJudgeState; motion: MotionState } {
  const velocity = resolveSpeed(state, sample, speed, speedAccuracy, maxSpeedMps);
  const next: MotionJudgeState = { ...state, lastSample: sample };

  if (velocity === null) {
    next.belowSince = null;
    return { state: next, motion: "speedUnknown" };
  }
  if (state.isStopped) {
    if (velocity > STOP_EXIT_MPS) {
      next.isStopped = false;
      next.belowSince = null;
      return { state: next, motion: "moving" };
    }
    return { state: next, motion: "stopped" };
  }
  if (velocity >= STOP_ENTER_MPS) {
    next.belowSince = null;
    return { state: next, motion: "moving" };
  }
  const since = state.belowSince ?? sample.at;
  next.belowSince = since;
  if (sample.at - since >= STOP_ENTER_HOLD_S) {
    next.isStopped = true;
    return { state: next, motion: "stopped" };
  }
  return { state: next, motion: "moving" };
}
```

- [ ] **Step 6: 웹 테스트 작성**

`src/lib/__tests__/guide-motion.test.ts`에 Swift와 **같은 10케이스** + 웹 고유 케이스를 추가한다:

```typescript
it("speed가 null이면 speedUnknown이다(0으로 암묵 변환 금지)", () => {
  const { motion } = motionStep(
    INITIAL_MOTION_STATE,
    { lat: 37.5, lng: 127, accuracy: 10, at: 0 },
    null,
    null,
    MAX_WALK_SPEED_MPS,
  );
  expect(motion).toBe("speedUnknown");
});

it("speedAccuracy 필드가 없으면 도플러를 채택하지 않는다", () => {
  const { motion } = motionStep(
    INITIAL_MOTION_STATE,
    { lat: 37.5, lng: 127, accuracy: 10, at: 0 },
    1.5,
    undefined,
    MAX_WALK_SPEED_MPS,
  );
  expect(motion).toBe("speedUnknown");
});
```

- [ ] **Step 7: 웹 테스트 통과**

Run: `npm run test:run -- guide-motion`
Expected: 12 tests PASS.

- [ ] **Step 8: 커밋**

```bash
git commit -- ios/GildongmuKit/Sources/GildongmuKit/GuideMotion.swift \
  ios/GildongmuKit/Tests/GildongmuKitTests/GuideMotionTests.swift \
  src/lib/guide-motion.ts src/lib/__tests__/guide-motion.test.ts \
  -m "feat(guide): 정지 판정을 도플러 기반 3-state로

현행 hold는 '정지'가 아니라 '아직 데드밴드를 못 넘음'이라 도보에서 tick이 지배적
이고 차량에서는 거의 안 난다. 도플러 속도는 경로·목적지 양쪽에 독립이라 두 모드가
공유할 수 있는 유일한 축이다. 임계는 위원장 판정(비장애 보행 90% 기준). speedUnknown을
별도 상태로 둬 거짓 정지를 막고, 웹은 speed null을 0으로 변환하지 않는다."
```

### Task 8: 배타적 톤 계층

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/GuideToneLayer.swift`
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/GuideToneLayerTests.swift`
- Create: `src/lib/guide-tone-layer.ts`
- Create: `src/lib/__tests__/guide-tone-layer.test.ts`
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/BeaconTones.swift`
- Modify: `src/hooks/useBeaconSound.ts`

**Interfaces:**
- Consumes: `trendStep`(Task 6), `MotionState`(Task 7)
- Produces:
  - Swift: `ToneLayerState`, `ToneLayerInput`, `TrendInput`, `ToneLayerConstants`, `toneLayerStep(state:input:now:) -> (state, BeaconTone?)`
  - TS: 동일 미러(`toneLayerStep`, `INITIAL_TONE_LAYER_STATE`)
  - Swift: `BeaconTone.unreliable`

**설계 근거:** 4단계 우선순위 중재기는 폐기됐다(spec §4.4). 중재기는 후보 생성·상태 커밋 분리, 선점 정책, 시간축 억제, lifecycle 톤 포함까지 딸려오는데 그 복잡도 전부가 "상세 모드에 추세 톤을 추가한다"는 결정이 새로 만든 문제였다. **기존 코드 구조가 이미 답을 갖고 있다** — `handleDetail`은 `out.tone` → `out.event` → 하트비트 순으로 흐르므로, 하트비트 자리에 추세 톤을 놓으면 중재가 필요 없다.

각 단계는 **배타적**이다. 위 단계가 톤을 내면 아래 단계의 `trendStep`을 **호출하지 않는다**. 호출하지 않으므로 앵커·추세·타이머가 갱신되지 않고, "억제된 후보의 latch가 커밋되어 다음 fix에서 사라지는" 문제가 구조적으로 성립하지 않는다.

⚠ **계획이 spec에 더하는 것: `needsRebase` 플래그.** spec §4.4는 "이탈·불확실에서 복귀할 때 앵커를 재기준화한다"고만 적었는데, 복귀하는 fix에서 상위 톤(ahead·warning·이벤트)이 나면 그 fix는 추세 축에 닿지 못한다. 그 사이 "직전이 unreliable이었다"는 신호가 소비되면 재기준화 기회가 영영 사라져 낡은 앵커로 거짓 추세가 난다. 플래그를 상태에 두어 **추세 축에 도달하는 첫 fix가 소비**하게 한다.

- [ ] **Step 1: `BeaconTone`에 케이스 추가**

`ios/GildongmuKit/Sources/GildongmuKit/BeaconTones.swift`:

```swift
public enum BeaconTone: String, Sendable, Equatable, CaseIterable {
    case closer, farther, nearby, tick, start, stop, ahead, warning, unreliable
```

같은 파일 의미 계약 주석을 갱신한다:

```
/// **의미 계약(불변)**: 가까워짐=상승, 멀어짐=하강, 도착=연타 종(마지막 바퀴 종 —
/// 여정 끝 1회), **tick=정지**(2026-08-08 뜻 변경 — 종전 '하트비트'는 간략에서 정체,
/// 상세에서 생존 신호라는 두 뜻이었고 사용자에게는 같은 소리였다), 예고=가벼운 트릴,
/// 경고=낮은 이중음(이탈), **신뢰 불가=현재 안내를 믿을 수 없음**(원인 셋 — 정확도
/// 불량·fix 부재·경로 재획득 — 에 사용자가 취할 행동이 같아 하나로 묶었다).
```

`src/hooks/useBeaconSound.ts`의 `GuideSound` 유니온과 `GAIN`에 `unreliable: 0.45`를 추가한다(iOS `gains`와 동조).

- [ ] **Step 2: 실패 테스트 작성(Swift)**

`ios/GildongmuKit/Tests/GildongmuKitTests/GuideToneLayerTests.swift`:

```swift
import Testing
@testable import GildongmuKit

@Suite("배타적 톤 계층")
struct GuideToneLayerTests {
    private func trend(
        _ distance: Double, motion: MotionState = .moving, deadBand: Double = 15,
        closer: Double = ToneLayerConstants.walkCloserIntervalSeconds
    ) -> TrendInput {
        TrendInput(
            distance: distance, deadBand: deadBand, motion: motion,
            closerIntervalSeconds: closer
        )
    }

    private func input(
        unreliable: Bool = false, priority: BeaconTone? = nil, eventOwned: Bool = false,
        trend t: TrendInput? = nil, arrived: Bool = false, rebase: Bool = false
    ) -> ToneLayerInput {
        ToneLayerInput(
            unreliable: unreliable, priorityTone: priority, eventOwned: eventOwned,
            trend: t, arrived: arrived, rebaseTrend: rebase
        )
    }

    // MARK: 계층 배타성

    @Test("1단계: unreliable은 상위다 — 추세가 동시에 참이어도 앵커가 갱신되지 않는다")
    func unreliableWins() {
        var state = ToneLayerState.initial
        state.anchorDistance = 100
        state.trend = .closer
        let (next, tone) = toneLayerStep(
            state: state, input: input(unreliable: true, trend: trend(50)), now: 10
        )
        #expect(tone == .unreliable)
        #expect(next.anchorDistance == 100)  // trendStep 미호출
        #expect(next.trend == .closer)
    }

    @Test("2단계: 우선 톤이 있으면 추세 판정을 하지 않는다")
    func priorityWins() {
        var state = ToneLayerState.initial
        state.anchorDistance = 100
        let (next, tone) = toneLayerStep(
            state: state, input: input(priority: .ahead, trend: trend(50)), now: 10
        )
        #expect(tone == .ahead)
        #expect(next.anchorDistance == 100)
        #expect(next.lastTrendToneAt == nil)
    }

    @Test("3단계: 이벤트가 톤 자리를 소유하면 침묵하고 앵커도 불변이다")
    func eventOwns() {
        var state = ToneLayerState.initial
        state.anchorDistance = 100
        let (next, tone) = toneLayerStep(
            state: state, input: input(eventOwned: true, trend: trend(50)), now: 10
        )
        #expect(tone == nil)
        #expect(next.anchorDistance == 100)
    }

    @Test("4단계: 상위가 전부 비면 추세 톤이 난다")
    func trendReached() {
        var state = ToneLayerState.initial
        state.anchorDistance = 100
        let (next, tone) = toneLayerStep(state: state, input: input(trend: trend(80)), now: 10)
        #expect(tone == .closer)
        #expect(next.anchorDistance == 80)
    }

    // MARK: 추세 축 내부

    @Test("정지가 확정되면 데드밴드와 무관하게 tick이다")
    func stoppedTicks() {
        var state = ToneLayerState.initial
        state.anchorDistance = 100
        let (_, tone) = toneLayerStep(
            state: state, input: input(trend: trend(99, motion: .stopped)), now: 10
        )
        #expect(tone == .tick)
    }

    @Test("속도를 모르면 tick을 내지 않는다(거짓 정지 금지)")
    func speedUnknownNoTick() {
        var state = ToneLayerState.initial
        state.anchorDistance = 100
        let (_, tone) = toneLayerStep(
            state: state, input: input(trend: trend(99, motion: .speedUnknown)), now: 10
        )
        #expect(tone == nil)
    }

    @Test("speedUnknown이어도 데드밴드를 넘으면 추세 톤은 난다")
    func speedUnknownStillTrends() {
        var state = ToneLayerState.initial
        state.anchorDistance = 100
        let (_, tone) = toneLayerStep(
            state: state, input: input(trend: trend(80, motion: .speedUnknown)), now: 10
        )
        #expect(tone == .closer)
    }

    @Test("closer 간격은 수단별이다 — 차량 10초 창에서는 억제된다")
    func carCloserInterval() {
        var state = ToneLayerState.initial
        state.anchorDistance = 1000
        var out = toneLayerStep(
            state: state,
            input: input(trend: trend(900, closer: ToneLayerConstants.carCloserIntervalSeconds)),
            now: 10
        )
        #expect(out.tone == .closer)
        state = out.state
        out = toneLayerStep(
            state: state,
            input: input(trend: trend(800, closer: ToneLayerConstants.carCloserIntervalSeconds)),
            now: 14
        )
        #expect(out.tone == nil)  // 4초 뒤 — 10초 창 안
        state = out.state
        out = toneLayerStep(
            state: state,
            input: input(trend: trend(700, closer: ToneLayerConstants.carCloserIntervalSeconds)),
            now: 21
        )
        #expect(out.tone == .closer)
    }

    @Test("farther는 수단을 가리지 않는다(경고 축)")
    func fartherAlwaysTwoSeconds() {
        var state = ToneLayerState.initial
        state.anchorDistance = 1000
        var out = toneLayerStep(
            state: state,
            input: input(trend: trend(1100, closer: ToneLayerConstants.carCloserIntervalSeconds)),
            now: 10
        )
        #expect(out.tone == .farther)
        state = out.state
        out = toneLayerStep(
            state: state,
            input: input(trend: trend(1200, closer: ToneLayerConstants.carCloserIntervalSeconds)),
            now: 12.5
        )
        #expect(out.tone == .farther)  // 2.5초 뒤 — farther 창(2초)은 지났다
    }

    // MARK: 정숙 구간

    @Test("행동 안내 후 3초는 추세 톤을 억제한다")
    func quietAfterAction() {
        var state = ToneLayerState.initial
        state.anchorDistance = 100
        var out = toneLayerStep(state: state, input: input(priority: .ahead), now: 10)
        state = out.state
        out = toneLayerStep(state: state, input: input(trend: trend(80)), now: 11)
        #expect(out.tone == nil)
        #expect(out.state.anchorDistance == 100)  // 억제 중에도 trendStep 미호출
        state = out.state
        out = toneLayerStep(state: state, input: input(trend: trend(80)), now: 13.5)
        #expect(out.tone == .closer)
    }

    // MARK: 신뢰 불가 진입·지속·회복

    @Test("진입은 즉시 1회, 지속은 간격 반복")
    func unreliableEntryAndInterval() {
        var state = ToneLayerState.initial
        var out = toneLayerStep(state: state, input: input(unreliable: true), now: 0)
        #expect(out.tone == .unreliable)
        state = out.state
        out = toneLayerStep(state: state, input: input(unreliable: true), now: 5)
        #expect(out.tone == nil)
        state = out.state
        out = toneLayerStep(state: state, input: input(unreliable: true), now: 10.1)
        #expect(out.tone == .unreliable)
    }

    @Test("회복은 앵커 재기준화 후 현재 상태 톤 1회")
    func recoveryImmediateTone() {
        var state = ToneLayerState.initial
        state.anchorDistance = 500
        state.trend = .closer
        state = toneLayerStep(state: state, input: input(unreliable: true), now: 0).state
        let (next, tone) = toneLayerStep(state: state, input: input(trend: trend(120)), now: 3)
        #expect(tone == .closer)          // 데드밴드 미달이어도 즉시 1회
        #expect(next.anchorDistance == 120)  // 재기준화
    }

    @Test("회복 fix에서 상위 톤이 나도 재기준화 기회를 잃지 않는다")
    func rebaseSurvivesPriorityTone() {
        var state = ToneLayerState.initial
        state.anchorDistance = 500
        state.trend = .closer
        state = toneLayerStep(state: state, input: input(unreliable: true), now: 0).state
        // 복귀하는 fix에서 이탈 경고가 났다 — 추세 축에 닿지 못한다.
        state = toneLayerStep(state: state, input: input(priority: .warning), now: 3).state
        #expect(state.needsRebase)
        // 정숙 구간이 끝난 다음 추세 fix가 재기준화를 소비한다.
        let (next, tone) = toneLayerStep(state: state, input: input(trend: trend(120)), now: 7)
        #expect(next.anchorDistance == 120)
        #expect(tone == .closer)
    }

    @Test("호출부가 요청한 축 전환도 재기준화한다(handoff)")
    func explicitRebase() {
        var state = ToneLayerState.initial
        state.anchorDistance = 500
        state.trend = .closer
        let (next, tone) = toneLayerStep(
            state: state, input: input(trend: trend(120), rebase: true), now: 10
        )
        #expect(next.anchorDistance == 120)
        #expect(tone == .closer)
    }

    @Test("추세가 none인 상태에서 회복하면 앵커만 잡고 침묵한다")
    func recoveryWithoutTrend() {
        var state = ToneLayerState.initial
        state = toneLayerStep(state: state, input: input(unreliable: true), now: 0).state
        let (next, tone) = toneLayerStep(state: state, input: input(trend: trend(120)), now: 3)
        #expect(tone == nil)
        #expect(next.anchorDistance == 120)
    }

    // MARK: 도착 종단

    @Test("도착 후에는 tick·추세·unreliable을 전부 억제한다")
    func arrivedSuppresses() {
        var state = ToneLayerState.initial
        state.anchorDistance = 30
        #expect(
            toneLayerStep(
                state: state, input: input(trend: trend(25, motion: .stopped), arrived: true),
                now: 10
            ).tone == nil
        )
        #expect(
            toneLayerStep(state: state, input: input(unreliable: true, arrived: true), now: 10)
                .tone == nil
        )
    }

    @Test("도착 후에도 이탈 경고는 난다(억제 대상이 아니다)")
    func arrivedKeepsPriority() {
        let (_, tone) = toneLayerStep(
            state: .initial, input: input(priority: .warning, arrived: true), now: 10
        )
        #expect(tone == .warning)
    }

    // MARK: 최대 침묵 계약

    @Test("정상 보행에서 21초를 넘는 침묵이 없다")
    func maxNormalSilence() {
        // 느린 구간 0.7m/s로 1초마다 fix. 데드밴드 15m는 약 21초에 통과한다.
        var state = ToneLayerState.initial
        state.anchorDistance = 300
        var lastToneAt = 0.0
        var maxGap = 0.0
        var distance = 300.0
        for i in 1...60 {
            let now = Double(i)
            distance -= 0.7
            let out = toneLayerStep(state: state, input: input(trend: trend(distance)), now: now)
            state = out.state
            if out.tone != nil {
                maxGap = max(maxGap, now - lastToneAt)
                lastToneAt = now
            }
        }
        #expect(maxGap <= ToneLayerConstants.maxNormalSilenceSeconds)
    }
}
```

- [ ] **Step 3: 실패 확인**

Run: `cd ios/GildongmuKit && swift test --filter GuideToneLayerTests`
Expected: 컴파일 실패.

- [ ] **Step 4: Swift 구현**

`ios/GildongmuKit/Sources/GildongmuKit/GuideToneLayer.swift`:

```swift
import Foundation

/// 안내 톤 선택(순수 함수, 웹 `src/lib/guide-tone-layer.ts` 미러).
///
/// **간략·상세가 같은 함수를 쓴다.** 모드 차이는 입력 조립에만 있다 — 두 모드가 각자
/// 계층 로직을 가지면 이 설계가 고치려던 부채(같은 `tick`이 두 뜻)가 형태만 바꿔 남는다.
///
/// **우선순위 중재기가 아니라 계층 순서다**(spec §4.4). 각 단계는 배타적이고, 위
/// 단계가 톤을 내면 아래 단계의 `trendStep`을 **호출하지 않는다**. 호출하지 않으므로
/// 앵커·추세·타이머가 갱신되지 않고, 따라서 "억제된 후보의 latch가 커밋되어 다음
/// fix에서 사라지는" 문제가 구조적으로 성립하지 않는다(2단계 커밋 계약 불필요).
///
/// ```
/// 1. unreliable          → unreliable 톤(진입 즉시 1회 + 간격 반복)
/// 2. priorityTone        → 그 톤(상세 ahead·warning, 간략 nearby)
/// 3. eventOwned          → 침묵(이벤트가 소유)
/// 4. trend               → 정지 tick / closer / farther
/// ```
///
/// ⚠ 배타성은 **추세 앵커가 정지한다**는 뜻이다. 이탈·불확실 구간이 길면 앵커가
/// 낡으므로 복귀 시 재기준화가 필요한데, 복귀 fix에서 상위 톤이 나면 그 fix는 추세
/// 축에 닿지 못한다. `needsRebase`를 상태에 두어 **추세 축에 도달하는 첫 fix**가
/// 소비하게 한다(그러지 않으면 재기준화 기회가 사라져 낡은 앵커로 거짓 추세가 난다).

public struct TrendInput: Sendable, Equatable {
    /// 추세 축 거리(간략=목적지 직선거리, 상세=경로 잔여 거리).
    public var distance: Double
    public var deadBand: Double
    public var motion: MotionState
    /// closer 최소 간격(초). 수단별로 가른다 — 차량은 데드밴드를 매 fix 넘어
    /// 2초 창에 매번 걸린다(30분 주행 약 900회).
    public var closerIntervalSeconds: Double

    public init(
        distance: Double, deadBand: Double, motion: MotionState, closerIntervalSeconds: Double
    ) {
        self.distance = distance
        self.deadBand = deadBand
        self.motion = motion
        self.closerIntervalSeconds = closerIntervalSeconds
    }
}

public struct ToneLayerInput: Sendable, Equatable {
    /// 1단계: 현재 안내를 신뢰할 수 없다(간략 weak·상세 uncertain/reacquiring·fix 워치독).
    public var unreliable: Bool
    /// 2단계: 이 fix가 소유한 우선 톤.
    public var priorityTone: BeaconTone?
    /// 3단계: 이벤트가 톤 자리를 소유한다(상세 event 존재).
    public var eventOwned: Bool
    /// 4단계: 추세 축 입력. nil이면 추세 판정을 하지 않는다(이탈 중·투영 점프 폐기).
    public var trend: TrendInput?
    /// 도착 종단(spec §5.5) — tick·추세·unreliable을 전부 억제한다. 우선 톤은 예외다.
    public var arrived: Bool
    /// 호출부가 요구하는 축 재기준화(이탈 복귀·handoff 축 전환).
    public var rebaseTrend: Bool

    public init(
        unreliable: Bool, priorityTone: BeaconTone?, eventOwned: Bool,
        trend: TrendInput?, arrived: Bool, rebaseTrend: Bool
    ) {
        self.unreliable = unreliable
        self.priorityTone = priorityTone
        self.eventOwned = eventOwned
        self.trend = trend
        self.arrived = arrived
        self.rebaseTrend = rebaseTrend
    }
}

public struct ToneLayerState: Sendable, Equatable {
    public var anchorDistance: Double?
    public var trend: BeaconTrend
    public var lastTrendToneAt: Double?
    public var lastTickAt: Double?
    public var lastUnreliableAt: Double?
    public var wasUnreliable: Bool
    /// 추세 축에 도달하는 첫 fix가 소비할 재기준화 예약.
    public var needsRebase: Bool
    /// 행동 안내(ahead·warning) 후 추세 톤 억제 종료 시각.
    public var quietUntil: Double?

    public static let initial = ToneLayerState(
        anchorDistance: nil, trend: .none, lastTrendToneAt: nil, lastTickAt: nil,
        lastUnreliableAt: nil, wasUnreliable: false, needsRebase: false, quietUntil: nil
    )
}

public enum ToneLayerConstants {
    /// 신뢰 불가 지속 중 반복 간격(초). 초기값이며 실사용 판정 대상이다.
    public static let unreliableIntervalSeconds = 10.0
    /// 행동 안내 후 정숙 구간(초). 사용자가 행동해야 하는 안내 직후에 배경 톤이
    /// 끼어들면 의미가 흐려진다.
    public static let quietAfterActionSeconds = 3.0
    /// 정지 tick 간격(초).
    public static let tickIntervalSeconds = 3.0
    /// farther 간격(초). **수단별로 가르지 않는다** — 경고 축이기 때문이다.
    public static let fartherIntervalSeconds = 2.0
    public static let walkCloserIntervalSeconds = 2.0
    /// 차량 closer 간격(초). 초기값이며 실주행 판정 대상이다.
    public static let carCloserIntervalSeconds = 10.0
    /// 허용 최대 정상 침묵(초) = 데드밴드 15m ÷ 느린 구간 0.7m/s. 위원장 판정으로
    /// 계약값 확정(2026-08-08). 이보다 오래 조용하면 고장이라는 사용자 계약이다.
    /// ⚠ 최소 재확인 간격 추가는 **폐기한 하트비트가 이름만 바꿔 돌아오는 것**이라
    /// 기각됐고, 데드밴드 축소는 GPS 지터 내성을 깎아 기각됐다. 되살리지 말 것.
    public static let maxNormalSilenceSeconds = 21.0
}

public func toneLayerStep(
    state: ToneLayerState,
    input: ToneLayerInput,
    now: Double
) -> (state: ToneLayerState, tone: BeaconTone?) {
    var next = state

    // 1단계 — 신뢰 불가. 도착 후에는 억제한다(목적지에 서 있는 동안 반복 금지).
    if input.unreliable && !input.arrived {
        next.needsRebase = true
        let due = !state.wasUnreliable
            || now - (state.lastUnreliableAt ?? -.infinity)
                >= ToneLayerConstants.unreliableIntervalSeconds
        next.wasUnreliable = true
        guard due else { return (next, nil) }
        next.lastUnreliableAt = now
        return (next, .unreliable)
    }
    if state.wasUnreliable {
        next.wasUnreliable = false
        next.needsRebase = true
    }
    if input.rebaseTrend { next.needsRebase = true }

    // 2단계 — 우선 톤. 행동 안내는 정숙 구간을 연다.
    if let tone = input.priorityTone {
        if tone == .ahead || tone == .warning {
            next.quietUntil = now + ToneLayerConstants.quietAfterActionSeconds
        }
        if tone == .warning { next.needsRebase = true }  // 이탈 중 앵커는 낡는다
        return (next, tone)
    }

    // 3단계 — 이벤트 소유.
    if input.eventOwned { return (next, nil) }

    // 4단계 — 추세 축.
    if let until = next.quietUntil, now < until { return (next, nil) }
    guard let t = input.trend, !input.arrived else { return (next, nil) }

    if next.needsRebase {
        next.needsRebase = false
        next.anchorDistance = t.distance
        // 회복 즉시 1회: 데드밴드 미달이어도 현재 상태를 알린다. 없으면 사용자가
        // 회복 여부를 모른 채 최대 21초를 더 기다린다.
        if t.motion == .stopped {
            next.lastTickAt = now
            return (next, .tick)
        }
        switch next.trend {
        case .closer:
            next.lastTrendToneAt = now
            return (next, .closer)
        case .farther:
            next.lastTrendToneAt = now
            return (next, .farther)
        case .none:
            return (next, nil)  // 승계할 추세가 없으면 앵커만 잡는다
        }
    }

    // 4.5 추세 축 내부 순서 — 정지가 먼저다.
    if t.motion == .stopped {
        guard now - (state.lastTickAt ?? -.infinity) >= ToneLayerConstants.tickIntervalSeconds
        else { return (next, nil) }
        next.lastTickAt = now
        return (next, .tick)
    }

    let stepped = trendStep(
        anchor: next.anchorDistance, trend: next.trend, distance: t.distance, deadBand: t.deadBand
    )
    next.anchorDistance = stepped.anchor
    next.trend = stepped.trend
    let tone: BeaconTone
    let interval: Double
    switch stepped.kind {
    case .closer:
        tone = .closer
        interval = t.closerIntervalSeconds
    case .farther:
        tone = .farther
        interval = ToneLayerConstants.fartherIntervalSeconds
    case .hold:
        return (next, nil)
    }
    guard now - (state.lastTrendToneAt ?? -.infinity) >= interval else { return (next, nil) }
    next.lastTrendToneAt = now
    return (next, tone)
}
```

- [ ] **Step 5: 테스트 통과**

Run: `cd ios/GildongmuKit && swift test --filter GuideToneLayerTests`
Expected: 18 tests PASS.

- [ ] **Step 6: 웹 미러 구현**

`src/lib/guide-tone-layer.ts` — 위 Swift와 1:1 대응(같은 상수·같은 분기 순서). 타입:

```typescript
export type GuideTone =
  | "closer" | "farther" | "nearby" | "tick"
  | "start" | "stop" | "ahead" | "warning" | "unreliable";

export interface TrendInput {
  distance: number;
  deadBand: number;
  motion: MotionState;
  closerIntervalSeconds: number;
}

export interface ToneLayerInput {
  unreliable: boolean;
  priorityTone: GuideTone | null;
  eventOwned: boolean;
  trend: TrendInput | null;
  arrived: boolean;
  rebaseTrend: boolean;
}

export interface ToneLayerState {
  anchorDistance: number | null;
  trend: Trend;
  lastTrendToneAt: number | null;
  lastTickAt: number | null;
  lastUnreliableAt: number | null;
  wasUnreliable: boolean;
  needsRebase: boolean;
  quietUntil: number | null;
}

export const INITIAL_TONE_LAYER_STATE: ToneLayerState = { /* 전부 null/false, trend: "none" */ };

export const UNRELIABLE_INTERVAL_S = 10;
export const QUIET_AFTER_ACTION_S = 3;
export const TICK_INTERVAL_S = 3;
export const FARTHER_INTERVAL_S = 2;
export const WALK_CLOSER_INTERVAL_S = 2;
export const CAR_CLOSER_INTERVAL_S = 10;
export const MAX_NORMAL_SILENCE_S = 21;

export function toneLayerStep(
  state: ToneLayerState,
  input: ToneLayerInput,
  now: number,
): { state: ToneLayerState; tone: GuideTone | null } { /* Swift와 동일 순서 */ }
```

- [ ] **Step 7: 웹 테스트 + 공유 fixture**

`src/lib/__tests__/fixtures/tone-layer-scenarios.json` — Swift·웹이 **같은 입력 열로 같은 톤 열**을 내는지 강제한다(route-guide-scenarios.json 선례):

```json
{
  "scenarios": [
    {
      "name": "신뢰 불가 진입·지속·회복",
      "steps": [
        { "now": 0, "unreliable": true, "expect": "unreliable" },
        { "now": 5, "unreliable": true, "expect": null },
        { "now": 10.1, "unreliable": true, "expect": "unreliable" },
        { "now": 12, "trend": { "distance": 120, "deadBand": 15, "motion": "moving", "closerIntervalSeconds": 2 }, "expect": null }
      ],
      "initial": { "anchorDistance": 500, "trend": "none" }
    },
    {
      "name": "정지 tick과 이동 추세의 교대",
      "steps": [
        { "now": 0, "trend": { "distance": 100, "deadBand": 15, "motion": "moving", "closerIntervalSeconds": 2 }, "expect": null },
        { "now": 3, "trend": { "distance": 84, "deadBand": 15, "motion": "moving", "closerIntervalSeconds": 2 }, "expect": "closer" },
        { "now": 6, "trend": { "distance": 83, "deadBand": 15, "motion": "stopped", "closerIntervalSeconds": 2 }, "expect": "tick" },
        { "now": 7, "trend": { "distance": 83, "deadBand": 15, "motion": "stopped", "closerIntervalSeconds": 2 }, "expect": null },
        { "now": 9.5, "trend": { "distance": 83, "deadBand": 15, "motion": "stopped", "closerIntervalSeconds": 2 }, "expect": "tick" }
      ],
      "initial": { "anchorDistance": 100, "trend": "none" }
    },
    {
      "name": "행동 안내 후 정숙 구간",
      "steps": [
        { "now": 0, "priorityTone": "ahead", "expect": "ahead" },
        { "now": 1, "trend": { "distance": 60, "deadBand": 15, "motion": "moving", "closerIntervalSeconds": 2 }, "expect": null },
        { "now": 3.5, "trend": { "distance": 60, "deadBand": 15, "motion": "moving", "closerIntervalSeconds": 2 }, "expect": "closer" }
      ],
      "initial": { "anchorDistance": 100, "trend": "none" }
    }
  ]
}
```

웹 러너(`src/lib/__tests__/guide-tone-layer.test.ts`)와 Swift 러너(`GuideToneLayerTests.swift`에 추가)가 이 파일을 읽어 같은 단언을 돌린다. Swift 쪽 로더는 `RouteGuideTests`의 fixture 로딩 패턴을 그대로 쓴다.

- [ ] **Step 8: 전체 테스트**

Run: `npm run test:run -- guide-tone-layer` 그리고 `cd ios/GildongmuKit && swift test`
Expected: 양쪽 전량 PASS.

- [ ] **Step 9: 커밋**

```bash
git commit -- ios/GildongmuKit/Sources/GildongmuKit/GuideToneLayer.swift \
  ios/GildongmuKit/Sources/GildongmuKit/BeaconTones.swift \
  ios/GildongmuKit/Tests/GildongmuKitTests/GuideToneLayerTests.swift \
  src/lib/guide-tone-layer.ts src/lib/__tests__/guide-tone-layer.test.ts \
  src/lib/__tests__/fixtures/tone-layer-scenarios.json src/hooks/useBeaconSound.ts \
  -m "feat(guide): 톤 선택을 배타적 계층 순서로 통일

우선순위 중재기는 폐기했다 — 그 복잡도 전부가 '상세에 추세 톤 추가'라는 결정이
새로 만든 문제였고, 기존 코드 흐름(tone→event→하트비트)이 이미 답이었다. 상위가
톤을 내면 trendStep을 호출하지 않으므로 latch 커밋 문제가 성립하지 않는다.
복귀 fix에서 상위 톤이 나도 재기준화를 잃지 않도록 needsRebase를 상태에 둔다."
```

---

## M3: 배선

### Task 9: 위치 페이로드에 속도 추가

**Files:**
- Modify: `ios/Gildongmu/LocationService.swift:57-63`, `:405-450`

**Interfaces:**
- Produces: `BeaconFixPayload.speed: Double`, `.speedAccuracy: Double`

**설계 근거:** `CLLocation`이 이미 두 값을 들고 있으므로 새 API 호출이 없다. ⚠ 두 값 다 **음수가 무효 신호**라 소비자(순수 함수)가 판정한다. 여기서는 원값을 그대로 싣는다.

- [ ] **Step 1: 페이로드 확장**

```swift
    struct BeaconFixPayload: Sendable {
        let lat: Double
        let lng: Double
        /// 미터. **음수는 좌표 무효 신호**이므로 소비자가 걸러야 한다.
        let accuracy: Double
        let timestamp: Date
        /// m/s. **음수는 속도 무효 신호**(CLLocation 계약). 정지 판정이 소비한다.
        let speed: Double
        /// m/s. 음수는 무효. ⚠ 음수 여부만으로 신뢰를 판정하면 안 된다 —
        /// speed 0.2에 speedAccuracy가 매우 크면 정지 근거가 못 된다.
        let speedAccuracy: Double
    }
```

- [ ] **Step 2: 델리게이트에서 값 반입**

`locationManager(_:didUpdateLocations:)`에서 `let timestamp = location.timestamp` 아래에 추가:

```swift
        let speed = location.speed
        let speedAccuracy = location.speedAccuracy
```

`beaconFixSink?(...)` 호출을 갱신:

```swift
                self.beaconFixSink?(
                    BeaconFixPayload(
                        lat: lat, lng: lng, accuracy: accuracy, timestamp: timestamp,
                        speed: speed, speedAccuracy: speedAccuracy
                    )
                )
```

- [ ] **Step 3: 빌드 확인**

Run: `cd ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -configuration Experimental -sdk iphonesimulator -derivedDataPath /tmp/gd-exp build 2>&1 | tail -5`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: 커밋**

```bash
git commit -- ios/Gildongmu/LocationService.swift \
  -m "feat(ios): 비콘 fix에 도플러 속도·속도 정확도 투영

CLLocation이 이미 들고 있어 새 호출이 없다. 두 값 다 음수가 무효 신호이고
판정은 Kit motionStep이 한다(여기는 원값 전달만)."
```

### Task 10: iOS 톤 계층 배선

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/BeaconGate.swift`

**Interfaces:**
- Consumes: `toneLayerStep`·`motionStep`(M2), `BeaconFixPayload.speed`(Task 9)
- Produces: `beaconGateStep`이 통지만 반환(`tone` 제거)

**설계 근거:** 톤 책임이 새 계층으로 옮겨졌으므로 `beaconGateStep`은 통지 전용으로 좁힌다. 두 곳이 톤을 내면 어느 쪽이 정본인지 알 수 없고, 실제로 이 기능의 결함 이력 100%가 이 계층이었다.

- [ ] **Step 1: `beaconGateStep` 축소**

`BeaconGate.swift`에서 톤 관련 상태·상수·분기를 제거한다. 남는 것은 `nearbyToneDone`(→ `nearbyNoticeDone`으로 개명하지 않는다. 톤 래치가 아니라 **톤 계층 입력**으로 쓰이므로 그대로 두고 의미만 주석으로 갱신)과 `previousKind`, 그리고 `notice` 산출이다.

```swift
public struct BeaconGateState: Sendable, Equatable {
    /// 도착 존 톤 래치. 존을 벗어나 추세가 재개될 때만 재무장한다.
    /// ⚠ 이제 톤을 직접 내지 않는다 — 톤 계층의 `priorityTone` 입력이 될지를 정한다.
    var nearbyToneDone: Bool
    var previousKind: AnnounceKind?

    public static let initial = BeaconGateState(nearbyToneDone: false, previousKind: nil)
}

/// 비콘 판정을 **통지로** 라우팅하는 순수 게이트. 톤은 `toneLayerStep`이 소유한다
/// (2026-08-08 분리 — 두 곳이 톤을 내면 어느 쪽이 정본인지 알 수 없다).
///
/// 반환의 `nearbyTone`은 "이번 fix가 도착 톤을 소유하는가"만 알린다. 존에 머무는
/// 동안 매 fix가 `.nearby`를 내지만 소유는 진입 1회뿐이다.
public func beaconGateStep(
    state: BeaconGateState,
    announce: BeaconAnnounce,
    now: Double
) -> (state: BeaconGateState, nearbyTone: Bool, notice: BeaconNotice?)
```

본문에서 `lastTrendToneAt`·`lastTickAt`·`BeaconGateConstants`를 삭제하고, `.closer/.farther` 분기는 `next.nearbyToneDone = false`만 남긴다. `.hold` 분기는 삭제한다(톤 없음).

기존 `BeaconGateTests.swift`에서 톤 단언을 `nearbyTone` 단언으로 교체하고, tick·추세 톤 창 테스트는 `GuideToneLayerTests`가 승계했으므로 삭제한다.

- [ ] **Step 2: `BeaconModel` 상태 교체**

```swift
    private var beaconState = BeaconState.initial
    private var gateState = BeaconGateState.initial
    private var toneState = ToneLayerState.initial
    private var motionState = MotionJudgeState.initial
```

`lastDetailTickAt`은 삭제한다(하트비트 폐기).

`start()`·`stop()`·`toggleMode()`·`handoff` 처리에서 `beaconState = .initial; gateState = .initial` 옆에 `toneState = .initial; motionState = .initial`을 추가한다. ⚠ **handoff만 예외**다(Task 12에서 재기준화로 처리).

- [ ] **Step 3: 공통 톤 라우팅 헬퍼**

```swift
    /// 수단별 물리 상한(정지 판정 폴백의 산출 속도 가드).
    private var maxSpeedMps: Double {
        sessionKind == .car ? MotionConstants.maxCarSpeedMps : MotionConstants.maxWalkSpeedMps
    }

    /// 수단별 closer 최소 간격(spec §7.1). 차량은 데드밴드를 매 fix 넘어 2초 창에
    /// 매번 걸린다(30분 주행 약 900회).
    private var closerIntervalSeconds: Double {
        sessionKind == .car
            ? ToneLayerConstants.carCloserIntervalSeconds
            : ToneLayerConstants.walkCloserIntervalSeconds
    }

    /// 이 fix의 이동 상태를 판정한다(양 모드 공용).
    private func judgeMotion(fix: LocationService.BeaconFixPayload, now: Double) -> MotionState {
        let out = motionStep(
            state: motionState,
            sample: MotionSample(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, at: now),
            speed: fix.speed,
            speedAccuracy: fix.speedAccuracy,
            maxSpeedMps: maxSpeedMps
        )
        motionState = out.state
        return out.motion
    }

    /// 톤 계층 통과 + 재생. 계층 판정은 Kit이 하고 여기는 배선만 한다.
    private func routeTone(_ input: ToneLayerInput, now: Double) {
        let out = toneLayerStep(state: toneState, input: input, now: now)
        toneState = out.state
        if let tone = out.tone { playTone(tone) }
    }
```

- [ ] **Step 4: 간략 모드 배선**

`handle(fix:)`의 톤·통지 블록을 교체한다. ⚠ **`isUsableFix` 게이트 위치가 바뀐다** — 종전에는 게이트를 통과하지 못한 fix가 조용히 버려졌는데(`return`), 이제 그 상태도 톤 커버리지 대상이다.

```swift
        let now = ProcessInfo.processInfo.systemUptime
        let age = Date().timeIntervalSince(fix.timestamp)
        let usable = isUsableFix(accuracy: fix.accuracy, ageSeconds: age)
        let motion = judgeMotion(fix: fix, now: now)

        guard usable else {
            // 캐시·무효 좌표는 앵커에 반영하지 않지만 침묵으로 두지도 않는다.
            // 워치독이 잡기 전까지의 공백을 신뢰 불가 톤이 메운다(spec §6.1).
            routeTone(
                ToneLayerInput(
                    unreliable: true, priorityTone: nil, eventOwned: false,
                    trend: nil, arrived: beaconState.nearby, rebaseTrend: false
                ),
                now: now
            )
            return
        }

        lastFixAt = now
        lastStaleNoticeAt = nil
        lastFixCoord = (fix.lat, fix.lng)
        lastFixCoordAt = now

        let stepped = beaconStep(
            state: beaconState,
            fix: BeaconFix(lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy),
            dest: dest
        )
        beaconState = stepped.state

        let gated = beaconGateStep(state: gateState, announce: stepped.announce, now: now)
        gateState = gated.state

        // 톤 계층 입력 조립(spec §4.4 간략 3단계).
        let weak = stepped.announce.kind == .weak
        let deadBand = max(BeaconConstants.baseDeadBand, fix.accuracy)
        routeTone(
            ToneLayerInput(
                unreliable: weak,
                priorityTone: gated.nearbyTone ? .nearby : nil,
                eventOwned: false,
                trend: weak
                    ? nil
                    : TrendInput(
                        distance: stepped.announce.distance, deadBand: deadBand,
                        motion: motion, closerIntervalSeconds: closerIntervalSeconds
                    ),
                arrived: beaconState.nearby,
                rebaseTrend: false
            ),
            now: now
        )

        if let notice = gated.notice { ... }  // 기존 통지 블록 그대로
```

- [ ] **Step 5: 상세 모드 배선**

`handleDetail(fix:route:)`의 톤·하트비트 블록을 교체한다:

```swift
        let out = guideStep(...)
        guideState = out.state
        updateRemaining(route: route, state: out.state)

        let phase = out.state.phase
        let unreliable = phase == .uncertain || phase == .reacquiring
        // 추세 축은 following·bundle에서만 유효하다. 이탈 중 잔여 거리는 낡은
        // 투영이라 추세로 읽으면 거짓이고, 투영이 튄 fix도 버린다(spec §4.3).
        let remaining = max(0, route.totalMeters - out.state.d)
        let jumped = projectionJumped(remaining: remaining, now: now)
        let trendable = (phase == .following || phase == .bundle) && !jumped
        routeTone(
            ToneLayerInput(
                unreliable: unreliable,
                priorityTone: out.tone.map { $0 == .ahead ? .ahead : .warning },
                eventOwned: out.event != nil,
                trend: trendable
                    ? TrendInput(
                        distance: remaining, deadBand: BeaconConstants.baseDeadBand,
                        motion: motion, closerIntervalSeconds: closerIntervalSeconds
                    )
                    : nil,
                arrived: false,
                rebaseTrend: false
            ),
            now: now
        )
        guard let event = out.event else { return }
        consume(event: event, route: route)
```

⚠ 기존 `if let tone = out.tone { playTone(...) }`와 무이벤트 tick 블록은 **삭제**한다. 톤은 이제 한 경로로만 나간다.

투영 점프 가드(같은 파일 private):

```swift
    /// 직전 fix 대비 잔여 거리 변화가 물리적으로 불가능하면 그 fix의 추세 판정을
    /// 버린다. **상세 모드의 오차 원인은 GPS 정확도가 아니라 경로 투영의 안정성**이다
    /// (accuracy 5m라도 평행 도로로 투영이 점프하면 잔여 거리가 100m 튀고, accuracy
    /// 40m라도 투영이 안정적이면 잔여 거리는 매끄럽다, spec §4.3).
    private func projectionJumped(remaining: Double, now: Double) -> Bool {
        defer {
            lastRemaining = remaining
            lastRemainingAt = now
        }
        guard let prev = lastRemaining, let at = lastRemainingAt else { return false }
        let dt = now - at
        guard dt > 0 else { return true }
        // 여유 계수 1.5 — 속도 상한 자체가 보수적이라 이중으로 좁히지 않는다.
        return abs(remaining - prev) > maxSpeedMps * dt * 1.5
    }
```

상태 2개(`lastRemaining`·`lastRemainingAt`)를 추가하고 `stop()`·모드 전환에서 nil로 되돌린다.

- [ ] **Step 6: 상세 진입 게이트 보정**

`handleDetail` 앞부분의 `guard fix.accuracy > 0, age <= 10 else { return }`는 캐시 fix를 버리는 게이트인데, 이제 그 침묵도 톤 대상이다:

```swift
        let now = uptimeNow
        let age = Date().timeIntervalSince(fix.timestamp)
        let motion = judgeMotion(fix: fix, now: now)
        guard fix.accuracy > 0, age <= 10 else {
            // stale fix 폐기는 lastFixAt을 갱신하지 않으므로 워치독도 잡지만,
            // 워치독 발동(8초)까지의 공백을 여기서 메운다(spec §6.1).
            routeTone(
                ToneLayerInput(
                    unreliable: true, priorityTone: nil, eventOwned: false,
                    trend: nil, arrived: false, rebaseTrend: false
                ),
                now: now
            )
            return
        }
```

- [ ] **Step 7: 빌드 + Kit 테스트**

Run: `cd ios/GildongmuKit && swift test` 그리고 `cd ios && xcodebuild ... build`
Expected: 전량 PASS + BUILD SUCCEEDED.

- [ ] **Step 8: 커밋**

```bash
git commit -- ios/Gildongmu/Directions/BeaconModel.swift \
  ios/GildongmuKit/Sources/GildongmuKit/BeaconGate.swift \
  ios/GildongmuKit/Tests/GildongmuKitTests/BeaconGateTests.swift \
  -m "feat(ios): 두 모드의 톤을 단일 계층으로 라우팅

상세 하트비트(무이벤트 3초 tick)를 폐기하고 그 자리에 추세 축을 놓았다. 같은
tick이 간략에서 정체·상세에서 생존 신호이던 두 뜻이 '정지' 하나로 통일된다.
게이트가 버리던 fix(캐시·무효 좌표·stale)도 이제 신뢰 불가 톤으로 메운다.
beaconGateStep은 통지 전용으로 좁혔다."
```

### Task 11: fix 워치독 → 신뢰 불가 톤

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`

**Interfaces:**
- Consumes: `toneLayerStep`, 기존 `lastFixAt`·`startWatchdog`

**설계 근거:** **초판의 최대 결함이 fix 부재였다**(spec §6.1). 권한 철회·위치 서비스 비활성화·Core Location 정지·백그라운드 업데이트 중단이면 새 fix가 오지 않고, 그러면 `weak`·`uncertain` 판정 자체가 실행되지 않는다. 톤을 fix 처리 경로에만 걸면 **마지막 정상 톤 이후 영구 침묵**이 된다. 타이머 구동이라는 점이 요점이다.

- [ ] **Step 1: 상수 추가**

```swift
    /// fix 부재를 신뢰 불가로 판정하는 경과(초). fix 신선도 창(5초)과 정합하도록
    /// 그보다 크고 워치독 주기(5초)의 두 배보다 작게 잡는다. 초기값이며 실사용
    /// 판정 대상이다(음성 통지 임계 `noFixTimeout` 15초와는 다른 축 — 이쪽은 톤이라
    /// 더 자주 울려도 침해가 적다).
    private let noFixSeconds = 8.0
```

- [ ] **Step 2: 워치독 확장**

`startWatchdog()`의 루프 주기를 5초에서 2초로 줄이고(8초 임계를 최대 2초 지연으로 잡기 위해) 톤 판정을 추가한다:

```swift
    private func startWatchdog() {
        watchdog?.cancel()
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                guard let self else { return }
                guard self.isTracking else { continue }
                self.tickWatchdog()
            }
        }
    }

    /// **타이머 구동**이지 fix 구동이 아니다. fix가 안 와도 돈다는 것이 요점이다 —
    /// 권한 철회·서비스 중단이면 판정 경로 자체가 실행되지 않아 영구 침묵이 된다.
    private func tickWatchdog() {
        let now = uptimeNow
        // 세션 시작 후 첫 fix 대기도 같은 타이머가 덮는다(기준을 시작 시각으로).
        let reference = lastFixAt ?? startedAt ?? now
        if now - reference >= noFixSeconds {
            routeTone(
                ToneLayerInput(
                    unreliable: true, priorityTone: nil, eventOwned: false,
                    trend: nil, arrived: false, rebaseTrend: false
                ),
                now: now
            )
        }
        noticeStaleIfNeeded(force: false)
    }
```

⚠ `noticeStaleIfNeeded`(음성 통지, 15초 임계·30초 재통지)는 **그대로 둔다**. 톤은 추가 채널이지 대체가 아니고, 전경 음성은 원인을 구분해 알린다(spec §6.3).

- [ ] **Step 3: 회복 경로 확인**

fix가 다시 오면 `handle(fix:)`가 `routeTone`을 호출하고, 계층 함수의 `wasUnreliable → needsRebase` 경로가 앵커 재기준화 + 즉시 1회를 수행한다. **추가 배선이 없다**(Task 8이 이미 계약을 소유).

- [ ] **Step 4: 빌드**

Run: `cd ios && xcodebuild ... build`
Expected: BUILD SUCCEEDED.

- [ ] **Step 5: 커밋**

```bash
git commit -- ios/Gildongmu/Directions/BeaconModel.swift \
  -m "feat(ios): fix 부재를 타이머 워치독이 신뢰 불가 톤으로 잡는다

톤을 fix 처리 경로에만 걸면 권한 철회·서비스 중단에서 판정 자체가 실행되지 않아
마지막 정상 톤 이후 영구 침묵이 된다. 기존 lastFixAt 채널을 재사용하고 주기를
2초로 좁혀 8초 임계의 지연을 줄였다. 음성 통지(15초·원인 구분)는 그대로 둔다."
```

### Task 12: handoff 축 전환 재기준화

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift`(전제 조건이 리듀서에 없으면 앱에서 가드)

**Interfaces:**
- Consumes: `ToneLayerInput.rebaseTrend`(Task 8)

**설계 근거:** 상세의 잔여 거리는 **경로 거리**, 간략은 **직선거리**라 값이 불연속으로 줄어든다(경로 500m가 직선 120m가 되는 식). 추세 방향만 승계하고 `anchorDistance`와 `lastSpokenDistance`를 **둘 다** 새 축의 현재값으로 재설정한다. ⚠ 초판은 앵커만 재설정했다 — `lastSpokenDistance`를 옛 축 값(500m)으로 두면 새 축 현재값(120m)과의 차이 380m가 즉시 마일스톤을 넘겨 **전환 직후 거짓 closer 음성**이 나간다.

- [ ] **Step 1: handoff 처리 교체**

`consume(event:route:)`의 `.handoff` 분기:

```swift
        case .handoff:
            mode = .brief
            remainingText = nil
            etaTask?.cancel()
            etaTask = nil
            // 축이 바뀌므로(경로 거리 → 직선거리) 앵커와 발화 기준을 **둘 다**
            // 새 축 현재값으로 재설정한다. 방향(trend)만 승계한다.
            // ⚠ lastSpokenDistance를 옛 축 값으로 두면 차이가 즉시 마일스톤을 넘겨
            // 전환 직후 거짓 closer 음성이 나간다(반대 방향 전환에서는 장기 억제).
            let straight = freshStraightLineMeters()
            beaconState = BeaconState(
                anchorDistance: straight,
                trend: beaconState.trend,
                lastSpokenDistance: straight,
                nearby: false
            )
            gateState = .initial
            // 톤 축도 같은 규칙 — 다음 추세 fix가 재기준화 후 현재 상태를 1회 알린다.
            toneState.needsRebase = true
            lastRemaining = nil
            lastRemainingAt = nil
            let text = appLocalized("guide.handoff")
            statusText = text
            announce(text)
```

⚠ `freshStraightLineMeters()`가 nil이면(낡은 fix) 앵커도 nil이 되어 다음 fix가 first 경로를 탄다. 그것이 정직한 폴백이다.

- [ ] **Step 2: 전제 조건 가드**

handoff는 다음이 **모두** 성립할 때만 커밋한다(spec §8.2). 리듀서 `guideStep`이 이미 `following`/`bundle`에서만 handoff를 내는지 확인하고, 아니면 앱에서 가드한다:

```bash
grep -n "handoff" ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift | head -20
```

리듀서가 국면 가드를 이미 갖고 있으면 그대로 두고, 투영 점프 가드만 앱에서 덧댄다:

```swift
        case .handoff where lastRemaining != nil && projectionJumpedRecently:
            break  // 신뢰 불가 상태의 잔여 거리가 순간적으로 handoff 거리 아래로
                   // 튄 것만으로 전환하면, 실제 경로가 남았는데 결정 지점 안내가 사라진다.
```

(리듀서가 가드를 갖고 있고 앱 가드가 불필요하면 이 스텝은 "확인만 하고 변경 없음"으로 닫는다. 확인 결과를 커밋 메시지에 적는다.)

- [ ] **Step 3: 빌드**

Run: `cd ios && xcodebuild ... build`
Expected: BUILD SUCCEEDED.

- [ ] **Step 4: 커밋**

```bash
git commit -- ios/Gildongmu/Directions/BeaconModel.swift \
  -m "fix(ios): 축 전환 시 앵커와 발화 기준을 함께 재기준화

경로 거리 500m가 직선 120m가 되는 불연속 전환에서 lastSpokenDistance를 옛 축 값으로
두면 차이 380m가 즉시 마일스톤을 넘겨 거짓 closer 음성이 나간다. 방향만 승계하고
두 기준을 새 축 현재값으로 재설정한다. 톤 축은 needsRebase로 같은 규칙을 탄다."
```

### Task 13: 웹 톤 계층 배선

**Files:**
- Modify: `src/hooks/useRouteGuide.ts`
- Test: `src/components/__tests__/DistanceBeacon.test.tsx`(회귀 확인)

**Interfaces:**
- Consumes: `toneLayerStep`·`motionStep`(M2)

**설계 근거:** 웹은 §3(백그라운드 오디오·음성 억제) 비적용이지만 §4~§8은 전부 적용한다. 상수가 갈리면 "같은 앱"이라는 전제가 조용히 깨진다.

- [ ] **Step 1: 상태 ref 교체**

```typescript
  const toneStateRef = useRef<ToneLayerState>(INITIAL_TONE_LAYER_STATE);
  const motionStateRef = useRef<MotionJudgeState>(INITIAL_MOTION_STATE);
  /** 상세 투영 점프 가드 기준(잔여 거리·시각). */
  const lastRemainingRef = useRef<{ meters: number; at: number } | null>(null);
```

`lastTrendToneAtRef`·`lastTickAtRef`·`detailTickRef`를 삭제하고 `routeTone` 콜백을 계층 소비로 교체한다:

```typescript
  const SOUND_BY_TONE: Record<GuideTone, () => void> = { /* play* 매핑 */ };

  const emitTone = useCallback(
    (input: ToneLayerInput, now: number) => {
      const out = toneLayerStep(toneStateRef.current, input, now);
      toneStateRef.current = out.state;
      if (out.tone) SOUND_BY_TONE[out.tone]();
    },
    [/* play* 전부 */],
  );
```

- [ ] **Step 2: 정지 판정 배선**

```typescript
  const judgeMotion = useCallback(
    (pos: GeolocationPosition, now: number): MotionState => {
      const out = motionStep(
        motionStateRef.current,
        {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          at: now,
        },
        pos.coords.speed,           // ⚠ null 가능 — 0으로 변환하지 않는다
        null,                        // 웹에는 speedAccuracy가 없다
        kindFixed === "car" ? MAX_CAR_SPEED_MPS : MAX_WALK_SPEED_MPS,
      );
      motionStateRef.current = out.state;
      return out.motion;
    },
    [kindFixed],
  );
```

- [ ] **Step 3: `stepBrief`·`stepDetail` 교체**

`stepBrief`에서 `routeTone(result.announce.kind)` 호출을 계층 입력 조립으로 바꾼다(iOS Task 10 Step 4와 같은 구조). `stepDetail`에서 `playAhead()`/`playWarning()` 직접 호출과 tick 하트비트 블록을 제거하고 계층 입력으로 바꾼다(iOS Step 5와 같은 구조).

`handleFix`에서 `judgeMotion`을 호출해 두 경로에 전달한다.

- [ ] **Step 4: 워치독 추가**

웹에는 fix 워치독이 없다(`watchPosition`의 `timeout`만 있고 그건 오류 콜백이다). 추가한다:

```typescript
  /** fix 부재 감시(초). iOS `noFixSeconds`와 동조. */
  const NO_FIX_S = 8;

  useEffect(() => {
    if (status !== "tracking") return;
    const id = window.setInterval(() => {
      const now = performance.now() / 1000;
      const last = lastFixAtRef.current ?? startedAtRef.current;
      if (last === null || now - last < NO_FIX_S) return;
      emitTone(
        { unreliable: true, priorityTone: null, eventOwned: false,
          trend: null, arrived: false, rebaseTrend: false },
        now,
      );
    }, 2000);
    return () => window.clearInterval(id);
  }, [status, emitTone]);
```

`startedAtRef`를 `start()`에서 설정하고 `stop()`에서 비운다.

- [ ] **Step 5: handoff 재기준화**

`stepDetail`의 `if (result.event.kind === "handoff")` 블록에서 `beaconRef.current = INITIAL_BEACON_STATE`를 iOS Task 12와 같은 재기준화로 교체하고 `toneStateRef.current = { ...toneStateRef.current, needsRebase: true }`를 추가한다.

- [ ] **Step 6: 테스트**

Run: `npm run test:run` 그리고 `npm run build`
Expected: 전량 PASS + 타입 검사 통과(Vitest는 트랜스파일만 하므로 `build`가 필수 게이트다).

- [ ] **Step 7: 커밋**

```bash
git commit -- src/hooks/useRouteGuide.ts \
  -m "feat(web): 톤 계층·정지 판정·fix 워치독을 iOS와 동조

웹은 백그라운드 오디오만 비적용이고 톤 의미론·3-state 정지·계층 순서·빈도·재기준화는
전부 같다. GeolocationCoordinates.speed는 무효일 때 null이라 0으로 암묵 변환되지
않게 Optional로 넘긴다(그대로 두면 거짓 정지 tick)."
```

---

## M4: 검증·문서

### Task 14: 변이 주입 점검

**Files:**
- Modify: 테스트 파일들(필요 시 케이스 보강)

**설계 근거:** 계약 테스트가 있다 ≠ 그 축이 지켜진다. 이 저장소에서 전량 green 통과 후 리뷰어의 독립 변이가 결함을 잡은 사례가 여러 번 있다. ⚠ **스텁 기본값이 중간 단계를 항등으로 만들면 순서 계약이 관측 불가가 된다** — 계층 순서 테스트는 **상위 조건과 추세 조건이 동시에 참인 fixture**를 써야 한다.

- [ ] **Step 1: 변이 6종을 하나씩 주입해 실패를 확인**

| # | 변이 | 잡아야 하는 테스트 |
|---|---|---|
| 1 | 계층 배타성 제거(상위 톤과 추세를 동시 산출) | `unreliableWins`·`priorityWins`(앵커 불변 단언) |
| 2 | `speedUnknown`을 `moving`으로 축약 | `speedUnknownNoTick` |
| 3 | 워치독을 fix 구동으로 변경(타이머 제거) | 워치독 통합 테스트(Step 2) |
| 4 | `lastSpokenDistance` 재기준화 누락 | handoff 테스트(Step 3) |
| 5 | `didPromote` 무시하고 항상 원복 | `noRevertWithoutPromotion` |
| 6 | 진입 즉시 1회 제거(간격만) | `unreliableEntryAndInterval` |

각 변이마다: 코드 수정 → 테스트 실행 → **실패 확인** → 되돌리기. 실패하지 않는 변이가 있으면 그 축은 관측 불가이므로 테스트를 보강한다.

- [ ] **Step 2: 워치독 계약 테스트 추가(웹)**

iOS 워치독은 앱 계층이라 직접 테스트가 안 된다. 웹 훅은 테스트 가능하므로 `src/hooks/__tests__/useRouteGuide.watchdog.test.tsx`를 추가한다:

```typescript
// @vitest-environment jsdom
it("fix가 오지 않으면 8초 뒤 신뢰 불가 톤이 난다", async () => {
  vi.useFakeTimers();
  // watchPosition을 콜백 없이 스텁 → fix가 영영 안 온다
  // 8초 경과 → unreliable 사운드 fetch가 발생하는지 확인
});

it("fix가 돌아오면 즉시 현재 상태 톤이 난다", async () => {
  // 워치독 발동 후 fix 1개 주입 → 데드밴드 미달이어도 톤이 나야 한다
});
```

- [ ] **Step 3: handoff 재기준화 테스트 추가(웹)**

```typescript
it("축 전환 시 발화 기준이 새 축 값으로 재설정된다", () => {
  // 경로 잔여 500m에서 handoff → 직선 120m
  // 다음 fix에서 closer 음성이 나가지 않아야 한다(차이 380m가 마일스톤을 넘지 않음)
});
```

- [ ] **Step 4: 최대 침묵 계약 테스트(웹 미러)**

Swift `maxNormalSilence`와 같은 시나리오를 웹에도 추가한다.

- [ ] **Step 5: 전체 게이트**

Run: `npm run test:run && npm run build && cd ios/GildongmuKit && swift test`
Expected: 전량 PASS.

- [ ] **Step 6: 커밋**

```bash
git commit -- <추가·수정한 테스트 파일들> \
  -m "test(guide): 톤 계층 변이 주입 6종과 워치독·재기준화 계약

계약 테스트가 있다 ≠ 그 축이 지켜진다. 상위 조건과 추세 조건이 동시에 참인 fixture로
배타성을 관측 가능하게 만들고, 스텁 기본값이 중간 단계를 항등으로 만드는 함정을 피했다."
```

### Task 15: 독립 리뷰

**설계 근거:** 리뷰는 작업 방식과 무관하게 항상 별도 컨텍스트에 맡긴다. **리뷰어에게 세션 히스토리·생성 의도·중점 지시를 넘기지 않는다** — 요구사항(spec·plan)과 산출물(diff)만 준다. ⚠ 리뷰 디스패치 전에 산출물을 **얼린다**(커밋 SHA를 넘긴다). 트리를 계속 고치면 리뷰어가 읽은 코드와 어긋나 지적 절반이 유령이 된다.

- [ ] **Step 1: 산출물 동결**

```bash
git log --oneline -12
git diff <M0 직전 SHA>..HEAD --stat
```

- [ ] **Step 2: 코드 리뷰 디스패치**

`code-reviewer` 서브에이전트에 spec 경로 + plan 경로 + 커밋 범위만 전달한다. 중점 지시 금지.

- [ ] **Step 3: 접근성 감사 디스패치**

`a11y-auditor` 서브에이전트에 같은 범위를 전달한다. 이 변경은 **소리가 유일한 채널이 되는 상태**를 만들므로 3-state 불변식(0/없음·정보 없음·조회 실패)과 침묵의 의미 구분이 감사 대상이다.

- [ ] **Step 4: 지적 처리**

⚠ **즉시 지엽 패치 금지.** 동일 계층 지적이 2회 이상 반복되면 계층 선택 자체를 의심한다. 기각한 지적은 근거를 남긴다.

- [ ] **Step 5: 반영 커밋**

### Task 16: 문서 갱신과 배포

- [ ] **Step 1: `CLAUDE.md` 갱신**

"실시간 안내" 관련 항목에 다음 계약을 추가한다(간결하게, 항구 규칙만):

```
- **안내 톤은 단일 계층이 정한다**(`toneLayerStep`, Kit ↔ `src/lib/guide-tone-layer.ts`
  미러): 신뢰 불가 → 우선 톤 → 이벤트 소유 → 추세 축 순으로 **배타적**이고, 상위가
  톤을 내면 `trendStep`을 호출하지 않는다(앵커·타이머 불변이라 latch 커밋 문제가
  성립하지 않는다). 간략·상세가 같은 함수를 쓰고 차이는 입력 조립에만 둔다 —
  모드별 계층 로직을 새로 만들지 말 것(같은 `tick`이 두 뜻이던 부채가 형태만 바꿔
  돌아온다). **`tick`은 정지**이고 하트비트가 아니다. ⚠ 최소 재확인 간격 도입은
  폐기한 하트비트의 재등장이라 기각됐다(`maxNormalSilenceS` 21초가 계약값).
- **정지 판정은 도플러 3-state**(`motionStep`): `stopped`/`moving`/`speedUnknown`.
  임계 0.4·0.6·2.0초는 위원장 판정(비장애 보행 90% 기준)이라 재계산 금지.
  ⚠ 웹 `GeolocationCoordinates.speed`는 무효일 때 **`null`**이고 `speedAccuracy`가
  없다 — `speed < 0` 분기를 옮기면 `null`이 0이 되어 거짓 정지 tick이 난다.
- **안내 세션 중 오디오 카테고리는 `.playback`**(iOS, Experimental 구성): 판정은
  `guideAudioStep`이 하고 `didPromote`일 때만 원복한다(받아쓰기·TTS 보호). 백그라운드
  에서 **톤은 남기고 음성만 막는다**(`scenePhase` 게이트 — 한 차례 실측은 API 계약이
  아니다). `UIBackgroundModes: audio`는 `Support/Info-Experimental.plist`에만 둔다.
```

- [ ] **Step 2: `PROGRESS.md` 갱신**

"백그라운드 사운드·톤 커버리지 (2026-08-08 설계 확정, 구현 대기)" 섹션을 구현 완료 기록으로 교체한다. 포함할 것: 구현한 계층 4종, 실기기 판정 대기 목록(§11.2), 남은 초기값(실사용 조정 대상), 변이 주입 결과.

- [ ] **Step 3: 실기기 배포**

```bash
CONFIGURATION=Experimental ./ios/deploy-device.sh
```

- [ ] **Step 4: 웹 배포**

```bash
git push origin main   # Vercel 자동 배포
```

- [ ] **Step 5: 실기기 판정 목록 제시**

위원장에게 판정 항목을 제시한다(spec §11.2):

| 항목 | 방법 |
|---|---|
| 백그라운드 톤 가청 | 잠금 후 도보·차량 이동 |
| 무음 스위치 무시 | 무음 스위치 켠 채 세션 시작 |
| 배경 미디어 위 식별 | 팟캐스트 재생 중 전 톤 청취 |
| 세션 종료 후 원복 | 종료 후 무음 스위치 재존중 |
| 받아쓰기 경합 | 받아쓰기 중 안내 시작·종료 양방향 |
| 전화 인터럽션 | 통화 중·종료 후 복구 |
| route 변경 | AirPods 연결 해제 |
| 정지 임계 | 실보행 저속 구간 |
| 차량 빈도 | 실주행 |
| 배터리 증분 | 세션 전후 비교 |

- [ ] **Step 6: 커밋**

```bash
git commit -- CLAUDE.md PROGRESS.md \
  -m "docs(guide): 백그라운드 사운드·톤 통일 구현 기록"
```

---

## Self-Review

**1. Spec 커버리지**

| spec 절 | 태스크 |
|---|---|
| §3.1 채널별 가청·음성 억제 게이트 | Task 5 |
| §3.2 오디오 세션 소유권 모델·승격 실패 | Task 2·4 |
| §3.3 백그라운드 모드 선언 | Task 3 |
| §4.1 소리 9종·`unreliable` | Task 1·8 |
| §4.3 `trendStep`만 추출·투영 점프 가드 | Task 6·10 |
| §4.4 배타적 계층 순서·정숙 구간·재생 선점 | Task 8(계층·정숙)·4(선점) |
| §4.5 추세 축 내부 순서 | Task 8 |
| §5 3-state 정지·히스테리시스·임계 | Task 7 |
| §5.4 상태별 톤(`speedUnknown` tick 금지) | Task 8 |
| §5.5 도착 종단 | Task 8 |
| §6.1~6.2 커버리지·fix 워치독 | Task 10·11 |
| §6.3 `unreliable` 계약(진입·간격·회복) | Task 8 |
| §6.4 재생기 사망·최대 침묵 21초 | Task 4(`isSilenced` 확장)·8(계약값)·14(테스트) |
| §6.5 전경 복귀 재동기화 | Task 5 |
| §7 빈도(수단별·시간축) | Task 8·10 |
| §8 handoff 재기준화·전제 조건·비정상 전환 | Task 12·13 |
| §9 플랫폼 파급(웹 미러) | Task 6·7·8·13 |
| §10 신규 사운드 선정 | Task 1 |
| §11 테스트·게이트 | Task 2·6·7·8·14 |

**미커버 없음.** §12(비범위)·§13(기각)·§15(리뷰 기록)은 구현 대상이 아니다.

**2. 플레이스홀더 스캔**

Task 12 Step 2가 "리듀서 확인 결과에 따라 분기"인데, 이것은 미정 사항이 아니라 **확인 명령과 두 분기의 처리가 모두 적혀 있는** 조건부다. 나머지 스텝은 전부 실제 코드를 담는다.

Task 8 Step 6(웹 미러)과 Task 13 Step 3은 "Swift와 같은 구조"로 위임했다. 두 곳 모두 **바로 위에 완전한 Swift 원본**이 있고 타입 선언이 명시돼 있으므로 재현 가능하다. 미러 코드를 두 번 적으면 계획서에서 둘이 갈릴 위험이 코드에서 갈릴 위험보다 크다.

**3. 타입 일관성**

- `trendStep`: Task 6 정의 → Task 8에서 `stepped.anchor`·`.trend`·`.kind`로 소비. 일치.
- `MotionState`: Task 7 정의 → Task 8 `TrendInput.motion` → Task 10·13 `judgeMotion` 반환. 일치.
- `ToneLayerInput` 6필드: Task 8 정의 → Task 10·11·13에서 전 필드 명시 생성. 일치.
- `GuideAudioAction`: Task 2 정의(`.none`/`.apply`/`.rebuild`) → Task 4 `dispatch`가 3분기 전부 처리. 일치.
- `BeaconGateStep` 반환: Task 10에서 `(state, nearbyTone, notice)`로 변경 → 같은 태스크 안에서 호출부·테스트 동시 수정. 일치.
- `BeaconFixPayload.speed`: Task 9 추가 → Task 10 `judgeMotion`이 소비. 순서 맞음.

# 안내 효과음이 끝난 뒤 발화(톤·음성 겹침 해소) 설계

2026-08-14. 위원장 실보행 피드백: "임박 큐의 사운드와 VoiceOver 음성이 거의 동시에 나서 음성이 소리에 묻힌다." 같은 날 codex 적대적 설계 리뷰 반영(§10). 구현은 다음 세션.

## 1. 배경 (실사고)

2026-08-09 도입한 도보 결정 지점 임박 큐(`docs/superpowers/specs/2026-08-09-walk-imminent-cue-design.md`)는 결정 지점 앞에서 `ahead` 톤 + 짧은 명령형 문장 + 햅틱 셋을 함께 낸다. 구현상 이 셋은 **같은 fix 처리 안에서 연속으로** 나간다.

- iOS `BeaconModel.handleDetail`: `routeTone(...)`(톤 시작) → 다음 줄 `consume(event:route:)` → `announce(text)`.
- 웹 `useRouteGuide`: `emitTone(...)` → 같은 핸들러의 `announce(text)`.

두 호출 사이 간격이 사실상 0이라, 0.73초짜리 `ahead.mp3`(게인 0.8)가 문장 앞머리를 덮는다. 시각 사용자에게는 화면에 문장이 남아 무해하지만, **스크린 리더 사용자에게는 그 발화가 유일한 전달 채널**이라 앞부분 소실이 곧 정보 소실이다.

같은 기제가 임박 큐에만 있는 것이 아니다. 톤 길이 실측(`afinfo`, `public/sounds/guide/*.mp3` — iOS 번들과 바이트 동일):

| 톤 | 길이(초) | 뒤따르는 발화 |
|---|---|---|
| `nearby`(도착 종) | 2.246 | "도착했습니다" / 도착 추정 종료 |
| `start`·`stop` | 1.332 | 세션 시작·종료 계열 통지 |
| `warning`(이탈) | 0.836 | "경로를 벗어났습니다" |
| `ahead`(임박) | 0.731 | "왼쪽으로 도세요" 등 |
| `tick`(정지) | 0.522 | 없음 |
| `unreliable` | 0.470 | 없음(상태 통지는 별도 경로) |
| `closer`·`farther` | 0.235 | 없음 |

즉 **도착 종(2.25초)이 임박 큐보다 심하다.** 위원장 판정(2026-08-14)으로 이번 작업의 범위는 "긴 톤 전부"이며, 아래 §3의 임계값이 그 목록을 코드에 복제하지 않고 갈라 준다.

## 2. 목표·비목표

- **목표**: 안내 효과음이 재생 중이면 그 소리가 끝난 뒤에 음성 통지를 게시한다. iOS·웹 동시.
- **비목표**:
  - 톤 자체의 길이·게인·햅틱 변경(소리는 그대로 둔다).
  - 임박 거리 상수(`imminentAheadMeters` = 20) 조정 — §7의 열린 판정.
  - 대중교통 안내(`TransitGuideModel`) — 톤 계층이 별개(`transitEventProfile`)이고 실승차 검증이 아직 열려 있다. 같은 결함이 있다면 이 설계를 그대로 적용할 수 있게 판정 함수를 공용으로 둔다.

## 3. 판정 계층 (새 순수 함수, 웹·Kit 미러)

`speechDeferStep` — Kit `GildongmuKit/Sources/GildongmuKit/GuideSpeechGate.swift` + 웹 `src/lib/guide-speech-gate.ts`.

**입력**
- `now: Double` — 단조 시각(초). iOS `ProcessInfo.processInfo.systemUptime`, 웹 `performance.now() / 1000`.
- `toneEndsAt: Double?` — 지금 재생 중인 톤이 끝나는 단조 시각. 톤을 튼 적이 없거나 재생에 실패했으면 `nil`.

**출력**: `Double` — 발화를 미룰 초. `0`이면 즉시 게시.

**판정(순서 고정)**
1. `now`나 `toneEndsAt`이 `nil`이거나 유한하지 않으면 → `0`. **두 인자 모두 유한성을 검사한다**(리뷰 MINOR 2 — `NaN`은 모든 비교를 통과해 그대로 흘러나가고, Swift에서 나노초 정수 변환 시 trap, 웹 `setTimeout(NaN)`은 즉시 실행이 된다).
2. `remaining = toneEndsAt - now`. `remaining < speechDeferThresholdSeconds` → `0`(이미 끝났거나 짧은 톤이라 겹침이 무의미).
3. `min(remaining + speechDeferGapSeconds, speechDeferMaxSeconds)`. **상한은 잘라내기(clamp)이지 무효화가 아니다**(리뷰 MINOR 1 — 초과 시 `0`을 주면 3.000초는 3.15초 대기, 3.001초는 즉시라는 역전이 생기고, mp3가 3.1초짜리로 교체되면 "길이를 따라 자동으로 분류한다"는 계약이 조용히 꺼진다).

### 상수

| 상수 | 값 | 근거 |
|---|---|---|
| `speechDeferThresholdSeconds` | 0.6 | 재생 직후의 `remaining`은 곧 톤 전체 길이이므로 이 선이 §1 표를 정확히 가른다: 통과(지연) = `ahead` 0.731 · `warning` 0.836 · `start`/`stop` 1.332 · `nearby` 2.246, 제외(즉시) = `tick` 0.522 · `unreliable` 0.470 · `closer`/`farther` 0.235. **톤 이름 목록을 코드에 두지 않는 것이 요점**이다 — 목록은 mp3를 교체하면 조용히 어긋나지만 실측 길이는 따라온다. |
| `speechDeferGapSeconds` | 0.15 | 소리 꼬리와 발화가 붙지 않게 하는 여유. `BeaconTonePlayer.endSession()`이 이미 같은 값으로 재생 잔여를 기다린다 — 같은 문제의 같은 여유라 값을 나누지 않는다. |
| `speechDeferMaxSeconds` | 3.0 | 총 대기 상한(§4-5 재평가 루프 포함). 가장 긴 톤 2.246 + 여유. |

⚠ **판정 축은 톤 종류가 아니라 "지금 남은 시간"이다**(리뷰 MAJOR 3에 대한 판정). 리뷰는 "1.33초 `start` 톤이 0.73초 진행된 시점에 들어온 통지는 잔여 0.599초라 즉시 발화되어 재분류가 일어난다"고 지적했으나, **그것이 의도한 동작이다** — 남은 0.6초 미만의 꼬리와 겹치는 것은 짧은 톤과 겹치는 것과 같은 정도이고, 이미 절반 넘게 지나간 소리 때문에 안내를 더 미루는 편이 나쁘다. 임계값에 불연속이 있는 것은 임계값의 정의이지 결함이 아니다. 다만 "재생 직후 remaining = 전체 길이"라는 §3 상수 근거가 **처음 짝지어진 통지에만 성립**한다는 관찰은 옳으므로 여기 명시한다.

⚠ **`warning`(이탈 경고)이 이 임계값에 포함된다.** 위원장에게 제시한 선택지에는 `ahead`·`nearby`·`start`·`stop` 넷만 적었으나 실측에서 `warning`이 0.836초로 `ahead`보다 길다는 사실이 드러났다. 같은 기제·같은 임계값이므로 제외하면 "왜 이것만 예외인가"가 코드에 남는다 — 포함이 강한 디폴트이고, 그 대가는 이탈 경고 문장이 약 0.99초 늦어지는 것이다. 이탈은 지속 상태이며 60초마다 재통지되므로 1초 지연이 행동을 바꾸지 않는다.

## 4. 출력 계약: 지연 슬롯 (이 설계의 핵심)

지연은 발화 창구 **한 곳**에 건다(호출부 20여 곳을 건드리지 않는다). 슬롯은 **하나**이고, 계약은 여섯이다.

### 4-1. 단일 슬롯, latest-wins — 창구와 무관하게

미뤄 둔 문장이 있는데 새 통지가 오면 옛 문장은 **버린다**(큐를 만들지 않는다). 근거는 이미 코드 주석에 있다 — 임박 명령은 "그 임박 구간에서만 참"이라 늦게 말하면 이미 돈 모퉁이를 돌라고 하게 된다. 안내는 최신이 참이다.

⚠ **즉시 발화 창구(`announceNow`)도 진입 즉시 슬롯을 무효화한다**(리뷰 BLOCKER 2). 그렇지 않으면 목적지 변경 확인("목적지가 변경되었습니다")이 즉시 나간 **뒤에** 이전 목적지의 "오른쪽으로 도세요"가 발화한다. latest-wins는 "어느 창구로 들어왔는가"와 무관한 성질이다.

### 4-2. 세션 세대 토큰 — 취소 지점은 `stop()`과 `teardown()` 둘

슬롯은 `(세대, 문장, 예정 시각, Task)`를 들고, **게시 직전에 세대가 현재 세대와 같을 때만** 발화한다. 세대는 `stop()`·`teardown()`·세션 시작에서 증가한다.

⚠ **초안의 "`stop()`에서는 취소하지 않는다"는 틀렸다**(리뷰 BLOCKER 1). 근거로 든 "취소하면 도착 통지가 사라진다"가 호출 순서와 맞지 않는다 — 도착 경로는 `playTone(.nearby)` → `stop()` → `announce(...)`라 **`stop()`이 슬롯을 비운 뒤에 도착 문장이 새로 예약**된다. 취소하지 않으면 반대로, 사용자가 일반 정지를 누른 뒤(정지에는 문장이 없어 슬롯을 대체할 새 통지가 없고 화면도 그대로라 `teardown()`도 안 온다) 약 0.8초 뒤 **끝난 경로의 "왼쪽으로 도세요"가 발화**하고, 그사이 새 세션을 시작했다면 이전 목적지의 명령이 새 세션 안에서 나온다.

⚠ **게시 시점에 `isTracking`을 검사하지 않는다.** 도착 통지는 정의상 `stop()` 이후에 나가야 한다. 판정은 세대 일치 하나다.

### 4-3. Task 취소만으로는 부족하다 — 토큰 확인이 정본

`try? await Task.sleep(...)`은 **취소되면 즉시 반환한다.** 대기 뒤에 `Task.isCancelled`와 토큰 일치를 확인하지 않고 게시하면 취소한 문장이 그 자리에서 발화된다. 슬롯 해제(`slot = nil`)도 **자기 토큰일 때만** 한다 — 무조건 지우면 옛 Task의 종료 코드가 새 슬롯 참조를 지워 `teardown()`이 아무것도 취소하지 못하는 ABA 경합이 된다(리뷰 MAJOR 1).

### 4-4. 게시 실패 처리는 즉시 발화와 **동일**하다 (폐기 특칙 없음)

초안은 "지연 중 억제·백그라운드로 떨어지면 폐기"라고 썼는데, 그것이 **기존 상환 장치를 없애는 회귀**였다(리뷰 BLOCKER 3). 현행 `announce`는 백그라운드면 `missedAnnouncement = true`를 세우고 전경 복귀(`handleScenePhaseChange`)가 갚는다. 도착 통지는 `stop()` 이후라 다음 fix가 없고 반환값도 없으므로, 폐기하면 **전화 한 통·화면 잠금·앱 전환 한 번에 "도착했습니다"가 영구 유실**된다.

**계약: 지연은 타이밍만 바꾸고 실패 처리 계약은 바꾸지 않는다.** 대기가 끝난 뒤 게시 시도는 "그 시점에 `announce`를 부른 것"과 완전히 같은 경로를 지난다(억제 가드 → 전경 가드 → `missedAnnouncement` → 게시).

### 4-5. 게시 직전 톤 상태 재평가 (총 대기 상한 안에서)

예약 이후 **새 톤이 시작될 수 있다**(발화 없는 `tick`·`unreliable`이 예약 시각을 걸쳐 재생되는 모양 — 리뷰 MAJOR 4). 게시 직전에 `speechDeferStep`을 다시 태워 0보다 크면 그만큼 더 기다리되, **예약 시각부터의 총 대기가 `speechDeferMaxSeconds`(3.0)를 넘으면 그대로 게시**한다. 상한이 무한 연기를 구조적으로 막는다.

반대 방향(톤이 선점·인터럽션으로 일찍 끝나 불필요하게 기다리는 경우)은 재평가 대상이 아니다 — 최대 손실이 2초 남짓이고, 조기 발화를 위해 톤 종료 콜백을 배선하면 계층이 하나 더 는다.

### 4-6. 반환값 계약: Bool을 없애고 "떨어지면 갚아라" 콜백으로

iOS `announce`는 "실제로 게시했는가"를 반환하고, 호출부 일부(계단 회피 1회성 경고·최종 접근 진입 서술·억제 해제 상환)가 그 값을 보고 나중에 갚는다. 지연 예약을 `true`로 보고하면 발화 시점 실패가 갚아지지 않고, `false`로 보고하면 같은 문장이 두 번 나간다.

초안은 이를 "상환 대상은 `announceNow`로 즉시 게시"로 갈랐으나, 그러면 **장부는 맞고 가청성은 잃는다**(리뷰 MAJOR 5) — 계단 회피 경고는 경로 조회 직후라 `start` 톤(1.33초) 창과 겹칠 수 있고, 그 위에서 즉시 발화하면 사용자는 못 들었는데 시스템은 전달했다고 기록한다. "게시했는가"라는 **동기 Bool로는 이 계약을 표현할 수 없다는 것**이 문제의 뿌리다.

**최종 형태 — 진입점 둘, 반환값 없음**:

| 진입점 | 지연 | 반환 | 쓰는 곳 |
|---|---|---|---|
| `announce(_:highPriority:onDropped:)` | 함 | `Void` | 자동 통지 전부. 상환이 필요한 문장은 `onDropped` 클로저에 "갚기"를 담는다(억제·백그라운드로 게시하지 못한 **그 시점에** 호출된다). |
| `announceNow(_:highPriority:bypassSuppression:)` | 안 함 | `Void` | 사용자 활성화의 **직접 응답**만(목적지 전환 확인). 즉시성이 그 문장의 본질이라 톤과 겹치더라도 미루지 않는다. |

기존 `if !announce(text, highPriority: true), let notice { pendingStepFreeNotice = notice }` 형태는 `announce(text, highPriority: true) { pendingStepFreeNotice = notice }`로 기계적으로 옮긴다. **반환값을 없애는 것이 강제 수단이다** — 새 호출부가 "게시했는가"를 물어볼 방법 자체가 사라지므로, 상환이 필요하면 `onDropped`를 쓸 수밖에 없다(타입이 1선 방어).

## 5. iOS 배선

- **`BeaconTonePlayer`**: `private(set) var toneEndsAt: Double?`.
  - `play(_:)` **진입 즉시 `nil`로 지우고**, 재생 성공 시에만 `ProcessInfo.processInfo.systemUptime + player.duration`을 대입한다. ⚠ 조기 반환 경로(`appliedCategory == nil`, 리소스 누락, `player.play()` 실패)가 셋이라 "실패했을 때 지운다"로 쓰면 하나를 빠뜨리고, 그러면 **소리가 나지 않는데 이전 톤의 종료 시각 때문에 문장이 미뤄진다**(리뷰 MINOR 3).
  - `shutdown()`에서 `nil`.
  - `endSession()`이 이미 같은 잔여를 `player.duration - player.currentTime`으로 계산한다 — 산출을 한 곳(`remainingPlaybackSeconds`)으로 모아 두 계산이 갈리지 않게 한다.
- **`DeferredAnnouncer`(신설, 작은 전용 타입)**: 슬롯·세대·대기·재평가를 담는다. `BeaconModel`에 인라인하지 않는 이유는 **이 설계에서 가장 위험한 부분이 순수 함수가 아니라 비동기 수명 계약**이고(리뷰 MAJOR 2), 그것을 테스트하려면 시계와 sleep을 주입할 수 있어야 하기 때문이다. `BeaconModel`은 MainActor 거대 클래스라 그 상태로는 테스트가 열리지 않는다.
- **`BeaconModel`**:
  - `announce`/`announceNow`를 §4-6대로 배선하고, 실제 게시(억제·전경 가드 + `AccessibilityNotification.Announcement`)는 공용 `post(_:highPriority:)` 하나로 모은다.
  - 세대 증가: `start()`·`stop()`·`teardown()`.
  - 기존 호출부 중 반환값을 소비하는 곳(계단 회피 3곳·최종 접근 진입 서술·억제 해제 상환 — 구현 시 `grep "announce("`로 전수 확인)은 `onDropped` 형태로, `bypassSuppression`을 쓰는 목적지 전환 확인은 `announceNow`로.
- ⚠ **`playTone`은 억제 중 톤을 내지 않는다**(`guard !outputSuppressed`). 그때는 `toneEndsAt`도 갱신되지 않아 지연이 걸리지 않는다 — 억제 해제 후의 통지가 옛 톤 때문에 미뤄지는 일이 없다.

## 6. 웹 배선

- **`useBeaconSound`**:
  - `play(sound)`가 재생 길이(초)를 반환한다. 버퍼가 없으면 `0`.
  - **`preload(sounds)` 신설.** 웹은 첫 재생이 `fetch` → `decodeAudioData` 왕복이라 길이를 모르고, 그 상태로 두면 **각 톤의 첫 발생에서 결함이 그대로 남는다**(리뷰 BLOCKER 4 — 음성이 먼저 나가고 톤이 뒤늦게 시작해 문장 중간을 덮는다. 첫 발생은 피할 수 없는 정상 경로다). 세션 시작(`play("start")` 자리)에서 긴 톤 3종(`ahead`·`warning`·`nearby`)을 미리 디코드한다. iOS가 로컬 파일 프리로드로 이미 갖는 성질을 웹에 맞춘 것이다.
  - 프리로드가 끝나기 전에 이벤트가 나면 지연 없이 종전대로 동작한다(악화가 아니라 현행 유지). 세션 시작 직후 몇 초 안에 결정 지점이 오는 경우로, 발생 빈도가 낮고 상한 없는 대기를 만들지 않는 편이 낫다.
- **`useRouteGuide`**:
  - `emitTone`이 `toneEndsAtRef.current = now + length`(length가 0이면 갱신 없음).
  - `announce(text)`가 `speechDeferStep`을 태워 0보다 크면 `window.setTimeout`으로 미룬다.
  - ⚠ 기존 `announce`에는 **같은 문자열 재발화용 타이머**(`REANNOUNCE_DELAY_MS` = 120ms, 빈 값을 한 번 거치는 live region 우회)가 이미 있다. 지연 타이머와 **같은 슬롯을 공유**해 latest-wins를 한 곳에서 지킨다 — 타이머 ref를 둘로 늘리면 두 타이머가 서로의 문장을 덮는 경합이 생긴다.
  - ⚠ **낡은 예약 폐기**(리뷰 MAJOR 6): 백그라운드 탭에서 `setTimeout`이 throttling되면 10초 뒤에 깨어나 **이미 지난 모퉁이의 "왼쪽으로 도세요"**를 발화한다(웹에는 iOS의 전경 가드에 해당하는 것이 없고 `mountedRef`는 참인 채다). 예약 시 예정 시각을 함께 담고, 발화 직전 `now`가 예정보다 1초 이상 늦었으면 폐기한다.
  - 세션 세대는 웹에도 둔다(기존 `genRef` 재사용 가능 여부를 구현 시 확인 — 재사용이 안전하지 않으면 발화 전용 세대를 따로).
- 웹에는 억제·상환 장부가 없고 `announce`가 값을 반환하지 않는다(확인 완료) — §4-6의 `onDropped`는 iOS 전용이다.
- 취소는 언마운트 정리 자리(`mountedRef` 해제와 같은 곳) + 세션 정지.

## 7. 대가와 열린 판정

- **임박 명령이 약 0.88초 늦는다**(0.731 + 0.15). 보행 1.4m/s 기준 약 1.2m — 유효 임박 거리가 20m에서 약 18.8m로 줄어든 것과 같다. `imminentAheadMeters`(= 10 + `projectionLagMeters`)는 실보행 재판정으로 정해진 값이라 **이번엔 건드리지 않는다.** 재판정은 `docs/BACKLOG.md`에 남기고 다음 실보행에서 위원장이 판정한다.
- ⚠ **실제 청취 시각은 이 계산보다 더 늦을 수 있다**(리뷰 MAJOR 7). 우리가 통제하는 것은 **게시 시각**뿐이고, VoiceOver가 이미 다른 문장을 읽는 중이면 발화는 그 큐 뒤로 밀린다(`.high`가 아닌 자동 통지는 끼어들지 않는다). 톤 지연과 큐 잔여가 누적되면 명령이 결정 지점을 지난 뒤 들릴 수 있다. **설계로는 해결할 수 없고**(VO 큐를 관측할 수단이 없다) 실기기 판정에 시나리오로 박는다(§8).
- **도착 통지가 약 2.4초 늦는다.** 도착 종이 끝난 뒤 "도착했습니다"가 나간다. 종 자체가 도착 신호라 정보 공백은 아니며, 종에 묻혀 문장을 못 듣던 종전보다 낫다는 판단이다.
- **세션 종료 확인 통지가 약 1.5초 늦는다**(`stop` 톤 1.332 + 0.15). 일반 정지 버튼 경로에는 통지가 없고(톤만) 목적지 변경으로 인한 강제 종료만 문장을 내므로 실제 노출은 드물다. 실기기에서 어색하면 `stop`만 임계값 밖으로 빼는 것이 후퇴선이다.

## 8. 테스트·검증

- **순수 함수 단위 테스트**(웹 `src/lib/__tests__/guide-speech-gate.test.ts` + Kit `GuideSpeechGateTests`): 경계 표를 실측 톤 길이로 고정한다 — 0.235·0.470·0.522는 `0`, 0.731·0.836·1.332·2.246은 `길이 + 0.15`. `nil`·음수·`NaN`·무한(`now`·`toneEndsAt` **양쪽**)은 `0`, 상한 초과는 `3.0`으로 clamp.
- **웹·Kit 드리프트 테스트**: 상수 3종과 판정표를 대조한다(`format-drift.test.ts` 계열의 표 대조 방식).
- **`DeferredAnnouncer` 수명 테스트(iOS, 주입 시계·sleeper)** — 순수 함수만 검사하면 다음 변이가 전부 통과한다(리뷰 MAJOR 2가 열거한 목록 그대로 케이스로 만든다):
  1. 대기 뒤 `Task.isCancelled`·토큰 확인 삭제 → 취소한 문장이 발화되어야 실패로 잡힌다.
  2. `announceNow`의 슬롯 무효화 삭제.
  3. `stop()`·`teardown()`의 세대 증가 삭제.
  4. 게시 시점 억제·전경 재평가 삭제.
  5. 옛 Task가 새 슬롯을 `nil`로 만드는 ABA 경합 삽입.
  6. `onDropped` 미호출.
- **웹 훅 테스트**(vitest, fake timers): ① 긴 톤 뒤 통지가 지연 후에만 live region에 들어간다 ② 지연 중 새 통지가 오면 옛 문장은 끝내 게시되지 않는다 ③ 짧은 톤은 지연 없음 ④ 타이머가 늦게 깨면(시계를 예정+2초로 밀어 놓고 실행) 폐기된다.
- **변이 주입으로 검출력을 실증한다**([[mutation-proves-test-detection-power]]): 위 변이들이 어느 테스트를 깨는지 확인하고 결과를 이 절에 기록한다. 깨지지 않으면 그 축은 테스트가 없는 것이다.

### 변이 주입 실측 결과 (2026-08-14 구현 세션)

구현 참고: 앱 타깃에는 테스트 타깃이 없어 `DeferredAnnouncer`는 §11 표와 달리 **Kit**에 두었고(§5의 "테스트가 열려야 한다"가 상위 요구, `NearbyLoadCore` 선례), 같은 이유로 `announceNow`의 슬롯 무효화도 `DeferredAnnouncer.announceNow`로 내려 Kit 테스트가 강제한다(BeaconModel은 위임만).

| 변이 | 결과 | 깨진 테스트 |
|---|---|---|
| 1. 대기 뒤 토큰·`Task.isCancelled` 확인 삭제 | **검출** | `invalidatedPendingNeverPosts`·`generationAdvanceDropsPending`·`immediateAnnounceDropsPendingFirst`·`announceNowDropsPendingAndPostsImmediately` (4건) |
| 2. `announceNow`의 슬롯 무효화 삭제 | **검출** | `announceNowDropsPendingAndPostsImmediately` 외 2건 |
| 3. 세대 증가 삭제 | **검출(両층 동시 삭제 시)** | `advanceGeneration`은 세대 증가+슬롯 무효화 2층 방어라 한 층만 삭제하면 다른 층이 흡수한다(3a: `generation += 1`만 삭제 → 0건, 3b: `invalidatePending()`만 삭제 → 세대 가드가 잡아 0건 — **각 층이 단독으로 계약을 지킴을 상호 실증**). 両층 삭제(3c)는 `generationAdvanceDropsPending`이 잡는다. 무효화 층 단독 계약은 `invalidatedPendingNeverPosts`가 별도로 잡는다. |
| 4. 게시·실패 판정을 예약 시점에 캡처(게시 시점 재평가 삭제) | **검출** | 10건 일괄 실패(`longToneDefersUntilToneEnds` 등 — 예약 즉시 post가 관측된다) |
| 5. ABA: 슬롯 해제를 무조건 `slot = nil`로 | **미검출(구조상 도달 불가)** | 토큰 가드와 해제 사이에 await가 없다(MainActor 동기 구간) — 가로챈 Task는 해제 라인에 도달하기 전에 토큰 가드에서 반환되므로 이 변이는 의미상 중립이다. 조건부 해제는 가드·해제 사이에 suspension이 끼는 미래 수정에 대한 보험으로 유지한다. |
| 6. `onDropped` 미호출 | **검출** | `onDroppedFiresWhenPostFails` |
| 웹 W1. `announce` 진입 latest-wins 해제 삭제 | **검출** | latest-wins 케이스(옛 예약이 새 문장을 덮음) |
| 웹 W2. 낡은 예약 폐기 삭제 | **검출** | 늦게 깬 타이머 폐기 케이스 |
| 웹 W3. `playTone`의 `toneEndsAt` 기록 삭제 | **검출** | 3건(지연·latest-wins·프리로드 경로) |
| 웹 W4. 세션 시작 `preload` 삭제 | **검출** | 프리로드 케이스 |

**구현 리뷰 반영(2026-08-14, spec-compliance·code-quality 2건)**:
1. **(MAJOR, 채택)** 웹 도착 경로에서 `stop()`의 stop 톤이 nearby 종의 종료 시각을 마지막-이김으로 덮어 "도착했습니다"가 종 꼬리와 다시 겹치는 결함 — 웹 `playTone`을 **더 늦게 끝나는 쪽 유지**로 수정(+회귀 테스트·변이 재검출 확인). iOS는 선점 재생이라 마지막-이김이 옳고 해당 없음(웹 Web Audio는 소스가 겹쳐 울린다는 재생 모델 차이가 정책 차이의 근거).
2. **(MAJOR, 채택 — 두 리뷰 독립 수렴)** 지연 대기 중 **선점(latest-wins)으로 취소된 문장의 `onDropped`가 불리지 않아** 상환 문장(계단 경고·owed 합본)이 게시도 상환도 없이 영구 소실되는 공백. 초안 §4-6의 "게시하지 못한 그 시점" 한정을 다음처럼 정밀화했다 — **선점 폐기(`invalidatePending`, 새 통지·announceNow 진입)는 그 시점에 onDropped를 호출**(게시 실패와 같은 "전달 못함"이므로 장부 보존도 같다), **세션 경계 폐기(`advanceGeneration`)는 onDropped 없이 침묵 폐기**(`stop()`이 장부를 먼저 비우므로 여기서 복원하면 끝난 세션의 경고가 부활하는 역결함). 두 축의 테스트(`supersededPendingFiresOnDropped`·`generationAdvanceDoesNotFireOnDropped`)를 추가했다. 상환된 장부의 실제 재발화 시점은 종전과 같이 전경 복귀(scene-active)다.
- **실기기 판정이 최종 게이트다.** 시뮬레이터는 VoiceOver 발화와 mp3의 겹침을 재현하지 못한다. `CONFIGURATION=Experimental ./ios/deploy-device.sh`로 올린 뒤 실보행에서 확인할 시나리오:
  1. 임박 큐 — 단독 상황.
  2. 임박 큐 — **VoiceOver가 다른 콘텐츠(진행 상황 행 등)를 읽는 중**에 발생(§7의 큐 누적 축).
  3. 빠른 보행에서의 임박 큐 도달 시점.
  4. 이탈 경고.
  5. 도착 종 → 도착 통지.
- 웹은 iOS 판정 전까지 배포 판정을 미루지 않는다(웹 실시간 안내는 실보행 미검증 상태 그대로).

## 9. 설계 리뷰 판정

**적대적 설계 리뷰 대상이다**(글로벌 CLAUDE.md 마일스톤·설계 리뷰 게이트 ①·④): 발화 경로 전체를 지나가는 새 판정 계층을 신설하고(설계 결함이 모든 통지에 복제되는 유형), 실보행 안내라는 1급 사용자 안전 축을 건드린다. 2026-08-14 codex `adversarial-review` 1회 실시 — 결과 §10.

## 10. 리뷰 반영 (2026-08-14 codex)

| 판정 | 지적 | 처리 |
|---|---|---|
| BLOCKER 1 | `stop()` 미취소 시 끝난 경로의 명령이 나중에 발화 | **채택** — §4-2 세대 토큰, 취소 지점 `stop()`+`teardown()`. 초안의 기각 근거(도착 통지 소실)가 호출 순서와 맞지 않았다. |
| BLOCKER 2 | `announceNow`가 슬롯을 무효화하지 않음 | **채택** — §4-1. |
| BLOCKER 3 | 지연 문장 폐기가 도착 통지 영구 유실을 만듦 | **채택** — §4-4. 폐기 특칙을 없애고 기존 실패 처리(`missedAnnouncement` 상환)에 합류. |
| BLOCKER 4 | 웹 첫 재생(cold cache)에서 결함 그대로 | **채택** — §6 `preload`. |
| MAJOR 1 | Task 취소만으론 부족(토큰·ABA) | **채택** — §4-3. |
| MAJOR 2 | iOS 테스트가 순수 함수만 검증 | **채택** — §5 `DeferredAnnouncer` 분리 + §8 변이 6종. |
| MAJOR 3 | 0.6초 판정이 호출 시점에 따라 달라지는 불연속 | **기각(설계 의도)** — §3 말미에 근거 명시. 판정 축이 톤 종류가 아니라 잔여인 것이 의도이며, 이미 지나간 소리 때문에 안내를 더 미루는 편이 나쁘다. 다만 상수 근거의 성립 범위는 명시했다. |
| MAJOR 4 | 예약 후 새 톤 시작을 재평가하지 않음 | **채택** — §4-5(총 대기 상한 안의 재평가). 조기 종료 방향은 기각(계층 추가 대비 이득 없음). |
| MAJOR 5 | `announceNow`는 장부만 맞고 가청성은 잃음 | **채택** — §4-6을 `onDropped` 콜백으로 재설계. |
| MAJOR 6 | 웹 백그라운드 탭 복귀 후 낡은 발화 | **채택** — §6 예정 시각 대조 폐기. |
| MAJOR 7 | 실제 청취 시각은 게시 시각보다 늦을 수 있음 | **부분 채택(문서화)** — 설계로 해결 불가. §7에 한계로, §8에 실기기 시나리오로. |
| MINOR 1 | 3.0초 상한 경계 역전 | **채택** — §3 판정 3을 clamp로. |
| MINOR 2 | `now` 비유한 값 미처리 | **채택** — §3 판정 1. |
| MINOR 3 | 재생 실패 경로에서 `toneEndsAt` 잔류 | **채택** — §5 `play()` 진입 즉시 `nil`. |

## 11. 변경 파일

| 파일 | 변경 |
|---|---|
| `ios/GildongmuKit/Sources/GildongmuKit/GuideSpeechGate.swift` | 신설 — `speechDeferStep` + 상수 3종 |
| `ios/GildongmuKit/Tests/GildongmuKitTests/GuideSpeechGateTests.swift` | 신설 — 경계 표 |
| `ios/Gildongmu/Directions/DeferredAnnouncer.swift` | 신설 — 슬롯·세대·재평가(주입 시계·sleeper) |
| `ios/Gildongmu/Directions/BeaconTonePlayer.swift` | `toneEndsAt` 노출, 잔여 산출 일원화 |
| `ios/Gildongmu/Directions/BeaconModel.swift` | `announce`/`announceNow` 재배선, 세대 증가, `onDropped` 이관 |
| `src/lib/guide-speech-gate.ts` | 신설 — 웹 미러 |
| `src/lib/__tests__/guide-speech-gate.test.ts` | 신설 — 경계 표 + 드리프트 대조 |
| `src/hooks/useBeaconSound.ts` | `play` 길이 반환 + `preload` |
| `src/hooks/useRouteGuide.ts` | `toneEndsAt` 기록, `announce` 지연 게이트(기존 타이머 슬롯 공유), 낡은 예약 폐기 |
| `docs/BACKLOG.md` | 임박 거리 상수 재판정 항목 등록 |
| `CLAUDE.md` | 새 함정 한 줄(소리와 음성은 같은 채널 — 톤 뒤 발화 계약) |

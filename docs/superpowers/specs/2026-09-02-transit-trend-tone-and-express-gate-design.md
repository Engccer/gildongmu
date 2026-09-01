# 2026-09-02 대중교통 안내 판정 계층 4건 — 추세 톤 · riding 계측 · 급행 미도달 게이트 · 출구 번호 낭독

> 세션 transit-guide(plan `docs/superpowers/plans/2026-09-02-backlog-sweep-2-parallel-plan.md` §1). 백로그 식별자: E15 ②(추세 톤) · A16 미확정 ①②(계측) · A16 L1(급행 결정적 미도달) · E25(출구 번호 낭독). §2·§3은 즉시 착수, §4·§5는 transit-data 세션이 `expressStops`·`exit`를 main에 통합한 뒤 착수한다(계약은 plan §1 transit-data 행이 정본이고 이 문서는 그 계약을 **소비**만 한다). §8이 설계 리뷰 판정 기록이다 — 본문은 리뷰 반영 뒤의 개정판이다.

## 0. 전제 (위원장·코디네이터 판정 — 여기서 재논의하지 않는다)

- E15 ② 추세 톤은 **이번에 만든다**(위원장 2026-09-02). 도보 `toneLayerStep`의 계층 구조(배타적 순서·이벤트 소유)를 공유하되 축은 거리가 아니라 **남은 정거장 수**다. 이식이 아니라 신설이다(대중교통은 `toneLayerStep` 호출이 0이고 `BeaconTonePlayer`를 직접 잡아 이벤트 톤만 낸다).
- A16 L1의 데이터원은 ODsay 런타임 캐시(transit-data)이고, 판정은 새 계층이 아니라 **승차 후보 판정의 결정적 미도달 축**(`classifyBoardingCandidates` ↔ `classifyTransitBoardingCandidates`)에 붙는다. 판정 불가(집합 부재)는 차단하지 않는다(종전 `expressCheck` 유지).
- 실험판 봉인 안(`AppConfig.experimentalGuidanceEnabled`). `guidance-gate-drift.test.ts`가 세는 세션 시작 호출 수는 **불변**이다(새 진입점 없음).
- 소리 파일은 손으로 만들지 않는다(`scripts/build-guide-tones.py` 정본). 이 설계는 **새 소리를 만들지 않는다** — 기존 `closer`·`farther`·`unreliable` 셋을 재사용한다.
- "정상 진행 통지와 경고 통지는 빈도가 비대칭"(memory `announcement-frequency-asymmetry`)을 지킨다: 정상 진행(closer)은 낮은 빈도, 경고(farther·unreliable)는 억제하지 않는다.
- 실기기 배포는 하지 않는다(위원장 지시 2026-09-02, 기기 미연결). 게이트는 시뮬 빌드·Kit 테스트까지.

## 1. 성과 정의 (무엇이 측정 가능하게 나아지는가)

| 축 | 지금 | 뒤 | 판정 수단 |
|---|---|---|---|
| E15 ② | 승차 중 첫 관측(`trackingStarted`) 뒤 사다리(잔여 3) 전까지 **소리 0**. 잔여 9→4가 줄어드는 5정거장 동안 주머니 속 사용자는 앱이 살아 있는지 모른다 | 잔여가 한 정거장 줄 때마다 `closer` 1회, 늘면 `farther` 1회, 신호 소실·조회 실패 지속엔 `unreliable` 60초마다 | 공유 fixture(리듀서 입력 → 톤, 웹↔Kit 일치) + 실승차 체감(§2 E15 ② 행) |
| A16 ①② | riding 폴이 `empty`였는지 매칭 실패였는지 로그로 못 가른다. 폴 간격이 실제로 얼마였는지 모른다 | `pollStart`/`pollEnd` 1쌍/폴(단조 시각 차·예정 주기·종료 상태) + `ridePoll` 1줄/응답(상태·매칭·잔여·코드·현재역·나이) + `scene` 전이 | 다음 실승차 로그 회수 |
| A16 L1 | 급행 후보에 "정차 여부 확인 필요"(확인 수단 없는 확인 요구) | 집합이 있으면 **결정적 문장**: 서지 않으면 활성화 차단 + "이 급행은 {하차역}에 서지 않습니다", 서면 "급행, {하차역} 정차". 집합이 없거나 판정 자격 미달이면 종전 문장 | 웹·Kit 단위 테스트 + 실승차(§2 A16 ⑥) |
| E25 | 하차 통지·하차역 행에 출구 정보 없음 | 마지막 탑승 구간의 확정 도착 통지와 하차역 행에 "{N}번 출구 방면" 병기 | 실승차(§2 E5·B2 신규 행) |

## 2. E15 ② 추세 톤 계층 (Kit 순수 ↔ 웹 미러)

### 2.1 도보 계층을 그대로 못 쓰는 이유 (신설 근거)

`toneLayerStep`의 추세 축은 **연속량 거리 + 데드밴드 + 시간 감쇠 + 도플러 정지**다. 대중교통 승차 국면엔 그 넷이 전부 없다: 축은 **정수 정거장 수**(데드밴드 = 1, 감쇠 불요), 관측은 GPS fix가 아니라 **폴 응답**(15~60초), 정지는 판정 근거가 없다(열차의 정차는 정상이고 도플러 같은 독립 관측이 없다 — 거짓 정지 톤 금지 원칙 그대로). 남는 것은 **계층 배타성**과 **앵커 비교**뿐이라 그 둘만 옮긴다.

도보의 우선 톤 단계(`priorityTone`)는 대중교통에서 **이벤트 톤이 그 자리**다 — 리듀서가 입력당 이벤트를 최대 1개 내고 `eventProfile`이 그 톤을 고른다. 그래서 순서가 도보와 다르다: **이벤트 소유가 신뢰 불가보다 앞이다**(§2.3). 도보는 unreliable이 앞인데 fix마다 이벤트가 없는 것이 보통이고, 대중교통은 `signalLost`·`upstreamFailed`·`signalRecovered` 전이가 **항상 이벤트와 함께** 오므로 unreliable을 앞에 두면 한 폴에 경고음 둘(이벤트 weak + 층 unreliable)이 나고 새 재생이 앞 소리를 선점해 첫 경고가 잘린다(설계 리뷰 #1).

### 2.2 타입 (Kit `TransitGuideTone.swift` ↔ 웹 `src/lib/transit-guide-tone.ts`)

```
TransitToneInput {
  unreliable: Bool      // after.signal ∈ {signalLost, upstreamFailed}
  eventOwned: Bool      // 이 스텝의 리듀서 이벤트 != nil
  remaining: Int?       // after.signal == tracking일 때의 after.remaining, 그 외 nil(추세 판정 안 함)
  arrivedCertain: Bool  // after.phase == arrived && after.arrivedCertain
}
TransitToneState { anchorRemaining: Int?, wasUnreliable: Bool, lastUnreliableAt: Double? }  // initial: nil/false/nil
TransitToneKind: closer | farther | unreliable   (BeaconTone 케이스 이름 그대로)
상수 TRANSIT_UNRELIABLE_INTERVAL_S = 60  // 잠정, 실승차 판정

transitToneLayerStep(state, input, now) -> (state, tone?)                       // 순수 층
transitToneStep(state, before: TransitGuideState, after: TransitGuideState,      // 리듀서 결과 → 입력 조립 + 리셋 + 층
                event: TransitGuideEvent?, now) -> (state, tone?)
```

`now`는 초 단위 단조 시각(iOS `systemUptime`, 웹·fixture는 값). **입력 조립은 전부 `after`(리듀서가 돌려준 상태)에서**, 리셋 판정만 `before.phaseGen != after.phaseGen`이다(설계 리뷰 #2 — 앱이 `self.state`를 먼저 대입하면 비교가 항상 같아지므로 조립을 Kit 순수 함수로 내려 앱은 `before`·`after`를 넘기기만 한다).

### 2.3 계층 순서 (배타 — 위 단계가 반환하면 아래는 실행되지 않는다)

```
transitToneStep:
  if before.phaseGen != after.phaseGen → state = initial        // 국면 전이 = 새 잠금·새 대상
  if after.phase ∉ {riding, arrived} → (state, nil)             // 대기·boarding·done엔 적용 안 함
  else transitToneLayerStep(state, input(after, event), now)

transitToneLayerStep:
  0. arrivedCertain     → nil (앵커·타이머 불변. 확정 도착 뒤의 폴은 재관측 감시일 뿐이다.
                          추정 도착(uncertain)은 억제하지 않는다 — 소실이 계속되면 60초 경고가
                          "아직 확인 못 했다"를 계속 말해야 한다, 리뷰 #3)
  장부(항상):  unreliable 진입(wasUnreliable false→true) → lastUnreliableAt = now
              unreliable 이탈(true→false)               → anchorRemaining = remaining ?? anchorRemaining
  1. eventOwned         → anchorRemaining = remaining ?? anchorRemaining;
                          if unreliable { lastUnreliableAt = now };  nil
                          (이벤트가 이 잔여를 이미 말했다. 앵커를 옮기지 않으면 다음 폴에서 같은 값에
                           closer가 나 사다리 발화 직후 중복 진행음이 된다 — 도보의 "앵커 불변"과
                           반대인 이유는 축이 정수라 "말한 값 = 앵커"가 정확히 성립하기 때문.
                           신뢰 불가 중 이벤트(capSlowed·signalRecovered→signalLost 등)는 타이머를
                           지금으로 되돌린다 — 그 이벤트의 소리 뒤 60초 간격이 다시 시작된다)
  2. unreliable         → now - lastUnreliableAt ≥ 60 → lastUnreliableAt = now, unreliable / 그 외 nil
  3. trend              → remaining == nil → nil (앵커 불변)
                          anchor == nil    → anchor = remaining, nil (첫 값은 이벤트가 말한다)
                          remaining < anchor → anchor = remaining, closer
                          remaining > anchor → anchor = remaining, farther
                          같으면 nil
```

`neverSeen`·`notYetVisible`은 `unreliable`이 **아니다**. 첫 관측 전 미등장은 정상(도착 API의 지평 밖)이고, `neverSeen`은 사용자가 행동할 때까지 남는 상태라 60초마다 경고음을 내면 급행 오선택(L1)으로 실제로 타고 있는 사용자에게 여정 내내 경고가 난다. 그 둘은 발화 1회(`neverSeen` 이벤트)와 상태줄이 정본이다.

### 2.4 빈도 계약

- `closer`: 잔여가 줄어든 폴에만 → 정거장당 최대 1회(역간 2~3분). 별도 최소 간격을 두지 않는다(데이터가 폴 사이에 두 정거장을 건너뛰어도 폴당 1회다).
- `farther`: 잔여가 늘어난 폴마다. 식별자 잠금에서 잔여 증가는 데이터 이상(스냅숏 뒤섞임)이거나 오선택이라 경고 축이다. 근사 잠금의 증가는 `approxVehicleChanged` 이벤트가 먼저 소유한다(1단계) — 이 층에 도달하지 않는다.
- `unreliable`: 60초. 도보 10초보다 긴 이유는 관측 주기가 폴(15~60초)이라 그보다 촘촘한 반복이 새 정보를 담지 않기 때문이다. ⚠ 잠정값 — 실승차 판정(§6).
- 잔여 지터(5→4→5→4)가 실제로 있으면 closer/farther가 교대로 난다. **방어 상수를 미리 두지 않는다**(memory `defensive-code-needs-measured-effect`) — 로그(§3 `ridePoll`)로 실측한 뒤 판정.

### 2.5 배선 (`TransitGuideModel`)

```swift
private var toneState = TransitToneState.initial
private func dispatch(_ input: TransitGuideInput) {
    guard let before = state, let route else { return }
    let result = transitGuideStep(state: before, input: input, route: route, now: nowMs())
    self.state = result.state
    ... (기존 override·픽커·계측)
    let tone = transitToneStep(state: toneState, before: before, after: result.state,
                               event: result.event, now: uptime)
    toneState = tone.state
    if let event = result.event { handle(event: event) }     // 이벤트 톤 + 통지(§2.6)
    if let kind = tone.tone { playTone(BeaconTone(kind)); transitGuideLog("tone kind=… anchor=…") }
}
/// 톤 재생 단일 창구 — 억제 가드는 여기 한 곳(BeaconModel.playTone 동형).
private func playTone(_ tone: BeaconTone) { guard !outputSuppressed else { return }; tones.play(tone) }
```

- `handle(event:)`의 이벤트 톤도 `playTone`을 지난다 — 종전엔 `tones.play` 직접 호출이라 **억제 중에도 이벤트 톤이 났다**(리뷰 #4가 잡은 기존 결함, 같은 파일이라 함께 고친다). 층 상태(앵커·타이머)는 억제 중에도 전진한다(억제는 출력 게이트이지 판정 게이트가 아니다).
- 한 dispatch에서 `tones.play`는 최대 1회다: 이벤트가 있으면 층이 nil을 내고(1단계), 없으면 이벤트 톤이 없다. 이 배타성은 fixture(§2.7)가 리듀서 입력 단위로 잠근다.
- `phaseGen`이 바뀌지 않는 전이(도착 추정·`backOnTrack` 복귀)는 앵커를 유지한다 — 같은 열차의 같은 축이다. 사용자 입력(`board`·`advance`·`changeBoarding`)은 전부 `phaseGen`을 올리므로 리셋되고 그 이벤트는 `eventOwned`다. 세션 시작·경로 교체·`stop()`은 `toneState = .initial`.
- 웹 `useTransitGuide`는 배선하지 않는다(웹 대중교통 안내는 설계상 톤 채널이 없다 — 훅 주석 "웹은 톤·interrupting 미적용"). 웹 몫은 순수 미러 + 공유 fixture뿐이다.

### 2.6 소리·재생·발화 계약

- 톤 → 파일: `closer`→`guide-closer`, `farther`→`guide-farther`, `unreliable`→`guide-unreliable`. **신규 파일 0**, `BeaconTones.swift`·`build-guide-tones.py` 무변. 게인(`closer`·`farther` 0.35, `unreliable` 0.45)·햅틱(farther만) 그대로.
- **톤 뒤 발화를 대중교통에도 건다**(리뷰 #5): `TransitGuideModel.announce`가 `AccessibilityNotification`을 직접 게시하던 것을 Kit `DeferredAnnouncer`(도보 선례, spec 2026-08-14)로 바꾼다 — `toneEndsAt`은 `tones.toneEndsAt`, `post`는 억제 가드 → 게시. 자동 통지(이벤트·재개·외부 문장)는 `announce`(지연), 사용자 활성화의 직접 응답(`announceProgress`·새로고침 응답·재조회 통지·경로 교체·목적지 전환)은 `announceNow`(즉시, 보류 슬롯 무효화). 세대는 `beginSession`·`changeRoute`·`stop()`에서 올린다. 종전 순서(톤 → 즉시 발화)가 임박 0.73초·도착 종 2.25초 앞머리를 잘라 먹던 것이 도보와 같은 계약으로 닫힌다.
- 추세 톤은 이벤트가 없는 폴에서만 나므로 같은 스텝에 톤과 문장이 겹치는 경로가 없고, 다른 스텝의 문장(재개 통지 뒤 즉폴의 톤 등)은 위 지연 창구가 톤 잔여만큼 미룬다.
- 억제(`outputSuppressed`)는 톤(`playTone`)·발화(`post`) 둘 다 막고, 전경 전용(백그라운드 폴 정지)은 종전 계약 그대로다.

### 2.7 검증

- 공유 fixture `src/lib/__tests__/fixtures/transit-guide-tone-scenarios.json` — **리듀서 입력 단위**(`transit-guide-scenarios.json`의 `routes`·`locks`를 참조하고 step마다 `{at, input, expect: {tone}}`): 런너가 `transitGuideStep` → `transitToneStep`을 잇는다(웹 `transit-guide-tone.test.ts` ↔ Kit `TransitGuideToneTests.swift`). 리뷰 #6이 요구한 "리듀서부터 톤까지"가 이 구성이다 — 앱에 남는 것은 `playTone`의 억제 가드와 재생뿐이다. 시나리오: ①9→4 정상 진행(closer ×5) ②사다리(3·2·1 이벤트 → 무음, 앵커 이동) ③잔여 증가(farther) ④소실 진입(signalLost 이벤트 → 무음)→60초 뒤 폴(unreliable)→재관측(signalRecovered 이벤트 → 무음, 재앵커) ⑤조회 실패 3회(upstreamFailed 이벤트 → 무음)→60초 뒤 실패 폴(unreliable)→회복 폴(signalRecovered → 무음) ⑥확정 도착 뒤 폴 무음 ⑦추정 도착 뒤 소실 지속 → unreliable ⑧잔여 nil 폴 앵커 불변 ⑨같은 스냅숏 반복 무음 ⑩사다리 직후 같은 값 무음(중복 진행음 차단) ⑪탑승 변경(phaseGen↑) 뒤 재잠금 — 앵커 리셋.
- 변이 주입: 1단계 앵커 이동을 지우면 ⑩이, 순서를 unreliable 우선으로 바꾸면 ⑤의 회복 폴(`upstreamFailed → signalLost` 전이 — 이벤트 `signalRecovered` + 신호 여전히 `signalLost` + 진입 뒤 60초 경과가 **동시에** 성립하는 유일한 자리, 2차 리뷰 #5)이 실패하는지 확인한다. ④의 재관측 폴은 `tracking`이라 unreliable이 거짓이 되어 순서 변이를 못 잡는다.

## 3. A16 미확정 ①② 계측 (`TransitGuideDiag`, 실험판 전용)

| 로그 | 시점 | 필드 | 답하는 질문 |
|---|---|---|---|
| `pollStart seq= phase= sinceLast=…s planned=…s\|-` | `pollOnce` 진입(전 국면) | 직전 폴 시작과의 **단조 시각 차**, 그 폴을 예약한 주기(즉폴은 `-`) | ② 폴이 예상보다 덜 돈 원인(주기 강등 vs 타이머 정지 vs 백그라운드 취소). `sinceLast ≫ planned`면 그 사이를 `scene` 줄로 가른다 |
| `pollEnd seq= status=ok(n)\|empty\|unsupported\|failed\|cancelled elapsed=…s` | `pollStart` 직후 건 `defer`(정확히 1회 — 조기 반환·취소·throw 어느 경로든) | 종료 상태·소요 | fetch 정지·취소가 `pollStart`만 남기는 구멍을 막는다(리뷰 #8, 2차 #6) |
| `scene phase=background\|inactive\|active tracking=` | `handleScenePhaseChange` | 전이 방향 | 잠금·백그라운드가 곧 폴 정지인지(설계상 전경 전용 — 08-16 로그의 11폴/35분이 이 경로였는지 확정) |
| `ridePoll seq= phase= status= matched= remaining= code= loc= age= stamp= signal=` | boarding·riding·arrived 폴 응답 뒤, **dispatch 전** | 잠금 항목 매칭 여부와 그 항목의 잔여·도착 코드·현재역·나이·스냅숏 | ① 폴이 `empty`였는지, 항목은 있는데 잠금 열차가 없었는지(L1 기제), 매칭됐는데 잔여 추출이 실패했는지 |
| `tone kind= anchor=` | §2.5 | 추세 톤 방출 | §2.4 잔여 지터 실측 |

- 매칭은 리듀서와 **같은 순수 함수·같은 입력**으로 센다: `findLockedItem`을 public으로 내고(`transitFindLockedItem` Kit / `findLockedItem` 웹 export), 로그는 dispatch **전의** `state.lock`(리듀서가 그 스텝에서 읽는 값과 동일)에 대해 부른다. 순수 함수라 결과가 같다(리뷰 #7 — 리듀서 출력에 진단 필드를 더하는 대안은 fixture·미러 두 벌을 진단 때문에 넓히므로 기각).
- `logWaitingPoll`은 그대로(대기 전용). `logRidingPoll`은 boarding·arrived도 같은 fetch 대상 계열이라 `phase` 필드로 갈라 한 함수가 맡는다.
- 개인정보(리뷰 #9): 이 로그는 실험판 전용·개발자 기기·저장소 밖 보관(`.gitignore` + `~/gildongmu-private/field-logs/`, CLAUDE.md 오픈소스 규율 ①)이고 `GuideDiag`가 이미 초 단위 좌표를 같은 규율로 남긴다 — 새 정책을 만들지 않는다. 역명(`loc`)은 그 규율 안이다.
- 릴리스 빌드 no-op(자동 클로저) 계약 그대로.

## 4. A16 L1 급행 결정적 미도달 게이트 (transit-data 통합 뒤)

### 4.1 소비 계약 (transit-data가 정한다 — 여기서 정하지 않는다)

`TransitLeg.expressStops?: string[]` — 그 노선의 급행 정차역 이름 **전체 집합**(ODsay `passStopList` 원문), 급행 운행이 있는 노선에만, 조회 실패·미지 노선은 필드 부재. 착수 판정: `git show origin/main:src/lib/types.ts | grep -c expressStops`가 0이면 대기.

이 소비자가 계약에 **더 요구하는 것**(2차 리뷰 #2): `expressStopIds?: string[]`(같은 순서의 ODsay `stationID` 원문). `TransitLegStop.stationId`가 이미 ODsay ID라 **ID 포함 판정은 정규화가 필요 없고 별칭 위험이 0**이다. 이름 판정은 ID가 없을 때의 폴백이며 자격 조건(§4.2 ⓐⓑ)이 붙는다. 복수 패턴 노선의 부재는 소비자가 검증할 수 없으므로 생산자 실호출 게이트(`verify-odsay-express-stops.mjs`)에 "1호선은 부재" 단언을 요구한다.

⚠ **이 소비자가 계약에 요구하는 것 하나**(리뷰 #10): 실시간 후보의 급행 표지(`item.express`)는 등급을 구분하지 않으므로, **한 노선에 정차 패턴이 다른 급행이 둘 이상이면(1호선 급행·특급, 경의중앙선 급행 패턴 복수) 집합 하나로는 어느 후보가 어느 패턴인지 결박할 수 없다.** 그 노선엔 필드가 **부재**여야 한다(부재 = 판정 불가 = 종전 문장). 단일 패턴 노선(9호선)만 집합을 싣는다. 이 요구는 코디네이터를 통해 transit-data에 전달한다(§8 #10).

### 4.2 판정 (웹 `transit-guide.ts` ↔ Kit `TransitGuide.swift`)

```
TransitGuideLeg.expressStops?: string[]        // buildTransitGuideRoute가 leg.expressStops를 그대로 싣는다
expressVerdict(item.express, leg): "skips" | "stops" | "unknown" | null
  express == false                                   → null
  expressStops 부재 ∨ 비어 있음                       → "unknown"   (판정 불가 — 차단 금지)
  판정 자격 미달(아래)                                 → "unknown"
  normalize(alightName) ∈ normalize(expressStops)     → "stops"
  그 외                                               → "skips"     (결정적 미도달 — 활성화 차단)
판정 순서:
  ① ID 판정 — expressStopIds ∧ alightStop.stationId가 있으면 그것으로 끝(포함 stops / 미포함 skips). 정규화 없음.
  ② 이름 판정(ID 부재 폴백) — 자격(둘 다 필요, 리뷰 #11):
     ⓐ normalize(alightName)이 normalize(viaStops 이름)에 있다   — 하차역 이름이 ODsay 표기와 조인된다
     ⓑ normalize(expressStops) ∩ normalize(viaStops 이름) ≠ ∅   — 집합이 이 구간의 표기 관례를 공유한다
     자격 미달은 unknown. ⚠ 2차 리뷰 #2가 지적하듯 ⓑ는 하차역 자체의 별칭을 증명하지 못한다 — 그래서
     이름 경로의 `skips`는 **하차역 이름이 viaStops와 expressStops 둘 다와 같은 원천(ODsay)에서 왔다**는
     전제 위의 잔여 위험이고, 그 위험을 0으로 만드는 것이 ID 계약이다(생산자에 요구).
BoardingCandidate { item, unreachable: "terminatesEarly" | "expressSkipsAlight" | null,
                    express: ExpressVerdict, directionMatched }
```

- `unreachable`이 **활성화 차단의 단일 술어**다(리뷰 #12). 종전 `terminatesEarly: boolean`은 이 필드로 대체하고 소비자(웹 `TransitGuidePanel`·Kit `TransitTrackingSheet`·`logWaitingPoll`)는 `unreachable != null`로 버튼을 만들지 않는다. **선택 진입점도 같은 술어를 본다**(2차 리뷰 #3): iOS `TransitGuideModel.board(item:)`·웹 훅 `board`가 `.board`를 dispatch하기 전에 그 항목을 현재 leg로 다시 판정해 `unreachable`이면 no-op(리듀서는 항목 정보를 받지 않으므로 앱·훅의 단일 진입 함수가 그 경계다 — `boardApprox`·`boardAlready`는 항목이 없어 대상 밖). 사유 문장은 값으로 갈린다. 종착 앞이면서 급행 통과이면 종착이 앞이다(둘 다 결정적이라 어느 쪽이든 차단이고, 문장은 하나만).
- 정규화는 종착 검사와 같은 `normalizeStopName`(부역명 괄호·"역" 접미). 자격 ⓐⓑ가 없으면 별칭·표기 차이가 곧 거짓 "서지 않습니다"가 되므로 두 자격이 없는 미포함은 `unknown`이다 — **차단은 근거가 조인된 이름에서만 나온다.** 2호선 제외(`isLine2Direction`)는 종착 축에만 걸린다(2호선엔 급행이 없다).
- 리듀서(`transitGuideStep`)·잠금·매칭은 이 축을 보지 않는다. "이미 탑승했습니다" 근사 잠금(리뷰 #13)은 대상이 아니다: 근사 잠금은 열차 정체를 정의상 모르고, riding 폴은 **하차역** 도착 목록이라 하차역을 통과하는 급행은 그 목록에 나타날 수 없다(L1의 기제 자체) — 근사 잠금이 고르는 항목은 항상 하차역에 오는 열차다. 남는 위험(사용자가 실제로 탄 급행이 하차역을 지나침)은 어떤 데이터로도 판정할 수 없고 종전 근사 주석("같은 노선의 접근 차량 기준")이 그 한계를 말한다. 그 경로에 확인 프롬프트를 더하는 것은 memory `confirmation-prompt-needs-a-reason-to-decline`에 걸린다.

### 4.3 문장 (공유 descriptor `transit-guide-text.ts` ↔ `TransitGuideText.swift`, 6로케일)

| 키 | ko | en | 자리 |
|---|---|---|---|
| `expressSkipsAlight` | 이 급행은 {stop}에 서지 않습니다 | This express does not stop at {stop} | 차단 행의 사유 줄(`terminatesEarly` 줄과 같은 자리) |
| `expressStopsAt` | 급행, {stop} 정차 | Express, stops at {stop} | 후보 설명 조각(종전 `expressCheck` 자리, verdict `stops`) |
| `expressCheck`(기존) | 급행, {stop} 정차 여부 확인 필요 | (기존) | verdict `unknown` |

`candidateDescLine(..., { express: ExpressVerdict, departedMinutes })`: `unknown`→`expressCheck`, `stops`→`expressStopsAt`, `skips`·null→조각 없음(차단 행은 사유 줄이 급행을 말한다). 새 descriptor `expressSkipsAlightLine(leg)`. `TRANSIT_TEXT_KEYS`·`TRANSIT_TEXT_ARG_NAMES`·iOS 리터럴 switch·공유 fixture `transit-guide-text-cases.json`에 케이스 추가.

### 4.4 검증

- 웹·Kit 단위 테스트: 급행+집합 보유+하차역 포함/미포함/집합 부재/빈 집합/자격 ⓐ 미달/자격 ⓑ 미달/완행, 정규화("노들역"↔"노들"), 종착+급행 동시(종착 문장 우선), 차단 술어 단일성(`unreachable`이 있으면 버튼 없음 — 웹 컴포넌트 테스트).
- 실호출 게이트는 transit-data 몫(`verify-odsay-express-stops.mjs`). 이 세션은 그 응답 모양을 fixture로 옮겨 쓴다.
- 실승차: §2 A16 ⑥에 "급행 후보 문장이 결정적인가"를 더한다.

## 5. E25 출구 번호 낭독 (transit-data 통합 뒤)

### 5.1 소비 계약

`TransitLeg.exit?: { board?: string; alight?: string }` — ODsay `startExitNo`/`endExitNo` 원문, 부재는 필드 부재. **소비자 쪽 형식 게이트**(리뷰 #15): 양끝 공백만 제거한 뒤 `^\d+(-\d+)?$`에 맞지 않는 값은 부재로 본다(가운데 공백을 지우면 `"1 2"`가 12번 출구로 둔갑한다 — 2차 리뷰 #7) — "3번 출구"처럼 단위가 든 원문·빈 문자열·`1·2` 같은 범위는 문장에 넣지 않는다(거짓·중복 단위보다 부재). 실호출에서 다른 문법이 관측되면 transit-data가 계약을 넓히고 이 게이트를 함께 고친다.

### 5.2 투영·문장

- `TransitGuideLeg.exitAlight?: string`(승차 출구는 이번에 소비하지 않는다 — 실을 자리가 없다). 표시 투영 `TransitDisplayLeg.exitAlight: string | null`(조인이 아니라 표시 값이라 투영에 둔다).
- 문장 키 `exitBound`: ko "{exit}번 출구 방면" · en "Toward Exit {exit}" · es "Hacia la salida {exit}" · fr "Vers la sortie {exit}" · it "Verso l'uscita {exit}" · ja "{exit}番出口方面".
- **마지막 탑승 구간에만**(리뷰 #16): 환승 구간의 하차 출구는 개찰구 밖으로 유도할 수 있고 ODsay `endExitNo`가 "역외 이동"을 뜻한다는 보장이 없다. 그래서 `exitAlight`는 `buildTransitGuideRoute`가 **마지막 탑승 leg에만** 싣는다(중간 leg는 부재). 자리 둘: ①**확정 도착 통지**(`arrived(certain: true)` 문장 뒤, `nextLeg` 앞. 추정 도착(`arrivedGuess`)엔 붙이지 않는다 — 리뷰 #14, 전 역에서 신호를 잃은 추정에 출구를 확정형으로 붙이면 잘못 내린다) ②**경유역 목록의 하차역 행**(`viaStopLine` role `alight`에 조각 추가 — 정적 표시). 상태줄·`context`·`boarded`엔 넣지 않는다(잉여).
- 웹 `useTransitGuide` 확정 도착 통지·`TransitGuidePanel` 경유 목록 미러.
- 낭독 형태(리뷰 #17): 하이픈 출구(`2-1`)는 VoiceOver가 "2 대시 1"·"2-1"로 정확히 읽는다(memory `voiceover-hyphen-reads-fine-no-expansion`, 실기기 확정) — 정정 대상은 실기기에서 오독이 확인된 것뿐이다.

### 5.3 판정

- 정확성(그 출구가 목적지 쪽인가, 빠른하차 문과 같은 승강장 끝인가)은 코드로 알 수 없다 — `docs/BACKLOG.md` §2 E5·B2 행에 판정 항목을 더한다.

## 6. 검증·판정 위치 요약

- 게이트: `npm run test:run`(공유 fixture: tone·text·scenarios) · `npx tsc --noEmit` · `npm run lint` · Kit `swift test`(macOS 호스트) · 시뮬 빌드.
- 실승차(§2 표): E15 ②(진행음 체감·지터·60초 unreliable 적절성·톤 뒤 발화 체감) · A16 ①②(로그 회수) · A16 ⑥(급행 문장) · E5·B2(출구 정확성).
- 후속 후보(BACKLOG에만): boarding 국면 접근 진행음.

## 7. 설계 리뷰 게이트 판정

리뷰 **필수**. 근거: ①새 판정 계층·상태 머신(추세 톤 — 설계 결함이 웹·Kit 두 구현에 복제된다) ④안전 축(급행 미도달은 활성화 **차단**이라 오판이 곧 "탈 수 있는 열차를 못 타게" 또는 "못 타는 열차를 타게"다). §3·§5는 단독이면 생략 대상이나 같은 문서에 있어 함께 본다.

## 8. 설계 리뷰 결과 (codex adversarial-review 1차, 2026-09-02, raw `codex exec` spec 본문 주입 — 판정 REJECT 17건)

| # | 심각도 | 판정 | 반영 |
|---|---|---|---|
| 1 | BLOCKER | **수용** | 이벤트 소유를 신뢰 불가보다 앞으로(§2.1·§2.3). 신뢰 불가 중 이벤트는 타이머 재기준화 |
| 2 | BLOCKER | **수용** | 입력 조립을 Kit 순수 `transitToneStep(before, after, event)`로 내림. 앱은 대입 전 `before`를 캡처(§2.2·§2.5) |
| 3 | MAJOR | **수용** | `arrived` → `arrivedCertain`. 추정 도착은 억제하지 않는다(§2.3) |
| 4 | MAJOR | **수용** | `playTone` 억제 가드 신설 — 이벤트 톤의 기존 결함까지 닫는다(§2.5) |
| 5 | MAJOR | **수용** | `DeferredAnnouncer` 채택(§2.6). 종전 "BACKLOG 관측"을 철회 |
| 6 | MAJOR | **수용** | fixture를 리듀서 입력 단위로(§2.7) |
| 7 | MAJOR | **부분 수용** | 같은 순수 함수·같은 입력(dispatch 전 lock)으로 센다. 리듀서 출력 확장은 기각(§3) |
| 8 | MAJOR | **수용** | `pollStart`/`pollEnd` 분리, 취소 상태 기록, 즉폴 `planned=-`(§3) |
| 9 | MAJOR | **기각** | 저장소 밖 보관 규율이 이미 있고 좌표 로그(`GuideDiag`)가 선례. 새 정책 없음(§3) |
| 10 | BLOCKER | **수용(계약 요구로)** | 복수 급행 패턴 노선은 필드 부재 — transit-data 계약 요구(§4.1) |
| 11 | BLOCKER | **수용** | 빈 집합 unknown + 판정 자격 ⓐⓑ(§4.2) |
| 12 | BLOCKER | **수용** | `unreachable` 단일 술어 + 소비자 테스트(§4.2) |
| 13 | BLOCKER | **기각** | 근사 잠금은 하차역 도착 목록에서 고르므로 통과 급행이 후보가 될 수 없다. 남는 위험은 데이터로 판정 불가, 확인 프롬프트는 거절 사유 없는 프롬프트(§4.2) |
| 14 | BLOCKER | **수용** | 확정 도착에만(§5.2) |
| 15 | MAJOR | **수용** | 소비자 형식 게이트(§5.1) |
| 16 | MAJOR | **수용** | 마지막 탑승 구간에만(§5.2) |
| 17 | MINOR | **기각** | 실기기 확정 메모리(하이픈 정상 낭독)와 충돌(§5.2) |

### 2차(확인) 리뷰 — 같은 방식, 판정 REJECT 7건(최소 조건 4)

| # | 심각도 | 판정 | 반영 |
|---|---|---|---|
| 1 | BLOCKER(#13 재) | **기각 유지, 위원장 판정으로 등재** | 근사 잠금이 통과 급행 대신 최근접 완행을 잡는 것은 근사 추적의 정의된 한계(근사 주석)다. 리뷰 처방(급행 노선에서 "이미 탑승" 금지)은 탈출구 삭제라 제품 판정이며, 대안(그 자리에 "급행인가요?" 확인 → 미정차면 차단 문장)은 `docs/BACKLOG.md` A16에 위원장 판정 항목으로 남긴다 |
| 2 | BLOCKER(#10·#11 재) | **수용** | ID 판정을 1순위로(§4.1·§4.2) — 계약 요구(`expressStopIds`) 전달. 이름 경로는 폴백 + 자격 |
| 3 | MAJOR | **수용** | 선택 진입점(`board(item:)`·훅 `board`)에서 `unreachable` 재판정(§4.2) |
| 4 | MAJOR | **기각** | `DeferredAnnouncer`는 게시 직전 톤을 재평가해 예약 뒤 시작된 톤에도 다시 미룬다(§4-5). 남는 것은 즉시 게시된 발화 **중**에 톤이 시작되는 경우인데, 이는 도보와 같은 수용 범위(계약은 "톤 뒤 발화"뿐)다. 재개 직후 즉폴의 겹침 체감은 실승차 판정 행에 넣는다 |
| 5 | MAJOR | **수용** | 변이 킬러를 ⑤ 회복 폴로 옮김(§2.7) — fixture도 그 자리를 갖는다 |
| 6 | MAJOR | **수용** | `pollEnd`는 `defer`(§3) |
| 7 | MINOR | **수용** | 양끝 공백만(§5.1) |

기각 #9·#17은 조건부 타당으로 확인됐다(외부 보관·릴리스 no-op은 코드 게이트가 강제하고, 하이픈 낭독은 실기기 확정). 3차 리뷰는 돌리지 않는다 — 남은 조건 4 중 2·4(수용)는 설계에 박혔고, 1(#13)은 위원장 판정 항목, 3(출력 직렬화)은 근거 있는 기각이다.

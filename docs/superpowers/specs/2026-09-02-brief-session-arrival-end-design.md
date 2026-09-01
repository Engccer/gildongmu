# 간략 세션 도착 종료 + 종료 잔재 정리(A31) 설계

> BACKLOG A31(2026-09-01 등굣길 실보행 접수, 위원장 판정 2건). 축 ①은 세션 수명을 끝내는 판정을 새 국면에 넓히는 안전·정확성 축이라 구현 착수 전 codex 적대적 설계 리뷰를 거쳤다(§8 — BLOCKER 1·MAJOR 5, 이 판은 그 반영본).

## 0. 근거 (실보행 로그 `guide-diag-2026-09-01.log.gz`, KST)

```
08:34:37  session kind=walk / routeOrigin acc=16.1 reason=accepted
08:45:15  briefHandoff reason=tooClose        ← 목적지 12.3m, 상세 → 간략 인계
08:45~09:05  brief 326행, dist 24.3m 고정, acc 5~17m, nearby=true, motion=stopped·speedUnknown
09:05:22  sessionIdleEnd reason=stationary    ← 국면 무관 안전망(무이동 20분)이 대신 종료
17:08:56  퇴근 세션 시작. 같은 코스 역방향은 finalEnter offset=12.5 → arrived=true 정상 종료
```

- 위원장 증상 서술: "아침에 종료하지 않은 안내가 퇴근할 때 종료 모달로 떴고, 경로 조회 화면 상태 표시줄에 그 종료 문장이 남아 있었다." 로그가 확정한 종료 시각은 퇴근이 아니라 아침 09:05다.
- 같은 로그의 08-31 세션도 `briefHandoff reason=tooClose`(6.6m)였다. 코스가 아니라 **최종 접근 진입 시점의 경로 종점 오프셋이 10m 미만인가**가 갈림이다.
- 간략 fix의 `motion`은 정지 20분 동안 `speedUnknown`이 다수, `stopped`가 소수다 — 도플러 정지는 보행 정지 판정 축으로 쓸 수 없다(자동차 `carArrivalStep`은 차량 속도 표본이 있어 성립한다). 정지 축은 **진행 앵커**(`advanceProgressAnchor`, 10m)여야 한다.

## 1. 범위

| 축 | 증상 | 처방(위원장 판정 2026-09-01) |
|---|---|---|
| ① | `tooClose` 간략 인계 세션에 도착 종료가 없다 — 도착권 안에서 20분을 서 있어도 안전망만이 출구 | **도착권에 들어와 멈추면 도착으로 끝낸다.** 기준은 상세 안내가 이미 쓰는 판정과 같은 축 재사용(새 개념 없음). 2026-09-02 착수 판정: **기존 도착 추정 축 그대로**(제자리 5분·두절 3분·150m 캡, `guide.arrivedPresumed`). 기각: 인계 없이 즉시 도착 선언(12m는 아직 걸어가야 하는 거리), 안전망 시간 단축, 도착권 전용 짧은 정지 축 신설(목적지 20m 앞 횡단보도 대기가 "도착"이 된다) |
| ② | 몇 시간 전에 끝난 세션의 종료 화면이 앱 복귀 시 처음 보인다 | **오래된 종료 화면은 조용히 걷어낸다.** 종료 뒤 일정 시간이 지나 백그라운드에서 복귀하면 화면·미뤄진 통지를 함께 버린다. 기준 30분(착수 판정 — 앱 유휴 리셋 10분보다 넉넉해 "잠깐 다른 앱" 사용을 자르지 않는다) |
| ③ | 종료 사유 문장이 길찾기 화면 선두에 영영 남는다 | 판별선을 종료 종류(`endKind`)에서 **실패 상태 잔존 여부**로 |

비목표: 대중교통 세션(`TransitGuideModel`)의 종료 잔재, 웹 화면 배선(웹은 종료 화면이 없고 브라우저 탭은 백그라운드에서 멈춘다), 도착 추정 상수 재판정(E13 실보행 게이트가 정본).

## 2. 축 ① — 도착 창(arrival window): 최종 접근 국면 ∨ 간략 근처 창

### 2.1 개념

도착 추정(`presumedArrivalStep`, spec 2026-08-13)의 1번 조건은 "국면 게이트"다 — 경로 중간 자동 종료 금지의 1선 방어. 종전엔 그 게이트가 **상세 안내의 최종 접근 국면**(`inFinalApproach`) 하나였고, 간략 모드는 애초에 "우리가 목적지 부근에 있다"를 말하는 국면이 없다고 봤다. 그런데 간략 안내에는 그 국면의 재료가 **이미 있다**: Kit `beaconStep`의 `nearby` 래치(목적지 직선거리 ≤ `max(20m, 정확도)`에서 켜지고, `+deadBand(= max(15m, 정확도))`를 넘어야 풀린다 — "목적지 근처 (약 ±Nm)"를 1회 통지하는 바로 그 래치).

⚠ **래치 그대로는 종료 권한이 될 수 없다**(설계 리뷰 BLOCKER): 래치는 정확도로 스케일되고 usable 정확도는 100m까지라, 정확도 100m fix에서는 관측 거리 100m에서 켜지고 200m까지 유지된다. 거리 캡 150m로는 못 막는다(관측 95m·정확도 100m → 두절 3분 → 목적지 미도달 추정 도착). 최종 접근 창은 "경로 종점 도달"이라는 기하 근거가 따로 있지만 간략 창은 fix 하나가 유일한 근거라, 창 자격에 **정확도 상한**을 건다:

```
briefWindowNow = mode == .brief && beaconState.nearby && fix.accuracy <= briefArrivalWindowMaxAccuracyMeters(30)
inArrivalWindow = inFinalApproach || briefWindowActive      // briefWindowActive = 위 술어의 마지막 usable fix 값(저장 플래그)
```

- 30m는 앱이 이미 "도착을 선언할 만큼 믿을 수 있는 정확도"로 쓰는 값이다(`carArrivalMaxAccuracyMeters`, K2 §6.4). 새 뜻의 상수가 아니라 같은 뜻의 두 번째 자리라 테스트가 두 값의 동일을 단언한다. 이 상한 아래에서 래치 진입선은 `max(20, acc) ≤ 30m`, 유지선은 `≤ 60m`, 참 위치는 관측 + 정확도로 `≤ 90m` — 최종 접근 오프셋 실측 상한 89m와 같은 규모다. 09-01 세션(정확도 5~17m)은 전부 자격 안이다.
- 판정 함수 `presumedArrivalStep`은 **바이트 동일**이다(입력 `inFinalApproach`의 뜻이 "도착 창 안인가"로 넓어졌을 뿐 — doc 주석만 갱신). 임계는 종전대로 `tuning.presumedArrival`(walk 180·300·150 / car 120·300·150)이고 `beacon-tuning-wiring.test.ts`의 "프로파일 리터럴 직접 전달 금지"가 유지된다. 거리 캡 150m는 간략 창에서 결코 구속하지 않는다(유지선 ≤ 60m) — 함수를 나누지 않기 위해 남긴다.
- 대상은 `tooClose` 인계만이 아니라 **간략으로 도는 모든 세션**이다: `tooClose`·`noGeometry` 인계, 경로 조회 실패 강등(`fallbackToBrief`), 50m 인계(`handoffDistM`), 실험판 간략 단독 진입. 2026-08-26 spec §2의 "④경로 조회 실패 → 간략 강등 세션(확정 도착 경로 자체가 없다)"이 같은 문으로 닫힌다. 자동차 간략 세션도 `tuning.presumedArrival = .car`로 같은 기계를 탄다(`sessionKind` 분기 없음 — 튜닝 데이터가 가른다).

### 2.2 창 전이 리듀서와 에피소드 상태 (설계 리뷰 MAJOR ①)

창의 진입·이탈은 raw `nearby` 변화가 아니라 **복합 술어의 이전·이후 값**으로 정한다. Kit 순수 함수 `briefArrivalWindowStep(active:nearby:accuracy:) -> (active: Bool, entered: Bool, exited: Bool)`(`FinalApproach.swift`) ↔ 웹 `final-approach.ts` 미러, 공유 fixture `brief-arrival-window-cases.json`(진입·유지·정확도 열화 이탈·래치 해제 이탈·재진입·무효 정확도). 앱은 그 결과로만 상태를 만진다.

도착 추정의 에피소드 상태 네 개(`BeaconModel`)를 도착 창이 소유한다. 이름은 창 기준으로 고친다:

| 종전 | 이후 | 뜻 |
|---|---|---|
| `finalApproachEnteredAt` | `arrivalWindowEnteredAt` | 창 진입 시각(단조). `secondsSinceUsableFix`·`secondsSinceProgress`의 하한 |
| `progressAnchor` / `lastProgressAt` | (동일) | 진행 앵커(10m)·마지막 진행 관측 |
| `lastUsableDistanceToDest` | (동일) | 마지막 usable fix 기준 직선거리(거리 캡 입력) |
| (신설) | `briefWindowActive` | 간략 창 플래그. 워치독(noFix 모양)이 fix 없이 읽는 저장값 |

- **최종 접근 진입**(`beginFinalApproach`, 종전과 동일): 네 값을 진입 시점으로 초기화.
- **간략 창 진입**(`entered`): 같은 초기화(`arrivalWindowEnteredAt = now`, 앵커 nil, 거리 = 그 fix) + `briefWindowActive = true`. 로그 `arrivalWindowEnter mode=brief dist=… acc=…`.
- **간략 창 유지**(`active`, 매 usable fix): `lastUsableDistanceToDest` 갱신 + `advanceProgressAnchor`(10m) → `lastProgressAt`. 최종 접근의 `handleFinalApproach`와 같은 갱신이다.
- **간략 창 이탈**(`exited` — 래치 해제 또는 정확도 > 30m): 네 값 nil + 플래그 false. 로그 `arrivalWindowExit reason=released|accuracy`. 정확도가 나쁜 fix는 "창 밖"이지 "무시"가 아니다 — 무시하면 두절 축이 그 fix들을 건너뛰고 계속 센다.
- **unusable fix**(`isUsableFix` = 정확도 > 0 ∧ 신선 — 100m 상한은 없다): 창 상태 불변. 정확도 30m 초과는 100m 초과를 포함해 전부 "창 밖"(usable이라 `lastFixAt`은 갱신되고 두절 축은 fix **부재**에서만 센다). 09-01 리플레이의 정확도 106.5m 행이 그 모양이다.
- **비-백그라운드 선언 빌드의 전경 복귀 래치 초기화**는 간략 창만 지운다(`if !inFinalApproach`) — 최종 접근 창까지 지우면 `beginFinalApproach`가 다시 돌지 않는 에피소드 안에서 추정 도착이 영구 침묵한다(구현 리뷰 검출).
- **리셋 계약**: `resetFinalApproach`(세션 시작·경로 커밋·재획득·`stop()`)가 플래그까지 지운다 — 경로가 커밋되어 상세로 올라갈 때 옛 간략 창이 살아남지 않는다. `fallbackToBrief`·`beginFinalApproach`의 간략 인계 분기·비-백그라운드 빌드의 전경 복귀 래치 초기화는 `resetArrivalWindow()`(네 값 + 플래그)를 명시 호출한다. 그래서 리뷰의 시나리오("재조회로 잠시 상세였다가 `nearby == true`인 채 `fallbackToBrief` → 옛 300초가 즉시 충족")는 성립하지 않는다: 상세로 올라가는 커밋에서 창이 지워지고, 간략 복귀의 첫 usable fix가 `entered`로 다시 초기화한다.
- 최종 접근과 간략 창은 **배타**다: `inFinalApproach`는 상세 경로 처리(`handleDetail` → `beginFinalApproach`)에서만 참이 되고, 그 진입이 `mode`를 바꾸지 않으며(상세 유지), 간략 인계는 `inFinalApproach`를 세우지 않는다. 한 fix가 두 창에 동시에 있을 수 없다.

### 2.3 트리거와 다른 종료 경로와의 관계 (BACKLOG의 "국면 소유권" 질문)

| 판정 | 트리거 지점 | 순서·배타 근거 |
|---|---|---|
| 확정 도착(상세, ≤15m) | `handleFinalApproach` | 최종 접근 창에서만. 간략 창에는 확정 도착이 없다(간략은 15m 축이 아니라 20m 래치 축이고, 위원장이 즉시 선언을 기각했다) |
| 추정 도착(도착 창) | ①`handleFinalApproach`(종전) ②**간략 fix 처리 말미**(신설, 통지 처리 뒤) ③워치독 `tickWatchdog`(종전, noFix 모양) | `maybePresumeArrival`의 가드가 `inArrivalWindow`로 넓어지는 것 외엔 함수 하나 그대로. `stop()`이 동기로 `isTracking`을 내리므로 같은 턴에 두 번 발동할 수 없다 |
| 국면 무관 안전망 | 워치독, 추정 도착 **뒤** | 종전 순서 그대로(`if maybePresumeArrival { return }; if maybeEndIdleSession { return }`). 09-01 모양에서는 추정 도착(마지막 창 진입 + 300초 ≈ 08:51:50)이 안전망(09:05)보다 13분 먼저 끝내므로 안전망은 도달하지 않는다 — 안전망 상수는 건드리지 않는다(위원장 기각 ⓑ). 설계 리뷰도 세 경로의 이중 발동·순서 역전을 발견하지 못했다 |

간략 fix 처리 안의 호출 자리는 **통지 처리 뒤**다. 창 진입 fix에서는 `secondsSinceProgress = 0`이라 발동할 수 없고, 발동하는 fix에서는 그 fix의 비콘 통지(hold·무발화)가 앞서도 도착 낭독이 `.high`라 잘리지 않는다.

### 2.4 종료 모양

`maybePresumeArrival` 그대로 — `endKind = .presumed`, `guide.arrivedPresumed` "목적지 부근에 도착한 것으로 판단해 안내를 종료했습니다"(`.high`), 종은 전경에서만, `arrivalDest` 대입으로 추정 도착 화면(주변 확인·걸음 요약), prewalk는 종료 화면 없이 대기 국면 연결. 로그 `presumedArrival reason=… dist=… window=final|brief`.

### 2.5 웹

- `src/lib/final-approach.ts`: `presumedArrivalStep` 불변(doc 주석만 갱신), `briefArrivalWindowStep`·`BRIEF_ARRIVAL_WINDOW_MAX_ACC_M` 미러 추가. `useRouteGuide`의 간략 경로 배선은 하지 않는다 — 도착 추정 자체가 웹 화면 배선 없음(spec 2026-08-13 §7, PORTS 후속)이라 간략 창만 먼저 배선하면 최종 접근 창은 없고 간략 창만 끝나는 비대칭이 생긴다. 웹 배선은 PORTS의 도착 추정 행이 열릴 때 두 창을 함께.
- 공유 fixture `presumed-arrival-scenarios.json`에 간략 창 라벨 시나리오를 더한다(같은 함수를 지나므로 입력은 `inFinalApproach: true` — 이름이 "간략 근처 창"임을 적는다): 09-01 모양(stationary 300s·24.3m)·창 밖(래치 해제 = `inFinalApproach: false`) none·창 진입 직후(0·0) none.
- **리플레이 게이트**(`presumed-arrival-replay.test.ts` 계열, 신규 `brief-window-replay.test.ts`): 09-01 등굣길 세션을 fixture로 뗀다(`guide-diag-2026-09-01-brief-window.json` — 인계 이후 `brief` 행의 `t`·`dist`·`acc`·`usable`·`nearby`·경도 평행이동 좌표. 좌표는 앵커 전진 계산에 필요하고 평행이동은 haversine을 보존한다). 창 리듀서 → 앵커 전진 → `presumedArrivalStep`을 재생해 **마지막 창 진입 + 300초에 `stationary`가 나고 그 전엔 침묵**, 발동 시점이 실제 종료(09:05:22)보다 10분 이상 앞임을 잠근다. 실측: 건물 진입 직후 정확도 40→106m fix 10건(인계 36~45초)이 창을 닫고 회복 fix에서 재진입, 발동은 인계 ≈395초 뒤(08:51:50). ⚠ fixture의 `nearby`는 로그가 fix 처리 전에 찍은 값이라 코드보다 한 fix 늦다.

### 2.6 소스 가드 (앱 타깃엔 테스트 레인이 없다)

`beacon-tuning-wiring.test.ts`에 더한다: `maybePresumeArrival` 본문이 `inArrivalWindow`를 읽고 `inFinalApproach` 단독 가드로 되돌아가지 않았는가 · `maybePresumeArrival(` 호출이 세 자리(최종 접근·간략·워치독)인가 · 간략 fix 처리가 `briefArrivalWindowStep(`을 지나는가(앱이 `nearby`를 직접 창 진입 근거로 읽지 않는다) · `resetFinalApproach` 본문이 `briefWindowActive`를 지우는가.

## 3. 축 ② — 오래된 종료 화면 소거

- `BeaconModel.arrivalDest`의 `didSet`이 `endedAt: ContinuousClock.Instant?`를 잡는다: nil→값이면 `.now`, 값→nil이면 nil. 세 종료 경로(확정·추정·`presentEndScreen`)가 따로 기록하지 않는다 — 경로마다 두면 하나가 빠진다(`onSessionEnd` 발화점 규율 동형).
  - 시계는 **`ContinuousClock`**(잠자기 중에도 전진하는 단조 시계)이다. `uptimeNow`(systemUptime)는 잠자기 동안 멈춰 "주머니에 8시간"이 0분으로 읽히고, 벽시계(`Date`)는 앞으로 교정되면 1분 된 새 화면을 30분 지난 것으로 읽는다(설계 리뷰 MAJOR ⑤ — 상태가 프로세스 메모리에만 있어 단조 시계로 충분하다).
- 판정은 Kit 순수 함수 `isEndScreenStale(secondsSinceEnd:)`(`EndScreen.swift`, 상수 `endScreenStaleSeconds = 1800`) ↔ 웹 `src/lib/end-screen.ts`, 공유 fixture `end-screen-stale-cases.json`. 음수·NaN·무한은 **소거하지 않는다**(근거 없는 소거 금지 — 종료 화면은 요약의 유일한 채널이다).
- 트리거는 **백그라운드를 거친 전경 복귀뿐**이다(설계 리뷰 MAJOR ②): `handleScenePhaseChange(.active)`가 **맨 앞에서** `let returnedFromBackground = wasBackgrounded; wasBackgrounded = false`로 플래그를 소비하고(종전엔 `guard isTracking` 뒤에서만 소비해 종료 화면 상태에서 플래그가 영영 남았다 — 제어센터 왕복이 복귀로 오인된다), `returnedFromBackground && arrivalDest != nil && !isTracking && isEndScreenStale(…)`이면 로그 `endScreenExpired age=…` → `pendingFinalApproachIntro = nil`, `pendingStepFreeNotice = nil`, `clearArrival()`. `.inactive` 왕복(제어센터·알림센터)과 전경 체류는 판정하지 않는다.
  - `missedAnnouncement`는 건드리지 않는다(설계 리뷰 MAJOR ③ 부분 수용): 상환 블록은 *현재* `statusText`를 읽으므로, `clearArrival()` 뒤 문장이 남는 경우는 축 ③의 실패 문장뿐이고 그것은 읽혀야 한다(권한 상실 뒤 30분 만에 돌아온 사용자가 들어야 할 것은 종료 사실이 아니라 권한 문장이다). 종료 문장은 `clearArrival()`이 지워 상환 대상에서 빠진다. 종류를 담는 payload 도입은 기각 — 이 한 경로를 위해 통지 구조를 바꾸는 과잉이고 현재 상환 계약("현재 상태 하나만 낭독")이 이미 답이다.
- 앱 루트(`GildongmuApp`)의 `.active` 처리 순서를 바꾼다: `guideSession.handleScenePhaseChange(to:)`를 **유휴 리셋(`resetSession()`)보다 먼저** 부른다 — 뒤에 두면 `TabView` 재생성 시 `screen == .beacon`이 한 프레임 관측되어 옛 시트가 떴다 닫히며 VoiceOver 포커스를 흔든다. 추적 중인 세션은 리셋 대상이 아니라(`!guideSession.isActive` 가드) 순서 변경이 그쪽에 영향을 주지 않는다.
- 화면이 사라지면 루트 `.sheet(item:)`이 닫히고 띠바 요약("{dest} 도착/안내 종료")도 함께 사라진다(`screen`이 nil).
- 앱 유휴 리셋(`IdleReset`, 백그라운드 10분)과의 관계: 리셋은 `TabView`를 재생성할 뿐 `GuideSession.shared`는 싱글턴이라 종료 화면을 건드리지 않는다. 그래서 이 축이 따로 필요하고, 축을 백그라운드 진입 시각이 아니라 **종료 시각**에 거는 이유는 "주머니에 30분 넣고 걷다 종료 2분 뒤 복귀"에서 새 종료 화면을 지우지 않기 위해서다.

## 4. 축 ③ — 종료 문장 잔존

`clearArrival()`의 `if endKind != .stopped { statusText = ""; liveTopText = nil }`를 다음으로 바꾼다:

```swift
liveTopText = nil                       // 시트 내용 — 화면과 수명을 같이한다(실패 문장이 사는 자리가 아니다)
if !status.isFailure { statusText = "" } // Status.isFailure = denied ∨ unavailable
```

- 남아야 하는 것은 "사용자가 할 조치가 있는 실패 문장"이다. 권한 상실 종료는 `stopAndFail` → `stopLeavingSummary`(`.stopped` 종료 화면) → `fail()`이 `status`를 `.denied`/`.unavailable`로 올리고 `statusText`에 실패 문장을 넣는다. 화면을 닫은 뒤에도 그 문장과 복구 버튼(`failResolution`)이 길찾기 탭 선두에 남아야 한다.
- 판별선이 `failResolution != .none`이 **아닌** 이유: 위치 서비스 꺼짐·취득 실패(`.unavailable`)는 앱 설정으로 못 고쳐 `failResolution = .none`인데 문장("하늘이 트인 곳으로")은 남아야 한다. 판별선이 `status == .idle`이 **아닌** 이유(설계 리뷰 MAJOR ④): `.tracking`은 실패가 아니다 — 실패 두 상태를 명시한 `isFailure`가 뜻 그대로다.
- `liveTopText`는 조건 없이 지운다: `fail()`은 `statusText`만 쓰고 `liveTopText`는 옛 안내·종료 문장이라, 실패 상태에 얹혀 남을 이유가 없다.
- 사용자 중지·안전망·추정 도착·확정 도착은 전부 `status == .idle`이라 닫기와 함께 문장이 사라진다 — 2026-08-17 `.arrived` 수정과 같은 결함의 나머지 갈래.
- 범위 밖으로 기록: 실패 상태(`denied`)에서 `teardown()` → `stop()`이 `statusText`·`failResolution`을 지우면서 `status`는 그대로 두는 종전 동작(리뷰 지적). 화면을 떠나는 경로라 표시 소비자가 없고 재시작이 `.tracking`으로 덮는다 — 이 spec은 건드리지 않는다.
- 가드: `beacon-tuning-wiring.test.ts`에 `clearArrival` 본문이 `status.isFailure`를 읽고 `endKind != .stopped`·`status == .idle`을 읽지 않음을 단언(변이 주입 = 옛 조건 복귀가 곧 실패).

## 5. 불변식 (갱신)

- 자동 종료 경로는 셋: 확정 도착(최종 접근, ≤15m) · 추정 도착(**도착 창** = 최종 접근 국면 ∨ 간략 근처 창, `maybePresumeArrival` 단일 함수) · 국면 무관 안전망. 간략 창은 새 경로가 아니라 추정 도착의 국면 게이트 확장이다.
- 추정 도착은 도착 창 밖에서는 불가능하다(판정 함수 구조 + `inArrivalWindow` 가드). 간략 창의 자격은 Kit `briefArrivalWindowStep`(래치 ∧ 정확도 ≤ 30m)이 정본이고 `BeaconModel`이 거리로 재판정하지 않는다.
- 간략 창의 공간 상한은 관측 60m·참 위치 90m다(정확도 상한 30m에서 유도). 이 값을 넓히려면 `carArrivalMaxAccuracyMeters`와 함께 움직인다(동일 단언).
- 종료 화면의 수명은 종료 시각(단조) 기준 30분이고 판정은 백그라운드를 거친 전경 복귀에서만 한다. 소거는 종료 통지도 함께 버리되 실패 문장은 남긴다.
- `clearArrival`이 상태 문장을 남기는 조건은 실패 상태 잔존(`status.isFailure`)뿐이다.

## 6. 검증

- **공유 fixture(웹·Kit)**: `brief-arrival-window-cases.json`(진입·유지·정확도 30 경계·30.1 이탈·래치 해제 이탈·재진입·무효 정확도 유지), `presumed-arrival-scenarios.json` 간략 창 시나리오 3건, `end-screen-stale-cases.json`(1800 경계·직전·음수·NaN·무한).
- **Kit 단위**: `briefArrivalWindowMaxAccuracyMeters == carArrivalMaxAccuracyMeters`, `isEndScreenStale` 무효 입력.
- **리플레이 게이트**: `brief-window-replay.test.ts`(§2.5).
- **소스 가드**: `beacon-tuning-wiring.test.ts` 확장(§2.6·§4) + `isEndScreenStale(`·`returnedFromBackground` 참조.
- **변이 주입**: ⓐ `maybePresumeArrival` 가드를 `inFinalApproach`로 되돌림 ⓑ `clearArrival` 조건을 `endKind != .stopped`로 되돌림 ⓒ 간략 fix 처리에서 `briefArrivalWindowStep` 대신 `nearby`를 직접 읽음 ⓓ `resetFinalApproach`에서 플래그 소거 제거 — 넷 다 소스 가드 실패.
- **실보행 판정**(`docs/FIELD-TEST.md` §3, 실험판): 등굣길 같은 코스 — 인계 뒤 걸어 들어가 멈추면 5분 안에 "부근에 도착한 것으로 판단해 안내를 종료했습니다"와 추정 도착 화면. 퇴근 때 앱을 열면 종료 화면·띠바·상태 문장이 없어야 한다.

## 7. 범위 제외

- 도착 창 전용 짧은 정지 축(1분)·"도착했습니다" 확정 문구: 착수 판정으로 기각(§1).
- 대중교통 세션의 오래된 종료 화면(`pendingWalkHandoff`): 같은 계열이나 다른 모델 — BACKLOG.
- 웹 `useRouteGuide` 도착 창 배선: PORTS 도착 추정 행과 함께.
- 정확도 30~100m 구간의 간략 세션은 이 축으로 끝나지 않는다(안전망 20분이 종전대로 출구). 정확도 상한 완화는 E13 실보행 게이트의 판정 축으로 등록.

## 8. 설계 리뷰 판정 (codex adversarial-review 2026-09-02, gpt-5.x raw exec, spec+코드 발췌 주입)

①새 국면에 세션 종료 판정 확장 + ④실보행 안내 안전 크리티컬 축 해당 → 구현 착수 전 실행. 결과 BLOCKER 1·MAJOR 5.

**수용(설계 반영)**: BLOCKER 정확도 스케일 래치의 종료 권한(→ §2.1 정확도 상한 30m, 기존 `carArrivalMaxAccuracyMeters`와 동일 단언) · MAJOR ① 복합 창의 진입·이탈을 raw `nearby` 변화로 관리(→ §2.2 Kit 리듀서 `briefArrivalWindowStep` + 저장 플래그 + 리셋 계약 명시) · MAJOR ② `.active`가 백그라운드 복귀가 아닐 수 있고 `wasBackgrounded`가 비추적 상태에서 소비되지 않음(→ §3 맨 앞 소비 + `returnedFromBackground` 조건 + 앱 루트 순서 변경) · MAJOR ④ `status == .idle`의 비동치·`liveTopText` 동반 보존(→ §4 `isFailure`·`liveTopText` 무조건 소거) · MAJOR ⑤ 벽시계 전진 교정으로 새 화면 소거(→ §3 `ContinuousClock`).

**부분 수용**: MAJOR ③ `missedAnnouncement` 폐기가 실패 통지를 삼킴 — 지적은 옳으나 처방(출처 payload)은 기각. `missedAnnouncement`를 건드리지 않으면 상환 블록이 현재 `statusText`를 읽어 실패 문장만 남아 읽히고 종료 문장은 `clearArrival()`이 지운다(§3).

**기각(근거 기록)**: 리뷰가 "기각 권고"로 확인한 것과 일치 — 즉시 도착 선언·1분 정지 축·안전망 단축(공간 범위 문제이지 시간 문제가 아니다), 세 종료 경로 순서 변경(이중 발동 없음), prewalk 안전망 적용, `failResolution` 판별선, 무효 경과 시간 소거.

## 9. 파일

- Kit: `FinalApproach.swift`(doc 주석 + `briefArrivalWindowStep`·상수), `EndScreen.swift`(신규), `Tests/FinalApproachTests.swift`(창 fixture·동일 단언 추가), `Tests/EndScreenTests.swift`(신규)
- 앱: `BeaconModel.swift`(§2.2·§2.3·§3·§4), `GildongmuApp.swift`(§3 순서)
- 웹: `src/lib/final-approach.ts`(미러), `src/lib/end-screen.ts`(신규), `src/lib/__tests__/final-approach.test.ts`(창 fixture), `src/lib/__tests__/end-screen.test.ts`(신규), `src/lib/__tests__/brief-window-replay.test.ts`(신규), `src/lib/__tests__/beacon-tuning-wiring.test.ts`(확장), fixture 4종(`brief-arrival-window-cases.json`·`end-screen-stale-cases.json`·`guide-diag-2026-09-01-brief-window.json`·`presumed-arrival-scenarios.json` 추가분)
- 문서: CHANGELOG · BACKLOG A31 종결(+E13 정확도 상한 판정 축) · FIELD-TEST §3 · CLAUDE.md(함정) · `specs/logs/README.md`(fixture 색인)

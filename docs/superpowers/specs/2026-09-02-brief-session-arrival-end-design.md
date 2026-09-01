# 간략 세션 도착 종료 + 종료 잔재 정리(A31) 설계

> BACKLOG A31(2026-09-01 등굣길 실보행 접수, 위원장 판정 2건). 축 ①은 세션 수명을 끝내는 판정을 새 국면에 넓히는 안전·정확성 축이라 구현 착수 전 codex 적대적 설계 리뷰 대상이다(§8).

## 0. 근거 (실보행 로그 `guide-diag-2026-09-01.log.gz`, KST)

```
08:34:37  session kind=walk / routeOrigin acc=16.1 reason=accepted
08:45:15  briefHandoff reason=tooClose        ← 목적지 12.3m, 상세 → 간략 인계
08:45~09:05  brief 326행, dist 24.3m 고정, nearby=true, motion=stopped·speedUnknown
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
| ② | 몇 시간 전에 끝난 세션의 종료 화면이 앱 복귀 시 처음 보인다 | **오래된 종료 화면은 조용히 걷어낸다.** 종료 뒤 일정 시간이 지나 전경 복귀하면 화면·미뤄진 통지를 함께 버린다. 기준 30분(착수 판정 — 앱 유휴 리셋 10분보다 넉넉해 "잠깐 다른 앱" 사용을 자르지 않는다) |
| ③ | 종료 사유 문장이 길찾기 화면 선두에 영영 남는다 | 판별선을 종료 종류(`endKind`)에서 **실패 상태 잔존 여부**로 |

비목표: 대중교통 세션(`TransitGuideModel`)의 종료 잔재, 웹 화면 배선(웹은 종료 화면이 없고 브라우저 탭은 백그라운드에서 멈춘다), 도착 추정 상수 재판정(E13 실보행 게이트가 정본).

## 2. 축 ① — 도착 창(arrival window): 최종 접근 국면 ∨ 간략 근처 래치

### 2.1 개념

도착 추정(`presumedArrivalStep`, spec 2026-08-13)의 1번 조건은 "국면 게이트"다 — 경로 중간 자동 종료 금지의 1선 방어. 종전엔 그 게이트가 **상세 안내의 최종 접근 국면**(`inFinalApproach`) 하나였고, 간략 모드는 애초에 "우리가 목적지 부근에 있다"를 말하는 국면이 없다고 봤다. 그런데 간략 안내에는 그 국면이 **이미 있다**: Kit `beaconStep`의 `nearby` 래치(목적지 직선거리 ≤ `max(20m, 정확도)`에서 켜지고, 히스테리시스 `+deadBand(≥15m)`를 넘어야 풀린다 — "목적지 근처 (약 ±Nm)"를 1회 통지하는 바로 그 래치).

그래서 국면 게이트를 **도착 창**으로 넓힌다:

```
inArrivalWindow = inFinalApproach || (mode == .brief && beaconState.nearby)
```

- 판정 함수 `presumedArrivalStep`은 **바이트 동일**이다(입력 `inFinalApproach`의 뜻이 "도착 창 안인가"로 넓어졌을 뿐 — doc 주석만 갱신). 임계는 종전대로 `tuning.presumedArrival`(walk 180·300·150 / car 120·300·150)이고 `beacon-tuning-wiring.test.ts`의 "프로파일 리터럴 직접 전달 금지"가 유지된다.
- 대상은 `tooClose` 인계만이 아니라 **간략으로 도는 모든 세션**이다: `tooClose`·`noGeometry` 인계, 경로 조회 실패 강등(`fallbackToBrief`), 150m 인계(`handoffDistM`), 실험판 간략 단독 진입. 2026-08-26 spec §2의 "④경로 조회 실패 → 간략 강등 세션(확정 도착 경로 자체가 없다)"이 같은 문으로 닫힌다. 자동차 간략 세션도 `tuning.presumedArrival = .car`로 같은 기계를 탄다(`sessionKind` 분기 없음 — 튜닝 데이터가 가른다).
- 거리 캡 150m는 간략 창에서 결코 구속하지 않는다(래치 해제선 ≤ 35m + 정확도). 캡은 남겨 둔다 — 함수를 나누지 않기 위해서이지 의미가 있어서가 아니다.

### 2.2 에피소드 상태와 소유권

도착 추정의 에피소드 상태 네 개(`BeaconModel`)를 도착 창이 소유한다. 이름은 창 기준으로 고친다:

| 종전 | 이후 | 뜻 |
|---|---|---|
| `finalApproachEnteredAt` | `arrivalWindowEnteredAt` | 창 진입 시각(단조). `secondsSinceUsableFix`·`secondsSinceProgress`의 하한 |
| `progressAnchor` / `lastProgressAt` | (동일) | 진행 앵커(10m)·마지막 진행 관측 |
| `lastUsableDistanceToDest` | (동일) | 마지막 usable fix 기준 직선거리(거리 캡 입력) |

- **최종 접근 진입**(`beginFinalApproach`, 종전과 동일): 네 값을 진입 시점으로 초기화.
- **간략 창 진입**(간략 fix 처리에서 `beaconStep` 결과 `!wasNearby && nearby`): 같은 초기화(`arrivalWindowEnteredAt = now`, 앵커 nil, 거리 = 그 fix). 로그 `arrivalWindowEnter mode=brief dist=…`.
- **간략 창 유지**(`nearby` 유지 중 매 usable fix): `lastUsableDistanceToDest` 갱신 + `advanceProgressAnchor`(10m) → `lastProgressAt`. 최종 접근의 `handleFinalApproach`와 같은 갱신이다.
- **간략 창 이탈**(`wasNearby && !nearby`, 히스테리시스 해제): 네 값 nil. 로그 `arrivalWindowExit`.
- **불변식**: 창 상태는 **창 진입 순간에 항상 재초기화**된다. 그래서 래치가 다른 경로로 풀린 경우(비-백그라운드 빌드의 전경 복귀 `beaconState = .initial`, `rebaseForAxisChange`의 래치 초기화)에 이탈 로그 없이 stale 상태가 남아도 무해하다 — `inArrivalWindow`가 살아 있는 래치를 보므로 판정은 돌지 않고, 다음 진입이 전부 덮는다. 기존 리셋 계약(세션 시작·경로 재획득·목적지 변경·`resetFinalApproach`)은 그대로다.
- 최종 접근과 간략 창은 **배타**다: `inFinalApproach`는 상세 경로 처리(`handleDetail` → `beginFinalApproach`)에서만 참이 되고, 그 진입이 `mode`를 바꾸지 않으며(상세 유지), 간략 인계는 `inFinalApproach`를 세우지 않는다. 한 fix가 두 창에 동시에 있을 수 없다.

### 2.3 트리거와 다른 종료 경로와의 관계 (BACKLOG의 "국면 소유권" 질문)

| 판정 | 트리거 지점 | 순서·배타 근거 |
|---|---|---|
| 확정 도착(상세, ≤15m) | `handleFinalApproach` | 최종 접근 창에서만. 간략 창에는 확정 도착이 없다(간략은 15m 축이 아니라 20m 래치 축이고, 위원장이 즉시 선언을 기각했다) |
| 추정 도착(도착 창) | ①`handleFinalApproach`(종전) ②**간략 fix 처리 말미**(신설, 통지 처리 뒤) ③워치독 `tickWatchdog`(종전, noFix 모양) | `maybePresumeArrival`의 가드가 `inArrivalWindow`로 넓어지는 것 외엔 함수 하나 그대로. `stop()`이 동기로 `isTracking`을 내리므로 같은 턴에 두 번 발동할 수 없다 |
| 국면 무관 안전망 | 워치독, 추정 도착 **뒤** | 종전 순서 그대로(`if maybePresumeArrival { return }; if maybeEndIdleSession { return }`). 09-01 모양에서는 추정 도착(08:50)이 안전망(09:05)보다 15분 먼저 끝내므로 안전망은 도달하지 않는다 — 안전망 상수는 건드리지 않는다(위원장 기각 ⓑ) |

간략 fix 처리 안의 호출 자리는 **통지 처리 뒤**다. 창 진입 fix에서는 `secondsSinceProgress = 0`이라 발동할 수 없고, 발동하는 fix에서는 그 fix의 비콘 통지(hold·무발화)가 앞서도 도착 낭독이 `.high`라 잘리지 않는다.

### 2.4 종료 모양

`maybePresumeArrival` 그대로 — `endKind = .presumed`, `guide.arrivedPresumed` "목적지 부근에 도착한 것으로 판단해 안내를 종료했습니다"(`.high`), 종은 전경에서만, `arrivalDest` 대입으로 추정 도착 화면(주변 확인·걸음 요약), prewalk는 종료 화면 없이 대기 국면 연결. 로그 `presumedArrival reason=… dist=… window=final|brief`.

### 2.5 웹

- `src/lib/final-approach.ts`의 `presumedArrivalStep`은 불변(doc 주석만 갱신). `useRouteGuide`의 간략 경로 배선은 하지 않는다 — 도착 추정 자체가 웹 화면 배선 없음(spec 2026-08-13 §7, PORTS 후속)이라 간략 창만 먼저 배선하면 최종 접근 창은 없고 간략 창만 끝나는 비대칭이 생긴다. 웹 배선은 PORTS의 도착 추정 행이 열릴 때 두 창을 함께.
- 공유 fixture `presumed-arrival-scenarios.json`에 간략 창 라벨 시나리오를 더한다(같은 함수를 지나므로 입력은 `inFinalApproach: true` — 이름이 "간략 근처 창"임을 적는다): 09-01 모양(stationary 300s·24.3m)·창 밖(래치 해제 = `inFinalApproach: false`) none·창 진입 직후(0·0) none.
- **리플레이 게이트**(`presumed-arrival-replay.test.ts` 계열, 신규 `brief-window-replay.test.ts`): 09-01 등굣길 세션을 fixture로 뗀다(`guide-diag-2026-09-01-brief-window.json` — 인계 이후 `brief` 행의 `t`·`dist`·`usable`·`nearby`·경도 평행이동 좌표. 좌표는 앵커 전진 계산에 필요하고 평행이동은 haversine을 보존한다). 창 진입 → 앵커 전진 → `presumedArrivalStep`을 재생해 **인계(08:45:15) 뒤 5분 안에 `stationary`가 나고 그 전엔 침묵**, 발동 시점이 실제 종료(09:05:22)보다 앞임을 잠근다.

### 2.6 소스 가드 (앱 타깃엔 테스트 레인이 없다)

`beacon-tuning-wiring.test.ts`에 더한다: `maybePresumeArrival` 본문이 `inArrivalWindow`를 읽고 `inFinalApproach` 단독 가드로 되돌아가지 않았는가 · `maybePresumeArrival(` 호출이 세 자리(최종 접근·간략·워치독)인가 · 간략 fix 처리가 `advanceProgressAnchor`를 부르는가.

## 3. 축 ② — 오래된 종료 화면 소거

- `BeaconModel.arrivalDest`의 `didSet`이 `endedAt: Date?`(벽시계)를 잡는다: nil→값이면 `Date()`, 값→nil이면 nil. 세 종료 경로(확정·추정·`presentEndScreen`)가 따로 기록하지 않는다 — 경로마다 두면 하나가 빠진다(`onSessionEnd` 발화점 규율 동형). `uptimeNow`(systemUptime)는 기기 잠자기 동안 멈추므로 쓰지 않는다(BACKLOG 착수 조건).
- 판정은 Kit 순수 함수 `isEndScreenStale(secondsSinceEnd:)`(`EndScreen.swift`, 상수 `endScreenStaleSeconds = 1800`) ↔ 웹 `src/lib/end-screen.ts`, 공유 fixture `end-screen-stale-cases.json`. 음수(시계 역행)·NaN·무한은 **소거하지 않는다**(근거 없는 소거 금지 — 종료 화면은 요약의 유일한 채널이다).
- 트리거는 `handleScenePhaseChange(.active)` **맨 앞**(미뤄진 통지 상환 블록보다 앞): `arrivalDest != nil && !isTracking && isEndScreenStale(…)`이면 로그 `endScreenExpired age=…` → `missedAnnouncement = false`, `pendingFinalApproachIntro = nil`, `pendingStepFreeNotice = nil`, `clearArrival()`. 미뤄진 종료 낭독은 함께 버린다(헌장 §6 ⑨ 이탈 게이트 동형 — 맥락 밖 낭독 금지). 그날 걸음·칼로리 요약을 놓치는 것은 수용(위원장).
- 화면이 사라지면 루트 `.sheet(item:)`이 닫히고 띠바 요약("{dest} 도착/안내 종료")도 함께 사라진다(`screen`이 nil). 전경 체류 중 30분은 판정하지 않는다(트리거는 복귀뿐 — 판정 원문).
- 앱 유휴 리셋(`IdleReset`, 백그라운드 10분)과의 관계: 리셋은 `TabView`를 재생성할 뿐 `GuideSession.shared`는 싱글턴이라 종료 화면을 건드리지 않는다. 그래서 이 축이 따로 필요하고, 축을 백그라운드 진입 시각이 아니라 **종료 시각**에 거는 이유는 "주머니에 30분 넣고 걷다 종료 2분 뒤 복귀"에서 새 종료 화면을 지우지 않기 위해서다.

## 4. 축 ③ — 종료 문장 잔존

`clearArrival()`의 `if endKind != .stopped { statusText = ""; liveTopText = nil }`를 **`if status == .idle`**로 바꾼다.

- 남아야 하는 것은 "사용자가 할 조치가 있는 실패 문장"이다. 권한 상실 종료는 `stopAndFail` → `stopLeavingSummary`(`.stopped` 종료 화면) → `fail()`이 `status`를 `.denied`/`.unavailable`로 올리고 `statusText`에 실패 문장을 넣는다. 화면을 닫은 뒤에도 그 문장과 복구 버튼(`failResolution`)이 길찾기 탭 선두에 남아야 한다.
- 판별선이 `failResolution != .none`이 **아닌** 이유: 위치 서비스 꺼짐·취득 실패(`.unavailable`)는 앱 설정으로 못 고쳐 `failResolution = .none`인데 문장("하늘이 트인 곳으로")은 남아야 한다. `status`가 정확히 "실패 상태가 지금 남아 있는가"다(`stop()`은 추적 중이던 세션만 `.idle`로 내리고, `fail()`은 그 뒤 실패 상태를 올린다).
- 사용자 중지·안전망·추정 도착·확정 도착은 전부 `status == .idle`이라 닫기와 함께 문장이 사라진다 — 2026-08-17 `.arrived` 수정과 같은 결함의 나머지 갈래.
- 가드: `beacon-tuning-wiring.test.ts`에 `clearArrival` 본문이 `status == .idle`을 읽고 `endKind != .stopped`를 읽지 않음을 단언(변이 주입 = 옛 조건 복귀가 곧 실패).

## 5. 불변식 (갱신)

- 자동 종료 경로는 셋: 확정 도착(최종 접근, ≤15m) · 추정 도착(**도착 창** = 최종 접근 국면 ∨ 간략 근처 래치, `maybePresumeArrival` 단일 함수) · 국면 무관 안전망. 간략 창은 새 경로가 아니라 추정 도착의 국면 게이트 확장이다.
- 추정 도착은 도착 창 밖에서는 불가능하다(판정 함수 구조 + `inArrivalWindow` 가드). 간략 창은 Kit `beaconStep`의 래치가 정본이고 `BeaconModel`이 거리로 재판정하지 않는다.
- 종료 화면의 수명은 종료 벽시계 기준 30분이고 판정은 전경 복귀에서만 한다. 소거는 통지도 함께 버린다.
- `clearArrival`이 상태 문장을 남기는 조건은 실패 상태 잔존(`status != .idle`)뿐이다.

## 6. 검증

- **공유 fixture(웹·Kit)**: `presumed-arrival-scenarios.json` 간략 창 시나리오 3건, `end-screen-stale-cases.json`(1800 경계·직전·음수·NaN·무한).
- **리플레이 게이트**: `brief-window-replay.test.ts`(§2.5).
- **소스 가드**: `beacon-tuning-wiring.test.ts` 확장(§2.6·§4) + `isEndScreenStale(` 참조.
- **변이 주입**: ⓐ `maybePresumeArrival` 가드를 `inFinalApproach`로 되돌림 → 소스 가드 실패 ⓑ `clearArrival` 조건을 `endKind != .stopped`로 되돌림 → 소스 가드 실패 ⓒ 간략 fix 처리의 앵커 전진 제거 → 소스 가드 실패.
- **실보행 판정**(`docs/FIELD-TEST.md` §3, 실험판): 등굣길 같은 코스 — 인계 뒤 걸어 들어가 멈추면 5분 안에 "부근에 도착한 것으로 판단해 안내를 종료했습니다"와 추정 도착 화면. 퇴근 때 앱을 열면 종료 화면·띠바·상태 문장이 없어야 한다.

## 7. 범위 제외

- 도착 창 전용 짧은 정지 축(1분)·"도착했습니다" 확정 문구: 착수 판정으로 기각(§1).
- 대중교통 세션의 오래된 종료 화면(`pendingWalkHandoff`): 같은 계열이나 다른 모델 — BACKLOG.
- 웹 `useRouteGuide` 도착 창 배선: PORTS 도착 추정 행과 함께.

## 8. 설계 리뷰 판정 (codex adversarial-review 2026-09-02)

(리뷰 뒤 기입)

## 9. 파일

- Kit: `FinalApproach.swift`(doc 주석), `EndScreen.swift`(신규), `Tests/EndScreenTests.swift`(신규), `FinalApproachTests.swift`(fixture 추가분 자동 통과)
- 앱: `BeaconModel.swift`(§2.2·§2.3·§3·§4)
- 웹: `src/lib/final-approach.ts`(doc 주석), `src/lib/end-screen.ts`(신규), `src/lib/__tests__/end-screen.test.ts`(신규), `src/lib/__tests__/brief-window-replay.test.ts`(신규), `src/lib/__tests__/beacon-tuning-wiring.test.ts`(확장), fixture 3종
- 문서: CHANGELOG · BACKLOG A31 종결 · FIELD-TEST §3 · CLAUDE.md(함정 3줄) · `specs/logs/README.md`(fixture 색인)

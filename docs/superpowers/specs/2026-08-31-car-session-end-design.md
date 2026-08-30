# 자동차 세션 종료 보강 (K2-a) 설계

> 2026-08-31. 병렬 계획 `docs/superpowers/plans/2026-08-31-car-session-end-parallel-plan.md` §1의 확정 판정을 구현하는 설계다. 판정 자체는 재론하지 않는다.
>
> **설계 리뷰 게이트: 적용** — ④ 안전·정확성 축(세션 자동 종료는 "경로 중간 자동 종료 금지"와 한 끗이고, 도착 추정의 국면 게이트를 자동차로 넓히는 일이라 설계에서만 잡을 수 있는 결함이 있다). 결과는 §8.

## 0. 근거 (실주행 로그)

`~/gildongmu-private/field-logs/guide-diag-2026-08-29.log.gz`(회전 원본, 08-22 주행 포함). 수치는 이 spec 작성 시 직접 집계했다.

| 축 | 2026-08-29 서울역→자택 (실사고) | 2026-08-22 자택→송추 (K2 §0) |
|---|---|---|
| fix 간격 > 20초 | **0건** (1초 주기 유지) | 터널 5구간 46~**183초** |
| 도플러 정지(`stopped`) 연속 ≥ 60초 | 65·65·73초 (신호 대기 3회) | — |
| 종료 | 19:28:50 `finalApproachEnter`가 **마지막 줄**, 세션은 새벽까지 생존 | — |

원인 세 겹(BACKLOG K2-a): ①자동차 라우트에는 `finalApproach` 기하가 없어 `beginFinalApproach`가 국면을 열지 못하고 간략 인계로 빠진다 → `carArrivalStep`은 도달 불가 ②간략 경로는 세션을 끝내는 길이 없고 `guideDiagLog`도 없다(로그 침묵의 원인) ③안전망 둘(`maybePresumeArrival`·`maybeEndIdleSession`)이 도보 전용.

## 1. 범위

- 자동차 세션(`sessionKind == .car`)이 목적지에서 **스스로 끝난다**: 확정 도착(`carArrivalStep`)이 도달 가능해지고, 그 뒤를 도착 추정(car 프로파일)과 국면 무관 안전망(두절 축만)이 받친다.
- 간략(직선) 경로에 fix당 1줄 계측을 넣는다.
- 웹은 순수 함수·공유 fixture만 미러한다(car 실시간 안내 UI 배선은 비범위, K2 §7과 같다).
- 비범위: 도보 세션 동작 변경 0(동결). 대중교통 세션 무관. 시작 호출 수(`guidance-gate-drift`) 불변.

## 2. 최종 접근 진입 — car는 기하 없이 들어간다

`BeaconModel.beginFinalApproach`의 분기를 **수단으로** 가른다.

```
guard let geometry, geometry.unavailableReason != .tooClose else {
    // 종전: 무조건 간략 인계
    // 변경: car면 국면을 연다(기하 없이). walk는 종전 그대로 간략 인계(구버전 응답 방어).
}
```

- 갈림의 근거는 수단 switch가 아니라 **튜닝 값 `GuideTuning.entersFinalApproachWithoutGeometry`**(walk `false`, car `true`, 웹 미러)다 — 이 결정이 순수 데이터가 되어 튜닝 테스트가 잠근다(설계 리뷰 #8).
- **진입 후조건은 기하 유무와 무관하게 하나다**(설계 리뷰 #7): 종전 guard **아래** 블록(`inFinalApproach = true`·`finalApproachIntroSpoken = false`·`lastFinalTickAt = nil`·`finalApproachEnteredAt = uptimeNow`·`progressAnchor = nil`·`lastProgressAt = nil`·`lastUsableDistanceToDest` 시드)이 두 경우 모두 그대로 돈다. 기하가 있으면 `finalEnter offset=` 로그, 없으면 `finalEnter offset=-` 로그. `finalApproachGeometry`는 nil이므로 진입 서술 분기(`if !finalApproachIntroSpoken, let geometry`)가 스스로 건너뛴다 — 별도 플래그를 세우지 않는다(진입 서술은 기하가 있어야 성립하고, 차는 문 앞에 서지 못하므로 종점→목적지 방향은 원래 불필요 — 계획 §1.1).
- 첫 발화: 진입 서술이 없으므로 **진입 fix에서 곧바로 첫 주기 통지**(`finalApproachTick`: 거리·방향)를 낸다. 종전 코드는 `lastFinalTickAt == nil`이면 시각만 세우고 15초를 기다렸는데, 그 15초는 도보에서 진입 서술이 방금 나갔기 때문에 있는 간격이다. 서술이 없는 진입에서 15초 침묵은 시속 36km면 150m — 국면 전체가 무음이 된다. 구현: `if let last = lastFinalTickAt, now - last < interval { return }`로 바꾼다. walk는 진입 fix에서 서술이 `lastFinalTickAt = now`를 세우고 return하므로 **동작 불변**.
- `handleFinalApproach` 나머지(도착 판정 `carArrivalStep` 40m·정지·acc≤30, 추세 톤, 거리 캡 입력 갱신)는 종전 코드가 그대로 산다. 이 spec이 살리는 것이지 새로 쓰는 것이 아니다.
- 리듀서 6b(`finalApproachEnter`, 종점 150m)는 이미 car에서 난다(08-29 로그 실증). 리듀서 변경 없음.

⚠ `mode`는 `.detail`로 남는다 — `arrivedNow`(간략 전용)와 워치독 톤의 종전 관계가 도보 최종 접근과 같다.

## 3. 도착 추정 — car 프로파일

### 3.1 상수를 프로파일로 분리한다

Kit `FinalApproach.swift` ↔ 웹 `final-approach.ts`:

```swift
public struct PresumedArrivalThresholds: Sendable, Equatable {
    public let noFixSeconds: Double
    public let stationarySeconds: Double
    public let maxDistanceMeters: Double
    public static let walk = .init(noFixSeconds: 180, stationarySeconds: 300, maxDistanceMeters: 150)  // 종전 값
    public static let car  = .init(noFixSeconds: 120, stationarySeconds: 300, maxDistanceMeters: 150)
}
public func presumedArrivalStep(inFinalApproach:, secondsSinceUsableFix:, secondsSinceProgress:,
                                lastKnownDistanceToDestMeters:, thresholds:) -> PresumedArrivalReason?
```

`thresholds`는 **기본값 없는 필수 인자**다([[no-default-for-safety-parameters]]). 종전 전역 상수 `presumedArrivalNoFixSeconds`류는 `.walk`의 필드로 흡수하고 이름을 지운다(웹 `PRESUMED_ARRIVAL_*` 동일). `SessionIdle` 테스트의 "안전망이 도착 추정보다 느슨하다" 단언은 `.walk`·`.car` 둘 다에 건다.

### 3.2 car 값의 근거 (잠정 — B1 실주행 판정)

| 축 | walk | car | 근거 |
|---|---|---|---|
| 두절(noFix) | 180 | **120** | 이 축이 잡는 것은 **지하 주차장 진입**이다. 도보의 180초는 건물 진입 뒤 wifi 측위가 드문드문 이어지는 구간을 기다리는 값인데, 차는 지하로 내려가는 순간 fix가 끊기고 운전은 그때 끝난다. 종점 150m 안(국면 게이트)에서 120초 이상 fix가 끊기는 다른 원인은 로그에 없다 — 주행 중 최장 터널 공백 183초(08-22)는 종점 150m 밖 고속 구간이었고, 종점 150m 안에서 그런 공백이 나려면 목적지가 터널 안이어야 한다. 더 줄이지 않는 이유: 고가 아래 잠깐 두절(수십 초)에 "도착"을 말하면 안 된다. 08-22 짧은 공백 46~96초가 그 하한 근거다. ⚠ 설계 리뷰 #2가 지적한 대로 이 값은 도착을 **보장하지 않는다**(목적지 150m 안 지하 진입로·회차로에서 계속 운전하며 120초 두절 → 추정 종료). 180초도 같은 실패 모양이라 값으로는 못 막고, 정차·CarPlay 같은 독립 증거는 이 spec 범위 밖이다. 추정 종료는 "도착한 것으로 보고"라고 말하고 재시작으로 복구되므로(도보 spec 2026-08-13 §3 수용과 같다) B1에서 실측해 재판정한다 |
| 무이동(stationary) | 300 | **300** | 국면 안 40~150m에서 정차한 채 10m를 안 움직이는 경우(길 건너 정차·주차장 안 정차)를 잡는다. 관측된 신호 대기 최장 73초(08-29 3회)의 4배. 40m 안 정차는 확정 도착이 먼저 잡으므로 이 축의 몫은 40~150m뿐이다. 도보와 같은 값이지만 **별 프로파일에 둔다** — 도보 재판정이 이 값을 바꿀 때 자동차가 따라가면 안 된다 |
| 거리 캡 | 150 | 150 | 국면 진입선(150m)과 같다. 자동차 종점도 도로 위라 목적지와 오프셋이 있지만, 캡을 넘긴 좌표는 "종점 근처"가 아니라 "다른 곳"이다 |

⚠ **미탐 수용**: 지하 주차장에서 cell/wifi fix(acc 수백 m)가 계속 오면 `isUsableFix`(acc>0·신선)를 통과해 두절 축이 안 열리고, 그 fix가 튀면 무이동 축도 안 열린다. 도보 spec 2026-08-13 §7의 같은 수용이고, 그때는 국면 무관 안전망(§4)도 같은 이유로 막힌다. 판정 채널은 `final` 로그의 `acc` 열이다(§6).

⚠ **미탐 수용 2 — 최종 접근에 못 들어간 자동차 세션은 두절 축 말고는 상한이 없다**(코드 품질 리뷰 검출, 2026-08-31). 리듀서 6b는 이탈 상태(`isOff`)에서 `finalApproachEnter`를 내지 않으므로, 경로 종점과 다른 주차장 입구로 들어가는 주행·조회 실패로 간략 강등된 세션은 `inFinalApproach`가 영영 false다. 도보는 이때 국면 무관 무이동 1200초가 잡지만 자동차는 계획 §1.2(b)가 무이동 축을 껐다(정체·휴게소 정차와 구분 불가). 야외 주차로 fix가 계속 오면 세션은 사용자가 끝낼 때까지 산다 — 08-29와 같은 모양이나 확률은 다르다(종점 근처에서 이탈로 끝나는 주행만). B1 관찰 항목(§9)이며, 실측되면 car 전용 긴 무이동 상수(예: 40~60분)를 별 판정으로 연다.

### 3.3 게이트

`GuideTuning.presumedArrivalEnabled: Bool`을 **`presumedArrival: PresumedArrivalThresholds?`**로 바꾼다(nil = 끔). `.walk = .walk`, `.car = .car`. Bool을 남기고 둘 다 true로 두면 항상 참인 상수가 남는다(CLAUDE.md "플래그 졸업은 검사 삭제로"). `carDriver`는 `.car`를 상속한다(리듀서 튜닝만 다르다).

`BeaconModel.maybePresumeArrival`: `guard let thresholds = tuning.presumedArrival` → `presumedArrivalStep(…, thresholds:)`. 기준 시각·앵커 로직 불변.

### 3.4 종료 모양(계획 §1.3 디폴트)

추정 도착은 확정 도착과 같은 모양이다: `arrivalDest`·`endKind = .presumed`·종료 화면·**도보 인계 버튼**(`arrivalSessionKind == .car`)·걸음 요약 없음(`sessionStartedAt`이 car에서 nil). 그래서 `maybePresumeArrival`도 **`stop()` 앞에서, `sessionKind == .car`일 때만 `arrivalSessionKind = .car`를 기록**한다 — 종전 코드는 이 대입이 확정 도착 경로에만 있어(K2 §6.4 B10) 추정 종료 화면에 인계 버튼이 안 보인다. 도보·prewalk 경로는 대입 자체를 지나지 않아 종료 후 모델 상태가 종전과 **바이트 동일**하다(설계 리뷰 #6 — 무조건 대입은 도보 동결 위반). 종은 전경에서만(도보 동형).

## 4. 국면 무관 안전망 — car는 두절 축만

Kit `sessionIdleStep(secondsSinceUsableFix:, secondsSinceProgress:)`의 `secondsSinceProgress`를 **옵셔널**로 바꾼다(웹 `number | null`). nil = 무이동 축 없음. 판정 순서(noFix → stationary) 불변.

축 선택도 튜닝 값이다: `GuideTuning.sessionIdleStationaryAxis`(walk `true`, car `false`, 웹 미러). `BeaconModel.maybeEndIdleSession`: `sessionKind == .walk` 가드를 지우고, `secondsSinceProgress`에 `tuning.sessionIdleStationaryAxis ? 종전 값 : nil`을 넘긴다. 무이동 축을 자동차에 켜지 않는 근거(정체·휴게소 정차와 구분 불가)는 튜닝 필드 주석에 남긴다. prewalk 제외는 그대로.

두절 600초의 자동차 근거: 주행 중 최장 fix 공백 183초(08-22 터널)의 3.3배. 이 축은 국면을 보지 않으므로 경로 중간에서 열릴 수 있고, 그래서 도착 추정보다 훨씬 길어야 한다(도보 spec 2026-08-26 §2와 같은 논리). 터널이 600초를 넘는 도로(예: 인제양양터널 11km, 시속 100km에서 약 400초)도 상한 안이다.

종료 모양: `stopLeavingSummary`(사용자 중지 모양)이고 car는 요약이 없어 종료 화면 없이 끝난다 — 통지 `guide.endedIdle`만.

⚠ car 상세 국면의 `lastFixAt`은 `handleDetail`이 acc>0·age≤10인 **모든** fix에서 갱신한다(uncertain 300m fix 포함). 그래서 여기서 "두절"은 fix 자체의 부재다. 08-22의 uncertain 752초 구간은 fix가 계속 왔으므로 이 축과 무관하다.

## 5. 간략 경로 계측

`BeaconModel`의 간략 fix 처리에 **거부된 fix를 포함해** fix당 1줄(설계 리뷰 #9 — usable guard에서 돌아가는 fix가 빠지면 "fix당 1줄"이 아니다). guard **앞**에서 남긴다:

```
brief t=… lat=… lng=… acc=… motion=… age=… usable=… dist=… nearby=…
```

`dist`는 fix→목적지 haversine(리듀서와 무관하게 직접 계산 — guard 앞이라 `stepped`가 없다), `nearby`는 이 fix 처리 **전** `beaconState.nearby`, `usable`은 `isUsableFix` 결과. 상세 `fix` 줄과 같은 부피(1초 1줄)라 회전 로그 예산 안이다. 간략 인계 분기(`beginFinalApproach`의 walk 폴백)에도 `briefHandoff reason=noGeometry` 1줄.

이 줄이 없어서 08-29 세션은 진입 뒤 몇 시간을 산 채로도 로그 0줄이었다. 다음 실주행에서 §3.2 상수를 판정하려면 `final` 줄(이미 있다)과 함께 필요하다.

## 6. 웹 미러

| 웹 | Kit | fixture |
|---|---|---|
| `final-approach.ts` `PresumedArrivalThresholds`·`presumedArrivalStep(input, thresholds)` | `FinalApproach.swift` | `presumed-arrival-scenarios.json` — `stepScenarios[].profile: "walk"\|"car"` 추가, car 케이스(국면 밖 none·119.9 none·120 noFix·stationary 299.9/300·캡 150/150.1·両축 noFix 우선, 설계 리뷰 #9) |
| `session-idle.ts` `secondsSinceProgress: number \| null` | `SessionIdle.swift` `Double?` | `session-idle-scenarios.json` — `null` 케이스 3건(두절 600 발동·무이동 9999인데 null이라 none·둘 다 미만) |
| `route-guide.ts` `GuideTuning.presumedArrival: PresumedArrivalThresholds \| null`·`entersFinalApproachWithoutGeometry`·`sessionIdleStationaryAxis` | `RouteGuide.swift` | 튜닝 단언 테스트(`route-guide.test.ts`·`RouteGuideTests.swift`) — walk `(.walk, false, true)`, car `(.car, true, false)`, carDriver == car |
| `car-arrival.ts` | `CarArrival.swift` | 불변 |

리플레이 게이트 `presumed-arrival-replay.test.ts`(08-13 도보)는 `.walk`를 넘겨 종전 결과를 유지한다.

## 7. 테스트 (게이트)

- 공유 fixture 2종(Kit·웹 양쪽 리더 갱신, 필드 누락은 디코딩 실패로 드러난다).
- Kit `RouteGuideTests`·웹 `route-guide.test.ts`: 위 튜닝 3필드 단언(walk·car·carDriver).
- `SessionIdleTests`·`session-idle.test.ts`: 느슨함 단언을 walk·car 프로파일 둘 다에.
- `BeaconModel`은 테스트 레인이 없다(앱 타깃, repo 전역 한계 — 설계 리뷰 #8). 그래서 갈림 셋(진입·추정 프로파일·안전망 축)을 전부 **튜닝 데이터**로 내려 Kit 테스트가 잠그고, BeaconModel에는 `tuning.*`를 읽는 배선만 남긴다. 배선 자체는 실기기 Experimental 배포 뒤 B1 실주행이 정본(§9).
- `guidance-gate-drift.test.ts` 기대값 불변(시작 호출을 늘리지 않는다).

## 8. 설계 리뷰 (codex raw exec, spec+코드 발췌 주입, 2026-08-31)

MAJOR 8·MINOR 1. 처리 원칙: 계획 §1 확정 판정은 재론하지 않고 근거만 기록, 설계 결함은 채택.

| # | 지적 | 처리 |
|---|---|---|
| 1 | 국면 무관 두절 600초가 저속 장대 터널(11km·60km/h ≈ 660초)에서 주행 중 종료 | **기각(확정 판정)** — 계획 §1.2(b)가 축과 값을 확정했다. 보강 근거: 08-22 터널 uncertain 752초 구간에서도 fix는 계속 왔고(공백 ≤183초) 이 축은 fix 부재만 센다. 종료 모양이 사용자 중지(통지+재시작 가능)라 조용한 종료가 아니다. B1 관찰 항목에 남긴다 |
| 2 | 최종 접근 120초 두절이 도착을 보장하지 않는다(지하 진입로 계속 운전) | **기각·기록** — §3.2에 적었다. 값으로 못 막는 실패 모양이고 독립 증거(정차·CarPlay)는 범위 밖 |
| 3 | 거리 캡이 정확도를 안 본다(acc 300 fix가 100m를 기록) | **기각** — 정확도 게이트를 걸면 지하 주차장의 저정확도 fix가 캡을 영영 못 채워 **이번 실사고(영구 생존)로 되돌아간다**. 도보 spec 2026-08-13과 같은 수용. `final` 로그 `acc` 열이 B1 판정 채널 |
| 4 | 무이동 300초가 목적지 앞 정체와 도착을 구분 못 한다 | **기각(확정 판정)** — 계획 §1.2(a)가 무이동 축을 켰다. 40m 안 정지는 확정 도착이 먼저 잡고(적신호 오판은 K2 §6.4 잠정 수용), 이 축의 몫은 40~150m뿐. 관측 최장 정차 73초의 4배 |
| 5 | 저정확도 fix가 계속 오면 어느 축도 안 열려 영구 생존 | **수용·기록**(§3.2 미탐) — "수신 fix"와 "신뢰 fix" 시각 분리는 #3과 반대 방향의 같은 축이라 한쪽만 고를 수 없고, 어느 쪽이 실제 주차장 모양인지는 로그가 정한다 |
| 6 | 추정 종료의 `arrivalSessionKind` 무조건 대입이 도보 동결 위반 | **채택** — car일 때만 대입(§3.4) |
| 7 | 기하 없는 진입의 후조건 미규정 | **채택** — 공통 블록 명시(§2) |
| 8 | BeaconModel 배선이 테스트 밖 | **부분 채택** — 갈림 셋을 `GuideTuning` 데이터로 내려 Kit·웹 테스트가 잠근다(§2·§3.3·§4). 앱 타깃 테스트 레인 신설은 범위 밖 |
| 9 | fixture 부정 케이스·거부 fix 계측 누락 | **채택** — §5·§6 |

구현 리뷰(spec-compliance·code-quality 서브에이전트, diff+spec만): 도보 동결 0건·미러 동형 확인. 채택 — `tooClose` 기하를 진입 시 nil로 정규화(진입 서술이 빈 기하로 나가는 경로 차단)·인계 로그 사유 분리, fixture 원 포맷 복원, TS 프로파일 `readonly`, BeaconModel 튜닝 배선 소스 스캔 가드(`beacon-tuning-wiring.test.ts`). 기록 — 위 미탐 수용 2(이탈 종료·간략 강등 자동차 세션의 상한 부재).

## 9. 판정 축 (B1 실주행, 위원장 몫)

`docs/FIELD-TEST.md` B1 행 추가, `docs/BACKLOG.md` K2-a는 코드 종결로 닫고 판정 항목을 B1에 남긴다:
- 종점 150m에서 "{방향} 약 N미터입니다"(`guide.finalApproachTick`)가 곧바로 들리는가(종전 "직선 안내로 전환합니다"는 car에서 사라진다 — FIELD-TEST 기존 행 갱신).
- 40m 안 정차 → 도착 종·종료 화면·인계 버튼(기존 B1③).
- 길 건너·주차장 정차(40~150m) 5분 → "목적지 부근에 도착한 것으로 판단해 안내를 종료했습니다"(`guide.arrivedPresumed`)가 들리는가. 지하 주차장 진입 2분 뒤 같은 문장이 들리는가(전경일 때 종).
- 로그 `final`·`brief` 줄로 §3.2 상수 재판정.
- 종점과 다른 입구로 들어가 이탈 상태로 끝난 주행·간략 강등 세션이 야외 주차 뒤 안 끝나는가(미탐 수용 2).

## 10. 파일

- iOS: `ios/Gildongmu/Directions/BeaconModel.swift`(§2·§3.3·§3.4·§4·§5), `ios/GildongmuKit/Sources/GildongmuKit/{FinalApproach,SessionIdle,RouteGuide}.swift` + `Tests/{FinalApproachTests,SessionIdleTests,RouteGuideTests}.swift`.
  - ⚠ 계획 §2가 적은 `GuideTuning*.swift`는 실재하지 않고 `GuideTuning`은 `RouteGuide.swift` 안에 있다 — 그 구조체의 도착 추정 필드와 그 필드를 단언하는 테스트 2줄만 만진다(코디네이터에 보고).
- 웹: `src/lib/{final-approach,session-idle,route-guide}.ts`, `src/lib/__tests__/{final-approach,session-idle,route-guide,presumed-arrival-replay}.test.ts`, fixture 2종.
- 문서: 이 spec, `docs/BACKLOG.md` K2-a, `CHANGELOG.md` 2026-08-31, `CLAUDE.md` 안전망 단락, `docs/FIELD-TEST.md` B1, `docs/superpowers/specs/logs/README.md` 08-29 행.

## 11. 구현 순서 (플랜 — 별도 plan 파일 대신 여기 둔다: 계획 §2 소유 파일 밖이라)

순차 의존(Kit 계약 → 앱 배선)이라 inline. 각 단계는 실패 테스트 → 구현 → 통과.

1. **Kit `FinalApproach.swift` + 웹 `final-approach.ts`**: `PresumedArrivalThresholds`(walk/car), `presumedArrivalStep(…, thresholds:)`. fixture `profile` 필드 + car 케이스. 리더(`FinalApproachTests`·`final-approach.test.ts`·`presumed-arrival-replay.test.ts`) 갱신.
2. **Kit `SessionIdle.swift` + 웹 `session-idle.ts`**: `secondsSinceProgress` 옵셔널. fixture null 케이스. 느슨함 단언을 両프로파일에.
3. **Kit `RouteGuide.swift` + 웹 `route-guide.ts`**: `presumedArrival`·`entersFinalApproachWithoutGeometry`·`sessionIdleStationaryAxis`. 단언 테스트 갱신.
4. **`BeaconModel.swift`**: §2 진입, §3.3 게이트, §3.4 대입, §4 안전망, §5 계측.
5. `npm run test:run` + `swift test`(Kit) + Experimental 빌드.
6. spec-compliance·code-quality 서브에이전트 리뷰(diff+spec만) → 수정 → 통합(ff push) → Experimental 배포 → 문서 분배.

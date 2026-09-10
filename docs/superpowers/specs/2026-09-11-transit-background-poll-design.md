# 대중교통 안내: 미관측 상한을 조회 횟수로 · 백그라운드 폴 지속 · 오디오 세션 소유권 세 구멍 설계 (A36 ① · E36 · PORTS)

> 2026-09-11, transit-2 세션. 판정 정본은 `docs/BACKLOG.md` §1 A36·§5 E36(위원장 판정 2026-09-10)과 워크스페이스 `PORTS.md` gildongmu 행 "오디오 세션 소유권의 세 구멍"(dodo-planet@684cd8a0 관찰, 절차는 `cross-port` 스킬 §B·§C). 실험판 봉인(`#if EXPERIMENTAL`) 안이며 서버 변경 없음. 상태 머신 정본은 B2 spec `2026-08-04-transit-guidance-design.md` §13, 오디오 세션 정본은 `2026-08-08-background-tone-coverage-design.md` §3.2, 직전 상태 머신 개정은 `2026-09-11-transit-reboard-and-handoff-design.md`(A37·A34·E34).
>
> **설계 리뷰 판정**: 필수(오디오 세션 = 프로세스 전역 자원, 백그라운드 실행 = 안전·정확성 축, A16 L2 탈출구가 걸린 판정 계층 변경). 1회 적대적 리뷰(opus, `~/gildongmu-wt/reports/transit-2-review-design.md`, 초안 `e420ef34`)를 받아 §9대로 반영했다. 이 문서는 반영 뒤 판이다.

## 1. 문제 (판정 원문 요지)

- **A36 ①** `neverSeen`("탑승하신 차량을 찾지 못하고 있습니다… 탑승 변경을 눌러 주세요")의 10분 상한이 `now - ridingSince`로 찬다. 09-05 로그: 잠금 뒤 9분 백그라운드(폴 0회) → 복귀 첫 폴에서 즉시 `neverSeen`. 실제 관측은 3회였다. 판정: **상한을 실제 조회 횟수로 센다.** 주머니에 넣어 둔 시간, 조회가 실패한 구간, 앱이 죽어 있던 구간은 세지 않는다.
- **E36** 백그라운드에서 폴이 멈춘다(`pausedInBackground`). 판정: **백그라운드에서도 조회를 계속하고, 잡히는 순간(첫 관측 `trackingStarted`) 소리로 알린다.** 음성은 억제 유지. 사다리·도착 톤은 범위 밖(별건). 첫 관문은 오디오 세션 생존, 쿼터·배터리는 실측 항목.
- **PORTS 세 구멍** dodo가 `GuideAudioSession.swift`를 이식하며 관찰한 셋(①카테고리와 활성화를 한 값에 뭉갬 ②원복 자격을 저장 ③`routeChangeNotification` `.categoryChange` 메아리 미필터)을 **gildongmu 코드에서 각각 재현·확인**하고 해당하는 것만 고친다(dodo 관찰이지 gildongmu 재현이 아니다).

## 2. 범위

**한다**: A36 ① Kit ↔ 웹 미러 + 공유 fixture / E36 iOS 실험판(웹 미러 없음, BACKLOG 원문) / **대중교통 유휴 폴 정지**(리뷰 B3 — 백그라운드 폴을 살리는 것과 한 묶음) / 오디오 세션 **소유권 이전·활성화 축**(리뷰 B2·M4 — 두 재생기 인스턴스 경합) / PORTS 세 구멍 판정표 + 해당 수정 + Kit 테스트 / 판정 회수 행(BACKLOG §2·FIELD-TEST §5) / PORTS 행 닫기.

**하지 않는다**: 사다리·도착·추세 톤의 백그라운드 발화(E36 원문이 별건으로 갈랐다. boarding 국면 "지금 타라"도 같은 축 — §4.5·§7) / 웹 백그라운드 폴(탭이 살아 있어야 도는 별개 축) / A35 착지·E33(transit-3) / `GuideBand.hasWalkHandoff` 잔여 정리(transit-1 인계, 소유 밖) / 무음 오디오 루프(§4.2.3 기각) / 좌표를 실제로 소비하는 keep-alive(ⓐ′, E35 재료로 넘긴다) / dodo `AudioSessionOwner` 전체 재이식(§4.3 — 소유권 이전 이벤트 하나로 두 인스턴스 축을 닫는다).

## 3. 현행 계약 중 이 설계가 딛는 것 (리뷰가 코드로 확인한 서술 — 전부 참)

- **`neverSeen` 판정 자리는 하나**: Kit `TransitGuide.swift` `handlePoll` 미등장 분기의 `now - since >= transitNeverSeenMs`(웹 `transit-guide.ts` `NEVER_SEEN_MS` 미러). `ridingSince`는 `enterRiding`에서 찍고 그 밖에선 nil로 지운다. 소비자는 이 판정뿐이다(톤·조망·표시 계층은 읽지 않는다). **`restoreBoarding`(탑승 변경 취소)은 `enterRiding`을 직접 불러 `ridingSince`를 새로 찍는다**(= 리셋. 리뷰 B1이 초안의 반대 서술을 바로잡았다).
- 관련 fixture: `transit-guide-scenarios.json`의 "미관측 시한 경과 → neverSeen 1회"·"시한 전 첫 관측이면 neverSeen은 영영 발화하지 않는다"·"upstreamFailed 복구 폴은 neverSeen을 내지 않는다"가 `at` 시간축(300000·600000·900000…)으로 짜여 있다. 비관측 잠금 시나리오("비관측 잠금(지하철 이미 탑승, A34 ①)…10분 뒤에도 neverSeen 없음")는 폴 3회뿐이라 횟수 축에서 이름이 단언하는 바를 검출하지 못한다(리뷰 m4). 공유 하네스의 `expect` 키는 `phase·signal·legIndex·remaining·dataAgeSeconds·previousLock·event` 일곱뿐이다(m2). 톤 fixture는 `neverSeen`을 쓰지 않는다.
- **riding 미등장 폴 주기는 60초**(`transitPollIntervalMs`: `trackingAnnounced ? 15_000 : 60_000`). **`transitSessionPollCap = 240`은 상한이 아니라 감속 문턱**이다(`capAnnounced` 뒤 60초로 영구 계속. 리뷰 B3). 대중교통에는 도보 A23 `sessionIdleStep`에 해당하는 유휴 안전망이 없고, 오늘 잊힌 세션의 폴을 막는 유일한 장치가 `pausedInBackground`다. 비관측 잠금 riding·확정 도착은 주기 0이고 즉폴 게이트(`restartPollLoop`·웹 `pollOnce`)가 `interval <= 0`이면 무조건 반환한다(transit-1 B1).
- **`TransitGuideModel`은 자기 `BeaconTonePlayer`를 갖지만 `beginSession()`·`endSession()`을 한 번도 부르지 않는다**. 대중교통 톤은 전부 `.ensureActive` 경로의 `.ambient`로 나가고, `.ambient`는 정의상 백그라운드에서 무음이다. 폴을 살려도 이대로면 첫 관측 소리는 나지 않는다.
- **프로세스 생존은 오디오 모드가 주지 않는다.** 2026-08-08 spec §3.3 "앱을 깨어 있게 유지하는 것은 여전히 `location` 모드다. `audio`는 재생 허용만 담당한다." `LocationService.startBeaconUpdates` 주석 "대중교통 추적은 위치가 아니라 네트워크 폴링이 생명선이라 이 경로를 지나지 않는다." `audio` 백그라운드 모드는 **소리를 실제로 내는 동안만** 앱을 살려 두고 재생이 멎으면 곧 재운다. 승차 국면은 소리 없는 구간이 수십 분이라 폴 태스크를 취소하지 않아도 iOS가 프로세스를 재우는 순간 타이머가 멎는다. **현행 `pausedInBackground`를 지우는 것만으로는 E36이 성립하지 않는다.**
- **재생기 인스턴스가 둘**(BeaconModel·TransitGuideModel 각자 `BeaconTonePlayer()`)이고 오디오 세션은 하나다. `endSession()`은 재생 잔여만큼 원복을 미루며 `cancelPendingRevert()`는 **같은 인스턴스만** 취소한다. prewalk(A25) 종료 3경로(확정 도착·추정 도착·"승차역 도착" 선언)는 전부 `playTone(.nearby)`(도착 종 2.2초)를 `stop()` 앞에서 내고, 코디네이터는 600ms 뒤 대중교통을 시작한다. E34 인계(대중교통 → 도보)는 `legAdvanced`의 `.start`(1.3초) 뒤 `transit.stop()` → 600ms → `startBeacon`이라 **대칭 경로**다(리뷰 B2).
- **`TransitGuideModel.post`에는 전경 게이트가 없다**(`BeaconModel.post`의 `isForeground` 가드와 다르다). 지금은 백그라운드 폴이 0이라 백그라운드 통지도 0이다. 2026-08-08 spec §3.1은 "백그라운드 무발화는 실측이지 API 계약이 아니다, 명시 게이트로 막는다"가 규칙이다.
- **오디오 세션 상태 머신** `guideAudioStep`(Kit, 테스트 12건): `desired`·`didPromote`·`isSuppressed` 세 값, 재조정 한 경로. `reconcile`에 "이미 그 카테고리면 건너뜀" 단락 분기가 없고 항상 `.apply(desired)`를 낸다. `BeaconTonePlayer.apply`는 카테고리와 무관하게 `setCategory` + `setActive(true)`를 부르고 `appliedCategory`는 마지막 적용 결과다(활성 여부가 아니다). `observeInterruptions`는 `interruptionNotification`의 **`.ended`만** `.interrupted`로 배선하고(`.began` 미처리) `routeChangeNotification`·`mediaServicesWereResetNotification`을 **reason 필터 없이** `.routeChanged`로 배선한다. `play()`는 `appliedCategory == nil`일 때만 `.ensureActive`를 보낸다(리뷰 M4 — 카테고리가 남은 채 세션만 죽으면 재활성화 시도가 없다).
- **다른 소비자의 카테고리 변경 경로**: 채팅 TTS 재생 `TtsPlayer.activatePlaybackSession()`이 `.playback` + `[.duckOthers]`로 갈아치우고 되돌리지 않으며 `isSuppressed`를 지나지 않는다(운전자 발화 `speakGuidance`는 카테고리를 만지지 않는다). 지금 그 변경에서 회복하는 신호는 그 변경이 낳는 `.categoryChange` route 변경뿐이다(리뷰 M5). 같은 메아리가 위 두 인스턴스 경합도 우연히 치유한다(뒤에 떨어진 `.ambient`가 `.categoryChange`를 내고, 세션을 쥔 쪽 재생기가 그것을 `.routeChanged`로 받아 `.playback`을 재적용).
- 톤 발화 창구는 `TransitGuideModel.playTone` 한 곳(억제 가드, 설계 리뷰 #4의 단일화), 통지 창구는 `announce`(지연 슬롯)·`announceNow`(즉시)·실제 게시 `post`. `trackingStarted`의 톤은 `transitEventProfile`이 `.ladder`(`closer` 소리)로 정한다.
- 복귀 통지: `handleScenePhaseChange(.active)`가 `pausedInBackground`일 때만 "안내를 재개합니다. {상태 문장}"(`transitGuide.resumed` + `signalStatusText`, `currentLeg`가 nil이면 접두만). 웹은 탭 숨김·복귀에 같은 `resumed` 키.
- `TransitGuideLeg.minutes`(구간 소요 분, ODsay)가 있다 — 유휴 한계의 근거 값.

## 4. 설계

### 4.1 A36 ① — `neverSeen` 상한은 riding에서 **결과를 받은 조회 수**

**리듀서(Kit ↔ 웹)**: 상태 필드 `ridingSince: Double?`를 **`ridingPolls: Int`**로 바꾼다. 뜻은 "이번 riding 진입 이후 하차역 목록 조회가 **결과(ok·empty)를 돌려준 횟수**". 상수 `transitNeverSeenPolls = 10`(웹 `NEVER_SEEN_POLLS`). 판정은 `!recovered ∧ signal == notYetVisible ∧ phase == riding ∧ ridingPolls >= transitNeverSeenPolls`.

- **세는 것**: riding 국면에서 `handlePoll`이 `.ok`·`.empty`를 받아 매칭 판정에 이른 폴. 증가는 매칭 판정 **앞에서 `phase == riding` 가드와 함께**(`if next.phase == .riding { next.ridingPolls += 1 }` — 리뷰 m1: 그 자리는 boarding·추정 arrived 폴도 지나므로 가드 없이는 필드 이름이 거짓이 된다. `enterRiding`이 0으로 리셋해 실해는 없지만 규칙을 이름에 맞춘다). 매칭됐으면 `trackingAnnounced`가 서서 이 축이 닫히므로 사실상 "미등장으로 끝난 조회 수"다.
- **세지 않는 것**(spec 확정): ①`failed`·`unsupported`(조회 실패는 관측 실패가 아니다. 실패 구간을 시계로 세던 것이 결함의 절반이었다) ②세대·순번 불일치로 폐기된 폴 ③waiting·boarding·arrived 폴(riding 전용 축) ④비관측 잠금 riding(폴 0 + `handlePoll` 조기 반환이라 카운트 지점에 닿지 않는다. A16 L2 탈출구가 필요 없는 잠금이다). `recovered` 폴은 **센다**(실제로 목록을 받았다) — 다만 판정은 그 폴에서 하지 않는다(현행 그대로. `signalRecovered`가 이벤트를 소유하고, 최소 한 번은 보고 나서 말한다).
- **리셋**: `enterRiding`(관측·선언·**탑승 변경 취소** 공통)에서 0. riding을 벗어나는 전이(`changeBoarding`·`advance`·`declareArrived`·도착)에서도 0(종전 `ridingSince = nil` 자리 전부). 탑승 변경 취소가 리셋인 것은 종전 동작 보존이고, 유지하면 9회에서 취소한 사용자가 다음 한 폴에 `neverSeen`을 맞는다(B1).
- **상한 10회의 근거**: 미등장 riding 주기 60초 × 10 = 종전 10분과 등가(캡 이후도 60초). 잠정값이며 §7에 "상한 횟수 적절성"을 세운다. 백그라운드 폴이 살아 있으면(§4.2.3 ⓐ) 전경·배경 무관하게 약 10분에 차고, 살지 못하면 전경에서 조회한 횟수만 센다 — 어느 쪽이든 "조회 10번 만에 못 봤다"는 뜻은 같다. **벽시계 백스톱은 두지 않는다**(리뷰 M1 기각 — 위원장 판정이 "앱이 죽어 있던 구간을 시계가 세는 것은 여전히 틀렸다"이고, 화면을 끈 사용자의 탈출구는 §4.2.6 유휴 정지·복귀 즉폴이 보존한다: 화면을 켤 때마다 폴이 돌아 횟수가 찬다).
- **관측 수단**: 공유 하네스 `expect`에 **`ridingPolls` 단언 키를 더한다**(Kit 실행기·웹 실행기 동시 — 리뷰 m2 ①). 웹 `ridingSince`의 타입 검사 방어 주석(2026-08-16 변이 기록)은 필드와 함께 지운다.
- **소비자 영향 0**: 표시·통지·톤·조망은 `ridingSince`를 읽지 않는다. 문장 `neverSeen`·`stateNeverSeen*`은 시간을 말하지 않아 불변.

### 4.2 E36 — 백그라운드 폴 지속 + 첫 관측 소리

#### 4.2.1 오디오 세션 승격과 두 재생기 사이의 원복 의무 이전

`TransitGuideModel.beginSession`에서 **첫 톤 전에 `tones.beginSession()`**, `stop()`에서 정지 톤 **뒤에 `tones.endSession()`**(BeaconModel과 같은 자리). 대가는 도보와 같다: 세션 중 무음 스위치를 무시한다(위원장이 도보에서 수용한 트레이드오프, 영향이 세션에 갇힌다). `teardown`의 `shutdown()`은 종전대로.

**두 인스턴스 경합(B2)의 처방 — 소유권 이전 이벤트**: 오디오 세션은 프로세스 전역이므로 "가장 최근에 `beginSession()`한 재생기"를 **전역 최신 소유자**(`BeaconTonePlayer.latestOwner: ObjectIdentifier?`, 정적, MainActor)로 둔다. 미뤄진 원복(`revertTask`)·`endSession()` 즉시 경로·`shutdown()`이 실행되는 시점에 **자기가 최신 소유자가 아니면** `.sessionEnded` 대신 새 Kit 이벤트 **`.ownershipTransferred`**를 보낸다: 상태는 `desired = .ambient`, `didPromote = false`, 동작은 `.none`(세션을 건드리지 않는다 — 원복 의무가 다음 소유자에게 넘어갔다). 그 뒤 이 인스턴스의 인터럽션·route 변경 옵서버는 `ownsSession`이 거짓이라 `.none`을 낸다(남의 세션을 `.ambient`로 되돌리지 않는다). 양방향(prewalk 도착 종 → 대중교통 시작 / E34 `legAdvanced` 시작음 → 도보 시작) 동형이고, 인계 지연 600ms·톤을 손대지 않는다. dodo `AudioSessionOwner`(claim/claimIfReady) 전체를 재이식하지 않는 이유: dodo는 소비자 5곳이 카테고리를 각자 설정하는 구조라 소유자 객체가 필요했고, gildongmu는 소비자가 재생기 둘뿐이며 둘 다 같은 상태 머신을 지나므로 이벤트 하나로 닫힌다(§4.3 O4).

**활성화 축(M4)**: 상태에 `isActive: Bool`을 더한다("우리가 마지막으로 `setActive(true)`를 낸 뒤 시스템이 세션을 뺏지 않았다고 믿는가"). 새 이벤트 **`.interruptionBegan`**(`interruptionNotification` `.began`) → `isActive = false`, 동작 `.none`. `.apply`·`.rebuild`를 내는 모든 스텝에서 `isActive = true`. `BeaconTonePlayer.play()`의 세션 확보 조건을 `appliedCategory == nil`에서 **`appliedCategory == nil || !audio.isActive`**로 넓혀 죽은 세션 위의 다음 톤이 `.ensureActive` 재조정을 지나게 한다(`.ended`가 유실돼도 회복). `isBackgroundAudible = appliedCategory == .playback && audio.isActive`.

**승격 실패·강등 표시(M7)**: 대중교통 `playTone`도 도보처럼 매 톤마다 `isBackgroundAudible`을 재평가하되(판정은 상시), **문장은 세션당 1회 latch**로 낸다(`ios.beacon.soundBackgroundUnavailable` 재사용, 문장이 수단 무관). 상시 표시 행은 두지 않는다(대중교통 시트에 그 행이 없고 세션 중 켜 볼 수단도 없다. 미니멀). 시작 시점에 억제로 승격이 미뤄진 경우의 거짓 경고가 이 규칙으로 함께 사라진다.

⚠ `.playback` 승격이 곧 백그라운드 실행 자격은 아니다(§3). 승격은 "소리가 날 수 있다"까지만 준다.

#### 4.2.2 폴 지속과 백그라운드 톤 게이트

- `handleScenePhaseChange(.background/.inactive)`의 폴 태스크 취소와 `pausedInBackground`를 **폐지**한다. 폴 루프는 국면·주기(`transitPollIntervalMs`)와 §4.2.6 유휴 정지만 본다. 백그라운드 전용 주기는 두지 않는다(§4.2.5).
- **백그라운드 톤 허용 집합 = `trackingStarted`의 톤 하나.** 게이트는 **`playTone` 한 곳**(리뷰 m8 — 억제 가드와 같은 창구): 시그니처를 `playTone(_ tone:, allowedInBackground: Bool)`(기본값 없음)로 바꿔 호출부가 뜻을 밝힌다. `handle(event:)`의 `.trackingStarted`만 `true`, 그 밖의 이벤트 톤·추세 톤·시작/정지 톤은 `false`. 게이트는 게시 시점 `isForeground`(`UIApplication.shared.applicationState != .background`, BeaconModel 동형)를 본다. 층 상태(앵커·타이머)는 백그라운드에서도 전진한다(억제와 같은 출력 게이트 원칙). 사다리·도착·`unreliable`·boarding "지금 타라"를 넣지 않는 것은 E36 원문 판정이다(별건).
- `trackingStarted` 톤은 종전 `.ladder`(`closer`) 그대로다. 새 소리 0(E15 ② 원칙). 주머니에서 첫 관측 소리로 구별되는지는 §7.

#### 4.2.3 프로세스 생존 — 위원장 판정 사안 (아키텍처 양자택일)

§3대로 오디오 모드는 프로세스를 살리지 않는다. 대중교통 세션이 백그라운드에서 폴을 이어 가려면 살리는 수단이 따로 필요하다.

| 안 | 내용 | 대가 | 판정 |
|---|---|---|---|
| ⓐ **위치 스트림으로 살린다** | riding 국면 동안 `LocationService`에 **keep-alive 스트림**을 연다: `desiredAccuracy = kCLLocationAccuracyKilometer`·`distanceFilter = 500`·`activityType = .otherNavigation`·**`pausesLocationUpdatesAutomatically = false`**(리뷰 M3 — 이 값이 전제의 일부다. 기본값 true면 정차·터널에서 시스템이 "정지"로 판단해 갱신을 스스로 멈추고 그때 백그라운드 근거도 사라진다)·`allowsBackgroundLocationUpdates`(`backgroundLocationDeclared` 가드 그대로). 좌표는 소비하지 않는다(로그도 남기지 않는다). `location` 모드는 두 plist에 이미 있고 권한은 도보와 같은 When In Use | 상태바 파란 위치 표시(끌 수 없음, 도보와 동일) · 배터리(저정밀이라 GPS 칩은 대개 꺼진다 — 실측 §7) · 심사: 좌표를 쓰지 않는 스트림이라 "본래 용도"(2.5.4) 논거가 ⓒ와 같은 구조다(리뷰 M6). 정공법은 ⓐ′이고 이번 웨이브는 심사 노트 한 줄로 덮는 것이 아니라 **실험판 봉인 안**이라는 사실로 버틴다(정식 승격 전 ⓐ′ 판정 필수 — §7·BACKLOG) · 권한이 없으면 열지 않고 ⓑ로 떨어진다 | **권장.** E36 판정("도보처럼")이 성립하는 유일한 경로. 지하 구간에서 fix가 안 와도 프로세스가 유지되는지는 §7 실기기 판정 |
| ⓐ′ 좌표를 실제로 소비한다 | ⓐ + 좌표를 조망의 "현재 위치"·현재역 추정(E35)·도착 판정에 연결 | ⓐ의 대가 + 지하 측위 부재·오판 설계 | **이번 웨이브 밖**(E35가 조사 선행 판정 중이고 위원장 판정 대상). ⓐ가 선택되면 BACKLOG E35에 "keep-alive 스트림이 이미 열려 있다"를 재료로 남긴다 |
| ⓑ **살리지 않는다** | 폴 태스크만 안 끊는다. iOS가 재우기 전(대개 수 초~30초)의 폴 1회가 최대이고, 복귀 즉폴은 종전대로 | 0 | E36을 사실상 이루지 못한다. 상태 문장에 "화면이 꺼지면 멈춘다"를 싣지 않는다(런타임 판정 위에 상시 고지를 얹지 않는 규칙 — §7 행이 실제 공백을 잰다) |
| ⓒ 무음 오디오 루프 | 소리 없는 재생을 계속 틀어 `audio` 모드로 살린다 | App Review 2.5.4 거절 사유, 배터리 | **기각** |
| ⓓ 서버 푸시·Live Activity | 서버가 열차 위치를 감시해 푸시 | 새 서버 동작(웨이브 전제 위반) | **기각(이번 웨이브)** |
| `CLBackgroundActivitySession`(iOS 17+) | When In Use에서 백그라운드 위치 접근을 세션 객체로 선언 | ⓐ와 같은 대가. `allowsBackgroundLocationUpdates` 직접 조작보다 의도가 드러난다 | ⓐ의 **구현 수단 후보**로 남긴다(별개 안이 아니다). 첫 구현은 도보 `startBeaconUpdates`와 같은 플래그 방식으로 하고(검증된 경로 재사용), 세션 객체 전환은 도보와 함께 별건 |

**설계는 ⓐ를 기본값으로 쓰되 위원장 판정을 받는다**(자율성 헌장 하드 스톱 3: 배터리·상태바 표시·심사 서술이 위원장 수용 사안이고, E36 판정의 전제 "도보와 같은 방식"이 코드 실측으로 절반만 참이라 판정 근거가 바뀌었다). 질문은 §9 뒤 한 번, 쉬운 한국어 단문으로.

ⓐ 구현 윤곽(판정 뒤 확정, `LocationService`는 소유 밖 — 코디네이터 자진 신고): `startKeepAliveUpdates()`/`stopKeepAliveUpdates()`(비콘 스트림과 다른 진입점, 같은 매니저. 비콘 스트림이 열려 있으면 no-op, `isKeepAliveActive` 플래그). **단발 fix 경로와의 간섭 둘을 막는다**(리뷰 M2): `endOneShotIfIdle`의 매니저 정지 가드를 `!isBeaconTracking && !isKeepAliveActive`로 넓히고, 단발 취득이 끝날 때 `desiredAccuracy`·`distanceFilter`·`activityType`·`pausesLocationUpdatesAutomatically`를 **keep-alive 값으로 복원**한다(세 스트림의 매니저 설정을 한 함수 `applyProfile(_:)`에 모은다). 대중교통 세션 중 단발 fix를 부르는 자리는 실재한다(목적지 변경 조회·"주변 확인" 앵커). `TransitGuideModel`은 **riding 진입에 열고 riding을 벗어날 때·유휴 정지·`stop()`에 닫는다**(waiting·boarding은 승차 정류소 목록이라 백그라운드 가치가 작고 riding 첫 관측이 E36의 대상이다). 권한 미보유(`.notDetermined`·거부)면 열지 않고 로그 `keepAlive=denied` 한 줄 — 위치 권한 팝업을 새로 띄우지 않는다.

#### 4.2.4 음성 억제와 복귀 통지

- `TransitGuideModel.post`에 **`isForeground` 게이트**(BeaconModel 동형, 게시 시점 조회). 백그라운드 게시 시도는 `missedAnnouncement = true`로 남기고 게시하지 않는다. 억제(`droppedWhileSuppressed`)와는 가드 순서상 겹치지 않는 별개 축이다(리뷰 축 5 확인).
- 복귀(`.active`, 직전이 `.background` — `wasBackgrounded`, BeaconModel 동형. `.inactive` 왕복엔 내지 않는다): **`missedAnnouncement`가 서 있을 때만** 낭독하고 소비한다(리뷰 m10 — 아무 일도 없었으면 침묵이 옳다). 문장은 **현재 상태 하나**: 신호가 `neverSeen`이면 `transitGuide.neverSeen` 통지 문장(탈출구 지시를 담은 1회성 행동 문장, memory `once-only-warning-delivery-contract`), 그 밖은 `signalStatusText`(비관측 인자 포함). 상태 문장이 비면(`currentLeg` nil) 낭독하지 않는다. 종전 접두 "안내를 재개합니다."는 **폴이 멈춘 적이 없으므로 이 자리에서 뗀다** — 그 키는 §4.2.6 유휴 정지에서 되살아난 폴의 통지로 옮겨 간다(뜻이 참인 자리).
- 복귀 즉폴은 종전대로(`restartPollLoop(immediate: true)`, 주기 0 게이트 통과). ⚠ 이것은 예산 항목이 아니라 **3-state 정직성의 방어선**이다(리뷰 O2): 프로세스가 재워진 동안 끊긴 요청은 `.failed`로 도착하는데, 복귀 즉폴이 옛 태스크를 취소하고 `guard !Task.isCancelled`가 그 결과를 버린다. 즉폴을 없애는 후속 최적화는 이 방어선을 함께 옮겨야 한다.
- ⚠ A33(2026-09-11 transit-1)이 `stateNeverSeen`을 "열차 위치를 끝내 확인하지 못했습니다."로 이미 바꿨다 — 그 문장에 행동 지시가 없다는 사실 위에 위 `neverSeen` 예외가 선다. 낭독 문장의 정본은 문자열 자원이다(리뷰 O3).

#### 4.2.5 쿼터

서울 지하철 실시간 키 일 1,000회(내 주변·역 정보와 공유). riding 폴은 미등장 60초·추적 15초. 30분 riding 한 세션 = 미등장이 길면 ~30회, 추적이 일찍 잡히면 최대 ~120회. **전경에서 화면을 켜 둔 오늘의 세션과 같은 수**이고 늘어나는 것은 "화면을 끄고 있던 동안 안 나가던 폴"뿐이다. ⚠ 초안의 "그 상한이 세션당 캡"은 거짓이었다(`transitSessionPollCap`은 감속 문턱, B3). 세션 수명 상한은 §4.2.6 유휴 정지가 준다: 세션당 최대 폴 ≈ 유휴 한계(30분 또는 2×구간 소요) ÷ 주기. 백그라운드 전용 주기(예: 120초)는 두지 않는다 — 첫 관측 지연이 2배가 된다(E36의 목적 자체를 반감). 초안의 "A36 축의 뜻이 갈린다"는 근거는 틀려서 지웠다(횟수 축은 주기와 무관하다, 리뷰 m7). 실측값은 §7 `pollStart` 계수.

#### 4.2.6 유휴 폴 정지 (리뷰 B3 — 백그라운드 폴을 살리는 것과 한 묶음)

**문제**: `pausedInBackground`를 지우면 하차 뒤 시트를 닫지 않고 잊은 세션이 밤새 60초마다 폴한다(8시간 ≈ 480회 = 공유 예산의 절반, ⓐ면 위치 스트림·상태바 표시까지). 도보의 A23 안전망에 해당하는 것이 대중교통엔 없다.

**설계**: 판정은 Kit 순수 함수 **`transitIdlePollLimitMs(legMinutes: Int?) -> Double`** = `max(30분, 2 × legMinutes분)`(`legMinutes` nil이면 30분). 앱 층 `TransitGuideModel`이 **마지막 사용자 조작 시각 `lastUserActionAt`**(단조 시계)을 든다 — 세션 시작·모든 사용자 입력(board·confirmBoarded·restoreBoarding·changeBoarding·declareArrived·advance·새로고침·역 선택·목적지 변경·경로 교체)·**전경 복귀**(`.active`, 화면을 켠 것은 조작이다)가 갱신한다. 폴 루프가 다음 폴을 예약하기 전에 `now - lastUserActionAt >= limit(currentLeg.minutes)`이면 **폴을 멈추고**(`idlePaused = true`, 태스크 종료, keep-alive 스트림 정지, 로그 `idlePause sinceAction=…s limit=…s`) 세션은 유지한다(A23과 달리 종료가 아니다 — 지연·긴 구간에서 실제로 타고 있는 사용자를 끊지 않는다). 재개: 전경 복귀·어떤 사용자 조작이든 `idlePaused`를 풀고 즉폴 + **"안내를 재개합니다. {상태 문장}"**(`transitGuide.resumed`가 참인 자리) — 유휴 정지에서 돌아오는 경우에만 이 접두를 쓴다. `missedAnnouncement` 복귀 문장(§4.2.4)과 같은 순간 겹치면 재개 문장 하나로 합친다(상태 문장이 둘의 뒷부분이라 같다).

- 정지 중 국면·상태는 불변이고 `transitPollIntervalMs`도 손대지 않는다(정지는 앱 층 배선. 리듀서에 시계 축을 넣지 않는 것이 A36과 같은 정신이다).
- 왜 도보 `sessionIdleStep`을 재사용하지 않는가: 그 축은 fix 두절·무이동이고 세션을 **끝낸다**. 대중교통은 fix가 없고, 끝내는 것은 지연 열차에 타고 있는 사용자에게 틀리다. 이름으로 가른다(`transitIdlePollLimitMs`).
- 값은 잠정: 30분은 "한 구간 소요의 두 배가 그 아래인 짧은 구간"의 하한, 2×는 지연 여유. §7 행.

### 4.3 PORTS "오디오 세션 소유권의 세 구멍" 판정표 (cross-port §C 결함 계열형)

출처 정본: dodo-planet@684cd8a0 `ios/DodoPlanet/Core/Audio/AudioSessionOwnership.swift`·`AudioSessionOwner.swift`. 받는 쪽 현황은 gildongmu `9e808111` 실측 + 설계 리뷰(`e420ef34`) 검증.

| # | dodo 관찰 | gildongmu 현황(실측) | 판정 |
|---|---|---|---|
| ① 카테고리·활성화 한 값 | 인터럽션은 활성화만 뺏고 카테고리는 남는데, 재조정이 `didPromote`만 보고 "이미 `.playback`이니 할 일 없음"으로 빠질 수 있다 → 통화 뒤 죽은 세션 위에서 무음 | **그 경로(재조정 단락 분기)는 없다**: `reconcile`은 항상 `.apply(desired)`를 내고 `apply`는 `setCategory`+`setActive(true)`를 무조건 부른다. **그러나 같은 증상에 이르는 다른 경로가 있다**(리뷰 M4): `.began`을 처리하지 않고 `.ended`는 유실될 수 있으며, `play()`는 `appliedCategory == nil`일 때만 `.ensureActive`를 보내므로 카테고리가 `.playback`으로 남은 채 세션만 죽으면 재활성화 시도가 없다. 그때 `isBackgroundAudible`은 참을 보고한다 | **재조정 축 미재현, 활성화 축 재현.** 처방 §4.2.1 활성화 축(`isActive`·`.interruptionBegan`·`play()` 재확보 조건). 테스트: `.interruptionBegan` → `.none`·`isActive == false` / 그 뒤 `.ensureActive` → `.apply(desired)`·`isActive == true` / 이미 `.playback`인 상태의 `.interrupted` → `.apply(.playback)`(단락 분기 도입 방지 가드) |
| ② 원복 자격 저장 | `didPromote`를 저장하면 "실제로 원복하기 전에 자격을 반납"하는 상태가 표현 가능하다. dodo는 `applied`에서 유도해 표현 불가능하게 했다 | 저장 필드이지만 갱신 지점이 둘뿐이고(`reconcile`: 적용하는 카테고리가 `.playback`인가 / `.sessionEnded`: `.ambient`를 적용하는 그 스텝에서만 false) 둘 다 적용 동작과 같은 스텝이다. 억제 중 종료는 자격을 유지한다(테스트 `endWhileSuppressed` — 이름이 단언과 반대라 "유지한다"로 고친다, 리뷰 m6). **리듀서 층 불변식 `didPromote == (마지막으로 낸 적용 동작의 카테고리 == .playback)`이 성립한다**(리뷰 반례 탐색 실패). 앱 층 반례는 `apply` 실패 폴백(`.playback` 실패 → `.ambient` 적용, 상태는 true)뿐이고 종료 시 `.ambient` 재적용 1회로 무해 | **미재현(리듀서 층 불변식 성립).** 그 불변식을 **7종 이벤트 길이 ≤5 전수 열(7⁵ = 16,807)**로 단언하는 Kit 테스트 1건을 더한다(`suppressionChanged`는 true·false 두 값이라 7종, 리뷰 m5. `.ownershipTransferred`는 "다음 소유자가 적용했다"라 알파벳에서 빼고 별도 테스트: 이전 뒤 `.interrupted`·`.routeChanged`·`.sessionEnded` → `.none`, `.sessionStarted` → `.apply(.playback)`). 이 spec이 더하는 `isActive`는 불변식 밖의 값이다 |
| ③ `.categoryChange` 메아리 | 자기 `setCategory`의 메아리라 걸러야 재조정 되먹임이 없다 | `observeInterruptions`가 reason을 읽지 않는다. `beginSession()` → `.apply(.playback)` → OS가 `.categoryChange`를 게시 → `.routeChanged` → `reconcile(rebuild: true)` → **플레이어 전부 정지·캐시 폐기 + 재적용**. 세션 시작마다 재생성이 한 번 더 돌고, 통지가 `playTone(.start)` 뒤에 도착하면 시작 톤이 잘린다(전달 순서는 실기기). **그러나 전면 필터는 과잉이다**(리뷰 M5): 다른 소비자(채팅 TTS `duckOthers`)의 카테고리 탈취에서 회복하는 유일한 신호도 `.categoryChange`이고, 두 인스턴스 경합(B2)을 지금 우연히 치유하는 것도 이 메아리다 | **재현(코드), 처방은 "메아리 식별"**: 앱 층이 `.categoryChange`에서 **현재 세션의 category·options가 우리가 마지막으로 적용한 값과 같은가**를 읽어(시간 창이 아니라 결정적 대조) Kit 순수 매퍼 `guideAudioRouteChangeEvent(reason:, matchesApplied:)`에 넘긴다: `.categoryChange ∧ matches` → nil(자기 메아리) / `.categoryChange ∧ !matches` → 새 이벤트 **`.categoryTakenOver`**(재조정하되 `rebuild` 없이 `.apply` — 카테고리 변경은 플레이어를 무효화하지 않는다, 시작 톤 절단 위험 0) / 그 밖 reason → `.routeChanged`. `mediaServicesWereReset`은 매퍼를 지나지 않고 `.routeChanged`. "같은 카테고리 재적용은 메아리를 내지 않는다"는 부재 논증에 더는 기대지 않는다(메아리든 아니든 대조로 가른다). 부수: `apply(rebuildPlayers:)`가 `toneEndsAt`을 지우지 않아 재생성 뒤 발화 지연이 유령 종료 시각을 본다 → 재생성 분기에서 `toneEndsAt = nil` |

PORTS 행 처리: `[done 2026-09-11]` + 이 spec 경로 + 판정 요지 한 줄(①활성화 축 재현·수정 ②미재현·불변식 전수 테스트 ③재현·메아리 식별 수정). dodo 쪽 역이식: **없음** — dodo의 `applied`/`isActive` 분리는 ①의 활성화 축과 같은 값이고 gildongmu가 이 spec으로 같은 축을 갖는다, 두 인스턴스 축은 gildongmu 고유(dodo는 소유자 객체로 이미 닫았다). PORTS 행의 "테스트 11건"은 12건으로 정정.

### 4.4 문장·키

새 사용자 문장 **없음**. `transitGuide.resumed`("안내를 재개합니다.")의 iOS 소비 자리를 백그라운드 복귀에서 **유휴 정지 재개**로 옮긴다(웹은 종전대로). `ios.beacon.soundBackgroundUnavailable`("화면이 꺼지거나 다른 앱을 쓰는 동안에는 안내 소리가 나지 않습니다.")을 대중교통 승격 실패에 재사용(세션당 1회).

### 4.5 접근성

- 백그라운드 발화 0(§4.2.4 게이트), 복귀 낭독은 `missedAnnouncement`일 때 상태 하나(또는 `neverSeen` 행동 문장). 새 통지 경로 없음, 전부 `announce` 창구.
- 백그라운드 소리는 riding 첫 관측 한 건. **boarding 국면 "지금 타라"(`approaching` 잔여 3·2·1)는 주머니에서 무음으로 남는 비대칭**이다(E36 원문 판정, keep-alive가 riding 전용이라 실질 영향도 작다). 사용자가 "백그라운드에서 소리가 난다"를 승차 알림으로 오해하는지 §7(리뷰 O1).
- 포커스·시트·상태줄 문장 변경 없음.

### 4.6 계측

`transitGuideLog`: `scene phase=… tracking=…`(`paused=` 필드 삭제) · `keepAlive start|stop|denied` · `bgTone kind=<tone> allowed=<bool>`(백그라운드에서 게이트를 지난 톤만, 전경은 남기지 않는다) · `neverSeen polls=<n>` · `idlePause sinceAction=<s> limit=<s>`·`idleResume` · `audioTransfer from=<beacon|transit>`. `pollStart sinceLast=`가 백그라운드 폴 지속의 실측 증거다(§7 — 배경 구간에서 주기 근처면 ⓐ가 살아 있는 것, 수백 초면 재웠던 것).

## 5. 불변식 점검

| 축 | 결과 |
|---|---|
| §13 상태 머신 | 새 입력·국면·신호·이벤트 없음. `neverSeen` 판정 조건 한 항(시간 → 횟수)만 바뀐다. 1회성·`recovered` 배제·확정 신호 보존 규칙 불변 |
| A16 L2 탈출구(`neverSeen` → 역 선택) | 식별 잠금 riding에서 유지. ⓐ: 배경에서도 횟수가 찬다. ⓑ·권한 부재: 전경에서 조회한 횟수만 차므로 화면을 켠 만큼 늦게 오되 사라지지 않는다(유휴 정지 뒤에도 복귀 즉폴이 센다). 비관측 잠금은 종전대로 축 밖 |
| 음성 억제 계약(백그라운드 소리만) | `post` 전경 게이트로 명시화. 소리는 허용 집합 1개, 게이트 자리는 `playTone` 하나 |
| 오디오 세션 소유권(`didPromote`, 전역 자원) | 두 재생기의 원복 의무는 최신 소유자에게 이전된다(`.ownershipTransferred`). `coordinator.claim`은 세션 단일성만 보장하고 원복 의무는 release 뒤에도 남는다는 사실을 이 이벤트가 메운다. 활성화 축(`isActive`)은 `didPromote` 불변식 밖 |
| 즉폴 게이트(B1) | 불변. 복귀·재개 즉폴은 주기 0에서 나가지 않는다 |
| 쿼터·세션 수명 | 세션당 폴 상한 = 유휴 한계 ÷ 주기(§4.2.6). 백그라운드 전용 주기 없음 |
| 개인정보 3자 일치 | ⓐ여도 수집·전송 항목 무변화(좌표는 서버로 보내지 않고 로그도 남기지 않는다. 위치 데이터 유형은 이미 신고) |
| `guidance-gate-drift` | 진입점 불변 |
| 도보 세션 | `BeaconTonePlayer` 변경(소유권 이전·활성화 축·메아리 식별)은 도보도 지난다. 도보의 관측 가능한 변화: 세션 시작 직후 재생성이 사라진다, 인터럽션 `.began` 뒤 첫 톤이 재확보를 지난다, 채팅 TTS 뒤 재조정이 `rebuild` 대신 `apply`. 회귀 축은 §7 "시작음 온전" 행과 기존 FIELD-TEST §4-2(통화·에어팟) 행 |

## 6. 테스트

- 공유 fixture(`transit-guide-scenarios.json`, **이름으로 지시** — 리뷰 m3): "미관측 시한 경과 → neverSeen 1회" → 조회 10회째(전부 empty)에 `neverSeen`, 11회째 무이벤트, 각 스텝 `ridingPolls` 단언. "시한 전 첫 관측이면 …" → 첫 관측 뒤 empty가 10회를 넘어도 `neverSeen` 없음(signalLost 축). "upstreamFailed 복구 폴은 …" → `failed` 3회(`ridingPolls` 0) → 복구 폴(1, `signalRecovered`) → empty 9회 → 10회째 `neverSeen`. "비관측 잠금(A34 ①)…" → 폴을 10회 이상으로 늘려 `neverSeen` 없음·`ridingPolls` 0 유지(m4). 신규 "시간축 무관: `at`이 1시간 뛰어도 9폴이면 `neverSeen` 없음". 신규 "탑승 변경 취소 뒤 카운트 리셋: 9폴 → changeBoarding → restoreBoarding → 9폴 무이벤트 → 10폴째 `neverSeen`". 신규 "boarding 폴은 세지 않는다: boarding 폴 5회 뒤 관측 riding 진입 → `ridingPolls` 0".
- 하네스: 웹 `transit-guide.test.ts`·Kit `TransitGuideTests.swift`에 `ridingPolls` 단언 키(둘 다 같은 파일을 읽는다).
- Kit `transitIdlePollLimitMs`: nil → 30분, 10분 구간 → 30분, 40분 구간 → 80분.
- Kit 오디오(`GuideAudioSessionTests`): §4.3 ① 3건, ② 전수 열 1건 + `.ownershipTransferred` 1건, ③ 매퍼 4건(`.categoryChange`+match nil / `.categoryChange`+mismatch → `.categoryTakenOver` / `.oldDeviceUnavailable`·`.newDeviceAvailable` → `.routeChanged`) + `.categoryTakenOver` 스텝(소유 중 `.apply(.playback)`·`rebuild` 아님 / 세션 밖 `.none` / 억제 중 `.none`). 변이 주입 3회(단락 분기 삽입·`.sessionEnded`의 자격 반납 삭제·매퍼 match 무시)를 실측해 커밋 메시지에 남긴다.
- 소스 가드(리뷰 m9, `src/lib/__tests__/` 정규식 한 줄씩): `TransitGuideModel.post`에 전경 게이트가 있는가 / `playTone(_:allowedInBackground:)` 호출 중 `true`가 정확히 1곳인가.
- 웹: `ridingSince` 참조 제거 뒤 `tsc` 통과, `TransitGuidePanel.test.tsx` 무변경.
- 앱 타깃: Experimental 시뮬 빌드. 백그라운드 동작은 §7 실기기.

## 7. 실승차·실기기 판정 (BACKLOG §2 표 · FIELD-TEST §5)

- **A36**: ①상한 10회가 적절한가(로그 `neverSeen polls=`와 그 시점 잔여 정거장 — 잔여가 아직 5 이상이면 상한이 짧다) ②백그라운드 왕복 뒤 복귀 첫 폴에서 `neverSeen`이 즉시 나지 않는가(09-05 재현 부정).
- **E36**: ①주머니 속 첫 관측 소리가 들리는가, 그 소리를 첫 관측으로 알아듣는가(`closer`와 같은 소리) ②`pollStart sinceLast=`가 배경 구간에서 주기 근처인가(ⓐ 생존) — **지하 구간(fix 없음)에서도**(`pausesLocationUpdatesAutomatically = false`가 실제로 이것을 잰다) ③배터리: 30분 승차 전후 % 차(도보 세션과 비교) ④복귀 낭독이 `missedAnnouncement`일 때만 상태 한 문장인가, 배경에서 `neverSeen`이 났으면 행동 문장인가 ⑤무음 스위치를 켠 채 대중교통 세션 — 소리가 나는가(승격), 종료 뒤 무음이 돌아오는가 ⑥승격 실패 문장이 세션당 1회인가 ⑦승차 대기 중 화면을 끄면 "지금 타라"가 없다는 것을 결함으로 읽는가(O1) ⑧prewalk 인계·E34 인계 뒤 다음 세션이 잠금 상태에서도 소리를 내는가(소유권 이전 — 종전엔 메아리가 우연히 치유) ⑨**잊고 둔 세션**: 유휴 한계 뒤 `idlePause` 로그가 남고 폴 총수가 한계 ÷ 주기 이하인가, 복귀 시 "안내를 재개합니다"가 나오는가 ⑩(ⓐ) 정식 승격 전 ⓐ′ 판정 — 좌표를 쓰지 않는 스트림으로 심사에 갈 것인가.
- **PORTS**: 도보·대중교통 시작음(1.3초)이 온전히 들리는가 / 통화 `.began` 뒤 `.ended` 없이 돌아온 세션에서 다음 톤이 나는가(①) / 채팅 TTS를 세션 중에 듣고 난 뒤 안내 톤이 배경 미디어 위에서 섞여 들리는가(③ `.categoryTakenOver`).
- **쿼터**: 세션 로그 `pollStart` 총수 대 `usage-report.mjs` 당일 소비.

## 8. 파일

Kit `TransitGuide.swift`(+`TransitGuideTests.swift`)·`GuideAudioSession.swift`(+`GuideAudioSessionTests.swift`)·신설 `TransitIdle.swift`(`transitIdlePollLimitMs`, +테스트) / iOS `TransitGuideModel.swift`·`BeaconTonePlayer.swift`·(ⓐ) `LocationService.swift`(소유 밖 — 자진 신고) / 웹 `src/lib/transit-guide.ts`·`src/hooks/useTransitGuide.ts`(타입 참조만) / fixture `transit-guide-scenarios.json` + `transit-guide.test.ts` + 소스 가드 테스트 / `PORTS.md` 해당 행 / 문서 분배(CHANGELOG·BACKLOG·FIELD-TEST·CLAUDE.md·INTEGRATIONS·PROGRESS).

## 9. 설계 리뷰 판정 (2026-09-11, opus 서브에이전트, 초안 `e420ef34`)

**판정: §3 진단 7건 전부 참, 설계 결정 셋(B1·B2·B3)이 틀린 사실 위 → 전부 반영 후 착수.** 보고 정본 `~/gildongmu-wt/reports/transit-2-review-design.md`.

| 항목 | 처리 |
|---|---|
| B1 `restoreBoarding`은 `enterRiding`을 지나 리셋 | 채택 — §4.1 리셋 확정, fixture "탑승 변경 취소 뒤 카운트 리셋" |
| B2 두 재생기 원복 경합(prewalk 도착 종 2.2초 > 600ms, E34 대칭) | 채택, 처방은 제3안 — `.ownershipTransferred`(전역 최신 소유자, §4.2.1). dodo 소유자 객체 전체 재이식은 소비자 수 차이로 기각 |
| B3 `transitSessionPollCap`은 감속 문턱, 유휴 안전망 부재 | 채택 — §4.2.6 유휴 폴 정지(세션 유지, `transitIdlePollLimitMs`), §4.2.5 정정 |
| M1 ⓑ에서 탈출구 소멸 → 벽시계 백스톱 | **기각** — 위원장 판정("죽어 있던 구간을 시계가 세는 것은 틀렸다")과 충돌. 유휴 정지·복귀 즉폴이 탈출구를 보존(§5 표 A16 L2 행에 갈래 기록) |
| M2 keep-alive가 단발 fix 경로에 죽는다 | 채택 — `endOneShotIfIdle` 가드 확장 + 프로파일 복원(§4.2.3 윤곽) |
| M3 `pausesLocationUpdatesAutomatically` | 채택 — 인자 목록에 명시, §7 ②가 그 값을 잰다 |
| M4 ① 활성화 축 경로 | 채택 — `isActive`·`.interruptionBegan`·`play()` 재확보 조건(§4.2.1·§4.3 ①) |
| M5 `.categoryChange` 전면 필터는 회복 신호도 없앤다 | 채택 — 적용값 대조로 메아리 식별, `.categoryTakenOver`는 `apply`만(§4.3 ③) |
| M6 심사 근거 비대칭·ⓐ′·`CLBackgroundActivitySession` 누락 | 채택 — §4.2.3 표에 ⓐ′·세션 API 추가, 심사 서술 정정(실험판 봉인 + 정식 승격 전 ⓐ′ 판정). 위원장 질문은 단문 하나 |
| M7 강등 판정 시작 1회 | 채택 — 판정 상시·문장 1회 latch(§4.2.1) |
| m1~m10 | 전부 채택(국면 가드·`ridingPolls` 하네스 키·이름 지시·비관측 시나리오 연장·7종 16,807·테스트 개명·m7 근거 정정·게이트 자리 `playTone`·소스 가드 2·복귀 낭독 조건) |
| O1~O4 | 반영(§4.5·§4.2.4·§4.3 문단) |

## 10. 구현 리뷰 판정 (2026-09-11, HEAD `e8121bd4` → 반영 `e2598848`)

세 리뷰(별도 컨텍스트, diff `main...HEAD`만)의 보고는 `~/gildongmu-wt/reports/transit-2-review-{spec,code,a11y}.md`(커밋 밖).

| 리뷰 | 판정 | 반영 |
|---|---|---|
| spec-compliance(opus) | 조건부 적합(BLOCKER 0, MAJOR 3, MINOR 8) | M1 `changeRoute`·`pickAboardStation` 조작 표식 / M2 `neverSeen polls=` 로그 / M3 keep-alive 단독 구간 fix를 공유 스토어에 쓰지 않음(`isKeepAliveOnly` — "좌표 미소비"를 가정에서 구조로) / m1·m2 웹 낡은 주석 / m3 재생기 라벨 `audioTransfer from=` / m4 = 아래 C1 / m5 = C2 / m6 INTEGRATIONS 절 제목 = 규칙 문구 / m7 FIELD-TEST ⑥⑦ 행 / m8 = C3. 전부 채택 |
| code-quality(opus) | 조건부 통과(BLOCKER 0, MAJOR 1, MINOR 10, 관찰 6) | **C1 승격 실패 문장 latch가 발화 없이 소비**(지연 슬롯 latest-wins 선점 + 백그라운드 게이트) → `DeferredAnnouncer.announce(_:onDropped:)` 상환 계약으로: latch는 큐잉에 세우고 버려지면 `onDropped`가 풀어 다음 톤이 재시도 / C2 소유권 이전 뒤 `appliedCategory` 소거(넘긴 쪽의 재확보가 남의 `.playback`에 `.ambient`를 얹는 문) / C3 소스 가드 강화(호출부 리터럴 `: true` 0곳 단언, 죽은 분기 제거, `.background` 분기가 `pollTask`를 안 건드리는 계약) / C4 `dispatch`의 표식(`noteUserAction`)과 재개(`resumeIfIdle`)를 상태 대입 앞·뒤로 분리 / C5 재개 문장 즉시 창구(`announceNow`)·`.high` / C6 `enterRiding`·핸들러 4곳 죽은 `now` 제거(웹·Kit, 린트 경고 8 → 7) / C7 = M3 / C8 `latestOwner == nil`은 이전이 아니라 종료, 라벨 로그 / **C9 전경 유휴 정지가 조용하다 — 새 문안이라 채택하지 않고 BACKLOG §2 E36 ⑫로 기록(위원장 문안)** / C10 `stopKeepAliveUpdates`가 단발 취득 중이면 정리를 `endOneShotIfIdle`에 미룸 / O1 `.ambient` 옵션 리드백 가정 — 실기기 관찰(PORTS 행) / O2 `apply` 실패·폴백 시 `isActive`를 내려 다음 톤이 재승격 시도 / O3·O5·O6 관찰 유지 / O4 `bgTone` 로그 `rawValue` |
| a11y(sonnet) | 조건부 통과(HIGH 1, MEDIUM 1(HIGH 연동), LOW 1, 관찰 2) | A-1 = C1(채택) / 통지 우선순위 — 재개·복귀 문장 `.high`(채택, CLAUDE.md 판별선) / C-1 첫 관측 소리가 도보 `closer`와 같다 — spec §4.5 별건, §7 ① 실기기 문항 / E-1 이중 낭독 없음 확인 / D-1 억제+백그라운드 동시 경합의 원문 손실 — 재현 시 A-1 방식으로, 실기기 관찰 |

반영 뒤 게이트: Kit 695 · 웹 4,129(+새 가드) · `tsc` 0 · lint 경고 7(오류 0) · Experimental 시뮬 빌드 rc 0.

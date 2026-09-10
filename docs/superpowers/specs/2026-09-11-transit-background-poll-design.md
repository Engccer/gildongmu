# 대중교통 안내: 미관측 상한을 조회 횟수로 · 백그라운드 폴 지속 · 오디오 세션 소유권 세 구멍 설계 (A36 ① · E36 · PORTS)

> 2026-09-11, transit-2 세션. 판정 정본은 `docs/BACKLOG.md` §1 A36·§5 E36(위원장 판정 2026-09-10)과 워크스페이스 `PORTS.md` gildongmu 행 "오디오 세션 소유권의 세 구멍"(dodo-planet@684cd8a0 관찰, 절차는 `cross-port` 스킬 §B·§C). 실험판 봉인(`#if EXPERIMENTAL`) 안이며 서버 변경 없음. 상태 머신 정본은 B2 spec `2026-08-04-transit-guidance-design.md` §13, 오디오 세션 정본은 `2026-08-08-background-tone-coverage-design.md` §3.2, 직전 상태 머신 개정은 `2026-09-11-transit-reboard-and-handoff-design.md`(A37·A34·E34).
>
> **설계 리뷰 판정**: 필수(오디오 세션 = 프로세스 전역 자원, 백그라운드 실행 = 안전·정확성 축, A16 L2 탈출구가 걸린 판정 계층 변경). 1회 적대적 리뷰 뒤 §9에 판정을 남긴다.

## 1. 문제 (판정 원문 요지)

- **A36 ①** `neverSeen`("탑승하신 차량을 찾지 못하고 있습니다… 탑승 변경을 눌러 주세요")의 10분 상한이 `now - ridingSince`로 찬다. 09-05 로그: 잠금 뒤 9분 백그라운드(폴 0회) → 복귀 첫 폴에서 즉시 `neverSeen`. 실제 관측은 3회였다. 판정: **상한을 실제 조회 횟수로 센다.** 주머니에 넣어 둔 시간, 조회가 실패한 구간, 앱이 죽어 있던 구간은 세지 않는다.
- **E36** 백그라운드에서 폴이 멈춘다(`pausedInBackground`). 판정: **백그라운드에서도 조회를 계속하고, 잡히는 순간(첫 관측 `trackingStarted`) 소리로 알린다.** 음성은 억제 유지. 사다리·도착 톤은 범위 밖(별건). 첫 관문은 오디오 세션 생존, 쿼터·배터리는 실측 항목.
- **PORTS 세 구멍** dodo가 `GuideAudioSession.swift`를 이식하며 관찰한 셋(①카테고리와 활성화를 한 값에 뭉갬 ②원복 자격을 저장 ③`routeChangeNotification` `.categoryChange` 메아리 미필터)을 **gildongmu 코드에서 각각 재현·확인**하고 해당하는 것만 고친다(dodo 관찰이지 gildongmu 재현이 아니다).

## 2. 범위

**한다**: A36 ① Kit ↔ 웹 미러 + 공유 fixture / E36 iOS 실험판(웹 미러 없음, BACKLOG 원문) / PORTS 세 구멍 판정표 + 해당 수정 + Kit 테스트 / 판정 회수 행(BACKLOG §2·FIELD-TEST §5) / PORTS 행 닫기.

**하지 않는다**: 사다리·도착·추세 톤의 백그라운드 발화(E36 원문이 별건으로 갈랐다) / 웹 백그라운드 폴(탭이 살아 있어야 도는 별개 축) / A35 착지·E33(transit-3) / `GuideBand.hasWalkHandoff` 잔여 정리(transit-1 인계, 소유 밖) / 무음 오디오 루프로 프로세스를 살리는 방식(§4.2.3 기각) / E35 현재역 추정.

## 3. 현행 계약 중 이 설계가 딛는 것 (코드로 확인한 서술)

- **`neverSeen` 판정 자리는 하나**: Kit `TransitGuide.swift` `handlePoll` 미등장 분기의 `now - since >= transitNeverSeenMs`(웹 `transit-guide.ts` `NEVER_SEEN_MS` 미러). `ridingSince`는 `enterRiding`에서 찍고 그 밖에선 nil로 지운다. 소비자는 이 판정뿐이다(톤·조망·표시 계층은 `ridingSince`를 읽지 않는다). 상한 시간의 근거 주석은 "폴 타이머가 멎으면 횟수 기반은 화면을 끌수록 시한이 늦게 온다"(실측 35분 11폴)였다. 그 근거는 백그라운드 폴 정지를 전제로 했고 A36은 정확히 그 전제를 결함으로 판정했다.
- 관련 fixture: `transit-guide-scenarios.json` 시나리오 21("미관측 시한 경과 → neverSeen 1회")·22("시한 전 첫 관측이면 영영 발화 안 함")·23("upstreamFailed 복구 폴은 neverSeen을 내지 않는다")이 `at` 시간축(300000·600000·900000…)으로 짜여 있다. 톤 fixture는 `neverSeen`을 쓰지 않는다.
- **riding 미등장 폴 주기는 60초**(`transitPollIntervalMs`: `trackingAnnounced ? 15_000 : 60_000`), 캡 뒤 60초. 비관측 잠금 riding·확정 도착은 0이고 즉폴 게이트(`restartPollLoop`·웹 `pollOnce`)가 `interval <= 0`이면 무조건 반환한다(transit-1 B1).
- **`TransitGuideModel`은 자기 `BeaconTonePlayer`를 갖지만 `beginSession()`·`endSession()`을 한 번도 부르지 않는다**(`tones.play`·`tones.shutdown`·`tones.isSuppressed`만). 그래서 대중교통 톤은 전부 `.ensureActive` 경로의 `.ambient`로 나가고, `.ambient`는 정의상 백그라운드에서 무음이다(2026-08-08 spec §3.2). 폴을 살려도 이대로면 첫 관측 소리는 나지 않는다.
- **프로세스 생존은 오디오 모드가 주지 않는다.** 2026-08-08 spec §3.3: "앱을 깨어 있게 유지하는 것은 여전히 `location` 모드다. `audio`는 재생 허용만 담당한다." `LocationService.startBeaconUpdates` 주석: "대중교통 추적은 위치가 아니라 네트워크 폴링이 생명선이라 이 경로를 지나지 않는다." iOS의 `audio` 백그라운드 모드는 **소리를 실제로 내는 동안만** 앱을 살려 두고 재생이 멎으면 곧 재운다(활성 `AVAudioSession`만으로는 부족). 대중교통 승차 국면은 소리 없는 구간이 수십 분이라, 폴 태스크를 취소하지 않아도 iOS가 프로세스를 재우는 순간 `Task.sleep` 타이머가 멎는다. **즉 현행 `pausedInBackground`를 지우는 것만으로는 E36이 성립하지 않는다.**
- **`TransitGuideModel.post`에는 전경 게이트가 없다**(`BeaconModel.post`의 `isForeground` 가드와 다르다). 지금은 백그라운드 폴이 0이라 백그라운드 통지도 0이지만, 폴을 살리면 통지가 백그라운드에서 게시된다. 2026-08-08 spec §3.1은 "백그라운드 무발화는 실측이지 API 계약이 아니다, 명시 게이트로 막는다"가 규칙이다.
- **오디오 세션 상태 머신** `guideAudioStep`(Kit, 테스트 11건): `desired`·`didPromote`·`isSuppressed` 세 값, 재조정 한 경로. `BeaconTonePlayer.apply`는 어느 카테고리든 `setCategory` + `setActive(true)`를 **무조건** 부르고(이미 그 카테고리여도 건너뛰지 않는다), `appliedCategory`는 마지막 적용 결과다. `observeInterruptions`는 `interruptionNotification`(`.ended`만) → `.interrupted`, `routeChangeNotification`·`mediaServicesWereResetNotification` → `.routeChanged`(**reason 필터 없음**)로 배선한다.
- 톤 발화 창구는 `TransitGuideModel.playTone` 한 곳(억제 가드), 통지 창구는 `announce`(지연 슬롯)·`announceNow`(즉시)·실제 게시 `post`. `trackingStarted`의 톤은 `transitEventProfile`이 `.ladder`(`closer` 소리)로 정한다.
- 복귀 통지: `handleScenePhaseChange(.active)`가 `pausedInBackground`일 때만 "안내를 재개합니다. {상태 문장}"(`transitGuide.resumed` + `signalStatusText`). 웹은 탭 숨김·복귀에 같은 `resumed` 키를 쓴다.

## 4. 설계

### 4.1 A36 ① — `neverSeen` 상한은 riding에서 **결과를 받은 조회 수**

**리듀서(Kit ↔ 웹)**: 상태 필드 `ridingSince: Double?`를 **`ridingPolls: Int`**로 바꾼다. 뜻은 "이번 riding 진입 이후 하차역 목록 조회가 **결과(ok·empty)를 돌려준 횟수**". 상수 `transitNeverSeenPolls = 10`(웹 `NEVER_SEEN_POLLS`). 판정은 `!recovered ∧ signal == notYetVisible ∧ phase == riding ∧ ridingPolls >= transitNeverSeenPolls`.

- **세는 것**: riding 국면에서 `handlePoll`이 `.ok`·`.empty`를 받아 매칭 판정에 이른 폴. 매칭됐으면 `trackingAnnounced`가 서서 이 축이 닫히므로 사실상 "미등장으로 끝난 조회 수"다. 카운트는 매칭 판정 **직전**에 올린다(미등장 분기와 `commitMatched` 어느 쪽으로 가든 "조회는 했다").
- **세지 않는 것**(spec 확정): ①`failed`·`unsupported`(조회 실패는 관측 실패가 아니다. 실패 구간을 시계로 세던 것이 결함의 절반이었다) ②`recovered` 폴(복구 직후 첫 폴은 `signalRecovered`가 소유하고 판정도 하지 않는 현행 그대로. 다만 카운트는 올린다. 실제로 목록을 받았기 때문이다) ③세대·순번 불일치로 폐기된 폴 ④waiting·boarding 폴(riding 전용 축, 현행 `ridingSince`가 riding 진입에서만 찍히던 것과 같은 경계) ⑤비관측 잠금 riding(폴 0 + `handlePoll` 조기 반환이라 카운트 지점에 닿지 않는다. transit-1 인계 그대로. A16 L2 탈출구가 필요 없는 잠금이다).
- **리셋**: `enterRiding`(관측·선언 공통)에서 0. `changeBoarding`·`advance`·`declareArrived` 등 riding을 벗어나는 전이에서 0(종전 `ridingSince = nil` 자리 전부). `restoreBoarding`이 riding으로 되돌리는 경로는 `enterRiding`을 지나지 않고 `previousPhase`를 복원하므로, 그 자리에서 **카운트를 유지한다**(탑승 변경 취소는 같은 열차를 계속 기다리는 것이라 종전에도 `ridingSince`가 복원됐다. 현행 코드가 `ridingSince`를 어떻게 다루는지 구현 시 확인하고 같은 규칙으로).
- **상한 10회의 근거**: 미등장 riding 주기 60초 × 10 = 종전 10분과 등가. 종전 상한이 "잠정, 실승차 판정 대상(A16 ①)"이었으니 이 값도 잠정이고, 축이 시간에서 횟수로 바뀌었으므로 §7에 "상한 횟수 적절성"을 다시 세운다. 캡 이후(60초)도 같은 주기라 등가가 유지되고, 추적 중 15초 주기는 `trackingAnnounced`라 이 축 밖이다. ⚠ E36이 백그라운드 폴을 살리면 같은 10회가 전경·배경 무관하게 약 10분에 찬다. 살리지 못하면(§4.2.3) 전경에 있는 시간만 센다. 어느 쪽이든 "조회 10번 만에 못 봤다"는 뜻은 같다.
- **웹 `ridingSince`의 타입 검사 방어 주석**(변이 주입 2026-08-16 기록)은 필드가 사라지므로 함께 지운다. `ridingPolls`는 `Int`라 nil 분기가 없고, 그 대신 "0에서 시작해 riding 밖에서는 오르지 않는다"가 fixture로 잠긴다.
- **소비자 영향 0**: 표시·통지·톤·조망은 `ridingSince`를 읽지 않는다(§3). 문장 `neverSeen`·`stateNeverSeen*`은 시간을 말하지 않아 불변.

### 4.2 E36 — 백그라운드 폴 지속 + 첫 관측 소리

#### 4.2.1 오디오 세션 승격 (첫 관문)

`TransitGuideModel.beginSession`에서 **첫 톤 전에 `tones.beginSession()`**, `stop()`에서 정지 톤 **뒤에 `tones.endSession()`**(BeaconModel과 같은 자리). 그래야 대중교통 세션 중 카테고리가 `.playback`이 되어 백그라운드에서 소리가 날 자격이 생긴다. 대가는 도보와 같다: 세션 중 무음 스위치를 무시한다(위원장이 도보에서 수용한 트레이드오프, 영향이 세션에 갇힌다). `teardown`의 `shutdown()`은 종전대로 원복을 마친다.

- 승격 실패(`!tones.isBackgroundAudible`)는 도보와 같이 **시작 시점에 1회** 음성으로 알린다(`ios.beacon.soundBackgroundUnavailable` 재사용, 문장이 수단 무관). 상시 표시 행은 두지 않는다(대중교통 시트에 `soundDegraded` 행이 없고, 세션 중 다시 켜 볼 수단도 없다. 미니멀).
- 승격은 `GuideSession`이 도보·대중교통 세션을 한 번에 하나만 허용하므로(`coordinator.claim`) 두 재생기가 같은 순간 세션을 소유하지 않는다. prewalk 인계(A25)는 도보 `stop()`의 `endSession()`(원복 대기) 뒤 600ms에 대중교통이 `beginSession()`을 부르는데, **원복 대기가 재생 잔여만큼이라 정지 톤(1.3초)이 600ms를 넘길 수 있다** → 대중교통 `beginSession()`이 도보 재생기의 미뤄진 원복을 취소하지 못한다(재생기 인스턴스가 다르다). 결과: 대중교통 세션이 `.playback`을 잡은 직후 도보 재생기가 `.ambient`를 적용해 **대중교통 세션이 통째로 잠금 무음**이 된다. 이것은 CLAUDE.md "소리를 낸 직후 세션을 끝내면…" 항목이 경고한 바로 그 형태의 두 인스턴스 판이다. 처방: 재생기를 하나로 합치지 않는다(BeaconModel·TransitGuideModel 소유 경계). 대신 **prewalk 도보 종료는 정지 톤을 내지 않는다**(`markPrewalk` 경로의 `onSessionEnd`가 `stop(playStopTone: false)`인지 확인. 이미 그렇다면 잔여 0이라 원복이 즉시 끝나 경합이 없다. 아니면 그렇게 바꾼다). 구현 시 실측 확인 항목 → §6.
- ⚠ **`.playback` 승격이 곧 백그라운드 실행 자격은 아니다**(§3). 승격은 "소리가 날 수 있다"까지만 준다.

#### 4.2.2 폴 지속과 백그라운드 톤 게이트

- `handleScenePhaseChange(.background/.inactive)`의 폴 태스크 취소와 `pausedInBackground`를 **폐지**한다. 폴 루프는 국면·주기(`transitPollIntervalMs`)만 본다. 백그라운드 전용 주기는 두지 않는다(§4.2.5 — 예산 계급이 새로 생기지 않고, A36의 횟수 축이 전경·배경에서 같은 뜻을 유지한다).
- **백그라운드 톤 허용 집합 = `trackingStarted`의 톤 하나.** `dispatch`가 이벤트·추세 톤을 `playTone`으로 보내기 전에 `isForeground`(게시 시점 조회, BeaconModel 동형)를 본다: 전경이면 종전 그대로, 백그라운드면 이벤트가 `.trackingStarted`일 때만 `playTone`. 추세 톤(`transitToneStep`)·다른 이벤트 톤은 백그라운드에서 내지 않되 **층 상태는 전진한다**(억제와 같은 출력 게이트 원칙). 사다리·도착·`unreliable`을 여기 넣지 않는 것은 E36 원문의 판정이다(별건).
- `trackingStarted` 톤은 종전 `.ladder`(`closer`) 그대로다. 새 소리를 만들지 않는다(E15 ② 신규 소리 0 원칙). 주머니에서 첫 관측을 뜻하는 소리로 구별되는지는 §7 실승차 판정.

#### 4.2.3 프로세스 생존 — 위원장 판정 사안 (아키텍처 양자택일)

§3대로 오디오 모드는 프로세스를 살리지 않는다. 대중교통 세션이 백그라운드에서 폴을 이어 가려면 **살리는 수단이 따로 필요하다.** 후보와 판정:

| 안 | 내용 | 대가 | 판정 |
|---|---|---|---|
| ⓐ **위치 스트림으로 살린다** | riding 국면 동안 `LocationService`에 **저정밀 스트림**(`kCLLocationAccuracyKilometer`·`distanceFilter` 500m·`activityType .otherNavigation`·`allowsBackgroundLocationUpdates`)을 연다. 좌표는 소비하지 않는다(로그만). `location` 모드는 두 plist에 이미 있고 권한도 도보와 같은 When In Use | 상태바 파란 위치 표시(끌 수 없음, 도보와 동일) · 배터리(저정밀이라 GPS 칩은 대개 꺼진다. 실측 §7) · 심사 관점에서 "대중교통 안내 세션 = 내비게이션"이라 용도 안에 있으나, 좌표를 쓰지 않는 스트림이라 심사 노트에 용도(세션 유지)를 적어야 한다 · 권한이 없으면(대중교통만 써 온 사용자) 스트림을 못 열고 ⓑ로 떨어진다 | **권장.** E36 판정("도보처럼")이 성립하는 유일한 경로. 지하 구간에서 fix가 안 와도 스트림이 열린 동안 프로세스가 유지되는지는 §7 실기기 판정 |
| ⓑ **살리지 않는다** | 폴 태스크만 안 끊는다. iOS가 재우기 전(대개 수 초~30초)의 폴 1회가 최대이고, 복귀 즉폴은 종전대로 | 0 | E36을 사실상 이루지 못한다(첫 관측이 그 30초 안에 올 확률만큼). 정직한 서술이 필요: "화면을 끄면 곧 멈춘다" |
| ⓒ 무음 오디오 루프 | 소리 없는 재생을 계속 틀어 `audio` 모드로 살린다 | App Review 2.5.4(백그라운드 서비스는 본래 용도로만) 거절 사유, 배터리 | **기각** |
| ⓓ 서버 푸시·Live Activity | 서버가 열차 위치를 감시해 푸시 | 새 서버 동작(웨이브 전제 위반), 인프라 | **기각(이번 웨이브)** |

**설계는 ⓐ를 기본값으로 쓰되 위원장 판정을 받는다**(자율성 헌장 하드 스톱 3: 두 안의 재작업 비용은 작지만 배터리·상태바 표시·심사 노트가 위원장의 수용 사안이고, E36 판정의 전제 "도보와 같은 방식"이 코드 실측으로 절반만 참이라 판정 근거가 바뀌었다). 질문은 §9 리뷰 뒤 한 번. ⓑ가 선택되면 §4.2.1·4.2.2·4.2.4는 그대로 두고(살아 있는 동안은 옳다) 상태 문장에 "화면이 꺼지면 조회가 멈춘다"를 싣지 않는다(런타임 판정 위에 상시 고지를 얹지 않는 규칙. 대신 §7 행이 실제 공백을 잰다).

ⓐ 구현 윤곽(판정 뒤 확정): `LocationService`에 `startKeepAliveUpdates()`/`stopKeepAliveUpdates()`(비콘 스트림과 **다른 진입점**, 같은 매니저. 비콘 스트림이 열려 있으면 no-op. `allowsBackgroundLocationUpdates`는 `backgroundLocationDeclared` 가드 그대로) — 소유 밖 파일이라 코디네이터에 자진 신고. `TransitGuideModel`은 **riding 진입에 열고 riding을 벗어날 때 닫는다**(waiting·boarding은 승차 정류소 목록이라 백그라운드 가치가 작고, riding 첫 관측이 E36의 대상이다). 권한 미보유면 열지 않고 로그 `keepAlive=denied` 한 줄. 위치 권한 팝업을 새로 띄우지 않는다(대중교통 시작이 권한 요청 지점이 아니다).

#### 4.2.4 음성 억제와 복귀 통지

- `TransitGuideModel.post`에 **`isForeground` 게이트**(BeaconModel 동형, 게시 시점 `UIApplication.shared.applicationState != .background`). 백그라운드 게시 시도는 `missedAnnouncement = true`로 남기고 게시하지 않는다. `droppedWhileSuppressed`(억제)와 별개 축이다.
- 복귀(`.active`, 직전이 `.background`): **현재 상태 문장 하나만** 낭독한다(`signalStatusText`, 비관측 인자 포함). 종전 "안내를 재개합니다."(`transitGuide.resumed`) 접두는 **iOS에서 뗀다**. 폴이 멈춘 적이 없으므로 거짓이고, iOS가 재웠던 경우에도 사용자에게 필요한 것은 "지금 상태"다(도보 복귀 발화 규칙 "누적이 아니라 현재 상태 하나"). 키는 웹이 계속 쓰므로 남긴다. 복귀 낭독은 `.inactive` 왕복(제어센터)에는 내지 않는다(종전 `pausedInBackground`가 `.inactive`에서도 서던 것을 `.background` 경유로 좁힌다. BeaconModel `wasBackgrounded` 동형).
- 복귀 즉폴은 종전대로(`restartPollLoop(immediate: true)`, 주기 0 게이트 통과). ⓐ에서 프로세스가 살아 있었으면 즉폴이 직전 폴과 가까울 수 있다. 한 번 더 조회하는 비용(1회)을 세대·순번 방어가 흡수하므로 그대로 둔다.
- `neverSeen`이 백그라운드에서 나면: 톤(`weak`)은 허용 집합 밖이라 무음, 문장은 `missedAnnouncement`. 복귀 시 상태 문장이 `stateNeverSeen`("열차 위치를 끝내 확인하지 못했습니다")이라 사실은 전달되지만 **탈출구 지시("탑승 변경을 눌러 주세요")는 그 문장에 없다.** 억제 해제 경로(`droppedWhileSuppressed`)가 마지막 문장을 되살리는 것과 같은 이유로, 복귀 시 `missedAnnouncement`가 서 있고 신호가 `neverSeen`이면 상태 문장 대신 **`transitGuide.neverSeen` 통지 문장**을 낸다(1회성 행동 문장 계약, memory `once-only-warning-delivery-contract`). 다른 신호는 상태 문장.

#### 4.2.5 쿼터

서울 지하철 실시간 키 일 1,000회(내 주변·역 정보와 공유). riding 폴은 미등장 60초·추적 15초. 30분 riding 한 세션 = 미등장 구간이 길면 ~30회, 추적이 일찍 잡히면 최대 ~120회(캡 240회는 세션당 상한이라 그 안). **전경에서 화면을 켜 둔 오늘의 세션과 같은 수**다. 늘어나는 것은 "화면을 끄고 있던 동안 안 나가던 폴"뿐이고 그 상한이 세션당 캡이다. 백그라운드 전용 주기(예: 120초)를 두면 30분에 ~15회를 아끼지만 A36 횟수 축의 뜻이 전경·배경에서 갈리고 첫 관측 지연이 2배가 된다. **두지 않는다.** 하루 2세션 기준 ≤ 240회 = 24%, 남은 예산은 `usage-report.mjs`가 답한다. ⚠ 실승차 로그의 `pollStart` 계수가 실측값이고 §7 행이 그것을 회수한다.

### 4.3 PORTS "오디오 세션 소유권의 세 구멍" 판정표 (cross-port §C 결함 계열형)

출처 정본: dodo-planet@684cd8a0 `ios/DodoPlanet/Core/Audio/AudioSessionOwnership.swift`·`AudioSessionOwner.swift`. 받는 쪽 현황은 gildongmu HEAD `9e808111` 실측(파일:행은 구현 커밋에서 갱신).

| # | dodo 관찰 | gildongmu 현황(실측) | 판정 |
|---|---|---|---|
| ① 카테고리·활성화 한 값 | 인터럽션은 활성화만 뺏고 카테고리는 남는데, 재조정이 `didPromote`만 보고 "이미 `.playback`이니 할 일 없음"으로 빠질 수 있다 → 통화 뒤 죽은 세션 위에서 무음 | `guideAudioStep` `.interrupted` → `reconcile` → **항상** `.apply(desired)`를 낸다("이미 그 카테고리"라는 단락 분기 자체가 없다). `BeaconTonePlayer.apply`는 카테고리와 무관하게 `setCategory` + `setActive(true)`를 부른다. 억제 중이면 `.none`이되 해제 재조정이 같은 경로를 지난다(테스트 `interruptionDuringSuppression`). `appliedCategory`는 활성화 상태를 뜻하지 않지만 그 값을 읽는 곳은 `isBackgroundAudible`(강등 표시)·`play()`의 "세션을 잡은 적 있는가"뿐이고 재조정 판정에 쓰이지 않는다 | **미재현.** 단, "인터럽션 종료가 이미 `.playback`인 상태에서도 재적용을 낸다"를 직접 단언하는 테스트가 없어(`interruptionDuringSuppression`은 억제 축) 그 단락 분기가 **도입되지 않도록** Kit 테스트 1건을 더한다(변이: `reconcile`에 "desired == 현재면 none" 단락을 넣으면 빨간불) |
| ② 원복 자격 저장 | `didPromote`를 저장하면 "실제로 원복하기 전에 자격을 반납"하는 상태가 표현 가능하다. dodo는 `applied`에서 유도해 표현 불가능하게 했다 | 저장 필드다. 그러나 갱신 지점이 둘뿐이고(`reconcile`: 적용하는 카테고리가 `.playback`인가 / `.sessionEnded`: `.ambient`를 적용하는 그 스텝에서만 false) 둘 다 **적용 동작과 같은 스텝**이다. 억제 중 종료는 자격을 유지한다(테스트 `endWhileSuppressed`). 따라서 불변식 **`didPromote == (마지막으로 적용한 카테고리 == .playback)`**이 모든 이벤트 열에서 성립한다(적용 실패는 앱 층 `apply`의 폴백이 `appliedCategory`를 `.ambient`로 두는데 그때 상태는 true로 남는다 → 종료 시 `.ambient` 재적용 1회가 남을 뿐 무해) | **미재현(불변식 성립).** 다만 그 불변식이 지금은 두 테스트의 부산물이라, 6종 이벤트의 **길이 ≤5 전수 열(6⁵=7,776)**에 대해 불변식을 단언하는 Kit 테스트 1건을 더해 "표현 불가능"과 등가로 만든다(변이: `.sessionEnded`의 `didPromote = false`를 지우거나 `reconcile`의 대입을 지우면 빨간불) |
| ③ `.categoryChange` 메아리 | `routeChangeNotification`의 `.categoryChange`는 자기 `setCategory`의 메아리라 걸러야 재조정 되먹임이 없다 | `observeInterruptions`가 reason을 읽지 않는다. `beginSession()` → `.apply(.playback)` → `setCategory(.playback)` → OS가 `.categoryChange` route 변경을 게시 → `.routeChanged` → `reconcile(rebuild: true)` → **플레이어 전부 정지·캐시 폐기 + 재적용**. 같은 카테고리 재적용은 메아리를 내지 않아 무한 되먹임은 아니지만(그랬다면 이미 관측됐다), 세션 시작마다 재생성이 한 번 더 돌고 통지가 `playTone(.start)` **뒤에** 도착하면 시작 톤(1.3초)이 잘린다(도착 순서는 실기기 판정 — 동기 전달이면 무해, 비동기면 절단). `mediaServicesWereReset`은 reason이 없어 무관 | **재현(코드).** Kit에 순수 매퍼 `guideAudioRouteChangeEvent(reason:) -> GuideAudioEvent?`(`.categoryChange` → nil, 그 밖 → `.routeChanged`, `mediaServicesWereReset`은 매퍼를 지나지 않고 `.routeChanged`)를 두고 `BeaconTonePlayer`가 그것만 지난다. 테스트: `.categoryChange` nil, `.oldDeviceUnavailable`·`.newDeviceAvailable`·`.override`·`.unknown` → `.routeChanged`. 부수: `apply(rebuildPlayers:)`가 `toneEndsAt`을 지우지 않아 재생성 뒤 발화 지연이 유령 종료 시각을 본다 → 재생성 분기에서 `toneEndsAt = nil` |

PORTS 행 처리: ①②`[done]`(미재현 확인 + 가드 테스트), ③`[done]`(수정) — 한 행이므로 `[done 2026-09-11]` + 이 spec 경로 + 판정 요지 한 줄. dodo 쪽 역이식 후보: 없음(dodo의 `applied`/`isActive` 분리는 dodo 구조에 맞는 해법이고 gildongmu는 불변식 테스트로 등가를 얻는다).

### 4.4 문장·키

새 사용자 문장 **없음**. iOS 복귀 낭독에서 `transitGuide.resumed` 접두를 뗀다(키는 웹이 사용, 삭제 없음). `ios.beacon.soundBackgroundUnavailable`("화면이 꺼지거나 다른 앱을 쓰는 동안에는 안내 소리가 나지 않습니다.")을 대중교통 승격 실패에 재사용.

### 4.5 접근성

- 백그라운드 발화 0(§4.2.4 게이트), 복귀 낭독은 상태 하나(또는 `neverSeen` 행동 문장). 새 통지 경로 없음, 전부 `announce` 창구.
- 백그라운드 소리는 `trackingStarted` 한 건. 사용자가 그 소리를 "첫 관측"으로 알아듣는지는 §7.
- 포커스·시트 변경 없음. 상태줄 문장 변경 없음.

### 4.6 계측

`transitGuideLog`: `scene phase=… tracking=…`(종전, `paused=` 필드 삭제) · `keepAlive start|stop|denied` · `bgTone kind=<tone> allowed=<bool>`(백그라운드 톤 게이트 판정, 전경은 남기지 않는다) · `neverSeen polls=<n>`(A36 판정 시). `pollStart sinceLast=`가 백그라운드 폴 지속의 실측 증거다(§7 — 배경 구간에서 60초 근처면 ⓐ가 살아 있는 것, 수백 초면 재웠던 것).

## 5. 불변식 점검

| 축 | 결과 |
|---|---|
| §13 상태 머신 | 새 입력·국면·신호·이벤트 없음. `neverSeen` 판정 조건 한 항(`ridingSince` 시간 → `ridingPolls` 횟수)만 바뀐다. `neverSeen` 1회성·`recovered` 배제·확정 신호 보존 규칙 불변 |
| A16 L2 탈출구(`neverSeen` → 역 선택) | 식별 잠금 riding에서 유지. 비관측 잠금은 종전대로 이 축 밖(폴 0). 백그라운드에서 났으면 복귀 시 행동 문장으로 회복(§4.2.4) |
| 음성 억제 계약(백그라운드 소리만) | `post` 전경 게이트 신설로 명시화. 소리는 허용 집합 1개 |
| 오디오 세션 소유권(`didPromote`, 전역 자원) | 대중교통이 도보와 같은 `beginSession`/`endSession` 계약을 지난다. 두 재생기 인스턴스가 동시에 세션을 쥐는 경로는 `coordinator.claim`이 막고, prewalk 인계의 원복 대기 경합은 §4.2.1 |
| 즉폴 게이트(B1) | 불변. 복귀 즉폴은 주기 0에서 나가지 않는다 |
| 쿼터 | 세션당 캡 240 불변, 백그라운드 전용 주기 없음(§4.2.5) |
| 개인정보 3자 일치 | ⓐ여도 수집·전송 항목 무변화(좌표는 서버로 보내지 않고 로그도 남기지 않는다. 위치 데이터 유형은 이미 신고) |
| `guidance-gate-drift` | 진입점 불변(세션 시작 경로 무변경) |

## 6. 테스트

- 공유 fixture(`transit-guide-scenarios.json`) 재작성: 시나리오 21 → 조회 10회째(전부 empty)에 `neverSeen`, 11회째 무이벤트. 22 → 첫 관측 뒤 empty가 10회를 넘어도 `neverSeen` 없음(signalLost 축). 23 → `failed` 3회(카운트 0) → 복구 폴(카운트 1, `signalRecovered`) → empty 9회 더 → 10회째 `neverSeen`. 신규 24: **시간축 무관** — `at`이 1시간 뛰어도 폴이 9회면 `neverSeen` 없음(A36 원문의 결함 재현 반증). 신규 25: `changeBoarding` → `restoreBoarding` 뒤 카운트 유지(또는 리셋 — §4.1 구현 시 확정한 규칙대로).
- Kit·웹 단위: `transitNeverSeenPolls`/`NEVER_SEEN_POLLS` == 10 상수 미러(fixture가 동조를 강제하므로 별도 drift 테스트는 두지 않는다).
- Kit 오디오: §4.3 ①②③ 테스트 3건 + 변이 주입 3회(각 1회) 실측을 커밋 메시지에 남긴다.
- prewalk 경합(§4.2.1): `BeaconModel.markPrewalk` 경로가 `stop(playStopTone: false)`인지 소스로 확인. 아니면 고치고 그 자리 주석.
- 웹: `ridingSince` 참조 제거 뒤 `tsc` 통과, `TransitGuidePanel.test.tsx` 무변경(neverSeen 렌더 경로 불변).
- 앱 타깃(테스트 레인 없음): Experimental 시뮬 빌드 + 소스 가드 없음. 백그라운드 동작은 §7 실기기.

## 7. 실승차·실기기 판정 (BACKLOG §2 표 · FIELD-TEST §5)

- **A36**: ①상한 10회가 적절한가(로그 `neverSeen polls=`와 그 시점 잔여 정거장 — 잔여가 아직 5 이상이면 상한이 짧다) ②백그라운드 왕복 뒤 복귀 첫 폴에서 `neverSeen`이 즉시 나지 않는가(09-05 재현 부정).
- **E36**: ①주머니 속 첫 관측 소리가 들리는가, 그 소리를 첫 관측으로 알아듣는가(같은 `closer` 소리) ②`pollStart sinceLast=`가 배경 구간에서 주기 근처인가(ⓐ 생존) — 지하 구간(fix 없음)에서도 그런가 ③배터리: 30분 승차 전후 % 차(도보 세션과 비교) ④복귀 낭독이 상태 한 문장인가, `neverSeen`이 배경에서 났을 때 복귀 문장이 행동 문장인가 ⑤무음 스위치를 켠 채 대중교통 세션 — 소리가 나는가(승격 확인) 종료 뒤 무음이 돌아오는가 ⑥승격 실패 문장이 시작 직후 1회만인가.
- **PORTS ③**: 도보·대중교통 시작음(1.3초)이 온전히 들리는가(종전 절단 여부는 이 수정 뒤 판정 불가 — "온전함"만 확인).
- **쿼터**: 세션 로그 `pollStart` 총수 대 `usage-report.mjs` 당일 소비.

## 8. 파일

Kit `TransitGuide.swift`(+`TransitGuideTests.swift`)·`GuideAudioSession.swift`(+`GuideAudioSessionTests.swift`) / iOS `TransitGuideModel.swift`·`BeaconTonePlayer.swift`·(ⓐ) `LocationService.swift`(소유 밖 — 자진 신고)·`BeaconModel.swift`(prewalk 정지 톤 확인, 필요 시 1줄) / 웹 `src/lib/transit-guide.ts`·`src/hooks/useTransitGuide.ts`(타입 참조만) / fixture `transit-guide-scenarios.json` + `transit-guide.test.ts` / `PORTS.md` 해당 행 / 문서 분배(CHANGELOG·BACKLOG·FIELD-TEST·CLAUDE.md·INTEGRATIONS·PROGRESS).

## 9. 설계 리뷰 판정

(리뷰 뒤 기록)

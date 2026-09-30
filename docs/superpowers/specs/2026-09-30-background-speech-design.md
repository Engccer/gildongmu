# 백그라운드 음성 안내 설계 (E53, 2026-09-30)

> **리뷰 게이트 판정**: 적대적 설계 리뷰 대상이다. 새 판정 계층(문장 분류·채널 선택 술어)과 안전 크리티컬 전달(1회성 경고의 "복귀 때 갚기" 계약)을 바꾸기 때문이다(글로벌 codex 운영 규칙 ①·④).

백로그 정본: `docs/BACKLOG.md` E53. 선행 설계: 백그라운드 톤 spec `2026-08-08-background-tone-coverage-design.md`(백그라운드는 소리만), 톤 뒤 발화 spec `2026-08-14`(`speechDeferStep`·`DeferredAnnouncer`), 나들이 spec `2026-09-26-outing-mode-design.md` §7.3(기기 음성 대기 한 칸), 대중교통 백그라운드 폴 spec `2026-09-11-transit-background-poll-design.md`.

## 1. 판정과 범위

**위원장 판정(2026-09-30, 그대로 구현)**
1. 백그라운드에서는 **행동을 바꾸는 문장만** 말한다(예고·임박·이탈·복귀·도착·1회성 경고). 반복되는 주기 통지는 빼고 그 자리는 지금처럼 효과음이 맡는다.
2. 토글 하나가 도보·자동차·대중교통·나들이 전부를 다스린다. 끄면 나들이도 화면이 꺼진 동안은 효과음만 난다.
3. 토글 이름은 "백그라운드 음성 안내", 기본값 켬. 실험판에만 노출하고(`AppConfig.experimentalBackgroundSpeechEnabled`, `#if EXPERIMENTAL`), 졸업 때 `#if`를 삭제한다.

**코디네이터 판정(2026-09-30)**: 잊힌 세션 안전망(A23)의 자동 종료는 백그라운드에서 말하지 않는다(위원장이 고른 "5분 정지 뒤 자동 종료는 백그라운드에서 지금대로 조용히"의 연장, BACKLOG §2 E55 도보 행 ⑤). 분류표에서 안전망 종료 문장은 "행동을 바꾸는 문장"이 아니다.

**불변**
- **정식판(Release) 동작은 한 글자도 바뀌지 않는다.** 정식판에서 토글의 실효값은 상수 거짓이고(§6), 그 값에서 채널 술어는 종전 분기와 같은 결과를 낸다(Kit 테스트가 전수로 잠근다). 백그라운드는 소리만, 자동차 운전자 모드 기기 음성은 종전대로다.
- 웹은 대상이 아니다(잠금 중 실행이 멈춘다). 안드로이드는 이식 판정 별도(PORTS 등록).
- 기기 음성은 `AVSpeechSynthesizer`라 새 외부 전송이 없다(개인정보 3자 일치 무영향). 서버 음성(`/api/tts`)은 안내에 쓰지 않는다(`TtsPlayer.speakGuidance`는 서버 경로가 없다).

## 2. 채널 선택 술어 (Kit 순수 함수)

`guideSpeechChannel(foreground:voiceOverRunning:speechClass:backgroundSpeechEnabled:foregroundDeviceSpeech:) -> GuideSpeechChannel`(`GuideSpeechChannel.swift`). 인자는 전부 기본값이 없다(안전 인자).

| 전경 | VoiceOver | 결과 |
|---|---|---|
| 전경 | 켜짐 | `.voiceOver` (VoiceOver 통지) |
| 전경 | 꺼짐 | `foregroundDeviceSpeech` ? `.device` : `.voiceOver` |
| 백그라운드 | 무관 | `backgroundSpeechEnabled ∧ speechClass == .actionable` ? `.device` : `.drop` |

- `foregroundDeviceSpeech`는 나들이만 참이다(나들이 spec §7.3: VoiceOver가 꺼진 전경에서도 기기 음성). 도보·자동차·대중교통은 거짓이라 전경 ∧ VoiceOver 꺼짐은 종전처럼 VoiceOver 통지 게시(듣는 사람이 없으면 무발화)다. 바꾸지 않는 이유: 정식판 불변, 그리고 VoiceOver를 쓰지 않는 전경 사용자는 화면을 본다.
- `.inactive`(제어 센터·알림 센터)는 전경이다(종전 `isForeground`와 같은 판정, 게시 시점 조회).
- **자동차 운전자 채널은 이 술어 위에 있다.** `BeaconModel.post`의 `driverChannel` 분기가 술어보다 먼저 기기 음성으로 낸다(K2 §6.2, 잠금 중 발화가 목적 그 자체). 토글과 무관하다: 운전자 모드는 사용자가 스피커 발화를 고른 모드이고, 토글을 끄면 운전자 안내가 잠금 중 무음이 되는 것은 판정 ②의 뜻(끄면 효과음만)과도 맞지 않는 결합이라 분리한다. 운전자 모드의 문장 빈도는 K2가 이미 정했다(주기·GPS 상태 통지 없음).

**정식판 등가성**: `backgroundSpeechEnabled = false`이면 백그라운드는 분류와 무관하게 `.drop`, 전경은 `.voiceOver`(도보·대중교통)라 종전 `guard isForeground else { missedAnnouncement = true; return false }` → VoiceOver 게시와 같다. Kit 테스트가 입력 전 조합(2×2×2×2)으로 종전 함수와 대조한다.

## 3. 문장 분류

### 3.1 규칙

- `actionable`(행동을 바꾸는 문장): 듣고 나서 사용자가 몸을 움직이거나 버튼을 눌러야 하는 문장, 또는 세션이 사용자 모르게 다른 국면으로 넘어가 그 사실을 모르면 잘못 움직이게 되는 문장. 예고·임박·이탈(확정 회차 첫 통지)·복귀·도착(확정)·1회성 경고·시작과 사용자 조작의 직접 응답.
- `deferrable`(주기·상태·사후 정리): 같은 내용이 일정 간격으로 되풀이되는 문장(거리 카운트다운·재통독·주기 통지·이탈 재통지), 위치·신호 상태 문장, 사후 정리 종료(안전망 종료·도착 추정 종료·대중교통 유휴 정지). 백그라운드에서는 효과음이 그 자리를 맡고, 전경 복귀 때 현재 상태 한 문장이 갚는다(종전 계약).
- **사용자 조작의 직접 응답(`announceNow`)은 `actionable`로 고정한다.** 버튼을 누른 직후의 응답이라 백그라운드에서 생길 일이 거의 없고, 생긴다면(목적지 전환 확인이 늦게 게시되는 경우) 들어야 한다.
- 호출부가 뜻을 밝힌다: 세 모델의 `announce`/`say` 창구와 `DeferredAnnouncer.announce`에 `speechClass`는 기본값 없는 필수 인자다. 새 통지 경로가 분류를 빠뜨리면 컴파일이 멈춘다([[no-default-for-safety-parameters]]).
- Kit 이벤트 열거형의 분류는 Kit 함수가 정본이다: `guideEventSpeechClass(_:offRouteEpisodeStart:)`(도보·자동차 `GuideEvent`), `beaconNoticeSpeechClass(_:)`(간략 안내 `BeaconNotice`), `transitEventSpeechClass(_:)`(`TransitGuideEvent`). 앱 호출부는 이 함수를 부르고, 앱에만 있는 문장(시작·도착·종료·재조회)은 호출부에서 밝힌다.

### 3.2 도보·자동차 (`BeaconModel`)

문장 근거는 `messages/ko.json`·`ios/i18n/ios-extra/ko.json`(정본)이다. 호출부 전수(48곳, 관측 `7cdce828`).

| 트리거(함수·이벤트) | 문장(ko 키·예) | 분류 | 근거 |
|---|---|---|---|
| 상세 시작 요약 `fetchAndStartDetail` | `GuideText.start`/`carStart` "{dest}까지 … {first}" (+계단 회피 열화 문장) | actionable | 시작 + 첫 행동. 계단 경고는 1회성(onDropped 장부) |
| 간략 강등 `fallbackToBrief` | `guide.detailUnavailable`·`guide.detailNoLocation`·`ios.guide.waypointDropped`/`waypointSkipped` | actionable | 안내 방식이 바뀐 사실(모르면 경로 안내를 기대하고 걷는다) |
| `announceSteps` / 운전자 `driverNotice` | `guide.bundle`·스텝 전문 | actionable | 예고 |
| `bundleReread` | 같은 전문 재통독(15초) | deferrable | 주기 |
| `imminent` stage 0 | `guide.imminent.*`·`guide.carImminent.*` "잠시 후 왼쪽으로 도세요" | actionable | 임박(반복 단계 15·10m는 원래 소리만) |
| `farNotice` | `guide.farNotice` "약 {distance} 앞에 다음 안내가 있습니다. {step}" | actionable | 예고 |
| `periodic` | `guide.periodicStraight`·`guide.nextDestination`·`guide.next` | deferrable | 주기 |
| `waypointReached` | `directions.viaArrivedContinue` | actionable | 도착(경유지) |
| `waypointApproaching` | `directions.viaRemaining` "경유지 {label}까지 {distance}" | actionable | 예고(1회) |
| `offRoute` 회차 시작 | `guide.offRoute`·`guide.carOffRoute` | actionable | 이탈 |
| `offRoute` 재통지(walk 60초·car 180초) | 같은 문장 | deferrable | 주기. walk는 재통지마다 warning 톤이 울린다(`offRouteRenotifyWarns`) |
| `backOnRoute` | `guide.backOnRoute` | actionable | 복귀 |
| `uncertainEnter`·`reacquiring` | `guide.uncertain`·`guide.reacquiring` | deferrable | 상태 |
| `uncertainExit`·`reacquired`(walk) | `guide.uncertainRecovered` | deferrable | 상태 |
| `reacquired`(car, 현재 구간 전문 동반) | "{상태} {현재 구간 전문}" | actionable | 다음 경계까지 안내가 없다(K2 §3.4) |
| 간략 비콘 `first`·`closer`·`farther` | `beacon.first`·`beacon.closer`·`beacon.farther` | deferrable | 주기(데드밴드마다) |
| 간략 비콘 `nearby` | `beacon.nearby` "목적지 근처 (약 ±{m}m)" | actionable | 도착(간략 안내의 도착 신호) |
| 간략 비콘 `weak`·워치독 `noticeStaleIfNeeded` | `beacon.weak` | deferrable | 상태(30초 재통지) |
| 최종 접근 진입 | `guide.finalApproachRouteEnd` + 배치 서술 | actionable | 1회성(onDropped 장부) |
| 최종 접근 틱(15초) | `guide.finalApproachTick` | deferrable | 주기 |
| 간략 인계 | `guide.handoff` | actionable | 안내 방식 전환 |
| 확정 도착 · prewalk 승차역 도착·선언 | `guide.arrived`·`transitGuide.prewalkArrived` | actionable | 도착 |
| 도착 추정 종료 `maybePresumeArrival` | `guide.arrivedPresumed` | deferrable | 사후 정리(도착 3~5분 뒤, 종도 전경에서만 — 위원장 2026-08-19. 코디네이터 판정의 유도) |
| 안전망 종료 `maybeEndIdleSession` | `guide.endedIdle` | deferrable | 코디네이터 판정 |
| 실패 종료 `fail(with:)` | `beacon.denied`·`beacon.reduced` 등 | actionable | 권한·정밀 위치 상실(행동 필요) |
| 사용자 중지 `stopByUser` | `ios.beacon.stopped` | actionable | 직접 응답 |
| 재조회·전환·자동 채택 성공 | `guide.autoReroute`·재조회·전환 요약 | actionable | 새 경로의 첫 행동(자동 채택은 이탈 회차의 결과) |
| 재조회 실패 | `guide.rerouteFailed` | actionable | 직접 응답(수동) |
| 대안 프리뷰 결과 | `guide.altPreviewNone`·`altPreviewFailed`·헤더 | actionable | 직접 응답(시트) |
| `announceProgress` | 진행 상황 | actionable | 직접 응답 |
| 소리 무음·백그라운드 무음 경고 | `ios.beacon.soundUnavailable`·`soundBackgroundUnavailable` | actionable | 1회성 경고(백그라운드에선 세션이 승격 실패면 기기 음성도 들리지 않는다 — §7) |
| 억제 해제 복구 `pendingRecovery` | 예고·원거리 예고·경유지 도착의 최신 1개 | actionable | 보관 대상이 전부 actionable |
| 전경 복귀 상환 | 장부 + 현재 상태 | actionable | 전경에서만 불린다 |
| `announceNow` 전부(목적지·경유지 전환, 거절) | `ios.guide.*`·`guide.alreadyActive` | actionable | 직접 응답 |

### 3.3 대중교통 (`TransitGuideModel`)

이벤트는 `transitEventSpeechClass`가 정본이다.

| 이벤트·트리거 | 문장(ko) | 분류 | 근거 |
|---|---|---|---|
| 세션 시작 | `transitGuide.startedAt` + 승차 문맥 | actionable | 시작(prewalk 도착 뒤 백그라운드 자동 시작 포함 — 차량 선택이 기다린다) |
| `vehicleSelected` | "{desc} 선택. {stop} 도착을 기다립니다." | actionable | 직접 응답 |
| `approaching` 잔여 ≤1 | "{stop}에 {message}." | actionable | 임박(지금 움직일 신호) |
| `approaching` 잔여 ≥2·첫 관측 | "선택한 차량을 추적합니다. …" | deferrable | 주기(사다리) |
| `arrivingAtBoardStop` | "{line} 곧 도착합니다." | actionable | 임박 |
| `vehiclePassed` | "선택한 차량이 {stop}에서 이미 출발한 것으로 보입니다." | actionable | 다른 차량을 골라야 한다 |
| `boarded`(observed·departed·declared) | "{line} 도착. 탑승하세요." / "탑승했습니다. 하차: {stop}." | actionable | 국면 전이. 오관측이면 탑승 변경이 필요하다 |
| `trackingStarted` | "추적을 시작합니다. …" | deferrable | 백그라운드 톤이 있는 유일한 이벤트(E36) — 그 톤이 자리를 맡는다 |
| `countdown` 잔여 ≤1 | 하차 임박 상태 문장 | actionable | 임박 |
| `countdown` 잔여 ≥2 | "남은 정거장 {n}개." 등 | deferrable | 주기(사다리) |
| `arrivingAtAlightStop` | "이번 정류장에서 내리세요." | actionable | 임박 |
| `arrived` | `transitGuide.arrived`·`arrivedGuess`·`…WalkNext` | actionable | 도착 + 버튼 지시 |
| `legAdvanced` | 다음 구간 문맥·`doneWalk` | actionable | 국면 전이(대개 직접 응답) |
| `neverSeen` | "…다른 차량을 타셨다면 탑승 변경을 눌러 주세요." | actionable | 1회성 행동 문장 |
| `messageChanged`·`backOnTrack`·`approxVehicleChanged`·`signalRecovered` | 상태 문장 | deferrable | 상태 |
| `signalLost`·`upstreamFailed` | "차량 신호를 찾지 못하고 있습니다." 등 | deferrable | 상태(복귀 즉폴·상태 문장이 갚는다) |
| `boardingReset`·`capSlowed` | "차량을 다시 선택합니다." · "실시간 조회가 많아 갱신 주기를 늦춥니다." | deferrable | 상태 |
| 완료(`completeOrAdvance`) | `finalLegText` | actionable | 도착 |
| 유휴 정지 `enterIdleIfDue` | `transitGuide.idlePaused` | deferrable | 안전망(코디네이터 판정의 유도, 복귀가 곧 조작이라 재개 문장이 갚는다 — E36 종전 계약) |
| 소리 무음 경고 | `ios.beacon.soundBackgroundUnavailable` | actionable | 1회성(latch는 발화 성공, onDropped) |
| 억제 해제 복구 `droppedWhileSuppressed` | 버린 마지막 문장 | 그 문장의 분류 | 분류를 함께 보관한다 |
| `announceExternal`(prewalk) | 시작 `prewalkStart`·불가 `prewalkUnavailable`·사용자 취소 `prewalkCancelled`(+정지) | actionable | 직접 응답·전이 |
| `announceExternal`(prewalk `.ended`) | `prewalkCancelled` | deferrable | 앞선 종료 문장(안전망이면 무음, 권한이면 도보 모델이 이미 말함)의 꼬리 |
| `announceNow` 전부(진행 상황·새로고침·재조회·재개) | | actionable | 직접 응답 |

### 3.4 나들이 (`OutingModel`)

나들이에서 "행동을 바꾸는 문장"은 도보와 다르게 읽는다: **지나침·도로명·출발점 낭독은 나들이의 본 기능이고 주기 통지가 아니다.** 사건(장소를 지났다·새 도로에 들어섰다)마다 한 번이고, 같은 문장이 간격을 두고 되풀이되지 않으며, 대신할 효과음이 없다(10m 비프는 거리다). 빈도는 사용자가 주변 낭독 단계(전부·이정표만·끔)로 이미 고른다. 그래서 `actionable`이다. 판정 ②의 "끄면 나들이도 효과음만"은 이 문장들이 토글에 걸린다는 뜻이다.

| 트리거 | 문장 | 분류 |
|---|---|---|
| 시작(+잠금 무음 경고) | `ios.outing.started` | actionable |
| 횡단보도 예고 | `ios.outing.crosswalkAhead(Audio)` | actionable(안전) |
| 지나침 | `ios.outing.passLeft/Right/Side` | actionable(본 기능) |
| 도로명 | `ios.outing.roadEntered` | actionable(본 기능) |
| 출발점 확정 상태 줄 | `statusLine`(출발점 {label}) | actionable(본 기능, 1회) |
| 사용자 종료 | `ios.outing.endedByUser` | actionable |
| 권한·정밀 위치 상실 종료 | `beacon.denied`·`beacon.reduced` | actionable |
| 안전망 종료 | `guide.endedIdle` | **deferrable**(코디네이터 판정 — 종전 실험판은 백그라운드에서 말했다. 바뀐다) |
| 소리 무음 경고 | `ios.beacon.soundUnavailable`·`soundBackgroundUnavailable` | actionable |
| 위치 신호 약함 | `beacon.weak` | 전경 VoiceOver 창구 전용(종전 그대로, 술어 밖) |
| 거절 `refuse` | `beacon.*`·`guide.alreadyActive` | actionable(직접 응답) |

**나들이 복귀 상환(신설, 최소)**: 백그라운드에서 버린 문장이 있었고(`missedAnnouncement`) 복귀 시점에 종료 화면이 남아 있으면 그 사유 문장(`endScreen.reason`) 하나를 낸다. 안전망 종료가 이제 백그라운드에서 무음이라, 없으면 돌아온 사용자가 세션이 끝난 것을 들을 길이 없다(도보는 `statusText` 꼬리가 같은 일을 한다). 추적 중 복귀에는 아무것도 갚지 않는다: 나들이의 1회성 문장(지나침·횡단보도)은 자리에 묶여 있어 나중에 갚으면 거짓이다(임박 명령과 같은 이유).

## 4. 전달 계약

### 4.1 톤 뒤 발화와 창구 (변경 최소)

모든 문장은 종전처럼 `DeferredAnnouncer`(톤 뒤 발화 `speechDeferStep`, 단일 슬롯 latest-wins, 세대)를 지나 모델의 `post`에서 채널이 갈린다. 새 직접 게시 경로는 만들지 않는다. 바뀌는 것은 `DeferredAnnouncer`가 분류와 `onDropped`를 `post`까지 나르는 것 하나다.

- `announce(_:highPriority:speechClass:onDropped:)` — `speechClass`는 필수.
- `announceNow(_:highPriority:bypassSuppression:)` — 분류는 `actionable` 고정(§3.1).
- `post: (text, highPriority, bypassSuppression, speechClass, onLateDrop) -> Bool`. `false`면 종전처럼 `DeferredAnnouncer`가 그 자리에서 `onDropped`를 부른다. `true`로 받아 기기 음성 대기 칸에 넣은 문장이 나중에 버려지면 `post` 쪽이 `onLateDrop`을 **한 번** 부른다(계약: `true`를 돌려줄 때만 보관하고, 버릴 때만 부른다).

### 4.2 기기 음성 대기 칸 (Kit `DeviceSpeechQueue`, 세 모델 공유)

나들이 `speakDevice`를 Kit 타입으로 올린다(`DeferredAnnouncer`와 같은 이유: 수명 계약이 위험 부위이고 앱 타깃엔 테스트 레인이 없다). 모델마다 인스턴스 하나, 타입 하나(복붙 금지). 동작은 나들이 spec §7.3 그대로:

1. 말하는 중이 아니면 즉시 말한다(선점하지 않는다 — 말하는 중인 문장을 끊지 않는다).
2. 말하는 중이면 대기 한 칸에 둔다. 칸에 있던 옛 문장은 버린다(그 `onDropped`를 부른다). 단 칸의 문장이 `keep`이고 새 문장이 `keep`이 아니면 새 문장을 버린다.
3. 0.3초 간격으로 확인해 말이 끝나면 꺼낸다. 꺼내는 순간 억제 중이면(받아쓰기) 버리고, `keep`이 아닌데 6초를 넘게 기다렸으면 버리고, 그 밖은 **채널을 다시 고른다**(술어를 다시 부른다: 전경 ∧ VoiceOver로 돌아왔으면 VoiceOver 통지, 여전히 백그라운드이고 토글이 켜져 있으면 기기 음성, 그새 토글을 껐으면 버림).
4. `keep` = `.high` ∨ 나들이 보호 문장(시작·횡단보도). 도착·종료·재조회 성공처럼 버려지면 세션 상태를 모르게 되는 문장이다.
5. 세션 경계(`advanceGeneration`과 같은 자리)의 `reset()`은 칸을 **`onDropped` 없이** 비운다(`DeferredAnnouncer.advanceGeneration`과 같은 이유: `stop()`이 장부를 먼저 비운 뒤라 복원이 끝난 세션의 경고를 되살린다).
6. `flush()`는 칸을 `onDropped`와 함께 비운다. 도보·대중교통의 전경 복귀 처리 맨 앞에서 부른다: 복귀 상환이 현재 상태를 말하는데 그 뒤에 대기 칸의 옛 문장이 VoiceOver로 흘러나오면 새 상태 뒤에 옛 상태를 듣는다. 버린 문장의 장부는 `onDropped`가 되살려 바로 이어지는 상환에 실린다.

"다른 앱의 VoiceOver 낭독과 겹칠 때"(판정 남은 세부): 다른 앱의 VoiceOver 발화는 앱이 관찰할 수 없다. 기본은 위 규칙 그대로(우리 기기 음성이 말하는 중일 때만 대기, 선점 금지)이고, 겹침은 실사용 판정 행으로 둔다(BACKLOG §2).

### 4.3 복귀 상환과 1회성 경고

- **토글이 꺼져 있으면 종전 계약 그대로다.** 백그라운드 문장은 전부 `.drop`이라 `missedAnnouncement = true`와 `onDropped`(장부: 계단 경고 `pendingStepFreeNotice`·최종 접근 진입 `pendingFinalApproachIntro`·대중교통 소리 무음 latch)가 그대로 선다.
- **켜져 있으면**: `actionable`은 기기 음성으로 나가고(장부가 서지 않는다 — latch는 발화 성공 시점), `deferrable`은 `.drop`으로 종전과 같이 `missedAnnouncement`를 세운다.
- **이미 말한 문장을 복귀 때 또 말하지 않는다**: 기기 음성으로 넘긴 순간 `missedAnnouncement = false`로 내린다. 상환의 뜻은 "마지막 상태를 못 들었다"인데 마지막 상태 문장을 들었으면 갚을 것이 없다(그 뒤 다시 버린 문장이 생기면 다시 선다). 대기 칸에서 나중에 버려지면 `onLateDrop`이 `missedAnnouncement = true`와 원래의 `onDropped`를 함께 부른다.
- 예: 백그라운드에서 도착 문장을 기기 음성으로 들었다 → `statusText`가 도착 문장이지만 `missedAnnouncement`가 거짓이라 복귀 때 되풀이하지 않는다. 주기 통지를 버린 뒤 도착을 들었다 → 역시 거짓(마지막을 들었다). 도착을 들은 뒤 안전망이 끝냈다 → 참, 복귀 때 종료 문장을 듣는다.

## 5. 대중교통: 백그라운드 채널 비중

E36 뒤로 대중교통의 백그라운드 톤은 `trackingStarted` 하나뿐이다. 토글이 켜지면 백그라운드에서 들리는 것은 톤보다 문장이 많아진다. 어떤 전이가 백그라운드에서 말하는지(§3.3의 actionable 중 폴 유래):

| 국면 | 프로세스 생존 | 백그라운드에서 나가는 문장 |
|---|---|---|
| waiting | keep-alive 없음(iOS가 재울 수 있다) | 사실상 없음. 차량 선택은 사용자 조작 |
| boarding | keep-alive(A46) | 곧 도착(`arrivingAtBoardStop`) · 잔여 ≤1 접근 · 도착·탑승하세요(`boarded` observed) · 이미 출발(`vehiclePassed`) |
| riding | keep-alive | 탑승(`boarded` departed) · 하차 임박(`countdown` ≤1) · 이번 정류장(`arrivingAtAlightStop`) · 도착(`arrived`) · 못 찾음 행동 문장(`neverSeen`) |
| arrived(확정)·비관측 riding | 폴 0 | 없음 |
| 유휴 정지 | 폴·keep-alive 정지 | 없음(유휴 정지 문장은 deferrable) |

사다리(잔여 ≥2)·상태 문장은 말하지 않는다. 한 구간에서 백그라운드 문장은 승차 쪽 2~3개, 하차 쪽 2~3개 안팎이다. 빈도는 실승차 판정 행(BACKLOG §2 E53 대중교통)으로 본다.

## 6. 설정 토글

- 키 `backgroundSpeechEnabled`(Kit `BackgroundSpeech.storageKey`), 기본값 켬(`BackgroundSpeech.defaultEnabled`). 판정은 게시 시점마다 읽는다(세션 중 바꾸면 다음 문장부터).
- 실효값 `BackgroundSpeech.isEnabled(stored:available:)` = `available ∧ (stored ?? true)`. `available`은 `AppConfig.experimentalBackgroundSpeechEnabled`(`#if EXPERIMENTAL` 참, 그 밖 거짓). 앱에서 이 함수를 부르는 자리는 `GuideSpeechOutput.backgroundSpeechEnabled` 한 곳(소스 가드).
- 자리: 설정 화면에서 "듣기 속도" 바로 뒤(음성 설정과 이웃하고, 실험 구성 전용 묶음의 맨 앞). `Section { Toggle } footer: { Text }`(진동 알림 확장 행과 같은 모양), `if AppConfig.experimentalBackgroundSpeechEnabled`.
- 문안(ko): 이름 "백그라운드 음성 안내"(위원장 판정). 설명(footer, 시안): "화면이 꺼지거나 다른 앱을 쓰는 동안에도 회전, 이탈, 도착 같은 안내와 나들이 주변 낭독을 기기 음성으로 말합니다." 설명을 두는 이유: 이름만으로는 무엇이 말해지는지(행동 문장만, 나들이 포함)가 드러나지 않는다. 끈 동작("효과음만")은 적지 않는다(끄면 종전으로 돌아가는 것이 자명하다).
- **졸업의 결합**: 나들이(`experimentalOutingEnabled`)가 이 토글보다 먼저 졸업하면 정식판 나들이는 백그라운드에서 무음이 된다(실효값이 거짓). 나들이 졸업은 이 토글의 졸업을 함께 하거나 앞세운다(AppConfig 주석).

## 7. 오디오 세션

- 기기 음성은 안내 세션의 오디오 세션 위에서 난다: 재생기(도보·대중교통·나들이 `BeaconTonePlayer`)가 세션 동안 `.playback` + `.mixWithOthers`로 승격하고, `TtsPlayer.speakGuidance`는 카테고리를 건드리지 않는다(종전 계약 — 여기서 `.duckOthers`로 다시 세팅하면 `guideAudioStep` 판정 밖에서 카테고리가 바뀐다). route 변경의 자기 메아리 판정(`guideAudioRouteChangeEvent`)과 소유권 이전(`.ownershipTransferred`)은 카테고리를 바꾸는 소비자가 늘지 않으므로 영향이 없다.
- 승격 실패(`isBackgroundAudible` 거짓)면 백그라운드에서 톤과 함께 기기 음성도 들리지 않는다. 기존 "화면이 꺼지거나 다른 앱을 쓰는 동안에는 안내 소리가 나지 않습니다" 경고가 그 조건을 이미 알린다(소리 = 톤과 음성).
- **소리를 낸 직후 말할 때**: 문장은 `speechDeferStep`이 톤 끝까지 미룬다(두 채널 공통의 앞단, 종전). 기기 음성 도중 새 톤이 울리면 섞여 난다(같은 앱의 두 재생기, `.mixWithOthers`) — 톤이 문장을 끊지 않는다.
- **말한 직후 세션을 끝낼 때**: `endSession(holdSeconds:)`이 원복을 미룬다. 유예 길이는 Kit `deviceSpeechHoldSeconds(textLength:speaking:)` 하나가 정한다: 글자 수를 알면 `min(12, max(4, 글자 수 × 0.15))`(나들이 종전 산식), 모르면 6초, 말하는 중이면 +3초. 나들이는 종료 문장 글자 수로(종전 값 그대로), 도보·대중교통은 `stop()` 시점에 **백그라운드 ∧ 토글 켬**일 때만 글자 수 모름(6초)으로 준다(그 밖 0초 — 정식판 불변). 운전자 채널 4초는 그대로다. `beginSession()`은 미뤄 둔 원복을 취소하고, 다른 재생기가 그 사이 시작했으면 원복 의무는 이전된다(종전).

## 8. 그 밖의 변경

- **도보 전경 복귀의 `liveTopText` 폴백(car-road 인계)**: 넣지 않는다. 도보 상환이 빈 `statusText`를 만나는 경로는 "실행 안내가 백그라운드에서 버려졌다"인데, 토글이 켜진 실험판에서는 실행 안내가 actionable이라 버려지지 않는다(말하고 `missedAnnouncement`를 내린다). 그 틈은 토글이 꺼진 경우와 정식판에만 남고, 정식판 도보 동작은 이번 마일스톤에서 바꾸지 않는다. 졸업 판정 때 함께 볼 후보로 남긴다.
- `BeaconModel.alternativePreviewAvailable` 주석: "두 줄 사이의 전환이라 `alternateLine`이 곧 반대편" → 조회 화면의 다른 줄 중 계단 회피 우선(`WalkLineKind.switchAlternate`, E52).

## 9. 검증

- Kit: 채널 술어 전수·정식판 등가성, 분류 함수 전수(모든 이벤트 케이스), `BackgroundSpeech.isEnabled`, `deviceSpeechHoldSeconds`, `DeviceSpeechQueue` 수명(즉시·대기·교체·keep·TTL·억제·재선택·reset·flush·onDropped 1회), `DeferredAnnouncer`의 분류·onLateDrop 전달.
- 소스 가드(웹 레인 `background-speech-guard.test.ts`): 기기 음성 호출(`speakGuidance`)은 공유 출력 한 곳과 운전자 채널 한 곳뿐 · 토글 실효값은 한 함수 · 설정 행은 실험 플래그 조건 안 · 플래그는 `#if EXPERIMENTAL`에서만 참 · 세 모델의 `post`는 술어를 지난다 · `speechClass`에 기본값 없음 · 운전자 분기는 술어보다 앞. 기존 가드(`outing-guard`·`transit-background-guards`)는 새 구조로 옮긴다.
- 빌드: 앱 Experimental·Release 두 구성.
- 실사용(BACKLOG §2 E53 행): 잠금 중 기기 음성이 실제로 들리는가(그 뒤 톤이 계속 들리는가) · 다른 앱 VoiceOver 낭독과 겹침 · 문장 빈도(도보 실보행·자동차 실주행·대중교통 실승차·나들이 실보행) · 배터리.

## 10. 안드로이드

이식 판정 별도. PORTS에 등록할 문장은 완료 보고에 적는다(웹은 잠금 중 실행이 멈춰 대상 아님).

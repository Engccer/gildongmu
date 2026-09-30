# 백그라운드 음성 안내 설계 (E53, 2026-09-30)

> **리뷰 게이트 판정**: 적대적 설계 리뷰 대상이다. 새 판정 계층(문장 분류·채널 선택 술어)과 안전 크리티컬 전달(1회성 경고의 "복귀 때 갚기" 계약)을 바꾸기 때문이다(글로벌 codex 운영 규칙 ①·④).

> **리뷰 결과(2026-09-30, fable 1회, BLOCKER 1·MAJOR 7·MINOR 10, 보고 `bg-speech-reports/review-design-202609301916.md`)**: 반영. B1 채널 술어에 가청 여부(`backgroundAudible`, 재생기 `isBackgroundAudible`)를 넣어 승격 실패 때 들리지 않는 문장을 "전달"로 치지 않는다(§2) · M1 대기 칸의 버림을 교체(`superseded`)와 미전달(`undelivered`)로 갈라 교체는 복귀 표식을 세우지 않는다(§4.2·§4.3) · M2 `.high`는 대기하지 않고 선점하고, 새 문장을 막는 "보호"는 나들이 시작·횡단보도에만 남겼다(§4.2) · M3 대기는 안내 발화만 기다리고 채팅 듣기는 끊는다(`TtsPlayer.isSpeakingGuidance`, §4.2) · M4 원복을 글자 수 어림이 아니라 발화 종료에 결박했다(`endSession(speechBusy:)`, §7) · M5 복귀는 flush가 아니라 인계(`handOver`: 말하는 중인 안내를 끊고 그 문장과 칸의 문장을 VoiceOver로 다시 낸다, §4.2) · M6 나들이 종료 상환을 종료 화면이 아니라 종료 사유 장부에 걸었고, 백그라운드에서 알릴지는 위원장 판정으로 닫았다(나들이만 종료음 + 문장, §1·§3.4) · M7 prewalk `.ended`는 행동 문장(안전망은 prewalk에 돌지 않는다, §3.3) · m1 버림 통지는 문장마다 최대 한 번, 주체는 대기 칸 · m2 직접 응답은 꺼낼 때 억제 검사 면제 · m3 즉시 발화 전 칸 비우기 · m4 대중교통 인계는 추적 가드 앞 · m6 분배 절(§11) · m7 `spokenUnits` 경유 명시 · m8 호출부 수치 삭제 · m10 꺼내기 전 톤 뒤 대기. 기각. §8 주석 수정은 코디네이터 지시라 유지(범위 잡음 지적) · m9 진단 로그는 정식판에서 빈 함수(`guideDiagLog`·`transitGuideLog`가 `#else` 무동작)라 관측 동작이 아니다 · footer의 나들이 언급은 사용자 문안이라 판정 경로로 넘긴다(§6) · m5는 기록만(졸업 판정 항목).

> **구현 리뷰(2026-09-30, spec 준수·코드 품질·접근성 3종, 보고 `bg-speech-reports/review-{spec,quality,a11y}-*.md`)**: 반영. 복귀 인계가 "지금 소리가 이 칸의 발화인가"를 발화 토큰으로 가른다(다른 모델의 발화를 끊고 낡은 문장을 되살리던 결함, spec M-1·품질 M-1) · 인계는 게시하지 않고 목록을 돌려주고 모델이 상환과 `.high` 한 통지로 합친다(품질 M-2·M-3·접근성 MAJOR 1) · 임박 명령은 `urgent` 분류로 기기 음성에서도 선점(접근성 MAJOR 2) · 채널이 그대로 기기 음성이면 인계가 끊지 않는다·인계도 억제·유효 시간을 지난다·선점으로 끊긴 이 칸의 발화는 `superseded` 통지(접근성 m2~m4, 품질 m-1·m-2) · 톤 대기 상한은 한 번의 대기당·드레인은 대기 동안 self를 붙들지 않는다(품질 m-3·m-7) · prewalk 도착 추정은 행동 문장(spec m-3) · 죽은 `TtsPlayer.isSpeaking` 삭제·운전자 원복 다리 통일·낡은 주석(품질 m-5·m-6) · 로케일별 나들이 낭독 이름(접근성 m1) · 가드 짝 검사·도보 `post` 표식 가드(품질 m-4). 기록만: 안드로이드 설정 문자열이 소비자 없이 생성된다(품질 m-9, 이식 때 소비) · `TransitTrackingSheet`의 배경 게시 주석(품질 m-6 한 자리)은 병행 세션 소유 파일이라 보고로 넘긴다 · CLAUDE.md 나들이 문장(spec m-6)은 코디네이터 반영.

> **통합본 횡단 리뷰 후속(2026-09-30, 세션 guide-followup, 입력 `coord-reports/review-cross-w7.md` F3~F6)**: 넷 다 1회성 안전 경고 전달 계약에 걸린다(못 말했으면 갚는다, 말했으면 또 말하지 않는다). F3 prewalk `.ended` 문장은 대중교통 창구가 아니라 도보 실패 문장에 붙인다(§3.3) · F4 칸 밖의 정지가 칸의 발화를 끊으면 `undelivered`(§4.2 ⑨) · F5 인터럽션으로 멈춘 발화는 끊고 갚으며 일시정지로 남은 발화는 칸을 막지 않는다(§4.2 ⑩) · F6 인계받은 문장이 합본 게시의 억제 버림에 사라지면 장부를 되살린다(§4.2 ⑧). 대중교통은 억제 버림을 `droppedWhileSuppressed`가 해제 때 합본째 다시 내므로 F6 해당 없음(기각). 적대적 설계 리뷰(fable, E57 개정과 한 회, 보고 `guide-followup-reports/review-design-202609301930.md`)의 이쪽 반영: MAJOR 3 F5를 시간 상한(12초)으로 막으면 열화 문장이 붙은 긴 요약 같은 정상 발화를 끊고 칸의 문장도 유효 시간으로 버린다 → 굳음의 직접 신호(`isPaused`)로 바꿨다 · m4 prewalk 실패 키에 `beacon.weak` · m5 F3 결합 문장은 전경에도 적용(정식판은 대중교통 봉인이라 도달 없음, §1 예외)·`statusText`도 결합 문장 · m6 ⑨의 실효 범위(나들이 종료 문장, 운전자 채널 밖) · m7 선점으로 버려진 합본의 되돌림은 `undelivered`라 다음 복귀에 현재 상태 한 문장을 한 번 더 갚을 수 있다(수용: 1회성 장부 복원은 어느 쪽이든 옳다) · m8 F6 대중교통 기각 근거 정정(억제 중 다른 게시가 덮지 않는 한). 후속 구현 리뷰(spec 준수·코드 품질·접근성, E57 spec 머리)의 이쪽 반영: ⑩을 인터럽션 시작 처리 + 두 술어로(접근성 M2·코드 품질 M1) · 다른 칸의 발화가 끊은 문장도 알림(코드 품질 m1, ⑨) · 나들이 종료 장부는 원래 종료 시각으로 되돌림(n1) · §9 가드 목록. 증분 확인 리뷰의 이쪽 반영: 끊김 이유 구분(⑨)·인터럽션 계측과 `wasSuspended` 무시(⑩)·Kit 하네스가 합성기 알림을 흉내 내 드레인 경로를 잠금.

> **검증 리뷰(2026-09-30, 수정 커밋 `3c484f07`·`ad5c4148` 대상, 보고 `bg-speech-reports/review-verify-202609301958.md`, BLOCKER 0·MAJOR 0·MINOR 8)**: 선행 MAJOR 6건 해소 확인. 반영: N2 중복 제거는 낭독 정정 뒤끼리 · N3 VoiceOver 꺼진 복귀는 인계하지 않는다 · N4 유휴 재개 복귀는 재개 문장 앞에 · N5 드레인 폴백 게시 `.high` · N6 술어 망라 switch · N7 문서 불일치 · N8 테스트·가드 검출력(톤 상한 탈출, 상한 재설정, urgent 통지, 합친 뒤 비우기) · nit 주석. 기록만: N1 모델 사이의 연속 통지(§4.2 ⑧, 실승차 관찰).

백로그 정본: `docs/BACKLOG.md` E53. 선행 설계: 백그라운드 톤 spec `2026-08-08-background-tone-coverage-design.md`(백그라운드는 소리만), 톤 뒤 발화 spec `2026-08-14`(`speechDeferStep`·`DeferredAnnouncer`), 나들이 spec `2026-09-26-outing-mode-design.md` §7.3(기기 음성 대기 한 칸), 대중교통 백그라운드 폴 spec `2026-09-11-transit-background-poll-design.md`.

## 1. 판정과 범위

**위원장 판정(2026-09-30, 그대로 구현)**
1. 백그라운드에서는 **행동을 바꾸는 문장만** 말한다(예고·임박·이탈·복귀·도착·1회성 경고). 반복되는 주기 통지는 빼고 그 자리는 지금처럼 효과음이 맡는다.
2. 토글 하나가 도보·자동차·대중교통·나들이 전부를 다스린다. 끄면 나들이도 화면이 꺼진 동안은 효과음만 난다.
3. 토글 이름은 "백그라운드 음성 안내", 기본값 켬. 실험판에만 노출하고(`AppConfig.experimentalBackgroundSpeechEnabled`, `#if EXPERIMENTAL`), 졸업 때 `#if`를 삭제한다.

**코디네이터 판정(2026-09-30)**: 잊힌 세션 안전망(A23)의 자동 종료는 백그라운드에서 말하지 않는다(위원장이 고른 "5분 정지 뒤 자동 종료는 백그라운드에서 지금대로 조용히"의 연장, BACKLOG §2 E55 도보 행 ⑤). 분류표에서 안전망 종료 문장은 "행동을 바꾸는 문장"이 아니다. 도보·자동차·대중교통에 적용한다.

**위원장 판정(2026-09-30, 설계 리뷰 M6에서 올린 질문의 답)**: **나들이만 예외**다. 나들이가 화면이 꺼진 동안 안전망으로 끝나면 나들이 종료음에 이어 종료 문장을 기기 음성으로 말한다(백그라운드 음성 안내가 켜져 있을 때. 꺼져 있으면 종료음만). 근거는 나들이가 잠근 채 10m 비프를 듣고 걷는 모드라, 조용히 끝나면 비프가 끊긴 이유를 알 길이 없다는 것이다. 도보 안내의 안전망 종료는 종전대로 무음이다.

**불변**
- **정식판(Release) 동작은 한 글자도 바뀌지 않는다.** 정식판에서 토글의 실효값은 상수 거짓이고(§6), 그 값에서 채널 술어는 종전 분기와 같은 결과를 낸다(Kit 테스트가 전수로 잠근다). 백그라운드는 소리만, 자동차 운전자 모드 기기 음성은 종전대로다. 예외 둘(2026-09-30 횡단 리뷰 후속): 승차 전 도보가 권한·정밀 위치로 끝날 때의 결합 문장(§3.3, 정식판은 대중교통 봉인이라 도달하지 않는다)과 `TtsPlayer.isSpeakingGuidance`의 일시정지 제외와 인터럽션 시작의 안내 발화 정지(§4.2 ⑩, 정식판엔 안내 기기 음성이 없어 관측 동작은 일시정지 고착 때의 원복 대기뿐이다). 그 밖에 도보 복귀 상환의 `.high`와 종료 화면 없는 권한 상실 통지의 `.high`는 E57 후속의 정식판 변경이다(E57 spec §3.2, 접근성 감사 L4).
- 웹은 대상이 아니다(잠금 중 실행이 멈춘다). 안드로이드는 이식 판정 별도(PORTS 등록).
- 기기 음성은 `AVSpeechSynthesizer`라 새 외부 전송이 없다(개인정보 3자 일치 무영향). 서버 음성(`/api/tts`)은 안내에 쓰지 않는다(`TtsPlayer.speakGuidance`는 서버 경로가 없다).

## 2. 채널 선택 술어 (Kit 순수 함수)

`guideSpeechChannel(foreground:voiceOverRunning:speechClass:backgroundSpeechEnabled:backgroundAudible:foregroundDeviceSpeech:) -> GuideSpeechChannel`(`GuideSpeechChannel.swift`). 인자는 전부 기본값이 없다(안전 인자).

| 전경 | VoiceOver | 결과 |
|---|---|---|
| 전경 | 켜짐 | `.voiceOver` (VoiceOver 통지) |
| 전경 | 꺼짐 | `foregroundDeviceSpeech` ? `.device` : `.voiceOver` |
| 백그라운드 | 무관 | `backgroundSpeechEnabled ∧ backgroundAudible ∧ speechClass ∈ {actionable, urgent}` ? `.device` : `.drop`(분류는 망라 switch, 새 분류는 컴파일에서 판정된다) |

- `backgroundAudible`은 그 모델 재생기의 `isBackgroundAudible`(카테고리 `.playback` ∧ 활성)이다. 승격이 실패·지연된 세션에서 기기 음성은 백그라운드에서 들리지 않는데, 그것을 `.device`로 "전달"하면 1회성 경고 latch와 복귀 상환이 들리지 않은 문장에 소비된다(설계 리뷰 B1). 그때는 `.drop`이라 종전 상환 계약이 그대로 돈다.

- `foregroundDeviceSpeech`는 나들이만 참이다(나들이 spec §7.3: VoiceOver가 꺼진 전경에서도 기기 음성). 도보·자동차·대중교통은 거짓이라 전경 ∧ VoiceOver 꺼짐은 종전처럼 VoiceOver 통지 게시(듣는 사람이 없으면 무발화)다. 바꾸지 않는 이유: 정식판 불변, 그리고 VoiceOver를 쓰지 않는 전경 사용자는 화면을 본다.
- `.inactive`(제어 센터·알림 센터)는 전경이다(종전 `isForeground`와 같은 판정, 게시 시점 조회).
- **자동차 운전자 채널은 이 술어 위에 있다.** `BeaconModel.post`의 `driverChannel` 분기가 술어보다 먼저 기기 음성으로 낸다(K2 §6.2, 잠금 중 발화가 목적 그 자체). 토글과 무관하다: 운전자 모드는 사용자가 스피커 발화를 고른 모드이고, 토글을 끄면 운전자 안내가 잠금 중 무음이 되는 것은 판정 ②의 뜻(끄면 효과음만)과도 맞지 않는 결합이라 분리한다. 운전자 모드의 문장 빈도는 K2가 이미 정했다(주기·GPS 상태 통지 없음).

**정식판 등가성**: `backgroundSpeechEnabled = false`이면 백그라운드는 분류·가청과 무관하게 `.drop`, 전경은 `.voiceOver`(도보·대중교통)라 종전 `guard isForeground else { missedAnnouncement = true; return false }` → VoiceOver 게시와 같다. Kit 테스트가 입력 전 조합(2^4 × 분류 3)으로 종전 함수와 대조한다. 두 채널 모두 거리 단위 낭독 정정(`spokenUnits`)을 지난다(CLAUDE.md 거리 표기 계약). 새 진단 로그(`bgSpeech`·`outingSpeak`의 `fg=`·`class=`)는 정식판에서 빈 함수라 관측 동작이 아니다.

## 3. 문장 분류

### 3.1 규칙

- `actionable`(행동을 바꾸는 문장): 듣고 나서 사용자가 몸을 움직이거나 버튼을 눌러야 하는 문장, 또는 세션이 사용자 모르게 다른 국면으로 넘어가 그 사실을 모르면 잘못 움직이게 되는 문장. 예고·임박·이탈(확정 회차 첫 통지)·복귀·도착(확정)·1회성 경고·시작과 사용자 조작의 직접 응답.
- `deferrable`(주기·상태·사후 정리): 같은 내용이 일정 간격으로 되풀이되는 문장(거리 카운트다운·재통독·주기 통지·이탈 재통지), 위치·신호 상태 문장, 사후 정리 종료(안전망 종료·도착 추정 종료·대중교통 유휴 정지). 백그라운드에서는 효과음이 그 자리를 맡고, 전경 복귀 때 현재 상태 한 문장이 갚는다(종전 계약).
- `urgent`(시간에 묶인 행동 문장): 도보·자동차 임박 명령("잠시 후 …"). 채널은 `actionable`과 같고 기기 음성 대기 칸에서 선점한다(전문 뒤에 줄 서면 회전 지점을 지나서 나온다). 전경 VoiceOver 우선순위는 바꾸지 않는다.
- **사용자 조작의 직접 응답(`announceNow`)은 `actionable`로 고정한다.** 버튼을 누른 직후의 응답이라 백그라운드에서 생길 일이 거의 없고, 생긴다면(목적지 전환 확인이 늦게 게시되는 경우) 들어야 한다.
- 호출부가 뜻을 밝힌다: 세 모델의 `announce`/`say` 창구와 `DeferredAnnouncer.announce`에 `speechClass`는 기본값 없는 필수 인자다. 새 통지 경로가 분류를 빠뜨리면 컴파일이 멈춘다([[no-default-for-safety-parameters]]).
- Kit 이벤트 열거형의 분류는 Kit 함수가 정본이다: `guideEventSpeechClass(_:offRouteEpisodeStart:)`(도보·자동차 `GuideEvent`), `beaconNoticeSpeechClass(_:)`(간략 안내 `BeaconNotice`), `transitEventSpeechClass(_:)`(`TransitGuideEvent`). 앱 호출부는 이 함수를 부르고, 앱에만 있는 문장(시작·도착·종료·재조회)은 호출부에서 밝힌다.

### 3.2 도보·자동차 (`BeaconModel`)

문장 근거는 `messages/ko.json`·`ios/i18n/ios-extra/ko.json`(정본)이다. 표는 함수·이벤트 단위이고 호출부 전수는 `speechClass` 필수 인자(컴파일)가 강제한다.

| 트리거(함수·이벤트) | 문장(ko 키·예) | 분류 | 근거 |
|---|---|---|---|
| 상세 시작 요약 `fetchAndStartDetail` | `GuideText.start`/`carStart` "{dest}까지 … {first}" (+계단 회피 열화 문장) | actionable | 시작 + 첫 행동. 계단 경고는 1회성(onDropped 장부) |
| 간략 강등 `fallbackToBrief` | `guide.detailUnavailable`·`guide.detailNoLocation`·`ios.guide.waypointDropped`/`waypointSkipped` | actionable | 안내 방식이 바뀐 사실(모르면 경로 안내를 기대하고 걷는다) |
| `announceSteps` / 운전자 `driverNotice` | `guide.bundle`·스텝 전문 | actionable | 예고 |
| `bundleReread` | 같은 전문 재통독(15초) | deferrable | 주기 |
| `imminent` stage 0 | `guide.imminent.*`·`guide.carImminent.*` "잠시 후 왼쪽으로 도세요" | urgent | 임박(반복 단계 15·10m는 원래 소리만) |
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
| 도착 추정 종료 `maybePresumeArrival` | `guide.arrivedPresumed`(prewalk면 `transitGuide.prewalkArrived`, actionable) | deferrable | 사후 정리(도착 3~5분 뒤, 종도 전경에서만, 위원장 2026-08-19. 코디네이터 판정의 유도) |
| 안전망 종료 `maybeEndIdleSession` | `guide.endedIdle` | deferrable | 코디네이터 판정 |
| 실패 종료 `fail(with:)` | `beacon.denied`·`beacon.reduced` 등 | actionable | 권한·정밀 위치 상실(행동 필요) |
| 사용자 중지 `stopByUser` | `ios.beacon.stopped` | actionable | 직접 응답 |
| 재조회·전환·자동 채택 성공 | `guide.autoReroute`·재조회·전환 요약 | actionable | 새 경로의 첫 행동(자동 채택은 이탈 회차의 결과) |
| 재조회 실패 | `guide.rerouteFailed` | actionable | 직접 응답(수동) |
| 대안 프리뷰 결과 | `guide.altPreviewNone`·`altPreviewFailed`·헤더 | actionable | 직접 응답(시트) |
| `announceProgress` | 진행 상황 | actionable | 직접 응답 |
| 소리 무음·백그라운드 무음 경고 | `ios.beacon.soundUnavailable`·`soundBackgroundUnavailable` | actionable | 1회성 경고. 승격 실패면 술어가 버림을 내서 종전처럼 장부가 서고 복귀 때 갚는다(§2 가청) |
| 억제 해제 복구 `pendingRecovery` | 예고·원거리 예고·경유지 도착의 최신 1개 | actionable | 보관 대상이 전부 actionable |
| 전경 복귀 상환 | 장부 + 현재 상태 | actionable | 전경에서만 불린다 |
| `announceNow` 전부(목적지·경유지 전환, 거절) | `ios.guide.*`·`guide.alreadyActive` | actionable | 직접 응답 |

### 3.3 대중교통 (`TransitGuideModel`)

이벤트는 `transitEventSpeechClass`가 정본이다.

| 이벤트·트리거 | 문장(ko) | 분류 | 근거 |
|---|---|---|---|
| 세션 시작 | `transitGuide.startedAt` + 승차 문맥 | actionable | 시작(prewalk 도착 뒤 백그라운드 자동 시작 포함, 차량 선택이 기다린다) |
| `vehicleSelected` | "{desc} 선택. {stop} 도착을 기다립니다." | actionable | 직접 응답 |
| `approaching` 잔여 ≤1 | "{stop}에 {message}." | actionable | 임박(지금 움직일 신호) |
| `approaching` 잔여 ≥2·첫 관측 | "선택한 차량을 추적합니다. …" | deferrable | 주기(사다리) |
| `arrivingAtBoardStop` | "{line} 곧 도착합니다." | actionable | 임박 |
| `vehiclePassed` | "선택한 차량이 {stop}에서 이미 출발한 것으로 보입니다." | actionable | 다른 차량을 골라야 한다 |
| `boarded`(observed·departed·declared) | "{line} 도착. 탑승하세요." / "탑승했습니다. 하차: {stop}." | actionable | 국면 전이. 오관측이면 탑승 변경이 필요하다 |
| `trackingStarted` | "추적을 시작합니다. …" | deferrable | 백그라운드 톤이 있는 유일한 이벤트(E36). 그 톤이 자리를 맡는다 |
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
| 유휴 정지 `enterIdleIfDue` | `transitGuide.idlePaused` | deferrable | 안전망(코디네이터 판정의 유도, 복귀가 곧 조작이라 재개 문장이 갚는다. E36 종전 계약) |
| 소리 무음 경고 | `ios.beacon.soundBackgroundUnavailable` | actionable | 1회성(latch는 발화 성공, onDropped) |
| 억제 해제 복구 `droppedWhileSuppressed` | 버린 마지막 문장 | 그 문장의 분류 | 분류를 함께 보관한다 |
| `announceExternal`(prewalk) | 시작 `prewalkStart`·불가 `prewalkUnavailable`·사용자 취소 `prewalkCancelled`(+정지) | actionable | 직접 응답·전이 |
| prewalk `.ended`(도보 실패 문장에 붙음) | `{beacon.denied·beacon.reduced·beacon.weak}, prewalkCancelled` | actionable | prewalk엔 안전망이 돌지 않아(`maybeEndIdleSession`의 `prewalkTarget == nil` 가드) 이 경로는 권한·정밀 위치·위치 서비스 상실(`stopAndFail`)뿐이다(다른 시작 진입은 세션 중 거절된다). "기다리는 대중교통 안내가 오지 않는다"는 전이 사실(설계 리뷰 M7). ⚠ **대중교통 창구로 내지 않는다**(횡단 리뷰 F3): 대중교통 재생기는 세션을 시작한 적이 없어 가청이 거짓이라 채널이 `.drop`이고, 대중교통 복귀 상환은 추적 가드 뒤라 어디서도 전달되지 않았다. 도보 `stopAndFail`이 사유 문장에 붙여 **한 문장**으로 도보 창구에 내고 `statusText`도 그 결합 문장이다(도보 재생기가 원복 다리 동안 `.playback`을 쥔다. 버려지면 도보 복귀 상환이 추적 가드 앞에서 `statusText` 꼬리로 갚는다). 코디네이터 `.ended`는 문장을 내지 않는다. **§1 불변 선언의 예외**(코드상): 전경에도 적용된다(종전엔 도보 실패 문장 뒤 다음 턴에 대중교통 문장이 나가 뒤가 앞을 잘랐다. 두 통지 연속 결함의 수정이다). 정식판은 대중교통 안내가 봉인이라 승차 전 도보에 도달하지 않는다 |
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
| 안전망 종료 | `guide.endedIdle` | actionable(위원장 판정: 나들이만 예외, 백그라운드에서도 종료음 + 문장) |
| 소리 무음 경고 | `ios.beacon.soundUnavailable`·`soundBackgroundUnavailable` | actionable |
| 위치 신호 약함 | `beacon.weak` | 전경 VoiceOver 창구 전용(종전 그대로, 술어 밖) |
| 거절 `refuse` | `beacon.*`·`guide.alreadyActive` | actionable(직접 응답) |

**나들이 복귀 상환(신설, 최소)**: 종료 문장(안전망·권한 상실)을 전하지 못하면(토글 끔·승격 실패로 백그라운드 버림, 대기 칸에서 사라짐) 종료 사유 장부 `owedEndReason`에 남기고, 복귀 때 30분(`isEndScreenStale`) 안이면 그 문장 하나를 낸다. 종료 화면이 아니라 장부에 거는 이유: 출발점 미확정 ∧ 의미 없는 걸음이면 종료 화면이 없는데 그 종료도 알려야 한다(설계 리뷰 M6). 새 세션 시작이 장부를 지운다. 추적 중 복귀에는 아무것도 갚지 않는다: 나들이의 1회성 문장(지나침·횡단보도)은 자리에 묶여 있어 나중에 갚으면 거짓이다(임박 명령과 같은 이유).

## 4. 전달 계약

### 4.1 톤 뒤 발화와 창구 (변경 최소)

모든 문장은 종전처럼 `DeferredAnnouncer`(톤 뒤 발화 `speechDeferStep`, 단일 슬롯 latest-wins, 세대)를 지나 모델의 `post`에서 채널이 갈린다. 새 직접 게시 경로는 만들지 않는다. 바뀌는 것은 `DeferredAnnouncer`가 분류와 `onDropped`를 `post`까지 나르는 것 하나다.

- `announce(_:highPriority:speechClass:onDropped:)`: `speechClass`는 필수.
- `announceNow(_:highPriority:bypassSuppression:)`: 분류는 `actionable` 고정(§3.1).
- `post: (text, highPriority, bypassSuppression, speechClass, onLateDrop) -> Bool`. `false`면 종전처럼 `DeferredAnnouncer`가 그 자리에서 `onDropped`를 부른다. `true`로 받아 기기 음성 대기 칸에 넣은 문장이 나중에 버려지면 `post` 쪽이 `onLateDrop`을 **한 번** 부른다(계약: `true`를 돌려줄 때만 보관하고, 버릴 때만 부른다).

### 4.2 기기 음성 대기 칸 (Kit `DeviceSpeechQueue`, 세 모델 공유)

나들이 `speakDevice`를 Kit 타입으로 올린다(`DeferredAnnouncer`와 같은 이유: 수명 계약이 위험 부위이고 앱 타깃엔 테스트 레인이 없다). 모델마다 인스턴스 하나, 타입 하나(복붙 금지). 나들이 spec §7.3의 "대기 한 칸, 선점 금지"를 뼈대로 하고 설계 리뷰로 다섯 곳을 고쳤다.

1. **안내 발화가 없으면 즉시 말한다.** 그 순간 칸에 옛 문장이 있으면 먼저 교체로 버린다(순서 역전 금지, m3).
2. **`.high`와 `urgent`는 기다리지 않고 선점한다**: 칸을 비우고 말하는 중인 안내를 끊고 즉시 말한다. VoiceOver의 `.high`가 끼어드는 것과 같은 뜻이다(도착·재조회 요약이 칸에서 최신 명령을 막던 결함, M2. 임박 명령이 전문 뒤에 줄 서던 결함, 접근성 MAJOR 2). 끊긴 것이 이 칸의 발화면 그 문장에 `superseded`를 통지한다(몇 음절만 들린 1회성 경고의 장부를 되살린다).
3. 그 밖은 **한 칸에 기다린다**(latest-wins). 칸의 문장이 **보호 문장**(나들이 시작·횡단보도, `protectedText`)이면 보호 문장이 아닌 새 문장은 들이지 않는다(위치에 묶인 안전 문장이라서다. 도보·자동차·대중교통에는 보호 문장이 없다).
4. **대기는 안내 발화만 기다린다**(`TtsPlayer.isSpeakingGuidance`). 채팅 듣기가 읽는 중이면 기다리지 않고 끊는다. 운전자 채널과 같은 우선순위(M3, 설계 판단: 걷는 중의 안내가 채팅 답변보다 앞선다).
5. 0.3초 간격으로 확인해 말이 끝나면, 톤이 울리는 중이면 그 뒤까지 기다리고(`speechDeferStep`, 상한 3초, 톤 뒤 발화 계약, m10) 꺼낸다. 꺼내는 순간 억제 중이면(사용자 활성화의 직접 응답은 면제, m2) 버리고, 보호 문장이 아닌데 6초를 넘게 기다렸으면 버리고, 그 밖은 **채널을 다시 고른다**(술어를 그 시점 상태로).
6. **버림 통지는 문장마다 최대 한 번, 주체는 대기 칸이고 이유를 싣는다**(m1·M1): 교체·즉시 발화·선점으로 더 새 문장이 이었으면 `superseded`, 아무것도 잇지 않고 사라졌으면(유효 시간·억제·채널 소실·보호 문장에 막힘) `undelivered`.
7. 세션 경계(`advanceGeneration`과 같은 자리)의 `reset()`은 칸을 **버림 통지 없이** 비운다(`DeferredAnnouncer.advanceGeneration`과 같은 이유: `stop()`이 장부를 먼저 비운 뒤라 복원이 끝난 세션의 경고를 되살린다).
8. **전경 복귀는 인계(`handOver()`)다**(M5): 채널이 VoiceOver로 바뀐 문장을 **게시하지 않고 목록으로 돌려준다**(옛 것 → 새 것). 지금 말하는 문장은 **이 칸이 낸 발화일 때만**(발화 토큰: `TtsPlayer.speakGuidance`의 반환 ↔ `isSpeakingGuidance(token:)`. 칸 셋이 합성기 하나를 나눠 쓰므로 "누군가 말하는 중"으로 가르면 다른 모델의 발화를 끊고 낡은 문장을 되살린다, 구현 리뷰 M-1) 끊고 처음부터 넘긴다. 칸의 문장은 억제·유효 시간 검사를 지난 것만 넘긴다. 채널이 그대로 기기 음성이면(VoiceOver 꺼진 나들이) 끊지도 다시 내지도 않는다. 모델은 받은 목록과 복귀 상환 문장(인계와 같은 문장은 뺀다)을 **`.high` 한 통지**로 낸다: 통지 둘을 잇달아 내면 뒤의 것이 앞의 것을 자르고, 앱 활성화 순간의 기본 우선순위 통지는 VoiceOver 화면 낭독에 잠식된다(구현 리뷰 M-2·M-3). VoiceOver가 꺼진 전경이면(도보·대중교통은 채널이 VoiceOver 게시라 듣는 사람이 없다) 끊지 않고 넘기지도 않는다(검증 리뷰 N3). ⚠ "한 통지"는 **모델 단위**다: 복귀 때 세 모델이 차례로 불리므로 모델이 바뀐 직후(승차 전 도보 도착 → 대중교통 시작)에는 모델마다 한 통지씩 나가고 뒤의 것(더 새 세션의 문장)이 앞의 것을 자를 수 있다. 들리는 것이 더 새 상태라 받아들이고 실승차 관찰 항목으로 둔다(검증 리뷰 N1). 인계한 문장은 버림이 아니다. 도보는 상환 블록에서, 대중교통은 추적 가드 앞에서 받고(백그라운드에서 끝난 세션의 완료 문장, m4) 유휴 재개 복귀는 재개 문장 앞에 싣고, 합칠 자리를 지나지 않는 경로는 함수 끝에서 따로 내며, 나들이는 종료 사유 장부와 합친다. 인계와 상환의 중복 제거는 낭독 정정(`spokenUnits`) 뒤 문자열끼리 비교한다(검증 리뷰 N2). 드레인이 인계보다 먼저 깨어 VoiceOver로 게시하는 짧은 창은 `.high`로 낸다(N5). **인계받은 문장이 합본 통지째 억제로 버려지면**(복귀 순간 받아쓰기 시트가 열려 있음) 인계는 버림이 된다: `handOver()`는 문장 목록과 함께 되돌림 손잡이(`DeviceSpeechHandover.undelivered()`, 문장마다 최대 한 번)를 주고, 도보·나들이는 합본 통지의 `onDropped`에서 부른다(각 문장의 버림 통지가 `undelivered`로 불려 장부·상환 표식이 다시 선다, 횡단 리뷰 F6). 나들이는 합본에 실은 종료 사유 장부도 원래 종료 시각으로 되돌린다. 대중교통은 부르지 않는다: 억제 버림은 `droppedWhileSuppressed`가 해제 때 합본째 다시 내므로 장부까지 되살리면 두 번 말한다(이 근거는 억제 중 다른 게시가 그 단일 슬롯을 덮지 않는 한 참이다. 받아쓰기 중 폴이 상태 문장을 내면 합본이 밀린다. 실험판·복귀 순간 받아쓰기·그 사이 폴 전이가 겹칠 때라 수용, 설계 리뷰 m8). 선점(톤 뒤 대기 중 새 통지)으로 버려진 합본도 `onDropped`라 되돌림이 `undelivered`를 부르고 다음 복귀에 현재 상태 한 문장을 한 번 더 갚을 수 있다(수용, m7).
9. **칸 밖의 정지가 칸의 발화를 끊으면 `undelivered`다**(횡단 리뷰 F4): 받아쓰기 시작·채팅 화면 이탈·채팅 듣기 시작의 `TtsPlayer.stop()`, 오디오 인터럽션 시작(⑩), **다른 칸의 발화**(`speakGuidance`가 합성기에 남은 남의 안내를 끊을 때, 코드 품질 리뷰 m1)는 끊긴 안내 발화 토큰을 관찰자(`observeGuidanceInterruption`으로 등록)에게 이유와 함께 알리고, 그 토큰이 이 칸이 마지막으로 낸 발화면 칸이 그 문장에 버림을 통지한다. 이유: 받아쓰기·채팅·인터럽션은 `undelivered`(아무것도 잇지 않았다), 더 새 안내 발화(다른 칸, 또는 드레인이 꺼낸 이 칸의 다음 문장)는 `superseded`다(증분 확인 리뷰 m1: 현실 경로는 끝난 세션의 종료 문장을 다음 세션이 끊는 경우라, `undelivered`면 끝난 세션에 복귀 상환 표식이 서서 맥락 밖에서 다시 나온다). 알리지 않는 정지는 인계의 `stopGuidance` 하나다(넘긴 목록이 처리한다). 칸 자신의 선점은 `speakGuidance` 전에 `lastSpoken`을 비우고 `superseded`를 내므로 관찰자에서 짝이 없다(이중 통지 없음). 칸에서 기다리던 문장은 종전대로 꺼내는 순간의 억제 검사가 버린다. 실효 범위: 칸이 **전경**에서 말하는 자리는 나들이(VoiceOver 꺼짐)뿐이고 나들이의 장부는 종료 사유(`owedEndReason`, 다음 백그라운드 경유 복귀에 갚는다) 하나라, 받아쓰기·채팅 경로의 실효는 나들이 종료 문장이다. 인터럽션·다른 칸 경로는 백그라운드에서도 걸린다. 자동차 운전자 채널은 칸을 지나지 않아 끊긴 쪽으로는 범위 밖이다(자동차 봉인 해제 판정 때 본다).
10. **인터럽션으로 멈춘 발화는 끊고 갚는다**(횡단 리뷰 F5, 접근성 감사 M2·코드 품질 리뷰 M1): `TtsPlayer`는 `AVAudioSession.interruptionNotification`의 시작(전화 등)에서 합성기에 안내 발화가 남아 있으면 `stop()`으로 끊고 ⑨처럼 알린다(앱이 중단됐다 돌아올 때 늦게 오는 `.began`, `wasSuspended`는 무시. 실험판 계측 `ttsInterruption began inSynth= paused= suspended=`로 "그 순간 발화가 합성기에 남아 있다"는 전제를 가른다, 증분 확인 리뷰 m2). 칸이 `undelivered`로 장부·상환 표식을 되살린다(들리지 않은 문장을 "전달됨"으로 세지 않는다. 인터럽션 뒤 합성기가 이어 재생해 지난 모퉁이의 명령이 뒤늦게 들리는 일도 없다). 방어로 두 술어를 가른다: 칸을 **막는가**(`isSpeakingGuidance` = 합성기에 남음 ∧ `¬isPaused`. 일시정지로 굳은 발화가 선점 문장까지 칸을 막고 세션 종료 원복을 발화 대기 상한까지 붙들던 결함)와 **그 문장이 아직 합성기에 있는가**(`isSpeakingGuidance(token:)`·끊을 때 알릴 토큰·`stopGuidance` 가드 = 일시정지 포함). 뒤쪽까지 일시정지를 빼면 일시정지된 이 칸의 1회성 경고가 선점·인계·외부 정지 어디서도 버림 통지를 받지 못한다. 칸의 즉시 발화 분기는 끊길 자기 문장을 "말하는 중"이 아니라 토큰으로 가른다. 시간 상한(연속 12초)은 기각했다(설계 리뷰 MAJOR 3): 열화 문장이 붙은 시작 요약·인계 합본 같은 정상 긴 발화를 확정적으로 끊고, 그동안 들어온 칸의 문장은 유효 시간을 넘겨 함께 버려진다. 인터럽션 뒤 합성기가 실제로 일시정지로 남는지·인터럽션 알림이 오는지는 실기기 미확인이다(§2 E53 행 ⑨).

"다른 앱의 VoiceOver 낭독과 겹칠 때"(판정 남은 세부): 다른 앱의 VoiceOver 발화는 앱이 관찰할 수 없다. 기본은 위 규칙 그대로(우리 안내 발화가 말하는 중일 때만 대기, 평범한 문장은 선점 금지)이고, 겹침은 실사용 판정 행으로 둔다(BACKLOG §2).

### 4.3 복귀 상환과 1회성 경고

- **토글이 꺼져 있으면 종전 계약 그대로다.** 백그라운드 문장은 전부 `.drop`이라 `missedAnnouncement = true`와 `onDropped`(장부: 계단 경고 `pendingStepFreeNotice`·최종 접근 진입 `pendingFinalApproachIntro`·대중교통 소리 무음 latch)가 그대로 선다.
- **켜져 있으면**: `actionable`은 기기 음성으로 나가고(장부가 서지 않는다. latch는 발화 성공 시점), `deferrable`은 `.drop`으로 종전과 같이 `missedAnnouncement`를 세운다.
- **이미 말한 문장을 복귀 때 또 말하지 않는다**: 기기 음성으로 넘긴 순간 `missedAnnouncement = false`로 내린다. 상환의 뜻은 "마지막 상태를 못 들었다"인데 마지막 상태 문장을 들었으면 갚을 것이 없다(그 뒤 다시 버린 문장이 생기면 다시 선다). 대기 칸에서 나중에 버려지면 `onLateDrop`이 원래의 `onDropped`(장부)를 부르고, 이유가 `undelivered`일 때만 `missedAnnouncement = true`를 세운다. `superseded`는 더 새 문장이 마지막 상태를 전했으므로 세우지 않는다(설계 리뷰 M1: 세우면 들은 최신 문장을 복귀 때 되풀이한다). 장부는 어느 쪽이든 되살린다(계단 경고가 교체로 밀렸으면 복귀 때 갚아야 한다. `DeferredAnnouncer.invalidatePending`과 같은 뜻).
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

- 기기 음성은 안내 세션의 오디오 세션 위에서 난다: 재생기(도보·대중교통·나들이 `BeaconTonePlayer`)가 세션 동안 `.playback` + `.mixWithOthers`로 승격하고, `TtsPlayer.speakGuidance`는 카테고리를 건드리지 않는다(종전 계약: 여기서 `.duckOthers`로 다시 세팅하면 `guideAudioStep` 판정 밖에서 카테고리가 바뀐다). route 변경의 자기 메아리 판정(`guideAudioRouteChangeEvent`)과 소유권 이전(`.ownershipTransferred`)은 카테고리를 바꾸는 소비자가 늘지 않으므로 영향이 없다.
- 승격 실패(`isBackgroundAudible` 거짓)면 백그라운드에서 톤과 함께 기기 음성도 들리지 않는다. 그래서 술어가 그 세션의 백그라운드 문장을 버림으로 판정하고(§2 가청) 종전 상환 계약이 그대로 돈다. 기존 "화면이 꺼지거나 다른 앱을 쓰는 동안에는 안내 소리가 나지 않습니다" 경고가 그 조건을 알린다(소리 = 톤과 음성).
- **소리를 낸 직후 말할 때**: 문장은 `speechDeferStep`이 톤 끝까지 미룬다(두 채널 공통의 앞단, 종전). 기기 음성 도중 새 톤이 울리면 섞여 난다(같은 앱의 두 재생기, `.mixWithOthers`). 톤이 문장을 끊지 않는다.
- **말한 직후 세션을 끝낼 때**: 원복을 시계가 아니라 **발화 종료에 결박한다**(설계 리뷰 M4: 글자 수 어림은 앞 문장이 길면 모자라 백그라운드 도착 문장 끝을 `.ambient` 아래에서 잘랐다). `endSession(holdSeconds:speechBusy:)`: 톤 잔여 + 0.15 + 다리(`holdSeconds`)를 기다린 뒤, `speechBusy`(안내 발화 중 ∨ 대기 칸에 문장, `GuideSpeechOutput.speechBusy`)가 참인 동안 0.3초 간격으로 더 기다린다(상한 `deviceSpeechEndWaitMaxSeconds` 20초). 다리는 종료 문장이 톤 뒤 발화 간격(0.15초)을 지나 말하기 시작할 때까지 원복을 붙드는 `deviceSpeechEndBridgeSeconds` 1초다: 나들이는 늘(전경 VoiceOver 꺼짐도 기기 음성), 도보·대중교통은 `stop()` 시점에 백그라운드 ∧ 토글 켬일 때만(그 밖 0초), 운전자 채널도 같은 다리(종전 4초 어림을 대체, 발화 대기가 문장 끝까지 잇는다). `speechBusy`는 `speechBusy`가 기본값 없는 인자라 새 호출부가 빠뜨릴 수 없다. 정식판에는 안내 기기 음성이 없어 늘 거짓이라 종전과 같다(채팅 듣기는 세지 않는다). `beginSession()`은 미뤄 둔 원복을 취소하고, 다른 재생기가 그 사이 시작했으면 원복 의무는 이전된다(종전).

## 8. 그 밖의 변경

- **도보 전경 복귀의 `liveTopText` 폴백(car-road 인계)**: 넣지 않는다. 도보 상환이 빈 `statusText`를 만나는 경로는 "실행 안내를 전하지 못했다"다. 토글이 켜진 실험판에서는 대부분 기기 음성으로 나가지만 남는 경로가 있다(승격 실패로 버림, 대기 칸의 유효 시간 초과·억제, spec 준수 리뷰 m-5). 폴백은 정식판 도보 동작을 바꾸므로 이번 마일스톤에서 넣지 않고, 졸업 판정 때 함께 볼 후보로 남긴다.
- `BeaconModel.alternativePreviewAvailable` 주석: "두 줄 사이의 전환이라 `alternateLine`이 곧 반대편" → 조회 화면의 다른 줄 중 계단 회피 우선(`WalkLineKind.switchAlternate`, E52).

## 9. 검증

- Kit: 채널 술어 전수(2^4 × 분류 3)·정식판 등가성, 분류 함수 전수(모든 이벤트 케이스), `BackgroundSpeech.isEnabled`, 원복 다리 ≥ 발화 시작 간격, `DeviceSpeechQueue` 수명(즉시·대기·교체=superseded·`.high` 선점·즉시 발화 전 칸 비우기·보호 문장·TTL·억제와 우회·톤 뒤 대기·재선택·reset·인계 순서·끝난 발화 불인계·인계 되돌림·외부 정지), `DeferredAnnouncer`의 분류·onLateDrop 전달.
- 소스 가드(웹 레인 `background-speech-guard.test.ts`): 기기 음성 호출(`speakGuidance`)은 공유 출력 한 곳과 운전자 채널 한 곳뿐 · 토글 실효값은 한 함수 · 설정 행은 실험 플래그 조건 안 · 플래그는 `#if EXPERIMENTAL`에서만 참 · 세 모델의 `post`는 가청 인자와 함께 술어를 지난다 · `speechClass`에 기본값 없음 · 운전자 분기는 술어보다 앞 · 복귀 인계 자리 · 세 모델의 종료 원복이 발화 대기를 넘긴다 · 세션 경계마다 칸 reset. 기존 가드(`outing-guard`·`transit-background-guards`)는 새 구조로 옮긴다. 후속(2026-09-30): prewalk 실패의 캡처·결합 문장(`statusText` 포함)·종료 화면 없을 때 `.high`·코디네이터 `.ended` 무발화 · `TtsPlayer`의 알리는 정지(`stop`·`speakGuidance`)와 알리지 않는 정지(`stopGuidance`)·두 술어·인터럽션 시작 처리 · 관찰자 등록 · 도보·나들이 합본의 되돌림(클로저 본문 안)·대중교통 `.texts`만 · 도보 복귀 상환 `.high`.
- 빌드: 앱 Experimental·Release 두 구성.
- 실사용(BACKLOG §2 E53 행): 잠금 중 기기 음성이 실제로 들리는가(그 뒤 톤이 계속 들리는가) · 다른 앱 VoiceOver 낭독과 겹침 · 문장 빈도(도보 실보행·자동차 실주행·대중교통 실승차·나들이 실보행) · 배터리.

## 10. 안드로이드

이식 판정 별도. PORTS에 등록할 문장은 완료 보고에 적는다(웹은 잠금 중 실행이 멈춰 대상 아님). 미러 등록부: `GuideSpeechChannel.swift`(guide)·`DeviceSpeechQueue.swift`(core) `pending`, `DeferredAnnouncer.swift` 항목에 Swift 서명 변경(분류·`onLateDrop`)을 적는다.

## 11. 분배

- `docs/INTEGRATIONS.md` §오디오 세션의 백그라운드 항목(톤은 남기고 음성만 막는다), §대중교통 백그라운드 폴의 음성 항목(`post` 전경 게이트), §나들이(E51)의 "백그라운드 기기 음성은 명시 예외" 문장을 이 설계로 고치고, 백그라운드 음성 안내 절을 새로 둔다.
- `CLAUDE.md`는 이 세션이 고치지 않는다(계획 §1 판정 1): 나들이 항목의 "⚠ 백그라운드 기기 음성은 '소리만' 원칙의 명시 예외이고 전경 VoiceOver면 VoiceOver 창구 한 채널이다" 교체 문장과 새 규칙 한 줄을 완료 보고에 적는다.
- `docs/BACKLOG.md` E53 종결 표기 + §2 판정 행(도보 실보행·자동차 실주행·대중교통 실승차·나들이 실보행: 잠금 중 기기 음성 가청, 다른 앱 VoiceOver와 겹침, 문장 빈도, 배터리), `docs/FIELD-TEST.md` 시간 축 행, `CHANGELOG.md`, `PROGRESS.md` 한 줄.

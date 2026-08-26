# 임박 큐 3단계 + 잊힌 세션 안전망 설계 (2026-08-26)

위원장 실사용 피드백(카카오톡 260826, iOS 앱 며칠 실사용) 2건의 설계 정본.

**설계 리뷰 판정**: codex 적대적 리뷰 생략. 두 축 모두 검증된 기존 계약(임박 6a 블록·도착 추정 워치독 배선)의 재조합이고 국소·가역이며, 공유 fixture(웹↔Kit)와 구현 리뷰가 잔여 리스크를 덮는다. 실보행 판정은 §4로 남긴다.

## 1. 임박 큐 3단계 (피드백 ②)

**요청**: "좌회전·우회전·횡단보도 등 행동 지점 10m 전에 주는 사운드를 5m 전과 0m 지점에서도, 같은 소리로 세 번."

**판정**: 현행 임계 20m는 `10 + PROJECTION_LAG_M`(실위치 여유 10m + 투영 지연 10m) 유도식이다(spec `2026-08-09-walk-imminent-cue-design.md` §3 재정의). 따라서 요청의 5m·0m도 같은 식으로 **투영 좌표 15m·10m**다(`IMMINENT_REPEAT_M = [5+lag, 0+lag]`). 이 선택이 곧 "0m 단계와 지난 경계 폐기 하한(`endD < d`)의 충돌"을 없앤다 — 0m 단계도 투영 좌표에서는 경계 10m 앞이라 경계를 넘긴 fix는 종전대로 폐기된다.

**계약**:
- 단계 목록 `[imminentAheadMeters(state), ...tuning.imminentRepeatM]`(walk 20·15·10, car·carDriver는 첫 단계뿐 — `imminentRepeatM: []`로 종전 동작 byte-identical). 상태 `imminentStage`가 다음 단계 index를 들고, 경계를 넘기거나(래치 전진) 마지막 단계를 내면 0.
- **fix당 이벤트 1개**: 한 fix에 두 단계가 함께 걸리면 안쪽 하나만 내고 건너뛴 단계는 소급하지 않는다(8초 간격 fixture에서 20→4m 한 걸음이면 10m 단계 하나).
- 행동 없는 경계는 단계를 세지 않고 곧바로 래치를 넘긴다(종전과 같음).
- **소리·햅틱은 세 단계 모두, 문장은 첫 단계만.** 요청문이 "같은 사운드"를 말했고, 문장을 셋 다 내면 5m 간격(1.2m/s에서 4초)에 톤 뒤 발화 지연(0.83초)을 얹은 문장 셋이 겹친다. 소비자(iOS `BeaconModel` `.imminent(_, _, stage)`, 웹 `useRouteGuide` `eventText`)는 `stage > 0`이면 문장을 내지 않는다. 톤은 `out.tone`으로 이미 흐르므로 소비자 변경은 그 한 줄이다.
- 반복 단계는 `lastAnnouncedAt`을 갱신하지 않는다(소리뿐이라 주기·재통독 리듬은 문장 기준). 갱신하면 기존 "묶음 통독은 선행·재통독은 주기" 시나리오의 재통독이 8초 밀린다(fixture가 잡았다).
- 조합 불변식(웹·Kit 양쪽 테스트): 단계는 강한 내림차순, 마지막은 `PROJECTION_LAG_M` 이상, `imminentAheadM === null`이면 `imminentRepeatM`은 빈 배열.

**하단 2행·톤 계층 불변**: `turnApproachMeters`(표시 "잠시 후" 전환 10m)는 첫 단계에서만 유도되므로 표시 좌표계에 15·10이 새지 않는다. `QUIET_AFTER_ACTION_S`(3초) 정숙 창이 단계마다 다시 열려 추세음이 6초 더 억제되는 것은 수용(임박 구간의 추세음은 잡음이다).

**닫힌 판정**: 2026-08-09 spec §4-1 "신호 대기 중 횡단보도 앞에 서 있으면 한 번 울리고 마는데 맞는가"는 이 변경으로 닫힌다 — 서 있는 동안은 잔여가 줄지 않아 다음 단계가 안 나가고, 건너기 시작하면 15·10m 단계가 이어진다.

## 2. 잊힌 세션 안전망 (피드백 ①)

**증상**: 출근 도보 안내를 끄지 않았더니 몇 시간이고 켜져 있었다(정식판).

**진단**: 자동 종료 장치는 도착 추정(`presumedArrivalStep`, spec `2026-08-13`) 하나이고 정식판에 들어 있다(`#if EXPERIMENTAL` 밖). 그러나 그 판정의 1번 조건이 `inFinalApproach`라 **최종 접근 국면에 진입한 세션만** 정리한다. 그 문을 못 지나는 세션이 실재한다: ①목적지 200m 전 GPS 두절 ②이탈 확정 상태로 종점 접근 ③`beginFinalApproach`의 기하 부재·`tooClose` 조기 이탈로 리듀서는 `finalApproach`에 커밋됐는데 `inFinalApproach=false`인 좀비 ④경로 조회 실패 → 간략 강등 세션(확정 도착 경로 자체가 없다) ⑤목적지 150m 밖에서 실내 진입(거리 캡 밖은 설계상 미종료). 앱 유휴 리셋(`IdleReset`)도 활성 세션은 명시 예외라 어떤 앱 수준 청소도 닿지 않는다. 학교는 넓은 부지라 ⑤가 가장 유력하고, 정식판엔 계측 로그가 없어 어느 경로였는지는 사후 판정 불가.

**판정**: 도착 추정의 조건을 느슨하게 하지 않는다(경로 중간 자동 종료 금지가 그 spec의 1선 방어다). 대신 **국면을 보지 않는 별도 축**을 둔다 — Kit `SessionIdle.swift` ↔ 웹 `session-idle.ts`, 공유 fixture `session-idle-scenarios.json`.
- `sessionIdleStep(secondsSinceUsableFix, secondsSinceProgress)`: usable fix 두절 **10분**(`noFix`) 또는 앵커 기준 이동 없음 **20분**(`stationary`). noFix가 앞선다. 도착 추정(180·300초·10m)보다 모든 축이 느슨해야 한다는 관계를 웹·Kit 테스트가 단언한다.
- 진행 앵커 이탈 하한 **25m**(도착 추정 10m와 별도 앵커): 실내 wifi 지터가 10m를 넘어 20분 내내 "이동"으로 읽히면 축이 영영 안 열리는 것(2026-08-13 spec §7 미탐 수용 사례)을 막는다.
- 배선은 `BeaconModel` 워치독 틱(`maybePresumeArrival` 바로 뒤 `maybeEndIdleSession`)뿐이다. noFix는 fix가 안 와서 fix 경로에 걸 수 없고, 워치독은 2초 `Task.sleep` 루프 + `allowsBackgroundLocationUpdates`로 백그라운드에서도 돈다. 기준은 `startedAt`(세션 시작)과 매 usable fix의 `noteSessionProgress`(간략·상세·최종 접근 세 경로 모두).
- **도보 세션 전용**(`sessionKind == .walk`). 자동차 정체 정차는 정상이라 도착 추정과 같은 이유로 제외. 대중교통 세션(`TransitGuideModel`)은 이 축이 없다 — 역 안 대기는 정상 상태라 별도 설계가 필요하다(BACKLOG).
- 종료 모양은 사용자 중지와 같다(`stopLeavingSummary` → `.stopped` 종료 화면 + 걸음 요약). 문구 `guide.endedIdle` "한동안 위치 신호나 이동이 없어 안내를 종료했습니다"(6로케일). 정지 톤은 전경에서만, 통지는 `.high`(도착 추정 동형 — 잠근 채 잊은 휴대전화가 한참 뒤 울리지 않게).
- 웹은 소비자가 없다(브라우저 탭은 백그라운드에서 멈추므로 잊힌 세션이 성립하지 않는다). 미러는 판정 계층 동조 규칙 때문이다.

## 3. 변경 파일

- 리듀서: `src/lib/route-guide.ts` ↔ `ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift`(상수·튜닝 `imminentRepeatM`·상태 `imminentStage`·이벤트 `stage`·6a).
- 안전망: `src/lib/session-idle.ts` ↔ `SessionIdle.swift`, `ios/Gildongmu/Directions/BeaconModel.swift`.
- 소비자: `src/hooks/useRouteGuide.ts`, `BeaconModel.swift`.
- 테스트: `route-guide-scenarios.json`(+4 시나리오, 기존 1건 기대값 갱신) · 하네스 `stage` 축(웹·Kit) · `session-idle.test.ts` ↔ `SessionIdleTests.swift` · 조합 불변식.
- 문구: `messages/*.json` `guide.endedIdle` + xcstrings 재생성.

## 4. 남은 판정 (실보행·실사용)

- 3단계 소리가 실제로 "10m·5m·0m"로 들리는가(투영 지연 가정 10m가 세 단계에서 다 참인가). 어긋나면 값 조정이 아니라 lag 축의 재판정이다(BACKLOG 2026-08-16 ✅ 항목의 축 가르기 규칙).
- 안전망 상수(10분·20분·25m)가 정상 보행(긴 신호 대기·편의점 들르기)을 끊지 않으면서 잊힌 세션을 충분히 빨리 정리하는가. 실험판 로그 `sessionIdleEnd reason=`.

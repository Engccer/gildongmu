# 하차 출구 번호를 승차 중 시트와 말미 도보 안내로 잇기 (가칭 E84) 설계

2026-11-14 · iOS 정식판(봉인 없음, 2.8 제출분) + 웹(가벼운 판) · 안드로이드 범위 밖
앞 설계: `2026-09-02`(E25 출구 번호), `2026-09-11`(E34 말미 도보 인계), A18(안내 경로 origin 선택), E57(안내 시트 착지), E81(정보 띠)

**설계 리뷰 대상이다**(새 판정·상태 계층 + 안전·정확성 크리티컬). 판정: 별도 컨텍스트 리뷰를 거쳤고 그 결과는 §4.1·§4.6에 반영했다(창을 닫는 축은 벽시계가 아니라 fix 증거와 사용자 선언).

## 1. 목표와 성과

지하철에서 내려 「남은 도보 안내 시작」을 누른 사용자가 몇 번 출구로 나갈지를 도보 안내에서 곧바로 듣고, 시트에서 다시 읽을 수 있다. 승차 중에는 내릴 문과 나갈 출구를 미리 읽을 수 있다. 역 안에서 잡힌 부정확한 위치로 만든 회전 안내는 듣지 않는다.

**움직일 성과**
- 인계 뒤 출구 번호를 듣기까지: 지금은 길이 없음 → 시작 톤 직후 첫 통지 한 문장.
- 승차 중 출구·문 위치 확인: 지금은 접힌 경유역 목록을 펼쳐 마지막 행까지 가야 함(출구만) → 국면 버튼 다음 스와이프 1회.
- 역 안 fix로 만든 경로의 시작 통지(첫 회전 안내 포함) 횟수: 로그 `exitHoldRelease reason=accepted`인 세션에서 0.

확인은 실기기 VoiceOver 실승차(§8)와 계측 로그.

**비목표**: 환승 도보(E73), 승차 전 도보(A25), 여정(E70)의 대중교통 뒤 단계, 자동차 인계, 잘못 내림 복구의 「걸어가기」, 안드로이드, 웹의 출구 대기(§6), 서버 응답 변경(출구 좌표 싣기 등).

## 2. 위원장 판정 (2026-11-14, 재논의 금지)

| # | 판정 | 내용 |
|---|---|---|
| P1 | 승차 중 시트에 하차 준비 한 줄 | 문장은 길찾기 결과 하차 줄과 같은 함수·같은 문장(`alightLineText`). 문 위치만 있으면 그것만, 출구만 있으면 「정자역 하차, 5번 출구 방면」, 둘 다 없으면 줄 없음(부재 문구 금지). 통지 없음. 자리는 본 Section의 마지막 줄(주변 섹션 제목 바로 위). 읽기 순서: 상태 문장 → 경유역 → 국면 버튼 → 하차 준비 줄 → 주변 섹션 제목 |
| P2 | 도보 안내 시작 통지가 출구부터 말한다 | ko 확정 문안 「5번 출구로 나가세요.」. 뒤에 기존 시작 통지가 이어진다 |
| P3 | 도보 시트의 지금 할 행동 줄에 「5번 출구로 나가기」 | 역 밖으로 나와 위치가 제대로 잡히고 경로를 따라가기 시작하면 평소 안내 문장으로 바뀐다. 그동안은 역 안의 부정확한 위치로 만든 회전 안내를 말하지 않는다. 출구 번호가 없으면 지금과 완전히 같다 |

## 3. 조사로 확인한 현재 구조 (설계의 전제)

| 사실 | 자리 |
|---|---|
| 도보 세션은 시작 뒤 `awaitingRoute` 창에서 경로 조회를 미룬다. 이 창의 fix는 리듀서·톤·주기 통지 어디에도 닿지 않고 `routeOriginStep`(수용: 정확도 30m 이하 ∧ 나이 10초 이하)만 지난다. 15초(`noFixTimeout`) 안에 수용 fix가 없으면 100m 이하 최선값으로 조회하고, 그것도 없으면 `guide.detailNoLocation` 간략 강등이다 | `BeaconModel.handle(fix:)` · `startFixWaitWatch` · Kit `RouteOrigin.swift` · `LocationFixPolicy` |
| 그래서 지금 지하 역에서 인계하면 15초 뒤 와이파이 fix(대개 30m 초과)로 경로가 서고, 시작 통지 `guide.detailStart`(「{dest}까지 도보 안내 시작. {first}. 안내 {count}개, 총 {distance}.」)의 `{first}`가 역 안 좌표 기준 회전 안내다. fix가 전혀 없으면 15초에 세션 끝까지 직선거리 강등이다 | 같음 |
| 조회 대기 창에는 워치독의 「신호 약함」 음성도 막혀 있다(`noticeStaleIfNeeded`의 `guard !awaitingRoute`). 잊힌 세션 안전망(fix 두절 300초·무이동 300초)과 fix 부재 반복음은 이 창에서도 돈다 | `BeaconModel.tickWatchdog` |
| 조회 대기 중 `mode == .brief`이고 시트는 `beacon.straightLineNote`(「직선거리 기준입니다.」)와 `statusText` 행(비어 있으면 없음)을 그린다. 간략의 상태 문장 행이 「지금 할 행동」 띠다(`band(of:)`가 `.liveTop`·`.status`를 `.action`으로 묶는다). 첫 정보 행 착지는 `awaitingRoute`가 풀릴 때까지(시트 상한 20초) 기다린다 | `BeaconTrackingSheet` 153·189·606·679행 부근 |
| 출구 번호는 서버가 **역 밖으로 나가는 최종 하차**(`alightKind === "final"`)의 지하철 구간에만 싣는다. 환승 구간·버스 구간엔 없다. 여정에서 택시가 대신하는 끝은 서버가 뗀다(`journey/trim.ts`) | `providers/odsay.ts` `exitOf` |
| 말미 도보 인계는 `completeOrAdvance`가 `stop()` 뒤에 세우는 한 턴 수명 값 `TransitWalkHandoff`와, 같은 턴의 `GuideSession.acceptWalkHandoff()`다. 잘못 내림 복구(E78)의 「걸어가기」 버튼은 `advanceIntoWalkHandoff()` 없이 `onWalkHandoff`만 불러 `pendingWalkHandoff`가 nil인 채로 같은 함수에 들어온다(사용자가 계획한 하차역에 있지 않다) | `TransitGuideModel` 853·893~918행, `TransitTrackingSheet` 692행 |
| 여정의 대중교통 완료는 `onJourneyRideCompleted`로 빠져 `TransitWalkHandoff`를 세우지 않는다 | `TransitGuideModel` 898행 |
| 빠른 하차 줄(`quickExitLine`)은 대기 국면 열차 목록 앞에만 있고 출구는 싣지 않는다 | `TransitTrackingSheet` 758·1114행 |
| 웹 도보 시작 조회는 스트림 대기가 아니라 단발 정밀 재취득 `fetchGuideRoute(true)`다(origin 대기 상한·최선값 보관 구조가 없다). 웹 인계는 `doneHandoff`가 `DistanceBeacon autoStart`를 마운트한다 | `useRouteGuide.ts` 2262행, `TransitGuidePanel.tsx` 834행 |

## 4. 설계 결정

### 4.1 핵심: 「출구로 나가기」 상태는 새 상태 기계가 아니라 **시작 조회 대기 창의 연장**이다

| # | 결정 | 근거 |
|---|---|---|
| D1 | 출구 번호를 실은 인계로 시작한 도보 세션은 시작 경로 조회 대기 창을 「출구 대기」로 연다. 종전 15초 시계(`startFixWaitWatch`)를 걸지 않는다. **창을 닫는 축은 벽시계가 아니라 증거(최근 fix)와 사용자 선언(버튼)이다.** 창 안 fix는 Kit 순수 함수 `exitHoldStep` 하나만 지난다: 보관 불가(정확도 100m 초과·낡음) → 대기 / 첫 보관 가능 fix가 하차역에서 600m + 정확도 밖 → 출구 대기를 버림(D22) / 수용(정확도 30m 이하 ∧ 나이 10초 이하, `routeOriginStep`) → 조회 / 창이 240초를 넘겼고 보관 가능 fix가 15초 이상 이어졌다(`exitHoldStorableRunStart`) → 최근 15초의 최선값으로 조회 / 그 밖 → 대기 | 창 안에서는 `handle(fix:)`가 조기 반환하므로 리듀서·톤·주기 통지가 fix를 보지 못한다. 역 안 좌표로 만든 회전 안내가 나갈 자리가 구조적으로 없다 |
| D2 | 창이 풀리면(수용 fix) 종전 경로 조회 → 종전 시작 통지 `guide.detailStart`가 그대로 나간다. 그때의 `{first}`는 정확한 위치에서 만든 첫 안내다 | P3의 「위치가 제대로 잡히고 경로를 따라가기 시작하면 평소 안내 문장」. 시작 통지·시트 행·톤·착지가 전부 기존 커밋 경로라 출구 대기 뒤의 동작이 지금과 같다 |
| D3 | 창이 닫히는 길은 넷이다. ① 수용 fix(역 밖으로 나온 것으로 본다). ② 「출구로 나왔어요」 버튼(D23). ③ 상한 240초(잠정): **보관 가능한 fix가 15초 이상 이어지는데도 수용이 안 될 때만** 걸리고, 후보는 최근 15초 창의 최선값이다(창 전체의 최선값은 몇 분 전 승강장 좌표일 수 있다). fix가 한 건도 없으면 상한에서 강등하지 않고 계속 기다리며, 240초 넘게 걸어 나온 사람의 첫 보관 가능 fix로도 조회하지 않는다(15초 넘게 끊기면 연속 구간을 새로 센다). ④ 목적지 전환·경유지 변경·재획득·세션 종료 | 깊은 역사를 걸어 나오는 시간은 시계로 잴 수 없다. fix가 없는 것은 「아직 지하」의 증거다 |
| D4 | 창 동안 잊힌 세션 안전망의 fix 두절 임계는 `GuideTuning.sessionIdleNoFixExitHoldSeconds`(900초, 잠정, 기본값 없는 필드)이고 창이 닫히면 원래 값(도보 300초)으로 돌아간다. 무이동 축(300초)은 그대로 두되 창 동안은 **관측이 끊긴 동안 세지 않고**(마지막 fix 뒤 30초 초과), **관측 공백(30초 초과) 뒤 fix가 진행 앵커에서 벗어났을 때만(세션 첫 fix이거나 25m 이상) 무이동 시계와 진행 앵커를 다시 세운다.** 같은 자리 fix로는 세우지 않는다(30초 넘는 간격으로 드문드문 오는 제자리 fix마다 시계가 서면 세션이 끝나지 않는다). 창이 닫히는 순간에는 두절·무이동 두 시계가 그 시각부터 새로 흐른다(`ExitHoldIdleFloors`). 판정 조립은 Kit `exitHoldAwareSessionIdleStep` 한 자리이고 출구 인계가 없는 세션은 종전 식과 값이 같다 | 수단 차이는 `GuideTuning` 데이터로 싣는다(`sessionKind` 분기 금지). 무이동은 fix가 와야 관측되므로, fix가 0건이면 진행 기록도 없어 무이동 축이 300초에 세션을 끝내 900초가 무력해진다. 끊긴 시간은 두절 축이 따로 센다. 세션 첫 fix는 진행으로 치지 않아(앵커만 세운다) 긴 두절 뒤 첫 fix 직후 무이동 300초가, 창이 닫힌 직후에는 되돌아온 두절 300초가 곧바로 성립하므로 시계의 하한이 필요하다(공유 fixture `idleScenarios` 재현 ①②③) |
| D5 | 출구 대기 상태(`exitHold`: 출구 번호·하차역 좌표·연 시각)는 모델 한 자리가 들고, 닫는 자리는 `closeExitHold` 하나다. 종전 대기 시계를 거는 `startFixWaitWatch`가 그 함수를 먼저 부르므로 목적지 전환·경유지·재획득은 호출 전수가 구조로 닫는다. **창이 닫히는 첫 순간 저장된 시작 요청의 `exitLead`도 nil로 내린다**(`syncStartRequestWithSession`이 열려 있는 창의 값만 승계). 시작 실패(권한·정밀 위치)로 창이 풀리기 전에 끝난 세션의 재시작만 창을 다시 연다 | 한 번 역 밖에서 안내를 받은 세션을 다시 시작했는데 「5번 출구로 나가세요」가 다시 나오면 거짓이다 |
| D6 | 계측(숫자만, 좌표 없음): 시작 `exitHold start exit=… station=0\|1`, 닫힘 `exitHoldRelease reason=accepted\|recentBest\|declared\|otherStation\|superseded elapsed=… acc=…`, 창 안 fix마다 `routeOriginWait acc= age= speed= speedAcc= holdT= station=`(역까지 거리 m) | 잠정 상수 넷(240초·15초·600m·4초)과 「지하 fix의 정확도·속도 분포」가 실승차 판정 재료다 |

### 4.2 창 동안 무엇이 침묵하고 무엇이 그대로인가

| 대상 | 창 동안 | 근거 |
|---|---|---|
| 회전·결정 지점·임박·주기 통지, 이탈·재조회, 횡단보도 경고, 최종 접근·도착 판정, 추세 톤 | 없음 | 경로가 아직 없다(리듀서가 돌지 않는다). 막는 코드를 새로 쓰지 않는다 |
| 「신호 약함」 음성 | 없음(종전 조회 대기 창과 같음) | `noticeStaleIfNeeded`의 기존 가드 |
| fix 부재 반복음(워치독 톤) | 그대로 | 새 억제를 더하지 않는다. 체감은 실승차 관찰(§8 ⑧, 열린 판정 5) |
| 잊힌 세션 안전망 | 돈다. 창 동안 fix 두절 임계만 900초, 무이동은 fix가 끊긴 시간을 빼고 센다 | D4 |
| 시작 톤, 소리 강등 고지, 권한·정밀 위치 실패 | 그대로 | 시작 경로 그대로 |
| 정보 띠(E81) | 남은 거리 띠·다음 예고 띠 없음, 지금 할 행동 띠 하나(D8) | 줄을 더하지 않는다. 띠 몫 계산은 기존 `bandExists` 그대로 |

### 4.3 통지와 시트 (도보)

| # | 결정 | 근거 |
|---|---|---|
| D7 | 세션 시작 직후(시작 톤 뒤, `announce` 창구, `speechClass: .actionable`, 기본 우선순위) 단독 통지 「5번 출구로 나가세요.」(`guide.exitLeadStart`)를 낸다. 소리 강등 고지가 함께 있으면 **한 통지로 합친다**(지연 슬롯은 하나이고 최신이 이긴다). 그 뒤 fix로 창이 풀려 나가는 첫 시작류 통지(시작 요약 또는 간략 강등 문장)는 Kit `exitLeadPrefixNeeded`가 참이면 출구 문장을 접두로 다시 싣는다: 출구 있음 ∧ (단독 통지가 버려짐 `onDropped` ∨ 게시한 지 4초 미만). 버튼·다른 역 판정·목적지 전환으로 닫힌 창은 접두를 싣지 않는다 | `.high` 시작 통지는 말하는 중인 단독 통지를 끊는다. 판정을 발화 끝 신호(`announcementsSettled`)에 걸지 않는다(짝이 늦으면 흔들린다) |
| D8 | 창 동안 간략 상태 행(`.status`, 지금 할 행동 띠) 자리에 「5번 출구로 나가기」(`ios.guide.exitHoldAction`)를 그린다. 시트가 `statusRowText`로 유도한다(`model.exitHoldLine ?? statusText`). 모델의 `statusText`에는 쓰지 않는다. 행 렌더와 `rowExists(.status)`가 같은 유도 값을 읽는다. 창 동안 `beacon.straightLineNote`는 그리지 않는다 | `statusText`에 쓰면 창이 닫힐 때 지우는 자리를 따로 관리해야 하고 다른 문장과 자리를 다툰다 |
| D9 | 첫 정보 행 착지(`requestInfoLanding`)는 출구 대기 중이면 조회를 기다리지 않고 통지가 끝난 뒤 상태 문장 행에 앉는다(가드를 `model.awaitingRoute && !model.exitHoldActive`로). 창이 풀려 행이 바뀌면 기존 소실 복구·`awaitingRoute` onChange가 그때의 첫 정보 행으로 옮긴다 | 지금 가드대로면 착지가 20초 상한에 걸려 버려진다(창은 몇 분짜리다) |
| D10 | 「출구로 나왔어요」 뒤 15초 안에 쓸 위치가 없으면 종전 `guide.detailNoLocation` 간략 강등이다 | 새 문구를 만들지 않는다 |

### 4.4 출구 번호를 실어 넘기는 경로

| # | 결정 | 근거 |
|---|---|---|
| D11 | `TransitWalkHandoff`에 `exitAlight: String?`·`alightLat`·`alightLng`(기본값 없음)를 더한다. `completeOrAdvance`가 `stop()` **앞에서** 경로의 마지막 구간(`route.legs.last`: `dispatch(.advance)` 뒤 국면이 `done`이라 현재 구간 포인터가 아니라 마지막 구간을 직접 읽는다)의 `exitAlight`와 `alightStop` 좌표를 싣는다 | `stop()`이 경로를 지운다. 확정 도착 통지와 같은 원천이다 |
| D12 | `acceptWalkHandoff()`는 `transit.stop()`·`clearWalkHandoff()` **앞에서** `transit.pendingWalkHandoff`를 읽어 `transitValidExitNo`를 한 번 더 지나게 한 뒤 `StartRequest.exitLead`(`ExitLead`: 출구 번호 + 역 좌표)로 넘긴다. 경로에서 직접 읽지 않는다 | 잘못 내림 복구(E78)의 「걸어가기」는 인계 값 없이 같은 함수에 들어온다. 경로에서 읽으면 계획한 역의 출구를 다른 역에서 말한다 |
| D13 | `BeaconModel.StartRequest`에 `exitLead: ExitLead?`(기본값 없음). 호출부 전부가 값을 적고, nil이 아닌 값을 적는 곳은 `acceptWalkHandoff`와 재시작 동기화(열려 있는 창의 값) 둘이다 | 안전 인자에 기본값 금지. 소스 가드가 센다(§7) |
| D14 | 확정 도착이 아니어도(추정 도착, [이미 탔어요]로 탄 열차, 복구 뒤 새 경로) 인계에는 출구를 싣는다 | 추정 도착 **통지**가 출구를 말하지 않는 이유는 앱이 내릴 역을 추정으로 지목하기 때문이다(설계 리뷰 #14). 인계 버튼은 사용자가 「내렸다」고 선언하는 동작이라 근거가 다르다. 잘못 내렸다면 복구 경로(D12)가 따로 있다 |
| D15 | 적용 범위는 말미 도보 인계 하나다. 환승 도보(E73)·승차 전 도보(A25)·자동차 인계·여정 단계·나들이 귀환은 `exitLead: nil` | 서버가 최종 하차에만 출구를 싣는다. 여정의 출구 도보는 출구가 목적지인 별도 단계라 겹치지 않는다(이 경로로 들어오지 않는다) |

### 4.5 승차 중 하차 준비 줄 (P1)

| # | 결정 | 근거 |
|---|---|---|
| D16 | `TransitTrackingSheet.sheetBody`의 본 Section에서 `phaseControls(proxy:)` 바로 다음에 `alightPrepRow`를 둔다. 문장은 `alightLineText(leg.quickExit, station:, exitAlight: display.exitAlight, lang:, exitBound: { appLocalized("transitGuide.exitBound", $0) })`. 단일 `Text`, 착지 대상 아님, 통지 없음 | P1 그대로. 국면 전환으로 조용히 나타나는 정적 문장이라 착지점(상태 문장) 뒤에 있다 |
| D17 | 서는 국면: `boarding`·`riding`. `waiting`·`arrived`에는 세우지 않는다 | 대기 국면은 열차 목록 앞에 빠른 하차 줄이 이미 있다. 도착 국면은 도착 통지가 출구를 말했고 다음 동작이 인계 버튼이다 |
| D18 | 환승 구간은 「○○역 하차, 빠른 환승 5-3 문」(함수가 그대로 낸다, 출구 없음). 버스 구간은 재료가 없어 줄이 없다. 문 위치도 출구도 없는 지하철 구간도 줄이 없다 | 3-state, 부재 문구 금지 |
| D19 | 역 이름과 언어는 기존 `quickExitLine`과 같은 선택(표시 라벨: en이면 영문, 없으면 한국어 원문 / `lang`은 앱 언어)을 한 헬퍼로 공유한다 | 조인 필드를 문장에 넣지 않는다(E27). 대기 국면 줄과 승차 국면 줄의 역 이름이 갈리지 않는다 |
| D20 | 접힌 경유역 목록 하차 행의 출구 병기(E25)는 그대로 둔다 | 접힌 목록 안이라 펼쳐야 들리고, 그 행은 「어느 역이 하차역인가」의 목록이다. 지우면 E25 계약(출구는 확정 도착·하차역 행)과 웹·가드가 함께 움직인다 |
| D21 | 여정의 대중교통 단계에도 같은 줄이 선다 | 그 경로의 `exit.alight`는 택시가 대신하는 끝이면 서버가 이미 뗐다. 남아 있으면 실제로 그 출구로 나가는 경로다 |

### 4.6 설계 리뷰 반영 (2단계)

| # | 결정 | 근거 |
|---|---|---|
| D22 | 다른 역 판정: 창 안 **첫** 보관 가능 fix가 하차역 좌표에서 600m(잠정) + 그 fix의 정확도보다 멀면 출구 대기를 버리고(출구 문장·줄을 거둔다) 종전 시작 대기로 간다. fix가 없거나 역 좌표가 없으면 판정하지 않는다. Kit `exitHoldStep`의 한 갈래이고 fixture가 잠근다 | 한 정거장 먼저·지나쳐 내린 뒤 인계 버튼을 누른 경우 계획한 역의 출구를 계속 지시하면 안 된다. 첫 fix 한 번만 보는 이유는 창이 길어 걸어 나간 거리가 쌓이기 때문이다 |
| D23 | 수동 해제 버튼 「출구로 나왔어요」(`ios.guide.exitHoldRelease`, 위원장 확정 2026-11-14)를 출구 줄 바로 다음에 둔다. 누르면 창을 닫고 위치를 새로 받아 조회한다(종전 시작 대기: 수용 fix 즉시, 15초 안 최선값, 없으면 D10). 창 안에서 모은 역 안 좌표는 쓰지 않는다. `disabled`를 쓰지 않고 모델 가드로 재진입을 막으며, 응답 통지는 `.high`(「경로를 조회하고 있습니다.」, 기존 키), 누른 뒤 포커스는 `requestInfoLanding` | 위치가 끝내 30m 안으로 들지 않는 출구(고층 사이·고가 밑)에서 사용자가 스스로 풀 길이 필요하다. 풀어서 얻는 좌표는 「지금」의 것이다 |


## 5. 문자열

웹·iOS 공유 키 하나(`messages/*.json` `guide`)와 iOS 전용 키 둘(`ios/i18n/ios-extra/*.json` `ios.guide`). iOS는 변환 파이프라인으로 xcstrings 재생성(`arg-order.json` 등록 2건), 안드로이드 strings도 재생성. ko 세 문장은 위원장 확정(2026-11-14), 나머지 로케일은 기존 `transitGuide.exitBound`의 낱말(Exit·出口·salida·sortie·uscita)을 따른 초안이다.

| 키 | ko | en | ja | es | fr | it |
|---|---|---|---|---|---|---|
| `guide.exitLeadStart` | {exit}번 출구로 나가세요. (확정) | Take Exit {exit}. | {exit}番出口から出てください。 | Salga por la salida {exit}. | Prenez la sortie {exit}. | Prenda l'uscita {exit}. |
| `ios.guide.exitHoldAction` | {exit}번 출구로 나가기 (확정) | Take Exit {exit} | {exit}番出口から出る | Salir por la salida {exit} | Prendre la sortie {exit} | Prendere l'uscita {exit} |
| `ios.guide.exitHoldRelease` | 출구로 나왔어요 (확정) | I've left the station | 出口を出ました | Ya salí de la estación | J'ai quitté la station | Ho lasciato la stazione |

- 접두 결합은 공백 하나(기존 `away`·`notice` 접두와 같은 조립).
- 하차 준비 줄은 새 키가 없다(`route.transit.alightAt`·`quickExit*`·`transitGuide.exitBound` 재사용).
- 낭독 문장의 정본은 문자열 자원이다. 구현·리뷰 때 이 표가 아니라 `messages/ko.json`·`ios-extra/ko.json`을 본다.

## 6. 웹 범위

| 항목 | 이번 판 | 사유 |
|---|---|---|
| 하차 준비 줄 | 한다. `TransitGuidePanel`의 `boarding`·`riding`에서 국면 버튼 묶음 다음에 `<p>` 한 줄(`transit-exit-lines.ts` `alightLineText`, 역 이름·`lang`은 기존 `quickExit`·`quickExitLang`과 같은 선택). live region 없음 | iOS와 같은 문장·같은 자리 |
| 출구 문장 | 한다. `doneHandoff`에 `exitAlight`를 싣고 `DistanceBeacon`·`useRouteGuide`에 선택 인자 `exitLead`로 넘겨 그 마운트의 **첫 시작류 통지**(상세 시작 요약 또는 강등 문장)의 접두로 한 번 싣는다. 단독 통지·상태 행은 없다 | 웹 통지는 live region 한 창구라 몇 초 간격의 두 문장이 서로를 대체한다. 접두 한 자리가 결정론이다 |
| 출구 대기(D1~D10·D22·D23) | 하지 않는다. **웹은 P3를 충족하지 않는다**: 출구 문장 뒤에 역 안 좌표 기준의 첫 안내가 곧바로 이어질 수 있다. BACKLOG §4에 한 줄 | 웹 시작 조회는 단발 정밀 재취득이라 스트림 대기 구조를 새로 세워야 한다. 웹은 화면이 꺼지면 멈춰 역사를 지나는 몇 분을 살아서 건너기 어렵고, 실승차로 판정할 수단이 iOS뿐이다 |

웹 미러 파일은 만들지 않는다(웹에 소비자가 없는 판정 함수는 죽은 코드다). 공유 fixture는 Kit 쪽에 두고, 웹·안드로이드가 출구 대기를 들일 때 그 fixture를 함께 읽는다.

## 7. 구현 자리와 테스트

**구현 자리**

| 파일 | 변경 |
|---|---|
| `ios/GildongmuKit/Sources/GildongmuKit/ExitHold.swift` (새 파일) | 상수 여섯, `exitHoldStep`·`exitHoldRecentBest`·`exitHoldStorable`·`exitHoldStorableRunStart`·`exitLeadPrefixNeeded`, 안전망 `ExitHoldIdleFloors`·`exitHoldIdleFloorsAfterFix`·`exitHoldIdleFloorsAfterClose`·`sessionIdleReference`·`exitHoldAwareSessionIdleStep` |
| `ios/GildongmuKit/Sources/GildongmuKit/RouteGuide.swift` | `GuideTuning.sessionIdleNoFixExitHoldSeconds` |
| `android/kit/mirrors/guide.json` | `ExitHold.swift` `pending` 등록 |
| `ios/Gildongmu/Directions/TransitGuideModel.swift` | `TransitWalkHandoff`의 출구·역 좌표, `completeOrAdvance`의 캡처(D11) |
| `ios/Gildongmu/Directions/GuideSessionCoordinator.swift` | `acceptWalkHandoff`(D12), 나머지 `StartRequest(`에 `exitLead: nil` |
| `ios/Gildongmu/Directions/BeaconModel.swift` | `StartRequest.exitLead`·`ExitLead`, 창 상태와 `openExitHold`·`closeExitHold`·`handleExitHoldFix`·`declareExitedStation`·`withExitLead`, `start()`의 단독 통지와 창 열기, `startFixWaitWatch`의 닫기, 안전망 임계, 계측 |
| `ios/Gildongmu/Directions/DirectionsTabView.swift` | `StartRequest(` 2곳에 `exitLead: nil` |
| `ios/Gildongmu/Directions/BeaconTrackingSheet.swift` | `statusRowText`, 해제 버튼, 직선거리 주석 조건, 착지 가드 |
| `ios/Gildongmu/Directions/TransitTrackingSheet.swift` | `alightPrepRow`와 역 이름 헬퍼 공유(D16~D19) |
| `messages/*.json`, `ios/i18n/ios-extra/*.json`, `arg-order.json`, xcstrings·안드로이드 strings(생성물) | 새 키 셋 |
| `src/hooks/useTransitGuide.ts` · `src/components/TransitGuidePanel.tsx` · `src/components/DistanceBeacon.tsx` · `src/hooks/useRouteGuide.ts` | §6 |

**테스트**

| 종류 | 내용 |
|---|---|
| Kit 단위 + 공유 fixture(`src/lib/__tests__/fixtures/exit-hold-cases.json`) | `ExitHoldTests`: `exitHoldStep` 갈래 전부(보관 불가·낡음·다른 역과 경계·역 좌표 없음·수용 경계·상한 전·상한의 최근 최선값), 최근 창 최선값, 접두 진리표(출구 없음은 언제나 거짓), 무이동 경과, 상수·조율값 |
| 소스 가드(`src/lib/__tests__/exit-carryover-guard.test.ts`) | `exitLead` 기본값 없음·`StartRequest(` 전수 / nil 아닌 곳 둘 / 인계 값 읽기가 `transit.stop()` 앞이고 경로를 직접 읽지 않음 / `startFixWaitWatch`가 창을 닫음 / 닫는 자리가 시작 요청을 내림 / 창이 열리면 15초 시계를 걸지 않음 / 안전망 임계가 `GuideTuning` / 접두가 Kit 술어 / 계측에 좌표 없음 / 도보 시트 행·버튼 순서 / 하차 준비 줄의 자리·국면·무통지 / 웹 배선 |
| 기존 가드 | `guide-sheet-landing-guard`(상태 행 술어를 유도 값으로), `waypoint-dropped-guard`(강등 통지 감싸개), `mirror-registry`, `i18n-messages`, xcstrings·안드로이드 strings 드리프트 |
| 웹 | `TransitGuidePanel` jsdom: 하차 준비 줄의 국면별 유무·문장·자리·무통지. `useRouteGuide.exit-lead`: 접두, 출구 없으면 바이트 동일, 강등 문장 접두, 재시작은 미접두 |

## 8. 실기기 판정 항목 (BACKLOG §2 행 재료, 위원장 실승차)

① 지하 역: 버튼을 누른 뒤 「N번 출구로 나가세요.」가 곧바로 들리는가, 시트의 지금 할 행동 줄이 「N번 출구로 나가기」이고 그다음이 「출구로 나왔어요」인가.
② 출구를 나온 뒤 시작 통지까지 얼마나 걸리는가, 그때 첫 안내가 실제 위치와 맞는가(로그 `exitHoldRelease reason·elapsed·acc`).
③ 역 안에서 창이 일찍 풀린 적이 있는가(지하 와이파이 fix가 30m 이하로 보고되는 역. 로그 `routeOriginWait acc·speed·station` 분포).
④ 지상·고가 역: 출구 문장이 두 번 들리는가(단독 통지 4초 안에 시작 통지가 나가면 접두로 다시 실린다), 출구 줄이 너무 빨리 사라지는가.
⑤ VoiceOver: 단독 통지와 착지 낭독(「N번 출구로 나가기」)이 잇달아 들리는 것이 거슬리는가.
⑥ 「출구로 나왔어요」: 누른 뒤 응답 통지와 착지, 15초 안에 경로가 서는가.
⑦ 상한 240초에 닿은 세션이 있는가(`reason=recentBest`), 그때 첫 안내가 맞았는가.
⑧ 신호가 전혀 없는 깊은 역: 창이 닫히지 않고 기다리는가, fix 부재 반복음이 거슬리는가, 15분 안전망이 걸린 적이 있는가.
⑨ 승강장·대합실에 5분 넘게 머문 경우(엘리베이터 대기) 무이동 안전망이 세션을 끝내는가.
⑩ 다른 역에서 내려 인계 버튼을 누른 경우 출구 문장이 거둬지는가(`reason=otherStation`). 반대로 계획한 역에서 내렸는데 `reason=otherStation`이 찍힌 오발이 있는가(지하의 첫 보관 가능 fix가 600m 넘게 튄 경우. 출구 대기가 조용히 사라진다).
⑪ 승차 중 하차 준비 줄: 국면 버튼 다음 스와이프 1회에 있는가, 문장이 길찾기 결과 하차 줄과 같은가, 환승 구간·버스 구간의 모양.

## 9. 열린 판정

| # | 질문 | 이번 판 기본값 |
|---|---|---|
| 1 | 단독 통지 뒤에 목적지·도보 분을 덧붙일까 | 덧붙이지 않는다. 도보 분은 직전 도착 통지가 말했고 목적지는 밖에서 나오는 시작 통지가 말한다 |
| 2 | 지상·고가 역은 승강장에서도 위치가 정확해 창이 곧바로 풀린다. 역 좌표에서의 거리 같은 공간 조건을 더할까 | 더하지 않는다. 정확한 위치의 안내는 P3의 금지 대상이 아니고, 출구가 역 중심 바로 위인 역에서 안내 없이 걷는 구간이 생긴다. ④ 관찰 뒤 판정 |
| 3 | 웹 출구 대기 | 하지 않는다(§6). BACKLOG §4 |
| 4 | 여정에서 대중교통이 마지막 탈것일 때의 다음 도보 단계에도 출구 대기를 줄까 | 주지 않는다 |
| 5 | 창 동안 fix 부재 반복음을 끌까 | 끄지 않는다. ⑧ 관찰 뒤 판정 |
| 6 | 대기 국면의 빠른 하차 줄에도 출구를 실을까 | 바꾸지 않는다(P1은 승차 중 시트) |
| 7 | 잠정 상수: 상한 240초, 최근 창 15초, 다른 역 600m, 접두 창 4초, 창 동안 두절 임계 900초, 수용 정확도 30m(A18 공유) | ②③⑦⑧ 로그로 판정 |
| 8 | 서버가 출구 좌표를 싣고 그 좌표를 도보 경로 출발점으로 쓰는 안 | 이번 판 밖(서버 계약 변경). 창 동안 남은 거리·경로를 미리 보여 줄 수 있는 다음 판 후보 |
| 9 | 창의 2단 상한을 도플러 속도로 가르는 안(걷는 속도가 관측되면 상한을 늦추고 정지면 당긴다) | 기각. 지하 fix의 속도 값은 신뢰 근거가 없고, 버튼이 같은 필요를 사용자 선언으로 푼다. 계측에 속도·속도 정확도를 남겨 다음 판정 재료로 둔다 |
| 10 | 단독 통지 직후 착지 낭독이 같은 출구를 한 번 더 말한다(⑤). 선택지: 그대로 둔다 / 창 동안 첫 착지를 해제 버튼으로 옮긴다 / 단독 통지를 내지 않고 착지 낭독에 맡긴다(VoiceOver 꺼진 사용자는 못 듣는다) | 그대로 둔다. ⑤ 관찰 뒤 판정 |
| 11 | 승강장에 오래 머무는 경우의 무이동 안전망(⑨) | 종전 300초 그대로. fix가 오는 동안의 정지는 잊힌 세션과 구분할 수 없다 |
| 12 | 접두 창 4초의 기준 시각은 단독 통지를 `announce`에 넘긴 시각이다. 시작 소리 뒤로 미뤄진 통지는 실제 게시가 최대 3초 늦어, 게시 직후의 시작 통지에 접두가 빠질 수 있다 | 그대로 둔다. 실제 게시 시각을 받으려면 공용 `DeferredAnnouncer`에 게시 콜백을 더해야 한다(문장 일치로 가르는 것은 금지). ④ 관찰 뒤 판정 |
| 13 | 관측 공백 30초(`exitHoldObservationGapSeconds`), 상한의 연속 구간 15초 | 잠정. 창의 총수명 상한은 두지 않았다(드문드문 오는 제자리 fix도 첫 fix 뒤 300초에 끝나는 것을 시나리오 fixture가 잠근다). 지하 fix가 15초보다 성기게 오면 상한이 걸리지 않고 버튼이 남는다. ⑦⑧ 로그로 판정 |

## 10. 기각한 대안

| 대안 | 기각 사유 |
|---|---|
| 경로를 지금처럼 곧바로 조회하고, 리듀서 위에 「출구 대기」 덮개를 씌워 통지를 골라 막은 뒤 풀릴 때 재조회 | 막을 통지 목록(회전·임박·주기·이탈·재조회·횡단·톤·띠 세 줄)을 새로 관리해야 하고 하나만 빠져도 역 안에서 틀린 안내가 나간다. 풀릴 때 어차피 재조회라 처음 조회가 버려진다. 조회 대기 창은 같은 효과를 이미 구조로 갖고 있다 |
| 시작 통지 하나에 출구 문장을 늘 접두로만 싣기(단독 통지 없음) | 지하에서는 시작 통지가 밖에 나온 뒤에야 나가므로 출구 번호를 가장 필요한 순간에 듣지 못한다 |
| 경로에서 출구를 `acceptWalkHandoff`가 직접 읽기 | E78 「걸어가기」가 다른 역에서 계획한 역의 출구를 말하게 된다 |

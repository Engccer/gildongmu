# 하차 출구 번호를 승차 중 시트와 말미 도보 안내로 잇기 (가칭 E84) 설계

2026-11-14 · iOS 정식판(봉인 없음, 2.8 제출분) + 웹(가벼운 판) · 안드로이드 범위 밖
앞 설계: `2026-09-02`(E25 출구 번호), `2026-09-11`(E34 말미 도보 인계), A18(안내 경로 origin 선택), E57(안내 시트 착지), E81(정보 띠)

**설계 리뷰 대상이다**(새 판정·상태 계층 + 안전·정확성 크리티컬). 판정: 별도 컨텍스트 리뷰를 거친 뒤 구현한다.

## 1. 목표와 성과

지하철에서 내려 「남은 도보 안내 시작」을 누른 사용자가 몇 번 출구로 나갈지를 도보 안내에서 곧바로 듣고, 시트에서 다시 읽을 수 있다. 승차 중에는 내릴 문과 나갈 출구를 미리 읽을 수 있다. 역 안에서 잡힌 부정확한 위치로 만든 회전 안내는 듣지 않는다.

**움직일 성과**
- 인계 뒤 출구 번호를 듣기까지: 지금은 길이 없음 → 시작 톤 직후 첫 통지 한 문장.
- 승차 중 출구·문 위치 확인: 지금은 접힌 경유역 목록을 펼쳐 마지막 행까지 가야 함(출구만) → 국면 버튼 다음 스와이프 1회.
- 역 안 fix로 만든 경로의 시작 통지(첫 회전 안내 포함) 횟수: 로그 `exitHoldRelease reason=accepted`인 세션에서 0.

확인은 실기기 VoiceOver 실승차(§8)와 계측 로그.

**비목표**: 환승 도보(E73), 승차 전 도보(A25), 여정(E70)의 대중교통 뒤 단계, 자동차 인계, 잘못 내림 복구의 「걸어가기」, 안드로이드, 웹의 출구 대기(§6), 서버 응답 변경(출구 좌표 싣기 등), 수동 해제 버튼.

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
| D1 | 출구 번호를 실은 인계로 시작한 도보 세션은 시작 경로 조회의 origin 대기 상한을 15초에서 `exitHoldMaxSeconds`(240초, 잠정)로 늘린다. 풀리는 판정은 기존 `routeOriginStep` 그대로다(정확도 30m 이하 ∧ 나이 10초 이하인 첫 fix). 이 창을 「출구 대기」라 부른다(코드 이름 `exitHold`) | 조회 대기 창은 이미 「부정확한 위치로 경로를 만들지 않는다」(A18)를 구현한 자리다. 창 안에서는 리듀서가 fix를 보지 않으므로 회전·이탈·주기·임박 통지를 **따로 막을 것이 없다**. 새 억제 목록을 세우면 정식판에 바로 나가는 판에 빠뜨릴 자리가 생긴다. 판정을 새로 만들지 않아 「역 밖」의 근거는 실측된 A18 술어 하나다 |
| D2 | 창이 풀리면(수용 fix) 종전 경로 조회 → 종전 시작 통지 `guide.detailStart`가 그대로 나간다. 그때의 `{first}`는 정확한 위치에서 만든 첫 안내다 | P3의 「위치가 제대로 잡히고 경로를 따라가기 시작하면 평소 안내 문장」. 시작 통지·시트 행·톤·착지가 전부 기존 커밋 경로라 출구 대기 뒤의 동작이 지금과 같다 |
| D3 | 탈출 경로는 기존 것 그대로 셋이다. ① 상한 240초: 종전 `startFixWaitWatch` 분기(최선값이 있으면 그것으로 조회, 없으면 `guide.detailNoLocation` 간략 강등). ② 잊힌 세션 안전망(fix 두절 300초·무이동 300초)은 창 안에서도 돈다(손대지 않는다). ③ 사용자 [안내 종료]·목적지 바꾸기 | 데드락 없음: 상한은 벽시계 Task이고 fix 수신에 의존하지 않는다. 상한(240초)을 안전망(300초)보다 짧게 두어 fix가 오는 한 강등보다 조회가 먼저 온다. 상한에 닿은 세션은 「지금 15초에 일어나는 일이 240초에 일어난다」가 전부라 지금보다 나빠지는 경로가 없다 |
| D4 | 상한 인자는 Kit 순수 함수 `routeOriginWaitSeconds(exitLead:base:)`가 정한다(출구가 있으면 `exitHoldMaxSeconds`, 없으면 `base`). `startFixWaitWatch(token:)`는 `timeout:` 인자를 **기본값 없이** 받고, 출구 대기 상한은 **세션 시작의 첫 대기 한 번**에만 준다(목적지 전환·경유지·재획득의 재대기는 종전 15초) | 안전 인자에 기본값 금지. 출구가 없을 때 15초가 바이트 동일로 남는다 |
| D5 | 출구 대기는 `exitHold`(출구 번호 문자열 + 단독 통지 게시 여부) 모델 상태 하나가 든다. 지우는 자리: 시작 경로 커밋(성공·간략 강등 어느 쪽이든 `awaitingRoute`가 풀리는 첫 순간), `stop()`, `changeDestination`, `setWaypoint`. `syncStartRequestWithSession`은 그 시점의 모델 값을 `StartRequest.exitLead`에 싣는다 | 목적지를 바꾸면 그 출구가 맞다는 근거가 사라진다. 정밀 위치 허용 뒤 `restart()`는 저장된 요청으로 출구 대기를 다시 연다(같은 세션의 재현, A13) |
| D6 | 창 동안의 계측: 시작 `exitHold start exit=…`, 해제 `exitHoldRelease reason=accepted\|best\|none elapsed=… acc=…`. 창 안 fix마다 남는 기존 `routeOriginWait` 줄은 그대로 둔다(최대 240초분) | 상수 둘(240초·30m)이 잠정이라 실승차 로그가 판정 재료다. 지하 와이파이 fix의 정확도 분포와 해제 시각을 이 줄들로 읽는다 |

### 4.2 창 동안 무엇이 침묵하고 무엇이 그대로인가

| 대상 | 창 동안 | 근거 |
|---|---|---|
| 회전·결정 지점·임박·주기 통지, 이탈·재조회, 횡단보도 경고, 최종 접근·도착 판정, 추세 톤 | 없음 | 경로가 아직 없다(리듀서가 돌지 않는다). 막는 코드를 새로 쓰지 않는다 |
| 「신호 약함」 음성 | 없음(종전 조회 대기 창과 같음) | `noticeStaleIfNeeded`의 기존 가드 |
| fix 부재 반복음(워치독 톤) | 그대로 | 새 억제를 더하지 않는다. 체감은 실승차 관찰(§8 ⑦, 열린 판정 5) |
| 잊힌 세션 안전망 | 그대로 | D3 ② |
| 시작 톤, 소리 강등 고지, 권한·정밀 위치 실패 | 그대로 | 시작 경로 그대로 |
| 정보 띠(E81) | 남은 거리 띠·다음 예고 띠 없음, 지금 할 행동 띠 하나(D8) | 줄을 더하지 않는다. 띠 몫 계산은 기존 `bandExists` 그대로 |

### 4.3 통지와 시트 (도보)

| # | 결정 | 근거 |
|---|---|---|
| D7 | 세션 시작 직후(시작 톤 뒤, `announce` 창구, `speechClass: .actionable`, 기본 우선순위) 단독 통지 「5번 출구로 나가세요.」(새 키 `guide.exitLeadStart`)를 낸다. 그 뒤에 나가는 첫 시작류 통지(`guide.detailStart` 커밋 문장, 간략 강등 문장)는 **단독 통지가 아직 끝나지 않았을 때만** 같은 문장을 접두로 다시 싣는다(판정 `exitLeadPrefixNeeded(hasExit:soloPosted:soloSettled:)`, `soloSettled`는 모델 `announcementsSettled`) | P2. 위치가 곧바로 잡히는 역(지상·고가)에서는 1~3초 뒤 `.high` 시작 통지가 단독 통지를 끊는다. 끊긴 문장을 접두로 다시 실으면 그 경우의 통지가 P2 시안 그대로(「5번 출구로 나가세요. ○○까지 도보 안내 시작. …」)가 되고, 지하 역에서는 출구 문장을 먼저 듣고 밖에서 시작 통지를 듣는다. 이미 끝까지 들은 문장을 출구를 나온 뒤 되풀이하지 않는다 |
| D8 | 창 동안 `statusText`에 「5번 출구로 나가기」(새 키 `guide.exitHoldAction`)를 둔다. 시트는 기존 간략 상태 문장 행(`.status`, 지금 할 행동 띠)으로 그린다. 창 동안 `beacon.straightLineNote`는 그리지 않는다(조건에 `model.exitHoldActive` 부정 추가) | 새 행·새 착지 대상·새 띠가 없다. 「직선거리 기준입니다」는 이 창에서 거짓이다. 전경 복귀 재생이 읽는 것도 이 문장이라 창 동안 참이다 |
| D9 | 첫 정보 행 착지(`requestInfoLanding`)는 출구 대기 중이면 조회를 기다리지 않고 통지가 끝난 뒤 상태 문장 행에 앉는다(가드를 `model.awaitingRoute && !model.exitHoldActive`로). 창이 풀려 행이 바뀌면 기존 소실 복구·`awaitingRoute` onChange가 그때의 첫 정보 행으로 옮긴다 | 지금 가드대로면 착지가 20초 상한에 걸려 버려진다(창이 최대 240초) |
| D10 | 창이 상한으로 끝나 간략 강등되면 강등 문장이 상태 행을 대체한다(종전 동작). 출구 문장은 D7 접두 규칙만 따른다 | 새 문구를 만들지 않는다 |

### 4.4 출구 번호를 실어 넘기는 경로

| # | 결정 | 근거 |
|---|---|---|
| D11 | `TransitWalkHandoff`에 `exitAlight: String?`(기본값 없음)를 더한다. `completeOrAdvance`가 `stop()` **앞에서** 마지막 구간의 `displayLeg(leg, useOverride: false).exitAlight`를 캡처해 싣는다(확정 도착 통지와 같은 원천) | `stop()`이 경로를 지운다. 버스 노선 교체(E76)·복구로 바뀐 경로(E78)도 그 시점의 실제 마지막 구간을 따른다 |
| D12 | `acceptWalkHandoff()`는 `transit.stop()`·`clearWalkHandoff()` **앞에서** `transit.pendingWalkHandoff?.exitAlight`를 읽어 `transitValidExitNo`를 한 번 더 지나게 한 뒤 `StartRequest.exitLead`로 넘긴다. 경로에서 직접 읽지 않는다 | E78 「걸어가기」는 `pendingWalkHandoff`가 nil이라 출구가 실리지 않는다(사용자가 계획한 하차역에 있지 않다). 이 구분이 구조로 선다 |
| D13 | `BeaconModel.StartRequest`에 `exitLead: String?`(기본값 없음). 호출부 전부가 값을 적고, nil이 아닌 값을 적는 곳은 `acceptWalkHandoff` 하나다 | 안전 인자에 기본값 금지. 소스 가드가 센다(§7) |
| D14 | 확정 도착이 아니어도(추정 도착, [이미 탔어요]로 탄 열차, 복구 뒤 새 경로) 인계에는 출구를 싣는다 | 추정 도착 **통지**가 출구를 말하지 않는 이유는 앱이 내릴 역을 추정으로 지목하기 때문이다(설계 리뷰 #14). 인계 버튼은 사용자가 「내렸다」고 선언하는 동작이라 근거가 다르다. 잘못 내렸다면 복구 경로(D12)가 따로 있다 |
| D15 | 적용 범위는 말미 도보 인계 하나다. 환승 도보(E73)·승차 전 도보(A25)·자동차 인계·여정 단계·나들이 귀환은 `exitLead: nil` | 서버가 최종 하차에만 출구를 싣는다. 여정의 출구 도보는 출구가 목적지인 별도 단계라 겹치지 않는다(이 경로로 들어오지 않는다) |

### 4.5 승차 중 하차 준비 줄 (P1)

| # | 결정 | 근거 |
|---|---|---|
| D16 | `TransitTrackingSheet.sheetBody`의 본 Section에서 `phaseControls(proxy:)` 바로 다음에 `alightPrepRow`를 둔다. 문장은 `alightLineText(leg.quickExit, station:, exitAlight: display.exitAlight, lang:, exitBound: { appLocalized("transitGuide.exitBound", $0) })`. 단일 `Text`, 착지 대상 아님, 통지 없음 | P1 그대로. 국면 전환으로 조용히 나타나는 정적 문장이라 착지점(상태 문장) 뒤에 있다 |
| D17 | 서는 국면: `boarding`·`riding`·`arrived`. `waiting`에는 세우지 않는다 | 대기 국면은 열차 목록 앞에 빠른 하차 줄이 이미 있다(같은 문 위치를 한 화면에서 두 번 읽게 된다). 타려는 순간과 내린 직후에도 같은 자리에서 읽을 수 있어야 한다. 대기 국면에 출구를 더하는 것은 열린 판정 6 |
| D18 | 환승 구간은 「○○역 하차, 빠른 환승 5-3 문」(함수가 그대로 낸다, 출구 없음). 버스 구간은 재료가 없어 줄이 없다. 문 위치도 출구도 없는 지하철 구간도 줄이 없다 | 3-state, 부재 문구 금지 |
| D19 | 역 이름과 언어는 기존 `quickExitLine`과 같은 선택(표시 라벨: en이면 영문, 없으면 한국어 원문 / `lang`은 앱 언어)을 한 헬퍼로 공유한다 | 조인 필드를 문장에 넣지 않는다(E27). 대기 국면 줄과 승차 국면 줄의 역 이름이 갈리지 않는다 |
| D20 | 접힌 경유역 목록 하차 행의 출구 병기(E25)는 그대로 둔다 | 접힌 목록 안이라 펼쳐야 들리고, 그 행은 「어느 역이 하차역인가」의 목록이다. 지우면 E25 계약(출구는 확정 도착·하차역 행)과 웹·가드가 함께 움직인다 |
| D21 | 여정의 대중교통 단계에도 같은 줄이 선다 | 그 경로의 `exit.alight`는 택시가 대신하는 끝이면 서버가 이미 뗐다. 남아 있으면 실제로 그 출구로 나가는 경로다 |

## 5. 문자열

새 키 둘(`messages/*.json` `guide` 네임스페이스, 웹·iOS 공유. iOS는 `.claude/rules/i18n.md`의 변환 파이프라인으로 xcstrings 재생성, `arg-order.json` 갱신). ko는 위원장 확정, 나머지는 기존 `transitGuide.exitBound`의 낱말(Exit·出口·salida·sortie·uscita)을 따른 초안이다.

| 키 | ko (확정) | en | ja | es | fr | it |
|---|---|---|---|---|---|---|
| `guide.exitLeadStart` | {exit}번 출구로 나가세요. | Take Exit {exit}. | {exit}番出口から出てください。 | Salga por la salida {exit}. | Prenez la sortie {exit}. | Prenda l'uscita {exit}. |
| `guide.exitHoldAction` | {exit}번 출구로 나가기 | Take Exit {exit} | {exit}番出口から出る | Salir por la salida {exit} | Prendre la sortie {exit} | Prendere l'uscita {exit} |

- 접두 결합은 공백 하나(`"\(lead) \(start)"`, 기존 `away`·`notice` 접두와 같은 조립).
- 하차 준비 줄은 새 키가 없다(`route.transit.alightAt`·`quickExit*`·`transitGuide.exitBound` 재사용).
- 낭독 문장의 정본은 문자열 자원이다. 구현·리뷰 때 이 표가 아니라 `messages/ko.json`을 본다.

## 6. 웹 범위

| 항목 | 이번 판 | 사유 |
|---|---|---|
| 하차 준비 줄 | 한다. `TransitGuidePanel`의 `boarding`·`riding`·`arrived`에서 국면 버튼 묶음 다음에 `<p>` 한 줄(`transit-exit-lines.ts` `alightLineText`, 역 이름·`lang`은 기존 `quickExit`·`quickExitLang`과 같은 선택). live region 없음 | iOS와 같은 문장·같은 자리 |
| 출구 문장 | 한다. `doneHandoff`에 `exitAlight`를 싣고 `DistanceBeacon`·`useRouteGuide`에 `exitLead`(기본값 없는 선택 인자, 호출부가 `null`을 적는다)로 넘겨 **첫 시작류 통지**(상세 시작 요약 또는 강등 문장)의 접두로 싣는다. 단독 통지·상태 행은 없다 | 웹 통지는 live region 한 창구라 몇 초 간격의 두 문장이 서로를 대체한다. 접두 한 자리가 결정론이다 |
| 출구 대기(D1~D10) | 하지 않는다. BACKLOG §4에 한 줄 | 웹 시작 조회는 단발 정밀 재취득이라 스트림 대기·상한·최선값 구조를 새로 세워야 한다. 웹은 화면이 꺼지면 멈춰 역사를 지나는 몇 분을 살아서 건너기 어렵고, 실승차로 판정할 수단이 iOS뿐이다. 정식 웹에 즉시 배포되는 판에 검증 못 한 대기 구조를 올리지 않는다 |

웹 미러 파일은 만들지 않는다(웹에 소비자가 없는 판정 함수는 죽은 코드다). 공유 fixture는 Kit 쪽에 두고, 웹·안드로이드가 출구 대기를 들일 때 그 fixture를 함께 읽는다.

## 7. 구현 자리와 테스트

**구현 자리**

| 파일 | 변경 |
|---|---|
| `ios/GildongmuKit/Sources/GildongmuKit/ExitHold.swift` (새 파일) | `exitHoldMaxSeconds` · `routeOriginWaitSeconds(exitLead:base:)` · `exitLeadPrefixNeeded(hasExit:soloPosted:soloSettled:)` |
| `android/kit/mirrors/guide.json` | `ExitHold.swift` `pending` 등록 |
| `ios/Gildongmu/Directions/TransitGuideModel.swift` | `TransitWalkHandoff.exitAlight`, `completeOrAdvance`의 캡처(D11) |
| `ios/Gildongmu/Directions/GuideSessionCoordinator.swift` | `acceptWalkHandoff` 캡처 순서(D12), 나머지 `StartRequest(` 5곳에 `exitLead: nil` |
| `ios/Gildongmu/Directions/BeaconModel.swift` | `StartRequest.exitLead`, `exitHold` 상태와 `exitHoldActive`, `start()`의 단독 통지·상태 문장·첫 대기 상한, `startFixWaitWatch(token:timeout:)`, 커밋·강등 문장의 접두, 지우는 자리 넷(D5), 계측(D6), `toggle`·`syncStartRequestWithSession`의 인자 |
| `ios/Gildongmu/Directions/DirectionsTabView.swift` | `StartRequest(` 2곳에 `exitLead: nil` |
| `ios/Gildongmu/Directions/BeaconTrackingSheet.swift` | 직선거리 주석 조건(D8), 착지 가드(D9) |
| `ios/Gildongmu/Directions/TransitTrackingSheet.swift` | `alightPrepRow`와 역 이름 헬퍼 공유(D16~D19) |
| `messages/{ko,en,ja,es,fr,it}.json`, `ios/i18n/arg-order.json`, `Localizable.xcstrings`(생성물) | 새 키 둘 |
| `src/hooks/useTransitGuide.ts` · `src/components/TransitGuidePanel.tsx` · `src/components/DistanceBeacon.tsx` · `src/hooks/useRouteGuide.ts` | §6 |
| `.claude/rules/guidance.md` 한 줄 + `docs/INTEGRATIONS.md` 같은 제목 절, `docs/BACKLOG.md` §2 행·§4 한 줄, `CHANGELOG.md`, `docs/FIELD-TEST.md` | 문서 분배 |

**테스트**

| 종류 | 내용 |
|---|---|
| Kit 단위 + fixture(`Fixtures/exit-hold-cases.json`) | `routeOriginWaitSeconds`: 출구 nil·빈 문자열이면 `base`, 있으면 240. `exitLeadPrefixNeeded` 진리표(출구 없음 → 거짓 / 단독 미게시 → 참 / 게시·미완 → 참 / 게시·완료 → 거짓). `routeOriginStep`은 기존 테스트 그대로(변경 없음) |
| Kit 단위 | `alightLineText` 기존 테스트에 「출구만」「문만」「둘 다 없음」「환승」이 이미 있는지 확인하고 빠진 조합만 더한다 |
| 소스 가드(새 `src/lib/__tests__/exit-carryover-guard.test.ts`) | ① `StartRequest`의 `exitLead`에 기본값이 없다 ② 저장소의 `StartRequest(` 전수가 `exitLead:`를 적고, `exitLead: nil`이 아닌 곳은 `acceptWalkHandoff` 한 곳 ③ `acceptWalkHandoff`에서 `pendingWalkHandoff?.exitAlight` 읽기가 `transit.stop()`보다 앞 ④ `startFixWaitWatch(` 호출 전수가 `timeout:`을 적고 `routeOriginWaitSeconds(`를 쓰는 곳은 `start(` 안 한 곳 ⑤ `sheetBody`에서 `phaseControls(proxy: proxy)` → `alightPrepRow` → Section 닫힘 → `surroundingsSection` 순서, `alightPrepRow`에 `landingTarget`·통지 호출 없음 ⑥ `changeDestination`·`setWaypoint`·`stop`이 `exitHold`를 지운다 |
| 기존 가드와의 관계 | `guidance-gate-drift`: 세션 시작 호출 수 불변(새 입구 없음). `transit-landing-guard`: 착지 대상 집합 불변. `guide-sheet-bands-guard`: 띠 구성 불변(상태 행 재사용). `guide-sheet-landing-guard`: 착지 가드 문장이 바뀌므로 그 가드가 잠근 소스 술어를 함께 고친다. `i18n-messages`: 새 키 6로케일·가운뎃점 없음. `mirror-registry`: 새 Kit 파일 등록 |
| 웹 | `TransitGuidePanel` jsdom 테스트: 하차 준비 줄의 국면별 유무·문장·자리. `useRouteGuide`: `exitLead`가 있으면 첫 시작류 통지 접두, `null`이면 문장 바이트 동일 |
| 변이 주입(커밋 뒤) | 상한을 15초로 되돌림 → fixture 실패 / `exitLead`를 경로에서 직접 읽게 바꿈 → 가드 ③ 실패 / `alightPrepRow`를 주변 섹션 안으로 옮김 → 가드 ⑤ 실패 |
| 출구 없음 동작 동일 | `exitLead == nil`이면 새 분기가 전부 닫힌다는 것을 가드 ④와 Kit fixture로 고정하고, 리뷰어가 diff에서 `exitHold` 없는 경로의 문장·상한·시트 조건이 그대로인지 확인한다 |

## 8. 실기기 판정 항목 (BACKLOG §2 행 재료, 위원장 실승차)

① 지하 역: 버튼을 누른 뒤 「N번 출구로 나가세요.」가 곧바로 들리는가, 시트의 지금 할 행동 줄이 「N번 출구로 나가기」인가.
② 출구를 나온 뒤 시작 통지까지 얼마나 걸리는가, 그때 첫 안내가 실제 위치와 맞는가(로그 `exitHoldRelease elapsed·acc`).
③ 역 안에서 창이 일찍 풀린 적이 있는가(지하 와이파이 fix가 30m 이하로 보고되는 역. 로그 `routeOriginWait acc` 분포).
④ 지상·고가 역: 단독 통지와 시작 통지가 겹치거나 출구 문장이 두 번 들리는가.
⑤ VoiceOver: 단독 통지와 착지 낭독(「N번 출구로 나가기」)이 잇달아 들리는 것이 거슬리는가.
⑥ 상한 240초에 닿은 세션이 있는가, 그때 무엇을 들었는가.
⑦ 신호가 전혀 없는 역에서 fix 부재 반복음이 창 동안 거슬리는가.
⑧ 승차 중 하차 준비 줄: 국면 버튼 다음 스와이프 1회에 있는가, 문장이 길찾기 결과 하차 줄과 같은가, 환승 구간·버스 구간의 모양.

## 9. 열린 판정

| # | 질문 | 이번 판 기본값 |
|---|---|---|
| 1 | 단독 통지 뒤에 목적지·도보 분을 덧붙일까(시안 「…파티앤스터디까지 도보 6분.」) | 덧붙이지 않는다. 도보 분은 직전 도착 통지(`arrivedWalkNext`)가 방금 말했고, 목적지는 밖에서 나오는 시작 통지가 말한다. 덧붙이려면 새 문안 확정이 필요하다 |
| 2 | 지상·고가 역은 승강장에서도 위치가 정확해 창이 곧바로 풀린다(출구 줄이 1~3초 만에 사라진다). 역 좌표에서의 거리 같은 공간 조건을 더할까 | 더하지 않는다. 정확한 위치의 안내는 P3의 금지 대상(부정확한 위치로 만든 회전 안내)이 아니고, 출구가 역 중심 바로 위인 역에서 안내 없이 걷는 구간이 생긴다. ④ 관찰 뒤 판정 |
| 3 | 웹 출구 대기 | 하지 않는다(§6). BACKLOG §4 |
| 4 | 여정에서 대중교통이 마지막 탈것일 때의 다음 도보 단계에도 출구 대기를 줄까 | 주지 않는다(여정 단계 시작 인자는 별도 경로, 실험판 판정 중) |
| 5 | 창 동안 fix 부재 반복음을 끌까 | 끄지 않는다(§4.2). ⑦ 관찰 뒤 판정 |
| 6 | 대기 국면의 빠른 하차 줄에도 출구를 실을까(그 줄을 `alightLineText`로 바꾸기) | 바꾸지 않는다(P1은 승차 중 시트) |
| 7 | 상수: 상한 240초, 수용 정확도 30m(A18 공유) | 잠정. ②③⑥ 로그로 판정 |
| 8 | 서버가 출구 좌표를 싣고 그 좌표를 도보 경로 출발점으로 쓰는 안 | 이번 판 밖(서버 계약 변경, 웹 선배포 필요). 창 동안 남은 거리·경로를 미리 보여 줄 수 있는 다음 판 후보 |
| 9 | 창을 손으로 푸는 버튼 | 두지 않는다. 풀어도 얻는 것이 부정확한 위치의 경로다 |

## 10. 기각한 대안

| 대안 | 기각 사유 |
|---|---|
| 경로를 지금처럼 곧바로 조회하고, 리듀서 위에 「출구 대기」 덮개를 씌워 통지를 골라 막은 뒤 풀릴 때 재조회 | 막을 통지 목록(회전·임박·주기·이탈·재조회·횡단·톤·띠 세 줄)을 새로 관리해야 하고 하나만 빠져도 역 안에서 틀린 안내가 나간다. 풀릴 때 어차피 재조회라 처음 조회가 버려진다. 조회 대기 창은 같은 효과를 이미 구조로 갖고 있다 |
| 시작 통지 하나에 출구 문장을 늘 접두로만 싣기(단독 통지 없음) | 지하에서는 시작 통지가 밖에 나온 뒤에야 나가므로 출구 번호를 가장 필요한 순간에 듣지 못한다 |
| 경로에서 출구를 `acceptWalkHandoff`가 직접 읽기 | E78 「걸어가기」가 다른 역에서 계획한 역의 출구를 말하게 된다 |

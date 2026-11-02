# E70-f: 자동차 환승 여정의 웹 입구 설계

- 상태: 설계 확정·구현(2026-11-02, 세션 zen-franklin). 판정 정본은 `docs/BACKLOG.md` E70-f(위원장 판정 2026-11-02 ①~③).
- 원본 설계: `2026-10-17-e70-mode-change-journey-design.md`(이하 **원 spec**)와 E70-e(정류장 지정). 서버 계약(§4)·판정 1~32·문안 표(§8.4)는 그대로이고, 이 문서는 **웹이 iOS와 다르게 하는 것과 그 이유**만 적는다. 적지 않은 것은 원 spec을 따른다.
- 설계 리뷰 판정: 해당 없음(새 외부 통합·새 판정 계층 없음 — 서버·전이 표는 기존 것의 소비·미러).

## 0. 요약

웹 길찾기에서 「경유지/자동차 환승 추가」 → 「자동차에서 내리는 역/정류장 추가」·「자동차를 탈 역/정류장 추가」로 갈아탈 곳을 정하면 조회는 여정 하나만 한다(D12). 결과는 iOS와 같은 줄(변형 제목·합계·택시 앞·대중교통 구간·출구 선택)이고, [안내 시작]은 택시(자동차 승객) → 접근 도보 → 대중교통 → 출구 도보 → 택시를 **한 패널 안에서** 이어 붙인다. 전이 표는 Kit `journeyStep`의 TS 미러(`src/lib/journey/journey-step.ts`)이고 공유 fixture(`src/lib/__tests__/fixtures/journey-step-cases.json`)로 Kit과 같은 값을 잠근다.

## 1. 위원장 판정 (2026-11-02)

1. 두 단계 모두(조회·결과 + 이어 안내).
2. **ko 로케일 전체 공개** — 웹엔 실험판 봉인이 없다. 원 spec 판정 5("실험판에만")의 웹 예외이고, 웹이 iOS 정식판보다 먼저 연다.
3. **여정 Tmap 상한은 지금 장치 유지**(IP 60초 16회 + 인스턴스 일 200회, 원 spec §4.5-3·4). 원 spec §4.5-4의 "웹 UI 입구를 열기 전 공유 저장소 승격 판정"의 답이 "지금은 아니다"다. 일 상한 503이 관측되면 다시 연다.

## 2. 게이트 (W1)

입구(메뉴·역 칸)는 셋이 모두 참일 때만 보인다. 하나라도 거짓이면 종전 「경유지 추가」 버튼 그대로(死기능 0).

- 서버 키 게이트 `canPlanJourney = hasOdsayKey() && hasTmapKey() && hasKakaoKey()`(라우트 503 조건과 같은 식, `page.tsx` → `PlaceSearch` → `DirectionsView` prop). 정류장 검색은 `hasDataGoKrKey()`가 더 필요하므로 `canSearchJourneyStops`를 따로 내린다 — 거짓이면 칸 검색이 역만 낸다.
- 데이터 로케일 ko(`!prefersEnglish(locale)`, D2 — 라우트가 ko 전용).
- 안내 시작은 자동차 안내 게이트(`carGuideStartable`의 provider 축)를 여정에 다시 걸지 않는다: 택시 세션은 시작 뒤 스스로 경로를 조회하고 카카오 폴백·실패면 간략 모드로 계속한다(원 spec §6.3 "택시 세션의 경로"와 같다).

## 3. 입력 (W2)

- 경유지도 역도 없을 때 「경유지/자동차 환승 추가」 **disclosure 버튼**(`aria-expanded`) 하나. 펼치면 버튼 셋(「경유지 추가」·「자동차에서 내리는 역/정류장 추가」·「자동차를 탈 역/정류장 추가」, 이 순서). ARIA `menu` 역할은 쓰지 않는다(과잉 ARIA 금지 — 버튼 목록으로 충분). 항목을 누르면 목록이 접히며 그 칸의 입력으로 포커스를 선점 이동한다(누른 버튼이 사라지는 전이, 헌장 §5).
- **웹 칸은 검색 입력이다**(iOS는 시트에서 고른 뒤 칸이 선다). 칸 이름은 `journey.boardField`·`journey.alightField`. 입력 + [검색](+ 음성은 첫 판 밖 — 끝점 칸과 달리 넣지 않는다, 아래 §9).
- **후보는 역과 정류장만 보인다**(iOS는 모든 장소를 보이고 역이 아니면 「역이나 정류장을 골라 주세요.」로 거절한다). 웹은 목록 단계에서 거른다: `/api/places` 결과 중 `stationLayoutKind(place)`가 `subway`·`rail`인 것 상위 5 + `/api/route/journey/stops`(2~30자, 기준 좌표는 출발·도착 칸의 확정 좌표 중 있는 것, 둘 다 없으면 부르지 않는다) 상위 5. 이유: 웹 목록은 고르는 즉시 칸이 확정되는 흐름이라 거절 통지가 "고른 것이 안 들어갔다"를 알리는 유일한 신호가 되고, 그 왕복이 목록 단계 거르기보다 비싸다. 그래서 `notStation` 문장은 웹에 없다.
  - 줄: 역은 `joinText(이름, 주소)`(끝점 후보와 같은 줄), 정류장은 `joinText(이름, journey.busStopKind, 거리)`(iOS와 같은 줄). 통지는 건수(`directions.candidateCount`), 0건 `candidateNone`, 장소·정류장 둘 다 실패면 `candidateError`. 정류장 검색만 실패하면 건수 통지 뒤에 `journey.stopSearchFailed`를 같은 문장으로 잇고, 잘렸으면(`truncated`) 목록 끝에 `journey.stopSearchTruncated` 평문.
- 칸을 확정하면 입력에 이름이 남는다(끝점 칸과 같다). 남은 쪽이 비었으면 그 쪽을 더하는 일반 버튼 하나(원 spec §5.1 "항목 하나뿐인 메뉴는 만들지 않는다") + 「갈아탈 역/정류장 지우기」(판정 21: 두 칸을 비우고 조회 버튼으로 포커스). 칸마다의 삭제는 웹 첫 판에 없다 — 지우기 하나가 같은 일을 한다(밀기 동작이 없는 웹에서 버튼을 셋 늘리지 않는다).
- 노선 힌트: 원 spec §4.1 — 카테고리 마지막 조각이 노선이면 그것, 아니면 이름 꼬리 노선 토큰(iOS `journeyLineHint` 이식 `journeyLineHint`).
- D14(경유지와 배타): 역 칸이 하나라도 있으면 경유지 칸·메뉴 없음, 경유지가 있으면 메뉴 없음(종전 「경유지 삭제」만).
- 역 칸 편집·확정·지우기는 끝점 편집과 같은 무효화 축이다: 살아 있는 안내 세션을 멈추고(`stopActiveGuideSession` + 「안내를 중지했습니다」) 결과를 버린다.

## 4. 조회 (W3)

- 역 칸이 하나라도 확정돼 있고 미확정 텍스트 칸이 없으면 `runQuery`가 **여정만** 조회한다(D12). 반쯤 적힌 역 칸은 경유지와 같은 `needEndpoints`.
- 측위·커버리지 선분기는 일반 조회와 같은 길을 지난다. **출입구 승격(A11)은 하지 않는다**(iOS `performJourney`도 승격 앞에서 갈린다 — 택시 도착 목적지가 정문이 아니라 원래 장소다).
- 결과는 `QueryResults.journey`(3-state: `found` / `noRoute`(`variants: []`) / `failed`(비-200·네트워크·15초 시간 초과))로 싣고 `outcomes`는 비운다. `outOfCoverage` 마커는 일반 조회와 같은 phase.
- 완료 통지: 찾음 = `directions.readySummary`(count 1, 판정 22) + 옛 위치 뒷문장, 경로 없음 = `route.transit.noRoute`, 실패 = `route.transit.error`(iOS와 같은 키).
- 포커스: 찾으면 여정 섹션 heading으로 1회(웹 길찾기 규칙 — 첫 성공 수단 heading. iOS는 조회 버튼에 머무는 화면 규칙이라 다르다).
- WebMCP: 도구 호출(`runQuery(request)`)은 역 칸을 읽지 않는다 — 도구 계약(7개 도구)에 여정이 없고, 화면에 역 칸이 있어도 도구 요청은 일반 조회다. 도구 스냅샷(`buildToolPlan`)은 여정 결과에 `null`을 낸다(첫 판 밖).
- `?dir=`는 역 칸을 싣지 않는다(새로고침하면 역 칸이 빈다, 첫 판 밖 — A61 복원 표식과 함께 설계할 일).

## 5. 결과 (W4)

`JourneyResultView`(새 컴포넌트, `src/components/JourneyResult.tsx`). 판정·문장 조립은 순수 함수 `src/lib/journey/journey-lines.ts`(iOS `JourneyResultRows`·Kit 제목 판정 이식, React 비의존).

읽기 순서(한 줄 = 한 접근성 객체, `joinText` 쉼표 결합):

1. `<h3>` = 고른 변형의 제목(포커스 착지점, `tabIndex=-1`). **웹은 변형이 하나여도 heading을 둔다** — 수단 섹션마다 h3이 있는 웹 결과 구조에서 여정만 heading이 없으면 heading 점프로 결과에 닿지 못한다. 제목 문장은 iOS `journeyVariantHeading` 그대로.
2. (못 찾았을 때만) 판정 14 문장(양쪽이면 두 줄, 정류장은 `designatedMissingStop*`).
3. 변형이 둘이면 선택 버튼 둘(`aria-pressed`, 라벨 = 각 변형 제목, 시각 체크 표식은 `aria-hidden`). 고르면 heading 문장이 바뀌고 출구 선택은 0으로.
4. 합계 줄(고른 출구의 택시 시간·요금 차이를 반영 — iOS `totalsLine`).
5. 택시 앞 줄(`taxiIn`/`taxiInStop`).
6. 대중교통 구간 줄 — 기존 `TransitRouteResult`(`includeSummary=false`).
7. 출구 줄: 후보가 둘 이상이면 선택 버튼(`aria-pressed`), 하나면 평문. 문장은 `egressExit`·`egressStand`·`egressNone`·`egressNoneStop`·`egressLookupFailed`.
8. [안내 시작] = `beacon.guideStartTransitAlt`(`{name}` = 제목). 누르면 §7 이어 안내가 이 자리에서 시작한다.

동명 이역 노선 머리말(판정 26)은 Kit `journeyLineQualifiers`·`journeyNeedsLineQualifier`·`journeySameLine` 이식이다. 서버 `sameLine`(`station-identity.ts`)을 재사용하고 표시용 `journeyLineLabel`만 새로 둔다.

## 6. 최근 경로 (W5, D13·판정 20)

- `RecentRoute`에 선택 필드 `board`·`alight`(`{ label, lat, lng, line?, kind?: "stop" }`)를 더한다. 구버전 저장본은 부재 = 없음, `sameRoute`가 둘도 비교한다.
- 줄 문장: 여정이면 `journey.recentRoute`·`recentRouteBoth`·`recentRouteStop`·`recentRouteBothPlaces`(iOS `recentJourneyLabel` 이식). 게이트(§2)가 거짓인 화면에선 보통 문장이고 활성화도 역을 버린다(iOS와 같은 조건).
- 활성화: 끝점·역 칸을 채우고 여정 조회(양끝이 있을 때만 — 기존 규칙).

## 7. 이어 안내 (W6)

### 7.1 소유와 점유

- 웹엔 앱 수명 코디네이터가 없다. **여정 안내는 결과 섹션의 `JourneyGuide` 컴포넌트가 소유한다**: 여정 상태(`JourneyState`)·준비 타이머·단계별 패널(그 단계의 `DistanceBeacon` 또는 `TransitGuidePanel`)이 한 컴포넌트 안에 있다. 단계 패널은 단계가 바뀔 때 갈아 끼워진다(앞 세션은 이미 끝났으므로 언마운트는 자원 회수뿐).
- 세션 단일성은 기존 `guide-session-store`(claim/release) 그대로다. 여정 사이 상태(준비·실패)는 세션이 없으므로 다른 안내 시작이 그 사이에 끼어들 수 있는데, 끼어들면 그 시작이 여정과 무관한 세션을 claim한다 — 여정은 **다른 세션의 시작을 감지하면 끝난다**: 사이 상태 동안 `JourneyGuide`가 store에 자기 stop 함수를 claim해 둔다(사이 상태도 "안내 중"이다 — 유휴 리셋 예외·목적지 편집 무효화 `stopActiveGuideSession`이 여정을 끝낸다).
- **순서 계약(구현 리뷰 B1·M3, 통합 테스트 `JourneyGuide.integration.test.tsx`)**: ① 전이 함수는 `stateRef`를 다른 무엇보다 먼저 커밋한다 — 웹 `useRouteGuide.stop()`은 저장소를 놓기 **전에** `onSessionEnd("ended")`를 불러, 늦게 커밋하면 같은 token의 재진입 사건이 무한 재귀를 만든다(첫 구현의 실결함). ② 사이 상태의 claim은 전이 함수가 아니라 **부모 effect**가 한다 — 앞 단계 패널의 언마운트 정리(그 세션의 release)가 부모 effect보다 먼저 돈다. 그 effect에서 저장소를 남(자기 점유가 아닌 것, `isGuideSessionOwner`)이 쥐고 있으면 다른 안내 시작이 이 단계를 끊은 것이라 여정을 끝낸다. ③ 단계를 시작하는 전이는 claim을 전이 함수 안에서 동기로 놓는다(자식 패널의 자동 시작 claim이 부모 effect보다 먼저 돈다). iOS의 `isOccupied`(외부 시작 거부)와 방향은 반대지만(웹은 claim이 앞 소유자를 멈추는 규칙) "여정과 다른 세션이 동시에 살지 않는다"는 불변식은 같다.
- 여정 중엔 결과 섹션을 강제로 펼친 채 둔다(접힘·언마운트가 세션을 죽이는 경로 차단 — 도보 줄·대중교통 대안 선례).

### 7.2 전이 표

`journey-step.ts`는 Kit `journeyStep`의 1:1 미러(같은 단계·사건·결과, `token` 불일치 무시, `.next`는 seq + 1). 공유 fixture `journey-step-cases.json`을 웹 vitest와 Kit `JourneyStepSharedTests`가 함께 읽는다. 여정 id는 `crypto.randomUUID()` 대신 단조 증가 정수 문자열(웹엔 동시 여정이 없다 — 세대 구분만 있으면 된다).

### 7.3 단계 세션 종료 사유 매핑

웹 `useRouteGuide`의 `onSessionEnd`는 `"arrived" | "ended"` 둘뿐이라 iOS `EndReason` 넷으로 펴야 한다:

| 웹 신호 | 사건 |
|---|---|
| `onSessionEnd("arrived")` | `stageEnded(arrived)` |
| 패널 [안내 중지]를 누른 뒤의 `"ended"` | `stageEnded(userStopped)` — `DistanceBeacon`에 새 `onUserStop` prop(사용자가 누른 중지 직전 1회)을 두고 그 직후의 `"ended"`를 사용자 중지로 읽는다 |
| 그 밖의 `"ended"`(탭 숨김·다른 세션 claim·이탈 정리) | `stageEnded(ended)` |
| 위치 권한 거부·미지원 | 첫 fix 전이면 `stageEnded(startFailed)`, fix를 받은 뒤면 `stageEnded(ended)` — `useRouteGuide`의 새 `onFailure` 옵션(이 전이는 `onSessionEnd`를 부르지 않는다). ⚠ 축은 첫 fix 수신(`lastFixRef`)이다 — `status`는 시작 순간 동기로 `tracking`이 되어 표시 상태로는 가를 수 없다(구현 리뷰 M2) |

대중교통 단계: `useTransitGuide`에 옵트인 두 콜백을 더한다 — `onRideCompleted`(완료 `done` 갈래 한 자리에서 정확히 한 번, 말미 도보 인계 `doneHandoff` 대신) · `onStopped`(그 밖의 세션 종료 = `transitStopped`). 둘 다 미지정이면 종전 동작 바이트 동일. B를 지정하지 않은 여정은 `onRideCompleted`를 걸지 않고 기존 말미 도보 인계(목적지까지)를 그대로 쓴다 — 그 끝(사용자 중지·완료)이 곧 여정 끝이다.

### 7.4 단계별 패널

- **taxiIn**: `DistanceBeacon kind="car" autoStart`(목적지 = 승차 지점, 라벨 = 「{역}역」 또는 정류장 이름) + [자동차에서 내렸어요](`taxiDropped`). 도착 문장은 새 `arrivalText` 옵션으로 `journey.arrivedStation`/`arrivedStop`(기본 「목적지에 도착했습니다」는 여정이 끝난 것처럼 들린다).
- **access**: `DistanceBeacon kind="walk" autoStart`(목적지 = 승차 지점) + 승차 전 도보 선례의 선언 버튼 「{역} 도착」(`prewalkArrivedButtonLine` — 지하로 먼저 들어가 도착 판정이 닿지 않을 때의 탈출구, 누르면 `stageEnded(arrived)`). 도착 문장은 승차 전 도보 선례 `transitGuide.prewalkArrived`(「승차역 {station}에 도착했습니다.」 — iOS `markPrewalk`와 같은 문장, 정류장에도 「승차역」은 BACKLOG E70 편승 그대로).
- **transit**: `TransitGuidePanel autoStart`(새 prop — 마운트 뒤 1회 시작, 승차 전 도보 대상이 있으면 그 갈래부터) + 위 두 콜백. B 지정이면 `dest` 없음(말미 도보 인계 없음, 마지막 leg 버튼은 기존 「다음 구간」 — 판정 24).
- **egress**: `DistanceBeacon kind="walk" autoStart`(목적지 = 고른 출구·승강장, 라벨 = 카카오 POI 이름 — D8) + [자동차에 탔어요](`taxiBoarded`). 도착 문장 `arrivedExit`/`arrivedStand`.
- **taxiOut**: `DistanceBeacon kind="car" autoStart`(목적지 = 도착지). 끝나면(어떤 사유든) 여정 끝.
- **사이 상태**: 상태 문장 한 줄(`directions.loading` — iOS와 같은 키) + [안내 중지](`userEnded`). 600ms 인계 지연(`JOURNEY_HANDOFF_DELAY_MS`) 뒤 `prepared`. access 준비는 위치 스토어 스냅샷(캐시 우선, 새 측위 없음 — 원 spec §6.3)으로 승차 지점까지 30m 판정, 좌표가 없으면 걷기 안내를 시작한다. ⚠ 웹 안내 세션의 fix는 위치 스토어에 쓰이지 않아 이 스냅숏은 대개 택시를 타기 전 좌표다 — 생략은 거의 일어나지 않고 늘 걷기 안내 쪽으로 안전하게 떨어진다(iOS "인계 시점 위치"와의 차이, 구현 리뷰 m7). 실보행에서 30m 안 하차가 잦으면 택시 세션의 마지막 fix를 넘기는 쪽으로 고친다. 준비가 30초를 넘기면 `staleTimeout`.
- **실패**: 상태 문장(`journey.egressStartFailed` / `journey.taxiOutFailed` / `route.transit.error` — iOS `journeyStatusText`) + [경로 다시 조회](`guide.rerouteButton`, egress 시작 실패만 없음) + 단계 버튼(taxiIn이면 [자동차에서 내렸어요], egress면 [자동차에 탔어요]) + [안내 중지]. 실패 진입은 버튼이 새로 생기는 전이라 상태 문장으로 포커스를 옮긴다. 실패 버튼은 누르면 자기가 사라지므로 상태 문장으로 먼저 옮긴 뒤 전이한다.
- 접근 도보 시작 실패(판정 27)의 다리 문장: 웹 도보 패널은 원인(`beacon.denied` 등)을 이미 창구에 냈다. 여정은 그 뒤 다리 문장 `transitGuide.prewalkUnavailable`(「도보 안내를 시작할 수 없어 승차 대기로 바로 넘어갑니다.」 — 승차 전 도보 선례 키)만 따로 게시하고, 대중교통 시작을 600ms가 아니라 `JOURNEY_BRIDGE_DELAY_MS`(2.5초) 뒤로 미룬다. iOS는 통지 끝을 기다리지만(`announcementsSettled`) 웹 live region은 낭독 끝을 알 수 없어, 다음 게시가 다리 문장을 끊지 않을 최소 여유를 고정값으로 둔다. 그래서 `journey.accessFailedWith`(원인 + 다리 한 문장) 키는 웹에 없다.
- 통지·창구: 모든 단계 패널은 화면 창구(`announce`) 하나에 게시한다(A40). 단계 사이에 새 문장을 더하지 않는다(뻔한 꼬리 금지) — 다음 세션 시작 통지가 전환을 말한다. 택시 자동 도착만 도착 문장이 그 앞에 온다(`arrivalText`).

### 7.5 웹만의 한계(적어 두는 것)

- 백그라운드: 웹은 탭이 숨으면 안내가 끝난다(기존 웹 안내와 같다 — `"ended"` → 실패 시트, 돌아와 [경로 다시 조회]). iOS의 keep-alive·백그라운드 폴은 없다.
- 운전자 모드 무시(D10)는 웹에 운전자 모드가 없어 자동 성립.
- **웹 자동차 안내엔 `carArrivalStep`(40m·정지·정확도 30m) 확정 도착이 없다**: 웹 `useRouteGuide`의 자동 도착은 최종 접근 기하가 있을 때의 도보 판정(15m)뿐이고, 기하가 없으면 간략 모드로 끝까지 간다. 그래서 웹 택시 단계의 주 인계 수단은 [자동차에서 내렸어요] 버튼이다(판정 8 "자동 + 버튼, 먼저 오는 쪽"의 버튼 쪽). 자동 인계를 웹에도 세우는 일은 웹 자동차 확정 도착(B1 계열) 이식과 함께다 — BACKLOG §2 E70 ⑩ 관찰.
- 대중교통 단계의 시작 통지는 하차 쪽 지정 여정에서 하차역(「{역}역」·정류장 이름)을 목적지로 싣는다 — `dest` 없이(말미 도보 인계 없이) `TransitGuidePanel`의 새 `destinationLabel` prop으로(iOS와 같다, 구현 리뷰 m8). 끝난 여정의 남은 대중교통 패널은 자체 트리거를 숨긴다(`showTrigger={false}`, m9 — 여정의 [안내 시작]과 다른 것을 시작한다).

## 8. 문안

웹 키는 `journey.*`(messages 6로케일). ko 문장은 iOS `ios.journey.*`와 **글자 하나까지 같다**(같은 앱의 두 창구가 다른 말을 하지 않는다 — 가드 `journey-web-copy.test.ts`가 대응 키를 대조한다). 비-ko 로케일 문장은 키 집합 게이트용 번역이고 화면에 나오지 않는다(§2 ko 게이트).

## 9. 첫 판 밖

E71(지금 탄 열차) · `?dir=` 역 칸 복원 · WebMCP 여정 · en · 역 칸 음성 입력 · 칸별 삭제 버튼 · 안드로이드.

## 10. 검증

- 순수: `journey-step.test.ts`(공유 fixture 전수 + 낡은 token + 경쟁), `journey-lines.test.ts`(제목·못 찾음·합계·출구 줄·노선 머리말·최근 경로 줄), `recent-searches` 역 필드 왕복·구버전 디코딩.
- 컴포넌트(jsdom): 입력 메뉴·D14 배타·역만 후보·지우기 포커스, 여정 조회 분기(일반 수단 fetch 0회), 결과 읽기 순서, 이어 안내 전이(택시 도착 → 접근 도보/대중교통, 출구 도보 → 택시, 사용자 중지 = 여정 끝).
- 기존 동작 바이트 동일: 게이트 거짓이면 종전 경유지 버튼, `useTransitGuide`·`DistanceBeacon`·`useRouteGuide` 새 옵션 미지정 시 종전 테스트 전부 통과.
- 실보행·실차: §2 E70 행에 "웹" 관찰을 더한다(웹 실시간 안내 자체가 실보행 미검증 — B6과 같은 축).

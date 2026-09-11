# 대중교통 안내 시트: 컨트롤 착지 실패 수정·지하철역 → 장소 상세 설계 (A35 · E33)

> 2026-09-11, transit-3 세션(웨이브 3, transit-2 통합 `e213e55d` 위). 판정 정본은 `docs/BACKLOG.md` §1 A35·§5 E33. 실험판 봉인 안이며 서버 변경 없음. 착지 정본 시퀀스는 `docs/PATTERNS.md` "iOS 목록 포커스 이동", 시트 수명·표시 계약은 N1 spec `2026-08-22-guide-session-minimize-design.md`, 안내 시트의 장소 상세 진입 선례는 `2026-08-12-guide-destination-menu-design.md` §2.
>
> **설계 리뷰 판정**: 필수(A35는 안전·정확성 축 — SR 사용자가 국면 전이 뒤 커서를 잃는 결함의 재수정이고, E33은 표현 계층 선택). 1회 적대적 리뷰(§9) 뒤 구현. 리뷰 지시문에 "진단 자체가 틀렸다면 그렇게 말하라"를 넣었다 — 이 문서 §1.1이 그 진단이다.

## 1. 문제 (판정 원문 요지 + 이 세션의 진단)

### 1.1 A35 — 컨트롤 착지가 실기기에서 대부분 실패한다

**판정 원문**: 09-05·09-09 두 세션 합계 `reboardPrompt` 1/6 · `changeBoarding` 1/5 · `advance` 3/7 · `waitingLabel` 4/7 · `confirmBoarded` 5/6. 실패는 `actual=nil`과 `actual=minimize`·`title` 둘 다. 갈림(상단 근처 `confirmBoarded`만 안정)이 **오프스크린 AX 컬링**을 가리킨다고 봤다.

**이 세션의 진단(로그 전수 45행, `~/gildongmu-private/field-logs/transit-guide-diag-2026-08-*.log`·`-09-09.log`)**: 컬링은 원인의 일부이고 **전부가 아니다**. 컬링으로 설명되지 않는 실패가 로그에 있다.

| 관측 | 컬링 가설과의 관계 |
|---|---|
| `title landed=false actual=nil`(09-09 07:11:30, 시트 열림 직후) · `minimize landed=false actual=nil`(07:19:46) · `minimize landed=false actual=title`(09:51:45) | 제목·접기는 **섹션 헤더**라 항상 화면 안이다(sticky). 컬링될 수 없는 대상이 실패했다 — 셋 모두 **시트 등장 순간**의 시도다. |
| `changeBoarding landed=false actual=title`(07:40:32·10:08:08) · `advance landed=false actual=minimize`(07:49:59) · `minimize → title`(09:51:45) | 대입 뒤 커서가 **헤더로 되돌아갔다**. 컬링(무이동)이 아니라 **VoiceOver의 자체 재배치**다. 설계 리뷰(D2)가 전수로 좁혔다: `actual`이 nil이 아닌 실패 4건은 **전부 직전 `scene phase=active`(전경 복귀) 14초 이내**이고 그 창 밖엔 한 건도 없다. 즉 트리거는 "컨트롤 소멸" 일반이 아니라 **프레젠테이션 또는 전경 복귀의 screen-changed**이며, 그 처리가 우리 대입(400ms) **뒤에** 오면 대입이 덮인다. |
| `confirmBoarded` 5/6 안정 | 대기 목록(긴 목록)이 사라지고 두 버튼만 남는 전이라 VO 재배치가 빨리 끝나고 대상이 첫 화면 안 — 두 원인을 다 비켜간다. |
| `reboardPrompt` 1/6 | 착지 트리거가 그 헤딩 자체의 `.task`라 **헤딩이 실현되지 않으면 시도 자체가 없다** — 로그에 남은 6건은 전부 실현된 상태의 시도이므로 실제 성공률은 1/6보다 나쁘다(표본 편향, 설계 리뷰 D3). |

⚠ **`actual=nil`은 뜻이 둘이다**(설계 리뷰 D1): `focusedControl`은 착지 대상 11개에만 붙은 바인딩이라, 커서가 바인딩 없는 요소(진행 상황 버튼·상태 문장·경유역 행·중지·급행 예/아니오·후보 행)에 있으면 대입 성공 여부와 무관하게 nil이다. 실패 20건 중 16건이 nil이므로 **"컬링으로 대입이 되돌아갔다"는 로그로 확인된 사실이 아니라 가설**이고, 이번 계측의 `vo=`(실제 VO 커서 요소 라벨)가 그것을 판정한다.

즉 실패 기제는 셋이다: ①**컬링**(가설 — 대상이 AX 트리에 없어 대입이 되돌아감) ②**VO 재배치 경합**(확인 — 프레젠테이션·전경 복귀 직후 screen-changed가 헤더로 옮김) ③**트리거 결손**(확인 — 대상 뷰의 `.task`가 착지를 부르는 구조). 현행 헬퍼는 ①만 겨냥했고(가시화 → 400ms → 대입 → 600ms 검증 → 1회 재시도) ②③에는 대책이 없다. **판정 원문의 "착수 시 봐야 할 자리" 넷은 전부 맞다**(재시도 1회·고정 지연·대상 미렌더 가능성·`scrollTo` 누락·`onMiss` 한 곳) — 거기에 ②③을 더한 것이 이 진단이다.

**반증한 대안 기제(설계 리뷰)**: 같은 값 대입 no-op(실패 시 `focusedControl`은 항상 다른 값이라 성립 안 함) · 헤더 행 객체 병합(`GuideTitleRow`는 `HStack`뿐) · `@State` Task 소실(로그 44행이 시퀀스 끝까지 도달). 지지된 것: 시트 presentation 애니메이션 중 대입(시트 `.task` 실패 3건 전부 등장 시점).

`scrollTo` 누락은 확인했다: `scrollTo(_:_:)`가 `.title·.minimize·.advance·.changeBoarding·.confirmBoarded`를 `default: break`("섹션 상단 버튼들은 List 첫 화면 안이라 가시화 불필요")로 건너뛴다. 그 전제가 거짓이다 — `advance`·`changeBoarding`은 진행 상황 버튼·상태 문장·경유역 목록(펼침 시 수십 행) **뒤**에 선다.

### 1.2 E33 — 안내 시트의 지하철역을 장소 상세로 연다

**판정 원문**(위원장 2026-09-09): "대중교통 실시간 안내 시트에서 나오는 지하철역은 모두 장소상세 연결되어야 함." 현행 경유역 목록(`viaStopsRows`)·상태 문장의 역명은 전부 `Text`다.

**표현 계층 전제에 대한 정정**: 착수 프롬프트·백로그는 "시트 위 시트 금지(N1 설계 리뷰 기각)"를 전제로 NavigationStack push를 강한 디폴트로 잡았다. **그 전제는 N1 M3의 뜻과 다르다.** N1 M3가 기각한 것은 **장소 상세가 이미 시트로 떠 있는 상태(채팅·내 주변 경로)에서 루트 안내 시트를 자동으로 올리는 것**이다(`2026-08-22-guide-session-minimize-design.md` §리뷰 M3: "장소 상세가 시트일 때 루트 시트 presentation 거부 → 자동 올림 폐기"). 반대 방향 — **안내 시트 위에 장소 상세를 중첩 시트로 올리는 것** — 은 `2026-08-12-guide-destination-menu-design.md` §2가 "표준 중첩 시트, 안내 신호 유지"로 채택했고 지금 두 안내 시트 모두에서 돌고 있다(제목 메뉴 "장소 상세 보기" → `showPlaceDetail` → `.sheet(isPresented:)` → `PlaceDetailView`). 진행 상황 조망(`overviewAdapter`)도 안내 시트 위 시트이고, 그 조망은 다시 하위 시트(`subsheet`)를 연다. 즉 이 시트에서 "시트 위 시트"는 금지가 아니라 **현행 정본**이다.

## 2. 범위

**한다**: ①A35 — `TransitTrackingSheet.landControlFocus` 재설계(§4.1) + 계측(§4.5) + 소스 가드. ②E33 — iOS 경유역 행·상태 문장 → 장소 상세(§4.2), Kit 순수 투영·언급 판정 + 테스트. ③판정 회수 행(BACKLOG §2·FIELD-TEST §5).

**하지 않는다**(근거):
- **웹 미러(경유역 행 연결)**. 착수 프롬프트는 "웹은 경유역 목록 행만 연결"로 잡았지만 **연결하면 안내가 조용히 끝난다**: 웹 대중교통 세션은 `TransitGuidePanel`(`DirectionsView` 안) 컴포넌트 수명이고, `requestOpenPlace`를 받는 `PlaceSearch`는 `setDirections(null)`로 길찾기 뷰를 언마운트해 상세를 연다 → `useTransitGuide`의 언마운트 정리가 **`stopSession()`**(상태·타이머 해제)과 `releaseGuideSession`을 부른다(통지·정지 톤 없음 — 주석 "언마운트 전이의 통지는 뷰 몫"). 역 정보를 보려다 안내를 잃는 경로를 만들 수 없다. 검토한 대안: 길찾기 뷰를 언마운트하지 않는 **오버레이 표현**(범용 채팅 오버레이 동형)이면 세션이 살지만 새 표현 경로 하나가 필요하고 웹 배포가 09-22까지 동결이라 이번엔 열지 않는다(설계 리뷰 W2). 산문 미연결(B8)과 함께 BACKLOG E33 잔여로 남긴다. 웹 코드 변경은 descriptor 키 목록 미러(`openStation`, 소비자 0)만.
- 버스 정류장 → 장소 상세. 판정 원문이 "지하철역"이고, 정류장 Place는 역 섹션(시설·도착편·시간표)이 없어 상세의 정보량이 좌표 주변 섹션뿐이다. 버스 leg의 행·문장은 종전 `Text`.
- 시트의 다른 역명 세 자리(설계 리뷰 B1 — 판정 원문 "모두"와의 거리, 근거를 여기 적는다): **역 선택 화면의 역 행**은 이미 "지금 여기 있다"는 답 버튼이라 상세 열기를 겸할 수 없다(한 버튼 두 역할은 봉인·라벨 계약을 깬다) / **주변 확인 섹션 헤더** "{역} 주변"은 헤딩이 발견 경로(헌장 §3)라 버튼으로 바꾸면 헤딩 로터에서 사라지고, 그 역은 경유역 행에 이미 있다 / **빠른하차 줄**의 하차역도 경유역 행(하차 역할)이 같은 곳을 연다. 같은 역에 진입점을 둘 두지 않는다(미니멀리즘).
- 후보 목록·목적지 전환 후보의 착지(`focusedCandidate`·`focusedDestChangeRoute`, `landFirstDestChangeRouteFocus`). A35 표에 없고 판정 근거(`landed=`) 로그가 없다 — 이번엔 손대지 않고 §7에 관찰 항목만.
- `BeaconTrackingSheet`·`SurroundingsSceneSection`의 착지(도보 시트는 별도 헬퍼). 단 §8 관찰 하나를 보고한다.

## 3. 현행 계약 중 이 설계가 딛는 것 (코드로 확인)

- 착지 대상은 옵셔널 단일 `@AccessibilityFocusState var focusedControl: SheetControl?`(A19, Bool 다중 바인딩 금지 정본). 후보·경로 목록은 정체성 바인딩 2개가 따로 있고 착지 시작 시 nil로 놓는다(설계 리뷰 M7).
- `landControlFocus`는 `controlFocusTask` 하나를 latest-wins로 소유하고, 국면 전이 `onChange(of: phase)`가 먼저 취소한다(M8). `controlExists(target)`가 지연 뒤 국면 재검증을 한다.
- 착지 트리거 자리: 시트 `.task`(title/minimize) · `onChange(of: phase)` → `phaseTransitionLanding` · 버튼 핸들러(취소 복귀·급행 프롬프트·목적지 전환) · 대기 라벨 `onChange(of: rows)` 소실 복귀 · **역 선택 헤딩 자체의 `.task`**(reboardPrompt) · 조망 `onDismiss` `pendingFollowUp`.
- `onMiss` 폴백은 `expressBlocked` 한 곳(`announceExpressBlockedFallback`, `.high`). 다른 대상은 실패 시 침묵.
- 계측: `transitGuideLog("controlFocus target= landed= actual=")` 1줄, 시도 수·지연·사유 없음. `TransitGuideDiag`는 `#if DEBUG || EXPERIMENTAL`, 파일 싱크 `DiagFileLog.transitGuide`.
- `TransitGuideModel.touchUserAction()`은 private이고 모든 사용자 입력이 부른다(E36 유휴 정지 축). 통지 창구 `announce`(지연)·`announceNow`(즉시)는 private, 시트가 쓰는 공개 창구는 `announceExternal`(지연)·`announceExpressBlockedFallback`(즉시 `.high`).
- 장소 상세 진입: `showPlaceDetail: Bool` + `detailDest: BeaconDest?`(루트가 `transit.dest`를 넘김) → `.sheet(isPresented:)` 안 `NavigationStack { PlaceDetailView(place: guideDestinationPlace(dest:label:), showsDirectionsEntry: false) }`. `PlaceDetailView`는 `isStation(place)`(카테고리 정규식 `지하철|전철|철도|기차|Subway|Metro|Railway|Train` 또는 이름 접미 "역"/"station")일 때 역 섹션 4종을 `place.name`으로 조회한다 — **`name`은 조인 키(한국어)**다.
- 채팅 산문 선례(`ChatConversationView.blockView`, 위원장 판정 2026-08-17): 장소 언급 0개 평문 / 1개 블록 전체 `Button(.plain)` / 2개 이상 인라인 링크 + `.accessibilityActions`(역순 선언 — 로터 노출이 빌더 역순). 판정은 Kit `chatPlaceMentions(in:places:)`(긴 이름 우선 마스킹·첫 등장 순·동명 1회).
- 경유역 한 줄은 `transitViaStopLine(isEn:stop:role:here:exit:)` → `TransitTextLine` → `TransitGuideTextRenderer.render` 단일 `Text`. `display.stops`는 `leg.viaStops.map(stopLabel)`이라 **인덱스가 1:1**이다. 상태 문장은 `model.statusLineText(state:leg:)` → `distanceText`(단일 `Text` + 거리 단위 낭독 정정 라벨).
- `TransitLegStop`은 `name`(ko 조인)·`nameEn`·`stationId`·`lat`·`lng`를 갖는다.

## 4. 설계

### 4.1 A35 — 착지 헬퍼 재설계: "실현 관측 → 대입 → 늦은 검증 → 체증 재시도 → 실패 폴백"

세 기제에 하나씩 대응한다.

**① 컬링 → 가시화 전수 + 실현 관측.**
- `scrollTo`의 `default: break`를 없애고 **모든 `SheetControl`에 `.id`를 주어 전수 `scrollTo`**한다 — id는 case 이름 보간(`"transit-control-\(control)"`)이라 새 대상의 누락 자체가 성립하지 않는다(초안의 "exhaustive switch"보다 강하다, 구현 리뷰 spec m2).
- 착지 대상 뷰는 전부 한 헬퍼 `landingTarget(_:_:)`로 감싼다: `.accessibilityFocused($focusedControl, equals:)` + `.id(controlId)` + `.onAppear { rendered.insert }` / `.onDisappear { rendered.remove }`. `rendered: Set<SheetControl>`이 **"그 대상이 지금 List에 실현되어 있는가"**의 관측값이다(List는 lazy라 onAppear = 실현·AX 트리 진입, onDisappear = 회수·컬링). ⚠ `.accessibilityFocused($focusedControl` 원시 호출은 헬퍼 안 1곳만 — 소스 가드(§6).
- 대입 전 고정 400ms 대신 **`rendered.contains(target)`을 50ms 간격으로 최대 500ms 기다린다**(실현되면 즉시 진행). 실현되지 않으면 그 시도의 사유는 `notRendered`. ⚠ **아직 없는 id에 `scrollTo`는 조용히 무효**라(설계 리뷰 L1 — ③이 트리거를 실현 이전으로 옮겼으므로 이제 흔한 경우다) 대기 루프 안에서 150ms마다, 실현 직후 한 번 더 `scrollTo`한다.
- `rendered`는 **관찰 대상이 아닌 참조 상자 + 카운트**다(L2·L3): `@State Set`이면 스와이프로 행이 실현 창을 드나들 때마다 시트 전체가 재렌더돼 고치려는 결함과 같은 계열이 되고, Set이면 같은 대상이 뷰 둘로 교체될 때(전환 상태 3형·픽커 두 호출부) onAppear/onDisappear 순서 역전으로 화면에 있는데 빠진다.

**② VO 재배치 경합 → 늦은 검증 + 체증 재시도.**
- 시도는 최대 3회(현행 2회). 대입 뒤 검증 지연은 600 → 900 → 1200ms로 **체증**(고정 600ms 1회 검증은 VO 재배치가 그 뒤에 오면 못 본다). 각 재시도는 `scrollTo`부터 다시 한다(현행 재시도도 그렇다).
- 검증에서 `focusedControl == target`이면 종료(`ok`). 대상이 실현됐는데도 다르면 사유 `stolen`(대입은 먹었는데 VO가 옮겼거나 대입이 되돌아간 경우 — 둘의 구분은 `vo=` 라벨이 한다, §4.5).
- 검증 지연은 100ms 단위로 본다(L6): 착지가 확정되면 조기 종료하고, `controlExists(target)`가 거짓이 되면 그 시점에 `vanished`(국면 밖 조건 `aboardStep`·`expressPromptActive`의 변화는 `onChange(of: phase)`의 취소를 타지 않는다).
- 상한: 최악 3×(500+1200) ≈ 5.1초, 착지 확정 시 그 자리에서 끝난다(실측 기대치 1초 안팎). 국면 전이·새 착지가 즉시 취소한다(현행 계약).
- **배경·모달 위에선 시도하지 않는다**(L4 + 구현 리뷰 M1·A1·A2): E36으로 국면 전이가 배경에서도 나므로 그대로 두면 VO 커서가 없는 배경에서 3회 전부 실패해 `landed=false`가 판정 축을 오염시키고 폴백이 `missedAnnouncement`를 세운다. 장소 상세·목적지 검색 시트가 떠 있을 때도 같다(커서가 모달 안이라 대입이 먹어도 `stolen`으로 끝나고 폴백만 사용자의 상세 낭독을 끊는다 — E33이 이 빈도를 올린다). 헬퍼 진입에서 배경이면 `reason=background`, 모달이면 `reason=modal`로 대상을 `deferredLanding`에 적고(`deferred=true`), 전경 복귀(`scenePhase == .active`)·상세 `onDismiss`·검색 시트 닫힘에 한 번 착지한다(`note=deferred`, latest-wins). **진행 중** 착지도 배경 전환(`scenePhase == .background`)이 끊고 이월하며(`landingInFlight`), 시트 최소화(N1 콘텐츠 뷰 파괴)는 List `onDisappear`가 Task를 끊는다(고아 Task의 폴백 낭독 차단). 게시 직전에도 전경을 재확인한다. 조망(`overviewAdapter`)은 자기 `pendingFollowUp` 계약 그대로.
- `controlExists`는 `phaseControls`의 바깥 분기까지 본다(M3): `untrackable` 국면엔 `.advance`·`.waitingLabel` 대상이 없고(수동 전진 버튼은 바인딩 없음), 지방버스 leg엔 `.waitingLabel`이 없다 — 종전엔 참을 내 그 화면에 없는 문장을 폴백으로 낭독할 경로였다.
- 폴백 여부는 `outcome`으로 가른다(`ok`·`vanished`는 침묵, `landed` 재계산과 어긋날 수 있다 — m3). 취소된 시도도 `reason=cancelled attempts=`로 남긴다(m1 — 무기록이면 표본 편향). 빈 폴백 문장은 `skipped=emptyText`.

**③ 트리거 결손 → 착지는 상태 변화가 부른다, 대상 뷰가 아니다.**
- `stationPicker` 헤딩의 `.task { landControlFocus(.reboardPrompt) }`를 지우고, List 수준 `.onChange(of: model.reboardPickerActive)`·`.onChange(of: model.aboardStep)`에서 픽커가 열리는 전이(`false→true`, `nil|pickVehicle → pickStation`)에 `.reboardPrompt` 착지를 건다. 조망 `pendingFollowUp(.beginReboard)`의 "지하철은 프롬프트의 `.task`가 맡는다" 주석도 같은 자리로 바뀐다(동작은 `beginReboard()`가 `reboardPickerActive`를 올리므로 그대로 성립).
- 다른 트리거(시트 `.task`·국면 전이·버튼 핸들러·라벨 소실·조망 onDismiss)는 이미 상태·행동 자리라 그대로.

**실패 폴백(전 대상)**: `onMiss` 매개변수를 없애고 **모든 대상이 실패 시 그 자리의 착지 낭독 문장을 `.high`로 통지**한다(헌장 §5 — 착지 못 하면 통지가 유일한 증거, `PATTERNS` 통지 우선순위 판별선). 문장은 `landingFallbackText(target)` 한 함수(exhaustive switch):

| 대상 | 문장(착지했다면 VO가 읽었을 라벨) |
|---|---|
| `.title` | `joinText(beacon.transitHeading, destinationLabel)` |
| `.minimize` | `guide.minimize` |
| `.advance` | `handoffNow ? transitGuide.walkHandoffStart : transitGuide.advance` |
| `.changeBoarding` | `transitGuide.changeBoarding` |
| `.confirmBoarded` | `transitGuide.confirmBoarded` |
| `.waitingLabel` | `aboardStep == .pickVehicle ? waitingLabelAboard : waitingLabel` |
| `.reboardPrompt` | riding 픽커면 `reboardStationPrompt`, waiting pickStation이면 `aboardStationPrompt` |
| `.boardAlready` | `transitGuide.boardAlready` |
| `.expressPrompt` | `transitGuide.expressPrompt` |
| `.expressBlocked` | `model.expressBlockedNote`(종전 폴백과 같다) |
| `.destChangeStatus` | `pendingDestChange.phase`별 상태 문장(loading/none/error) |

통지는 모델 창구를 지난다: `announceExpressBlockedFallback()`을 일반화한 **`announceLandingFallback(_ text: String)`**(즉시 `.high`, `announceNow`). 시트가 `AccessibilityNotification`을 직접 게시하지 않는다(CLAUDE.md "새 통지 경로는 `announce` 창구"). 빈 문장이면 통지하지 않는다.

**⚠ 이중 낭독과 간섭**: ①바인딩 읽기가 늦어 "실제로는 착지했는데 `landed=false`"이면 라벨이 두 번 들린다 — `vo=`(실제 VO 커서 요소 라벨, 40자 절단)가 **비어 있지 않고 폴백 문장의 같은 40자 절단과 같을 때만** 폴백을 내지 않고 `landingFallback … skipped=voMatchesLabel`로 남긴다(L5 일부; 접두 비교·빈 라벨은 무관한 요소에서 침묵을 만든다 — 구현 리뷰 spec M1·a11y A4). ②**사용자가 스스로 다른 줄을 읽고 있는 동안**(최악 5초 뒤) `.high` 폴백이 그 낭독을 끊을 수 있다(설계 리뷰 L5). 가드를 두지 않은 근거: "커서가 헤더에 있다"는 관측은 VO 재배치(A35의 주 실패 모드)와 사용자 이동을 구분하지 못하므로, 그것으로 억제하면 A35가 잡으려는 바로 그 실패에서 폴백이 사라진다. 대신 §7 첫 항목으로 올려 실승차 첫 세션에서 간섭 체감을 **먼저** 묻고, 잦으면 우선순위를 기본값으로 내리는 후속.

**불변**: 옵셔널 단일 바인딩 · 경합 바인딩 해제 순서 · `controlFocusTask` latest-wins · `phaseTransitionLanding` 분기 · `controlExists` 조건 · 조망 `pendingFollowUp` 계약.

### 4.2 E33 — 지하철역 → 장소 상세 (iOS)

**표현 계층(§1.2 정정에 따라)**: **현행 중첩 시트 하나를 일반화한다.** `showPlaceDetail: Bool` + `detailDest`를 **`detailPlace: Place?` + `.sheet(item: $detailPlace)`** 하나로 바꾸고, 제목 메뉴 "장소 상세 보기"는 `detailPlace = guideDestinationPlace(dest:label:)`, 역 행·상태 문장은 `detailPlace = transitStopPlace(stop)`을 넣는다. 시트 안은 종전과 같이 `NavigationStack { PlaceDetailView(place:, showsDirectionsEntry: false) }`.

NavigationStack push(착수 프롬프트의 강한 디폴트)를 고르지 않은 근거:
1. **선례**: 같은 시트의 목적지 상세가 중첩 시트이고 설계 리뷰(2026-08-12 §2)가 채택했다. 두 진입점이 다른 표현을 쓰면 같은 화면(장소 상세)이 열리는 방식이 둘이 된다.
2. **포커스 복원은 시스템이 한다**: 시트를 내리면 iOS가 **표시 직전 포커스 요소**로 VO 커서를 되돌린다(현행 목적지 상세도 복원 코드 0). push/pop은 pop 뒤 루트 첫 요소로 가는 것이 기본이라 "눌렀던 경유역 행으로 복귀"를 우리 착지 헬퍼로 구현해야 한다 — A35가 보여 준 바로 그 취약한 계층 위에 새 착지를 쌓는 일이다.
3. **레이아웃 무변경**: 시트 본문에 NavigationStack을 넣으면 루트에 빈 내비게이션 바가 생겨 숨김 처리가 필요하고(위원장 판정 2026-08-23이 "제목 없는 빈 바"를 이유로 toolbar 배치를 폐기한 자리), 섹션 헤더 sticky·`ScrollViewReader` 가시화 계약을 다시 실측해야 한다.
4. **안내 신호 유지**는 두 방식이 같다(세션·띠바·폴은 모델 소유, 시트 표현과 무관).

최소화 후 검색 탭 경로(2안)는 쓰지 않는다 — 시트가 중첩 시트를 수용하므로 성립 조건이 아니다.

**식별 → Place 투영(Kit `PlaceProjection.swift` — `guideDestinationPlace` 옆, 순수. ⚠ `TransitDisplayProjection.swift`는 "투영에 좌표를 넣지 말 것"이 계약이라 그 파일이 아니다)**: `transitStopPlace(_ stop: TransitLegStop) -> Place`
- `id`: `"transit-stop:" + (stationId ?? "\(lat),\(lng)")` · `name`: **`stop.name`(한국어 조인 키 — `PlaceDetailView`가 `isStation`·역 섹션 조회에 쓴다)** · `nameRoman`: `stop.nameEn`(비-ko 병기 1순위 — `bilingualName(lang:ko:en:roman:)`의 `en` 자리는 Place에 없어 `roman` 슬롯을 쓴다; 표시 전용) · `category`: `"지하철역"`(isStation 정규식 통과, 상세 분류 줄에 그대로 보인다) · `categoryEn`: `"Subway station"` · 주소·전화·링크 nil/빈 값(없는 값을 지어내지 않는다) · `lat`·`lng`.
- 이름 재검색 왕복은 하지 않는다(좌표·이름이 이미 있다).

**경유역 행(`viaStopsRows`)**: `leg.mode == "subway"`인 leg의 각 행은 한 줄에 역이 정확히 1개 → **행 전체를 `Button(.plain)`**(채팅 선례 "1개 = 블록 전체 버튼"). 라벨 뷰는 종전 `Text(render(transitViaStopLine(…)))` 그대로라 한 줄 = 한 객체가 유지되고 VO는 "{역}, 승차/하차/현재 위치, 버튼"으로 읽는다. 행동: `model.touchUserAction()` → `detailPlace = transitStopPlace(leg.viaStops[index])`(display.stops와 인덱스 1:1). 버스 leg는 `Text`.

**상태 문장(`statusRows`)**: 문장 안 역명은 산문이라 채팅 선례를 쓰되 **로터 액션 갈래만** 쓴다(설계 리뷰 E2 반영 — 초안은 "1개면 문장 전체 버튼"이었다). 이 문장은 폴마다 바뀌어 언급 수가 0↔1↔2로 오가고, 뷰 종류가 Button↔Text로 갈리면 포커스가 얹힌 줄이 15초마다 파괴·재생성된다(헌장 §5 위반 경로, 채팅 선례는 정적 산문이라 전제가 다르다). 그래서 뷰는 언제나 같은 `distanceText`이고 **액션 목록만** 바뀐다:
- Kit `transitStationMentions(in text: String, stops: [TransitLegStop]) -> [Int]` — `chatPlaceMentions`와 같은 알고리즘(공용 `mentionOrder(in:names:)`로 추출, 순수 리팩터)으로 stops 인덱스를 첫 등장 순으로 낸다. 대응 축은 **ko·en 라벨 둘 다**(E3): 상태 문장은 조각(문맥·신호·프레임)마다 줄 언어가 따로 정해져 한 문장에 ko·en 조각이 공존하므로, 세션 로케일 하나로 고르면 en 사용자만 링크를 조용히 잃는다.
- `.accessibilityActions { ForEach(mentions.reversed()) { Button(render(transitOpenStationLine(isEn:, station: display.stops[i]))) } }` — 역순 선언 = 등장 순 노출. 언급 0개면 액션 0개(뷰 불변).
- 시각 사용자용 인라인 링크·문장 버튼은 두지 않는다 — 시각·터치 사용자는 경유역 목록 행으로 같은 곳에 간다(정보 정본은 목록). 비-지하철 leg는 판정하지 않는다.

**로터 액션 라벨(E1)**: 문장 계층 descriptor에 키 `openStation`("{station} 상세 보기", `messages/*.json` `transitGuide.openStation` 6로케일 — 채팅 `ios.chat.openPlace`와 동문, 인자 이름은 동류 키와 같은 `station`)을 더하고 `transitOpenStationLine(isEn:station:)`(Kit) ↔ `openStationLine`(웹, 소비자 0·키 목록 미러)이 만든다. 판정은 다른 descriptor와 같다(영문이 없으면 `lang: "ko"`). ⚠ **"라벨 전체가 ko"는 iOS에서 성립하지 않는다**(구현 리뷰 code M4·a11y A3 — 설계 리뷰 E1 채택 문구의 정정): iOS 렌더러는 줄 언어를 `koFallback` 계측에만 쓰고 포맷 문자열은 앱 카탈로그에서 고르므로 en 세션 + 영문 없는 역은 "View details for 천호(풍납토성)"가 된다 — 모든 descriptor 줄의 공통 성질이고 판정 정본은 BACKLOG §2 E28-①(iOS 줄 단위 언어 태깅)이다. 이 spec이 더한 것은 그 규칙을 **우회하지 않는 것**(초안의 ios-extra 전용 키 + `guard:allow` 폐기)이다.

**`PlaceDetailView` 안 채팅 진입(E4 판정)**: `showsChatEntry`는 기본값(표시) **유지**. 목적지 상세가 종전부터 같은 상태이고, 역 상세에서 "이 장소에 관해 물어보기"는 시각장애 사용자에게 실제 가치(엘리베이터·출구 질문)가 있으며 채팅 도구는 좌표 앵커로 돈다(주소가 비어도 성립). 시트 3겹(안내 → 상세 → 채팅)은 현행 목적지 경로와 같은 깊이다.

**`category: "지하철역"`(E5)**: 소스에 없는 값이 분류 줄에 보이는 것을 안다. `isStation`을 이름 접미 "역"에 맡기면 "천호(풍납토성)"처럼 접미 없는 역이 빠지므로 유지. 경전철·광역철도 leg도 `mode == "subway"`면 같은 분류로 보인다(기록).

**사용자 조작 표식**: 역 상세 열기는 `model.touchUserAction()`(private → internal)을 부른다(E36 유휴 시계). 상세를 닫는 것은 표식 없음(시스템 dismiss).

**`PlaceDetailView` 진입**: 시그니처 변경 없음 — `PlaceDetailView(place:, showsDirectionsEntry: false)` 그대로(길찾기 프리필 버튼은 시트 뒤 폼을 조작해 보이지 않는 상태 변화를 만들므로 목적지 상세와 같은 이유로 숨긴다. "여기로 목적지 변경"도 같은 게이트라 숨겨진다 — 경유역을 새 목적지로 삼는 경로는 제목 메뉴 "목적지 바꾸기"가 맡는다).

### 4.3 계측 (§4.5로 이동 — 아래)

### 4.4 문장·키

| 키 | ko | 자리 |
|---|---|---|
| `transitGuide.openStation`(descriptor 키 `openStation`) | `{station} 상세 보기` | 상태 문장 로터 액션 |

6로케일(en "View details for {station}", es "Ver detalles de {station}", fr "Voir les détails de {station}", it "Vedi dettagli di {station}", ja "{station}の詳細を見る" — 채팅 키와 동문, 인자 이름은 `prewalkArrived*`와 같은 `station`). descriptor 키 목록(Kit `transitTextKeys` ↔ 웹 `TRANSIT_TEXT_KEYS`)·인자 표(`transit-text-args.ts`)·렌더러 case·공유 fixture(`transit-guide-text-cases.json` 2행: en 완비·en 결측→ko)에 함께 등록. `arg-order.json`은 신규 키라 자동 등록.

### 4.5 계측 (`TransitGuideDiag`)

- `controlFocus target=<t> landed=<b> actual=<focusedControl|nil> attempts=<1..3> elapsedMs=<n> rendered=<b> reason=<ok|notRendered|stolen|vanished> vo="<실제 VO 포커스 요소 라벨 앞 40자|nil>" [note]` — 한 줄, 시도가 끝났을 때 1회. 배경에서 들어온 착지는 `controlFocus target=<t> reason=background deferred=true`만 남기고 전경 복귀 착지가 `note=deferred`로 따라온다(§7 집계에서 배경 줄은 뺀다). `vo=`는 `UIAccessibility.focusedElement(using: .notificationVoiceOver)`의 `accessibilityLabel`(TransitGuideDiag `transitFocusedLabel()`, 같은 게이트). 다음 로그 회수의 판정 축: `reason` 분포(컬링이면 `notRendered`, 경합이면 `stolen`+`vo=`헤더 라벨), 이중 낭독 의심(`landed=false` ∧ `vo=`가 대상 라벨).
- `reason` 값: `ok|notRendered|stolen|vanished|background|modal|cancelled`. `background`·`modal`은 시도 없이 이월(`deferred=true`), `cancelled`는 국면 전이·새 착지·배경 전환·최소화가 끊은 시도(`attempts=`까지).
- `landingFallback target=<t> text=…` — 폴백 통지가 나간 자리(위 줄 바로 뒤). `skipped=voMatchesLabel`은 VO 커서가 이미 대상 위라 내지 않은 것(바인딩 지연 표본), `skipped=emptyText`·`skipped=background`는 각각 빈 문장·시도 중 배경 전환.
- ⚠ `vo=`와 그 침묵 가드는 `#if DEBUG || EXPERIMENTAL` 안이다(Release엔 `nil` — 폴백이 무조건 발화). 대중교통 안내 졸업 시 이 게이트를 함께 옮긴다(구현 리뷰 spec m4).
- `stationDetail open station=<ko> source=<via|status>`.
- 로그 파일은 커밋하지 않는다(개발자 이동 경로).

## 5. 불변식 점검

| 축 | 결과 |
|---|---|
| 옵셔널 단일 바인딩(A19) | 불변. `landingTarget` 헬퍼가 그 바인딩의 유일한 부착 자리. |
| latest-wins 착지 Task(M8) | 불변. 재시도 루프도 같은 Task 안. |
| 조망 "닫힌 뒤 행동"(E15-1 §4.3) | 불변. `.beginReboard` 후속은 `reboardPickerActive` onChange가 착지를 맡는다(종전 `.task`와 같은 시점 — 픽커가 열리는 그 상태 변화). |
| 통지 창구 단일(§announce) | 폴백은 `announceLandingFallback`(모델 즉시 창구). 시트 직접 게시 0. |
| 통지 우선순위 판별선 | 폴백 `.high`(착지 실패 = 포커스가 의도한 곳에 없고 라벨로 대체될 수 없다). |
| 헌장 §4 한 줄 = 한 객체 | 경유역 행·상태 문장은 단일 `Text`를 그대로 라벨로 쓰는 Button — 분절 0. 인터랙티브와 합치지 않는다(행 하나가 곧 한 인터랙티브). |
| 헌장 §3 발견 경로 | 경유역 목록은 DisclosureGroup(사용자가 펼침) 안 — 헤딩 불필요 그대로. |
| N1 시트 수명·최소화 | 무관(상세는 시트 위 중첩, 세션·띠바·폴 불변). 상세 시트가 열린 채 국면이 바뀌면 착지는 종전 조망과 달리 미루지 않는다 — 착지 대상이 모달 뒤라 `stolen`으로 실패하고 폴백 통지가 난다(조망 §4.3의 F2와 같은 결의 위험). 실기기 관찰 §7; 잦으면 조망과 같은 `pendingFollowUp` 계약으로 후속. |
| E36 유휴 시계 | 역 상세 열기 = 사용자 조작(`touchUserAction`). 착지 재시도는 조작이 아니다(부르지 않는다). |
| `guidance-gate-drift` | 진입점 수 불변(세션 시작 경로 무변경). |
| 개인정보 3자 일치 | 수집·전송 항목 변화 없음(역 상세 조회는 기존 `/api/station/*`). |
| 표시/조인 분리(E27) | `transitStopPlace.name`은 조인(ko) 목적의 의도된 한국어 — `PlaceDetailView`가 조인 키로 소비한다. 표시는 `nameRoman`(en) 경유 `bilingualName`. 로터 액션 라벨은 descriptor(`transitOpenStationLine`)를 지나 줄 원자성을 지킨다 — 초안의 `guard:allow` 우회는 설계 리뷰 E1로 폐기. |
| 헌장 §5 포커스 보존 | 상태 문장 뷰는 폴마다 종류가 바뀌지 않는다(E2). 착지 폴백은 `vanished`·배경·`vo` 일치에서 침묵. |

## 6. 테스트

- **Kit**: `transitStopPlace`(id 규칙 stationId 유무 2형·name=ko·nameRoman=en·category isStation 통과·주소 빈 값) · `transitStationMentions`(ko 1개·2개 등장 순, en 라벨 매칭, 비언급 0, 긴 이름 우선 마스킹 "신촌(경의중앙선)" ⊃ "신촌") · `mentionOrder` 리팩터 뒤 `ChatPlaceMentionsTests` 불변 통과.
- **descriptor**: `openStation` 키 — 공유 fixture 2행(en 완비 / en 결측 → 라벨 전체 ko), 웹 CASES·러너, Kit 러너, 인자 표·키 목록 미러 테스트(`transit-text-args`·`transit-display-guard`).
- **소스 가드**(웹 vitest가 Swift 소스를 읽는 선례 `transit-display-guard.test.ts`) `transit-landing-guard.test.ts`: ①`.accessibilityFocused($focusedControl` 출현 1회(헬퍼 안, appear/disappear 관측 동반) ②`scrollTo(_:_:)` 본문에 `default`·`case` 없음 ③`.task {`·`.onAppear {` 8줄 창 안에 대상 착지 호출 없음(착지는 상태가 부른다) + 픽커 두 onChange 존재 ④`onMiss` 없음·폴백 문장 switch exhaustive ⑤계측 키 전수 + 전경 게이트 + `scenePhase` 복귀 ⑥`rendered`는 참조 카운트 상자 ⑦상태 문장에 Button/switch 없음·`transitOpenStationLine` 경유·`guard:allow` 없음 ⑧`.sheet(item: $detailPlace)` 1회·`openStationDetail`이 `touchUserAction`.
- **뷰 계층은 테스트 레인이 없다** — 판정은 실승차 로그(§7). 시뮬레이터는 VO 착지를 검출하지 못한다(정본 규칙).
- 기존 게이트: `test:run`·`tsc`·`lint`·`swift test`·`xcodebuild Experimental`·i18n(`messages-to-xcstrings`·`check-xcstrings-keys`).

## 7. 실기기·실승차 판정 (BACKLOG §2 표 · FIELD-TEST §5)

- **A35 재판정**(A19 행 되살림): ⓪**첫 세션에서 먼저 묻는 것 — 착지 실패 폴백(`.high`)이 내가 읽고 있던 낭독을 끊었는가**(설계 리뷰 L5: 잦으면 우선순위를 기본값으로 내린다 — 이것이 실패하면 그 세션의 다른 판정도 흐려진다) ①`controlFocus … landed=` 성공률이 표(1/6~5/6)에서 얼마로 움직였는가 — **배경 줄(`reason=background`)은 빼고** 센다(성과 기준: 전 대상 5/6 이상) ②`reason` 분포: `notRendered`가 남으면 컬링 축 재설계(가설 ①이 참으로 승격), `stolen`이 남으면 지연·재시도 상한 재조정, `vo=`가 대상 라벨인데 `landed=false`면 바인딩 읽기 문제(`skipped=voMatchesLabel` 빈도) ③실패 시 폴백 문장이 **한 번** 들렸는가 ④전경 복귀 뒤 `note=deferred` 착지가 맞는 자리였는가.
- **E33 실기기**: ①경유역 행 더블탭 → 역 상세 시트(역 시설·도착편·시간표 섹션이 있는가 = `isStation` 통과) ②**[블로킹] 닫으면 커서가 그 행으로 돌아오는가** — 이 repo에서 확인된 적 없는 전제(설계 리뷰 E8, 목적지 상세도 미확인)이고 중첩 시트를 고른 주된 근거다. 안 되면 후속: `.sheet(item:onDismiss:)`에서 `landControlFocus` 계열의 행 착지(경유역 행에 정체성 바인딩 `focusedViaStop: Int?` 추가) ③상태 문장의 로터에 "○○ 상세 보기"가 등장 순으로 있고 실행이 그 역인가(문장에 역이 1개여도 로터 한 단계 — 소음이면 **문장 액션을 먼저 뺀다**, 정보 정본은 목록 행. 언급 0개일 때 빈 `accessibilityActions`가 로터에 빈 항목을 만드는가도 본다) ④상세가 열린 채 국면이 바뀌었을 때(도착 등) 닫은 뒤 커서·통지가 어땠는가(§5 N1 행) ⑤en 세션에서 상세 제목이 영문 병기이고 역 섹션이 비지 않는가(name=ko 조인); 영문 없는 역의 로터 라벨은 **"View details for 천호(풍납토성)"처럼 혼용되는 것이 현행 계약**이라 그것이 들리는가·영어 음성이 한국어를 삼키는가를 E28-①의 표본으로 적는다 ⑥**ko 세션 + 괄호 있는 역 하나**("천호(풍납토성)"류)에서 역 섹션이 "정보 없음"으로 위장하지 않는가(설계 리뷰 E7, 서버 매핑 미스 축).
- **관찰(범위 밖 기록)**: 후보 목록 착지(`focusedCandidate`) 실패 체감이 있는가 — 있으면 같은 헬퍼로 승격하는 후속 항목.

## 8. 파일

Kit `PlaceProjection.swift`(+`PlaceProjectionTests.swift`, 소유 밖 자진 신고) · `ChatPlaceMentions.swift`(리팩터, 소유 밖 자진 신고) · `TransitGuideText.swift`(+`TransitGuideTextTests.swift`) / iOS `Directions/TransitTrackingSheet.swift`·`Directions/TransitGuideModel.swift`(`touchUserAction`·`isForeground` 공개, `announceLandingFallback`)·`Directions/TransitGuideDiag.swift`(`transitFocusedLabel`)·`Directions/TransitGuideTextRenderer.swift`(case 1) / `messages/*.json` `transitGuide.openStation` + 생성물 `Localizable.xcstrings`·`arg-order.json` / 웹 `src/lib/transit-guide-text.ts`·`transit-text-args.ts`(키 미러)·`src/lib/__tests__/transit-landing-guard.test.ts`(소스 가드)·`transit-guide-text.test.ts`·fixture `transit-guide-text-cases.json` / 문서 `CHANGELOG.md`·`docs/BACKLOG.md`·`docs/FIELD-TEST.md`·`CLAUDE.md`·`docs/PATTERNS.md`·`PROGRESS.md`.

**소유 밖 관찰(보고만, 고치지 않는다)**: `SurroundingsSceneSection`의 장소 행은 `NavigationLink`인데 두 안내 시트(`TransitTrackingSheet`·`BeaconTrackingSheet`)는 시트 안에 NavigationStack이 없다 — 그 자리에서 링크가 동작하지 않을 가능성이 있다(BACKLOG §2 "M1 잔여 — 시트 임베드" 미판정 면과 겹친다). 이 spec이 NavigationStack을 넣지 않는 선택과 무관하게 별건이다.

## 9. 설계 리뷰 판정 (2026-09-11, opus 서브에이전트, spec 초안 `3cf0f31a`)

**판정: §1.2 정정(N1 M3는 반대 방향)은 참, §1.1 진단은 ②③ 참·①은 가설로 강등, MAJOR 8건 전부 채택(L5는 부분).** 보고 정본 `~/gildongmu-wt/reports/transit-3-review-design.md`. ⚠ 절차 위반 하나를 리뷰가 잡았다 — 리뷰 대상 SHA에는 spec만 있었고 구현이 미커밋으로 자라는 중이었다(memory `freeze-artifact-before-review-dispatch`). 구현 리뷰는 전부 커밋한 SHA로 디스패치한다.

| 항목 | 처리 |
|---|---|
| D1 `actual=nil` 두 뜻 → 컬링은 가설 | 채택 — §1.1 문구 강등, `vo=`가 판정(§7 ②). |
| D2 재배치 트리거는 프레젠테이션·전경 복귀 14초 창 | 채택 — §1.1 표에 전수 근거 반영, L4의 근거. |
| D3 reboardPrompt 두 근거 상충 | 채택 — 표본 편향 쪽만. |
| L1 실현 전 `scrollTo` 무효 | 채택 — 대기 루프 150ms마다 + 실현 직후 재가시화. |
| L2 `@State Set` 재렌더 | 채택 — 비관찰 참조 상자 `RenderedControls`. |
| L3 Set 순서 역전 | 채택 — 참조 카운트. |
| L4 배경 착지가 판정 축 오염 | 채택 ⓐ — 전경 게이트 + `deferredLanding` 전경 복귀 착지, `isForeground` 공개. |
| L5 폴백 간섭 가드 | **부분 채택** — `vo` == 라벨이면 침묵(이중 낭독). 사용자 이동 가드는 기각: 헤더 관측은 VO 재배치와 구분 불가라 억제하면 A35 주 실패 모드에서 폴백이 사라진다. §7 ⓪으로 첫 세션에 먼저 묻는다. |
| L6 `vanished` 즉시가 아니다 | 채택 — 검증을 100ms 단위로(조기 확정도 얻는다). |
| L7 가드 창 3줄 | 채택 — 8줄 창 + `.onAppear`. |
| L8 PATTERNS 정본이 둘로 갈린다 | 채택 — 문서 분배에서 "대중교통 시트는 3회 체증+실현 관측+전 대상 폴백, 그 밖은 종전 2단, 승격 조건 실승차 성공률"을 한 줄로. |
| E8 시트 dismiss 포커스 복원은 미검증 전제 | 채택 — §7 ② 블로킹 + 실패 시 후속 명시. |
| E1 로터 라벨 언어 혼용 | 채택 — descriptor 키 `openStation`(Kit·웹·fixture·6로케일), ios-extra 키·`guard:allow` 폐기. ⚠ 구현 리뷰(code M4·a11y A3)가 "라벨 전체 ko" 보장은 iOS 렌더러에 없음을 확인 — 문구를 현행 계약(E28-① 정본)으로 정정(§4.2). |
| E2 Button↔Text 전환 | 채택 — 상태 문장은 항상 Text + 로터 액션(1개도). 분기 2·위험 2(E2·E6) 소멸. |
| E3 세션 로케일 축의 en 링크 소실 | 채택(변형) — 리뷰 대안(줄 lang 반환)은 상태 문장이 조각별로 언어가 갈려 단일 lang이 없다. ko·en 라벨 둘 다로 대응. |
| E4 채팅 진입 판정 공백 | 채택 — "유지" 한 줄과 근거(§4.2). |
| E5 category "지하철역" | 기록(§4.2). |
| E7 괄호 역명 서버 매핑 | 채택 — §7 ⑥. |
| B1 판정 원문 "모두"와의 거리 | 채택 — §2에 세 자리 근거. |
| W1 종료자는 `stopSession()` | 채택 — 단어 정정. |
| W2 오버레이 대안 | 채택 — §2에 검토·기각 기록. |
| 미니멀리즘(라벨 이중 정의) | 채택 — `advanceLabel`·`waitingLabelText`·`reboardPromptKey` 한 곳, 뷰·폴백·픽커 호출부가 공유. |

## 10. 구현 리뷰 판정 (2026-09-11, HEAD `82ffae56` → 반영 다음 커밋)

세 리뷰(별도 컨텍스트, `git diff main...HEAD`만)의 보고는 `~/gildongmu-wt/reports/transit-3-review-{spec,code,a11y}.md`(커밋 밖).

| 리뷰 | 판정 | 반영 |
|---|---|---|
| spec-compliance(opus) | 적합(BLOCKER 0, MAJOR 1, MINOR 6) | M1 `vo` 빈 문자열 침묵 → 비공백 + 40자 절단 일치로 / m1 `note=deferred` 토큰 / m2 §4.1 id 기제 문구 / m3 소스 가드 ⑦을 "`.accessibilityActions` 밖 Button·`if mentions` 없음"으로 / m4 §4.5 Release 비대칭 기록 / m5 FIELD-TEST §5-6 en 행 / m6 빈 문장은 `skipped=emptyText`. o2 제목 메뉴 상세도 `touchUserAction` / o3 `stationPicker` `promptKey` 매개변수 제거. o1은 반대로 경유역 행의 잉여 가드를 지워 대칭(코드 리뷰와 일치). |
| code-quality(opus) | 조건부 통과(BLOCKER 0, MAJOR 4, MINOR 10) | M1 배경 전환이 진행 중 착지를 끊고 이월(`landingInFlight`) / M2 List `onDisappear`가 Task 취소(최소화 고아 폴백) / M3 `controlExists` `.advance`·`.waitingLabel`에 untrackable·지방버스 축 / M4 라벨 단일 언어 보장 문구 정정(iOS 렌더러 한계, E28-①) / m1 `cancelled` 기록 / m2 `wasRendered`를 guard 앞으로 / m3 폴백은 `outcome`으로 / m4 `landDestChangeStatusFocus` 래퍼 삭제 / m5 픽커 옛 doc 삭제 / m6 가드에 래퍼·변수 인자 / m7 죽은 단언 삭제 / m8 가드 슬라이스 경계 / m9 `@MainActor` + 유실 한계 주석(리셋은 두지 않음 — 국면 전이 뒤 남은 행의 카운트가 사라져 반대 오분류) / m10 인자 이름 `station`. 추측 "빈 `accessibilityActions`"는 §7 ③ 관찰로(조건부 부착은 뷰 종류 분기라 E2와 충돌). |
| a11y(opus, 헌장 기준) | 위반 0(MEDIUM 3, LOW 2) | A1 모달(상세·검색 시트) 위 착지 이월 + `onDismiss` 착지 / A2 게시 직전 전경 재확인 / A3 = code M4 / A4 = spec M1(대상 라벨 일치로 좁힘) / A5 기록 유지 / A7 "소음이면 문장 액션 먼저 뺀다"를 §7 ③·BACKLOG E33 행에. 실기기 판정 항목 5개는 §7·BACKLOG §2와 일치. |

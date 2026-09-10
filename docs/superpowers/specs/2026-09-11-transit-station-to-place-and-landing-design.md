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
| `title landed=false actual=nil`(09-09 07:11:30, 시트 열림 직후) · `minimize landed=false actual=nil`(07:19:46) · `minimize landed=false actual=title`(09:51:45) | 제목·접기는 **섹션 헤더**라 항상 화면 안이다(sticky). 컬링될 수 없는 대상이 실패했다. |
| `changeBoarding landed=false actual=title`(07:40:32·10:08:08) · `advance landed=false actual=minimize`(07:49:59) | 대입 뒤 커서가 **헤더로 되돌아갔다**. 이것은 컬링(무이동)이 아니라 **VoiceOver의 자체 재배치**다 — 포커스를 쥔 컨트롤이 사라지거나 시트가 나타나면 VO가 "화면 바뀜" 처리로 첫 요소(헤더)로 커서를 옮기고, 그 처리가 우리 대입(400ms) **뒤에** 오면 대입이 덮인다. |
| `confirmBoarded` 5/6 안정 | 대기 목록(긴 목록)이 사라지고 두 버튼만 남는 전이라 VO 재배치가 빨리 끝나고 대상이 첫 화면 안 — 두 원인을 다 비켜간다. |
| `reboardPrompt` 1/6 | 프롬프트 헤딩은 경유역 목록(펼침 시 10~20행)·상태 문장 **아래**라 컬링 후보이고, 착지 트리거가 그 헤딩 자체의 `.task`라 **헤딩이 실현되지 않으면 시도 자체가 없다**(로그에 남는 시도는 그중 실현된 것만이다 — 표본 편향). |

즉 실패 기제는 셋이다: ①**컬링**(대상이 AX 트리에 없어 대입이 되돌아감) ②**VO 재배치 경합**(대입 뒤 VO가 헤더로 옮김) ③**트리거 결손**(대상 뷰의 `.task`가 착지를 부르는 구조 — 대상이 실현되지 않으면 시도 0). 현행 헬퍼는 ①만 겨냥했고(가시화 → 400ms → 대입 → 600ms 검증 → 1회 재시도) ②③에는 대책이 없다. **판정 원문의 "착수 시 봐야 할 자리" 넷은 전부 맞다**(재시도 1회·고정 지연·대상 미렌더 가능성·`scrollTo` 누락·`onMiss` 한 곳) — 거기에 ②③을 더한 것이 이 진단이다.

`scrollTo` 누락은 확인했다: `scrollTo(_:_:)`가 `.title·.minimize·.advance·.changeBoarding·.confirmBoarded`를 `default: break`("섹션 상단 버튼들은 List 첫 화면 안이라 가시화 불필요")로 건너뛴다. 그 전제가 거짓이다 — `advance`·`changeBoarding`은 진행 상황 버튼·상태 문장·경유역 목록(펼침 시 수십 행) **뒤**에 선다.

### 1.2 E33 — 안내 시트의 지하철역을 장소 상세로 연다

**판정 원문**(위원장 2026-09-09): "대중교통 실시간 안내 시트에서 나오는 지하철역은 모두 장소상세 연결되어야 함." 현행 경유역 목록(`viaStopsRows`)·상태 문장의 역명은 전부 `Text`다.

**표현 계층 전제에 대한 정정**: 착수 프롬프트·백로그는 "시트 위 시트 금지(N1 설계 리뷰 기각)"를 전제로 NavigationStack push를 강한 디폴트로 잡았다. **그 전제는 N1 M3의 뜻과 다르다.** N1 M3가 기각한 것은 **장소 상세가 이미 시트로 떠 있는 상태(채팅·내 주변 경로)에서 루트 안내 시트를 자동으로 올리는 것**이다(`2026-08-22-guide-session-minimize-design.md` §리뷰 M3: "장소 상세가 시트일 때 루트 시트 presentation 거부 → 자동 올림 폐기"). 반대 방향 — **안내 시트 위에 장소 상세를 중첩 시트로 올리는 것** — 은 `2026-08-12-guide-destination-menu-design.md` §2가 "표준 중첩 시트, 안내 신호 유지"로 채택했고 지금 두 안내 시트 모두에서 돌고 있다(제목 메뉴 "장소 상세 보기" → `showPlaceDetail` → `.sheet(isPresented:)` → `PlaceDetailView`). 진행 상황 조망(`overviewAdapter`)도 안내 시트 위 시트이고, 그 조망은 다시 하위 시트(`subsheet`)를 연다. 즉 이 시트에서 "시트 위 시트"는 금지가 아니라 **현행 정본**이다.

## 2. 범위

**한다**: ①A35 — `TransitTrackingSheet.landControlFocus` 재설계(§4.1) + 계측(§4.5) + 소스 가드. ②E33 — iOS 경유역 행·상태 문장 → 장소 상세(§4.2), Kit 순수 투영·언급 판정 + 테스트. ③판정 회수 행(BACKLOG §2·FIELD-TEST §5).

**하지 않는다**(근거):
- **웹 미러(경유역 행 연결)**. 착수 프롬프트는 "웹은 경유역 목록 행만 연결"로 잡았지만 **연결하면 안내가 조용히 끝난다**: 웹 대중교통 세션은 `TransitGuidePanel`(`DirectionsView` 안) 컴포넌트 수명이고, `requestOpenPlace`를 받는 `PlaceSearch`는 `setDirections(null)`로 길찾기 뷰를 언마운트해 상세를 연다 → `useTransitGuide`의 언마운트 정리가 `releaseGuideSession`을 부른다(통지·정지 톤 없음, `guide-session-store.ts` 주석). 역 정보를 보려다 안내를 잃는 경로를 만들 수 없다. 웹에 앱 수준 세션(N1 동형)이 생기기 전까지 미연결이고, 산문 미연결(B8)과 함께 BACKLOG E33 잔여로 남긴다. 웹 코드 변경 0.
- 버스 정류장 → 장소 상세. 판정 원문이 "지하철역"이고, 정류장 Place는 역 섹션(시설·도착편·시간표)이 없어 상세의 정보량이 좌표 주변 섹션뿐이다. 버스 leg의 행·문장은 종전 `Text`.
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
- `scrollTo`의 `default: break`를 없애고 **모든 `SheetControl`에 `.id`를 주어 전수 `scrollTo`**한다(Swift exhaustive switch가 새 대상의 누락을 컴파일 오류로 만든다).
- 착지 대상 뷰는 전부 한 헬퍼 `landingTarget(_:_:)`로 감싼다: `.accessibilityFocused($focusedControl, equals:)` + `.id(controlId)` + `.onAppear { rendered.insert }` / `.onDisappear { rendered.remove }`. `rendered: Set<SheetControl>`이 **"그 대상이 지금 List에 실현되어 있는가"**의 관측값이다(List는 lazy라 onAppear = 실현·AX 트리 진입, onDisappear = 회수·컬링). ⚠ `.accessibilityFocused($focusedControl` 원시 호출은 헬퍼 안 1곳만 — 소스 가드(§6).
- 대입 전 고정 400ms 대신 **`rendered.contains(target)`을 50ms 간격으로 최대 500ms 기다린다**(실현되면 즉시 진행). 실현되지 않으면 그 시도의 사유는 `notRendered`.

**② VO 재배치 경합 → 늦은 검증 + 체증 재시도.**
- 시도는 최대 3회(현행 2회). 대입 뒤 검증 지연은 600 → 900 → 1200ms로 **체증**(고정 600ms 1회 검증은 VO 재배치가 그 뒤에 오면 못 본다). 각 재시도는 `scrollTo`부터 다시 한다(현행 재시도도 그렇다).
- 검증에서 `focusedControl == target`이면 종료(`ok`). 대상이 실현됐는데도 다르면 사유 `stolen`(대입은 먹었는데 VO가 옮겼거나 대입이 되돌아간 경우 — 둘의 구분은 `vo=` 라벨이 한다, §4.5).
- 지연 중 `controlExists(target)`가 거짓이 되면 `vanished`로 즉시 종료(국면이 바뀐 것 — `onChange(of: phase)`의 취소가 먼저 잡지만 국면 밖 조건(`aboardStep`·`expressPromptActive`)도 있다).
- 상한: 최악 3×(500+1200) ≈ 5.1초(실측 기대치는 1~2초). 국면 전이·새 착지가 즉시 취소한다(현행 계약).

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

**⚠ 이중 낭독 위험과 그 판별**: 바인딩 읽기가 늦어 "실제로는 착지했는데 `landed=false`"이면 라벨이 두 번 들린다(착지 낭독 + 폴백). 그 경우는 로그 `vo=`(실제 VO 포커스 요소의 라벨)가 대상 라벨과 같고 `actual`이 다르게 남아 **다음 로그 회수에서 구분된다**(§4.5). 실측으로 그 모양이 잦으면 폴백을 `vo=` 대조로 억제하는 후속(지금은 넣지 않는다 — `focusedElement` 읽기의 신뢰성을 먼저 실측).

**불변**: 옵셔널 단일 바인딩 · 경합 바인딩 해제 순서 · `controlFocusTask` latest-wins · `phaseTransitionLanding` 분기 · `controlExists` 조건 · 조망 `pendingFollowUp` 계약.

### 4.2 E33 — 지하철역 → 장소 상세 (iOS)

**표현 계층(§1.2 정정에 따라)**: **현행 중첩 시트 하나를 일반화한다.** `showPlaceDetail: Bool` + `detailDest`를 **`detailPlace: Place?` + `.sheet(item: $detailPlace)`** 하나로 바꾸고, 제목 메뉴 "장소 상세 보기"는 `detailPlace = guideDestinationPlace(dest:label:)`, 역 행·상태 문장은 `detailPlace = transitStopPlace(stop)`을 넣는다. 시트 안은 종전과 같이 `NavigationStack { PlaceDetailView(place:, showsDirectionsEntry: false) }`.

NavigationStack push(착수 프롬프트의 강한 디폴트)를 고르지 않은 근거:
1. **선례**: 같은 시트의 목적지 상세가 중첩 시트이고 설계 리뷰(2026-08-12 §2)가 채택했다. 두 진입점이 다른 표현을 쓰면 같은 화면(장소 상세)이 열리는 방식이 둘이 된다.
2. **포커스 복원은 시스템이 한다**: 시트를 내리면 iOS가 **표시 직전 포커스 요소**로 VO 커서를 되돌린다(현행 목적지 상세도 복원 코드 0). push/pop은 pop 뒤 루트 첫 요소로 가는 것이 기본이라 "눌렀던 경유역 행으로 복귀"를 우리 착지 헬퍼로 구현해야 한다 — A35가 보여 준 바로 그 취약한 계층 위에 새 착지를 쌓는 일이다.
3. **레이아웃 무변경**: 시트 본문에 NavigationStack을 넣으면 루트에 빈 내비게이션 바가 생겨 숨김 처리가 필요하고(위원장 판정 2026-08-23이 "제목 없는 빈 바"를 이유로 toolbar 배치를 폐기한 자리), 섹션 헤더 sticky·`ScrollViewReader` 가시화 계약을 다시 실측해야 한다.
4. **안내 신호 유지**는 두 방식이 같다(세션·띠바·폴은 모델 소유, 시트 표현과 무관).

최소화 후 검색 탭 경로(2안)는 쓰지 않는다 — 시트가 중첩 시트를 수용하므로 성립 조건이 아니다.

**식별 → Place 투영(Kit `TransitDisplayProjection.swift`, 순수)**: `transitStopPlace(_ stop: TransitLegStop) -> Place`
- `id`: `"transit-stop:" + (stationId ?? "\(lat),\(lng)")` · `name`: **`stop.name`(한국어 조인 키 — `PlaceDetailView`가 `isStation`·역 섹션 조회에 쓴다)** · `nameRoman`: `stop.nameEn`(비-ko 병기 1순위 — `bilingualName(lang:ko:en:roman:)`의 `en` 자리는 Place에 없어 `roman` 슬롯을 쓴다; 표시 전용) · `category`: `"지하철역"`(isStation 정규식 통과, 상세 분류 줄에 그대로 보인다) · `categoryEn`: `"Subway station"` · 주소·전화·링크 nil/빈 값(없는 값을 지어내지 않는다) · `lat`·`lng`.
- 이름 재검색 왕복은 하지 않는다(좌표·이름이 이미 있다).

**경유역 행(`viaStopsRows`)**: `leg.mode == "subway"`인 leg의 각 행은 한 줄에 역이 정확히 1개 → **행 전체를 `Button(.plain)`**(채팅 선례 "1개 = 블록 전체 버튼"). 라벨 뷰는 종전 `Text(render(transitViaStopLine(…)))` 그대로라 한 줄 = 한 객체가 유지되고 VO는 "{역}, 승차/하차/현재 위치, 버튼"으로 읽는다. 행동: `model.touchUserAction()` → `detailPlace = transitStopPlace(leg.viaStops[index])`(display.stops와 인덱스 1:1). 버스 leg는 `Text`.

**상태 문장(`statusRows`)**: 문장 안 역명은 산문이라 채팅 선례를 그대로 쓴다. Kit `transitStationMentions(in text: String, stops: [TransitLegStop], isEn: Bool) -> [Int]`(역 표시 라벨 — `isEn ? nameEn ?? name : name` — 로 `chatPlaceMentions`와 같은 알고리즘을 돌려 stops 인덱스를 첫 등장 순으로 낸다). 공용 알고리즘은 `ChatPlaceMentions.swift`에서 `mentionOrder(in:names:) -> [Int]`로 뽑아 `chatPlaceMentions`가 그것을 쓴다(순수 리팩터, 기존 테스트 불변).
- 0개: 종전 `distanceText`.
- 1개: `Button(.plain) { open(stops[i]) } label: { distanceText(...) }` — 문장 전체가 버튼(라벨·거리 낭독 정정 유지).
- 2개 이상: `distanceText(...)` + `.accessibilityActions { ForEach(mentions.reversed()) { Button("{name} 상세 보기") } }`(역순 선언 = 산문 등장 순 노출, 채팅과 같은 근거). 시각 사용자용 인라인 링크는 두지 않는다 — 상태 문장은 폴마다 바뀌는 문장이라 `AttributedString` 링크 처리 비용이 크고, 시각 사용자는 경유역 목록 행으로 같은 곳에 간다(정보 정본은 목록).
- 비-지하철 leg는 언급 판정을 하지 않는다(버스 정류장은 §2 범위 밖).
- ⚠ 폴마다 문장이 바뀌어 Button ↔ Text가 바뀔 수 있다. 상태 행은 착지 대상이 아니고 포커스가 얹혀 있을 때 종류가 바뀌면 VO가 라벨을 다시 읽는 정도라 수용한다(실기기 관찰 항목 §7).

**로터 액션 라벨**: 새 키 `ios.transitGuide.openStation` = "{name} 상세 보기"(ios-extra 6로케일, 채팅 `ios.chat.openPlace`와 같은 문장 — 네임스페이스만 자기 것). `name`은 표시 라벨(비-ko는 `nameEn ?? name`).

**사용자 조작 표식**: 역 상세 열기는 `model.touchUserAction()`(private → internal)을 부른다(E36 유휴 시계). 상세를 닫는 것은 표식 없음(시스템 dismiss).

**`PlaceDetailView` 진입**: 시그니처 변경 없음 — `PlaceDetailView(place:, showsDirectionsEntry: false)` 그대로(길찾기 프리필 버튼은 시트 뒤 폼을 조작해 보이지 않는 상태 변화를 만들므로 목적지 상세와 같은 이유로 숨긴다. "여기로 목적지 변경"도 같은 게이트라 숨겨진다 — 경유역을 새 목적지로 삼는 경로는 제목 메뉴 "목적지 바꾸기"가 맡는다).

### 4.3 계측 (§4.5로 이동 — 아래)

### 4.4 문장·키

| 키 | ko | 자리 |
|---|---|---|
| `ios.transitGuide.openStation` | `{name} 상세 보기` | 상태 문장 로터 액션(2개 이상 언급) |

6로케일(en "View details for {name}", es "Ver detalles de {name}", fr "Voir les détails de {name}", it "Vedi dettagli di {name}", ja "{name}の詳細を見る" — 채팅 키와 동문). `arg-order.json`은 신규 키라 자동 등록.

### 4.5 계측 (`TransitGuideDiag`)

- `controlFocus target=<t> landed=<b> actual=<focusedControl|nil> attempts=<1..3> elapsedMs=<n> rendered=<b> reason=<ok|notRendered|stolen|vanished> vo="<실제 VO 포커스 요소 라벨 앞 40자|nil>" [note]` — 한 줄, 시도가 끝났을 때 1회. `vo=`는 `UIAccessibility.focusedElement(using: .notificationVoiceOver)`의 `accessibilityLabel`(TransitGuideDiag `transitFocusedLabel()`, 같은 게이트). 다음 로그 회수의 판정 축: `reason` 분포(컬링이면 `notRendered`, 경합이면 `stolen`+`vo=`헤더 라벨), 이중 낭독 의심(`landed=false` ∧ `vo=`가 대상 라벨).
- `landingFallback target=<t>` — 폴백 통지가 나간 자리(위 줄 바로 뒤).
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
| 표시/조인 분리(E27) | `transitStopPlace.name`은 조인(ko) 목적의 의도된 한국어 — `PlaceDetailView`가 조인 키로 소비한다. 표시는 `nameRoman`(en) 경유 `bilingualName`. 소스 가드 `transit-display-guard`는 `Text(`·`appLocalized(` 창만 보므로 Place 생성은 걸리지 않고, 걸리면 `guard:allow`가 아니라 구조를 다시 본다. |

## 6. 테스트

- **Kit**: `transitStopPlace`(id 규칙 stationId 유무 2형·name=ko·nameRoman=en·category isStation 통과·주소 빈 값) · `transitStationMentions`(ko 1개·2개 등장 순, en 라벨 매칭, 비언급 0, 긴 이름 우선 마스킹 "신촌(경의중앙선)" ⊃ "신촌") · `mentionOrder` 리팩터 뒤 `ChatPlaceMentionsTests` 불변 통과.
- **소스 가드**(웹 vitest가 Swift 소스를 읽는 선례 `transit-display-guard.test.ts`) `transit-landing-guard.test.ts`: ①`.accessibilityFocused($focusedControl` 출현 1회(헬퍼 안) ②`scrollTo(_:_:)` 본문에 `default` 없음 ③`.task {` 2줄 창 안에 `landControlFocus(.reboardPrompt` 없음(착지는 상태가 부른다) ④`landControlFocus(` 호출에 `onMiss:` 없음.
- **뷰 계층은 테스트 레인이 없다** — 판정은 실승차 로그(§7). 시뮬레이터는 VO 착지를 검출하지 못한다(정본 규칙).
- 기존 게이트: `test:run`·`tsc`·`lint`·`swift test`·`xcodebuild Experimental`·i18n(`messages-to-xcstrings`·`check-xcstrings-keys`).

## 7. 실기기·실승차 판정 (BACKLOG §2 표 · FIELD-TEST §5)

- **A35 재판정**(A19 행 되살림): 다음 두 세션 로그에서 `controlFocus … landed=` 성공률이 표(1/6~5/6)에서 얼마로 움직였는가(성과 기준: 전 대상 5/6 이상). `reason` 분포 — `notRendered`가 남으면 컬링 축 재설계, `stolen`이 남으면 지연·재시도 상한 재조정, `vo=`가 대상 라벨인데 `landed=false`면 바인딩 읽기 문제(폴백 이중 낭독 억제 후속). 실패 시 폴백 문장이 **한 번** 들렸는가(착지 낭독과 이중이면 위 후속).
- **E33 실기기**: ①경유역 행 더블탭 → 역 상세 시트(역 시설·도착편·시간표 섹션이 있는가 = `isStation` 통과) ②닫으면 커서가 **그 행**으로 돌아오는가(시스템 복원 — 안 되면 착지 헬퍼 후속) ③상태 문장에 역이 1개면 "…, 버튼"으로 들리고 더블탭이 그 역인가, 2개면 로터에 "○○ 상세 보기"가 등장 순인가 ④상세가 열린 채 국면이 바뀌었을 때(도착 등) 닫은 뒤 커서·통지가 어땠는가(§5 N1 행) ⑤en 세션에서 상세 제목이 영문 병기이고 역 섹션이 비지 않는가(name=ko 조인) ⑥폴마다 상태 행이 버튼↔텍스트로 바뀌는 것이 체감되는가.
- **관찰(범위 밖 기록)**: 후보 목록 착지(`focusedCandidate`) 실패 체감이 있는가 — 있으면 같은 헬퍼로 승격하는 후속 항목.

## 8. 파일

Kit `TransitDisplayProjection.swift`(+`TransitDisplayProjectionTests.swift`) · `ChatPlaceMentions.swift`(리팩터, 소유 밖 자진 신고) / iOS `Directions/TransitTrackingSheet.swift`·`Directions/TransitGuideModel.swift`(`touchUserAction` 공개·`announceLandingFallback`)·`Directions/TransitGuideDiag.swift`(`transitFocusedLabel`) / `ios/i18n/ios-extra/*.json` + 생성물 `Localizable.xcstrings`·`arg-order.json` / 웹 `src/lib/__tests__/transit-landing-guard.test.ts`(소스 가드) / 문서 `CHANGELOG.md`·`docs/BACKLOG.md`·`docs/FIELD-TEST.md`·`CLAUDE.md`·`docs/PATTERNS.md`·`PROGRESS.md`.

**소유 밖 관찰(보고만, 고치지 않는다)**: `SurroundingsSceneSection`의 장소 행은 `NavigationLink`인데 두 안내 시트(`TransitTrackingSheet`·`BeaconTrackingSheet`)는 시트 안에 NavigationStack이 없다 — 그 자리에서 링크가 동작하지 않을 가능성이 있다(BACKLOG §2 "M1 잔여 — 시트 임베드" 미판정 면과 겹친다). 이 spec이 NavigationStack을 넣지 않는 선택과 무관하게 별건이다.

## 9. 설계 리뷰 판정

(리뷰 뒤 기록)

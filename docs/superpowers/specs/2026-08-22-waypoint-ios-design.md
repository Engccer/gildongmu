# N4 경유지 — iOS 설계 (2026-08-22)

> 브리프: `docs/superpowers/plans/2026-08-22-feedback-260821-parallel-plan.md` §1 N4 행. 서버·웹·CLI 계약은 `2026-08-22-waypoint-server-web-cli-design.md`(이하 "서버 spec")가 정본이고, 여기서는 그 계약을 iOS에 옮기는 설계만 다룬다. 판정(경유지 1개·도보·자동차만·대중교통 정직 표시·버튼 위치·도착지 선택 후 포커스 불변·도착하면 알리고 계속·최근 경로 문장·시트 버튼 라벨·장소 상세 버튼)은 위원장이 내렸다.

## 1. 범위

| # | 과제 | 소유 파일 |
|---|---|---|
| ① | 길찾기 폼 "경유지 추가"(도착지와 경로 조회 사이, 선택 사항) | `DirectionsTabView.swift`, `DirectionsEndpointSearchView.swift` |
| ② | 3좌표 조회·결과 표시, 대중교통 "경유지 미지원" 정직 표시 | `DirectionsTabView.swift`, Kit `Directions.swift`·`RouteService.swift`·`Models/RouteModels.swift`, `RouteBriefing.swift` |
| ③ | 최근 경로 경유지 문장 | Kit `RecentSearchStore.swift`, `DirectionsTabView.swift` |
| ④ | 안내 시트 경유지 버튼("경유지 추가"↔"C, 경유지 변경"), 안내 중 재조회 | `BeaconTrackingSheet.swift`, `BeaconModel.swift` |
| ⑤ | 경유지 도착 시 알리고 계속 | Kit `RouteGuide.swift`·`RouteGeometry.swift`, 웹 `route-guide.ts`·`route-geometry.ts` 미러, 공유 fixture, `BeaconModel.swift` |
| ⑥ | 장소 상세 "여기를 경유지로 추가" 동작 | `PlaceDetailView.swift`, `GuideSessionCoordinator.swift`(`waypointAvailable`) |

비범위: 대중교통 안내 세션의 경유지(ODsay 미지원 — 서버 spec §2.1), 딥링크 경유 인자, 띠바 문구 변경(§4.4), 안내 중 경유지 **삭제**(판정에 없다 — 변경으로 대체 가능. 필요가 실사용에서 드러나면 BACKLOG).

## 2. Kit 계층

### 2.1 응답 디코딩

`WalkRouteBriefing`·`CarRouteBriefing`에 선택 필드 `waypoint: RouteWaypoint?` 추가(서버 spec §2.2 `{stepIndex, coord}`). 선택 디코딩 — `via` 없는 응답엔 키 자체가 없다.

```swift
public struct RouteWaypoint: Codable, Sendable, Hashable {
    public let stepIndex: Int
    public let coord: RoutePoint
}
```

### 2.2 요청(`RouteService`)

`walk`·`walkAlternatives`·`car`에 `via: (lat: Double, lng: Double)?` 인자. **기본값을 두지 않는다** — 호출부가 `nil`을 적어야 컴파일된다. 근거: 경유지를 받은 세션의 재조회 경로 중 하나라도 `via`를 빠뜨리면 "경유 안 한 경로"가 "경유한 경로"로 낭독된다. 서버가 표지 부재를 throw로 막은 것과 같은 결함이 클라이언트에서는 **인자 생략**으로 일어나고, 기본값이 있으면 그 생략이 조용히 컴파일된다(A4·A13, [[no-default-for-safety-parameters]]). 현재 호출부: `DirectionsModel` 3곳(transit 제외), `BeaconModel.fetchDetailData` 2곳, `BeaconModel` 자동차 ETA 갱신 1곳.

`transit`은 인자를 받지 않는다 — 경유지가 있으면 **호출하지 않는 것**이 계약이다(§3.2).

### 2.3 결과 분류(`Directions.swift`)

`DirectionsModeOutcome`에 `.unsupportedWaypoint` 추가. `isSuccess=false`, 게이트·커버리지 아님(섹션은 노출, 본문은 `directions.unsupportedWaypoint` 한 문장). `DirectionsOrder`는 비성공군으로 다루므로 순서 규칙은 불변. 합산 통지(`readySummary {count}`)는 성공 수만 세므로 변경 없음(웹은 "미지원"을 따로 센다고 했지만 iOS 통지 문장은 성공 수 하나뿐이라 같은 뜻이다 — 대중교통 섹션이 화면에 남아 사유를 말한다).

### 2.4 최근 경로(`RecentSearchStore`)

`RecentRoute.via: RecentEndpoint?` 추가(decodeIfPresent — 기존 저장 데이터 호환, 저장 키 불변). `sameRoute`는 from·to·via 셋 전부(via 부재끼리 동일), `id`는 `"from>to>via"`(via 부재는 `"-"`). `recordRoute`·`setRoutePinned`·`removeRoute`가 via를 보존하도록 `withPinned` 클로저가 via를 옮긴다. 웹 `recent-searches.ts` 미러.

### 2.5 경로 기하·리듀서(⑤의 핵심)

**`GuideRoute.waypointStepIndex: Int?`** — `buildGuideRoute(_:waypointStepIndex:)`가 받는다(웹 `buildGuideRoute(steps, { waypointStepIndex })` 미러). 범위 검증: `0 ..< steps.count`가 아니면 **nil**(fail-closed, 유령 스텝 가드와 같은 규율 — 경유지를 받은 세션이 경유지 위치를 모르면 상세 안내 자격이 없다). 경유지 도착선은 `steps[waypointStepIndex].startD`(= 직전 스텝 `endD`).

**`GuideState.waypointReached: Bool`**(도착선 통과 확정 래치) + **`waypointPending: Bool`**(확정됐으나 아직 발화하지 못함). 둘 다 초기 false, `restateAt`(재획득·복귀 재구성)은 **둘 다 승계**한다 — 같은 경로 세대 안에서 래치를 지우면 복귀 직후 같은 경유지를 다시 알리고, `d`로 재계산하면 통지 없이 사건을 소비한다(리뷰 #5). 새 경로 세대(`initialGuideState`)에서만 초기화.

**`GuideEvent.waypointReached`** — 감지와 발화를 분리한다(리뷰 #2):

```
// W1) 감지(6a 앞): 신뢰 가능한 fix의 도착선 통과만 확정한다.
if let w = route.waypointStepIndex, !next.waypointReached, !isOff, !jumped,
   d >= route.steps[w].startD {
    next.waypointReached = true
    next.waypointPending = true
}
// W2) 이전 fix에서 확정됐는데 임박 큐에 밀려 못 나간 도착은 새 임박보다 먼저 나간다.
if state.waypointPending, next.waypointPending {
    next.waypointPending = false; next.lastAnnouncedAt = now
    return emit(next, .waypointReached, nil)
}
// 6a) 임박 큐 …
// W3) 이번 fix에 확정된 도착은 임박이 안 나갔을 때 바로 나간다(6b 앞).
if next.waypointPending { next.waypointPending = false; next.lastAnnouncedAt = now; return emit(next, .waypointReached, nil) }
// 6b) 최종 접근 — 미도착 경유지가 있으면 진입하지 않는다(리뷰 #1):
//     && (route.waypointStepIndex == nil || next.waypointReached)
```

- **같은 fix의 임박 큐가 이긴다**(시점이 박힌 명령문, `rem >= 0` 하한 때문에 한 fix 지연이 곧 소실). 도착은 pending으로 남아 **다음 fix에서 새 임박보다 앞서** 나간다 — 조밀한 결정 지점에서 도착이 무한히 밀리지 않는다.
- **신뢰 가능한 통과만**: `!isOff`(이탈 의심 중 투영 불신, 6a·6b 동형) + `!jumped`(투영 점프로 전진한 `d`는 증거가 아니다 — A10 동형). 경로가 경유지를 **지나가도록** 그려지므로, 경로 위 투영이 도착선을 넘었다는 것 자체가 경유지를 지났다는 증거다 — 별도 좌표 근접 판정은 두지 않는다(이중 판정은 서로 어긋날 때 어느 쪽이 정본인지 정의해야 한다).
- **최종 접근은 미도착 경유지가 있으면 진입하지 않는다**. 경유지가 종점 부근(진입선 안)에 있으면 6b가 먼저 래치돼 0a 가드가 이후 판정을 전부 막아 도착이 영영 나가지 않는다. 이탈 판정 창이 그만큼 연장되는 대가는 "경유지가 진입선 안"인 드문 기하에 한정된다(임박 큐의 한계와 달리 이쪽은 이벤트 자체가 영구 소실이라 미루는 쪽이 맞다).
- `stepIndex == 0`(경유지에서 출발 — leg 0이 비었거나 Tmap PP1이 첫 Point)은 **유효**하다(범위 `0 ..< steps.count`). 첫 신뢰 fix에서 `d >= 0`이라 즉시 "경유지 도착"이 나간다 — 참인 문장이고, 출발 안내와 한 번 겹치는 비용을 받아들인다(리뷰 #6). 조회 왕복 중 이동해 첫 fix가 이미 도착선 뒤여도 같은 경로로 첫 신뢰 fix에 나간다 — 경로 위 투영이 증거다(위 항목).
- 40m 선행 전문(6c)이 경유지 다음 유닛을 **도착선 앞에서** 읽는 것은 결함이 아니라 낭독 선행 원칙 그대로다(리뷰 #3 기각) — "다음에 할 일"을 먼저 듣고 "지금 경유지다"를 듣는 순서는 모든 결정 지점과 같다.
- 톤은 리듀서가 내지 않는다(`nil`). 도착 소리는 오케스트레이터가 `.nearby`(도착 종)를 재생한다.
- 웹 미러: `route-guide.ts`에 같은 상태 2개·이벤트·W1~W3·6b 조건을 더한다. 웹 `useRouteGuide`는 경유지를 모르므로(서버 spec §3) `waypointStepIndex`를 넘기지 않고 소비자는 no-op. 공유 fixture 시나리오 4건: ①통과 1회·이후 무이벤트·톤 없음 ②같은 fix 임박+도착 → 임박 먼저, 다음 fix 도착(새 임박 후보가 있어도 도착 우선) ③경유지가 종점 진입선 안 → 도착 이벤트 다음 fix에만 `finalApproachEnter` ④`stepIndex 0` → 첫 fix 도착.

## 3. 길찾기 탭(①②③)

### 3.1 상태(`DirectionsModel`)

- `via: DirectionsEndpoint?` — `.place`만 허용(`.current`는 구조적으로 막는다: 검색 시트 `.via` 타깃은 "현재 위치 사용" 버튼을 내지 않는다 — `target == .from || .manualLocation`에만 노출되므로 분기 추가 불필요). `setVia(_:)`·`clearVia()`는 `setEndpoint` 동형으로 `clearResults()` + 최근 장소 기록(스코프 `.via` 신설, 서버 spec §3 "도착지 목록과 섞지 않는다").
- `swap()`은 via를 건드리지 않는다(경유지는 방향과 무관).
- `performQuery`: `via` 좌표를 `lastCoords`에 함께 보관(계단 회피 토글 재조회가 재사용). 도보·자동차 settle에 `via` 전달, **대중교통은 `via != nil`이면 호출하지 않고 `.unsupportedWaypoint`**. 커버리지 선분기는 via 좌표도 `isInKorea`로 본다(서버가 `outOfCoverage`를 주지만 클라에서 먼저 막으면 upstream 호출 0).
- `recordRecentRoute`에 via 투영.
- 출입구 승격(A11)은 **도착지에만** 적용(경유지는 "들른다"이지 "도착한다"가 아니고, 승격 이득 게이트가 출발지 기준이라 경유지엔 정의되지 않는다).

### 3.2 화면(`DirectionsTabView`)

폼 섹션 순서: 출발지 → 바꾸기 → 도착지 → **[경유지]** → 경로 조회.
- `via == nil`: 버튼 `directions.addVia`("경유지 추가") → `searchTarget = .via`.
- `via != nil`: 버튼 `"경유지, C"`(`fieldText` 동형, 탭=재검색) + 버튼 `directions.removeVia`("경유지 삭제"). 삭제는 자기를 누른 버튼을 없애므로 포커스를 **경로 조회 버튼**으로 선점한다(헌장 §5, `activateRecentRoute` 동형).
- 시트 확정 후 포커스: `.via` → 경로 조회 버튼(`focusAfterResolve` 분기에 `.via` 추가, 도착지와 같은 착지). **도착지 확정 후 포커스는 종전대로 경로 조회 버튼** — 경유지 버튼으로 보내지 않는다(판정).
- `DirectionsFieldTarget.via` 추가. `DirectionsEndpointSearchView`는 exhaustive switch라 제목(`directions.searchVia`)·최근 스코프(`.via`) 분기를 더해야 컴파일된다(의도된 강제).
- 결과: `WalkRouteRows`·`CarRouteRows`에 `waypointLabel: String?`를 주고, `briefing.waypoint?.stepIndex` 앞에 행 `directions.viaArrived`("경유지 {label} 도착")를 넣는다(웹 `StepList` 구획 행 동형 — 번호 없는 평문, 스텝 번호는 원본 인덱스 유지). 라벨은 `model.via`에서(서버는 라벨을 모른다).
- 대중교통 섹션 `.unsupportedWaypoint` → `Text(appLocalized("directions.unsupportedWaypoint"))`.
- 안내 시작 버튼(도보·자동차)은 경유지 조회에서도 **낸다** — 웹과 다른 점이고 그것이 이 마일스톤의 목적이다(§4).
- 최근 경로 라벨: `route.via != nil`이면 `recentRoutes.itemVia`, 활성화는 from·to·via 원자 확정 + 조회.

## 4. 안내 세션(④⑤⑥)

### 4.1 모델 상태(`BeaconModel`)

```swift
struct Waypoint: Equatable { let dest: BeaconDest; let label: String }
private(set) var waypoint: Waypoint?     // 미도착 경유지. 도착하면 nil.
```

- `StartRequest.waypoint: Waypoint?` — 필수 필드(기본값 없음). `begin`이 `self.waypoint = request.waypoint`. 시작 버튼 세 곳(도보 추천·최단·자동차)은 `model.via`를 넘기고, 간략 폴백·핸드오프·A13 재시작은 그 요청을 그대로 쓴다(핸드오프는 `nil` 명시 — 대중교통 세션에 경유지가 없다).
- `fetchDetailData(origin:dest:variant:waypoint:)`는 **경유지를 인자로 받는다**(가변 `self.waypoint`를 읽지 않는다 — 리뷰 #8). `via`를 싣고 응답 `waypoint?.stepIndex`를 `buildGuideRoute(_:waypointStepIndex:)`에 넘긴다. 자동차도 동형(`buildCarGuide`에 같은 인자). 경유지를 보냈는데 응답에 `waypoint`가 없으면 `nil`(상세 부적격) — 서버가 이미 throw하므로 도달하지 않지만 클라 가드로 한 번 더.
- **경유지가 있는 세션의 간략 폴백은 경유지를 조용히 버리지 않는다**(리뷰 #7): 간략 안내는 기하를 몰라 목적지 직선 안내가 되고 화면엔 경유지가 남아 거짓이 된다. 폴백 시 `waypoint = nil` + 전용 통지 `ios.guide.waypointDropped`("경유지 {label}를 포함한 경로를 찾지 못해 경유지 없이 안내합니다", `.high`). 세션을 보류하는 대안은 기각 — 시각장애 사용자를 멈춘 화면에 두는 것이 더 나쁘고, 통지로 사실을 말하면 사용자가 다시 추가할 수 있다.
- 자동차 ETA 갱신 조회(`routeService.car` 기하 없는 호출)도 `via`를 싣는다 — 경유 경로의 소요를 물어야 ETA가 참이다.
- 모든 경로 fetch 커밋 가드(`self.dest == dest`)에 **`self.waypoint == waypointAtFetch`**를 더하고, `fetchGuideRoute` 커밋에도 `token == routeFetchToken`을 본다(종전엔 defer에만 썼다). A→B→A 같은 값 복귀는 `reacquireRoute()`가 `rerouteToken`·`routeFetchToken`을 올리므로 값 비교가 아니라 토큰이 가른다(리뷰 #8 — 별도 세대 번호를 신설하지 않고 기존 토큰 둘을 같은 자리에서 올린다).

### 4.2 추가·변경(`setWaypoint`)

```swift
@discardableResult
func setWaypoint(dest: BeaconDest, label: String) -> Bool
```

`isTracking` 아니면 false. 같은 좌표 재선택은 라벨 갱신 + 확인 통지 `ios.guide.waypointKept`("경유지 {label} 그대로입니다")만 — "다시 조회합니다"라고 말하지 않는다(리뷰 #12, 일어나지 않는 일을 예고하지 않는다). 그 외엔 `waypoint = Waypoint(...)` 후 **`changeDestination`의 경로 종속 상태 초기화 블록을 공통 함수 `reacquireRoute()`로 추출해 공유**한다(세션·톤·스트림·유도기 버퍼는 유지, 다음 수용 fix가 `fetchGuideRoute`를 트리거). 통지는 `.high`·억제 우회: `ios.guide.waypointSet`("경유지 {label}, 경로를 다시 조회합니다"). ko 밖(`dataLocale != "ko"`)은 상세 조회 자체가 없어 경유지가 의미 없다 — `waypointAvailable`이 막는다(§4.5).

목적지 변경(`changeDestination`)은 미도착 경유지를 **유지**한다(경유는 "들르기"라 목적지와 독립).

### 4.3 도착(⑤ 소비)

`consume(event:)`에 `.waypointReached`:
1. `playTone(.nearby)`(도착 종 — 목적지 도착과 같은 소리. 다른 소리를 만들 근거가 없고 N2 톤 5종은 행동 큐다).
2. 통지 `directions.viaArrived`("경유지 {label} 도착") — `announce`(지연 슬롯 경유, 톤 뒤 발화 계약 §`speechDeferStep`). 억제 중이면 `pendingRecovery`에 보관(실행 안내와 같은 취급 — 지나간 사실이라 나중에 갚아도 참이다).
3. `waypoint = nil`. 경로·상태는 **그대로** — 정지 없음. 이후 재조회는 출발→도착만 간다(서버 `stepIndex` 이후 스텝이 곧 남은 경로라 현 경로엔 손댈 것이 없다).
4. **경유지 기반 파생물 폐기**(리뷰 #9): `clearProposal()`·`resetAlternativePreview()`(둘 다 옛 경유지를 포함한 경로다), `rerouteToken += 1`(왕복 중인 이탈 재조회 응답 폐기 — 이탈 상태는 남으므로 버튼으로 다시 누를 수 있다). 자동차 ETA는 다음 주기 갱신이 `via` 없이 돌아 자연 교정된다(한 주기 낡은 값은 "지난 경유지로 돌아가는 시간"이 아니라 경유지 도착 직후라 거의 같은 값이다).
5. **`lastStartRequest`의 `waypoint`를 nil로 갱신**(리뷰 #11) — 실패 뒤 재시작이 지난 경유지를 다시 더하지 않는다.
6. `lastGuidance`는 덮지 않는다(임박 큐 동형 — "마지막으로 들은 안내"는 행동 안내여야 한다).

**라벨 저장소 분리**(리뷰 #10): 현재 경로에 결박된 `routeWaypointLabel: String?`를 fetch 커밋 시점에 기록한다(`waypoint` 상태와 별개). `routeStepDescriptions`의 "경유지 {label} 도착" 행은 이 값을 쓰므로 도착 뒤 `waypoint = nil`이 돼도 조망에 남고, 새 경유지 D를 더해 경로를 다시 받기 전까지 옛 경로에 D가 붙지 않는다. 행 문구는 웹·CLI와 같은 `directions.viaArrived`를 유지한다(세 소비자가 같은 구획 문장 — 플랫폼마다 다른 문장을 두지 않는다).

**폼은 세션 상태가 아니다**(리뷰 #11 일부 기각): 도착으로 폼의 `via`를 지우지 않는다. 폼은 사용자가 한 질의이고 최근 경로는 그 이력이다 — 둘 다 "C를 경유해 가는 길"을 물은 사실을 보존한다. 세션 주도 **추가**만 폼에 동기화한다(§4.5).

`routeStepDescriptions`(조망 모달)는 `waypointStepIndex` 앞에 `viaArrived` 행을 끼운다 — 라벨은 모델이 안다. 도착 뒤에도 경로가 같으므로 행은 남는다(지난 구간이라 `currentStepIndex` 표식이 아래로 내려가 있다).

### 4.4 띠바

변경 없음. 경유지 도착은 순간 사건이고 띠바는 지속 상태 요약이다 — 남은 거리가 계속 줄어드는 것이 곧 "계속 안내 중"이다. N1 BACKLOG의 "띠바에 경유지 도착 상태"는 이 판정으로 닫는다(도착 통지가 띠바 위에서도 모델 창구로 나간다).

### 4.5 시트 버튼(④)·장소 상세(⑥)

- `BeaconTrackingSheet` 추적 섹션: 최소화 → **경유지 버튼** → 중지. 라벨 `waypoint == nil ? directions.addVia : ios.guide.waypointChange("{label}, 경유지 변경")`. 누르면 `DirectionsEndpointSearchView(target: .via)` 시트(목적지 변경 시트와 같은 억제 계약 `outputSuppressed`). 확정 시 `model.setWaypoint` → true면 `onWaypointCommitted(endpoint)`(루트가 `GuideFormSyncStore.postWaypoint`) → 검색 시트 닫힘 후 중지 버튼 착지(`landStopFocus`, 목적지 변경 동형).
- `GuideSession.waypointAvailable`: `beacon.isTracking && AppLanguage.dataLocale == "ko"`. 대중교통 세션은 false(ODsay).
- `PlaceDetailView` 버튼: 라벨은 `guide.addWaypointHere` 유지(기존 경유지가 있으면 `guide.changeWaypointHere` "여기로 경유지 변경" — 동작이 교체라 라벨이 동작을 서술해야 한다). 동작: `beacon.setWaypoint` → true면 `GuideFormSyncStore.postWaypoint(...)`. 시트는 올리지 않는다(N1 M3 — 장소 상세가 시트인 경로에서 루트 presentation 거부).
- `GuideFormSyncStore`에 `pendingWaypoint`·`postWaypoint`·`takeWaypoint` 추가. 탭은 `consumeGuideFormSync`에서 `via`를 반영하고 무통지 재조회(도착지 동기화와 같은 줄).

## 5. i18n(6개 로케일, `ios.guide` 네임스페이스)

| 키 | ko |
|---|---|
| `ios.guide.waypointChange` | `{label}, 경유지 변경` |
| `ios.guide.waypointSet` | `경유지 {label}, 경로를 다시 조회합니다` |
| `guide.changeWaypointHere` | `여기로 경유지 변경` |
| `ios.guide.waypointKept` | `경유지 {label} 그대로입니다` |
| `ios.guide.waypointDropped` | `경유지 {label}를 포함한 경로를 찾지 못해 경유지 없이 안내합니다` |

재사용: `directions.addVia`·`searchVia`·`removeVia`·`via`·`viaArrived`·`unsupportedWaypoint`, `recentRoutes.itemVia`, `guide.addWaypointHere`. xcstrings는 `messages-to-xcstrings.mjs` 재생성.

## 6. 테스트·게이트

- Kit `RouteGuideTests`: 공유 fixture 시나리오(경계 통과 1회 + 임박 우선). `buildGuideRoute` 범위 밖 index → nil.
- Kit `RecentSearchStoreTests`: via 동일 판정·고정 보존·기존 데이터 디코딩.
- Kit `DirectionsTests`: `.unsupportedWaypoint`가 비성공군에 들고 `displayedModes`에 남는다.
- 웹 `route-guide.test.ts`: 같은 fixture 자동 소비. `recent-searches` 기존 테스트 불변.
- `guidance-gate-drift.test.ts`: 세션 시작 진입점을 늘리지 않는다(경유지는 경로 변경이지 시작이 아니다) — 6 유지.
- 실호출 게이트: 시뮬레이터에서 경유지 조회(천호역→강동역 경유→길동) 3수단 섹션 확인, 안내 시작 → 상세 모드 진입 + 조망에 "경유지 강동역 도착" 행.
- 실기기(위원장): ①폼 경유지 추가·삭제 포커스 착지 ②경유지 도보 안내에서 도착 종+통지 뒤 안내가 계속되는가 ③시트 "경유지 추가" → 재조회 통지 → 라벨 "C, 경유지 변경" ④장소 상세 "여기를 경유지로 추가" 뒤 길찾기 탭 폼에 경유지가 반영되는가 ⑤최근 경로 문장.

## 7. 리뷰 판정

설계 단계 codex adversarial-review **실행** — 조건 ①(리듀서에 새 이벤트·래치 신설, 세 플랫폼 미러)과 ④(실보행 안내 정확성)에 해당. 결과는 §8에 기록.

## 7-1. 구현 실측 (시뮬레이터, 2026-08-22)

현재 위치(강동구 천중로) → 경복궁, 강동역 5호선 경유: 자동차 23.382km(경유지 구획 행 O), 도보 추천 17.515km·최단 17.288km, 대중교통 "경유지는 대중교통 경로에서 지원하지 않습니다", 통지 "2개 수단의 경로 안내가 준비되었습니다". 최근 경로 "현재 위치부터 Gyeongbokgung Palace (경복궁)까지 강동역 5호선을 경유하는 경로 조회"(조사 결함 "5호선를"을 실측으로 잡아 호출부 조사 처리로 고침). 도보 안내 시작 → 상세 모드 86구간 진입. 시트 "강동역 5호선, 경유지 변경" → 길동역 선택 → 라벨 "길동역 5호선, 경유지 변경" + 폼 "경유지, 길동역 5호선" 동기화. 정적 위치라 재획득 fix가 오지 않아 15초 뒤 "신호 약함" 폴백 → 경유지 소거·라벨 "경유지 추가" 복귀(폴백 경로 실측). 조망 모달 스크롤은 자동화 도구로 닿지 않아 경유지 행은 실기기 판정 항목으로.

## 8. 설계 리뷰 결과 (codex raw exec, 2026-08-22)

12건 중 9건 수용·3건 기각. 수용분은 본문에 반영(§2.5·§4.1~4.3).

| # | 심각도 | 요지 | 판정 |
|---|---|---|---|
| 1 | BLOCKER | 경유지가 최종 접근 진입선 안이면 6b가 먼저 래치돼 도착이 영구 소실 | 수용 — 6b에 미도착 경유지 금지 조건 |
| 2 | MAJOR | 임박 큐에 밀린 도착이 조밀한 결정 지점에서 무한 지연 | 수용 — 감지/발화 분리(`waypointPending`), 다음 fix에 임박보다 우선 |
| 3 | MAJOR | 이탈 의심 중 6c가 경유지 이후 전문을 먼저 읽는다 | 기각 — 40m 선행 전문은 모든 경계에서 도착 앞에 나가는 설계 원칙이다 |
| 4 | BLOCKER | `d >= startD`만으로 도착 선언(점프·오염 d) | 수용 — `!jumped` 추가. 좌표 근접 2중 판정은 기각(경로 위 투영이 증거) |
| 5 | MAJOR | `restateAt` 승계 미정의 | 수용 — 래치·pending 둘 다 승계 |
| 6 | BLOCKER | `stepIndex 0`·출발 시 이미 지난 경우 | 수용 — 0 유효, 첫 신뢰 fix에 도착 발화(참인 문장) |
| 7 | BLOCKER | 간략 폴백이 경유지를 조용히 우회 | 수용 — 폴백 시 경유지 소거 + 전용 `.high` 통지(세션 보류는 기각) |
| 8 | BLOCKER | 값 비교 가드가 A→B→A를 못 가른다 | 수용 — 스냅샷 인자 + 기존 토큰(별도 세대 번호 신설은 기각) |
| 9 | MAJOR | 도착 뒤 제안·프리뷰·재조회·ETA 무효화 없음 | 수용 — 제안·프리뷰 폐기·rerouteToken 증가. ETA는 다음 주기 자연 교정 |
| 10 | MAJOR | 라벨 저장소가 `waypoint` 하나 | 수용 — `routeWaypointLabel` 분리. "도착" 문구 교체는 기각(3플랫폼 동일 구획 문장) |
| 11 | MAJOR | 재시작 요청·폼이 지난 경유지를 되살림 | 재시작: 수용(`lastStartRequest` 갱신). 폼: 기각(질의·이력 보존) |
| 12 | MAJOR | 같은 좌표 재선택 문구가 거짓 | 수용 — `waypointKept` 분리 |

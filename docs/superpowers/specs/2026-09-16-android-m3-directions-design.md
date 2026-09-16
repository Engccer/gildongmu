# 안드로이드 앱 설계 — M3 길찾기 브리핑 (2026-09-16)

> 범위는 **M3(길찾기 탭의 브리핑까지, 실시간 안내 시작 제외)** 다(계획 `../plans/2026-09-16-android-app-parallel-plan.md` §1 마일스톤 표, 판정 문서 `2026-09-15-android-app-decisions.md` §2 "경로 문장 조립"). 입력: M1 spec `2026-09-16-android-app-design.md`(관용구·접근성 기본형·i18n 파이프라인·`StatusLine`·착지 관용구 — 그대로 승계, 다시 쓰지 않는다), M2 spec `2026-09-16-android-m2-place-nearby-design.md`(§3-2 장소 상세의 길찾기 프리필 자리, §4 위치 계층 `LocationStore`, §10 판정 — 재규명 없이 잇는다), CORE 통합분(`Directions.kt`·`RouteService.kt`·`TransitExitLines.kt`·`TransitWalkLegText.kt`·`QuickExitText.kt`·`TransitAlternativeName.kt`·`TransitDisplay.kt`·`models/RouteModels.kt`·`RecentSearchStore.kt`·`SearchService.kt` — 그대로 소비, :kit 수정 0), 골격 체크포인트(main `eb7bf0f8`), **M2 위치 계층 첫 통합 조각**(main `7a4a9379`: `location/LocationStore`·`PermissionGate`·`AppConfig.locationStore`·`AppConfig.permissionGate`). 동작 정본은 iOS `Directions/DirectionsTabView.swift`·`Directions/DirectionsEndpointSearchView.swift`·`RouteBriefing.swift`, 문장 순서 대조는 웹 `DirectionsView.tsx`·`route-step-items.ts`.
>
> 적대적 설계 리뷰 판정: (§12에 기록)

## 1. 목표와 범위

**목표**: 길찾기 탭에서 출발지·도착지(·경유지)를 검색 화면으로 확정하고 "경로 조회" 한 번에 대중교통·자동차·도보 세 수단의 브리핑을 점자·TalkBack으로 읽는다. 이 마일스톤이 처음 세우는 축은 **경로 문장 조립의 :app 계층**(:kit이 키·인자를 정하고 :app이 리소스를 조회한다)과 **프리필 진입 계약**(M2 장소 상세가 배선한다)이다.

**범위**:
1. **길찾기 폼** — 출발지·도착지 필드(각각 탭 → 끝점 검색 화면 → 후보 선택으로 원자 확정, 출발지엔 "현재 위치 사용"), 출발↔도착 맞바꾸기, 경유지 1개(추가·재검색·삭제, 장소만), 경로 조회 버튼, 상태 문장(단일 polite 창구), 위치 실패 상태의 해결 버튼(설정 열기·정확한 위치 허용).
2. **끝점 검색 화면** — 장소+주소 병렬 상위 5건씩(웹 폴백 없음), 필드별 최근 장소(출발·도착·경유 분리 스코프, 고정·삭제·모두 지우기), 주소 후보는 선택 시점 지오코딩으로 확정. 받아쓰기 행 없음(D9 — 마이크는 그 마일스톤).
3. **최근 경로** — 결과 없는 화면에서만, 활성화 = 두 필드(+경유지) 원자 확정 + 즉시 조회, 고정·삭제·모두 지우기.
4. **조회** — 현재 위치 측위(조회 시점에만 — 권한 다이얼로그도 그때, `LocationStore.currentCoordinate`가 띄운다) → 커버리지 선분기 → 목적지 출입구 승격(A11, ko 장소 목적지) → 3수단 병렬(수단별 15초 상한) → 수단별 상태 분류(:kit `DirectionsOutcomeClassifier`) → 표시 순서 스냅샷(:kit `DirectionsResults`) → 완료 통지 1문장.
5. **브리핑 목록** — 수단 섹션(동적 순서, 헤딩), 대중교통은 추천+대안(최대 4) 각각 펼침 행(구간 줄 + 출구 번호 한 줄 규칙 E25 + 하차 줄(빠른하차·하차 출구)), 도보는 계단 회피 토글(ko 전용) + 추천·최단 2행 펼침 + 스텝 번호·경유지 구획, 자동차는 요약 1줄 + 낭독 문장 행. 3-state(경로 없음 ≠ 조회 실패 ≠ 게이트 미노출 ≠ 경유지 미지원 ≠ 커버리지 밖).
6. **프리필 진입 계약**(§5) — M2 장소 상세의 "여기까지/여기부터 길찾기"가 부르는 API와 진입 시 동작을 못 박는다. 배선은 M3 통합 뒤 android-m1이 한다.
7. **위치 계층 소비**(§6) — main `7a4a9379`의 `LocationStore`를 `directions/`의 세 함수 인터페이스 뒤에서 소비한다(테스트 페이크 자리).
8. **문자열** — iOS 전용 `ios.route.*`·`ios.directions.searching`·`ios.common.*`(위치·커버리지)·`ios.unit.spokenMeters`를 `android.*` 같은 문안으로 android-extra에 더한다(§8). M2의 ios-extra 일괄 도입이 먼저 오르면 같은 이름·같은 문안이라 그대로 흡수된다.

**범위 밖(판정 기록)**: 실시간 안내 시작 버튼 3종·거리 추적 섹션·안내 시트·도보 안내 1회성 공지(`WalkGuideNoticeSheet`)·안내 주도 폼 동기화(`GuideFormSyncStore`) — M4·M5(§3-1 표에 **자리만** 예약). 수동 위치 지정·현재 위치 표시줄(M2 §10-2 별도 마일스톤 — `resultsUsedManualOrigin`·`manualLocationLabel` 분기 없음). 딥링크 보조 출구(장소 상세, M2). 받아쓰기(D9). 위치 권한 UI 자체(M2 `PermissionGate` — M3는 부르기만). 서버 계약 변경 0 — `/api/route/{walk,car,transit}`·`/api/places`·`/api/address/search`·`/api/geocode`·`/api/geocode/reverse`·`/api/places/entrance` 기존 응답 그대로(`RouteService.kt`·`SearchService.kt`가 정본).

**완료 조건**: 실험판 APK를 한소네 7에 설치해 ① 도착지 검색 → 후보 선택 → 경로 조회 → 세 수단 헤딩과 구간 줄이 한 줄씩 점자로 읽힌다 ② 대중교통 대안 행을 펼치면 구간이 이어 읽힌다(위원장 판정, 코디네이터 경유). `android layout`(폴백 `uiautomator dump`) 구조를 보고에 남긴다. 머신 게이트(M1과 같음)는 실기기 없이 초록.

## 2. 아키텍처 (D5 네 계층의 M3 절단면)

```
[4] 화면   DirectionsScreen(탭 루트) = 폼 | 끝점 검색(EndpointSearchContent, 폼을 통째로 교체) ── 상태 구독 ──▶ DirectionsViewModel(StateFlow<DirectionsUiState>, StateFlow<EndpointSearchState?>)
[3] 실행   EndpointLocator(§6, LocationStore·PermissionGate 통과 호출) · SharedPreferencesStore(M1) · HttpUrlConnectionTransport(M0) · Intent(앱 설정)
[2] 판정   :kit  DirectionsEndpoint · DirectionsMode · DirectionsModeOutcome · DirectionsOutcomeClassifier · DirectionsResults · WalkCollapse · RouteService · SearchService(search·geocode·reverseGeocode·destinationEntrance)
                 · RecentSearchStore(endpoints·routes) · TransitWalkLegText · TransitAlternativeName · alightLineText · boardExitAfterWalk · boardExitOnBoardLine · transitLegUsesEnglish · transitAlightStationName · quickExitText
                 · formatDistance · joinText · spokenDistanceUnits · bilingualName · isInKorea · KoreanParticle
[1] 서버   기존 라우트만. 변경 0
```

- **패키지**: `space.dodoplanet.gildongmu.directions` 하나(README §1 규약). 파일: `DirectionsScreen.kt`(폼·결과 섹션) · `EndpointSearchContent.kt`(끝점 검색) · `RouteRows.kt`(수단별 행 렌더·요약 문장 — iOS `RouteBriefing.swift` 대응) · `TransitLegText.kt`(구간 문장·대안 이름 키→리터럴 조회 — iOS `transitLegText`·`transitAlternativeName` 대응) · `DirectionsViewModel.kt`(상태 머신) · `EndpointSearchState.kt`(후보 검색 상태) · `DirectionsPrefill.kt`(§5 계약) · `EndpointLocator.kt`(§6 인터페이스 + 프로덕션 구현 + 팩토리) · `DirectionsStrings.kt`(통지·문장 공급 람다 + ViewModel 팩토리) · `EndpointJson.kt`(필드 저장용 직렬화 미러).
- **`nav/AppRoot.kt` 변경은 등록 한 줄 + import 한 줄**: `composable<DirectionsRoute> { DirectionsScreen() }`. ViewModel 팩토리는 `directions/`가 앱 컨텍스트(`LocalContext.current.applicationContext`)로 스스로 만든다(`MainActivity`는 android-m1 소유라 건드리지 않는다 — M1의 `searchFactory` 주입 방식과 갈리지만 소유권 규약이 우선이고, 통합 뒤 골격 세션이 통일하고 싶으면 팩토리 함수 하나를 옮기면 된다).
- **ViewModel 수명**: 탭 루트 백스택 엔트리에 스코프(`viewModel(factory)` in `composable<DirectionsRoute>`). 탭 전환의 `saveState/restoreState`는 엔트리의 `ViewModelStore`를 보존하므로(공식 문서) 결과·필드가 탭을 떠났다 와도 남는다(iOS `TabView` 안 모델 동형). **탭 이탈은 진행 조회를 취소하지 않는다**(iOS `.onDisappear { model.cancel() }`와 의도된 차이 — ViewModel이 살아 있어 돌아오면 결과가 이미 있고, `StatusLine`은 M1 `initialSeq` 규약으로 재마운트 재발화가 없다). 프로세스 재생성은 **필드(출발·도착·경유)만** `SavedStateHandle`에 JSON으로 복원하고 결과·최근 목록 메모리는 포기한다(iOS는 필드도 잃지만 안드로이드는 백그라운드 프로세스 종료가 잦아 폼을 다시 채우는 비용이 크다 — M1이 검색어를 복원한 것과 같은 판정).
- **끝점 검색은 내비 목적지가 아니라 화면 내 모달 상태**(`endpointSearch: StateFlow<EndpointSearchState?>` — null이면 폼, 값이 있으면 그 `target`의 끝점 검색. 상태 소유는 이 한 곳이다): 열리면 폼 전체를 끝점 검색 콘텐츠로 교체하고 `BackHandler`가 닫는다(iOS 시트 동형 — 필드 확정은 폼의 국소 동작이고 스택에 남을 화면이 아니다). 등록 한 줄 규약도 이것으로 지켜진다. 한 시점에 라이브 리전은 하나뿐(폼의 `StatusLine`은 그동안 컴포즈되지 않는다).
- **판정은 :kit, 화면은 조립만**: 어느 수단이 성공·없음·실패·게이트인지, 섹션 순서, 성공 수, 출구를 어느 줄이 싣는지, 도보 문구 키와 인자 순서, 대안 이름 키는 전부 :kit 함수 결과다. :app은 키 → 리터럴 리소스 조회(`when` 항등 매핑, iOS 관례: 미매핑 키는 디버그 `check`, 릴리스는 키 문자열 노출 — 빈 문자열 금지)와 시각·시맨틱 조립만 한다.

## 3. 화면 구조와 접근성 계약

M1 §3의 기본형(한 줄 = 한 객체, `headingText`, 화면 소유 단일 `StatusLine`, `focusable + FocusRequester` 한 프레임 뒤 착지, `Column + verticalScroll`, `disabled` 금지 → 클릭 무시 + `stateDescription`, 48dp, 이모지 0, 비-ko 병기는 컨테이너 한 곳의 `contentDescription`)을 전부 승계한다. **행 관용구 둘**: 비상호작용 행(구간 줄·스텝·요약·상태)은 `mergedRow(tag, spoken)`, 상호작용 행(필드 버튼·후보·최근 장소·최근 경로·펼침 라벨)은 M1 `RecentRow` 관용구 `clickable(role) + clearAndSetSemantics { contentDescription; stateDescription; customActions }`(`mergedRow`의 `focusable()`과 `clickable`을 겹치면 키보드 순회에 같은 행이 두 번 잡힐 수 있다 — 확인 필요, 그래서 겹치지 않는다). 라벨이 시각과 같은 단순 버튼은 Material3 `Button`(자식 병합 내장). 거리 표기가 든 행의 낭독은 M2 §3-3과 같이 `spokenDistanceUnits(…, android.unit.spokenMeters)`를 거친다(TalkBack이 `m`을 어떻게 읽는지는 M2 §9-12 실기기 판정과 공유 — 오독이 없으면 두 마일스톤이 함께 뺀다).

### 3-1. 길찾기 폼 (`DirectionsScreen`, iOS `DirectionsTabView` 대응)

읽기 순서 = 시각 순서 = 아래 순서. 제목은 M1 검색 화면과 같은 자리(본문 첫 헤딩 — M2가 상단 바로 통일하면 그 커밋이 함께 옮긴다).

| 순서 | 요소 | 계약 |
|---|---|---|
| 1 | 제목 `android.tab.directions`("길찾기") | `headingText()` |
| 2 | 출발지 버튼 | 라벨 = `fieldText(from)`: 확정이면 `"{directions.from}, {값}"`(쉼표 결합 한 객체), 미확정이면 `directions.searchFrom`("출발지 검색")이 곧 이름. 값 = 현재 위치(§3-1-a) 또는 장소 `bilingualName(lang, label, en=null, roman=labelRoman)`(시각 `Roman (한글)`, 낭독 primary — E28). 누르면 끝점 검색(`from`) |
| 3 | 바꾸기 버튼 `directions.swap` | `swap()` — 미확정 null도 그대로 교환, 결과 폐기, 기록 없음 |
| 4 | 도착지 버튼 | 출발지와 같은 꼴(`directions.to`·`directions.searchTo`). 누르면 끝점 검색(`to`) |
| 5 | 경유지 | 미확정: 버튼 `directions.addVia` → 끝점 검색(`via`, 장소만). 확정: 버튼 `"{directions.via}, {병기 이름}"`(누르면 재검색) + 버튼 `directions.removeVia`(누르면 자기가 사라지므로 **조회 버튼으로 선점 착지** 뒤 `clearVia()` — 헌장 §5) |
| 6 | 조회 버튼 `directions.submit` | `runQuery()`. 진행 중(`isBusy` = locating·loading·stepFreeBusy)엔 클릭 무시 + `stateDescription = android.directions.searching`("조회 중")(M1 검색 버튼 동형 — iOS는 라벨 전환이지만 안드로이드 관용구는 상태 설명) |
| 7 | `StatusLine` | 통지 = 상태 문장(§4 표). phase가 바뀔 때마다 seq 증가 |
| 8 | 해결 버튼 | `GeoDenied`: `android.common.openSettings`("설정 열기") → 앱 상세 설정 인텐트. `GeoReduced`: `android.common.allowPrecise`("정확한 위치 허용") → `locator.requestPreciseLocation()`(§6 — `PermissionGate.request()` 재요청, Android 12는 대략적 허용 뒤 재요청에서 정밀 업그레이드 다이얼로그를 띄운다, M2 §4) → 참이면 `runQuery()`, 거짓이면 통지 `android.common.geoReducedDesc` 재게시 + 그 아래 `openSettings` 버튼(M2 §4의 설정 폴백). iOS 동형(granted → `runQuery`, denied → 통지) |
| 9 | 최근 경로 섹션 | `results == null && !isBusy && recentRoutes.isNotEmpty()`일 때만(결과 아래 20행은 탐색 방해, 실패 phase에서는 보인다 — 우회로). 헤딩 `recentRoutes.title` + 행(§3-3) + 버튼 `recentRoutes.clearAll` |
| 10 | (예약) 거리 추적 섹션 | M4 — 조회 버튼과 수단 섹션 사이(iOS 순서). M3에는 없다 |
| 11~ | 수단 섹션 | `results.displayedModes` 순서(:kit 스냅샷 — 성공 앞·비성공 뒤, 30분 이하 도보 승격). 섹션 = 헤딩(`route.public`·`route.car`·`route.pedestrian.heading`, `headingText()` + 도보 헤딩엔 `FocusRequester`) + (예약: 수단별 안내 시작 버튼 자리 — 자동차는 헤딩 바로 아래, 도보·대중교통은 각 경로 행 펼침 본문 첫 항목, M4·M5) + **도보 섹션만 계단 회피 토글**(`dataLocale == ko`일 때, outcome이 `Empty`·`Error`여도 — 켠 뒤 실패해도 되돌릴 수단이 남아야 한다, iOS `outcomeRows` 바깥 동형) + outcome 본문(§3-4) |

**3-1-a 현재 위치 값 텍스트**(F-B): 재측위 중 → `directions.refreshingCurrent`; 주소 확보 → `directions.currentLocationNear(주소)`(비-ko는 `bilingualName(lang, address, en=english, roman=null)` — 시각 display, 낭독 primary); 그 외 `directions.currentLocation`. 주소는 **이미 허가된 세션에서만 조용히**(`locator.coordinateForRanking()` → `SearchService.reverseGeocode(lat, lng, lang=dataLocale)`) 화면 진입 1회 + 측위 성공 시 + "현재 위치 사용" 재선택(강제 재측위) 시 동기화. 실패·매칭 없음은 null로 비운다(옛 좌표 주소를 남기지 않는다). 주소는 부가 정보라 조회 흐름을 어떤 경우에도 막지 않는다. 수동 위치 분기는 없다(범위 밖).

**계단 회피 토글**: `Row.toggleable(value = stepFreeEnabled, role = Role.Switch, onValueChange = { toggleStepFree() })` + 라벨 `route.pedestrian.stepFreeToggle`(재조회 중 `joinText(라벨, android.directions.searching)` — 이 창의 재탭은 가드로 무시되므로 라벨이 유일한 진행 신호) + `Switch(checked, onCheckedChange = null)`.

### 3-2. 끝점 검색 (`EndpointSearchContent`, iOS `DirectionsEndpointSearchView` 대응)

폼을 통째로 교체하는 콘텐츠. 진입 착지 = **검색 입력**(한 프레임 뒤 `FocusRequester` — iOS `searchFieldFocused = true` 동형; 커서가 최상단에 머물면 필드까지 스와이프해 내려가야 한다는 실기기 확인). 닫기 = `BackHandler` 또는 닫기 버튼.

| 순서 | 요소 | 계약 |
|---|---|---|
| 1 | 제목 헤딩 | `directions.searchFrom`·`searchTo`·`searchVia` — exhaustive `when`(iOS 주석: 이분 삼항이 `manualLocation`을 삼킨 실사고) |
| 2 | 닫기 버튼 `actions.close` | 취소 닫기 — 콜백 없음, 포커스는 열었던 필드 버튼으로(§3-5) |
| 3 | 검색 입력 | M1 §3-2와 같은 `TextField(state = TextFieldState)` + `SingleLine` + `ImeAction.Search` + `onKeyboardAction`이 유일한 제출 경로. 라벨 `search.label`, placeholder `android.search.prompt`. 지우기 버튼(`search.clear`) |
| 4 | 검색 버튼 `search.button` | 검색 중 클릭 무시 + `stateDescription = android.search.searching`. 목록 소멸(최근 장소 전부 삭제) 착지점 |
| 5 | "현재 위치 사용" 버튼 `directions.useCurrentLocation` | **`from`에만**(도착지는 스왑이 담당, 경유지는 장소만 — `.Current`가 구조적으로 못 들어온다). 선택 = `.Current` 확정 + 강제 재측위·주소 새로고침 트리거 |
| 6 | `StatusLine` | 후보 통지(§4 표) |
| 7 | 최근 장소 섹션 | `!hasSearched && recentEndpoints.isNotEmpty()`(tri-state — 0건·실패 뒤 재노출 회귀 방지). 스코프 = 필드(`from`·`to`·`via` 분리 저장, :kit `RecentEndpointScope`). 헤딩 `recent.title` + 행(버튼, 라벨 = `label` **원문 그대로**(저장소에 로마자가 없다 — iOS 동형), 고정 = `stateDescription = recent.pinned`, 커스텀 액션 고정/해제·삭제 — **M1 §3-5 판정 조건 승계**(점자 미도달이면 보이는 버튼), 활성화 = 즉시 확정 `.Place(label, lat, lng)`) + 버튼 `recent.clearAll`. 삭제 착지: 다음 행 → 이전 행 → 목록 소멸 시 **검색 버튼**(iOS 마이크 행의 자리) |
| 8 | 장소 후보 행 | 버튼, 라벨 = `joinText(name.display, roadAddress.ifEmpty { address })`, 낭독 `joinText(name.primary, …)`(`bilingualName(lang, name, en=null, roman=nameRoman)`). 선택 = `.Place(label=name, lat, lng, labelRoman=nameRoman)` 확정 |
| 9 | 주소 후보 행 | 버튼, 라벨 = `bilingualName(lang, roadAddr, en=engAddr, roman=null)`. 선택 = `/api/geocode`(`roadAddrPart1` 비면 `roadAddr`) 1건 → `.Place(label=그 주소, labelRoman=engAddr 공백 정리 or null)`. 실패·0건 → 통지 `directions.coordError` + 화면 유지. 지오코딩 in-flight 가드(연타 무시) |

- 후보 검색: `SearchService.search(query, lat, lng, lang=dataLocale, includeWeb=false)` — 좌표는 `locator.coordinateForRanking()`(허가된 세션만, 팝업 없음) — 장소·주소 각 상위 5건. 후보 도착 시 **첫 후보 행 착지**(M1 첫 결과 착지 관용구, 통지가 잘리는 것은 iOS와 같이 수용).
- 확정 = `select(endpoint)` → `setEndpoint`/`setVia` → `closePicker(resolved = target)` → §3-5 착지. **닫힘은 결정과 무관하게 후보 검색 Job·지오코딩 Job을 취소한다**(iOS `.onDisappear { model.cancel() }` 동형, CLAUDE.md 채팅 `aliveRef` 이탈 게이트) — 취소로 닫은 뒤 도착한 지오코딩 결과가 필드를 확정하거나 후보 도착이 유령 착지를 일으키지 않는다.
- 받아쓰기 행 없음(D9). 마이크 마일스톤이 M1 `isDictationAvailable` 게이트로 이 화면의 검색 버튼 뒤에 넣는다(자리 예약).

### 3-3. 최근 경로 행

라벨 = `recentRoutes.item(from, to)` 또는 경유지 있으면 `recentRoutes.itemVia(from, to, via+조사)`(ko는 `KoreanParticle.objectMarker(via) ?: ""`를 호출부가 붙인다 — 조사가 받침에 따라 갈려 자원에 못 박는다, iOS·웹 동형; 비-ko는 조사 없음). `from`·`to` null = `directions.currentLocation`. 고정은 `stateDescription = recent.pinned`, 커스텀 액션 고정/해제(삭제보다 앞)·삭제(M1 판정 조건 승계). 활성화 = **조회 버튼 선점 착지** → `setEndpoint(from)`·`setEndpoint(to)`·경유지(있으면 `setVia` 없으면 `clearVia`) → `runQuery()`(결과 도착 시 섹션이 통째로 사라지므로 선점, 헌장 §5). 삭제 착지 다음 → 이전 → 목록 소멸 시 조회 버튼. 고정 토글은 화면 자리 유지(정렬은 다음 로드부터), 통지 없음(`stateDescription` 변화가 신호). 모두 지우기는 고정 보존 — 남으면 `recent.clearedExceptPinned`(포커스 무이동), 비면 `recentRoutes.cleared` + 조회 버튼 착지.

### 3-4. 수단 섹션 outcome 본문 (`RouteRows.kt`, iOS `outcomeRows`·`RouteBriefing.swift` 대응)

**펼침 행(disclosure)의 안드로이드 문법**: 라벨 행 = `clickable(role = Role.Button)` + `clearAndSetSemantics { contentDescription = 라벨; stateDescription = android.common.expanded / collapsed }`("펼침"/"접힘") + 클릭 토글, 본문은 펼쳐진 동안만 컴포즈(접힌 본문은 트리에 없다 — iOS DisclosureGroup 동형). Compose `expand()/collapse()` 시맨틱 액션은 쓰지 않는다(공식 문서가 상태 전달에 `stateDescription`을 권하고 M1 관용구와 같다). §10-6 실기기 판정에서 TalkBack이 상태를 두 번 읽으면 `stateDescription`을 빼고 시맨틱 액션만 남긴다.

| outcome | 본문 |
|---|---|
| `Transit(result)` | 항목 = 추천 1 + 대안 ≤4, 한 목록(`transitRouteEntries`): 이름 = 추천 `route.transit.recommended`, 대안 `TransitAlternativeName.key(highlight, displayIndex)` → 리터럴 `when`(`alternativeFastestFewestTransfers`·`alternativeFewestTransfers`·`alternativeFastest`·`alternativeHeading(index)`). 라벨 = `joinText(이름, transitSummaryText(summary))`(요약 = `android.route.durationMinutes(totalMinutes)`, `android.route.fare(wonText(fare))`, `android.route.transfers(transfers)`, `walkMinutes > 0`이면 `android.route.walkMinutes`). 초기 펼침: 추천만. 펼침 상태 키 = `routeKey`(배열 인덱스·표시 번호 금지, spec §4.2) — `expandedAlts: Set<routeKey>` = "기본값과 다른 것"의 집합, 새 조회(`resultsRevision`)에 비운다. 본문 = 구간 행(§3-4-a) + 하차 줄(§3-4-b) — 라벨이 요약이라 본문에 요약 재낭독 없음 |
| `Walk(briefing)` | 추천 행: 펼침 라벨 `joinText(directions.walkRecommended, walkSummaryText(briefing), briefing.stepFreeNotice)`, 초기 펼침 = `!WalkCollapse.shouldCollapse(durationSeconds)`(:kit — 판정과 표시가 같은 반올림 분), 사용자 조작은 `walkExpandedOverride: Boolean?`(새 조회에서만 null 복귀, 토글 재조회에서는 보존). 최단 행: `walkShortest != null`일 때만(같은 응답 쌍만, 부재·실패는 행 자체 없음 — 死행 금지), 라벨 `joinText(directions.walkShortest, walkSummaryText(shortest), shortest.stepFreeNotice)`(**각 행은 자기 브리핑의** notice), 기본 접힘, 새 조회에 접힘. 본문 = 스텝 행(§3-4-c) |
| `Car(briefing)` | 요약 1행 `joinText(android.route.totalDistance(formatDistance(distanceMeters)), android.route.durationMinutes(durationSeconds/60), android.route.taxiFare(wonText(taxiFare)), tollFare > 0 ? android.route.tollFare(wonText) : null)` + 안내 행(§3-4-d). 펼침 없음(경로 하나) |
| `Empty` | 텍스트 `route.transit.noRoute` / `route.pedestrian.noRoute`(car는 Empty가 없다) |
| `Error` | 텍스트 `route.transit.error` / `route.pedestrian.error` / `route.briefing.error` |
| `UnsupportedWaypoint` | 텍스트 `directions.unsupportedWaypoint`(대중교통 + 경유지) |
| `Gated`·`OutOfCoverage` | `displayedModes`가 걸러 도달하지 않는다 |

- `walkSummaryText(b)` = `route.pedestrian.summary(formatDistance(b.distanceMeters), walkDisplayMinutes(b))`, `walkDisplayMinutes(b) = (b.durationSeconds / 60.0).roundToInt()` — **`WalkCollapse.shouldCollapse`와 같은 반올림**이어야 한다(경계에서 "약 30분인데 접혔다" 방지, iOS `walkDisplayMinutes` 주석의 실사고). 테스트가 두 값의 동일성을 단언한다.
- `wonText(amount)` = `NumberFormat.getIntegerInstance(Locale.forLanguageTag(AppLocale.current(res)))` — 앱 UI 로케일의 천 단위 구분(iOS `formatted(.number.grouping(.automatic))`가 기기 로케일을 따르는 것의 대응. 판정 §11-14).

**3-4-a 구간 행**(`TransitLegText.kt`, iOS `transitLegLine`·`transitLegText`): 한 줄 = 한 객체, `mergedRow(spoken)`(시각·낭독이 갈리는 병기만 spoken). 승차 출구(E25)는 두 줄 중 **하나만**: 도보 줄이면 `boardExitAfterWalk(legs, index)`, 탑승 줄이면 `boardExitOnBoardLine(legs, index)`(:kit 배타 술어). 영어 자격은 `transitLegUsesEnglish(leg, DataLocale)`(:kit) 하나 — 자격이 없으면 한국어 문장. 자격이 있으면: 도보 줄은 영문 행선지(`toNameEn`)로 시각·낭독 같은 문장, 탑승 줄은 **승차·하차 역명 두 자리만** `bilingualName(lang, ko, en, roman=null)`(시각 `English (한글)` 병기, 낭독 primary = 영문)이고 **노선 이름은 `lineNameEn` 그대로**(병기 없음 — iOS `pick()`은 from/to에만).
- 도보 구간: `name = firstNonEmpty(toName, destinationName)`(빈 문자열도 폴백 대상 — iOS `first { !$0.isEmpty }`; :kit `firstNonEmpty`는 internal이라 `takeIf { isNotEmpty() }` 체인으로), `TransitWalkLegText.resolve(name, distance = distanceMeters?.let(formatDistance), minutes, boardExit)` → 6키 리터럴 `when`(`legWalkTo`·`legWalkToNoDistance`·`legWalkToExit`·`legWalkToExitNoDistance`·`legWalkToDest`·`legWalkToDestNoDistance`). 마지막 도보는 행선지가 없어 `destinationName`(§4 승격본 우선 → 도착지 장소 라벨 → 현재 위치면 null → "목적지까지").
- 탑승 구간: 노선 = `(영어 자격이면 lineNameEn else lineName)?.trim()`, **trim 뒤 빈 문자열은 없음**(ODsay `busNo` 결측 `" "`가 "번 버스"로 낭독된 iOS 실사고), 버스면 `route.transit.busNo(번호)`. `joinText(노선, android.route.board(from), android.route.alight(to), stationCount?.let(버스 android.route.stopCount / 지하철 android.route.stationCount — 수량 인자 직접, A29), android.route.legMinutes(minutes), boardExit?.let(route.transit.legBoardExit), serviceStatus == "outside" && first,last 있으면 route.transit.legServiceOutside(first, last))`.

**3-4-b 하차 줄**: `alightLineText(quickExit, station = transitAlightStationName(leg, DataLocale), exitAlight = leg.exit?.alight, lang = AppLocale.current(res), exitBound = { appLocalized(transitGuide.exitBound, it) })`(:kit) — null이면 행 없음(3-state). ⚠ 두 언어 인자는 **다른 축**이다: `station`은 데이터 언어(`DataLocale`, ko|en), `lang`은 **앱 UI 언어**(:kit 카탈로그 `route.transit.alightAt`·`quickExit*` 조회 — ja·es·fr·it 사용자에게 하차 줄만 영어가 되지 않게, iOS `lang: AppLanguage.current` 동형). 구간 행과 별개 객체(합치지 않는다 — "무슨 열차"와 "어디로 내려 나가나"가 스와이프 한 번에 갈린다).

**3-4-c 도보 스텝 행**: 원본 인덱스로 순회하며 `waypoint.stepIndex == index`인 자리 앞에 `directions.viaArrived(viaLabel)` 구획 행(번호 없음, `viaLabel`이 있을 때만), `description` 비면 생략, `index == 0 && description == stepFreeNotice`이면 생략(라벨이 notice를 병기하므로 **항상** — 인자 없는 상수 동작, iOS `omitNoticeStep: true` 두 소비자만 남았다). 번호 = **원본 인덱스 + 1**(웹·CLI·iOS와 같은 값 — 생략으로 밀지 않는다). 텍스트 `"{n}. {description}"`, 낭독 `spokenDistanceUnits`.

**3-4-d 자동차 안내 행**: `guides` 순회, `waypoint.stepIndex == index` 자리 앞 `directions.viaArrived`, 텍스트 = `guidance` 비면 `name`, 둘 다 비면 행 생략, `joinText(text, distanceMeters > 0 ? formatDistance : null)`(iOS 정본 — 웹은 name+guidance 결합이지만 Swift가 정본).

### 3-5. 커서 착지 표

| 사건 | 착지 | 방식 |
|---|---|---|
| 끝점 검색 열림 | 검색 입력 | `FocusRequester` 한 프레임 뒤 |
| 후보 도착(`candidateRevision`) | 첫 후보 행(장소 먼저, 없으면 주소) | M1 첫 결과 관용구(`consumedRevision` 비저장) |
| 확정으로 닫힘 | `from` → **도착지 버튼**, `to`·`via` → **조회 버튼**(셋 다 "다음에 할 일") | `focusAfterResolve` 예약 → 폼 재컴포즈 뒤 한 프레임 |
| 취소로 닫힘 | 열었던 필드 버튼 | 같은 방식(iOS는 시스템 기본에 맡겼지만 안드로이드는 콘텐츠 교체라 기본 복귀가 없다) |
| 경유지 삭제 | 조회 버튼(선점) | 핸들러 첫 줄 |
| 최근 경로 활성화 | 조회 버튼(선점) | 핸들러 첫 줄 |
| 최근 경로·최근 장소 삭제 | 다음 → 이전 → 소멸 시 조회 버튼 / 검색 버튼 | M1 `pendingLanding` 키 관용구(항목 키 = `RecentRoute.id`·`RecentEndpoint.id`, 인덱스 금지) |
| 프리필 `from` 진입 | 도착지 버튼 | `prefillFocusRevision` 변화에 한 프레임 뒤(§5) |
| 조회 완료(`resultsRevision`) | **이동 없음**(위원장 판정 2026-08-02 — 조회 버튼에 머물면 다음 스와이프가 상태 → (추적) → 수단 순으로 이어진다). 완료는 통지가 알린다 | — |
| 계단 회피 재조회 완료(`walkRefetchRevision`) | 도보 헤딩 | `FocusRequester` 한 프레임 뒤 |
| 펼침 토글·고정 토글 | 이동 없음(`stateDescription` 변화가 신호) | — |

## 4. 상태 머신 (`DirectionsViewModel`, iOS `DirectionsModel` 미러)

```
DirectionsUiState(
  from: DirectionsEndpoint? = Current, to: DirectionsEndpoint? = null, via: DirectionsEndpoint.Place? = null,
  phase: Phase = Idle,                       // Idle · NeedEndpoints · Locating · Loading · GeoDenied · GeoReduced · GeoError · OutOfCoverage · Settled(successCount)
  results: DirectionsResults?, walkShortest: WalkRouteBriefing?,    // 같은 응답 쌍만 함께(스냅샷 교체)
  promotedDestination: Promoted(label, lat, lng)?,                   // results와 같은 순간에만 커밋
  resultsRevision: Int, walkRefetchRevision: Int, prefillFocusRevision: Int,
  stepFreeEnabled: Boolean, stepFreeBusy: Boolean, isRefreshingCurrent: Boolean,
  currentAddress: String?, currentAddressEnglish: String?,
  recentRoutes: List<RecentRoute>,
  notice: Notice)
isBusy = phase ∈ {Locating, Loading} || stepFreeBusy
endpointSearch: StateFlow<EndpointSearchState?>   // null = 폼. EndpointSearchState(target, queryState: TextFieldState, places ≤5, addresses ≤5, hasSearched, isSearching, candidateRevision, recentEndpoints, notice)
```

- **필드 확정**: `setEndpoint(endpoint, target)` = 전체 교체(원자) + 장소면 `RecentSearchStore.recordEndpoint(scope)` + `clearResults()`. `setVia(place)`·`clearVia()`·`swap()`도 `clearResults()`. `clearResults()` = 진행 조회 취소(`queryJob.cancel()`) + `isInFlight=false`·`stepFreeBusy=false` + results·walkShortest·promoted 비움 + phase Idle. 늦은 응답은 `ensureActive()`(취소 확인)로 상태를 쓰지 않는다.
- **`runQuery()`**: `isInFlight`면 무시(재진입 가드, 토글 재조회와 **같은** 가드). `from`·`to` 둘 중 하나라도 null → `NeedEndpoints` + 통지 `directions.needEndpoints`(조회 없음). 아니면 `queryJob = viewModelScope.launch { performQuery() }`.
- **`performQuery()`** 순서(iOS 그대로):
  1. results·walkShortest·promoted 비움.
  2. `from`·`to` 중 `Current`가 있으면 `Locating` → `locator.currentCoordinate(force=false)`. 실패 `LocationException.kind`: `Denied` → `GeoDenied`, `ReducedAccuracy` → `GeoReduced`, `Unavailable` → `GeoError`(각 통지 = phase 문장, 3-state). 성공: `!isInKorea(lat,lng)` → `OutOfCoverage`(upstream 0 호출) return; 주소 동기화는 별도 `viewModelScope.launch`(조회 취소에 딸려가지 않는다).
  3. `origin`·`queried`(도착지 좌표) 해석. 경유지 좌표가 `!isInKorea` → `OutOfCoverage` return.
  4. `Loading`(승격 왕복 **앞**에서 — 그 사이 화면이 직전 settled에 머물면서 결과만 빈 창이 생기지 않게). 도착지가 `Place`이고 `dataLocale == "ko"`면 `searchService.destinationEntrance(name, lat, lng, fromLat, fromLng)`(2초 예산은 :kit) → 있으면 `dest`·`promoted` 교체(실패·부재는 조용히 원래 목적지). `lastCoords = (origin, dest, via)`.
  5. 3수단 병렬(`coroutineScope { async(io) }`): transit(`include = via == null`, `includeStops=true`, lang=dataLocale) · walk(`walkAlternatives(accessible = stepFreeEnabled && dataLocale == ko, lang=DataLocale, via)`) · car(`lang=dataLocale, via`). 각각 15초 상한 — **`withTimeoutOrNull(15_000) { settle { … } }`의 블록이 `Result<T>`를 돌려주게 해 바깥 null이 만료만 뜻하게 한다**(`boxed ?: Result.failure(DirectionsQueryTimeout)`). ⚠ 블록 값을 그대로 두면 `transit`의 정상 "경로 없음"(null)이 만료 null과 같은 값이 되어 `Error`로 낭독된다(3-state 붕괴). `settle { }`은 `CancellationException`만 다시 던지는 자체 래퍼(`runCatching` 금지, README §3). `withTimeout`의 `TimeoutCancellationException`은 `CancellationException`이라 `DirectionsOutcomeClassifier`가 **다시 던진다**(취소로 오분류) — `OrNull` 판이 필수.
  6. 분류: transit = `include ? classifyTransit(result) : UnsupportedWaypoint`, car = `classifyCar`, walk = `classifyWalk(result.map { it.result })`, `shortestCandidate = 성공이면 pair.shortest`.
  7. 어느 하나 `isOutOfCoverage` → `OutOfCoverage`(전체 전환, 나머지 결과 폐기) return.
  8. `DirectionsResults(outcomes)` 생성 → results·walkShortest·promoted를 **같은 순간** 커밋 → `Settled(successCount)` → `recordRoute(from, to, via)`(Current는 null 투영) → `resultsRevision++` → 통지 `directions.readySummary(count)` 또는 `directions.allFailed`(합산 1문장, 수단별 개별 통지 금지).
- **`toggleStepFree()`**: `isInFlight`면 무시. `stepFreeEnabled` 반전. `results != null && lastCoords != null`이면 도보만 재조회(`stepFreeBusy=true`, 같은 `queryJob`·가드): `walkAlternatives` → `classifyWalk`(`OutOfCoverage`면 `Error`로 접는다 — 부분 재조회가 다른 수단을 버리지 않는다) → `results.replacingWalk(outcome)`(순서 보존, :kit) → `walkShortest = 새 쌍의 shortest` → `walkRefetchRevision++`(통지 없음 — 도보 헤딩 착지가 신호). 조회 전 토글은 상태만.
- **`refreshCurrentLocation()`**("현재 위치 사용" 재선택, F-B): `isRefreshingCurrent` 가드 → `locator.currentCoordinate(force=true)` → 성공 시 주소 동기화, 실패는 조용히 직전 라벨 유지(재측위 = 재조회이지 데이터 포기 아님). 진행 신호는 필드 라벨의 `directions.refreshingCurrent` 전환만.
- **`loadCurrentAddressIfAuthorized()`**(화면 진입 1회, `hasLoadedCurrentAddress` 가드): 어느 필드가 `Current`이고 `locator.coordinateForRanking()`이 좌표를 주면 주소 동기화. 팝업 없음.
- **`requestPreciseLocation()`**(GeoReduced 해결 버튼): `locator.requestPreciseLocation()` 참 → `runQuery()`, 거짓 → 통지 `android.common.geoReducedDesc` 재게시(seq 증가).
- **최근 경로**: `recentRoutes = store.routes()`(init 로드 — 읽기만), `removeRoute`·`clearRoutes`·`setRoutePinned`(화면 배열은 그 자리 교체). 삭제는 착지 키(`RecentRoute.id`)를 돌려준다(M1 `removeRecent` 동형, 소멸이면 null).
- **끝점 검색**: `openPicker(target)` → `EndpointSearchState(target, scope 최근 장소 로드)`; `submitCandidates()`(trim 비면 무시, `hasSearched=true`, 앞 Job 취소, `coordinateForRanking()` 좌표 → `search(includeWeb=false)` → 상위 5·5 → `candidateRevision++` → 통지); `geocodeAndSelect(address)`(in-flight 가드, Job 보관); `select(endpoint)` → `setEndpoint`/`setVia` → `closePicker(resolved = target)`; `closePicker(resolved)` = **검색 Job·지오코딩 Job 취소** + `endpointSearch = null`(취소 뒤 도착한 응답은 상태를 쓰지 않는다 — `ensureActive`). 최근 장소 삭제·고정·모두 지우기는 M1 관용구.
- **프리필 소비**(§5): ViewModel `init`이 `DirectionsPrefillStore.pending`(StateFlow)을 `collect`해 값이 오면 `compareAndSet(value, null)`로 가져가 `applyPrefill(prefill)` = `from = role==from ? place : Current`, `to = role==to ? place : null`, `clearVia()`, `clearResults()`, 장소 `recordEndpoint`(iOS `consumeDirectionsPrefill`이 하던 기록), 그리고 양끝이 다 있으면 `runQuery()`(in-flight 가드에 흡수돼도 소비된 것으로 친다 — 두 번 조회하지 않는다), `to`가 비면 `prefillFocusRevision++`(화면이 도착지 버튼에 착지). 컴포지션 재진입과 무관하게 **값이 오는 즉시** 소비되므로 길찾기 탭이 이미 보이는 상태에서 불려도 남는 값이 없다. ViewModel이 아직 없으면(첫 진입) `StateFlow`가 현재 값을 재생해 `init`에서 소비한다.

**통지 표**(단일 polite 창구 = 상태 문장, phase가 바뀔 때마다 seq 증가):

| phase / 사건 | 문장(키) |
|---|---|
| Idle | 빈 문자열(통지 없음 — `StatusLine`이 점자에서 건너뛴다) |
| NeedEndpoints | `directions.needEndpoints` |
| Locating | `directions.locating` |
| Loading | `directions.loading` |
| GeoDenied | `android.common.geoDeniedDesc`(M2 문안 "설정에서 길동무의 위치 접근을 허용해 주세요") |
| GeoReduced | `android.common.geoReducedDesc`(M2 문안) |
| GeoError | `directions.geoError`("… 출발지를 검색해 지정해 주세요" — 거부와 다른 문장, 우회 안내) |
| OutOfCoverage | `android.common.outOfCoverage` |
| Settled(n>0) / Settled(0) | `directions.readySummary(n)` / `directions.allFailed` |
| 최근 경로 삭제·모두 지움 | `recent.deleted` · `recentRoutes.cleared` · `recent.clearedExceptPinned` |
| 끝점 검색: 후보 n>0 / 0건 / 둘 다 실패 / 지오코딩 실패 | `directions.candidateCount(n)` / `directions.candidateNone` / `directions.candidateError` / `directions.coordError`(3-state) |
| 끝점 검색: 최근 장소 삭제·지움 | `recent.deleted` · `recent.cleared` · `recent.clearedExceptPinned` |
| 토글 재조회 완료 · 고정 토글 · 펼침 | 통지 없음(착지·`stateDescription`이 신호) |

진동(`ResultHaptic`)은 두지 않는다(M2 §10-5 승계 — D10, M4 소리 설계와 함께 판정).

## 5. 프리필 진입 계약 (M2 장소 상세 → 길찾기 탭, iOS `DirectionsPrefillStore`+`DirectionsPrefill{role,endpoint}` 미러)

**M2(android-m1)가 부르는 API는 함수 하나다** — `directions/DirectionsPrefill.kt`:

```kotlin
enum class DirectionsPrefillRole { from, to }          // iOS `DirectionsPrefill.Role`
data class DirectionsPrefill(
    val role: DirectionsPrefillRole,
    val label: String, val lat: Double, val lng: Double,   // 장소 이름·좌표(iOS `.place(label, lat, lng, labelRoman)`)
    val labelRoman: String? = null,                        // `Place.nameRoman`(E28 병기)
)
/** 길찾기 탭으로 전환하며 프리필을 넘긴다. 장소 상세의 "여기까지 길찾기"(role=to)·"여기부터 길찾기"(role=from)가 부른다. */
fun NavController.openDirections(prefill: DirectionsPrefill)
```

- **동작**: `DirectionsPrefillStore.pending`(`MutableStateFlow<DirectionsPrefill?>`, 앱 싱글턴, 1회 소비)에 값을 놓고 → 탭 루트 `DirectionsRoute`로 이동(`AppRoot`의 탭 전환과 같은 옵션 `popUpTo(startDestination){saveState=true}; launchSingleTop; restoreState`). 길찾기 `DirectionsViewModel`이 그 플로를 `collect`해 값이 오는 즉시 소비한다(§4 프리필 소비) — 길찾기 탭이 이미 현재 목적지라 재컴포지션이 없어도 소비된다(M4 "안내 중 목적지 변경"·M6 채팅 카드가 같은 함수를 부를 때의 함정 차단). 직렬화 어노테이션은 없다 — 라우트 인자가 아니고 메모리 스토어다(YAGNI).
- **진입 시 동작(못 박음)**: `role = to` → 출발지 = 현재 위치, 도착지 = 그 장소, **양끝이 다 있으므로 즉시 자동 조회 1회**(사용자가 조회 버튼까지 스와이프하지 않는다, 위원장 실사용 2026-09-02). `role = from` → 출발지 = 그 장소, 도착지 = 비움, 조회 대신 **도착지 버튼에 착지**(다음 행동이 도착지 입력이고, 이 상태의 조회는 "도착지를 입력하세요" 오류가 된다 — E32). 두 경우 모두 이전 결과·필드·경유지는 폐기되고(iOS `directionsEpoch` 재생성 동형), 장소는 해당 스코프 최근 장소에 기록된다. 소비는 **1회**(탭을 떠났다 돌아와도 재조회하지 않는다).
- **왜 라우트 인자가 아니라 스토어인가(판정)**: ① 탭 루트는 `nav/Routes.kt`의 `data object DirectionsRoute`(android-m1 소유)라 인자를 실으려면 타 세션 파일을 고쳐야 한다(소유권 — 이것만으로 충분). ② 탭 전환의 `restoreState=true`가 저장된 백스택을 복원할 때 새 `navigate` 인자와 복원 인자의 우선순위는 공식 문서가 밝히지 않는다(**확인 필요** — 어느 쪽이든 인자 경로는 그 불확실성을 진다). ③ ViewModel이 그 엔트리에 살아 있어 인자 변화를 따로 관찰해야 한다. iOS가 `LaunchActionStore`와 별개로 `DirectionsPrefillStore`를 둔 이유(다른 탭 상태 보존 + 1회 소비)와 같은 구조가 가장 단순하다. 라우트 모양은 바뀌지 않는다(등록 한 줄 그대로).
- **M2 배선 자리**: M2 spec §3-2 표 12(길찾기 헤딩) 바로 아래 버튼 2개 — `directions.toHere`("여기까지 길찾기") → `navController.openDirections(DirectionsPrefill(to, place.name, place.lat, place.lng, place.nameRoman))`, `directions.fromHere` → `role = from`. 이 두 줄 외에 `directions/`를 알 필요가 없다.

## 6. 위치 계층 소비 (M2 `LocationStore`, main `7a4a9379`)

`directions/EndpointLocator.kt`:

```kotlin
interface EndpointLocator {
    /** 조회 시점 측위(권한 다이얼로그 허용). 실패는 `LocationException(kind ∈ Denied·ReducedAccuracy·Unavailable)`. 취소는 그대로 통과. */
    suspend fun currentCoordinate(force: Boolean): NearbyCoord
    /** 라벨 병기·후보 정렬용 soft 좌표 — 권한 없으면 팝업 없이 null, 실패는 스토어 폴백(없으면 null). */
    suspend fun coordinateForRanking(): NearbyCoord?
    /** "정확한 위치 허용" — 권한 재요청 뒤 FINE이면 true(M2 §4 `allowPrecise` 절차). */
    suspend fun requestPreciseLocation(): Boolean
}
```

- **프로덕션 구현** `LocationStoreLocator(store = AppConfig.locationStore, permissions = AppConfig.permissionGate)`: 앞 둘은 `store`로 **통과 호출**(이름·인자·반환·예외가 같다 — 번역 층 없음), `requestPreciseLocation() = permissions.request() == LocationPermission.Fine`. 팩토리 `directionsLocator()`는 이 파일에 둔다. 인터페이스가 남는 이유는 하나 — JVM 테스트의 페이크 자리(`LocationStore`를 `LocationSource`·`PermissionGate` 페이크로 조립하는 것보다 세 함수 페이크가 짧다).
- **의존 문장(코디네이터 전파 요망)**: M2 spec §4는 "권한 요청은 내 주변 화면 진입(로드)에서만"이라고 적었다. 실코드 `LocationStore.currentCoordinate`는 호출 경로를 가리지 않고(길찾기 조회도 iOS와 같이 묻는다 — `DirectionsModel.performQuery` 주석 "권한 팝업도 이 시점") 그대로 성립하지만, 문장은 "내 주변 진입 + 길찾기 조회"로 넓혀야 한다.
- `directions/`는 `android.location.*`·`LocationManager`를 import하지 않는다(M2 `AppSourceGuardTest`가 이미 잠근다). 앱 설정 열기 인텐트 세 줄은 M2 `nearby/`에도 생긴다 — M2 통합 뒤 `location/`(또는 공용) 함수 하나로 합친다(잉여 회수 약속).

## 7. 실행 계층

| 기능 | 구현 |
|---|---|
| 저장 | M1 `SharedPreferencesStore(app)`(파일 `gildongmu.recent`) → :kit `RecentSearchStore`(키 `recentEndpoints.{scope}.v1`·`recentRoutes.*` — iOS UserDefaults 키 그대로). 첫 로드는 `io`, 이후 갱신은 main(M1 판정 — 착지 대상을 동기로 돌려줘야 한다) |
| 네트워크 | `AppConfig.apiClient` 공유 → `RouteService`·`SearchService`. 수단 조회는 `Dispatchers.IO`에서 |
| 앱 설정 열기 | `Intent(ACTION_APPLICATION_DETAILS_SETTINGS, "package:" + packageName)`(§6 잉여 회수 약속) |
| 필드 저장 | `EndpointJson`(`@Serializable` 미러: `current` / `place{label,lat,lng,labelRoman}`) ↔ `DirectionsEndpoint`. `SavedStateHandle["from"|"to"|"via"]` |
| 위치 | §6 |

## 8. i18n

- **android-extra 추가 키**(6로케일, iOS 카탈로그와 같은 문장 — 한 앱의 두 플랫폼이 다른 말을 하지 않는다. `ios.X` → `android.X` 스크립트 복사): `android.route.{totalDistance,durationMinutes,taxiFare,tollFare,fare,transfers,walkMinutes,board,alight,stopCount,stationCount,legMinutes}`(12), `android.directions.searching`, `android.common.{outOfCoverage,openSettings,allowPrecise}`, `android.unit.spokenMeters`. M2가 정의한 문안을 그대로 쓰는 키: `android.common.geoDeniedDesc`·`android.common.geoReducedDesc`(M2 §7 문안 — M2가 먼저 오르면 그 값, 아니면 M3가 같은 문안으로 먼저 넣고 rebase 때 양쪽 보존). **안드로이드 전용 신설**: `android.common.expanded`("펼침")·`android.common.collapsed`("접힘")(iOS DisclosureGroup 네이티브 상태의 대응물).
- 웹 키 그대로 쓰는 것: `directions.*`(폼·후보·경유지·`walkRecommended`·`walkShortest`) · `route.transit.*`(추천·대안 이름·도보 구간 6키·`busNo`·`legBoardExit`·`legServiceOutside`·`noRoute`·`error`; `alightAt`·`quickExit*`는 :kit 카탈로그 조회) · `route.pedestrian.*` · `route.briefing.error` · `route.public`·`route.car` · `recent.*`·`recentRoutes.*` · `transitGuide.exitBound` · `actions.close` · `search.label`·`search.clear`·`search.button` · `android.search.prompt`·`android.search.searching`(M1) · `android.tab.directions`.
- 인자 있는 문자열은 전부 `appLocalized`(소스 가드 M1). 새 키의 ko 인자 순서는 스크립트가 `arg-order.json`에 등록한다(신규 등록은 게이트 통과, 기존 키 순서 변경만 exit 1). `route.transit.legBoard`류의 리치 태그 키(`<from></from>`)는 웹 전용이라 쓰지 않는다(iOS도 `ios.route.board`).
- M2의 ios-extra 일괄 도입(`ios.*` → `android.*` 개명)이 먼저 오르면 M3의 android-extra 항목은 같은 이름·같은 문안의 오버라이드가 되어 드리프트 테스트 (5) 일반화판을 그대로 통과한다. `expanded`·`collapsed`는 iOS 짝이 없어 대조 대상이 아니다.

## 9. 게이트와 테스트 레인

M1 §7 게이트 그대로(`:kit:test` · `:app:testDebugUnitTest` · assemble 두 구성 · `VITEST_MAX_THREADS=2 npm run test:run`, 락 안). :kit 변경 0(등록부 무변경). `viewModelScope` 테스트는 M1 `MainDispatcherExtension`(JUnit5 `@RegisterExtension`)을 쓴다. M3가 더하는 테스트:

- **JVM(:app) `DirectionsViewModelTest`**(스텁 전송 + Kit 실캡처 fixture `route-transit.json`·`route-walk.json`·`route-walk-no-route.json`·`route-car.json`, 페이크 `EndpointLocator`): 끝점 부재 → NeedEndpoints·조회 0 / 3수단 성공 → Settled(3)·`displayedModes` 순서·통지·최근 경로 기록·revision 1 / **transit 응답 `{}`(result 없음) → `Empty`(`route.transit.noRoute`), 성공 수는 2** / 수단별 15초 초과 → 그 수단만 Error(다른 수단 유지) / 측위 Denied·ReducedAccuracy·Unavailable → 3 phase 3 문장 / `requestPreciseLocation` 참 → 재조회, 거짓 → 통지만 / 현재 위치 한국 밖(후쿠오카) → OutOfCoverage·upstream 호출 0 / 서버 마커 → 전체 전환 / 경유지 → transit 미호출·UnsupportedWaypoint·walk·car 쿼리에 `via` / 경유지 한국 밖 → OutOfCoverage / 계단 회피: 조회 전 토글은 상태만, 조회 후 토글은 walk만 재호출(`accessible=true`)·순서 보존·`walkRefetchRevision` 1·walkShortest 교체 / 필드 변경이 진행 조회를 취소하고 늦은 응답이 상태를 쓰지 않는다 / swap 원자 교환 / 출입구 승격: entrance 응답 시 세 수단 `dest`가 승격 좌표·`promotedDestination` 커밋, 실패·부재 시 원좌표·null, en에서는 미호출 / 프리필 `to` → 자동 조회 1회(재소비 0)·기록, `from` → 조회 0·`prefillFocusRevision` 1, **ViewModel이 살아 있는 채로 스토어에 값이 오면 즉시 소비** / 최근 경로 삭제 착지 다음·이전·null / 끝점 검색: 5·5 절단, 3-state 통지, 지오코딩 실패 → coordError·미확정, in-flight 가드, `from`에만 현재 위치, **지오코딩 왕복 중 닫으면 필드가 바뀌지 않는다**, 닫으면 검색 Job 취소 / 필드 JSON 왕복.
- **JVM(:app) `RouteRowsTest`·`TransitLegTextTest`**(문자열 공급 페이크): fixture 추천 경로의 구간 줄 5개 문장(ko), 승차 출구 배타(도보 뒤 탑승 / 탑승 직행), 하차 줄 유무(quickExit·exit.alight 조합 4), **앱 언어 ja·dataLocale en에서 하차 줄이 일본어(구간 줄은 영어)**, en 자격 원자성(영문 조각 하나 결손 → 한국어 줄 전체), 탑승 줄 병기는 역명만(노선은 `lineNameEn` 그대로), 노선 `" "` → "번 버스" 없음, 마지막 도보의 `destinationName` 우선순위(승격본 → 장소 → null "목적지까지", 빈 `toName`도 폴백), 도보 스텝 번호(notice 생략 뒤에도 원본 인덱스)·경유지 구획 자리, 자동차 행(guidance 폴백 name·거리 0 생략), 요약 문장 3종 + **`walkDisplayMinutes` == `WalkCollapse` 판정 분 동일성**, 대안 이름 키 → 리터럴 4갈래, `wonText`.
- **화면 구조 단언(androidTest)**: walk outcome이 `Error`일 때도 계단 회피 토글 노드가 있다.
- **소스 가드**: M2 `AppSourceGuardTest`(LocationManager 한 곳·백그라운드 위치 0) 통과 — `directions/`에 `android.location` import 0.
- **androidTest(ATF) `DirectionsScreenA11yTest`**: 스텁 전송 + 페이크 locator로 폼 → 도착지 끝점 검색 → 후보 선택 → 조회 → 수단 헤딩·구간 행이 단일 노드, 대안 행 펼침 뒤 본문 노드 등장, `tryPerformAccessibilityChecks`. 실기기 연결 시.
- **vitest**: `android-strings-drift`(생성물 최신·arg-order)·`mirror-registry` 무변경 통과.
- 실호출 게이트: 서버 라우트는 기존 것(웹·iOS가 매일 친다) — 별도 없음.

## 10. 실기기 검증 항목

1. 길찾기 탭 → 출발지 "출발지, 현재 위치" → 바꾸기 → "도착지 검색" 순으로 점자로 읽힌다.
2. 도착지 버튼 → 끝점 검색 진입 시 커서가 검색 입력에 있다. 검색 → "후보 N건" 통지 → 커서가 첫 후보에 있다.
3. 후보 선택 → 폼 복귀 → 커서가 조회 버튼에 있다. 필드가 "도착지, {이름}"으로 읽힌다.
4. 조회 → 위치 권한 다이얼로그(첫 회) → "조회 중" 상태 → "N개 수단의 경로 안내가 준비되었습니다" 통지, 커서는 조회 버튼에 그대로.
5. 수단 헤딩 점프(대중교통·자동차·도보)가 되고 각 구간 줄이 한 줄씩 읽힌다. 도보 구간 뒤 승차 출구 줄, 하차역 뒤 하차 줄.
6. 대안 경로 행이 "접힘"으로 읽히고 활성화하면 "펼침" + 본문 구간이 이어진다(TalkBack이 상태를 두 번 읽으면 `stateDescription`을 빼고 시맨틱 액션으로).
7. 계단 회피 토글이 스위치로 읽히고 켬 뒤 커서가 도보 헤딩으로 간다. 최단 경로 행이 있으면 접힘으로 읽힌다.
8. 위치 거부 상태에서 조회 → 거부 문장 + 설정 열기 버튼. 대략적 위치만 허용 → "정확한 위치 허용" 버튼이 업그레이드 다이얼로그를 띄우고 허용하면 재조회.
9. 최근 경로 행 활성화 → 즉시 조회, 삭제 → 다음 행 착지, "삭제했습니다".
10. 시스템 뒤로가 끝점 검색을 닫고 커서가 열었던 필드 버튼으로 돌아온다.
11. 거리 표기 "178m"의 낭독(M2 §9-12와 같은 판정).
12. 점자 키보드 Enter가 끝점 검색을 제출한다(M1 §8-7과 같은 경로).
13. 상호작용 행(`clickable`)이 키보드 순회에서 한 번만 잡힌다(§3 머리 확인 필요 항목).

## 11. 판정 목록 (강한 디폴트 — 뒤집으려면 근거)

1. **프리필은 라우트 인자가 아니라 1회 소비 스토어(StateFlow) + `openDirections()` 한 함수**(§5). 대안 "탭 루트에 인자"는 `nav/Routes.kt`(타 세션 소유) 변경이 필요하고 `restoreState` 인자 우선순위가 미확인이다.
2. **끝점 검색은 내비 목적지가 아니라 화면 내 모달 상태**(§2). 대안 "스택 화면"은 등록 두 줄·확정 콜백을 백스택 결과로 전달하는 배선이 늘고, 필드 확정은 스택에 남을 화면이 아니다(iOS 시트).
3. **ViewModel 팩토리는 `directions/`가 자족**(§2). `MainActivity` 수정은 소유권 밖.
4. **위치는 `EndpointLocator` 세 함수 뒤에서 `LocationStore`·`PermissionGate` 통과 호출**(§6). 인터페이스는 테스트 페이크 자리로만 남는다.
5. **`GeoReduced` 해결 버튼은 "정확한 위치 허용"(권한 재요청) + 실패 시 설정 열기 폴백**(§3-1 표 8, M2 §4 절차).
6. **펼침 행 상태는 `stateDescription`**(§3-4 머리), Compose expand/collapse 액션 미사용 — 실기기 이중 낭독 시 반대로.
7. **조회 버튼 진행 표시는 `stateDescription`**(iOS 라벨 전환 대신 M1 관용구).
8. **조회 완료에 포커스 이동 없음**(iOS 판정 2026-08-02 승계), 계단 회피 재조회만 도보 헤딩.
9. **15초 상한은 `withTimeoutOrNull` + 블록 안 `Result` 박스**(§4-5) — `withTimeout`은 분류기가 취소로 다시 던지고, 박스 없는 `OrNull`은 transit "경로 없음"을 만료와 뭉갠다.
10. **자동차 안내 행은 iOS 정본(guidance 폴백 name)**, 웹의 name+guidance 결합 대신.
11. **notice 스텝 생략은 상수 동작**(§3-4-c — 도보 두 행 모두 라벨이 `stepFreeNotice`를 병기한다, iOS a11y 감사 2026-08-12).
12. **프로세스 재생성은 필드 3개만 복원**, 결과·최근 메모리는 포기(M1 검색어 복원과 같은 축). **탭 이탈은 조회를 취소하지 않는다**(§2, iOS와 의도된 차이).
13. **진동 없음**(M2 §10-5 승계). **받아쓰기 행 없음**(D9). **안내 시작 3종·거리 추적 섹션·공지 시트는 자리만**(M4·M5).
14. **요금 천 단위 구분은 앱 UI 로케일**(`wonText`, §3-4) — iOS 기기 로케일 대응. 드리프트 게이트 없음(요금은 표시 전용).
15. **`ios.route.*` 등은 android-extra 같은 문안**(§8) — M2 일괄 도입과 같은 이름이라 어느 쪽이 먼저 올라도 값이 같다.
16. **제목 자리는 M1 관용구(본문 첫 헤딩)** — M2가 상단 바로 통일하면 그 커밋이 함께 옮긴다.
17. **최근 장소 라벨은 원문**(로마자 병기 없음 — :kit `RecentEndpoint`에 필드가 없고 FOUNDATION 소유, iOS 동형).

## 12. 적대적 설계 리뷰 판정

1차(2026-09-16, `~/gildongmu-wt/android-m3-reports/review-m3-design.md`, 리뷰어 opus 별도 컨텍스트): **REQUEST_CHANGES** — BLOCKER 1·MAJOR 6·MINOR 13·NIT 7, 판정 문서 D1~D13 위반 0, 소유권·금지 목록 위반 0(새 gradle 의존성 0). 27건 전부 반영: B-1 `withTimeoutOrNull` 블록 안 `Result` 박스(transit "경로 없음" null과 만료 null 분리) + §9 transit 무경로 케이스 / M-1 최근 장소 라벨 원문 / M-2 하차 줄 `lang` = 앱 UI 언어(데이터 언어와 다른 축) / M-3 병기는 역명 두 자리만 / M-4 계단 회피 토글을 outcome 밖(§3-1 표 11)으로 / M-5 `closePicker`가 검색·지오코딩 Job 취소 / M-6 프리필 스토어를 StateFlow로 두고 ViewModel이 collect(탭이 보이는 채로 불려도 소비) / N-1 `ifEmpty` / N-2 빈 `toName` 폴백 / N-3 노선 trim / N-4 restoreState 근거를 "확인 필요"로 낮추고 소유권 근거 1순위 / N-5 M2 §4 권한 문장 의존을 §6에 기록(코디네이터 전파) / N-6 `requestPreciseLocation()` 세 번째 메서드 / N-7 탭 이탈 무취소 판정 / N-8 행 관용구 둘 명시 / N-9 Idle 행 / N-10 자기 브리핑 notice / N-11 `walkSummaryText` 정의 + 동일성 단언 / N-12 요금 구분자 앱 로케일 판정 / N-13 설정 열기 잉여 회수 약속 / NIT 7건(펼침 문장 행동형 재작성·`@Serializable` 제거·locator 팩토리 위치·notice 생략 상수화·"한 줄 + import"·상태 소유 단일화·`MainDispatcherExtension` 참조). 같은 커밋에서 main `7a4a9379`의 `LocationStore` 실코드에 맞춰 §6을 "통과 호출"로 단순화(`UnavailableLocator`·`NearbyLocationError` 번역 층 삭제). 설계 확정.

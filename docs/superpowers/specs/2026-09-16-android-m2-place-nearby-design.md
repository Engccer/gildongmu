# 안드로이드 앱 설계 — M2 장소 상세 + 내 주변 (2026-09-16)

> 범위는 **M2(장소 상세 + 내 주변)** 다(계획 `../plans/2026-09-16-android-app-parallel-plan.md` §1 마일스톤 표, 판정 문서 `2026-09-15-android-app-decisions.md` §2 "공유 상태 머신 이식"). 입력: M1 spec `2026-09-16-android-app-design.md`(관용구·접근성 기본형·i18n 파이프라인은 그대로 승계, 여기서 다시 쓰지 않는다), CORE 통합분(main `b312ff01`: `NearbyLoadCore`·`RevealWindow`·`NearbyService`·`PlaceHoursService`·`Deeplink`·`LocationFixPolicy`·`LocationNarrative`·`SubwayArrivalLine`·`TransitDisplay`·`PlaceProjection`), M1 통합분(main `65ef75f4`). 동작 정본은 iOS `PlaceDetailView.swift`·`NearbyHubView.swift`·`Nearby/{NearbyLoadState,NearbyFocus,NearbyRefresh,NearbyOverlay,AroundNearbyView,SubwayNearbyView,BusNearbyView,BusRouteStopsView,BikeNearbyView}.swift`·`LocationService.swift`, 웹 `NearbyHub`·`nearby-contract.tsx`.
>
> 적대적 설계 리뷰 판정: (§11에 기록)

## 1. 목표와 범위

**목표**: 검색 결과에서 장소 상세로 들어가 주소·영업시간·전화·외부 지도까지 닿고, "내 주변" 탭에서 현재 위치 기준 둘러보기·지하철·버스·따릉이를 점자·TalkBack으로 읽는다. 이 마일스톤이 처음 세우는 축은 셋 — **위치([3] 어댑터 + 권한 화면)**, **화면 간 이동(탭·스택·인자)**, **공유 상태 머신(`NearbyLoadCore`)의 Compose 소비 관용구**. 나머지 6개 내 주변 섹션(M2b)은 이 관용구를 반복만 한다.

**범위**:
1. **앱 골격** — 하단 탭 2개(검색·내 주변) + 화면 스택(뒤로 가기). 장소 상세·내 주변 화면은 스택에 쌓인다.
2. **장소 상세** — iOS `PlaceDetailView` 대응: 분류, 주소 3종(도로명·지번·영문) + 각 줄 전용 복사 버튼, 영업시간 한 줄(E24, Google 약관 계약 그대로), 전화 걸기, 홈페이지, 외부 지도 3종(네이버 길찾기·카카오맵 길찾기·카카오맵 장소 정보, 미설치 폴백), "이 장소 주변" 3행(지하철·버스·따릉이, 장소 좌표 앵커). 정보 정본은 텍스트(지도 없음).
3. **검색 화면 변경** — 장소 행 활성화 → 상세(M1 §9-3 해제), 좌표 가중 검색(M1 §9-2 해제: 권한이 이미 있을 때만 조용히, 팝업 없음) + 결과 행 거리 표기.
4. **내 주변 허브 + 4개 화면** — 둘러보기(위치 문장·한눈에 보기·주변 가게 목록), 지하철 도착, 버스 도착(+ 경유 정류소), 따릉이 대여소. iOS 허브 순서의 앞 4개.
5. **위치 계층** — 권한 요청·정밀/대략 구분·단발 취득(정확도·나이 게이트, 8초 상한, 최선값)·60초 캐시·순위 가중용 soft 경로. Google Play 서비스 의존 0(§10-1).
6. **문자열** — iOS 전용 카탈로그(`ios/i18n/ios-extra`)를 안드로이드 리소스로 일괄 도입(§7).

**범위 밖(M2b 이후로 미루는 것, §10 판정 기록)**: 내 주변 나머지 6개(소아 야간진료·무장애·아이 놀 곳·문화행사·보행 인프라·날씨·공기질), 둘러보기의 "주변 상황" 자동 펼침 섹션, 장소 상세의 역 자동 섹션 4종·무장애 편의시설 자동 섹션, 현재 위치 표시줄·수동 위치 지정, 결과 진동(E30), 채팅 진입(M6), 길찾기 프리필 진입·안내 중 목적지 변경(M3·M4), 음향신호기 진단(실험판 하드웨어 기능, 별도 판정).

**완료 조건**: 실험판 APK를 한소네 7에 설치해 ① 검색 → 장소 상세의 각 줄이 점자로 한 줄씩 읽히고 복사·전화·외부 지도가 동작한다 ② 내 주변 탭 → 지하철 도착이 위치 권한 다이얼로그를 거쳐 점자로 읽힌다(위원장 판정, 코디네이터 경유). `uiautomator dump` 구조를 보고에 남긴다. 머신 게이트(M1과 같음)는 실기기 없이 초록.

## 2. 아키텍처 (D5 네 계층의 M2 절단면)

```
[4] 화면   AppRoot(NavigationBar 2탭 + NavHost) ── PlaceDetailScreen · NearbyHubScreen · NearbyScreen(kind, anchor?) · BusRouteStopsScreen
             └ 상태 구독 ──▶ PlaceDetailViewModel · NearbyScreenViewModel<Payload>(NearbyLoadCore 껍데기) · SearchViewModel(M1 + 좌표 공급자)
[3] 실행   LocationStore(LocationManager FUSED_PROVIDER + 권한 게이트) · ClipboardManager · Intent(ACTION_DIAL·ACTION_VIEW) · 설정 열기 · HttpUrlConnectionTransport(M0)
[2] 판정   :kit  NearbyLoadCore · RevealWindow · NearbyService · PlaceHoursService · SearchService(좌표 인자) · LocationFixPolicy · buildOverviewLines · subwayArrivalProse* · TransitDisplay.pickLine · bilingualName · pickCategory · Deeplink 빌더 · isInKorea
[1] 서버   기존 라우트만: /api/places(lat·lng) · /api/places/around · /api/nearby/overview · /api/station/subway-arrival/nearby · /api/bus/nearby · /api/bus/route · /api/bike/nearby · /api/places/hours. 변경 0
```

- **화면 이동**: `androidx.navigation:navigation-compose`(최신 안정판, 구현 시 카탈로그에 고정) 단일 `NavHost`. 최상위 목적지 = 탭(검색·내 주변). 탭 전환은 `saveState/restoreState`로 **탭별 백스택을 보존**한다(iOS `TabView` 안 `NavigationStack` 동형 — 내 주변에서 지하철을 보다 검색 탭에 갔다 돌아오면 지하철 화면이 그대로다). 하단 바는 모든 화면에 남는다(iOS와 같이 선형 주파의 끝이 언제나 탭 4개, 지금은 2개).
- **라우트 인자**: `@Serializable` 라우트 클래스. 장소는 ID 재조회가 없으므로(카카오는 단건 조회 없음, 웹·iOS 계약) **`Place` 전체를 JSON 문자열 인자**로 싣는다(`KitJson`) — 프로세스 재생성 뒤에도 백스택이 복원된다. 내 주변 앵커도 같은 방식(`PlaceAnchor` JSON, null = 현재 위치).
- **ViewModel**: 화면마다 `androidx.lifecycle.ViewModel`(M1 §9-5). `NearbyScreenViewModel<Payload>`는 `NearbyLoadCore<Payload>`를 만들어 쥐고 `phase`를 그대로 노출한다 — 판정은 전부 :kit, 앱 층은 좌표 어댑터·이벤트→통지 문장·착지 세대·리빌 창뿐(iOS `SubwayNearbyModel` 규범 패턴).
- **좌표 어댑터**(§4): `NearbyCoordinateSource.Current { force -> locationStore.currentCoordinate(force) }`. 앵커 화면은 `Fixed(coord)`(측위 없음). `LocationStore`는 앱 싱글턴(`AppConfig` 옆, 프로세스 수명) — 화면마다 `LocationManager`를 만들지 않는다(iOS `LocationService.shared` = 웹 geolocation 싱글턴 계약).
- 패키지: `.nav`(골격·라우트), `.place`(상세), `.nearby`(허브·공통 껍데기·4화면·문장 조립), `.location`(스토어·권한 게이트), 기존 `.search`·`.a11y`·`.i18n`·`.net`·`.storage`.

## 3. 화면 구조와 접근성 계약

M1 §3의 기본형(한 줄 = 한 객체 `mergedRow`, `headingText`, 화면 소유 단일 `StatusLine`, `focusable + FocusRequester` 한 프레임 뒤 착지, `Column + verticalScroll`, `disabled` 금지, 48dp, 이모지 0)을 전부 승계한다. 아래는 M2가 더하는 것과 화면별 표.

### 3-1. 앱 골격·상단 바

- 모든 화면이 Material3 `Scaffold`에 **`TopAppBar`**(제목 `Text`에 `semantics { heading() }`, 스택 화면은 왼쪽에 뒤로 버튼 `android.common.back`("뒤로"), 오른쪽에 화면별 동작 버튼 — 내 주변은 새로고침) + 하단 `NavigationBar`(항목 `android.tab.search`·`android.tab.nearby`, `NavigationBarItem`이 `Role.Tab`·`selected`를 낸다). 검색 화면도 M1의 본문 제목을 상단 바로 옮긴다(화면마다 제목 자리가 다르면 위치를 외워 쓰는 탐색이 깨진다).
- 시스템 뒤로(제스처·하드웨어 키)는 스택을 하나 내린다. 최상위 탭에서는 앱을 나간다(플랫폼 관례).
- `StatusLine`은 **화면마다 하나**, 상단 바 바로 아래(M1과 같은 자리). 화면이 바뀌면 그 화면의 슬롯이 비어 있다(초기 seq 재발화 없음, M1 리뷰 반영분).

### 3-2. 장소 상세 (`PlaceDetailScreen`)

읽기 순서 = 아래 순서. 제목은 상단 바(`bilingualName(place.name, roman).primary` — 비-ko 낭독은 로마자만, E28 판정 ③).

| 순서 | 요소 | 계약 |
|---|---|---|
| 1 | 한글 원문 보조 줄 | 비-ko이고 `bilingualTitle.secondary`가 있을 때만. **시각 전용**: `clearAndSetSemantics { }`로 접근성 트리에서 뺀다(iOS `accessibilityHidden` 동형, 제목이 낭독의 정본) |
| 2 | 분류 | `pickCategory(lang, category, categoryEn)`이 비면 생략. 텍스트 한 줄 |
| 3~8 | 주소 줄 + 복사 버튼 ×3 | 보유한 주소만(빈 주소 = 죽은 버튼 금지). 줄: `ios.place.roadAddressLine`("도로명 주소, {value}")·`jibunAddressLine`·`englishAddressLine`. 바로 뒤 버튼 `place.copyRoadAddress`·`copyJibunAddress`·`copyEnglishAddress`(별개 객체 — 인터랙티브는 합치지 않는다). 누르면 `ClipboardManager`에 쓰고 `StatusLine`에 `place.addressCopied`("주소 복사됨") — 포커스가 버튼에 그대로 남으므로 통지가 유일한 증거(Android 13+의 시스템 복사 오버레이는 TalkBack 발화가 보장되지 않는다) |
| 9 | 영업시간 한 줄 | `PlaceHoursService.today(...)`가 non-null일 때만 나타난다(조용히, 통지·로딩 표시 없음 — 보조 정보). 문장은 iOS `PlaceHoursLine.lineText` 이식(`placeHours.line`·`allDay`·`closed`·`nextDay`, "Google Maps" 원문 유지). 전화 줄 바로 앞(불확실한 시각은 확인 수단 옆에). ⚠ 이 텍스트는 스크린 리더만 읽는다 — TTS·채팅으로 흘리지 않는다(약관, 웹 `place-hours-tts-drift.test.ts`) |
| 10 | 전화 걸기 | `phone`이 있을 때만. 버튼 `ios.place.callLine`("전화 걸기, {phone}") → `Intent(ACTION_DIAL, tel:)`(통화 권한 불필요, 다이얼러가 뜬다). 다이얼러가 없으면 `StatusLine`에 `ios.common.failedTitle` |
| 11 | 홈페이지 | `link`가 있고 카카오 장소(id `kakao-` 접두)가 **아닐 때만**(카카오 link는 아래 장소 정보와 중복). 버튼 `place.homepage` → `ACTION_VIEW`(http/https만, M1 웹 행 규칙) |
| 12 | 헤딩 `ios.route.section`("길찾기") | |
| 13~15 | 외부 지도 버튼 | `ios.route.naver`(도보 `buildNaverRouteDeeplink(walk, dest, APP_IDENTIFIER)`) · `ios.route.kakao`(`buildKakaoRouteDeeplink(walk, dest)`) · `ios.route.kakaoPlace`(카카오 장소만, `buildKakaoPlaceDeeplink(id)`). 앱 미설치(`ActivityNotFoundException`)면 **경로 2종은 카카오맵 웹 경로**(`buildKakaoWebRouteUrl`), 장소 정보는 `https://place.map.kakao.com/{id}`로 폴백(iOS 동형). 다른 스킴 처리 앱이 없는 것을 미리 묻지 않는다(`<queries>` 불필요 — `startActivity` 예외로 판정) |
| 16 | 헤딩 `ios.place.nearbyHeading`("이 장소 주변") | |
| 17~19 | 앵커 화면 진입 버튼 | `ios.nearby.subway`·`ios.nearby.bus`·`ios.nearby.bike` → `NearbyScreen(kind, anchor = PlaceAnchor(coord, name, nameRoman))`. 날씨·공기질 행은 M2b에서 같은 자리에 추가(iOS 순서 유지) |

- 길찾기 프리필 버튼 2개(`directions.toHere/fromHere`)·"이 장소에 관해 물어보기"·안내 중 목적지 변경은 그 마일스톤(M3·M6·M4)이 **같은 서열 자리**에 넣는다 — 이 표의 순서가 그 자리를 예약한다(iOS 순서: 주소 → 영업시간 → 전화 → 홈페이지 → [채팅] → 길찾기 헤딩 → [프리필 2] → [목적지 변경] → 외부 지도 3).
- 진입 착지: 스택 push 뒤 포커스는 **상단 바 제목**(헤딩)으로 — TalkBack 기본은 화면 전환 시 첫 노드(뒤로 버튼)라 "뒤로, 버튼"부터 들리는 것을 막는다(§9-6 실기기 판정: 기본 동작이 이미 제목이면 코드를 뺀다).

### 3-3. 검색 화면 변경 (M1 `SearchScreen`)

- 장소 행은 **버튼**(`Role.Button`)이 되어 상세로 push한다. 병합 낭독은 M1 그대로 + 거리 조각: 보조 줄 `joinText(분류, 주소, place.distance("약 {distance}"))`, 낭독 `contentDescription`은 `spokenDistanceUnits(…, "미터")`(`ios.unit.spokenMeters`)를 거친다 — TalkBack이 `m`을 "미터"로 읽는지는 §9-12 실기기 판정이고, 오독이 없으면 정정을 뺀다(VoiceOver 오독 대응이 근거였다).
- 주소 행은 iOS와 같이 **비활성 텍스트**로 남고(iOS `addressRowText` + `addressCopyActions`), 복사 2종(도로명·영문)은 `customActions` — M1 §3-5의 판정 조건(점자 미도달이면 보이는 버튼) 승계.
- 좌표 가중: `SearchViewModel`에 `coordinate: suspend () -> NearbyCoord?` 공급자 주입(§4 `coordinateForRanking`). 제출 시 병렬로 좌표를 구해(2초 상한, 실패는 null) `/api/places`에 `lat·lng`를 싣는다. **권한 팝업은 여기서 뜨지 않는다**(허가된 세션만) — 권한은 내 주변 첫 사용 시점에 묻는다(iOS 계약). 웹 `sort` 미지정 = 정확도순 + 근접 블렌딩(서버 몫, 재정렬 금지).

### 3-4. 내 주변 허브 (`NearbyHubScreen`)

제목 `android.tab.nearby`. 본문은 버튼 4개, iOS 순서: `ios.nearby.around`("둘러보기") · `ios.nearby.subway`("지하철 도착") · `ios.nearby.bus`("버스 도착") · `ios.nearby.bike`("따릉이 대여소"). 허브는 위치를 요청하지 않는다(각 화면 진입 시). 현재 위치 표시줄은 M2 밖(§10-2) — 위치 출처 선언은 둘러보기의 위치 문장이 맡는다.

### 3-5. 내 주변 공통 껍데기 (`NearbyScreen` — iOS `NearbyStateOverlayView`+`nearbyRefreshable`+`nearbyFocusOnLoad`+`nearbyAnnouncer` 대응)

- **제목**: `nearbyTitle(base, anchor)` = `joinText(base, anchor?.name의 bilingual primary)` — 앵커 화면은 "지하철 도착, 강남역"처럼 기준점을 제목에 흡수한다(기준이 현재 위치가 아님을 화면 어디에도 안 밝히면 "주변에 없습니다"를 자기 주변으로 읽는다).
- **새로고침**: 상단 바 오른쪽 버튼 `ios.common.refresh`(TalkBack엔 당겨서 새로고침 발견 경로가 없다 — 명시 버튼만, 제스처 없음). 재진입은 `NearbyLoadCore.load`의 in-flight 가드가 막으므로 버튼을 비활성화하지 않는다. 진행 중엔 `stateDescription = ios.common.checking`("확인 중").
- **본문 = phase 스위치**(`Column` 안, 오버레이가 아니라 본문 교체 — 오버레이는 터치를 삼키거나 트리 순서를 흐린다):

| phase | 본문 | 통지(`StatusLine`) |
|---|---|---|
| Idle·Loading(첫 로드) | `ios.common.checking` 텍스트 한 줄 | 없음(iOS 동형 — 완료 때 말한다) |
| Loaded(재조회 중 포함) | 도메인 목록(3-6~3-9) | 첫 진입 `Loaded` 이벤트: 도메인 문장(건수, 0건이면 `ios.nearby.announceEmpty` 또는 도메인 전용) · 재조회 실패 `RefreshFailed`: `ios.nearby.refreshFailed`(목록 유지) |
| Empty | 도메인 빈 문구(헤딩 없음, 텍스트) | `EmptyResult`: 도메인 빈 문구 |
| Denied | 헤딩 `ios.common.geoDeniedTitle` + `android.common.geoDeniedDesc`(안드로이드 문안, §7) + 버튼 `ios.common.openSettings`(앱 상세 설정 `ACTION_APPLICATION_DETAILS_SETTINGS`) | 로드 중 전락 `PermissionLost`: `ios.nearby.refreshDenied` |
| ReducedAccuracy(대략적 위치만 허용) | 헤딩 `ios.common.geoReducedTitle` + `android.common.geoReducedDesc` + 버튼 `ios.common.allowPrecise`(정밀 권한 재요청 §4; 시스템이 다이얼로그를 더 띄우지 않으면 설정 열기로 폴백) | `AccuracyLost`: `ios.nearby.refreshReduced` |
| OutOfCoverage | `ios.common.outOfCoverage` 텍스트 | `WentOutOfCoverage`: 같은 문장 |
| UnavailableHere(reason) | `ios.common.unavailableHere.seoulOnly`/`noBusData` | (전락 시 `RefreshFailed`, :kit 계약) |
| FailedLocation | 헤딩 `manualLocation.gpsFailed`("위치를 확인할 수 없습니다") + 새로고침 안내 없음(버튼이 상단 바에 있다) | 없음(첫 로드 실패는 본문이 말한다) |
| FailedServer | 헤딩 `ios.common.failedTitle` | 없음 |

- **전락 전이의 착지**: Loaded → Denied/ReducedAccuracy/OutOfCoverage처럼 목록이 통째로 사라지는 전이는 포커스를 쥔 노드가 제거된다. iOS는 `.high` 통지로 원인을 살렸지만 Android `liveRegion`엔 우선순위 축이 없다 — 대신 **본문 첫 헤딩(원인 제목)에 착지**시킨다(한 프레임 뒤). 통지 문장도 함께 난다(둘이 같은 원인을 말한다: 화면 `geoReducedTitle` ↔ 통지 `refreshReduced`).
- **첫 로드 착지**: `Loaded`로 **처음** 들어갈 때만(직전 phase가 Loaded가 아닐 때) 도메인이 정한 첫 항목(3-6~3-9)에 착지. 이미 목록을 본 뒤의 새로고침은 착지 없음(사용자가 새로고침 버튼에 커서를 둔 채 일으킨 변화). 첫 조회가 0건·실패였다가 새로고침으로 목록이 처음 생기면 착지한다. 구현은 M1 관용구(ViewModel `landingRevision` + 비저장 `consumedLanding`, `FocusRequester` 한 프레임 뒤). iOS의 "가시화 → 지연 → 검증 → 재시도"는 `List`의 오프스크린 컬링 대응이라 전량 컴포즈하는 `Column`엔 필요 없다(§9-3 실기기 판정 — 안 따라오면 그때 스크롤 선행을 더한다).
- **더 보기**(둘러보기 목록만): `RevealWindow`(:kit) — 버튼 `actions.showMore`, 누르면 첫 새 항목에 착지(M1 최근 검색 삭제 착지와 같은 `pendingLanding` 관용구). `willCommit`에서 창 리셋(커밋과 원자, :kit 계약).
- **통지 문장 공급**: `NearbyStrings`(호출 시점 람다, M1 `SearchStrings` 관용구) — `announceEmpty`·`refreshFailed`·`refreshDenied`·`refreshReduced`·`outOfCoverage` 공통 + 도메인 `loaded: (Payload) -> String`.
- 진동은 두지 않는다(§10-5).

### 3-6. 둘러보기 (`kind = around`, 현재 위치 전용)

payload = `AroundPayload(lat, lng, overview: NearbyOverview?, overviewFailed, places: List<SurroundingPlace>?, placesFailed)` — 조망·목록 두 조각을 한 fetch(`allSettled` 동형, 취소는 삼키지 않는다)로 받아 한 번에 커밋. 둘 다 실패해야 throw(→ FailedServer). "주변 상황" 조각은 M2b가 같은 payload에 더한다(§10-3).

| 순서 | 요소 | 계약 |
|---|---|---|
| 1 | 위치 문장(헤딩, **첫 로드 착지 지점**) | `ios.nearby.aroundHere`("현재 위치 기준, {place} 근처") / `overview.place` 없으면 `aroundHereNoPlace`. 비-ko는 `bilingual(place, roman: placeRoman)` — 시각 display, 낭독 primary(`contentDescription`) |
| 2 | 헤딩 "한눈에 보기" + 반경 | `whereAmI.overview.heading` + `whereAmI.overview.radius(formatDistance(radiusMeters))` 한 줄 |
| 3 | 불릿 6개 | `buildOverviewLines(overview, lang)`(:kit) 각 줄이 한 객체. 시각 `display`(한글 병기 꼬리), 낭독 `text` + `spokenDistanceUnits` |
| 2' | overview 실패 | 헤딩 + `whereAmI.overview.failed` |
| 4 | 헤딩 `ios.nearby.aroundPlacesHeading`("주변 가게와 시설") | |
| 5 | 장소 행(버튼 → 상세) | `surroundingPlaceToPlace(place)`(:kit). 보조 줄 `joinText(분류 마지막 " > " 조각(pickCategory), 방위 "{direction}쪽"(`surroundingsNearby.direction.*` + `ios.nearby.directionSuffixed`, 미지 방위는 생략), place.distance)`. ⚠ 방위는 북 기준 절대 8방위만(heading 없음). 0건이면 `ios.nearby.aroundEmpty` 텍스트, 실패면 `aroundPlacesFailed` |
| 6 | 더 보기 | `places.size > visibleCount`일 때 |

- 통지: `Loaded` → `ios.nearby.aroundLoaded`("둘러보기를 확인했습니다"). Empty 판정 = overview null & 실패 0 & places 0건(`isAllAbsent`) → 본문 `ios.nearby.aroundEmpty`.
- "이 위치에 관해 물어보기"는 M6.

### 3-7. 지하철 도착 (`kind = subway`, 앵커 가능)

`NearbyService.subwayArrivals(lat, lng, lang = dataLocale)` → `SubwayNearbyResult`. 역마다:

| 요소 | 계약 |
|---|---|
| 역 헤딩(**첫 역 = 착지 지점**) | `joinText(subwayStationLine(isEn, name, nameEn, lines, linesEn).visual, formatDistance(distanceMeters))`, 낭독은 `.spoken` 쪽 + 거리(단위 풀어쓰기). `subwayStationLine`은 iOS 파일 함수를 `:app nearby/SubwayLines.kt`로 이식(역명·노선 **둘 다** 영문일 때만 영어, E27 한 줄 언어 혼합 금지) |
| 4-state 행 | `arrivalStatus == "unavailable"` → `ios.nearby.arrivalUnavailable` / `closed` + `firstTime` → `ios.nearby.subwayClosed(firstTime)` / `closed`·`unknown` → `subwayNoRealtime` / 도착 0건 → `ios.station.noArrivals` / 도착마다 `subwayArrivalLine(arrival, isEn)` 한 줄 한 객체 |
| `subwayArrivalLine` | iOS 함수 이식(:app). 키 선택은 :kit `subwayArrivalProse`·`subwayArrivalProseSegments`(공유 fixture가 웹과 잠근다)이고 앱은 `subwayArrival.*` 13키를 **리터럴 `when`으로 조회만** 한다(미매핑 키는 디버그 `check`, 릴리스는 키 문자열 노출 — 빈 문자열 금지). 문장형 실패 시 원문 경로 + A32 꼬리, en 원자성은 `TransitDisplay.pickLine` |

- 통지: 역 수 `ios.nearby.announceStations(count)`; 0건인데 `nearest`가 있으면 `ios.nearby.subwayEmptyNearest(nearestLabel, formatDistance)`(본문 빈 문구도 같은 문장); 그 밖 0건 `ios.nearby.subwayEmpty`.

### 3-8. 버스 도착 (`kind = bus`, 앵커 가능) + 경유 정류소

정류소마다 헤딩 `joinText(bilingual(name, roman).display, stopNo, distance)`(낭독 primary), 이어서 `unavailable` → `arrivalUnavailable` / 0건 → `noBusArrivals` / 도착마다 **버튼**(`Role.Button`, `onClickLabel = ios.nearby.routeStopsHint`("경유 정류소 보기") — TalkBack이 "두 번 탭하여 경유 정류소 보기"로 읽는다, 별도 hint 축 없음) 라벨 = `joinText(routeNo("{route}번"), routeType, lowFloor?"저상", arrivalMessage ?: joinText(stopsBefore(prevStationCount), minutesAway(max(1, sec/60))))`. 정체성·착지 키는 `nodeId`(정류소명 중복 실존).

경유 정류소 화면 `BusRouteStopsScreen(source, cityCode?, routeId, routeNo)`: 파라미터형 코어(`NearbyCoordinateSource.None`·`NearbyCoverage.none`), 제목 `ios.nearby.routeStopsTitle(routeNo)`, 행 `"{order}, {name}"` 텍스트, 빈·실패 문구 `routeStopsEmpty`·`routeStopsFailed`, 로딩 `routeStopsLoading`. 첫 행 착지.

- 통지: `ios.nearby.announceStops(count)`, 빈 본문 `ios.nearby.busEmpty`. `UnavailableHere(noBusData)`는 서버 마커.

### 3-9. 따릉이 대여소 (`kind = bike`, 앵커 가능)

행 하나 = `joinText(bilingual(name, roman).display, formatDistance, bikesAvailable("대여 가능 {count}대"), racksTotal("거치대 {count}대"))` 텍스트(헤딩 없음 — 한 줄에 전부 흡수, 첫 행이 착지). 정체성 `stationId`. 통지 `announceBikes(count)`, 빈 본문 `bikeEmpty`. 서울 밖은 `UnavailableHere(seoulOnly)`(0건이 아니다 — 서버 마커).

## 4. 위치 계층 ([3] 어댑터, iOS `LocationService` 대응)

**구성 요소**(`space.dodoplanet.gildongmu.location`):

- `LocationStore`(앱 싱글턴): `StoredFix(lat, lng, accuracy, fixedAtElapsedMs)` 하나 + `lastFixFailed`. 공개 API 둘(권한 스냅샷 노출은 소비자가 생기는 표시줄 마일스톤에서):
  - `suspend fun currentCoordinate(force: Boolean, timeoutMs = 8_000, ttlS = 60.0, acceptAccuracy = 30.0): NearbyCoord` — throws `LocationException(kind)`, `kind ∈ {Denied, ReducedAccuracy, Unavailable}`. 절차 = iOS `currentCoordinate` 그대로: ① `!force`이고 캐시가 `canReuseCachedFix(accuracy, age, ttl, acceptAccuracy)`(:kit)를 통과하면 즉시 반환 ② 권한 판정(§ 권한) ③ 단발 취득(`acquireGatedFix`) ④ 성공 시 스토어 갱신은 **fix 수신 지점**에서(도장 덮어쓰기 금지).
  - `suspend fun coordinateForRanking(): NearbyCoord?` — 검색 가중용. **권한이 없으면 팝업 없이 null**, `softTimeout` 2초·`softTTL` 300초·`storeCeiling` 100m(:kit `LocationFixPolicy`), 실패는 `stored` 폴백, 그것도 없으면 null.
- `acquireGatedFix(timeoutMs)`: `LocationManager.requestLocationUpdates(FUSED_PROVIDER, LocationRequest.Builder(1_000).setQuality(QUALITY_HIGH_ACCURACY).build(), executor, listener)`(둘 다 API 31). fix가 올 때마다 `isStorableFix`(:kit, 100m·나이)면 스토어에 쓰고, `shouldAcceptFix`(30m·10초)면 즉시 반환. 상한 안에 수용 fix가 없으면 그때까지의 **최선(스토어) 값**, 하나도 없으면 `Unavailable`. 코루틴 취소·반환·타임아웃 어느 경로든 `removeUpdates`(finally). ⚠ `getCurrentLocation`을 쓰지 않는 이유는 iOS `requestLocation`과 같다 — 목표 정확도에 못 미쳐도 한 값을 주고 멈춘다. 나이는 `location.elapsedRealtimeNanos` 기준(벽시계 조정 무관).
- **권한**(`PermissionGate` — Activity가 구현하는 좁은 인터페이스 `suspend fun requestLocation(): PermissionOutcome`, `MainActivity`가 `ActivityResultContracts.RequestMultiplePermissions`(FINE+COARSE 동시 — Android 12 다이얼로그가 "정확한/대략적인" 선택을 준다)를 `CompletableDeferred`로 감싸 제공):
  - 매 `currentCoordinate`(ranking 제외)에서 `checkSelfPermission`을 다시 본다. FINE 허가 → 진행. COARSE만 → **`ReducedAccuracy`**(iOS "정확한 위치 꺼짐"의 안드로이드 대응 — 1~3km 오차로 "주변"을 말하면 있지도 않은 정보가 된다, 3-state). 둘 다 없음 → `PermissionGate.requestLocation()` 호출 → 결과 재판정. 시스템이 영구 거부라 다이얼로그를 띄우지 않고 즉시 거부를 돌려주면 `Denied`(설정 열기 안내). "처음 묻기"를 따로 추적하지 않는다 — 안드로이드엔 notDetermined 조회가 없고, 요청 자체가 멱등이다.
  - `allowPrecise` 버튼: 같은 요청을 다시 부른다(Android 12는 대략적 허용 뒤 재요청에서 정밀 업그레이드 다이얼로그를 띄운다). 결과가 여전히 COARSE면 설정 열기.
  - 권한 요청은 **내 주변 화면 진입(로드)에서만** 일어난다. 검색·상세는 묻지 않는다(iOS "When In Use, 내 주변 최초 사용 시점" 계약). 앱 시작 즉시 요청 금지. `ACCESS_BACKGROUND_LOCATION` 요청 없음(D11).
- **:kit 어댑터**: `NearbyCoordinateSource.Current { force -> try store.currentCoordinate(force) catch (LocationException) → NearbyLocationError.{Denied,ReducedAccuracy,Unavailable} }`. `CancellationException`은 그대로 통과(코어 계약). 어댑터 자신의 `withTimeout` 만료는 `Unavailable`로 번역(코어 KDoc 계약). 위치 취득은 `Dispatchers.Main`의 콜백이라 별도 스레드 전환 없음.
- **Google Play 서비스를 쓰지 않는다**(§10-1): `FUSED_PROVIDER`는 플랫폼 API 31 제공. 한소네 7의 GMS 탑재 여부가 조사 문서 §9 미확인 항목이고, minSdk 31이라 플랫폼 융합 제공자로 충분하다. 실기기에서 실내 취득 시간을 §9-11로 본다.
- 매니페스트: `ACCESS_FINE_LOCATION`·`ACCESS_COARSE_LOCATION`(둘 다 선언해야 정밀/대략 선택 다이얼로그가 정상 동작).

## 5. 상태·모델

- `NearbyScreenViewModel<Payload : Any>(coreFactory, strings, savedState)`: `phase: StateFlow<NearbyLoadPhase<Payload>>`(코어 그대로), `notice: StateFlow<Notice>`(M1 `Notice(seq, text)`), `landing: StateFlow<Landing>`(`None`·`FirstItem(rev)`·`Cause(rev)`·`Item(key, rev)`), `reveal: RevealWindow`(둘러보기만), `load(force)`(viewModelScope, 이전 `load` Job은 코어 가드가 막으므로 취소하지 않는다). `onEvent` 매퍼가 이벤트를 통지 문장으로(3-5 표), `Loaded`이면서 직전 phase가 Loaded가 아니었으면 `FirstItem` 착지 발급.
- `kind`별 코어 조립은 `NearbyKinds.kt` 한 파일(`around`·`subway`·`bus`·`bike`, 각각 fetch·loaded 문장·빈 문구·첫 착지 키). 화면은 `kind`로 조립기를 고른다 — M2b는 이 표에 행을 더한다.
- `PlaceDetailViewModel(place, hoursService, strings)`: `hours: StateFlow<PlaceHoursToday?>`(진입 시 1회 로드, 실패는 null·침묵), `notice`(복사·실패 통지).
- `SearchViewModel` 변경: `coordinate` 공급자 인자 추가(테스트는 `{ null }`), 결과 `Place.distanceMeters`가 행에 흐른다.

## 6. 실행 계층

| 기능 | 구현 |
|---|---|
| 복사 | `ClipboardManager.setPrimaryClip(ClipData.newPlainText("address", text))` + 통지 |
| 전화 | `Intent(ACTION_DIAL, Uri.parse("tel:" + phone.replace("-", "")))` |
| 외부 지도·홈페이지 | `Intent(ACTION_VIEW, uri)`; `ActivityNotFoundException` → 폴백 URL 1회(그것도 실패면 `StatusLine` `ios.common.failedTitle`). 선택 판정(`chooseFallback(primary, fallback)`)은 순수 함수로 분리해 테스트 |
| 설정 열기 | `Intent(ACTION_APPLICATION_DETAILS_SETTINGS, "package:" + packageName)` |
| 위치 | §4 |
| 이동 | `navigation-compose`(§2). 라우트: `SearchRoute`·`NearbyHubRoute`(탭 루트) · `PlaceDetailRoute(placeJson)` · `NearbyRoute(kind, anchorJson?)` · `BusRouteStopsRoute(source, cityCode?, routeId, routeNo)` |

## 7. i18n

- **iOS 전용 카탈로그 일괄 도입**: `messages-to-android-strings.mjs`가 `buildCatalog({ namespaces: [], extraDir: ios/i18n/ios-extra })`로 `ios.*` 키를 따로 만들어 **`android.*`로 개명**해 합친다. 같은 이름의 `android/i18n/android-extra` 키가 있으면 android-extra가 이긴다(플랫폼 문안 오버라이드). 리소스 이름은 `android_nearby_subway` 꼴. `ios/**`는 읽기만 한다.
- **의도된 차이 목록**: 드리프트 테스트 (4)를 일반화 — android-extra의 모든 `android.X`에 `ios.X`가 있으면 6로케일 문안이 같아야 하고, 예외는 테스트 파일의 명시 목록(`INTENDED_DIFFERENCES`)에 키와 사유를 적는다. M2 목록: `android.common.geoDeniedDesc`("설정에서 길동무의 위치 접근을 허용해 주세요" — iOS "설정 앱에서"), `android.common.geoReducedDesc`("대략적인 위치만 허용되어 있습니다. 정확한 위치를 허용해 주세요" — iOS 설정 경로 문장은 iOS 전용). 신설 안드로이드 전용: `android.common.back`("뒤로"). 종전 `android.search.*`·`android.tab.*`는 개명 도입분과 같은 문안이라 그대로 통과한다.
- arg-order: 도입된 `android.*` 키의 ko 인자 순서를 `android/i18n/arg-order.json`에 `--update-arg-order`로 잠근다(iOS `ios.*` 순서와 같은지도 대조 — 이미 테스트 (2)가 공유 키를 본다).
- 6로케일 전부(iOS 카탈로그가 6로케일이라 결손 없음). 새 키 3개는 android-extra 6로케일에 쓴다.

## 8. 게이트와 테스트 레인

M1 §7 게이트 그대로(`:kit:test` · `:app:testDebugUnitTest` · assemble 두 구성 · `VITEST_MAX_THREADS=2 npm run test:run`, 락 안). M2가 더하는 테스트:

- **JVM(:app)**: `LocationStore`를 `LocationSource`(`start(listener)`·`stop()` — `LocationManager` 추상) + `PermissionGate` 페이크로 — 캐시 재사용·force·정확도 수용·타임아웃 최선값·하나도 없으면 Unavailable·COARSE만이면 ReducedAccuracy·거부·취소 시 `stop` 호출·ranking 경로는 팝업 없음. `NearbyScreenViewModel`을 `:kit` testFixtures 스텁 전송 + 실캡처 fixture(`Fixtures.kit("subway-nearby.json")`·`bus-nearby.json`·`bike-nearby.json`·`around-nearby.json`·`bus-route-stops.json`)로 — 첫 로드 착지 1회·재조회 착지 없음·전락 통지·더 보기 착지 키. `SubwayLines`·버스 도착 줄·따릉이 줄 문장(문자열 공급 페이크). `chooseFallback`. 라우트 JSON 왕복. 소스 가드: `LocationManager` 생성은 `location/` 패키지 한 곳(`grep`), `ACCESS_BACKGROUND_LOCATION` 문자열 0.
- **androidTest(ATF)**: 허브·상세·지하철(앵커 고정, 스텁 전송 — 실기기 위치 불필요) 세 화면의 접근성 검사 + 병합 노드·헤딩·착지 단언.
- **vitest**: 드리프트 테스트 일반화(§7), 등록부 무변경.
- 실호출 게이트: 서버 라우트는 기존 것이라 별도 없음. 위치 취득은 실기기(§9).

## 9. 실기기 검증 항목

1. 내 주변 → 지하철 진입 시 위치 권한 다이얼로그가 점자·TalkBack으로 조작된다("정확한/대략적인" 선택 포함).
2. 허용 뒤 역 헤딩 → 도착 행이 한 줄씩 점자로 읽힌다. 통지 "주변 역 N곳"이 들린다.
3. 첫 로드 착지가 첫 역 헤딩에 온다(`Column` 전량 컴포즈 — 안 오면 스크롤 선행 추가).
4. 새로고침 버튼 → 목록 유지, 통지만. 착지 없음.
5. 대략적 위치만 허용 → "정확한 위치가 꺼져 있습니다" 헤딩 착지 + 정확한 위치 허용 버튼이 업그레이드 다이얼로그를 띄운다.
6. 스택 push 뒤 첫 낭독이 제목(헤딩)이다(기본 동작이면 코드 제거).
7. 장소 상세: 주소 줄 → 복사 버튼 → "주소 복사됨" 통지; 전화 걸기가 다이얼러를 연다; 네이버·카카오 버튼이 앱 또는 웹으로 간다.
8. 하단 탭 전환이 각 탭의 스택을 보존한다(지하철 보다 검색 갔다 오면 지하철).
9. 시스템 뒤로가 한 단계씩 내려온다.
10. 둘러보기: 위치 문장 헤딩 착지 → 한눈에 보기 6줄 → 가게 목록 → 더 보기 착지.
11. 실내에서 위치 취득 시간과 결과(8초 상한 안에 30m 수용 여부, 최선값 사용 여부) — 로그 1줄.
12. 검색 결과 거리 표기 "약 120m"를 TalkBack·점자가 어떻게 읽는가(m 오독 없으면 `spokenDistanceUnits` 제거).
13. 서울 밖 좌표(가능하면)에서 따릉이 "서울 지역에서만 제공됩니다".

## 10. 판정 목록 (강한 디폴트 — 뒤집으려면 근거)

1. **Google Play 서비스 의존 0** — `LocationManager.FUSED_PROVIDER`(API 31). 근거: 한소네 7 GMS 탑재는 미확인(조사 §9), minSdk 31이 플랫폼 융합 제공자를 보장, 의존성 하나가 준다. 판정 문서 §D10 표의 "FusedLocationProvider"는 역할 대응이지 라이브러리 지정이 아니라고 읽는다. 대가: GMS 융합 제공자의 실내 Wi-Fi 측위 품질 차이 가능 — §9-11 실측으로 뒤집을 수 있다.
2. **현재 위치 표시줄·수동 위치 지정은 M2 밖**(별도 마일스톤). 근거: 표시줄은 역지오코딩 스토어·지정 시트·판정 스토어(`ManualLocation*`)까지 한 기능이고, 위치 출처 선언은 둘러보기 위치 문장이 이미 한다. 좌표 우선순위 "앵커 > 수동 > GPS"의 수동 층은 어댑터 클로저 한 곳에 들어갈 자리를 남긴다.
3. **둘러보기 "주변 상황" 조각은 M2b** — 340줄 자동 펼침 섹션(묶음별 리빌 창)이라 별도 과제. payload에 조각을 더하는 방식이라 커밋 원자성 계약은 그때도 유지된다.
4. **내 주변 나머지 6개·역 자동 섹션·무장애 자동 섹션은 M2b**. 관용구가 확립되면 반복이다.
5. **결과 진동 없음**. E30은 iOS 판정이고 D10은 촉각·청각을 안드로이드 방식으로 재설계한다고 했다 — M4 소리 설계와 함께 판정.
6. **`navigation-compose` 단일 `NavHost` + 탭별 백스택 보존**. 대안 "탭마다 NavHost"는 상태 복원이 이중이 된다. Navigation 3은 안정판 여부를 구현 시 확인하되 기본은 2.x.
7. **`Place`·앵커는 JSON 라우트 인자**. 대안 "메모리 홀더"는 프로세스 재생성에서 백스택이 죽는다.
8. **상단 바 통일(`TopAppBar` + 제목 헤딩)**, 검색 화면 제목도 옮긴다.
9. **`Column` 유지**(M1 §9-9 재판정): 지하철 ≤ 수 역 × 도착 몇 건, 버스 정류소 ≤ 10, 경유 정류소 ≤ 100여 행의 단문 — 전량 컴포즈가 싸다.
10. **전락 전이는 원인 헤딩 착지로 보강**(Android live region에 우선순위 축이 없다).
11. **ios-extra 일괄 도입 + 의도된 차이 명시 목록**. 대안 "필요 키만 android-extra에 복사"는 80여 키 × 6로케일 수기 복제라 드리프트가 구조적으로 생긴다.
12. **주소 행은 비활성 텍스트 유지**(iOS 동형; 좌표 없는 주소는 상세가 없다).
13. **좌표 가중 검색은 허가된 세션에서만 조용히**(팝업 없음), 2초 상한, 실패는 좌표 없이 검색.
14. **채팅·길찾기·목적지 변경 진입 자리는 예약만**(§3-2 순서).
15. **커스텀 액션 판정 조건은 M1 §3-5 승계**(주소 복사 액션).

## 11. 적대적 설계 리뷰 판정

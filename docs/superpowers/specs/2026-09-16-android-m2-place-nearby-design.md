# 안드로이드 앱 설계 — M2 장소 상세 + 내 주변 (2026-09-16)

> 범위는 **M2(장소 상세 + 내 주변)** 다(계획 `../plans/2026-09-16-android-app-parallel-plan.md` §1 마일스톤 표, 판정 문서 `2026-09-15-android-app-decisions.md` §2 "공유 상태 머신 이식"). 입력: M1 spec `2026-09-16-android-app-design.md`(관용구·접근성 기본형·i18n 파이프라인은 그대로 승계, 여기서 다시 쓰지 않는다), CORE 통합분(main `b312ff01`: `NearbyLoadCore`·`RevealWindow`·`NearbyService`·`PlaceHoursService`·`Deeplink`·`LocationFixPolicy`·`LocationNarrative`·`SubwayArrivalLine`·`TransitDisplay`·`PlaceProjection`), M1 통합분(main `65ef75f4`). 동작 정본은 iOS `PlaceDetailView.swift`·`NearbyHubView.swift`·`Nearby/{NearbyLoadState,NearbyFocus,NearbyRefresh,NearbyOverlay,AroundNearbyView,SubwayNearbyView,BusNearbyView,BusRouteStopsView,BikeNearbyView}.swift`·`LocationService.swift`, 웹 `NearbyHub`·`nearby-contract.tsx`.
>
> 적대적 설계 리뷰 판정: (§11에 기록)

## 1. 목표와 범위

**목표**: 검색 결과에서 장소 상세로 들어가 주소·영업시간·전화·외부 지도까지 닿고, "내 주변" 탭에서 현재 위치 기준 둘러보기·지하철·버스·따릉이를 점자·TalkBack으로 읽는다. 이 마일스톤이 처음 세우는 축은 셋 — **위치([3] 어댑터 + 권한 화면)**, **화면 간 이동(탭·스택·인자)**, **공유 상태 머신(`NearbyLoadCore`)의 Compose 소비 관용구**. 나머지 6개 내 주변 섹션(M2b)은 이 관용구를 반복만 한다.

**범위**:
1. **앱 골격 위에 화면 스택** — 골격(하단 탭 4개 + 단일 `NavHost`, 탭별 백스택)은 체크포인트 `eb7bf0f8`이 이미 세웠다. M2는 `NearbyRoute` 자리표시 줄을 허브로 바꾸고 장소 상세·내 주변 화면을 스택에 쌓는다.
2. **장소 상세** — iOS `PlaceDetailView` 대응: 분류, 주소 3종(도로명·지번·영문) + 각 줄 전용 복사 버튼, 영업시간 한 줄(E24, Google 약관 계약 그대로), 전화 걸기, 홈페이지, 외부 지도 3종(네이버 길찾기·카카오맵 길찾기·카카오맵 장소 정보, 미설치 폴백), "이 장소 주변" 3행(지하철·버스·따릉이, 장소 좌표 앵커). 정보 정본은 텍스트(지도 없음).
3. **검색 화면 변경** — 장소 행 활성화 → 상세(M1 §9-3 해제), 좌표 가중 검색(M1 §9-2 해제: 권한이 이미 있을 때만 조용히, 팝업 없음) + 결과 행 거리 표기, 네이버 리뷰순 토글(M1 §1이 M2로 넘긴 항목, iOS `SearchModel.toggleSort` 동형).
4. **내 주변 허브 + 4개 화면** — 둘러보기(위치 문장·한눈에 보기·주변 가게 목록), 지하철 도착, 버스 도착(+ 경유 정류소), 따릉이 대여소. iOS 허브 순서의 앞 4개.
5. **위치 계층** — 권한 요청·정밀/대략 구분·단발 취득(정확도·나이 게이트, 8초 상한, 최선값)·60초 캐시·순위 가중용 soft 경로. Google Play 서비스 의존 0(§10-1).
6. **문자열** — iOS 전용 카탈로그(`ios/i18n/ios-extra`)를 안드로이드 리소스로 일괄 도입(§7).

**범위 밖(M2b 이후로 미루는 것, §10 판정 기록)**: 내 주변 나머지 6개(소아 야간진료·무장애·아이 놀 곳·문화행사·보행 인프라·날씨·공기질), 둘러보기의 "주변 상황" 자동 펼침 섹션, 장소 상세의 역 자동 섹션 4종·무장애 편의시설 자동 섹션, 현재 위치 표시줄·수동 위치 지정, 결과 진동(E30), 채팅 진입(M6), 길찾기 프리필 진입·안내 중 목적지 변경(M3·M4), 음향신호기 진단(실험판 하드웨어 기능, 별도 판정).

**완료 조건**: 실험판 APK를 한소네 7에 설치해 ① 검색 → 장소 상세의 각 줄이 점자로 한 줄씩 읽히고 복사·전화·외부 지도가 동작한다 ② 내 주변 탭 → 지하철 도착이 위치 권한 다이얼로그를 거쳐 점자로 읽힌다(위원장 판정, 코디네이터 경유). `android layout --full --pretty`(공식 CLI, README §2; `uiautomator dump`는 폴백) 접근성 트리를 보고에 남긴다. 머신 게이트(M1과 같음)는 실기기 없이 초록.

## 2. 아키텍처 (D5 네 계층의 M2 절단면)

```
[4] 화면   AppRoot(골격 eb7bf0f8: NavigationBar 4탭 + NavHost) ── PlaceDetailScreen · NearbyHubScreen · NearbyKindScreen(kind, anchor?) · BusRouteStopsScreen
             └ 상태 구독 ──▶ PlaceDetailViewModel · NearbyScreenViewModel<Payload>(NearbyLoadCore 껍데기) · SearchViewModel(M1 + 좌표 공급자)
[3] 실행   LocationStore(LocationManager FUSED_PROVIDER + 권한 게이트) · ClipboardManager · Intent(ACTION_DIAL·ACTION_VIEW) · 설정 열기 · HttpUrlConnectionTransport(M0)
[2] 판정   :kit  NearbyLoadCore · RevealWindow · NearbyService · PlaceHoursService · SearchService(좌표 인자) · LocationFixPolicy · buildOverviewLines · subwayArrivalProse* · TransitDisplay.pickLine · bilingualName · pickCategory · Deeplink 빌더 · isInKorea
[1] 서버   기존 라우트만: /api/places(lat·lng) · /api/places/around · /api/nearby/overview · /api/station/subway-arrival/nearby · /api/bus/nearby · /api/bus/route · /api/bike/nearby · /api/places/hours. 변경 0
```

- **화면 이동**: 골격 `nav/AppRoot`(`navigation-compose` 2.10.1, 단일 `NavHost`, 탭 루트 4개 `SearchRoute`·`DirectionsRoute`·`NearbyRoute`·`ChatRoute`, 탭 전환은 `saveState/restoreState`로 **탭별 백스택 보존** — iOS `TabView` 안 `NavigationStack` 동형). M2는 `composable<NearbyRoute>`의 자리표시 줄을 `NearbyHubScreen`으로 바꾸고, 스택 라우트를 **자기 패키지**에 둔다(README §1 규약): `place/PlaceDetailRoute(placeJson)`, `nearby/NearbyKindRoute(kind, anchorJson?)`, `nearby/BusRouteStopsRoute(...)`. `composable<DirectionsRoute>` 줄은 M3 소유 — 건드리지 않는다.
- **라우트 인자**: `@Serializable` 라우트 클래스. 장소는 ID 재조회가 없으므로(카카오는 단건 조회 없음, 웹·iOS 계약) **`Place` 전체를 JSON 문자열 인자**로 싣는다(`KitJson`) — 프로세스 재생성 뒤에도 백스택이 복원된다. 내 주변 앵커도 같은 방식(`PlaceAnchor` JSON, null = 현재 위치).
- **ViewModel**: 화면마다 `androidx.lifecycle.ViewModel`(M1 §9-5). `NearbyScreenViewModel<Payload>`는 `NearbyLoadCore<Payload>`를 만들어 쥐고 `phase`를 그대로 노출한다 — 판정은 전부 :kit, 앱 층은 좌표 어댑터·이벤트→통지 문장·착지 세대·리빌 창뿐(iOS `SubwayNearbyModel` 규범 패턴).
- **좌표 어댑터**(§4): `NearbyCoordinateSource.Current { force -> locationStore.currentCoordinate(force) }`. 앵커 화면은 `Fixed(coord)`(측위 없음). `LocationStore`는 앱 싱글턴(`AppConfig` 옆, 프로세스 수명) — 화면마다 `LocationManager`를 만들지 않는다(iOS `LocationService.shared` = 웹 geolocation 싱글턴 계약).
- 패키지: `.place`(상세 + 라우트), `.nearby`(허브·공통 껍데기·4화면·문장 조립 + 라우트), `.location`(스토어·권한 게이트 — **M2의 첫 통합 조각**, M3가 현재 위치 출발지에 같은 시그니처로 쓴다), 기존 `.nav`(골격, 등록 한 줄만 바꾼다)·`.search`·`.a11y`·`.i18n`·`.net`·`.storage`.

## 3. 화면 구조와 접근성 계약

M1 §3의 기본형(한 줄 = 한 객체 `mergedRow`, `headingText`, 화면 소유 단일 `StatusLine`, `focusable + FocusRequester` 한 프레임 뒤 착지, `Column + verticalScroll`, `disabled` 금지, 48dp, 이모지 0)을 전부 승계한다. 아래는 M2가 더하는 것과 화면별 표.

### 3-1. 앱 골격·상단 바

- 모든 화면이 Material3 `Scaffold`에 **`TopAppBar`**(제목 `Text`에 `semantics { heading() }`, 스택 화면은 왼쪽에 뒤로 버튼 `android.common.back`("뒤로"), 오른쪽에 화면별 동작 버튼 — 내 주변은 새로고침) + 하단 `NavigationBar`(골격: 항목 4개 `AppTab.order`, `NavigationBarItem`이 `Role.Tab`·`selected`를 낸다). 검색 화면도 M1의 본문 제목을 상단 바로 옮긴다(화면마다 제목 자리가 다르면 위치를 외워 쓰는 탐색이 깨진다).
- 시스템 뒤로(제스처·하드웨어 키)는 스택을 하나 내린다. 탭 루트에서는 골격의 `popUpTo(시작 탭){saveState}` 관용구대로 **비시작 탭이면 시작 탭으로, 시작 탭이면 앱을 나간다**(플랫폼 관례, iOS 탭 바에는 뒤로가 없어 등가 축 없음).
- **pop 복귀 착지**: 스택을 내려 돌아온 화면은 **활성화했던 행**(검색 결과 `place-{id}`, 허브 버튼, 상세의 앵커 버튼, 버스 도착 행)에 한 프레임 뒤 `requestFocus`한다 — iOS `NavigationStack`은 VoiceOver 커서를 눌렀던 행으로 되돌리지만 Compose `NavHost`는 재컴포즈하며 포커스를 잃는다(결과 30건 중 12번째를 열고 돌아와 맨 위부터 다시 내려가는 비용, 헌장 §5 "유지, 안 되면 복원"). 눌렀던 키는 그 화면 ViewModel의 `SavedStateHandle`에 두어 프로세스 재생성 뒤에도 복원된다. 소비 규칙: **착지를 시도하는 순간 무조건 지운다**(노드가 없어도), 결과가 없는 화면(`outcome == null` — 검색은 프로세스 재생성 뒤 결과를 버린다, M1 §4)은 시도 없이 지운다 — 그래야 나중 검색에서 같은 id가 나타날 때 헛착지가 없다(M1 `consumedRevision`과 같은 성질). 검색 화면의 착지는 결과 행이 ViewModel(백스택 엔트리 수명)에 살아 있을 때만 성립한다. 기본 동작이 이미 복원하면 코드를 뺀다(§9-14).
- `StatusLine`은 **화면마다 하나**, 상단 바 바로 아래(M1과 같은 자리). 화면이 바뀌면 그 화면의 슬롯이 비어 있다(초기 seq 재발화 없음, M1 리뷰 반영분).

### 3-2. 장소 상세 (`PlaceDetailScreen`)

읽기 순서 = 아래 순서. 제목은 상단 바(`bilingualName(place.name, roman).primary` — 비-ko 낭독은 로마자만, E28 판정 ③).

| 순서 | 요소 | 계약 |
|---|---|---|
| 1 | 한글 원문 보조 줄 | 비-ko이고 `bilingualTitle.secondary`가 있을 때만. **시각 전용**: `clearAndSetSemantics { }`로 접근성 트리에서 뺀다(iOS `accessibilityHidden` 동형, 제목이 낭독의 정본) |
| 2 | 분류 | `pickCategory(lang, category, categoryEn)`이 비면 생략. 텍스트 한 줄. 비-ko 한글 폴백의 언어 태깅(iOS `KoreanText` 후보 ①)은 안드로이드 대응이 없다(Compose `LocaleList`는 TTS 언어를 바꾸지 않는다) — E28 미결로 남긴다 |
| 3~8 | 주소 줄 + 복사 버튼 ×3 | 보유한 주소만(빈 주소 = 죽은 버튼 금지). 줄: `ios.place.roadAddressLine`("도로명 주소, {value}")·`jibunAddressLine`·`englishAddressLine`. 바로 뒤 버튼 `place.copyRoadAddress`·`copyJibunAddress`·`copyEnglishAddress`(별개 객체 — 인터랙티브는 합치지 않는다). 누르면 `ClipboardManager`에 쓰고 `StatusLine`에 `place.addressCopied`("주소 복사됨") — 포커스가 버튼에 그대로 남으므로 통지가 유일한 증거(Android 13+의 시스템 복사 오버레이가 TalkBack에 "복사됨"을 낭독하는지는 §9-7 실기기 판정 — 낭독하면 이중이라 우리 통지를 뺀다) |
| 9 | 영업시간 한 줄 | `PlaceHoursService.today(...)`가 non-null일 때만 나타난다(조용히, 통지·로딩 표시 없음 — 보조 정보). 문장은 iOS `PlaceHoursLine.lineText` 이식(`placeHours.line`·`allDay`·`closed`·`nextDay`, "Google Maps" 원문 유지). 전화 줄 바로 앞(불확실한 시각은 확인 수단 옆에). ⚠ 이 텍스트는 스크린 리더만 읽는다 — TTS·채팅으로 흘리지 않는다(약관, 웹 `place-hours-tts-drift.test.ts`) |
| 10 | 전화 걸기 | `phone`이 있을 때만. 버튼 `ios.place.callLine`("전화 걸기, {phone}") → `Intent(ACTION_DIAL, tel:)`(통화 권한 불필요, 다이얼러가 뜬다). 다이얼러가 없으면 `StatusLine`에 `android.common.noAppToOpen`("열 수 있는 앱이 없습니다" — "정보를 가져오지 못했습니다"는 원인이 다르다, §7 신설 키) |
| 11 | 홈페이지 | `link`가 있고 카카오 장소(id `kakao-` 접두)가 **아닐 때만**(카카오 link는 아래 장소 정보와 중복). 버튼 `place.homepage` → `ACTION_VIEW`(http/https만, M1 웹 행 규칙) |
| 12 | 헤딩 `ios.route.section`("길찾기") | |
| 13~15 | 외부 지도 버튼 | `ios.route.naver`(도보 `buildNaverRouteDeeplink(walk, dest, APP_IDENTIFIER)`) · `ios.route.kakao`(`buildKakaoRouteDeeplink(walk, dest)`) · `ios.route.kakaoPlace`(카카오 장소만, `buildKakaoPlaceDeeplink(id)`). 앱 미설치(`ActivityNotFoundException`)면 **경로 2종은 카카오맵 웹 경로**(`buildKakaoWebRouteUrl`), 장소 정보는 `https://place.map.kakao.com/{id}`로 폴백(iOS 동형). 폴백도 실패하면 `StatusLine`에 `android.common.noAppToOpen`. 다른 스킴 처리 앱이 없는 것을 미리 묻지 않는다(`<queries>` 불필요 — `startActivity` 예외로 판정). 빌더가 `null`(권역 밖 좌표)이면 그 버튼을 **숨긴다**(iOS는 `guard return` 무반응이나 무반응 버튼은 헌장 위반 — §10-19) |
| 16 | 헤딩 `ios.place.nearbyHeading`("이 장소 주변") | |
| 17~19 | 앵커 화면 진입 버튼 | `ios.nearby.subway`·`ios.nearby.bus`·`ios.nearby.bike` → `NearbyKindRoute(kind, anchor = PlaceAnchor(coord, name, nameRoman))`. 날씨·공기질 행은 M2b에서 같은 자리에 추가(iOS 순서 유지) |

- 길찾기 프리필 버튼 2개(`directions.toHere/fromHere`)·"이 장소에 관해 물어보기"·안내 중 목적지 변경은 그 마일스톤(M3·M6·M4)이 **같은 서열 자리**에 넣는다 — 이 표의 순서가 그 자리를 예약한다(iOS 순서: 주소 → 영업시간 → 전화 → 홈페이지 → [채팅] → 길찾기 헤딩 → [프리필 2] → [목적지 변경] → 외부 지도 3).
- 진입 착지: 스택 push 뒤 포커스는 **상단 바 제목**(헤딩)으로 — TalkBack 기본은 화면 전환 시 첫 노드(뒤로 버튼)라 "뒤로, 버튼"부터 들리는 것을 막는다(§9-6 실기기 판정: 기본 동작이 이미 제목이면 코드를 뺀다).

### 3-3. 검색 화면 변경 (M1 `SearchScreen`)

- 장소 행은 **버튼**(`Role.Button`)이 되어 상세로 push한다. 병합 낭독은 M1 그대로 + 거리 조각: 보조 줄 `joinText(분류, 주소, place.distance("약 {distance}"))`, 낭독 `contentDescription`은 `spokenDistanceUnits(…, "미터")`(`ios.unit.spokenMeters`)를 거친다 — TalkBack이 `m`을 "미터"로 읽는지는 §9-12 실기기 판정이고, 오독이 없으면 정정을 뺀다(VoiceOver 오독 대응이 근거였다).
- 주소 행은 iOS와 같이 **비활성 텍스트**로 남고(iOS `addressRowText` + `addressCopyActions`), 복사 2종(도로명·영문)은 `customActions` — M1 §3-5의 판정 조건(점자 미도달이면 보이는 버튼) 승계.
- 좌표 가중: `SearchViewModel`에 `coordinate: suspend () -> NearbyCoord?` 공급자 주입(§4 `coordinateForRanking`). 제출 시 **좌표를 먼저 기다린 뒤**(iOS `SearchModel.submit` 동형 — 직렬, 2초 상한이 검색 지연에 더해진다, 실패는 null) `/api/places`에 `lat·lng`를 싣는다. **권한 팝업은 여기서 뜨지 않는다**(허가된 세션만) — 권한은 내 주변 첫 사용 시점에 묻는다(iOS 계약). 웹 `sort` 미지정 = 정확도순 + 근접 블렌딩(서버 몫, 재정렬 금지).
- **리뷰순 토글**(iOS `SearchView`·`SearchModel` 동형): 노출 조건 = `dataLocale == "ko"` && 이 세션에서 네이버가 답한 응답을 본 적 있음(`SearchOutcome.placesProvider`가 `merged`·`naver-local`인 응답이 한 번이라도 — iOS는 서버 키를 모르므로 이것이 유일한 관측 채널, 래치) && `outcome != null`. 자리는 최근 검색 다음·결과 섹션 앞(섹션 밖 — 리뷰순 0건이면 장소 섹션이 사라져도 토글은 남아 되돌아갈 수 있다; 칩과 다른 층이라 칩 행에 넣지 않는다). 버튼 라벨이 곧 상태 신호(`search.sortByReview` ↔ `search.sortByAccuracy`). 누르면 칩 두 축 리셋 + `queryState`를 **마지막 제출 질의로 되돌리고**(iOS `query = lastSubmittedQuery` — 입력창을 덮어쓴다) 그것으로 재조회, 첫 결과 착지 없음(새로고침 계열), 건수 통지는 그대로. 검색 중이거나 제출 이력이 없으면 무시(iOS `guard !isSearching, !lastSubmittedQuery.isEmpty`). 재조회의 장소 트랙이 실패하면 정렬을 되돌린다(라벨이 실패한 정렬을 가리키지 않게, 웹 롤백 미러) — 롤백은 **토글이 일으킨 재조회에서만**, `requested == sort` 가드로 stale 제외. `sort`는 다음 일반 제출에도 유지된다(iOS `submit`이 현재 `sort`를 그대로 보낸다). `SearchService.search(sort =)`·`PlaceSort`는 :kit에 있다.

### 3-4. 내 주변 허브 (`NearbyHubScreen`)

제목 `android.tab.nearby`. 본문은 버튼 4개, iOS 순서: `ios.nearby.around`("둘러보기") · `ios.nearby.subway`("지하철 도착") · `ios.nearby.bus`("버스 도착") · `ios.nearby.bike`("따릉이 대여소"). 허브는 권한을 요청하지 않는다(권한 다이얼로그는 각 화면 진입 시). 현재 위치 표시줄은 §12-4가 더한다(M2b — 허가된 세션에서만 soft 측위, 팝업 없음).

### 3-5. 내 주변 공통 껍데기 (`NearbyScreen` — iOS `NearbyStateOverlayView`+`nearbyRefreshable`+`nearbyFocusOnLoad`+`nearbyAnnouncer` 대응)

- **제목**: `nearbyTitle(base, anchor)` = `joinText(base, anchor?.name의 bilingual primary)` — 앵커 화면은 "지하철 도착, 강남역"처럼 기준점을 제목에 흡수한다(기준이 현재 위치가 아님을 화면 어디에도 안 밝히면 "주변에 없습니다"를 자기 주변으로 읽는다).
- **갱신 시점**: 화면 진입 첫 로드 1회 + 새로고침 버튼. 구성 변경(회전)·탭 전환 복귀는 재조회하지 않는다(iOS `.task` 동형 — 실시간 도착의 갱신 수단은 새로고침 버튼뿐이다, 결함이 아니다).
- **새로고침**: 상단 바 오른쪽 버튼 `ios.common.refresh`(TalkBack엔 당겨서 새로고침 발견 경로가 없다 — 명시 버튼만, 제스처 없음). 재진입은 `NearbyLoadCore.load`의 in-flight 가드가 막으므로 버튼을 비활성화하지 않는다. 진행 중엔 `stateDescription = ios.common.checking`("확인 중").
- **본문 = phase 스위치**(`Column` 안, 오버레이가 아니라 본문 교체 — 오버레이는 터치를 삼키거나 트리 순서를 흐린다). ⚠ **0건은 `Loaded`다**: 모든 kind의 fetch는 non-null(0건 = 빈 리스트, §12 6종 포함)이라 :kit `Empty` phase(fetch가 null을 돌려줄 때만, 코어 #12)에는 도달하지 않는다. fetch가 0건을 null로 돌려주면 Loaded에서 새로고침 0건이 `RefreshFailed`("기존 정보를 유지합니다")로 뒤집혀 3-state가 깨진다 — 금지. 빈 문구 판정은 도메인 `isEmpty(payload)` 술어(§5 표)다(iOS `descriptor.emptyList`).

| phase | 본문 | 통지(`StatusLine`) |
|---|---|---|
| Idle·Loading(첫 로드) | `ios.common.checking` 텍스트 한 줄 | 없음(iOS 동형 — 완료 때 말한다) |
| Loaded, `isEmpty(payload)` 거짓(재조회 중 포함) | 도메인 목록(3-6~3-9) | 첫 진입 `Loaded` 이벤트: 도메인 건수 문장 · 재조회 실패 `RefreshFailed`: `ios.nearby.refreshFailed`(목록 유지) |
| Loaded, `isEmpty(payload)` 참 | 도메인 빈 문구(헤딩 없음, 텍스트; 거리가 든 문구는 `spokenDistanceUnits`) | `Loaded` 이벤트: 도메인 빈 문장(`ios.nearby.announceEmpty` 또는 도메인 전용) |
| Empty(:kit, M2 4종 도달 불가) | 방어: `FailedServer`와 같은 본문 | `EmptyResult`: 없음 |
| Denied | 헤딩 `ios.common.geoDeniedTitle` + `android.common.geoDeniedDesc`(안드로이드 문안, §7) + 버튼 `ios.common.openSettings`(앱 상세 설정 `ACTION_APPLICATION_DETAILS_SETTINGS`) | 로드 중 전락 `PermissionLost`: `ios.nearby.refreshDenied` |
| ReducedAccuracy(대략적 위치만 허용) | 헤딩 `ios.common.geoReducedTitle` + `android.common.geoReducedDesc` + 버튼 `ios.common.allowPrecise`(정밀 권한 재요청 §4; 시스템이 다이얼로그를 더 띄우지 않으면 설정 열기로 폴백) | `AccuracyLost`: `ios.nearby.refreshReduced` |
| OutOfCoverage | `ios.common.outOfCoverage` 텍스트 | `WentOutOfCoverage`: 같은 문장 |
| UnavailableHere(reason) | `ios.common.unavailableHere.seoulOnly`/`noBusData` | (전락 시 `RefreshFailed`, :kit 계약) |
| FailedLocation | 헤딩 `android.common.locationFailed`("현재 위치를 확인하지 못했습니다", 신설 — iOS·웹은 서버 실패와 같은 문구를 쓰지만 원인이 다르면 문장도 달라야 한다, §10-17) + 기기 위치 서비스가 꺼져 있으면(`LocationManager.isLocationEnabled()` 거짓, 렌더 시 판정) 대신 헤딩 `android.common.locationOff`("기기의 위치가 꺼져 있습니다") + 버튼 `ios.common.openSettings` → `ACTION_LOCATION_SOURCE_SETTINGS` | 없음(첫 로드 실패는 본문이 말한다) |
| FailedServer | 헤딩 `ios.common.failedTitle` | 없음 |

- **원인 헤딩 착지**: 목록이 없는 phase 전부(Denied·ReducedAccuracy·OutOfCoverage·UnavailableHere·FailedLocation·FailedServer·Empty) — 전락 전이(포커스를 쥔 노드가 제거된다)뿐 아니라 **첫 로드 실패**도 같다(진입 뒤 첫 낭독이 원인이 되게). **본문 첫 헤딩(원인 제목)에 착지**시킨다(한 프레임 뒤). 근거: Android는 착지 라벨과 polite 통지를 순서대로 둘 다 읽는다(TalkBack이 polite를 큐에 넣어 착지 낭독 **뒤에** 말한다 — iOS `.high`가 풀던 잠식과 다른 기제). 착지 대상이 원인 헤딩이면 통지가 없어도 원인이 전달되고, 통지는 같은 원인의 재확인이다. 헤딩 라벨과 통지가 연달아 나는 것은 수용한다(`geoReducedTitle` ↔ `refreshReduced`처럼 같은 원인). `LiveRegionMode.Assertive`는 쓰지 않는다(M1 §4 단일 polite 창구).
- ⚠ **안드로이드에서 `PermissionLost`·`AccuracyLost` 전락은 세션 안에 오지 않는다**: 권한 회수·정밀→대략 강등·"이번만" 만료는 프로세스를 재시작한다(공식 문서). :kit 매핑은 유지하되 실제로는 첫 로드 판정(§9-5)으로만 나타난다. 세션 안 실전이는 `WentOutOfCoverage`뿐.
- **첫 로드 착지**: `Loaded`로 **처음** 들어갈 때만(직전 phase가 Loaded가 아닐 때) 도메인이 정한 첫 항목(3-6~3-9)에 착지. 이미 목록을 본 뒤의 새로고침은 착지 없음(사용자가 새로고침 버튼에 커서를 둔 채 일으킨 변화). 첫 조회가 0건·실패였다가 새로고침으로 목록이 처음 생기면 착지한다. 판정은 phase 비교가 **아니라** 도메인 첫 착지 키의 **null → non-null 전이**다(iOS `nearbyFocusOnLoad`의 `onChange(of: id)` 동형 — 0건은 `Loaded`이지만 첫 착지 키가 null이라 "0건 → 새로고침 → N건"도 이 규칙이 덮는다). 1회성(`didLand`)은 ViewModel 비저장 필드. 구현은 M1 관용구(ViewModel `landingRevision` + 비저장 `consumedLanding`, `FocusRequester` 한 프레임 뒤). iOS의 "가시화 → 지연 → 검증 → 재시도"는 `List`의 오프스크린 컬링 대응이라 전량 컴포즈하는 `Column`엔 필요 없다(§9-3 실기기 판정 — 안 따라오면 그때 스크롤 선행을 더한다).
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
| 4-state 행 | `arrivalStatus == "unavailable"` → `ios.nearby.arrivalUnavailable` / `closed` + `firstTime` → `android.nearby.subwayClosed(firstTime)` / `closed`·`unknown` → `subwayNoRealtime` / 도착 0건 → `ios.station.noArrivals` / 도착마다 `subwayArrivalLine(arrival, isEn)` 한 줄 한 객체 |
| `subwayArrivalLine` | iOS 함수 이식(:app). 키 선택은 :kit `subwayArrivalProse`·`subwayArrivalProseSegments`(공유 fixture가 웹과 잠근다)이고 앱은 `subwayArrival.*` 13키를 **리터럴 `when`으로 조회만** 한다(미매핑 키는 `if (BuildConfig.DEBUG) error(...) else key` — `check`는 릴리스에서도 던진다; 빈 문자열 금지). 문장형 실패 시 원문 경로 + A32 꼬리, en 원자성은 `TransitDisplay.pickLine` |

- 통지: 역 수 `ios.nearby.announceStations(count)`; 0건인데 `nearest`가 있으면 `android.nearby.subwayEmptyNearest(station, distance)`(본문 빈 문구도 같은 문장, 둘 다 `spokenDistanceUnits`; iOS 원문 `%@` 키를 명명 플레이스홀더로 다시 쓴 android-extra 키, §7); 그 밖 0건 `ios.nearby.subwayEmpty`. `subwayClosed`도 같은 이유로 `android.nearby.subwayClosed(time)`.

### 3-8. 버스 도착 (`kind = bus`, 앵커 가능) + 경유 정류소

정류소마다 헤딩 `joinText(bilingual(name, roman).display, stopNo, distance)`(낭독 primary), 이어서 `unavailable` → `arrivalUnavailable` / 0건 → `noBusArrivals` / 도착마다 **버튼**(`Role.Button`, `onClickLabel = ios.nearby.routeStopsHint`("경유 정류소 보기") — TalkBack이 "두 번 탭하여 경유 정류소 보기"로 읽는다, 별도 hint 축 없음) 라벨 = `joinText(routeNo("{route}번"), routeType, lowFloor?"저상", arrivalMessage ?: joinText(stopsBefore(prevStationCount), minutesAway(max(1, sec/60))))`. 정체성·착지 키는 `nodeId`(정류소명 중복 실존).

경유 정류소 화면 `BusRouteStopsScreen(source, cityCode?, routeId, routeNo)`: 파라미터형 코어(`NearbyCoordinateSource.None`·`NearbyCoverage.none`), 제목 `ios.nearby.routeStopsTitle(routeNo)`, 행 `"{order}, {name}"` 텍스트, 빈·실패 문구 `routeStopsEmpty`·`routeStopsFailed`, 로딩 `routeStopsLoading`. **첫 로드 착지 없음**(iOS `BusRouteStopsView`는 `nearbyFocusOnLoad`를 걸지 않는다 — 제목 헤딩에서 순서대로 읽는 목록). 완료 통지는 `android.nearby.announceRouteStops(count)`("경유 정류소 {count}곳", 신설 — iOS는 `announceStops` "주변 정류소"를 재사용해 부정확, §10-18).

- 통지: `ios.nearby.announceStops(count)`, 빈 본문 `ios.nearby.busEmpty`. `UnavailableHere(noBusData)`는 서버 마커.

### 3-9. 따릉이 대여소 (`kind = bike`, 앵커 가능)

행 하나 = `joinText(bilingual(name, roman).display, formatDistance, bikesAvailable("대여 가능 {count}대"), racksTotal("거치대 {count}대"))` 텍스트(헤딩 없음 — 한 줄에 전부 흡수, 첫 행이 착지). 정체성 `stationId`. 통지 `announceBikes(count)`, 빈 본문 `bikeEmpty`. 서울 밖은 `UnavailableHere(seoulOnly)`(0건이 아니다 — 서버 마커).

## 4. 위치 계층 ([3] 어댑터, iOS `LocationService` 대응)

**구성 요소**(`space.dodoplanet.gildongmu.location`):

- `LocationStore`(앱 싱글턴): `StoredFix(lat, lng, accuracy, fixedAtElapsedMs)` 하나 + `lastFixFailed`. 공개 API 둘(권한 스냅샷 노출은 소비자가 생기는 표시줄 마일스톤에서):
  - `suspend fun currentCoordinate(force: Boolean, timeoutMs = 8_000, ttlS = 60.0, acceptAccuracy = 30.0): NearbyCoord` — throws `LocationException(kind)`, `kind ∈ {Denied, ReducedAccuracy, Unavailable}`. 절차 = iOS `currentCoordinate` 그대로: ① `!force`이고 캐시가 `canReuseCachedFix(accuracy, age, ttl, acceptAccuracy)`(:kit)를 통과하면 즉시 반환 ② 권한 판정(§ 권한) ③ 단발 취득(`acquireGatedFix`) ④ 성공 시 스토어 갱신은 **fix 수신 지점**에서(도장 덮어쓰기 금지).
  - `suspend fun coordinateForRanking(): NearbyCoord?` — 검색 가중용. **권한이 없으면 팝업 없이 null**, `softTimeout` 2초·`softTTL` 300초·`storeCeiling` 100m(:kit `LocationFixPolicy`), 실패는 `stored` 폴백, 그것도 없으면 null.
- `acquireGatedFix(timeoutMs)`: `LocationManager.requestLocationUpdates(FUSED_PROVIDER, LocationRequest.Builder(1_000).setQuality(QUALITY_HIGH_ACCURACY).build(), executor, listener)`(둘 다 API 31). fix가 올 때마다 `isStorableFix`(:kit, 100m·나이)면 스토어에 쓰고, `shouldAcceptFix`(30m·10초)면 즉시 반환. 상한 안에 수용 fix가 없으면 **이번 호출 안에서** `isStorableFix`를 통과한 fix 중 `isBetterFix`로 고른 최선값(iOS `oneShotBest`, 취득 시작 때 비운다)이고 **스토어의 기존 값은 폴백 후보가 아니다** — 이번 취득에 fix가 0이면 `Unavailable`(iOS `LocationService.swift` 주석이 막은 "낡은 캐시가 타임아웃 폴백으로 나가는" 경로). 코루틴 취소·반환·타임아웃 어느 경로든 `removeUpdates`(finally). provider는 `hasProvider(FUSED_PROVIDER)`가 참이면 융합, 거짓이면 `GPS_PROVIDER`(+`NETWORK_PROVIDER`가 있으면 둘 다 구독, 같은 게이트) — 존재하지 않는 provider는 `IllegalArgumentException`이고 한소네 7의 provider 목록은 미확인(조사 §9). 어느 provider를 썼는지 로그 1줄(§9-11). `Location.hasAccuracy()`가 거짓이면 README §3 관용구대로 `-1.0`을 넘긴다(:kit `> 0` 가드가 거른다). ⚠ `getCurrentLocation`을 쓰지 않는 이유는 iOS `requestLocation`과 같다 — 목표 정확도에 못 미쳐도 한 값을 주고 멈춘다. 나이는 `location.elapsedRealtimeNanos` 기준(벽시계 조정 무관).
- **권한**(`PermissionGate` — 대기 슬롯은 **`LocationStore`(앱 싱글턴)가 쥔다**: `suspend fun requestLocation(): PermissionOutcome`은 스토어의 `CompletableDeferred` 목록에 매달리고, Activity는 "요청을 띄우는 손"(`ActivityResultContracts.RequestMultiplePermissions`, FINE+COARSE 동시 — Android 12 다이얼로그가 "정확한/대략적인" 선택을 준다)과 "결과를 전달하는 손"만 `onCreate`/`onDestroy`에서 등록·해제한다. 다이얼로그 중 Activity가 재생성되면 새 Activity의 콜백이 스토어의 같은 슬롯을 재개한다(iOS `authContinuations` 동형). 동시 요청(검색 랭킹은 요청하지 않으므로 사실상 내 주변 두 화면)은 한 다이얼로그에 전부 재개. 프로세스 재생성 뒤 도착한 결과는 슬롯이 비어 있다 — 로그만 남기고 버린다(화면 `load()`가 `checkSelfPermission`으로 다시 판정한다). `launch()`는 Activity가 STARTED 이후여야 하는데 요청은 화면 진입 로드에서만 시작되므로 성립한다):
  - 매 `currentCoordinate`(ranking 제외)에서 `checkSelfPermission`을 다시 본다. FINE 허가 → 진행. COARSE만 → **`ReducedAccuracy`**(iOS "정확한 위치 꺼짐"의 안드로이드 대응 — 1~3km 오차로 "주변"을 말하면 있지도 않은 정보가 된다, 3-state). 둘 다 없음 → `PermissionGate.requestLocation()` 호출 → 결과 재판정. 시스템이 영구 거부라 다이얼로그를 띄우지 않고 즉시 거부를 돌려주면 `Denied`(설정 열기 안내). "처음 묻기"를 따로 추적하지 않는다 — 안드로이드엔 notDetermined 조회가 없고, 요청 자체가 멱등이다.
  - `allowPrecise` 버튼: 같은 요청을 다시 부른다(Android 12는 대략적 허용 뒤 재요청에서 정밀 업그레이드 다이얼로그를 띄운다). 결과가 여전히 COARSE면 설정 열기.
  - 권한 요청은 **내 주변 화면 진입(로드)과 길찾기의 현재 위치 조회**에서만 일어난다(M3 판정 반영 — iOS도 두 곳). 검색·상세는 묻지 않는다(iOS "When In Use" 계약). 앱 시작 즉시 요청 금지. `ACCESS_BACKGROUND_LOCATION` 요청 없음(D11). 설정 열기 인텐트는 `location/LocationSettings.kt` 함수 둘(앱 상세·기기 위치)로 통일 — M3도 같은 함수.
- **:kit 어댑터**: `NearbyCoordinateSource.Current { force -> try store.currentCoordinate(force) catch (LocationException) → NearbyLocationError.{Denied,ReducedAccuracy,Unavailable} }`. `CancellationException`은 그대로 통과(코어 계약). 어댑터 자신의 `withTimeout` 만료는 `Unavailable`로 번역(코어 KDoc 계약). 위치 취득은 `Dispatchers.Main`의 콜백이라 별도 스레드 전환 없음.
- **Google Play 서비스를 쓰지 않는다**(§10-1): `FUSED_PROVIDER`는 플랫폼 API 31 제공(GMS 기기에서는 GMS FLP가 뒷받침한다). 한소네 7의 GMS 탑재·provider 목록은 조사 문서 §9 미확인 항목이라 위 `hasProvider` 폴백을 둔다. 실기기에서 provider·실내 취득 시간을 §9-11로 본다.
- 기기 위치 서비스 꺼짐(`isLocationEnabled()` 거짓)은 취득을 시도하지 않고 즉시 `Unavailable`(8초를 기다리지 않는다). 판정 자리는 iOS 절차 순서대로 **권한·정밀도 판정 뒤, 취득 직전**(권한 앞에 두면 위치를 켜고 돌아온 뒤에야 권한 다이얼로그가 떠 두 단계 왕복). 본문 문구는 §3-5 `FailedLocation` 행이 렌더 시 다시 판정한다.
- 매니페스트: `ACCESS_FINE_LOCATION`·`ACCESS_COARSE_LOCATION`(둘 다 선언해야 정밀/대략 선택 다이얼로그가 정상 동작).

## 5. 상태·모델

> §12(M2b)가 확장: `NearbyKindSpec.fetch(coord, previous)`(판정 25), `NearbyScreenViewModel.groupWindows`·`revealMoreInGroup`(판정 31), `PlaceDetailViewModel(place, hours, strings, station, barrierFree, dataLocale)`(§12-3).

- `NearbyScreenViewModel<Payload : Any>(coreFactory, strings, savedState)`: `phase: StateFlow<NearbyLoadPhase<Payload>>`(코어 그대로), `notice: StateFlow<Notice>`(M1 `Notice(seq, text)`), `landing: StateFlow<Landing>`(`None`·`Key(key, rev)` — 첫 로드·더 보기가 같은 꼴; 원인 헤딩 착지는 phase 효과가 맡는다), `reveal: RevealWindow` + `visibleCount: StateFlow<Int>`(둘러보기만 — `RevealWindow`는 참조 타입이라 `willCommit`·`revealMore` 뒤 `visibleCount`를 상태에 다시 써야 재구성된다, :kit KDoc), `load(force)`(viewModelScope, 이전 `load` Job은 코어 가드가 막으므로 취소하지 않는다) + `isLoading: StateFlow<Boolean>`(코어는 Loaded를 유지한 채 재조회하므로 새로고침 버튼의 `stateDescription` 근거) + `loadOnEnter()`(구성 변경 재진입은 재조회하지 않는다). `onEvent` 매퍼가 이벤트를 통지 문장으로(3-5 표). `FirstItem` 착지 발급은 **첫 착지 키(도메인 `firstKey(payload)`)가 직전 null → 지금 non-null**이고 아직 `didLand`가 아닐 때(phase 비교 금지, §3-5).
- `kind`별 코어 조립은 `NearbyKinds.kt` 한 파일(`around`·`subway`·`bus`·`bike`, 각각 fetch(**non-null 보장, 0건은 빈 리스트**)·`isEmpty(payload)` 술어·loaded 문장(건수/빈)·빈 문구·첫 착지 키). 화면은 `kind`로 조립기를 고른다 — M2b는 이 표에 행을 더한다.
- `PlaceDetailViewModel(place, hoursService, strings)`: `hours: StateFlow<PlaceHoursToday?>`(진입 시 1회 로드, 실패는 null·침묵), `notice`(복사·실패 통지).
- `SearchViewModel` 변경: `coordinate` 공급자 인자 추가(테스트는 `{ null }`), 결과 `Place.distanceMeters`가 행에 흐른다. 정렬 상태 `sort: PlaceSort`·`naverBackedSeen` 래치·`lastSubmittedQuery`·`toggleSort()`·실패 롤백(§3-3). pop 복귀 키 `returnFocusKey`(`SavedStateHandle`).

## 6. 실행 계층

| 기능 | 구현 |
|---|---|
| 복사 | `ClipboardManager.setPrimaryClip(ClipData.newPlainText("address", text))` + 통지 |
| 전화 | `Intent(ACTION_DIAL, Uri.parse("tel:" + phone.replace("-", "")))` |
| 외부 지도·홈페이지 | `place/ExternalOpen.kt`: 순수 계획 `OpenPlan(primary, fallback)`(`naverRoutePlan`·`kakaoRoutePlan`·`kakaoPlacePlan`, 권역 밖은 null → 버튼 숨김) + `openWithFallback`(`ACTION_VIEW`, `ActivityNotFoundException` → 폴백 1회, 그것도 실패면 `StatusLine` `android.common.noAppToOpen`). 설정 열기도 `tryStartActivity`로 같은 방어 |
| 설정 열기 | `location/LocationSettings.kt`: `appDetailsSettingsIntent(context)`(권한) · `locationSourceSettingsIntent()`(기기 위치 서비스) — M3와 공용 |
| 위치 | §4 |
| 이동 | 골격 `navigation-compose`(§2). 탭 루트는 골격의 `SearchRoute`·`NearbyRoute`; 스택 라우트 `place/PlaceDetailRoute(placeJson)` · `nearby/NearbyKindRoute(kind, anchorJson?)` · `nearby/BusRouteStopsRoute(source, cityCode?, routeId, routeNo)` |

## 7. i18n

- **iOS 전용 카탈로그 일괄 도입**: `messages-to-android-strings.mjs`가 `buildCatalog({ namespaces: [], extraDir: ios/i18n/ios-extra })`(namespaces가 빈 배열이면 messages를 건너뛰고 extra만 읽는다 — 실코드 확인)로 ios-extra를 평탄화한 뒤 **`ios.` 접두 키만** 취해 `android.*`로 개명해 합친다. ios-extra의 나머지 키(웹 키를 덮는 iOS 오버라이드 13개, 예: `dataSources.walkHealth` "iPhone 만보계")는 **무시**하고 무시한 수를 로그 한 줄로 낸다 — 안드로이드 문안 오버라이드는 android-extra에서만 한다. 같은 이름의 `android/i18n/android-extra` 키가 있으면 android-extra가 이긴다. 리소스 이름은 `android_nearby_subway` 꼴. `ios/**`는 읽기만 한다.
- **`%@` 원문 키**: ios-extra의 `ios.nearby.subwayEmptyNearest`·`subwayClosed`는 `{}` 플레이스홀더가 아니라 iOS 지정자 `%@`가 원문에 박혀 있어(6로케일) 그대로 들어오면 aapt2가 비위치 지정자 둘을 거부하거나 `formatLocalized`의 `String.format`이 예외를 낸다. android-extra 6로케일에 같은 문안을 `{station}`·`{distance}` / `{time}`으로 다시 쓰고(`INTENDED_DIFFERENCES`에 "문안 동일, 지정자만 명명형" 사유), 스크립트는 **`%%`·`%N$s` 이외의 `%`가 남은 값을 거부**한다(`rejected`, 드리프트 테스트 (5) 확장) — 검사는 `%%`·`%N$s`를 먼저 소비하는 스캐너로 쓴다(전방탐색 정규식은 `습도 %1$s%%`의 둘째 `%`를 오탐한다, 12건 실측).
- **의도된 차이 목록**: 드리프트 테스트 (4)를 일반화 — android-extra의 모든 `android.X`에 `ios.X`가 있으면 6로케일 문안이 같아야 하고, 예외는 테스트 파일의 명시 목록(`INTENDED_DIFFERENCES`)에 키와 사유를 적는다. M2 목록: `android.common.geoDeniedDesc`("설정에서 길동무의 위치 접근을 허용해 주세요" — iOS "설정 앱에서"), `android.common.geoReducedDesc`("대략적인 위치만 허용되어 있습니다. 정확한 위치를 허용해 주세요" — iOS 설정 경로 문장은 iOS 전용). 신설 안드로이드 전용: `android.common.back`("뒤로"). 종전 `android.search.*`·`android.tab.*`는 개명 도입분과 같은 문안이라 그대로 통과한다.
- arg-order: 도입된 `android.*` 키의 ko 인자 순서를 `android/i18n/arg-order.json`에 `--update-arg-order`로 잠근다. 테스트 (2)는 **같은 이름** 키만 iOS manifest와 대조하므로 개명 키는 걸리지 않는다 — 개명 표를 테스트가 알고 `android.X` ↔ `ios.X` 순서를 명시 대조하는 단언을 더한다.
- 신설 android-extra 키(6로케일): `android.common.back`("뒤로"), `android.common.noAppToOpen`("열 수 있는 앱이 없습니다"), `android.common.locationFailed`("현재 위치를 확인하지 못했습니다"), `android.common.locationOff`("기기의 위치가 꺼져 있습니다"), `android.nearby.announceRouteStops`("경유 정류소 {count}곳"), `android.nearby.subwayEmptyNearest`·`android.nearby.subwayClosed`(위 `%@` 재작성), `android.common.geoDeniedDesc`·`geoReducedDesc`(의도된 차이). 그 밖은 ios-extra 도입분으로 결손 없음.

## 8. 게이트와 테스트 레인

M1 §7 게이트 그대로(`:kit:test` · `:app:testDebugUnitTest` · assemble 두 구성 · `VITEST_MAX_THREADS=2 npm run test:run`, 락 안). M2가 더하는 테스트:

- **JVM(:app)**: `LocationStore`를 `LocationSource`(`start(listener)`·`stop()` — `LocationManager` 추상) + `PermissionGate` 페이크로 — 캐시 재사용·force·정확도 수용·타임아웃 최선값·하나도 없으면 Unavailable·COARSE만이면 ReducedAccuracy·거부·취소 시 `stop` 호출·ranking 경로는 팝업 없음. 타임아웃 폴백은 이번 취득의 최선값만(스토어에 옛 fix가 있고 이번 취득 fix 0 → `Unavailable`)·`hasProvider` 거짓이면 GPS 구독·`isLocationEnabled` 거짓이면 즉시 Unavailable·`coordinateForRanking`은 COARSE만이면 null(팝업 없음)과 스토어 폴백. `NearbyScreenViewModel`을 `:kit` testFixtures 스텁 전송 + 실캡처 fixture(`Fixtures.kit("subway-nearby.json")`·`bus-nearby.json`·`bike-nearby.json`·`around-nearby.json`·`bus-route-stops.json`)로 — 첫 로드 착지 1회·재조회 착지 없음·0건 → 새로고침 N건 → 착지 1회·Loaded 0건은 빈 문구(RefreshFailed 아님)·전락 통지·더 보기 착지 키·`visibleCount` 갱신. `AroundPayload` 조립(하나 실패 → Loaded + 플래그, 둘 실패 → FailedServer, 취소는 삼키지 않음). `subwayArrivalLine` 13키 `when` 전수(공유 fixture `subway-arrival-prose-cases.json`의 키 열을 돌려 미매핑 0)·버스 도착 줄·따릉이 줄·`nearbyTitle` 비-ko primary(문자열 공급 페이크). 검색: 좌표 직렬 대기·리뷰순 토글(노출 래치·마지막 질의 재조회·실패 롤백·착지 없음)·pop 복귀 키 저장/소비. `chooseFallback`. 라우트 JSON 왕복. 소스 가드: `LocationManager` 생성은 `location/` 패키지 한 곳(`grep`), `ACCESS_BACKGROUND_LOCATION` 문자열 0.
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
7. 장소 상세: 주소 줄 → 복사 버튼 → "주소 복사됨" 통지(Android 13+ 시스템 복사 UI가 따로 낭독되어 **이중**이면 우리 통지를 뺀다); 전화 걸기가 다이얼러를 연다; 네이버·카카오 버튼이 앱 또는 웹으로 간다.
8. 하단 탭 전환이 각 탭의 스택을 보존한다(지하철 보다 검색 갔다 오면 지하철).
9. 시스템 뒤로가 한 단계씩 내려온다.
10. 둘러보기: 위치 문장 헤딩 착지 → 한눈에 보기 6줄 → 가게 목록 → 더 보기 착지.
11. 실내에서 위치 취득 시간과 결과(8초 상한 안에 30m 수용 여부, 최선값 사용 여부, **어느 provider**를 썼는가 — `adb shell dumpsys location`으로 provider 목록도 기록) — 로그 1줄.
12. 검색 결과 거리 표기 "약 120m"를 TalkBack·점자가 어떻게 읽는가(m 오독 없으면 `spokenDistanceUnits` 제거).
13. 서울 밖 좌표(가능하면)에서 따릉이 "서울 지역에서만 제공됩니다".
14. 상세에서 뒤로 → 커서가 눌렀던 검색 결과 행에 있다(허브 → 지하철 → 뒤로도 같다). 기본 동작이 이미 복원하면 코드를 뺀다.
15. 리뷰순 토글: ko에서 결과 뒤 버튼이 보이고, 누르면 라벨이 바뀌며 목록이 재조회된다(착지 없음).
16. 기기 위치를 끈 채 내 주변 진입 → "기기의 위치가 꺼져 있습니다" + 설정 열기.

## 10. 판정 목록 (강한 디폴트 — 뒤집으려면 근거)

1. **Google Play 서비스 의존 0** — `LocationManager.FUSED_PROVIDER`(API 31, `hasProvider` 확인 + GPS 폴백). 근거: 한소네 7 GMS 탑재·provider 목록은 미확인(조사 §9), 플랫폼 API로 닫히며 의존성 하나가 준다. 판정 문서 §D10 표의 "FusedLocationProvider"는 역할 대응이지 라이브러리 지정이 아니라고 읽는다. 대가: **비-GMS 기기에서만** 융합 품질 차이 가능(GMS 기기는 플랫폼 융합 제공자가 GMS FLP로 뒷받침된다) — §9-11 실측으로 뒤집을 수 있다.
2. **현재 위치 표시줄·수동 위치 지정은 M2 밖**(별도 마일스톤) — **판정 22(§12-6)가 분할**: 표시줄(텍스트 행)은 M2b, 지정 시트·판정 스토어는 M2c. 근거: 표시줄은 역지오코딩 스토어·지정 시트·판정 스토어(`ManualLocation*`)까지 한 기능이고, 위치 출처 선언은 둘러보기 위치 문장이 이미 한다. 좌표 우선순위 "앵커 > 수동 > GPS"의 수동 층은 어댑터 클로저 한 곳에 들어갈 자리를 남긴다.
3. **둘러보기 "주변 상황" 조각은 M2b** — 340줄 자동 펼침 섹션(묶음별 리빌 창)이라 별도 과제. payload에 조각을 더하는 방식이라 커밋 원자성 계약은 그때도 유지된다.
4. **내 주변 나머지 6개·역 자동 섹션·무장애 자동 섹션은 M2b**. 관용구가 확립되면 반복이다.
5. **결과 진동 없음**. E30은 iOS 판정이고 D10은 촉각·청각을 안드로이드 방식으로 재설계한다고 했다 — M4 소리 설계와 함께 판정.
6. **`navigation-compose` 2.10.1(Nav2) 단일 `NavHost` + 탭별 백스택 보존** — 골격 `eb7bf0f8`에서 확정. Navigation 3(1.1.7 안정판, 공식 스킬 `navigation-3` 검토)는 탭별 백스택을 위해 `NavigationState`·`Navigator`·데코레이터 100여 줄을 앱이 소유해야 하고 Nav2는 `saveState/restoreState` 다섯 줄로 같은 접근성 결과(탭 라벨·선택 상태·키보드 탐색·프로세스 재생성 복원)를 낸다 — 소유 추상화가 적은 쪽.
7. **`Place`·앵커는 JSON 라우트 인자**. 대안 "메모리 홀더"는 프로세스 재생성에서 백스택이 죽는다.
8. **상단 바 통일(`TopAppBar` + 제목 헤딩)**, 검색 화면 제목도 옮긴다.
9. **`Column` 유지**(M1 §9-9 재판정): 지하철 ≤ 수 역 × 도착 몇 건, 버스 정류소 ≤ 10, 경유 정류소 ≤ 100여 행의 단문 — 전량 컴포즈가 싸다.
10. **전락 전이는 원인 헤딩 착지로 보강**(착지 라벨과 polite 통지가 순서대로 둘 다 나오는 안드로이드 기제에 맞춘 것 — §3-5).
11. **ios-extra 일괄 도입 + 의도된 차이 명시 목록**. 대안 "필요 키만 android-extra에 복사"는 80여 키 × 6로케일 수기 복제라 드리프트가 구조적으로 생긴다.
12. **주소 행은 비활성 텍스트 유지**(iOS 동형; 좌표 없는 주소는 상세가 없다).
13. **좌표 가중 검색은 허가된 세션에서만 조용히**(팝업 없음), 2초 상한, 실패는 좌표 없이 검색.
14. **채팅·길찾기·목적지 변경 진입 자리는 예약만**(§3-2 순서).
15. **커스텀 액션 판정 조건은 M1 §3-5 승계**(주소 복사 액션).
16. **위치 취득 타임아웃 폴백은 이번 취득의 최선값만**, 스토어 옛 값은 후보가 아니다(iOS `oneShotBest`).
17. **위치 실패와 서버 실패의 문구를 가른다**(`android.common.locationFailed` 신설; iOS·웹은 같은 문구 `failedTitle`) — 3-state. iOS 역이식 후보로 코디네이터에 보고. 기기 위치 서비스 꺼짐은 별도 문구 + 설정 열기(`android.common.locationOff`).
18. **경유 정류소 완료 통지는 전용 문장**(`android.nearby.announceRouteStops`; iOS는 "주변 정류소 N곳" 재사용 — 부정확). 첫 로드 착지는 iOS와 같이 없음.
19. **딥링크 빌더가 null이면 버튼 숨김**(iOS는 무반응 `guard return` — 무반응 버튼은 헌장 위반).
20. **리뷰순 토글은 M2 범위**(M1이 넘긴 항목, iOS `SearchModel` 동형).
21. **pop 복귀 착지 = 활성화했던 행**(§3-1). iOS `NavigationStack` 기본 동작의 등가를 코드로 세운다.

## 11. 적대적 설계 리뷰 판정

1차(2026-09-16, `~/gildongmu-wt/android-m1-reports/review-m2-design.md`, spec `bf2faed8`): **REQUEST_CHANGES** — BLOCKER 0·MAJOR 8·MINOR 11·NIT 6, 판정 D1~D13·계획 §5-1 금지 위반 없음. 25건 전부 반영(기각 0): ios-extra `%@` 키 2개 재작성 + `%` 가드·`ios.` 접두 키만 도입·타임아웃 폴백은 이번 취득 최선값만·`hasProvider` GPS 폴백·pop 복귀 착지(§3-1, §9-14)·FailedLocation 전용 문구와 기기 위치 꺼짐·경유 정류소 착지 없음 + 전용 통지·리뷰순 토글 범위 편입·`Empty` phase와 0건 분리(`isEmpty` 술어)·골격 `eb7bf0f8` 반영과 라우트 개명(`NearbyKindRoute`)·전락 착지 근거 정정·안드로이드 권한 회수는 프로세스 재시작·권한 대기 슬롯은 스토어·arg-order 개명 대조·`noAppToOpen`·`visibleCount` 상태·탭 루트 뒤로 동작·JVM 테스트 보강·좌표 직렬 대기·NIT 6. 2차(diff 재리뷰, spec `b428e2f7`): **APPROVE_WITH_CHANGES** — 1차 25건 전부 해소, 신규 MAJOR 1(첫 로드 착지 발급을 phase 비교가 아니라 첫 착지 키 null → 값 전이로)·MINOR 3(토글 iOS 세부 셋·pop 복귀 키 소비 규칙·기기 위치 판정 순서)·NIT 4 전부 본문에 흡수. **설계 확정.**

구현 리뷰(2026-09-16, `review-m2-spec.md` REQUEST_CHANGES BLOCKER 1·MAJOR 5·MINOR 8·NIT 6 / `review-m2-quality.md` REQUEST_CHANGES BLOCKER 1·MAJOR 3·MINOR 12·NIT 7, 구현 `0f67a542`): 공통 BLOCKER — 내 주변 착지 5곳의 `FocusRequester`가 `mergedRow`가 품은 `focusable()` 뒤에 붙어 조용히 무효(Compose 1.12 바이트코드로 확인). `mergedRow(tag, spoken, focus)`가 순서를 강제하고 소스 가드가 역순을 막는다. MAJOR — 내 주변 pop 복귀 미배선(→ `ReturnFocusSlot` 한 벌로 통일해 배선), 지하철 0건 본문(`emptyCopy(P)`), 통지 단위 풀어쓰기, 새로고침 `stateDescription`(`isLoading`), 복귀 키 컴포지션 소비(→ 효과 안), 중첩 Scaffold 이중 인셋(`WindowInsets(0)`). MINOR·NIT 전부 반영(회전 재조회 방지·전락 통지/bus·bike·경유 테스트·48dp `tapTarget`·설정 인텐트 방어·역명 정체성 근거·라우트 디코딩 1회·미사용 필드 제거 등). 기각 0 — `LocationStore.lastFixFailed`만 M3에 전파한 시그니처라 유지. 2차(diff 재리뷰, `dafbc759`): spec **APPROVE_WITH_CHANGES**(1차 20건 전부 해소, 신규 MINOR 4·NIT 2 — `AroundPayload` 좌표 복원, 권한 대기자 정리를 finally로, 착지 순서 가드 다줄·직접 경로, 제출 버튼 48dp, Log import, 갱신 시점 문장 — 전부 반영) · quality **APPROVE_WITH_CHANGES**(21/23 해소, 기각 수용 1, 신규 MINOR 3·NIT 4 — 새로고침 상태를 컴포지션에서 읽기, 권한 대기자 finally, 통지는 시각 원문 + 낭독형 `contentDescription`(`Notice.spoken`), 화면 `Scaffold`는 `AppScreenScaffold` 래퍼 + 소스 가드, 허브 패딩 순서 — 전부 반영; 클립보드 이중 낭독은 §9-7 실기기 판정). **구현 확정.**


## 12. M2b — 내 주변 나머지·자동 섹션·표시줄 (2026-09-16 추가)

> M2 통합(`0e8c1204`) 뒤 코디네이터 지시로 M2 spec에 절을 더한다. §1 "범위 밖" 중 이 절이 받는 것: 내 주변 나머지 6개, 둘러보기 "주변 상황" 자동 펼침, 장소 상세의 역 자동 섹션·무장애 자동 섹션, 현재 위치 표시줄. **받지 않는 것(§12-6 판정)**: 수동 위치 지정(M3 `directions/`의 출발·도착지 검색 화면을 재사용해야 한다 — M3 통합 뒤 M2c), 결과 진동(설정 스위치 화면이 없다 — 설정 화면 마일스톤과 함께). 동작 정본 iOS `Nearby/{ClinicNearbyView,BarrierFreeNearbyView,KidsNearbyView,EventsNearbyView,WalkInfraNearbyView,ConditionsView,SurroundingsSceneSection}.swift`, `StationSections.swift`, `BarrierFreeInfoSection.swift`, `LocationBarView.swift`, `CurrentAddressStore.swift`, `LocationService.swift`. §3~§10의 계약은 전부 승계하고 여기엔 더하는 것만 적는다. **신설 문자열 키 0건**(인용 키·간접 인용 키 전수가 6로케일에 실재 — 리뷰 축 6).

**언어 축**(m5): `AppLocale.current`(앱 언어)는 문장 조립·병기(`bilingualName`)·혼잡도 `message` 노출 조건·시각 포맷터 로케일에, `AppLocale.dataLocale`(데이터 언어)는 서비스 `lang` 인자·역 섹션 en 판정(`isEn`)·주소 조회 언어에 쓴다(iOS `AppLanguage.current`/`dataLocale` 동형).

**코드→문구 매핑표의 미지 값 처리**(M5 — 표마다 다르고 그 차이가 3-state 축이다, iOS 그대로):

| 표 | 미지 값 |
|---|---|
| `skyWord`·`precipWord` | `weather.unknown` 문구 |
| `gradeWord`(공기질 등급) | `airQuality.unknown`("정보 없음") — 원문 폴백 금지(해석 불가 등급을 낭독 정본에 올리지 않는다) |
| `levelWord`(혼잡도) · `metroKindLabel` · `dailyTypeLabel` · `directionLabel` · `clinicKindText` · kids `kindLabel` · scene `bucketName` | **원문 그대로**(정보를 잃느니 한국어 낭독) |
| kids `inOutLabel` | `kidsNearby.indoor.unknown` 문구(생략 금지) |
| `compassLabel`(8방위) | null → 호출부가 서버 문장(`name`)으로 폴백 |
| `operatingStatusText` · `bearingLabel`(8방위, 보행 인프라) | null → 그 조각 생략 |
| `barrierFreeFacilityLabel` | 서버 `label` 폴백 |

리터럴 리소스 ID `when`으로 되받고 동적 키 조립은 금지(§3-7 동형). 각 표의 기본 분기는 §12-5 JVM 테스트가 단언한다.

### 12-1. 내 주변 6개 kind (`NearbyKind` 확장, 허브 순서 = iOS: around·subway·bus·bike·clinic·barrierFree·kids·events·walkInfra·conditions)

전부 `NearbyKinds.kt` 조립기 한 행 + kind별 본문 파일 하나. 앵커 화면은 `conditions`만(장소 상세 "이 장소 주변" 4번째 행, iOS 동형). **목록형 4종(clinic·barrierFree·kids·events)**은 `RevealWindow` 더 보기 + 장소 행 버튼(→ 상세) + pop 복귀 착지(`place-{id}`); walkInfra·conditions는 `isEmpty = false`라 더 보기·장소 행·빈 문구가 없다(`emptyCopy`는 nullable, 미사용). 0건 통지는 M2 관례대로 **도메인 빈 문구를 통지에 재사용**한다(`loadedNotice`가 `isEmpty`면 `emptyCopy`와 같은 문장, m6).

| kind | payload / fetch | isEmpty · firstKey | 행 | 통지·빈 문구 |
|---|---|---|---|---|
| clinic | `ClinicPayload(clinics, basis, supplementFailed)` ← `NearbyService.clinics`(`basis ?: "weekday"`, `supplementFailed ?: false`) | `clinics.isEmpty()` · `place-{clinic.id}` | 머리(목록이 1건 이상일 때만 — 0건이면 본문 자체가 빈 문구다): `basis == "holiday"`면 `clinicNearby.basisHoliday`, `supplementFailed`면 `clinicNearby.supplementFailedNotice`. 행 = `PlaceRow(nightClinicToPlace, secondary = joinText(clinicKindText(kind), clinicStatusText(openStatus), place.distance))`. `clinicKindText`: `clinicKindKey` → `clinicNearby.kind.clinic/hospital`, 그 밖 원문. `clinicStatusText`: `open` → `clinicNearby.open` + `end`가 있으면 `clinicEndTimeText`(2400 → `android.nearby.untilMidnight`, 그 밖 `android.nearby.untilTime(HH, MM)`), `closed` → `android.nearby.clinicClosed`, 그 밖 `android.nearby.clinicUnknown` | `announcePlaces(n)` · `android.nearby.clinicEmpty` |
| barrierFree | `List<BarrierFreePlace>` ← `BarrierFreeService.nearby` | `isEmpty()` · `place-{contentId}` | `PlaceRow(barrierFreePlaceToPlace, secondary = joinText(address, place.distance))`. 목록 끝(더 보기 뒤) 출처 `barrierFreeInfo.source` 텍스트 | `announcePlaces(n)` · `android.nearby.barrierFreeEmpty` |
| kids | `List<KidsPlace>` ← `kidsPlaces` | `isEmpty()` · `place-{id}` | `PlaceRow(kidsPlaceToPlace, secondary = joinText(kindLabel, inOutLabel, place.distance, roadAddress ?: address))`. `kindLabel`: kidscafe/playground/playcenter → `kidsNearby.kind.*`, park → `android.nearby.kidsPark`. `inOutLabel`: indoor/outdoor → `kidsNearby.indoor.*`, 그 밖 `kidsNearby.indoor.unknown` | `announcePlaces(n)` · `android.nearby.kidsEmpty` |
| events | `List<CultureEvent>` ← `cultureEvents` | `isEmpty()` · `place-{id}` | `PlaceRow(cultureEventToPlace, secondary = joinText(category, eventFeeText, place.distance))`. `eventFeeText`: `isFree` → `eventsNearby.free`, 아니면 `eventsNearby.paid(fee ?: "")`.trim() | `announceEvents(n)` · `android.nearby.eventsEmpty` |
| walkInfra | `WalkInfraPayload(walk, asOf)` ← `WalkInfraService.nearby`, `asOf` = 커밋 시각의 **앱 언어 short time**(`DateFormat.getTimeInstance(SHORT, Locale(AppLocale.current))` — 인자 없는 `getTimeInstance`는 시스템 로케일이라 한 줄 안에서 언어가 섞인다(`AppLocale.kt` 함정); iOS `timeStyle: .short` 동형, `HH:mm` 고정 금지). **`coverage = none`**(판정 24) | `false` · `walkinfra-top` | ① 헤딩 `walkInfra.asOf(asOf)`(착지 지점) ② 그룹 헤딩 3개 **항상**(`walkInfra.groupAudio` · 횡단보도 `groupCrossing`/`groupCrossingCount(total)`/`groupCrossingTruncated(total, listed)` · 점자블록 `groupTactile`/`groupTactileCount`/`groupTactileTruncated` — total은 cap 전 실개수, 0이면 평문) + 상태별 행: `Ok` → 음향신호기는 `audioSummary(deviceCount)`+항목(`walkInfra.audioSite(direction, distance, deviceCount)`) 또는 0건 `audioNone`; 횡단보도는 항목 `joinText(itemLocation(direction, distance), hasSignal?, hasTactile?)` 또는 **0건 `walkInfra.crossingEmpty`**; 점자블록은 항목 `joinText(itemLocation, hostBusStop?/hostSubwayEntrance?)` 또는 **0건 `walkInfra.tactileEmpty`**(M4 — 헤딩 아래 침묵 금지); `Unsupported` → `*Unsupported`; `Error` → `*Error`. 미지 방위는 방위 조각 생략(잔여 공백·쉼표 trim). 거리 낭독 단위 풀어쓰기 ③ 각주: 성공한 소스만 인용(`walkInfra.footnote` + `joinText(sourceOsm?, sourceAudio(baseDate)?)`) | `walkInfraLiveSummary(walk)`(iOS 이식: 소스별 요약 결합, "0기" 합성 금지) · 빈 문구 없음. 로딩 문구 `walkInfra.loading`, 첫 로드 실패 `walkInfra.error`(`NearbyShell` `loadingText`·`failedText`) |
| conditions | `ConditionsPayload(weather?, air?, congestion?, freshWeather, freshAir)` ← `ConditionsService` 셋을 기존 `settled`(취소 재던짐 — `runCatching`·포괄 catch 금지)로 독립 조회, 혼잡도는 `Result.isSuccess`가 곧 `ok`. 어느 조각이든 `APIError.OutOfCoverage`면 전체 throw(이중 방어, `settled` 앞에서 가른다). 재조회 실패 조각은 **직전 값 유지**(`NearbyKindSpec.fetch(coord, previous)`, 판정 25), 혼잡도만 **성공한 null은 덮어쓴다**(핫스팟 밖이 답) | `false` · `conditions-weather` | ① 헤딩 `android.nearby.weatherHeading`(착지) + 하늘·강수·기온·최고/최저·습도·강수확률·기준 시각 행(각 한 줄, null 필드는 줄 없음; 정수 표기 `numberText`) 또는 `weatherFailed` ② 헤딩 `weather.airLabel` + 측정소 줄(병기)·khai·pm10·pm25(`라벨, 등급 (수치)`, 수치 null이면 등급만)·측정 시각 또는 `airFailed` ③ 혼잡도: **있을 때만** 요약 줄(`congestion.summary(name, levelWord)`)·앱 언어 ko일 때 `message`·`congestion.asOf` — 헤더 없음, 부재는 침묵(서울 91%가 핫스팟 밖) | `freshWeather && freshAir` → `conditionsReady` / 하나 → `conditionsPartial` / 둘 다 실패 → `failedTitle` · 빈 문구 없음 |

- 도메인 문장 조립은 순수 함수 파일(`nearby/{DomainLines,WalkInfraLines,ConditionsLines,SceneLines}.kt`, `place/StationLines.kt`)에 두고 리소스는 람다·낱말로 주입한다(JVM 검증).
- 장소 상세 **도메인 섹션**(iOS `domainSection` — 그 화면에 온 이유라 서열 1위, §3-2 표 1번 행(한글 원문 보조 줄) **다음**, 분류 앞): clinic → `ClinicDomainSection`(`clinicStatusText`, `directions`가 비지 않으면 `clinicNearby.directions(directions)`, `designated == true`면 `android.clinic.designated`) · events → `CultureEventSection`(장소·자치구(병기: 시각 `display`, 낭독 `primary`), `joinText(dateText, timeText)`, 요금, `eventsNearby.target(target)` — 빈 값은 줄 없음). 전달은 `PlaceDetailRoute`에 `domainJson: String?`(`@Serializable sealed class PlaceDomain { Clinic(clinic); Event(event) }`, `KitJson` 기본 다형 직렬화)로 싣는다 — 프로세스 재생성 뒤에도 섹션이 남는다(판정 26). `NearbyNav.onOpenPlace`는 `(Place, PlaceDomain?)`.

### 12-2. 둘러보기 "주변 상황" 자동 펼침 (iOS `SurroundingsSceneAutoSection`)

`AroundPayload`에 `scene: SurroundingsScene?`·`sceneFailed` 조각 추가 — 세 조각 한 fetch·한 커밋, **throw는 셋 다 실패일 때만**(현행 `o.isFailure && p.isFailure`를 삼항으로 확장, iOS `AroundNearbyView` 동형), `isAllAbsent`는 셋 다 부재(`scene == null && !sceneFailed` 포함)(M1). 위치는 한눈에 보기 **다음**, 가게 목록 **앞**(iOS 순서). 헤딩 `surroundings.ready` 아래: 실패 또는 null → `surroundings.error`, `total == 0` → `surroundings.empty`, 그 밖 묶음마다 헤딩 `bucketTitle`(`surroundings.bucket.{left|right|across|beyond|n|…|nw}`, 항목 3개 초과면 ` + surroundings.count(n)`), 항목 행, 묶음별 **더 보기**, 끝에 `surroundings.source` 각주. 착지는 부모의 위치 문장 1회뿐(조용히 나타나는 섹션 — 헤딩이 발견 경로). 자동 펼침이라 트리거·닫기 없음.

- **항목 행은 `PlaceRow`가 아니라 자체 문장 행**(M3): `mergedRow("scene-item-{bucket}-{index}")` 버튼(`clickable` 앞에 `focusRequester`), 문장 `surroundings.itemWithRoad(distance, name, road)`/`surroundings.item(distance, name)`(비-ko 병기: 시각 `display`, 낭독 `primary`; 도로명은 로마자만, 괄호 병기 없음), 활성화 → `sceneItemToPlace` 상세. **pop 복귀 키도 같은 값**. 같은 화면의 주변 가게 목록(`place-{id}`)과 같은 카카오 POI가 겹치는 것이 일상이라 `place-{id}` 태그를 쓰면 `FocusRequester`·복귀 키·테스트 태그가 충돌한다.
- **묶음별 리빌 창은 `NearbyScreenViewModel`이 소유**(M2): 내부는 `Map<String, RevealWindow>`(산술은 :kit 한 벌 — `revealMore(total)`이 첫 새 인덱스·경계를 준다), `groupWindows: StateFlow<Map<String, Int>>`는 공개 수 **투영**만(없으면 `RevealWindow.initialVisible`) + `revealMoreInGroup(group, totalCount, keyAt)`(첫 새 항목에 기존 `_landing` 슬롯으로 착지). 커밋 리셋은 기존 `willCommit`(주 창과 함께 비운다) — `NearbyKindSpec`에 훅을 더하지 않는다. `RevealWindow` 참조 타입을 그대로 상태에 두지 않는다(M2 §3-5 함정 동형).

### 12-3. 장소 상세 자동 섹션 (iOS `StationSectionsView`·`BarrierFreeInfoSection`)

- **역 자동 섹션 5종**(`isStation(place)`일 때만, `PlaceDetailViewModel`이 진입 시 `StationService` 5개를 조각별 `settled`로 병렬 로드(`station = place.name`, `lang = dataLocale`)): 조용히 나타난다(로딩 표시·통지 없음), 각 섹션 헤딩이 유일한 발견 경로. 순서 = 웹 배선(meta → arrivals → timetable → korail → metro), 위치는 "이 장소 주변" 다음(iOS). 실패·null은 그 섹션만 없음(③ 제외). ① 역 메타 `stationMeta.heading` — **ko**: `joinText(nameSuffixed(name), nameEn, tail)`, **en**(dataLocale): `joinText(bilingualName(name, en = nameEn).display, tail)`(낭독은 `.primary` — `nameSuffixed`·`nameEn` 조각 없음, m2); `tail = joinText(lines(pickLine en: linesEn), transfer?, operator)` ② 실시간 도착 `android.station.arrivalHeading`: 0건 `android.station.noArrivals`, 행 = `subwayArrivalLine`(§3-7 함수 재사용) ③ 시간표 `timetable.heading` **3-state**: `null` → 섹션 없음(미커버), 실패 → `timetable.error` 문장(숨기지 않는다), 성공 → `joinText(dailyTypeLabel, partial?)` + 노선마다 `coverageText` 또는 방향 행. `coverage = line.coverage ?: (directions 비면 "unknown" else "ok")`(m1 — 부재를 "확인 불가"로, 운행 없음으로 읽히지 않게); `noTrains/unavailable/unknown` 문장의 노선명은 `lineDisplayName`(en이면 `lineNameEn` 우선, 없으면 `lineKoName`); 방향 행 `joinText("{lineName} {direction}", "첫차 {train}", "막차 {train}")`의 노선명은 `lineKoName`(`lineCore`가 있으면 `timetable.lineSuffixed(lineCore)`, A26 — m3) 또는 en 자격(`lineNameEn` 있고 첫차·막차 각각 `terminusReady` = 종착이 비었거나 `terminusEn` 있음)일 때만 `lineNameEn`; `trainText`: `nextDay`면 `timetable.nextDay` 접두, 종착이 비면 시각만, 아니면 `timetable.toTerminus(terminus|terminusEn)` ④ 코레일 `android.station.railFacilities`: 장애인 화장실 Yes/No·휠체어 리프트(`countText` 3-state: null `countUnknown`·0 `countNone`·n `countSome`)·경사로 Yes/No·엘리베이터 `countText` ⑤ 서울 `android.station.seoulFacilities`: 종류마다 `android.station.kindCount(metroKindLabel, n)` + 시설 행 `joinText(facilityName, location, floors, operatingStatusText, facilityDetail)` — `facilityName`: `parts.compass+meters`가 있고 방위가 표에 있으면 `joinText(subway.elevatorAt(compass, distance), dong)`, 아니면 `parts.location`이 있으면 `joinText(location, lineEn ?: lineNumber(line))`, 아니면 `name`; `facilityDetail`(m12): `parts.restroomType` 또는 `parts.wheelchairAccessible == true`가 있으면 `joinText(restroomType, wheelchairAccessible?)`, 없으면 서버 `detail`; `supplementFailed`면 `subway.supplementFailed`, voiceGuide 그룹이 있으면 `subway.voiceGuideSource`.
- **무장애 편의시설 자동 섹션**(역 여부 무관): `BarrierFreeService.match(lat, lng, name)`(비-throw) 결과에 시설이 1개 이상일 때만 헤딩 `barrierFreeInfo.heading` + 행 `"{barrierFreeFacilityLabel(key)} {value}"`(27종 `barrierFreeInfo.facility.*`, 미지 키는 서버 `label`) + `barrierFreeInfo.source`. 위치는 역 섹션 다음(마지막).
- 배선(n7): `PlaceDetailViewModel(place, hours, strings, station: StationService, barrierFree: BarrierFreeService, dataLocale)`; `AppFactories.place`는 `(Place) -> Factory` 유지(도메인은 화면 인자).

### 12-4. 현재 위치 표시줄 (허브 첫 행, iOS `LocationBarView`의 텍스트 부분)

허브 맨 위 한 줄(텍스트 객체, `mergedRow("location-bar")`, 비-ko 낭독형은 `spoken`). **안드로이드 사실관계**: `PermissionGate.current()`는 `checkSelfPermission`뿐이라 **`LocationPermission.None`은 "거부"가 아니다**("아직 안 물음"과 같은 값, §4). 그래서 iOS의 `denied → gpsFailed` 갈래를 그대로 옮기면 첫 실행 허브가 시도 없이 실패를 단정한다(B1). 4-state(순서 = iOS: 권한 → 확정 실패 → 좌표 → 주소):

1a. `None` → **`android.common.geoDeniedTitle`("위치 권한이 필요합니다")** — 안 물었든 거부했든 참인 문장이고 다음 행동(내 주변 화면 진입)을 가리킨다. `gpsFailed`는 여기서 쓰지 않는다.
1b. `Coarse` → **`android.common.geoReducedTitle`("정확한 위치가 꺼져 있습니다")** — `coordinateForDisplay`는 `Fine`이 아니면 시도하지 않아 `lastFixFailed`가 서지 않으므로(프로세스 재시작 뒤엔 메모리 표식도 초기화), 권한 축에서 먼저 가른다. 내 주변 화면의 `ReducedAccuracy` 상태와 같은 축.
2. 좌표 없음 · `lastFixFailed` → `manualLocation.gpsFailed`(이 세션에서 확정된 실패).
3. 좌표 없음 · 시도 전/진행 중 → `manualLocation.locating` — `Fine`에서만 도달하고, 허브 진입이 `ensureLoaded()`를 돌리므로 끝이 있는 진행이다(성공 → 4, 실패 → `lastFixFailed` → 2).
4. 좌표 있음 → 주소가 있으면 `manualLocation.gpsNear(address)`(비-ko `bilingualName(address, en = english)` 시각 병기·낭독 영문), 없으면 `manualLocation.gps`.

- **좌표는 `LocationStore.coordinateForDisplay()`(신설)**: 권한 `Fine`이 아니면 null(팝업 없음), `currentCoordinate(timeoutMs = softTimeout)`에 **TTL·정확도는 기본값**(`freshTTL` 60초·`acceptAccuracy` 30m), 실패는 **null — `stored` 폴백 없음**(M6: 낡은 좌표로 만든 주소는 화면으로 반증할 수 없는 거짓 위치 주장). `coordinateForRanking`(soft TTL 300초·100m·스토어 폴백)과 세 축이 다르다. `LocationStore.authorization()`(= `permissions.current()`) 신설.
- **`location/CurrentAddressStore`**(앱 싱글턴, iOS 동형): `state: StateFlow<LocationBarInput(permission, hasCoordinate, lastFixFailed, address, english)>`가 관찰 채널(m13 — `LocationStore.stored`·`lastFixFailed`는 관찰 불가 필드라 스냅샷을 여기서 찍는다). `ensureLoaded(lang)`: inflight 가드 → `coordinateForDisplay()` → 스냅샷 갱신 → 좌표 없으면 끝(`loadedKey` 안 세움 — 허용 뒤 다시 조회) → 키 `"%.4f,%.4f|lang"` 같으면 끝 → 좌표가 갈렸으면 옛 주소 먼저 폐기 → `SearchService.reverseGeocode(lat, lng, lang)` → **취소는 확정 아님**(결과가 도착했을 때만 `loadedKey`·주소 확정) → 스냅샷 갱신. 좌표당·언어당 1회, 재시도 없음. **호출 시점: 허브 진입마다**(`LaunchedEffect(Unit)`) — 하위 화면이 새 fix를 잡고 돌아오면 키가 갈려 주소가 따라온다.
- 표시줄은 **권한을 요청하지 않는다**(판정 28) — 측위는 한다(허가된 세션에서만 soft 상한). `LocationBarInput`·문장 함수 `locationBarLabel`은 순수(JVM).

### 12-5. 테스트·실기기 추가

- JVM: 6 kind 조립기(Kit 실캡처 fixture `clinic-nearby.json`·`barrier-free-nearby.json`·`kids-nearby.json`·`walk-nearby.json`/`-degraded`/`-unsupported`·`air-nearby.json`·`weather-nearby.json`·`congestion-nearby.json`; 문화행사는 Kit fixture가 없어 손 fixture 1건을 `app/src/test/resources`에 둔다)로 첫 착지 키·통지·빈 문구; walkInfra 요약 문장(ok/unsupported/error 조합 + **ok·0건**)·그룹 헤딩(절단·0·비-ok)·미지 방위 생략; conditions 병합 규칙(실패 조각 직전 값 유지, 혼잡도 성공 null 덮어쓰기, 커버리지 마커 throw, 통지 3분기)·`numberText`·`pollutantText`; around 세 조각(둘 실패 + 장면 성공 → Loaded, 셋 실패 → throw, 셋 부재 → `isAllAbsent`); scene 묶음 제목 임계·12 bucket 전수·항목 문장(도로명 로마자)·`groupWindows` 리셋·착지 세대; 역 섹션 `countText`·`coverageText`(부재 폴백 포함)·`trainText`·`facilityName`·`facilityDetail`·`stationMetaLine`(ko/en) + **ViewModel 층 3-state**(m11: timetable 실패 → `Error`, null → `Hidden`, 나머지 실패 → null); 매핑표 9종의 기본 분기(원문/문구/생략/폴백); `barrierFreeFacilityLabel` 27키 리터럴 `when` 전수(키 목록은 `strings.xml`에서 읽어 미매핑 0); `coordinateForDisplay`(권한 없음 → null 팝업 없음, 낡은 stored + 이번 실패 → **null**); `CurrentAddressStore` 좌표당 1회·언어 키·취소 비확정·미허용 시 `loadedKey` 미확정; `locationBarLabel` 4-state(None → 권한 필요 문구, `Coarse`+실패 → gpsFailed, 병기). `PlaceDomain` JSON 왕복.
- ATF(androidTest, 컴파일은 게이트·실행은 기기 연결 시, m10): walkInfra 그룹 헤딩 3개 구조 + 착지, conditions 섹션 헤딩 + `conditions-weather` 착지, 장소 상세 역 자동 섹션 헤딩(통지 0), 허브 첫 행 표시줄 낭독.
- 실기기(§9에 추가): 17 허브 10행 순서·표시줄 낭독(첫 실행 "위치 권한이 필요합니다" → 하위 화면 허용 뒤 복귀하면 주소) 18 보행 인프라 3그룹 헤딩 점프 19 날씨 화면 착지(날씨 헤딩) 20 역 장소 상세에서 자동 섹션 5종 헤딩 점프 21 둘러보기 주변 상황 묶음 헤딩·더 보기 착지 22 소아진료 상세의 도메인 섹션이 보조 줄 다음.

### 12-6. 판정 (§10 이어서)

22. **수동 위치 지정은 M2c(M3 통합 뒤)** — 지정 시트가 iOS `Directions/DirectionsEndpointSearchView`(`.manualLocation` 타깃)를 재사용하므로 M3의 `directions/` 출발·도착지 검색 화면이 먼저다. 표시줄은 텍스트 행으로 먼저 세우고 M2c에서 버튼(`manualLocation.pickTitle` 꼬리)으로 바꾼다. `ManualLocationStore`·`ManualLocationJudge`·`effectiveCoordinate`도 M2c. (판정 2를 분할 — 코디네이터 승인 2026-09-16)
23. **결과 진동은 M2b 밖** — iOS는 실험판 설정 스위치(`TrendHaptics.storageKey`) 뒤이고 안드로이드에 설정 화면이 없다. 설정 화면 마일스톤(언어·진동·받아쓰기 홀드 등 iOS 설정 미러, 별도 항목)에서 `HapticFeedbackConstants.CONFIRM/REJECT`로 판정한다. (코디네이터 승인 2026-09-16)
24. **walkInfra는 `coverage = none`**(iOS 주석 그대로 — 소스별 미제공 문구가 커버리지 밖 한 문구로 뭉개지지 않게).
25. **conditions 조각 병합은 `NearbyKindSpec.fetch(coord, previous)`** — 코어는 이미 `previous`를 넘기고 있고 앱이 버리고 있었다. arity만 늘리고 기존 5개 조립기는 `{ c, _ -> }`.
26. **도메인 섹션은 라우트 JSON 인자**(`PlaceDomain`) — 재생성 뒤에도 남는다(iOS는 뷰 트리 수명).
27. **시간표만 3-state 보존**(실패 문장), 나머지 자동 섹션은 실패 = 미노출(iOS·웹 동형). ViewModel 층 테스트가 잠근다.
28. **표시줄은 권한을 요청하지 않는다**(허가된 세션에서만 soft 측위, 팝업 없음) — 허브 진입만으로 권한 팝업이 뜨면 "내 주변 최초 사용 시점" 계약이 깨진다. 허브 진입이 측위를 시작하는 것(배터리·동작)은 사실이며 의도다.
29. **`LocationPermission.None`은 표시줄에서 "권한이 필요합니다"로 말한다** — 안드로이드는 "안 물음"과 "거부"를 가를 수 없고(§4), 실패 문구(`gpsFailed`)는 확정된 시도(`lastFixFailed`)에만 붙인다. "물어본 적 있다" 비트를 저장하는 안은 상태 하나가 늘므로 기각(미니멀리즘). `Coarse`는 별도 갈래(1b, `geoReducedTitle`) — 표시용 좌표는 `Fine`에서만 시도하므로 실패 표식으로는 잡히지 않는다.
30. **장면 항목 행은 자체 문장 행**(`scene-item-{bucket}-{index}`) — `PlaceRow` 태그가 같은 화면의 가게 목록과 충돌한다.
31. **묶음별 리빌 창은 ViewModel 소유 `StateFlow<Map>`** — `NearbyKindSpec` 훅·payload 커밋 ID를 더하지 않는다(기존 `willCommit`이 함께 비운다).

적대적 설계 리뷰 판정(§12, `review-m2b-design.md`): 1차 REQUEST_CHANGES(BLOCKER 1·MAJOR 6·MINOR 14·NIT 7) → 28건 전부 반영(B1 → 판정 29, M1~M6·m1~m14·n1~n7 본문 반영), 기각 0 → 2차 diff 재리뷰 APPROVE_WITH_CHANGES(MAJOR 1 `Coarse` 갈래·MINOR 4·NIT 2) → 7건 전부 반영(1b 갈래, 포맷터 앱 언어, 리빌 창 :kit 산술, `terminusReady`, `settled`, 판정 29 근거, §5 교차 표기). **설계 확정.**

구현 리뷰 판정(§12, `review-m2b-spec.md`·`review-m2b-quality.md`): spec-compliance APPROVE_WITH_CHANGES(MINOR 3·NIT 2 — 세 인자 필수화·착지 순서 가드에 `clickable`+후행 람다·매핑표 resId `internal`+미지 값 단언) · code-quality APPROVE_WITH_CHANGES(MAJOR 2(위와 동일)·MINOR 6·NIT 11 — 0건 문구 거리 풀어쓰기, `contentDescription`은 낭독이 다를 때만, ATF `assert(` 금지 가드, `settled`를 `net/`으로, `Locale.forLanguageTag`, `timetableLineEnName`, 태그 인덱스, `@MainThread`). 전부 반영, 기각 0. 후속(코드 변경 없음): 표시줄이 낡은 좌표를 주소 근거로 쓰는 경로는 iOS·웹과 같은 구멍이라 3자 동조 판정 후보로 코디네이터에 전달(quality MINOR 6). **구현 확정.**

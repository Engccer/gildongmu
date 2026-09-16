# 안드로이드 앱 설계 — M1 검색 화면 (2026-09-16)

> 범위는 **M1(검색 화면)** 이다(판정 문서 §5 "spec은 M1 범위로 좁혀서"). 입력: 판정 `2026-09-15-android-app-decisions.md` §1(재논의 없음), 계획 `../plans/2026-09-16-android-app-parallel-plan.md` §5-1 4·5항, M0 산출물(`android/README.md`, main `41f377b5`). iOS `SearchView.swift`·`SearchModel.swift`와 웹 `PlaceSearch.tsx`·`search-sections.ts`가 동작 정본이다.
>
> 적대적 설계 리뷰 판정: (§10에 기록)

## 1. 목표와 범위

**목표**: 한소네 7(Android 15, 점자 키보드 탐색)과 TalkBack 터치 양쪽에서 검색어 입력 → 결과 목록 탐색이 완결되는 첫 화면. M0이 세운 뼈대 위에 [3] 실행 계층(전송·저장)·[4] 화면 계층·i18n 파이프라인·접근성 기본형을 처음으로 확립한다. 이후 화면(M2~M6)은 여기서 정한 관용구를 반복한다.

**범위(계획 §5-1 4항 그대로)**:
1. 홈 옴니박스 검색 — `/api/places` + `/api/address/search` 병렬(둘 다 0건이면 `/api/search/web` 폴백), 정확도순 플랫 리스트, 칩 필터 두 축(분류·지역, AND), 최근 검색(기록·재검색·삭제·고정·모두 지우기)
2. i18n 변환 스크립트 — `messages/*.json` + `android/i18n/android-extra/*.json` → `android/app/src/main/res/values(-lang)/strings.xml`, ko 등장 순서 positional, byte-identical, `android/i18n/arg-order.json` 순서 잠금
3. 서버 base URL `https://gildongmu.dodoplanet.space`, **서버 계약 변경 0**
4. 접근성 기본형 — 한 줄 = 한 접근성 객체, 헤딩, 단일 polite 통지 창구, 포커스 이동 관용구, 44dp 타깃, 터치·키보드 이중 1급, 이모지 0
5. Compose 접근성 검사 레인(Accessibility Test Framework) 연결
6. 받아쓰기는 API 33 게이트 함수만(D9), 버튼 없음

**범위 밖(M1이 아닌 것, 판정 기록)**: 장소 상세·주소 좌표 변환(M2), 위치 권한·좌표 가중 검색(M2 — 아래 §9 판정 2), 네이버 리뷰순 토글(계획 목록에 없음, M2에서 장소 상세와 함께), 현재 위치 표시줄, 언어 설정 화면(시스템 앱별 언어를 따른다, §6), Play 업로드.

**완료 조건**: 실험판 APK가 한소네 7에 설치되어 검색어 입력 → 결과가 점자로 읽힌다(위원장 판정, 코디네이터 경유). `adb exec-out timeout 10 uiautomator dump /dev/tty`로 접근성 트리 구조를 보고에 남긴다. 머신 게이트(`:kit:test`·`:app:testDebugUnitTest`·assemble 두 구성·vitest)는 실기기 없이 초록이어야 한다.

## 2. 아키텍처 (D5 네 계층의 M1 절단면)

```
[4] 화면     SearchScreen(Compose) ── 상태 구독 ──▶ SearchViewModel(StateFlow<SearchUiState>)
[3] 실행     HttpUrlConnectionTransport(M0) · SharedPreferencesStore · AppLocale · Dictation 게이트
[2] 판정     :kit  SearchService · SearchOutcome · filterPlacesBy*  · RecentSearchStore · formatLocalized · bilingualName · pickCategory
[1] 서버     기존 라우트 3개(/api/places · /api/address/search · /api/search/web). 변경 0
```

- `SearchViewModel`(`androidx.lifecycle.ViewModel`)이 iOS `SearchModel`의 미러다: 질의·결과·검색 중·실패·결과 세대(`resultsRevision`)·필터 두 축·최근 검색 목록을 한 `SearchUiState`(불변 data class)로 들고 `StateFlow`로 낸다. 화면은 상태를 그리기만 하고 판정을 하지 않는다.
- 요청 세대: 새 제출이 앞 검색 `Job`을 취소한다(iOS `searchTask?.cancel()` = 웹 request-id ref). 취소된 검색은 상태를 쓰지 않는다.
- 의존성 주입은 생성자 인자(`SearchService`·`RecentSearchStore`·`dataLocale` 공급자). 프레임워크 DI 없음(YAGNI). `AppConfig.apiClient`(M0)가 공유 클라이언트.
- 패키지: `space.dodoplanet.gildongmu.search`(화면·ViewModel), `.net`(전송, M0), `.storage`(SharedPreferences), `.i18n`(`AppLocale`·`appLocalized`), `.speech`(게이트), `.a11y`(관용구 modifier).

## 3. 화면 구조와 접근성 계약

읽기 순서 = 시각 순서 = 아래 순서. 전부 한 `LazyColumn` 안(가상 스크롤이 아니라 Compose LazyColumn은 접근성 트리에 오프스크린 노드도 노출한다 — 헌장 §1 목록 규칙 충족, 검증은 §8 실기기 항목).

| 순서 | 요소 | 접근성 계약 |
|---|---|---|
| 1 | 제목 "길동무" | `semantics { heading() }`. 앱 바 없이 본문 첫 요소(iOS `navigationTitle` 대응) |
| 2 | 검색 입력 | `TextField` 라벨 `search.label`("장소 검색"), placeholder `android.search.prompt`, IME `Search`가 제출. 입력이 있으면 뒤에 지우기 버튼(`search.clear`, 누르면 입력으로 포커스 복귀) |
| 3 | 검색 버튼 | `search.button` 문안에서 "(Enter)" 꼬리는 웹 전용이라 android-extra가 "검색"으로 덮는다. 검색 중엔 `disabled`가 아니라 클릭 무시 + `stateDescription`("검색 중")(헌장 §5 ⓐ — disabled는 포커스를 떨군다) |
| 4 | 상태 문장 | 단 하나의 `Text`에 `liveRegion = Polite`. 내용은 §4 통지 표. 비어 있으면 접근성 트리에서 빠진다(빈 문자열은 무발화) |
| 5 | 최근 검색 | 결과가 없고 검색 중이 아닐 때만. 헤딩 `recent.title` + 행(버튼, 라벨 = 텍스트 또는 `텍스트, 고정됨`) + `recent.clearAll` 버튼. 행의 로터(TalkBack 작업 메뉴) 액션 = `customActions`: 고정/해제·삭제. 삭제 뒤 포커스: 다음 행 → 이전 행 → 목록 소멸 시 검색 입력(iOS의 마이크 행 대신 — M1엔 마이크가 없다) |
| 6 | 결과 헤딩 | 섹션이 둘 이상일 때만 섹션 헤딩(`search.placeSection`·`search.addressSection`·`android.search.webSection`) — 웹 `showSectionHeadings`·iOS 미러 |
| 7 | 칩 필터 | 장소 섹션 안, 축마다 `Row`(`selectableGroup()`) + Material3 `FilterChip`(`selected` 시맨틱 내장 — TalkBack이 "선택됨"을 읽고 점자에 상태가 찍힌다). 축의 접근 가능한 이름은 `category.filterLabel`·`region.filterLabel`(그룹 `contentDescription`이 아니라 축 앞 텍스트 라벨 한 줄 — 과잉 ARIA 회피). 칩 라벨 `분류 N`·전체 칩(`category.all`·`region.all`). 항목이 1개 이하인 축은 숨김(웹 ChipFilter 미러). 칩 목록·건수는 전체 결과 기준 고정(선택해도 줄지 않는다) |
| 8 | 결과 행 | 장소: `이름` + `분류, 주소, 약 거리`를 `Modifier.semantics(mergeDescendants = true)`로 한 객체. 비-ko는 `bilingualName`으로 시각 `Roman (한글)`, 낭독 `contentDescription`은 primary만. 주소: `roadAddr, zipNo`(비-ko는 `engAddr (roadAddr), zipNo`, 낭독 괄호 없이). 웹: 제목+요약 한 객체, 활성화 = 브라우저 열기(`Role.Button`). **M1의 장소·주소 행은 활성화 대상이 아니다**(상세는 M2) — 그래서 버튼이 아니라 `focusable()` 텍스트 객체다. 거리 낭독은 `spokenDistanceUnits`로 m을 풀어 `contentDescription`에 |
| 9 | 필터 결과 0건 | `search.noFilterResults` 텍스트(칩은 남는다) |

- **포커스 착지**: 결과 도착(`resultsRevision` 증가) 시 첫 결과 행으로 `FocusRequester.requestFocus()`. 행은 `focusable()`이라 키보드 포커스와 TalkBack 포커스가 함께 움직인다(가정 — §8 실기기 검증 1순위. 안 따라오면 `semantics { focused }` 대신 `AccessibilityNodeInfo` 요청 경로로 바꾼다). 정렬·필터 변경은 착지 없음(사용자가 컨트롤에 커서를 둔 채 일으킨 변화). 목록 소멸(삭제·모두 지우기)의 착지는 위 표.
- **터치 타깃**: 모든 컨트롤 `minimumInteractiveComponentSize`(48dp, Material3 기본) — 44dp 요구 충족. 텍스트 행은 최소 높이 48dp.
- **키보드**: 모든 컨트롤·행이 Tab/방향키로 도달(`focusable`). 한소네 점자 키보드는 표준 키 이벤트다.
- **금지**: 이모지 라벨, 시각 텍스트를 덮는 `contentDescription`(병기 낭독 축소만 예외), 별도 live region 추가, `disabled`, 장식 요소의 노출.

## 4. 상태 머신 (SearchViewModel, iOS SearchModel 미러)

```
SearchUiState(query, outcome: SearchOutcome?, isSearching, failed, resultsRevision, bucket, region, recentQueries)
submit(raw):  trimmed 비면 무시 → 앞 Job 취소 → recentQueries = store.recordQuery → bucket=region=null → isSearching=true
             → service.search(query, lat=null, lng=null, lang=dataLocale, includeWeb=true)
             → (취소 아니면) outcome=result, failed = result.allFailed && totalCount==0, isSearching=false, resultsRevision++
clear():     query="" (결과는 유지 — iOS .searchable 동형)
setBucket/setRegion: 필터만 갱신(착지 없음)
recent: recordQuery(submit 경로 공용) · removeQuery · setQueryPinned(자리 유지, 다음 로드부터 정렬) · clearQueries
```

통지 표(단일 polite 창구, 상태 문장 `Text`가 곧 통지):

| 상태 | 문장(키) |
|---|---|
| 검색 중 | `search.searchingFor`(질의 포함) |
| 실패(장소·주소 둘 다 실패, 결과 0) | `android.search.announceFailed` — "결과 없음"과 다른 문장(3-state) |
| 결과 0 | `android.search.announceEmpty` |
| 결과 N | `android.search.announceCount`(복수형) |
| 최근 검색 삭제/모두 지움 | `recent.deleted`·`recent.cleared`·`recent.clearedExceptPinned` — 포커스 이동이 동반되는 통지는 상태 문장에 쓰되, 이동 착지 라벨과 겹치면 착지가 이긴다(안드로이드 TalkBack은 우선순위 API가 없다 — 실기기에서 잠식되면 상태 문장 갱신을 착지 뒤 200ms 지연) |

`totalCount` = `orderedSections` 건수 합. `failed` 판정은 iOS와 같다.

## 5. 실행 계층 구현

- **전송**: M0 `HttpUrlConnectionTransport`(60초 기본, `SocketTimeoutException`은 IOException). `INTERNET` 권한만.
- **저장**: `SharedPreferencesStore(context) : KeyValueStore` — 파일 `gildongmu.recent`, 값은 JSON 문자열(:kit `RecentSearchStore`가 만든다). iOS UserDefaults 키 이름(`recentQueries.v2` 등)을 그대로 쓴다.
- **언어**(`AppLocale`): UI 언어 = 앱 리소스 구성 로케일(`resources.configuration.locales[0]`), 지원 6개(`ko en es fr it ja`) 밖이면 ko. Android 13+ 앱별 언어를 위해 `res/xml/locales_config.xml` + manifest `android:localeConfig`. `dataLocale` = ko면 "ko" 아니면 "en"(웹 `data-locale.ts`·iOS `AppLanguage.dataLocale` 동형). 앱 내 언어 선택 화면은 M1 밖.
- **받아쓰기 게이트**(`speech/Dictation.kt`): `isAvailable(context) = SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)`. M1에서는 호출처 없음 — 함수와 단위 테스트(SDK 분기)만. 버튼·권한·`RECORD_AUDIO` 선언은 마이크를 붙이는 마일스톤에서.

## 6. i18n 파이프라인

**정본은 `messages/*.json`(웹)이고 안드로이드 전용 키는 `android/i18n/android-extra/{lang}.json`**(iOS `ios-extra`와 같은 역할·같은 병합 규칙: 같은 키면 extra가 웹 값을 덮는다). M1 extra 키: `android.tab.*`(검색·길찾기·내 주변·채팅), `android.search.{prompt,searching,failedTitle,webSection,announceFailed,announceEmpty,announceCount}`, `search.button` 오버라이드("검색"). 문안은 iOS extra와 같은 문장을 쓴다(한 앱의 두 플랫폼이 다른 말을 하지 않는다).

**생성 스크립트 `android/scripts/messages-to-android-strings.mjs`**: iOS 빌더 `buildCatalog({namespaces: null, extraDir: android-extra})`를 import해 같은 규칙(ko 등장 순서 positional, ICU 복수 블록은 `{N, plural, one {…} other {…}}` 문자열 그대로, `#` → `%N$@`)으로 만든 뒤 `%N$@` → `%N$s`로 바꾸어 로케일별 `strings.xml`에 쓴다.
- 리소스 이름: 키의 `.`을 `_`로(`search.placeCount` → `search_placeCount`). 1,305키에서 충돌 0 확인.
- 기본 `values/`는 ko(source language), `values-en` … `values-ja`. 키가 어떤 로케일에 없으면 그 로케일 파일에서 빠져 Android가 기본(ko)으로 폴백한다(iOS `?? byLang["ko"]` 동형).
- XML 이스케이프: `'`·`"`는 `\'`·`\"`, `&`·`<`·`>`는 엔티티, 선두 `@`·`?`는 `\`. `%`는 그대로(`%%`는 이미 이스케이프돼 있다). 모든 `<string>`에 `formatted="false"`를 붙이지 않는다 — aapt2가 `%1$s` 형식을 검증해 주는 것이 이득이고 ICU 중괄호는 검증 대상이 아니다.
- **복수형은 Android `<plurals>`로 가지 않는다**: 한 문장에 복수 블록이 둘인 키(`bike.availability`)가 실재하고, 앱 선택 언어와 리소스 로케일이 같으므로 iOS와 같은 방식 — `:kit` `formatLocalized(format, lang, args)`(M0 이식, A29)가 런타임에 분기를 고른다. 그래서 **인자 있는 문자열은 반드시 `appLocalized(R.string.x, args…)`를 지난다**(`getString(id, args)` 직접 호출 금지 — ICU 원문이 낭독된다). 소스 가드: `:app` 단위 테스트가 `getString(` + 인자 호출 꼴을 스캔한다.
- **인자 순서 잠금**: iOS 스크립트의 `syncArgOrder({manifestPath: android/i18n/arg-order.json, current})`를 그대로 써서 같은 게이트(기존 키 순서 변경은 exit 1, `--update-arg-order`로만 통과, 부트스트랩도 그 플래그로만). 웹과 공유하는 키의 순서는 iOS manifest와 같아야 한다(같은 ko 원문이므로 구조적으로 참, 테스트가 단언).
- 결정론: 키 정렬·로케일 순서 고정·끝 개행 1개. `--check`가 byte 비교. vitest `android-strings-drift.test.ts`가 (1) 생성물 최신 (2) arg-order 정합 (3) 공유 키의 iOS manifest 일치를 매 커밋 본다.
- 소비: `appLocalized(context, R.string.key, vararg args)` = `formatLocalized(resources.getString(id), AppLocale.current, args)`. 인자 없는 문자열은 `stringResource(id)` 그대로.

## 7. 게이트와 테스트 레인

| 레인 | 무엇 | 어디서 |
|---|---|---|
| `:kit:test` | 판정 계층(M0) | JVM, 머신 게이트 |
| `:app:testDebugUnitTest` | `SearchViewModel` 상태 머신(스텁 `SearchService` — `StubTransport`로 조립), `AppLocale.dataLocale` 매핑, `Dictation` SDK 분기(정적 함수), `getString(` 소스 가드 | JVM, 머신 게이트 |
| `:app:connected*AndroidTest` | Compose UI 테스트 + `enableAccessibilityChecks()`(ATF: 라벨 누락·타깃 크기·대비·순회 순서)로 검색 화면 렌더·칩 토글·행 병합 확인 | 실기기(한소네, `adb` 연결 시), 머신 게이트 밖 |
| vitest | `mirror-registry`·`android-kit-drift`(M0) + `android-strings-drift` | 머신 게이트 |
| 실기기 판정 | 점자 낭독·포커스 착지·키보드 순회·`uiautomator dump` 구조 | 위원장(코디네이터 경유) |

의존성 추가(`libs.versions.toml`): `androidx.lifecycle:lifecycle-viewmodel-compose` 2.11.0, `androidx.compose.material3` FilterChip(있음), androidTest: `ui-test-junit4-accessibility`(BOM), `androidx.test.ext:junit` 1.3.0, `androidx.test:runner` 1.7.0. 단위 테스트: `kotlin("test")`·`kotlinx-coroutines-test`.

## 8. 실기기 검증 항목 (완료 조건의 세부)

1. 점자로 제목 → 입력 → 버튼 → 상태 → 결과 행 순으로 읽힌다(한 행 = 한 셀 묶음).
2. 결과 도착 뒤 커서가 첫 결과 행에 있다(포커스 착지 가정 검증).
3. 칩 선택이 "선택됨" 상태로 읽히고 목록이 걸러진다.
4. 최근 검색 삭제 뒤 커서가 다음 행(또는 입력)에 있고 "삭제했습니다"가 잠식되지 않는다.
5. TalkBack 터치(가능하면 일반 폰, 아니면 한소네 LCD 터치)에서 1·2·3이 같다.
6. `uiautomator dump`에서 결과 행이 하나의 노드(text 또는 content-desc 하나)로 나온다.

## 9. 판정 목록 (강한 디폴트로 정한 것 — 뒤집으려면 근거)

1. **문자열은 Android 리소스 + ICU 런타임 해석**(§6). 대안 "iOS처럼 JSON 카탈로그를 앱이 직접 읽기"는 리소스 로케일·앱별 언어 설정·aapt 형식 검증을 버린다. 대안 "네이티브 `<plurals>`"는 두 블록 키를 표현 못 한다.
2. **M1은 위치를 쓰지 않는다**(좌표 없는 검색 = 전국 정확도순, 거리 표기 없음). 근거: 계획 §5-1 4항 목록에 위치가 없고, 위치 권한·Play Services 의존·권한 화면 접근성은 M2(내 주변)가 어차피 세워야 하는 축이라 거기서 한 번에. 대가: M1 실기기 검증에서 "근처 결과 매몰"을 위원장이 느낄 수 있다 — 보고에 명시.
3. **장소·주소 행은 M1에서 비활성 텍스트 객체**(상세는 M2). 버튼으로 두고 아무것도 안 하는 것이 더 나쁘다.
4. **리뷰순 토글·현재 위치 표시줄·언어 설정 화면은 M1 밖**.
5. **ViewModel은 androidx.lifecycle**(구성 변경 생존, Compose 통합 표준). 대안 "일반 클래스 + remember"는 회전·프로세스 재생성에서 상태를 잃는다.
6. **DI 프레임워크 없음**(생성자 주입). 화면 하나에 Hilt는 YAGNI.
7. **네트워크 라이브러리 없음**(`HttpURLConnection`). 라우트 3개 GET·JSON이라 충분하고 의존성 0.
8. **포커스 착지 = 키보드 포커스**(`focusable` + `FocusRequester`). TalkBack이 따라오지 않으면 §3의 대체 경로.

## 10. 적대적 설계 리뷰 판정

(리뷰 뒤 기입)

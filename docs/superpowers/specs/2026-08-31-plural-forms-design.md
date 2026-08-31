# 수량 문구 복수형 설계 (A29) — 웹 ICU plural + iOS 단일 해석기

- 날짜: 2026-08-31
- 상태: 설계 확정(구현 착수). 코디네이터 설계 사항은 `docs/superpowers/plans/2026-08-31-en-locale-korean-cleanup-parallel-plan.md` §웨이브 3이 정본이며 이 문서는 그것을 코드 계약으로 옮긴다.
- 병렬 세션: plurals(이 문서). 같은 웨이브의 category-en(A28)과 `SearchView.swift`·両 `Localizable.xcstrings`(생성물)·`messages/*.json`이 겹친다 — 먼저 push한 쪽이 기준, rebase 뒤 xcstrings 재생성.
- **설계 리뷰 게이트 판정: 실시.** 새 판정 계층(복수 카테고리 규칙 + ICU 블록 해석기)이 iOS 표시 문자열 전부를 지나고, 틀리면 오류가 아니라 "1 places"·"0 lieux"처럼 **낭독만 어긋나는 무증상 결함**이라 codex adversarial-review 대상이다. 결과는 §10.

## 1. 문제

위원장 웹 실사용 스크린샷 "1 places". `messages/en.json`에 ICU `plural` 0건, `{count}`류 키 39개가 전부 복수형 고정이고, 両 `Localizable.xcstrings`에 복수 변형 0건이다. es·fr·it도 같고, 일부는 `device(s)`·`cambio/i`처럼 괄호 표기로 회피하고 있다(스크린 리더는 "device s"·"cambio slash i"로 읽는다). ko·ja는 복수 굴절이 없어 대상이 아니다.

## 2. 범위 판정 — "수량 뒤에 굴절하는 명사가 오는가"

키가 아니라 **로케일별 문장**이 판정 단위다. 같은 키라도 en은 굴절이 없고 es는 있는 경우가 있다(`chat.reviewPlacesHeading` en "Top {count} by Naver reviews" / es "{count} lugares por reseñas de Naver"). 판정 표(§2.1·§2.2)의 ○ 칸만 ICU plural로 바꾸고 나머지 칸은 문자열 불변이다.

제외(수량이 명사를 굴절시키지 않음): `{minutes} min`·`{n}m`·`{count}%`류 단위 약어, `Segment {n} of {count}`·`Leg {n} of {count}` 서수, `{label}: {count}`·`Crosswalks: {count}` 라벨-값. `ios.beacon.food.ramyeonMany`·`ios.beacon.healthSummary`는 "도달 불가"라는 이유로 뺐다가 설계 리뷰(#19·#20)로 **포함**했다 — 호출부 조건(`count > 1`)은 계약이 아니고 걸음 1은 값으로 가능하다. `healthSummary`의 걸음 수는 천 단위 구분자 문자열 인자를 유지한다(§5.2 문자열 폴백: `"1"` → one, `"1,234"` → other).

### 2.1 `messages/*.json` (웹·iOS 공용)

| 키 | en | es | fr | it | 비고 |
|---|---|---|---|---|---|
| `search.placeCount` / `webCount` / `addressCount` | ○ | ○ | ○ | ○ | 위원장 스크린샷 원발 지점 |
| `route.transit.legBoard` / `legTransfer` | ○ | ○ | ○ | ○ | `t.rich`·`t.markup` 태그 키 — plural 블록과 태그 공존 |
| `route.transit.summary` | ○ `transfer(s)` | ○ | ○ | ○ | 괄호 표기 제거 |
| `directions.candidateCount` | ○ | ○ | ○ | ○ | it은 과거분사 성수 일치(`Trovato 1 candidato`) — 블록이 동사까지 감싼다 |
| `directions.readySummary` | ○ modes | ○ | ○ | × modalità(불변) | |
| `guide.detailStart` / `carStart` / `rerouteDone` | ○ | ○ | ○ | ○ | |
| `guide.band.transitRiding` | ○ | ○ | ○ | ○ | |
| `walkInfra.audioSummary` / `audioSite` | ○ `device(s)` | ○ | ○ | ○ `dispositivo/i` | 괄호·슬래시 표기 제거 |
| `walkInfra.osmSummary` | ○ | ○ | ○ | ○ | |
| `whereAmI.overview.transitBus` | ○ `There is/are` | ○ | ○ | ○ `C'è/Ci sono` | Kit `LocationNarrative`도 소비 |
| `transitGuide.started` / `boardedCount` / `remainingCount` / `stationCountAbout` / `waitingCount` / `viaStopsTrain` / `viaStopsBus` | ○ | ○ | ○ | ○ | |
| `transitGuide.dataAge` | ○ seconds | ○ | ○ | ○ | |
| `bike.availability` | ○ racks | ○ racks·bikes | ○ racks·bikes | ○ racks·bikes | `{bikes}`는 en에서만 명사가 없다(es·fr·it은 형용사 `disponible(s)`가 수 일치) |
| `bus.arrival` | ○ `{prev} stops away` | ○ | ○ | ○ | plural 인자가 `prev`(count가 아님) |
| `surroundings.count` | ○ | ○ | ○ | ○ | |
| `chat.reviewPlacesHeading` | × | ○ | ○ | ○ | |
| `subway.count` · `whereAmI.overview.ok` · `okCapped` · `walkInfra.group*` · `guide.progressOrdinal` · `transitGuide.overviewOrdinal` | × | × | × | × | 명사 없음 |

### 2.2 `ios/i18n/ios-extra/*.json` (iOS 전용)

| 키 | en | es | fr | it |
|---|---|---|---|---|
| `ios.chat.placesHeading` / `addressesHeading` / `webResultsHeading` | ○ | ○ | ○ | ○ |
| `ios.search.announceCount` | ○ | ○ | ○ | ○ |
| `ios.route.transfers` / `stopCount` / `stationCount` | ○ | ○ | ○ | ○ |
| `ios.nearby.bikesAvailable` / `racksTotal` / `stopsBefore` | ○ | ○ | ○ | ○ |
| `guide.switchedToShortest` / `switchedToRecommended` / `proposalReady` | ○ | ○ | ○ | ○ |
| `ios.nearby.announceCount` + `unit*` 5종 | **구조 변경** — §5.4 | | | |
| `ios.beacon.healthSummary` | ○ steps | ○ | × pas(불변) | ○ |
| `ios.beacon.food.ramyeonMany` | ○ bowls | ○ | ○ | ○ |
| `ios.station.countSome` / `kindCount` · `ios.nearby.minutesAway` · `untilTime` | × | × | × | × |

## 3. 웹 계약 (next-intl 4 = ICU MessageFormat)

- 문법은 `{count, plural, one {# place} other {# places}}` 한 형태만 쓴다. `#`은 next-intl이 로케일 숫자 서식으로 찍는다(en "1,234"·fr "1 234"·es "1234" — CLDR `minimumGroupingDigits`, 실측 2026-08-31). 블록 밖 `{count}`와 블록 안 `#`을 섞지 않는다(한 문장에 수가 두 번 나올 이유가 없다).
- 카테고리는 next-intl(`intl-messageformat` → `Intl.PluralRules`)이 CLDR로 고른다: en·es·it은 1만 `one`, **fr은 0과 1이 `one`**("0 lieu"), ko·ja는 `other`뿐. 실측 `createTranslator` fr `[0,1,2] → "0 lieu | 1 lieu | 2 lieux"`. 문자열 `"1"`도 수로 강제돼 `one`이 되지만(실측) 호출부는 숫자를 넘긴다(§3.1).
- ko·ja 문장은 바이트 불변. es·fr·it은 `one` 분기를 새로 쓴다(§2 표의 ○ 칸). 괄호·슬래시 회피 표기(`(s)`·`/i`·`is/are`)는 전부 제거한다.
- `t.rich`/`t.markup` 키(`legBoard`·`legTransfer`)는 태그와 plural 블록이 한 문자열에 공존한다 — `t.markup("legBoard", { line, from, count: 1 })` → `"Board L at F, 1 stop"`(실측).

### 3.1 호출부(전수, count가 숫자인지 확인)

`src/lib/search-sections.ts`(`values: {count: place}` — `number`), `SurroundingsScene.tsx`(`group.items.length`), `place-lines/station-metro.ts`(`facilities.length`, 단 `subway.count`는 en 명사 없음), `TransitGuidePanel.tsx`(`viaStops.length`), `DirectionsView.tsx`(`settledCount`·`count`·`leg.stationCount ?? 0`), `TransitRouteBriefing.tsx`(`leg.stationCount`), `useTransitGuide.ts`(`s.remaining`·`leg.stationCount`·`event.remaining`·`candidates.length`·`route.legs.length`·`s.dataAgeSeconds`), `useRouteGuide.ts`(`route.steps.length`), `WalkInfraNearby.tsx`(`deviceCount`·`listedCount`), `overview-lines.ts`(`bus.count`), `BusArrivals.tsx`(`prev`), `BikeStations.tsx`(`racks`). 전부 `number` 타입이고 코드 변경 없음. 변경은 문자열 자원뿐이다.

### 3.2 게이트

- `i18n-messages.test.ts`의 `tokens()`는 `/\{(\w+)\}/`라 `{count, plural, …}`를 인자로 못 본다 → ko `{count}` ≠ en `[]`로 **기존 게이트가 실패한다**. 토큰 추출을 ICU 인자 파서로 바꾼다: `{` 뒤 식별자가 `,` 또는 `}`로 닫히면 인자 이름(블록 안 중첩 `{name}`도 재귀 수집, `#`은 인자가 아님). 이러면 ko `{count}`와 en `{count, plural…}`가 같은 인자 집합 `{count}`로 판정된다 — 인자 **집합** 동일성이 게이트의 뜻이고 plural 여부는 로케일 자유다.
- 신규 `src/lib/__tests__/i18n-plurals.test.ts`(messages/ + ios-extra 12소스): (a) plural 블록이 있는 모든 키를 실제 `t`/`t.markup`로 1·2에서 렌더(인자·태그는 파서가 채운다)해 컴파일·치환 잔재(`{}#`) 0 (b) one 분기가 other의 "2"→"1" 치환과 **다르다**(복사 분기 검출, 보조 게이트) (c) fr은 `count:0`이 `count:1`과 같은 분기 (d) 회피 표기 잔존 0: `\w\(s\)`·`\w/i\b`·`is/are` (e) **plural 피연산자 허용 목록**(`count`·`seconds`·`racks`·`bikes`·`prev`·`transfers`·`steps`·`n` — `{name, plural…}`처럼 엉뚱한 인자에 걸린 블록은 인자 집합 게이트를 통과하므로) (f) **en plural 키 전부의 count=1 골든 문장 표**(구조 차이 검사는 "1 places!"를 못 잡는다 — 정본은 승인 문장) (g) 공유 fixture `plural-category-cases.json`(§6)을 `Intl.PluralRules`로 재판정하되 **`one`이 아니면 전부 `other`로 투영**한다(fr·es·it은 백만 단위에 CLDR `many`가 있고 우리 문자열은 그 분기를 정의하지 않아 intl-messageformat이 other로 떨어진다 — 실측 `select(1000000) === "many"`).

## 4. iOS 변환 스크립트 `ios/scripts/messages-to-xcstrings.mjs`

### 4.1 네이티브 `variations.plural`을 쓰지 않는 이유(실험 2026-08-31)

`xcstringstool compile`로 확인: `variations.plural`은 `Localizable.stringsdict`(`NSStringLocalizedFormatKey: "%#@value@"`, `NSStringFormatValueTypeKey: lld`)로 컴파일되고 `.strings`에는 키가 남지 않는다. 앱 타깃의 `appLocalized`는 언어별 lproj를 **직접** 열어 `localizedString(forKey:)`로 읽는데(Bundle 언어 협상 1회 캐싱 우회 — 메모리 `gildongmu-ios-i18n-architecture` 함정 1), 그 경로가 stringsdict 키에서 돌려주는 것은 `%#@value@` 포맷 키뿐이라 one/other 값에 닿을 수 없다. Foundation의 `String.localizedStringWithFormat`에 맡기면 ①카테고리가 앱 선택 언어가 아니라 포맷 로케일을 따르고 ②Kit의 JSON 조회 경로(swift test)에는 그 기계가 없어 **해석기가 둘**이 된다 ③앱 타깃은 테스트 레인이 없어 그 경로를 검증할 수 없다. 반면 ICU 문자열은 `.strings`에 그대로 컴파일된다(실험 `"k.plain" => "%1$@ {1, plural, one {…} other {…}}"`). 그래서 **카탈로그는 ICU 블록을 문자열 그대로 싣고, Kit의 순수 함수 하나가 앱·Kit·테스트 세 경로에서 같은 방식으로 푼다.**

### 4.2 변환 규칙(결정론, byte-identical 유지)

- 토큰 문법: `{name}` 또는 `{name, plural, one {…} other {…}}`(공백은 자유, 출력은 이 한 형태로 정규화 — Swift 스캐너가 보는 계약). plural 블록의 분기는 `one`·`other` 둘 다 있어야 하고 순서 무관, 각 분기 본문에는 `#`·`{name}`·리터럴이 올 수 있다. 중첩 plural·`select`·`=0`류·`few/many`·**ICU 아포스트로피 인용**(`'{'`·`'#'`·`''` — 웹은 리터럴로 풀지만 이 변환기와 Swift 스캐너는 구조 문자로 세어 양쪽이 갈린다. 낱말 속 `C'è`는 리터럴)은 스킵하되, **스킵이 하나라도 있으면 생성이 exit 1로 실패한다**(설계 리뷰 #2 — 스킵된 키는 카탈로그에서 빠져 키 문자열이 낭독되고, 린터는 Swift가 참조하는 키만 잡는다).
- 인자 이름 집합은 종전 규칙 그대로 ko 등장 순서가 인덱스를 정한다. plural 인자 이름도 같은 집합에 든다(ko `{count}` ↔ en `{count, plural…}` → 같은 인덱스).
- 출력: `{name}` → `%N$@`(종전), plural 블록 → `{N, plural, one {…} other {…}}`(이름을 인덱스로), 블록 안 `#` → `%N$@`(그 인자의 인덱스), 블록 안 `{name}` → `%M$@`. 리터럴 `%` → `%%`는 종전대로 문자열 전체에 먼저 적용한다(분기 본문도 결국 `String(format:)`을 지난다).
- 앱 카탈로그·Kit 카탈로그 둘 다 같은 규칙(Kit `whereAmI` 네임스페이스에 `transitBus`가 있다).
- 스크립트는 함수를 `export`하고 CLI 실행은 `import.meta.url === process.argv[1]` 가드 뒤로 옮긴다 — `src/lib/__tests__/xcstrings-plural.test.ts`가 변환 함수를 직접 단위 테스트한다(vitest include는 `src/**`라 테스트는 `src/`에 둔다).

`check-xcstrings-keys.mjs`는 변경 없음(키는 여전히 리터럴, 하한 무영향).

## 5. Swift 해석기 — Kit `Localization.swift` 한 곳

### 5.1 카테고리 규칙 `pluralCategory(count: Int, lang: String) -> String`

CLDR 부분집합, 지원 6로케일만: `en`·`es`·`it` → `|n| == 1 ? "one" : "other"`, `fr` → `|n| == 0 || |n| == 1 ? "one" : "other"`, `ko`·`ja` → `"other"`, 미지 언어 → `"other"`. 언어 태그는 기본 언어로 정규화한다(`fr-FR`·`fr_CA`·`EN` → 공개 함수라 태그가 닿을 수 있다, 리뷰 #12). 음수는 CLDR처럼 절댓값(`Int.magnitude`, 리뷰 #10). 백만 단위 CLDR `many`(fr·es·it)는 §3.2 (g)와 같은 이유로 `other`다 — 이 함수가 맞추는 것은 원 카테고리가 아니라 **두 분기 메시지의 선택**이다.

### 5.2 블록 해석 `resolvePluralBlocks(_ format: String, lang: String, args: [CVarArg]) -> String`

- 스캐너(정규식 아님): `{` 뒤 `숫자, plural,`이면 블록 시작, 중괄호 깊이를 세어 블록 끝을 찾고 `one {…}`·`other {…}` 분기를 뽑는다. 다른 `{`(예: 본문 리터럴)는 그대로 둔다.
- 인자 값: `args[N-1]`이 정수형(`Int`·`Int8~64`·`UInt~64`)이면 그 값, `String`이면 `Int(s)`(천 단위 구분자·소수·전각은 nil → `other`), 그 외 → `other`. **범위 밖(인자 누락)은 DEBUG `assertionFailure`**(리뷰 #5 — 조용히 other로 가면 `%N$@`가 인자 없이 `String(format:)`에 닿는다), 릴리스는 `other`. `one`이 없으면 `other`, `other`가 없으면 그 블록은 리터럴(변환 스크립트가 만든 카탈로그에는 항상 둘 다 있다). 블록은 여러 개일 수 있고 왼쪽부터 순서대로 치환한다(`bike.availability` es/fr/it — 테스트 `twoBlocksInOneString`).
- 치환 뒤 남는 문자열은 종전 `String(format:)` 입력이다.

### 5.3 조회 함수 공통 경로

`appLocalized(key, args…)`·`appLocalized(key, arguments:)`·`kitLocalized(key, lang:, args…)`는 포맷 문자열을 얻은 뒤 **전부** `formatLocalized(format, lang:, args:)`(Kit public)를 지난다: ①`resolvePluralBlocks` ②정수형 인자는 `String(n)`으로(`%@`에 정수를 넘기면 포인터로 읽어 크래시 — 기존 `String(count)` 호출부와 표시가 같다) ③`String(format:arguments:)`. `args`가 비면 종전대로 포맷을 그대로 돌려주되 plural 블록이 있으면 DEBUG `assert`(리뷰 #5·#9). **정적 가드**(`xcstrings-plural.test.ts`): 카탈로그의 plural 키를 인자 없이 조회하는 `appLocalized("k")`/`kitLocalized("k", lang:)`와 `String(format:` 줄에 `appLocalized(`/`kitLocalized(`가 함께 있는 2단계 포맷을 Swift 소스 전수에서 금지한다.

### 5.4 호출부

- `String(n)`·`"\(n)"`으로 넘기던 수량 인자를 **`Int` 그대로** 넘긴다(§2.2·§2.1의 Swift 소비 지점 전수: `SearchModel`·`RouteBriefing`·`GildongmuApp`·`GuideText` 5함수·`TransitGuideModel` 7곳·`ChatConversationView` 4곳·`TransitTrackingSheet`·`DirectionsTabView` 2곳·`GuideOverviewSheet`·`DirectionsEndpointSearchView`·`SurroundingsSceneSection`·`BikeNearbyView`·`BusNearbyView`·`WalkInfraNearbyView` 4곳·Kit `LocationNarrative`). 표시 결과는 `String(n)`과 동일하므로 ko 낭독 불변.
- `RouteBriefing.transitLegLine`의 `String(format: countKey, String($0))`(포맷을 먼저 꺼내고 나중에 채우는 2단계)는 해석기를 우회하므로 `appLocalized("ios.route.stopCount", n)` / `("ios.route.stationCount", n)` 직접 호출로 바꾼다(키는 리터럴 유지 — 린터 계약).
- **`ios.nearby.announceCount` "{count} {unit} nearby" + `unitPlace/Bike/Stop/Station/Event`는 폐기**하고 종류별 완성 문장 5키로 바꾼다: `ios.nearby.announcePlaces`·`announceBikes`·`announceStops`·`announceStations`·`announceEvents`. 단어 조각 합성은 en "1 place nearby"를 만들 수 없고(단위 키에 count가 없다), fr은 어순까지 다르다. ko는 종전 "주변 곳 3개"(단위가 "곳"이라 어색했다)가 "주변 장소 3곳"·"주변 대여소 3곳"·"주변 정류소 3곳"·"주변 역 3곳"·"주변 문화행사 3건"이 된다 — 의미 불변, 어법만 바로잡힘. `nearbyLoadedMessage(count:unit:)` → `nearbyLoadedMessage(count:kind:)`(`enum NearbyCountKind`), 키는 함수 안 리터럴 `switch`(린터 함정 7). 호출부 8곳(`ClinicNearby`·`Kids`·`BarrierFree`·`Bike`·`Bus`·`BusRouteStops`·`Subway`·`Events`).
- `SearchView.swift`: 결과 수는 필터 칩 `(N)`과 `SearchModel`의 `ios.search.announceCount`뿐이다. 칩은 명사가 없어 대상이 아니고 통지는 `SearchModel.swift`에서 고친다 — `SearchView.swift` 변경 0(소유권 겹침 회피).

## 6. 공유 fixture `src/lib/__tests__/fixtures/plural-category-cases.json`

`[{lang, n, category}]` — `category`는 CLDR 원 카테고리가 아니라 **one/other 두 분기 메시지에서 고르는 분기**다. en/es/it: 0 other·1 one·-1 one·2 other·21 other·100 other / fr: 0 one·1 one·2 other·1000000 other(CLDR `many` → other 투영) / ko·ja: 1 other. 웹 테스트는 `Intl.PluralRules(lang).select(n) === "one" ? "one" : "other"`로, Kit `LocalizationTests`는 `pluralCategory`로 재판정한다 — 두 해석기가 한 표를 본다(E28 `bilingual-name-cases.json` 동형).

Kit 테스트(`LocalizationTests.swift`): fixture 전수 + `resolvePluralBlocks` 단위(en 1/2, fr 0, 문자열 인자 `"1"`·`"1,234"`, 블록 밖 `{`, `one` 부재) + 실카탈로그 `kitLocalized("whereAmI.overview.transitBus", lang: "en", 1, "…")` → "There is 1 bus stop. …", `lang: "fr", 0` → "Il y a 0 arrêt de bus. …", `lang: "ko", 1` → "버스 정류소가 1곳 있습니다. …"(ko 불변).

변환 스크립트 테스트(`xcstrings-plural.test.ts`): ko `"장소 {count}건"` + en `"{count, plural, one {# place} other {# places}}"` → en `"{1, plural, one {%1$@ place} other {%1$@ places}}"`; 태그 키(`legBoard`)에서 `<line></line>`은 종전대로 통과; 블록 안 `{name}` 인덱스; 공백 변형 정규화; 인용 거부; `select`·`few`·분기 중복·`other` 부재 스킵; 생성 카탈로그가 결정론이고 **저장된 両 카탈로그와 같다**(재생성 누락); **`xcrun xcstringstool compile` 산출물**에서 en `.strings`에 블록이 문자열 그대로 있고 `.stringsdict`가 없다(앱 lproj 경로 증명, 리뷰 #18); Swift 소스 정적 가드(§5.3).

## 7. 낭독 확인

- 웹: §3.2 테스트(jsdom 불필요 — 문자열 계층이라 node로 충분) + `PlaceSearch` 결과 헤딩은 `combinedLiveMessage` parts를 그대로 `t`에 태우므로 별도 컴포넌트 테스트 없이 "1 place" 단언으로 덮인다.
- iOS: 시뮬레이터 빌드·실행 + AX 스냅샷 1회(회귀 확인만, 실기기 불필요 — 코디네이터 잠금). 실기기 VoiceOver가 "1 place"를 어떻게 읽는지는 위원장 실사용에 맡기며 별도 판정 항목으로 두지 않는다(수량 단수형은 SR 낭독 계약이 아니라 문법이다).

## 8. 범위 밖

CLI/MCP 포매터(ko 고정), 채팅 산문(LLM), `ios.beacon.healthSummary`·`ramyeonMany`(§2), `bus.arrival`의 `{min} min`, 웹 `{count}`의 숫자 서식과 iOS `String(n)`의 천 단위 차이(기존 비대칭, 이 작업이 만들지 않았다).

## 9. 실패 모드와 방어

| 실패 | 방어 |
|---|---|
| 번역자가 `one`을 `other` 복사로 채움("1 places" 재발) | §3.2 (b) 치환 비교 |
| fr `0`이 `other`로 감("0 lieux") | §6 fixture + Kit 규칙 테스트 |
| Swift 호출부가 `String(n)`을 남겨 두면 | §5.2 문자열 폴백이 `String(Int)` 정규형(`"1"`)에서 카테고리를 맞춘다 — `"1.0"`·전각·공백 포함은 other(웹과 다르나 그런 호출부는 없고 새로 만들지 않는다). Int 통일은 타입 명확화 |
| plural 키를 인자 없이 조회·2단계 `String(format:)` | §5.3 정적 가드 + DEBUG assert |
| `{name, plural…}` 엉뚱한 피연산자 | §3.2 (e) 허용 목록 |
| one 분기가 "1 places!"처럼 여전히 틀림 | §3.2 (f) en 골든 표(es·fr·it은 구조 검사 + 이 문서 번역 승인) |
| 변환 스크립트가 plural 키를 스킵해 카탈로그에서 빠짐 | `check-xcstrings-keys.mjs`가 참조 키 누락으로 실패 |
| `%@`에 `Int` 인자 | §5.3 ② 변환 |
| 카탈로그 수기 편집 | 없음 — 정본은 JSON, 재생성만(메모리 함정 5) |

## 10. 설계 리뷰 기록

codex `gpt-5.6-sol` adversarial-review(raw `codex exec`, spec 주입, 2026-08-31): **"수정 후 승인"**, 지적 23건. 처리:

- **반영(설계 변경)**: #2 스킵 하드 실패(§4.2) · #4 ICU 인용 거부(§4.2) · #3 공백 정규화 계약 + fixture(§4.2) · #5 인자 누락 DEBUG assert(§5.2·§5.3) · #6 정수형 정규화(§5.2) · #7 피연산자 허용 목록(§3.2 e) · #9 2단계 포맷·무인자 조회 정적 가드(§5.3) · #10 음수 절댓값(§5.1) · #11 `many` → other 투영(§3.2 g·§6, 구현 중 실측으로 먼저 발견 — `Intl.PluralRules("fr").select(1000000) === "many"`) · #12 언어 태그 정규화(§5.1) · #15 en 골든 표(§3.2 f) · #18 lproj 컴파일 산출물 검증(§6) · #19·#20 `healthSummary`·`ramyeonMany` 포함(§2) · #23 다중 블록 계약 테스트(§5.2).
- **이미 충족(기록만)**: #1 CLI 가드는 `path.resolve(argv[1]) === fileURLToPath(import.meta.url)`이고 저장 카탈로그 동일성 테스트가 미재생성을 잡는다 · #13·#14 plural 키는 인자·태그를 파서가 채워 실제 `t`/`t.markup`로 렌더한다 · #16 fr 0/1 비교는 `#` 자리 치환으로 이미 성립 · #17 ios-extra는 같은 스크립트 규칙(인자 이름 불일치 → 스킵 → 하드 실패) + 웹 게이트 12소스 포함 · #22 8곳 매핑은 종전 단위 낱말과 1:1(places 3·bikeStations·busStops 2·stations·events), 동적 키 참조 0(grep).
- **기각**: #8 ko 등장 순서가 위치 인자 ABI인 것은 이 파이프라인 전체의 기존 계약(메모리 `gildongmu-ios-i18n-architecture` 함정 6)이라 A29 범위 밖 — 키별 인자 순서 manifest는 별도 판정(BACKLOG 등록) · #21 레거시 문자열 허용 범위는 `String(Int)` 정규형으로 명시(§9)하고 CI 스캔은 두지 않는다(호출부를 전부 Int로 바꿨고 문자열 잔존은 낭독이 아니라 타입 문제).

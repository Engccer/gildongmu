# 길동무 안드로이드

iOS 앱과 기능 등가인 안드로이드 네이티브 앱(판정 문서 `docs/superpowers/specs/2026-09-15-android-app-decisions.md`, 병렬 계획 `docs/superpowers/plans/2026-09-16-android-app-parallel-plan.md`). 이 문서는 **로직 세션이 이것만 읽고 같은 방식으로 이식하게** 쓴 작업 계약이다. 설계 근거는 위 두 문서에 있고 여기엔 절차와 관용구만 둔다.

## 배포 전 개발·검증 기준

- 실기기 테스트는 **한소네 7**로 진행한다.
- 배포 전까지 **정식판을 중점적으로 개발**하고, iOS 앱과의 기능 등가성 유지·동기화도 **iOS 정식판을 기준**으로 한다.
- 정식 기능 구성의 실기기 개발·검증에는 `debug`, 정식 배포에는 `release`를 쓴다. `experimental`은 별도 실험판이며 기본 개발·동기화 기준이 아니다. 기존 실험 기능의 정식판 승격에는 해당 기능의 검증이 필요하다.
- **도보 실시간 안내는 iOS 등가성 원칙에 따라 정식판으로 이동한다(결정 확정, 구현 대기).** 이동 작업에 매니페스트·게이트·테스트 변경과 한소네 7 정식 기능 구성 검증을 포함한다. 상세 작업은 `docs/BACKLOG.md` E43의 구현 우선순위를 따른다.

## 1. 모듈

```
android/
  app/   Jetpack Compose 화면 + 플랫폼 서비스([3]·[4]). 패키지 space.dodoplanet.gildongmu
         location/  현재 위치 공유 스토어(LocationStore: 캐시·권한·정밀도·게이트 취득, GMS 무의존 — GPS 층) · 앱 층 좌표 진입점 EffectiveLocation(수동 > GPS, 판정 38 소스 가드) · 수동 위치(ManualLocationStore·ManualLocationJudge·ManualLocationRoute·ManualLocationPicker{ViewModel,Screen}) · 표시줄(CurrentAddressStore·LocationBar = 버튼) (M2 spec §4·§12-4·§13)
         directions/ 길찾기(M3) · 끝점 검색 모델 EndpointPicker(길찾기 폼과 수동 지정 화면이 공유, spec §13-3)
         a11y/      접근성 기본형(mergedRow·landingTarget·AppScreenScaffold·StatusLine) · 앱 통지 큐 AppNotices(화면 StatusLine이 한 문장으로 병합·RESUMED 소유자 claim, spec §13-5) · 결과 진동 Notice.haptic/LocalResultHaptics(§14-3)
         settings/  설정(SettingsStore 단일 소유자·순수 localeOverride/settingsRows·선택 다이얼로그·정보 출처·SettingsAction) — 언어는 AppConfig.localized/localizedApp 한 경로(spec §14)
         nearby/    내 주변 허브·공통 껍데기(NearbyScreenViewModel = :kit NearbyLoadCore 소비)·kind 조립기 10종(NearbyKinds)·payload(NearbyPayloads·AroundPayload)·문장 조립(NearbyLines·DomainLines·WalkInfraLines·ConditionsLines·SceneLines)·본문(NearbyKindScreen·PlaceListBodies·WalkInfraBody·ConditionsBody·SceneSection) (M2 spec §3-4~3-9·§5·§12-1·§12-2)
         guide/·audio/ 도보 실시간 안내·톤(M4) · chat/ 채팅(M6) · search/ 검색 · speech/ 받아쓰기 · nav/ 탭·스택 골격 · i18n/·net/·storage/ 앱 층 공통
         place/     장소 상세(Place JSON 라우트 + PlaceDomain·영업시간·외부 지도 열기 판정·도메인 섹션·역 자동 섹션 5종(StationLines·StationSectionsView)·무장애 섹션) (M2 spec §3-2·§12-3)
  kit/   순수 Kotlin/JVM, iOS GildongmuKit의 미러([2] 판정 계층). 패키지 space.dodoplanet.gildongmu.kit
         Models/*.swift → kit/.../kit/models/*.kt (하위 패키지 space.dodoplanet.gildongmu.kit.models)
  kit/mirrors/{foundation,core,guide}.json   미러 등록부(§5)
  scripts/messages-to-kit-strings.mjs         :kit 문자열 카탈로그 생성(§6)
  scripts/messages-to-android-strings.mjs     :app res/values(-lang)/strings.xml 생성(§6 앱 문자열)
  scripts/check-release-manifest.mjs          정식 APK 봉인 검사(§7)
  scripts/play-upload.mjs                     Play 내부 테스트 트랙 업로드(골격, 기본 드라이런)
  i18n/{arg-order.json,android-extra/}         ko 위치 인자 잠금 · 안드로이드 전용 키
```

**화면 패키지 규약**(병렬 세션 소유권): 화면은 하위 패키지 하나씩 — `search/`·`place/`·`nearby/`·`directions/`·`chat/`. 탭·스택 골격은 `nav/`(`AppRoot`가 하단 탭 4개 + 단일 `NavHost`; iOS `AppTab.order` 미러, 실험판 순서 게이트 `AppConfig.experimentalTabOrderEnabled`). 새 화면은 자기 패키지에 `@Serializable` 라우트를 두고 `AppRoot`의 `NavHost`에 **등록 한 줄**만 더한다. 병렬 세션을 다시 열 때 파일 소유권은 병렬 계획 §2 표를 따른다(웨이브 0~3 세션은 2026-09-17 전부 종료). 내비게이션은 `navigation-compose` 2.x(탭별 백스택 `saveState/restoreState`) — Navigation 3는 탭별 백스택을 위해 상태·내비게이터·데코레이터를 앱이 소유해야 해서 택하지 않았다(M2 spec §10).

- `:kit`은 **안드로이드 의존이 0**이다. `import android.`·`import androidx.`가 한 줄이라도 들어오면 `KitPurityTest`가 빨개지고, `kit/build.gradle.kts`에 안드로이드 플러그인·의존성을 더해도 같은 테스트가 잡는다. 저장·네트워크·시계처럼 플랫폼이 필요한 것은 인터페이스(`HttpTransport`·`KeyValueStore`)로 두고 `:app`이 구현한다(D5 경계).
- 길찾기 주소 요청은 `DirectionsAddressState`가 측위 전부터 소유한다. 초기 진입·재선택·경로 조회 모두 같은 요청을 주소 커밋까지 전달하고, 필드 변경은 작업과 요청을 함께 취소한다. 언어 변경은 주소 상태를 초기화하며 이전 요청의 종료는 최신 로딩을 건드리지 않는다. 회귀 검증은 Kit `DirectionsAddressStateTest`와 앱 `DirectionsAddressTest`다.
- 빌드 구성은 셋(iOS Debug/Release/Experimental 미러): `debug` · `release` · `experimental`. 실험판은 applicationId `space.dodoplanet.gildongmu.dev`, 표시 이름 "길동무 실험"(`app/src/experimental/res/values/strings.xml` — 스크린 리더 사용자의 유일한 구분 수단이라 반드시 유지), 아이콘 배경색 구분. 코드 게이트는 `AppConfig.experimentalGuidanceEnabled`(= `BuildConfig.EXPERIMENTAL`).

## 2. 환경

| 항목 | 값 |
|---|---|
| JDK | 21 (`gradle/gradle-daemon-jvm.properties`가 데몬을 21로 고정하고 없으면 foojay가 `~/.gradle/jdks`에 내려받는다. 기계 경로는 어디에도 없다) |
| Android SDK | `~/Library/Android/sdk` (platform-tools 37 · platforms;android-37.2(compileSdk) · platforms;android-36 · build-tools;36.0.0). 위치는 `ANDROID_HOME`으로 알린다 |
| Gradle | 9.7.1 (wrapper) · AGP 9.4.0(built-in Kotlin — 내장 KGP 2.2.10이 같은 클래스패스에서 2.4.20으로 올라가 :kit·:app이 한 컴파일러를 쓴다, `./gradlew buildEnvironment`로 확인) · Kotlin 2.4.20 · Compose BOM 2026.09.00 · kotlinx.serialization 1.11.0 · coroutines 1.11.0 (`gradle/libs.versions.toml`) |
| minSdk / targetSdk / compileSdk | 31 / 36 / 37.2 (Compose 1.12가 37 이상을 요구. D8의 min·target은 그대로) |

```bash
export ANDROID_HOME=~/Library/Android/sdk
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"   # adb · android(공식 CLI 1.0)
cd android
./gradlew :kit:test                         # 판정 계층 테스트(fixture 포함)
./gradlew :app:testDebugUnitTest            # 화면 상태 머신·언어·소스 가드(JVM)
./gradlew :app:connectedDebugAndroidTest    # 실기기 접근성 검사 레인(ATF) — adb 연결 시에만
./gradlew :app:assembleDebug                # 정식 번들 디버그 APK
./gradlew :app:assembleExperimental         # 실험판 APK (…gildongmu.dev, "길동무 실험")
./gradlew :app:assembleRelease              # 미서명 릴리스(스토어 업로드는 Play App Signing, 계정 개설 뒤)
adb install -r app/build/outputs/apk/experimental/app-experimental.apk
adb exec-out timeout 10 uiautomator dump /dev/tty   # 접근성 트리(스크린 리더가 읽는 구조)
./gradlew --stop                            # 끝나면 데몬을 내린다(16GB 머신)
```

**무거운 게이트는 머신 전역 락 안에서 돈다** — 절차는 §7. Gradle 워커는 `gradle.properties`가 2로 묶어 두었다.

### 실기기 도구 — 구글 공식 `android` CLI(우선) · `adb`(폴백)

`android` CLI는 `cmdline-tools/latest/bin`에 있다(위 PATH). 실기기 작업은 `adb exec-out uiautomator dump`보다 이것을 먼저 쓴다 — 접근성 트리를 JSON으로 주고(`contentDesc`·`interactions`·`state`·`off-screen`), 공식 문서 검색이 붙어 있다. 사용 전 `.claude/skills/android-cli/references/interact.md`를 읽는다.

| 명령 | 용도 |
|---|---|
| `android install --apks=<apk>` | APK 설치(증분 배포, adb보다 빠름). `adb install -r`는 폴백 |
| `android run --apks=<apk> [--activity=…]` | 빌드·배포·실행 |
| `android layout [--pretty] [--full] [--flat] [-o file]` | 화면의 접근성 트리 JSON. `--full`은 비상호작용·숨김 요소까지. `uiautomator dump`는 폴백 |
| `android screen capture [--annotate] -o <png>` | 스크린샷(`--annotate`는 요소 번호·경계 상자). WebView·애니메이션으로 `layout`이 실패할 때 |
| `android docs <키워드>` | 공식 Android 문서 검색(API·마이그레이션·모범 사례) |
| `android skills add <id> --agent=claude-code,codex --project=.` | 공식 Android 스킬 설치. **worktree마다** `android skills add android-cli navigation-3 testing-setup adaptive styles edge-to-edge play-policy-insights --agent=claude-code,codex --project=.`로 두 에이전트를 명시한다. 생성물 `.claude/skills/`·`.agents/skills/`는 `.gitignore`에 있어 커밋되지 않는다 |

## 3. 이식 관용구 (Swift → Kotlin)

정본은 **Swift**다. 웹 TS 판과 공유 fixture로 교차 검증하고, Kit 테스트(`ios/GildongmuKit/Tests/GildongmuKitTests/<이름>Tests.swift`)를 `kit/src/test/.../<이름>Test.kt`로 함께 옮긴다(fixture 없는 것도 테스트는 있다). 파일 이름은 Swift를 따른다(`Coverage.swift` → `Coverage.kt`).

| Swift | Kotlin | 비고 |
|---|---|---|
| `public struct X: Codable, Sendable, Hashable` | `@Serializable data class X(...)` | 직렬화는 `KitJson`(`ignoreUnknownKeys`, `explicitNulls = false`) 하나로 통일 |
| `let name: String?` (옵셔널 필드) | `val name: String? = null` | 없는 키 = null. 기본값을 두어 생성도 편하게 |
| `public enum E: String { case a, keepLeft }` | `enum class E { a, keepLeft }` + `val rawValue get() = name` + `companion fun fromRawValue(raw): E?` | **엔트리 이름을 Swift raw 값 그대로** 둔다(직렬화 문자열이자 fixture 표기, 대문자 변환 금지). raw가 이름과 다르면(`no_stepfree_route`) 생성자 인자 `rawValue` |
| `enum E { case ok(T), failed }` (연관값) | `sealed class E { data class Ok(...) : E(); data object Failed : E() }` | 케이스는 타입이라 PascalCase. Swift `.empty`(nil 충돌 회피 이름)도 `Empty` |
| `init(from decoder:)` 커스텀 | `@Serializable(with = XSerializer::class)` + `KSerializer<X>`가 `JsonDecoder.decodeJsonElement()`로 읽기 | 예: `ChatModels.kt`·`NearbyModels.kt`·`WalkInfraModels.kt`(제네릭) |
| `flatMap(E.init(rawValue:))` 전방 호환 디코딩 | `@Serializable(with = LenientXSerializer::class) val action: E? = null` | 모르는 문자열은 실패가 아니라 null(`models/LenientEnums.kt`) |
| `public let fooBar = 40.0` | `const val fooBar = 40.0` | **식별자는 camelCase 그대로**(세 플랫폼 grep이 통하게). Kotlin 예약어(`object`)만 개명하고 등록부 `note`에 적는다 |
| `func f(_ x: [A], bucket: String?)` / `func f(_ x: [A], region: String?)` (라벨 오버로드) | `filterPlacesByBucket` / `filterPlacesByRegion` | Kotlin은 인자 이름으로 오버로드 못 한다 — 웹 이름을 따른다 |
| `Double.truncatingRemainder(dividingBy:)` | `%` | 부호 규약 같다 |
| `x.isFinite`, `accuracy > 0` 가드 | `x.isFinite()`, `!(accuracy > 0)` | NaN 비교는 false라 Swift와 같은 식으로 쓰면 결과도 같다 |
| `String(format: "%.4f", v)` | `String.format(Locale.ROOT, "%.4f", v)` | 로케일을 반드시 ROOT로(소수점 `,` 지역) |
| `String(Double)` | `Double.toString()` | 정수는 "1.0"이 남는다(Swift와 같은 함정) — `formatDistance`가 정수 분기를 따로 둔다 |
| `unicodeScalars.last` | `codePointBefore(length)` / `codePoints()` | UTF-16 단위 `last()` 금지 |
| `Character.isLetter \|\| isNumber` | `Character.isLetterOrDigit(codePoint)` | |
| `async let a = …; await a` | `coroutineScope { val a = async { optional { … } }; a.await() }` | `try?`는 `APIError`만 잡는 공용 `optional { }`(`APIClient.kt`, internal). `runCatching`은 suspend 블록·`async` 안에서 금지(취소를 삼킨다) — 동기 파싱(`Coverage`·`Localization`의 리소스 로드)은 무방 |
| `init(from:)`의 `container.decode(_:forKey:)` | `obj.required("k")`·`requiredString`·`requiredInt`·`requiredArray`·`asObjectOrThrow` (`models/JsonSupport.kt`) | **커스텀 serializer가 던지는 것은 `SerializationException`뿐**이다 — `Map.getValue`(NoSuchElementException)는 `APIError` 분류를 뚫어 "조회 실패"가 크래시가 된다. 판별자(`type`·`status`) 부재는 throw, 미지 값은 전방 호환 갈래 |
| `timeout: TimeInterval?`(초) | `timeoutMs: Long?`(밀리초) | `HttpTransport`·`APIClient.get`의 단위. 구현이 무엇을 던지든(`IOException`·`withTimeout`·런타임 예외) `APIClient`가 `APIError.Network`로 접고 바깥 취소만 통과시킨다 |
| `Date`·`TimeInterval` | `Double` 초(Swift와 같은 단위) | 판정 함수는 시각을 인자로 받는다. `System.currentTimeMillis()`를 :kit 안에서 부르지 않는다 |
| 거리 | 미터 `Double`/`Int`(Swift와 같은 필드 타입 그대로) | `formatDistance`만 지난다(소수 km 직접 조립 금지) |
| `Bundle.module.url(forResource:)` | `X::class.java.getResourceAsStream("/name")` | 리소스는 `kit/src/main/resources/` |
| `#filePath` 5단계 상위 fixture 로딩 | `Fixtures.shared("x.json")` / `Fixtures.kit("x.json")` (§4) | |
| `func f() -> (a: A, b: B)` (튜플 반환) | `data class <함수명 PascalCase>Result(val a: A, val b: B)` | 예: `advanceProgressAnchor` → `AdvanceProgressAnchorResult`. 필드 이름은 튜플 라벨 그대로 |
| `CLLocation`의 `-1` = 무효(`horizontalAccuracy`·`speed`·`course`) | `Location.hasX()`가 false면 **`-1.0`을 넘긴다** | 판정 함수의 `> 0`·`isFinite` 가드가 Swift와 같이 무효로 거른다. null 인자를 새로 만들지 않는다(시그니처가 Swift와 갈린다) |

### JDK API 표면은 Android 12(API 31)까지

`:kit`은 JVM 21에서 테스트되지만 실행은 minSdk 31 기기다. 안드로이드 lint `NewApi`는 JVM 모듈을 보지 않으므로 어느 게이트도 못 잡는다 — **API 33에서 추가된 JDK 오버로드를 부르지 않는다**: `URLEncoder.encode(String, Charset)`(→ `encode(s, "UTF-8")`), `InputStream.readAllBytes()`(→ Kotlin `readBytes()`), `String.repeat`류 Java 11+ 문자열 API(→ Kotlin stdlib). 의심되면 Android SDK 문서의 "Added in API level"을 본다(실사고: `URLEncoder.encode(value, Charsets.UTF_8)`가 리뷰에서 잡혔다).

### 정규식 함정

- **문자 클래스 안 `[`는 반드시 `\[`로 이스케이프한다**(`[(\[]`). Java도 Swift(ICU)처럼 `[[]`를 중첩 집합으로 읽어 웹(JS)만 초록이고 Kotlin·iOS만 전량을 놓친다(CLAUDE.md 함정). 공유 fixture를 Kotlin에서도 돌리는 것이 유일한 검출 수단이다.
- `\b`는 한글·한자를 word character로 본다(웹·Swift와 같다). CJK 직결 꼴에는 부정 전방탐색을 쓴다(`Format.kt`).
- 전방·후방탐색(`(?<!키즈)카페`)은 Java에서 그대로 통한다.
- **단축 클래스 `\d`·`\s`·`\w`·`\h`(대문자 포함)는 쓰지 않는다** — JVM은 ASCII, 기기(ICU)는 유니코드로 읽어 전각 숫자·전각 공백에서 결과가 갈리는데 JVM 테스트는 초록이다. 명시 클래스(`[0-9]`·`[$REGEX_SPACE_MEMBERS]`(Swift 공백 뜻, `SwiftSemantics.kt`)·`[A-Za-z0-9_]`)만 쓴다. `RegexPortabilityTest`가 :kit 소스를 스캔한다.
- **유니코드 프로퍼티 클래스 `\p{…}`는 두 엔진 동치를 전수 실측한 일반 카테고리(`Z`·`N`·`Nd`·`L`·`Nl`·`M`·`Pc`)만 쓴다** — POSIX 계열(`\p{Alpha}`·`\p{Punct}`·`\p{Digit}` 등)은 JVM이 ASCII, ICU가 유니코드로 읽어 약칭 클래스와 같은 함정이다. POSIX 괄호식 `[[:alpha:]]`(JVM은 문자 집합 `{:,a,h,l,p}`로 읽는다)와 중괄호 없는 `\pL`(Apple ICU는 컴파일 오류)도 쓰지 않는다. 새 카테고리는 실측한 뒤 `RegexPortabilityTest` 허용 목록에 더한다.
- 정규식은 raw string `"""…"""`에 쓴다(일반 문자열이면 `\\[`처럼 이중 이스케이프가 필요해 읽기 어렵다).
- KDoc·주석 안에 `/*`를 쓰지 않는다 — Kotlin은 **중첩 블록 주석**이라 `/api/*` 같은 경로 하나가 주석을 열어 파일 전체를 삼킨다(실사고: `APIClient.kt` "Unclosed comment").

### 컴파일 규율

`:kit`은 `allWarningsAsErrors`다. 경고 하나가 곧 빌드 실패이므로 미사용 변수·불필요한 캐스트를 남기지 않는다. `ExperimentalSerializationApi`(`descriptor.nullable` 등)는 `@OptIn`으로 명시한다.

## 4. fixture 로더 (`kit/src/testFixtures/.../Fixtures.kt`)

```kotlin
val cases = Fixtures.sharedJson("korea-boundary-cases.json", BoundaryCaseFile.serializer()).cases  // src/lib/__tests__/fixtures/
val places = Fixtures.kitJson("places.json", PlaceSearchResult.serializer())                     // ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures/
val lines = Fixtures.kit("chat-stream.ndjson").lines()                                            // 원문
```

- 저장소 루트는 `:kit build.gradle.kts`가 넘기는 `gildongmu.kitDir`에서 위로 올라가 `package.json` + `ios/GildongmuKit/Package.swift`가 있는 곳. 못 찾거나 파일이 없거나 비면 **실패한다**(조용히 통과하지 않는다).
- fixture 모양은 테스트 파일 안의 `@Serializable private data class`로 그때그때 선언한다(Swift 테스트의 `private struct … Decodable`과 같은 자리).
- 두 fixture 디렉터리는 **읽기만** 한다. 틀렸다고 판단되면 고치지 말고 코디네이터에 보고한다(웹·iOS 테스트도 같이 바뀌어야 한다).
- 네트워크 계층 테스트는 `stubbedClient { url -> HttpResponse(status, body) }` / `StubTransport`(경로 판정은 `pathOf(url)`·`queryOf(url)`), 저장소는 `InMemoryKeyValueStore` — 로더와 함께 `kit/src/testFixtures`에 있어 `:app` 테스트(`testFixtures(project(":kit"))`)도 같은 것을 쓴다(`Fixtures.repoRoot`로 소스 가드의 스캔 루트를 잡는다).

## 5. 미러 등록부 갱신법 (`kit/mirrors/<그룹>.json`)

자기 그룹 파일만 고친다. 형식:

```json
{ "swift": "TransitGuide.swift", "status": "ported",
  "kotlin": "android/kit/src/main/kotlin/space/dodoplanet/gildongmu/kit/TransitGuide.kt",
  "test":   "android/kit/src/test/kotlin/space/dodoplanet/gildongmu/kit/TransitGuideTest.kt",
  "note":   "이름 변경·미이식 함수·경계 판정 같은, 다음 사람이 모르면 틀리는 것" }
```

- 상태는 `pending`(아직) → `ported`(kotlin 경로 실재, test 있으면 그것도) 셋 중 하나이고 `excluded`는 3건뿐이다(AudioSignalProtocol·Localizable.xcstrings·GuideAudioSession — `mirror-registry.test.ts`가 기대 목록을 잠근다).
- 경로는 **저장소 루트 상대**. 검사는 웹 vitest `src/lib/__tests__/mirror-registry.test.ts`가 매 커밋 돈다(`npm run test:run`): Kit 원본 전수가 정확히 한 등록부에, ported의 경로 실재, iOS에 새 Kit 파일이 생기면 빨강.
- `foundation.json`의 `deferredTests`는 FOUNDATION 테스트 중 CORE/GUIDE 심볼에 걸려 못 옮긴 케이스 목록이다(`blockedBy` = 막는 Swift 파일). 해당 그룹이 그 파일을 이식할 때 함께 옮기고 항목을 지운다 — `blockedBy` 전부가 `ported`인데 항목이 남아 있으면 검사가 빨개진다.
- 부분 이식(한 함수만 다른 그룹 의존)은 `ported`로 두고 `note`에 무엇을 뺐는지 적는다(예: `WalkAction.swift`의 `imminentTone` → GUIDE `RouteGuide.kt`).

## 6. 문자열 카탈로그 (`:kit` i18n)

`kitLocalized("category.food", lang)`는 `kit/src/main/resources/gildongmu-kit-strings.json`을 읽는다. 이 파일은 **생성물**이다:

```bash
node android/scripts/messages-to-kit-strings.mjs          # messages/*.json + ios/i18n/kit-extra → 카탈로그
node android/scripts/messages-to-kit-strings.mjs --check  # 최신 여부
```

iOS Kit 카탈로그와 같은 빌더(`ios/scripts/messages-to-xcstrings.mjs`의 `buildCatalog`)를 import해 만들므로 네임스페이스(`category`·`region`·`route`·`whereAmI`)·ko 위치 인자 순서(`ios/i18n/arg-order.json`)가 iOS와 같고, 지정자만 `%N$@` → `%N$s`다. 복수형은 ICU 블록 `{N, plural, one {…} other {…}}` 문자열 그대로 실려 `formatLocalized`가 푼다(A29). 드리프트 가드 `src/lib/__tests__/android-kit-drift.test.ts`가 (1) 생성물 최신 (2) xcstrings와 값 대응 (3) 국경 링 바이트 동일 (4) 거리 표기 표를 매 커밋 본다. `messages/*.json`을 고쳤으면 iOS 스크립트와 이 스크립트를 둘 다 돌린다.

### 앱 문자열 (`:app`)

`res/values(-lang)/strings.xml`도 **생성물**이다 — 손으로 고치지 않는다. 정본은 `messages/*.json` + `ios/i18n/ios-extra/*.json`의 `ios.` 접두 키(→ `android.*`로 개명해 일괄 도입, 읽기만) + `android/i18n/android-extra/*.json`(안드로이드 전용 키·플랫폼 문안 오버라이드 — 같은 이름이면 android-extra가 이긴다). ios-extra의 비접두 키(웹 키를 덮는 iOS 오버라이드, "iPhone 만보계" 등)는 들이지 않는다.

```bash
node android/scripts/messages-to-android-strings.mjs            # 생성(기존 키 순서 변경은 exit 1)
node android/scripts/messages-to-android-strings.mjs --check    # 최신 여부
node android/scripts/messages-to-android-strings.mjs --update-arg-order   # 호출부 인자 순서를 함께 고친 뒤에만
```

- 값은 iOS 카탈로그와 같은 모양(`%N$s` 위치 지정자 + ICU 복수 블록 원문). 복수형은 `<plurals>`가 아니라 `:kit` `formatLocalized`가 런타임에 푼다 — **인자 있는 문자열은 `appLocalized(res, R.string.x, args)`만** 지난다(`getString(id, args)`·`stringResource(id, args)`·`pluralStringResource` 금지, `LocalizedCallSiteGuardTest`가 잠근다). 인자 없는 것은 `stringResource(id)` 그대로.
- ⚠ **`%%`·`%N$s` 밖의 `%`가 남은 값은 스크립트가 거부한다** — iOS 지정자 `%@`가 원문에 박힌 키(`ios.nearby.subwayEmptyNearest`·`subwayClosed`)가 그대로 들어오면 aapt2 거부 또는 `String.format` 예외다. 그런 키는 android-extra에 **명명 플레이스홀더**로 다시 쓰고 드리프트 테스트의 `INTENDED_DIFFERENCES`에 사유를 적는다(iOS 문안과 다른 모든 `android.X`는 그 목록에 있어야 하고, 목록에 있는데 어느 로케일에서도 같으면 낡은 항목으로 잡힌다).
- 리소스 이름은 키의 `.`→`_`(`search.placeCount` → `R.string.search_placeCount`).
- 언어 판정은 `AppLocale.current(res)` = 각 로케일 파일의 마커 `app_locale`(리소스 해석기가 고른 폴더가 곧 정답). `dataLocale`은 ko 외 전부 en.
- ko 위치 인자 순서는 `android/i18n/arg-order.json`이 잠근다(iOS와 같은 게이트, 개명 키는 `ios.X` 순서와 대조). 드리프트 가드 `src/lib/__tests__/android-strings-drift.test.ts`(최신·arg-order·왕복·리소스 이름·ios-extra 문안 동일(의도된 차이 목록)·거부 키·도입/무시·개명 arg-order).
- 문장은 ViewModel에 **호출 시점 람다**로 주입한다(`SearchStrings`·`NearbyStrings`·`PlaceStrings` — 앱별 언어 변경을 따라간다, JVM 테스트 가능). 낭독에 거리가 들면 `spokenDistanceUnits(text, "미터")`를 병합 컨테이너의 `contentDescription`에(실기기 판정 뒤 제거 가능).

## 7. 게이트 락 절차

1. `until mkdir ~/gildongmu-wt/gate.lock 2>/dev/null; do sleep 30; done`
2. `cd android && ./gradlew :kit:test :app:testDebugUnitTest :app:assembleDebug :app:assembleExperimental :app:compileDebugAndroidTestKotlin`
3. `cd .. && VITEST_MAX_THREADS=2 npm run test:run`
   - androidTest(ATF)는 기기에서만 돈다(`connectedDebugAndroidTest`, 계측 변형은 `testBuildType` 기본값 = debug 하나뿐이라 `androidTestExperimental/` 소스셋은 **돌지 않는다**). 도보 안내 ATF(`guide/GuideSheetA11yTest`)는 테스트 안에서 `GuideSession.experimentalEnabled = { true }`로 게이트를 켜고 `debugSetUi`로 상태만 넣어 전경 서비스를 띄우지 않으므로 debug 변형에서 유효하다(debug 매니페스트에는 전경 서비스 선언이 없다 — 실험판 소스셋에만). 서비스를 실제로 띄우는 ATF가 생기면 `android.testBuildType = "experimental"`로 계측 변형을 통째로 옮기는 결정이 필요하다(전체 ATF에 파급 — 코디네이터 판정).
   - 기기 테스트의 계약 JSON은 `DeviceFixtures`로 테스트 APK assets에서 읽는다. JVM `Fixtures`의 Mac 저장소 탐색은 기기에서 실패한다. 개별 클래스 필터 실행 뒤에는 XML의 실제 클래스·테스트 수를 확인한다.
   - 정식 APK 봉인 검사: `node android/scripts/check-release-manifest.mjs android/app/build/outputs/apk/debug/app-debug.apk`(실험판은 `--experimental`).
4. 성공·실패와 무관하게 `rmdir ~/gildongmu-wt/gate.lock; (cd android && ./gradlew --stop)`

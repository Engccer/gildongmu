# 길동무 안드로이드

iOS 앱과 기능 등가인 안드로이드 네이티브 앱(판정 문서 `docs/superpowers/specs/2026-09-15-android-app-decisions.md`, 병렬 계획 `docs/superpowers/plans/2026-09-16-android-app-parallel-plan.md`). 이 문서는 **로직 세션이 이것만 읽고 같은 방식으로 이식하게** 쓴 작업 계약이다. 설계 근거는 위 두 문서에 있고 여기엔 절차와 관용구만 둔다.

## 1. 모듈

```
android/
  app/   Jetpack Compose 화면 + 플랫폼 서비스([3]·[4]). 패키지 space.dodoplanet.gildongmu
  kit/   순수 Kotlin/JVM, iOS GildongmuKit의 미러([2] 판정 계층). 패키지 space.dodoplanet.gildongmu.kit
         Models/*.swift → kit/.../kit/models/*.kt (하위 패키지 space.dodoplanet.gildongmu.kit.models)
  kit/mirrors/{foundation,core,guide}.json   미러 등록부(§5)
  scripts/messages-to-kit-strings.mjs         :kit 문자열 카탈로그 생성(§6)
```

- `:kit`은 **안드로이드 의존이 0**이다. `import android.`·`import androidx.`가 한 줄이라도 들어오면 `KitPurityTest`가 빨개지고, `kit/build.gradle.kts`에 안드로이드 플러그인·의존성을 더해도 같은 테스트가 잡는다. 저장·네트워크·시계처럼 플랫폼이 필요한 것은 인터페이스(`HttpTransport`·`KeyValueStore`)로 두고 `:app`이 구현한다(D5 경계).
- 빌드 구성은 셋(iOS Debug/Release/Experimental 미러): `debug` · `release` · `experimental`. 실험판은 applicationId `space.dodoplanet.gildongmu.dev`, 표시 이름 "길동무 실험"(`app/src/experimental/res/values/strings.xml` — 스크린 리더 사용자의 유일한 구분 수단이라 반드시 유지), 아이콘 배경색 구분. 코드 게이트는 `AppConfig.experimentalGuidanceEnabled`(= `BuildConfig.EXPERIMENTAL`).
- 뼈대 파일(`settings.gradle.kts`·`build.gradle.kts`·`gradle/**`·`gradle.properties`·`kit/build.gradle.kts`·`app/**`·`scripts/**`·이 README)은 `android-m1`만 고친다. 로직 세션이 의존성을 더해야 하면 고치지 말고 코디네이터에 보고한다. **새 Kotlin 파일 추가는 자유**(자기 그룹 파일만).

## 2. 환경

| 항목 | 값 |
|---|---|
| JDK | 21 (`gradle/gradle-daemon-jvm.properties`가 데몬을 21로 고정하고 없으면 foojay가 `~/.gradle/jdks`에 내려받는다. 기계 경로는 어디에도 없다) |
| Android SDK | `~/Library/Android/sdk` (platform-tools 37 · platforms;android-37.2(compileSdk) · platforms;android-36 · build-tools;36.0.0). 위치는 `ANDROID_HOME`으로 알린다 |
| Gradle | 9.7.1 (wrapper) · AGP 9.4.0(built-in Kotlin — 내장 KGP 2.2.10이 같은 클래스패스에서 2.4.20으로 올라가 :kit·:app이 한 컴파일러를 쓴다, `./gradlew buildEnvironment`로 확인) · Kotlin 2.4.20 · Compose BOM 2026.09.00 · kotlinx.serialization 1.11.0 · coroutines 1.11.0 (`gradle/libs.versions.toml`) |
| minSdk / targetSdk / compileSdk | 31 / 36 / 37.2 (Compose 1.12가 37 이상을 요구. D8의 min·target은 그대로) |

```bash
export ANDROID_HOME=~/Library/Android/sdk
cd android
./gradlew :kit:test                         # 판정 계층 테스트(fixture 포함)
./gradlew :app:assembleDebug                # 정식 번들 디버그 APK
./gradlew :app:assembleExperimental         # 실험판 APK (…gildongmu.dev, "길동무 실험")
./gradlew :app:assembleRelease              # 미서명 릴리스(스토어 업로드는 Play App Signing, 계정 개설 뒤)
adb install -r app/build/outputs/apk/experimental/app-experimental.apk
adb exec-out timeout 10 uiautomator dump /dev/tty   # 접근성 트리(스크린 리더가 읽는 구조)
./gradlew --stop                            # 끝나면 데몬을 내린다(16GB 머신)
```

**무거운 게이트는 머신 전역 락 안에서 돈다**(계획 §3): `until mkdir ~/gildongmu-wt/gate.lock 2>/dev/null; do sleep 30; done` → `./gradlew :kit:test :app:assembleDebug :app:assembleExperimental` + `VITEST_MAX_THREADS=2 npm run test:run`(저장소 루트) → 실패해도 `rmdir ~/gildongmu-wt/gate.lock`. Gradle 워커는 `gradle.properties`가 2로 묶어 두었다.

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

### JDK API 표면은 Android 12(API 31)까지

`:kit`은 JVM 21에서 테스트되지만 실행은 minSdk 31 기기다. 안드로이드 lint `NewApi`는 JVM 모듈을 보지 않으므로 어느 게이트도 못 잡는다 — **API 33에서 추가된 JDK 오버로드를 부르지 않는다**: `URLEncoder.encode(String, Charset)`(→ `encode(s, "UTF-8")`), `InputStream.readAllBytes()`(→ Kotlin `readBytes()`), `String.repeat`류 Java 11+ 문자열 API(→ Kotlin stdlib). 의심되면 Android SDK 문서의 "Added in API level"을 본다(실사고: `URLEncoder.encode(value, Charsets.UTF_8)`가 리뷰에서 잡혔다).

### 정규식 함정

- **문자 클래스 안 `[`는 반드시 `\[`로 이스케이프한다**(`[(\[]`). Java도 Swift(ICU)처럼 `[[]`를 중첩 집합으로 읽어 웹(JS)만 초록이고 Kotlin·iOS만 전량을 놓친다(CLAUDE.md 함정). 공유 fixture를 Kotlin에서도 돌리는 것이 유일한 검출 수단이다.
- `\b`는 한글·한자를 word character로 본다(웹·Swift와 같다). CJK 직결 꼴에는 부정 전방탐색을 쓴다(`Format.kt`).
- 전방·후방탐색(`(?<!키즈)카페`)은 Java에서 그대로 통한다.
- Kotlin raw string `"""…"""` 안에서는 `\d`를 그대로 쓴다. 일반 문자열이면 `\\d`.
- KDoc·주석 안에 `/*`를 쓰지 않는다 — Kotlin은 **중첩 블록 주석**이라 `/api/*` 같은 경로 하나가 주석을 열어 파일 전체를 삼킨다(실사고: `APIClient.kt` "Unclosed comment").

### 컴파일 규율

`:kit`은 `allWarningsAsErrors`다. 경고 하나가 곧 빌드 실패이므로 미사용 변수·불필요한 캐스트를 남기지 않는다. `ExperimentalSerializationApi`(`descriptor.nullable` 등)는 `@OptIn`으로 명시한다.

## 4. fixture 로더 (`kit/src/test/.../Fixtures.kt`)

```kotlin
val cases = Fixtures.sharedJson("korea-boundary-cases.json", BoundaryCaseFile.serializer()).cases  // src/lib/__tests__/fixtures/
val places = Fixtures.kitJson("places.json", PlaceSearchResult.serializer())                     // ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures/
val lines = Fixtures.kit("chat-stream.ndjson").lines()                                            // 원문
```

- 저장소 루트는 `:kit build.gradle.kts`가 넘기는 `gildongmu.kitDir`에서 위로 올라가 `package.json` + `ios/GildongmuKit/Package.swift`가 있는 곳. 못 찾거나 파일이 없거나 비면 **실패한다**(조용히 통과하지 않는다).
- fixture 모양은 테스트 파일 안의 `@Serializable private data class`로 그때그때 선언한다(Swift 테스트의 `private struct … Decodable`과 같은 자리).
- 두 fixture 디렉터리는 **읽기만** 한다. 틀렸다고 판단되면 고치지 말고 코디네이터에 보고한다(웹·iOS 테스트도 같이 바뀌어야 한다).
- 네트워크 계층 테스트는 `stubbedClient { url -> HttpResponse(status, body) }` / `StubTransport`(경로 판정은 `pathOf(url)`·`queryOf(url)`), 저장소는 `InMemoryKeyValueStore`.

## 5. 미러 등록부 갱신법 (`kit/mirrors/<그룹>.json`)

자기 그룹 파일만 고친다. 형식:

```json
{ "swift": "TransitGuide.swift", "status": "ported",
  "kotlin": "android/kit/src/main/kotlin/space/dodoplanet/gildongmu/kit/TransitGuide.kt",
  "test":   "android/kit/src/test/kotlin/space/dodoplanet/gildongmu/kit/TransitGuideTest.kt",
  "note":   "이름 변경·미이식 함수·경계 판정 같은, 다음 사람이 모르면 틀리는 것" }
```

- 상태는 `pending`(아직) → `ported`(kotlin 경로 실재, test 있으면 그것도) 셋 중 하나이고 `excluded`는 계획 §2의 2건뿐이다(늘리려면 코디네이터).
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

`:app` 화면 문자열(`res/values-*/strings.xml`)은 M1이 별도 스크립트로 만든다.

## 7. 게이트 락 절차

1. `until mkdir ~/gildongmu-wt/gate.lock 2>/dev/null; do sleep 30; done`
2. `cd android && ./gradlew :kit:test :app:assembleDebug :app:assembleExperimental`
3. `cd .. && VITEST_MAX_THREADS=2 npm run test:run`
4. 성공·실패와 무관하게 `rmdir ~/gildongmu-wt/gate.lock; (cd android && ./gradlew --stop)`

package space.dodoplanet.gildongmu.nav

import space.dodoplanet.gildongmu.kit.Fixtures
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 앱 층 구조 가드(spec §8): 위치는 한 곳에서만, 백그라운드 위치·GMS 의존 0. */
class AppSourceGuardTest {
    private val android = Fixtures.repoRoot.resolve("android")
    private val sources = android.resolve("app/src/main").walkTopDown().filter { it.isFile && (it.extension == "kt" || it.extension == "xml") }.toList()

    /**
     * 단발 취득(`AndroidLocationSource`)과 M4 도보 안내 스트림(`GuideLocationStream`, 1초·속도·방위·elapsedRealtimeNanos 페이로드, 서비스 수명)
     * 둘뿐이다 — `LocationManager`는 리스너마다 독립 요청이라 두 스트림이 공존한다(iOS 단일 매니저 경합 없음, M4 spec §4-2). 화면·ViewModel은
     * 여전히 `LocationStore` 경유.
     */
    @Test fun `LocationManager 생성은 AndroidLocationSource·GuideLocationStream 두 곳뿐이다`() {
        val creators = sources.filter { f -> f.readText().let { it.contains("LocationManager::class.java") || it.contains("LOCATION_SERVICE") } }
        assertEquals(setOf("AndroidLocationSource.kt", "GuideLocationStream.kt"), creators.map { it.name }.toSet())
    }

    @Test fun `백그라운드 위치 권한 문자열은 0이다`() {
        assertTrue(sources.none { it.readText().contains("ACCESS_BACKGROUND_LOCATION") })
    }

    /**
     * 체인을 여러 줄로 쪼개도 잡는다(주석 줄은 뺀 뒤 한 줄로 합쳐 스캔). 축 둘: `mergedRow(...)` 경유와 `focusable()` 직접 경로 —
     * 그 호출 뒤에 이어지는 `.x(...)` 체인 안에 `focusRequester(`가 오면 위반(괄호 균형을 세므로 중첩 인자도 다룬다).
     */
    @Test fun `착지 requester는 focusable 앞에 준다 — mergedRow·focusable 뒤 focusRequester 순서 금지`() {
        val offenders = sources.filter { it.extension == "kt" }.filter { f ->
            val code = f.readLines().filter { l -> val t = l.trimStart(); !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/**") }.joinToString(" ")
            hasRequesterAfterFocusTarget(code)
        }.map { it.name }
        assertEquals(emptyList(), offenders)
        // 가드 자체가 살아 있다
        assertTrue(hasRequesterAfterFocusTarget("""Modifier.mergedRow("k", spoken, focus = requesterFor(key)) .headingText() .focusRequester(r)"""))
        assertTrue(hasRequesterAfterFocusTarget("""Modifier.focusable().padding(8.dp).focusRequester(r)"""))
        assertTrue(hasRequesterAfterFocusTarget("""Modifier.focusable().padding(8.dp).landingTarget(r)"""))
        assertTrue(hasRequesterAfterFocusTarget("""Modifier.clickable(role = Role.Button) { open() }.testTag(k).landingTarget(r)"""))
        assertTrue(hasRequesterAfterFocusTarget("""Modifier.selectable(selected, role = Role.RadioButton) { pick() }.landingTarget(r)"""))
        assertTrue(!hasRequesterAfterFocusTarget("""Modifier.focusRequester(r).mergedRow("k", focus = requesterFor(key)).headingText()"""))
        assertTrue(!hasRequesterAfterFocusTarget("""Modifier.mergedRow("k").padding(4.dp) ; val x = other.focusRequester(r)"""))
    }

    /** `mergedRow(`·`focusable(`의 닫는 괄호 뒤로 이어지는 `.name(...)` 체인만 따라가며 `focusRequester`를 찾는다. */
    private fun hasRequesterAfterFocusTarget(code: String): Boolean {
        val starts = Regex("""\b(mergedRow|focusable|clickable|selectable|toggleable)\(""")
        for (m in starts.findAll(code)) {
            var i = skipTrailingLambda(code, skipBalanced(code, m.range.last) ?: continue)
            while (true) {
                val chain = Regex("""^\s*\.([A-Za-z_][A-Za-z0-9_]*)\(""").find(code.substring(i)) ?: break
                if (chain.groupValues[1] == "focusRequester" || chain.groupValues[1] == "landingTarget") return true
                i = skipTrailingLambda(code, skipBalanced(code, i + chain.range.last) ?: break)
            }
        }
        return false
    }

    /** `i` 뒤에 공백을 두고 `{`가 오면(후행 람다 — `clickable(...) { }`) 짝 `}`의 다음 인덱스, 아니면 `i`. */
    private fun skipTrailingLambda(code: String, i: Int): Int {
        var j = i
        while (j < code.length && code[j] == ' ') j++
        if (j >= code.length || code[j] != '{') return i
        var depth = 0
        for (k in j until code.length) {
            when (code[k]) { '{' -> depth++; '}' -> { depth--; if (depth == 0) return k + 1 } }
        }
        return i
    }

    /** `openIndex`가 `(`일 때 짝 `)`의 다음 인덱스. 없으면 null. */
    private fun skipBalanced(code: String, openIndex: Int): Int? {
        var depth = 0
        for (j in openIndex until code.length) {
            when (code[j]) { '(' -> depth++; ')' -> { depth--; if (depth == 0) return j + 1 } }
        }
        return null
    }

    @Test fun `내 주변·검색의 pop 복귀 슬롯은 화면이 실제로 부른다`() {
        val nearby = android.resolve("app/src/main/kotlin/space/dodoplanet/gildongmu/nearby/NearbyKindScreen.kt").readText()
        assertTrue(nearby.contains("vm.returnFocus.remember(") && nearby.contains("vm.returnFocus.take()"))
        val search = android.resolve("app/src/main/kotlin/space/dodoplanet/gildongmu/search/SearchScreen.kt").readText()
        assertTrue(search.contains("vm.rememberReturnFocus(") && search.contains("vm.takeReturnFocus()"))
    }

    @Test fun `화면은 Scaffold를 직접 열지 않는다(AppScreenScaffold — 이중 인셋 방지)`() {
        val allowed = setOf("AppRoot.kt", "AppTopBar.kt")
        val offenders = sources.filter { it.extension == "kt" && it.name !in allowed && Regex("""\bScaffold\(""").containsMatchIn(it.readText()) }.map { it.name }
        assertEquals(emptyList(), offenders)
    }

    @Test fun `내 주변 허브 순서는 iOS NearbyHubView와 같다(spec §12-1)`() {
        assertEquals(
            listOf("around", "subway", "bus", "bike", "clinic", "barrierFree", "kids", "events", "walkInfra", "conditions"),
            space.dodoplanet.gildongmu.nearby.NearbyKind.entries.map { it.name },
        )
    }

    @Test fun `문자열 리소스는 리터럴 ID로만 되받는다 — 동적 키 조립 0(spec §12 매핑표 규율)`() {
        assertTrue(sources.none { it.extension == "kt" && it.readText().contains("getIdentifier(") })
    }

    /**
     * Compose 1.12 `clickable`(Material3 Button)은 터치 입력 모드에서 포커스를 받지 않는다(`Focusability.SystemDefined`) — TalkBack 폰에서
     * 버튼 착지 `requestFocus()`가 조용히 false. 착지 부착은 `mergedRow(focus)`(focusable = Always)와 `landingTarget`(canFocus = true)뿐이다.
     */
    @Test fun `focusRequester 부착은 a11y의 두 관용구뿐이다(버튼 착지는 landingTarget)`() {
        val allowed = setOf("A11y.kt", "Landing.kt")
        val offenders = sources.filter { it.extension == "kt" && it.name !in allowed && Regex("""\.focusRequester\(""").containsMatchIn(it.readText()) }.map { it.name }
        assertEquals(emptyList(), offenders)
        val landing = android.resolve("app/src/main/kotlin/space/dodoplanet/gildongmu/a11y/Landing.kt").readText()
        assertTrue(landing.contains("focusProperties { canFocus = true }"))
    }

    /** Kotlin `assert(`는 ART에서 기본 비활성이라 실기기 테스트에서 no-op — 초록 스위트가 죽은 단언을 가린다. */
    @Test fun `androidTest에 Kotlin assert( 사용은 0이다`() {
        val tests = android.resolve("app/src/androidTest").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        assertTrue(tests.isNotEmpty())
        assertEquals(emptyList(), tests.filter { Regex("""(^|[^A-Za-z_.])assert\(""").containsMatchIn(it.readText()) }.map { it.name })
    }

    /** spec 판정 38 — 앱 층의 좌표 진입점은 `EffectiveLocation`뿐. 화면·ViewModel이 GPS 스토어를 직접 잡으면 그 화면만 수동 위치를 무시하고 화면으로 반증되지 않는다. */
    @Test fun `location 밖에서 LocationStore를 직접 잡지 않는다(수신자 기준)`() {
        // 자리가 아니라 역할로 면제한다 — `location/` 안이라도 화면·ViewModel이 새로 들어오면 목록에 근거와 함께 올려야 한다.
        val allowed = setOf("AppConfig.kt", "LocationStore.kt", "EffectiveLocation.kt", "ManualLocationJudge.kt", "CurrentAddressStore.kt", "ManualLocationPickerViewModel.kt")
        val coordinateCalls = listOf("currentCoordinate", "gpsCoordinateForRanking", "coordinateForDisplay", "currentFix")
        // 화이트리스트 노후화 방지: `LocationStore`의 공개 suspend 함수 전수와 같아야 한다(새 좌표 함수가 목록 갱신 없이 들어오면 여기서 빨갛다).
        val declared = Regex("""^\s{4}suspend fun (\w+)\(""", RegexOption.MULTILINE).findAll(android.resolve("app/src/main/kotlin/space/dodoplanet/gildongmu/location/LocationStore.kt").readText()).map { it.groupValues[1] }.toSet()
        assertEquals(coordinateCalls.toSet(), declared)
        val offenders = sources.filter { f ->
            f.extension == "kt" && f.name !in allowed &&
                // 좌표를 내는 호출·스토어 타입 보유만 잡는다(`isLocationEnabled` 같은 기기 상태 조회는 좌표가 아니다). 지역 별칭(`val ls = AppConfig.locationStore`)은 타입 보유 축이 잡는다.
                Regex("""AppConfig\.locationStore\.(${coordinateCalls.joinToString("|")})\(|:\s*LocationStore\b|\bLocationStore\(|=\s*AppConfig\.locationStore\b""").containsMatchIn(f.readText())
        }.map { it.name }
        assertEquals(emptyList(), offenders)
    }

    /** spec 판정 34 — 판정 트리거 ON_START 배선은 뷰 계층이라 소스 가드로 잠근다. */
    @Test fun `MainActivity가 ON_START에서 수동 위치 판정을 부른다`() {
        val main = android.resolve("app/src/main/kotlin/space/dodoplanet/gildongmu/MainActivity.kt").readText()
        assertTrue(main.contains("Lifecycle.Event.ON_START") && main.contains("manualLocationJudge.run("))
    }

    /** spec §13-5 총체성 — 앱 통지(자동 해제·언어 변경)는 화면의 `StatusLine`이 읽으므로 화면마다 하나가 있어야 어느 화면에서든 들린다. */
    @Test fun `AppScreenScaffold를 여는 파일은 StatusLine도 연다`() {
        val allowed = setOf("AppTopBar.kt")
        val offenders = sources.filter { it.extension == "kt" && it.name !in allowed && it.readText().contains("AppScreenScaffold(") && !it.readText().contains("StatusLine(") }.map { it.name }
        assertEquals(emptyList(), offenders)
    }

    /** spec §14-2 판정 39 — 로케일 오버라이드 경로는 하나. */
    @Test fun `createConfigurationContext 호출은 AppConfig 한 곳이고 설정 파일 이름은 gildongmu다`() {
        assertEquals(listOf("AppConfig.kt"), sources.filter { it.extension == "kt" && it.readText().contains("createConfigurationContext(") }.map { it.name })
        assertTrue(android.resolve("app/src/main/kotlin/space/dodoplanet/gildongmu/storage/SharedPreferencesStore.kt").readText().contains("name: String = \"gildongmu\""))
        assertTrue(android.resolve("app/src/main/kotlin/space/dodoplanet/gildongmu/MainActivity.kt").readText().let { it.contains("override fun attachBaseContext") && it.contains("AppConfig.localized(base)") })
    }

    /** spec §14-2 — 문장·언어는 호출 시점에 `AppConfig.localizedApp()`에서. 목록이 아니라 규약이라 새 팩토리가 자동으로 든다. */
    @Test fun `리소스는 호출 시점에 localizedApp에서 읽는다 — app·applicationContext 캡처 0`() {
        val forbidden = Regex("""\b(app|applicationContext)\.(resources|getString\()""")
        assertEquals(emptyList(), sources.filter { it.extension == "kt" && it.name != "AppConfig.kt" && forbidden.containsMatchIn(it.readText()) }.map { it.name })
        // 별칭으로 새는 경로: `val x = …applicationContext` 뒤 `x.resources`·`x.getString(`(플랫폼 서비스 홀더가 시스템 서비스만 잡는 별칭은 통과).
        val alias = Regex("""\bval\s+(\w+)\s*(?::\s*Context)?\s*=\s*(?:\w+\.)*applicationContext\s*$""", RegexOption.MULTILINE)
        val aliasOffenders = sources.filter { f ->
            f.extension == "kt" && f.name != "AppConfig.kt" && alias.findAll(f.readText()).any { m ->
                Regex("""\b${m.groupValues[1]}\.(resources|getString\()""").containsMatchIn(f.readText())
            }
        }.map { it.name }
        assertEquals(emptyList(), aliasOffenders)
        val factoryFiles = sources.filter { it.extension == "kt" && (it.name.endsWith("Factory.kt") || it.name.endsWith("Factories.kt") || it.name.endsWith("StringsRes.kt") || it.name == "MainActivity.kt") }
        assertTrue(factoryFiles.size >= 5, factoryFiles.map { it.name }.toString())
        assertEquals(emptyList(), factoryFiles.filter { Regex("""\bcontext\.(resources|getString\()""").containsMatchIn(it.readText()) }.map { it.name })
        // 새 규약 위반 꼴: `val r = …localizedApp().resources`처럼 Resources를 한 번 읽어 담는 것(람다 `{ … .resources }`는 `=` 뒤가 `{`라 걸리지 않는다)
        assertEquals(emptyList(), factoryFiles.filter { Regex("""=\s*\w+(\.\w+\(?\)?)*\.resources\b""").containsMatchIn(it.readText()) }.map { it.name })
    }

    /** spec §14-3 판정 40 — 진동은 `StatusLine` 발화 효과 한 자리(iOS `result-haptic-guard` 동형). */
    @Test fun `performHapticFeedback 호출 파일은 A11y 하나다`() {
        assertEquals(listOf("A11y.kt"), sources.filter { it.extension == "kt" && it.readText().contains("performHapticFeedback(") }.map { it.name })
    }

    /** spec §14-1 판정 42·§3-1 — 설정 진입은 탭 루트 4개 전부이고 `actions` 블록의 **마지막** 호출(화면 고유 액션 뒤). */
    @Test fun `설정 버튼은 탭 루트 4개의 상단 바 actions 블록 마지막에 있다`() {
        val last = Regex("""actions = \{[^}]*SettingsAction\([^()]*\)\s*\}""")
        for (f in listOf("search/SearchScreen.kt", "directions/DirectionsScreen.kt", "nearby/NearbyHubScreen.kt", "chat/ChatScreen.kt")) {
            assertTrue(last.containsMatchIn(android.resolve("app/src/main/kotlin/space/dodoplanet/gildongmu/$f").readText()), f)
        }
    }

    /** spec §14-5 — 실험판 게이트 배선(debug 변형은 EXPERIMENTAL=false라 ATF가 그 행을 렌더하지 않는다 — 소스로 잠근다). */
    @Test fun `설정 화면은 settingsRows를 실험판 플래그로 부른다`() {
        assertTrue(android.resolve("app/src/main/kotlin/space/dodoplanet/gildongmu/settings/SettingsScreen.kt").readText().contains("settingsRows(AppConfig.resultHapticsSettingEnabled)"))
        assertTrue(android.resolve("app/src/main/kotlin/space/dodoplanet/gildongmu/AppConfig.kt").readText().contains("val resultHapticsSettingEnabled: Boolean = BuildConfig.EXPERIMENTAL"))
    }

    /** M4 인계 — 받아쓰기가 안내 음성을 억제한다(`GuideSession.setOutputSuppressed`, 시작/모든 종료 경로 = `setPhase` 한 자리). */
    @Test fun `받아쓰기 세션은 안내 음성 억제 훅을 건다`() {
        val speech = android.resolve("app/src/main/kotlin/space/dodoplanet/gildongmu/speech/DictationSession.kt").readText()
        assertTrue(speech.contains("GuideSession.setOutputSuppressed(active, owner)") && speech.contains("if (changed) onActiveChanged(active)"))
    }

    @Test fun `Google Play 서비스 의존은 0이다`() {
        val gradle = listOf(android.resolve("app/build.gradle.kts"), android.resolve("gradle/libs.versions.toml"))
        assertTrue(gradle.none { it.readText().contains("play-services") })
    }

    // ── spec §13-4 유도형 금지 표현 가드(웹 `manual-location-copy.test.ts`의 안드로이드판, 하드코딩 없음) ──

    private val koStrings = android.resolve("app/src/main/res/values/strings.xml")
    private fun stringNames(file: File): Map<String, String> =
        Regex("""<string name="([^"]+)"[^>]*>(.*?)</string>""").findAll(file.readText()).associate { it.groupValues[1] to it.groupValues[2] }

    /** ① 소비자 유니버스 술어 — 유효 좌표·수동 위치를 쓰는 파일은 자동으로 든다(표시줄·허브·내 주변·검색·길찾기 VM). */
    private val universePredicates = Regex("""EffectiveLocation|effectiveLocation\.|nearbyCoordinateSource\(|manualLocationLabel\(|ManualLocationStore|manualLocationStore\.|usedManualCoordinate\(|aroundHereResId\(|DirectionsFieldTarget\.manualLocation""")

    /** 파일이 참조하는 리소스 이름: `R.string.x` + 점 키 리터럴(`"a.b"` → `a_b`, 길찾기 `Strings` 경로). */
    private fun referencedKeys(f: File, names: Set<String>): Set<String> {
        val text = f.readText()
        val direct = Regex("""R\.string\.([A-Za-z0-9_]+)""").findAll(text).map { it.groupValues[1] }
        val dotted = Regex(""""([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)"""").findAll(text).map { it.groupValues[1].replace('.', '_') }
        return (direct + dotted).filter { it in names }.toSet()
    }

    /** ⑤ 수동 분기 키 — 이름에 `Manual`이 든 키 전부(공유 네임스페이스의 미래 키도 든다). 웹 화면 미러 `around_*Manual`만 제외(안드로이드 소비자 없음). */
    private fun isManualKey(name: String) = (name.contains("Manual") || name.startsWith("manualLocation_manual")) && !name.startsWith("around_")

    /** ③ 근거를 적은 예외 — GPS 문구를 담지만 그 파일에 수동 분기가 없어도 되는 키(웹 `KNOWN_UNBRANCHED` 이식). 죽은 항목은 ④가 잡는다. */
    private val knownUnbranched = mapOf(
        "manualLocation_locating" to "측위 진행 문구 — 측위가 실제로 일어나는 갈래(권한 Fine)에서만 게시된다(지정 화면 VM)",
        "manualLocation_gps" to "표시줄 GPS 갈래 문구 — 같은 함수가 수동을 먼저 가른다",
        "manualLocation_gpsNear" to "표시줄 GPS 갈래 문구 — 같은 함수가 수동을 먼저 가른다",
        "directions_currentLocation" to "출발지 GPS 갈래 문구 — `currentLocationText` 첫 줄이 수동을 가른다",
        "directions_currentLocationNear" to "출발지 GPS 갈래 문구 — `currentLocationText` 첫 줄이 수동을 가른다",
        "directions_refreshingCurrent" to "강제 재측위 진행 문구 — 수동이면 라벨이 먼저 반환돼 닿지 않는다",
        "directions_locating" to "조회 시작 측위 문구 — 수동이면 좌표가 즉시 나와 사실상 닿지 않고, 닿는다면 GPS 갈래다",
        "directions_geoError" to "수동이 유지되는 동안 좌표 해석이 성공해 닿지 않고, 닿았다면 직전 판정이 해제한 뒤다(웹 근거)",
        "android_nearby_aroundHere" to "둘러보기 GPS 갈래 문구 — `aroundHereResId`가 수동을 가른다",
        "android_nearby_aroundHereNoPlace" to "둘러보기 GPS 갈래 문구 — `aroundHereResId`가 수동을 가른다",
        "android_common_locationFailed" to "측위 실패 제목 — 수동이면 좌표가 측위 없이 나오므로 GPS 갈래에서만 닿는다(웹 근거)",
        "android_common_outOfCoverage" to "제공 지역 밖 안내 — 기능 전체에 대한 참인 문장이고 수동 좌표가 밖이어도 그대로 참이다(웹 근거)",
        "directions_useCurrentLocation" to "출발지 picker의 GPS 선택 버튼 이름 — 확정 결과는 필드 문장(`currentLocationText`)이 수동을 가른다(웹 근거)",
        "manualLocation_useGps" to "지정 화면 전용 문구 — 수동 맥락에서만 렌더된다(되돌리기)",
    )

    @Test fun `수동 위치 소비자는 GPS 유도 문구를 수동 분기 없이 쓰지 않는다(spec §13-4 축 ①~④)`() {
        val names = stringNames(koStrings)
        val gpsPhrase = names.getValue("manualLocation_gps") // "현재 위치" — 코드에 문구를 박지 않는다(②)
        val gpsKeys = names.filterValues { it.contains(gpsPhrase) }.keys
        assertTrue(gpsKeys.size > 20, "GPS 키 유도가 살아 있다: ${gpsKeys.size}")
        val manualKeys = names.keys.filter { isManualKey(it) }.toSet()
        val universe = sources.filter { it.extension == "kt" && universePredicates.containsMatchIn(it.readText()) }
        for (must in listOf("LocationBar.kt", "DirectionsViewModel.kt", "NearbyKindScreen.kt", "NearbyLines.kt")) assertTrue(universe.any { it.name == must }, "$must 가 유니버스에 든다")
        // ⚠ 분기 판정은 파일 단위다(웹 원본과 같은 한계) — 한 자리만 분기하고 나머지는 그대로인 회귀는 리뷰 몫.
        val offenders = ArrayList<String>()
        val referencedKnown = HashSet<String>()
        for (f in universe) {
            val refs = referencedKeys(f, names.keys)
            val gps = refs.filter { it in gpsKeys }
            val branches = refs.any { it in manualKeys }
            for (k in gps) if (k in knownUnbranched) referencedKnown += k else if (!branches) offenders += "${f.name}:$k"
        }
        assertEquals(emptyList(), offenders, "GPS 문구를 쓰면서 수동 분기가 없는 파일:키")
        assertEquals(emptyList(), (knownUnbranched.keys - referencedKnown).sorted(), "죽은 예외 항목(축 ④) — 유니버스 어느 파일도 참조하지 않는다")
    }

    @Test fun `수동 분기 키 전수 — 6로케일 존재·참조 1 이상·GPS 문구를 되풀이하지 않는다(spec §13-4 축 ⑤)`() {
        val ko = stringNames(koStrings)
        val gpsPhrase = ko.getValue("manualLocation_gps")
        val manualKeys = ko.keys.filter { isManualKey(it) }.sorted()
        assertEquals(listOf("android_nearby_aroundHereManual", "android_nearby_aroundHereManualNoPlace", "android_nearby_aroundLoadedManual", "manualLocation_manual", "manualLocation_manualUnverifiable"), manualKeys)
        val locales = listOf("en", "es", "fr", "it", "ja").map { l -> l to stringNames(android.resolve("app/src/main/res/values-$l/strings.xml")).keys }
        val kt = sources.filter { it.extension == "kt" }
        val problems = manualKeys.flatMap { k ->
            buildList {
                for ((l, keys) in locales) if (k !in keys) add("$k: $l 누락")
                if (kt.none { k in referencedKeys(it, ko.keys) }) add("$k: 참조 0")
                if (ko.getValue(k).contains(gpsPhrase)) add("$k: GPS 문구 포함")
            }
        }
        assertEquals(emptyList(), problems)
    }
}

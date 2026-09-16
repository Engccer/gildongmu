package space.dodoplanet.gildongmu.nav

import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 앱 층 구조 가드(spec §8): 위치는 한 곳에서만, 백그라운드 위치·GMS 의존 0. */
class AppSourceGuardTest {
    private val android = Fixtures.repoRoot.resolve("android")
    private val sources = android.resolve("app/src/main").walkTopDown().filter { it.isFile && (it.extension == "kt" || it.extension == "xml") }.toList()

    @Test fun `LocationManager 생성은 AndroidLocationSource 한 곳뿐이다`() {
        val creators = sources.filter { f -> f.readText().let { it.contains("LocationManager::class.java") || it.contains("LOCATION_SERVICE") } }
        assertEquals(listOf("AndroidLocationSource.kt"), creators.map { it.name })
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
        assertTrue(!hasRequesterAfterFocusTarget("""Modifier.focusRequester(r).mergedRow("k", focus = requesterFor(key)).headingText()"""))
        assertTrue(!hasRequesterAfterFocusTarget("""Modifier.mergedRow("k").padding(4.dp) ; val x = other.focusRequester(r)"""))
    }

    /** `mergedRow(`·`focusable(`의 닫는 괄호 뒤로 이어지는 `.name(...)` 체인만 따라가며 `focusRequester`를 찾는다. */
    private fun hasRequesterAfterFocusTarget(code: String): Boolean {
        val starts = Regex("""\b(mergedRow|focusable|clickable)\(""")
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
        val allowed = setOf("AppConfig.kt")
        val offenders = sources.filter { f ->
            f.extension == "kt" && f.name !in allowed && !f.path.contains("/location/") &&
                // 좌표를 내는 호출·스토어 타입 보유만 잡는다(`isLocationEnabled` 같은 기기 상태 조회는 좌표가 아니다).
                Regex("""AppConfig\.locationStore\.(currentCoordinate|gpsCoordinateForRanking|coordinateForDisplay|currentFix)\(|:\s*LocationStore\b|\bLocationStore\(""").containsMatchIn(f.readText())
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

    @Test fun `Google Play 서비스 의존은 0이다`() {
        val gradle = listOf(android.resolve("app/build.gradle.kts"), android.resolve("gradle/libs.versions.toml"))
        assertTrue(gradle.none { it.readText().contains("play-services") })
    }
}

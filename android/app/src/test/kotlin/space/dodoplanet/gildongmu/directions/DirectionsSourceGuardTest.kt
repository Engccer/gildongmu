package space.dodoplanet.gildongmu.directions

import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.TransitAlternativeName
import space.dodoplanet.gildongmu.kit.TransitWalkLegText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * `directions/` 구조 가드(spec §9). ① 위치 계층은 M2 `location/` 소유 — 직접 참조 0. ② 가상 스크롤 금지(헌장 §1).
 * ③ 소스가 쓰는 문자열 키 전수(리터럴 + :kit이 돌려주는 키)가 `stringId` 표에 있다 — 미매핑 키는 릴리스에서 키 문자열이
 *    낭독되는데 어느 컴파일러도 잡지 못한다.
 */
class DirectionsSourceGuardTest {
    private val root = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu/directions")
    private val sources = root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()

    @Test fun `위치 플랫폼 API·LazyColumn 직접 참조가 없다`() {
        assertTrue(sources.isNotEmpty())
        val bad = Regex("""import android\.location|LocationManager|LazyColumn|LazyRow""")
        val offenders = sources.flatMap { f -> f.readLines().withIndex().filter { bad.containsMatchIn(it.value) }.map { "${f.name}:${it.index + 1}" } }
        assertEquals(emptyList(), offenders)
    }

    @Test fun `소스가 쓰는 문자열 키는 전부 매핑 표에 있다`() {
        val literal = Regex("""(?:strings|ko|ja)\.get\(\s*"([^"]+)"""")
        val used = sources.flatMap { f -> literal.findAll(f.readText()).map { it.groupValues[1] }.toList() }.toMutableSet()
        // :kit이 키를 돌려주는 자리 — 리터럴 스캔에 안 잡힌다.
        used += listOf(
            "route.transit.legWalkTo", "route.transit.legWalkToNoDistance", "route.transit.legWalkToExit",
            "route.transit.legWalkToExitNoDistance", "route.transit.legWalkToDest", "route.transit.legWalkToDestNoDistance",
        )
        used += TransitWalkLegText.resolve("a", "1m", 1, "3").key
        used += TransitAlternativeName.key(listOf("fastest"), null).key
        used += TransitAlternativeName.key(null, 2).key
        // 화면이 `when`으로 고르는 키(변수 조회)
        used += listOf("route.public", "route.pedestrian.heading", "route.car", "route.transit.error", "route.pedestrian.error", "route.briefing.error", "recent.unpin", "recent.pin", "recent.cleared", "recent.clearedExceptPinned", "android.common.expanded", "android.common.collapsed", "directions.searchFrom", "directions.searchTo", "directions.searchVia", "android.route.stopCount", "android.route.stationCount")
        assertTrue(used.size > 40, "스캔이 살아 있다: ${used.size}")
        val missing = used.filter { stringId(it) == null }.sorted()
        assertEquals(emptyList(), missing)
    }
}

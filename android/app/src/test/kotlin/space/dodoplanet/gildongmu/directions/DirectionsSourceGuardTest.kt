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
        // 리터럴은 **키 모양** 전수 스캔(`get(if (…) "a" else "b")`·`when` 갈래도 잡는다). 로그 태그·testTag 템플릿·"package:"는 모양에서 탈락.
        val keyShape = Regex("""^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$""")
        // ⚠ 문자열 리터럴 **전체**를 잡는다 — `$`가 든 리터럴을 건너뛰는 꼴은 따옴표 짝이 어긋나 뒤 리터럴을 삼킨다(리뷰 권고 정규식의 함정).
        val used = sources.flatMap { f -> Regex(""""((?:[^"\\]|\\.)*)"""").findAll(f.readText()).map { it.groupValues[1] }.toList() }
            .filter { keyShape.matches(it) }.toMutableSet()
        // :kit이 키를 돌려주는 자리 — 갈래 전수.
        val axes = listOf("fastest", "fewestTransfers", "leastWalk", "busOnly", "subwayOnly")
        for (h in listOf(null, listOf("fastest", "fewestTransfers")) + axes.map { listOf(it) }) {
            used += TransitAlternativeName.parts(h, 1).map { it.key }
        }
        for (name in listOf("a", null)) for (dist in listOf("1m", null)) for (exit in listOf("3", null)) used += TransitWalkLegText.resolve(name, dist, 1, exit).key
        assertTrue(used.size > 40, "스캔이 살아 있다: ${used.size}")
        assertTrue("route.transit.noRoute" in used && "route.transit.alternativeFastestFewestTransfers" in used) // 갈래 안 키도 잡힌다
        val missing = used.filter { stringId(it) == null }.sorted()
        assertEquals(emptyList(), missing)
    }
}

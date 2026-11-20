package space.dodoplanet.gildongmu.a11y

import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * A75 판정 ⓐ(2026-11-20): 검색·내 주변·채팅·장소 상세의 병합 줄은 거리를 보이는 글자 그대로 한 번만 낸다. 병합 노드에 거리 풀어쓰기
 * 낭독 이름을 얹으면 한소네 화면 읽기가 이름과 자식 글자를 이어 붙여 같은 줄을 두 번 출력한다. 풀어쓰기가 남는 곳은 상태 통지 채널
 * (`NearbyScreenViewModel`의 통지 → `StatusLine`)뿐이다.
 */
class RowSpokenDistanceGuardTest {
    private val app = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu")

    @Test fun `줄 화면은 spokenDistanceUnits를 부르지 않는다 — 상태 통지 채널만`() {
        val users = listOf("search", "nearby", "chat", "place", "a11y")
            .flatMap { dir -> app.resolve(dir).walkTopDown().filter { it.isFile && it.extension == "kt" }.toList() }
            .filter { f -> f.readLines().any { l -> !l.trimStart().startsWith("import ") && !l.trimStart().startsWith("*") && l.contains("spokenDistanceUnits(") } }
            .map { it.name }
            .toSet()
        assertEquals(setOf("NearbyScreenViewModel.kt"), users)
    }
}

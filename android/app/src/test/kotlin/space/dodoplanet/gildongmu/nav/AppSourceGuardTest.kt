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

    @Test fun `Google Play 서비스 의존은 0이다`() {
        val gradle = listOf(android.resolve("app/build.gradle.kts"), android.resolve("gradle/libs.versions.toml"))
        assertTrue(gradle.none { it.readText().contains("play-services") })
    }
}

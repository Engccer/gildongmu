package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.DeserializationStrategy
import java.io.File

/**
 * fixture 공용 로더. 저장소 루트를 찾아 세 플랫폼 공유 fixture(`src/lib/__tests__/fixtures/…json`)와
 * Kit 계약 fixture(`ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures/…`, prod 실캡처)를 읽는다.
 * 둘 다 **읽기 전용**이다 — 세 플랫폼의 정답표라 안드로이드 이식 때문에 고치지 않는다.
 *
 * 못 찾으면 조용히 통과하지 않고 실패한다(Kit `CoverageTests` "리소스를 못 읽어 링이 비면 즉시 실패" 정신).
 * 기준점은 :kit build.gradle.kts가 넘기는 `gildongmu.kitDir`(없으면 작업 디렉터리)에서 위로 올라간다.
 */
object Fixtures {
    val repoRoot: File by lazy {
        var dir: File? = File(System.getProperty("gildongmu.kitDir") ?: System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            if (File(dir, "package.json").isFile && File(dir, "ios/GildongmuKit/Package.swift").isFile) return@lazy dir
            dir = dir.parentFile
        }
        error("저장소 루트를 찾지 못했다(package.json + ios/GildongmuKit/Package.swift). gildongmu.kitDir=${System.getProperty("gildongmu.kitDir")}")
    }

    /** 세 플랫폼 공유 fixture 원문. */
    fun shared(name: String): String = read(repoRoot.resolve("src/lib/__tests__/fixtures/$name"))

    /** Kit 계약 fixture(API 응답 실캡처) 원문. */
    fun kit(name: String): String = read(repoRoot.resolve("ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures/$name"))

    fun <T> sharedJson(name: String, deserializer: DeserializationStrategy<T>): T =
        KitJson.decodeFromString(deserializer, shared(name))

    fun <T> kitJson(name: String, deserializer: DeserializationStrategy<T>): T =
        KitJson.decodeFromString(deserializer, kit(name))

    private fun read(file: File): String {
        check(file.isFile) { "fixture가 없다: $file" }
        val text = file.readText()
        check(text.isNotBlank()) { "fixture가 비었다: $file" }
        return text
    }
}

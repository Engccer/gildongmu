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

/** `APIClient` 스텁 전송(Swift `StubURLProtocol` 대응). handler는 절대 URL을 받는다. */
class StubTransport(private val handler: (String) -> HttpResponse) : HttpTransport {
    val seenUrls = mutableListOf<String>()
    override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
        seenUrls.add(url)
        return handler(url)
    }
}

fun stubbedClient(handler: (String) -> HttpResponse): APIClient =
    APIClient("https://example.test", StubTransport(handler))

/** URL의 경로 부분(`/api/places`). */
fun pathOf(url: String): String = java.net.URI(url).path

/** URL의 raw 쿼리(`query=%EA%B0%95%EB%82%A8&lang=ko`). 없으면 "". */
fun queryOf(url: String): String = java.net.URI(url).rawQuery ?: ""

/** `RecentSearchStore` 테스트용 메모리 저장소. */
class InMemoryKeyValueStore : KeyValueStore {
    private val map = HashMap<String, String>()
    override fun getString(key: String): String? = map[key]
    override fun putString(key: String, value: String) { map[key] = value }
}

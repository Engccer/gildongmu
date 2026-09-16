package space.dodoplanet.gildongmu.kit

/** `APIClient` 스텁 전송(Swift `StubURLProtocol` 대응). handler는 절대 URL을 받는다. `:app` 테스트도 쓴다(testFixtures). */
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

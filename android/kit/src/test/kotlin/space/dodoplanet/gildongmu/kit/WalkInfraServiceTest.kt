package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.kit.models.WalkSourceStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs

/** 보행 인프라 조회(Kit 테스트 없음 — Swift 주석 계약): envelope 풀기, 부분 결과 보존, 두 소스 전멸은 503 throw. */
class WalkInfraServiceTest {
    @Test fun unwrapsEnvelopeAndKeepsPartialResult() = runTest {
        val t = StubTransport { HttpResponse(200, Fixtures.kit("walk-nearby-degraded.json")) }
        val walk = WalkInfraService(APIClient("https://example.test", t)).nearby(37.5, 127.1)
        assertEquals("/api/walk/nearby", pathOf(t.seenUrls.last()))
        assertEquals(listOf("lat" to "37.5", "lng" to "127.1"), t.lastQuery())
        assertIs<WalkSourceStatus.Ok<*>>(walk.audioSignals)
        assertIs<WalkSourceStatus.Error<*>>(walk.osm)
    }

    @Test fun bothSourcesDownThrows() = runTest {
        val service = WalkInfraService(APIClient("https://example.test", StubTransport { HttpResponse(503, """{"error":"unavailable"}""") }))
        assertFailsWith<APIError.BadStatus> { service.nearby(37.5, 127.1) }
    }
}

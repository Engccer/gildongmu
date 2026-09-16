package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.kit.models.PlaceSearchResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** Kit `APIClientTests` + `CoverageTests`의 마커 테스트 미러. 전송은 `StubTransport`. */
class APIClientTest {
    @Test fun getDecodesSuccessPayload() = runTest {
        val transport = StubTransport { HttpResponse(200, """{"places":[],"provider":"kakao-local","query":"강남"}""") }
        val client = APIClient("https://example.test", transport)
        val result: PlaceSearchResult = client.get("/api/places", listOf("query" to "강남"))
        assertEquals("kakao-local", result.provider)
        assertEquals("/api/places", pathOf(transport.seenUrls.single()))
        assertTrue(queryOf(transport.seenUrls.single()).contains("query=%EA%B0%95%EB%82%A8"))
    }

    @Test fun getThrowsBadStatusWithServerMessage() = runTest {
        val client = stubbedClient { HttpResponse(502, """{"error":"장소 검색에 실패했습니다."}""") }
        val e = assertFailsWith<APIError.BadStatus> { client.get<PlaceSearchResult>("/api/places", emptyList()) }
        assertEquals(502, e.code)
        assertEquals("장소 검색에 실패했습니다.", e.serverMessage)
    }

    @Test fun `마커 응답은 outOfCoverage 오류로 던진다`() = runTest {
        val client = stubbedClient { HttpResponse(200, """{"outOfCoverage":true}""") }
        assertFailsWith<APIError.OutOfCoverage> { client.get<PlaceSearchResult>("/api/route/walk", emptyList()) }
    }

    @Test fun `unavailableHere 마커는 사유와 함께 던지고 미지 사유는 마커가 아니다`() = runTest {
        val client = stubbedClient { HttpResponse(200, """{"unavailableHere":"seoulOnly"}""") }
        val e = assertFailsWith<APIError.UnavailableHere> { client.get<PlaceSearchResult>("/api/bike/nearby", emptyList()) }
        assertEquals(UnavailableHereReason.seoulOnly, e.reason)
        val unknown = stubbedClient { HttpResponse(200, """{"unavailableHere":"marsOnly"}""") }
        assertIs<APIError.Decoding>(assertFailsWith<APIError> { unknown.get<PlaceSearchResult>("/api/bike/nearby", emptyList()) })
    }

    @Test fun `정상 페이로드는 outOfCoverage 필드 없이 그대로 디코딩된다`() = runTest {
        val client = stubbedClient { HttpResponse(200, """{"places":[],"provider":"kakao-local","query":"강남"}""") }
        val result: PlaceSearchResult = client.get("/api/places", emptyList())
        assertEquals("kakao-local", result.provider)
    }

    @Test fun `전송 실패는 Network 깨진 본문은 Decoding`() = runTest {
        val down = APIClient("https://example.test", object : HttpTransport {
            override suspend fun get(url: String, timeoutMs: Long?): HttpResponse = throw java.io.IOException("connection refused")
        })
        assertFailsWith<APIError.Network> { down.get<PlaceSearchResult>("/api/places", emptyList()) }
        val garbage = stubbedClient { HttpResponse(200, "not-json") }
        assertFailsWith<APIError.Decoding> { garbage.get<PlaceSearchResult>("/api/places", emptyList()) }
    }

    @Test fun `URL 조립은 공백을 퍼센트 20으로 쓰고 timeout을 전송에 넘긴다`() = runTest {
        var seenTimeout: Long? = null
        val transport = object : HttpTransport {
            override suspend fun get(url: String, timeoutMs: Long?): HttpResponse {
                seenTimeout = timeoutMs
                return HttpResponse(200, """{"places":[],"provider":"none","query":"q"}""")
            }
        }
        val client = APIClient("https://example.test/", transport)
        assertEquals("https://example.test/api/places?query=%EA%B0%95%20%EB%82%A8&lang=ko", client.url("/api/places", listOf("query" to "강 남", "lang" to "ko")))
        client.get<PlaceSearchResult>("/api/places", emptyList(), timeoutMs = 2_000)
        assertEquals(2_000L, seenTimeout)
    }
}

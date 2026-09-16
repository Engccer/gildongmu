package space.dodoplanet.gildongmu.nearby

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.kit.APIError
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.NearbyService
import space.dodoplanet.gildongmu.kit.pathOf
import space.dodoplanet.gildongmu.kit.stubbedClient
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AroundPayloadTest {
    private val coord = NearbyCoord(37.538, 127.137)
    private fun service(overview: HttpResponse, places: HttpResponse) = NearbyService(stubbedClient { url ->
        when (pathOf(url)) { "/api/nearby/overview" -> overview; "/api/places/around" -> places; else -> HttpResponse(404, "") }
    })

    @Test fun `한 조각 실패는 Loaded + 실패 플래그`() = runTest {
        val p = fetchAround(service(HttpResponse(500, ""), HttpResponse(200, Fixtures.kit("around-nearby.json"))), coord)
        assertTrue(p.overviewFailed); assertNull(p.overview)
        assertFalse(p.placesFailed); assertTrue(p.places!!.isNotEmpty())
        assertFalse(p.isAllAbsent)
    }

    @Test fun `두 조각 다 실패면 throw(코어가 FailedServer로)`() = runTest {
        assertFailsWith<APIError>{ fetchAround(service(HttpResponse(500, ""), HttpResponse(502, "")), coord) }
    }

    @Test fun `조망 data null + 목록 0건은 실패가 아니라 전부 부재`() = runTest {
        val p = fetchAround(service(HttpResponse(200, """{"data":null}"""), HttpResponse(200, """{"places":[]}""")), coord)
        assertTrue(p.isAllAbsent); assertFalse(p.overviewFailed); assertFalse(p.placesFailed)
        assertEquals(0, p.places!!.size)
    }

    @Test fun `settled는 취소를 삼키지 않는다`() = runTest {
        assertFailsWith<CancellationException> { settled { throw CancellationException("떠남") } }
        assertTrue(settled { throw IllegalStateException("x") }.isFailure)
    }
}

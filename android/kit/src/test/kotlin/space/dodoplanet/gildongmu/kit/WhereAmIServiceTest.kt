package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** 현재 위치 정위 조회(Kit 테스트 없음 — Swift 주석 계약): data:null은 null 반환(키 없음), 그 외 data. */
class WhereAmIServiceTest {
    @Test fun locateUnwrapsDataAndNullMeansGated() = runTest {
        val t = StubTransport { HttpResponse(200, Fixtures.kit("where-am-i.json")) }
        val data = assertNotNull(WhereAmIService(APIClient("https://example.test", t)).locate(37.53, 127.14))
        assertEquals("/api/where-am-i", pathOf(t.seenUrls.last()))
        assertEquals("서울특별시 강동구 길동", data.region)

        val gated = WhereAmIService(APIClient("https://example.test", StubTransport { HttpResponse(200, """{"data":null}""") }))
        assertNull(gated.locate(37.53, 127.14))
    }
}

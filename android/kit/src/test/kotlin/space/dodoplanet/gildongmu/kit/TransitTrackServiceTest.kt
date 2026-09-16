package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.test.runTest
import java.net.URLDecoder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * 추적 폴링 쿼리 계약. Kit 테스트는 없고 iOS 쪽은 웹 소스 가드(`transit-display-guard.test.ts`)가 `lang` 이름을 잠그는데, 그 가드는
 * Swift만 읽는다 — Kotlin 쪽 오타(`"language"`)는 서버가 조용히 무시해 en 실시간 줄만 한국어로 떨어지므로 여기서 잠근다.
 */
class TransitTrackServiceTest {
    private val body = """{"mode":"subway","status":"empty"}"""

    /** 한 호출이 실은 쿼리 (이름, 값) — 순서 그대로. */
    private suspend fun queryItems(call: suspend (TransitTrackService) -> TransitTrackEnvelope): List<Pair<String, String>> {
        var seen = ""
        val service = TransitTrackService(
            stubbedClient { url ->
                assertEquals("/api/transit/track", pathOf(url))
                seen = queryOf(url)
                HttpResponse(200, body)
            },
        )
        call(service)
        return seen.split("&").map { it.substringBefore("=") to URLDecoder.decode(it.substringAfter("="), Charsets.UTF_8) }
    }

    /** Swift 메서드별 `URLQueryItem(name:value:)` — 값이 문자열 리터럴이면 그 값, 아니면 null. */
    private fun swiftQueryItems(): Map<String, List<Pair<String, String?>>> {
        val source = SwiftSource.read("TransitTrackService.swift")
        val funcs = Regex("""public func ([A-Za-z]+)\(""").findAll(source).toList()
        return funcs.indices.associate { i ->
            val body = source.substring(funcs[i].range.last, funcs.getOrNull(i + 1)?.range?.first ?: source.length)
            val items = Regex("""URLQueryItem\(name: "([A-Za-z]+)", value: (?:"([A-Za-z]+)"|[^\r\n]*)\)""").findAll(body)
                .map { it.groupValues[1] to it.groupValues[2].ifEmpty { null } }.toList()
            funcs[i].groupValues[1] to items
        }
    }

    private suspend fun queryItemsOf(swiftName: String): List<Pair<String, String>> = when (swiftName) {
        "seoulWait" -> queryItems { it.seoulWait("123", "r", "en") }
        "seoulRide" -> queryItems { it.seoulRide("r", "b", "a", "en") }
        "resolveTagoStop" -> queryItems { it.resolveTagoStop(36.35, 127.38) }
        "tagoTrack" -> queryItems { it.tagoTrack("c", "n", "10", "en") }
        "subwayTrack" -> queryItems { it.subwayTrack("천호", "1005", "en") }
        else -> fail("Kotlin 미러에 없는 Swift 메서드: $swiftName")
    }

    @Test fun `메서드별 쿼리 이름·순서·고정 값은 Swift 원본과 같다`() = runTest {
        val swift = swiftQueryItems()
        assertEquals(setOf("seoulWait", "seoulRide", "resolveTagoStop", "tagoTrack", "subwayTrack"), swift.keys)
        for ((name, expected) in swift) {
            assertTrue(expected.isNotEmpty(), name) // 선언 모양이 바뀌어 대조가 공회전하는 것을 막는다
            val actual = queryItemsOf(name)
            assertEquals(expected.map { it.first }, actual.map { it.first }, name)
            for ((i, item) in expected.withIndex()) item.second?.let { assertEquals(it, actual[i].second, "$name.${item.first}") }
        }
    }

    /** `lang`은 추적 4메서드에만 — 정류소 해석은 표시 문장이 없어 싣지 않는다(Swift 주석). */
    @Test fun `추적 4메서드는 lang을 같은 이름으로 싣고 정류소 해석은 싣지 않는다`() = runTest {
        assertEquals("en", queryItems { it.seoulWait("123", "r", "en") }.toMap()["lang"])
        assertEquals("en", queryItems { it.subwayTrack("천호", "1005", "en") }.toMap()["lang"])
        assertEquals(null, queryItems { it.resolveTagoStop(36.35, 127.38) }.toMap()["lang"])
    }

    @Test fun `응답 상태를 폴 입력으로 접는다`() {
        assertEquals(TransitTrackPoll.Empty, TransitTrackService.poll(TransitTrackEnvelope("subway", "empty")))
        assertEquals(TransitTrackPoll.Ok(emptyList()), TransitTrackService.poll(TransitTrackEnvelope("subway", "ok")))
        assertEquals(TransitTrackPoll.Unsupported, TransitTrackService.poll(TransitTrackEnvelope("subway", "unsupported")))
    }
}
